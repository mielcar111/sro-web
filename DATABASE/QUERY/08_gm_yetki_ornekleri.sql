/* =============================================================================
 * 08_gm_yetki_ornekleri.sql — GM yetkisi verme/alma ornekleri
 *
 * vSRO KURALI (dogrulanmis):
 *   sec_primary = 1  AND  sec_content = 1   ->  hesap GM
 *   sec_primary = 3  AND  sec_content = 3   ->  normal oyuncu (sutun varsayilani)
 *   (GMrank bu shard'da kullanilmiyor.)
 *
 * ONEMLI: Guvenlik sorusu numarasi TB_User.sec_primary'ye YAZILMAZ —
 * yazilsaydi 1 numarali soruyu secen her uye GM olurdu. Soru numarasi
 * SRO_WEB_GAME.WebSecurity.questionId'de tutulur.
 *
 * GM konsolu: oyunda ayri panel yoktur; GM hesabiyla girip sohbet kutusuna
 * /gm yazilir. Ornek komutlar: /gm help · where · tp <x> <z> [zone] ·
 * goto <npc> · spawn <model> [n] · heal · notice <mesaj> · who · kick <ad> ·
 * reloadcombat. Her komut WebGmLog'a yazilir; yetkisiz kullanicida reddedilir.
 *
 * KULLANIM: once siteden (localhost:3000) normal bir hesap acin, sonra
 * asagidaki @kullanici degerini kendi kullanici adinizla degistirip bu
 * dosyayi kosun. Yeniden kosmak zararsizdir.
 *
 * KOSUM SIRASI:
 *   ONCE : 01..06 tamam + sunucu calisir + siteden hesap acilmis olmali
 *   SONRA: — (son adim; oyuna girip /gm help ile dogrulayin)
 * ============================================================================= */

USE SRO_WEB_GAME;
GO

/* ---------------------------------------------------------- GM YAP (ornek) */
DECLARE @kullanici varchar(25) = 'KULLANICI_ADINIZI_YAZIN';

IF EXISTS (SELECT 1 FROM SRO_VT_ACCOUNT.dbo.TB_User WHERE StrUserID = @kullanici)
  EXEC dbo.WebSetGm @StrUserID = @kullanici, @Gm = 1;   -- GM yap
ELSE
  PRINT 'Boyle bir hesap yok: once siteden bu adla kayit olun, sonra bu betigi kendi kullanici adinizla kosun.';
GO

/* ------------------------------------------------- GERI AL (istediginizde)
   Ayni yordam @Gm=0 ile yetkiyi geri alir:

   EXEC dbo.WebSetGm @StrUserID = 'kullanici', @Gm = 0;
*/

/* -------------------------------------------------------------- GM LISTESI */
EXEC dbo.WebListGms;
GO

/* -------------------------------------------- ELLE ESDEGERI (bilgi amacli)
   WebSetGm'in yaptigi tek sey sudur; yordamsiz da yapilabilir:

   UPDATE SRO_VT_ACCOUNT.dbo.TB_User
      SET sec_primary = 1, sec_content = 1      -- geri almak icin: 3, 3
    WHERE StrUserID = 'kullanici';
*/
