# Silkroad Online — Tarayıcı MMO (istemci + sunucu + veritabanı paketi)

Silkroad evreninde geçen, tamamen tarayıcıda çalışan bir MMORPG:
Babylon.js tabanlı web istemcisi + Node.js sunucu yeniden-uygulaması +
vSRO türevi SQL Server veritabanı şeması. Kurulum bittiğinde oyun
`http://localhost:3000` adresinde açılır.

```
FORUM-SHARE/
├── README.md            bu dosya
├── BASLAT.bat           sunucuyu başlatır (ilk koşumda npm install yapar)
├── client/              web istemcisi (Babylon.js; sunucu buradan servis eder)
├── server/              Node.js sunucu (~40 modül) + data/ + config.example.json
└── DATABASE/
    ├── 03_SRO_WEB_GAME.bak      web şeması (seed dolu, oyuncu tabloları boş)
    ├── SURUM-UYARISI.txt        .bak sürüm uyarısı + RESTORE örneği
    └── QUERY/                   01..08 numaralı .sql seti (.bak'a alternatif)
```

> **ÖNEMLİ — klasör yerleşimi:** `server/` ve `client/` klasörleri **kardeş**
> kalmalıdır. Sunucu istemciyi `../client` yolundan servis eder ve bazı
> yerelleştirme dosyalarını oradan okur; klasörleri ayırır ya da yeniden
> adlandırırsanız sunucu açılmaz veya eksik çalışır.

---

## Gereksinimler

| Bileşen | Sürüm | Not |
|---|---|---|
| Windows | 10/11 | (Linux'ta da çalışır; BASLAT.bat yerine `cd server && npm install && node server.js`) |
| Bir vSRO veritabanı seti | `SRO_VT_SHARD` + `SRO_VT_ACCOUNT` | **pakete dahil değildir** — vSRO topluluk standardıdır, kendi setinizi kullanın |
| Microsoft SQL Server | `03_SRO_WEB_GAME.bak` için **2025 (17.x) veya üzeri** | Daha eski sürüm (2019/2022) bu .bak'ı **reddeder**; alternatif için Kurulum 1. adıma bakın |
| Node.js | **18+** (npm dahil) | Bağımlılıklar yalnız `ws` + `mssql` |
| Tarayıcı | WebGL2 destekli güncel Chrome/Edge/Firefox | |
| Disk | ~2 GB | istemci varlıkları ~1.4 GB |

---

## Kurulum (5 adım)

### 1) Veritabanlarını kur

**Önce vSRO tarafı — kendi setiniz:** `SRO_VT_SHARD` ve `SRO_VT_ACCOUNT`
bu pakete **dahil değildir** (herkeste zaten bulunan vSRO topluluk
standardıdır). Elinizdeki hazır bir vSRO veritabanı setini geri yükleyin,
sonra **`DATABASE/QUERY/06_shard_parite.sql` dosyasını KENDİ shard'ınıza**
uygulayın (bu sunucunun beklediği parite eklerini kurar; dosyanın başında
ne yaptığı yazar).

**Sonra web tarafı — `SRO_WEB_GAME` (bu paketin kendi şeması), iki yol:**

**A yolu — `.bak` geri yükle (SQL Server 2025+):**

```sql
RESTORE DATABASE SRO_WEB_GAME FROM DISK = N'C:\YOL\03_SRO_WEB_GAME.bak'
WITH MOVE 'SRO_WEB_GAME'     TO N'C:\SQLDATA\SRO_WEB_GAME.mdf',
     MOVE 'SRO_WEB_GAME_LOG' TO N'C:\SQLDATA\SRO_WEB_GAME_log.ldf';
-- mantıksal adlar için: RESTORE FILELISTONLY FROM DISK = N'...bak'
```

Ayrıntı ve sürüm uyarısı: `DATABASE/SURUM-UYARISI.txt`.

**B yolu — QUERY seti ile sıfırdan (eski SQL Server için):**
`DATABASE/QUERY/01..05` dosyalarını **sırayla** çalıştırın (her dosyanın
başında ne yaptığı ve koşum sırası yazar). QUERY seti yalnız **web
tarafını** (SRO_WEB_GAME + lonca/meslek yordamları) kurar; 06 her iki
yolda da kendi shard'ınıza uygulanır, 07–08 bakım/GM içindir.

> **İki yol da aynı yere çıkar:** `.bak` ile QUERY seti aynı şemayı üretir —
> **39 tablo, 43 saklı yordam, 243 kolon, 52 indeks**; dolu olan tek şey
> tohum tablolarıdır (16 karakter stili + 6 güvenlik sorusu), oyuncu
> tabloları boştur. Bu eşitlik her sürümde otomatik doğrulanır.

> `SRO_VT_LOG` pakete dahil değildir ve sunucunun açılması için gerekmez;
> `config.json`'daki `log` alanını mevcut ya da boş bir veritabanına
> işaretleyebilirsiniz.

### 2) config.json'u oluştur

```
cd server
copy config.example.json config.json
notepad config.json
```

`sql.user` / `sql.password` alanlarına **kendi** SQL Server bilgilerinizi
yazın. Veritabanı adlarını değiştirdiyseniz `sql.databases` alanını **ve**
QUERY dosyalarındaki adları da aynı şekilde güncelleyin.
`config.json` olmadan sunucu açılmaz (BASLAT.bat sizi uyarır).

### 3) Sunucuyu başlat

`BASLAT.bat`'a çift tıklayın. İlk koşumda `npm install` çalışır (internet
gerekir, ~30 sn); sonrasında sunucu açılır ve konsolda
`SQL bagli -> ...` satırlarını görürsünüz.

### 4) Kayıt ol ve oyna

Tarayıcıda `http://localhost:3000` → **Kayıt Ol** (kullanıcı adı, şifre,
e-posta, güvenlik sorusu) → giriş → karakter oluştur. Kayıt/giriş/şifre
sıfırlama tamamen yereldir; dış bir sunucuya istek gitmez.

### 5) Kendine GM yetkisi ver (isteğe bağlı)

`DATABASE/QUERY/08_gm_yetki_ornekleri.sql` dosyasını açın, `@kullanici`
değerini 4. adımda açtığınız hesabın adıyla değiştirin ve çalıştırın.
Oyunda sohbete `/gm help` yazarak doğrulayın
(`tp`, `spawn`, `heal`, `notice`, `kick`, `reloadcombat` …).

---

## Veritabanı Mimarisi

**Kural:** vSRO'da karşılığı olan hiçbir veri yeni veritabanına taşınmadı.
Oyuna Windows istemcisi yerine tarayıcıdan giriliyor ama veri aynı
yerlerde durur:

| Veritabanı | Rolü | İçerik |
|---|---|---|
| `SRO_VT_ACCOUNT` | giriş kapısı | `TB_User`, `SK_Silk` — tablo/yordamlar değiştirilmedi |
| `SRO_VT_SHARD` | oyun dünyası | `_Char`, `_User`, `_Inventory`, `_Items`, `_CharSkill`, `_Guild` … |
| `SRO_VT_LOG` | kayıtlar | pakette yok; isteğe bağlı |
| `SRO_WEB_GAME` | **yeni** | yalnız vSRO'da karşılığı **olmayan** sistemler |

`SRO_WEB_GAME` neden var (ölçülen kısıtlar, tahmin değil):

- `TB_User.password` `varchar(50)` — modern tuz+özet (scrypt) sığmaz →
  gerçek parola malzemesi `WebAuth`'ta; `TB_User` kanonik üyelik satırı olarak kalır.
- `TB_User.sec_primary/sec_content` `tinyint` — soru **metni** değil; bu
  shard'da GM bayrağı olarak kullanılır → güvenlik sorusu `WebSecurity`'de.
- Silk ekonomisi (`WebWallet`, `WebExchange*`, `WebStake`), müzayede,
  premium, büyüyen pet, unique zamanlayıcıları, arayüz durumu gibi
  bu sunucuya özgü sistemlerin vSRO'da tablosu yoktur.

Bazı tabloları sunucu **çalışma zamanında kendisi kurar**
(`WebCharInventory`, `WebBank`, `WebCharPet` …) — ilk açılışta konsolda
`kalicilik: WebCharInventory hazir` benzeri satırlar görmeniz normaldir.

Karakter oluşturma doğrudan vSRO tablolarına yazar (16 karakter stili ↔
`RefObjID` eşlemesi `WebCharStyle`'dadır); koordinatlar istemci dünya
birimi ↔ vSRO `region+local` köprüsüyle çevrilir.

### Çanta 12 sayfa — sayfa 6–12 nerede saklanır?

Çanta 12 sayfadır (384 yuva). vSRO `_Inventory.Slot` kolonu `tinyint`
olduğundan tablo değiştirilmedi (ALTER yok): ilk sayfalar vSRO
`_Inventory`/`_Items`'ta, **sayfa 6–12'deki eşyalar ise vSRO tablosunda
GÖRÜNMEZ — `SRO_WEB_GAME.dbo.WebCharInventory`'de tutulur** ve girişte
otomatik birleştirilir. SSMS'te sayfa 6–12 içeriğine bakmak için:

```sql
SELECT Kap, Slot, StackJson
FROM SRO_WEB_GAME.dbo.WebCharInventory
WHERE CharID = (SELECT CharID FROM SRO_VT_SHARD.dbo._Char
                WHERE CharName16 = N'KARAKTER_ADI')
ORDER BY Kap, Slot;
```

`SELECT MAX(Slot) FROM _Inventory` sorgusunun 255'i hiç aşmaması
tasarım gereğidir; "eşyam kayıp" sanmayın, üstteki sorguya bakın.

### Bakım

`DATABASE/QUERY/07_bakim_CleanDB.sql` web tarafını güvenli sıfırlamak için
`CleanDB` yordamını kurar (`@Report=1` yalnız sayar, `@KeepAccounts=1`
hesapları korur). Yordam yalnız `SRO_WEB_GAME` içinde çalışır; canlı
veritabanı adlarına sabittir — adları değiştirdiyseniz dosyayı da güncelleyin.

---

## Güvenlik notu

- **Parolanızı değiştirin / döndürün:** `config.example.json` içindeki
  `DEGISTIRIN` değerlerini mutlaka kendi **güçlü ve benzersiz** parolanızla
  değiştirin. Bu paketi kendi çalışan sunucunuzdan türetip yeniden
  paylaşacaksanız, yapılandırma dosyalarında bir kez bile yer almış her SQL
  parolasını paylaşmadan **önce** gerçek sunucuda döndürün (rotasyon) —
  dosyadan silinmiş olması yetmez.
- **`sa` ile bağlanmayın:** sunucu için yalnız bu veritabanlarına yetkili,
  az yetkili ayrı bir SQL login açın ve `config.json`'a onu yazın:

```sql
CREATE LOGIN silkroad_srv WITH PASSWORD = N'GucluBirParola!';
USE SRO_VT_SHARD;   CREATE USER silkroad_srv FOR LOGIN silkroad_srv; ALTER ROLE db_owner ADD MEMBER silkroad_srv;
USE SRO_VT_ACCOUNT; CREATE USER silkroad_srv FOR LOGIN silkroad_srv; ALTER ROLE db_owner ADD MEMBER silkroad_srv;
USE SRO_WEB_GAME;   CREATE USER silkroad_srv FOR LOGIN silkroad_srv; ALTER ROLE db_owner ADD MEMBER silkroad_srv;
```

  (İsterseniz `db_owner` yerine `db_datareader` + `db_datawriter` +
  yordamlara `GRANT EXECUTE` ile daha da kısabilirsiniz; sunucu ilk açılışta
  eksik tabloları kendisi kurduğu için en az ilk koşumda DDL yetkisi gerekir.)
- Sunucu varsayılan olarak tüm arabirimleri dinler (`host: "::"`). Yalnız
  kendi makinenizde oynayacaksanız `config.json`'da `host`'u `"127.0.0.1"`
  yapabilirsiniz; internete açacaksanız önüne bir ters vekil (reverse proxy)
  ve güvenlik duvarı koyun.
