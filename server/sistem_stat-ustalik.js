/**
 * sistem_stat-ustalik.js - STAT DAGITIMI / USTALIK YUKSELTME / BECERI OGRENME
 * =========================================================================
 *
 * Isledigi istemci mesajlari (semalari istemci paketinden BIREBIR alindi,
 * playjs_source/index-BUMMQVRB.js - T$(ad, opcode, ZodSema, hizSinifi)):
 *
 *   c2s 32 stats.allocate  X({ str: Y().int().min(0).max(1e3),
 *                              int: Y().int().min(0).max(1e3) })  `progression`
 *   c2s 33 mastery.raise   X({ masteryId: J() })                  `progression`
 *   c2s 34 skill.learn     X({ skillId: J() })                    `progression`
 *
 * ONEMLI: stats.allocate ARTIS (delta) gonderir, mutlak deger DEGIL.
 * Istemci arayuzu (MFt) yerel bir {str,int} biriktirici tutar, "Uygula"ya
 * basilinca `W$.send('stats.allocate', v_r)` ile SADECE biriktirdigini yollar
 * ve biriktiriciyi sifirlar. Harcanan puan = str + int.
 *
 * Gonderdigi sunucu kareleri (semalar yine paketten):
 *
 *   s2c 144 progress.update  X({ xp:int, xpToNext:int|null, spExp:int,
 *                               spExpToNext:int, sp:int })
 *   s2c 146 stats.update     X({ base:{str:int,int:int,unspent:int},
 *                               derived: rht, hp:int, mp:int })
 *   s2c 147 mastery.update   X({ masteryId:string, level:int, sp:int })
 *   s2c 148 skills.update    X({ known: string[], sp:int })
 *   s2c 195 sys.notice       X({ key: <Tht listesi>, params?, display? })
 *   sys 240 err              X({ code: <Sht listesi>, key?: <Eht listesi>,
 *                               msg?, q?, params? })
 *
 * Kurallar istemcinin KENDI kapi fonksiyonlarindan birebir kopyalandi
 * (paket ofset 25584914 civari):
 *   Lmt(...) -> ustalik yukseltme kapisi
 *   zmt(...) -> beceri ogrenme kapisi
 * Sunucu bunlarin AYNISINI uygular; istemci sadece dugmeyi kilitler,
 * gercek yetki burada.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BURASI = path.dirname(fileURLToPath(import.meta.url));

/* ---------------------------------------------------------------- yardimcilar */

/** progress.json / mastery-costs.json tablolari string anahtarli.
 *  Hucre YOKSA ya da bossa null doner - istemcinin
 *  `masteryCostToLevel(n) = masteryCosts.spCostToLevel[String(n)] ?? null`
 *  davranisinin aynisi. DIKKAT: Number(null) === 0 oldugu icin bos hucreyi
 *  once ayikliyoruz; yoksa tablo bitiminde maliyet 0 sanilip BEDAVA ustalik
 *  seviyesi verilirdi. */
const tabloDeger = (tbl, n) => {
  if (!tbl) return null;
  const v = tbl[String(n)];
  if (v === null || v === undefined || v === '') return null;
  const s = Number(v);
  return Number.isFinite(s) ? s : null;
};

/** ch.masteries -> Map(masteryId -> level). Kayit yoksa bos harita. */
function ustalikHaritasi(ch) {
  const m = new Map();
  for (const u of Array.isArray(ch.masteries) ? ch.masteries : []) {
    if (!u || typeof u.masteryId !== 'string') continue;
    const lv = Number(u.level ?? 0);
    if (lv > 0) m.set(u.masteryId, lv);
  }
  return m;
}

/** ch.knownSkills -> Set(skillId). */
function bilinenSet(ch) {
  return new Set(Array.isArray(ch.knownSkills) ? ch.knownSkills.filter(s => typeof s === 'string') : []);
}

/* ================================================================== kur() */

export function kur(ctx) {
  const {
    frame, log = () => {}, GCFG = {}, combat = null, derived = null,
    SHARD = 'SRO_VT_SHARD',
  } = ctx ?? {};

  /* SQL havuzu KUR ANINDA hazir olmayabilir: server.js sistem modullerini
     initSql()'den ONCE kuruyor ve ctx.web olarak null geciyor. Bu yuzden
     `const` degil `let`; havuz hazir olunca webBagla() ile takiliyor
     (sistem_arayuz-durumu.js ile ayni sozlesme). */
  let web = ctx?.web ?? null;

  const yaz = (...a) => log('[stat-ustalik]', ...a);

  // ------------------------------------------------------- veri: skills.json
  /* data/skills.json istemci paketinden cikarilmis; icinde
     masteries[13] (race + maxLevel + spCostToLevel) ve skills[3256] var.
     Alan adlari paketteki adlarin AYNISI: mastery, skillLevel,
     requiredMasteryLevel, spCost, requiredSkills[{groupId,level}], disabled. */
  let USTALIK = new Map();     // masteryId -> {id,name,race,maxLevel,spCostToLevel}
  let BECERI  = new Map();     // skillId   -> yalin beceri kaydi
  let GRUP    = new Map();     // groupId   -> [beceri] (skillLevel'e gore artan)
  let USTALIK_MALIYET = null;  // {"1":1,...} - kuresel tablo (istemci de kuresel kullanir)

  try {
    const yol = path.join(BURASI, 'data', 'skills.json');
    const S = JSON.parse(fs.readFileSync(yol, 'utf8'));
    for (const m of S.masteries ?? []) {
      USTALIK.set(m.id, {
        id: m.id, name: m.name, race: m.race,
        maxLevel: Number(m.maxLevel ?? 0) || null,
        spCostToLevel: m.spCostToLevel ?? null,
      });
    }
    for (const s of S.skills ?? []) {
      const yalin = {
        id: s.id, groupId: s.groupId, name: s.name,
        mastery: s.mastery,
        skillLevel: Number(s.skillLevel ?? 1),
        requiredMasteryLevel: Number(s.requiredMasteryLevel ?? 0),
        spCost: Number(s.spCost ?? 0),
        requiredSkills: Array.isArray(s.requiredSkills) ? s.requiredSkills : null,
        disabled: s.disabled === true,
        /* `experimentGated` bu pakette cikarilmamis ama canli istemcinin
           beceri kaydinda VAR (paket icinde 11 gecis). Alan gelirse saygi
           gosteriyoruz, yoksa yok - uydurmuyoruz. */
        experimentGated: s.experimentGated === true,
      };
      BECERI.set(yalin.id, yalin);
      if (!GRUP.has(yalin.groupId)) GRUP.set(yalin.groupId, []);
      GRUP.get(yalin.groupId).push(yalin);
    }
    for (const liste of GRUP.values()) liste.sort((a, b) => a.skillLevel - b.skillLevel);
    USTALIK_MALIYET = S.masteryCosts?.spCostToLevel ?? null;
    yaz(`veri: ${USTALIK.size} ustalik, ${BECERI.size} beceri, ${GRUP.size} grup`);
  } catch (e) {
    yaz('data/skills.json okunamadi:', String(e.message).slice(0, 100));
  }

  /* Ustalik SP maliyeti: istemci `masteryCostToLevel(level)` diye KURESEL bir
     fonksiyon cagirir (ustaliga gore degismez). Sunucuda ayni sirayla:
     progress.json -> skills.json masteryCosts. */
  const MALIYET = combat?.progress?.spCostToLevel ?? USTALIK_MALIYET;
  const MAX_SEVIYE = Number(combat?.progress?.maxLevel ?? 0) || null;
  /* game-config.masteryTotalCapPerLevel {chinese:3, european:2} */
  const TOPLAM_CARPAN = GCFG.masteryTotalCapPerLevel ?? {};
  const SP_EXP_BOLEN = Number(combat?.progress?.spExpPerSpPoint ?? 400);

  const ustalikMaliyeti = (seviye) => tabloDeger(MALIYET, seviye);
  const ustalikTavani = (ch) => {
    const n = Number(TOPLAM_CARPAN[ch.race]);
    return Number.isFinite(n) ? n : null;
  };
  const ustalikMaxSeviye = (def) => MAX_SEVIYE ?? def?.maxLevel ?? null;

  // ------------------------------------------------------------ kare yollama
  const hata = (ws, code, ek = {}, q) => { frame(ws, 'err', { code, ...ek }, q); return true; };

  function statKaresi(ws) {
    const ch = ws.char;
    const d = derived ? derived(ch) : null;
    if (!d) { yaz('derived(ch) yok - stats.update yollanamadi'); return; }
    // maxHp/maxMp STR/INT'ten turuyor; STAT artinca tavan yukselir.
    // Mevcut can/mana OLDUGU GIBI kalir, sadece yeni tavana kirpilir.
    const tavanHp = Math.round(Number(d.maxHp) || 0);
    const tavanMp = Math.round(Number(d.maxMp) || 0);
    /* hp/mp sayisal degilse (alan hic kurulmamis) SIFIRA dusurmuyoruz -
       eskiden `ch.hp ?? 0` yuzunden boyle bir karakter stat dagitinca
       0 canla olu gorunuyordu. Sayisal degilse tavana esitlenir;
       gercekten 0 ise (olu oyuncu) 0 kalir. */
    ch.hp = Number.isFinite(Number(ch.hp)) ? Math.min(Math.round(Number(ch.hp)), tavanHp) : tavanHp;
    ch.mp = Number.isFinite(Number(ch.mp)) ? Math.min(Math.round(Number(ch.mp)), tavanMp) : tavanMp;
    frame(ws, 'stats.update', {
      base: { str: ch.str | 0, int: ch.int | 0, unspent: ch.statPoints | 0 },
      derived: d,
      hp: ch.hp | 0, mp: ch.mp | 0,
    });
  }

  function ilerlemeKaresi(ws) {
    const ch = ws.char;
    frame(ws, 'progress.update', {
      xp: ch.xp | 0,
      xpToNext: tabloDeger(combat?.progress?.xpToNext, ch.level),   // tablo bitince null
      spExp: ch.spExp | 0,
      spExpToNext: SP_EXP_BOLEN,
      sp: ch.sp | 0,
    });
  }

  /* ================================================== c2s 32 stats.allocate */
  function statDagit(ws, d, q) {
    const ch = ws.char;
    const artStr = Math.trunc(Number(d?.str ?? 0));
    const artInt = Math.trunc(Number(d?.int ?? 0));

    // Sema: min(0).max(1000). Sinir disi/gecersiz -> ERR_VALIDATION.
    if (!Number.isFinite(artStr) || !Number.isFinite(artInt) ||
        artStr < 0 || artInt < 0 || artStr > 1000 || artInt > 1000) {
      return hata(ws, 'ERR_VALIDATION', {}, q);
    }

    const toplam = artStr + artInt;
    // Istemci `v_a > 0` kapisini zaten koyuyor; 0/0 gelirse hata degil,
    // sadece yeniden esitleme karesi yolla.
    if (toplam === 0) { statKaresi(ws); return true; }

    if ((ch.statPoints | 0) < toplam) return hata(ws, 'ERR_NO_STAT_POINTS', {}, q);

    ch.str = (ch.str | 0) + artStr;
    ch.int = (ch.int | 0) + artInt;
    ch.statPoints = (ch.statPoints | 0) - toplam;

    statKaresi(ws);
    kalici.stat(ch);
    return true;
  }

  /* =================================================== c2s 33 mastery.raise */
  function ustalikYukselt(ws, d, q) {
    const ch = ws.char;
    const id = typeof d?.masteryId === 'string' ? d.masteryId : null;
    if (!id) return hata(ws, 'ERR_VALIDATION', {}, q);

    // --- istemcinin Lmt() kapisi, ayni sirayla ---
    const def = USTALIK.get(id);
    if (!def) return hata(ws, 'ERR_NOT_FOUND', {}, q);
    if (def.race !== ch.race) return hata(ws, 'ERR_RACE', {}, q);

    const seviyeler = ustalikHaritasi(ch);
    const yeni = (seviyeler.get(id) ?? 0) + 1;
    const maliyet = ustalikMaliyeti(yeni);
    const tavanSeviye = ustalikMaxSeviye(def);
    const carpan = ustalikTavani(ch);

    if (maliyet === null || (tavanSeviye !== null && yeni > tavanSeviye)) {
      return hata(ws, 'ERR_MASTERY_CAP',
        carpan === null ? {} : { params: { cap: carpan } }, q);
    }
    if (yeni > (ch.level | 0)) return hata(ws, 'ERR_REQ_LEVEL', {}, q);

    if (carpan !== null) {
      let toplam = 0;
      for (const v of seviyeler.values()) toplam += v;
      if (toplam + 1 > (ch.level | 0) * carpan) {
        return hata(ws, 'ERR_MASTERY_CAP', { params: { cap: carpan } }, q);
      }
    }
    if ((ch.sp | 0) < maliyet) return hata(ws, 'ERR_NO_SP', {}, q);

    // --- uygula ---
    ch.sp = (ch.sp | 0) - maliyet;
    if (!Array.isArray(ch.masteries)) ch.masteries = [];
    const kayit = ch.masteries.find(u => u && u.masteryId === id);
    if (kayit) kayit.level = yeni;
    else ch.masteries.push({ masteryId: id, level: yeni });

    frame(ws, 'mastery.update', { masteryId: id, level: yeni, sp: ch.sp | 0 }, q);
    ilerlemeKaresi(ws);
    /* tr.json sys.skills.mastery_raised = "{mastery} ustaligi {level} seviyesine yukseldi"
       NEDEN HAM ID: istemci sys.notice/err params'ini q5() ile GENISLETIYOR
       (paket @27114703): `typeof item.masteryId == "string" && (node.mastery =
       o.masteriesById.get(item.masteryId)?.name ?? item.masteryId)`. Yani
       `masteryId` gonderildiginde {mastery} yer tutucusunu istemci KENDI
       yerellestirilmis katalogundan doldurur. Onceden sunucudaki `def.name`
       (Ingilizce katalog adi) gonderiliyordu; TR/diger dillerdeki istemcide
       ustalik adi sunucu dilinde kaliyordu. Sayi (level) STRING'E CEVRILMEZ:
       istemci sayilari Intl.NumberFormat'tan geciriyor (paket @25546059). */
    frame(ws, 'sys.notice', { key: 'sys.skills.mastery_raised', params: { masteryId: id, level: yeni } });
    kalici.ustalik(ch, id, yeni);
    return true;
  }

  /* ===================================================== c2s 34 skill.learn */
  function beceriOgren(ws, d, q) {
    const ch = ws.char;
    const id = typeof d?.skillId === 'string' ? d.skillId : null;
    if (!id) return hata(ws, 'ERR_VALIDATION', {}, q);

    // --- istemcinin zmt() kapisi, ayni sirayla ---
    const def = BECERI.get(id);
    if (!def) return hata(ws, 'ERR_UNKNOWN_SKILL', {}, q);

    /* DIKKAT: ERR_SKILL_DISABLED / ERR_SKILL_GATED istemcinin SADECE arayuz
       tarafinda kullandigi kodlar; `err` karesinin `code` enum'unda (Sht)
       YOKLAR. Tel uzerinde ERR_VALIDATION + Eht listesindeki `key` gider;
       istemcinin err isleyicisi once `key`e bakiyor. */
    if (def.disabled) return hata(ws, 'ERR_VALIDATION', { key: 'err.skill.disabled' }, q);
    if (def.experimentGated) return hata(ws, 'ERR_VALIDATION', { key: 'err.skill.experiment_gated' }, q);

    const mdef = USTALIK.get(def.mastery);
    if (!mdef || mdef.race !== ch.race) return hata(ws, 'ERR_RACE', {}, q);

    const bilinen = bilinenSet(ch);
    if (bilinen.has(id)) return hata(ws, 'ERR_VALIDATION', { msg: 'already_known' }, q);

    const seviyeler = ustalikHaritasi(ch);
    const ustalikSv = seviyeler.get(def.mastery) ?? 0;
    if (ustalikSv < def.requiredMasteryLevel) {
      return hata(ws, 'ERR_REQ_MASTERY',
        { params: { mastery: mdef.name, level: def.requiredMasteryLevel } }, q);
    }

    // Ayni gruptaki bir onceki seviye ogrenilmemisse -> (istemci de) ERR_REQ_MASTERY
    if (def.skillLevel > 1) {
      const onceki = (GRUP.get(def.groupId) ?? []).find(s => s.skillLevel === def.skillLevel - 1);
      if (!onceki || !bilinen.has(onceki.id)) {
        return hata(ws, 'ERR_REQ_MASTERY',
          { params: { mastery: mdef.name, level: def.requiredMasteryLevel } }, q);
      }
    }

    /* Baska gruplardan on kosul beceriler.
       DIKKAT: istemcinin arayuz kapisi burada 'ERR_REQ_SKILL' dondurur ve
       axt() onu `err.ERR_REQ_SKILL` ile cevirir - AMA o kod `err` karesinin
       `code` enum'unda (Sht, 43 kod) YOK. Tel uzerinde gonderilirse istemci
       paketi Zod'da sessizce reddeder ve oyuncu HICBIR SEY gormez.
       Eht listesinde de "on kosul beceri" anlamina gelen bir anahtar yok.
       Bu yuzden semaya uyan genel kod gidiyor; msg sadece tarayici
       konsoluna dusuyor (istemcinin err isleyicisi console.warn ediyor). */
    for (const req of def.requiredSkills ?? []) {
      const varMi = (GRUP.get(req.groupId) ?? [])
        .some(s => s.skillLevel >= Number(req.level) && bilinen.has(s.id));
      if (!varMi) return hata(ws, 'ERR_VALIDATION', { msg: `req_skill:${req.groupId}>=${req.level}` }, q);
    }

    if ((ch.sp | 0) < def.spCost) return hata(ws, 'ERR_NO_SP', {}, q);

    // --- uygula ---
    ch.sp = (ch.sp | 0) - def.spCost;
    if (!Array.isArray(ch.knownSkills)) ch.knownSkills = [];
    ch.knownSkills.push(id);

    frame(ws, 'skills.update', { known: [...ch.knownSkills], sp: ch.sp | 0 }, q);
    ilerlemeKaresi(ws);
    /* tr.json sys.skills.learned = "{skill} ogrenildi (seviye {level})"
       HAM ID: paket @27114703 q5() -> `typeof item.skillId == "string" &&
       (node.skill = o.skillsById.get(item.skillId)?.name ?? item.skillId)`.
       (Ayni gerekce: bkz. mastery_raised yorumu.) */
    frame(ws, 'sys.notice', { key: 'sys.skills.learned', params: { skillId: id, level: def.skillLevel } });
    kalici.beceri(ch, id);
    return true;
  }

  /* =================================================== KALICILIK (vSRO SQL)
   * ctx.web = SRO_WEB_GAME havuzu; shard tablolarina `${SHARD}.dbo._X` ile
   * capraz-veritabani erisiliyor (routes_auth.js ayni yolu kullaniyor,
   * canli olarak dogrulandi).
   *
   *   _Char.Strength / .Intellect / .RemainStatPoint / .RemainSkillPoint
   *   _CharSkillMastery(CharID, MasteryID, Level)
   *   _CharSkill(CharID, SkillID, Enable)
   *
   * referans oyun kimlikleri metin ("bicheon", "sword_smash_a_1"), vSRO kimlikleri
   * sayi. Esleme UYDURULMUYOR, _RefSkill'den TURETILIYOR:
   *   Basic_Group == 'SKILL_CH_<GROUPID>' | 'SKILL_EU_<GROUPID>' | 'SKILL_<GROUPID>'
   *   ve Basic_Level == skillLevel        -> 3256/3256 beceri eslesti
   *   ustalik kimligi = o becerilerin ReqCommon_Mastery1 cogunlugu
   *   -> bicheon 257, heuksal 258, pacheon 259, cold 273, lightning 274,
   *      fire 275, force 276, warrior 513, wizard 514, rogue 515,
   *      warlock 516, bard 517, cleric 518   (hepsi tek adayli)
   */
  let HARITA = null;        // { beceri: Map(oyunId -> [vsroId]), ustalik: Map(id -> vsroId), ters* }
  let haritaSozu = null;

  async function haritaKur() {
    if (HARITA) return HARITA;
    if (haritaSozu) return haritaSozu;
    if (!web) return null;
    haritaSozu = (async () => {
      const r = await web.request().query(
        `SELECT ID, Basic_Group, Basic_Level, ReqCommon_Mastery1
           FROM ${SHARD}.dbo._RefSkill WHERE Service = 1`);
      const grupIndeks = new Map();
      for (const row of r.recordset) {
        const g = String(row.Basic_Group ?? '').trim().toUpperCase();
        if (!g) continue;
        if (!grupIndeks.has(g)) grupIndeks.set(g, []);
        grupIndeks.get(g).push(row);
      }
      const beceri = new Map(), tersBeceri = new Map();
      const sayim = new Map();                       // oyunMastery -> Map(vsroId -> adet)
      for (const s of BECERI.values()) {
        const g = s.groupId.toUpperCase();
        let satirlar = null;
        for (const aday of [`SKILL_CH_${g}`, `SKILL_EU_${g}`, `SKILL_${g}`]) {
          const liste = grupIndeks.get(aday);
          if (!liste) continue;
          const f = liste.filter(x => Number(x.Basic_Level) === s.skillLevel);
          if (f.length) { satirlar = f; break; }
        }
        if (!satirlar) continue;
        const idler = satirlar.map(x => Number(x.ID));
        beceri.set(s.id, idler);
        for (const vid of idler) if (!tersBeceri.has(vid)) tersBeceri.set(vid, s.id);
        if (!sayim.has(s.mastery)) sayim.set(s.mastery, new Map());
        const c = sayim.get(s.mastery);
        for (const x of satirlar) {
          const mid = Number(x.ReqCommon_Mastery1);
          if (mid > 0) c.set(mid, (c.get(mid) ?? 0) + 1);
        }
      }
      const ustalik = new Map(), tersUstalik = new Map();
      for (const [jid, c] of sayim) {
        let enIyi = null, enCok = -1;
        for (const [vid, n] of c) if (n > enCok) { enCok = n; enIyi = vid; }
        if (enIyi !== null) { ustalik.set(jid, enIyi); tersUstalik.set(enIyi, jid); }
      }
      HARITA = { beceri, tersBeceri, ustalik, tersUstalik };
      yaz(`vSRO esleme: ${beceri.size}/${BECERI.size} beceri, ${ustalik.size}/${USTALIK.size} ustalik`);
      return HARITA;
    })().catch(e => {
      yaz('vSRO esleme kurulamadi:', String(e.message).slice(0, 120));
      haritaSozu = null;
      return null;
    });
    return haritaSozu;
  }

  /* ------------------------------------------------------- YAZMA KUYRUGU
   * NEDEN: kalici.* cagrilari ATES-ET-UNUT idi ve mssql havuzu her istegi
   * FARKLI bir baglantida calistirir. Iki hizli `mastery.raise` (ya da
   * yazma bitmeden yapilan bir yeniden giris) ayni satira YARIS eden sorgular
   * uretiyordu:
   *   a) _CharSkillMastery "UPDATE; IF @@ROWCOUNT=0 INSERT" kalibi ATOMIK
   *      DEGILDIR - iki es zamanli cagri ikisinde de ROWCOUNT=0 gorup ayni
   *      (CharID, MasteryID) icin IKI satir insert edebilir,
   *   b) _Char.RemainSkillPoint iki farkli anlik `ch.sp` degeriyle yazilinca
   *      GERI GIDEBILIR (eski deger sonra biterse SP geri gelir).
   * Cozum sistem_gorev.js'teki kalibin aynisi: her karakterin yazmalari TEK
   * bir zincirde sirayla kosar ve yukle() okumadan once o zinciri bekler.
   */
  const yazmaKuyrugu = new Map();          // charId -> Promise
  function kuyrukla(charId, isFn, etiket) {
    const k = String(charId);
    const onceki = yazmaKuyrugu.get(k) ?? Promise.resolve();
    const p = onceki.then(isFn).catch(e => yaz(`${etiket}:`, String(e.message).slice(0, 120)));
    yazmaKuyrugu.set(k, p);
    p.then(() => { if (yazmaKuyrugu.get(k) === p) yazmaKuyrugu.delete(k); });
    return p;
  }
  /** Bir karakterin ucustaki TUM yazmalari bitene kadar bekler. */
  function bekleyenYazmalar(charId) {
    const p = yazmaKuyrugu.get(String(charId));
    return p ? p.catch(() => {}) : Promise.resolve();
  }

  /** _CharSkillMastery.Level tinyint (canli sema dokumuyle dogrulandi):
   *  0..255 disi bir deger SESSIZCE sarardi. Ustalik tavani zaten 110'dur,
   *  yine de kirpiyoruz - sessiz veri bozulmasi yerine gorunur tavan. */
  const tinyint = (n) => Math.max(0, Math.min(255, Math.round(Number(n) || 0)));

  const kalici = {
    stat(ch) {
      if (!web) return;
      kuyrukla(ch.id, () => web.request()
        .input('c', Number(ch.id)).input('s', ch.str | 0)
        .input('i', ch.int | 0).input('p', ch.statPoints | 0)
        .query(`UPDATE ${SHARD}.dbo._Char
                   SET Strength = @s, Intellect = @i, RemainStatPoint = @p
                 WHERE CharID = @c`), 'stat kaydedilemedi');
    },

    ustalik(ch, masteryId, seviye) {
      if (!web) return;
      kuyrukla(ch.id, async () => {
        const h = await haritaKur();
        const vid = h?.ustalik.get(masteryId);
        if (!vid) { yaz('ustalik vSRO karsiligi yok:', masteryId); return; }
        const q = web.request()
          .input('c', Number(ch.id)).input('m', vid)
          .input('l', tinyint(seviye)).input('sp', ch.sp | 0);
        await q.query(`
          UPDATE ${SHARD}.dbo._CharSkillMastery SET Level = @l
            WHERE CharID = @c AND MasteryID = @m;
          IF @@ROWCOUNT = 0
            INSERT INTO ${SHARD}.dbo._CharSkillMastery (CharID, MasteryID, Level)
            VALUES (@c, @m, @l);
          UPDATE ${SHARD}.dbo._Char SET RemainSkillPoint = @sp WHERE CharID = @c;`);
      }, 'ustalik kaydedilemedi');
    },

    beceri(ch, skillId) {
      if (!web) return;
      kuyrukla(ch.id, async () => {
        const h = await haritaKur();
        const idler = h?.beceri.get(skillId);
        if (!idler?.length) { yaz('beceri vSRO karsiligi yok:', skillId); return; }
        /* Zincir beceriler (SKILL_..._CHAIN_A_1S/2S/3S) tek referans oyun kimligine
           BIRDEN COK vSRO satiri dusuruyor; hepsi yaziliyor. */
        for (const vid of idler) {
          await web.request().input('c', Number(ch.id)).input('s', vid).query(`
            IF NOT EXISTS (SELECT 1 FROM ${SHARD}.dbo._CharSkill
                            WHERE CharID = @c AND SkillID = @s)
              INSERT INTO ${SHARD}.dbo._CharSkill (CharID, SkillID, Enable)
              VALUES (@c, @s, 1);`);
        }
        await web.request().input('c', Number(ch.id)).input('sp', ch.sp | 0)
          .query(`UPDATE ${SHARD}.dbo._Char SET RemainSkillPoint = @sp WHERE CharID = @c`);
      }, 'beceri kaydedilemedi');
    },

    /** Tek becerinin vSRO satir(lar)ini siler (sifirlama yolu - bkz. esitle). */
    beceriSil(ch, skillId) {
      if (!web) return;
      kuyrukla(ch.id, async () => {
        const h = await haritaKur();
        for (const vid of h?.beceri.get(skillId) ?? []) {
          await web.request().input('c', Number(ch.id)).input('s', vid)
            .query(`DELETE FROM ${SHARD}.dbo._CharSkill WHERE CharID=@c AND SkillID=@s`);
        }
      }, 'beceri silinemedi');
    },

    /** Tek ustaligin vSRO satirini siler (sifirlama yolu - bkz. esitle). */
    ustalikSil(ch, masteryId) {
      if (!web) return;
      kuyrukla(ch.id, async () => {
        const h = await haritaKur();
        const vid = h?.ustalik.get(masteryId);
        if (!vid) return;
        await web.request().input('c', Number(ch.id)).input('m', vid)
          .query(`DELETE FROM ${SHARD}.dbo._CharSkillMastery WHERE CharID=@c AND MasteryID=@m`);
      }, 'ustalik silinemedi');
    },
  };

  /**
   * SIFIRLAMA SONRASI ESITLEME - vSRO satirlarini BELLEKTEKI ch'ye esitler.
   *
   * NEDEN VAR: SP/ustalik SIFIRLAMA yollari (sistem_gelistirme.js item.reset /
   * stat sifirlama parsomeni) ch.knownSkills ve ch.masteries dizilerini
   * BELLEKTE bosaltiyor, ama _CharSkill / _CharSkillMastery satirlari yerinde
   * kaliyordu. Bir sonraki giriste yukle() o satirlari GERI OKUYOR ve silinen
   * beceriler SP IADE EDILMIS halde geri geliyor - yani her sifirlamada bedava
   * SP. `esitle(ch)` bu deligi tek cagriyla kapatir; cagiran tarafin hangi
   * becerinin silindigini bilmesine gerek yoktur.
   *
   * YABANCI SATIRLARA DOKUNMAZ: referans oyun katalogunda karsiligi olmayan vSRO
   * satirlari (SKILL_PUNCH_01 gibi baslangic becerileri) atlanir - onlari
   * silmek vSRO istemcisini/araclarini bozardi.
   */
  function esitle(ch) {
    if (!web || !ch?.id) return Promise.resolve(false);
    return kuyrukla(ch.id, async () => {
      const h = await haritaKur();
      if (!h) return;
      const kalsin = new Set();
      for (const jid of bilinenSet(ch)) for (const vid of h.beceri.get(jid) ?? []) kalsin.add(vid);
      const mevcut = await web.request().input('c', Number(ch.id))
        .query(`SELECT SkillID FROM ${SHARD}.dbo._CharSkill WHERE CharID=@c`);
      for (const row of mevcut.recordset) {
        const vid = Number(row.SkillID);
        if (!h.tersBeceri.has(vid)) continue;      // yabanci satir - dokunma
        if (kalsin.has(vid)) continue;
        await web.request().input('c', Number(ch.id)).input('s', vid)
          .query(`DELETE FROM ${SHARD}.dbo._CharSkill WHERE CharID=@c AND SkillID=@s`);
      }
      const um = ustalikHaritasi(ch);
      const mevcutU = await web.request().input('c', Number(ch.id))
        .query(`SELECT MasteryID, Level FROM ${SHARD}.dbo._CharSkillMastery WHERE CharID=@c`);
      for (const row of mevcutU.recordset) {
        const jid = h.tersUstalik.get(Number(row.MasteryID));
        if (!jid) continue;                        // yabanci satir - dokunma
        const hedef = tinyint(um.get(jid) ?? 0);
        if (hedef === Number(row.Level)) continue;
        if (hedef === 0) {
          await web.request().input('c', Number(ch.id)).input('m', Number(row.MasteryID))
            .query(`DELETE FROM ${SHARD}.dbo._CharSkillMastery WHERE CharID=@c AND MasteryID=@m`);
        } else {
          await web.request().input('c', Number(ch.id)).input('m', Number(row.MasteryID)).input('l', hedef)
            .query(`UPDATE ${SHARD}.dbo._CharSkillMastery SET Level=@l WHERE CharID=@c AND MasteryID=@m`);
        }
      }
      await web.request().input('c', Number(ch.id)).input('sp', ch.sp | 0)
        .query(`UPDATE ${SHARD}.dbo._Char SET RemainSkillPoint = @sp WHERE CharID = @c`);
    }, 'esitleme basarisiz');
  }

  /**
   * Karakterin ustalik/beceri kayitlarini vSRO'dan okuyup ch uzerine kurar.
   * Girişte (zone.init ONCESI) bir kez cagrilmali - yoksa self.masteries ve
   * self.knownSkills her oturum bos baslar.
   */
  async function yukle(ch) {
    ch.masteries ??= [];
    ch.knownSkills ??= [];
    if (!web || !ch?.id) return ch;
    try {
      /* YARIS KAPISI: onceki oturumun ucustaki yazmalari bitmeden okursak
         (sayfa yenileme bunu sik tetikler) yeni ogrenilen beceri/ustalik
         henuz satirda olmaz ve bellekten de SILINIR - oyuncu SP'sini
         harcamis ama beceriyi kaybetmis olur. Ayni tuzagi sistem_gorev.js
         `bekleyenYazmalar` ile cozuyor. */
      await bekleyenYazmalar(ch.id);
      const h = await haritaKur();
      if (!h) return ch;
      const um = await web.request().input('c', Number(ch.id)).query(
        `SELECT MasteryID, Level FROM ${SHARD}.dbo._CharSkillMastery
          WHERE CharID = @c AND Level > 0`);
      const bm = await web.request().input('c', Number(ch.id)).query(
        `SELECT SkillID FROM ${SHARD}.dbo._CharSkill WHERE CharID = @c AND Enable = 1`);
      const ust = [];
      for (const row of um.recordset) {
        const jid = h.tersUstalik.get(Number(row.MasteryID));
        if (jid) ust.push({ masteryId: jid, level: Number(row.Level) });
      }
      const bec = [];
      for (const row of bm.recordset) {
        /* vSRO tarafinda referans oyun karsiligi olmayan satirlar da var
           (SKILL_PUNCH_01 gibi baslangic satirlari) - onlar atlanir. */
        const jid = h.tersBeceri.get(Number(row.SkillID));
        if (jid && !bec.includes(jid)) bec.push(jid);
      }
      ch.masteries = ust;
      ch.knownSkills = bec;
    } catch (e) {
      yaz('yukleme basarisiz:', String(e.message).slice(0, 120));
    }
    return ch;
  }

  /**
   * SQL havuzunu SONRADAN takar. server.js sistem modullerini initSql()'den
   * once kurdugu icin ctx.web null geliyor; havuz acilinca bu cagrilmazsa
   * sistem calisir ama SADECE bellekte kalir (yeniden baslatinca ustalik ve
   * beceriler kaybolur). Havuz degisirse vSRO esleme onbellegi sifirlanir.
   */
  function webBagla(havuz /* , sqlMod - bu modul tip belirtmiyor, gerek yok */) {
    web = havuz ?? null;
    HARITA = null; haritaSozu = null;
    yaz(web ? 'SQL havuzu baglandi - kalicilik acik' : 'SQL havuzu ayrildi - yalniz bellek');
    return !!web;
  }

  /** selfPayload icin hazir parca: { masteries, knownSkills }. */
  function kendiParcasi(ch) {
    return {
      masteries: (Array.isArray(ch.masteries) ? ch.masteries : [])
        .filter(u => u && typeof u.masteryId === 'string' && Number(u.level) >= 1)
        .map(u => ({ masteryId: u.masteryId, level: Number(u.level) })),
      knownSkills: Array.isArray(ch.knownSkills) ? [...ch.knownSkills] : [],
    };
  }

  // ------------------------------------------------------------- yonlendirici
  function mesaj(ws, t, d, q) {
    if (!ws?.char) return false;
    switch (t) {
      case 'stats.allocate': return statDagit(ws, d ?? {}, q);
      case 'mastery.raise':  return ustalikYukselt(ws, d ?? {}, q);
      case 'skill.learn':    return beceriOgren(ws, d ?? {}, q);
      default: return false;
    }
  }

  return {
    mesaj,
    yukle,
    kendiParcasi,
    webBagla,                  // SQL havuzunu sonradan takmak icin
    /* SIFIRLAMA YOLLARI ICIN (sistem_gelistirme.js cagirir):
         esitle(ch)              - bellekteki ch'ye gore _CharSkill/_CharSkillMastery temizler
         beceriSil / ustalikSil  - tek kayit silme (kalici uzerinden) */
    esitle,
    beceriSil: (ch, skillId) => kalici.beceriSil?.(ch, skillId),
    ustalikSil: (ch, masteryId) => kalici.ustalikSil?.(ch, masteryId),
    bekleyenYazmalar,          // kapanista/testte yazmalarin bitmesini beklemek icin
    haritaKur,                 // teshis/test icin
    // teshis: yuklenen veri buyuklukleri
    ozet: () => ({ ustalik: USTALIK.size, beceri: BECERI.size, grup: GRUP.size,
                   maliyetTablosu: MALIYET ? Object.keys(MALIYET).length : 0,
                   maxSeviye: MAX_SEVIYE, carpan: TOPLAM_CARPAN }),
  };
}

/* ========================================================== BAGLAMA NOTU ====
 *
 * ctx'den KULLANILANLAR:
 *   frame(ws, t, d, q)  - tum kareler
 *   log(...)            - teshis
 *   GCFG                - GCFG.masteryTotalCapPerLevel {chinese:3, european:2}
 *   combat              - combat.progress.{spCostToLevel, xpToNext, maxLevel,
 *                         spExpPerSpPoint}  (combat.js zaten progress.json'u
 *                         normalize edip tutuyor)
 *   derived(ch)         - stats.update icindeki `derived` alani (rht semasi)
 *   web, SHARD          - kalicilik (SRO_WEB_GAME havuzundan
 *                         `${SHARD}.dbo._X` capraz-DB)
 * KULLANILMAYANLAR: world, broadcast, ITEMSTATS, zoneGroundY,
 *   yurunebilirNokta, envanterPayload  (bu sistemin isi degil)
 *
 * ISLENEN MESAJLAR (digerlerinde false doner):
 *   stats.allocate (32), mastery.raise (33), skill.learn (34)
 *
 * GONDERILEN KARELER:
 *   stats.update (146), mastery.update (147), skills.update (148),
 *   progress.update (144), sys.notice (195), err (240)
 *
 * HATA KODU TUZAGI (test bunu yakaladi):
 *   Istemcinin ARAYUZ kapisi ERR_REQ_SKILL / ERR_SKILL_DISABLED /
 *   ERR_SKILL_GATED kodlarini kullanir ve tr.json'da karsiliklari da vardir,
 *   AMA `err` karesinin `code` enum'u (Sht, 43 kod) bu ucunu ICERMEZ.
 *   Tel uzerinde gonderilirse istemci paketi Zod'da SESSIZCE atar.
 *   Cozum: disabled/gated -> code ERR_VALIDATION + key err.skill.disabled /
 *   err.skill.experiment_gated (ikisi de Eht listesinde ve tr.json'da VAR);
 *   on kosul beceri -> code ERR_VALIDATION (uygun bir Eht anahtari yok).
 *   Ayrica ERR_NO_STAT_POINTS Sht'de VAR ama tr.json'da `err.ERR_NO_STAT_POINTS`
 *   YOK - istemci o satiri sohbete yazmaz (sadece console.warn). Uydurma
 *   anahtar eklemedim; kod semaya uygun oldugu icin kare gecerli kaliyor.
 *
 * SERVER.JS'E BAGLAMA (ana oturum yapacak):
 *   YONLENDIRME ZATEN VAR: server.js'teki genel SISTEM_ADLARI dongusu
 *   'stat-ustalik' adini iceriyor, modulu kur(ctx) ile kuruyor ve
 *   `for (const s of SISTEMLER) if (s.ornek.mesaj(ws, t, d)) return;`
 *   satiriyla mesajlari getiriyor. (Bu dongu q'yu GECIRMIYOR; bu uc
 *   mesajda istemci zaten q gondermedigi icin sorun degil - istersen
 *   `s.ornek.mesaj(ws, t, d, q)` yapilabilir.)
 *
 * UC EK BAGLAMA GEREKIYOR (yoksa sistem calisir ama giriste sifirlanmis
 * gorunur / kalicilik olmaz):
 *   1) auth isleyicisinde, zone.init YOLLANMADAN once:
 *          await STATUST.yukle(ch);
 *      -> ch.masteries / ch.knownSkills vSRO'dan dolar.
 *   2) selfPayload() icindeki SABIT `masteries: [], knownSkills: []`
 *      satirinin yerine:
 *          ...STATUST.kendiParcasi(ch),
 *   3) initSql() sistem modullerinden SONRA calisiyor, o yuzden ctx.web
 *      null geliyor. Havuz acilinca:
 *          STATUST.webBagla(webPool);          // SRO_WEB_GAME havuzu
 *      cagrilmazsa hicbir sey COKMEZ, sadece kalicilik sessizce kapali kalir.
 *      (server.js'e dokunmadim; bu uc degisiklik ana oturumun isi.)
 *
 * KALICILIK:
 *   _Char.Strength / .Intellect / .RemainStatPoint      <- stats.allocate
 *   _Char.RemainSkillPoint                              <- mastery/skill
 *   _CharSkillMastery(CharID, MasteryID, Level)         <- mastery.raise
 *   _CharSkill(CharID, SkillID, Enable=1)               <- skill.learn
 *   Metin->sayi eslemesi _RefSkill'den TURETILIR (haritaKur), gomulu
 *   sabit tablo YOK. web null ise sistem yalnizca bellekte calisir.
 */
