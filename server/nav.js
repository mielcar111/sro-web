/**
 * nav.bin cozucusu ve carpisma denetimi.
 *
 * Istemcinin kendi cozucusunden BIREBIR alindi (bundle: decodeNav):
 *
 *   ofset 0   uint32  sihirli sayi = 1447972173
 *   ofset 4   uint16  surum = 1
 *   ofset 6   uint16  TUREV SURUMU  (bizim isaretimiz - asagiya bak)
 *   ofset 8   uint32  blockerSayisi
 *   ofset 12  uint32  yuzeySayisi
 *   ofset 16  ...     blocker kayitlari (her biri 40 bayt)
 *
 * OFSET 6 - "TUREV SURUMU" ISARETI (VERI SURUMU KAPISI)
 *   Ofset 6-7, ISTEMCININ cozucusunde OKUNMAYAN iki bayttir: paket p9e()
 *   yalnizca getUint32(0) / getUint16(4) / getUint32(8) / getUint32(12)
 *   okur, sonra kayitlari uzunluktan yurur ve "trailing bytes" kontrolu
 *   yapar. Bu iki bayt bu yuzden GUVENLI bir veri surumu alanidir.
 *     0 = dosyada turev duvar YOK  -> nav.js yukleme aninda URETIR (eski
 *         nav.bin'ler ve uretilmemis bolgeler boyle calismaya devam eder)
 *     1 = W5 turev duvarlari DOSYAYA GOMULU -> nav.js BIR DAHA URETMEZ
 *   Isaret gen_navbin_duvar.mjs tarafindan yazilir. Kapi olmasaydi ayni
 *   duvarlar hem dosyadan gelir hem yeniden turetilirdi (cift blocker:
 *   bosuna bellek + ust uste binmis kalinlik).
 *
 *   BLOCKER (40 bayt)
 *     +0  float32 x        +4  float32 z       +8  float32 rotY
 *     +12 uint8   kind     1 = daire, digeri = kutu
 *     +13 uint8   bayrak   bit0: yMin var, bit1: yMax var
 *     +16 float32 hx / r   +20 float32 hz
 *     +24 float32 ox       +28 float32 oz      (merkez kaymasi)
 *     +32 float32 yMin     +36 float32 yMax    (bayraga gore)
 *
 * NEDEN GEREKLI: istemci sunucuya sadece HEDEF noktayi yolluyor
 * (move.click {x,z}). Sunucu dogrulamazsa oyuncu duvarlarin ve
 * binalarin icinden gecer - "objelerin icinden geciliyor" sorunu budur.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
/* Bas boslugu (paket H9e = .75). Turev duvarlarin y-bandi bu sabitten
   turetiliyor; terrain.js'in sampleY'si ile ASLA ayrismasin diye oradan
   ithal ediliyor (terrain.js nav.js'i ithal etmez - dongu yok). */
import { BAS_BOSLUGU } from './terrain.js';

const MAGIC = 1447972173;
const HEADER = 16;
const BLOCKER_BOYUT = 40;

const onbellek = new Map();

export function loadNav(clientDir, zoneId) {
  if (onbellek.has(zoneId)) return onbellek.get(zoneId);
  const base = path.join(clientDir, 'assets', 'zones', zoneId);
  let buf = null;
  try {
    const duz = path.join(base, 'nav.bin');
    const gz = path.join(base, 'nav.bin.gz');
    if (fs.existsSync(duz)) buf = fs.readFileSync(duz);
    else if (fs.existsSync(gz)) buf = zlib.gunzipSync(fs.readFileSync(gz));
  } catch { buf = null; }
  if (!buf || buf.length < HEADER || buf.readUInt32LE(0) !== MAGIC) {
    onbellek.set(zoneId, null);
    return null;
  }
  if (buf.readUInt16LE(4) !== 1) { onbellek.set(zoneId, null); return null; }

  /* Veri surumu kapisi (bkz. dosya basi): 0 = dosyada turev duvar yok,
     1 = W5 duvarlari zaten gomulu. Bilinmeyen (>1) bir surum de "gomulu"
     sayilir - ileri uyumluluk: yeni bir uretici daha genis bir kume
     yazdiysa uzerine ikinci kez turetmek yine YANLIS olurdu. */
  const dosyaTurevSurum = buf.readUInt16LE(6);

  const blockerSayisi = buf.readUInt32LE(8);
  const yuzeySayisi = buf.readUInt32LE(12);   // ofset 12: surfaceCount
  if (buf.length < HEADER + blockerSayisi * BLOCKER_BOYUT) {
    onbellek.set(zoneId, null);
    return null;
  }

  const blockers = new Array(blockerSayisi);
  let o = HEADER;
  for (let i = 0; i < blockerSayisi; i++) {
    const kind = buf.readUInt8(o + 12);
    const bayrak = buf.readUInt8(o + 13);
    const hx = buf.readFloatLE(o + 16);
    const hz = buf.readFloatLE(o + 20);
    const x = buf.readFloatLE(o), z = buf.readFloatLE(o + 4);
    const rotY = buf.readFloatLE(o + 8);
    const ox = buf.readFloatLE(o + 24), oz = buf.readFloatLE(o + 28);
    /* NORMALLESTIRME - istemci collider'i bir KEZ dunya uzayina tasiyor
       (paket Nq() @8509700: merkez = jq(rotY, ox, oz), sonra U7e/W7e ile
       {kind,x,z,cos,sin,hx,hz} uretiyor). Biz bunu her degme testinde
       yeniden hesapliyorduk; kayma (K7e) ve push-out (G7e) portlari da ayni
       merkezi istedigi icin cozup burada sakliyoruz. Matematik degismedi. */
    const co = Math.cos(rotY), si = Math.sin(rotY);
    blockers[i] = {
      x, z, rotY,
      daire: kind === 1,
      hx, hz,
      ox, oz,
      // dunya merkezi (paket jq()) ve yerel eksen kosinus/sinusu (paket Aq())
      cx: x + ox * co + oz * si,
      cz: z - ox * si + oz * co,
      co, si,
      yMin: (bayrak & 1) ? buf.readFloatLE(o + 32) : undefined,
      yMax: (bayrak & 2) ? buf.readFloatLE(o + 36) : undefined,
      /* turev: bu kayit nav.bin'den mi geldi (false) yoksa yukleme aninda
         yuzey sinir kenarindan mi uretildi (true). Alan BURADA da yaziliyor
         ki dosya blocker'lari ile turev duvarlar AYNI gizli sinifi (hidden
         class) paylassin - degiyorXZ/sorgu sicak dongulerinde iki ayri sekil
         polimorfik erisime yol acardi. */
      turev: false,
    };
    o += BLOCKER_BOYUT;
  }

  /* --- YUZEY AGLARI (surface meshes) ---
     Basliktaki 12. ofsette surfaceCount duruyor ve blocker'lardan SONRA
     her yuzey soyle geliyor (istemci F7e/decodeNav ile birebir):
         uint32 vertCount
         uint32 triCount
         float32[vertCount*3]  kose noktalari (x, y, z)
         uint32 [triCount*3]   ucgen indeksleri
     BUNLARI HIC OKUMUYORDUK. Oysa istemcinin durma yuksekligi
     arazi + BU YUZEYLER'in en yukseki; cesme kenari, merdiven, platform
     hep burada. Okumayinca oyuncu cesmenin/yapinin ALTINDAKI arazi
     seviyesine dusuyor - "yerin dibine giriyorum" sorunu tam olarak budur. */
  const surfaces = [];
  for (let si = 0; si < yuzeySayisi; si++) {
    if (buf.length < o + 8) break;
    const vertCount = buf.readUInt32LE(o);
    const triCount = buf.readUInt32LE(o + 4);
    o += 8;
    const vBayt = vertCount * 12, tBayt = triCount * 12;
    if (buf.length < o + vBayt + tBayt) break;
    const verts = new Float32Array(vertCount * 3);
    for (let i = 0; i < verts.length; i++) verts[i] = buf.readFloatLE(o + i * 4);
    const tris = new Uint32Array(triCount * 3);
    for (let i = 0; i < tris.length; i++) tris[i] = buf.readUInt32LE(o + vBayt + i * 4);
    surfaces.push({ verts, tris });
    o += vBayt + tBayt;
  }

  const nav = { blockers, surfaces, izgara: null, turevDuvar: 0, dosyaTurevSurum };

  /* TUREV DUVARLAR - bkz. asagidaki "W5" bolumu. nav.bin'in KENDI yuzey
     aglarinin sinir kenarlarindan uretilir, ek veri kaynagi YOKTUR.
     ARTIK URETIM VERISINE GOMULU (gen_navbin_duvar.mjs): dosya isareti
     (ofset 6) 1 ise duvarlar zaten blockers[] icinde geldi, IKINCI KEZ
     turetmek cift kayit demek olurdu - burada atlanir. Isaret 0 olan
     (henuz islenmemis ya da yedekten geri yuklenmis) bir nav.bin ile
     eski davranis aynen surer. */
  if (TUREV_DUVAR_ACIK && !dosyaTurevSurum && surfaces.length) {
    const ek = turevDuvarlar(nav, zoneId);
    for (const b of ek) blockers.push(b);
    nav.turevDuvar = ek.length;
  }

  izgaraKur(nav);
  onbellek.set(zoneId, nav);
  return nav;
}

/* =====================================================================
   TUREV DUVARLAR ("W5") - yapilarin ICINE girilmesinin duzeltmesi
   ---------------------------------------------------------------------
   SORUN (olculdu, uydurma degil): nav.bin'in yuzey aglari (surfaces) bir
   yapinin YURUNEBILIR zeminini tarif ediyor ama o zeminin DIK YANLARINI
   tarif eden blocker'lar buyuk olcude EKSIK. Ornek: wall_cj_jang_gate
   (Jangan kapisi) uc kademeli teras - zemin -4.89 / orta -2.54 / ust +0.14.
   Oyuncu yol kotunda (-4.89) kuzeyden guneye yuruyunce terasin ALTINA
   giriyor; sampleY ust katmani ancak `ust <= y + 0.75` ise secebildigi icin
   (BAS_BOSLUGU) 1.7-2.5 birimlik kademeye CIKAMIYOR ve tas terasin icinde
   bel hizasina kadar gomulu kaliyor.

   ORIJINAL SILKROAD KANITI (onceki turun 3. maddesi):
     cj_jang_gate06.BMS NavMeshObj -> 88 outline kenarinin TAMAMI
     dstCell=0xFFFF, yani retail'de yapinin cevresi bastan sona DUVAR;
     iceri yalnizca mesh kotu ile arazi kotunun ayni oldugu yerden girilir.
     Bagli (inline) hucreler arasindaki GERCEK dusey basamak 886 kenarda
     0.00 - yani retail mesh sureklidir, "basamak tanima" mantigi gereksiz.

   ESLESME KANITI: nav.bin yuzey aginin KENDI sinir kenarlari (tek ucgende
   gecen kenar) retail outline kenarlariyla BIREBIR ortusuyor:
     patch 1858 -> 88 sinir / 226 ic kenar
     cj_jang_gate06.BMS -> 88 outline / 226 inline
   Bu yuzden .nvm / object.ifo / .bsr / .BMS zincirine GEREK YOK: duvarlar
   nav.bin'in kendi icinden turetilebiliyor.

   KURAL (her sinir kenari icin bir kutu blocker):
     merkez = kenarin orta noktasi (ox = oz = 0)
     rotY   = atan2(ex, ez)      <- yerel Z ekseni kenar dogrultusunda
                                    (izgaraKur/degiyorXZ ile ayni konvansiyon)
     hx     = 0.15               <- nav.bin'in KENDI duvar kalinligi medyani
     hz     = kenarUzunlugu / 2
     yMax   = kenarY - BAS_BOSLUGU
              (kenar kotunda ya da 0.75 icinde duran oyuncu ETKILENMEZ;
               yani rampadan/es kottan cikis ACIK kalir - retail'de de
               oyle: giris arazi ile es kot oldugu yerdedir)
     yMin   = max(yamaninEnDusukY, kenarY - TAVAN) - 0.3

   TAVAN = 4 BILINCLI BIR SECIM (BILINCLI SAPMA):
     nav.bin tek basina "dolu tas kutle" ile "kemer/kopru acikligi" ayrimini
     YAPAMAZ; TAVAN bu ayrimin yerine gecen kelepcedir. Jangan sehir kutusunda
     (x 9200-10000, z 1300-2100, 0.5 izgara, dogus noktasindan BFS) olculdu:
       TAVAN 1.5 -> BEL 4.770  temiz-erisim kaybi   1.395 hucre
       TAVAN 2.5 -> BEL 1.943  kayip                3.342
       TAVAN 4   -> BEL 1.203  kayip                5.307   <- DIZ NOKTASI
       TAVAN 8   -> BEL   589  kayip               40.971   (asiri kapatma)
       sinirsiz  ->            kayip              442.684   (kemer altlari muhur)
     Taban 0 (bugun) -> BEL 7.437. Yani TAVAN=4 gomulmenin %84'unu siliyor.

   NOKTA KORUMASI: aday duvar bir NPC / dogus / respawn / teleport / teleport
   varis / mob yuvasi noktasini oyuncu yaricapi payiyla iceriyorsa URETILMEZ.
   Bu koruma olmadan jangan'da 3 NPC engelli kaliyordu.

   KAPSAM - ARTIK KALICI VERI (2026-09-05): duvarlar nav.bin'e GOMULDU
   (gen_navbin_duvar.mjs). nav.bin istemcinin de carpisma kaynagi oldugu icin
   (paket M9e: colliders = statics[].collider ∪ nav.blockers) istemci de artik
   AYNI duvarlari goruyor - oyuncu ekranda da yapinin icine yuruyemiyor.
   Zincirin tamami yapildi: nav.bin + nav.bin.gz yeniden uretildi,
   client/manifests/<surum>.json icindeki sha256+boyut guncellendi,
   version.json.manifestSha256 yenilendi.
   Buradaki uretim kodu SILINMEDI: (1) isaretsiz (surum 0) bir nav.bin ile
   geriye donuk calisir, (2) ureticinin TEK KAYNAGIDIR - duvarin kurali,
   y-bandi ve nokta korumasi buradan gelir.
   ===================================================================== */

/** Duvar kalinligi (yari-boy). nav.bin'deki mevcut duvar blocker'larinin
 *  hx MEDYANI 0.15 (= 1 SRO birimi x 0.15 dunya olcegi). */
const DUVAR_KALINLIK = 0.15;
/** Duvarin kenardan asagi ne kadar inecegi - yukaridaki olculmus diz noktasi. */
const DUVAR_TAVAN = 4;
/** Bandin alt ucuna eklenen pay: oyuncu yamanın en dip kotunun 0.3 birim
 *  altindayken de (arazi cukuru) duvari gormeli. */
const DUVAR_TABAN_PAY = 0.3;
/** Nokta korumasinda kullanilan ek pay (yaricapin ustune). */
const KORUMA_PAY = 0.1;

/** Turev duvarlar acik mi? OYUN_TUREV_DUVAR=0 ile kapatilir (acil geri alma).
 *  DIKKAT: bu yalnizca YUKLEME ANINDAKI uretimi kapatir. Uretim nav.bin'leri
 *  artik duvarlari DOSYADA tasiyor (isaret: ofset 6 = 1); onlari kapatmak
 *  icin dosyayi YEDEK/navbin-oncesi-2026-09-05/ altindan geri yuklemek gerekir. */
let TUREV_DUVAR_ACIK = process.env.OYUN_TUREV_DUVAR !== '0';

/** nav.bin ofset 6'ya yazilan veri surumu. Uretici (gen_navbin_duvar.mjs) ile
 *  ORTAK KAYNAK - iki dosya ayrisamasin diye buradan ithal ediliyor. */
export const TUREV_SURUM = 1;

/** Bir bolgenin W5 turev duvarlarini URETIR (dosyaya yazmaz, nav'i degistirmez).
 *  gen_navbin_duvar.mjs bunu cagirir: uretilen duvarin kurali, y-bandi ve
 *  nokta korumasi sunucununkiyle TEK KAYNAKTAN gelsin diye. Isaretli
 *  (zaten gomulu) bir nav ile de calisir - uretici idempotenslik
 *  karsilastirmasi icin tam da bunu ister. */
export function turevDuvarlariUret(nav, zoneId) {
  return turevDuvarlar(nav, zoneId);
}

/** Calisma zamaninda ac/kapa (olcum betikleri A/B karsilastirmasi icin kullanir).
 *  Onbellegi temizler - bir sonraki loadNav yeniden kurar. */
export function turevDuvarAyarla(acik) {
  const v = !!acik;
  if (v === TUREV_DUVAR_ACIK) return v;
  TUREV_DUVAR_ACIK = v;
  onbellek.clear();
  return v;
}
export function turevDuvarAcikMi() { return TUREV_DUVAR_ACIK; }

const BURASI = path.dirname(fileURLToPath(import.meta.url));

/** Sunucunun KENDI verisinden korunacak noktalar (salt okuma, hata yutulur). */
const korumaOnbellek = new Map();
function korumaNoktalari(zoneId) {
  if (korumaOnbellek.has(zoneId)) return korumaOnbellek.get(zoneId);
  const oku = (...p) => {
    try { return JSON.parse(fs.readFileSync(path.join(BURASI, ...p), 'utf8')); }
    catch { return null; }
  };
  const P = [];
  const ekle = (o) => { if (o && Number.isFinite(o.x) && Number.isFinite(o.z)) P.push([o.x, o.z]); };

  const W = oku('world.json');
  const wz = W?.zones?.[zoneId];
  if (wz) {
    for (const n of wz.npcs ?? []) ekle(n);
    for (const t of wz.teleporters ?? []) { ekle(t); ekle(t.toPos); }
    for (const g of wz.gates ?? []) ekle(g);
    ekle(wz.playerSpawn); ekle(wz.respawnPoint);
  }
  const shops = oku('data', 'npcshops.json');
  const sz = shops?.zones?.[zoneId];
  if (sz) {
    for (const n of sz.npcs ?? []) ekle(n);
    ekle(sz.playerSpawn); ekle(sz.respawnPoint);
  }
  const tele = oku('data', 'teleporters.json');
  for (const t of tele?.zones?.[zoneId] ?? []) {
    ekle(t);
    for (const d of t.destinations ?? []) if (d.toZone === zoneId) ekle(d.toPos);
  }
  const sp = oku('data', 'spawns.json');
  for (const s of sp?.[zoneId] ?? []) ekle(s);

  // 8 birimlik izgara (HUCRE ile ayni) - aday basina tam tarama pahali olurdu
  const g = new Map();
  for (let i = 0; i < P.length; i++) {
    const k = Math.floor(P[i][0] / HUCRE) + ',' + Math.floor(P[i][1] / HUCRE);
    let l = g.get(k); if (!l) g.set(k, l = []);
    l.push(i);
  }
  const K = {
    sayi: P.length,
    /** blocker (pay dahil) korunacak bir noktayi iceriyor mu? */
    carpiyor(b, pay) {
      const rx = b.hx + pay, rz = b.hz + pay;
      const yari = Math.max(rx, rz);
      for (let cx = Math.floor((b.cx - yari) / HUCRE); cx <= Math.floor((b.cx + yari) / HUCRE); cx++)
        for (let cz = Math.floor((b.cz - yari) / HUCRE); cz <= Math.floor((b.cz + yari) / HUCRE); cz++)
          for (const i of g.get(cx + ',' + cz) ?? []) {
            const dx = P[i][0] - b.cx, dz = P[i][1] - b.cz;
            const lx = dx * b.co - dz * b.si, lz = dx * b.si + dz * b.co;
            if (Math.abs(lx) <= rx && Math.abs(lz) <= rz) return true;
          }
      return false;
    },
  };
  korumaOnbellek.set(zoneId, K);
  return K;
}

/**
 * Yuzey aglarinin SINIR kenarlarindan duvar blocker'lari uretir.
 * Sinir kenari = ayni yamada TEK bir ucgende gecen kenar (ic kenarlar iki
 * ucgende gecer ve hucre GECISIDIR - asla kapatilmaz).
 */
function turevDuvarlar(nav, zoneId) {
  const K = korumaNoktalari(zoneId);
  const pay = YARICAP_AKTIF + KORUMA_PAY;
  const ek = [];
  for (const su of nav.surfaces) {
    const V = su.verts, T = su.tris;
    if (!T?.length) continue;
    // yamanin en dusuk kosesi - bandin alt siniri bunun altina inmez
    let minY = Infinity;
    for (let i = 1; i < V.length; i += 3) if (V[i] < minY) minY = V[i];

    const say = new Map();
    for (let i = 0; i + 2 < T.length; i += 3) {
      const a = T[i], b = T[i + 1], c = T[i + 2];
      for (let j = 0; j < 3; j++) {
        const p = j === 0 ? a : j === 1 ? b : c;
        const q = j === 0 ? b : j === 1 ? c : a;
        const k = p < q ? p * 4294967296 + q : q * 4294967296 + p;
        const e = say.get(k);
        if (e) e.n++; else say.set(k, { n: 1, p, q });
      }
    }

    for (const e of say.values()) {
      if (e.n !== 1) continue;                    // ic kenar = gecis, dokunma
      const a = e.p * 3, b = e.q * 3;
      const ax = V[a], ay = V[a + 1], az = V[a + 2];
      const bx = V[b], by = V[b + 1], bz = V[b + 2];
      const ex = bx - ax, ez = bz - az;
      const L = Math.hypot(ex, ez);
      if (L < 1e-4) continue;                     // dikey/dejenere kenar

      /* float32 KELEPCESI: bu duvarlar nav.bin'e float32 olarak yaziliyor
         (gen_navbin_duvar.mjs). Degerleri BURADA fround ile 32-bite
         yuvarlıyoruz ki "bellekteki duvar" ile "dosyadaki duvar" BIT BIT
         ayni olsun - aksi halde iki yol (isaretsiz dosya -> yukleme aninda
         uretim, isaretli dosya -> dosyadan okuma) 7. haneden ayrisirdi. */
      const kY = (ay + by) / 2;
      const yMax = Math.fround(kY - BAS_BOSLUGU);
      const yMin = Math.fround(Math.max(minY, kY - DUVAR_TAVAN) - DUVAR_TABAN_PAY);
      /* Bant kapanmis - duvar yok. Karsilastirma float32 degerler UZERINDE:
         float64'te acik gorunen ama float32'ye yuvarlaninca yMin === yMax'e
         cokup OLU KAYDA donusen kenarlar var (olculdu: 130.419 adayin 3'u -
         jangan 2, europe 1). Bunlari uretmiyoruz: dosyaya yazilsalar hicbir
         y degerini engellemeyen bos kayitlar olurlardi. */
      if (!(yMax > yMin)) continue;

      const cx = Math.fround((ax + bx) / 2), cz = Math.fround((az + bz) / 2);
      const rotY = Math.fround(Math.atan2(ex, ez));
      const hz = Math.fround(L / 2);
      if (!(hz > 0)) continue;                    // float32'de sifirlanan kenar
      const blk = {
        x: cx, z: cz, rotY,
        daire: false,
        hx: Math.fround(DUVAR_KALINLIK), hz,
        ox: 0, oz: 0,
        cx, cz,
        co: Math.cos(rotY), si: Math.sin(rotY),
        yMin, yMax,
        turev: true,                              // olcum/denetim icin isaret
      };
      if (K.sayi && K.carpiyor(blk, pay)) continue;
      ek.push(blk);
    }
  }
  return ek;
}

/* Egim/basamak sinirlari - birim basina izin verilen yukseklik degisimi.
   gameConfig.slopeLimitUpPerU/DownPerU = 1.2 SADECE genel varsayilandir; her BOLGE
   kendi degerini tasir ve hepsi bunu EZIYOR:
     jangan/donwhang/europe/hotan/samarkand -> 1000 (pratikte sinir YOK)
   Ayrica bolgede `slopeOverrides` dikdortgenleri olabilir (europe 2, hotan 1;
   hepsi upPerU/downPerU = 1.75) - o alanlarda YEREL sinir gecerlidir.
   1.2'yi bolge geneline uygulamak, 0.30'luk normal bir merdiven basamaginda bile
   yolu kesiyordu: karakter tiklanan yere gitmeden ~2 saniyede duruyordu. */
const EGIM_VARSAYILAN = 1.2;    // data/game-config.json slopeLimitUpPerU/DownPerU
const EPSILON = 0.001;          // paketteki Oq (@8481147: `var Oq = .001`)

/** Konuma gore egim siniri - `slopeOverrides` dikdortgeni varsa o kazanir.
 *  Istemcide iki ayri parca: x9e() override'i bulur (@8509347), moveCircle
 *  bulunamazsa maxStepUp/maxStepDown'a duser (@8489012). Bizde tek fonksiyon. */
function egimSiniri(egim, x, z) {
  if (!egim) return { up: EGIM_VARSAYILAN, down: EGIM_VARSAYILAN };
  for (const o of egim.overrides ?? []) {
    if (x >= o.x0 && x <= o.x1 && z >= o.z0 && z <= o.z1) {
      return { up: o.upPerU, down: o.downPerU };
    }
  }
  return { up: egim.up ?? EGIM_VARSAYILAN, down: egim.down ?? EGIM_VARSAYILAN };
}

/** Mekansal izgara. Istemci de 8 kullaniyor (paket: `var q7e = 8`). */
const HUCRE = 8;

/** Push-out tur sayisi ve kacis taramasi - paket @8484800:
 *    var q7e = 8, J7e = 4, Y7e = [1, 2, 4, 8, 16], X7e = 16;
 *  J7e   : moveCircle'in bir adimda kac kez ite-kurtar denemesi yapacagi
 *  J7e*2 : resolvePoint tur sayisi (8)
 *  Y7e   : escapePoint'in tarayacagi yaricaplar (birim)
 *  X7e   : her yaricapta denenecek aci sayisi */
const ITME_TURU = 4;
const KACIS_YARICAPLARI = [1, 2, 4, 8, 16];
const KACIS_ACILARI = 16;

/** Oyuncu/varlik yaricapi - gameConfig.entityRadiusU VARSAYILANI. Istemci NOKTA
 *  degil DAIRE olarak test ediyor (paket: Mq(), moveCircle cagrilari). */
export const YARICAP = 0.5;

/* Calisma zamani yaricapi. Istemci her cagrida `Y$` degiskenini kullaniyor ve
   o da gameConfig.entityRadiusU'dan geliyor (@8489012); bizde sabitti, yani
   admin panelinden entityRadiusU degistiginde carpisma yaricapi 0.5'te kaliyordu.
   server.js acilista yaricapAyarla(GCFG.entityRadiusU) cagirir. */
let YARICAP_AKTIF = YARICAP;

/** Calisma zamani varlik yaricapini ayarlar (gameConfig.entityRadiusU). */
export function yaricapAyarla(r) {
  const v = Number(r);
  if (!(v > 0) || v === YARICAP_AKTIF) return YARICAP_AKTIF;
  YARICAP_AKTIF = v;
  /* SON_NAV_IZGARA_PARITE sonrasi izgara ARTIK yaricaptan bagimsiz (hucreler
     collider'in kendi AABB'sine gore yazilir, pay sorgu tarafinda eklenir -
     istemcideki A9e ile ayni). Onbellegi yine de temizliyoruz: bedeli yok
     (acilista bos) ve ileride yaricaba bagli bir alan eklenirse guvenli kalir. */
  onbellek.clear();
  return YARICAP_AKTIF;
}

/** Calisma zamani varlik yaricapi. */
export function yaricapAl() { return YARICAP_AKTIF; }

function izgaraKur(nav) {
  const g = new Map();
  for (let i = 0; i < nav.blockers.length; i++) {
    const b = nav.blockers[i];
    /* SON_NAV_IZGARA_PARITE (2026-09-04, SERIT 5 - RAM olcumu):
       Blocker'i izgaraya YERLESTIRIRKEN eskiden CEVREL DAIRE (hypot(hx,hz))
       ve DONDURULMEMIS merkez (x+ox, z+oz) kullaniliyordu. Bu, istemcinin
       yaptigi is DEGIL ve bellekte olculebilir bir felakete yol aciyordu:
       uzun-ince bolge siniri duvarlari (orn. samarkand hx=4752, hz=2) tek
       basina 1.414.910 hucreye yaziliyordu. Olcum (5 canli bolge):
         izgara girdisi 14.092.090 -> 1.653.479 (8.5x)
         izgara+blocker 2.035,7 MB ->   353,5 MB (5,8x, -1,68 GB)
         acilis verisi  2.456,9 MB ->   622,2 MB rss (kataloglar+heights dahil)
         engelliMi denkligi 1,5M rastgele + 1,42M blocker-cevresi ornekte 0 fark
       ISTEMCI PARITESI (paket app/index-DzRqDn3Z.js):
         tq()  : merkez = (x + ox*cos + oz*sin, z - ox*sin + oz*cos)  -> cx/cz
         S9e() : kutu aabb yari-boyu = |hx*cos|+|hz*sin| , |hx*sin|+|hz*cos|
         x9e() : daire aabb yari-boyu = r
         A9e() : hucrelere aabb.min/max ile yazar, PAY EKLEMEZ (pay sorgu
                 tarafinda: query(x,z,r) kutuyu r kadar buyutur - bizde de oyle)
       Yani bu degisiklik izgarayi istemcininkiyle BIREBIR ayni yapar. */
    const ax = b.daire ? b.hx : Math.abs(b.hx * b.co) + Math.abs(b.hz * b.si);
    const az = b.daire ? b.hx : Math.abs(b.hx * b.si) + Math.abs(b.hz * b.co);
    const minX = Math.floor((b.cx - ax) / HUCRE);
    const maxX = Math.floor((b.cx + ax) / HUCRE);
    const minZ = Math.floor((b.cz - az) / HUCRE);
    const maxZ = Math.floor((b.cz + az) / HUCRE);
    for (let cx = minX; cx <= maxX; cx++) {
      for (let cz = minZ; cz <= maxZ; cz++) {
        const k = cx + ',' + cz;
        let liste = g.get(k);
        if (!liste) { liste = []; g.set(k, liste); }
        liste.push(i);
      }
    }
  }
  nav.izgara = g;
}

/**
 * Yaricapi r olan DAIRE bu blocker'a degiyor mu?
 *
 * Istemcinin matematigi birebir (paket index-BUMMQVRB.js):
 *   - merkez kaymasi rotY ile DONDURULUR   -> Nq(): cx = x + ox*cos + oz*sin
 *                                                    cz = z - ox*sin + oz*cos
 *   - dunya->yerel donusum POZITIF rotY ile -> Aq(): lx = dx*cos - dz*sin
 *                                                    lz = dx*sin + dz*cos
 *   - kutu testi clamp + mesafe^2 < r^2     -> Mq()
 *   - y bandi                                -> kq()
 *
 * Bizde donme TERS idi (cos(-rotY)) ve nokta testi yapiliyordu (r = 0);
 * ikisi birden duvarlarin icinden gecilmesine yol aciyordu.
 */
/** Y bandi kapisi - istemcinin kq()'su (@8481162):
 *  `band === undefined || (y >= band.yMin && y <= band.yMax)`.
 *  y bilinmiyorsa (undefined) eliyemeyiz, gecirilir. */
function bandGecer(b, y) {
  if (y === undefined) return true;
  if (b.yMin !== undefined && y < b.yMin) return false;
  if (b.yMax !== undefined && y > b.yMax) return false;
  return true;
}

/** Sadece XZ degme testi (band DISINDA) - istemcinin Mq()'su. */
function degiyorXZ(b, x, z, r) {
  const dx = x - b.cx, dz = z - b.cz;

  if (b.daire) {
    const t = b.hx + r;
    /* KESIN kucuk: paket Mq() @8482000 `v_i*v_i + v_a2*v_a2 < v_o2*v_o2`.
       Bizde `<=` idi; tam tegetteki nokta bizde ENGELLI, istemcide SERBEST
       sayiliyordu. Push-out kodlari noktayi tam (r + Oq) mesafesine koydugu
       icin `<=` ile itilen nokta hala "engelli" cikip ITME_TURU'nu bosa
       harciyor ve kayma sonsuz donguye giriyordu. */
    return dx * dx + dz * dz < t * t;
  }

  // kutu: yerel eksene tasi, sonra dikdortgene en yakin noktaya uzaklik
  const lx = dx * b.co - dz * b.si, lz = dx * b.si + dz * b.co;
  const qx = Math.max(-b.hx, Math.min(b.hx, lx));
  const qz = Math.max(-b.hz, Math.min(b.hz, lz));
  const ex = lx - qx, ez = lz - qz;
  return ex * ex + ez * ez < r * r;
}

function degiyor(b, x, z, y, r) {
  return bandGecer(b, y) && degiyorXZ(b, x, z, r);
}

/** Yerel eksen -> dunya (paket jq()). */
function dunyaya(b, lx, lz) {
  return { x: b.cx + lx * b.co + lz * b.si, z: b.cz - lx * b.si + lz * b.co };
}
/** Dunya -> yerel eksen (paket Aq()). */
function yerele(b, x, z) {
  const dx = x - b.cx, dz = z - b.cz;
  return { x: dx * b.co - dz * b.si, z: dx * b.si + dz * b.co };
}

/**
 * (x,z) merkezli r yaricapli daireyle kesisebilecek blocker'lar.
 * Istemcinin Q7e.query()'si (@8484800) - hucre kutusunu tarar, tekrarlari eler.
 */
function sorgu(nav, x, z, r) {
  const cikan = [];
  if (!nav?.izgara) return cikan;
  const minX = Math.floor((x - r) / HUCRE), maxX = Math.floor((x + r) / HUCRE);
  const minZ = Math.floor((z - r) / HUCRE), maxZ = Math.floor((z + r) / HUCRE);
  const gorulen = (maxX > minX || maxZ > minZ) ? new Set() : null;
  for (let cx = minX; cx <= maxX; cx++) {
    for (let cz = minZ; cz <= maxZ; cz++) {
      const liste = nav.izgara.get(cx + ',' + cz);
      if (!liste) continue;
      for (const i of liste) {
        if (gorulen) { if (gorulen.has(i)) continue; gorulen.add(i); }
        cikan.push(nav.blockers[i]);
      }
    }
  }
  return cikan;
}

/**
 * (x,z) noktasindaki r yaricapli daire herhangi bir blocker'a degiyor mu?
 * Tek hucre yetmez: daire hucre sinirini asabilir, bu yuzden (x+-r, z+-r)
 * kutusunu kapsayan TUM hucreler taranir. (istemci: Q7e.isBlocked)
 */
export function engelliMi(nav, x, z, y, r = YARICAP_AKTIF) {
  if (!nav?.izgara) return false;
  const minX = Math.floor((x - r) / HUCRE), maxX = Math.floor((x + r) / HUCRE);
  const minZ = Math.floor((z - r) / HUCRE), maxZ = Math.floor((z + r) / HUCRE);
  for (let cx = minX; cx <= maxX; cx++) {
    for (let cz = minZ; cz <= maxZ; cz++) {
      const liste = nav.izgara.get(cx + ',' + cz);
      if (!liste) continue;
      for (const i of liste) if (degiyor(nav.blockers[i], x, z, y, r)) return true;
    }
  }
  return false;
}

/* =====================================================================
   KURTARMA VE KAYMA - istemcinin G7e / K7e / resolvePoint / escapePoint /
   moveCircle dortlusunun birebir portu (paket @8482000-8490700).

   NEDEN: nav.js ILK engelde duruyordu; ne duvar boyunca KAYMA (K7e) ne de
   collider icinde kalan varligi kurtarma (escapePoint) vardi.
     - kayma yok  -> kose donen oyuncu duvara carpip duruyor, sunucu kisa
       hedefi entity.move ile istemciye ZORLA kabul ettiriyor (applyMove
       @25663224 hedefi sunucununkiyle degistirir) -> "takilip buga giriyorum"
     - kacis yok  -> collider icine dusen varlik (isinlanma varisi, knockback)
       bir daha kipirdayamiyor -> tr.json ui.bug.subj.stuck "Yerinde takili"
   ===================================================================== */

/**
 * Noktayi blocker'in DISINA it - yon farkindaligi YOK (paket G7e @8483000).
 * resolvePoint bunu kullanir.
 */
function itDisari(p, r, b) {
  if (b.daire) {
    const dx = p.x - b.cx, dz = p.z - b.cz;
    const d = Math.sqrt(dx * dx + dz * dz);
    const R = b.hx + r;
    if (d >= R) return p;
    if (d === 0) return { x: b.cx + R + EPSILON, z: b.cz };
    const k = (R + EPSILON) / d;
    return { x: b.cx + dx * k, z: b.cz + dz * k };
  }
  const L = yerele(b, p.x, p.z);
  if (Math.abs(L.x) <= b.hx && Math.abs(L.z) <= b.hz) {
    // icerideysek EN YAKIN yuze cik
    if (b.hx - Math.abs(L.x) <= b.hz - Math.abs(L.z)) {
      return dunyaya(b, (L.x >= 0 ? 1 : -1) * (b.hx + r + EPSILON), L.z);
    }
    return dunyaya(b, L.x, (L.z >= 0 ? 1 : -1) * (b.hz + r + EPSILON));
  }
  const qx = Math.max(-b.hx, Math.min(b.hx, L.x));
  const qz = Math.max(-b.hz, Math.min(b.hz, L.z));
  const ex = L.x - qx, ez = L.z - qz;
  const d = Math.sqrt(ex * ex + ez * ez);
  if (d >= r) return p;
  const k = (r + EPSILON) / d;
  return dunyaya(b, qx + ex * k, qz + ez * k);
}

/**
 * YON FARKINDALIKLI push-out = duvar boyunca KAYMA (paket K7e @8484800).
 * `kaynak` bir onceki (engelsiz) konumdur; itme onun tarafina dogru yapilir,
 * boylece nokta duvarin obur tarafina "sizmaz", duvara PARALEL kayar.
 */
function itDisariYonlu(p, r, b, kaynak) {
  if (b.daire) {
    const dx = p.x - b.cx, dz = p.z - b.cz;
    const d = Math.sqrt(dx * dx + dz * dz);
    const R = b.hx + r;
    if (d >= R) return p;
    let fx = kaynak.x - b.cx, fz = kaynak.z - b.cz;
    const fl = Math.sqrt(fx * fx + fz * fz);
    if (fl === 0) { fx = 1; fz = 0; } else { fx /= fl; fz /= fl; }
    if (d === 0 || dx * fx + dz * fz <= 0) {
      return { x: b.cx + fx * (R + EPSILON), z: b.cz + fz * (R + EPSILON) };
    }
    const k = (R + EPSILON) / d;
    return { x: b.cx + dx * k, z: b.cz + dz * k };
  }
  const P = yerele(b, p.x, p.z);
  const S = yerele(b, kaynak.x, kaynak.z);
  const disX = Math.abs(S.x) >= b.hx;
  const disZ = Math.abs(S.z) >= b.hz;
  let cX, cZ;
  if (Math.abs(P.x) <= b.hx && Math.abs(P.z) <= b.hz) {
    const sx = ((disX ? S.x : P.x) >= 0 ? 1 : -1);
    const sz = ((disZ ? S.z : P.z) >= 0 ? 1 : -1);
    const ux = sx * (b.hx + r + EPSILON);
    const uz = sz * (b.hz + r + EPSILON);
    if (Math.abs(ux - P.x) <= Math.abs(uz - P.z)) { cX = ux; cZ = P.z; }
    else { cX = P.x; cZ = uz; }
  } else {
    const qx = Math.max(-b.hx, Math.min(b.hx, P.x));
    const qz = Math.max(-b.hz, Math.min(b.hz, P.z));
    const ex = P.x - qx, ez = P.z - qz;
    const d = Math.sqrt(ex * ex + ez * ez);
    if (d >= r) return p;
    const k = (r + EPSILON) / d;
    cX = qx + ex * k; cZ = qz + ez * k;
  }
  if (disX && (S.x >= 0) !== (cX >= 0)) cX = (S.x >= 0 ? 1 : -1) * (b.hx + r + EPSILON);
  if (disZ && (S.z >= 0) !== (cZ >= 0)) cZ = (S.z >= 0 ? 1 : -1) * (b.hz + r + EPSILON);
  return dunyaya(b, cX, cZ);
}

/** Istemcinin resolvePoint'i: en fazla J7e*2 = 8 tur yon-korumasiz itme. */
export function cozNokta(nav, x, z, y, r = YARICAP_AKTIF) {
  let p = { x, z };
  if (!nav?.izgara) return p;
  for (let tur = 0; tur < ITME_TURU * 2; tur++) {
    let itildi = false;
    for (const b of sorgu(nav, p.x, p.z, r)) {
      if (bandGecer(b, y) && degiyorXZ(b, p.x, p.z, r)) { p = itDisari(p, r, b); itildi = true; }
    }
    if (!itildi) return p;
  }
  return p;
}

/**
 * Istemcinin escapePoint'i: once resolvePoint, olmazsa 1/2/4/8/16 birim
 * yaricapta 16 aci tarayip ILK bos noktayi secer. Hicbiri olmazsa null.
 *
 * `ornekY` (istege bagli, imza (x,z,oncekiY)->y) verilirse her aday KENDI
 * yuksekliginde sinanir - bkz. asagidaki "Y BANDI TUTARLILIGI" notu. Aday
 * kabul edilirse donen nesne o yuksekligi `y` alaninda tasir; cagiran ikinci
 * kez ornekleme YAPMAMALIDIR, yoksa dogrulanan y ile taahhut edilen y ayrisir.
 * Verilmezse davranis eskisiyle birebir aynidir (donen nesnede y yoktur).
 */
export function kacisNoktasi(nav, x, z, y, r = YARICAP_AKTIF, ornekY = null) {
  /** Aday bos mu? Bos ise TAAHHUT EDILECEK y ile birlikte doner. */
  const bosMu = (px, pz) => {
    if (!ornekY) return engelliMi(nav, px, pz, y, r) ? null : { x: px, z: pz };
    const py = ornekY(px, pz, y);
    return engelliMi(nav, px, pz, py, r) ? null : { x: px, z: pz, y: py };
  };

  const p = cozNokta(nav, x, z, y, r);
  const ilk = bosMu(p.x, p.z);
  if (ilk) return ilk;
  for (const R of KACIS_YARICAPLARI) {
    for (let i = 0; i < KACIS_ACILARI; i++) {
      const a = i / KACIS_ACILARI * Math.PI * 2;
      const nx = x + Math.sin(a) * R;
      const nz = z + Math.cos(a) * R;
      const aday = bosMu(nx, nz);
      if (aday) return aday;
    }
  }
  return null;
}

/**
 * ISTEMCININ moveCircle'I (paket @8489012) - OYUNCU HAREKETININ TEK KAYNAGI.
 *
 * `bas`tan `hedef`e dogru en fazla `enFazla` birim ilerler; her adimda aday
 * noktayi en fazla ITME_TURU kez KAYDIRARAK (K7e) duvarin disinda tutar.
 * Ilerleme kalmadiysa (ileri izdusum <= adim*0.001) `engellendi` doner.
 *
 * ctx (istemcideki `vec3`):
 *   ornekY(x, z, oncekiY) -> y     (sampler.sampleY)
 *   y                              (baslangic yuksekligi)
 *   egim: {up, down, overrides[]}  (maxStepUp/maxStepDown + slopeAt)
 *   taban(x, z) -> y | undefined   (waterFloor / floorY)
 * ctx yoksa (duz arazi) yalniz carpisma denetlenir - istemci de boyle yapiyor.
 */
export function daireHareket(nav, bas, hedef, enFazla, r = YARICAP_AKTIF, ctx = null) {
  let cur = { x: bas.x, z: bas.z };
  let y = ctx ? ctx.y : undefined;
  if (!nav?.izgara) {
    const d0 = Math.hypot(hedef.x - cur.x, hedef.z - cur.z);
    const t = d0 > 0 ? Math.min(1, enFazla / d0) : 0;
    return { x: cur.x + (hedef.x - cur.x) * t, z: cur.z + (hedef.z - cur.z) * t, y, engellendi: false };
  }

  // --- (1) baslangic collider icindeyse KURTAR --------------------------
  if (engelliMi(nav, cur.x, cur.z, y, r)) {
    /* Kacis adaylari KENDI yuksekliklerinde sinanir (ornekY geciliyor).
       Eskiden aday ESKI y ile "bos" sayilir, hemen ardindan y o noktanin
       zeminine YAZILIRDI - kacis noktasi yeni y'de yine duvarin bandinda
       kalabiliyordu; bkz. "Y BANDI TUTARLILIGI". */
    const k = kacisNoktasi(nav, cur.x, cur.z, y, r, ctx?.ornekY);
    if (!k) return { x: bas.x, z: bas.z, y, engellendi: true };
    if (ctx?.ornekY) {
      const ny = k.y;                    // kacisNoktasi'nin DOGRULADIGI y
      /* Kacis noktasi suyun dibine ya da (yerel egim kurali olan bir alanda)
         3 birimden fazla kata siciyorsa kacisi REDDET - istemci de tam olarak
         bu iki kapiyi koyuyor (@8489012). */
      const yerel = ctx.egim ? egimOverrideVar(ctx.egim, k.x, k.z) : false;
      if ((ctx.taban && ny < ctx.taban(k.x, k.z)) || (yerel && Math.abs(ny - (y ?? ny)) > 3)) {
        return { x: bas.x, z: bas.z, y, engellendi: true };
      }
      y = ny;
    }
    cur = k;
  }

  // --- (2) adim adim ilerle, her adimda kaydir --------------------------
  let kalan = Math.min(enFazla, Math.hypot(hedef.x - cur.x, hedef.z - cur.z));
  if (kalan === 0) return { x: cur.x, z: cur.z, y, engellendi: false };

  /* adim = max(r, Oq*2). Istemci OYUNCU icin bunu kullanir (clipSegment'in
     r/2'si degil) - egim butcesi adimla carpildigi icin fark onemli. */
  const adim = Math.max(r, EPSILON * 2);

  while (kalan > 0) {
    const boy = Math.min(kalan, adim);
    const d = Math.hypot(hedef.x - cur.x, hedef.z - cur.z);
    if (d === 0) break;

    let aday = d <= boy
      ? { x: hedef.x, z: hedef.z }
      : { x: cur.x + (hedef.x - cur.x) * (boy / d), z: cur.z + (hedef.z - cur.z) * (boy / d) };

    // KAYMA: en fazla ITME_TURU kez, yon farkindalikli push-out
    let temiz = false;
    for (let tur = 0; tur < ITME_TURU; tur++) {
      let degdi = false;
      for (const b of sorgu(nav, aday.x, aday.z, r)) {
        if (bandGecer(b, y) && degiyorXZ(b, aday.x, aday.z, r)) {
          aday = itDisariYonlu(aday, r, b, cur);
          degdi = true;
        }
      }
      if (!degdi) { temiz = true; break; }
    }
    if (!temiz && engelliMi(nav, aday.x, aday.z, y, r)) {
      return { x: cur.x, z: cur.z, y, engellendi: true };
    }

    // ileri izdusum yoksa (duvara dik bakiyoruz) dur
    const ux = (hedef.x - cur.x) / d, uz = (hedef.z - cur.z) / d;
    if ((aday.x - cur.x) * ux + (aday.z - cur.z) * uz <= boy * 0.001) {
      return { x: cur.x, z: cur.z, y, engellendi: true };
    }

    // egim / basamak / su tabani
    if (ctx?.ornekY) {
      const ny = ctx.ornekY(aday.x, aday.z, y);
      if (y !== undefined && ny !== undefined) {
        const delta = ny - y;
        const { up, down } = egimSiniri(ctx.egim, aday.x, aday.z);
        if (delta > up * boy + EPSILON || -delta > down * boy + EPSILON ||
            (ctx.taban && ny < ctx.taban(aday.x, aday.z))) {
          return { x: cur.x, z: cur.z, y, engellendi: true };
        }
      }
      /* Y BANDI TUTARLILIGI (olculdu - uydurma degil)
         -----------------------------------------------------------------
         Kayma dongusu adayi SIRA GELEN y ile temizler (bandGecer/degiyorXZ),
         ama hemen asagida y ADAYIN zeminine yazilir. Blocker'larin %99,997'si
         yMin/yMax tasidigi icin bu iki y farkliysa aday YENI y'de yine bandin
         icine dusebilir - yani sunucu varligi duvarin ICINE tasiyip orada
         BIRAKIR. Jangan olcumu (487 yuruyus): 5 vakada olustu ve 3'u sonraki
         tikte de kurtarilamadi, cunku her tik ayni sarkaci tekrarliyordu:
           kacis y'yi bandin USTUNE cikarir (-2.174 -> -1.663, yMax -1.890)
           -> ilk adim zemini yeniden ornekler (-2.047) -> tekrar BANDIN ICI.
         Ornek blocker: hx=0.15 W5 teras duvari, band [-2.790, -1.890].

         KURAL: bir adim ancak UZERINDE DURACAGI y ile de bossa taahhut edilir.
         Aksi halde adim ENGELLI sayilir ve `cur` (dogrulanmis son konum) doner.
         Tumevarim: (cur, y) her zaman bostur - (1) kacisi kendi y'sinde
         dogrular, (2) burasi da oyle; yani daireHareket ARTIK collider icinde
         bir (x, z, y) uclusu DONDURMEZ.

         BILINCLI SAPMA: istemcinin moveCircle'i (@8489012) carpismayi ESKI y
         ile sinayip `v_o = vec6.y` ile yeni y'yi kosulsuz yaziyor - bu delik
         onda da var. Sapma varligi duvarin DISINDA tuttugu icin GUVENLI
         yondedir: fazladan hicbir yere gecirmez, yalniz gecirmemesi gereken
         yerde durdurur. Kontrol sadece zemin DEGISTIYSE calisir (ny !== y),
         yani duz arazide ek maliyet yoktur. */
      if (ny !== undefined && ny !== y && engelliMi(nav, aday.x, aday.z, ny, r)) {
        return { x: cur.x, z: cur.z, y, engellendi: true };
      }
      y = ny;
    }

    cur = aday;
    kalan -= boy;
    if (cur.x === hedef.x && cur.z === hedef.z) break;
  }
  return { x: cur.x, z: cur.z, y, engellendi: false };
}

/** Nokta bir slopeOverrides dikdortgeninin icinde mi? (paket x9e null/deger) */
function egimOverrideVar(egim, x, z) {
  for (const o of egim?.overrides ?? []) {
    if (x >= o.x0 && x <= o.x1 && z >= o.z0 && z <= o.z1) return true;
  }
  return false;
}

/**
 * Baslangictan hedefe dogru yurunebilen EN UZAK noktayi dondurur.
 * Istemci sadece hedef noktayi yolluyor; aradaki duvari biz buluyoruz.
 */
export function yuruYolu(nav, x0, z0, x1, z1, groundY, adim = YARICAP_AKTIF, baslangicY, egim = null, taban = null, r = YARICAP_AKTIF) {
  if (!nav) return { x: x1, z: z1, engellendi: false };

  /* BASLANGIC COLLIDER ICINDE MI? Istemcinin hem moveCircle'i hem clipSegment'i
     ilk is olarak bunu sinar ve escapePoint ile disari cikar (@8489012).
     Bizde bu yoktu: icine dusen varlik ilk ornekte engelli cikip
     `sonIyi = (x0,z0)` donduruyordu, yani bacak kurulamiyor ve varlik
     SONSUZA KADAR takili kaliyordu (tr.json ui.bug.subj.stuck). */
  let bx = x0, bz = z0;
  if (engelliMi(nav, bx, bz, baslangicY, r)) {
    /* Kacis adaylari KENDI zeminlerinde sinanir (groundY geciliyor): aday
       eski y'de bos gorunup yeni y'de yine bandin icinde kalabilir - o
       durumda buradan "kurtarilmis" diye ENGELLI bir baslangic donerdi
       (bkz. daireHareket'teki "Y BANDI TUTARLILIGI"). */
    const k = kacisNoktasi(nav, bx, bz, baslangicY, r, groundY ?? null);
    if (!k) return { x: x0, z: z0, y: baslangicY, engellendi: true };
    const ky = groundY ? k.y : baslangicY;   // kacisNoktasi'nin DOGRULADIGI y
    // kacis suyun dibine dusuyorsa reddet - istemci de bu kapiyi koyuyor
    if (taban && ky !== undefined && ky < taban(k.x, k.z)) {
      return { x: x0, z: z0, y: baslangicY, engellendi: true };
    }
    bx = k.x; bz = k.z; baslangicY = ky;
  }
  x0 = bx; z0 = bz;

  const dx = x1 - x0, dz = z1 - z0;
  const uzunluk = Math.hypot(dx, dz);
  if (uzunluk < 1e-3) return { x: x0, z: z0, y: baslangicY, engellendi: false };

  /* ADIM = YARICAP (0.5). Onceden 1.5 idi ve blocker'larin %97'si 0.75 birimden
     INCE oldugu icin duvarlar iki ornek ARASINDA kalip gorulmuyordu (tunelleme).
     Sonra 0.25'e cektim - o da YANLISTI: paketE IKI ayri fonksiyon var,
       moveCircle   (@8489012) adim = max(r, 0.002)   = 0.5   <- OYUNCU BUNU KULLANIR
       clipSegment  (@8491413) adim = max(r/2, 0.002) = 0.25
     Egim butcesi adimla carpildigi icin (1.2 * adim) 0.25 kullanmak butceyi
     yariya indiriyordu: 0.30'luk normal bir merdiven basamagi bile yolu kesiyor
     ve karakter ~2 saniyede duruyordu. 0.5 ile butce 0.6 olur.
     Tunelleme riski yok: 0.5 yaricapli daire 0.5 adimla ilerleyince taranan
     koridor sureklidir (daireler bitisir). 400'luk tavan da kaldirildi. */
  const n = Math.ceil(uzunluk / adim);
  const adimBoy = uzunluk / n;
  let sonIyiX = x0, sonIyiZ = z0;
  let y = baslangicY ?? (groundY ? groundY(x0, z0, undefined) : undefined);

  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const px = x0 + dx * t, pz = z0 + dz * t;

    /* Zemini bir ONCEKI yuksekligimize gore ornekle - istemci de boyle yapiyor
       (sampleY(x, z, prevY)). Ayni (x,z) icin farkli prevY farkli KAT verir. */
    const py = groundY ? groundY(px, pz, y) : undefined;

    if (engelliMi(nav, px, pz, py, r)) {
      return { x: sonIyiX, z: sonIyiZ, y, engellendi: true };
    }

    /* EGIM / BASAMAK SINIRI - istemcinin Q7e.clipSegment'i:
         delta > maxUp   * adim + 0.001  -> engelli
        -delta > maxDown * adim + 0.001  -> engelli
       gameConfig.slopeLimitUpPerU = slopeLimitDownPerU = 1.2, yani 0.25
       birimlik adimda en fazla 0.3 birim inis/cikis. Bu kontrol YOKTU;
       oyuncu meydandan (-4.891) cesme cukuruna (-8.160) 3.27 birim
       DUSEBILIYORDU - "yerin dibine giriyorum" sorununun kaynagi buydu. */
    if (py !== undefined && y !== undefined) {
      const delta = py - y;
      const { up, down } = egimSiniri(egim, px, pz);
      if (delta > up * adimBoy + EPSILON) return { x: sonIyiX, z: sonIyiZ, y, engellendi: true };
      if (-delta > down * adimBoy + EPSILON) return { x: sonIyiX, z: sonIyiZ, y, engellendi: true };
      /* SU TABANI - istemcinin floorY'si. Derin suda oyuncu `suY - 1.5`
         seviyesinin altina inemez; bu kisit olmadan su altindaki arazi
         seviyesine dusup iskele/kopru tahtalarinin ICINDE kaliyordu. */
      if (taban && py < taban(px, pz)) return { x: sonIyiX, z: sonIyiZ, y, engellendi: true };
      y = py;
    }

    sonIyiX = px; sonIyiZ = pz;
  }
  return { x: x1, z: z1, y, engellendi: false };
}

export function navBilgi(nav) {
  if (!nav) return null;
  let ucgen = 0;
  for (const y of nav.surfaces ?? []) ucgen += y.tris.length / 3;
  return {
    blocker: nav.blockers.length, hucre: nav.izgara.size,
    yuzey: (nav.surfaces ?? []).length, ucgen,
    /* nav.bin'de OLMAYAN, yukleme aninda turetilen duvarlar (bkz. "W5").
       Uretim dosyalari isaretli oldugu icin bu sayi artik 0 olmali. */
    turevDuvar: nav.turevDuvar ?? 0,
    dosyaBlocker: nav.blockers.length - (nav.turevDuvar ?? 0),
    /* nav.bin ofset 6: 0 = duvarlar dosyada YOK, 1 = W5 duvarlari GOMULU. */
    dosyaTurevSurum: nav.dosyaTurevSurum ?? 0,
  };
}
