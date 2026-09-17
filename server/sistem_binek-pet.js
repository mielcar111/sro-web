/**
 * BINEK (mount) + EVCIL HAYVAN (pet) + GELISIM PETI (growth pet) sistemi.
 *
 * ============================ SEMALARIN KAYNAGI ============================
 * Hepsi okunabilir istemci paketinden BIREBIR alindi:
 *   playjs_source\index-BUMMQVRB.js
 *
 * --- c2s (bizim isledigimiz 8 mesaj) ------------------------------- @25611433
 *   T$(`pet.summon`,     65, X({ bagSlot: Y().int().min(0).max(159),
 *                                settings: y$.optional() }), `inv`)
 *   T$(`pet.dismiss`,    66, X({}), `misc`)
 *   T$(`pet.settings`,   67, y$, `misc`)
 *   T$(`gpet.summon`,    73, X({ bagSlot: Y().int().min(0).max(159) }), `inv`)
 *   T$(`gpet.dismiss`,   74, X({}), `misc`)
 *   T$(`gpet.command`,   75, HJ(`op`, [ X({op:JJ(`attack`), targetId:Y().int()}),
 *                                       X({op:JJ(`follow`)}),
 *                                       X({op:JJ(`mode`), mode: tht}) ]), `misc`)
 *   T$(`mount.use`,      69, X({ bagSlot: Y().int().min(0).max(159) }), `inv`)
 *   T$(`mount.dismount`, 70, X({}), `misc`)
 *
 *   y$  = X({ grab: RJ(), scope: qJ([`own`,`all`]),                    @25592996
 *             gold: RJ(), equipment: RJ(), other: RJ() })
 *   tht = qJ([`offensive`, `defensive`])                               @25593295
 *
 * --- s2c (bizim gonderdigimiz kareler) ----------------------------- @25625782
 *   T$(`pet.state`,  161, eht)                                        @25593113
 *     eht = X({ active: RJ(), petId: J().optional(), entityId: Y().int().optional(),
 *               bagSlot: Y().int().optional(), expiresAt: Y().optional(),
 *               settings: y$ })
 *   T$(`gpet.state`, 214, nht)                                        @25593335
 *     nht = X({ active: RJ(), petId, entityId, bagSlot, level, xp,
 *               xpToNext: Y().int().nullable().optional(), hp, maxHp,
 *               hgp, hgpMax, dead: RJ().optional(), mode: tht.optional() })
 *   T$(`mount.update`, 173, X({ id: Y().int(),                        @25626000
 *               mount: X({ modelKey: J(), hp: Y().int(),
 *                          maxHp: Y().int() }).nullable() }))
 *
 *   Varlik semasi $mt kind enum'u: [`player`,`monster`,`npc`,`ground_item`,
 *   `pet`,`growth_pet`]  (@25590953) - pet GERCEK bir dunya varligidir,
 *   oyuncunun uzerinde bir alan degildir. Binek ise TERSI: oyuncu varliginin
 *   `mount:{modelKey,hp,maxHp}` alanidir (@25591902).
 *
 * --- istemci isleyicileri -------------------------------------------------
 *   W$.on(`pet.state`,  e => E8.getState().setServerState(e))         @27124020
 *   W$.on(`gpet.state`, e => y8.getState().setServerState(e))         @27124097
 *   W$.on(`mount.update`, n => { Q.applyMount(n);                     @27127676
 *                                n.id === Q.selfId && A$.getState().set(n.mount) })
 *   pet penceresi varsayilan ayar dAt = {grab:!0, scope:`own`,        @27047546
 *                                        gold:!0, equipment:!0, other:!0}
 *   gpet penceresi: hgp <= 3e3 ise saldiri degerleri YARIYA iner      @27398092
 *                   (= growthPets.hgpLowFrac 0.3 * hgpMax 10000)
 *   esya ipucu: item.rolls.petExpiresAt / petLevel / petXp /          @27243574
 *               petHp / petHgp / petDead   ve  H7.xpToNext(level)
 *               => GELISIM PETI OYUNCUYLA AYNI xpToNext TABLOSUNU kullanir.
 *
 * ============================ SAYILARIN KAYNAGI ============================
 *   data/game-config.json : petDetectRadiusU 50, petCatchupU 45, petFollowU 2.5,
 *                           petFollowStartU 8, petPickMs 500, petSummonReqLevel 5,
 *                           petCombatLockoutMs 20000, petXpRate 1,
 *                           growthPets{hgpMax 10000, hgpDrainPerSec 1,
 *                                      hgpLowFrac 0.3, xpShareFrac 1,
 *                                      reviveHpFrac 0.25},
 *                           pickupRangeU 3, bagSlots 32
 *   data/mounts.json      : speedU 13.5 / 14.25 / 15.75, maxHp, reqLevel
 *   data/pets.json        : walkSpeedU 7.5, runSpeedU 18
 *   data/growth-pets.json : 80 seviyelik tam istatistik tablosu, swingMs 1566
 *   data/itemstats.json   : type mount/petScroll/growthPetFlute,
 *                           mountId/petId/growthPetId, reqLevel, lifetimeMs
 *   data/combat.json      : pets.growthAttackRateH 1.04, pets.lowHgpFactor 0.5,
 *                           damageScale.petVsMonster 100, levelGap, crit, parry,
 *                           rollShape, minDamage
 *   data/safe-areas.json  : istemci bolge verisinden cikarilmis sehir kutulari
 *                           (err.mount.town icin)
 *   data/progress.json    : xpToNext (gelisim peti de bunu kullanir)
 *
 * TEK ODUNC SABIT: mount.use icin "savastan sonra bekleme suresi" paketin
 * hicbir yerinde YOK. err.mount.combat metni boyle bir pencere oldugunu
 * soyluyor; game-config'deki TEK savas kilidi petCombatLockoutMs (20000) -
 * onu kullaniyoruz. Asagida SAVAS_KILIDI_MS olarak tek yerde isaretli.
 *
 * ============================ LOCALE ANAHTARLARI ==========================
 * Hepsi client/assets/locales/tr.json icinde GERCEKTEN var (dogrulandi):
 *   sys.notice : sys.mount.died, sys.pets.rental_expired, sys.pets.grab_off,
 *                sys.gpet.hungry, sys.gpet.starved, sys.gpet.xp,
 *                sys.gpet.level_up, sys.loot.gold, sys.loot.picked_up,
 *                sys.progress.xp, sys.progress.level_up
 *   err.key    : err.mount.mounted, err.mount.not_mounted, err.mount.level,
 *                err.mount.town, err.mount.combat, err.pet.unsummon_first,
 *                err.gpet.unsummon_first, err.gpet.dead, err.gpet.dead_revive,
 *                err.gpet.dead_no_dismiss, err.gpet.in_combat,
 *                err.gpet.no_dead, err.gpet.mount_invalid
 *   err.code   : Sht enum'undan (ERR_PET_STATE, ERR_PET_COMBAT, ERR_REQ_LEVEL,
 *                ERR_NOT_FOUND, ERR_VALIDATION, ERR_DEAD, ERR_BAG_FULL)
 *
 * ======================= DENETIM SONRASI DUZELTMELER ======================
 * (bagimsiz denetim; her biri test_binek-pet.mjs 4B/4C bolumlerinde pinlendi)
 *  1. `combatConfig.pets.growthAttackRateH` (1.04) vurus TEMPOSUNU bolen sayi
 *     olarak kullaniliyordu. combat.json kendi yorumunda "growth-pet
 *     default-skill WEAPON COEFFICIENT (H stage)" diyor; combat.js silah
 *     katsayisini savunma dusuldukten SONRA hasara carpiyor. Duzeltildi:
 *     tempo = growth-pets.json swingMs (1566), katsayi = hasar carpani.
 *     (Ayrica temponun 200 ms alt siniri uydurmaydi - kaldirildi.)
 *  2. `pets.lowHgpFactor` (0.5) yalnizca ataga uygulaniyordu. combat.json
 *     yorumu "hungry growth pet's HIT RATIO and defenses", istemci gpet
 *     penceresi (@27398092) hgp<=3000 iken hitRatio/parry/def degerlerini de
 *     yariliyor, tr.json ui.gpet.low_hgp "savas degerleri yariya indi".
 *     Duzeltildi: isabet oranina da uygulaniyor.
 *  3. Savas kilidi (petCombatLockoutMs) yalnizca ZATEN binegi/peti olan
 *     oyuncular icin isliyordu; hic binmemis oyuncuda `_bpSonSavas` hic
 *     yazilmadigi icin pencere uygulanmiyordu. Damga artik her tikte tum
 *     authed oyuncular icin tutuluyor.
 *  4. Sahibi bolge degistirdiginde pet varligi ESKI bolgede kaliyordu
 *     (sizinti + varligiKaldir yanlis bolgeye gidiyordu). Kayitta `zoneId`
 *     tutuluyor ve `bolgeSenkron` varligi sahibin bolgesine tasiyor.
 *  5. Olu gelisim peti KILITLENIYORDU (dismiss ve summon ikisi de reddediyor,
 *     dirilis yolu yok; growthPets.reviveHpFrac hic kullanilmiyordu).
 *     `esyaKullan(ws, def, petTarget)` kancasi eklendi - inv.use(49)
 *     petTarget: qJ([`growth`,`mount`]) semasina gore petConsumable
 *     (revive/hgp/hp) isler.
 *  6. gpet.summon esya kaydindan HP okurken 0'i kabul ediyordu; olu pet
 *     `rolls.petHp = 0` yazdigi icin CANLI ama 0 HP'li pet dogabiliyordu.
 *     Taban 1'e cekildi.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bacakKur, bacakIlerlet, bacakDurdur } from './bacak.js';
/* Pet oldurmesinin ganimeti icin: dusen ekipmanin ORNEGI (plus/variance/dur)
   yerde uretilmeli - gameloop #ganimetDus / sistem_beceri ganimetDus ile ayni
   kural. Bkz. petGanimet asagida. */
import * as esya from './esya.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, 'data');

/** Dunya gorus mesafesi - world.js GORUS_MESAFESI ile AYNI olmali (120). */
const GORUS_U = 120;

/** KAYNAK YOK: mount.use savas kilidi. game-config'deki tek savas kilidi
 *  petCombatLockoutMs; kur() icinde oradan okunur, bulunamazsa 0 (kapali). */
let SAVAS_KILIDI_MS = 0;

/** Ag kisitlamasi (oyun kurali degil): sadece HGP degistiginde gpet.state'i
 *  bu araliktan sik gondermeyiz. Saniyede 1 HGP eridigi icin 1000 ms yeterli. */
const GPET_DURUM_ARALIK_MS = 1000;

/**
 * [DENETIM DUZELTMESI 7] Ayni surecte kur() BIRDEN FAZLA kez cagrilabilir:
 * server.js `sistemleriKur()` admin panelinden ayar degisince TUM modulleri
 * yeniden kuruyor. Onceki ornegin ic setInterval'i calismaya devam ederse ayni
 * pet iki kez tiklanir (cift HGP erimesi, cift vurus, cift takip) ve eski
 * ornegin dunya varliklari sahipsiz kalir. Bu yuzden yeni kurulum oncekini
 * kapatir.
 */
let ONCEKI_ORNEK = null;

/** Ekipman sayilan esya tipleri (itemstats.json `type` alanindan).
 *  Pet ayarindaki "equipment" (ui.pet.equipment) bunlari kapsar; geri kalan
 *  her sey "other" (ui.pet.other_items). Altin ayri bir kutu (ui.pet.gold). */
const EKIPMAN_TIPLERI = new Set(['weapon', 'shield', 'armor', 'accessory', 'avatar']);

function oku(ad) {
  const p = path.join(DATA, ad);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

/**
 * @param {object} ctx server.js'in gecirdigi baglam
 * @returns {{mesaj:Function, tik:Function, hiz:Function, binekte:Function,
 *            binekHasar:Function, petHasar:Function, xpPay:Function,
 *            girdi:Function, cikti:Function, durum:Function}}
 */
export function kur(ctx) {
  /* [DUZELTME 7] Onceki ornek varsa kapat: zamanlayicisini durdur ve
     dunyada birakacagi pet varliklarini toplat. */
  try { ONCEKI_ORNEK?.kapat?.(); } catch { /* onceki ornek zaten olu */ }

  const world = ctx.world;
  const combat = ctx.combat ?? null;
  const frame = ctx.frame;
  const broadcast = ctx.broadcast ?? (() => {});
  const log = ctx.log ?? (() => {});
  const GCFG = ctx.GCFG ?? oku('game-config.json') ?? {};
  const ITEMSTATS = ctx.ITEMSTATS ?? combat?.itemStats ?? new Map();
  const zoneGroundY = ctx.zoneGroundY ?? ((z, x, zz, y) => world?.groundY?.(z, x, zz, y) ?? 0);
  const yurunebilir = ctx.yurunebilirNokta ?? ((z, x0, z0, x1, z1) => ({ x: x1, z: z1 }));
  const envanterPayload = ctx.envanterPayload ?? null;
  const web = ctx.web ?? null;
  const derived = ctx.derived ?? null;
  /* Baska sistem modulunun ORNEK'ine ada gore erisim (server.js:1462).
     madde 13: hareket hizi buff'i (moveSpeedPct) sistem_beceri.js'te yasar;
     kanca yoksa null doner ve hiz() carpansiz calisir - davranis degismez. */
  const sistemOrnegi = ctx.sistemOrnegi ?? (() => null);

  // ------------------------------------------------------------- kataloglar
  const MOUNTS = new Map();
  for (const m of oku('mounts.json') ?? []) MOUNTS.set(m.id, m);
  const PETS = new Map();
  for (const p of oku('pets.json') ?? []) PETS.set(p.id, p);
  const GPETS = new Map();
  for (const g of oku('growth-pets.json') ?? []) GPETS.set(g.id, g);
  const SAFE = (oku('safe-areas.json') ?? {}).zones ?? {};

  // ------------------------------------------------------------- ayar sabitleri
  const G = {
    detect: Number(GCFG.petDetectRadiusU ?? 0),
    catchup: Number(GCFG.petCatchupU ?? 0),
    follow: Number(GCFG.petFollowU ?? 0),
    followStart: Number(GCFG.petFollowStartU ?? 0),
    pickMs: Number(GCFG.petPickMs ?? 0),
    reqLevel: Number(GCFG.petSummonReqLevel ?? 1),
    pickup: Number(GCFG.pickupRangeU ?? 0),
    bagSlots: Number(GCFG.bagSlots ?? 32),
    xpRate: Number(GCFG.petXpRate ?? 1),
    gp: GCFG.growthPets ?? {},
  };
  SAVAS_KILIDI_MS = Number(GCFG.petCombatLockoutMs ?? 0);

  const CC = combat?.cfg ?? {};
  const PETCFG = CC.pets ?? {};
  const XP_TABLOSU = combat?.progress?.xpToNext ?? {};
  const MAX_SEVIYE = combat?.progress?.maxLevel ?? 80;

  log(`binek-pet: ${MOUNTS.size} binek, ${PETS.size} pet, ${GPETS.size} gelisim peti, ` +
      `${Object.keys(SAFE).length} bolgede sehir kutusu`);

  /** Bu modulun durumunu tasiyan aktif soketler. */
  const oyuncular = new Set();

  // ================================================================ yardimcilar
  const acik = (ws) => ws && ws.readyState === (ws.OPEN ?? 1);
  const say = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const uz2 = (a, b) => { const dx = a.x - b.x, dz = a.z - b.z; return dx * dx + dz * dz; };

  function hata(ws, code, key) {
    frame(ws, 'err', key ? { code, key } : { code });
    return true;
  }

  /** Bolgedeki, verilen varligi GOREN oyuncular. */
  function gorenler(zoneId, id) {
    const out = [];
    for (const p of world.bolgeOyunculari?.(zoneId) ?? []) {
      if (p.isAuthed && p.gorunen?.has(id)) out.push(p);
    }
    return out;
  }

  /** state.delta {add} - gorus alanindaki herkese, gorunen kumesini de gunceller. */
  function varligiYay(zoneId, e) {
    const p = varlikPayload(e);
    for (const c of world.bolgeOyunculari?.(zoneId) ?? []) {
      if (!c.isAuthed || !c.char) continue;
      if (uz2(e, c.char) > GORUS_U * GORUS_U) continue;
      (c.gorunen ??= new Set()).add(e.id);
      frame(c, 'state.delta', { add: [p] });
    }
  }

  /**
   * fx.petAppear (198) - CAGIRMA efekti.
   *
   * Sema (@25630778):  T$(`fx.petAppear`, 198, X({ id: Y().int() }))
   *
   * Istemci zinciri (paketten okundu, tahmin degil):
   *   @27120964  W$.on(`fx.petAppear`, e => Q.applyPetAppearFx(e))
   *   @25669285  applyPetAppearFx(n) -> dinleyicilere onPetAppearFx(n.id)
   *   @27027951  onPetAppearFx(id) -> onPetAppear(id)
   *                                -> playGrowthPetSummon(Q.entities.get(id))
   *   @26753503  onPetAppear(id): itemFx `returnscroll`.aura efektini
   *              Q.entities.get(id) KONUMUNDA 1400 ms oynatir (loop yok)
   *   @25980541  playGrowthPetSummon(e): yalnizca e.kind === `growth_pet`
   *              ise growthPets.summon sesini calar
   *
   * BUNDAN CIKAN IKI KURAL:
   *   1) `id` PETIN KENDI entity id'sidir, sahibinin degil - istemci
   *      Q.entities.get(id) ile varligi ariyor.
   *   2) Kare, state.delta {add} KARESINDEN SONRA gitmeli. Once gonderilirse
   *      entities.get(id) undefined doner, hem aura hem ses SESSIZCE dusar.
   *
   * Bu yuzden her cagri yerinde varligiYay()'in HEMEN ARDINDAN cagriliyor ve
   * aliciyi `gorunen` kumesinden secip varligi gercekten alan istemcilere
   * sinirliyoruz (gorus disindakiler zaten state.delta almadi).
   */
  function petBelirdiFx(zoneId, id) {
    for (const c of world.bolgeOyunculari?.(zoneId) ?? []) {
      if (!c.isAuthed || !c.gorunen?.has(id)) continue;
      frame(c, 'fx.petAppear', { id });
    }
  }

  /** state.delta {rem} + dunyadan sil. */
  function varligiKaldir(zoneId, id) {
    for (const c of world.bolgeOyunculari?.(zoneId) ?? []) {
      if (!c.gorunen?.has(id)) continue;
      c.gorunen.delete(id);
      frame(c, 'state.delta', { rem: [id] });
    }
    world.varlikSil?.(zoneId, id);
  }

  /* [SIKAYET 4 - "alsa bile yerden kaybolmuyor"] GANIMET icin AYRI kaldirici.
     varligiKaldir()'in `gorunen` kapisi PET/GPET varliklari icin DOGRUDUR -
     onlar `varligiYay()` ile mesafe suzgecinden gecirilip `gorunen`e YAZILIR.
     GANIMET oyle DEGIL: dusurme yollarinin ikisi de (gameloop.js #ganimetDusur
     ve sistem_beceri.js olum()) duz `broadcast` kullaniyor; server.js
     broadcast() ne mesafe suzer ne de `gorunen`e dokunur. Ganimet ancak
     SONRADAN, world.js ilgiGuncelle ile (GORUS_MESAFESI=120 icinde, duran
     oyuncu icin 3 tikte bir) `gorunen`e girer.
     OLCUM (sartname madde 4, 20.000 deneme): sahip icin %4.38 yaris kaybi;
     bolgedeki 120u'dan UZAK her oyuncu icin %100 kayip. Varlik z.entities'ten
     silindigi icin ilgiGuncelle onu bir daha ASLA dolasamaz -> KALICI HAYALET.
     Istemcide bir varligi silen TEK yol `state.delta{rem}` (entities.delete
     paket @25663121, cagiran tek kare @27120830); entity.pickup(155) silmez.
     gameloop.js #almaDenemesi zaten KOSULSUZ yayinliyor; ELLE almanin calisip
     PET almasinin calismamasinin sebebi tam bu asimetriydi. */
  function ganimetiKaldir(zoneId, id) {
    for (const c of world.bolgeOyunculari?.(zoneId) ?? []) {
      c.gorunen?.delete(id);                      // kume sizintisini da kapat
      frame(c, 'state.delta', { rem: [id] });     // KOSULSUZ - gorunen kapisi YOK
    }
    world.varlikSil?.(zoneId, id);
  }

  /** $mt semasi. world.js #varlikPayload ile ayni alanlar + kind pet/growth_pet. */
  function varlikPayload(e) {
    const p = {
      id: e.id, kind: e.kind, modelKey: e.modelKey, name: e.name,
      x: +e.x.toFixed(2), z: +e.z.toFixed(2), y: +(e.y ?? 0).toFixed(2),
      rotY: +(e.rotY ?? 0).toFixed(3),
    };
    // yurumekte olan varlik: `moving` yoksa istemci onu DURUYOR sanir
    if (e.gez) p.moving = { tx: +e.gez.tx.toFixed(2), tz: +e.gez.tz.toFixed(2), speed: e.gez.hiz };
    if (e.level != null) p.level = e.level;
    if (e.maxHp != null) { p.hp = Math.max(0, Math.round(e.hp)); p.maxHp = e.maxHp; }
    if (e.dead) p.dead = true;
    if (e.scalePct != null) p.scalePct = e.scalePct;
    if (e.sahipEntityId != null) p.ownerId = e.sahipEntityId;
    return p;
  }

  /** entity.move - sadece bu varligi gorenlere. */
  function hareketYay(zoneId, e, mv) {
    for (const c of gorenler(zoneId, e.id)) frame(c, 'entity.move', { id: e.id, ...mv });
  }

  /** Varligi hedefe yurutur (bacak kurar) ve entity.move yayinlar.
   *  [S1 MADDE 5] tol: hedef-tazeleme toleransi. Varsayilan 0.75 (eski sabit,
   *  savas yaklasmasi vb. aynen). Yuva takibi SIKI tolerans gecirir: 0.75'lik
   *  bayat hedef iki petin gercek yollarini yuva cizgisinden o kadar
   *  kaydirip kirisi (1.05) deliyordu (olcum: yol boyu min 0.663). Sahip
   *  yururken yuva zaten tik basina >0.75 kaydigi icin kare trafigi ESKIYLE
   *  AYNI kalir; fark yalniz yavas kayma rejiminde. */
  function yurut(zoneId, e, tx, tz, hiz, tol = 0.75) {
    const b = e.bacak;
    if (b && Math.hypot(b.tx - tx, b.tz - tz) < tol && b.hiz === hiz) return;  // ayni yola dogru
    const mv = bacakKur(e, zoneId, tx, tz, hiz, yurunebilir);
    if (!mv) { e.gez = null; return; }
    e.gez = { tx: e.bacak.tx, tz: e.bacak.tz, hiz };
    hareketYay(zoneId, e, mv);
  }

  function durdur(zoneId, e) {
    if (!e.bacak) return;
    bacakDurdur(e);
    e.gez = null;
    for (const c of gorenler(zoneId, e.id)) {
      frame(c, 'entity.stop', { id: e.id, x: +e.x.toFixed(2), z: +e.z.toFixed(2), y: +(e.y ?? 0).toFixed(2) });
    }
  }

  function isinla(zoneId, e, x, z) {
    bacakDurdur(e); e.gez = null;
    e.x = x; e.z = z; e.y = zoneGroundY(zoneId, x, z, e.y);
    for (const c of gorenler(zoneId, e.id)) {
      frame(c, 'entity.teleport', { id: e.id, x: +e.x.toFixed(2), z: +e.z.toFixed(2), y: +(e.y ?? 0).toFixed(2), blink: true });
    }
  }

  /**
   * [DENETIM DUZELTMESI 4] Sahibi BASKA BIR BOLGEYE gectiyse varligi tasi.
   * Isinlanma/donus sistemi (sistem_donus-isinlanma.js) ws.zoneId'yi
   * degistirebiliyor; pet varligi ESKI bolgenin entities haritasinda kaliyordu.
   * Sonuc: eski bolgede sahipsiz bir pet varligi sizintisi, yeni bolgede
   * gorunmeyen pet ve varligiKaldir'in YANLIS bolgeye gitmesi.
   * `rec.zoneId` varligin gercek bolgesidir; burada sahibin bolgesine esitlenir.
   */
  function bolgeSenkron(ws, rec, yuva = null) {
    const e = rec?.entity;
    if (!e || !rec.zoneId || rec.zoneId === ws.zoneId) return false;
    varligiKaldir(rec.zoneId, e.id);
    bacakDurdur(e); e.gez = null;
    const n = yanNokta(ws, yuva);
    e.x = n.x; e.z = n.z; e.y = zoneGroundY(ws.zoneId, n.x, n.z, ws.char?.y ?? 0);
    rec.zoneId = ws.zoneId;
    world.varlikEkle(ws.zoneId, e);
    varligiYay(ws.zoneId, e);
    return true;
  }

  /* [PET AYRISMA - "petler ic ice giriyor"] Sahibin cevresinde her dosta AYRI
     YUVA. referans oyun kurali BULUNDU: changelog 0003-growth-pets.tr.md @2658
     "ic ice gecmiyor", @2729 "yan yana ilerliyor" (EN @2475 "run through each
     other", @2532 "side by side"; canli md5 = yereldeki kopyayla BIREBIR,
     GERCEK/pet_konum_bulgular.json Bulgu 1). Kesin aci pakette YOK; aci
     GEOMETRIK ALT SINIRDAN turetilir, UYDURMA SABIT YOK:
       iki varligin ic ice girmemesi icin gereken en kucuk merkez-merkez
       mesafe = 2 * gameConfig.entityRadiusU (0.5) = 1.0u; dostlar
       gameConfig.petFollowU (2.5) yaricapinda durdugu icin bu kirisi veren
       en kucuk aci = 2*asin( (2*entityRadiusU) / (2*petFollowU) ) =
       0.4027 rad = 23.07 derece.
     OLCUM (GERCEK/denetim/hiz_fix.mjs): yaya 60 sn enKucuk 0.00u -> 1.00u;
     Noble Horse 60 sn enKucuk 0.27u -> 1.00u, isinlanma 7 -> 0. */
  const YUVA_YARICAP = Math.max(1, G.follow);
  /* [S1 MADDE 5] KIRIS PAYI: alt-sinir kirisi (tam 1.0u) sistemi FLOAT bicak
     sirtina oturtuyordu - yuvaya tam yerlesen iki pet OLCULEBILIR yarim
     zamanda 0.999...9u cikiyor (curut_pet_donus2.mjs: durunca <1.0u kosu
     9/20, ort=1.000). Pay OLCUMLE sabitlendi (S1 madde 5 "rakamlar olcumle"),
     iki bileseni var: float payi + DONUS SUPURMESI izleme payi (halka
     donerken hizli pet yuvasina yapisik, yavas pet ~0.1u geride kaliyor ve
     fark kirisi deliyordu; pay 1.05'te yol boyu min 0.971/%2.2 kaldi).
     1.15 -> yerlesik mesafe 1.150u, gezinmede <1.0u zaman ~%0, dur/duz
     sayaclari 0/20, S1-S4 dogum/yol min 1.150u, isinlanma 0. */
  const YUVA_KIRIS_PAYI = 1.15;   // olcumle sabitlendi (ustteki blok)
  const YUVA_ACI = 2 * Math.asin(Math.min(1,
      (2 * say(GCFG.entityRadiusU, 0.5) * YUVA_KIRIS_PAYI) / (2 * YUVA_YARICAP)));
  const YUVA_SAYISI = 2;            // 0 = toplayici pet, 1 = gelisim peti

  /* [S1 MADDE 5 - ic ice binmenin KENDISI] Takip dali yalnizca sahip-pet
     mesafesi petFollowStartU(8) USTUNDEYKEN yeniden hedefliyordu; sahip 8u
     icinde gezinirken petler kesisen SON hedeflerinde donup ust uste
     kaliyordu (OLCUM curut_pet_donus2.mjs, duzeltme ONCESI: pet-pet min
     0.009u, yol zamaninin %59.8'i 1u altinda, durunca 8/20 kosu ic ice).
     referans oyun kaniti: changelog 0003 tr @2729 "yan yana ilerliyor" / en @2532
     "side by side". COZUM dort parca (her biri probe_pet_yakinlasma.mjs
     sondasiyla teshis edilip olcumle dogrulandi):
       1) sahip followStart ICINDEYKEN de yuva ayrismasi (yuvaAyris,
          histerezisli: sapma > BASLA'da basla, yuvaya varinca DUR icinde
          birak; DUR < BASLA -> birakma aninda yeniden tetiklenme yok),
       2) yuva halkasi SINIRLI hizla doner (yuvaYon) - ani donuste duz-cizgi
          gecis yollari ortada birlesiyordu,
       3) cift icin TUTARLI, gecis-histerezisli yuva atamasi (yuvaAtama),
       4) yuvadan bir govde capi sapinca katalog kosu hizi (yuvaHizi) +
          siki hedef-tazeleme toleransi (yurut tol = YUVA_SAPMA_DUR).
     Esikler OLCUMLE sabitlendi (curut_pet_donus2.mjs donguleri +
     olcum_guncel_pet_mesafe.mjs S1-S4 regresyonu + olcum_pet_titreme.mjs;
     sartname S1 madde 5 "taslak esikler baglayici degil" der). SONUC
     (4x20 kosu tutarli): gezinme yol boyu min 0.009u -> 1.073u, <1.0u
     zaman %59.8 -> %0.0, durunca ic ice 8/20 -> 0/20 (tam ust-uste 0/20),
     duz cizgi S1-S4 min 1.150u / 0 isinlanma (regresyon yok), titreme 0
     (A/B/C senaryolari: 0 hareketli tik, 0 ters-donus). */
  /* Iki yuva noktasi arasindaki KIRIS (tam deger; 1.15u = 2r * pay). */
  const YUVA_KIRIS = 2 * YUVA_YARICAP * Math.sin(YUVA_ACI / 2);
  /* Esikler: BASLA olcumle sabitlendi ve KIRIS ALTINDA olmali - "yanlis
     yuvada oturan" petin kendi yuvasina sapmasi tam kiris kadardir; BASLA
     kiristen buyuk olunca o pet HIC tetiklenmiyor ve ust uste OTURMA kalici
     oluyordu (olcum: durunca <0.05u 1/20). DUR geometrik TURETIM: bosta
     duran iki pet kendi yuvalarindan en cok DUR sapabilir -> karsilikli
     mesafe >= KIRIS - 2*DUR; bunun 2*entityRadiusU (1.0, ic ice girmeme
     siniri) altina inmemesi icin DUR = (KIRIS - 2r) / 2 (pay 1.15 ile
     0.075). Olcum:
     DUR=0.5 iken donus sonrasi gevsek birakma d'yi 0.65'e dusuruyordu
     (probe_pet_yakinlasma.mjs), siki deger dususleri kapatti. */
  const YUVA_SAPMA_BASLA = 1.0;   // olcumle sabitlendi (ustteki blok)
  const YUVA_SAPMA_DUR = Math.max(0,
      (YUVA_KIRIS - 2 * say(GCFG.entityRadiusU, 0.5)) / 2);

  /* [S1 MADDE 5] Cift icin TUTARLI yuva atamasi (toplam yol en kucuk olan):
     sahip keskin donunce yuva noktalari yer degistirir; SABIT atama iki peti
     birbirinin icinden gecirtiyordu. Karar tik basina BIR kez, TEK anlik
     goruntuyle verilir ve ayni tikteki ikinci cagri onbellekten okur - iki
     tik fonksiyonu AYRI anlik goruntuyle karar verince ayni yuvayi
     hedefleyebiliyordu (olcum: durunca TAM ust-uste 1/20). Gecis
     histerezisi: yeni atama toplam yolu en az entityRadiusU (0.5, config)
     kadar kisaltmadikca degistirilmez (flap onlemi). Dogum/isinlanma
     (yanNokta) SABIT yuvada kalir. */
  function yuvaAtama(ws, simdi) {
    let a = ws._yuvaAtama;
    if (a && a.t === simdi) return a;
    const pe = ws.pet?.entity, ge = ws.gpet?.entity;
    if (!pe || !ge || ge.dead) { a = { t: simdi, takas: false, s0: null, s1: null }; ws._yuvaAtama = a; return a; }
    const s0 = yuvaNoktasi(ws, 0), s1 = yuvaNoktasi(ws, 1);
    const duz = Math.hypot(s0.x - pe.x, s0.z - pe.z) + Math.hypot(s1.x - ge.x, s1.z - ge.z);
    const capraz = Math.hypot(s1.x - pe.x, s1.z - pe.z) + Math.hypot(s0.x - ge.x, s0.z - ge.z);
    const pay = say(GCFG.entityRadiusU, 0.5);
    let takas = !!ws._yuvaAtama?.takas;
    if (takas) { if (duz + pay < capraz) takas = false; }
    else if (capraz + pay < duz) takas = true;
    a = { t: simdi, takas, s0, s1 };
    ws._yuvaAtama = a;
    return a;
  }

  /** [S1 MADDE 5] Bu dostun HEDEF yuva noktasi (tutarli atamadan). */
  function hedefYuva(ws, yuva, simdi) {
    const a = yuvaAtama(ws, simdi);
    if (!a.s0) return yuvaNoktasi(ws, yuva);
    if (a.takas) return yuva === 0 ? a.s1 : a.s0;
    return yuva === 0 ? a.s0 : a.s1;
  }

  /* [S1 MADDE 5] Yuvaya donus hizi. KOK NEDENIN IKINCI YARISI: takipHizi'nin
     kosu patlamasi yalniz sahip-pet mesafesi followStart*2(16) ustundeyken
     devreye girer; sahip keskin donunce pet sahibe YAKIN ama yuva CIZGISINDEN
     uzak kalir ve esit hizli kuyruk kovalamasi iki peti sahibin IZI uzerine
     asimtotik COKERTIR (olcum: swap atama sonrasi bile <1.0u zaman %19.6).
     Kural changelog 0003 ile ayni ruh: "yakinken ayak uydur, acilinca kapat" -
     sapma (petin KENDI yuva hedefine mesafesi) bir govde CAPINI
     (2*entityRadiusU = 1.0) asarsa katalog kosu hizina cikilir (pets.json
     runSpeedU / growth-pets.json satir runSpeedU - uydurma sabit yok), yuva
     yakininda takipHizi aynen kalir. Esik once petFollowU(2.5) denendi:
     takip hatasi 2.5'e kadar buyuyebildigi icin donus suplarinda d 0.65'e
     dusuyordu (probe); govde capi esigi izlemeyi sikilastirdi. */
  function yuvaHizi(ws, def, d, sapma) {
    const taban = takipHizi(ws, def, d);
    if (sapma <= 2 * say(GCFG.entityRadiusU, 0.5)) return taban;
    return Math.max(taban, say(def.runSpeedU, 0));
  }

  /** [S1 MADDE 5] Sahip followStart icindeyken yuva ayrismasi (histerezisli).
   *  rec = ws.pet | ws.gpet kaydi (yuvaDuzelt bayragi kayitta yasar;
   *  ws.pet/ws.gpet hicbir yerde serilestirilmiyor). */
  function yuvaAyris(ws, rec, yuva, e, def, simdi) {
    const zoneId = rec.zoneId;
    const n = hedefYuva(ws, yuva, simdi);
    const sapma = Math.hypot(n.x - e.x, n.z - e.z);
    if (rec.yuvaDuzelt) {
      if (!e.bacak && sapma <= YUVA_SAPMA_DUR) {
        rec.yuvaDuzelt = false;          // yuvaya varildi - birak
      } else {
        yurut(zoneId, e, n.x, n.z, yuvaHizi(ws, def, sapma, sapma), YUVA_SAPMA_DUR);
        /* yol kurulamadi (yurunemez/zaten yerinde) -> birak; yeniden
           tetiklenme icin sapma > BASLA gerekir, donme-dongusu olmaz */
        if (!e.bacak) rec.yuvaDuzelt = false;
      }
    } else if (sapma > YUVA_SAPMA_BASLA) {
      rec.yuvaDuzelt = true;
      yurut(zoneId, e, n.x, n.z, yuvaHizi(ws, def, sapma, sapma), YUVA_SAPMA_DUR);
      if (!e.bacak) rec.yuvaDuzelt = false;
    }
  }

  /* [S1 MADDE 5] YUMUSATILMIS sahip yonu. Keskin donuste yuva noktalari
     ANINDA ziplayinca iki petin duz-cizgi gecis yollari ortada birlesiyordu
     (sonda probe_pet_yakinlasma.mjs: 119 derece donusten 1 tik sonra d
     1.05 -> 0.17; geometrik zorunluluk - iki 1.05u'luk ayrisma vektorunun
     lerp'i 119 derecede ortada 1.05*cos(59.5)=0.53'e iner). Yuva halkasi bu
     yuzden SINIRLI acisal hizla doner: hedefler her an tam kiris araliginda
     kalir, petler formasyon halinde YAY cizer ("yan yana ilerliyor" gorseli).
     Donus hizi VERIDEN: en yavas katalog kosusu (growth-pets Wolf cub
     runSpeedU 11.25) - yaya hizi (playerMoveSpeedU 7.5) = 3.75 u/s yanal
     pay / yuva yaricapi (petFollowU 2.5) = 1.5 rad/s; olcumle dogrulandi
     (curut_pet_donus2.mjs dongusu). */
  const YUVA_DONUS_HIZI = 1.5;   // rad/s - ustteki turetim + olcum
  function yuvaYon(ws) {
    const simdi = Date.now();
    const hedef = say(ws.char?.rotY, 0);
    let s = ws._yuvaYon;
    if (!s) { ws._yuvaYon = { t: simdi, yon: hedef }; return hedef; }
    const dt = Math.max(0, simdi - s.t) / 1000;
    s.t = simdi;
    let fark = hedef - s.yon;
    while (fark > Math.PI) fark -= 2 * Math.PI;
    while (fark < -Math.PI) fark += 2 * Math.PI;
    const adim = YUVA_DONUS_HIZI * dt;
    s.yon += Math.abs(fark) <= adim ? fark : Math.sign(fark) * adim;
    return s.yon;
  }

  /** Sahibin ARKASINDA, yuvaya ait sabit takip noktasi (nav ile kirpilir).
   *  [S1 MADDE 5] Yon ani rotY degil yuvaYon (sinirli hizla donen halka). */
  function yuvaNoktasi(ws, yuva) {
    const ch = ws.char;
    const taban = yuvaYon(ws) + Math.PI;                  // sahibin arkasi
    const aci = taban + (yuva - (YUVA_SAYISI - 1) / 2) * YUVA_ACI;
    // rotY = atan2(dx, dz) oldugu icin yon vektoru (sin, cos)
    const hx = ch.x + Math.sin(aci) * YUVA_YARICAP;
    const hz = ch.z + Math.cos(aci) * YUVA_YARICAP;
    const yol = yurunebilir(ws.zoneId, ch.x, ch.z, hx, hz, ch.y);
    return { x: yol.x, z: yol.z };
  }

  /* [PET AYRISMA - Bulgu 3] Takip hizi SAHIBIN hizindan turetilir.
     referans oyun kurali BULUNDU: changelog 0003 EN @2258 "keep pace properly ...
     match your speed when they are close and put on a burst to close the
     gap", TR @2447 "ayak uyduruyor". Sahibin hizi zaten hiz(ws)'de (binek
     speedU + moveSpeedPct buff carpani). ATAK carpani VERIDEN turetilir,
     uydurulmaz: runSpeedU/walkSpeedU (pets.json Rabbit 18/7.5 = 2.4;
     growth-pets.json Wolf cub 11.25/7.5 = 1.5) - walkSpeedU tam olarak
     gameConfig.playerMoveSpeedU (7.5) tabanina esit.
     OLCUM (GERCEK/denetim/isinlanma.mjs -> hiz_fix.mjs, Noble Horse 60 sn):
     gpet->sahip ortalama 26.7u -> 8.7u; isinlanma 7 -> 0. */
  function takipHizi(ws, def, d) {
    const sahip = hiz(ws);
    const yuru  = say(def.walkSpeedU, sahip);
    const kos   = say(def.runSpeedU, yuru);
    if (d > G.followStart * 2) return sahip * (yuru > 0 ? kos / yuru : 1);
    return Math.max(sahip, yuru);
  }

  /** Sahibin yaninda dogum/isinlanma noktasi (yurunebilir bir yer).
   *  [PET AYRISMA - Bulgu 2] yuva verilirse SABIT yuva noktasi kullanilir -
   *  rastgele aci iki petin dogum aninda da ust uste gelmesine yol aciyordu
   *  (olcum: 200 kosunun 25'inde <1.0u). yuva verilmezse eski rastgele
   *  davranis aynen korunur. */
  function yanNokta(ws, yuva = null) {
    if (yuva !== null) return yuvaNoktasi(ws, yuva);
    const ch = ws.char;
    const a = Math.random() * Math.PI * 2;
    const r = Math.max(1, G.follow);
    const yol = yurunebilir(ws.zoneId, ch.x, ch.z, ch.x + Math.cos(a) * r, ch.z + Math.sin(a) * r, ch.y);
    return { x: yol.x, z: yol.z };
  }

  /** Sehir (safe area) icinde mi? - err.mount.town icin. */
  function sehirde(zoneId, x, z) {
    for (const s of SAFE[zoneId] ?? []) {
      const sh = s.shape;
      if (!sh || sh.kind !== 'box') continue;
      const cx = s.x + (sh.ox ?? 0), cz = s.z + (sh.oz ?? 0);
      let dx = x - cx, dz = z - cz;
      const rot = s.rotY ?? 0;
      if (rot) {                                   // kutu donmusse yerel eksene cevir
        const c = Math.cos(-rot), n = Math.sin(-rot);
        const rx = dx * c - dz * n, rz = dx * n + dz * c;
        dx = rx; dz = rz;
      }
      if (Math.abs(dx) <= sh.hx && Math.abs(dz) <= sh.hz) return true;
    }
    return false;
  }

  function savasKilidinde(ws, simdi) {
    if (SAVAS_KILIDI_MS <= 0) return false;
    if (ws.savas) return true;
    return simdi - (ws._bpSonSavas ?? 0) < SAVAS_KILIDI_MS;
  }

  /** ch.bag[slot] - gecerli ve dolu ise esya kaydini doner. */
  function cantaEsyasi(ch, slot) {
    const s = Number(slot);
    if (!Number.isInteger(s) || s < 0) return null;
    if (!Array.isArray(ch?.bag) || s >= ch.bag.length) return null;
    return ch.bag[s] ?? null;
  }

  /** Esya kaydinin `rolls` haritasi (yoksa olusturur). */
  function rolls(it) { return (it.rolls ??= {}); }

  function envanteriYolla(ws) {
    if (envanterPayload) frame(ws, 'inv.update', envanterPayload(ws.char));
  }

  /**
   * Esyayi cantaya koyar. gameloop.js #cantayaEkle ile AYNI kural:
   * yigin siniri itemstats.json `stackMax`, yuva sayisi gameConfig.bagSlots.
   */
  function cantayaEkle(ch, itemId, adet) {
    const yuva = ch.bag?.length || G.bagSlots;
    if (!Array.isArray(ch.bag) || ch.bag.length !== yuva) {
      const eski = Array.isArray(ch.bag) ? ch.bag : [];
      ch.bag = new Array(yuva).fill(null);
      for (let i = 0; i < Math.min(eski.length, yuva); i++) ch.bag[i] = eski[i];
    }
    const def = ITEMSTATS.get(itemId);
    const yiginMax = Math.max(1, say(def?.stackMax, 1));
    let kalan = Math.max(1, say(adet, 1));
    if (yiginMax > 1) {
      for (let i = 0; i < ch.bag.length && kalan > 0; i++) {
        const s = ch.bag[i];
        if (!s || s.itemId !== itemId) continue;
        const yer = yiginMax - say(s.qty, 1);
        if (yer <= 0) continue;
        const k = Math.min(yer, kalan);
        s.qty = say(s.qty, 1) + k; kalan -= k;
      }
    }
    while (kalan > 0) {
      const bos = ch.bag.indexOf(null);
      if (bos < 0) return false;
      const k = Math.min(yiginMax, kalan);
      ch.bag[bos] = { itemId, qty: k };
      kalan -= k;
    }
    return true;
  }

  // ================================================================ BINEK
  /**
   * [madde 13 / fark #164 + #165] Oyuncunun O ANKI hareket hizi (birim/sn) -
   * TEK KAYNAK. move.click, gameloop yaklasmalari ve ganimet yaklasmasi
   * hepsi buradan gecmeli (bkz. dosya sonundaki BAGLAMA NOTU 5).
   *
   * NEDEN SUNUCUDA: istemci hizi kendisi HESAPLAMIYOR, sunucudan aliyor.
   *   paket @25663413  applyMove: `this.selfSpeed = node.speed`
   *   paket @25658886  baslangic: `selfSpeed = J$.gameConfig.playerMoveSpeedU`
   * Yani hem binek hizini hem hareket hizi buff'ini yansitmak SUNUCUNUN isi.
   *
   * Zincir:  taban -> binek -> hareket hizi buff'i
   *   taban : data/game-config.json playerMoveSpeedU = 7.5
   *   binek : data/mounts.json speedU (mount_c_horse1 13.5 / horse2 14.25 /
   *           horse3 15.75). Bu deger MUTLAK hizdir, carpan degil - bu yuzden
   *           tabani carpmaz, DEGISTIRIR.
   *   buff  : data/skills.json buff.mods.moveSpeedPct (sema paket @8659842
   *           `moveSpeedPct: Y().optional()`). 38 beceri kaydi tasiyor ve
   *           deger ORAN'dir, yuzde degil (lightning_gyeonggong_a_1 = 0.2 ...
   *           _8 = 0.41). Carpani sistem_beceri.js uretir; o modul kancayi
   *           acmadiysa 1 doner ve davranis bugunkune esit kalir.
   *
   * KAYNAK YOK: binekteyken moveSpeedPct'in gecerli olup olmadigini paket
   * soylemiyor. "Tek yardimci" kurali geregi ayni carpan uygulanir; ayrilmasi
   * gerekirse degistirilecek TEK yer burasidir.
   */
  function hiz(ws) {
    const taban = say(GCFG.playerMoveSpeedU, 7.5);
    const b = ws?.binek;
    const h = b ? say(b.speedU, taban) : taban;
    const k = say(sistemOrnegi('beceri')?.hizCarpani?.(ws), 1);
    return h * (k > 0 ? k : 1);
  }

  /**
   * [madde 13] Hiz DEGISTI: yurumekte olan bacagi AYNI hedefe YENI hizla
   * yeniden kurar ve entity.move yayinlar.
   *
   * NEDEN SART: istemci selfSpeed'i yalnizca entity.move geldiginde tazeliyor
   * (@25663413). Yururken ata binen oyuncuda istemci 7.5 ile yurumeye devam
   * eder, sunucu 13.5 ile ilerletir; iki taraf ayrisinca applyMove'un
   * "> 3 birim" SNAP dali (@25663224) tetiklenir ve karakter zipliyor gorunur.
   * Gonderdigimiz karenin fx/fz'si SU ANKI konum oldugu icin SNAP olmaz.
   *
   * Binege binerken/inerken burada cagrilir; hareket hizi buff'i baslarken/
   * biterken sistem_beceri.js `BINEK.hizTazele(ws)` ile cagirmalidir.
   */
  function hizTazele(ws) {
    const ch = ws?.char;
    const b = ch?.bacak;
    if (!b) return false;                       // yurumuyorsa tazelenecek kare yok
    const h = hiz(ws);
    if (Math.abs(say(b.hiz) - h) < 1e-6) return false;
    const mv = bacakKur(ch, ws.zoneId, b.tx, b.tz, h, yurunebilir);
    if (!mv) return false;                      // hedefe zaten varilmis
    const kare = { id: ws.entityId, ...mv };
    frame(ws, 'entity.move', kare);             // selfSpeed'i tazeleyen kare
    broadcast(ws.zoneId, 'entity.move', kare, ws);
    return true;
  }

  const binekte = (ws) => !!ws?.binek;

  function mountKare(ws) {
    const b = ws.binek;
    return {
      id: ws.entityId,
      mount: b ? { modelKey: b.modelKey, hp: Math.max(0, Math.round(b.hp)), maxHp: b.maxHp } : null,
    };
  }
  function mountYay(ws) {
    const kare = mountKare(ws);
    frame(ws, 'mount.update', kare);
    broadcast(ws.zoneId, 'mount.update', kare, ws);
  }

  function mountKullan(ws, d) {
    const ch = ws.char;
    if (!ch) return true;
    if (ch.dead) return hata(ws, 'ERR_DEAD');
    if (ws.binek) return hata(ws, 'ERR_PET_STATE', 'err.mount.mounted');

    const it = cantaEsyasi(ch, d?.bagSlot);
    if (!it) return hata(ws, 'ERR_NOT_FOUND');
    const def = ITEMSTATS.get(it.itemId);
    if (!def || def.type !== 'mount') return hata(ws, 'ERR_VALIDATION');
    const m = MOUNTS.get(def.mountId);
    if (!m) return hata(ws, 'ERR_NOT_FOUND');

    // reqLevel: hem esya hem binek katalogunda var - buyugu baglar
    const gerek = Math.max(say(def.reqLevel, 1), say(m.reqLevel, 1));
    if (say(ch.level, 1) < gerek) return hata(ws, 'ERR_REQ_LEVEL', 'err.mount.level');
    if (sehirde(ws.zoneId, ch.x, ch.z)) return hata(ws, 'ERR_PET_STATE', 'err.mount.town');
    if (savasKilidinde(ws, Date.now())) return hata(ws, 'ERR_PET_COMBAT', 'err.mount.combat');

    ws.binek = {
      defId: m.id, modelKey: m.modelKey, name: m.name,
      speedU: say(m.speedU, say(GCFG.playerMoveSpeedU, 7.5)),
      maxHp: say(m.maxHp, 1), hp: say(m.maxHp, 1),
      bagSlot: Number(d.bagSlot),
    };
    oyuncular.add(ws);
    mountYay(ws);
    hizTazele(ws);   // madde 13: yururken binildiyse istemcinin selfSpeed'i tazelensin
    return true;
  }

  function mountIn(ws, sessiz = false) {
    if (!ws.binek) return sessiz ? true : hata(ws, 'ERR_PET_STATE', 'err.mount.not_mounted');
    ws.binek = null;
    mountYay(ws);
    hizTazele(ws);   // madde 13: binek dustu -> istemci taban hiza donmeli
    return true;
  }

  /** Binege hasar - combat.js/gameloop.js bunu cagirabilir (bkz. BAGLAMA NOTU). */
  function binekHasar(ws, dmg) {
    const b = ws?.binek;
    if (!b) return false;
    b.hp = Math.max(0, b.hp - Math.max(0, say(dmg)));
    if (b.hp > 0) { mountYay(ws); return true; }
    const ad = b.name;
    ws.binek = null;
    mountYay(ws);
    hizTazele(ws);   // madde 13: binek oldu -> hiz taban degere dondu
    frame(ws, 'sys.notice', { key: 'sys.mount.died', params: { name: ad } });
    return true;
  }

  // ================================================================ PET
  const VARSAYILAN_AYAR = { grab: true, scope: 'own', gold: true, equipment: true, other: true };

  /** y$ semasi - eksik/bozuk alan gelirse varsayilana duser. */
  function ayarNormalize(a) {
    const o = { ...VARSAYILAN_AYAR };
    if (a && typeof a === 'object') {
      if (typeof a.grab === 'boolean') o.grab = a.grab;
      if (a.scope === 'own' || a.scope === 'all') o.scope = a.scope;
      if (typeof a.gold === 'boolean') o.gold = a.gold;
      if (typeof a.equipment === 'boolean') o.equipment = a.equipment;
      if (typeof a.other === 'boolean') o.other = a.other;
    }
    return o;
  }

  /* ==================================== PET TOPLAMA AYARLARI (KALICI)
   * KAYNAK: pet.state (161) semasi `settings` alanini TASIYOR (eht @25593113,
   * ayar semasi y$ @25592996) ve istemci ayari yalnizca sunucudan aliyor;
   * kendi tarafinda `mmo.pet.v1.<charId>` altinda ONBELLEKLIYOR (paket
   * @27047704) - yani referans oyunda ayar oturumlar arasi KORUNUYOR, otorite
   * sunucu. Bizde ws._petAyar sokete bagliydi: cikis-giriste ayar
   * giris.js:213'teki varsayilana (grab/own/gold/equipment/other) donuyordu.
   *
   * SAKLAMA YERI: SRO_WEB_GAME'de pet ayari icin sutun yok. Yeni ve kucuk bir
   * tablo aciyoruz; kalip kalicilik.js:44 ile ayni (IF OBJECT_ID ... IS NULL
   * CREATE TABLE). Var olan hicbir tabloya dokunulmuyor.
   * NEDEN WebCharGrowthPet'e sutun EKLEMEDIK: o satir gelisim petine (fluteun
   * canta yuvasina) bagli; toplama ayari ise KARAKTERE ait ve pet hic
   * cagirilmamisken de anlamli. */
  let petSemaHazir = false;
  async function petSemaKur() {
    if (petSemaHazir || !web) return petSemaHazir;
    try {
      await web.request().query(`
        IF OBJECT_ID('dbo.WebCharPet') IS NULL
          CREATE TABLE dbo.WebCharPet (
            CharID       int           NOT NULL PRIMARY KEY,
            settingsJson nvarchar(400) NULL,
            updatedAt    datetime      NOT NULL CONSTRAINT DF_WebCharPet_upd DEFAULT (GETDATE()));
        IF COL_LENGTH('dbo.WebCharPet', 'bagSlot') IS NULL
          ALTER TABLE dbo.WebCharPet ADD bagSlot int NULL;
        IF OBJECT_ID('dbo.WebCharGrowthPet') IS NOT NULL
           AND COL_LENGTH('dbo.WebCharGrowthPet', 'acik') IS NULL
          ALTER TABLE dbo.WebCharGrowthPet ADD acik bit NOT NULL
            CONSTRAINT DF_WCGP_acik DEFAULT(0);`);
      /* [S1 MADDE 4 - changelog 0008 paritesi] Ustteki iki ALTER, "cikista
         acik kalan pet giriste geri gelsin" kaliciligi icin: WebCharPet.bagSlot
         (acik toplayici petin yuvasi, NULL = kapali) ve WebCharGrowthPet.acik
         (bit; gpetGonder/temizle ayni gpetKaydet'i kullandigi icin durumdan
         TURETILEMIYORDU - yol bazli yazilir, bkz. petAcikYaz/gpetAcikYaz).
         IF COL_LENGTH guard'lari yeniden kosumu no-op yapar; WebCharGrowthPet
         yoksa (setup_web_schema.mjs kosulmamis taze DB) ALTER atlanir ki
         ayar kaliciligi da onunla birlikte devrilmesin. */
      petSemaHazir = true;
    } catch (e) {
      log('binek-pet: WebCharPet kurulamadi:', String(e.message).slice(0, 130));
    }
    return petSemaHazir;
  }

  async function petAyarYukle(ch) {
    if (!ch) return null;
    const cid = Number(ch.id);
    if (!web || !Number.isInteger(cid)) return null;
    if (!(await petSemaKur())) return null;
    try {
      const sqlM = (await import('mssql')).default;
      const r = await web.request().input('c', sqlM.Int, cid)
        .query('SELECT settingsJson, bagSlot FROM dbo.WebCharPet WHERE CharID = @c');
      const kayit = r.recordset?.[0];
      /* [S1 MADDE 4] Acik birakilan petin yuvasi (NULL = acik pet yok).
         settingsJson bos olsa da okunur - ayar hic kaydedilmemis olabilir. */
      if (kayit && Number.isInteger(kayit.bagSlot)) ch.petAcikSlot = kayit.bagSlot;
      const ham = kayit?.settingsJson;
      if (!ham) return null;
      /* ayarNormalize bozuk/eksik alani varsayilana dusurur - sema disi bir
         kayit oyuncuyu kilitlemez. */
      ch.petAyar = ayarNormalize(JSON.parse(ham));
      return ch.petAyar;
    } catch (e) {
      log('binek-pet: pet ayari okunamadi:', String(e.message).slice(0, 130));
      return null;
    }
  }

  function petAyarKaydet(ws) {
    const ch = ws?.char;
    const cid = Number(ch?.id);
    if (!web || !Number.isInteger(cid)) return;
    (async () => {
      if (!(await petSemaKur())) return;
      const sqlM = (await import('mssql')).default;
      await web.request()
        .input('c', sqlM.Int, cid)
        .input('j', sqlM.NVarChar(400), JSON.stringify(petAyari(ws)))
        .query(`MERGE dbo.WebCharPet AS t USING (SELECT @c AS CharID) AS s
                  ON t.CharID = s.CharID
                WHEN MATCHED THEN UPDATE SET settingsJson = @j, updatedAt = GETDATE()
                WHEN NOT MATCHED THEN INSERT (CharID, settingsJson) VALUES (@c, @j);`);
    })().catch((e) => log('binek-pet: pet ayari yazilamadi:', String(e.message).slice(0, 130)));
  }

  /* ==================================== [S1 MADDE 4] ACIK/KAPALI BAYRAKLARI
   * changelog 0008 satir 3: "Petlerin seninle geri geliyor... Bilerek
   * kapattigin pet kapali kaliyor." Bayrak DURUMDAN TURETILMEZ, YOLA GORE
   * ACIKCA yazilir - kritik neden: gpetGonder gpetKaydet'i ws.gpet HALA
   * DOLUYKEN cagirir ve temizle (cikis) AYNI gpetKaydet'ten gecer; kayit
   * govdesine konsaydi "acikti / bilerek kapatildi" DB'de ayirt edilemezdi.
   *   petCagir  sonunda  -> WebCharPet.bagSlot = slot
   *   petGonder          -> WebCharPet.bagSlot = NULL
   *   gpetCagir zinciri  -> WebCharGrowthPet.acik = 1
   *   gpetGonder         -> WebCharGrowthPet.acik = 0
   *   temizle (CIKIS)    -> DOKUNMAZ: acik durum korunur, giriste otoCagir
   * MERGE WITH (HOLDLOCK): ayni CharID'ye es-zamanli ilk-INSERT yarisinda
   * PK patlamasin (petAyarKaydet ile ilk pet cagirmada yan yana kosabilir). */
  function petAcikYaz(ws, slot) {
    const cid = Number(ws?.char?.id);
    if (!web || !Number.isInteger(cid)) return;
    (async () => {
      if (!(await petSemaKur())) return;
      const sqlM = (await import('mssql')).default;
      await web.request()
        .input('c', sqlM.Int, cid)
        .input('b', sqlM.Int, slot == null ? null : Number(slot))
        .query(`MERGE dbo.WebCharPet WITH (HOLDLOCK) AS t USING (SELECT @c AS CharID) AS s
                  ON t.CharID = s.CharID
                WHEN MATCHED THEN UPDATE SET bagSlot = @b, updatedAt = GETDATE()
                WHEN NOT MATCHED THEN INSERT (CharID, settingsJson, bagSlot) VALUES (@c, NULL, @b);`);
    })().catch((e) => log('binek-pet: pet acik-bayragi yazilamadi:', String(e.message).slice(0, 130)));
  }

  function gpetAcikYaz(ws, deger) {
    const cid = Number(ws?.char?.id);
    if (!web || !Number.isInteger(cid)) return;
    /* NOT MATCHED dali icin anlik degerler SENKRON okunur - cagiran yerlerde
       ws.gpet ya doludur (gpetGonder, cagirma zinciri) ya da satir zaten var. */
    const g = ws.gpet;
    const b = say(g?.bagSlot, 0);
    const m = (g?.mode === 'offensive' || g?.mode === 'defensive') ? g.mode : 'defensive';
    const l = Math.max(1, say(g?.level, 1));
    const x = Math.round(say(g?.xp, 0));
    (async () => {
      if (!(await petSemaKur())) return;
      const sqlM = (await import('mssql')).default;
      await web.request()
        .input('c', sqlM.Int, cid)
        .input('a', sqlM.Bit, deger ? 1 : 0)
        .input('b', sqlM.Int, b)
        .input('m', sqlM.VarChar(12), m)
        .input('l', sqlM.Int, l)
        .input('x', sqlM.BigInt, x)
        .query(`MERGE dbo.WebCharGrowthPet WITH (HOLDLOCK) AS t USING (SELECT @c AS CharID) AS s
                  ON t.CharID = s.CharID
                WHEN MATCHED THEN UPDATE SET acik = @a, updatedAt = GETDATE()
                WHEN NOT MATCHED THEN INSERT (CharID, bagSlot, mode, level, xp, acik, updatedAt)
                  VALUES (@c, @b, @m, @l, @x, @a, GETDATE());`);
    })().catch((e) => log('binek-pet: gpet acik-bayragi yazilamadi:', String(e.message).slice(0, 130)));
  }

  /* [S1 MADDE 4] Giriste acik gpet kaydini oku -> ch.gpetAcikSlot.
     GECIS NOTU: ALTER'in DEFAULT(0)'i eski satirlari 0 yapar - dagitim
     ONCESI acik birakilmis gpet'ler ILK giriste bir kez elle cagrilir
     (tek seferlik, veri kaybi yok). */
  async function gpetAcikYukle(ch) {
    const cid = Number(ch?.id);
    if (!web || !Number.isInteger(cid)) return;
    if (!(await petSemaKur())) return;   // 'acik' sutunu garanti olsun
    try {
      const sqlM = (await import('mssql')).default;
      const r = await web.request().input('c', sqlM.Int, cid)
        .query('SELECT TOP 1 bagSlot, acik FROM dbo.WebCharGrowthPet WHERE CharID = @c');
      const row = r.recordset?.[0];
      if (row && (row.acik === true || row.acik === 1) && Number.isInteger(row.bagSlot)) {
        ch.gpetAcikSlot = row.bagSlot;
      }
    } catch (e) { log('binek-pet: gpet acik-bayragi okunamadi:', String(e.message).slice(0, 130)); }
  }

  /** server.js modulleriYukle(ch) kancasi - zone.init'ten ONCE. */
  async function yukle(ch) {
    await petAyarYukle(ch);    // ayrica ch.petAcikSlot'u doldurur (madde 4)
    await gpetAcikYukle(ch);   // [S1 MADDE 4] acik gpet -> ch.gpetAcikSlot
    return {};   // pet ayari zone.init.self'te DEGIL, pet.state (161) karesinde
  }

  /** Sokete gecerli ayar. Kalici kayit varsa ondan tohumlanir. */
  function petAyari(ws) {
    return (ws._petAyar ??= ayarNormalize(ws?.char?.petAyar ?? VARSAYILAN_AYAR));
  }

  function petDurum(ws) {
    const p = ws.pet;
    const d = { active: !!p, settings: petAyari(ws) };
    if (p) {
      d.petId = p.petId;
      d.entityId = p.entity.id;
      d.bagSlot = p.bagSlot;
      if (p.expiresAt != null) d.expiresAt = p.expiresAt;
    }
    frame(ws, 'pet.state', d);
    return d;
  }

  function petCagir(ws, d) {
    const ch = ws.char;
    if (!ch) return true;
    if (ch.dead) return hata(ws, 'ERR_DEAD');
    if (ws.pet) return hata(ws, 'ERR_PET_STATE', 'err.pet.unsummon_first');
    if (savasKilidinde(ws, Date.now())) return hata(ws, 'ERR_PET_COMBAT');

    const slot = Number(d?.bagSlot);
    const it = cantaEsyasi(ch, slot);
    if (!it) return hata(ws, 'ERR_NOT_FOUND');
    const def = ITEMSTATS.get(it.itemId);
    if (!def || def.type !== 'petScroll') return hata(ws, 'ERR_VALIDATION');
    const pd = PETS.get(def.petId);
    if (!pd) return hata(ws, 'ERR_NOT_FOUND');

    // gameConfig.petSummonReqLevel = 5, esya katalogunda da reqLevel 5
    const gerek = Math.max(G.reqLevel, say(def.reqLevel, 1));
    if (say(ch.level, 1) < gerek) return hata(ws, 'ERR_REQ_LEVEL');

    if (d.settings) { ws._petAyar = ayarNormalize(d.settings); petAyarKaydet(ws); }

    /* Kiralama suresi ILK CAGIRMADA baslar; sonra esya kaydinda yasar
       (istemci ipucu: item.rolls.petExpiresAt). */
    const r = rolls(it);
    if (def.lifetimeMs != null && r.petExpiresAt == null) {
      r.petExpiresAt = Date.now() + say(def.lifetimeMs);
    }
    if (r.petExpiresAt != null && r.petExpiresAt <= Date.now()) {
      frame(ws, 'sys.notice', { key: 'sys.pets.rental_expired', params: { pet: pd.name } });
      return hata(ws, 'ERR_PET_STATE');
    }

    const n = yanNokta(ws, 0);   // [PET AYRISMA] toplayici petin yuvasi = 0
    const e = {
      id: world.yeniVarlikId(), kind: 'pet',
      modelKey: pd.modelKey, name: pd.name,
      x: n.x, z: n.z, y: zoneGroundY(ws.zoneId, n.x, n.z, ch.y), rotY: say(ch.rotY),
      dead: false, sahipEntityId: ws.entityId,
      gez: null, bacak: null,
    };
    world.varlikEkle(ws.zoneId, e);
    ws.pet = {
      petId: pd.id, def: pd, entity: e, bagSlot: slot,
      zoneId: ws.zoneId,                       // [DUZELTME 4] varligin GERCEK bolgesi
      expiresAt: r.petExpiresAt ?? null,
      /* [SIKAYET 3a] hedefBas = hedefin secildigi an (zaman asimi icin),
         kara = ulasilamayan ganimetlerin gecici kara listesi (id -> bitis).
         Varlik id'leri world.yeniVarlikId ile MONOTON artar (geri donusum
         yok) -> id bazli kara liste yanlis pozitif uretmez. ws.pet hicbir
         yerde serilestirilmiyor - Map kaydi bozmaz. */
      hedefGanimet: null, sonTarama: 0, hedefBas: 0, kara: new Map(),
    };
    oyuncular.add(ws);
    varligiYay(ws.zoneId, e);
    petBelirdiFx(ws.zoneId, e.id);   // fx.petAppear (198) - state.delta'dan SONRA
    petDurum(ws);
    envanteriYolla(ws);
    petAcikYaz(ws, slot);   // [S1 MADDE 4] yol bazli bayrak: pet ACIK (yuva = slot)
    return true;
  }

  function petGonder(ws, sessiz = false) {
    const p = ws.pet;
    if (!p) { if (!sessiz) petDurum(ws); return true; }
    varligiKaldir(p.zoneId ?? ws.zoneId, p.entity.id);
    ws.pet = null;
    /* [S1 MADDE 4] yol bazli bayrak: pet KAPALI. Buradan gecen HER yol
       (bilerek dismiss, kiralama bitisi, olum) bayragi temizler; CIKIS
       yolu (temizle) petGonder'den GECMEZ -> acik durum korunur. */
    petAcikYaz(ws, null);
    if (!sessiz) petDurum(ws);
    return true;
  }

  function petAyarla(ws, d) {
    ws._petAyar = ayarNormalize(d);
    petAyarKaydet(ws);          // KALICI: cikis-giriste ayar korunur
    petDurum(ws);
    return true;
  }

  /** Ganimet, ayarlara gore alinabilir mi? */
  function ganimetUygun(ws, e, ayar) {
    if (!ayar.grab) return false;
    if (e.kind !== 'ground_item') return false;
    const simdi = Date.now();
    // baskasinin sahiplik kilidi - her iki kapsamda da saygi gosterilir
    if (e.sahip && e.sahip !== ws.entityId && simdi < say(e.sahipBitis)) return false;
    // ui.pet.grab_own: yalnizca KENDI esyalarim / grab_all: sahipsizler dahil
    if (ayar.scope === 'own' && e.sahip !== ws.entityId) return false;
    if (e.gold) return !!ayar.gold;
    if (!e.itemId) return false;
    const tip = ITEMSTATS.get(e.itemId)?.type;
    return EKIPMAN_TIPLERI.has(tip) ? !!ayar.equipment : !!ayar.other;
  }

  /** Pet bir ganimeti alir. gameloop.js #almaDenemesi ile ayni mesaj sirasi. */
  function petAlir(ws, e) {
    const ch = ws.char;
    let bildirim = null;
    if (e.gold) {
      ch.gold = say(ch.gold) + say(e.gold);
      bildirim = { key: 'sys.loot.gold', params: { gold: e.gold } };
    } else if (e.itemId) {
      if (!cantayaEkle(ch, e.itemId, say(e.qty, 1))) {
        /* Canta dolu -> toplama AYARI kapanir. EN locale @25834044:
           "The grab SETTING has been turned OFF because your inventory is
           full." -> gecici duraklama DEGIL, kalici bir AYAR degisikligi.
           tr.json sys.pets.grab_off: "Envanterin dolu oldugu icin toplama
           ayari KAPATILDI."
           [SIKAYET 3c - YAPISKANLIK] petAyarKaydet cagrilmadigi icin DB'de
           grab=true kaliyor, girdi() her giriste kosulsuz petDurum(ws) basip
           istemcinin localStorage kopyasini da eziyordu (@27048267
           setServerState sunucu degerini yerel kopyanin UZERINE yazar) ->
           ayar kendiliginden geri aciliyordu. Kaydedici JSON.stringify'i
           async govdede, await'lerden SONRA calistirdigi icin mutasyondan
           SONRA cagrilmasi yeterli - YAZMA anindaki degeri alir. */
        petAyari(ws).grab = false;
        petAyarKaydet(ws);          // KALICI: cikis-giriste ayar KAPALI kalir
        frame(ws, 'sys.notice', { key: 'sys.pets.grab_off' });
        petDurum(ws);
        return false;
      }
      const def = ITEMSTATS.get(e.itemId);
      bildirim = { key: 'sys.loot.picked_up', params: { item: def?.name ?? e.itemId } };
    }
    /* [SIKAYET 4] varligiKaldir DEGIL ganimetiKaldir: ganimet `gorunen`
       kumesine hic girmedigi icin gorunen kapili yol `rem` karesini yutuyor,
       esya herkes icin yerde KALICI hayalet kaliyordu. Kare SIRASI korunur:
       state.delta{rem} -> inv.update -> sys.notice -> entity.pickup. */
    ganimetiKaldir(ws.zoneId, e.id);
    envanteriYolla(ws);
    if (bildirim) frame(ws, 'sys.notice', bildirim);
    /* entity.pickup.id = ALAN varligin id'si. Istemcinin onPickup'i
       kind==='player'||'pet' ise alma animasyonu + sesi oynatir. */
    const kare = { id: ws.pet.entity.id };
    frame(ws, 'entity.pickup', kare);
    broadcast(ws.zoneId, 'entity.pickup', kare, ws);
    return true;
  }

  /** Sahibin cevresinde (petDetectRadiusU) alinabilir en yakin ganimet.
   *  [SIKAYET 3a] Kara listedeki (ulasilamadigi icin vazgecilen) ganimet
   *  suresi dolana kadar YENIDEN hedeflenmez - catchup isinlanmasi kilidi
   *  kirdiktan hemen sonra ayni ganimetin tekrar secilip tekrar kilitlemesi
   *  boyle onlenir (olcum: kilit kirilinca bir sonraki tikte ayni hedef).
   *  DIKKAT: bu kapsamda `p` diye bir degisken YOK; kara liste ws.pet
   *  uzerinden okunur (yanlis kapsam ReferenceError verir, tikGovde'nin
   *  try/catch'i yutar ve pet TAMAMEN olurdu). */
  function ganimetAra(ws, ayar) {
    const z = world.zoneState?.get(ws.zoneId);
    if (!z) return null;
    const kara = ws.pet?.kara;
    const simdi = Date.now();
    if (kara && kara.size > 64) {              // budama: uzun oturumda sinirsiz buyumesin
      for (const [k, t] of kara) if (t <= simdi) kara.delete(k);
    }
    let en = null, enD2 = G.detect * G.detect;
    for (const e of z.entities.values()) {
      if (e.kind !== 'ground_item') continue;
      if (kara && say(kara.get(e.id)) > simdi) continue;   // kara liste
      const d2 = uz2(e, ws.char);
      if (d2 > enD2) continue;
      if (!ganimetUygun(ws, e, ayar)) continue;
      en = e; enD2 = d2;
    }
    return en;
  }

  /* [SIKAYET 3a] Ganimet hedefi bu surede alinamazsa vazgecilir.
     KAYNAK: gameloop.js:51 ALMA_ZAMAN_ASIMI_MS = 15_000 - OYUNCUNUN elle
     alma yaklasmasinda ayni pencere zaten var (#almaTik); pet ayni kurali
     uygular. Olcum (sartname madde 5, gercek nav.bin, 5 bolge): '15 sn'de
     bitmeyen ULASILABILIR kovalama' tum bolgelerde %0.00 -> esik guvenli. */
  const HEDEF_ZAMAN_ASIMI_MS = 15000;
  /* Vazgecilen ganimetin yeniden hedeflenme yasagi. lootOwnerLockMs(15000)
     ve lootDespawnMs(60000) araliginda, zaman asimindan kisa bir sogusma;
     sartname madde 5/6 taslaginin olculmus degeri. */
  const KARA_MS = 10000;

  function petTik(ws, simdi, dtMs) {
    const p = ws.pet;
    const e = p.entity;
    if (bolgeSenkron(ws, p, 0)) { p.hedefGanimet = null; p.hedefBas = 0; return; }   // [DUZELTME 4]
    const zoneId = p.zoneId;

    // --- kiralama suresi ---
    if (p.expiresAt != null && simdi >= p.expiresAt) {
      frame(ws, 'sys.notice', { key: 'sys.pets.rental_expired', params: { pet: p.def.name } });
      petGonder(ws);
      return;
    }

    // --- yurumeyi ilerlet ---
    if (e.bacak) {
      const b = e.bacak;
      e.rotY = Math.atan2(b.tx - e.x, b.tz - e.z);
      bacakIlerlet(e, zoneId, dtMs, zoneGroundY);
      if (!e.bacak) e.gez = null;
    }

    const ch = ws.char;
    const d2Sahip = uz2(e, ch);

    /* --- cok uzakta kaldi: petCatchupU -> isinla ---
       [SIKAYET 3b - OLU BANT] Pet ganimete petCatchupU(45) ile DEGIL,
       catchup + pickupRangeU(3) = 48 ile ERISIR; tarama ise
       petDetectRadiusU(50) ile yapilir. Arada kalan 48-50 bandinda bu kapi,
       pickup kontrolunden ONCE atesleniyor ve pet petPickMs(500) araligiyla
       ayni ganimeti yeniden hedefleyip git-gel isinlaniyordu (olcum: 30
       sn'de ~10 isinlanma, ganimet HIC alinmiyor; L=48,49,50 -> 0/8).
       COZUM: bir ganimet hedefi TUTULURKEN kapi tarama yaricapina (detect)
       kadar askiya alinir. Hedef yokken davranis AYNEN korunur.
       ASLA `G.catchup - G.follow` (= 42.5) ile hedef kirpma KULLANMA:
       `follow` petin SAHIPTEN durma mesafesidir, ganimet ERISIMI degil;
       olculdu: su an calisan L=43..47 mesafeleri 0/6'ya duserdi. */
    if (G.catchup > 0 && d2Sahip > G.catchup * G.catchup &&
        (p.hedefGanimet == null || d2Sahip > G.detect * G.detect)) {
      const n = yanNokta(ws, 0);
      isinla(zoneId, e, n.x, n.z);
      /* Isinlanma sonrasi ANINDA yeniden kilitlenmeyi onle: ganimet hala
         detect(50) icinde oldugu icin bir sonraki tik onu tekrar secerdi. */
      if (p.hedefGanimet != null) (p.kara ??= new Map()).set(p.hedefGanimet, simdi + KARA_MS);
      p.hedefGanimet = null; p.hedefBas = 0;
      return;
    }

    const ayar = petAyari(ws);

    /* --- ganimet hedefi ---
       [SIKAYET 3a - KILITLENME] Eski kod gecerli hedefte yurut() cagirip
       KOSULSUZ return ediyordu; yurut() ise bacakKur() null donunce
       (bacak.js duz-cizgi dali `uzunluk < 1e-3`) hatayi SESSIZCE yutuyor
       (`if (!mv) { e.gez = null; return; }`). Ulasilamayan tek bir ganimet
       peti SONSUZA KADAR kilitliyordu: zaman asimi/vazgecme yoktu,
       hedefGanimet hic temizlenmiyordu (olcum: kovalamalarin %7-13'u
       kilitleniyor). Simdi: zaman asimi + bacak kurulamayinca ANINDA
       vazgecme + kara liste. */
    if (p.hedefGanimet != null) {
      const g = world.varlik?.(zoneId, p.hedefGanimet);
      const asti = simdi - say(p.hedefBas, simdi) > HEDEF_ZAMAN_ASIMI_MS;
      if (!g || !ganimetUygun(ws, g, ayar) || asti) {
        if (asti && g) (p.kara ??= new Map()).set(g.id, simdi + KARA_MS);
        p.hedefGanimet = null; p.hedefBas = 0; durdur(zoneId, e);
      } else if (uz2(g, e) <= G.pickup * G.pickup) {
        durdur(zoneId, e);
        petAlir(ws, g);
        p.hedefGanimet = null; p.hedefBas = 0;
        return;
      } else {
        yurut(zoneId, e, g.x, g.z, say(p.def.runSpeedU, say(p.def.walkSpeedU, 7.5)));
        if (!e.bacak) {                    // yol KURULAMADI -> VAZGEC
          (p.kara ??= new Map()).set(g.id, simdi + KARA_MS);
          p.hedefGanimet = null; p.hedefBas = 0;
        } else return;
      }
    }

    // --- yeni ganimet taramasi (gameConfig.petPickMs = 500) ---
    if (ayar.grab && !ch.dead && simdi - p.sonTarama >= G.pickMs) {
      p.sonTarama = simdi;
      const g = ganimetAra(ws, ayar);
      if (g) { p.hedefGanimet = g.id; p.hedefBas = simdi; return; }
    }

    /* --- sahibi takip ---
       [PET AYRISMA] Kendi yuvasina (changelog 0003 "yan yana ilerliyor") ve
       sahibin hizina uyarak (changelog 0003 "keep pace properly") - eski
       kod iki peti de pet->sahip dogrusu uzerindeki AYNI noktaya sabit
       katalog hiziyla yurutuyordu (olcum: 200/200 kosuda mesafe < 1.0u). */
    const d = Math.sqrt(d2Sahip);
    if (d > G.followStart) {
      p.yuvaDuzelt = false;   // [S1 MADDE 5] normal takip devrede - duzeltme birakilir
      const n = hedefYuva(ws, 0, simdi);   // [S1 MADDE 5] capraz gecis onleyen atama
      const sapma = Math.hypot(n.x - e.x, n.z - e.z);
      yurut(zoneId, e, n.x, n.z, yuvaHizi(ws, p.def, d, sapma), YUVA_SAPMA_DUR);
    } else {
      yuvaAyris(ws, p, 0, e, p.def, simdi);   // [S1 MADDE 5] 8u icinde de yuva ayrismasi
      if (!e.bacak) e.y = zoneGroundY(zoneId, e.x, e.z, e.y);
    }
  }

  // ================================================================ GELISIM PETI
  function gpetSatir(g) {
    const def = g.def;
    const lv = Math.min(Math.max(1, g.level), def.levels.length);
    return def.levels[lv - 1];
  }

  function gpetXpToNext(level) {
    if (level >= MAX_SEVIYE) return null;
    const v = Number(XP_TABLOSU[String(level)] ?? 0);
    return v > 0 ? v : null;
  }

  function gpetDurum(ws, zorla = true) {
    const g = ws.gpet;
    const simdi = Date.now();
    if (!zorla && simdi - (ws._gpetSonDurum ?? 0) < GPET_DURUM_ARALIK_MS) return null;
    ws._gpetSonDurum = simdi;
    const d = { active: !!g && !g.dead };
    if (g) {
      const s = gpetSatir(g);
      d.petId = g.petId;
      if (g.entity) d.entityId = g.entity.id;
      d.bagSlot = g.bagSlot;
      d.level = g.level;
      d.xp = Math.round(g.xp);
      d.xpToNext = gpetXpToNext(g.level);
      d.hp = Math.max(0, Math.round(g.hp));
      d.maxHp = say(s.maxHp, 1);
      d.hgp = Math.max(0, Math.round(g.hgp));
      d.hgpMax = g.hgpMax;
      d.dead = !!g.dead;
      d.mode = g.mode;
      // olu pet de "aktif" sayilir: pencere onu diriltmek icin gosterir
      d.active = true;
    }
    frame(ws, 'gpet.state', d);
    return d;
  }

  /** Esya kaydina (rolls) yaz - istemci ipucu bunu okuyor. */
  function gpetRollsYaz(ws) {
    const g = ws.gpet;
    if (!g) return;
    const it = cantaEsyasi(ws.char, g.bagSlot);
    if (!it || ITEMSTATS.get(it.itemId)?.growthPetId !== g.petId) return;
    const r = rolls(it);
    r.petLevel = g.level;
    r.petXp = Math.round(g.xp);
    r.petHp = Math.max(0, Math.round(g.hp));
    r.petHgp = Math.max(0, Math.round(g.hgp));
    r.petDead = g.dead ? 1 : 0;
  }

  async function gpetKaydet(ws) {
    const g = ws.gpet;
    if (!web || !g) return;
    const cid = Number(ws.char?.id);
    if (!Number.isInteger(cid)) return;
    try {
      const sql = (await import('mssql')).default;
      await web.request()
        .input('c', sql.Int, cid)
        .input('b', sql.Int, g.bagSlot)
        .input('m', sql.VarChar(12), g.mode)
        .input('l', sql.Int, g.level)
        .input('x', sql.BigInt, Math.round(g.xp))
        .query(`MERGE dbo.WebCharGrowthPet AS t USING (SELECT @c AS CharID) AS s
                  ON t.CharID = s.CharID
                WHEN MATCHED THEN UPDATE SET bagSlot=@b, mode=@m, level=@l, xp=@x, updatedAt=GETDATE()
                WHEN NOT MATCHED THEN INSERT (CharID,bagSlot,mode,level,xp,updatedAt)
                  VALUES (@c,@b,@m,@l,@x,GETDATE());`);
    } catch (err) { log('gpet kaydedilemedi:', String(err.message).slice(0, 120)); }
  }

  async function gpetYukle(charId) {
    if (!web) return null;
    const cid = Number(charId);
    if (!Number.isInteger(cid)) return null;
    try {
      const sql = (await import('mssql')).default;
      const r = await web.request().input('c', sql.Int, cid)
        .query('SELECT TOP 1 bagSlot, mode, level, xp FROM dbo.WebCharGrowthPet WHERE CharID=@c');
      return r.recordset?.[0] ?? null;
    } catch (err) { log('gpet okunamadi:', String(err.message).slice(0, 120)); return null; }
  }

  function gpetCagir(ws, d) {
    const ch = ws.char;
    if (!ch) return true;
    if (ch.dead) return hata(ws, 'ERR_DEAD');
    if (ws.gpet) return hata(ws, 'ERR_PET_STATE', 'err.gpet.unsummon_first');
    /* CAGIRMA reddinde ANAHTAR VERILMEZ. err.gpet.in_combat yalnizca GERI
       GONDERME metnidir - paket @25841647 (EN dil tablosu):
         "Your pet cannot be unsummoned while it is fighting."
       Cagirma reddinin dogru metni kod-bazli err.ERR_PET_COMBAT
       (tr.json: "Savas sirasinda pet cagirilamaz."). Istemci err isleyicisi
       key varsa onu, yoksa `err.${code}` anahtarini basiyor (paket @27135792),
       yani anahtari dusurmek dogru metni getirir.
       petCagir() (satir ~555) zaten anahtarsiz - ikisi artik tutarli.
       Geri gonderme dalinda (gpetGeriGonder) anahtar AYNEN KALIR. */
    if (savasKilidinde(ws, Date.now())) return hata(ws, 'ERR_PET_COMBAT');

    const slot = Number(d?.bagSlot);
    const it = cantaEsyasi(ch, slot);
    if (!it) return hata(ws, 'ERR_NOT_FOUND');
    const def = ITEMSTATS.get(it.itemId);
    if (!def || def.type !== 'growthPetFlute') return hata(ws, 'ERR_VALIDATION');
    const gd = GPETS.get(def.growthPetId);
    if (!gd) return hata(ws, 'ERR_NOT_FOUND');
    const gerek = Math.max(G.reqLevel, say(def.reqLevel, 1));
    if (say(ch.level, 1) < gerek) return hata(ws, 'ERR_REQ_LEVEL');

    const r = rolls(it);
    // olu pet cagirilamaz: once diriltilmeli (err.gpet.dead_revive)
    if (r.petDead === 1) return hata(ws, 'ERR_PET_STATE', 'err.gpet.dead_revive');

    const hgpMax = say(G.gp.hgpMax, 10000);
    const level = Math.min(Math.max(1, say(r.petLevel, 1)), gd.levels.length);
    const satir = gd.levels[level - 1];

    const n = yanNokta(ws, 1);   // [PET AYRISMA] gelisim petinin yuvasi = 1
    const e = {
      id: world.yeniVarlikId(), kind: 'growth_pet',
      modelKey: satir.modelKey, name: satir.name,
      x: n.x, z: n.z, y: zoneGroundY(ws.zoneId, n.x, n.z, ch.y), rotY: say(ch.rotY),
      /* [DENETIM DUZELTMESI 6] HP tabani 1. Pet oldugunde gpetRollsYaz
         `rolls.petHp = 0` yaziyor; olu bayragi sonradan temizlenirse (dirilis)
         bu 0 oldugu gibi geri okunuyor ve CANLI ama 0 HP'li bir pet cikiyordu -
         ilk hasarin oncesinde bile "olu" gibi davranan bir varlik.
         say(0, varsayilan) 0 doner (0 gecerli sayidir), o yuzden Math.max sart. */
      level,
      hp: Math.max(1, Math.min(say(r.petHp, satir.maxHp), say(satir.maxHp, 1))),
      maxHp: say(satir.maxHp, 1),
      dead: false, scalePct: say(satir.scalePct, 100), sahipEntityId: ws.entityId,
      gez: null, bacak: null,
    };
    world.varlikEkle(ws.zoneId, e);

    ws.gpet = {
      petId: gd.id, def: gd, entity: e, bagSlot: slot,
      zoneId: ws.zoneId,                       // [DUZELTME 4] varligin GERCEK bolgesi
      level, xp: say(r.petXp, 0),
      hp: e.hp, hgp: Math.min(say(r.petHgp, hgpMax), hgpMax), hgpMax,
      dead: false, mode: ws._gpetMod ?? 'defensive',
      hedefId: null, sonVurus: 0, sonDrain: Date.now(), acUyarildi: false,
    };
    oyuncular.add(ws);
    varligiYay(ws.zoneId, e);
    petBelirdiFx(ws.zoneId, e.id);   // fx.petAppear (198) - kind growth_pet: ses de calar
    gpetDurum(ws);
    gpetRollsYaz(ws); envanteriYolla(ws);
    /* [S1 MADDE 7 - changelog 0007 tr:21 "Sectigin mod da artik hatirlaniyor"]
       IKI degisiklik BIRLIKTE:
       (A) Buradaki ERKEN gpetKaydet(ws) SILINDI - SELECT'ten once calisan
           MERGE, kayitli 'offensive' modu daha cagirma aninda 'defensive'
           ile eziyordu.
       (B) Asagida MOD, seviye/xp guard'indan ONCE geri yuklenir - eski kod
           `row.level <= g.level && row.xp <= g.xp` iken erken donuyordu ve
           gpetRollsYaz rolls'u hep guncel tuttugu icin mod atamasi fiilen
           OLU YOLDU. gpetKaydet artik yuklemeden SONRA kosuyor: ezmez, ilk
           cagirmada satiri olusturur. */
    gpetYukle(ch.id).then(async (row) => {
      const g = ws.gpet;
      if (!g || g.bagSlot !== slot) return;
      if (row) {
        /* MOD ONCE geri yuklenir - guard'a takilmasin */
        if (row.mode === 'offensive' || row.mode === 'defensive') {
          g.mode = row.mode;
          ws._gpetMod = row.mode;
        }
        if (say(row.level, 0) > g.level || say(row.xp, 0) > g.xp) {
          g.level = Math.min(Math.max(1, say(row.level, g.level)), gd.levels.length);
          g.xp = say(row.xp, g.xp);
          gpetSeviyeUygula(ws);
        }
        gpetDurum(ws);   /* istemci geri yuklenen modu gorsun */
      }
      await gpetKaydet(ws);   /* yuklemeden SONRA: artik ezmez; ilk cagirmada satiri olusturur */
      gpetAcikYaz(ws, true);  /* [S1 MADDE 4] satir artik kesin var - acik=1 (matched-update) */
    }).catch(() => {});
    return true;
  }

  /** Seviye satirini varlik alanlarina yansitir (model, ad, maxHp, olcek). */
  function gpetSeviyeUygula(ws) {
    const g = ws.gpet;
    if (!g) return;
    const s = gpetSatir(g);
    const e = g.entity;
    if (!e) return;
    e.level = g.level;
    e.maxHp = say(s.maxHp, 1);
    e.name = s.name;
    e.scalePct = say(s.scalePct, 100);
    if (e.modelKey !== s.modelKey) {
      /* evolveLevel'da model degisiyor (p_wolf_01 -> p_wolf_02). Istemci
         modelKey'i sonradan degistiremez: varligi kaldirip yeniden ekliyoruz. */
      const zoneId = g.zoneId ?? ws.zoneId;
      varligiKaldir(zoneId, e.id);
      e.modelKey = s.modelKey;
      e.id = world.yeniVarlikId();
      world.varlikEkle(zoneId, e);
      varligiYay(zoneId, e);
    }
    g.hp = Math.min(g.hp, e.maxHp);
    e.hp = g.hp;
  }

  function gpetGonder(ws, sessiz = false) {
    const g = ws.gpet;
    if (!g) { if (!sessiz) gpetDurum(ws); return true; }
    if (!sessiz) {
      if (g.dead) return hata(ws, 'ERR_PET_STATE', 'err.gpet.dead_no_dismiss');
      if (g.hedefId != null) return hata(ws, 'ERR_PET_COMBAT', 'err.gpet.in_combat');
    }
    if (g.entity) varligiKaldir(g.zoneId ?? ws.zoneId, g.entity.id);
    gpetRollsYaz(ws);
    ws._gpetMod = g.mode;
    gpetKaydet(ws);
    /* [S1 MADDE 4] yol bazli bayrak: gpet KAPALI (bilerek dismiss, aclik,
       olum-sonrasi geri donus). ws.gpet HALA DOLU - gpetAcikYaz NOT MATCHED
       degerlerini senkron okur. temizle (cikis) buradan GECMEZ. */
    gpetAcikYaz(ws, false);
    ws.gpet = null;
    if (!sessiz) { gpetDurum(ws); envanteriYolla(ws); }
    return true;
  }

  function gpetKomut(ws, d) {
    const g = ws.gpet;
    if (!g) return hata(ws, 'ERR_PET_STATE');
    if (g.dead) return hata(ws, 'ERR_PET_STATE', 'err.gpet.dead');
    switch (d?.op) {
      case 'attack': {
        const hedef = world.varlik?.(ws.zoneId, Number(d.targetId));
        if (!hedef || hedef.kind !== 'monster' || hedef.dead || say(hedef.hp) <= 0) {
          return hata(ws, 'ERR_NOT_FOUND');
        }
        g.hedefId = hedef.id;
        gpetDurum(ws);
        return true;
      }
      case 'follow':
        g.hedefId = null;
        if (g.entity) durdur(g.zoneId ?? ws.zoneId, g.entity);
        gpetDurum(ws);
        return true;
      case 'mode':
        if (d.mode !== 'offensive' && d.mode !== 'defensive') return hata(ws, 'ERR_VALIDATION');
        g.mode = d.mode;
        ws._gpetMod = d.mode;
        /* [S1 MADDE 6] changelog 0007 tr:21 - "Kavganin ortasinda onu
           Savunmaci moda almak... kurdu oracikta geri cagiriyor": defensive,
           follow ile ayni kalipla kavgayi keser (olcum olcum_gpet_mode.mjs:
           eskiden hedefId kaliyor, vurus devam ediyordu). Bilinen ve kabul
           edilen etki: defensive'e gecis ERR_PET_COMBAT kapisini acar -
           'follow' komutu ayni kapiyi zaten aciyor, yeni istismar degil. */
        if (d.mode === 'defensive' && g.hedefId != null) {
          g.hedefId = null;
          if (g.entity) durdur(g.zoneId ?? ws.zoneId, g.entity);
        }
        gpetKaydet(ws);
        gpetDurum(ws);
        return true;
      default:
        return hata(ws, 'ERR_VALIDATION');
    }
  }

  // ---------------------------------------------------------- pet savas hesabi
  /** combat.js #rulo ile ayni: t = u^((s+ER)/(s+HR)). */
  function rulo(hitRatio, parryRatio) {
    const s = say(CC.rollShape?.softness, 100);
    return Math.pow(Math.random(), (s + parryRatio) / (s + hitRatio));
  }
  /**
   * [madde 30] Hedefin KACINMA (ER) orani - rollShape ustelinin PAYI.
   *
   * KOK HATA: burada mobun `par` sutunu okunuyordu. mobs.json'da `par` mobun
   * SEVIYESIDIR (mob_mangyang par=1 level=1, mob_gyo par=5 level=5), kacinma
   * ise ayri bir sutundur (`er`: mangyang 27, gyo 35) - 158/158 mobda ikisi
   * de dolu. Yanlis sutun ustelin payini kucultup (100+1)/(100+HR) yapiyordu;
   * dogrusu (100+27)/(100+HR). u^kucukUs > u^buyukUs oldugu icin rulolar
   * bandin UST ucuna kayiyor, pet sistematik olarak fazla hasar veriyordu.
   * Cekirdek combat.js kacinmaOrani()'nda; iki tanim AYRISMASIN diye buradan
   * ona devrediyoruz. combat baglanmamissa (ctx.combat null) ayni sutundan
   * yerel okuma yapilir - yedek deger combat.json parry.base/perLevel'dan.
   */
  const kacinma = (mob, mLv) => (typeof combat?.kacinmaOrani === 'function')
    ? say(combat.kacinmaOrani(mob, mLv), say(CC.parry?.base, 10) + mLv)
    : say(mob?.def?.combat?.ratings?.er,
          say(CC.parry?.base, 10) + say(CC.parry?.perLevel, 1) * mLv);

  /** combat.js #seviyeFarkiCarpani ile ayni. */
  function seviyeFarki(a, b) {
    const lg = CC.levelGap ?? { slope: 0, cap: 0, floor: 0 };
    return 1 + Math.min(say(lg.cap), Math.max(say(lg.floor), say(lg.slope) * (a - b)));
  }

  /**
   * Gelisim peti -> canavar. Sira combat.js vurus()/canavarVurusu() ile AYNI:
   *   ham atak -> savunma -> KATSAYI -> seviye farki -> kritik
   *   -> damageScale -> minDamage
   *
   * [DENETIM DUZELTMESI 1] `combatConfig.pets.growthAttackRateH` (1.04)
   * combat.json'in kendi yorumunda "growth-pet default-skill WEAPON
   * COEFFICIENT (H stage)" diye tanimli. combat.js silah katsayisini
   * (base-attacks coefficientPct) savunma dusuldukten SONRA carpiyor
   * (combat.js: `if (taban?.coefficientPct) hasar *= taban.coefficientPct/100`).
   * Bu deger 1.04 zaten ORAN (yuzde degil), o yuzden dogrudan carpilir.
   * ONCEDEN: vurus TEMPOSUNU bolen bir sayi olarak kullaniliyordu
   * (swingMs / 1.04) - hicbir kaynak bunu soylemiyor.
   *
   * [DENETIM DUZELTMESI 2] `lowHgpFactor` (0.5) ac pete uygulanir.
   * combat.json yorumu: "multiplier on a hungry growth pet's HIT RATIO and
   * DEFENSES"; istemci gpet penceresi (@27398092) hgp<=3000 iken
   * attackMin/attackMax'i `>>>1`, physDef/magDef/hitRatio/parryRatio'yu
   * `Math.trunc(x/2)` gosteriyor; tr.json ui.gpet.low_hgp = "savas
   * degerleri yariya indi". Yani atak VE isabet oraninin ikisi de yariya
   * iner. ONCEDEN yalnizca atak yariya iniyordu, hitRatio tam kaliyordu.
   */
  function petVurusu(g, mob) {
    const s = gpetSatir(g);
    const dusuk = g.hgp <= g.hgpMax * say(G.gp.hgpLowFrac, 0);
    const k = dusuk ? say(PETCFG.lowHgpFactor, 1) : 1;   // ac pet: combatConfig.pets.lowHgpFactor
    const min = say(s.attackMin) * k, max = say(s.attackMax) * k;
    const mLv = say(mob.level, 1);

    const t = rulo(say(s.hitRatio) * k, kacinma(mob, mLv));   // madde 30: `er`, `par` DEGIL
    let hasar = min + t * Math.max(0, max - min);
    hasar = Math.max(0, hasar - say(mob.def?.physDef, mLv * 2));
    hasar *= say(PETCFG.growthAttackRateH, 1);   // silah katsayisi (H) - savunmadan SONRA
    hasar *= seviyeFarki(g.level, mLv);

    const kritikSans = Math.min(say(CC.crit?.capPct, 0),
                                say(s.critRating) * say(CC.crit?.pctPerRating, 0)) / 100;
    const kritik = kritikSans > 0 && Math.random() < kritikSans;
    if (kritik) hasar *= say(CC.crit?.physMult, 1);

    /* [madde 11] damageScale matrisi TEK yardimcidan okunur (combat.hasarOlcegi).
       data/combat.json damageScale $comment: "Applied once in applyDamage to
       every rolled hit's components. Source kinds: player | monster | pet
       (growth pets AND hawk strikes count as pet)"; sema paket @8657858
       (playerVsPlayer ... petVsPet, hepsi default 100).
       petVsMonster bugun 100 yani NO-OP; degisen tek deger monsterVsPlayer=80
       ve o combat.js'te uygulaniyor. Buradaki degisiklik davranisi bugun
       DEGISTIRMEZ - matrisin tek yerden okunmasini garanti eder ki oyuncu /
       canavar / pet yollari birbirinden ayrismasin.
       MUAF (matris yorumu): burn/poison/blooding tikleri, true damage
       (yansitma, drain) ve iyilestirmeler - o kanallar bu satirdan gecmez. */
    hasar *= (typeof combat?.hasarOlcegi === 'function'
      ? combat.hasarOlcegi('pet', 'monster')
      : say(CC.damageScale?.petVsMonster, 100)) / 100;
    return { hasar: Math.max(say(CC.minDamage, 1), Math.floor(hasar)), kritik };
  }

  /** _RefDropOptLvlSel ReqOnlineTime kapisi icin oturum dakikasi.
   *  sistem_beceri.js:oturumDakikasi ile BIREBIR ayni: damgayi gameloop.js
   *  tikta koyar (ws._oturumT0 = Date.now()), damga yoksa null doner ve
   *  combat.plusUret() kapiyi HIC uygulamaz - eksik olcum "hep +0" uretmesin.
   *  Saat kaynagi bilerek Date.now(): damgayi koyan taraf da Date.now()
   *  yaziyor, modulun kendi `simdi()` sahte saati ile karistirilmamali. */
  const oturumDakikasi = (ws) => (ws?._oturumT0 ? (Date.now() - ws._oturumT0) / 60_000 : null);

  /** Pet oldurdu: odul + ganimet (gameloop.js #olum/#ganimetDus ile ayni akis). */
  function gpetOldurdu(ws, mob) {
    const zoneId = ws.gpet?.zoneId ?? ws.zoneId;   // [DUZELTME 4] mob petin bolgesinde
    const petId = ws.gpet?.entity?.id ?? ws.entityId;
    /* [madde 22 / fark #53] Respawn gecikmesi YUVADAN gelir: world.js dogusta
       varliga respawnMinMs/respawnMaxMs yaziyor (data/spawns.json
       respawnDelaySec = Tab_RefNest.dwDelayTimeMin/Max; yuva semasi paket
       @8718198 `respawnMinMs / respawnMaxMs: Y().int().positive()`).
       Buradaki sabit 30_000 hicbir kaynaktan gelmiyordu. OLCUM (bu depodaki
       data/spawns.json, TUM 5 bolge = 7350 yuva, sayildi): 2374'u (%32.3)
       tam [8,12] sn, 595'i [10,15], 30 sn'yi KAPSAYAN yalnizca 287 (%3.9).
       (Yalniz jangan_province: 825 yuvanin 698'i [8,12], 30 sn kapsayan 0.)
       Argumani HIC vermiyoruz - world.olumKaydet yuvanin kendi penceresini
       cozer; veri yoksa varsayilanini kendisi uygular. */
    world.olumKaydet?.(zoneId, mob);
    const olay = { id: mob.id, killerId: petId };
    frame(ws, 'combat.death', olay);
    broadcast(zoneId, 'combat.death', olay, ws);
    if (ws.hedefId === mob.id) ws.hedefId = null;
    if (ws.savas?.hedefId === mob.id) ws.savas = null;
    if (!combat) return;

    // --- sahibin odulu ---
    const { xp, spExp } = combat.odul(mob, ws.char);
    /* FARK #0/#180 (capraz istek 49) - PARTI XP/SP PAYLASIMI: pet oldurmesi
       de ayni ortak noktadan dagitilir (gameloop.#odulUygula deseni);
       partisiz oyuncuda tek kayit doner, davranis birebir korunur. */
    const dagilim = sistemOrnegi?.('parti')?.paylasimHesapla?.(ws, xp, spExp)
      ?? [{ ws, xp: Math.max(0, xp), spExp: Math.max(0, spExp) }];
    let sahipPayi = Math.max(0, xp);
    const odulUygula = (hedefWs, payXp, paySp) => {
      const ch = hedefWs.char;
      /* PREMIUM XP/SP bonusu (D5-C) - ALICI BASINA, dagitimdan SONRA;
         gameloop.#odulUygula / sistem_beceri.odulUygula ile AYNI kural.
         Katsayilar combat.premiumBonusPct() (paket @9299985 $comment
         "additive % boost to XP and SP from monster kills"; bronze 10
         @9300246 / silver 15 @9300566 / gold 20 @9300882). DIKKAT:
         `sahipPayi` dongude d.xp (carpim ONCESI ham pay) ile dolduruluyor -
         gpetXpEkle(ws, sahipPayi) HAM kalir; gelisim peti premium bonusu
         ALMAZ (growth-pets.json ve @9097648 growthPets blogunda premium
         anahtari YOK, kesinlik belirsiz -> bugunku davranis korunur). */
      const prem = combat.premiumCarpani?.(ch) ?? 1;
      if (prem !== 1) {
        payXp = Math.max(0, Math.round(payXp * prem));
        paySp = Math.max(0, Math.round(paySp * prem));
      }
      const sonuc = combat.xpEkle(ch, payXp);
      combat.spEkle(ch, paySp);
      const xpToNext = Number(combat.progress?.xpToNext?.[String(ch.level)] ?? 0) || null;
      frame(hedefWs, 'progress.update', {
        xp: ch.xp, xpToNext, spExp: ch.spExp,
        spExpToNext: combat.progress?.spExpPerSpPoint ?? 400, sp: say(ch.sp),
      });
      if (payXp > 0 || paySp > 0) {
        frame(hedefWs, 'sys.notice', { key: 'sys.progress.xp', params: { xp: Math.max(0, payXp), sp: Math.max(0, paySp) } });
      }
      if (sonuc?.seviyeAtladi) {
        frame(hedefWs, 'progress.levelUp', { level: ch.level, statPoints: say(ch.statPoints) });
        frame(hedefWs, 'sys.notice', { key: 'sys.progress.level_up', params: { level: ch.level } });
        if (derived) { const dd = derived(ch); ch.hp = dd.maxHp; ch.mp = dd.maxMp; }
        frame(hedefWs, 'vitals.update', { hp: ch.hp, mp: ch.mp });
        /* FARK #103 (capraz istek 48): seviye degisti -> gorev katalogu tazele. */
        try { sistemOrnegi?.('gorev')?.katalogGonder?.(hedefWs); } catch { /* modul yok */ }
      }
    };
    for (const d of dagilim) {
      if (!d?.ws?.char) continue;
      if (d.ws === ws) sahipPayi = Math.max(0, d.xp ?? 0);
      odulUygula(d.ws, d.xp ?? 0, d.spExp ?? 0);
    }

    /* FARK #101/#145 - gorev oldurme sayaci: pet oldurmesi de saymali
       (gameloop.#oldurmeBildir kurali: pay 720720/kisi dagilimdaki HERKESE
       yazilir; bolmeyi sayacArtir kendisi yapar, mob NESNESI verilebilir).
       GOREV.oldurmeKaydet KULLANMA: paylasimHesapla'yi iceride yeniden
       cagirir (ayni tikte cift indeks taramasi). */
    const GOREV = sistemOrnegi?.('gorev');
    if (GOREV?.sayacArtir) {
      for (const d of dagilim) {
        if (!d?.ws?.char) continue;
        try { GOREV.sayacArtir(d.ws, mob, dagilim.length); }
        catch (e) { /* gorev modulu yoksa pet olumu durmasin */ }
      }
    }

    // --- petin XP'si: growthPets.xpShareFrac * petXpRate (sahibin PAYI uzerinden) ---
    gpetXpEkle(ws, sahipPayi);

    // --- ganimet ---
    /* [madde 51] Ganimet SAHIBI gecirilir: combat.ganimetKapisi seviye farkini
       (sahipSeviyesi - mobSeviyesi >= noDropDeltaMin 9) burada uyguluyor.
       Kaynak: data/progress.json levelGapPolicy.noDropDeltaMin = 9 ve
       data/drops.json monsterRewards.noDropDeltaMin = 9. Tek argumanla
       cagrilinca kapi kapali kaliyordu - pet oldurmesi bu kapiyi atlatan bir
       kacak yoldu. Sahip PETIN DEGIL oyuncunun karakteridir (odul/XP de
       ws.char'a yaziliyor). */
    const gan = combat.ganimet(mob, ws.char);
    const eklenen = [];
    const koy = () => {
      const a = Math.random() * Math.PI * 2, r = 1 + Math.random() * 2;
      return { x: mob.x + Math.cos(a) * r, z: mob.z + Math.sin(a) * r };
    };
    const yarat = (alan) => {
      const p = koy();
      const e = {
        id: world.yeniVarlikId(), kind: 'ground_item',
        /* madde 7 / capraz istek 5: groundY'ye TOHUM olarak olen mobun y'si -
           kopru ustunde olen mobun ganimeti alt kata dusmesin. */
        x: p.x, z: p.z, y: zoneGroundY(zoneId, p.x, p.z, mob.y), rotY: 0,
        sahip: ws.entityId, sahipBitis: Date.now() + say(GCFG.lootOwnerLockMs, 15000),
        bitis: Date.now() + say(GCFG.lootDespawnMs, 60000),
        ...alan,
      };
      world.varlikEkle(zoneId, e);
      const pl = { id: e.id, kind: 'ground_item', modelKey: e.modelKey, name: e.name,
                   x: +e.x.toFixed(2), z: +e.z.toFixed(2), y: +e.y.toFixed(2), rotY: 0 };
      if (e.itemId) { pl.itemId = e.itemId; pl.qty = say(e.qty, 1); }
      if (e.gold) { pl.gold = e.gold; pl.qty = say(e.qty, 1); }
      eklenen.push(pl);
    };
    if (gan.gold > 0) yarat({ modelKey: 'drop_item_bag', name: `${gan.gold} Gold`, gold: gan.gold, qty: 1 });
    for (const it of gan.items.slice(0, 4)) {
      const def = ITEMSTATS.get(it.itemId);
      const adet = Array.isArray(it.qty) ? it.qty[0] : say(it.qty, 1);
      /* MADDE 26 (2026-09-05): `yigin` alani EKLENDI. Eskiden bu yol hic
         yigin kurmuyordu; alinirken gameloop #cantayaEkle'nin
         `yeniYigin(def, k)` YEDEGINE dusuluyor ve o yedek ucuncu argumani
         vermedigi icin pet oldurmesinden dusen esya variance=0/plus=0 VE
         dur/maxDur'suz cantaya giriyordu (yani "niteliksiz" - hem hep aralik
         ALT SINIRI hem tamir edilemez gorunum). Artik yerdeki esya ile
         cantaya giren AYNI kayit: gameloop.js #ganimetDus ve
         sistem_beceri.js ganimetDus ile BIREBIR ayni cagri.
         Sahip PETIN DEGIL oyuncudur (XP/odul de ws.char'a yaziliyor), bu
         yuzden ReqOnlineTime kapisi da oyuncunun oturumundan okunur.
         `combat.dususOrnegi` yoksa undefined gecer -> yeniYigin kendi
         `secenek = {}` varsayilanina duser, catlamaz. */
      yarat({ modelKey: def?.modelKey ?? 'drop_item_bag', name: def?.name ?? it.itemId,
              itemId: it.itemId, qty: adet,
              yigin: esya.yeniYigin(def ?? it.itemId, adet,
                combat?.dususOrnegi?.(def, { cevrimiciDk: oturumDakikasi(ws) })) });
    }
    if (eklenen.length) {
      frame(ws, 'state.delta', { add: eklenen });
      broadcast(zoneId, 'state.delta', { add: eklenen }, ws);
      for (const c of world.bolgeOyunculari?.(zoneId) ?? []) {
        for (const p of eklenen) c.gorunen?.add(p.id);
      }
    }
  }

  /** Gelisim petine XP verir (growthPets.xpShareFrac x petXpRate). */
  function gpetXpEkle(ws, hamXp) {
    const g = ws.gpet;
    if (!g || g.dead || !(hamXp > 0)) return;
    const kazanc = Math.round(hamXp * say(G.gp.xpShareFrac, 1) * G.xpRate);
    if (kazanc <= 0) return;
    g.xp += kazanc;
    const s0 = gpetSatir(g);
    frame(ws, 'sys.notice', { key: 'sys.gpet.xp', params: { name: s0.name, xp: kazanc } });

    let atladi = false;
    for (;;) {
      const gerek = gpetXpToNext(g.level);
      if (gerek == null || g.level >= g.def.maxLevel || g.xp < gerek) break;
      g.xp -= gerek;
      g.level++;
      atladi = true;
    }
    if (atladi) {
      gpetSeviyeUygula(ws);
      const s = gpetSatir(g);
      g.hp = say(s.maxHp, 1);                 // seviye atlayinca doldur (oyuncuda da boyle)
      if (g.entity) g.entity.hp = g.hp;
      frame(ws, 'sys.notice', { key: 'sys.gpet.level_up', params: { name: s.name, level: g.level } });
      gpetKaydet(ws);
    }
    gpetRollsYaz(ws);
    gpetDurum(ws, atladi);
  }

  /** Gelisim petine hasar - combat.js/gameloop.js cagirabilir. */
  function petHasar(ws, dmg, kaynakId = 0) {
    const g = ws?.gpet;
    if (!g || g.dead) return false;
    g.hp = Math.max(0, g.hp - Math.max(0, say(dmg)));
    if (g.entity) {
      g.entity.hp = g.hp;
      const hp = { id: g.entity.id, hp: Math.round(g.hp), maxHp: g.entity.maxHp };
      frame(ws, 'entity.hp', hp);
      broadcast(ws.zoneId, 'entity.hp', hp, ws);
    }
    // savunmaci mod: saldirana karsilik verir (ui.gpet.stance_defensive)
    if (g.hp > 0 && g.hedefId == null && kaynakId) {
      const kaynak = world.varlik?.(ws.zoneId, kaynakId);
      if (kaynak?.kind === 'monster' && !kaynak.dead) g.hedefId = kaynak.id;
    }
    if (g.hp <= 0) gpetOldu(ws, kaynakId);
    else gpetDurum(ws, false);
    return true;
  }

  function gpetOldu(ws, katilId = 0) {
    const g = ws.gpet;
    if (!g) return;
    g.dead = true; g.hp = 0; g.hedefId = null;
    if (g.entity) {
      const olay = { id: g.entity.id, killerId: katilId || ws.entityId };
      frame(ws, 'combat.death', olay);
      broadcast(ws.zoneId, 'combat.death', olay, ws);
      varligiKaldir(g.zoneId ?? ws.zoneId, g.entity.id);
      g.entity = null;
    }
    gpetRollsYaz(ws); envanteriYolla(ws);
    gpetDurum(ws);
    gpetKaydet(ws);
  }

  /**
   * ================== [DENETIM DUZELTMESI 5] PET ESYASI (petConsumable) ======
   * Bu modul olmadan olu gelisim peti KILITLENIYORDU: gpet.dismiss ->
   * err.gpet.dead_no_dismiss, gpet.summon -> err.gpet.dead_revive; diriltecek
   * bir yol yoktu ve game-config'deki growthPets.reviveHpFrac (0.25) hic
   * kullanilmiyordu.
   *
   * KAYNAK (uydurma yok):
   *   c2s  T$(`inv.use`, 49, X({ bagSlot: int 0..159,
   *                             petTarget: lht.optional() }), `inv`)  @25609306
   *        lht = qJ([`growth`, `mount`])                              @25595312
   *   istemci k2(bagSlot, petTarget): type==='petConsumable' ise
   *        cooldown grubu `gpet.${def.action}` ile inv.use yollar     @25927862
   *   data/itemstats.json petConsumable (5 adet):
   *        pet_revival_grass   action revive  amount 0     cooldownMs 1000
   *        pet_hgp_potion_01   action hgp     amount 1000  cooldownMs 1000
   *        cos_hp_potion_01/02/03 action hp   amount 360/660/1110
   *   tr.json err.gpet.mount_invalid = "Ata sadece iyilestirme kiti
   *        kullanilabilir." -> ata SADECE action==='hp' uygulanir.
   *   tr.json err.gpet.no_dead = "Diriltilecek olu petin yok."
   *   revive miktari esyada 0 -> game-config growthPets.reviveHpFrac 0.25
   *
   * DONUS SOZLESMESI (cagiran sistem_envanter.js'e):
   *   null  -> bu esya bizim degil, cagiran kendi isini yapsin
   *   true  -> uygulandi, cagiran 1 adet DUSURSUN
   *   false -> bizim esyamiz ama uygulanamadi; `err` ZATEN gonderildi,
   *            cagiran esyayi DUSURMESIN ve IKINCI bir err yollamasin
   */
  function esyaKullan(ws, def, petTarget) {
    if (!ws?.isAuthed || !ws.char) return null;
    if (!def || def.type !== 'petConsumable') return null;
    const eylem = def.action;
    const miktar = say(def.amount, 0);

    // --- hedef: BINEK ---
    if (petTarget === 'mount') {
      if (eylem !== 'hp') { hata(ws, 'ERR_VALIDATION', 'err.gpet.mount_invalid'); return false; }
      const b = ws.binek;
      if (!b) { hata(ws, 'ERR_PET_STATE', 'err.mount.not_mounted'); return false; }
      if (b.hp >= b.maxHp) { hata(ws, 'ERR_VALIDATION'); return false; }
      b.hp = Math.min(b.maxHp, b.hp + miktar);
      mountYay(ws);
      return true;
    }

    // --- hedef: GELISIM PETI ---
    const g = ws.gpet;
    if (eylem === 'revive') {
      const frac = say(G.gp.reviveHpFrac, 0);
      if (g && g.dead) {
        const s = gpetSatir(g);
        g.dead = false;
        g.hp = Math.max(1, Math.round(say(s.maxHp, 1) * frac));
        g.sonDrain = Date.now();
        g.acUyarildi = false;
        const n = yanNokta(ws, 1);   // [PET AYRISMA] dirilis de gpet yuvasina

        const e = {
          id: world.yeniVarlikId(), kind: 'growth_pet',
          modelKey: s.modelKey, name: s.name,
          x: n.x, z: n.z, y: zoneGroundY(ws.zoneId, n.x, n.z, ws.char.y), rotY: say(ws.char.rotY),
          level: g.level, hp: g.hp, maxHp: say(s.maxHp, 1),
          dead: false, scalePct: say(s.scalePct, 100), sahipEntityId: ws.entityId,
          gez: null, bacak: null,
        };
        g.entity = e;
        g.zoneId = ws.zoneId;
        world.varlikEkle(ws.zoneId, e);
        oyuncular.add(ws);
        varligiYay(ws.zoneId, e);
        /* Dirilis de bir BELIRME: varlik dunyadan silinmisti, simdi sahibin
           yaninda yeni bir entity id ile geri geliyor. Cagirmayla ayni
           istemci yolu (aura + growth_pet sesi) burada da dogru. */
        petBelirdiFx(ws.zoneId, e.id);
        gpetRollsYaz(ws); envanteriYolla(ws);
        gpetDurum(ws);
        gpetKaydet(ws);
        return true;
      }
      /* Cagrilmamis ama esya kaydinda OLU isaretli flut: rolls uzerinde dirilt.
         (gpet.summon bunu `err.gpet.dead_revive` ile reddediyordu.) */
      const ch = ws.char;
      const yuvalar = Array.isArray(ch.bag) ? ch.bag : [];
      for (let i = 0; i < yuvalar.length; i++) {
        const it = yuvalar[i];
        if (!it) continue;
        const d2 = ITEMSTATS.get(it.itemId);
        if (!d2 || d2.type !== 'growthPetFlute') continue;
        if (it.rolls?.petDead !== 1) continue;
        const gd = GPETS.get(d2.growthPetId);
        if (!gd) continue;
        const lv = Math.min(Math.max(1, say(it.rolls.petLevel, 1)), gd.levels.length);
        const s = gd.levels[lv - 1];
        const r = rolls(it);
        r.petDead = 0;
        r.petHp = Math.max(1, Math.round(say(s.maxHp, 1) * frac));
        envanteriYolla(ws);
        return true;
      }
      hata(ws, 'ERR_NOT_FOUND', 'err.gpet.no_dead');
      return false;
    }

    if (!g) { hata(ws, 'ERR_PET_STATE'); return false; }
    if (g.dead) { hata(ws, 'ERR_PET_STATE', 'err.gpet.dead'); return false; }

    if (eylem === 'hgp') {
      if (g.hgp >= g.hgpMax) { hata(ws, 'ERR_VALIDATION'); return false; }
      g.hgp = Math.min(g.hgpMax, g.hgp + miktar);
      if (g.hgp > g.hgpMax * say(G.gp.hgpLowFrac, 0)) g.acUyarildi = false;
      gpetRollsYaz(ws);
      gpetDurum(ws);
      return true;
    }

    if (eylem === 'hp') {
      const s = gpetSatir(g);
      const maxHp = say(s.maxHp, 1);
      if (g.hp >= maxHp) { hata(ws, 'ERR_VALIDATION'); return false; }
      g.hp = Math.min(maxHp, g.hp + miktar);
      if (g.entity) {
        g.entity.hp = g.hp;
        const hp = { id: g.entity.id, hp: Math.round(g.hp), maxHp: g.entity.maxHp };
        frame(ws, 'entity.hp', hp);
        broadcast(g.zoneId ?? ws.zoneId, 'entity.hp', hp, ws);
      }
      gpetRollsYaz(ws);
      gpetDurum(ws);
      return true;
    }

    hata(ws, 'ERR_VALIDATION');
    return false;
  }

  function gpetTik(ws, simdi, dtMs) {
    const g = ws.gpet;
    if (g.dead || !g.entity) return;
    if (bolgeSenkron(ws, g, 1)) { g.hedefId = null; return; }     // [DUZELTME 4]
    const zoneId = g.zoneId;
    const e = g.entity;
    const ch = ws.char;

    // --- HGP erimesi: growthPets.hgpDrainPerSec = 1 / sn ---
    const drain = say(G.gp.hgpDrainPerSec, 0);
    if (drain > 0) {
      const gecen = simdi - g.sonDrain;
      if (gecen >= 1000) {
        g.sonDrain = simdi;
        g.hgp = Math.max(0, g.hgp - drain * (gecen / 1000));
        gpetRollsYaz(ws);
        if (g.hgp <= 0) {
          // "Petin acliga dayanamayip flutune geri dondu."
          frame(ws, 'sys.notice', { key: 'sys.gpet.starved' });
          gpetGonder(ws, true);
          gpetDurum(ws);
          return;
        }
        if (!g.acUyarildi && g.hgp <= g.hgpMax * say(G.gp.hgpLowFrac, 0)) {
          g.acUyarildi = true;
          frame(ws, 'sys.notice', { key: 'sys.gpet.hungry' });
        }
        gpetDurum(ws, false);
      }
    }

    // --- yurumeyi ilerlet ---
    if (e.bacak) {
      const b = e.bacak;
      e.rotY = Math.atan2(b.tx - e.x, b.tz - e.z);
      bacakIlerlet(e, zoneId, dtMs, zoneGroundY);
      if (!e.bacak) e.gez = null;
    }

    // --- sahibinden cok uzaklastiysa isinla ---
    if (G.catchup > 0 && uz2(e, ch) > G.catchup * G.catchup) {
      const n = yanNokta(ws, 1);   // [PET AYRISMA] kendi yuvasina isinlanir
      isinla(zoneId, e, n.x, n.z);
      return;
    }

    // --- saldirgan mod: sahibin hedefini devral ---
    if (g.mode === 'offensive' && g.hedefId == null && !ch.dead) {
      const h = world.varlik?.(zoneId, Number(ws.hedefId));
      /* `!h.donuyor`: eve donen mob devralinmaz. gameloop #saldiriBasla
         sahibin angajmanini keser ama ws.hedefId (secim) mobu isaret etmeye
         devam eder; bu kapi olmasa pet her tikte hedefi yeniden alir,
         asagidaki savas dali onu hemen birakir ve gpetDurum karesi
         tik basina bir kez bosuna giderdi. */
      if (h?.kind === 'monster' && !h.dead && !h.donuyor && say(h.hp) > 0) g.hedefId = h.id;
    }

    // --- savas ---
    if (g.hedefId != null) {
      const mob = world.varlik?.(zoneId, g.hedefId);
      /* `mob.donuyor`: eve donen mob HASAR ALMAZ (gameloop.js #eveDonusBaslat
         md. 7a: "agro almaz, saldirmaz, HASAR ALMAZ"). Hedefi BIRAKMAK dogru
         davranis - salt hasari atlamak yetmezdi: pet donen mobu evine kadar
         kovalar, sahibinden kopar ve catchup isinlanmasina girerdi. Ayrica
         asagidaki vurus yolu mob.hp'yi dusurmenin yani sira hedefEntityId ve
         sonHasarAlma yaziyor; kapi olmadan mob donus bitiminde disaridan
         yazilmis bir hedefle uyanir, tek vurus donusHp'yi asarsa gpetOldurdu
         ile "dokunulmaz" donen mob olurdu. */
      if (!mob || mob.dead || mob.donuyor || say(mob.hp) <= 0) {
        g.hedefId = null;
        gpetDurum(ws, false);
      } else {
        const s = gpetSatir(g);
        const menzil = say(s.attackRangeU, 1);
        if (uz2(e, mob) > menzil * menzil) {
          yurut(zoneId, e, mob.x, mob.z, say(s.runSpeedU, 7.5));
          return;
        }
        durdur(zoneId, e);
        e.rotY = Math.atan2(mob.x - e.x, mob.z - e.z);
        /* Vurus temposu = growth-pets.json swingMs (pet_wolf: 1566 ms).
           [DENETIM DUZELTMESI 1] Eskiden buraya growthAttackRateH bolen olarak
           giriyordu; o deger TEMPO degil HASAR katsayisi (bkz. petVurusu).
           Alt sinir da (200 ms) uydurmaydi - kaldirildi, swingMs zaten pozitif
           (istemci semasi: swingMs: Y().int().positive() @8685840). */
        const aralik = Math.max(1, Math.round(say(g.def.swingMs, 1566)));
        if (simdi - g.sonVurus < aralik) return;
        g.sonVurus = simdi;
        const v = petVurusu(g, mob);
        mob.hp = Math.max(0, say(mob.hp) - v.hasar);
        mob.hedefEntityId ??= ws.entityId;
        mob.sonHasarAlma = simdi;
        const olay = {
          src: e.id, dst: mob.id, kind: 'auto', dmg: v.hasar,
          crit: !!v.kritik, dstHp: Math.round(mob.hp),
        };
        frame(ws, 'combat.event', olay);
        broadcast(zoneId, 'combat.event', olay, ws);
        const hp = { id: mob.id, hp: Math.round(mob.hp), maxHp: mob.maxHp };
        frame(ws, 'entity.hp', hp);
        broadcast(zoneId, 'entity.hp', hp, ws);
        if (mob.hp <= 0) { g.hedefId = null; gpetOldurdu(ws, mob); }
        return;
      }
    }

    /* --- takip ---
       [PET AYRISMA] petTik ile ayni kural: kendi yuvasi (1) + sahibin hizi.
       Eski sabit katalog hizi binekli sahipte matematiksel olarak yetersizdi
       (mounts.json Noble Horse speedU 15.75 > Wolf cub runSpeedU 11.25) ->
       dakikada 7 catchup isinlanmasi (olcum: GERCEK/denetim/isinlanma.mjs). */
    const d = Math.sqrt(uz2(e, ch));
    const s = gpetSatir(g);
    if (d > G.followStart) {
      g.yuvaDuzelt = false;   // [S1 MADDE 5] normal takip devrede - duzeltme birakilir
      const n = hedefYuva(ws, 1, simdi);   // [S1 MADDE 5] capraz gecis onleyen atama
      const sapma = Math.hypot(n.x - e.x, n.z - e.z);
      yurut(zoneId, e, n.x, n.z, yuvaHizi(ws, s, d, sapma), YUVA_SAPMA_DUR);
    } else {
      yuvaAyris(ws, g, 1, e, s, simdi);   // [S1 MADDE 5] 8u icinde de yuva ayrismasi
    }
  }

  // ================================================================ tik
  let icTimer = null;
  let disTik = false;
  let sonTik = Date.now();

  function temizle(ws) {
    if (ws.pet) { try { varligiKaldir(ws.pet.zoneId ?? ws.zoneId, ws.pet.entity.id); } catch { /* bolge gitti */ } ws.pet = null; }
    /* gpetRollsYaz ONCE: gelisim petinin hp/hgp/dead degerleri esyanin
       `rolls` alaninda yasiyor ve o alan ch.bag uzerinden WebCharInventory'ye
       (kalicilik.js StackJson) yaziliyor. Buraya konmadan once yalnizca
       gpet.dismiss / olum / komut yollarinda tazeleniyordu; CIKIS yolunda
       tazelenmedigi icin oyuncu son 1..N dakikalik aclik (hgp) ve HP
       degisimini kaybediyordu. WebCharGrowthPet tablosunda hp/hgp SUTUNU YOK
       (olculen sutunlar: CharID, bagSlot, mode, level, xp, updatedAt) - yani
       rolls TEK kalicilik yolu. */
    if (ws.gpet) { try { if (ws.gpet.entity) varligiKaldir(ws.gpet.zoneId ?? ws.zoneId, ws.gpet.entity.id); } catch { /* bolge gitti */ } gpetRollsYaz(ws); gpetKaydet(ws); ws.gpet = null; }
    ws.binek = null;
    oyuncular.delete(ws);
  }

  function tikGovde(dtMs) {
    const simdi = Date.now();

    /* [DENETIM DUZELTMESI 3] Savas damgasi TUM oyuncular icin tutulur.
       Eskiden yalnizca `oyuncular` kumesindekiler (yani halihazirda binegi/peti
       olanlar) damgalaniyordu; hic binmemis bir oyuncunun _bpSonSavas'i 0
       kaliyor, boylece petCombatLockoutMs (20000) penceresi ONA HIC
       uygulanmiyordu - iki oyuncu ayni durumda farkli cevap aliyordu.
       gameloop.js `ws.savas = {hedefId, sonVurus}` kuruyor, canavar oldugunde
       null'liyor; damgayi burada tutmazsak savasin BITTIGI an kayboluyor. */
    for (const z of world.zoneState?.values?.() ?? []) {
      for (const p of z.players ?? []) if (p.isAuthed && p.savas) p._bpSonSavas = simdi;
    }

    for (const ws of [...oyuncular]) {
      if (!acik(ws) || !ws.isAuthed || !ws.char) { temizle(ws); continue; }
      if (ws.savas) ws._bpSonSavas = simdi;
      if (ws.char.dead) {
        // olen oyuncu attan iner, peti geri doner
        if (ws.binek) mountIn(ws, true);
        if (ws.pet) petGonder(ws);
        if (ws.gpet) { gpetGonder(ws, true); gpetDurum(ws); }
        continue;
      }
      try { if (ws.pet) petTik(ws, simdi, dtMs); } catch (e) { log('pet tik hatasi:', e.message); }
      try { if (ws.gpet) gpetTik(ws, simdi, dtMs); } catch (e) { log('gpet tik hatasi:', e.message); }
      if (!ws.pet && !ws.gpet && !ws.binek) oyuncular.delete(ws);
    }
  }

  /** Disaridan tik: server.js/gameloop cagirirsa ic zamanlayici kapanir. */
  function tik(dtMs) {
    if (!disTik) { disTik = true; if (icTimer) { clearInterval(icTimer); icTimer = null; } }
    tikGovde(say(dtMs, 100));
  }

  /* Kendi zamanlayicimiz: server.js modulu baglayip tik() cagirmasa bile
     petler yasar. Disaridan tik() gelirse ilk cagrida kapanir. */
  const icAralik = Math.max(50, Math.round(1000 / say(GCFG.tickHz, 10)));
  icTimer = setInterval(() => {
    if (disTik) return;
    const n = Date.now();
    const dt = n - sonTik; sonTik = n;
    try { tikGovde(dt); } catch (e) { log('binek-pet tik hatasi:', e.message); }
  }, icAralik);
  icTimer.unref?.();

  // ================================================================ giris/cikis
  /* [S1 MADDE 4 - changelog 0008 satir 3 paritesi] Giriste acik birakilmis
     pet/gpet'i otomatik geri cagir. Kurallar:
       - TEK SEFERLIK: girdi() hem giriste hem BOLGE GECISINDE cagriliyor
         (server.js:1423 girisKareleri). Bayraklar ilk kosumda TUKETILIR;
         tuketilmese bilerek kapatilan pet her isinlanmada geri gelirdi.
       - HATALAR SESSIZ: slot ON-DOGRULANIR (tip + katalog + seviye + olu
         gpet + kiralama), boylece giriste sahte err karesi yollanmaz.
         Kiralama-bitti durumunda yalniz sys.notice gider (err'siz).
       - Esya baska yuvaya tasindiysa sessizce KAPALI baslar
         (yanlis esya cagrilmaz); DB bayragi bir sonraki cagir/gonder yazar.
       - web=null (DB'siz test takimi): yukle() bayraklari hic doldurmaz
         -> otoCagir no-op, test_binek-pet.mjs etkilenmez. */
  function otoCagir(ws) {
    const ch = ws?.char;
    if (!ch) return;
    const ps = say(ch.petAcikSlot, -1);
    const gs = say(ch.gpetAcikSlot, -1);
    ch.petAcikSlot = undefined; ch.gpetAcikSlot = undefined;   // tek seferlik
    if (ch.dead) return;   // olu girse de bayrak tuketildi: dirilince elle cagirir
    if (ps >= 0 && !ws.pet) {
      const it = cantaEsyasi(ch, ps);
      const def = it ? ITEMSTATS.get(it.itemId) : null;
      const pd = def?.type === 'petScroll' ? PETS.get(def.petId) : null;
      if (pd && say(ch.level, 1) >= Math.max(G.reqLevel, say(def.reqLevel, 1))) {
        const bitis = it.rolls?.petExpiresAt;
        if (bitis != null && bitis <= Date.now()) {
          // suresi gecmis kiralik: petCagir'in err karesi yerine yalniz bildirim
          frame(ws, 'sys.notice', { key: 'sys.pets.rental_expired', params: { pet: pd.name } });
        } else {
          petCagir(ws, { bagSlot: ps });
        }
      }
    }
    if (gs >= 0 && !ws.gpet) {
      const it = cantaEsyasi(ch, gs);
      const def = it ? ITEMSTATS.get(it.itemId) : null;
      const gd = def?.type === 'growthPetFlute' ? GPETS.get(def.growthPetId) : null;
      if (gd && it.rolls?.petDead !== 1 &&
          say(ch.level, 1) >= Math.max(G.reqLevel, say(def.reqLevel, 1))) {
        gpetCagir(ws, { bagSlot: gs });
      }
    }
  }

  /** zone.init sonrasi: mevcut binek/pet durumunu istemciye tazele. */
  function girdi(ws) {
    otoCagir(ws);   // [S1 MADDE 4] acik birakilan pet/gpet geri gelir (tek seferlik)
    if (ws.binek) frame(ws, 'mount.update', mountKare(ws));
    petDurum(ws);
    if (ws.gpet) gpetDurum(ws);
  }
  function cikti(ws) { temizle(ws); }

  /**
   * [DUZELTME 7] Bu ornegi kapat: ic zamanlayiciyi durdur, kalan pet/binek
   * varliklarini dunyadan topla. server.js modulleri yeniden kurdugunda
   * (sistemleriKur) otomatik cagrilir; disaridan da cagrilabilir.
   */
  function kapat() {
    if (icTimer) { clearInterval(icTimer); icTimer = null; }
    disTik = true;
    for (const ws of [...oyuncular]) { try { temizle(ws); } catch { /* soket gitti */ } }
    oyuncular.clear();
  }

  // ================================================================ yonlendirici
  function mesaj(ws, t, d) {
    if (!ws?.isAuthed || !ws.char) return false;
    switch (t) {
      case 'mount.use':      return mountKullan(ws, d);
      case 'mount.dismount': return mountIn(ws);
      case 'pet.summon':     return petCagir(ws, d);
      case 'pet.dismiss':    return petGonder(ws);
      case 'pet.settings':   return petAyarla(ws, d);
      case 'gpet.summon':    return gpetCagir(ws, d);
      case 'gpet.dismiss':   return gpetGonder(ws);
      case 'gpet.command':   return gpetKomut(ws, d);
      default:               return false;   // ilgilenmiyoruz - yonlendirici devam etsin
    }
  }

  function durum() {
    return {
      oyuncu: oyuncular.size,
      binek: [...oyuncular].filter(w => w.binek).length,
      pet: [...oyuncular].filter(w => w.pet).length,
      gpet: [...oyuncular].filter(w => w.gpet).length,
      katalog: { mount: MOUNTS.size, pet: PETS.size, gpet: GPETS.size },
    };
  }

  const ORNEK = { mesaj, tik, hiz, hizTazele, binekte, binekHasar, petHasar,
                  xpPay: gpetXpEkle, esyaKullan, girdi, cikti, kapat, durum,
                  /* server.js modulleriYukle(ch) kancasi (server.js:1590):
                     KALICI pet toplama ayarini ch.petAyar uzerine kurar. */
                  yukle,
                  /* test/tani */
                  _petAyarYukle: petAyarYukle, _petAyarKaydet: petAyarKaydet };
  ONCEKI_ORNEK = ORNEK;
  return ORNEK;
}

/* =========================================================================
 * BAGLAMA NOTU  (ana oturum yapacak - bu modul hicbir dosyayi degistirmez)
 * =========================================================================
 * 1) server.js icinde, WS yonlendiricisinde LOOP.mesaj'dan HEMEN SONRA:
 *
 *      import { kur as binekPetKur } from './sistem_binek-pet.js';
 *      const BINEK = binekPetKur({
 *        world: WORLDSIM, combat: COMBAT, frame, broadcast, log, GCFG,
 *        ITEMSTATS: COMBAT.itemStats, zoneGroundY, yurunebilirNokta,
 *        envanterPayload, web: webPool, SHARD: CFG.sql.databases.shard,
 *        derived,
 *      });
 *      ...
 *      if (LOOP && LOOP.mesaj(ws, t, d)) return;
 *      if (BINEK.mesaj(ws, t, d)) return;        // <-- EKLENECEK TEK SATIR
 *
 * 2) ctx'ten KULLANDIKLARIM:
 *      world           - varlikEkle/varlikSil/varlik/yeniVarlikId/
 *                        bolgeOyunculari/olumKaydet/zoneState/groundY
 *      combat          - cfg (levelGap, crit, parry, rollShape, minDamage,
 *                        pets.*, damageScale.petVsMonster), progress.xpToNext,
 *                        odul/xpEkle/spEkle/ganimet, itemStats
 *      frame, broadcast, log
 *      GCFG            - petDetectRadiusU, petCatchupU, petFollowU,
 *                        petFollowStartU, petPickMs, petSummonReqLevel,
 *                        petCombatLockoutMs, petXpRate, growthPets{...},
 *                        pickupRangeU, bagSlots, lootOwnerLockMs,
 *                        lootDespawnMs, playerMoveSpeedU, tickHz
 *      ITEMSTATS       - esya tipi (mount/petScroll/growthPetFlute), reqLevel,
 *                        mountId/petId/growthPetId, lifetimeMs, stackMax
 *      zoneGroundY, yurunebilirNokta, envanterPayload, web, derived
 *      sistemOrnegi    - [madde 13] yalniz sistem_beceri.js'in hizCarpani(ws)
 *                        kancasi icin; yoksa hiz() carpansiz calisir
 *      (SHARD kullanilmadi - kalicilik SRO_WEB_GAME.dbo.WebCharGrowthPet'te)
 *
 * 3) ISLEDIGIM c2s MESAJLAR (digerlerinde false doner):
 *      mount.use(69) mount.dismount(70) pet.summon(65) pet.dismiss(66)
 *      pet.settings(67) gpet.summon(73) gpet.dismiss(74) gpet.command(75)
 *
 * 4) GONDERDIGIM s2c KARELER:
 *      mount.update(173), pet.state(161), gpet.state(214),
 *      state.delta(133) add/rem, entity.move(134), entity.stop(135),
 *      entity.teleport(136), entity.hp(137), entity.pickup(155),
 *      combat.event(140), combat.death(141), inv.update(149),
 *      vitals.update(150), progress.update(144), progress.levelUp(145),
 *      sys.notice(195), err(240)
 *
 * 5) ISTEGE BAGLI KANCALAR (baglanmazsa sistem yine calisir, sadece o
 *    davranis eksik kalir):
 *      BINEK.hiz(ws)            -> move.click'te GCFG.playerMoveSpeedU yerine.
 *                                  Binekteyken hiz binegin speedU'su olur
 *                                  (13.5 / 14.25 / 15.75), ustune hareket
 *                                  hizi buff carpani (moveSpeedPct) biner.
 *                                  BAGLANMAZSA binek gorunur ama HIZ ARTMAZ.
 *                                  [madde 13] Baglanacak UC yer:
 *                                    server.js  move.click  (hiz argumani)
 *                                    gameloop.js #hedefeYaklas (bacakKur hizi)
 *                                    gameloop.js ganimet yaklasmasi
 *                                  Taslak asagida "MADDE 13 TASLAKLARI"nda.
 *      BINEK.hizTazele(ws)      -> [madde 13] hiz DEGISTIGINDE cagrilir:
 *                                  yurumekte olan bacagi ayni hedefe yeni
 *                                  hizla yeniden kurar + entity.move gonderir
 *                                  (istemci selfSpeed'i yalniz bu kareden
 *                                  tazeliyor, @25663413). Binege binme/inme
 *                                  ve binegin olumu ICERIDE zaten cagiriyor;
 *                                  DISARIDAN cagirmasi gereken tek yer
 *                                  sistem_beceri.js: moveSpeedPct tasiyan bir
 *                                  buff BASLARKEN ve BITERKEN.
 *      BINEK.binekte(ws)        -> combat.attack'ta: true ise
 *                                  err {code:'ERR_PET_COMBAT',
 *                                       key:'err.mount.no_combat'}
 *      BINEK.binekHasar(ws,dmg) -> canavar oyuncuya vurdugunda binek HP'si
 *      BINEK.petHasar(ws,dmg,src)-> canavar gelisim petine vurdugunda
 *      BINEK.xpPay(ws,xp)       -> OYUNCU bir canavari oldurdugunde petin
 *                                  XP payi (pet kendi oldurdugunde zaten olur)
 *      BINEK.esyaKullan(ws, def, petTarget)
 *                               -> sistem_envanter.js `inv.use` (49) icinde,
 *                                  def.type === 'petConsumable' dalinda.
 *                                  Sema: X({bagSlot, petTarget: lht.optional()})
 *                                  lht = qJ([`growth`,`mount`])  @25595312
 *                                  Donus: null = bizim degil (envanter kendi
 *                                  isini yapsin), true = uygulandi (envanter
 *                                  1 adet DUSURSUN), false = bizim ama
 *                                  uygulanamadi, `err` GONDERILDI (envanter
 *                                  ne dussun ne ikinci err yollasin).
 *                                  BAGLANMAZSA: olu gelisim peti KILITLI
 *                                  kalir (dirilis yolu yok), HGP/HP iksirleri
 *                                  ve iyilestirme kitleri ise yaramaz.
 *      BINEK.girdi(ws)          -> zone.init'ten sonra durum tazeleme
 *      BINEK.cikti(ws)          -> ws 'close' olayinda temizlik
 *      BINEK.tik(dtMs)          -> baglanmazsa modul kendi setInterval'ini
 *                                  kullanir (gameConfig.tickHz = 10 -> 100 ms)
 *      BINEK.kapat()            -> bu ornegi kapatir. server.js
 *                                  `sistemleriKur()` ile modulleri YENIDEN
 *                                  kurdugu icin gerekli; ELLE BAGLANMASI
 *                                  SART DEGIL - kur() zaten onceki ornegi
 *                                  otomatik kapatiyor.
 *
 * 6) KALICILIK: SRO_WEB_GAME.dbo.WebCharGrowthPet (ZATEN VARDI, sema
 *    degistirilmedi): CharID, bagSlot, mode, level, xp, updatedAt.
 *    MERGE ile yazilir; gpet.summon'da okunur. Pet kiralama bitisi ve
 *    gelisim petinin hp/hgp/dead degerleri esya kaydinin `rolls` alaninda
 *    yasar (istemci ipucu bunlari okuyor: petExpiresAt/petLevel/petXp/
 *    petHp/petHgp/petDead) - canta henuz DB'ye yazilmadigi icin bunlar
 *    oturum boyu kalicidir.
 * ========================================================================= */

/* =========================================================================
 * MADDE 13 TASLAKLARI  —  UYGULANDI, YENIDEN UYGULAMA!
 * Asagidaki taslaklarin hepsi sonraki dalgalarda islendi ve satir satir
 * dogrulandi (bu dalga, G10):
 *   server.js       oyuncuHizi(ws) fonksiyonu :1527, move.click bacakKur
 *                   cagrisi :2112, LOOP'a fonksiyon olarak gecis :1417,
 *                   `LOOP.oyuncuHizi = g.playerMoveSpeedU` satiri kaldirildi
 *                   (:408 civarindaki yorum anlatiyor)
 *   gameloop.js     hizOku :94, kullanim :515 ve :782
 *   sistem_beceri.js hizCarpani :2786 (MAKS kurali + durum yavaslamasi),
 *                   hizTazele cagrisi modTazele icinde :845
 * Blok, taslagin NEDEN boyle oldugunu belgeledigi icin tarihce olarak
 * birakildi; kod ornekleri artik REFERANS, yapilacak is DEGIL.
 * =========================================================================
 * Hepsi tek amaca hizmet ediyor: oyuncunun hizi ARTIK SABIT DEGIL, bu yuzden
 * bacakKur'a giden her `hiz` argumani BINEK.hiz(ws)'den gelmeli. Istemci
 * kendi hizini hesaplamiyor, entity.move.speed'i okuyor (@25663413).
 *
 * --- server.js (G6) ------------------------------------------------------
 * (a) sistemCtx() zaten `sistemOrnegi` gonderiyor - EK IS YOK.
 * (b) Tek yardimci; `sistemOrnegi` server.js:1462'de tanimli:
 *
 *     // madde 13: oyuncunun O ANKI hizi. Taban game-config playerMoveSpeedU,
 *     // binek mounts.json speedU, ustune moveSpeedPct buff carpani.
 *     // Modul kurulmamissa taban hiza duser (davranis bugunku gibi).
 *     function oyuncuHizi(ws) {
 *       return sistemOrnegi('binek-pet')?.hiz?.(ws) ?? GCFG.playerMoveSpeedU;
 *     }
 *
 * (c) move.click (server.js ~1715), bacakKur cagrisinda:
 *     -   ... GCFG.playerMoveSpeedU, yurunebilirNokta);
 *     +   ... oyuncuHizi(ws), yurunebilirNokta);
 *     (server.js:1864'teki ikinci `GCFG.playerMoveSpeedU` gecisi de ayni
 *      degisiklik - o cagriyi da oyuncuHizi(ws) yapmali.)
 *
 * (d) LOOP'a SABIT sayi degil FONKSIYON verilmeli. Bugun:
 *       server.js:1381  oyuncuHizi: GCFG.playerMoveSpeedU
 *       server.js:392   LOOP.oyuncuHizi = g.playerMoveSpeedU   (admin ayari)
 *     Yerine:
 *       server.js:1381  oyuncuHizi                              // fonksiyon
 *       server.js:392   satiri KALDIRILIR (fonksiyon GCFG'yi zaten canli okur)
 *
 * --- gameloop.js (G2) ----------------------------------------------------
 * constructor `oyuncuHizi = 7.5` artik SAYI ya da FONKSIYON alabilmeli:
 *
 *     // madde 13: hiz artik sabit degil (binek + moveSpeedPct buff).
 *     // Geriye donuk uyum: sayi verilirse eski davranis aynen surer.
 *     this.oyuncuHizi = oyuncuHizi;
 *     this.hizOku = (ws) => (typeof this.oyuncuHizi === 'function'
 *       ? this.oyuncuHizi(ws) : this.oyuncuHizi);
 *
 * Iki cagri yeri:
 *   gameloop.js:332  ganimet yaklasmasi
 *     -   bacakKur(ws.char, ws.zoneId, e.x, e.z, this.oyuncuHizi, this.yurunebilir);
 *     +   bacakKur(ws.char, ws.zoneId, e.x, e.z, this.hizOku(ws), this.yurunebilir);
 *   gameloop.js:525  #hedefeYaklas
 *     -   ... this.oyuncuHizi, this.yurunebilir);
 *     +   ... this.hizOku(ws), this.yurunebilir);
 *
 * --- sistem_beceri.js (G4) ----------------------------------------------
 * madde 19 (buff.mods okunmasi) bittikten SONRA iki kanca:
 *
 *   // madde 13: hareket hizi carpani. data/skills.json buff.mods.moveSpeedPct
 *   // (sema paket @8659842). Deger ORAN'dir: lightning_gyeonggong_a_1 = 0.2,
 *   // _8 = 0.41; 38 beceri kaydi tasiyor.
 *   // KAYNAK YOK: ayni kategoriden iki buff ust uste binerse toplanir mi
 *   // yoksa en yuksegi mi gecerlidir - paket soylemiyor. MAKS aliyoruz
 *   // (toplama olcum olmadan sayi uydurmak olurdu). OLCULMELI.
 *   // ws.bec.buff = Map<groupId, {payload, skill, sonUpkeep}>  (satir ~660'ta
 *   // `s.buff.set(skill.groupId, { payload, skill, sonUpkeep: t0 })` ile
 *   // dolduruluyor; sema DOGRULANDI, uydurulmadi).
 *   function hizCarpani(ws) {
 *     let enYuksek = 0;
 *     for (const b of ws?.bec?.buff?.values?.() ?? []) {
 *       const v = Number(b?.skill?.buff?.mods?.moveSpeedPct);
 *       if (Number.isFinite(v) && v > enYuksek) enYuksek = v;
 *     }
 *     return 1 + enYuksek;
 *   }
 *   // ORNEK'e eklenir:  hizCarpani,
 *
 *   // Buff BASLARKEN ve BITERKEN (buffUygula / buff dusme dongusu icinde),
 *   // sadece moveSpeedPct tasiyan buff'lar icin:
 *   if (skill?.buff?.mods?.moveSpeedPct != null) {
 *     ctx.sistemOrnegi?.('binek-pet')?.hizTazele?.(ws);
 *   }
 * ========================================================================= */
