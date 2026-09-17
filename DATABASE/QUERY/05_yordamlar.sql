/* =============================================================================
 * 05_yordamlar.sql — SRO_WEB_GAME sakli yordamlari (30 yordam)
 *
 * NE YAPAR: web tarafinin tum sakli yordamlarini (kayit, giris/oturum,
 * karakter, arayuz durumu, Silk ekonomisi, premium, bakim/tasima, sifre
 * sifirlama, GM yetkisi, hata bildirimi) kurar. Var olan yordam DROP edilip
 * yeniden olusturulur — tekrar kosmak zararsizdir.
 *
 * ONEMLI:
 *   - vSRO'nun kendi yordamlarina DOKUNULMAZ. Karakter olusturma vSRO'nun
 *     _AddNewChar'i CAGRILARAK yapilir, kopyalanmaz.
 *   - Yordamlar uc parcali adla SRO_VT_ACCOUNT / SRO_VT_SHARD'a erisir; bu
 *     veritabanlari yoksa yordamlar yine OLUSUR (ertelenmis ad cozumleme) ama
 *     CALISMAZ — once vSRO .bak'larinizi geri yukleyin.
 *   - WebSetPremium süre hesabi SYSUTCDATETIME ile yapilir (istemci mutlak UTC
 *     epoch bekler; GETDATE kullanilsaydi sure saat dilimi kadar kayardi).
 *     WebSession GETDATE'leri BILEREK yereldir — degistirmeyin.
 *   - CleanDB yordami bu dosyada DEGIL: 07_bakim_CleanDB.sql (bakim araci,
 *     kurulumun parcasi degildir).
 *
 * KOSUM SIRASI:
 *   ONCE : 01..04 + vSRO SHARD/ACCOUNT veritabanlari geri yuklenmis olmali
 *   SONRA: 06_shard_parite.sql
 *
 * KAYNAK: server/setup_procs.mjs (ayni is `node setup_procs.mjs` ile de yapilir).
 * ============================================================================= */

USE SRO_WEB_GAME;
GO

/* --------------------------------------------------------------------- kayit */
IF OBJECT_ID('dbo.WebRegisterAccount') IS NOT NULL DROP PROCEDURE dbo.WebRegisterAccount;
GO
CREATE PROCEDURE dbo.WebRegisterAccount
  @StrUserID   varchar(25),
  @PwHash50    varchar(50),      -- TB_User.password (50 karakter siniri)
  @Email       varchar(50),
  @RegIp       varchar(25),
  @Algo        varchar(20),
  @Salt        varchar(64),
  @Hash        varchar(200),
  @QuestionId  tinyint,
  @AnswerSalt  varchar(64) = NULL,
  @AnswerHash  varchar(200) = NULL,
  @RefCode     varchar(24) = NULL,
  @InvitedBy   int = NULL,
  @JID         int OUTPUT
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;

  IF EXISTS (SELECT 1 FROM SRO_VT_ACCOUNT.dbo.TB_User WHERE StrUserID = @StrUserID)
  BEGIN RAISERROR('user_taken', 16, 1); RETURN; END;
  IF @Email IS NOT NULL AND LEN(@Email) > 0
     AND EXISTS (SELECT 1 FROM SRO_VT_ACCOUNT.dbo.TB_User WHERE Email = @Email)
  BEGIN RAISERROR('email_taken', 16, 1); RETURN; END;

  BEGIN TRAN;
    INSERT INTO SRO_VT_ACCOUNT.dbo.TB_User
      (StrUserID, password, Email, Status, GMrank, regtime, reg_ip,
       sec_primary, sec_content, AccPlayTime, LatestUpdateTime_ToPlayTime, Play123Time)
    /* DIKKAT: vSRO'da GM yetkisi sec_primary=1 VE sec_content=1 ile verilir
       (varsayilan 3 = normal oyuncu). Bu yuzden guvenlik sorusu numarasini
       BURAYA YAZMIYORUZ - yoksa 1 numarali soruyu secen herkes GM olurdu.
       Soru numarasi SRO_WEB_GAME.WebSecurity.questionId'de tutulur. */
    VALUES (@StrUserID, @PwHash50, @Email, 1, 0, GETDATE(), @RegIp,
            3, 3, 0, 0, 0);
    SET @JID = SCOPE_IDENTITY();

    /* MERGE: veritabani sifirlanip JID'ler basa donerse bayat satirla
       cakismayalim - INSERT yerine varsa guncelle. */
    MERGE dbo.WebAuth AS t USING (SELECT @JID AS JID) AS s ON t.JID = s.JID
    WHEN MATCHED THEN UPDATE SET algo=@Algo, salt=@Salt, hash=@Hash, updatedAt=GETDATE()
    WHEN NOT MATCHED THEN INSERT (JID, algo, salt, hash) VALUES (@JID, @Algo, @Salt, @Hash);

    IF @AnswerHash IS NOT NULL
      MERGE dbo.WebSecurity AS t USING (SELECT @JID AS JID) AS s ON t.JID = s.JID
      WHEN MATCHED THEN UPDATE SET questionId=@QuestionId, answerSalt=@AnswerSalt,
                                   answerHash=@AnswerHash, updatedAt=GETDATE()
      WHEN NOT MATCHED THEN INSERT (JID, questionId, answerSalt, answerHash)
        VALUES (@JID, @QuestionId, @AnswerSalt, @AnswerHash);

    IF NOT EXISTS (SELECT 1 FROM dbo.WebWallet WHERE JID=@JID)
      INSERT INTO dbo.WebWallet (JID) VALUES (@JID);
    IF NOT EXISTS (SELECT 1 FROM dbo.WebPremium WHERE JID=@JID)
      INSERT INTO dbo.WebPremium (JID, tier, expiresAt) VALUES (@JID, NULL, NULL);

    IF @RefCode IS NOT NULL
      IF NOT EXISTS (SELECT 1 FROM dbo.WebReferral WHERE JID=@JID)
        INSERT INTO dbo.WebReferral (JID, code, invitedBy) VALUES (@JID, @RefCode, @InvitedBy);

    /* vSRO: _User.UserJID -> _AccountJID.JID yabanci anahtari var.
       Normalde bu satiri GatewayServer ilk giriste olusturur; biz onu
       atladigimiz icin burada olusturuyoruz. Yoksa karakter olusturulamaz:
       "FK__User__AccountJID" ihlali. */
    IF NOT EXISTS (SELECT 1 FROM SRO_VT_SHARD.dbo._AccountJID WHERE JID = @JID)
      INSERT INTO SRO_VT_SHARD.dbo._AccountJID (AccountID, JID, Gold)
      VALUES (@StrUserID, @JID, 0);
  COMMIT;
END
GO

/* --------------------------------------------------------------------- giris */
IF OBJECT_ID('dbo.WebGetAuth') IS NOT NULL DROP PROCEDURE dbo.WebGetAuth;
GO
CREATE PROCEDURE dbo.WebGetAuth
  @StrUserID varchar(25)
AS
BEGIN
  SET NOCOUNT ON;
  SELECT u.JID, u.StrUserID, u.Email, u.Status, u.GMrank,
         u.password,                       -- vSRO MD5 (WebAuth yoksa bununla dogrulariz)
         u.sec_primary, u.sec_content,
         CAST(CASE WHEN u.sec_primary = 1 AND u.sec_content = 1 THEN 1 ELSE 0 END AS bit) AS isGm,
         a.algo, a.salt, a.hash
  FROM SRO_VT_ACCOUNT.dbo.TB_User u
  LEFT JOIN dbo.WebAuth a ON a.JID = u.JID
  WHERE u.StrUserID = @StrUserID;
END
GO

IF OBJECT_ID('dbo.WebCreateSession') IS NOT NULL DROP PROCEDURE dbo.WebCreateSession;
GO
CREATE PROCEDURE dbo.WebCreateSession
  @Token     varchar(64),
  @JID       int,
  @Remember  bit,
  @Ip        varchar(45),
  @UserAgent nvarchar(300)
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @Gun int = CASE WHEN @Remember = 1 THEN 30 ELSE 1 END;
  INSERT INTO dbo.WebSession (token, JID, expiresAt, remember, ip, userAgent, lastSeenAt)
  VALUES (@Token, @JID, DATEADD(day, @Gun, GETDATE()), @Remember, @Ip, @UserAgent, GETDATE());
  UPDATE SRO_VT_ACCOUNT.dbo.TB_User SET Time_log = GETDATE() WHERE JID = @JID;
  SELECT @Gun AS expiresInDays;
END
GO

IF OBJECT_ID('dbo.WebResolveSession') IS NOT NULL DROP PROCEDURE dbo.WebResolveSession;
GO
CREATE PROCEDURE dbo.WebResolveSession
  @Token varchar(64)
AS
BEGIN
  SET NOCOUNT ON;
  UPDATE dbo.WebSession SET lastSeenAt = GETDATE()
  WHERE token = @Token AND expiresAt > GETDATE();

  SELECT s.JID, s.remember, u.StrUserID, u.Email, u.Status, u.GMrank,
         CAST(CASE WHEN u.sec_primary = 1 AND u.sec_content = 1 THEN 1 ELSE 0 END AS bit) AS isGm
  FROM dbo.WebSession s
  JOIN SRO_VT_ACCOUNT.dbo.TB_User u ON u.JID = s.JID
  WHERE s.token = @Token AND s.expiresAt > GETDATE();
END
GO

IF OBJECT_ID('dbo.WebDropSession') IS NOT NULL DROP PROCEDURE dbo.WebDropSession;
GO
CREATE PROCEDURE dbo.WebDropSession @Token varchar(64)
AS
BEGIN
  SET NOCOUNT ON;
  DELETE FROM dbo.WebSession WHERE token = @Token;
END
GO

IF OBJECT_ID('dbo.WebPurgeSessions') IS NOT NULL DROP PROCEDURE dbo.WebPurgeSessions;
GO
CREATE PROCEDURE dbo.WebPurgeSessions
AS
BEGIN
  SET NOCOUNT ON;
  DELETE FROM dbo.WebSession WHERE expiresAt <= GETDATE();
  SELECT @@ROWCOUNT AS silinen;
END
GO

/* ------------------------------------------------------------------ karakter */
/* vSRO'nun _AddNewChar yordamini CAGIRIR - karakter olusturmanin tek dogru yolu.
   O yordam _Char, _User, _Inventory, _Items ve varsayilan becerileri kendisi kurar. */
IF OBJECT_ID('dbo.WebCreateCharacter') IS NOT NULL DROP PROCEDURE dbo.WebCreateCharacter;
GO
CREATE PROCEDURE dbo.WebCreateCharacter
  @JID        int,
  @RefCharID  int,
  @CharName   varchar(64),
  @RegionID   int,
  @PosX       real,
  @PosY       real,
  @PosZ       real,
  @RefMail    int,   @RefPants int, @RefBoots int,
  @RefWeapon  int,   @RefShield int,
  /* vSRO'nun _AddNewChar'inda kafa/omuz/eldiven YOK (Windows istemcisi de
     bu 3 parcayi vermez). bu sunucu ise 8 parca veriyor - olcum:
     head/shoulder/chest/pants/gloves/boots/weapon/shield. Farki burada
     kapatiyoruz; asagida vSRO'nun KENDI _FN_ADD_INITIAL_EQUIP yordamiyla. */
  @RefHead     int = 0,
  @RefShoulder int = 0,
  @RefGloves   int = 0
AS
BEGIN
  SET NOCOUNT ON;
  IF EXISTS (SELECT 1 FROM SRO_VT_SHARD.dbo._Char WHERE CharName16 = @CharName AND Deleted = 0)
  BEGIN RAISERROR('name_taken', 16, 1); RETURN; END;

  /* _User.UserJID icin _AccountJID satiri sart (FK__User__AccountJID).
     Eski hesaplarda eksik olabilir - tamamla. */
  IF NOT EXISTS (SELECT 1 FROM SRO_VT_SHARD.dbo._AccountJID WHERE JID = @JID)
    INSERT INTO SRO_VT_SHARD.dbo._AccountJID (AccountID, JID, Gold)
    SELECT StrUserID, JID, 0 FROM SRO_VT_ACCOUNT.dbo.TB_User WHERE JID = @JID;

  /* vSRO'nun kendi yordami cagrilir - kopyalanmaz.
     NOT: bu shard'daki _AddNewChar satir 369'da _User bagini kuramiyor
     ("Cannot insert the value NULL into column CharID"). Yordama DOKUNMUYORUZ;
     asagida bagi biz tamamliyoruz. Boylece sahipsiz karakter kalmaz. */
  BEGIN TRY
    EXEC SRO_VT_SHARD.dbo._AddNewChar
         @UserJID = @JID, @RefCharID = @RefCharID, @CharName = @CharName,
         @CharScale = 0, @StartRegionID = @RegionID,
         @StartPos_X = @PosX, @StartPos_Y = @PosY, @StartPos_Z = @PosZ,
         @DefaultTeleport = 0,
         @RefMailID = @RefMail, @RefPantsID = @RefPants, @RefBootsID = @RefBoots,
         @RefWeaponID = @RefWeapon, @RefShield = @RefShield,
         @DurMail = 100, @DurPants = 100, @DurBoots = 100,
         @DurWeapon = 100, @DurShield = 100, @DefaultArrow = 0;
  END TRY
  BEGIN CATCH
    /* _AddNewChar kendi islemini (transaction) acik birakiyor; kapatmazsak
       "mismatching number of BEGIN and COMMIT" hatasi cikar.
         XACT_STATE() = -1 -> islem bozuk, geri al
         XACT_STATE() =  1 -> islem saglam, karakter satiri olustu, onayla */
    DECLARE @xs int = XACT_STATE();
    IF @xs = -1 AND @@TRANCOUNT > 0 ROLLBACK;
    ELSE IF @xs = 1 AND @@TRANCOUNT > 0 COMMIT;
    /* _User bagi disindaki gercek hatalari yukari tasi */
    IF ERROR_NUMBER() <> 515 THROW;
  END CATCH

  DECLARE @CharID int;
  SELECT TOP 1 @CharID = CharID FROM SRO_VT_SHARD.dbo._Char
  WHERE CharName16 = @CharName AND Deleted = 0 ORDER BY CharID DESC;

  IF @CharID IS NULL BEGIN RAISERROR('char_not_created', 16, 1); RETURN; END;

  IF NOT EXISTS (SELECT 1 FROM SRO_VT_SHARD.dbo._User WHERE CharID = @CharID)
    INSERT INTO SRO_VT_SHARD.dbo._User (UserJID, CharID) VALUES (@JID, @CharID);

  /* Eksik 3 zirh parcasi. vSRO kusam yuvasi: 0 head, 2 shoulder, 3 gloves.
     _FN_ADD_INITIAL_EQUIP vSRO'nun kendi yordami: yuva dolu mu bakar,
     _STRG_ALLOC_ITEM_NoTX ile Serial64 uretir, _Items + _Inventory yazar.
     Dayaniklilik 100 - _AddNewChar diger parcalara da 100 veriyor. */
  DECLARE @rc int;
  IF @RefHead     > 0 EXEC @rc = SRO_VT_SHARD.dbo._FN_ADD_INITIAL_EQUIP @CharID, 0, @RefHead,     100;
  IF @RefShoulder > 0 EXEC @rc = SRO_VT_SHARD.dbo._FN_ADD_INITIAL_EQUIP @CharID, 2, @RefShoulder, 100;
  IF @RefGloves   > 0 EXEC @rc = SRO_VT_SHARD.dbo._FN_ADD_INITIAL_EQUIP @CharID, 3, @RefGloves,   100;

  SELECT @CharID AS CharID;
END
GO

IF OBJECT_ID('dbo.WebListCharacters') IS NOT NULL DROP PROCEDURE dbo.WebListCharacters;
GO
CREATE PROCEDURE dbo.WebListCharacters @JID int
AS
BEGIN
  SET NOCOUNT ON;
  SELECT c.CharID, c.RefObjID, c.CharName16, c.CurLevel, c.ExpOffset, c.SExpOffset,
         c.Strength, c.Intellect, c.RemainGold, c.RemainSkillPoint, c.RemainStatPoint,
         c.HP, c.MP, c.LatestRegion, c.PosX, c.PosY, c.PosZ, c.InventorySize,
         s.style, s.race, s.gender
  FROM SRO_VT_SHARD.dbo._Char c
  JOIN SRO_VT_SHARD.dbo._User u ON u.CharID = c.CharID
  LEFT JOIN dbo.WebCharStyle s ON s.refObjId = c.RefObjID
  WHERE u.UserJID = @JID AND c.Deleted = 0
  ORDER BY c.CharID;
END
GO

IF OBJECT_ID('dbo.WebDeleteCharacter') IS NOT NULL DROP PROCEDURE dbo.WebDeleteCharacter;
GO
CREATE PROCEDURE dbo.WebDeleteCharacter @JID int, @CharID int
AS
BEGIN
  SET NOCOUNT ON;
  UPDATE c SET c.Deleted = 1
  FROM SRO_VT_SHARD.dbo._Char c
  JOIN SRO_VT_SHARD.dbo._User u ON u.CharID = c.CharID
  WHERE u.UserJID = @JID AND c.CharID = @CharID;
  SELECT @@ROWCOUNT AS silinen;
END
GO

IF OBJECT_ID('dbo.WebSaveCharPos') IS NOT NULL DROP PROCEDURE dbo.WebSaveCharPos;
GO
CREATE PROCEDURE dbo.WebSaveCharPos
  @CharID int, @RegionID int, @PosX real, @PosY real, @PosZ real,
  @HP int, @MP int
AS
BEGIN
  SET NOCOUNT ON;
  UPDATE SRO_VT_SHARD.dbo._Char
  SET LatestRegion = @RegionID, PosX = @PosX, PosY = @PosY, PosZ = @PosZ,
      HP = @HP, MP = @MP, LastLogout = GETDATE()
  WHERE CharID = @CharID;
END
GO

/* ------------------------------------------------------------- arayuz durumu */
IF OBJECT_ID('dbo.WebSaveCharUi') IS NOT NULL DROP PROCEDURE dbo.WebSaveCharUi;
GO
CREATE PROCEDURE dbo.WebSaveCharUi
  @CharID int,
  @Hotbar nvarchar(max) = NULL,
  @AutoPotion nvarchar(max) = NULL,
  @Macro nvarchar(max) = NULL
AS
BEGIN
  SET NOCOUNT ON;
  MERGE dbo.WebCharUi AS t USING (SELECT @CharID AS CharID) AS s ON t.CharID = s.CharID
  WHEN MATCHED THEN UPDATE SET
    hotbarJson     = COALESCE(@Hotbar, t.hotbarJson),
    autoPotionJson = COALESCE(@AutoPotion, t.autoPotionJson),
    macroJson      = COALESCE(@Macro, t.macroJson),
    updatedAt      = GETDATE()
  WHEN NOT MATCHED THEN
    INSERT (CharID, hotbarJson, autoPotionJson, macroJson)
    VALUES (@CharID, @Hotbar, @AutoPotion, @Macro);
END
GO

/* ------------------------------------------------------------ Silk ekonomisi */
IF OBJECT_ID('dbo.WebGetWallet') IS NOT NULL DROP PROCEDURE dbo.WebGetWallet;
GO
CREATE PROCEDURE dbo.WebGetWallet @JID int
AS
BEGIN
  SET NOCOUNT ON;
  IF NOT EXISTS (SELECT 1 FROM dbo.WebWallet WHERE JID = @JID)
    IF NOT EXISTS (SELECT 1 FROM dbo.WebWallet WHERE JID=@JID)
      INSERT INTO dbo.WebWallet (JID) VALUES (@JID);
  SELECT JID, jadeUnits, jadeLockedUnits, depositAddress FROM dbo.WebWallet WHERE JID = @JID;
END
GO

IF OBJECT_ID('dbo.WebPlaceOrder') IS NOT NULL DROP PROCEDURE dbo.WebPlaceOrder;
GO
CREATE PROCEDURE dbo.WebPlaceOrder
  @JID int, @Side varchar(4), @Price bigint, @QtyUnits bigint
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;
  IF @Side NOT IN ('buy','sell') BEGIN RAISERROR('bad_side',16,1); RETURN; END;
  IF @Price <= 0 OR @QtyUnits <= 0 BEGIN RAISERROR('bad_amount',16,1); RETURN; END;

  BEGIN TRAN;
    IF @Side = 'sell'
    BEGIN
      DECLARE @free bigint = (SELECT jadeUnits - jadeLockedUnits FROM dbo.WebWallet WHERE JID=@JID);
      IF @free IS NULL OR @free < @QtyUnits
      BEGIN ROLLBACK; RAISERROR('insufficient_jade',16,1); RETURN; END;
      UPDATE dbo.WebWallet SET jadeLockedUnits = jadeLockedUnits + @QtyUnits, updatedAt=GETDATE()
      WHERE JID = @JID;
    END
    DECLARE @out TABLE (id uniqueidentifier);
    INSERT INTO dbo.WebExchangeOrder (JID, side, price, qtyUnits)
    OUTPUT INSERTED.id INTO @out
    VALUES (@JID, @Side, @Price, @QtyUnits);
  COMMIT;
  SELECT id FROM @out;
END
GO

IF OBJECT_ID('dbo.WebCancelOrder') IS NOT NULL DROP PROCEDURE dbo.WebCancelOrder;
GO
CREATE PROCEDURE dbo.WebCancelOrder @JID int, @OrderId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;
  BEGIN TRAN;
    DECLARE @side varchar(4), @qty bigint, @filled bigint;
    SELECT @side = side, @qty = qtyUnits, @filled = filledUnits
    FROM dbo.WebExchangeOrder WITH (UPDLOCK)
    WHERE id = @OrderId AND JID = @JID AND status = 'open';
    IF @side IS NULL BEGIN ROLLBACK; RAISERROR('no_order',16,1); RETURN; END;

    UPDATE dbo.WebExchangeOrder SET status = 'cancelled' WHERE id = @OrderId;
    IF @side = 'sell'
      UPDATE dbo.WebWallet SET jadeLockedUnits = jadeLockedUnits - (@qty - @filled), updatedAt=GETDATE()
      WHERE JID = @JID;
  COMMIT;
END
GO

IF OBJECT_ID('dbo.WebGetBook') IS NOT NULL DROP PROCEDURE dbo.WebGetBook;
GO
CREATE PROCEDURE dbo.WebGetBook @Depth int = 20
AS
BEGIN
  SET NOCOUNT ON;
  SELECT TOP (@Depth) price, SUM(qtyUnits - filledUnits) AS units, 'buy' AS side
  FROM dbo.WebExchangeOrder WHERE status='open' AND side='buy'
  GROUP BY price ORDER BY price DESC;

  SELECT TOP (@Depth) price, SUM(qtyUnits - filledUnits) AS units, 'sell' AS side
  FROM dbo.WebExchangeOrder WHERE status='open' AND side='sell'
  GROUP BY price ORDER BY price ASC;
END
GO

IF OBJECT_ID('dbo.WebCreateStake') IS NOT NULL DROP PROCEDURE dbo.WebCreateStake;
GO
CREATE PROCEDURE dbo.WebCreateStake
  @JID int, @PrincipalUnits bigint, @LockDays int, @AprBps int
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;
  IF @LockDays NOT IN (7,30,90) BEGIN RAISERROR('bad_lock',16,1); RETURN; END;
  BEGIN TRAN;
    DECLARE @free bigint = (SELECT jadeUnits - jadeLockedUnits FROM dbo.WebWallet WHERE JID=@JID);
    IF @free IS NULL OR @free < @PrincipalUnits
    BEGIN ROLLBACK; RAISERROR('insufficient_jade',16,1); RETURN; END;

    UPDATE dbo.WebWallet SET jadeLockedUnits = jadeLockedUnits + @PrincipalUnits, updatedAt=GETDATE()
    WHERE JID = @JID;

    DECLARE @reward bigint = (@PrincipalUnits * @AprBps * @LockDays) / (10000 * 365);
    INSERT INTO dbo.WebStake (JID, principalUnits, aprBps, lockDays, rewardUnits, unlockAt)
    VALUES (@JID, @PrincipalUnits, @AprBps, @LockDays, @reward, DATEADD(day, @LockDays, GETDATE()));
  COMMIT;
END
GO

IF OBJECT_ID('dbo.WebClaimStake') IS NOT NULL DROP PROCEDURE dbo.WebClaimStake;
GO
CREATE PROCEDURE dbo.WebClaimStake @JID int, @StakeId uniqueidentifier
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;
  BEGIN TRAN;
    DECLARE @p bigint, @r bigint;
    SELECT @p = principalUnits, @r = rewardUnits
    FROM dbo.WebStake WITH (UPDLOCK)
    WHERE id = @StakeId AND JID = @JID AND status = 'active' AND unlockAt <= GETDATE();
    IF @p IS NULL BEGIN ROLLBACK; RAISERROR('not_claimable',16,1); RETURN; END;

    UPDATE dbo.WebStake SET status = 'claimed' WHERE id = @StakeId;
    UPDATE dbo.WebWallet
      SET jadeLockedUnits = jadeLockedUnits - @p,
          jadeUnits = jadeUnits + @r,
          updatedAt = GETDATE()
    WHERE JID = @JID;
  COMMIT;
  SELECT @p AS principal, @r AS reward;
END
GO

/* ------------------------------------------------------------------- premium */
IF OBJECT_ID('dbo.WebSetPremium') IS NOT NULL DROP PROCEDURE dbo.WebSetPremium;
GO
CREATE PROCEDURE dbo.WebSetPremium @JID int, @Tier varchar(10), @Days int
AS
BEGIN
  SET NOCOUNT ON;
  /* expiresAt UTC yazilir: JS tarafi degeri UTC epoch sayar; makine saat
     dilimi ileri/geri ise GETDATE() sureyi o kadar kaydirir. Istemci de
     mutlak UTC epoch bekler. KARSILASTIRMA da UTC olmali: yoksa bitisine az
     kalan satir yanlis dala girer (uzatma yerine sifirlama). updatedAt
     GETDATE KALIR - denetim alani. WebSession GETDATE'lerine DOKUNULMAZ
     (SQL icinde yerel-yerel karsilastiriliyor; UTC'ye cekilirse herkes
     cikis yapar). */
  MERGE dbo.WebPremium AS t USING (SELECT @JID AS JID) AS s ON t.JID = s.JID
  WHEN MATCHED THEN UPDATE SET
    tier = @Tier,
    expiresAt = DATEADD(day, @Days,
      CASE WHEN t.expiresAt > SYSUTCDATETIME() THEN t.expiresAt ELSE SYSUTCDATETIME() END),
    updatedAt = GETDATE()
  WHEN NOT MATCHED THEN INSERT (JID, tier, expiresAt)
    VALUES (@JID, @Tier, DATEADD(day, @Days, SYSUTCDATETIME()));
  SELECT tier, expiresAt FROM dbo.WebPremium WHERE JID = @JID;
END
GO

/* -------------------------------------------------------------- bakim/tasima */
/* Windows istemcisiyle acilmis (WebAuth kaydi olmayan) bir hesap web'de
   dogru sifreyle giris yapinca cagrilir: guclu ozet olusturulur. */
IF OBJECT_ID('dbo.WebMigrateAuth') IS NOT NULL DROP PROCEDURE dbo.WebMigrateAuth;
GO
CREATE PROCEDURE dbo.WebMigrateAuth
  @JID int, @Algo varchar(20), @Salt varchar(64), @Hash varchar(200)
AS
BEGIN
  SET NOCOUNT ON;
  MERGE dbo.WebAuth AS t USING (SELECT @JID AS JID) AS s ON t.JID = s.JID
  WHEN MATCHED THEN UPDATE SET algo=@Algo, salt=@Salt, hash=@Hash, updatedAt=GETDATE()
  WHEN NOT MATCHED THEN INSERT (JID, algo, salt, hash) VALUES (@JID, @Algo, @Salt, @Hash);
  IF NOT EXISTS (SELECT 1 FROM dbo.WebWallet  WHERE JID=@JID) INSERT INTO dbo.WebWallet (JID) VALUES (@JID);
  IF NOT EXISTS (SELECT 1 FROM dbo.WebPremium WHERE JID=@JID) INSERT INTO dbo.WebPremium (JID) VALUES (@JID);
  IF NOT EXISTS (SELECT 1 FROM SRO_VT_SHARD.dbo._AccountJID WHERE JID=@JID)
    INSERT INTO SRO_VT_SHARD.dbo._AccountJID (AccountID, JID, Gold)
    SELECT StrUserID, JID, 0 FROM SRO_VT_ACCOUNT.dbo.TB_User WHERE JID=@JID;
END
GO

/* ZOMBI hesaplari bulur/temizler.
   Zombi = TB_User'da satiri var, WebAuth kaydi YOK ve TB_User.password
   gecerli bir vSRO MD5'i DEGIL. Boyle bir hesapla ne giris yapilabilir
   ne de ayni adla kayit olunabilir.
   @Fix=0 -> sadece listele   @Fix=1 -> sil (karakterleriyle birlikte) */
IF OBJECT_ID('dbo.WebRepairOrphans') IS NOT NULL DROP PROCEDURE dbo.WebRepairOrphans;
GO
CREATE PROCEDURE dbo.WebRepairOrphans @Fix bit = 0
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @zombi TABLE (JID int PRIMARY KEY, StrUserID varchar(25), karakter int);

  INSERT INTO @zombi (JID, StrUserID, karakter)
  SELECT u.JID, u.StrUserID,
         (SELECT COUNT(*) FROM SRO_VT_SHARD.dbo._User su WHERE su.UserJID = u.JID)
  FROM SRO_VT_ACCOUNT.dbo.TB_User u
  LEFT JOIN dbo.WebAuth a ON a.JID = u.JID
  WHERE a.JID IS NULL
    AND (u.password IS NULL OR LEN(u.password) <> 32
         OR u.password LIKE '%[^0-9a-fA-F]%');   -- vSRO MD5 degil

  IF @Fix = 0
  BEGIN
    SELECT JID, StrUserID, karakter, 'silinecek' AS durum FROM @zombi ORDER BY JID;
    RETURN;
  END;

  BEGIN TRAN;
    DELETE c FROM SRO_VT_SHARD.dbo._Char c
      JOIN SRO_VT_SHARD.dbo._User su ON su.CharID = c.CharID
      JOIN @zombi z ON z.JID = su.UserJID;
    DELETE su FROM SRO_VT_SHARD.dbo._User su JOIN @zombi z ON z.JID = su.UserJID;
    DELETE aj FROM SRO_VT_SHARD.dbo._AccountJID aj JOIN @zombi z ON z.JID = aj.JID;
    DELETE w  FROM dbo.WebSecurity  w JOIN @zombi z ON z.JID = w.JID;
    DELETE w  FROM dbo.WebSession   w JOIN @zombi z ON z.JID = w.JID;
    DELETE w  FROM dbo.WebWallet    w JOIN @zombi z ON z.JID = w.JID;
    DELETE w  FROM dbo.WebPremium   w JOIN @zombi z ON z.JID = w.JID;
    DELETE w  FROM dbo.WebReferral  w JOIN @zombi z ON z.JID = w.JID;
    DELETE u  FROM SRO_VT_ACCOUNT.dbo.TB_User u JOIN @zombi z ON z.JID = u.JID;
  COMMIT;

  SELECT COUNT(*) AS silinen FROM @zombi;
END
GO

/* ---------------------------------------------------------- sifre sifirlama */
/* Guvenlik sorusu SRO_WEB_GAME.WebSecurity'de tutulur (TB_User.sec_primary
   GM bayragi oldugu icin oraya YAZILMAZ). Cevap tuzlanip ozetlenir. */
IF OBJECT_ID('dbo.WebGetSecurityQuestion') IS NOT NULL DROP PROCEDURE dbo.WebGetSecurityQuestion;
GO
CREATE PROCEDURE dbo.WebGetSecurityQuestion @StrUserID varchar(25)
AS
BEGIN
  SET NOCOUNT ON;
  SELECT u.JID, u.StrUserID,
         s.questionId,
         COALESCE(s.questionText, q.text) AS questionText,
         CAST(CASE WHEN s.JID IS NULL THEN 0 ELSE 1 END AS bit) AS hasSecurity
  FROM SRO_VT_ACCOUNT.dbo.TB_User u
  LEFT JOIN dbo.WebSecurity s ON s.JID = u.JID
  LEFT JOIN dbo.WebSecurityQuestion q ON q.id = s.questionId
  WHERE u.StrUserID = @StrUserID;
END
GO

IF OBJECT_ID('dbo.WebGetSecurityAnswer') IS NOT NULL DROP PROCEDURE dbo.WebGetSecurityAnswer;
GO
CREATE PROCEDURE dbo.WebGetSecurityAnswer @StrUserID varchar(25)
AS
BEGIN
  SET NOCOUNT ON;
  SELECT u.JID, s.answerSalt, s.answerHash
  FROM SRO_VT_ACCOUNT.dbo.TB_User u
  JOIN dbo.WebSecurity s ON s.JID = u.JID
  WHERE u.StrUserID = @StrUserID;
END
GO

/* Cevap DOGRULANDIKTAN SONRA cagrilir. Tum oturumlari da kapatir. */
IF OBJECT_ID('dbo.WebResetPassword') IS NOT NULL DROP PROCEDURE dbo.WebResetPassword;
GO
CREATE PROCEDURE dbo.WebResetPassword
  @JID int, @PwHash50 varchar(50), @Algo varchar(20),
  @Salt varchar(64), @Hash varchar(200)
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;
  BEGIN TRAN;
    UPDATE SRO_VT_ACCOUNT.dbo.TB_User SET password = @PwHash50 WHERE JID = @JID;
    IF @@ROWCOUNT = 0 BEGIN ROLLBACK; RAISERROR('no_user', 16, 1); RETURN; END;

    MERGE dbo.WebAuth AS t USING (SELECT @JID AS JID) AS s ON t.JID = s.JID
    WHEN MATCHED THEN UPDATE SET algo=@Algo, salt=@Salt, hash=@Hash, updatedAt=GETDATE()
    WHEN NOT MATCHED THEN INSERT (JID, algo, salt, hash) VALUES (@JID, @Algo, @Salt, @Hash);

    /* sifre degisti - acik tum oturumlari dusur */
    DELETE FROM dbo.WebSession WHERE JID = @JID;
  COMMIT;
END
GO

IF OBJECT_ID('dbo.WebSetSecurity') IS NOT NULL DROP PROCEDURE dbo.WebSetSecurity;
GO
CREATE PROCEDURE dbo.WebSetSecurity
  @JID int, @QuestionId tinyint, @QuestionText nvarchar(200) = NULL,
  @AnswerSalt varchar(64), @AnswerHash varchar(200)
AS
BEGIN
  SET NOCOUNT ON;
  MERGE dbo.WebSecurity AS t USING (SELECT @JID AS JID) AS s ON t.JID = s.JID
  WHEN MATCHED THEN UPDATE SET questionId=@QuestionId, questionText=@QuestionText,
                               answerSalt=@AnswerSalt, answerHash=@AnswerHash, updatedAt=GETDATE()
  WHEN NOT MATCHED THEN INSERT (JID, questionId, questionText, answerSalt, answerHash)
    VALUES (@JID, @QuestionId, @QuestionText, @AnswerSalt, @AnswerHash);
END
GO

IF OBJECT_ID('dbo.WebListSecurityQuestions') IS NOT NULL DROP PROCEDURE dbo.WebListSecurityQuestions;
GO
CREATE PROCEDURE dbo.WebListSecurityQuestions
AS
BEGIN
  SET NOCOUNT ON;
  SELECT id, text FROM dbo.WebSecurityQuestion ORDER BY id;
END
GO

/* ---------------------------------------------------------------- GM yetkisi */
/* vSRO kurali: sec_primary = 1 VE sec_content = 1  ->  hesap GM.
   Normal oyuncuda ikisi de 3'tur. */
IF OBJECT_ID('dbo.WebSetGm') IS NOT NULL DROP PROCEDURE dbo.WebSetGm;
GO
CREATE PROCEDURE dbo.WebSetGm @StrUserID varchar(25), @Gm bit
AS
BEGIN
  SET NOCOUNT ON;
  UPDATE SRO_VT_ACCOUNT.dbo.TB_User
  SET sec_primary = CASE WHEN @Gm = 1 THEN 1 ELSE 3 END,
      sec_content = CASE WHEN @Gm = 1 THEN 1 ELSE 3 END
  WHERE StrUserID = @StrUserID;
  IF @@ROWCOUNT = 0 BEGIN RAISERROR('no_user', 16, 1); RETURN; END;
  SELECT JID, StrUserID, sec_primary, sec_content,
         CAST(CASE WHEN sec_primary=1 AND sec_content=1 THEN 1 ELSE 0 END AS bit) AS isGm
  FROM SRO_VT_ACCOUNT.dbo.TB_User WHERE StrUserID = @StrUserID;
END
GO

IF OBJECT_ID('dbo.WebListGms') IS NOT NULL DROP PROCEDURE dbo.WebListGms;
GO
CREATE PROCEDURE dbo.WebListGms
AS
BEGIN
  SET NOCOUNT ON;
  SELECT JID, StrUserID, Email, Status
  FROM SRO_VT_ACCOUNT.dbo.TB_User
  WHERE sec_primary = 1 AND sec_content = 1
  ORDER BY JID;
END
GO

IF OBJECT_ID('dbo.WebLogGmAction') IS NOT NULL DROP PROCEDURE dbo.WebLogGmAction;
GO
CREATE PROCEDURE dbo.WebLogGmAction
  @JID int, @CharName varchar(64) = NULL, @Command nvarchar(400), @Ok bit
AS
BEGIN
  SET NOCOUNT ON;
  INSERT INTO dbo.WebGmLog (JID, charName, command, ok) VALUES (@JID, @CharName, @Command, @Ok);
END
GO

/* ------------------------------------------------------------ hata bildirimi */
/* Tek baglam kolonu [context] (istemcinin sohbet baglami). Eski contextJson
   kolonu kaldirildi ve geri EKLENMEYECEK - iki paralel baglam kolonu
   baglami ikiye boler. */
IF OBJECT_ID('dbo.WebAddBugReport') IS NOT NULL DROP PROCEDURE dbo.WebAddBugReport;
GO
CREATE PROCEDURE dbo.WebAddBugReport
  @Ref varchar(16), @JID int = NULL, @CharID int = NULL,
  @Category varchar(40) = NULL, @Severity varchar(20) = NULL,
  @Frequency varchar(20) = NULL, @Title nvarchar(200) = NULL,
  @Description nvarchar(max) = NULL, @ZoneId varchar(40) = NULL,
  @ClientVer varchar(40) = NULL, @Context nvarchar(max) = NULL
AS
BEGIN
  SET NOCOUNT ON;
  INSERT INTO dbo.WebBugReport
    (ref, JID, CharID, category, severity, frequency, title, description, zoneId, clientVer, [context])
  VALUES (@Ref, @JID, @CharID, @Category, @Severity, @Frequency, @Title, @Description,
          @ZoneId, @ClientVer, @Context);
  SELECT SCOPE_IDENTITY() AS id;
END
GO

/* --------------------------------------------------------- ozellik istegi ekle */
/* WebAddBugReport kalibinin AYNISI, daha az alanla: ozellik isteginde CharID
   YOKTUR (istemci yalniz {title, description, clientVersion} gonderir; tablo da
   bu yuzden CharID kolonu tasimaz - bkz. 02_web_semasi.sql).
   Panelin GM is akisi (durum degistirme / not yazma) yordam kullanmaz, dogrudan
   UPDATE ile calisir; bu yuzden kurulumda TEK yordam yeter.
   KAYNAK: server/admin_bildirim.js  semaHazirla() */
IF OBJECT_ID('dbo.WebAddFeatureRequest') IS NOT NULL DROP PROCEDURE dbo.WebAddFeatureRequest;
GO
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
END
GO

/* ------------------------------------------------------------------- KONTROL */
SELECT COUNT(*) AS yordamSayisi FROM sys.procedures;  -- 03+04+05 sonrasi en az 42 beklenir
GO
