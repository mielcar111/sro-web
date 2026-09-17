/* =============================================================================
 * 06_shard_parite.sql — vSRO SHARD paritesi + web kolon esitleme (CANTA-12 DAHIL)
 *
 * NE YAPAR (hepsi IDEMPOTENT — istenildigi kadar tekrar kosulabilir):
 *   BOLUM A) SRO_VT_SHARD:
 *     1) _Char.InventorySize -> 397 (13 kusam + 384 canta = 12 sayfa x 32 yuva).
 *        bu sunucunun "canta 12 sayfa" modeli: sunucu, canta boyunu bu kolondan
 *        okur; 397 = tum sayfalar acik.
 *     2) _Inventory 109..239 bos yuva satirlarini acar (ItemID=0 = bos).
 *        SINIR (Mimari A): satir acimi EN COK Slot 239'a kadar — _RefDummySlot
 *        cnt 0..239 uretir ve _Inventory.Slot TINYINT'tir (ALTER YAPILMAZ,
 *        Slot>255 satiri ASLA acilmaz). Canta yuva 227..383 (sayfa ~8-12)
 *        vSRO tablosunda DEGIL, SRO_WEB_GAME.WebCharInventory'de yasar ve
 *        orada _Inventory satiri gerekmez — yani sayfa 8-12 esyalarini
 *        _Inventory'de GORMEMENIZ normaldir, veri kaybi degildir.
 *   BOLUM B) SRO_WEB_GAME kolon esitleme (eski bir .bak'tan geri yukleyenler icin):
 *     3) Pet kolonlari: WebCharPet tablosu + bagSlot kolonu ve
 *        WebCharGrowthPet.acik kolonu ("cikista acik kalan pet giriste geri
 *        gelsin" kaliciligi).
 *     4) WebCharMarks.tpReadyAt (isinlanma bekleme suresi kaliciligi).
 *     5) WebBugReport.context (tek baglam kolonu; eski contextJson kaldirildi).
 *     6) BILDIRIM PANELI (2026-09-05): WebBugReport'un 8 GM/istemci kolonu
 *        (subject, subjectRef, pos, shotFile, status, gmNote, gmJID, updatedAt)
 *        + WebFeatureRequest tablosu + IX_WebBugReport_ref ve
 *        IX_WebFeatureRequest_ref indeksleri.
 *
 * NOT: Sunucu (routes_auth.js / sistem_binek-pet.js / kalicilik.js /
 * admin_bildirim.js) bu esitlemelerin cogunu calisma zamaninda kendisi de yapar;
 * bu betik geri yuklenen/eski bir veritabanini TEK SEFERDE ayni duruma getirir.
 * KISITLI bir SQL kullanicisiyla calisan kurulumda calisma zamani ALTER/CREATE
 * REDDEDILIR ve hata yutulur — o durumda bu betigi yetkili bir oturumda kosmak
 * ZORUNLUDUR.
 *
 * KOSUM SIRASI:
 *   ONCE : vSRO SHARD geri yuklenmis olmali; BOLUM B icin 01+02 (veya .bak).
 *   SONRA: sunucunun ilk acilisi (BASLAT.bat). Kurulumun son SQL adimidir;
 *          08 yalnizca GM atamak istediginizde kosulur.
 *
 * KAYNAK: server/deploy_inventory_109_172.sql (canta-12 oncesi hali) +
 *         routes_auth.js'in canli 397/239 esitleme SQL'i + sistem_binek-pet.js
 *         ve setup_web_schema.mjs kolon kararlari + admin_bildirim.js
 *         semaHazirla() (B4).
 * ============================================================================= */

/* ============================== BOLUM A: SRO_VT_SHARD ====================== */

/* A1) Canta tavani: 397 = 13 kusam yuvasi + 384 canta yuvasi (12 sayfa x 32).
   Yalnizca dusuk olanlar yukseltilir; CharID=0 vSRO dummy satirina dokunulmaz. */
UPDATE SRO_VT_SHARD.dbo._Char
   SET InventorySize = 397
 WHERE CharID > 0 AND InventorySize < 397;
GO

/* A2) _Inventory bos yuva backfill'i: 109..239 (ItemID=0 = bos yuva).
   NOT EXISTS + PK sayesinde idempotent. n.cnt <= 239 kelepcesi:
   _Inventory.Slot TINYINT tasmasina karsi (Mimari A — ALTER YOK). */
INSERT INTO SRO_VT_SHARD.dbo._Inventory(CharID, Slot, ItemID)
SELECT c.CharID, n.cnt, 0
  FROM SRO_VT_SHARD.dbo._Char c
  JOIN SRO_VT_SHARD.dbo._RefDummySlot n
    ON n.cnt >= 109 AND n.cnt < c.InventorySize AND n.cnt <= 239
 WHERE c.CharID > 0
   AND NOT EXISTS (SELECT 1 FROM SRO_VT_SHARD.dbo._Inventory v
                   WHERE v.CharID = c.CharID AND v.Slot = n.cnt);
GO

/* A-DOGRULAMA: her oynanabilir karakterde Slot 0..239 arasi 240 satir olmali.
   BOS SONUC = TAMAM. (Satir sayisi 240'tan az / maxSlot 239'dan farkli olan
   karakterleri listeler.) */
SELECT CharID, COUNT(*) AS satir, MAX(Slot) AS maxSlot
  FROM SRO_VT_SHARD.dbo._Inventory
 WHERE CharID > 0
 GROUP BY CharID
HAVING COUNT(*) <> 240 OR MAX(Slot) <> 239;
GO

/* A-DOGRULAMA 2: TINYINT tasma korumasi — sonuc HER ZAMAN <= 255 olmali
   (bu kurulumda 239 beklenir). */
SELECT MAX(Slot) AS enBuyukSlot FROM SRO_VT_SHARD.dbo._Inventory;
GO

/* ============================ BOLUM B: SRO_WEB_GAME ======================== */
USE SRO_WEB_GAME;
GO

/* B1) Pet kolonlari: acik toplayici petin yuvasi + gelisim petinin acik durumu.
   (Sunucu sistem_binek-pet.js petSemaKur ile aynisini kurar.) */
IF OBJECT_ID('dbo.WebCharPet') IS NULL
  CREATE TABLE dbo.WebCharPet (
    CharID       int           NOT NULL PRIMARY KEY,
    settingsJson nvarchar(400) NULL,
    updatedAt    datetime      NOT NULL CONSTRAINT DF_WebCharPet_upd DEFAULT (GETDATE()));
IF COL_LENGTH('dbo.WebCharPet', 'bagSlot') IS NULL
  ALTER TABLE dbo.WebCharPet ADD bagSlot int NULL;
IF OBJECT_ID('dbo.WebCharGrowthPet') IS NOT NULL
   AND COL_LENGTH('dbo.WebCharGrowthPet', 'acik') IS NULL
  ALTER TABLE dbo.WebCharGrowthPet ADD acik bit NOT NULL
    CONSTRAINT DF_WCGP_acik DEFAULT(0);
GO

/* B2) Isinlanma bekleme suresi kaliciligi (sistem_donus-isinlanma.js paritesi). */
IF OBJECT_ID('dbo.WebCharMarks') IS NOT NULL
   AND COL_LENGTH('dbo.WebCharMarks', 'tpReadyAt') IS NULL
  ALTER TABLE dbo.WebCharMarks ADD tpReadyAt bigint NULL;
GO

/* B3) WebBugReport.context — TEK baglam kolonu. Eski bir .bak'ta bu kolon
   yoksa eklenir; eski contextJson kolonu varsa BILEREK birakilir ama artik
   kullanilmaz (yeni kod yalnizca [context] yazar). */
IF OBJECT_ID('dbo.WebBugReport') IS NOT NULL
   AND COL_LENGTH('dbo.WebBugReport', 'context') IS NULL
  ALTER TABLE dbo.WebBugReport ADD [context] nvarchar(max) NULL;
GO

/* B4) BILDIRIM PANELI (2026-09-05): WebBugReport'un 8 GM/istemci kolonu +
   WebFeatureRequest tablosu + iki `ref` indeksi. Taze kurulumda bunlari
   02_web_semasi.sql zaten kurar; burasi ESKI bir .bak'tan geri yukleyenler
   icindir. Sunucu (admin_bildirim.js semaHazirla) ayni esitlemeyi acilista
   kendisi de yapar — ama KISITLI bir SQL kullanicisinda ALTER/CREATE reddedilir,
   hata yutulur ve panel SESSIZCE calismaz; bu betik yetkili bir oturumda TEK
   SEFERDE ayni isi bitirir. Hepsi idempotenttir. */
IF OBJECT_ID('dbo.WebBugReport') IS NOT NULL
BEGIN
  IF COL_LENGTH('dbo.WebBugReport','subject')    IS NULL ALTER TABLE dbo.WebBugReport ADD [subject]   varchar(40)   NULL;
  IF COL_LENGTH('dbo.WebBugReport','subjectRef') IS NULL ALTER TABLE dbo.WebBugReport ADD subjectRef  nvarchar(400) NULL;
  IF COL_LENGTH('dbo.WebBugReport','pos')        IS NULL ALTER TABLE dbo.WebBugReport ADD pos         varchar(200)  NULL;
  IF COL_LENGTH('dbo.WebBugReport','shotFile')   IS NULL ALTER TABLE dbo.WebBugReport ADD shotFile    varchar(64)   NULL;
  IF COL_LENGTH('dbo.WebBugReport','status')     IS NULL ALTER TABLE dbo.WebBugReport ADD [status]    varchar(20)   NOT NULL CONSTRAINT DF_WBR_st DEFAULT ('acik');
  IF COL_LENGTH('dbo.WebBugReport','gmNote')     IS NULL ALTER TABLE dbo.WebBugReport ADD gmNote      nvarchar(max) NULL;
  IF COL_LENGTH('dbo.WebBugReport','gmJID')      IS NULL ALTER TABLE dbo.WebBugReport ADD gmJID       int           NULL;
  IF COL_LENGTH('dbo.WebBugReport','updatedAt')  IS NULL ALTER TABLE dbo.WebBugReport ADD updatedAt   datetime      NULL;
END
GO

IF OBJECT_ID('dbo.WebFeatureRequest') IS NULL
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
);
GO

IF OBJECT_ID('dbo.WebBugReport') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_WebBugReport_ref' AND object_id=OBJECT_ID('dbo.WebBugReport'))
  CREATE INDEX IX_WebBugReport_ref ON dbo.WebBugReport(ref);
IF OBJECT_ID('dbo.WebFeatureRequest') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_WebFeatureRequest_ref' AND object_id=OBJECT_ID('dbo.WebFeatureRequest'))
  CREATE INDEX IX_WebFeatureRequest_ref ON dbo.WebFeatureRequest(ref);
GO

/* B-DOGRULAMA: kolon/tablo/indeksin hepsi var olmali (tum sutunlar 1 donmeli). */
SELECT CASE WHEN COL_LENGTH('dbo.WebCharPet','bagSlot')       IS NULL THEN 0 ELSE 1 END AS petBagSlot,
       CASE WHEN COL_LENGTH('dbo.WebCharGrowthPet','acik')    IS NULL THEN 0 ELSE 1 END AS gpetAcik,
       CASE WHEN COL_LENGTH('dbo.WebCharMarks','tpReadyAt')   IS NULL THEN 0 ELSE 1 END AS tpReadyAt,
       CASE WHEN COL_LENGTH('dbo.WebBugReport','context')     IS NULL THEN 0 ELSE 1 END AS bugContext,
       CASE WHEN COL_LENGTH('dbo.WebBugReport','status')      IS NULL THEN 0 ELSE 1 END AS bugStatus,
       CASE WHEN COL_LENGTH('dbo.WebBugReport','shotFile')    IS NULL THEN 0 ELSE 1 END AS bugShotFile,
       CASE WHEN OBJECT_ID('dbo.WebFeatureRequest')           IS NULL THEN 0 ELSE 1 END AS ozellikIstegi,
       CASE WHEN EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_WebFeatureRequest_ref') THEN 1 ELSE 0 END AS ozellikRefIdx;
GO
