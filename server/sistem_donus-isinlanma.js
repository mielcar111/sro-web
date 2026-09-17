/**
 * DONUS (return scroll) + ISINLANMA sistemi.
 *
 * Isledigi istemci mesajlari (opcode'lar protocol.js C2S ile birebir):
 *    83  return.start      {}                              -> kanalize edilen "Sehre don"
 *    84  return.cancel     {}                              -> kanalizasyonu iptal
 *    86  taction.teleport  { presetId }                    -> kanalize edilen harita/isaret isinlanmasi
 *    82  teleport.use      { teleporterId, destId }        -> NPC/kapi isinlayicisi (ANINDA)
 *    81  zone.ready        {}                              -> SADECE DINLENIR (false doner), isaretleri yollar
 *
 * !!! DENETIM DUZELTMESI: ISTEMCI zone.ready GONDERMIYOR !!!
 *   `zone.ready` metni 27 MB'lik istemci paketinde TAM 1 KEZ geciyor: bayt
 *   25612683'teki SEMA TABLOSU. `send(\`zone.ready\`)` cagrisi SIFIR adet.
 *   Yani isaretler zone.ready'ye baglandigi surece istemciye HIC ULASMIYOR ve
 *   taction penceresindeki iki dugme kalici olarak SONUK kaliyor:
 *      bayt 27631050:  disabled: !zone,  zone = Bht(node.mark, XRt, v_i)
 *      bayt 25647504:  Bht = (m) => m ? ... : null      // mark yoksa null
 *   DUZELTME: giris kurulumu artik zone.ready'ye degil, modulun KENDI tikine
 *   bagli. Oyuncu server.js:804 WORLDSIM.oyuncuGir(ws) ile zoneState players
 *   kumesine giriyor; tik onu ilk gorduğunde isaretleri yukleyip yolluyor.
 *   zone.ready dali yine de duruyor (zararsiz, ileride istemci yollarsa calisir).
 *
 * ---------------------------------------------------------------------------
 * PAKETTEN OKUNAN SEMALAR  (playjs_source\index-BUMMQVRB.js)
 *
 *  c2s (bayt 25612720..25612900):
 *    T$(`teleport.use`, 82, X({ teleporterId: J(), destId: J() }), `misc`)
 *    T$(`return.start`, 83, X({}), `misc`)
 *    T$(`return.cancel`, 84, X({}), `misc`)
 *    T$(`taction.teleport`, 86, X({ presetId: J().min(1) }), `misc`)
 *
 *  s2c (bayt 25631530..25631830):
 *    T$(`fx.returnStart`, 191, X({ id: Y().int() }))
 *    T$(`fx.returnStop`,  192, X({ id: Y().int(), done: RJ().optional() }))
 *    T$(`return.begin`,   193, X({ durationMs: Y(), kind: qJ([`return`,`teleport`]).optional() }))
 *    T$(`return.end`,     194, X({}))
 *
 *  s2c (bayt 25625890..25625960):
 *    var Mht = X({ zone: J(), x: Y(), z: Y(), y: Y().optional(), at: Y() });
 *    T$(`taction.marks`, 215, X({ death: Mht.optional(), ret: Mht.optional() }))
 *
 *  s2c (bayt 25619125):
 *    T$(`entity.teleport`, 136, X({ id: Y().int(), x: Y(), z: Y(), y: Y().optional(),
 *                                   blink: RJ().optional() }))
 *
 * ---------------------------------------------------------------------------
 * ISTEMCININ GERCEKTE YAPTIGI (uydurma yok, hepsi pakette okundu)
 *
 *  1) "Buradan cikamiyor musun? / Sehre don" (VRt, bayt 27623900):
 *        W$.send(`return.start`, {}), a4.getState().dismiss();
 *     Kutu yalnizca  returning === null && !self.dead  iken gorunur.
 *
 *  2) return.begin -> zY.startReturn(durationMs, kind) (bayt 27122515). Cubuk
 *     metni kind'e gore secilir (bayt 27580143):
 *        kind === `teleport` ? `ui.return.teleporting` : `ui.return.returning`
 *     Cubugun IPTAL dugmesi:  W$.send(`return.cancel`, {})
 *     => taction.teleport DA AYNI CUBUGU kullanir, kind: `teleport` ile.
 *
 *  3) entity.teleport (bayt 27121093): id === self && !blink ise istemci
 *     `loading.teleporting` perdesini acar VE zY.clearReturn() cagirir.
 *
 *  4) taction penceresi (bayt 27630400) sadece iki sabit presetId uretir:
 *        `last_death`  (ui.taction.death - "Oldugun yer")
 *        `last_return` (ui.taction.ret   - "Return attigin yer")
 *     ucuncu dugme dunya haritasini acar; harita tiklamasi (bayt 27097230)
 *     teleport-presets.json'daki preset.id'yi yollar.
 *
 *  5) taction.marks isleyicisi (bayt 27131609) -> N$.apply, ve apply SU:
 *        apply: m => set({ death: m.death ?? null, ret: m.ret ?? null })
 *     YANI HER KARE IKI ISARETI DE TASIMALI; sadece `ret` yollarsan `death`
 *     istemcide SILINIR. Modul her zaman ikisini birden yollar.
 *
 *  6) Isinlayici NPC'sine tiklama (Kgt, bayt 25686340):
 *        let radiusU = p1.gameConfig.npcInteractRangeU;
 *        if (node.npcId?.startsWith(`tp_`)) { ... teleporters.find(t => t.id === node.npcId.slice(3)) }
 *        radiusU: Ict(node3, radiusU)   // Ict = (n, d) => n?.interactRangeU ?? d
 *     => menzil = teleporter.interactRangeU ?? gameConfig.npcInteractRangeU (=25).
 *
 *  7) sys.notice param cevirisi (bayt 27115800):
 *        typeof item.destId == `string` && typeof item.dest == `string`
 *          && (node.dest = b5(`label:dest:${item.destId}`, item.dest))
 *     => varis bildiriminde params { destId, dest } ikisi birden gerekir.
 *     Kullanilan anahtarlar Tht listesinde GERCEKTEN var:
 *        sys.teleport.arrived        = "{dest} konumuna isinlandin"
 *        sys.teleport.arrived_paid   = "{dest} konumuna isinlandin (-{gold} altin)"
 *     Hata anahtarlari Eht listesinde GERCEKTEN var:
 *        err.busy.returning, err.teleport.in_combat, err.taction.no_mark
 *     Hata kodlari Sht listesinden: ERR_DEAD, ERR_BUSY, ERR_RANGE, ERR_NO_GOLD,
 *        ERR_NOT_FOUND, ERR_REQ_LEVEL, ERR_VALIDATION.
 *
 * ---------------------------------------------------------------------------
 * !!! SURE PAKETTE YOK - OLCULEMEDI !!!
 *
 * Aradigim ve BULAMADIGIM yerler:
 *   - istemci paketi: `returnMs`, `returnDurationMs`, `returnDuration`,
 *     `RETURN_MS`, `returnScroll`, `channelMs` -> HIC GECMIYOR. startReturn'e
 *     giren tek deger sunucudan gelen d.durationMs. (BY = 8e3 sabiti buna
 *     benzemesine ragmen ILGISIZ: cast/hit zamanlayicisi kirpma siniri.)
 *   - paket_veri/config/*.json: `return|teleport|channel|cooldown` iceren tek
 *     anahtar `social.recheckCooldownSec` ve `carrier.cooldownMs`.
 *   - GERCEK/zone_init.json canli yakalamasinda return.begin karesi YOK.
 *   - items.json (2860 kayit) icinde "return"/"recall" gecen esya YOK.
 *
 * Bu yuzden sure UYDURULMADI, YAPILANDIRILABILIR yapildi:
 *   game-config.json'a `returnChannelMs` / `tactionChannelMs` eklenirse O
 *   kullanilir. Yoksa asagidaki OLCULMEMIS varsayilan devreye girer ve
 *   kurulusta bir kere loglanir. Gercek deger olculunce tek satir degisir.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sql from 'mssql';
import { bacakDurdur } from './bacak.js';

const BURASI = path.dirname(fileURLToPath(import.meta.url));

/** OLCULMEDI - yukaridaki nota bak. game-config.json ile ezilebilir. */
const VARSAYILAN_KANAL_MS = 5000;

/** Kanalizasyon ilerletme tiki. game-config.tickHz yoksa 100 ms. */
const VARSAYILAN_TIK_MS = 100;

/** Sht (istemcinin err.code enum'u) icinden kullandigimiz kodlar. */
const KOD = {
  dogrulama: 'ERR_VALIDATION',
  menzil: 'ERR_RANGE',
  altin: 'ERR_NO_GOLD',
  seviye: 'ERR_REQ_LEVEL',
  olu: 'ERR_DEAD',
  mesgul: 'ERR_BUSY',
  yok: 'ERR_NOT_FOUND',
};

/**
 * Eht (istemcinin gecerli err.key listesi) icinden kullandiklarimiz.
 *
 * !!! NEDEN GEREKLI: istemcinin `err` isleyicisi (bayt 27134734)
 *       if (d.key && b2(d.key)) { pushSys(d.key, params); return; }
 *       let r = `err.${d.code}`; b2(r) && pushSys(r, params);
 *     yani ANAHTAR YOKSA d.code'a duser; o da locale'de yoksa oyuncuya
 *     HICBIR SEY gostermez (sadece console.warn).
 *     `err.ERR_DEAD` tr.json'da YOK (177 err.* anahtari tarandi) - yani
 *     "oldun, isinlanamazsin" reddi SESSIZ kaliyordu. Eht'te bulunan ve
 *     tr.json satir 127'de GERCEKTEN olan karsiligi:
 *       err.busy.downed = "Yere serildin."
 */
const ANAHTAR = {
  olu: 'err.busy.downed',
};

/* ============================================== TACTION (harita isinlanmasi) BEKLEMESI
 * KAYNAK - uydurma degil, uc bagimsiz iz:
 *   1) client/assets/locales/tr.json satir 1863  `ui.actions.teleport_desc`:
 *        "Premium: ... 5 sn odaklan ve oraya isinlan. 1 dk bekleme suresi."
 *      -> bekleme 1 DAKIKA = 60 000 ms.
 *   2) tr.json satir 189  `err.teleport.cooldown`:
 *        "Isinlanma henuz hazir degil - {secs} sn kaldi."   ({secs} = SANIYE)
 *      Anahtar paketin Eht listesinde de var (bayt 25607085).
 *   3) zone.init.self semasi (paket @25598051):
 *        actionCooldowns: BJ(X({ key: J(), readyAt: Y() })).optional()
 *      ve istemcinin TEK okuma noktasi (paket @27312815):
 *        zY.getState().actionCooldowns.teleport ?? 0
 *      seedFromServer (paket @25080772) diziyi `key` ile nesneye ceviriyor,
 *      yani gonderilecek anahtar tam olarak `teleport`.
 *
 * NEDEN KALICI: sure tek oturuma sigsa da, bekleme yalniz bellekte tutulursa
 * "cik-gir" ile atlanabilir hale gelir (arastirma raporu: actionCooldowns
 * KALICI, guclu-cikarim). Bu yuzden WebCharMarks satirinda saklaniyor -
 * karakter basina zaten bir satiri olan, bu modulun SAHIBI oldugu tablo.
 */
const TACTION_BEKLEME_MS = 60_000;

/* ============================================== ORNEK OMRU / DEVIR DEFTERLERI
 * server.js `sistemleriKur()` (server.js:1337) tum modulleri BASTAN kuruyor.
 * kur() icinde acilan setInterval eski ornekle birlikte DURMADIGI icin her
 * yeniden kurulumda bir tik daha ekleniyordu (kanalizasyon iki kat hizli
 * ilerler). Kalibi kardes moduller de kullaniyor: sistem_binek-pet.js:152,
 * sistem_kucuk-sistemler.js:298, sistem_dirilis-unique.js:193.
 * Isaret/bekleme defterleri de modul kapsaminda: `web` yokken TEK kopya
 * onlar, yeniden kurulumda silinmeleri veri kaybi demekti. */
const ISARET_DEFTERI = new Map();
const TP_HAZIR_DEFTERI = new Map();
let ONCEKI_ORNEK = null;

export function kur(ctx) {
  /* Eski ornegin tikini durdur - yoksa her yeniden kurulumda bir tik birikir. */
  if (ONCEKI_ORNEK) {
    try { ONCEKI_ORNEK.dur(); } catch { /* zaten kapali */ }
    ONCEKI_ORNEK = null;
  }
  const world = ctx.world;
  const frame = ctx.frame;
  const broadcast = ctx.broadcast;
  const log = ctx.log ?? (() => {});
  const GCFG = ctx.GCFG ?? {};
  const zoneGroundY = ctx.zoneGroundY ?? (() => 0);
  const yurunebilirNokta = ctx.yurunebilirNokta ?? null;
  const envanterPayload = ctx.envanterPayload ?? null;
  const web = ctx.web ?? null;

  const DONUS_MS = sayi(GCFG.returnChannelMs, VARSAYILAN_KANAL_MS);
  const TACTION_MS = sayi(GCFG.tactionChannelMs, DONUS_MS);
  const TIK_MS = GCFG.tickHz > 0 ? Math.round(1000 / GCFG.tickHz) : VARSAYILAN_TIK_MS;
  const NPC_MENZIL = sayi(GCFG.npcInteractRangeU, 25);

  if (GCFG.returnChannelMs === undefined) {
    log(`donus-isinlanma: returnChannelMs game-config'te YOK - ` +
        `${VARSAYILAN_KANAL_MS} ms OLCULMEMIS varsayilan kullaniliyor`);
  }

  // ----------------------------------------------------------------- veri
  const dataDir = world?.dataDir ?? path.join(BURASI, 'data');

  function oku(ad) {
    try {
      const p = path.join(dataDir, ad);
      return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
    } catch (e) {
      log(`donus-isinlanma: ${ad} okunamadi: ${String(e.message).slice(0, 100)}`);
      return null;
    }
  }

  /* Harita uzerinden isinlanma noktalari.
     Kaynak: GERCEK/paket_veri/config/teleport-presets.json (birebir kopya). */
  const PRESET = new Map();
  for (const p of oku('teleport-presets.json')?.presets ?? []) {
    if (p?.id) PRESET.set(String(p.id), p);
  }

  /* Isinlayici NPC'ler + HEDEFLERI.
     world.json'daki teleporters[] kayitlarinda `destinations` YOK; hedef
     listesi istemcinin kendi bolge katalogunda duruyor. data/teleporters.json
     bu listenin paketten cikarilmis birebir kopyasidir (7 bolge, 35 isinlayici,
     50 hedef). Konum/isim yine world.json'dan (canli dunya) gelir. */
  const dosyaTP = oku('teleporters.json')?.zones ?? {};
  const ISINLAYICI = new Map();   // zoneId -> Map(id -> tanim)
  {
    const bolgeler = new Set([
      ...Object.keys(world?.worldData?.zones ?? {}),
      ...Object.keys(dosyaTP),
    ]);
    for (const zid of bolgeler) {
      const m = new Map();
      const dosyaListe = dosyaTP[zid] ?? [];
      const dosyaMap = new Map(dosyaListe.map((t) => [t.id, t]));
      for (const t of world?.worldData?.zones?.[zid]?.teleporters ?? []) {
        const ek = dosyaMap.get(t.id) ?? {};
        m.set(t.id, {
          ...ek,
          ...t,
          destinations: t.destinations ?? ek.destinations ?? [],
          interactRangeU: t.interactRangeU ?? ek.interactRangeU,
        });
      }
      for (const t of dosyaListe) if (!m.has(t.id)) m.set(t.id, t);
      if (m.size) ISINLAYICI.set(zid, m);
    }
  }
  log(`donus-isinlanma: ${PRESET.size} harita noktasi, ` +
      `${[...ISINLAYICI.values()].reduce((a, m) => a + m.size, 0)} isinlayici yuklendi`);

  // ------------------------------------------------------------- durumlar
  /** charId -> { death?: isaret, ret?: isaret } */
  const ISARET = ISARET_DEFTERI;
  /** charId -> taction.teleport'un tekrar hazir olacagi MUTLAK an (ms). */
  const TP_HAZIR = TP_HAZIR_DEFTERI;
  /** ws -> { tur, biter, hedefZone, hedef, isaret?, destId, dest } */
  const AKTIF = new Map();
  /** ws -> onceki `dead` degeri (olum isareti icin kenar yakalama) */
  const OLU_IZ = new WeakMap();
  /** Giris kurulumu yapilmis baglantilar (isaret yukleme + olu izi tohumu). */
  const KURULDU = new WeakSet();

  let capraziUyardik = false;

  // --------------------------------------------------------------- yardim
  function sayi(v, varsayilan) {
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : varsayilan;
  }

  function acik(ws) {
    return !!ws && !!ws.char && (ws.readyState === undefined || ws.readyState === 1);
  }

  /**
   * err (240). `params` EKLENDI: err semasi (paket @25631967)
   *   err = X({ code, key?, msg?, q?, params: GJ(J(), VJ([J(), Y()])).optional() })
   * ve `err.teleport.cooldown` metni {secs} yer tutucusu iceriyor
   * (tr.json:189). Params gitmezse istemci ekrana HAM "{secs}" basar
   * (paket @25546596).
   */
  function hata(ws, code, key, params) {
    const d = { code };
    if (key) d.key = key;
    if (params && typeof params === 'object') {
      const p = {};
      for (const [k, v] of Object.entries(params)) {
        if (v === undefined || v === null) continue;
        // Sema yalniz string|number kabul ediyor.
        p[k] = typeof v === 'number' ? v : String(v);
      }
      if (Object.keys(p).length) d.params = p;
    }
    frame(ws, 'err', d);
  }

  function bolgeAdi(zid) {
    return world?.worldData?.zones?.[zid]?.name ?? zid;
  }

  function yuvarla(v) {
    return Math.round(Number(v) * 100) / 100;
  }

  /** Mht semasi: { zone, x, z, y?, at } - hepsi sayi/metin, `at` epoch ms. */
  function isaretYap(zoneId, ch) {
    const m = { zone: String(zoneId), x: yuvarla(ch.x), z: yuvarla(ch.z), at: Date.now() };
    if (ch.y != null) m.y = yuvarla(ch.y);
    return m;
  }

  /**
   * Varis noktasi. Hedefin `arrivalRadiusU` alani varsa (paket verisinde 6)
   * o yaricap icinde rastgele bir nokta secilir ve navmesh'ten gecirilir;
   * yol kapaliysa yuruYolu zaten son GECERLI noktayi dondurur.
   */
  function varisNoktasi(zoneId, pos, yaricap) {
    /* fark #169 / capraz istek 6 UYGULANMADI (bilerek): oneri pos.y'yi
       TOHUM yapip zoneGroundY'den gecirmekti, ama olcum bunun davranis
       korumadigini gosterdi - ornn. lastReturn hedefinde toPos.y=-0.07 iken
       ornekleyici -4.97 donduruyor (test_donus-isinlanma T6). Veride y
       varsa istemcinin bekledigi deger ODUR; tohumlu cagri yalniz y'siz
       kayitlarda kullanilir. */
    const y0 = pos.y != null ? pos.y : zoneGroundY(zoneId, pos.x, pos.z);
    if (!(yaricap > 0) || typeof yurunebilirNokta !== 'function') {
      return { x: pos.x, z: pos.z, y: y0 };
    }
    const aci = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * yaricap;
    const hx = pos.x + Math.cos(aci) * r;
    const hz = pos.z + Math.sin(aci) * r;
    const yol = yurunebilirNokta(zoneId, pos.x, pos.z, hx, hz, y0);
    if (!yol) return { x: pos.x, z: pos.z, y: y0 };
    return {
      x: yol.x, z: yol.z,
      /* yol.y varsa nav'in verdigi yukseklik korunur (bkz. yukaridaki not). */
      y: yol.y != null ? yol.y : zoneGroundY(zoneId, yol.x, yol.z),
    };
  }

  /**
   * Oyuncuyu AYNI bolge icinde tasir.
   * blink verilmezse istemci `loading.teleporting` perdesini acar ve donus
   * cubugunu kendisi temizler (bayt 27121093).
   */
  function isinla(ws, hedef) {
    const ch = ws.char;
    bacakDurdur(ch);            // yuruyus hedefi kalirsa oyuncu geri suruklenir
    ws.savas = null;            // isinlandin: savas biter
    ws.hedefId = null;
    ch.x = hedef.x;
    ch.z = hedef.z;
    /* hedef.y varsa AYNEN kullanilir (capraz istek 6 BILEREK uygulanmadi -
       bkz. varisNoktasi'ndaki olcum notu). */
    ch.y = hedef.y != null ? hedef.y : zoneGroundY(ws.zoneId, hedef.x, hedef.z);

    const kare = { id: ws.entityId, x: ch.x, z: ch.z, y: ch.y };
    frame(ws, 'entity.teleport', kare);
    broadcast(ws.zoneId, 'entity.teleport', kare, ws);

    /* Ilgi alani: 100+ birim atladik, eski komsular artik gorunmuyor.
       Oyun dongusu bunu zaten her tik yapar; burada hemen yapmak sadece
       bir tiklik gecikmeyi siler (gorunen kumesini mutasyona ugrattigi icin
       cift gonderim olmaz). */
    try {
      const delta = world?.ilgiGuncelle?.(ws);
      if (delta) frame(ws, 'state.delta', delta);
    } catch { /* ilgi guncellemesi kritik degil */ }
  }

  function varisBildir(ws, destId, dest, gold) {
    const params = { destId: String(destId), dest: String(dest) };
    if (gold > 0) params.gold = gold;
    frame(ws, 'sys.notice', {
      key: gold > 0 ? 'sys.teleport.arrived_paid' : 'sys.teleport.arrived',
      params,
    });
  }

  // ------------------------------------------------------------ isaretler
  function guvenliJson(s) {
    if (!s) return null;
    try {
      const o = JSON.parse(s);
      return o && typeof o.zone === 'string' ? o : null;
    } catch { return null; }
  }

  /**
   * dbo.WebCharMarks.CharID sutunu int. ch.id db.js:217'de `String(c.CharID)`
   * olarak uretiliyor (sayisal metin), ama JSON hesap deposundan gelen eski
   * karakterlerde GUID olabiliyor. NaN'i sql.Int'e vermek her yazimda hata
   * loglatiyordu - sistem_arayuz-durumu.js:274 charIdOf ile ayni kapi.
   */
  function sqlCharId(charId) {
    const n = Number(charId);
    return Number.isInteger(n) && n > 0 ? n : null;
  }

  /* WebCharMarks tablosu SRO_WEB_GAME'de HAZIR gelir (CharID/deathJson/
     retJson/updatedAt). `tpReadyAt` sonradan eklenen bir sutun - kalicilik.js
     WebCharInventory icin ayni kalibi kullaniyor (IF ... IS NULL CREATE).
     SADECE EKLEME: hicbir sey silmiyor/dusurmuyoruz. */
  let semaHazir = false;
  async function semaKur() {
    if (semaHazir || !web) return semaHazir;
    try {
      await web.request().query(`
        IF OBJECT_ID('dbo.WebCharMarks') IS NOT NULL
           AND COL_LENGTH('dbo.WebCharMarks', 'tpReadyAt') IS NULL
          ALTER TABLE dbo.WebCharMarks ADD tpReadyAt bigint NULL;`);
      semaHazir = true;
    } catch (e) {
      log(`donus-isinlanma: tpReadyAt sutunu eklenemedi - ${String(e.message).slice(0, 120)}`);
    }
    return semaHazir;
  }

  async function isaretYukle(charId) {
    if (ISARET.has(charId)) return ISARET.get(charId);
    let kayit = {};
    if (web && sqlCharId(charId) !== null) {
      await semaKur();
      try {
        const r = await web.request()
          .input('c', sql.Int, sqlCharId(charId))
          .query('SELECT deathJson, retJson, tpReadyAt FROM dbo.WebCharMarks WHERE CharID = @c');
        const row = r.recordset?.[0];
        const death = guvenliJson(row?.deathJson);
        const ret = guvenliJson(row?.retJson);
        if (death) kayit.death = death;
        if (ret) kayit.ret = ret;
        /* bigint mssql'de STRING gelir - Number()'a cevirmeden karsilastirma
           yapilirsa "1787493108022" > 1787493108022 metin karsilastirmasina
           duser. */
        const hazir = Number(row?.tpReadyAt ?? 0);
        if (Number.isFinite(hazir) && hazir > Date.now()) TP_HAZIR.set(charId, hazir);
        else TP_HAZIR.delete(charId);
      } catch (e) {
        log(`donus-isinlanma: isaret okunamadi (${charId}): ${String(e.message).slice(0, 100)}`);
      }
    }
    ISARET.set(charId, kayit);
    return kayit;
  }

  function isaretYaz(charId, kayit) {
    if (!web) return;
    const cid = sqlCharId(charId);
    if (cid === null) return;
    const hazir = Math.trunc(TP_HAZIR.get(charId) ?? 0);
    web.request()
      .input('c', sql.Int, cid)
      .input('d', sql.NVarChar(400), kayit.death ? JSON.stringify(kayit.death) : null)
      .input('r', sql.NVarChar(400), kayit.ret ? JSON.stringify(kayit.ret) : null)
      .input('tp', sql.BigInt, hazir > 0 ? hazir : null)
      .query(`MERGE dbo.WebCharMarks AS h
              USING (SELECT @c AS CharID) AS k ON h.CharID = k.CharID
              WHEN MATCHED THEN UPDATE SET deathJson = @d, retJson = @r,
                                           tpReadyAt = @tp, updatedAt = GETDATE()
              WHEN NOT MATCHED THEN INSERT (CharID, deathJson, retJson, tpReadyAt)
                                   VALUES (@c, @d, @r, @tp);`)
      .catch((e) => log(`donus-isinlanma: isaret yazilamadi (${charId}): ` +
                        String(e.message).slice(0, 100)));
  }

  /* ------------------------------------------------- taction bekleme defteri */

  /** Kalan bekleme (ms). 0 = hazir. */
  function tpKalan(charId) {
    const t = TP_HAZIR.get(charId) ?? 0;
    return Math.max(0, t - Date.now());
  }

  /** Isinlanma GERCEKLESTIGINDE cagrilir: sayaci kur ve diske yaz. */
  function tpBeklemeKur(charId) {
    if (charId == null) return;
    TP_HAZIR.set(charId, Date.now() + TACTION_BEKLEME_MS);
    isaretYaz(charId, ISARET.get(charId) ?? {});
  }

  /**
   * zone.init.self.actionCooldowns - sema BJ(X({key, readyAt})).optional()
   * (paket @25598051). Bekleme yoksa alani HIC gondermiyoruz: sema `.optional()`
   * ve istemcinin seedFromServer'i (paket @25080772) `arg_r ?? []` ile bos
   * listeyi zaten dogru ele aliyor.
   */
  function selfAlanlari(ch) {
    const charId = ch?.id;
    if (charId == null) return {};
    const t = TP_HAZIR.get(charId) ?? 0;
    if (!(t > Date.now())) return {};
    return { actionCooldowns: [{ key: 'teleport', readyAt: Math.trunc(t) }] };
  }

  /**
   * server.js modulleriYukle(ch) kancasi (server.js:1590) - zone.init'ten ONCE.
   * Isaretleri VE taction beklemesini ch'ye hazir eder; selfAlanlari() bunun
   * uzerine calisir. giris.js SOZ_VEREN tablosu taction.marks karesini bu
   * modulden bekliyor, o kare girisKurulumu() ile gidiyor.
   */
  async function yukle(ch) {
    if (ch?.id == null) return {};
    await isaretYukle(ch.id);
    return selfAlanlari(ch);
  }

  /** HER ZAMAN iki isareti birden yollar - istemcinin apply'i ikisini de ezer. */
  function isaretGonder(ws) {
    const kayit = ISARET.get(ws.char?.id) ?? {};
    const d = {};
    if (kayit.death) d.death = kayit.death;
    if (kayit.ret) d.ret = kayit.ret;
    frame(ws, 'taction.marks', d);
  }

  /**
   * Baglanti basina BIR KEZ: isaretleri (varsa) veritabanindan yukle ve
   * istemciye yolla. zone.ready'ye baglanamaz - istemci o mesaji GONDERMIYOR
   * (dosya basindaki denetim notuna bak), bu yuzden tik tetikliyor.
   */
  function girisKurulumu(ws) {
    const ch = ws.char;
    if (!ch || ch.id == null) return;
    isaretYukle(ch.id)
      .then(() => { if (acik(ws)) isaretGonder(ws); })
      .catch(() => {});
  }

  function isaretKur(ws, tur, isaret) {
    const charId = ws.char?.id;
    if (charId == null) return;
    const kayit = ISARET.get(charId) ?? {};
    kayit[tur] = isaret;
    ISARET.set(charId, kayit);
    isaretYaz(charId, kayit);
    isaretGonder(ws);
  }

  // ------------------------------------------------------- kanalizasyon
  function kanalBasla(ws, tur, sure, hedefZone, hedef, destId, dest, isaret, yaricap) {
    AKTIF.set(ws, {
      tur, biter: Date.now() + sure, hedefZone, hedef, destId, dest,
      isaret: isaret ?? null, yaricap: yaricap ?? 0,
    });
    frame(ws, 'return.begin', { durationMs: sure, kind: tur });
    frame(ws, 'fx.returnStart', { id: ws.entityId });
    broadcast(ws.zoneId, 'fx.returnStart', { id: ws.entityId }, ws);
  }

  function kanalBitir(ws, tamamlandi) {
    AKTIF.delete(ws);
    if (!acik(ws)) return;
    frame(ws, 'fx.returnStop', { id: ws.entityId, done: !!tamamlandi });
    broadcast(ws.zoneId, 'fx.returnStop', { id: ws.entityId, done: !!tamamlandi }, ws);
    frame(ws, 'return.end', {});
  }

  function kanalTamamla(ws, k) {
    /* Once "gitti" efekti (cikis noktasinda), sonra tasima. */
    kanalBitir(ws, true);
    if (!acik(ws)) return;
    if (k.tur === 'return' && k.isaret) isaretKur(ws, 'ret', k.isaret);

    /* BEKLEME SAYACI ISINLANMA GERCEKLESINCE baslar, istek gelince DEGIL:
       kanal iptal edilirse (return.cancel / hasar / olum) oyuncu 1 dakika
       cezalandirilmis olmamali. `return` kanali bu beklemenin disinda -
       tr.json'daki 1 dk yalnizca `ui.actions.teleport` (taction) icin yazili;
       return'un kendi bekleme suresine dair KAYNAK YOK, o yuzden koymuyoruz. */
    if (k.tur === 'teleport' && ws.char?.id != null) tpBeklemeKur(ws.char.id);
    /* NOT: beklemeyi ANINDA istemciye itecek bir s2c karesi YOK. Paketin
       194 s2c karesi tarandi; actionCooldowns yalnizca zone.init.self icinde
       geciyor ve istemci onu SADECE zY.seedFromServer ile tohumluyor
       (paket @25080772 / cagri @27117972). Bolge DEGISTIREN isinlanmada yeni
       bir zone.init gittigi icin sayac dogru gorunur (23 harita noktasinin
       yalnizca 3'u ayni bolgede). Ayni bolge icindeki isinlanmada istemcinin
       cipi gec kalir ama SUNUCU kapisi calisir: ikinci denemede
       err.teleport.cooldown gider. UYDURMA kare gondermiyoruz. */

    /* BASKA BOLGEYE kanalize edildiyse tasima capraz gecistir.
       (Kanal boyunca oyuncu yer degistirmis olabilir; k.hedefZone'u
       ws.zoneId ile HER ZAMAN yeniden karsilastiriyoruz.) */
    if (k.hedefZone && k.hedefZone !== ws.zoneId) {
      capraziDene(ws, k.hedefZone, varisNoktasi(k.hedefZone, k.hedef, k.yaricap),
                  k.destId, k.dest, 0);
      return;
    }
    isinla(ws, varisNoktasi(ws.zoneId, k.hedef, k.yaricap));
    varisBildir(ws, k.destId, k.dest, 0);
  }

  // -------------------------------------------------------- capraz bolge
  /**
   * Bolgeler arasi gecis mumkun mu? (Kanalizasyonu bosuna baslatmamak icin
   * ONCEDEN sorulur - 5 sn bekleyip "olmadi" demek kotu.)
   */
  function capraziMumkun() {
    if (typeof ctx.bolgeGecisi === 'function') return true;
    if (!capraziUyardik) {
      capraziUyardik = true;
      log('donus-isinlanma: bolgeler arasi isinlanma KAPALI - ' +
          'server.js ctx.bolgeGecisi(ws, zoneId, hedef) gecirmeli');
    }
    return false;
  }

  /**
   * Baska bir bolgeye gecis. Bu modul ws.zoneId'yi TEK BASINA degistiremez:
   * server.js'teki `zones` Map'i (broadcast kumesi) ctx ile gelmiyor. server.js
   * baglarken ctx.bolgeGecisi(ws, yeniZoneId, hedef) verirse gecis calisir,
   * vermezse hedef reddedilir (sessizce yanlis yere isinlamak yerine).
   *
   * server.js'teki karsiligi `zone.transfer`(132) + yeniden `zone.init`(131)
   * yolluyor ve BOOLEAN doner: hedef bolge bilinmiyorsa false. Eskiden donus
   * degeri YOK SAYILIYORDU - basarisiz gecisten sonra bile "isinlandin"
   * bildirimi gidiyor ve ucret tahsil ediliyordu.
   */
  function capraziDene(ws, yeniZone, hedef, destId, dest, gold) {
    if (!capraziMumkun()) { hata(ws, KOD.yok); return false; }
    if (ctx.bolgeGecisi(ws, yeniZone, hedef) === false) { hata(ws, KOD.yok); return false; }
    varisBildir(ws, destId, dest, gold);
    return true;
  }

  // ------------------------------------------------------------ mesajlar
  function donusBasla(ws) {
    const ch = ws.char;
    if (!ch) return true;
    if (ch.dead) { hata(ws, KOD.olu, ANAHTAR.olu); return true; }
    if (AKTIF.has(ws)) { hata(ws, KOD.mesgul, 'err.busy.returning'); return true; }

    const z = world?.worldData?.zones?.[ws.zoneId];
    const sp = z?.respawnPoint ?? z?.playerSpawn;
    if (!sp) {
      log(`donus-isinlanma: ${ws.zoneId} icin respawnPoint yok`);
      hata(ws, KOD.yok);
      return true;
    }
    /* `respawnZone` bolge semasinda GERCEKTEN var (@8713499:
         respawnPoint: CY, respawnZone: J().optional()
       ) - bir bolgenin dogum noktasi BASKA bolgede olabilir. Bu dunyada
       hicbir bolgede dolu degil (5/5 undefined), o yuzden pratikte hep
       ws.zoneId'ye duser; yine de veriye uyuyoruz, gormezden gelmiyoruz. */
    const donusZone = (typeof z?.respawnZone === 'string' && world?.worldData?.zones?.[z.respawnZone])
      ? z.respawnZone : ws.zoneId;
    if (donusZone !== ws.zoneId && !capraziMumkun()) { hata(ws, KOD.yok); return true; }
    kanalBasla(
      ws, 'return', DONUS_MS, donusZone,
      { x: sp.x, z: sp.z, y: sp.y },
      donusZone, bolgeAdi(donusZone),
      isaretYap(ws.zoneId, ch),          // "Return attigin yer" = CIKIS noktasi
      0,
    );
    /* KISA DEVRE: sure <= 0 ise bir sonraki tiki (100ms) beklemeden AYNI
       pakette tamamla - tum kareler (return.begin/fx.returnStart/
       fx.returnStop/return.end/entity.teleport) birlikte gider, istemcide
       donus cubugu fiilen hic gorunmez. Kisa devresiz de calisirdi ama cubuk
       bir tik boyunca %100 dolu gorunebilirdi (durationMs=0 -> Infinity ->
       Math.min 100; NaN/cokme yok - kozmetik). MUTLAKA kanalTamamla
       uzerinden: entity.teleport yollayan her yol once ch.bacak'i silmeli
       (gameloop.js MADDE 4 notu), kanalTamamla->isinla bunu zaten yapiyor. */
    if (DONUS_MS <= 0) { kanalTamamla(ws, AKTIF.get(ws)); return true; }
    return true;
  }

  function donusIptal(ws) {
    if (!AKTIF.has(ws)) return true;      // istemci cubugu kendi de temizliyor
    kanalBitir(ws, false);
    return true;
  }

  function tactionBasla(ws, d) {
    const ch = ws.char;
    if (!ch) return true;
    const presetId = String(d?.presetId ?? '');
    if (!presetId) { hata(ws, KOD.dogrulama); return true; }
    if (ch.dead) { hata(ws, KOD.olu, ANAHTAR.olu); return true; }
    if (AKTIF.has(ws)) { hata(ws, KOD.mesgul, 'err.busy.returning'); return true; }
    if (ws.savas) { hata(ws, KOD.mesgul, 'err.teleport.in_combat'); return true; }

    /* Premium kapisi (sartname madde 14): istemci bu pencereyi premium yoksa
       hic acmiyor (@27043514 `if (!self?.premiumTier || (self.premiumExpiresAt
       ?? 0) <= Date.now()) { pushSys('err.premium.required'); break; }`);
       taction.teleport gonderen iki yer de (@27631604 pencere, @27097230
       harita) bu kapinin arkasinda -> sunucu kapisi bos kalirsa ham paket
       ISTISMAR yuzeyi olur. Premium sistemi sistem_kucuk-sistemler'de VAR ve
       premiumTier(ws) API'si disa acik (WebPremium defteri, JID bazli).
       ESKI hasOwnProperty(ch,'premiumTier') kapisi yerine TEK GERCEK KAYNAK
       API kullanilir: ch aynasi (D5-A premiumKaraktereYansit) gec dolarsa
       yanlis dala girilmesin. err.premium.required data/schemas.json err.key
       enum'unda mevcut. */
    if (!ctx.sistemOrnegi?.('kucuk-sistemler')?.premiumTier?.(ws)) {
      hata(ws, KOD.mesgul, 'err.premium.required');
      return true;
    }

    /* BEKLEME KAPISI - tr.json `ui.actions.teleport_desc` ("1 dk bekleme
       suresi") + `err.teleport.cooldown` ("... {secs} sn kaldi").
       {secs} SANIYE ve YUKARI yuvarlaniyor: 0.4 sn kalanda "0 sn kaldi"
       yazsaydi istemci hazir sanip tekrar denerdi. */
    const kalan = tpKalan(ch.id);
    if (kalan > 0) {
      hata(ws, KOD.mesgul, 'err.teleport.cooldown', { secs: Math.ceil(kalan / 1000) });
      return true;
    }

    let hedefZone, pos, dest, yaricap = 0;
    if (presetId === 'last_death' || presetId === 'last_return') {
      const kayit = ISARET.get(ch.id) ?? {};
      const m = presetId === 'last_death' ? kayit.death : kayit.ret;
      if (!m) { hata(ws, KOD.yok, 'err.taction.no_mark'); return true; }
      hedefZone = m.zone;
      pos = { x: m.x, z: m.z, y: m.y };
      dest = bolgeAdi(m.zone);
    } else {
      const p = PRESET.get(presetId);
      if (!p?.pos) { hata(ws, KOD.yok, 'err.taction.no_mark'); return true; }
      hedefZone = p.zone;
      pos = p.pos;
      dest = p.label ?? presetId;
    }

    /* Bolge degisiyorsa gecis KANCASI olmadan kanalize etmenin anlami yok:
       5 sn bekletip sonra "olmadi" demek yerine HEMEN reddet. Kanca varsa
       ayni bolgedeki hedeflerle AYNI cubuk calisir - istemcinin taction
       cubugu zaten kind:`teleport` ile bu ikisini ayirmiyor.
       (23 harita noktasinin yalnizca 3'u Jangan icinde; capraz olanlari
       aninda isinlatmak ayni pencerede iki ayri davranis demekti.) */
    if (hedefZone !== ws.zoneId && !capraziMumkun()) { hata(ws, KOD.yok); return true; }
    kanalBasla(ws, 'teleport', TACTION_MS, hedefZone, pos, presetId, dest, null, yaricap);
    return true;
  }

  function isinlayiciKullan(ws, d) {
    const ch = ws.char;
    if (!ch) return true;
    if (ch.dead) { hata(ws, KOD.olu, ANAHTAR.olu); return true; }
    if (AKTIF.has(ws)) { hata(ws, KOD.mesgul, 'err.busy.returning'); return true; }

    /* Istemci `tp_` onekini kendisi soyuyor (npcId.slice(3)); yine de
       tolere ediyoruz ki her iki bicim de calissin. */
    const ham = String(d?.teleporterId ?? '');
    const tpId = ham.startsWith('tp_') ? ham.slice(3) : ham;
    const destId = String(d?.destId ?? '');
    if (!tpId || !destId) { hata(ws, KOD.dogrulama); return true; }

    const tp = ISINLAYICI.get(ws.zoneId)?.get(tpId);
    if (!tp) { hata(ws, KOD.yok); return true; }

    const menzil = sayi(tp.interactRangeU, NPC_MENZIL);
    if (Math.hypot(tp.x - ch.x, tp.z - ch.z) > menzil) { hata(ws, KOD.menzil); return true; }

    const hedef = (tp.destinations ?? []).find((x) => x.id === destId);
    if (!hedef?.toPos) { hata(ws, KOD.yok); return true; }

    /* minLevel/maxLevel istemci semasinda var; bu paketin verisinde HIC
       kullanilmamis (44 hedefin hicbirinde yok). Yine de varsa uygulariz. */
    if (hedef.minLevel != null && ch.level < hedef.minLevel) { hata(ws, KOD.seviye); return true; }
    if (hedef.maxLevel != null && ch.level > hedef.maxLevel) { hata(ws, KOD.seviye); return true; }

    const ucret = sayi(hedef.costGold, 0);
    if ((ch.gold ?? 0) < ucret) { hata(ws, KOD.altin); return true; }

    const etiket = hedef.label ?? hedef.id;
    if (hedef.toZone && hedef.toZone !== ws.zoneId) {
      const varis = varisNoktasi(hedef.toZone, hedef.toPos, sayi(hedef.arrivalRadiusU, 0));
      /* UCRET GECISTEN ONCE DUSULUR. Capraz gecis yeniden `zone.init`
         yolluyor ve o karenin ICINDE self.inventory.gold var; once dusmezsek
         istemci once ESKI altini gorup sonra inv.update ile duzeltiyor
         (gorsel zipzip). Gecis reddedilirse para geri verilir. */
      if (ucret > 0) ch.gold -= ucret;
      if (!capraziDene(ws, hedef.toZone, varis, hedef.id, etiket, ucret)) {
        if (ucret > 0) ch.gold += ucret;
        return true;
      }
      if (ucret > 0 && envanterPayload) frame(ws, 'inv.update', envanterPayload(ch));
      return true;
    }

    if (ucret > 0) {
      ch.gold -= ucret;
      if (envanterPayload) frame(ws, 'inv.update', envanterPayload(ch));
    }
    isinla(ws, varisNoktasi(ws.zoneId, hedef.toPos, sayi(hedef.arrivalRadiusU, 0)));
    varisBildir(ws, hedef.id, etiket, ucret);
    return true;
  }

  // ----------------------------------------------------------------- tik
  function tik() {
    const simdi = Date.now();

    /* 1) Giris kurulumu + olum isareti. Olum gameloop.js:700'de isleniyor
          (ws.char.dead = true, konum DEGISMIYOR) ve o dosyaya DOKUNMUYORUZ;
          bu yuzden dead bayragini burada kenar-yakalama ile izliyoruz. */
    for (const z of world?.zoneState?.values?.() ?? []) {
      for (const ws of z.players ?? []) {
        const ch = ws.char;
        if (!ch) continue;

        if (!KURULDU.has(ws)) {
          KURULDU.add(ws);
          /* Oturumu OLU acan oyuncu YENI olmus sayilmamali; yoksa ilk tik
             death isaretini bulundugu yere ezerdi (ve bosuna DB'ye yazardi). */
          OLU_IZ.set(ws, !!ch.dead);
          girisKurulumu(ws);
        }

        const onceki = OLU_IZ.get(ws) ?? false;
        const simdiOlu = !!ch.dead;
        if (simdiOlu && !onceki) {
          const kayit = ISARET.get(ch.id) ?? {};
          kayit.death = isaretYap(ws.zoneId, ch);
          ISARET.set(ch.id, kayit);
          isaretYaz(ch.id, kayit);
          if (acik(ws)) isaretGonder(ws);
          if (AKTIF.has(ws)) kanalBitir(ws, false);   // olurken kanalize edilemez
        }
        OLU_IZ.set(ws, simdiOlu);
      }
    }

    /* 2) Kanalizasyonlar. */
    for (const [ws, k] of [...AKTIF]) {
      if (!acik(ws)) { AKTIF.delete(ws); continue; }
      if (ws.char.dead) { kanalBitir(ws, false); continue; }
      if (simdi >= k.biter) kanalTamamla(ws, k);
    }
  }

  const zamanlayici = setInterval(() => {
    try { tik(); } catch (e) { log('donus-isinlanma tik hatasi:', String(e.message).slice(0, 120)); }
  }, TIK_MS);
  zamanlayici.unref?.();

  // -------------------------------------------------------------- disari
  const ORNEK = {
    /** Ilgilenmedigimiz mesajda FALSE - yonlendirici digerlerini dener. */
    mesaj(ws, t, d) {
      switch (t) {
        case 'return.start':      return donusBasla(ws);
        case 'return.cancel':     return donusIptal(ws);
        case 'taction.teleport':  return tactionBasla(ws, d);
        case 'teleport.use':      return isinlayiciKullan(ws, d);

        /* SADECE DINLIYORUZ: isaretleri yolla ama mesaji TUKETME - server.js'in
           zone.ready dali env.clock gondermeye devam etmeli.
           NOT: istemci bu mesaji GONDERMIYOR (dosya basindaki denetim notu);
           gercek kurulum tik icindeki girisKurulumu() ile yapiliyor. Bu dal
           yalnizca ileriye donuk uyumluluk icin duruyor. */
        case 'zone.ready':
          if (ws.char) { KURULDU.add(ws); girisKurulumu(ws); }
          return false;

        default: return false;
      }
    },

    /** server.js modulleriYukle(ch) - zone.init'ten ONCE (isaret + bekleme). */
    yukle,
    /** selfPayload'a yayilir: actionCooldowns (varsa). */
    selfAlanlari,

    /** Baglanti kapaninca cagrilabilir (zorunlu degil; tik zaten temizler). */
    ayril(ws) {
      AKTIF.delete(ws);
      /* Isaretler DB'de duruyorsa RAM kopyasini birak - uzun omurlu sunucuda
         ISARET haritasi aksi halde hic kuculmez. web yoksa TEK kopya budur,
         o zaman saklamaya devam ederiz.
         BEKLEME de ayni kurala tabi: DB'de duruyorsa RAM'den dusebilir,
         yukle() bir sonraki giriste geri okur. */
      const id = ws?.char?.id;
      if (web && id != null && sqlCharId(id) !== null) { ISARET.delete(id); TP_HAZIR.delete(id); }
    },

    /** Test/kapanis icin. */
    dur() { clearInterval(zamanlayici); },

    /** Test/tani icin - dis dunya kullanmaz. */
    _durum: { PRESET, ISINLAYICI, ISARET, AKTIF, KURULDU, DONUS_MS, TACTION_MS,
              TP_HAZIR, TACTION_BEKLEME_MS },
    _tpKalan: tpKalan, _tpBeklemeKur: tpBeklemeKur,
  };
  ONCEKI_ORNEK = ORNEK;
  return ORNEK;
}

/* =============================================================================
 * BAGLAMA NOTU  (server.js icin)  - DENETIMDE GUNCELLENDI
 * -----------------------------------------------------------------------------
 * 1) BAGLANTI ZATEN HAZIR. server.js artik jenerik bir yukleyici kullaniyor:
 *      server.js:693  const SISTEM_ADLARI = [... 'donus-isinlanma' ...]
 *      server.js:704  mod.kur({ world, combat, frame, broadcast, log, GCFG,
 *                               ITEMSTATS, zoneGroundY, yurunebilirNokta,
 *                               envanterPayload, derived, SHARD, web: null })
 *      server.js:829  for (const s of SISTEMLER) if (s.ornek.mesaj(ws,t,d)) return;
 *    Modul bu listede ZATEN var; elle import/dispatch EKLEMEYE GEREK YOK.
 *
 *    Ama iki nokta hala EKSIK (ikisi de server.js'te, bu modulde degil):
 *
 *    (a) `web: null` geciliyor -> isaretler DB'ye HIC yazilmiyor, sunucu
 *        yeniden baslayinca last_death/last_return kayboluyor. dbo.WebCharMarks
 *        tablosu SRO_WEB_GAME'de MEVCUT (CharID int PK, deathJson nvarchar(400),
 *        retJson nvarchar(400), updatedAt datetime) - sadece havuz gecilmiyor.
 *        server.js:188'deki `const webPool` try blogunun ICINDE kaldigi icin
 *        satir 707'de kapsamda degil. Havuzu disari alip `web: webPool` gecin.
 *
 *    (b) ws.on('close') icinde istege bagli:  DONUS.ayril(ws);
 *        (jenerik yukleyici cagirmiyor; cagirilmazsa da tik temizler)
 *
 * 2) ctx'ten KULLANDIKLARIM:
 *      world  -> worldData.zones[*].respawnPoint / playerSpawn / teleporters / name,
 *                zoneState (olum isareti icin oyuncu listesi), ilgiGuncelle, dataDir
 *      frame, broadcast, log, GCFG (npcInteractRangeU, tickHz, returnChannelMs?),
 *      zoneGroundY, yurunebilirNokta, envanterPayload, web (SRO_WEB_GAME havuzu)
 *    KULLANMADIKLARIM: combat, ITEMSTATS, SHARD, derived.
 *
 * 3) ISLENEN MESAJLAR: return.start(83), return.cancel(84), taction.teleport(86),
 *    teleport.use(82). AYRICA zone.ready(81) DINLENIR ama FALSE doner (tuketmez)
 *    - istemci onu GONDERMEDIGI icin giris kurulumu tik'e tasindi (bkz. bas not).
 *    sistem_gorev.js de zone.ready'yi ayni sekilde peek edip false donuyor;
 *    yukleyici sirasinda catisma YOK.
 *
 * 4) GONDERILEN S2C KARELERI:
 *      return.begin(193) {durationMs, kind:'return'|'teleport'}
 *      return.end(194) {}
 *      fx.returnStart(191) {id}            (oyuncuya + bolgeye)
 *      fx.returnStop(192) {id, done}       (oyuncuya + bolgeye)
 *      entity.teleport(136) {id,x,z,y}     (oyuncuya + bolgeye)
 *      taction.marks(215) {death?, ret?}   (her zaman IKISI birden)
 *      sys.notice(195) {key:'sys.teleport.arrived'|'...arrived_paid', params:{destId,dest,gold?}}
 *      inv.update(149) envanterPayload(ch) (yalnizca ucretli isinlayicida)
 *      state.delta(133) {add?,rem?}        (isinlanma sonrasi ilgi tazeleme)
 *      err(240) {code, key?}               (kodlar Sht, anahtarlar Eht listesinden)
 *
 * 5) YENI VERI DOSYALARI (paketten cikarildi, uydurulmadi):
 *      data/teleport-presets.json  <- GERCEK/paket_veri/config/teleport-presets.json (birebir)
 *      data/teleporters.json       <- GERCEK/paket_veri/zones/<bolge>.json teleporters[]
 *                                     (7 bolge / 35 isinlayici / 50 hedef)
 *
 * 6) [COZULDU] server.js zoneNpcEntities() isinlayicilari `npcId: t.id` ile
 *    yolluyordu. Istemci (Kgt, bayt 25685670) bir NPC'yi ancak
 *    `npcId.startsWith('tp_')` ise isinlayici sayiyor ve `npcId.slice(3)` ile
 *    ariyor; imlec de ayni kapiya bakiyor (dgt, bayt 25678584). Onek olmadigi
 *    icin isinlayici kapilarina tiklandiginda istemci PENCEREYI HIC ACMIYOR,
 *    `teleport.use` (82) hic gonderilmiyor, dolayisiyla `zone.transfer` (132)
 *    da hic uretilmiyordu. server.js artik `npcId: \`tp_${t.id}\`` yolluyor.
 *
 * 6b) [COZULDU] ctx.bolgeGecisi ARTIK GECILIYOR (server.js sistemCtx()).
 *    Sunucu tarafi akis - istemci paketinden (bayt 27117640) cikarildi:
 *        zone.transfer { zoneId }     -> istemci W5() + kkt(zoneId): kisayol
 *                                        cubugunu bosaltir, YENI bolgenin
 *                                        .bin/varlik dosyalarini on-yukler.
 *                                        wsUrl+ticket GONDERILMEDIGI icin
 *                                        BAGLANTI KOPMAZ.
 *        zone.init     { ... }        -> ayni soket uzerinden tam anligorunum;
 *                                        istemci applyZoneInit icinde
 *                                        reset() ile tum varliklari siler
 *                                        (bayt 25659057) ve sifirdan kurar.
 *    Yani ayni oturumda bolge degistirmek icin YENI BAGLANTI GEREKMIYOR.
 *    ctx.bolgeGecisi BOOLEAN doner; false ise ucret geri verilir ve
 *    ERR_NOT_FOUND yollanir.
 *
 * 6c) KAPILAR (gates): bolge semasinda `gates: BJ(X({id,x,z,y?,radiusU,toZone,toPos}))`
 *    var (bayt 8713499) ama 5 GERCEK bolgenin HEPSINDE `gates: []`. Istemci
 *    kapiyi zaten kendiliginden tetiklemiyor - pakette `gates` sadece
 *    dogrulamada (bayt 25050690) ve zemine disk cizmede (bayt 26998127)
 *    kullaniliyor, "kapiya girdim" diye bir c2s mesaji YOK. Tetikleme
 *    SUNUCUDA: server.js kapiTik() yaricap kontrolu yapiyor, KAPILAR bossa
 *    hic calismiyor. Bu dunyada bolge gecisi TAMAMEN isinlayici NPC'lerle.
 *
 * 7) SURE: pakette YOK (dosya basindaki uzun nota bak). game-config.json'a
 *    "returnChannelMs" / "tactionChannelMs" eklenirse oradan okunur.
 * ===========================================================================*/
