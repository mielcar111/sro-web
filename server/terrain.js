/**
 * Arazi yukseklik ornekleyici.
 *
 * Istemcinin heights.bin cozucusunun BIREBIR ayni implementasyonu
 * (bundle'daki decodeHeights / t8 fonksiyonlarindan cikarildi):
 *
 *   ofset 0  uint32  sihirli sayi = 1179143501
 *   ofset 4  uint16  surum        = 1
 *   ofset 8  int32   originX
 *   ofset 12 int32   originZ
 *   ofset 16 uint32  cellSizeU
 *   ofset 20 uint32  cols
 *   ofset 24 uint32  rows
 *   ofset 32 int32[] (cols+1)*(rows+1) yukseklik
 *
 *   dunya Y = int32Yukseklik * 0.01        <- istemcideki `Rq` sabiti
 *
 * Sunucu oyuncuyu y=0'a koyarsa karakter arazinin ALTINDA kalir; kamera
 * zeminin altindan bakar ve dunya bombos gorunur. Dogru y'yi buradan uretiyoruz.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const MAGIC = 1179143501;
const HEADER = 32;
const HEIGHT_SCALE = 0.01;

const cache = new Map();

export function loadHeights(clientDir, zoneId) {
  if (cache.has(zoneId)) return cache.get(zoneId);
  const base = path.join(clientDir, 'assets', 'zones', zoneId);
  let buf = null;
  const plain = path.join(base, 'heights.bin');
  const gz = path.join(base, 'heights.bin.gz');
  try {
    if (fs.existsSync(plain)) buf = fs.readFileSync(plain);
    else if (fs.existsSync(gz)) buf = zlib.gunzipSync(fs.readFileSync(gz));
  } catch { buf = null; }
  if (!buf) { cache.set(zoneId, null); return null; }

  if (buf.length < HEADER || buf.readUInt32LE(0) !== MAGIC) {
    cache.set(zoneId, null);
    return null;
  }
  const version = buf.readUInt16LE(4);
  if (version !== 1) { cache.set(zoneId, null); return null; }

  const originX = buf.readInt32LE(8);
  const originZ = buf.readInt32LE(12);
  const cellSizeU = buf.readUInt32LE(16);
  const cols = buf.readUInt32LE(20);
  const rows = buf.readUInt32LE(24);
  const count = (cols + 1) * (rows + 1);
  if (buf.length !== HEADER + count * 4) { cache.set(zoneId, null); return null; }

  const heights = new Int32Array(count);
  for (let i = 0; i < count; i++) heights[i] = buf.readInt32LE(HEADER + i * 4);

  const zone = { originX, originZ, cellSizeU, cols, rows, heights };
  cache.set(zoneId, zone);
  return zone;
}

/** Tek dugum noktasi - istemcideki t8() ile ayni (kenar sabitlemeli). */
function at(zone, col, row) {
  const c = col < 0 ? 0 : col > zone.cols ? zone.cols : col;
  const r = row < 0 ? 0 : row > zone.rows ? zone.rows : row;
  return zone.heights[r * (zone.cols + 1) + c] * HEIGHT_SCALE;
}

/** Dunya (x,z) -> zemin Y. Eskiden BILINEER harmanlama yapiyordu; artik
 *  istemcinin kendi ornekleyicisine (terrainAt, UCGEN enterpolasyonu)
 *  yonlendiriliyor - asagidaki PARITE notuna bakin. */
export function groundY(zone, x, z) {
  if (!zone) return 0;
  return terrainAt(zone, x, z);
}

/* PARITE DUZELTMESI (2026-09-04, gomulme kosumu) - SAPMA DEGIL, YAKINSAMA.
 *
 * Istemcinin arazi ornekleyicisi TEK bir fonksiyondur: terrainAt (paket
 * `_9e()` icindeki `terrainAt`), ve hucre icinde UCGEN enterpolasyonu yapar
 * (p+m<=1 dalinda alt ucgen, degilse ust ucgen). Bilineer harmanlama
 * istemcide HIC BIR YERDE yok.
 *
 * Bizde groundY() bilineerdi ve server.js sampleY'nin TOHUMUNU (oncekiY)
 * bununla veriyordu:  sampleY(h, idx, x, z, oncekiY ?? groundY(h, x, z))
 * Tohum, sampleY'nin `tavan = oncekiY + 0.75` kapisini belirledigi icin
 * yanlis tohum YANLIS KAT sectiriyordu.
 *
 * OLCUM (jangan sehir kutusu, 2.560.000 ornek - onceki turun 1. maddesi):
 *   ortalama |bilineer - ucgen| = 0.0094 birim
 *   EN BUYUK fark               = 4.577 birim
 *   secilen KAT degisen ornek   = 529 (%0.021), en buyuk sapma 4.03 birim
 *
 * groundY'yi terrainAt'a yonlendirmek bu 529 ornegi istemciyle AYNI kata
 * getirir. Bilineer surum artik hicbir yerde kullanilmiyor; kaynak olarak
 * asagida duruyor (at() hala sampleY disinda ihtiyac duyulursa diye).
 */
/** ESKI bilineer surum - yalnizca referans; hicbir yerden cagrilmiyor. */
export function groundYBilineer(zone, x, z) {
  if (!zone) return 0;
  const fx = (x - zone.originX) / zone.cellSizeU;
  const fz = (z - zone.originZ) / zone.cellSizeU;
  const c0 = Math.floor(fx), r0 = Math.floor(fz);
  const tx = fx - c0, tz = fz - r0;
  const h00 = at(zone, c0, r0), h10 = at(zone, c0 + 1, r0);
  const h01 = at(zone, c0, r0 + 1), h11 = at(zone, c0 + 1, r0 + 1);
  return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
}

export function zoneInfo(zone) {
  if (!zone) return null;
  return {
    originX: zone.originX, originZ: zone.originZ, cellSizeU: zone.cellSizeU,
    cols: zone.cols, rows: zone.rows,
    kapsam: {
      minX: zone.originX, maxX: zone.originX + zone.cols * zone.cellSizeU,
      minZ: zone.originZ, maxZ: zone.originZ + zone.rows * zone.cellSizeU,
    },
  };
}

// ===================================================================== sampleY
/*
 * ISTEMCININ ZEMIN ORNEKLEYICISI - BIREBIR.
 *
 * Oyuncunun uzerinde DURDUGU yukseklik yalnizca heights.bin degildir:
 *      durma yuksekligi = arazi  +  nav.bin YUZEY AGLARI
 * Cesme kenari, merdiven, koprü, platform hep yuzey aglarindadir. Biz sadece
 * araziyi ornekledigimiz icin oyuncu bu yapilarin ALTINDAKI arazi seviyesine
 * dusuyordu ("yerin dibine giriyorum", cesmenin icinde kalma).
 *
 * Kaynak: playjs_source/index-BUMMQVRB.js
 *   _9e()  -> terrainAt / normalAt / sampleY uretici
 *   h9e()  -> ucgen indeksi (duzlem katsayilari + 16 birimlik izgara)
 * Sabitler (paketten): u9e = .75 (bas bosluğu), zq = 1e-6, Rq = .01, Uq = 16.
 */
/* BAS BOSLUGU - paket index-DzRqDn3Z.js @5947040: `var oq=.01,H9e=.75,sq=1e-6;`
   ve TEK kullanildigi yer sampleY (@5950504). nav.js turev duvarlarin y-bandini
   bu ayni sabitten turetiyor, ikisi ASLA ayrismasin diye buradan ihrac ediliyor. */
export const BAS_BOSLUGU = 0.75;   // H9e (eski surumlerde u9e)
const EPS = 1e-6;           // zq
const YUZEY_HUCRE = 16;     // Uq

/** Istemcinin terrainAt'i: hucre icinde UCGEN enterpolasyonu (bilineer DEGIL). */
export function terrainAt(zone, x, z) {
  if (!zone) return 0;
  const cols = zone.cols, rows = zone.rows, d = cols + 1;
  let fx = (x - zone.originX) / zone.cellSizeU;
  let fz = (z - zone.originZ) / zone.cellSizeU;
  if (fx < 0) fx = 0; else if (fx > cols) fx = cols;
  if (fz < 0) fz = 0; else if (fz > rows) fz = rows;
  let ci = Math.floor(fx), ri = Math.floor(fz);
  if (ci > cols - 1) ci = cols - 1;
  if (ri > rows - 1) ri = rows - 1;
  const p = fx - ci, m = fz - ri;
  const h = ri * d + ci;
  const g = zone.heights[h], a = zone.heights[h + 1];
  const v = zone.heights[h + d], y = zone.heights[h + d + 1];
  return (p + m <= 1
    ? g + (a - g) * p + (v - g) * m
    : y + (v - y) * (1 - p) + (a - y) * (1 - m)) * HEIGHT_SCALE;
}

/**
 * Yuzey aglarindan ucgen indeksi kurar (istemcideki h9e).
 * Her ucgen icin duzlem katsayilari: y = pa*x + pb*z + pc.
 */
export function yuzeyIndeksi(surfaces) {
  if (!surfaces?.length) return null;
  const tris = [];
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let pid = 0; pid < surfaces.length; pid++) {
    const { verts, tris: idx } = surfaces[pid];
    for (let i = 0; i + 2 < idx.length; i += 3) {
      const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
      const ax = verts[a], ay = verts[a + 1], az = verts[a + 2];
      const bx = verts[b], by = verts[b + 1], bz = verts[b + 2];
      const cx = verts[c], cy = verts[c + 1], cz = verts[c + 2];
      const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (det > -1e-9 && det < 1e-9) continue;      // dejenere ucgen
      const pa = ((by - cy) * (az - cz) - (ay - cy) * (bz - cz)) / -det;
      const pb = ((by - cy) * (ax - cx) - (ay - cy) * (bx - cx)) / det;
      const pc = ay - pa * ax - pb * az;
      tris.push({ ax, az, bx, bz, cx, cz, pa, pb, pc, patchId: pid });
      if (ax < minX) minX = ax; if (ax > maxX) maxX = ax;
      if (bx < minX) minX = bx; if (bx > maxX) maxX = bx;
      if (cx < minX) minX = cx; if (cx > maxX) maxX = cx;
      if (az < minZ) minZ = az; if (az > maxZ) maxZ = az;
      if (bz < minZ) minZ = bz; if (bz > maxZ) maxZ = bz;
      if (cz < minZ) minZ = cz; if (cz > maxZ) maxZ = cz;
    }
  }
  if (!tris.length) return null;
  const originX = Math.floor(minX / YUZEY_HUCRE) * YUZEY_HUCRE;
  const originZ = Math.floor(minZ / YUZEY_HUCRE) * YUZEY_HUCRE;
  const cols = Math.max(1, Math.ceil((maxX - originX) / YUZEY_HUCRE));
  const rows = Math.max(1, Math.ceil((maxZ - originZ) / YUZEY_HUCRE));
  const cells = new Array(cols * rows);
  for (let i = 0; i < tris.length; i++) {
    const t = tris[i];
    const x0 = Math.floor((Math.min(t.ax, t.bx, t.cx) - originX) / YUZEY_HUCRE);
    const x1 = Math.floor((Math.max(t.ax, t.bx, t.cx) - originX) / YUZEY_HUCRE);
    const z0 = Math.floor((Math.min(t.az, t.bz, t.cz) - originZ) / YUZEY_HUCRE);
    const z1 = Math.floor((Math.max(t.az, t.bz, t.cz) - originZ) / YUZEY_HUCRE);
    for (let cz = Math.max(0, z0); cz <= Math.min(rows - 1, z1); cz++) {
      for (let cx = Math.max(0, x0); cx <= Math.min(cols - 1, x1); cx++) {
        const k = cz * cols + cx;
        (cells[k] ??= []).push(i);
      }
    }
  }
  return { originX, originZ, cellU: YUZEY_HUCRE, cols, rows, cells, tris };
}

/**
 * Istemcinin sampleY'si. `oncekiY` oyuncunun SU ANKI yuksekligi; secim buna
 * gore yapilir (bas bosluğu 0.75 birim). Ayni (x,z) icin farkli oncekiY
 * degerleri FARKLI kat verir - koprünün altindaysan alti, ustundeysen ustu.
 */
export function sampleY(zone, indeks, x, z, oncekiY = 0) {
  const tavan = oncekiY + BAS_BOSLUGU;
  let enIyi = terrainAt(zone, x, z);
  let yuzeyId = -1;
  let zeminVar = enIyi <= tavan;

  const dene = (aday, id) => {
    let al = false;
    if (aday <= tavan) {
      al = !zeminVar || aday > enIyi + EPS
        || (Math.abs(aday - enIyi) <= EPS && yuzeyId === -1);
      zeminVar = true;
    } else if (!zeminVar) {
      al = Math.abs(aday - oncekiY) < Math.abs(enIyi - oncekiY) - EPS;
    }
    if (al) { enIyi = aday; yuzeyId = id; }
  };

  if (indeks) {
    const cx = Math.floor((x - indeks.originX) / indeks.cellU);
    const cz = Math.floor((z - indeks.originZ) / indeks.cellU);
    if (cx >= 0 && cx < indeks.cols && cz >= 0 && cz < indeks.rows) {
      const liste = indeks.cells[cz * indeks.cols + cx];
      if (liste) {
        for (const i of liste) {
          const t = indeks.tris[i];
          const s1 = (t.bx - t.ax) * (z - t.az) - (t.bz - t.az) * (x - t.ax);
          const s2 = (t.cx - t.bx) * (z - t.bz) - (t.cz - t.bz) * (x - t.bx);
          const s3 = (t.ax - t.cx) * (z - t.cz) - (t.az - t.cz) * (x - t.cx);
          // hepsi ayni isaretteyse (veya sifirsa) ucgenin icindeyiz
          const disarida = (s1 < 0 || s2 < 0 || s3 < 0) && (s1 > 0 || s2 > 0 || s3 > 0);
          if (!disarida) dene(t.pa * x + t.pb * z + t.pc, t.patchId);
        }
      }
    }
  }
  return { y: enIyi, yuzeyId };
}

// ================================================================== su tabani
/*
 * SU TABANI (floorY) - istemcideki b9e().
 *
 * Derin suda oyuncu dibe cakilamaz; en fazla `suY - 1.5` seviyesine kadar
 * batar. Bu kisiti hic uygulamiyorduk, bu yuzden oyuncu su altindaki arazi
 * seviyesine dusup iskele/kopru tahtalarinin ICINDE kaliyordu.
 *
 * Istemcinin siniflandirmasi (b9e):
 *   - kind === "ice" olan dikdortgenler ELENIR (uzerinde yurunur, taban yok)
 *   - her dikdortgen tembel siniflandirilir:
 *       arazi hicbir noktada (y - 4.5) altina DUSMUYORSA -> 1 (sig)  -> taban YOK
 *       dusuyorsa                                        -> 2 (derin)-> taban VAR
 *   - taban = kapsayan DERIN dikdortgenlerin en buyuk (y - 1.5) degeri
 *   - kapsayan derin dikdortgen yoksa -Infinity (kisit yok)
 */
const SU_BATMA = 1.5;      // v9e
const SU_DERINLIK = 4.5;   // y9e

export function suTabaniKur(zone, water) {
  const liste = (water ?? []).filter(r => r.kind !== 'ice');
  if (!liste.length) return null;
  const sinif = new Uint8Array(liste.length);   // 0 = henuz bakilmadi

  const siniflandir = (i) => {
    if (sinif[i]) return sinif[i];
    const r = liste[i];
    const hucre = zone?.cellSizeU ?? 3;
    const nx = Math.max(1, Math.ceil((r.x1 - r.x0) / hucre));
    const nz = Math.max(1, Math.ceil((r.z1 - r.z0) / hucre));
    const esik = r.y - SU_DERINLIK;
    let sonuc = 1;
    dis: for (let a = 0; a <= nx; a++) {
      const x = r.x0 + (r.x1 - r.x0) * a / nx;
      for (let b = 0; b <= nz; b++) {
        const z = r.z0 + (r.z1 - r.z0) * b / nz;
        if (terrainAt(zone, x, z) < esik) { sonuc = 2; break dis; }
      }
    }
    sinif[i] = sonuc;
    return sonuc;
  };

  return (x, z) => {
    let en = -Infinity;
    for (let i = 0; i < liste.length; i++) {
      const r = liste[i];
      if (x < r.x0 || x > r.x1 || z < r.z0 || z > r.z1) continue;
      if (siniflandir(i) === 1) continue;          // sig su - kisit yok
      const t = r.y - SU_BATMA;
      if (t > en) en = t;
    }
    return en;
  };
}
