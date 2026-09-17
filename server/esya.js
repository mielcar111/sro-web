/**
 * ESYA ORNEGI + DAYANIKLILIK CEKIRDEGI  (plan maddeleri 26 ve 25)
 * ============================================================================
 * NEDEN VAR: bir esya yigininin (S$ semasi) `plus / variance / dur / maxDur`
 * alanlari sunucuda BES ayri yerde uretiliyordu ve UCU alanlari HIC yazmiyordu:
 *
 *   sistem_dukkan.js  yeniEsya()          DOGRU   (dur/maxDur/plus/variance)
 *   sistem_kucuk-sistemler.js yeniEsya()  DOGRU   (ayni kodun kopyasi)
 *   charcreate.js     startingEquip()     EKSIK   -> {itemId, qty} (bu dosya duzeltiyor)
 *   gameloop.js       #cantayaEkle        EKSIK   -> {itemId, qty} (taslak raporda)
 *   kalicilik.js      stackKur()          YARIM   -> dur var, maxDur YOK
 *
 * SONUC: baslangic kilici ve yerden alinan her silah/zirh "ciplak" kaliyordu.
 * Istemcinin tooltipi dayaniklilik cubugunu ancak
 *     `item.dur !== void 0 && item.maxDur`   (paket @27248124)
 * iken ciziyor; sistem_dukkan.js'in tamir filtresi de ayni sarti ariyor. Yani
 * alan yoksa esya ne kirilabiliyor ne tamir edilebiliyor: onarim ekonomisi olu.
 *
 * ============================== KAYNAKLAR ==================================
 *  1) S$ yigin semasi - istemci paketi index-BUMMQVRB.js @25594700:
 *       S$ = X({ itemId: J(), qty: Y().int().min(1),
 *                plus: Y().int().min(0).optional(),
 *                dur: Y().int().min(0).optional(),
 *                maxDur: Y().int().min(1).optional(),
 *                variance: Y().int().nonnegative().optional(),
 *                blues: BJ(X({id,value})).optional(), rolls: ...optional() })
 *     `dur` min(0) -> 0 GECERLI bir deger (KIRIK esya); `maxDur` min(1).
 *
 *  2) CANLI YAKALAMA - GERCEK/zone_init.json, zone.init.self.inventory.equip
 *     (referans site, 2026-08-23, karakter Test21):
 *       weapon : {"itemId":"sword01","qty":1,"plus":0,"variance":0,"dur":62,"maxDur":62}
 *       shield : {"itemId":"shield01",...,"dur":46,"maxDur":46}
 *       head   : {"itemId":"clothes01_head",...,"dur":39,"maxDur":39}
 *     data/itemstats.json rollRanges.durability: sword01 [62,76], shield01
 *     [46,56], clothes01_* [39,48].  Yani BASLANGIC EKIPMANI variance=0 ->
 *     dur = maxDur = ARALIK ALT SINIRI. Bu, uydurma degil OLCUM.
 *     AYNI yakalamada canta yigini {"itemId":"speed_potion_01","qty":10} -
 *     TUKETILEBILIR yiginlarda ornek alani YOK. Bu modul de eklemez.
 *
 *  3) Dayaniklilik degeri variance'in 0. NITELIK GRUBUNDAN gelir (ymt @25578020:
 *     weapon/armor/shield dizilimlerinin ilki her zaman ['durability']).
 *     Hesap combat.js'in PAYLASILAN statRulo()'sundan gecer (plan maddesi 9) -
 *     burada IKINCI bir kopya YAZILMAZ, yoksa iki kural birbirinden ayrilir.
 *
 *  4) Asinma olasiliklari - data/gelistirme/enhance.json `durability` blogu.
 *     Bu blok istemci paketinde HEM sema HEM gomulu varsayilan olarak duruyor:
 *       @8703698  durability: X({ weaponLossChancePerAttack: Y().min(0).max(1),
 *                                 armorLossChancePerHitTaken: Y().min(0).max(1),
 *                                 shieldLossChancePerBlock:  Y().min(0).max(1) })
 *       @8753890  durability: { weaponLossChancePerAttack: .01,
 *                               armorLossChancePerHitTaken: .0067,
 *                               shieldLossChancePerBlock: .0167 }
 *     Yani ORAN UYDURULMADI, referans oyunun kendi verisinden okunuyor. referans oyunun
 *     kendi $comment'i de (paket @8753065, bizdeki dosyayla BIREBIR ayni)
 *     kuralin tarifini veriyor:
 *       "Durability drops probabilistically (weapon per attack/skill strike,
 *        armor per hit taken, shield per block); at 0 the piece contributes
 *        no stats until repaired. The wear chances are EXPLICIT NON-PARITY
 *        POLICY: the original wear trigger/probability is [UNRESOLVED]..."
 *     Yani oranlarin kendisi referans oyunun ACIKCA isaretlenmis politikasidir;
 *     biz o politikayi oldugu gibi okuyoruz, kendi sayimizi koymuyoruz.
 *
 *     [ISARETLI BOSLUK] "armor per hit taken" HANGI zirh parcasinin asindigini
 *     SOYLEMIYOR ve pakette de yok. En dar okuma uygulaniyor: darbe basina TEK
 *     zar, tutarsa GIYILI zirh parcalarindan biri (esit olasilikla) 1 dusuyor.
 *     Parca basina ayri zar atmak orani 6 kat buyuturdu - o yuzden yapilmiyor.
 *
 *  5) Kirilma bildirimi ve kapilari (hepsi tr.json'da GERCEKTEN var):
 *       sys.combat.item_broke     @25605319  "{item} kirildi! Bir tuccarda tamir ettir."
 *       err.skill.weapon_broken   @25607816  "Silahiniz kirik - dayanikliligi 0."
 *       err.skill.shield_broken   @25607840  "Kalkaniniz kirik - dayanikliligi 0."
 *       ui.tooltip.broken         istemci `item.dur === 0` dalinda (@27248124)
 *
 * ============================ KULLANIM ====================================
 *   import * as esya from './esya.js';
 *   esya.yeniYigin(def, 1)                  -> {itemId, qty, plus, variance, dur, maxDur}
 *   esya.yeniYigin(potionDef, 10)           -> {itemId, qty}          (ornek alani YOK)
 *   esya.asindir(yigin, esya.ASINMA.silah)  -> 'kirildi' | 'asindi' | null
 *   esya.kirikMi(yigin)                     -> true/false
 *
 * Modul SAF'tir: ws/frame/DB bilmez, yalniz yigin nesnesi ve esya tanimi ile
 * calisir. Bu yuzden hem sunucu modulleri hem testler ayni kodu kullanabilir.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { statRulo } from './combat.js';

const BURASI = path.dirname(fileURLToPath(import.meta.url));

/** Istemcideki vY() (paket ~658288): "ekipman" sayilan turler. */
export const EKIPMAN_TURLERI = new Set(['weapon', 'shield', 'armor', 'accessory']);

/* ------------------------------------------------------------------ katalog
 * charcreate.js gibi ctx'i OLMAYAN moduller de bu yardimciyi cagirabilsin diye
 * itemstats.json TEMBEL yukleniyor. Sunucu ayaktayken COMBAT.itemStats zaten
 * ayni dosyadan kurulu; katalogBagla() ile o harita verilirse ikinci kopya
 * bellekte tutulmaz. */
let KATALOG = null;

/** Hazir bir Map<itemId, def> baglar (server.js/COMBAT.itemStats gibi). */
export function katalogBagla(harita) {
  if (harita && typeof harita.get === 'function') KATALOG = harita;
  return KATALOG;
}

function katalog() {
  if (KATALOG) return KATALOG;
  KATALOG = new Map();
  try {
    const p = path.join(BURASI, 'data', 'itemstats.json');
    for (const it of JSON.parse(fs.readFileSync(p, 'utf8'))) {
      if (it?.id) KATALOG.set(it.id, it);
    }
  } catch { /* katalog yoksa yigin yalin {itemId,qty} kalir - sessiz gerileme */ }
  return KATALOG;
}

/** itemId -> itemstats.json kaydi (yoksa null). */
export function esyaTanimi(id) {
  if (!id) return null;
  return katalog().get(id) ?? null;
}

/** Tanim ekipman mi? (string id de kabul eder) */
export function ekipmanMi(defVeyaId) {
  const def = typeof defVeyaId === 'string' ? esyaTanimi(defVeyaId) : defVeyaId;
  return !!def && EKIPMAN_TURLERI.has(def.type);
}

/* -------------------------------------------------------------- dayaniklilik
 * Emt (@25580034) uzerinden: kesir = xmt(variance, 0)/31, deger = min +
 * (max-min)*kesir, sonra TAMSAYIYA kirpma (bmt kumesinde `durability` var).
 * Hesabin TEK sahibi combat.js/statRulo - burada kopyalanmaz. */
export function dayaniklilikDegeri(def, { variance = 0, plus = 0 } = {}) {
  if (!Array.isArray(def?.rollRanges?.durability)) return null;
  const d = statRulo(def, { variance, plus }).statlar?.durability;
  if (!Number.isFinite(d) || d < 1) return null;
  return Math.trunc(d);
}

/**
 * TEK esya uretim noktasi (plan maddesi 26).
 *
 * @param def     itemstats.json kaydi (ya da itemId dizesi)
 * @param adet    yigin adedi (>=1)
 * @param secenek { variance, plus } - varsayilan 0/0, yani canli yakalamadaki
 *                baslangic/dukkan esyasiyla BIREBIR (dur = aralik alt siniri).
 *                Ganimetin variance'i RULO MU sabit 0 mi oldugu referans oyundan
 *                COZULEMEDI (plan maddesi 26 yalniz "alanlar VAR olsun" diyor),
 *                bu yuzden burada sayi uydurulmuyor: cagiran acikca vermezse 0.
 * @returns S$ bicimli yigin nesnesi
 */
export function yeniYigin(def0, adet = 1, secenek = {}) {
  const def = typeof def0 === 'string' ? esyaTanimi(def0) : def0;
  const itemId = def?.id ?? (typeof def0 === 'string' ? def0 : null);
  const qty = Math.max(1, Math.trunc(Number(adet) || 1));
  const yigin = { itemId, qty };
  if (!def || !EKIPMAN_TURLERI.has(def.type)) return yigin;   // tuketilebilir: alan YOK

  const variance = Math.max(0, Math.trunc(Number(secenek.variance) || 0));
  const plus = Math.max(0, Math.trunc(Number(secenek.plus) || 0));
  /* Ekipmanda plus/variance HER ZAMAN yazilir: canli yakalamada aksesuar
     disindaki her yuvada ikisi de duruyor ve statRulo variance'i grup grup
     okudugu icin alanin YOKLUGU ile 0 OLMASI ayni sonucu vermeli. */
  yigin.plus = plus;
  yigin.variance = variance;

  /* dur/maxDur yalniz rollRanges.durability OLAN esyada. Aksesuarlarin
     (288 kayit) durability araligi yok; istemcinin tamir dongusu de
     `def.type === 'accessory'` olani zaten atliyor (_Lt @27499280). */
  const d = dayaniklilikDegeri(def, { variance, plus });
  if (d !== null) { yigin.dur = d; yigin.maxDur = d; }
  return yigin;
}

/**
 * Elde HAZIR bir yigin varsa eksik ornek alanlarini tamamlar (uretmez, TAMIR
 * eder). Eski kayitlar, vSRO'dan donen esyalar ve GM esyalari icin.
 * Var olan alanlara DOKUNMAZ - yalniz eksikleri doldurur.
 * @returns degisiklik yapildiysa true
 */
export function yiginTamamla(yigin, def0 = null) {
  if (!yigin || typeof yigin !== 'object' || !yigin.itemId) return false;
  const def = def0 ?? esyaTanimi(yigin.itemId);
  if (!def || !EKIPMAN_TURLERI.has(def.type)) return false;
  let degisti = false;
  if (yigin.variance == null) { yigin.variance = 0; degisti = true; }
  if (yigin.plus == null) { yigin.plus = 0; degisti = true; }
  const d = dayaniklilikDegeri(def, { variance: yigin.variance, plus: yigin.plus });
  if (d === null) return degisti;
  if (yigin.maxDur == null) { yigin.maxDur = d; degisti = true; }
  /* dur === 0 GECERLI (kirik esya) - `== null` ile bakiliyor ki 0 ezilmesin. */
  if (yigin.dur == null) { yigin.dur = yigin.maxDur; degisti = true; }
  return degisti;
}

/* ============================================================ ASINMA (md. 25)
 * Oranlar data/gelistirme/enhance.json `durability` blogundan; dosya yoksa ya
 * da blok eksikse asinma UYGULANMAZ (sifir). Sayi ASLA burada yazilmaz. */
function asinmaOku() {
  try {
    const p = path.join(BURASI, 'data', 'gelistirme', 'enhance.json');
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    const d = j?.durability ?? null;
    const oran = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 1 ? Number(v) : 0);
    return {
      silah: oran(d?.weaponLossChancePerAttack),
      zirh: oran(d?.armorLossChancePerHitTaken),
      kalkan: oran(d?.shieldLossChancePerBlock),
      /* Blok gercekten okundu mu? Yanlis konfigurasyonu sessizce "asinma yok"
         diye gecirmemek icin cagiran bunu loglayabilir. */
      okundu: !!d,
    };
  } catch {
    return { silah: 0, zirh: 0, kalkan: 0, okundu: false };
  }
}

/**
 * Asinma olasiliklari (0..1).
 *   ASINMA.silah   - saldiran silahi, VURUS/BECERI DARBESI basina
 *   ASINMA.zirh    - hasar alanin bir zirh parcasi, DARBE basina
 *   ASINMA.kalkan  - blok GERCEKLESTIGINDE kalkan
 * KAYNAK: enhance.json durability (paket @8703698 sema / @8753890 varsayilan).
 */
export const ASINMA = asinmaOku();

/** Kirik mi? Istemcinin tooltip kurali: `item.dur === 0` (@27248124). */
export function kirikMi(yigin) {
  return !!yigin && Number(yigin.dur) === 0 && yigin.maxDur != null;
}

/**
 * Dayaniklilik zarini atar ve tutarsa 1 dusurur.
 *
 * @param yigin   S$ yigini (dur/maxDur tasimiyorsa DOKUNULMAZ)
 * @param olasilik 0..1 (ASINMA.* degerlerinden biri)
 * @param zar     test edilebilirlik icin; varsayilan Math.random
 * @returns 'kirildi' (bu darbede 0'a dustu) | 'asindi' | null (degismedi)
 */
export function asindir(yigin, olasilik, zar = Math.random) {
  if (!yigin || yigin.dur == null || yigin.maxDur == null) return null;
  const p = Number(olasilik);
  if (!(p > 0)) return null;
  const dur = Math.trunc(Number(yigin.dur));
  if (!Number.isFinite(dur) || dur <= 0) return null;   // zaten kirik
  if (zar() >= p) return null;
  yigin.dur = dur - 1;
  return yigin.dur === 0 ? 'kirildi' : 'asindi';
}

/** Kusamdaki zirh yuvalari (istemcinin CNt sirasi - charcreate.ARMOR_SLOTS). */
export const ZIRH_YUVALARI = ['head', 'shoulder', 'chest', 'pants', 'gloves', 'boots'];

/**
 * "armor per hit taken" - darbe basina TEK zar; tutarsa giyili zirh
 * parcalarindan biri (esit olasilikla) 1 asinir.
 * Parca secimi pakette YOK; bkz. dosya basligi [ISARETLI BOSLUK].
 * @returns { yuva, sonuc } | null
 */
export function zirhAsindir(equip, zar = Math.random) {
  if (!equip || !(ASINMA.zirh > 0)) return null;
  if (zar() >= ASINMA.zirh) return null;
  const adaylar = [];
  for (const y of ZIRH_YUVALARI) {
    const it = equip[y];
    if (it && it.dur != null && it.maxDur != null && Number(it.dur) > 0) adaylar.push(y);
  }
  if (!adaylar.length) return null;
  const yuva = adaylar[Math.min(adaylar.length - 1, Math.floor(zar() * adaylar.length))];
  const it = equip[yuva];
  const dur = Math.trunc(Number(it.dur));
  it.dur = dur - 1;
  return { yuva, sonuc: it.dur === 0 ? 'kirildi' : 'asindi' };
}

/* ------------------------------------------------------ istemci anahtarlari
 * Cagiran moduller bu adlari elle yazmasin diye tek yerde. Hepsi istemcinin
 * Tht / Eht enum'unda VE client/assets/locales/tr.json icinde GERCEKTEN var. */
export const ANAHTAR = {
  KIRILDI: 'sys.combat.item_broke',     // @25605319
  SILAH_KIRIK: 'err.skill.weapon_broken',   // @25607816
  KALKAN_KIRIK: 'err.skill.shield_broken',  // @25607840
};

export default {
  EKIPMAN_TURLERI, ZIRH_YUVALARI, ASINMA, ANAHTAR,
  katalogBagla, esyaTanimi, ekipmanMi, dayaniklilikDegeri,
  yeniYigin, yiginTamamla, kirikMi, asindir, zirhAsindir,
};
