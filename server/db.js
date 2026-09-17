/**
 * Veri katmani - vSRO veritabanlarinin uzerine.
 *
 *   uyelik    : SRO_VT_ACCOUNT.dbo.TB_User
 *   karakter  : SRO_VT_SHARD.dbo._Char  (+ _User bagi)
 *   web ekstra: SRO_WEB_GAME (parola ozeti, guvenlik sorusu, oturumlar)
 *
 * KOORDINAT: referans oyun dunya birimi ile vSRO region+local arasindaki donusum
 * uydurulmadi; referans oyunun kendi NPC yerlesimleri veritabanindaki ayni NPC'lerle
 * eslestirilerek turetildi (107 NPC'nin 98'i 2 birim hassasiyetle tutuyor):
 *
 *     oyunX = 0.15 * (regionX * 1920 + localX) - 38880
 *     oyunZ = 0.15 * (regionZ * 1920 + localZ) - 26496
 *     region   = (regionZ << 8) | regionX
 */
import sql from 'mssql';
import crypto from 'node:crypto';

const SCALE = 0.15, OFF_X = -38880, OFF_Z = -26496;

export function toOyun(region, px, pz) {
  const rx = region & 0xFF, rz = (region >> 8) & 0xFF;
  return {
    x: SCALE * (rx * 1920 + px) + OFF_X,
    z: SCALE * (rz * 1920 + pz) + OFF_Z,
  };
}

export function toVsro(x, z) {
  const wx = (x - OFF_X) / SCALE, wz = (z - OFF_Z) / SCALE;
  const rx = Math.max(0, Math.min(255, Math.floor(wx / 1920)));
  const rz = Math.max(0, Math.min(255, Math.floor(wz / 1920)));
  return { region: (rz << 8) | rx, px: wx - rx * 1920, pz: wz - rz * 1920 };
}

// ---------------------------------------------------------------- parola
const scrypt = (pw, salt) => new Promise((ok, no) =>
  crypto.scrypt(pw, salt, 32, (e, d) => e ? no(e) : ok(d.toString('base64'))));

export async function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { algo: 'scrypt', salt, hash: await scrypt(pw, salt) };
}
export async function verifyPassword(pw, rec) {
  if (!rec?.salt || !rec?.hash) return false;
  const h = await scrypt(pw, rec.salt);
  const a = Buffer.from(h), b = Buffer.from(rec.hash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const normAnswer = (s) => String(s ?? '').trim().toLocaleLowerCase('tr');

/**
 * vSRO'nun kendi parola bicimi: TB_User.password = MD5(parola) hex.
 * Dogrulandi: JID=1 -> "c4ca4238a0b923820dcc509a6f75849b" = MD5("1").
 *
 * Web kaydinda da BUNU yaziyoruz; boylece ayni hesap Windows istemcisi ve
 * vSRO araclariyla da calisir. Web tarafinin guclu ozeti (scrypt + tuz)
 * ayrica SRO_WEB_GAME.WebAuth'da durur.
 */
export const md5vsro = (pw) =>
  crypto.createHash('md5').update(String(pw), 'utf8').digest('hex');

export const isVsroHash = (v) => typeof v === 'string' && /^[0-9a-fA-F]{32}$/.test(v);

// ---------------------------------------------------------------- baglantilar
export class Db {
  constructor(cfg) { this.cfg = cfg; this.pools = {}; }

  async pool(which) {
    if (this.pools[which]) return this.pools[which];
    const c = this.cfg;
    this.pools[which] = await new sql.ConnectionPool({
      server: c.server, user: c.user, password: c.password,
      database: c.databases[which], options: c.options,
    }).connect();
    return this.pools[which];
  }
  acc() { return this.pool('account'); }
  shard() { return this.pool('shard'); }
  web() { return this.pool('web'); }
  async close() { for (const p of Object.values(this.pools)) await p.close(); }

  // ------------------------------------------------------------- uyelik
  async findUser(userId) {
    const p = await this.acc();
    const r = await p.request().input('u', sql.VarChar(25), userId)
      .query('SELECT JID, StrUserID, password, Email, Status, GMrank, sec_primary FROM TB_User WHERE StrUserID = @u');
    return r.recordset[0] ?? null;
  }

  async userExists(userId, email) {
    const p = await this.acc();
    const r = await p.request().input('u', sql.VarChar(25), userId).input('e', sql.VarChar(50), email ?? '')
      .query(`SELECT
        (SELECT COUNT(*) FROM TB_User WHERE StrUserID=@u) AS kullanici,
        (SELECT COUNT(*) FROM TB_User WHERE Email=@e AND @e<>'') AS eposta`);
    return r.recordset[0];
  }

  /** TB_User + WebAuth + WebSecurity - hepsi tek islemde. */
  async register({ userId, password, email, questionId, answer, ip }) {
    const acc = await this.acc();
    const pw = await hashPassword(password);

    const ins = await acc.request()
      .input('u', sql.VarChar(25), userId)
      .input('p', sql.VarChar(50), pw.hash.slice(0, 50))   // vSRO sutunu 50 karakter
      .input('e', sql.VarChar(50), email ?? null)
      .input('ip', sql.VarChar(25), (ip ?? '').slice(0, 25))
      .input('q', sql.TinyInt, questionId ?? 3)
      .query(`INSERT INTO TB_User (StrUserID, password, Email, Status, GMrank, regtime, reg_ip,
                                   sec_primary, sec_content, AccPlayTime, LatestUpdateTime_ToPlayTime, Play123Time)
              OUTPUT INSERTED.JID
              VALUES (@u, @p, @e, 1, 3, GETDATE(), @ip, @q, 3, 0, 0, 0)`);
    const JID = ins.recordset[0].JID;

    const web = await this.web();
    await web.request().input('j', sql.Int, JID)
      .input('a', sql.VarChar(20), pw.algo).input('s', sql.VarChar(64), pw.salt)
      .input('h', sql.VarChar(200), pw.hash)
      .query(`MERGE dbo.WebAuth AS t USING (SELECT @j AS JID) AS s ON t.JID=s.JID
              WHEN MATCHED THEN UPDATE SET algo=@a, salt=@s, hash=@h, updatedAt=GETDATE()
              WHEN NOT MATCHED THEN INSERT (JID,algo,salt,hash) VALUES (@j,@a,@s,@h);`);

    if (answer) {
      const ans = await hashPassword(normAnswer(answer));
      await web.request().input('j', sql.Int, JID).input('q', sql.TinyInt, questionId ?? 3)
        .input('s', sql.VarChar(64), ans.salt).input('h', sql.VarChar(200), ans.hash)
        .query(`MERGE dbo.WebSecurity AS t USING (SELECT @j AS JID) AS s ON t.JID=s.JID
                WHEN MATCHED THEN UPDATE SET questionId=@q, answerSalt=@s, answerHash=@h, updatedAt=GETDATE()
                WHEN NOT MATCHED THEN INSERT (JID,questionId,answerSalt,answerHash) VALUES (@j,@q,@s,@h);`);
    }
    return JID;
  }

  async authenticate(userId, password) {
    const u = await this.findUser(userId);
    if (!u) return { hata: 'invalid_credentials' };
    if (u.Status === 0) return { hata: 'account_blocked' };
    const web = await this.web();
    const r = await web.request().input('j', sql.Int, u.JID)
      .query('SELECT algo, salt, hash FROM dbo.WebAuth WHERE JID=@j');
    const ok = await verifyPassword(password, r.recordset[0]);
    if (!ok) return { hata: 'invalid_credentials' };
    return { user: u };
  }

  async logLogin({ JID, userId, ok, reason, ip }) {
    const web = await this.web();
    await web.request().input('j', sql.Int, JID ?? null).input('u', sql.VarChar(25), userId ?? null)
      .input('o', sql.Bit, ok ? 1 : 0).input('r', sql.VarChar(40), reason ?? null)
      .input('i', sql.VarChar(45), (ip ?? '').slice(0, 45))
      .query('INSERT INTO dbo.WebLoginLog (JID,userId,ok,reason,ip) VALUES (@j,@u,@o,@r,@i)');
  }

  // ------------------------------------------------------------- oturum
  async createSession(JID, { remember, ip, userAgent }) {
    const token = crypto.randomBytes(32).toString('hex');
    const gun = remember ? 30 : 1;
    const web = await this.web();
    await web.request().input('t', sql.VarChar(64), token).input('j', sql.Int, JID)
      .input('r', sql.Bit, remember ? 1 : 0)
      .input('i', sql.VarChar(45), (ip ?? '').slice(0, 45))
      .input('ua', sql.NVarChar(300), (userAgent ?? '').slice(0, 300))
      .input('d', sql.Int, gun)
      .query(`INSERT INTO dbo.WebSession (token,JID,expiresAt,remember,ip,userAgent,lastSeenAt)
              VALUES (@t,@j,DATEADD(day,@d,GETDATE()),@r,@i,@ua,GETDATE())`);
    return { token, expiresInDays: gun };
  }

  async resolveSession(token) {
    if (!token) return null;
    const web = await this.web();
    const r = await web.request().input('t', sql.VarChar(64), token)
      .query(`SELECT JID, remember FROM dbo.WebSession WHERE token=@t AND expiresAt > GETDATE()`);
    if (!r.recordset.length) return null;
    await web.request().input('t', sql.VarChar(64), token)
      .query('UPDATE dbo.WebSession SET lastSeenAt=GETDATE() WHERE token=@t');
    return r.recordset[0].JID;
  }

  async dropSession(token) {
    const web = await this.web();
    await web.request().input('t', sql.VarChar(64), token)
      .query('DELETE FROM dbo.WebSession WHERE token=@t');
  }

  async securityQuestions() {
    const web = await this.web();
    return (await web.request().query('SELECT id, text FROM dbo.WebSecurityQuestion ORDER BY id')).recordset;
  }

  // ------------------------------------------------------------- karakter
  async styleMap() {
    if (this._styles) return this._styles;
    const web = await this.web();
    const r = await web.request().query('SELECT style, code, refObjId, race, gender FROM dbo.WebCharStyle');
    this._styles = new Map(r.recordset.map(x => [x.style, x]));
    this._stylesByRef = new Map(r.recordset.map(x => [x.refObjId, x]));
    return this._styles;
  }
  async styleOfRef(refObjId) { await this.styleMap(); return this._stylesByRef.get(refObjId) ?? null; }

  async listCharacters(JID) {
    const sh = await this.shard();
    const r = await sh.request().input('j', sql.Int, JID).query(`
      SELECT c.CharID, c.RefObjID, c.CharName16, c.CurLevel, c.ExpOffset, c.SExpOffset,
             c.Strength, c.Intellect, c.RemainGold, c.RemainSkillPoint, c.RemainStatPoint,
             c.HP, c.MP, c.LatestRegion, c.PosX, c.PosY, c.PosZ, c.InventorySize
      FROM _Char c JOIN _User u ON u.CharID = c.CharID
      WHERE u.UserJID = @j AND c.Deleted = 0`);
    await this.styleMap();
    return r.recordset.map(c => {
      const st = this._stylesByRef.get(c.RefObjID);
      const pos = toOyun(c.LatestRegion, c.PosX, c.PosZ);
      return {
        id: String(c.CharID), name: c.CharName16, level: c.CurLevel,
        style: st?.style ?? null, race: st?.race ?? null, gender: st?.gender ?? null,
        refObjId: c.RefObjID,
        xp: Number(c.ExpOffset), spExp: c.SExpOffset, sp: c.RemainSkillPoint,
        statPoints: c.RemainStatPoint, str: c.Strength, int: c.Intellect,
        hp: c.HP, mp: c.MP, gold: Number(c.RemainGold),
        region: c.LatestRegion, x: pos.x, z: pos.z, y: c.PosY * SCALE,
        inventorySize: c.InventorySize,
      };
    });
  }

  async nameTaken(name) {
    const sh = await this.shard();
    const r = await sh.request().input('n', sql.VarChar(64), name)
      .query('SELECT COUNT(*) AS n FROM _Char WHERE CharName16 = @n AND Deleted = 0');
    return r.recordset[0].n > 0;
  }

  /** _Char + _User - vSRO'nun kendi tablolarina yazar. */
  async createCharacter(JID, req, spawn) {
    const styles = await this.styleMap();
    const st = styles.get(req.style);
    if (!st) return { hata: 'bad_style' };
    const v = toVsro(spawn.x, spawn.z);
    const sh = await this.shard();
    const tx = sh.transaction();
    await tx.begin();
    try {
      const ins = await tx.request()
        .input('ref', sql.Int, st.refObjId)
        .input('n', sql.VarChar(64), req.name)
        .input('str', sql.SmallInt, 20).input('int', sql.SmallInt, 20)
        .input('hp', sql.Int, req.hp).input('mp', sql.Int, req.mp)
        .input('reg', sql.SmallInt, v.region)
        .input('px', sql.Real, v.px).input('py', sql.Real, (spawn.y ?? 0) / SCALE).input('pz', sql.Real, v.pz)
        .query(`INSERT INTO _Char (Deleted,RefObjID,CharName16,NickName16,Scale,CurLevel,MaxLevel,
                  ExpOffset,SExpOffset,Strength,Intellect,RemainGold,RemainSkillPoint,RemainStatPoint,
                  RemainHwanCount,GatheredExpPoint,HP,MP,LatestRegion,PosX,PosY,PosZ,AppointedTeleport,
                  AutoInvestExp,InventorySize,DailyPK,TotalPK,PKPenaltyPoint,TPP,PenaltyForfeit,
                  JobPenaltyTime,JobLvl_Trader,Trader_Exp,JobLvl_Hunter,Hunter_Exp,JobLvl_Robber,Robber_Exp,
                  GuildID,LastLogout,WorldID,HwanLevel,ItemPoints)
                OUTPUT INSERTED.CharID
                VALUES (0,@ref,@n,'',0,1,1,0,0,@str,@int,10000,0,0,0,0,@hp,@mp,@reg,@px,@py,@pz,0,
                        0,45,0,0,0,0,0,0,0,0,0,0,0,0,0,GETDATE(),1,0,0)`);
      const CharID = ins.recordset[0].CharID;
      await tx.request().input('j', sql.Int, JID).input('c', sql.Int, CharID)
        .query('INSERT INTO _User (UserJID, CharID) VALUES (@j, @c)');
      await tx.commit();
      return { CharID };
    } catch (e) {
      await tx.rollback();
      return { hata: 'db_error', detay: e.message };
    }
  }

  async deleteCharacter(JID, charId) {
    const sh = await this.shard();
    const r = await sh.request().input('j', sql.Int, JID).input('c', sql.Int, Number(charId))
      .query(`UPDATE c SET c.Deleted = 1 FROM _Char c JOIN _User u ON u.CharID=c.CharID
              WHERE u.UserJID=@j AND c.CharID=@c`);
    return r.rowsAffected[0] > 0;
  }

  async saveCharacterPos(charId, zoneId, x, y, z, hp, mp) {
    const v = toVsro(x, z);
    const sh = await this.shard();
    await sh.request().input('c', sql.Int, Number(charId))
      .input('reg', sql.SmallInt, v.region)
      .input('px', sql.Real, v.px).input('py', sql.Real, (y ?? 0) / SCALE).input('pz', sql.Real, v.pz)
      .input('hp', sql.Int, hp).input('mp', sql.Int, mp)
      .query(`UPDATE _Char SET LatestRegion=@reg, PosX=@px, PosY=@py, PosZ=@pz,
                               HP=@hp, MP=@mp, LastLogout=GETDATE() WHERE CharID=@c`);
  }
}
