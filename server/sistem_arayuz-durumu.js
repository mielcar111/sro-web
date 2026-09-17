/**
 * sistem_arayuz-durumu.js — arayuz durumunun kalicilastirilmasi
 *
 * Islenen c2s mesajlari (opcode'lar protocol.js ile birebir):
 *    31  hotbar.save       sema: sht   hiz sinifi: misc
 *    30  autopotion.save   sema: fht   hiz sinifi: misc
 *    24  macro.save        sema: hht   hiz sinifi: misc
 *
 * ------------------------------------------------------------------ SEMA KAYNAGI
 * Hepsi okunabilir istemci paketinden ALINDI, hicbiri uydurulmadi:
 *   playjs_source\index-BUMMQVRB.js
 *
 *   ofset 25608586  T$(`hotbar.save`, 31, sht, `misc`)
 *   ofset 25608622  T$(`autopotion.save`, 30, fht, `misc`)
 *   ofset 25608662  T$(`macro.save`, 24, hht, `misc`)
 *   ofset 25594966..25595960  sht / w$ / cht / lht / uht / dht / fht / pht / mht / hht
 *   ofset 25597516..25597610  _ht (zone.init.self) icindeki
 *                             hotbar / autoPotion / macro alanlari
 *
 * Zod takma adlari (paketten dogrulandi, `function <ad>(` tanimlari):
 *   X  = z.object    (8637922)      Y  = z.number   (8634905)
 *   J  = z.string    (8631015)      JJ = z.literal  (8642172)
 *   BJ = z.array     (8636504)      RJ = z.boolean  (8635315 -> ZodBoolean 8635113)
 *   qJ = z.enum      (8641456)      VJ = z.union    (8638329)
 *
 * Semalarin paketteki ham hali:
 *
 *   C$ = VJ([X({kind:JJ(`skill`),  groupId:J().max(64)}),
 *            X({kind:JJ(`item`),   itemDefId:J().max(64)}),
 *            X({kind:JJ(`action`), actionId:J().max(32)})]).nullable()
 *
 *   sht = X({ v:JJ(1), page:Y().int().min(0).max(3),
 *             pages:BJ(BJ(C$).length(10)).length(4), m:C$, extra:BJ(C$).length(10) })
 *
 *   w$  = X({ itemDefId:J().max(64).nullable(), enabled:RJ(),
 *             thresholdPct:Y().int().min(10).max(90) })
 *   cht = X({ itemDefId:J().max(64).nullable(), enabled:RJ() })
 *   lht = qJ([`growth`,`mount`])
 *   uht = w$.extend({ target:lht })
 *   dht = X({ itemDefId:J().max(64).nullable(),
 *             hpEnabled:RJ(), hpThresholdPct:Y().int().min(10).max(90),
 *             mpEnabled:RJ(), mpThresholdPct:Y().int().min(10).max(90) })
 *   fht = X({ v:JJ(1), hp:w$, mp:w$, pill:cht.optional(), petHp:uht.optional(),
 *             petHgp:w$.optional(), vigor:dht.optional() })
 *
 *   pht = qJ([`champion`,`giant`,`unique`,`special`])
 *   mht = X({ t:qJ([`skill`,`auto`,`weapon`]), id:J().max(64).optional(),
 *             cond:pht.optional() })
 *   hht = X({ v:JJ(1), attack:BJ(J().max(64)).max(8), buffs:BJ(J().max(64)).max(8),
 *             attack2:BJ(mht).max(8).optional(), buffs2:BJ(mht).max(8).optional(),
 *             radiusU:Y().min(10).max(150),
 *             skipChampions:RJ(), skipGiants:RJ(), skipUniques:RJ(),
 *             autoAttackFiller:RJ(), roam:RJ().optional(), noLimit:RJ().optional(),
 *             speedItem:J().max(64).optional() })
 *
 * DIKKAT — `radiusU` .int() DEGIL: ondalikli deger gecerlidir. Yuvarlamiyoruz.
 * SAPMA  — MAKRO YUVA SAYISI (bilincli, orijinalden farkli): yukaridaki `hht`
 *          orijinal pakette `.max(8)`; bu klonda makro penceresi 8 -> 12 yuvaya
 *          cikarildi, bu yuzden buradaki sinir da 12 (MAKRO_YUVA). Istemci
 *          tarafi ayni degeri 6 yerde tasiyor (index-DzRqDn3Z.js):
 *            q0()  attack2/buffs2 normallestirici  .slice(0,12)
 *            xxt() eski v1 metin dizisi            .slice(0,12)
 *            ERt() "+ Auto attack" kapisi          n.length<12
 *            ERt() yuva satiri                     Array.from({length:12})
 *            ARt() beceri/silah birakma kirpmasi   i.slice(0,12) x2
 *          Sunucu istemciden KUCUK kalirsa 12 girisli kayit reddedilir ve
 *          ozellik sessizce kirilir; bu iki sayi BIRLIKTE degistirilmelidir.
 * DIKKAT — macro serialize() hem eski `attack`/`buffs` (metin dizisi) hem yeni
 *          `attack2`/`buffs2` (mht) gonderir; istemcinin hydrate'i attack2 varsa
 *          ONU tercih eder (ofset 25815752). Bu yuzden iki alan da AYNEN saklanir.
 *
 * ------------------------------------------------------- ISTEMCI DAVRANISI (gercek)
 *   Rjt/wjt/Ujt (27112542 / 27106782 / 27113034): istemci `store.serialize()`
 *   sonucunu gonderir, ACK BEKLEMEZ. Gonderim 1500 ms geciktirmelidir
 *   (Fjt=1500, xjt=1500, Bjt=1500) ve `pagehide`/`beforeunload` aninda zorla
 *   bosaltilir. Bu yuzden bu modul de cevap karesi gondermez; sadece
 *   dogrulama basarisiz olursa `err` yollar.
 *
 *   Istemci kaydi SADECE zone.init.self icinden geri okur (ofset 27116640):
 *     ... T8.getState().hydrate(self.charId, self.hotbar ?? null)
 *     ... Y2.getState().hydrate(self.charId, self.autoPotion ?? null)
 *     ... p2.getState().hydrate(self.charId, self.macro ?? null)
 *   Yani geri yukleme icin zone.init'ten ONCE `yukle(ch)` cagrilmalidir
 *   (asagidaki BAGLAMA NOTU'na bak).
 *
 * ------------------------------------------------------------------- KALICILIK
 *   SRO_WEB_GAME.dbo.WebCharUi (CharID int PK, hotbarJson/autoPotionJson/macroJson
 *   nvarchar(max) NULL, updatedAt datetime) — HAZIR yordam:
 *   dbo.WebSaveCharUi @CharID,@Hotbar,@AutoPotion,@Macro.
 *   Yordam MERGE + COALESCE kullanir: NULL gecilen alan eskisini korur, bu yuzden
 *   sadece DEGISEN alani yolluyoruz.
 *
 *   DENETIM NOTU: tablo ve yordam BU MODULDEN ONCE vardi, uydurma degil.
 *   sys.tables    WebCharUi     create_date 2026-08-23 15:24:55
 *   sys.procedures WebSaveCharUi create_date 2026-08-23 16:59:04
 *   (modul dosyasi 20:28) — SRO_WEB_GAME'deki 30 yordamdan biri.
 */

import sql from 'mssql';

/* Istemcinin kendi erteleme sabiti (paket: Fjt/xjt/Bjt = 1500).
   SQL yazimini ayni pencerede birlestiriyoruz ki arka arkaya gelen
   kayitlar tek UPDATE'e insin. Bellekteki durum ANINDA guncellenir. */
const YAZMA_PENCERESI_MS = 1500;

/* ------------------------------------------------------------------ dogrulayici
   Zod'un kucuk bir aynasi. Kurallar zod v4 ile ayni:
     - X({...}) BILINMEYEN ANAHTARLARI ATAR (strip)
     - .optional() -> anahtar hic olmayabilir / undefined olabilir; null OLAMAZ
     - .nullable() -> anahtar ZORUNLU, degeri null olabilir
     - VJ([...])   -> ilk uyan secenegin ciktisi kullanilir            */

class SemaHatasi extends Error {
  constructor(yol, sebep) {
    super(`${yol || '<kok>'}: ${sebep}`);
    this.yol = yol || '<kok>';
    this.sebep = sebep;
  }
}
const hata = (yol, sebep) => { throw new SemaHatasi(yol, sebep); };

function metin(v, yol, enCok) {
  if (typeof v !== 'string') hata(yol, 'metin bekleniyor');
  if (enCok !== undefined && v.length > enCok) hata(yol, `en cok ${enCok} karakter`);
  return v;
}
function sayi(v, yol, { tam = false, enAz, enCok } = {}) {
  if (typeof v !== 'number' || !Number.isFinite(v)) hata(yol, 'sayi bekleniyor');
  if (tam && !Number.isInteger(v)) hata(yol, 'tam sayi bekleniyor');
  if (enAz !== undefined && v < enAz) hata(yol, `en az ${enAz}`);
  if (enCok !== undefined && v > enCok) hata(yol, `en cok ${enCok}`);
  return v;
}
function mantik(v, yol) {
  if (typeof v !== 'boolean') hata(yol, 'mantiksal deger bekleniyor');
  return v;
}
function sabit(v, yol, deger) {
  if (v !== deger) hata(yol, `sabit ${JSON.stringify(deger)} bekleniyor`);
  return v;
}
function secenek(v, yol, liste) {
  if (!liste.includes(v)) hata(yol, `su degerlerden biri olmali: ${liste.join('|')}`);
  return v;
}
function dizi(v, yol, { uzunluk, enCok } = {}, elemanSema) {
  if (!Array.isArray(v)) hata(yol, 'dizi bekleniyor');
  if (uzunluk !== undefined && v.length !== uzunluk) hata(yol, `tam ${uzunluk} eleman olmali`);
  if (enCok !== undefined && v.length > enCok) hata(yol, `en cok ${enCok} eleman`);
  return v.map((el, i) => elemanSema(el, `${yol}[${i}]`));
}
/** .optional(): anahtar yoksa/undefined ise cikti nesnesine HIC KONULMAZ. */
function istege(kaynak, anahtar, yol, sema, cikti) {
  if (!(anahtar in kaynak) || kaynak[anahtar] === undefined) return;
  cikti[anahtar] = sema(kaynak[anahtar], yol);
}
function nesneMi(v, yol) {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) hata(yol, 'nesne bekleniyor');
  return v;
}

/* --- C$  : eylem yuvasi (nullable birlesim) --------------------------------- */
function eylemYuvasi(v, yol) {
  if (v === null) return null;
  const o = nesneMi(v, yol);
  // VJ birlesimi: `kind` degerine gore tek secenek uyar, digerleri kesin patlar.
  if (o.kind === 'skill')  return { kind: 'skill',  groupId:   metin(o.groupId,   `${yol}.groupId`,   64) };
  if (o.kind === 'item')   return { kind: 'item',   itemDefId: metin(o.itemDefId, `${yol}.itemDefId`, 64) };
  if (o.kind === 'action') return { kind: 'action', actionId:  metin(o.actionId,  `${yol}.actionId`,  32) };
  hata(`${yol}.kind`, 'skill|item|action bekleniyor');
}

/* --- sht : hotbar ----------------------------------------------------------- */
function semaHotbar(v, yol = 'hotbar') {
  const o = nesneMi(v, yol);
  return {
    v:     sabit(o.v, `${yol}.v`, 1),
    page:  sayi(o.page, `${yol}.page`, { tam: true, enAz: 0, enCok: 3 }),
    pages: dizi(o.pages, `${yol}.pages`, { uzunluk: 4 },
             (sayfa, y) => dizi(sayfa, y, { uzunluk: 10 }, eylemYuvasi)),
    m:     eylemYuvasi(o.m, `${yol}.m`),   // nullable ama ZORUNLU anahtar
    extra: dizi(o.extra, `${yol}.extra`, { uzunluk: 10 }, eylemYuvasi),
  };
}

/* --- w$ / cht / uht / dht / fht : otomatik iksir ----------------------------- */
function semaIksirYuvasi(v, yol) {                                    // w$
  const o = nesneMi(v, yol);
  return {
    itemDefId: o.itemDefId === null ? null : metin(o.itemDefId, `${yol}.itemDefId`, 64),
    enabled: mantik(o.enabled, `${yol}.enabled`),
    thresholdPct: sayi(o.thresholdPct, `${yol}.thresholdPct`, { tam: true, enAz: 10, enCok: 90 }),
  };
}
function semaHap(v, yol) {                                            // cht
  const o = nesneMi(v, yol);
  return {
    itemDefId: o.itemDefId === null ? null : metin(o.itemDefId, `${yol}.itemDefId`, 64),
    enabled: mantik(o.enabled, `${yol}.enabled`),
  };
}
function semaEvcilIksir(v, yol) {                                     // uht = w$.extend({target})
  const t = semaIksirYuvasi(v, yol);
  t.target = secenek(v.target, `${yol}.target`, ['growth', 'mount']);  // lht
  return t;
}
function semaVigor(v, yol) {                                          // dht
  const o = nesneMi(v, yol);
  return {
    itemDefId: o.itemDefId === null ? null : metin(o.itemDefId, `${yol}.itemDefId`, 64),
    hpEnabled: mantik(o.hpEnabled, `${yol}.hpEnabled`),
    hpThresholdPct: sayi(o.hpThresholdPct, `${yol}.hpThresholdPct`, { tam: true, enAz: 10, enCok: 90 }),
    mpEnabled: mantik(o.mpEnabled, `${yol}.mpEnabled`),
    mpThresholdPct: sayi(o.mpThresholdPct, `${yol}.mpThresholdPct`, { tam: true, enAz: 10, enCok: 90 }),
  };
}
function semaOtoIksir(v, yol = 'autoPotion') {                        // fht
  const o = nesneMi(v, yol);
  const c = {
    v:  sabit(o.v, `${yol}.v`, 1),
    hp: semaIksirYuvasi(o.hp, `${yol}.hp`),
    mp: semaIksirYuvasi(o.mp, `${yol}.mp`),
  };
  istege(o, 'pill',   `${yol}.pill`,   semaHap,          c);
  istege(o, 'petHp',  `${yol}.petHp`,  semaEvcilIksir,   c);
  istege(o, 'petHgp', `${yol}.petHgp`, semaIksirYuvasi,  c);
  istege(o, 'vigor',  `${yol}.vigor`,  semaVigor,        c);
  return c;
}

/* --- pht / mht / hht : makro ------------------------------------------------ */
function semaMakroGiris(v, yol) {                                     // mht
  const o = nesneMi(v, yol);
  const c = { t: secenek(o.t, `${yol}.t`, ['skill', 'auto', 'weapon']) };
  istege(o, 'id',   `${yol}.id`,   (x, y) => metin(x, y, 64), c);
  istege(o, 'cond', `${yol}.cond`,
         (x, y) => secenek(x, y, ['champion', 'giant', 'unique', 'special']), c);   // pht
  return c;
}
/* Makro listelerinin (saldiri sirasi / guclendirmeler) yuva sayisi.
   Istemci paketindeki karsiligi ile BIREBIR ayni olmak zorunda — bak: yukaridaki
   SAPMA notu. Orijinal pakette 8'di, bu klonda 12. */
const MAKRO_YUVA = 12;

function semaMakro(v, yol = 'macro') {                                // hht
  const o = nesneMi(v, yol);
  const kimlikDizisi = (x, y) => dizi(x, y, { enCok: MAKRO_YUVA }, (el, ey) => metin(el, ey, 64));
  const girisDizisi  = (x, y) => dizi(x, y, { enCok: MAKRO_YUVA }, semaMakroGiris);
  const c = {
    v: sabit(o.v, `${yol}.v`, 1),
    attack: kimlikDizisi(o.attack, `${yol}.attack`),
    buffs:  kimlikDizisi(o.buffs,  `${yol}.buffs`),
  };
  istege(o, 'attack2', `${yol}.attack2`, girisDizisi, c);
  istege(o, 'buffs2',  `${yol}.buffs2`,  girisDizisi, c);
  // .int() YOK - ondalikli deger gecerli
  c.radiusU          = sayi(o.radiusU, `${yol}.radiusU`, { enAz: 10, enCok: 150 });
  c.skipChampions    = mantik(o.skipChampions,    `${yol}.skipChampions`);
  c.skipGiants       = mantik(o.skipGiants,       `${yol}.skipGiants`);
  c.skipUniques      = mantik(o.skipUniques,      `${yol}.skipUniques`);
  c.autoAttackFiller = mantik(o.autoAttackFiller, `${yol}.autoAttackFiller`);
  istege(o, 'roam',      `${yol}.roam`,      mantik,                  c);
  istege(o, 'noLimit',   `${yol}.noLimit`,   mantik,                  c);
  istege(o, 'speedItem', `${yol}.speedItem`, (x, y) => metin(x, y, 64), c);
  return c;
}

/* Mesaj adi -> {alan, sema, sutun} eslemesi.
   `alan`  : ch uzerindeki ad, zone.init.self ile birebir ayni yazim.
   `sutun` : WebSaveCharUi yordamindaki parametre adi. */
const KAYITLAR = {
  'hotbar.save':     { alan: 'hotbar',     sema: semaHotbar,  param: 'Hotbar' },
  'autopotion.save': { alan: 'autoPotion', sema: semaOtoIksir, param: 'AutoPotion' },
  'macro.save':      { alan: 'macro',      sema: semaMakro,   param: 'Macro' },
};

/* ================================================== ORNEK OMRU / DEVIR DEFTERI
 * server.js `sistemleriKur()` (server.js:1337) SISTEMLER dizisini BOSALTIP tum
 * modulleri BASTAN kuruyor; admin panelinden bir ayar degistirilince de bu
 * calisiyor. Bekleyen yazimlar kur() ICINDEKI bir Map'te dursaydi, o anda
 * 1500 ms'lik pencerede olan hotbar/otoIksir/makro kayitlari SESSIZCE
 * kaybolurdu (zamanlayici yeni ornekle birlikte yok olur, kayit diske inmez).
 *
 * Bu yuzden defter MODUL KAPSAMINDA: yeni ornek eskisinin bekleyen isini
 * devralir. Ayrica ONCEKI_ORNEK.hepsiniBosalt() ile eski ornegin bekleyeni
 * hemen diske indirilir - kalibi kardes moduller de kullaniyor
 * (sistem_binek-pet.js:152 ONCEKI_ORNEK, sistem_meslek.js:196 ONCEKI_KAPAT).
 *
 * anahtar: CharID (sayi)  ->  { zamanlayici, kirli:{Hotbar?:json,...} }
 */
const BEKLEYEN = new Map();
let ONCEKI_ORNEK = null;

export function kur(ctx) {
  const { log = () => {}, frame } = ctx;

  /* Eski ornek varsa: bekleyen yazimlarini HEMEN diske indir. Defter ortak
     oldugu icin veri kaybolmaz, ama eski ornegin `web` havuzu kapanmis
     olabilir - bu yuzden bosaltmayi eski ornege yaptiriyoruz. */
  if (ONCEKI_ORNEK) {
    try { ONCEKI_ORNEK.hepsiniBosalt(); } catch { /* eski ornek zaten olu */ }
    ONCEKI_ORNEK = null;
  }

  /* `web` SONRADAN baglanabilir olmali: server.js sistem modullerini 658. satirda
     kuruyor ama `await initSql()` 914. satirda calisiyor; yani kurulum aninda
     webPool HENUZ YOK ve mevcut yukleyici ctx'e `web: null` geciriyor.
     Bu yuzden const degil `let` ve asagida webBagla() var. */
  let web = ctx.web ?? null;

  /** Modul kapsamindaki ortak defter (bkz. yukaridaki blok). */
  const bekleyen = BEKLEYEN;

  function charIdOf(ch) {
    const n = Number(ch?.id);
    return Number.isInteger(n) && n > 0 ? n : null;
  }

  async function sqlYaz(charId, kirli) {
    if (!web) return false;
    const istek = web.request().input('CharID', sql.Int, charId);
    for (const p of ['Hotbar', 'AutoPotion', 'Macro']) {
      // Yordam COALESCE kullaniyor: NULL gecilen alan eskisini KORUR.
      istek.input(p, sql.NVarChar(sql.MAX), kirli[p] ?? null);
    }
    await istek.execute('WebSaveCharUi');
    return true;
  }

  /** Bir karakterin bekleyen yazimini hemen diske indir. */
  async function bosalt(charId) {
    const kayit = bekleyen.get(charId);
    if (!kayit) return false;
    bekleyen.delete(charId);
    if (kayit.zamanlayici) clearTimeout(kayit.zamanlayici);
    try {
      const yazildi = await sqlYaz(charId, kayit.kirli);
      if (yazildi) log(`arayuz durumu kaydedildi: CharID=${charId} [${Object.keys(kayit.kirli).join(',')}]`);
      return yazildi;
    } catch (e) {
      log(`arayuz durumu YAZILAMADI (CharID=${charId}): ${String(e.message).slice(0, 160)}`);
      return false;
    }
  }

  async function hepsiniBosalt() {
    const idler = [...bekleyen.keys()];
    for (const id of idler) await bosalt(id);
    return idler.length;
  }

  function yazimPlanla(charId, param, json) {
    let kayit = bekleyen.get(charId);
    if (!kayit) { kayit = { kirli: {}, zamanlayici: null }; bekleyen.set(charId, kayit); }
    kayit.kirli[param] = json;
    if (kayit.zamanlayici) return;                // pencere zaten aciksa biriktir
    kayit.zamanlayici = setTimeout(() => { bosalt(charId); }, YAZMA_PENCERESI_MS);
    if (typeof kayit.zamanlayici.unref === 'function') kayit.zamanlayici.unref();
  }

  /* -------------------------------------------------------------- mesaj yonlendirici */
  function mesaj(ws, t, d) {
    const kayit = KAYITLAR[t];
    if (!kayit) return false;                     // ilgilenmiyoruz -> router devam etsin
    const ch = ws?.char;
    if (!ch) return true;                         // yetkisiz/karaktersiz soket: yut

    let temiz;
    try {
      temiz = kayit.sema(d);
    } catch (e) {
      const neden = e instanceof SemaHatasi ? e.message : String(e.message);
      log(`${t} reddedildi (${ch.name ?? ch.id}): ${neden}`);
      /* `err` semasi (240): code qJ(Sht) zorunlu. ERR_VALIDATION Sht listesinde VAR
         ve `err.ERR_VALIDATION` anahtari tr.json icinde GERCEKTEN mevcut, yani
         istemci bunu okunur bir satir olarak gosterir. `key` uydurmuyoruz -
         istemci key yoksa `err.${code}` anahtarina duser (ofset 27134282). */
      if (frame) frame(ws, 'err', { code: 'ERR_VALIDATION', msg: `${t}: ${neden}`.slice(0, 200) });
      return true;
    }

    // 1) Bellek: aninda. zone.init.self bu alanlari oldugu gibi okur.
    ch[kayit.alan] = temiz;

    // 2) Disk: 1500 ms'lik pencerede birlestirilir.
    const charId = charIdOf(ch);
    if (charId !== null && web) yazimPlanla(charId, kayit.param, JSON.stringify(temiz));

    return true;                                  // istemci ACK BEKLEMIYOR
  }

  /* --------------------------------------------------------------- geri yukleme */
  /**
   * Kaydedilmis arayuz durumunu DB'den okuyup `ch` uzerine koyar.
   * zone.init GONDERILMEDEN ONCE await edilmelidir.
   * Bozuk/eski JSON semadan gecmezse sessizce null birakilir (istemcinin
   * hydrate'i null'i kendi varsayilanlariyla doldurur).
   */
  async function yukle(ch) {
    ch.hotbar ??= null; ch.autoPotion ??= null; ch.macro ??= null;
    const charId = charIdOf(ch);
    if (!web || charId === null) return selfAlanlari(ch);
    try {
      const r = await web.request().input('c', sql.Int, charId).query(
        'SELECT hotbarJson, autoPotionJson, macroJson FROM dbo.WebCharUi WHERE CharID = @c');
      const satir = r.recordset[0];
      if (!satir) return selfAlanlari(ch);
      const cift = [
        ['hotbar',     satir.hotbarJson,     semaHotbar],
        ['autoPotion', satir.autoPotionJson, semaOtoIksir],
        ['macro',      satir.macroJson,      semaMakro],
      ];
      for (const [alan, ham, sema] of cift) {
        if (!ham) continue;
        try { ch[alan] = sema(JSON.parse(ham)); }
        catch (e) {
          ch[alan] = null;
          log(`arayuz durumu bozuk, atlandi (CharID=${charId}.${alan}): ${String(e.message).slice(0, 120)}`);
        }
      }
    } catch (e) {
      log(`arayuz durumu okunamadi (CharID=${charId}): ${String(e.message).slice(0, 160)}`);
    }
    return selfAlanlari(ch);
  }

  /** selfPayload icine dogrudan yayilabilecek uclu. Alan adlari _ht ile birebir. */
  function selfAlanlari(ch) {
    return {
      hotbar:     ch?.hotbar     ?? null,
      autoPotion: ch?.autoPotion ?? null,
      macro:      ch?.macro      ?? null,
    };
  }

  /**
   * SQL havuzunu SONRADAN bagla. server.js modulleri initSql()'den ONCE
   * kurdugu icin sart: `await initSql()` bittikten sonra bir kez cagrilir.
   * Null/undefined gecilirse kalicilik kapatilir (modul bellekte calismaya devam).
   */
  function webBagla(havuz) {
    web = havuz ?? null;
    log(`arayuz durumu kaliciligi: ${web ? 'ACIK (SRO_WEB_GAME.WebCharUi)' : 'KAPALI (bellek)'}`);
    return !!web;
  }

  const ORNEK = {
    mesaj, yukle, selfAlanlari, bosalt, hepsiniBosalt, webBagla, bekleyen,
    /** server.js modulleri yeniden kurarken cagirabilir; kur() zaten kendisi
     *  ONCEKI_ORNEK uzerinden bosaltiyor - bu disaridan tetikleme icin. */
    kapat: () => hepsiniBosalt(),
  };
  ONCEKI_ORNEK = ORNEK;
  return ORNEK;
}

/* Birim testinin dogrudan cagirabilmesi icin semalar disa aciliyor. */
export const SEMALAR = { semaHotbar, semaOtoIksir, semaMakro, eylemYuvasi };

/* ============================================================== BAGLAMA NOTU ===
 *
 * ctx'den KULLANDIKLARIM:  frame, log, web        (world/combat/GCFG/ITEMSTATS/
 *   zoneGroundY/yurunebilirNokta/envanterPayload/derived/SHARD/broadcast GEREKMEDI)
 *
 * ISLEDIGIM MESAJLAR (baskasi islemez, hepsinde true doner):
 *   hotbar.save (31) · autopotion.save (30) · macro.save (24)
 *   Bunlarin disindaki her t icin mesaj() false doner.
 *
 * GONDERDIGIM S2C KARELERI:
 *   sadece `err` (240) { code:'ERR_VALIDATION', msg } — yalnizca sema tutmazsa.
 *   Basarili kayitta HICBIR kare gonderilmez (istemci ACK beklemiyor: Rjt/wjt/Ujt).
 *   `q` yankilanmiyor: W$.send(t,d,q) uc argumanli ama uc kayit cagrisi da
 *   iki argumanla yapiliyor, yani q undefined (paket 25650597 civari).
 *
 * ------------------------------------------------------------ server.js'e BAGLAMA
 * ONEMLI: server.js'te ZATEN genel bir modul yukleyici var (`const SISTEM_ADLARI`
 * blogu, listede 'arayuz-durumu' MEVCUT) ve yonlendirme de yapilmis
 * (`for (const s of SISTEMLER) { if (s.ornek.mesaj(ws,t,d)) return; }`).
 * Yani AYRICA import/kur/yonlendirme EKLENMEMELI - modul iki kez kurulurdu.
 * Geriye SADECE su 3 kucuk degisiklik kaliyor. (Satir numaralari 2026-08-23
 * 20:40 halindeki server.js'e gore; server.js paralel olarak degistigi icin
 * ASIL OLCUT asagidaki ARAMA DIZELERIDIR.)
 *
 *  1) KALICILIK (web havuzu). Yukleyici ctx'e `web: null` geciriyor (~satir 668)
 *     cunku `await initSql()` cok sonra, ~914. satirda calisiyor. Iki satir:
 *       a) ARA: "let sql = null, pool = null, refItems = [], refMobs = [];"     (~154)
 *          YAZ: "let sql = null, pool = null, webPool = null, refItems = [], refMobs = [];"
 *       b) ARA: "    const webPool = await new sql.ConnectionPool({"            (~172)
 *          YAZ: "    webPool = await new sql.ConnectionPool({"
 *     ve ARA: "await initSql();" SATIRININ HEMEN ARDINA (~914):
 *       const ARAYUZ = SISTEMLER.find(s => s.ad === 'arayuz-durumu')?.ornek ?? null;
 *       ARAYUZ?.webBagla(webPool);
 *     (webBagla cagrilmazsa modul cokmez, sadece kalicilik olmaz.)
 *     NOT: ARAYUZ modul kapsaminda gorunur olmali (2. ve 3. adim da kullaniyor);
 *     `let ARAYUZ = null;` seklinde SISTEM_ADLARI blogunun yanina tanimlanip
 *     initSql sonrasi atanmasi en temizi.
 *
 *  2) GERI YUKLEME — SART: istemci kaydi SADECE zone.init.self'ten okur.
 *     WS 'auth' dali SENKRON oldugu icin orada await etmek yerine, biletin
 *     verildigi ASENKRON HTTP ucunda yuklemek en temizi.
 *     ARA: "tickets.set(ticket, { JID: acc.JID, charId: ch.id, char: ch,"  (~460)
 *     BU SATIRDAN HEMEN ONCE:
 *       await ARAYUZ?.yukle(ch);
 *     (ch.id = String(CharID), routes_auth.js:310 — yukle bunu bekliyor.)
 *     Ve selfPayload icinde
 *     ARA: "    hotbar: null, autoPotion: null, macro: null,"              (~330)
 *     YAZ: "    hotbar: ch.hotbar ?? null, autoPotion: ch.autoPotion ?? null, macro: ch.macro ?? null,"
 *     (ya da  ...ARAYUZ.selfAlanlari(ch)  yayilmali.)
 *
 *  3) (istege bagli) TEMIZ KAPANIS — SIGINT/shutdown yolunda:
 *       await ARAYUZ?.hepsiniBosalt();
 *     Bekleyen en fazla 1500 ms'lik yazim kaybolmaz. Zamanlayici unref'li
 *     oldugu icin surec cikisini geciktirmez.
 *
 * DB: SRO_WEB_GAME.dbo.WebCharUi + HAZIR dbo.WebSaveCharUi yordami.
 *     Yordam MERGE/COALESCE oldugu icin her mesajda yalnizca DEGISEN sutun
 *     dolduruluyor, digerleri NULL gecilip korunuyor.
 * ============================================================================== */
