/**
 * sistem_meslek.js — meslekler ve kaynak toplama
 *
 * Islenen c2s mesajlari (opcode + hiz sinifi paketten birebir):
 *    35  profession.learn    `progression`
 *    41  profession.scroll   `progression`
 *    36  gather.start        `combat`
 *    37  gather.cancel       `combat`
 *
 * ------------------------------------------------------------------ SEMA KAYNAGI
 * Hepsi okunabilir istemci paketinden ALINDI, hicbiri uydurulmadi:
 *   playjs_source\index-BUMMQVRB.js
 *
 *   ofset 25632805  T$(`profession.learn`, 35, X({ npcId:J(), professionId:J() }), `progression`)
 *   ofset 25632890  T$(`gather.start`,     36, X({ nodeId:Y().int() }),            `combat`)
 *   ofset 25632952  T$(`gather.cancel`,    37, X({}),                              `combat`)
 *   ofset 25633389  T$(`profession.scroll`,41, X({ bagSlot:Y().int().min(0).max(159) }), `progression`)
 *
 * Ilgili s2c kareleri (ayni blok, 25632990..25633389):
 *   207 profession.update  X({ professions: BJ(ght) })
 *   208 gather.action      X({ id:Y().int(), nodeId:Y().int(),
 *                              anim:qJ([`cut`,`mine`]), swingMs:Y().int().positive() })
 *   209 gather.end         X({ id:Y().int() })
 *   210 gather.yield       X({ nodeId:Y().int(),
 *                              items:BJ(X({ itemId:J(), qty:Y().int().positive() })),
 *                              xp:Y().int().nonnegative() })
 *
 *   ofset 25597196  ght = X({ id:J(), level:Y().int(), xp:Y().int(),
 *                             xpToNext:Y().int().nullable() })
 *                   -> xpToNext OPSIYONEL DEGIL, nullable: her zaman gonderilir.
 *   ofset 25597430  _ht (zone.init.self) icinde `professions: BJ(ght).optional()`
 *   ofset 25592830  varlik semasi $mt icinde:
 *                     nodeGrade: J().optional()
 *                     gathering: X({ nodeId:Y().int(), anim:qJ([`cut`,`mine`]),
 *                                    swingMs:Y().int().positive() }).optional()
 *
 * Zod takma adlari (paketten): X=object Y=number J=string BJ=array
 *                              qJ=enum JJ=literal RJ=boolean GJ=record VJ=union
 *
 * --------------------------------------------------------- ISTEMCI DAVRANISI (gercek)
 *
 * 1) DUGUM = NPC VARLIGI. Istemci ayri bir "gather node" turu BILMIYOR:
 *      ofset 25678103  case `npc`: node.npcId?.startsWith(`node_`) -> { t:`gather` }
 *      ofset 25679332  npcId `node_` ile basliyorsa imlec `pick`
 *    Dugum tanimi ve modeli ADDAN cozulur:
 *      ofset 25689684  gatherNodesById.get(vec.npcId?.slice(5))   -> `tree` / `rock`
 *      ofset 27012687  vec.modelKey.startsWith(`node_`), modelKey.slice(5) -> GLB adi
 *    Yani sunucu sunu gondermeli:
 *      npcId    = `node_` + nodes[].id        (node_tree / node_rock)
 *      modelKey = `node_` + nodeModels...     (node_env_tre_tree01_big ...)
 *      nodeGrade= grades[].id                 (glow rengi = tint, ofset 26683725)
 *
 * 2) TOPLAMA ANIMASYONU dongusel tek karedir:
 *      ofset 27121566  W$.on(`gather.action`, n => Q.applyGather({id:n.id, clip:n.anim}))
 *                      W$.on(`gather.end`,    n => Q.applyGather({id:n.id, clip:null}))
 *    `id` TOPLAYANIN varlik id'si (dugumun degil). Bu yuzden action/end
 *    bolgeye yayinlanir (baskalari da vurusu gorsun), yield sadece toplayana gider.
 *
 * 3) `gather.yield` sohbet satirini ISTEMCI yazar:
 *      for (item of items) pushSys(`sys.profession.gathered`, {item, qty, xp})
 *    Sunucu ayrica sys.notice GONDERMEZ - yoksa satir iki kez cikar.
 *
 * 4) ISTEMCI ON-KONTROLU (ofset 25689684) meslek/alet yoksa mesaji HIC yollamaz,
 *    ama menzil icin yalnizca `predictSelfMove` yapip mesaji YINE DE yollar.
 *    Bu yuzden menzil kontrolu SUNUCUDA yapilir (gather.rangeU = 4).
 *
 * 5) HAREKET TOPLAMAYI IPTAL EDER - istemci de boyle yapiyor:
 *      ofset 27038242  Q.self()?.gathering && W$.send(`gather.cancel`, {})
 *    Ama kendi istemcisine guvenmiyoruz: `move.click` gorulunce (mesaj yine de
 *    cekirdege birakilir, false donuyoruz) VE her tikte ws.char.bacak / mesafe
 *    kontrol edilerek toplama kesilir.
 *
 * ---------------------------------------------------------------- VERI KAYNAKLARI
 *   data/professions.json              (paket_veri/config/professions.json kopyasi)
 *   data/gather-node-placements.json   (74 el yerlestirmesi: 49 jangan + 25 europe)
 *   data/extra-items.json              (malzemeler, alet silahlari, meslek parsomenleri)
 *   ../client/assets/zones/<zone>/statics.json   (convertMapStatics: agaclar)
 *   data/game-config.json -> professionXpRate (=1)
 *
 *   DIKKAT: data/itemstats.json (ctx.ITEMSTATS, 2860 esya) meslek esyalarini
 *   ICERMEZ - wood_01..05 / stone_01..05 / profession_axe / profession_pickaxe /
 *   profession_scroll_* yalnizca extra-items.json'da. Bu yuzden modul kendi
 *   esya cozumlemesini yapar: once ITEMSTATS, sonra extra-items.
 *
 * ------------------------------------------------------------------- KALICILIK
 *   SRO_WEB_GAME.dbo.WebCharProfession (CharID, ProfessionID, Lvl, Xp, ...)
 *   + dbo.WebGetCharProfessions @CharID
 *   + dbo.WebSaveCharProfession @CharID,@ProfessionID,@Lvl,@Xp
 *   Bu ucu `kur_meslek_semasi.mjs` olusturur (calistirildi). Hazir 30 yordamin
 *   hicbiri meslek tutmuyordu; SHARD._CharTrijob vSRO'nun tuccar/hirsiz isi,
 *   referans oyunun toplayici/zanaatkar meslegi DEGIL.
 *
 *   ctx.web verilmezse modul kendi mssql havuzunu config.json'dan acar
 *   (tembel, hatada sessizce bellek-ici moda duser).
 *
 * ------------------------------------------------------------------ DENETIM (2026-08-23)
 * Bagimsiz denetimde bulunup DUZELTILEN 7 hata (regresyon: _denetim_meslek.mjs):
 *   1) cantayaEkle ATOMIK DEGILDI - sigmayinca yarim ekleyip false donuyordu;
 *      vurus() ERR_BAG_FULL basip inv.update GONDERMEDIGI icin envanter sessizce
 *      kayiyordu (sunucu 1000, istemci 999). Artik once kapasite sayiliyor.
 *   2) kur() YENIDEN CAGRILABILIR (server.js sistemleriKur, admin ayar degisimi):
 *      eski setInterval kapanmiyor, 887 dugum yeni entity id ile bir daha
 *      uretiliyor ve istemcide her agac IKI KOPYA cikiyordu. Modul kapsaminda
 *      tekillik + dugum onbellegi eklendi.
 *   3) gather.start SPAM: istemci her tiklamada gonderiyor; her tekrar bolgeye
 *      entity.stop + gather.end + gather.action yayinlayip `sonrakiVurus`i
 *      sifirliyordu -> hizli tiklayan oyuncunun vurusu HIC tamamlanmiyordu.
 *      Ayni dugum icin gelen tekrar artik sessizce sahipleniliyor.
 *   4) GOZLEMCI SENKRONU: gather.action yalnizca baslangicta yayinlaniyordu,
 *      toplama suruyorken ilgi alanina giren oyuncu hareketsiz bir karakter
 *      goruyordu (cekirdegin state.delta.add govdesinde `gathering` alani yok).
 *      Her vuruste yeniden yayinlaniyor; istemcide bedava: setGathering
 *      (ofset 26623050) `if (gathering !== yeniKlip)` ile ayni klipte no-op.
 *   5) ERR_DEAD anahtarsiz gonderiliyordu; `err.ERR_DEAD` tr.json'da YOK, bu
 *      yuzden olu oyuncuya HICBIR satir basilmiyordu (istemci err isleyicisi
 *      ofset 27134276: `b2(key)` yoksa sessizce yutuyor). key='err.busy.downed'
 *      eklendi (hem Eht enum'unda hem tr.json'da var).
 *   6) DB YARISI: yuklemeTik `ch.meslekler = kayitlar` diye duz ATIYORDU;
 *      SELECT ucarken ogrenilen meslek bellekten siliniyordu. Artik birlestirme.
 *   7) profession.learn MENZILI sabit 25 idi; istemcinin gercek kapisi PER-NPC
 *      (Ict, ofset 25041275) ve config/interact-radii.json'dan sroCode ile
 *      geliyor (ofset 25059627): 8 egitmenin 7'si 15, npc_ch_special2 18.25.
 *      Gate artik ayni zincirle cozuluyor.
 *
 * Denetimde KONTROL EDILIP DOGRU BULUNANLAR (degistirilmedi):
 *   - 4 c2s / 4 s2c semasi paketle BIREBIR (bayt ofsetleri dogrulandi).
 *   - xpSonraki() istemcinin professionXpToNext'i ile ayni formul.
 *   - 887 dugumun HEPSININ modelKey'i istemcide kayitli (ofset 26682247) ve
 *     813 agacin sKey'i statics.json ile birebir (A6, ofset 26761929) - yani
 *     istemci alttaki harita agacini dogru sekilde gizleyebiliyor.
 *   - SRO_WEB_GAME.WebCharProfession/WebGetCharProfessions/WebSaveCharProfession
 *     canli veritabaninda MEVCUT ve calisiyor (ctx.web=null yolu dogrulandi).
 *   - Modul HICBIR dosyaya yazmiyor, cekirdek dosyalarin hicbirine dokunmuyor.
 *
 * BILINEN SINIR (cekirdek dosyaya dokunmadan kapanmiyor):
 *   server.js entityPayload'i `gathering` alanini gondermiyor, zone.init.self
 *   icindeki `professions` ise sabit []. Ikisi de telafi edildi (girisin
 *   ardindan 207, her vuruste gather.action yayini) ama tam cozum server.js'te
 *   iki satirlik bir eklemedir - bu modulun yetkisi disinda.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bacakDurdur } from './bacak.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, 'data');
/* Kopya yoksa cikarilmis paket verisine dus. */
const PAKET = path.join(HERE, '..', '..', 'GERCEK', 'paket_veri', 'config');
const ZONE_VARLIK = path.join(HERE, '..', 'client', 'assets', 'zones');

/* Gorus mesafeleri world.js ile AYNI olmali, yoksa dugumler canavarlardan
   farkli bir yaricapta belirip kayboluyor (world.js: 120 / 120 histerezis 150). */
const GORUS_U = 120;
const GORUS_BIRAKMA_U = 150;

const TIK_MS = 250;          // toplama vurusu / iptal kontrolu
const ILGI_TIK = 2;          // her 2 tikte bir (500 ms) dugum ilgi alani
const SQL_PENCERE_MS = 3000; // meslek TP yazimi bu pencerede birlestirilir

// ---------------------------------------------------------------- yardimcilar

function json(...adaylar) {
  for (const p of adaylar) {
    try { if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8')); }
    catch { /* bozuk dosya: sonraki adaya gec */ }
  }
  return null;
}

/** FNV-1a 32 bit - donusturulen harita agaclarinin derecesi buradan. */
function fnv1a(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i) & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const tam = (v) => Number.isInteger(v);
const yazi = (v) => typeof v === 'string' && v.length > 0;

/* -------------------------------------------------------- MODUL TEKILLIGI
 * DENETIM DUZELTMESI. server.js `sistemleriKur()` ile kur()'u YENIDEN cagiriyor
 * (admin panelinden ayar degisince; server.js ~satir 930). Onlem alinmazsa:
 *   a) eski setInterval'i kimse durdurmadigi icin iki tik dongusu birden calisir,
 *   b) 887 dugum world.yeniVarlikId() ile YENIDEN uretilir, yeni entity id alir;
 *      oyuncularin ws.meslekGorunen kumesinde eski id'ler durdugu icin istemcide
 *      her agac/kaya IKI KOPYA halinde cizilir ve eskiler asla rem edilmez,
 *   c) 5 bolgenin statics.json taramasi (813 agac) her ayar degisiminde tekrarlanir.
 * Cozum: onceki ornegin zamanlayicisini kapat, uretilen dugumleri ve geri dogum
 * kuyrugunu modul kapsaminda ONBELLEKTE tut. Test: _denetim_meslek.mjs (5. bolum).
 */
let ONCEKI_KAPAT = null;
let DUGUM_ONBELLEK = null;   // { dugumler, dolumKuyrugu, elSayi, agacSayi }

// ================================================================== kur()

export function kur(ctx) {
  /* Yeniden kurulum: onceki ornegin tikini durdur. */
  if (ONCEKI_KAPAT) { try { ONCEKI_KAPAT(); } catch { /* zaten kapali */ } ONCEKI_KAPAT = null; }

  const {
    world, frame, broadcast, log = () => {},
    GCFG = {}, ITEMSTATS = new Map(), zoneGroundY, envanterPayload,
    web = null,
  } = ctx;

  // ----------------------------------------------------------- veri yukleme
  const MESLEK = json(path.join(DATA, 'professions.json'),
                      path.join(PAKET, 'professions.json'));
  const YERLESIM = json(path.join(DATA, 'gather-node-placements.json'),
                        path.join(PAKET, 'gather-node-placements.json'));
  const EKSTRA = json(path.join(DATA, 'extra-items.json'),
                      path.join(PAKET, 'extra-items.json')) ?? [];
  /* NPC etkilesim yaricaplari. Istemci bunu AYNI kaynaktan cozuyor
     (ofset 25059627):
        npc.interactRangeU ??= interactRadii[npc.sroCode]
     ve sonra Ict(npc, gameConfig.npcInteractRangeU) ile kullaniyor
     (ofset 25041275). Egitmenler icin gercek deger 15 / 18.25 - 25 DEGIL. */
  const YARICAP = json(path.join(DATA, 'interact-radii.json'),
                       path.join(PAKET, 'interact-radii.json')) ?? {};

  if (!MESLEK?.professions?.length) {
    log('sistem_meslek: professions.json okunamadi - sistem KAPALI');
    return { mesaj: () => false };
  }

  const GATHER = MESLEK.gather;
  const XP_ORANI = Number(GCFG.professionXpRate ?? 1) || 1;

  /* --- indeksler --- */
  const meslekById = new Map(MESLEK.professions.map(m => [m.id, m]));
  const dugumById = new Map((MESLEK.nodes ?? []).map(n => [n.id, n]));
  const dereceById = new Map((MESLEK.grades ?? []).map(g => [g.id, g]));
  /** kaynak (wood/stone) -> o kaynagi toplayan meslek tanimi */
  const kaynakMeslegi = new Map();
  for (const m of MESLEK.professions) {
    if (m.category === 'collector' && m.resource) kaynakMeslegi.set(m.resource, m);
  }

  /* --- esya cozumleme: ITEMSTATS + extra-items --- */
  const ekstraById = new Map(EKSTRA.map(it => [it.id, it]));
  const esyaDef = (id) => ITEMSTATS.get(id) ?? ekstraById.get(id) ?? null;
  /** `${resource}:${tier}` -> malzeme tanimi (client: materialByResourceTier)
   *  Istemci bu haritayi TUM esya listesi uzerinden kuruyor (ofset 25063539:
   *  `for (let it of items) it.type === 'material' && map.set(...)`), bu yuzden
   *  biz de once ITEMSTATS'i tariyoruz. Bugun itemstats.json'da hic `material`
   *  yok (denetimde dogrulandi), ama katalog buyurse modul kendiliginden uyar. */
  const malzeme = new Map();
  for (const it of [...ITEMSTATS.values(), ...EKSTRA]) {
    if (it?.type === 'material' && it.resource && it.tier) {
      malzeme.set(`${it.resource}:${it.tier}`, it);
    }
  }

  /* --- xp egrisi (client: professionXpToNext, ofset 25073451) --- */
  function xpSonraki(seviye) {
    if (seviye >= MESLEK.maxLevel) return null;
    const { base, growthPct } = MESLEK.xpCurve;
    return Math.round(base * (1 + growthPct / 100) ** (seviye - 1));
  }

  // ------------------------------------------------------------ dugum uretimi
  /* Dugumler MODUL kapsaminda onbelleklenir (yukaridaki tekillik notu):
     kur() ikinci kez cagrilirsa entity id'ler DEGISMEZ ve statics taramasi
     tekrarlanmaz. Geri dogum kuyrugu da tasinir, yoksa yeniden kurulum aninda
     tukenmis bir dugum sonsuza dek gizli kalirdi. */
  const ONBELLEK = DUGUM_ONBELLEK
    ?? (DUGUM_ONBELLEK = { dugumler: new Map(), dolumKuyrugu: [], elSayi: 0, agacSayi: 0, uretildi: false });
  /** zoneId -> Map(entityId -> dugum) */
  const dugumler = ONBELLEK.dugumler;
  /** cikarilan dugumlerin geri dogum kuyrugu: [{zoneId, id, at}] */
  const dolumKuyrugu = ONBELLEK.dolumKuyrugu;

  function bolgeDugumleri(zoneId) {
    let m = dugumler.get(zoneId);
    if (!m) { m = new Map(); dugumler.set(zoneId, m); }
    return m;
  }

  function dereceSec(zoneId, x, z) {
    const dereceler = MESLEK.grades ?? [];
    const toplam = dereceler.reduce((a, g) => a + (g.spawnWeight || 0), 0) || 1;
    let r = fnv1a(`grade:${zoneId}:${x.toFixed(3)}:${z.toFixed(3)}`) % toplam;
    for (const g of dereceler) { if (r < g.spawnWeight) return g; r -= g.spawnWeight; }
    return dereceler[0];
  }

  function modelSec(resource, zoneId) {
    const nm = MESLEK.nodeModels?.[resource];
    if (!nm) return null;
    const bz = nm.byZone?.[zoneId];
    const d = nm.default;
    const sec = bz ?? d;
    return Array.isArray(sec) ? sec[0] : sec;
  }

  function dugumAdi(nodeDef, derece) {
    return `${derece?.namePrefix ?? ''} ${nodeDef.name}`.trim();
  }

  function dugumOlustur(zoneId, nodeId, gradeId, x, z, model, rotY = 0) {
    const nodeDef = dugumById.get(nodeId);
    const derece = dereceById.get(gradeId) ?? dereceById.get('green');
    if (!nodeDef || !derece || !model) return null;
    const id = world.yeniVarlikId();
    const d = {
      id, zoneId, nodeId, gradeId: derece.id, resource: nodeDef.resource,
      modelKey: `node_${model}`, npcId: `node_${nodeId}`,
      name: dugumAdi(nodeDef, derece),
      x, z, y: (zoneGroundY ? zoneGroundY(zoneId, x, z) : 0), rotY,
      sarj: GATHER.nodeCharges,
    };
    bolgeDugumleri(zoneId).set(id, d);
    return d;
  }

  function dugumPayload(d) {
    return {
      id: d.id, kind: 'npc', modelKey: d.modelKey, name: d.name,
      x: +d.x.toFixed(2), z: +d.z.toFixed(2), y: +(d.y ?? 0).toFixed(2),
      rotY: +(d.rotY ?? 0).toFixed(3),
      npcId: d.npcId,
      nodeGrade: d.gradeId,
    };
  }

  if (!ONBELLEK.uretildi) {
  /* 1) El yerlestirmeleri - derece DOSYADAN gelir, hash edilmez. */
  let elSayi = 0;
  for (const p of YERLESIM?.placements ?? []) {
    const model = p.model ?? modelSec(dugumById.get(p.node)?.resource, p.zone);
    if (dugumOlustur(p.zone, p.node, p.grade, p.x, p.z, model)) elSayi++;
  }

  /* 2) convertMapStatics: harita agaclari yerinde toplanabilir olur.
     KURAL: bir bolgede kabul edilen model kumesi =
        nodeModels.<res>.byZone[bolge] (yoksa default)
        + byRegion modellerinden O BOLGENIN statics'inde GERCEKTEN bulunanlar.
     Neden byRegion boyle: karakoram hotan_province icinde bir HARITA BOLGESI,
     bolge poligonlari sunucuda yok. Duz birlesim yanlis olurdu - ornek:
     donwhang'in agaci env_w_cd_tree05 jangan'da da 8 kez geciyor, birlesim
     alsak jangan'da yanlis agaclar toplanabilir olurdu. */
  let agacSayi = 0;
  for (const resource of MESLEK.convertMapStatics?.resources ?? []) {
    const nodeDef = [...dugumById.values()].find(n => n.resource === resource);
    if (!nodeDef) continue;
    const nm = MESLEK.nodeModels?.[resource] ?? {};
    const bolgeModelleri = Object.values(nm.byRegion ?? {}).flat();

    for (const zoneId of Object.keys(world.worldData?.zones ?? {})) {
      const statics = json(path.join(ZONE_VARLIK, zoneId, 'statics.json'));
      if (!Array.isArray(statics)) continue;
      const varOlan = new Set(statics.map(s => s.modelKey));
      const kabul = new Set();
      const vz = nm.byZone?.[zoneId] ?? nm.default;
      for (const m of (Array.isArray(vz) ? vz : [vz])) if (m) kabul.add(m);
      for (const m of bolgeModelleri) if (varOlan.has(m)) kabul.add(m);

      for (const s of statics) {
        if (!kabul.has(s.modelKey)) continue;
        const derece = dereceSec(zoneId, s.x, s.z);
        if (dugumOlustur(zoneId, nodeDef.id, derece.id, s.x, s.z,
                         s.modelKey, s.rotY ?? 0)) agacSayi++;
      }
    }
  }

    ONBELLEK.elSayi = elSayi;
    ONBELLEK.agacSayi = agacSayi;
    ONBELLEK.uretildi = true;
    log(`sistem_meslek: ${elSayi} el yerlestirmesi + ${agacSayi} harita agaci = `
      + `${elSayi + agacSayi} dugum, ${meslekById.size} meslek, ${malzeme.size} malzeme`);
  } else {
    log(`sistem_meslek: yeniden kurulum - ${dugumler.size} bolgedeki `
      + `${ONBELLEK.elSayi + ONBELLEK.agacSayi} dugum ONBELLEKTEN (entity id'ler korundu)`);
  }

  // --------------------------------------------------------------- kalicilik
  let sqlHavuz = web;
  let sqlDurum = web ? 'ctx.web' : 'baglanmadi';
  let sqlSoz = null;

  /**
   * SQL havuzunu SONRADAN takar - sistem_stat-ustalik.js / sistem_arayuz-durumu.js
   * ile AYNI sozlesme: server.js modulleri initSql()'den ONCE kuruyor ve
   * ctx.web olarak null geciyor (server.js:405 `ornek.webBagla(WEBPOOL, sql)`).
   *
   * NEDEN GEREKLI: bu modul havuz yoksa config.json'dan KENDI havuzunu aciyordu
   * (asagidaki havuz() dali). Sunucunun zaten acik olan SRO_WEB_GAME havuzu
   * dururken IKINCI bir baglanti havuzu acmak gereksiz baglanti tuketir ve iki
   * havuz ayri islem baglaminda calistigi icin ayni satira yaris eden yazimlar
   * uretebilir. webBagla varsa artik ortak havuz kullanilir.
   * KAYNAK: server.js:401-413 (webBagla dongusu).
   */
  function webBagla(havuzYeni /* , sqlMod */) {
    if (!havuzYeni) return !!sqlHavuz;
    sqlHavuz = havuzYeni;
    sqlDurum = 'ctx.web';
    sqlSoz = null;
    log('sistem_meslek: ortak SRO_WEB_GAME havuzu baglandi - kalicilik acik');
    return true;
  }

  async function havuz() {
    if (sqlHavuz) return sqlHavuz;
    if (sqlDurum === 'kapali') return null;
    if (sqlSoz) return sqlSoz;
    sqlSoz = (async () => {
      try {
        const CFG = JSON.parse(fs.readFileSync(path.join(HERE, 'config.json'), 'utf8'));
        if (!CFG.sql?.enabled) { sqlDurum = 'kapali'; return null; }
        const { default: sql } = await import('mssql');
        const p = await new sql.ConnectionPool({
          server: CFG.sql.server, user: CFG.sql.user, password: CFG.sql.password,
          database: CFG.sql.databases.web, options: CFG.sql.options,
        }).connect();
        sqlHavuz = p; sqlDurum = 'kendi havuzu';
        log('sistem_meslek: SRO_WEB_GAME havuzu acildi');
        return p;
      } catch (e) {
        sqlDurum = 'kapali';
        log(`sistem_meslek: SQL yok, meslekler BELLEKTE (${String(e.message).slice(0, 90)})`);
        return null;
      }
    })();
    return sqlSoz;
  }

  async function meslekleriOku(charId) {
    const p = await havuz();
    if (!p) return null;
    const r = await p.request().input('CharID', charId).execute('WebGetCharProfessions');
    return r.recordset.map(s => ({
      id: String(s.ProfessionID), level: Number(s.Lvl), xp: Number(s.Xp),
    })).filter(m => meslekById.has(m.id));
  }

  async function meslekYaz(charId, m) {
    const p = await havuz();
    if (!p) return false;
    await p.request()
      .input('CharID', charId)
      .input('ProfessionID', m.id)
      .input('Lvl', m.level)
      .input('Xp', m.xp)
      .execute('WebSaveCharProfession');
    return true;
  }

  /** charId -> {zamanlayici, kayitlar:Map(professionId -> meslek)} */
  const bekleyen = new Map();
  function yazimPlanla(charId, m, hemen = false) {
    if (!(charId > 0)) return;
    if (hemen) {
      meslekYaz(charId, { ...m })
        .catch(e => log(`sistem_meslek: yazim hatasi ${String(e.message).slice(0, 90)}`));
      return;
    }
    let k = bekleyen.get(charId);
    if (!k) { k = { zamanlayici: null, kayitlar: new Map() }; bekleyen.set(charId, k); }
    k.kayitlar.set(m.id, { ...m });
    if (k.zamanlayici) return;
    k.zamanlayici = setTimeout(async () => {
      bekleyen.delete(charId);
      for (const kayit of k.kayitlar.values()) {
        try { await meslekYaz(charId, kayit); }
        catch (e) { log(`sistem_meslek: yazim hatasi ${String(e.message).slice(0, 90)}`); }
      }
    }, SQL_PENCERE_MS);
    if (typeof k.zamanlayici.unref === 'function') k.zamanlayici.unref();
  }

  /**
   * Bekleyen TUM meslek yazimlarini hemen diske indirir.
   *
   * NEDEN: yazimPlanla() TP kazanimlarini SQL_PENCERE_MS (3 sn) boyunca
   * biriktiriyor. Sunucu o pencere icinde kapanirsa (ya da admin panelinden
   * ayar degisip modul yeniden kurulursa) o 3 saniyelik ilerleme kaybolur.
   * Kapanista ve kapat() icinde cagrilir.
   */
  async function hepsiniBosalt() {
    const isler = [];
    for (const [charId, k] of [...bekleyen]) {
      bekleyen.delete(charId);
      if (k.zamanlayici) clearTimeout(k.zamanlayici);
      for (const kayit of k.kayitlar.values()) {
        isler.push(meslekYaz(charId, kayit)
          .catch(e => log(`sistem_meslek: bosaltma hatasi ${String(e.message).slice(0, 90)}`)));
      }
    }
    if (isler.length) await Promise.all(isler);
    return isler.length;
  }

  // ------------------------------------------------------------ karakter durumu
  /** ch.meslekler daima dizi olsun. */
  function meslekler(ch) {
    if (!Array.isArray(ch.meslekler)) ch.meslekler = [];
    return ch.meslekler;
  }

  function meslekPayload(ch) {
    return meslekler(ch).map(m => ({
      id: m.id, level: m.level, xp: m.xp, xpToNext: xpSonraki(m.level),
    }));
  }

  /**
   * GIRIS YUKLEMESI - zone.init YOLLANMADAN ONCE cagrilir.
   *
   * server.js:1590 `modulleriYukle(ch)` her modulun `yukle(ch)` kancasini
   * AWAIT ediyor ve bunu selfPayload uretilmeden once yapiyor (server.js:1458).
   * Bu kanca olmadan meslekler zone.init.self'e YETISEMIYORDU: yuklemeTik()
   * girisin BIRKAC TIK SONRASINDA okuyup ayri bir 207 profession.update ile
   * yamiyordu (bir kare gecikme + kisa sureli "hicbir meslegin yok" ekrani).
   *
   * Sema: _ht.professions = BJ(ght).optional()  (paket @25597430)
   *       ght = { id, level, xp, xpToNext }     (paket @25597196)
   * Kaynak tablo: SRO_WEB_GAME.dbo.WebCharProfession
   *       (yordamlar WebGetCharProfessions / WebSaveCharProfession - canli
   *        DB'de dogrulandi; WebSaveCharProfession MERGE ile yaziyor).
   *
   * YARIS KORUMASI: okumadan once o karakterin BEKLEYEN yazimlari bosaltilir.
   * Aksi halde 3 saniyelik pencerede cikip hemen giren oyuncu, henuz diske
   * inmemis TP'sini geri kaybederdi (ayni tuzagi sistem_gorev.js
   * `bekleyenYazmalar` ile cozuyor).
   */
  async function yukle(ch) {
    if (!ch?.id) return ch;
    if (!Array.isArray(ch.meslekler)) ch.meslekler = [];
    /* Bu karakterin bekleyen yazimi varsa once onu indir. */
    const bek = bekleyen.get(Number(ch.id));
    if (bek) {
      bekleyen.delete(Number(ch.id));
      if (bek.zamanlayici) clearTimeout(bek.zamanlayici);
      for (const kayit of bek.kayitlar.values()) {
        try { await meslekYaz(Number(ch.id), kayit); }
        catch (e) { log(`sistem_meslek: yazim hatasi ${String(e.message).slice(0, 90)}`); }
      }
    }
    try {
      const kayitlar = await meslekleriOku(Number(ch.id));
      if (kayitlar) {
        /* DB satirlari esas; bellekte olup DB'de gorunmeyen kayit korunur
           (yuklemeTik icindeki ayni yaris duzeltmesi - duz atama bir
           yaris aciyordu). */
        const bellek = meslekler(ch);
        const dbId = new Set(kayitlar.map(m => m.id));
        ch.meslekler = [...kayitlar, ...bellek.filter(m => !dbId.has(m.id))];
      }
      /* yuklemeTik'e "bu karakter zaten okundu" de: ayni SELECT'i tekrar
         calistirip fazladan bir 207 karesi gondermesin. */
      ch.__meslekYuklendi = true;
    } catch (e) {
      log(`sistem_meslek: yukleme hatasi ${String(e.message).slice(0, 90)}`);
    }
    return ch;
  }

  /**
   * zone.init.self.professions katkisi.
   *
   * server.js selfPayload() `Object.assign(taban, modulKatkisi(['selfAlanlari',
   * 'kendiParcasi'], ch))` yapiyor (server.js:620), yani bu ad karenin
   * `professions` alanini SABIT [] olmaktan cikarir - server.js'e dokunmadan.
   *
   * MESLEK YOKSA HIC ALAN DONDURULMEZ: sema alani `.optional()` yapmis
   * (paket @25597430) ve server.js tabani zaten [] tasiyor; bos dizi de sema
   * acisindan gecerli oldugu icin iki durum da istemciyi kirmaz.
   */
  function selfAlanlari(ch) {
    if (!ch) return {};
    const p = meslekPayload(ch);
    return p.length ? { professions: p } : {};
  }

  function meslekGuncelle(ws) {
    frame(ws, 'profession.update', { professions: meslekPayload(ws.char) });
  }

  function hata(ws, code, key, params) {
    const d = { code };
    if (key) d.key = key;
    if (params) d.params = params;
    frame(ws, 'err', d);
    return true;
  }

  // -------------------------------------------------------------- envanter
  function bagCanta(ch) {
    if (!Array.isArray(ch.bag)) ch.bag = new Array(GCFG.bagSlots ?? 32).fill(null);
    return ch.bag;
  }

  /**
   * Yigin kurallarina uyarak esya ekler. HEPSI SIGMAZSA HIC EKLEMEZ (atomik).
   *
   * DENETIM DUZELTMESI: eski surum once mevcut yiginlari doldurup sonra bos
   * yuva ariyordu; sigmayinca `false` donuyor ama DOLDURDUKLARINI GERI ALMIYORDU.
   * Somut senaryo: cantada 999/1000 wood_01 yigini + tum yuvalar dolu, vurus
   * 2 wood_01 uretti. Eski kod 1 tanesini yigina ekliyor, `false` doniyor,
   * vurus() ERR_BAG_FULL basip inv.update GONDERMIYORDU -> sunucuda 1000,
   * istemcide 999: sessiz envanter kaymasi + kaybolan 1 malzeme.
   * Simdi once kapasite sayiliyor, ancak tamami sigiyorsa yaziliyor.
   */
  function cantayaEkle(ch, itemId, adet) {
    const def = esyaDef(itemId);
    const yiginMax = Math.max(1, def?.stackMax ?? 1);
    const bag = bagCanta(ch);

    /* 1) KURU CALISMA: nereye ne kadar konacagini yazmadan hesapla. */
    const plan = [];
    let kalan = adet;
    for (let i = 0; i < bag.length && kalan > 0; i++) {
      const y = bag[i];
      if (!y || y.itemId !== itemId) continue;
      const bosluk = yiginMax - (y.qty ?? 1);
      if (bosluk <= 0) continue;
      const koy = Math.min(bosluk, kalan);
      plan.push({ i, koy, yeni: false });
      kalan -= koy;
    }
    for (let i = 0; i < bag.length && kalan > 0; i++) {
      if (bag[i]) continue;
      const koy = Math.min(yiginMax, kalan);
      plan.push({ i, koy, yeni: true });
      kalan -= koy;
    }
    if (kalan > 0) return false;          // sigmiyor: CANTAYA DOKUNULMADI

    /* 2) YAZIM: ancak tamami sigdiysa. */
    for (const p of plan) {
      if (p.yeni) bag[p.i] = { itemId, qty: p.koy };
      else bag[p.i].qty = (bag[p.i].qty ?? 1) + p.koy;
    }
    return true;
  }

  /** Kusanilan silahin tanimi (string ya da {itemId} olabilir). */
  function silahDef(ch) {
    const v = ch.equip?.weapon;
    if (!v) return null;
    return esyaDef(typeof v === 'string' ? v : v.itemId);
  }

  // ------------------------------------------------------- ogrenme uygunlugu
  /* Istemcideki Imt() ile BIREBIR (ofset 25583369):
       tanim yok            -> ERR_NOT_FOUND
       zaten ogrenilmis     -> ERR_PROFESSION_STATE + err.profession.already_learned
       ayni kategori dolu   -> ERR_PROFESSION_STATE + err.profession.category_taken
       altin yetmiyor       -> ERR_NO_GOLD
     `altin` parametresi Infinity gecilirse ucret kontrolu atlanir (parsomen). */
  function ogrenmeUygun(ch, professionId, altin) {
    const def = meslekById.get(professionId);
    if (!def) return { ok: false, code: 'ERR_NOT_FOUND' };
    const mevcut = meslekler(ch);
    if (mevcut.some(m => m.id === professionId)) {
      return { ok: false, code: 'ERR_PROFESSION_STATE', key: 'err.profession.already_learned' };
    }
    if (mevcut.some(m => meslekById.get(m.id)?.category === def.category)) {
      return { ok: false, code: 'ERR_PROFESSION_STATE', key: 'err.profession.category_taken' };
    }
    const ucret = MESLEK.learnCostGold;
    if (altin < ucret) return { ok: false, code: 'ERR_NO_GOLD' };
    return { ok: true, ucret, def };
  }

  function meslekOgret(ws, def) {
    const ch = ws.char;
    const m = { id: def.id, level: 1, xp: 0 };
    meslekler(ch).push(m);
    meslekGuncelle(ws);
    frame(ws, 'inv.update', envanterPayload ? envanterPayload(ch) : {
      gold: ch.gold ?? 0, bag: bagCanta(ch), equip: {},
    });
    frame(ws, 'sys.notice', {
      key: 'sys.profession.learned', params: { profession: def.name },
    });
    yazimPlanla(Number(ch.id), m, true);
    log(`meslek ogrenildi: ${ch.name} -> ${def.id}`);
  }

  // =============================================================== profession.learn
  function ogren(ws, d) {
    const ch = ws.char;
    if (!yazi(d?.npcId) || !yazi(d?.professionId)) {
      return hata(ws, 'ERR_VALIDATION', null, null);
    }
    if (ch.dead) return hata(ws, 'ERR_DEAD', 'err.busy.downed');

    /* Egitmen mi? Kaynak professions.json.trainers - world.json'daki
       npcCatalog kayitlarinda `trainer` alani URETICI TARAFINDAN DUSURULMUS
       (137 NPC'nin hicbirinde yok), bu yuzden oradan okunamaz. */
    const egitmen = MESLEK.trainers?.[d.npcId];
    if (!egitmen?.teaches?.includes(d.professionId)) {
      return hata(ws, 'ERR_NOT_FOUND');
    }

    /* Menzil: NPC konumu bolge tanimindan.
       DENETIM DUZELTMESI: sabit 25 kullaniliyordu, ama istemcinin gercek kapisi
       PER-NPC. Istemci Ict(npcDef, gameConfig.npcInteractRangeU) yapiyor
       (ofset 25041275) ve npcDef.interactRangeU'yu config/interact-radii.json
       icinden sroCode ile dolduruyor (ofset 25059627). 8 meslek egitmeni icin
       gercek deger 15 (npc_ch_special2 = 18.25), 25 DEGIL. Istemci NPC'ye
       radiusU-0.75'e kadar yuruyup radiusU-0.1'de pencereyi aciyor
       (H7e/Ugt, ofset 25684108), yani mesaj her zaman bu yaricapin icinden
       gelir - gate'i daraltmak mesru istemciyi REDDETMEZ. */
    const npc = (world.worldData?.zones?.[ws.zoneId]?.npcs ?? [])
      .find(n => n.npcId === d.npcId);
    if (!npc) return hata(ws, 'ERR_NOT_FOUND');
    const npcDef = world.worldData?.npcCatalog?.[d.npcId];
    const menzil = Number(
      npcDef?.interactRangeU
      ?? (npcDef?.sroCode ? YARICAP[npcDef.sroCode] : undefined)
      ?? GCFG.npcInteractRangeU ?? 25);
    if (Math.hypot(npc.x - ch.x, npc.z - ch.z) > menzil) {
      return hata(ws, 'ERR_RANGE');
    }

    const u = ogrenmeUygun(ch, d.professionId, ch.gold ?? 0);
    if (!u.ok) return hata(ws, u.code, u.key);

    ch.gold = (ch.gold ?? 0) - u.ucret;
    meslekOgret(ws, u.def);
    return true;
  }

  // ============================================================== profession.scroll
  function parsomen(ws, d) {
    const ch = ws.char;
    const slot = d?.bagSlot;
    if (!tam(slot) || slot < 0 || slot > 383) return hata(ws, 'ERR_VALIDATION');  // SARTNAME-3 MADDE 11: 383 = 12 sayfa x 32 - 1
    if (ch.dead) return hata(ws, 'ERR_DEAD', 'err.busy.downed');

    const bag = bagCanta(ch);
    const yuva = slot < bag.length ? bag[slot] : null;
    const def = yuva ? esyaDef(yuva.itemId) : null;
    if (!def || def.type !== 'professionScroll') return hata(ws, 'ERR_NOT_FOUND');

    /* Istemci burada altini 2**53-1 gecirir (ofset 27546000): ucreti parsomen
       oder, karakterin altini KONTROL EDILMEZ ve HARCANMAZ. */
    const u = ogrenmeUygun(ch, def.professionId, Number.POSITIVE_INFINITY);
    if (!u.ok) return hata(ws, u.code, u.key);

    yuva.qty = (yuva.qty ?? 1) - 1;
    if (yuva.qty <= 0) bag[slot] = null;
    meslekOgret(ws, u.def);
    return true;
  }

  // =================================================================== toplama
  /** ws.toplama = { nodeEntityId, zoneId, anim, meslekId, sonrakiVurus } */

  function toplamaBitir(ws, yayinla = true) {
    if (!ws.toplama) return;
    ws.toplama = null;
    const kare = { id: ws.entityId };
    frame(ws, 'gather.end', kare);
    if (yayinla) broadcast(ws.zoneId, 'gather.end', kare, ws);
  }

  function gatherStart(ws, d) {
    const ch = ws.char;
    if (!tam(d?.nodeId)) return hata(ws, 'ERR_VALIDATION');
    if (ch.dead) return hata(ws, 'ERR_DEAD', 'err.busy.downed');

    const dugum = bolgeDugumleri(ws.zoneId).get(d.nodeId);
    if (!dugum || dugum.sarj <= 0) return hata(ws, 'ERR_NOT_FOUND');

    const meslekDef = kaynakMeslegi.get(dugum.resource);
    if (!meslekDef) return hata(ws, 'ERR_NOT_FOUND');

    const sahip = meslekler(ch).find(m => m.id === meslekDef.id);
    if (!sahip) {
      return hata(ws, 'ERR_REQ_PROFESSION', 'err.profession.required',
                  { profession: meslekDef.name });
    }

    /* Alet: kusanilan silahin weaponType'i meslegin toolWeaponType'i olmali.
       profession_axe / profession_pickaxe extra-items.json'da (ITEMSTATS'ta YOK). */
    const silah = silahDef(ch);
    if (!silah || silah.weaponType !== meslekDef.toolWeaponType) {
      return hata(ws, 'ERR_REQ_WEAPON', 'err.profession.wrong_tool',
                  { profession: meslekDef.name });
    }

    /* Menzil: professions.gather.rangeU = 4 (uydurma degil, dosyadan). */
    if (Math.hypot(dugum.x - ch.x, dugum.z - ch.z) > GATHER.rangeU) {
      return hata(ws, 'ERR_RANGE');
    }

    /* DENETIM DUZELTMESI - SPAM KAPISI: istemci dugume her tiklamada mesaj
       gonderiyor (ofset 25689684, hic kisitlama yok). Ayni dugum icin gelen
       tekrarli gather.start eskiden her seferinde bolgeye entity.stop +
       gather.end + gather.action yayinliyor, ustelik `sonrakiVurus`i sifirlayip
       vurusun ASLA tamamlanmamasina yol aciyordu. Zaten o dugumu topluyorsak
       sessizce sahiplen. */
    if (ws.toplama && ws.toplama.nodeEntityId === dugum.id
        && ws.toplama.zoneId === ws.zoneId) {
      return true;
    }

    /* Toplama sirasinda hareket ve savas YOK. */
    bacakDurdur(ch);
    ws.savas = null;
    const dur = { id: ws.entityId, x: ch.x, z: ch.z, y: ch.y ?? 0 };
    frame(ws, 'entity.stop', dur);
    broadcast(ws.zoneId, 'entity.stop', dur, ws);

    if (ws.toplama) toplamaBitir(ws);
    ws.toplama = {
      nodeEntityId: dugum.id, zoneId: ws.zoneId, anim: meslekDef.gatherAnim,
      meslekId: meslekDef.id, sonrakiVurus: Date.now() + GATHER.swingMs,
    };
    const kare = {
      id: ws.entityId, nodeId: dugum.id,
      anim: meslekDef.gatherAnim, swingMs: GATHER.swingMs,
    };
    frame(ws, 'gather.action', kare);
    broadcast(ws.zoneId, 'gather.action', kare, ws);
    return true;
  }

  function gatherCancel(ws) {
    toplamaBitir(ws);
    return true;
  }

  // ------------------------------------------------------------- vurus / kazanc
  /** yieldByLevel: minLevel <= etkin seviye olan EN YUKSEK bant kazanir. */
  function bantSec(etkinSeviye) {
    const bantlar = MESLEK.yieldByLevel?.bands ?? [];
    let secili = bantlar[0] ?? null;
    for (const b of bantlar) if (b.minLevel <= etkinSeviye) secili = b;
    return secili;
  }

  function tierSec(agirliklar) {
    const toplam = agirliklar.reduce((a, w) => a + w, 0) || 1;
    let r = Math.random() * toplam;
    for (let i = 0; i < agirliklar.length; i++) {
      if (r < agirliklar[i]) return i + 1;
      r -= agirliklar[i];
    }
    return 1;
  }

  /** Bir vurus: kazanc + TP + sarj dusumu. */
  /**
   * MESLEK TP'SI EKLEME - TEK YETKILI YER.  (plan md.46)
   *
   * NEDEN VAR: TP'yi kazandiran IKI yol var - toplama vurusu (bu dosya) ve
   * tas uretimi (sistem_gelistirme.js `stone.craft`). Ikincisi seviye atlama
   * dongusunu, profession.update (207) karesini, sys.profession.level_up
   * bildirimini ve WebSaveCharProfession yazimini HIC yapmiyordu; sadece
   * `m.satir.xp += tarif.xp` diyordu. Sonuc: Enchanter TP'si Meslekler
   * penceresinde hic degismiyor ve cikista tamamen kayboluyordu.
   * Dongu iki dosyaya kopyalanmasin diye kural BURADA tek yerde duruyor;
   * sistem_gelistirme.js bunu ctx.sistemOrnegi('meslek') uzerinden cagirir.
   *
   * @param {object} ws        oyuncu soketi (ws.char gerekli)
   * @param {string} professionId  'enchanter' | 'lumberjack' | ...
   * @param {number} hamXp     tarif/vurus TP'si (oran UYGULANMADAN once)
   * @param {{oranUygula?: boolean}} [secenek]
   *        oranUygula=false -> cagiran GCFG.professionXpRate'i zaten uygulamis
   *        (toplama vurusu boyle: gather.yield karesinde AYNI sayiyi gosteriyor)
   * @returns {null | {id, level, xp, verilen, seviyeAtladi}}
   *          Meslek karakterde yoksa null (kapi cagiranin isi).
   */
  function meslekTpEkle(ws, professionId, hamXp, { oranUygula = true } = {}) {
    const ch = ws?.char;
    if (!ch || !professionId) return null;
    const m = meslekler(ch).find(x => x.id === professionId);
    if (!m) return null;

    const verilen = Math.round((Number(hamXp) || 0) * (oranUygula ? XP_ORANI : 1));
    if (verilen <= 0) return { id: m.id, level: m.level, xp: m.xp, verilen: 0, seviyeAtladi: false };

    m.xp = (m.xp ?? 0) + verilen;
    let seviyeAtladi = false;
    for (;;) {
      const gerek = xpSonraki(m.level);
      if (gerek === null || m.xp < gerek) break;
      m.xp -= gerek;
      m.level += 1;
      seviyeAtladi = true;
    }
    /* Tavanda (maxLevel) xpToNext null olur, dongu kirilir ve TP BIRIKMEYE
       DEVAM EDER. Bilerek sifirlamiyoruz: maxLevel ileride yukseltilirse
       birikmis TP dogru seviyeye tasinir, sifirlasak kaybolurdu. Istemci
       xpToNext null gorunce zaten "Azami" yaziyor (ui.profession.max). */

    meslekGuncelle(ws);                       // s2c 207 profession.update
    if (seviyeAtladi) {
      frame(ws, 'sys.notice', {
        key: 'sys.profession.level_up',
        params: { profession: meslekById.get(m.id)?.name ?? m.id, level: m.level },
      });
    }
    /* Seviye atladiysa HEMEN diske in (SQL_PENCERE_MS beklemeden): seviye
       kaybi TP kaybindan cok daha gorunur bir hatadir. */
    yazimPlanla(Number(ch.id), m, seviyeAtladi);
    return { id: m.id, level: m.level, xp: m.xp, verilen, seviyeAtladi };
  }

  function vurus(ws, dugum) {
    const ch = ws.char;
    const derece = dereceById.get(dugum.gradeId) ?? { xpMult: 1, levelBonus: 0 };
    const m = meslekler(ch).find(x => x.id === ws.toplama.meslekId);
    if (!m) { toplamaBitir(ws); return; }

    const bant = bantSec(m.level + (derece.levelBonus ?? 0));
    const tier = bant ? tierSec(bant.weights) : 1;
    const mal = malzeme.get(`${dugum.resource}:${tier}`)
             ?? malzeme.get(`${dugum.resource}:1`);
    if (!mal) { toplamaBitir(ws); return; }

    const adet = GATHER.yieldMin
      + Math.floor(Math.random() * (GATHER.yieldMax - GATHER.yieldMin + 1));

    if (!cantayaEkle(ch, mal.id, adet)) {
      hata(ws, 'ERR_BAG_FULL');
      toplamaBitir(ws);
      return;
    }

    /* Oran BURADA uygulaniyor cunku AYNI sayi gather.yield karesinde de
       gosteriliyor - ekrandaki TP ile verilen TP ayni olmali. Bu yuzden
       meslekTpEkle asagida `oranUygula: false` ile cagriliyor (iki kez
       carpilmasin). */
    const xp = Math.round(GATHER.xpPerSwing * (derece.xpMult ?? 1) * XP_ORANI);

    dugum.sarj -= 1;

    /* gather.yield sohbet satirini ISTEMCI yazar (sys.profession.gathered) -
       sunucu ayrica sys.notice gonderirse satir iki kez cikar. */
    frame(ws, 'gather.yield', {
      nodeId: dugum.id, items: [{ itemId: mal.id, qty: adet }], xp,
    });
    frame(ws, 'inv.update', envanterPayload ? envanterPayload(ch) : {
      gold: ch.gold ?? 0, bag: bagCanta(ch), equip: {},
    });
    /* plan md.46: TP + seviye dongusu + profession.update (207) +
       sys.profession.level_up + WebSaveCharProfession artik TEK YERDE
       (meslekTpEkle). Eskiden bu dongunun bir kopyasi buradaydi, ikizi ise
       sistem_gelistirme.js'te HIC YOKTU - uretim TP'si bu yuzden oluydu. */
    meslekTpEkle(ws, m.id, xp, { oranUygula: false });

    if (dugum.sarj <= 0) {
      dugumTuket(dugum);
      toplamaBitir(ws);
    } else {
      ws.toplama.sonrakiVurus = Date.now() + GATHER.swingMs;
      /* DENETIM DUZELTMESI - GOZLEMCI SENKRONU: gather.action yalnizca toplama
         BASLARKEN yayinlaniyordu. Toplama suruyorken ilgi alanina giren bir
         oyuncu, cekirdegin state.delta.add govdesinde `gathering` alani
         OLMADIGI icin (entityPayload server.js'te, biz degistiremeyiz) o
         karakteri hareketsiz goruyordu. Her vuruste yeniden yayinliyoruz;
         zaten izleyen istemcide bu BEDAVA: setGathering (ofset 26623050)
         `if (gathering !== yeniKlip)` diye ayni klipte hicbir sey yapmiyor,
         yani animasyon bastan BASLAMAZ. Sadece yeni gelen gorur. */
      broadcast(ws.zoneId, 'gather.action', {
        id: ws.entityId, nodeId: dugum.id,
        anim: ws.toplama.anim, swingMs: GATHER.swingMs,
      }, ws);
    }
  }

  /** Sarji biten dugum haritadan kalkar, respawnMs sonra ayni yere doner. */
  function dugumTuket(dugum) {
    dugum.sarj = 0;
    dugum.gizli = true;
    dolumKuyrugu.push({ zoneId: dugum.zoneId, id: dugum.id, at: Date.now() + GATHER.respawnMs });
    for (const c of world.bolgeOyunculari(dugum.zoneId)) {
      if (c.meslekGorunen?.has(dugum.id)) {
        c.meslekGorunen.delete(dugum.id);
        frame(c, 'state.delta', { rem: [dugum.id] });
      }
    }
  }

  function dolumTik(simdi) {
    if (!dolumKuyrugu.length) return;
    for (let i = dolumKuyrugu.length - 1; i >= 0; i--) {
      const o = dolumKuyrugu[i];
      if (o.at > simdi) continue;
      dolumKuyrugu.splice(i, 1);
      const d = dugumler.get(o.zoneId)?.get(o.id);
      if (d) { d.sarj = GATHER.nodeCharges; d.gizli = false; }
    }
  }

  // ------------------------------------------------------------- ilgi alani
  function ilgiTik() {
    for (const [zoneId, harita] of dugumler) {
      const oyuncular = world.bolgeOyunculari(zoneId);
      if (!oyuncular.length) continue;
      for (const ws of oyuncular) {
        if (!ws.char) continue;
        if (ws.meslekBolge !== ws.zoneId) { ws.meslekBolge = ws.zoneId; ws.meslekGorunen = new Set(); }
        const gorunen = ws.meslekGorunen ?? (ws.meslekGorunen = new Set());
        const add = [], rem = [];
        for (const d of harita.values()) {
          const uzak2 = (d.x - ws.char.x) ** 2 + (d.z - ws.char.z) ** 2;
          const goruyor = gorunen.has(d.id);
          if (!goruyor && !d.gizli && uzak2 <= GORUS_U ** 2) {
            gorunen.add(d.id); add.push(dugumPayload(d));
          } else if (goruyor && (d.gizli || uzak2 > GORUS_BIRAKMA_U ** 2)) {
            gorunen.delete(d.id); rem.push(d.id);
          }
        }
        if (!add.length && !rem.length) continue;
        const gov = {};
        if (add.length) gov.add = add;
        if (rem.length) gov.rem = rem;
        frame(ws, 'state.delta', gov);
      }
    }
  }

  // ------------------------------------------------------ ilk gorus: DB'den yukle
  function yuklemeTik() {
    for (const zoneId of Object.keys(world.worldData?.zones ?? {})) {
      for (const ws of world.bolgeOyunculari(zoneId)) {
        if (!ws.char || ws.meslekYuklendi) continue;
        ws.meslekYuklendi = true;   // tekrar denenmesin
        const ch = ws.char;
        /* yukle(ch) zaten okuduysa (server.js:1458 modulleriYukle, zone.init'ten
           ONCE) ikinci bir SELECT calistirma ve fazladan 207 gonderme:
           meslekler zone.init.self.professions icinde ZATEN gitti. */
        if (ch.__meslekYuklendi) continue;
        meslekleriOku(Number(ch.id)).then((kayitlar) => {
          if (kayitlar) {
            /* DENETIM DUZELTMESI: duz atama (`ch.meslekler = kayitlar`) bir
               YARIS aciyordu. SELECT ucarken oyuncu bir meslek ogrenirse
               (ogren/parsomen bellege ekler ve HEMEN SQL'e yazar) SELECT o
               INSERT'ten once calismis olabilir; duz atama yeni meslegi
               bellekten SILER ve istemci Meslekler penceresinde bos kalirdi.
               Cozum: DB satirlari esas, bellekte olup DB'de gorunmeyen kayit
               korunur. */
            const bellek = meslekler(ch);
            const dbId = new Set(kayitlar.map(m => m.id));
            ch.meslekler = [...kayitlar, ...bellek.filter(m => !dbId.has(m.id))];
          }
          /* zone.init.self.professions server.js icinde SABIT [] (satir 309) -
             oradaki degeri degistiremiyoruz, bu yuzden girisin hemen ardindan
             207 profession.update ile senkronluyoruz. */
          meslekGuncelle(ws);
        }).catch((e) => {
          log(`sistem_meslek: okuma hatasi ${String(e.message).slice(0, 90)}`);
          /* Okuma patlasa bile 207 gonderilmeli: aksi halde istemci
             zone.init'teki sabit [] ile kalir ve Meslekler penceresi
             "hicbir meslek yok" der. */
          meslekGuncelle(ws);
        });
      }
    }
  }

  // -------------------------------------------------------------- toplama tiki
  function toplamaTik(simdi) {
    for (const zoneId of Object.keys(world.worldData?.zones ?? {})) {
      for (const ws of world.bolgeOyunculari(zoneId)) {
        const t = ws.toplama;
        if (!t || !ws.char) continue;

        /* IPTAL KOSULLARI - istemciye guvenmiyoruz. */
        if (ws.char.dead || ws.zoneId !== t.zoneId || ws.char.bacak || ws.savas) {
          toplamaBitir(ws); continue;
        }
        const dugum = dugumler.get(t.zoneId)?.get(t.nodeEntityId);
        if (!dugum || dugum.gizli || dugum.sarj <= 0) { toplamaBitir(ws); continue; }
        if (Math.hypot(dugum.x - ws.char.x, dugum.z - ws.char.z) > GATHER.rangeU) {
          toplamaBitir(ws); continue;
        }
        if (simdi >= t.sonrakiVurus) vurus(ws, dugum);
      }
    }
  }

  let tikSayaci = 0;
  const zamanlayici = setInterval(() => {
    try {
      const simdi = Date.now();
      tikSayaci++;
      dolumTik(simdi);
      toplamaTik(simdi);
      yuklemeTik();
      if (tikSayaci % ILGI_TIK === 0) ilgiTik();
    } catch (e) {
      log(`sistem_meslek tik hatasi: ${String(e.message).slice(0, 120)}`);
    }
  }, TIK_MS);
  if (typeof zamanlayici.unref === 'function') zamanlayici.unref();
  /* Bir sonraki kur() cagrisi bu tiki kapatsin (tekillik notu).
     KAPANMADAN ONCE bekleyen TP yazimlarini diske indir: yeniden kurulumda
     `bekleyen` haritasi yeni ornekte bos baslar ve o ana kadarki 3 saniyelik
     meslek ilerlemesi sessizce kaybolurdu. */
  const kapat = () => {
    clearInterval(zamanlayici);
    hepsiniBosalt().catch(() => { /* gunluge yazildi */ });
  };
  ONCEKI_KAPAT = kapat;

  // ------------------------------------------------------------ mesaj yonlendirici
  const KAYITLAR = {
    'profession.learn': ogren,
    'profession.scroll': parsomen,
    'gather.start': gatherStart,
    'gather.cancel': gatherCancel,
  };

  function mesaj(ws, t, d) {
    /* HAREKET TOPLAMAYI IPTAL EDER. `move.click` BIZIM mesajimiz degil -
       yan etkiyi uygulayip FALSE donuyoruz ki cekirdek hareketi islesin. */
    if ((t === 'move.click' || t === 'move.stop') && ws?.toplama) toplamaBitir(ws);

    const isle = KAYITLAR[t];
    if (!isle) return false;
    if (!ws?.char) return true;          // yetkisiz soket: yut
    isle(ws, d ?? {});
    return true;
  }

  /* ----------------------------------------------- alet <-> meslek yuzeyi
   * Paket bu esleseyi SABIT bir harita olarak tasiyor (paket @8693535):
   *   lY = { profession_axe: `lumberjack`, profession_pickaxe: `miner` }
   *   uY(wt) = wt in lY
   * Bizde ayni harita professions.json'daki toolWeaponType alanlarindan
   * TURETILIR (sabit yazilmaz) - kaynak: GERCEK/paket_veri/config/
   * professions.json -> professions[].toolWeaponType.
   *
   * Bu yuzeyin varlik sebebi, ayni kuralin bu modulun DISINDA da gerekmesi:
   *   - err.profession.tool_no_combat : toplama aleti kusanikken beceri/oto
   *     saldiri yok (paket @25692593, istemci on-kontrolu MP/HP'den SONRA,
   *     ERR_REQ_WEAPON'dan ONCE calisiyor)  -> gameloop.js + sistem_beceri.js
   *   - err.profession.required : meslegi olmayan karakter meslek aletini
   *     KUSANAMAZ (paket @25791740)          -> sistem_envanter.js
   * Ikisi de baska ajanlarin dosyasi; kural TEK YERDE (burada) dursun diye
   * salt-okunur olarak disa aciliyor. Hicbir durumu degistirmez. */
  const ALET_MESLEGI = new Map(
    MESLEK.professions
      .filter(m => typeof m.toolWeaponType === 'string' && m.toolWeaponType)
      .map(m => [m.toolWeaponType, m.id]));

  /** weaponType -> meslek id ('lumberjack' | 'miner'), degilse null. */
  const aletMeslegi = (weaponType) => ALET_MESLEGI.get(String(weaponType ?? '')) ?? null;
  /** Karakter su an bir TOPLAMA ALETI mi kusanmis? (paket uY()) */
  const aletTutuyor = (ch) => aletMeslegi(silahDef(ch)?.weaponType) !== null;
  /** Karakterin o meslegi var mi? (kusanma kapisi icin) */
  const meslegiVarMi = (ch, meslekId) => meslekler(ch).some(m => m.id === meslekId);
  /** Yerellestirme parametresi icin meslek adi. */
  const meslekAdi = (meslekId) => meslekById.get(meslekId)?.name ?? String(meslekId);

  return {
    mesaj,
    /* KALICILIK KANCALARI - server.js bunlari ADA GORE buluyor:
         yukle(ch)        -> server.js:1590 modulleriYukle (zone.init ONCESI, await)
         selfAlanlari(ch) -> server.js:620  selfPayload/modulKatkisi
         webBagla(pool)   -> server.js:405  initSql sonrasi ortak havuz
         hepsiniBosalt()  -> kapanista bekleyen TP yazimlarini indirir */
    yukle, selfAlanlari, webBagla, hepsiniBosalt,
    // salt-okunur alet/meslek yuzeyi (bkz. yukaridaki not)
    aletMeslegi, aletTutuyor, meslegiVarMi, meslekAdi,
    /* plan md.46: TP kazandiran TEK yetkili yordam. Kardes modul
       sistem_gelistirme.js (stone.craft) bunu ctx.sistemOrnegi('meslek')
       uzerinden cagirir; seviye dongusu / 207 / bildirim / SQL yazimi
       ikinci bir yere KOPYALANMASIN diye disa aciliyor. */
    meslekTpEkle,
    /* --------- birim testi ve tani icin acilan ic yuzey (oyun kullanmaz) --------- */
    _t: {
      MESLEK, GATHER, meslekById, dugumById, dereceById, kaynakMeslegi, malzeme,
      dugumler, xpSonraki, ogrenmeUygun, bantSec, tierSec, cantayaEkle, esyaDef,
      dugumPayload, dereceSec, vurus, toplamaBitir, dugumTuket, dolumTik,
      ilgiTik, toplamaTik, meslekPayload,
      sayim: () => ({ el: ONBELLEK.elSayi, agac: ONBELLEK.agacSayi, sql: sqlDurum }),
      /* Sadece KENDI kancasini temizler; daha yeni bir ornek kurulduysa
         onun kancasini bozmaz. */
      dur: () => { kapat(); if (ONCEKI_KAPAT === kapat) ONCEKI_KAPAT = null; },
      /* Yalnizca test icin: modul kapsamindaki dugum onbellegini bosaltir. */
      onbellegiBosalt: () => { DUGUM_ONBELLEK = null; },
    },
  };
}
