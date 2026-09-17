/**
 * sistem_ticaret.js — oyuncular arasi takas (trade)
 *
 * Islenen c2s mesajlari (opcode'lar protocol.js ile birebir):
 *    55  trade.request     -> hedefe takas daveti
 *    56  trade.respond     -> daveti kabul / reddet
 *    57  trade.offerItem   -> cantadan takas penceresine esya koy
 *    58  trade.retract     -> koydugun esyayi geri cek
 *    59  trade.setGold     -> koydugun altin miktarini AYARLA (mutlak deger)
 *    60  trade.approve     -> kendi tarafini kilitle
 *    61  trade.unapprove   -> kilidi ac
 *    62  trade.confirm     -> son onay; iki taraf da onaylayinca takas ISLER
 *    63  trade.cancel      -> her asamada iptal
 *
 * Uretilen s2c kareleri:
 *   152  trade.incoming  { fromId, fromName }
 *   153  trade.update    { partnerId, partnerName, rev, self{...}, other{...} }
 *   154  trade.close     { reason }
 *   195  sys.notice      { key, params }
 *   149  inv.update      (takas tamamlandiginda iki tarafa da)
 *   240  err             { code, key?, msg? }
 *
 * ==================================================================== SEMA KAYNAGI
 * Hepsi okunabilir istemci paketinden ALINDI, hicbiri uydurulmadi:
 *   playjs_source\index-BUMMQVRB.js
 *
 * (DENETIM: asagidaki ofsetlerin HEPSI paket uzerinde yeniden olculdu ve
 *  duzeltildi; onceki basliktaki degerler ~800 bayt kaymisti. Icerik aynidir.)
 *
 * --- c2s kayitlari, ofset 25609777..25610345 (tek blok, ardisik) ---
 *   T$(`trade.request`,   55, X({ targetId: Y().int() }), `trade`)
 *   T$(`trade.respond`,   56, X({ accept: RJ() }), `trade`)
 *   T$(`trade.offerItem`, 57, X({ bagSlot: Y().int().min(0).max(159), qty: D$ }), `trade`)
 *   T$(`trade.retract`,   58, X({ bagSlot: Y().int().min(0).max(159) }), `trade`)
 *   T$(`trade.setGold`,   59, X({ gold: Y().int().min(0) }), `trade`)
 *   T$(`trade.approve`,   60, X({ rev: Y().int().min(0) }), `trade`)
 *   T$(`trade.unapprove`, 61, X({}), `trade`)
 *   T$(`trade.confirm`,   62, X({ rev: Y().int().min(0) }), `trade`)
 *   T$(`trade.cancel`,    63, X({}), `trade`)
 *
 *   D$ = Y().int().min(1).max(1e3)                          (ofset 25609018)
 *
 * --- s2c kayitlari, ofset 25623254..25623740 ---
 *   T$(`trade.incoming`, 152, X({ fromId: Y().int(), fromName: J() }))
 *   T$(`trade.update`,   153, X({
 *          partnerId: Y().int(), partnerName: J(), rev: Y().int(),
 *          self:  X({ items: BJ(X({ bagSlot: Y().int(), stack: S$ })),
 *                     gold: Y().int(), approved: RJ() }),
 *          other: X({ items: BJ(X({                     stack: S$ })),
 *                     gold: Y().int(), approved: RJ() }) }))
 *   T$(`trade.close`,    154, X({ reason: qJ([`completed`,`declined`,
 *                                             `cancelled`,`partner_left`,`error`]) }))
 *
 *   DIKKAT: `other.items` icinde bagSlot YOKTUR. Karsi tarafin canta yuvasi
 *   asla sizdirilmaz — sadece yigin gorunur.
 *
 *   S$ = X({ itemId: J(), qty: Y().int().min(1),           (ofset 25593826)
 *            plus: Y().int().min(0).optional(),
 *            dur: Y().int().min(0).optional(),
 *            maxDur: Y().int().min(1).optional(),
 *            variance: Y().int().nonnegative().optional(),
 *            blues: BJ(X({ id: Y().int().positive(), value: Y() })).optional(),
 *            rolls: GJ(J(), Y()).optional() })
 *
 * --- err semasi, ofset 25631093 ---
 *   T$(`err`, 240, X({ code: qJ(Sht), key: qJ(Eht).optional(), msg: J().optional(),
 *                      q: Y().optional(), params: GJ(J(), VJ([J(),Y()])).optional() }))
 *   Sht (ofset 25602270) — kullandigim kodlar listede VAR (tek tek dogrulandi):
 *     ERR_VALIDATION, ERR_RANGE, ERR_BUSY, ERR_RATE, ERR_NOT_FOUND,
 *     ERR_BAG_FULL, ERR_NO_GOLD
 *   Eht (ofset 25606160) — kullandiklarim: `err.busy.trade_open`, `err.busy.downed`
 *
 * --- sys.notice semasi, ofset 25630955 ---
 *   T$(`sys.notice`, 195, X({ key: qJ(Tht), params: ..., display: ... }))
 *   Tht (ofset 25603308) icinden kullandiklarim
 *   (DORDU DE hem Tht listesinde hem tr.json'da var, grep ile dogrulandi):
 *     sys.trade.request_sent     "{name} adli oyuncuya takas istegi gonderildi."
 *     sys.trade.declined_by      "{name} takas istegini reddetti."
 *     sys.trade.completed_with   "{name} ile takas tamamlandi."
 *     sys.trade.failed_bag       "Takas basarisiz: {name} adli oyuncunun cantasinda yer yok."
 *   sys.trade.cancelled / declined / partner_left karelerini SUNUCU GONDERMEZ —
 *   onlari istemci trade.close'un reason alanina bakarak KENDISI basar
 *   (ofset 27127982). Ikinci kez gondermek satiri cift yazdirirdi.
 *   Not: bu uc anahtar Tht listesinde YOKTUR — zaten istemcinin kendi
 *   yerel satirlaridir, sunucu onlari sys.notice ile gonderemez de.
 *
 * ============================================================ ISTEMCI DAVRANISI
 * 1) Takas penceresi 12 yuvalidir:  nzt = 12  (ofset 27632518)
 *
 * 2) Cantadan pencereye SURUKLEYINCE istemci DAIMA `qty: 999` yollar
 *    (ofset 27633179). Yani 999 = "bu yiginin TAMAMI" demektir; gercek
 *    miktar degildir. Sunucu qty'yi yigindaki adede KIRPMAK ZORUNDADIR,
 *    yoksa 1 adet iksirden 999 adet uretilir.
 *
 * 3) Istemci surukleme sirasinda `h7(stack)` ile bir esyayi ELER
 *    (ofset 27160906):
 *        h7 = itemsById.get(itemId)?.type === `petScroll`
 *             && typeof stack.rolls?.petExpiresAt === `number`
 *    Yani SURELI (kiralik) evcil hayvan tomarlari takas edilemez. Sunucu da
 *    ayni kurali uygular — istemciye guvenmiyoruz.
 *
 * 4) Onay dugmesi `rev` alanini goruntudeki oturumdan alir
 *    (approve 27636715, confirm 27636890).
 *    Bu bir "iyimser kilit"tir: teklif degisince rev artar, elde kalan eski
 *    rev ile gelen approve/confirm REDDEDILIR. Ekranda gordugunden baskasini
 *    onaylamak imkansiz olur.
 *
 * 5) ui.trade.hint = "cantandan esya surukle · geri cekmek icin esyana sag
 *    tikla · degisiklikler onaylari sifirlar" — teklif/altin degisikligi
 *    IKI TARAFIN onayini da sifirlar. Kod bunu birebir uygular.
 *
 * 6) `trade.update` gelince istemci envanter penceresini de acar
 *    (ofset 27127900). Ek bir kare gerekmez.
 *
 * 7) Davet balonunun (azt(), ofset 27638255) KENDI zaman asimi YOKTUR.
 *    `incoming` alanini sadece oyuncunun cevabi ya da `trade.close` ->
 *    q$.clear() (store ofset 25657090) temizler. Bu yuzden sunucu bir daveti
 *    dusurdugu HER durumda (sure doldu / uzerine yeni davet / taraf dustu)
 *    hedefe trade.close yollamak ZORUNDA — yoksa balon asili kalir.
 *
 * 8) err isleyicisi (ofset 27134276): once `key` denenir, locale'de varsa o
 *    basilir; yoksa `err.<code>`e duser. `msg` SADECE console.warn'a gider,
 *    oyuncuya hic gosterilmez — bu yuzden msg alanlari tanilama amaclidir.
 *
 * ==================================================================== MENZIL
 * game-config.json icinde takasa OZEL bir menzil anahtari YOKTUR (tum
 * *RangeU anahtarlari tarandi: pickupRangeU 3, npcInteractRangeU 25,
 * targetSearchRangeU 75, pickupSearchRangeU 50, partyShareRangeU 150,
 * carrier.interactRangeU 25). Paketin kendisinde de istemci tarafi bir takas
 * mesafe kontrolu yok — hedef panelindeki "Takas" dugmesi mesafeye
 * bakmadan cizilir (ofset 27627806: hedef menusunde parti/lonca dugmelerinin
 * kapisi var, Takas'in HIC kapisi yok). [DENETIM: ofset duzeltildi, once
 * 27629488 yaziyordu; orasi taction/isinlanma istemi.]
 * game-config.json'da goldCap gibi bir anahtar da YOK; altin tavani icin
 * protokolun kendi tekrar eden tavani kullanildi: exch.withdrawGold /
 * bank.depositGold / bank.withdrawGold / stall fiyati hepsi max(2e9)
 * (ofset 25612741, 25613195, 25613295, 25614587).
 * Bu yuzden genel etkilesim menzili olan `npcInteractRangeU` (25 U)
 * kullaniliyor; ileride game-config'e `tradeRangeU` eklenirse o kazanir.
 * Menzil UC noktada zorlanir: istek, kabul, ve mallarin el degistirdigi an
 * (confirm). Aradaki dolasma serbesttir — bu yuzden uydurma bir "tasma
 * katsayisi" tanimlamadik.
 *
 * ================================================================== KALICILIK
 * Bu modul ch.bag / ch.gold uzerinde CALISIR ve degisikligi aninda
 * `inv.update` ile iki tarafa da yollar. Diske yazma cekirdegin kendi
 * kayit dongusune (server.js save() / konumuKaydet) ve envanter dalgasina
 * aittir; ayni satirlari iki yerden yazmamak icin burada SQL'e dokunmuyoruz.
 *
 * ================================================================ SAGLAMLIK
 * - Esya/altin dogrulamasi TAMAMEN sunucuda. Istemcinin gonderdigi hicbir
 *   miktar/yigin/isim veri kaynagi degil; sadece "hangi canta yuvasi".
 * - Takas ANINDA canta bosaltilmaz; mallar sadece confirm aninda ve
 *   ATOMIK olarak el degistirir (once benzetim, hepsi tutarsa yazma).
 * - Her guncelleme oncesi teklifler TAZELENIR: baska bir modul (envanter,
 *   dukkan, ganimet) esyayi kaydirdiysa/yok ettiyse teklif dusurulur ve
 *   onaylar sifirlanir. Boylece "yuva takasi" ile duplikasyon yapilamaz.
 * - Kopan baglanti / bolge degistirme / olum bir saniyelik nabizla yakalanir
 *   ve oturum `partner_left` ile kapatilir.
 *
 * ================================================================== DENETIM
 * Bagimsiz denetimde bulunup DUZELTILEN gercek kusurlar:
 *  1) cantaHazirla() cantayi GCFG.bagSlots'a kadar BUYUTUYORDU. 20 yuvali bir
 *     karakter takasa tek esya koyunca cantasi kalici olarak 32 yuvaya
 *     cikiyordu (bedava genisleme + _Char.InventorySize ile desenkron).
 *     Ayrica hicbir modulun yazmadigi uydurma bir `ch.bagSlots` alani
 *     okunuyordu. Artik uzunluga dokunulmuyor; kural sistem_envanter.normalize
 *     ve sistem_banka-depo.cantayiHazirla ile ayni.
 *  2) Davet suresi dolunca / uzerine yeni davet gelince hedefe HICBIR kare
 *     gitmiyordu; istemci balonunun kendi zaman asimi olmadigi icin balon
 *     ekranda asili kaliyor, "Kabul" dugmesi olu kaliyordu. Artik
 *     davetiKapat() hedefe trade.close yolluyor.
 *  3) Suresi dolmus daveti KABUL etmek tamamen sessizdi -> ERR_NOT_FOUND.
 *  4) Olu oyuncuya cipilak ERR_BUSY ("Mesgul — birazdan yeniden dene.")
 *     yollaniyordu. Eht listesinde `err.busy.downed` VAR ve tr.json'da
 *     karsiligi da var: "Yere serildin." Artik o kullaniliyor.
 *  5) guncellemeKaresi() bos yuvayi okuyup TypeError firlatabiliyordu
 *     (ws.char dusmus/tazelenmemis teklif). Artik gecersiz teklif atlanir.
 *  6) Hiz siniri damgasi hedef aramasindan SONRA basiliyordu; gecersiz
 *     hedefe yapilan istekler hic sinirlanmiyordu. Damga one alindi.
 */

/* ------------------------------------------------------------------ sabitler */

/** Takas penceresindeki yuva sayisi — paket: nzt = 12 (ofset 27634202). */
const YUVA_SAYISI = 12;

/** Istemcinin "tum yigin" anlamina gelen sabiti — paket: qty:999. */
const TUM_YIGIN = 999;

/** Altin tavani: protokolde altin `Y().int()`, exch.place fiyat tavani 2e9. */
const ALTIN_TAVANI = 2_000_000_000;

/** Takas isteklerinde spam kalkani (sunucu cekirdeginde hiz sinirlayici yok). */
const ISTEK_BEKLEME_MS = 2000;

/* ----------------------------------------------------- kucuk Zod aynasi */

class SemaHatasi extends Error {
  constructor(yol, sebep) {
    super(`${yol || '<kok>'}: ${sebep}`);
    this.yol = yol || '<kok>';
    this.sebep = sebep;
  }
}
const hata = (yol, sebep) => { throw new SemaHatasi(yol, sebep); };

function nesne(v) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) hata('', 'nesne bekleniyor');
  return v;
}
function tamSayi(v, yol, { enAz, enCok } = {}) {
  if (typeof v !== 'number' || !Number.isFinite(v)) hata(yol, 'sayi bekleniyor');
  if (!Number.isInteger(v)) hata(yol, 'tam sayi bekleniyor');
  if (enAz !== undefined && v < enAz) hata(yol, `en az ${enAz}`);
  if (enCok !== undefined && v > enCok) hata(yol, `en cok ${enCok}`);
  return v;
}
function mantik(v, yol) {
  if (typeof v !== 'boolean') hata(yol, 'mantiksal deger bekleniyor');
  return v;
}

/* X({...}) bilinmeyen anahtarlari ATAR; asagidaki semalar da sadece
   tanidiklari alani cikartir. */
const SEMALAR = {
  'trade.request':   (d) => ({ targetId: tamSayi(nesne(d).targetId, 'targetId') }),
  'trade.respond':   (d) => ({ accept: mantik(nesne(d).accept, 'accept') }),
  'trade.offerItem': (d) => ({
    bagSlot: tamSayi(nesne(d).bagSlot, 'bagSlot', { enAz: 0, enCok: 383 }),   // SARTNAME-3 MADDE 11: 383 = 12 sayfa x 32 - 1
    qty: tamSayi(nesne(d).qty, 'qty', { enAz: 1, enCok: 1000 }),
  }),
  'trade.retract':   (d) => ({ bagSlot: tamSayi(nesne(d).bagSlot, 'bagSlot', { enAz: 0, enCok: 383 }) }),   // SARTNAME-3 MADDE 11
  'trade.setGold':   (d) => ({ gold: tamSayi(nesne(d).gold, 'gold', { enAz: 0 }) }),
  'trade.approve':   (d) => ({ rev: tamSayi(nesne(d).rev, 'rev', { enAz: 0 }) }),
  'trade.unapprove': (d) => { nesne(d); return {}; },
  'trade.confirm':   (d) => ({ rev: tamSayi(nesne(d).rev, 'rev', { enAz: 0 }) }),
  'trade.cancel':    (d) => { nesne(d); return {}; },
};

/* ------------------------------------------------------- yardimci: kararli JSON
   Iki yigini "ayni esya mi" diye kiyaslarken anahtar sirasi onemli olmasin
   diye ozyinelemeli sirali seri hale getirme. */
function duzenliJson(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(duzenliJson).join(',')}]`;
  const anahtarlar = Object.keys(v).filter((k) => v[k] !== undefined).sort();
  return `{${anahtarlar.map((k) => `${JSON.stringify(k)}:${duzenliJson(v[k])}`).join(',')}}`;
}
/** Yigin kimligi = adet DISINDA her sey. Ayni kimlik = birlestirilebilir. */
function yiginKimligi(st) {
  if (!st || typeof st !== 'object') return 'null';
  const kopya = {};
  for (const [k, val] of Object.entries(st)) if (k !== 'qty') kopya[k] = val;
  return duzenliJson(kopya);
}

/* ================================================================== modul */

/* ============================================== ORNEK OMRU (KALICILIK DEGIL)
 * server.js `sistemleriKur()` (server.js:1337) TUM modulleri bastan kuruyor -
 * acilista iki kez, sonra admin panelindeki her ayar degisiminde. Eski ornegin
 * 1 sn'lik `nabizSayaci` INTERVAL'i durdurulmuyordu: her kurulumda nabiz bir
 * kat daha hizli donuyor, ayrica devam eden takas oturumlari sunucuda yok
 * olurken istemcilerde takas penceresi ACIK kaliyordu (trade.closed hic
 * gitmiyor).
 *
 * DIKKAT: bu KALICILIK DEGIL. Aktif takas oturumu bilerek GECICIDIR - iki
 * canli soketin ortak durumu; birinin kopmasi zaten `partner_left` ile takasi
 * kapatiyor (nabiz), ve pakette takasi diske yazan hicbir kare/tablo yok.
 * Burada yapilan tek sey: eski ornek olurken oturumlari DUZGUN kapatmak.
 */
let ONCEKI_ORNEK = null;

export function kur(ctx) {
  if (ONCEKI_ORNEK) {
    try { ONCEKI_ORNEK.kapatModul(); } catch { /* zaten kapali */ }
    ONCEKI_ORNEK = null;
  }
  const {
    world = null,
    frame,
    log = () => {},
    GCFG = {},
    ITEMSTATS = null,
    envanterPayload = null,
  } = ctx || {};

  if (typeof frame !== 'function') throw new Error('sistem_ticaret: ctx.frame gerekli');

  /* Takas menzili — yukaridaki MENZIL notuna bak. */
  const MENZIL = (() => {
    const ozel = Number(GCFG?.tradeRangeU);
    if (Number.isFinite(ozel) && ozel > 0) return ozel;
    const genel = Number(GCFG?.npcInteractRangeU);
    return Number.isFinite(genel) && genel > 0 ? genel : 25;
  })();

  /** hedefWs -> { kaynak: ws, bitis: ms }  (bekleyen davetler) */
  const gelenIstek = new Map();
  /** kaynakWs -> hedefWs */
  const gidenIstek = new Map();
  /** acik oturumlar */
  const oturumlar = new Set();

  /* Davet zaman asimi: takasa ozel anahtar yok, parti davetininki yeniden
     kullaniliyor (game-config.partyInviteTimeoutMs = 30000). */
  const DAVET_SURESI_MS = Number.isFinite(Number(GCFG?.partyInviteTimeoutMs))
    ? Number(GCFG.partyInviteTimeoutMs) : 30_000;

  /* ------------------------------------------------------------ kucuk yardimcilar */

  const simdi = () => Date.now();
  const acikMi = (ws) => !!ws && ws.readyState === (ws.OPEN ?? 1) && !!ws.char && ws.isAuthed !== false;
  const canliMi = (ws) => acikMi(ws) && !ws.char.dead;

  function esyaTanim(itemId) {
    if (!ITEMSTATS) return null;
    if (typeof ITEMSTATS.get === 'function') return ITEMSTATS.get(itemId) ?? null;
    return ITEMSTATS[itemId] ?? null;
  }
  function yiginSiniri(itemId) {
    const n = Number(esyaTanim(itemId)?.stackMax);
    return Number.isInteger(n) && n > 0 ? n : 1;
  }
  /** Paketteki h7 kurali: sureli evcil hayvan tomari takas edilemez. */
  function takasEdilebilir(st) {
    if (!st || typeof st.itemId !== 'string') return false;
    const def = esyaTanim(st.itemId);
    if (def?.type === 'petScroll' && typeof st?.rolls?.petExpiresAt === 'number') return false;
    return true;
  }

  /**
   * Cantayi normalize eder ve boyu doner.
   *
   * DENETIM DUZELTMESI: eski surum cantayi GCFG.bagSlots'a kadar BUYUTUYORDU
   * (`while (ch.bag.length < kapasite) push(null)`), ayrica hicbir modulun
   * YAZMADIGI uydurma bir `ch.bagSlots` alanini okuyordu. 20 yuvali bir
   * karakter takas penceresine tek esya koyunca cantasi kalici olarak 32
   * yuvaya cikiyordu — yani bedava canta genislemesi, uzerine de
   * _Char.InventorySize ile desenkron.
   *
   * Canta boyunun TEK sahibi bagExpand'dir (sistem_banka-depo.genislet, orada
   * _Char.InventorySize'a da yazilir). Burada uzunluga ASLA dokunulmaz;
   * kural sistem_envanter.normalize / sistem_banka-depo.cantayiHazirla ile ayni:
   * dizi varsa uzunlugu korunur, yoksa GCFG.bagSlots ile yaratilir.
   */
  function cantaHazirla(ch) {
    const varsayilan = Number.isInteger(GCFG?.bagSlots) && GCFG.bagSlots > 0 ? GCFG.bagSlots : 32;
    if (!Array.isArray(ch.bag) || ch.bag.length === 0) ch.bag = new Array(varsayilan).fill(null);
    for (let i = 0; i < ch.bag.length; i++) if (ch.bag[i] === undefined) ch.bag[i] = null;
    return ch.bag.length;
  }

  function altin(ch) {
    const g = Number(ch?.gold);
    return Number.isFinite(g) && g > 0 ? Math.floor(g) : 0;
  }

  function hatayaGonder(ws, code, { key, msg } = {}) {
    const d = { code };
    if (key) d.key = key;
    if (msg) d.msg = String(msg).slice(0, 200);
    frame(ws, 'err', d);
  }

  function bildir(ws, key, params) {
    frame(ws, 'sys.notice', params ? { key, params } : { key });
  }

  /** Bolgedeki oyuncu soketleri — world yoksa bos. */
  function bolgeOyunculari(zoneId) {
    if (world && typeof world.bolgeOyunculari === 'function') {
      try { return world.bolgeOyunculari(zoneId) ?? []; } catch { return []; }
    }
    return [];
  }
  function varlikBul(ws, entityId) {
    for (const c of bolgeOyunculari(ws.zoneId)) {
      if (c !== ws && c.entityId === entityId && acikMi(c)) return c;
    }
    return null;
  }
  function uzaklik(a, b) {
    const dx = (a.char.x ?? 0) - (b.char.x ?? 0);
    const dz = (a.char.z ?? 0) - (b.char.z ?? 0);
    return Math.hypot(dx, dz);
  }
  function menzildeMi(a, b) {
    return a.zoneId === b.zoneId && uzaklik(a, b) <= MENZIL;
  }

  /* ------------------------------------------------------------------- oturum */

  function yeniOturum(a, b) {
    const oturum = {
      rev: 0,
      taraflar: [a, b],
      durum: new Map([
        [a, { esyalar: [], gold: 0, onay: false, kesin: false }],
        [b, { esyalar: [], gold: 0, onay: false, kesin: false }],
      ]),
      kapali: false,
    };
    a._takas = oturum; b._takas = oturum;
    oturumlar.add(oturum);
    return oturum;
  }
  const oturumBul = (ws) => (ws && ws._takas && !ws._takas.kapali ? ws._takas : null);
  const karsiTaraf = (oturum, ws) => (oturum.taraflar[0] === ws ? oturum.taraflar[1] : oturum.taraflar[0]);

  /**
   * Oturumu kapatir. `sebepler` ya tek bir metin ya da Map<ws, metin>.
   * reason enum'u: completed | declined | cancelled | partner_left | error
   */
  function kapat(oturum, sebepler) {
    if (!oturum || oturum.kapali) return;
    oturum.kapali = true;
    oturumlar.delete(oturum);
    for (const ws of oturum.taraflar) {
      if (ws._takas === oturum) ws._takas = null;
      const sebep = typeof sebepler === 'string' ? sebepler : (sebepler.get(ws) ?? 'cancelled');
      if (acikMi(ws)) frame(ws, 'trade.close', { reason: sebep });
    }
  }

  /* ---------------------------------------------------- teklif tazeleme + kare */

  /**
   * Baska bir modul cantayi degistirdiyse teklifleri gecerli hale getirir.
   * Bir sey dustuyse onaylari sifirlar ve rev'i artirir -> istemcinin elindeki
   * eski rev otomatik gecersizlesir.
   */
  function teklifleriTazele(oturum) {
    let degisti = false;
    for (const ws of oturum.taraflar) {
      const taraf = oturum.durum.get(ws);
      const ch = ws.char;
      if (!ch) {
        /* Soket karakterini kaybetti (cikis). Teklifi AYAKTA BIRAKMA: nabiz
           oturumu bir saniye icinde kapatacak ama o ana kadar dogrulanmamis
           bir teklif duruyor olurdu. */
        if (taraf.esyalar.length || taraf.gold) { taraf.esyalar = []; taraf.gold = 0; degisti = true; }
        continue;
      }
      cantaHazirla(ch);
      const kalanlar = [];
      for (const t of taraf.esyalar) {
        const st = ch.bag[t.bagSlot];
        if (!st || yiginKimligi(st) !== t.kimlik || (Number(st.qty) || 0) < t.qty || !takasEdilebilir(st)) {
          degisti = true;
          continue;
        }
        kalanlar.push(t);
      }
      if (kalanlar.length !== taraf.esyalar.length) taraf.esyalar = kalanlar;
      const kasa = altin(ch);
      if (taraf.gold > kasa) { taraf.gold = kasa; degisti = true; }
    }
    if (degisti) sifirla(oturum);
    return degisti;
  }

  /** Teklif degisti: iki tarafin onayi da duser, rev artar. */
  function sifirla(oturum) {
    oturum.rev++;
    for (const taraf of oturum.durum.values()) { taraf.onay = false; taraf.kesin = false; }
  }

  /** Bag yiginindan protokole uygun TEMIZ bir S$ nesnesi uretir. */
  function yiginPayload(st, qty) {
    const out = { itemId: String(st.itemId), qty: Math.max(1, Math.floor(qty)) };
    if (Number.isFinite(st.plus)) out.plus = Math.max(0, Math.round(st.plus));
    if (Number.isFinite(st.dur)) out.dur = Math.max(0, Math.round(st.dur));
    if (Number.isFinite(st.maxDur)) out.maxDur = Math.max(1, Math.round(st.maxDur));
    if (Number.isFinite(st.variance)) out.variance = Math.max(0, Math.round(st.variance));
    if (Array.isArray(st.blues)) {
      const b = st.blues
        .filter((x) => x && Number.isInteger(x.id) && x.id > 0 && Number.isFinite(x.value))
        .map((x) => ({ id: x.id, value: x.value }));
      if (b.length) out.blues = b;
    }
    if (st.rolls && typeof st.rolls === 'object' && !Array.isArray(st.rolls)) {
      const r = {};
      for (const [k, v] of Object.entries(st.rolls)) if (Number.isFinite(v)) r[k] = v;
      if (Object.keys(r).length) out.rolls = r;
    }
    return out;
  }

  /**
   * Bir tarafin teklif listesini S$ kareye cevirir.
   * `yuvaGoster` YALNIZCA kendi tarafinda true olur — sema oyle diyor ve
   * karsi tarafin canta yuvasi asla sizdirilmaz.
   *
   * Bos/gecersiz yuvayi ATLAR: teklifleriTazele bunlari zaten dusuruyor, ama
   * kare uretimi tazelemeden gecmemis bir yoldan cagrilirsa (ya da ws.char
   * dustuyse) burada `null.itemId` okuyup TypeError firlatiyordu. Tek bir
   * kopmus soket butun oturumu kilitleyebilirdi.
   */
  function taraflarinKaresi(taraf, sahip, yuvaGoster) {
    const bag = Array.isArray(sahip?.char?.bag) ? sahip.char.bag : null;
    const out = [];
    for (const t of taraf.esyalar) {
      const st = bag ? bag[t.bagSlot] : null;
      if (!st || typeof st.itemId !== 'string') continue;
      const g = yiginPayload(st, t.qty);
      out.push(yuvaGoster ? { bagSlot: t.bagSlot, stack: g } : { stack: g });
    }
    return out;
  }

  function guncellemeKaresi(oturum, ws) {
    const digerWs = karsiTaraf(oturum, ws);
    const ben = oturum.durum.get(ws);
    const o = oturum.durum.get(digerWs);
    return {
      partnerId: digerWs.entityId ?? 0,
      partnerName: String(digerWs.char?.name ?? ''),
      rev: oturum.rev,
      self: {
        // KENDI tarafinda bagSlot VAR — istemci sag tikla geri cekmek icin kullaniyor.
        items: taraflarinKaresi(ben, ws, true),
        gold: ben.gold,
        approved: ben.onay,
      },
      other: {
        // KARSI tarafta bagSlot YOK (sema oyle) — yuva bilgisi sizmaz.
        items: taraflarinKaresi(o, digerWs, false),
        gold: o.gold,
        approved: o.onay,
      },
    };
  }

  function guncellemeYolla(oturum) {
    for (const ws of oturum.taraflar) {
      if (acikMi(ws)) frame(ws, 'trade.update', guncellemeKaresi(oturum, ws));
    }
  }

  /* ------------------------------------------------------------ takas benzetimi */

  function benzetimAl(ch) {
    cantaHazirla(ch);
    return {
      canta: ch.bag.map((st) => (st ? { ...st } : null)),
      gold: altin(ch),
    };
  }
  function benzetimdenCikar(sim, teklifler) {
    for (const t of teklifler) {
      const st = sim.canta[t.bagSlot];
      if (!st || (Number(st.qty) || 0) < t.qty) return false;
      if (Number(st.qty) === t.qty) sim.canta[t.bagSlot] = null;
      else st.qty = Number(st.qty) - t.qty;
    }
    return true;
  }
  /** Yigini benzetime yerlestirir: once ayni kimlikli yiginlara doldurur. */
  function benzetimeEkle(sim, yigin) {
    const sinir = yiginSiniri(yigin.itemId);
    const kimlik = yiginKimligi(yigin);
    let kalan = Number(yigin.qty) || 0;
    if (kalan <= 0) return true;
    if (sinir > 1) {
      for (let i = 0; i < sim.canta.length && kalan > 0; i++) {
        const s = sim.canta[i];
        if (!s || s.itemId !== yigin.itemId) continue;
        const adet = Number(s.qty) || 0;
        if (adet >= sinir || yiginKimligi(s) !== kimlik) continue;
        const al = Math.min(sinir - adet, kalan);
        s.qty = adet + al; kalan -= al;
      }
    }
    while (kalan > 0) {
      const bos = sim.canta.indexOf(null);
      if (bos < 0) return false;
      const al = Math.min(sinir, kalan);
      sim.canta[bos] = { ...yigin, qty: al };
      kalan -= al;
    }
    return true;
  }

  /* ------------------------------------------------------------ takasi isle */

  function takasiIsle(oturum) {
    const [a, b] = oturum.taraflar;
    const ta = oturum.durum.get(a);
    const tb = oturum.durum.get(b);

    if (!canliMi(a) || !canliMi(b)) {
      kapat(oturum, 'partner_left');
      return false;
    }
    if (!menzildeMi(a, b)) {
      for (const ws of oturum.taraflar) hatayaGonder(ws, 'ERR_RANGE');
      // Menzil disinda kalmak takasi bitirmez; oyuncular yaklasip yeniden onaylar.
      sifirla(oturum);
      guncellemeYolla(oturum);
      return false;
    }

    // Verilecek yiginlarin GERCEK kopyalari (istemcinin gonderdigi hicbir sey degil).
    const verilenA = ta.esyalar.map((t) => ({ ...a.char.bag[t.bagSlot], qty: t.qty }));
    const verilenB = tb.esyalar.map((t) => ({ ...b.char.bag[t.bagSlot], qty: t.qty }));

    const simA = benzetimAl(a.char);
    const simB = benzetimAl(b.char);

    if (!benzetimdenCikar(simA, ta.esyalar) || !benzetimdenCikar(simB, tb.esyalar)) {
      basarisiz(oturum, 'esya artik cantada yok');
      return false;
    }
    if (simA.gold < ta.gold || simB.gold < tb.gold) {
      for (const ws of oturum.taraflar) hatayaGonder(ws, 'ERR_NO_GOLD');
      basarisiz(oturum, 'altin yetersiz');
      return false;
    }
    simA.gold -= ta.gold; simB.gold -= tb.gold;
    simA.gold += tb.gold; simB.gold += ta.gold;
    if (simA.gold > ALTIN_TAVANI || simB.gold > ALTIN_TAVANI) {
      for (const ws of oturum.taraflar) hatayaGonder(ws, 'ERR_VALIDATION', { msg: 'altin tavani asildi' });
      basarisiz(oturum, 'altin tavani');
      return false;
    }

    for (const y of verilenB) {
      if (!benzetimeEkle(simA, y)) { cantaDolu(oturum, a, b); return false; }
    }
    for (const y of verilenA) {
      if (!benzetimeEkle(simB, y)) { cantaDolu(oturum, b, a); return false; }
    }

    // Buraya kadar geldiysek her sey tutuyor — TEK SEFERDE yaz.
    a.char.bag = simA.canta; a.char.gold = simA.gold;
    b.char.bag = simB.canta; b.char.gold = simB.gold;

    for (const ws of oturum.taraflar) {
      if (!acikMi(ws)) continue;
      if (typeof envanterPayload === 'function') frame(ws, 'inv.update', envanterPayload(ws.char));
      bildir(ws, 'sys.trade.completed_with', { name: String(karsiTaraf(oturum, ws).char?.name ?? '') });
    }
    kapat(oturum, 'completed');
    log(`takas tamam: ${a.char.name} <-> ${b.char.name} `
      + `(${verilenA.length}/${ta.gold} <-> ${verilenB.length}/${tb.gold})`);
    return true;
  }

  /** `dolanWs`'in cantasi yetmedi; iki tarafa da anlasilir sebep gonder. */
  function cantaDolu(oturum, dolanWs, digerWs) {
    hatayaGonder(dolanWs, 'ERR_BAG_FULL');
    bildir(digerWs, 'sys.trade.failed_bag', { name: String(dolanWs.char?.name ?? '') });
    basarisiz(oturum, 'canta dolu');
  }

  function basarisiz(oturum, neden) {
    log(`takas basarisiz (${neden})`);
    kapat(oturum, 'error');
  }

  /* -------------------------------------------------------------- davet islemleri */

  function davetiSil(kaynak, hedef) {
    if (hedef && gelenIstek.get(hedef)?.kaynak === kaynak) gelenIstek.delete(hedef);
    if (kaynak && gidenIstek.get(kaynak) === hedef) gidenIstek.delete(kaynak);
  }

  /**
   * Daveti dusurur VE hedefin ekranindaki davet balonunu kapatir.
   *
   * DENETIM DUZELTMESI: istemcinin davet balonunda (azt(), ofset 27638255)
   * KENDI zaman asimi YOKTUR; `incoming` alanini yalnizca iki sey temizler:
   * oyuncunun kendi cevabi (setIncoming(null)) ya da `trade.close` ->
   * q$.clear() (store ofset 25657090). Sunucu daveti sessizce dusurunce
   * balon ekranda ASILI KALIYOR ve "Kabul" dugmesi olu bir dugmeye
   * donusuyordu (cevap() kayit bulamayip sessiz donuyordu).
   * Bu yuzden daveti biz dusurdugumuz her yerde hedefe trade.close yolluyoruz.
   * Istekciye kare gitmez: istemcide "giden davet" diye bir durum yok,
   * gonderirsek yalnizca gereksiz "Takas iptal edildi." satiri basardi.
   */
  function davetiKapat(kaynak, hedef) {
    davetiSil(kaynak, hedef);
    if (acikMi(hedef)) frame(hedef, 'trade.close', { reason: 'cancelled' });
  }

  /* ------------------------------------------------------------------ nabiz
     Cekirdek modullere 'close' olayi bildirmiyor; kopan baglantiyi,
     bolge degisimini ve olumu bu saniyelik nabiz yakalar. */
  function nabiz() {
    const t = simdi();
    for (const [hedef, kayit] of [...gelenIstek]) {
      // Suresi doldu / taraflardan biri dustu -> daveti dusur ve hedefin
      // balonunu kapat (bkz. davetiKapat aciklamasi).
      if (t > kayit.bitis || !acikMi(hedef) || !acikMi(kayit.kaynak)) davetiKapat(kayit.kaynak, hedef);
    }
    for (const oturum of [...oturumlar]) {
      const [a, b] = oturum.taraflar;
      const aVar = canliMi(a), bVar = canliMi(b);
      if (aVar && bVar && a.zoneId === b.zoneId) continue;
      const sebepler = new Map();
      sebepler.set(a, bVar && a.zoneId === b.zoneId ? 'cancelled' : 'partner_left');
      sebepler.set(b, aVar && a.zoneId === b.zoneId ? 'cancelled' : 'partner_left');
      kapat(oturum, sebepler);
    }
  }
  const nabizSayaci = setInterval(nabiz, 1000);
  if (typeof nabizSayaci.unref === 'function') nabizSayaci.unref();

  /* ============================================================ mesaj isleyiciler */

  function istek(ws, d) {
    const ch = ws.char;
    if (oturumBul(ws)) { hatayaGonder(ws, 'ERR_BUSY', { key: 'err.busy.trade_open' }); return; }
    /* err.ERR_DEAD ceviri anahtari HICBIR dilde yok; ama Eht listesinde
       `err.busy.downed` VAR (ofset 25606160) ve tr.json'da karsiligi da var:
       "Yere serildin." Eskiden cipilak ERR_BUSY yollaniyordu, o da
       "Mesgul — birazdan yeniden dene." diye alakasiz bir satir basiyordu. */
    /* Tezgah acikken takas YOK. tr.json err.busy.stall_open =
       "Tezgahin acikken olmaz." ve anahtar Eht (err.key) enum'unda VAR
       (paket @25607034 listesi). Arayuz de ownStallOpen iken HER tiklamayi
       yok sayiyor (paket @25677424 lgt: `if (node.id === s.selfId ||
       s.ownStallOpen) return {t:'ignore'}`), yani mesru istemci bu kareyi
       zaten gondermez - kapi yamali istemciye karsi.
       Bayragi sistem_tezgah.js sokete yaziyor (sahipTezgah ile birebir omur);
       modul yoksa alan undefined kalir ve davranis eskisi gibi surer. */
    if (ws.tezgahAcik) { hatayaGonder(ws, 'ERR_BUSY', { key: 'err.busy.stall_open' }); return; }
    if (ch.dead) { hatayaGonder(ws, 'ERR_BUSY', { key: 'err.busy.downed' }); return; }
    const bekle = ws._takasIstekZamani ?? 0;
    if (simdi() - bekle < ISTEK_BEKLEME_MS) { hatayaGonder(ws, 'ERR_RATE'); return; }
    /* Damgayi hedef aramasindan ONCE bas: aksi halde gecersiz hedefe yapilan
       istekler hiz sinirina hic takilmiyor ve her biri bolgedeki tum
       oyunculari tarayan bedava bir dongu aciyordu. */
    ws._takasIstekZamani = simdi();

    const hedef = varlikBul(ws, d.targetId);
    if (!hedef || !canliMi(hedef)) { hatayaGonder(ws, 'ERR_NOT_FOUND'); return; }
    if (!menzildeMi(ws, hedef)) { hatayaGonder(ws, 'ERR_RANGE'); return; }
    /* Hedefin tezgahi acikken de takas kurulamaz. Burada ANAHTAR VERILMEZ:
       err.busy.stall_open metni "Tezgahin acikken olmaz." - ikinci tekil sahis,
       yani BASKASININ tezgahi icin yaniltici olur. Cipilak ERR_BUSY
       ("Mesgul - birazdan yeniden dene.") dogru ozne. */
    if (oturumBul(hedef) || gelenIstek.has(hedef) || hedef.tezgahAcik) { hatayaGonder(ws, 'ERR_BUSY'); return; }

    // Ayni anda tek giden davet: eskisini dusur ve o hedefin balonunu kapat.
    const eskiHedef = gidenIstek.get(ws);
    if (eskiHedef && eskiHedef !== hedef) davetiKapat(ws, eskiHedef);
    else davetiSil(ws, eskiHedef);
    gelenIstek.set(hedef, { kaynak: ws, bitis: simdi() + DAVET_SURESI_MS });
    gidenIstek.set(ws, hedef);

    frame(hedef, 'trade.incoming', { fromId: ws.entityId ?? 0, fromName: String(ch.name ?? '') });
    bildir(ws, 'sys.trade.request_sent', { name: String(hedef.char?.name ?? '') });
  }

  function cevap(ws, d) {
    const kayit = gelenIstek.get(ws);
    if (!kayit) {
      /* Davet yok / suresi dolmus. Reddetmek zaten sonucsuz -> sessiz.
         Ama KABUL edildiyse sessiz kalmak olur: oyuncu dugmeye basiyor ve
         hicbir sey olmuyor. En azindan hedefin ucup gittigini soyle. */
      if (d.accept) hatayaGonder(ws, 'ERR_NOT_FOUND');
      return;
    }
    const kaynak = kayit.kaynak;
    davetiSil(kaynak, ws);

    if (!d.accept) {
      if (acikMi(kaynak)) bildir(kaynak, 'sys.trade.declined_by', { name: String(ws.char?.name ?? '') });
      return;
    }
    // Kabul: her sarti YENIDEN dogrula (davet gonderildiginden beri her sey degismis olabilir).
    if (!canliMi(ws)) { hatayaGonder(ws, 'ERR_BUSY', { key: 'err.busy.downed' }); return; }
    if (!canliMi(kaynak)) { hatayaGonder(ws, 'ERR_NOT_FOUND'); return; }
    if (oturumBul(kaynak) || oturumBul(ws)) { hatayaGonder(ws, 'ERR_BUSY', { key: 'err.busy.trade_open' }); return; }
    /* Davet gonderildikten sonra iki taraftan biri tezgah acmis olabilir -
       kabul aninda yeniden bak (bkz. istek() icindeki ayni kapi). Anahtar
       yalniz KENDI tezgahi icin verilir; kaynaginki icin cipilak ERR_BUSY. */
    if (ws.tezgahAcik) { hatayaGonder(ws, 'ERR_BUSY', { key: 'err.busy.stall_open' }); return; }
    if (kaynak.tezgahAcik) { hatayaGonder(ws, 'ERR_BUSY'); return; }
    if (!menzildeMi(ws, kaynak)) {
      hatayaGonder(ws, 'ERR_RANGE'); hatayaGonder(kaynak, 'ERR_RANGE');
      return;
    }
    const oturum = yeniOturum(kaynak, ws);
    guncellemeYolla(oturum);
    log(`takas acildi: ${kaynak.char.name} <-> ${ws.char.name}`);
  }

  function esyaKoy(ws, d) {
    const oturum = oturumBul(ws);
    if (!oturum) return;
    teklifleriTazele(oturum);
    const ch = ws.char;
    cantaHazirla(ch);

    const st = ch.bag[d.bagSlot];
    if (!st || typeof st.itemId !== 'string') { hatayaGonder(ws, 'ERR_NOT_FOUND'); guncellemeYolla(oturum); return; }
    if (!takasEdilebilir(st)) {
      /* Paketteki h7 kurali: sureli (aktiflestirilmis) evcil hayvan tomari.
         ONCEKI HAL `msg: 'bu esya takas edilemez'` idi; `msg` alani oyuncuya
         GOSTERILMEZ, yalnizca console.warn'a duser (paket @27135789), yani
         reddin gorunur bir metni yoktu ve 15 dilde ham Turkce tasiyordu.
         Eht (err.key) enum'unda tam karsiligi var: err.pet.activated_bound
         (paket @25607427) - tr.json: "Aktiflestirilmis pet sana baglidir -
         takas edilemez veya tezgaha konamaz." Ayni anahtar tezgah tarafinda
         da kullaniliyor (sistem_tezgah.js ilanlariCoz). */
      hatayaGonder(ws, 'ERR_VALIDATION', { key: 'err.pet.activated_bound' });
      guncellemeYolla(oturum); return;
    }
    const eldeki = Math.max(0, Math.floor(Number(st.qty) || 0));
    if (eldeki <= 0) { hatayaGonder(ws, 'ERR_NOT_FOUND'); guncellemeYolla(oturum); return; }

    /* Istemci surukleyince DAIMA 999 yollar = "tum yigin". Her halukarda
       eldeki adede kirpiyoruz; miktari istemciden ALMIYORUZ. */
    const adet = Math.min(d.qty === TUM_YIGIN ? eldeki : d.qty, eldeki);

    const taraf = oturum.durum.get(ws);
    const mevcut = taraf.esyalar.find((x) => x.bagSlot === d.bagSlot);
    if (!mevcut && taraf.esyalar.length >= YUVA_SAYISI) {
      hatayaGonder(ws, 'ERR_BAG_FULL', { msg: `takas penceresi ${YUVA_SAYISI} yuva` });
      guncellemeYolla(oturum); return;
    }
    if (mevcut) { mevcut.qty = adet; mevcut.kimlik = yiginKimligi(st); }
    else taraf.esyalar.push({ bagSlot: d.bagSlot, qty: adet, kimlik: yiginKimligi(st) });

    sifirla(oturum);
    guncellemeYolla(oturum);
  }

  function geriCek(ws, d) {
    const oturum = oturumBul(ws);
    if (!oturum) return;
    teklifleriTazele(oturum);
    const taraf = oturum.durum.get(ws);
    const once = taraf.esyalar.length;
    taraf.esyalar = taraf.esyalar.filter((x) => x.bagSlot !== d.bagSlot);
    if (taraf.esyalar.length !== once) sifirla(oturum);
    guncellemeYolla(oturum);
  }

  function altinKoy(ws, d) {
    const oturum = oturumBul(ws);
    if (!oturum) return;
    teklifleriTazele(oturum);
    const kasa = altin(ws.char);
    if (d.gold > kasa) { hatayaGonder(ws, 'ERR_NO_GOLD'); guncellemeYolla(oturum); return; }
    const taraf = oturum.durum.get(ws);
    if (taraf.gold !== d.gold) { taraf.gold = d.gold; sifirla(oturum); }
    guncellemeYolla(oturum);
  }

  function onayla(ws, d) {
    const oturum = oturumBul(ws);
    if (!oturum) return;
    if (teklifleriTazele(oturum)) { guncellemeYolla(oturum); hatayaGonder(ws, 'ERR_VALIDATION', { msg: 'teklif degisti' }); return; }
    if (d.rev !== oturum.rev) {
      // Iyimser kilit: ekranda gordugu teklif artik gecerli degil.
      hatayaGonder(ws, 'ERR_VALIDATION', { msg: 'teklif degisti' });
      guncellemeYolla(oturum); return;
    }
    const taraf = oturum.durum.get(ws);
    if (!taraf.onay) { taraf.onay = true; guncellemeYolla(oturum); }
  }

  function onayKaldir(ws) {
    const oturum = oturumBul(ws);
    if (!oturum) return;
    teklifleriTazele(oturum);
    const taraf = oturum.durum.get(ws);
    taraf.onay = false;
    for (const t of oturum.durum.values()) t.kesin = false;   // onay dusunce kesinlik de duser
    guncellemeYolla(oturum);
  }

  function kesinle(ws, d) {
    const oturum = oturumBul(ws);
    if (!oturum) return;
    if (teklifleriTazele(oturum)) { guncellemeYolla(oturum); hatayaGonder(ws, 'ERR_VALIDATION', { msg: 'teklif degisti' }); return; }
    if (d.rev !== oturum.rev) {
      hatayaGonder(ws, 'ERR_VALIDATION', { msg: 'teklif degisti' });
      guncellemeYolla(oturum); return;
    }
    const hepsiOnayli = [...oturum.durum.values()].every((t) => t.onay);
    if (!hepsiOnayli) { hatayaGonder(ws, 'ERR_VALIDATION', { msg: 'iki taraf da onaylamali' }); return; }
    oturum.durum.get(ws).kesin = true;
    if ([...oturum.durum.values()].every((t) => t.kesin)) takasiIsle(oturum);
  }

  function iptal(ws) {
    const oturum = oturumBul(ws);
    if (oturum) { kapat(oturum, 'cancelled'); return; }
    /* Oturum yoksa bu bir davet iptalidir: hem gonderdigim hem bana gelen
       daveti dusuruyorum. Istemcinin pencere kapatma dugmesi de bu yolu
       kullaniyor (ofset 27635519). */
    const hedef = gidenIstek.get(ws);
    if (hedef) {
      davetiSil(ws, hedef);
      if (acikMi(hedef)) frame(hedef, 'trade.close', { reason: 'cancelled' });
    }
    const gelen = gelenIstek.get(ws);
    if (gelen) {
      davetiSil(gelen.kaynak, ws);
      if (acikMi(gelen.kaynak)) bildir(gelen.kaynak, 'sys.trade.declined_by', { name: String(ws.char?.name ?? '') });
    }
  }

  const ISLEYICILER = {
    'trade.request': istek,
    'trade.respond': cevap,
    'trade.offerItem': esyaKoy,
    'trade.retract': geriCek,
    'trade.setGold': altinKoy,
    'trade.approve': onayla,
    'trade.unapprove': onayKaldir,
    'trade.confirm': kesinle,
    'trade.cancel': iptal,
  };

  /* ------------------------------------------------------------ yonlendirici */

  function mesaj(ws, t, d) {
    const isleyici = ISLEYICILER[t];
    if (!isleyici) return false;                 // ilgilenmiyoruz -> router devam etsin
    if (!ws?.char) return true;                  // karaktersiz soket: yut

    let temiz;
    try {
      temiz = SEMALAR[t](d ?? {});
    } catch (e) {
      const neden = e instanceof SemaHatasi ? e.message : String(e?.message ?? e);
      log(`${t} reddedildi (${ws.char.name ?? ws.char.id}): ${neden}`);
      hatayaGonder(ws, 'ERR_VALIDATION', { msg: `${t}: ${neden}` });
      return true;
    }
    isleyici(ws, temiz);
    return true;
  }

  const ORNEK = {
    mesaj,
    /* --- disariya acilan yardimcilar (server.js kullanmiyor, ileriye donuk) --- */
    /** Bu soket su an takasta mi? Diger moduller `err.busy.trade_open` icin kullanabilir. */
    takastaMi: (ws) => !!oturumBul(ws),
    /** Bir oyuncunun takasini disaridan iptal et (olum, isinlanma, GM ...). */
    iptalEt: (ws, sebep = 'cancelled') => { const o = oturumBul(ws); if (o) kapat(o, sebep); },
    /** Elle nabiz — birim testi icin. */
    nabiz,
    /** Tanilama. */
    durum: () => ({ oturum: oturumlar.size, davet: gelenIstek.size, menzil: MENZIL }),
    /** Ornegi kapat: nabzi durdur ve acik takaslari iki tarafa da bildirerek
     *  kapat - yoksa istemcide takas penceresi asili kalir. */
    kapatModul: () => {
      clearInterval(nabizSayaci);
      for (const oturum of [...oturumlar]) { try { kapat(oturum, 'cancelled'); } catch { /* soket gitti */ } }
      gelenIstek.clear();
    },
  };
  ONCEKI_ORNEK = ORNEK;
  return ORNEK;
}
