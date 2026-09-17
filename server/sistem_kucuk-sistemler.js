/**
 * sistem_kucuk-sistemler.js — kalan tekil sistemler
 *
 * Islenen c2s mesajlari (opcode'lar protocol.js ile birebir):
 *     68  chat.whisper     sema: X({to,text})            hiz sinifi: chat
 *     40  carrier.op       sema: HJ('op',[...])          hiz sinifi: shop
 *    125  auction.op       sema: HJ('op',[...])          hiz sinifi: exchange
 *    119  mall.buy         sema: X({itemId})             hiz sinifi: shop
 *    120  premium.buy      sema: X({tier})               hiz sinifi: shop
 *
 *     85  revive.respond ve 93 unique.op ARTIK BURADA ISLENMIYOR
 *     (sartname-2 madde 5): dagitimlari sistem_dirilis-unique.js'e (ve
 *     yerinde teklifler icin sistem_yerinde-dirilis.js'e) birakildi -
 *     gerekce mesaj switch'indeki notta.
 *
 * ===========================================================================
 * SEMA KAYNAGI — hicbiri uydurulmadi
 * ===========================================================================
 * Okunabilir istemci paketi:
 *   playjs_source\index-BUMMQVRB.js
 *
 * Zod takma adlari (paketten dogrulanmis):
 *   X = z.object   Y = z.number   J = z.string   BJ = z.array   RJ = z.boolean
 *   qJ = z.enum    JJ = z.literal  VJ = z.union   GJ = z.record
 *   HJ = z.discriminatedUnion
 *
 * --- ISLENEN c2s SEMALARI (ham hal + paket ofseti) -------------------------
 *
 *  @25610465  T$(`chat.whisper`, 68, X({
 *               to:   J().min(1).max(16),
 *               text: J().min(1).max(200)
 *             }), `chat`)
 *
 *  @25611726  T$(`revive.respond`, 85, X({
 *               offerId: Y().int(),
 *               accept:  RJ()
 *             }), `misc`)
 *
 *  @25613667  T$(`unique.op`, 93, HJ(`op`, [
 *               X({ op: JJ(`board`) }),
 *               X({ op: JJ(`levelBoard`) }),
 *               X({ op: JJ(`professionBoard`), professionId: J().min(1).max(64) })
 *             ]), `misc`)
 *
 *  @25633199  T$(`carrier.op`, 40, HJ(`op`, [
 *               X({ op: JJ(`confirm`), lines: BJ(X({
 *                     npcId:  J().max(64),
 *                     itemId: J().max(64),
 *                     qty:    Y().int().min(1).max(9999)
 *                   })).min(1).max(32) }),
 *               X({ op: JJ(`collect`), slot: Y().int().min(0).max(63),
 *                                      qty:  Y().int().min(1).max(9999) }),
 *               X({ op: JJ(`collectAll`) })
 *             ]), `shop`)
 *
 *  @25616811  T$(`auction.op`, 125, HJ(`op`, [
 *               X({ op: JJ(`sub`) }),
 *               X({ op: JJ(`unsub`) }),
 *               X({ op: JJ(`list`), page: Y().int().min(0).max(9999) }),
 *               X({ op: JJ(`create`),
 *                   auctioneerSlot: Y().int().min(0).max(159),
 *                   itemSlot:       Y().int().min(0).max(159),
 *                   startPrice:     Y().int().min(1).max(2e9),
 *                   buyNowPrice:    Y().int().min(2).max(2e9),
 *                   durationH:      VJ([JJ(7), JJ(24), JJ(48)]) }),
 *               X({ op: JJ(`bid`),    auctionId: J().uuid(),
 *                                     amount: Y().int().min(1).max(2e9) }),
 *               X({ op: JJ(`buyNow`), auctionId: J().uuid() }),
 *               X({ op: JJ(`cancel`), auctionId: J().uuid() }),
 *               X({ op: JJ(`claim`),  auctionId: J().uuid() })
 *             ]), `exchange`)
 *
 *  @25615260  T$(`mall.buy`,    119, X({ itemId: J().min(1) }), `shop`)
 *  @25615318  T$(`premium.buy`, 120, X({ tier: _$ }), `shop`)
 *             _$ = qJ([`bronze`,`silver`,`gold`])            @25590147
 *
 * --- GONDERILEN s2c SEMALARI ----------------------------------------------
 *
 *  @25624659  T$(`chat.pm`, 162, X({
 *               peer:   J(),
 *               kind:   qJ([`in`,`out`,`system`]),
 *               text:   J(),
 *               key:    qJ(Tht).optional(),
 *               params: GJ(J(), VJ([J(),Y()])).optional()
 *             }))
 *
 *  @25619913  T$(`revive.offer`, 201, X({
 *               offerId:Y().int(), casterId:Y().int(), casterName:J(),
 *               skillId:J(), expiresAt:Y(),
 *               hp:Y().int().nonnegative(), mp:Y().int().nonnegative() }))
 *
 *  @25620105  T$(`revive.result`, 202, X({
 *               id:Y().int(), ok:RJ(), hp:Y().int().optional(),
 *               mp:Y().int().optional(), casterId:Y().int().optional(),
 *               skillId:J().optional(), reason:J().optional() }))
 *
 *  @25620310  T$(`unique.timers`, 203, X({
 *               serverTime:Y(),
 *               uniques: BJ(X({ monsterId:J(), zoneId:J(), live:RJ(),
 *                               spawnAtMs:Y().nullable(),
 *                               totalMs:Y().nullable() })) }))
 *
 *  @25620499  T$(`unique.board`, 204, HJ(`kind`, [
 *               X({ kind:JJ(`unique`),
 *                   rows: BJ(X({rank:Y().int(),name:J(),level:Y().int(),points:Y().int()})),
 *                   me:   X({rank:Y().int(),points:Y().int()}).nullable() }),
 *               X({ kind:JJ(`level`),
 *                   rows: BJ(X({rank:Y().int(),name:J(),level:Y().int()}).strict()),
 *                   me:   X({rank:Y().int(),level:Y().int()}).nullable() }),
 *               X({ kind:JJ(`profession`), professionId:J(),
 *                   rows: BJ(X({rank:Y().int(),name:J(),level:Y().int()}).strict()),
 *                   me:   X({rank:Y().int(),level:Y().int()}).nullable() })
 *             ]))
 *             DIKKAT — level/profession satirlari `.strict()`: FAZLA ALAN
 *             gonderilirse istemci paketi SESSIZCE atar. `points` YOK.
 *
 *  @25633520  T$(`carrier.state`, 213, X({
 *               phase: qJ([`idle`,`flying`,`landed`]),
 *               zoneId:J().optional(), x:Y().optional(), z:Y().optional(),
 *               arriveAtMs:Y().optional(), landedUntilMs:Y().optional(),
 *               birdEntityId:Y().int().optional(),
 *               slots: BJ(X({itemId:J(), qty:Y().int()}).nullable()),
 *               slotsMax:Y().int(), readyAt:Y() }))
 *
 *  @25631385  T$(`auction.list`, 242, X({ auctions:BJ(vht), page:Y().int(),
 *                                         pages:Y().int(), serverTime:Y() }))
 *  @25631496  T$(`auction.mine`, 243, X({ entries:BJ(vht), serverTime:Y() }))
 *  @25631567  T$(`auction.notice`, 244, HJ(`kind`,[
 *               X({kind:JJ(`outbid`), auctionId:J(), itemDefId:J(), amount:Y().int()}),
 *               X({kind:JJ(`won`),    auctionId:J(), itemDefId:J(), amount:Y().int()}),
 *               X({kind:JJ(`sold`),   auctionId:J(), itemDefId:J(), amount:Y().int()}),
 *               X({kind:JJ(`expired`),auctionId:J(), itemDefId:J()}) ]))
 *
 *             vht = X({ id:J(), seller:J(), item:S$,                 @25597639
 *                       startPrice:Y().int(), buyNowPrice:Y().int(),
 *                       currentBid:Y().int(), bidCount:Y().int(),
 *                       endsAt:Y(),
 *                       status:qJ([`active`,`ended_sold`,`ended_unsold`,`cancelled`]),
 *                       finalPrice:Y().int().nullable(),
 *                       youAreTop:RJ(), mine:RJ(), claimable:RJ() })
 *             S$  = X({ itemId:J(), qty:Y().int().min(1),            @25593826
 *                       plus?, dur?, maxDur?, variance?, blues?, rolls? })
 *
 *  @25624822  T$(`premium.update`, 189, X({ tier:_$.nullable(),
 *                                           expiresAt:Y().nullable() }))
 *  @25623180  T$(`entity.premium`, 190, X({ id:Y().int(), tier:_$.nullable() }))
 *  @25630955  T$(`sys.notice`, 195, X({ key:qJ(Tht), params?, display? }))
 *  @25631093  T$(`err`, 240, X({ code:qJ(Sht), key:qJ(Eht).optional(), msg?, q?, params? }))
 *  @25623008  T$(`inv.update`, 149, aht = X({gold, bag, equip}))
 *
 *             Tht (sys.* anahtar listesi)  @25603312
 *             Eht (err.* anahtar listesi)  @25606160
 *             Sht (ERR_ kod listesi)       @25602274
 *
 * ===========================================================================
 * ISTEMCI DAVRANISI (paketten okunmus, tahmin degil)
 * ===========================================================================
 *  err       @27134276 : `key` varsa ve yerellestirme sozlugunde bulunuyorsa
 *                        SADECE onu gosterir; yoksa `err.<code>` denenir.
 *  chat.pm   @27126341 : kind==='system' && key && key!=='raw' ise metin
 *                        anahtardan uretilir, yoksa `text` gosterilir.
 *  revive.*  @27124873 : offer'i pencereye koyar; respond gonderirken teklifi
 *                        KENDI ICINDE siler -> "reddet" cevabina kare beklemez.
 *  carrier   @27355135 : phase==='idle' && premium YOK ise pencere
 *                        "ui.carrier.premium_required" kilidini gosterir
 *                        -> tasiyici PREMIUM gerektirir.
 *            @27349351 : siparis bedeli = SUM(items.buyPrice * qty)  (CFt)
 *            @27357296 : slotsMax gelmezse gameConfig.carrier.baseSlots
 *  auction   @27263007 : pPt(currentBid,startPrice) = currentBid<=0
 *                        ? startPrice
 *                        : currentBid + max(1, floor(currentBid*0.05))
 *                        -> minimum teklif kurali BUDUR.
 *  unique    @27131381 : unique.timers -> sayac cubugu; @27131564 unique.board.
 *  gear      @8702063  : vY() = type in {weapon, shield, armor, accessory}
 *                        -> mezata SADECE bunlar konabilir (err.auction.not_gear).
 *
 * ===========================================================================
 * VERI KAYNAKLARI
 * ===========================================================================
 *   data/items.json          .items (3005) + .itemMall + .premium
 *                            (_meta.extractedFrom: config/item-mall.json = zst,
 *                             config/premium.json = Wst)
 *   data/itemstats.json      ctx.ITEMSTATS (2860) - uzerine bindirilir
 *   data/game-config.json    GCFG.carrier bloğu + respawnHpPct + bagSlots
 *   data/uniques.json        config/uniques.json kopyasi (6 unique, gercek
 *                            Tab_RefNest kamp koordinatlari, respawnMinutes)
 *   data/teleporters.json    carrier.orbByZone kuresinin GERCEK konumu
 *   data/npcshops.json       carrier siparisinin NPC/stok dogrulamasi
 *   data/mobs.json           unique mob tanimi (hp/level/modelKey, unique:true)
 *   SRO_WEB_GAME             WebWallet / WebGetWallet, WebPremium / WebSetPremium,
 *                            WebAuction + WebAuctionBid, WebCharCarrier,
 *                            WebUniqueKill
 *   <SHARD>.dbo._Char        seviye siralamasi + altin kaliciligi
 *
 * ===========================================================================
 * SUNUCU POLITIKASI — pakette KARSILIGI OLMAYAN sayilar (acikca isaretli)
 * ===========================================================================
 *   MEZAT_SAYFA        10     auction.list sayfa boyu (istemci sunucudan ne
 *                             gelirse onu cizer, sayi pakette yok)
 *   MEZAT_AKTIF_SINIR   5     err.auction.too_many esigi (pakette yok)
 *   DIRILIS_SURESI  30000 ms  revive.offer gecerlilik suresi (pakette yok;
 *                             cagiran sistem parametreyle ezebilir)
 *   Bunlar disindaki HER sayi yukaridaki veri dosyalarindan gelir.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
/* Esya ORNEK alanlarinin (plus/variance/dur/maxDur) tek uretim noktasi -
   plan maddesi 26. Kural ve kanitlar esya.js basliginda. */
import { yeniYigin } from './esya.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/* Sht (@25602274) icindeki kodlar - istemci enum disi kodu REDDEDER. */
const HATA = {
  DOGRULAMA: 'ERR_VALIDATION',
  MENZIL: 'ERR_RANGE',
  ALTIN: 'ERR_NO_GOLD',
  JADE: 'ERR_NO_JADE',
  CANTA: 'ERR_BAG_FULL',
  OLU: 'ERR_DEAD',
  BULUNAMADI: 'ERR_NOT_FOUND',
  BEKLE: 'ERR_COOLDOWN',
  MESGUL: 'ERR_BUSY',
};

/* Eht (@25606160) icindeki anahtarlar - hepsi client/assets/locales/tr.json'da
   DOGRULANDI (err.auction.* 14, err.carrier.* 4, err.premium.required). */
const ANAHTAR = {
  PREMIUM: 'err.premium.required',
  C_AKTIF: 'err.carrier.active',
  C_SEHIR: 'err.carrier.no_city',
  C_INMEDI: 'err.carrier.not_landed',
  C_YUVA: 'err.carrier.slots',
  /* MADDE 56 - tasiyici genisletme tavani. Anahtar Eht enum'unda @25608342,
     tr.json karsiligi "Zaten en fazla sayfa sayisina ulasildi."
     sistem_banka-depo.js canta/depo tavanlarinda AYNI anahtari kullaniyor. */
  GENIS_MAX: 'err.expand.max',
  M_BITTI: 'err.auction.ended',
  M_DUSUK: 'err.auction.too_low',
  M_HEMENAL: 'err.auction.use_buynow',
  M_KENDI: 'err.auction.own_auction',
  M_ZATEN: 'err.auction.already_top',
  M_TEKLIFVAR: 'err.auction.has_bids',
  M_CANTA: 'err.auction.bag_full',
  M_EKIPMAN: 'err.auction.not_gear',
  M_MEZATCI: 'err.auction.no_auctioneer',
  M_COKFAZLA: 'err.auction.too_many',
  M_ALTIN: 'err.auction.gold',
  M_FIYAT: 'err.auction.bad_price',
  M_ALINAMAZ: 'err.auction.not_claimable',
};

// --- sunucu politikasi (pakette karsiligi YOK, bilerek burada toplandi) ----
const MEZAT_SAYFA = 10;
const MEZAT_AKTIF_SINIR = 5;
const DIRILIS_SURESI = 30_000;
/** Unique'leri gercekten dunyaya dogurmak. false yapilirsa sayaclar yine
 *  isler ama sahada canavar OLUSMAZ (acil kapama anahtari). */
const UNIQUE_DOGUR = true;

/* unique.timers yayin periyodu: CANLI YAKALAMADAN
   (GERCEK/zone_init.json -> "unique.timers".periyot_ms = 60000). */
const UNIQUE_PERIYOT = 60_000;

/** vY() @8702063 - mezata konabilen tipler. */
const EKIPMAN_TIPI = new Set(['weapon', 'shield', 'armor', 'accessory']);

// ---------------------------------------------------------------- yardimcilar

/** data/ altindan JSON okur; yoksa null. */
function okuJson(dataDir, dosya) {
  const adaylar = [path.join(dataDir, dosya), path.join(HERE, 'data', dosya)];
  for (const p of adaylar) {
    try {
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch { /* bozuk dosya -> sonraki aday */ }
  }
  return null;
}

const tamsayi = (v, vars = 0) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : vars);
const kirp = (v, alt, ust) => Math.max(alt, Math.min(ust, v));

/** vSRO datetime -> epoch ms. */
function zamanaCevir(v) {
  if (v == null) return null;
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * ONCEKI ORNEK — kur() birden fazla kez cagrilabilir.
 *
 * server.js @216: admin panelinden HERHANGI bir ayar degistirilince
 * `sistemleriKur(true)` calisir ve tum sistem modulleri YENIDEN kurulur
 * (moduller GCFG'yi const'a kopyaladigi icin bilerek boyle). server.js eski
 * ornegin referansini birakiyor ama zamanlayicisini DURDURMUYOR - unref()
 * yalnizca sureci ayakta tutmamayi saglar, tik atmaya devam eder.
 * Eski ornek kendi UNIQUE/MEZAT haritalariyla tikmeye devam edince:
 *   - unique'ler CIFT dogar (her ornek kendi takvimini isletir),
 *   - sys.notice duyurulari cift gider,
 *   - mezat sureleri iki yerde birden kapanir.
 * ESM modul onbellegi sayesinde bu degisken yeniden kurmalar arasinda yasar;
 * yeni kur() eskisini kapatir.
 */
let ONCEKI_ORNEK = null;

/* ============================================================================
 * MODUL KAPSAMI DEFTERLERI — sartname madde 1 (sikayet 5'in KOK NEDENI)
 *
 * Bu uc defter eskiden kur() KAPATMASINDA yasiyordu. GM panelinden HERHANGI
 * bir ayar kaydi (deger degismese bile) -> admin.js tazele() -> uygula(GCFG)
 * -> server.js:414 sistemleriKur(true) -> YENI kur() ornegi -> defter BOS.
 * Zincirin sonucu (olculdu):
 *   - ws.__ks_tier soket uzerinde 'gold' kaldigi icin 1 sn'lik premiumSureTik
 *     "sure doldu" sanip premium.update{tier:null,expiresAt:null} (189,
 *     @25625700) + entity.premium{tier:null} (190) yolluyordu -> premium
 *     1 SANIYE ICINDE EKRANDAN SILINIYORDU;
 *   - selfAlanlari(ch) null donuyordu ve istemcinin zoneInit eylemi
 *     (@25648200) self'i BIRLESTIRMEZ, KOMPLE EZER -> her isinlanma/bolge
 *     gecisi kaybi yeniden gorunur kiliyordu;
 *   - ws.__ks_hazir true kaldigi icin DB bir daha OKUNMUYORDU.
 * ESM modul onbellegi sayesinde bu defterler yeniden kurmalar arasinda yasar
 * (ayni kalip: sistem_dirilis-unique.js ONCEKI_DURUM). Kaynaklari DB oldugu
 * icin (PREMIUM -> WebPremium, CARRIER -> WebCharCarrier) sizinti onlemi
 * ayril() icinde ELLE temizliktir (madde 2).
 *
 * MEZAT / MEZAT_ABONE / UNIQUE / DIRILIS BILEREK TASINMADI: UNIQUE ve MEZAT
 * kur() sonunda uniqueKur()/mezatYukle() ile DB'den kendini ZATEN tazeliyor
 * (tasinsalar cift kayit + cift zamanlayici olurdu); DIRILIS ve MEZAT_ABONE
 * kisa omurlu, sifirlanmalari zararsiz.
 * ========================================================================= */
/** JID -> {tier, expiresAt} (null tier = premium yok) — kaynak dbo.WebPremium */
const PREMIUM = new Map();
/** charId -> tasiyici durumu — kaynak dbo.WebCharCarrier */
const CARRIER = new Map();
/** charId -> gecikmis altin alacagi (cevrimdisi iken olusan iadeler).
 *  Bekleyen bir ALACAKTIR: oturumla da yeniden kurulumla da BITMEZ. */
const BEKLEYEN_ALTIN = new Map();

// =============================================================================
export function kur(ctx) {
  /* Yeniden kurma: onceki ornegin zamanlayicisini kapat (yukaridaki nota bak). */
  if (ONCEKI_ORNEK) {
    try { ONCEKI_ORNEK._durdur(); } catch { /* kapatilmis olabilir */ }
    ONCEKI_ORNEK = null;
  }
  const {
    world = null,
    frame = () => {},
    broadcast = () => {},
    log = () => {},
    GCFG = {},
    ITEMSTATS = null,
    envanterPayload = null,
    derived = null,
    web = null,
    SHARD = null,
    /* YAN BULGU 1 (bulgular_hizli 2026-09-03): regenBoost tiki icin regen
       konfigurasyonu - combat.regen getter'i (combat.js:1063) canli degeri
       verir (/gm reloadcombat sonrasi da guncel). server.js sistemCtx()
       `combat: COMBAT` geciriyor (server.js:1583). */
    combat = null,
    /* MADDE 44: mezat parasi HESAP BANKASINA yaziliyor; koprusu
       sistem_banka-depo.bankayaAltinEkle(). Modul yoksa null doner - cagiran
       daima ?. ile kullanmali (server.js sistemOrnegi sozlesmesi). */
    sistemOrnegi = null,
  } = ctx ?? {};

  const dataDir = world?.dataDir ?? path.join(HERE, 'data');
  const simdi = () => Date.now();

  // ----------------------------------------------------------- esya katalogu
  /* sistem_dukkan.js ile ayni yol: once items.json (3005 kayit, `type` alani
     TUM kayitlarda var), sonra ctx.ITEMSTATS (2860) ustune bindirilir. */
  const itemsDosya = okuJson(dataDir, 'items.json');
  const KATALOG = new Map();
  for (const it of (itemsDosya?.items ?? [])) if (it?.id) KATALOG.set(it.id, it);
  const itemsJsonSayisi = KATALOG.size;
  if (ITEMSTATS && typeof ITEMSTATS.forEach === 'function') {
    ITEMSTATS.forEach((def, id) => {
      if (!def) return;
      const eski = KATALOG.get(id);
      KATALOG.set(id, eski ? { ...eski, ...def } : def);
    });
  }
  const esyaTanim = (id) => (id ? KATALOG.get(id) ?? null : null);
  const ekipmanMi = (def) => !!def && EKIPMAN_TIPI.has(def.type);

  // ------------------------------------------------------- mall / premium
  const MALL = itemsDosya?.itemMall ?? null;
  /** itemId -> jade (TAM Silk; 1 Silk = 100 cuzdan birimi) */
  const MALL_FIYAT = new Map();
  /**
   * itemId -> teslim adedi (sartname-2 madde 6: "1 al N gel" sunucu yarisi).
   * items.json .itemMall kalemine ISTEGE BAGLI `qty` alani (varsayilan 1);
   * istemci gomulu zst kopyasini okudugu icin alani hic gormez, UI'da "xN"
   * rozeti de yoktur (sys.mall.bought sablonunda adet yer tutucusu yok) -
   * oyuncu adedi ancak satin alim SONRASI cantada gorur.
   * BILEREK AYRI HARITA: MALL_FIYAT'in sayi tipi degistirilmez (_mallFiyat
   * API'si ve Number.isFinite kontrolu ona guveniyor). DURUST SINIR: bugunku
   * gomulu 36 kalemin HICBIRINDE qty yok (hicbiri iksir de degil) - katalog
   * degismedigi surece davranis birebir eskisi gibidir.
   * NOT: qty>1 YALNIZ stackMax>1 tuketilebilirlere verilmeli (stackMax=1
   * kaleme verilirse yigin bolunemez, cantada N ayri yuva ister).
   */
  const MALL_ADET = new Map();
  for (const tab of MALL?.tabs ?? []) {
    for (const s of tab?.items ?? []) {
      if (s?.itemId && Number.isFinite(Number(s.jade))) MALL_FIYAT.set(s.itemId, Number(s.jade));
      const q = tamsayi(s?.qty, 1);
      if (s?.itemId && q > 1) MALL_ADET.set(s.itemId, q);
    }
  }
  /** tier -> {tier,label,priceJade,durationDays,...} */
  const PREMIUM_KATALOG = new Map();
  for (const t of itemsDosya?.premium?.tiers ?? []) {
    if (t?.tier) PREMIUM_KATALOG.set(t.tier, t);
  }

  // ------------------------------------------------------------- carrier
  const CCFG = GCFG?.carrier ?? {};
  const C_TEMEL_YUVA = tamsayi(CCFG.baseSlots, 12);
  const C_EK_YUVA = tamsayi(CCFG.slotsPerExpansion, 4);
  /* MADDE 56 - TASIYICI YUVA TAVANI. Sayi uydurulmadi; istemcinin genisletme
     penceresinin BIREBIR ayni hesabi (paket @27394825):
       max2 = slotsPerExpansionOwner.baseSlots + 5 * ...slotsPerExpansion
       v_s2 = from2 >= max2        // dugme kilitleniyor
     game-config.json carrier: baseSlots 12, slotsPerExpansion 4 -> 32. */
  const C_MAX_YUVA = C_TEMEL_YUVA + 5 * C_EK_YUVA;
  const C_HIZ = Number(CCFG.flightSpeedU) > 0 ? Number(CCFG.flightSpeedU) : 40;
  const C_BEKLEME = tamsayi(CCFG.cooldownMs, 3_600_000);
  const C_KALIS = tamsayi(CCFG.landedLingerMs, 600_000);
  const C_ORB = CCFG.orbByZone ?? {};
  /* game-config.json carrier.interactRangeU = 25 (paket Zod semasi @8651900:
     `interactRangeU: Y().positive().default(25)`). Istemci bu alani HIC
     okumuyor (paket taramasi: `p9.` toplam 3 kullanim - iki baseSlots, bir
     flightSpeedU), yani tamamen SUNUCU tarafi bir kural: kus indigi yerde
     bekler ve toplama o yaricap icinden yapilir. */
  const C_MENZIL = Number(CCFG.interactRangeU) > 0 ? Number(CCFG.interactRangeU) : 25;

  /* orbByZone -> teleporters.json'daki GERCEK kure konumu. Istemci de tam
     olarak bunu yapiyor (@27357296: zonesById.get(zone).teleporters.find(id)). */
  const teleporters = okuJson(dataDir, 'teleporters.json');
  const KURE = new Map();  // zoneId -> {id,x,z}
  for (const [zid, orbId] of Object.entries(C_ORB)) {
    const tp = (teleporters?.zones?.[zid] ?? []).find((t) => t?.id === orbId);
    if (tp) KURE.set(zid, { id: orbId, x: Number(tp.x), z: Number(tp.z) });
  }

  /* Tasiyici siparisi NPC dukkanindan yapilir; NPC ile ayni bolgede olmak
     GEREKMEZ (sistemin butun anlami bu), ama esya o NPC'nin stogunda olmali. */
  const npcshops = okuJson(dataDir, 'npcshops.json');
  const DUKKAN_STOK = new Map();  // npcId -> Set<itemId>
  for (const [npcId, kayit] of Object.entries(npcshops?.shops ?? {})) {
    if (!kayit?.shop) continue;
    const stok = new Set();
    for (const s of kayit.shop.stock ?? []) if (typeof s === 'string') stok.add(s);
    for (const t of kayit.shop.tabs ?? []) for (const s of t?.items ?? []) {
      if (typeof s === 'string') stok.add(s);
    }
    DUKKAN_STOK.set(npcId, stok);
  }

  // -------------------------------------------------------------- uniques
  const uniquesDosya = okuJson(dataDir, 'uniques.json');
  const UNIQUE_TANIM = (uniquesDosya?.uniques ?? []).filter((u) => u?.monsterId && u?.zoneId);

  // ------------------------------------------------------------- durumlar
  /* PREMIUM / CARRIER / BEKLEYEN_ALTIN artik DOSYA KAPSAMINDA (madde 1,
     dosya basindaki nota bak) — yeniden kurulumda deviralinirlar. Burada
     yalniz kur() sonunda DB'den kendini tazeleyen / kisa omurlu defterler
     kaldi. */
  /** auctionId -> mezat kaydi */
  const MEZAT = new Map();
  /** auction.op sub yapan ws kumesi */
  const MEZAT_ABONE = new Set();
  /** monsterId -> zamanlayici durumu */
  const UNIQUE = new Map();
  /** offerId -> dirilis teklifi */
  const DIRILIS = new Map();
  /** charId -> claim bekleyen mezat kayitlari zaten MEZAT icinde tutulur */

  let dirilisSayaci = 1;
  let sonUniqueYayin = 0;

  // ======================================================== DB yardimcilari
  const sqlVar = () => !!web;

  async function sorgu(metin, girdiler = {}) {
    if (!web) return null;
    const istek = web.request();
    for (const [k, v] of Object.entries(girdiler)) istek.input(k, v);
    return await istek.query(metin);
  }
  async function yordam(ad, girdiler = {}) {
    if (!web) return null;
    const istek = web.request();
    for (const [k, v] of Object.entries(girdiler)) istek.input(k, v);
    return await istek.execute(ad);
  }
  const dbHata = (nerede) => (e) =>
    log(`kucuk-sistemler: ${nerede} DB hatasi:`, String(e?.message ?? e).slice(0, 140));

  // ==================================================== oyuncu dizini (online)
  function* tumOyuncular() {
    const durum = world?.zoneState;
    if (!durum || typeof durum.values !== 'function') return;
    for (const z of durum.values()) {
      for (const ws of z.players ?? []) {
        if (ws?.isAuthed && ws.char) yield ws;
      }
    }
  }
  function oyuncuAdla(ad) {
    if (typeof ad !== 'string' || !ad) return null;
    const kucuk = ad.toLowerCase();
    for (const ws of tumOyuncular()) {
      if (String(ws.char.name ?? '').toLowerCase() === kucuk) return ws;
    }
    return null;
  }
  function oyuncuCharId(charId) {
    const anahtar = String(charId);
    for (const ws of tumOyuncular()) if (String(ws.char.id) === anahtar) return ws;
    return null;
  }
  function hesapSoketleri(JID) {
    const out = [];
    for (const ws of tumOyuncular()) if (ws.user?.JID === JID) out.push(ws);
    return out;
  }

  // ======================================================== cerceve gonderimi
  const hata = (ws, code, key) => {
    frame(ws, 'err', key ? { code, key } : { code });
    return true;
  };
  const bildir = (ws, key, params) =>
    frame(ws, 'sys.notice', params ? { key, params } : { key });
  const envanteriYolla = (ws) => {
    if (envanterPayload) frame(ws, 'inv.update', envanterPayload(ws.char));
  };
  /** Tum bolgelerdeki tum oyunculara ayni kareyi yollar. */
  function herkese(t, d) {
    for (const ws of tumOyuncular()) frame(ws, t, d);
  }

  // ============================================================ envanter
  const CANTA_YUVASI = tamsayi(GCFG.bagSlots, 32);
  /* SARTNAME-1 MADDE 11 — canta yuva TAVANI. Sayi uydurulmadi:
     sistem_banka-depo.js ayni sabiti kullanir (CANTA_MAX_YUVA = 384;
     SARTNAME-3 MADDE 10: 12 sayfa x 32, eski 160'tan kullanici karariyla
     buyutuldu; canli dogrulama sunucuda YUVA_MAX=383 ve eslenikleri).
     bagExpand kullanim yolunun tavan kontrolu banka-depo'da; buradaki
     kopya YALNIZ mallAl satin alma kapisi icindir. */
  const CANTA_MAX_YUVA = 384;

  function canta(ch) {
    const n = Array.isArray(ch.bag) && ch.bag.length > 0 ? ch.bag.length : CANTA_YUVASI;
    if (!Array.isArray(ch.bag) || ch.bag.length !== n) {
      const eski = Array.isArray(ch.bag) ? ch.bag : [];
      ch.bag = new Array(n).fill(null);
      for (let i = 0; i < Math.min(eski.length, n); i++) ch.bag[i] = eski[i] ?? null;
    }
    return ch.bag;
  }
  const yiginSiniri = (def) => Math.max(1, tamsayi(def?.stackMax, 1));

  /**
   * Yeni esya kaydi (S$ semasi).
   * MADDE 26: govde esya.js'e TASINDI - dukkan, baslangic ekipmani, ganimet ve
   * kalicilik artik AYNI uretici uzerinden geciyor (kural + kanitlar orada).
   */
  const yeniEsya = (def, adet) => yeniYigin(def, adet);

  /** Sigiyorsa yerlestirme plani, sigmiyorsa null (yarim yerlestirme YOK). */
  function yerlestirmePlani(bag, def, adet) {
    const yigin = yiginSiniri(def);
    const plan = [];
    let kalan = adet;
    if (yigin > 1) {
      for (let i = 0; i < bag.length && kalan > 0; i++) {
        const s = bag[i];
        if (!s || s.itemId !== def.id) continue;
        const yer = yigin - (s.qty ?? 1);
        if (yer <= 0) continue;
        const k = Math.min(yer, kalan);
        plan.push({ i, ekle: k }); kalan -= k;
      }
    }
    for (let i = 0; i < bag.length && kalan > 0; i++) {
      if (bag[i]) continue;
      const k = Math.min(yigin, kalan);
      plan.push({ i, yeni: k }); kalan -= k;
    }
    return kalan > 0 ? null : plan;
  }
  function planiUygula(bag, def, plan) {
    for (const p of plan) {
      if (p.ekle) bag[p.i].qty = (bag[p.i].qty ?? 1) + p.ekle;
      else bag[p.i] = yeniEsya(def, p.yeni);
    }
  }

  /**
   * HAZIR bir esya kaydini (mezattan donen ORIJINAL yigin - plus/dur/blues
   * korunur) cantaya koyar. Once plan cikarilir: yarim yerlestirme olmaz.
   */
  function kaydiYerlestir(ch, kayit) {
    const bag = canta(ch);
    const def = esyaTanim(kayit.itemId);
    const yigin = yiginSiniri(def);
    const plan = [];
    let kalan = Math.max(1, tamsayi(kayit.qty, 1));
    if (yigin > 1) {
      for (let i = 0; i < bag.length && kalan > 0; i++) {
        const s = bag[i];
        if (!s || s.itemId !== kayit.itemId) continue;
        const yer = yigin - (s.qty ?? 1);
        if (yer <= 0) continue;
        const k = Math.min(yer, kalan);
        plan.push({ i, ekle: k }); kalan -= k;
      }
    }
    for (let i = 0; i < bag.length && kalan > 0; i++) {
      if (bag[i]) continue;
      const k = Math.min(yigin, kalan);
      plan.push({ i, yeni: k }); kalan -= k;
    }
    if (kalan > 0) return false;
    for (const p of plan) {
      if (p.ekle) bag[p.i].qty = (bag[p.i].qty ?? 1) + p.ekle;
      else bag[p.i] = { ...kayit, qty: p.yeni };
    }
    return true;
  }

  // ------------------------------------------------------------- altin
  function altiniKaydet(ch) {
    if (!web || !SHARD) return;
    const charId = Number(ch?.id);
    if (!Number.isFinite(charId)) return;
    sorgu(`UPDATE ${SHARD}.dbo._Char SET RemainGold = @g WHERE CharID = @c`,
      { c: charId, g: Math.max(0, Math.round(Number(ch.gold ?? 0))) })
      .catch(dbHata('altin'));
  }

  /**
   * Altini olan/olmayan oyuncuya altin yatirir.
   * Cevrimici ise bellekte + DB'de; cevrimdisi ise dogrudan _Char'a, DB yoksa
   * BEKLEYEN_ALTIN kuyruguna (oyuncudan gelen ILK mesajda bosaltilir).
   */
  function altinYatir(charId, miktar, sebep) {
    const m = Math.max(0, Math.round(miktar));
    if (m <= 0) return;
    const ws = oyuncuCharId(charId);
    if (ws) {
      ws.char.gold = Math.max(0, tamsayi(ws.char.gold, 0)) + m;
      altiniKaydet(ws.char);
      envanteriYolla(ws);
      return;
    }
    if (web && SHARD && Number.isFinite(Number(charId))) {
      sorgu(`UPDATE ${SHARD}.dbo._Char SET RemainGold = RemainGold + @g WHERE CharID = @c`,
        { c: Number(charId), g: m }).catch(dbHata(`altin iade (${sebep})`));
      return;
    }
    BEKLEYEN_ALTIN.set(String(charId), (BEKLEYEN_ALTIN.get(String(charId)) ?? 0) + m);
    log(`kucuk-sistemler: ${charId} icin ${m} altin beklemede (${sebep})`);
  }

  /**
   * charId -> hesap JID. Cevrimici oyuncuda soketten (DB gerekmez), cevrimdisi
   * oyuncuda vSRO'nun kendi eslesme tablosundan: _User(UserJID, CharID).
   * (Ayni tablo jidCoz() icinde de kullaniliyor; orada `ch` var, burada yok.)
   */
  async function jidCozId(charId) {
    const ws = oyuncuCharId(charId);
    const canli = Number(ws?.user?.JID);
    if (Number.isFinite(canli) && canli > 0) return canli;
    const c = Number(charId);
    if (!web || !SHARD || !Number.isFinite(c)) return null;
    try {
      const r = await sorgu(`SELECT TOP 1 UserJID FROM ${SHARD}.dbo._User WHERE CharID = @c`, { c });
      const jid = Number(r?.recordset?.[0]?.UserJID);
      return Number.isFinite(jid) && jid > 0 ? jid : null;
    } catch (e) {
      log('kucuk-sistemler: JID cozulemedi (mezat):', String(e?.message ?? e).slice(0, 120));
      return null;
    }
  }

  /**
   * MADDE 44 - MEZAT PARASI HESAP BANKASINA.
   *
   * referans oyunun kendi metinleri bunu acikca soyluyor (client/.../tr.json):
   *   ui.auction.status_sold  "{gold} karsiliginda satildi - bankana odendi"
   *   ui.auction.toast_sold   "{item} esyan {gold} altina satildi - bankana odendi."
   *   ui.auction.toast_outbid "{item} icin teklifin gecildi - {gold} altin bankana iade edildi."
   *   ui.bank.bank_gold_tip   "Hesap bankasi altini - Silk Borsasi ile ortak"
   * TEKLIF ise karakter altinindan cikar (err.auction.gold "Karakterinde
   * yeterli altin yok.") - iki yon bilerek simetrik degil, oyle birakiliyor.
   *
   * Eskiden hem gelir hem iade `altinYatir()` ile KARAKTER cuzdanina
   * gidiyordu ve satici parayi ayrica 'claim' etmek zorundaydi; istemci ona
   * zaten "bankana odendi" demis oluyordu.
   *
   * SON CARE: JID cozulemez ya da banka modulu yuklu degilse para KAYBOLMASIN
   * diye eski yol (karakter altini / BEKLEYEN_ALTIN kuyrugu) kullanilir ve
   * durum loglanir. Bu bir gerileme yolu, normal yol degil.
   */
  async function bankayaYatir(charId, miktar, sebep) {
    const m = Math.max(0, Math.round(miktar));
    if (m <= 0) return;
    const kopru = sistemOrnegi?.('banka-depo')?.bankayaAltinEkle;
    const JID = typeof kopru === 'function' ? await jidCozId(charId) : null;
    if (JID !== null) {
      const ok = await kopru(JID, m, hesapSoketleri(JID)).catch((e) => {
        log('kucuk-sistemler: banka yatirma hatasi:', String(e?.message ?? e).slice(0, 120));
        return false;
      });
      if (ok) return;
    }
    log(`kucuk-sistemler: ${m} altin bankaya yazilamadi (${sebep}) - karakter cuzdanina dusuluyor`);
    altinYatir(charId, m, sebep);
  }

  /** bankayaYatir()'in senkron cagri yerlerinden kullanilan sarmalayicisi. */
  const bankayaYatirAsenkron = (charId, miktar, sebep) => {
    bankayaYatir(charId, miktar, sebep)
      .catch((e) => log('kucuk-sistemler: banka yatirma cokmesi:', String(e?.message ?? e).slice(0, 120)));
  };

  function bekleyenAltiniBosalt(ws) {
    const anahtar = String(ws.char?.id);
    const m = BEKLEYEN_ALTIN.get(anahtar);
    if (!m) return;
    BEKLEYEN_ALTIN.delete(anahtar);
    ws.char.gold = Math.max(0, tamsayi(ws.char.gold, 0)) + m;
    altiniKaydet(ws.char);
    envanteriYolla(ws);
  }

  // ============================================================ cuzdan (Silk)
  const JADE_BIRIM = 100;   // items.json itemMall.$comment: 1 Silk = 100 birim

  async function cuzdanOku(JID) {
    const r = await yordam('WebGetWallet', { JID });
    const s = r?.recordset?.[0];
    if (!s) return null;
    return {
      jadeUnits: Number(s.jadeUnits ?? 0),
      jadeLockedUnits: Number(s.jadeLockedUnits ?? 0),
      depositAddress: s.depositAddress ?? '',
    };
  }
  /** Kilitli olmayan bakiyeden ATOMIK dusme. Yetmezse false. */
  async function cuzdanDus(JID, birim) {
    await yordam('WebGetWallet', { JID }).catch(() => null);   // satiri garanti et
    const r = await sorgu(
      `UPDATE dbo.WebWallet SET jadeUnits = jadeUnits - @u, updatedAt = GETDATE()
        WHERE JID = @j AND (jadeUnits - jadeLockedUnits) >= @u`,
      { j: JID, u: birim });
    return (r?.rowsAffected?.[0] ?? 0) > 0;
  }
  async function cuzdanIade(JID, birim) {
    await sorgu(
      `UPDATE dbo.WebWallet SET jadeUnits = jadeUnits + @u, updatedAt = GETDATE()
        WHERE JID = @j`, { j: JID, u: birim }).catch(dbHata('Silk iade'));
  }

  // ============================================================ premium
  function premiumDurum(ws) {
    const p = PREMIUM.get(ws?.user?.JID);
    if (!p?.tier || !p.expiresAt || p.expiresAt <= simdi()) return null;
    return p;
  }
  /**
   * D5-A: premium kademesini KARAKTERE de yansit (ch.premiumTier /
   * ch.premiumExpiresAt). Alan adlari zone.init.self semasiyla birebir
   * (@25598134 premiumTier, @25598166 premiumExpiresAt) — D5-C ajani XP/SP
   * bonusunu ch.premiumTier uzerinden okuyacak, selfAlanlari/varlikAlanlari
   * da ayni alanlardan besleniyor.
   *
   * BILGI KAYIPSA (PREMIUM defterinde JID yoksa) SON BILINEN DEGER KALIR —
   * madde 3'un "bilgi kayip != sure doldu" ilkesinin karakter tarafi.
   * ch.__ksJid burada da doldurulur ki selfAlanlari, jidCoz'un DB donusunu
   * beklemeden defteri bulabilsin (canli soket JID'i zaten tek gercek kaynak).
   */
  function premiumKaraktereYansit(ch, jid) {
    if (!ch) return;
    const j = Number.isFinite(jid) ? jid : ch.__ksJid;
    if (!Number.isFinite(j) || !PREMIUM.has(j)) return;   // bilgi kayip -> dokunma
    if (!Number.isFinite(ch.__ksJid)) ch.__ksJid = j;
    const p = PREMIUM.get(j);
    const gecerli = p?.tier && p.expiresAt > simdi();
    ch.premiumTier = gecerli ? p.tier : null;
    ch.premiumExpiresAt = gecerli ? p.expiresAt : null;
  }
  function premiumYolla(ws) {
    /* Her kare gonderiminde karakter aynasi tazelenir (yukleme, satin alma,
       sure bitisi — hepsi bu yoldan geciyor). */
    premiumKaraktereYansit(ws?.char, ws?.user?.JID);
    const p = PREMIUM.get(ws?.user?.JID) ?? { tier: null, expiresAt: null };
    const gecerli = p.tier && p.expiresAt > simdi();
    const tier = gecerli ? p.tier : null;
    /* premium.update (189): iki alan da `nullable` - yani ANAHTAR ZORUNLU,
       degeri null olabilir. Eksik anahtar istemcinin Zod dogrulamasindan
       gecmez ve kare sessizce atilir. */
    frame(ws, 'premium.update', { tier, expiresAt: gecerli ? p.expiresAt : null });
    if (ws.zoneId == null) return;
    /* entity.premium (190) bir DEGISIM bildirimidir - canli yakalamada girise
       hic gelmiyor, cunku rozet varlik semasinin `premiumTier` alaninda
       tasiniyor ($mt @25590811). Ayni degeri tekrar yayinlamak bos trafik:
       yalnizca deger DEGISTIGINDE gonderiyoruz. Rozetsiz oyuncunun girisinde
       hic gonderilmez; rozet bitince {tier:null} gider ve istemci rozeti
       temizler (applyPremium: premiumTier = tier ?? undefined). */
    if (ws.__ks_tier === tier) return;
    const ilkKez = ws.__ks_tier === undefined;
    ws.__ks_tier = tier;
    if (ilkKez && tier === null) return;
    const kare = { id: ws.entityId, tier };
    frame(ws, 'entity.premium', kare);
    broadcast(ws.zoneId, 'entity.premium', kare, ws);
  }
  /**
   * Bolgeye YENI giren oyuncuya, ayni bolgedeki PREMIUM akranlarin rozetini
   * yollar.
   *
   * [SARTNAME-1 MADDE 12 — YORUM GUNCELLENDI, davranis AYNI] Eski aciklama
   * "cekirdek sunucunun entityPayload'i premiumTier'i doldurmuyor" diyordu -
   * ESKIMISTI: server.js entityPayload artik modul katkisi `varlikAlanlari`
   * ile premiumTier'i ($mt.premiumTier, @25590811) ZATEN tasiyor. Yani
   * buradaki 190 (entity.premium) yaylimi kismen fazladan; ama IDEMPOTENT
   * bir guvenlik agidir (olcum: giriste ayni rozet karesi 3 kez, gorunur
   * etki yok - applyPremium ayni degeri tekrar yazar). SILME, zorunlu da
   * sanma: entity.premium istemcide yalnizca zaten bilinen varliga uygulanir
   * (applyPremium @25665697 `entities.get(id)` bulamazsa kareyi atar), bu ag
   * zone.ready sonrasi sira/yaris bosluklarini kapatir.
   *
   * Rozetsiz akran icin kare YOLLANMAZ: tier null ise istemcide zaten
   * `premiumTier = undefined` - gonderilmesi bos trafik olur.
   */
  function premiumAkranlariYolla(ws) {
    if (ws?.zoneId == null) return;
    // 1) iceridekilerin rozeti -> yeni gelene
    for (const akran of tumOyuncular()) {
      if (akran === ws || akran.zoneId !== ws.zoneId) continue;
      const tier = premiumDurum(akran)?.tier ?? null;
      if (!tier) continue;
      frame(ws, 'entity.premium', { id: akran.entityId, tier });
    }
    // 2) yeni gelenin rozeti -> iceridekilere.
    //    premiumYolla'daki tekrar filtresi bolge DEGISIMINDE susar (kademe
    //    degismedi), oysa yeni bolgedekiler bu oyuncuyu ilk kez goruyor.
    const benim = premiumDurum(ws)?.tier ?? null;
    if (benim) broadcast(ws.zoneId, 'entity.premium', { id: ws.entityId, tier: benim }, ws);
  }

  /**
   * [DENETIM DUZELTMESI] Premium suresi OYUNCU CEVRIMICIYKEN dolarsa.
   *
   * premiumYolla() yalnizca uc yerden cagriliyordu: oturumHazirla (oturum
   * basina BIR kez) ve premium.buy sonrasi. Sure gecerken hicbir sey
   * calismiyordu; sonuc:
   *   - kendi arayuzu: F$.setSelf({premiumTier}) son degerde KILITLI kalir
   *     (@27127280 bu alani SADECE premium.update tazeliyor), tasiyici
   *     penceresi acik gorunur ama sunucu (premiumDurum) siparisi reddeder
   *     -> kullaniciya sebepsiz err.premium.required;
   *   - akranlar: entity.premium bir DEGISIM bildirimi oldugu icin rozet
   *     karsi taraflarda cikis/bolge degisimine kadar duruyordu.
   * Modulun zaten donen 1 sn'lik zamanlayicisinda tek gecis yapiyoruz.
   * premiumYolla icindeki `__ks_tier` filtresi kareyi TAM BIR KEZ yollar
   * (cagri sonrasi damga null olur), yani tik spam uretmez.
   *
   * MADDE 3: "bilgi kayip" ile "sure doldu" AYRILDI. Eski hal bellekte kayit
   * YOKLUGUNU sure bitisi sayip null yolluyordu — sikayet 5 zincirinin
   * gorunen yuzu buydu. Artik yalniz defterde kayit VARKEN ve gercekten
   * gecersizken 189 {null,null} gider; kayit kayipsa SUSUP DB'den tazeleriz.
   */
  function premiumSureTik() {
    for (const ws of tumOyuncular()) {
      if (!ws.__ks_tier) continue;            // rozetsiz ya da hic kare gitmemis
      const jid = ws.user?.JID;
      if (PREMIUM.has(jid)) {                 // bilgi VAR -> gercek sure kontrolu
        if (premiumDurum(ws)) continue;       // kademe hala gecerli
        premiumYolla(ws);                     // gercekten bitti -> 189 {null,null}
        continue;
      }
      /* Bilgi KAYIP (defter bosalmis / DB gec yanit verdi): SUSTUR, null
         YOLLAMA. UCUS-ICI KILIDI SART: oturumHazirla `__ks_hazir = true`i
         SENKRON yapar ama DB okumasi ASENKRONdur; kilit olmazsa DB
         kesintisinde premium'lu her oyuncu icin SANIYEDE BIR SELECT firlar. */
      if (simdi() - (ws.__ks_tazeleme ?? 0) < 30_000) continue;
      ws.__ks_tazeleme = simdi();
      ws.__ks_hazir = false;
      oturumHazirla(ws);
    }
  }

  /* =========================================================================
   * YAN BULGU 1 (bulgular_hizli 2026-09-03) — regenBoostPct/regenBoostMpPct
   * OYUNCU REGENINE BAGLANDI.
   *
   * SORUN (olculdu): sistem_beceri.js MOD_KESIR listesi 'regenBoostPct' /
   * 'regenBoostMpPct' tasiyor (kesir: 0.2 = %20; birim kaynagi paket T2()
   * cizicisi, sistem_beceri.js:200-227) ve data/skills.json'da cok sayida
   * beceri bu modu veriyor (or. 101968: 0.2..0.6); ama gameloop.js #yenilenme
   * `combat.turetilmis(ws.char)` kullaniyor ve hicbir regenBoost carpani
   * uygulamiyordu - buff/pasif regen bonusu OLU VERIYDI.
   *
   * COZUM (dosya sahipligi geregi gameloop.js'e DOKUNMADAN): taban regeni
   * gameloop #yenilenme uygulamaya devam eder (saniyede ceil(maxHp*0.005) /
   * ceil(maxMp*0.01), combat.json regen blogu); bu tik yalniz BONUS farkini
   * ekler:  ek = ceil(M*oran*(1+boost)) - ceil(M*oran).  Iki terim ayni M
   * (modlu maxHp/maxMp) uzerinden hesaplanir ki fark tutarli olsun; toplam,
   * "regen carpi (1+boost)" davranisina esdeger.
   *
   * KAPILAR gameloop.js:1806-1812 ile BIREBIR: olu oyuncu atlanir, savas
   * kapisi `ws.savas || simdi - ws.sonHasar < regen.outOfCombatMs`, 1 sn
   * ritmi (kendi damgamiz ws.__ks_sonRegenBoost - gameloop'un ws.sonRegen'ine
   * DOKUNULMAZ).
   *
   * UYDURULMAYANLAR: yalniz POZITIF boost uygulanir (skills.json'daki tum
   * degerler pozitif; negatif "regen kesintisi" hicbir kaynakta yok).
   * Premium kataloguna regen bonusu EKLENMEDI - items.json premium.tiers
   * yalniz xpSpBonusPct tasiyor, regen alani yok.
   * ========================================================================= */
  function regenBoostTik() {
    const BEC = sistemOrnegi?.('beceri');
    if (!BEC?.statModlari) return;               // mod kaynagi yok (modul kurulu degil)
    const r = combat?.regen;
    if (!r) return;                              // regen konfigu yok (test ctx'i vb.)
    const t = simdi();
    for (const ws of tumOyuncular()) {
      if (ws.char.dead) continue;
      const savasta = ws.savas || (t - (ws.sonHasar ?? 0) < r.outOfCombatMs);
      if (savasta) continue;
      let oran;
      try { oran = BEC.statModlari(ws)?.oran; } catch { continue; }
      const bHp = Number(oran?.regenBoostPct) || 0;
      const bMp = Number(oran?.regenBoostMpPct) || 0;
      if (bHp <= 0 && bMp <= 0) continue;
      if (t - (ws.__ks_sonRegenBoost ?? 0) < 1000) continue;
      ws.__ks_sonRegenBoost = t;
      /* Modlu tavan (maxHpPct buff'lari dahil); modul kancasi yoksa ctx.derived. */
      const d = BEC.turetilmisMod?.(ws.char) ?? derived?.(ws.char);
      if (!d) continue;
      const ekHp = bHp > 0
        ? Math.ceil(d.maxHp * r.hpPctPerSec * (1 + bHp)) - Math.ceil(d.maxHp * r.hpPctPerSec)
        : 0;
      const ekMp = bMp > 0
        ? Math.ceil(d.maxMp * r.mpPctPerSec * (1 + bMp)) - Math.ceil(d.maxMp * r.mpPctPerSec)
        : 0;
      if (ekHp <= 0 && ekMp <= 0) continue;
      const hp0 = ws.char.hp ?? 0, mp0 = ws.char.mp ?? 0;
      /* Asla dusurme: gameloop tabani modsuz maxHp'ye kirpar; bizim kirpma
         modlu tavana gore - max() olmadan tavan farki HP dusurebilirdi. */
      const yeniHp = Math.max(hp0, Math.min(d.maxHp, hp0 + ekHp));
      const yeniMp = Math.max(mp0, Math.min(d.maxMp, mp0 + ekMp));
      if (yeniHp === hp0 && yeniMp === mp0) continue;
      ws.char.hp = yeniHp; ws.char.mp = yeniMp;
      /* gameloop #yenilenme ile ayni kare bicimi (vitals.update 150). */
      frame(ws, 'vitals.update', { hp: yeniHp, mp: yeniMp });
    }
  }

  /* ================================ PREMIUM'U zone.init.self ICINE BAGLAMA
   * SORUN (olculdu): server.js selfPayload'da `premiumTier: null,
   * premiumExpiresAt: null` SABIT (server.js:615) ve premium bilgisi ancak
   * `oturumHazirla` -> premium.update (189) ile, yani zone.init'ten SONRA
   * gidiyordu. Premium'u OLAN oyuncu icin zone.init YANLIS deger tasiyor;
   * istemci self'i once null'la kurup sonra duzeltiyor - ve premium'a bagli
   * pencereler (taction/tasiyici, @27355135) o an kilitli goruniyor.
   *
   * COZUM: server.js `modulKatkisi(['selfAlanlari','kendiParcasi'], ch)`
   * cagriyor (server.js:620) ve modullerin donduklerini TABANIN USTUNE
   * yaziyor - yani kendi alanlarimizi vermek yeterli, cekirdek degismiyor.
   *
   * JID SORUNU: PREMIUM defteri HESAP (JID) bazli, ama modulleriYukle(ch)
   * kancasi yalnizca `ch` veriyor ve ch uzerinde JID/accountId YOK
   * (routes_auth.listCharacters ciktisi: id/name/level/style/... ).
   * KANIT ile cozuluyor: vSRO'nun kendi eslesme tablosu
   *   SRO_VT_SHARD.dbo._User (UserJID int, CharID int)
   * canli DB'de dogrulandi (4 satir: 1->1, 2->2, 3->3, 4->4). Cozulen JID
   * `ch.__ksJid` uzerinde onbellege alinir (modul-ozel, alt tireli ad).
   */
  async function jidCoz(ch) {
    if (ch == null) return null;
    if (Number.isFinite(ch.__ksJid)) return ch.__ksJid;
    const charId = Number(ch?.id);
    if (!web || !SHARD || !Number.isFinite(charId)) return null;
    try {
      const r = await sorgu(
        `SELECT TOP 1 UserJID FROM ${SHARD}.dbo._User WHERE CharID = @c`, { c: charId });
      const jid = Number(r?.recordset?.[0]?.UserJID);
      if (!Number.isFinite(jid)) return null;
      ch.__ksJid = jid;
      return jid;
    } catch (e) {
      log('kucuk-sistemler: JID cozulemedi:', String(e?.message ?? e).slice(0, 120));
      return null;
    }
  }

  /**
   * selfPayload'a yayilir. Alan adlari _ht (zone.init.self, paket @25598134
   * / @25598166) ile birebir:  premiumTier: _$.nullable(), premiumExpiresAt:
   * Y().nullable() - IKISI DE ZORUNLU ANAHTAR, degeri null olabilir.
   */
  function selfAlanlari(ch) {
    /* D5-A: once defterden karaktere yansit, sonra KARAKTERDEN oku. Defter
       modul kapsaminda oldugu icin yeniden kurulumda dolu kalir (madde 1);
       bilgi yine de kayipsa (DB gec yanit) son bilinen ch degeri doner —
       her zone.init'te premium'un "yok" gorunmesi boyle onlenir. */
    premiumKaraktereYansit(ch);
    const gecerli = ch?.premiumTier && (ch.premiumExpiresAt ?? 0) > simdi();
    return {
      premiumTier: gecerli ? ch.premiumTier : null,
      premiumExpiresAt: gecerli ? ch.premiumExpiresAt : null,
    };
  }

  /** entityPayload'a yayilir - $mt varlik semasindaki `premiumTier` rozeti. */
  function varlikAlanlari(ch) {
    premiumKaraktereYansit(ch);
    const gecerli = ch?.premiumTier && (ch.premiumExpiresAt ?? 0) > simdi();
    return gecerli ? { premiumTier: ch.premiumTier } : {};
  }

  /**
   * server.js modulleriYukle(ch) kancasi (server.js:1590) - zone.init'ten ONCE
   * await ediliyor. Premium'u ve tasiyiciyi burada yukluyoruz ki zone.init
   * DOGRU degerle gitsin. oturumHazirla() yine calisir (premium.update karesi
   * ve akran rozetleri icin) ama artik ayni degeri tekrarlar.
   */
  async function yukle(ch) {
    const jid = await jidCoz(ch);
    /* HER giriste taze okuyoruz (onbellege guvenmiyoruz): premium GM tarafindan
       ya da web panelinden oyuncu cevrimdisiyken verilmis olabilir. */
    if (jid !== null) {
      try {
        const r = await sorgu('SELECT tier, expiresAt FROM dbo.WebPremium WHERE JID = @j', { j: jid });
        const s = r?.recordset?.[0];
        const exp = zamanaCevir(s?.expiresAt);
        PREMIUM.set(jid, (s?.tier && exp && exp > simdi())
          ? { tier: s.tier, expiresAt: exp }
          : { tier: null, expiresAt: null });
        /* D5-A madde 4: yuklemede karaktere de yansit — D5-C, XP/SP bonusunu
           ch.premiumTier uzerinden okuyacak. */
        premiumKaraktereYansit(ch, jid);
      } catch (e) {
        log('kucuk-sistemler: premium okunamadi:', String(e?.message ?? e).slice(0, 120));
      }
    }
    /* Tasiyici (carrier.state.readyAt = 1 SAATLIK bekleme + kutudaki mallar).
       Burada yuklenirse giris batch'indeki carrier.state karesi ilk seferde
       dogru gider; oturumHazirla'daki ikinci yukleme zararsiz tekrardir. */
    try { await carrierYukle(ch); } catch (e) { dbHata('carrier yukleme')(e); }
    return selfAlanlari(ch);
  }

  /** Oyuncunun ilk mesajinda bir kez calisir: premium ve tasiyici durumunu yukler. */
  function oturumHazirla(ws) {
    /* Bekleyen altin ILK mesajla sinirli DEGIL: oyuncu cevrimiciyken de
       (or. baska bir mezatta gecilip iade alirken) kuyruga giris olabilir. */
    if (BEKLEYEN_ALTIN.size) bekleyenAltiniBosalt(ws);
    /* __ks_* bayraklari SOKETTE, defterler MODUL KAPSAMINDA (madde 1) yasar:
       yeniden kurulumda IKISI DE hayatta kalir, yani `__ks_hazir === true`
       iken defterin dolu olmasi artik GARANTI — eski "bayrak dolu / defter
       bos" tutarsizligi (sikayet 5) olusamaz. Defter baska bir yoldan
       bosalirsa premiumSureTik bu bayragi false'a cekip buradan DB'yi
       yeniden okutur (madde 3). */
    if (ws.__ks_hazir) return;
    ws.__ks_hazir = true;
    if (!web) {
      /* DB YOKKEN DE premium.update (189) gonderilmeli. Cekirdek sunucunun
         zone.init.self karesinde premiumTier/premiumExpiresAt SABIT null
         yaziliyor (server.js selfPayload); istemci bu iki alani yalnizca
         premium.update ile tazeliyor (@27127280 F$.setSelf({premiumTier,
         premiumExpiresAt})). Kare hic gitmezse bellekte tutulan kademe
         arayuze asla yansimaz ve tasiyici penceresi premium kilidinde kalir
         (@27355135). Onceki hal burada erken donuyordu -> iki kare de
         (189/190) HIC gonderilmiyordu.
         PREMIUM kaydini EZMIYORUZ: ayni surecte premium.buy ile alinmis
         kademe yeniden baglanmada kaybolmasin. */
      if (!PREMIUM.has(ws.user?.JID)) PREMIUM.set(ws.user?.JID, { tier: null, expiresAt: null });
      premiumYolla(ws);
      return;
    }
    (async () => {
      const r = await sorgu('SELECT tier, expiresAt FROM dbo.WebPremium WHERE JID = @j',
        { j: ws.user?.JID });
      const s = r?.recordset?.[0];
      const exp = zamanaCevir(s?.expiresAt);
      PREMIUM.set(ws.user?.JID,
        (s?.tier && exp && exp > simdi()) ? { tier: s.tier, expiresAt: exp }
                                          : { tier: null, expiresAt: null });
      premiumYolla(ws);
      await carrierYukle(ws.char);
      frame(ws, 'carrier.state', carrierPayload(ws.char));
    })().catch(dbHata('oturum hazirlama'));
  }

  // ==========================================================================
  // 1) chat.whisper (68)
  // ==========================================================================
  /**
   * Istemci: PM penceresi `W$.send('chat.whisper', {to: peer, text})` (@27541459).
   * Cevap `chat.pm` (162): gonderene kind='out', alicidaki kind='in'.
   * Hata durumlari kind='system' + Tht anahtari ile bildirilir; istemci
   * (@27126341) system+key gordugunde metni ANAHTARDAN uretir.
   */
  function fisilda(ws, d) {
    const to = String(d?.to ?? '').trim();
    const text = String(d?.text ?? '');
    if (!to || to.length > 16) return hata(ws, HATA.DOGRULAMA);
    if (!text) return hata(ws, HATA.DOGRULAMA);
    const metin = text.slice(0, tamsayi(GCFG.chatMaxLen, 200));

    if (to.toLowerCase() === String(ws.char.name ?? '').toLowerCase()) {
      frame(ws, 'chat.pm', {
        peer: to, kind: 'system', text: metin, key: 'sys.whisper.self',
      });
      return true;
    }
    const hedef = oyuncuAdla(to);
    if (!hedef) {
      frame(ws, 'chat.pm', {
        peer: to, kind: 'system', text: metin,
        key: 'sys.whisper.offline', params: { name: to },
      });
      return true;
    }
    // alici: karsi tarafin adiyla, gelen yon
    frame(hedef, 'chat.pm', { peer: ws.char.name, kind: 'in', text: metin });
    // gonderen: kendi penceresinde giden yon (istemci yankiyi KENDI yazmaz)
    frame(ws, 'chat.pm', { peer: hedef.char.name, kind: 'out', text: metin });
    return true;
  }

  // ==========================================================================
  // 2) revive.respond (85) — ARTIK DAGITIMDA DEGIL (sartname-2 madde 5)
  // ==========================================================================
  /**
   * Teklif URETIMI bu modulde DEGIL: dirilis becerisini isleyen sistem
   * `dirilisTeklifi()` API'sini cagirir. Burada sadece CEVAP islenir.
   * Istemci (@27124873) reddederken teklifi kendi icinde siler -> "reddet"
   * cevabina kare gondermiyoruz; sadece kabul/hata karesi gider.
   *
   * SARTNAME-2 MADDE 5: mesaj switch'indeki `case 'revive.respond'` kaldirildi
   * - revive.respond artik sistem_dirilis-unique / sistem_yerinde-dirilis
   * tarafindan islenir (dagitim notu switch'in icinde). Bu fonksiyon ve
   * DIRILIS haritasi API'si (dirilisTeklifi) BILEREK duruyor: kur() donusunde
   * disa acik, silmek sozlesme kirar; DIRILIS'i uretimde kimse doldurmadigi
   * icin zararsiz olu yol (yalniz test dosyalari cagirir).
   */
  function dirilisCevabi(ws, d) {
    const offerId = tamsayi(d?.offerId, -1);
    const kabul = d?.accept === true;
    const teklif = DIRILIS.get(offerId);
    if (!teklif || String(teklif.charId) !== String(ws.char.id)) {
      frame(ws, 'revive.result', { id: ws.entityId, ok: false, reason: 'unknown_offer' });
      return true;
    }
    DIRILIS.delete(offerId);
    if (!kabul) return true;                     // sessiz red - istemci temizledi
    if (teklif.expiresAt <= simdi()) {
      frame(ws, 'revive.result', { id: ws.entityId, ok: false, reason: 'expired' });
      return true;
    }
    if (!ws.char.dead) {
      frame(ws, 'revive.result', { id: ws.entityId, ok: false, reason: 'not_dead' });
      return true;
    }
    const t = derived ? derived(ws.char) : { maxHp: teklif.hp, maxMp: teklif.mp };
    const hp = kirp(teklif.hp, 1, Math.max(1, tamsayi(t.maxHp, teklif.hp)));
    const mp = kirp(teklif.mp, 0, Math.max(0, tamsayi(t.maxMp, teklif.mp)));
    ws.char.dead = false;
    ws.char.hp = hp;
    ws.char.mp = mp;
    const sonuc = {
      id: ws.entityId, ok: true, hp, mp,
      casterId: teklif.casterId, skillId: teklif.skillId,
    };
    frame(ws, 'revive.result', sonuc);
    broadcast(ws.zoneId, 'revive.result', sonuc, ws);
    frame(ws, 'vitals.update', { hp, mp });
    const can = { id: ws.entityId, hp, maxHp: Math.max(1, tamsayi(t.maxHp, hp)) };
    frame(ws, 'entity.hp', can);
    broadcast(ws.zoneId, 'entity.hp', can, ws);
    return true;
  }

  /**
   * DISA ACIK API — dirilis becerisi bunu cagirir.
   * hpPct/mpPct verilmezse game-config.respawnHpPct (0.5) kullanilir.
   * @returns offerId | null
   */
  function dirilisTeklifi({ hedef, caster, skillId = 'revive', hpPct, mpPct, sureMs } = {}) {
    if (!hedef?.isAuthed || !hedef.char?.dead) return null;
    const t = derived ? derived(hedef.char) : { maxHp: 100, maxMp: 100 };
    const oran = Number.isFinite(Number(hpPct)) ? Number(hpPct)
                                                : Number(GCFG.respawnHpPct ?? 0.5);
    const oranMp = Number.isFinite(Number(mpPct)) ? Number(mpPct) : oran;
    const offerId = dirilisSayaci++;
    const expiresAt = simdi() + tamsayi(sureMs, DIRILIS_SURESI);
    const kayit = {
      offerId, charId: hedef.char.id, casterId: caster?.entityId ?? 0,
      casterName: caster?.char?.name ?? 'GM', skillId,
      expiresAt,
      hp: Math.max(1, Math.floor(tamsayi(t.maxHp, 100) * oran)),
      mp: Math.max(0, Math.floor(tamsayi(t.maxMp, 100) * oranMp)),
    };
    DIRILIS.set(offerId, kayit);
    frame(hedef, 'revive.offer', {
      offerId, casterId: kayit.casterId, casterName: kayit.casterName,
      skillId: kayit.skillId, expiresAt, hp: kayit.hp, mp: kayit.mp,
    });
    return offerId;
  }

  // ==========================================================================
  // 3) unique.op (93)  ->  unique.board (204) / unique.timers (203)
  // ==========================================================================
  function uniqueKur() {
    for (const u of UNIQUE_TANIM) {
      const dk = Array.isArray(u.respawnMinutes) ? u.respawnMinutes : [180, 360];
      UNIQUE.set(u.monsterId, {
        tanim: u,
        zoneId: u.zoneId,
        minMs: Math.max(1, tamsayi(dk[0], 180)) * 60_000,
        maxMs: Math.max(1, tamsayi(dk[1], 360)) * 60_000,
        live: false,
        entityId: null,
        spawnAtMs: null,
        totalMs: null,
        cesetSil: 0,
      });
    }
    for (const st of UNIQUE.values()) uniqueZamanla(st);
    if (!web) return;
    /* Kalicilik: son olum kaydindan sonraki dogus zamani (WebUniqueKill). */
    sorgu(`SELECT monsterId, MAX(nextSpawnAt) AS nextSpawnAt
             FROM dbo.WebUniqueKill GROUP BY monsterId`)
      .then((r) => {
        for (const s of r?.recordset ?? []) {
          const st = UNIQUE.get(s.monsterId);
          const at = zamanaCevir(s.nextSpawnAt);
          if (!st || !at) continue;
          st.spawnAtMs = at;
          st.totalMs = Math.max(st.minMs, at - simdi());
        }
      })
      .catch(dbHata('unique zamanlari'));
  }
  function uniqueZamanla(st) {
    const sure = st.minMs + Math.floor(Math.random() * Math.max(1, st.maxMs - st.minMs));
    st.live = false;
    st.entityId = null;
    st.spawnAtMs = simdi() + sure;
    st.totalMs = sure;
  }

  function uniqueDogur(st) {
    if (!UNIQUE_DOGUR || !world) return false;
    const zoneId = st.zoneId;
    /* Uyumayan bolge kurali: bolge daha hic acilmadiysa (icinde oyuncu yok)
       canavar UYDURMA - world.varlikEkle() bolgeyi zorla doldururdu.
       Bolge acilinca bir sonraki tikta dogar. */
    if (!world.zoneState?.has?.(zoneId)) return false;
    const def = world.mobDefs?.get?.(st.tanim.monsterId);
    if (!def) { log(`unique ${st.tanim.monsterId}: mobs.json tanimi yok`); return false; }
    const kamplar = st.tanim.camps ?? [];
    if (!kamplar.length) return false;
    const kamp = kamplar[Math.floor(Math.random() * kamplar.length)];
    const maxHp = tamsayi(def.hp, 1);
    const e = {
      id: world.yeniVarlikId(),
      kind: 'monster',
      modelKey: def.modelKey ?? st.tanim.monsterId,
      name: def.name ?? st.tanim.monsterId,
      mobId: st.tanim.monsterId,
      x: Number(kamp.x), z: Number(kamp.z),
      y: world.groundY ? world.groundY(zoneId, Number(kamp.x), Number(kamp.z)) : 0,
      rotY: Math.random() * Math.PI * 2,
      level: tamsayi(def.level, 1),
      hp: maxHp, maxHp,
      dead: false,
      evX: Number(kamp.x), evZ: Number(kamp.z),
      evYaricap: 0, evDogYaricap: 0,       // unique kampinda kalir, gezinmez
      gez: null, gezSonraki: 0,
      def,
    };
    world.varlikEkle(zoneId, e);
    st.live = true;
    st.entityId = e.id;
    st.spawnAtMs = null;
    st.totalMs = null;
    herkese('sys.notice', { key: 'sys.unique.spawned', params: { name: e.name } });
    log(`unique dogdu: ${st.tanim.monsterId} @ ${zoneId} nest ${kamp.nestId ?? '?'}`);
    return true;
  }

  function uniqueOldu(st, e) {
    const ad = e?.name ?? st.tanim.monsterId;
    // son saldiran = mob'un hedefi (gameloop #vur: hedef.hedefEntityId = ws.entityId)
    let katil = null;
    for (const ws of tumOyuncular()) {
      if (ws.entityId === e?.hedefEntityId) { katil = ws; break; }
    }
    if (katil) {
      herkese('sys.notice',
        { key: 'sys.unique.defeated_by', params: { name: ad, killer: katil.char.name } });
    } else {
      herkese('sys.notice', { key: 'sys.unique.defeated', params: { name: ad } });
    }
    uniqueZamanla(st);
    st.cesetSil = simdi() + tamsayi(GCFG.corpseDespawnMs, 6000);
    st.cesetId = e?.id ?? null;
    /* DUNYA RESPAWN KUYRUGUNDAN CIKAR.
       gameloop.js #olum -> world.olumKaydet(zoneId, mob) her olen canavari
       yuvanin kendi respawn penceresiyle (spawns.json respawnDelaySec,
       world.respawnGecikmesi) `z.olu` kuyruguna atar; world.respawnTik
       pencere dolunca AYNI varligi dead=false + hp=maxHp yapip evX/evZ'de
       diriltir. Unique'in dogum takvimi bizde (180-360 dk) oldugundan bu
       kuyruk kaydi YANLIS:
       - corpseDespawnMs respawn penceresini asarsa (admin paneli 600000'e
         kadar izin veriyor) unique pencere dolunca sahada canlanir ama bizim
         st.live false'tur -> takvim gelince IKINCI bir unique dogar.
       Kaydi olum aninda siliyoruz; ceset yine cesetSil'de kaldirilir. */
    const bolge = world?.zoneState?.get?.(st.zoneId);
    if (bolge?.olu?.length && e?.id != null) {
      bolge.olu = bolge.olu.filter((o) => o.id !== e.id);
    }
    if (web) {
      sorgu(`INSERT INTO dbo.WebUniqueKill (monsterId, zoneId, killerName, killedAt, nextSpawnAt)
             VALUES (@m, @z, @k, GETDATE(), @n)`,
        {
          m: st.tanim.monsterId, z: st.zoneId,
          k: katil ? String(katil.char.name) : null,
          n: new Date(st.spawnAtMs),
        }).catch(dbHata('unique olum kaydi'));
    }
  }

  function uniqueTik() {
    /* EK DUZELTME A destegi (gereksinim_unique_nerede 2026-09-04):
       sistem_dirilis-unique kuruluysa unique dogum/olum motoru TAMAMEN ona
       ait - buradaki es motor da calisirsa unique CIFT dogar ve
       sys.unique.spawned duyurusu IKINCI bir kaynaktan gider (dosya sonu 3b
       CAKISMA UYARISI'nin dogum ayagi; ozellikle WebUniqueKill'den yuklenen
       GECMIS nextSpawnAt her yeniden kurulumda aninda dogum+duyuru
       tetikleyebilir). unique.timers yayini icin ayni kapi zaten vardi
       (KIRIKLIK ONARIMI notu); dogum tarafi da ayni kapiyla susturuluyor.
       dirilis-unique yoksa (tek basina kurulum) motor eskisi gibi calisir.
       Kapi her tikte OKUNUR (kur aninda degil): sistemleriKur sirasinda
       modul sirasi ne olursa olsun ilk tik aninda dogru ornegi gorur. */
    if (sistemOrnegi?.('dirilis-unique')) return;
    for (const st of UNIQUE.values()) {
      if (st.cesetSil && simdi() >= st.cesetSil) {
        if (st.cesetId != null) world?.varlikSil?.(st.zoneId, st.cesetId);
        st.cesetSil = 0; st.cesetId = null;
      }
      if (st.live) {
        const e = world?.varlik?.(st.zoneId, st.entityId) ?? null;
        if (!e) { uniqueZamanla(st); continue; }   // baska bir sey sildi
        if (e.dead) { st.live = false; st.entityId = null; uniqueOldu(st, e); }
        continue;
      }
      if (st.spawnAtMs != null && simdi() >= st.spawnAtMs) uniqueDogur(st);
    }
  }

  function uniqueTimersPayload() {
    return {
      serverTime: simdi(),
      uniques: [...UNIQUE.values()].map((st) => ({
        monsterId: st.tanim.monsterId,
        zoneId: st.zoneId,
        live: !!st.live,
        spawnAtMs: st.live ? null : (st.spawnAtMs ?? null),
        totalMs: st.live ? null : (st.totalMs ?? null),
      })),
    };
  }

  /* CharID = 0 "dummy" karakteri PANOLARDA GOSTERILMEZ.
     Bu satir vSRO kurulumunun tuttugu teknik kayittir (100. seviye, 1 milyar
     altin) - gercek bir oyuncu degil ve siralamanin tepesini isgal ediyordu.
     Kullanici dummy satirinin DB'de KALMASINI istedi, yalniz gorunmesin. */
  // --------------------------------------------------------------- panolar
  async function seviyePanosu(ws) {
    let satirlar = [];
    if (web && SHARD) {
      const r = await sorgu(
        `SELECT TOP 50 CharName16 AS name, CurLevel AS lvl
           FROM ${SHARD}.dbo._Char
          WHERE Deleted = 0 AND CharID > 0
          ORDER BY CurLevel DESC, ExpOffset DESC, CharName16 ASC`);
      satirlar = (r?.recordset ?? []).map((s) => ({ name: String(s.name), level: tamsayi(s.lvl, 1) }));
    }
    if (!satirlar.length) {
      // DB yoksa TEK gercek kaynak: su an cevrimici olanlar
      satirlar = [...tumOyuncular()]
        .map((p) => ({ name: String(p.char.name), level: tamsayi(p.char.level, 1) }))
        .sort((a, b) => b.level - a.level || a.name.localeCompare(b.name))
        .slice(0, 50);
    }
    const rows = satirlar.map((s, i) => ({ rank: i + 1, name: s.name, level: s.level }));
    const benim = rows.find((r) => r.name === ws.char.name) ?? null;
    // DIKKAT: level satirlari .strict() - fazladan alan gonderilemez.
    frame(ws, 'unique.board', {
      kind: 'level', rows,
      me: benim ? { rank: benim.rank, level: benim.level } : null,
    });
  }

  /**
   * MADDE 57 (capraz istek 63): meslek siralamasi. Kaynak: dbo.WebCharProfession
   * (CharID, ProfessionID, Lvl, Xp - sistem_meslek.js:86) + shard _Char adi.
   * Sema @25621373: {kind:'profession', professionId, rows:[{rank,name,level}], me}.
   */
  async function meslekPanosu(ws, pid) {
    let satirlar = [];
    if (web && SHARD) {
      const r = await sorgu(
        `SELECT TOP 50 c.CharName16 AS name, p.Lvl AS lvl
           FROM dbo.WebCharProfession p
           JOIN ${SHARD}.dbo._Char c ON c.CharID = p.CharID AND c.Deleted = 0
          WHERE p.ProfessionID = @pid
          ORDER BY p.Lvl DESC, p.Xp DESC, c.CharName16 ASC`, { pid });
      satirlar = (r?.recordset ?? []).map((s) => ({ name: String(s.name), level: tamsayi(s.lvl, 1) }));
    }
    const rows = satirlar.map((s, i) => ({ rank: i + 1, name: s.name, level: s.level }));
    const benim = rows.find((r2) => r2.name === ws.char.name) ?? null;
    frame(ws, 'unique.board', {
      kind: 'profession', professionId: pid, rows,
      me: benim ? { rank: benim.rank, level: benim.level } : null,
    });
  }

  async function uniquePanosu(ws) {
    let satirlar = [];
    if (web) {
      const sorguMetni = SHARD
        ? `SELECT TOP 50 k.killerName AS name, COUNT(*) AS points,
                  ISNULL(MAX(c.CurLevel), 0) AS lvl
             FROM dbo.WebUniqueKill k
             LEFT JOIN ${SHARD}.dbo._Char c ON c.CharName16 = k.killerName
            WHERE k.killerName IS NOT NULL
            GROUP BY k.killerName
            ORDER BY COUNT(*) DESC, k.killerName ASC`
        : `SELECT TOP 50 killerName AS name, COUNT(*) AS points, 0 AS lvl
             FROM dbo.WebUniqueKill
            WHERE killerName IS NOT NULL
            GROUP BY killerName
            ORDER BY COUNT(*) DESC, killerName ASC`;
      const r = await sorgu(sorguMetni);
      satirlar = (r?.recordset ?? []).map((s) => ({
        name: String(s.name), level: tamsayi(s.lvl, 0), points: tamsayi(s.points, 0),
      }));
    }
    const rows = satirlar.map((s, i) => ({ rank: i + 1, ...s }));
    const benim = rows.find((r) => r.name === ws.char.name) ?? null;
    frame(ws, 'unique.board', {
      kind: 'unique', rows,
      me: benim ? { rank: benim.rank, points: benim.points } : null,
    });
  }

  function uniqueOp(ws, d) {
    const op = d?.op;
    if (op === 'board') { uniquePanosu(ws).catch(dbHata('unique panosu')); return true; }
    if (op === 'levelBoard') { seviyePanosu(ws).catch(dbHata('seviye panosu')); return true; }
    if (op === 'professionBoard') {
      const pid = String(d?.professionId ?? '');
      if (!pid || pid.length > 64) return hata(ws, HATA.DOGRULAMA);
      /* MADDE 57 (capraz istek 63): "veri kaynagi YOK" yorumu GECERSIZDI -
         WebCharProfession + WebGetCharProfessions canli DB'de var (plan
         kaniti; sutunlar sistem_meslek.js:86 ile dogrulandi).
         levelBoard/uniquePanosu ile ayni async+dbHata kalibi. */
      meslekPanosu(ws, pid).catch(dbHata('meslek panosu'));
      return true;
    }
    return hata(ws, HATA.DOGRULAMA);
  }

  // ==========================================================================
  // 4) carrier.op (40)  ->  carrier.state (213)
  // ==========================================================================
  function carrierDurum(ch) {
    const anahtar = String(ch.id);
    let st = CARRIER.get(anahtar);
    if (!st) {
      st = {
        phase: 'idle', zoneId: null, x: null, z: null,
        arriveAtMs: null, landedUntilMs: null,
        slots: new Array(C_TEMEL_YUVA).fill(null),
        slotsMax: C_TEMEL_YUVA, readyAt: 0,
      };
      CARRIER.set(anahtar, st);
    }
    return st;
  }
  function carrierPayload(ch) {
    const st = carrierDurum(ch);
    const yuvalar = st.slots.slice(0, st.slotsMax)
      .map((s) => (s ? { itemId: s.itemId, qty: s.qty } : null));
    /* CANLI YAKALAMA (GERCEK/zone_init.json, zone.init.batch):
         {"t":"carrier.state","d":{"phase":"idle","slots":[],"slotsMax":12,"readyAt":0}}
       Gercek sunucu SONDAKI bos yuvalari kirpiyor - bostaki tasiyicida dizi
       BOS, uzunlugu slotsMax'a esit degil. Istemci yuvayi `slots[slot] ?? null`
       ile okudugu icin (@27357296) gorunum degismez; amac birebir eslesmek. */
    while (yuvalar.length && yuvalar[yuvalar.length - 1] === null) yuvalar.pop();
    const d = {
      phase: st.phase,
      slots: yuvalar,
      slotsMax: st.slotsMax,
      readyAt: st.readyAt,
    };
    if (st.zoneId) d.zoneId = st.zoneId;
    /* IKISI BIRDEN olmali: sema x/z = Y().optional() - `null` SAYI DEGIL,
       zod'dan gecmez ve istemci KARENIN TAMAMINI sessizce atar. DB'den
       posX dolu / posZ NULL gelen satirda (WebCharCarrier iki sutun da
       nullable) eskiden d.z = null yaziliyordu. */
    if (Number.isFinite(st.x) && Number.isFinite(st.z)) { d.x = st.x; d.z = st.z; }
    if (st.arriveAtMs != null) d.arriveAtMs = st.arriveAtMs;
    if (st.landedUntilMs != null) d.landedUntilMs = st.landedUntilMs;
    return d;
  }
  async function carrierYukle(ch) {
    if (!web) return;
    const charId = Number(ch?.id);
    if (!Number.isFinite(charId)) return;
    const r = await sorgu(
      `SELECT phase, zoneId, posX, posZ, slotsJson, slotsMax, readyAt
         FROM dbo.WebCharCarrier WHERE CharID = @c`, { c: charId });
    const s = r?.recordset?.[0];
    if (!s) return;
    const st = carrierDurum(ch);
    /* MADDE 56: DB'den gelen deger de TAVANA kirpilir (12..32). Eskiden yalniz
       alt sinir vardi; eski/bozuk bir satir 32'nin ustunde slotsMax getirseydi
       istemcinin genisletme penceresi ile sunucu ayrisirdi. */
    st.slotsMax = Math.min(C_MAX_YUVA, Math.max(C_TEMEL_YUVA, tamsayi(s.slotsMax, C_TEMEL_YUVA)));
    st.readyAt = zamanaCevir(s.readyAt) ?? 0;
    let yuvalar = null;
    try { yuvalar = s.slotsJson ? JSON.parse(s.slotsJson) : null; } catch { yuvalar = null; }
    st.slots = new Array(st.slotsMax).fill(null);
    if (Array.isArray(yuvalar)) {
      for (let i = 0; i < Math.min(yuvalar.length, st.slotsMax); i++) {
        const y = yuvalar[i];
        st.slots[i] = (y && y.itemId) ? { itemId: String(y.itemId), qty: Math.max(1, tamsayi(y.qty, 1)) } : null;
      }
    }
    /* Kayitli ucus/inis suresi yeniden baslatmayi ASMAZ: sunucu kapaliyken
       gecen sureyi telafi edemeyiz, bu yuzden kayit yalnizca yuva/bekleme
       icin kullanilir ve faz bostadan baslar - esyalar yuvalarda durur. */
    st.phase = st.slots.some(Boolean) ? 'landed' : 'idle';
    if (st.phase === 'landed') {
      st.zoneId = s.zoneId ?? null;
      st.x = s.posX == null ? null : Number(s.posX);
      st.z = s.posZ == null ? null : Number(s.posZ);
      st.landedUntilMs = simdi() + C_KALIS;
    }
  }
  function carrierKaydet(ch) {
    if (!web) return;
    const charId = Number(ch?.id);
    if (!Number.isFinite(charId)) return;
    const st = carrierDurum(ch);
    sorgu(
      `MERGE dbo.WebCharCarrier AS t USING (SELECT @c AS CharID) AS s ON t.CharID = s.CharID
       WHEN MATCHED THEN UPDATE SET phase=@p, zoneId=@z, posX=@x, posZ=@zz,
                                    slotsJson=@j, slotsMax=@m, readyAt=@r
       WHEN NOT MATCHED THEN INSERT (CharID, phase, zoneId, posX, posZ, slotsJson, slotsMax, readyAt)
                             VALUES (@c, @p, @z, @x, @zz, @j, @m, @r);`,
      {
        c: charId, p: st.phase, z: st.zoneId, x: st.x, zz: st.z,
        j: JSON.stringify(st.slots.slice(0, st.slotsMax)),
        m: st.slotsMax, r: st.readyAt ? new Date(st.readyAt) : null,
      }).catch(dbHata('carrier kaydi'));
  }

  function carrierYolla(ws) { frame(ws, 'carrier.state', carrierPayload(ws.char)); }

  function carrierSiparis(ws, d) {
    if (!premiumDurum(ws)) return hata(ws, HATA.DOGRULAMA, ANAHTAR.PREMIUM);
    const kure = KURE.get(ws.zoneId);
    if (!kure) return hata(ws, HATA.DOGRULAMA, ANAHTAR.C_SEHIR);
    const st = carrierDurum(ws.char);
    if (st.phase !== 'idle') return hata(ws, HATA.DOGRULAMA, ANAHTAR.C_AKTIF);
    if (st.readyAt > simdi()) return hata(ws, HATA.BEKLE);

    const lines = Array.isArray(d?.lines) ? d.lines : [];
    if (!lines.length || lines.length > 32) return hata(ws, HATA.DOGRULAMA);
    if (lines.length > st.slotsMax) return hata(ws, HATA.DOGRULAMA, ANAHTAR.C_YUVA);

    let bedel = 0;
    const yuvalar = [];
    for (const l of lines) {
      const npcId = String(l?.npcId ?? '');
      const itemId = String(l?.itemId ?? '');
      const qty = tamsayi(l?.qty, 0);
      const stok = DUKKAN_STOK.get(npcId);
      if (!stok || !stok.has(itemId)) return hata(ws, HATA.BULUNAMADI);
      const def = esyaTanim(itemId);
      // istemci buyPrice===null olan esyayi listeye bile koymaz (@27357296)
      if (!def || def.buyPrice == null) return hata(ws, HATA.BULUNAMADI);
      if (qty < 1 || qty > yiginSiniri(def)) return hata(ws, HATA.DOGRULAMA);
      bedel += tamsayi(def.buyPrice, 0) * qty;
      yuvalar.push({ itemId, qty });
    }
    const altin = tamsayi(ws.char.gold, 0);
    if (altin < bedel) return hata(ws, HATA.ALTIN);

    ws.char.gold = altin - bedel;
    altiniKaydet(ws.char);
    envanteriYolla(ws);

    const mesafe = Math.hypot(kure.x - Number(ws.char.x), kure.z - Number(ws.char.z));
    const ucusMs = Math.max(1000, Math.round((mesafe / C_HIZ) * 1000));

    st.phase = 'flying';
    st.zoneId = ws.zoneId;
    st.x = Number(ws.char.x);
    st.z = Number(ws.char.z);
    st.arriveAtMs = simdi() + ucusMs;
    st.landedUntilMs = null;
    st.readyAt = simdi() + C_BEKLEME;
    st.slots = new Array(st.slotsMax).fill(null);
    for (let i = 0; i < yuvalar.length; i++) st.slots[i] = yuvalar[i];

    bildir(ws, 'sys.carrier.ordered', { gold: bedel, count: yuvalar.length });
    carrierYolla(ws);
    carrierKaydet(ws.char);
    return true;
  }

  function carrierTopla(ws, d, hepsi) {
    const st = carrierDurum(ws.char);
    if (st.phase !== 'landed') return hata(ws, HATA.DOGRULAMA, ANAHTAR.C_INMEDI);
    /* Kus, siparis verilen NOKTAYA iniyor (carrierSiparis: st.zoneId/x/z =
       siparis anindaki oyuncu konumu). Toplamak icin oraya donmek gerekir -
       carrier.interactRangeU = 25 (bkz. C_MENZIL). Eskiden kapi YOKTU: oyuncu
       dunyanin obur ucundan collect/collectAll yapabiliyordu.
       Konum bilinmiyorsa (eski/eksik DB satiri) kapi calismaz - fail-open. */
    if (Number.isFinite(st.x) && Number.isFinite(st.z)) {
      const baskaBolge = st.zoneId != null && String(st.zoneId) !== String(ws.zoneId);
      const uzaklik = Math.hypot(st.x - Number(ws.char.x), st.z - Number(ws.char.z));
      if (baskaBolge || !(uzaklik <= C_MENZIL)) return hata(ws, HATA.MENZIL);
    }
    const bag = canta(ws.char);
    const hedefler = hepsi
      ? st.slots.map((_, i) => i)
      : [tamsayi(d?.slot, -1)];
    let alinan = 0;
    for (const i of hedefler) {
      if (i < 0 || i >= st.slotsMax) { if (!hepsi) return hata(ws, HATA.DOGRULAMA); continue; }
      const yuva = st.slots[i];
      if (!yuva) { if (!hepsi) return hata(ws, HATA.BULUNAMADI); continue; }
      const def = esyaTanim(yuva.itemId);
      if (!def) { st.slots[i] = null; continue; }
      const istenen = hepsi ? yuva.qty : Math.min(tamsayi(d?.qty, 1), yuva.qty);
      if (istenen < 1) { if (!hepsi) return hata(ws, HATA.DOGRULAMA); continue; }
      const plan = yerlestirmePlani(bag, def, istenen);
      if (!plan) { if (!hepsi && alinan === 0) return hata(ws, HATA.CANTA); break; }
      planiUygula(bag, def, plan);
      yuva.qty -= istenen;
      if (yuva.qty <= 0) st.slots[i] = null;
      alinan++;
      bildir(ws, 'sys.carrier.collected', { qty: istenen, item: def.name ?? def.id });
    }
    if (!alinan) return hata(ws, HATA.CANTA);
    if (!st.slots.some(Boolean)) {
      st.phase = 'idle'; st.zoneId = null; st.x = null; st.z = null;
      st.arriveAtMs = null; st.landedUntilMs = null;
    }
    envanteriYolla(ws);
    carrierYolla(ws);
    carrierKaydet(ws.char);
    return true;
  }

  function carrierTik() {
    for (const ws of tumOyuncular()) {
      const st = CARRIER.get(String(ws.char.id));
      if (!st) continue;
      if (st.phase === 'flying' && st.arriveAtMs != null && simdi() >= st.arriveAtMs) {
        st.phase = 'landed';
        st.arriveAtMs = null;
        st.landedUntilMs = simdi() + C_KALIS;
        bildir(ws, 'sys.carrier.arrived');
        carrierYolla(ws);
        carrierKaydet(ws.char);
      } else if (st.phase === 'landed' && st.landedUntilMs != null && simdi() >= st.landedUntilMs) {
        const kayipVardi = st.slots.some(Boolean);
        st.phase = 'idle'; st.zoneId = null; st.x = null; st.z = null;
        st.landedUntilMs = null;
        st.slots = new Array(st.slotsMax).fill(null);
        if (kayipVardi) bildir(ws, 'sys.carrier.expired');
        carrierYolla(ws);
        carrierKaydet(ws.char);
      }
    }
  }

  /**
   * DISA ACIK API — `carrier_expansion` esyasini kullanan sistem cagirir.
   * game-config.carrier.slotsPerExpansion kadar yuva ekler.
   *
   * MADDE 56: TAVAN eklendi. Istemcinin genisletme penceresi tavani kendisi
   * hesapliyor (paket @27394825):
   *     max = gameConfig.carrier.baseSlots + 5 * carrier.slotsPerExpansion
   * yani 12 + 5*4 = 32 ve `from >= max` iken dugmeyi kilitliyor. Sunucuda
   * kontrol YOKTU: ham paket gonderen oyuncu tavani asabilirdi.
   * @returns yeni slotsMax; TAVAN dolduysa 0 (hicbir sey degismez)
   */
  function carrierGenislet(ws) {
    if (!ws?.char) return 0;
    const st = carrierDurum(ws.char);
    if (st.slotsMax >= C_MAX_YUVA) return 0;
    st.slotsMax = Math.min(C_MAX_YUVA, st.slotsMax + C_EK_YUVA);
    const eski = st.slots;
    st.slots = new Array(st.slotsMax).fill(null);
    for (let i = 0; i < Math.min(eski.length, st.slotsMax); i++) st.slots[i] = eski[i];
    bildir(ws, 'sys.expand.carrier', { slots: st.slotsMax });
    carrierYolla(ws);
    carrierKaydet(ws.char);
    return st.slotsMax;
  }

  /**
   * c2s 126 `item.expand` { bagSlot } - TASIYICI genisletme dali (madde 56).
   *
   * MESAJIN YOLU: sistem_banka-depo bu mesaji ONCE goruyor (SISTEM_ADLARI'nda
   * once geliyor) ve `bagExpand` / `storageExpand` turlerini kendisi isliyor;
   * `carrierExpand` icin BILEREK false donuyor, yani mesaj buraya dusuyor.
   * Eskiden burada dal YOKTU: carrierGenislet() disa acik olmasina ragmen SIFIR
   * caginani vardi, yani item-mall'da satilan `carrier_expansion` esyasi
   * kullanildiginda HICBIR SEY olmuyordu (fark #105).
   *
   * Sema: T$(`item.expand`, 126, X({ bagSlot: Y().int().min(0).max(159) }), `inv`)
   *       (paket @25614904; gonderim @27397100 W$.send('item.expand',{bagSlot})).
   * Esya turu: data/items.json `carrier_expansion` -> type "carrierExpand".
   *
   * TAVAN DOLUYSA esya TUKETILMEZ ve err.expand.max doner (plan maddesi 56).
   */
  function carrierGenisletme(ws, d) {
    const ch = ws.char;
    const bag = canta(ch);
    const yuva = tamsayi(d?.bagSlot, -1);
    if (!Number.isInteger(yuva) || yuva < 0 || yuva >= bag.length) return hata(ws, HATA.DOGRULAMA);
    const st = bag[yuva];
    if (!st?.itemId) return hata(ws, HATA.BULUNAMADI);
    /* Bizim turumuz degilse mesaji SAHIPLENMIYORUZ (yonlendirici devam etsin).
       banka-depo zaten bagExpand/storageExpand'i isledi; buraya baska bir tur
       gelirse onu tuketmek sessiz bir yutma olurdu. */
    if (esyaTanim(st.itemId)?.type !== 'carrierExpand') return false;

    const carrier = carrierDurum(ch);
    if (carrier.slotsMax >= C_MAX_YUVA) return hata(ws, HATA.DOGRULAMA, ANAHTAR.GENIS_MAX);

    const yeni = carrierGenislet(ws);      // sys.expand.carrier + carrier.state + kayit
    if (!yeni) return hata(ws, HATA.DOGRULAMA, ANAHTAR.GENIS_MAX);

    // basarili -> esya harcanir (tavan kontrolunden SONRA)
    const kalan = (st.qty ?? 1) - 1;
    bag[yuva] = kalan > 0 ? { ...st, qty: kalan } : null;
    envanteriYolla(ws);
    return true;
  }

  // ==========================================================================
  // 5) auction.op (125) -> auction.list (242) / auction.mine (243) / notice (244)
  // ==========================================================================
  const SURELER = new Set([7, 24, 48]);

  /** Istemcinin pPt() kurali (@27263007) - minimum teklif. */
  const asgariTeklif = (m) => (m.currentBid <= 0
    ? m.startPrice
    : m.currentBid + Math.max(1, Math.floor(m.currentBid * 0.05)));

  function mezatSatiri(m, ws) {
    const benim = String(m.sellerCharId) === String(ws.char.id);
    const enUst = m.topBidderCharId != null
      && String(m.topBidderCharId) === String(ws.char.id);
    return {
      id: m.id,
      seller: m.sellerName,
      item: m.item,
      startPrice: m.startPrice,
      buyNowPrice: m.buyNowPrice,
      currentBid: m.currentBid,
      bidCount: m.bidCount,
      endsAt: m.endsAt,
      status: m.status,
      finalPrice: m.finalPrice,
      youAreTop: enUst,
      mine: benim,
      claimable: alinabilirMi(m, ws.char.id),
    };
  }

  /**
   * MADDE 44: satis kapaninca satici ANINDA odenir - "Al" adimi YOK.
   * Istemci saticiya zaten "bankana odendi" diyor (ui.auction.toast_sold /
   * ui.auction.status_sold), yani ekranda odenmis gorunen para icin ayrica
   * dugmeye basmasi gerekiyordu.
   *
   * `altinAlindi` bayragi KALIYOR ve artik "odendi" anlamina geliyor: CIFT
   * ODEMEYE karsi tek korumadir (mezatYukle() bayragi itemJson blobundan geri
   * okuyor; mezatTik'in kapanis temizligi de bu bayraga bakiyor).
   */
  function saticiyaOde(m) {
    if (!m || m.altinAlindi) return;
    const tutar = tamsayi(m.finalPrice, 0);
    if (tutar <= 0) return;
    m.altinAlindi = true;          // ONCE isaretle: ayni mezat iki kez odenmesin
    bankayaYatirAsenkron(m.sellerCharId, tutar, 'mezat geliri');
  }

  /** Bu karakter bu kayittan bir sey alabilir mi? */
  function alinabilirMi(m, charId) {
    const id = String(charId);
    if (m.status === 'ended_sold') {
      /* MADDE 44: SADECE kazanan, SADECE esya icin. Saticinin altini satis
         aninda bankaya odendi (saticiyaOde), 'claim' adimi kaldirildi. */
      return String(m.topBidderCharId) === id && !m.esyaAlindi;
    }
    if (m.status === 'ended_unsold' || m.status === 'cancelled') {
      return String(m.sellerCharId) === id && !m.esyaAlindi;                // satici esyayi geri alir
    }
    return false;
  }

  function aktifler() {
    return [...MEZAT.values()]
      .filter((m) => m.status === 'active')
      .sort((a, b) => a.endsAt - b.endsAt);
  }
  function mezatListesi(ws, sayfa) {
    const hepsi = aktifler();
    const pages = Math.max(1, Math.ceil(hepsi.length / MEZAT_SAYFA));
    const page = kirp(tamsayi(sayfa, 0), 0, pages - 1);
    frame(ws, 'auction.list', {
      auctions: hepsi.slice(page * MEZAT_SAYFA, page * MEZAT_SAYFA + MEZAT_SAYFA)
        .map((m) => mezatSatiri(m, ws)),
      page, pages, serverTime: simdi(),
    });
  }
  function mezatBenim(ws) {
    const id = String(ws.char.id);
    const entries = [...MEZAT.values()]
      .filter((m) => String(m.sellerCharId) === id
                  || String(m.topBidderCharId ?? '') === id
                  || (m.teklifVerenler?.has?.(id) ?? false))
      .sort((a, b) => b.endsAt - a.endsAt)
      .map((m) => mezatSatiri(m, ws));
    frame(ws, 'auction.mine', { entries, serverTime: simdi() });
  }
  function abonelereYayin() {
    for (const ws of MEZAT_ABONE) {
      if (!ws.isAuthed) { MEZAT_ABONE.delete(ws); continue; }
      mezatListesi(ws, ws.__ks_mezatSayfa ?? 0);
      mezatBenim(ws);
    }
  }
  function mezatBildirim(charId, kare) {
    const ws = oyuncuCharId(charId);
    if (ws) frame(ws, 'auction.notice', kare);
  }

  function mezatOlustur(ws, d) {
    const bag = canta(ws.char);
    const aSlot = tamsayi(d?.auctioneerSlot, -1);
    const iSlot = tamsayi(d?.itemSlot, -1);
    const startPrice = tamsayi(d?.startPrice, 0);
    const buyNowPrice = tamsayi(d?.buyNowPrice, 0);
    const durationH = tamsayi(d?.durationH, 0);
    if (aSlot < 0 || aSlot >= bag.length || iSlot < 0 || iSlot >= bag.length || aSlot === iSlot) {
      return hata(ws, HATA.DOGRULAMA);
    }
    if (!SURELER.has(durationH)) return hata(ws, HATA.DOGRULAMA);
    if (startPrice < 1 || buyNowPrice < 2) return hata(ws, HATA.DOGRULAMA);
    if (buyNowPrice <= startPrice) return hata(ws, HATA.DOGRULAMA, ANAHTAR.M_FIYAT);

    const mezatci = bag[aSlot];
    const mezatciDef = esyaTanim(mezatci?.itemId);
    if (!mezatci || mezatciDef?.type !== 'auctioneer') {
      return hata(ws, HATA.DOGRULAMA, ANAHTAR.M_MEZATCI);
    }
    const esya = bag[iSlot];
    const esyaDef = esyaTanim(esya?.itemId);
    if (!esya || !ekipmanMi(esyaDef)) return hata(ws, HATA.DOGRULAMA, ANAHTAR.M_EKIPMAN);
    /* Istemcinin gPt() testi (paket @27266066) tipe EK OLARAK sureli/kiralik
       ornekleri disliyor:  `item.rolls?.petExpiresAt === void 0`.
       Bu sart olmadan sunucu kabul ediyordu ama arayuz esyayi mezat
       penceresine SURUKLETMIYOR - iki taraf ayrisiyordu. Ayni damga takas
       ve tezgah taraflarinda da bagliligi belirliyor (paket @27162544 h7). */
    if (typeof esya?.rolls?.petExpiresAt === 'number') {
      return hata(ws, HATA.DOGRULAMA, ANAHTAR.M_EKIPMAN);
    }

    const aktifSayim = [...MEZAT.values()].filter(
      (m) => m.status === 'active' && String(m.sellerCharId) === String(ws.char.id)).length;
    if (aktifSayim >= MEZAT_AKTIF_SINIR) return hata(ws, HATA.DOGRULAMA, ANAHTAR.M_COKFAZLA);

    // mezatci parsomeni harcanir, esya cantadan cikar (emanete gecer)
    const kalan = (mezatci.qty ?? 1) - 1;
    bag[aSlot] = kalan > 0 ? { ...mezatci, qty: kalan } : null;
    bag[iSlot] = null;

    const m = {
      id: crypto.randomUUID(),
      sellerCharId: String(ws.char.id),
      sellerName: String(ws.char.name),
      item: { ...esya },
      startPrice, buyNowPrice,
      currentBid: 0, bidCount: 0,
      topBidderCharId: null,
      endsAt: simdi() + durationH * 3_600_000,
      status: 'active',
      finalPrice: null,
      esyaAlindi: false, altinAlindi: false,
      teklifVerenler: new Set(),
    };
    MEZAT.set(m.id, m);
    mezatKaydet(m);
    envanteriYolla(ws);
    bildir(ws, 'sys.auction.created', { item: esyaDef?.name ?? esya.itemId });
    abonelereYayin();
    return true;
  }

  function mezatTeklif(ws, d) {
    const m = MEZAT.get(String(d?.auctionId ?? ''));
    if (!m) return hata(ws, HATA.BULUNAMADI);
    if (m.status !== 'active' || m.endsAt <= simdi()) {
      return hata(ws, HATA.DOGRULAMA, ANAHTAR.M_BITTI);
    }
    if (String(m.sellerCharId) === String(ws.char.id)) {
      return hata(ws, HATA.DOGRULAMA, ANAHTAR.M_KENDI);
    }
    if (String(m.topBidderCharId ?? '') === String(ws.char.id)) {
      return hata(ws, HATA.DOGRULAMA, ANAHTAR.M_ZATEN);
    }
    const miktar = tamsayi(d?.amount, 0);
    if (miktar < asgariTeklif(m)) return hata(ws, HATA.DOGRULAMA, ANAHTAR.M_DUSUK);
    if (miktar >= m.buyNowPrice) return hata(ws, HATA.DOGRULAMA, ANAHTAR.M_HEMENAL);
    if (tamsayi(ws.char.gold, 0) < miktar) return hata(ws, HATA.DOGRULAMA, ANAHTAR.M_ALTIN);

    /* Eski en yuksek teklif iade edilir (emanet sistemi).
       MADDE 44: iade HESAP BANKASINA gider - ui.auction.toast_outbid
       "...{gold} altin bankana iade edildi." */
    if (m.topBidderCharId != null) {
      bankayaYatirAsenkron(m.topBidderCharId, m.currentBid, 'mezat gecildi');
      mezatBildirim(m.topBidderCharId, {
        kind: 'outbid', auctionId: m.id, itemDefId: m.item.itemId, amount: miktar,
      });
    }
    ws.char.gold = tamsayi(ws.char.gold, 0) - miktar;
    altiniKaydet(ws.char);
    envanteriYolla(ws);

    m.currentBid = miktar;
    m.bidCount += 1;
    m.topBidderCharId = String(ws.char.id);
    m.teklifVerenler.add(String(ws.char.id));
    mezatKaydet(m);
    mezatTeklifKaydet(m, ws.char.id, miktar);
    bildir(ws, 'sys.auction.bid_placed', { gold: miktar });
    abonelereYayin();
    return true;
  }

  function mezatHemenAl(ws, d) {
    const m = MEZAT.get(String(d?.auctionId ?? ''));
    if (!m) return hata(ws, HATA.BULUNAMADI);
    if (m.status !== 'active' || m.endsAt <= simdi()) {
      return hata(ws, HATA.DOGRULAMA, ANAHTAR.M_BITTI);
    }
    if (String(m.sellerCharId) === String(ws.char.id)) {
      return hata(ws, HATA.DOGRULAMA, ANAHTAR.M_KENDI);
    }
    const fiyat = m.buyNowPrice;
    if (tamsayi(ws.char.gold, 0) < fiyat) return hata(ws, HATA.DOGRULAMA, ANAHTAR.M_ALTIN);

    /* MADDE 44: gecilen/kendi teklifin iadesi de HESAP BANKASINA. */
    if (m.topBidderCharId != null && String(m.topBidderCharId) !== String(ws.char.id)) {
      bankayaYatirAsenkron(m.topBidderCharId, m.currentBid, 'mezat hemen al');
      mezatBildirim(m.topBidderCharId, {
        kind: 'outbid', auctionId: m.id, itemDefId: m.item.itemId, amount: fiyat,
      });
    } else if (m.topBidderCharId != null) {
      bankayaYatirAsenkron(m.topBidderCharId, m.currentBid, 'mezat hemen al (kendi teklifi)');
    }
    ws.char.gold = tamsayi(ws.char.gold, 0) - fiyat;
    altiniKaydet(ws.char);
    envanteriYolla(ws);

    m.status = 'ended_sold';
    m.finalPrice = fiyat;
    m.currentBid = fiyat;
    m.topBidderCharId = String(ws.char.id);
    m.teklifVerenler.add(String(ws.char.id));
    m.endsAt = simdi();
    saticiyaOde(m);          // madde 44: gelir ANINDA hesap bankasina
    mezatKaydet(m);
    bildir(ws, 'sys.auction.bought', { gold: fiyat });
    mezatBildirim(m.sellerCharId, {
      kind: 'sold', auctionId: m.id, itemDefId: m.item.itemId, amount: fiyat,
    });
    abonelereYayin();
    return true;
  }

  function mezatIptal(ws, d) {
    const m = MEZAT.get(String(d?.auctionId ?? ''));
    if (!m) return hata(ws, HATA.BULUNAMADI);
    if (String(m.sellerCharId) !== String(ws.char.id)) return hata(ws, HATA.DOGRULAMA);
    if (m.status !== 'active') return hata(ws, HATA.DOGRULAMA, ANAHTAR.M_BITTI);
    if (m.bidCount > 0) return hata(ws, HATA.DOGRULAMA, ANAHTAR.M_TEKLIFVAR);
    m.status = 'cancelled';
    m.endsAt = simdi();
    mezatKaydet(m);
    bildir(ws, 'sys.auction.cancelled');
    abonelereYayin();
    return true;
  }

  function mezatAl(ws, d) {
    const m = MEZAT.get(String(d?.auctionId ?? ''));
    if (!m) return hata(ws, HATA.BULUNAMADI);
    const id = String(ws.char.id);
    if (!alinabilirMi(m, id)) return hata(ws, HATA.DOGRULAMA, ANAHTAR.M_ALINAMAZ);

    /* MADDE 44: "satici altini alir" dali KALDIRILDI. Gelir satis aninda hesap
       bankasina odeniyor (saticiyaOde), alinabilirMi() de saticiyi satilan
       mezatta artik claimable saymiyor. Yan fayda: sys.auction.claimed artik
       yalniz ESYA icin gidiyor - eskiden altin alinirken de esya adiyla
       gonderiliyordu (fark #151). */
    // esya teslimi (kazanan ya da satilamayan/iptal edilen mezatin saticisi)
    if (!kaydiYerlestir(ws.char, m.item)) return hata(ws, HATA.CANTA, ANAHTAR.M_CANTA);
    m.esyaAlindi = true;
    envanteriYolla(ws);
    bildir(ws, 'sys.auction.claimed', { item: esyaTanim(m.item.itemId)?.name ?? m.item.itemId });
    mezatKaydet(m);
    abonelereYayin();
    return true;
  }

  function mezatTik() {
    let degisti = false;
    for (const m of MEZAT.values()) {
      if (m.status !== 'active' || m.endsAt > simdi()) continue;
      degisti = true;
      if (m.bidCount > 0 && m.topBidderCharId != null) {
        m.status = 'ended_sold';
        m.finalPrice = m.currentBid;
        saticiyaOde(m);        // madde 44: gelir ANINDA hesap bankasina
        mezatBildirim(m.topBidderCharId, {
          kind: 'won', auctionId: m.id, itemDefId: m.item.itemId, amount: m.currentBid,
        });
        mezatBildirim(m.sellerCharId, {
          kind: 'sold', auctionId: m.id, itemDefId: m.item.itemId, amount: m.currentBid,
        });
      } else {
        m.status = 'ended_unsold';
        mezatBildirim(m.sellerCharId, {
          kind: 'expired', auctionId: m.id, itemDefId: m.item.itemId,
        });
      }
      mezatKaydet(m);
    }
    /* Tamamen kapanmis kayitlari bellekten dusur (DB'de `claimed=1` olarak
       kaliyor). Aksi halde MEZAT haritasi sinirsiz buyur. */
    for (const [id, m] of MEZAT) {
      const bitti = m.status !== 'active' && m.esyaAlindi
        && (m.status !== 'ended_sold' || m.altinAlindi);
      if (bitti) { MEZAT.delete(id); degisti = true; }
    }
    if (degisti) abonelereYayin();
  }

  // --------------------------------------------------------- mezat kaliciligi
  function mezatKaydet(m) {
    if (!web) return;
    sorgu(
      `MERGE dbo.WebAuction AS t USING (SELECT @id AS id) AS s ON t.id = s.id
       WHEN MATCHED THEN UPDATE SET currentBid=@cb, bidCount=@bc, topBidderJID=@tb,
                                    endsAt=@ea, status=@st, finalPrice=@fp, claimed=@cl,
                                    itemJson=@ij
       WHEN NOT MATCHED THEN INSERT (id, sellerJID, sellerName, itemJson, startPrice,
                                     buyNowPrice, currentBid, bidCount, topBidderJID,
                                     endsAt, status, finalPrice, claimed)
                             VALUES (@id, @sj, @sn, @ij, @sp, @bn, @cb, @bc, @tb,
                                     @ea, @st, @fp, @cl);`,
      {
        id: m.id,
        sj: Number(m.sellerCharId) || 0,
        sn: m.sellerName,
        /* PARCALI TESLIM BAYRAKLARI itemJson icinde tasiniyor.
           WebAuction'da tek bir `claimed` BIT var (setup_web_schema.mjs @121)
           ama satilan bir mezatta IKI ayri teslim var: satici ALTINI,
           kazanan ESYAYI alir. Eskiden yeniden baslatmada ikisi de false'a
           donuyordu -> altinini almis satici AYNI altini TEKRAR alabiliyordu
           (altin cogaltma). Sema dosyasini degistiremedigimiz icin bayraklari
           bu modulun kendi JSON blobuna yaziyoruz; eski bicim de okunuyor. */
        ij: JSON.stringify({ item: m.item, esyaAlindi: !!m.esyaAlindi, altinAlindi: !!m.altinAlindi }),
        sp: m.startPrice, bn: m.buyNowPrice,
        cb: m.currentBid, bc: m.bidCount,
        tb: m.topBidderCharId == null ? null : (Number(m.topBidderCharId) || null),
        ea: new Date(m.endsAt),
        st: m.status,
        fp: m.finalPrice,
        cl: (m.esyaAlindi && (m.status !== 'ended_sold' || m.altinAlindi)) ? 1 : 0,
      }).catch(dbHata('mezat kaydi'));
  }
  function mezatTeklifKaydet(m, charId, miktar) {
    if (!web) return;
    sorgu(`INSERT INTO dbo.WebAuctionBid (auctionId, JID, amount, at)
           VALUES (@a, @j, @m, GETDATE())`,
      { a: m.id, j: Number(charId) || 0, m: miktar }).catch(dbHata('teklif kaydi'));
  }
  function mezatYukle() {
    if (!web) return;
    sorgu(`SELECT id, sellerJID, sellerName, itemJson, startPrice, buyNowPrice,
                  currentBid, bidCount, topBidderJID, endsAt, status, finalPrice, claimed
             FROM dbo.WebAuction WHERE claimed = 0`)
      .then((r) => {
        for (const s of r?.recordset ?? []) {
          let blob = null;
          try { blob = JSON.parse(s.itemJson); } catch { continue; }
          /* Iki bicim: ESKI = dogrudan esya yigini (S$), YENI = sarmalayici
             {item, esyaAlindi, altinAlindi}. Parcali teslim bayraklarinin
             neden burada oldugu mezatKaydet()'te anlatiliyor. */
          const sarmal = blob && !blob.itemId && blob.item;
          const item = sarmal ? blob.item : blob;
          const esyaAlindi = sarmal ? !!blob.esyaAlindi : false;
          const altinAlindi = sarmal ? !!blob.altinAlindi : false;
          if (!item?.itemId) continue;
          const id = String(s.id).toLowerCase();
          MEZAT.set(id, {
            id,
            sellerCharId: String(s.sellerJID),
            sellerName: String(s.sellerName ?? ''),
            item,
            startPrice: tamsayi(s.startPrice, 1),
            buyNowPrice: tamsayi(s.buyNowPrice, 2),
            currentBid: tamsayi(s.currentBid, 0),
            bidCount: tamsayi(s.bidCount, 0),
            topBidderCharId: s.topBidderJID == null ? null : String(s.topBidderJID),
            endsAt: zamanaCevir(s.endsAt) ?? simdi(),
            status: String(s.status),
            finalPrice: s.finalPrice == null ? null : tamsayi(s.finalPrice, 0),
            esyaAlindi, altinAlindi,
            teklifVerenler: new Set(),
          });
        }
        /* MADDE 44 - ODENMEMIS SATIS KURTARMA. Odeme artik satis ANINDA
           yapiliyor; sunucu tam o iki satirin arasinda durursa (ya da eski
           surumden gecis yapiliyorsa) DB'de `ended_sold` + altinAlindi=false
           bir kayit kalir ve mezatTik yalniz `active` kayitlara baktigi icin
           bu para bir daha ASLA odenmezdi. Yuklemede bir kez telafi ediliyor;
           altinAlindi bayragi cift odemeyi zaten engelliyor. */
        for (const m of MEZAT.values()) {
          if (m.status !== 'ended_sold' || m.altinAlindi) continue;
          saticiyaOde(m);
          mezatKaydet(m);
          log(`mezat: odenmemis satis telafi edildi (${m.id}, ${m.finalPrice} altin)`);
        }
        log(`mezat: ${MEZAT.size} acik kayit yuklendi`);
      })
      .catch(dbHata('mezat yukleme'));
  }

  function mezatOp(ws, d) {
    switch (d?.op) {
      case 'sub':
        MEZAT_ABONE.add(ws);
        ws.__ks_mezatSayfa = 0;
        mezatListesi(ws, 0);
        mezatBenim(ws);
        return true;
      case 'unsub':
        MEZAT_ABONE.delete(ws);
        return true;
      case 'list': {
        const p = kirp(tamsayi(d.page, 0), 0, 9999);
        ws.__ks_mezatSayfa = p;
        mezatListesi(ws, p);
        return true;
      }
      case 'create': return mezatOlustur(ws, d);
      case 'bid':    return mezatTeklif(ws, d);
      case 'buyNow': return mezatHemenAl(ws, d);
      case 'cancel': return mezatIptal(ws, d);
      case 'claim':  return mezatAl(ws, d);
      default:       return hata(ws, HATA.DOGRULAMA);
    }
  }

  // ==========================================================================
  // 6) mall.buy (119)
  // ==========================================================================
  function mallAl(ws, d) {
    const itemId = String(d?.itemId ?? '');
    if (!itemId) return hata(ws, HATA.DOGRULAMA);
    const jade = MALL_FIYAT.get(itemId);
    if (!Number.isFinite(jade)) return hata(ws, HATA.BULUNAMADI);
    const def = esyaTanim(itemId);
    if (!def) return hata(ws, HATA.BULUNAMADI);
    /* items.json itemMall.$comment: "must not be gear (mall grants don't roll
       instance stats)" - katalog bozulursa sessizce ekipman uretmeyelim. */
    if (ekipmanMi(def)) return hata(ws, HATA.DOGRULAMA);
    /* SARTNAME-1 MADDE 11 — OLU URUNE SILK HARCATMA kapisi. Canta sapmasi
       (herkes 12 sayfa/384 yuva ile basliyor, sartname-3 madde 10) yuzunden inventory_expansion
       (type bagExpand) KULLANIMDA hep err.expand.max donuyor ve esya
       tuketilmiyor (sistem_banka-depo.js:998) - ama satin alma kapisizdi:
       oyuncu 150 Silk'i gercekten kaybediyordu. Tavandayken odeme dusulmeden
       REDDET; canta tavanin altindaysa (sapma geri alinirsa) urun yeniden
       anlamlidir ve kapi kendiliginden acilir. storage_expansion
       (storageExpand) ve carrier_expansion (carrierExpand) ETKILENMEZ. */
    if (def.type === 'bagExpand' && canta(ws.char).length >= CANTA_MAX_YUVA) {
      return hata(ws, HATA.DOGRULAMA, ANAHTAR.GENIS_MAX);
    }
    /* SARTNAME-2 MADDE 6 — adetli teslim: katalogda qty yoksa 1 (bugunku
       36 kalemin tamami boyle -> davranis birebir ayni). yerlestirmePlani
       N adedi stackMax'lik parcalara zaten kendisi boler. */
    const adet = MALL_ADET.get(itemId) ?? 1;
    /* DIKKAT: on-plan ve odeme sonrasi gercek plan AYNI adedi kullanmali -
       biri 1'de unutulursa her denemede cuzdan dus + iade dongusu olusur. */
    if (!yerlestirmePlani(canta(ws.char), def, adet)) return hata(ws, HATA.CANTA);
    if (!web) return hata(ws, HATA.JADE);           // cuzdan yoksa BEDAVA vermeyiz
    if (ws.__ks_cuzdanMesgul) return hata(ws, HATA.MESGUL);
    ws.__ks_cuzdanMesgul = true;

    (async () => {
      const birim = jade * JADE_BIRIM;
      const oldu = await cuzdanDus(ws.user?.JID, birim);
      if (!oldu) { hata(ws, HATA.JADE); return; }
      const plan = yerlestirmePlani(canta(ws.char), def, adet);
      if (!plan) { await cuzdanIade(ws.user?.JID, birim); hata(ws, HATA.CANTA); return; }
      planiUygula(canta(ws.char), def, plan);
      envanteriYolla(ws);
      bildir(ws, 'sys.mall.bought', { item: def.name ?? def.id, jade });
    })()
      .catch((e) => { dbHata('mall.buy')(e); hata(ws, HATA.DOGRULAMA); })
      .finally(() => { ws.__ks_cuzdanMesgul = false; });
    return true;
  }

  // ==========================================================================
  // 7) premium.buy (120)
  // ==========================================================================
  function premiumAl(ws, d) {
    const tier = String(d?.tier ?? '');
    const kat = PREMIUM_KATALOG.get(tier);
    if (!kat) return hata(ws, HATA.DOGRULAMA);
    if (!web) return hata(ws, HATA.JADE);
    if (ws.__ks_cuzdanMesgul) return hata(ws, HATA.MESGUL);
    ws.__ks_cuzdanMesgul = true;

    (async () => {
      const birim = tamsayi(kat.priceJade, 0) * JADE_BIRIM;
      const oldu = await cuzdanDus(ws.user?.JID, birim);
      if (!oldu) { hata(ws, HATA.JADE); return; }
      let satir = null;
      try {
        const r = await yordam('WebSetPremium', {
          JID: ws.user?.JID, Tier: tier, Days: tamsayi(kat.durationDays, 30),
        });
        satir = r?.recordset?.[0] ?? null;
      } catch (e) {
        await cuzdanIade(ws.user?.JID, birim);
        dbHata('premium.buy')(e);
        hata(ws, HATA.DOGRULAMA);
        return;
      }
      const exp = zamanaCevir(satir?.expiresAt);
      PREMIUM.set(ws.user?.JID, { tier: satir?.tier ?? tier, expiresAt: exp });
      for (const p of hesapSoketleri(ws.user?.JID)) premiumYolla(p);
      bildir(ws, 'sys.premium.activated', {
        tier: kat.label ?? tier, days: tamsayi(kat.durationDays, 30),
      });
    })()
      .catch((e) => { dbHata('premium.buy')(e); hata(ws, HATA.DOGRULAMA); })
      .finally(() => { ws.__ks_cuzdanMesgul = false; });
    return true;
  }

  // ==========================================================================
  // ZAMANLAYICI
  // ==========================================================================
  uniqueKur();
  mezatYukle();

  const zamanlayici = setInterval(() => {
    try {
      uniqueTik();
      carrierTik();
      mezatTik();
      premiumSureTik();
      regenBoostTik();     // YAN BULGU 1: buff/pasif regen bonusu (1 sn ritmi)
      // suresi dolan dirilis teklifleri
      for (const [id, t] of DIRILIS) if (t.expiresAt <= simdi()) DIRILIS.delete(id);
      if (simdi() - sonUniqueYayin >= UNIQUE_PERIYOT) {
        sonUniqueYayin = simdi();
        /* KIRIKLIK ONARIMI (butunlestirme): sistem_dirilis-unique kuruluysa
           CANLI unique sayaclarini o yayinliyor (kendi 60 sn tiki + zone.ready
           dali) - buradaki eski uretici SUSAR, yoksa istemciye ayni tikte IKI
           unique.timers gidiyordu (test_giris-kareleri_moduller x2 tespiti). */
        if (!sistemOrnegi?.('dirilis-unique')) {
          const kare = uniqueTimersPayload();
          for (const ws of tumOyuncular()) frame(ws, 'unique.timers', kare);
        }
      }
    } catch (e) {
      log('kucuk-sistemler tik hatasi:', String(e?.message ?? e).slice(0, 160));
    }
  }, 1000);
  if (typeof zamanlayici.unref === 'function') zamanlayici.unref();

  log(`kucuk-sistemler: ${itemsJsonSayisi} esya, ${MALL_FIYAT.size} mall kalemi, `
    + `${PREMIUM_KATALOG.size} premium kademesi, ${UNIQUE.size} unique, `
    + `${KURE.size} tasiyici kuresi, ${DUKKAN_STOK.size} dukkan stogu`);

  // ==========================================================================
  const ORNEK = {
    mesaj(ws, t, d) {
      if (!ws?.isAuthed || !ws.char) return false;
      oturumHazirla(ws);
      /* zone.ready istemcinin "sahne hazir" isareti: sayaclar ve tasiyici
         durumu ilk kez BURADA gonderilir (istemci baska yerden okumuyor). */
      if (t === 'zone.ready') {
        /* dirilis-unique kuruluysa unique.timers'i O gonderir (yukaridaki
           KIRIKLIK ONARIMI notu) - cift kare olmasin. */
        if (!sistemOrnegi?.('dirilis-unique')) {
          frame(ws, 'unique.timers', uniqueTimersPayload());
        }
        frame(ws, 'carrier.state', carrierPayload(ws.char));
        /* Sahne hazir = zone.init varliklari istemcide OLUSTU. entity.premium
           ancak bu andan sonra tutar (applyPremium bilinmeyen id'yi atar),
           bu yuzden akran rozetleri tam burada yollanir. Bolge degistirince
           zone.ready yeniden gelir; yeni bolgenin akranlari da boyle gelir. */
        premiumAkranlariYolla(ws);
        return false;         // zone.ready'i cekirdek sunucu da islemeli
      }
      try {
        switch (t) {
          case 'chat.whisper':   return fisilda(ws, d);
          /* SARTNAME-2 MADDE 5 — `case 'revive.respond'` ve `case 'unique.op'`
             BILEREK KALDIRILDI (dosya sonundaki 3b notunun ve
             dirilis-unique.js:1438-1444 notunun onerdigi cozum). Eski hal
             ACGOZLUYDU: buradaki dirilisCevabi kendi (bos) DIRILIS haritasinda
             olmayan HER teklife unknown_offer basip true donuyordu; SISTEM_
             ADLARI'nda onde oldugumuz icin sistem_dirilis-unique'in BECERI
             dirilisi ve sistem_yerinde-dirilis'in teklifleri hic kabul
             edilemiyordu (olcum: curutme_revive_dispatch.mjs). Artik iki mesaj
             da default -> false ile yonlendiriciye birakilir; gercekten
             bilinmeyen offerId'ye unknown_offer cevabini son siradaki
             sistem_dirilis-unique verir (dirilis-unique.js:1231) - istemciye
             cevapsiz kare kalmaz. ON KOSUL: dirilis-unique SISTEM_ADLARI'nda
             yuklu kalmali (server.js). */
          case 'carrier.op':
            if (d?.op === 'confirm')    return carrierSiparis(ws, d);
            if (d?.op === 'collect')    return carrierTopla(ws, d, false);
            if (d?.op === 'collectAll') return carrierTopla(ws, d, true);
            return hata(ws, HATA.DOGRULAMA);
          /* madde 56: `carrierExpand` dali. bagExpand/storageExpand'i
             sistem_banka-depo zaten isliyor ve carrierExpand icin false
             donuyor - mesaj bu yuzden buraya kadar geliyor. */
          case 'item.expand':    return carrierGenisletme(ws, d);
          case 'auction.op':     return mezatOp(ws, d);
          case 'mall.buy':       return mallAl(ws, d);
          case 'premium.buy':    return premiumAl(ws, d);
          default:               return false;
        }
      } catch (e) {
        log('kucuk-sistemler hatasi:', t, String(e?.message ?? e).slice(0, 160));
        return hata(ws, HATA.DOGRULAMA);
      }
    },

    /** Baglanti kopunca cagrilmali (abonelik sizintisini onler). */
    ayril(ws) {
      MEZAT_ABONE.delete(ws);
      for (const [id, tk] of DIRILIS) {
        if (String(tk.charId) === String(ws.char?.id)) DIRILIS.delete(id);
      }
      /* MADDE 2: defterler modul kapsamina tasindi (madde 1); artik yeniden
         kurulumda KENDILIGINDEN temizlenmiyorlar (o kazara bir cop
         toplamaydi). Cikista ELLE bosalt, yoksa sunucu omru boyunca sizar.
         Guvenli, cunku kaynak DB: PREMIUM -> WebPremium (yukle /
         oturumHazirla / premiumAl), CARRIER -> carrierYukle().
         BEKLEYEN_ALTIN'a ASLA DOKUNMA: o bekleyen bir ALACAK, oturumla
         bitmez.

         SARTNAME-1 MADDE 10 — ES-SOKET KAPISI (kick yarisi, olcum:
         GERCEK/denetim/curutme_premium_ayril.mjs): login_elsewhere kick'inde
         YENI soketin PREMIUM.set'i kick dongusunden ONCE bitiyor, eski soket
         >=200ms sonra kapaniyor -> kosulsuz delete YENI oturumun kaydini da
         ucuruyordu (~1-2 sn err.premium.required penceresi, premiumSureTik
         telafi edene kadar). Cozum: ayni hesabin BASKA acik soketi varsa
         defter kaydi BIRAKILIR. Ayni yaris CARRIER'i da vurur ama CARRIER
         CHAR bazli (iki soket ayni char id'yi tasir) - JID filtresi yetmez,
         char id taramasi gerekir. Normal cikista WORLDSIM.oyuncuCik ayril'dan
         once calistigi icin `p !== ws` filtresi zararsiz emniyettir.
         BILINEN DAR PENCERE: bolge gecisinin tam ortasindaki es-soket
         hesapSoketleri'nde gorunmeyebilir -> silme yine olur ve
         premiumSureTik ~1 sn'de DB'den telafi eder (veri kaybi yok). */
      const jid = ws?.user?.JID;
      if (Number.isFinite(jid)) {
        const kalan = hesapSoketleri(jid).filter((p) => p !== ws);
        if (kalan.length === 0) PREMIUM.delete(jid);
      }
      if (ws?.char?.id != null) {
        const cid = String(ws.char.id);
        let ayniChar = false;
        for (const p of tumOyuncular()) {
          if (p !== ws && String(p.char.id) === cid) { ayniChar = true; break; }
        }
        if (!ayniChar) CARRIER.delete(cid);
      }
    },

    // --- cekirdek kancalari ---
    /** server.js modulleriYukle(ch) - zone.init'ten ONCE (premium + tasiyici). */
    yukle,
    /** selfPayload'a yayilir: premiumTier / premiumExpiresAt. */
    selfAlanlari,
    /** entityPayload'a yayilir: premiumTier rozeti. */
    varlikAlanlari,

    // --- diger sistemlerin cagirdigi API ---
    dirilisTeklifi,
    carrierGenislet,
    premiumTier: (ws) => premiumDurum(ws)?.tier ?? null,
    /* MADDE 9: premium XP/SP bonusu icin TEK erisim noktasi.
       items.json premium.$comment (paket @9299885): "xpSpBonusPct is the
       additive % boost to XP and SP from monster kills". Kademe degerleri
       paketten: bronze 10 (@9300246) / silver 15 (@9300566) / gold 20
       (@9300882); tr.json: label:premium:gold.feature.0 = "Avdan +%20 XP ve
       SP". premiumDurum() suresi dolmus/eksik kademeye null doner ->
       otomatik 0. Cagiranlar (madde 10-13): combat.odul(mob, ch, pct). */
    premiumBonusPct: (ws) =>
      Number(PREMIUM_KATALOG.get(premiumDurum(ws)?.tier)?.xpSpBonusPct) || 0,

    // --- test / tani icin ---
    _unique: () => UNIQUE,
    _uniqueTimers: uniqueTimersPayload,
    _uniqueTik: uniqueTik,
    _carrier: (ch) => carrierDurum(ch),
    _carrierPayload: carrierPayload,
    _carrierTik: carrierTik,
    _mezat: () => MEZAT,
    _mezatTik: mezatTik,
    _asgariTeklif: asgariTeklif,
    _esya: esyaTanim,
    _mallFiyat: (id) => MALL_FIYAT.get(id) ?? null,
    _premiumKatalog: () => PREMIUM_KATALOG,
    _premiumAyarla: (JID, tier, expiresAt) => {
      PREMIUM.set(JID, { tier, expiresAt });
      /* D5-A madde 4: cevrimici karakterlerin aynasi da tazelensin. */
      for (const p of hesapSoketleri(JID)) premiumKaraktereYansit(p.char, JID);
    },
    _premium: () => PREMIUM,
    _premiumSureTik: premiumSureTik,
    _regenBoostTik: regenBoostTik,
    _bekleyenAltin: () => BEKLEYEN_ALTIN,
    _kure: () => KURE,
    _durdur: () => clearInterval(zamanlayici),
  };
  ONCEKI_ORNEK = ORNEK;
  return ORNEK;
}

/* ===========================================================================
 * BAGLAMA NOTU  (server.js icin)
 * ---------------------------------------------------------------------------
 *  1) SISTEM_ADLARI dizisine 'kucuk-sistemler' eklenir (ana oturum yapar).
 *     Modul ctx'ten SU ANDA kullanilanlar:
 *       world (zoneState / mobDefs / varlikEkle / varlikSil / varlik /
 *              yeniVarlikId / groundY / dataDir), frame, broadcast, log,
 *       GCFG, ITEMSTATS, envanterPayload, derived, web, SHARD,
 *       combat (YALNIZ .regen getter'i - regenBoostTik, YAN BULGU 1),
 *       sistemOrnegi ('dirilis-unique' kapisi + 'beceri' mod kaynagi)
 *     KULLANILMAYAN: zoneGroundY, yurunebilirNokta
 *
 *  2) `web` SU AN server.js icinde null geciyor (satir 668). Bu modul o halde
 *     de calisir ama:
 *       - mall.buy / premium.buy  -> ERR_NO_JADE (bedava esya VERMEZ)
 *       - mezat / tasiyici / premium kaliciligi yok (bellekte)
 *       - seviye panosu yalnizca CEVRIMICI oyunculardan kurulur
 *     webPool baglaninca yukaridakiler kendiliginden gercek veriye doner.
 *
 *  3) Baglanti kapanisinda (ws.on('close')) `ayril(ws)` cagrilmali:
 *       for (const s of SISTEMLER) s.ornek.ayril?.(ws);
 *     server.js SU AN bunu CAGIRMIYOR -> MEZAT_ABONE kumesi kopan soketleri
 *     tutar (abonelereYayin ilk yayinda temizliyor, yine de eklenmeli).
 *
 *  3b) CAKISMA UYARISI — sistem_dirilis-unique.js
 *     O modul de `revive.respond` (85) ve `unique.op` (93) isliyor VE kendi
 *     unique zamanlayicisi + world.varlikEkle cagrisiyla unique DOGURUYOR.
 *     Ikisi birden SISTEM_ADLARI'na eklenirse:
 *       - unique'ler CIFT dogar (yonlendirme sirasi bunu ENGELLEMEZ; dogum
 *         mesajdan bagimsiz, kendi setInterval'inde olur),
 *       - sys.unique.spawned/defeated duyurulari cift gider,
 *       - `dirilisTeklifi` iki ayri teklif tablosu olusur, skill.cast
 *         hangisini cagirirsa digerinin revive.respond'u "unknown_offer" der.
 *     IKISINDEN BIRI secilmeli. sistem_dirilis-unique.js ayrica `skill.cast`
 *     sahibi oldugundan dirilis+unique'i ONA birakmak daha tutarli; o durumda
 *     buradaki `revive.respond`/`unique.op` case'leri ve uniqueKur() cagrisi
 *     kaldirilmali. Bu modul TEK BASINA da calisir - karar ana oturumun.
 *
 *     [SARTNAME-2 MADDE 5 GUNCELLEMESI] Karar verildi ve UYGULANDI:
 *     `revive.respond`/`unique.op` case'leri mesaj switch'inden KALDIRILDI
 *     (dirilis+unique dagitimi artik dirilis-unique'te). uniqueKur() ve bu
 *     moduldeki unique zamanlayicisi YEDEK olarak DURUYOR; unique.timers
 *     yayini zaten sistemOrnegi('dirilis-unique') kapisiyla susturuluyordu
 *     (KIRIKLIK ONARIMI notu).
 *     [EK DUZELTME A GUNCELLEMESI 2026-09-04] Dogum tarafi da AYNI kapiyla
 *     susturuldu (uniqueTik basindaki erken donus): dirilis-unique kuruluyken
 *     bu modul unique DOGURMAZ/OLDURMEZ/DUYURMAZ - cift dogum ve cift
 *     sys.unique.spawned kaynagi kapandi. dirilis-unique yokken motor
 *     eskisi gibi tek basina calisir.
 *
 *  3c) YENIDEN KURMA guvenli: server.js @216 admin ayar degisikliginde
 *     sistemleriKur(true) ile kur() tekrar cagriliyor. Modul, onceki ornegin
 *     zamanlayicisini `ONCEKI_ORNEK` uzerinden kendisi durduruyor (dosya
 *     basindaki nota bak) - server.js'in bir sey yapmasi GEREKMEZ.
 *
 *  4) DIGER SISTEMLERIN CAGIRACAGI API:
 *       dirilisTeklifi({hedef, caster, skillId, hpPct, mpPct, sureMs})
 *         -> dirilis becerisi (skill.cast sahibi) cagirir; revive.offer yollar.
 *       carrierGenislet(ws)
 *         -> `carrier_expansion` esyasi. ARTIK bu modulun KENDI `item.expand`
 *            (126) dali cagiriyor (madde 56); disa acik kalmasinin sebebi
 *            baska bir yolun (or. GM komutu) da genisletebilmesi. Tavan
 *            12 + 5*4 = 32 (paket @27394825), asilirsa 0 doner ve esya
 *            TUKETILMEZ.
 *       premiumTier(ws)
 *         -> kademe adi (tasiyici/taction kapilari icin).
 *       premiumBonusPct(ws)  [MADDE 9]
 *         -> XP/SP bonus YUZDESI (premium.json xpSpBonusPct: bronze 10 /
 *            silver 15 / gold 20, paket @9299885). combat.odul(mob, ch, pct)
 *            cagrilarina gecirilir (madde 10-13). Ayrica premium kademesi
 *            KARAKTERE de yansitilir: ch.premiumTier / ch.premiumExpiresAt
 *            (D5-C bonusu ch.premiumTier uzerinden de okuyabilir).
 *
 * ---------------------------------------------------------------------------
 * BILEREK YAPILMAYANLAR (uydurmamak icin)
 * ---------------------------------------------------------------------------
 *  - carrier.state.birdEntityId : opsiyonel alan; kus icin modelKey/varlik
 *    tanimi hicbir veri dosyasinda YOK, uydurma model gondermiyoruz.
 *  - exch.wallet (177) : mall alisverisinden sonra bakiye tazelemek isterdik
 *    ama semada `gold` = HESAP BANKASI altini ve o bu modulun verisi degil;
 *    yanlis deger gondermek borsa penceresini bozardi.
 *    NOT (madde 44): MEZAT parasi icin bu boslugu artik banka modulu kapatiyor
 *    - ctx.sistemOrnegi('banka-depo').bankayaAltinEkle(JID, m, soketler)
 *    hem _AccountJID.Gold'u yaziyor hem exch.wallet karesini o hesabin acik
 *    soketlerine kendisi gonderiyor. Karesi hala BU modulden CIKMIYOR.
 *  - unique bands / maxAdds (uniques.json) : unique'in HP esiklerinde yardimci
 *    cagirma merdiveni beceri sistemi isi; burada dogum/olum/zamanlayici var,
 *    beceri merdiveni YOK.
 *  - unique.board `points` : WebUniqueKill'de puan sutunu YOK. Tek gercek
 *    olcut OLDURME SAYISI; points = oldurme sayisi olarak veriliyor.
 *  - profession panosu : zanaat seviyesi icin sunucuda hicbir kaynak yok
 *    -> bos liste (istemci "ui.ranking.empty_profession" gosterir).
 *
 * ---------------------------------------------------------------------------
 * ISTEMCI TARAFI BOSLUGU (bizim degil, paketin)
 * ---------------------------------------------------------------------------
 *  ERR_NO_JADE kodu Sht listesinde VAR ama locales/tr.json'da `err.ERR_NO_JADE`
 *  satiri YOK -> istemci bu hatayi sessizce yutar (yalnizca console.warn).
 *  Kendi anahtarimizi UYDURMUYORUZ; Eht listesinde Silk hatasi yok. Item Mall
 *  penceresi zaten kendi bakiye kontrolunde "ui.mall.not_enough_jade" gosteriyor.
 *  Ayni durum ERR_DEAD icin de gecerli (bu modulde kullanilmiyor).
 * =========================================================================== */
