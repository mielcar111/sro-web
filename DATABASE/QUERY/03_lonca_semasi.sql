/* =============================================================================
 * 03_lonca_semasi.sql — LONCA sistemi: 6 tablo + 10 yordam (PAROLASIZ KOPYA)
 *
 * Bu dosya server/sistem_lonca_sema.sql'in QUERY kopyasidir; icerik birebir,
 * yalnizca kosum ornegindeki parola yer tutucuya cevrilmistir.
 *
 * ONEMLI: server/sistem_lonca_sema.sql PAKETTE YERINDE DURMALIDIR — sunucu
 * (sistem_lonca.js semaKur) o dosyayi CALISMA ZAMANINDA server/ klasorunden
 * okur; tasinirsa lonca kaliciligi sessizce kapanir. Yani bu betigi elle
 * kosmasaniz bile sunucu ilk lonca kurulumunda ayni semayi kendisi kurar;
 * elle kosum sifirdan kurulumda "her sey hazir" garantisi icindir.
 *
 * KOSUM SIRASI:
 *   ONCE : 01_web_veritabani.sql (SRO_WEB_GAME var olmali)
 *   SONRA: 04_meslek_semasi.sql
 *
 * Kosum ornegi:
 *   sqlcmd -S localhost -U <kullanici> -P <parolaniz> -C -d SRO_WEB_GAME -i 03_lonca_semasi.sql
 * ============================================================================= */

/* =============================================================================
 * sistem_lonca_sema.sql — LONCA sistemi icin SRO_WEB_GAME semasi + yordamlari
 *
 * ONERIDIR. Bu dosyayi ANA OTURUM calistiracak; sistem_lonca.js tablolar
 * olmadan da (ctx.web null iken) BELLEKTE calisir, sadece kalicilik olmaz.
 *
 * Neden SRO_WEB_GAME?  SRO_VT_SHARD'daki vSRO tablolari (_Guild/_GuildMember/
 * _GuildChest) bu sunucunun modelini tasiyamiyor: metin lonca kimligi, xp/rating/
 * notice, 5 bitlik yetki maskesi, basvuru listesi, kayit defteri ve
 * {plus,dur,maxDur,variance,blues,rolls} tasiyan kasa yigini yok
 * (_GuildChest yalnizca ItemID bigint tutuyor).
 * ============================================================================= */

USE SRO_WEB_GAME;
GO

/* ------------------------------------------------------------------ TABLOLAR */

IF OBJECT_ID('dbo.WebGuild', 'U') IS NULL
CREATE TABLE dbo.WebGuild (
    GuildID       int           IDENTITY(1,1) NOT NULL PRIMARY KEY,
    Name          nvarchar(16)  NOT NULL,          -- ZFt: 3..16, harfle baslar
    NameKey       nvarchar(16)  NOT NULL,          -- LOWER(Name) - benzersizlik
    Lvl           int           NOT NULL CONSTRAINT DF_WebGuild_Lvl    DEFAULT (1),
    Xp            int           NOT NULL CONSTRAINT DF_WebGuild_Xp     DEFAULT (0),
    Rating        int           NOT NULL CONSTRAINT DF_WebGuild_Rating DEFAULT (0),
    Notice        nvarchar(500) NOT NULL CONSTRAINT DF_WebGuild_Notice DEFAULT (N''),
    MasterCharID  int           NOT NULL,
    Gold          bigint        NOT NULL CONSTRAINT DF_WebGuild_Gold   DEFAULT (0),
    CreatedAt     bigint        NOT NULL,          -- epoch ms
    CONSTRAINT UQ_WebGuild_NameKey UNIQUE (NameKey)
);
GO

IF OBJECT_ID('dbo.WebGuildMember', 'U') IS NULL
CREATE TABLE dbo.WebGuildMember (
    CharID        int        NOT NULL PRIMARY KEY,  -- bir karakter TEK loncada
    GuildID       int        NOT NULL,
    Rank          varchar(8) NOT NULL,              -- master|officer|member|recruit
    Perms         int        NOT NULL CONSTRAINT DF_WebGuildMember_Perms DEFAULT (0),
    ContributedXp int        NOT NULL CONSTRAINT DF_WebGuildMember_Xp    DEFAULT (0),
    JoinedAt      bigint     NOT NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_WebGuildMember_GuildID')
CREATE INDEX IX_WebGuildMember_GuildID ON dbo.WebGuildMember (GuildID);
GO

IF OBJECT_ID('dbo.WebGuildApplication', 'U') IS NULL
CREATE TABLE dbo.WebGuildApplication (
    GuildID   int    NOT NULL,
    CharID    int    NOT NULL,
    AppliedAt bigint NOT NULL,
    CONSTRAINT PK_WebGuildApplication PRIMARY KEY (GuildID, CharID)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_WebGuildApplication_CharID')
CREATE INDEX IX_WebGuildApplication_CharID ON dbo.WebGuildApplication (CharID);
GO

/* Kasa yigini S$ semasinin TAMAMINI tasimali (plus/dur/maxDur/variance/blues/
   rolls). Sutunlara acmak yerine JSON: sema istemci tarafindan geliyor ve
   ileride alan eklenirse tablo degismesin. */
IF OBJECT_ID('dbo.WebGuildChest', 'U') IS NULL
CREATE TABLE dbo.WebGuildChest (
    GuildID   int            NOT NULL,
    Slot      int            NOT NULL,          -- 0..127 (istemci semasinin siniri)
    StackJson nvarchar(max)  NOT NULL,
    CONSTRAINT PK_WebGuildChest PRIMARY KEY (GuildID, Slot)
);
GO

IF OBJECT_ID('dbo.WebGuildLog', 'U') IS NULL
CREATE TABLE dbo.WebGuildLog (
    LogID     bigint       IDENTITY(1,1) NOT NULL PRIMARY KEY,
    GuildID   int          NOT NULL,
    At        bigint       NOT NULL,
    ActorName nvarchar(64) NOT NULL,
    -- istemcinin lIt tablosundaki 15 eylem: create/join/leave/kick/promote/
    -- demote/perms/notice/transfer/level_up/deposit_gold/withdraw_gold/
    -- deposit_item/withdraw_item/disband
    Action    varchar(16)  NOT NULL,
    ItemDefId varchar(64)  NULL,
    Quantity  int          NULL,
    Gold      bigint       NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_WebGuildLog_GuildID_At')
CREATE INDEX IX_WebGuildLog_GuildID_At ON dbo.WebGuildLog (GuildID, At DESC);
GO

/* Loncadan AYRILMA cezasi (locale: 24 saat). Atilan/loncasi dagilan cezalanmaz. */
IF OBJECT_ID('dbo.WebGuildPenalty', 'U') IS NULL
CREATE TABLE dbo.WebGuildPenalty (
    CharID int    NOT NULL PRIMARY KEY,
    Until  bigint NOT NULL                       -- epoch ms
);
GO

/* ----------------------------------------------------------------- YORDAMLAR */

/* Acilista her seyi tek turda oku: 5 sonuc kumesi.
   Ad/seviye/irk _Char'dan JOIN ile geliyor - kopya tutmuyoruz. */
IF OBJECT_ID('dbo.WebLoadGuilds', 'P') IS NOT NULL DROP PROCEDURE dbo.WebLoadGuilds;
GO
CREATE PROCEDURE dbo.WebLoadGuilds
AS
BEGIN
    SET NOCOUNT ON;

    SELECT GuildID, Name, Lvl, Xp, Rating, Notice, MasterCharID, Gold, CreatedAt
      FROM dbo.WebGuild;

    SELECT m.GuildID, m.CharID, m.Rank, m.Perms, m.ContributedXp, m.JoinedAt,
           c.CharName16 AS CharName, c.CurLevel AS CharLevel,
           CAST(NULL AS varchar(16)) AS Race
      FROM dbo.WebGuildMember m
      LEFT JOIN SRO_VT_SHARD.dbo._Char c ON c.CharID = m.CharID;

    SELECT a.GuildID, a.CharID, a.AppliedAt,
           c.CharName16 AS CharName, c.CurLevel AS CharLevel
      FROM dbo.WebGuildApplication a
      LEFT JOIN SRO_VT_SHARD.dbo._Char c ON c.CharID = a.CharID;

    SELECT GuildID, Slot, StackJson FROM dbo.WebGuildChest;

    SELECT CharID, Until FROM dbo.WebGuildPenalty
     WHERE Until > DATEDIFF_BIG(millisecond, '1970-01-01', GETUTCDATE());
END
GO

/* GuildID 0 gecilirse YENI lonca acar ve uretilen kimligi dondurur. */
IF OBJECT_ID('dbo.WebSaveGuild', 'P') IS NOT NULL DROP PROCEDURE dbo.WebSaveGuild;
GO
CREATE PROCEDURE dbo.WebSaveGuild
    @GuildID      int,
    @Name         nvarchar(16),
    @NameKey      nvarchar(16),
    @Lvl          int,
    @Xp           int,
    @Rating       int,
    @Notice       nvarchar(500),
    @MasterCharID int,
    @Gold         bigint,
    @CreatedAt    bigint
AS
BEGIN
    SET NOCOUNT ON;
    IF @GuildID > 0 AND EXISTS (SELECT 1 FROM dbo.WebGuild WHERE GuildID = @GuildID)
    BEGIN
        UPDATE dbo.WebGuild
           SET Name = @Name, NameKey = @NameKey, Lvl = @Lvl, Xp = @Xp,
               Rating = @Rating, Notice = @Notice, MasterCharID = @MasterCharID,
               Gold = @Gold
         WHERE GuildID = @GuildID;
    END
    ELSE IF @GuildID > 0
    BEGIN
        /* Sunucu kimligi KENDI uretiyor (bellekteki id ile DB'deki ayni olmali),
           bu yuzden acik kimlikle ekliyoruz. */
        SET IDENTITY_INSERT dbo.WebGuild ON;
        INSERT INTO dbo.WebGuild
              (GuildID, Name, NameKey, Lvl, Xp, Rating, Notice, MasterCharID, Gold, CreatedAt)
        VALUES (@GuildID, @Name, @NameKey, @Lvl, @Xp, @Rating, @Notice,
                @MasterCharID, @Gold, @CreatedAt);
        SET IDENTITY_INSERT dbo.WebGuild OFF;
    END
    ELSE
    BEGIN
        INSERT INTO dbo.WebGuild
              (Name, NameKey, Lvl, Xp, Rating, Notice, MasterCharID, Gold, CreatedAt)
        VALUES (@Name, @NameKey, @Lvl, @Xp, @Rating, @Notice,
                @MasterCharID, @Gold, @CreatedAt);
        SET @GuildID = CAST(SCOPE_IDENTITY() AS int);
    END
    SELECT @GuildID AS GuildID;
END
GO

IF OBJECT_ID('dbo.WebDeleteGuild', 'P') IS NOT NULL DROP PROCEDURE dbo.WebDeleteGuild;
GO
CREATE PROCEDURE dbo.WebDeleteGuild @GuildID int
AS
BEGIN
    SET NOCOUNT ON;
    DELETE FROM dbo.WebGuildChest       WHERE GuildID = @GuildID;
    DELETE FROM dbo.WebGuildApplication WHERE GuildID = @GuildID;
    DELETE FROM dbo.WebGuildMember      WHERE GuildID = @GuildID;
    DELETE FROM dbo.WebGuildLog         WHERE GuildID = @GuildID;
    DELETE FROM dbo.WebGuild            WHERE GuildID = @GuildID;
END
GO

IF OBJECT_ID('dbo.WebSaveGuildMember', 'P') IS NOT NULL DROP PROCEDURE dbo.WebSaveGuildMember;
GO
CREATE PROCEDURE dbo.WebSaveGuildMember
    @GuildID int, @CharID int, @Rank varchar(8), @Perms int,
    @ContributedXp int, @JoinedAt bigint
AS
BEGIN
    SET NOCOUNT ON;
    MERGE dbo.WebGuildMember AS t
    USING (SELECT @CharID AS CharID) AS s ON t.CharID = s.CharID
    WHEN MATCHED THEN UPDATE SET
        GuildID = @GuildID, Rank = @Rank, Perms = @Perms,
        ContributedXp = @ContributedXp, JoinedAt = @JoinedAt
    WHEN NOT MATCHED THEN
        INSERT (CharID, GuildID, Rank, Perms, ContributedXp, JoinedAt)
        VALUES (@CharID, @GuildID, @Rank, @Perms, @ContributedXp, @JoinedAt);
END
GO

IF OBJECT_ID('dbo.WebDeleteGuildMember', 'P') IS NOT NULL DROP PROCEDURE dbo.WebDeleteGuildMember;
GO
CREATE PROCEDURE dbo.WebDeleteGuildMember @CharID int
AS
BEGIN
    SET NOCOUNT ON;
    DELETE FROM dbo.WebGuildMember WHERE CharID = @CharID;
END
GO

IF OBJECT_ID('dbo.WebSetGuildApplication', 'P') IS NOT NULL DROP PROCEDURE dbo.WebSetGuildApplication;
GO
CREATE PROCEDURE dbo.WebSetGuildApplication
    @GuildID int, @CharID int, @AppliedAt bigint, @Remove bit = 0
AS
BEGIN
    SET NOCOUNT ON;
    IF @Remove = 1
        DELETE FROM dbo.WebGuildApplication WHERE GuildID = @GuildID AND CharID = @CharID;
    ELSE
        MERGE dbo.WebGuildApplication AS t
        USING (SELECT @GuildID AS GuildID, @CharID AS CharID) AS s
           ON t.GuildID = s.GuildID AND t.CharID = s.CharID
        WHEN MATCHED THEN UPDATE SET AppliedAt = @AppliedAt
        WHEN NOT MATCHED THEN
            INSERT (GuildID, CharID, AppliedAt) VALUES (@GuildID, @CharID, @AppliedAt);
END
GO

/* @StackJson NULL -> yuvayi bosalt. */
IF OBJECT_ID('dbo.WebSetGuildChestSlot', 'P') IS NOT NULL DROP PROCEDURE dbo.WebSetGuildChestSlot;
GO
CREATE PROCEDURE dbo.WebSetGuildChestSlot
    @GuildID int, @Slot int, @StackJson nvarchar(max) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF @StackJson IS NULL
        DELETE FROM dbo.WebGuildChest WHERE GuildID = @GuildID AND Slot = @Slot;
    ELSE
        MERGE dbo.WebGuildChest AS t
        USING (SELECT @GuildID AS GuildID, @Slot AS Slot) AS s
           ON t.GuildID = s.GuildID AND t.Slot = s.Slot
        WHEN MATCHED THEN UPDATE SET StackJson = @StackJson
        WHEN NOT MATCHED THEN
            INSERT (GuildID, Slot, StackJson) VALUES (@GuildID, @Slot, @StackJson);
END
GO

/* Kayit defteri sinirsiz buyumesin: 500'den eskiyi bu lonca icin bicer
   (istemci zaten 10'arli sayfaliyor). */
IF OBJECT_ID('dbo.WebAddGuildLog', 'P') IS NOT NULL DROP PROCEDURE dbo.WebAddGuildLog;
GO
CREATE PROCEDURE dbo.WebAddGuildLog
    @GuildID int, @At bigint, @ActorName nvarchar(64), @Action varchar(16),
    @ItemDefId varchar(64) = NULL, @Quantity int = NULL, @Gold bigint = NULL
AS
BEGIN
    SET NOCOUNT ON;
    INSERT INTO dbo.WebGuildLog (GuildID, At, ActorName, Action, ItemDefId, Quantity, Gold)
    VALUES (@GuildID, @At, @ActorName, @Action, @ItemDefId, @Quantity, @Gold);

    DELETE FROM dbo.WebGuildLog
     WHERE LogID IN (
       SELECT LogID FROM (
         SELECT LogID, ROW_NUMBER() OVER (ORDER BY At DESC, LogID DESC) AS rn
           FROM dbo.WebGuildLog WHERE GuildID = @GuildID) q
        WHERE q.rn > 500);
END
GO

/* Bellekteki kayit defteri sunucu yeniden baslayinca bostur; istenirse
   acilista bu yordamla doldurulabilir (sistem_lonca.js su an kullanmiyor). */
IF OBJECT_ID('dbo.WebGetGuildLog', 'P') IS NOT NULL DROP PROCEDURE dbo.WebGetGuildLog;
GO
CREATE PROCEDURE dbo.WebGetGuildLog @GuildID int, @Take int = 500
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP (@Take) At, ActorName, Action, ItemDefId, Quantity, Gold
      FROM dbo.WebGuildLog
     WHERE GuildID = @GuildID
     ORDER BY At DESC, LogID DESC;
END
GO

IF OBJECT_ID('dbo.WebSetGuildPenalty', 'P') IS NOT NULL DROP PROCEDURE dbo.WebSetGuildPenalty;
GO
CREATE PROCEDURE dbo.WebSetGuildPenalty @CharID int, @Until bigint
AS
BEGIN
    SET NOCOUNT ON;
    MERGE dbo.WebGuildPenalty AS t
    USING (SELECT @CharID AS CharID) AS s ON t.CharID = s.CharID
    WHEN MATCHED THEN UPDATE SET Until = @Until
    WHEN NOT MATCHED THEN INSERT (CharID, Until) VALUES (@CharID, @Until);
END
GO
