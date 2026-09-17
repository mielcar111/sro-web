/**
 * GM PANELI - ITEM MALL EDITORU (sunucu tarafi)
 *
 * Katalog IKI kopya halinde yasiyor ve ikisi AYNI istekte yazilmak zorunda:
 *   1) server/data/items.json -> itemMall   TAHSILAT kopyasi:
 *      sistem_kucuk-sistemler.js kur() MALL_FIYAT/MALL_ADET'i buradan doldurur
 *      (:388-409) ve mall.buy (119) buradan keser (mallAl :2125-2172).
 *   2) istemci paketi client/app/index-*.js -> gomulu `vct` literali
 *      GORUNUM kopyasi: mall penceresi fiyati buradan cizer ve satin-al
 *      butonunun bakiye kontrolu gomulu fiyatla yapilir
 *      (n.jadeUnits >= g.jade*100). Ayri item-mall.json dosyasi YOKTUR.
 * Ayrik yazim fiyat ayrismasi yaratir: oyuncu ekranda baska, kasada baska
 * fiyat gorur. kaydet() bu yuzden ikisini tek islemde yazar ve EN SONDA
 * canliTazele (server.js sistemleriKur(true)) ile sunucu tarafini RESTARTSIZ
 * tazeler - admin.js ayar kaydetme akisiyla ayni kalip (server.js:414).
 *
 * PAKET YAMASI DESEN-TABANLIDIR, SABIT OFSET YOKTUR: 'vct={' ... ',yct={'
 * anchor'lari her kosumda yeniden aranir ve her biri TAM 1 kez eslesmezse
 * pakete DOKUNULMAZ. Ayni pakete baska yamalar da uygulanabiliyor (ornek:
 * unique-timer bayt-korumali yamalari) - ofsetler kayabilir, desen kaymaz.
 * ',yct={' blogu ve sonrasi asla yazilmaz (sartname dokunulmayacaklar).
 *
 * DOGRULAMA NIYE BU KADAR SIKI: gomulu katalog bozulursa istemci acilista
 * 'invalid game data' firlatir (nY dogrulayicisi) ve oyun TUM oyuncular icin
 * acilmaz olur. Istemci dogrulayicisinin sinif esdegerleri (vlt/Sst):
 * 'unknown item', 'is gear', 'listed more than once' - hepsi burada kapida
 * durdurulur ki hatali katalog diske hic inmesin.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BURASI = path.dirname(fileURLToPath(import.meta.url));

/* Ekipman tipleri - sistem_kucuk-sistemler.js:268 EKIPMAN_TIPI ile birebir.
   mallAl zaten ayni kumeyle reddediyor (:2134); editor kapida durdurur ki
   ekipmanli katalog diske hic yazilmasin (istemci vlt 'is gear' esdegeri). */
const GEAR_TIPLERI = new Set(['weapon', 'shield', 'armor', 'accessory']);
const ITEMID_DESEN = /^[a-zA-Z0-9_]+$/;
const JADE_MIN = 1;
const JADE_MAX = 10_000_000;
/* Canta en fazla 384 yuva (CANTA-12: 12 sayfa x 32, sistem_banka-depo.js
   CANTA_MAX_YUVA). Tek kalemde bundan fazla yigin yuvasi isteyen qty hicbir
   satin almada teslim edilemez - sacma girdiyi kapida kes. */
const CANTA_TAVANI = 384;
/* Cokme artigi kilit sonsuza dek 409 dondurmesin diye eskime esigi. */
const KILIT_ESKIME_MS = 120_000;

const derinEsit = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const zamanEtiketi = () => new Date().toISOString().replace(/[:.]/g, '-');

/** node --check: temp dosya .mjs uzantili verilir ki ESM olarak ayristirilsin. */
function nodeCheck(dosya) {
  return new Promise((cozul) => {
    execFile(process.execPath, ['--check', dosya], { windowsHide: true },
      (err, _out, stderr) => {
        cozul(err ? { ok: false, hata: String(stderr || err.message).slice(0, 400) } : { ok: true });
      });
  });
}

/**
 * Windows'ta rename = MoveFileEx REPLACE_EXISTING; hedefi o anda stream eden
 * eski HTTP cevaplari eski inode'dan tamamlanir. Antivirus kisa sureli EPERM
 * verebiliyor - bir kez kisa bekleyip tekrar denenir.
 */
async function yenidenAdlandir(kaynak, hedef) {
  try { await fsp.rename(kaynak, hedef); }
  catch (e) {
    if (e.code !== 'EPERM' && e.code !== 'EACCES') throw e;
    await new Promise(r => setTimeout(r, 200));
    await fsp.rename(kaynak, hedef);
  }
}

/**
 * vct anchor'larini bulur - her desen TAM 1 kez eslesmek zorunda
 * (0 ya da >1 eslesme = DUR, dosyaya dokunma).
 */
function anchorBul(buf) {
  const bA = Buffer.from('vct={'), eA = Buffer.from(',yct={');
  const b = buf.indexOf(bA);
  if (b < 0 || buf.indexOf(bA, b + 1) !== -1) {
    throw new Error("'vct={' deseni pakette tam 1 kez eslesmedi - pakete dokunulmadi");
  }
  const e = buf.indexOf(eA);
  if (e < 0 || buf.indexOf(eA, e + 1) !== -1) {
    throw new Error("',yct={' deseni pakette tam 1 kez eslesmedi - pakete dokunulmadi");
  }
  if (e <= b) throw new Error('vct/yct anchor sirasi beklenmedik - pakete dokunulmadi');
  return { b, e };
}

/**
 * Ilk yamadan ONCEKI (Vite cikisi) gomulu bicimin cozumu:
 *   {$comment:`...`,tabs:[{name:`X`,items:[{itemId:`y`,jade:N},...]},...]}
 * AMAC yalnizca "gomulu veri amaclanan katalogla AYNI MI" sorusuna cevap
 * vermek (degisiklik yoksa 20MB paketi bosuna yeniden yazmayalim). Birebir
 * yeniden-uretimle dogrulanamayan her girdi null doner = "farkli" sayilir;
 * yanlis-pozitif ESITLIK bu kurgu ile imkansizdir.
 */
function backtickCoz(blok) {
  const bas = '{$comment:`';
  if (!blok.startsWith(bas)) return null;
  const ayrac = blok.indexOf('`,tabs:[');
  if (ayrac < 0) return null;
  const yorum = blok.slice(bas.length, ayrac);
  if (yorum.includes('\\') || yorum.includes('`')) return null; // kacisli yorum cozulmez
  const kuyruk = blok.slice(ayrac + 1);
  if (!kuyruk.startsWith(',tabs:[') || !kuyruk.endsWith(']}')) return null;
  const govde = kuyruk.slice(',tabs:['.length, -2);
  const tabs = [];
  const tabRe = /\{name:`([^`\\]*)`,items:\[([^\]]*)\]\}/g;
  let m;
  while ((m = tabRe.exec(govde))) {
    const items = [];
    if (m[2]) {
      const itRe = /\{itemId:`([^`\\]*)`,jade:(\d+)\}/g;
      let im;
      while ((im = itRe.exec(m[2]))) items.push({ itemId: im[1], jade: Number(im[2]) });
    }
    tabs.push({ name: m[1], items });
  }
  /* birebir yeniden-uretim sarti: cozulen veriden ayni minified metin geri
     uretilemiyorsa cozum guvenilmezdir. */
  const geri = tabs.map(t =>
    '{name:`' + t.name + '`,items:['
    + t.items.map(i => '{itemId:`' + i.itemId + '`,jade:' + i.jade + '}').join(',')
    + ']}').join(',');
  if (geri !== govde) return null;
  return { $comment: yorum, tabs };
}

/** Paketteki gomulu vct verisi (JSON ya da ilk-yama-oncesi backtick bicimi). */
function gomuluOku(buf) {
  let b, e;
  try { ({ b, e } = anchorBul(buf)); } catch { return null; }
  const blok = buf.toString('utf8', b + 4, e);
  if (blok.startsWith('{"')) {
    try { return JSON.parse(blok); } catch { return null; }
  }
  return backtickCoz(blok);
}

/** items.json itemMall.tabs'i kaydet() cikti bicimiyle ayni sekle indirger. */
function tabsNormallestir(tabs) {
  return (tabs ?? []).map(t => ({
    name: String(t?.name ?? ''),
    items: (t?.items ?? []).map(s => {
      const kayit = { itemId: String(s?.itemId ?? ''), jade: Number(s?.jade) };
      const q = Number(s?.qty);
      if (Number.isSafeInteger(q) && q > 1) kayit.qty = q;
      return kayit;
    }),
  }));
}

/* ==================================================================== FABRIKA */
export function createMallPaneli({ dataDir, clientDir, yedekDir, log, canliTazele } = {}) {
  const VERI = dataDir ?? path.join(BURASI, 'data');
  const CLIENT = clientDir ?? path.resolve(BURASI, '..', 'client');
  /* Buyuk paket yedegi YEDEK/ altina gider - client/ halka acik servis
     edildigi icin .bak kopyalari oraya birakilmaz. */
  const YEDEK = yedekDir ?? path.resolve(BURASI, '..', '..', 'YEDEK');
  const itemsYolu = path.join(VERI, 'items.json');
  const kilitYolu = path.join(VERI, '.mall.lock');

  /** Aktif paket index.html'den TEKIL cozulur - ad sabitlenmez. */
  async function aktifPaket() {
    const html = await fsp.readFile(path.join(CLIENT, 'index.html'), 'utf8');
    const adlar = [...new Set([...html.matchAll(/app\/(index-[A-Za-z0-9_-]+\.js)/g)].map(x => x[1]))];
    if (adlar.length !== 1) {
      throw new Error(`aktif paket index.html'den tekil cozulemedi (${adlar.length} aday: ${adlar.join(', ')})`);
    }
    return path.join(CLIENT, 'app', adlar[0]);
  }

  /* ------------------------------------------------------------------ kilit
   * (madde 4) .mall.lock varken ikinci POST 409 alir; yazimlar bitmeden
   * sistemleriKur cagrilmaz (akis sirasi kaydet() icinde). 'wx' bayragi
   * olusturmayi atomik yapar. */
  function kilitAl() {
    const govde = JSON.stringify({ pid: process.pid, at: Date.now() });
    try { fs.writeFileSync(kilitYolu, govde, { flag: 'wx' }); return true; }
    catch (e) {
      if (e.code !== 'EEXIST') return false;
      try {
        /* cokme artigi bayat kilit: temizlenmezse uc sonsuza dek 409 doner. */
        if (Date.now() - fs.statSync(kilitYolu).mtimeMs > KILIT_ESKIME_MS) {
          fs.unlinkSync(kilitYolu);
          fs.writeFileSync(kilitYolu, govde, { flag: 'wx' });
          return true;
        }
      } catch { /* yarista kaybedildi */ }
      return false;
    }
  }
  function kilitBirak() { try { fs.unlinkSync(kilitYolu); } catch { /* zaten yok */ } }

  /* -------------------------------------------------------------- dogrulama
   * Sartname madde 1 (a)-(g). Istemci dogrulayicisiyla (vlt+Sst) birebir:
   * hatali gomulu katalog oyunu TUM oyuncular icin acilmaz yapar. Bilinmeyen
   * alanlar sessizce atilir - katalog dosyasina cop yazilmaz. */
  function dogrula(tabs, katalog, paketBuf) {
    const hatalar = [];
    /* (a) tabs >= 1; bos items[] serbest ('Premiums' emsali - istemci o
       sekmede items'i zaten yok sayip premium katmanini cizer). */
    if (!Array.isArray(tabs) || tabs.length < 1) {
      return { hatalar: ['tabs: en az 1 sekme gerekli'] };
    }
    const gorulen = new Set();   // (e) TUM sekmeler genelinde TEK kume
    const sunucu = [], istemci = [];
    tabs.forEach((tab, ti) => {
      const ad = typeof tab?.name === 'string' ? tab.name : '';
      const konum = `sekme ${ti + 1}${ad ? ` (${ad})` : ''}`;
      if (!ad.trim()) hatalar.push(`${konum}: name en az 1 karakter olmali`);
      /* (f) vct sablon-literal enjeksiyon kapisi: backtick / ${ / ters bolu /
         kontrol karakteri sekme adina giremez. JSON.stringify zaten kacirir
         ama gomulu literal ileride elle de duzenlenebilir - kapi API'de durur. */
      if (/[`\\]|\$\{|[\u0000-\u001f\u007f]/.test(ad)) {
        hatalar.push(`${konum}: sekme adinda backtick, \${, ters bolu ve kontrol karakteri yasak`);
      }
      if (!Array.isArray(tab?.items)) {
        hatalar.push(`${konum}: items dizi olmali (bos dizi serbest)`);
        return;
      }
      const sSatir = [], iSatir = [];
      tab.items.forEach((s, si) => {
        const yer = `${konum}, kalem ${si + 1}`;
        const id = typeof s?.itemId === 'string' ? s.itemId : '';
        /* (b) bicim + katalog + paket varligi */
        if (!ITEMID_DESEN.test(id)) { hatalar.push(`${yer}: itemId ^[a-zA-Z0-9_]+$ kalibina uymali`); return; }
        if (gorulen.has(id)) { hatalar.push(`${yer}: ${id} birden fazla listelendi (tum sekmeler genelinde tekil olmali)`); return; }
        gorulen.add(id);
        const def = katalog.get(id);
        if (!def) { hatalar.push(`${yer}: ${id} data/items.json .items icinde yok`); return; }
        /* (c) ekipman yasak */
        if (GEAR_TIPLERI.has(def.type)) {
          hatalar.push(`${yer}: ${id} ekipman (${def.type}) - mall'a giremez (mall teslimi instance stat atmaz)`);
          return;
        }
        /* (b devam) aktif paket BAYTLARINDA sabit-dize arama - jct/fct gibi
           degisken adlarina ASLA baglanma (minifier her derlemede degistirir). */
        if (!paketBuf.includes(`"id":"${id}"`) && !paketBuf.includes('id:`' + id + '`')) {
          hatalar.push(`${yer}: ${id} aktif istemci paketinde bulunamadi - istemci bu kalemi cizemez`);
          return;
        }
        /* (d) jade siniri */
        const jade = s?.jade;
        if (!Number.isSafeInteger(jade) || jade < JADE_MIN || jade > JADE_MAX) {
          hatalar.push(`${yer}: jade ${JADE_MIN}..${JADE_MAX} arasi tam sayi olmali`);
          return;
        }
        const kayit = { itemId: id, jade };
        /* (g) qty YALNIZ sunucu dosyasina yazilir (istemci kopyasindan
           STRIPLENIR - istemci Zod'u alani zaten atar, UI'da xN rozeti yok)
           ve yalniz stackMax>1 tuketilebilirlere verilebilir. */
        const q = s?.qty;
        if (q !== undefined && q !== null && q !== 1) {
          const stackMax = Number(def.stackMax) || 1;
          if (!Number.isSafeInteger(q) || q < 1) { hatalar.push(`${yer}: qty pozitif tam sayi olmali`); return; }
          if (stackMax <= 1) { hatalar.push(`${yer}: qty yalniz stackMax>1 tuketilebilirlere verilebilir (${id} stackMax=${stackMax})`); return; }
          if (Math.ceil(q / stackMax) > CANTA_TAVANI) { hatalar.push(`${yer}: qty=${q} tek satin almada ${CANTA_TAVANI} canta yuvasina sigmaz`); return; }
          kayit.qty = q;
        }
        sSatir.push(kayit);
        iSatir.push({ itemId: id, jade });
      });
      sunucu.push({ name: ad, items: sSatir });
      istemci.push({ name: ad, items: iSatir });
    });
    return hatalar.length ? { hatalar } : { sunucu, istemci };
  }

  /* --------------------------------------------------------- items.json yazimi
   * data/items.json birebir JSON.stringify(o, null, 1) bicimindedir (olculdu:
   * ayni cagri dosyayi bayt-bayt yeniden uretiyor; admin.js de ayni bicimle
   * yazar). Boylece .items dizisi dahil itemMall DISINDAKI her sey
   * bayt-degismez kalir - editor YALNIZ itemMall'i degistirir. */
  async function itemsYaz(veri) {
    const temp = itemsYolu + '.mall-tmp';
    await fsp.writeFile(temp, JSON.stringify(veri, null, 1));
    JSON.parse(await fsp.readFile(temp, 'utf8'));   // yazim butunlugu testi
    const yedek = itemsYolu + '.bak-' + zamanEtiketi();
    await fsp.copyFile(itemsYolu, yedek);
    try { await yenidenAdlandir(temp, itemsYolu); }
    catch (e) { try { await fsp.unlink(temp); } catch { /* temizlik */ } throw e; }
    return yedek;
  }

  /* ------------------------------------------------------------ paket yamasi
   * (madde 2) Akis: desenle bul -> JSON.stringify splice -> temp'e yaz ->
   * node --check (ESM) -> temp'ten vct'yi GERI CIKAR ve amaclananla derin
   * karsilastir -> eskiyi YEDEK/'e kopyala -> atomik rename. $comment ILK
   * anahtar kalir (metin-anchor gelecegi icin); itemId'ler (f) suzgecinden
   * gectigi icin sablon-literal guvenlidir. */
  async function paketYamala(paketYolu, yorum, tabs) {
    const buf = await fsp.readFile(paketYolu);
    const { b, e } = anchorBul(buf);
    const amac = { $comment: yorum, tabs };
    const yeni = Buffer.concat([
      buf.subarray(0, b),
      Buffer.from('vct=' + JSON.stringify(amac)),
      buf.subarray(e),
    ]);
    const temp = paketYolu + '.mall-tmp.mjs';   // .mjs: --check ESM ayristirsin
    await fsp.writeFile(temp, yeni);
    try {
      const nc = await nodeCheck(temp);
      if (!nc.ok) throw new Error(`yamali paket node --check gecemedi: ${nc.hata}`);
      /* geri-cikarim: diskteki temp'ten yeniden oku (yazim butunlugu dahil). */
      const t2 = await fsp.readFile(temp);
      const g2 = anchorBul(t2);
      if (!derinEsit(JSON.parse(t2.toString('utf8', g2.b + 4, g2.e)), amac)) {
        throw new Error('geri-cikarim derin karsilastirmasi tutmadi - paket degistirilmedi');
      }
      await fsp.mkdir(YEDEK, { recursive: true });
      const yedek = path.join(YEDEK, path.basename(paketYolu) + '.bak-' + zamanEtiketi());
      await fsp.copyFile(paketYolu, yedek);
      await yenidenAdlandir(temp, paketYolu);
      log?.(`[mall] paket yamalandi: ${path.basename(paketYolu)} (yedek: ${path.basename(yedek)})`);
    } catch (e2) {
      try { await fsp.unlink(temp); } catch { /* temizlik */ }
      throw e2;
    }
  }

  /* ================================================================ DIS YUZ */
  return {
    /** GET /api/v1/admin/mall - itemMall + kalem basina {ad, ikon, type}. */
    async listele() {
      let dosya;
      try { dosya = JSON.parse(await fsp.readFile(itemsYolu, 'utf8')); }
      catch (e) { return { hata: `items.json okunamadi: ${e.message}` }; }
      const katalog = new Map();
      for (const it of dosya.items ?? []) if (it?.id) katalog.set(it.id, it);
      const zengin = (s) => {
        const def = katalog.get(s?.itemId) ?? null;
        const q = Number(s?.qty);
        return {
          itemId: s?.itemId ?? null,
          jade: Number(s?.jade),
          ...(Number.isSafeInteger(q) && q > 1 ? { qty: q } : {}),
          ad: def?.name ?? s?.itemId ?? null,
          /* ikon onceligi admin_karakter.esyaOzet ile ayni mantik (cinsiyetsiz). */
          ikon: def?.icon ?? def?.visuals?.male?.icon ?? def?.visuals?.female?.icon ?? null,
          type: def?.type ?? null,
          stackMax: def?.stackMax ?? 1,
          katalogda: !!def,
        };
      };
      return {
        $comment: dosya.itemMall?.$comment ?? null,
        tabs: (dosya.itemMall?.tabs ?? []).map(t => ({
          name: t?.name ?? '',
          items: (t?.items ?? []).map(zengin),
        })),
        /* Panelin kural kutulari icin - liste UYDURULMAZ, sunucu kapisiyla
           ayni sabitlerden gelir. */
        sinirlar: {
          jadeMin: JADE_MIN, jadeMax: JADE_MAX,
          gearTipleri: [...GEAR_TIPLERI],
          itemIdDesen: ITEMID_DESEN.source,
        },
      };
    },

    /**
     * POST /api/v1/admin/mall  { tabs: [{name, items:[{itemId, jade, qty?}]}] }
     *
     * Yayin sirasi (madde 4): (1) fiyat ARTISINDA banner duyuru GM'in isi -
     * cevaptaki `uyari` alani hatirlatir; (2) items.json + paket yamasi AYNI
     * istekte; (3) sistemleriKur(true) EN SON. Indirim/kalem eklemede sira
     * zararsizdir, tek sirayla yasariz.
     */
    async kaydet(govde) {
      if (!Array.isArray(govde?.tabs)) return { code: 400, body: { error: 'tabs dizisi gerekli' } };

      let paketYolu, paketBuf, dosya;
      try {
        paketYolu = await aktifPaket();
        paketBuf = await fsp.readFile(paketYolu);
        dosya = JSON.parse(await fsp.readFile(itemsYolu, 'utf8'));
      } catch (e) { return { code: 500, body: { error: e.message } }; }

      const katalog = new Map();
      for (const it of dosya.items ?? []) if (it?.id) katalog.set(it.id, it);

      const r = dogrula(govde.tabs, katalog, paketBuf);
      if (r.hatalar) {
        return { code: 400, body: { error: r.hatalar.slice(0, 20).join(' | '), hatalar: r.hatalar } };
      }

      /* madde 4 - fiyat penceresi riski: sistemleriKur sonrasi sunucu YENI
         fiyati keser ama oturumdaki istemci F5'e kadar ESKI gomulu fiyati
         gorur; buton bakiye kontrolu gomulu fiyatla oldugundan ARTISTA oyuncu
         gordugunden fazlasini oder. Artislari cevapta acikca listeleriz. */
      const eskiFiyat = new Map();
      for (const t of dosya.itemMall?.tabs ?? []) {
        for (const s of t?.items ?? []) {
          if (s?.itemId && !eskiFiyat.has(s.itemId)) eskiFiyat.set(s.itemId, Number(s.jade));
        }
      }
      const fiyatArtislari = [];
      for (const t of r.sunucu) {
        for (const s of t.items) {
          const eski = eskiFiyat.get(s.itemId);
          if (Number.isFinite(eski) && s.jade > eski) fiyatArtislari.push({ itemId: s.itemId, eski, yeni: s.jade });
        }
      }
      const uyari = fiyatArtislari.length
        ? 'FIYAT ARTISI ALGILANDI: sunucu kaydin ardindan YENI fiyati keser ama '
          + 'oturumdaki oyuncular F5 yapana kadar ESKI gomulu fiyati gorur '
          + '(satin-al butonu bakiyeyi gomulu fiyatla kontrol eder) - oyuncu '
          + 'gordugunden fazlasini odeyebilir. ONCE banner duyuru yapin, kayit '
          + 'sonrasi oyunculara F5 onerin.'
        : undefined;

      if (!kilitAl()) {
        return { code: 409, body: { error: 'baska bir mall kaydi calisiyor (.mall.lock) - birazdan yeniden deneyin' } };
      }
      try {
        const gomulu = gomuluOku(paketBuf);
        const yorum = typeof dosya.itemMall?.$comment === 'string' ? dosya.itemMall.$comment
          : (typeof gomulu?.$comment === 'string' ? gomulu.$comment : '');

        const itemsAyni = derinEsit(tabsNormallestir(dosya.itemMall?.tabs), r.sunucu);
        const paketAyni = !!gomulu && derinEsit(gomulu, { $comment: yorum, tabs: r.istemci });
        const kalemSayisi = r.sunucu.reduce((n, t) => n + t.items.length, 0);
        const tazele = () => { try { canliTazele?.(); return true; } catch (e) { log?.(`[mall] canli tazeleme hatasi: ${e.message}`); return false; } };

        /* Degisiklik yoksa 20MB paketi ve 6MB items.json'i bosuna yeniden
           yazmayiz (ETag da degismez, istemciler bosuna paket indirmez).
           sistemleriKur yine kosulur - uc idempotent ve dogrulanabilir kalir. */
        if (itemsAyni && paketAyni) {
          const tazelendi = tazele();
          log?.(`[mall] kayit: degisiklik yok (${kalemSayisi} kalem)`);
          return { code: 200, body: { ok: true, degisiklikYok: true, kalemSayisi, fiyatArtislari, tazelendi } };
        }

        let itemsYedek = null;
        if (!itemsAyni) {
          /* YALNIZ itemMall degisir; spread mevcut anahtar SIRASINI korur. */
          itemsYedek = await itemsYaz({ ...dosya, itemMall: { $comment: yorum, tabs: r.sunucu } });
        }
        if (!paketAyni) {
          try { await paketYamala(paketYolu, yorum, r.istemci); }
          catch (e) {
            /* iki kopya AYNI istekte yazilmali - paket yazilamadiysa items.json
               geri alinir ki fiyat ayrismasi olusmasin; sistemleriKur CAGRILMAZ. */
            if (itemsYedek) {
              try { await fsp.copyFile(itemsYedek, itemsYolu); }
              catch (e2) { log?.(`[mall] items.json geri alinamadi: ${e2.message} (yedek: ${itemsYedek})`); }
            }
            return { code: 500, body: { error: `paket yamasi basarisiz, degisiklik geri alindi: ${e.message}` } };
          }
        }

        const tazelendi = tazele();   // (3) EN SON: restartsiz canli etki
        log?.(`[mall] katalog kaydedildi: ${kalemSayisi} kalem, ${r.sunucu.length} sekme`
          + (fiyatArtislari.length ? `, ${fiyatArtislari.length} fiyat ARTISI` : '')
          + ` (items.json ${itemsAyni ? 'ayni' : 'yazildi'}, paket ${paketAyni ? 'ayni' : 'yamalandi'})`);
        return {
          code: 200,
          body: {
            ok: true, kalemSayisi, fiyatArtislari, tazelendi,
            yazilan: { itemsJson: !itemsAyni, paket: !paketAyni },
            ...(uyari ? { uyari } : {}),
          },
        };
      } catch (e) {
        return { code: 500, body: { error: e.message } };
      } finally {
        kilitBirak();
      }
    },
  };
}
