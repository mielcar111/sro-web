# Silkroad Online — MMO w przeglądarce (klient + serwer + pakiet bazy danych)

MMORPG osadzone w uniwersum Silkroad, działające w całości w przeglądarce:
klient webowy oparty na Babylon.js + reimplementacja serwera w Node.js +
schemat bazy SQL Server będący pochodną vSRO. Po zakończeniu instalacji gra
otwiera się pod adresem `http://localhost:3000`.

​```
FORUM-SHARE/
├── README.md              ten plik
├── BASLAT.bat             uruchamia serwer (przy pierwszym starcie wykonuje npm install)
├── client/                klient webowy (Babylon.js; serwer serwuje go stąd)
├── server/                serwer Node.js (~40 modułów) + data/ + config.example.json
└── DATABASE/
    ├── 03_SRO_WEB_GAME.bak       schemat web (dane seed wypełnione, tabele graczy puste)
    ├── OSTRZEZENIE-WERSJI.txt    ostrzeżenie o wersji .bak + przykład RESTORE
    └── QUERY/                    zestaw plików .sql o numerach 01..08 (alternatywa dla .bak)
​```

> **WAŻNE — układ katalogów:** foldery `server/` i `client/` muszą pozostać
> **jako rodzeństwo** (na tym samym poziomie). Serwer serwuje klienta ze
> ścieżki `../client` i czyta stamtąd niektóre pliki lokalizacji; jeśli je
> rozdzielisz albo zmienisz nazwy, serwer nie wystartuje lub będzie działał
> niekompletnie.

---

## Wymagania

| Komponent | Wersja | Uwagi |
|---|---|---|
| Windows | 10/11 | (Działa też na Linuksie; zamiast BASLAT.bat użyj `cd server && npm install && node server.js`) |
| Zestaw baz vSRO | `SRO_VT_SHARD` + `SRO_VT_ACCOUNT` | **nie jest dołączony do pakietu** — to standard społeczności vSRO, użyj własnego zestawu |
| Microsoft SQL Server | dla `03_SRO_WEB_GAME.bak` **2025 (17.x) lub nowszy** | Starsze wersje (2019/2022) **odrzucą** ten .bak; alternatywę znajdziesz w kroku 1 instalacji |
| Node.js | **18+** (wraz z npm) | Zależności to tylko `ws` + `mssql` |
| Przeglądarka | Aktualny Chrome/Edge/Firefox z obsługą WebGL2 | |
| Dysk | ~2 GB | zasoby klienta ~1,4 GB |

---

## Instalacja (5 kroków)

### 1) Zainstaluj bazy danych

**Najpierw strona vSRO — twój własny zestaw:** `SRO_VT_SHARD` i
`SRO_VT_ACCOUNT` **nie są dołączone** do tego pakietu (to standard
społeczności vSRO, który każdy już ma). Przywróć własny gotowy zestaw baz
vSRO, a następnie **zastosuj plik `DATABASE/QUERY/06_shard_parite.sql` do
SWOJEGO sharda** (dodaje on rozszerzenia parytetu wymagane przez ten
serwer; w nagłówku pliku opisano, co robi).

**Następnie strona web — `SRO_WEB_GAME` (własny schemat tego pakietu), dwie drogi:**

**Droga A — przywrócenie `.bak` (SQL Server 2025+):**

​```sql
RESTORE DATABASE SRO_WEB_GAME FROM DISK = N'C:\SCIEZKA\03_SRO_WEB_GAME.bak'
WITH MOVE 'SRO_WEB_GAME'     TO N'C:\SQLDATA\SRO_WEB_GAME.mdf',
     MOVE 'SRO_WEB_GAME_LOG' TO N'C:\SQLDATA\SRO_WEB_GAME_log.ldf';
-- aby uzyskać nazwy logiczne: RESTORE FILELISTONLY FROM DISK = N'...bak'
​```

Szczegóły i ostrzeżenie o wersji: `DATABASE/OSTRZEZENIE-WERSJI.txt`.

**Droga B — od zera przez zestaw QUERY (dla starszego SQL Servera):**
Uruchom pliki `DATABASE/QUERY/01..05` **po kolei** (w nagłówku każdego
pliku opisano, co robi i w jakiej kolejności uruchamiać). Zestaw QUERY
instaluje tylko **stronę web** (SRO_WEB_GAME + procedury guild/job); plik
06 stosuje się do własnego sharda w obu drogach, a 07–08 służą do
konserwacji/GM.

> **Obie drogi prowadzą do tego samego wyniku:** `.bak` i zestaw QUERY dają
> identyczny schemat — **39 tabel, 43 procedur składowanych, 243 kolumn,
> 52 indeksów**; jedyne wypełnione dane to tabele seed (16 stylów postaci
> + 6 pytań bezpieczeństwa), tabele graczy są puste. Równość ta jest
> automatycznie weryfikowana w każdej wersji.

> `SRO_VT_LOG` nie jest dołączony do pakietu i nie jest wymagany do
> uruchomienia serwera; w `config.json` pole `log` możesz wskazać na
> dowolną istniejącą lub pustą bazę.

### 2) Utwórz config.json

​```
cd server
copy config.example.json config.json
notepad config.json
​```

W polach `sql.user` / `sql.password` wpisz **własne** dane dostępowe do
SQL Servera. Jeśli zmieniłeś nazwy baz, zaktualizuj odpowiednio pole
`sql.databases` **oraz** nazwy w plikach QUERY. Bez `config.json` serwer
nie wystartuje (BASLAT.bat cię ostrzeże).

### 3) Uruchom serwer

Kliknij dwukrotnie `BASLAT.bat`. Przy pierwszym uruchomieniu wykona się
`npm install` (wymagane połączenie z internetem, ~30 s); następnie serwer
wystartuje i zobaczysz w konsoli linie typu `SQL bagli -> ...`.

### 4) Zarejestruj się i graj

W przeglądarce wejdź na `http://localhost:3000` → **Zarejestruj się**
(nazwa użytkownika, hasło, e-mail, pytanie bezpieczeństwa) → zaloguj →
utwórz postać. Rejestracja/logowanie/reset hasła są w pełni lokalne;
żadne żądania nie wychodzą na zewnętrzne serwery.

### 5) Nadaj sobie uprawnienia GM (opcjonalnie)

Otwórz plik `DATABASE/QUERY/08_gm_yetki_ornekleri.sql`, zamień wartość
`@kullanici` na nazwę konta utworzonego w kroku 4 i wykonaj skrypt.
Sprawdź w grze wpisując na czacie `/gm help`
(`tp`, `spawn`, `heal`, `notice`, `kick`, `reloadcombat` …).

---

## Architektura bazy danych

**Zasada:** żadne dane mające swój odpowiednik w vSRO nie zostały
przeniesione do nowej bazy. Do gry wchodzi się z przeglądarki zamiast z
klienta Windows, ale dane leżą w tych samych miejscach:

| Baza | Rola | Zawartość |
|---|---|---|
| `SRO_VT_ACCOUNT` | brama logowania | `TB_User`, `SK_Silk` — tabele/procedury nie zostały zmienione |
| `SRO_VT_SHARD` | świat gry | `_Char`, `_User`, `_Inventory`, `_Items`, `_CharSkill`, `_Guild` … |
| `SRO_VT_LOG` | logi | brak w pakiecie; opcjonalnie |
| `SRO_WEB_GAME` | **nowa** | tylko systemy, które **nie mają** odpowiednika w vSRO |

Dlaczego istnieje `SRO_WEB_GAME` (ograniczenia zmierzone, nie zgadywane):

- `TB_User.password` to `varchar(50)` — nowoczesny sól+skrót (scrypt)
  się nie zmieści → właściwy materiał hasła leży w `WebAuth`;
  `TB_User` pozostaje kanonicznym rekordem członkostwa.
- `TB_User.sec_primary/sec_content` to `tinyint` — nie **treść** pytania;
  na tym shardzie używane jako flaga GM → pytanie bezpieczeństwa jest
  w `WebSecurity`.
- Ekonomia Silk (`WebWallet`, `WebExchange*`, `WebStake`), aukcje,
  konto premium, rosnący pet, timery unikatów, stan interfejsu — te
  systemy, specyficzne dla tego serwera, nie mają tabel w vSRO.

Część tabel serwer **tworzy sam w czasie działania** (`WebCharInventory`,
`WebBank`, `WebCharPet` …) — przy pierwszym starcie normalne jest
zobaczyć w konsoli linie w rodzaju `kalicilik: WebCharInventory hazir`.

Tworzenie postaci pisze bezpośrednio do tabel vSRO (mapowanie 16 stylów
postaci ↔ `RefObjID` znajduje się w `WebCharStyle`); współrzędne są
konwertowane pomostem: jednostki świata klienta ↔ vSRO `region+local`.

### Torba ma 12 stron — gdzie są przechowywane strony 6–12?

Torba liczy 12 stron (384 sloty). Ponieważ w vSRO kolumna
`_Inventory.Slot` jest `tinyint`, tabela nie została zmieniona (bez
ALTER): pierwsze strony leżą w vSRO `_Inventory`/`_Items`, natomiast
**przedmioty ze stron 6–12 NIE SĄ WIDOCZNE w tabeli vSRO — trzymane są
w `SRO_WEB_GAME.dbo.WebCharInventory`** i przy logowaniu są automatycznie
łączone. Żeby podejrzeć w SSMS zawartość stron 6–12:

​```sql
SELECT Kap, Slot, StackJson
FROM SRO_WEB_GAME.dbo.WebCharInventory
WHERE CharID = (SELECT CharID FROM SRO_VT_SHARD.dbo._Char
                WHERE CharName16 = N'NAZWA_POSTACI')
ORDER BY Kap, Slot;
​```

To, że zapytanie `SELECT MAX(Slot) FROM _Inventory` nigdy nie przekracza
255, jest zgodne z projektem; nie wyciągaj wniosku „zginął mi przedmiot"
— sprawdź w powyższym zapytaniu.

### Konserwacja

`DATABASE/QUERY/07_bakim_CleanDB.sql` instaluje procedurę `CleanDB` do
bezpiecznego resetowania strony web (`@Report=1` tylko liczy,
`@KeepAccounts=1` zachowuje konta). Procedura działa wyłącznie w obrębie
`SRO_WEB_GAME`; nazwy baz są w niej zaszyte na sztywno — jeśli je
zmieniłeś, zaktualizuj także ten plik.

---

## Notka bezpieczeństwa

- **Zmień / zrotuj swoje hasła:** wartości `DEGISTIRIN` w
  `config.example.json` obowiązkowo zamień na własne **silne i unikalne**
  hasło. Jeśli tworzysz ten pakiet z własnego działającego serwera
  i planujesz go udostępnić dalej, każde hasło SQL, które choć raz
  pojawiło się w plikach konfiguracyjnych, zrotuj na rzeczywistym
  serwerze **przed** udostępnieniem — samo usunięcie z pliku to za mało.
- **Nie łącz się jako `sa`:** dla serwera utwórz osobne, mało
  uprzywilejowane konto SQL z dostępem tylko do tych baz i wpisz je w
  `config.json`:

​```sql
CREATE LOGIN silkroad_srv WITH PASSWORD = N'SilneHaslo!';
USE SRO_VT_SHARD;   CREATE USER silkroad_srv FOR LOGIN silkroad_srv; ALTER ROLE db_owner ADD MEMBER silkroad_srv;
USE SRO_VT_ACCOUNT; CREATE USER silkroad_srv FOR LOGIN silkroad_srv; ALTER ROLE db_owner ADD MEMBER silkroad_srv;
USE SRO_WEB_GAME;   CREATE USER silkroad_srv FOR LOGIN silkroad_srv; ALTER ROLE db_owner ADD MEMBER silkroad_srv;
​```

  (Jeśli chcesz, zamiast `db_owner` możesz jeszcze bardziej zawęzić
  uprawnienia: `db_datareader` + `db_datawriter` + `GRANT EXECUTE` na
  procedurach; ponieważ serwer sam tworzy brakujące tabele przy
  pierwszym uruchomieniu, przynajmniej podczas pierwszego startu
  wymagane są uprawnienia DDL.)
- Serwer domyślnie nasłuchuje na wszystkich interfejsach (`host: "::"`).
  Jeśli będziesz grać tylko na własnej maszynie, ustaw w `config.json`
  `host` na `"127.0.0.1"`; jeśli otwierasz go do internetu, postaw
  przed nim reverse proxy i firewall.