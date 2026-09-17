/**
 * Savas sistemi - referans oyunun kendi combatConfig blogundan BIREBIR uygulanmistir.
 *
 * Hicbir sayi uydurulmadi. Her formulun yanina paketteki PROVENANCE etiketi
 * yazildi:
 *   measured-exact         : tum olcum noktalarini birebir veriyor
 *   measured-fit           : kucuk artikla oturuyor
 *   db-exact               : SRO_VT_SHARD'dan okunmus
 *   community-corroborated : topluluk formuluyle tutarli
 *   interim-invented       : referans oyunun kendi tasarimi (yeniden kalibre edilebilir)
 *
 * !! levelGap.slope / cap: paket "NEVER round them" diyor - kernel ile birebir
 *    ayni olsun diye tam float degerler kullaniliyor.
 */
import fs from 'node:fs';
import path from 'node:path';
/* MADDE 25 (capraz istek 40): asinma zari (esya.ASINMA - enhance.json
   durability blogu) + kirik parca kapisi (kirikMi). */
import * as esya from './esya.js';

/* PREMIUM kademe -> XP/SP ek yuzdesi. SABIT KODLU (uydurma degil):
   paket @9300246 bronze 10 / @9300566 silver 15 / @9300882 gold 20
   (blok basi @9299985 "$comment ... additive % boost to XP and SP from
   monster kills"). Ayrinti: asagida premiumBonusPct() basligi. */
const PREMIUM_XP_SP_BONUS_PCT = { bronze: 10, silver: 15, gold: 20 };

/** combat.json yoksa kullanilacak varsayilanlar (paketle ayni degerler). */
const VARSAYILAN = {
  hpMp: { perStat: 10, growthPerLevel: 1.02 },
  balance: { mBase: 28, mPerLevel: 4, capPct: 120, physStrWeight: 2, physDivisor: 3 },
  mastery: { maatPctPerLevel: 1 },
  nakedAttack: { physMinPerStr: 0.32, physMaxPerStr: 0.348, magMinPerInt: 0.32, magMaxPerInt: 0.348 },
  nakedDefense: { physPerStr: 0.19, magPerInt: 0.304 },
  hitRate: { base: 34, perLevel: 1 },
  parry: { base: 10, perLevel: 1 },
  mult: { physAnchors: [[1, 1.01], [5, 1.01], [10, 1.16], [30, 1.287], [40, 1.35]], magAnchors: [[1, 1]] },
  crit: { pctPerRating: 1, capPct: 50, physMult: 2 },
  rollShape: { softness: 100 },
  miss: { erExcessThreshold: 0, chancePerPointPct: 0, capPct: 12.5 },
  block: { schools: 'both', capPct: 60 },
  monster: { balanceFPct: 100, physMult: 1, magMult: 1 },
  minDamage: 1,
  autoAttack: { baseIntervalMs: 1600, rangeU: 2.5 },
  /* PP md.1 - kombo kesme (chain) blogu: data/combat.json ile birebir
     (kaynak: paket config/combat-config.json 106-111, 2026-09-02 paketi).
     sistem_beceri.js okur; combat.json okunamazsa da ayni davranis kalsin. */
  chain: { preemptOnCast: true, lockToleranceMs: 300, selectGraceMs: 2000 },
  /* MADDE 37 kuyrugu - bkz. data/combat.json `skillQueue` $comment. Blok
     chain ile ayni desende burada da duruyor ki combat.json okunamazsa
     davranis DEGISMESIN (aksi halde `?? 0` ile "aninda reddet"e duserdik). */
  skillQueue: { actionWindowHoldMs: 200 },
  startingStats: { str: 20, int: 20 },
  statPointsPerLevel: 3,
  regen: { hpPctPerSec: 0.005, mpPctPerSec: 0.01, outOfCombatMs: 5000 },
  knockdown: { downMs: 2500 },
  levelGap: { slope: 0.029999999329447746, cap: 0.30000001192092896, floor: 0 },
  /* DURUM (status) SABITLERI - gomulu varsayilanda EKSIKTI. data/combat.json
     ikisini de tasiyor (GERCEK/paket_veri/config/combat-config.json ile
     birebir), ama combat.json okunamazsa durum motoru sabitsiz kalirdi.
     Kaynak: istemcinin combatConfig Zod semasi
       @8656714 statusLevelGap: durationSlope .025, chanceSlope .05,
                durationFloor .5, chanceFloor .1, thresholdPerOpLevel 10
       @8657167 statusDuration: burnMsPerMargin 750, poisonMsPerMargin 1000,
                freezeMsPerMargin 97, frostbiteMsPerMargin 250,
                shockMsPerMargin 500
     (Gercek combat-config.json yalniz burn/poison'u eziyor; kalan uc deger
      sema DEFAULT'u olarak gecerli - uydurma degil.) */
  statusLevelGap: { durationSlope: 0.025, chanceSlope: 0.05, durationFloor: 0.5, chanceFloor: 0.1, thresholdPerOpLevel: 10 },
  statusDuration: { burnMsPerMargin: 750, poisonMsPerMargin: 1000, freezeMsPerMargin: 97, frostbiteMsPerMargin: 250, shockMsPerMargin: 500 },
};

/* ==================================================================== STAT RULOSU
 * PAYLASILAN cekirdek: bir esya yigininin (`variance` + `plus` + `blues`) gercek
 * statlari. AYNI kod savas, gelistirme ve kaliciligin isine yarasin diye MODUL
 * DUZEYINDE export edilir (plan maddesi 9).
 *
 * KOK HATA (duzeltilen): combat.js `variance`i 0..1 arasi bir KESIR sanip 1'e
 * kirpiyordu. Gercekte `variance` PAKETLENMIS bir tamsayidir: her nitelik GRUBU
 * icin ayri bir 5 bitlik dilim tasir. 1'den buyuk her variance 1'e kirpilinca
 * esya BUTUN niteliklerinde MAKSIMUMA sicriyordu (ornek sword01, variance=17:
 * referans oyun 69/16/24/3, biz 76/18/30/15).
 *
 * KAYNAK (istemci paketi index-BUMMQVRB.js):
 *   @25578020  ymt  - tipe gore nitelik grubu dizilimi (asagidaki NITELIK_GRUPLARI)
 *   @25578832  bmt  - tamsayiya kirpilan stat kumesi
 *   @25578921  xmt  = (v, i) => Math.floor(v / 2 ** (i * 5)) % 32
 *   @25579560  m$   = (v, pct) => pct === 0 ? v : Math.max(1, v + trunc(v*pct/100))
 *   @25579200  Tmt  - mavi (blues) satirlarin toplanmasi
 *   @25580034  Emt  - kesir = xmt(variance, grup)/31; deger = min+(max-min)*kesir
 *                     ( +perPlus*plus; bmt kumesinde Math.trunc )
 *   @25594875  S$   - `variance: Y().int().nonnegative()` (tam sayi, ust sinir yok)
 */

/** ymt (@25578020) - variance icindeki 5 bitlik yuvalarin tipe gore sirasi. */
export const NITELIK_GRUPLARI = {
  weapon: [['durability'], ['physReinforceMinPct', 'physReinforceMaxPct'],
    ['magReinforceMinPct', 'magReinforceMaxPct'], ['attackRate'],
    ['physAtkMin', 'physAtkMax'], ['magAtkMin', 'magAtkMax'], ['critRating']],
  armor: [['durability'], ['physReinforcePct'], ['magReinforcePct'],
    ['physDef'], ['magDef'], ['parryRatio']],
  shield: [['durability'], ['physReinforcePct'], ['magReinforcePct'],
    ['blockRatio'], ['physDef'], ['magDef']],
  accessory: [['physAbsorb'], ['magAbsorb']],
};

/** bmt (@25578832) - bu bes stat TAMSAYIYA kirpilir; digerleri kesirli kalir. */
export const TAMSAYI_STATLAR = new Set([
  'durability', 'attackRate', 'critRating', 'blockRatio', 'parryRatio',
]);

/** xmt (@25578921) - variance icindeki `yuva` numarali 5 bitlik nitelik (0..31). */
export const nitelikOku = (variance, yuva) => Math.floor(variance / 2 ** (yuva * 5)) % 32;

/** xmt'nin TERSI - tek bir 5 bitlik yuvayi yazar, digerlerine DOKUNMAZ.
 *  sistem_gelistirme.js'te yerel kopyasi vardi (ozumseme beyaz-yeniden-zari);
 *  varyansUret() de ayni islemi yaptigi icin formul buraya, nitelikOku'nun
 *  yanina alindi - iki kural birbirinden ayrilmasin. */
export const nitelikYaz = (variance, yuva, yeni) => {
  const carpan = 2 ** (yuva * 5);
  return variance - nitelikOku(variance, yuva) * carpan + (yeni % 32) * carpan;
};

/**
 * DUSEN EKIPMANIN VARYANSI (ekran goruntusundeki "(+%0)" satirlarinin kaynagi).
 *
 * SORUN (olculdu, GERCEK/bulgu_suzulme_blue_2026-09-04.json SERIT B): dusen her
 * esya variance=0 ile uretiliyordu, yani ALTI nitelik grubunun ALTISI da aralik
 * ALT SINIRINDA cikiyordu (heavy01_boots_bronze: dayaniklilik 50/50, fiz.sav 3,
 * buy.sav 4, %4.1, %5.4, savusturma 5 = rollRanges'in tam minimumlari).
 *
 * KURAL: her nitelik GRUBU KENDI 5 bitlik zarini atar (istemcinin Emt/xmt
 * formulu: kesir = nitelikOku(variance, grup)/31). Grup SAYISI ve 0..31 siniri
 * VERIDEN gelir (NITELIK_GRUPLARI = paket ymt @25578020); uydurulan tek sey
 * DAGILIM'dir ve duzgun (uniform) secildi - hicbir yone egilim eklemeyen tek
 * secim, ve deponun kendi onculu ile ayni: sistem_gelistirme.js ozumseme
 * beyaz-yeniden-zari da `nitelikYaz(variance, yuva, zarInt(32))` kullaniyor.
 * BASLANGIC/DUKKAN esyasi bu yoldan GECMEZ (canli yakalamada variance=0).
 */
export function varyansUret(def, zar = Math.random) {
  const gruplar = NITELIK_GRUPLARI[def?.type];
  if (!gruplar) return 0;                       // tuketilebilir/avatar: alan yok
  let v = 0;
  for (let g = 0; g < gruplar.length; g++) v = nitelikYaz(v, g, Math.floor(zar() * 32));
  return v;
}

/** m$ (@25579560) - yuzde binicisi; 0'da deger DEGISMEZ, aksi halde en az 1. */
export const yuzdeBin = (v, pct) => (pct === 0 ? v : Math.max(1, v + Math.trunc(v * pct / 100)));

/* wmt (@25579196) - duz mavi statlarin istemcideki alan adlari.
   tr.json bunlari "{n} artisi" (DUZ) diye yazar: ui.tooltip.blue_str/int/hp/mp.
   Buna karsilik hr/er/bu/es/fz/ps/zb "%{n} artisi" (YUZDE) - iki grup ayri. */
const MAVI_DUZ = { str: 'strFlat', int: 'intFlat', hp: 'hpFlat', mp: 'mpFlat' };

/* magic-opts.json `effect` -> turetilmis semadaki statusResists alani.
   fz = MATTR_RESIST_FROSTBITE (tr.json: "Soguk isirmasi direnci") -> `fb`
   (durum kodu enum'unda fz=freeze, fb=frostbite; katalog ADI belirleyici). */
const MAVI_DURUM = { fz: 'fb', es: 'es', bu: 'bu', ps: 'ps', zb: 'zb' };

/**
 * Emt (@25580034) - bir esya yigininin roll'lanmis statlari + mavi katkilari.
 *
 * @param def          itemstats.json kaydi (rollRanges / perPlus / type)
 * @param yigin        envanter/kusam yigini: string id ya da {variance, plus, blues}
 * @param maviKatalog  Map<optId, {effect}> (data/gelistirme/magic-opts.json) - yoksa
 *                     mavi satirlar yok sayilir (beyaz esya davranisi)
 * @returns { statlar, strFlat, intFlat, hpFlat, mpFlat, durumDirenci }
 */
export function statRulo(def, yigin, maviKatalog = null) {
  const cikti = {
    statlar: {}, strFlat: 0, intFlat: 0, hpFlat: 0, mpFlat: 0,
    durumDirenci: { fb: 0, es: 0, bu: 0, ps: 0, zb: 0 },
  };
  if (!def?.rollRanges) return cikti;

  const nesne = (yigin && typeof yigin === 'object') ? yigin : null;
  const variance = Math.max(0, Number(nesne?.variance) || 0);
  const arti = Math.max(0, Number(nesne?.plus) || 0);
  const statlar = cikti.statlar;

  const yaz = (ad, kesir) => {
    const a = def.rollRanges[ad];
    if (!Array.isArray(a)) return;
    const [mn, mx] = a;
    const ham = mn + (mx - mn) * kesir;
    const pp = def.perPlus?.[ad] ?? 0;
    statlar[ad] = TAMSAYI_STATLAR.has(ad)
      ? Math.trunc(ham + Math.trunc(pp * arti))
      : ham + pp * arti;
  };

  const gruplar = NITELIK_GRUPLARI[def.type];
  if (gruplar) {
    for (let g = 0; g < gruplar.length; g++) {
      const kesir = nitelikOku(variance, g) / 31;
      for (const ad of gruplar[g]) yaz(ad, kesir);
    }
  } else {
    /* ymt'de olmayan tip (avatar / tuketilebilir ...). Istemcinin Emt'si boyle bir
       tipte zaten calismaz; variance UYGULANMAZ (kesir 0 = taban deger). */
    for (const ad of Object.keys(def.rollRanges)) yaz(ad, 0);
  }

  const mavilar = Array.isArray(nesne?.blues) ? nesne.blues : [];
  if (mavilar.length && maviKatalog?.size) {
    let durPct = 0, hrPct = 0, erPct = 0;
    for (const b of mavilar) {
      const opt = maviKatalog.get(Number(b?.id));
      if (!opt) continue;
      const v = Number(b?.value) || 0;
      const duzAd = MAVI_DUZ[opt.effect];
      if (duzAd) { cikti[duzAd] += v; continue; }
      const durAd = MAVI_DURUM[opt.effect];
      if (durAd) { cikti.durumDirenci[durAd] += v; continue; }
      switch (opt.effect) {
        case 'duru': durPct += v; break;              // MATTR_DUR
        case 'dura': durPct -= v; break;              // MATTR_DEC_MAXDUR
        case 'hr': hrPct += v; break;                 // MATTR_HR
        case 'er': erPct += v; break;                 // MATTR_ER
        /* cri/bri Emt'de YOK (istemci onlari tooltipte ayri satir olarak yazar:
           ui.tooltip.blue_generic = "{name} +{n}", yani DUZ eklemedir). Turetilmis
           semada karsiliklari var, o yuzden sunucu tarafinda eklenir. */
        case 'cri': statlar.critRating = (statlar.critRating ?? 0) + v; break;
        case 'bri': statlar.blockRatio = (statlar.blockRatio ?? 0) + v; break;
        default: break;   // luck/astr/ape/... = sayac satirlari, stat degil
      }
    }
    // Emt'nin son adimi: yuzde biniciler yalniz bu uc statta.
    if (statlar.durability !== undefined) statlar.durability = yuzdeBin(statlar.durability, durPct);
    if (statlar.attackRate !== undefined) statlar.attackRate = yuzdeBin(statlar.attackRate, hrPct);
    if (statlar.parryRatio !== undefined) statlar.parryRatio = yuzdeBin(statlar.parryRatio, erPct);
  }
  return cikti;
}

export class Combat {
  constructor({ dataDir, world, log }) {
    this.world = world;
    this.log = log ?? (() => {});

    const c = this.#oku(path.join(dataDir, 'combat.json'));
    this.cfg = { ...VARSAYILAN, ...(c?.combatConfig ?? {}) };
    /* Yayilim (spread) bir blogu KOMPLE degistirir; istemcinin Zod semasi ise
       DEFAULT'lari ALAN BAZINDA uygular. Gercek combat-config.json'da
       statusDuration yalniz burn/poison tasiyor (@8657167'deki freeze 97 /
       frostbite 250 / shock 500 sema varsayilaninda kaliyor) - bu iki blokta
       eksik alanlari varsayilandan tamamla ki referansla ayni degerler cikssin. */
    for (const blok of ['statusLevelGap', 'statusDuration']) {
      this.cfg[blok] = { ...VARSAYILAN[blok], ...(this.cfg[blok] ?? {}) };
    }
    this.kaynak = c?.combatConfig ? 'combat.json' : 'gomulu varsayilan';
    this.log(`savas sabitleri: ${this.kaynak}`);

    const ham = this.#oku(path.join(dataDir, 'progress.json'));
    this.progress = ham ? this.#ilerlemeNormalize(ham) : null;

    /* ESYA STAT KATALOGU - referans oyunun kendi verisi.
       Istemci paketinde `Qst = JSON.parse(...)` olarak gomulu; 2860 esya,
       her birinde rollRanges (stat -> [min, max]) ve perPlus. Bunu HIC
       okumuyorduk, bu yuzden C ekranindaki tum degerler CIPLAK tabandi:
       Fiz. saldiri 6-6 gorunuyordu, referans oyunda ayni sette 21.12-22.84.
       Dogrulama (canli yakalama, Test21 seviye 1, variance 0):
         physDef  14.9  = 3.8  (STR*0.19) + 11.1 (ekipman)
         magDef   28.68 = 6.08 (INT*0.304) + 22.6
         parry    34    = 11   (10+seviye) + 23
         blockRatio 10 ve critRating 3 -> TAMAMEN ekipmandan. */
    this.itemStats = new Map();
    try {
      const ip = path.join(dataDir, 'itemstats.json');
      if (fs.existsSync(ip)) {
        for (const it of JSON.parse(fs.readFileSync(ip, 'utf8'))) this.itemStats.set(it.id, it);
        this.log(`esya stat katalogu: ${this.itemStats.size} esya`);
      } else this.log('itemstats.json yok - ekipman statlari uygulanmayacak');
    } catch (e) { this.log('itemstats okunamadi: ' + e.message.slice(0, 80)); }

    /* MAVI SECENEK (blues / magic options) KATALOGU - data/gelistirme/magic-opts.json
       (paket_veri/magic-opts.json, 416 satir). `blues` kelimesi combat.js'te HIC
       gecmiyordu: mavi statli esya ile beyaz esya savasta BIREBIR AYNIYDI.
       Katalog SALT OKUNUR kullanilir; id -> {effect} esleme yeter. */
    this.maviKatalog = new Map();
    try {
      const mp = path.join(dataDir, 'gelistirme', 'magic-opts.json');
      if (fs.existsSync(mp)) {
        const ham = JSON.parse(fs.readFileSync(mp, 'utf8'));
        for (const o of (ham.opts ?? [])) {
          if (o && Number.isFinite(Number(o.id))) {
            this.maviKatalog.set(Number(o.id), { effect: o.effect, name: o.name });
          }
        }
        this.log(`mavi secenek katalogu: ${this.maviKatalog.size} satir`);
      } else this.log('magic-opts.json yok - mavi statlar uygulanmayacak');
    } catch (e) { this.log('magic-opts okunamadi: ' + e.message.slice(0, 80)); }

    /* SILAH -> USTALIK HATTI. combat-config `mastery` yorumu: taban saldiri satiri
       getv(MAAT) tasiyorsa hasar 1+q/100 ile olcekleniyor; q = KARAKTERIN o ustalik
       seviyesi. Silahin hangi ustaliga ait oldugu itemstats'ta YOK (reqMastery
       yalniz zirhta var), ama skills.json her beceride `mastery` + `reqWeapons`
       tasiyor ve esleme 1:1 cikiyor (sword/blade->bicheon, spear/glavie->heuksal,
       bow->pacheon, eu_sword/eu_tsword/eu_axe->warrior, eu_tstaff->wizard,
       eu_dagger/eu_crossbow->rogue, eu_darkstaff->warlock, eu_harp->bard,
       eu_staff->cleric). Tablo VERIDEN kuruluyor - uydurma yok. */
    this.silahUstaligi = new Map();
    try {
      const sp = path.join(dataDir, 'skills.json');
      if (fs.existsSync(sp)) {
        const ham = JSON.parse(fs.readFileSync(sp, 'utf8'));
        const liste = Array.isArray(ham) ? ham : (ham.skills ?? []);
        for (const s of liste) {
          if (!s?.mastery || !Array.isArray(s.reqWeapons)) continue;
          for (const w of s.reqWeapons) if (!this.silahUstaligi.has(w)) this.silahUstaligi.set(w, s.mastery);
        }
        this.log(`silah->ustalik: ${this.silahUstaligi.size} silah turu`);
      }
    } catch (e) { this.log('skills.json (ustalik eslemesi) okunamadi: ' + e.message.slice(0, 80)); }

    /* MESLEK ALETLERI (oduncu baltasi / madenci kazmasi).
       Paket @8693535:  lY = { profession_axe: `lumberjack`,
                               profession_pickaxe: `miner` }
                        function uY(e) { return e in lY }
       Bu iki esya ITEMSTATS (paketteki Qst) katalogunda YOK - yalnizca
       extra-items.json'da; sistem_meslek.js:82 de ayni notu dusuyor. Savas
       kapisi (err.profession.tool_no_combat) bu yuzden ayri bir kume tutar,
       yoksa kapi hic tetiklenmez. */
    this.aletSilahTurleri = new Set(['profession_axe', 'profession_pickaxe']);
    this.meslekAletleri = new Set();
    for (const dosya of ['extra-items.json', 'items.json']) {
      try {
        const p = path.join(dataDir, dosya);
        if (!fs.existsSync(p)) continue;
        const ham = JSON.parse(fs.readFileSync(p, 'utf8'));
        const liste = Array.isArray(ham) ? ham : (ham.items ?? Object.values(ham));
        for (const it of liste) {
          if (it && this.aletSilahTurleri.has(it.weaponType)) this.meslekAletleri.add(it.id);
        }
      } catch (e) { this.log(`${dosya} okunamadi: ` + e.message.slice(0, 60)); }
    }
    if (this.meslekAletleri.size) this.log(`meslek aleti: ${this.meslekAletleri.size} esya`);

    /* TABAN SALDIRILAR - paketteki base-attacks.json.
       Otomatik saldirinin OKULU, katsayisi, vurus sayisi ve temposu SILAHA gore
       degisir; combat.json'daki autoAttack.baseIntervalMs "legacy fallback only"
       diye isaretli. Ornekler:
         base_ch_sword     phys  coef 60  hits 2  reuse 1200
         base_eu_tstaff    MAG   coef 180 hits 1  reuse 1666
         base_punch        phys  coef 150 hits 1  reuse 1500
       Asalarin physAtk'i [0,0] oldugu icin fiziksel hesaplayinca hasar 0 cikip
       minimuma dusuyordu - "1 1" hasar sorunu buydu. */
    /* Sunucu oranlari (xpRate/spRate/goldRate) - paketteki config/game-config.json. */
    this.oranlar = {};
    try {
      const gp = path.join(dataDir, 'game-config.json');
      if (fs.existsSync(gp)) {
        const g = JSON.parse(fs.readFileSync(gp, 'utf8'));
        /* itemDropRate/sealXRate de okunuyor. Bunlar ganimet() icin YEDEK
           kaynaktir - canli deger world.gcfg referansindan gelir (asagida
           pismisOranlar blogunun aciklamasi). MUHUR KADEMELERI AYRISTI:
           sealStarRate (_A_RARE/bronz) + sealMoonRate (_B_RARE/gumus) +
           sealSunRate (_C_RARE/altin) - eski tek rareDropRate anahtarina
           geri-dusus, eski game-config/sunucu-ayarlari dosyalari bozulmasin
           diye BILEREK korunur. goldRate BILEREK ganimete uygulanmiyor:
           drops.json $oranNasilUygulandi "GoldMin/GoldMax ile carpildi" -
           tablo degerleri zaten pismis, ikinci carpim cifte sayim olurdu. */
        this.oranlar = {
          xpRate: g.xpRate ?? 1, spRate: g.spRate ?? 1, goldRate: g.goldRate ?? 1,
          itemDropRate: g.itemDropRate ?? 1,
          sealStarRate: g.sealStarRate ?? g.rareDropRate ?? 1,
          sealMoonRate: g.sealMoonRate ?? g.rareDropRate ?? 1,
          sealSunRate: g.sealSunRate ?? g.rareDropRate ?? 1,
        };
        /* ACILIS LOGU BURADA BASILMAZ - BILEREK (eskiden basiliyordu ve
           YALAN SOYLUYORDU). Kok neden bir SIRA meselesiydi: server.js once
           `new Combat(...)` kurar, `createAdmin(...)` ONDAN SONRA calisir ve
           tazele() data/sunucu-ayarlari.json farklarini CALISAN GCFG nesnesine
           yazar. Dusus aninda ganimet() o canli GCFG'yi (world.gcfg) okudugu
           icin DAVRANIS dogruydu; log ise kurulus anindaki game-config.json
           anlik goruntusunu basiyordu. Olculen tuzak: sunucu-ayarlari.json'da
           sealMoonRate=6 varken log "gumus x1" diyor, ama 40000 olumde gumus
           1/68 dusuyordu (carpan 1 olsa 1/449 olurdu) - yani 6x GERCEKTEN
           uygulaniyordu. Operator panelden yaptigi degisikligin islemedigini
           saniyordu.
           Cozum iki katmanli: (1) tek dogruluk kaynagi etkinOranlar() - hem
           ganimet() carpanlari hem odul() xp/sp hem de log AYNI cozumlemeden
           gecer, bir daha ayrisamazlar; (2) log server.js'te
           createAdmin(...)'DAN SONRA COMBAT.oranlariLogla() ile basilir. */
      }
    } catch { /* varsayilan 1 */ }

    /* PISMIS ORANLAR - data/drops.json `$oranlar`. gen_drops2.mjs tablo
       sanslarini uretirken oranlari ICINE isledi ($oranNasilUygulandi:
       itemDropRate "rare OLMAYAN tum sanslarla carpildi", rareDropRate
       "sadece _RefDropClassSel_RareEquip sanslariyla"). Calisma zamaninda
       uygulanacak carpan = canliOran / pismisOran; ikisi ayniyken (bugun
       1/1) tam no-op, admin paneli orani degistirince fark aninda yansir. */
    this.pismisOranlar = null;
    /* +N SEVIYE MERDIVENI - data/drops.json `$optLevelSel` (_RefDropOptLvlSel,
       13 satir, Prob KUMULATIF). vSRO'da bu tablo "kac mavi" degil, DUSEN
       ESYANIN +N SEVIYESIDIR (klonun eslemesi de ayni: kalicilik.js:29
       plus -> _Items.OptLevel). Marjinal olasiliklar: +0 %88.333, +1 %8.333,
       +2 %2.381, +3 %0.680, +4 %0.194, +5 %0.0555 ... +10 %0.0001.
       Veri bugune kadar HIC okunmuyordu (drops.json $not: "HENUZ
       UYGULANMIYOR"); plusUret() asagida bu satirlari kullanir. */
    this.optLevelSel = null;
    try {
      const dp = path.join(dataDir, 'drops.json');
      if (fs.existsSync(dp)) {
        const dj = JSON.parse(fs.readFileSync(dp, 'utf8'));
        this.pismisOranlar = dj?.['$oranlar'] ?? null;
        const satirlar = dj?.['$optLevelSel']?.satirlar;
        if (Array.isArray(satirlar) && satirlar.length) {
          this.optLevelSel = satirlar
            .map((r) => ({
              optLevel: Math.max(0, Math.trunc(Number(r?.optLevel) || 0)),
              kumulatifProb: Number(r?.kumulatifProb),
              gerekenCevrimiciDk: Math.max(0, Number(r?.gerekenCevrimiciDk) || 0),
            }))
            .filter((r) => Number.isFinite(r.kumulatifProb))
            .sort((a, b) => a.optLevel - b.optLevel);
          this.log(`dusus +N merdiveni: ${this.optLevelSel.length} satir ($optLevelSel)`);
        }
      }
    } catch (e) { this.log('drops.json ($oranlar/$optLevelSel) okunamadi: ' + e.message.slice(0, 80)); }

    this.tabanSaldirilar = new Map();   // weaponType -> kayit
    this.tabanYumruk = null;
    try {
      const bp = path.join(dataDir, 'base-attacks.json');
      if (fs.existsSync(bp)) {
        for (const a of JSON.parse(fs.readFileSync(bp, 'utf8')).attacks ?? []) {
          for (const w of a.weapons ?? []) {
            if (w === 'unarmed') this.tabanYumruk = a;
            this.tabanSaldirilar.set(w, a);
          }
        }
        this.log(`taban saldiri: ${this.tabanSaldirilar.size} silah turu`);
      } else this.log('base-attacks.json yok - saldiri okulu/katsayisi uygulanamayacak');
    } catch (e) { this.log('base-attacks okunamadi: ' + e.message.slice(0, 80)); }
    if (this.progress) {
      this.log(`ilerleme: ${Object.keys(this.progress.xpToNext).length} seviye, ` +
               `maxLevel=${this.progress.maxLevel}, ${this.progress.spExpPerSpPoint} spExp/SP`);
    } else {
      this.log('progress.json yok - seviye atlama devre disi');
    }
  }

  /**
   * progress.json tablolari { $comment, $kaynak, $adet, table:{...} } seklinde
   * meta ile sarili geliyor. Duz haritaya cevir; ileride bicim degisirse
   * her iki sekli de kabul et.
   */
  #ilerlemeNormalize(p) {
    const duz = (v) => (v && typeof v === 'object' && v.table) ? v.table : (v ?? {});
    const sab = p.sabitler ?? {};
    return {
      xpToNext: duz(p.xpToNext),
      spCostToLevel: duz(p.spCostToLevel),
      spExpByMonsterLevel: duz(p.spExpByMonsterLevel),
      maxLevel: Number(sab.maxLevel ?? 80),
      statPointsPerLevel: Number(sab.statPointsPerLevel ?? 3),
      spExpPerSpPoint: Number(p.spExpByMonsterLevel?.spExpPerSpPoint ?? sab.spExpPerSpPoint ?? 400),
      sabitler: sab,
    };
  }

  #oku(p) {
    if (!fs.existsSync(p)) return null;
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) {
      this.log(`veri bozuk ${path.basename(p)}: ${e.message.slice(0, 80)}`);
      return null;
    }
  }

  // ================================================================ turetilmis
  /**
   * Istemcinin `rht` semasinin tamami.
   * HP/MP  : floor(STAT * perStat * growth^(L-1))          [measured-exact]
   * PD/MD  : STR*0.19 / INT*0.304, seviyeden BAGIMSIZ      [measured-fit 13/13]
   * atak   : STR*0.32 .. STR*0.348 (ciplak)                [measured-fit]
   * HR     : 34 + L, Parry: 10 + L                          [measured-exact]
   * denge  : M = mBase + mPerLevel*L
   *          phys% = 100*(1 + physStrWeight*STR/M) / physDivisor
   *          mag%  = 100*INT/M            ikisi de capPct ile sinirli
   */
  turetilmis(ch) {
    const c = this.cfg;
    const L = Math.max(1, ch.level ?? 1);

    /* EKIPMAN TOPLAMI TEK GECISTE: stat toplami (ek), mavi DUZ statlar (duz) ve
       mavi durum dirençleri (durum) ayni dolasimdan cikar - blues'un STR/INT'i
       degistirmesi HP/MP ve savunma hesabindan ONCE bilinmek zorunda. */
    const top = this.#ekipmanToplami(ch.equip);
    const ek = top.ek;

    /* Mavi `str`/`int` satirlari (MATTR_STR / MATTR_INT, tr.json
       ui.tooltip.blue_str = "Guc {n} artisi") DUZ stat eklemesidir. */
    const STR = (ch.str ?? c.startingStats.str) + top.duz.strFlat;
    const INT = (ch.int ?? c.startingStats.int) + top.duz.intFlat;

    const buyume = Math.pow(c.hpMp.growthPerLevel, L - 1);
    /* Mavi `hp`/`mp` (MATTR_HP / MATTR_MP) da duz eklemedir; buyume egrisiyle
       CARPILMAZ, taban HP/MP tamsayiya inildikten sonra eklenir. */
    const maxHp = Math.floor(STR * c.hpMp.perStat * buyume) + Math.trunc(top.duz.hpFlat);
    const maxMp = Math.floor(INT * c.hpMp.perStat * buyume) + Math.trunc(top.duz.mpFlat);

    const M = c.balance.mBase + c.balance.mPerLevel * L;
    const physBal = Math.min(c.balance.capPct,
      (100 * (1 + c.balance.physStrWeight * STR / M)) / c.balance.physDivisor);
    const magBal = Math.min(c.balance.capPct, (100 * INT) / M);

    /* SALDIRI: silah varsa CIPLAK taban KULLANILMAZ - silahin kendi taban
       degeri + stat * silahin "reinforce" yuzdesi geciyor. Canli referans oyun
       (Test21, seviye 1, STR/INT 20, sword01 variance 0) ile birebir:
         physAtkMin = 15 + 20*0.306 = 21.12
         physAtkMax = 16 + 20*0.342 = 22.84
         magAtkMin  = 25 + 20*0.519 = 35.38
         magAtkMax  = 28 + 20*0.591 = 39.82
       Silah yoksa ciplak formule dusulur. */
    const sil = this.#silahStatlari(ch.equip);

    /* Silah KATKI VERMEDIGI okulda CIPLAK EL degeri gecerli kalir.
       Olcum (canli referans oyun, Test41 - 1. sv Avrupali buyucu, eu_tstaff):
         Buy. saldiri 41-51 (asadan)     -> bizimkiyle birebir
         Fiz. saldiri 6-6   (CIPLAK EL)  -> asanin physAtk'i [0,0] oldugu HALDE
       Yani asa fiziksel saldiriyi SIFIRLAMIYOR, sadece katki vermiyor. */
    const silahP = !!sil && (sil.physAtkMin > 0 || sil.physAtkMax > 0
                          || sil.physReinforceMinPct > 0 || sil.physReinforceMaxPct > 0);
    const silahM = !!sil && (sil.magAtkMin > 0 || sil.magAtkMax > 0
                          || sil.magReinforceMinPct > 0 || sil.magReinforceMaxPct > 0);

    const pMin = silahP ? sil.physAtkMin + STR * sil.physReinforceMinPct / 100
                        : STR * c.nakedAttack.physMinPerStr;
    const pMax = silahP ? sil.physAtkMax + STR * sil.physReinforceMaxPct / 100
                        : STR * c.nakedAttack.physMaxPerStr;
    const mMin = silahM ? sil.magAtkMin + INT * sil.magReinforceMinPct / 100
                        : INT * c.nakedAttack.magMinPerInt;
    const mMax = silahM ? sil.magAtkMax + INT * sil.magReinforceMaxPct / 100
                        : INT * c.nakedAttack.magMaxPerInt;

    /* YUVARLAMA YOK. Canli referans oyun physDef olarak 14.900000000000002
       gonderiyor - yani ondalik korunuyor; C ekrani SADECE GORUNTULERKEN
       yuvarliyor (14.9 -> "15"). Eskiden burada floor vardi ve ciplak
       tabani 3.8 -> 3 yapiyordu. */
    const t = (taban, ad) => Math.max(0, taban + (ek[ad] ?? 0));

    return {
      maxHp, maxMp,
      // saldiri zaten silahi iceriyor - ekipman toplamindan TEKRAR eklenmez
      physAtkMin: Math.max(0, pMin), physAtkMax: Math.max(0, pMax),
      magAtkMin: Math.max(0, mMin), magAtkMax: Math.max(0, mMax),
      physAtkIncPct: 0, magAtkIncPct: 0, dmgIncPct: 0,
      physDef: t(STR * c.nakedDefense.physPerStr, 'physDef'),
      magDef: t(INT * c.nakedDefense.magPerInt, 'magDef'),
      physBalancePct: +physBal.toFixed(2), magBalancePct: +magBal.toFixed(2),
      hitRatio: c.hitRate.base + c.hitRate.perLevel * L,
      parryRatio: t(c.parry.base + c.parry.perLevel * L, 'parryRatio'),
      blockRatio: ek.blockRatio ?? 0,
      critRating: ek.critRating ?? 0,
      /* physAbsorb / magAbsorb SABIT 0 yaziliydi, oysa #ekipmanToplami ikisini de
         ZATEN topluyordu: 288 aksesuarin (kupe/kolye/yuzuk) tek stat'i budur ve
         hem C ekraninda hem tooltipte 0 gorunuyordu. Semada zorunlu alan
         (paket rht @25594400 `physAbsorb: Y()`), accessory grup dizilimi
         ymt @25578020 = [['physAbsorb'],['magAbsorb']], veri
         data/itemstats.json (ring01 [0.2,0.3], perPlus 0.23).
         NOT: emilimin HASARA nasil uygulandigi pakette YOK (tooltipte % isareti
         de yok, combat.event `absorbed` alani ise tamsayi) - bu yuzden burada
         yalnizca DOGRU DEGER BILDIRILIR, hasar hesabina karistirilmaz. */
      physAbsorb: ek.physAbsorb ?? 0,
      magAbsorb: ek.magAbsorb ?? 0,
      mpDiscountPct: 0,
      /* statusResists de sabit 0'di. magic-opts.json'daki
         MATTR_RESIST_FROSTBITE/ESHOCK/BURN/POISON/ZOMBIE satirlari (fz/es/bu/ps/zb,
         her biri 12 seviye) turetilmis semadaki {fb,es,bu,ps,zb} alanlarinin ta
         kendisi (paket @25594580). Deger tr.json'a gore YUZDEDIR
         ("ui.tooltip.blue_bu = Yanma direnci %{n} artisi"); nasil tuketilecegi
         durum motorunun isi. */
      statusResists: { ...top.durum },
    };
  }

  /**
   * Giyili silahin TABAN SALDIRISI (base-attacks.json kaydi).
   * Silah yoksa yumruk (base_punch) doner.
   */
  tabanSaldiri(ch) {
    const v = ch?.equip?.weapon;
    if (v && this.itemStats?.size) {
      const id = typeof v === 'string' ? v : v.itemId;
      const def = this.itemStats.get(id);
      const t = def?.weaponType;
      if (t && this.tabanSaldirilar.has(t)) return this.tabanSaldirilar.get(t);
    }
    return this.tabanYumruk;
  }

  /**
   * Giyili silahin roll'lanmis statlari (yoksa null).
   * Rulo artik PAYLASILAN statRulo() ile yapilir - variance 5 bitlik paketli
   * tamsayidir, 0..1 kesir DEGILDIR (bkz. dosya basindaki STAT RULOSU blogu).
   */
  #silahStatlari(equip) {
    const v = equip?.weapon;
    if (!v || !this.itemStats?.size) return null;
    /* MADDE 25: dayanikliligi 0 olan silah saldiri stati vermez
       (enhance.json $comment, paket @8753065: "at 0 the piece contributes
       no stats until repaired"). */
    if (esya.kirikMi(v)) return null;
    const itemId = typeof v === 'string' ? v : v.itemId;
    const def = this.itemStats.get(itemId);
    if (!def?.rollRanges) return null;
    const s = statRulo(def, v, this.maviKatalog).statlar;
    const al = (ad) => Number(s[ad]) || 0;
    return {
      physAtkMin: al('physAtkMin'), physAtkMax: al('physAtkMax'),
      magAtkMin: al('magAtkMin'), magAtkMax: al('magAtkMax'),
      physReinforceMinPct: al('physReinforceMinPct'), physReinforceMaxPct: al('physReinforceMaxPct'),
      magReinforceMinPct: al('magReinforceMinPct'), magReinforceMaxPct: al('magReinforceMaxPct'),
    };
  }

  /**
   * Giyili esyalarin TEK GECISTE toplami.
   *
   * Her esyada `rollRanges: { stat: [min, max] }` var; gercek deger esyanin
   * PAKETLENMIS `variance` tamsayisindan grup grup cozulur (statRulo). `plus`
   * varsa `perPlus[stat]` kadar eklenir. `durability` stat degildir, atlanir.
   *
   * @returns {{ ek:Object, duz:{strFlat,intFlat,hpFlat,mpFlat}, durum:Object }}
   *   ek    - turetilmis stat toplami (physDef/magDef/parryRatio/blockRatio/
   *           critRating/physAbsorb/magAbsorb ...)
   *   duz   - mavi satirlardan gelen DUZ stat eklemeleri (STR/INT/HP/MP)
   *   durum - mavi direnc satirlari -> statusResists {fb,es,bu,ps,zb}
   */
  #ekipmanToplami(equip) {
    const SALDIRI_ALANLARI = new Set([
      'physAtkMin', 'physAtkMax', 'magAtkMin', 'magAtkMax',
      'physReinforceMinPct', 'physReinforceMaxPct',
      'magReinforceMinPct', 'magReinforceMaxPct',
      'physReinforcePct', 'magReinforcePct', 'attackRate',
    ]);
    const ek = {};
    const duz = { strFlat: 0, intFlat: 0, hpFlat: 0, mpFlat: 0 };
    const durum = { fb: 0, es: 0, bu: 0, ps: 0, zb: 0 };
    if (!equip || !this.itemStats?.size) return { ek, duz, durum };

    for (const v of Object.values(equip)) {
      if (!v) continue;
      /* MADDE 25: dayanikliligi 0 olan parca HICBIR stat vermez
         (enhance.json $comment, paket @8753065). */
      if (esya.kirikMi(v)) continue;
      const itemId = typeof v === 'string' ? v : v.itemId;
      const def = this.itemStats.get(itemId);
      if (!def?.rollRanges) continue;
      const r = statRulo(def, v, this.maviKatalog);
      for (const [ad, deger] of Object.entries(r.statlar)) {
        // saldiri ve reinforce alanlari #silahStatlari icinde islenir
        if (ad === 'durability' || SALDIRI_ALANLARI.has(ad)) continue;
        if (!Number.isFinite(deger)) continue;
        ek[ad] = (ek[ad] ?? 0) + deger;
      }
      duz.strFlat += r.strFlat; duz.intFlat += r.intFlat;
      duz.hpFlat += r.hpFlat;   duz.mpFlat += r.mpFlat;
      for (const k of Object.keys(durum)) durum[k] += r.durumDirenci[k] ?? 0;
    }
    // kayan nokta birikimini temizle (referans oyun de 14.900000000000002 gonderiyor,
    // yani asiri yuvarlama YAPMIYOR - sadece 10 haneye kirpiyoruz)
    for (const k of Object.keys(ek)) ek[k] = +ek[k].toFixed(10);
    return { ek, duz, durum };
  }

  /** Seviye carpani - parcali dogrusal, disarida sabitlenir. [measured] */
  #seviyeCarpani(L, anchors) {
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

  /** Vurusun bandin neresine dustugu. t = u^((s+ER)/(s+HR))  [interim-invented] */
  #rulo(hitRatio, parryRatio) {
    const s = this.cfg.rollShape.softness;
    const u = Math.random();
    const us = (s + parryRatio) / (s + hitRatio);
    return Math.pow(u, us);
  }

  /** Seviye farki carpani: 1 + clamp(slope*(saldiran-hedef), floor, cap) */
  #seviyeFarkiCarpani(saldiranLv, hedefLv) {
    const g = this.cfg.levelGap;
    const ham = g.slope * (saldiranLv - hedefLv);
    return 1 + Math.min(g.cap, Math.max(g.floor, ham));
  }

  // ============================================================ ortak kapilar
  /**
   * BLOK (sifir hasar) orani SAVUNANIN statidir - saldiranin degil.
   *
   * KOK HATA (duzeltildi): zar `saldiran.derived.blockRatio` ile atiliyordu,
   * yani kalkan takan oyuncunun KENDI vuruslari %10-22 ihtimalle 0 hasar
   * veriyor ve CANAVARA blok animasyonu oynatiliyordu; buna karsilik canavardan
   * gelen hasarda blok hic kontrol edilmiyordu (kalkan savunma icin tamamen olu).
   * Istemci blok dalinda animasyonu HEDEFE oynatiyor:
   *   paket @27021400  if (character.blocked) { spawnDamageText(views.get(character.dst), 0,
   *                     {blocked:true}); playAnimOwner.playAnim('block') }
   * Veri: blockRatio yalniz slot=shield 96 esyada (data/itemstats.json,
   * shield01 [10,20]); mobs.json'da br>0 yalniz 3 mobda (bone general, br=20).
   */
  blokOrani(hedef) {
    const mobBr = hedef?.def?.combat?.ratings?.br;
    if (Number.isFinite(mobBr)) return mobBr;                       // hedef canavar
    const oyuncuBr = hedef?.derived?.blockRatio;
    if (Number.isFinite(oyuncuBr)) return oyuncuBr;                 // hedef oyuncu (hazir derived)
    if (hedef && hedef.def === undefined && (hedef.equip || hedef.level)) {
      return Number(this.turetilmis(hedef).blockRatio) || 0;        // hedef oyuncu (derived yok)
    }
    return 0;
  }

  /** Blok zari - capPct iki yolda da uygulanir (combat.json block.capPct = 60). */
  blokAtildi(hedef) {
    const oran = Math.min(this.cfg.block.capPct, this.blokOrani(hedef)) / 100;
    return oran > 0 && Math.random() < oran;
  }

  /**
   * rollShape'in ustelindeki hedef degeri = hedefin KACINMA (ER) orani.
   * combat.json rollShape yorumu: t = u^((s+ER)/(s+HR)).
   *
   * KOK HATA (duzeltildi): burada mobun `par` alani okunuyordu; mobs.json'da
   * `par` mobun SEVIYESI (1, 3, 5 ...), `er` ise ayri bir sutundur (Mangyang
   * er=27, Weasel er=35). Mangyang'da ustel (100+1)/(100+35)=0.75 oluyordu,
   * dogrusu (100+27)/(100+35)=0.94; u^0.75 > u^0.94 oldugu icin rulolar surekli
   * bandin UST ucuna kayiyor, oyuncu sistematik olarak fazla hasar veriyordu.
   * Ters yon (canavarVurusu) `hr` icin dogru sutunu zaten okuyordu.
   *
   * NOT: yedek deger UYDURULMADI - mobs.json'un 158 mobunun HEPSINDE `er` var,
   * ustelik `er` egrisi 53. seviyeden sonra kiriliyor (25+2L kurali bozuluyor),
   * yani formul uydurmak yanlis olurdu. Yedek yol yalniz OYUNCU hedeflerde
   * (PvP) calisir; orada ER'in karsiligi parryRatio'dur (combat.json parry).
   */
  kacinmaOrani(hedef, hedefSeviye) {
    const mobEr = hedef?.def?.combat?.ratings?.er;
    if (Number.isFinite(mobEr)) return mobEr;
    const oyuncuEr = hedef?.derived?.parryRatio ?? hedef?.parryRatio;
    if (Number.isFinite(oyuncuEr)) return oyuncuEr;
    const c = this.cfg;
    return c.parry.base + c.parry.perLevel * (hedefSeviye ?? 1);
  }

  /**
   * damageScale matrisi - kaynak turu x hedef turu, yuzde (100 = kimlik).
   * data/combat.json damageScale $comment: "Applied once in applyDamage to every
   * rolled hit's components" ve monsterVsPlayer = 80 (paket sema @8657858).
   * Bu TEK degeri hic uygulamiyorduk: canavarlar referans oyundakinin 100/80 = 1.25
   * kati vuruyordu. Tur adlari: player | monster | pet.
   * MUAF: drain / yansitma / DoT tikleri (yapilandirma yorumu boyle diyor) -
   * o kanallar bu fonksiyonu CAGIRMAZ.
   */
  hasarOlcegi(kaynakTuru, hedefTuru) {
    const m = this.cfg.damageScale ?? {};
    const ad = `${kaynakTuru}Vs${hedefTuru.charAt(0).toUpperCase()}${hedefTuru.slice(1)}`;
    const v = Number(m[ad]);
    return Number.isFinite(v) ? v : 100;
  }

  /**
   * Taban saldirinin MAAT ustalik carpani yuzdesi (q * maatPctPerLevel).
   *
   * combat.json mastery $comment: "the stat-page builder scales the displayed
   * PHYSICAL page by 1+q/100 of the equipped BASE-ATTACK row IFF that row carries
   * getv(MAAT); the combat endpoint builders apply the SELECTED row's 1+q/100 ...
   * for BOTH schools". Yani kapi acikca `varRiders` icinde MAAT olmasidir.
   * base-attacks.json'da MAAT tasiyan 6 satir: base_ch_sword / base_ch_spear /
   * base_ch_bow / base_eu_darkstaff / base_eu_tstaff / base_eu_staff.
   * (MUAT/E1SA/E2SA/E2AA/E2AH/DGAT/DGHR/DGAA/CBAT/CBRA binicileri MAAT DEGIL -
   *  yapilandirma yorumu yalniz MAAT diyor, digerleri icin kaynak yok.)
   *
   * q = karakterin ilgili ustalik seviyesi; hat silahtan cozulur (silahUstaligi).
   */
  ustalikYuzdesi(ch, taban) {
    if (!Array.isArray(taban?.varRiders) || !taban.varRiders.includes('MAAT')) return 0;
    const v = ch?.equip?.weapon;
    if (!v) return 0;
    const id = typeof v === 'string' ? v : v.itemId;
    const hat = this.silahUstaligi?.get(this.itemStats?.get(id)?.weaponType);
    if (!hat) return 0;
    let q = 0;
    for (const m of (ch.masteries ?? [])) {
      if ((m?.id ?? m?.masteryId) === hat) { q = Number(m.level ?? 0) || 0; break; }
    }
    if (q <= 0) return 0;
    return q * (this.cfg.mastery?.maatPctPerLevel ?? 1);
  }

  // ============================================================ hasar cekirdegi
  /**
   * TEK HASAR CEKIRDEGI - oyuncu, canavar ve (adapte edilirse) pet yollari
   * ayni matematikten gecsin diye. referans oyunun de tek bir savas cekirdegi var
   * (taban saldiri satirlari ZATEN skilldata satirlari: base_ch_sword code
   * SKILL_CH_SWORD_BASE_01, sourceRowId 2; katsayi iki tarafta da attPct2Raw).
   *
   * SIRA:
   *   1. ham   = alt + t*(ust-alt)                     (rulo bandin neresinde)
   *   2. katsayi + duz hasar   -> `katsayiSavunmaSonrasi` FALSE ise burada
   *   3. MAAT ustaligi (1 + q/100)                     [config: clamp(rawAttack+flat) uzerine]
   *   4. denge yuzdesi (phys/mag balance ya da monster.balanceFPct)
   *   5. taban carpani (seviye capa egrisi / monster.physMult|magMult)
   *   6. SAVUNMA dusulur (max 0)
   *   7. katsayi  -> `katsayiSavunmaSonrasi` TRUE ise burada
   *   8. seviye farki carpani
   *   9. kritik   -> YALNIZ FIZIKSEL bilesende (crit $comment: "physMult 2 on the
   *                  PHYS component only, applied POST-defense PRE-floor")
   *  10. damageScale (kaynak x hedef)                  [floor'dan HEMEN once]
   *  11. floor + minDamage
   *
   * `katsayiSavunmaSonrasi`: taban saldirilarda TRUE - canli referans oyun olcumu
   * (Test21 lvl1, sword01, Mangyang physDef 7): (21.12..22.84 * 0.75 - 7) * 0.60
   * = 5.30..6.08 -> gozlenen 6 ve 6. Katsayi once uygulansaydi 2.50..3.28 cikardi.
   * Beceri yolunda hangi siranin gectigi ise OLCULMEDI (bkz. plan maddesi 32);
   * bu yuzden konum sabit degil, PARAMETRE - cagiran taraf secer ve karar bir
   * olcumle netlestiginde tek satir degisir.
   */
  hasarCekirdegi(g) {
    const c = this.cfg;
    const alt = Number(g.alt) || 0;
    const ust = Number(g.ust) || 0;
    const t = Number(g.t) || 0;
    const kat = (g.katsayiPct ?? 100) / 100;
    const fMin = Number(g.flatMin) || 0;
    const fMax = Number(g.flatMax) || 0;
    const duzHasar = fMin + t * Math.max(0, fMax - fMin);

    let hasar = alt + t * Math.max(0, ust - alt);

    if (g.katsayiSavunmaSonrasi) hasar += duzHasar;
    else hasar = hasar * kat + duzHasar;

    if (g.ustalikPct) hasar *= 1 + g.ustalikPct / 100;

    hasar *= (g.dengePct ?? 100) / 100;
    hasar *= g.tabanCarpani ?? 1;

    hasar = Math.max(0, hasar - (Number(g.savunma) || 0));

    if (g.katsayiSavunmaSonrasi) hasar *= kat;

    hasar *= g.seviyeFarki ?? 1;

    if (g.kritik && !g.buyusel) hasar *= c.crit.physMult;

    hasar *= (g.olcekPct ?? 100) / 100;

    return Math.max(c.minDamage, Math.floor(hasar));
  }

  // ==================================================================== vurus
  /** Oyuncu -> canavar. Tum matematik hasarCekirdegi() icinde. */
  vurus(saldiran, hedef) {
    const c = this.cfg;
    const d = saldiran.derived ?? this.turetilmis(saldiran);
    const sLv = saldiran.level ?? 1, hLv = hedef.level ?? 1;

    /* MADDE 25 (capraz istek 40b) - ASINMA ZARI. Oranlar YALNIZ esya.ASINMA
       (data/gelistirme/enhance.json durability = paket @8753890 gomulu
       varsayilan). $comment: "weapon per attack/skill strike, armor per hit
       taken, shield per block". Silah HER vurusta (blok/iskalama dahil -
       darbe atilmistir); kalkan yalniz blok GERCEKLESTIGINDE ve hedef
       OYUNCU ise (canavarlarin equip'i yok). Kirilanlar cagirana doner ki
       gameloop sys.combat.item_broke yollayabilsin. */
    const kirilanlar = [];
    const asin = (kisi, yuva, olasilik, sahip) => {
      const it = kisi?.equip?.[yuva];
      if (esya.asindir(it, olasilik) === 'kirildi') {
        kirilanlar.push({ sahip, yuva, itemId: it.itemId });
      }
    };
    if (saldiran?.equip) asin(saldiran, 'weapon', esya.ASINMA.silah, 'saldiran');

    // blok (sifir hasar) - zar HEDEFIN blok oraniyla atilir
    if (this.blokAtildi(hedef)) {
      if (hedef?.equip) asin(hedef, 'shield', esya.ASINMA.kalkan, 'hedef');
      return { hasar: 0, kritik: false, kacti: false, blok: true, kirilanlar };
    }

    // kacinma: paket bunu KAPATMIS (chancePerPointPct 0) - retail'de yok
    if (c.miss.chancePerPointPct > 0) {
      const fazla = Math.max(0, (hedef.parryRatio ?? 0) - d.hitRatio - c.miss.erExcessThreshold);
      const sans = Math.min(c.miss.capPct, fazla * c.miss.chancePerPointPct) / 100;
      if (sans > 0 && Math.random() < sans) {
        return { hasar: 0, kritik: false, kacti: true, blok: false, kirilanlar };
      }
    }

    /* SALDIRI OKULU silahtan gelir (base-attacks.json).
       Asalar/arplar `mag`, kilic/mizrak/yay `phys`. Eskiden HER ZAMAN fiziksel
       hesaplaniyordu; asada physAtk [0,0] oldugu icin hasar minimuma dusuyordu. */
    const taban = this.tabanSaldiri(saldiran);
    const buyusel = taban?.school === 'mag';

    const t = this.#rulo(d.hitRatio, this.kacinmaOrani(hedef, hLv));

    const kritikSans = Math.min(c.crit.capPct, (d.critRating ?? 0) * c.crit.pctPerRating) / 100;
    const kritik = kritikSans > 0 && Math.random() < kritikSans;

    const hasar = this.hasarCekirdegi({
      alt: buyusel ? d.magAtkMin : d.physAtkMin,
      ust: buyusel ? d.magAtkMax : d.physAtkMax,
      t,
      // taban saldirinin katsayisi (coefficientPct): kilic 60, eu_tstaff 180 ...
      katsayiPct: taban?.coefficientPct ?? 100,
      flatMin: taban?.flatMin ?? 0, flatMax: taban?.flatMax ?? 0,
      katsayiSavunmaSonrasi: true,             // canli olcum (bkz. hasarCekirdegi)
      ustalikPct: this.ustalikYuzdesi(saldiran, taban),
      dengePct: buyusel ? d.magBalancePct : d.physBalancePct,
      tabanCarpani: this.#seviyeCarpani(sLv,
        buyusel ? (c.mult.magAnchors ?? c.mult.physAnchors) : c.mult.physAnchors),
      savunma: buyusel
        ? (hedef.def?.magDef ?? hedef.derived?.magDef ?? hLv * 2)
        : (hedef.def?.physDef ?? hedef.derived?.physDef ?? hLv * 2),
      seviyeFarki: this.#seviyeFarkiCarpani(sLv, hLv),
      kritik, buyusel,
      olcekPct: this.hasarOlcegi('player', hedef?.def ? 'monster' : 'player'),
    });

    return {
      hasar,
      kritik, kacti: false, blok: false,
      buyusel, tabanId: taban?.id ?? null,
      vurusSayisi: Math.max(1, taban?.hits ?? 1),
      vurusAralari: taban?.hitOffsetsMs ?? null,
      kirilanlar,
    };
  }

  /**
   * Canavarin etkin saldiri OKULU. gameloop'un combat.monsterAction'da
   * gonderdigi `school` alani ile hasar hesabinin okulu AYNI kaynaktan cikmali,
   * yoksa 58 mob buyu efekti oynatip fiziksel savunmaya carpar.
   *
   * Kural: magAtk[1] > physAtk[1] -> buyusel. data/mobs.json'da 158 mobun
   * 58'inde magAtk[1]>0 ve bu 58'in TAMAMINDA magAtk[1] > physAtk[1] (18'inde
   * physAtk zaten [0,0]) - yani bu kural gameloop'un mevcut `magAtk[1] > 0`
   * etiketiyle bu veri kumesinde BIREBIR ayni sonucu verir.
   * (Mob becerilerinin kendi `school` alani veride YOK: skills.json'da msk_* satiri
   *  bulunmuyor, o yuzden okul mobun saldiri sutunlarindan cozuluyor.)
   */
  canavarOkulu(mob) {
    const md = mob?.def ?? {};
    const mag = Number(md.magAtk?.[1] ?? 0);
    const phys = Number(md.physAtk?.[1] ?? 0);
    return mag > phys ? 'magical' : 'physical';
  }

  /** Canavar -> oyuncu. monster.physMult = 1.0 (measured-exact, x1.28 YOK). */
  canavarVurusu(mob, ch) {
    const c = this.cfg;
    const d = this.turetilmis(ch);
    const md = mob.def ?? {};
    const mLv = mob.level ?? 1;

    /* BLOK bu yolda HIC yoktu - kalkan savunma icin tamamen oluydu.
       Zar hedef OYUNCUNUN turetilmis blockRatio'suyla atilir. */
    const blokSans = Math.min(c.block.capPct, d.blockRatio ?? 0) / 100;
    if (blokSans > 0 && Math.random() < blokSans) {
      /* MADDE 25: "shield per block" (enhance.json $comment @8753065) -
         blok GERCEKLESTI, oyuncunun kalkani asinir. */
      const kit = ch?.equip?.shield;
      const kirildi = esya.asindir(kit, esya.ASINMA.kalkan) === 'kirildi';
      return { hasar: 0, kritik: false, kacti: false, blok: true, buyusel: false,
               ...(kirildi ? { kirilan: { yuva: 'shield', itemId: kit.itemId } } : {}) };
    }

    /* OKUL: canavar hasari HER ZAMAN physAtk'tan hesaplanip HER ZAMAN physDef
       dusuluyordu. physAtk [0,0] olan 18 mobda hasar 0 cikip minDamage'a
       dusuyordu: oyuncu o mobardan tam olarak 1 hasar aliyordu (oyuncu
       tarafinda duzeltilen "asa 1 hasar" hatasinin canavar ikizi).
       monster.magMult da hicbir yerde okunmuyordu. */
    const buyusel = this.canavarOkulu(mob) === 'magical';
    const [min, max] = (buyusel ? md.magAtk : md.physAtk) ?? [mLv * 2, mLv * 4];

    const t = this.#rulo(md.combat?.ratings?.hr ?? c.hitRate.base + mLv, d.parryRatio);

    /* Kritik sansinda ust sinir (crit.capPct = 50) bu yolda EKSIKTI; oyuncu ve
       beceri yollari sinirI zaten uyguluyordu. Bugunku veride chr en fazla 2,
       yani etkisiz - ama yuksek chr'li bir unique eklendiginde sinirsiz olurdu. */
    const kritikSans = Math.min(c.crit.capPct,
      (md.combat?.ratings?.chr ?? 0) * c.crit.pctPerRating) / 100;
    const kritik = kritikSans > 0 && Math.random() < kritikSans;

    let hasar = this.hasarCekirdegi({
      alt: min, ust: max, t,
      dengePct: c.monster.balanceFPct,
      tabanCarpani: buyusel ? (c.monster.magMult ?? 1) : (c.monster.physMult ?? 1),
      savunma: buyusel ? d.magDef : d.physDef,
      seviyeFarki: this.#seviyeFarkiCarpani(mLv, ch.level ?? 1),
      kritik, buyusel,
      olcekPct: this.hasarOlcegi('monster', 'player'),   // damageScale 80
    });
    /* MADDE 21 (capraz istek 20): nadirlik hasar kaldiraci. Carpan YALNIZ
       drops.json monsterVariants[rarity].dmgMult'tan gelir (#canavarUret
       e.atkMult'a yazar); iki kademede de 1 oldugu icin bugun ETKISIZ -
       monster-variants.json PROVENANCE: "variants are HP/reward sponges,
       never harder hitters; dmgMult stays wired ... simply inert at 1". */
    hasar = Math.round(hasar * (mob.atkMult ?? 1));

    /* MADDE 25: "armor per hit taken" - darbe basina TEK zirh zari
       (esya.zirhAsindir; parca secimi esit olasilik, bkz. esya.js basligi). */
    const z = esya.zirhAsindir(ch?.equip);
    return { hasar, kritik, kacti: false, blok: false, buyusel,
             ...(z?.sonuc === 'kirildi'
               ? { kirilan: { yuva: z.yuva, itemId: ch.equip[z.yuva]?.itemId } } : {}) };
  }

  /**
   * MADDE 43 (capraz istek 67): msk_* kaydi oyuncu becerileriyle AYNI
   * cekirdekten gecer. KAYNAK: monster-skills.json coefficientPct/flatMin/
   * flatMax/school = _RefSkill att blogu (kind 5/6=fiziksel, 8/9/10=buyusel).
   * Isyutaru msk_286: att 10,200,2066,2333 -> buyusel, katsayi %200,
   * flat 2066-2333 (mobs.json magAtk ile birebir).
   * Kritik/blok/damageScale.monsterVsPlayer zinciri canavarVurusu ile AYNI;
   * katsayi sirasi madde 32'deki ISARETLI duzen (savunmadan ONCE,
   * katsayiSavunmaSonrasi:false) - canli olcumle karsilastirilmadi.
   */
  canavarBecerisiVurusu(mob, ch, sk) {
    const c = this.cfg;
    const d = this.turetilmis(ch);
    const md = mob.def ?? {};
    const mLv = mob.level ?? 1;

    const blokSans = Math.min(c.block.capPct, d.blockRatio ?? 0) / 100;
    if (blokSans > 0 && Math.random() < blokSans) {
      const kit = ch?.equip?.shield;
      const kirildi = esya.asindir(kit, esya.ASINMA.kalkan) === 'kirildi';
      return { hasar: 0, kritik: false, kacti: false, blok: true, buyusel: false,
               ...(kirildi ? { kirilan: { yuva: 'shield', itemId: kit.itemId } } : {}) };
    }

    const buyusel = sk?.school === 'magical';
    const t = this.#rulo(md.combat?.ratings?.hr ?? c.hitRate.base + mLv, d.parryRatio);
    const kritikSans = Math.min(c.crit.capPct,
      (md.combat?.ratings?.chr ?? 0) * c.crit.pctPerRating) / 100;
    const kritik = kritikSans > 0 && Math.random() < kritikSans;

    let hasar = this.hasarCekirdegi({
      alt: sk?.flatMin ?? 0, ust: sk?.flatMax ?? 0, t,
      katsayiPct: sk?.coefficientPct ?? 100,
      katsayiSavunmaSonrasi: false,          // madde 32'nin isaretli duzeni
      dengePct: c.monster.balanceFPct,
      tabanCarpani: buyusel ? (c.monster.magMult ?? 1) : (c.monster.physMult ?? 1),
      savunma: buyusel ? d.magDef : d.physDef,
      seviyeFarki: this.#seviyeFarkiCarpani(mLv, ch.level ?? 1),
      kritik, buyusel,
      olcekPct: this.hasarOlcegi('monster', 'player'),
    });
    hasar = Math.round(hasar * (mob.atkMult ?? 1));   // madde 21, bkz. canavarVurusu

    const z = esya.zirhAsindir(ch?.equip);
    return { hasar, kritik, kacti: false, blok: false, buyusel,
             ...(z?.sonuc === 'kirildi'
               ? { kirilan: { yuva: z.yuva, itemId: ch.equip[z.yuva]?.itemId } } : {}) };
  }

  /** Otomatik saldiri araligi (ms) ve menzil (birim). */
  get saldiriAraligi() { return this.cfg.autoAttack.baseIntervalMs; }
  get saldiriMenzili() { return this.cfg.autoAttack.rangeU; }

  /**
   * Vurus periyodu - silahin taban saldirisindaki `reuseMs`.
   * combat.json autoAttack.baseIntervalMs kendi yorumunda "legacy fallback only"
   * diyor; gercek tempo base-attacks.json'dan gelir (840-2000 ms arasi).
   */
  vurusPeriyodu(ch) {
    const t = this.tabanSaldiri(ch);
    return t?.reuseMs ?? this.cfg.autoAttack.baseIntervalMs ?? 1600;
  }

  /**
   * Vurus hazirligi (ms) - s2c 216 `auto.windup {id, targetId, castMs}` alani.
   *
   * NEDEN VERIDEN: istemci bu degeri mermi/atim BIRAKMA ani olarak kullaniyor
   * ve KENDI silah tablosundaki varsayilani EZIYOR:
   *   @27109580  Q.applyAutoSwing({ id, targetId, releaseMs: node.castMs })
   *   @27027343  window.setTimeout(..., node.releaseMs ?? flightFx.releaseMs)
   *   (d6 tablosu @26697984: yay 600, asa 800, harp 1000)
   * Yani sunucu ne gonderirse temas/ucus o ana kayar; uydurma bir carpan
   * (eski gameloop: vurusPeriyodu * 0.35) animasyonu veriden koparir.
   *
   * KAYNAK: data/base-attacks.json kaydinin `castMs` alani - yoksa ilk temas
   * ani `hitOffsetsMs[0]`. Olculen degerler:
   *   castMs         : eu_crossbow 553, eu_darkstaff/eu_staff 801, eu_tstaff 934
   *   hitOffsetsMs[0]: yumruk 208, ch_sword 200, ch_spear 338, bow 445,
   *                    eu_sword 437, eu_tsword 638, eu_axe 290, eu_dagger 200,
   *                    eu_harp 493
   * (Asalarda ikisi neredeyse ayni - 801/801, 934/933 - yani ayni buyuklugu
   *  tarif ediyorlar.)
   */
  vurusHazirligi(ch) {
    const t = this.tabanSaldiri(ch);
    const v = t?.castMs ?? t?.hitOffsetsMs?.[0];
    return Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0;
  }

  /**
   * Giyili silah bir MESLEK ALETI mi? (paket @8693535 uY()/lY haritasi)
   *
   * Toplama aleti kusanikken savas yasak: istemcinin beceri on-kapisi
   * (@25692593) `err.profession.tool_no_combat` basiyor - tr.json:
   * "Toplama aleti tutarken savasamazsin." Otomatik saldiri yolunda istemci
   * bu kapiyi HIC uygulamiyor (@25688366'da yalniz CC kilidi var), yani
   * orada tek kapi sunucudur.
   */
  meslekAletiMi(ch) {
    const v = ch?.equip?.weapon;
    if (!v) return false;
    const id = typeof v === 'string' ? v : v.itemId;
    if (this.meslekAletleri?.has(id)) return true;
    return this.aletSilahTurleri?.has(this.itemStats?.get(id)?.weaponType) === true;
  }

  /**
   * Yere serilme suresi (ms) - combat.event (140) `ko` alani icin.
   *
   * Hedef CANAVARSA kendi kaydindaki `combat.koRecoverMs` (data/mobs.json;
   * 152 mobda 3000, 6 egitim kuklasinda 0), hedef OYUNCUYSA
   * combatConfig.knockdown.downMs (data/combat.json = 2500; paket sema
   * @8655609 `knockdown: X({downMs: Y().int().positive()})`, gomulu
   * varsayilan @8746697 `{downMs: 2500}`).
   *
   * NOT: bu deger yalnizca SURE'yi verir; serilme SANSI beceri kaydinin
   * `knockdown.chancePct` alanindadir (data/skills.json, 73 beceri) ve
   * onu uygulamak beceri/durum modulunun isi - burada zar ATILMAZ.
   */
  serilmeSuresi(hedef) {
    const mobMs = hedef?.def?.combat?.koRecoverMs;
    if (Number.isFinite(mobMs)) return Math.max(0, Math.round(mobMs));
    return Math.max(0, Math.round(this.cfg.knockdown?.downMs ?? 2500));
  }

  /**
   * Oyuncunun otomatik saldiri menzili - SILAHTAN gelir.
   * itemstats.json'da her silahta `attackDistanceU` var (paketteki Qst):
   *   sword/blade/eu_sword/eu_dagger        -> 2
   *   spear/glavie/eu_axe/eu_tsword         -> 2.8
   *   bow/eu_crossbow/eu_darkstaff/staff... -> 27
   * Silah yoksa combat.json autoAttack.rangeU (2.5) - kendi yorumunda
   * "bare-hands reach" yazıyor.
   *
   * ESKIDEN: gameloop HEDEFIN attackRangeU'sunu kullaniyordu (o MOBUN kendi
   * menzili) ve ustune uydurma bir +2 ekliyordu. Mangyang icin 2.5+2.5+2 = 7.0,
   * dogrusu 2.0 - yani oyuncu 3.5 kat uzaktan vuruyordu ("ok gibi uzaktan").
   */
  oyuncuMenzili(ch) {
    const v = ch?.equip?.weapon;
    if (v && this.itemStats?.size) {
      const id = typeof v === 'string' ? v : v.itemId;
      const def = this.itemStats.get(id);
      if (def && typeof def.attackDistanceU === 'number') return def.attackDistanceU;
    }
    return this.cfg.autoAttack.rangeU;   // ciplak el
  }
  get regen() { return this.cfg.regen; }
  get statPuaniSeviyeBasi() { return this.cfg.statPointsPerLevel; }

  // ==================================================================== odul
  /**
   * PREMIUM XP/SP BONUSU - kademe -> ek yuzde.
   *
   * KAYNAK (paket index-BUMMQVRB.js, `grep -aob 'xpSpBonusPct'`):
   *   @8702714  sema  `xpSpBonusPct: Y().min(0)`
   *   @9299985  $comment: "xpSpBonusPct is the additive % boost to XP and
   *             SP from monster kills" -> yalniz CANAVAR OLDURME odulu;
   *             gorev XP'si (sistem_gorev -> xpEkle dogrudan) ETKILENMEZ.
   *   @9300246  bronze 10   @9300566 silver 15   @9300882 gold 20
   * Ayni katalog GERCEK/paket_veri/config/premium.json'da; tr.json
   * label:premium:gold.feature.0 = "Avdan +%20 XP ve SP".
   *
   * `ch.premiumTier` D5-A tarafindan karaktere yansitilir (kaynak:
   * sistem_kucuk-sistemler PREMIUM defteri, WebPremium). Alan yoksa /
   * kademe taninmiyorsa bonus 0 -> bugunku davranis aynen surer.
   *
   * NEDEN odul() ICINDE DEGIL: parti paylasimi (FARK #0/#180) odul()
   * havuzunu paylasimHesapla ile boluyor; bonus havuza konursa HESAP bazli
   * premium TUM partiye dagilir (premium.json $comment tam da bunu
   * yasaklayan "account-bound" tanimi tasiyor). Bu yuzden carpan DAGITIM
   * SONRASI, alici basina uygulanir (gameloop.#odulUygula /
   * sistem_beceri.odulUygula) - katsayilarin TEK kaynagi burasi.
   */
  premiumBonusPct(ch) {
    return PREMIUM_XP_SP_BONUS_PCT[ch?.premiumTier] ?? 0;
  }

  /** Alici basina XP/SP carpani: gold -> 1.20, premium'suz -> 1. */
  premiumCarpani(ch) {
    return 1 + this.premiumBonusPct(ch) / 100;
  }

  odul(mob, ch) {
    const md = mob.def ?? {};
    let xp = md.xp ?? Math.round(10 + (mob.level ?? 1) * 6);
    let spExp = 0;

    const tbl = this.progress?.spExpByMonsterLevel;
    if (tbl) {
      const k = String(mob.level ?? 1);
      const anahtarlar = Object.keys(tbl);
      spExp = Number(tbl[k] ?? tbl[anahtarlar[anahtarlar.length - 1]] ?? 0);
    }

    const carpan = this.#xpSeviyeCarpani((ch.level ?? 1) - (mob.level ?? 1));
    xp = Math.max(1, Math.round(xp * carpan));
    spExp = Math.round(spExp * carpan);

    if (mob.rarity && this.world?.variants?.[mob.rarity]) {
      const v = this.world.variants[mob.rarity];
      xp = Math.round(xp * (v.xpMult ?? 1));
      spExp = Math.round(spExp * (v.spExpMult ?? 1));
    }

    /* SUNUCU ORANLARI - gameConfig.xpRate / spRate. Bunlar HIC UYGULANMIYORDU,
       o yuzden seviye atlamak referans oyuna gore 25 kat yavasti.
       Canli olcum (Mangyang oldurme, taban xp 24):
         sys.progress.xp {"xp":600,"sp":960}
         600/24 = 25 = xpRate      960/24 = 40 = spRate
       xpToNext 1.sv 118 + 2.sv 470 = 588  ->  600 XP tek mobda SEVIYE 3 yapar,
       kullanicinin referans oyunda gordugu davranis tam olarak bu. */
    /* Oranlar etkinOranlar() uzerinden - ganimet() ve acilis logu ile AYNI
       kaynak. Onceden `this.oranlar` dogrudan okunuyordu; o alan ancak
       server.js'teki admin `uygula` geri-cagrisi xp/sp/gold'u ustune
       yazdiginda canli kaliyordu (itemDrop/muhur icin hic yazilmiyordu).
       Tek cozumleme ile bu kirilgan es-guduma bagimlilik kalkti. */
    const { xpRate: xpOran, spRate: spOran } = this.etkinOranlar();
    xp = Math.max(1, Math.round(xp * xpOran));
    spExp = Math.round(spExp * spOran);

    return { xp, spExp };
  }

  /**
   * delta = oyuncuSeviyesi - canavarSeviyesi
   * Paketteki levelGapPolicy: 4->.85  5->.7  6->.55  7->.4  8->.25  9->.1
   * bunun otesi xpSpFactorBeyond (.01). delta<=3 ise ceza yok.
   * NOT: paket bunu "PROVISIONAL" isaretlemis - masaustu egrisi henuz olculmemis.
   */
  #xpSeviyeCarpani(fark) {
    const pol = this.progress?.sabitler?.levelGapPolicy ?? this.progress?.sabitler;
    const t = pol?.xpSpFactorByDelta;
    if (t) {
      const k = String(fark);
      if (t[k] != null) return Number(t[k]);
      // tabloda yoksa: kucuk delta -> ceza yok, buyuk delta -> beyond
      const anahtarlar = Object.keys(t).map(Number).sort((a, b) => a - b);
      if (fark < anahtarlar[0]) return 1;
      return Number(pol.xpSpFactorBeyond ?? 0.01);
    }
    if (fark <= 0) return 1;
    if (fark <= 5) return 1 - fark * 0.08;
    if (fark <= 10) return 0.5 - (fark - 5) * 0.06;
    return 0.1;
  }

  xpEkle(ch, xp) {
    const tbl = this.progress?.xpToNext;
    /* DB bigint alanlari (tedious) METIN dondurebilir - ch.xp kaynagi
       _Char.ExpOffset bigint. Ham `+` metin birlestirir ("1000"+600 ->
       "1000600" okunur, seviye esikleri sacmalar). gameloop.js ganimet ve
       sistem_dukkan satis yollarindaki Number() kalibinin aynisi. */
    ch.xp = Number(ch.xp ?? 0) + xp;
    if (!tbl) return { seviyeAtladi: false };
    const maxLv = this.progress.maxLevel;
    let atladi = false;
    while (ch.level < maxLv) {
      const gerek = Number(tbl[String(ch.level)] ?? 0);
      if (!gerek || ch.xp < gerek) break;
      ch.xp -= gerek;
      ch.level += 1;
      ch.statPoints = (ch.statPoints ?? 0) + this.progress.statPointsPerLevel;
      atladi = true;
    }
    return atladi ? { seviyeAtladi: true, yeniSeviye: ch.level } : { seviyeAtladi: false };
  }

  spEkle(ch, spExp) {
    const bolen = this.progress?.spExpPerSpPoint ?? 400;
    ch.spExp = (ch.spExp ?? 0) + spExp;
    let n = 0;
    while (ch.spExp >= bolen) { ch.spExp -= bolen; ch.sp = (ch.sp ?? 0) + 1; n++; }
    return n;
  }

  // ================================================================= ganimet
  /**
   * Seviye farki ganimet kapisi.
   * delta = ganimetSahibiSeviyesi - canavarSeviyesi;  delta >= noDropDeltaMin (9)
   * ise ALTIN ve ESYA hic dusmez.
   * Kaynak: data/progress.json sabitler.levelGapPolicy.noDropDeltaMin = 9 ve
   * data/drops.json monsterRewards.noDropDeltaMin = 9 ($application: "delta >=
   * noDropDeltaMin (9) means no drops at all; quest kill credit unaffected").
   * Sema: paket @8687350 Jat = X({ ..., noDropDeltaMin: Y().int().positive() }).
   * XP/SP ayri egriden (#xpSeviyeCarpani) gecer, gorev sayimi bu daldan
   * gecmedigi icin etkilenmez.
   */
  ganimetKapisi(mob, ch) {
    const seviye = Number(ch?.level);
    if (!Number.isFinite(seviye)) return false;     // sahip bilinmiyorsa kapi kapali
    const pol = this.progress?.sabitler?.levelGapPolicy ?? this.progress?.sabitler;
    const esik = Number(pol?.noDropDeltaMin);
    if (!Number.isFinite(esik) || esik <= 0) return false;
    return (seviye - (mob?.level ?? 1)) >= esik;
  }

  /**
   * DUSEN esyanin +N seviyesi - _RefDropOptLvlSel (drops.json $optLevelSel).
   *
   * Zar: r = zar(); KUMULATIF esigi gecen ILK satirin optLevel'i (gen_drops2.mjs:95
   * bu okumayi zaten yaziyor). Tablo yoksa 0 - sayi UYDURULMAZ.
   *
   * `cevrimiciDk` = ReqOnlineTime kapisi (+1 icin 20 dk, +2 icin 40 ...): karakter
   * o kademenin cevrimici suresini doldurmadiysa doldurdugu EN UST kademeye kirpilir.
   * [ISARETLI BOSLUK] vSRO'nun sayaci karakterin TOPLAM oynama suresidir; klonda
   * boyle bir sutun/alan YOK (ne _Char'da ne kalicilik.js'te), bu yuzden cagiran
   * OTURUM dakikasini verir (gameloop ws._oturumT0).
   *
   * CAGIRAN SOZLESMESI - iki ayri "bos" deger vardir, KARISTIRILMAMALIDIR:
   *   null/undefined/NaN -> "OLCUM YOK": kapi hic UYGULANMAZ (tablo zari ne
   *        derse o). Damgasi (ws._oturumT0) henuz konmamis bir oyuncu icin
   *        bilincli secim - eksik olcum sessizce "hep +0" uretmesin.
   *   0 (ya da herhangi bir sayi) -> "OLCULDU": kapi uygulanir. 0 = kredi yok
   *        -> merdivenin 0 dk gerektiren en ust kademesi, yani +0.
   * SAHIP/karakter YOKKEN (ganimet sahipsiz duser, ReqOnlineTime kredisi
   * KISIYE ait oldugu icin kimsede islemez) dogru deger 0'dir, null DEGIL.
   * 2026-09-05: sistem_dirilis-unique.js sahipsiz unique dususunde null
   * veriyordu; kapi uygulanmadigi icin herkese acik ganimet sahipli
   * ganimetten daha yuksek +N atabiliyordu (olculdu: sahipsiz +0..+5,
   * 30 dk sahipli +0/+1). Duzeltme cagiran tarafinda: sahipCevrimiciDk().
   */
  plusUret(cevrimiciDk = null, zar = Math.random) {
    const satirlar = this.optLevelSel;
    if (!Array.isArray(satirlar) || !satirlar.length) return 0;
    const r = zar();
    let secilen = 0;
    for (const s of satirlar) { if (r <= s.kumulatifProb) { secilen = s.optLevel; break; } }
    if (secilen <= 0 || cevrimiciDk == null) return Math.max(0, secilen);
    const dk = Number(cevrimiciDk);
    if (!Number.isFinite(dk)) return Math.max(0, secilen);
    let tavan = 0;
    for (const s of satirlar) { if (s.gerekenCevrimiciDk <= dk && s.optLevel > tavan) tavan = s.optLevel; }
    return Math.min(secilen, tavan);
  }

  /**
   * Bir DUSUSTE uretilecek ornek alanlari ({variance, plus}) - esya.yeniYigin()'in
   * ucuncu argumani. Ganimet ureten TUM yollar (gameloop #ganimetDus, sistem_beceri
   * beceriyle olduren yol) burayi cagirir ki kural tek yerde dursun.
   * Ekipman DISI (tuketilebilir) esyada {} doner - yeniYigin zaten alan yazmaz.
   *
   * [ISARETLI BOSLUK - MAVI (magic option) BILEREK URETILMIYOR]
   * Rastgele dusen ekipmana kac mavi satir gelecegi SRO_VT_SHARD'da YOKTUR ve
   * bu bir eksik okuma degil, olculmus bir yokluktur:
   *   _RefMonster_AssignedItemDrop  991 satir -> RefMagicOptionID1 sifir-disi 0,
   *                                  OptLevel hepsi 0
   *   _RefDropItemGroup             126 satirin tamami tek gruba (ITEM_ROCSET)
   *                                  ait; degerleri _RefMagicOptGroup'ta SABIT
   *   _RefAbilityByItemOptLevel / _RefMagicOptByItemOptLevel: yalniz birkac ozel
   *                                  RefItemID, rastgele dusus yolu degil
   * Yani "her esyada mavi" de "%N ihtimalle mavi" de VERIYLE savunulamaz; oran
   * uydurmak bu dosyanin kuralina aykiri. referans oyunun kendi tasarim beyani da
   * ayni yonde (paket @6439638): mavi satirlar SIMYA TASINDAN gelir - o yol
   * zaten calisiyor (sistem_gelistirme.js tas uygulama/ozumseme, blues yazan
   * TEK yer orasi). vSRO'nun dusus tarafinda gercekten VAR OLAN tek "secenek"
   * tablosu _RefDropOptLvlSel'dir ve o mavi degil +N SEVIYESIDIR - yukaridaki
   * plusUret() onu uyguluyor. Mavi dusus istenirse SEKIL veriden gelir
   * (havuz = magic-opts assign/groups, seviye = def.degree, aday kabulu
   * opt.prob, deger = degerMerdiveni'nden zar, tavan maxBlue 9); eksik olan
   * yalnizca ORAN'dir ve o admin panelinden ayarlanan, NON-PARITY diye
   * isaretlenmis tek bir sayi olmalidir.
   */
  dususOrnegi(def, { cevrimiciDk = null } = {}, zar = Math.random) {
    if (!def || !NITELIK_GRUPLARI[def.type]) return {};
    return { variance: varyansUret(def, zar), plus: this.plusUret(cevrimiciDk, zar) };
  }

  /**
   * CANLI ETKIN ORANLAR - oranlarin TEK dogruluk kaynagi.
   *
   * Oncelik: world.gcfg (admin panelinin yerinde guncelledigi CALISAN GCFG
   * referansi; server.js `gcfg: GCFG`) > kurulusta okunan game-config.json
   * yedegi (this.oranlar) > 1. Muhur kademelerinde eski tek `rareDropRate`
   * anahtarina geri-dusus geriye uyum icin BILEREK korunur.
   *
   * Cozumleme eski satir-ici `oranCarpani` mantiginin AYNISI: once
   * nullish-coalescing zinciri ile ilk TANIMLI aday secilir, sonra
   * sayi/pozitif kapisindan gecmezse 1'e duser. (Yani canli deger 0 ise
   * yedege DUSULMEZ, 1 kabul edilir - eski davranis birebir korunur.)
   *
   * Bu metot var oldugu icin log ile gercek davranis bir daha ayrisamaz:
   * ganimet(), odul() ve oranlariLogla() ayni sayilari okur.
   */
  etkinOranlar() {
    const canli = this.world?.gcfg ?? {};
    const y = this.oranlar ?? {};
    const oran = (...adaylar) => {
      let v;
      for (const a of adaylar) { if (a !== undefined && a !== null) { v = a; break; } }
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? n : 1;
    };
    return {
      xpRate:   oran(canli.xpRate,   y.xpRate),
      spRate:   oran(canli.spRate,   y.spRate),
      goldRate: oran(canli.goldRate, y.goldRate),
      itemDropRate: oran(canli.itemDropRate, y.itemDropRate),
      sealStarRate: oran(canli.sealStarRate, canli.rareDropRate, y.sealStarRate),
      sealMoonRate: oran(canli.sealMoonRate, canli.rareDropRate, y.sealMoonRate),
      sealSunRate:  oran(canli.sealSunRate,  canli.rareDropRate, y.sealSunRate),
    };
  }

  /**
   * ACILIS LOGU - server.js bunu createAdmin(...)'DAN SONRA cagirir; boylece
   * sunucu-ayarlari.json farklari CALISAN GCFG'ye islenmis olur ve satir
   * gercekten uygulanan oranlari gosterir. Kurucudan cagirmak eski YALAN
   * loga geri donmek olurdu (yukaridaki uzun aciklama).
   *
   * `goldRate` satirda gosterilir ama ganimete UYGULANMAZ: drops.json
   * $oranNasilUygulandi "GoldMin/GoldMax ile carpildi" - tablo degerleri
   * zaten pismis. Yaniltmasin diye etiketinde belirtilir.
   */
  oranlariLogla() {
    const o = this.etkinOranlar();
    this.log(`oranlar: xp x${o.xpRate}, sp x${o.spRate}, altin x${o.goldRate} (tabloya pismis), esya x${o.itemDropRate}, muhur bronz x${o.sealStarRate} / gumus x${o.sealMoonRate} / altin-muhur x${o.sealSunRate}`);
    return o;
  }

  /**
   * @param mob  oldurulen canavar
   * @param ch   GANIMET SAHIBI karakter (seviye farki kapisi icin) - eski
   *             cagirilar tek argumanla geldiginde kapi calismaz, davranis
   *             degismez.
   */
  ganimet(mob, ch = null) {
    if (this.ganimetKapisi(mob, ch)) return { items: [], gold: 0 };
    const tid = mob.def?.dropTableId;
    const tablo = tid ? this.world?.dropTables?.get(tid) : null;
    const cikan = [];
    let altin = 0;

    if (tablo) {
      const rulo = (mob.rarity && this.world.variants?.[mob.rarity]?.lootRolls) || 1;
      const girdiler = tablo.items ?? tablo.entries ?? [];
      /* CANLI DUSME ORANLARI - itemDropRate + sealStar/Moon/SunRate BAGLANDI.
         Canli kaynak: world.gcfg = server.js:339'un World'e verdigi CALISAN
         GCFG REFERANSI (admin paneli yerinde gunceller - world.js
         #cesetSuresiMs ile ayni desen); world/gcfg yoksa kurulusta okunan
         game-config (this.oranlar) yedek. Tablo sanslari uretim aninda
         $oranlar ile PISMIS oldugu icin carpan = canli / pismis (bugun 1/1
         = no-op). Muhur ayrimi VERIDEN: itemstats `seal` alani yalniz
         RareEquip'te var (bronze/silver/gold 464'er kayit, sonek 1:1;
         DB stat paritesi: bronze=_A_RARE "Seal of Star", silver=_B_RARE
         "Seal of Moon", gold=_C_RARE "Seal of Sun") - her kademe KENDI
         carpanini alir (sealStarRate/sealMoonRate/sealSunRate). Eski tek
         canli.rareDropRate anahtarina geri-dusus geriye uyum icin BILEREK
         durur; pismis payda uc kademe icin de $oranlar.rareDropRate (gen
         uc kademeyi tek oranla pisirdi). Altin sansina DOKUNULMAZ
         ($oranNasilUygulandi: goldRate min/max'a islenmis, DropProb
         degistirilmedi). */
      /* Canli oran cozumlemesi TEK YERDE: etkinOranlar(). Burada yalnizca
         pismis paydaya bolunur. (Eskiden ayni zincir satir-ici yazilmisti;
         acilis logu ise this.oranlar'i basiyordu - ayrisma buradan cikti.) */
      const etkin = this.etkinOranlar();
      const pismiseBol = (canliV, pismisV) => {
        const p = Number(pismisV);
        return canliV / (Number.isFinite(p) && p > 0 ? p : 1);
      };
      const esyaCarpan = pismiseBol(etkin.itemDropRate, this.pismisOranlar?.itemDropRate);
      const muhurCarpan = {
        bronze: pismiseBol(etkin.sealStarRate, this.pismisOranlar?.rareDropRate),
        silver: pismiseBol(etkin.sealMoonRate, this.pismisOranlar?.rareDropRate),
        gold:   pismiseBol(etkin.sealSunRate,  this.pismisOranlar?.rareDropRate),
      };
      /* ADET COZUMU: gen_drops2.mjs artik `qty`yi hep SAYI olarak yaziyor
         (_RefDropItemAssign.DropCount), ama eski tablolarda [min,max] araligi
         olabiliyordu ve her tuketici (gameloop / pet / beceri) bunu farkli
         yorumluyordu. Araligi burada, tek yerde, tam sayiya cozuyoruz. */
      const adet = (q) => {
        if (Array.isArray(q)) {
          const a = Math.max(1, Math.floor(Number(q[0]) || 1));
          const b = Math.max(a, Math.floor(Number(q[1]) || a));
          return a + Math.floor(Math.random() * (b - a + 1));
        }
        const n = Math.floor(Number(q));
        return Number.isFinite(n) && n >= 1 ? n : 1;
      };
      for (let i = 0; i < rulo; i++) {
        for (const g of girdiler) {
          const ham = Number(g.chance ?? g.pct ?? 0);
          let sans = ham > 1 ? ham / 100 : ham;
          // RareEquip (seal'li) -> kendi kademe carpani; digerleri -> itemDropRate
          const muhur = this.itemStats?.get(g.itemId ?? g.id)?.seal;
          sans *= muhur ? (muhurCarpan[muhur] ?? muhurCarpan.bronze) : esyaCarpan;
          if (sans > 0 && Math.random() < sans) {
            cikan.push({ itemId: g.itemId ?? g.id, qty: adet(g.qty) });
          }
        }
      }
      /* ALTIN SANSI: tablolarda 0.70-0.90 arasi. Eskiden bu SANS YOK SAYILIYOR
         ve dahasi tablo yoksa uydurma bir formulle HER ZAMAN altin veriliyordu
         ("surekli yang dusuyor"). Artik sansa uyulur ve uydurma yedek yoktur. */
      const ga = tablo.gold ?? tablo.altin;
      if (ga) {
        const sans = ga.chance == null ? 1 : (ga.chance > 1 ? ga.chance / 100 : ga.chance);
        if (Math.random() < sans) {
          altin = Math.round(ga.min + Math.random() * Math.max(0, (ga.max ?? ga.min) - ga.min));
        }
      }
    }
    return { items: cikan, gold: altin };
  }
}
