#!/usr/bin/env node
/**
 * gen_statik_carpisma.mjs - EKSIK STATIK CARPISMA KENARLARINI URETIR
 *
 * ====================================================================
 * !!! BU KAYNAK OLCULDU VE SECILMEDI - --uygula KOSMAYIN (2026-09-05) !!!
 *
 * Iki aday kaynak YAN YANA olculdu (ucu de nav.js/terrain.js'in GERCEK
 * kodu ile, uc ayri nav.bin uzerinde):
 *   (a) W5  = nav.bin yuzey aglarinin SINIR kenarlari  -> nav.js
 *   (b) BMS = orijinal Silkroad outline kenarlari      -> BU BETIK
 *
 *   olcut (5 canli bolge)                     (a) W5        (b) BMS
 *   uretilen duvar                            +123.209      +24.025
 *   kullanici yuruyusu 1 GOMULME 1.68 ->      0.00          1.92  (KOTULESTI)
 *   kullanici yuruyusu 2 GOMULME 2.52 ->      0.00          2.52  (DEGISMEDI)
 *   kapanan kritik nokta (NPC/dogus/tp/yuva)  0             0
 *   kapanan rastgele acik nokta (15.000'de)   19            14
 *   TUZAK artisi (engelli + kacis yok)        0             +2 (donwhang, europe)
 *   izgara hucresi artisi (RAM vekili)        +8.165        +14.431 (DAHA COK)
 *   *_deprecated iki bolge                    calisiyor     REDDEDILIYOR (%0.1-0.2)
 *
 * (b) daha AZ blocker uretmesine ragmen DAHA COK izgara hucresi dolduruyor
 * (kenarlari uzun), sikayetin kendisini COZMUYOR ve tuzak sayisini
 * artiriyor. Bu yuzden (a) secildi ve nav.bin'e (a) gomuldu
 * (gen_navbin_duvar.mjs; nav.bin ofset 6 = 1).
 *
 * BU BETIGI SIMDI --uygula ILE KOSMAK: (a)'nin duvarlarinin USTUNE ikinci
 * bir kume yazar. gen_navbin_duvar.mjs bunu fark edip DURUR ("isaret=1 ama
 * kuyruk eslesmiyor") - yani zincir kilitli, ama yine de kosmayin.
 * Kosmak isterseniz once nav.bin'leri
 * YEDEK/navbin-oncesi-2026-09-05/zones/ altindan geri yukleyin.
 *
 * Betik ARASTIRMA DEGERI icin duruyor: kuru kosumu (varsayilan) orijinal
 * .nvm/.BMS verisiyle karsilastirma raporu uretir, hicbir dosyaya yazmaz.
 * ====================================================================
 *
 * SORUN (kullanici sikayeti): "duz gidince objenin icine giriyorum", karakter
 * tas platforma bel hizasina kadar gomuluyor ve "Buradan cikamiyor musun?"
 * kurtarma penceresi aciliyor (orn. jangan 9587,1593 / 9588,1587 / 9586,1547).
 *
 * KOK NEDEN (arastirma): nav.bin YUZEY aglarini (yurunebilir zemin: teras,
 * merdiven, platform) tasiyor ama o yuzeylerin DIK YUZLERI icin her zaman
 * blocker uretilmemis. Orijinal Silkroad istemcisinde o kenarlar duvardir
 * (BMS NavMeshObj outline kenari, dstCell = 0xFFFF).
 *
 * KAYNAK (arastirma recetesi, kalinti < 0.001 birim ile dogrulanmis):
 *   Data/navmesh/nv_<zSec><xSec>.nvm  -> nesne ornekleri (assetId, konum, yaw)
 *   Data/navmesh/object.ifo           -> assetId -> res\...\*.bsr
 *   *.bsr icinde                      -> prim\mesh\...*.bms yollari
 *   *.BMS NavMeshObj                  -> NavVertices / NavCells / NavOutlineEdges
 * Donusum:
 *   dunyaX = ((xSec-135)*1920 + nesneX + vx*cos(yaw) + vz*sin(yaw)) * 0.15
 *   dunyaZ = ((zSec-92)*1920 + nesneZ - vx*sin(yaw) + vz*cos(yaw)) * 0.15
 *   dunyaY = (nesneY + vy) * 0.15
 *
 * KAPI/GECIT KORUMASI - DORT KADEMELI SUZGEC (bir gecidi yanlislikla
 * kapatmamak icin; her kademe ayri ayri sayilir ve raporlanir):
 *   1) ADAY SECIMI
 *        outline kenari: yalniz dstCell == 0xFFFF (gercek dis hat)
 *        inline  kenari: yalniz EdgeFlag Blocked (BlockSrc2Dst|BlockDst2Src
 *                        = 3) olanlar - teras kademeleri / bina ic duvarlari.
 *                        Bayraksiz ya da TEK YONLU inline kenarlar HUCRE
 *                        GECISIDIR, dokunulmaz (jangan'da 20.668 kenar).
 *   2) EdgeFlag Underpass(16) / Entrance(32) -> gecirgen birakilir.
 *   3) GEOMETRIK GUVENLIK: kenarin DIS tarafindaki zemin (dis yon KAYNAK
 *      HUCRE agirlik merkezinden turetilir) kenar y'sinden <= 0.75
 *      (istemcinin bas boslugu) asagidaysa bu bir BASAMAK / RAMPA / KAPI
 *      ESIGIDIR -> blocker URETILMEZ.
 *      (Iki yanin YUKSEGINI almak YANLISTI: bina/teras zemini kenarla es
 *       yukseklikte oldugu icin gercek duvarlarin cogu 'gecit' sanildi.)
 *   4) NOKTA KORUMASI: aday duvar, sunucu verisindeki bir NPC / dogus /
 *      teleport / mob yuvasi noktasini (oyuncu yaricapi payiyla) icine
 *      aliyorsa URETILMEZ.
 *
 * BOLGE KAPISI: nvm nesne ornekleri ile statics.json arasindaki eslesme
 * orani %25'in altindaysa bolge SRO izgarasina oturmuyordur (deprecated
 * bolgelerde %0.1) ve uretim REDDEDILIR.
 *
 * IDEMPOTENT: uretilen blocker kendi kenarini "korunuyor" hale getirdigi icin
 * ayni kaynak uzerinde ikinci kosum 0 yeni blocker verir. `--idempotens`
 * bunu bellekte (dosyaya dokunmadan) olcer.
 *
 * VARSAYILAN KURU KOSUMDUR - hicbir dosyaya yazmaz. Yazmak icin acikca
 * `--uygula` gerekir; o zaman once YEDEK/carpisma-oncesi altina tarihli yedek
 * alinir, sonra nav.bin yeniden yazilir (+ .gz/.br kardesleri).
 *
 * KULLANIM
 *   --sro=<yol>  orijinal Silkroad istemcisinin koku (icinde Data/navmesh,
 *                Data/prim/mesh olan dizin). Verilmezse SRO_KOK varsayilani
 *                kullanilir; o dizin yoksa betik okuma hatasi verir.
 *   node gen_statik_carpisma.mjs                          # tum bolgeler, kuru
 *   node gen_statik_carpisma.mjs --bolge=jangan_province
 *   node gen_statik_carpisma.mjs --bolge=jangan_province --idempotens
 *   node gen_statik_carpisma.mjs --bolge=jangan_province --deneme=<dizin>
 *        (yamali nav.bin'i SADECE o dizine yazar - dogrulama icin, uretim
 *         verisine dokunmaz; dogrula_carpisma.mjs bunu kullanir)
 *   node gen_statik_carpisma.mjs --bolge=jangan_province --uygula
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const BURASI = path.dirname(fileURLToPath(import.meta.url));
const ISTEMCI = path.join(BURASI, '..', 'client');
const BOLGELER = path.join(ISTEMCI, 'assets', 'zones');

/* ---------------- ayarlar ---------------- */
const A = new Map();
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  if (m) A.set(m[1], m[2] ?? '1');
}
const SRO_KOK = A.get('sro') || './sro-data';
const OLCEK = 0.15;          // SRO birimi -> referans oyun birimi
const BOLGE_U = 1920;        // bir SRO bolgesi (region) kenar uzunlugu, SRO birimi
const XSEC0 = 135, ZSEC0 = 92;
const BAS_BOSLUGU = 0.75;    // istemcinin u9e'si: bu kadar cikilabilir (basamak)
const DIS_MESAFE = 0.6;      // kenarin ne kadar disina bakiyoruz
const KORUMA_R = 0.4;        // mevcut blocker "bu kenari zaten kapatiyor" yaricapi
const DUVAR_KALINLIK = 0.15; // nav.bin'in kendi duvar kalinligi standardi (hx)
const ESLEME_ESIGI = 25;     // bolge-SRO izgara eslesme alt siniri (%)
const DUVAR_YUKSEK = 2.6;    // yMax = kenarY + bu (nav.bin'deki tipik y-bandi boyu)
const MAGIC_NAV = 1447972173;
const MAGIC_HGT = 1179143501;
const BLOCKER_BOYUT = 40;

/* ---------------- kucuk yardimcilar ---------------- */
const yuvarla = (v, n) => Math.round(v * 10 ** n) / 10 ** n;
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');

/* ---------------- nav.bin ---------------- */
function navOku(dosya) {
  const buf = fs.readFileSync(dosya);
  if (buf.readUInt32LE(0) !== MAGIC_NAV) throw new Error('nav.bin sihirli sayi yanlis: ' + dosya);
  const nb = buf.readUInt32LE(8), ns = buf.readUInt32LE(12);
  const blockers = [];
  let o = 16;
  for (let i = 0; i < nb; i++) {
    const x = buf.readFloatLE(o), z = buf.readFloatLE(o + 4), rotY = buf.readFloatLE(o + 8);
    const kind = buf.readUInt8(o + 12), bayrak = buf.readUInt8(o + 13);
    const hx = buf.readFloatLE(o + 16), hz = buf.readFloatLE(o + 20);
    const ox = buf.readFloatLE(o + 24), oz = buf.readFloatLE(o + 28);
    const co = Math.cos(rotY), si = Math.sin(rotY);
    blockers.push({
      x, z, rotY, daire: kind === 1, hx, hz, ox, oz,
      cx: x + ox * co + oz * si, cz: z - ox * si + oz * co, co, si,
      yMin: (bayrak & 1) ? buf.readFloatLE(o + 32) : undefined,
      yMax: (bayrak & 2) ? buf.readFloatLE(o + 36) : undefined,
    });
    o += BLOCKER_BOYUT;
  }
  const yuzeyBas = o;
  const yuzeyler = [];
  for (let s = 0; s < ns; s++) {
    if (buf.length < o + 8) break;
    const vc = buf.readUInt32LE(o), tc = buf.readUInt32LE(o + 4);
    o += 8;
    const vb = vc * 12, tb = tc * 12;
    if (buf.length < o + vb + tb) break;
    const verts = new Float32Array(vc * 3);
    for (let i = 0; i < verts.length; i++) verts[i] = buf.readFloatLE(o + i * 4);
    const tris = new Uint32Array(tc * 3);
    for (let i = 0; i < tris.length; i++) tris[i] = buf.readUInt32LE(o + vb + i * 4);
    yuzeyler.push({ verts, tris });
    o += vb + tb;
  }
  return { buf, nb, ns, blockers, yuzeyler, yuzeyBas, artan: buf.length - o };
}

/** Mevcut nav.bin'in blocker bloguna yeni kayitlari EKLEYEREK yeni tampon uretir. */
function navYaz(nav, yeniler) {
  const bas = Buffer.alloc(16);
  bas.writeUInt32LE(MAGIC_NAV, 0);
  bas.writeUInt16LE(1, 4);
  bas.writeUInt32LE(nav.nb + yeniler.length, 8);
  bas.writeUInt32LE(nav.ns, 12);
  const ek = Buffer.alloc(yeniler.length * BLOCKER_BOYUT);
  yeniler.forEach((b, i) => {
    const o = i * BLOCKER_BOYUT;
    ek.writeFloatLE(b.x, o); ek.writeFloatLE(b.z, o + 4); ek.writeFloatLE(b.rotY, o + 8);
    ek.writeUInt8(0, o + 12);                 // kind = kutu
    ek.writeUInt8(3, o + 13);                 // bayrak = yMin + yMax var
    ek.writeFloatLE(b.hx, o + 16); ek.writeFloatLE(b.hz, o + 20);
    ek.writeFloatLE(0, o + 24); ek.writeFloatLE(0, o + 28);
    ek.writeFloatLE(b.yMin, o + 32); ek.writeFloatLE(b.yMax, o + 36);
  });
  return Buffer.concat([
    bas,
    nav.buf.subarray(16, 16 + nav.nb * BLOCKER_BOYUT),
    ek,
    nav.buf.subarray(16 + nav.nb * BLOCKER_BOYUT),
  ]);
}

/* ---------------- heights.bin ---------------- */
function heightsOku(dosya) {
  const buf = fs.readFileSync(dosya);
  if (buf.readUInt32LE(0) !== MAGIC_HGT) throw new Error('heights.bin sihirli sayi yanlis');
  const ox = buf.readInt32LE(8), oz = buf.readInt32LE(12);
  const cs = buf.readUInt32LE(16), cols = buf.readUInt32LE(20), rows = buf.readUInt32LE(24);
  const n = (cols + 1) * (rows + 1);
  const h = new Float64Array(n);
  for (let i = 0; i < n; i++) h[i] = buf.readInt32LE(32 + i * 4) * 0.01;
  return { ox, oz, cs, cols, rows, h };
}
function arazi(H, x, z) {
  const fx = Math.min(Math.max((x - H.ox) / H.cs, 0), H.cols);
  const fz = Math.min(Math.max((z - H.oz) / H.cs, 0), H.rows);
  const ci = Math.min(Math.floor(fx), H.cols - 1), ri = Math.min(Math.floor(fz), H.rows - 1);
  const p = fx - ci, m = fz - ri, W = H.cols + 1;
  const g = H.h[ri * W + ci], a = H.h[ri * W + ci + 1];
  const v = H.h[(ri + 1) * W + ci], y = H.h[(ri + 1) * W + ci + 1];
  return (p + m <= 1) ? (g + (a - g) * p + (v - g) * m) : (y + (v - y) * (1 - p) + (a - y) * (1 - m));
}

/* ---------------- yuzey ucgenleri (kenarin disindaki zemin icin) ---------------- */
const UCGEN_HUCRE = 16;
function ucgenlerKur(nav) {
  const tri = [];
  for (const { verts: v, tris: t } of nav.yuzeyler) {
    for (let i = 0; i < t.length; i += 3) {
      const a = t[i] * 3, b = t[i + 1] * 3, c = t[i + 2] * 3;
      const ax = v[a], ay = v[a + 1], az = v[a + 2];
      const bx = v[b], by = v[b + 1], bz = v[b + 2];
      const cx = v[c], cy = v[c + 1], cz = v[c + 2];
      const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(det) < 1e-9) continue;
      const pa = ((by - cy) * (az - cz) - (ay - cy) * (bz - cz)) / -det;
      const pb = ((by - cy) * (ax - cx) - (ay - cy) * (bx - cx)) / det;
      tri.push([ax, az, bx, bz, cx, cz, pa, pb, ay - pa * ax - pb * az]);
    }
  }
  const g = new Map();
  tri.forEach((t, i) => {
    const x0 = Math.floor(Math.min(t[0], t[2], t[4]) / UCGEN_HUCRE), x1 = Math.floor(Math.max(t[0], t[2], t[4]) / UCGEN_HUCRE);
    const z0 = Math.floor(Math.min(t[1], t[3], t[5]) / UCGEN_HUCRE), z1 = Math.floor(Math.max(t[1], t[3], t[5]) / UCGEN_HUCRE);
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
      const k = cx + ',' + cz; let l = g.get(k); if (!l) g.set(k, l = []); l.push(i);
    }
  });
  return { tri, g };
}
/** (x,z) noktasinda `sinir`in ALTINDA kalan EN YUKSEK zemin (arazi + yuzeyler). */
function zeminAlt(U, H, x, z, sinir) {
  let en = arazi(H, x, z);
  if (en > sinir) en = null;
  const l = U.g.get(Math.floor(x / UCGEN_HUCRE) + ',' + Math.floor(z / UCGEN_HUCRE));
  if (l) for (const i of l) {
    const [ax, az, bx, bz, cx, cz, pa, pb, pc] = U.tri[i];
    const s1 = (bx - ax) * (z - az) - (bz - az) * (x - ax);
    const s2 = (cx - bx) * (z - bz) - (cz - bz) * (x - bx);
    const s3 = (ax - cx) * (z - cz) - (az - cz) * (x - cx);
    if ((s1 < 0 || s2 < 0 || s3 < 0) && (s1 > 0 || s2 > 0 || s3 > 0)) continue;
    const y = pa * x + pb * z + pc;
    if (y <= sinir && (en === null || y > en)) en = y;
  }
  return en;
}

/* ---------------- blocker izgarasi (koruma testi) ---------------- */
const BLOK_HUCRE = 8;
function blokIzgara(blockers) {
  const aabb = blockers.map((b) => {
    if (b.daire) return [b.cx - b.hx, b.cx + b.hx, b.cz - b.hx, b.cz + b.hx];
    const ax = Math.abs(b.hx * b.co) + Math.abs(b.hz * b.si);
    const az = Math.abs(b.hx * b.si) + Math.abs(b.hz * b.co);
    return [b.cx - ax, b.cx + ax, b.cz - az, b.cz + az];
  });
  const g = new Map();
  aabb.forEach((a, i) => {
    for (let cx = Math.floor(a[0] / BLOK_HUCRE); cx <= Math.floor(a[1] / BLOK_HUCRE); cx++)
      for (let cz = Math.floor(a[2] / BLOK_HUCRE); cz <= Math.floor(a[3] / BLOK_HUCRE); cz++) {
        const k = cx + ',' + cz; let l = g.get(k); if (!l) g.set(k, l = []); l.push(i);
      }
  });
  return {
    aabb, g,
    korunuyor(x, z, r = KORUMA_R) {
      for (let cx = Math.floor((x - r) / BLOK_HUCRE); cx <= Math.floor((x + r) / BLOK_HUCRE); cx++)
        for (let cz = Math.floor((z - r) / BLOK_HUCRE); cz <= Math.floor((z + r) / BLOK_HUCRE); cz++) {
          const l = g.get(cx + ',' + cz); if (!l) continue;
          for (const i of l) {
            const a = aabb[i];
            if (a[0] - r <= x && x <= a[1] + r && a[2] - r <= z && z <= a[3] + r) return true;
          }
        }
      return false;
    },
    ekle(b) {
      const ax = Math.abs(b.hx * Math.cos(b.rotY)) + Math.abs(b.hz * Math.sin(b.rotY));
      const az = Math.abs(b.hx * Math.sin(b.rotY)) + Math.abs(b.hz * Math.cos(b.rotY));
      const a = [b.x - ax, b.x + ax, b.z - az, b.z + az];
      const i = aabb.push(a) - 1;
      for (let cx = Math.floor(a[0] / BLOK_HUCRE); cx <= Math.floor(a[1] / BLOK_HUCRE); cx++)
        for (let cz = Math.floor(a[2] / BLOK_HUCRE); cz <= Math.floor(a[3] / BLOK_HUCRE); cz++) {
          const k = cx + ',' + cz; let l = g.get(k); if (!l) g.set(k, l = []); l.push(i);
        }
    },
  };
}

/* ---------------- orijinal istemci verisi ---------------- */
function nvmOku(dosya) {
  const b = fs.readFileSync(dosya);
  if (b.subarray(0, 12).toString('latin1') !== 'JMXVNVM 1000') throw new Error('nvm imza');
  let o = 12;
  const sayi = b.readUInt16LE(o); o += 2;
  const objs = [];
  for (let i = 0; i < sayi; i++) {
    const assetId = b.readUInt32LE(o);
    const x = b.readFloatLE(o + 4), y = b.readFloatLE(o + 8), z = b.readFloatLE(o + 12);
    const yaw = b.readFloatLE(o + 18);
    const rid = b.readUInt16LE(o + 28);
    o += 30;
    const lec = b.readUInt16LE(o); o += 2 + lec * 6;
    objs.push({ assetId, x, y, z, yaw, rid });
  }
  return objs;
}
let _objIfo = null;
function objectIfo() {
  if (_objIfo) return _objIfo;
  const satir = fs.readFileSync(path.join(SRO_KOK, 'Data/navmesh/object.ifo'), 'latin1').split('\n');
  const m = new Map();
  for (const ln of satir.slice(2)) {
    const s = ln.trim(); if (!s) continue;
    // bicim:  <idx> <bayrak> "res\...\xxx.bsr"
    const g = /^(\d+)\s+(\S+)\s+(.*)$/.exec(s); if (!g) continue;
    const yol = g[3].trim().replace(/^"|"$/g, '');
    if (yol) m.set(Number(g[1]), yol);
  }
  return (_objIfo = m);
}
const _bsr = new Map();
function bsrMeshler(rel) {
  const k = rel.toLowerCase();
  if (_bsr.has(k)) return _bsr.get(k);
  const p = path.join(SRO_KOK, 'Data', rel.replace(/\\/g, '/'));
  let out = [];
  try {
    const t = fs.readFileSync(p, 'latin1');
    out = [...new Set(t.match(/prim\\mesh\\[^\0"]+?\.bms/gi) || [])];
  } catch { out = []; }
  _bsr.set(k, out);
  return out;
}
const _bms = new Map();
function bmsNav(rel) {
  const k = rel.toLowerCase();
  if (_bms.has(k)) return _bms.get(k);
  let d = null;
  try {
    const b = fs.readFileSync(path.join(SRO_KOK, 'Data', rel.replace(/\\/g, '/')));
    if (b.subarray(0, 8).toString('latin1') === 'JMXVBMS ') {
      const navOff = b.readUInt32LE(12 + 7 * 4);
      const navFlag = b.readUInt32LE(12 + 11 * 4);
      if (navOff > 0 && navOff < b.length) {
        let o = navOff;
        const vc = b.readUInt32LE(o); o += 4;
        const verts = new Float32Array(vc * 3);
        for (let i = 0; i < vc; i++) {
          verts[i * 3] = b.readFloatLE(o); verts[i * 3 + 1] = b.readFloatLE(o + 4); verts[i * 3 + 2] = b.readFloatLE(o + 8);
          o += 13;   // 12 bayt konum + 1 bayt bisector
        }
        const cc = b.readUInt32LE(o); o += 4;
        const cstep = 8 + ((navFlag & 2) ? 1 : 0);
        const cells = new Uint16Array(cc * 3);
        for (let i = 0; i < cc; i++) {
          cells[i * 3] = b.readUInt16LE(o); cells[i * 3 + 1] = b.readUInt16LE(o + 2); cells[i * 3 + 2] = b.readUInt16LE(o + 4);
          o += cstep;
        }
        const oc = b.readUInt32LE(o); o += 4;
        const estep = 9 + ((navFlag & 1) ? 1 : 0);
        const outline = [];
        for (let i = 0; i < oc; i++) {
          // sv, dv, dstCell, flag, tur(0 = outline), srcCell
          outline.push([b.readUInt16LE(o), b.readUInt16LE(o + 2), b.readUInt16LE(o + 6), b.readUInt8(o + 8), 0, b.readUInt16LE(o + 4)]);
          o += estep;
        }
        /* INLINE kenarlar: hucreler ARASI baglantilardir; cogu GECITTIR ve
           asla kapatilmaz. AMA EdgeFlag'i Blocked (BlockSrc2Dst|BlockDst2Src
           = 3) olanlar retail'de IKI YONDE de duvardir - teras kademeleri ve
           bina ic duvarlari bunlardir. Yalnizca tam 3 olanlar aday yapilir;
           tek yonlu (1 veya 2) olanlar dokunulmadan birakilir. */
        const ic = b.readUInt32LE(o); o += 4;
        const inline = [];
        for (let i = 0; i < ic; i++) {
          // sv, dv, dstCell, flag, tur(1 = inline), srcCell
          inline.push([b.readUInt16LE(o), b.readUInt16LE(o + 2), b.readUInt16LE(o + 6), b.readUInt8(o + 8), 1, b.readUInt16LE(o + 4)]);
          o += estep;
        }
        d = { verts, cells, kenarlar: outline.concat(inline) };
      }
    }
  } catch { d = null; }
  _bms.set(k, d);
  return d;
}

/* ---------------- korunacak noktalar (asla kapatilmaz) ----------------
   Sunucunun KENDI verisinden okunur (salt okuma): NPC'ler, dogus/respawn,
   teleport kapilari ve varis noktalari, mob yuva merkezleri. Bir aday duvar
   bunlardan birini (oyuncu yaricapi kadar payla) icine aliyorsa URETILMEZ -
   yoksa NPC'nin ya da kapinin onu kapanir. */
function korumaNoktalari(zone) {
  const oku = (f) => { try { return JSON.parse(fs.readFileSync(path.join(BURASI, 'data', f), 'utf8')); } catch { return null; } };
  const P = [];
  const shops = oku('npcshops.json') || {};
  const zd = (shops.zones || {})[zone];
  if (zd) {
    for (const n of zd.npcs || []) P.push([n.x, n.z]);
    if (zd.playerSpawn) P.push([zd.playerSpawn.x, zd.playerSpawn.z]);
    if (zd.respawnPoint) P.push([zd.respawnPoint.x, zd.respawnPoint.z]);
  }
  const tele = oku('teleporters.json') || { zones: {} };
  for (const t of (tele.zones || {})[zone] || []) {
    P.push([t.x, t.z]);
    for (const d of t.destinations || []) if (d.toZone === zone && d.toPos) P.push([d.toPos.x, d.toPos.z]);
  }
  const sp = oku('spawns.json') || {};
  for (const s of sp[zone] || []) P.push([s.x, s.z]);
  const g = new Map();
  P.forEach(([x, z], i) => {
    const k = Math.floor(x / 8) + ',' + Math.floor(z / 8);
    let l = g.get(k); if (!l) g.set(k, l = []); l.push(i);
  });
  return {
    sayi: P.length,
    /** blocker kutusu (pay dahil) korunacak bir noktayi iceriyor mu? */
    carpiyor(b, pay = 0.6) {
      const co = Math.cos(b.rotY), si = Math.sin(b.rotY);
      const rx = b.hx + pay, rz = b.hz + pay;
      const yari = Math.max(rx, rz);
      for (let cx = Math.floor((b.x - yari) / 8); cx <= Math.floor((b.x + yari) / 8); cx++)
        for (let cz = Math.floor((b.z - yari) / 8); cz <= Math.floor((b.z + yari) / 8); cz++)
          for (const i of g.get(cx + ',' + cz) || []) {
            const dx = P[i][0] - b.x, dz = P[i][1] - b.z;
            const lx = dx * co - dz * si, lz = dx * si + dz * co;
            if (Math.abs(lx) <= rx && Math.abs(lz) <= rz) return true;
          }
      return false;
    },
  };
}

/* ---------------- bir bolgeyi isle ---------------- */
function bolgeUret(zone, { ayrinti = false } = {}) {
  const dizin = path.join(BOLGELER, zone);
  const nav = navOku(path.join(dizin, 'nav.bin'));
  const H = heightsOku(path.join(dizin, 'heights.bin'));
  const U = ucgenlerKur(nav);
  const IZ = blokIzgara(nav.blockers);
  const statics = JSON.parse(fs.readFileSync(path.join(dizin, 'statics.json'), 'utf8'));

  const minX = H.ox, maxX = H.ox + H.cols * H.cs;
  const minZ = H.oz, maxZ = H.oz + H.rows * H.cs;
  const BOLGE_W = BOLGE_U * OLCEK;    // 288 dunya birimi
  const xs0 = Math.floor(minX / BOLGE_W) + XSEC0, xs1 = Math.floor(maxX / BOLGE_W) + XSEC0;
  const zs0 = Math.floor(minZ / BOLGE_W) + ZSEC0, zs1 = Math.floor(maxZ / BOLGE_W) + ZSEC0;

  // statics.json ile hizli eslesme kontrolu (bu bolge SRO izgarasina oturuyor mu?)
  const stIz = new Map();
  for (const s of statics) {
    const k = Math.floor(s.x / 4) + ',' + Math.floor(s.z / 4);
    let l = stIz.get(k); if (!l) stIz.set(k, l = []); l.push(s);
  }
  const yakinStatik = (x, z) => {
    for (let cx = Math.floor((x - 4) / 4); cx <= Math.floor((x + 4) / 4); cx++)
      for (let cz = Math.floor((z - 4) / 4); cz <= Math.floor((z + 4) / 4); cz++)
        for (const s of stIz.get(cx + ',' + cz) || [])
          if (Math.hypot(s.x - x, s.z - z) < 1.0) return true;
    return false;
  };

  const oi = objectIfo();
  const KORUMA = korumaNoktalari(zone);
  const R = {
    bolge: zone, blockerOnce: nav.nb, yuzey: nav.ns, ucgen: U.tri.length,
    korumaNoktasi: KORUMA.sayi,
    sroBolge: 0, nesne: 0, eslesenNesne: 0,
    outlineKenar: 0, inlineDuvar: 0, inlineGecit: 0, bolgeDisi: 0,
    elenenBayrak: 0, elenenGecit: 0, zatenKorunan: 0, kisa: 0, korunanNokta: 0, disBosluk: 0,
    yeni: 0, yeniUzunlukU: 0, etkilenenNesne: 0, esleme: 0, ornek: [],
  };
  const yeniler = [];
  const gorulen = new Set();

  for (let zsec = zs0; zsec <= zs1; zsec++) {
    for (let xsec = xs0; xsec <= xs1; xsec++) {
      const rid = (zsec << 8) | xsec;
      const p = path.join(SRO_KOK, 'Data/navmesh', 'nv_' + rid.toString(16).padStart(4, '0') + '.nvm');
      if (!fs.existsSync(p)) continue;
      let objs; try { objs = nvmOku(p); } catch { continue; }
      R.sroBolge++;
      const bx = (xsec - XSEC0) * BOLGE_U, bz = (zsec - ZSEC0) * BOLGE_U;
      for (const o of objs) {
        if (o.rid !== rid) continue;         // yalnizca bu bolgenin SAHIBI oldugu ornekler
        R.nesne++;
        const wx = bx + o.x, wz = bz + o.z, wy = o.y;
        if (yakinStatik(wx * OLCEK, wz * OLCEK)) R.eslesenNesne++;
        const rel = oi.get(o.assetId); if (!rel) continue;
        const c = Math.cos(o.yaw), s = Math.sin(o.yaw);
        let bunda = 0;
        for (const mrel of bsrMeshler(rel)) {
          const d = bmsNav(mrel); if (!d || !d.kenarlar.length) continue;
          for (const [sv, dv, dc, fl, tur, sc] of d.kenarlar) {
            /* 1) ADAY SECIMI
                  outline: yalniz gercek dis hat (komsu hucre yok, dst=0xFFFF)
                  inline : yalniz IKI YONDE de kapali olanlar (Blocked = 3);
                           tek yonlu (1/2) ve bayraksiz inline kenarlar
                           HUCRE GECISIDIR, dokunulmaz. */
            if (tur === 0) { if (dc !== 0xFFFF) continue; R.outlineKenar++; }
            else { if ((fl & 3) !== 3) { R.inlineGecit++; continue; } R.inlineDuvar++; }
            // 2) EdgeFlag: Underpass(16) / Entrance(32) gecirgen kalir
            if (fl & 48) { R.elenenBayrak++; continue; }
            const a0 = sv * 3, b0 = dv * 3;
            const ax = (wx + d.verts[a0] * c + d.verts[a0 + 2] * s) * OLCEK;
            const az = (wz - d.verts[a0] * s + d.verts[a0 + 2] * c) * OLCEK;
            const ay = (wy + d.verts[a0 + 1]) * OLCEK;
            const bxw = (wx + d.verts[b0] * c + d.verts[b0 + 2] * s) * OLCEK;
            const bzw = (wz - d.verts[b0] * s + d.verts[b0 + 2] * c) * OLCEK;
            const byw = (wy + d.verts[b0 + 1]) * OLCEK;
            const mx = (ax + bxw) / 2, mz = (az + bzw) / 2, my = (ay + byw) / 2;
            if (mx < minX || mx > maxX || mz < minZ || mz > maxZ) { R.bolgeDisi++; continue; }
            const ex = bxw - ax, ez = bzw - az;
            const L = Math.hypot(ex, ez);
            if (L < 0.05) { R.kisa++; continue; }
            /* 3) GEOMETRIK GUVENLIK - kenarin DISINDAKI zemin.
               "Dis" yon KAYNAK HUCREden turetilir: kenar orta noktasi eksi
               hucre agirlik merkezi. (Iki yanin YUKSEGINI almak yanlisti:
               teras/bina zemini kenarla ES YUKSEKLIKTE oldugu icin gercek
               duvarlar 'gecit' sanilip atlaniyordu.)
               Dis zemin kenar y'sinden <= 0.75 asagidaysa BASAMAK/RAMPA/KAPI
               ESIGIDIR - blocker URETILMEZ. */
            let nx = -ez / L, nz = ex / L;
            const cI = sc * 3;
            if (d.cells && cI + 2 < d.cells.length) {
              let gx = 0, gz = 0;
              for (let q = 0; q < 3; q++) {
                const vi = d.cells[cI + q] * 3;
                gx += (wx + d.verts[vi] * c + d.verts[vi + 2] * s) * OLCEK;
                gz += (wz - d.verts[vi] * s + d.verts[vi + 2] * c) * OLCEK;
              }
              gx /= 3; gz /= 3;
              if ((mx - gx) * nx + (mz - gz) * nz < 0) { nx = -nx; nz = -nz; }
            }
            const dis = zeminAlt(U, H, mx + nx * DIS_MESAFE, mz + nz * DIS_MESAFE, my - 1e-6);
            if (dis === null) { R.disBosluk++; }
            else if (my - dis <= BAS_BOSLUGU) { R.elenenGecit++; continue; }
            // zaten kapali mi? (idempotens burada saglaniyor)
            if (IZ.korunuyor(mx, mz)) { R.zatenKorunan++; continue; }
            const anahtar = Math.round(mx * 20) + '|' + Math.round(mz * 20) + '|' + Math.round(Math.atan2(ez, ex) * 40);
            if (gorulen.has(anahtar)) continue;
            gorulen.add(anahtar);
            const blk = {
              x: yuvarla(mx, 2), z: yuvarla(mz, 2),
              /* rotY: nav.js/istemci yerel ekseni  l = R(rotY)*d  oldugundan
                 yerel Z ekseninin dunyadaki yonu (sin rotY, cos rotY)'dir.
                 Duvarin UZUN kenari (hz) kenar dogrultusunda olmali:
                 sin rotY = ex/L , cos rotY = ez/L  ->  rotY = atan2(ex, ez). */
              rotY: yuvarla(Math.atan2(ex, ez), 4),
              hx: DUVAR_KALINLIK, hz: yuvarla(L / 2, 2),
              yMin: yuvarla((dis === null ? my - 3 : Math.min(dis, my)) - 0.3, 2),
              yMax: yuvarla(my + DUVAR_YUKSEK, 2),
            };
            if (KORUMA.carpiyor(blk)) { R.korunanNokta++; continue; }
            yeniler.push(blk);
            IZ.ekle(blk);                     // ayni kosumda tekrar uretme
            R.yeni++; R.yeniUzunlukU += L; bunda++;
            if (ayrinti && R.ornek.length < 10) {
              R.ornek.push({ x: blk.x, z: blk.z, y: yuvarla(my, 2), dusus: dis === null ? 'bosluk' : yuvarla(my - dis, 2), uzunluk: yuvarla(L, 2), mesh: path.basename(mrel) });
            }
          }
        }
        if (bunda > 0) R.etkilenenNesne++;
      }
    }
  }
  R.esleme = R.nesne ? yuvarla(100 * R.eslesenNesne / R.nesne, 1) : 0;
  R.etkilenenYuzde = R.nesne ? yuvarla(100 * R.etkilenenNesne / R.nesne, 1) : 0;
  /* GUVENLIK KAPISI: bolge SRO izgarasina oturmuyorsa uretilen her sey YANLIS
     YERDEDIR. Olcut: nvm nesne orneklerinin kacinin 1 birim yakininda gercek
     bir statik var. Canli bolgelerde %53-82; *_deprecated bolgelerde %0.1-0.2
     (bunlar baska bir koordinat sisteminde) -> URETIM REDDEDILIR. */
  if (R.esleme < ESLEME_ESIGI && !A.has('zorla')) {
    R.reddedildi = `esleme %${R.esleme} < %${ESLEME_ESIGI} - bolge SRO izgarasina oturmuyor, uretim yapilmadi (--zorla ile gecilebilir)`;
    R.yeniAtildi = R.yeni; R.yeni = 0; R.yeniUzunlukU = 0; R.etkilenenNesne = 0; R.etkilenenYuzde = 0;
    yeniler.length = 0;
  }
  R.yeniUzunlukU = yuvarla(R.yeniUzunlukU, 1);
  R.blockerSonra = R.blockerOnce + R.yeni;
  // deterministik cikti: ayni kaynak -> ayni bayt dizisi
  yeniler.sort((p, q) => (p.x - q.x) || (p.z - q.z) || (p.rotY - q.rotY) || (p.hz - q.hz));
  return { rapor: R, yeniler, nav, dizin };
}

/* ---------------- yazma ---------------- */
function yedekAl(dizin, zone) {
  const g = new Date();
  const damga = `${g.getFullYear()}-${String(g.getMonth() + 1).padStart(2, '0')}-${String(g.getDate()).padStart(2, '0')}`;
  const hedef = path.join(BURASI, '..', '..', 'YEDEK', 'carpisma-oncesi', damga, zone);
  fs.mkdirSync(hedef, { recursive: true });
  for (const f of ['nav.bin', 'nav.bin.gz', 'nav.bin.br', 'statics.json']) {
    const kaynak = path.join(dizin, f);
    if (fs.existsSync(kaynak) && !fs.existsSync(path.join(hedef, f))) fs.copyFileSync(kaynak, path.join(hedef, f));
  }
  return hedef;
}

function main() {
  const hepsi = fs.readdirSync(BOLGELER).filter((z) => fs.existsSync(path.join(BOLGELER, z, 'nav.bin')));
  const secim = A.get('bolge') && A.get('bolge') !== 'hepsi' ? A.get('bolge').split(',') : hepsi;
  const deneme = A.get('deneme');
  const uygula = A.has('uygula');
  const raporlar = [];

  for (const zone of secim) {
    if (!hepsi.includes(zone)) { console.error('bilinmeyen bolge:', zone); continue; }
    const t0 = Date.now();
    const { rapor, yeniler, nav, dizin } = bolgeUret(zone, { ayrinti: true });
    rapor.sureMs = Date.now() - t0;

    if (A.has('idempotens')) {
      // yamali nav'i BELLEKTE kurup ikinci kosum yap: 0 yeni bekleniyor
      const tampon = navYaz(nav, yeniler);
      const gecici = path.join(process.env.TEMP || '.', 'jw_idem_' + zone);
      fs.mkdirSync(path.join(gecici, 'assets', 'zones', zone), { recursive: true });
      for (const f of ['heights.bin', 'statics.json']) fs.copyFileSync(path.join(dizin, f), path.join(gecici, 'assets', 'zones', zone, f));
      fs.writeFileSync(path.join(gecici, 'assets', 'zones', zone, 'nav.bin'), tampon);
      const eskiB = BOLGELER;
      rapor.idempotens = ikinciKosum(gecici, zone);
      void eskiB;
    }

    if (deneme) {
      const hedef = path.join(deneme, 'assets', 'zones', zone);
      fs.mkdirSync(hedef, { recursive: true });
      for (const f of ['heights.bin', 'statics.json', 'env.bin']) {
        const k = path.join(dizin, f); if (fs.existsSync(k)) fs.copyFileSync(k, path.join(hedef, f));
      }
      fs.writeFileSync(path.join(hedef, 'nav.bin'), navYaz(nav, yeniler));
      rapor.denemeYazildi = path.join(hedef, 'nav.bin');
    }

    if (uygula && yeniler.length) {
      rapor.yedek = yedekAl(dizin, zone);
      const tampon = navYaz(nav, yeniler);
      fs.writeFileSync(path.join(dizin, 'nav.bin'), tampon);
      if (fs.existsSync(path.join(dizin, 'nav.bin.gz')))
        fs.writeFileSync(path.join(dizin, 'nav.bin.gz'), zlib.gzipSync(tampon, { level: 9 }));
      if (fs.existsSync(path.join(dizin, 'nav.bin.br')))
        fs.writeFileSync(path.join(dizin, 'nav.bin.br'), zlib.brotliCompressSync(tampon));
      rapor.yeniSha256 = sha256(tampon);
      rapor.yeniBoyut = tampon.length;
      rapor.uyari = 'client/manifests/*.json icindeki sha256+boyut GUNCELLENMELI: ' +
        'node gen_manifest_guncelle.mjs --uygula  (version.json.manifestSha256 dahil).';
    }
    raporlar.push(rapor);
    console.log(
      `${zone.padEnd(24)} sroBolge=${String(rapor.sroBolge).padStart(3)} nesne=${String(rapor.nesne).padStart(5)} esleme=%${rapor.esleme} | ` +
      `outline=${rapor.outlineKenar} inlineDuvar=${rapor.inlineDuvar} inlineGECIT=${rapor.inlineGecit} bayrakGecirgen=${rapor.elenenBayrak} ` +
      `GECIT_KORUNDU=${rapor.elenenGecit} zatenKapali=${rapor.zatenKorunan} korunanNokta=${rapor.korunanNokta} ` +
      `-> YENI=${rapor.yeni} (${rapor.yeniUzunlukU}u) blocker ${rapor.blockerOnce}->${rapor.blockerSonra} etkilenenNesne=${rapor.etkilenenNesne} (%${rapor.etkilenenYuzde})` +
      (rapor.reddedildi ? `
    REDDEDILDI: ${rapor.reddedildi}` : '') +
      (rapor.idempotens !== undefined ? ` | ikinciKosumYeni=${rapor.idempotens}` : '')
    );
  }
  if (A.get('rapor')) fs.writeFileSync(A.get('rapor'), JSON.stringify(raporlar, null, 2));
  if (!uygula && !deneme) console.log('\n[KURU KOSUM] hicbir dosya degistirilmedi. Yazmak icin --uygula.');
}

/** Yamali kopya uzerinde ikinci kosum - kac YENI blocker cikiyor (0 olmali). */
function ikinciKosum(kok, zone) {
  const dizin = path.join(kok, 'assets', 'zones', zone);
  const eski = BOLGELER;
  try {
    // bolgeUret sabit BOLGELER kullaniyor; gecici olarak yolu degistirmek yerine
    // ayni mantigi kucuk bir sarmalayicida tekrarliyoruz.
    const nav = navOku(path.join(dizin, 'nav.bin'));
    const H = heightsOku(path.join(dizin, 'heights.bin'));
    const U = ucgenlerKur(nav);
    const IZ = blokIzgara(nav.blockers);
    const oi = objectIfo();
    const KOR = korumaNoktalari(zone);
    const minX = H.ox, maxX = H.ox + H.cols * H.cs, minZ = H.oz, maxZ = H.oz + H.rows * H.cs;
    const BW = BOLGE_U * OLCEK;
    let yeni = 0;
    for (let zsec = Math.floor(minZ / BW) + ZSEC0; zsec <= Math.floor(maxZ / BW) + ZSEC0; zsec++)
      for (let xsec = Math.floor(minX / BW) + XSEC0; xsec <= Math.floor(maxX / BW) + XSEC0; xsec++) {
        const rid = (zsec << 8) | xsec;
        const p = path.join(SRO_KOK, 'Data/navmesh', 'nv_' + rid.toString(16).padStart(4, '0') + '.nvm');
        if (!fs.existsSync(p)) continue;
        let objs; try { objs = nvmOku(p); } catch { continue; }
        const bx = (xsec - XSEC0) * BOLGE_U, bz = (zsec - ZSEC0) * BOLGE_U;
        for (const o of objs) {
          if (o.rid !== rid) continue;
          const rel = oi.get(o.assetId); if (!rel) continue;
          const wx = bx + o.x, wz = bz + o.z, wy = o.y;
          const c = Math.cos(o.yaw), s = Math.sin(o.yaw);
          for (const mrel of bsrMeshler(rel)) {
            const d = bmsNav(mrel); if (!d || !d.kenarlar.length) continue;
            for (const [sv, dv, dc, fl, tur, sc] of d.kenarlar) {
              if (tur === 0 ? (dc !== 0xFFFF) : ((fl & 3) !== 3)) continue;
              if (fl & 48) continue;
              const a0 = sv * 3, b0 = dv * 3;
              const ax = (wx + d.verts[a0] * c + d.verts[a0 + 2] * s) * OLCEK;
              const az = (wz - d.verts[a0] * s + d.verts[a0 + 2] * c) * OLCEK;
              const ay = (wy + d.verts[a0 + 1]) * OLCEK;
              const bxw = (wx + d.verts[b0] * c + d.verts[b0 + 2] * s) * OLCEK;
              const bzw = (wz - d.verts[b0] * s + d.verts[b0 + 2] * c) * OLCEK;
              const byw = (wy + d.verts[b0 + 1]) * OLCEK;
              const mx = (ax + bxw) / 2, mz = (az + bzw) / 2, my = (ay + byw) / 2;
              if (mx < minX || mx > maxX || mz < minZ || mz > maxZ) continue;
              const ex = bxw - ax, ez = bzw - az, L = Math.hypot(ex, ez);
              if (L < 0.05) continue;
              const nx = -ez / L, nz = ex / L;
              const f1 = zeminAlt(U, H, mx + nx * DIS_MESAFE, mz + nz * DIS_MESAFE, my - 1e-6);
              const f2 = zeminAlt(U, H, mx - nx * DIS_MESAFE, mz - nz * DIS_MESAFE, my - 1e-6);
              const dis = Math.max(f1 ?? -Infinity, f2 ?? -Infinity);
              if (!Number.isFinite(dis) || my - dis <= BAS_BOSLUGU) continue;
              if (IZ.korunuyor(mx, mz)) continue;
              if (KOR.carpiyor({ x: mx, z: mz, rotY: Math.atan2(ex, ez), hx: DUVAR_KALINLIK, hz: L / 2 })) continue;
              yeni++;
            }
          }
        }
      }
    return yeni;
  } finally { void eski; }
}

main();
