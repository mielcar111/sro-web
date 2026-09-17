/* =============================================================================
 * 01_web_veritabani.sql — SRO_WEB_GAME veritabani + temel 6 tablo + tohum veri
 *
 * NE YAPAR:
 *   1) SRO_WEB_GAME veritabanini olusturur (varsa dokunmaz).
 *   2) Web tarafinin cekirdek 6 tablosunu kurar:
 *        WebAuth             - parola tuzu + modern ozet (TB_User.password 50
 *                              karakter oldugu icin oraya sigmaz)
 *        WebSecurity         - guvenlik sorusu METNI + cevap ozeti
 *        WebSession          - "beni hatirla" oturumlari
 *        WebLoginLog         - web giris kaydi
 *        WebCharStyle        - istemci stil <-> vSRO RefObjID eslemesi
 *        WebSecurityQuestion - hazir soru listesi
 *   3) Tohum verileri yukler: 6 guvenlik sorusu + 16 karakter stili.
 *
 * KOSUM SIRASI:
 *   ONCE : hicbir sey gerekmez (bos bir SQL Server ornegi yeter). vSRO
 *          SHARD/ACCOUNT veritabanlarini bu QUERY seti URETMEZ ve pakette de
 *          GELMEZLER (vSRO topluluk standardidir) - kendi hazir vSRO
 *          veritabani setinizi kullanin, sonra 06_shard_parite.sql'i KENDI
 *          shard'iniza uygulayin.
 *   SONRA: 02_web_semasi.sql
 *
 * NOT: Paketteki DATABASE/03_SRO_WEB_GAME.bak dosyasini geri yukleyenler
 *      01-05'i ATLAR (ayni sema .bak icinde hazir gelir; 06 ve gerekirse 07
 *      yine de kosulur); sifirdan kuranlar 01'den itibaren SIRAYLA kosar.
 *      Veritabani adlarini server/config.json'da degistirdiyseniz bu
 *      dosyalardaki adlari da ayni sekilde degistirin.
 *
 * KAYNAK: server/setup_db.mjs (ayni kurulum `node setup_db.mjs` ile de yapilabilir;
 *         o yol charmap.json'dan stil haritasini kendisi yukler).
 *
 * Kosum ornegi:
 *   sqlcmd -S localhost -U <kullanici> -P <parolaniz> -C -i 01_web_veritabani.sql
 * ============================================================================= */

IF DB_ID('SRO_WEB_GAME') IS NULL CREATE DATABASE [SRO_WEB_GAME];
GO

USE SRO_WEB_GAME;
GO

/* ------------------------------------------------------------------ TABLOLAR */

-- Parola malzemesi. TB_User.password varchar(50) oldugu icin tuz+ozet oraya sigmaz.
IF OBJECT_ID('dbo.WebAuth') IS NULL
CREATE TABLE dbo.WebAuth (
  JID       int          NOT NULL PRIMARY KEY,      -- TB_User.JID
  algo      varchar(20)  NOT NULL,                  -- 'scrypt'
  salt      varchar(64)  NOT NULL,
  hash      varchar(200) NOT NULL,
  updatedAt datetime     NOT NULL CONSTRAINT DF_WebAuth_u DEFAULT (GETDATE())
);

-- Guvenlik sorusu. vSRO'da sadece soru NUMARASI var (tinyint), cevap yok.
IF OBJECT_ID('dbo.WebSecurity') IS NULL
CREATE TABLE dbo.WebSecurity (
  JID          int           NOT NULL PRIMARY KEY,
  questionId   tinyint       NOT NULL,
  questionText nvarchar(200) NULL,
  answerSalt   varchar(64)   NOT NULL,
  answerHash   varchar(200)  NOT NULL,
  updatedAt    datetime      NOT NULL CONSTRAINT DF_WebSec_u DEFAULT (GETDATE())
);

-- "Beni hatirla" oturumlari.
IF OBJECT_ID('dbo.WebSession') IS NULL
CREATE TABLE dbo.WebSession (
  token      varchar(64)   NOT NULL PRIMARY KEY,
  JID        int           NOT NULL,
  createdAt  datetime      NOT NULL CONSTRAINT DF_WebSes_c DEFAULT (GETDATE()),
  expiresAt  datetime      NOT NULL,
  remember   bit           NOT NULL CONSTRAINT DF_WebSes_r DEFAULT (0),
  ip         varchar(45)   NULL,
  userAgent  nvarchar(300) NULL,
  lastSeenAt datetime      NULL
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_WebSession_JID')
  CREATE INDEX IX_WebSession_JID ON dbo.WebSession(JID);

IF OBJECT_ID('dbo.WebLoginLog') IS NULL
CREATE TABLE dbo.WebLoginLog (
  id     bigint IDENTITY(1,1) PRIMARY KEY,
  JID    int          NULL,
  userId varchar(25)  NULL,
  ok     bit          NOT NULL,
  reason varchar(40)  NULL,
  ip     varchar(45)  NULL,
  at     datetime     NOT NULL CONSTRAINT DF_WebLog_at DEFAULT (GETDATE())
);

-- istemci stil <-> vSRO RefObjID esleme tablosu.
IF OBJECT_ID('dbo.WebCharStyle') IS NULL
CREATE TABLE dbo.WebCharStyle (
  style    varchar(40) NOT NULL PRIMARY KEY,
  code     varchar(40) NOT NULL,
  refObjId int         NOT NULL,
  race     varchar(16) NOT NULL,
  gender   varchar(8)  NOT NULL
);
GO

/* ---------------------------------------------------------------- TOHUM VERI */

-- Guvenlik sorulari (kayit/parola sifirlama ekrani buradan okur).
IF OBJECT_ID('dbo.WebSecurityQuestion') IS NULL
BEGIN
  CREATE TABLE dbo.WebSecurityQuestion (
    id   tinyint       NOT NULL PRIMARY KEY,
    text nvarchar(200) NOT NULL
  );
END
IF NOT EXISTS (SELECT 1 FROM dbo.WebSecurityQuestion)
  INSERT INTO dbo.WebSecurityQuestion (id, text) VALUES
   (1, N'İlk evcil hayvanının adı neydi?'),
   (2, N'Doğduğun şehir hangisi?'),
   (3, N'İlkokul öğretmeninin adı neydi?'),
   (4, N'En sevdiğin film hangisi?'),
   (5, N'Annenin kızlık soyadı nedir?'),
   (6, N'İlk arabanın markası neydi?');
GO

/* Stil haritasi (kaynak: server/charmap.json — gen_charmap.mjs uretir).
   DIKKAT: Bu tablo bos kalirsa KARAKTER OLUSTURMA CALISMAZ.
   MERGE idempotenttir; betik tekrar kosulabilir. */
MERGE dbo.WebCharStyle AS t
USING (VALUES
  ('chinaman_bogy',          'CHAR_CH_MAN_BOGY',          1908,  'chinese',  'male'),
  ('chinaman_fighter',       'CHAR_CH_MAN_FIGHTER',       1909,  'chinese',  'male'),
  ('chinaman_warrior',       'CHAR_CH_MAN_WARRIOR',       1919,  'chinese',  'male'),
  ('chinaman_adventurer',    'CHAR_CH_MAN_ADVENTURER',    1907,  'chinese',  'male'),
  ('chinawoman_fighter',     'CHAR_CH_WOMAN_FIGHTER',     1923,  'chinese',  'female'),
  ('chinawoman_warrior',     'CHAR_CH_WOMAN_WARRIOR',     1932,  'chinese',  'female'),
  ('chinawoman_adventurer',  'CHAR_CH_WOMAN_ADVENTURER',  1920,  'chinese',  'female'),
  ('chinawoman_kisaeng',     'CHAR_CH_WOMAN_KISAENG',     1926,  'chinese',  'female'),
  ('europeman_knight',       'CHAR_EU_MAN_KNIGHT',        14880, 'european', 'male'),
  ('europeman_warrior',      'CHAR_EU_MAN_WARRIOR',       14881, 'european', 'male'),
  ('europeman_gladiator',    'CHAR_EU_MAN_GLADIATOR',     14882, 'european', 'male'),
  ('europeman_adventurer',   'CHAR_EU_MAN_ADVENTURER',    14884, 'european', 'male'),
  ('europewoman_knight',     'CHAR_EU_WOMAN_KNIGHT',      14895, 'european', 'female'),
  ('europewoman_amazoness',  'CHAR_EU_WOMAN_AMAZONESS',   14894, 'european', 'female'),
  ('europewoman_gladiator',  'CHAR_EU_WOMAN_GLADIATOR',   14897, 'european', 'female'),
  ('europewoman_adventurer', 'CHAR_EU_WOMAN_ADVENTURER',  14896, 'european', 'female')
) AS s(style, code, refObjId, race, gender)
ON t.style = s.style
WHEN MATCHED THEN UPDATE SET code = s.code, refObjId = s.refObjId,
                             race = s.race, gender = s.gender
WHEN NOT MATCHED THEN INSERT (style, code, refObjId, race, gender)
                      VALUES (s.style, s.code, s.refObjId, s.race, s.gender);
GO

/* ------------------------------------------------------------------ KONTROL */
SELECT (SELECT COUNT(*) FROM dbo.WebSecurityQuestion) AS guvenlikSorusu,   -- 6 beklenir
       (SELECT COUNT(*) FROM dbo.WebCharStyle)        AS stilHaritasi;     -- 16 beklenir
GO
