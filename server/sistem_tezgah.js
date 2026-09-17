/**
 * sistem_tezgah.js — oyuncu tezgahi (kisisel dukkan)
 *
 * Islenen c2s mesajlari (opcode'lar protocol.js ile birebir):
 *   109  stall.open     sema: Aht          hiz sinifi: stall
 *   110  stall.close    sema: X({})        hiz sinifi: stall
 *   111  stall.modify   sema: X({})        hiz sinifi: stall
 *   112  stall.update   sema: Aht          hiz sinifi: stall
 *   113  stall.enter    sema: X({ownerId}) hiz sinifi: stall
 *   114  stall.leave    sema: X({})        hiz sinifi: stall
 *   115  stall.buy      sema: X({ownerId,bagSlot})  hiz sinifi: shop
 *
 * Ayrica 16 move.click GOZETLENIR: tezgahi acik oyuncu yurumez (asagida).
 * Kalan her mesajda mesaj() false doner.
 *
 * ------------------------------------------------------------------ SEMA KAYNAGI
 * Hepsi okunabilir istemci paketinden ALINDI, hicbiri uydurulmadi:
 *   playjs_source\index-BUMMQVRB.js
 *
 *   satir 624135 / ofset 25614733   T$(`stall.open`,   109, Aht, `stall`)
 *                                   T$(`stall.close`,  110, X({}), `stall`)
 *                                   T$(`stall.modify`, 111, X({}), `stall`)
 *                                   T$(`stall.update`, 112, Aht, `stall`)
 *                                   T$(`stall.enter`,  113, X({ownerId:Y().int()}), `stall`)
 *                                   T$(`stall.leave`,  114, X({}), `stall`)
 *                                   T$(`stall.buy`,    115, X({ownerId:Y().int(),
 *                                                     bagSlot:Y().int().min(0).max(159)}), `shop`)
 *   satir 624122 / ofset 25614490   kht / Aht / Oht  (c2s govdesi)
 *   satir 624514 / ofset 25623759   jht              (s2c ilan satiri)
 *   satir 624520 / ofset 25623848   T$(`stall.own`,        156, ...)
 *   satir 624534 / ofset 25624166   T$(`stall.view`,       157, ...)
 *   satir 624540 / ofset 25624286   T$(`stall.viewClosed`, 158, ...)
 *   satir 624544 / ofset 25624403   T$(`stall.board`,      159, ...)
 *   satir 623520 / ofset 25593824   S$   (esya yigini)
 *   satir 623954 / ofset 25609016   D$ = Y().int().min(1).max(1e3)
 *   satir 623903 / ofset 25602270   Sht  (err.code listesi)
 *   satir 624838 / ofset 25630955   T$(`sys.notice`, 195, {key:qJ(Tht), params, display})
 *   satir 623917                    Tht  (sys.notice/chat.pm anahtar listesi)
 *   satir 623360                    $mt  (varlik semasi) -> stall:{title,color} OPSIYONEL
 *   satir 668488 / ofset 27612279   G9 = 10  (arayuzdeki ilan tavani)
 *
 * Zod takma adlari (paketten dogrulandi):
 *   X  = z.object   Y  = z.number   J  = z.string   JJ = z.literal
 *   BJ = z.array    RJ = z.boolean  qJ = z.enum     VJ = z.union
 *   GJ = z.record   pat = z.preprocess
 *
 * Semalarin paketteki ham hali:
 *
 *   Oht = (a,b) => pat(v => typeof v == `string`
 *                        ? v.replace(/[\u0000-\u001f\u007f]/g, ``).trim() : v,
 *                      J().min(a).max(b))
 *
 *   kht = X({ bagSlot: Y().int().min(0).max(159),
 *             qty:     D$,                       // = Y().int().min(1).max(1e3)
 *             price:   Y().int().min(1).max(2e9) })
 *
 *   Aht = X({ title:  Oht(1, 30),
 *             notice: Oht(0, 64),
 *             color:  Y().int().min(0).max(7),
 *             items:  BJ(kht).min(1).max(10) })      // stall.open VE stall.update
 *
 *   jht = X({ bagSlot: Y().int(), item: S$, qty: Y().int(), price: Y().int() })
 *
 *   stall.own (156)        = X({ stall: X({ mode: qJ([`edit`,`selling`]),
 *                                           title:J(), notice:J(), color:Y().int(),
 *                                           listings: BJ(jht), earned: Y().int(),
 *                                           log: BJ(X({itemName:J(), qty:Y().int(),
 *                                                      price:Y().int(), buyer:J(),
 *                                                      at:Y()})) }).nullable() })
 *   stall.view (157)       = X({ ownerId:Y().int(), ownerName:J(), title:J(),
 *                                notice:J(), listings:BJ(jht) })
 *   stall.viewClosed (158) = X({ ownerId:Y().int(),
 *                                reason: qJ([`closed`,`modify`,`owner_left`,`range`]) })
 *   stall.board (159)      = X({ id:Y().int(),
 *                                stall: X({title:J(), color:Y().int()}).nullable() })
 *
 * DIKKAT — `Oht` ONCE kirpar SONRA olcer: title trim sonrasi 1..30 olmali.
 * DIKKAT — `stall.own.stall` ve `stall.board.stall` .nullable(): anahtar ZORUNLU,
 *          degeri null olabilir. Anahtari hic gondermezsek istemci kareyi ATAR.
 * DIKKAT — jht'de hem `item` (S$, kendi qty'si var) hem ayri `qty` var. Arayuz
 *          sayiyi `qty`den, ikon/isim/plus'i `item`den okur (ofset 27604000 civari).
 *          Biz `item`i saticinin CANLI cantasindaki yigindan uretiriz (+ qty=ilan
 *          adedi); ilan kurulurkenki anlik kopya YEDEKTIR. Boylece vitrindeki
 *          esya ile satista teslim edilen esya asla ayrismaz.
 *
 * ------------------------------------------------------- ISTEMCI DAVRANISI (gercek)
 *
 *   FIYAT = TUM YIGININ FIYATI, ADET BASI DEGIL.
 *     - satin alma penceresi:  v_c = oyuncununAltini >= itemOwner.price   (668460)
 *     - tooltip anahtari:      ui.tooltip.price_stall
 *       tr.json -> "Fiyat: {n} Altin (tumu birden alinir)"
 *     - stall.buy govdesinde ADET YOK. Yani bir ilan TEK seferde, tamamen alinir
 *       ve alinca listeden kalkar. ERR_STALL_SOLD bunun icin var.
 *
 *   HAREKET KILIDI: istemci ugt() ile move'u kendi de kesiyor (626318):
 *       ownStallOpen || selfCasting -> {t:`ignore`}
 *     ownStallOpen = !!M$.getState().own, yani stall.own ile stall!=null gelmis mi.
 *     `edit` modunda da doludur -> duzenlerken de yurunmez. Sunucu da ayni kurali
 *     uygular (istemci yamalanabilir): move.click yutulur, err ERR_BUSY +
 *     key `err.busy.stall_open` (bu anahtar Eht listesinde VE tr.json'da VAR).
 *
 *   KONUM SABIT: tezgah acildigi noktaya baglidir. Istemci tabelayi SAHIBIN
 *     VARLIGINA cizer (applyStallBoard -> entity.stall, 625977), yani oyuncu
 *     yer degistirirse tabela onunla gider. Hareket kilitli olsa da olum +
 *     dirilme (gameloop #dirilt char.x/z'yi respawnPoint'e tasir) ya da ayni
 *     bolge icinde isinlanma konumu degistirebilir. O durumda menzil tiki
 *     tezgahi kapatir (owner_left) - tabela ile menzil olcumu ayrismasin.
 *
 *   HEDEFLEME KILIDI: lgt() de tezgah acikken her tiklamayi `ignore` yapar (626253),
 *     yani tezgahci saldiramaz/hedef secemez. combat.* mesajlarini gameloop.js
 *     BIZDEN ONCE isledigi icin sunucu tarafinda oraya karisamiyoruz - bu modul
 *     yalnizca hareketi kilitler (raporda "eksik birakilan" olarak yaziyor).
 *
 *   TEZGAHA GIRME MENZILI: npcInteractRangeU (Kgt/626644) = game-config.json -> 25.
 *
 *   SEHIR SARTI: err.ERR_STALL_ZONE -> tr.json "Tezgah yalnizca sehirde acilabilir."
 *     Sehir tanimi UYDURULMADI: data/safe-areas.json (istemci paketindeki
 *     zones/<zone>.json -> safeAreas kutulari) kullaniliyor.
 *
 *   ILAN TAVANI 10: hem Aht semasi (.max(10)) hem arayuzdeki G9 = 10.
 *
 *   EKIPMAN TEK PARCA: arayuz vY(def) (weapon|shield|armor|accessory) ise adedi
 *     1'e sabitler (ui.stall.gear_single_piece). Sunucu ayni kurali uygular.
 *
 *   CAGRILMIS EVCIL HAYVAN PARSOMENI SATILAMAZ: h7(item) (655816) ->
 *     def.type === `petScroll` && typeof item.rolls?.petExpiresAt === `number`
 *     (sys.stall.pet_bound). Sunucu da reddeder.
 *
 * ------------------------------------------------------------------- KALICILIK
 *   YOK - ve olmamali. SRO_WEB_GAME'de tezgah tablosu/yordami hic yok
 *   (25 tablo + 30 yordam tarandi: WebAuction, WebExchangeOrder, WebCharUi ...
 *   arasinda stall gecen tek nesne yok). Gercek Silkroad'da da tezgah oturumla
 *   birlikte olur: baglanti kopunca tezgah kapanir. Bu modul de tezgahi
 *   BELLEKTE tutar ve soket kapaninca `owner_left` ile kapatir.
 *
 *   Alisverisin envanter/altin sonucu ws.char uzerinde ANINDA islenir; onu diske
 *   yazmak envanter dalgasinin isi (bu modul ch.bag / ch.gold disina yazmaz).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bacakDurdur } from './bacak.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/* Arayuzdeki G9 ile ayni (ofset 27612279) ve Aht semasinin .max(10)'u. */
const ILAN_TAVANI = 10;
/* Tezgah gunlugunde sakladigimiz satir sayisi. Arayuz son 6'yi gosteriyor
   ([...log].slice(-6).reverse(), ofset 27613500 civari); biraz fazlasini tutuyoruz. */
const GUNLUK_TAVANI = 20;
/* Menzil denetimi tik araligi. Tezgah sahibi yurumedigi icin sadece
   ZIYARETCININ uzaklasmasi izlenir. */
const MENZIL_TIK_MS = 500;
/* Satin alma menzil toleransi: tiklama ile paketin gelmesi arasinda oyuncu
   birkac birim yurumus olabilir. Girise degil SADECE alisverise uygulanir. */
const ALIS_TOLERANSI_U = 1;
/* Sahibin tezgahtan izin verilen kaymasi. Tezgah acikken oyuncu YURUYEMEZ
   (bacakDurdur + move.click kilidi) ama olup dirilmek (gameloop #dirilt
   ws.char.x/z'yi respawnPoint'e tasir) ya da ayni bolge icinde isinlanmak
   konumu degistirebilir. Istemci tabelayi SAHIBIN VARLIGINA cizdigi icin
   (applyStallBoard -> entity.stall) tezgah eski koordinatta kalirsa tabela
   oyuncuyla birlikte kayar, sunucunun menzil olcumu ise eski noktaya bakar.
   Bu yuzden kayma gorulunce tezgah kapatilir. */
const SAHIP_KAYMA_U = 1;
/* Hiz siniri: 10 saniyede en fazla 30 tezgah mesaji (ERR_RATE). */
const HIZ_PENCERE_MS = 10_000;
const HIZ_TAVANI = 30;

/* Ekipman = tek parca (arayuzdeki vY, ofset 155059). */
const EKIPMAN_TIPLERI = new Set(['weapon', 'shield', 'armor', 'accessory']);

/* Bu modulun sahiplendigi mesajlar. */
const MESAJLARIM = new Set([
  'stall.open', 'stall.close', 'stall.modify', 'stall.update',
  'stall.enter', 'stall.leave', 'stall.buy',
]);

/* ------------------------------------------------------------------ dogrulayici
   Zod'un kucuk aynasi - sistem_arayuz-durumu.js ile ayni kurallar:
     X({...}) bilinmeyen anahtarlari ATAR, .min/.max sinirlari AYNEN uygulanir. */

class SemaHatasi extends Error {
  constructor(yol, sebep) {
    super(`${yol || '<kok>'}: ${sebep}`);
    this.yol = yol || '<kok>';
    this.sebep = sebep;
  }
}
const hata = (yol, sebep) => { throw new SemaHatasi(yol, sebep); };

function nesneMi(v, yol) {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) hata(yol, 'nesne bekleniyor');
  return v;
}
function sayi(v, yol, { tam = false, enAz, enCok } = {}) {
  if (typeof v !== 'number' || !Number.isFinite(v)) hata(yol, 'sayi bekleniyor');
  if (tam && !Number.isInteger(v)) hata(yol, 'tam sayi bekleniyor');
  if (enAz !== undefined && v < enAz) hata(yol, `en az ${enAz}`);
  if (enCok !== undefined && v > enCok) hata(yol, `en cok ${enCok}`);
  return v;
}
/** Oht(enAz, enCok): ONCE kontrol karakterlerini at + kirp, SONRA olc. */
function metinOht(v, yol, enAz, enCok) {
  const t = typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').trim() : v;
  if (typeof t !== 'string') hata(yol, 'metin bekleniyor');
  if (t.length < enAz) hata(yol, `en az ${enAz} karakter`);
  if (t.length > enCok) hata(yol, `en cok ${enCok} karakter`);
  return t;
}

/** kht = X({bagSlot, qty, price}) */
function semaIlan(v, yol) {
  const o = nesneMi(v, yol);
  return {
    bagSlot: sayi(o.bagSlot, `${yol}.bagSlot`, { tam: true, enAz: 0, enCok: 383 }),   // SARTNAME-3 MADDE 11
    qty:     sayi(o.qty,     `${yol}.qty`,     { tam: true, enAz: 1, enCok: 1000 }),   // D$
    price:   sayi(o.price,   `${yol}.price`,   { tam: true, enAz: 1, enCok: 2e9 }),
  };
}

/** Aht = X({title, notice, color, items}) — stall.open ve stall.update ayni. */
function semaTezgahGovde(v, yol = 'stall') {
  const o = nesneMi(v, yol);
  const items = o.items;
  if (!Array.isArray(items)) hata(`${yol}.items`, 'dizi bekleniyor');
  if (items.length < 1) hata(`${yol}.items`, 'en az 1 ilan');
  if (items.length > ILAN_TAVANI) hata(`${yol}.items`, `en cok ${ILAN_TAVANI} ilan`);
  return {
    title:  metinOht(o.title,  `${yol}.title`,  1, 30),
    notice: metinOht(o.notice, `${yol}.notice`, 0, 64),
    color:  sayi(o.color, `${yol}.color`, { tam: true, enAz: 0, enCok: 7 }),
    items:  items.map((el, i) => semaIlan(el, `${yol}.items[${i}]`)),
  };
}

/** X({ownerId: Y().int()}) */
function semaSahip(v, yol = 'stall.enter') {
  const o = nesneMi(v, yol);
  return { ownerId: sayi(o.ownerId, `${yol}.ownerId`, { tam: true }) };
}

/** X({ownerId: Y().int(), bagSlot: Y().int().min(0).max(159)}) */
function semaAlis(v, yol = 'stall.buy') {
  const o = nesneMi(v, yol);
  return {
    ownerId: sayi(o.ownerId, `${yol}.ownerId`, { tam: true }),
    bagSlot: sayi(o.bagSlot, `${yol}.bagSlot`, { tam: true, enAz: 0, enCok: 383 }),   // SARTNAME-3 MADDE 11
  };
}

/* --------------------------------------------------------------- guvenli alanlar
   "Sehir" tanimi data/safe-areas.json'dan gelir; oradaki kutular istemci
   paketindeki zones/<zone>.json -> safeAreas alanindan cikarilmistir. */

function guvenliAlanlariYukle(dosya, log = () => {}) {
  try {
    const ham = JSON.parse(fs.readFileSync(dosya, 'utf8'));
    const m = new Map();
    for (const [zid, liste] of Object.entries(ham.zones ?? {})) {
      if (Array.isArray(liste) && liste.length) m.set(zid, liste);
    }
    return m;
  } catch (e) {
    /* Dosya okunamazsa harita BOS kalir ve sehirdeMi() her bolge icin false
       doner: yani tezgah HICBIR YERDE acilamaz (ERR_STALL_ZONE). Bilincli
       olarak "kapali tarafa" duser - sehir tanimi olmadan tezgahi her yere
       acmak, kir ortasinda dukkan acilmasi demek olurdu. */
    log(`tezgah: safe-areas.json okunamadi (${String(e.message).slice(0, 100)})`
      + ` - sehir tanimi YOK, tezgah hicbir yerde acilamaz`);
    return new Map();
  }
}

/** Nokta bir guvenli alanin (sehrin) icinde mi? */
function sehirdeMi(alanlar, zoneId, x, z) {
  const liste = alanlar.get(zoneId);
  if (!liste) return false;             // bolgede hic guvenli alan yoksa tezgah yok
  for (const a of liste) {
    const s = a.shape ?? {};
    const cx = (a.x ?? 0) + (s.ox ?? 0);
    const cz = (a.z ?? 0) + (s.oz ?? 0);
    let dx = x - cx, dz = z - cz;
    const rot = a.rotY ?? 0;
    if (rot) {                          // kutu donmusse noktayi TERS dondur
      const c = Math.cos(-rot), sn = Math.sin(-rot);
      const nx = dx * c - dz * sn, nz = dx * sn + dz * c;
      dx = nx; dz = nz;
    }
    if (s.kind === 'box') {
      if (Math.abs(dx) <= (s.hx ?? 0) && Math.abs(dz) <= (s.hz ?? 0)) return true;
    } else {
      const r = s.r ?? s.radius;        // savunma amacli: veride su an yok
      if (r != null && dx * dx + dz * dz <= r * r) return true;
    }
  }
  return false;
}

/* ----------------------------------------------------------------- envanter yardimi */

/** Iki yigin ayni "sade" esya mi? (Yalnizca sade yiginlar birlestirilir.) */
function sadeYigin(y) {
  return y && y.plus == null && y.dur == null && y.maxDur == null
    && y.variance == null && y.blues == null && y.rolls == null;
}

/* ============================================== ORNEK OMRU (KALICILIK DEGIL)
 * server.js `sistemleriKur()` (server.js:1337) SISTEMLER dizisini bosaltip TUM
 * modulleri bastan kuruyor - hem acilista IKI KEZ (server.js:1403 sonrasi
 * `sistemleriKur()` + initSql sonrasi `sistemleriKur(true)`) hem de admin
 * panelinden her ayar degisiminde. Eski ornegin `setInterval`i DURDURULMUYORDU:
 * her kurulumda menzil tiki bir kat daha hizli donuyor ve eski ornegin
 * `tezgahlar` Map'i cop olurken oyuncunun tezgahi SUNUCUDA yok oluyor, ama
 * istemcide pencere ACIK kaliyordu (stall.own hic null gonderilmiyor).
 *
 * DIKKAT: burada yapilan sey KALICILIK DEGIL. Tezgah bilerek oturumluktur -
 * SRO_WEB_GAME'de stall tablosu/yordami YOK (29 tablo + 32 yordam tarandi) ve
 * istemci her zone.init'te `M$.getState().setOwn(null)` ile kendi tezgahini
 * temizliyor (paket @27117900). Yaptigimiz tek sey: eski ornek olurken
 * tezgahlari DUZGUN kapatmak (stall.own {stall:null} + izleyicilere
 * stall.viewClosed) ve tiki durdurmak.
 */
let ONCEKI_ORNEK = null;

export function kur(ctx) {
  /* Eski ornek: tiki durdur ve acik tezgahlari duzgunce kapat. */
  if (ONCEKI_ORNEK) {
    try { ONCEKI_ORNEK.durdur(); } catch { /* zaten kapali */ }
    ONCEKI_ORNEK = null;
  }
  const {
    world, frame, broadcast, log = () => {},
    GCFG = {}, ITEMSTATS = new Map(), envanterPayload,
  } = ctx;

  const MENZIL_U = Number(GCFG.npcInteractRangeU ?? 25);
  const CANTA_YUVA = Number(GCFG.bagSlots ?? 32);
  const GUVENLI = guvenliAlanlariYukle(path.join(HERE, 'data', 'safe-areas.json'), log);

  /* entityId -> tezgah. entityId oturum basina uretildigi icin tezgah da
     oturumluk; bu bilincli (bkz. KALICILIK notu). */
  const tezgahlar = new Map();
  /** ws -> tezgah (sahibi oldugu)      */ const sahipTezgah = new Map();
  /** ws -> tezgah (izledigi)           */ const izleyen = new Map();
  /** ws -> son senkron edilen zoneId   */ const senkronBolge = new Map();
  /** ws -> [zaman,...] hiz penceresi   */ const hizKaydi = new Map();

  // ------------------------------------------------------------------ yardimcilar

  const esyaDef = (id) => (ITEMSTATS instanceof Map ? ITEMSTATS.get(id) : ITEMSTATS?.[id]) ?? null;
  const esyaAdi = (id) => esyaDef(id)?.name ?? String(id);
  const ekipmanMi = (id) => EKIPMAN_TIPLERI.has(esyaDef(id)?.type);
  const yiginTavani = (id) => Math.max(1, Number(esyaDef(id)?.stackMax ?? 1));

  /** Cagrilmis evcil hayvana bagli parsomen (arayuzdeki h7). */
  const evcileBagli = (y) =>
    esyaDef(y?.itemId)?.type === 'petScroll' && typeof y?.rolls?.petExpiresAt === 'number';

  const cantaBoyu = (ch) => (Array.isArray(ch?.bag) ? ch.bag.length : CANTA_YUVA);

  function mesafe(a, b) {
    const dx = (a?.x ?? 0) - (b?.x ?? 0);
    const dz = (a?.z ?? 0) - (b?.z ?? 0);
    return Math.sqrt(dx * dx + dz * dz);
  }

  /** err (240) - kod Sht listesinden, key Eht listesinden olmali. */
  function yanlis(ws, code, key) {
    if (!frame) return true;
    frame(ws, 'err', key ? { code, key } : { code });
    return true;
  }

  /** sys.notice (195) - anahtar Tht listesinde OLMALI. */
  function duyuru(ws, key, params) {
    if (frame) frame(ws, 'sys.notice', { key, params });
  }

  function hizAsimi(ws) {
    const simdi = Date.now();
    let liste = hizKaydi.get(ws);
    if (!liste) { liste = []; hizKaydi.set(ws, liste); }
    while (liste.length && simdi - liste[0] > HIZ_PENCERE_MS) liste.shift();
    if (liste.length >= HIZ_TAVANI) return true;
    liste.push(simdi);
    return false;
  }

  // ------------------------------------------------------------------ kare uretimi

  /** jht satiri: {bagSlot, item:S$, qty, price}
   *
   *  `item` her karede saticinin CANLI cantasindan okunur, ilan kurulurkenki
   *  anlik kopyadan DEGIL. Sebep: arayuz ikonu/+degerini `item`den ciziyor
   *  (668447: `itemOwner.item.plus`), satis ise cantadaki gercek yigini
   *  tasiyor. Ilan durdugu sirada baska bir sistem yigini degistirebilir
   *  (gelistirme plus'i yerinde artirir, tamir dur'u degistirir); anlik kopya
   *  gosterilirse vitrindeki esya ile teslim edilen esya ayrisir. Yuvadaki
   *  esya degistiyse (itemId farkli) eski kopyaya duseriz - o ilan zaten ilk
   *  alista ERR_STALL_SOLD ile dusecek. */
  function ilanKaresi(tz, ilan) {
    const canli = tz?.sahipWs?.char?.bag?.[ilan.bagSlot];
    const kaynak = (canli && canli.itemId === ilan.itemId) ? canli : ilan.yigin;
    return {
      bagSlot: ilan.bagSlot,
      // qty = ILAN adedi (arayuz sayiyi ayri `qty` alanindan okur ama tooltip
      // `item`i kullaniyor, ikisi tutarli olsun).
      item: { ...kaynak, qty: ilan.qty },
      qty: ilan.qty,
      price: ilan.price,
    };
  }

  /** stall.own (156) - sahibine. `stall` anahtari ZORUNLU (nullable). */
  function kendiKaresi(tz) {
    if (!tz) return { stall: null };
    return {
      stall: {
        mode: tz.mode,
        title: tz.title,
        notice: tz.notice,
        color: tz.color,
        listings: tz.ilanlar.map(i => ilanKaresi(tz, i)),
        earned: tz.kazanc,
        log: tz.gunluk.slice(-GUNLUK_TAVANI),
      },
    };
  }

  /** stall.view (157) - ziyaretciye. */
  function bakisKaresi(tz) {
    return {
      ownerId: tz.entityId,
      ownerName: tz.sahipWs.char?.name ?? '',
      title: tz.title,
      notice: tz.notice,
      listings: tz.ilanlar.map(i => ilanKaresi(tz, i)),
    };
  }

  function kendineYolla(tz) {
    if (tz?.sahipWs) frame(tz.sahipWs, 'stall.own', kendiKaresi(tz));
  }
  function izleyenlereYolla(tz) {
    const k = bakisKaresi(tz);
    for (const izw of tz.izleyiciler) frame(izw, 'stall.view', k);
  }

  /** stall.board (159) - bolgedeki HERKESE (sahibi dahil: kendi tabelasini gorur). */
  function tabelaYayinla(tz, acik) {
    if (!broadcast) return;
    broadcast(tz.zoneId, 'stall.board', {
      id: tz.entityId,
      stall: acik ? { title: tz.title, color: tz.color } : null,   // nullable, ZORUNLU
    });
  }

  /** Yeni gelen (ya da bolge degistiren) oyuncuya acik tabelalari gonder.
      zone.init'i cekirdek sunucu uretiyor ve entityPayload'da `stall` alani yok;
      bu yuzden tabelalar ilk mesajda (pratikte `ping`) tamamlaniyor. */
  function tabelalariSenkronla(ws) {
    if (!ws?.isAuthed || !ws.zoneId) return;
    if (senkronBolge.get(ws) === ws.zoneId) return;
    senkronBolge.set(ws, ws.zoneId);
    soketiIzle(ws);                 // haritalar kapanista temizlensin

    for (const tz of tezgahlar.values()) {
      if (tz.zoneId !== ws.zoneId || tz.mode !== 'selling') continue;
      frame(ws, 'stall.board', { id: tz.entityId, stall: { title: tz.title, color: tz.color } });
    }
  }

  // ------------------------------------------------------------------ yasam dongusu

  /** Soket kapanisini bir kez baglar: sahip -> owner_left, izleyici -> temizlik. */
  function soketiIzle(ws) {
    if (ws.__tezgahKapanis || typeof ws.once !== 'function') return;
    ws.__tezgahKapanis = true;
    ws.once('close', () => {
      const tz = sahipTezgah.get(ws);
      if (tz) tezgahiKapat(tz, 'owner_left');
      const iz = izleyen.get(ws);
      if (iz) { iz.izleyiciler.delete(ws); izleyen.delete(ws); }
      senkronBolge.delete(ws);
      hizKaydi.delete(ws);
    });
  }

  /**
   * Tezgahi tamamen kaldirir.
   * sebep: `closed` | `modify` | `owner_left` | `range`  (viewClosed semasi)
   */
  function tezgahiKapat(tz, sebep, sahibeBildir = true) {
    if (!tz || !tezgahlar.has(tz.entityId)) return;
    tezgahlar.delete(tz.entityId);
    sahipTezgah.delete(tz.sahipWs);
    if (tz.sahipWs) tz.sahipWs.tezgahAcik = false;   // ayna bayragi (bkz. acVeyaGuncelle)
    for (const izw of tz.izleyiciler) {
      izleyen.delete(izw);
      frame(izw, 'stall.viewClosed', { ownerId: tz.entityId, reason: sebep });
    }
    tz.izleyiciler.clear();
    tabelaYayinla(tz, false);
    if (sahibeBildir) frame(tz.sahipWs, 'stall.own', { stall: null });
    log(`tezgah kapandi: ${tz.sahipWs.char?.name ?? '?'} (${sebep})`);
  }

  /** Sadece izleyicileri dusurur (stall.modify: tezgah duruyor ama satis durdu). */
  function izleyicileriDusur(tz, sebep) {
    for (const izw of tz.izleyiciler) {
      izleyen.delete(izw);
      frame(izw, 'stall.viewClosed', { ownerId: tz.entityId, reason: sebep });
    }
    tz.izleyiciler.clear();
  }

  // ------------------------------------------------------------------ ilan kurma

  /**
   * Istemciden gelen items[] listesini cantayla karsilastirip ilanlara cevirir.
   * Hata halinde { hata: <ERR kodu> } doner - hicbir sey degistirilmez.
   */
  function ilanlariCoz(ch, items) {
    const kullanilan = new Set();
    const ilanlar = [];
    for (const it of items) {
      if (it.bagSlot >= cantaBoyu(ch)) return { hata: 'ERR_STALL_INVALID' };
      if (kullanilan.has(it.bagSlot)) return { hata: 'ERR_STALL_INVALID' };
      kullanilan.add(it.bagSlot);

      const yigin = ch.bag?.[it.bagSlot];
      if (!yigin || !yigin.itemId) return { hata: 'ERR_STALL_INVALID' };
      /* Cagrilmis pet parsomeni sahibine baglidir. Kod ERR_STALL_INVALID tek
         basina genel "gecersiz ilan" metnini basiyordu; Eht (err.key) enum'unda
         bu duruma OZEL anahtar var: err.pet.activated_bound (paket @25607427),
         tr.json: "Aktiflestirilmis pet sana baglidir - takas edilemez veya
         tezgaha konamaz." Istemci key varsa onu basar (paket @27135792). */
      if (evcileBagli(yigin)) return { hata: 'ERR_STALL_INVALID', anahtar: 'err.pet.activated_bound' };

      // Ekipman tek parca satilir (arayuz de qty'yi 1'e sabitliyor).
      const adet = ekipmanMi(yigin.itemId) ? 1 : it.qty;
      if (adet > (yigin.qty ?? 1)) return { hata: 'ERR_STALL_INVALID' };

      ilanlar.push({
        bagSlot: it.bagSlot,
        itemId: yigin.itemId,
        qty: adet,
        price: it.price,
        yigin: { ...yigin },              // gorunum icin anlik kopya
      });
    }
    return { ilanlar };
  }

  // ------------------------------------------------------------------ esya tasima

  /**
   * `yigin`i (qty adet) cantaya koyabilir miyiz? Once PLAN cikarir, uygulamaz.
   * Doner: [{yuva, ekle}] veya null (yer yok).
   */
  function yerlestirmePlani(ch, yigin) {
    const boy = cantaBoyu(ch);
    const bag = ch.bag;
    if (!Array.isArray(bag)) return null;
    const tavan = yiginTavani(yigin.itemId);
    let kalan = yigin.qty ?? 1;
    const plan = [];

    if (tavan > 1 && sadeYigin(yigin)) {
      for (let i = 0; i < boy && kalan > 0; i++) {
        const y = bag[i];
        if (!y || y.itemId !== yigin.itemId || !sadeYigin(y)) continue;
        const bosluk = tavan - (y.qty ?? 1);
        if (bosluk <= 0) continue;
        const ekle = Math.min(bosluk, kalan);
        plan.push({ yuva: i, ekle }); kalan -= ekle;
      }
    }
    for (let i = 0; i < boy && kalan > 0; i++) {
      if (bag[i]) continue;
      const ekle = Math.min(tavan, kalan);
      plan.push({ yuva: i, ekle, yeni: true }); kalan -= ekle;
    }
    return kalan > 0 ? null : plan;
  }

  function planiUygula(ch, yigin, plan) {
    for (const adim of plan) {
      if (adim.yeni) ch.bag[adim.yuva] = { ...yigin, qty: adim.ekle };
      else ch.bag[adim.yuva] = { ...ch.bag[adim.yuva], qty: (ch.bag[adim.yuva].qty ?? 1) + adim.ekle };
    }
  }

  // ------------------------------------------------------------------ mesajlar

  function acVeyaGuncelle(ws, d, guncelleme) {
    const ch = ws.char;
    const mevcut = sahipTezgah.get(ws);

    if (guncelleme) {
      // stall.update: tezgah VAR ve `edit` modunda olmali (arayuz de boyle yolluyor).
      if (!mevcut) return yanlis(ws, 'ERR_STALL_STATE');
      if (mevcut.mode !== 'edit') return yanlis(ws, 'ERR_STALL_STATE');
    } else {
      if (mevcut) return yanlis(ws, 'ERR_STALL_STATE');      // zaten acik
    }
    if (ch.dead) return yanlis(ws, 'ERR_STALL_STATE');
    if (!sehirdeMi(GUVENLI, ws.zoneId, ch.x, ch.z)) return yanlis(ws, 'ERR_STALL_ZONE');

    let govde;
    try { govde = semaTezgahGovde(d, guncelleme ? 'stall.update' : 'stall.open'); }
    catch (e) {
      log(`${guncelleme ? 'stall.update' : 'stall.open'} reddedildi (${ch.name}): ${e.message}`);
      return yanlis(ws, 'ERR_VALIDATION');
    }

    const cozum = ilanlariCoz(ch, govde.items);
    // anahtar opsiyonel: yoksa yanlis() eskisi gibi yalnizca kodu yollar.
    if (cozum.hata) return yanlis(ws, cozum.hata, cozum.anahtar);

    const tz = mevcut ?? {
      entityId: ws.entityId, sahipWs: ws, zoneId: ws.zoneId,
      x: ch.x, z: ch.z,
      kazanc: 0, gunluk: [], izleyiciler: new Set(),
    };
    tz.title = govde.title;
    tz.notice = govde.notice;
    tz.color = govde.color;
    tz.ilanlar = cozum.ilanlar;
    tz.mode = 'selling';
    tz.zoneId = ws.zoneId; tz.x = ch.x; tz.z = ch.z;

    tezgahlar.set(tz.entityId, tz);
    sahipTezgah.set(ws, tz);
    /* Sokette AYNA bayrak. Modul sinirini asmadan (ctx koprusu olmadan) baska
       modullerin "tezgahi acik" kapisini kurabilmesi icin - ornek: takas istegi
       err.busy.stall_open (tr.json: "Tezgahin acikken olmaz.", Eht enum'unda
       paket @25606950). Arayuz de ownStallOpen iken HER tiklamayi yok sayiyor
       (paket @25677424 lgt). Bayrak sahipTezgah ile BIREBIR ayni omurde:
       `modify` (duzenleme) modunda tezgah durdugu icin bayrak da acik kalir. */
    ws.tezgahAcik = true;
    soketiIzle(ws);

    /* Tezgah acilinca oyuncu CIVILENIR: yurumeyi kes ve durdugunu herkese bildir.
       (Istemci de ugt() ile move uretmeyi birakiyor; bu, yamali istemciye karsi
       sunucu tarafi kilidi.) */
    bacakDurdur(ch);
    if (broadcast) {
      const st = { id: ws.entityId, x: ch.x, z: ch.z, y: ch.y ?? 0 };
      frame(ws, 'entity.stop', st);
      broadcast(ws.zoneId, 'entity.stop', st, ws);
    }

    kendineYolla(tz);
    tabelaYayinla(tz, true);
    log(`tezgah ${guncelleme ? 'guncellendi' : 'acildi'}: ${ch.name} "${tz.title}" (${tz.ilanlar.length} ilan)`);
    return true;
  }

  function tezgahiDuzenle(ws) {
    const tz = sahipTezgah.get(ws);
    if (!tz) return yanlis(ws, 'ERR_STALL_STATE');
    if (tz.mode === 'edit') return yanlis(ws, 'ERR_STALL_STATE');
    tz.mode = 'edit';
    izleyicileriDusur(tz, 'modify');        // sys.stall.modify
    tabelaYayinla(tz, false);               // tabela iner, kimse giremez
    kendineYolla(tz);                       // mode:`edit` -> arayuz duzenleyiciyi acar
    return true;
  }

  function tezgahaGir(ws, d) {
    let g;
    try { g = semaSahip(d); } catch { return yanlis(ws, 'ERR_VALIDATION'); }

    const tz = tezgahlar.get(g.ownerId);
    if (!tz || tz.mode !== 'selling') {
      frame(ws, 'stall.viewClosed', { ownerId: g.ownerId, reason: tz ? 'modify' : 'closed' });
      return true;
    }
    if (tz.sahipWs === ws) return yanlis(ws, 'ERR_STALL_STATE');   // kendi tezgahi
    if (tz.zoneId !== ws.zoneId) {
      frame(ws, 'stall.viewClosed', { ownerId: g.ownerId, reason: 'range' });
      return true;
    }
    if (mesafe(ws.char, tz) > MENZIL_U) {
      frame(ws, 'stall.viewClosed', { ownerId: g.ownerId, reason: 'range' });
      return true;
    }

    const onceki = izleyen.get(ws);
    if (onceki && onceki !== tz) onceki.izleyiciler.delete(ws);
    tz.izleyiciler.add(ws);
    izleyen.set(ws, tz);
    soketiIzle(ws);
    frame(ws, 'stall.view', bakisKaresi(tz));
    return true;
  }

  function tezgahtanCik(ws) {
    const tz = izleyen.get(ws);
    if (tz) { tz.izleyiciler.delete(ws); izleyen.delete(ws); }
    return true;   // istemci cevap beklemiyor (pencereyi kendi kapatiyor)
  }

  function satinAl(ws, d) {
    let g;
    try { g = semaAlis(d); } catch { return yanlis(ws, 'ERR_VALIDATION'); }

    const alici = ws.char;
    const tz = tezgahlar.get(g.ownerId);
    if (!tz || tz.mode !== 'selling') return yanlis(ws, 'ERR_STALL_STATE');
    if (tz.sahipWs === ws) return yanlis(ws, 'ERR_STALL_STATE');
    if (alici.dead) return yanlis(ws, 'ERR_STALL_STATE');
    if (tz.zoneId !== ws.zoneId || mesafe(alici, tz) > MENZIL_U + ALIS_TOLERANSI_U) {
      return yanlis(ws, 'ERR_STALL_RANGE');
    }

    const sira = tz.ilanlar.findIndex(i => i.bagSlot === g.bagSlot);
    if (sira < 0) return yanlis(ws, 'ERR_STALL_SOLD');
    const ilan = tz.ilanlar[sira];

    /* Satici cantasi TEK GERCEK KAYNAK: ilan kurulduktan sonra esya elden
       cikmis olabilir (baska sistem tasimis/kirmis olabilir). */
    const satici = tz.sahipWs.char;
    const kaynak = satici?.bag?.[ilan.bagSlot];
    if (!kaynak || kaynak.itemId !== ilan.itemId || (kaynak.qty ?? 1) < ilan.qty) {
      tz.ilanlar.splice(sira, 1);
      kendineYolla(tz); izleyenlereYolla(tz);
      return yanlis(ws, 'ERR_STALL_SOLD');
    }

    if ((alici.gold ?? 0) < ilan.price) return yanlis(ws, 'ERR_NO_GOLD');

    const tasinan = { ...kaynak, qty: ilan.qty };
    const plan = yerlestirmePlani(alici, tasinan);
    if (!plan) return yanlis(ws, 'ERR_BAG_FULL');

    // ---- buradan sonrasi ATOMIK: her dogrulama gecti ----
    if ((kaynak.qty ?? 1) > ilan.qty) satici.bag[ilan.bagSlot] = { ...kaynak, qty: (kaynak.qty ?? 1) - ilan.qty };
    else satici.bag[ilan.bagSlot] = null;

    planiUygula(alici, tasinan, plan);
    alici.gold = (alici.gold ?? 0) - ilan.price;
    /* tedious bigint (RemainGold) METIN dondurebilirdi: ham `+` birlestirir
       ("1000000017"+500 -> 1 trilyon sanilir). alici tarafindaki `-` zaten
       sayiya zorluyor; satici tarafi Number ile esitlendi (gameloop.js:585). */
    satici.gold = Number(satici.gold ?? 0) + ilan.price;

    tz.ilanlar.splice(sira, 1);
    tz.kazanc += ilan.price;
    const ad = esyaAdi(ilan.itemId);
    tz.gunluk.push({
      itemName: ad, qty: ilan.qty, price: ilan.price,
      buyer: alici.name ?? '', at: Date.now(),
    });
    if (tz.gunluk.length > GUNLUK_TAVANI) tz.gunluk.splice(0, tz.gunluk.length - GUNLUK_TAVANI);

    // Envanter anligorunumu iki tarafa da (inv.update = 149).
    if (envanterPayload) {
      frame(ws, 'inv.update', envanterPayload(alici));
      frame(tz.sahipWs, 'inv.update', envanterPayload(satici));
    }
    // sys.notice (195) - anahtarlar Tht listesinde VE tr.json'da var.
    duyuru(ws, 'sys.stall.bought', { item: ad, qty: ilan.qty, gold: ilan.price });
    duyuru(tz.sahipWs, 'sys.stall.sold',
           { buyer: alici.name ?? '', item: ad, qty: ilan.qty, gold: ilan.price });

    kendineYolla(tz);
    izleyenlereYolla(tz);
    log(`tezgah satis: ${satici.name} -> ${alici.name}  ${ad} x${ilan.qty} = ${ilan.price}`);
    return true;
  }

  // ------------------------------------------------------------------ menzil tiki

  const zamanlayici = setInterval(() => {
    for (const tz of [...tezgahlar.values()]) {
      // Sahibi bolge degistirdiyse (isinlanma vb.) tezgah kapanir.
      if (tz.sahipWs.readyState !== undefined && tz.sahipWs.readyState > 1) {
        tezgahiKapat(tz, 'owner_left', false); continue;
      }
      if (tz.sahipWs.zoneId !== tz.zoneId) { tezgahiKapat(tz, 'owner_left'); continue; }
      /* Sahibi oldu: tezgah ayakta kalirsa oyuncu dirilip respawn noktasina
         isinlaninca tabela onunla birlikte kayar (istemci tabelayi varliga
         cizer) ama sunucunun menzil olcumu eski koordinatta kalir. */
      if (tz.sahipWs.char?.dead) { tezgahiKapat(tz, 'owner_left'); continue; }
      /* Sahibi bir sekilde yer degistirdi (dirilme, ayni bolge ici isinlanma). */
      if (mesafe(tz.sahipWs.char, tz) > SAHIP_KAYMA_U) {
        tezgahiKapat(tz, 'owner_left'); continue;
      }
      for (const izw of [...tz.izleyiciler]) {
        if (izw.zoneId !== tz.zoneId || mesafe(izw.char, tz) > MENZIL_U) {
          tz.izleyiciler.delete(izw); izleyen.delete(izw);
          frame(izw, 'stall.viewClosed', { ownerId: tz.entityId, reason: 'range' });
        }
      }
    }
  }, MENZIL_TIK_MS);
  if (typeof zamanlayici.unref === 'function') zamanlayici.unref();

  // ------------------------------------------------------------------ yonlendirici

  function mesaj(ws, t, d) {
    if (!ws?.char) return false;

    /* YAN ETKI (bilincli): her mesajda bir kez, oyuncunun bolgesindeki acik
       tezgah tabelalarini tamamla. zone.init'i cekirdek uretiyor ve orada
       entity.stall alani yok; istemci `zone.ready` GONDERMIYOR (paket taramasi:
       `zone.ready` yalnizca sema tablosunda geciyor), bu yuzden tutunacak tek
       nokta ilk gelen mesaj - pratikte `ping`. Mesaj SAHIPLENILMEZ. */
    tabelalariSenkronla(ws);

    /* Tezgah acikken (edit modunda da) hareket YOK. move.click'i cekirdek
       server.js isliyor; SISTEMLER ondan once calistigi icin burada yutuyoruz. */
    if (t === 'move.click' && sahipTezgah.has(ws)) {
      return yanlis(ws, 'ERR_BUSY', 'err.busy.stall_open');
    }

    if (!MESAJLARIM.has(t)) return false;
    if (hizAsimi(ws)) return yanlis(ws, 'ERR_RATE');
    soketiIzle(ws);

    switch (t) {
      case 'stall.open':   return acVeyaGuncelle(ws, d, false);
      case 'stall.update': return acVeyaGuncelle(ws, d, true);
      case 'stall.modify': return tezgahiDuzenle(ws);
      case 'stall.close': {
        const tz = sahipTezgah.get(ws);
        if (!tz) return yanlis(ws, 'ERR_STALL_STATE');
        tezgahiKapat(tz, 'closed');
        return true;
      }
      case 'stall.enter':  return tezgahaGir(ws, d);
      case 'stall.leave':  return tezgahtanCik(ws);
      case 'stall.buy':    return satinAl(ws, d);
      default:             return false;
    }
  }

  /** Temiz kapanis / test icin. */
  function durdur() {
    clearInterval(zamanlayici);
    for (const tz of [...tezgahlar.values()]) tezgahiKapat(tz, 'closed');
  }

  const ORNEK = {
    mesaj, durdur,
    // test ve tanilama icin salt-okunur pencereler
    tezgahlar, sahipTezgah, izleyen,
    sehirdeMi: (zoneId, x, z) => sehirdeMi(GUVENLI, zoneId, x, z),
    kendiKaresi, bakisKaresi,
    /* Salt-okunur pencere: err.busy.stall_open kapisini kuran diger modullere
       (ornek: sistem_ticaret.js takas istegi). Hicbir durumu degistirmez.
       Arayuz de tezgah acikken HER tiklamayi yok sayiyor - paket @25677424
       lgt(): `if (node.id === s.selfId || s.ownStallOpen) return {t:'ignore'}`. */
    tezgahiAcikMi: (soket) => sahipTezgah.has(soket),
  };
  ONCEKI_ORNEK = ORNEK;
  return ORNEK;
}

/* Birim testinin dogrudan cagirabilmesi icin disa aciliyor. */
export const SEMALAR = { semaTezgahGovde, semaIlan, semaSahip, semaAlis, metinOht };
export const YARDIM = { sehirdeMi, guvenliAlanlariYukle, sadeYigin };

/* ============================================================== BAGLAMA NOTU ===
 *
 * ctx'den KULLANDIKLARIM:
 *   frame, broadcast, log, GCFG (npcInteractRangeU, bagSlots),
 *   ITEMSTATS (type/name/stackMax), envanterPayload
 *   world / combat / derived / zoneGroundY / yurunebilirNokta / SHARD / web GEREKMEDI.
 *   (Dosyadan da veri okuyorum: server/data/safe-areas.json - "sehir" tanimi.)
 *
 * ISLEDIGIM MESAJLAR (hepsinde true doner):
 *   stall.open(109) · stall.close(110) · stall.modify(111) · stall.update(112)
 *   stall.enter(113) · stall.leave(114) · stall.buy(115)
 *   AYRICA: move.click(16) SADECE gonderen kisinin tezgahi acikken yutulur
 *   (err ERR_BUSY + key err.busy.stall_open). Tezgahi yoksa false doner ve
 *   cekirdek server.js'in kendi move.click dali normal calisir.
 *   Diger her t icin false.
 *
 * GONDERDIGIM S2C KARELERI:
 *   stall.own (156)        sahibine - acilis/guncelleme/satis/kapanis
 *   stall.view (157)       ziyaretciye - girise ve her satista
 *   stall.viewClosed (158) ziyaretciye - closed | modify | owner_left | range
 *   stall.board (159)      bolgeye yayin - tabela ac/kapa (+ yeni gelene tamamlama)
 *   inv.update (149)       alici ve saticiya (envanterPayload)
 *   sys.notice (195)       sys.stall.bought (alici) / sys.stall.sold (satici)
 *   entity.stop (135)      tezgah acilinca yurume kesildigi icin
 *   err (240)              ERR_VALIDATION / ERR_RATE / ERR_BUSY(+err.busy.stall_open)
 *                          ERR_STALL_STATE / ERR_STALL_ZONE / ERR_STALL_RANGE
 *                          ERR_STALL_SOLD / ERR_STALL_INVALID / ERR_NO_GOLD / ERR_BAG_FULL
 *   NOT: ERR_DEAD KULLANMIYORUM - `err.ERR_DEAD` anahtari tr.json'da YOK
 *   (istemcinin b2() kontrolu anahtari bulamayinca hicbir sey gostermez).
 *   Olu oyuncuda ERR_STALL_STATE yolluyorum, o anahtar VAR.
 *
 * server.js'e BAGLAMA (tek adim):
 *   SISTEM_ADLARI dizisine 'tezgah' eklenmesi YETER; yukleyici dosyayi bulur,
 *   kur(ctx) cagirir ve mesaj() zaten yonlendiriciye takilidir. Baska hicbir
 *   degisiklik gerekmez (zone.init'e dokunmuyorum, ws.on('close') listener'imi
 *   kendim ekliyorum).
 *
 * SIRALAMA UYARISI: move.click kilidinin calismasi icin bu modulun
 *   `if (LOOP && LOOP.mesaj(...))` satirindan SONRA, `switch (t)` blogundan
 *   ONCE calismasi gerekir - mevcut yerlesim tam boyle.
 *
 * EKSIK BIRAKTIKLARIM (bilincli):
 *   - combat.attack / target.set gameloop.js'te BIZDEN ONCE isleniyor; tezgah
 *     acikken saldiriyi sunucu tarafinda kesemiyorum (istemci lgt() ile kesiyor).
 *   - Ilan edilen esyalar cantada REZERVE EDILMIYOR; envanter dalgasi
 *     inv.move/inv.destroy yazacak. Onun yerine SATIS ANINDA yeniden dogruluyorum
 *     (esya gitmisse ilan dusuyor + ERR_STALL_SOLD) ve vitrini her karede canli
 *     cantadan uretiyorum (bkz. ilanKaresi).
 *   - Altin/canta degisikligi diske yazilmiyor (bellekte); kalicilik envanter
 *     dalgasinin isi.
 * ============================================================================== */
