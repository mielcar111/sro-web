/**
 * BECERI SISTEMI  -  c2s 22 `skill.cast`, c2s 23 `buff.cancel`
 * =============================================================================
 *
 * ISTEMCI SEMALARI (index-BUMMQVRB.js, T$(ad, opcode, sema, hizSinifi)):
 *
 *   @25609197  T$(`skill.cast`, 22, X({
 *                groupId: J(),                       // ZORUNLU - grup (beceri agaci dugumu)
 *                targetId: Y().int().optional(),
 *                gx: Y().optional(), gz: Y().optional(),   // yer hedefli beceriler
 *                stage: Y().int().min(1).max(7).optional(),
 *                aid: Y().int().optional()
 *              }), `combat`)
 *   @25609404  T$(`buff.cancel`, 23, X({ groupId: J() }), `combat`)
 *
 * GONDERILEN KARELER (hepsi paketten birebir):
 *   @25619327  s2c 138 cast.start  {id, groupId, castMs, targetId?, aid?, at?, q?}
 *   @25619523  s2c 139 cast.ok     {groupId, readyAt}
 *   @25622656  s2c 200 cast.queued {state:queued|started|dropped, groupId, targetId?,
 *                                   q?, aid?, reason?:rejected|superseded|cancelled|expired}
 *   @25622917  s2c 196 cast.cancel {id, aid?}
 *   @25622433  s2c 143 skill.fire  {id, skillId, targetId?, aid?, flightMs?, at?, q?}
 *   @25619700  s2c 140 combat.event{src, dst, kind:auto|skill|heal|dot, skillId?, dmg,
 *                                   mp?, hitIndex?, secondary?, blocked?, crit, dstHp, aid?, ...}
 *   @25620544  s2c 142 buffs.update{id, buffs:[{groupId, category:imbue|stat|hawk,
 *                                   expiresAt, pool?, poolMax?, allyCast?, maintained?}]}
 *   @25620680  s2c 199 statuses.update {id, statuses:[{iid, code, level, expiresAt,
 *                                   srcId?, skillId?}], removed?:[{code, reason}]}
 *   s2c 141 combat.death, 137 entity.hp, 150 vitals.update, 144/145/206 ilerleme,
 *   s2c 240 err {code, key?, q?}  - REDDETME KANALI. Istemcinin err isleyicisi
 *           (@27135792) once `$gt(codeOwner.q)` = cancelByQ(q) cagirir; yani q ile
 *           birlikte gonderilen err, istemcideki iyimser (optimistic) cast'i IPTAL
 *           eder ve `key` varsa yerellestirilmis satiri sistem kutusuna yazar.
 *
 *           ! `key` semasi qJ(Eht) = KAPALI ENUM (@25607034, 80 anahtar). Enum
 *           disinda bir anahtar sema ihlalidir. `err.ERR_*` bicimindeki anahtarlarin
 *           HICBIRI Eht'te yok - onlari gondermeye gerek de yok: istemci key
 *           yoksa `err.${code}` fallback'ini kendisi kuruyor
 *           (`let v_r = \`err.${codeOwner.code}\`; b2(v_r) && pushSys(v_r, ...)`).
 *           Bu yuzden ERR_* reddetmelerinde key GONDERILMEZ; goruntulenen metin
 *           yine tr.json'daki err.ERR_* satiridir. Eht'te olan ve burada
 *           kullanilan anahtarlar: err.skill.disabled, err.skill.requires_shield,
 *           err.skill.needs_ally, err.skill.queue_timeout.
 *
 *           NOT: `err.ERR_DEAD` tr.json'da YOK -> ERR_DEAD reddi gorunur satir
 *           yazmaz (cast yine de iptal edilir). Uydurma anahtar eklenmedi.
 *
 * PAKETTEN ALINAN DAVRANIS KURALLARI (uydurma yok):
 *   Zgt()  @25691488 : menzil = beceri.rangeU > 0 ? rangeU : giyili silahin
 *                      attackDistanceU'su (yoksa combatConfig.autoAttack.rangeU).
 *                      -> ctx.combat.oyuncuMenzili(ch) tam olarak bu ikinciyi verir.
 *   v1()   @25689971 : groupId -> knownSkills icindeki EN YUKSEK seviyeli kayit.
 *   x1()/Umt() @25690802/@25587788 : mp = trunc(mpCost*(1-mpDiscountPct/100)),
 *                      sonra varRiders icindeki WIMD/HLMD/BDMD icin pasif var yuzdesi.
 *   n_t()  @25696355 : hp maliyeti = hpCost + floor(maxHp*hpCostPct/100).
 *   b1()   @25690600 : gx/gz SADECE targetFlags.typeLand === true iken gonderilir.
 *   sgt()  @25676100 : stagePlan.length > 1 olan becerilerde ilk atesten sonra
 *                      ASAMALARI ISTEMCI ister: skill.cast {groupId, stage, aid}.
 *                      Bu yuzden sunucu 2. vurusu KENDILIGINDEN atmaz.
 *   err    @27135792 : reddetme kanali (yukarida).
 *   buff UI@27327500 : maintained -> "sonsuz" gosterir, expiresAt'e bakmaz;
 *                      buff ikonuna sag tik -> buff.cancel {groupId}.
 *
 * VERI: server/data/skills.json  (paketten cikarilmis 3256 beceri; alan adlari
 *       paketle birebir: kind, target, mpCost, castMs, cooldownMs, actionMs,
 *       rangeU, flySpeedU, hits, physCoeff, physFlat*, magCoeff, magFlat*,
 *       hitPlan[], stagePlan[], targetFlags{}, aoe{}, buff{}, heal{},
 *       statusApplications[], reqWeapons[], reqShield, usesMaatMastery,
 *       autoContinue, hpCost, hpCostPct, varRiders[], disabled)
 *
 * HASAR ZINCIRI: butun sabitler ctx.combat.cfg'den (combat.json) okunur, hicbiri
 * bu dosyada yazili degildir. Hasarin KENDISI artik combat.js'in TEK
 * cekirdeginden (`combat.hasarCekirdegi`) gecer - blok zari `combat.blokAtildi`
 * (HEDEFIN kalkani), rulo usteli `combat.kacinmaOrani` (mobun `er` sutunu),
 * olcek `combat.hasarOlcegi`. Yerel rulo/seviyeCarpani/seviyeFarkiCarpani
 * yardimcilari yalniz cekirdege GIRDI uretir.
 *
 * !! ACIK NOKTA - KATSAYI SIRASI: combat.js taban saldiri katsayisini SAVUNMA
 *    DUSULDUKTEN SONRA uyguluyor (canli olcumle dogrulanmis); bu modul beceri
 *    katsayisini savunmadan ONCE uyguluyor (`katsayiSavunmaSonrasi: false`).
 *    Beceri satiri icin hangi siranin dogru oldugu PAKETTEN COZULEMEDI
 *    (plan md.32) - iki taraf da AYNI parametreyi kullaniyor, olcum yapilinca
 *    tek satir degisir.
 *
 * =============================================================================
 * G4b DALGASI - EKLENEN KAYNAKLAR (hepsi bayt dokumu ile dogrulandi)
 * =============================================================================
 *   @8692875   `lot` = 28 groupId'lik BEYAZ LISTE (madde 14). Istemci cok
 *              asamali becerinin 2..N. asamasini YALNIZ bu gruplar icin istiyor:
 *              agt(s) @25675988 = lot.has(groupId) && stagePlan.length > 1.
 *              skill.fire isleyicisi @27124643 agt() false ise cgt() CAGIRMIYOR.
 *              Zamanlama: sgt() @25676500 -> firedAtServer + releaseOffsetMs.
 *   @25916200  Ubt: buff/dans MOD alanlarinin BIRIM tablosu {labelKey, pct}.
 *   @25917900  T2(): pct:true -> `Math.round(v*100)+'%'` (yani KESIR),
 *              pct:false -> ham sayi, autoRangeU -> v/1.5 metre,
 *              mpCostPct EKSIYLE cizilir (pozitif = INDIRIM).
 *   @8659700   Sat semasi (buff.mods 26 alan) / @8662700 wat (passive.mods)
 *   @8661641   buff.onHit {magCoeff, magFlat, magFlatMin, magFlatMax} - imbue
 *   @27018044 / @27021640  istemci hasar yazisi = `dmg + (imbueDmg ?? 0)`,
 *              `imbue:` bayragi ozel renk; `e.ko` -> playKnockdown(e.ko);
 *              `parried` ayri yazi.
 *   @27110113  Mjt(): `let v = e.ko ?? e.kb; noteSelfDowned(v, e.ko?'ko':'kb')`
 *   @25659021  noteSelfDowned(ms) -> selfDownedUntil = now + ms  (ko/kb = SURE)
 *   @25691996  E1() kapi SIRASI: dead -> selfCcLocked(downed/knockedback) ->
 *              cooldown -> MP -> HP -> alet -> silah -> kalkan -> disabled ->
 *              needs_ally -> r_t -> dance.requiresSong -> IMBUE (erken donus,
 *              isSelfCasting'den ONCE) -> isSelfCasting
 *   @25671260  selfCcLocked() = selfDowned() || h$[code].ccLock
 *   @25695700  t_t(): requiresSong -> BASKA bir oyuncunun allyCast OLMAYAN,
 *              dance.isSong tasiyan buff'i areaU menzilinde mi
 *   @25690600  b1(): gx/gz YALNIZ targetFlags.typeLand === true iken gonderilir
 *   @27121093  entity.teleport: `!node.blink` ise YUKLEME EKRANI acilir
 *   @25920425  ipucu cizicisi - BIRIM KANITI:
 *                heal.overTime.pulsRaw/1e3 sn, duraRaw/1e3 sn  -> MILISANIYE
 *                heal.areaU/1.5 metre                          -> BIRIM (U)
 *                drain_line {dmg} = drain.flat  -> savunmayi yok sayan hasar
 *                drain_hp  (parametresiz)       = drain.mwhsPct VARSA
 *                drain_mp  {pct} = drain.toMpPct
 *   @25921100  durationMs YOKSA sure = level * (code==='bu' ? 750 : 1000) ms
 *              (combat.json statusDuration ile birebir ayni iki sayi)
 *   @25075309  LY: durum kodu -> bit  (cure maskelerinin cozumu)
 *   data/combat.json  knockdown.downMs 2500 / mpShield.burnRatio 1.5 /
 *              caps.absorbShellPct 90 / caps.painQuotaDispersePct 100 /
 *              pets.hawkRateH / statusLevelGap / statusDuration
 *   data/mobs.json    combat.koRecoverMs (158/158 mobda: 3000 ya da 0)
 *   tr.json    err.busy.downed/knockedback/stunned/cc, err.skill.feared /
 *              forced_target / requires_downed / requires_song /
 *              weapon_broken / shield_broken, ui.buffs.wall_title,
 *              ui.skill.mod_*, ui.skill.drain_*, ui.skill.heal_area /
 *              heal_over_time / dance_pulse
 *
 * BILEREK UYGULANMAYANLAR (kaynak gosterilemedigi icin - plan md.1 kurali)
 *   - `varRiders`in MP_RIDER disindaki 36 kodu (madde 36): ad kaliplarindan
 *     tahmin edilip sayi uydurulmadi. Pasiflerin ADLANDIRILMIS `passive.mods`
 *     blogu uygulaniyor - sikayetin somut yarisi (SP harcayip hicbir sey
 *     kazanmama) bu yolla kapandi.
 *   - `overlapRaw` / `buff.overlapClassRaw` bit maskesi (madde 53): yalnizca
 *     "ayni anda TEK imbue" kurali uygulandi.
 *   - `aoeLine.shapeRaw` (madde 63): serit uzunlugu icin sayi uydurulmadi,
 *     menzil (rangeU / silah menzili) kullanildi.
 *   - DoT (bu/ps/bl) TIK BASINA HASARI (madde 17): statusApplications'ta
 *     adlandirilmis bir hasar alani YOK. Kanal ve tik tetigi hazir; sayi
 *     netlesince `motorKur({ dotHasar })` tek satirda acar. Gercek periyodik
 *     hasar bugun `periodicAtt` uzerinden geliyor (uydurma sayi yok).
 *   - `kb` MESAFESI, `koLevel`/`koClass` iliskisi, `reflect.chancePctRaw`,
 *     `retaliate.abnbRaw`, `drain.mwhsPct`in sayisal rolu, `drain.clampLevelGap`,
 *     `cure.curt.amount`, `cure.curl.cureLevel`, `hawkStrike.levelRaw`,
 *     `heal.weaponMagPct`, `heal.division`, `stealth.hideArgsRaw`,
 *     `physDealtFactorPct` / `magDealtFactorPct` / `critDownRating` BIRIMI.
 *   - combat.event `stun` alani: 27 MB'lik istemcide `stun:` TEK KEZ geciyor
 *     (@25620362 = semanin kendisi) - hicbir tuketicisi yok, GONDERILMIYOR.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as durumlar from './durumlar.js';
/* MADDE 26 (capraz istek 39): dusen ekipmanin S$ ornegi (yeniYigin). */
import * as esya from './esya.js';

/* MP dusuren rider kodlari - paket: `var Hmt = new Set(["WIMD","HLMD","BDMD"])` @25587747 */
const MP_RIDER = new Set(['WIMD', 'HLMD', 'BDMD']);

/**
 * MADDE 40 - artik dance / cure / teleport de uygulaniyor.
 * `stealth` LISTEYE ALINMADI ve bu bir eksiklik DEGIL: data/skills.json'daki
 * 13 stealth kaydinin 13'u de `disabled:true` (olcum: kind sayimi
 * stealth [13 toplam, 0 aktif]) - yani castIstek zaten daha ustteki
 * `skill.disabled` kapisinda err.skill.disabled ile reddediyor. Gorunmezligin
 * istemci karsiligi da (hideArgsRaw'in anlami, "algilama seviyesi") paketten
 * cozulemedi; kaynaksiz bir gorunmezlik bayragi uydurulmadi.
 * `revive` yine kendi modulunde (sistem_dirilis-unique.js) - asagida false doner.
 */
const DESTEKLENEN = new Set([
  'attack', 'nuke', 'buff', 'imbue', 'heal', 'debuff', 'cure', 'dance', 'teleport',
]);

/**
 * MADDE 14 - `lot` BEYAZ LISTESI. Paket @8692875 (bayt dokumu ile BIREBIR):
 *   lot = new Set(`rog_bowa_power_b.rog_bowa_knock_b....bow_chain_d`.split(`.`))
 * Istemci cok asamali becerinin 2..N. asamalarini YALNIZ bu 28 grup icin
 * kendisi istiyor:  agt(s) = !!s && lot.has(s.groupId) && (s.stagePlan?.length ?? 0) > 1
 * (@25675988) ve skill.fire isleyicisi (@27124643) agt() false ise cgt()
 * CAGIRMIYOR, yalniz armSelfAction(actionMs) yapiyor.
 * SONUC: lot DISINDAKI cok asamali becerilerde 2..N. vuruslari SUNUCU
 * zamanlamak zorunda; lot ICINDEKILERDE zamanlamamali (yoksa istemcinin
 * gonderdigi asama istegi ile CIFT vurur).
 * Zamanlama ani da paketten: sgt() @25676500
 *   v_n = max(0, firedAtServer + stagePlan[stage].releaseOffsetMs - serverNow())
 */
const LOT = new Set(
  ('rog_bowa_power_b.rog_bowa_knock_b.rog_daggera_slash_a.rog_daggera_wound_b.'
  + 'rog_daggera_slash_b.sword_smash_c.sword_smash_d.sword_chain_a.sword_chain_b.'
  + 'sword_chain_c.sword_chain_d.sword_chain_e.sword_chain_f.sword_geomgi_c.'
  + 'sword_geomgi_d.sword_downattack_c.spear_pierce_d.spear_frontarea_b.'
  + 'spear_frontarea_d.spear_stun_c.spear_stun_d.spear_chain_a.spear_chain_b.'
  + 'spear_chain_c.spear_chain_d.spear_chain_e.bow_chain_c.bow_chain_d').split('.'),
);

/**
 * MADDE 19 - BUFF MODS MOTORU: alan adi -> BIRIM.
 *
 * Birimler UYDURULMADI, istemcinin KENDI ipucu cizicisinden okundu.
 * Paket Ubt @25916200-25917950 (bayt dokumu) her alan icin {labelKey, pct}
 * tasiyor ve T2() @25917900 sunu yapiyor:
 *     v_o = n === `autoRangeU` ? `${Math.round(v/1.5*10)/10}m`
 *         : Ubt[n].pct        ? `${Math.round(v * 100)}%`
 *                             : `${v}`
 * Yani `pct:true` alanlar KESIR (0.75 = %75), `pct:false` alanlar mutlak
 * sayidir; autoRangeU birim (U) cinsindendir ve ekranda 1.5 U = 1 m.
 * Veri de bunu dogruluyor: physAtkPct max 0.75, mpShieldPct 0.2..0.5
 * (sema @8659700 `Y().min(0).max(1)`), physDefFlat 2..975.
 *
 * `mpCostPct` T2()'de EKSIYLE cizilir (`v_a = n === 'mpCostPct' ? -v : v`) ->
 * POZITIF deger MP INDIRIMIDIR.
 *
 * BIRIMI COZULEMEYEN IKI ALAN (Ubt'de YOKLAR, veri tamsayi -35):
 *   physDealtFactorPct / magDealtFactorPct  -> UYGULANMAZ, `belirsiz`
 *   sayacinda gorunur. Kaynak cikinca tek satirla acilir.
 * passive.mods'taki `critDownRating` de UYGULANMAZ: kimin kritigini
 * dusurdugu (kendi mi, sana vuranin mi) paketten okunamadi.
 */
const MOD_KESIR = new Set([
  'physAtkPct', 'magAtkPct', 'physDefPct', 'magDefPct', 'maxHpPct', 'maxMpPct',
  'moveSpeedPct', 'mpShieldPct', 'regenBoostPct', 'regenBoostMpPct',
  'healPowerPct', 'mpCostPct',
]);
const MOD_DUZ = new Set([
  'physAtkFlat', 'magAtkFlat', 'physDefFlat', 'magDefFlat',
  'blockRatioFlat', 'hitRatioFlat', 'parryRatioFlat', 'critRatingFlat',
  'maxHpFlat', 'maxMpFlat', 'strFlat', 'intFlat', 'autoRangeU',
]);
/** Birimi paketten OKUNAMAYAN alanlar - toplanir ama HICBIR YERE uygulanmaz. */
const MOD_BELIRSIZ = new Set(['physDealtFactorPct', 'magDealtFactorPct', 'critDownRating']);

/* YALNIZCA MENZIL kuyrugu (s.kuyruk): hedefe yaklasilirken beklenen sure.
   Pakette bir SAYI yok (yalniz `err.skill.queue_timeout` = "Too far away - the
   queued skill was cancelled." metni var); bu yuzden gameloop.js'in ayni isi yapan
   yaklasma zaman asimi (ALMA_ZAMAN_ASIMI_MS = 15_000) ile ayni tutuldu.
   DIKKAT: AKSIYON PENCERESI kuyrugu (s.eylem, MADDE 37) bu sayiyi 2026-09-04'e
   kadar odunc aliyordu; artik data/combat.json combatConfig.skillQueue
   .actionWindowHoldMs (paketin kendi N_t = 200 ms'i) kullaniliyor. */
const KUYRUK_ZAMAN_ASIMI_MS = 15_000;

/* Bir aksiyonun (aid) asama istekleri icin acik kalma suresi. En uzun stagePlan
   toplami ~3 sn; 30 sn fazlasiyla yeterli, sadece bellek temizligi icin var. */
const AKSIYON_OMRU_MS = 30_000;

/**
 * MODUL KAPSAMINDA YASAYAN ORNEK - yeniden kurulumda tik + durum devri.
 *
 * NEDEN: server.js `sistemleriKur()` (server.js:1337) SISTEMLER dizisini
 * bosaltip TUM modulleri yeniden kuruyor; bu hem acilista (once
 * sistemleriKur(), sonra initSql sonrasi sistemleriKur(true)) hem de admin
 * panelinden her ayar degisiminde oluyor. Eski ornegin `dur()` metodu HIC
 * cagrilmadigi icin:
 *   a) eski setInterval CALISMAYA DEVAM ediyordu -> ayni oyuncu iki kez
 *      tiklaniyor: buff sureleri ve upkeep MP tuketimi IKI KAT hizli
 *      isliyor, suresi dolan durumlar icin statuses.update IKI kez gidiyor,
 *   b) `DURUMLAR` (stun/burn/root tablosu) yeni ornekte BOS basliyordu ->
 *      oyuncunun uzerindeki durumlar sunucu tarafinda sessizce yok oluyordu,
 *   c) `oyuncular` kumesi bos oldugu icin ws.bec uzerindeki buff'lar artik
 *      TIKLANMIYORDU: buff hic bitmiyor (payload istemcide asili kaliyor)
 *      ama upkeep de islemiyordu.
 * ESM modul onbellegi bu degiskeni yeniden kurmalar arasinda yasatir; ayni
 * kalibi sistem_kucuk-sistemler.js (satir 298) ve sistem_binek-pet.js
 * (satir 152) zaten kullaniyor.
 *
 * DEVREDILMEYEN TEK SEY: `isler` (zamanlanmis vurus/mermi isabetleri).
 * Bunlar ESKI ornegin fonksiyonlarina kapanmis geri cagirmalardir; yeni
 * ornege tasinsalar ayni hasar iki farkli tabloya uygulanabilirdi. Yeniden
 * kurulum aninda ucusta olan mermiler dusurulur (en fazla ~1 sn'lik pencere).
 */
let ONCEKI_ORNEK = null;

export function kur(ctx) {
  /* Onceki ornegi durdur ve devralinacak durumu al (yukaridaki nota bak).
     DEVIR KAPISI: durum yalnizca AYNI CALISAN DUNYA icin devredilir.
     server.js `sistemCtx()` her cagrida ayni `world: WORLDSIM` nesnesini
     verir (server.js:1287 `world: WORLDSIM`) - yeniden kurulum ayni
     oturumdur. Birim testleri her kur() icin TAZE bir sahte world veriyor;
     orada devir OLMAMALI, aksi halde testler birbirinin buff/durum tablosunu
     gorurdu. Zamanlayici HER DURUMDA durdurulur (asil sizinti o). */
  const devir = (() => {
    if (!ONCEKI_ORNEK) return null;
    try { return ONCEKI_ORNEK._devret(ctx?.world ?? null); }
    catch { return null; }
    finally { ONCEKI_ORNEK = null; }
  })();

  const {
    world, combat, frame, broadcast,
    GCFG = {}, ITEMSTATS = null,
  } = ctx;
  const log = ctx.log ?? (() => {});
  const derived = ctx.derived ?? ((ch) => combat.turetilmis(ch));
  const simdi = ctx.now ?? (() => Date.now());
  /* aid uzayi: gameloop.js kendi sayacini 1'den baslatiyor. Ayni sayilari
     uretirsek istemcinin fireMatches/adoptable eslestirmesi (aid oncelikli)
     yanlis aksiyona baglanir. Bu yuzden beceri aksiyonlari AYRI bir aralikta
     uretilir; baglayan taraf isterse ctx.aidUret ile ortak sayac verebilir. */
  let aidSayaci = 1_000_000;
  const yeniAid = ctx.aidUret ?? (() => ++aidSayaci);
  const TIK_MS = Math.max(20, Math.round(1000 / (GCFG.tickHz ?? 10)));

  /**
   * PP md.1 - KOMBO KESME (chain) YAPILANDIRMASI.
   * Kaynak: combat.json `chain` blogu = paket config/combat-config.json
   * 106-111 (preemptOnCast:true, lockToleranceMs:300, selectGraceMs:2000;
   * $comment: interim-invented, BR-0167 seam). Blok yoksa (eski config ya
   * da birim testlerinin sahte combat'i) preempt KAPALI = eski davranis.
   */
  const ZINCIR = combat?.cfg?.chain ?? {};

  /**
   * MADDE 16/17/18/50/52 - DURUM MOTORU. durumlar.js SAF motordur (I/O yok);
   * ayarini combat.json'dan aliyor - hicbir sayi burada yazili degil.
   *
   * `hesaplananSure: true` ACIK: durationMs TASIMAYAN 174 kayit (134 bu + 40 ps,
   * hepsi durationSource:'computed') aksi halde sessizce dusuyordu. Sure formulu
   * UYDURMA DEGIL, ISTEMCININ KENDI IPUCU CIZICISI (paket @25921100, bayt dokumu
   * ile dogrulandi):
   *     sec = character.durationMs === void 0
   *         ? Math.round(character.level * (character.code === `bu` ? 750 : 1e3) / 1e3)
   *         : Math.round(character.durationMs / 1e3)
   * ve iki sayi combat.json statusDuration'daki burnMsPerMargin 750 /
   * poisonMsPerMargin 1000 ile BIREBIR ayni. Yani "install margin" = kaydin
   * `level` alani; sunucu baska bir sure kullansaydi istemcinin ipucu YALAN
   * soyluyor olurdu. (Plan md.17 bunu canli olcume birakiyordu; olcum
   * yapilincaya kadar istemcinin ILAN ETTIGI sureyi kullanmak, sureyi hic
   * uygulamamaktan da sayi uydurmaktan da dogru.)
   */
  const durumMotoru = durumlar.motorKur({
    statusLevelGap: combat.cfg.statusLevelGap,
    statusDuration: combat.cfg.statusDuration,
    hesaplananSure: true,
  });

  // ----------------------------------------------------------------- veri
  const dataDir = ctx.dataDir ?? world?.dataDir
    ?? path.join(path.dirname(fileURLToPath(import.meta.url)), 'data');

  /** id -> beceri */          const BECERI = new Map();
  /** groupId -> [beceri...] */const GRUP = new Map();
  /** groupId -> skillFx kaydi (S1 md.1 - flightMs paritesi).
   *  skills.json ust duzey `skillFx` (437 kayit, 13 sinif verisiyle ayni
   *  cikarim). ucusMs() flySpeedU=0 olan gruplarda mermi hizini buradan
   *  turetir (paket oOt govdesi @26699833). `skillFxOverrides` BILEREK
   *  YOKSAYILIR: 3 girdisinde AT_MOV yok (curut_flight_sayim.mjs). */
  const FXGRUP = new Map();

  (function veriYukle() {
    const p = path.join(dataDir, 'skills.json');
    if (!fs.existsSync(p)) { log('beceri: skills.json yok - sistem devre disi'); return; }
    let ham;
    try { ham = JSON.parse(fs.readFileSync(p, 'utf8')); }
    catch (e) { log('beceri: skills.json bozuk - ' + e.message.slice(0, 80)); return; }
    const liste = Array.isArray(ham) ? ham : (ham.skills ?? []);
    for (const s of liste) {
      if (!s?.id || !s?.groupId) continue;
      BECERI.set(s.id, s);
      if (!GRUP.has(s.groupId)) GRUP.set(s.groupId, []);
      GRUP.get(s.groupId).push(s);
    }
    for (const l of GRUP.values()) l.sort((a, b) => (a.skillLevel ?? 0) - (b.skillLevel ?? 0));
    /* S1 md.1: fx grubu dizini (dizi-bicimli eski skills.json'da skillFx yok
       -> Map bos kalir, ucusMs eski davranisa duser). */
    for (const f of (Array.isArray(ham) ? [] : (ham.skillFx ?? []))) {
      if (f?.groupId) FXGRUP.set(f.groupId, f);
    }
    log(`beceri: ${BECERI.size} beceri / ${GRUP.size} grup / ${FXGRUP.size} fx grubu yuklendi`);
  })();

  /**
   * Toplama aleti silah turleri. Paket lY @8693480:
   *   var lY = { profession_axe: `lumberjack`, profession_pickaxe: `miner` };
   *   function uY(arg_e) { return arg_e in lY; }
   * Tablo SABIT YAZILMAZ - data/professions.json'daki `toolWeaponType`
   * alanindan turetilir (dosya, paket_veri/config/professions.json'un
   * kopyasi). Dosya okunamazsa kume bos kalir ve kapi kendiliginden acilir.
   */
  const ALET_TURLERI = (function aletTurleriYukle() {
    const kume = new Set();
    try {
      const p = JSON.parse(fs.readFileSync(path.join(dataDir, 'professions.json'), 'utf8'));
      for (const d of p?.professions ?? []) if (d?.toolWeaponType) kume.add(String(d.toolWeaponType));
    } catch { log('beceri: professions.json okunamadi - toplama aleti kapisi kapali'); }
    return kume;
  })();

  // ------------------------------------------------------------- durumlar
  /** Zamanlanmis isler: {at, fn}. Tek tik dongusu isletir. */
  const isler = [];
  const sonra = (at, fn) => { isler.push({ at, fn }); };

  /** Beceri durumu olan oyuncular (temizlik icin). Yeniden kurulumda
   *  onceki ornekten DEVRALINIR - yoksa mevcut oyuncularin buff'lari
   *  tiklanmaz (bkz. ONCEKI_ORNEK notu, madde c). */
  const oyuncular = devir?.oyuncular ?? new Set();

  /** Varlik durumlari (stun/root/burn...): `${zoneId}|${entityId}` -> [x$ kaydi] */
  const DURUMLAR = devir?.DURUMLAR ?? new Map();
  /* iid tekilligi: devralinan kayitlarin en buyuk iid'sinden devam et ki
     yeni durumlar eski kayitlarla ayni iid'yi almasin (istemci statuses
     listesini iid ile esliyor - sema x$ @25593977). */
  let iidSayaci = devir?.iidSayaci ?? 0;

  function durum(ws) {
    let s = ws.bec;
    if (!s) {
      s = ws.bec = {
        cd: new Map(),        // groupId -> readyAt
        cast: null,           // {aid, skill, targetId, q, ateslemeAt, groupId}
        kuyruk: null,         // {skill, targetId, q, bitis}
        aksiyon: new Map(),   // aid -> {skill, targetId, firedAt, bitis}
        buff: new Map(),      // groupId -> {payload, skill, sonUpkeep}
        /* Durum tablosu anahtari BOLGEYI iceriyor (`${zoneId}|${entityId}`).
           Oyuncunun o an hangi bolge altinda kayitli oldugunu burada
           tutuyoruz ki bolge gecisinde anahtari tasiyabilelim - bkz.
           bolgeEsitle(). */
        zone: ws.zoneId ?? null,
      };
      oyuncular.add(ws);
    } else if (s.zone === undefined) {
      s.zone = ws.zoneId ?? null;      // devralinan eski kayitlar icin
    }
    return s;
  }

  /**
   * BOLGE GECISINDE DURUM ANAHTARINI TASI.
   *
   * NEDEN: DURUMLAR anahtari `${zoneId}|${entityId}`. bolge.js gecerken
   * ws.zoneId'yi degistiriyor ama entityId'yi KORUYOR (bolge.js:50 ve :163).
   * Anahtar eski bolgede kaldigi icin oyuncunun uzerindeki stun/burn/root
   * kayitlari yeni bolgede GORUNMEZ hale geliyordu; ustelik suresi dolunca
   * statuses.update ESKI bolgeye yayinlanip yeni bolgedeki istemcide ikon
   * ASILI kaliyordu.
   * referans oyunda bolge devir zarfi durumlari tam tik durumuyla TASIYOR
   * (arastirma: devir zarfi @25599439), yani tasima dogru davranistir.
   */
  function bolgeEsitle(ws) {
    const s = ws?.bec;
    if (!s || ws.entityId == null) return;
    if (s.zone === ws.zoneId) return;
    if (s.zone != null) {
      const eski = durumAnahtar(s.zone, ws.entityId);
      const yeniA = durumAnahtar(ws.zoneId, ws.entityId);
      const l = DURUMLAR.get(eski);
      DURUMLAR.delete(eski);
      if (l?.length) DURUMLAR.set(yeniA, l);
      /* MADDE 18: serilme penceresi de bolgeye anahtarli - tasinmazsa
         isinlanan oyuncu yere serili kalirdi (kayit eski bolgede unutulur). */
      const kd = SERILI.get(eski);
      SERILI.delete(eski);
      if (kd) SERILI.set(yeniA, kd);
    }
    s.zone = ws.zoneId ?? null;
  }
  const canli = (ws) => !!(ws && ws.char && ws.readyState !== 3 /* CLOSED */);

  // ------------------------------------------------------------ yardimcilar
  const esyaDef = (id) => ITEMSTATS?.get?.(id) ?? combat?.itemStats?.get?.(id) ?? null;
  const esyaId = (v) => (typeof v === 'string' ? v : v?.itemId);

  /** yayin: once dokunan oyuncuya, sonra bolgedeki digerlerine (gameloop ile ayni duzen). */
  function yayin(ws, t, d) {
    /* KESIRLI HASAR EMNIYETI (bulgu ALAN 1): combat.event(140) semasi dmg'yi
       int ister ve istemci String(n) ile YUVARLAMADAN cizer - kesirli deger
       kacarsa ekranda "442.7" gorunur. Butun ureticiler bugun tamsayi
       (olcum: 80+ event, 0 kesirli); bu tek-nokta kemeri gelecekteki
       regresyonu keser, davranisi degistirmez. */
    if (t === 'combat.event' && d && typeof d.dmg === 'number' && !Number.isInteger(d.dmg)) {
      d.dmg = Math.round(d.dmg);
    }
    frame(ws, t, d);
    broadcast(ws.zoneId, t, d, ws);
  }

  /** Reddetme. Istemci err.q ile iyimser cast'i iptal eder, key varsa satiri yazar. */
  function hata(ws, code, key, q) {
    const d = { code };
    if (key) d.key = key;
    if (q !== undefined) d.q = q;
    frame(ws, 'err', d);
  }

  /** Paket v1(): gruptaki EN YUKSEK seviyeli BILINEN beceri. */
  function beceriCoz(ch, groupId) {
    const liste = GRUP.get(groupId);
    if (!liste) return null;
    const bilinen = new Set(ch.knownSkills ?? []);
    for (let i = liste.length - 1; i >= 0; i--) if (bilinen.has(liste[i].id)) return liste[i];
    return null;
  }

  /** Paket Gmt()+Wmt(): bilinen pasiflerin `passive.vars` haritasi. */
  function pasifDegiskenler(ch) {
    const map = new Map();
    const bilinen = new Set(ch.knownSkills ?? []);
    if (!bilinen.size) return map;
    for (const liste of GRUP.values()) {
      if (liste[0]?.kind !== 'passive') continue;
      for (let i = liste.length - 1; i >= 0; i--) {
        if (!bilinen.has(liste[i].id)) continue;
        for (const [k, v] of Object.entries(liste[i].passive?.vars ?? {})) map.set(k, v);
        break;
      }
    }
    return map;
  }

  /** Paket x1()/Umt(). */
  function mpMaliyeti(ch, skill) {
    let v = skill.mpCost ?? 0;
    const dus = (pct) => { if (pct > 0) v = Math.trunc(v * (1 - Math.min(100, pct) / 100)); };
    /* MADDE 19: mpDiscountPct combat.js'te SABIT 0 - artik buff/dans
       `mpCostPct` modu (Sat @8660361, T2() ekside cizer = indirim) buraya
       derivedMod uzerinden giriyor. */
    dus(derivedMod(ch)?.mpDiscountPct ?? 0);
    const riders = skill.varRiders ?? [];
    if (riders.length) {
      const vars = pasifDegiskenler(ch);
      for (const r of riders) if (MP_RIDER.has(r)) dus(vars.get(r) ?? 0);
    }
    return Math.max(0, v);
  }

  /** Paket n_t(). */
  function hpMaliyeti(ch, skill) {
    const flat = skill.hpCost ?? 0;
    const pct = skill.hpCostPct ?? 0;
    if (pct <= 0) return flat;
    return flat + Math.floor((derivedMod(ch)?.maxHp ?? 0) * pct / 100);
  }

  /**
   * Paket Zgt() + MADDE 61 `rangeAddU` + MADDE 19 `autoRangeU`.
   *   rangeAddU: sema @8664700 `rangeAddU: Y().positive().optional()`, 36
   *     beceride var. Zgt() yalniz rangeU'yu okuyor ama alan MENZIL EKI olarak
   *     adlandirilmis ve baska hicbir tuketicisi yok - beceri menziline eklenir.
   *   autoRangeU: buff.mods alani (Ubt'de `pct:false`, ekranda U/1.5 = metre).
   *     Yalniz OTOMATIK saldiri menzilini (rangeU == 0 dali) buyutur - beceri
   *     kendi rangeU'sunu tasiyorsa ona karisilmaz.
   */
  function menzilU(ch, skill) {
    const ek = Number(skill.rangeAddU ?? 0) || 0;
    if ((skill.rangeU ?? 0) > 0) return skill.rangeU + ek;
    const w = wsOf(ch);
    return combat.oyuncuMenzili(ch) + (w ? modDuz(w, 'autoRangeU') : 0) + ek;
  }

  /** Paket y1(): giyili silahin weaponType'i (silah yoksa null). */
  function silahTuru(ch) {
    const def = esyaDef(esyaId(ch?.equip?.weapon));
    return def?.type === 'weapon' ? (def.weaponType ?? null) : null;
  }
  /**
   * Paket fY() @8694009 - BIREBIR (bayt dokumu ile dogrulandi):
   *   function fY(o) {
   *     if (o.reqItemsAll === !0 && (o.reqItems ?? []).filter(i => i.itemType === dY.weapon).length > 1) return [];
   *     if ((o.reqItems?.length ?? 0) > 0) { ...silah satirlarindan set kur...
   *       return set.size > 0 ? [...set] : void 0; }
   *     let l = o.reqWeapons ?? []; return l.length > 0 ? [...l] : void 0;
   *   }
   * DIKKAT UC NOKTA:
   *   1) `reqItems` VARSA `reqWeapons` TAMAMEN YOK SAYILIR (ezer).
   *   2) reqItems satirindaki `count` alani ADET DEGIL, SILAH TURU KIMLIGIDIR;
   *      cozum tablosu fot @8693734 (2 sword ... 15 eu_staff). itemType haritasi
   *      dY @8693660 = { armorA:9, armorB:10, shield:4, weapon:6 }.
   *   3) reqItems var ama icinde silah satiri YOKSA -> undefined = KAPI YOK.
   * Donus: undefined = kapi yok | [] = HICBIR silah gecmez | dizi = izinli turler.
   *
   * ESKIDEN NE OLUYORDU: yalniz `reqWeapons` okunuyordu. data/skills.json
   * olcumu: reqItems ile silah isteyip reqWeapons TASIMAYAN 96 AKTIF beceri
   * (13 grup, tamami `warrior` - Frenzy/Guard agaci, orn.
   * warrior_frenzya_tount_a_1 -> eu_sword|eu_tsword|eu_axe) hicbir silah
   * kapisindan gecmiyordu; CIPLAK ELLE bile atilabiliyorlardi.
   * Ters yonde (bizim fazla siki oldugumuz) TEK BIR kayit bile yok - yani bu
   * degisiklik hicbir mesru kullanimi kapatmaz.
   */
  const TIP_SILAH = 6, TIP_KALKAN = 4;                       // paket dY @8693660
  const SILAH_TURU_ID = {                                    // paket fot @8693734
    2: 'sword', 3: 'blade', 4: 'spear', 5: 'glavie', 6: 'bow',
    7: 'eu_sword', 8: 'eu_tsword', 9: 'eu_axe', 10: 'eu_darkstaff',
    11: 'eu_tstaff', 12: 'eu_crossbow', 13: 'eu_dagger', 14: 'eu_harp', 15: 'eu_staff',
  };
  function izinliSilahlar(skill) {
    const ri = skill.reqItems ?? [];
    const silahSatiri = ri.filter((i) => i && i.itemType === TIP_SILAH);
    if (skill.reqItemsAll === true && silahSatiri.length > 1) return [];
    if (ri.length > 0) {
      const kume = new Set();
      for (const i of silahSatiri) { const t = SILAH_TURU_ID[i.count]; if (t) kume.add(t); }
      return kume.size > 0 ? [...kume] : undefined;
    }
    const l = skill.reqWeapons ?? [];
    return l.length > 0 ? [...l] : undefined;
  }
  /** Paket S1() @25691119: `return liste ? tur !== null && liste.includes(tur) : !0` */
  function silahUygun(skill, tur) {
    const gerek = izinliSilahlar(skill);
    if (!gerek) return true;                    // undefined -> kapi yok
    return tur !== null && gerek.includes(tur); // [] -> hicbir silah gecmez
  }
  /**
   * Paket pY() @8694907 - BIREBIR:
   *   return o.reqShield === !0 || (o.reqItems ?? []).some(i => i.itemType === dY.shield)
   * Eskiden yalniz `reqShield` bayragina bakiliyordu. data/skills.json olcumu:
   * fark eden 8 kayit var, HEPSI `passive` (sword_passive_a_*) - yani oyun ici
   * gorunur etki YOK, degisiklik salt PARITE icin.
   */
  const kalkanGerek = (skill) =>
    skill.reqShield === true ||
    (skill.reqItems ?? []).some((i) => i && i.itemType === TIP_KALKAN);
  /** Paket w1(): kalkan takili ve saglam mi. */
  function kalkanVar(ch) {
    const v = ch?.equip?.shield;
    if (!v) return false;
    const def = esyaDef(esyaId(v));
    if (def?.type !== 'shield') return false;
    const dur = typeof v === 'string' ? 1 : (v.dur ?? 1);
    return dur > 0;
  }

  const konum = (h) => (h?.ws ? h.ws.char : h);
  function uzaklik2(a, b) {
    const p = konum(a), r = konum(b);
    const dx = (p.x ?? 0) - (r.x ?? 0), dz = (p.z ?? 0) - (r.z ?? 0);
    return dx * dx + dz * dz;
  }

  /** Kendi varligini temsil eden hafif sarmalayici. */
  const benlik = (ws) => ({ id: ws.entityId, kind: 'player', ws });

  /** Bolgedeki baska bir oyuncunun soketi (ally hedefleri icin). */
  function oyuncuBul(zoneId, entityId) {
    const kume = world.bolgeOyunculari?.(zoneId);
    if (!kume) return null;
    for (const c of kume) if (c.entityId === entityId && canli(c)) return c;
    return null;
  }

  /**
   * Paket O1()/r_t() + targetFlags.
   * Doner: {hedef} veya {code, key}
   */
  function hedefCoz(ws, skill, d) {
    const tf = skill.targetFlags ?? {};
    const tid = d.targetId != null ? Number(d.targetId) : undefined;

    if (skill.target === 'self') return { hedef: benlik(ws) };

    if (tid === undefined) {
      // r_t/O1: hedef zorunlu degilse ally/self becerileri kendine uygulanir
      if (tf.required) return { code: 'ERR_VALIDATION' };
      if (skill.target === 'ally') return { hedef: benlik(ws) };
      return { code: 'ERR_VALIDATION' };
    }

    if (skill.target === 'enemy') {
      if (tid === ws.entityId) return { code: 'ERR_VALIDATION' };   // paket r_t()
      const e = world.varlik(ws.zoneId, tid);
      if (!e || e.kind !== 'monster' || e.dead) return { code: 'ERR_NOT_FOUND' };
      return { hedef: e };
    }
    if (skill.target === 'corpse') {
      const e = world.varlik(ws.zoneId, tid);
      if (!e || !e.dead) return { code: 'ERR_NOT_FOUND' };
      return { hedef: e };
    }
    if (skill.target === 'ally') {
      if (tid === ws.entityId) return { hedef: benlik(ws) };
      const p = oyuncuBul(ws.zoneId, tid);
      /* `err.skill.needs_ally` -> Eht enum'unda VAR ve tr.json'da VAR.
         (tr.json'da ayrica `err.skill.needs_ally_target` de var ama o anahtar
         Eht enum'unda YOK; sema disi anahtar gonderilmez.) */
      if (!p || p.char?.dead) return { code: 'ERR_NOT_FOUND', key: 'err.skill.needs_ally' };
      return { hedef: benlik(p) };
    }
    return { code: 'ERR_VALIDATION' };
  }

  // =========================================================== MADDE 19: MODLAR
  /**
   * BUFF / DANS / PASIF MOD MOTORU.
   *
   * NEDEN: `grep mods *.js` -> SIFIR eslesme idi. 735 becerinin `buff.mods`
   * blogu (sema Sat @8659700), 531 pasifin `passive.mods` blogu (sema wat
   * @8662700 - wat'in mods'u Sat'in ALT KUMESI + critRatingFlat/critDownRating)
   * ve 40 dansin `dance.mods` blogu (Sat) hicbir yerde OKUNMUYORDU. Yani
   * "Fiziksel savunma +121" yazan buff yalnizca bir ikondu, ustalik agacindaki
   * pasifi ogrenmek hicbir sey yapmiyordu.
   *
   * buffs.update(142) semasi (b$ @25593759) `mods` TASIMAZ - istemci hesabi
   * yapmaz. Bu yuzden HESABI SUNUCU yapar ve sonucu stats.update(146) ile
   * gonderir (sema: base{str,int,unspent} + derived + hp + mp).
   *
   * UYGULAMA SIRASI: once DUZ, sonra ORAN (plan md.19). STR/INT duz eklemeleri
   * turetilmis()'e GIRDI oldugu icin ayri ele alinir: karakterin kopyasi
   * str/int artirilmis halde turetilmis()'e verilir - boylece HP/MP, denge
   * yuzdesi ve ciplak saldiri/savunma zinciri kendiliginden dogru cikar.
   */
  function modTopla(ws) {
    const t = {
      duz: {}, oran: {}, belirsiz: {},
      /* Yalniz TANI icin: hangi kaynak kac mod verdi. */
      sayac: { buff: 0, dans: 0, pasif: 0 },
    };
    const ekle = (mods, nereden) => {
      if (!mods) return;
      let n = 0;
      for (const [k, hamV] of Object.entries(mods)) {
        const v = Number(hamV);
        if (!Number.isFinite(v) || v === 0) continue;
        n++;
        if (MOD_BELIRSIZ.has(k)) t.belirsiz[k] = (t.belirsiz[k] ?? 0) + v;
        else if (MOD_DUZ.has(k)) t.duz[k] = (t.duz[k] ?? 0) + v;
        else if (MOD_KESIR.has(k)) t.oran[k] = (t.oran[k] ?? 0) + v;
        /* Bilinmeyen alan: sema disi. Sessizce yutulmaz, belirsize yazilir. */
        else t.belirsiz[k] = (t.belirsiz[k] ?? 0) + v;
      }
      if (n) t.sayac[nereden] += n;
    };

    /* 1) AKTIF BUFF'LAR + DANSLAR (ws.bec.buff tablosu ikisini de tutar). */
    const s = ws?.bec;
    if (s?.buff?.size) {
      for (const b of s.buff.values()) {
        ekle(b.skill?.buff?.mods, 'buff');
        ekle(b.skill?.dance?.mods, 'dans');
        /* MADDE 39 - `buff.shieldTrade {defReducePct, atkGainPct}` (19 beceri,
           sema @8661200). Iki alan da ADLANDIRILMIS ve TAMSAYI YUZDE
           (17/27, 19/31, 22/35): savunmadan feragat edip saldiri kazanma.
           mods dilinde yuzdeler KESIR oldugu icin /100 ile cevrilir.
           SEMA OKULU SOYLEMIYOR ("def"/"atk", phys/mag ayrimi yok) - en duz
           okuma uygulandi: HER IKI okul. Okul ayrimi bir olcumle netlesirse
           degisecek TEK yer burasi. */
        const st = b.skill?.buff?.shieldTrade;
        if (st) {
          ekle({
            physDefPct: -(st.defReducePct ?? 0) / 100,
            magDefPct: -(st.defReducePct ?? 0) / 100,
            physAtkPct: (st.atkGainPct ?? 0) / 100,
            magAtkPct: (st.atkGainPct ?? 0) / 100,
          }, 'buff');
        }
      }
    }

    /* 2) OGRENILEN PASIFLER. beceriCoz/pasifDegiskenler ile AYNI kural:
          her pasif GRUPTA bilinen EN YUKSEK seviyeli kayit gecerlidir
          (paket v1() @25689971). */
    const ch = ws?.char;
    const bilinen = new Set(ch?.knownSkills ?? []);
    if (bilinen.size) {
      for (const liste of GRUP.values()) {
        if (liste[0]?.kind !== 'passive') continue;
        for (let i = liste.length - 1; i >= 0; i--) {
          if (!bilinen.has(liste[i].id)) continue;
          /* passive.requiresShield: kalkan yoksa pasif mod GECMEZ
             (sema wat @8663300 `requiresShield: RJ().optional()`, 8 kayit). */
          if (liste[i].passive?.requiresShield && !kalkanVar(ch)) break;
          ekle(liste[i].passive?.mods, 'pasif');
          break;
        }
      }
    }
    return t;
  }

  /** Mod tablosunu onbellekler: buff seti / bilinen beceri sayisi degisince tazelenir. */
  function modlar(ws) {
    const s = durum(ws);
    const imza = `${s.buff.size}|${s.modSurum ?? 0}|${(ws.char?.knownSkills ?? []).length}`
      + `|${ws.char?.equip?.shield ? 1 : 0}`;
    if (s._modImza !== imza) { s._modImza = imza; s._modlar = modTopla(ws); }
    return s._modlar;
  }

  /** ws'yi karakterden bul (derived kancasi yalniz ch aliyor). */
  function wsOf(ch) {
    if (!ch) return null;
    for (const w of oyuncular) if (w?.char === ch) return w;
    return null;
  }

  /**
   * MOD'LU TURETILMIS STATLAR. combat.turetilmis()'in ciktisini bozmaz, uzerine
   * yazar; combat.js'e DOKUNULMAZ (o dosya G3'un).
   */
  function derivedMod(ch, ws = null) {
    const w = ws ?? wsOf(ch);
    if (!w) return derived(ch);
    const m = modlar(w);
    const duz = m.duz, oran = m.oran;
    if (!Object.keys(duz).length && !Object.keys(oran).length) return derived(ch);

    /* STR/INT: turetilmis()'in GIRDISI oldugu icin once karaktere eklenir. */
    const chArt = (duz.strFlat || duz.intFlat)
      ? { ...ch, str: (ch.str ?? 0) + (duz.strFlat ?? 0), int: (ch.int ?? 0) + (duz.intFlat ?? 0) }
      : ch;
    const d = { ...derived(chArt) };

    // --- once DUZ ---
    if (duz.maxHpFlat) d.maxHp += duz.maxHpFlat;
    if (duz.maxMpFlat) d.maxMp += duz.maxMpFlat;
    if (duz.physAtkFlat) { d.physAtkMin += duz.physAtkFlat; d.physAtkMax += duz.physAtkFlat; }
    if (duz.magAtkFlat) { d.magAtkMin += duz.magAtkFlat; d.magAtkMax += duz.magAtkFlat; }
    if (duz.physDefFlat) d.physDef += duz.physDefFlat;
    if (duz.magDefFlat) d.magDef += duz.magDefFlat;
    if (duz.blockRatioFlat) d.blockRatio += duz.blockRatioFlat;
    if (duz.hitRatioFlat) d.hitRatio += duz.hitRatioFlat;
    if (duz.parryRatioFlat) d.parryRatio += duz.parryRatioFlat;
    if (duz.critRatingFlat) d.critRating += duz.critRatingFlat;

    // --- sonra ORAN (kesir: 0.75 = %75) ---
    if (oran.maxHpPct) d.maxHp *= 1 + oran.maxHpPct;
    if (oran.maxMpPct) d.maxMp *= 1 + oran.maxMpPct;
    if (oran.physAtkPct) { d.physAtkMin *= 1 + oran.physAtkPct; d.physAtkMax *= 1 + oran.physAtkPct; }
    if (oran.magAtkPct) { d.magAtkMin *= 1 + oran.magAtkPct; d.magAtkMax *= 1 + oran.magAtkPct; }
    if (oran.physDefPct) d.physDef *= 1 + oran.physDefPct;
    if (oran.magDefPct) d.magDef *= 1 + oran.magDefPct;

    /* mpCostPct POZITIFTE INDIRIMDIR (T2() ekside cizer). turetilmis()'te
       `mpDiscountPct: 0` SABIT yaziliydi (combat.js) - mpMaliyeti() zaten bu
       alani okuyor, artik gercek deger gorur. */
    if (oran.mpCostPct) {
      d.mpDiscountPct = Math.min(100, (d.mpDiscountPct ?? 0) + oran.mpCostPct * 100);
    }
    /* Duzeltilmis tavanlarin ALTINA dusen HP/MP olmamali (tamsayi kare). */
    d.maxHp = Math.max(1, Math.floor(d.maxHp));
    d.maxMp = Math.max(0, Math.floor(d.maxMp));
    for (const k of ['physDef', 'magDef', 'blockRatio', 'hitRatio', 'parryRatio', 'critRating']) {
      d[k] = Math.max(0, d[k]);
    }
    return d;
  }

  /** Modlarin kendisi (dis moduller icin: mpShield/heal gucu/hiz/menzil). */
  const modOran = (ws, ad) => Number(modlar(ws)?.oran?.[ad] ?? 0) || 0;
  const modDuz = (ws, ad) => Number(modlar(ws)?.duz?.[ad] ?? 0) || 0;

  /**
   * MADDE 19 - stats.update(146). Mod seti degisince C ekrani ve tooltipler
   * gercek degeri gormeli; sistem_stat-ustalik.js:170 ile AYNI kare bicimi.
   */
  function statYayinla(ws) {
    const ch = ws?.char;
    if (!ch) return;
    const d = derivedMod(ch, ws);
    /* Tavan dustuyse (orn. maxHpPct -0.5 tasiyan Zombie buff'i) mevcut degeri
       kirp - aksi halde hp > maxHp kalir ve istemci can cubugunu tasirir. */
    if (Number.isFinite(ch.hp)) ch.hp = Math.min(ch.hp, d.maxHp);
    if (Number.isFinite(ch.mp)) ch.mp = Math.min(ch.mp, d.maxMp);
    frame(ws, 'stats.update', {
      base: { str: ch.str | 0, int: ch.int | 0, unspent: ch.statPoints | 0 },
      derived: d,
      hp: Math.max(0, Math.round(ch.hp ?? 0)), mp: Math.max(0, Math.round(ch.mp ?? 0)),
    });
  }

  /**
   * Mod seti degisti: onbellegi bozup stats.update yolla ve gerekiyorsa
   * hareket hizini tazele. sistem_binek-pet.js:482 hizi ZATEN bizden soruyor
   * (`sistemOrnegi('beceri')?.hizCarpani?.(ws)`), ama istemcinin selfSpeed'i
   * yalniz entity.move ile guncelleniyor - o yuzden BINEK.hizTazele cagrilir
   * (sistem_binek-pet.js:499, kendi BAGLAMA NOTU bunu istiyor).
   */
  function modTazele(ws, hizDegisti = false) {
    const s = durum(ws);
    s.modSurum = (s.modSurum ?? 0) + 1;
    s._modImza = null;
    statYayinla(ws);
    if (hizDegisti) {
      try { ctx.sistemOrnegi?.('binek-pet')?.hizTazele?.(ws); } catch { /* modul yok */ }
    }
  }

  // ------------------------------------------------------------------ hasar
  /* combat.js'in ozel (#) yardimcilari disaridan cagrilamiyor; ayni formuller
     AYNI sabitlerle (combat.cfg = combat.json) burada yeniden yazildi. */
  function rulo(hitRatio, parryRatio) {
    const s = combat.cfg.rollShape.softness;
    return Math.pow(Math.random(), (s + parryRatio) / (s + hitRatio));
  }
  function seviyeCarpani(L, anchors) {
    if (!anchors?.length) return 1;
    if (L <= anchors[0][0]) return anchors[0][1];
    const son = anchors[anchors.length - 1];
    if (L >= son[0]) return son[1];
    for (let i = 1; i < anchors.length; i++) {
      const [x0, y0] = anchors[i - 1], [x1, y1] = anchors[i];
      if (L <= x1) return y0 + ((y1 - y0) * (L - x0)) / (x1 - x0);
    }
    return son[1];
  }
  function seviyeFarkiCarpani(sLv, hLv) {
    const g = combat.cfg.levelGap;
    return 1 + Math.min(g.cap, Math.max(g.floor, g.slope * (sLv - hLv)));
  }

  /** Becerinin okulu: katsayi/duz hasar hangi tarafta yaziliysa o. (3256/3256 tek tarafli) */
  const buyuselMi = (s) => (s.magCoeff > 0 || s.magFlatMax > 0);

  /**
   * Tek vurusun hasari. `hit` = hitPlan girdisi ya da null (o zaman ust duzey
   * katsayilar). `ikincil` = AoE'de birincil olmayan hedef.
   */
  function hasarHesapla(ch, hedef, skill, hit, ikincil, sec = {}) {
    const c = combat.cfg;
    const d = sec.d ?? derivedMod(ch);
    const sLv = ch.level ?? 1, hLv = hedef.level ?? 1;
    const mag = buyuselMi(skill);

    /* (md.8 / capraz istek 9) BLOK ZARI HEDEFIN kalkaniyla atilir.
       Eskiden burada `d.blockRatio` (SALDIRANIN kalkani) okunuyordu: kalkanli
       oyuncu canavara vururken KENDI kalkani yuzunden 0 hasar veriyordu.
       combat.blokAtildi() capPct'i de iceriyor (block.capPct = 60). */
    if (combat.blokAtildi(hedef)) return { hasar: 0, kritik: false, blok: true };

    /* (md.30) rollShape ustelinde hedefin KACINMA (ER) sutunu. mobs.json'da
       `par` mobun SEVIYESIDIR, `er` ayri sutundur - combat.kacinmaOrani ikisini
       de dogru cozer ve PvP'de parryRatio'ya duser. */
    const t = rulo(d.hitRatio, combat.kacinmaOrani(hedef, hLv));

    /* MADDE 61: beceriye ozel kritik puani. `critRating` (sema @8667100,
       42 beceride var) turetilmis critRating'in USTUNE eklenir - beceri
       kaydinin baska hicbir tuketicisi yok. */
    const kritikPuan = (d.critRating ?? 0) + (Number(skill.critRating ?? 0) || 0);
    const kritikSans = Math.min(c.crit.capPct, kritikPuan * c.crit.pctPerRating) / 100;
    const kritik = kritikSans > 0 && Math.random() < kritikSans;

    /* (md.32/35 / capraz istek 9) TUM matematik combat.hasarCekirdegi()'nde.
       Yerel rulo/seviyeCarpani/seviyeFarkiCarpani kopyalari duruyor ama
       hasarin kendisi tek cekirdekten geciyor; kritik carpani da yalniz
       FIZIKSEL bilesene uygulaniyor (crit $comment). */
    let hasar = combat.hasarCekirdegi({
      alt: mag ? d.magAtkMin : d.physAtkMin,
      ust: mag ? d.magAtkMax : d.physAtkMax,
      t,
      katsayiPct: ((hit?.coeff ?? (mag ? skill.magCoeff : skill.physCoeff) ?? 0)) * 100,
      flatMin: hit?.flatMin ?? (mag ? skill.magFlatMin : skill.physFlatMin) ?? 0,
      flatMax: hit?.flatMax ?? (mag ? skill.magFlatMax : skill.physFlatMax) ?? 0,
      /* ! BUGUNKU beceri sirasi korunuyor (katsayi savunmadan ONCE). Taban
         saldiri yolu true kullaniyor; hangisinin dogru oldugu OLCULMEDI
         (plan md.32) - karar tek satirda degisir. */
      katsayiSavunmaSonrasi: false,
      ustalikPct: skill.usesMaatMastery
        ? ustalikSeviyesi(ch, skill.mastery) * (c.mastery?.maatPctPerLevel ?? 1) : 0,
      dengePct: mag ? d.magBalancePct : d.physBalancePct,
      tabanCarpani: seviyeCarpani(sLv, mag ? (c.mult.magAnchors ?? c.mult.physAnchors) : c.mult.physAnchors),
      savunma: mag ? (hedef.def?.magDef ?? hedef.derived?.magDef ?? hLv * 2)
                   : (hedef.def?.physDef ?? hedef.derived?.physDef ?? hLv * 2),
      seviyeFarki: seviyeFarkiCarpani(sLv, hLv),
      kritik, buyusel: mag,
      olcekPct: combat.hasarOlcegi('player', hedef?.def ? 'monster' : 'player'),
    });

    /* MADDE 18 - `downAttack` (yerdeki hedefe vurus). Sema @8667000
       `downAttack: { pct: Y().int().positive(), requiresDowned: RJ().optional() }`,
       168 beceride var (26'si zorunlu). pct 125 = %125 hasar. Kapi (requiresDowned)
       castIstek'te; buradaki yalniz CARPANDIR. */
    if (sec.serili && (skill.downAttack?.pct ?? 0) > 0) {
      hasar = Math.max(c.minDamage, Math.floor(hasar * skill.downAttack.pct / 100));
    }

    /* AoE ikincil hedefleri: aoe.falloffPct kadar dusurulur. Yuzdenin ANLAMI
       pakette yazili degil (efr arg4Raw -> falloffPct olarak cikarilmis); en dogal
       okuma olan "yuzde kadar azalma" uygulaniyor, ham deger degistirilmedi. */
    if (ikincil) {
      const f = skill.aoe?.falloffPct ?? skill.aoeLine?.falloffPct ?? 0;
      if (f > 0) hasar = Math.max(c.minDamage, Math.floor(hasar * Math.max(0, 1 - f / 100)));
    }

    return { hasar: Math.max(c.minDamage, Math.floor(hasar)), kritik, blok: false };
  }

  /**
   * MADDE 20 - IMBUE (buyu kilici) RIDERI.
   * 112 imbue becerisinin 105'inde `buff.onHit {magCoeff, magFlat, magFlatMin,
   * magFlatMax}` var (sema @8661641). Istemci hasar yazisini
   * `dmg + (imbueDmg ?? 0)` olarak ciziyor ve imbueDmg > 0 ise ozel renk
   * kullaniyor (@27018044 ve @27021640, bayt dokumu ile dogrulandi). Ana `dmg`
   * DEGISMEZ - iki bilesen ayri gonderilir, istemci toplar.
   *
   * KRITIK CARPANI UYGULANMAZ (crit $comment: "physMult 2 on the PHYS component
   * only") ve imbue BUYUSEL bilesendir.
   *
   * PARITE DOGRULAMASI (changelog 0025 / parite plani md.2, 2026-09-03):
   * imbue ek hasari YALNIZ imbue'nun kendi katsayisi (onHit.magCoeff)
   * uzerinden BIR KEZ hesaplanir; ana `dmg`e katilmaz, ikinci bir carpim
   * yoktur ("hem tam ekle hem bir daha carp" kusuru bu kodda yok). Cift
   * sayimin dolayli yolu da kapali: 112 imbue kaydinin HICBIRI buff.mods'ta
   * atk alani tasimiyor (olculdu), yani becerinin kendi hasari (derivedMod)
   * imbue'dan pay almaz. Oto-saldiri yolu (gameloop imbueOnHit) da ayni tek
   * rider'i kullanir. DEGISIKLIK GEREKMEDI.
   *
   * CHANGELOG 0026 / BR-0209 (2026-09-03) - imbue.riderBonusPct.
   * data/combat.json imbue $comment (paket combat-config d640b73 ile birebir):
   * "riderBonusPct adds that many percent of the rider's result ON TOP of the
   * native term on every imbued hit"; canli deger 50, sema varsayilani 0 =
   * orijinal oyun. 0026 TR metni: imbue'nun her vurusta ekledigi hasar
   * "orijinal oyundaki payin bir bucuk katina" cikar. Bu sunucuda rider ZATEN
   * tek kez, imbue'nun kendi katsayisiyla hesaplaniyor (yukaridaki tek-carpim
   * kurali) ve vuran becerinin besinci att operandi (pct2 payi) modellenmiyor;
   * dolayisiyla native terim = asagidaki hasarCekirdegi sonucu ve %50 bonus =
   * ayni sonucun ustune floor(dmg*50/100) eklemek (= x1.5, TR metnin dedigi).
   * Tek-carpim kurali KORUNUR: rider yine BIR KEZ hesaplanir, ana `dmg`e
   * katilmaz, bonus ikinci bir katsayi carpimi degil ayni sonucun yuzdesidir.
   * combat.json okunamazsa cfg.imbue yoktur -> bonus 0 = eski davranis.
   * Doner: {dmg, groupId} | null
   */
  function imbueVurusu(ws, hedef) {
    const s = ws?.bec;
    if (!s?.buff?.size) return null;
    let secili = null;
    for (const b of s.buff.values()) {
      const oh = b.skill?.buff?.onHit;
      if (!oh) continue;
      secili = { oh, groupId: b.skill.groupId };   // ayni anda tek imbue (md.53)
    }
    if (!secili) return null;
    const ch = ws.char;
    const d = derivedMod(ch, ws);
    const hLv = hedef.level ?? 1, sLv = ch.level ?? 1;
    const c = combat.cfg;
    const t = rulo(d.hitRatio, combat.kacinmaOrani(hedef, hLv));
    const dmg = combat.hasarCekirdegi({
      alt: d.magAtkMin, ust: d.magAtkMax, t,
      katsayiPct: (Number(secili.oh.magCoeff) || 0) * 100,
      flatMin: Number(secili.oh.magFlatMin ?? secili.oh.magFlat ?? 0) || 0,
      flatMax: Number(secili.oh.magFlatMax ?? secili.oh.magFlat ?? 0) || 0,
      katsayiSavunmaSonrasi: false,
      dengePct: d.magBalancePct,
      tabanCarpani: seviyeCarpani(sLv, c.mult.magAnchors ?? c.mult.physAnchors),
      savunma: hedef.def?.magDef ?? hedef.derived?.magDef ?? hLv * 2,
      seviyeFarki: seviyeFarkiCarpani(sLv, hLv),
      kritik: false, buyusel: true,
      olcekPct: combat.hasarOlcegi('player', hedef?.def ? 'monster' : 'player'),
    });
    /* changelog 0026 / BR-0209: rider sonucunun riderBonusPct'si kadar ek,
       her imbue'lu vurusta native terimin ustune (50 => x1.5). */
    const bonusPct = Number(c.imbue?.riderBonusPct ?? 0) || 0;
    const dmgSon = bonusPct > 0 ? dmg + Math.floor((dmg * bonusPct) / 100) : dmg;
    return dmgSon > 0 ? { dmg: dmgSon, groupId: secili.groupId } : null;
  }

  function ustalikSeviyesi(ch, masteryId) {
    if (!masteryId) return 0;
    for (const m of ch.masteries ?? []) {
      if ((m.id ?? m.masteryId) === masteryId) return Number(m.level ?? 0) || 0;
    }
    return 0;
  }

  // ------------------------------------------------------------ vurus plani
  /**
   * Asama -> hitPlan dilimi. stagePlan[n].resultCount kadar sonuc, sirayla
   * tuketilir (paket sgt(): asamalar releaseOffsetMs'de ISTEMCI tarafindan
   * istenir, bu yuzden sunucu ileri asamalari kendiliginden atmaz).
   */
  function asamaVuruslari(skill, asama) {
    const plan = skill.hitPlan ?? null;
    const sp = skill.stagePlan ?? null;
    if (!plan?.length) {
      if (asama > 0) return [];
      if ((skill.hits ?? 0) < 1) return [];
      return [{ idx: 0, hit: null, offsetMs: 0 }];
    }
    if (!sp || sp.length <= 1) {
      // tek asama: butun vuruslar kendi offsetlerinde
      return asama > 0 ? [] : plan.map((h, i) => ({ idx: i, hit: h, offsetMs: h.offsetMs ?? 0 }));
    }
    let bas = 0;
    for (let i = 0; i < asama; i++) bas += Math.max(1, sp[i]?.resultCount ?? 1);
    const adet = Math.max(1, sp[asama]?.resultCount ?? 1);
    const dilim = plan.slice(bas, bas + adet);
    const t0 = plan[bas]?.offsetMs ?? 0;
    return dilim.map((h, i) => ({ idx: bas + i, hit: h, offsetMs: Math.max(0, (h.offsetMs ?? 0) - t0) }));
  }
  const asamaSayisi = (skill) => (skill.stagePlan?.length ?? 1);

  /**
   * Paket oOt(): ucus suresi = mesafe / hiz, 1500 ms ile sinirli.
   *
   * S1 md.1 (KRITIK) - flightMs PARITESI: flySpeedU=0 ama fx'inde SHOT /
   * S_RETURN fazli AT_MOV* mermisi olan 37 grup / 320 beceride (Wizard'in
   * 5 ana nuke'u dahil) sunucu flightMs gondermiyor ve hasari mermi gorsel
   * olarak varmadan ~375-600ms ONCE isliyordu (olcum: GERCEK/denetim/
   * olcum_bolt.mjs - Ice Bolt 20U'da combat.event fire+0, gorsel varis
   * fire+533ms). Paket oOt govdesi (@26699833, index-BUMMQVRB.js):
   *   hiz = (projectileSpeed || movement.p2 || 400) * p6   (p6 = .15 @26698925)
   *   sure = min(1500, dist / hiz * 1000)
   * flySpeedU>0 yolu AYNEN korunur (60 == 400*0.15, formul veriyle
   * dogrulandi - curut_flight_sayim.mjs 36/36 grup ayni formulu tutuyor).
   */
  function ucusMs(ch, hedef, skill) {
    let hiz = skill.flySpeedU ?? 0;
    if (hiz <= 0) {
      const fx = FXGRUP.get(skill.groupId);
      const mov = fx?.effects?.find((e) =>
        (e.phase === 'SHOT' || e.phase === 'S_RETURN')
        && String(e.actType || '').startsWith('AT_MOV'));
      if (mov) hiz = (fx.projectileSpeed || mov.movement?.p2 || 400) * 0.15; /* p6 */
    }
    if (hiz <= 0 || !hedef) return 0;
    const p = konum(hedef);
    const dist = Math.hypot((p.x ?? 0) - (ch.x ?? 0), (p.z ?? 0) - (ch.z ?? 0));
    return Math.min(1500, Math.round((dist / Math.max(1, hiz)) * 1000));
  }

  /**
   * EVE DONUS DOKUNULMAZLIGI - bu dosyanin TEK kapisi.
   *
   * gameloop.js #eveDonusBaslat sozlesmesi (md. 7a): "Donus boyunca: agro
   * almaz, saldirmaz, HASAR ALMAZ." Bayragi gameloop yaziyor (mob.donuyor),
   * varlik nesnesi ayni oldugu icin buradan dogrudan okunur.
   *
   * gameloop kendi iki yolunu (#saldiriBasla / #hasarUygula) zaten kapatti;
   * bu dosyanin mob HP'sini DOGRUDAN dusuren yollari kapisizdi. Uc sonucu
   * vardi ve ucu de #eveDonusTik'in HP geri-yazmasina RAGMEN gorunurdu:
   *   (a) hasar karesi (combat.event) once gidiyor -> istemci bir kare hasar
   *       sayisi/animasyonu ciziyor, hemen ardindan HP geri yaziliyor: titreme;
   *   (b) yollar `hedefEntityId`yi de set ediyor -> donus bitiminde
   *       (#eveVardi ile donuyor=false olunca) mob DISARIDAN yazilmis bir
   *       hedefle uyaniyor, yani "agro almaz" bozuluyor;
   *   (c) tek bir tik o anki donusHp'den fazla hasar verirse `olum()`
   *       calisiyor - "dokunulmaz" donen mob oluyor.
   * Bu yuzden kapi HER ZAMAN kare yayinindan ONCE cagrilir.
   */
  function donusteMi(e) {
    return !!e?.donuyor;
  }

  /**
   * Bolgedeki HEDEFLENEBILIR canavarlari dolasan yardimci (tek yer).
   * Eve donen mob ELENIR (bkz. donusteMi): bu ureteci kullanan bes yolun
   * hepsi dusmanca secim yapiyor - AoE ikincilleri, aoeLine seridi,
   * merkezHedefleri, alan taunt'u ve hasar aurasi.
   */
  function* canavarlar(zoneId) {
    const z = world.zoneState?.get?.(zoneId);
    if (!z) return;
    for (const e of z.entities.values()) {
      if (e.kind === 'monster' && !e.dead && !donusteMi(e)) yield e;
    }
  }

  /**
   * AoE: birincil hedef + yaricap icindeki diger canavarlar (maxTargets kadar).
   *
   * MADDE 63 - `aoeLine` (142 beceri) ARTIK OKUNUYOR. Sema @8666000:
   *   aoeLine: { widthU, maxTargets, shapeRaw, falloffPct? }
   * `shapeRaw`in anlami HALA COZULMEDI ve uydurulmadi; bu yuzden serit
   * yalnizca "oyuncudan birincil hedefe dogru, GENISLIGI widthU, UZUNLUGU
   * menzil (rangeU)" olan dikdortgen olarak kuruluyor - plan md.63'un izin
   * verdigi ilerleme. Uzunluk icin ayri bir sayi UYDURULMADI.
   */
  function aoeHedefleri(ws, skill, birincil) {
    if (birincil.kind !== 'monster') return [birincil];
    const a = skill.aoe;
    if (a && a.radiusU > 0) {
      const enFazla = Math.max(1, a.maxTargets ?? 1);
      const out = [birincil];
      if (enFazla <= 1) return out;
      const r2 = a.radiusU * a.radiusU;
      for (const e of canavarlar(ws.zoneId)) {
        if (out.length >= enFazla) break;
        if (e === birincil) continue;
        const dx = e.x - birincil.x, dz = e.z - birincil.z;
        if (dx * dx + dz * dz <= r2) out.push(e);
      }
      return out;
    }
    const l = skill.aoeLine;
    if (l && l.widthU > 0) return seritHedefleri(ws, skill, birincil);
    return [birincil];
  }

  /** MADDE 63: oyuncu -> birincil hedef dogrultusunda widthU genisliginde serit. */
  function seritHedefleri(ws, skill, birincil) {
    const l = skill.aoeLine;
    const out = [birincil];
    const enFazla = Math.max(1, l.maxTargets ?? 1);
    if (enFazla <= 1) return out;
    const ch = ws.char;
    const dx = (birincil.x ?? 0) - (ch.x ?? 0), dz = (birincil.z ?? 0) - (ch.z ?? 0);
    const uz = Math.hypot(dx, dz);
    if (!(uz > 0)) return out;
    const ux = dx / uz, uz2 = dz / uz;                 // birim yon vektoru
    const boy = Math.max(uz, menzilU(ch, skill));      // uzunluk = menzil (uydurma yok)
    const yari = l.widthU / 2;
    for (const e of canavarlar(ws.zoneId)) {
      if (out.length >= enFazla) break;
      if (e === birincil) continue;
      const ex = (e.x ?? 0) - (ch.x ?? 0), ez = (e.z ?? 0) - (ch.z ?? 0);
      const ileri = ex * ux + ez * uz2;                // izdusum (serit ekseni)
      if (ileri < 0 || ileri > boy) continue;
      const yan = Math.abs(ex * uz2 - ez * ux);        // eksene dik uzaklik
      if (yan <= yari) out.push(e);
    }
    return out;
  }

  /**
   * MADDE 15 - KENDINE HEDEFLI HASAR BECERILERI (33 aktif).
   * `target:'self'` + kind ∈ {attack,nuke,debuff} olan becerilerde atesle()
   * hedefId'yi undefined birakiyor ve asamaUygula HEMEN cikiyordu: skill.fire
   * yayinlaniyor (animasyon+efekt oynuyor) ama TEK BIR combat.event bile
   * uretilmiyordu. Merkez = OYUNCUNUN konumu.
   *
   * Yaricap sirasi (hepsi VERIDEN, hicbiri uydurma):
   *   1) aoe.radiusU        (26/37 kayitta var)
   *   2) aoeLine.widthU     (serit; kendine hedefli kayitlarda yok ama sema var)
   *   3) menzilU(ch, skill) (plan md.15: "aoe blogu yoksa rangeU kullan")
   * Kendine hedefli 37 kaydin 11'inde ne aoe ne rangeU var (hepsi
   * warrior_frenzya_tount_area_* gibi hits:0 taunt/debuff kayitlari) - onlarda
   * yaricap 0 cikar ve hedef bulunmaz, yani DAVRANIS DEGISMEZ.
   */
  function merkezHedefleri(ws, skill) {
    const ch = ws.char;
    const a = skill.aoe;
    const yaricap = (a?.radiusU > 0) ? a.radiusU
      : (skill.aoeLine?.widthU > 0 ? skill.aoeLine.widthU : menzilU(ch, skill));
    if (!(yaricap > 0)) return [];
    const enFazla = Math.max(1, a?.maxTargets ?? skill.aoeLine?.maxTargets ?? 1);
    const r2 = yaricap * yaricap;
    const out = [];
    for (const e of canavarlar(ws.zoneId)) {
      if (out.length >= enFazla) break;
      const dx = (e.x ?? 0) - (ch.x ?? 0), dz = (e.z ?? 0) - (ch.z ?? 0);
      if (dx * dx + dz * dz <= r2) out.push(e);
    }
    return out;
  }

  // ------------------------------------------------------------------- buff
  function buffPayload(s) {
    return [...s.buff.values()].map((b) => b.payload);
  }
  function buffYayinla(ws) {
    const s = durum(ws);
    yayin(ws, 'buffs.update', { id: ws.entityId, buffs: buffPayload(s) });
  }
  /**
   * MADDE 19 + 53 + 38 + 39: buff / dans kurulumu.
   *
   * MADDE 53 (KISMI) - CAKISMA SINIFI. `overlapRaw` (1935 beceri) ve
   * `buff.overlapClassRaw` (4) bit anlami COZULEMEDI, o yuzden maske
   * uygulanmadi. Uygulanan TEK ve EN DAR kural: ayni anda YALNIZ BIR imbue
   * (buff.category === 'imbue') tasinabilir - eskisi 'replaced' sebebiyle
   * dusurulur. Gerekce: Silkroad kurali + tr.json'un imbue ipucu ("Silahini
   * degistirirsen etki sona erer") + statuses/buffs kaldirma enum'undaki
   * `replaced` degerinin baska bir ureticisi yok. Danslarda `exclusivityRaw`
   * de ayni sebeple uygulanmadi.
   *
   * MADDE 39 - `absorbPool` (emici duvar) artik SAYAC: pool hasar aldikca
   * azalir (gelenHasarSuzgeci), tukenince buff duser. tr.json
   * ui.buffs.wall_title "Duvar ayaktayken hareket edemezsin" -> hareket kilidi
   * `hareketKilidi(ws)` kancasiyla disa acilir (gameloop/server tuketir).
   */
  function buffUygula(ws, hedefWs, skill, t0) {
    const b = skill.buff ?? null;
    const dns = skill.kind === 'dance' ? (skill.dance ?? null) : null;
    if (!b && !dns) return;
    const s = durum(hedefWs);

    /* md.53: yeni imbue eskisini dusurur. */
    const dusen = [];
    if (b?.category === 'imbue') {
      for (const [gid, eski] of [...s.buff]) {
        if (gid !== skill.groupId && eski.skill?.buff?.category === 'imbue') {
          s.buff.delete(gid); dusen.push(gid);
        }
      }
    }

    const payload = {
      groupId: skill.groupId,
      /* buffs.update semasi (b$ @25593759) category'yi imbue|stat|hawk ile
         SINIRLIYOR - dans icin sema disi bir deger gonderilemez, `stat`
         kullanilir. Istemcinin sarki testi t_t() (@25695700) zaten kategoriye
         degil, groupId -> skillsByGroup[0].dance.isSong yoluna bakiyor. */
      category: b?.category ?? 'stat',
      // maintained (indefinite) buff'ta istemci expiresAt'e BAKMAZ ("sonsuz" yazar)
      expiresAt: (b?.indefinite || dns) ? 0 : t0 + (b?.durationMs ?? 0),
    };
    /* Dans SURESIZDIR: pulse.mpPerTick odendigi surece calar; tr.json
       ui.buffs.maintained_title = "... kesilene ya da sen durdurana dek calar
       (durdurmak icin sag tikla)" -> buff.cancel(23) ile durdurulur. */
    if (b?.indefinite || dns) payload.maintained = true;
    if (b?.absorbPool?.hp > 0) { payload.pool = b.absorbPool.hp; payload.poolMax = b.absorbPool.hp; }
    if (hedefWs !== ws) payload.allyCast = true;

    /* Dansin upkeep'i `dance.pulse` (sema @8671800 {intervalMs, mpPerTick});
       buff'in upkeep'i `buff.upkeep`. Tik dongusu tek alan okusun diye
       kayda normalize edilir. */
    const upkeep = b?.upkeep ?? dns?.pulse ?? null;
    const havuz = b?.absorbPool?.hp > 0 ? b.absorbPool.hp : 0;
    s.buff.set(skill.groupId, {
      payload, skill, sonUpkeep: t0, upkeep,
      havuz, havuzMax: havuz,
      sonAura: t0, sonHawk: t0,
      /* KASTER KIMLIGI (gameloop.js #tehditKazandir - buff.aggroRedirect
         "Protect" dali): buffi ATAN oyuncunun entityId'si. gameloop
         `b.kaynak ?? b.casterId` okur; bu alan yazilmadigi surece redirect
         dali bilerek uyuyordu. YALNIZ kayda yazilir, buffs.update payload'ina
         EKLENMEZ (sema b$ @25593759 casterId tasimiyor - sema disi alan
         gonderilmez). Kendine atilan buffta kaynak == sahibi olur ve
         gameloop o durumu zaten atlar (Number(kasterId) === id kapisi). */
      kaynak: ws.entityId ?? null,
    });

    if (dusen.length) {
      /* Kaldirma bildirimi buffs.update'te YOK (sema yalniz tam liste tasiyor);
         yerini yeni liste aliyor. `replaced` sebebi statuses.update'e ozgudur. */
      log(`beceri: imbue degisti (${dusen.join(',')} -> ${skill.groupId})`);
    }
    buffYayinla(hedefWs);
    modTazele(hedefWs, (b?.mods?.moveSpeedPct ?? dns?.mods?.moveSpeedPct) != null);
  }

  /**
   * MADDE 38 - ALAN BUFF'I. `buff.areaU` (47 beceri) + `buff.areaCap`
   * (35 beceri, sema @8663139 `areaCap: Y().int().min(1).max(16)`) hic
   * okunmuyordu: rahip/ozan oyuncusunun grup destegi tamamen calismiyordu.
   * Hedef kumesi = PARTI UYELERI (bkz. partiSoketleri notu).
   */
  function buffAlanUygula(ws, skill, t0, zatenUygulanan = null) {
    const b = skill.buff ?? null;
    const dns = skill.kind === 'dance' ? (skill.dance ?? null) : null;
    const alan = Number(b?.areaU ?? dns?.areaU ?? 0) || 0;
    if (!(alan > 0)) return [];
    const cap = Math.max(1, Number(b?.areaCap ?? 16) || 16);
    const r2 = alan * alan;
    const out = [];
    for (const c of partiSoketleri(ws)) {
      if (out.length >= cap) break;
      if (c === zatenUygulanan || !canli(c) || c.char.dead) continue;
      if (uzaklik2(ws.char, c.char) > r2) continue;
      out.push(c);
    }
    for (const c of out) buffUygula(ws, c, skill, t0);
    return out;
  }

  /**
   * PARTI UYESI SOKETLERI.
   * sistem_parti.js (G8) bugun bir uye listesi KANCASI acmiyor; acarsa
   * (`uyeSoketleri`) o kullanilir. Bugun calisan tek yol `paylasimHesapla`:
   * XP payini hesaplarken zaten "cevrimici + ayni bolge + menzil + yasayan"
   * uye soketlerini uretiyor (sistem_parti.js:963-990) ve 0 XP ile cagrilmasi
   * hicbir yan etki yaratmaz. Parti modulu yoksa yalniz oyuncunun kendisi.
   */
  function partiSoketleri(ws) {
    const P = ctx.sistemOrnegi?.('parti');
    if (typeof P?.uyeSoketleri === 'function') {
      try { const l = P.uyeSoketleri(ws); if (Array.isArray(l) && l.length) return l; } catch { /* yoksay */ }
    }
    if (typeof P?.paylasimHesapla === 'function') {
      try {
        const l = P.paylasimHesapla(ws, 0, 0).map((x) => x.ws).filter(Boolean);
        if (l.length) return l;
      } catch { /* yoksay */ }
    }
    return [ws];
  }

  // ----------------------------------------------------------------- durumlar
  function durumAnahtar(zoneId, id) { return `${zoneId}|${id}`; }
  function durumListe(zoneId, id) {
    const k = durumAnahtar(zoneId, id);
    let l = DURUMLAR.get(k);
    if (!l) { l = []; DURUMLAR.set(k, l); }
    return l;
  }
  function durumYayinla(ws, hedefId, statuses, removed) {
    const d = { id: hedefId, statuses };
    if (removed?.length) d.removed = removed;
    yayin(ws, 'statuses.update', d);
  }

  /**
   * MADDE 16 + 17 + 50 - DURUM KURULUMU ARTIK MOTORDAN GECER.
   *
   * ESKIDEN: yalniz `chancePct` zari atiliyordu; hedefin DIRENCI, seviye farki
   * ve sureleri hesaplanan (durationSource:'computed') 174 bu/ps kaydi yok
   * sayiliyordu. Motor (durumlar.js) sirayla su uc kapiyi uygular:
   *   1) direnc     -> mob.def.combat.resists (156/158 mobda dolu,
   *                    paket @8680398 `resists: GJ(J(), Y())`, kalem listesi
   *                    @13456191)
   *   2) seviye farki -> combat.json statusLevelGap (sure VE sans soldurulur)
   *   3) sure       -> durationMs, yoksa level * (bu?750:1000) (@25921100)
   *
   * `kb` motorun YOK_SAYILAN kumesinde: h$ @25588614 ve LY @25075309'da
   * ANAHTARI YOK, yani durum degil GERI SAVURMADIR - combat.event(140) `kb`
   * alaniyla gonderilir (bkz. seriliUygula).
   */
  function durumUygula(ws, skill, hedef, t0) {
    const uyg = skill.statusApplications;
    if (!uyg?.length) return null;
    const l = durumListe(ws.zoneId, hedef.id);
    const r = durumMotoru.beceridenUygula(l, uyg, {
      direncler: hedef.def?.combat?.resists ?? null,
      hedefSeviye: hedef.def?.level ?? hedef.level ?? 0,
      kaynak: ws.entityId, skillId: skill.id, simdi: t0,
    });
    if (!r.degisti) return null;
    /* iid tekilligi: motor kendi sayacini kullaniyor; devir sayacini onun
       uzerine tasi ki yeniden kurulumda cakisma olmasin. */
    iidSayaci = Math.max(iidSayaci, r.kurulanlar.at(-1)?.kayit?.iid ?? iidSayaci);
    durumYayinla(ws, hedef.id, r.aktif);
    return r.kurulanlar.at(-1)?.code ?? null;
  }

  /* --------------------------------------------------- MADDE 18: ko / kb / stun */
  /**
   * YERE SERME (ko) ve GERI SAVURMA (kb).
   *
   * combat.event(140) semasi `ko`/`kb`/`stun` alanlarini SURE (ms) olarak
   * tasiyor - istemci Mjt() @27110113'te
   *   `let v = e.ko ?? e.kb; if (dst === selfId && v) noteSelfDowned(v, e.ko?'ko':'kb')`
   * ve noteSelfDowned(arg_e) @25659021 `selfDownedUntil = performance.now()+arg_e`.
   * Ayrica `e.ko` varsa playKnockdown(e.ko) oynatiliyor (@27021640).
   * E1() @25691996 ILK satiri: selfCcLocked -> selfDowned ise cast HIC
   * gonderilmiyor (err.busy.downed / err.busy.knockedback).
   *
   * SURE KAYNAKLARI (uydurma yok):
   *   oyuncu  -> combat.json knockdown.downMs = 2500
   *   canavar -> mobs.json combat.koRecoverMs (158/158 mobda var: 3000 ya da 0)
   * `koLevel` <-> `koClass` iliskisi ve `kb`nin KENDI suresi paketten
   * cozulemedi; bu yuzden geri savurma da AYNI sureyi kullanir ve MESAFE
   * itmesi UYGULANMAZ (itme miktari hicbir kaynakta yok).
   *
   * `stun` alani GONDERILMEZ: 27 MB'lik istemcide `stun:` TEK KEZ geciyor
   * (@25620362 = semanin kendisi), yani hicbir tuketicisi yok. Sersemleme
   * zaten `st` durum kodu ile calisir.
   */
  const SERILI = devir?.SERILI ?? new Map();   // `${zoneId}|${entityId}` -> serilmeBitisMs

  function serilmeSuresi(hedef) {
    if (hedef?.def) {
      const v = Number(hedef.def.combat?.koRecoverMs);
      return Number.isFinite(v) && v > 0 ? v : 0;
    }
    return Number(combat.cfg.knockdown?.downMs ?? 0) || 0;
  }
  function serili(zoneId, id, t = simdi()) {
    return (SERILI.get(durumAnahtar(zoneId, id)) ?? 0) > t;
  }
  function seriliKur(zoneId, id, sureMs, t = simdi()) {
    if (!(sureMs > 0)) return 0;
    SERILI.set(durumAnahtar(zoneId, id), t + sureMs);
    return sureMs;
  }
  /** Beceri `knockdown` blogunu dener; doner: {ko} | {kb} | null */
  function seriliUygula(ws, skill, hedef, t0) {
    const kd = skill.knockdown;
    if (!kd || !(kd.chancePct > 0)) return null;
    if (Math.random() * 100 >= kd.chancePct) return null;
    const sure = serilmeSuresi(hedef);
    if (!(sure > 0)) return null;
    seriliKur(ws.zoneId, hedef.id, sure, t0);
    return { ko: sure };
  }
  /** `kb` statusApplications kaydi tasiyan beceriler icin (117 kayit). */
  function savurmaUygula(ws, skill, hedef, t0) {
    if (!(skill.statusApplications ?? []).some((a) => a?.code === 'kb')) return null;
    const kayit = skill.statusApplications.find((a) => a.code === 'kb');
    if (Math.random() * 100 >= (kayit.chancePct ?? 0)) return null;
    const sure = serilmeSuresi(hedef);
    if (!(sure > 0)) return null;
    seriliKur(ws.zoneId, hedef.id, sure, t0);
    return { kb: sure };
  }

  /**
   * `kb` NEDEN DURUM LISTESINE YAZILMIYOR (motorun YOK_SAYILAN kumesi):
   *   - h$ @25588614 (davranis bayraklari): `kb` ANAHTARI YOK -> istemcide
   *     hicbir kilit/yavaslama kurmaz.
   *   - LY @25075309 (ikon/ad/nativeType/bit tablosu): `kb` ANAHTARI YOK ->
   *     durum cubugu WPt() @27324430'da rozeti BECERININ adi/ikonuyla cizerdi
   *     ve ipucu @25921100 adi "status.terd.name" (Kacinma Dususu) basardi.
   * data/skills.json'daki 117 kb kaydinin TAMAMI durationSource:"assumed" -
   * yani suresi de uydurma. Dogru karsiligi combat.event(140) `kb` alanidir ve
   * savurmaUygula() onu koRecoverMs / knockdown.downMs ile gonderir.
   */

  // -------------------------------------------------------------------- olum
  /**
   * Canavar oldu. gameloop.js #olum ile ayni sirayla: olum kaydi -> combat.death
   * -> odul (progress.gainFx / progress.update / sys.notice / levelUp +
   * fx.levelUp) -> ganimet. Baglayan taraf isterse ctx.olum ile kendi
   * isleyicisini verebilir (o zaman gameloop ile tek kod yolu kullanilir).
   *
   * TEK BILINCLI FARK: gameloop `ws.savas = null` yapiyor (kosulsuz); burada
   * yalniz olen mob SAVASILAN mob ise temizlenir. AoE ile yan hedef olurken
   * asil hedefle olan savasi kesmemek icin.
   */
  function olum(ws, mob, aid) {
    if (ctx.olum) { ctx.olum(ws.zoneId, ws, mob, aid); return; }
    const zoneId = ws.zoneId;
    /* madde 22: respawn gecikmesi YUVADAN gelir (spawns.json respawnDelaySec =
       Tab_RefNest.dwDelayTimeMin/Max). Sabit 30 sn hicbir kaynaktan
       gelmiyordu; argumani hic vermiyoruz. */
    world.olumKaydet(zoneId, mob);
    yayin(ws, 'combat.death', { id: mob.id, killerId: ws.entityId, aid });
    if (ws.savas?.hedefId === mob.id) ws.savas = null;
    if (ws.hedefId === mob.id) ws.hedefId = null;
    /* TEHDIT TEMIZLIGI - gameloop.js #olum ile ayni (orada VARDI, burada
       EKSIKTI). Respawn AYNI varlik nesnesini geri getirdigi icin eski
       hayatin tehdit puanlari kalirsa taze dogan canavar, oyuncu ona hic
       dokunmadan dogrudan onu hedefliyordu ("mobu kestim, tekrar dogunca
       bana daliyor"). Beceriyle olduren yol server.js'te ctx.olum
       verilmedigi icin CANLI koddur. */
    mob.tehdit = null;
    mob.zorlaHedef = null;
    mob.tehditHpIzi = null;
    /* MADDE 54 - OLUMDE DURUM TEMIZLIGI. Eskiden tablo sessizce siliniyordu;
       istemcinin applyDeath dali (@25671100) durum listesine DOKUNMUYOR, yani
       rozet ekranda ASILI kaliyordu. Once `death` sebebiyle kaldirma bildir,
       SONRA tabloyu birak. */
    const mobDurum = DURUMLAR.get(durumAnahtar(zoneId, mob.id));
    if (mobDurum?.length) {
      const r = durumMotoru.temizle(mobDurum, 'death');
      if (r.degisti) durumYayinla(ws, mob.id, [], r.dusenler.map((x) => ({ code: x.code, reason: x.reason })));
    }
    DURUMLAR.delete(durumAnahtar(zoneId, mob.id));
    SERILI.delete(durumAnahtar(zoneId, mob.id));

    const { xp, spExp } = combat.odul(mob, ws.char);
    /* FARK #0/#180 (capraz istek 49) - PARTI XP/SP PAYLASIMI. gameloop.js
       #olum ile AYNI desen: paylasimHesapla uygun uyeleri bulup paylari
       boler; partisiz oyuncuda tek kayit doner (davranis birebir korunur). */
    const dagilim = ctx.sistemOrnegi?.('parti')?.paylasimHesapla?.(ws, xp, spExp)
      ?? [{ ws, xp: Math.max(0, xp), spExp: Math.max(0, spExp) }];
    for (const d of dagilim) {
      if (!d?.ws?.char) continue;
      odulUygula(d.ws, d.xp ?? 0, d.spExp ?? 0, mob, aid, d.ws === ws);
    }
    /* FARK #101/#145 - gorev oldurme sayaci: beceriyle oldurme de saymali.
       gameloop.#oldurmeBildir (gameloop.js:~1167) ile AYNI kural: pay =
       720720/kisi dagilimdaki HER uyeye yazilir (bolmeyi sayacArtir kendisi
       yapar; mob NESNESI verilebilir, mob.def.id'yi kendisi cozer).
       GOREV.oldurmeKaydet KULLANMA: o paylasimHesapla'yi ICERIDE yeniden
       cagirir (ayni tikte cift indeks taramasi). */
    const GOREV = ctx.sistemOrnegi?.('gorev');
    if (GOREV?.sayacArtir) {
      for (const d of dagilim) {
        if (!d?.ws?.char) continue;
        try { GOREV.sayacArtir(d.ws, mob, dagilim.length); }
        catch (e) { /* gorev modulu yoksa beceri olumu durmasin */ }
      }
    }
    ganimetDus(ws, mob);
  }

  /** Capraz istek 49: TEK aliciya odul (gameloop.#odulUygula'nin es'i).
      gainFx yalniz oldurene gider - killer'in vurus kapisina demirli. */
  function odulUygula(hedefWs, xp, spExp, mob, aid, olduren) {
    const ch = hedefWs.char;
    /* PREMIUM XP/SP BONUSU (D5-C) - gameloop.#odulUygula ile AYNI kural:
       alici basina, dagitimdan sonra. Katsayilar combat.premiumBonusPct()
       icinde sabit (paket @9299985 $comment "additive % boost to XP and SP
       from monster kills"; bronze 10 @9300246 / silver 15 @9300566 /
       gold 20 @9300882). ch.premiumTier yoksa carpan 1. Beceri ile ve elle
       oldurme AYNI degeri vermeli (sartname madde 11-12) - iki ikiz
       ayrismasin. */
    const prem = combat.premiumCarpani?.(ch) ?? 1;
    if (prem !== 1) {
      xp = Math.max(0, Math.round(xp * prem));
      spExp = Math.max(0, Math.round(spExp * prem));
    }
    const sonuc = combat.xpEkle(ch, xp);
    combat.spEkle(ch, spExp);
    const tbl = combat.progress?.xpToNext;
    const xpToNext = tbl ? (Number(tbl[String(ch.level)] ?? 0) || null) : null;

    if (olduren) {
      frame(hedefWs, 'progress.gainFx', {
        sourceId: mob.id, xpDelta: Math.max(0, xp), spExpDelta: Math.max(0, spExp),
        recipientLevelAfter: ch.level,
        xpVisualDenominator: Math.max(1, xpToNext ?? 1),
        killerId: hedefWs.entityId, aid,
      });
    }
    frame(hedefWs, 'progress.update', {
      xp: ch.xp, xpToNext,
      spExp: ch.spExp,
      spExpToNext: combat.progress?.spExpPerSpPoint ?? 400,
      sp: ch.sp ?? 0,
    });
    if (xp > 0 || spExp > 0) {
      frame(hedefWs, 'sys.notice', {
        key: 'sys.progress.xp', params: { xp: Math.max(0, xp), sp: Math.max(0, spExp) },
      });
    }
    if (sonuc.seviyeAtladi) {
      frame(hedefWs, 'progress.levelUp', { level: ch.level, statPoints: ch.statPoints ?? 0 });
      /* s2c 188 fx.levelUp {id} - altin halka efekti. gameloop.js #olum bunu
         frame+broadcast olarak gonderiyor; beceriyle oldurulen mobta da AYNI
         efekt cikmali (aksi halde seviye otomatik saldiriyla atlayinca efekt
         var, beceriyle atlayinca yok oluyordu). */
      yayin(hedefWs, 'fx.levelUp', { id: hedefWs.entityId });
      frame(hedefWs, 'sys.notice', { key: 'sys.progress.level_up', params: { level: ch.level } });
      const d = derived(ch);
      ch.hp = d.maxHp; ch.mp = d.maxMp;
      frame(hedefWs, 'vitals.update', { hp: Math.round(ch.hp), mp: Math.round(ch.mp) });
      /* FARK #103 (capraz istek 48): seviye degisti -> gorev katalogunu IT
         (katalog isteyen c2s opcode YOK, paket @27128946 pasif handler). */
      try { ctx.sistemOrnegi?.('gorev')?.katalogGonder?.(hedefWs); } catch { /* modul yok */ }
    }
  }

  /** _RefDropOptLvlSel ReqOnlineTime kapisi icin oturum dakikasi.
   *  Damgayi gameloop.js tikta koyar (ws._oturumT0); damga yoksa null doner ve
   *  combat.plusUret() kapiyi hic uygulamaz - eksik olcum "hep +0" uretmesin. */
  const oturumDakikasi = (ws) => (ws?._oturumT0 ? (Date.now() - ws._oturumT0) / 60_000 : null);

  /** gameloop.js #ganimetDus ile ayni bicim (modelKey/name esya katalogundan). */
  function ganimetDus(ws, mob) {
    const zoneId = ws.zoneId;
    /* madde 51: ganimet SAHIBININ seviyesi gecmeli (noDropDeltaMin kapisi). */
    const g = combat.ganimet(mob, ws.char);
    const omur = GCFG.lootDespawnMs ?? 60_000;
    const kilit = GCFG.lootOwnerLockMs ?? 15_000;
    const t0 = simdi();
    const eklenen = [];
    const yerlestir = () => {
      const a = Math.random() * Math.PI * 2, r = 1 + Math.random() * 2;
      return { x: mob.x + Math.cos(a) * r, z: mob.z + Math.sin(a) * r };
    };
    const payload = (e) => {
      const p = {
        id: e.id, kind: 'ground_item', modelKey: e.modelKey, name: e.name,
        x: +e.x.toFixed(2), z: +e.z.toFixed(2), y: +e.y.toFixed(2), rotY: 0,
      };
      if (e.itemId) { p.itemId = e.itemId; p.qty = e.qty ?? 1; }
      if (e.gold) { p.gold = e.gold; p.qty = e.qty ?? 1; }
      return p;
    };
    if (g.gold > 0) {
      const p = yerlestir();
      const e = {
        id: world.yeniVarlikId(), kind: 'ground_item',
        modelKey: 'drop_item_bag', name: `${g.gold} Gold`, gold: g.gold, qty: 1,
        /* madde 7 / capraz istek 5: groundY'ye TOHUM olarak olen mobun y'si -
           kopru/platform ustunde olen mobun ganimeti alt kata dusmesin. */
        x: p.x, z: p.z, y: world.groundY(zoneId, p.x, p.z, mob.y), rotY: 0,
        sahip: ws.entityId, sahipBitis: t0 + kilit, bitis: t0 + omur,
      };
      world.varlikEkle(zoneId, e); eklenen.push(payload(e));
    }
    for (const it of g.items.slice(0, 4)) {
      const p = yerlestir();
      const def = esyaDef(it.itemId);
      const adet = Array.isArray(it.qty) ? it.qty[0] : (it.qty ?? 1);
      const e = {
        id: world.yeniVarlikId(), kind: 'ground_item',
        modelKey: def?.modelKey ?? 'drop_item_bag',
        name: def?.name ?? it.itemId, itemId: it.itemId,
        qty: adet,
        /* MADDE 26 (capraz istek 39): dusen ekipmanin ORNEGI dususte uretilir;
           gameloop #cantayaEkle hazir yigini aynen cantaya koyar (fark #16).
           Tel semasina GIRMEZ - payload() sizdirmiyor.
           2026-09-04: ucuncu argument (varyans + N seviye) EKLENDI - gameloop
           #ganimetDus ile birebir ayni cagri; yoksa beceriyle oldurulen mobun
           esyasi variance=0/plus=0, yani hep aralik ALT SINIRINDA dusuyordu. */
        yigin: esya.yeniYigin(def ?? it.itemId, adet,
          combat.dususOrnegi(def, { cevrimiciDk: oturumDakikasi(ws) })),
        x: p.x, z: p.z, y: world.groundY(zoneId, p.x, p.z, mob.y), rotY: 0,
        sahip: ws.entityId, sahipBitis: t0 + kilit, bitis: t0 + omur,
      };
      world.varlikEkle(zoneId, e); eklenen.push(payload(e));
    }
    if (eklenen.length) yayin(ws, 'state.delta', { add: eklenen });
  }

  // ------------------------------------------------------------ sonuc uygula
  /** Hasar/iyilestirme sonucunu bir hedefe uygular ve kareleri gonderir. */
  function vurusUygula(ws, skill, hedefId, aid, hitIndex, hit, hedeflerHazir = null) {
    if (!canli(ws) || ws.char.dead) return;
    let hedefler;
    if (hedeflerHazir) {
      /* MADDE 15: kendine hedefli AoE - merkez OYUNCUDUR, birincil hedef yok. */
      hedefler = hedeflerHazir.filter((h) => h && !h.dead);
    } else {
      const birincil = world.varlik(ws.zoneId, hedefId);
      if (!birincil || birincil.dead) return;
      hedefler = aoeHedefleri(ws, skill, birincil);
    }
    if (!hedefler.length) return;

    const t0 = simdi();
    const d = derivedMod(ws.char, ws);
    let emilenToplam = 0;               // md.39 drain/leech icin

    for (let i = 0; i < hedefler.length; i++) {
      const h = hedefler[i];
      /* Eve donen mob HASAR ALMAZ (bkz. donusteMi). Kapi kare yayinindan
         ONCE: aksi halde istemci hasar sayisini cizer, #eveDonusTik HP'yi
         geri yazar ve gorsel titreme olurdu. AoE'de yalniz DONEN hedef
         elenir - ayni vurustaki digerleri normal hasar alir. */
      if (h.dead || donusteMi(h)) continue;
      const ikincil = i > 0;

      /* MADDE 18 - `downAttack.requiresDowned` kapisi VURUS aninda da gecerli:
         cast anindan sonra hedef ayaga kalkmis olabilir. Kapiya takilan vurus
         `miss` olarak bildirilir (istemci "missed" cizer, @27021500). */
      const hSerili = serili(ws.zoneId, h.id, t0);
      if (skill.downAttack?.requiresDowned && !hSerili) {
        yayin(ws, 'combat.event', {
          src: ws.entityId, dst: h.id, kind: 'skill', skillId: skill.id,
          dmg: 0, crit: false, dstHp: Math.round(h.hp), aid,
          hitIndex: Math.max(0, hitIndex), miss: true,
          ...(ikincil ? { secondary: true } : {}),
          ...(hitIndex > 0 ? { followup: true } : {}),
        });
        continue;
      }

      const v = hasarHesapla(ws.char, h, skill, hit, ikincil, { d, serili: hSerili });

      /* MADDE 39 - `drain.flat` SAVUNMAYI YOK SAYAN gercek hasardir
         (tr.json ui.skill.drain_line). damageScale bu dala UYGULANMAZ
         (combat.json damageScale $comment: "Does NOT touch ... true damage
         (reflect, drains, Pain Quota slices)"). Yalniz AKSIYONUN ILK vurusunda
         eklenir - vurus basina mi toplam mi oldugu pakette yazili degil, cok
         vuruslu beceride katlamamak icin bir kez. */
      const gercek = (hitIndex === 0 && !ikincil) ? Math.max(0, Math.floor(skill.drain?.flat ?? 0)) : 0;

      /* MADDE 20 - imbue rideri. Ana `dmg` DEGISMEZ; istemci ikisini toplar. */
      const imb = (v.hasar > 0 || gercek > 0) ? imbueVurusu(ws, h) : null;
      const toplam = v.hasar + gercek + (imb?.dmg ?? 0);
      const yeniHp = Math.max(0, Math.round(h.hp - toplam));

      const olay = {
        src: ws.entityId, dst: h.id, kind: 'skill', skillId: skill.id,
        dmg: v.hasar + gercek, crit: !!v.kritik, dstHp: yeniHp, aid,
        hitIndex: Math.max(0, hitIndex),
      };
      if (ikincil) olay.secondary = true;
      if (v.blok) olay.blocked = true;
      /* MADDE 61: cok vuruslu becerinin 2. ve sonraki vuruslari `followup`.
         Otomatik saldiri yolu (gameloop.js:#hasarUygula) bunu zaten
         gonderiyordu - iki yol tutarsizdi. */
      if (hitIndex > 0) olay.followup = true;
      if (imb) { olay.imbueDmg = imb.dmg; olay.imbueGroup = imb.groupId; }

      /* Durumlar (stun/root/burn ...) yalniz AKSIYONUN ILK vurusunda zar atilir -
         cok vuruslu beceride her vurusta yeniden takilmasin. (stagePlan.statusIdx
         hangi asamanin hangi durumu tasidigini soyluyor ama alanin anlami paketten
         cozulemedi; bu yuzden ilk vurusa baglandi.) */
      if (toplam > 0 && hitIndex === 0) {
        const kod = durumUygula(ws, skill, h, t0);
        if (kod) olay.statusCode = kod;
        /* MADDE 18 - yere serme / geri savurma. ko once denenir (knockdown
           blogu), tutmazsa kb kaydi. Ikisi de SURE (ms) tasir. */
        const kd = seriliUygula(ws, skill, h, t0) ?? savurmaUygula(ws, skill, h, t0);
        if (kd?.ko) olay.ko = kd.ko;
        else if (kd?.kb) olay.kb = kd.kb;
      }

      yayin(ws, 'combat.event', olay);

      if (toplam <= 0) continue;
      h.hp = yeniHp;
      emilenToplam += toplam;
      // agro: gameloop'un YZ'si bu iki alani okuyor
      h.hedefEntityId = ws.entityId;
      h.sonHasarAlma = t0;
      if (ctx.gezinme?.iptal) ctx.gezinme.iptal(h, h.sonHasarAlma); else h.gez = null;

      /* Uyku HASARLA kirilir (tr.json status.se.desc "vurulunca uyanirsin").
         Motor bu kurali HASARLA_KIRILAN kumesinde tutuyor; baska kod EKLENMEZ. */
      const kir = durumMotoru.hasarAldi(durumListe(ws.zoneId, h.id), { hasar: toplam });
      if (kir.degisti) {
        durumYayinla(ws, h.id, kir.aktif, kir.dusenler.map((x) => ({ code: x.code, reason: x.reason })));
      }

      /* S1 md.2 (ASAMA 1): per-vurus entity.hp yayini KALDIRILDI. Ayni
         noktadaki combat.event zorunlu `dstHp` tasiyor (sema @25620417,
         .optional yok) ve istemcide UY.gateHit ile mermi varisina KAPILI
         (@27110046; applyCombat character.hp = dstHp @25665691, bumpHp +
         setSelf dahil). Kapisiz entity.hp isleyicisi (@27121268 applyHp)
         HP cubugunu ve donma rozetini vurus gorselinden ~533ms once
         oynatiyordu (olcum: olcum_bolt.mjs - entity.hp fire+0'da).
         gercekHasarUygula / kanalPulsu / gameloop oto-saldiri yollarina
         BILEREK dokunulmadi (ASAMA 2 = S1 md.3, once bu yol canlida
         gozlenir); maxHp degistiren yollar (buff/GM/seviye) da kapsam disi. */
      if (h.hp <= 0) olum(ws, h, aid);
    }

    if (emilenToplam > 0) emmeUygula(ws, skill, emilenToplam, aid, t0);
  }

  /**
   * MADDE 39 - CAN/MANA EMME.
   *
   * IKI AYRI KANAL, ikisi de sema ile adlandirilmis:
   *   a) `skill.drain {flat, mwhsPct?, toMpPct?, clampLevelGap?}` (59 beceri,
   *      sema @8671000). tr.json:
   *        ui.skill.drain_line = "Savunmayi yok sayarak {dmg} hasar emer"
   *        ui.skill.drain_hp   = "Verilen hasari HP olarak emer"
   *        ui.skill.drain_mp   = "Hasarin %{pct} kadarini MP olarak geri verir"
   *      -> `flat` SAVUNMAYI YOK SAYAN gercek hasardir; `toMpPct` verilen
   *      hasarin yuzdesi kadar MP verir. damageScale bu dala UYGULANMAZ
   *      (combat.json damageScale $comment: "Does NOT touch ... true damage
   *      (reflect, drains, Pain Quota slices)").
   *      `mwhsPct` ve `clampLevelGap`in anlami COZULEMEDI -> UYGULANMADI.
   *   b) `buff.leech {pct, capFlat}` (11 beceri, sema @8662900): verilen
   *      hasarin `pct`'i kadar HP, `capFlat` ile sinirli.
   */
  function emmeUygula(ws, skill, verilenHasar, aid, t0) {
    const ch = ws.char;
    const d = derivedMod(ch, ws);
    let hp = 0, mp = 0;

    const dr = skill.drain;
    if (dr) {
      /* Istemcinin IPUCU CIZICISI (@25920425, bayt dokumu) alanlari birebir
         esliyor:
           drain.flat     -> ui.skill.drain_line {dmg}
                             "Savunmayi yok sayarak {dmg} hasar emer"
           drain.mwhsPct  -> ui.skill.drain_hp  (PARAMETRESIZ satir)
                             "Verilen hasari HP olarak emer"
           drain.toMpPct  -> ui.skill.drain_mp  {pct}
                             "Hasarin %{pct} kadarini MP olarak geri verir"
         Yani `flat` gercek hasardir (vurusUygula onu ayrica hedefe uygular) ve
         mwhsPct VARSA o hasar cana doner. mwhsPct'in SAYISAL rolu (80) ipucunda
         GORUNMUYOR - carpan olarak KULLANILMADI, sayi uydurulmadi.
         `clampLevelGap` (13 kayit) da uygulanmadi (anlami cozulemedi). */
      if ((dr.mwhsPct ?? 0) > 0) hp += Math.floor(dr.flat ?? 0);
      if ((dr.toMpPct ?? 0) > 0) mp += Math.floor(verilenHasar * dr.toMpPct / 100);
    }
    for (const b of ws.bec?.buff?.values() ?? []) {
      const lc = b.skill?.buff?.leech;
      if (!lc || !(lc.pct > 0)) continue;
      hp += Math.min(lc.capFlat ?? Infinity, Math.floor(verilenHasar * lc.pct / 100));
    }
    if (hp <= 0 && mp <= 0) return;

    const hpOnce = ch.hp ?? 0, mpOnce = ch.mp ?? 0;
    ch.hp = Math.min(d.maxHp, hpOnce + hp);
    ch.mp = Math.min(d.maxMp, mpOnce + mp);
    const hpF = Math.round(ch.hp - hpOnce), mpF = Math.round(ch.mp - mpOnce);
    if (!hpF && !mpF) return;
    const olay = {
      src: ws.entityId, dst: ws.entityId, kind: 'heal', skillId: skill.id,
      dmg: Math.max(0, hpF), crit: false, dstHp: Math.round(ch.hp), aid,
    };
    if (mpF) olay.mp = mpF;
    yayin(ws, 'combat.event', olay);
    frame(ws, 'vitals.update', { hp: Math.round(ch.hp), mp: Math.round(ch.mp) });
  }

  /**
   * MADDE 38 - IYILESTIRME: alan + sureye yayilan + iyilestirme gucu.
   *
   * ESKIDEN tek hedefWs aliyordu; `heal.areaU` (53 beceri), `heal.maxTargets`
   * (53) ve `heal.overTime {pulsRaw, duraRaw}` (29) hic okunmuyordu.
   *
   * BIRIMLER: overTime.pulsRaw degerleri {2000, 5000}, duraRaw {16000, 300000};
   * periodicAtt'ta pulsRaw {2000} / duraRaw {12000}. Hepsi MILISANIYE
   * (2 sn'de bir / 16 sn boyunca). Baska bir birim bu sayilari anlamli
   * kilmiyor - ham degerler DEGISTIRILMEDEN kullaniliyor.
   *
   * `healPowerPct` (dance.mods, Sat @8660327, KESIR) iyilestirme miktarini
   * carpar. `zb` (Zombi) durumu iyilesmeyi TERSINE cevirir: h$ @25588614
   * `zb: { healInvert: true }`, tr.json status.zb.desc "Can yenilenmesi
   * hasara donusur" - motor bunu iyilesmeTers() ile bildirir.
   *
   * UYGULANMAYAN: `heal.weaponMagPct` (91 kayit) ve `heal.division`
   * (22 kayit, efrRaw[6]) - ikisinin de formulu paketten cozulemedi,
   * sayi uydurulmadi.
   */
  function iyilestirTek(ws, skill, hedefWs, aid, carpan = 1) {
    const ch = hedefWs.char;
    const d = derivedMod(ch, hedefWs);
    const h = skill.heal ?? {};
    const guc = 1 + modOran(ws, 'healPowerPct');
    let hpArtis = Math.floor(((h.hpFlat ?? 0) + (d.maxHp * (h.hpPct ?? 0)) / 100) * guc * carpan);
    let mpArtis = Math.floor(((h.mpFlat ?? 0) + (d.maxMp * (h.mpPct ?? 0)) / 100) * guc * carpan);

    /* zb: iyilesme HASARA doner (istemcinin selfHealInverted() @25671589
       kapisiyla ayni kural). */
    if (durumMotoru.iyilesmeTers(durumListe(hedefWs.zoneId, hedefWs.entityId), simdi())) {
      hpArtis = -hpArtis; mpArtis = -mpArtis;
    }

    const hpOnce = ch.hp ?? 0, mpOnce = ch.mp ?? 0;
    ch.hp = Math.max(0, Math.min(d.maxHp, hpOnce + hpArtis));
    ch.mp = Math.max(0, Math.min(d.maxMp, mpOnce + mpArtis));
    const hpFark = Math.round(ch.hp - hpOnce), mpFark = Math.round(ch.mp - mpOnce);

    const olay = {
      src: ws.entityId, dst: hedefWs.entityId,
      /* Ters iyilesmede kare `heal` degil `dot` olmalidir: istemci kind==='heal'
         dalinda yaziyi YESIL cizip mp'yi de iyilesme sanar (@27018300). */
      kind: hpFark < 0 ? 'dot' : 'heal', skillId: skill.id,
      dmg: Math.abs(hpFark), crit: false, dstHp: Math.round(ch.hp), aid,
    };
    if (mpFark) olay.mp = mpFark;
    yayin(ws, 'combat.event', olay);
    frame(hedefWs, 'vitals.update', { hp: Math.round(ch.hp), mp: Math.round(ch.mp) });
    // entity.hp semasi (137): id/hp/maxHp UCU DE Y().int() - yuvarlamadan gonderme.
    yayin(hedefWs, 'entity.hp', { id: hedefWs.entityId, hp: Math.round(ch.hp), maxHp: Math.round(d.maxHp) });
    if (ch.dead !== true && hpFark !== 0) statYayinla(hedefWs);
  }

  /** heal bloklu beceriler (kind 'heal'): tek hedef + alan + sureye yayilan. */
  function iyilestir(ws, skill, hedefWs, aid, t0) {
    const h = skill.heal ?? {};
    const hedefler = [hedefWs];

    /* heal.areaU: yaricap icindeki PARTI uyeleri (maxTargets kadar). */
    const alan = Number(h.areaU ?? 0) || 0;
    if (alan > 0) {
      const enFazla = Math.max(1, Number(h.maxTargets ?? 1) || 1);
      const r2 = alan * alan;
      for (const c of partiSoketleri(ws)) {
        if (hedefler.length >= enFazla) break;
        if (c === hedefWs || !canli(c) || c.char.dead) continue;
        if (uzaklik2(hedefWs.char, c.char) > r2) continue;
        hedefler.push(c);
      }
    }
    for (const c of hedefler) iyilestirTek(ws, skill, c, aid, 1);

    /* heal.overTime: pulsRaw ms'de bir, duraRaw ms boyunca. Ilk puls simdi
       verildi; kalanlar zamanlanir. Toplam iyilestirme BOLUNMEZ - her puls
       tam degeri verir (bolme kurali pakette YOK, uydurulmadi). */
    const ot = h.overTime;
    if (ot?.pulsRaw > 0 && ot?.duraRaw > 0) {
      const adet = Math.max(0, Math.floor(ot.duraRaw / ot.pulsRaw) - 1);
      for (let n = 1; n <= adet; n++) {
        const at = t0 + n * ot.pulsRaw;
        sonra(at, () => {
          for (const c of hedefler) {
            if (canli(c) && !c.char.dead) iyilestirTek(ws, skill, c, aid, 1);
          }
        });
      }
    }
    return hedefler;
  }

  // ------------------------------------------------------------------ atesle
  function atesle(ws, skill, hedef, aid, q, t0) {
    if (!canli(ws) || ws.char.dead) return;
    const s = durum(ws);
    const hedefId = hedef && hedef.id !== ws.entityId ? hedef.id : undefined;

    // hedef bu arada oldu/kayboldu -> iptal
    if (hedefId !== undefined && skill.target === 'enemy') {
      const e = world.varlik(ws.zoneId, hedefId);
      if (!e || e.dead) {
        yayin(ws, 'cast.cancel', { id: ws.entityId, aid });
        frame(ws, 'cast.queued', { state: 'dropped', groupId: skill.groupId, reason: 'cancelled', aid });
        return;
      }
    }

    const ucus = hedefId !== undefined ? ucusMs(ws.char, world.varlik(ws.zoneId, hedefId) ?? hedef, skill) : 0;
    const kare = { id: ws.entityId, skillId: skill.id, aid, at: t0 };
    if (hedefId !== undefined) kare.targetId = hedefId;
    if (ucus > 0) kare.flightMs = ucus;
    if (q !== undefined) kare.q = q;
    yayin(ws, 'skill.fire', kare);

    /* `uygulanan` (D5-C / sartname madde 8): istemci yolunun (asamaIstek)
       cast basina isledigi asamalarin defteri. YALNIZ asamaIstek yazar;
       asagidaki LOT DISI sunucu zamanlayicisi ISARETLEMEZ - o yol yalniz
       LOT disinda calisiyor ve asamaIstek LOT disini zaten kapida
       reddediyor, iki yol hic kesismiyor. */
    /* PP md.1 - ZINCIR SECIM PENCERESI (lockToleranceMs + selectGraceMs
       "zamanlayiciya girer"): preemptOnCast acikken LOT (istemci-secimli)
       zincirin aksiyon kaydi AKSIYON_OMRU_MS'in gevsek 30 sn'si kadar degil,
       SON asamanin birakilma anindan lockToleranceMs + selectGraceMs sonra
       kapanir - gec gelen secim asamaIstek'te `expired` ile duser (kaynak
       $comment: preemptOnCast=false "stops refusing late selections", yani
       true'da gec secim REDDEDILIR; kesin retail formulu cozulmedi -
       "retail's abort policy is unrecovered" - pencere sinirlari config'ten
       okunur, buraya sayi gomulmez). LOT DISI kayitlarda dokunulmaz: onlarin
       asamalarini asagida sunucu zamanliyor, kayit erken olurse vurus duser. */
    let omur = AKSIYON_OMRU_MS;
    const zsp = skill.stagePlan;
    if (ZINCIR.preemptOnCast && (zsp?.length ?? 0) > 1 && LOT.has(skill.groupId)) {
      let son = 0;
      for (const p of zsp) son = Math.max(son, p?.releaseOffsetMs ?? 0);
      omur = Math.min(AKSIYON_OMRU_MS,
        son + Math.max(0, ZINCIR.lockToleranceMs ?? 0)
            + Math.max(0, ZINCIR.selectGraceMs ?? AKSIYON_OMRU_MS));
    }
    s.aksiyon.set(aid, { skill, hedefId, firedAt: t0, bitis: t0 + omur, uygulanan: new Set() });

    // 0. asama sonuclari
    asamaUygula(ws, skill, hedefId, aid, 0, ucus, t0);

    /* MADDE 14 - lot DISINDAKI cok asamali becerilerin 2..N. asamalarini
       SUNUCU zamanlar. Istemci onlari HIC istemiyor (agt() @25675988 false ->
       skill.fire isleyicisi cgt() cagirmiyor, @27124643), bu yuzden 449 planli
       vurusun 275'i dusuyordu (Fire Blow 7 vurus -> 1).
       Zamanlama ani sgt() @25676500 ile AYNI: firedAtServer + releaseOffsetMs.
       lot ICINDEKILERE DOKUNULMAZ - yoksa istemcinin gonderdigi asama istegiyle
       ayni vurus IKI KEZ atilirdi. */
    const sp = skill.stagePlan;
    if (sp?.length > 1 && !LOT.has(skill.groupId)) {
      for (let n = 1; n < sp.length; n++) {
        const at = t0 + Math.max(0, sp[n]?.releaseOffsetMs ?? 0);
        sonra(at, () => {
          if (!canli(ws) || ws.char.dead) return;
          if (!s.aksiyon.has(aid)) return;      // aksiyon dustuyse asama da duser
          asamaUygula(ws, skill, hedefId, aid, n, ucus, at);
        });
      }
    }

    // buff / imbue / dans
    if (skill.buff || skill.kind === 'dance') {
      const hedefWs = hedef?.ws ?? ws;
      buffUygula(ws, hedefWs, skill, t0);
      buffAlanUygula(ws, skill, t0, hedefWs);              // md.38: alan buff'i
    }
    // heal
    if (skill.kind === 'heal') {
      const hedefWs = hedef?.ws ?? ws;
      if (hedefWs?.char) iyilestir(ws, skill, hedefWs, aid, t0);
    }
    // MADDE 40: cure / teleport
    if (skill.kind === 'cure') arindirUygula(ws, skill, hedef?.ws ?? ws, aid);
    if (skill.kind === 'teleport') isinlanUygula(ws, skill, hedef);

    // hasarsiz debuff (hits 0) - durumlari yine de uygula
    if (skill.kind === 'debuff' && !(skill.hits > 0)) {
      const liste = hedefId !== undefined
        ? [world.varlik(ws.zoneId, hedefId)].filter((e) => e && !e.dead)
        /* MADDE 15'in debuff yarisi: kendine hedefli alan debuff'lari
           (warrior_frenzya_tount_area_* gibi) merkezdeki canavarlara uygulanir. */
        : merkezHedefleri(ws, skill);
      for (const e of liste) durumUygula(ws, skill, e, t0);
      /* MADDE 39 - can/mana emme becerilerinin (`drain`) COGU hits:0 DEBUFF'tir
         (warlock_blooda_lifedrain_a_1 gibi): vurusUygula hic cagrilmadigi icin
         `flat` gercek hasari ve emme HIC islemiyordu. */
      if (liste.length) gercekHasarUygula(ws, skill, liste, aid, t0);
    }

    /* TEHDIT BAGLAMA (gameloop.js tehdit motoru "SINIR NOTU"): skills.json
       taunt {points, forcedMs[, areaU, maxTargets]} 222 kayit ve aggroDrop
       {points, areaU, maxTargets} 16 kayit birer BECERI KULLANIM etkisidir -
       kullanim yolu burasi (atesle = gecerli cast'in tek atesleme hunisi;
       gecersiz/expired cast buraya hic ulasmaz, hedef olum kapisi yukarida).
       Kancalar ctx uzerinden gameloop'a baglanir (server.js sistemCtx ->
       LOOP.tauntUygula / LOOP.aggroDropUygula, olumKancasiEkle ile ayni
       tembel kalip). Kanca yoksa (birim testlerinin sahte ctx'i) hicbir sey
       yapilmaz. Butun sayilar VERIDEN; alan tasimayan kayit atlanir. */
    if (skill.taunt && typeof ctx.tauntUygula === 'function') {
      const tnt = skill.taunt;
      if (hedefId !== undefined) {
        /* target:'enemy' (218 kayit): taunt YALNIZ secili hedefe islenir.
           taunt blogu bu kayitlarda areaU tasimiyor; skill.aoe blogu HASAR
           dagitimina aittir - taunt'a genellemek veri disi kural olurdu. */
        ctx.tauntUygula(ws.zoneId, hedefId, ws, tnt);
      } else if (tnt.areaU > 0) {
        /* target:'self' alan taunt'u (warrior_frenzya_tount_area_*, 4 kayit):
           taunt blogunun KENDI areaU/maxTargets alanlari. Secim = EN YAKIN
           maxTargets canavar (aggroDropUygula'nin belgeli secim kuraliyla
           ayni; merkez = oyuncu). */
        const enFazla = Math.max(1, Number(tnt.maxTargets) || 1);
        const r2 = tnt.areaU * tnt.areaU;
        const adaylar = [];
        for (const e of canavarlar(ws.zoneId)) {
          const dx = (e.x ?? 0) - (ws.char.x ?? 0), dz = (e.z ?? 0) - (ws.char.z ?? 0);
          const d2 = dx * dx + dz * dz;
          if (d2 <= r2) adaylar.push({ e, d2 });
        }
        adaylar.sort((a, b) => a.d2 - b.d2);
        for (const { e } of adaylar.slice(0, enFazla)) {
          ctx.tauntUygula(ws.zoneId, e.id, ws, tnt);
        }
      }
    }
    if (skill.aggroDrop && typeof ctx.aggroDropUygula === 'function') {
      /* target 'self' (7) / 'ally' (9 - bard "Discord Wave"): dusen puan
         BECERI HEDEFININ puanidir, tarama merkezi de onun konumu -
         aggroDropUygula(zoneId, ws, drop) tam bu sozlesmeyi uyguluyor. */
      const dusenWs = hedef?.ws ?? ws;
      if (canli(dusenWs) && !dusenWs.char.dead) {
        ctx.aggroDropUygula(ws.zoneId, dusenWs, skill.aggroDrop);
      }
    }

    /* MADDE 17 - KANAL / PERIYODIK HASAR. `periodicAtt {pulsRaw, duraRaw}`
       (83 beceri, sema @8666700) hic okunmuyordu. Degerler ms:
       pulsRaw {2000}, duraRaw {12000} -> 12 sn boyunca 2 sn'de bir.
       Her puls becerinin KENDI katsayisiyla vurur (yeni sayi UYDURULMAZ) ve
       kare kind:'dot' olarak gider (istemci @27018300 bu dali ciziyor). */
    const pa = skill.periodicAtt;
    if (pa?.pulsRaw > 0 && pa?.duraRaw > 0 && (hedefId !== undefined || skill.target === 'self')) {
      const adet = Math.max(0, Math.floor(pa.duraRaw / pa.pulsRaw) - 1);
      for (let n = 1; n <= adet; n++) {
        sonra(t0 + n * pa.pulsRaw, () => kanalPulsu(ws, skill, hedefId, aid));
      }
    }

    /* autoContinue: paket sadece veriyi tasiyor, davranisi sunucuya ait
       (Silkroad "attack continues after the skill"). ws.savas gameloop'un
       otomatik saldiri/yaklasma dongusunun girdisidir. */
    if (skill.autoContinue && hedefId !== undefined) {
      const e = world.varlik(ws.zoneId, hedefId);
      if (e && e.kind === 'monster' && !e.dead) {
        ws.hedefId = e.id;
        if (!ws.savas) ws.savas = { hedefId: e.id, sonVurus: t0 };
      }
    }
  }

  /**
   * MADDE 39 - SAVUNMAYI YOK SAYAN (`drain.flat`) HASAR.
   * tr.json ui.skill.drain_line "Savunmayi yok sayarak {dmg} hasar emer";
   * istemcinin ipucu cizicisi (@25920425) {dmg} yerine `drain.flat` koyuyor.
   * damageScale bu dala UYGULANMAZ (combat.json damageScale $comment).
   * Hasarsiz (hits:0) debuff yolundan cagrilir; vuruslu becerilerde ayni
   * miktar vurusUygula icinde `gercek` olarak eklenir.
   */
  function gercekHasarUygula(ws, skill, hedefler, aid, t0) {
    const flat = Math.max(0, Math.floor(skill.drain?.flat ?? 0));
    if (!(flat > 0)) return;
    let toplam = 0;
    for (const h of hedefler) {
      // eve donen mob HASAR ALMAZ (bkz. donusteMi) - kare yayinindan once
      if (!h || h.dead || donusteMi(h)) continue;
      const yeniHp = Math.max(0, Math.round(h.hp - flat));
      yayin(ws, 'combat.event', {
        src: ws.entityId, dst: h.id, kind: 'skill', skillId: skill.id,
        dmg: flat, crit: false, dstHp: yeniHp, aid,
      });
      h.hp = yeniHp; toplam += flat;
      h.hedefEntityId = ws.entityId;
      h.sonHasarAlma = t0;
      yayin(ws, 'entity.hp', { id: h.id, hp: Math.round(h.hp), maxHp: Math.round(h.maxHp) });
      if (h.hp <= 0) olum(ws, h, aid);
    }
    if (toplam > 0) emmeUygula(ws, skill, toplam, aid, t0);
  }

  /** MADDE 17: periodicAtt pulsu - kind:'dot' karesiyle. */
  function kanalPulsu(ws, skill, hedefId, aid) {
    if (!canli(ws) || ws.char.dead) return;
    const hedefler = hedefId !== undefined
      ? [world.varlik(ws.zoneId, hedefId)].filter((e) => e && !e.dead)
      : merkezHedefleri(ws, skill);
    if (!hedefler.length) return;
    const t0 = simdi();
    const d = derivedMod(ws.char, ws);
    for (let i = 0; i < hedefler.length; i++) {
      const h = hedefler[i];
      /* Eve donen mob HASAR ALMAZ (bkz. donusteMi). Kanal pulsu ZAMANLAYICI
         ile gelir: cast aninda gecerli olan hedef, puls dustugunde donuse
         gecmis olabilir - kapi bu yuzden burada, kare yayinindan once. */
      if (h.dead || donusteMi(h)) continue;
      const v = hasarHesapla(ws.char, h, skill, null, i > 0, { d, serili: serili(ws.zoneId, h.id, t0) });
      const yeniHp = Math.max(0, Math.round(h.hp - v.hasar));
      yayin(ws, 'combat.event', {
        src: ws.entityId, dst: h.id, kind: 'dot', skillId: skill.id,
        dmg: v.hasar, crit: false, dstHp: yeniHp, aid,
        ...(v.blok ? { blocked: true } : {}),
      });
      if (v.hasar <= 0) continue;
      h.hp = yeniHp;
      h.hedefEntityId = ws.entityId;
      h.sonHasarAlma = t0;
      yayin(ws, 'entity.hp', { id: h.id, hp: Math.round(h.hp), maxHp: Math.round(h.maxHp) });
      if (h.hp <= 0) olum(ws, h, aid);
    }
  }

  /**
   * MADDE 40 - ARINMA (cure, 44 aktif beceri).
   *
   * Sema @8670000: cure { curt?{maskRaw, amount}, curl?{maskRaw, baseChancePct,
   * cureLevel}, maxSelected?, areaU? }. Maskeler LY'nin `bit` alanini kullanir
   * (durumlar.js DURUM_META, paket @25075309 ile birebir):
   *   curt.maskRaw 63        = fz|fb|es|bu|ps|zb   (element durumlari)
   *   curl.maskRaw 25145280  = se|rt|sl|fe|my|bl|dn|ds|ca|cspd|csmd|cssr|csit|
   *                            cshp|csmp|tb        (st BILEREK DISARIDA)
   * Aciklama metni ("Randomly cures 2 bad statuses") + maxSelected: adaylardan
   * EN FAZLA maxSelected tanesi RASTGELE secilir. curl adaylarinda
   * baseChancePct zari atilir (100 = kesin).
   *
   * UYGULANMAYAN: `curt.amount` (36) ve `curl.cureLevel` - ikisinin de
   * kullanimi paketten cozulemedi (seviye karsilastirmasi mi, kismi arindirma
   * mi belli degil), sayi uydurulmadi.
   */
  function arindirUygula(ws, skill, hedefWs, aid) {
    const c = skill.cure;
    if (!c || !hedefWs?.char) return;
    const bit = (kod) => durumlar.DURUM_META[kod]?.bit;
    const maskeIcinde = (m, kod) => {
      const b = bit(kod);
      return Number.isFinite(b) && ((Number(m) || 0) & (1 << b)) !== 0;
    };
    const hedefler = [hedefWs];
    const alan = Number(c.areaU ?? 0) || 0;
    if (alan > 0) {
      const r2 = alan * alan;
      for (const o of partiSoketleri(ws)) {
        if (o === hedefWs || !canli(o) || o.char.dead) continue;
        if (uzaklik2(hedefWs.char, o.char) > r2) continue;
        hedefler.push(o);
      }
    }
    for (const o of hedefler) {
      const l = durumListe(o.zoneId, o.entityId);
      const aday = l.filter((k) => maskeIcinde(c.curt?.maskRaw, k.code) || maskeIcinde(c.curl?.maskRaw, k.code));
      if (!aday.length) continue;
      // rastgele sirala, maxSelected kadar dene
      for (let i = aday.length - 1; i > 0; i--) {
        const r2i = Math.floor(Math.random() * (i + 1));
        const tmp = aday[i]; aday[i] = aday[r2i]; aday[r2i] = tmp;
      }
      const secilen = aday.slice(0, Math.max(1, Number(c.maxSelected ?? 1) || 1));
      const dusenler = [];
      for (const k of secilen) {
        if (maskeIcinde(c.curl?.maskRaw, k.code) && !maskeIcinde(c.curt?.maskRaw, k.code)) {
          if (Math.random() * 100 >= (c.curl?.baseChancePct ?? 0)) continue;
        }
        const r = durumMotoru.dusur(l, k.code, 'cured');
        if (r.degisti) dusenler.push(...r.dusenler.map((x) => ({ code: x.code, reason: x.reason })));
      }
      if (dusenler.length) {
        /* @26756085: reason === 'cured' -> istemci ACT_S (arinma) efektini oynatir. */
        durumYayinla(ws, o.entityId, durumMotoru.aktif(l), dusenler);
      }
    }
  }

  /**
   * MADDE 40 - ISINLANMA (teleport, 18 aktif beceri).
   *
   * `teleport {distanceU}` (sema @8670900). Istemci hedefi gx/gz olarak
   * gonderiyor: b1() @25690600 `if (targetFlags?.typeLand !== true) return {}`
   * -> 18 teleport kaydinin HEPSINDE targetFlags.typeLand true.
   * Sunucu mesafeyi distanceU'ya kirpar, NAV ile yurunebilirligi dogrular ve
   * s2c 136 entity.teleport {id,x,z,y,blink} yayinlar.
   * `blink: true` SART: istemci @27121093'te blink YOKSA yukleme ekrani aciyor
   * ("loading.teleporting") - kisa mesafe siframasinda bu yanlis olurdu.
   */
  function isinlanUygula(ws, skill, hedef) {
    const ch = ws.char;
    const gx = Number(hedef?.gx), gz = Number(hedef?.gz);
    if (!Number.isFinite(gx) || !Number.isFinite(gz)) return;
    const enFazla = Number(skill.teleport?.distanceU ?? 0) || 0;
    if (!(enFazla > 0)) return;
    let hx = gx, hz = gz;
    const dx = gx - (ch.x ?? 0), dz = gz - (ch.z ?? 0);
    const uz = Math.hypot(dx, dz);
    if (uz > enFazla) { hx = (ch.x ?? 0) + dx / uz * enFazla; hz = (ch.z ?? 0) + dz / uz * enFazla; }
    /* NAV kapisi: server.js yurunebilirNokta(zoneId,x0,z0,x1,z1,y0) duvara
       carpan yolu KESER; boylece isinlanma duvarin arkasina gecirmez. */
    const yn = ctx.yurunebilirNokta;
    if (typeof yn === 'function') {
      try {
        const r = yn(ws.zoneId, ch.x ?? 0, ch.z ?? 0, hx, hz, ch.y ?? 0);
        if (r) { hx = r.x; hz = r.z; }
      } catch { /* nav yoksa ham nokta */ }
    }
    ch.x = hx; ch.z = hz;
    ch.y = world.groundY(ws.zoneId, hx, hz, ch.y);
    if (ch.bacak) ch.bacak = null;             // yuruyus yolu iptal
    yayin(ws, 'entity.teleport', {
      id: ws.entityId, x: +hx.toFixed(2), z: +hz.toFixed(2), y: +(ch.y ?? 0).toFixed(2),
      blink: true,
    });
  }

  function asamaUygula(ws, skill, hedefId, aid, asama, ucus, t0) {
    const vuruslar = asamaVuruslari(skill, asama);
    if (!vuruslar.length) return;
    /* MADDE 15: hedefId yoksa merkez OYUNCUDUR. Hedef listesi vurus BASINA
       degil ASAMA basina cozulur - ayni asamanin butun vuruslari ayni
       canavarlara gitsin. */
    const merkezli = hedefId === undefined;
    if (merkezli && !['attack', 'nuke', 'debuff'].includes(skill.kind)) return;
    const liste = merkezli ? merkezHedefleri(ws, skill) : null;
    if (merkezli && !liste.length) return;
    for (const v of vuruslar) {
      const gecikme = (v.offsetMs ?? 0) + ucus;
      const calistir = () => vurusUygula(ws, skill, hedefId, aid, v.idx, v.hit, liste);
      if (gecikme <= 0) calistir();
      else sonra(t0 + gecikme, calistir);
    }
  }

  /**
   * PP md.1 - KOMBO KESME KURALI (chain.preemptOnCast).
   *
   * Cok asamali beceri surerken FARKLI bir becerinin cast'i gelirse KALAN
   * asamalardan vazgecilir - hasar hakki yanar (kaynak $comment: "a
   * DIFFERENT skill's press abandons the combo and the actor frees at the
   * CURRENT row's own Action_ActionDuration"). Uygulama:
   *   - aksiyon kaydi silinir: lot DISI sunucu-zamanli asamalar `sonra`
   *     kapanisindaki `s.aksiyon.has(aid)` kapisinda duser; lot ICI istemci
   *     asama istekleri asamaIstek'te `expired` ile reddedilir. O anki
   *     ASAMANIN zamanlanmis vuruslari s.aksiyon'a bakmadigi icin tamamlanir
   *     ("o anki vurus biter bitmez" semantigi).
   *   - s.aksiyonBitis bir SONRAKI asamanin birakilma anina (releaseOffsetMs
   *     = zincirde el degistirme noktasi) cekilir ki MADDE 37 kuyrugundaki
   *     yeni cast tum actionMs'i beklemesin (olcum kaniti: Chain Spear -
   *     Dragon'da yeni beceri ~1240ms'de basliyor, bas satiri 1152ms -
   *     kuyrugun tik taneciligiyle satir sonunda acilmasi birebir).
   *   - KENDI tusuna tekrar basmak vazgecme DEGILDIR ($comment BR-0175:
   *     "re-pressing the chain's OWN key is spam, never abandonment") ->
   *     yalniz FARKLI groupId'li aksiyonlar kesilir.
   *   - IMBUE MUAF (md.55: E1'de imbue dali butun iptal cagrilarindan ONCE
   *     donuyor - imbue basmak zinciri bozmaz).
   */
  function komboKes(ws, yeniSkill, t0) {
    if (!ZINCIR.preemptOnCast) return;
    if (yeniSkill.kind === 'imbue') return;
    const s = ws.bec;
    if (!s?.aksiyon?.size) return;
    for (const [aid, a] of [...s.aksiyon]) {
      if (asamaSayisi(a.skill) <= 1) continue;               // kesilecek asama yok
      if (a.skill.groupId === yeniSkill.groupId) continue;   // BR-0175: spam, vazgecme degil
      const gecen = t0 - (a.firedAt ?? t0);
      for (const p of a.skill.stagePlan ?? []) {
        const off = Math.max(0, p?.releaseOffsetMs ?? 0);
        if (off > gecen) {
          const el = (a.firedAt ?? t0) + off;                // o anki vurusun bitisi
          if ((s.aksiyonBitis ?? 0) > el) s.aksiyonBitis = el;
          break;
        }
      }
      s.aksiyon.delete(aid);                                 // kalan asamalar duser
    }
  }

  // ------------------------------------------------------------------ baslat
  function baslat(ws, skill, hedef, q, t0, mp, hp) {
    const s = durum(ws), ch = ws.char;

    /* PP md.1: range kuyrugundan (tik -> baslat) gelen yeni cast'ler icin
       emniyet agi - castIstek yolunda komboKes zaten kosuldu, idempotent. */
    komboKes(ws, skill, t0);

    /* MADDE 55 - IMBUE SUREN CAST'I IPTAL ETMEZ.
       Paket E1() @25691996 (bayt dokumu): `if (event.kind === 'imbue') { send(...);
       ...castImbueOptimistic...; return; }` satiri `if (Q.isSelfCasting())`
       dalindan ve butun iptal cagrilarindan ONCE donuyor. Yani istemcide imbue
       basmak ne cast cubugunu ne de cok asamali zinciri BOZUYOR; sunucu ise
       kosulsuz supersede yapinca iki taraf ayrisiyordu ("becerim kayboldu"). */
    if (s.cast && skill.kind !== 'imbue') {
      frame(ws, 'cast.queued', {
        state: 'dropped', groupId: s.cast.groupId, reason: 'superseded', aid: s.cast.aid,
      });
      yayin(ws, 'cast.cancel', { id: ws.entityId, aid: s.cast.aid });
      s.cast = null;
    }
    if (skill.kind !== 'imbue') s.kuyruk = null;

    // maliyetler
    if (mp > 0 || hp > 0) {
      ch.mp = Math.max(0, (ch.mp ?? 0) - mp);
      if (hp > 0) ch.hp = Math.max(1, (ch.hp ?? 0) - hp);
      frame(ws, 'vitals.update', { hp: Math.round(ch.hp), mp: Math.round(ch.mp) });
    }

    // cooldown grubu = groupId (istemci zY.cooldowns[groupId], cast.ok ile kurulur)
    const readyAt = t0 + (skill.cooldownMs ?? 0);
    if ((skill.cooldownMs ?? 0) > 0) s.cd.set(skill.groupId, readyAt);
    frame(ws, 'cast.ok', { groupId: skill.groupId, readyAt });

    const aid = yeniAid();
    let castMs = Math.max(0, skill.castMs ?? 0);
    const hedefId = hedef && hedef.id !== ws.entityId ? hedef.id : undefined;

    /* MADDE 52 - YAVASLAMA CAST SURESINI DE UZATIR.
       Paket g$() @25590140: v = PROD(1 + atkSlowPct); carpan = 1/max(.1, v).
       h$'ta fb atkSlowPct -0.5, sl -0.25 -> yavaslatilmis oyuncunun animasyonu
       istemcide uzuyordu ama sunucu tam hizda atesliyordu (gorsel/mantik
       ayrismasi). Motor ayni formulu birebir tasiyor. */
    if (castMs > 0) {
      const yavas = durumMotoru.saldiriSuresiCarpani(durumListe(ws.zoneId, ws.entityId), t0);
      if (yavas > 1) castMs = Math.round(castMs * yavas);
    }

    /* MADDE 37 - VURUS SONRASI BEKLEME PENCERESI (actionMs).
       Istemci kendini armSelfAction(actionMs * g$()) ile kilitliyor
       (@25668111 + @27124643) ama isteği yine de gonderiyor -> pencereyi
       uygulamak SUNUCUNUN isi. IMBUE MUAF: E1'de imbue dali isSelfCasting
       kontrolunden ONCE donuyor (bkz. md.55). */
    if (skill.kind !== 'imbue') {
      const eylem = Math.max(0, Number(skill.actionMs ?? 0) || 0);
      const yavas = durumMotoru.saldiriSuresiCarpani(durumListe(ws.zoneId, ws.entityId), t0);
      s.aksiyonBitis = t0 + castMs + Math.round(eylem * (yavas > 1 ? yavas : 1));
    }

    if (castMs > 0) {
      const kare = { id: ws.entityId, groupId: skill.groupId, castMs, aid, at: t0 };
      if (hedefId !== undefined) kare.targetId = hedefId;
      if (q !== undefined) kare.q = q;
      yayin(ws, 'cast.start', kare);
      s.cast = { aid, skill, hedef, hedefId, q, groupId: skill.groupId, ateslemeAt: t0 + castMs };
    } else {
      atesle(ws, skill, hedef, aid, q, t0);
    }
    return aid;
  }

  /**
   * MADDE 18 + 16 - ETKISIZ HALDE CAST KAPISI.
   * Paket E1() @25691996 ILK satiri (bayt dokumu):
   *   if (Q.selfCcLocked()) return Q.selfDowned()
   *       ? T1(Q.selfKnockedBack() ? `err.busy.knockedback` : `err.busy.downed`)
   *       : void 0;
   * selfCcLocked() @25671260 = selfDowned() VEYA h$[code].ccLock tasiyan canli
   * bir durum. Istemci bu durumda isteği HIC gondermiyor; sunucu da gelen ham
   * paketi reddetmek zorunda (aksi halde makro ile sersemletme bosa gider).
   * Anahtarlarin hepsi err enum'unda VE tr.json'da var.
   * Doner: err.key | null
   */
  function kilitAnahtari(ws, t0) {
    if (serili(ws.zoneId, ws.entityId, t0)) return 'err.busy.downed';
    return durumMotoru.kilitErrAnahtari(durumListe(ws.zoneId, ws.entityId), t0);
  }

  /** Giyili silah kirik mi (dur <= 0). tr.json err.skill.weapon_broken. */
  function silahKirik(ch) {
    const v = ch?.equip?.weapon;
    if (!v || typeof v === 'string') return false;
    return (v.dur ?? 1) <= 0;
  }
  /** Kalkan TAKILI ama kirik mi. tr.json err.skill.shield_broken. */
  function kalkanKirik(ch) {
    const v = ch?.equip?.shield;
    if (!v || typeof v === 'string') return false;
    const def = esyaDef(esyaId(v));
    return def?.type === 'shield' && (v.dur ?? 1) <= 0;
  }

  /**
   * MADDE 40 - `dance.requiresSong` kapisi.
   * Paket t_t() @25695700 (bayt dokumu): KENDISI DISINDA, ayni bolgedeki bir
   * BASKA OYUNCUNUN buff listesinde `allyCast` OLMAYAN ve suresi dolmamis bir
   * kayit var mi; o kaydin groupId'sinin becerisi `dance.isSong` tasiyor mu ve
   * mesafe o dansin areaU'su icinde mi. err.skill.requires_song enum'da + tr.json.
   */
  function sarkiMenzilinde(ws) {
    const kume = world.bolgeOyunculari?.(ws.zoneId);
    if (!kume) return false;
    const t = simdi();
    for (const c of kume) {
      if (c === ws || !canli(c)) continue;
      for (const b of c.bec?.buff?.values() ?? []) {
        const p = b.payload;
        if (!p || p.allyCast) continue;
        if (!p.maintained && !(p.expiresAt > t)) continue;
        const dns = b.skill?.dance;
        if (!dns?.isSong) continue;
        const alan = Number(dns.areaU ?? 0) || 0;
        if (alan > 0 && uzaklik2(ws.char, c.char) > alan * alan) continue;
        return true;
      }
    }
    return false;
  }

  // ------------------------------------------------------------ mesaj: cast
  function castIstek(ws, d, q) {
    const ch = ws.char;
    if (!ch) return true;
    const groupId = String(d.groupId ?? '');
    if (!groupId) { hata(ws, 'ERR_VALIDATION', null, q); return true; }

    // --- asama istegi (paket sgt(): stage 1..7 + ayni aid) ---
    if (d.stage != null) return asamaIstek(ws, d, groupId);

    if (ch.dead) { hata(ws, 'ERR_DEAD', null, q); return true; }

    const skill = beceriCoz(ch, groupId);
    if (!skill) { hata(ws, 'ERR_UNKNOWN_SKILL', null, q); return true; }
    if (skill.kind === 'passive') { hata(ws, 'ERR_VALIDATION', null, q); return true; }
    if (skill.disabled) { hata(ws, 'ERR_VALIDATION', 'err.skill.disabled', q); return true; }
    /* Paket E1() @25692593 (bayt dokumu):
         if (event.disabled || event.experimentGated || q$.getState().session) return;
       Yani iki bayrak da cast'i durduruyor. Anahtar err.skill.experiment_gated
       Eht enum'unda VAR (@25607034; data/schemas.json ile de dogrulandi) ve
       tr.json'da karsiligi var ("Bu yetenek canli dogrulama beklemektedir...").
       Cikarilmis veride su an `experimentGated` alani HIC YOK (0 kayit) - kapi
       bugun hicbir seyi degistirmez, ileride veri gelirse acik kalmasin diye
       savunma amacli konuldu. */
    if (skill.experimentGated) { hata(ws, 'ERR_VALIDATION', 'err.skill.experiment_gated', q); return true; }
    if (!DESTEKLENEN.has(skill.kind)) {
      /* revive: ARTIK kendi alt sistemi VAR (sistem_dirilis-unique.js).
         Burada true donup ERR_VALIDATION yollarsak yonlendirici mesaji
         TUKETIR ve o modul dirilis castini hic goremez. false = "benim
         isim degil" -> sunucu bir sonraki sisteme gecer. */
      if (skill.kind === 'revive') return false;
      /* Geriye YALNIZ `stealth` kaldi ve 13 kaydinin 13'u de disabled -
         yukaridaki disabled kapisinda zaten reddedilir; buraya duserse veri
         degismis demektir. */
      hata(ws, 'ERR_VALIDATION', null, q);
      return true;
    }

    const s = durum(ws);
    const t0 = simdi();

    /* MADDE 18/16: etkisiz hale dusmus oyuncu cast edemez (E1'in ILK kapisi). */
    const kilit = kilitAnahtari(ws, t0);
    if (kilit) {
      hata(ws, kilit.startsWith('err.busy.') ? 'ERR_BUSY' : 'ERR_VALIDATION', kilit, q);
      return true;
    }

    if (t0 < (s.cd.get(groupId) ?? 0)) { hata(ws, 'ERR_COOLDOWN', null, q); return true; }

    const tur = silahTuru(ch);
    /* TOPLAMA ALETI KAPISI. Paket E1() @25692593, silah kapisinin HEMEN ONUNDE:
         { let v_e2 = y1(); if (v_e2 !== null && uY(v_e2)) return T1(`err.profession.tool_no_combat`); }
         if (!C1(event)) return T1(`err.ERR_REQ_WEAPON`);
       uY @8693535: `arg_e in lY`, lY = {profession_axe:`lumberjack`,
       profession_pickaxe:`miner`}. Tablo BURAYA SABIT YAZILMADI:
       data/professions.json `toolWeaponType` alanindan turetiliyor (ALET_TURLERI).
       Anahtar err.profession.tool_no_combat Eht enum'unda VAR (@25608493) ve
       tr.json = "Toplama aleti tutarken savasamazsin."
       Kod ERR_VALIDATION: Sht enum'unda (@25603148) toplama aletine ozel bir
       kod YOK; anahtar zaten metni tasidigi icin genel kod yeterli. */
    if (tur !== null && ALET_TURLERI.has(tur)) {
      hata(ws, 'ERR_VALIDATION', 'err.profession.tool_no_combat', q); return true;
    }
    if (!silahUygun(skill, tur)) { hata(ws, 'ERR_REQ_WEAPON', null, q); return true; }
    /* FARK 47 - `err.skill.weapon_broken` / `err.skill.shield_broken` HIC
       gonderilmiyordu (ikisi de err enum'unda VE tr.json'da var). Silah
       gerektiren bir beceri KIRIK silahla atilamaz; kalkan gerektiren beceri
       KIRIK kalkanla atilamaz - kalkanVar() zaten dur > 0 istiyordu ama
       oyuncuya "Kalkan gerektirir" diyordu, oysa kalkan TAKILI. */
    if (izinliSilahlar(skill) !== undefined && silahKirik(ch)) {
      hata(ws, 'ERR_REQ_WEAPON', 'err.skill.weapon_broken', q); return true;
    }
    if (kalkanGerek(skill) && !kalkanVar(ch)) {
      hata(ws, 'ERR_VALIDATION',
        kalkanKirik(ch) ? 'err.skill.shield_broken' : 'err.skill.requires_shield', q);
      return true;
    }

    /* MADDE 40 - dans yalnizca baska bir ozanin sarkisinin menzilinde. */
    if (skill.kind === 'dance' && skill.dance?.requiresSong && !sarkiMenzilinde(ws)) {
      hata(ws, 'ERR_VALIDATION', 'err.skill.requires_song', q); return true;
    }

    const mp = mpMaliyeti(ch, skill);
    const hp = hpMaliyeti(ch, skill);
    if ((ch.mp ?? 0) < mp) { hata(ws, 'ERR_NO_MP', null, q); return true; }
    /* Paket E1() @25692593: `if (character.hp < n_t(event)) return T1("err.ERR_NO_HP")`
       -> STRICT `<`. Bizde `<=` idi: cani TAM maliyet kadar olan oyuncu
       reddediliyordu (hpCostPct 95 tasiyan 55 beceride hissedilir fark).
       Oyuncu bu yuzden OLMEZ: baslat() zaten Math.max(1, hp - maliyet)
       uyguluyor, yani can en az 1'de kalir. */
    if ((ch.hp ?? 0) < hp) { hata(ws, 'ERR_NO_HP', null, q); return true; }

    const hc = hedefCoz(ws, skill, d);
    if (hc.code) { hata(ws, hc.code, hc.key ?? null, q); return true; }
    const hedef = hc.hedef;
    /* MADDE 40: yer hedefli beceriler (teleport) gx/gz tasir - b1() @25690600
       bunlari YALNIZ targetFlags.typeLand true iken gonderiyor. */
    if (hedef && (d.gx != null || d.gz != null)) { hedef.gx = Number(d.gx); hedef.gz = Number(d.gz); }

    /* MADDE 18 - `downAttack.requiresDowned` (26 beceri). tr.json
       err.skill.requires_downed = "Hedef yere serilmis olmali." */
    if (skill.downAttack?.requiresDowned && hedef && hedef.id !== ws.entityId
        && !serili(ws.zoneId, hedef.id, t0)) {
      hata(ws, 'ERR_VALIDATION', 'err.skill.requires_downed', q); return true;
    }

    // --- menzil (paket Zgt) ---
    if (hedef && hedef.id !== ws.entityId) {
      const men = menzilU(ch, skill);
      if (uzaklik2(ch, hedef) > men * men) {
        s.kuyruk = { skill, hedefId: hedef.id, q, bitis: t0 + KUYRUK_ZAMAN_ASIMI_MS };
        const kare = { state: 'queued', groupId, targetId: hedef.id };
        if (q !== undefined) kare.q = q;
        frame(ws, 'cast.queued', kare);
        /* Yaklasmayi gameloop yapsin: ws.savas onun otomatik saldiri/yaklasma
           dongusunun girdisi (gameloop.js #hedefeYaklas). */
        const e = world.varlik(ws.zoneId, hedef.id);
        if (e?.kind === 'monster' && !e.dead) {
          ws.hedefId = e.id;
          // varsa mevcut vurus zamanlamasini koru, sadece hedefi degistir
          ws.savas = { hedefId: e.id, sonVurus: ws.savas?.sonVurus ?? t0 };
        }
        return true;
      }
    }

    /* PP md.1 - KOMBO KESME: butun kapilardan gecmis (gecerli) yeni cast,
       suren cok asamali becerinin kalan asamalarini BASILDIGI ANDA dusurur
       (hasar hakki yanar) ve s.aksiyonBitis'i o anki vurusun bitisine ceker -
       asagidaki MADDE 37 kuyrugu boylece "o anki vurus biter bitmez" acilir.
       Menzil kuyruguna dusen (yukarida return eden) istek burada DEGIL,
       kuyruktan cikip baslat()'a girdigi anda keser. */
    komboKes(ws, skill, t0);

    /* MADDE 37 - VURUS SONRASI BEKLEME. Aksiyon penceresi acikken gelen istek
       REDDEDILMEZ, KUYRUGA alinir (plan md.37: reddetme mi kuyruga alma mi
       oldugu paketten cozulemedi; kuyruga alma istemcinin cast.queued
       isleyicisiyle uyumlu ve daha guvenli). Pencere dolunca ayni istek
       BASTAN islenir - butun kapilar tazeden gecer, cift maliyet olmaz.
       IMBUE MUAF (E1'de imbue dali isSelfCasting'den ONCE donuyor).

       TUTMA SURESI ARTIK VERIDEN (2026-09-04): eskiden buraya MENZIL
       kuyrugunun 15 000 ms'i konuyordu; sonuc, saniyeler once basilan
       becerinin pencere sinirinda MAKINE HASSASIYETIYLE otomatik atesinden
       ibaretti ("macro hissi" olcumu: 4 becerilik rotasyonda her basim bir
       onceki pencerenin kapanisindan +41/+62 ms sonra atesledi, tek bir
       insan boslugu yok). Yeni sure paketin KENDI degeri: istemcinin
       skill.cast gonderim araligi N_t = 200 ms (I_t @18752281) - yani
       pencerenin son 200 ms'si dogal bir on-giris tamponu olur, daha erken
       basim ERR_BUSY ile reddedilir ve oyuncu yeniden basar. Sayi KODA
       GOMULU DEGIL: data/combat.json combatConfig.skillQueue. */
    if (skill.kind !== 'imbue' && t0 < (s.aksiyonBitis ?? 0)) {
      const tut = Math.max(0, Number(combat.cfg.skillQueue?.actionWindowHoldMs ?? 0) || 0);
      if (tut <= 0) {                       // 0 = tamponsuz: aninda reddet
        const red = { state: 'dropped', groupId, reason: 'rejected' };
        if (q !== undefined) red.q = q;
        frame(ws, 'cast.queued', red);
        hata(ws, 'ERR_BUSY', null, q);
        return true;
      }
      s.eylem = { d: { ...d }, q, at: s.aksiyonBitis, bitis: t0 + tut };
      const kare = { state: 'queued', groupId };
      if (q !== undefined) kare.q = q;
      frame(ws, 'cast.queued', kare);
      return true;
    }
    s.eylem = null;

    baslat(ws, skill, hedef, q, t0, mp, hp);
    return true;
  }

  /** Cok asamali becerilerin 2..N. vurusu (mp/cooldown TEKRAR alinmaz). */
  function asamaIstek(ws, d, groupId) {
    const s = durum(ws);
    const aid = d.aid != null ? Number(d.aid) : NaN;
    const asama = Number(d.stage);
    const kayit = s.aksiyon.get(aid);
    if (!kayit || kayit.skill.groupId !== groupId) {
      frame(ws, 'cast.queued', { state: 'dropped', groupId, reason: 'expired', ...(Number.isFinite(aid) ? { aid } : {}) });
      return true;
    }
    if (asama < 1 || asama >= asamaSayisi(kayit.skill)) {
      frame(ws, 'cast.queued', { state: 'dropped', groupId, reason: 'rejected', aid });
      return true;
    }
    /* MADDE 14 - CIFT VURUS KORUMASI. lot DISINDAKI gruplarda asamalari
       sunucu zaten zamanladi (bkz. atesle). Mesru istemci bu istegi hic
       gondermez (agt() @25675988 false); gelirse ham paket demektir ve
       kabul edilirse ayni vurus IKI KEZ atilir. */
    if (!LOT.has(kayit.skill.groupId)) {
      frame(ws, 'cast.queued', { state: 'dropped', groupId, reason: 'rejected', aid });
      return true;
    }
    /* TEKRAR KORUMASI (D5-C / sartname madde 8): ayni (aid, stage) istegi
       kac kez gelirse o kadar uygulaniyordu. Mesru istemci her asamayi TAM
       BIR KEZ gonderir (sgt @25676680: her stagePlan girdisi icin tek
       `skill.cast {groupId, stage, aid}`); degistirilmis istemci LOT ICI
       190 kayitta tek cast'in 30 sn'lik aksiyon penceresinde (AKSIYON_OMRU_MS)
       ayni asamayi sinirsiz tekrar isteyip hasari cogaltabilirdi
       (sword_chain_f_1 = cast basina 5 vurusun tekrari). vurusUygula'da
       (aid, hitIndex) bazli koruma yok; hiz sinirlayici yavaslatir,
       engellemez. Kume atesle()'de kuruldu; eski kayit sekline karsi ?. */
    if (kayit.uygulanan?.has(asama)) {
      frame(ws, 'cast.queued', { state: 'dropped', groupId, reason: 'rejected', aid });
      return true;
    }
    kayit.uygulanan?.add(asama);
    asamaUygula(ws, kayit.skill, kayit.hedefId, aid, asama, 0, simdi());
    return true;
  }

  // ----------------------------------------------------------- mesaj: cancel
  function buffIptal(ws, d) {
    const groupId = String(d.groupId ?? '');
    if (!groupId) return true;
    const s = durum(ws);
    const b = s.buff.get(groupId);
    if (!s.buff.delete(groupId)) return true;
    buffYayinla(ws);
    // MADDE 19: mod seti degisti -> stats.update + (gerekiyorsa) hiz tazelemesi
    modTazele(ws, (b?.skill?.buff?.mods ?? b?.skill?.dance?.mods)?.moveSpeedPct != null);
    return true;
  }

  /**
   * MADDE 62 - BOLGEYE GIREN OYUNCU MEVCUT DURUMLARI/BUFF'LARI GORSUN.
   *
   * durumYayinla()/buffYayinla() yalniz DEGISIM aninda yayin yapiyor; sonradan
   * giren oyuncu yanan/sersemlemis canavarlari ve buff'li oyunculari ROZETSIZ
   * goruyordu. Iki tamamlayici yol var:
   *   a) OYUNCULAR icin state.delta.add zaten `buffs`/`statuses` alanlarini
   *      tasiyor (data/schemas.json state.delta) - onlari `varlikAlanlari(ch)`
   *      kancasi dolduruyor (server.js:763 entityPayload).
   *   b) CANAVARLAR icin ayni alan world.js'in kendi varlik yukunde uretilir ve
   *      o dosya bu grubun DEGIL; bu yuzden giriste bolgedeki her durumlu
   *      varlik icin TEK BIR statuses.update yollanir. Tablo kucuk (yalniz
   *      durumu OLAN varliklar), maliyeti ihmal edilebilir.
   * Sentetik `zone.ready` giris.js tarafindan hem giriste hem bolge gecisinde
   * dagiticidan geciyor; mesaj TUKETILMEZ (false) - baska moduller de dinliyor.
   */
  function girisDurumlari(ws) {
    if (!ws?.char || ws.entityId == null) return;
    const t = simdi();
    bolgeEsitle(ws);
    const onek = `${ws.zoneId}|`;
    for (const [k, l] of DURUMLAR) {
      if (!k.startsWith(onek) || !l.length) continue;
      const id = Number(k.slice(onek.length));
      if (id === ws.entityId) continue;              // kendisi selfAlanlari'ndan alir
      const aktif = durumMotoru.aktif(l, t);
      if (aktif.length) frame(ws, 'statuses.update', { id, statuses: aktif });
    }
    const kume = world.bolgeOyunculari?.(ws.zoneId);
    for (const c of kume ?? []) {
      if (c === ws || !canli(c) || !c.bec?.buff?.size) continue;
      const bl = [...c.bec.buff.values()]
        .map((b) => b.payload)
        .filter((p) => p && (p.maintained || p.expiresAt > t));
      if (bl.length) frame(ws, 'buffs.update', { id: c.entityId, buffs: bl.map((p) => ({ ...p })) });
    }
  }

  // -------------------------------------------------------------------- tik
  function tik(t = simdi()) {
    // 1) zamanlanmis vuruslar
    if (isler.length) {
      for (let i = 0; i < isler.length; i++) {
        if (isler[i].at > t) continue;
        const is = isler[i];
        isler.splice(i, 1); i--;
        try { is.fn(); } catch (e) { log('beceri is hatasi: ' + e.message); }
      }
    }

    for (const ws of [...oyuncular]) {
      if (!canli(ws)) { oyuncular.delete(ws); continue; }
      /* Bolge degistiyse durum tablosu anahtarini tasi (bkz. bolgeEsitle). */
      bolgeEsitle(ws);
      const s = ws.bec;
      const ch = ws.char;

      // 2) suren cast
      if (s.cast) {
        if (ch.dead) {
          yayin(ws, 'cast.cancel', { id: ws.entityId, aid: s.cast.aid });
          s.cast = null;
        } else if (t >= s.cast.ateslemeAt) {
          const c = s.cast; s.cast = null;
          atesle(ws, c.skill, c.hedef, c.aid, c.q, t);
        }
      }

      // 3) menzil kuyrugu
      if (s.kuyruk) {
        const k = s.kuyruk;
        const e = world.varlik(ws.zoneId, k.hedefId);
        if (!e || e.dead || ch.dead) {
          s.kuyruk = null;
          frame(ws, 'cast.queued', {
            state: 'dropped', groupId: k.skill.groupId, reason: 'cancelled',
            ...(k.q === undefined ? {} : { q: k.q }),
          });
          /* cast.queued istemcide YALNIZCA kuyruk gostergesini temizler
             (@27125321 handler: setQueued/clearQueued). Iyimser cast'i sadece
             `err` (cancelByQ(q), @27135792) ya da `cast.cancel` dusurur; kuyruk
             asamasinda henuz aid yok, o yuzden err kanali kullanilir. */
          hata(ws, ch.dead ? 'ERR_DEAD' : 'ERR_NOT_FOUND', null, k.q);
        } else if (uzaklik2(ch, e) <= menzilU(ch, k.skill) ** 2) {
          /* DELIK 1 (bulgu ALAN 1): eskiden burada yalniz MP kontroluyle
             dogrudan baslat() cagriliyordu - s.aksiyonBitis (MADDE 37),
             kilitAnahtari, cooldown ve silah kapilari yeniden BAKILMIYORDU;
             yeni beceri suren aksiyonun ortasinda baslayip MP'si yanmis
             cast'i iptal ediyordu (olcum A3: pencere +250ms'de delindi).
             Tek yol: istek castIstek'ten TAZE gecer - pencere aciksa MADDE 37
             s.eylem'e kuyruklar (istemci cast.queued 'queued' isleyicisiyle
             uyumlu), kapaliysa baslat'a iner; 'started' karesini MADDE 37
             bosalirken zaten atiyor. komboKes de dogru noktada bir kez kosar,
             baslat icindeki emniyet agi idempotent kalir. Hedef bu tikte
             menzilde oldugundan yeniden kuyruklama dongusu olusmaz; ERR
             durumlarinda (MP bitti vb.) err+q zaten gidiyor. */
          s.kuyruk = null;
          try { castIstek(ws, { groupId: k.skill.groupId, targetId: k.hedefId }, k.q); }
          catch (e2) { log('beceri menzil kuyrugu hatasi: ' + e2.message); }
        } else if (t >= k.bitis) {
          s.kuyruk = null;
          frame(ws, 'cast.queued', {
            state: 'dropped', groupId: k.skill.groupId, reason: 'expired',
            ...(k.q === undefined ? {} : { q: k.q }),
          });
          // `err.skill.queue_timeout` -> Eht enum'unda VAR, tr.json'da VAR.
          hata(ws, 'ERR_RANGE', 'err.skill.queue_timeout', k.q);
        }
      }

      /* MADDE 54 - OLUMDE BUFF/DURUM TEMIZLIGI.
         Eskiden yalniz suren cast iptal ediliyordu: s.buff olduğu gibi kaliyor
         ve upkeep MP kesintisi OLUYKEN bile devam ediyordu; istemcinin
         applyDeath dali (@25671100) buff/durum listesine DOKUNMUYOR, yani
         rozetler de ekranda asili kaliyordu. */
      if (ch.dead) {
        if (s.buff.size) {
          s.buff.clear();
          buffYayinla(ws);
          modTazele(ws, true);
        }
        const l = durumListe(ws.zoneId, ws.entityId);
        if (l.length) {
          const r = durumMotoru.temizle(l, 'death');
          if (r.degisti) durumYayinla(ws, ws.entityId, [], r.dusenler.map((x) => ({ code: x.code, reason: x.reason })));
        }
        SERILI.delete(durumAnahtar(ws.zoneId, ws.entityId));
        if (s.eylem) s.eylem = null;
        s.aksiyonBitis = 0;
        continue;
      }

      /* MADDE 37 - bekleyen aksiyon penceresi doldu -> istegi BASTAN isle.
         SIRA ONEMLI: once ATESLEME, sonra zaman asimi. Tutma suresi 15 000 ms
         iken ikisi asla ayni tikte dogru olmuyordu; 200 ms'lik tamponda ise
         100 ms'lik tik sik sik "pencere de kapandi, tampon da doldu" anina
         denk geliyor. Zaman asimi once bakilirsa tamponun ICINDE basilmis
         mesru istek (pencere sonuna 100-200 ms kala) haksiz yere dusuyordu -
         tamponun yarisi olu olurdu. */
      if (s.eylem) {
        const k = s.eylem;
        if (t >= k.at) {
          s.eylem = null;
          s.aksiyonBitis = 0;                    // pencere kapandi
          frame(ws, 'cast.queued', {
            state: 'started', groupId: String(k.d.groupId ?? ''),
            ...(k.q === undefined ? {} : { q: k.q }),
          });
          try { castIstek(ws, k.d, k.q); }
          catch (e) { log('beceri eylem kuyrugu hatasi: ' + e.message); }
        } else if (t >= k.bitis) {
          s.eylem = null;
          frame(ws, 'cast.queued', {
            state: 'dropped', groupId: String(k.d.groupId ?? ''), reason: 'expired',
            ...(k.q === undefined ? {} : { q: k.q }),
          });
          /* KOD DUZELTMESI (2026-09-04): burasi AKSIYON penceresi kuyrugu -
             'cok uzaktasin' ile ilgisi yok. ERR_RANGE + err.skill.queue_timeout
             MENZIL kuyrugununkiydi (o yol degismedi, asagida s.kuyruk). Dogru
             kod ERR_BUSY: istemci anahtarsiz gelen kodda kendi
             `err.ERR_BUSY` metnine duser ("Mesgul - birazdan yeniden dene.",
             tr.json'da GERCEKTEN var) ve e1() ayni anahtari 3 sn boyunca
             tekrar gostermez, yani spam basimda bildirim yagmuru olmaz. */
          hata(ws, 'ERR_BUSY', null, k.q);
        }
      }

      // 4) buff/dans suresi + upkeep (buff.upkeep / dance.pulse {intervalMs, mpPerTick})
      if (s.buff.size) {
        let degisti = false, hizDegisti = false;
        for (const [gid, b] of [...s.buff]) {
          const up = b.upkeep ?? b.skill.buff?.upkeep ?? null;
          if (up?.intervalMs > 0 && t - b.sonUpkeep >= up.intervalMs) {
            b.sonUpkeep = t;
            const bedel = up.mpPerTick ?? 0;
            if ((ch.mp ?? 0) < bedel) {
              s.buff.delete(gid); degisti = true;
              if ((b.skill.buff?.mods ?? b.skill.dance?.mods)?.moveSpeedPct != null) hizDegisti = true;
              continue;
            }
            ch.mp = Math.max(0, (ch.mp ?? 0) - bedel);
            frame(ws, 'vitals.update', { hp: Math.round(ch.hp), mp: Math.round(ch.mp) });
          }
          /* MADDE 39 - emici duvar tukendiyse buff duser (havuz 0'a inince). */
          if (b.havuzMax > 0 && b.havuz <= 0) { s.buff.delete(gid); degisti = true; continue; }
          if (!b.payload.maintained && b.payload.expiresAt <= t) {
            s.buff.delete(gid); degisti = true;
            if ((b.skill.buff?.mods ?? b.skill.dance?.mods)?.moveSpeedPct != null) hizDegisti = true;
            continue;
          }
          auraTiki(ws, b, t);
          hawkTiki(ws, b, t);
        }
        if (degisti) { buffYayinla(ws); modTazele(ws, hizDegisti); }
      }

      // 5) aksiyon kayitlari
      if (s.aksiyon.size) {
        for (const [aid, a] of [...s.aksiyon]) if (a.bitis <= t) s.aksiyon.delete(aid);
      }
    }

    /* 6) DURUM TABLOSU TIKI - MADDE 16/17.
       Eskiden burada elle "expiresAt <= t" suzgeci vardi; artik motorun tik()'i
       hem dusenleri hem DoT/MP-drain TETIKLERINI donduruyor. Tetikler DoT
       KANALIDIR; tik BASINA HASAR SAYISI ise BILEREK bos: statusApplications'ta
       adlandirilmis bir tik-hasari alani YOK (bl kayitlarinda argsRaw[3] guclu
       aday ama ISIMLENDIRILMEMIS) - motor da tuketici de sayi UYDURMAZ.
       Sayi netlestiginde tek yer degisir: motorKur({ dotHasar: ... }).
       Gercek periyodik hasar bugun `periodicAtt` kanalindan geliyor
       (kanalPulsu, 83 beceri) ve orada uydurma sayi yok. */
    for (const [k, l] of [...DURUMLAR]) {
      if (!l.length) { DURUMLAR.delete(k); continue; }
      const r = durumMotoru.tik(l, t);
      if (!l.length) DURUMLAR.delete(k);
      if (!r.degisti) continue;
      const [zoneId, idStr] = k.split('|');
      broadcast(zoneId, 'statuses.update', {
        id: Number(idStr), statuses: r.aktif,
        removed: r.dusenler.map((x) => ({ code: x.code, reason: x.reason })),
      }, null);
    }

    /* 7) suresi dolmus serilme kayitlarini birak (istemci sureyi kendi
          sayiyor - noteSelfDowned; sunucunun ayrica kare yollamasi gerekmez). */
    for (const [k, bitis] of [...SERILI]) if (bitis <= t) SERILI.delete(k);
  }

  /**
   * MADDE 39 - HASAR AURASI. `buff.damageAura {intervalMs, areaU, maxTargets,
   * flat, falloffPct}` (15 beceri, sema @8663000). Butun alanlar ADLANDIRILMIS:
   * her intervalMs'de areaU icindeki en fazla maxTargets canavara `flat` hasar;
   * birincil olmayan hedeflerde falloffPct kadar dusuk. Kare kind:'dot'.
   */
  function auraTiki(ws, b, t) {
    const a = b.skill?.buff?.damageAura;
    if (!a || !(a.intervalMs > 0)) return;
    if (t - (b.sonAura ?? 0) < a.intervalMs) return;
    b.sonAura = t;
    const ch = ws.char;
    const r2 = (a.areaU ?? 0) ** 2;
    if (!(r2 > 0)) return;
    let n = 0;
    for (const e of canavarlar(ws.zoneId)) {
      if (n >= Math.max(1, a.maxTargets ?? 1)) break;
      const dx = (e.x ?? 0) - (ch.x ?? 0), dz = (e.z ?? 0) - (ch.z ?? 0);
      if (dx * dx + dz * dz > r2) continue;
      let dmg = Math.max(0, Math.floor(a.flat ?? 0));
      if (n > 0 && (a.falloffPct ?? 0) > 0) dmg = Math.floor(dmg * Math.max(0, 1 - a.falloffPct / 100));
      n++;
      if (dmg <= 0) continue;
      const yeniHp = Math.max(0, Math.round(e.hp - dmg));
      yayin(ws, 'combat.event', {
        src: ws.entityId, dst: e.id, kind: 'dot', skillId: b.skill.id,
        dmg, crit: false, dstHp: yeniHp,
      });
      e.hp = yeniHp;
      e.hedefEntityId = ws.entityId;
      e.sonHasarAlma = t;
      yayin(ws, 'entity.hp', { id: e.id, hp: Math.round(e.hp), maxHp: Math.round(e.maxHp) });
      if (e.hp <= 0) olum(ws, e, undefined);
    }
  }

  /**
   * MADDE 39 - AV SAHINI. `buff.hawkStrike {intervalMs, flat, levelRaw}`
   * (14 beceri, sema @8662700) + combat.json pets.hawkRateH.
   * damageScale KAYNAKLI: damageScale $comment "Source kinds: player | monster |
   * pet (growth pets AND hawk strikes count as pet)" -> petVsMonster kullanilir.
   * Istemci hasar karesinde skillId'yi gorunce sahin efektini oynatiyor
   * (@27021640: `skillsById.get(skillId)?.buff?.hawkStrike && onHawkStrike(...)`)
   * - bu yuzden kare kind:'skill' gider.
   * `levelRaw`in anlami cozulemedi, UYGULANMADI.
   */
  function hawkTiki(ws, b, t) {
    const h = b.skill?.buff?.hawkStrike;
    if (!h || !(h.intervalMs > 0)) return;
    if (t - (b.sonHawk ?? 0) < h.intervalMs) return;
    b.sonHawk = t;
    const hedefId = ws.savas?.hedefId ?? ws.hedefId;
    if (hedefId == null) return;
    const e = world.varlik(ws.zoneId, hedefId);
    /* Eve donen mob HASAR ALMAZ (bkz. donusteMi). Sahin hedefi ws.savas /
       ws.hedefId'den gelir; gameloop #saldiriBasla donen mobu reddederken
       ws.savas'i null'lasa da ws.hedefId (secim) mobu isaret etmeye devam
       edebilir - bu yuzden kapi burada, kare yayinindan once. */
    if (!e || e.dead || e.kind !== 'monster' || donusteMi(e)) return;
    const oran = Number(combat.cfg.pets?.hawkRateH ?? 1) || 1;
    const olcek = combat.hasarOlcegi('pet', 'monster') / 100;
    const dmg = Math.max(combat.cfg.minDamage, Math.floor((h.flat ?? 0) * oran * olcek));
    const yeniHp = Math.max(0, Math.round(e.hp - dmg));
    yayin(ws, 'combat.event', {
      src: ws.entityId, dst: e.id, kind: 'skill', skillId: b.skill.id,
      dmg, crit: false, dstHp: yeniHp,
    });
    e.hp = yeniHp;
    e.hedefEntityId = ws.entityId;
    e.sonHasarAlma = t;
    yayin(ws, 'entity.hp', { id: e.id, hp: Math.round(e.hp), maxHp: Math.round(e.maxHp) });
    if (e.hp <= 0) olum(ws, e, undefined);
  }

  const zamanlayici = ctx.tikYok ? null : setInterval(() => {
    try { tik(); } catch (e) { log('beceri tik hatasi: ' + e.message); }
  }, TIK_MS);
  if (zamanlayici?.unref) zamanlayici.unref();

  // -------------------------------------------------------------- disa acilan
  const ORNEK = {
    /** Yonlendirici sozlesmesi: ilgilenmedigimiz mesajda false. */
    mesaj(ws, t, d, q) {
      if (!ws?.char) return false;
      switch (t) {
        case 'skill.cast':  return castIstek(ws, d ?? {}, q);
        case 'buff.cancel': return buffIptal(ws, d ?? {});
        /* MADDE 62: sentetik giris mesaji - TUKETILMEZ (false), baska
           moduller de dinliyor (bkz. giris.js ZONE_READY_DINLEYEN). */
        case 'zone.ready':  girisDurumlari(ws); return false;
        default: return false;
      }
    },
    /**
     * zone.init.self.cooldowns TOHUMU.
     * server.js selfPayload() `Object.assign(taban, modulKatkisi(['selfAlanlari',
     * 'kendiParcasi'], ch))` yapiyor - yani bu ad, karenin `cooldowns` alanini
     * SABIT [] olmaktan cikarir (server.js'e dokunmaya gerek yok).
     * NEDEN: istemci bekleme surelerini giriste/bolge gecisinde bu alandan
     * TOHUMLUYOR - paket @25080143:
     *   seedFromServer: (t,n,r) => e({ cooldowns: Object.fromEntries(
     *       (t ?? []).map(g => [g.groupId, g.readyAt])) ... })
     * Sema: `cooldowns: BJ(X({ groupId:J(), readyAt:Y() })).optional()`
     * (paket @25597300; data/schemas.json zone.init ile de dogrulandi).
     * Yollamazsak istemci tum beceri tuslarini HAZIR gosterir, sunucu ise
     * ws.bec.cd'yi tutmaya devam eder -> tusa basan oyuncu ERR_COOLDOWN yer.
     * Suresi DOLMUS kayitlar elenir (kare gereksiz sismesin).
     */
    selfAlanlari(ch) {
      if (!ch) return {};
      for (const ws of oyuncular) {
        if (ws?.char !== ch) continue;
        const t = simdi();
        const out = {};

        /* 1) cooldowns - sema `BJ(X({groupId, readyAt})).optional()` @25597300 */
        const cd = [];
        for (const [groupId, readyAt] of ws.bec?.cd ?? []) {
          if (readyAt > t) cd.push({ groupId, readyAt });
        }
        out.cooldowns = cd;

        /* 2) buffs - sema b$ @25593759
         *      { groupId, category, expiresAt, pool?, poolMax?, allyCast?, maintained? }
         * NEDEN GEREKLI: server.js selfPayload'da `buffs: []` SABIT (server.js:584)
         * ve bolge.js gecerken AYNI selfPayload'u yolluyor (bolge.js:187). Sunucu
         * buff'i uygulamaya devam ederken istemcinin buff cubugu bolge gecisinde
         * TEMIZLENIYORDU - oyuncu "buff'im kayboldu" goruyor ama sunucu hala
         * buff'li sayiyor. referans oyunda bolge devir zarfi buff'lari TASIYOR
         * (devir zarfi @25598977), yani gondermek dogru davranistir.
         * `maintained` olanlarda expiresAt 0 kalir (istemci "sonsuz" yazar,
         * expiresAt'e bakmaz - @27327500). */
        const bf = [];
        for (const b of ws.bec?.buff?.values() ?? []) {
          const p = b?.payload;
          if (!p) continue;
          if (!p.maintained && !(p.expiresAt > t)) continue;   // suresi dolmus
          bf.push({ ...p });
        }
        out.buffs = bf;

        /* 3) statuses - sema x$ @25593977 { iid, code, level, expiresAt, srcId?, skillId? }
         * Ayni gerekce: server.js:584 `statuses: []` sabiti. Bolge gecisinde
         * anahtar tasindigi icin (bolgeEsitle) yeni bolgede de bulunur. */
        /* TEL HIJYENI (md.16): kayitlar artik motorun IC alanlarini da tasiyor
           (basladi / sonTikAt / tikAraligiMs / argsRaw / magnitudePct ...).
           `...x` ile kopyalamak bunlari istemciye SIZDIRIR ve sema disi alan
           gonderir - durumlar.aktif() yalniz tel semasini (x$ @25593977)
           dondurur. */
        bolgeEsitle(ws);
        const st = durumMotoru.aktif(DURUMLAR.get(durumAnahtar(ws.zoneId, ws.entityId)) ?? [], t);
        if (st.length) out.statuses = st;

        return out;
      }
      return {};
    },

    /**
     * MADDE 62 / FARK 191 - state.delta.add + entityPayload PARCASI.
     * server.js entityPayload() `...modulKatkisi('varlikAlanlari', ch)` cagiriyor
     * (server.js:763) ve state.delta semasi (data/schemas.json) `buffs`,
     * `statuses` ve `casting` alanlarini TASIYOR. Bu kanca olmadan gorus alanina
     * giren oyuncunun buff ikonu, durum rozeti ve cast cubugu HIC gorunmuyordu.
     * Semalar: buffs -> b$ @25593759 (delta surumunde `pool/poolMax` YOK),
     *          statuses -> x$ @25593977, casting -> {groupId,castMs,remainingMs,aid?}.
     */
    varlikAlanlari(ch) {
      const ws = wsOf(ch);
      if (!ws || ws.entityId == null) return {};
      const t = simdi();
      const out = {};
      const bl = [];
      for (const b of ws.bec?.buff?.values() ?? []) {
        const p = b?.payload;
        if (!p) continue;
        if (!p.maintained && !(p.expiresAt > t)) continue;
        /* state.delta.add.buffs semasi yalniz su 5 alani tanir. */
        const k = { groupId: p.groupId, category: p.category, expiresAt: p.expiresAt };
        if (p.allyCast) k.allyCast = true;
        if (p.maintained) k.maintained = true;
        bl.push(k);
      }
      if (bl.length) out.buffs = bl;

      const st = durumMotoru.aktif(DURUMLAR.get(durumAnahtar(ws.zoneId, ws.entityId)) ?? [], t);
      if (st.length) out.statuses = st;

      const c = ws.bec?.cast;
      if (c && c.ateslemeAt > t) {
        out.casting = {
          groupId: c.groupId,
          castMs: Math.max(0, Math.round(c.skill?.castMs ?? 0)),
          remainingMs: Math.max(0, Math.round(c.ateslemeAt - t)),
          ...(c.aid != null ? { aid: c.aid } : {}),
        };
      }
      return out;
    },

    /* ================= DIS MODULLERE ACIK KANCALAR (MADDE 19 / 39 / 52) ====== */

    /**
     * MADDE 19 + 13 - HAREKET HIZI CARPANI.
     * sistem_binek-pet.js:482 bunu ZATEN cagiriyor
     * (`sistemOrnegi('beceri')?.hizCarpani?.(ws)`). `moveSpeedPct` KESIRDIR
     * (Ubt @25916200 `pct:true`, T2() `Math.round(v*100)+'%'`), veri 0.2..1.32.
     *
     * KAYNAK YOK: ayni anda birden fazla hiz buff'i varsa toplanir mi carpilir
     * mi paket soylemiyor. MAKS aliniyor (sistem_binek-pet.js'in kendi BAGLAMA
     * NOTU'nda istedigi kural) - toplama/carpma OLCULMEDEN secilmez.
     * MADDE 52: yavaslama durumlari (fb -0.5, sl -0.25) qmt() @25589973 ile
     * BIREBIR ayni carpimsal formulden gecer ve hiz buff'iyla CARPILIR.
     */
    hizCarpani(ws, t = simdi()) {
      let enYuksek = 0;
      for (const b of ws?.bec?.buff?.values?.() ?? []) {
        const m = b?.skill?.buff?.mods ?? b?.skill?.dance?.mods;
        const v = Number(m?.moveSpeedPct);
        if (Number.isFinite(v) && v > enYuksek) enYuksek = v;
      }
      const yavas = ws?.entityId != null
        ? durumMotoru.hareketCarpani(durumListe(ws.zoneId, ws.entityId), t)
        : 1;
      return (1 + enYuksek) * yavas;
    },

    /**
     * MADDE 52 - VURUS TEMPOSU CARPANI (>1 = daha yavas).
     * combat.vurusPeriyodu(ch) yalniz base-attacks reuseMs donduruyor ve durum
     * listesini OKUMUYOR; gameloop.js:555 onu ham kullaniyor. g$() @25590140
     * ile birebir formul motorda. combat.js/gameloop.js BU GRUBUN DEGIL -
     * kanca hazir, cagri taslagi raporda.
     */
    vurusTempoCarpani(ws, t = simdi()) {
      if (!ws || ws.entityId == null) return 1;
      return durumMotoru.saldiriSuresiCarpani(durumListe(ws.zoneId, ws.entityId), t);
    },

    /**
     * DELIK 2 (bulgu ALAN 1) - BECERI MESGULIYETI.
     * Oyuncunun suren bir beceri cast'i ya da acik aksiyon penceresi
     * (MADDE 37 s.aksiyonBitis) varsa true. gameloop.js #oyuncuSaldirilari
     * bu kancayla otomatik salinimi ATLAR (ws.savas'i sifirlamaz) - boylece
     * autoContinue "beceriden SONRA oto devam eder" semantigi korunur
     * (Action_AutoAttackType=1 paritesi) ve sonVurus ilerlemedigi icin
     * pencere bitince tempo kaldigi yerden dogru surer.
     */
    beceriMesgul(ws, t = simdi()) {
      const s = ws?.bec;
      return !!s && (s.cast !== null || t < (s.aksiyonBitis ?? 0));
    },

    /**
     * MADDE 18 - oyuncu/canavar YERE SERILI mi (ko/kb penceresi).
     * gameloop.js canavar YZ'si ve combat kapilari icin.
     */
    seriliMi(zoneId, entityId, t = simdi()) { return serili(zoneId, entityId, t); },

    /** MADDE 16 - bir varligin CANLI durum listesi (gameloop/combat icin). */
    durumlariniAl(zoneId, entityId, t = simdi()) {
      return durumMotoru.aktif(DURUMLAR.get(durumAnahtar(zoneId, entityId)) ?? [], t);
    },
    /** Ham liste (motor fonksiyonlarina dogrudan verilebilir). */
    durumListesi(zoneId, entityId) { return durumListe(zoneId, entityId); },
    /** Durum motorunun kendisi (tek ornek - ayar iki kez cozulmesin). */
    durumMotoru,

    /**
     * MADDE 19 - MOD'LU TURETILMIS STATLAR.
     * combat.js/gameloop.js otomatik saldiriyi `combat.turetilmis(ch)` ile
     * hesapliyor; buff modlarini gormesi icin bu kancadan gecmeli (taslak
     * raporda). Modul yoksa cagiran taraf ?. ile kendi turetilmisine duser.
     */
    turetilmisMod(ch) { return derivedMod(ch); },
    /** Tani/olcum: ham mod tablosu (duz / oran / birimi belirsiz). */
    statModlari(ws) { return modlar(ws); },

    /**
     * MADDE 39 - GELEN HASAR SUZGECI (emici kalkan / MP kalkani / duvar /
     * hasar dagitma). Sirali uygulama - hepsi ADLANDIRILMIS semadan:
     *   1) buff.absorbShell {school, pct}  -> yuzde indirim, toplam
     *      combat.json caps.absorbShellPct (90) ile sinirli.
     *      passive.absorbShell (7 kayit) ve dance.absorbShell (13) ayni sema.
     *   2) buff.damageDisperse {pct, rangeU?} -> caps.painQuotaDispersePct (100).
     *      Hasarin partiye DAGITILMASI kismi UYGULANMADI (kime, hangi oranda
     *      dagildigi pakette yok) - yalniz gelen hasardan dusulur.
     *   3) buff.mods.mpShieldPct -> combat.json mpShield $comment BIREBIR:
     *      "cut = trunc(damage * pct / 100), then mpRequest = trunc(cut * 1.5)".
     *      mpShieldPct KESIR oldugu icin pct = mpShieldPct * 100.
     *      MP yetmezse kalkan yalniz odenebilen kadarini emer.
     *   4) buff.absorbPool {hp} -> emici DUVAR havuzu; havuz azalir ve
     *      buffs.update ile TAZELENIR (pool/poolMax alanlari sema b$'te var).
     * Doner: { hasar, absorbed, mpAbsorbed } - `absorbed`/`mpAbsorbed`
     * combat.event(140) semasindaki alanlarin ta kendisi.
     */
    gelenHasarSuzgeci(ws, hamHasar, okul = 'phys') {
      const s = ws?.bec;
      const ch = ws?.char;
      let hasar = Math.max(0, Math.floor(Number(hamHasar) || 0));
      const sonuc = { hasar, absorbed: 0, mpAbsorbed: 0 };
      if (!s?.buff?.size || hasar <= 0 || !ch) return sonuc;
      const caps = combat.cfg.caps ?? {};

      // 1) absorbShell (+ pasif/dans kardesleri)
      let kalkanPct = 0;
      for (const b of s.buff.values()) {
        for (const sh of [b.skill?.buff?.absorbShell, b.skill?.dance?.absorbShell]) {
          if (!sh || !(sh.pct > 0)) continue;
          if (sh.school === 'mag' && okul !== 'mag') continue;
          if (sh.school === 'phys' && okul === 'mag') continue;
          kalkanPct += sh.pct;
        }
      }
      if (kalkanPct > 0) {
        const p = Math.min(caps.absorbShellPct ?? 100, kalkanPct);
        const kes = Math.trunc(hasar * p / 100);
        hasar -= kes; sonuc.absorbed += kes;
      }

      // 2) damageDisperse
      let dagitPct = 0;
      for (const b of s.buff.values()) {
        const dd = b.skill?.buff?.damageDisperse;
        if (dd?.pct > 0) dagitPct += dd.pct;
      }
      if (dagitPct > 0) {
        const p = Math.min(caps.painQuotaDispersePct ?? 100, dagitPct);
        const kes = Math.trunc(hasar * p / 100);
        hasar -= kes; sonuc.absorbed += kes;
      }

      // 3) mpShield
      const mps = modOran(ws, 'mpShieldPct');
      if (mps > 0 && hasar > 0) {
        const oranPct = Math.min(100, mps * 100);
        let kes = Math.trunc(hasar * oranPct / 100);
        const burn = Number(combat.cfg.mpShield?.burnRatio ?? 1) || 1;
        let istek = Math.trunc(kes * burn);
        const mevcut = Math.max(0, Math.floor(ch.mp ?? 0));
        if (istek > mevcut) { kes = Math.floor(mevcut / burn); istek = Math.trunc(kes * burn); }
        if (kes > 0) {
          ch.mp = Math.max(0, mevcut - istek);
          hasar -= kes;
          sonuc.mpAbsorbed += istek;
          sonuc.absorbed += kes;
        }
      }

      // 4) absorbPool (duvar)
      if (hasar > 0) {
        let degisti = false;
        for (const b of s.buff.values()) {
          if (!(b.havuzMax > 0) || !(b.havuz > 0) || hasar <= 0) continue;
          const kes = Math.min(b.havuz, hasar);
          b.havuz -= kes; hasar -= kes; sonuc.absorbed += kes;
          b.payload.pool = Math.max(0, Math.round(b.havuz));
          degisti = true;
        }
        if (degisti) buffYayinla(ws);
      }

      sonuc.hasar = Math.max(0, hasar);
      return sonuc;
    },

    /**
     * MADDE 39 - EMICI DUVAR HAREKET KILIDI.
     * tr.json ui.buffs.wall_title: "{name} - {pool}/{max} hasar emer. Duvar
     * ayaktayken hareket edemezsin; iptal etmek icin sag tikla."
     * Hareket server.js/gameloop.js'te - kanca hazir, cagri taslagi raporda.
     */
    hareketKilidi(ws, t = simdi()) {
      for (const b of ws?.bec?.buff?.values?.() ?? []) if (b.havuzMax > 0 && b.havuz > 0) return true;
      const l = ws?.entityId != null ? durumListe(ws.zoneId, ws.entityId) : [];
      return durumMotoru.hareketKilitli(l, t) || serili(ws.zoneId, ws.entityId, t);
    },

    /**
     * MADDE 20 - OTOMATIK SALDIRI ICIN IMBUE RIDERI.
     * gameloop.js #hasarUygula bu kancayla combat.event'e imbueDmg/imbueGroup
     * ekleyebilir (taslak raporda). Doner: {dmg, groupId} | null
     */
    imbueOnHit(ws, hedef) { return imbueVurusu(ws, hedef); },

    /** Testin ve dis dongulerin elle surebilmesi icin. */
    tik,
    dur() {
      if (zamanlayici) clearInterval(zamanlayici);
      if (ONCEKI_ORNEK === ORNEK) ONCEKI_ORNEK = null;
    },
    /** Yeniden kurulumda tiki durdurup durumu yeni ornege devreder.
     *  `isler` BILEREK devredilmez - bkz. ONCEKI_ORNEK notu. */
    _devret(yeniWorld) {
      if (zamanlayici) clearInterval(zamanlayici);
      /* Farkli bir dunya (= farkli oturum / birim testi) icin durum
         devredilmez - bkz. kur() icindeki DEVIR KAPISI notu. */
      if (!world || yeniWorld !== world) return null;
      return { DURUMLAR, oyuncular, iidSayaci, SERILI };
    },
    /** Oyuncu cikinca cagrilabilir (zorunlu degil - canli() zaten temizler). */
    unut(ws) {
      oyuncular.delete(ws);
      /* Durum tablosundaki kaydi da birak: aksi halde `${zone}|${entityId}`
         anahtari, entityId yeniden kullanilana kadar tabloda kalirdi. */
      if (ws?.entityId != null && ws.bec?.zone != null) {
        DURUMLAR.delete(durumAnahtar(ws.bec.zone, ws.entityId));
        SERILI.delete(durumAnahtar(ws.bec.zone, ws.entityId));
      }
      if (ws) ws.bec = null;
    },
    _ic: { BECERI, GRUP, DURUMLAR, SERILI, oyuncular, isler, LOT, durumMotoru },
  };
  ONCEKI_ORNEK = ORNEK;
  return ORNEK;
}

/* ===========================================================================
 * BAGLAMA NOTU  (ana oturum icin)
 * ---------------------------------------------------------------------------
 * ctx'ten KULLANILANLAR:
 *   world     - varlik(), varlikEkle(), yeniVarlikId(), olumKaydet(), groundY(),
 *               bolgeOyunculari(), zoneState (AoE taramasi), dataDir (skills.json)
 *   combat    - cfg (combat.json sabitleri), turetilmis(), oyuncuMenzili(),
 *               itemStats, odul(), xpEkle(), spEkle(), ganimet(), progress
 *   frame, broadcast, log
 *   GCFG      - tickHz (tik periyodu), lootDespawnMs, lootOwnerLockMs
 *   ITEMSTATS - silah/kalkan turu (weaponType, type, attackDistanceU)
 *   derived   - karakterin turetilmis statlari
 *   KULLANILMADI: zoneGroundY (world.groundY var), yurunebilirNokta,
 *                 envanterPayload, web, SHARD  (bu sistem DB'ye yazmiyor)
 *   ISTEGE BAGLI (varsa kullanilir): ctx.olum(zoneId, ws, mob, aid) - gameloop'un
 *                 kendi olum/odul/ganimet yolunu paylasmak icin;
 *                 ctx.gezinme (iptal), ctx.aidUret (ortak aid sayaci),
 *                 ctx.now, ctx.dataDir, ctx.tikYok (kendi tikini kapatir);
 *                 ctx.tauntUygula(zoneId, mobId, ws, taunt) +
 *                 ctx.aggroDropUygula(zoneId, ws, drop) - gameloop tehdit
 *                 motoru kancalari (atesle icindeki TEHDIT BAGLAMA blogu;
 *                 server.js sistemCtx LOOP'a tembel baglar, testlerin sahte
 *                 ctx'inde yokturlar ve blok sessizce atlanir).
 *
 * BAGLAMA:
 *   import { kur as kurBeceri } from './sistem_beceri.js';
 *   const BECERI = kurBeceri({ world: WORLDSIM, combat: COMBAT, frame, broadcast,
 *                              log, GCFG, ITEMSTATS: COMBAT.itemStats,
 *                              derived, gezinme: GEZINME, aidUret: () => LOOP.aidSayaci++ });
 *   // ws.on('message') icinde, LOOP.mesaj'dan ONCE ya da SONRA:
 *   if (BECERI.mesaj(ws, t, d, q)) return;     // <-- q'yu MUTLAKA gecir:
 *   // istemcinin err isleyicisi cancelByQ(q) yapiyor; q olmadan reddedilen
 *   // beceri istemcide "iyimser cast" olarak asili kalir (zaman asimiyla duser).
 *
 * ISLENEN MESAJLAR: skill.cast (22), buff.cancel (23)   -> digerlerinde false
 *   AYRICA sentetik `zone.ready` DINLENIR ama TUKETILMEZ (false doner):
 *   madde 62 - bolgeye giren oyuncuya mevcut durum/buff kareleri yollanir.
 * GONDERILEN KARELER: cast.start(138), cast.ok(139), cast.queued(200),
 *   cast.cancel(196), skill.fire(143), combat.event(140), entity.hp(137),
 *   buffs.update(142), statuses.update(199), vitals.update(150), combat.death(141),
 *   stats.update(146: madde 19 - mod seti degisince), entity.teleport(136:
 *   madde 40 - teleport becerisi, blink:true),
 *   progress.gainFx(206), progress.update(144), progress.levelUp(145),
 *   fx.levelUp(188), sys.notice(195: yalniz sys.progress.xp /
 *   sys.progress.level_up - ikisi de Tht enum'unda VE tr.json icinde VAR),
 *   state.delta(133), err(240).
 *
 * DIS MODULLERE ACIK KANCALAR (ORNEK uzerinde):
 *   selfAlanlari(ch)          zone.init.self: cooldowns / buffs / statuses
 *   varlikAlanlari(ch)        state.delta.add + entityPayload: buffs / statuses /
 *                             casting   [madde 62 / fark 191]
 *   hizCarpani(ws, t?)        hareket hizi carpani (buff moveSpeedPct x durum
 *                             yavaslamasi) - sistem_binek-pet.js:482 ZATEN cagiriyor
 *   vurusTempoCarpani(ws, t?) otomatik saldiri temposu carpani  [madde 52]
 *   beceriMesgul(ws, t?)      cast/aksiyon penceresi surerken true - gameloop
 *                             otomatik salinimi atlar  [bulgu ALAN 1 delik 2]
 *   turetilmisMod(ch)         buff/pasif modlu turetilmis statlar  [madde 19]
 *   statModlari(ws)           ham mod tablosu (duz / oran / birimi belirsiz)
 *   gelenHasarSuzgeci(ws,d,okul)  absorbShell -> disperse -> mpShield -> duvar
 *                             {hasar, absorbed, mpAbsorbed}       [madde 39]
 *   hareketKilidi(ws, t?)     emici duvar / cc / serilme          [madde 39/18]
 *   imbueOnHit(ws, hedef)     otomatik saldiri icin imbue rideri  [madde 20]
 *   seriliMi(zoneId, id, t?)  ko/kb penceresi                     [madde 18]
 *   durumlariniAl / durumListesi / durumMotoru                    [madde 16]
 *
 * ERR ANAHTARLARI (hepsi Eht enum'unda VE tr.json'da dogrulandi - ikisi de
 *   data/schemas.json + client/assets/locales/tr.json ile capraz kontrol edildi):
 *   err.skill.disabled, err.skill.experiment_gated, err.skill.requires_shield,
 *   err.skill.needs_ally, err.skill.queue_timeout,
 *   err.profession.tool_no_combat. Diger reddetmeler anahtarsiz gonderilir; istemci
 *   `err.${code}` fallback'ini kendisi kurar (tr.json'da err.ERR_UNKNOWN_SKILL,
 *   err.ERR_REQ_WEAPON, err.ERR_COOLDOWN, err.ERR_NO_MP, err.ERR_NO_HP,
 *   err.ERR_NOT_FOUND, err.ERR_VALIDATION, err.ERR_RANGE VAR; err.ERR_DEAD YOK).
 *
 * KALICILIK: yok. Cast/cooldown/buff durumu tamamen gecicidir (retail'de de
 *   oyle). MP/HP tuketimi ws.char uzerinden gider, onu kaydeden mevcut kod yolu
 *   (server.js) zaten var. knownSkills'i BU modul YAZMAZ - onu skill.learn (c2s 34)
 *   sistemi (sistem_stat-ustalik.js) doldurur ve zone.init.self'e `kendiParcasi`
 *   kancasiyla koyar; server.js selfPayload zaten
 *   modulKatkisi(['selfAlanlari','kendiParcasi']) cagiriyor.
 *
 * SELF ALANLARI: bu modul `selfAlanlari(ch)` ile zone.init.self icindeki UC
 *   alani uretir - `cooldowns` (paket @25080143 seedFromServer / sema
 *   @25597300), `buffs` (sema b$ @25593759) ve `statuses` (sema x$ @25593977).
 *   Ayri bir baglama gerekmez - modulKatkisi kancasi ismi kendisi buluyor
 *   (server.js:620).
 *   NEDEN UCU BIRDEN: server.js selfPayload'da bu uc alan SABIT [] idi ve
 *   bolge.js gecerken AYNI selfPayload'u yolluyor (bolge.js:187). Sunucu
 *   buff/durum/bekleme uygulamaya devam ederken istemcinin ekrani bolge
 *   gecisinde temizleniyordu. referans oyunun bolge devir zarfi ucunu de tasiyor
 *   (devir zarfi: cooldowns @25599276, buffs @25598977, statuses @25599439).
 *
 * OTURUMLAR ARASI KALICILIK: YAPILMADI ve YAPILMAMALI. Bekleme sureleri,
 *   buff'lar ve durumlar icin "cikip girince korunuyor mu" sorusunun cevabi
 *   istemci paketinden CIKARILAMIYOR (zone.init MUTLAK readyAt gonderiyor ve
 *   istemci her zone.init'te depoyu sunucudan sifirdan tohumluyor - yani iki
 *   davranis istemci tarafindan AYIRT EDILEMEZ). Kanitlanmamis bir kurali
 *   uygulamak yerine bellekte birakildi; olcum yapilirsa (skill bas -> cik ->
 *   hemen gir) burasi tek satirla kaliciya cevrilebilir.
 *
 * YENIDEN KURULUM: modul kapsamindaki ONCEKI_ORNEK (dosya basi) sayesinde
 *   sistemleriKur() eski tiki durdurur ve DURUMLAR/oyuncular devredilir.
 *   Bu olmadan tik CIFT donuyordu (buff sureleri ve upkeep MP'si iki kat
 *   hizli tukeniyordu) ve durum tablosu her ayar degisiminde siliniyordu.
 * =========================================================================== */
