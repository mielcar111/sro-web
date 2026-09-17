/**
 * DURUM MOTORU (status engine)  -  SAF VERI + SAF FONKSIYON
 * =============================================================================
 *
 * NEDEN: 824 beceri kaydi statusApplications yaziyor ama sunucuda hicbiri
 * DAVRANISA etki etmiyordu; sistem_beceri.js:678 durumUygula yalniz bir listeye
 * kayit yazip statuses.update(199) yayinliyor, gameloop.js'te "durum/status"
 * kelimesi hic gecmiyor. Yani sersemlemis canavar ayni hizda vuruyor, kok salmis
 * canavar yuruyor, savunma dusuren 60+ debuff hasar zincirine hic girmiyor.
 *
 * BU DOSYA MOTORDUR, TUKETICI DEGILDIR. Bilerek DIS BAGIMLILIKSIZ yazildi:
 * ctx / frame / world / world state yok, I/O yok, zamanlayici yok. Boylece uc
 * ayri tuketici (sistem_beceri.js kurulum, combat.js hasar zinciri, gameloop.js
 * canavar YZ + DoT tiki) ayni tabloyu catismasizca import eder ve motor tek
 * basina test edilebilir (test_durumlar.mjs).
 *
 * -----------------------------------------------------------------------------
 * KAYNAKLAR (hepsi paketten bayt dokumu ile BIREBIR dogrulandi)
 * -----------------------------------------------------------------------------
 *   @25588614  var h$ = {...}   27 kodun DAVRANIS BAYRAKLARI  -> DURUM_TANIM
 *   @25589885  Kmt = (list,t) => list.filter(x => x.expiresAt > t)
 *   @25589973  function qmt(l,t) -> hareket hizi carpani
 *                v = PROD(1 + moveSlowPct); return max(.1, v)
 *   @25590140  function g$(l,t)  -> saldiri/cast SURESI carpani
 *                v = PROD(1 + atkSlowPct);  return 1 / max(.1, v)
 *   @25075309  var LY = {...}    25 kodun ikon/ad/nativeType/bit/tint metasi
 *   @8660453   statusApplications semasi: code enum 27 kod + level + chancePct +
 *              argsRaw + durationMs? + durationSource + tickIntervalMs? +
 *              magnitudePct? + explodeDmg? + fuseSecondsRaw? + maxResFactorPct? +
 *              recoveryDownPct? + drainPctOfMaxRes?
 *   @8656714   combatConfig.statusLevelGap semasi (+ @8748909 gercek degerler)
 *   @8657167   combatConfig.statusDuration semasi (+ @8749033 gercek degerler)
 *   @8680398   mob combat semasi: `resists: GJ(J(), Y())`
 *   @13456191  mob_tigerwoman (unique) resists: 22 kalemin TAM listesi ve sirasi
 *   @25671260  Q.selfCcLocked()      - istemci ccLock kapisi
 *   @25671589  Q.selfHealInverted()  - healInvert kapisi
 *   @25671888  Q.selfItemLocked()    - itemLock kapisi
 *   @25691996  E1() ilk satiri: selfCcLocked -> err.busy.knockedback/downed
 *   @25607034  Eht = err.key KAPALI ENUM (err.busy.x, err.skill.feared burada)
 *   @25921100  beceri ipucu: durationMs yoksa sure = level * (bu ? 750 : 1000)
 *   @26756085  removed[].reason === 'cured' ise ACT_S efekti, degilse DEACT
 *   @27324430  WPt(): LY[code] yoksa rozet BECERININ adi/ikonuyla ciziliyor
 *   data/combat.json  combatConfig.statusLevelGap / .statusDuration
 *   data/mobs.json    combat.resists 156/158 mobda dolu
 *   data/schemas.json mesajlar['statuses.update'] tel semasi
 *   client/assets/locales/tr.json  status.<kod>.name/.desc (26 kod cevrili)
 *
 * -----------------------------------------------------------------------------
 * BILEREK YAPILMAYANLAR (kaynak gosterilemedigi icin - plan "uygulanmayacaklar")
 * -----------------------------------------------------------------------------
 *   - koLevel <-> koClass iliskisi ve `kb` (geri savurma) SURESI: paketten
 *     okunamadi. `kb` bu motorda DURUM DEGILDIR, YOK_SAYILAN icinde.
 *   - fz/fb/es sure formulu (marj hesabi): sema varsayilanlari
 *     (freeze 97 / frostbite 250 / shock 500 ms-per-margin) VARSAYILAN_AYAR'da
 *     duruyor ama motor kendiliginden KULLANMIYOR - kayitlarin durationMs'i var.
 *   - bu/ps "install margin": istemci ipucunun formulu @25921100'de acikca
 *     `level * msPerMargin`, ama madde 17 canli olcume birakildi. Bu yuzden
 *     sureCoz() bunu ayar.hesaplananSure ile KAPALI baslar (bkz. VARSAYILAN_AYAR).
 *   - DoT tik HASARI: statusApplications'ta adlandirilmis bir hasar alani YOK
 *     (bl kayitlarinda argsRaw[3] guclu aday ama ISIMLENDIRILMEMIS). Motor tik
 *     TETIGINI ureten taraftir; hasar sayisini tuketici verir (ayar.dotHasar).
 *   - `atkDown/hitDown/parryDown/maxHpDown/maxMpDown/rangedRangeDown` bayrak
 *     ADLARINDA birim eki YOK (Flat/Pct). Bunlar `birimiBelirsiz` demetinde
 *     ayri toplanir; motor duz mu yuzde mi oldugunu VARSAYMAZ.
 *
 * -----------------------------------------------------------------------------
 * KULLANIM
 * -----------------------------------------------------------------------------
 *   import * as durumlar from './durumlar.js';
 *   const motor = durumlar.motorKur({ statusLevelGap: combat.cfg.statusLevelGap });
 *   motor.uygula(mob, 'st', { seviye: 2, sureMs: 5000, kaynak: ws.entityId });
 *   const t = motor.tik(mob, Date.now());   // t.dusenler / t.dot / t.aktif
 *   if (motor.ccKilitli(mob)) continue;     // mob YZ adimini atla
 *
 * `hedef` iki bicimde olabilir:
 *   - dizi                 -> dogrudan durum listesi (Map<zoneId|id, []> icin)
 *   - nesne                -> hedef.durumlar dizisi tembel olusturulur
 */

// ---------------------------------------------------------------- veri tablosu

/**
 * h$ @25588614 - BIREBIR. Alan adlari ve degerler paketteki halidir; `!0` -> true.
 * DIKKAT: `se` ve `stns` itemLock DA tasir (raporlarda atlanmisti, paketten
 * dogrulandi). `tb` (Gizli Tehlike) BOS objedir - patlamasi explodeDmg ile
 * beceri tarafinda islenir, burada bayragi yoktur.
 */
export const DURUM_TANIM = Object.freeze({
  fz:   { ccLock: true },
  fb:   { moveSlowPct: -0.5,  atkSlowPct: -0.5,  npcActionDelayPct: 200 },
  es:   { parryDown: true },
  bu:   { dot: true },
  ps:   { dot: true },
  zb:   { healInvert: true },
  dn:   { hitDown: true },
  st:   { ccLock: true },
  ds:   { susceptibility: true },
  terd: { evasionDownFlat: true },
  thrd: { hitDownFlat: true },
  se:   { ccLock: true, itemLock: true },
  rt:   { rootLock: true },
  sl:   { moveSlowPct: -0.25, atkSlowPct: -0.25, npcActionDelayPct: 125 },
  fe:   { attackDisable: true },
  my:   { rangedRangeDown: true },
  bl:   { dot: true, physDefDownFlat: true, magDefDownFlat: true },
  stns: { ccLock: true, itemLock: true },
  ca:   { targetForget: true },
  cspd: { physDefDownFlat: true },
  csmd: { magDefDownFlat: true },
  cssr: { atkDown: true },
  csit: { defDownPct: true },
  cshp: { maxHpDown: true, mpDrainPulse: true },
  csmp: { maxMpDown: true, mpDrainPulse: true },
  tb:   {},
  ft:   { forcedTarget: true },
});

/**
 * LY @25075309 - BIREBIR (ikon/ad anahtari/nativeType/bit). Sunucunun kendisi
 * kullanmaz; motor bunu YAYIN HIJYENI icin tasir: LY'de OLMAYAN bir kod
 * istemciye gidince rozet BECERININ adi/ikonuyla ciziliyor (WPt @27324430) ve
 * ipucu "status.terd.name"e dusuyor (@25921100). `kb`nin durum listesinden
 * cikarilmasinin gerekcesi tam olarak budur.
 * NOT: `stns` ve `ft` LY'de nativeType/bit TASIMAZ (paketteki hali boyle).
 */
export const DURUM_META = Object.freeze({
  fz:   { param: 'PARAM_FZ',        icon: 's_freeze_icon',        nameKey: 'status.fz',   nativeType: 0,  bit: 0 },
  fb:   { param: 'PARAM_FB',        icon: 's_frostbite_icon',     nameKey: 'status.fb',   nativeType: 1,  bit: 1 },
  es:   { param: 'PARAM_ES',        icon: 's_electricshock_icon', nameKey: 'status.es',   nativeType: 3,  bit: 2 },
  bu:   { param: 'PARAM_BU',        icon: 's_burn_icon',          nameKey: 'status.bu',   nativeType: 2,  bit: 3 },
  ps:   { param: 'PARAM_PS',        icon: 's_poisoning_icon',     nameKey: 'status.ps',   nativeType: 4,  bit: 4 },
  zb:   { param: 'PARAM_ZB',        icon: 's_zombi_icon',         nameKey: 'status.zb',   nativeType: 5,  bit: 5 },
  se:   { param: 'PARAM_SLEEP',     icon: 's_sleep_icon',         nameKey: 'status.se',   nativeType: 6,  bit: 6 },
  rt:   { param: 'PARAM_ROOT',      icon: 's_root_icon',          nameKey: 'status.rt',   nativeType: 7,  bit: 7 },
  sl:   { param: 'PARAM_BLUNT',     icon: 's_blunting_icon',      nameKey: 'status.sl',   nativeType: 8,  bit: 8 },
  fe:   { param: 'PARAM_FEAR',      icon: 's_fear_icon',          nameKey: 'status.fe',   nativeType: 9,  bit: 9 },
  my:   { param: 'PARAM_MYOPIA',    icon: 's_myopia_icon',        nameKey: 'status.my',   nativeType: 10, bit: 10 },
  bl:   { param: 'PARAM_BLOOD',     icon: 's_bleeding_icon',      nameKey: 'status.bl',   nativeType: 11, bit: 11 },
  stns: { param: 'PARAM_STONE',     icon: 's_stonecurse_icon',    nameKey: 'status.stns' },
  dn:   { param: 'PARAM_DN',        icon: 's_dark_icon',          nameKey: 'status.dn',   nativeType: 13, bit: 13 },
  st:   { param: 'PARAM_STUN',      icon: 's_stun_icon',          nameKey: 'status.st',   nativeType: 14, bit: 14 },
  ds:   { param: 'PARAM_DISEASE',   icon: 's_disease_icon',       nameKey: 'status.ds',   nativeType: 15, bit: 15 },
  ca:   { param: 'PARAM_CHAOS',     icon: 's_confusion_icon',     nameKey: 'status.ca',   nativeType: 16, bit: 16 },
  cspd: { param: 'PARAM_CURSE_PD',  icon: 's_decay_icon',         nameKey: 'status.cspd', nativeType: 17, bit: 17 },
  csmd: { param: 'PARAM_CURSE_MD',  icon: 's_weakness_icon',      nameKey: 'status.csmd', nativeType: 18, bit: 18 },
  cssr: { param: 'PARAM_CURSE_STR', icon: 's_powerless_icon',     nameKey: 'status.cssr', nativeType: 19, bit: 19 },
  csit: { param: 'PARAM_CURSE_INT', icon: 's_dissociation_icon',  nameKey: 'status.csit', nativeType: 20, bit: 20 },
  cshp: { param: 'PARAM_CURSE_HP',  icon: 's_panic_icon',         nameKey: 'status.cshp', nativeType: 21, bit: 21 },
  csmp: { param: 'PARAM_CURSIE_MP', icon: 's_combustion_icon',    nameKey: 'status.csmp', nativeType: 22, bit: 22 },
  tb:   { param: 'PARAM_TIME_BOMB', icon: 's_incubation_icon',    nameKey: 'status.tb',   nativeType: 24, bit: 24 },
  ft:   { param: 'PARAM_HITM',      icon: 's_confusion_icon',     nameKey: 'status.ft' },
});

/**
 * h$'te davranisi olan ama LY'de METASI OLMAYAN kodlar. Yayinlanabilirler
 * (mekanikleri var, tr.json'da status.terd.name de var) ama istemcinin durum
 * cubugunda rozet BECERI adiyla cizilir - referans oyun istemcisinin kendi davranisi,
 * uydurma bir duzeltmeyle "iyilestirilmez".
 */
export const META_YOK = Object.freeze(['terd', 'thrd']);

/** statusApplications.code KAPALI ENUM'u @8660453 (27 kod, paketteki sira). */
export const DURUM_KODLARI = Object.freeze(
  'st.fz.fb.es.bu.ps.dn.ds.zb.kb.terd.thrd.bl.sl.cspd.csmd.cssr.csit.rt.se.fe.my.csmp.cshp.tb.ca.ft'.split('.')
);

/**
 * `kb` DURUM DEGIL, GERI SAVURMADIR - durum listesine YAZILMAZ.
 *   - h$ @25588614'te `kb` ANAHTARI YOK  -> hicbir kilit/yavaslama kurmaz.
 *   - LY @25075309'da `kb` ANAHTARI YOK  -> rozet BECERI adiyla cizilir.
 * Dogru karsiligi combat.event(140) `kb` alanidir; SURESI belirsiz oldugu icin
 * (117 kaydin tamami durationSource:"assumed") burada UYGULANMAZ.
 */
export const YOK_SAYILAN = Object.freeze(new Set(['kb']));

/**
 * Durum kodu -> mob combat.resists anahtari. 22 kalem; sira ve adlar
 * @13456191 (mob_tigerwoman) ile data/mobs.json'daki 156 mobun anahtar
 * kumesinden BIREBIR alindi. Esleme nativeType sirasiyla birebir ortusuyor
 * (Frozen 0, Frostbite 1, Burn 2, EShock 3, Poison 4, Zombie 5, Sleep 6,
 *  Root 7, Slow 8, Fear 9, Myopia 10, Blood 11, Stone 12, Dark 13, Stun 14,
 *  Chaos 16, CsePD 17, CseMD 18, CseSTR 19, CseINT 20, CseHP 21, CseMP 22)
 * - nativeType 15 (`ds`, hastalik) ve 24 (`tb`) icin direnc kalemi YOKTUR,
 * mob verisinde de yoktur; bu yuzden bu iki kod eslemede bulunmaz.
 */
export const DIRENC_ANAHTARI = Object.freeze({
  fz: 'ResistFrozen',   fb: 'ResistFrostbite', bu: 'ResistBurn',   es: 'ResistEShock',
  ps: 'ResistPoison',   zb: 'ResistZombie',    se: 'ResistSleep',  rt: 'ResistRoot',
  sl: 'ResistSlow',     fe: 'ResistFear',      my: 'ResistMyopia', bl: 'ResistBlood',
  stns: 'ResistStone',  dn: 'ResistDark',      st: 'ResistStun',   ca: 'ResistChaos',
  cspd: 'ResistCsePD',  csmd: 'ResistCseMD',   cssr: 'ResistCseSTR',
  csit: 'ResistCseINT', cshp: 'ResistCseHP',   csmp: 'ResistCseMP',
});

/**
 * HASARLA KIRILAN DURUMLAR. Kaynak: tr.json
 *   status.se.desc = "Hareket edemezsin; vurulunca uyanirsin"   -> `se` kirilir.
 * Diger kilitlerin aciklamalarinda kirilma YOK:
 *   status.fz.desc "Hareket edemez, beceri kullanamazsin"
 *   status.st.desc "Hareket edemezsin"
 *   status.stns.desc "Hareket edemez ve can kaybedersin"
 * Bu yuzden listede YALNIZ `se` var - baska kod EKLENMEZ.
 */
export const HASARLA_KIRILAN = Object.freeze(new Set(['se']));

/**
 * statuses.update(199) removed[].reason KAPALI ENUM'u (data/schemas.json).
 * @26756085: istemci `reason === 'cured'` ise ACT_S (arinma) efektini, aksi
 * halde DEACT efektini oynatir. Bu yuzden uykunun HASARLA kirilmasi 'cured'
 * DEGIL 'expired' ile bildirilir (arinma efekti oynamasin).
 */
export const KALDIRMA_SEBEPLERI = Object.freeze(['expired', 'cured', 'death', 'replaced']);

/**
 * Kilitli oyuncunun cast/saldiri istegi reddedilirken gonderilecek err.key.
 * Anahtarlarin hepsi Eht KAPALI ENUM'unda (@25607034) ve tr.json'da cevrili:
 *   err.busy.stunned      "Sersemletildin."            <-> status.st.name  "Sersemleme"
 *   err.busy.cc           "Su an hareket edemezsin..."  (diger ccLock kodlari)
 *   err.skill.feared      (fe / Korku)
 *   err.skill.forced_target (ft / Alaya Alinmis)
 * NOT: err.busy.downed / err.busy.knockedback ko-kb kanalina aittir, durum
 * motorunun isi degildir (E1 @25691996 once selfDowned'a bakiyor).
 */
export const KILIT_ERR_ANAHTARI = Object.freeze({
  st: 'err.busy.stunned',
  fz: 'err.busy.cc',
  se: 'err.busy.cc',
  stns: 'err.busy.cc',
  fe: 'err.skill.feared',
  ft: 'err.skill.forced_target',
});

// -------------------------------------------------------------- bayrak kumeleri

/** Degeri magnitudePct'ten gelen ve DUZ (flat) oldugu ADINDAN belli bayraklar. */
export const DUZ_BAYRAKLAR = Object.freeze(['physDefDownFlat', 'magDefDownFlat', 'evasionDownFlat', 'hitDownFlat']);
/** Degeri magnitudePct'ten gelen ve YUZDE oldugu ADINDAN belli bayraklar. */
export const YUZDE_BAYRAKLAR = Object.freeze(['defDownPct']);
/** Adinda birim eki OLMAYAN bayraklar - motor duz/yuzde VARSAYMAZ. */
export const BELIRSIZ_BAYRAKLAR = Object.freeze(['atkDown', 'hitDown', 'parryDown', 'maxHpDown', 'maxMpDown', 'rangedRangeDown']);
/** Sadece var/yok olan bayraklar. */
export const IKILI_BAYRAKLAR = Object.freeze(['ccLock', 'rootLock', 'attackDisable', 'itemLock', 'healInvert', 'targetForget', 'forcedTarget', 'susceptibility', 'mpDrainPulse', 'dot']);

// ------------------------------------------------------------------ varsayilan

/**
 * Motorun yapilandirmasi. Sayilarin TAMAMI data/combat.json + paket semasindan;
 * hicbiri uydurma degil.
 *   statusLevelGap  @8656714 sema / @8748909 gercek degerler / data/combat.json
 *   statusDuration  @8657167 sema / @8749033 gercek degerler
 *                   (gercek combat-config yalniz burn+poison tasiyor; freeze 97 /
 *                    frostbite 250 / shock 500 SEMA VARSAYILANIDIR)
 */
export const VARSAYILAN_AYAR = Object.freeze({
  statusLevelGap: Object.freeze({
    durationSlope: 0.025, chanceSlope: 0.05,
    durationFloor: 0.5,   chanceFloor: 0.1,
    thresholdPerOpLevel: 10,
  }),
  statusDuration: Object.freeze({
    burnMsPerMargin: 750, poisonMsPerMargin: 1000,
    freezeMsPerMargin: 97, frostbiteMsPerMargin: 250, shockMsPerMargin: 500,
  }),
  /**
   * durationMs TASIMAYAN (durationSource:'computed') kayitlar icin sureyi
   * `level * msPerMargin` ile hesapla. Istemci ipucu @25921100 tam olarak bunu
   * yapiyor, AMA "install margin"in gercek tanimi (level mi, level-direnc mi)
   * canli olcume birakildi (plan: madde 17). O yuzden VARSAYILAN false ->
   * sure cikarilamayan kayit sessizce ATLANIR (bugunku davranis).
   */
  hesaplananSure: false,
  /** Kod bazinda varsayilan DoT tik araligi. Verisi olan tek kod: bl = 2000ms
   *  (19 kayitta tickIntervalMs alani dolu). Kayit kendi araligini tasiyorsa o
   *  kazanir. Burasi BOS baslar: kaynagi olmayan aralik UYDURULMAZ. */
  tikAraligiMs: Object.freeze({}),
  /** Tuketicinin verecegi tik hasari cozucusu: (kayit, bilgi) => sayi|null. */
  dotHasar: null,
  /** Kurulum zari (test edilebilirlik icin disaridan verilebilir). */
  zar: Math.random,
});

// ------------------------------------------------------------------- yardimcilar

let iidSayaci = 0;
/** Test icin iid sayacini sabitler (kalici durum tasiyan tek modul degiskeni). */
export function iidBaslat(n = 0) { iidSayaci = n | 0; return iidSayaci; }

function ayarCoz(ayar) {
  if (!ayar || ayar === VARSAYILAN_AYAR) return VARSAYILAN_AYAR;
  return {
    ...VARSAYILAN_AYAR,
    ...ayar,
    statusLevelGap: { ...VARSAYILAN_AYAR.statusLevelGap, ...(ayar.statusLevelGap ?? {}) },
    statusDuration: { ...VARSAYILAN_AYAR.statusDuration, ...(ayar.statusDuration ?? {}) },
    tikAraligiMs: { ...VARSAYILAN_AYAR.tikAraligiMs, ...(ayar.tikAraligiMs ?? {}) },
  };
}

/** hedef -> durum dizisi. Dizi verildiyse aynen, nesne verildiyse hedef.durumlar. */
export function listeAl(hedef, olustur = true) {
  if (Array.isArray(hedef)) return hedef;
  if (!hedef || typeof hedef !== 'object') return [];
  if (Array.isArray(hedef.durumlar)) return hedef.durumlar;
  if (!olustur) return [];
  hedef.durumlar = [];
  return hedef.durumlar;
}

/**
 * Tel (wire) projeksiyonu - statuses.update(199) semasi:
 *   {iid, code, level, expiresAt, srcId?, skillId?}
 * Motorun IC alanlari (sonTikAt, tikAraligiMs, argsRaw, magnitudePct, ...)
 * istemciye SIZDIRILMAZ.
 */
export function telVerisi(k) {
  const d = { iid: k.iid, code: k.code, level: k.level, expiresAt: k.expiresAt };
  if (k.srcId != null) d.srcId = k.srcId;
  if (k.skillId != null) d.skillId = k.skillId;
  return d;
}

/** Kmt @25589885: yalnizca suresi dolmamis kayitlar. */
export function canli(hedef, simdi = Date.now()) {
  return listeAl(hedef, false).filter((k) => k.expiresAt > simdi);
}

/** Istemciye gidecek aktif durum dizisi (tel semasinda). */
export function aktif(hedef, simdi = Date.now()) {
  return canli(hedef, simdi).map(telVerisi);
}

/** Kod hakkinda birlesik bilgi: davranis bayraklari + istemci metasi. */
export function bilgi(kod) {
  const t = DURUM_TANIM[kod];
  if (!t) return null;
  return {
    code: kod,
    bayraklar: t,
    meta: DURUM_META[kod] ?? null,
    metaVar: !!DURUM_META[kod],
    direncAnahtari: DIRENC_ANAHTARI[kod] ?? null,
    nameKey: DURUM_META[kod]?.nameKey ?? null,
  };
}

/** Verilen h$ bayragini tasiyan CANLI bir durum var mi? */
export function bayrakVar(hedef, bayrak, simdi = Date.now()) {
  return canli(hedef, simdi).some((k) => DURUM_TANIM[k.code]?.[bayrak]);
}

export const ccKilitli     = (h, t = Date.now()) => bayrakVar(h, 'ccLock', t);
export const kokKilitli    = (h, t = Date.now()) => bayrakVar(h, 'rootLock', t);
export const saldiriKapali = (h, t = Date.now()) => bayrakVar(h, 'attackDisable', t);
export const esyaKilitli   = (h, t = Date.now()) => bayrakVar(h, 'itemLock', t);
export const iyilesmeTers  = (h, t = Date.now()) => bayrakVar(h, 'healInvert', t);
export const hedefUnutur   = (h, t = Date.now()) => bayrakVar(h, 'targetForget', t);
export const zorunluHedefli= (h, t = Date.now()) => bayrakVar(h, 'forcedTarget', t);
export const duyarli       = (h, t = Date.now()) => bayrakVar(h, 'susceptibility', t);
/** ccLock VEYA rootLock -> canavar/oyuncu YERINDEN kipirdayamaz. */
export const hareketKilitli= (h, t = Date.now()) => ccKilitli(h, t) || kokKilitli(h, t);

/**
 * Kilitli hedef icin gonderilecek err.key. E1 @25691996 ile ayni oncelik
 * mantigini kurar ama ko/kb (downed/knockedback) dallarini TUKETICIYE birakir.
 */
export function kilitErrAnahtari(hedef, simdi = Date.now()) {
  const l = canli(hedef, simdi);
  if (l.some((k) => k.code === 'st')) return KILIT_ERR_ANAHTARI.st;
  if (l.some((k) => DURUM_TANIM[k.code]?.ccLock)) return 'err.busy.cc';
  if (l.some((k) => k.code === 'fe')) return KILIT_ERR_ANAHTARI.fe;
  if (l.some((k) => k.code === 'ft')) return KILIT_ERR_ANAHTARI.ft;
  return null;
}

// ---------------------------------------------------------------- hiz carpanlari

/** qmt @25589973 BIREBIR: hareket hizi carpani. */
export function hareketCarpani(hedef, simdi = Date.now()) {
  let v = 1;
  for (const k of canli(hedef, simdi)) v *= 1 + (DURUM_TANIM[k.code]?.moveSlowPct ?? 0);
  return Math.max(0.1, v);
}

/** g$ @25590140 BIREBIR: saldiri/cast SURESI carpani (>1 = daha yavas). */
export function saldiriSuresiCarpani(hedef, simdi = Date.now()) {
  let v = 1;
  for (const k of canli(hedef, simdi)) v *= 1 + (DURUM_TANIM[k.code]?.atkSlowPct ?? 0);
  return 1 / Math.max(0.1, v);
}

/**
 * npcActionDelayPct carpani (fb 200, sl 125). Istemci bu bayragi TUKETMIYOR
 * (grep: yalnizca h$ icinde geciyor) - canavar YZ'sinin isidir. Coklu durumda
 * carpimsal birlestirme qmt/g$ ile AYNI kalibi izler (@25589973 / @25590140).
 */
export function npcEylemGecikmeCarpani(hedef, simdi = Date.now()) {
  let v = 1;
  for (const k of canli(hedef, simdi)) {
    const p = DURUM_TANIM[k.code]?.npcActionDelayPct;
    if (typeof p === 'number' && p > 0) v *= p / 100;
  }
  return v;
}

/**
 * Hasar zinciri + canavar YZ icin TEK GECISTE toplanmis degistirici demeti.
 * `magnitudePct` kurulum aninda kayda yazilmissa deger olarak toplanir;
 * yazilmamissa `magnitudsuz` sayacinda gorunur (bayrak aktif ama buyuklugu
 * veride YOK - orn. `bl` kayitlarinda magnitudePct alani hic bulunmuyor).
 */
export function degistiriciler(hedef, simdi = Date.now()) {
  const l = canli(hedef, simdi);
  const d = {
    kodlar: [],
    ccKilit: false, kokKilit: false, saldiriKapali: false, esyaKilit: false,
    iyilesmeTers: false, hedefUnut: false, zorunluHedef: false, duyarlilik: false,
    hareketCarpani: 1, saldiriSuresiCarpani: 1, npcEylemGecikmeCarpani: 1,
    duz: { physDefDownFlat: 0, magDefDownFlat: 0, evasionDownFlat: 0, hitDownFlat: 0 },
    yuzde: { defDownPct: 0 },
    birimiBelirsiz: { atkDown: 0, hitDown: 0, parryDown: 0, maxHpDown: 0, maxMpDown: 0, rangedRangeDown: 0 },
    etkinBayraklar: {},
    magnitudsuz: {},
    dot: [],
    mpDrainPulse: [],
  };
  let mv = 1, atk = 1, npc = 1;
  for (const k of l) {
    const t = DURUM_TANIM[k.code];
    if (!t) continue;
    d.kodlar.push(k.code);
    const mag = Number.isFinite(k.magnitudePct) ? k.magnitudePct : null;
    for (const bayrak of Object.keys(t)) {
      d.etkinBayraklar[bayrak] = (d.etkinBayraklar[bayrak] ?? 0) + 1;
      if (DUZ_BAYRAKLAR.includes(bayrak)) {
        if (mag === null) d.magnitudsuz[bayrak] = (d.magnitudsuz[bayrak] ?? 0) + 1;
        else d.duz[bayrak] += mag;
      } else if (YUZDE_BAYRAKLAR.includes(bayrak)) {
        if (mag === null) d.magnitudsuz[bayrak] = (d.magnitudsuz[bayrak] ?? 0) + 1;
        else d.yuzde[bayrak] += mag;
      } else if (BELIRSIZ_BAYRAKLAR.includes(bayrak)) {
        if (mag === null) d.magnitudsuz[bayrak] = (d.magnitudsuz[bayrak] ?? 0) + 1;
        else d.birimiBelirsiz[bayrak] += mag;
      }
    }
    if (t.ccLock) d.ccKilit = true;
    if (t.rootLock) d.kokKilit = true;
    if (t.attackDisable) d.saldiriKapali = true;
    if (t.itemLock) d.esyaKilit = true;
    if (t.healInvert) d.iyilesmeTers = true;
    if (t.targetForget) d.hedefUnut = true;
    if (t.forcedTarget) d.zorunluHedef = true;
    if (t.susceptibility) d.duyarlilik = true;
    if (t.dot) d.dot.push(k);
    if (t.mpDrainPulse) d.mpDrainPulse.push(k);
    mv *= 1 + (t.moveSlowPct ?? 0);
    atk *= 1 + (t.atkSlowPct ?? 0);
    if (typeof t.npcActionDelayPct === 'number' && t.npcActionDelayPct > 0) npc *= t.npcActionDelayPct / 100;
  }
  d.hareketCarpani = Math.max(0.1, mv);
  d.saldiriSuresiCarpani = 1 / Math.max(0.1, atk);
  d.npcEylemGecikmeCarpani = npc;
  d.hareketKilit = d.ccKilit || d.kokKilit;
  return d;
}

// ---------------------------------------------------------------------- direnc

/**
 * MADDE 50 - Canavarin statu direnci.
 * `direncler` = mob.def.combat.resists (0..100). Kodun karsiligi yoksa (ds/tb)
 * ya da mobda o kalem yoksa direnc 0 kabul edilir - 156/158 mobda dolu.
 * Sansi `chancePct * (1 - resist/100)` ile carpar.
 */
export function direncUygula(hedef, durumKodu, direncler, sansPct = null) {
  const anahtar = DIRENC_ANAHTARI[durumKodu] ?? null;
  let direncPct = 0;
  if (anahtar && direncler && Number.isFinite(Number(direncler[anahtar]))) {
    direncPct = Math.min(100, Math.max(0, Number(direncler[anahtar])));
  }
  const carpan = 1 - direncPct / 100;
  const sonuc = { anahtar, direncPct, carpan };
  if (sansPct != null) sonuc.sansPct = Math.max(0, Number(sansPct) * carpan);
  // `hedef` imzada duruyor cunku ileride hedefin KENDI statusResists'i (oyuncu
  // tarafi) buraya girecek; bugun oyuncuda o alan sabit 0 (protocol.js:101).
  if (hedef && typeof hedef === 'object' && !Array.isArray(hedef) && hedef.statusResists) {
    const ek = Number(hedef.statusResists[anahtar] ?? 0);
    if (Number.isFinite(ek) && ek > 0) {
      sonuc.hedefDirenciPct = Math.min(100, Math.max(0, ek));
      sonuc.carpan = carpan * (1 - sonuc.hedefDirenciPct / 100);
      if (sansPct != null) sonuc.sansPct = Math.max(0, Number(sansPct) * sonuc.carpan);
    }
  }
  return sonuc;
}

// --------------------------------------------------------------- seviye farki

/**
 * combatConfig.statusLevelGap. Formul paketteki $comment'ten BIREBIR (@8748909):
 *   gap = max(0, hedefSeviye - thresholdPerOpLevel * (durumSeviye + sansEkSeviye))
 *   sure  *= max(1 - durationSlope * gap, durationFloor)
 *   sans  *= max(1 - chanceSlope   * gap, chanceFloor)
 * `chanceAdd bump` teriminin kaynagi paketten okunamadi -> `sansEkSeviye`
 * PARAMETRE olarak birakildi, varsayilani 0 (yani terim etkisiz).
 */
export function seviyeFarkiSoldur(sec = {}, ayar = VARSAYILAN_AYAR) {
  const a = ayarCoz(ayar).statusLevelGap;
  const hedefSeviye = Number(sec.hedefSeviye ?? 0) || 0;
  const durumSeviye = Number(sec.durumSeviye ?? 0) || 0;
  const sansEkSeviye = Number(sec.sansEkSeviye ?? 0) || 0;
  const esik = a.thresholdPerOpLevel * (durumSeviye + sansEkSeviye);
  const gap = Math.max(0, hedefSeviye - esik);
  const sureCarpani = Math.max(1 - a.durationSlope * gap, a.durationFloor);
  const sansCarpani = Math.max(1 - a.chanceSlope * gap, a.chanceFloor);
  const cikti = { gap, sureCarpani, sansCarpani };
  if (sec.sureMs != null) cikti.sureMs = Math.round(Number(sec.sureMs) * sureCarpani);
  if (sec.sansPct != null) cikti.sansPct = Number(sec.sansPct) * sansCarpani;
  return cikti;
}

// ------------------------------------------------------------------ sure cozme

/**
 * Bir statusApplications kaydinin SURESI.
 *  1) durationMs varsa aynen (kayitlarin cogu boyle).
 *  2) yoksa (durationSource:'computed' -> yalnizca bu/ps) istemci ipucundaki
 *     formul: sure = level * (code==='bu' ? burnMsPerMargin : poisonMsPerMargin)
 *     KANIT @25921100:
 *       sec = character.durationMs === void 0
 *             ? Math.round(character.level * (character.code === `bu` ? 750 : 1e3) / 1e3)
 *             : Math.round(character.durationMs / 1e3)
 *     Bu YOL VARSAYILAN OLARAK KAPALIDIR (ayar.hesaplananSure) cunku "install
 *     margin"in gercek tanimi plana gore canli olcume birakildi (madde 17).
 */
export function sureCoz(uygulama, ayar = VARSAYILAN_AYAR) {
  const a = ayarCoz(ayar);
  const dur = Number(uygulama?.durationMs);
  if (Number.isFinite(dur) && dur > 0) {
    return { sureMs: dur, kaynak: uygulama.durationSource ?? 'authored' };
  }
  if (!a.hesaplananSure) return { sureMs: 0, kaynak: 'yok' };
  const marj = Number(uygulama?.level ?? 0);
  if (!(marj > 0)) return { sureMs: 0, kaynak: 'yok' };
  const per = uygulama.code === 'bu'
    ? a.statusDuration.burnMsPerMargin
    : a.statusDuration.poisonMsPerMargin;
  return { sureMs: Math.round(marj * per), kaynak: 'computed' };
}

// -------------------------------------------------------------------- kurulum

/**
 * Tek bir statusApplications kaydinin KURULUM ZARI.
 * Sira: temel sans -> hedef direnci (madde 50) -> seviye farki soldurma.
 * Sure de ayni seviye farkiyla soldurulur (statusLevelGap iki carpani da verir).
 */
export function kurulumZari(uygulama, sec = {}, ayar = VARSAYILAN_AYAR) {
  const a = ayarCoz(ayar);
  const kod = uygulama?.code;
  if (!kod || YOK_SAYILAN.has(kod)) return { tuttu: false, sebep: 'kod-durum-degil', code: kod ?? null };
  if (!DURUM_TANIM[kod]) return { tuttu: false, sebep: 'bilinmeyen-kod', code: kod };

  const { sureMs: hamSure, kaynak: sureKaynagi } = sureCoz(uygulama, a);
  if (!(hamSure > 0)) return { tuttu: false, sebep: 'sure-yok', code: kod, sureKaynagi };

  let sansPct = Number(uygulama.chancePct ?? 0);
  const direnc = direncUygula(sec.hedef ?? null, kod, sec.direncler ?? null, sansPct);
  sansPct = direnc.sansPct;

  const gapSonuc = seviyeFarkiSoldur({
    hedefSeviye: sec.hedefSeviye ?? 0,
    durumSeviye: uygulama.level ?? 0,
    sansEkSeviye: sec.sansEkSeviye ?? 0,
    sansPct, sureMs: hamSure,
  }, a);

  const zar = (sec.zar ?? a.zar)();
  const tuttu = zar * 100 < gapSonuc.sansPct;
  return {
    tuttu, code: kod, zar,
    sansPct: gapSonuc.sansPct, sureMs: gapSonuc.sureMs,
    direncPct: direnc.direncPct, direncAnahtari: direnc.anahtar,
    gap: gapSonuc.gap, sureKaynagi,
    sebep: tuttu ? null : 'zar',
  };
}

/**
 * Durumu hedefe kur / tazele.
 *   uygula(hedef, 'st', { seviye: 2, sureMs: 5000, kaynak: srcId })
 * Doner: { eklendi, yenilendi, atlandi, sebep, kayit }
 * Ayni kod zaten varsa YERINDE tazelenir (bugunku sunucu davranisi) - kod
 * listede kaldigi icin ayrica 'replaced' kaldirma bildirimi URETILMEZ.
 */
export function uygula(hedef, durumKodu, sec = {}) {
  const bos = { eklendi: false, yenilendi: false, atlandi: true, kayit: null };
  if (YOK_SAYILAN.has(durumKodu)) return { ...bos, sebep: 'kb-durum-degil' };
  if (!DURUM_TANIM[durumKodu]) return { ...bos, sebep: 'bilinmeyen-kod' };
  const sureMs = Number(sec.sureMs);
  if (!(sureMs > 0)) return { ...bos, sebep: 'sure-yok' };

  const simdi = Number(sec.simdi ?? Date.now());
  const l = listeAl(hedef, true);
  const kayit = {
    iid: ++iidSayaci,
    code: durumKodu,
    level: Number(sec.seviye ?? 0) || 0,
    expiresAt: simdi + sureMs,
    // --- motorun IC alanlari (telVerisi bunlari sizdirmaz) ---
    basladi: simdi,
    sonTikAt: simdi,
    tikAraligiMs: Number(sec.tikAraligiMs ?? 0) || 0,
  };
  if (sec.kaynak != null) kayit.srcId = sec.kaynak;
  if (sec.skillId != null) kayit.skillId = sec.skillId;
  if (Number.isFinite(sec.magnitudePct)) kayit.magnitudePct = sec.magnitudePct;
  if (Array.isArray(sec.argsRaw)) kayit.argsRaw = sec.argsRaw;
  if (Number.isFinite(sec.explodeDmg)) kayit.explodeDmg = sec.explodeDmg;
  if (Number.isFinite(sec.maxResFactorPct)) kayit.maxResFactorPct = sec.maxResFactorPct;
  if (Number.isFinite(sec.recoveryDownPct)) kayit.recoveryDownPct = sec.recoveryDownPct;
  if (Number.isFinite(sec.drainPctOfMaxRes)) kayit.drainPctOfMaxRes = sec.drainPctOfMaxRes;

  const eskiIdx = l.findIndex((x) => x.code === durumKodu);
  if (eskiIdx >= 0) {
    // Tazelemede DoT tik fazi korunur: yeniden kurulan yanma bastan tiklamaz.
    kayit.sonTikAt = l[eskiIdx].sonTikAt ?? simdi;
    if (!kayit.tikAraligiMs) kayit.tikAraligiMs = l[eskiIdx].tikAraligiMs ?? 0;
    l[eskiIdx] = kayit;
    return { eklendi: false, yenilendi: true, atlandi: false, sebep: null, kayit };
  }
  l.push(kayit);
  return { eklendi: true, yenilendi: false, atlandi: false, sebep: null, kayit };
}

/**
 * Bir becerinin statusApplications dizisinin TAMAMINI dener.
 * sec: { hedef, direncler, hedefSeviye, sansEkSeviye, kaynak, skillId, simdi, zar }
 * Doner: { degisti, kurulanlar:[], atlananlar:[], aktif:[] }
 */
export function beceridenUygula(hedef, uygulamalar, sec = {}, ayar = VARSAYILAN_AYAR) {
  const a = ayarCoz(ayar);
  const simdi = Number(sec.simdi ?? Date.now());
  const sonuc = { degisti: false, kurulanlar: [], atlananlar: [], aktif: [] };
  for (const u of uygulamalar ?? []) {
    const zarSonuc = kurulumZari(u, { ...sec, hedef, simdi }, a);
    if (!zarSonuc.tuttu) { sonuc.atlananlar.push({ code: u?.code ?? null, sebep: zarSonuc.sebep }); continue; }
    const r = uygula(hedef, u.code, {
      seviye: u.level, sureMs: zarSonuc.sureMs, kaynak: sec.kaynak,
      skillId: sec.skillId, simdi,
      tikAraligiMs: Number(u.tickIntervalMs ?? a.tikAraligiMs[u.code] ?? 0) || 0,
      magnitudePct: u.magnitudePct, argsRaw: u.argsRaw, explodeDmg: u.explodeDmg,
      maxResFactorPct: u.maxResFactorPct, recoveryDownPct: u.recoveryDownPct,
      drainPctOfMaxRes: u.drainPctOfMaxRes,
    });
    if (r.atlandi) { sonuc.atlananlar.push({ code: u.code, sebep: r.sebep }); continue; }
    sonuc.degisti = true;
    sonuc.kurulanlar.push({ code: u.code, kayit: r.kayit, yenilendi: r.yenilendi, zar: zarSonuc });
  }
  sonuc.aktif = aktif(hedef, simdi);
  return sonuc;
}

// -------------------------------------------------------------------------- tik

/**
 * Zaman ilerletme. Iki is yapar:
 *   1) suresi dolanlari listeden DUSURUR  -> dusenler[{code, iid, reason:'expired'}]
 *   2) DoT / mpDrainPulse TETIKLERINI dondurur (tikAraligiMs bilinen kayitlar)
 * Tik sayaci `sonTikAt` uzerinden yurur ve HICBIR ZAMAN expiresAt'i asmaz;
 * boylece bir gecikme sonrasi telafi tikleri durumun kendi omruyle sinirlidir
 * (uydurma bir "en fazla N tik" sabiti YOK).
 *
 * `hasar` alani ayar.dotHasar verilmediyse null'dir: statusApplications'ta
 * ADLANDIRILMIS bir tik-hasari alani yok, motor sayi UYDURMAZ. Tuketici
 * (combat.js / gameloop.js) combat.event(140) kind:'dot' karesini bu tetikten
 * uretir. NOT: damageScale bu tiklere UYGULANMAZ - @8749100 $comment:
 * "Does NOT touch burn/poison/blooding ticks, true damage ... or heals".
 */
export function tik(hedef, simdi = Date.now(), ayar = VARSAYILAN_AYAR) {
  const a = ayarCoz(ayar);
  const l = listeAl(hedef, false);
  const sonuc = { degisti: false, dusenler: [], dot: [], mpDrain: [], aktif: [] };
  if (!l.length) return sonuc;

  const kalan = [];
  for (const k of l) {
    const t = DURUM_TANIM[k.code];
    const ara = Number(k.tikAraligiMs ?? 0) || 0;
    if (t && ara > 0) {
      const sinir = Math.min(simdi, k.expiresAt);
      const gecen = sinir - (k.sonTikAt ?? k.basladi ?? sinir);
      const adet = gecen > 0 ? Math.floor(gecen / ara) : 0;
      if (adet > 0) {
        k.sonTikAt = (k.sonTikAt ?? k.basladi ?? sinir) + adet * ara;
        const tetik = {
          code: k.code, iid: k.iid, kayit: k, tikSayisi: adet, tikAraligiMs: ara,
          level: k.level, srcId: k.srcId ?? null, skillId: k.skillId ?? null,
          magnitudePct: Number.isFinite(k.magnitudePct) ? k.magnitudePct : null,
          argsRaw: k.argsRaw ?? null,
          drainPctOfMaxRes: Number.isFinite(k.drainPctOfMaxRes) ? k.drainPctOfMaxRes : null,
          maxResFactorPct: Number.isFinite(k.maxResFactorPct) ? k.maxResFactorPct : null,
          hasar: null,
        };
        if (typeof a.dotHasar === 'function') tetik.hasar = a.dotHasar(k, tetik);
        if (t.dot) sonuc.dot.push(tetik);
        if (t.mpDrainPulse) sonuc.mpDrain.push(tetik);
      }
    }
    if (k.expiresAt <= simdi) {
      sonuc.dusenler.push({ code: k.code, iid: k.iid, reason: 'expired' });
      sonuc.degisti = true;
    } else {
      kalan.push(k);
    }
  }
  if (sonuc.degisti) { l.length = 0; for (const k of kalan) l.push(k); }
  sonuc.aktif = l.map(telVerisi);
  return sonuc;
}

// ------------------------------------------------------------------- kaldirma

function sebepDogrula(sebep) {
  return KALDIRMA_SEBEPLERI.includes(sebep) ? sebep : 'expired';
}

/** Tek bir kodu dusur. Doner: { degisti, dusenler } */
export function dusur(hedef, durumKodu, sebep = 'expired') {
  const l = listeAl(hedef, false);
  const r = sebepDogrula(sebep);
  const dusenler = [];
  for (let i = l.length - 1; i >= 0; i--) {
    if (l[i].code !== durumKodu) continue;
    dusenler.push({ code: l[i].code, iid: l[i].iid, reason: r });
    l.splice(i, 1);
  }
  return { degisti: dusenler.length > 0, dusenler, aktif: l.map(telVerisi) };
}

/**
 * Arinma (cure/purification haplari ve becerileri). `kodlar` verilmezse HEPSI.
 * @26756085: reason 'cured' istemcide ACT_S (arinma) efektini oynatir.
 */
export function arindir(hedef, kodlar = null, sebep = 'cured') {
  const l = listeAl(hedef, false);
  const r = sebepDogrula(sebep);
  const kume = kodlar ? new Set(kodlar) : null;
  const dusenler = [];
  for (let i = l.length - 1; i >= 0; i--) {
    if (kume && !kume.has(l[i].code)) continue;
    dusenler.push({ code: l[i].code, iid: l[i].iid, reason: r });
    l.splice(i, 1);
  }
  return { degisti: dusenler.length > 0, dusenler, aktif: l.map(telVerisi) };
}

/** Olumde tum durumlari temizle (reason:'death'). */
export function temizle(hedef, sebep = 'death') {
  return arindir(hedef, null, sebep);
}

/**
 * KIRILMA KURALI - hedef hasar aldi.
 * tr.json status.se.desc: "Hareket edemezsin; vurulunca uyanirsin".
 * Yalnizca `se` (Uyku) kirilir; fz/st/stns aciklamalarinda kirilma YOKTUR.
 * Sebep 'expired' gonderilir ('cured' istemcide ARINMA efektini oynatir,
 * @26756085) - uyanma bir arinma degildir.
 */
export function hasarAldi(hedef, sec = {}) {
  const hasar = Number(sec.hasar ?? 1);
  const sonuc = { degisti: false, dusenler: [], aktif: listeAl(hedef, false).map(telVerisi) };
  if (!(hasar > 0)) return sonuc;
  const l = listeAl(hedef, false);
  for (let i = l.length - 1; i >= 0; i--) {
    if (!HASARLA_KIRILAN.has(l[i].code)) continue;
    sonuc.dusenler.push({ code: l[i].code, iid: l[i].iid, reason: 'expired' });
    l.splice(i, 1);
    sonuc.degisti = true;
  }
  sonuc.aktif = l.map(telVerisi);
  return sonuc;
}

// --------------------------------------------------------------------- fabrika

/**
 * Ayari bir kez baglayip tum fonksiyonlari donduren ince sarmalayici.
 * Motor yine SAF kalir - fabrika sadece son parametreyi onceden doldurur.
 */
export function motorKur(ayar = VARSAYILAN_AYAR) {
  const a = ayarCoz(ayar);
  return {
    ayar: a,
    DURUM_TANIM, DURUM_META, DURUM_KODLARI, DIRENC_ANAHTARI,
    YOK_SAYILAN, HASARLA_KIRILAN, KALDIRMA_SEBEPLERI, KILIT_ERR_ANAHTARI, META_YOK,
    bilgi, listeAl, telVerisi,
    canli: (h, t) => canli(h, t),
    aktif: (h, t) => aktif(h, t),
    bayrakVar: (h, b, t) => bayrakVar(h, b, t),
    ccKilitli: (h, t) => ccKilitli(h, t),
    kokKilitli: (h, t) => kokKilitli(h, t),
    hareketKilitli: (h, t) => hareketKilitli(h, t),
    saldiriKapali: (h, t) => saldiriKapali(h, t),
    esyaKilitli: (h, t) => esyaKilitli(h, t),
    iyilesmeTers: (h, t) => iyilesmeTers(h, t),
    hedefUnutur: (h, t) => hedefUnutur(h, t),
    zorunluHedefli: (h, t) => zorunluHedefli(h, t),
    duyarli: (h, t) => duyarli(h, t),
    kilitErrAnahtari: (h, t) => kilitErrAnahtari(h, t),
    hareketCarpani: (h, t) => hareketCarpani(h, t),
    saldiriSuresiCarpani: (h, t) => saldiriSuresiCarpani(h, t),
    npcEylemGecikmeCarpani: (h, t) => npcEylemGecikmeCarpani(h, t),
    degistiriciler: (h, t) => degistiriciler(h, t),
    direncUygula: (h, k, d, s) => direncUygula(h, k, d, s),
    seviyeFarkiSoldur: (s) => seviyeFarkiSoldur(s, a),
    sureCoz: (u) => sureCoz(u, a),
    kurulumZari: (u, s) => kurulumZari(u, s, a),
    uygula: (h, k, s) => uygula(h, k, s),
    beceridenUygula: (h, u, s) => beceridenUygula(h, u, s, a),
    tik: (h, t) => tik(h, t, a),
    dusur: (h, k, s) => dusur(h, k, s),
    arindir: (h, k, s) => arindir(h, k, s),
    temizle: (h, s) => temizle(h, s),
    hasarAldi: (h, s) => hasarAldi(h, s),
  };
}

export default {
  DURUM_TANIM, DURUM_META, DURUM_KODLARI, DIRENC_ANAHTARI, YOK_SAYILAN,
  HASARLA_KIRILAN, KALDIRMA_SEBEPLERI, KILIT_ERR_ANAHTARI, META_YOK,
  VARSAYILAN_AYAR, motorKur,
};
