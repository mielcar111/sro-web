#!/usr/bin/env node
/**
 * gen_navbin_duvar.mjs - W5 TUREV DUVARLARINI nav.bin'e KALICI YAZAR
 *
 * NEDEN: yapilarin (teras/platform/merdiven) DIK YUZLERI icin nav.bin'de her
 * zaman blocker yok; oyuncu 1.7-2.5 birimlik kademeye cikamayip tas kutlenin
 * ICINE giriyor ("duz gidince objenin icine giriyorum" + "Buradan cikamiyor
 * musun?" penceresi). Kural W5: nav.bin'in KENDI yuzey aglarinin SINIR
 * kenarlarindan duvar uretilir. Kuralin TEK KAYNAGI nav.js'tir
 * (turevDuvarlariUret) - bu betik onu cagirir, kendi kopyasini TASIMAZ.
 *
 * NEDEN DOSYAYA: istemci carpismasini kendi nav.bin'inden kuruyor (paket M9e:
 * colliders = statics[].collider ∪ nav.blockers). Duvarlar yalnizca sunucuda
 * turetildiginde oyuncu EKRANDA hala yapinin icine yuruyor, sunucu onu geri
 * itiyordu (fx sapmasi -> snap). Dosyaya gomulunce iki taraf ayni duvari
 * goruyor.
 *
 * ISARET (veri surumu): nav.bin ofset 6-7 (uint16). Istemcinin cozucusu bu
 * iki bayti OKUMAZ (paket p9e yalnizca 0/4/8/12 ofsetlerini okur), bu yuzden
 * guvenli bir surum alanidir.
 *     0 -> dosyada turev duvar yok  (nav.js yukleme aninda uretir)
 *     1 -> W5 duvarlari gomulu      (nav.js BIR DAHA uretmez)
 *
 * IDEMPOTENS: cikti kaynagin degil, HESAPLANAN kumenin fonksiyonudur. Betik
 * once dosyadaki blocker kuyrugunu tazece hesaplanan aday kayitlarla BAYT
 * BAYT karsilastirir; esitse o kuyruk "onceki kosumun urunu" sayilir ve
 * TABAN olarak dosyanin geri kalani alinir. Yani ikinci kosum BIREBIR ayni
 * dosyayi uretir (sha256 degismez), duvarlar ikiye katlanmaz.
 *   Isaret 1 ama kuyruk eslesmiyorsa (kural degismis / dosya elle
 *   duzenlenmis) betik DURUR ve yedekten geri yuklemeyi ister - kor bir
 *   ekleme yapmaz.
 *
 * VARSAYILAN KURU KOSUMDUR. Yazmak icin acikca --uygula.
 *
 * KULLANIM
 *   node gen_navbin_duvar.mjs                      # tum bolgeler, kuru kosum
 *   node gen_navbin_duvar.mjs --bolge=jangan_province
 *   node gen_navbin_duvar.mjs --uygula             # nav.bin + nav.bin.gz yazar
 *   node gen_navbin_duvar.mjs --deneme=<dizin>     # sadece o dizine yazar
 *
 * --uygula SONRASI ZORUNLU ZINCIR (atlanirsa istemci varligi REDDEDER):
 *   node gen_manifest_guncelle.mjs --uygula
 * (manifestteki nav.bin + nav.bin.gz sha256/boyutunu ve
 *  version.json.manifestSha256'yi yeniler)
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  loadNav, navBilgi, turevDuvarlariUret, turevDuvarAyarla, yaricapAyarla,
  TUREV_SURUM,
} from './nav.js';

const BURASI = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.join(BURASI, '..', 'client');
const ZONES = JSON.parse(fs.readFileSync(path.join(BURASI, 'zones.json'), 'utf8'));
const GCFG = JSON.parse(fs.readFileSync(path.join(BURASI, 'data', 'game-config.json'), 'utf8'));

const HEADER = 16, BOYUT = 40, MAGIC = 1447972173;

const A = new Map();
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a); if (m) A.set(m[1], m[2] ?? '1');
}
const SADECE = A.get('bolge') || '';
const UYGULA = A.has('uygula');
const DENEME = A.get('deneme') || '';

/* Yaricap: nokta korumasi oyuncu yaricapini kullanir - sunucunun kullandigi
   degerle AYNI olmali, yoksa korunan nokta kumesi ayrisir. */
yaricapAyarla(GCFG.entityRadiusU);
/* Uretimi ACIK tutmaya gerek YOK: turevDuvarlariUret dogrudan cagriliyor.
   loadNav'in kendiliginden uretmesini KAPATIYORUZ ki taban blocker sayisi
   dosyadaki sayiyla birebir olsun. */
turevDuvarAyarla(false);

/** Bir turev duvari 40 baytlik nav.bin kaydina cevirir. */
function kayitYaz(buf, o, b) {
  buf.writeFloatLE(b.x, o);            // merkez (turev duvarlarda ox=oz=0)
  buf.writeFloatLE(b.z, o + 4);
  buf.writeFloatLE(b.rotY, o + 8);
  buf.writeUInt8(0, o + 12);           // kind = 0 -> KUTU
  buf.writeUInt8(3, o + 13);           // bayrak = yMin VAR | yMax VAR
  buf.writeFloatLE(b.hx, o + 16);
  buf.writeFloatLE(b.hz, o + 20);
  buf.writeFloatLE(0, o + 24);         // ox
  buf.writeFloatLE(0, o + 28);         // oz
  buf.writeFloatLE(b.yMin, o + 32);
  buf.writeFloatLE(b.yMax, o + 36);
}

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

/** gzip: uretim .gz'leri level 9 ve OS baytı 3 (Unix) ile uretilmis.
 *  KANIT: yedekteki jangan nav.bin'i level 9 ile sikistirinca cikti
 *  1.826.891 bayt ve orijinalle TEK FARK 9. bayt (OS) idi. Ayni bicimi
 *  koruyoruz ki .gz kardesleri ayni araca ait gorunsun. */
function gzipUret(veri) {
  const g = zlib.gzipSync(veri, { level: 9 });
  g[9] = 3;
  return g;
}

const rapor = [];
let durduran = null;

for (const zoneId of Object.keys(ZONES)) {
  if (SADECE && zoneId !== SADECE) continue;
  const kaynakYol = path.join(CLIENT, 'assets', 'zones', zoneId, 'nav.bin');
  if (!fs.existsSync(kaynakYol)) { console.log(`${zoneId.padEnd(24)} nav.bin YOK - atlandi`); continue; }
  const buf = fs.readFileSync(kaynakYol);
  if (buf.length < HEADER || buf.readUInt32LE(0) !== MAGIC || buf.readUInt16LE(4) !== 1) {
    durduran = `${zoneId}: nav.bin basligi taninmadi`; break;
  }
  const isaret = buf.readUInt16LE(6);
  const dosyaBlocker = buf.readUInt32LE(8);
  const kuyrukOfset = HEADER + dosyaBlocker * BOYUT;    // yuzey aglari burada basliyor

  /* Adaylari nav.js'in KENDI kuralindan uret. loadNav bu dosyayi (isaretli
     olsun olmasin) uretim yapmadan yukler; adaylar yuzey aglarindan gelir,
     yuzeyler ise bu betikle HIC degismez -> aday kumesi kosumdan kosuma
     AYNI. */
  const nav = loadNav(CLIENT, zoneId);
  if (!nav) { durduran = `${zoneId}: loadNav basarisiz`; break; }
  const aday = turevDuvarlariUret(nav, zoneId);
  const ek = Buffer.alloc(aday.length * BOYUT);
  aday.forEach((b, i) => kayitYaz(ek, i * BOYUT, b));

  /* --- IDEMPOTENS: kuyruk zaten bu adaylar mi? --- */
  const kuyrukVar = dosyaBlocker >= aday.length && aday.length > 0 &&
    buf.subarray(kuyrukOfset - ek.length, kuyrukOfset).equals(ek);
  if (isaret >= TUREV_SURUM && !kuyrukVar) {
    durduran = `${zoneId}: isaret=${isaret} ama blocker kuyrugu bugunku adaylarla ESLESMIYOR. ` +
      `Kural degismis ya da dosya elle duzenlenmis olabilir - kor ekleme yapilmadi. ` +
      `YEDEK/navbin-oncesi-2026-09-05/zones/${zoneId}/nav.bin dosyasini geri yukleyip tekrar kosun.`;
    break;
  }
  const tabanBlocker = kuyrukVar ? dosyaBlocker - aday.length : dosyaBlocker;
  const tabanSon = HEADER + tabanBlocker * BOYUT;       // turev-oncesi blocker sonu

  const yeni = Buffer.concat([
    buf.subarray(0, tabanSon),        // baslik + DOSYANIN KENDI blocker'lari
    ek,                               // W5 turev duvarlari
    buf.subarray(kuyrukOfset),        // yuzey aglari (bit-bit dokunulmadi)
  ]);
  yeni.writeUInt16LE(TUREV_SURUM, 6);                 // veri surumu isareti
  yeni.writeUInt32LE(tabanBlocker + aday.length, 8);  // blocker sayaci

  const degisti = !yeni.equals(buf);
  const r = {
    zoneId, tabanBlocker, turevDuvar: aday.length, toplamBlocker: tabanBlocker + aday.length,
    eskiBayt: buf.length, yeniBayt: yeni.length,
    eskiSha: sha(buf), yeniSha: sha(yeni),
    isaretOnce: isaret, degisti, tekrarKosum: kuyrukVar,
  };
  rapor.push(r);
  console.log(`${zoneId.padEnd(24)} ${tabanBlocker} + ${aday.length} = ${r.toplamBlocker} blocker  ` +
    `${buf.length} -> ${yeni.length} bayt  ${degisti ? 'DEGISTI' : 'AYNI (idempotent)'}` +
    `${kuyrukVar ? '  [kuyruk zaten turev]' : ''}`);

  const hedefKok = DENEME || CLIENT;
  if (UYGULA || DENEME) {
    const dizin = path.join(hedefKok, 'assets', 'zones', zoneId);
    fs.mkdirSync(dizin, { recursive: true });
    /* Atomik yazim: sunucu ayaktayken yarim dosya okunmasin. */
    const nYol = path.join(dizin, 'nav.bin');
    const tmp = nYol + '.tmp';
    fs.writeFileSync(tmp, yeni); fs.renameSync(tmp, nYol);
    const gz = gzipUret(yeni);
    const gYol = nYol + '.gz';
    const gtmp = gYol + '.tmp';
    fs.writeFileSync(gtmp, gz); fs.renameSync(gtmp, gYol);
    /* Varyant mtime'i KAYNAKTAN GERI OLMASIN (bayat-varyant kapisi).
       gen_sikistir.mjs'in KENDI politikasi: kaynak mtime + 1 saniye.
       Kaynagin mtime'ini AYNEN kopyalamak YETMIYOR - utimes alt-milisaniye
       cozunurlugu kirpiyor ve varyant kaynaktan mikrosaniyelerce ESKI
       kaliyordu (olculdu: 0.00098 - 0.35 ms; gen_sikistir bunlari
       "bayat" sayip mtime tazeliyordu). */
    const st = fs.statSync(nYol);
    const t = new Date(st.mtimeMs + 1000);
    fs.utimesSync(gYol, t, t);
    r.gzBayt = gz.length; r.gzSha = sha(gz);
    console.log(`${' '.repeat(24)}   -> yazildi: nav.bin (${yeni.length}) + nav.bin.gz (${gz.length})`);
  }
}

if (durduran) {
  console.error('\nDURDURULDU: ' + durduran);
  process.exit(2);
}

const toplamTurev = rapor.reduce((a, r) => a + r.turevDuvar, 0);
console.log(`\n${rapor.length} bolge, toplam ${toplamTurev} turev duvar.`);
if (!UYGULA && !DENEME) {
  console.log('[KURU KOSUM] hicbir dosya degistirilmedi. Yazmak icin --uygula.');
} else if (UYGULA) {
  console.log('SIMDI ZORUNLU: node gen_manifest_guncelle.mjs --uygula');
}

const raporYol = path.join(BURASI, 'gen_navbin_duvar.rapor.json');
if (UYGULA) fs.writeFileSync(raporYol, JSON.stringify({ tarih: new Date().toISOString(), TUREV_SURUM, bolgeler: rapor }, null, 1));
