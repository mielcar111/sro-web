/* =============================================================================
 * 02_web_semasi.sql — SRO_WEB_GAME oyun-yani semasi (25 tablo + indeksler)
 *
 * NE YAPAR: bu sunucuya ozgu, vSRO'da karsiligi OLMAYAN sistemlerin tablolarini
 * kurar. Kural: vSRO'da karsiligi olan hicbir sey buraya girmez
 * (karakter/envanter/beceri -> SRO_VT_SHARD; uyelik/silk -> SRO_VT_ACCOUNT).
 *
 * 25 tablo:
 *   WebWallet, WebExchangeOrder, WebExchangeTrade, WebStake   (Silk ekonomisi)
 *   WebPremium                                                (premium uyelik)
 *   WebAchievement, WebReferral, WebSocialLink                (basarim/sosyal)
 *   WebBugReport, WebFeatureRequest                           (hata bildirimi +
 *                                                              ozellik istegi)
 *   WebAuction, WebAuctionBid                                 (muzayede)
 *   WebCharUi, WebCharGrowthPet, WebCharCarrier, WebCharMarks (karakter basina)
 *   WebPartyMatch, WebPartyMatchApplication                   (parti esleme)
 *   WebUniqueKill, WebGmLog                                   (unique/GM kaydi)
 *   WebCharInventory, WebCharInventoryEk                      (canta sayfa 8-12
 *                                                              + maxDur/rolls)
 *   WebBank, WebBankInfo                                      (banka/depo)
 *   WebCharZone                                               (son bolge)
 *
 * DEGISIKLIK (2026-09-04): 5 tablo (WebCharInventory, WebCharInventoryEk,
 * WebBank, WebBankInfo, WebCharZone) EKLENDI. Onceden yalnizca sunucu kodu
 * calisma zamaninda kuruyordu, bu QUERY setinde hic yoklardi — sifirdan kuran
 * biri "tablolar eksik" goruyordu. Simdi kurulumun parcasilar; sunucudaki
 * IF OBJECT_ID korumalari yerinde kaldigi icin cakisma olmaz.
 *
 * DEGISIKLIK (2026-09-05): BILDIRIM PANELI semasi eklendi — WebFeatureRequest
 * tablosu, WebBugReport'un 8 GM/istemci kolonu (subject, subjectRef, pos,
 * shotFile, status, gmNote, gmJID, updatedAt) ve iki `ref` indeksi. Bunlari da
 * onceden yalnizca sunucu (server/admin_bildirim.js semaHazirla) calisma
 * zamaninda kuruyordu; KISITLI bir SQL kullanicisiyla kurulumda CREATE TABLE
 * reddedilir, hata yutulur ve hata/ozellik bildirim paneli SESSIZCE calismazdi.
 *
 * NOT: Bu dosyada OLMAYAN, baska dosyalarda kurulan tablolar: WebGuild* (03),
 * WebCharProfession (04), WebCharPet (06). 06_shard_parite.sql ayrica calisma
 * zamani kolon eklerini (bagSlot / acik / tpReadyAt / context + bildirim
 * kolonlari) esitler.
 *
 * KOSUM SIRASI:
 *   ONCE : 01_web_veritabani.sql
 *   SONRA: 03_lonca_semasi.sql
 *
 * KAYNAK: server/setup_web_schema.mjs (ayni is `node setup_web_schema.mjs` ile de
 * yapilir; o betik bu tablolara ek olarak WebCharPet [burada 06] ve
 * WebCharProfession [burada 04] tablolarini da kurar — sonuc ayni) +
 * server/admin_bildirim.js (WebFeatureRequest / WebBugReport ek kolonlari).
 * ============================================================================= */

USE SRO_WEB_GAME;
GO

/* ---------------------------------------------------------------- Silk cuzdan */
IF OBJECT_ID('dbo.WebWallet') IS NULL
CREATE TABLE dbo.WebWallet (
  JID             int          NOT NULL PRIMARY KEY,
  jadeUnits       bigint       NOT NULL CONSTRAINT DF_WW_j  DEFAULT (0),
  jadeLockedUnits bigint       NOT NULL CONSTRAINT DF_WW_jl DEFAULT (0),
  depositAddress  varchar(64)  NULL,
  updatedAt       datetime     NOT NULL CONSTRAINT DF_WW_u  DEFAULT (GETDATE())
);
GO

/* ---------------------------------------------------- borsa (Silk <-> altin) */
IF OBJECT_ID('dbo.WebExchangeOrder') IS NULL
CREATE TABLE dbo.WebExchangeOrder (
  id           uniqueidentifier NOT NULL PRIMARY KEY CONSTRAINT DF_WEO_id DEFAULT (NEWID()),
  JID          int          NOT NULL,
  side         varchar(4)   NOT NULL,      -- buy | sell
  price        bigint       NOT NULL,
  qtyUnits     bigint       NOT NULL,
  filledUnits  bigint       NOT NULL CONSTRAINT DF_WEO_f DEFAULT (0),
  status       varchar(10)  NOT NULL CONSTRAINT DF_WEO_s DEFAULT ('open'),  -- open|filled|cancelled
  createdAt    datetime     NOT NULL CONSTRAINT DF_WEO_c DEFAULT (GETDATE())
);
GO

IF OBJECT_ID('dbo.WebExchangeTrade') IS NULL
CREATE TABLE dbo.WebExchangeTrade (
  id         bigint IDENTITY(1,1) PRIMARY KEY,
  price      bigint      NOT NULL,
  units      bigint      NOT NULL,
  takerSide  varchar(4)  NOT NULL,
  makerJID   int         NULL,
  takerJID   int         NULL,
  createdAt  datetime    NOT NULL CONSTRAINT DF_WET_c DEFAULT (GETDATE())
);
GO

IF OBJECT_ID('dbo.WebStake') IS NULL
CREATE TABLE dbo.WebStake (
  id             uniqueidentifier NOT NULL PRIMARY KEY CONSTRAINT DF_WS_id DEFAULT (NEWID()),
  JID            int       NOT NULL,
  principalUnits bigint    NOT NULL,
  aprBps         int       NOT NULL,       -- yillik getiri, baz puan (2000 = %20)
  lockDays       int       NOT NULL,       -- 7 | 30 | 90
  rewardUnits    bigint    NOT NULL CONSTRAINT DF_WS_r DEFAULT (0),
  startedAt      datetime  NOT NULL CONSTRAINT DF_WS_s DEFAULT (GETDATE()),
  unlockAt       datetime  NOT NULL,
  status         varchar(10) NOT NULL CONSTRAINT DF_WS_st DEFAULT ('active') -- active|claimed
);
GO

/* -------------------------------------------------------------------- premium */
IF OBJECT_ID('dbo.WebPremium') IS NULL
CREATE TABLE dbo.WebPremium (
  JID       int          NOT NULL PRIMARY KEY,
  tier      varchar(10)  NULL,             -- bronze | silver | gold
  expiresAt datetime     NULL,
  updatedAt datetime     NOT NULL CONSTRAINT DF_WP_u DEFAULT (GETDATE())
);
GO

/* ------------------------------------------------------------------ basarimlar */
IF OBJECT_ID('dbo.WebAchievement') IS NULL
CREATE TABLE dbo.WebAchievement (
  JID           int          NOT NULL,
  achievementId varchar(64)  NOT NULL,
  grantedAt     datetime     NOT NULL CONSTRAINT DF_WA_g DEFAULT (GETDATE()),
  CONSTRAINT PK_WebAchievement PRIMARY KEY (JID, achievementId)
);
GO

/* -------------------------------------------------------------- davet / sosyal */
IF OBJECT_ID('dbo.WebReferral') IS NULL
CREATE TABLE dbo.WebReferral (
  JID         int          NOT NULL PRIMARY KEY,
  code        varchar(24)  NOT NULL,
  invitedBy   int          NULL,
  rewardPaid  bit          NOT NULL CONSTRAINT DF_WR_p DEFAULT (0),
  createdAt   datetime     NOT NULL CONSTRAINT DF_WR_c DEFAULT (GETDATE())
);
GO

IF OBJECT_ID('dbo.WebSocialLink') IS NULL
CREATE TABLE dbo.WebSocialLink (
  JID        int           NOT NULL,
  provider   varchar(20)   NOT NULL,       -- discord | ...
  externalId varchar(64)   NOT NULL,
  username   nvarchar(100) NULL,
  linkedAt   datetime      NOT NULL CONSTRAINT DF_WSL_l DEFAULT (GETDATE()),
  rewardPaid bit           NOT NULL CONSTRAINT DF_WSL_r DEFAULT (0),
  CONSTRAINT PK_WebSocialLink PRIMARY KEY (JID, provider)
);
GO

/* ------------------------------------------------------------- hata bildirimi */
/* Son 8 kolon (subject..updatedAt) istemcinin gonderdigi ek alanlar + GM is
   akisi kolonlaridir; sunucu (admin_bildirim.js) bunlari eski kurulumlara
   ALTER TABLE ile ekler, taze kurulumda burada hazir gelirler. Kolon SIRASI
   bilerek "once eski 13, sonra yeni 8" — ve [context] bilerek createdAt'ten
   SONRA gelir (canlida da ALTER ile oraya eklendi); boylece ALTER ile buyumus
   bir veritabani ile bu betikle kurulan veritabani ORDINAL SIRAYA KADAR ayni
   olur (SELECT * ciktilari ayrismaz).
   Hepsi NULL kabul eder ya da DEFAULT'ludur; WebAddBugReport yordami (05)
   yalnizca eski kolonlari yazdigi icin degismeden calisir. */
IF OBJECT_ID('dbo.WebBugReport') IS NULL
CREATE TABLE dbo.WebBugReport (
  id          bigint IDENTITY(1,1) PRIMARY KEY,
  ref         varchar(16)   NOT NULL,
  JID         int           NULL,
  CharID      int           NULL,
  category    varchar(40)   NULL,
  severity    varchar(20)   NULL,
  frequency   varchar(20)   NULL,
  title       nvarchar(200) NULL,
  description nvarchar(max) NULL,
  zoneId      varchar(40)   NULL,
  clientVer   varchar(40)   NULL,
  createdAt   datetime      NOT NULL CONSTRAINT DF_WBR_c DEFAULT (GETDATE()),
  [context]   nvarchar(max) NULL, -- TEK baglam kolonu (istemcinin sohbet baglami buraya)
  [subject]   varchar(40)   NULL, -- istemcinin sectigi konu anahtari
  subjectRef  nvarchar(400) NULL, -- konuya bagli serbest metin (NPC/esya adi vb.)
  pos         varchar(200)  NULL, -- bildirim anindaki konum (bolge + koordinat)
  shotFile    varchar(64)   NULL, -- data/bug-screenshots altindaki dosya adi
  [status]    varchar(20)   NOT NULL CONSTRAINT DF_WBR_st DEFAULT ('acik'),
  gmNote      nvarchar(max) NULL,
  gmJID       int           NULL,
  updatedAt   datetime      NULL
);
GO

/* ------------------------------------------------------------ ozellik istegi */
/* Hata bildiriminin kardesi; GM panelinde ayri sekmede listelenir.
   CharID kolonu BILEREK YOK: istemci yalnizca {title, description, clientVersion}
   gonderiyor.  KAYNAK: server/admin_bildirim.js  semaHazirla() */
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

/* ------------------------------------------------------------------- muzayede */
IF OBJECT_ID('dbo.WebAuction') IS NULL
CREATE TABLE dbo.WebAuction (
  id           uniqueidentifier NOT NULL PRIMARY KEY CONSTRAINT DF_WAU_id DEFAULT (NEWID()),
  sellerJID    int           NOT NULL,
  sellerName   nvarchar(32)  NULL,
  itemJson     nvarchar(max) NOT NULL,
  startPrice   bigint        NOT NULL,
  buyNowPrice  bigint        NOT NULL,
  currentBid   bigint        NOT NULL CONSTRAINT DF_WAU_b DEFAULT (0),
  bidCount     int           NOT NULL CONSTRAINT DF_WAU_bc DEFAULT (0),
  topBidderJID int           NULL,
  endsAt       datetime      NOT NULL,
  status       varchar(16)   NOT NULL CONSTRAINT DF_WAU_s DEFAULT ('active'),
  finalPrice   bigint        NULL,
  claimed      bit           NOT NULL CONSTRAINT DF_WAU_c DEFAULT (0)
);
GO

IF OBJECT_ID('dbo.WebAuctionBid') IS NULL
CREATE TABLE dbo.WebAuctionBid (
  id        bigint IDENTITY(1,1) PRIMARY KEY,
  auctionId uniqueidentifier NOT NULL,
  JID       int      NOT NULL,
  amount    bigint   NOT NULL,
  at        datetime NOT NULL CONSTRAINT DF_WAB_at DEFAULT (GETDATE())
);
GO

/* ------------------------------------------- karakter basina (vSRO'da yok) */
IF OBJECT_ID('dbo.WebCharUi') IS NULL
CREATE TABLE dbo.WebCharUi (
  CharID        int           NOT NULL PRIMARY KEY,
  hotbarJson    nvarchar(max) NULL,        -- hotbar.save
  autoPotionJson nvarchar(max) NULL,       -- autopotion.save
  macroJson     nvarchar(max) NULL,        -- macro.save
  updatedAt     datetime      NOT NULL CONSTRAINT DF_WCU_u DEFAULT (GETDATE())
);
GO

IF OBJECT_ID('dbo.WebCharGrowthPet') IS NULL
CREATE TABLE dbo.WebCharGrowthPet (
  CharID   int          NOT NULL PRIMARY KEY,
  bagSlot  int          NOT NULL,
  mode     varchar(12)  NOT NULL CONSTRAINT DF_WGP_m DEFAULT ('offensive'),
  level    int          NOT NULL CONSTRAINT DF_WGP_l DEFAULT (1),
  xp       bigint       NOT NULL CONSTRAINT DF_WGP_x DEFAULT (0),
  updatedAt datetime    NOT NULL CONSTRAINT DF_WGP_u DEFAULT (GETDATE())
);
GO

IF OBJECT_ID('dbo.WebCharCarrier') IS NULL
CREATE TABLE dbo.WebCharCarrier (
  CharID    int           NOT NULL PRIMARY KEY,
  phase     varchar(10)   NOT NULL CONSTRAINT DF_WCC_p DEFAULT ('idle'),
  zoneId    varchar(40)   NULL,
  posX      float         NULL,
  posZ      float         NULL,
  slotsJson nvarchar(max) NULL,
  slotsMax  int           NOT NULL CONSTRAINT DF_WCC_sm DEFAULT (5),
  readyAt   datetime      NULL
);
GO

IF OBJECT_ID('dbo.WebCharMarks') IS NULL
CREATE TABLE dbo.WebCharMarks (
  CharID    int           NOT NULL PRIMARY KEY,
  deathJson nvarchar(400) NULL,
  retJson   nvarchar(400) NULL,
  updatedAt datetime      NOT NULL CONSTRAINT DF_WCM_u DEFAULT (GETDATE())
);
GO

/* ----------------------------------------------------------------- parti esleme */
IF OBJECT_ID('dbo.WebPartyMatch') IS NULL
CREATE TABLE dbo.WebPartyMatch (
  matchId     int IDENTITY(1,1) PRIMARY KEY,
  leaderCharID int          NOT NULL,
  title       nvarchar(100) NOT NULL,
  raceReq     varchar(16)   NULL,
  minLevel    int           NOT NULL CONSTRAINT DF_WPM_mn DEFAULT (1),
  maxLevel    int           NOT NULL CONSTRAINT DF_WPM_mx DEFAULT (999),
  maxMembers  int           NOT NULL CONSTRAINT DF_WPM_mm DEFAULT (8),
  expShare    bit           NOT NULL CONSTRAINT DF_WPM_e DEFAULT (1),
  itemShare   bit           NOT NULL CONSTRAINT DF_WPM_i DEFAULT (1),
  ltp         bit           NOT NULL CONSTRAINT DF_WPM_l DEFAULT (0),
  isOpen      bit           NOT NULL CONSTRAINT DF_WPM_o DEFAULT (1),
  createdAt   datetime      NOT NULL CONSTRAINT DF_WPM_c DEFAULT (GETDATE())
);
GO

IF OBJECT_ID('dbo.WebPartyMatchApplication') IS NULL
CREATE TABLE dbo.WebPartyMatchApplication (
  id        bigint IDENTITY(1,1) PRIMARY KEY,
  matchId   int      NOT NULL,
  CharID    int      NOT NULL,
  status    varchar(12) NOT NULL CONSTRAINT DF_WPA_s DEFAULT ('pending'),
  at        datetime NOT NULL CONSTRAINT DF_WPA_at DEFAULT (GETDATE())
);
GO

/* ---------------------------------------------- benzersiz (unique) canavarlar */
IF OBJECT_ID('dbo.WebUniqueKill') IS NULL
CREATE TABLE dbo.WebUniqueKill (
  id         bigint IDENTITY(1,1) PRIMARY KEY,
  monsterId  varchar(64)  NOT NULL,
  zoneId     varchar(40)  NULL,
  killerName nvarchar(32) NULL,
  killedAt   datetime     NOT NULL CONSTRAINT DF_WUK_k DEFAULT (GETDATE()),
  nextSpawnAt datetime    NULL
);
GO

IF OBJECT_ID('dbo.WebGmLog') IS NULL
CREATE TABLE dbo.WebGmLog (
  id       bigint IDENTITY(1,1) PRIMARY KEY,
  JID      int           NOT NULL,
  charName varchar(64)   NULL,
  command  nvarchar(400) NOT NULL,
  ok       bit           NOT NULL,
  at       datetime      NOT NULL CONSTRAINT DF_WGL_at DEFAULT (GETDATE())
);
GO

/* ==============================================================================
 * CALISMA ZAMANINDA KURULAN TABLOLAR
 * ------------------------------------------------------------------------------
 * Bu 5 tablo daha once BU QUERY SETINDE HIC YOKTU: yalnizca sunucu kodu, ilgili
 * sistem ilk kez calistiginda kuruyordu. Sifirdan kuran biri icin sonuc
 * "veritabani eksik gorunuyor" oluyordu (01+02 sonrasi 25 tablo; bu 5'i ancak
 * oyuna girip banka acinca / bolge degistirince olusuyordu). Artik kurulumun
 * parcasi. DDL metinleri sunucunun KENDI CREATE TABLE ifadelerinden BIREBIR
 * alindi; sunucudaki IF OBJECT_ID korumalari yerinde kalir, onlar icin bu
 * yalnizca "zaten var" demektir.
 * ============================================================================== */

/* Canta sayfa 8-12 yuvalari. vSRO'nun _Inventory.Slot kolonu TINYINT oldugu
   icin Slot > 239 oraya YAZILAMAZ (bkz. 06_shard_parite.sql Mimari A); o
   yuvalar burada yasar.  KAYNAK: server/kalicilik.js  tabloKur() */
IF OBJECT_ID('dbo.WebCharInventory') IS NULL
CREATE TABLE dbo.WebCharInventory (
  CharID    int          NOT NULL,
  Kap       varchar(16)  NOT NULL,
  Slot      smallint     NOT NULL,
  StackJson nvarchar(max) NOT NULL,
  CONSTRAINT PK_WebCharInventory PRIMARY KEY (CharID, Kap, Slot)
);
GO

/* vSRO'da SUTUNU OLMAYAN esya alanlari (maxDur / rolls). (CharID,Kap,Slot) ile
   anahtarlanir - _Items ile AYRI veritabaninda oldugumuz icin ID64 tek islemde
   garanti edilemez, yuva anahtari ise WebCharInventory ile ayni islemde
   yazilabilir.  KAYNAK: server/kalicilik.js  tabloKur() */
IF OBJECT_ID('dbo.WebCharInventoryEk') IS NULL
CREATE TABLE dbo.WebCharInventoryEk (
  CharID int          NOT NULL,
  Kap    varchar(16)  NOT NULL,
  Slot   smallint     NOT NULL,
  EkJson nvarchar(max) NOT NULL,
  CONSTRAINT PK_WebCharInventoryEk PRIMARY KEY (CharID, Kap, Slot)
);
GO

/* Banka/depo (hesap basina, karakter basina DEGIL).
   KAYNAK: server/sistem_banka-depo.js  semayiKur() */
IF OBJECT_ID('dbo.WebBank') IS NULL
CREATE TABLE dbo.WebBank (
  JID int NOT NULL, Slot int NOT NULL, StackJson nvarchar(max) NOT NULL,
  CONSTRAINT PK_WebBank PRIMARY KEY (JID, Slot)
);
GO

IF OBJECT_ID('dbo.WebBankInfo') IS NULL
CREATE TABLE dbo.WebBankInfo (
  JID int NOT NULL PRIMARY KEY, Capacity int NOT NULL,
  updatedAt datetime NOT NULL CONSTRAINT DF_WebBankInfo_upd DEFAULT GETDATE()
);
GO

/* Karakterin son bolgesi. RAM en taze kaynaktir; bu tablo yalnizca sunucu
   yeniden baslatmasini kopruler (yoksa herkes baslangic bolgesinde uyanir).
   KAYNAK: server/routes_auth.js  bolgeTablosuKur() */
IF OBJECT_ID('dbo.WebCharZone') IS NULL
CREATE TABLE dbo.WebCharZone (
  CharID    int         NOT NULL CONSTRAINT PK_WebCharZone PRIMARY KEY,
  Zone      varchar(64) NOT NULL,
  UpdatedAt datetime    NOT NULL CONSTRAINT DF_WebCharZone_At DEFAULT GETDATE()
);
GO

/* ------------------------------------------------------------------ INDEKSLER */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_WEO_JID')  CREATE INDEX IX_WEO_JID ON dbo.WebExchangeOrder(JID, status);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_WEO_book') CREATE INDEX IX_WEO_book ON dbo.WebExchangeOrder(status, side, price);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_WS_JID')   CREATE INDEX IX_WS_JID ON dbo.WebStake(JID, status);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_WAU_st')   CREATE INDEX IX_WAU_st ON dbo.WebAuction(status, endsAt);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_WAB_a')    CREATE INDEX IX_WAB_a ON dbo.WebAuctionBid(auctionId);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='UX_WR_code')  CREATE UNIQUE INDEX UX_WR_code ON dbo.WebReferral(code);
/* Bildirim paneli HER islemi `ref` uzerinden yapar (KAYNAK: admin_bildirim.js). */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_WebBugReport_ref' AND object_id=OBJECT_ID('dbo.WebBugReport'))
  CREATE INDEX IX_WebBugReport_ref ON dbo.WebBugReport(ref);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_WebFeatureRequest_ref' AND object_id=OBJECT_ID('dbo.WebFeatureRequest'))
  CREATE INDEX IX_WebFeatureRequest_ref ON dbo.WebFeatureRequest(ref);
GO

/* ------------------------------------------------------------------- KONTROL */
SELECT COUNT(*) AS tabloSayisi FROM sys.tables;   -- 01+02 sonrasi 31 beklenir
/* Sirasiyla: 01 -> 6 tablo, 02 -> 25 tablo. Kalan 8 tablo sonraki dosyalarda:
   03 lonca 6, 04 meslek 1, 06 WebCharPet 1  ->  kurulum sonunda 39 tablo. */
GO
