/**
 * HATA BILDIRIMLERI + OZELLIK ISTEKLERI - kayit yolu ve GM paneli ucu
 * =====================================================================
 *
 * NEREYE GIDIYOR (kullanicinin sorusu): oyun icindeki "Hata Bildir"
 * penceresi KENDI sunucumuza POST atar - istemci paketindeki API tablosu
 * (client/app/index-DzRqDn3Z.js, `J5` nesnesi) aynen sunu diyor:
 *     submitBugReport:     e => q5('POST', '/api/v1/bug-reports', e)
 *     submitFeatureRequest:e => q5('POST', '/api/v1/feature-requests', e)
 * `q5` mutlak URL kullanmaz, yalniz yol verir -> istek sayfanin kendi
 * kokune (bu sunucuya) gider. referans oyuna, herhangi bir ucuncu tarafa ya da
 * disariya HICBIR baglanti yok.
 *
 * ESKIDEN nereye gidiyordu: server.js ucu govdeyi YALNIZCA
 * data/bug-reports.log dosyasina yaziyordu. Tablo (dbo.WebBugReport) ve
 * yordam (dbo.WebAddBugReport) SRO_WEB_GAME'de VARDI ama HIC CAGRILMIYORDU -
 * olculdu: tabloda 0 satir, dosyada 3 satir. Bu modul o bosluğu kapatir.
 *
 * KAYIT SIRASI (rapor ASLA kaybolmaz):
 *   1) ref uretilir (8 haneli onaltilik; DB kolonu varchar(16))
 *   2) ekran goruntusu diske yazilir (data/bug-screenshots/<ref>.jpg)
 *   3) DOSYA LOGU yazilir  <- YEDEK KANAL, DB'den ONCE
 *   4) DB'ye yazilir; hata olursa data/bildirim-db-hatalari.log'a dusulur
 * 3. adim 4'ten once oldugu icin veritabani kapali/bozuk olsa bile rapor
 * diskte durur ve `iceAktar()` sonradan DB'ye tasir.
 *
 * SEMA POLITIKASI: tabloyu/yordamu BU MODUL TANIMLAMAZ, var olani cagirir.
 *   - dbo.WebBugReport      -> setup_web_schema.mjs'de tanimli (VAR)
 *   - dbo.WebAddBugReport   -> setup_procs.mjs'de tanimli (VAR), cagriliyor
 *   - Yordamun imzasi istemcinin gonderdigi TUM alanlari tasimiyor
 *     (subject / subjectRef / pos / screenshot yok). Yordamin govdesini
 *     DEGISTIRMEK setup_procs.mjs'in isi; burada yordam cagrilir, eksik
 *     alanlar ayni satira ref uzerinden UPDATE ile yazilir. Boylece iki
 *     dosya birbirinin uzerine yazmaz.
 *   - Ozellik istekleri icin sema tarafinda HICBIR SEY yoktu (olculdu:
 *     sys.tables/sys.procedures'ta '%Feature%' 0 satir). Bu yuzden
 *     dbo.WebFeatureRequest + dbo.WebAddFeatureRequest IDEMPOTENT olarak
 *     burada kurulur. Ad secimi mevcut kalibi izler: tablo = Web + tekil
 *     PascalCase (WebBugReport, WebGmLog, WebBankInfo), ekleme yordami =
 *     WebAdd + tablo adi (WebAddBugReport -> WebAddFeatureRequest).
 *   - WebFeatureRequest'e BILEREK CharID kolonu KONULMADI: govdede
 *     characterId yok (istemci yalniz {title, description, clientVersion}
 *     gonderiyor) ve test_kalinti-temizligi.mjs "CharID kolonlu her tablo
 *     karakter silinince temizlenmeli" kapisini isletiyor - gereksiz bir
 *     CharID kolonu o kapiyi yanlis yere kirmizi yakardi.
 *
 * EKRAN GORUNTUSU NEDEN BLOB DEGIL: istemci JPEG data-URL yolluyor
 * (paket: xIt kalite merdiveni, SIt = 700000 bayt ust sinir). 3 raporluk
 * dosya logu bile 269 KB olmustu; nvarchar(max) BLOB'lari admin listesini
 * her sorguda agirlastirirdi. Dosya diske yazilir, DB'de yalniz ref durur.
 * GUVENLIK: dosya adi YALNIZCA sunucunun urettigi ref'ten gelir - kullanici
 * girdisi ada asla girmez (yol gecisi imkansiz), uzanti icerigin sihirli
 * baytindan dogrulanir (yalniz PNG/JPEG - hem YAZARKEN hem OKURKEN), icerik
 * sunucuda ASLA calistirilmaz ve `X-Content-Type-Options: nosniff` ile servis
 * edilir. Disposition `inline`dir (panel onizlemesi icin gerekli): tur zaten
 * sihirli baytla dogrulandigi ve nosniff konuldugu icin tarayici govdeyi
 * PNG/JPEG disinda bir sey olarak yorumlayamaz.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const BURASI = path.dirname(fileURLToPath(import.meta.url));

/* ---------------------------------------------------------------- sabitler
 * Bu listeler ISTEMCI PAKETINDEN cikarildi, uydurulmadi
 * (client/app/index-DzRqDn3Z.js @19856947):
 *   gIt = kategoriler, _It = kategori basina konular,
 *   vIt = onem dereceleri, yIt = siklik.
 * Panelin suzgecleri bu kumeyle CIZILIR; istemciye yeni bir kategori
 * eklenirse burasi da guncellenmeli yoksa suzgecte gorunmez (kayit yine de
 * DB'ye duser - kapida reddetmiyoruz). */
export const KATEGORILER = ['visual', 'skill', 'quest', 'item', 'monster', 'world', 'ui', 'other'];
export const ONEMLER = ['blocker', 'major', 'minor'];
export const SIKLIKLAR = ['always', 'sometimes', 'once'];

/** Rapor/istek durumlari - GM panelinin is akisi. */
export const DURUMLAR = ['acik', 'inceleniyor', 'cozuldu', 'yoksayildi'];
const DURUM_ETIKET = {
  acik: 'Açık', inceleniyor: 'İnceleniyor', cozuldu: 'Çözüldü', yoksayildi: 'Yoksayıldı',
};

/** ref: sunucunun urettigi 8 haneli onaltilik. DB kolonu varchar(16). */
const REF_DESEN = /^[0-9a-f]{4,16}$/;
const yeniRef = () => crypto.randomUUID().replace(/-/g, '').slice(0, 8);

/* Ekran goruntusu kapisi. Istemci JPEG uretiyor (paket: `image/jpeg`), PNG de
   kabul edilir. readBody zaten 4 MB'ta 413 veriyor; burasi TEK GORSELIN
   sinirini koyar - istemcinin kendi ust siniri 700000 bayttir (SIt). */
const SHOT_MAX_BAYT = 1_500_000;
const SHOT_TURLERI = { 'image/png': '.png', 'image/jpeg': '.jpg' };

/** Sihirli bayt dogrulamasi: MIME etiketi degil, ICERIK karar verir. */
function gercekTur(buf) {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47)
    return { mime: 'image/png', uzanti: '.png' };
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)
    return { mime: 'image/jpeg', uzanti: '.jpg' };
  return null;
}

const kirp = (v, n) => { const s = v === null || v === undefined ? null : String(v); return s === null ? null : s.slice(0, n); };
/* null/undefined/'' -> null. `Number(null)` SIFIRDIR: bu kapi olmadan jetonsuz
   gonderilen rapor JID=0 (yani "1 numarali hesabin komsusu" gibi sahte bir
   deger) ile kaydediliyordu - olculdu, HTTP ucundan gelen ilk satirda JID 0
   yazmisti. Bilinmeyen hesap NULL kalmali. */
const sayiVeya = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};
const jsonVeya = (v) => { try { return v === undefined || v === null ? null : JSON.stringify(v); } catch { return null; } };

/* ------------------------------------------------------ ZAMAN DILIMI KAPISI
 * OLCULDU (2026-09-04, canli): `createdAt` kolonunun varsayilani GETDATE(),
 * yani SUNUCUNUN YEREL duvar saati (23:19). Ama mssql/tedious surucusu
 * `useUTC` ile calisir: DB'den okunan datetime UTC ETIKETLIYMIS gibi geri
 * gelir (23:19Z) ve yazarken de JS Date'in UTC bilesenlerini gonderir.
 * Bu iki ucu karistirmak IKI GERCEK HATA uretiyordu:
 *   1) `bas`/`bit` suzgeci: yerel gece yarisi UTC'ye cevrilerek gonderiliyor,
 *      gunun son 3 saati (UTC+3) araligin DISINDA kaliyordu - saat 23:19'da
 *      gonderilen rapor "bugun" suzgecinde GORUNMUYORDU (olculdu).
 *   2) `iceAktar` gunlukteki epoch'u dogrudan Date olarak yazinca satir 3 saat
 *      GERIYE kayiyordu; ayni kolonda GETDATE() satirlariyla iki ayri
 *      zaman kaynagi olusuyordu.
 * COZUM: kolon TEK bir seyi tutar - YEREL duvar saati. Yazarken duvar saati
 * METIN olarak gonderilir (surucunun UTC cevrimi devreye girmez), okurken UTC
 * bilesenleri alinip yerel ofsetle etiketlenir ("...+03:00") - panel
 * `Date.parse` ile dogru yerel saati gosterir.
 * (createdAt varsayilanini GETUTCDATE() yapmak setup_web_schema.mjs'in isi
 * olurdu; sema DEGISTIRILMEDI, kod semaya uyduruldu.) */
const iki = (n) => String(n).padStart(2, '0');
/** JS Date (gercek an) -> SQL'e verilecek YEREL duvar saati metni. */
function duvarSaati(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${iki(d.getMonth() + 1)}-${iki(d.getDate())}`
    + ` ${iki(d.getHours())}:${iki(d.getMinutes())}:${iki(d.getSeconds())}`
    + `.${String(d.getMilliseconds()).padStart(3, '0')}`;
}
/** DB'den okunan datetime (UTC etiketli duvar saati) -> dogru ISO + yerel ofset. */
function dbZaman(v) {
  if (!(v instanceof Date)) return v ?? null;
  const Y = v.getUTCFullYear(), A = v.getUTCMonth(), G = v.getUTCDate();
  const s = v.getUTCHours(), dk = v.getUTCMinutes(), sn = v.getUTCSeconds(), ms = v.getUTCMilliseconds();
  /* Ofset O TARIHTE gecerli olan ofset (yaz saati uygulanan bolgelerde
     sabit varsayilamaz): ayni duvar saatinden yerel bir Date kurup sorulur. */
  const ofDk = -new Date(Y, A, G, s, dk, sn, ms).getTimezoneOffset();
  const im = ofDk < 0 ? '-' : '+', mut = Math.abs(ofDk);
  return `${Y}-${iki(A + 1)}-${iki(G)}T${iki(s)}:${iki(dk)}:${iki(sn)}.${String(ms).padStart(3, '0')}`
    + `${im}${iki(Math.floor(mut / 60))}:${iki(mut % 60)}`;
}

/**
 * Eski (ref'siz) gunluk satirlari icin KARARLI ref: satirin kendi
 * icerigi hash'lenir, boylece ice aktarim kac kez kosulursa kosulsun
 * ayni satir ayni ref'i alir -> ikinci kosumda "zaten var" der.
 */
const kararliRef = (satir) =>
  crypto.createHash('sha256').update(satir).digest('hex').slice(0, 8);

export function createBildirimPaneli({ dataDir, clientDir, log = console.log }) {
  const SHOT_DIZIN = path.join(dataDir, 'bug-screenshots');
  const HATA_LOG = path.join(dataDir, 'bug-reports.log');
  const OZELLIK_LOG = path.join(dataDir, 'feature-requests.log');
  const DB_HATA_LOG = path.join(dataDir, 'bildirim-db-hatalari.log');
  /* MEZAR TASI: panelden silinen ref'ler. Gunluk dosyalari YEDEK KANAL oldugu
     icin silinen satir orada durmaya devam eder; bu liste olmasaydi bir
     sonraki `iceAktar()` (ornegin sunucu yeniden basladiginda) silinen kaydi
     geri getirirdi. */
  const SILINEN_LOG = path.join(dataDir, 'bildirim-silinenler.log');

  /* ------------------------------------------------------------- etiketler
   * Turkce basliklar UYDURULMAZ: istemcinin kendi sozlugunden
   * (client/assets/locales/tr.json) okunur - oyuncunun ekranda gordugu
   * metnin AYNISI panelde gorunur. Dosya yoksa ham anahtar gosterilir. */
  let SOZLUK = null;
  function sozluk() {
    if (SOZLUK) return SOZLUK;
    SOZLUK = {};
    try {
      const j = JSON.parse(fs.readFileSync(path.join(clientDir, 'assets', 'locales', 'tr.json'), 'utf8'));
      for (const [k, v] of Object.entries(j)) if (k.startsWith('ui.bug.')) SOZLUK[k] = v;
    } catch (e) {
      log(`[bildirim] tr.json okunamadi (etiketler ham anahtar olarak gosterilir): ${String(e.message).slice(0, 90)}`);
    }
    return SOZLUK;
  }
  const etiket = (anahtar, yedek) => sozluk()[anahtar] ?? yedek;

  /** Panelin suzgeclerini ve rozet metinlerini cizmesi icin tam etiket seti. */
  function etiketler() {
    const s = sozluk();
    const konular = {};
    for (const k of Object.keys(s)) {
      const m = k.match(/^ui\.bug\.subj\.(.+)$/);
      if (m) konular[m[1]] = s[k];
    }
    return {
      kategori: Object.fromEntries(KATEGORILER.map(k => [k, etiket(`ui.bug.cat.${k}`, k)])),
      konu: konular,
      onem: Object.fromEntries(ONEMLER.map(k => [k, etiket(`ui.bug.sev.${k}`, k)])),
      siklik: Object.fromEntries(SIKLIKLAR.map(k => [k, etiket(`ui.bug.freq.${k}`, k)])),
      durum: DURUM_ETIKET,
    };
  }

  /* ------------------------------------------------------------- SQL havuzu
   * admin_karakter.js kalibi: server.js'e bagimli olmayan KENDI havuzu -
   * ana havuz dusse bile bildirim paneli ayakta kalir, ve modul hic
   * kullanilmazsa hicbir baglanti acilmaz. */
  let HAVUZ = null, SQL = null, HAVUZ_HATA = null, SEMA_HAZIR = false;
  /** Karakter ADI shard veritabaninda (_Char); capraz-DB JOIN icin sema adi. */
  let SHARD = null, SHARD_ERISILIR = false;
  async function havuz() {
    if (HAVUZ) return HAVUZ;
    if (HAVUZ_HATA) return null;
    try {
      SQL = (await import('mssql')).default;
      const C = JSON.parse(fs.readFileSync(path.join(BURASI, 'config.json'), 'utf8')).sql;
      if (C?.enabled === false) throw new Error('config.json -> sql.enabled = false');
      SHARD = C.databases?.shard ?? null;
      HAVUZ = await new SQL.ConnectionPool({
        server: C.server, user: C.user, password: C.password,
        database: C.databases.web, options: C.options,
      }).connect();
      await semaHazirla(HAVUZ);
      return HAVUZ;
    } catch (e) {
      HAVUZ_HATA = e.message;
      log(`[bildirim] SQL havuzu açılamadı: ${String(e.message).slice(0, 120)}`);
      return null;
    }
  }

  /**
   * IDEMPOTENT sema esitleme. Var olani ASLA yeniden yaratmaz/degistirmez:
   * her adim once OBJECT_ID / COL_LENGTH ile bakar. setup_web_schema.mjs ve
   * setup_procs.mjs ayni nesneleri kendi tarafindan kurabilir - carpismaz.
   */
  async function semaHazirla(p) {
    if (SEMA_HAZIR) return;
    const q = (s) => p.request().query(s);

    /* 1) WebBugReport - istemcinin gonderdigi ama semada karsiligi olmayan
          alanlar + GM is akisi kolonlari. Hepsi NULL kabul eder ki mevcut
          satirlar bozulmasin. */
    await q(`
IF OBJECT_ID('dbo.WebBugReport') IS NOT NULL BEGIN
  IF COL_LENGTH('dbo.WebBugReport','subject')    IS NULL ALTER TABLE dbo.WebBugReport ADD [subject]   varchar(40)   NULL;
  IF COL_LENGTH('dbo.WebBugReport','subjectRef') IS NULL ALTER TABLE dbo.WebBugReport ADD subjectRef  nvarchar(400) NULL;
  IF COL_LENGTH('dbo.WebBugReport','pos')        IS NULL ALTER TABLE dbo.WebBugReport ADD pos         varchar(200)  NULL;
  IF COL_LENGTH('dbo.WebBugReport','shotFile')   IS NULL ALTER TABLE dbo.WebBugReport ADD shotFile    varchar(64)   NULL;
  IF COL_LENGTH('dbo.WebBugReport','status')     IS NULL ALTER TABLE dbo.WebBugReport ADD [status]    varchar(20)   NOT NULL CONSTRAINT DF_WBR_st DEFAULT ('acik');
  IF COL_LENGTH('dbo.WebBugReport','gmNote')     IS NULL ALTER TABLE dbo.WebBugReport ADD gmNote      nvarchar(max) NULL;
  IF COL_LENGTH('dbo.WebBugReport','gmJID')      IS NULL ALTER TABLE dbo.WebBugReport ADD gmJID       int           NULL;
  IF COL_LENGTH('dbo.WebBugReport','updatedAt')  IS NULL ALTER TABLE dbo.WebBugReport ADD updatedAt   datetime      NULL;
END`);

    /* 2) WebFeatureRequest - sema tarafinda YOKTU. CharID kolonu BILEREK yok
          (bkz. dosya basligi: kalinti temizligi kapsam kapisi). */
    const varmi = await q(`SELECT OBJECT_ID('dbo.WebFeatureRequest') AS o`);
    if (varmi.recordset[0]?.o === null) {
      await q(`
CREATE TABLE dbo.WebFeatureRequest (
  id          bigint IDENTITY(1,1) PRIMARY KEY,
  ref         varchar(16)   NOT NULL,
  JID         int           NULL,
  title       nvarchar(200) NULL,
  description nvarchar(max) NULL,
  clientVer   varchar(40)   NULL,
  [status]    varchar(20)   NOT NULL CONSTRAINT DF_WFR_st DEFAULT ('acik'),
  gmNote      nvarchar(max) NULL,
  gmJID       int           NULL,
  updatedAt   datetime      NULL,
  createdAt   datetime      NOT NULL CONSTRAINT DF_WFR_c DEFAULT (GETDATE())
)`);
      log('[bildirim] dbo.WebFeatureRequest olusturuldu');
    }

    /* 3) ref uzerinden arama/tekillik: panel HER islemi ref ile yapiyor. */
    await q(`
IF OBJECT_ID('dbo.WebBugReport') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_WebBugReport_ref' AND object_id=OBJECT_ID('dbo.WebBugReport'))
  CREATE INDEX IX_WebBugReport_ref ON dbo.WebBugReport(ref);
IF OBJECT_ID('dbo.WebFeatureRequest') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_WebFeatureRequest_ref' AND object_id=OBJECT_ID('dbo.WebFeatureRequest'))
  CREATE INDEX IX_WebFeatureRequest_ref ON dbo.WebFeatureRequest(ref);`);

    /* 4) Ekleme yordami - WebAddBugReport kalibinin AYNISI. Var olan yordama
          DOKUNULMAZ (CREATE OR ALTER degil; once OBJECT_ID bakilir) ki
          setup_procs.mjs bir gun kendi surumunu koyarsa ezilmesin. */
    const prc = await q(`SELECT OBJECT_ID('dbo.WebAddFeatureRequest') AS o`);
    if (prc.recordset[0]?.o === null) {
      await q(`
CREATE PROCEDURE dbo.WebAddFeatureRequest
  @Ref varchar(16), @JID int = NULL,
  @Title nvarchar(200) = NULL, @Description nvarchar(max) = NULL,
  @ClientVer varchar(40) = NULL
AS
BEGIN
  SET NOCOUNT ON;
  INSERT INTO dbo.WebFeatureRequest (ref, JID, title, description, clientVer)
  VALUES (@Ref, @JID, @Title, @Description, @ClientVer);
  SELECT SCOPE_IDENTITY() AS id;
END`);
      log('[bildirim] dbo.WebAddFeatureRequest yordami kuruldu');
    }

    /* 5) Karakter ADI icin capraz-DB JOIN yapilabiliyor mu? Panelin listesinde
          "Karakter" sutunu var; ad shard'daki _Char.CharName16'da duruyor.
          Erisilemiyorsa (baska makine/yetki) JOIN'siz calisiriz - liste
          CharID gosterir, sorgu PATLAMAZ. Ad, sema adindan geldigi icin
          ayrica denetlenir: yalniz [A-Za-z0-9_] kabul edilir. */
    SHARD_ERISILIR = false;
    if (SHARD && /^[A-Za-z0-9_]+$/.test(SHARD)) {
      try { await q(`SELECT TOP 1 CharID FROM [${SHARD}].dbo._Char`); SHARD_ERISILIR = true; }
      catch (e) { log(`[bildirim] karakter adi JOIN'i kapali (${String(e.message).slice(0, 80)})`); }
    }
    SEMA_HAZIR = true;
  }

  /* --------------------------------------------------------- ekran goruntusu */
  /**
   * data-URL -> disk. Basarisizlik SESSIZ DEGIL ama RAPORU DUSURMEZ:
   * `{ dosya: null, hata }` doner ve cagiran ham data-URL'i gunluk satirinda
   * BIRAKIR (yedek kanal), boylece goruntu de kaybolmaz.
   */
  async function goruntuYaz(ref, dataUrl) {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return { dosya: null };
    const m = dataUrl.match(/^data:([a-z]+\/[a-z0-9.+-]+);base64,/i);
    if (!m) return { dosya: null, hata: 'data-url bicimi taninmadi' };
    if (!SHOT_TURLERI[m[1].toLowerCase()]) return { dosya: null, hata: `desteklenmeyen tur: ${m[1].slice(0, 40)}` };
    const ham = dataUrl.slice(m[0].length);
    /* base64 -> ham bayt tahmini: 3/4. Kocaman govdeyi Buffer'a acmadan once
       kes ki 100 MB'lik bir data-URL bellegi patlatmasin. */
    if (Math.floor(ham.length * 3 / 4) > SHOT_MAX_BAYT)
      return { dosya: null, hata: `goruntu cok buyuk (${Math.floor(ham.length * 3 / 4)} bayt > ${SHOT_MAX_BAYT})` };
    let buf;
    try { buf = Buffer.from(ham, 'base64'); } catch { return { dosya: null, hata: 'base64 cozulemedi' }; }
    if (!buf.length) return { dosya: null, hata: 'bos govde' };
    const tur = gercekTur(buf);          // ETIKETE degil ICERIGE bak
    if (!tur) return { dosya: null, hata: 'icerik PNG/JPEG degil (sihirli bayt uymadi)' };
    /* Dosya adi YALNIZCA ref'ten; kullanici girdisi ada girmez. */
    if (!REF_DESEN.test(ref)) return { dosya: null, hata: 'ref bicimi gecersiz' };
    const ad = ref + tur.uzanti;
    try {
      await fsp.mkdir(SHOT_DIZIN, { recursive: true });
      await fsp.writeFile(path.join(SHOT_DIZIN, ad), buf);
      return { dosya: ad };
    } catch (e) { return { dosya: null, hata: String(e.message).slice(0, 160) }; }
  }

  /** ref -> diskteki goruntu (uzanti bilinmiyorsa dener). */
  async function goruntuOku(ref) {
    if (!REF_DESEN.test(ref)) return null;
    for (const uz of Object.values(SHOT_TURLERI)) {
      const tam = path.join(SHOT_DIZIN, ref + uz);
      try {
        const buf = await fsp.readFile(tam);
        /* OKURKEN de sihirli bayt kapisi: dizine elle birakilmis (ya da bozulmus)
           bir dosya asla "gorsel" diye servis edilmesin - tur uzantiya degil
           iceriğe gore belirlenir, uymuyorsa hic dondurulmez. */
        const t = gercekTur(buf);
        if (!t) { log(`[bildirim] ${ref + uz} PNG/JPEG degil - servis edilmedi`); return null; }
        return { veri: buf, mime: t.mime, ad: ref + uz };
      } catch { /* sonraki uzanti */ }
    }
    return null;
  }

  /* --------------------------------------------------------------- gunlukler */
  function gunlugeYaz(dosya, kayit) {
    try {
      fs.mkdirSync(path.dirname(dosya), { recursive: true });
      fs.appendFileSync(dosya, JSON.stringify(kayit) + '\n');
      return true;
    } catch (e) { log(`[bildirim] gunluge yazilamadi (${path.basename(dosya)}): ${String(e.message).slice(0, 120)}`); return false; }
  }
  /** Mezar tasi listesi (ref kumesi). Dosya yoksa bos kume. */
  function silinenler() {
    const k = new Set();
    try {
      for (const s of fs.readFileSync(SILINEN_LOG, 'utf8').split('\n')) {
        if (!s.trim()) continue;
        try { const o = JSON.parse(s); if (o?.ref) k.add(String(o.ref)); } catch { /* bozuk satir */ }
      }
    } catch { /* henuz hic silinmemis */ }
    return k;
  }

  const dbHatasi = (nerede, ref, e) => {
    log(`[bildirim] DB yazilamadi (${nerede}, ref=${ref}): ${String(e?.message ?? e).slice(0, 160)}`);
    gunlugeYaz(DB_HATA_LOG, { at: Date.now(), nerede, ref, hata: String(e?.message ?? e).slice(0, 400) });
  };

  /* ============================================================ KAYIT YOLU */

  /**
   * POST /api/v1/bug-reports govdesi -> disk + DB.
   * @param {object} b  istemci govdesi
   * @param {object} kim {JID} - jetondan cozulen hesap (yoksa null)
   * @returns {{code:number, body:object}}
   */
  async function hataKaydet(b, kim = {}) {
    const ref = yeniRef();
    const g = await goruntuYaz(ref, b?.screenshot);

    /* 1) YEDEK KANAL - DB'den ONCE. Goruntu diske indiyse dev data-URL yerine
          dosya adi yazilir (3 rapor = 269 KB gunluk olmustu); inmediyse ham
          data-URL BIRAKILIR ki hicbir sey kaybolmasin. */
    const kayit = { at: Date.now(), ref, ...b };
    if (g.dosya) { delete kayit.screenshot; kayit.screenshotFile = g.dosya; }
    if (g.hata) kayit.screenshotHata = g.hata;
    gunlugeYaz(HATA_LOG, kayit);
    if (g.hata) log(`[bildirim] ${ref} ekran goruntusu diske yazilamadi: ${g.hata}`);

    /* 2) DB. Hata olursa rapor YINE DURUYOR (yukaridaki gunluk) - istemciye
          basari doneriz, cunku oyuncunun raporu gercekten kaydedildi. */
    const p = await havuz();
    if (p) {
      try { await hataSatiriYaz(p, ref, b, kim, g.dosya); }
      catch (e) { dbHatasi('bug-reports', ref, e); }
    } else if (HAVUZ_HATA) {
      dbHatasi('bug-reports', ref, HAVUZ_HATA);
    }
    return { code: 200, body: { ref, cooldownSec: 60 } };
  }

  /**
   * Tek satirin DB'ye yazimi: VAR OLAN yordam + yordamda olmayan alanlar icin
   * ayni satira UPDATE. (Yordamin imzasini degistirmek setup_procs.mjs'in isi.)
   */
  async function hataSatiriYaz(p, ref, b, kim, shotFile) {
    await p.request()
      .input('Ref', SQL.VarChar(16), ref)
      .input('JID', SQL.Int, sayiVeya(kim?.JID))
      .input('CharID', SQL.Int, sayiVeya(b?.characterId))
      .input('Category', SQL.VarChar(40), kirp(b?.category, 40))
      .input('Severity', SQL.VarChar(20), kirp(b?.severity, 20))
      .input('Frequency', SQL.VarChar(20), kirp(b?.frequency, 20))
      .input('Title', SQL.NVarChar(200), kirp(b?.title, 200))
      .input('Description', SQL.NVarChar(SQL.MAX), b?.description == null ? null : String(b.description))
      .input('ZoneId', SQL.VarChar(40), kirp(b?.zoneId, 40))
      .input('ClientVer', SQL.VarChar(40), kirp(b?.clientVersion, 40))
      .input('Context', SQL.NVarChar(SQL.MAX), jsonVeya(b?.context))
      .execute('dbo.WebAddBugReport');
    await p.request()
      .input('ref', SQL.VarChar(16), ref)
      .input('subject', SQL.VarChar(40), kirp(b?.subject, 40))
      .input('subjectRef', SQL.NVarChar(400), kirp(jsonVeya(b?.subjectRef), 400))
      .input('pos', SQL.VarChar(200), kirp(jsonVeya(b?.pos), 200))
      .input('shotFile', SQL.VarChar(64), kirp(shotFile, 64))
      .query(`UPDATE dbo.WebBugReport
                 SET [subject]=@subject, subjectRef=@subjectRef, pos=@pos, shotFile=@shotFile
               WHERE ref=@ref`);
  }

  /**
   * POST /api/v1/feature-requests govdesi -> disk + DB.
   * Dusuk efor kapisi (title>=8, description>=100) server.js'te kaldi -
   * istemcinin kendi kapisiyla ayni esik, cagirmadan ONCE uygulanir.
   */
  async function ozellikKaydet(b, kim = {}) {
    const ref = yeniRef();
    gunlugeYaz(OZELLIK_LOG, { at: Date.now(), ref, ...b });
    const p = await havuz();
    if (p) {
      try { await ozellikSatiriYaz(p, ref, b, kim); }
      catch (e) { dbHatasi('feature-requests', ref, e); }
    } else if (HAVUZ_HATA) {
      dbHatasi('feature-requests', ref, HAVUZ_HATA);
    }
    return { code: 200, body: { ref, cooldownSec: 60 } };
  }

  async function ozellikSatiriYaz(p, ref, b, kim) {
    await p.request()
      .input('Ref', SQL.VarChar(16), ref)
      .input('JID', SQL.Int, sayiVeya(kim?.JID))
      .input('Title', SQL.NVarChar(200), kirp(b?.title, 200))
      .input('Description', SQL.NVarChar(SQL.MAX), b?.description == null ? null : String(b.description))
      .input('ClientVer', SQL.VarChar(40), kirp(b?.clientVersion, 40))
      .execute('dbo.WebAddFeatureRequest');
  }

  /* ======================================================= GM PANELI OKUMA */

  const TUR_HATA = 'hata', TUR_OZELLIK = 'ozellik';
  const sayfaSinirla = (v, vars, tavan) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.min(Math.trunc(n), tavan) : vars;
  };

  /**
   * ISO/`YYYY-MM-DD` tarihini SQL'e verilebilir Date'e cevirir (gecersiz -> null).
   * SAATSIZ tarih YEREL gece yarisi sayilir: createdAt varsayilani GETDATE(),
   * yani SUNUCUNUN YEREL saati. `new Date('2026-09-04')` UTC gece yarisidir ve
   * UTC+3'te suzgeci 3 saat kaydirirdi.
   */
  const SADECE_TARIH = /^\d{4}-\d{2}-\d{2}$/;
  function tarih(v) {
    if (!v) return null;
    const s = String(v).trim();
    const d = new Date(SADECE_TARIH.test(s) ? s + 'T00:00:00' : s);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  /**
   * Liste. Suzgecler: tur / kategori / konu / onem / durum / tarih araligi /
   * serbest arama (ref, baslik, aciklama, karakter). Sayfalama OFFSET-FETCH.
   */
  async function listele(q = {}) {
    const p = await havuz();
    if (!p) return { yok: HAVUZ_HATA ?? 'veritabanı yok', satirlar: [], toplam: 0 };

    const tur = q.tur === TUR_OZELLIK ? TUR_OZELLIK : (q.tur === TUR_HATA ? TUR_HATA : 'hepsi');
    /* `adet` ve `limit` AYNI seydir - panel `limit` gonderiyor (100/300/1000
       secenekleri), REST alisiligi `adet`. Tavan 1000: panelin en genis
       secenegi; ustu sunucuyu bosuna yorar. */
    const adet = sayfaSinirla(q.adet ?? q.limit, 100, 1000);
    const sayfa = sayfaSinirla(q.sayfa, 1, 100000);
    const atla = (sayfa - 1) * adet;
    const ara = String(q.q ?? '').trim().slice(0, 80);
    /* Kategori COKLU olabilir: panel isaretli kutulari 'a,b,c' diye yolluyor.
       Bilinmeyen anahtar sessizce dusurulur (kapida reddetmiyoruz). */
    const kategoriler = String(q.kategori ?? '').split(',')
      .map(s => s.trim()).filter(s => KATEGORILER.includes(s));
    const durum = DURUMLAR.includes(q.durum) ? q.durum : null;
    const onem = ONEMLER.includes(q.onem) ? q.onem : null;
    /* `bit` GUN SONUNU kapsamali: panel <input type=date> ile '2026-09-04'
       yolluyor; ciplak haliyle o gunun 00:00'i olur ve gun boyu gelen
       raporlar disarida kalirdi. Saatsiz tarihe 1 gun eklenir (< ile). */
    const bas = tarih(q.bas);
    let bit = tarih(q.bit);
    if (bit && SADECE_TARIH.test(String(q.bit).trim()))
      bit = new Date(bit.getTime() + 86_400_000);

    /* Kategori listesi SORGU METNINE degil, PARAMETRE ADLARINA acilir
       (@kat0, @kat1 ...) - degerler yine parametreli gider, enjeksiyon yok.
       Zaten KATEGORILER kumesiyle suzuldugu icin ad uretimi de guvenli. */
    const katParam = kategoriler.map((_, i) => '@kat' + i);

    const kosul = (tablo) => {
      const k = ['1=1'];
      if (durum) k.push('b.[status]=@durum');
      if (bas) k.push('b.createdAt>=@bas');
      if (bit) k.push('b.createdAt<@bit');
      if (tablo === 'bug') {
        if (katParam.length) k.push(`b.category IN (${katParam.join(',')})`);
        if (onem) k.push('b.severity=@onem');
        if (ara) k.push('(b.ref LIKE @ara OR b.title LIKE @ara OR b.description LIKE @ara'
          + ' OR CAST(b.CharID AS varchar(20)) LIKE @ara'
          + (SHARD_ERISILIR ? ' OR ch.CharName16 LIKE @ara' : '') + ')');
      } else {
        if (ara) k.push('(b.ref LIKE @ara OR b.title LIKE @ara OR b.description LIKE @ara)');
      }
      return k.join(' AND ');
    };

    const istek = () => {
      const r = p.request();
      if (durum) r.input('durum', SQL.VarChar(20), durum);
      kategoriler.forEach((k, i) => r.input('kat' + i, SQL.VarChar(40), k));
      if (onem) r.input('onem', SQL.VarChar(20), onem);
      if (ara) r.input('ara', SQL.NVarChar(90), '%' + ara + '%');
      /* DateTime DEGIL VarChar: surucunun UTC cevrimi araligi ofset kadar
         kaydiriyordu (bkz. dosya basindaki ZAMAN DILIMI KAPISI notu).
         SQL metni datetime'a kendisi cevirir - TZ matematigi yok. */
      if (bas) r.input('bas', SQL.VarChar(30), duvarSaati(bas));
      if (bit) r.input('bit', SQL.VarChar(30), duvarSaati(bit));
      return r;
    };

    /* Iki tablo AYNI kolon adlariyla UNION edilir; `tur` kolonu hangisinden
       geldigini soyler. Kategori/onem suzgeci verildiginde ozellik istekleri
       zaten kapsam disi kalir (o kolonlar onlarda yok) - bu yuzden 'hepsi'
       modunda kategori/onem suzgeci varsa yalniz hata tarafi taranir. */
    const hataVar = tur !== TUR_OZELLIK;
    const ozellikVar = tur !== TUR_HATA && !kategoriler.length && !onem;

    /* Karakter ADI shard'da (_Char.CharName16); panelin "Karakter" sutunu bunu
       istiyor. Shard erisilemiyorsa JOIN'siz calisir, sutun NULL kalir ve
       panel "CharID <n>" gosterir - uydurma ad yok. */
    const adJoin = SHARD_ERISILIR ? `LEFT JOIN [${SHARD}].dbo._Char ch ON ch.CharID = b.CharID` : '';
    const adSutun = SHARD_ERISILIR ? 'ch.CharName16' : 'CAST(NULL AS nvarchar(64))';

    const parcalar = [];
    if (hataVar) parcalar.push(`
      SELECT '${TUR_HATA}' AS tur, b.ref, b.createdAt, b.[status], b.title, b.category, b.[subject],
             b.severity, b.frequency, b.CharID, b.JID, b.zoneId, b.clientVer, b.shotFile, b.gmNote,
             ${adSutun} AS karakter,
             CAST(CASE WHEN b.[context] IS NULL THEN 0 ELSE 1 END AS bit) AS baglamVar,
             LEFT(ISNULL(b.description,''), 400) AS ozet
        FROM dbo.WebBugReport b ${adJoin} WHERE ${kosul('bug')}`);
    if (ozellikVar) parcalar.push(`
      SELECT '${TUR_OZELLIK}' AS tur, b.ref, b.createdAt, b.[status], b.title, NULL AS category, NULL AS [subject],
             NULL AS severity, NULL AS frequency, NULL AS CharID, b.JID, NULL AS zoneId, b.clientVer, NULL AS shotFile, b.gmNote,
             CAST(NULL AS nvarchar(64)) AS karakter,
             CAST(0 AS bit) AS baglamVar,
             LEFT(ISNULL(b.description,''), 400) AS ozet
        FROM dbo.WebFeatureRequest b WHERE ${kosul('feat')}`);
    if (!parcalar.length) return { satirlar: [], toplam: 0, sayfa, adet, etiketler: etiketler() };

    const govde = parcalar.join(' UNION ALL ');
    try {
      const say = await istek().query(`SELECT COUNT(*) AS n FROM (${govde}) t`);
      const r = await istek()
        .input('atla', SQL.Int, atla).input('adet', SQL.Int, adet)
        .query(`SELECT * FROM (${govde}) t
                 ORDER BY createdAt DESC, ref
                 OFFSET @atla ROWS FETCH NEXT @adet ROWS ONLY`);
      return {
        toplam: say.recordset[0]?.n ?? 0, sayfa, adet,
        satirlar: r.recordset.map(satirGorunumu),
        etiketler: etiketler(),
      };
    } catch (e) { return { yok: String(e.message).slice(0, 200), satirlar: [], toplam: 0 }; }
  }

  /** DB satiri -> panelin bekledigi duz kayit (etiketler ayri gelir). */
  function satirGorunumu(x) {
    return {
      tur: x.tur, ref: x.ref,
      tarih: dbZaman(x.createdAt),
      durum: x.status ?? 'acik',
      baslik: x.title ?? '',
      /* Liste satirinda aciklamanin ilk 400 karakteri: panel metin aramasini
         YEREL de yapiyor (bildSuzulmus) - alan bos gelirse listede arama
         yalniz basliga bakar. Tam metin detay ucundan gelir. */
      ozet: x.ozet ?? '',
      aciklama: x.ozet ?? '',
      kategori: x.category ?? null, konu: x.subject ?? null,
      onem: x.severity ?? null, siklik: x.frequency ?? null,
      karakter: x.karakter ?? null,
      charId: x.CharID ?? null, JID: x.JID ?? null,
      bolge: x.zoneId ?? null, surum: x.clientVer ?? null,
      gorselVar: !!x.shotFile, baglamVar: !!x.baglamVar,
      gmNotu: x.gmNote ?? null,
    };
  }

  /** Ozet kartlari: tur x durum sayilari + kategori dagilimi + son 7 gun. */
  async function ozet() {
    const p = await havuz();
    if (!p) return { yok: HAVUZ_HATA ?? 'veritabanı yok' };
    try {
      const d = await p.request().query(`
        SELECT 'hata' AS tur, [status] AS durum, COUNT(*) AS n FROM dbo.WebBugReport GROUP BY [status]
        UNION ALL
        SELECT 'ozellik', [status], COUNT(*) FROM dbo.WebFeatureRequest GROUP BY [status]`);
      const k = await p.request().query(`
        SELECT ISNULL(category,'(yok)') AS kategori, COUNT(*) AS n,
               SUM(CASE WHEN [status]='acik' THEN 1 ELSE 0 END) AS acik
          FROM dbo.WebBugReport GROUP BY category`);
      const s = await p.request().query(`
        SELECT COUNT(*) AS n FROM dbo.WebBugReport WHERE createdAt >= DATEADD(day,-7,GETDATE())`);
      const durumlar = { hata: {}, ozellik: {} };
      for (const t of ['hata', 'ozellik']) for (const dd of DURUMLAR) durumlar[t][dd] = 0;
      for (const r of d.recordset) {
        const t = r.tur, dd = DURUMLAR.includes(r.durum) ? r.durum : 'acik';
        durumlar[t][dd] = (durumlar[t][dd] ?? 0) + r.n;
      }
      const say = (t) => DURUMLAR.reduce((a, dd) => a + (durumlar[t][dd] ?? 0), 0);
      return {
        /* DUZ alanlar: panel sekme rozetini ve sayaclarini bunlardan okuyor
           (bildSayacCiz -> oz.hataToplam / oz.ozellikToplam / oz.acik).
           Ayrintili kirilim asagida ayrica duruyor. */
        hataToplam: say('hata'),
        ozellikToplam: say('ozellik'),
        acik: (durumlar.hata.acik ?? 0) + (durumlar.ozellik.acik ?? 0),
        durumlar,
        kategoriler: k.recordset.map(r => ({ kategori: r.kategori, toplam: r.n, acik: r.acik })),
        sonHafta: s.recordset[0]?.n ?? 0,
        etiketler: etiketler(),
      };
    } catch (e) { return { yok: String(e.message).slice(0, 200) }; }
  }

  /** CharID -> karakter adi (shard). Erisim yoksa/kayit yoksa null - uydurma yok. */
  async function karakterAdi(p, charId) {
    const id = sayiVeya(charId);
    if (!SHARD_ERISILIR || !id) return null;
    try {
      const r = await p.request().input('c', SQL.Int, id)
        .query(`SELECT TOP 1 CharName16 FROM [${SHARD}].dbo._Char WHERE CharID=@c`);
      return r.recordset[0]?.CharName16 ?? null;
    } catch { return null; }
  }

  /** Tek kaydin tam detayi - `context` (sohbet baglami dahil) COZULMUS gelir. */
  async function detay(ref) {
    if (!REF_DESEN.test(String(ref ?? ''))) return { yok: 'ref biçimi geçersiz' };
    const p = await havuz();
    if (!p) return { yok: HAVUZ_HATA ?? 'veritabanı yok' };
    try {
      const b = await p.request().input('ref', SQL.VarChar(16), ref)
        .query('SELECT TOP 1 * FROM dbo.WebBugReport WHERE ref=@ref ORDER BY id DESC');
      if (b.recordset.length) {
        const x = b.recordset[0];
        let baglam = null;
        try { baglam = x.context ? JSON.parse(x.context) : null; } catch { baglam = { _ham: String(x.context).slice(0, 4000) }; }
        let konuRef = null;
        try { konuRef = x.subjectRef ? JSON.parse(x.subjectRef) : null; } catch { konuRef = x.subjectRef; }
        let konum = null;
        try { konum = x.pos ? JSON.parse(x.pos) : null; } catch { konum = null; }
        return {
          ...satirGorunumu({ ...x, tur: TUR_HATA, ozet: null, baglamVar: !!x.context,
                             karakter: await karakterAdi(p, x.CharID) }),
          aciklama: x.description ?? '',
          baglam, konuRef, konum,
          /* Panel bildNorm'u ham istemci adlarini da okuyor (r.pos, r.subjectRef);
             ayni degerler iki adla da verilir ki uc adlandirmasi degisse bile
             detay ekrani bos kalmasin. */
          pos: konum, subjectRef: konuRef, context: baglam,
          gmJID: x.gmJID ?? null,
          guncellendi: dbZaman(x.updatedAt),
          etiketler: etiketler(),
        };
      }
      const f = await p.request().input('ref', SQL.VarChar(16), ref)
        .query('SELECT TOP 1 * FROM dbo.WebFeatureRequest WHERE ref=@ref ORDER BY id DESC');
      if (!f.recordset.length) return { yok: 'kayıt bulunamadı' };
      const x = f.recordset[0];
      return {
        ...satirGorunumu({ ...x, tur: TUR_OZELLIK, ozet: null, baglamVar: 0 }),
        aciklama: x.description ?? '',
        baglam: null, konuRef: null, konum: null,
        gmJID: x.gmJID ?? null,
        guncellendi: dbZaman(x.updatedAt),
        etiketler: etiketler(),
      };
    } catch (e) { return { yok: String(e.message).slice(0, 200) }; }
  }

  /** Ekran goruntusu - dosyadan; DB'de yol/ref durur, BLOB durmaz. */
  async function gorsel(ref) {
    if (!REF_DESEN.test(String(ref ?? ''))) return null;
    return goruntuOku(String(ref));
  }

  /** Durum degistir + GM notu. Bos govde hicbir kolonu silmez. */
  async function durumGuncelle(ref, b = {}, gmJID = null) {
    if (!REF_DESEN.test(String(ref ?? ''))) return { code: 400, body: { hata: 'ref biçimi geçersiz' } };
    const durum = DURUMLAR.includes(b?.durum) ? b.durum : null;
    const notVar = Object.prototype.hasOwnProperty.call(b ?? {}, 'gmNotu');
    if (!durum && !notVar) return { code: 400, body: { hata: 'değişecek alan yok (durum ya da gmNotu ver)' } };
    const p = await havuz();
    if (!p) return { code: 503, body: { hata: HAVUZ_HATA ?? 'veritabanı yok' } };
    const setler = ['updatedAt=GETDATE()', 'gmJID=@gm'];
    if (durum) setler.push('[status]=@durum');
    if (notVar) setler.push('gmNote=@not');
    const calistir = async (tablo) => {
      const r = p.request()
        .input('ref', SQL.VarChar(16), ref)
        .input('gm', SQL.Int, sayiVeya(gmJID));
      if (durum) r.input('durum', SQL.VarChar(20), durum);
      if (notVar) r.input('not', SQL.NVarChar(SQL.MAX), b.gmNotu == null ? null : String(b.gmNotu).slice(0, 8000));
      const out = await r.query(`UPDATE dbo.${tablo} SET ${setler.join(', ')} WHERE ref=@ref`);
      return out.rowsAffected[0] ?? 0;
    };
    try {
      let n = await calistir('WebBugReport');
      if (!n) n = await calistir('WebFeatureRequest');
      if (!n) return { code: 404, body: { hata: 'kayıt bulunamadı' } };
      return { code: 200, body: { ok: true, ref, durum: durum ?? undefined } };
    } catch (e) { return { code: 500, body: { hata: String(e.message).slice(0, 200) } }; }
  }

  /** Sil - satiri ve varsa ekran goruntusu dosyasini birlikte. */
  async function sil(ref) {
    if (!REF_DESEN.test(String(ref ?? ''))) return { code: 400, body: { hata: 'ref biçimi geçersiz' } };
    const p = await havuz();
    if (!p) return { code: 503, body: { hata: HAVUZ_HATA ?? 'veritabanı yok' } };
    try {
      const a = await p.request().input('ref', SQL.VarChar(16), ref)
        .query('DELETE FROM dbo.WebBugReport WHERE ref=@ref');
      const b = await p.request().input('ref', SQL.VarChar(16), ref)
        .query('DELETE FROM dbo.WebFeatureRequest WHERE ref=@ref');
      const n = (a.rowsAffected[0] ?? 0) + (b.rowsAffected[0] ?? 0);
      if (!n) return { code: 404, body: { hata: 'kayıt bulunamadı' } };
      for (const uz of Object.values(SHOT_TURLERI)) {
        try { await fsp.unlink(path.join(SHOT_DIZIN, ref + uz)); } catch { /* yoktu */ }
      }
      /* Mezar tasi: gunluk dosyasindaki satir duruyor - isaretlemezsek bir
         sonraki ice aktarim kaydi geri getirir. */
      gunlugeYaz(SILINEN_LOG, { at: Date.now(), ref });
      return { code: 200, body: { ok: true, silinen: n } };
    } catch (e) { return { code: 500, body: { hata: String(e.message).slice(0, 200) } }; }
  }

  /* ================================================= ESKI KAYITLARIN AKTARIMI */

  /**
   * data/*.log -> DB. IDEMPOTENT: her satir icin ref hesaplanir ve DB'de zaten
   * varsa atlanir.
   *
   * ESKI SATIRLARDA ref YOK: server.js ref'i yalniz HTTP cevabinda uretiyor,
   * gunluge yazmiyordu (olculdu: 3 hata + 3 ozellik satiri, hicbirinde ref
   * alani yok). Bu yuzden ref'siz satirlara SATIR ICERIGININ sha256'sindan
   * kararli bir ref uretilir - ayni satir her kosumda ayni ref'i alir, yani
   * ice aktarim tekrar tekrar kosulabilir.
   *
   * Ekran goruntusu: eski satirlar dev data-URL'i govdede tasiyor; aktarim
   * sirasinda diske indirilir ve satira shotFile yazilir.
   */
  async function iceAktar() {
    const p = await havuz();
    if (!p) return { yok: HAVUZ_HATA ?? 'veritabanı yok' };
    const sonuc = { hata: { okunan: 0, eklenen: 0, atlanan: 0, silinmis: 0, bozuk: 0, gorsel: 0 },
                    ozellik: { okunan: 0, eklenen: 0, atlanan: 0, silinmis: 0, bozuk: 0 }, hatalar: [] };
    const mezar = silinenler();

    const satirlar = (dosya) => {
      try { return fs.readFileSync(dosya, 'utf8').split('\n').filter(s => s.trim()); }
      catch { return []; }
    };
    const varMi = async (tablo, ref) => {
      const r = await p.request().input('ref', SQL.VarChar(16), ref)
        .query(`SELECT TOP 1 1 AS v FROM dbo.${tablo} WHERE ref=@ref`);
      return r.recordset.length > 0;
    };

    for (const satir of satirlar(HATA_LOG)) {
      sonuc.hata.okunan++;
      let o; try { o = JSON.parse(satir); } catch { sonuc.hata.bozuk++; continue; }
      const ref = REF_DESEN.test(String(o.ref ?? '')) ? String(o.ref) : kararliRef(satir);
      if (mezar.has(ref)) { sonuc.hata.silinmis++; continue; }   // GM sildi, geri getirme
      try {
        if (await varMi('WebBugReport', ref)) { sonuc.hata.atlanan++; continue; }
        let shot = typeof o.screenshotFile === 'string' ? o.screenshotFile : null;
        if (!shot && o.screenshot) {
          const g = await goruntuYaz(ref, o.screenshot);
          if (g.dosya) { shot = g.dosya; sonuc.hata.gorsel++; }
          else if (g.hata) sonuc.hatalar.push(`${ref}: görüntü — ${g.hata}`);
        }
        await hataSatiriYaz(p, ref, o, { JID: o.JID ?? null }, shot);
        /* Gunlukteki gercek zamani koru - GETDATE() varsayilani aktarim
           gununu yazardi ve tum eski raporlar "bugun" gorunurdu. */
        if (Number.isFinite(Number(o.at))) {
          await p.request().input('ref', SQL.VarChar(16), ref)
            .input('t', SQL.VarChar(30), duvarSaati(new Date(Number(o.at))))
            .query('UPDATE dbo.WebBugReport SET createdAt=@t WHERE ref=@ref');
        }
        sonuc.hata.eklenen++;
      } catch (e) { sonuc.hatalar.push(`${ref}: ${String(e.message).slice(0, 140)}`); }
    }

    for (const satir of satirlar(OZELLIK_LOG)) {
      sonuc.ozellik.okunan++;
      let o; try { o = JSON.parse(satir); } catch { sonuc.ozellik.bozuk++; continue; }
      const ref = REF_DESEN.test(String(o.ref ?? '')) ? String(o.ref) : kararliRef(satir);
      if (mezar.has(ref)) { sonuc.ozellik.silinmis++; continue; }   // GM sildi, geri getirme
      try {
        if (await varMi('WebFeatureRequest', ref)) { sonuc.ozellik.atlanan++; continue; }
        await ozellikSatiriYaz(p, ref, o, { JID: o.JID ?? null });
        if (Number.isFinite(Number(o.at))) {
          await p.request().input('ref', SQL.VarChar(16), ref)
            .input('t', SQL.VarChar(30), duvarSaati(new Date(Number(o.at))))
            .query('UPDATE dbo.WebFeatureRequest SET createdAt=@t WHERE ref=@ref');
        }
        sonuc.ozellik.eklenen++;
      } catch (e) { sonuc.hatalar.push(`${ref}: ${String(e.message).slice(0, 140)}`); }
    }
    log(`[bildirim] ice aktarim: hata ${sonuc.hata.eklenen} eklendi / ${sonuc.hata.atlanan} zaten vardi, `
      + `ozellik ${sonuc.ozellik.eklenen} eklendi / ${sonuc.ozellik.atlanan} zaten vardi`);
    return sonuc;
  }

  /* Panel ilk acildiginda eski gunlukler BIR KEZ tasinir; sonraki istekler
     ayni sozu bekler (tekrar taramaz). Hata olursa panel yine acilir. */
  let AKTARIM = null;
  const otoAktar = () => (AKTARIM ??= iceAktar().catch(e => ({ yok: String(e.message).slice(0, 200) })));

  return {
    hataKaydet, ozellikKaydet,
    listele, ozet, detay, gorsel, durumGuncelle, sil,
    iceAktar, otoAktar, etiketler,
    KATEGORILER, ONEMLER, SIKLIKLAR, DURUMLAR,
  };
}
