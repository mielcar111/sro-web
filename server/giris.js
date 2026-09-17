/**
 * GIRIS KARELERI  -  oyuna girerken istemciye yollanan kare dizisi.
 *
 * ==========================================================================
 * GERCEGIN KAYNAKLARI (hicbir sayi uydurulmadi)
 * ==========================================================================
 *  [C] Canli WS yakalamasi : referans yakalama zone_init.json
 *      sira: hello -> auth.ok -> zone.init -> env.clock -> unique.timers
 *            -> guild.state
 *            -> batch[ pet.state, gpet.state, taction.marks, carrier.state,
 *                      quest.catalog, quest.state ]
 *  [A] Okunabilir istemci paketi : index-BUMMQVRB.js (referans istemci paketi)
 *      (satir numaralari o dosyada)
 *  [D] Sunucu verisi : server/data/game-config.json
 *
 * ==========================================================================
 * 1) `batch` GERCEK BIR ZARF, `batch.tick` GERCEK BIR MESAJ DEGIL
 * ==========================================================================
 *  Paket @623900:
 *      function xht(e){ return typeof e=='object' && !!e && e.t === `batch`; }
 *  Paket @625554 (W$.onFrame):
 *      if (xht(f)) { this.invoke(`batch.tick`, f.tick);
 *                    for (const m of f.d) this.dispatch(m); }
 *      else this.dispatch(f);
 *
 *  Yani tel uzerinde SADECE su zarf var:
 *      { t:"batch", tick:<tam sayi>, d:[ {t,d}, {t,d}, ... ] }
 *  `batch.tick` istemcinin KENDI ICINDE urettigi olaydir ve degeri bir SAYIDIR
 *  (zarfin tick alani). T$ sema tablosunda `batch.tick` KAYITLI DEGIL
 *  (196 opcode'un hicbiri o ad degil).
 *
 *  Bizim sunucu her tikte  frame(ws,'batch.tick',{tick,serverTime})  yolluyordu.
 *  Istemcide karsiligi (paket @625776):
 *      setBatchTick(e){ this.currentBatchTime = this.tickTime(e); }
 *      tickTime(e)    { return this.serverTime0 + (e - this.tick0) * tgt; }
 *  `e` bir NESNE oldugu icin  (nesne - sayi) = NaN  ->  currentBatchTime = NaN.
 *  currentBatchTime, uzaktaki varliklarin 3 birimden fazla ziplayan hareket
 *  yollarinda t0 olarak kullaniliyor (paket @625854 / @625877 / @625908), yani
 *  NaN = o varliklar icin ara deger hesabinin bozulmasi demek.
 *
 * ==========================================================================
 * 2) env.clock SEMASI  (paket @624412)
 * ==========================================================================
 *      T$(`env.clock`, 205, X({
 *        serverTime: Y(),
 *        time:       Y().min(0).max(1),
 *        moonPhase:  Y().int().min(0).max(29),
 *        rate:       Y().min(0)
 *      }))
 *  Bizim gonderdigimiz {serverTime, dayPct} SEMAYA UYMUYOR: `dayPct` metni
 *  27 MB'lik pakette 0 kez geciyor, `time`/`moonPhase`/`rate` ise ZORUNLU.
 *
 *  `rate`in anlami (paket @149321):
 *      function c9e(s, dtMs) {
 *        const g = s.time + dtMs/1e3 * s.rate, k = Math.floor(g);
 *        return { time: g - k, moonPhase: ((s.moonPhase + k) % 30 + 30) % 30 };
 *      }
 *  -> rate = SANIYEDE gecen oyun-gunu kesri. time her 1'i astiginda ay evresi
 *     1 artar, 30'da bir basa doner.
 *
 *  Canli deger [C]: rate = 0.0005000000237487257 = Math.fround(0.0005)
 *  (bire bir dogrulandi). Yani 1 oyun gunu = 1/0.0005 = 2000 saniye = 33 dk 20 sn.
 *
 *  Istemci anahtari BIR KEZ alir (uyt.setAnchor, paket @628691) ve dongusunu
 *  kendisi ilerletir; bu yuzden girişte tek env.clock yeter.
 *
 * ==========================================================================
 * 3) `zone.ready` ISTEMCIDEN HIC GELMEZ
 * ==========================================================================
 *  `zone.ready` metni pakette TAM 1 KEZ geciyor: sema tablosu
 *      T$(`zone.ready`, 81, X({}), `misc`)      @624050
 *  `send(\`zone.ready\`)` cagrisi SIFIR adet. Yani env.clock'u ve modullerin
 *  giris kurulumunu zone.ready'ye baglamak = HIC CALISMAMASI demekti.
 *  Cozum: mesaji SUNUCU kendisi uretir (sentetik zone.ready), boylece o mesaja
 *  bagli yazilmis butun sistem modulleri (gorev, donus-isinlanma,
 *  kucuk-sistemler) hicbir degisiklik gerekmeden calisir.
 *
 * ==========================================================================
 * 4) zone.init SONRASI ISTEMCI EVCIL DURUMUNU SIFIRLAR
 * ==========================================================================
 *  zone.init isleyicisi (paket @654475) sunlari cagiriyor:
 *      E8.getState().clearServerState()   // pet
 *      y8.getState().clearServerState()   // growth pet
 *  Bu yuzden pet.state / gpet.state zone.init'ten SONRA tekrar yollanmak
 *  ZORUNDA - canli yakalamada tam da batch icinde geliyorlar.
 */

/* -------------------------------------------------------------- sabitler */

/** Saniyede gecen oyun-gunu kesri.  Kaynak [C] env.clock.rate. */
export const GUN_HIZI = Math.fround(0.0005);

/** Ay evresi sayaci - istemci semasi moonPhase 0..29, c9e icinde %30. */
export const AY_EVRE_SAYISI = 30;

/** Girise ozgu tekil kareler: canli yakalamadaki SIRA (batch'ten ONCE). */
export const TEKIL_SIRA = ['env.clock', 'unique.timers', 'guild.state'];

/** batch icindeki SIRA - canli yakalamadaki dizilim [C]. */
export const BATCH_SIRA = [
  'pet.state', 'gpet.state', 'taction.marks',
  'carrier.state', 'quest.catalog', 'quest.state',
];

/**
 * ASENKRON soz veren moduller: modul YUKLUYSE cekirdek varsayilani EKLEMEZ,
 * cunku karesi bir mikro-gorev/DB turundan sonra kesin geliyor.
 * (Senkron yollayan moduller icin bu tabloya gerek yok - kareleri zaten
 *  tamponda goruluyor ve varsayilan kendiliginden atlaniyor.)
 *
 *   quest.catalog / quest.state -> sistem_gorev.js girisKurulumu() sonu:
 *       katalogGonder(ws); durumGonder(ws);        (try/catch ile korumali)
 *
 *   taction.marks -> sistem_donus-isinlanma.js girisKurulumu():
 *       isaretYukle(ch.id).then(() => isaretGonder(ws))
 *     DENETIM BULGUSU: bu satir eksikti ve kare IKI KEZ gidiyordu - once
 *     cekirdegin notr `{}` varsayilani (batch icinde), hemen ardindan modulun
 *     gercek isaretleri. Istemci isleyicisi (paket @25646481):
 *         N$.apply = m => set({ death: m.death ?? null, ret: m.ret ?? null })
 *     yani `{}` karesi ISARETLERI SILIYOR; sirasiyla once siliniyor sonra geri
 *     yaziliyordu (gorunur bir kirpisma + bosuna kare). Varsayilani atlamak
 *     GUVENLI: N$ zaten {death:null, ret:null} ile basliyor, yani modul bir
 *     sebeple hic yollamazsa da istemci ayni durumda kalir.
 */
export const SOZ_VEREN = {
  'quest.catalog': 'gorev',
  'quest.state': 'gorev',
  'taction.marks': 'donus-isinlanma',
};

/**
 * zone.ready'yi KENDI `mesaj` dallarinda isleyen moduller. Bunlara AYRICA
 * dogrudan kanca cagrisi YAPILMAZ - yoksa giris kurulumu iki kez calisir.
 * (Kaynak: ilgili dosyalarin `if (t === 'zone.ready')` dallari.)
 */
export const ZONE_READY_DINLEYEN = new Set(['gorev', 'donus-isinlanma', 'kucuk-sistemler']);

/**
 * zone.ready'ye BAGLI OLMAYAN giris kancalari. Ad -> metot.
 * Her biri ilgili sistem_*.js dosyasi okunarak dogrulandi:
 *   sistem_binek-pet.js  girdi(ws)        -> mount.update + pet.state (+gpet.state)
 *   sistem_parti.js      girisSonrasi(ws) -> party.update (parti varsa)
 *   sistem_lonca.js      girisTamam(ws)   -> guild.state
 */
export const KANCA = {
  'binek-pet': 'girdi',
  'parti': 'girisSonrasi',
  'lonca': 'girisTamam',
};

/* ------------------------------------------------------------ gun/gece */

/**
 * serverTime'dan gun kesrini ve ay evresini turetir.
 *
 * ANKRAJ NOTU (uydurma degil, acik tercih): referans oyunun gun dongusu icin
 * kullandigi baslangic ani yakalamadan GERI GETIRILEMIYOR - tek ornek nokta
 * (time 0.2544923, moonPhase 9, serverTime 1787493108022) hicbir dogal
 * ankrajla (epoch, gun basi, ...) tutmuyor. Bu yuzden BIZ Unix epoch'u ankraj
 * aliyoruz: yeniden baslatmadan etkilenmez, oyuncular arasi tutarlidir ve
 * ilerleyisi [C]'den alinan GERCEK `rate` belirler.
 */
export function gunDurumu(serverTime = Date.now(), rate = GUN_HIZI) {
  const gun = (Number(serverTime) / 1000) * rate;     // gecen oyun-gunu sayisi
  const tam = Math.floor(gun);
  return {
    time: gun - tam,
    moonPhase: ((tam % AY_EVRE_SAYISI) + AY_EVRE_SAYISI) % AY_EVRE_SAYISI,
  };
}

/** env.clock payload'i - sema [A] @624412 ile birebir. */
export function envClockKare(serverTime = Date.now(), rate = GUN_HIZI) {
  const g = gunDurumu(serverTime, rate);
  return { serverTime, time: g.time, moonPhase: g.moonPhase, rate };
}

/* --------------------------------------------------------- batch zarfi */

/**
 * Gercek batch zarfi. `tick` ZORUNLU ve TAM SAYI: istemci onu dogrudan
 * setBatchTick'e veriyor (bkz. dosya basi, madde 1).
 */
export function batchZarfi(tick, kareler) {
  return { t: 'batch', tick: Math.trunc(Number(tick) || 0), d: kareler ?? [] };
}

/* ------------------------------------------------------- varsayilanlar */

/**
 * Bir modulun uretmedigi girise ozgu karelerin NOTR degerleri.
 * Hepsi canli yakalamadaki [C] degerlerdir; tek turetilen alan
 * carrier.state.slotsMax = game-config.json carrier.baseSlots (=12) [D],
 * ki canli yakalamadaki 12 ile ayni.
 */
export function varsayilanKare(ad, ctx = {}) {
  const serverTime = ctx.serverTime ?? Date.now();
  switch (ad) {
    case 'env.clock':
      return envClockKare(serverTime, ctx.rate ?? GUN_HIZI);

    /* Unique sayaclarini sistem_kucuk-sistemler.js uretir. O modul yuklu
       degilken TIMER UYDURMAYIZ: sema-gecerli BOS liste yollariz, boylece
       istemcinin unique tahtasi tanimsiz kalmaz. */
    case 'unique.timers':
      return { serverTime, uniques: [] };

    /* Lonca yoksa bile gonderilir - canli yakalamada tam olarak {guild:null}. */
    case 'guild.state':
      return { guild: null };

    /* [C] pet.state varsayilan ayarlari. */
    case 'pet.state':
      return {
        active: false,
        settings: { grab: true, scope: 'own', gold: true, equipment: true, other: true },
      };

    case 'gpet.state':
      return { active: false };

    /* Bos bile olsa gonderilmeli - [C] "taction.marks": {} */
    case 'taction.marks':
      return {};

    case 'carrier.state':
      return {
        phase: 'idle',
        slots: [],
        slotsMax: Math.trunc(Number(ctx.carrierSlotsMax) || 12),
        readyAt: 0,
      };

    case 'quest.catalog':
      return { available: [] };

    case 'quest.state':
      return { mine: [] };

    default:
      return null;
  }
}

/* ------------------------------------------------------------- akis */

/**
 * Giris kare akisini kurar ve YOLLAR.
 *
 * Calisma sekli:
 *   1) ws uzerinde bir TAMPON acilir (ws._toplu). Tampon acikken server.js'in
 *      frame() fonksiyonu kareyi tele yazmak yerine tampona koyar.
 *   2) Sentetik `zone.ready` dagiticidan gecirilir -> zone.ready'ye bagli
 *      yazilmis butun moduller giris kurulumunu yapar.
 *   3) zone.ready'ye BAGLI OLMAYAN moduller icin KANCA tablosundaki metot
 *      cagrilir.
 *   4) Tampon kapatilir. Toplanan kareler ikiye ayrilir:
 *        - TEKIL_SIRA'daki adlar tek tek yollanir (canli sira),
 *        - kalanlar tek bir `batch` zarfinda gider.
 *   5) Hicbir modulun uretmedigi zorunlu kareler icin NOTR varsayilan eklenir.
 *
 * @param {object} ws                 oyuncu soketi (isAuthed + char dolu)
 * @param {object} o
 * @param {(ws,t,d)=>void} o.gonder   tek kare yollayici (server.js frame)
 * @param {(ws,s)=>void}   o.ham      ham JSON yollayici (batch zarfi icin)
 * @param {(ws,t,d)=>void} o.dagit    sentetik mesaji dagiticiya sokan fonksiyon
 * @param {Array}  o.sistemler        [{ad, ornek}]
 * @param {number} o.tick             o anki sunucu tiki (zone.init ile AYNI sayac)
 * @param {number} o.serverTime
 * @param {number} o.carrierSlotsMax
 * @param {Function} [o.log]
 * @returns {{tekil:string[], toplu:string[]}} tani icin yollanan kare adlari
 */
export function girisAkisi(ws, o) {
  const log = o.log ?? (() => {});
  const yuklu = new Set((o.sistemler ?? []).map(s => s.ad));

  /* 1) tampon ac */
  let toplanan = [];
  ws._toplu = [];

  try {
    /* 2) sentetik zone.ready - istemci bunu ASLA gondermiyor (madde 3) */
    try { o.dagit?.(ws, 'zone.ready', {}); }
    catch (e) { log('giris: zone.ready dagitimi hatasi:', String(e?.message ?? e).slice(0, 140)); }

    /* 3) zone.ready'ye bagli olmayan kancalar */
    for (const s of o.sistemler ?? []) {
      if (ZONE_READY_DINLEYEN.has(s.ad)) continue;
      const metot = KANCA[s.ad];
      if (!metot || typeof s.ornek?.[metot] !== 'function') continue;
      try { s.ornek[metot](ws); }
      catch (e) { log(`giris: sistem_${s.ad}.${metot} hatasi:`, String(e?.message ?? e).slice(0, 140)); }
    }
  } finally {
    /* 4) tamponu HER DURUMDA kapat - istisna kare kaybettirmesin */
    toplanan = ws._toplu ?? [];
    ws._toplu = null;
  }

  const gelenler = new Set(toplanan.map(k => k.t));

  /* 5) eksik zorunlu kareler icin varsayilan */
  const eksikler = [];
  for (const ad of [...TEKIL_SIRA, ...BATCH_SIRA]) {
    if (gelenler.has(ad)) continue;
    const sahip = SOZ_VEREN[ad];
    if (sahip && yuklu.has(sahip)) continue;     // modul asenkron yollayacak
    const d = varsayilanKare(ad, o);
    if (d !== null) eksikler.push({ t: ad, d });
  }
  const hepsi = [...toplanan, ...eksikler];

  /* tekil / toplu ayrimi + canli SIRA */
  const tekil = [];
  const toplu = [];
  for (const ad of TEKIL_SIRA) for (const k of hepsi) if (k.t === ad) tekil.push(k);
  for (const ad of BATCH_SIRA) for (const k of hepsi) if (k.t === ad) toplu.push(k);
  /* siralamada adi gecmeyen ekstralar (mount.update, party.update, ...) sona */
  for (const k of hepsi) {
    if (TEKIL_SIRA.includes(k.t) || BATCH_SIRA.includes(k.t)) continue;
    toplu.push(k);
  }

  for (const k of tekil) o.gonder(ws, k.t, k.d);
  if (toplu.length) o.ham(ws, JSON.stringify(batchZarfi(o.tick, toplu)));

  return { tekil: tekil.map(k => k.t), toplu: toplu.map(k => k.t) };
}
