/**
 * GOREV SISTEMI  (quest.accept / quest.abandon / quest.claim)
 * ==========================================================
 *
 * Bu modul server.js/gameloop.js/combat.js/world.js dosyalarina DOKUNMAZ.
 * Baglama sozlesmesi:  kur(ctx) -> { mesaj, sayacArtir, girisKurulumu, ... }
 *
 * ---------------------------------------------------------------------------
 * ISTEMCI SEMALARI (index-BUMMQVRB.js icinde T$(ad, opcode, zodSema, hizSinifi))
 * ---------------------------------------------------------------------------
 * c2s (ofset 25615093, hiz sinifi `quest`):
 *   T$(`quest.accept`,  116, X({ questId: J() }), `quest`)
 *   T$(`quest.abandon`, 117, X({ questId: J() }), `quest`)
 *   T$(`quest.claim`,   118, X({ questId: J() }), `quest`)
 *   ( J() = z.string(), X() = z.object() )
 *
 * s2c (ofset 25629500 civari):
 *   Iht = QuestDef = X({
 *     id: J(), title: J(), description: J(),
 *     mobId: J(), mobName: J(), mobLevel: Y().int().optional(),
 *     count: Y().int(), minLevel: Y().int(), maxLevel: Y().int(),
 *     rewards: X({ gold?: int, xp?: int, sp?: int,
 *                  items?: [{ itemDefId: J(), name: J(), qty: int }] }),
 *     repeat: VJ([ {type:'none'}, {type:'unlimited'}, {type:'cooldown', hours: Y()} ])
 *   })
 *   Lht = QuestState = X({ def: Iht, units: int, targetUnits: int,
 *                          state: enum['active','completed','claimed'],
 *                          cooldownUntil: Y().optional() })
 *   T$(`quest.catalog`,  183, X({ available: BJ(Iht) }))
 *   T$(`quest.state`,    184, X({ mine: BJ(Lht) }))
 *   T$(`quest.progress`, 185, X({ questId: J(), units: int,
 *                                 state: enum['active','completed'] }))
 *
 * YAZIM (authoring) semasi - ofset 8719700 - data/quest-defs.json bunu kullanir.
 *
 * ---------------------------------------------------------------------------
 * "units" NEDIR?  (uydurma degil - istemci koduyla dogrulandi)
 * ---------------------------------------------------------------------------
 * Istemcide  eRt = 720720  ve
 *   rRt(units, count) -> _2(`ui.quest.progress`, { kills: units / eRt, count })
 * yani ekranda gorunen OLDURME sayisi = units / 720720, ilerleme cubugu ise
 * units / targetUnits. 720720 = LCM(1..16), yani parti payini KESIRSIZ bolmek
 * icin secilmis bir payda (partyMaxSize=8, ltpMaxMembers=4 -> hepsi boler).
 * Bu yuzden:  targetUnits = count * 720720,  bir oldurme = 720720 / partiKisi.
 *
 * ---------------------------------------------------------------------------
 * KALICILIK: SRO_VT_SHARD.dbo._CharQuest  (gercek kolonlar - sys.columns'tan)
 * ---------------------------------------------------------------------------
 *   CharID int | QuestID int | Status tinyint | AchievementCount smallint
 *   StartTime smalldatetime | EndTime smalldatetime
 *   QuestData1 bigint | QuestData2 bigint          (PK: CharID+QuestID)
 *
 * referans oyun gorev id'si METIN ("chain_01_mangyang"), _CharQuest.QuestID ise INT.
 * Donusum: FNV-1a 32 bit -> 31 bite maskelenip [100000, 2^31-1] araligina
 * tasinir. Boylece vSRO'nun kendi baslangic gorev satirlari (QuestID 1 ve 397,
 * DB'de mevcut) ile CAKISMAZ. Yukleme sirasinda 81 id icin carpisma denetlenir.
 *
 *   Status  = durum kodu | 0x10        (0x10 = "en az bir kez odul alindi")
 *             durum kodu: 1 active, 2 completed, 3 claimed
 *   AchievementCount = oldurme sayisi  (units / 720720, smallint'e kirpilir)
 *   QuestData1 = units                 (tam deger, bigint)
 *   QuestData2 = cooldownUntil (epoch ms, 0 = yok)
 *   StartTime  = gorevin alindigi an   EndTime = tamamlanma/odul ani
 *
 * ---------------------------------------------------------------------------
 * BILEREK YAPILMAYANLAR (uydurmamak icin)
 * ---------------------------------------------------------------------------
 * - Gorev gunlugu SINIRI: ne game-config.json'da ne pakette bir sayi var.
 *   GCFG.questLogMax varsa uygulanir, yoksa SINIR YOK ve sys.quest.log_full
 *   hic gonderilmez (aksi halde {max} icin sayi uydurmak gerekirdi).
 * - Odul XP'sine GCFG.xpRate UYGULANMAZ: katalogda istemciye gosterilen sayi
 *   neyse oyuncuya verilen de odur (aksi halde ekrandaki sayi yalan olurdu).
 *
 * ---------------------------------------------------------------------------
 * ALTIN TAVANI  (plan md.59a - eskiden "kaynak yok" diye ATLANIYORDU)
 * ---------------------------------------------------------------------------
 * game-config.json'da goldCap ANAHTARI YOK, ama PROTOKOLUN kendisi altin
 * miktarini dort ayri yerde ayni tavanla siniryor:
 *     exch.withdrawGold  (100) amount: Y().int().min(1).max(2e9)   @25613560
 *     bank.depositGold   (105) amount: Y().int().min(1).max(2e9)   @25614001
 *     bank.withdrawGold  (106) amount: Y().int().min(1).max(2e9)   @25614100
 *     exch.place         ( 98) price:  Y().int().min(100).max(2e9) @25613195
 * Kardes modul sistem_ticaret.js AYNI gerekceyle ALTIN_TAVANI = 2e9
 * kullaniyor (sistem_ticaret.js:192) - iki modul ayni sayida kalsin diye
 * burada da o deger kullaniliyor. Tavan asilirsa gorev HARCANMAZ ve
 * sys.quest.gold_cap gonderilir ("Bu kadar altin tasiyamazsin - biraz harca
 * ve yeniden al."); anahtar hem s2c sys.notice enum'unda (@25604493) hem
 * tr.json'da GERCEKTEN var.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BURASI = path.dirname(fileURLToPath(import.meta.url));

const BIRIM = 720720;                 // istemci: eRt = 720720

/** Altin tavani - bkz. basliktaki "ALTIN TAVANI" blogu (protokol max(2e9)). */
const ALTIN_TAVANI = 2_000_000_000;
const DURUM_KODU = { active: 1, completed: 2, claimed: 3 };
const KOD_DURUM = { 1: 'active', 2: 'completed', 3: 'claimed' };
const ALINDI_BIT = 0x10;
const SMALLINT_MAX = 32767;
const ILERLEME_YAZ_MS = 15_000;       // kill sayaci icin DB yazma kisitlamasi

/** vSRO baslangic gorevleriyle (QuestID 1, 397) cakismamak icin alt taban. */
const ID_TABAN = 100_000;

/** Metin gorev id'sini _CharQuest.QuestID (int) degerine cevirir. FNV-1a 32 bit. */
function sayisalId(metin) {
  let h = 0x811c9dc5;
  for (let i = 0; i < metin.length; i++) {
    h ^= metin.charCodeAt(i) & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return ID_TABAN + ((h & 0x7fffffff) % (0x7fffffff - ID_TABAN));
}

/**
 * MODUL KAPSAMINDA YASAYAN ORNEK - yeniden kurulumda durum devri.
 *
 * NEDEN: server.js `sistemleriKur()` admin panelinden bir ayar degisince
 * SISTEMLER dizisini bosaltip TUM modulleri yeniden kuruyor (server.js:1337).
 * Bu modulun oturum durumu (`oturumlar` = charId -> gorev kayitlari,
 * `yuklendi` = DB'den okunanlar, `yazmaKuyrugu` = ucustaki SQL yazimlari)
 * kur() kapsaminda yasadigi icin eski ornekle birlikte CÖPE gidiyordu:
 *   - ucustaki bir _CharQuest yazimi sahipsiz kalir (Promise yasar ama
 *     `bekleyenYazmalar` artik onu goremez -> yeniden giriste ESKI satir
 *     okunup son oldurmeler geri alinabilir),
 *   - `yuklendi` sifirlandigi icin bir sonraki zone.ready ayni karakteri
 *     yeniden okur ve o an bellekteki (henuz yazilmamis) ilerlemeyi EZER.
 * ESM modul onbellegi bu degiskeni yeniden kurmalar arasinda yasatir.
 */
let ONCEKI_ORNEK = null;

export function kur(ctx) {
  /* Onceki ornegi kapat ve devralinacak durumu al (bkz. ONCEKI_ORNEK notu).
     DEVIR KAPISI: durum yalnizca AYNI CALISAN DUNYA icin devredilir.
     server.js `sistemCtx()` her cagrida ayni `world: WORLDSIM` nesnesini
     verir (server.js:1287 `world: WORLDSIM`), yani yeniden kurulum ayni
     oturumdur. Birim testleri ise her kur() icin TAZE bir sahte world
     veriyor - orada devir OLMAMALI, aksi halde testler birbirinin durumunu
     gorurdu. Zamanlayici her durumda durdurulur (asil sizinti o). */
  const devir = (() => {
    if (!ONCEKI_ORNEK) return null;
    try { return ONCEKI_ORNEK._devret(ctx?.world ?? null); }
    catch { return null; }
    finally { ONCEKI_ORNEK = null; }
  })();

  const {
    world, frame, log = () => {}, GCFG = {}, ITEMSTATS = new Map(),
    envanterPayload = null, web: ctxWeb = null, SHARD = 'SRO_VT_SHARD',
    derived = null, combat = null,
    /* madde 59b: seviye atlama efekti CEVREDEKILERE de gitmeli - gameloop.js
       #olum ile ayni kalip (frame + broadcast). ctx'te yoksa yalniz oyuncuya
       gonderilir, hicbir sey cokmez. */
    broadcast = null,
    /* fark #102: gorev oldurme sayaci parti uyelerine de islemeli. Uygun uye
       listesini sistem_parti.paylasimHesapla() uretiyor; ona ada gore
       erisiyoruz (server.js sistemCtx -> sistemOrnegi). */
    sistemOrnegi = null,
  } = ctx ?? {};

  /* Havuz kur() aninda null olabilir (server.js modulleri initSql'den ONCE
     kuruyor); webBagla() ile sonradan takilir - sistem_stat-ustalik.js ve
     sistem_arayuz-durumu.js ile ayni sozlesme (server.js:405). */
  let web = ctxWeb;

  const yaz = (...a) => log('[gorev]', ...a);

  /* DENETIM DUZELTMESI: frame() olmadan tek bir kare bile gonderilemez.
     Eskiden ilk mesajda TypeError'a dusuyordu ve server.js'in try/catch'i
     bunu her mesajda sessizce yutuyordu; artik BAGLAMA aninda patlar. */
  if (typeof frame !== 'function') throw new Error('sistem_gorev: ctx.frame gerekli');

  // ------------------------------------------------------------- tanimlar
  /** id -> yazim tanimi (data/quest-defs.json). */
  const tanimlar = new Map();
  /** sayisalId -> id  (DB'den geri okuma icin). */
  const tersId = new Map();

  function tanimlariYukle(ham) {
    tanimlar.clear(); tersId.clear();
    const liste = Array.isArray(ham?.quests) ? ham.quests : Array.isArray(ham) ? ham : [];
    let atlanan = 0;
    for (const q of liste) {
      if (!q || typeof q.id !== 'string' || !/^[a-z0-9_]+$/.test(q.id)) { atlanan++; continue; }
      // Yazim semasinin ZORUNLU sayisal alanlari - biri eksikse gorev yayinlanamaz.
      const say = q.objective?.count, mob = q.objective?.mobId;
      if (q.objective?.type !== 'hunt' || typeof mob !== 'string' || !Number.isInteger(say) || say < 1
          || !Number.isInteger(q.minLevel) || !Number.isInteger(q.maxLevel) || q.maxLevel < q.minLevel) {
        atlanan++; continue;
      }
      const r = q.rewards ?? {};
      const oduluVar = (r.gold ?? 0) > 0 || (r.xp ?? 0) > 0 || (r.sp ?? 0) > 0 || (r.items?.length ?? 0) > 0;
      if (!oduluVar) { atlanan++; continue; }   // sema refine: "quest must grant at least one reward"

      const nid = sayisalId(q.id);
      if (tersId.has(nid)) { yaz(`ID CARPISMASI: ${q.id} <-> ${tersId.get(nid)} (QuestID ${nid}) - atlandi`); atlanan++; continue; }
      tanimlar.set(q.id, {
        id: q.id,
        title: typeof q.title === 'string' ? q.title : '',
        description: typeof q.description === 'string' ? q.description : '',
        minLevel: q.minLevel, maxLevel: q.maxLevel,
        race: q.race ?? 'all',
        objective: { type: 'hunt', mobId: mob, count: say, alsoCounts: Array.isArray(q.objective.alsoCounts) ? q.objective.alsoCounts : [] },
        rewards: {
          gold: Number.isInteger(r.gold) ? r.gold : undefined,
          xp: Number.isInteger(r.xp) ? r.xp : undefined,
          sp: Number.isInteger(r.sp) ? r.sp : undefined,
          items: Array.isArray(r.items) ? r.items.filter(i => i && typeof i.itemDefId === 'string' && Number.isInteger(i.qty) && i.qty > 0) : undefined,
        },
        repeat: gecerliRepeat(q.repeat),
        requiresQuest: typeof q.requiresQuest === 'string' ? q.requiresQuest : null,
        enabled: q.enabled !== false,
        nid,
      });
      tersId.set(nid, q.id);
    }
    yaz(`${tanimlar.size} gorev tanimi yuklendi${atlanan ? `, ${atlanan} eksik/gecersiz tanim atlandi` : ''}`);
  }

  function gecerliRepeat(r) {
    if (r?.type === 'unlimited') return { type: 'unlimited' };
    if (r?.type === 'cooldown' && Number(r.hours) > 0) return { type: 'cooldown', hours: Number(r.hours) };
    return { type: 'none' };   // sema varsayilani
  }

  // ------------------------------------------------------------ oturum durumu
  /** charId(string) -> Map(questId -> { durum, units, alindi, baslangic, bitis, cooldownUntil, sonYazma }) */
  const oturumlar = devir?.oturumlar ?? new Map();
  /** charId -> true : DB'den bir kez yuklendi */
  const yuklendi = devir?.yuklendi ?? new Set();
  /** charId(string) -> ws : acik soket. `cikis` kancasi cagrilmasa da
   *  kapanmis soketleri BIZ fark edelim diye tutulur (bkz. bakimTik). */
  const soketler = devir?.soketler ?? new Map();

  const kayitlar = (ch) => {
    const k = String(ch.id);
    let m = oturumlar.get(k);
    if (!m) { m = new Map(); oturumlar.set(k, m); }
    return m;
  };

  // ------------------------------------------------------------------- SQL
  let sqlMod = null;
  async function sqlAl() {
    if (!sqlMod) sqlMod = (await import('mssql')).default;
    return sqlMod;
  }

  async function dbYukle(charId) {
    if (!web) return null;
    const sql = await sqlAl();
    const r = await web.request()
      .input('c', sql.Int, Number(charId))
      .query(`SELECT QuestID, Status, AchievementCount, StartTime, EndTime, QuestData1, QuestData2
                FROM ${SHARD}.dbo._CharQuest WHERE CharID = @c`);
    return r.recordset;
  }

  async function dbYaz(charId, questId, k) {
    if (!web) return;
    const t = tanimlar.get(questId); if (!t) return;
    const sql = await sqlAl();
    const status = (DURUM_KODU[k.durum] ?? 1) | (k.alindi ? ALINDI_BIT : 0);
    const oldurme = Math.min(SMALLINT_MAX, Math.floor(k.units / BIRIM));
    await web.request()
      .input('c', sql.Int, Number(charId))
      .input('q', sql.Int, t.nid)
      .input('s', sql.TinyInt, status)
      .input('a', sql.SmallInt, oldurme)
      .input('t1', sql.SmallDateTime, new Date(k.baslangic))
      .input('t2', sql.SmallDateTime, new Date(k.bitis || k.baslangic))
      .input('d1', sql.BigInt, String(Math.floor(k.units)))
      .input('d2', sql.BigInt, String(Math.floor(k.cooldownUntil || 0)))
      .query(`UPDATE ${SHARD}.dbo._CharQuest
                 SET Status=@s, AchievementCount=@a, StartTime=@t1, EndTime=@t2,
                     QuestData1=@d1, QuestData2=@d2
               WHERE CharID=@c AND QuestID=@q;
              IF @@ROWCOUNT = 0
                INSERT INTO ${SHARD}.dbo._CharQuest
                  (CharID, QuestID, Status, AchievementCount, StartTime, EndTime, QuestData1, QuestData2)
                VALUES (@c, @q, @s, @a, @t1, @t2, @d1, @d2);`);
    k.sonYazma = Date.now();
  }

  async function dbSil(charId, questId) {
    if (!web) return;
    const t = tanimlar.get(questId); if (!t) return;
    const sql = await sqlAl();
    await web.request()
      .input('c', sql.Int, Number(charId))
      .input('q', sql.Int, t.nid)
      .query(`DELETE FROM ${SHARD}.dbo._CharQuest WHERE CharID=@c AND QuestID=@q`);
  }

  /**
   * Yazmalar (CharID,QuestID) basina SIRAYA girer. Havuz istekleri farkli
   * baglantilarda paralel calistigi icin "kabul" yazmasi bir "ilerleme"
   * yazmasindan SONRA bitip units'i 0'a geri dondurebilirdi.
   * Yazma hatasi oyunu durdurmaz - sadece gunluge duser.
   */
  const yazmaKuyrugu = devir?.yazmaKuyrugu ?? new Map();
  function kuyrukla(anahtar, isFn, etiket) {
    const onceki = yazmaKuyrugu.get(anahtar) ?? Promise.resolve();
    const p = onceki.then(isFn).catch(e => yaz(`${etiket}:`, String(e.message).slice(0, 120)));
    yazmaKuyrugu.set(anahtar, p);
    p.then(() => { if (yazmaKuyrugu.get(anahtar) === p) yazmaKuyrugu.delete(anahtar); });
    return p;
  }
  const yazDene = (charId, questId, k) =>
    kuyrukla(`${charId}:${questId}`, () => dbYaz(charId, questId, k), `_CharQuest yazilamadi (${questId})`);
  const silDene = (charId, questId) =>
    kuyrukla(`${charId}:${questId}`, () => dbSil(charId, questId), `_CharQuest silinemedi (${questId})`);

  /* DENETIM DUZELTMESI: cikis() yazmalari ATES-ET-UNUT baslatir. Oyuncu hemen
     yeniden baglanirsa girisKurulumu ESKI satiri okuyup son oldurmeleri geri
     alabiliyordu (sayfa yenileme bunu sik tetikler). Okumadan once o karaktere
     ait bekleyen TUM yazmalar beklenir. */
  function bekleyenYazmalar(charId) {
    const onek = `${charId}:`;
    const p = [];
    for (const [k, v] of yazmaKuyrugu) if (k.startsWith(onek)) p.push(v);
    return p.length ? Promise.all(p).catch(() => {}) : Promise.resolve();
  }

  // ------------------------------------------------------------ wire bicimleri
  /** Yazim tanimindan istemcinin bekledigi QuestDef (Iht) nesnesi. */
  function defPayload(t) {
    const mob = world?.mobDefs?.get?.(t.objective.mobId) ?? null;
    const odul = {};
    if (t.rewards.gold !== undefined) odul.gold = t.rewards.gold;
    if (t.rewards.xp !== undefined) odul.xp = t.rewards.xp;
    if (t.rewards.sp !== undefined) odul.sp = t.rewards.sp;
    if (t.rewards.items?.length) {
      odul.items = t.rewards.items.map(i => ({
        itemDefId: i.itemDefId,
        name: ITEMSTATS?.get?.(i.itemDefId)?.name ?? i.itemDefId,
        qty: i.qty,
      }));
    }
    const d = {
      id: t.id, title: t.title, description: t.description,
      mobId: t.objective.mobId,
      // mobName/mobLevel mobs.json'dan cozulur (canli yakalamadaki
      // "Mangyang"/1 degerleriyle birebir ayni). Istemci zaten kendi
      // monstersById katalogunu tercih eder; bunlar yedektir.
      mobName: mob?.name ?? t.objective.mobId,
      count: t.objective.count,
      minLevel: t.minLevel, maxLevel: t.maxLevel,
      rewards: odul,
      repeat: t.repeat,
    };
    if (Number.isInteger(mob?.level)) d.mobLevel = mob.level;
    return d;
  }

  const hedefUnits = (t) => t.objective.count * BIRIM;

  function durumPayload(t, k) {
    const p = {
      def: defPayload(t),
      units: Math.floor(k.units),
      targetUnits: hedefUnits(t),
      state: k.durum,
    };
    if (k.cooldownUntil > 0) p.cooldownUntil = k.cooldownUntil;
    return p;
  }

  // ------------------------------------------------------------- kapi kurallari
  function irkUyar(t, ch) {
    return t.race === 'all' || !t.race || t.race === ch.race;
  }

  /** requiresQuest: on kosul gorevin odulunun EN AZ BIR KEZ alinmis olmasi. */
  function onKosulTamam(t, m) {
    if (!t.requiresQuest) return true;
    const k = m.get(t.requiresQuest);
    return !!k && (k.durum === 'claimed' || k.alindi);
  }

  /** Bu gorev su an "Alinabilir" sekmesinde gorunmeli mi? */
  function katalogaGirer(t, ch, m) {
    if (!t.enabled) return false;
    if (!irkUyar(t, ch)) return false;
    const lv = ch.level ?? 1;
    if (lv < t.minLevel || lv > t.maxLevel) return false;
    if (!onKosulTamam(t, m)) return false;
    const k = m.get(t.id);
    if (!k) return true;
    if (k.durum !== 'claimed') return false;             // zaten gunlukte
    if (t.repeat.type === 'none') return false;          // bir kez alinir
    if (t.repeat.type === 'unlimited') return true;
    return Date.now() >= (k.cooldownUntil || 0);         // cooldown
  }

  /** "Gorevlerim" sekmesi: aktif/tamamlanmis + bekleme suresi dolmamis alinmislar. */
  function gunluktekiler(m) {
    const simdi = Date.now();
    const out = [];
    for (const [id, k] of m) {
      const t = tanimlar.get(id);
      if (!t) continue;
      if (k.durum === 'claimed') {
        if (k.cooldownUntil > simdi) out.push(durumPayload(t, k));
        continue;
      }
      out.push(durumPayload(t, k));
    }
    return out;
  }

  const gunlukSayisi = (m) => {
    let n = 0;
    for (const k of m.values()) if (k.durum === 'active' || k.durum === 'completed') n++;
    return n;
  };

  // ------------------------------------------------------------------ kareler
  function katalogGonder(ws) {
    if (!ws?.char) return;
    const m = kayitlar(ws.char);
    const av = [];
    for (const t of tanimlar.values()) if (katalogaGirer(t, ws.char, m)) av.push(defPayload(t));
    frame(ws, 'quest.catalog', { available: av });
  }

  function durumGonder(ws) {
    if (!ws?.char) return;
    frame(ws, 'quest.state', { mine: gunluktekiler(kayitlar(ws.char)) });
  }

  const hata = (ws, code) => frame(ws, 'err', { code });
  const bildir = (ws, key, params) => frame(ws, 'sys.notice', params ? { key, params } : { key });

  // ------------------------------------------------------------------- giris
  /**
   * Oturum acilisinda cagrilir (zone.ready ya da server.js'ten dogrudan).
   * _CharQuest'ten kayitlari okur, sonra quest.catalog + quest.state yollar.
   */
  /**
   * KALICI KAYITLARI ch UZERINE YUKLER - zone.init YOLLANMADAN ONCE.
   *
   * server.js:1590 `modulleriYukle(ch)` her modulun `yukle(ch)` kancasini
   * AWAIT ediyor (server.js:1458, selfPayload'dan once). Eskiden bu modulun
   * tek yukleme yolu SENTETIK `zone.ready` mesajiydi; o mesaj zone.init'ten
   * SONRA geldigi icin gorev listesi giriste kisa sure bos gorunuyordu ve
   * daha kotusu: yukleme UCARKEN gelen bir quest.accept ayni Map'e yazip
   * SELECT sonucu tarafindan ezilebiliyordu.
   *
   * `girisKurulumu(ws)` bu okumayi hala yapabilir - `yuklendi` kumesi ayni
   * karakteri IKINCI kez okumayi engelliyor, yani cift cagri zararsizdir.
   */
  async function yukle(ch) {
    if (!ch?.id) return ch;
    const cid = String(ch.id);
    if (yuklendi.has(cid)) return ch;
    yuklendi.add(cid);
    try {
      await bekleyenYazmalar(cid);      // onceki oturumun yazmalari bitsin
      const satirlar = await dbYukle(cid);
      if (satirlar?.length) {
        const m = kayitlar(ch);
        let ok = 0, bilinmeyen = 0;
        for (const r of satirlar) {
          const qid = tersId.get(Number(r.QuestID));
          if (!qid) { bilinmeyen++; continue; }   // vSRO'nun kendi gorev satirlari
          const durum = KOD_DURUM[Number(r.Status) & 0x0f] ?? 'active';
          m.set(qid, {
            durum,
            units: Number(r.QuestData1) || 0,
            alindi: (Number(r.Status) & ALINDI_BIT) !== 0 || durum === 'claimed',
            baslangic: r.StartTime ? new Date(r.StartTime).getTime() : Date.now(),
            bitis: r.EndTime ? new Date(r.EndTime).getTime() : 0,
            cooldownUntil: Number(r.QuestData2) || 0,
            sonYazma: Date.now(),
          });
          ok++;
        }
        yaz(`${ch.name ?? cid}: ${ok} gorev kaydi yuklendi${bilinmeyen ? `, ${bilinmeyen} yabanci QuestID atlandi` : ''}`);
      }
    } catch (e) {
      /* Okuma patlarsa bir daha denenebilsin: aksi halde `yuklendi` damgasi
         yuzunden bu oturum boyunca gorevler BOS kalirdi ve ilk quest.accept
         DB'deki satirin uzerine yazardi. */
      yuklendi.delete(cid);
      yaz('_CharQuest okunamadi:', String(e.message).slice(0, 140));
    }
    return ch;
  }

  async function girisKurulumu(ws) {
    if (!ws?.char) return;
    const cid = String(ws.char.id);
    /* Soketi kaydet: `cikis(ws)` cekirdekten cagrilmasa bile bakimTik
       kapanmis soketleri gorup son ilerlemeyi diske indirebilsin. */
    soketler.set(cid, ws);
    await yukle(ws.char);
    katalogGonder(ws);
    durumGonder(ws);
  }

  /** Oturum kapanisi: RAM kaydini birak (DB zaten guncel). */
  function cikis(ws) {
    if (!ws?.char) return;
    const cid = String(ws.char.id);
    const m = oturumlar.get(cid);
    if (m) for (const [id, k] of m) if (k.durum === 'active') yazDene(cid, id, k);
    oturumlar.delete(cid);
    yuklendi.delete(cid);
    soketler.delete(cid);
  }

  /* ------------------------------------------------------------- bakim tiki
   * NEDEN VAR: `cikis(ws)` cekirdekten HIC cagrilmiyor (server.js ws.on('close')
   * icinde modul cikis kancasi yok - olculdu). O yuzden:
   *   a) ILERLEME_YAZ_MS (15 sn) penceresindeki son oldurmeler cikista diske
   *      inmiyordu -> "canavar oldurdum ama gorev ilerlemesi geri gitti",
   *   b) `oturumlar` / `yuklendi` haritalari sonsuza kadar buyuyordu (her
   *      giren karakter icin bir satir, hicbir zaman silinmiyor).
   * Bu tik ikisini de modulun KENDI ICINDE cozer: kapanmis soketi gorur,
   * bekleyen ilerlemeyi yazar ve RAM kaydini birakir. `cikis` cagrilirsa
   * tik zaten bos gecer (cift yazim olmaz - yazDene ayni kuyruga girer).
   */
  const BAKIM_MS = 5_000;
  function bakimTik(simdi = Date.now()) {
    let yazilan = 0, birakilan = 0;
    for (const [cid, ws] of [...soketler]) {
      /* WebSocket.CLOSED === 3; test sahte soketleri readyState vermeyebilir. */
      const kapali = ws?.readyState === 3 || ws?.readyState === 2 || ws?.kapali === true;
      const m = oturumlar.get(cid);
      if (kapali) {
        if (m) for (const [id, k] of m) if (k.durum === 'active') { yazDene(cid, id, k); yazilan++; }
        oturumlar.delete(cid); yuklendi.delete(cid); soketler.delete(cid);
        birakilan++;
        continue;
      }
      /* Acik soket: ILERLEME_YAZ_MS'i asmis ve henuz yazilmamis aktif
         kayitlari diske indir. Boylece cokme/gucKesintisi durumunda bile
         kayip 15 saniyeyle sinirli kalir. */
      if (!m) continue;
      for (const [id, k] of m) {
        if (k.durum !== 'active') continue;
        if (simdi - (k.sonYazma ?? 0) < ILERLEME_YAZ_MS) continue;
        if (!k.kirli) continue;                 // degismemis kaydi yazma
        k.kirli = false;
        yazDene(cid, id, k); yazilan++;
      }
    }
    return { yazilan, birakilan };
  }

  const bakimZamanlayici = ctx?.tikYok ? null : setInterval(() => {
    try { bakimTik(); } catch (e) { yaz('bakim tiki:', String(e.message).slice(0, 120)); }
  }, BAKIM_MS);
  if (bakimZamanlayici?.unref) bakimZamanlayici.unref();

  /**
   * SQL havuzunu SONRADAN takar (server.js:405 `ornek.webBagla(WEBPOOL, sql)`).
   * Havuz yokken modul BELLEKTE calisir; hicbir sey cokmez, sadece _CharQuest
   * yazilmaz.
   */
  function webBagla(havuz /* , sqlMod */) {
    web = havuz ?? null;
    yaz(web ? 'SQL havuzu baglandi - _CharQuest kaliciligi acik' : 'SQL havuzu ayrildi - yalniz bellek');
    return !!web;
  }

  // ------------------------------------------------------------------- canta
  /**
   * gameloop.js#cantayaEkle ile AYNI kural: yigin siniri items.json stackMax,
   * yuva sayisi gameConfig.bagSlots.
   * "Sigar mi" denemesi icin odulSigar() cantanin KOPYASINI verir; bu yuzden
   * burada ayri bir deneme kipi yok (denetimde olu parametreydi).
   */
  function cantayaEkle(ch, itemId, adet) {
    const yuvaSayisi = ch.bag?.length || GCFG.bagSlots || 32;
    if (!Array.isArray(ch.bag) || ch.bag.length !== yuvaSayisi) {
      const eski = Array.isArray(ch.bag) ? ch.bag : [];
      ch.bag = new Array(yuvaSayisi).fill(null);
      for (let i = 0; i < Math.min(eski.length, yuvaSayisi); i++) ch.bag[i] = eski[i];
    }
    const canta = ch.bag;
    const yiginMax = Math.max(1, Number(ITEMSTATS?.get?.(itemId)?.stackMax ?? 1));
    let kalan = Math.max(1, Number(adet) || 1);

    if (yiginMax > 1) {
      for (let i = 0; i < canta.length && kalan > 0; i++) {
        const s = canta[i];
        if (!s || s.itemId !== itemId) continue;
        const yer = yiginMax - (s.qty ?? 1);
        if (yer <= 0) continue;
        const k = Math.min(yer, kalan);
        s.qty = (s.qty ?? 1) + k; kalan -= k;
      }
    }
    while (kalan > 0) {
      const bos = canta.indexOf(null);
      if (bos < 0) return false;
      const k = Math.min(yiginMax, kalan);
      canta[bos] = { itemId, qty: k };
      kalan -= k;
    }
    return true;
  }

  /** Odul esyalarinin TAMAMI sigar mi? (kismi odul verilmez.) */
  function odulSigar(ch, items) {
    if (!items?.length) return true;
    const sanal = { bag: (Array.isArray(ch.bag) ? ch.bag : []).map(s => (s ? { ...s } : null)) };
    if (sanal.bag.length !== (ch.bag?.length || GCFG.bagSlots || 32)) {
      sanal.bag = new Array(ch.bag?.length || GCFG.bagSlots || 32).fill(null);
      const eski = Array.isArray(ch.bag) ? ch.bag : [];
      for (let i = 0; i < Math.min(eski.length, sanal.bag.length); i++) sanal.bag[i] = eski[i] ? { ...eski[i] } : null;
    }
    for (const it of items) if (!cantayaEkle(sanal, it.itemDefId, it.qty)) return false;
    return true;
  }

  // --------------------------------------------------------------- oldurme
  /**
   * gameloop.js olum isleyicisinden cagrilir:  sayacArtir(ws, mob)
   * partiKisi > 1 ise pay 720720/partiKisi olur (720720 = LCM(1..16)).
   * Ilerleyen gorev sayisini doner.
   *
   * DENETIM DUZELTMESI: ikinci parametre METIN mobId ya da MOB NESNESI
   * olabilir. world.js:143 mob nesnesine `mobId` alanini koyar; `mob.id` ise
   * ENTITY numarasidir. Baglayan yanlislikla mob nesnesini (ya da mob.id'yi)
   * verirse eskiden karsilastirma sessizce tutmuyordu ve sayac hic islemiyordu
   * - hatasiz ama olu bir sistem. Artik nesne de dogru cozumleniyor, entity
   * numarasi gibi anlamsiz bir deger ise reddediliyor.
   */
  function sayacArtir(ws, mobRef, partiKisi = 1) {
    const mobId = typeof mobRef === 'string' ? mobRef
      : (typeof mobRef?.mobId === 'string' ? mobRef.mobId
        : (typeof mobRef?.def?.id === 'string' ? mobRef.def.id : null));
    if (!ws?.char || !mobId) return 0;
    const m = kayitlar(ws.char);
    const pay = Math.floor(BIRIM / Math.max(1, Math.min(16, Number(partiKisi) || 1)));
    const simdi = Date.now();
    let n = 0;
    for (const [id, k] of m) {
      if (k.durum !== 'active') continue;
      const t = tanimlar.get(id);
      if (!t) continue;
      if (t.objective.mobId !== mobId && !t.objective.alsoCounts.includes(mobId)) continue;

      const hedef = hedefUnits(t);
      k.units = Math.min(hedef, k.units + pay);
      /* `kirli` = "bellekteki deger DB'dekinden ileride". bakimTik yalnizca
         kirli kayitlari yazar; boylece hicbir sey olmayan sunucuda bakim
         tiki tek bir SQL sorgusu bile calistirmaz. */
      k.kirli = true;
      let yazmali = false;
      if (k.units >= hedef) {
        k.durum = 'completed';
        k.bitis = simdi;
        yazmali = true;
        // "Gorev tamamlandi: {title} - odulunu almak icin gorev gunlugunu (L) ac."
        bildir(ws, 'sys.quest.completed', { title: t.title || t.id });
      }
      frame(ws, 'quest.progress', { questId: id, units: Math.floor(k.units), state: k.durum });
      if (yazmali || simdi - (k.sonYazma ?? 0) > ILERLEME_YAZ_MS) { k.kirli = false; yazDene(String(ws.char.id), id, k); }
      n++;
    }
    return n;
  }

  /**
   * OLDURME KANCASI - BAGLAYANIN CAGIRACAGI TEK YORDAM.  (fark #102)
   *
   * NEDEN AYRI BIR YORDAM: `sayacArtir(ws, mob, partiKisi)` payi partiKisi'ye
   * BOLUYOR ama yalniz OLDURENE yaziyor. Naif baglanirsa (yani gameloop
   * dogrudan sayacArtir'i partiKisi ile cagirirsa) parti uyeleri hicbir sey
   * almaz, olduren ise tek basinayken aldiginin 1/N'ini alir - yani parti
   * gorev ilerlemesini HIZLANDIRMAK yerine YAVASLATIR. Dogru davranis:
   * pay HERKESE yazilir, boylece N kisilik parti bir oldurmede N x (720720/N)
   * = tam bir oldurme kadar ilerler ve HER uye kendi gunlugunde ilerler.
   *
   * "Uygun uye" tanimi UYDURULMADI: sistem_parti.paylasimHesapla() zaten
   * ayni bolge + partyShareRangeU (150) menzil + yasayan + cevrimici
   * suzgecini uyguluyor (sistem_parti.js, "XP PAYLASIMI" blogu). XP/SP'yi 0
   * verip yalnizca LISTESINI kullaniyoruz - odul dagitimi gameloop'un isi.
   *
   * Kesirli ilerleme ISTEMCIDE zaten gorunur: rRt() (paket @27558207)
   * units/720720 tam sayi degilse toFixed(2) ile yaziyor.
   *
   * @returns {number} ilerleyen (gorev, oyuncu) cifti sayisi
   */
  function oldurmeKaydet(ws, mobRef) {
    if (!ws?.char || !mobRef) return 0;
    let alicilar = [ws];
    try {
      const parti = typeof sistemOrnegi === 'function' ? sistemOrnegi('parti') : null;
      const dagilim = parti?.paylasimHesapla?.(ws, 0, 0);
      if (Array.isArray(dagilim) && dagilim.length) {
        const c = dagilim.map(d => d?.ws).filter(w => w?.char);
        if (c.length) alicilar = c;
      }
    } catch (e) {
      /* Parti modulu yoksa/patlarsa gorev ilerlemesi DURMAZ - olduren yine alir. */
      yaz('parti payi cozumlenemedi:', String(e?.message ?? e).slice(0, 120));
    }
    let n = 0;
    for (const alici of alicilar) n += sayacArtir(alici, mobRef, alicilar.length);
    return n;
  }

  // -------------------------------------------------------------- mesajlar
  function kabul(ws, questId) {
    const ch = ws.char;
    const m = kayitlar(ch);
    const t = tanimlar.get(questId);
    if (!t || !t.enabled) {
      // "Bu gorev artik yok - odulu cozumlenemiyor."
      hata(ws, 'ERR_NOT_FOUND'); bildir(ws, 'sys.quest.def_missing'); return true;
    }
    const k = m.get(questId);
    if (k && k.durum !== 'claimed') { hata(ws, 'ERR_QUEST_STATE'); return true; }
    if (k && k.durum === 'claimed') {
      if (t.repeat.type === 'none') { hata(ws, 'ERR_QUEST_STATE'); return true; }
      if (t.repeat.type === 'cooldown' && Date.now() < (k.cooldownUntil || 0)) {
        hata(ws, 'ERR_COOLDOWN'); return true;             // "Bu henuz hazir degil."
      }
    }
    // Seviye ve irk kapilari: ERR_REQ_LEVEL / ERR_RACE KULLANILMAZ - o iki
    // anahtarin TR metni USTALIK'a ozeldir ("Ustalik, karakter seviyesini
    // asamaz" / "Bu ustalik diger irka aittir") ve burada yaniltici olur.
    // ERR_VALIDATION = "Bu su anda mumkun degil." (genel ve dogru).
    const lv = ch.level ?? 1;
    if (lv < t.minLevel || lv > t.maxLevel) { hata(ws, 'ERR_VALIDATION'); return true; }
    if (!irkUyar(t, ch)) { hata(ws, 'ERR_VALIDATION'); return true; }
    if (!onKosulTamam(t, m)) { hata(ws, 'ERR_QUEST_PREREQ'); return true; }

    const sinir = Number.isInteger(GCFG.questLogMax) ? GCFG.questLogMax : null;
    if (sinir !== null && gunlukSayisi(m) >= sinir) {
      hata(ws, 'ERR_QUEST_LIMIT');
      bildir(ws, 'sys.quest.log_full', { max: sinir });
      return true;
    }

    const simdi = Date.now();
    m.set(questId, {
      durum: 'active', units: 0,
      alindi: !!k?.alindi,
      baslangic: simdi, bitis: 0, cooldownUntil: 0, sonYazma: 0,
    });
    yazDene(String(ch.id), questId, m.get(questId));
    durumGonder(ws); katalogGonder(ws);
    return true;
  }

  function birak(ws, questId) {
    const ch = ws.char;
    const m = kayitlar(ch);
    const k = m.get(questId);
    if (!k) { hata(ws, 'ERR_NOT_FOUND'); return true; }
    if (k.durum === 'claimed') { hata(ws, 'ERR_QUEST_STATE'); return true; }

    if (k.alindi) {
      /* Daha once odulu alinmis TEKRARLANABILIR gorev: kaydi silmek
         "en az bir kez alindi" bilgisini yok eder ve requiresQuest zincirini
         kirardi. Bu yuzden claimed'a geri donulur, bekleme suresi sifirlanir. */
      k.durum = 'claimed'; k.units = 0; k.cooldownUntil = 0; k.bitis = Date.now();
      yazDene(String(ch.id), questId, k);
    } else {
      m.delete(questId);
      silDene(String(ch.id), questId);
    }
    durumGonder(ws); katalogGonder(ws);
    return true;
  }

  function odulAl(ws, questId) {
    const ch = ws.char;
    const m = kayitlar(ch);
    const k = m.get(questId);
    if (!k) { hata(ws, 'ERR_NOT_FOUND'); return true; }
    const t = tanimlar.get(questId);
    if (!t) { hata(ws, 'ERR_NOT_FOUND'); bildir(ws, 'sys.quest.def_missing'); return true; }
    if (k.durum !== 'completed') { hata(ws, 'ERR_QUEST_STATE'); return true; }

    // Esya odulu: hepsi sigmiyorsa gorev HARCANMAZ, oyuncu yer acip tekrar dener.
    const esyalar = t.rewards.items ?? [];
    if (!odulSigar(ch, esyalar)) {
      hata(ws, 'ERR_BAG_FULL');                       // "Cantan dolu."
      bildir(ws, 'sys.quest.bag_full');               // "Envanter dolu - yer ac ve odulunu yeniden al."
      return true;
    }

    /* MADDE 59a - ALTIN TAVANI. Esya odulunde oldugu gibi: tavan asiliyorsa
       gorev HARCANMAZ, oyuncu altin harcayip yeniden alir. Kaynak ve deger
       icin basliktaki "ALTIN TAVANI" blogu (protokol max(2e9), 4 ayri mesaj).
       err.code icin ozel bir "altin dolu" kodu YOK (schemas.json err enum'u
       tarandi); gorunur mesaji sys.quest.gold_cap tasiyor, err yalnizca
       istemcinin iyimser durumunu geri almak icin gidiyor. */
    /* tedious bigint (RemainGold) METIN dondurebilir: ham `+` birlestirir
       ("1000000017"+500 -> 1 trilyon sanilir) ve tavan yanlis tetiklenir.
       gameloop.js:585 / sistem_dukkan.js:577 kalibi: once Number'la. */
    const altin0 = Number(ch.gold ?? 0);
    if (altin0 + (t.rewards.gold ?? 0) > ALTIN_TAVANI) {
      hata(ws, 'ERR_VALIDATION');                     // "Bu su anda mumkun degil."
      bildir(ws, 'sys.quest.gold_cap');               // "Bu kadar altin tasiyamazsin - biraz harca ve yeniden al."
      return true;
    }

    // --- odulleri ver ---
    if (t.rewards.gold) ch.gold = altin0 + t.rewards.gold;
    for (const it of esyalar) cantayaEkle(ch, it.itemDefId, it.qty);

    let atladi = false;
    if (t.rewards.xp && combat?.xpEkle) atladi = !!combat.xpEkle(ch, t.rewards.xp).seviyeAtladi;
    else if (t.rewards.xp) ch.xp = Number(ch.xp ?? 0) + t.rewards.xp;   // ExpOffset bigint -> metin olabilir
    /* rewards.sp DOGRUDAN SP PUANIDIR (spExp degil): istemci
       ui.quest.sp_reward = "{n} SP" ile gosteriyor, yani katalogdaki sayi
       oyuncunun aldigi SP'nin ta kendisi. combat.spEkle() spExp bekledigi
       icin BURADA KULLANILMAZ. */
    if (t.rewards.sp) ch.sp = (ch.sp ?? 0) + t.rewards.sp;

    // --- kayit durumu ---
    const simdi = Date.now();
    k.durum = 'claimed'; k.alindi = true; k.bitis = simdi; k.units = 0;
    k.cooldownUntil = t.repeat.type === 'cooldown' ? simdi + Math.round(t.repeat.hours * 3_600_000) : 0;
    yazDene(String(ch.id), questId, k);

    // --- kareler ---
    if (envanterPayload) frame(ws, 'inv.update', envanterPayload(ch));
    const tbl = combat?.progress?.xpToNext;
    frame(ws, 'progress.update', {
      xp: ch.xp ?? 0,
      xpToNext: tbl ? (Number(tbl[String(ch.level)] ?? 0) || null) : null,
      spExp: ch.spExp ?? 0,
      spExpToNext: combat?.progress?.spExpPerSpPoint ?? 400,
      sp: ch.sp ?? 0,
    });
    if (atladi) {
      frame(ws, 'progress.levelUp', { level: ch.level, statPoints: ch.statPoints ?? 0 });
      /* MADDE 59b: s2c 188 fx.levelUp {id} - altin halka efekti. Ayni olay
         (seviye atlama) oldurmeyle gerceklesince gameloop.js #olum bunu
         frame + broadcast olarak yolluyor, gorev odulunde ise HIC
         yollanmiyordu; yani ayni olay iki farkli gorsel veriyordu.
         Cevredekiler de gormeli - gameloop.js ve sistem_beceri.js ile
         BIREBIR ayni kalip. */
      frame(ws, 'fx.levelUp', { id: ws.entityId });
      if (typeof broadcast === 'function' && ws.zoneId != null) {
        broadcast(ws.zoneId, 'fx.levelUp', { id: ws.entityId }, ws);
      }
      bildir(ws, 'sys.progress.level_up', { level: ch.level });
      if (derived) {
        const d = derived(ch);
        ch.hp = d.maxHp; ch.mp = d.maxMp;
        frame(ws, 'vitals.update', { hp: ch.hp, mp: ch.mp });
      }
    }
    // "Gorev odulu alindi: {title}"
    bildir(ws, 'sys.quest.reward_claimed', { title: t.title || t.id });
    durumGonder(ws); katalogGonder(ws);
    return true;
  }

  // ------------------------------------------------------------- yonlendirici
  function mesaj(ws, t, d) {
    /* zone.ready BIZIM mesajimiz DEGIL: katalogu tetikleyip false doneriz ki
       server.js'in kendi zone.ready dali calismaya devam etsin. */
    if (t === 'zone.ready') {
      if (ws?.isAuthed && ws.char) girisKurulumu(ws).catch(e => yaz('giris:', String(e.message).slice(0, 120)));
      return false;
    }
    if (t !== 'quest.accept' && t !== 'quest.abandon' && t !== 'quest.claim') return false;
    if (!ws?.char) return true;

    const questId = d?.questId;
    if (typeof questId !== 'string' || !questId) { hata(ws, 'ERR_VALIDATION'); return true; }

    switch (t) {
      case 'quest.accept':  return kabul(ws, questId);
      case 'quest.abandon': return birak(ws, questId);
      case 'quest.claim':   return odulAl(ws, questId);
      default: return false;
    }
  }

  // --------------------------------------------------------------- baslangic
  /* DENETIM DUZELTMESI (kritik): server.js'teki ORTAK sistem yukleyicisi
     (server.js ~satir 665) her module AYNI ctx'i verir ve QUESTDEFS ALANI
     YOKTUR. Modul dosyayi kendisi okumadigi surece 0 tanim yukler; katalog
     bos gider ve her quest.accept ERR_NOT_FOUND ile doner (olculdu).
     Cozum kardes modullerin (sistem_binek-pet / sistem_dukkan / sistem_beceri)
     kullandigi kalip: ctx varsa ONCELIKLI, yoksa data/ dosyasindan oku.
     Test hala acik tanim gecirdigi icin test edilebilirlik korunur. */
  function tanimDosyasiniOku() {
    const p = path.join(ctx?.dataDir ?? world?.dataDir ?? path.join(BURASI, 'data'), 'quest-defs.json');
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
    catch (e) { yaz(`quest-defs.json okunamadi (${p}):`, String(e.message).slice(0, 120)); return null; }
  }
  tanimlariYukle(ctx?.QUESTDEFS ?? tanimDosyasiniOku());

  const ORNEK = {
    mesaj, sayacArtir, girisKurulumu, cikis,
    /* BAGLAYAN BUNU CAGIRSIN (fark #102): parti payini kendi cozer.
       sayacArtir dogrudan cagrilirsa parti ilerlemesi YANLIS olur. */
    oldurmeKaydet,
    /* KALICILIK KANCALARI - server.js bunlari ADA GORE buluyor:
         yukle(ch)      -> server.js:1590 modulleriYukle (zone.init ONCESI, await)
         webBagla(pool) -> server.js:405  initSql sonrasi ortak havuz */
    yukle, webBagla,
    katalogGonder, durumGonder,
    tanimlariYukle, tanimlar, oturumlar,
    sayisalId, BIRIM,
    /* Test/tani: bakim tikini elle surmek ve zamanlayiciyi durdurmak icin. */
    bakimTik,
    dur() {
      if (bakimZamanlayici) clearInterval(bakimZamanlayici);
      if (ONCEKI_ORNEK === ORNEK) ONCEKI_ORNEK = null;
    },
    /* Yeniden kurulumda durumu yeni ornege devreder (bkz. ONCEKI_ORNEK notu).
       Zamanlayiciyi da burada durduruyoruz - aksi halde eski ornek tikmaya
       devam eder ve ayni kayit IKI kez yazilir. */
    _devret(yeniWorld) {
      if (bakimZamanlayici) clearInterval(bakimZamanlayici);
      /* Farkli bir dunya (= farkli oturum / birim testi) icin durum
         devredilmez - bkz. kur() icindeki DEVIR KAPISI notu. */
      if (!world || yeniWorld !== world) return null;
      return { oturumlar, yuklendi, soketler, yazmaKuyrugu };
    },
  };
  ONCEKI_ORNEK = ORNEK;
  return ORNEK;
}

/* ===========================================================================
 * BAGLAMA NOTU  (server.js icin)
 * ===========================================================================
 * 1) EK BAGLAMA GEREKMEZ. server.js'teki ORTAK sistem yukleyicisi
 *    (SISTEM_ADLARI listesinde 'gorev' zaten var, server.js ~satir 655-676)
 *    yeterlidir: modul data/quest-defs.json'u KENDISI okur.
 *      - ctx.QUESTDEFS verilirse o oncelikli (birim testi boyle yapiyor),
 *      - verilmezse ctx.dataDir / world.dataDir / <modul>/data yolundan okunur.
 *    Kalicilik isteniyorsa yukleyicideki `web: null` bir SRO_WEB_GAME havuzuyla
 *    degistirilir; web null iken her sey BELLEKTE kalir, sunucu durmaz.
 *
 *    ctx'ten KULLANDIKLARIM: world (mobDefs -> mobName/mobLevel), combat
 *    (xpEkle + progress tablosu), frame, log, GCFG (bagSlots, istege bagli
 *    questLogMax), ITEMSTATS (odul esyasinin adi/stackMax), envanterPayload,
 *    web + SHARD (_CharQuest), derived (seviye atlayinca maxHp/maxMp),
 *    broadcast (madde 59b: fx.levelUp cevredekilere),
 *    sistemOrnegi (fark #102: sistem_parti.paylasimHesapla ile parti payi).
 *    KULLANMADIKLARIM: zoneGroundY, yurunebilirNokta (gorev kareleri kisiye
 *    ozeldir, konum/zemin gerekmez).
 *    EK ALAN: ctx.QUESTDEFS = data/quest-defs.json icerigi.
 *
 * 2) WS yonlendiricisine ekle (LOOP.mesaj'dan SONRA, switch'ten ONCE):
 *
 *      if (GOREV.mesaj(ws, t, d)) return;
 *
 *    ISLEDIGIM MESAJLAR: quest.accept (116), quest.abandon (117),
 *    quest.claim (118). Ayrica zone.ready'yi GORUR ama false doner
 *    (katalogu yollar, server.js'in kendi dali calismaya devam eder).
 *    Istersen zone.ready yerine dogrudan `await GOREV.girisKurulumu(ws)`
 *    cagirabilirsin - ikisi de gudumlu, cift cagri zararsizdir.
 *
 * 3) OLDURME SAYACI - HALA BAGLI DEGIL, TEK EKSIK ADIM BU.
 *    gameloop.js#olum icinde HIC bir gorev kancasi yok ve genel bir "olum
 *    kancasi" mekanizmasi da yok. Bu satir eklenmeden gorevler kabul edilir
 *    ama ASLA ilerlemez:
 *
 *      // gameloop.js, #olum icinde, `--- ganimet ---` satirindan HEMEN ONCE:
 *      this.gorev?.oldurmeKaydet(ws, mob);
 *
 *    !! `sayacArtir`I DOGRUDAN CAGIRMA (fark #102): o yalniz OLDURENE yazar
 *       ve payi bolerek partiyi YAVASLATIR. `oldurmeKaydet` parti uyelerini
 *       sistem_parti.paylasimHesapla ile kendi cozer ve HEPSINE tam pay yazar.
 *
 *    ve GameLoop'a `gorev` referansinin verilmesi gerekir. gameloop.js'e hic
 *    dokunmak istemiyorsan alternatif: server.js yukleyicisinde modulun
 *    ornegini sakla ve LOOP'a ver. Ikinci parametre METIN mobId de olabilir
 *    MOB NESNESI de (mob.id ENTITY numarasidir, onu VERME - sessizce hicbir
 *    sey olmaz).
 *
 *    Ayni yerde beceriyle/petle oldurmeler icin sistem_beceri.js ve
 *    sistem_binek-pet.js olum dallari da ayni kancayi cagirmali (o dosyalar
 *    baska ajanda - raporun "digerDosyaIhtiyaci" bolumunde).
 *
 * 4) Cikista (world.logout / ws close, server.js satir ~857 ve ~870):
 *      GOREV.cikis(ws);
 *    Bagli degilse tek kayip: 15 saniyeye kadarki oldurme ilerlemesi
 *    (ILERLEME_YAZ_MS kisitlamasi). Tamamlanma/odul yazmalari zaten aninda.
 *
 * GONDERDIGIM S2C KARELERI:
 *   quest.catalog (183), quest.state (184), quest.progress (185),
 *   err (240: ERR_NOT_FOUND, ERR_VALIDATION, ERR_QUEST_STATE,
 *        ERR_QUEST_PREREQ, ERR_QUEST_LIMIT, ERR_COOLDOWN, ERR_BAG_FULL),
 *   sys.notice (195: sys.quest.completed, sys.quest.reward_claimed,
 *        sys.quest.bag_full, sys.quest.def_missing, sys.quest.log_full,
 *        sys.quest.gold_cap, sys.progress.level_up) - hepsi tr.json'da
 *        GERCEKTEN var,
 *   inv.update (149), progress.update (144), progress.levelUp (145),
 *   fx.levelUp (188 - frame + broadcast, madde 59b),
 *   vitals.update (150)           - yalnizca odul alinirken.
 *
 * DB: SRO_VT_SHARD.dbo._CharQuest  (UPDATE + yoksa INSERT; birak -> DELETE
 *     ya da claimed'a geri dondurme). Yazma hatasi oyunu durdurmaz.
 *
 * ---------------------------------------------------------------------------
 * KALAN RISK (istemcinin KENDI eksigi - sunucu tarafinda cozumu yok)
 * ---------------------------------------------------------------------------
 * ERR_QUEST_STATE ve ERR_QUEST_PREREQ istemcinin err.code enumunda (Sht) VAR,
 * ama tr.json'da ne `err.ERR_QUEST_STATE` ne `err.ERR_QUEST_PREREQ` var; Eht
 * (err.key) listesinde de gorevle ilgili tek bir anahtar yok. Istemcinin err
 * isleyicisi (paket ofset 27134734) key/`err.<code>` ikisini de bulamayinca
 * SADECE console.warn yazar - oyuncu bir sey gormez.
 * Yine de DOGRU kodlar gonderiliyor, cunku:
 *   - ERR_VALIDATION'a cevirmek anlami bozar ve enumun varlik sebebini yok eder,
 *   - bu iki yol yalnizca DESYNC/hile durumunda tetiklenir: istemci Claim
 *     dugmesini tamamlanmadan, Accept dugmesini seviye disinda, Abandon
 *     dugmesini claimed satirda zaten GOSTERMEZ.
 * Gorunur geri bildirimi olan yollarda err YANINDA sys.notice de gider:
 *   ERR_QUEST_LIMIT + sys.quest.log_full, ERR_NOT_FOUND + sys.quest.def_missing,
 *   ERR_BAG_FULL + sys.quest.bag_full  (ucu de tr.json'da VAR).
 * =========================================================================== */
