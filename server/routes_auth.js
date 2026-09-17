/**
 * Kimlik ve karakter uclari - tamami SRO_WEB_GAME yordamlari uzerinden.
 *
 *   POST /api/v1/auth/register  {userId, password, email, questionId, answer}
 *   POST /api/v1/auth/login     {userId, password, remember}
 *   POST /api/v1/auth/session   {sessionToken}          <- "beni hatirla"
 *   POST /api/v1/auth/logout    {sessionToken}
 *   GET  /api/v1/auth/me
 *   GET  /api/v1/public/security-questions
 *   GET  /api/v1/characters
 *   POST /api/v1/characters     {name, style, armorClass, weapon}
 *   POST /api/v1/characters/:id/enter
 *   DELETE /api/v1/characters/:id
 *
 * Uyelik SRO_VT_ACCOUNT.TB_User'a, karakter SRO_VT_SHARD._Char'a yazilir.
 * GM yetkisi vSRO kuralina gore: sec_primary = 1 VE sec_content = 1.
 */
import sql from 'mssql';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword, verifyPassword, toVsro, toOyun, md5vsro, isVsroHash } from './db.js';
import { validateCreate, SLOT_ORDER } from './charcreate.js';
import { isGm } from './gm.js';
/* MADDE 26 (capraz istek 45, fark #24): kusam yuvasi S$ ORNEGI olmali
   (dur/maxDur/plus/variance) - duz string tooltipte dayaniklilik cubugu
   gostermez ve tamir listesine girmez. */
import { yeniYigin } from './esya.js';

/* WebCharInventory `Kap='equip'` satirlarindaki Slot indeksinin anlami.
   KAYNAK: paketteki rY dizisi (index-BUMMQVRB.js @8687640) - charcreate.js
   SLOT_ORDER ve kalicilik.js KUSAM_YUVALARI ile BIREBIR ayni dizi.
   Kaydi YAZAN taraf kalicilik.js; burada onun ic dizisini import ETMIYORUZ
   cunku o modulun yuklenememesi (sema gocu, yarim duzenleme) TUM kimlik
   uclarini birden dusururdu. Ortak kaynak zaten charcreate.SLOT_ORDER;
   test_giris-yukleme.mjs iki dosyanin kaymadigini ayrica dogruluyor. */
const KUSAM_YUVALARI = SLOT_ORDER;

const KULLANICI_RE = /^[A-Za-z0-9_]{1,25}$/;   // TB_User.StrUserID varchar(25)
const BURASI = path.dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------ TERS ESYA KATALOGU
 * vSRO CodeName128 -> referans oyun itemId.
 *
 * NEDEN: equipOf() yalnizca itemmap.json'daki 88 BASLANGIC esyasini
 * cevirebiliyordu (72 zirh + 14 silah + 2 kalkan). Bunun disindaki her sey -
 * GM'in verdigi, Windows istemcisiyle kusanilmis ya da yukseltilmis parca -
 * karakter secim ekranina HAM vSRO kodu olarak gidiyordu; istemcinin
 * onizleme bileseni onu cizemiyor (itemsById.get(itemDefId) -> undefined ->
 * `continue`, paket onizleme bileseni _Nt) ve parca gorunmuyordu.
 *
 * KAYNAK: data/itemmap-tam.json - canli SRO_VT_SHARD._RefObjCommon'dan
 * uretildi, 2860/2860 referans oyun esyasi. Zirh ve avatar kayitlarinda erkek
 * (code) ve kadin (codeW) kodlari AYRI tutuluyor, ikisini de aliyoruz.
 * Olculdu: 4610 kod, 0 cakisma -> ters yon TEK ANLAMLI.
 *
 * Dosya yoksa harita bos kalir ve davranis ESKISIYLE AYNI olur (88 esya) -
 * yani bu ek hicbir durumda daha kotu degil.
 */
let TERS_KATALOG = null;
function tersKatalog(log) {
  if (TERS_KATALOG) return TERS_KATALOG;
  TERS_KATALOG = new Map();
  try {
    const ham = JSON.parse(fs.readFileSync(path.join(BURASI, 'data', 'itemmap-tam.json'), 'utf8'));
    for (const [itemId, v] of Object.entries(ham)) {
      if (!v || typeof v !== 'object') continue;      // "$kaynak" gibi metin alanlarini atla
      for (const kod of [v.code, v.codeW]) {
        if (kod && !TERS_KATALOG.has(kod)) TERS_KATALOG.set(kod, itemId);
      }
    }
  } catch (e) {
    log?.(`ters esya katalogu okunamadi - ${String(e.message).slice(0, 100)}`);
  }
  return TERS_KATALOG;
}

export function createAuthRoutes({ web, world, charmap, itemmap, zoneGroundY, cfg, log }) {
  const SHARD = cfg.sql.databases.shard;
  const ACC = cfg.sql.databases.account;
  // erisim jetonu (RAM) -> oturum (DB)
  const tokens = new Map();   // accessToken -> {JID, userId, isGm}

  const req = () => web.request();

  const accountView = (u) => ({
    id: u.JID, userId: u.StrUserID, email: u.Email ?? null,
    emailVerified: true, isGm: !!u.isGm,
    premiumTier: null, premiumExpiresAt: null, jade: 0,
  });

  function issueAccess(u) {
    const t = crypto.randomBytes(24).toString('hex');
    tokens.set(t, { JID: u.JID, userId: u.StrUserID, isGm: !!u.isGm });
    return t;
  }

  /* ---------------------------------------------------------- GM TAZELEME
   * `isGm` giris aninda jetona yaziliyordu; DB'de GM yetkisi verilince
   * oyuncunun CIKIP GIRMESI gerekiyordu. Artik yetki CANLI okunuyor:
   * kisa omurlu bir onbellekle (her JID icin GM_TTL_MS) TB_User'dan
   * dogrulanir, boylece hem anlik hem de veritabanini yormaz.
   */
  const GM_TTL_MS = 5000;
  const gmOnbellek = new Map();          // JID -> { deger, zaman }

  async function gmTazele(JID) {
    const simdi = Date.now();
    const k = gmOnbellek.get(JID);
    if (k && simdi - k.zaman < GM_TTL_MS) return k.deger;
    let deger = false;
    try {
      const r = await req().input('JID', sql.Int, Number(JID))
        .query(`SELECT sec_primary, sec_content FROM ${ACC}.dbo.TB_User WHERE JID = @JID`);
      const u = r.recordset[0];
      deger = isGm({ sec_primary: u?.sec_primary, sec_content: u?.sec_content });
    } catch { deger = k?.deger ?? false; }
    gmOnbellek.set(JID, { deger, zaman: simdi });
    // bellekteki jetonlari da guncelle ki tek kaynak kalsin
    for (const [, t] of tokens) if (t.JID === JID) t.isGm = deger;
    return deger;
  }

  /** Jetondan hesabi cozer VE GM bayragini canli tazeler. */
  async function authOfTaze(httpReq) {
    const a = authOf(httpReq);
    if (!a) return null;
    a.isGm = await gmTazele(a.JID);
    return a;
  }

  function authOf(httpReq) {
    const h = httpReq.headers.authorization || '';
    return h.startsWith('Bearer ') ? tokens.get(h.slice(7)) ?? null : null;
  }

  const ipOf = (r) => (r.headers['x-forwarded-for'] || r.socket?.remoteAddress || '').toString().split(',')[0].trim();

  async function guvenlikSorulari() {
    const r = await req().query('SELECT id, text FROM dbo.WebSecurityQuestion ORDER BY id');
    return r.recordset;
  }

  // ------------------------------------------------------------------ kayit
  async function register(body, httpReq) {
    const userId = String(body.userId ?? '').trim();
    const password = String(body.password ?? '');
    const email = String(body.email ?? '').trim();

    if (!KULLANICI_RE.test(userId))
      return { code: 400, body: { error: 'Kullanici adi 1-25 karakter, harf/rakam/alt cizgi olmali' } };
    if (password.length < 1)
      return { code: 400, body: { error: 'Sifre bos olamaz' } };
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
      return { code: 400, body: { error: 'Gecersiz e-posta' } };

    const pw = await hashPassword(password);
    const ans = body.answer ? await hashPassword(String(body.answer).trim().toLocaleLowerCase('tr')) : null;

    try {
      const r = await req()
        .input('StrUserID', sql.VarChar(25), userId)
        .input('PwHash50', sql.VarChar(50), md5vsro(password))   // vSRO uyumlu
        .input('Email', sql.VarChar(50), email || null)
        .input('RegIp', sql.VarChar(25), ipOf(httpReq).slice(0, 25))
        .input('Algo', sql.VarChar(20), pw.algo)
        .input('Salt', sql.VarChar(64), pw.salt)
        .input('Hash', sql.VarChar(200), pw.hash)
        .input('QuestionId', sql.TinyInt, Number(body.questionId) || 1)
        .input('AnswerSalt', sql.VarChar(64), ans?.salt ?? null)
        .input('AnswerHash', sql.VarChar(200), ans?.hash ?? null)
        .input('RefCode', sql.VarChar(24), crypto.randomBytes(5).toString('hex'))
        .output('JID', sql.Int)
        .execute('WebRegisterAccount');
      log(`kayit: ${userId} (JID=${r.output.JID})`);
      return { code: 200, body: { ok: true, accountId: r.output.JID, userId } };
    } catch (e) {
      const m = String(e.message || '');
      if (m.includes('user_taken')) return { code: 409, body: { error: 'Bu kullanici adi alinmis' } };
      if (m.includes('email_taken')) return { code: 409, body: { error: 'Bu e-posta zaten kayitli' } };
      log('kayit hatasi:', m.slice(0, 140));
      return { code: 500, body: { error: 'Kayit basarisiz' } };
    }
  }

  // ------------------------------------------------------------------ giris
  async function login(body, httpReq) {
    const userId = String(body.userId ?? body.email ?? '').trim();
    const password = String(body.password ?? '');
    const remember = !!body.remember;
    const ip = ipOf(httpReq);

    const r = await req().input('StrUserID', sql.VarChar(25), userId).execute('WebGetAuth');
    const u = r.recordset[0];

    const logDeneme = (ok, sebep) => req()
      .input('j', sql.Int, u?.JID ?? null).input('u', sql.VarChar(25), userId)
      .input('o', sql.Bit, ok ? 1 : 0).input('r', sql.VarChar(40), sebep ?? null)
      .input('i', sql.VarChar(45), ip.slice(0, 45))
      .query('INSERT INTO dbo.WebLoginLog (JID,userId,ok,reason,ip) VALUES (@j,@u,@o,@r,@i)')
      .catch(() => {});

    if (!u) { await logDeneme(false, 'no_user'); return { code: 401, body: { error: 'Kullanici adi veya sifre hatali' } }; }
    if (u.Status === 0) { await logDeneme(false, 'blocked'); return { code: 403, body: { error: 'Hesap engellenmis' } }; }

    let gecerli = false;
    if (u.salt) {
      gecerli = await verifyPassword(password, u);
    } else if (isVsroHash(u.password)) {
      /* WebAuth kaydi yok ama TB_User'da vSRO'nun MD5'i var.
         Windows istemcisiyle acilmis hesaplar boyle. Dogruysa web tarafina
         tasiyoruz (scrypt + tuz) - bir daha MD5'e ihtiyac kalmaz. */
      gecerli = md5vsro(password).toLowerCase() === String(u.password).toLowerCase();
      if (gecerli) {
        const pw = await hashPassword(password);
        await req().input('JID', sql.Int, u.JID)
          .input('Algo', sql.VarChar(20), pw.algo)
          .input('Salt', sql.VarChar(64), pw.salt)
          .input('Hash', sql.VarChar(200), pw.hash)
          .execute('WebMigrateAuth');
        log(`vSRO hesabi web'e tasindi: ${userId}`);
      }
    }
    if (!gecerli) {
      await logDeneme(false, u.salt ? 'bad_password' : 'no_web_auth');
      return { code: 401, body: { error: 'Kullanici adi veya sifre hatali' } };
    }

    const sessionToken = crypto.randomBytes(32).toString('hex');
    await req()
      .input('Token', sql.VarChar(64), sessionToken).input('JID', sql.Int, u.JID)
      .input('Remember', sql.Bit, remember ? 1 : 0)
      .input('Ip', sql.VarChar(45), ip.slice(0, 45))
      .input('UserAgent', sql.NVarChar(300), String(httpReq.headers['user-agent'] || '').slice(0, 300))
      .execute('WebCreateSession');
    await logDeneme(true, remember ? 'remember' : null);
    log(`giris: ${userId}${u.isGm ? ' [GM]' : ''}${remember ? ' (beni hatirla)' : ''}`);
    return { code: 200, body: { token: issueAccess(u), sessionToken, account: accountView(u) } };
  }

  // ------------------------------------------------------- oturumdan giris
  async function session(body) {
    const t = String(body.sessionToken ?? '');
    if (!t) return { code: 400, body: { error: 'sessionToken gerekli' } };
    const r = await req().input('Token', sql.VarChar(64), t).execute('WebResolveSession');
    const u = r.recordset[0];
    if (!u) return { code: 401, body: { error: 'Oturum gecersiz' } };
    log(`oturum geri yuklendi: ${u.StrUserID}`);
    return { code: 200, body: { token: issueAccess(u), sessionToken: t, account: accountView(u) } };
  }

  async function logout(body, httpReq) {
    const t = String(body.sessionToken ?? '');
    if (t) await req().input('Token', sql.VarChar(64), t).execute('WebDropSession').catch(() => {});
    const h = httpReq.headers.authorization || '';
    if (h.startsWith('Bearer ')) tokens.delete(h.slice(7));
    return { code: 200, body: { ok: true } };
  }

  // ------------------------------------------------------------- karakter
  /** vSRO kodu -> referans oyun item id (itemmap.json'un tersi). */
  const vsroToOyun = new Map();
  for (const [k, v] of Object.entries(itemmap.armor ?? {})) {
    /* itemmap anahtari: "irk|cinsiyet|sinif|yuva"  ornek: european|female|clothes|pants
       referans oyun itemId bicimi (charcreate.startingEquip ile AYNI olmali):
           `${onEk}${sinif}01_${yuva}`   onEk = irk === 'european' ? 'eu_' : ''
       ESKIDEN: slice(2).join('01_') -> "clothes01_pants"  (eu_ ONEKI KAYIPTI)
       Sonuc: Avrupali karakterin ITEM_EU_W_CLOTHES_01_LA_A esyasi istemciye
       CIN esyasi (Cotton Trousers - "Yalnizca Cin") olarak gidiyordu. */
    const [irk, , sinif, slot] = k.split('|');
    const onEk = irk === 'european' ? 'eu_' : '';
    vsroToOyun.set(v.code, { slot, itemId: `${onEk}${sinif}01_${slot}` });
  }
  for (const [k, v] of Object.entries(itemmap.weapons ?? {})) vsroToOyun.set(v.code, { slot: 'weapon', itemId: k + '01' });
  for (const [k, v] of Object.entries(itemmap.shields ?? {})) {
    vsroToOyun.set(v.code, { slot: 'shield', itemId: (k === 'european' ? 'eu_' : '') + 'shield01' });
  }

  /**
   * vSRO _Inventory kusam yuvasi sirasi.
   * KAYNAK: SRO_VT_SHARD.dbo._AddNewChar yordaminin KENDI yorumu (canli DB'den
   * OBJECT_DEFINITION ile okundu):
   *     0: EQUIP_SLOT_HELM            6:  EQUIP_SLOT_WEAPON
   *     1: EQUIP_SLOT_MAIL            7:  EQUIP_SLOT_SHIELD or ARROW
   *     2: EQUIP_SLOT_SHOULDERGUARD   8:  EQUIP_SLOT_EARRING
   *     3: EQUIP_SLOT_GAUNTLET        9:  EQUIP_SLOT_NECKLACE
   *     4: EQUIP_SLOT_PANTS           10: EQUIP_SLOT_L_RING
   *     5: EQUIP_SLOT_BOOTS           11: EQUIP_SLOT_R_RING
   * Yuva 12 = 13. kusam yuvasi; yordam yorumunda ADI YOK, o yuzden
   * haritalanmiyor (uydurmaktansa cizilmesin).
   * ESKIDEN dizi 8 elemanliydi: takilar (8..11) sorgudan geliyor ama
   * VSRO_SLOT[8] undefined oldugu icin sessizce ATILIYORDU.
   */
  const VSRO_SLOT = ['head', 'chest', 'shoulder', 'gloves', 'pants', 'boots',
    'weapon', 'shield', 'earring', 'necklace', 'ringL', 'ringR'];

  /** Tek bir vSRO kodunu referans oyun itemId'sine cevirir. */
  function vsroKoduCevir(kod) {
    // 1) itemmap.json (karakter OLUSTURMA yolunun otoritesi, 88 esya)
    // 2) data/itemmap-tam.json ters katalogu (4610 kod)
    // 3) hicbiri bilmiyorsa ham kod - istemci cizemez ama diger parcalar durur
    return vsroToOyun.get(kod)?.itemId ?? tersKatalog(log).get(kod) ?? kod;
  }

  /** `IN (@c0,@c1,...)` listesi kurar ve parametreleri istege ekler. */
  function idListesi(istek, ids) {
    const ad = [];
    ids.forEach((id, i) => { istek.input('c' + i, sql.Int, id); ad.push('@c' + i); });
    return ad.join(',');
  }

  /**
   * _Inventory (vSRO tarafi) kusam okumasi - TOPLU.
   * Bu tablo yalnizca _AddNewChar'in verdigi BASLANGIC setini tutuyor:
   * oyun ici kusam degisiklikleri buraya yazilamiyor (referans oyun katalogunun
   * 2860 esyasinin cogunun _Items karsiligi yok - bkz. kalicilik.js basligi).
   */
  async function vsroKusamlari(ids) {
    const out = new Map();
    if (!ids.length) return out;
    try {
      const istek = req();
      const liste = idListesi(istek, ids);
      const r = await istek.query(`
        SELECT i.CharID, i.Slot, o.CodeName128
        FROM ${SHARD}.dbo._Inventory i
        JOIN ${SHARD}.dbo._Items      it ON it.ID64 = i.ItemID
        JOIN ${SHARD}.dbo._RefObjCommon o ON o.ID = it.RefItemID
        WHERE i.CharID IN (${liste}) AND i.Slot < 13 AND o.CodeName128 <> 'DUMMY_OBJECT'`);
      for (const row of r.recordset) {
        const yuva = VSRO_SLOT[row.Slot];
        if (!yuva) continue;
        const k = String(row.CharID);
        if (!out.has(k)) out.set(k, {});
        /* MADDE 26 (capraz istek 45): kusam yuvasi S$ nesnesi bekliyor
           (iht semasi @25595485). Duz string dur/maxDur/plus/variance
           tasimaz; server.js envanterPayload string'i {itemId,qty}'ye
           ceviriyor ama dayaniklilik URETMIYOR - kaynakta duzeltildi. */
        out.get(k)[yuva] = yeniYigin(vsroKoduCevir(row.CodeName128), 1);
      }
    } catch (e) {
      /* SHARD tarafi okunamiyorsa karakter listesi YINE DE donsun: kusam
         disindaki her sey (seviye, altin, konum, canta boyu) SRO_WEB_GAME'den
         geliyor ve dogru. Eskiden bu sorgu patlayinca TUM giris 500 aliyordu. */
      log(`baslangic kusami okunamadi: ${String(e.message).slice(0, 120)}`);
    }
    return out;
  }

  /**
   * WebCharInventory (referans oyun tarafi) kusam okumasi - TOPLU.
   * Oyun ici GERCEK kusam burada: kalicilik.js her kayitta
   * (CharID, Kap='equip', Slot=KUSAM_YUVALARI indeksi, StackJson=S$) yaziyor.
   */
  async function webKusamlari(ids) {
    const out = new Map();
    if (!ids.length) return out;
    try {
      const istek = req();
      const liste = idListesi(istek, ids);
      const r = await istek.query(
        `SELECT CharID, Slot, StackJson FROM dbo.WebCharInventory
          WHERE Kap = 'equip' AND CharID IN (${liste})`);
      for (const row of r.recordset) {
        const yuva = KUSAM_YUVALARI[row.Slot];
        if (!yuva) continue;
        let st;
        try { st = JSON.parse(row.StackJson); } catch { continue; }   // bozuk satiri atla
        if (!st?.itemId) continue;
        const k = String(row.CharID);
        if (!out.has(k)) out.set(k, {});
        out.get(k)[yuva] = st;
      }
    } catch (e) {
      /* Tablo henuz yoksa (ilk calistirma) ya da okunamiyorsa _Inventory'den
         gelen baslangic seti kullanilir - giris ENGELLENMEZ. */
      log(`kusam kaydi okunamadi: ${String(e.message).slice(0, 120)}`);
    }
    return out;
  }

  /**
   * ONCELIK KURALI - kalicilik.js:85 ile BIREBIR AYNI olmak ZORUNDA:
   * karakterin WebCharInventory'de kusam satiri VARSA o kayit _Inventory'den
   * okunani TAMAMEN ezer; hic satiri yoksa baslangic seti korunur.
   *
   * NEDEN: karakter secim ekrani (REST /api/v1/characters) ve dunyaya giris
   * ayni kaynagi gormeli. Eskiden ekran HEP _Inventory'yi okuyordu, yani
   * oyuncu 11. seviyede avatar giymis olsa bile onizlemede hep 1. seviye
   * baslangic setiyle duruyordu (canli olcum: CharID=1 kusaminda
   * avatar_eu_wedding_dress/hat var, _Inventory'de yok).
   */
  /**
   * Iki kaynagi YUVA BAZINDA birlestirir.
   *
   * ESKIDEN "ya hep ya hic" idi: web tarafinda TEK BIR satir bile varsa vSRO
   * tarafinin TAMAMI atiliyordu. kalicilik.js CIFT YOLLU hale gelince bu kural
   * bozuldu ve gorunur bir hataya donustu:
   *   - zirh/silah  -> 1. yol: SRO_VT_SHARD._Items + _Inventory (gercek kayit)
   *   - avatar      -> 2. yol: SRO_WEB_GAME.WebCharInventory (avatarDress/Hat/
   *                    Attach vSRO'ya YAZILAMIYOR - bkz. kalicilik.js basligi)
   * Yani kostum giyen bir karakterin web tarafinda 2 satiri (elbise + sapka)
   * olusuyor, eski kural da _Inventory'deki 6 zirh parcasini SILIYORDU.
   * Sonuc: karakter secim ekraninda ve onizlemede karakter CIPLAK gorunuyordu.
   *
   * Dogrusu: her iki kaynagi da al, cakisan yuvada WEB tarafi kazansin
   * (oyun ici son degisiklik orada) - ama DIGER yuvalar korunsun.
   */
  function kusamBirlestir(webKayit, vsroKayit) {
    return { ...(vsroKayit ?? {}), ...(webKayit ?? {}) };
  }

  async function kusamlariOku(ids) {
    const [webK, vsroK] = await Promise.all([webKusamlari(ids), vsroKusamlari(ids)]);
    const out = new Map();
    for (const id of ids) {
      const k = String(id);
      out.set(k, kusamBirlestir(webK.get(k), vsroK.get(k)));
    }
    return out;
  }

  /** Tek karakterlik kolaylik sarmalayicisi (eski equipOf imzasi). */
  async function equipOf(CharID) {
    return (await kusamlariOku([Number(CharID)])).get(String(CharID)) ?? {};
  }

  /**
   * SATIN ALINAN CANTA SAYFALARI.
   * vSRO _Char.InventorySize 13 KUSAM yuvasini da sayar (yukaridaki _AddNewChar
   * yorumu: 0..11 kusam + 12 = 13 yuva) ve vSRO varsayilani 45 = 13 + 32,
   * 32 de gameConfig.bagSlots. Ayni 13 kaydirmasi sistem_banka-depo.js'te
   * `VSRO_KUSAM_YUVASI = 13` olarak yaziliyor ve item.expand oraya yaziyor.
   *
   * ESKIDEN: WebListCharacters yordami bu kolonu ZATEN donduruyordu
   * (proc govdesi: "... c.PosZ, c.InventorySize, s.style ...") ama listCharacters
   * onu okumuyordu. Sonuc: oyuncunun satin aldigi canta sayfalari giriste
   * gorunmez oluyordu. Olcum: CharID=1 InventorySize=77 -> 64 canta yuvasi.
   */
  const VSRO_KUSAM_YUVASI = 13;
  function cantaYuvaSayisi(inventorySize) {
    const n = Number(inventorySize);
    if (!Number.isFinite(n)) return null;
    const yuva = Math.trunc(n) - VSRO_KUSAM_YUVASI;
    return yuva > 0 ? yuva : null;
  }

  /**
   * KAYIT -> DIZI. Istemcinin karakter onizlemesi equip'i DIZI bekliyor.
   *
   * Paketteki onizleme bileseni (index-BUMMQVRB.js):
   *     var gNt = [];
   *     function _Nt({ style, equip = gNt }) {
   *       ...
   *       for (let { slot, itemDefId } of equip) {   // <-- equip ITERABLE olmali
   *         let def = itemsById.get(itemDefId),
   *             ad  = rY[slot];                       // <-- slot SAYISAL indeks
   *         if (!def || !ad) continue;
   *         ...
   *       }
   *     }
   *     rY = ['weapon','shield','head','shoulder','chest','gloves','pants',
   *           'boots','avatarDress','avatarHat','avatarAttach','earring',
   *           'necklace','ringL','ringR']            // = SLOT_ORDER
   *
   * Biz KAYIT ({head:'clothes01_head',...}) gonderiyorduk; nesne iterable
   * olmadigi icin "TypeError: t is not iterable" atiyor ve onizleme sonsuza
   * kadar "yukleniyor..." spinnerinda kaliyordu. Varsayilan [] de devreye
   * girmiyor cunku TANIMLI bir deger yolluyoruz.
   *
   * DIKKAT: bu SADECE REST karakter listesi icindir. Oyun icindeki iki
   * kullanim FARKLI ve KAYIT olarak kalmali (canli referans oyun zone.init
   * yakalamasiyla dogrulandi):
   *   entity.appearance.equip -> Record<yuvaAdi, itemId>
   *   self.inventory.equip    -> Record<yuvaAdi, {itemId,...}|null>
   */
  function equipDizisi(kayit) {
    const out = [];
    for (const [ad, v] of Object.entries(kayit ?? {})) {
      if (!v) continue;
      const i = SLOT_ORDER.indexOf(ad);
      if (i < 0) continue;                 // tanimadigimiz yuva - gonderme
      out.push({ slot: i, itemDefId: typeof v === 'string' ? v : v.itemId });
    }
    return out.sort((a, b) => a.slot - b.slot);
  }

  /** REST /api/v1/characters cevabi - equip DIZI olarak. */
  async function listCharactersClient(acc) {
    const list = await listCharacters(acc);
    return list.map(c => ({ ...c, equip: equipDizisi(c.equip) }));
  }

  /**
   * vSRO konumundan oyun dunyasi konumuna. _Char tablosunda LatestRegion +
   * PosX/PosY/PosZ tutuluyor; biz bunlari HIC OKUMUYORDUK, bu yuzden her
   * giriste ch.x/ch.z tanimsiz kaliyor ve sunucu spawnPointOf() ile Jangan'a
   * dusuyordu ("her cikis-giriste sifirdan basliyorum").
   * PosY yazarken y/0.15 kullaniliyor (createCharacter), tersi y*0.15.
   */
  const AKTIF_BOLGELER = Object.keys(world.zones ?? {}).filter(id => !/deprecated/i.test(id));

  /**
   * !!! BOLGE KUTULARI CAKISIYOR - KOORDINAT TEK BASINA BOLGEYI BELIRLEMEZ !!!
   *
   * `bounds` degerleri paketten birebir geliyor (paket_veri/zones/*.json ->
   * boundsU) ve komsu iller ORTAK DIKIS SERIDINI paylasiyor:
   *     jangan   X 5760..11520   Z  -864..3168
   *     donwhang X 2016.. 7776   Z -1152..4320   -> X 5760..7776 ORTAK
   *     hotan    X -4320.. 2304  Z -2304..4032
   *     samarkand X -13536..-4032 Z 1152..4896   -> X -4320..-4032 ORTAK
   * Olculen cakisma: jangan kutusunun %35'i, donwhang'in %30.5'i, hotan %5.5,
   * samarkand %2.3. Dikis seridinde IKI bolgenin de nav/heightfield verisi VAR
   * ve ayni yuksekligi veriyor - yani arazi bakarak da ayirt EDILEMEZ.
   *
   * Eski kod ilk esleseni donduruyordu; sira Object.keys(world.zones) sirasi
   * oldugu icin dikis seridindeki her nokta HEP jangan (ya da hotan) cikiyordu.
   * Bolgeler arasi gecis eklenene kadar bu hic gorunmuyordu (oyuncu zaten
   * baska bolgeye gidemiyordu). Simdi gorunur bir hata:
   *   - Donwhang'in DOGU ucte biri (X > 5760) cikis-girişte JANGAN'a dusuyor.
   *   - Etkilenen isinlanma hedefleri (44 hedefin 4'u):
   *       jangan/gate_npc_ch_ferry  -> gate_npc_wc_ferry  (7583.4, 2526.3)
   *       jangan/gate_npc_ch_ferry2 -> gate_npc_wc_ferry2 (6201.75, 1818.15)
   *       hotan/gate_npc_tk_tunnel_no -> gate_npc_ca_tunnel_no (-4159.2, 4017.3)
   *       hotan/gate_npc_tk_tunnel_so -> gate_npc_ca_tunnel_so (-4114.2, 3156.6)
   *     (gate_ch -> gate_wc, yani 5000 altinlik ana kapi, seridin DISINA
   *      dustugu icin ETKILENMIYOR.)
   *
   * COZUM: son bilinen bolgeyi hatirla ve dikis seridinde ONA oncelik ver.
   * _Char'da bolge kolonu YOK (LatestRegion de x/z'den turetiliyor, yani ayni
   * belirsizligi tasiyor).
   *
   * ESKIDEN hafiza YALNIZCA SURECTE tutuluyordu: sunucu yeniden baslayinca
   * bosaliyor ve Donwhang'in dogu ucte biri yine Jangan'a dusuyordu.
   * SIMDI ayrica SRO_WEB_GAME.dbo.WebCharZone'a yaziliyor (kalicilik.js ve
   * sistem_banka-depo.js ile AYNI kalip: tabloyu ilk ihtiyacta kendisi kurar,
   * kuramazsa sessizce bellege duser). RAM hala en taze kaynak; DB yalnizca
   * yeniden baslatmayi kopruluyor.
   */
  const SON_BOLGE = new Map();              // charId (metin) -> zoneId  (en taze)
  const BOLGE_YAZILI = new Map();           // charId (metin) -> DB'de oldugu bilinen deger
  const BOLGE_TABLO = 'dbo.WebCharZone';
  let bolgeTablosu = null;                  // Promise<boolean> - bir kez denenir

  function bolgeTablosuKur() {
    if (bolgeTablosu) return bolgeTablosu;
    bolgeTablosu = (async () => {
      try {
        await req().query(`
          IF OBJECT_ID('${BOLGE_TABLO}') IS NULL
            CREATE TABLE ${BOLGE_TABLO} (
              CharID    int         NOT NULL CONSTRAINT PK_WebCharZone PRIMARY KEY,
              Zone      varchar(64) NOT NULL,
              UpdatedAt datetime    NOT NULL CONSTRAINT DF_WebCharZone_At DEFAULT GETDATE());`);
        return true;
      } catch (e) {
        log(`bolge tablosu kurulamadi - ${String(e.message).slice(0, 120)}`);
        return false;
      }
    })();
    return bolgeTablosu;
  }

  /** Kayitli bolgeleri SON_BOLGE'ye tohumlar - kayitliKonum()'dan ONCE cagrilmali. */
  async function bolgeleriOku(ids) {
    const liste = [...new Set(ids.map(Number).filter(Number.isFinite))];
    if (!liste.length) return;
    if (!(await bolgeTablosuKur())) return;
    try {
      const istek = req();
      const ad = idListesi(istek, liste);
      const r = await istek.query(`SELECT CharID, Zone FROM ${BOLGE_TABLO} WHERE CharID IN (${ad})`);
      for (const row of r.recordset) {
        const k = String(row.CharID);
        BOLGE_YAZILI.set(k, row.Zone);
        /* RAM'deki deger DAHA TAZE olabilir (oyuncu su an oyunda ve bolge
           degistirdi) - onu EZME. Bilinmeyen bir bolge adini da alma. */
        if (!SON_BOLGE.has(k) && world.zones?.[row.Zone]) SON_BOLGE.set(k, row.Zone);
      }
    } catch (e) {
      log(`kayitli bolge okunamadi - ${String(e.message).slice(0, 120)}`);
    }
  }

  function bolgeBul(x, z, ipucu) {
    const adaylar = [];
    for (const id of AKTIF_BOLGELER) {
      const b = world.zones[id]?.bounds;
      if (b && x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ) adaylar.push(id);
    }
    if (!adaylar.length) return null;
    if (adaylar.length > 1 && ipucu && adaylar.includes(ipucu)) return ipucu;
    return adaylar[0];
  }

  /** Oyuncunun o an BULUNDUGU bolgeyi hatirla (kayit yolundan cagrilir). */
  function bolgeyiHatirla(charId, zone) {
    if (zone && world.zones?.[zone]) SON_BOLGE.set(String(charId), zone);
  }

  /**
   * Bolgeyi kalici yazar. Deger DEGISMEDIYSE hicbir sorgu calistirmaz -
   * kayit yolu 30 saniyede bir kosuyor, bolge ise nadiren degisiyor.
   * Hata giris/cikis akisini KIRMAZ (kalicilik.js ile ayni sozlesme).
   */
  async function bolgeyiKaydet(charId, zone) {
    if (!zone || !world.zones?.[zone]) return false;
    const k = String(charId);
    if (BOLGE_YAZILI.get(k) === zone) return false;
    if (!(await bolgeTablosuKur())) return false;
    try {
      await req()
        .input('c', sql.Int, Number(charId))
        .input('z', sql.VarChar(64), zone)
        .query(`UPDATE ${BOLGE_TABLO} SET Zone = @z, UpdatedAt = GETDATE() WHERE CharID = @c;
                IF @@ROWCOUNT = 0 INSERT INTO ${BOLGE_TABLO} (CharID, Zone) VALUES (@c, @z);`);
      BOLGE_YAZILI.set(k, zone);
      return true;
    } catch (e) {
      log(`bolge kaydedilemedi - ${String(e.message).slice(0, 120)}`);
      return false;
    }
  }

  /** Karakterin kayitli konumu - yoksa null (cagiran dogum noktasina duser). */
  function kayitliKonum(c) {
    if (c.LatestRegion == null || c.PosX == null || c.PosZ == null) return null;
    const { x, z } = toOyun(Number(c.LatestRegion), Number(c.PosX), Number(c.PosZ));
    if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
    const zone = bolgeBul(x, z, SON_BOLGE.get(String(c.CharID)));
    if (!zone) return null;                 // sinir disi kayit - guvenme
    return { x: +x.toFixed(2), z: +z.toFixed(2), y: Number(c.PosY ?? 0) * 0.15, zone };
  }

  /** Konumu _Char'a yazar. Cikista ve periyodik olarak cagrilir. */
  async function saveCharPos(charId, { x, z, y, hp, mp, zone }) {
    bolgeyiHatirla(charId, zone);           // dikis seridi belirsizligi - bkz. bolgeBul
    const pos = toVsro(x, z);
    await req()
      .input('CharID', sql.Int, Number(charId))
      .input('RegionID', sql.Int, pos.region)
      .input('PosX', sql.Real, pos.px)
      .input('PosY', sql.Real, (y ?? 0) / 0.15)
      .input('PosZ', sql.Real, pos.pz)
      .input('HP', sql.Int, Math.max(1, Math.round(hp ?? 1)))
      .input('MP', sql.Int, Math.max(0, Math.round(mp ?? 0)))
      .execute('WebSaveCharPos');
    // Bolgeyi de kalici yaz - konum tek basina bolgeyi belirlemiyor (bkz. bolgeBul).
    await bolgeyiKaydet(charId, zone);
  }

  /**
   * Karakter ILERLEMESINI _Char'a yazar.
   *
   * NEDEN VAR: saveCharPos yalnizca konum + HP/MP yaziyordu. Seviye, deneyim,
   * beceri puani, stat puani, STR/INT ve altin HICBIR YERDE kaydedilmiyordu -
   * bu yuzden oyuncu 4. seviyeye ciksa bile cikip girince _Char'daki eski
   * (1. seviye) satir geri yukleniyordu. Kullanicinin bildirimi:
   * "_Char tablosunda hala 1 lvl im fakat oyunda 4 lvl gorunuyom".
   *
   * WebSaveCharPos yordamini genisletmek yerine DUZ SQL kullaniyoruz: yordam
   * SRO_WEB_GAME'de tanimli ve imzasini degistirmek kurulumu bozar.
   *
   * KIRPMA: degerler vSRO kolon TIPLERINE gore kirpilir (canli DB'den okundu)
   *   CurLevel/MaxLevel tinyint | Strength/Intellect/RemainStatPoint smallint
   *   RemainSkillPoint/SExpOffset/HP/MP int | ExpOffset/RemainGold bigint
   * Kirpmazsak tek bir tasan deger TUM kaydi hataya dusurur ve oyuncu
   * ilerlemesini sessizce kaybeder.
   */
  async function saveCharProgress(charId, ch) {
    /* Bolge kutulari cakisiyor; LatestRegion x/z'den turetildigi icin dikis
       seridindeki bir konum hangi bolgeye ait BILINEMIYOR. ch.zone dogruyu
       biliyor - hatirla ki cikis-giriste dogru bolgeye donsun. (bkz. bolgeBul) */
    bolgeyiHatirla(charId, ch?.zone);
    const kirp = (v, alt, ust) => Math.max(alt, Math.min(ust, Math.round(Number(v) || 0)));
    const pos = toVsro(ch.x, ch.z);
    await req()
      .input('CharID', sql.Int, Number(charId))
      .input('lvl',    sql.TinyInt,  kirp(ch.level ?? 1, 1, 255))
      .input('xp',     sql.BigInt,   kirp(ch.xp ?? 0, 0, 9e15))
      .input('spExp',  sql.Int,      kirp(ch.spExp ?? 0, 0, 2147483647))
      .input('sp',     sql.Int,      kirp(ch.sp ?? 0, 0, 2147483647))
      .input('stat',   sql.SmallInt, kirp(ch.statPoints ?? 0, 0, 32767))
      .input('str',    sql.SmallInt, kirp(ch.str ?? 20, 1, 32767))
      .input('int',    sql.SmallInt, kirp(ch.int ?? 20, 1, 32767))
      .input('gold',   sql.BigInt,   kirp(ch.gold ?? 0, 0, 9e15))
      .input('HP',     sql.Int,      kirp(ch.hp ?? 1, 1, 2147483647))
      .input('MP',     sql.Int,      kirp(ch.mp ?? 0, 0, 2147483647))
      .input('RegionID', sql.Int,  pos.region)
      .input('PosX',   sql.Real, pos.px)
      .input('PosY',   sql.Real, (ch.y ?? 0) / 0.15)
      .input('PosZ',   sql.Real, pos.pz)
      .query(`UPDATE [${SHARD}].dbo._Char SET
                CurLevel = @lvl,
                MaxLevel = CASE WHEN MaxLevel < @lvl THEN @lvl ELSE MaxLevel END,
                ExpOffset = @xp, SExpOffset = @spExp,
                RemainSkillPoint = @sp, RemainStatPoint = @stat,
                Strength = @str, Intellect = @int, RemainGold = @gold,
                HP = @HP, MP = @MP,
                LatestRegion = @RegionID, PosX = @PosX, PosY = @PosY, PosZ = @PosZ
              WHERE CharID = @CharID`);
    /* Bolge _Char'a SIGMIYOR (kolonu yok) - yan tabloya yaziliyor.
       UPDATE'ten SONRA: ilerleme yazimi patlarsa bolgeyi de yazmayalim. */
    await bolgeyiKaydet(charId, ch?.zone);
  }

  /**
   * KARAKTERIN KALICI DURUMU - giristeki TEK okuma noktasi.
   *
   * Hem karakter secim ekrani (/api/v1/characters) hem de dunyaya giris
   * (/characters/:id/enter bileti) buradan besleniyor, yani ikisi AYNI
   * kaydi gorur. Okunanlar:
   *   _Char            : seviye, xp/spExp, sp/statPoints, str/int, altin,
   *                      HP/MP, konum (LatestRegion+PosX/Y/Z), InventorySize
   *   WebCharInventory : gercek kusam (yoksa _Inventory baslangic seti)
   *   WebCharZone      : son bulunulan bolge (dikis seridi belirsizligi)
   *
   * ESKIDEN her karakter icin ayri bir equipOf() sorgusu kosuyordu (N+1);
   * artik kusam ve bolge TEK seferde toplu okunuyor.
   */
  async function listCharacters(acc) {
    const r = await req().input('JID', sql.Int, acc.JID).execute('WebListCharacters');
    const ids = r.recordset.map(c => Number(c.CharID)).filter(Number.isFinite);
    /* Bolge okumasi kayitliKonum()'dan ONCE bitmeli: dikis seridinde hangi
       bolgeye dusulecegini SON_BOLGE ipucu belirliyor (bkz. bolgeBul). */
    const [kusamlar] = await Promise.all([kusamlariOku(ids), bolgeleriOku(ids)]);
    const list = [];
    for (const c of r.recordset) {
      const cantaYuvasi = cantaYuvaSayisi(c.InventorySize);
      list.push({
        id: String(c.CharID), name: c.CharName16, level: c.CurLevel,
        style: c.style, race: c.race, gender: c.gender,
        hp: c.HP, mp: c.MP, gold: Number(c.RemainGold),
        str: c.Strength, int: c.Intellect,
        xp: Number(c.ExpOffset), spExp: c.SExpOffset,
        sp: c.RemainSkillPoint, statPoints: c.RemainStatPoint,
        region: c.LatestRegion,
        /* Satin alinmis canta sayfalari. `bagSlots` cozulebiliyorsa HER ZAMAN
           konur (genisletilmemis karakterde 45-13 = 32, yani zaten
           gameConfig.bagSlots ile ayni deger); cozulemiyorsa - CharID=0 dummy
           satirindaki InventorySize=0 gibi - alan HIC olmaz ve tuketen taraf
           kendi varsayilanini kullanir. */
        inventorySize: c.InventorySize ?? null,
        ...(cantaYuvasi ? { bagSlots: cantaYuvasi } : {}),
        ...(kayitliKonum(c) ?? {}),        // x, z, y, zone - kayitliysa
        equip: kusamlar.get(String(c.CharID)) ?? {},
      });
    }
    return list;
  }

  /* ------------------------------------------- YENI KARAKTER: KALINTI TEMIZLIGI
   *
   * KOK NEDEN (canli olcum, bu depoda dogrulandi):
   *   - Karakter silme YUMUSAK: WebDeleteCharacter yalnizca
   *     _Char.Deleted = 1 yapar, satir ve CharID DURUR. Yani normal oyunda
   *     bir CharID ASLA yeniden kullanilmaz.
   *   - CharID'yi yeniden kullandiran TEK yol CleanDB.sql'in sifirlama
   *     kolu: `DELETE _Char` + `DBCC CHECKIDENT(..., RESEED, 0)`. Ondan
   *     sonra olusturulan ilk karakter CharID=1 alir.
   *   - SRO_WEB_GAME'deki karaktere bagli satirlar (WebCharInventory,
   *     WebCharZone, WebCharPet...) _Char'a YABANCI ANAHTARLA bagli DEGIL
   *     (ayri veritabani, dagitik butunluk yok - bkz. kalicilik.js basligi),
   *     dolayisiyla o DELETE onlari GOTURMEZ.
   *   Sonuc olculdu: WebCharInventory'de CharID=1 icin 93 `bag` + 2 `equip`
   *   satiri; equip slot 8/9 = avatarDress/avatarHat (KUSAM_YUVALARI). Yeni
   *   karakter dogar dogmaz eski karakterin canta sayfalarini VE avatarlarini
   *   miras aliyordu. (WebCharZone'da 183 satirin 182'si sahipsiz.)
   *
   * BU FONKSIYON KOK SAVUNMADIR: karakter OLUSTURMA aninda o CharID'ye ait
   * TUM SRO_WEB_GAME kalintisini siler; CleanDB.sql hic kosmasa da (ya da
   * eksik kossa da) yeni karakter TEMIZ dogar. Silme guvenlidir cunku satir
   * saniyeler once uretilmis bir CharID'ye aittir - o kimlige ait her sey
   * tanim geregi ONCEKI karakterindir.
   *
   * SOZLESME: hicbir kosulda THROW ETMEZ ve karakter olusturmayi bozmaz;
   * her tablo kendi try/catch'inde, eksik tablo OBJECT_ID kapisiyla atlanir.
   */
  const KALINTI_TABLOLARI = [
    'WebCharInventory',         // canta + kusam (avatar yuvalari dahil) - ASIL SUCLU
    'WebCharInventoryEk',       // maxDur / rolls yan kaydi (kalicilik.js)
    'WebCharUi',                // hotbar / oto-iksir / makro
    'WebCharMarks',             // olum + donus isaretleri
    'WebCharCarrier',           // ticaret kervani durumu
    'WebCharGrowthPet',         // buyuyen evcil hayvan seviyesi/xp
    'WebCharPet',               // evcil hayvan ayarlari
    'WebCharProfession',        // meslek seviyeleri
    'WebCharZone',              // kayitli bolge
    'WebGuildMember',           // LONCA UYELIGI - miras kalirsa yeni karakter loncali dogar
    'WebGuildApplication',
    'WebGuildPenalty',
    'WebPartyMatchApplication',
  ];
  /* WebBugReport BILEREK LISTEDE DEGIL: oyuncunun yazdigi rapor metnidir,
     silinmesi veri kaybi olur. Yanlis karaktere baglanmasin diye yalnizca
     bagi koparilir (CharID nullable). */

  /* ------------------------------------------------------- KAPSAM DENETIMI
   * BAKIM RISKI: yukaridaki liste ELLE tutuluyor. SRO_WEB_GAME'e CharID
   * anahtarli YENI bir tablo eklenirse liste SESSIZCE eskir ve miras bugu
   * (yeni karakter, yeniden kullanilan CharID'nin eski satirlarini alir) O
   * TABLO icin geri doner - kimse fark etmeden.
   *
   * Cozum: dogruyu DB'nin kendi katalogundan (INFORMATION_SCHEMA) oku ve
   * liste + BILINCLI ISTISNALAR ile karsilastir. Fark varsa (a) sunucu
   * gunlugune GURULTULU uyari duser, (b) test_kalinti-temizligi.mjs bolum 5/6
   * KIRMIZI olur. Liste hala ELLE tutulur (bilincli: her tabloya kor kor
   * DELETE atmak, CharID kolonu tasiyan ama silinmemesi gereken bir tabloyu
   * -WebBugReport gibi- goturme riskidir); artik SESSIZ eskiyemez.
   *
   * Istisna = "CharID kolonu var ama kalinti temizliginde SILINMEYECEK"
   * tablo. Her satir gerekcesini tasir; gerekcesiz istisna eklenmemeli. */
  const KALINTI_ISTISNALARI = {
    WebBugReport: 'oyuncunun yazdigi rapor metni - silinmez, ayri kodla CharID=NULL yapilarak bagi koparilir',
  };

  /* Saf (SQL'siz) karsilastirma - test bunu dogrudan cagirir.
     SQL Server varsayilan harmanlamasi buyuk/kucuk harf duyarsizdir, o yuzden
     eslesme kucuk harfe indirgenerek yapilir. */
  function kalintiKapsamiKarsilastir(dbTablolari) {
    const kucuk = (t) => String(t).toLowerCase();
    const kapsam = new Set([...KALINTI_TABLOLARI, ...Object.keys(KALINTI_ISTISNALARI)].map(kucuk));
    const db = [...new Set((dbTablolari ?? []).filter((t) => typeof t === 'string' && t))];
    const dbKucuk = new Set(db.map(kucuk));
    return {
      /* DB'de CharID kolonlu ama ne listede ne istisnada -> MIRAS ACIGI */
      kapsanmayan: db.filter((t) => !kapsam.has(kucuk(t))).sort(),
      /* Listede var ama DB'de yok -> zararsiz (OBJECT_ID kapisi atlar), yine de
         bildirilir: tablo yeniden adlandirildiysa asil hedef kapsam disindadir. */
      olmayan: KALINTI_TABLOLARI.filter((t) => !dbKucuk.has(kucuk(t))),
    };
  }

  /* Katalogu web havuzunun BAGLI OLDUGU veritabanindan (SRO_WEB_GAME) okur. */
  async function kalintiKapsamiOku() {
    const r = await req().query(
      `SELECT c.TABLE_NAME AS tablo
         FROM INFORMATION_SCHEMA.COLUMNS c
         JOIN INFORMATION_SCHEMA.TABLES t
           ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME
        WHERE c.COLUMN_NAME = 'CharID'
          AND c.TABLE_SCHEMA = 'dbo'
          AND t.TABLE_TYPE = 'BASE TABLE'
        ORDER BY c.TABLE_NAME`);
    return (r.recordset ?? []).map((x) => x.tablo).filter(Boolean);
  }

  /* SOZLESME (kalintiyiTemizle ile ayni): hicbir kosulda THROW ETMEZ.
     Surec basina BIR KEZ kosar (ilk karakter olusturmada); denetim maliyeti
     tek katalog sorgusu. Katalog okunamazsa sessiz gecer - kapsam denetimi
     yokken de karakter olusturma calismaya devam eder. */
  let kapsamDenetlendi = false;
  async function kalintiKapsamiDenetle({ tekrar = false } = {}) {
    if (kapsamDenetlendi && !tekrar) return null;
    kapsamDenetlendi = true;
    let db;
    try {
      db = await kalintiKapsamiOku();
    } catch (e) {
      log(`kalinti kapsam denetimi calistirilamadi - ${String(e.message).slice(0, 120)}`);
      return null;
    }
    /* Bos katalog = denetim YAPILAMADI (yetki yok / sahte havuz). Bunu "hicbir
       tablo yok" sayip listedeki 13 tabloyu "DB'de yok" diye bagirmayalim. */
    if (!db.length) return null;

    const { kapsanmayan, olmayan } = kalintiKapsamiKarsilastir(db);
    if (kapsanmayan.length) {
      log(`!!! KALINTI KAPSAMI EKSIK: CharID kolonlu ama temizlenmeyen tablo(lar) -> ${kapsanmayan.join(', ')}. `
        + `Yeniden kullanilan CharID ile dogan karakter bu tablolarda ONCEKI karakterin satirlarini MIRAS ALIR. `
        + `routes_auth.js KALINTI_TABLOLARI'na ekleyin ya da gerekcesiyle KALINTI_ISTISNALARI'na yazin.`);
    }
    if (olmayan.length) {
      log(`kalinti listesinde olup DB'de bulunmayan tablo(lar): ${olmayan.join(', ')} `
        + `(silme OBJECT_ID kapisiyla atlanir; tablo yeniden adlandirildiysa yeni adi listeye girmeli)`);
    }
    return { db, kapsanmayan, olmayan };
  }

  async function kalintiyiTemizle(CharID) {
    /* Number(null) === 0 - `Number.isFinite` tek basina YETMEZ ve CharID=0
       (vSRO'nun `d` dummy karakteri, canli olcum) icin silme calistirirdi.
       Gecerli karakter kimligi POZITIF TAM SAYIDIR. */
    const c = Number(CharID);
    if (!Number.isInteger(c) || c <= 0) return;

    /* RAM onbellekleri de ayni kimlige bagli: BOLGE_YAZILI'da eski karakterin
       bolgesi duruyorsa bolgeyiKaydet() "zaten yazili" deyip DB satirini
       yeniden olusturmaz ve az once sildigimiz satir geri gelmez -> yeni
       karakterin dogum bolgesi kaybolurdu. Once unut, sonra sil. */
    SON_BOLGE.delete(String(c));
    BOLGE_YAZILI.delete(String(c));

    const silinen = [];
    for (const t of KALINTI_TABLOLARI) {
      try {
        const r = await req().input('c', sql.Int, c).query(
          `IF OBJECT_ID('dbo.${t}') IS NOT NULL DELETE FROM dbo.${t} WHERE CharID = @c`);
        const n = (r.rowsAffected ?? []).reduce((a, b) => a + b, 0);
        if (n) silinen.push(`${t}=${n}`);
      } catch (e) {
        log(`kalinti temizligi basarisiz (${t}, CharID=${c}) - ${String(e.message).slice(0, 120)}`);
      }
    }
    try {
      const r = await req().input('c', sql.Int, c).query(
        `IF OBJECT_ID('dbo.WebBugReport') IS NOT NULL
           UPDATE dbo.WebBugReport SET CharID = NULL WHERE CharID = @c`);
      const n = (r.rowsAffected ?? []).reduce((a, b) => a + b, 0);
      if (n) silinen.push(`WebBugReport(bag koparildi)=${n}`);
    } catch (e) {
      log(`kalinti temizligi basarisiz (WebBugReport, CharID=${c}) - ${String(e.message).slice(0, 120)}`);
    }

    if (silinen.length) {
      log(`yeni karakter CharID=${c}: yeniden kullanilan kimlige ait BAYAT kayitlar `
        + `temizlendi -> ${silinen.join(', ')}`);
    }
  }

  async function createCharacter(acc, body) {
    const v = validateCreate(body);
    if (v.hata) return { code: 400, body: { error: v.hata } };

    const st = charmap[v.style];
    if (!st) return { code: 400, body: { error: 'bad_style' } };

    /* IRKA GORE BASLANGIC BOLGESI.
       Olcum (canli referans oyun): Cinli karakter Jangan'da, Avrupali karakter
       CONSTANTINOPLE'da doguyor (kullanicinin Test41 karakteri orada basladi).
       Eskiden herkes cfg.world.startZone'a (Jangan) konuyordu.
       Bolge adlari world.json'dan: europe_province = "Constantinople". */
    const IRK_BOLGESI = { chinese: 'jangan_province', european: 'europe_province' };
    const zone = IRK_BOLGESI[v.race] ?? cfg.world.startZone;
    const sp = world.zones[zone]?.playerSpawn ?? { x: cfg.world.startX, z: cfg.world.startZ };
    const pos = toVsro(sp.x, sp.z);
    const y = zoneGroundY(zone, sp.x, sp.z);

    // vSRO'nun _AddNewChar'i sadece gogus/pantolon/bot/silah/kalkan aliyor.
    // referans oyun 8 parca veriyor; kalan kafa/omuz/eldiven'i WebCreateCharacter
    // vSRO'nun _FN_ADD_INITIAL_EQUIP yordamiyla ekliyor.
    const A = (slot) => itemmap.armor[`${v.race}|${v.gender}|${v.armorClass}|${slot}`]?.id ?? 0;
    const wep = itemmap.weapons[v.weapon]?.id ?? 0;
    const shd = v.oneHand ? (itemmap.shields[v.race]?.id ?? 0) : 0;

    try {
      const r = await req()
        .input('JID', sql.Int, acc.JID).input('RefCharID', sql.Int, st.refObjId)
        .input('CharName', sql.VarChar(64), v.name)
        .input('RegionID', sql.Int, pos.region)
        .input('PosX', sql.Real, pos.px).input('PosY', sql.Real, y / 0.15).input('PosZ', sql.Real, pos.pz)
        .input('RefMail', sql.Int, A('chest')).input('RefPants', sql.Int, A('pants'))
        .input('RefBoots', sql.Int, A('boots'))
        .input('RefWeapon', sql.Int, wep).input('RefShield', sql.Int, shd)
        .input('RefHead', sql.Int, A('head'))
        .input('RefShoulder', sql.Int, A('shoulder'))
        .input('RefGloves', sql.Int, A('gloves'))
        .execute('WebCreateCharacter');
      const CharID = r.recordset[0]?.CharID;
      /* DOGUM BOLGESINI hemen kalici yaz. Irka gore dogum bolgesi burada
         BILINIYOR; ilk giriste yalnizca koordinattan cikarilmasina birakirsak
         dogum noktasi bir dikis seridine denk gelen bir irk eklendiginde
         oyuncu yanlis ilde doguyor olurdu (bkz. bolgeBul). */
      if (CharID !== undefined && CharID !== null) {
        /* ONCE TEMIZLIK, SONRA HER SEY. CleanDB.sql'in RESEED'i CharID'leri
           yeniden kullandirdigi icin bu kimlige ait SRO_WEB_GAME satirlari
           ONCEKI karakterden kalmis olabilir (avatar/canta mirasi). Bolge
           yazimindan ONCE calismali: WebCharZone da temizlenen tablolardan
           biri, sonra kossaydi yeni karakterin dogum bolgesini silerdi. */
        await kalintiyiTemizle(CharID);

        /* Temizlik KAPSAMINI surec basina bir kez denetle: SRO_WEB_GAME'e
           CharID anahtarli yeni bir tablo eklendiyse liste eskimistir ve
           gunluge gurultulu uyari duser (bkz. kalintiKapsamiDenetle).
           Throw etmez; olusturma akisini etkilemez. */
        await kalintiKapsamiDenetle();

        bolgeyiHatirla(CharID, zone);
        await bolgeyiKaydet(CharID, zone);

        /* TUM CANTA SAYFALARI VARSAYILAN ACIK - kullanicinin acik istegi,
         * referans oyun varsayilanindan BILINCLI SAPMA.
         *
         * referans oyunda yeni karakter InventorySize=45 (13 kusam + 32 canta =
         * 1 sayfa) ile baslar; ek sayfalar Item Mall'daki 150 Silk'lik
         * inventory_expansion ile acilir. Kullanici "kac page varsa hepsi
         * full acik olsun" dedi.
         *
         * TAVAN 12 SAYFA = 384 YUVA (SARTNAME-3 MADDE 10/12, kullanici
         * karari "TAM 12 sayfa"; eski deger 5 sayfa/160/173):
         *   - sayfa cizimi paketten: pages = ceil(bag.length / bagSlots)
         *     (sayfa sayisi DIZI BOYUNDAN gelir, sekme seridi cap'siz) ->
         *     bundle yamasiz 12 sekme cikar.
         *   - paketteki c2s bagSlot .max(159) semalari OLU KODDUR: sema
         *     YALNIZ sunucuda uygulanir, istemci gonderim/alimda runtime
         *     dogrulama yapmaz (m$.send sema calistirmaz; sartname-3 madde
         *     19). Canli tavan sunucuda YUVA_MAX=383 ve eslenikleri (madde 11).
         * InventorySize = 13 kusam + 384 canta = 397 (_Char.InventorySize
         * INT, 397 sigar - SELECT kaniti sartname madde 12).
         *
         * YAN ETKI (bilinerek kabul edildi): inventory_expansion urunu artik
         * hep err.expand.max doner - herkes zaten tavanda basliyor. */
        try {
          await req().input('c', sql.Int, CharID).input('n', sql.Int, 397)
            .query(`UPDATE ${SHARD}.dbo._Char SET InventorySize=@n WHERE CharID=@c`);

          /* S1 MADDE 14 TAMAMLAYICISI - _Inventory 109..239 SATIRLARINI AC
           * (SARTNAME-3 MADDE 12 ile genisletildi; eskiden 109..172).
           *
           * _AddNewChar yeni karaktere yalnizca Slot 0..108 (109 satir) acar.
           * kalicilik.js kurali geregi ("var olmayan satira yazmayiz, yeni
           * satir da acmayiz") satiri olmayan yuvalar dogrudan-_Inventory
           * yoluna HIC giremez; o yuvalar WebCharInventory yedegine duser.
           * deploy_inventory_109_172.sql tek seferlik gecisti (yalniz o anki
           * karakterler); kalici cozum satirlari OLUSTURMA ANINDA acmak.
           *
           * SQL, Madde 14 kodTaslaginin CharID'ye daraltilmis birebir hali:
           * ItemID=0 = bos yuva, NOT EXISTS + PK sayesinde idempotent.
           * UPDATE ustte basarisiz olduysa InventorySize=109 kalir ve JOIN
           * kosulu hicbir satir uretmez - kendi kendini sinirlar.
           *
           * SINIR (Mimari A, sartname-3 madde 12): InventorySize artik 397
           * ama satir acimi EN COK Slot 239'a kadar - _RefDummySlot cnt
           * 0..239 (SELECT kaniti) zaten oraya kadar uretir; ayrica acik
           * `n.cnt <= 239` kelepcesi _Inventory.Slot TINYINT tasmasina karsi
           * (ALTER YOK, Slot>255 satiri ASLA acilmaz). Canta yuva 227..383
           * (Slot 240+) _Inventory'de yasamaz; kalicilik.js onlari otomatik
           * WebCharInventory yoluna dusurur (Slot SMALLINT, 383 sigar). */
          await req().input('c', sql.Int, CharID).query(
            `INSERT INTO ${SHARD}.dbo._Inventory(CharID, Slot, ItemID)
             SELECT c.CharID, n.cnt, 0
               FROM ${SHARD}.dbo._Char c
               JOIN ${SHARD}.dbo._RefDummySlot n
                 ON n.cnt >= 109 AND n.cnt < c.InventorySize AND n.cnt <= 239
              WHERE c.CharID = @c
                AND NOT EXISTS (SELECT 1 FROM ${SHARD}.dbo._Inventory v
                                WHERE v.CharID = c.CharID AND v.Slot = n.cnt)`);
        } catch (e) {
          /* Basarisizlik veri kaybi DEGIL: kalicilik.js satir-bazli karar
             verir, satiri olmayan yuvalar WebCharInventory yedeginde korunur. */
          log(`canta sayfalari acilamadi (CharID=${CharID}): ${String(e.message).slice(0, 120)}`);
        }
      }
      log(`karakter: ${v.name} (CharID=${CharID}, ${v.style}, ${v.armorClass}, ${v.weapon})`);
      return { code: 200, body: { character: { id: String(CharID), name: v.name, level: 1 } } };
    } catch (e) {
      const m = String(e.message || '');
      if (m.includes('name_taken')) return { code: 409, body: { error: 'Bu isim alinmis' } };
      log('karakter hatasi:', m.slice(0, 160));
      return { code: 500, body: { error: 'Karakter olusturulamadi' } };
    }
  }

  async function deleteCharacter(acc, charId) {
    const r = await req().input('JID', sql.Int, acc.JID).input('CharID', sql.Int, Number(charId))
      .execute('WebDeleteCharacter');
    return r.recordset[0]?.silinen > 0;
  }

  // --------------------------------------------------- sifremi unuttum
  /** 1. adim: kullanici adindan guvenlik sorusunu getir. */
  async function forgotQuestion(body) {
    const userId = String(body.userId ?? '').trim();
    if (!userId) return { code: 400, body: { error: 'Kullanici adi gerekli' } };
    const r = await req().input('StrUserID', sql.VarChar(25), userId).execute('WebGetSecurityQuestion');
    const u = r.recordset[0];
    // Hesap var mi bilgisini sizdirmamak icin ayni cevabi veriyoruz.
    if (!u || !u.hasSecurity)
      return { code: 404, body: { error: 'Bu kullanici icin guvenlik sorusu tanimli degil' } };
    return { code: 200, body: { userId, questionId: u.questionId, question: u.questionText } };
  }

  /** 2. adim: cevabi dogrula ve sifreyi degistir. */
  async function forgotReset(body) {
    const userId = String(body.userId ?? '').trim();
    const answer = String(body.answer ?? '').trim().toLocaleLowerCase('tr');
    const yeni = String(body.newPassword ?? '');
    if (!userId || !answer) return { code: 400, body: { error: 'Kullanici adi ve cevap gerekli' } };
    if (yeni.length < 1) return { code: 400, body: { error: 'Yeni sifre bos olamaz' } };

    const r = await req().input('StrUserID', sql.VarChar(25), userId).execute('WebGetSecurityAnswer');
    const rec = r.recordset[0];
    if (!rec) return { code: 404, body: { error: 'Guvenlik sorusu tanimli degil' } };

    const dogru = await verifyPassword(answer, { salt: rec.answerSalt, hash: rec.answerHash });
    if (!dogru) {
      await req().input('j', sql.Int, rec.JID).input('u', sql.VarChar(25), userId)
        .input('o', sql.Bit, 0).input('r', sql.VarChar(40), 'bad_security_answer')
        .input('i', sql.VarChar(45), '')
        .query('INSERT INTO dbo.WebLoginLog (JID,userId,ok,reason,ip) VALUES (@j,@u,@o,@r,@i)')
        .catch(() => {});
      return { code: 401, body: { error: 'Guvenlik sorusunun cevabi yanlis' } };
    }

    const pw = await hashPassword(yeni);
    await req()
      .input('JID', sql.Int, rec.JID)
      .input('PwHash50', sql.VarChar(50), md5vsro(yeni))        // vSRO uyumlu
      .input('Algo', sql.VarChar(20), pw.algo)
      .input('Salt', sql.VarChar(64), pw.salt)
      .input('Hash', sql.VarChar(200), pw.hash)
      .execute('WebResetPassword');
    log(`sifre sifirlandi: ${userId} (tum oturumlari dusuruldu)`);
    return { code: 200, body: { ok: true } };
  }

  return {
    tokens, authOf, authOfTaze, gmTazele, accountView, guvenlikSorulari,
    register, login, session, logout, forgotQuestion, forgotReset,
    listCharacters, listCharactersClient, equipDizisi, saveCharPos, saveCharProgress,
    createCharacter, deleteCharacter,
    /* Kusam okuma disari acildi: admin paneli ve dogrulama betikleri ayni
       ONCELIK kuralini (WebCharInventory > _Inventory) kendi kopyalariyla
       degil buradan almali. */
    equipOf, kusamlariOku,
    isGmToken: (t) => !!tokens.get(t)?.isGm,
    /* Birim testi kancasi (sistem_donus-isinlanma / sistem_lonca ile ayni
       kalip). Cakisan bolge kutulari SQL'siz denenebilsin diye disari acildi -
       bkz. test_bolge-kaydi.mjs, test_giris-yukleme.mjs. */
    _durum: {
      bolgeBul, bolgeyiHatirla, bolgeyiKaydet, bolgeleriOku, kayitliKonum,
      SON_BOLGE, BOLGE_YAZILI, AKTIF_BOLGELER,
      kusamBirlestir, vsroKoduCevir, cantaYuvaSayisi, VSRO_SLOT, VSRO_KUSAM_YUVASI,
      tersKatalog: () => tersKatalog(log),
      /* Yeni karakter kalinti temizligi SQL'siz denenebilsin diye disari
         acildi - bkz. test_kalinti-temizligi.mjs. */
      kalintiyiTemizle, KALINTI_TABLOLARI,
      /* Kapsam denetimi: liste ELLE tutuldugu icin DB katalogu ile
         karsilastirilir - test bolum 5 (SQL'siz) ve bolum 6 (canli DB). */
      KALINTI_ISTISNALARI, kalintiKapsamiKarsilastir, kalintiKapsamiOku, kalintiKapsamiDenetle,
    },
  };
}
