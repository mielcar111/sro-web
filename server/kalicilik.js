/**
 * ENVANTER KALICILIGI - canta + kusam.  IKI YOLLU (melez) saklama.
 *
 * ================================ NEDEN =====================================
 * Ilk surum her seyi SRO_WEB_GAME.dbo.WebCharInventory icinde StackJson olarak
 * tutuyordu; calisiyordu ama envanter vSRO'nun KENDI kayitlarinda GORUNMUYORDU
 * (_Items 33 satirin hepsi OptLevel=0 / Variance=0 / MagParamNum=0 - yani
 * yalnizca _AddNewChar'in yarattigi baslangic seti). Yani SMC, web paneli,
 * CleanDB, orijinal istemci... hicbiri oyuncunun gercek esyasini goremiyordu.
 *
 * Artik 2860 referans oyun esyasinin TAMAMI gercek bir _RefObjCommon.ID'ye bagli
 * (data/itemmap-tam.json, gen_itemmap.mjs urunudur, 2860/2860, cakisma yok).
 * Bu yuzden esyalarin buyuk bolumu ARTIK GERCEK vSRO KAYDI olarak yaziliyor:
 *
 *   1. YOL (birincil) : SRO_VT_SHARD.dbo._Items + dbo._Inventory
 *   2. YOL (yedek)    : SRO_WEB_GAME.dbo.WebCharInventory  (StackJson)
 *
 * 2. yol KALDIRILMADI ve KALDIRILMAMALI: bir esya 1. yola SIGMIYORSA (asagida
 * "YEDEGE DUSME NEDENLERI") sessizce kirpmak ya da atmak yerine yedek yola
 * yaziyoruz. Yedek yol bir GERI DUSME yoludur - veri kaybi degil, veri kaybini
 * ONLEYEN yoldur. Her iki yol da AYNI okuma fonksiyonundan (yukle) doner.
 *
 * ========================= KOLON ESLEMESI (BIREBIR) =========================
 * Kaynak: vSRO'nun kendi sakli yordamlari (OBJECT_DEFINITION ile okundu).
 *
 *   referans oyun S$ alani        -> vSRO _Items kolonu       kanit
 *   ---------------------------------------------------------------------------
 *   itemId (string)         -> RefItemID    int         itemmap-tam.json
 *   plus                    -> OptLevel     tinyint     _STRG_ADD_ITEM_MAGIC_NoTX
 *   variance                -> Variance     bigint      35 bit -> int32'ye SIGMAZ
 *   dur   (dayaniklilik)    -> Data         int         _ADD_ITEM_EXTERN:
 *                                                       "if (@IS_EQUIP = 1) ...
 *                                                        set @data = @dur"
 *   qty   (yigin adedi)     -> Data         int         ayni yordamin yigin dali:
 *                                                       "if (@data > @max_count)
 *                                                        set @data = @max_count"
 *   blues[] {id,value}      -> MagParamNum tinyint +    id  = _RefMagicOpt.ID
 *                              MagParam1..12 bigint     (391/416 birebir ayni)
 *   maxDur                  -> KOLON YOK  -> WebCharInventoryEk
 *   rolls  {asm,petExpiresAt,petLevel}
 *                           -> KOLON YOK  -> WebCharInventoryEk
 *
 * "Ekipman mi yigin mi" karari UYDURULMAZ, referans veriden gelir:
 *   itemmap-tam.json'daki durU (= _RefObjItem.Dur_U) > 0 ise esya DAYANIKLILIK
 *   tasir -> Data = dur.  0 ise -> Data = qty.
 *   OLCUM: bu kural referans oyunun kendi `rollRanges.durability` alaniyla 2860/2860
 *          ortusuyor (0 uyusmazlik) - iki bagimsiz kaynak ayni seyi soyluyor.
 *
 * MagParam ic bit duzeni DB tarafindan DAYATILMIYOR (hicbir yordam bu alan
 * uzerinde aritmetik yapmiyor), bu yuzden duzen BIZIM secimimiz:
 *      MagParam = (deger << 32) | secenekId          [magPaketle/magCoz]
 * secenekId <= 416 ve deger <= 65535 oldugu icin sonuc 2^53'un altinda kalir,
 * yani JS Number'da TAM olarak temsil edilir (mssql'e sql.BigInt ile gider).
 *
 * ======================== YUVA CEVRIMI (sabit tablo) ========================
 * referans oyun kusam sirasi (rY, paket ofseti 8687640) ile vSRO _Inventory.Slot
 * sirasi AYNI DEGIL. Cevrim asagida KUSAM_VSRO_SLOT tablosunda; vSRO tarafinin
 * kaynagi _AddNewChar yordamindaki kendi yorumlari:
 *   0 HELM(head) 1 MAIL(chest) 2 SHOULDERGUARD 3 GAUNTLET(gloves) 4 PANTS
 *   5 BOOTS 6 WEAPON 7 SHIELD 8 EARRING 9 NECKLACE 10 L_RING 11 R_RING
 * Canta 13'ten baslar (_ADD_ITEM_EXTERN: "where ... slot >= 13").
 *
 * ======================= YEDEGE DUSME NEDENLERI (hepsi loglanir) ============
 *  a) avatarDress / avatarHat / avatarAttach: bunlar _InventoryForAvatar'a
 *     gider ama o tablonun 5 yuvasindan HANGISININ hangi parca oldugu DB'den
 *     BELIRLENEMEDI (_AddNewChar yalnizca "cnt < 5" ile 5 bos yuva aciyor,
 *     _GetAvatarInventoryItem yuva adi icermiyor). BELIRSIZ bir kurali
 *     UYGULAMIYORUZ - avatar parcalari yedek yolda kaliyor.
 *  b) Canta yuvasi TASARIM SINIRININ otesinde (vSRO slot > VSRO_SON_SLOT=239).
 *     Bu bir ariza DEGIL, bilincli mimari karar (Mimari A, sartname-3 madde
 *     12; routes_auth.js createCharacter'daki `n.cnt <= 239` kelepcesi):
 *     _Inventory.Slot TINYINT ve ALTER YOK - canta 384 yuvanin son slotu
 *     13+383=396 zaten TINYINT'e SIGMAZ; _RefDummySlot da yalnizca 0..239
 *     uretir. Yani canta indeksi 227+ KALICI OLARAK yedek yolda yasar ve
 *     logda "tasarim-siniri" olarak ayri sayilir (asagida yuvaPlani).
 *  b2) _Inventory'de o yuvanin SATIRI yok (sinirin ICINDE ama satir acilmamis;
 *     _AddNewChar 0..108 acar, 109..239'u createCharacter aninda routes_auth
 *     acar, eski karakterler icin deploy_inventory_109_172.sql). Var olmayan
 *     satira yazmayiz; yeni satir da acmayiz (InventorySize ve CleanDB'nin isi).
 *  c) Esya itemmap-tam.json'da yok (or. sonradan eklenmis el yapimi esya).
 *  d) Tasma: OptLevel>255, Variance>2^35-1, MagParamNum>12 ya da
 *     >MaxMagicOptCount, qty>MaxStack. Sessizce KIRPMIYORUZ.
 *  e) 1. yol yazimi hata verdi -> o kayittaki HER SEY yedege yazilir.
 *
 * ============================== ATOMIKLIK ==================================
 * Iki AYRI veritabani var (SRO_VT_SHARD ve SRO_WEB_GAME), aralarinda dagitik
 * islem (MSDTC) kurmuyoruz. Elde edilebilir en guclu garanti: HER VERITABANI
 * KENDI ICINDE ATOMIK.
 *   - shard islemi: tum _Items UPDATE + _Inventory UPDATE + serbest birakma
 *     tek transaction; yarida kalirsa envanter ESKI haliyle kalir.
 *   - web islemi: DELETE + INSERT tek transaction (eski davranis korundu).
 * Sira: once shard, sonra web. shard yazimi patlarsa TUM icerik yedege
 * kaydirilir (hicbir sey kaybolmaz). web yazimi patlarsa imza guncellenmez,
 * bir sonraki kayitta yeniden denenir.
 *
 * ============================ YUKLEME KAPISI ================================
 * kaydet(), o karakter icin yukle() BASARIYLA tamamlanmadan CALISMAZ. Aksi
 * halde yukleme bitmeden kopan (ya da 30 sn'lik periyodik kayda yakalanan) bir
 * oturum, BOS bir cantayi yazip kayitli satirlari silerdi.
 *
 * ========================= YEDEK SATIR BOY KAPISI ===========================
 * AYNI KAPININ IKINCI YARISI. yukle() eskiden yedek yoldan gelen satiri
 * `row.Slot < canta.length` kosuluyla suzuyordu; gecemeyen satir SESSIZCE
 * ATILIYOR, ardindan kaydet()'in kosulsuz DELETE'i onu DB'den de siliyordu -
 * yani "bellege sigmadi" demek "KALICI OLARAK KAYBOLDU" demekti.
 * Bu gercek bir pencereydi: cantayi 384 yuvaya acan
 * sistem_banka-depo.cantaBoyunuGeriYukle SQL hatasinda null doner ve ch.bag 32
 * yuvada kalir (ayni durumda o modulun `yuksekYuvalariKurtar` telafisi de
 * calismaz, kosulu `boy > oncekiBoy`). Tek bir SQL tokezlemesi 2. sayfadan
 * sonrasini - ve tasarim geregi YALNIZ burada yasayan 227+ yuvalarini - yok
 * ederdi. Artik kayit otoriterdir: canta, satirin gerektirdigi boya kadar
 * BUYUTULUR (savunma tavani CANTA_TAVANI; Slot kolonu SMALLINT oldugu icin
 * bozuk bir satir aksi halde 32 bin elemanlik dizi actirirdi).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
/* maxDur BOSLUGU (plan maddesi 26 / fark #135): vSRO'da maxDur KOLONU YOK ve
   WebCharInventoryEk satiri yoksa esya "dur var / maxDur yok" halinde kaliyordu.
   Turetme dukkan/baslangic/ganimet yoluyla AYNI cekirdekten gecsin diye
   esya.js'ten aliniyor (o da combat.js statRulo'yu kullanir). */
import { dayaniklilikDegeri, esyaTanimi } from './esya.js';

const BURASI = path.dirname(fileURLToPath(import.meta.url));

/** Kusam yuva sirasi - PAKETTEN (rY, index-BUMMQVRB.js @8687640). */
export const KUSAM_YUVALARI = [
  'weapon', 'shield', 'head', 'shoulder', 'chest', 'gloves', 'pants', 'boots',
  'avatarDress', 'avatarHat', 'avatarAttach', 'earring', 'necklace', 'ringL', 'ringR',
];

/**
 * referans oyun kusam yuvasi -> vSRO _Inventory.Slot.
 * KAYNAK: _AddNewChar yordamindaki kendi yorum satirlari (EQUIP_SLOT_*).
 * avatarDress/avatarHat/avatarAttach BILEREK YOK - bkz. YEDEGE DUSME (a).
 */
export const KUSAM_VSRO_SLOT = {
  head: 0, chest: 1, shoulder: 2, gloves: 3, pants: 4, boots: 5,
  weapon: 6, shield: 7, earring: 8, necklace: 9, ringL: 10, ringR: 11,
};

/** vSRO'da canta bu yuvadan baslar (_ADD_ITEM_EXTERN: "slot >= 13"). */
export const VSRO_CANTA_BASI = 13;

/**
 * _Inventory'de VAR OLABILECEK son yuva - TASARIM SINIRI, uydurma degil:
 *   - _Inventory.Slot TINYINT ve ALTER YASAK (Mimari A, sartname-3 madde 12);
 *     384 yuvalik cantanin sonu 13+383=396 olurdu, TINYINT'e sigmaz.
 *   - _RefDummySlot cnt 0..239 uretir; satir acan iki yol da (routes_auth.js
 *     createCharacter `n.cnt <= 239` + deploy_inventory_109_172.sql) buraya
 *     kadar acar. 239 ustune satir HICBIR zaman acilmaz.
 * Canta indeksi > (239-13)=226 olan yuvalar bu yuzden KALICI olarak yedek
 * yolda (WebCharInventory, Slot SMALLINT) yasar - veri kaybi yok, gocmez.
 */
export const VSRO_SON_SLOT = 239;

/** Ters cevrim - okuma tarafi icin (vSRO slot -> referans oyun kusam adi). */
export const VSRO_SLOT_KUSAM = Object.fromEntries(
  Object.entries(KUSAM_VSRO_SLOT).map(([ad, s]) => [s, ad]));

/* Tasma tavanlari. Variance en genis halde 7 grup x 5 bit = 35 bit
   (paket ofseti 25578989 xmt/Smt); _Items.Variance bigint oldugu icin sigar,
   ama int32'ye SIGMAZ - o yuzden tavani burada acikca tutuyoruz. */
const VARIANCE_TAVAN = 34359738367;          // 2^35 - 1
const INT32_TAVAN = 2147483647;
const MAG_DEGER_TAVAN = 65535;               // olculen en buyuk mavi deger 29741

// ---------------------------------------------------------------- saf yardimcilar
// (asagidaki 6 fonksiyon VERITABANINA DOKUNMAZ - test_kalicilik_vsro.mjs
//  bunlari sahte veriyle dogruluyor)

/** blues[i] -> MagParamN.  Duzen bizim secimimiz, bkz. dosya basligi. */
export function magPaketle(id, deger) { return deger * 4294967296 + id; }

/** MagParamN -> {id, value}.  bigint kolonlari mssql STRING olarak dondurur. */
export function magCoz(ham) {
  let n;
  try { n = typeof ham === 'bigint' ? ham : BigInt(ham ?? 0); } catch { return { id: 0, value: 0 }; }
  if (n < 0n) return { id: 0, value: 0 };
  return { id: Number(n & 0xFFFFFFFFn), value: Number(n >> 32n) };
}

/**
 * itemmap-tam.json'u iki yonlu tabloya cevirir.
 *   ileri : oyunId -> { code, refId, codeW?, refIdW?, maxStack?, durU?, maxBlue? }
 *   geri  : refId (M ve W ayri ayri) -> oyunId
 * gen_itemmap.mjs cakisma denetimi yaptigi icin `geri` tek degerlidir.
 */
export function haritaOku(tam) {
  const ileri = new Map();
  const geri = new Map();
  for (const [id, v] of Object.entries(tam ?? {})) {
    if (!v || typeof v !== 'object') continue;
    ileri.set(id, v);
    if (Number.isInteger(v.refId)) geri.set(v.refId, id);
    if (Number.isInteger(v.refIdW)) geri.set(v.refIdW, id);
  }
  return { ileri, geri };
}

/** Karakterin cinsiyetine gore dogru _RefObjCommon.ID (zirh/avatar M/W catali). */
export function refIdSec(rec, cinsiyet) {
  if (cinsiyet === 'female' && Number.isInteger(rec?.refIdW)) return rec.refIdW;
  return rec?.refId ?? null;
}

/**
 * referans oyun S$ kaydini vSRO _Items kolonlarina cevirir.
 * DONUS: { ok:true, alan:{...}, ek:{...}|null }  ya da  { ok:false, neden }
 * ok=false demek "bu esya yedek yola gitsin" demektir - VERI ATILMAZ.
 */
export function vsroAlanlari(stack, rec, cinsiyet = 'male') {
  if (!stack?.itemId) return { ok: false, neden: 'itemId-yok' };
  if (!rec) return { ok: false, neden: 'itemmap-tam.json-disi' };

  const refItemId = refIdSec(rec, cinsiyet);
  if (!Number.isInteger(refItemId) || refItemId <= 0) return { ok: false, neden: 'refId-gecersiz' };

  const plus = Math.trunc(Number(stack.plus ?? 0));
  if (!Number.isFinite(plus) || plus < 0 || plus > 255) return { ok: false, neden: `OptLevel-tasma(${stack.plus})` };

  const variance = Math.trunc(Number(stack.variance ?? 0));
  if (!Number.isFinite(variance) || variance < 0 || variance > VARIANCE_TAVAN) {
    return { ok: false, neden: `Variance-tasma(${stack.variance})` };
  }

  // Ekipman mi? Kaynak: _RefObjItem.Dur_U (itemmap-tam.json -> durU).
  const ekipman = Number(rec.durU ?? 0) > 0;
  let data;
  if (ekipman) {
    // Ekipmanin adedi her zaman 1'dir; degilse vSRO kaydi anlamsiz olur.
    const adet = Math.trunc(Number(stack.qty ?? 1));
    if (adet !== 1) return { ok: false, neden: `ekipman-qty=${adet}` };
    data = Math.trunc(Number(stack.dur ?? stack.maxDur ?? rec.durU));
    if (!Number.isFinite(data) || data < 0 || data > INT32_TAVAN) {
      return { ok: false, neden: `Data-dur-tasma(${stack.dur})` };
    }
  } else {
    data = Math.trunc(Number(stack.qty ?? 1));
    if (!Number.isFinite(data) || data < 1) return { ok: false, neden: `Data-qty-gecersiz(${stack.qty})` };
    const tavan = Number(rec.maxStack ?? 1);
    // SESSIZ KIRPMA YOK: MaxStack'i asan yigin vSRO'da gecersiz bir kayittir,
    // yedek yola gonderilir (or. referans oyun elixir stackMax=50 iken DB MaxStack=1).
    if (data > tavan) return { ok: false, neden: `Data-qty>MaxStack(${data}>${tavan})` };
  }

  const blues = Array.isArray(stack.blues) ? stack.blues : [];
  if (blues.length > 12) return { ok: false, neden: `MagParamNum>12(${blues.length})` };
  const mavTavan = Number(rec.maxBlue ?? 0);
  if (blues.length > mavTavan) return { ok: false, neden: `MagParamNum>MaxMagicOptCount(${blues.length}>${mavTavan})` };
  const mag = new Array(12).fill(0);
  for (let i = 0; i < blues.length; i++) {
    const id = Math.trunc(Number(blues[i]?.id));
    const deger = Math.trunc(Number(blues[i]?.value ?? 0));
    if (!Number.isInteger(id) || id <= 0 || id > 0xFFFFFFFF) return { ok: false, neden: `mavi-id-gecersiz(${blues[i]?.id})` };
    if (!Number.isInteger(deger) || deger < 0 || deger > MAG_DEGER_TAVAN) {
      return { ok: false, neden: `mavi-deger-tasma(${blues[i]?.value})` };
    }
    mag[i] = magPaketle(id, deger);
  }

  /* vSRO'da SUTUNU OLMAYAN alanlar. maxDur muhursuz ve bronz esyada
     Dur_L+(Dur_U-Dur_L)*variance ile TURETILEBILIR ama gumus/altin muhurde
     TUTMUYOR (olcum: 0/832) - bu yuzden turetmiyoruz, oldugu gibi sakliyoruz.
     rolls (asm / petExpiresAt / petLevel) icin uygun int kolon YOK:
     petExpiresAt ~1.8e12 ms epoch, _BindingOptionWithItem.nOptValue ve
     _TimedJob.Data1..8 int - sessizce tasardi. */
  const ek = {};
  if (stack.maxDur != null) ek.maxDur = stack.maxDur;
  if (stack.rolls && typeof stack.rolls === 'object' && Object.keys(stack.rolls).length) ek.rolls = stack.rolls;

  return {
    ok: true,
    alan: { refItemId, optLevel: plus, variance, data, magParamNum: blues.length, mag },
    ek: Object.keys(ek).length ? { itemId: stack.itemId, ...ek } : null,
  };
}

/**
 * _Items satirini geri referans oyun S$ kaydina cevirir (vsroAlanlari'nin TERSI).
 * satir: { OptLevel, Variance, Data, MagParamNum, MagParam1..12 }
 *
 * maxDur BURADA YAZILMAZ (bilerek): WebCharInventoryEk'te saklanan deger
 * OTORITERDIR ve ekUygula() `st.maxDur == null` kosuluyla calisir - burada
 * doldursaydik ek kaydi bir daha ASLA uygulanmazdi. Bosluk yukle() icindeki
 * `maxDurTamamla` adiminda, ek kaydindan SONRA kapatiliyor (madde 26).
 */
export function stackKur(satir, oyunId, rec) {
  const ekipman = Number(rec?.durU ?? 0) > 0;
  const st = { itemId: oyunId, qty: 1 };
  const data = Number(satir?.Data ?? 0);
  if (ekipman) st.dur = Number.isFinite(data) ? data : 0;
  else st.qty = Math.max(1, Number.isFinite(data) ? data : 1);

  const plus = Number(satir?.OptLevel ?? 0);
  if (plus > 0) st.plus = plus;
  const varn = Number(satir?.Variance ?? 0);
  if (varn > 0) st.variance = varn;

  const n = Math.min(12, Math.max(0, Number(satir?.MagParamNum ?? 0)));
  if (n > 0) {
    const blues = [];
    for (let i = 1; i <= n; i++) {
      const c = magCoz(satir[`MagParam${i}`]);
      if (c.id > 0) blues.push(c);
    }
    if (blues.length) st.blues = blues;
  }
  return st;
}

/**
 * SAF PLANLAYICI - hangi esya hangi yola gidecek?
 *   ch          : { bag:[], equip:{} }
 *   ileri       : haritaOku().ileri
 *   cinsiyet    : 'male' | 'female'
 *   vsroSlotVar : (slot:int) => true | string
 *                 true = yuva kullanilabilir; string = kullanilamama SEBEBI
 *                 (satir yok / referans oyun disi esya korunuyor ...)
 * DONUS: { vsro: Map(vSROslot -> {alan, ek, kap, idx, itemId}),
 *          yedek: [[kap, idx, stack]], notlar: [aciklama],
 *          tasarim: int  (yedektekilerin kaci TASARIM SINIRI yuzunden -
 *                         bkz. VSRO_SON_SLOT; bunlar ariza degildir) }
 */
export function yuvaPlani(ch, ileri, cinsiyet, vsroSlotVar) {
  const vsro = new Map();
  const yedek = [];
  const notlar = [];
  let tasarim = 0;

  const ekle = (kap, idx, ham) => {
    // Eski kayitlarda kusam duz string olabiliyor (yalniz itemId).
    const stack = typeof ham === 'string' ? { itemId: ham, qty: 1 } : ham;
    if (!stack?.itemId) return;

    const vs = kap === 'bag'
      ? VSRO_CANTA_BASI + idx
      : KUSAM_VSRO_SLOT[KUSAM_YUVALARI[idx]];

    let neden = null;
    if (vs == null) neden = 'avatar-yuvasi (_InventoryForAvatar duzeni BELIRSIZ)';
    else if (vs > VSRO_SON_SLOT) {
      /* Sinirin otesindeki yuvanin satiri OLAMAZ (TINYINT + `n.cnt <= 239`
         kelepcesi) - vsroSlotVar'a sormak anlamsiz, "satir yok" da yaniltici
         olurdu: bu yuva TASARIM GEREGI yedek yolda yasiyor. */
      neden = `tasarim-siniri (slot ${vs} > ${VSRO_SON_SLOT})`;
      tasarim++;
    } else {
      const yuvaDurum = vsroSlotVar(vs);
      if (yuvaDurum !== true) neden = `slot ${vs}: ${yuvaDurum || '_Inventory satiri yok'}`;
      else {
        const r = vsroAlanlari(stack, ileri.get(stack.itemId), cinsiyet);
        if (r.ok) { vsro.set(vs, { ...r, kap, idx, itemId: stack.itemId }); return; }
        neden = r.neden;
      }
    }
    yedek.push([kap, idx, stack]);
    notlar.push(`${kap}[${idx}] ${stack.itemId} -> yedek: ${neden}`);
  };

  if (Array.isArray(ch?.bag)) {
    for (let i = 0; i < ch.bag.length; i++) if (ch.bag[i]) ekle('bag', i, ch.bag[i]);
  }
  for (let i = 0; i < KUSAM_YUVALARI.length; i++) {
    const v = ch?.equip?.[KUSAM_YUVALARI[i]];
    if (v) ekle('equip', i, v);
  }
  return { vsro, yedek, notlar, tasarim };
}

// ---------------------------------------------------------------- fabrika

/**
 * Bellekte acilabilecek EN BUYUK canta boyu - yedek yoldan gelen bir satirin
 * cantayi ne kadar buyutebilecegini sinirlar (bkz. yukle() icindeki
 * "YEDEK SATIR BOY KAPISI").  384 = 12 sayfa x 32; sahibi
 * sistem_banka-depo.js CANTA_MAX_YUVA'dir, buradaki yalnizca SAVUNMA TAVANI:
 * Slot kolonu SMALLINT oldugu icin bozuk/dusmanca bir satir (Slot 32767)
 * aksi halde 32 bin elemanlik bir dizi actirirdi.  createKalicilik cagrisi
 * `cantaTavani` gecerse o kullanilir - sabit iki yerde yasamaz.
 */
export const CANTA_TAVANI = 384;

export function createKalicilik({ web, sql, log, bagSlots = 32, shard = null,
                                  cantaTavani = CANTA_TAVANI }) {
  let hazir = false;
  let ekHazir = false;      // WebCharInventoryEk ayri kuruluyor (bkz. tabloKur)
  /* Son yazilan icerigin imzasi - degismediyse SQL'e hic gitmeyiz.
     30 saniyede bir tum oyuncular icin yazmak gereksiz yuk olurdu. */
  const imza = new Map();          // charId -> string
  /* YUKLEME KAPISI: yukle() basariyla bitmeden kaydet() calismaz. */
  const yuklendi = new Set();      // charId
  const cinsiyetOnbellek = new Map(); // charId -> 'male'|'female'

  /* itemmap-tam.json TEK DOGRULUK KAYNAGI. Yoksa 1. yol tumden kapanir ve
     her sey yedek yoldan gider - yani eski davranisa duseriz, veri kaybi yok. */
  let HARITA = { ileri: new Map(), geri: new Map() };
  try {
    HARITA = haritaOku(JSON.parse(fs.readFileSync(path.join(BURASI, 'data', 'itemmap-tam.json'), 'utf8')));
    log?.(`kalicilik: itemmap-tam.json ${HARITA.ileri.size} esya / ${HARITA.geri.size} vSRO id`);
  } catch (e) {
    log?.(`kalicilik: itemmap-tam.json okunamadi (${String(e.message).slice(0, 90)}) - yalniz yedek yol calisir`);
  }

  /* ------------------------------------------------------------ shard havuzu */
  /* server.js bu modulu yalnizca `web` havuzuyla kuruyor. _Items/_Inventory
     SRO_VT_SHARD'ta oldugu icin kendi baglantimizi aciyoruz. Cagiran taraf
     `shard` gecerse (tercih edilen) o kullanilir - bkz. rapor/cekirdekIhtiyaci. */
  let shardHavuz = shard;
  let shardSoz = null;
  function shardHavuzAl() {
    if (shardHavuz) return Promise.resolve(shardHavuz);
    if (!sql) return Promise.resolve(null);
    if (!shardSoz) {
      shardSoz = (async () => {
        try {
          const cfg = JSON.parse(fs.readFileSync(path.join(BURASI, 'config.json'), 'utf8')).sql;
          if (!cfg?.enabled) return null;
          const h = await new sql.ConnectionPool({
            server: cfg.server, user: cfg.user, password: cfg.password,
            database: cfg.databases.shard, options: cfg.options,
          }).connect();
          shardHavuz = h;
          log?.('kalicilik: SRO_VT_SHARD havuzu acildi (_Items/_Inventory yolu aktif)');
          return h;
        } catch (e) {
          log?.(`kalicilik: shard havuzu acilamadi - ${String(e.message).slice(0, 140)}`);
          return null;
        }
      })();
    }
    return shardSoz;
  }

  /* ------------------------------------------------------------ tablolar */
  async function tabloKur() {
    if (hazir || !web) return hazir;
    try {
      await web.request().query(`
        IF OBJECT_ID('dbo.WebCharInventory') IS NULL
          CREATE TABLE dbo.WebCharInventory (
            CharID    int          NOT NULL,
            Kap       varchar(16)  NOT NULL,
            Slot      smallint     NOT NULL,
            StackJson nvarchar(max) NOT NULL,
            CONSTRAINT PK_WebCharInventory PRIMARY KEY (CharID, Kap, Slot));`);
      hazir = true;
      log?.('kalicilik: WebCharInventory hazir');
    } catch (e) {
      log?.(`kalicilik: tablo kurulamadi - ${String(e.message).slice(0, 160)}`);
      return hazir;
    }
    /* AYRI try: ek tablo kurulamazsa yedek yol YINE DE calissin - eskiden tek
       blokta olsalardi buradaki bir hata butun kaliciligi kapatirdi. */
    try {
      /* vSRO'da SUTUNU OLMAYAN alanlar (maxDur, rolls). ID64 yerine
         (CharID,Kap,Slot) ile anahtarlaniyor: _Items ile AYRI VERITABANINDA
         oldugumuz icin ID64'u tek islemde garanti edemeyiz, ama yuva anahtari
         WebCharInventory ile AYNI islemde yazilabiliyor. Bayatlik korumasi:
         EkJson icinde itemId de duruyor, okuma tarafi eslesmezse yok sayar. */
      await web.request().query(`
        IF OBJECT_ID('dbo.WebCharInventoryEk') IS NULL
          CREATE TABLE dbo.WebCharInventoryEk (
            CharID int          NOT NULL,
            Kap    varchar(16)  NOT NULL,
            Slot   smallint     NOT NULL,
            EkJson nvarchar(max) NOT NULL,
            CONSTRAINT PK_WebCharInventoryEk PRIMARY KEY (CharID, Kap, Slot));`);
      ekHazir = true;
      log?.('kalicilik: WebCharInventoryEk hazir (maxDur/rolls)');
    } catch (e) {
      log?.(`kalicilik: WebCharInventoryEk kurulamadi (maxDur/rolls saklanmayacak) - ${String(e.message).slice(0, 120)}`);
    }
    return hazir;
  }

  /* ------------------------------------------------------------ cinsiyet */
  /* Zirh ve avatar tek referans oyun esyasi = vSRO'da IKI kayit (M ve W). Yanlis
     dali secersek istemci/veritabani yanlis modeli gosterir.
     ch.gender zaten 'male'|'female' (charcreate.js PRESETS). Yoksa DB'den:
     _Char.RefObjID -> _RefObjCommon.Link -> _RefObjChar.CharGender (1 = erkek,
     _ASSIGN_GM_EQUIPS yordami ayni kurali kullaniyor). */
  async function cinsiyetBul(ch) {
    if (ch?.gender === 'male' || ch?.gender === 'female') return ch.gender;
    const onbellek = cinsiyetOnbellek.get(ch?.id);
    if (onbellek) return onbellek;
    const h = await shardHavuzAl();
    if (!h) return 'male';
    try {
      const r = await h.request().input('c', sql.Int, Number(ch.id)).query(`
        SELECT rc.CharGender FROM _Char c
          JOIN _RefObjCommon o ON o.ID = c.RefObjID
          LEFT JOIN _RefObjChar rc ON rc.ID = o.Link
         WHERE c.CharID = @c`);
      const g = r.recordset[0]?.CharGender === 1 ? 'male' : (r.recordset[0]?.CharGender === 0 ? 'female' : 'male');
      cinsiyetOnbellek.set(ch.id, g);
      return g;
    } catch { return 'male'; }
  }

  /* ------------------------------------------------------------ okuma */

  const MAG_KOLON = Array.from({ length: 12 }, (_, i) => `t.MagParam${i + 1}`).join(', ');

  /** vSRO _Inventory + _Items okumasi. DONUS: Map(slot -> satir) | null */
  async function vsroOku(charId) {
    const h = await shardHavuzAl();
    if (!h) return null;
    try {
      const r = await h.request().input('c', sql.Int, Number(charId)).query(`
        SELECT v.Slot, v.ItemID, t.RefItemID, t.OptLevel, t.Variance, t.Data,
               t.MagParamNum, ${MAG_KOLON}
          FROM _Inventory v LEFT JOIN _Items t ON t.ID64 = v.ItemID
         WHERE v.CharID = @c`);
      const m = new Map();
      for (const row of r.recordset) m.set(Number(row.Slot), row);
      return m;
    } catch (e) {
      log?.(`kalicilik: _Inventory okunamadi - ${String(e.message).slice(0, 160)}`);
      return null;
    }
  }

  /**
   * Karakterin kayitli canta/kusamini ch uzerine yukler.
   * IKI kaynak birlestirilir: once vSRO (_Items/_Inventory), sonra YEDEK
   * (WebCharInventory) UZERINE yazar.
   *
   * NEDEN YEDEK USTTE: goc anlaminda. Bu degisiklikten ONCE tek otorite
   * WebCharInventory'ydi ve _Inventory'de hala _AddNewChar'in BASLANGIC seti
   * duruyor olabilir. Yedek ustte olmasaydi ilk giriste oyuncunun kayitli
   * kusami baslangic setiyle EZILIRDI. Gocten sonra iki kume ZATEN AYRIK
   * (bir yuva ya 1. yola ya 2. yola yazilir), yani oncelik anlamsizlasir.
   */
  async function yukle(ch) {
    if (!ch?.id) return false;
    const charId = Number(ch.id);
    let birSeyOkundu = false;

    const cantaUzunluk = Math.max(Array.isArray(ch.bag) ? ch.bag.length : 0, bagSlots);
    const canta = new Array(cantaUzunluk).fill(null);
    for (let i = 0; i < cantaUzunluk; i++) canta[i] = Array.isArray(ch.bag) ? (ch.bag[i] ?? null) : null;
    const kusam = { ...(ch.equip ?? {}) };
    let cantaDokundu = false;
    let kusamDokundu = false;

    /* ---- 1. YOL: gercek vSRO kaydi ---- */
    const vs = await vsroOku(charId);
    if (vs) {
      birSeyOkundu = true;
      let cozulen = 0, cozulemeyen = 0;
      for (const [slot, row] of vs) {
        // Yuvayi referans oyun tarafina cevir
        let kap = null, idx = -1;
        if (slot >= VSRO_CANTA_BASI) {
          kap = 'bag'; idx = slot - VSRO_CANTA_BASI;
          if (idx >= cantaUzunluk) continue;            // cantamizin disinda - dokunma
        } else if (VSRO_SLOT_KUSAM[slot] != null) {
          kap = 'equip'; idx = KUSAM_YUVALARI.indexOf(VSRO_SLOT_KUSAM[slot]);
        } else {
          continue;                                     // slot 12 = 13. kusam yuvasi, bizde yok
        }

        const itemId64 = Number(row.ItemID ?? 0);
        if (!(itemId64 > 0)) {
          // Yuva BOS oldugu KESIN (satir var, ItemID=0) -> temizle
          if (kap === 'bag') { canta[idx] = null; cantaDokundu = true; }
          else { kusam[KUSAM_YUVALARI[idx]] = null; kusamDokundu = true; }
          continue;
        }
        const jw = HARITA.geri.get(Number(row.RefItemID ?? 0));
        if (!jw) {
          /* Cozulemeyen esya: DOKUNMA. Temizlemek veri kaybi olurdu; oyuncunun
             mevcut (routes_auth'tan gelen) degeri yerinde kalir. */
          cozulemeyen++;
          continue;
        }
        const st = stackKur(row, jw, HARITA.ileri.get(jw));
        if (kap === 'bag') { canta[idx] = st; cantaDokundu = true; }
        else { kusam[KUSAM_YUVALARI[idx]] = st; kusamDokundu = true; }
        cozulen++;
      }
      if (cozulemeyen) log?.(`kalicilik: char ${charId} - ${cozulen} vSRO esyasi cozuldu, ${cozulemeyen} kod cozulemedi (dokunulmadi)`);
    }

    /* ---- Ek alanlar (maxDur / rolls) ---- */
    const ekHarita = new Map();                          // `${kap}:${idx}` -> {itemId, maxDur?, rolls?}
    /* ---- 2. YOL: yedek (WebCharInventory) ---- */
    if (web && (await tabloKur())) {
      try {
        const r = await web.request().input('c', sql.Int, charId)
          .query('SELECT Kap, Slot, StackJson FROM dbo.WebCharInventory WHERE CharID=@c');
        birSeyOkundu = true;
        if (ekHazir) {
          const e = await web.request().input('c', sql.Int, charId)
            .query('SELECT Kap, Slot, EkJson FROM dbo.WebCharInventoryEk WHERE CharID=@c');
          for (const row of e.recordset) {
            try { ekHarita.set(`${row.Kap}:${row.Slot}`, JSON.parse(row.EkJson)); } catch { /* bozuk satir */ }
          }
        }
        for (const row of r.recordset) {
          let st;
          try { st = JSON.parse(row.StackJson); } catch { continue; }   // bozuk satiri atla
          if (!st?.itemId) continue;
          if (row.Kap === 'bag') {
            /* YEDEK SATIR BOY KAPISI - eskiden `row.Slot < canta.length`
               kosulunu gecemeyen satir SESSIZCE ATILIYORDU. Zararsiz
               gorunuyordu ama kaydet() kosulsuz
               `DELETE FROM WebCharInventory WHERE CharID=@c` yapip yalnizca
               ELINDEKI cantayi geri yazdigi icin, bellege alinmayan satir
               BIR SONRAKI KAYITTA KALICI OLARAK SILINIYORDU.
               Kapi gercek: canta boyunu 384'e acan
               sistem_banka-depo.cantaBoyunuGeriYukle SQL hatasinda `null`
               donuyor (kendi try/catch'i) ve o zaman ch.bag 32 yuvada kalir;
               ayni durumda banka'nin `yuksekYuvalariKurtar` telafisi de
               calismaz (kosulu `boy > oncekiBoy`). Yani yuva 32+ (ve tabii
               tasarim geregi burada yasayan 227+) tek bir SQL tokezlemesinde
               yok olurdu.
               DOGRU DAVRANIS: kaydin kendisi cantanin ne kadar buyuk oldugunu
               soyluyor - cantayi O SATIRA KADAR BUYUT. Buyume yalnizca
               GECERLI bir yigin tasiyan satir icin (st.itemId yukarida
               dogrulandi) ve `cantaTavani` savunma tavanina kadar olur. */
            if (row.Slot >= 0 && row.Slot >= canta.length && row.Slot < cantaTavani) {
              for (let i = canta.length; i <= row.Slot; i++) canta[i] = null;
            }
            if (row.Slot >= 0 && row.Slot < canta.length) { canta[row.Slot] = st; cantaDokundu = true; }
          } else if (row.Kap === 'equip') {
            const yuva = KUSAM_YUVALARI[row.Slot];
            if (yuva) { kusam[yuva] = st; kusamDokundu = true; }
          }
        }
      } catch (e) {
        log?.(`kalicilik: yedek yol okunamadi - ${String(e.message).slice(0, 160)}`);
      }
    }

    if (!birSeyOkundu) return false;                     // iki kaynak da erisilemedi

    /* Ek alanlari yerine koy. BAYATLIK KAPISI: ek kaydi baska bir esyaya
       aitse (itemId tutmuyorsa) yok sayilir - shard yazilip web yazilamadigi
       nadir durumda yanlis maxDur uygulanmasin. */
    const ekUygula = (kap, idx, st) => {
      if (!st) return;
      const ek = ekHarita.get(`${kap}:${idx}`);
      if (!ek || (ek.itemId && ek.itemId !== st.itemId)) return;
      if (ek.maxDur != null && st.maxDur == null) st.maxDur = ek.maxDur;
      if (ek.rolls && st.rolls == null) st.rolls = ek.rolls;
    };
    for (let i = 0; i < canta.length; i++) ekUygula('bag', i, canta[i]);
    for (let i = 0; i < KUSAM_YUVALARI.length; i++) ekUygula('equip', i, kusam[KUSAM_YUVALARI[i]]);

    /* MADDE 26 / fark #135 - maxDur BOSLUGUNU KAPAT.
       vSRO _Items'ta maxDur icin kolon YOK (kolon eslemesi tablosu, dosya
       basligi); yalnizca WebCharInventoryEk satiri varsa geri geliyordu. Ek
       satiri yoksa (shard yazilip web yazilamadi, ya da esya ilk kez
       _AddNewChar tarafindan yaratildi) esya `dur` var / `maxDur` YOK halinde
       kaliyor ve IKI sey birden bozuluyordu:
         - istemci dayaniklilik cubugunu HIC cizmiyor
           (kosul `item.dur !== void 0 && item.maxDur`, paket @27248124)
         - sistem_dukkan.js tamir filtresi ayni sarti aradigi icin esya HIC
           tamir edilemiyor (tamirUcreti daima 0 -> sys.economy.nothing_to_repair)
       BU ADIM EK KAYDINDAN SONRA calisir: WebCharInventoryEk'te saklanan deger
       OTORITERDIR (gelistirme/mavi secenek maxDur'u degistirmis olabilir),
       burada yalnizca HALA bos olan yigin doldurulur.
       Turetme kaynagi rec.durU (= _RefObjItem.Dur_U, ARALIGIN UST SINIRI)
       DEGIL - esyanin kendi variance'i: Emt(rollRanges.durability,
       xmt(variance,0)). Satin alma yolu da ayni sonucu uretir. */
    const maxDurTamamla = (st) => {
      if (!st?.itemId) return;
      if (st.maxDur == null) {
        const d = dayaniklilikDegeri(esyaTanimi(st.itemId), st);
        if (d === null) return;
        /* maxDur >= dur GARANTISI: DB'deki `dur` gelistirme/mavi secenek yuzunden
           turetilen degerin USTUNDE olabilir. maxDur < dur birakirsak istemcinin
           _Lt() ucret dongusu (maxDur-dur) NEGATIF terim uretir ve toplu tamir
           ucreti dusurulebilir. Esya elinde `dur` kadar puan TASIDIGINA gore
           tavani en az o kadardir - varsayim degil, kaydin kendi bilgisi. */
        const dur = Math.trunc(Number(st.dur));
        st.maxDur = Number.isFinite(dur) && dur > d ? dur : d;
      }
      /* TERS YONDEKI BOSLUK (madde 26, canli olcum CharID=3): WebCharInventory
         yedek yolundan gelen ESKI blob `{itemId, qty}` seklinde - `dur` HIC
         yazilmamis. Yukaridaki adim maxDur'u turetiyor ama dur'u birakirsa
         esya HALA "ciplak" kalir: istemci cubugu `item.dur !== void 0 &&
         item.maxDur` kosuluyla cizer (@27248124), tamir filtresi de ayni
         cifti arar. dur hic IZLENMEMIS bir esya asinma da gormemistir ->
         dur = maxDur (canli yakalamada taze ekipman dur === maxDur;
         esya.yiginTamamla ayni kurali GM/eski esya icin uygular).
         `== null` bilerek: dur === 0 GECERLI (KIRIK esya), ezilmez. */
      if (st.dur == null && st.maxDur != null) st.dur = st.maxDur;
    };
    for (const st of canta) maxDurTamamla(st);
    for (const y of KUSAM_YUVALARI) maxDurTamamla(kusam[y]);

    if (cantaDokundu) ch.bag = canta;
    /* Kusam kaydi VARSA _Inventory'den okunani EZER: oyuncunun oyun icinde
       yaptigi degisiklik (kusandigi/cikardigi) otoritedir. */
    if (kusamDokundu) {
      for (const y of KUSAM_YUVALARI) if (kusam[y] == null) delete kusam[y];
      ch.equip = kusam;
    }

    /* IMZAYI BILEREK KURMUYORUZ. Eski surum burada imza.set(ch.id, ozet(ch))
       diyordu; o zaman GIRISTEN SONRAKI ILK KAYIT "degismedi" sanilip
       atlaniyordu. Bu, cozulemeyen bir refId yuzunden ch'de kalan (ama DB'de
       BASKA olan) bir yuva varsa kaliciligi sessizce bozardi. Girisin
       ardindan bir kez tam yazmak ucuz: reconciler yuvalari YERINDE
       gunceller, yalniz gercekten yeni olan esya icin havuzdan kayit alir. */
    yuklendi.add(ch.id);
    return cantaDokundu || kusamDokundu;
  }

  /* ------------------------------------------------------------ imza */

  /** ch.bag + ch.equip icin degisiklik imzasi. */
  function ozet(ch) {
    const b = (Array.isArray(ch.bag) ? ch.bag : []).map(v => v ? JSON.stringify(v) : '').join('|');
    const e = KUSAM_YUVALARI.map(y => {
      const v = ch.equip?.[y];
      return v ? (typeof v === 'string' ? v : JSON.stringify(v)) : '';
    }).join('|');
    return b + '#' + e;
  }

  /* ------------------------------------------------------------ yazma */

  /* kaydet() basinda tazelenir; vsroYaz.yonetilenYuva bunu okur. */
  let cantaKapasitesi = bagSlots;

  /**
   * 1. YOL yazimi. TEK TRANSACTION icinde:
   *   - hedeflenen her yuva icin _Items satirini yerinde gunceller
   *     (yuvada zaten bir ID64 varsa onu KULLANIR - havuz sismesin),
   *   - bos yuvaya yeni esya gerekiyorsa _STRG_ALLOC_ITEM_NoTX cagirir
   *     (havuz + Serial64 + _BindingOptionWithItem temizligi o yordamin isi),
   *   - artik bosalan yuvalari _STRG_FREE_ITEM_NoTX ile serbest birakir
   *     (satir SILINMEZ; yordam yalnizca _ItemPool.InUse=0 ve Serial64=0 yapar).
   * DONUS: true = islendi (commit), false = yazilamadi (rollback).
   */
  async function vsroYaz(charId, plan, mevcut, korunan) {
    const h = await shardHavuzAl();
    if (!h) return false;
    const tx = new sql.Transaction(h);
    let acik = false;
    try {
      await tx.begin();
      acik = true;

      // 1) Hedef yuvalar
      for (const [slot, hedef] of plan.vsro) {
        const varOlan = Number(mevcut.get(slot)?.ItemID ?? 0);
        let id64 = varOlan;
        if (!(id64 > 0)) {
          /* Esyayi ELLE INSERT ETMIYORUZ: havuz (_ItemPool), seri numarasi
             (_GetLatestItemSerial) ve _BindingOptionWithItem temizligi bu
             yordamin icinde. Doneri T-SQL RETURN degeri oldugu icin acik bir
             toplu komutla okuyoruz (mssql returnValue plumbing'ine bagli
             kalmamak icin). */
          const a = await new sql.Request(tx).query(`
            DECLARE @sn bigint = 0, @rc int = 0;
            EXEC @rc = dbo._STRG_ALLOC_ITEM_NoTX @sn OUTPUT;
            SELECT CAST(@rc AS bigint) AS YeniID;`);
          id64 = Number(a.recordset?.[0]?.YeniID ?? 0);
          if (!(id64 > 0)) throw new Error(`_STRG_ALLOC_ITEM_NoTX doneri ${a.recordset?.[0]?.YeniID}`);
          await new sql.Request(tx)
            .input('c', sql.Int, charId).input('s', sql.TinyInt, slot).input('i', sql.BigInt, id64)
            .query('UPDATE _Inventory SET ItemID=@i WHERE CharID=@c AND Slot=@s');
        }
        const rq = new sql.Request(tx)
          .input('id', sql.BigInt, id64)
          .input('ref', sql.Int, hedef.alan.refItemId)
          .input('opt', sql.TinyInt, hedef.alan.optLevel)
          .input('vr', sql.BigInt, hedef.alan.variance)
          .input('dt', sql.Int, hedef.alan.data)
          .input('mn', sql.TinyInt, hedef.alan.magParamNum);
        for (let i = 0; i < 12; i++) rq.input(`m${i + 1}`, sql.BigInt, hedef.alan.mag[i]);
        /* 12 MagParam'in TAMAMI yazilir. vSRO yordami MagParamNum<5 iken
           yalniz 1..4'u yaziyor ve 5..12'de BAYAT deger birakabiliyor. */
        await rq.query(`UPDATE _Items SET RefItemID=@ref, OptLevel=@opt, Variance=@vr, Data=@dt,
               MagParamNum=@mn, MagParam1=@m1, MagParam2=@m2, MagParam3=@m3, MagParam4=@m4,
               MagParam5=@m5, MagParam6=@m6, MagParam7=@m7, MagParam8=@m8, MagParam9=@m9,
               MagParam10=@m10, MagParam11=@m11, MagParam12=@m12
             WHERE ID64=@id`);
        hedef.id64 = id64;
      }

      // 2) Bosalan yuvalar - YALNIZCA bizim yonettigimiz yuvalar
      for (const [slot, row] of mevcut) {
        if (plan.vsro.has(slot)) continue;
        if (!yonetilenYuva(slot)) continue;              // slot 12 / canta disi - dokunma
        if (korunan.has(slot)) continue;                 // referans oyunun bilmedigi esya - DOKUNMA
        const id64 = Number(row.ItemID ?? 0);
        if (!(id64 > 0)) continue;
        await new sql.Request(tx)
          .input('c', sql.Int, charId).input('s', sql.TinyInt, slot)
          .query('UPDATE _Inventory SET ItemID=0 WHERE CharID=@c AND Slot=@s');
        /* Satir SILINMEZ - yordam yalnizca _ItemPool.InUse=0 ve Serial64=0
           yapar, yani esya kaydi vSRO'nun kendi havuzuna geri doner. */
        await new sql.Request(tx).input('f', sql.BigInt, id64)
          .query('EXEC dbo._STRG_FREE_ITEM_NoTX @ItemToFree = @f');
      }

      await tx.commit();
      return true;
    } catch (e) {
      if (acik) { try { await tx.rollback(); } catch { /* zaten geri alindi */ } }
      log?.(`kalicilik: vSRO yazimi basarisiz (yedege dusuluyor) - ${String(e.message).slice(0, 200)}`);
      return false;
    }

    /** Bu vSRO yuvasi bizim sorumlulugumuzda mi? */
    function yonetilenYuva(slot) {
      if (VSRO_SLOT_KUSAM[slot] != null) return true;                       // 0..11
      return slot >= VSRO_CANTA_BASI && slot < VSRO_CANTA_BASI + cantaKapasitesi;
    }
  }

  /* Ayni karakter icin kayitlar SIRAYA girer (birbirine girmez).
     NEDEN: okuma (vsroOku) islemin DISINDA yapiliyor; iki kayit ic ice
     girerse ayni yuvaya IKI KEZ esya tahsis edilebilir (havuzdan iki kayit
     alinir, biri sahipsiz kalir). server.js kaydeti hem 30 sn'lik
     zamanlayicidan hem soket kapanisindan cagiriyor - yani cakisma gercek.
     Ikinciyi ATMIYORUZ, SIRAYA aliyoruz: atsaydik cikistaki son degisiklik
     (or. son saniyede alinan esya) diske hic inmezdi. */
  const kuyruk = new Map();      // charId -> Promise

  /** Canta + kusami yazar. Icerik degismediyse HICBIR SORGU calistirmaz. */
  async function kaydet(ch) {
    if (!ch?.id) return false;
    const onceki = kuyruk.get(ch.id) ?? Promise.resolve();
    const su = onceki.catch(() => {}).then(() => kaydetIc(ch));
    kuyruk.set(ch.id, su);
    try { return await su; } finally { if (kuyruk.get(ch.id) === su) kuyruk.delete(ch.id); }
  }

  async function kaydetIc(ch) {
    /* YUKLEME KAPISI: yukleme tamamlanmadan yazmak, kayitli envanteri BOS bir
       cantayla ezmek demektir (eski surumun en yikici hatasi). */
    if (!yuklendi.has(ch.id)) return false;
    const yeni = ozet(ch);
    if (imza.get(ch.id) === yeni) return false;          // degismemis

    const charId = Number(ch.id);
    cantaKapasitesi = Math.max(Array.isArray(ch.bag) ? ch.bag.length : 0, bagSlots);

    /* --- 1. YOL --- */
    const mevcut = (await vsroOku(charId)) ?? new Map();
    const cinsiyet = await cinsiyetBul(ch);

    /* KORUNAN YUVALAR: _Inventory'de duran ama referans oyun katalogunda KARSILIGI
       OLMAYAN esyalar. Bunlar _AddNewChar'in koydugu vSRO baslangic esyalari
       (olcum: ITEM_ETC_E060118_60EXP_HELP / _100EXP_HELP /
       ITEM_ETC_SCROLL_RETURN_NEWBIE_01 - canli DB'de 7 karakterin 3'er
       yuvasi). referans oyun onlari GORMEDIGI icin ch.bag'de karsiligi null'dir;
       yonetilen yuva sayilsalardi her kayitta serbest birakilir, yani
       oyuncunun DB'sindeki gercek esya YOK EDILIRDI.
       KURAL: bu yuvalara ne yazariz ne de bosaltiriz. Karsilik gelen referans oyun
       canta indeksi (varsa) YEDEK yola duser - kimse veri kaybetmez.
       Kendiliginden duzelir: o esya DB'den kalkinca yuva tekrar acilir. */
    const korunan = new Set();
    for (const [slot, row] of mevcut) {
      const id64 = Number(row.ItemID ?? 0);
      if (id64 > 0 && !HARITA.geri.has(Number(row.RefItemID ?? 0))) korunan.add(slot);
    }

    const plan = yuvaPlani(ch, HARITA.ileri, cinsiyet, (s) => {
      if (!mevcut.has(s)) return '_Inventory satiri yok';
      if (korunan.has(s)) return 'referans oyun disi vSRO esyasi korunuyor';
      return true;
    });

    let vsroTamam = false;
    if (plan.vsro.size || mevcut.size) vsroTamam = await vsroYaz(charId, plan, mevcut, korunan);

    /* vSRO yazilamadiysa HICBIR SEY KAYBOLMASIN: 1. yola gidecek olan her sey
       de yedege yazilir. Okuma tarafinda yedek ustte oldugu icin bayat
       _Inventory satirlari sonuc uzerinde etkili olmaz. */
    const yedek = plan.yedek.slice();
    const ekSatir = [];
    for (const h of plan.vsro.values()) {
      if (!vsroTamam) {
        const st = h.kap === 'bag' ? ch.bag?.[h.idx] : ch.equip?.[KUSAM_YUVALARI[h.idx]];
        if (st) yedek.push([h.kap, h.idx, typeof st === 'string' ? { itemId: st, qty: 1 } : st]);
      } else if (h.ek) {
        ekSatir.push([h.kap, h.idx, JSON.stringify(h.ek)]);
      }
    }
    if (plan.notlar.length) {
      /* Tasarim siniri (canta 227+, bkz. VSRO_SON_SLOT) beklenen durumdur ve
         TEK satirda ozetlenir; tek tek listelenseydi 4'luk pencereyi doldurup
         GERCEK anormallikleri (cozulmeyen esya, tasma...) gizlerdi. */
      const anomali = plan.notlar.filter(n => !n.includes('tasarim-siniri'));
      const parca = [];
      if (plan.tasarim) {
        parca.push(`${plan.tasarim} esya tasarim geregi yedekte (canta `
          + `${VSRO_SON_SLOT - VSRO_CANTA_BASI + 1}+ = slot ${VSRO_SON_SLOT + 1}+, _Inventory'de yasamaz)`);
      }
      if (anomali.length) parca.push(`${anomali.slice(0, 4).join(' ; ')}${anomali.length > 4 ? ' ...' : ''}`);
      log?.(`kalicilik: char ${charId} - ${plan.vsro.size} esya vSRO'ya, ${yedek.length} esya yedege`
        + ` (${parca.join(' | ')})`);
    }

    /* --- 2. YOL --- */
    if (!web || !(await tabloKur())) {
      /* Yedek yol yoksa 1. yol tek basina otoritedir; basariliysa imzayi
         guncelle ki 30 saniyede bir bosuna yeniden yazmayalim. */
      if (vsroTamam && !yedek.length) imza.set(ch.id, yeni);
      return vsroTamam;
    }

    /* ATOMIK: sil + yaz tek islemde. Yarida kalirsa envanter YARIM kalmaz -
       ya eski hali ya yeni hali gorunur. */
    const tx = new sql.Transaction(web);
    let acik = false;
    try {
      await tx.begin();
      acik = true;
      await new sql.Request(tx).input('c', sql.Int, charId)
        .query('DELETE FROM dbo.WebCharInventory WHERE CharID=@c');
      if (ekHazir) {
        await new sql.Request(tx).input('c', sql.Int, charId)
          .query('DELETE FROM dbo.WebCharInventoryEk WHERE CharID=@c');
      }
      for (const [kap, slot, st] of yedek) {
        await new sql.Request(tx)
          .input('c', sql.Int, charId)
          .input('k', sql.VarChar(16), kap)
          .input('s', sql.SmallInt, slot)
          .input('j', sql.NVarChar(sql.MAX), JSON.stringify(st))
          .query('INSERT INTO dbo.WebCharInventory (CharID, Kap, Slot, StackJson) VALUES (@c,@k,@s,@j)');
      }
      for (const [kap, slot, json] of (ekHazir ? ekSatir : [])) {
        await new sql.Request(tx)
          .input('c', sql.Int, charId)
          .input('k', sql.VarChar(16), kap)
          .input('s', sql.SmallInt, slot)
          .input('j', sql.NVarChar(sql.MAX), json)
          .query('INSERT INTO dbo.WebCharInventoryEk (CharID, Kap, Slot, EkJson) VALUES (@c,@k,@s,@j)');
      }
      await tx.commit();
      /* IMZA BURADA KURULUR - vsroTamam false olsa bile. Sebep: o durumda
         icerigin TAMAMI yedek yola yazildi, yani kayipsizdir; 30 saniyede bir
         calisan bir shard'i yeniden denemek yalnizca log kalabaligi yapardi.
         Shard tekrar erisilebilir olunca ilk ICERIK DEGISIKLIGINDE 1. yola
         geri tasinir (goc senaryosu testi bunu dogruluyor). */
      imza.set(ch.id, yeni);
      return true;
    } catch (e) {
      if (acik) { try { await tx.rollback(); } catch { /* zaten geri alindi */ } }
      log?.(`kalicilik: yazma hatasi - ${String(e.message).slice(0, 160)}`);
      return false;
    }
  }

  /** Oyuncu cikinca imzayi birak (bellek sizmasin). */
  function unut(charId) {
    imza.delete(charId);
    yuklendi.delete(charId);
    cinsiyetOnbellek.delete(charId);
    kuyruk.delete(charId);
  }

  return {
    tabloKur, yukle, kaydet, unut, KUSAM_YUVALARI,
    /* test/tani icin - uretimde kullanilmaz */
    _ic: { HARITA, ozet, yuvaPlani, vsroOku, shardHavuzAl, yuklendi },
  };
}
