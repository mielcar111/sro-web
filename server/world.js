/**
 * Dunya motoru: varliklar, canavar dogurma, ilgi alani (interest) ve tik dongusu.
 *
 * TASARIM
 *  - Her bolge (zone) kendi varlik havuzunu tutar.
 *  - Oyuncular yalnizca YAKINDAKI varliklari gorur (state.delta ile eklenir/cikarilir).
 *    Istemci zone.init'te tum bolgeyi degil, gorus alanini bekler; 2000 canavari
 *    birden gondermek hem agi hem istemciyi bogar.
 *  - Canavarlar spawns.json'dan (Tab_RefNest -> dunya koordinati) yuklenir,
 *    istatistikleri referans oyunun kendi mob katalogundan (mobs.json) gelir.
 *  - Yuvalar TEMBEL acilir: bir yuva ancak bir oyuncu yaklastiginda doldurulur,
 *    uzaklasinca bosaltilir (bkz. "TEMBEL DOGUS" blogu).
 *
 * Hicbir sayi uydurulmaz: mob istatistikleri, drop tablolari ve savas sabitleri
 * dosyadan okunur. Dosya yoksa o sistem sessizce devre disi kalir ve neden
 * kapali oldugu loglanir.
 */
import fs from 'node:fs';
import path from 'node:path';

/** Oyuncular 1..499999, NPC'ler 500000.., canavarlar 1000000.. */
const MOB_ID_BASE = 1_000_000;
const GORUS_MESAFESI = 120;      // birim - bu mesafedeki varliklar gonderilir
const GORUS_BIRAKMA = 150;       // histerezis: bu mesafeyi gecince cikarilir

/* ------------------------------------------------------------------ */
/*  TEMBEL DOGUS (yuva acma/kapama) - madde 64
 *
 *  referans oyunda yuvalarin ustunde bir HIVE katmani var; paket semasi
 *  (index-BUMMQVRB.js @8718398-8719050) su alanlari tanimliyor:
 *     vst = { sourceHiveId, keepCountType, overwriteMaxTotalCount,
 *             monsterCountPerPC, spawnSpeedIncreaseRate, maxIncreaseRate }
 *     ayar blogu = { hiveTargetFormula:'capacity_v1', footprintRingCells,
 *             densityMultiplier, maxSpawnsPerHivePerTick, zoneMonsterBudget,
 *             respawnDelayDecoder:'uniform_seeded_v1', placementRetryMs }
 *  DIKKAT: paket bu alanlarin yalnizca SEMASINI tasiyor, DEGERLERINI degil
 *  (grep: zoneMonsterBudget @8718923, maxSpawnsPerHivePerTick @8718874 -
 *  her ikisi de yalnizca sema tanimi icinde geciyor, veri yok). Bu yuzden
 *  monsterCountPerPC / densityMultiplier / zoneMonsterBudget SAYILARI
 *  UYDURULMADI; bunlarin yerine ayni iki ucu coz -n davranissal karsilik
 *  uygulandi: yuva ancak bir oyuncu yaklasinca dolar, uzaklasinca bosalir.
 *  Boylece "27.748 canavar bolge acilisinda tek seferde uretiliyor" sorunu
 *  ve "bolge bosalsa da bellekte kaliyor" sorunu ortadan kalkar; canli
 *  varlik sayisi dogal olarak oyuncularin bulundugu yerle sinirlanir.
 *
 *  Yaricaplar UYDURMA DEGIL, bu dosyadaki ilgi alani sabitlerinden turetildi:
 *    acma  = GORUS_BIRAKMA + R      (R = yuvanin en genis yaricapi)
 *    kapama= 2*GORUS_BIRAKMA + R    (histerezis: acmanin disinda kalan bant)
 *    tarama adimi = GORUS_BIRAKMA - GORUS_MESAFESI = 30 birim
 *  Dogruluk kaniti: bir canavar en fazla R birim yuva merkezinden uzaklasir,
 *  gorunurluk sinirimiz GORUS_MESAFESI. Yuva 150+R'de aciliyorsa ve oyuncu
 *  her 30 birimde bir yeniden tarama yapiyorsa, en kotu durumda bile yuva
 *  merkezine olan mesafe 120+R'nin altina inmeden yuva acilmis olur; yani
 *  "gorus alanina girdigi halde henuz uretilmemis canavar" olusamaz.        */
const YUVA_TARAMA_ADIM_U = GORUS_BIRAKMA - GORUS_MESAFESI;   // 30
const YUVA_IZGARA_U = GORUS_BIRAKMA * 2;                     // 300 - yuva izgarasi hucre boyu
/* ------------------------------------------------------------------ */

/* Dogus noktasi icin nav deneme sayisi. Paketteki karsiligi `placementRetryMs`
   (@8719014) bir SURE, adet degil - adet paketten okunamiyor. Bu yuzden bu
   dosyadaki degil, ayni projedeki gezinme.js'in kendi nav deneme sayisi
   (gezinme.js `const DENEME = 4`) ile AYNI tutuldu; yeni bir sabit
   uydurulmadi. */
const YERLESIM_DENEME = 4;

/* Ceset suresi icin varsayilan. Gercek deger data/game-config.json
   corpseDespawnMs = 6000 (paket @8649659); bu sabit yalnizca dosya
   okunamazsa devreye girer. */
const CESET_MS_VARSAYILAN = 6000;

/* Respawn gecikmesi verisi olmayan yuva icin varsayilan pencere.
   KAYNAK: data/spawns.json > respawnDelaySec dagilimi - 7350 yuvanin
   2374'u (%32.3) tam olarak [8,12] sn, yani modal deger bu. Eski kod
   30 sn kullaniyordu; olcumde 30 sn'yi kapsayan yuva yalnizca 287 (%3.9). */
const RESPAWN_VARSAYILAN_MIN_MS = 8000;
const RESPAWN_VARSAYILAN_MAX_MS = 12_000;

/* MADDE 22 TEMIZLIGI (capraz istek 26): ESKI_SABIT_GECIKME_MS (30_000)
   sabiti ve olumKaydet'teki karsilastirmasi SILINDI - uc cagiran da
   (gameloop.js #olum, sistem_beceri.js, sistem_binek-pet.js) artik argumani
   hic vermiyor; gecikme yuvanin kendi respawnDelaySec penceresinden gelir. */

export class World {
  /**
   * @param {object} o
   * @param {string} o.dataDir      server/data
   * @param {object} o.zones        zones.json (bolge meta)
   * @param {object} o.worldData    world.json (NPC/spawn/teleport)
   * @param {(zoneId:string,x:number,z:number,oncekiY?:number)=>number} o.groundY
   *        oncekiY KAT secer (kopru alti/ustu) - gecmezsen alt kata dusersin.
   * @param {(zoneId:string,x0:number,z0:number,x1:number,z1:number,baslangicY?:number)
   *          =>{x:number,z:number}} [o.yurunebilir]
   *        server.js yurunebilirNokta - nav.bin'e karsi dogrulanmis nokta doner.
   *        VERILMEZSE dogus eski (nav'siz) davranisa duser.
   * @param {object} [o.gcfg]       calisan game-config (GM degisiklikleri uygulanmis)
   * @param {(...a:any)=>void} o.log
   */
  constructor({ dataDir, zones, worldData, groundY, yurunebilir, gcfg, log, sistemOrnegi = null }) {
    /* MADDE 62 (capraz istek 35): canavar varlik yukune `statuses` alanini
       ekleyebilmek icin sistem_beceri.js'in durumlariniAl kancasina erisim.
       Verilmezse (testlerin sahte dunyasi) alan hic eklenmez. */
    this.sistemOrnegi = typeof sistemOrnegi === 'function' ? sistemOrnegi : null;
    this.dataDir = dataDir;
    this.zones = zones;
    this.worldData = worldData;
    this.groundY = groundY;
    /* madde 49 - dogus/respawn noktasi nav.bin'e sorulur. server.js
       `yurunebilirNokta`yi zaten Gezinme'ye veriyor; imzasi 1. dalgada
       degisebilecegi icin BURADA VARSAYILMIYOR: sadece {x,z} donduren bir
       fonksiyon olarak kullaniliyor (gezinme.js:146 ile ayni kullanim). */
    this.yurunebilir = typeof yurunebilir === 'function' ? yurunebilir : null;
    this.log = log ?? (() => {});

    this.mobDefs = new Map();      // mobId -> tanim
    this.dropTables = new Map();
    this.variants = null;
    this.spawnPoints = new Map();  // zoneId -> [{code,modelKey,x,z,y,level,maxHp,count,radius}]
    this.zoneState = new Map();    // zoneId -> {entities:Map, players:Set, olu:[], ceset:[], acik:Map}
    this.nextMobId = MOB_ID_BASE;

    this.#veriYukle();
    /* Ceset suresi CALISMA ANINDA okunur (GM paneli GCFG nesnesini yerinde
       gunceller), bu yuzden referans saklaniyor - kopya degil. */
    this.gcfg = gcfg ?? this.#oku('game-config.json') ?? {};
  }

  /** Nav fonksiyonunu sonradan baglamak icin (server.js kurulum sirasi). */
  yurunebilirBagla(fn) {
    if (typeof fn === 'function') this.yurunebilir = fn;
  }

  // ------------------------------------------------------------- veri
  #oku(ad) {
    const p = path.join(this.dataDir, ad);
    if (!fs.existsSync(p)) return null;
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (e) {
      this.log(`veri okunamadi ${ad}: ${e.message.slice(0, 100)}`);
      return null;
    }
  }

  #veriYukle() {
    const mobs = this.#oku('mobs.json');
    if (mobs?.mobs?.length) {
      for (const m of mobs.mobs) this.mobDefs.set(m.id, m);
      this.log(`mob katalogu: ${this.mobDefs.size} tur`);
    } else {
      this.log('mobs.json yok - canavar istatistikleri kullanilamiyor');
    }

    const drops = this.#oku('drops.json');
    if (drops?.dropTables) {
      for (const [k, v] of Object.entries(drops.dropTables)) this.dropTables.set(k, v);
      this.variants = drops.monsterVariants ?? null;
      this.log(`drop tablosu: ${this.dropTables.size}`);
    }

    const spawns = this.#oku('spawns.json');
    if (spawns) {
      let toplam = 0;
      for (const [zid, list] of Object.entries(spawns)) {
        this.spawnPoints.set(zid, list);
        toplam += list.length;
      }
      this.log(`spawn noktasi: ${toplam} (${this.spawnPoints.size} bolge)`);
    } else {
      this.log('spawns.json yok - canavar dogmayacak');
    }
  }

  /** GM panelinin degistirebildigi ceset suresi (data/game-config.json). */
  #cesetSuresiMs() {
    const v = Number(this.gcfg?.corpseDespawnMs);
    return Number.isFinite(v) && v >= 0 ? v : CESET_MS_VARSAYILAN;
  }

  // ------------------------------------------------------------- bolge
  #bolge(zoneId) {
    let z = this.zoneState.get(zoneId);
    if (!z) {
      z = {
        entities: new Map(),
        players: new Set(),
        olu: [],
        /* madde 47 - ceset kuyrugu: {id, at}. Suresi dolan ceset ilgi
           alanindan CIKARILIR (oyuncunun yurumesine bagli kalmadan). */
        ceset: [],
        /* TEMBEL DOGUS defteri: yuva indeksi -> uretilen varlik id'leri */
        acik: new Map(),
        yuvalar: null, izgara: null, yuvaMaxR: 0,
      };
      this.zoneState.set(zoneId, z);
      /* ESKIDEN BURADA #bolgeyiDoldur vardi: ilk oyuncu girer girmez o
         bolgenin TUM yuvalari (samarkand 2.944 yuva -> 7.488 varlik) tek
         dongude uretiliyordu. Artik yuvalar oyuncu yaklastikca aciliyor
         (#yuvalariGuncelle). */
    }
    return z;
  }

  // ------------------------------------------------- TEMBEL DOGUS: yuva izgarasi
  #hucreAnahtari(x, z) {
    return `${Math.floor(x / YUVA_IZGARA_U)}|${Math.floor(z / YUVA_IZGARA_U)}`;
  }

  /**
   * Bolgenin yuva izgarasini (kez) kurar. spawnPoints listesi degistiyse
   * (sistem_dirilis-unique.js unique yuvalarini CIKARIYOR: `sp.set(zid, kalan)`)
   * indeksler kayacagi icin acik yuvalar bosaltilip izgara yeniden kurulur.
   */
  #izgaraHazirla(zoneId, z) {
    const liste = this.spawnPoints.get(zoneId) ?? [];
    if (z.izgara && z.yuvalar === liste) return z.izgara;
    if (z.acik.size) for (const ix of [...z.acik.keys()]) this.#yuvaKapat(z, ix);
    // izgara yeniden kuruldu: her oyuncunun tarama esigi sifirlansin ki
    // yeni indekslerle yuvalar HEMEN acilabilsin
    for (const p of z.players) p.sonYuvaTarama = null;
    z.yuvalar = liste;
    z.izgara = new Map();
    z.yuvaMaxR = 0;
    for (let i = 0; i < liste.length; i++) {
      const sp = liste[i];
      if (!sp) continue;
      const R = Math.max(sp.radius ?? 0, sp.spawnRadius ?? 0);
      if (R > z.yuvaMaxR) z.yuvaMaxR = R;
      const k = this.#hucreAnahtari(sp.x, sp.z);
      let kova = z.izgara.get(k);
      if (!kova) z.izgara.set(k, (kova = []));
      kova.push(i);
    }
    return z.izgara;
  }

  /**
   * Oyuncunun cevresindeki kapali yuvalari acar.
   * Tarama, oyuncu YUVA_TARAMA_ADIM_U'dan fazla yer degistirmedikce
   * tekrarlanmaz (samarkand'da 2.944 yuvayi her tikte dolasmamak icin).
   */
  #yuvalariGuncelle(zoneId, z, ws) {
    const ch = ws?.char;
    if (!ch) return;
    const izgara = this.#izgaraHazirla(zoneId, z);
    if (!izgara.size) return;

    const son = ws.sonYuvaTarama;
    if (son) {
      const dx = ch.x - son.x, dz = ch.z - son.z;
      if (dx * dx + dz * dz < YUVA_TARAMA_ADIM_U ** 2) return;
    }
    ws.sonYuvaTarama = { x: ch.x, z: ch.z };

    const menzil = GORUS_BIRAKMA + z.yuvaMaxR;
    const cx0 = Math.floor((ch.x - menzil) / YUVA_IZGARA_U);
    const cx1 = Math.floor((ch.x + menzil) / YUVA_IZGARA_U);
    const cz0 = Math.floor((ch.z - menzil) / YUVA_IZGARA_U);
    const cz1 = Math.floor((ch.z + menzil) / YUVA_IZGARA_U);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) {
        const kova = izgara.get(`${cx}|${cz}`);
        if (!kova) continue;
        for (const ix of kova) {
          if (z.acik.has(ix)) continue;
          const sp = z.yuvalar[ix];
          if (!sp) continue;
          const R = Math.max(sp.radius ?? 0, sp.spawnRadius ?? 0);
          const dx = sp.x - ch.x, dz = sp.z - ch.z;
          if (dx * dx + dz * dz <= (GORUS_BIRAKMA + R) ** 2) this.#yuvaAc(zoneId, z, ix);
        }
      }
    }
  }

  /** Bir yuvayi doldurur: kapasitesi kadar canavar uretir. */
  #yuvaAc(zoneId, z, ix) {
    const sp = z.yuvalar?.[ix];
    if (!sp) return;
    /* KAPASITE KIRPMASI KALDIRILDI (madde 41).
       Eski hal: `Math.min(sp.count ?? 1, 6)` - hem burada hem gen_spawns.mjs'te.
       Paket yuva semasi (@8718150) `capacity: Y().int().min(1)` diyor, UST SINIR
       YOK. Canli olcum (Tab_RefNest.dwMaxTotalCount, btType=0, 15.233 satir):
       ham toplam 32.523 -> kirpilmis 27.748, yani %14.7 canavar hic dogmuyordu
       (jangan 7.156 -> 4.695 = -%34.4). En buyuk yuva 20 canavar. */
    const adet = Math.max(1, Math.floor(sp.count ?? 1));
    const idler = [];
    for (let i = 0; i < adet; i++) {
      const e = this.#canavarUret(zoneId, sp, ix);
      if (e) { z.entities.set(e.id, e); idler.push(e.id); }
    }
    z.acik.set(ix, idler);
  }

  /**
   * Bir yuvayi bosaltir. Cagiran, guvenlik kontrolunu yapmis olmalidir
   * (bkz. #yuvaBakimi) ya da bolge bos olmalidir.
   */
  #yuvaKapat(z, ix) {
    const idler = z.acik.get(ix);
    z.acik.delete(ix);
    if (!idler?.length) return;
    const kume = new Set(idler);
    for (const id of idler) z.entities.delete(id);
    // olum/ceset kuyruklarinda artik var olmayan id kalmasin
    if (z.olu.length) z.olu = z.olu.filter((o) => !kume.has(o.id));
    if (z.ceset.length) z.ceset = z.ceset.filter((c) => !kume.has(c.id));
    /* HAYALET KORUMASI: varlik artik z.entities'te olmadigi icin
       ilgiGuncelle onu bir daha dolasip `rem` URETEMEZ (dongu entities
       uzerinde). Hala bir oyuncunun ilgi kumesindeyse (bolge listesi
       degistigi icin zorunlu kapatma gibi durumlar) ceset kuyruguna
       SURESI DOLMUS olarak eklenir; cesetTik hem `gorunen`den siler hem
       rem yayinlatir. Normal kapatmada bu dongu hicbir sey eklemez -
       #yuvaBakimi zaten gorunen kumesindeki yuvayi kapatmiyor. */
    if (!z.players.size) return;
    for (const id of idler) {
      for (const p of z.players) {
        if (p.gorunen?.has(id)) { z.ceset.push({ id, at: 0 }); break; }
      }
    }
  }

  /**
   * Her tik calisir (respawnTik uzerinden): yaklasilan yuvalari acar,
   * uzaklasilan yuvalari bosaltir.
   *
   * ACMA burada da yapiliyor (ilgiGuncelle'ye ek olarak) cunku ilgiGuncelle
   * gameloop'ta YALNIZ YURUYEN oyuncu icin cagriliyor; ayni bolge icindeki
   * isinlanmadan (bolge.js entity.teleport dali) sonra duran oyuncunun
   * cevresi bos kalirdi. Tarama YUVA_TARAMA_ADIM_U esigine takili oldugu
   * icin kipirdamayan oyuncuda maliyeti sifirdir.
   *
   * KAPATMA icin bir yuvanin SU UC KOSULU da saglamasi gerekir:
   *   - hicbir oyuncu 2*GORUS_BIRAKMA + R icinde degil,
   *   - yuvanin hicbir canavari olu/respawn bekler durumda degil
   *     (yoksa "uzaklasip donunce hepsi diri" istismari olusur),
   *   - yuvanin hicbir canavari bir oyuncunun ilgi kumesinde ya da
   *     bir hedefi kovalar durumda degil.
   */
  #yuvaBakimi(zoneId, z) {
    if (!z.players.size) {
      if (z.acik.size) for (const ix of [...z.acik.keys()]) this.#yuvaKapat(z, ix);
      return;
    }
    for (const ws of z.players) this.#yuvalariGuncelle(zoneId, z, ws);
    if (!z.acik.size) return;

    const oyuncular = [];
    for (const p of z.players) if (p.char) oyuncular.push(p.char);
    if (!oyuncular.length) return;

    const gorunenler = new Set();
    for (const p of z.players) if (p.gorunen) for (const id of p.gorunen) gorunenler.add(id);

    for (const ix of [...z.acik.keys()]) {
      const sp = z.yuvalar?.[ix];
      if (!sp) { this.#yuvaKapat(z, ix); continue; }
      const R = Math.max(sp.radius ?? 0, sp.spawnRadius ?? 0);
      const kapa2 = (GORUS_BIRAKMA * 2 + R) ** 2;
      let yakin = false;
      for (const ch of oyuncular) {
        const dx = sp.x - ch.x, dz = sp.z - ch.z;
        if (dx * dx + dz * dz <= kapa2) { yakin = true; break; }
      }
      if (yakin) continue;

      let guvenli = true;
      for (const id of z.acik.get(ix) ?? []) {
        if (gorunenler.has(id)) { guvenli = false; break; }
        const e = z.entities.get(id);
        if (!e) continue;
        if (e.dead || e.hedefEntityId != null) { guvenli = false; break; }
      }
      if (guvenli) this.#yuvaKapat(z, ix);
    }
  }

  // ------------------------------------------------- dogus (varyant + yerlesim)
  /**
   * Yuva diski uzerinde YURUNEBILIR bir dogus noktasi secer (madde 49).
   * nav fonksiyonu yoksa eski davranisa (sadece rastgele nokta) duser.
   * @returns {{x:number,z:number}}
   */
  #dogusNoktasi(zoneId, merkezX, merkezZ, yaricap) {
    const nokta = () => {
      const aci = Math.random() * Math.PI * 2;
      // sqrt -> disk uzerinde ALANCA duzgun dagilim (dogrusal olan merkeze yigar)
      const m = Math.sqrt(Math.random()) * yaricap;
      return { x: merkezX + Math.cos(aci) * m, z: merkezZ + Math.sin(aci) * m };
    };
    if (!this.yurunebilir || !(yaricap > 0)) return nokta();

    let sonuncu = null;
    for (let d = 0; d < YERLESIM_DENEME; d++) {
      const h = nokta();
      let yol = null;
      try {
        /* gezinme.js:146 ile AYNI kullanim: merkezden hedefe yuru, nav'in
           izin verdigi son nokta don. Imza 1. dalgada degisebilecegi icin
           yalnizca {x,z} bekleniyor; `engellendi` gibi ek alanlar
           VARSAYILMIYOR. */
        yol = this.yurunebilir(zoneId, merkezX, merkezZ, h.x, h.z);
      } catch { yol = null; }
      if (!yol || !Number.isFinite(yol.x) || !Number.isFinite(yol.z)) return h;
      sonuncu = { x: yol.x, z: yol.z };
      // nav hedefin en az yarisina izin verdiyse kabul; yoksa baska aci dene
      const istenen = Math.hypot(h.x - merkezX, h.z - merkezZ);
      const olan = Math.hypot(yol.x - merkezX, yol.z - merkezZ);
      if (istenen <= 0.01 || olan >= istenen * 0.5) return sonuncu;
    }
    /* Hepsi kapaliysa nav'in verdigi son (yurunebilir) nokta kullanilir;
       hic sonuc yoksa yuva merkezi. */
    return sonuncu ?? { x: merkezX, z: merkezZ };
  }

  /**
   * Sampiyon / Dev zarini atar (madde 21 + 71).
   *
   * KAYNAK: data/drops.json > monsterVariants  (paket config/monster-variants.json,
   * sema @8686838-8686902: chance/hpMult/dmgMult/xpMult/spExpMult/lootRolls/
   * scaleMult/namePrefix). $comment: "applied per spawn (giant checked first,
   * then champion; a monster def opts in via its `variants` flags)".
   * Sampiyon sansi yuva basina EZILIR: data/spawns.json[].championPct
   * (paket yuva semasi @8718150 `championPct: Y().min(0).max(100)`;
   * $perNestOverride: "the global champion.chance is the LEGACY-zone fallback only").
   *
   * ISIM ONEKI (namePrefix) UYGULANMIYOR: istemci hedef cercevesinde etiketi
   * `rarity`den kendi seciyor (paket @27625500: {general|champion|giant|unique}
   * -> ui.target.rarity_*), namePrefix ise paketin canavar tarafinda hicbir
   * yerde okunmuyor (yalnizca toplama dugumu dereceleri @9305169 kullaniyor).
   * Isme de onek eklersek "Champion Mangyang" + "Şampiyon" cift gorunurdu.
   *
   * HER DOGUSTA yeniden atilir; carpanlarin ust uste binmemesi icin taban HP
   * `e.tabanMaxHp` alaninda ayri tutulur.
   */
  #nadirlikAt(e, def) {
    const taban = (e.tabanMaxHp ??= e.maxHp);
    /* BILINCLI SAPMA altyapisi (bkz. #nadirlikAgro): varyant dogumunda
       e.def bir KLONLA degistirilebildigi icin taban def referansi ilk
       cagride saklanir - respawn zari (respawnTik `#nadirlikAt(e, e.def)`)
       klon uzerinden gelse de dogru tabana donulur. Taban def NESNESI
       asla degistirilmez; ayni def'i paylasan diger varliklar etkilenmez. */
    const tabanDef = (e.tabanDef ??= def ?? null);
    if (e.def !== tabanDef) e.def = tabanDef;   // onceki dogumun klonunu birak
    const v = this.variants;
    const bayrak = tabanDef?.variants ?? null;
    let tur = null;

    if (v && bayrak) {
      if (bayrak.giant && v.giant && Math.random() < (v.giant.chance ?? 0)) {
        tur = 'giant';
      } else if (bayrak.champion && v.champion) {
        // yuva basina championPct (0-100) global chance'i EZER
        const pct = e.championPct;
        const sans = (pct != null && Number.isFinite(pct)) ? pct / 100 : (v.champion.chance ?? 0);
        if (Math.random() < sans) tur = 'champion';
      }
    }

    if (!tur) {
      /* Normal: rarity/scalePct GONDERILMEZ. Varlik semasindaki rarity enum'u
         ['champion','giant','unique'] (schemas.json) - 'general' yok, yoklugu
         istemcide zaten 'general' demek. */
      e.rarity = null;
      e.scalePct = null;
      e.atkMult = 1;
      e.maxHp = taban;
      e.hp = taban;
      return;
    }
    const k = v[tur];
    e.rarity = tur;
    e.scalePct = Math.round((k.scaleMult ?? 1) * 100);   // 100 = normal (paket @9336236)
    /* dmgMult su an iki kademede de 1 ("variants are HP/reward sponges, never
       harder hitters" - monster-variants.json PROVENANCE). Kaldiraci
       koruyoruz; combat.js tuketirse hazir olur. */
    e.atkMult = k.dmgMult ?? 1;
    e.maxHp = Math.max(1, Math.round(taban * (k.hpMult ?? 1)));
    e.hp = e.maxHp;
    this.#nadirlikAgro(e, tabanDef);
  }

  /**
   * BILINCLI SAPMA - REFERANS OYUN PARITESI DEGIL (kullanici istegi; kanit:
   * GERCEK/bulgu_nadirlik_agro_2026-09-04.json RECETE b).
   *
   * referans oyun/klon paritesinde nadirlik agresiflige HIC dokunmaz
   * (config/monster-variants.json $comment "NOT scaled by rarity anywhere:
   * ... aggro/leash range"; gameloop.js agro blogundaki "bilerek yapilmadi"
   * notu). vSRO'da ise pasif tabanli bir mobun SAMPIYONU
   * Tab_RefTactics.dwChampionTacticsID uzerinden AGRESIF dogar (238/238
   * bagli sampiyon taktigi btAggressType=0; Mangyang: taban taktik 2
   * pasif/sight 115 -> sampiyon taktigi 1 AGRESIF/sight 130). Kullanici
   * vSRO davranisini istedigi icin zar champion/giant dustugunde ve taban
   * PASIFSE varliga agresif bir def KLONU takilir.
   *
   * - KOSUL verisi: mobs.json def.combat.championTacticsId > 0 - tam da
   *   vSRO'nun pasif tabani agresife cevirdigi kume (klonda 31 pasif def;
   *   Mangyang, Big-eyed Ghost, Weasel...). Taban agresifse dokunulmaz.
   * - YARICAP verisi (sayi uydurulmadi, DB'ye gidilmedi):
   *     1) def.combat.championSightRangeU - BUGUN VERIDE YOK; uretim hatti
   *        eklerse (bkz. data/gelistirme/URETIM-NOTU_sampiyon-gorus.md)
   *        vSRO sampiyon taktiginin kendi gorusu (Mangyang 130 x 0.15 =
   *        19.5u) kod degisikligi gerekmeden oncelik kazanir.
   *     2) yuvanin spawns.json sightRangeU alani (= Tab_RefTactics
   *        .nSightRange x 0.15 dunya olcegi, gen_spawns hatti; Mangyang
   *        yuvasi 115 -> 17.3u) - gemideki EN YAKIN vSRO goruse degeri.
   *   Sampiyon taktik id'leri yuva taktigi olarak gecmedigi icin (31/31
   *   cozulmuyor) tam sampiyon gorusu gemideki JSON'lardan okunamiyor.
   * - GIANT ayni taktigi kullanir: KULLANICI ISTEGI GENISLETMESI -
   *   vSRO'da giant verisi DB'de degil MOTOR KODUNDADIR
   *   (SR_GameServer.exe `GiantMonster_SpawnRatio`; DB'de rarity/giant
   *   kolonu yok), yani "giant dalar" DB'den kanitlanamaz; champion
   *   zinciriyle ayni kosul + yaricap uygulanir.
   * - gameloop.js DEGISMEDI: agro secimi `mob.def?.aggroRangeU` okumaya
   *   devam eder; klonda aggro + aggroRangeU BIRLIKTE ezilir ki paketin
   *   dogrulayici degismezi (aggressive <=> aggroRangeU>0, index-BUMMQVRB.js
   *   @25050303) klon uzerinde de tutsun. leash vb. diger alanlar tabandan
   *   aynen gelir (shallow clone).
   * - GERI ALMA (parite): data/sunucu-ayarlari.json'a
   *   {"sapma":{"nadirlikAgresif":false}} yazmak yeter - admin.js tazele()
   *   dosyadaki HER anahtari GCFG'ye kopyalar, kod degisikligi gerekmez.
   */
  #nadirlikAgro(e, tabanDef) {
    if (this.gcfg?.sapma?.nadirlikAgresif === false) return;  // parite anahtari
    if ((tabanDef?.aggroRangeU ?? 0) > 0) return;             // taban zaten agresif
    if (!((tabanDef?.combat?.championTacticsId ?? 0) > 0)) return;
    const tam = Number(tabanDef?.combat?.championSightRangeU);
    const yuva = Number(e.sightRangeU);
    const yaricap = (Number.isFinite(tam) && tam > 0) ? tam
                  : (Number.isFinite(yuva) && yuva > 0) ? yuva : 0;
    if (!(yaricap > 0)) return;                               // veri yoksa sapma uygulanmaz
    e.def = { ...tabanDef, aggro: 'aggressive', aggroRangeU: yaricap };
  }

  #canavarUret(zoneId, sp, yuvaIx) {
    const def = this.mobDefs.get(sp.mobId) ?? null;
    /* Tab_RefNest'te IKI AYRI yaricap var (gen_spawns.mjs, olcek 0.15):
         nRadius          -> sp.radius       : yuvanin HAREKET (gezinme) siniri
         nGenerateRadius  -> sp.spawnRadius  : canavarlarin DOGDUGU dagilim
       16.563 yuvanin 15.057'sinde nGenerateRadius < nRadius; ikisi ayni sey degil.
       ESKI HALI: Math.min(..., 60) ile 60'a KIRPILIYORDU - Mangyang yuvasi 75/120
       birimken 60'a dusuyordu; ayrica `sira === 0 ? 0` ile her yuvanin ilk canavari
       TAM merkeze konuyordu ve Math.random()*yaricap dogrusal oldugu icin surunun
       tamami merkeze yigiliyordu. */
    const gezYaricap = Math.max(sp.radius ?? 0, 0);
    const dogYaricap = Math.max(sp.spawnRadius ?? sp.radius ?? 0, 0);
    // madde 49: nokta artik nav.bin'e karsi dogrulaniyor
    const { x, z } = this.#dogusNoktasi(zoneId, sp.x, sp.z, dogYaricap);

    const maxHp = def?.hp ?? sp.maxHp ?? 100;
    const e = {
      id: ++this.nextMobId,
      kind: 'monster',
      modelKey: sp.modelKey,
      name: def?.name ?? sp.name ?? sp.modelKey,
      mobId: sp.mobId ?? null,
      x, z, y: this.groundY(zoneId, x, z), rotY: Math.random() * Math.PI * 2,
      level: def?.level ?? sp.level ?? 1,
      hp: maxHp, maxHp, tabanMaxHp: maxHp,
      dead: false,
      // dogus yeri - leash, respawn ve bosta gezinme siniri icin
      evX: sp.x, evZ: sp.z, evYaricap: gezYaricap, evDogYaricap: dogYaricap,
      // yuva kimlikleri: tembel acma/kapama defteri ve respawn zamanlamasi icin
      yuvaIx, nestId: sp.nestId ?? null,
      championPct: sp.championPct ?? null,
      /* BILINCLI SAPMA yaricap kaynagi (#nadirlikAgro): yuvanin vSRO taktik
         gorusu, spawns.json sightRangeU = Tab_RefTactics.nSightRange x 0.15. */
      sightRangeU: sp.sightRangeU ?? null,
      /* madde 22: respawn penceresi yuvadan gelir (spawns.json respawnDelaySec
         = Tab_RefNest.dwDelayTimeMin/Max; paket sema @8718198
         respawnMinMs/respawnMaxMs). */
      respawnMinMs: null, respawnMaxMs: null,
      // bosta gezinme durumu (gezinme.js doldurur)
      gez: null, gezSonraki: 0,
      def,
    };
    const rd = sp.respawnDelaySec;
    if (Array.isArray(rd) && rd.length === 2) {
      const a = Math.max(0, Number(rd[0]) || 0) * 1000;
      const b = Math.max(0, Number(rd[1]) || 0) * 1000;
      if (a > 0 || b > 0) { e.respawnMinMs = Math.min(a, b); e.respawnMaxMs = Math.max(a, b); }
    }
    this.#nadirlikAt(e, def);
    return e;
  }

  // ------------------------------------------------------------- oyuncu
  oyuncuGir(ws) {
    const z = this.#bolge(ws.zoneId);
    z.players.add(ws);
    ws.gorunen = new Set();
    ws.sonYuvaTarama = null;             // bolge degisti - yuva taramasi bastan
    this.#yuvalariGuncelle(ws.zoneId, z, ws);
    return z;
  }

  oyuncuCik(ws) {
    const z = this.zoneState.get(ws.zoneId);
    if (!z) return;
    z.players.delete(ws);
    ws.sonYuvaTarama = null;
    /* Bolge bosaldi: acik yuvalari bosalt. Eski kod bolge bosalsa da tum
       varliklari bellekte tutuyordu (madde 64). */
    if (!z.players.size) for (const ix of [...z.acik.keys()]) this.#yuvaKapat(z, ix);
  }

  /** zone.init icin: oyuncunun cevresindeki varliklar. */
  yakindakiler(ws, ekstra = []) {
    const z = this.#bolge(ws.zoneId);
    this.#yuvalariGuncelle(ws.zoneId, z, ws);
    const out = [];
    for (const e of z.entities.values()) {
      if (e.dead) continue;
      if (this.#mesafe2(e, ws.char) <= GORUS_MESAFESI ** 2) out.push(this.#varlikPayload(e, ws.zoneId));
    }
    return out.concat(ekstra);
  }

  #mesafe2(a, b) {
    const dx = a.x - b.x, dz = a.z - b.z;
    return dx * dx + dz * dz;
  }

  #varlikPayload(e, zoneId = null) {
    const p = {
      id: e.id, kind: e.kind, modelKey: e.modelKey, name: e.name,
      x: +e.x.toFixed(2), z: +e.z.toFixed(2), y: +(e.y ?? 0).toFixed(2),
      rotY: +(e.rotY ?? 0).toFixed(3),
    };
    /* Yurumekte olan varlik: istemci semasi `moving:{tx,tz,speed}` bekliyor
       (Qmt / $mt). Bu alan gonderilmezse istemci addEntity'de path=null yapar,
       yani gorus alanina yururken giren canavar DURUYOR gibi gorunur. */
    if (e.gez) {
      p.moving = {
        tx: +e.gez.tx.toFixed(2), tz: +e.gez.tz.toFixed(2), speed: e.gez.hiz,
      };
    }
    if (e.level != null) p.level = e.level;
    if (e.maxHp != null) { p.hp = Math.max(0, Math.round(e.hp)); p.maxHp = e.maxHp; }
    if (e.dead) p.dead = true;
    if (e.rarity) p.rarity = e.rarity;
    if (e.npcId) p.npcId = e.npcId;
    /* GANIMET ALANLARI - ONCEDEN EKSIKTI.
       Yere dusen esyalar da z.entities icinde duruyor; hem zone.init'in
       `yakindakiler()` hem de ilgi guncellemesinin state.delta.add'i BU
       fonksiyondan geciyor. itemId/qty/gold gonderilmedigi icin, dusme
       aninda gorunmeyip SONRADAN gorus alanina giren (ya da bolgeye
       yeni giren oyuncunun gordugu) her ganimet istemcide "ne oldugu
       belirsiz" bir kutu olarak kaliyordu: gameloop'un kendi
       #ganimetPayload'u bu alanlari gonderiyor, world.js'inki GONDERMIYORDU.
       $mt semasi (index-BUMMQVRB.js @25590xxx): itemId?, qty?, gold?,
       ownerId?, scalePct? */
    if (e.itemId) { p.itemId = e.itemId; p.qty = e.qty ?? 1; }
    if (e.gold) { p.gold = e.gold; p.qty = e.qty ?? 1; }
    if (e.scalePct != null) p.scalePct = e.scalePct;
    /* SAHIP: pet / gelisim peti varliklari sahibi `sahipEntityId` alaninda
       tutuyor (sistem_binek-pet.js). $mt semasindaki karsiligi `ownerId`.
       Bu esleme sadece binek-pet modulunun kendi varlikPayload'inda vardi;
       world.js'inki (zone.init `yakindakiler` + ilgi guncellemesi
       `ilgiGuncelle`) sahibi DUSURUYORDU - yani bir oyuncu baskasinin
       petini gorus alanina girerek gordugunde pet sahipsiz geliyordu. */
    const sahip = e.ownerId ?? e.sahipEntityId;
    if (sahip != null) p.ownerId = sahip;
    /* MADDE 62 (capraz istek 35): CANAVAR yukune aktif durumlar. state.delta.add
       semasi (data/schemas.json) `statuses` tasiyor; oyuncu tarafini
       sistem_beceri.varlikAlanlari(ch) dolduruyor, canavar yukunu BIZ
       uretiyoruz. durumlariniAl tel semasini ({iid,code,level,expiresAt,...})
       dondurur - sonradan gorus alanina giren canavarin rozeti de gorunur. */
    if (e.kind === 'monster' && zoneId != null) {
      const st = this.sistemOrnegi?.('beceri')?.durumlariniAl?.(zoneId, e.id);
      if (st?.length) p.statuses = st;
    }
    return p;
  }

  /**
   * #varlikPayload'in DISA ACIK hali (fark: "Respawn eden canavarin
   * state.delta.add yuku elden yazilmis ve rarity/scalePct/npcId/moving
   * alanlarini DUSURUYOR"). gameloop.js #respawn kendi kisaltilmis nesnesini
   * uretmek yerine bunu kullanmalidir.
   */
  varlikYuku(e, zoneId = null) { return this.#varlikPayload(e, zoneId); }

  /**
   * Ilgi alani guncellemesi: oyuncunun goremedigi ama artik goren varliklari
   * ekler, uzaklasanları cikarir. { add:[], rem:[] } veya null doner.
   */
  ilgiGuncelle(ws) {
    const z = this.zoneState.get(ws.zoneId);
    if (!z || !ws.char) return null;
    this.#yuvalariGuncelle(ws.zoneId, z, ws);
    const add = [], rem = [];
    const gorunen = ws.gorunen ?? (ws.gorunen = new Set());
    const simdi = Date.now();

    for (const e of z.entities.values()) {
      const d2 = this.#mesafe2(e, ws.char);
      const goruyor = gorunen.has(e.id);
      if (!goruyor && !e.dead && d2 <= GORUS_MESAFESI ** 2) {
        gorunen.add(e.id);
        add.push(this.#varlikPayload(e, ws.zoneId));
      } else if (goruyor && (this.#cesetGitti(e, simdi) || d2 > GORUS_BIRAKMA ** 2)) {
        gorunen.delete(e.id);
        rem.push(e.id);
      }
    }
    if (!add.length && !rem.length) return null;
    const d = {};
    if (add.length) d.add = add;
    if (rem.length) d.rem = rem;
    return d;
  }

  /* madde 47: olu varlik ANINDA silinmez - gameConfig.corpseDespawnMs (6000)
     boyunca yerde kalir. Eski kod `e.dead` gorur gormez rem yolluyordu, yani
     yuruyen oyuncunun ekraninda olum animasyonu KESILIYORDU. */
  #cesetGitti(e, simdi) {
    return !!e.dead && simdi >= (e.cesetSil ?? 0);
  }

  /** Oyuncu zone.init aldiginda gorunenler kumesini doldurur. */
  gorunenleriKur(ws, entities) {
    ws.gorunen = new Set(entities.map(e => e.id));
  }

  varlik(zoneId, id) {
    return this.zoneState.get(zoneId)?.entities.get(id) ?? null;
  }

  varlikSil(zoneId, id) {
    this.zoneState.get(zoneId)?.entities.delete(id);
  }

  varlikEkle(zoneId, e) {
    this.#bolge(zoneId).entities.set(e.id, e);
    return e;
  }

  yeniVarlikId() { return ++this.nextMobId; }

  /**
   * Bir canavarin respawn gecikmesi (madde 22).
   * KAYNAK: data/spawns.json[].respawnDelaySec = Tab_RefNest.dwDelayTimeMin/Max
   * (canli DB: 7350 yuvanin tamami dolu, 2374'u [8,12] sn). Paketteki karsiligi
   * yuva semasindaki respawnMinMs/respawnMaxMs (@8718198); cozucu
   * `respawnDelayDecoder: 'uniform_seeded_v1'` (@8718970 civari), yani
   * [min,max] araliginda DUZGUN dagilim.
   */
  respawnGecikmesi(e) {
    const a = Number(e?.respawnMinMs);
    const b = Number(e?.respawnMaxMs);
    const min = Number.isFinite(a) && a >= 0 ? a : RESPAWN_VARSAYILAN_MIN_MS;
    const max = Number.isFinite(b) && b >= min ? b : Math.max(min, RESPAWN_VARSAYILAN_MAX_MS);
    return Math.round(min + Math.random() * (max - min));
  }

  /**
   * Olen canavari respawn kuyruguna alir.
   *
   * `gecikmeMs` VERILMEZSE (olagan yol) yuvanin kendi penceresi kullanilir
   * (spawns.json respawnDelaySec = Tab_RefNest.dwDelayTimeMin/Max).
   */
  olumKaydet(zoneId, e, gecikmeMs) {
    const z = this.#bolge(zoneId);
    e.dead = true;
    e.hp = 0;
    e.gez = null; e.gezSonraki = 0;      // olen canavar gezinmez
    const ms = (gecikmeMs == null) ? this.respawnGecikmesi(e) : gecikmeMs;
    const simdi = Date.now();
    /* madde 47 - ceset damgasi: gameConfig.corpseDespawnMs (6000) sonra
       varlik ilgi alanindan cikarilir. */
    e.cesetSil = simdi + this.#cesetSuresiMs();
    z.olu.push({ id: e.id, at: simdi + ms });
    /* Unique cesedini sistem_dirilis-unique.js kendi `cesetKuyrugu` ile
       kaldiriyor (varligi tamamen siliyor); cift islem olmasin diye buraya
       alinmiyor. Damgayi yine de koyduk ki ilgi alani 6 sn erken silmesin. */
    if (e.rarity !== 'unique') z.ceset.push({ id: e.id, at: e.cesetSil });
  }

  /**
   * Tik: suresi dolan cesetleri ilgi alanindan cikarir (madde 47).
   * Oyuncunun YURUMESINE bagli degildir.
   * @returns {{ws:any, rem:number[]}[]} her oyuncu icin gonderilecek rem listesi
   */
  cesetTik(zoneId) {
    const z = this.zoneState.get(zoneId);
    if (!z?.ceset.length) return [];
    const simdi = Date.now();
    const dolan = [];
    z.ceset = z.ceset.filter((c) => {
      if (c.at > simdi) return true;
      dolan.push(c.id);
      return false;
    });
    if (!dolan.length) return [];
    const cikti = [];
    for (const ws of z.players) {
      const g = ws.gorunen;
      if (!g) continue;
      const rem = [];
      for (const id of dolan) if (g.delete(id)) rem.push(id);
      if (rem.length) cikti.push({ ws, rem });
    }
    return cikti;
  }

  /**
   * Dirilen varliklari SADECE gorus alanindaki oyunculara yollamak icin
   * hazirlar ve o oyuncularin `gorunen` kumesine ekler (madde 48).
   *
   * Eski #respawn bolgedeki HERKESE mesafeye bakmadan add yolluyor ve
   * `gorunen`i guncellemiyordu; uzakta dirilen canavar istemciye ekleniyor
   * ama gorunen'de olmadigi icin ilgiGuncelle onu BIR DAHA rem edemiyordu
   * (rem kosulu `gorunen.has(id)`), yani kalici hayalet varlik kaliyordu.
   *
   * @returns {{ws:any, add:object[]}[]}
   */
  respawnYayini(zoneId, dirilen) {
    const z = this.zoneState.get(zoneId);
    if (!z || !dirilen?.length) return [];
    const cikti = [];
    for (const ws of z.players) {
      if (!ws.char) continue;
      const g = ws.gorunen ?? (ws.gorunen = new Set());
      const add = [];
      for (const e of dirilen) {
        if (g.has(e.id)) continue;
        if (this.#mesafe2(e, ws.char) > GORUS_MESAFESI ** 2) continue;
        g.add(e.id);
        add.push(this.#varlikPayload(e, zoneId));
      }
      if (add.length) cikti.push({ ws, add });
    }
    return cikti;
  }

  /** Tik: suresi dolan canavarlari diriltir. Diriltilenlerin listesini doner. */
  respawnTik(zoneId) {
    const z = this.zoneState.get(zoneId);
    if (!z) return [];
    /* Yuva bakimi (tembel dogus) BURADA yapiliyor: gameloop #respawn'i her
       tik cagiriyor, yani ayri bir kanca gerekmeden calisir. */
    this.#yuvaBakimi(zoneId, z);
    if (!z.olu.length) return [];
    const simdi = Date.now();
    const dirilen = [];
    z.olu = z.olu.filter(o => {
      if (o.at > simdi) return true;
      const e = z.entities.get(o.id);
      if (e) {
        /* CESET ONCE KALKAR: ceset suresi respawn gecikmesinden uzunsa
           (cagiran acikca kisa bir gecikme verdiyse) once cesedin ilgi
           alanindan cikmasi gerekir - yoksa varlik hala oyuncunun `gorunen`
           kumesinde oldugu icin respawnYayini onu ATLAR ve canavar o
           oyuncunun ekraninda sonsuza dek olu kalir. */
        if ((e.cesetSil ?? 0) > simdi) return true;
        e.dead = false;
        e.cesetSil = 0;
        /* madde 21/71: varyant zari HER DOGUSTA yeniden atilir
           (monster-variants.json $comment "applied per spawn"). Taban HP
           e.tabanMaxHp'de durdugu icin carpanlar ust uste binmez. */
        this.#nadirlikAt(e, e.def);
        e.hp = e.maxHp;
        // madde 49: respawn noktasi da nav.bin'e karsi dogrulanir
        const yaricap = e.evDogYaricap ?? e.evYaricap ?? 0;
        const nk = this.#dogusNoktasi(zoneId, e.evX, e.evZ, yaricap);
        e.x = nk.x; e.z = nk.z;
        e.y = this.groundY(zoneId, e.x, e.z, e.y);
        e.rotY = Math.random() * Math.PI * 2;
        e.hedef = null;
        e.hedefEntityId = null;
        e.gez = null; e.gezSonraki = 0;   // taze dogan canavar bastan gezinir
        dirilen.push(e);
      }
      return false;
    });
    return dirilen;
  }

  bolgeOyunculari(zoneId) {
    return [...(this.zoneState.get(zoneId)?.players ?? [])];
  }

  istatistik() {
    const out = {};
    for (const [zid, z] of this.zoneState) {
      let canli = 0, olu = 0;
      for (const e of z.entities.values()) (e.dead ? olu++ : canli++);
      out[zid] = { oyuncu: z.players.size, canli, olu, acikYuva: z.acik.size };
    }
    return out;
  }
}
