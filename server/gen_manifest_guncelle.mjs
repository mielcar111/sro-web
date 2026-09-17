#!/usr/bin/env node
/**
 * gen_manifest_guncelle.mjs - VARLIK DEGISTIKTEN SONRA BUTUNLUK ZINCIRINI ONARIR
 *
 * ZINCIR (istemci kodundan okundu, varsayim yok):
 *   1) patcher /version.json'u ceker  (paket mVt)
 *   2) manifestUrl'i indirir, HAM BAYTLARININ sha256'sini version.json'daki
 *      manifestSha256 ile karsilastirir; tutmazsa cache:"reload" ile bir kez
 *      daha dener, yine tutmazsa "manifest: sha256 mismatch" ATAR  (paket hVt)
 *   3) eski manifest ile yeni manifesti alan alan karsilastirir; h'si degisen
 *      her anahtar "changed" olur  (paket KBt)
 *   4) changed + removed anahtarlarini game-assets onbelleginden SILER, sonra
 *      her birini indirip sha256'sini manifest girdisiyle dogrular; tutmazsa
 *      "hash mismatch after cache-busting retry" ATAR  (paket ZBt/QBt)
 *   5) service worker da her cache yazimini manifest h'sine karsi dogrular
 *      (client/sw.js cacheFirst); tutmayan cevap SERVILIR ama ONBELLEGE
 *      YAZILMAZ.
 * Yani nav.bin'i degistirip manifesti guncellememek = patcher hatasi +
 * onbelleklenmeyen varlik. Bu betik o yuzden zorunlu son adimdir.
 *
 * NE YAPAR
 *   - manifestteki her girdiyi diskteki dosyayla karsilastirir (boyut; boyut
 *     tutuyorsa sha256 yalnizca --hepsi ile ya da hedef desende hesaplanir)
 *   - degisenlerin h + s alanlarini gunceller, totalBytes'i yeniden toplar
 *   - manifest .json'u atomik yazar, sha256'sini version.json'a isler
 *   - JSON.parse ile iki dosyayi da geri okuyup dogrular
 *
 * KULLANIM
 *   node gen_manifest_guncelle.mjs                 # rapor (yazmaz)
 *   node gen_manifest_guncelle.mjs --uygula
 *   node gen_manifest_guncelle.mjs --uygula --hepsi   # 10.010 dosyayi da hashler
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const BURASI = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.join(BURASI, '..', 'client');
const UYGULA = process.argv.includes('--uygula');
const HEPSI = process.argv.includes('--hepsi');
/* Bu desendeki girdiler boyutlari ayni olsa bile HER ZAMAN hashlenir -
   icerigi ayni boyutta degisebilen, elle uretilen varliklar. */
const HEP_HASHLE = /(^|\/)nav\.bin(\.gz|\.br)?$/;

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

const verYol = path.join(CLIENT, 'version.json');
const ver = JSON.parse(fs.readFileSync(verYol, 'utf8'));
const manYol = path.join(CLIENT, ver.manifestUrl.replace(/^\//, ''));
const manHam = fs.readFileSync(manYol, 'utf8');
const man = JSON.parse(manHam);

/* Sadelestirme guvenligi: JSON.stringify(JSON.parse(x)) === x oldugu
   dogrulanmadan yazma yapilmaz - aksi halde biz bir sey degistirmesek bile
   manifest bayt bayt kayar (sha degisir, gereksiz yeniden indirme). */
if (JSON.stringify(man) !== manHam) {
  console.error('HATA: manifest JSON.stringify ile birebir yeniden uretilemiyor.');
  console.error('Bicim korunmadan yazmak tum manifesti degistirirdi - duruldu.');
  process.exit(2);
}

console.log(`manifest : ${path.basename(manYol)}  (${Object.keys(man.files).length} dosya)`);
console.log(`surum    : ${ver.version}`);
console.log(`eski manifestSha256 : ${ver.manifestSha256}`);

const degisen = [], eksik = [];
let bakilan = 0;
for (const [anahtar, girdi] of Object.entries(man.files)) {
  const p = path.join(CLIENT, 'assets', anahtar.split('/').join(path.sep));
  let st = null;
  try { st = fs.statSync(p); } catch { eksik.push(anahtar); continue; }
  const boyutFarkli = st.size !== girdi.s;
  if (!boyutFarkli && !HEPSI && !HEP_HASHLE.test(anahtar)) continue;
  bakilan++;
  const h = sha(fs.readFileSync(p));
  if (h !== girdi.h || st.size !== girdi.s) {
    degisen.push({ anahtar, eskiH: girdi.h, yeniH: h, eskiS: girdi.s, yeniS: st.size });
    girdi.h = h; girdi.s = st.size;
  }
}

console.log(`hashlenen: ${bakilan}   degisen: ${degisen.length}   diskte eksik: ${eksik.length}`);
for (const d of degisen) {
  console.log(`  ${d.anahtar}`);
  console.log(`      boyut ${d.eskiS} -> ${d.yeniS}`);
  console.log(`      sha   ${d.eskiH.slice(0, 16)}... -> ${d.yeniH.slice(0, 16)}...`);
}
if (eksik.length) console.log(`  DISKTE YOK: ${kisalt(eksik)}`);
function kisalt(a) { return a.length <= 5 ? a.join(', ') : a.slice(0, 5).join(', ') + ` ... +${a.length - 5}`; }

if (!degisen.length) {
  console.log('\nDegisen girdi yok - manifest ve version.json aynen kaliyor.');
  process.exit(0);
}

const eskiToplam = man.totalBytes;
man.totalBytes = Object.values(man.files).reduce((a, v) => a + v.s, 0);
console.log(`totalBytes: ${eskiToplam} -> ${man.totalBytes}`);

const yeniMan = JSON.stringify(man);
const yeniManSha = sha(Buffer.from(yeniMan, 'utf8'));
console.log(`yeni manifestSha256 : ${yeniManSha}`);

if (!UYGULA) {
  console.log('\n[KURU KOSUM] hicbir dosya degistirilmedi. Yazmak icin --uygula.');
  process.exit(0);
}

/* --- atomik yazim --- */
fs.writeFileSync(manYol + '.tmp', yeniMan, 'utf8');
fs.renameSync(manYol + '.tmp', manYol);

const yeniVer = { ...ver, manifestSha256: yeniManSha };
fs.writeFileSync(verYol + '.tmp', JSON.stringify(yeniVer), 'utf8');
fs.renameSync(verYol + '.tmp', verYol);

/* --- geri okuma dogrulamasi --- */
const gMan = fs.readFileSync(manYol);
const gVer = JSON.parse(fs.readFileSync(verYol, 'utf8'));
const gManObj = JSON.parse(gMan.toString('utf8'));        // JSON.parse dogrulamasi
const gSha = sha(gMan);
let hata = 0;
const kontrol = (ad, kosul, ek = '') => {
  console.log(`  ${kosul ? 'OK  ' : 'HATA'} ${ad}${ek ? '  ' + ek : ''}`);
  if (!kosul) hata++;
};
console.log('\n=== GERI OKUMA DOGRULAMASI ===');
kontrol('manifest JSON.parse edilebiliyor', !!gManObj.files, `${Object.keys(gManObj.files).length} dosya`);
kontrol('version.json JSON.parse edilebiliyor', typeof gVer.version === 'string');
kontrol('version.manifestSha256 = manifest dosyasinin sha256si', gVer.manifestSha256 === gSha, gSha.slice(0, 16) + '...');
kontrol('version.manifestUrl degismedi', gVer.manifestUrl === ver.manifestUrl, gVer.manifestUrl);
kontrol('version.version degismedi', gVer.version === ver.version, gVer.version);
for (const d of degisen) {
  const g = gManObj.files[d.anahtar];
  const p = path.join(CLIENT, 'assets', d.anahtar.split('/').join(path.sep));
  const diskH = sha(fs.readFileSync(p));
  kontrol(`girdi dogru: ${d.anahtar}`, !!g && g.h === diskH && g.s === fs.statSync(p).size);
}
console.log(hata ? `\n${hata} HATA` : '\nZincir tutarli.');
process.exit(hata ? 1 : 0);
