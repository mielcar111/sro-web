/**
 * sistem_borsa.js — Silk Borsasi (emir defteri + stake)
 *
 * Islenen c2s mesajlari (opcode'lar protocol.js ile birebir):
 *    96  exch.open           hiz sinifi: exchange
 *    97  exch.close          hiz sinifi: exchange
 *    98  exch.place          hiz sinifi: exchange
 *    99  exch.cancel         hiz sinifi: exchange
 *   100  exch.withdrawGold   hiz sinifi: exchange
 *   101  exch.mockDeposit    hiz sinifi: exchange
 *   102  exch.mockWithdraw   hiz sinifi: exchange
 *   103  exch.stake          hiz sinifi: exchange
 *   104  exch.claimStake     hiz sinifi: exchange
 *
 * ==================================================================== SEMA KAYNAGI
 * Hepsi okunabilir istemci paketinden ALINDI, hicbiri uydurulmadi:
 *   playjs_source\index-BUMMQVRB.js
 *
 * c2s (ofset 25612362..25613100, hepsi `exchange` hiz sinifi):
 *   T$(`exch.open`,  96, X({}), `exchange`)
 *   T$(`exch.close`, 97, X({}), `exchange`)
 *   T$(`exch.place`, 98, X({ side: qJ([`buy`,`sell`]),
 *                            price:    Y().int().min(100).max(2e9),
 *                            qtyUnits: Y().int().min(100).max(1e8),
 *                            tif: qJ([`gtc`,`ioc`]) }), `exchange`)
 *   T$(`exch.cancel`, 99, X({ orderId: J() }), `exchange`)
 *   T$(`exch.withdrawGold`, 100, X({ amount: Y().int().min(1).max(2e9) }), `exchange`)
 *   T$(`exch.mockDeposit`,  101, X({ jadeUnits: Y().int().min(1).max(1e10) }), `exchange`)
 *   T$(`exch.mockWithdraw`, 102, X({ jadeUnits: Y().int().min(1) }), `exchange`)
 *   T$(`exch.stake`, 103, X({ lockDays:  Y().int().min(1).max(365),
 *                             jadeUnits: Y().int().min(100).max(1e8) }), `exchange`)
 *   T$(`exch.claimStake`, 104, X({ stakeId: J() }), `exchange`)
 *
 * s2c (ofset 25628420..25630400):
 *   Fht = X({ price: Y().int(), units: Y().int() })
 *   T$(`exch.book`,   176, X({ bids: BJ(Fht), asks: BJ(Fht) }))
 *   T$(`exch.wallet`, 177, X({ jadeUnits: Y().int(), jadeLockedUnits: Y().int(),
 *                              gold: Y().int(), depositAddress: J() }))
 *   T$(`exch.orders`, 178, X({ orders: BJ(X({ id:J(), side:qJ([`buy`,`sell`]),
 *                              price:Y().int(), qtyUnits:Y().int(), filledUnits:Y().int(),
 *                              status:qJ([`open`,`filled`,`cancelled`]),
 *                              createdAt:Y() })) }))
 *   T$(`exch.trades`, 179, X({ trades: BJ(X({ price:Y().int(), units:Y().int(),
 *                              takerSide:qJ([`buy`,`sell`]), createdAt:Y() })) }))
 *   T$(`exch.fill`,   180, X({ orderId:J(), side:qJ([`buy`,`sell`]),
 *                              role:qJ([`maker`,`taker`]), price:Y().int(),
 *                              units:Y().int(), remainingUnits:Y().int(),
 *                              goldDelta:Y().int(), jadeDelta:Y().int() }))
 *   T$(`exch.stakes`, 181, X({ stakes: BJ(X({ id:J(), principalUnits:Y().int(),
 *                              aprBps:Y().int(), lockDays:Y().int(), rewardUnits:Y().int(),
 *                              startedAt:Y(), unlockAt:Y(),
 *                              status:qJ([`active`,`claimed`]) })), serverTime:Y() }))
 *   T$(`sys.notice`,  195, X({ key:qJ(Tht), params:GJ(J(),VJ([J(),Y()])).optional(),
 *                              display:qJ([`line`,`banner`]).optional() }))
 *   T$(`err`,         240, X({ code:qJ(Sht), key:qJ(Eht).optional(), ... }))
 *
 * Zod takma adlari (paketten dogrulandi): X=object Y=number J=string BJ=array
 * qJ=enum JJ=literal VJ=union GJ=record RJ=boolean.
 *
 * =========================================================== BIRIM / OLCU (paketten)
 *   qtyUnits  = Silk x 100.  Kanit: HFt(x) = Math.round(Number(x)*100)  (27383xxx)
 *               ve y5(u) = `${Math.floor(u/100)}.${(u%100).padStart(2,'0')}`  (27097652)
 *   price     = 1 Silk basina ALTIN, tam sayi. Kanit: `ui.exchange.price_label`
 *               = "Fiyat (altın / Silk)".
 *   maliyet   = Math.ceil(qtyUnits * price / 100)  — istemcinin KENDI tahmini:
 *               `ui.exchange.cost_estimate` n: x5(Math.ceil(qtyUnits*v_x/100))
 *   komisyon  = %0,5 SADECE aninda gerceklesen (taker) tarafta.
 *               Kanit: `ui.exchange.fee_note` = "Anında gerçekleşen işlemlerde
 *               %0,5 komisyon · bekleyen emirler ücretsiz". Maker ucretsiz.
 *   stake     = ERt (ofset 27601125): [{7,500},{30,1000},{90,2000}] lockDays/aprBps
 *               U9 = 100 (en az 1,00 Silk), DRt = 1e4, ORt = 365.
 *               Odul: istemcinin kRt'si (27601263) ROUND kullaniyor,
 *               WebCreateStake yordami ise T-SQL tam sayi bolmesi (FLOOR)
 *               kullaniyor. Ikisi 1 unit sapabiliyordu; bkz.
 *               odulunuIstemciyeUydur().
 *
 * ============================================================ mock* NE ISE YARIYOR
 *   `exch.mockDeposit` ve `exch.mockWithdraw` paket icinde SADECE protokol
 *   tablosunda geciyor (her biri TEK kez, 25612767 / 25612856). Hicbir arayuz
 *   bileseni bunlari GONDERMIYOR — `exch-transfer` kutusunun ikinci cocugu
 *   `!1` (false) olarak derlenmis, yani transfer butonlari devre disi.
 *   Cuzdan ipucu da `ui.exchange.deposit_addr_tip` = "Silk yatırma adresi
 *   (test): {addr}" diyor. Yani bunlar ZINCIR SIMULASYONU / test musluğu:
 *   gercek bir Silk yatirma-cekme entegrasyonu yerine gecen dev uclari.
 *   Bu yuzden burada YALNIZCA GM (sec_primary=1 && sec_content=1) kullanabilir;
 *   aksi halde herkes sinirsiz Silk basardi. Reddedilirse ERR_AUTH doner.
 *
 * ================================================================= KALICILIK / SEMA
 *   Yeni tablo YOK. SRO_WEB_GAME'deki HAZIR yapilar kullaniliyor:
 *     dbo.WebWallet        (JID, jadeUnits, jadeLockedUnits, depositAddress)
 *     dbo.WebExchangeOrder (id, JID, side, price, qtyUnits, filledUnits, status, createdAt)
 *     dbo.WebExchangeTrade (id, price, units, takerSide, makerJID, takerJID, createdAt)
 *     dbo.WebStake         (id, JID, principalUnits, aprBps, lockDays, rewardUnits,
 *                           startedAt, unlockAt, status)
 *   HAZIR yordamlar: WebGetWallet, WebPlaceOrder, WebCancelOrder, WebGetBook,
 *                    WebCreateStake, WebClaimStake.
 *
 *   ALTIN: cuzdanin `gold` alani = vSRO HESAP BANKASI altini, yani
 *   <SHARD>.dbo._AccountJID.Gold (bigint). Kanit: `ui.exchange.bank_gold` =
 *   "banka altını", `bank_gold_tip` = "Hesap bankası altını — alış emirleri
 *   buradan harcanır, gerçekleşen işlemler ve iadeler buraya gelir."
 *   WebWallet'ta altin sutunu YOK, uydurmak yerine vSRO'nun kendi sutunu
 *   kullanildi. Karakter uzerindeki altin ayri (_Char.RemainGold) ve arayuzde
 *   `ui.exchange.on_character` olarak ayrica gosteriliyor.
 *
 *   ALIS TEMINATI: WebExchangeOrder'da "kilitli altin" sutunu yok. Bu yuzden
 *   alis emri verilirken altin banka bakiyesinden DUSULUR (escrow) ve emir
 *   kapaninca artan kisim iade edilir — `ui.exchange.cancel_order_tip`
 *   ("gerçekleşmeyen kısım cüzdanına döner") ve `sys.exch.cancelled_gold`
 *   ile birebir ortusuyor. Kalan teminat bellekte tutulur; sunucu yeniden
 *   baslarsa acik alis emirlerinden ceil((qty-filled)*price/100) ile geri
 *   kurulur (kuruş farki en fazla birkac altin olur ve emir kapaninca iade
 *   edilir).
 *
 * ========================================================= KULLANILAN sys.* ANAHTARLARI
 *   Hepsi hem paketteki Tht enum'unda (25603308) hem client\assets\locales\tr.json
 *   icinde DOGRULANDI:
 *     sys.exch.order_placed            "Emir verildi: {units} Silk @ {price}"
 *     sys.exch.order_filled_buy        "Alış emri gerçekleşti: {units} Silk @ {price}"
 *     sys.exch.order_filled_sell       "Satış emri gerçekleşti: {units} Silk @ {price}"
 *     sys.exch.partial_fill_refunded   "{units} Silk emrinin {filled} kadarı ... iade"
 *     sys.exch.refunded_none           "Eşleşen emir yok — iade edildi"
 *     sys.exch.cancelled_gold          "... {gold} altın takas cüzdanına iade edildi"
 *     sys.exch.cancelled_jade          "... {units} Silk takas cüzdanına iade edildi"
 *     sys.exch.staked                  "{units} Silk stake edildi"
 *     sys.exch.stake_claimed           "Stake alındı: {units} Silk"
 *     sys.exch.deposit                 "Yatırma: +{units} Silk"
 *     sys.exch.withdraw                "Çekim: −{units} Silk"
 *     sys.bank.gold_out                "Hesap bankasından {gold} altın çekildi"
 *   {units} DAIMA y5 bicimi ("1.50") olarak gonderilir — istemcinin kendi
 *   exch.fill bildirimi de `units: y5(units)` yolluyor (27130156).
 *   err anahtari: `err.busy.exchange` (Eht'te var, tr.json'da "Borsa meşgul").
 *   Kullanilan err kodlari — hepsi paketteki Sht enum'unda (25602274):
 *     ERR_AUTH, ERR_VALIDATION, ERR_RANGE, ERR_NO_JADE, ERR_NO_GOLD,
 *     ERR_NOT_FOUND, ERR_BUSY.
 *
 * ================================================== DENETIM DUZELTMELERI (v2)
 *   1. `exch.withdrawGold` DEPO GOREVLISI kapisina alindi. Istemci bu ucu hic
 *      gondermiyor, gercek yol npcId+menzil kapili `bank.withdrawGold` (106);
 *      kapisiz hali o kapiyi tamamen bypass ediyordu. -> depoYakinMi/ERR_RANGE.
 *   2. Yedek SQL havuzu MODUL kapsamina alindi: server.js `sistemleriKur()`
 *      ile kur()'u yeniden cagirdiginda her seferinde yeni bir ConnectionPool
 *      aciliyor, eskisi sizuyordu.
 *   3. `exch.open` aboneligi artik JID dogrulandiktan SONRA ekleniyor; aksi
 *      halde 'close' dinleyicisi takilmamis soketler kumede kaliyordu.
 *   4. Teminat KURUS ARTIGI: her parca ayri ayri ceil'lendigi icin acik alis
 *      emri kalanini odeyemez hale gelip defterde sonsuza dek hayalet
 *      derinlik gosterebiliyordu. -> teminatiUyumla() emri kuculuyor ya da
 *      kapatip artigi iade ediyor.
 *   5. Stake odulu istemcinin gosterdigi (round) degere tamamlaniyor;
 *      yordamin floor'u 1 unit eksik odeyebiliyordu.
 *   6. `exch.stakes` listesine TOP sinir (aktifler once).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------------------ sabitler */

/** Baz puan paydasi — WebCreateStake yordami da (10000*365) kullaniyor. */
const BPS = 10_000;
/** Taker komisyonu: %0,5 = 50 bps (ui.exchange.fee_note). Maker: 0. */
const TAKER_KOMISYON_BPS = 50;
/** ERt (paket 27601125) — istemcinin gosterdigi kademe tablosunun aynisi.
 *  WebCreateStake @LockDays sadece 7/30/90 kabul ediyor. */
const STAKE_KADEMELERI = new Map([[7, 500], [30, 1000], [90, 2000]]);
/** En az stake miktari — paketteki U9 = 100 units (1,00 Silk). */
const STAKE_EN_AZ = 100;
/** WebGetBook @Depth varsayilani. */
const DEFTER_DERINLIK = 20;
/** exch.trades / exch.orders listelerinin uzunlugu. */
const ISLEM_GECMISI = 30;
const EMIR_GECMISI = 40;
/** exch.stakes listesinin uzunlugu (aktifler once). */
const STAKE_GECMISI = 40;
/** Tek bir taker emri en fazla kac maker emrine dokunabilir (sonsuz dongu kalkani). */
const EN_FAZLA_ESLESME = 200;

const GUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const AD_RE = /^[A-Za-z0-9_]+$/;
/** NPC etkilesim menzili varsayilani — paket_veri/config/game-config.json
 *  `npcInteractRangeU` = 25. GCFG doluysa oradan okunur. */
const NPC_MENZIL_VARSAYILAN = 25;

const MESAJLARIM = new Set([
  'exch.open', 'exch.close', 'exch.place', 'exch.cancel', 'exch.withdrawGold',
  'exch.stake', 'exch.claimStake', 'exch.mockDeposit', 'exch.mockWithdraw',
]);

/* ------------------------------------------------------------- kucuk yardimcilar */

const sayi = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Zod `Y().int().min(a).max(b)` aynasi. Gecersizse null. */
function tam(v, min, max) {
  if (typeof v !== 'number' || !Number.isFinite(v) || !Number.isInteger(v)) return null;
  if (v < min || v > max) return null;
  return v;
}

/** Zod `qJ([...])` aynasi. */
function sec(v, liste) {
  return typeof v === 'string' && liste.includes(v) ? v : null;
}

/** y5(units) — paket 27097652 ile birebir: 150 -> "1.50" */
function jadeYazi(units) {
  const isaret = units < 0 ? '-' : '';
  const n = Math.abs(Math.trunc(units));
  return `${isaret}${Math.floor(n / 100)}.${String(n % 100).padStart(2, '0')}`;
}

/** Maliyet: istemcinin cost_estimate hesabiyla ayni. */
const maliyet = (units, price) => Math.ceil((units * price) / 100);

/** Verilen altinla en fazla kac unit alinabilir. */
const alinabilirUnits = (altin, price) => Math.floor((altin * 100) / price);

const zamanMs = (v) => {
  if (v == null) return Date.now();
  const t = v instanceof Date ? v.getTime() : Date.parse(String(v));
  return Number.isFinite(t) ? t : Date.now();
};

/* ============================================================ MODUL KAPSAMI
 * DENETIM BULGUSU: server.js `sistemleriKur()` ile kur()'u YENIDEN cagiriyor
 * (admin panelinden ayar degisince, server.js:932). Yedek SQL havuzu kur()
 * icinde tutulursa her yeniden kurulumda YENI bir ConnectionPool acilir ve
 * eskisi kapanmadan sizar (havuz basina 10 baglanti). Bu yuzden havuz ve
 * mssql modulu MODUL kapsaminda, TEK kez kuruluyor.
 * ctx.web dolu geldigi anda bu yedek yol hic calismaz.
 */
let YEDEK_HAVUZ = null;   // Promise<pool|null> | null
let SQL_MODULU = null;

async function sqlModulu() {
  if (!SQL_MODULU) SQL_MODULU = (await import('mssql')).default;
  return SQL_MODULU;
}

function yedekHavuz(AYAR, log) {
  if (!AYAR?.sql?.enabled) return Promise.resolve(null);
  if (!YEDEK_HAVUZ) {
    YEDEK_HAVUZ = (async () => {
      const m = await sqlModulu();
      const C = AYAR.sql;
      const p = await new m.ConnectionPool({
        server: C.server, user: C.user, password: C.password,
        database: C.databases.web, options: C.options,
      }).connect();
      log('borsa: ctx.web bos - kendi SQL havuzu kuruldu ->', C.databases.web);
      return p;
    })().catch((e) => {
      log('borsa: SQL havuzu kurulamadi:', String(e?.message ?? e).slice(0, 140));
      YEDEK_HAVUZ = null;                 // sonraki denemede yeniden dene
      return null;
    });
  }
  return YEDEK_HAVUZ;
}

/* ================================================== DEPO GOREVLISI KONUMLARI
 * DENETIM BULGUSU (en agiri): `exch.withdrawGold` (100) banka altinini
 * karakterin uzerine tasiyor ama semasinda npcId YOK ve ilk surumde hicbir
 * kapisi yoktu. Oysa:
 *   - Bu ucu istemci arayuzu HIC GONDERMIYOR: paket icinde tek gecisi
 *     protokol tablosu (25612680). Gonderen bir bilesen yok.
 *   - Arayuzun kendi notlari acikca aksini soyluyor:
 *       `ui.exchange.transfer_note`  = "Altin giris/cikisi sehirdeki Depo
 *                                      Gorevlisi'nden yapilir"
 *       `ui.exchange.bank_gold_tip`  = "... Yatirma/cekme Depo Gorevlisi'nde."
 *   - Altinin GERCEK yolu `bank.withdrawGold` (106) ve sistem_banka-depo.js
 *     orayi npcId + menzil (npcInteractRangeU = 25) ile kapatiyor.
 * Kapisiz birakilirsa bu uc, o menzil kapisini bastan sona bypass eder:
 * oyuncu savasin ortasinda, zindanda, kacarken - her yerden banka altinini
 * karakterine cekebilir. Bu yuzden AYNI veri kaynaklariyla AYNI kapiyi
 * kuruyoruz. Veri okunamazsa kapi KAPALI kalir (fail-closed).
 *
 * Kaynaklar (sistem_banka-depo.js ile birebir ayni):
 *   server/world.json                 -> zones[].npcs[].{npcId,x,z}
 *   GERCEK/paket_veri/npcs.json       -> `bank: true` bayragi (5 warehouse NPC)
 */
let DEPO_KONUM = null;   // Map<`${zoneId}|${npcId}`, [{x,z}]>

function depoKonumlari(HERE, log) {
  if (DEPO_KONUM) return DEPO_KONUM;
  DEPO_KONUM = new Map();

  const depoNpc = new Set();
  for (const aday of [
    path.join(HERE, 'data', 'npcs.json'),
    path.join(HERE, '..', '..', 'GERCEK', 'paket_veri', 'npcs.json'),
  ]) {
    try {
      const ham = JSON.parse(fs.readFileSync(aday, 'utf8'));
      const liste = Array.isArray(ham) ? ham : Object.values(ham ?? {});
      for (const n of liste) if (n?.bank && n?.id) depoNpc.add(n.id);
      if (depoNpc.size) break;
    } catch { /* sonraki aday */ }
  }
  if (!depoNpc.size) {
    log('borsa: npcs.json bulunamadi - exch.withdrawGold KAPALI (fail-closed)');
    return DEPO_KONUM;
  }

  try {
    const W = JSON.parse(fs.readFileSync(path.join(HERE, 'world.json'), 'utf8'));
    for (const [zid, z] of Object.entries(W.zones ?? {})) {
      for (const n of z?.npcs ?? []) {
        if (!n?.npcId || !depoNpc.has(n.npcId)) continue;
        const k = `${zid}|${n.npcId}`;
        if (!DEPO_KONUM.has(k)) DEPO_KONUM.set(k, []);
        DEPO_KONUM.get(k).push({ x: sayi(n.x), z: sayi(n.z) });
      }
    }
  } catch (e) {
    log('borsa: world.json okunamadi - exch.withdrawGold KAPALI:',
      String(e?.message ?? e).slice(0, 90));
  }
  return DEPO_KONUM;
}

/* =================================================================== modul */

export function kur(ctx) {
  const {
    frame = () => {},
    log = () => {},
    world = null,
    envanterPayload = null,
    web: ctxWeb = null,
    SHARD = null,
    GCFG = null,
  } = ctx ?? {};

  const SHARD_AD = typeof SHARD === 'string' && AD_RE.test(SHARD) ? SHARD : null;

  /* Depo gorevlisi menzili — game-config `npcInteractRangeU`, sistem_banka-depo
     ile ayni deger. GCFG yoksa paketten okunan 25. */
  const DEPO_MENZIL = (() => {
    const v = Number(GCFG?.npcInteractRangeU);
    return Number.isFinite(v) && v > 0 ? v : NPC_MENZIL_VARSAYILAN;
  })();
  const DEPO_MENZIL_2 = DEPO_MENZIL * DEPO_MENZIL;

  /* config.json yalnizca OKUNUR: hesap veritabani adi (TB_User.StrUserID icin)
     ve — ctx.web henuz baglanmamissa — kendi yedek havuzumuz icin. */
  let AYAR = null;
  try { AYAR = JSON.parse(fs.readFileSync(path.join(HERE, 'config.json'), 'utf8')); }
  catch { AYAR = null; }
  const ACC_AD = (() => {
    const a = AYAR?.sql?.databases?.account;
    return typeof a === 'string' && AD_RE.test(a) ? a : null;
  })();

  /* ---------------------------------------------------------------- SQL havuzu
     Sozlesme ctx.web'i veriyor; server.js su an null geciyor. Modul olu
     kalmasin diye ayni config.json ile KENDI havuzunu kurabiliyor - ama havuz
     MODUL kapsaminda (yukariya bak), yeniden kurulumda sizmasin diye. */
  let havuz = ctxWeb;

  async function havuzAl() {
    if (havuz) return havuz;
    havuz = await yedekHavuz(AYAR, log);
    return havuz;
  }

  const sqlAl = sqlModulu;

  /** Parametre tiplerini ACIKCA veriyoruz. Otomatik cikarima birakilirsa
   *  altin/teminat gibi 2^31'i asabilen degerler (maliyet = qty*price/100,
   *  en kotu 2e15) int'e sigmaz ve sorgu patlar. */
  const INT32_MAX = 2_147_483_647;
  function tiple(s, deger) {
    if (typeof deger === 'number') {
      if (!Number.isInteger(deger)) return [s.Float, deger];
      return Math.abs(deger) <= INT32_MAX ? [s.Int, deger] : [s.BigInt, deger];
    }
    if (typeof deger === 'string') return [s.NVarChar(256), deger];
    return [undefined, deger];
  }

  async function istekKur(girdiler) {
    const p = await havuzAl();
    if (!p) throw new Error('sql_yok');
    const s = await sqlAl();
    const istek = p.request();
    for (const [ad, deger] of Object.entries(girdiler)) {
      if (Array.isArray(deger) && deger.length === 2 && deger[0] !== undefined) {
        istek.input(ad, deger[0], deger[1]);      // [tip, deger] ciftleri
      } else {
        const [tip, v] = tiple(s, deger);
        if (tip) istek.input(ad, tip, v); else istek.input(ad, v);
      }
    }
    return istek;
  }

  /** Tek noktadan sorgu. girdiler: { ad: deger } veya { ad: [tip, deger] }. */
  async function sorgu(metin, girdiler = {}) {
    return (await istekKur(girdiler)).query(metin);
  }

  async function yordam(ad, girdiler = {}) {
    return (await istekKur(girdiler)).execute(ad);
  }

  /** uniqueidentifier parametresi tip verilmeden gonderilirse nvarchar olur;
   *  bu yuzden GUID'leri acikca tiplendiriyoruz. */
  async function sorguGuid(metin, guidAdi, guid, girdiler = {}) {
    const s = await sqlAl();
    return sorgu(metin, { ...girdiler, [guidAdi]: [s.UniqueIdentifier, guid] });
  }

  /* ---------------------------------------------------------------- durum */

  /** Borsa paneli acik soketler (exch.open/close ile). */
  const aboneler = new Set();
  /** JID -> Set<ws> : bildirim gonderebilmek icin gorulen tum soketler. */
  const soketler = new Map();
  /** orderId(buyuk harf GUID) -> kalan teminat (altin). Sadece ALIS emirleri. */
  const teminat = new Map();
  let teminatKuruldu = false;

  /** Tum borsa yazimlarini tek siraya diziyoruz: tek islemli sunucuda bu,
   *  emir defterinde yaris kosulu olmamasini garanti eder. */
  let sira = Promise.resolve();
  function sirala(is) {
    const p = sira.then(is, is);
    sira = p.catch(() => {});
    return p;
  }

  /* ------------------------------------------------------------ soket kaydi */

  function tanit(ws) {
    const jid = Number(ws?.user?.JID);
    if (!Number.isInteger(jid) || jid <= 0) return null;
    let kume = soketler.get(jid);
    if (!kume) { kume = new Set(); soketler.set(jid, kume); }
    if (!kume.has(ws)) {
      kume.add(ws);
      if (typeof ws.on === 'function') {
        ws.on('close', () => {
          aboneler.delete(ws);
          const k = soketler.get(jid);
          if (k) { k.delete(ws); if (k.size === 0) soketler.delete(jid); }
        });
      }
    }
    return jid;
  }

  /** JID'e ait acik soketler (kayitli olanlar + dunyadaki oyuncular). */
  function soketleriBul(jid) {
    const cikti = new Set(soketler.get(jid) ?? []);
    const durum = world?.zoneState;
    if (durum && typeof durum.forEach === 'function') {
      for (const z of durum.values()) {
        for (const c of z?.players ?? []) if (Number(c?.user?.JID) === jid) cikti.add(c);
      }
    }
    return [...cikti];
  }

  const hata = (ws, code, key) => {
    frame(ws, 'err', key ? { code, key } : { code });
    return true;
  };
  const bildir = (ws, key, params) =>
    frame(ws, 'sys.notice', params ? { key, params } : { key });

  function jideBildir(jid, key, params) {
    for (const c of soketleriBul(jid)) bildir(c, key, params);
  }
  function jideYolla(jid, t, d) {
    for (const c of soketleriBul(jid)) frame(c, t, d);
  }

  /* ------------------------------------------------------------ cuzdan / altin */

  /** Yatirma adresi (TEST). Paket UFt() ilk 8 + son 6 karakteri gosteriyor,
   *  bu yuzden en az 14 karakter olmali. JID'den deterministik uretilir ki
   *  ayni hesap her zaman ayni adresi gorsun. */
  async function adresUret(jid) {
    const crypto = await import('node:crypto');
    const h = crypto.createHash('sha256').update(`oyun:deposit:${jid}`).digest('hex');
    return `0x${h.slice(0, 40)}`;
  }

  /** WebGetWallet + adres garantisi. */
  async function cuzdanOku(jid) {
    const r = await yordam('WebGetWallet', { JID: jid });
    const s = r.recordset?.[0] ?? {};
    let adres = s.depositAddress;
    if (!adres) {
      adres = await adresUret(jid);
      await sorgu(
        'UPDATE dbo.WebWallet SET depositAddress = @a, updatedAt = GETDATE() WHERE JID = @JID AND depositAddress IS NULL',
        { JID: jid, a: adres });
    }
    return {
      jadeUnits: sayi(s.jadeUnits),
      jadeLockedUnits: sayi(s.jadeLockedUnits),
      depositAddress: String(adres),
    };
  }

  /** Hesap bankasi (_AccountJID) satiri yoksa TB_User'dan AccountID ile acar. */
  async function bankaSatiriGaranti(jid) {
    if (!SHARD_AD) throw new Error('shard_yok');
    if (ACC_AD) {
      await sorgu(
        `IF NOT EXISTS (SELECT 1 FROM ${SHARD_AD}.dbo._AccountJID WHERE JID = @JID)
           INSERT INTO ${SHARD_AD}.dbo._AccountJID (AccountID, JID, Gold)
           SELECT TOP 1 u.StrUserID, u.JID, 0 FROM ${ACC_AD}.dbo.TB_User u WHERE u.JID = @JID`,
        { JID: jid });
    }
  }

  async function bankaAltini(jid) {
    if (!SHARD_AD) return 0;
    const r = await sorgu(
      `SELECT Gold FROM ${SHARD_AD}.dbo._AccountJID WHERE JID = @JID`, { JID: jid });
    if (!r.recordset?.length) { await bankaSatiriGaranti(jid); return 0; }
    return sayi(r.recordset[0].Gold);
  }

  /** Korumali dusum: yeterli bakiye yoksa hicbir sey yazmaz, false doner. */
  async function bankaDus(jid, miktar) {
    if (miktar <= 0) return true;
    if (!SHARD_AD) return false;
    const r = await sorgu(
      `UPDATE ${SHARD_AD}.dbo._AccountJID SET Gold = Gold - @m WHERE JID = @JID AND Gold >= @m`,
      { JID: jid, m: miktar });
    return (r.rowsAffected?.[0] ?? 0) > 0;
  }

  async function bankaEkle(jid, miktar) {
    if (miktar <= 0) return;
    if (!SHARD_AD) { log(`borsa: SHARD adi yok, ${miktar} altin YAZILAMADI (JID=${jid})`); return; }
    await bankaSatiriGaranti(jid);
    const r = await sorgu(
      `UPDATE ${SHARD_AD}.dbo._AccountJID SET Gold = Gold + @m WHERE JID = @JID`,
      { JID: jid, m: miktar });
    /* Satir yoksa altin BUHARLASIR - sessizce gecmiyoruz. Tek sebebi
       _AccountJID'de satir olmamasi ve TB_User'da da bulunmamasidir. */
    if ((r.rowsAffected?.[0] ?? 0) === 0) {
      log(`borsa: UYARI - JID=${jid} icin _AccountJID satiri yok, ${miktar} altin islenemedi`);
    }
  }

  /** WebWallet uzerinde Silk / kilit oynatmasi. */
  async function jadeOynat(jid, dJade, dKilit) {
    if (dJade === 0 && dKilit === 0) return;
    await sorgu(
      `UPDATE dbo.WebWallet SET jadeUnits = jadeUnits + @j,
              jadeLockedUnits = jadeLockedUnits + @k, updatedAt = GETDATE()
       WHERE JID = @JID`,
      { JID: jid, j: dJade, k: dKilit });
  }

  /* ------------------------------------------------------------ okuma yuzleri */

  async function defterOku() {
    const r = await yordam('WebGetBook', { Depth: DEFTER_DERINLIK });
    const kes = (rs) => (rs ?? []).map((x) => ({ price: sayi(x.price), units: sayi(x.units) }))
      .filter((x) => x.units > 0);
    return { bids: kes(r.recordsets?.[0]), asks: kes(r.recordsets?.[1]) };
  }

  async function emirlerimOku(jid) {
    const r = await sorgu(
      `SELECT TOP (@n) id, side, price, qtyUnits, filledUnits, status, createdAt
         FROM dbo.WebExchangeOrder WHERE JID = @JID
        ORDER BY CASE WHEN status = 'open' THEN 0 ELSE 1 END, createdAt DESC`,
      { JID: jid, n: EMIR_GECMISI });
    return (r.recordset ?? []).map((o) => ({
      id: String(o.id).toLowerCase(),
      side: o.side === 'sell' ? 'sell' : 'buy',
      price: sayi(o.price),
      qtyUnits: sayi(o.qtyUnits),
      filledUnits: sayi(o.filledUnits),
      status: ['open', 'filled', 'cancelled'].includes(o.status) ? o.status : 'cancelled',
      createdAt: zamanMs(o.createdAt),
    }));
  }

  async function islemlerOku() {
    const r = await sorgu(
      `SELECT TOP (@n) price, units, takerSide, createdAt
         FROM dbo.WebExchangeTrade ORDER BY id DESC`, { n: ISLEM_GECMISI });
    return (r.recordset ?? []).map((x) => ({
      price: sayi(x.price),
      units: sayi(x.units),
      takerSide: x.takerSide === 'sell' ? 'sell' : 'buy',
      createdAt: zamanMs(x.createdAt),
    }));
  }

  async function stakelerOku(jid) {
    /* TOP sinirsizdi: yillar sonra binlerce kapanmis stake tek karede
       gonderilirdi. Aktifler her zaman once gelsin diye siralama iki asamali. */
    const r = await sorgu(
      `SELECT TOP (@n) id, principalUnits, aprBps, lockDays, rewardUnits, startedAt, unlockAt, status
         FROM dbo.WebStake WHERE JID = @JID
        ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, startedAt DESC`,
      { JID: jid, n: STAKE_GECMISI });
    return (r.recordset ?? []).map((s) => ({
      id: String(s.id).toLowerCase(),
      principalUnits: sayi(s.principalUnits),
      aprBps: sayi(s.aprBps),
      lockDays: sayi(s.lockDays),
      rewardUnits: sayi(s.rewardUnits),
      startedAt: zamanMs(s.startedAt),
      unlockAt: zamanMs(s.unlockAt),
      status: s.status === 'claimed' ? 'claimed' : 'active',
    }));
  }

  /* ------------------------------------------------------------ gonderim yuzleri */

  async function cuzdanYolla(jid) {
    const c = await cuzdanOku(jid);
    const g = await bankaAltini(jid);
    jideYolla(jid, 'exch.wallet', {
      jadeUnits: c.jadeUnits,
      jadeLockedUnits: c.jadeLockedUnits,
      gold: g,
      depositAddress: c.depositAddress,
    });
  }

  async function emirlerYolla(jid) {
    jideYolla(jid, 'exch.orders', { orders: await emirlerimOku(jid) });
  }

  async function defterYayinla() {
    if (aboneler.size === 0) return;
    const d = await defterOku();
    for (const c of aboneler) frame(c, 'exch.book', d);
  }

  async function islemlerYayinla() {
    if (aboneler.size === 0) return;
    const t = { trades: await islemlerOku() };
    for (const c of aboneler) frame(c, 'exch.trades', t);
  }

  async function stakelerYolla(jid) {
    jideYolla(jid, 'exch.stakes', {
      stakes: await stakelerOku(jid), serverTime: Date.now(),
    });
  }

  /* ------------------------------------------------------------ teminat defteri */

  /** Sunucu yeniden basladiginda acik ALIS emirlerinin kalan teminatini kurar. */
  async function teminatKur() {
    if (teminatKuruldu) return;
    teminatKuruldu = true;
    try {
      const r = await sorgu(
        `SELECT id, price, qtyUnits, filledUnits FROM dbo.WebExchangeOrder
          WHERE status = 'open' AND side = 'buy'`);
      for (const o of r.recordset ?? []) {
        const kalan = sayi(o.qtyUnits) - sayi(o.filledUnits);
        if (kalan > 0) teminat.set(String(o.id).toUpperCase(), maliyet(kalan, sayi(o.price)));
      }
      if ((r.recordset?.length ?? 0) > 0) log(`borsa: ${r.recordset.length} acik alis emrinin teminati geri kuruldu`);
    } catch (e) {
      log('borsa: teminat kurulamadi:', String(e?.message ?? e).slice(0, 140));
    }
  }

  const temAl = (id) => teminat.get(String(id).toUpperCase()) ?? 0;
  const temYaz = (id, v) => teminat.set(String(id).toUpperCase(), Math.max(0, v));
  const temSil = (id) => { const k = String(id).toUpperCase(); const v = teminat.get(k) ?? 0; teminat.delete(k); return v; };

  /* ================================================================ ESLESTIRME */

  /**
   * Karsi taraftaki acik emirleri fiyat-zaman onceligiyle getirir.
   *   alis taker  -> satis emirleri, price <= limit, ucuzdan pahaliya
   *   satis taker -> alis emirleri,  price >= limit, pahalidan ucuza
   */
  async function karsiEmirler(taraf, limit) {
    if (taraf === 'buy') {
      const r = await sorgu(
        `SELECT TOP (@n) id, JID, price, qtyUnits, filledUnits FROM dbo.WebExchangeOrder
          WHERE status = 'open' AND side = 'sell' AND price <= @p
          ORDER BY price ASC, createdAt ASC`, { p: limit, n: EN_FAZLA_ESLESME });
      return r.recordset ?? [];
    }
    const r = await sorgu(
      `SELECT TOP (@n) id, JID, price, qtyUnits, filledUnits FROM dbo.WebExchangeOrder
        WHERE status = 'open' AND side = 'buy' AND price >= @p
        ORDER BY price DESC, createdAt ASC`, { p: limit, n: EN_FAZLA_ESLESME });
    return r.recordset ?? [];
  }

  async function emirDoldur(id, ekUnits) {
    await sorguGuid(
      `UPDATE dbo.WebExchangeOrder
          SET filledUnits = filledUnits + @u,
              status = CASE WHEN filledUnits + @u >= qtyUnits THEN 'filled' ELSE status END
        WHERE id = @id`, 'id', id, { u: ekUnits });
  }

  async function emirKapat(id, durum) {
    await sorguGuid(`UPDATE dbo.WebExchangeOrder SET status = @s WHERE id = @id`,
      'id', id, { s: durum });
  }

  /** Acik emri daha kucuk bir boya CEKER (teminat artigi uyumu icin).
   *  Yeni boy dolan miktara esitse emir 'filled' sayilir. */
  async function emirKucult(id, yeniQty) {
    await sorguGuid(
      `UPDATE dbo.WebExchangeOrder
          SET qtyUnits = @q,
              status = CASE WHEN filledUnits >= @q THEN 'filled' ELSE status END
        WHERE id = @id AND status = 'open'`, 'id', id, { q: yeniQty });
  }

  /**
   * DENETIM BULGUSU — kurus artigi hayalet derinlik uretiyor.
   *
   * Alis teminati emir verilirken TEK SEFERDE ceil(qty*price/100) olarak
   * bloke ediliyor, ama her parca da AYRI AYRI ceil ile ucretlendiriliyor.
   * ceil'lerin toplami butunun ceil'inden 1 altin buyuk olabilir:
   *   price=1001, qty=10000 -> teminat 100100
   *   7777 dolar -> ceil(77847.77) = 77848 ; kalan 2223 icin gereken
   *   ceil(22252.23) = 22253 ama elde 22252 var.
   * Sonuc: emir 1 unit'ini ASLA dolduramaz, sonsuza dek `open` kalir ve
   * herkesin gordugu defterde odenemeyen sahte derinlik gosterir.
   *
   * Cozum: kalan teminatin GERCEKTEN alabilecegi boya cek. Hic unit
   * alinamiyorsa emri kapat ve artan kurusu iade et.
   *
   * @returns {number} emrin uyumlanmis kalan unit sayisi
   */
  async function teminatiUyumla(orderId, jid, price, kalan, dolan) {
    if (kalan <= 0) return kalan;
    const alinabilir = alinabilirUnits(temAl(orderId), price);
    if (alinabilir >= kalan) return kalan;          // teminat yetiyor, dokunma
    if (alinabilir > 0) {
      await emirKucult(orderId, dolan + alinabilir);
      return alinabilir;
    }
    await emirKapat(orderId, 'cancelled');
    const artan = temSil(orderId);
    if (artan > 0) await bankaEkle(jid, artan);
    return 0;
  }

  async function islemYaz(price, units, takerSide, makerJID, takerJID) {
    await sorgu(
      `INSERT INTO dbo.WebExchangeTrade (price, units, takerSide, makerJID, takerJID)
       VALUES (@p, @u, @ts, @mj, @tj)`,
      { p: price, u: units, ts: takerSide, mj: makerJID, tj: takerJID });
  }

  const komisyon = (miktar) => Math.floor((miktar * TAKER_KOMISYON_BPS) / BPS);

  /**
   * Taker emrini defterle eslestirir.
   * @returns {{dolan:number, toplamAltin:number, etkilenen:Set<number>}}
   */
  async function esles({ takerId, takerJID, taraf, limit, adet }) {
    let kalanTaker = adet;
    let dolan = 0;
    let toplamAltin = 0;
    const etkilenen = new Set([takerJID]);
    /* Teminat artigi yuzunden kalanini odeyemeyecek MAKER alis emirleri.
       Dongu bitince uyumlanir (bkz. teminatiUyumla). id -> {jid,price,kalan,dolan} */
    const artikAdaylari = new Map();

    const adaylar = await karsiEmirler(taraf, limit);
    for (const m of adaylar) {
      if (kalanTaker <= 0) break;
      const makerId = String(m.id);
      const makerJID = Number(m.JID);
      const p = sayi(m.price);
      const makerKalan = sayi(m.qtyUnits) - sayi(m.filledUnits);
      if (makerKalan <= 0 || p <= 0) continue;

      let u = Math.min(kalanTaker, makerKalan);

      /* Teminat kapisi: ALIS tarafinin altini bu miktari odemeye yetmeli.
         Yuvarlama artiklari yuzunden son parcada 1-2 altin eksik kalabilir,
         o yuzden miktari teminatin yettigi kadara kirpiyoruz. */
      const alisId = taraf === 'buy' ? takerId : makerId;
      const tem = temAl(alisId);
      let altin = maliyet(u, p);
      if (altin > tem) {
        u = Math.min(u, alinabilirUnits(tem, p));
        altin = u > 0 ? Math.min(maliyet(u, p), tem) : 0;
      }
      if (u <= 0) {
        /* Teminat bitti. Taker ALIS ise kendi altini tukendi -> dur.
           Taker SATIS ise yalnizca BU maker odeyemiyor -> sonrakine gec,
           ama o maker artik odeyemeyecegi bir derinligi ilan ediyor:
           dongu sonunda uyumlansin. */
        if (taraf === 'buy') break;
        artikAdaylari.set(makerId, {
          jid: makerJID, price: p, kalan: makerKalan, dolan: sayi(m.filledUnits),
        });
        continue;
      }

      temYaz(alisId, tem - altin);

      /* ---- varlik hareketleri ---- */
      if (taraf === 'buy') {
        // taker ALIYOR: Silk alir (komisyon dusulur), altini zaten teminatta.
        const kesinti = komisyon(u);
        await jadeOynat(takerJID, u - kesinti, 0);
        // maker SATIYOR: kilitli Silk cikar, altin banka hesabina girer.
        await jadeOynat(makerJID, -u, -u);
        await bankaEkle(makerJID, altin);

        frameFill(takerJID, {
          orderId: String(takerId).toLowerCase(), side: 'buy', role: 'taker', price: p,
          units: u, remainingUnits: kalanTaker - u, goldDelta: -altin, jadeDelta: u - kesinti,
        });
        frameFill(makerJID, {
          orderId: makerId.toLowerCase(), side: 'sell', role: 'maker', price: p,
          units: u, remainingUnits: makerKalan - u, goldDelta: altin, jadeDelta: -u,
        });
      } else {
        // taker SATIYOR: kilitli Silk cikar, altin (komisyon dusulmus) banka hesabina.
        const kesinti = komisyon(altin);
        await jadeOynat(takerJID, -u, -u);
        await bankaEkle(takerJID, altin - kesinti);
        // maker ALIYOR: Silk girer, altin zaten teminatta.
        await jadeOynat(makerJID, u, 0);

        frameFill(takerJID, {
          orderId: String(takerId).toLowerCase(), side: 'sell', role: 'taker', price: p,
          units: u, remainingUnits: kalanTaker - u, goldDelta: altin - kesinti, jadeDelta: -u,
        });
        frameFill(makerJID, {
          orderId: makerId.toLowerCase(), side: 'buy', role: 'maker', price: p,
          units: u, remainingUnits: makerKalan - u, goldDelta: -altin, jadeDelta: u,
        });
      }

      await emirDoldur(makerId, u);
      await emirDoldur(takerId, u);
      await islemYaz(p, u, taraf, makerJID, takerJID);

      /* Maker emri tamamen dolduysa: alis ise artan teminati iade et. */
      if (makerKalan - u <= 0) {
        if (taraf === 'sell') {
          const artan = temSil(makerId);
          if (artan > 0) await bankaEkle(makerJID, artan);
        }
        jideBildir(makerJID,
          taraf === 'sell' ? 'sys.exch.order_filled_buy' : 'sys.exch.order_filled_sell',
          { units: jadeYazi(sayi(m.qtyUnits)), price: p });
      } else if (taraf === 'sell') {
        /* Maker ALIS emri kismen doldu: kalan teminati kalan unit'leri
           odemeye yetiyor mu? Yetmiyorsa dongu sonunda kucultulur. */
        artikAdaylari.set(makerId, {
          jid: makerJID, price: p, kalan: makerKalan - u,
          dolan: sayi(m.filledUnits) + u,
        });
      }

      kalanTaker -= u;
      dolan += u;
      toplamAltin += altin;
      etkilenen.add(makerJID);
    }

    /* Odenemeyen maker alis derinligini defterden temizle. */
    for (const [id, a] of artikAdaylari) {
      const oncekiTem = temAl(id);          // tamamen kapanirsa iade edilecek tutar
      const yeni = await teminatiUyumla(id, a.jid, a.price, a.kalan, a.dolan);
      if (yeni === a.kalan) continue;                 // degisiklik yok
      etkilenen.add(a.jid);
      if (yeni === 0) {
        jideBildir(a.jid, 'sys.exch.cancelled_gold', { gold: oncekiTem });
        log(`borsa: JID=${a.jid} alis emri teminat artigi yuzunden kapatildi (${id})`);
      }
    }

    return { dolan, toplamAltin, etkilenen };
  }

  function frameFill(jid, veri) {
    jideYolla(jid, 'exch.fill', veri);
  }

  /** Ayni JID'in tum acik soketlerine sys.notice. */
  const bildirHepsi = (jid, key, params) => jideBildir(jid, key, params);

  /* ================================================================ ISLEYICILER */

  async function acKapa(ws, ac) {
    if (ac) {
      /* DENETIM DUZELTMESI: abonelik ONCE ekleniyordu. JID'i olmayan sokete
         tanit() 'close' dinleyicisi TAKMIYOR, yani o soket kapansa bile
         `aboneler` kumesinde kalir ve defter yayinlari sonsuza dek olu
         soketlere yazilirdi. Once kimlik, sonra abonelik. */
      const jid = tanit(ws);
      if (jid == null) return;
      aboneler.add(ws);
      await teminatKur();
      await cuzdanYolla(jid);
      frame(ws, 'exch.book', await defterOku());
      frame(ws, 'exch.orders', { orders: await emirlerimOku(jid) });
      frame(ws, 'exch.trades', { trades: await islemlerOku() });
      frame(ws, 'exch.stakes', { stakes: await stakelerOku(jid), serverTime: Date.now() });
    } else {
      aboneler.delete(ws);
    }
  }

  async function emirVer(ws, d) {
    const jid = tanit(ws);
    if (jid == null) return hata(ws, 'ERR_AUTH');

    const taraf = sec(d?.side, ['buy', 'sell']);
    const price = tam(d?.price, 100, 2_000_000_000);
    const adet = tam(d?.qtyUnits, 100, 100_000_000);
    const tif = sec(d?.tif, ['gtc', 'ioc']);
    if (!taraf || price == null || adet == null || !tif) return hata(ws, 'ERR_VALIDATION');

    await teminatKur();

    const cuzdan = await cuzdanOku(jid);
    let teminatTutari = 0;

    if (taraf === 'sell') {
      const serbest = cuzdan.jadeUnits - cuzdan.jadeLockedUnits;
      if (serbest < adet) return hata(ws, 'ERR_NO_JADE');
    } else {
      teminatTutari = maliyet(adet, price);
      const altin = await bankaAltini(jid);
      if (altin < teminatTutari) return hata(ws, 'ERR_NO_GOLD');
      if (!await bankaDus(jid, teminatTutari)) return hata(ws, 'ERR_NO_GOLD');
    }

    /* WebPlaceOrder: SATIS icin Silk'i kilitler, ALIS icin sadece satir acar.
       Alisin altin teminati yukarida zaten bankadan dusuldu. */
    let orderId = null;
    try {
      const r = await yordam('WebPlaceOrder',
        { JID: jid, Side: taraf, Price: price, QtyUnits: adet });
      orderId = r.recordset?.[0]?.id ?? null;
    } catch (e) {
      if (taraf === 'buy' && teminatTutari > 0) await bankaEkle(jid, teminatTutari);
      log('borsa: WebPlaceOrder hatasi:', String(e?.message ?? e).slice(0, 140));
      return hata(ws, 'ERR_BUSY', 'err.busy.exchange');
    }
    if (!orderId) {
      if (taraf === 'buy' && teminatTutari > 0) await bankaEkle(jid, teminatTutari);
      return hata(ws, 'ERR_BUSY', 'err.busy.exchange');
    }
    if (taraf === 'buy') temYaz(orderId, teminatTutari);

    const { dolan, toplamAltin, etkilenen } =
      await esles({ takerId: orderId, takerJID: jid, taraf, limit: price, adet });

    let kalan = adet - dolan;

    /* Taker ALIS emri defterde kalacaksa: kalan teminat kalan unit'leri
       odemeye yetiyor mu? (bkz. teminatiUyumla - kurus artigi hayalet
       derinlik uretiyordu.) Yetmiyorsa emir kucultulur ya da kapatilir. */
    let artikKapatti = false;
    if (taraf === 'buy' && kalan > 0 && tif === 'gtc') {
      const yeni = await teminatiUyumla(orderId, jid, price, kalan, dolan);
      if (yeni === 0) { artikKapatti = true; kalan = 0; } else { kalan = yeni; }
    }

    if (artikKapatti) {
      /* Kalan kismi kurus artigi yuzunden karsilanamadi - IOC ile ayni sonuc. */
      if (dolan > 0) {
        bildirHepsi(jid, 'sys.exch.partial_fill_refunded',
          { units: jadeYazi(adet), filled: jadeYazi(dolan) });
      } else {
        bildirHepsi(jid, 'sys.exch.refunded_none');
      }
    } else if (kalan <= 0) {
      /* tamamen doldu: alis emrinin artan teminatini iade et */
      if (taraf === 'buy') {
        const artan = temSil(orderId);
        if (artan > 0) await bankaEkle(jid, artan);
      }
      const ortalama = dolan > 0 ? Math.round((toplamAltin * 100) / dolan) : price;
      bildirHepsi(jid, taraf === 'buy' ? 'sys.exch.order_filled_buy' : 'sys.exch.order_filled_sell',
        { units: jadeYazi(dolan), price: ortalama });
    } else if (tif === 'ioc') {
      /* IOC: kalan kisim ANINDA iptal + iade */
      await emirKapat(orderId, 'cancelled');
      if (taraf === 'buy') {
        const artan = temSil(orderId);
        if (artan > 0) await bankaEkle(jid, artan);
      } else {
        await jadeOynat(jid, 0, -kalan);
      }
      if (dolan > 0) {
        bildirHepsi(jid, 'sys.exch.partial_fill_refunded',
          { units: jadeYazi(adet), filled: jadeYazi(dolan) });
      } else {
        bildirHepsi(jid, 'sys.exch.refunded_none');
      }
    } else {
      /* GTC: kalan kisim defterde bekliyor. Emir kurus artigi yuzunden
         kucultulmus olabilir, o yuzden `adet` degil GERCEK boy bildirilir. */
      bildirHepsi(jid, 'sys.exch.order_placed',
        { units: jadeYazi(dolan + kalan), price });
    }

    for (const j of etkilenen) { await cuzdanYolla(j); await emirlerYolla(j); }
    await defterYayinla();
    if (dolan > 0) await islemlerYayinla();
    return true;
  }

  async function emirIptal(ws, d) {
    const jid = tanit(ws);
    if (jid == null) return hata(ws, 'ERR_AUTH');
    const id = typeof d?.orderId === 'string' ? d.orderId.trim() : '';
    if (!GUID_RE.test(id)) return hata(ws, 'ERR_VALIDATION');

    await teminatKur();

    const r = await sorguGuid(
      `SELECT id, side, price, qtyUnits, filledUnits FROM dbo.WebExchangeOrder
        WHERE id = @id AND JID = @JID AND status = 'open'`, 'id', id, { JID: jid });
    const o = r.recordset?.[0];
    if (!o) return hata(ws, 'ERR_NOT_FOUND');
    const taraf = o.side === 'sell' ? 'sell' : 'buy';
    const kalan = sayi(o.qtyUnits) - sayi(o.filledUnits);

    try {
      // WebCancelOrder: status='cancelled' + SATIS icin kilitli Silk cozulur.
      const s = await sqlAl();
      await yordam('WebCancelOrder', { JID: jid, OrderId: [s.UniqueIdentifier, id] });
    } catch (e) {
      log('borsa: WebCancelOrder hatasi:', String(e?.message ?? e).slice(0, 140));
      return hata(ws, 'ERR_BUSY', 'err.busy.exchange');
    }

    if (taraf === 'buy') {
      const artan = temSil(id);
      if (artan > 0) await bankaEkle(jid, artan);
      bildir(ws, 'sys.exch.cancelled_gold', { gold: artan });
    } else {
      bildir(ws, 'sys.exch.cancelled_jade', { units: jadeYazi(kalan) });
    }

    await cuzdanYolla(jid);
    await emirlerYolla(jid);
    await defterYayinla();
    return true;
  }

  /** Oyuncu bir DEPO GOREVLISI'nin yaninda mi? (bkz. dosya ustundeki bulgu)
   *  Konum verisi yoksa false doner - altin ucu fail-closed. */
  function depoYakinMi(ws) {
    const harita = depoKonumlari(HERE, log);
    if (!harita.size) return false;
    const zid = ws?.zoneId;
    if (typeof zid !== 'string' || !zid) return false;
    const cx = sayi(ws.char?.x), cz = sayi(ws.char?.z);
    for (const [k, liste] of harita) {
      if (!k.startsWith(`${zid}|`)) continue;
      for (const p of liste) {
        const dx = p.x - cx, dz = p.z - cz;
        if (dx * dx + dz * dz <= DEPO_MENZIL_2) return true;
      }
    }
    return false;
  }

  async function altinCek(ws, d) {
    const jid = tanit(ws);
    if (jid == null) return hata(ws, 'ERR_AUTH');
    const miktar = tam(d?.amount, 1, 2_000_000_000);
    if (miktar == null) return hata(ws, 'ERR_VALIDATION');
    const ch = ws.char;
    if (!ch) return hata(ws, 'ERR_VALIDATION');
    /* Depo gorevlisi kapisi: bank.withdrawGold (106) ile ayni kural.
       ERR_RANGE paketteki Sht enum'unda var (25602274). */
    if (!depoYakinMi(ws)) return hata(ws, 'ERR_RANGE');

    if (!await bankaDus(jid, miktar)) return hata(ws, 'ERR_NO_GOLD');
    ch.gold = sayi(ch.gold) + miktar;
    await karakterAltiniKaydet(ch);

    if (envanterPayload) frame(ws, 'inv.update', envanterPayload(ch));
    bildir(ws, 'sys.bank.gold_out', { gold: miktar });
    await cuzdanYolla(jid);
    return true;
  }

  /** _Char.RemainGold — giriste routes_auth.js zaten buradan okuyor. */
  async function karakterAltiniKaydet(ch) {
    if (!SHARD_AD) return;
    const charId = Number(ch?.id);
    if (!Number.isFinite(charId)) return;
    try {
      await sorgu(`UPDATE ${SHARD_AD}.dbo._Char SET RemainGold = @g WHERE CharID = @c`,
        { g: Math.max(0, Math.round(sayi(ch.gold))), c: charId });
    } catch (e) {
      log('borsa: karakter altini kaydedilemedi:', String(e?.message ?? e).slice(0, 120));
    }
  }

  /**
   * DENETIM BULGUSU — istemcinin vaadi ile odenen odul 1 unit sapabiliyor.
   *
   * Istemcinin projeksiyonu (paket 27601263):
   *     kRt(p, k) = Math.round(p * k.aprBps * k.lockDays / (1e4 * 365))
   * ve ekranda `ui.staking.pays_exact_tip` = "Vade sonunda TAM {reward} Silk
   * oder" yaziyor. Oysa WebCreateStake yordami
   *     (@PrincipalUnits * @AprBps * @LockDays) / (10000 * 365)
   * yaziyor - bu T-SQL'de TAM SAYI bolmesi, yani FLOOR. Kesir >= 0,5 oldugu
   * her stake'te oyuncuya soz verilenden 1 unit (0,01 Silk) EKSIK odenirdi.
   * Ornek: 123,45 Silk x %5 x 7 gun -> istemci 12, yordam 11.
   *
   * Yordam paylasimli bir DB nesnesi (baska calismalar da kullaniyor), onu
   * degistirmiyoruz; yeni acilan satirin odulunu istemcinin gosterdigi
   * degere tamamliyoruz. Fark en fazla +1 unit'tir ve yalnizca floor != round
   * oldugunda yazilir.
   */
  async function odulunuIstemciyeUydur(jid, adet, gun, aprBps) {
    const ham = (adet * aprBps * gun) / (BPS * 365);
    const yordamDegeri = Math.floor(ham);      // WebCreateStake'in yazdigi
    const istemciDegeri = Math.round(ham);     // kRt'nin gosterdigi
    if (istemciDegeri === yordamDegeri) return;
    await sorgu(
      `UPDATE dbo.WebStake SET rewardUnits = @yeni
        WHERE id = (SELECT TOP 1 id FROM dbo.WebStake
                     WHERE JID = @JID AND status = 'active'
                       AND principalUnits = @p AND lockDays = @g AND aprBps = @a
                       AND rewardUnits = @eski
                     ORDER BY startedAt DESC)`,
      { JID: jid, p: adet, g: gun, a: aprBps, eski: yordamDegeri, yeni: istemciDegeri });
  }

  async function stakeEt(ws, d) {
    const jid = tanit(ws);
    if (jid == null) return hata(ws, 'ERR_AUTH');
    const gun = tam(d?.lockDays, 1, 365);
    const adet = tam(d?.jadeUnits, 100, 100_000_000);
    if (gun == null || adet == null) return hata(ws, 'ERR_VALIDATION');
    // Kademeler istemcinin ERt tablosundan; WebCreateStake da 7/30/90 disini reddediyor.
    const aprBps = STAKE_KADEMELERI.get(gun);
    if (!aprBps) return hata(ws, 'ERR_VALIDATION');
    if (adet < STAKE_EN_AZ) return hata(ws, 'ERR_VALIDATION');

    const c = await cuzdanOku(jid);
    if (c.jadeUnits - c.jadeLockedUnits < adet) return hata(ws, 'ERR_NO_JADE');

    try {
      await yordam('WebCreateStake',
        { JID: jid, PrincipalUnits: adet, LockDays: gun, AprBps: aprBps });
      await odulunuIstemciyeUydur(jid, adet, gun, aprBps);
    } catch (e) {
      log('borsa: WebCreateStake hatasi:', String(e?.message ?? e).slice(0, 140));
      return hata(ws, 'ERR_BUSY', 'err.busy.exchange');
    }

    bildir(ws, 'sys.exch.staked', { units: jadeYazi(adet) });
    await cuzdanYolla(jid);
    await stakelerYolla(jid);
    return true;
  }

  async function stakeAl(ws, d) {
    const jid = tanit(ws);
    if (jid == null) return hata(ws, 'ERR_AUTH');
    const id = typeof d?.stakeId === 'string' ? d.stakeId.trim() : '';
    if (!GUID_RE.test(id)) return hata(ws, 'ERR_VALIDATION');

    let anapara = 0, odul = 0;
    try {
      const s = await sqlAl();
      const r = await yordam('WebClaimStake', { JID: jid, StakeId: [s.UniqueIdentifier, id] });
      anapara = sayi(r.recordset?.[0]?.principal);
      odul = sayi(r.recordset?.[0]?.reward);
    } catch (e) {
      const m = String(e?.message ?? e);
      if (/not_claimable/i.test(m)) return hata(ws, 'ERR_NOT_FOUND');
      log('borsa: WebClaimStake hatasi:', m.slice(0, 140));
      return hata(ws, 'ERR_BUSY', 'err.busy.exchange');
    }

    // Yordam kilidi cozup odulu ekliyor; oyuncunun eline gecen = anapara + odul.
    bildir(ws, 'sys.exch.stake_claimed', { units: jadeYazi(anapara + odul) });
    await cuzdanYolla(jid);
    await stakelerYolla(jid);
    return true;
  }

  /** GM kapisi — mock* uclari test muslugudur (bkz. dosya basligi). */
  const gmMi = (ws) => Number(ws?.user?.sec_primary) === 1 && Number(ws?.user?.sec_content) === 1;

  async function sahteYatir(ws, d) {
    const jid = tanit(ws);
    if (jid == null) return hata(ws, 'ERR_AUTH');
    if (!gmMi(ws)) return hata(ws, 'ERR_AUTH');
    const adet = tam(d?.jadeUnits, 1, 10_000_000_000);
    if (adet == null) return hata(ws, 'ERR_VALIDATION');

    await cuzdanOku(jid);              // satir + adres garantisi
    await jadeOynat(jid, adet, 0);
    bildir(ws, 'sys.exch.deposit', { units: jadeYazi(adet) });
    await cuzdanYolla(jid);
    log(`borsa: SAHTE YATIRMA (GM) JID=${jid} +${jadeYazi(adet)} Silk`);
    return true;
  }

  async function sahteCek(ws, d) {
    const jid = tanit(ws);
    if (jid == null) return hata(ws, 'ERR_AUTH');
    if (!gmMi(ws)) return hata(ws, 'ERR_AUTH');
    /* Semada ust sinir YOK (`Y().int().min(1)`), o yuzden tam() kullanamiyoruz.
       Ama isSafeInteger sart: 1e300 de Number.isInteger'a gore tam sayidir ve
       hesaplara girerse precision copu uretir. */
    const adet = typeof d?.jadeUnits === 'number' && Number.isSafeInteger(d.jadeUnits)
      && d.jadeUnits >= 1 ? d.jadeUnits : null;
    if (adet == null) return hata(ws, 'ERR_VALIDATION');

    const c = await cuzdanOku(jid);
    if (c.jadeUnits - c.jadeLockedUnits < adet) return hata(ws, 'ERR_NO_JADE');
    await jadeOynat(jid, -adet, 0);
    bildir(ws, 'sys.exch.withdraw', { units: jadeYazi(adet) });
    await cuzdanYolla(jid);
    log(`borsa: SAHTE CEKIM (GM) JID=${jid} -${jadeYazi(adet)} Silk`);
    return true;
  }

  /* ================================================================ giris noktasi */

  function mesaj(ws, t, d) {
    if (!MESAJLARIM.has(t)) return false;
    tanit(ws);

    const isle = async () => {
      switch (t) {
        case 'exch.open': return acKapa(ws, true);
        case 'exch.close': return acKapa(ws, false);
        case 'exch.place': return emirVer(ws, d);
        case 'exch.cancel': return emirIptal(ws, d);
        case 'exch.withdrawGold': return altinCek(ws, d);
        case 'exch.stake': return stakeEt(ws, d);
        case 'exch.claimStake': return stakeAl(ws, d);
        case 'exch.mockDeposit': return sahteYatir(ws, d);
        case 'exch.mockWithdraw': return sahteCek(ws, d);
        default: return false;
      }
    };

    /* Tum borsa islemleri TEK sirada yurur: emir defteri, teminat ve cuzdan
       ayni anda iki mesajdan degistirilemez. mesaj() senkron true doner. */
    sirala(isle).catch((e) => {
      const m = String(e?.message ?? e);
      log(`borsa hata (${t}):`, m.slice(0, 160));
      try { frame(ws, 'err', { code: 'ERR_BUSY', key: 'err.busy.exchange' }); } catch { /* soket kapali */ }
    });
    return true;
  }

  log('borsa: 9 mesaj hazir (exch.open/close/place/cancel/withdrawGold/stake/claimStake/mock*)');

  return {
    mesaj,
    /* test / tani icin disari acilanlar */
    _ic: {
      jadeYazi, maliyet, alinabilirUnits, komisyon, tam, sec,
      teminat, aboneler, soketler, depoYakinMi,
      STAKE_KADEMELERI, TAKER_KOMISYON_BPS, MESAJLARIM,
      DEPO_MENZIL, DEPO_SAYISI: () => depoKonumlari(HERE, log).size,
      bekle: () => sira,
    },
  };
}
