/* =============================================================================
 * 07_bakim_CleanDB.sql — CleanDB bakim yordami (KURULUMUN PARCASI DEGILDIR)
 *
 * !!! UYARI — KOSMADAN ONCE OKUYUN !!!
 *   - Bu yordam OYUNCU VERISINI SILER. EXEC dbo.CleanDB varsayilan
 *     parametrelerle KENDI sunucunuzdaki TUM hesap/karakter/esya verisini
 *     temizler (referans tablolarina dokunmaz). Yanlislikla kosmayin.
 *   - Yordamin icindeki adlar UC PARCALI ve SABITTIR:
 *     [SRO_VT_ACCOUNT] / [SRO_VT_SHARD] / [SRO_VT_LOG]. Veritabanlarinizi
 *     farkli adla kurduysaniz once bu adlari degistirin. Ayni nedenle bu
 *     yordam KOPYA/yeniden adlandirilmis veritabanlarini temizlemek icin
 *     KULLANILAMAZ — kopya temizligi kopyanin kendi adiyla duz DELETE ister.
 *   - @Vsro=1 dali SRO_VT_LOG'un da var olmasini bekler; log veritabaniniz
 *     yoksa @Vsro=0 ile yalnizca web tarafini temizleyin (vSRO ifadeleri
 *     zaten tek tek TRY/CATCH icinde kosuldugu icin eksik tablo betigi
 *     durdurmaz, sadece basarisiz sayaci artar).
 *   - Bu dosyayi kosmak yordami yalnizca OLUSTURUR; silme ancak yordami
 *     elle EXEC ettiginizde olur.
 *
 * KULLANIM (yordam olusturulduktan sonra):
 *   EXEC dbo.CleanDB @Report=1        -- hicbir sey silmez, sadece sayar
 *   EXEC dbo.CleanDB                  -- 4 veritabaninda oyuncu verisini siler
 *   EXEC dbo.CleanDB @KeepAccounts=1  -- hesaplari korur, oyun verisini siler
 *   EXEC dbo.CleanDB @SyncOnly=1      -- yalnizca bayat web satirlarini siler
 *
 * KOSUM SIRASI:
 *   ONCE : 01..05 (SRO_WEB_GAME ve tablolar var olmali)
 *   SONRA: — (istege bagli bakim araci; kurulum icin gerekmez)
 *
 * KAYNAK: server/CleanDB.sql (uyari basligi eklenmis kopya; govde birebir).
 * ============================================================================= */

USE SRO_WEB_GAME;
GO

IF OBJECT_ID('dbo.CleanDB', 'P') IS NOT NULL DROP PROCEDURE dbo.CleanDB;
GO

CREATE PROCEDURE dbo.CleanDB
  @Vsro         bit = 1,   -- SRO_VT_ACCOUNT + SRO_VT_LOG + SRO_VT_SHARD
  @Web          bit = 1,   -- SRO_WEB_GAME
  @KeepAccounts bit = 0,   -- 1 = web hesaplarini koru, sadece oyun verisini sil
  @Report       bit = 0,   -- 1 = hicbir sey silme, sadece say
  @SyncOnly     bit = 0    -- 1 = sadece bayat web satirlarini temizle
AS
BEGIN
  SET NOCOUNT ON;

  IF DB_NAME() <> 'SRO_WEB_GAME'
  BEGIN
    RAISERROR('CleanDB yalnizca SRO_WEB_GAME icinde calistirilabilir!', 16, 1);
    RETURN;
  END;

  ---------------------------------------------------------------- rapor
  IF @Report = 1
  BEGIN
    SELECT 'SRO_WEB_GAME' AS veritabani, t.name AS tablo, SUM(p.rows) AS satir
    FROM sys.tables t JOIN sys.partitions p ON p.object_id=t.object_id AND p.index_id IN (0,1)
    GROUP BY t.name HAVING SUM(p.rows) > 0
    UNION ALL SELECT 'SRO_VT_ACCOUNT', 'TB_User', COUNT(*) FROM [SRO_VT_ACCOUNT].[dbo].[TB_User]
    UNION ALL SELECT 'SRO_VT_SHARD', '_Char', COUNT(*) FROM [SRO_VT_SHARD].[dbo].[_Char]
    UNION ALL SELECT 'SRO_VT_SHARD', '_AccountJID', COUNT(*) FROM [SRO_VT_SHARD].[dbo].[_AccountJID]
    ORDER BY veritabani, tablo;
    RETURN;
  END;

  ------------------------------------------------- sadece esitleme
  /* DIKKAT: bu blok yalnizca SAHIPSIZ (bayat) satirlari temizler.
     _Char / TB_User IDENTITY'leri RESEED edildiginde yeni karakter-hesap
     ESKI kimligi devralir; devralinan satir sahipsiz GORUNMEZ, bu yuzden
     bu testle YAKALANAMAZ. Miras temizligi asagidaki kosulsuz blokta. */
  IF @SyncOnly = 1
  BEGIN
    DECLARE @bayat int = 0;
    DELETE w FROM dbo.WebAuth        w WHERE NOT EXISTS (SELECT 1 FROM [SRO_VT_ACCOUNT].[dbo].[TB_User] u WHERE u.JID=w.JID); SET @bayat+=@@ROWCOUNT;
    DELETE w FROM dbo.WebSecurity    w WHERE NOT EXISTS (SELECT 1 FROM [SRO_VT_ACCOUNT].[dbo].[TB_User] u WHERE u.JID=w.JID); SET @bayat+=@@ROWCOUNT;
    DELETE w FROM dbo.WebSession     w WHERE NOT EXISTS (SELECT 1 FROM [SRO_VT_ACCOUNT].[dbo].[TB_User] u WHERE u.JID=w.JID); SET @bayat+=@@ROWCOUNT;
    DELETE w FROM dbo.WebWallet      w WHERE NOT EXISTS (SELECT 1 FROM [SRO_VT_ACCOUNT].[dbo].[TB_User] u WHERE u.JID=w.JID); SET @bayat+=@@ROWCOUNT;
    DELETE w FROM dbo.WebPremium     w WHERE NOT EXISTS (SELECT 1 FROM [SRO_VT_ACCOUNT].[dbo].[TB_User] u WHERE u.JID=w.JID); SET @bayat+=@@ROWCOUNT;
    DELETE w FROM dbo.WebReferral    w WHERE NOT EXISTS (SELECT 1 FROM [SRO_VT_ACCOUNT].[dbo].[TB_User] u WHERE u.JID=w.JID); SET @bayat+=@@ROWCOUNT;
    DELETE w FROM dbo.WebSocialLink  w WHERE NOT EXISTS (SELECT 1 FROM [SRO_VT_ACCOUNT].[dbo].[TB_User] u WHERE u.JID=w.JID); SET @bayat+=@@ROWCOUNT;
    DELETE w FROM dbo.WebAchievement w WHERE NOT EXISTS (SELECT 1 FROM [SRO_VT_ACCOUNT].[dbo].[TB_User] u WHERE u.JID=w.JID); SET @bayat+=@@ROWCOUNT;
    DELETE w FROM dbo.WebGmLog       w WHERE NOT EXISTS (SELECT 1 FROM [SRO_VT_ACCOUNT].[dbo].[TB_User] u WHERE u.JID=w.JID); SET @bayat+=@@ROWCOUNT;
    DELETE w FROM dbo.WebLoginLog    w WHERE w.JID IS NOT NULL AND NOT EXISTS (SELECT 1 FROM [SRO_VT_ACCOUNT].[dbo].[TB_User] u WHERE u.JID=w.JID); SET @bayat+=@@ROWCOUNT;
    DELETE w FROM dbo.WebCharUi        w WHERE NOT EXISTS (SELECT 1 FROM [SRO_VT_SHARD].[dbo].[_Char] c WHERE c.CharID=w.CharID); SET @bayat+=@@ROWCOUNT;
    DELETE w FROM dbo.WebCharGrowthPet w WHERE NOT EXISTS (SELECT 1 FROM [SRO_VT_SHARD].[dbo].[_Char] c WHERE c.CharID=w.CharID); SET @bayat+=@@ROWCOUNT;
    DELETE w FROM dbo.WebCharCarrier   w WHERE NOT EXISTS (SELECT 1 FROM [SRO_VT_SHARD].[dbo].[_Char] c WHERE c.CharID=w.CharID); SET @bayat+=@@ROWCOUNT;
    DELETE w FROM dbo.WebCharMarks     w WHERE NOT EXISTS (SELECT 1 FROM [SRO_VT_SHARD].[dbo].[_Char] c WHERE c.CharID=w.CharID); SET @bayat+=@@ROWCOUNT;
    DELETE w FROM dbo.WebCharInventory   w WHERE NOT EXISTS (SELECT 1 FROM [SRO_VT_SHARD].[dbo].[_Char] c WHERE c.CharID=w.CharID); SET @bayat+=@@ROWCOUNT;
    DELETE w FROM dbo.WebCharInventoryEk w WHERE NOT EXISTS (SELECT 1 FROM [SRO_VT_SHARD].[dbo].[_Char] c WHERE c.CharID=w.CharID); SET @bayat+=@@ROWCOUNT;
    DELETE w FROM dbo.WebCharZone        w WHERE NOT EXISTS (SELECT 1 FROM [SRO_VT_SHARD].[dbo].[_Char] c WHERE c.CharID=w.CharID); SET @bayat+=@@ROWCOUNT;
    DELETE w FROM dbo.WebCharPet         w WHERE NOT EXISTS (SELECT 1 FROM [SRO_VT_SHARD].[dbo].[_Char] c WHERE c.CharID=w.CharID); SET @bayat+=@@ROWCOUNT;
    DELETE w FROM dbo.WebCharProfession  w WHERE NOT EXISTS (SELECT 1 FROM [SRO_VT_SHARD].[dbo].[_Char] c WHERE c.CharID=w.CharID); SET @bayat+=@@ROWCOUNT;
    DELETE w FROM dbo.WebGuildMember     w WHERE NOT EXISTS (SELECT 1 FROM [SRO_VT_SHARD].[dbo].[_Char] c WHERE c.CharID=w.CharID); SET @bayat+=@@ROWCOUNT;
    DELETE w FROM dbo.WebGuildApplication w WHERE NOT EXISTS (SELECT 1 FROM [SRO_VT_SHARD].[dbo].[_Char] c WHERE c.CharID=w.CharID); SET @bayat+=@@ROWCOUNT;
    DELETE w FROM dbo.WebGuildPenalty    w WHERE NOT EXISTS (SELECT 1 FROM [SRO_VT_SHARD].[dbo].[_Char] c WHERE c.CharID=w.CharID); SET @bayat+=@@ROWCOUNT;
    DELETE w FROM dbo.WebPartyMatchApplication w WHERE NOT EXISTS (SELECT 1 FROM [SRO_VT_SHARD].[dbo].[_Char] c WHERE c.CharID=w.CharID); SET @bayat+=@@ROWCOUNT;
    DELETE w FROM dbo.WebPartyMatch      w WHERE NOT EXISTS (SELECT 1 FROM [SRO_VT_SHARD].[dbo].[_Char] c WHERE c.CharID=w.leaderCharID); SET @bayat+=@@ROWCOUNT;
    DELETE w FROM dbo.WebBank            w WHERE NOT EXISTS (SELECT 1 FROM [SRO_VT_ACCOUNT].[dbo].[TB_User] u WHERE u.JID=w.JID); SET @bayat+=@@ROWCOUNT;
    DELETE w FROM dbo.WebBankInfo        w WHERE NOT EXISTS (SELECT 1 FROM [SRO_VT_ACCOUNT].[dbo].[TB_User] u WHERE u.JID=w.JID); SET @bayat+=@@ROWCOUNT;
    DELETE aj FROM [SRO_VT_SHARD].[dbo].[_AccountJID] aj WHERE NOT EXISTS (SELECT 1 FROM [SRO_VT_ACCOUNT].[dbo].[TB_User] u WHERE u.JID=aj.JID);
    DECLARE @aj int = @@ROWCOUNT;
    DELETE su FROM [SRO_VT_SHARD].[dbo].[_User] su WHERE NOT EXISTS (SELECT 1 FROM [SRO_VT_ACCOUNT].[dbo].[TB_User] u WHERE u.JID=su.UserJID);
    SELECT @bayat AS bayatWebSatiri, @aj AS accountJidArtigi, @@ROWCOUNT AS sahipsizKarakterBagi,
           'esitleme tamam' AS sonuc;
    RETURN;
  END;

  ---------------------------------------------------------------- vSRO
  DECLARE @hatalar TABLE (ifade nvarchar(400), hata nvarchar(400));
  DECLARE @basarili int = 0, @basarisiz int = 0;

  IF @Vsro = 1
  BEGIN
    DECLARE @ops TABLE (sira int IDENTITY(1,1) PRIMARY KEY, cmd nvarchar(400));
    INSERT INTO @ops (cmd) VALUES
   (N'TRUNCATE TABLE [SRO_VT_ACCOUNT].[dbo].[TB_User]'),
   (N'DBCC CHECKIDENT (''[SRO_VT_ACCOUNT].[dbo].[TB_User]'', RESEED, 1)'),
   (N'TRUNCATE TABLE [SRO_VT_ACCOUNT].[dbo].[TB_User_Bak]'),
   (N'DBCC CHECKIDENT (''[SRO_VT_ACCOUNT].[dbo].[TB_User_Bak]'', RESEED, 1)'),
   (N'TRUNCATE TABLE [SRO_VT_ACCOUNT].[dbo].[SK_CharRenameLog]'),
   (N'DBCC CHECKIDENT (''[SRO_VT_ACCOUNT].[dbo].[SK_CharRenameLog]'', RESEED, 1)'),
   (N'TRUNCATE TABLE [SRO_VT_ACCOUNT].[dbo].[_Punishment]'),
   (N'DBCC CHECKIDENT (''[SRO_VT_ACCOUNT].[dbo].[_Punishment]'', RESEED, 1)'),
   (N'TRUNCATE TABLE [SRO_VT_ACCOUNT].[dbo].[_ServiceManagerLog]'),
   (N'TRUNCATE TABLE [SRO_VT_ACCOUNT].[dbo].[Test_HN]'),
   (N'TRUNCATE TABLE [SRO_VT_ACCOUNT].[dbo].[_BlockedUser]'),
   (N'TRUNCATE TABLE [SRO_VT_ACCOUNT].[dbo].[_CasGMChatLog]'),
   (N'DBCC CHECKIDENT (''[SRO_VT_ACCOUNT].[dbo].[_CasGMChatLog]'', RESEED, 1)'),
   (N'TRUNCATE TABLE [SRO_VT_ACCOUNT].[dbo].[_Notice]'),
   (N'DBCC CHECKIDENT (''[SRO_VT_ACCOUNT].[dbo].[_Notice]'', RESEED, 1)'),
   (N'TRUNCATE TABLE [SRO_VT_ACCOUNT].[dbo].[_SMCLog]'),
   (N'TRUNCATE TABLE [SRO_VT_ACCOUNT].[dbo].[QuaySoEpoint]'),
   (N'DBCC CHECKIDENT (''[SRO_VT_ACCOUNT].[dbo].[QuaySoEpoint]'', RESEED, 1)'),
   (N'TRUNCATE TABLE [SRO_VT_ACCOUNT].[dbo].[SK_ITEM_GuardLog]'),
   (N'DBCC CHECKIDENT (''[SRO_VT_ACCOUNT].[dbo].[SK_ITEM_GuardLog]'', RESEED, 1)'),
   (N'TRUNCATE TABLE [SRO_VT_ACCOUNT].[dbo].[SK_ItemSaleLog]'),
   (N'DBCC CHECKIDENT (''[SRO_VT_ACCOUNT].[dbo].[SK_ItemSaleLog]'', RESEED, 1)'),
   (N'TRUNCATE TABLE [SRO_VT_ACCOUNT].[dbo].[SK_PackageItemSaleLog]'),
   (N'DBCC CHECKIDENT (''[SRO_VT_ACCOUNT].[dbo].[SK_PackageItemSaleLog]'', RESEED, 1)'),
   (N'TRUNCATE TABLE [SRO_VT_ACCOUNT].[dbo].[SK_PK_UpdateLog]'),
   (N'DBCC CHECKIDENT (''[SRO_VT_ACCOUNT].[dbo].[SK_PK_UpdateLog]'', RESEED, 1)'),
   (N'TRUNCATE TABLE [SRO_VT_ACCOUNT].[dbo].[SK_ResetSkillLog]'),
   (N'DBCC CHECKIDENT (''[SRO_VT_ACCOUNT].[dbo].[SK_ResetSkillLog]'', RESEED, 1)'),
   (N'TRUNCATE TABLE [SRO_VT_ACCOUNT].[dbo].[SK_Silk]'),
   (N'TRUNCATE TABLE [SRO_VT_ACCOUNT].[dbo].[SK_SilkBuyList]'),
   (N'DBCC CHECKIDENT (''[SRO_VT_ACCOUNT].[dbo].[SK_SilkBuyList]'', RESEED, 1)'),
   (N'TRUNCATE TABLE [SRO_VT_ACCOUNT].[dbo].[SK_SilkGoods]'),
   (N'DBCC CHECKIDENT (''[SRO_VT_ACCOUNT].[dbo].[SK_SilkGoods]'', RESEED, 1)'),
   (N'TRUNCATE TABLE [SRO_VT_ACCOUNT].[dbo].[SK_SubtractSilk_VAS]'),
   (N'DBCC CHECKIDENT (''[SRO_VT_ACCOUNT].[dbo].[SK_SubtractSilk_VAS]'', RESEED, 1)'),
   (N'TRUNCATE TABLE [SRO_VT_ACCOUNT].[dbo].[SR_ShardCharNames]'),
   (N'TRUNCATE TABLE [SRO_VT_ACCOUNT].[dbo].[TB_Net2e]'),
   (N'TRUNCATE TABLE [SRO_VT_ACCOUNT].[dbo].[TB_Net2e_Bak]'),
   (N'TRUNCATE TABLE [SRO_VT_ACCOUNT].[dbo].[tb_paygate_trans]'),
   (N'DBCC CHECKIDENT (''[SRO_VT_ACCOUNT].[dbo].[tb_paygate_trans]'', RESEED, 1)'),
   (N'TRUNCATE TABLE [SRO_VT_LOG].[dbo].[_LogCashItem]'),
   (N'TRUNCATE TABLE [SRO_VT_LOG].[dbo].[_LogEventChar]'),
   (N'TRUNCATE TABLE [SRO_VT_LOG].[dbo].[_LogEventItem]'),
   (N'TRUNCATE TABLE [SRO_VT_LOG].[dbo].[_LogEventSiegeFortress]'),
   (N'DBCC CHECKIDENT (''[SRO_VT_LOG].[dbo].[_LogEventSiegeFortress]'', RESEED, 1)'),
   (N'TRUNCATE TABLE [SRO_VT_LOG].[dbo].[_LogSchedule]'),
   (N'DBCC CHECKIDENT (''[SRO_VT_LOG].[dbo].[_LogSchedule]'', RESEED, 1)'),
   (N'TRUNCATE TABLE [SRO_VT_LOG].[dbo].[_LogServerEvent]'),
   (N'DBCC CHECKIDENT (''[SRO_VT_LOG].[dbo].[_LogServerEvent]'', RESEED, 1)'),
   (N'TRUNCATE TABLE [SRO_VT_SHARD].[dbo].[_CharCollectionBook]'),
   (N'TRUNCATE TABLE [SRO_VT_SHARD].[dbo].[_OpenMarket]'),
   (N'TRUNCATE TABLE [SRO_VT_SHARD].[dbo].[_CharSkill]'),
   (N'TRUNCATE TABLE [SRO_VT_SHARD].[dbo].[_CharSkillMastery]'),
   (N'TRUNCATE TABLE [SRO_VT_SHARD].[dbo].[_GuildMember]'),
   (N'TRUNCATE TABLE [SRO_VT_SHARD].[dbo].[_BlockedWhisperers]'),
   (N'TRUNCATE TABLE [SRO_VT_SHARD].[dbo].[_Inventory]'),
   (N'TRUNCATE TABLE [SRO_VT_SHARD].[dbo].[_InventoryForAvatar]'),
   (N'TRUNCATE TABLE [SRO_VT_SHARD].[dbo].[_InventoryForLinkedStorage]'),
   (N'TRUNCATE TABLE [SRO_VT_SHARD].[dbo].[_TrainingCampMember]'),
   (N'TRUNCATE TABLE [SRO_VT_SHARD].[dbo].[_TrainingCampSubMentorHonorPoint]'),
   (N'TRUNCATE TABLE [SRO_VT_SHARD].[dbo].[_TrainingCampBuffStatus]'),
   (N'DELETE FROM [SRO_VT_SHARD].[dbo].[_TrainingCamp]'),
   (N'DBCC CHECKIDENT (''[SRO_VT_SHARD].[dbo].[_TrainingCamp]'', RESEED, 1)'),
   (N'TRUNCATE TABLE [SRO_VT_SHARD].[dbo].[_StaticAvatar]'),
   (N'TRUNCATE TABLE [SRO_VT_SHARD].[dbo].[_User]'),
   (N'TRUNCATE TABLE [SRO_VT_SHARD].[dbo].[_Friend]'),
   (N'TRUNCATE TABLE [SRO_VT_SHARD].[dbo].[_Memo]'),
   (N'DBCC CHECKIDENT (''[SRO_VT_SHARD].[dbo].[_Memo]'', RESEED, 1)'),
   (N'TRUNCATE TABLE [SRO_VT_SHARD].[dbo].[_TimedJob]'),
   (N'DBCC CHECKIDENT (''[SRO_VT_SHARD].[dbo].[_TimedJob]'', RESEED, 1)'),
   (N'TRUNCATE TABLE [SRO_VT_SHARD].[dbo].[_TimedJobForPet]'),
   (N'DBCC CHECKIDENT (''[SRO_VT_SHARD].[dbo].[_TimedJobForPet]'', RESEED, 1)'),
   (N'TRUNCATE TABLE [SRO_VT_SHARD].[dbo].[_CharTrijobSafeTrade]'),
   (N'DELETE FROM [SRO_VT_SHARD].[dbo].[_CharTrijob]'),
   (N'TRUNCATE TABLE [SRO_VT_SHARD].[dbo].[_InvCOS]'),
   (N'DELETE FROM [SRO_VT_SHARD].[dbo].[_CharCOS] WHERE ID > 0'),
   (N'DBCC CHECKIDENT (''[SRO_VT_SHARD].[dbo].[_CharCOS]'', RESEED, 0)'),
   (N'DELETE FROM [SRO_VT_SHARD].[dbo].[_Char] WHERE CharID > 0'),
   (N'DBCC CHECKIDENT (''[SRO_VT_SHARD].[dbo].[_Char]'', RESEED, 0)'),
   (N'TRUNCATE TABLE [SRO_VT_SHARD].[dbo].[_Chest]'),
   (N'TRUNCATE TABLE [SRO_VT_SHARD].[dbo].[_ChestInfo]'),
   (N'TRUNCATE TABLE [SRO_VT_SHARD].[dbo].[_ItemPool]'),
   (N'DELETE FROM [SRO_VT_SHARD].[dbo].[_Items] WHERE ID64 > 0'),
   (N'DBCC CHECKIDENT (''[SRO_VT_SHARD].[dbo].[_Items]'', RESEED, 0)'),
   (N'DELETE FROM [SRO_VT_SHARD].[dbo].[_AccountJID]'),
   (N'TRUNCATE TABLE [SRO_VT_SHARD].[dbo].[_GuildWar]'),
   (N'DBCC CHECKIDENT (''[SRO_VT_SHARD].[dbo].[_GuildWar]'', RESEED, 1)'),
   (N'TRUNCATE TABLE [SRO_VT_SHARD].[dbo].[_CharNameList]'),
   (N'TRUNCATE TABLE [SRO_VT_SHARD].[dbo].[_CharQuest]'),
   (N'TRUNCATE TABLE [SRO_VT_SHARD].[dbo].[_ClientConfig]'),
   (N'TRUNCATE TABLE [SRO_VT_SHARD].[dbo].[_DeletedChar]'),
   (N'TRUNCATE TABLE [SRO_VT_SHARD].[dbo].[_SiegeFortressStoneState]'),
   (N'TRUNCATE TABLE [SRO_VT_SHARD].[dbo].[_SiegeFortressRequest]'),
   (N'TRUNCATE TABLE [SRO_VT_SHARD].[dbo].[_SiegeFortressObject]'),
   (N'DBCC CHECKIDENT (''[SRO_VT_SHARD].[dbo].[_SiegeFortressObject]'', RESEED, 1)'),
   (N'TRUNCATE TABLE [SRO_VT_SHARD].[dbo].[_SiegeFortressItemForge]'),
   (N'TRUNCATE TABLE [SRO_VT_SHARD].[dbo].[_SiegeFortressBattleRecord]'),
   (N'TRUNCATE TABLE [SRO_VT_SHARD].[dbo].[_CharNickNameList]'),
   (N'TRUNCATE TABLE [SRO_VT_SHARD].[dbo].[_GPHistory]'),
   (N'DBCC CHECKIDENT (''[SRO_VT_SHARD].[dbo].[_GPHistory]'', RESEED, 1)'),
   (N'TRUNCATE TABLE [SRO_VT_SHARD].[dbo].[_GuildChest]'),
   (N'DELETE FROM [SRO_VT_SHARD].[dbo].[_Guild] WHERE ID > 0'),
   (N'DBCC CHECKIDENT (''[SRO_VT_SHARD].[dbo].[_Guild]'', RESEED, 0)'),
   (N'TRUNCATE TABLE [SRO_VT_SHARD].[dbo].[_BindingOptionWithItem]'),
   (N'TRUNCATE TABLE [SRO_VT_SHARD].[dbo].[_ExploitLog]'),
   (N'TRUNCATE TABLE [SRO_VT_SHARD].[dbo].[_Log_SEEK_N_DESTROY_ITEM_FAST]'),
   (N'DELETE FROM [SRO_VT_SHARD].[dbo].[_AlliedClans] WHERE ID > 0'),
   (N'DBCC CHECKIDENT (''[SRO_VT_SHARD].[dbo].[_AlliedClans]'', RESEED, 0)');

    DECLARE @i int = 1, @n int = (SELECT MAX(sira) FROM @ops), @cmd nvarchar(400);
    WHILE @i <= @n
    BEGIN
      SELECT @cmd = cmd FROM @ops WHERE sira = @i;
      BEGIN TRY
        EXEC sys.sp_executesql @cmd;
        SET @basarili += 1;
      END TRY
      BEGIN CATCH
        SET @basarisiz += 1;
        INSERT INTO @hatalar (ifade, hata) VALUES (@cmd, LEFT(ERROR_MESSAGE(), 400));
      END CATCH
      SET @i += 1;
    END
  END

  ------------------------------------------- karakter/hesap kapsamli temizlik
  /* KOSULSUZ silinir - "bayat" testi burada ISE YARAMAZ.
     _Char.CharID (RESEED 0) ve TB_User.JID (RESEED 1) IDENTITY'leri
     sifirlandigi icin yeni karakter/hesap ESKI kimligi devralir; devralinan
     satir sahipsiz gorunmez, NOT EXISTS testinden kacar. Olculdu:
     WebCharInventory'de 0 bayat satir vardi ama 95 satirin TAMAMI eski
     karakterden devralinmisti (canta yuvasi 227-319 = sayfa 6+, ve
     equip yuvasi 8-9 = avatarlar). Bu yuzden _Char/TB_User temizlenen
     her calismada (@Vsro=1) web tarafi da @Web'den bagimsiz temizlenir. */
  IF @Vsro = 1 OR @Web = 1
  BEGIN
    /* CharID'ye bagli */
    DELETE FROM dbo.WebCharInventory;
    DELETE FROM dbo.WebCharInventoryEk;
    DELETE FROM dbo.WebCharZone;
    DELETE FROM dbo.WebCharPet;
    DELETE FROM dbo.WebCharProfession;
    DELETE FROM dbo.WebCharUi;
    DELETE FROM dbo.WebCharGrowthPet;
    DELETE FROM dbo.WebCharCarrier;
    DELETE FROM dbo.WebCharMarks;
    DELETE FROM dbo.WebPartyMatchApplication;
    DELETE FROM dbo.WebPartyMatch;
    /* GuildID'ye bagli (uyelik satirlari CharID tasir) */
    DELETE FROM dbo.WebGuildApplication;
    DELETE FROM dbo.WebGuildPenalty;
    DELETE FROM dbo.WebGuildMember;
    DELETE FROM dbo.WebGuildLog;
    DELETE FROM dbo.WebGuildChest;
    DELETE FROM dbo.WebGuild;
    /* JID'ye bagli oyun verisi (TB_User TRUNCATE + RESEED 1 ile eslesir) */
    DELETE FROM dbo.WebBank;
    DELETE FROM dbo.WebBankInfo;
    DELETE FROM dbo.WebAuctionBid;
    DELETE FROM dbo.WebAuction;
    DELETE FROM dbo.WebExchangeTrade;
    DELETE FROM dbo.WebExchangeOrder;
    DELETE FROM dbo.WebStake;
    DELETE FROM dbo.WebUniqueKill;
    DELETE FROM dbo.WebBugReport;
    DELETE FROM dbo.WebGmLog;
    DELETE FROM dbo.WebAchievement;
    DELETE FROM dbo.WebSession;
    /* IDENTITY'si baska tablolarda anahtar olarak kullanilanlar sifirlanir,
       yoksa ayni "kimlik devralma" hatasi guild/parti tarafinda tekrarlar */
    DBCC CHECKIDENT ('dbo.WebGuild', RESEED, 0) WITH NO_INFOMSGS;
    DBCC CHECKIDENT ('dbo.WebPartyMatch', RESEED, 0) WITH NO_INFOMSGS;
  END

  ---------------------------------------------------------------- web
  IF @Web = 1
  BEGIN
    IF @KeepAccounts = 0
    BEGIN
      DELETE FROM dbo.WebLoginLog;
      DELETE FROM dbo.WebSecurity;
      DELETE FROM dbo.WebSocialLink;
      DELETE FROM dbo.WebReferral;
      DELETE FROM dbo.WebPremium;
      DELETE FROM dbo.WebWallet;
      DELETE FROM dbo.WebAuth;
    END

    /* referans tablolari: yeniden doldur (WebCharStyle'a DOKUNULMAZ -
       gen_charmap.mjs uretir, silinirse karakter olusturma bozulur) */
    DELETE FROM dbo.WebSecurityQuestion;
    INSERT INTO dbo.WebSecurityQuestion (id, text) VALUES
     (1, N'İlk evcil hayvanının adı neydi?'),
     (2, N'Doğduğun şehir hangisi?'),
     (3, N'İlkokul öğretmeninin adı neydi?'),
     (4, N'En sevdiğin film hangisi?'),
     (5, N'Annenin kızlık soyadı nedir?'),
     (6, N'İlk arabanın markası neydi?');
  END

  ---------------------------------------------------------------- sonuc
  IF @basarisiz > 0 SELECT ifade, hata FROM @hatalar;

  SELECT
    @basarili   AS vsroBasarili,
    @basarisiz  AS vsroBasarisiz,
    (SELECT COUNT(*) FROM [SRO_VT_ACCOUNT].[dbo].[TB_User])        AS kalanHesap,
    (SELECT COUNT(*) FROM [SRO_VT_SHARD].[dbo].[_Char])        AS kalanKarakter,
    (SELECT COUNT(*) FROM [SRO_VT_SHARD].[dbo].[_AccountJID])  AS kalanAccountJid,
    (SELECT COUNT(*) FROM dbo.WebAuth)                     AS kalanWebHesap,
    (SELECT COUNT(*) FROM dbo.WebCharStyle)                AS styleHaritasi,
    (SELECT COUNT(*) FROM dbo.WebSecurityQuestion)         AS guvenlikSorusu,
    /* 0 olmali: karaktere bagli web kalintisi (miras bugu gostergesi) */
    ((SELECT COUNT(*) FROM dbo.WebCharInventory)
   + (SELECT COUNT(*) FROM dbo.WebCharInventoryEk)
   + (SELECT COUNT(*) FROM dbo.WebCharZone)
   + (SELECT COUNT(*) FROM dbo.WebCharPet)
   + (SELECT COUNT(*) FROM dbo.WebCharProfession)
   + (SELECT COUNT(*) FROM dbo.WebCharUi)
   + (SELECT COUNT(*) FROM dbo.WebBank)
   + (SELECT COUNT(*) FROM dbo.WebBankInfo))              AS kalanKarakterVerisi,
    CASE WHEN @Vsro = 1 AND @Web = 1 THEN '4 veritabani temizlendi'
         WHEN @Vsro = 1 THEN 'sadece vSRO temizlendi'
         ELSE 'sadece SRO_WEB_GAME temizlendi' END AS sonuc;
END
GO
