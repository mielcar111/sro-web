/**
 * gen_drops2.mjs — GERCEK vSRO ganimet zincirinden data/drops.json uretir.
 * ===========================================================================
 *
 * NEDEN YENI URETICI?
 *   Eski `gen_drops.mjs` sadece `_RefMonster_AssignedItemDrop` (mob'a OZEL
 *   atanmis esyalar) + `_RefDropGold` okuyordu. O tablodaki 991 satirin
 *   TAMAMI `ITEM_ETC_ARCHEMY_*` (simya malzemesi / gorev esyasi) — referans oyun
 *   kataloğunda (itemstats.json) simya malzemesi HIC YOK, bu yuzden 420/420
 *   esya kodu eslesmiyordu ve moblardan yalnizca altin dusuyordu.
 *
 *   Silkroad'da normal ekipman/iksir ganimeti mob'a OZEL DEGILDIR; mob'un
 *   SEVIYESINE gore "sinif secim" (class selection) tablolarindan uretilir.
 *   Asagidaki zincir iste odur.
 *
 * ===========================================================================
 * vSRO GANIMET ZINCIRI  (mob oldugunde, sirasiyla)
 * ===========================================================================
 *
 *   mob olur  ->  MonLevel = mob seviyesi
 *   |
 *   +-- (1) ALTIN
 *   |     _RefDropGold[MonLevel] -> DropProb, GoldMin, GoldMax
 *   |     rand() < DropProb  =>  altin = rastgele(GoldMin..GoldMax)
 *   |
 *   +-- (2) MOB'A OZEL SABIT GANIMET
 *   |     _RefMonster_AssignedItemDrop[RefMonsterID]
 *   |       -> RefItemID, DropAmountMin/Max, DropRatio (bagimsiz sans)
 *   |     (bu shard'da hepsi simya malzemesi -> referans oyun karsiligi yok)
 *   |
 *   +-- (3) MOB'A OZEL GRUP GANIMETI  (sadece essiz/bos sandik moblari, 97 kayit)
 *   |     _RefMonster_AssignedItemRndDrop -> RefItemGroupID, DropRatio
 *   |       -> _RefDropItemGroup[RefItemGroupID] -> SelectRatio ile agirlikli
 *   |          tek esya secilir  (SelectRatio'lar grup icinde toplami 1 olur)
 *   |
 *   +-- (4) SINIF BAZLI GENEL GANIMET   <<< ASIL EKSIK OLAN HALKA
 *         her "sinif" (class) icin ayri bir tablo var; hepsi MonLevel ile
 *         indekslenir ve N adet `ProbGroupN` sutunu tasir:
 *
 *           _RefDropClassSel_Equip        (36 grup) — normal ekipman
 *           _RefDropClassSel_RareEquip    (36 grup) — muhurlu (rare) ekipman
 *           _RefDropClassSel_Recover      ( 7 grup) — HP/MP/canlilik iksiri
 *           _RefDropClassSel_Cure         (14 grup) — evrensel hap
 *           _RefDropClassSel_Scroll       ( 3 grup) — donus parsomeni
 *           _RefDropClassSel_Ammo         ( 6 grup) — ok / civi
 *           _RefDropClassSel_Reinforce    ( 2 grup) — guclendirme tarifi (elixir)
 *           _RefDropClassSel_Alchemy_MagicStone / _ATTRStone / _Tablet (12 grup)
 *
 *         ProbGroupN = "bu seviyedeki mob, bu sinifin N. grubundan BIR esya
 *         dusurme olasiligi" (0..1 arasi mutlak olasilik).
 *
 *         GRUP -> ADAY ESYA LISTESI iki farkli sekilde cozulur:
 *
 *         a) Equip / RareEquip:
 *              N == `_RefObjItem.ItemClass`  (1..36)
 *              KANIT: _RefDropClassSel_Equip her seviyede TEK sutun tasir ve
 *              o sutun mob seviyesiyle birlikte kayar:
 *                 Lv 1 -> g1  = ItemClass 1  = ITEM_CH_SWORD_01_A (ReqLevel 1)
 *                 Lv 5 -> g3  = ItemClass 3  = ITEM_CH_SWORD_01_C (ReqLevel 5)
 *                 Lv10 -> g5  = ItemClass 5  = ITEM_CH_SWORD_02_B (ReqLevel10)
 *                 Lv60 -> g21 = ItemClass 21 = ITEM_CH_SWORD_07_C (ReqLevel60)
 *                 Lv80 -> g26 = ItemClass 26 = ITEM_CH_SWORD_09_B (ReqLevel80)
 *              Equip = Rarity 0, RareEquip = Rarity > 0 (_RARE kodlari).
 *              Rare tarafta bir derecenin 3 sinifi seviye degil MUHUR RENGI
 *              demektir (hepsinin ReqLevel'i ayni): 3d-2=bronz, 3d-1=gumus,
 *              3d=altin. Olasiliklar da bunu dogruluyor (1/6, 1/375, 1/9009).
 *
 *         b) Diger siniflar:
 *              N == `_RefDropItemAssign.AssignedGroup` (1..13, esya kademesi)
 *              ve aday listesi ayrica sinifin esya turune gore suzulur
 *              (TypeID2/TypeID3/TypeID4 + kod adi).
 *              Alchemy_MagicStone'da N ayni zamanda TASIN DERECESIDIR ve
 *              referans oyun kimligi MATTR baglantisiyla cozulur (tasKimligi);
 *              Reinforce'ta yalniz grup 2 doludur (B tarifleri, tek jw
 *              elixir kademesine daraltilir — FIYAT_MUAF_ESLESME basligi).
 *
 *         ADAY ICINDEN SECIM (`_RefDropItemAssign`):
 *              Prob_Relative : grup icindeki AGIRLIK. Ekipmanda parcaya gore
 *                              sabit: kask 10, diger zirh 50, kupe/kolye 80,
 *                              silah/kalkan 100, yuzuk 140.
 *              Prob_Absolute : secimden SONRA uygulanan yuzdelik kapi
 *                              (100 = her zaman, 50 = yarisi; or. evrensel hap)
 *              DropCount     : dusen ADET (ok/civi icin 20..250, digeri 1)
 *              Service       : 1 = yayinda. 0/2 satirlari ELENIR.
 *
 *         Bir esyanin TEK olme basina marjinal dusme olasiligi:
 *
 *              p(i) = ProbGroupN * (Prob_Relative(i) / SUM Prob_Relative)
 *                                * (Prob_Absolute(i) / 100)
 *
 *   +-- (5) YUKSELTME (+N) SECIMI
 *         _RefDropOptLvlSel : OptLevel 0..12, `Prob` KUMULATIFTIR
 *         (0.8833, 0.9667, 0.9905, ... 1.0) ve `ReqOnlineTime` dakika cinsinden
 *         o + seviyesine hak kazanmak icin gereken cevrimici sureyi verir.
 *         rand() cek, kumulatif esigi gecen ilk OptLevel = esyanin + seviyesi.
 *         >>> referans oyunun `ground_item` paketinde `plus` alani YOK, bu yuzden
 *             bu adim SADECE veri olarak drops.json'a yaziliyor (`$optLevelSel`),
 *             uygulanmiyor. Uygulanmasi pickup zincirine dokunmayi gerektirir.
 *
 * ===========================================================================
 * DUZLESTIRME (neden `items[]` duz bir liste?)
 * ===========================================================================
 *   combat.js `ganimet()` her girdiyi BAGIMSIZ olarak zar atarak degerlendirir.
 *   Bu yuzden zinciri yukaridaki p(i) marjinal olasiligina duzlestiriyoruz:
 *   beklenen dusme sayisi birebir ayni cikar. Tek fark, ayni gruptan iki esya
 *   birden dusebilmesidir; olasiligi ProbGroup^2 mertebesinde (Equip icin
 *   ~0.001) oldugu icin ihmal edilebilir.
 *
 * ===========================================================================
 * ORANLAR (data/game-config.json)
 * ===========================================================================
 *   goldRate      = 30 -> GoldMin/GoldMax ile CARPILIR (DropProb'a dokunulmaz)
 *   itemDropRate  = 1  -> rare OLMAYAN her esya sansiyla carpilir
 *                         (Equip, Recover, Cure, Scroll, Ammo, Reinforce,
 *                          Alchemy_*, mob'a ozel sabit/grup ganimeti)
 *   rareDropRate  = 1  -> SADECE _RefDropClassSel_RareEquip sansiyla carpilir
 *   Sonuc her zaman [0,1] araligina kirpilir.
 *
 * Calistir:  node gen_drops2.mjs
 * Ciktisi :  data/drops.json   (eskisi data/drops.json.bak-vsro olarak yedeklenir)
 */
import sql from 'mssql';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, 'data');
const CFG = JSON.parse(fs.readFileSync(path.join(HERE, 'config.json'), 'utf8'));
const C = CFG.sql;

const gameCfg = JSON.parse(fs.readFileSync(path.join(DATA, 'game-config.json'), 'utf8'));
const mobs = JSON.parse(fs.readFileSync(path.join(DATA, 'mobs.json'), 'utf8')).mobs;
const itemStats = JSON.parse(fs.readFileSync(path.join(DATA, 'itemstats.json'), 'utf8'));

const eskiYol = path.join(DATA, 'drops.json');
const eski = fs.existsSync(eskiYol) ? JSON.parse(fs.readFileSync(eskiYol, 'utf8')) : {};

// ---- referans oyun esya katalogu --------------------------------------------------
/** id -> esya tanimi (2860 kayit) */
const jwItems = new Map();
for (const it of Object.values(itemStats)) jwItems.set(it.id, it);

/**
 * items.json — itemstats.json'da OLMAYAN esyalarin calisma katalogu.
 * Simya taslari (magicstone_<effect>_<derece>, 15 aile x derece 1-8 = 120
 * kayit) itemstats'ta degil items.json items[] icinde yasar (magic-stones.json
 * ailelerinden acilir). Ayrica blueOptions.opts, vSRO MATTR kod adi -> referans oyun
 * effect anahtari eslemesinin PROJEDEKI kaynagi (or. MATTR_RESIST_FROSTBITE ->
 * fz, MATTR_DUR -> duru, MATTR_LUCK -> luck) — el tablosu tutulmaz.
 */
const itemsJson = JSON.parse(fs.readFileSync(path.join(DATA, 'items.json'), 'utf8'));
const jwGenel = new Map();
for (const it of itemsJson.items ?? []) jwGenel.set(it.id, it);
const mattrEffect = new Map();
for (const o of itemsJson.blueOptions?.opts ?? []) {
  if (o?.name && o?.effect && !mattrEffect.has(o.name)) mattrEffect.set(o.name, o.effect);
}

// ---- oranlar (game-config.json'dan; UYDURMA YOK) ---------------------------
const ORAN = {
  goldRate: Number(gameCfg.goldRate ?? 1),
  itemDropRate: Number(gameCfg.itemDropRate ?? 1),
  rareDropRate: Number(gameCfg.rareDropRate ?? 1),
};
const tunables = {
  ...ORAN,
  lootOwnerLockMs: gameCfg.lootOwnerLockMs,
  lootDespawnMs: gameCfg.lootDespawnMs,
  pickupRangeU: gameCfg.pickupRangeU,
  pickupSearchRangeU: gameCfg.pickupSearchRangeU,
};

// ===========================================================================
// vSRO CodeName128 -> referans oyun itemId
// ===========================================================================

/** _A -> "", _B -> "_b", _C -> "_c", _A_RARE -> "_bronze" ... */
function ekVaryant(harf, rare) {
  if (rare) return { A: '_bronze', B: '_silver', C: '_gold' }[harf] ?? null;
  return { A: '', B: '_b', C: '_c' }[harf] ?? null;
}

const CH_SILAH = { SWORD: 'sword', BLADE: 'blade', SPEAR: 'spear', TBLADE: 'glavie', BOW: 'bow' };
const EU_SILAH = {
  SWORD: 'eu_sword', TSWORD: 'eu_tsword', AXE: 'eu_axe', DAGGER: 'eu_dagger',
  CROSSBOW: 'eu_crossbow', DARKSTAFF: 'eu_darkstaff', TSTAFF: 'eu_tstaff',
  STAFF: 'eu_staff', HARP: 'eu_harp',
};
const ZIRH_SLOT = { HA: 'head', SA: 'shoulder', BA: 'chest', LA: 'pants', AA: 'gloves', FA: 'boots' };

/**
 * Ekipman kodunu referans oyun kimligine cevirir. referans oyunda cinsiyet AYRIMI YOK
 * (ITEM_CH_M_HEAVY_01_BA_A ve ITEM_CH_W_HEAVY_01_BA_A -> ikisi de heavy01_chest),
 * bu yuzden eslesme cok-a-bir olabilir; sanslar birlestirilir.
 * Eslesme bulunamazsa null doner (UYDURMA YOK).
 */
function ekipmanKimligi(kod) {
  let m;
  // zirh:  ITEM_(CH|EU)_(M|W)_(HEAVY|LIGHT|CLOTHES)_NN_(HA|SA|BA|LA|AA|FA)_X[_RARE]
  m = /^ITEM_(CH|EU)_[MW]_(HEAVY|LIGHT|CLOTHES)_(\d{2})_(HA|SA|BA|LA|AA|FA)_([ABC])(_RARE)?$/.exec(kod);
  if (m) {
    const on = m[1] === 'EU' ? 'eu_' : '';
    const ek = ekVaryant(m[5], !!m[6]);
    if (ek == null) return null;
    return `${on}${m[2].toLowerCase()}${m[3]}_${ZIRH_SLOT[m[4]]}${ek}`;
  }
  // cin silahi
  m = /^ITEM_CH_(SWORD|BLADE|SPEAR|TBLADE|BOW)_(\d{2})_([ABC])(_RARE)?$/.exec(kod);
  if (m) {
    const ek = ekVaryant(m[3], !!m[4]);
    return ek == null ? null : `${CH_SILAH[m[1]]}${m[2]}${ek}`;
  }
  // avrupa silahi
  m = /^ITEM_EU_(SWORD|TSWORD|AXE|DAGGER|CROSSBOW|DARKSTAFF|TSTAFF|STAFF|HARP)_(\d{2})_([ABC])(_RARE)?$/.exec(kod);
  if (m) {
    const ek = ekVaryant(m[3], !!m[4]);
    return ek == null ? null : `${EU_SILAH[m[1]]}${m[2]}${ek}`;
  }
  // kalkan
  m = /^ITEM_(CH|EU)_SHIELD_(\d{2})_([ABC])(_RARE)?$/.exec(kod);
  if (m) {
    const ek = ekVaryant(m[3], !!m[4]);
    return ek == null ? null : `${m[1] === 'EU' ? 'eu_' : ''}shield${m[2]}${ek}`;
  }
  // taki
  m = /^ITEM_(CH|EU)_(RING|EARRING|NECKLACE)_(\d{2})_([ABC])(_RARE)?$/.exec(kod);
  if (m) {
    const ek = ekVaryant(m[4], !!m[5]);
    return ek == null ? null : `${m[1] === 'EU' ? 'eu_' : ''}${m[2].toLowerCase()}${m[3]}${ek}`;
  }
  return null;
}

/**
 * Ekipman disi esyalar. Her satir vSRO Price+SellPrice+MaxStack ile referans oyun
 * buyPrice+sellPrice+stackMax karsilastirilarak DOGRULANMISTIR (bkz. rapor).
 * Tek istisna HP_SPOTION_01 -> hp_grain_01: fiyati HP_POTION_05 ile ayni
 * (600/210), ad ("Grain") ve kod ("SPOTION") uzerinden ayirt edildi.
 */
const SABIT_ESLESME = new Map(Object.entries({
  ITEM_ETC_HP_POTION_01: 'hp_potion_01', ITEM_ETC_HP_POTION_02: 'hp_potion_02',
  ITEM_ETC_HP_POTION_03: 'hp_potion_03', ITEM_ETC_HP_POTION_04: 'hp_potion_04',
  ITEM_ETC_HP_POTION_05: 'hp_potion_05',
  ITEM_ETC_MP_POTION_01: 'mp_potion_01', ITEM_ETC_MP_POTION_02: 'mp_potion_02',
  ITEM_ETC_MP_POTION_03: 'mp_potion_03', ITEM_ETC_MP_POTION_04: 'mp_potion_04',
  ITEM_ETC_MP_POTION_05: 'mp_potion_05',
  ITEM_ETC_ALL_POTION_01: 'vigor_potion_01', ITEM_ETC_ALL_POTION_02: 'vigor_potion_02',
  ITEM_ETC_ALL_POTION_03: 'vigor_potion_03', ITEM_ETC_ALL_POTION_04: 'vigor_potion_04',
  ITEM_ETC_ALL_POTION_05: 'vigor_potion_05',
  ITEM_ETC_HP_SPOTION_01: 'hp_grain_01',
  ITEM_ETC_MP_SPOTION_01: 'mp_grain_01',
  ITEM_ETC_ALL_SPOTION_01: 'vigor_grain_01',
  ITEM_ETC_CURE_ALL_01: 'pill_universal_01', ITEM_ETC_CURE_ALL_02: 'pill_universal_02',
  ITEM_ETC_CURE_ALL_03: 'pill_universal_03', ITEM_ETC_CURE_ALL_04: 'pill_universal_04',
  ITEM_ETC_CURE_ALL_05: 'pill_universal_05',
  ITEM_ETC_CURE_RANDOM_01: 'pill_purification_01', ITEM_ETC_CURE_RANDOM_02: 'pill_purification_02',
  ITEM_ETC_CURE_RANDOM_03: 'pill_purification_03', ITEM_ETC_CURE_RANDOM_04: 'pill_purification_04',
  ITEM_ETC_ARCHEMY_REINFORCE_PROB_UP_A_01: 'lucky_powder_01',
  ITEM_ETC_ARCHEMY_REINFORCE_PROB_UP_A_02: 'lucky_powder_02',
  ITEM_ETC_ARCHEMY_REINFORCE_PROB_UP_A_03: 'lucky_powder_03',
  ITEM_ETC_ARCHEMY_REINFORCE_PROB_UP_A_04: 'lucky_powder_04',
  ITEM_ETC_ARCHEMY_REINFORCE_PROB_UP_A_05: 'lucky_powder_05',
  ITEM_ETC_ARCHEMY_REINFORCE_PROB_UP_A_06: 'lucky_powder_06',
  ITEM_ETC_ARCHEMY_REINFORCE_PROB_UP_A_07: 'lucky_powder_07',
  ITEM_ETC_ARCHEMY_REINFORCE_PROB_UP_A_08: 'lucky_powder_08',
  ITEM_ETC_ARCHEMY_REINFORCE_RECIPE_WEAPON_A: 'elixir_weapon',
  ITEM_ETC_ARCHEMY_REINFORCE_RECIPE_ARMOR_A: 'elixir_armor',
  ITEM_ETC_ARCHEMY_REINFORCE_RECIPE_SHIELD_A: 'elixir_shield',
  ITEM_ETC_ARCHEMY_REINFORCE_RECIPE_ACCESSARY_A: 'elixir_accessory',
  ITEM_ETC_SPEED_UP_BASIC: 'speed_potion_01',
  ITEM_ETC_COS_HP_POTION_01: 'cos_hp_potion_01',
  ITEM_ETC_COS_HP_POTION_02: 'cos_hp_potion_02',
  ITEM_ETC_COS_HP_POTION_03: 'cos_hp_potion_03',
  ITEM_COS_P_REVIVAL: 'pet_revival_grass',
  ITEM_COS_P_HGP_POTION_01: 'pet_hgp_potion_01',
}));

/**
 * FIYAT MUAFI eslesmeler — satis fiyati DOGRULANAMAYAN ama kimligi baska
 * kanittan kesin olan kodlar (jwKimlik'teki SellPrice karsilastirmasi burada
 * atlanir; gerekce satir satir asagida).
 *
 * RECIPE_*_B -> elixir_* (TEK KADEME DARALTMASI): referans oyun katalogu her yuva
 * icin TEK elixir tasir (fiyati A kademesinden, 10000). vSRO ganimet
 * zincirinde ise yalniz 2. grup doludur (_RefDropClassSel_Reinforce
 * SUM(ProbGroup1)=0, SUM(ProbGroup2)=0.2422 — SELECT olcumu) ve 2. grubun
 * adaylari B tarifleridir (SellPrice 20000, _RefDropItemAssign Service=1).
 * Kimlik yuva turunden kesindir (WEAPON/ARMOR/SHIELD/ACCESSARY); fiyat farki
 * jw'nin tek kademesinin A fiyatindan uretilmis olmasidir. Bu girdiler
 * drops.json'da `$esleme` alaniyla isaretlenir (ganimet() okumaz, zararsiz).
 */
const FIYAT_MUAF_ESLESME = new Map(Object.entries({
  ITEM_ETC_ARCHEMY_REINFORCE_RECIPE_WEAPON_B: 'elixir_weapon',
  ITEM_ETC_ARCHEMY_REINFORCE_RECIPE_ARMOR_B: 'elixir_armor',
  ITEM_ETC_ARCHEMY_REINFORCE_RECIPE_SHIELD_B: 'elixir_shield',
  ITEM_ETC_ARCHEMY_REINFORCE_RECIPE_ACCESSARY_B: 'elixir_accessory',
}));

/**
 * Simya tasi kimligi — tamamen VERI baglantili zincir, el tablosu yok:
 *   vSRO tas satirinin _RefObjItem.Desc1_128 alani bagli mavi kodunu tasir
 *   (or. MAGICSTONE_FROSTBITE_01 -> MATTR_RESIST_FROSTBITE — SELECT olcumu)
 *   -> items.json blueOptions.opts ayni MATTR adini referans oyun effect anahtarina
 *   baglar (fz) -> jw tas kimligi magicstone_<effect>_<derece>. Derece = kod
 *   sonekindeki sayi; drop zincirinde _RefDropItemAssign.AssignedGroup ile
 *   BIREBIR ayni (154/154 satirda dogrulandi).
 * Fiyat muafiyeti: jw tas tanimlari EL YAPIMI (magic-stones.json $comment
 * "acquisition is ours", sellPrice 50) — vSRO SellPrice=1 ile fiyat paritesi
 * hicbir zaman kurulmadi; kimligi MATTR baglantisi tasir.
 * Katalogda olmayan kombinasyon null doner -> girdi DUSMEZ (uydurma yok):
 * derece 9-11 (jw maxDegree=8) ve jw tas ailesi olmayan efektler
 * (MATTR_SOLID -> soli, MATTR_EVADE_BLOCK/EVADE_CRITICAL -> evbl/evcr yalniz
 * mavi secenek, tas degil).
 */
function tasKimligi(kod, vsro) {
  const m = /^ITEM_ETC_ARCHEMY_MAGICSTONE_([A-Z_]+)_(\d{2})$/.exec(kod);
  if (!m) return null;
  const mattr = typeof vsro?.MagicOpt === 'string' ? vsro.MagicOpt.trim() : '';
  const effect = mattrEffect.get(mattr);
  if (!effect) return null;
  const aday = `magicstone_${effect}_${Number(m[2])}`;
  return jwGenel.get(aday)?.type === 'magicstone' ? aday : null;
}

const eslesmeyenKodlar = new Map();  // kod -> kac defa denendi
const fiyatUyusmazligi = [];

/** Kod -> referans oyun id; katalogda yoksa / fiyat tutmuyorsa null. */
function jwKimlik(kod, vsro) {
  const aday = SABIT_ESLESME.get(kod) ?? ekipmanKimligi(kod);
  if (aday && jwItems.has(aday)) {
    // DOGRULAMA: satis fiyati birebir tutmali (referans oyun katalogu vSRO'dan uretilmis)
    const jw = jwItems.get(aday);
    if (vsro && Number(jw.sellPrice) !== Number(vsro.SellPrice)) {
      fiyatUyusmazligi.push(`${kod} -> ${aday} (vsro ${vsro.SellPrice} != jw ${jw.sellPrice})`);
      eslesmeyenKodlar.set(kod, (eslesmeyenKodlar.get(kod) ?? 0) + 1);
      return null;
    }
    return aday;
  }
  // Fiyat muafi yollar (gerekceler yukaridaki iki blokta)
  const muaf = FIYAT_MUAF_ESLESME.get(kod) ?? tasKimligi(kod, vsro);
  if (muaf && (jwItems.has(muaf) || jwGenel.has(muaf))) return muaf;
  eslesmeyenKodlar.set(kod, (eslesmeyenKodlar.get(kod) ?? 0) + 1);
  return null;
}

// ===========================================================================
// SQL
// ===========================================================================
const pool = await new sql.ConnectionPool({
  server: C.server, user: C.user, password: C.password,
  database: C.databases.shard, options: C.options,
}).connect();
const q = async (s) => (await pool.request().query(s)).recordset;
console.log('SQL bagli ->', C.databases.shard);

// ---- mob referanslari -------------------------------------------------------
const vsroMobs = await q(`
  SELECT c.ID, c.CodeName128, ch.Lvl
  FROM _RefObjCommon c LEFT JOIN _RefObjChar ch ON ch.ID = c.Link
  WHERE c.CodeName128 LIKE 'MOB[_]%' AND c.Service = 1`);

const sadelestir = (s) => String(s).toLowerCase()
  .replace(/^mob[_]?(ch|eu|ar|tk|xmas|evt)?[_]?/, '')
  .replace(/[^a-z0-9]/g, '');

const vsroIndeks = new Map();
for (const m of vsroMobs) {
  const k = sadelestir(m.CodeName128);
  if (!vsroIndeks.has(k)) vsroIndeks.set(k, m);
}

/** Levenshtein (kisa adlar icin yeterli). */
function mesafe(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let onceki = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const simdi = [i];
    for (let j = 1; j <= n; j++) {
      simdi[j] = Math.min(onceki[j] + 1, simdi[j - 1] + 1,
        onceki[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    onceki = simdi;
  }
  return onceki[n];
}

/** gen_drops.mjs ile ayni eslestirme (158 mobun 156'sini buluyor). */
function mobEsle(oyunId) {
  const k = sadelestir(oyunId);
  if (vsroIndeks.has(k)) return vsroIndeks.get(k);
  for (const [vk, v] of vsroIndeks) {
    if (Math.abs(vk.length - k.length) <= 2 && (vk.includes(k) || k.includes(vk))) return v;
  }
  let enIyi = null, enIyiMesafe = Infinity, esitlik = 0;
  for (const [vk, v] of vsroIndeks) {
    if (Math.abs(vk.length - k.length) > 2) continue;
    const d = mesafe(k, vk);
    if (d < enIyiMesafe) { enIyiMesafe = d; enIyi = v; esitlik = 1; }
    else if (d === enIyiMesafe) esitlik++;
  }
  return (enIyiMesafe <= 2 && esitlik === 1) ? enIyi : null;
}

// ---- (1) altin --------------------------------------------------------------
const altinTablo = new Map();
for (const g of await q('SELECT MonLevel, DropProb, GoldMin, GoldMax FROM _RefDropGold')) {
  altinTablo.set(g.MonLevel, g);
}
const altinMaxLv = Math.max(...altinTablo.keys());

// ---- esya referans katalogu -------------------------------------------------
const refItem = new Map();   // ID -> {CodeName128, ItemClass, Rarity, TypeID*, Price, SellPrice, MagicOpt}
// MagicOpt (= _RefObjItem.Desc1_128): simya taslarinda bagli MATTR_* mavi kodu
// (tasKimligi bu alandan cozer); diger esyalarda kullanilmiyor.
for (const r of await q(`
  SELECT o.ID, o.CodeName128, o.TypeID1, o.TypeID2, o.TypeID3, o.TypeID4,
         o.Rarity, o.Price, o.SellPrice, o.ReqLevel1, i.ItemClass, i.MaxStack,
         i.Desc1_128 AS MagicOpt
  FROM _RefObjCommon o JOIN _RefObjItem i ON i.ID = o.Link
  WHERE o.TypeID1 = 3`)) refItem.set(r.ID, r);
console.log(`esya referansi   : ${refItem.size}`);

// ---- (4) sinif secim tablolari ---------------------------------------------
/**
 * SINIFLAR: tablo adi -> { grupKaynagi, sure }
 *   grupKaynagi 'itemclass'  : grup no == _RefObjItem.ItemClass
 *   grupKaynagi 'assigned'   : grup no == _RefDropItemAssign.AssignedGroup
 *   suz(r)                   : aday esyayi bu sinifa ait mi diye eler
 */
const SINIFLAR = [
  { ad: 'Equip', tablo: '_RefDropClassSel_Equip', kaynak: 'itemclass', rare: false,
    suz: (r) => r.Rarity === 0 },
  { ad: 'RareEquip', tablo: '_RefDropClassSel_RareEquip', kaynak: 'itemclass', rare: true,
    suz: (r) => r.Rarity > 0 },
  { ad: 'Recover', tablo: '_RefDropClassSel_Recover', kaynak: 'assigned', rare: false,
    suz: (r) => r.TypeID2 === 3 && r.TypeID3 === 1 },
  { ad: 'Cure', tablo: '_RefDropClassSel_Cure', kaynak: 'assigned', rare: false,
    suz: (r) => r.TypeID2 === 3 && r.TypeID3 === 2 },
  { ad: 'Scroll', tablo: '_RefDropClassSel_Scroll', kaynak: 'assigned', rare: false,
    suz: (r) => r.TypeID2 === 3 && r.TypeID3 === 3 },
  { ad: 'Ammo', tablo: '_RefDropClassSel_Ammo', kaynak: 'assigned', rare: false,
    suz: (r) => r.TypeID2 === 3 && r.TypeID3 === 4 },
  { ad: 'Reinforce', tablo: '_RefDropClassSel_Reinforce', kaynak: 'assigned', rare: false,
    suz: (r) => r.TypeID2 === 3 && r.TypeID3 === 10 },
  { ad: 'Alchemy_MagicStone', tablo: '_RefDropClassSel_Alchemy_MagicStone', kaynak: 'assigned', rare: false,
    suz: (r) => /ARCHEMY_MAGICSTONE_/.test(r.CodeName128) },
  { ad: 'Alchemy_ATTRStone', tablo: '_RefDropClassSel_Alchemy_ATTRStone', kaynak: 'assigned', rare: false,
    suz: (r) => /ARCHEMY_ATTRSTONE_/.test(r.CodeName128) },
  { ad: 'Alchemy_Tablet', tablo: '_RefDropClassSel_Alchemy_Tablet', kaynak: 'assigned', rare: false,
    suz: (r) => /ARCHEMY_(MAGIC|ATTR|POTION)TABLET_/.test(r.CodeName128) },
];

/**
 * RENK-KORUYUCU ESLENMEMIS SINIF GERI-DUSMESI (sartname madde 9)
 * ---------------------------------------------------------------------------
 * referans oyun katalogu maxDegree=8 (itemstats.json'da _09_ esyasi 0 adet). vSRO
 * sinif secim tablolari L76+ icin D9 gruplarini (25/26/27) isaret eder; bu
 * gruplarin TUM adaylari jwKimlik'te eslesemez -> tablo ekipmansiz kalir
 * (dt_bonegeneral_clon/dt_bonegeneral/dt_bonelord/dt_strong_bonegeneral).
 *
 * Kural: grubun referans oyun karsiligi olan TEK adayi bile yoksa hedef gruba dus.
 *   Equip     (sinif = seviye sortu) : 25 -> 24, 26 -> 24  (D8 C)
 *   RareEquip (sinif = MUHUR RENGI)  : renk KORUYARAK bir derece dus
 *       25 -> 22 (bronz), 26 -> 23 (gumus), 27 -> 24 (altin)
 *   RareEquip 25/26 -> 24 YASAK: D8-altin dogal tavani (g24=3.6e-5) ~100
 *   katina siser, bronz > gumus > altin merdiveni tersine doner.
 *
 * ProbGroup olasiligi mobun KENDI MonLevel satirindan aynen alinir (Equip
 * L76-79: 6.03e-4, L80-82: 5.33e-4; RareEquip L76-80: g25=3.554e-3/
 * g26=6.4e-5/g27=3e-6 — sqlcmd SELECT ile dogrulanmis). Agirliklar HEDEF
 * sinifin _RefDropItemAssign.Prob_Relative satirlarindan gelir (havuz zaten
 * o tablodan kurulur). Geri-dusen girdiler `$fallback` alaniyla, kapsam
 * `$kapsam.geriDusme` sayaciyla isaretlenir.
 */
const GERI_DUSME = {
  Equip: new Map([[25, 24], [26, 24]]),
  RareEquip: new Map([[25, 22], [26, 23], [27, 24]]),
};

/** tabloAdi -> Map(MonLevel -> Map(grupNo -> olasilik)) */
const sinifTablolari = new Map();
for (const s of SINIFLAR) {
  const lv = new Map();
  for (const r of await q(`SELECT * FROM ${s.tablo}`)) {
    const g = new Map();
    for (const [k, v] of Object.entries(r)) {
      if (k === 'MonLevel') continue;
      const p = Number(v);
      if (p > 0) g.set(Number(k.replace('ProbGroup', '')), p);
    }
    if (g.size) lv.set(Number(r.MonLevel), g);
  }
  sinifTablolari.set(s.ad, lv);
}
console.log(`sinif tablosu    : ${SINIFLAR.length}`);

// ---- aday havuzlari (_RefDropItemAssign) ------------------------------------
const assignSatir = await q(`
  SELECT RefItemID, Prob_Relative, Prob_Absolute, AssignedGroup, DropCount
  FROM _RefDropItemAssign
  WHERE Service = 1 AND Prob_Relative > 0 AND Prob_Absolute > 0`);
console.log(`assign satiri    : ${assignSatir.length} (Service=1, rel>0, abs>0)`);

/** sinifAdi -> Map(grupNo -> [{jwId, kod, w, abs, adet}]) */
const havuz = new Map();
for (const s of SINIFLAR) havuz.set(s.ad, new Map());

for (const a of assignSatir) {
  const ref = refItem.get(a.RefItemID);
  if (!ref) continue;
  for (const s of SINIFLAR) {
    // grup numarasi hangi kaynaktan geliyor?
    const grup = s.kaynak === 'itemclass'
      ? (a.AssignedGroup === -1 ? ref.ItemClass : null)   // ekipman satirlari AssignedGroup=-1 tasir
      : (a.AssignedGroup > 0 ? a.AssignedGroup : null);
    if (grup == null) continue;
    if (!s.suz(ref)) continue;
    const h = havuz.get(s.ad);
    if (!h.has(grup)) h.set(grup, []);
    h.get(grup).push({
      kod: ref.CodeName128,
      jwId: jwKimlik(ref.CodeName128, ref),
      w: Number(a.Prob_Relative),
      abs: Number(a.Prob_Absolute) / 100,
      adet: Number(a.DropCount) || 1,
    });
  }
}

// havuz istatistikleri
const havuzOzet = {};
for (const s of SINIFLAR) {
  let toplam = 0, eslesen = 0;
  for (const lst of havuz.get(s.ad).values()) {
    toplam += lst.length;
    eslesen += lst.filter((x) => x.jwId).length;
  }
  havuzOzet[s.ad] = { grup: havuz.get(s.ad).size, aday: toplam, oyunKarsiligiOlan: eslesen };
}

// ---- (2) mob'a ozel sabit ganimet -------------------------------------------
const ozelDrop = new Map();  // RefMonsterID -> [{kod, min, max, ratio}]
for (const d of await q(`
  SELECT RefMonsterID, RefItemID, DropAmountMin, DropAmountMax, DropRatio
  FROM _RefMonster_AssignedItemDrop`)) {
  const ref = refItem.get(d.RefItemID);
  if (!ref) continue;
  if (!ozelDrop.has(d.RefMonsterID)) ozelDrop.set(d.RefMonsterID, []);
  ozelDrop.get(d.RefMonsterID).push({
    kod: ref.CodeName128, jwId: jwKimlik(ref.CodeName128, ref),
    min: d.DropAmountMin ?? 1, max: d.DropAmountMax ?? 1,
    ratio: Number(d.DropRatio ?? 0),
  });
}

// ---- (3) mob'a ozel grup ganimeti -------------------------------------------
const grupIcerik = new Map();  // RefItemGroupID -> [{kod, jwId, oran}]
for (const g of await q('SELECT * FROM _RefDropItemGroup WHERE Service = 1')) {
  const ref = refItem.get(g.RefItemID);
  if (!grupIcerik.has(g.RefItemGroupID)) grupIcerik.set(g.RefItemGroupID, []);
  grupIcerik.get(g.RefItemGroupID).push({
    kod: ref?.CodeName128 ?? String(g.RefItemID),
    jwId: ref ? jwKimlik(ref.CodeName128, ref) : null,
    oran: Number(g.SelectRatio),
  });
}
const rndDrop = new Map();   // RefMonsterID -> [{grupId, min, max, ratio}]
for (const d of await q('SELECT * FROM _RefMonster_AssignedItemRndDrop WHERE Service = 1')) {
  if (!rndDrop.has(d.RefMonsterID)) rndDrop.set(d.RefMonsterID, []);
  rndDrop.get(d.RefMonsterID).push({
    grupId: d.RefItemGroupID, min: d.DropAmountMin ?? 1, max: d.DropAmountMax ?? 1,
    ratio: Number(d.DropRatio ?? 0),
  });
}

// ---- (5) yukseltme secimi (sadece veri olarak saklanir) ---------------------
const optLvl = (await q('SELECT * FROM _RefDropOptLvlSel ORDER BY OptLevel'))
  .map((r) => ({ optLevel: r.OptLevel, kumulatifProb: Number(r.Prob), gerekenCevrimiciDk: r.ReqOnlineTime }));

// ===========================================================================
// TABLOLARI KUR
// ===========================================================================
const tables = {};
const istat = {
  eslesenVsroMob: 0, eslesmeyenMob: [],
  toplamGirdi: 0, itemsiTabloYok: [],
  sinifKatkisi: {}, ozelDropEslesen: 0, ozelDropEslesmeyen: 0,
  geriDusme: { isaretliGirdi: 0, tabloBasina: {}, gecisler: {} },
};
for (const s of SINIFLAR) istat.sinifKatkisi[s.ad] = 0;

const kirp = (p) => Math.min(1, Math.max(0, p));

for (const m of mobs) {
  const tid = m.dropTableId;
  if (!tid) continue;
  const v = mobEsle(m.id);
  if (v) istat.eslesenVsroMob++; else istat.eslesmeyenMob.push(m.id);

  const lv = Math.max(1, Math.round(m.level ?? v?.Lvl ?? 1));

  // --- altin ---
  const g = altinTablo.get(Math.min(lv, altinMaxLv)) ?? altinTablo.get(1);
  const gold = g ? {
    chance: Number(g.DropProb),
    min: Math.round(g.GoldMin * ORAN.goldRate),
    max: Math.round(g.GoldMax * ORAN.goldRate),
  } : null;

  // --- esyalar: itemId -> {qty, chance} (ayni id birden fazla kaynaktan gelebilir) ---
  const birikim = new Map();
  const ekle = (jwId, qty, sans, kaynak, geriDusme = null) => {
    if (!jwId || !(sans > 0)) return;
    const onceki = birikim.get(jwId);
    if (onceki) {
      // bagimsiz iki kaynak: P(en az biri) = 1 - (1-p1)(1-p2)
      onceki.chance = 1 - (1 - onceki.chance) * (1 - sans);
      onceki.qty = Math.max(onceki.qty, qty);
    } else {
      birikim.set(jwId, { qty, chance: sans });
    }
    if (geriDusme) {
      const kayit = birikim.get(jwId);
      (kayit.fb ??= new Set()).add(geriDusme);
    }
    if (kaynak) istat.sinifKatkisi[kaynak] = (istat.sinifKatkisi[kaynak] ?? 0) + 1;
  };

  // (4) sinif bazli genel ganimet
  for (const s of SINIFLAR) {
    const gruplar = sinifTablolari.get(s.ad).get(lv);
    if (!gruplar) continue;
    const oran = s.rare ? ORAN.rareDropRate : ORAN.itemDropRate;
    for (const [grupNo, P] of gruplar) {
      let adaylar = havuz.get(s.ad).get(grupNo);
      let geriDusme = null;
      // RENK-KORUYUCU geri-dusme: grubun eslesen TEK adayi bile yoksa (D9)
      if (!adaylar?.some((x) => x.jwId)) {
        const hedefGrup = GERI_DUSME[s.ad]?.get(grupNo);
        const hedefAdaylar = hedefGrup != null ? havuz.get(s.ad).get(hedefGrup) : null;
        if (hedefAdaylar?.some((x) => x.jwId)) {
          geriDusme = `${s.ad} ${grupNo}->${hedefGrup}`;
          adaylar = hedefAdaylar;
          istat.geriDusme.gecisler[geriDusme] = (istat.geriDusme.gecisler[geriDusme] ?? 0) + 1;
        }
      }
      if (!adaylar?.length) continue;
      const toplamW = adaylar.reduce((a, x) => a + x.w, 0);
      if (!(toplamW > 0)) continue;
      for (const a of adaylar) {
        if (!a.jwId) continue;                       // referans oyun karsiligi yok -> ATLA
        ekle(a.jwId, a.adet, kirp(P * (a.w / toplamW) * a.abs * oran), s.ad, geriDusme);
      }
    }
  }

  // (2) mob'a ozel sabit ganimet
  for (const d of (v ? ozelDrop.get(v.ID) ?? [] : [])) {
    if (!d.jwId) { istat.ozelDropEslesmeyen++; continue; }
    istat.ozelDropEslesen++;
    ekle(d.jwId, d.max, kirp(d.ratio * ORAN.itemDropRate), null);
  }

  // (3) mob'a ozel grup ganimeti
  for (const d of (v ? rndDrop.get(v.ID) ?? [] : [])) {
    const icerik = grupIcerik.get(d.grupId) ?? [];
    const toplamOran = icerik.reduce((a, x) => a + x.oran, 0) || 1;
    for (const it of icerik) {
      if (!it.jwId) continue;
      ekle(it.jwId, d.max, kirp(d.ratio * (it.oran / toplamOran) * ORAN.itemDropRate), null);
    }
  }

  const items = [...birikim.entries()]
    .map(([itemId, x]) => {
      const g = { itemId, qty: x.qty, chance: +x.chance.toFixed(9) };
      // geri-dusme isareti: girdinin sansina en az bir geri-dusen kanal katkida
      // bulundu (combat.js ganimet() yalniz itemId/qty/chance okur — zararsiz)
      if (x.fb) g.$fallback = [...x.fb].sort().join('+');
      // tek kademe daraltmasi isareti (FIYAT_MUAF_ESLESME basligindaki gerekce)
      if (itemId.startsWith('elixir_')) g.$esleme = 'vSRO RECIPE_*_B (grup 2) -> jw tek elixir kademesi';
      return g;
    })
    .filter((x) => x.chance > 0)
    .sort((a, b) => b.chance - a.chance || a.itemId.localeCompare(b.itemId));

  const fbGirdi = items.filter((x) => x.$fallback).length;
  if (fbGirdi) {
    istat.geriDusme.isaretliGirdi += fbGirdi;
    istat.geriDusme.tabloBasina[tid] = fbGirdi;
  }

  istat.toplamGirdi += items.length;
  if (!items.length) istat.itemsiTabloYok.push(`${m.id}(lv${lv})`);

  tables[tid] = {
    mobId: m.id,
    vsroCode: v?.CodeName128 ?? null,
    vsroId: v?.ID ?? null,
    level: lv,
    gold,
    items,
  };
}

// ===========================================================================
// YAZ
// ===========================================================================
if (fs.existsSync(eskiYol)) {
  fs.copyFileSync(eskiYol, path.join(DATA, 'drops.json.bak-vsro'));
  console.log('yedek -> data/drops.json.bak-vsro');
}

const cikti = {
  $kaynak: {
    veritabani: C.databases.shard,
    uretici: 'gen_drops2.mjs',
    tablolar: [
      '_RefDropGold', '_RefDropItemAssign', '_RefDropItemGroup',
      '_RefMonster_AssignedItemDrop', '_RefMonster_AssignedItemRndDrop',
      '_RefDropOptLvlSel', ...SINIFLAR.map((s) => s.tablo),
    ],
    not: 'referans oyun drop tablolari istemci paketinde YOK. Gercek vSRO zincirinden '
       + 'uretildi: seviye -> sinif secim tablosu -> grup -> agirlikli esya secimi. '
       + 'itemId artik REFERANS OYUN kimligidir (itemstats.json ile dogrulanmis).',
    formul: 'p(esya) = ProbGroupN * (Prob_Relative / SUM Prob_Relative) * (Prob_Absolute/100) * oran',
  },
  $oranlar: tunables,
  $oranNasilUygulandi: {
    goldRate: 'GoldMin/GoldMax ile carpildi; DropProb degistirilmedi.',
    itemDropRate: 'rare OLMAYAN tum sanslarla carpildi (Equip/Recover/Cure/Scroll/'
                + 'Ammo/Reinforce/Alchemy + mob ozel ganimeti).',
    rareDropRate: 'sadece _RefDropClassSel_RareEquip sanslariyla carpildi.',
  },
  $optLevelSel: {
    $not: '_RefDropOptLvlSel — dusen ekipmanin +N seviyesi. Prob KUMULATIFTIR. '
        + 'referans oyun ground_item paketinde plus alani olmadigi icin HENUZ UYGULANMIYOR.',
    satirlar: optLvl,
  },
  $kapsam: {
    mobSayisi: mobs.length,
    eslesenVsroMob: istat.eslesenVsroMob,
    eslesmeyenMob: istat.eslesmeyenMob,
    tabloSayisi: Object.keys(tables).length,
    toplamEsyaGirdisi: istat.toplamGirdi,
    esyasizTablo: istat.itemsiTabloYok,
    havuzOzeti: havuzOzet,
    eslesmeyenVsroKodSayisi: eslesmeyenKodlar.size,
    fiyatUyusmazligi: fiyatUyusmazligi.slice(0, 20),
    ozelDrop: { eslesen: istat.ozelDropEslesen, eslesmeyen: istat.ozelDropEslesmeyen },
    geriDusme: {
      $not: 'RENK-KORUYUCU eslenmemis sinif geri-dusmesi (sartname madde 9): '
          + 'katalog maxDegree=8, D9 gruplari (25/26/27) eslesemez. Equip 25/26->24; '
          + 'RareEquip renk koruyarak 25->22 (bronz), 26->23 (gumus), 27->24 (altin). '
          + 'ProbGroup mobun KENDI MonLevel satirindan, agirliklar hedef sinifin '
          + '_RefDropItemAssign.Prob_Relative satirlarindan. Isaretli girdiler items[] '
          + 'icinde $fallback alani tasir (ganimet() yalniz itemId/qty/chance okur).',
      kural: { Equip: { 25: 24, 26: 24 }, RareEquip: { 25: 22, 26: 23, 27: 24 } },
      isaretliGirdi: istat.geriDusme.isaretliGirdi,
      tabloBasina: istat.geriDusme.tabloBasina,
      gecisler: istat.geriDusme.gecisler,
    },
    simya: {
      $not: 'Bu kosumda Alchemy/Reinforce zinciri ACILDI (onceden 0 girdi). '
          + 'Tas kimligi veri baglantili: DB _RefObjItem.Desc1_128 (MATTR_*) -> '
          + 'items.json blueOptions.opts (MATTR -> effect) -> '
          + 'magicstone_<effect>_<derece>; derece = kod soneki = AssignedGroup. '
          + 'referans oyun karsiligi OLMAYANLAR dusmez (uydurma yok): derece 9-11 '
          + '(jw maxDegree=8), MATTR_SOLID / MATTR_EVADE_BLOCK / '
          + 'MATTR_EVADE_CRITICAL (jw tas ailesi yok). ASTRAL/APE taslari jw '
          + 'katalogunda VAR ama vSRO assign satirlari Service=0/Prob_Relative=0 '
          + '-> ganimet zincirinde hic yoklar (veriye sadik). Elixir: '
          + '_RefDropClassSel_Reinforce yalniz grup 2 (B tarifleri) dolu; jw tek '
          + 'kademeye daraltildi, girdiler $esleme ile isaretli. Powder '
          + '(REINFORCE_PROB_UP): vSRO kaynaginda HIC drop kaydi yok (24 kodun '
          + 'tamaminda assign=0, monsterDrop=0, itemGroup=0 — SELECT olcumu) -> '
          + 'pisirilecek veri yok. ATTRStone/Tablet: jw karsiligi yok -> 0 girdi.',
    },
    sinifGirdileri: istat.sinifKatkisi,
  },
  dropTables: tables,
  monsterVariants: eski.monsterVariants ?? null,
  monsterRewards: eski.monsterRewards ?? null,
};

/** Kompakt yazici: items[] girdileri tek satir (dosya 60k+ girdi tasiyabiliyor). */
function yaz(o) {
  const kopya = JSON.parse(JSON.stringify(o));
  const yer = new Map();
  let n = 0;
  for (const t of Object.values(kopya.dropTables)) {
    const anahtar = `@@ITEMS${n++}@@`;
    yer.set(anahtar, '[' + t.items.map((i) => JSON.stringify(i)).join(',\n    ') + ']');
    t.items = anahtar;
  }
  let s = JSON.stringify(kopya, null, 1);
  for (const [k, v] of yer) s = s.replace(`"${k}"`, v);
  return s;
}
fs.writeFileSync(eskiYol, yaz(cikti));

// ---- rapor ------------------------------------------------------------------
console.log(`\nmob                : ${mobs.length}  (vSRO eslesen ${istat.eslesenVsroMob})`);
console.log(`drop tablosu       : ${Object.keys(tables).length}`);
console.log(`toplam esya girdisi: ${istat.toplamGirdi}`);
console.log(`esyasiz tablo      : ${istat.itemsiTabloYok.length}`);
console.log('\nsinif havuzlari (aday -> referans oyun karsiligi olan):');
for (const [ad, o] of Object.entries(havuzOzet)) {
  console.log(`  ${ad.padEnd(20)} grup=${String(o.grup).padStart(2)}  aday=${String(o.aday).padStart(5)}  eslesen=${String(o.oyunKarsiligiOlan).padStart(5)}`);
}
console.log('\nsinif bazinda uretilen girdi sayisi:');
for (const [ad, n] of Object.entries(istat.sinifKatkisi)) console.log(`  ${ad.padEnd(20)} ${n}`);
console.log(`\neslesmeyen farkli vSRO kodu: ${eslesmeyenKodlar.size}`);
const ilk = [...eslesmeyenKodlar.keys()].slice(0, 12);
if (ilk.length) console.log('  ornek:', ilk.join(', '));
if (fiyatUyusmazligi.length) {
  console.log(`\nFIYAT UYUSMAZLIGI (${fiyatUyusmazligi.length}) - bu esyalar ATLANDI:`);
  for (const f of fiyatUyusmazligi.slice(0, 10)) console.log('  ', f);
}
console.log(`\nozel drop: eslesen ${istat.ozelDropEslesen}, eslesmeyen ${istat.ozelDropEslesmeyen}`);
console.log(`\ngeri-dusme (madde 9): isaretli girdi ${istat.geriDusme.isaretliGirdi}, tablo ${Object.keys(istat.geriDusme.tabloBasina).length}`);
for (const [gecis, n] of Object.entries(istat.geriDusme.gecisler)) console.log(`  ${gecis.padEnd(20)} ${n} tablo`);
const orn = tables['dt_mangyang'];
if (orn) {
  console.log(`\nornek dt_mangyang (lv${orn.level}): altin ${JSON.stringify(orn.gold)}, ${orn.items.length} esya`);
  for (const i of orn.items.slice(0, 6)) console.log('   ', i.itemId, i.qty, i.chance);
}
console.log(`\n-> data/drops.json  (${(fs.statSync(eskiYol).size / 1048576).toFixed(2)} MB)`);
await pool.close();
