/* =============================================================================
 * 04_meslek_semasi.sql — MESLEK (toplayici/zanaatkar) kaliciligi: 1 tablo + 2 yordam
 *
 * NEDEN AYRI TABLO: SRO_WEB_GAME'deki hazir yordamlarin hicbiri meslek
 * tutmuyor. SHARD'daki _CharTrijob vSRO'nun tuccar/avci/hirsiz isidir —
 * bu sunucunun toplayici/zanaatkar meslegi DEGIL. Bu yuzden WebCharUi kalibina
 * birebir benzeyen kucuk bir tablo + iki yordam kurulur.
 *
 * KOSUM SIRASI:
 *   ONCE : 01_web_veritabani.sql (SRO_WEB_GAME var olmali)
 *   SONRA: 05_yordamlar.sql
 *
 * Yeniden kosmak zararsizdir (IF OBJECT_ID korumasi + CREATE OR ALTER).
 * KAYNAK: server/kur_meslek_semasi.mjs (ayni is `node kur_meslek_semasi.mjs` ile de yapilir).
 * ============================================================================= */

USE SRO_WEB_GAME;
GO

/* -------------------------------------------------------------------- TABLO */
IF OBJECT_ID('dbo.WebCharProfession','U') IS NULL
BEGIN
  CREATE TABLE dbo.WebCharProfession (
    CharID       INT           NOT NULL,
    ProfessionID NVARCHAR(32)  NOT NULL,
    Lvl          INT           NOT NULL CONSTRAINT DF_WebCharProfession_Lvl DEFAULT(1),
    Xp           INT           NOT NULL CONSTRAINT DF_WebCharProfession_Xp  DEFAULT(0),
    LearnedAt    DATETIME      NOT NULL CONSTRAINT DF_WebCharProfession_At  DEFAULT(GETDATE()),
    UpdatedAt    DATETIME      NOT NULL CONSTRAINT DF_WebCharProfession_Up  DEFAULT(GETDATE()),
    CONSTRAINT PK_WebCharProfession PRIMARY KEY (CharID, ProfessionID)
  );
END
GO

/* ---------------------------------------------------------------- YORDAMLAR */
CREATE OR ALTER PROCEDURE dbo.WebGetCharProfessions
  @CharID INT
AS
BEGIN
  SET NOCOUNT ON;
  SELECT ProfessionID, Lvl, Xp
    FROM dbo.WebCharProfession
   WHERE CharID = @CharID
   ORDER BY LearnedAt;
END
GO

/* MERGE: ogrenme de ilerleme de ayni yordamdan gecer. */
CREATE OR ALTER PROCEDURE dbo.WebSaveCharProfession
  @CharID       INT,
  @ProfessionID NVARCHAR(32),
  @Lvl          INT,
  @Xp           INT
AS
BEGIN
  SET NOCOUNT ON;
  MERGE dbo.WebCharProfession AS h
  USING (SELECT @CharID AS CharID, @ProfessionID AS ProfessionID) AS y
     ON h.CharID = y.CharID AND h.ProfessionID = y.ProfessionID
  WHEN MATCHED THEN
    UPDATE SET Lvl = @Lvl, Xp = @Xp, UpdatedAt = GETDATE()
  WHEN NOT MATCHED THEN
    INSERT (CharID, ProfessionID, Lvl, Xp) VALUES (@CharID, @ProfessionID, @Lvl, @Xp);
END
GO

/* ------------------------------------------------------------------ KONTROL */
SELECT COUNT(*) AS meslekSatiri FROM dbo.WebCharProfession;  -- taze kurulumda 0
GO
