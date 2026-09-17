/**
 * ON-SIKISTIRMA URETICISI  -  client/ altindaki metin varliklari icin
 * <ad>.br ve <ad>.gz "kardes dosyalari" uretir; server.js bunlari
 * Accept-Encoding'e gore DOGRUDAN akitir (anlik sikistirma yerine).
 *
 *   node gen_sikistir.mjs                 -> uret (idempotent; guncelleri atlar)
 *   node gen_sikistir.mjs --kuru          -> hicbir sey yazma, sadece raporla
 *   node gen_sikistir.mjs --zorla         -> guncel olsa da yeniden uret
 *   node gen_sikistir.mjs --kalite=9      -> brotli kalitesi (varsayilan 11)
 *   node gen_sikistir.mjs --gzip=9        -> gzip seviyesi  (varsayilan 9)
 *   node gen_sikistir.mjs --es=8          -> es zamanli is  (varsayilan cekirdek/8)
 *
 * Daha hizli uretim icin libuv havuzunu buyut:
 *   UV_THREADPOOL_SIZE=16 node gen_sikistir.mjs      (bash)
 *   $env:UV_THREADPOOL_SIZE=16; node gen_sikistir.mjs (PowerShell)
 *
 * ---------------------------------------------------------------------------
 * NEDEN (olculmus, tahmin degil)
 * ---------------------------------------------------------------------------
 * 19.13 MiB'lik entry bundle (client/app/index-*.js) HER SOGUK ISTEKTE yeniden
 * brotli'leniyordu ve cikti hicbir yerde saklanmiyordu; diskte tek bir .br
 * dosyasi yoktu. Calisan sunucuda 5 tur medyani:
 *     yalniz entry : br 509.75 ms | gzip 477.63 ms | identity 73.63 ms
 *     giris grafi  : br 519.71 ms (57 dosya, 6 paralel)
 * Izole A/B (port 3099, 3 tur medyan) - anlik br5 vs on-sikistirilmis br11:
 *     giris grafi  : 374.21 ms -> 25.35 ms   (14.8x)  tel 2.98 -> 2.45 MB
 *     yalniz entry : 346.77 ms ->  5.17 ms            tel 2.79 -> 2.28 MB
 *
 * ---------------------------------------------------------------------------
 * KURALLAR (ihlali regresyondur)
 * ---------------------------------------------------------------------------
 * 1) .glb/.png/.webp/.ogg icin varyant URETILMEZ. Olculdu: png br5 %98,
 *    webp %100, ogg %100 (yani hicbir sey kazandirmiyor); .glb %78 ama
 *    br5 50.62 ms / br11 10.35 s ve manifestte 3933 .glb / 889.7 MB var.
 *    Canli parite: referans site .glb'ye content-encoding koymuyor.
 * 2) MEVCUT .gz DOSYALARI EZILMEZ. client/assets altindaki 29 .gz dosyasi
 *    (heights/nav/statics/splat) Content-Encoding varyanti DEGIL, manifestte
 *    KENDI URL'i ve sha256'si olan ICERIK varliklaridir; uzerine yazmak
 *    manifest dogrulamasini ve service worker onbellegini kirar. Bu betik
 *    onlari yalnizca DOGRULAR (acilmisi == kaynak mi) ve gerekiyorsa mtime'ini
 *    tazeler - icerige DOKUNMAZ, sha256 degismez. Dogrulama AKIS uzerinden
 *    yapilir (heights.bin 60 MB'a kadar aciliyor; bellege almak ~1 GB RSS'ti).
 * 3) Her varyantin yaninda `<varyant>.meta` IMZA DOSYASI durur ve varyantin
 *    URETILDIGI ANDAKI kaynagin imzasini (boyut + mtimeMs) tasir. server.js
 *    tazelik karari icin TAM ESITLIK sorar; imza dosyasi yoksa eski mtime
 *    kuralina duser (miras uyumu). Varyantin mtime'i ayrica kaynaktan SONRAYA
 *    (kaynak + 1 sn) sabitlenmeye devam eder - imzasiz eski sunucularla ve
 *    miras yoluyla uyum icin.
 *    ** ISTEMCI PAKETI HER YAMALANDIGINDA BU BETIK YENIDEN CALISTIRILMALI. **
 *    NEDEN IMZA (2026-09-05, CANLI URETILEN KOR NOKTA): eski olcut yalniz
 *    `varyant.mtime >= kaynak.mtime` idi ve pencereyi bu betik kuruyordu
 *    (kaynak + 1000 ms). Kaynak bu 1 saniye ICINDE tekrar degisirse yeni
 *    mtime'i hala varyanttan KUCUK kaliyor -> sunucu bayat govdeyi TAZE sanip
 *    servis ediyor, ustelik bu betik de ayni karsilastirmayi kullandigi icin
 *    dosyayi "zaten guncel" sayip ATLIYOR: durum --zorla gelene kadar kendi
 *    kendine iyilesmiyordu. TAM ESITLIK bunu 1000 ms'ten dosya sistemi
 *    cozunurlugune (bu makinede ~0.496 ms; 400 ardisik yazim olculdu, mtimeMs
 *    kesirli) indirdi - ama SIFIRLAMADI.
 *
 *    IMZA SURUMU 2 (kalan ~0.5 ms'lik pencere KAPATILDI). Boyut+mtime bir ZAMAN
 *    kimligidir, ICERIK kimligi degil: kaynak, bu betik onu OKUDUKTAN sonra
 *    ayni mtime tik'i icinde ve AYNI BOYUTTA bir kez daha yazilirsa imza hic
 *    degismez ve bayat varyant "taze" gorunur. Sunucu bu farki tek basina
 *    goremez (kapiyi ucuz kilan sey kaynagi hic okumamasidir). Bu yuzden kanit
 *    URETIM zamaninda uretiliyor - `metaYaz` .meta'yi yazmadan once:
 *      (a) ICERIK KANITI - kaynagi diskten YENIDEN hash'ler ve sikistirilan
 *          baytlarin sha256'siyla karsilastirir; ayni tik icindeki, boyutu
 *          degistirmeyen ikinci yazim tam burada yakalanir,
 *      (b) TIK KAPANMA KANITI - kaynagin mtime'i uzerinden dosya sistemi
 *          cozunurlugunden acikca buyuk bir sure (MTIME_YERLESME_MS) gecmeden
 *          imza yazilmaz; boylece imzadan SONRAKI her yazim kesinlikle farkli
 *          bir mtime uretir ve sunucudaki tam esitlik onu reddeder,
 *      (c) VARYANT KIMLIGI - .meta artik varyantin kendi boyut+mtime'ini da
 *          tasir; imzaya dokunulmadan uzerine yazilmis bir varyant (yarim
 *          kopya, elle mudahale) sunucuda reddedilir.
 *    Hangi adim tutmazsa imza YAZILMAZ ve varyant devre disi kalir: yanlis bir
 *    "taze" imzasi yerine yavas ama DOGRU anlik sikistirma.
 *    BU KURAL DISKTEKI **TUM** VARYANTLAR ICIN GECERLIDIR - kaynagin uzantisi
 *    UZANTILAR kumesinde olmasa bile (4. adim). Eskiden degildi: 2. adim
 *    kaynaklari geziyordu, bu yuzden kaynagi .bin olan 22 varyant
 *    (zones/<b>/heights.bin.gz + nav.bin.gz, ground/splat/<b>.bin.gz) hicbir
 *    adima ugramiyor ve mtime'lari kaynagindan 0.34-4.11 sn ESKI kaliyordu.
 *    '.bin' bugun SIKISTIRILIR kumesinde olmadigi icin sunucuda etkisi yoktu;
 *    kumeye alindigi gun 22 dosya birden sessizce anlik sikistirmaya duserdi.
 * 4) Yazim atomiktir (<ad>.br.tmp -> rename): sunucu ayaktayken calistirilsa
 *    bile yarim yazilmis bir govde servis edilemez.
 * 5) '.md' KUMEYE DAHILDIR (surum notlari). Istemci bunlari gercekten indiriyor
 *    (tFt() -> fetch('/assets/changelog/<dosya>').text(); rFt() giriste en yeni
 *    gorulmemis girdiyi kendiliginden aciyor). Gerekce ve olcumler server.js'te
 *    SIKISTIRILIR kumesinin ustunde.
 *
 * ---------------------------------------------------------------------------
 * WINDOWS TUZAGI - EPERM (olculdu, tahmin degil)
 * ---------------------------------------------------------------------------
 * server.js:govdeGonder 2 MB'tan buyuk dosyalari `createReadStream(...).pipe(res)`
 * ile akitiyor. Istemci indirmeyi YARIDA keserse pipe() kaynagi kapatmaz ve okuma
 * handle'i SIZAR; Windows'ta o dosyanin uzerine bir daha rename yapilamaz.
 * Sonuc: sunucu AYAKTAYKEN bu betik tam da en onemli dosyada (entry paketi .br)
 * "EPERM" verip onu ATLAYABILIR - digerleri yazilir, cikis kodu 1 olur.
 * Uretilen kanit: bakir dosyada rename ok; tam indirmeden sonra ok; YARIDA
 * KESILEN indirmeden sonra EPERM (index-CMAf3Hp2.js.br uzerinde tekrarlandi).
 * ATOMIK YAZIM SAYESINDE ICERIK BOZULMAZ (eski dogru govde yerinde kalir) ve
 * bayat-varyant kapisi devreye girip anlik sikistirmaya duser - yani DOGRULUK
 * korunur, yalnizca hiz eski haline doner.
 *   -> Betigi tercihen sunucu KAPALIYKEN calistir.
 *   -> `node gen_sikistir.mjs | tail` YAPMA: cikis kodu tail'in olur, hatayi
 *      kacirirsin. Ciktiyi oku, "UYARILAR" bolumune bak.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import os from 'node:os';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

/* ASENKRON sikistirma bilerek secildi: zlib'in *Sync bicimleri ana is
   parcaciginda calisir ve tek cekirdek darbogazi olur (q11'de entry bundle
   tek basina 34.7 sn). Geri cagirmali bicim libuv is havuzuna dagilir;
   havuz varsayilani 4, UV_THREADPOOL_SIZE ile buyutulebilir. */
const brotliSikistir = promisify(zlib.brotliCompress);
const gzipSikistir   = promisify(zlib.gzip);

const HERE   = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.join(HERE, '..', 'client');

// ---------------------------------------------------------------- parametreler
const arg = (ad, vars) => {
  const e = process.argv.find(a => a.startsWith(`--${ad}=`));
  if (!e) return vars;
  const n = Number(e.slice(ad.length + 3));
  return Number.isFinite(n) ? n : vars;
};
const KURU   = process.argv.includes('--kuru');
const ZORLA  = process.argv.includes('--zorla');
const BR_KAL = Math.max(0, Math.min(11, arg('kalite', 11)));
const GZ_SEV = Math.max(1, Math.min(9,  arg('gzip', 9)));
const ES     = Math.max(1, arg('es', Math.min(8, os.cpus().length || 4)));
const ASGARI = 1024;      // server.js ile AYNI esik: st.size > 1024

/* VARYANT IMZA DOSYASI - server.js:META_SURUM / META_UZANTI ile BIREBIR ayni
   olmali (sunucuKumesiniDogrula bunu da denetler ve ayrismissa durur). */
const META_SURUM  = 2;
const META_UZANTI = '.meta';

/* TIK KAPANMA PAYI. Imza, kaynagin mtime'i uzerinden EN AZ bu kadar sure
   gectikten sonra yazilir; boylece imzadan sonra yapilacak her yazim mutlaka
   DAHA BUYUK bir mtime alir ve sunucudaki tam esitlik onu reddeder. Deger
   dosya sistemi cozunurlugunun ustunde olmali: olculen NTFS adimi ~0.496 ms,
   ext4/APFS ns, en kotu gercekci durum HFS+ 1 sn -> 1500 ms hepsini asar.
   PRATIKTE BEKLEME OLMAZ: kaynaklarin mtime'i genelde dakikalar/saatler
   oncedir; bekleme yalnizca paket AZ ONCE yamalandiysa (1-2 dosya) devreye
   girer ve `imza beklendi` sayaci ile raporlanir. */
const MTIME_YERLESME_MS = 1500;

/* server.js'teki SIKISTIRILIR kumesiyle BIREBIR ayni olmali. Elle senkron
   tutmak yerine kaynaktan okunup dogrulanir - biri degisirse betik durur. */
const UZANTILAR = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.txt', '.map', '.md']);
function sunucuKumesiniDogrula() {
  const src = fs.readFileSync(path.join(HERE, 'server.js'), 'utf8');
  const m = src.match(/const SIKISTIRILIR = new Set\(\[([^\]]*)\]\)/);
  if (!m) { console.warn('UYARI: server.js icinde SIKISTIRILIR kumesi bulunamadi - dogrulama atlandi.'); return; }
  const sunucu = new Set([...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]));
  const fark = [...new Set([...sunucu, ...UZANTILAR])].filter(x => sunucu.has(x) !== UZANTILAR.has(x));
  if (fark.length) {
    console.error(`HATA: uzanti kumesi server.js ile AYRISMIS -> ${fark.join(', ')}`);
    console.error('Betikteki UZANTILAR ile server.js:SIKISTIRILIR ayni olmali. Duruldu.');
    process.exit(1);
  }
  const esik = src.match(/SIKISTIRILIR\.has\(uzanti\) && st\.size > (\d+)/);
  if (esik && Number(esik[1]) !== ASGARI) {
    console.error(`HATA: boyut esigi ayrismis - server.js ${esik[1]}, betik ${ASGARI}. Duruldu.`);
    process.exit(1);
  }
  /* IMZA SOZLESMESI de ayrisamaz: bu betigin yazdigi `v` alanini sunucu
     tanimazsa her varyant sessizce MIRAS mtime kuralina duser - yani bugun
     kapatilan kor nokta geri gelir, hem de hicbir uyari vermeden. */
  const ms = src.match(/const META_SURUM = (\d+)/);
  if (!ms) {
    console.error('HATA: server.js icinde META_SURUM bulunamadi - imza sozlesmesi ayrismis. Duruldu.');
    process.exit(1);
  }
  if (Number(ms[1]) !== META_SURUM) {
    console.error(`HATA: imza surumu ayrismis - server.js ${ms[1]}, betik ${META_SURUM}. Duruldu.`);
    process.exit(1);
  }
  const mu = src.match(/const META_UZANTI = '([^']+)'/);
  if (mu && mu[1] !== META_UZANTI) {
    console.error(`HATA: imza uzantisi ayrismis - server.js '${mu[1]}', betik '${META_UZANTI}'. Duruldu.`);
    process.exit(1);
  }
  /* Surum 2 alanlari: sunucu VARYANTIN kendi kimligini de sorguluyor. Bu alan
     adlari ayrisirsa (ya da sunucu tarafi geri alinirsa) metaKarari her imzayi
     eksik bulup MIRAS kuralina duserdi - yine sessizce. */
  for (const alan of ['varyantBoyut', 'varyantMtimeMs']) {
    if (!src.includes(`meta.${alan}`)) {
      console.error(`HATA: server.js imza alanini okumuyor: ${alan} (surum ${META_SURUM} sozlesmesi). Duruldu.`);
      process.exit(1);
    }
  }
}

// ---------------------------------------------------------------- manifest kalkani
/* Manifestte KENDI URL'i olan .gz dosyalari icerik varligidir: dokunulmaz.
   Manifest okunamazsa TEMKINLI davranilir - assets/ altindaki her mevcut .gz
   korunur (ezme riski, hizdan onemlidir). */
function manifestKalkani() {
  try {
    const ver = JSON.parse(fs.readFileSync(path.join(CLIENT, 'version.json'), 'utf8'));
    const man = JSON.parse(fs.readFileSync(path.join(CLIENT, ver.manifestUrl.replace(/^\//, '')), 'utf8'));
    const anahtarlar = new Set(Object.keys(man.files || {}));
    return { tur: 'manifest', adet: anahtarlar.size, korunur: (rel) =>
      rel.startsWith('assets/') && anahtarlar.has(rel.slice('assets/'.length)) };
  } catch (e) {
    return { tur: 'temkinli', adet: 0, sebep: e.message,
             korunur: (rel) => rel.startsWith('assets/') };
  }
}

// ---------------------------------------------------------------- yardimcilar
function* gez(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const f = path.join(d, e.name);
    if (e.isDirectory()) yield* gez(f); else yield f;
  }
}
const rel = (f) => f.slice(CLIENT.length + 1).split(path.sep).join('/');
const mb  = (n) => (n / 1048576).toFixed(2);

/* Atomik yazim + mtime'i kaynagin 1 sn SONRASINA sabitle (server.js'in bayat
   varyant kapisi mtime karsilastirmasi yapiyor; dosya sistemi cozunurlugu
   yuzunden "ayni saniye" belirsiz kalmasin). */
async function atomikYaz(hedef, veri, kaynakMtimeMs) {
  const gecici = `${hedef}.tmp${process.pid}`;
  await fsp.writeFile(gecici, veri);
  try {
    await fsp.rename(gecici, hedef);
  } catch (e) {
    await fsp.rm(gecici, { force: true });
    throw e;
  }
  const t = new Date(kaynakMtimeMs + 1000);
  await fsp.utimes(hedef, t, t);
}

/* ------------------------------------------------------------- imza dosyasi
   `<varyant>.meta` = varyantin URETILDIGI andaki kaynagin imzasi. Sunucunun
   okudugu alanlar `v`, `kaynakBoyut`, `kaynakMtimeMs`, `varyantBoyut`,
   `varyantMtimeMs`; digerleri insan icin (hangi kaynak, hangi kalite, ne zaman,
   hangi sha256) ve elle denetim icindir.
   `kaynakSha256` SURUM 2'DE ZORUNLU: imzayi yazmadan once kaynagin diskteki
   hali yeniden hash'lenip bu degerle karsilastiriliyor (ICERIK KANITI). Hash
   hicbir yerde bedava degilse de bedeli URETIM zamanindadir - istek yolunda
   tek bayt fazladan okunmaz. */
const metaYolu = (varyantYol) => varyantYol + META_UZANTI;

async function metaOku(varyantYol) {
  try { return JSON.parse(await fsp.readFile(metaYolu(varyantYol), 'utf8')); }
  catch { return null; }
}

/* Sunucunun kapisiyla BIREBIR ayni olcut (server.js:metaKarari) - VARYANTIN
   kendi kimligi dahil. `vSt` verilmezse yalnizca kaynak tarafi sinanir. */
const metaUyuyor = (meta, st, vSt = null) => !!meta && meta.v === META_SURUM
  && meta.kaynakBoyut === st.size && meta.kaynakMtimeMs === st.mtimeMs
  && (!vSt || (meta.varyantBoyut === vSt.size && meta.varyantMtimeMs === vSt.mtimeMs));

async function metaSil(varyantYol) {
  try { await fsp.rm(metaYolu(varyantYol), { force: true }); } catch { /* zaten yok */ }
}

const bekle = (ms) => new Promise(r => setTimeout(r, ms));

/* Dosyayi AKISLA hash'ler - bellege almaz (bu yoldan 60 MB'lik heights.bin de
   geciyor ve havuz ES tanesini es zamanli isliyor). Okunamazsa null. */
async function dosyaSha256(yol) {
  const ozet = crypto.createHash('sha256');
  const akis = fs.createReadStream(yol);
  try {
    for await (const parca of akis) ozet.update(parca);
    return ozet.digest('hex');
  } catch { return null; }
  finally { akis.destroy(); }
}

/* IMZAYI KANITLA, SONRA YAZ. Yanlis bir "taze" imzasi bayat govdeyi KALICI
   olarak dogru gostermek demektir; bu yuzden asagidaki dort adimdan biri bile
   tutmazsa imza YAZILMAZ, varsa eskisi SILINIR ve varyantin mtime'i kaynagin
   gerisine alinir (asagidaki IPTAL notu) - sonuc anlik sikistirma olur, yavas
   ama DOGRU.

   1) TIK KAPANMASI: kaynagin mtime'i uzerinden MTIME_YERLESME_MS gecsin.
      Imzadan SONRAKI her yazim boylece kesinlikle farkli bir mtime alir.
      (mtime GELECEKTE ise beklenmez: o durumda sonraki yazim zaten daha KUCUK
      bir mtime uretir, yani esitlik yine bozulur.)
   2) STAT ESITLIGI: kaynak hala uretimde gordugumuz boyut+mtime'da mi.
   3) ICERIK KANITI: kaynagi diskten yeniden hash'le, sikistirilan baytlarin
      sha256'siyla karsilastir. ** KALAN ~0.5 ms'LIK KOR NOKTAYI KAPATAN ADIM
      BUDUR: ** ayni mtime tik'i icinde, ayni boyutta yapilmis ikinci bir yazim
      (2) adiminda GORUNMEZ, burada gorunur. Hash'ten sonra bir kez daha
      stat'lanir ki okuma sirasinda araya giren yazim da yakalansin.
   4) VARYANT KIMLIGI: imza, varyantin o andaki boyut+mtime'ini de tasir. Bu
      yuzden metaYaz HER ZAMAN varyantin son haline (atomikYaz/utimes bittikten
      SONRA) cagrilmali.

   ** IPTAL EDERKEN IKI KURAL BIRDEN KAPATILIR. ** Yalnizca .meta'yi silmek
   varyanti devre disi BIRAKMAZ - eski kod bunu yapiyor ve "varyant devre disi"
   diye raporluyordu, ama yanlisti: imza yoksa sunucu MIRAS kuralina duser ve o
   kural `varyant.mtime >= kaynak.mtime` diye sorar; atomikYaz varyantin
   mtime'ini kaynak + 1000 ms'e sabitledigi icin miras kurali bayat varyanti
   TAZE sayip servis ederdi. Yani icerik kaniti dogru karari verse bile sonuc
   degismezdi. Bu yuzden iptalde varyantin mtime'i kaynagin GERISINE alinir
   (korunanVaryantDenetle'nin 'ortusmuyor' dalindaki ile ayni mekanizma;
   ICERIGE dokunulmaz, manifest sha256'si degismez). */
async function metaYaz(varyantYol, kayYol, st, { sha = null, uretim = null } = {}) {
  const vRel = rel(varyantYol);
  const iptal = async (mesaj) => {
    uyarilar.push(`${vRel}: ${mesaj} -> imza YAZILMADI, varyant devre disi. Betigi yeniden calistirin.`);
    await metaSil(varyantYol);
    /* Miras kuralini da kapat: varyant, kaynagin BUGUNKU mtime'inin de
       gerisine alinmali (kaynak bu arada degismis olabilir). */
    let taban = st.mtimeMs;
    try { const g = await fsp.stat(kayYol); taban = Math.min(taban, g.mtimeMs); } catch { /* silinmis */ }
    const t = new Date(Math.max(0, taban - 2000));
    try { await fsp.utimes(varyantYol, t, t); } catch { /* kilitli/silinmis olabilir */ }
    sayac.imzaAtlandi++;
    return false;
  };
  if (!sha) return iptal('kaynagin sha256\'si hesaplanamadi (icerik kaniti yok)');

  // 1) tik kapanmasi
  const gecen = Date.now() - st.mtimeMs;
  if (gecen >= 0 && gecen < MTIME_YERLESME_MS) {
    sayac.imzaBeklendi++;
    await bekle(MTIME_YERLESME_MS - gecen);
  }

  // 2) stat esitligi
  const statAl = async () => { try { return await fsp.stat(kayYol); } catch { return null; } };
  const once = await statAl();
  if (!once) return iptal('kaynak stat edilemedi');
  if (once.size !== st.size || once.mtimeMs !== st.mtimeMs) {
    return iptal(`kaynak URETIM SIRASINDA degisti (${st.size}b/${st.mtimeMs} -> ${once.size}b/${once.mtimeMs})`);
  }

  // 3) icerik kaniti
  const diskSha = await dosyaSha256(kayYol);
  if (!diskSha) return iptal('kaynak yeniden okunamadi (icerik kaniti dogrulanamadi)');
  const sonra = await statAl();
  if (!sonra || sonra.size !== st.size || sonra.mtimeMs !== st.mtimeMs) {
    return iptal('kaynak icerik kaniti alinirken degisti');
  }
  if (diskSha !== sha) {
    return iptal(`kaynak AYNI IMZAYLA (${st.size}b/${st.mtimeMs}) yeniden yazilmis - ` +
      `sikistirilan sha256 ${sha.slice(0, 12)}, diskteki ${diskSha.slice(0, 12)}`);
  }

  // 4) varyantin kendi kimligi
  let vSt;
  try { vSt = await fsp.stat(varyantYol); }
  catch (e) { return iptal(`varyant stat edilemedi (${e.code || e.message})`); }

  const govde = JSON.stringify({
    v: META_SURUM,
    kaynak: rel(kayYol),
    kaynakBoyut: st.size,
    kaynakMtimeMs: st.mtimeMs,
    kaynakSha256: sha,
    varyant: vRel,
    varyantBoyut: vSt.size,
    varyantMtimeMs: vSt.mtimeMs,
    uretim,
    yazim: new Date().toISOString(),
  }) + '\n';
  const hedef = metaYolu(varyantYol);
  const gecici = `${hedef}.tmp${process.pid}`;
  try {
    await fsp.writeFile(gecici, govde);
    await fsp.rename(gecici, hedef);
  } catch (e) {
    await fsp.rm(gecici, { force: true }).catch(() => {});
    sayac.hata++;
    uyarilar.push(`imza yazilamadi ${vRel}: ${e.code || e.message}`);
    return false;
  }
  sayac.imzaYazildi++;
  return true;
}

async function havuz(isler, es) {
  let i = 0;
  const calisanlar = Array.from({ length: Math.min(es, isler.length) }, async () => {
    while (i < isler.length) await isler[i++]();
  });
  await Promise.all(calisanlar);
}

/* Iki akisi BAYT BAYT karsilastirir; hicbirini tumuyle bellege almaz.
   Kismi tampon offsetleriyle ilerler, bu yuzden akislarin chunk sinirlari
   ayni olmak zorunda degildir. */
/* `ozet` verilirse y (KAYNAK) akisindan cekilen her parca hash'e islenir; iki
   akis esit cikarsa hash kaynagin TAMAMINI gormus olur ve .meta'ya yazilabilir
   (esit degilse erken cikilir ve hash eksik kalir - cagiran o zaman kullanmaz).
   Ayri bir okuma turu acmadan sha256 elde etmenin bedelsiz yolu budur. */
async function akislarEsitMi(x, y, ozet = null) {
  const ix = x[Symbol.asyncIterator]();
  const iy = y[Symbol.asyncIterator]();
  let cx = Buffer.alloc(0), cy = Buffer.alloc(0), ox = 0, oy = 0, bx = false, by = false;
  for (;;) {
    if (ox >= cx.length && !bx) { const r = await ix.next(); if (r.done) bx = true; else { cx = r.value; ox = 0; } continue; }
    if (oy >= cy.length && !by) { const r = await iy.next(); if (r.done) by = true; else { cy = r.value; oy = 0; ozet?.update(cy); } continue; }
    const kx = cx.length - ox, ky = cy.length - oy;
    /* Buraya kx===0 ile gelinmesi x'in BITTIGI anlamina gelir (bitmemis olsa
       yukaridaki dal yeni chunk cekerdi). Ikisi birden bittiyse esit. */
    if (kx <= 0 || ky <= 0) return kx <= 0 && ky <= 0;
    const n = Math.min(kx, ky);
    if (cx.compare(cy, oy, oy + n, ox, ox + n) !== 0) return false;
    ox += n; oy += n;
  }
}

/* Varyant GERCEKTEN kaynagin sikistirilmisi mi? AKIS uzerinden dogrulanir:
   bu yoldan heights.bin gibi 60 MB'a kadar acilan dosyalar geciyor ve havuz
   ES tanesini es zamanli isliyor - bellege alan bicim ~1 GB'lik anlik RSS
   demekti. Bozuk/kesik varyantta acici hata verir; hata = ESIT DEGIL.

   ** `varAkis.pipe(acici)` YAZMA. ** Olculdu: pipe() KAYNAK akistaki hataya
   dinleyici koymaz; varyant dosyasi acilamazsa (silinmis/kilitli) ENOENT
   dinleyicisiz 'error' olarak patlar ve BETIGIN TAMAMINI dusurur - dogrulama
   sirasinda tek bir eksik dosya butun uretimi iptal ettirirdi. pipeline()
   zincirin her halkasina hata baglar, hatayi ACICIYA tasir (asagidaki
   asenkron yineleyici throw eder) ve tum akislari destroy eder. Ayni sebeple
   server.js:govdeGonder de pipe()'tan pipeline()'a alinmisti; sizan fd
   Windows'ta rename'i EPERM'e dusuruyor (dosya basindaki WINDOWS TUZAGI). */
async function varyantKaynagaEsitMi(varyantYol, kayYol, tur) {
  const varAkis = fs.createReadStream(varyantYol);
  const acici   = tur === 'br' ? zlib.createBrotliDecompress() : zlib.createGunzip();
  const kayAkis = fs.createReadStream(kayYol);
  const ozet    = crypto.createHash('sha256');
  /* Geri cagirma bos DEGIL, gerekli: erken cikista (esit degil) pipeline
     ERR_STREAM_PREMATURE_CLOSE uretir - onu yutan yer burasi. */
  const cozulen = pipeline(varAkis, acici, () => {});
  try {
    const esit = await akislarEsitMi(cozulen, kayAkis, ozet);
    return { esit, sha: esit ? ozet.digest('hex') : null };
  } catch {
    return { esit: false, sha: null };
  } finally {
    varAkis.destroy(); acici.destroy(); kayAkis.destroy();
  }
}

// ---------------------------------------------------------------- ana akis
sunucuKumesiniDogrula();
const kalkan = manifestKalkani();
const t0 = Date.now();

console.log(`kaynak    : ${CLIENT}`);
console.log(`kalite    : brotli q${BR_KAL}, gzip -${GZ_SEV}, es zamanli ${ES}` +
            `${process.env.UV_THREADPOOL_SIZE ? `, UV_THREADPOOL_SIZE=${process.env.UV_THREADPOOL_SIZE}` : ''}`);
console.log(`kalkan    : ${kalkan.tur === 'manifest'
  ? `manifest (${kalkan.adet} girdi) - manifestteki .gz dosyalari korunur`
  : `TEMKINLI (manifest okunamadi: ${kalkan.sebep}) - assets/ altindaki TUM mevcut .gz korunur`}`);
if (KURU) console.log('MOD       : KURU CALISMA - hicbir dosya yazilmayacak');
console.log('');

// 1) aday listesi
/* `disVaryantlar`: kaynagi VAR ama 2. adima HIC ugramayacak varyantlar -
   kaynagin uzantisi UZANTILAR kumesinde degil (assets/zones/<bolge>/heights.bin.gz
   ve nav.bin.gz, assets/ground/splat/<bolge>.bin.gz) ya da kaynak ASGARI
   esigin altinda (bunlara varyant URETILMEZ - yalnizca dogrulanir). 4. adim
   bunlari dogrular ve mtime penceresini kurar; gerekce oradaki notta. */
const adaylar = [];
const yetimler = [];
const yetimImzalar = [];
const disVaryantlar = [];
for (const f of gez(CLIENT)) {
  /* Imza dosyalari aday DEGIL (uzantisi zaten UZANTILAR'da yok, ama niyet
     acik dursun) - yalnizca YETIM olanlari raporlanir: varyanti elle silinmis
     bir .meta zararsizdir, sunucu ona hic bakmaz. */
  if (f.endsWith(META_UZANTI)) {
    if (!fs.existsSync(f.slice(0, -META_UZANTI.length))) yetimImzalar.push(rel(f));
    continue;
  }
  const varyantTuru = f.endsWith('.br') ? 'br' : (f.endsWith('.gz') ? 'gz' : null);
  if (varyantTuru) {
    const kay = f.slice(0, -3);
    let kSt = null;
    try { kSt = fs.statSync(kay); } catch {}
    if (!kSt || !kSt.isFile()) {
      /* Yetim raporunda .gz icin manifest kalkani gozetilir: kaynagi olmayan
         ama manifestte KENDI URL'i olan .gz bir icerik varligidir, yetim
         degildir. .br'de boyle bir sinif yok. */
      if (varyantTuru === 'br' || !kalkan.korunur(rel(f))) yetimler.push(rel(f));
      continue;
    }
    if (!UZANTILAR.has(path.extname(kay).toLowerCase()) || kSt.size <= ASGARI) {
      disVaryantlar.push({ varyant: f, kay, st: kSt, tur: varyantTuru });
    }
    continue;
  }
  if (f.endsWith('.tmp') || /\.tmp\d+$/.test(f)) continue;
  if (!UZANTILAR.has(path.extname(f).toLowerCase())) continue;
  const st = fs.statSync(f);
  if (!st.isFile() || st.size <= ASGARI) continue;
  adaylar.push({ f, st });
}
adaylar.sort((a, b) => b.st.size - a.st.size);   // buyukler once -> havuz daha iyi dolar

const sayac = { brUretildi: 0, brGuncel: 0, gzUretildi: 0, gzGuncel: 0,
                gzKorundu: 0, gzTazelendi: 0, hata: 0,
                imzaYazildi: 0, imzaAtlandi: 0, imzaEklendi: 0, imzaBeklendi: 0,
                yetimImza: 0 };
let hamBayt = 0, brBayt = 0, gzBayt = 0;
const uyarilar = [];

/* KORUNAN VARYANT - tek karar noktasi (ICERIGE ASLA DOKUNMAZ).
   Iki cagrisan var ve ikisi de ayni sozlesmeyi ister:
     - 2. adim: kaynagi SIKISTIRILIR kumesinde olan manifest .gz varliklari
       (statics.json.gz gibi),
     - 4. adim: kaynagi kume DISINDA kalan varyantlar (heights/nav/splat
       .bin.gz gibi) - bunlar 2. adima hic ugramaz.
   ASLA THROW ETMEZ. Cagrisanlarin ikisi de `havuz()` icinde kosuyor; oradan
   kacan tek bir hata Promise.all'u dusurup TUM uretimi iptal ettirir (yani bir
   dosyanin tarama ile denetim arasinda silinmesi butun betigi vurabilirdi).
   Doner: 'korundu' | 'tazelendi' | 'ortusmuyor' | 'yok'. */
async function korunanVaryantDenetle(varyantYol, varyantRel, kayYol, st, tur) {
  let vSt;
  try { vSt = await fsp.stat(varyantYol); }
  catch (e) {
    uyarilar.push(`varyant okunamadi ${varyantRel}: ${e.code || e.message} ` +
                  `(tarama ile denetim arasinda silinmis olabilir - yapilacak is yok)`);
    return 'yok';
  }
  /* ** IMZA HIZLI YOLU BILEREK YOK. ** Bu fonksiyonun cagrisanlari MANIFEST
     ICERIK VARLIKLARI ve kume disi kardesler; onlarin govdesi her kosumda
     acilip kaynakla BAYT BAYT karsilastirilir ve bu, agacin dogrulugu icin
     elimizdeki tek kanit (kapanis denetiminde 2061/2061 boyle dogrulanmisti).
     .meta'ya bakip dosyayi acmadan "guncel" demek hizli olurdu ama o kaniti
     kaybederdik - imza kaynagin degisip degismedigini soyler, VARYANTIN
     bozulup bozulmadigini SOYLEMEZ. */
  const oncekiMeta = await metaOku(varyantYol);
  const { esit, sha } = await varyantKaynagaEsitMi(varyantYol, kayYol, tur);

  if (esit) {
    /* Icerik DOGRU. Iki sey garanti edilir: (1) mtime penceresi (MIRAS kural
       icin - imzasiz eski sunucular ve .meta okunamayan durumlar), (2) .meta
       imzasi (YENI kural icin). Bayt dizisine DOKUNULMAZ, dolayisiyla manifest
       sha256'si DEGISMEZ. */
    const imzaGerek = !metaUyuyor(oncekiMeta, st, vSt);
    const mtimeGerek = vSt.mtimeMs < st.mtimeMs;
    if (!imzaGerek && !mtimeGerek) return 'korundu';
    if (!KURU) {
      if (mtimeGerek) {
        const t = new Date(st.mtimeMs + 1000);
        try { await fsp.utimes(varyantYol, t, t); }
        catch (e) { sayac.hata++; uyarilar.push(`mtime tazelenemedi ${varyantRel}: ${e.code || e.message}`); }
      }
      /* Imza VARYANTIN kimligini de tasidigi icin mtime'a dokunulan her turda
         yeniden yazilmali - yoksa imza kendi varyantini tanimaz hale gelir ve
         sunucu onu "imzalandiktan sonra degismis" diye reddederdi. */
      if (imzaGerek || mtimeGerek) {
        if (!oncekiMeta) sayac.imzaEklendi++;
        await metaYaz(varyantYol, kayYol, st, { sha, uretim: `dogrulandi (${tur})` });
      }
    }
    return 'tazelendi';
  }

  /* Icerik kaynakla ORTUSMUYOR (kaynak degismis ya da varyant baska bir
     temsili tasiyor). Ezmek YASAK (manifest varligi olabilir) - bu yuzden
     varyant HEM imzasiz birakilir HEM de kaynaktan ESKI gosterilir; server.js
     iki kurala gore de onu yok sayar ve anlik sikistirmaya duser. Dogru govde
     her halukarda gider. */
  if (!KURU) {
    await metaSil(varyantYol);
    const t = new Date(Math.max(0, st.mtimeMs - 2000));
    try { await fsp.utimes(varyantYol, t, t); } catch {}
  }
  uyarilar.push(`${varyantRel}: kaynakla ORTUSMUYOR -> varyant devre disi birakildi ` +
                `(icerige dokunulmadi). Bu dosya manifest varligi olabilir; yeniden uretmek ` +
                `manifest sha256'sini degistirir - once manifest_denetle.mjs ile bak.`);
  return 'ortusmuyor';
}

/* URETILEN VARYANT (bizim <ad>.br / <ad>.gz) - tek karar noktasi.
   SIRA:
     1) .meta kaynagin BUGUNKU imzasiyla birebir uyusuyor ve mtime penceresi
        de duruyorsa -> GUNCEL; dosya hic acilmaz (eski davranisin hizi).
     2) Imza yok/uymuyor ama varyantin ICERIGI kaynakla ayni cikiyorsa ->
        YENIDEN SIKISTIRMA YOK; yalniz mtime penceresi + imza kurulur.
        Bu iki durumu ucuzlatir: (a) imza dosyalarinin ILK kez eklendigi gecis
        kosumu, (b) icerigi degismeden `touch`lanmis kaynak. Aksi halde entry
        paketi bosuna 35 sn'lik brotli q11'e girerdi.
     3) Aksi halde yeniden uretilir + imza yazilir.
   Doner {durum: 'guncel'|'uretildi'|'hata', boyut}. */
async function uretilenVaryant(kayYol, st, tur, sikistir, oku) {
  const varyantYol = kayYol + (tur === 'br' ? '.br' : '.gz');
  const vRel = rel(varyantYol);
  let vSt = null;
  try { vSt = await fsp.stat(varyantYol); } catch {}

  if (vSt && !ZORLA) {
    const meta = await metaOku(varyantYol);
    if (metaUyuyor(meta, st, vSt) && vSt.mtimeMs >= st.mtimeMs) return { durum: 'guncel', boyut: vSt.size };
    const { esit, sha } = await varyantKaynagaEsitMi(varyantYol, kayYol, tur);
    if (esit) {
      if (!KURU) {
        if (vSt.mtimeMs < st.mtimeMs) {
          const t = new Date(st.mtimeMs + 1000);
          try { await fsp.utimes(varyantYol, t, t); }
          catch (e) { sayac.hata++; uyarilar.push(`mtime tazelenemedi ${vRel}: ${e.code || e.message}`); }
        }
        if (!meta) sayac.imzaEklendi++;
        await metaYaz(varyantYol, kayYol, st, { sha, uretim: `dogrulandi (${tur})` });
      }
      return { durum: 'guncel', boyut: vSt.size };
    }
  }

  const ham = await oku();
  const veri = await sikistir(ham);
  if (KURU) return { durum: 'uretildi', boyut: veri.length };
  try {
    await atomikYaz(varyantYol, veri, st.mtimeMs);
  } catch (e) {
    sayac.hata++;
    uyarilar.push(`.${tur} yazilamadi ${rel(kayYol)}: ${e.code || e.message}`);
    /* YAZILAMADI (Windows'ta EPERM - dosya basindaki handle sizintisi notu).
       Diskteki ESKI govde yerinde kaldi. Kor kor devre disi BIRAKMIYORUZ:
       --zorla ile gelindiginde govde pekala hala DOGRU olabilir (o dalda
       esitlik hic sinanmamisti) ve onu disari atmak, tam da en buyuk dosyada
       on-sikistirmayi bosuna kaybettirirdi. Bu yuzden yalnizca burada, hata
       yolunda, govde bir kez dogrulanir:
         esit  -> dokunma; mtime penceresi + imza tazelenir, dosya calismaya
                  devam eder (eski davranisla ayni ama artik IMZALI),
         degil -> IKI kural birden kapatilir (imza silinir + mtime geriye
                  alinir), sunucu anlik sikistirmaya duser: yavas ama DOGRU. */
    const { esit: hataEsit, sha: hataSha } = await varyantKaynagaEsitMi(varyantYol, kayYol, tur);
    if (hataEsit) {
      const t = new Date(st.mtimeMs + 1000);
      try { await fsp.utimes(varyantYol, t, t); } catch { /* kilitli olabilir */ }
      await metaYaz(varyantYol, kayYol, st, { sha: hataSha, uretim: `dogrulandi (${tur}, yazim hatasindan sonra)` });
      uyarilar.push(`${vRel}: yazilamadi ama diskteki govde kaynakla BIREBIR - varyant korundu`);
    } else {
      await metaSil(varyantYol);
      const g = new Date(Math.max(0, st.mtimeMs - 2000));
      try { await fsp.utimes(varyantYol, g, g); } catch { /* dosya kilitli olabilir */ }
      uyarilar.push(`${vRel}: yazilamadi VE diskteki govde bayat -> varyant devre disi birakildi`);
    }
    return { durum: 'hata', boyut: veri.length };
  }
  await metaYaz(varyantYol, kayYol, st, {
    sha: crypto.createHash('sha256').update(ham).digest('hex'),
    uretim: tur === 'br' ? `brotli q${BR_KAL}` : `gzip -${GZ_SEV}`,
  });
  return { durum: 'uretildi', boyut: veri.length };
}

// 2) kardes varyantlar
const isler = [];
for (const { f, st } of adaylar) {
  hamBayt += st.size;
  isler.push(async () => {
    let ham = null;
    const oku = async () => (ham ??= await fsp.readFile(f));

    // --- .br  (bizim urettigimiz varyant; serbestce yenilenebilir)
    const br = await uretilenVaryant(f, st, 'br', (b) => brotliSikistir(b, { params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: BR_KAL,
      [zlib.constants.BROTLI_PARAM_SIZE_HINT]: st.size } }), oku);
    brBayt += br.boyut;
    if (br.durum === 'guncel') sayac.brGuncel++;
    else if (br.durum === 'uretildi') sayac.brUretildi++;

    // --- .gz  (KORUNUYORSA icerige DOKUNMA - yalniz dogrula/tazele)
    const gzYol = f + '.gz';
    const gzRel = rel(gzYol);
    let gzSt = null;
    try { gzSt = await fsp.stat(gzYol); } catch {}

    if (gzSt && kalkan.korunur(gzRel)) {
      gzBayt += gzSt.size;
      const durum = await korunanVaryantDenetle(gzYol, gzRel, f, st, 'gz');
      if (durum === 'tazelendi') sayac.gzTazelendi++;
      else if (durum !== 'yok') sayac.gzKorundu++;
      return;
    }

    const gz = await uretilenVaryant(f, st, 'gz', (b) => gzipSikistir(b, { level: GZ_SEV }), oku);
    gzBayt += gz.boyut;
    if (gz.durum === 'guncel') sayac.gzGuncel++;
    else if (gz.durum === 'uretildi') sayac.gzUretildi++;
  });
}
await havuz(isler, ES);

// 3) MADDE 10 - env.bin.gz (her bolge girisinde 1 adet 404 yoklamasi kalksin)
/* Istemcinin t8() yukleyicisi once `${url}.gz` deniyor: heights/nav/statics
   icin .gz VAR (200), env.bin icin YOKTU -> her bolge girisinde bir 404
   (olculdu: 2.2 ms). Bu .gz bir Content-Encoding varyanti DEGIL, istemcinin
   DecompressionStream ile kendi actigi ham icerik - bu yuzden .bin uzantisi
   SIKISTIRILIR kumesinde olmadigi halde uretilir ve sunucu onu
   'application/gzip' olarak ham gonderir.
   mtime=0 ile deterministik: ayni girdi her calistirmada ayni bayt dizisi. */
const zonKok = path.join(CLIENT, 'assets', 'zones');
const envler = [];
if (fs.existsSync(zonKok)) {
  for (const bolge of fs.readdirSync(zonKok, { withFileTypes: true })) {
    if (!bolge.isDirectory()) continue;
    const kay = path.join(zonKok, bolge.name, 'env.bin');
    if (!fs.existsSync(kay)) continue;
    const hedef = kay + '.gz';
    const st = fs.statSync(kay);
    const hRel = rel(hedef);
    let hSt = null;
    try { hSt = fs.statSync(hedef); } catch { /* henuz yok */ }
    if (hSt && kalkan.korunur(hRel)) { envler.push(`${hRel} KORUNDU (manifest varligi)`); continue; }
    /* Tazelik olcutu 2. adimla AYNI: once imza (tam esitlik - VARYANT kimligi
       dahil), sonra mtime penceresi. Bu dosyanin kaynagi (.bin) SIKISTIRILIR
       kumesinde olmadigi icin sunucu kapisi ona hic bakmaz - yine de olcut tek
       tutuluyor ki ileride kume degisirse burasi geride kalmasin. */
    if (hSt && !ZORLA && metaUyuyor(await metaOku(hedef), st, hSt) && hSt.mtimeMs >= st.mtimeMs) {
      envler.push(`${hRel} guncel (${hSt.size} bayt)`); continue;
    }
    const hamEnv = fs.readFileSync(kay);
    const veri = zlib.gzipSync(hamEnv, { level: 9, mtime: 0 });
    if (!KURU) {
      try { await atomikYaz(hedef, veri, st.mtimeMs); }
      catch (e) { sayac.hata++; uyarilar.push(`env.bin.gz yazilamadi ${hRel}: ${e.code || e.message}`); await metaSil(hedef); continue; }
      await metaYaz(hedef, kay, st, {
        sha: crypto.createHash('sha256').update(hamEnv).digest('hex'), uretim: 'gzip -9 (env.bin)' });
    }
    envler.push(`${hRel} URETILDI  ${st.size} -> ${veri.length} bayt`);
  }
}

// 4) SIKISTIRILIR KUMESI DISINDAKI VARYANTLAR - dogrula + mtime penceresini kur
/* KOK NEDEN (bu adim yokken): 2. adim yalnizca UZANTILAR kumesindeki
   KAYNAKLARI geziyordu. assets/zones/<bolge>/heights.bin.gz + nav.bin.gz ve
   assets/ground/splat/<bolge>.bin.gz dosyalarinin kaynagi .bin oldugu icin
   bunlar betigin HICBIR adimina ugramiyor, dolayisiyla 3. kurala (mtime
   penceresi) hic tabi olmuyordu. Olculdu: 22'sinin mtime'i kaynagindan
   0.34-4.11 sn ESKIYDI. Ayni klasordeki statics.json.gz'ler ise kaynagi .json
   oldugu icin 2. adimdan gecip tazeleniyordu - fark tam olarak buydu.

   Bugun bu 22 dosya sunucuda BAYAT SAYILMIYOR, cunku '.bin' SIKISTIRILIR
   kumesinde degil: pazarlik hic devreye girmiyor ve istemci onlari zaten
   `${url}.gz` olarak DOGRUDAN cekip DecompressionStream ile aciyor. Yani bu
   adim bugunku bir arizayi degil, SESSIZ bir tuzagi kapatir: '.bin' ileride
   kumeye alinirsa bu dosyalar tek satir uyari vermeden anlik sikistirmaya
   duserdi - ustelik 60 MB'a kadar acilan govdelerle, yani en pahali yerde.

   URETMEZ, EZMEZ: kume disi bir kaynak icin varyant OLUSTURULMAZ (1. kural);
   yalnizca MEVCUT varyant dogrulanir ve zaman damgasi duzeltilir. */
const disSayac = { korundu: 0, tazelendi: 0, ortusmeyen: 0 };
if (disVaryantlar.length) {
  await havuz(disVaryantlar.map(({ varyant, kay, st, tur }) => async () => {
    const durum = await korunanVaryantDenetle(varyant, rel(varyant), kay, st, tur);
    if (durum === 'korundu') disSayac.korundu++;
    else if (durum === 'tazelendi') disSayac.tazelendi++;
    else if (durum === 'ortusmuyor') disSayac.ortusmeyen++;
    // 'yok': dosya kaybolmus - uyari zaten basildi, sayilacak bir sey kalmadi
  }), ES);
}

// ---------------------------------------------------------------- rapor
const sn = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`kardes varyantlar (${adaylar.length} kaynak dosya, ${mb(hamBayt)} MB ham):`);
console.log(`  .br : ${sayac.brUretildi} uretildi, ${sayac.brGuncel} zaten guncel   -> ${mb(brBayt)} MB` +
            `  (%${hamBayt ? (100 - brBayt / hamBayt * 100).toFixed(1) : 0} kazanc)`);
console.log(`  .gz : ${sayac.gzUretildi} uretildi, ${sayac.gzGuncel} zaten guncel,  -> ${mb(gzBayt)} MB` +
            `  (%${hamBayt ? (100 - gzBayt / hamBayt * 100).toFixed(1) : 0} kazanc)`);
console.log(`        ${sayac.gzKorundu} manifest varligi korundu, ${sayac.gzTazelendi} mtime tazelendi (icerik ayni)`);
if (disVaryantlar.length) {
  console.log(`\nkume disi varyantlar (${disVaryantlar.length} adet - kaynagi SIKISTIRILIR disinda` +
              ` ya da <= ${ASGARI} bayt; URETILMEZ, yalnizca dogrulanir):`);
  console.log(`  ${disSayac.korundu} zaten guncel, ${disSayac.tazelendi} mtime tazelendi (icerik ayni), ` +
              `${disSayac.ortusmeyen} ORTUSMEYEN -> devre disi`);
}
if (envler.length) { console.log('\nMADDE 10 - env.bin.gz:'); for (const s of envler) console.log('  ' + s); }
console.log(`\nvaryant imzasi (${META_UZANTI} s${META_SURUM}, tazelik olcutu): ${sayac.imzaYazildi} yazildi` +
            `${sayac.imzaEklendi ? ` (${sayac.imzaEklendi} varyanta ILK kez eklendi)` : ''}` +
            `${sayac.imzaAtlandi ? `, ${sayac.imzaAtlandi} ATLANDI - kanit tutmadi (UYARILAR'a bak)` : ''}` +
            `${sayac.imzaBeklendi ? `, ${sayac.imzaBeklendi} kez mtime tik'i icin beklendi` : ''}`);
if (yetimler.length) {
  console.log(`\nYETIM varyant (kaynagi yok, ${yetimler.length} adet) - zararsiz, elle silinebilir:`);
  for (const y of yetimler.slice(0, 12)) console.log('  ' + y);
  if (yetimler.length > 12) console.log(`  ... +${yetimler.length - 12}`);
}
if (yetimImzalar.length) {
  console.log(`\nYETIM imza (varyanti yok, ${yetimImzalar.length} adet) - zararsiz, elle silinebilir:`);
  for (const y of yetimImzalar.slice(0, 12)) console.log('  ' + y);
  if (yetimImzalar.length > 12) console.log(`  ... +${yetimImzalar.length - 12}`);
}
if (uyarilar.length) { console.log('\nUYARILAR:'); for (const u of uyarilar) console.log('  ! ' + u); }
console.log(`\nsure ${sn} sn${sayac.hata ? `  -  ${sayac.hata} HATA` : ''}` +
            `${sayac.imzaAtlandi ? `  -  ${sayac.imzaAtlandi} IMZASIZ VARYANT (devre disi)` : ''}`);
console.log('NOT: istemci paketi (client/app/index-*.js) her yamalandiginda bu betigi TEKRAR calistir.');
/* IMZA ATLAMA DA CIKIS KODUNU 1 YAPAR. Atlanan her imza, kaniti tutmadigi icin
   DEVRE DISI birakilmis bir varyant demektir: dogruluk korunur ama olculmus
   5.2x'lik kazanc o dosyada sessizce kaybolur ve agac istenen durumda DEGILDIR.
   Cagiran `node gen_sikistir.mjs && ...` yazdiginda bunu gormeli - zaten dosya
   basinda `| tail` ile kosmaya karsi uyari var. */
if (sayac.hata || sayac.imzaAtlandi) process.exitCode = 1;
