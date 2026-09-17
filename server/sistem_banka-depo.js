/**
 * sistem_banka-depo.js  -  HESAP BANKASI (depo) + envanter/depo genisletme
 *
 * Islenen c2s mesajlari (protocol.js C2S numaralari):
 *    95  bank.moveItem      { npcId, from 0..359, to 0..359 }
 *   105  bank.depositGold   { npcId, amount 1..2e9 }
 *   106  bank.withdrawGold  { npcId, amount 1..2e9 }
 *   107  bank.depositItem   { npcId, bagSlot 0..159, qty 1..1000 }
 *   108  bank.withdrawItem  { npcId, bankSlot 0..359, qty 1..1000 }
 *   126  item.expand        { bagSlot 0..159 }
 *    96  exch.open  / 97 exch.close   -> SADECE banka penceresini besler,
 *                                        sonra false doner (bkz. BAGLAMA NOTU)
 *
 * Gonderilen s2c kareleri:
 *   182  bank.items    { slots:[{slot, stack}], capacity }
 *   177  exch.wallet   { jadeUnits, jadeLockedUnits, gold, depositAddress }
 *   149  inv.update    ctx.envanterPayload(ch)
 *   195  sys.notice    sys.bank.gold_in / gold_out / item_in / item_out,
 *                      sys.expand.bag / sys.expand.storage
 *   240  err           ERR_* (Sht enum) + dogrulanmis locale anahtari
 *
 * ---------------------------------------------------------------------------
 * SEMA KAYNAGI - index-BUMMQVRB.js (27 MB istemci paketi), T$() kayit tablosu
 * ofset 25613996..25614930 ve s2c tarafinda 25629977 / 25629182 / 25623885:
 *
 *   T$(`bank.depositGold`, 105, X({ npcId: J(), amount: Y().int().min(1).max(2e9) }), `exchange`)
 *   T$(`bank.withdrawGold`,106, X({ npcId: J(), amount: Y().int().min(1).max(2e9) }), `exchange`)
 *   T$(`bank.depositItem`, 107, X({ npcId: J(), bagSlot: Y().int().min(0).max(159),  qty: D$ }), `exchange`)
 *   T$(`bank.withdrawItem`,108, X({ npcId: J(), bankSlot:Y().int().min(0).max(359),  qty: D$ }), `exchange`)
 *   T$(`bank.moveItem`,     95, X({ npcId: J(), from: 0..359, to: 0..359 }), `exchange`)
 *   T$(`item.expand`,      126, X({ bagSlot: Y().int().min(0).max(159) }), `inv`)
 *   D$ = Y().int().min(1).max(1e3)          (ofset 25609892)
 *   T$(`bank.items`, 182, X({ slots: BJ(X({ slot: Y().int(), stack: S$ })),
 *                             capacity: Y().int().optional() }))
 *   T$(`exch.wallet`,177, X({ jadeUnits, jadeLockedUnits, gold: Y().int(),
 *                             depositAddress: J() }))     <- 4 alan da ZORUNLU
 *   S$ = X({ itemId: J(), qty: >=1, plus?, dur?, maxDur?, variance?, blues?, rolls? })
 *
 * ISTEMCI DAVRANISI (paket @27296800 banka penceresi):
 *   - Pencere acilinca `exch.open` gonderiliyor (A5() -> W$.send('exch.open',{})),
 *     kapaninca `exch.close`. Bankanin icerigi SADECE `bank.items` ile,
 *     bankadaki ALTIN ise SADECE `exch.wallet`.gold ile doluyor
 *     (ui.bank.bank_gold_tip = "Hesap bankasi altini - Silk Borsasi ile ortak").
 *   - Izgara 6 sutun x 36 yuva, sayfa sayisi = ceil(capacity/36).
 *   - Cantadan bankaya birakma -> bank.depositItem { bagSlot, qty:999 } (HEDEF
 *     YUVA YOK -> yeri sunucu secer). Banka yuvasina sag tiklama ->
 *     bank.withdrawItem { bankSlot, qty:999 }.
 *   - item.expand penceresi (@27393000): esya `type` alanina gore
 *     bagExpand -> en fazla 5 sayfa, storageExpand -> en fazla 10 sayfa,
 *     carrierExpand -> tasiyici (bu modulun isi degil).
 *
 * KALICILIK
 *   Banka ALTINI  : SRO_VT_SHARD.dbo._AccountJID.Gold  (bigint, hesap basina) -
 *                   vSRO'nun kendi hesap altini kolonu, birebir oturuyor.
 *                   YAZIM FARK ILE yapilir (Gold = Gold +/- @m), mutlak degil:
 *                   ayni satiri sistem_borsa.js de dogrudan degistiriyor.
 *   Karakter ALTINI: SRO_VT_SHARD.dbo._Char.RemainGold - transferin OTEKI yani.
 *                   Yazilmazsa oyuncu altini bankaya koyup cikis-giris yapinca
 *                   altin KOPYALANIR (giriste routes_auth.js RemainGold okuyor).
 *   Canta boyutu  : SRO_VT_SHARD.dbo._Char.InventorySize (int).
 *   Banka esyalari: SRO_WEB_GAME.dbo.WebBank / WebBankInfo (modul ilk kurulusta
 *                   yoksa olusturur).
 *                   NEDEN _Chest DEGIL: _Chest(UserJID, Slot tinyint, ItemID bigint)
 *                   ve _ChestInfo(JID, ChestSize tinyint) - Slot/ChestSize TINYINT,
 *                   yani en fazla 255. referans oyun depo yuvasi 0..359 (10 sayfa x 36),
 *                   yani son 3 sayfa bu kolonlara SIGMIYOR. Ayrica _Chest bir esyayi
 *                   _Items.ID64 ile tutuyor; referans oyun yigini (itemId metni + plus/dur/
 *                   variance/blues/rolls) icin RefItemID esleme tablosu gerekiyor,
 *                   elimizdeki itemmap.json yalnizca 88 esyayi (zirh/silah/kalkan)
 *                   kapsiyor - 3005 esyalik katalogun kalani kayipsiz yazilamaz.
 *                   Bu yuzden esya tarafi tam sadakatle SRO_WEB_GAME'de duruyor.
 *   web havuzu yoksa (ctx.web === null) her sey BELLEKTE tutulur, sunucu
 *   yeniden baslayinca sifirlanir; islevsellik aynidir.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BURASI = path.dirname(fileURLToPath(import.meta.url));

/* ---------------------------------------------------------------- sabitler
   Hicbiri uydurma degil:
     36  -> istemci banka izgarasi Array.from({length:36}) ve pages=ceil(cap/36)
     10  -> istemci: max = kind==='bag' ? 5 : 10   (depo en fazla 10 sayfa)
    360  -> bankSlot semasi .max(359)
   Canta sayfa boyu GCFG.bagSlots (=32) uzerinden gelir, sabit yazilmaz.

   SARTNAME-3 MADDE 10 - CANTA 12 SAYFA (referans oyun varsayilani 5'ten BILINCLI
   SAPMA, kullanici karari "TAM 12 sayfa"):
     12  -> CANTA_MAX_SAYFA (eski 5); istemci sayfa sayisini SABITTEN DEGIL
            bag.length'ten cizer: pages = ceil(bag.length/32) (paket @19914023,
            sekme seridi cap'siz) -> bundle yamasiz 12 sekme kendiliginden cikar.
    384  -> CANTA_MAX_YUVA = 12 x 32 (eski 160). Istemcinin c2s bagSlot
            .max(159) semalari OLU KOD (m$.send sema calistirmaz, sartname
            madde 10 hukum a); canli dogrulama SUNUCUDA: YUVA_MAX=383 ve
            eslenikleri (sartname madde 11, 9 satir).
   DIKKAT: gameConfig.bagSlots=32 SABIT KALIR - istemci gameConfig semasi
   max(64), buyutulurse acilista nY 'invalid game data' throw. 384'e YALNIZ
   bag.length ile gidilir.                                                      */
const DEPO_SAYFA_YUVASI = 36;
const DEPO_MAX_SAYFA    = 10;
const CANTA_MAX_SAYFA   = 12;
const DEPO_MAX_YUVA     = 360;
const CANTA_MAX_YUVA    = 384;

/* PP MADDE 3 (changelog 0025 tr:8-11): karakter ustunde en fazla
   999.999.999.999 altin; siniri asacak DEPO ALTIN CEKIMI "sessizce basarisiz
   olmak yerine" acik mesajla reddedilir (err.gold_cap + {cap}, tr.json s.145).
   Ayni tavan gameloop (altin ganimeti), sistem_dukkan (satis) ve
   sistem_lonca (kasa cekimi) ile ortak deger. */
const ALTIN_TAVANI = 999_999_999_999;

/** err.code degerleri Sht enum'undan (paket @25603148) - disindaki kod istemcide
 *  Zod'a takilir ve paket sessizce dusurulur. */
const HATA = {
  DOGRULAMA: 'ERR_VALIDATION',
  MENZIL:    'ERR_RANGE',
  ALTIN:     'ERR_NO_GOLD',
  DOLU:      'ERR_BAG_FULL',
  YOK:       'ERR_NOT_FOUND',
  MESGUL:    'ERR_BUSY',
};

/** Bu locale anahtarlarinin tr.json icinde GERCEKTEN oldugu dogrulandi. */
const ANAHTAR = {
  altinIn:   'sys.bank.gold_in',    // {gold}
  altinOut:  'sys.bank.gold_out',   // {gold}
  esyaIn:    'sys.bank.item_in',    // {qty} {item}
  esyaOut:   'sys.bank.item_out',   // {qty} {item}
  genisCanta:'sys.expand.bag',      // {pages}
  genisDepo: 'sys.expand.storage',  // {pages}
  bankaDolu: 'err.bank.full',
  bankaIc:   'err.bank.internal',
  bankaMesgul:'err.busy.bank',
  /* NEDEN: "en fazla sayfa" reddi anahtarsiz ERR_VALIDATION ile gidiyordu,
     oyuncu "Bu su anda mumkun degil." goruyordu. Dogru anahtar var:
     KAYNAK  paket @25608342 (Eht enum uyesi; data/schemas.json
             mesajlar.err.alanlar.key.__degerler__ icinde de dogrulandi)
     KAYNAK  tr.json err.expand.max = "Zaten en fazla sayfa sayisina ulasildi."
     Istemcinin genisletme penceresi ayni durumda zaten ui.expand.at_max
     (ayni metin) yaziyor (paket @27396271) - sunucu ayni dili konusmali. */
  genisMax:  'err.expand.max',
};

// ------------------------------------------------------------------ yardimci
const tam = (v) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : NaN);
const sayi = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** S$ semasina indirger; sema disi alan tasimaz, eksik/bozuk yigin null doner. */
function yiginTemizle(st) {
  if (!st || typeof st !== 'object' || typeof st.itemId !== 'string' || !st.itemId) return null;
  const qty = tam(st.qty ?? 1);
  const o = { itemId: st.itemId, qty: Number.isFinite(qty) && qty >= 1 ? qty : 1 };
  const opt = (ad, en) => { const v = tam(st[ad]); if (Number.isFinite(v) && v >= en) o[ad] = v; };
  opt('plus', 0); opt('dur', 0); opt('maxDur', 1); opt('variance', 0);
  if (Array.isArray(st.blues)) {
    const b = st.blues
      .filter(x => x && Number.isFinite(Number(x.id)) && Number(x.id) > 0 && Number.isFinite(Number(x.value)))
      .map(x => ({ id: tam(x.id), value: Number(x.value) }));
    if (b.length) o.blues = b;
  }
  if (st.rolls && typeof st.rolls === 'object' && !Array.isArray(st.rolls)) {
    const r = {};
    for (const [k, v] of Object.entries(st.rolls)) if (Number.isFinite(Number(v))) r[k] = Number(v);
    if (Object.keys(r).length) o.rolls = r;
  }
  return o;
}

const ayniYigin = (a, b) => {
  // Yiginlanabilir esyada plus/dur/blues yok; yine de guvenli karsilastirma.
  if (!a || !b || a.itemId !== b.itemId) return false;
  return (a.plus ?? 0) === (b.plus ?? 0)
      && (a.dur ?? null) === (b.dur ?? null)
      && !a.blues && !b.blues && !a.rolls && !b.rolls;
};

// ============================================================================
export function kur(ctx) {
  const {
    frame, log = () => {}, GCFG = {}, ITEMSTATS = null,
    envanterPayload = null, web = null, SHARD = null,
  } = ctx ?? {};

  if (typeof frame !== 'function') throw new Error('sistem_banka-depo: ctx.frame gerekli');

  const CANTA_SAYFA_YUVASI = Math.max(1, tam(GCFG.bagSlots) || 32);
  /* game-config.npcInteractRangeU = 25 - yalniz YEDEK. Gercek yaricap NPC
     basina data/npcshops.json interactRangeU'dan geliyor (madde 45). */
  const MENZIL = sayi(GCFG.npcInteractRangeU) || 0;

  // ---------------------------------------------------------------- katalog
  /* data/items.json (3005 esya) `type` ve `stackMax` tasir; itemstats.json'da
     genisletme esyalari YOK, o yuzden ikisi birlestiriliyor. */
  const KATALOG = new Map();
  if (ITEMSTATS && typeof ITEMSTATS.get === 'function' && typeof ITEMSTATS.forEach === 'function') {
    ITEMSTATS.forEach((v, k) => { if (v && typeof v === 'object') KATALOG.set(k, v); });
  }
  try {
    const ham = JSON.parse(fs.readFileSync(path.join(BURASI, 'data', 'items.json'), 'utf8'));
    for (const it of (Array.isArray(ham?.items) ? ham.items : [])) {
      if (!it?.id) continue;
      KATALOG.set(it.id, { ...(KATALOG.get(it.id) ?? {}), ...it });
    }
  } catch (e) { log('banka: data/items.json okunamadi:', String(e.message).slice(0, 90)); }

  const tanim   = (id) => KATALOG.get(id) ?? null;
  const yiginMax = (id) => Math.max(1, tam(tanim(id)?.stackMax ?? 1) || 1);
  const esyaAdi  = (id) => tanim(id)?.name ?? id;

  // ----------------------------------------------------------- NPC konumlari
  /* Menzil kapisi icin NPC koordinatlari world.json'dan (zones[].npcs[].x/z). */
  const NPC_KONUM = new Map();   // `${zoneId}|${npcId}` -> [{x,z}, ...]
  try {
    const W = JSON.parse(fs.readFileSync(path.join(BURASI, 'world.json'), 'utf8'));
    for (const [zid, z] of Object.entries(W.zones ?? {})) {
      for (const n of z.npcs ?? []) {
        if (!n?.npcId) continue;
        const k = `${zid}|${n.npcId}`;
        if (!NPC_KONUM.has(k)) NPC_KONUM.set(k, []);
        NPC_KONUM.get(k).push({ x: sayi(n.x), z: sayi(n.z) });
      }
    }
  } catch (e) { log('banka: world.json okunamadi:', String(e.message).slice(0, 90)); }

  /* ------------------------------------------------------------ banka NPC'leri
   * MADDE 45 (fark #133/#134/#156). ESKI DAVRANIS iki ayri sekilde yanlisti:
   *
   *  (1) Bayrak SUNUCU AGACININ DISINDAN okunuyordu: once `server/data/npcs.json`
   *      (BU DOSYA YOK), sonra `../../GERCEK/paket_veri/npcs.json`. GERCEK/
   *      klasoru dagitima girmezse kume BOS kaliyor ve kapi kosulu
   *      `if (BANKA_NPC.size && ...)` oldugu icin bayrak kapisi TAMAMEN
   *      atlaniyordu -> menzildeki HERHANGI bir NPC uzerinden banka acilabilir.
   *      Artik birincil kaynak SUNUCUNUN KENDI verisi: data/npcshops.json
   *      (5 depo NPC'si bu maddede eklendi) ve kume BOS kalirsa kapi ACILMAZ,
   *      KAPANIR - banka mesajlari ERR_NOT_FOUND ile reddedilir.
   *
   *  (2) Menzil sabit 25 (GCFG.npcInteractRangeU) idi. Istemci NPC BASINA
   *      yaricap kullaniyor: Ict(npc, cfg.npcInteractRangeU) =
   *      npc.interactRangeU ?? cfg.npcInteractRangeU (paket @25686854).
   *      config/interact-radii.json'a gore NPC_CH_WAREHOUSE_M ve
   *      NPC_WC_WAREHOUSE_M 22.75, NPC_KT/EU/CA_WAREHOUSE 15 - yani sunucu
   *      istemciden GEVSEKTI. sistem_dukkan.js:177 ZATEN dogru yapiyordu;
   *      ayni kalip (Number(null)===0 tuzagina karsi `> 0` sarti dahil) burada
   *      da tekrarlaniyor.
   *
   * SEMA KANITI: NPC kaydinin `bank` alani istemcinin kendi semasinda var -
   * paket @8703450 civari Xot = X({ id, name, modelKey, shop?, bank: RJ()
   * .optional(), repair: RJ().optional(), trainer?... }).
   */
  const BANKA_NPC = new Map();      // npcId -> etkilesim yaricapi (birim)
  const bankaEkle = (id, kayit) => {
    if (!id || !kayit?.bank) return;
    const mr = Number(kayit.interactRangeU);
    BANKA_NPC.set(id, Number.isFinite(mr) && mr > 0 ? mr : MENZIL);
  };
  try {
    const ham = JSON.parse(fs.readFileSync(path.join(BURASI, 'data', 'npcshops.json'), 'utf8'));
    for (const [id, kayit] of Object.entries(ham?.shops ?? {})) bankaEkle(id, kayit);
  } catch (e) { log('banka: data/npcshops.json okunamadi:', String(e.message).slice(0, 90)); }
  /* Yedek adaylar (npcshops.json'da depo kaydi yoksa). Duz dizi ya da nesne
     olabilir; ikisini de kabul ediyoruz. */
  if (!BANKA_NPC.size) {
    for (const aday of [
      path.join(BURASI, 'data', 'npcs.json'),
      path.join(BURASI, '..', '..', 'GERCEK', 'paket_veri', 'npcs.json'),
    ]) {
      try {
        const ham = JSON.parse(fs.readFileSync(aday, 'utf8'));
        const liste = Array.isArray(ham) ? ham : Object.values(ham ?? {});
        for (const n of liste) bankaEkle(n?.id, n);
        if (BANKA_NPC.size) break;
      } catch { /* sonraki aday */ }
    }
  }
  if (!BANKA_NPC.size) {
    log('banka: HICBIR depo NPC\'si bulunamadi (data/npcshops.json bank:true) - '
      + 'banka mesajlari ERR_NOT_FOUND ile REDDEDILECEK (kapi GEVSETILMEZ)');
  } else {
    log(`banka: ${BANKA_NPC.size} depo NPC'si, menzil NPC basina `
      + `(${[...new Set(BANKA_NPC.values())].sort((a, b) => a - b).join('/')})`);
  }

  // ------------------------------------------------------------- veritabani
  /* Sema adlari sorguya METIN olarak giriyor (parametrelenemez), o yuzden
     kardes modullerdeki (sistem_borsa.js SHARD_AD) ayni beyaz liste. */
  const semaAdi = (v) => (typeof v === 'string' && /^[A-Za-z0-9_]+$/.test(v) ? v : null);
  const CFG_SQL = (() => {
    try {
      return JSON.parse(fs.readFileSync(path.join(BURASI, 'config.json'), 'utf8'))?.sql?.databases ?? null;
    } catch { return null; }
  })();
  const ACCOUNT_DB = semaAdi(CFG_SQL?.account ?? null);
  const SHARD_DB   = semaAdi(SHARD ?? CFG_SQL?.shard ?? null);

  let semaHazir = null;
  function semayiKur() {
    if (!web) return Promise.resolve(false);
    if (semaHazir) return semaHazir;
    semaHazir = web.request().batch(`
      IF OBJECT_ID('dbo.WebBank') IS NULL
        CREATE TABLE dbo.WebBank (
          JID int NOT NULL, Slot int NOT NULL, StackJson nvarchar(max) NOT NULL,
          CONSTRAINT PK_WebBank PRIMARY KEY (JID, Slot));
      IF OBJECT_ID('dbo.WebBankInfo') IS NULL
        CREATE TABLE dbo.WebBankInfo (
          JID int NOT NULL PRIMARY KEY, Capacity int NOT NULL,
          updatedAt datetime NOT NULL CONSTRAINT DF_WebBankInfo_upd DEFAULT GETDATE());
    `).then(() => true).catch((e) => {
      log('banka: sema kurulamadi:', String(e.message).slice(0, 120));
      return false;
    });
    return semaHazir;
  }
  semayiKur();

  async function dbYukle(JID) {
    if (!web || !SHARD_DB) return null;
    await semayiKur();
    const r = await web.request()
      .input('j', JID)
      .query(`
        SELECT Slot, StackJson FROM dbo.WebBank WHERE JID = @j;
        SELECT Capacity FROM dbo.WebBankInfo WHERE JID = @j;
        SELECT Gold FROM ${SHARD_DB}.dbo._AccountJID WHERE JID = @j;`);
    const [yuvalar, bilgi, altin] = r.recordsets;
    return {
      yuvalar: (yuvalar ?? []).map(x => ({ slot: tam(x.Slot), stack: JSON.parse(x.StackJson) })),
      kapasite: bilgi?.[0] ? tam(bilgi[0].Capacity) : null,
      altin: altin?.[0] ? sayi(altin[0].Gold) : 0,
    };
  }

  async function dbCuzdan(JID) {
    if (!web) return null;
    const r = await web.request().input('JID', JID).execute('WebGetWallet');
    return r.recordset?.[0] ?? null;
  }

  async function dbYuvaYaz(JID, slot, stack) {
    if (!web) return;
    await semayiKur();
    const rq = web.request().input('j', JID).input('s', slot);
    if (stack) {
      await rq.input('v', JSON.stringify(stack)).query(`
        MERGE dbo.WebBank AS t USING (SELECT @j AS JID, @s AS Slot) AS s
          ON t.JID = s.JID AND t.Slot = s.Slot
        WHEN MATCHED THEN UPDATE SET StackJson = @v
        WHEN NOT MATCHED THEN INSERT (JID, Slot, StackJson) VALUES (@j, @s, @v);`);
    } else {
      await rq.query('DELETE FROM dbo.WebBank WHERE JID = @j AND Slot = @s;');
    }
  }

  async function dbKapasiteYaz(JID, kap) {
    if (!web) return;
    await semayiKur();
    await web.request().input('j', JID).input('c', kap).query(`
      MERGE dbo.WebBankInfo AS t USING (SELECT @j AS JID) AS s ON t.JID = s.JID
      WHEN MATCHED THEN UPDATE SET Capacity = @c, updatedAt = GETDATE()
      WHEN NOT MATCHED THEN INSERT (JID, Capacity) VALUES (@j, @c);`);
  }

  /**
   * Banka altinini FARK olarak yazar - MUTLAK DEGERLE DEGIL.
   *
   * SEBEP (denetimde bulundu): ayni satiri, `<SHARD>.dbo._AccountJID.Gold`,
   * sistem_borsa.js de dogrudan SQL ile degistiriyor
   * (`UPDATE ... SET Gold = Gold - @m WHERE JID=@JID AND Gold >= @m`).
   * Bu modul altini bellekte onbellekliyor (b.altin). Mutlak yazsaydik, banka
   * penceresi acikken borsada gerceklesen bir emir/cekim onbellege yansimadigi
   * icin bir sonraki yatirma/cekme borsanin yazdigini EZERDI (altin kaybi/uretimi).
   * Fark yazip otoriter degeri geri okuyunca iki modul birbirini bozmaz.
   *
   * Doner: { ok, gold }  - gold = DB'deki OTORITER bakiye (yoksa null).
   *        ok=false: hicbir sey yazilmadi (cekimde DB'de yeterli bakiye yok
   *        ya da _AccountJID satiri hic acilamadi).
   */
  async function dbAltinDelta(JID, fark) {
    if (!web || !SHARD_DB) return { ok: true, gold: null };
    const m = Math.abs(tam(fark));
    if (!Number.isFinite(m) || m <= 0) return { ok: true, gold: null };

    /* Satir yoksa AccountID'yi TB_User.StrUserID'den alarak ac (uydurma yok);
       ACCOUNT_DB bilinmiyorsa acamayiz, UPDATE 0 satir eder ve ok=false doner. */
    const satirAc = ACCOUNT_DB ? `
      IF NOT EXISTS (SELECT 1 FROM ${SHARD_DB}.dbo._AccountJID WHERE JID = @j)
        INSERT INTO ${SHARD_DB}.dbo._AccountJID (AccountID, JID, Gold)
        SELECT TOP 1 u.StrUserID, u.JID, 0 FROM ${ACCOUNT_DB}.dbo.TB_User u WHERE u.JID = @j;` : '';
    const govde = fark > 0
      ? `UPDATE ${SHARD_DB}.dbo._AccountJID SET Gold = Gold + @m WHERE JID = @j;`
      : `UPDATE ${SHARD_DB}.dbo._AccountJID SET Gold = Gold - @m WHERE JID = @j AND Gold >= @m;`;

    /* @@ROWCOUNT'u AYRI satirda yakaliyoruz: ayni SELECT icinde alt sorguyla
       birlikte okumak SQL Server'da guvenilir degil. */
    const r = await web.request().input('j', JID).input('m', m).query(`
      SET NOCOUNT ON;
      SET XACT_ABORT ON;
      DECLARE @n int;
      ${satirAc}
      ${govde}
      SET @n = @@ROWCOUNT;
      SELECT @n AS n, (SELECT Gold FROM ${SHARD_DB}.dbo._AccountJID WHERE JID = @j) AS g;`);
    const sat = r.recordset?.[0] ?? null;
    const g = (sat && sat.g !== null && sat.g !== undefined) ? sayi(sat.g) : null;
    return { ok: tam(sat?.n) > 0, gold: g };
  }

  /**
   * `_Char.RemainGold` - karakterin uzerindeki altin.
   * YAZILMAZSA ALTIN KOPYALANIR: giriste routes_auth.js altini buradan okuyor
   * (`gold: Number(c.RemainGold)`), yani oyuncu altini bankaya koyup cikis-giris
   * yaparsa karakterdeki altin eski degeriyle geri gelir ve banka altini da
   * yerinde durur. Kardes moduller (sistem_dukkan.js altiniKaydet,
   * sistem_borsa.js karakterAltiniKaydet) da tam olarak boyle yaziyor.
   */
  async function dbKarakterAltiniYaz(ch) {
    if (!web || !SHARD_DB) return;
    const cid = Number(ch?.id);
    if (!Number.isFinite(cid)) return;
    await web.request()
      .input('c', cid)
      .input('g', Math.max(0, Math.round(sayi(ch.gold))))
      .query(`UPDATE ${SHARD_DB}.dbo._Char SET RemainGold = @g WHERE CharID = @c;`);
  }

  /* vSRO _Char.InventorySize, 13 KUSAM yuvasini da sayar:
       routes_auth.js equipOf() -> `WHERE i.Slot < 13` (0..12 kusam, sonrasi canta)
       ve vSRO varsayilani 45 = 13 + 32 = 13 + gameConfig.bagSlots.
     Bu yuzden referans oyun canta yuvasi <-> InventorySize donusumu 13 kaydiriyor. */
  const VSRO_KUSAM_YUVASI = 13;
  const vsroBoyu    = (cantaYuvasi) => VSRO_KUSAM_YUVASI + cantaYuvasi;
  const cantaBoyuCoz = (inventorySize) => {
    const n = tam(inventorySize) - VSRO_KUSAM_YUVASI;
    if (!Number.isFinite(n) || n < CANTA_SAYFA_YUVASI) return null;
    return Math.min(CANTA_MAX_YUVA, n);
  };

  async function dbCantaBoyuYaz(CharID, cantaYuvasi) {
    // `!CharID` DEGIL: _Char'da CharID 0 olan gercek satir var, o karakteri atlardi.
    if (!web || !SHARD_DB || CharID === null || CharID === undefined) return;
    await web.request().input('c', CharID).input('n', vsroBoyu(cantaYuvasi))
      .query(`UPDATE ${SHARD_DB}.dbo._Char SET InventorySize = @n WHERE CharID = @c;`);
  }

  /**
   * Giriste cagrilir: _Char.InventorySize'dan genisletilmis canta boyunu geri
   * yukler. server.js bunu auth'tan SONRA cagirmali, yoksa oyuncu her giriste
   * 32 yuvaya duser (satin aldigi sayfalar kaybolmus gorunur).
   *
   * NEDEN hem `ws` hem `ch` kabul ediyor: server.js modul kancasini
   * `ornek.yukle(ch)` olarak cagiriyor (server.js:1590 modulleriYukle), ama bu
   * fonksiyonun eski cagri bicimi `ws` idi. Ikisini de kabul ederek eski
   * cagriyi kirmadan yeni kancaya baglaniyoruz.
   */
  async function cantaBoyunuGeriYukle(wsVeyaCh) {
    const ch = wsVeyaCh?.char ?? wsVeyaCh ?? null;
    // `!ch.id` DEGIL: CharID 0 gecerli bir karakter (bkz. dbCantaBoyuYaz).
    if (!web || !SHARD_DB || ch === null || ch.id === null || ch.id === undefined) return null;
    try {
      const r = await web.request().input('c', ch.id)
        .query(`SELECT InventorySize FROM ${SHARD_DB}.dbo._Char WHERE CharID = @c;`);
      const boy = cantaBoyuCoz(r.recordset?.[0]?.InventorySize);
      if (!boy) return null;
      /* SARTNAME-3 MADDE 12 - kendi kendini iyilestiren gecis (Mimari A):
         eski karakterler DB'de InventorySize=173 (-> 160 yuva) tasiyor;
         migration SQL'i beklemeden her giriste 12 sayfa tabanina (384)
         acilir. Taban YALNIZ bellekte buyutur; _Inventory'ye satir ACMAZ
         (Slot TINYINT, ALTER yok) - yuva 227+ WebCharInventory'de yasar. */
      const hedefBoy = Math.max(boy, CANTA_MAX_YUVA);
      const bag = cantayiHazirla(ch);
      if (bag.length >= hedefBoy) return bag.length;
      for (let i = bag.length; i < hedefBoy; i++) bag[i] = null;
      bag.length = hedefBoy;
      return hedefBoy;
    } catch (e) { log('banka: canta boyu okunamadi:', String(e.message).slice(0, 90)); return null; }
  }

  /* =================================================== GENISLETILMIS YUVA KURTARMA
   * SORUN (olculdu): server.js girisi su sirayla isliyor (server.js:1458-1468):
   *     await modulleriYukle(ch);      // bizim yukle(ch) burada -> bag.length = 64
   *     await KALICI.yukle(ch);        // kalicilik.js -> ch.bag = new Array(32)
   * kalicilik.js:71 cantayi HER ZAMAN `new Array(bagSlots)` (=GCFG.bagSlots=32)
   * olarak kuruyor ve :78 `row.Slot < canta.length` kapisiyla 32 ve uzerindeki
   * yuvalari SESSIZCE ATIYOR. Bir sonraki kaydet() ise kosulsuz
   * `DELETE FROM WebCharInventory WHERE CharID=@c` yapip (kalicilik.js:134)
   * yalnizca elindeki 32 yuvayi geri yaziyor -> 2..5. canta sayfasindaki
   * esyalar KALICI olarak siliniyor.
   *
   * Dogru duzeltme kalicilik.js'te (bkz. rapor "cekirdekIhtiyaci"); o dosya bu
   * gorevde bana ait DEGIL. Burada kaybi ONLEYEN telafi var: `zone.ready`
   * (giris.js'in sentetik mesaji, zone.init'ten hemen SONRA ve ilk kaydet()
   * tikinden cok once dagitiliyor) aninda
   *   1) canta boyunu tekrar acariz,
   *   2) WebCharInventory'de HALA duran yuksek yuvali satirlari geri okuruz.
   * Satirlar o an hala yerinde: kaydet() ancak 30 sn'lik tikte veya cikista
   * calisiyor (server.js:1416 setInterval / close dali).
   */
  async function yuksekYuvalariKurtar(ch) {
    if (!web || ch?.id === null || ch?.id === undefined) return 0;
    const bag = cantayiHazirla(ch);
    let kurtarilan = 0;
    try {
      const r = await web.request().input('c', tam(ch.id))
        .query(`SELECT Slot, StackJson FROM dbo.WebCharInventory
                 WHERE CharID = @c AND Kap = 'bag'`);
      for (const satir of r.recordset ?? []) {
        const yuva = tam(satir.Slot);
        if (!(yuva >= 0 && yuva < bag.length)) continue;   // boy disi -> kurtaramayiz
        if (bag[yuva]) continue;                            // KALICI zaten koydu
        let yigin = null;
        try { yigin = yiginTemizle(JSON.parse(satir.StackJson)); } catch { yigin = null; }
        if (!yigin) continue;
        bag[yuva] = yigin;
        kurtarilan++;
      }
    } catch (e) {
      /* Tablo yoksa (SQL kapali kurulum) sessizce gec - kalicilik zaten yok. */
      log('banka: yuksek yuva kurtarma atlandi:', String(e.message).slice(0, 90));
    }
    return kurtarilan;
  }

  /** server.js modulleriYukle(ch) kancasi - zone.init'ten ONCE calisir. */
  async function yukle(ch) {
    return cantaBoyunuGeriYukle(ch);
  }

  /** Sokete BIR KEZ: boyu tekrar ac + KALICI'nin dusurdugu yuvalari kurtar. */
  function girisKurulumu(ws) {
    if (!ws?.char || ws.__bankaGiris) return;
    ws.__bankaGiris = true;
    (async () => {
      const oncekiBoy = (ws.char.bag?.length ?? 0);
      const boy = await cantaBoyunuGeriYukle(ws);
      if (!boy || boy <= oncekiBoy) return;               // genisletme yok - is yok
      const n = await yuksekYuvalariKurtar(ws.char);
      log(`banka: ${ws.char.name ?? ws.char.id} canta boyu ${oncekiBoy} -> ${boy}` +
          (n ? `, ${n} yuva geri kurtarildi` : ''));
      envanteriYolla(ws);
    })().catch((e) => log('banka: giris kurulumu:', String(e?.message ?? e).slice(0, 120)));
  }

  // ------------------------------------------------------------ banka durumu
  /** JID -> { hazir, yukleniyor, yuklemeHatasi, bekleyenler[], kapasite,
   *           yuvalar[], altin, cuzdan, kuyruk } */
  const BANKALAR = new Map();

  function yeniBanka() {
    return {
      hazir: false, yukleniyor: false, yuklemeHatasi: false,
      /* Yukleme surerken gelen HER istegin geri cagrisi burada birikir;
         eskiden yalnizca ILK istegin geri cagrisi tutuluyordu ve ayni hesabin
         ikinci karakteri/soketi acilis karelerini hic alamiyordu. */
      bekleyenler: [],
      kapasite: DEPO_SAYFA_YUVASI,
      yuvalar: new Array(DEPO_SAYFA_YUVASI).fill(null),
      altin: 0,
      cuzdan: { jadeUnits: 0, jadeLockedUnits: 0, depositAddress: '' },
      kuyruk: Promise.resolve(),
    };
  }

  /** Yazma islerini JID basina siraya sokar; ic ice yazmalar birbirini ezmez. */
  function sirala(b, fn) {
    b.kuyruk = b.kuyruk.then(fn).catch((e) => log('banka yazma hatasi:', String(e.message).slice(0, 120)));
    return b.kuyruk;
  }

  function boyutla(b) {
    const k = Math.max(DEPO_SAYFA_YUVASI, Math.min(DEPO_MAX_YUVA, tam(b.kapasite) || DEPO_SAYFA_YUVASI));
    b.kapasite = k;
    if (b.yuvalar.length < k) b.yuvalar.length = k;
    for (let i = 0; i < k; i++) if (b.yuvalar[i] === undefined) b.yuvalar[i] = null;
    return b;
  }

  /**
   * Hesabin banka kaydini dondurur. Henuz DB'den gelmediyse null doner ve
   * yuklemeyi baslatir (cagiran err.busy.bank gondermeli).
   */
  function bankaAl(JID, sonra) {
    let b = BANKALAR.get(JID);
    if (!b) { b = yeniBanka(); BANKALAR.set(JID, b); }
    if (b.hazir) return b;
    if (!web) { b.hazir = true; return boyutla(b); }        // DB yok -> bellek modu
    if (typeof sonra === 'function') b.bekleyenler.push(sonra);
    if (!b.yukleniyor) {
      b.yukleniyor = true;
      Promise.all([dbYukle(JID), dbCuzdan(JID).catch(() => null)])
        .then(([veri, cuz]) => {
          if (veri) {
            b.kapasite = veri.kapasite ?? DEPO_SAYFA_YUVASI;
            boyutla(b);
            for (const y of veri.yuvalar) {
              const st = yiginTemizle(y.stack);
              if (st && y.slot >= 0 && y.slot < b.kapasite) b.yuvalar[y.slot] = st;
            }
            b.altin = veri.altin;
          }
          if (cuz) {
            b.cuzdan = {
              jadeUnits: sayi(cuz.jadeUnits),
              jadeLockedUnits: sayi(cuz.jadeLockedUnits),
              depositAddress: cuz.depositAddress ?? '',
            };
          }
          b.hazir = true; b.yukleniyor = false; b.yuklemeHatasi = false;
          for (const fn of b.bekleyenler.splice(0)) {
            try { fn(b); } catch { /* soket bu arada kapanmis olabilir */ }
          }
        })
        .catch((e) => {
          b.yukleniyor = false;
          b.yuklemeHatasi = true;          // kapi() err.bank.internal yollasin
          b.bekleyenler.length = 0;
          log('banka yuklenemedi:', String(e.message).slice(0, 120));
        });
    }
    return null;
  }

  // ---------------------------------------------------------------- kareler
  const hata = (ws, code, key, params) => {
    const d = { code };
    if (key) d.key = key;
    /* err semasi params'i opsiyonel tasir (@25631967) - yalniz gold_cap gibi
       {cap} yer tutuculu anahtarlar verir. */
    if (params && typeof params === 'object' && Object.keys(params).length) d.params = params;
    frame(ws, 'err', d);
  };
  const bildir = (ws, key, params) => frame(ws, 'sys.notice', params ? { key, params } : { key });

  function bankaKaresi(b) {
    const slots = [];
    for (let i = 0; i < b.kapasite; i++) if (b.yuvalar[i]) slots.push({ slot: i, stack: b.yuvalar[i] });
    return { slots, capacity: b.kapasite };
  }
  const cuzdanKaresi = (b) => ({
    jadeUnits: tam(b.cuzdan.jadeUnits) || 0,
    jadeLockedUnits: tam(b.cuzdan.jadeLockedUnits) || 0,
    gold: tam(b.altin) || 0,
    depositAddress: String(b.cuzdan.depositAddress ?? ''),
  });

  const bankayiYolla  = (ws, b) => frame(ws, 'bank.items', bankaKaresi(b));
  const cuzdaniYolla  = (ws, b) => frame(ws, 'exch.wallet', cuzdanKaresi(b));
  const envanteriYolla = (ws) => { if (envanterPayload) frame(ws, 'inv.update', envanterPayload(ws.char)); };

  // ------------------------------------------------------------ menzil kapisi
  /**
   * NPC gercekten bir DEPO NPC'si mi ve oyuncu menzilinde mi?
   * MADDE 45: kume bos kalirsa (veri dosyasi yok) kapi ACILMAZ - eskiden
   * `if (BANKA_NPC.size && ...)` ile tamamen atlaniyordu. Menzil de sabit 25
   * degil, NPC BASINA (interactRangeU; istemci Ict() ile ayni).
   * @returns 'ok' | 'npc-degil' (bilinmeyen/ bank olmayan NPC) | 'menzil'
   */
  function npcDurumu(ws, npcId) {
    if (typeof npcId !== 'string' || !npcId) return 'npc-degil';
    const menzil = BANKA_NPC.get(npcId);
    if (menzil === undefined) return 'npc-degil';
    const liste = NPC_KONUM.get(`${ws.zoneId}|${npcId}`);
    if (!liste || !liste.length) return 'npc-degil';   // bu bolgede yok
    if (!(menzil > 0)) return 'ok';                    // yaricap yoksa menzil olculmez
    const m2 = menzil * menzil;
    const cx = sayi(ws.char?.x), cz = sayi(ws.char?.z);
    for (const p of liste) {
      const dx = p.x - cx, dz = p.z - cz;
      if (dx * dx + dz * dz <= m2) return 'ok';
    }
    return 'menzil';
  }

  /** Geriye donuk kolaylik (test/tani): sadece 'ok' mu? */
  const npcYakinMi = (ws, npcId) => npcDurumu(ws, npcId) === 'ok';

  // -------------------------------------------------------------- canta esasi
  function cantayiHazirla(ch) {
    const n = Array.isArray(ch.bag) && ch.bag.length ? ch.bag.length : CANTA_SAYFA_YUVASI;
    if (!Array.isArray(ch.bag)) ch.bag = new Array(n).fill(null);
    for (let i = 0; i < ch.bag.length; i++) if (ch.bag[i] === undefined) ch.bag[i] = null;
    return ch.bag;
  }

  /**
   * `kaynak` yigininin `adet` kadarini `hedef` diziye yerlestirir.
   * Once ayni esyanin dolmamis yiginlarina, sonra bos yuvalara.
   * Yerlestirilen adedi doner (0 = hic yer yok).
   */
  function yerlestir(hedef, sinir, stack, adet) {
    const max = yiginMax(stack.itemId);
    let kalan = adet, kondu = 0;
    if (max > 1) {
      for (let i = 0; i < sinir && kalan > 0; i++) {
        const s = hedef[i];
        if (!s || !ayniYigin(s, stack)) continue;
        const yer = max - (s.qty ?? 1);
        if (yer <= 0) continue;
        const k = Math.min(yer, kalan);
        s.qty = (s.qty ?? 1) + k; kalan -= k; kondu += k;
      }
    }
    for (let i = 0; i < sinir && kalan > 0; i++) {
      if (hedef[i]) continue;
      const k = Math.min(max, kalan);
      hedef[i] = { ...stack, qty: k };
      kalan -= k; kondu += k;
    }
    return kondu;
  }

  /** Degisen yuvalari DB'ye yazmak icin: hedef dizinin anlik kopyasini kiyasla. */
  const kopya = (dizi, n) => { const o = new Array(n); for (let i = 0; i < n; i++) o[i] = dizi[i] ? JSON.stringify(dizi[i]) : null; return o; };
  function farklariYaz(b, JID, once, sonra) {
    if (!web) return;
    const n = Math.max(once.length, sonra.length);
    const isler = [];
    for (let i = 0; i < n; i++) if (once[i] !== sonra[i]) isler.push([i, b.yuvalar[i] ?? null]);
    if (!isler.length) return;
    sirala(b, async () => { for (const [slot, st] of isler) await dbYuvaYaz(JID, slot, st); });
  }

  // ==================================================================== mesaj
  function mesaj(ws, t, d) {
    /* GIRIS KANCASI. giris.js sentetik `zone.ready`yi dagiticidan geciriyor
       (giris.js "girisAkisi" madde 2) ve o an zone.init ZATEN gitmis oluyor -
       yani KALICI.yukle de bitmis. Canta boyunu tam burada geri aliyoruz.
       false donuyoruz: mesaj bizim degil, yonlendirici devam etsin. */
    if (t === 'zone.ready') { girisKurulumu(ws); return false; }
    switch (t) {
      case 'exch.open':   return acilis(ws);
      case 'exch.close':  return false;     // durum tutmuyoruz, borsa modulune birak
      case 'bank.depositGold':  return altinYatir(ws, d);
      case 'bank.withdrawGold': return altinCek(ws, d);
      case 'bank.depositItem':  return esyaYatir(ws, d);
      case 'bank.withdrawItem': return esyaCek(ws, d);
      case 'bank.moveItem':     return esyaTasi(ws, d);
      case 'item.expand':       return genislet(ws, d);
      default: return false;
    }
  }

  const jidOf = (ws) => {
    const j = tam(ws?.user?.JID);
    return Number.isFinite(j) && j > 0 ? j : null;
  };

  /**
   * Banka altinini DB'den OTORITER olarak tazeler.
   * `_AccountJID.Gold` satirini sistem_borsa.js de degistiriyor; pencere her
   * acildiginda okumazsak onbellek eskir ve oyuncuya yanlis bakiye gosteririz.
   */
  function altiniTazele(ws, b, JID) {
    if (!web || !SHARD_DB) return;
    sirala(b, async () => {
      const r = await web.request().input('j', JID)
        .query(`SELECT Gold FROM ${SHARD_DB}.dbo._AccountJID WHERE JID = @j;`);
      const g = r.recordset?.[0] ? sayi(r.recordset[0].Gold) : 0;
      if (g === sayi(b.altin)) return;
      b.altin = g;
      cuzdaniYolla(ws, b);
    });
  }

  /** exch.open: banka penceresinin ihtiyaci olan iki kareyi yollar, sonra
   *  false doner ki borsa modulu de ayni mesaji isleyebilsin. */
  function acilis(ws) {
    const JID = jidOf(ws);
    if (JID === null) return false;
    const b = bankaAl(JID, (hazir) => { bankayiYolla(ws, hazir); cuzdaniYolla(ws, hazir); });
    if (b) { bankayiYolla(ws, b); cuzdaniYolla(ws, b); altiniTazele(ws, b, JID); }
    return false;
  }

  /** Ortak on kapi: JID + menzil + yuklu banka. */
  function kapi(ws, d) {
    const JID = jidOf(ws);
    if (JID === null || !ws.char) { hata(ws, HATA.DOGRULAMA); return null; }
    /* MADDE 45: iki red AYRI. "Bu NPC banka degil" (ya da depo verisi hic yok)
       -> ERR_NOT_FOUND; "banka ama uzaktasin" -> ERR_RANGE. Eskiden ikisi de
       ERR_RANGE idi ve veri dosyasi yoksa kapi hic calismiyordu. */
    const durum = npcDurumu(ws, d?.npcId);
    if (durum !== 'ok') { hata(ws, durum === 'menzil' ? HATA.MENZIL : HATA.YOK); return null; }
    const b = bankaAl(JID, (hazir) => { bankayiYolla(ws, hazir); cuzdaniYolla(ws, hazir); });
    if (!b) {
      /* Hala yukleniyorsa "mesgul", son deneme HATA ile bittiyse "ic hata" -
         err.bank.internal metni tam bunu diyor: "hicbir sey tasinmadi". */
      const kayit = BANKALAR.get(JID);
      hata(ws, HATA.MESGUL, kayit?.yuklemeHatasi ? ANAHTAR.bankaIc : ANAHTAR.bankaMesgul);
      return null;
    }
    return { JID, b };
  }

  // ------------------------------------------------------------------ altin
  /**
   * Altin transferini kalicilastirir (banka farki + karakter altini).
   * DB fark yazmayi REDDEDERSE (ornegin borsa arada altini almistir) bellekteki
   * iki tarafi da geri alir, guncel kareleri yeniden yollar ve istemciye
   * err.bank.internal ("Bir seyler ters gitti - hicbir sey tasinmadi") gonderir.
   */
  function altiniKalicila(ws, b, JID, fark) {
    if (!web || !SHARD_DB) return;          // bellek modu: kalicilik yok
    const ch = ws.char;
    sirala(b, async () => {
      let sonuc, hataMetni = '';
      try { sonuc = await dbAltinDelta(JID, fark); }
      catch (e) { sonuc = { ok: false, gold: null }; hataMetni = String(e.message).slice(0, 120); }

      if (!sonuc.ok) {
        // GERI AL. Mutlak degere donmuyoruz - arada baska islem olmus olabilir.
        b.altin = sonuc.gold === null ? sayi(b.altin) - fark : sonuc.gold;
        ch.gold = sayi(ch.gold) + fark;
        envanteriYolla(ws);
        cuzdaniYolla(ws, b);
        hata(ws, HATA.MESGUL, ANAHTAR.bankaIc);
        log('banka: altin farki yazilamadi, islem geri alindi', hataMetni);
        return;
      }
      // DB otoriter: borsa arada degistirdiyse dogru bakiyeyi goster.
      if (sonuc.gold !== null && sonuc.gold !== sayi(b.altin)) {
        b.altin = sonuc.gold;
        cuzdaniYolla(ws, b);
      }
      try { await dbKarakterAltiniYaz(ch); }
      catch (e) { log('banka: karakter altini kaydedilemedi:', String(e.message).slice(0, 120)); }
    });
  }

  /**
   * DISA ACIK KOPRU - HESAP BANKASI ALTINI ARTIR  (plan maddesi 44).
   *
   * NEDEN: mezat geliri ve gecilen teklifin iadesi referans oyunda KARAKTER
   * cuzdanina degil HESAP BANKASINA gidiyor. Metinler bunu acikca soyluyor
   * (client/assets/locales/tr.json):
   *   ui.auction.status_sold  "{gold} karsiliginda satildi - bankana odendi"
   *   ui.auction.toast_sold   "{item} esyan {gold} altina satildi - bankana odendi."
   *   ui.auction.toast_outbid "{item} icin teklifin gecildi - {gold} altin bankana iade edildi."
   *   ui.bank.bank_gold_tip   "Hesap bankasi altini - Silk Borsasi ile ortak"
   * Teklif ise KARAKTER altinindan cikiyor (err.auction.gold "Karakterinde
   * yeterli altin yok."), yani iki yon SIMETRIK DEGIL - oyle de kaliyor.
   *
   * Yazim yine FARK ile (`Gold = Gold + @m`): ayni satiri sistem_borsa.js de
   * degistiriyor, mutlak yazim onun islemini ezerdi (bkz. dbAltinDelta notu).
   *
   * @param JID      hesap kimligi (_AccountJID.JID)
   * @param miktar   pozitif tamsayi altin
   * @param soketler o hesabin ACIK soketleri - bu modulde oyuncu defteri YOK,
   *                 cagiran verir (sistem_kucuk-sistemler.hesapSoketleri).
   *                 Bos/eksik gecilebilir: cevrimdisi oyuncu.
   * @returns Promise<boolean> - altin gercekten yazildi mi
   */
  async function bankayaAltinEkle(JID, miktar, soketler = []) {
    const jid = tam(JID);
    const m = tam(miktar);
    if (!Number.isFinite(jid) || jid <= 0) return false;
    if (!Number.isFinite(m) || m <= 0) return false;

    let sonuc = { ok: true, gold: null };
    if (web && SHARD_DB) {
      try { sonuc = await dbAltinDelta(jid, +m); }
      catch (e) {
        log('banka: bankayaAltinEkle yazamadi:', String(e.message).slice(0, 120));
        return false;
      }
      if (!sonuc.ok) { log(`banka: bankayaAltinEkle - JID ${jid} satiri yok, ${m} altin yazilamadi`); return false; }
    }

    /* Bellekteki onbellek. BELLEK MODUNDA (web yok) kayit yoksa ACIYORUZ,
       yoksa altin hicbir yere yazilmadigi icin KAYBOLURDU. */
    let b = BANKALAR.get(jid) ?? null;
    if (!b && !web) b = bankaAl(jid);
    if (b?.hazir) {
      b.altin = sonuc.gold !== null ? sonuc.gold : sayi(b.altin) + m;
      for (const ws of soketler ?? []) { try { cuzdaniYolla(ws, b); } catch { /* soket kapanmis */ } }
    }
    /* b var ama HENUZ YUKLENIYORSA bellege dokunmuyoruz: yukleme zaten
       DB'den OTORITER Gold okuyor, ayrica exch.open her acilista
       altiniTazele() ile yeniden okuyor. */
    return true;
  }

  function altinYatir(ws, d) {
    const g = kapi(ws, d); if (!g) return true;
    const { JID, b } = g;
    const miktar = tam(d?.amount);
    if (!Number.isFinite(miktar) || miktar < 1) { hata(ws, HATA.DOGRULAMA); return true; }
    const ch = ws.char;
    if (sayi(ch.gold) < miktar) { hata(ws, HATA.ALTIN); return true; }

    ch.gold = sayi(ch.gold) - miktar;
    b.altin = sayi(b.altin) + miktar;

    envanteriYolla(ws);
    cuzdaniYolla(ws, b);
    bildir(ws, ANAHTAR.altinIn, { gold: miktar });
    altiniKalicila(ws, b, JID, +miktar);
    return true;
  }

  function altinCek(ws, d) {
    const g = kapi(ws, d); if (!g) return true;
    const { JID, b } = g;
    const miktar = tam(d?.amount);
    if (!Number.isFinite(miktar) || miktar < 1) { hata(ws, HATA.DOGRULAMA); return true; }
    if (sayi(b.altin) < miktar) { hata(ws, HATA.ALTIN); return true; }
    /* PP MADDE 3 (changelog 0025): cekim karakter altinini tavanin ustune
       cikaracaksa HICBIR sey tasinmadan acik mesajla reddedilir. */
    if (sayi(ws.char.gold) + miktar > ALTIN_TAVANI) {
      hata(ws, HATA.DOGRULAMA, 'err.gold_cap', { cap: ALTIN_TAVANI });
      return true;
    }

    b.altin = sayi(b.altin) - miktar;
    ws.char.gold = sayi(ws.char.gold) + miktar;

    envanteriYolla(ws);
    cuzdaniYolla(ws, b);
    bildir(ws, ANAHTAR.altinOut, { gold: miktar });
    altiniKalicila(ws, b, JID, -miktar);
    return true;
  }

  // ------------------------------------------------------------------- esya
  function esyaYatir(ws, d) {
    const g = kapi(ws, d); if (!g) return true;
    const { JID, b } = g;
    const ch = ws.char;
    const bag = cantayiHazirla(ch);
    const yuva = tam(d?.bagSlot);
    if (!Number.isFinite(yuva) || yuva < 0 || yuva >= bag.length) { hata(ws, HATA.DOGRULAMA); return true; }
    const kaynak = yiginTemizle(bag[yuva]);
    if (!kaynak) { hata(ws, HATA.YOK); return true; }

    // Istemci "tamamini koy" icin qty:999 gonderiyor -> eldekine kirp.
    const istek = tam(d?.qty); if (!Number.isFinite(istek) || istek < 1) { hata(ws, HATA.DOGRULAMA); return true; }
    const adet = Math.min(istek, kaynak.qty);

    const once = kopya(b.yuvalar, b.kapasite);
    const kondu = yerlestir(b.yuvalar, b.kapasite, kaynak, adet);
    if (!kondu) { hata(ws, HATA.DOLU, ANAHTAR.bankaDolu); return true; }

    bag[yuva] = kondu >= kaynak.qty ? null : { ...kaynak, qty: kaynak.qty - kondu };

    farklariYaz(b, JID, once, kopya(b.yuvalar, b.kapasite));
    envanteriYolla(ws);
    bankayiYolla(ws, b);
    bildir(ws, ANAHTAR.esyaIn, { qty: kondu, item: esyaAdi(kaynak.itemId) });
    return true;
  }

  function esyaCek(ws, d) {
    const g = kapi(ws, d); if (!g) return true;
    const { JID, b } = g;
    const ch = ws.char;
    const bag = cantayiHazirla(ch);
    const yuva = tam(d?.bankSlot);
    if (!Number.isFinite(yuva) || yuva < 0 || yuva >= b.kapasite) { hata(ws, HATA.DOGRULAMA); return true; }
    const kaynak = yiginTemizle(b.yuvalar[yuva]);
    if (!kaynak) { hata(ws, HATA.YOK); return true; }

    const istek = tam(d?.qty); if (!Number.isFinite(istek) || istek < 1) { hata(ws, HATA.DOGRULAMA); return true; }
    const adet = Math.min(istek, kaynak.qty);

    const kondu = yerlestir(bag, bag.length, kaynak, adet);
    if (!kondu) { hata(ws, HATA.DOLU); return true; }   // err.ERR_BAG_FULL

    const once = kopya(b.yuvalar, b.kapasite);
    b.yuvalar[yuva] = kondu >= kaynak.qty ? null : { ...kaynak, qty: kaynak.qty - kondu };

    farklariYaz(b, JID, once, kopya(b.yuvalar, b.kapasite));
    envanteriYolla(ws);
    bankayiYolla(ws, b);
    bildir(ws, ANAHTAR.esyaOut, { qty: kondu, item: esyaAdi(kaynak.itemId) });
    return true;
  }

  /** Banka ici tasima: bos hedefe tasi, ayni yigina birlestir, degilse takas. */
  function esyaTasi(ws, d) {
    const g = kapi(ws, d); if (!g) return true;
    const { JID, b } = g;
    const a = tam(d?.from), z = tam(d?.to);
    if (![a, z].every(v => Number.isFinite(v) && v >= 0 && v < b.kapasite)) { hata(ws, HATA.DOGRULAMA); return true; }
    if (a === z) return true;
    const kaynak = yiginTemizle(b.yuvalar[a]);
    if (!kaynak) { hata(ws, HATA.YOK); return true; }

    const once = kopya(b.yuvalar, b.kapasite);
    const hedef = yiginTemizle(b.yuvalar[z]);
    if (!hedef) {
      b.yuvalar[z] = kaynak; b.yuvalar[a] = null;
    } else if (ayniYigin(hedef, kaynak)) {
      const max = yiginMax(kaynak.itemId);
      const yer = max - hedef.qty;
      if (yer <= 0) { b.yuvalar[a] = hedef; b.yuvalar[z] = kaynak; }   // dolu -> takas
      else {
        const k = Math.min(yer, kaynak.qty);
        hedef.qty += k;
        b.yuvalar[z] = hedef;
        b.yuvalar[a] = (kaynak.qty - k) > 0 ? { ...kaynak, qty: kaynak.qty - k } : null;
      }
    } else {
      b.yuvalar[a] = hedef; b.yuvalar[z] = kaynak;
    }

    farklariYaz(b, JID, once, kopya(b.yuvalar, b.kapasite));
    bankayiYolla(ws, b);
    return true;
  }

  // -------------------------------------------------------------- genisletme
  /**
   * item.expand - esyanin `type` alani karari verir:
   *   bagExpand     -> canta +GCFG.bagSlots yuva, en fazla 5 sayfa
   *   storageExpand -> depo  +36 yuva,           en fazla 10 sayfa
   *   carrierExpand -> BU MODULUN ISI DEGIL -> false doner (tasiyici modulu),
   *                    esya TUKETILMEZ.
   */
  function genislet(ws, d) {
    if (!ws?.char) return false;
    const ch = ws.char;
    const bag = cantayiHazirla(ch);
    const yuva = tam(d?.bagSlot);
    if (!Number.isFinite(yuva) || yuva < 0 || yuva >= bag.length) { hata(ws, HATA.DOGRULAMA); return true; }
    const st = yiginTemizle(bag[yuva]);
    if (!st) { hata(ws, HATA.YOK); return true; }
    const tip = tanim(st.itemId)?.type ?? null;

    if (tip === 'bagExpand') {
      const sayfa = Math.max(1, Math.ceil(bag.length / CANTA_SAYFA_YUVASI));
      /* Sayfa tavani (12, sartname-3 madde 10) asilinca err.expand.max - bkz. ANAHTAR.genisMax
         (paket @25608342 / tr.json). Sayfa hesabi istemciyle birebir:
         paket @27396219 `Math.max(1, Math.ceil(bag.length / gameConfig.bagSlots))`. */
      if (sayfa >= CANTA_MAX_SAYFA || bag.length >= CANTA_MAX_YUVA) { hata(ws, HATA.DOGRULAMA, ANAHTAR.genisMax); return true; }
      const yeniBoy = Math.min(CANTA_MAX_YUVA, bag.length + CANTA_SAYFA_YUVASI);
      for (let i = bag.length; i < yeniBoy; i++) bag[i] = null;
      bag.length = yeniBoy;
      tuket(ch, yuva, st);
      if (web) dbCantaBoyuYaz(ch.id, yeniBoy).catch(e => log('banka: InventorySize yazilamadi:', String(e.message).slice(0, 90)));
      envanteriYolla(ws);
      bildir(ws, ANAHTAR.genisCanta, { pages: Math.ceil(yeniBoy / CANTA_SAYFA_YUVASI) });
      return true;
    }

    if (tip === 'storageExpand') {
      const JID = jidOf(ws);
      if (JID === null) { hata(ws, HATA.DOGRULAMA); return true; }
      const b = bankaAl(JID, (hazir) => { bankayiYolla(ws, hazir); cuzdaniYolla(ws, hazir); });
      if (!b) { hata(ws, HATA.MESGUL, ANAHTAR.bankaMesgul); return true; }
      const sayfa = Math.max(1, Math.ceil(b.kapasite / DEPO_SAYFA_YUVASI));
      /* Depo sayfa tavani (10) - ayni anahtar. Istemcinin sayfa hesabi depoda
         `Math.max(1, Math.round(kapasite / 36))` (paket @27396219). */
      if (sayfa >= DEPO_MAX_SAYFA || b.kapasite >= DEPO_MAX_YUVA) { hata(ws, HATA.DOGRULAMA, ANAHTAR.genisMax); return true; }
      b.kapasite = Math.min(DEPO_MAX_YUVA, b.kapasite + DEPO_SAYFA_YUVASI);
      boyutla(b);
      sirala(b, () => dbKapasiteYaz(JID, b.kapasite));
      tuket(ch, yuva, st);
      envanteriYolla(ws);
      bankayiYolla(ws, b);
      bildir(ws, ANAHTAR.genisDepo, { pages: Math.ceil(b.kapasite / DEPO_SAYFA_YUVASI) });
      return true;
    }

    // carrierExpand ya da genisletme esyasi degil -> yonlendirici digerlerini denesin
    return false;
  }

  function tuket(ch, yuva, st) {
    const kalan = (st.qty ?? 1) - 1;
    ch.bag[yuva] = kalan > 0 ? { ...st, qty: kalan } : null;
  }

  // ---------------------------------------------------------------- disari
  return {
    mesaj,
    /** server.js modulleriYukle(ch) kancasi (server.js:1590) - zone.init'ten ONCE. */
    yukle,
    /** server.js auth'tan SONRA cagirmali - satin alinmis canta sayfalari. */
    cantaBoyunuGeriYukle,
    /** Diger modullerin cagirdigi API (madde 44): hesap bankasina altin ekler.
     *  Ornek: sistem_kucuk-sistemler mezat geliri / gecilen teklif iadesi. */
    bankayaAltinEkle,
    // ---- baglama/hata ayiklama icin (server.js zorunlu degil):
    girisKurulumu, yuksekYuvalariKurtar,
    bankaKaresi, cuzdanKaresi, bankaAl, BANKALAR, vsroBoyu, cantaBoyuCoz,
    _npcDurumu: npcDurumu,
    _npcYakinMi: npcYakinMi,
    _bankaNpc: BANKA_NPC,
    _sabitler: {
      DEPO_SAYFA_YUVASI, DEPO_MAX_SAYFA, CANTA_MAX_SAYFA, CANTA_SAYFA_YUVASI,
      MENZIL, VSRO_KUSAM_YUVASI,
    },
  };
}

export default { kur };

/* ===========================================================================
 * BAGLAMA NOTU
 * ---------------------------------------------------------------------------
 * ctx'den KULLANDIKLARIM:
 *   frame            - tum s2c kareleri (zorunlu)
 *   log              - hata/uyari satirlari
 *   GCFG             - bagSlots (32) ve npcInteractRangeU (25)
 *   ITEMSTATS        - esya adi/stackMax (data/items.json ile birlestiriliyor)
 *   envanterPayload  - inv.update govdesi
 *   web              - SRO_WEB_GAME mssql havuzu (null ise BELLEK modu)
 *   SHARD            - _AccountJID / _Char icin sema adi
 *   KULLANMADIKLARIM: world, combat, broadcast, zoneGroundY, yurunebilirNokta,
 *                     derived  (banka islemleri dunya/savas durumuna dokunmuyor)
 *   ctx DISINDA kendim okuyorum: data/items.json (esya `type` alani ITEMSTATS'ta
 *   yok), world.json (NPC koordinatlari - menzil kapisi), config.json
 *   (SRO_VT_ACCOUNT adi), data/npcshops.json (bank bayragi + NPC basina
 *   interactRangeU; madde 45 - eskiden ../../GERCEK/paket_veri/npcs.json,
 *   yani SUNUCU AGACININ DISI. O yol yalniz YEDEK olarak duruyor).
 *
 * ISLEDIGIM MESAJLAR (true doner):
 *   bank.depositGold, bank.withdrawGold, bank.depositItem, bank.withdrawItem,
 *   bank.moveItem, item.expand (yalniz bagExpand/storageExpand)
 *
 * FALSE DONDUKLERIM (yonlendirici digerlerini denesin):
 *   exch.open   -> banka penceresi acilinca istemci BUNU gonderiyor; ben sadece
 *                  bank.items + exch.wallet yolluyorum, isleme sahiplenmiyorum
 *                  ki ileride yazilacak BORSA modulu ayni mesaji gorebilsin.
 *                  ONEMLI: borsa modulu de exch.wallet gonderirse `gold` alanini
 *                  MUTLAKA bu modulun cuzdanKaresi(b).gold degeriyle doldursun -
 *                  istemcide banka altini ile borsa cuzdani AYNI alandir
 *                  (ui.bank.bank_gold_tip: "Hesap bankasi altini - Silk Borsasi
 *                  ile ortak"). Aksi halde iki modul birbirinin degerini ezer.
 *   exch.close  -> hic dokunmuyorum
 *   item.expand + carrierExpand -> tasiyici modulunun isi, esya tuketilmez
 *
 * GONDERDIGIM S2C KARELERI:
 *   bank.items (182), exch.wallet (177), inv.update (149), sys.notice (195),
 *   err (240)
 *
 * SERVER.JS'E BAGLAMA
 *   YONLENDIRME HAZIR: server.js'te genel modul yukleyici var - SISTEM_ADLARI
 *   dizisi 'banka-depo' iceriyor, ornekleri `sistemleriKur()` uretiyor ve
 *   yonlendirme `for (const s of SISTEMLER) if (s.ornek.mesaj(ws,t,d)) return;`
 *   ile LOOP.mesaj'dan sonra, switch'ten ONCE calisiyor. Bu modul icin
 *   server.js'e EK YONLENDIRME SATIRI GEREKMIYOR - asagidaki iki eksik disinda:
 *
 *   1) KALICILIK (web havuzu). `sistemCtx()` su an `web: null` geciyor ve
 *      `initSql()` dosyanin EN SONUNDA cagriliyor; yani modul BELLEK modunda
 *      calisir (sunucu yeniden baslayinca banka bosalir, altin kalicilasmaz).
 *      Kalicilik icin sistemCtx()'teki `web: null` yerine initSql()'in urettigi
 *      SRO_WEB_GAME havuzu verilmeli ve o havuz hazir olduktan sonra
 *      `sistemleriKur()` bir kez daha cagrilmali (zaten yeniden kurulabiliyor).
 *
 *   2) SATIN ALINMIS CANTA SAYFALARI. auth blogunun sonunda, zone.init'ten
 *      ONCE (selfPayload canta uzunlugunu oradan okuyor):
 *          await SISTEMLER.find(s => s.ad === 'banka-depo')
 *                        ?.ornek.cantaBoyunuGeriYukle(ws);
 *      Cagrilmazsa oyuncu her giriste 32 yuvaya duser.
 *
 *   SIRA ONEMLI: SISTEM_ADLARI'nda 'banka-depo' 'borsa'dan ONCE olmali.
 *   Ikisi de exch.open'da `exch.wallet` yolluyor; sonuncu kare istemcide kalir
 *   ve borsanin degeri her zaman DB'den taze okunuyor. Su anki sira dogru.
 *
 * NOT 1: _Char.InventorySize 13 KUSAM yuvasini da sayar (routes_auth equipOf:
 *        `Slot < 13`; vSRO varsayilani 45 = 13 + 32). Donusum modulun icinde
 *        (vsroBoyu / cantaBoyuCoz) - server.js ham degeri canta uzunlugu
 *        SANMAMALI.
 * NOT 2: BANKA ALTINI SISTEM_BORSA.JS ILE ORTAK SATIR.
 *        Iki modul de `<SHARD>.dbo._AccountJID.Gold` kullaniyor (istemcide de
 *        ayni alan: ui.bank.bank_gold_tip "Hesap bankasi altini - Silk Borsasi
 *        ile ortak"). Bu yuzden bu modul altini MUTLAK degil FARK ile yaziyor
 *        (`SET Gold = Gold +/- @m`) ve pencere her acildiginda otoriter degeri
 *        DB'den tazeliyor. Ileride bu yazim mutlaga cevrilirse borsanin
 *        emirleri/cekimleri sessizce EZILIR.
 * NOT 3: Karakter altini `_Char.RemainGold`'a yazilir (kardes modullerle ayni
 *        desen). Bu yazim kaldirilirsa oyuncu altini bankaya koyup cikis-giris
 *        yaparak ALTIN KOPYALAR - giriste altin RemainGold'dan geri yukleniyor.
 * NOT 4 (madde 44): `bankayaAltinEkle(JID, miktar, soketler)` DISA ACIK. Mezat
 *        geliri ve gecilen teklif iadesi bu koprunun uzerinden hesap bankasina
 *        yaziliyor (sistem_kucuk-sistemler). Modulde oyuncu defteri OLMADIGI
 *        icin acik soketleri cagiran veriyor; verilmezse yalniz DB yazilir ve
 *        oyuncu bankayi acinca (exch.open -> altiniTazele) dogru bakiyeyi gorur.
 * NOT 5 (madde 45): Depo NPC kumesi ARTIK data/npcshops.json'dan (bank:true)
 *        okunuyor - sunucu kendi veri klasoruyle kendine yetiyor. Kume BOS
 *        kalirsa kapi GEVSEMEZ, KAPANIR (ERR_NOT_FOUND). Menzil de NPC basina:
 *        interactRangeU (NPC_CH/WC_WAREHOUSE_M 22.75, KT/EU/CA 15).
 * ======================================================================== */
