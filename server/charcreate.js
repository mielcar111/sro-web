/**
 * Karakter olusturma - istemcinin gonderdigi sozlesmenin BIREBIR karsiligi.
 *
 * Istemci (DNt bileseni) su cagriyi yapiyor:
 *     createCharacter({ name, style, armorClass, weapon })
 * `race` ve `gender` GONDERILMEZ - ikisi de `style` icinde gizlidir.
 *
 * Baslangic ekipmani istemcideki wNt() fonksiyonunun aynisi:
 *     onEk    = race === 'european' ? 'eu_' : ''
 *     zirh    = ['head','shoulder','chest','pants','gloves','boots']
 *               -> `${onEk}${armorClass}01_${slot}`
 *     silah   -> `${weapon}01`
 *     tek el ise kalkan -> `${onEk}shield01`
 *
 * Hicbiri uydurulmadi; hepsi cozulmus istemci paketinden okundu.
 */

/* Baslangic ekipmaninin ORNEK alanlari (plus/variance/dur/maxDur) icin ortak
   uretici - bkz. esya.js basligi (plan maddesi 26). */
import { yeniYigin } from './esya.js';

/** TNt - istemcideki irk listesi (turkish/arabian henuz kapali). */
export const RACES = [
  { id: 'chinese', enabled: true },
  { id: 'european', enabled: true },
  { id: 'turkish', enabled: false },
  { id: 'arabian', enabled: false },
];

/** O7.characterPresets - 16 gorunum, id -> irk + cinsiyet */
export const PRESETS = {
  chinaman_bogy:          { race: 'chinese',  gender: 'male' },
  chinaman_fighter:       { race: 'chinese',  gender: 'male' },
  chinaman_warrior:       { race: 'chinese',  gender: 'male' },
  chinaman_adventurer:    { race: 'chinese',  gender: 'male' },
  chinawoman_fighter:     { race: 'chinese',  gender: 'female' },
  chinawoman_warrior:     { race: 'chinese',  gender: 'female' },
  chinawoman_adventurer:  { race: 'chinese',  gender: 'female' },
  chinawoman_kisaeng:     { race: 'chinese',  gender: 'female' },
  europeman_knight:       { race: 'european', gender: 'male' },
  europeman_warrior:      { race: 'european', gender: 'male' },
  europeman_gladiator:    { race: 'european', gender: 'male' },
  europeman_adventurer:   { race: 'european', gender: 'male' },
  europewoman_knight:     { race: 'european', gender: 'female' },
  europewoman_amazoness:  { race: 'european', gender: 'female' },
  europewoman_gladiator:  { race: 'european', gender: 'female' },
  europewoman_adventurer: { race: 'european', gender: 'female' },
};

/** k7 - zirh siniflari */
export const ARMOR_CLASSES = ['heavy', 'light', 'clothes'];

/**
 * bNt / xNt - irka gore silahlar (oneHand = kalkan tasiyabilir)
 *
 * PAKETTEN BIREBIR (index-BUMMQVRB.js ~satir 27205285):
 *   bNt = [sword, blade, glavie, spear, bow]                        -> 5 silah
 *   xNt = [eu_sword, eu_tsword, eu_axe, eu_dagger, eu_crossbow,
 *          eu_darkstaff, eu_tstaff, eu_staff, eu_harp]              -> 9 silah
 *
 * ESKIDEN eksik/yanlisti: eu_tstaff / eu_staff / eu_harp HIC YOKTU ve
 * eu_darkstaff'in oneHand'i false yazilmisti (dogrusu TRUE). Istemci
 * "Cift El Asasi" (eu_tstaff) secince sunucu bad_weapon -> HTTP 400 donuyor,
 * arayuz de "Istek basarisiz" diyordu. Cin listesi zaten dogruydu; sorun
 * SADECE Avrupa irkindaydi.
 */
export const WEAPONS = {
  chinese: [
    { id: 'sword',  oneHand: true },
    { id: 'blade',  oneHand: true },
    { id: 'glavie', oneHand: false },
    { id: 'spear',  oneHand: false },
    { id: 'bow',    oneHand: false },
  ],
  european: [
    { id: 'eu_sword',     oneHand: true },
    { id: 'eu_tsword',    oneHand: false },
    { id: 'eu_axe',       oneHand: false },
    { id: 'eu_dagger',    oneHand: false },
    { id: 'eu_crossbow',  oneHand: false },
    { id: 'eu_darkstaff', oneHand: true },
    { id: 'eu_tstaff',    oneHand: false },
    { id: 'eu_staff',     oneHand: true },
    { id: 'eu_harp',      oneHand: false },
  ],
};

/** CNt - zirh yuvalari (bu sirayla) */
export const ARMOR_SLOTS = ['head', 'shoulder', 'chest', 'pants', 'gloves', 'boots'];

/** rY - tum ekipman yuvalari, iY() bunun indeksini dondurur */
export const SLOT_ORDER = [
  'weapon', 'shield', 'head', 'shoulder', 'chest', 'gloves', 'pants', 'boots',
  'avatarDress', 'avatarHat', 'avatarAttach', 'earring', 'necklace', 'ringL', 'ringR',
];

export function raceOfStyle(style) { return PRESETS[style]?.race ?? null; }
export function genderOfStyle(style) { return PRESETS[style]?.gender ?? null; }

/**
 * Gonderilen istegi dogrular. Gecersizse { hata } doner.
 * Istemci sadece gecerli kombinasyon gonderir; yine de sunucu guvenmez.
 */
export function validateCreate({ name, style, armorClass, weapon }) {
  const nm = String(name ?? '').trim();
  if (nm.length < 2 || nm.length > 16) return { hata: 'bad_name' };
  const preset = PRESETS[style];
  if (!preset) return { hata: 'bad_style' };
  const race = RACES.find(r => r.id === preset.race);
  if (!race?.enabled) return { hata: 'race_disabled' };
  if (!ARMOR_CLASSES.includes(armorClass)) return { hata: 'bad_armor' };
  const w = WEAPONS[preset.race].find(x => x.id === weapon);
  if (!w) return { hata: 'bad_weapon' };
  return { name: nm, style, race: preset.race, gender: preset.gender, armorClass, weapon, oneHand: w.oneHand };
}

/**
 * wNt() - baslangic ekipmani. { yuvaAdi: S$ yigini } dondurur.
 *
 * MADDE 26: eskiden yalniz `{itemId, qty:1}` uretiliyordu, yani baslangic
 * ekipmani dur/maxDur/plus/variance TASIMIYORDU. Sonuc: istemci tooltipi
 * dayaniklilik cubugunu cizmiyordu (kosul `item.dur !== void 0 && item.maxDur`,
 * paket @27248124) ve sistem_dukkan.js'in tamir filtresi ayni sarta baktigi
 * icin baslangic kilici HIC tamir edilemiyordu.
 *
 * KAYNAK (uydurma yok): canli yakalama GERCEK/zone_init.json ->
 * zone.init.self.inventory.equip her yuvada tam kayit tasiyor:
 *   {"itemId":"sword01","qty":1,"plus":0,"variance":0,"dur":62,"maxDur":62}
 * sword01 rollRanges.durability = [62,76] -> variance 0 = aralik ALT SINIRI.
 * Uretimin TEK sahibi esya.yeniYigin() (dukkan/ganimet/kalicilik ile ayni kod).
 */
export function startingEquip({ race, armorClass, weapon, oneHand }) {
  const pre = race === 'european' ? 'eu_' : '';
  const eq = {};
  for (const s of SLOT_ORDER) eq[s] = null;
  for (const slot of ARMOR_SLOTS) {
    eq[slot] = yeniYigin(`${pre}${armorClass}01_${slot}`, 1);
  }
  eq.weapon = yeniYigin(`${weapon}01`, 1);
  if (oneHand) eq.shield = yeniYigin(`${pre}shield01`, 1);
  return eq;
}

/** Irk secim ekraninin gosterecegi liste (kapalilar dahil - istemci "COK YAKINDA" yazar). */
export function raceList() { return RACES.map(r => ({ ...r })); }
