/**
 * YASAYAN DUNYA - NPC YASAM DONGUSU
 * =============================================================================
 * Kullanicinin istegi: "Moblari NPC'leri YASAYAN BIR DUNYA yap. NPC'ler kendi
 * aralarinda gidip gezebilsinler, HALAY CEKEBILSINLER, sonra yerlerine gecsinler
 * tekrar."
 *
 * Bu modul UC davranis uretir ve HICBIRI istemci yamasi gerektirmez:
 *
 *   1) GEZINME  - dekoratif NPC evinin cevresinde yurur, sonra evine doner ve
 *                 AUTHORED yonune geri bakar.
 *   2) SOHBET   - yan yana duran iki dekoratif NPC ortada bulusur, birbirine
 *                 doner, bir sure durur, sonra ikisi de evine doner.
 *   3) SENLIK   - kasaba meydaninda GERCEKTEN HALAY CEKEN ambient koyluler.
 *
 * =========================== NEDEN CALISIYOR (PAKET KANITI) ==================
 * Istemci paketi (GUNCEL-2026-09-03/app/index-DzRqDn3Z.js) uzerinde dogrulandi:
 *
 *  A) HAREKET KIND'DAN BAGIMSIZ. Uc kod yolu da varliga id ile bakiyor,
 *     kind/id-bandi ayrimi YOK:
 *       @19722756  m$.on(`entity.move`, e => { ...; Q.applyMove(e) })
 *       @18736520  applyMove(e){ let t=this.entities.get(e.id); if(!t)return;
 *                               ... t.path={fx,fz,tx,tz,speed,t0} }
 *       @18743516  Vgt(e,t,n){ let r=e.path; ...
 *                              e.rotY=Math.atan2(i,a); c>=1 && (e.path=null) }
 *       @19674600  kare dongusu: for (let e of Q.entities.values()) { ... Vgt(e,...) }
 *     => NPC entity id'sine entity.move (134) gondermek YETER.
 *
 *  B) NPC ID'LERI OTURUM BOYU GECERLI. server.js zoneNpcEntities() bolgenin TUM
 *     NPC'lerini zone.init'te yolluyor ve world.js:722 gorunenleriKur() onlari
 *     ws.gorunen'e koyuyor; ilgiGuncelle YALNIZ z.entities uzerinde donduğu ve
 *     NPC'ler orada olmadigi icin bir NPC id'si ASLA `rem` edilmiyor. Yani
 *     gezinme.js'in kullandigi kisi-bazli kapi (ws.gorunen.has(id)) NPC'ler icin
 *     de hazir calisiyor.
 *
 *  C) YON (rotY) YALNIZ HAREKETLE DEGISIR. applyStop ve applyTeleport rotY'ye
 *     DOKUNMUYOR; Vgt ilk karede rotY = atan2(tx-fx, tz-fz) yaziyor. Bu yuzden
 *     eve varan NPC'nin authored yonunu geri yuklemek icin 0.05 birimlik minik
 *     bir entity.move ("yon duzeltme") gonderiliyor: ayni karede path biter,
 *     goze gorunmez, isim etiketi zipzip etmez (state.delta rem+add YAPILMIYOR).
 *
 *  D) HALAY ICIN KARAKTER GORUNUMU. Gorunum fabrikasi KIND'A DEGIL modelKey'e
 *     bakiyor (@19663400 `me = t => (t.kind===`ground_item` ? hAt : nkt(t.modelKey))(...)`)
 *     ve her karakter preseti @19462409 `for (let t of e.characterPresets)
 *     J3(t.id, qOt(t.id))` ile kayitli. Yani modelKey'i bir preset id'si olan
 *     `kind:'npc'` varligi TAM karakter gorunumu alir: walk/run/idle klipleri VE
 *     playSkillFinisher. Dansi ateslemek icin bare `skill.fire` (143) yeterli:
 *       @18387421 onServerSkillFire - bekleyen cast yoksa AYRI bir aksiyon
 *                 kaydi acip dogrudan `phase:'finisher'`e gecer,
 *       @19672327 finisher(e,t){ ... u.get(e.entityId)?.playSkillFinisher?.(e.token, t.groupId) }
 *     Klip: skill-fx.json bard_dancea_* -> anim.groups[0] {name:'shot',
 *     durationMs:3000, loop:false}; 12 glb dosyasinin hepsi client/assets/skills
 *     altinda mevcut.
 *
 *  E) AMBIENT KOYLUYE TIKLAMAK GUVENLI. k_t() (@18750350):
 *       let n = (e.npcId===void 0 ? void 0 : z$.npcsById.get(e.npcId))
 *               ?? [...z$.npcsById.values()].find(t => t.modelKey === e.modelKey);
 *       return n?.shop||n?.bank||n?.trainer ? {...} : null;
 *     Koylunun npcId'si YOK ve modelKey'i bir karakter preseti; istemcinin NPC
 *     katalogunda o modelKey ile kayit bulunmadigi icin n undefined -> null
 *     doner -> pencere ACILMAZ, sunucuya mesaj GITMEZ. (Ayni kod, gezen
 *     dekoratif NPC'ler icin de null doner: onlarin katalog kaydi yok.)
 *
 * ============================ NE YAPILAMAZ (DURUST SINIR) ====================
 *  - GERCEK NPC MODELLERIYLE HALAY IMKANSIZ. Olculdu: client/assets/models +
 *    characters + anims = 378 glb tarandi, dance|emote|cheer|clap|salute|wave
 *    iceren TEK BIR animasyon adi yok. Ustelik NPC gorunumune (W3) ad ile klip
 *    caldiran hicbir s2c karesi yok: setGathering yalniz karakter gorunumunde
 *    (qOt) var ve tek isim-tabanli kanal gather.action'in semasi SERT ENUM
 *    (@18718691 `anim: hJ(['cut','mine'])`). Bu yuzden halay, karakter gorunumlu
 *    AMBIENT KOYLULERLE yapiliyor.
 *  - GEZEN DEKORATIF NPC KAYAR. 143 NPC modelinin 142'sinde walk/run klibi YOK
 *    (yalniz basic/time/stand varyantlari) ve istemci NPC gorunumlerini
 *    runSpeedU:0 ile kaydediyor. Bu bir VARLIK sinirlamasidir, kod hatasi degil.
 *    Duzeltmesi istemci yamasi ister (bkz. dosya sonundaki RECETE blogu).
 *
 * ============================== DEMIR GUVENLIK KURALI ========================
 * SADECE BEYAZ LISTEDEKI DEKORATIF NPC GEZER. Sebep olculdu: sunucunun NPC
 * menzil kapisi NPC'nin DONMUS ev konumunu kullaniyor
 *   sistem_dukkan.js       KONUMLAR world.json npcs[] x/z'den BIR KEZ kurulur,
 *                          sonra dist(oyuncu, KONUMLAR[npcId]) <= menzil
 *   ayni donmus kaynak: sistem_banka-depo, sistem_borsa, sistem_meslek,
 *                       sistem_donus-isinlanma
 * istemci ise CANLI konuma yuruyor (@18749556). Gezen bir dukkanci NPC'nin tam
 * yaninda duran oyuncu ERR_RANGE alirdi - yani "NPC'yi buldum ama alisveris
 * calismiyor" felaketi. Uc katli koruma:
 *   1. Beyaz liste yalnizca dekoratif NPC icerir (data/npc-yasam.json).
 *   2. ACILIS DOGRULAMASI: liste npcshops.json + professions.json + teleporters
 *      + TUM sistem_*.js kaynaklariyla kesistirilir; ihlal ATILIR ve loglanir.
 *   3. Yaricap sert tavani 15 birim = npcshops.json'daki EN KUCUK
 *      interactRangeU. Liste hatali olsa bile menzil kapisi kirilmaz.
 * Ayrica DIYALOG KILIDI: bir oyuncunun mesaji bir NPC'yi isaret ettigi anda
 * (d.npcId ya da NPC bandindaki d.id) o NPC evine doner ve kilitlenir.
 *
 * =============================== PERFORMANS ==================================
 *  - Oyuncusu olmayan bolge HIC tiklenmez.
 *  - ilgiMesafesiU (120 = world.js GORUS_MESAFESI) disindaki NPC dondurulur ve
 *    sessizce evine oturtulur: bos bolgede sifir CPU, sifir bayt.
 *  - Bosta duran NPC icin AG TRAFIGI SIFIRDIR. entity.move yalniz YENI BACAK
 *    baslarken (ve eve varista tek bir yon duzeltmesi icin) gider; aradaki tum
 *    kareleri istemci kendi interpolasyonuyla uretir.
 *
 * =============================== SOZLESME ====================================
 *   export function kur(ctx) -> { mesaj(ws,t,d,q):boolean, ... }
 * mesaj() HER ZAMAN false doner: bu modul hicbir istemci mesajini TUKETMEZ,
 * yalnizca NPC'ye dokunan mesajlari GOZLEMLEYIP kilit koyar. Bu yuzden
 * SISTEM_ADLARI dizisinde ONDE olmalidir (bkz. dosya sonu RECETE).
 */

import fs from 'node:fs';
import path from 'node:path';

/* Modul yeniden kurulunca (GM panelinden ayar kaydedilince sistemleriKur()
   calisiyor) NPC'ler yerinden zipzip etmesin, koyluler ikilenmesin diye
   calisan durum devredilir - sistem_yerinde-dirilis.js ile ayni kalip. */
let ONCEKI_ORNEK = null;
let ONCEKI_DURUM = null;

/** sistem_*.js kaynak taramasi surec basina BIR KEZ yapilir (yaklasik 1 MB). */
let SISTEM_KAYNAK = null;

/* NPC varlik id bandi - server.js:863 `let npcEntitySeq = 500000;` ve
   world.js:22 `const MOB_ID_BASE = 1_000_000;`. Oyuncular 1..499999. */
const NPC_ID_ALT = 500_000;
const NPC_ID_UST = 1_000_000;

/** Dosya bulunamazsa modul sessizce kapanir - sunucuyu durdurmaz. */
const VARSAYILAN = {
  acik: false,
  adminAnahtari: 'npcYasamAcik',
  tikMs: null,
  ilgiMesafesiU: 120,
  birakmaMesafesiU: 150,
  gezinme: { acik: false },
  sohbet: { acik: false },
  koruma: {},
  senlik: { acik: false },
  beyazListe: {},
};

export function kur(ctx) {
  if (ONCEKI_ORNEK) {
    try { ONCEKI_ORNEK.dur(); } catch { /* onemsiz */ }
    ONCEKI_ORNEK = null;
  }
  /* `devirYok` YALNIZ harness icindir: uretimde durum devri sayesinde GM
     panelinden ayar kaydedilince NPC'ler yerinden zipzip etmez. */
  const devir = ctx.devirYok ? null : ONCEKI_DURUM;
  ONCEKI_DURUM = null;

  const world = ctx.world;
  const frame = ctx.frame ?? (() => {});
  const log = ctx.log ?? (() => {});
  const GCFG = ctx.GCFG ?? {};
  const simdi = ctx.now ?? (() => Date.now());
  const rnd = ctx.rastgele ?? Math.random;          // harness bunu tohumlayabilir
  const dataDir = ctx.dataDir ?? '.';
  const sunucuDir = path.dirname(dataDir);

  const yurunebilir = typeof ctx.yurunebilirNokta === 'function'
    ? ctx.yurunebilirNokta
    : ((z, x0, z0, x1, z1, y0) => ({ x: x1, z: z1, y: y0, engellendi: false }));
  const zemin = (zid, x, z, oncekiY) => {
    try {
      if (typeof ctx.zoneGroundY === 'function') return ctx.zoneGroundY(zid, x, z, oncekiY);
      if (typeof world?.groundY === 'function') return world.groundY(zid, x, z, oncekiY);
    } catch { /* arazi yoksa duz zemin */ }
    return oncekiY ?? 0;
  };

  // ------------------------------------------------------------- ayarlar
  const CFG = ayarlariOku(dataDir, log);
  const G = { ...VARSAYILAN.gezinme, ...(CFG.gezinme ?? {}) };
  const S = { ...VARSAYILAN.sohbet, ...(CFG.sohbet ?? {}) };
  const K = { ...VARSAYILAN.koruma, ...(CFG.koruma ?? {}) };
  const SEN = { ...VARSAYILAN.senlik, ...(CFG.senlik ?? {}) };

  const tikMs = Number.isFinite(Number(CFG.tikMs)) && Number(CFG.tikMs) > 0
    ? Math.trunc(Number(CFG.tikMs))
    : Math.max(50, Math.round(1000 / (Number(GCFG.tickHz) || 10)));

  const ILGI = say(CFG.ilgiMesafesiU, 120);
  const BIRAK = say(CFG.birakmaMesafesiU, 150);
  const HIZ = Math.max(0.1, say(G.hizU, 2.25));
  const YARICAP = Math.max(0, say(G.yaricapU, 7.5));
  const BULUSMA_R = Math.max(0, say(G.bulusmaYaricapU, 10));
  const EV_MAX = Math.max(0.1, say(G.evdenMaxU, 15));
  const ADIM_MIN = Math.max(0.1, say(G.adimMinU, 2));
  const DUZELT_U = Math.max(0.001, say(G.yonDuzeltmeU, 0.05));

  /** Oyuncu etkilesim menzili - GCFG'den CANLI okunur (admin degistirebilir). */
  const yakinlikU = () => {
    const v = Number(K.oyuncuYakinlikU);
    if (Number.isFinite(v) && v > 0) return v;
    const g = Number(GCFG.npcInteractRangeU);
    return Number.isFinite(g) && g > 0 ? g : 25;
  };

  /** Sistem acik mi? GM paneli (GCFG sayisi) dosyayi EZER. */
  const acikMi = () => {
    const g = Number(GCFG[CFG.adminAnahtari ?? 'npcYasamAcik']);
    if (Number.isFinite(g)) return g > 0;
    return CFG.acik !== false;
  };

  // --------------------------------------------------- beyaz liste dogrulamasi
  const WORLD = world?.worldData ?? null;
  const { beyaz, atilan } = beyazListeyiDogrula(CFG, WORLD, dataDir, sunucuDir, log);

  /* --------------------------------------------------------------- durum
     zoneId -> {
       npcler : Map<npcId, NPCDurumu>
       kimlik : 'bekliyor' | 'hazir' | 'basarisiz'
       senlik : { merkez, koyluler[], faz, fazBitis } | null
     }                                                                     */
  const BOLGE = devir?.BOLGE instanceof Map ? devir.BOLGE : new Map();
  /** npcId -> kilit bitis zamani (diyalog / hedefleme). */
  const KILIT = devir?.KILIT instanceof Map ? devir.KILIT : new Map();
  const sayac = devir?.sayac ?? { bacak: 0, engel: 0, sohbet: 0, dans: 0, duzeltme: 0, tik: 0 };

  function bolgeDurumu(zid) {
    let b = BOLGE.get(zid);
    if (!b) { b = { npcler: new Map(), kimlik: 'bekliyor', senlik: null }; BOLGE.set(zid, b); }
    return b;
  }

  // ------------------------------------------------------------ yardimcilar
  function say(v, yedek) { const n = Number(v); return Number.isFinite(n) ? n : yedek; }
  function aralik(a, b) { return a + rnd() * Math.max(0, b - a); }
  function mes(ax, az, bx, bz) { return Math.hypot(ax - bx, az - bz); }

  /** Bolgedeki kimlik dogrulanmis oyuncular. */
  function oyunculariAl(zid) {
    const out = [];
    for (const ws of (world?.bolgeOyunculari?.(zid) ?? [])) {
      if (ws?.isAuthed && ws.char) out.push(ws);
    }
    return out;
  }

  function enYakinOyuncu(oyuncular, x, z) {
    let en = Infinity;
    for (const ws of oyuncular) {
      const d = mes(x, z, ws.char.x, ws.char.z);
      if (d < en) en = d;
    }
    return en;
  }

  /**
   * entity.move'u SADECE bu varligi GOREN oyunculara gonderir.
   * gezinme.js #yolla ile ayni kapi (ws.gorunen.has(id)) - NPC id'leri
   * ws.gorunen'den hic silinmedigi icin (world.js:722 + ilgiGuncelle NPC
   * gormez) bu kapi NPC'ler icin de dogrudan calisir.
   */
  function hareketYolla(zid, id, fx, fz, fy, tx, tz, hiz) {
    for (const ws of oyunculariAl(zid)) {
      if (!ws.gorunen?.has(id)) continue;
      frame(ws, 'entity.move', {
        id,
        fx: +fx.toFixed(2), fz: +fz.toFixed(2), fy: +(fy ?? 0).toFixed(2),
        tx: +tx.toFixed(2), tz: +tz.toFixed(2),
        speed: hiz,
      });
    }
  }

  /**
   * YON DUZELTME - 0.05 birimlik entity.move.
   * Neden baska yol yok: applyStop/applyTeleport rotY'ye dokunmuyor; tek
   * alternatif state.delta rem+add olurdu (gorunum yeniden kurulur, isim
   * etiketi zipzip eder). SART: mesafe > 0 ve speed > 0 - speed 0 verilirse
   * istemcide c hep 0 kalir ve varlik SONSUZA KADAR 'moving' gorunur.
   */
  function yonuDuzelt(zid, id, s, hedefRotY) {
    const tx = s.x + Math.sin(hedefRotY) * DUZELT_U;
    const tz = s.z + Math.cos(hedefRotY) * DUZELT_U;
    hareketYolla(zid, id, s.x, s.z, s.y, tx, tz, HIZ);
    s.x = tx; s.z = tz; s.rotY = hedefRotY;
    sayac.duzeltme++;
  }

  /** Yurumekte olan bacagi ilerletir. true = hala yuruyor. */
  function ilerlet(zid, s, t) {
    const b = s.bacak;
    if (!b) return false;
    const o = (t - b.bas) / Math.max(1, b.bit - b.bas);
    if (o >= 1) {
      s.x = b.tx; s.z = b.tz;
      s.y = zemin(zid, s.x, s.z, s.y);
      s.bacak = null;
      return false;
    }
    s.x = b.fx + (b.tx - b.fx) * o;
    s.z = b.fz + (b.tz - b.fz) * o;
    s.y = zemin(zid, s.x, s.z, s.y);
    s.rotY = Math.atan2(b.tx - b.fx, b.tz - b.fz);   // istemci de boyle donduruyor
    return true;
  }

  /**
   * Hedefe bir bacak baslatir. Hedef once EV DISKINE (evdenMax), sonra
   * nav.bin'e karsi kirpilir. Basarisizsa false doner (duvar dibi).
   */
  function bacakBaslat(zid, s, hedefX, hedefZ, t, minU = ADIM_MIN, evR = EV_MAX) {
    let tx = hedefX, tz = hedefZ;
    const ex = tx - s.evX, ez = tz - s.evZ;
    const eu = Math.hypot(ex, ez);
    if (eu > evR && eu > 0) { tx = s.evX + ex / eu * evR; tz = s.evZ + ez / eu * evR; }

    /* 6. parametre = baslangic Y TOHUMU. Gecmezsek nav.js arazi tohumuna
       duser ve kopru/platform ustundeki varligin yolu ALT KAT yuksekligine
       gore dogrulanir (gezinme.js:149 ayni notu tasiyor). */
    const yol = yurunebilir(zid, s.x, s.z, tx, tz, s.y);
    const uz = mes(s.x, s.z, yol.x, yol.z);
    if (uz < minU) { sayac.engel++; return false; }

    const fx = s.x, fz = s.z, fy = s.y ?? 0;
    s.bacak = {
      fx, fz, tx: yol.x, tz: yol.z, hiz: HIZ,
      bas: t, bit: t + Math.round(uz / HIZ * 1000),
    };
    s.rotY = Math.atan2(yol.x - fx, yol.z - fz);
    sayac.bacak++;
    hareketYolla(zid, s.entityId, fx, fz, fy, yol.x, yol.z, HIZ);
    return true;
  }

  // ==========================================================================
  // NPC KIMLIKLERI (entityId <-> npcId)
  // ==========================================================================
  /**
   * server.js zoneNpcEntities() NPC varlik id'lerini AYRI bir sayacla
   * (npcEntitySeq, 500000'den) ve bolge basina ONBELLEKLI olarak uretir; bu
   * eslesme sistemCtx()'te DISARI ACILMIYOR. Iki yol var:
   *
   *   1) ctx.zoneNpcEntities varsa (server.js'e tek satirla eklenebilir -
   *      bkz. RECETE) dogrudan kullanilir. TERCIH EDILEN yol.
   *   2) Yoksa YENIDEN KURULUR: bir bolgenin NPC id'leri, world.json'daki
   *      npcs[] (katalogda karsiligi olanlar) + teleporters[] sirasinda
   *      ARDISIK bir blok olusturur. Oyuncunun ws.gorunen kumesindeki NPC
   *      bandi (500000 < id < 1000000) id'leri sirali okunur; SAYI ve
   *      ARDISIKLIK tutuyorsa indis indis eslesir, tutmuyorsa bolge
   *      GUVENLI TARAFTA kapatilir (sessiz bozulma yok).
   */
  function kimlikCoz(zid, oyuncular) {
    const b = bolgeDurumu(zid);
    if (b.kimlik === 'hazir' || b.kimlik === 'basarisiz') return b.kimlik === 'hazir';

    const zone = WORLD?.zones?.[zid];
    if (!zone) { b.kimlik = 'basarisiz'; return false; }

    // --- 1. yol: cekirdek kanca
    if (typeof ctx.zoneNpcEntities === 'function') {
      try {
        for (const e of ctx.zoneNpcEntities(zid)) {
          const st = b.npcler.get(e.npcId);
          if (st) st.entityId = e.id;
        }
        return kimlikBitir(b, zid, 'ctx.zoneNpcEntities');
      } catch (e) {
        log(`[npc-yasam] ${zid}: zoneNpcEntities hatasi, yeniden kurmaya dusuluyor (${String(e?.message ?? e).slice(0, 80)})`);
      }
    }

    // --- 2. yol: ws.gorunen'den yeniden kurma
    const beklenen = [];
    for (const n of zone.npcs ?? []) {
      if (WORLD?.npcCatalog?.[n.npcId]) beklenen.push(n.npcId);
    }
    for (const t of zone.teleporters ?? []) beklenen.push(`tp_${t.id}`);
    if (!beklenen.length) { b.kimlik = 'basarisiz'; return false; }

    const gozlenen = new Set();
    for (const ws of oyuncular) {
      if (!ws.gorunen) continue;
      for (const id of ws.gorunen) if (id > NPC_ID_ALT && id < NPC_ID_UST) gozlenen.add(id);
    }
    if (!gozlenen.size) return false;                    // henuz oyuncu zone.init almadi

    const idler = [...gozlenen].sort((a, c) => a - c);
    if (idler.length !== beklenen.length
        || idler[idler.length - 1] - idler[0] !== idler.length - 1) {
      b.kimlik = 'basarisiz';
      log(`[npc-yasam] ${zid}: NPC id blogu eslesmedi (beklenen ${beklenen.length}, gozlenen ${idler.length}, ardisik=${idler[idler.length - 1] - idler[0] === idler.length - 1}). `
        + 'Bolge GUVENLIK GEREGI kapatildi; kalici cozum icin server.js sistemCtx()\'e zoneNpcEntities eklenmeli.');
      return false;
    }
    for (let i = 0; i < beklenen.length; i++) {
      const st = b.npcler.get(beklenen[i]);
      if (st) st.entityId = idler[i];
    }
    return kimlikBitir(b, zid, 'ws.gorunen yeniden kurma');
  }

  function kimlikBitir(b, zid, yol) {
    let eksik = 0;
    for (const [, st] of b.npcler) if (!st.entityId) eksik++;
    if (eksik) {
      log(`[npc-yasam] ${zid}: ${eksik} NPC icin varlik kimligi bulunamadi - o NPC'ler hareket etmeyecek (${yol})`);
    }
    b.kimlik = 'hazir';
    return true;
  }

  // ==========================================================================
  // NPC DURUMLARININ KURULUSU
  // ==========================================================================
  function npcleriKur(zid) {
    const b = bolgeDurumu(zid);
    const liste = beyaz.get(zid) ?? [];
    const imza = liste.join(',');
    if (b.npcImza === imza) return b;            // her tikte yeniden kurma yok
    const zone = WORLD?.zones?.[zid];
    if (!zone) { b.npcImza = imza; return b; }
    const gecerli = new Set(liste);

    // artik listede olmayanlari at (config degisti)
    for (const k of [...b.npcler.keys()]) if (!gecerli.has(k)) b.npcler.delete(k);

    let yeni = 0;
    for (const n of zone.npcs ?? []) {
      if (!gecerli.has(n.npcId)) continue;
      if (b.npcler.has(n.npcId)) continue;
      yeni++;
      const evY = n.y ?? zemin(zid, n.x, n.z, undefined);
      b.npcler.set(n.npcId, {
        npcId: n.npcId,
        entityId: null,
        evX: n.x, evZ: n.z, evY, evRotY: n.rotY ?? 0,
        x: n.x, z: n.z, y: evY, rotY: n.rotY ?? 0,
        bacak: null,
        faz: 'ev',
        fazBitis: 0,
        kalanBacak: 0,
        esId: null,
        donusDeneme: 0,
        yonDuzeltildi: true,
      });
    }
    b.npcImza = imza;
    /* Listeye YENI NPC girdiyse kimlik eslesmesi bastan cozulmeli - yoksa
       yeni kayit entityId'siz kalir ve sessizce hic hareket etmez. */
    if (yeni && b.kimlik === 'hazir') b.kimlik = 'bekliyor';
    return b;
  }

  // ==========================================================================
  // NPC TIKI
  // ==========================================================================
  function npcTik(zid, b, oyuncular, t) {
    for (const [, s] of b.npcler) {
      if (!s.entityId) continue;

      const d = enYakinOyuncu(oyuncular, s.x, s.z);

      /* ---- PERFORMANS KAPISI: kimsenin gormedigi NPC hic tiklenmez.
         Yurumekte olan bacak SUNUCUDA MANTIKSAL OLARAK BITIRILIR (istemci de
         onu bitirecek - entity.move zaten gonderilmisti), sonra NPC 'donus'a
         alinir. TEK BIR BAYT bile gitmez.

         NEDEN "EVE ISINLA" DEGIL: bacagi ortada kesip sunucu konumunu eve
         tasirsak istemcideki varlik bacagin SONUNDA kalir - iki taraf ayrilir.
         Sonraki entity.move'da istemci fx'i 3 birimden uzak bulup varligi
         ZIPLATIRDI (applyMove). Bacagi bitirmek iki tarafi ayni noktada
         birakir; NPC evine, oyuncu geri gelince YURUYEREK doner. */
      if (d > ILGI) {
        if (s.bacak) {
          s.x = s.bacak.tx; s.z = s.bacak.tz;
          s.y = zemin(zid, s.x, s.z, s.y);
          s.bacak = null;
        }
        s.esId = null;
        if (s.faz !== 'ev') { s.faz = 'donus'; s.donusSonraki = 0; }
        continue;
      }

      /* ---- KORUMA: diyalog kilidi ya da (mod 'hepsi' ise) oyuncu etkilesim
         menzilinde. Bu NPC evine doner ve orada bekler. */
      const kilitli = t < (KILIT.get(s.npcId) ?? 0)
        || (K.oyuncuYakinlikModu === 'hepsi' && enYakinOyuncu(oyuncular, s.evX, s.evZ) <= yakinlikU());
      if (kilitli) {
        s.esId = null;
        if (s.bacak) { if (ilerlet(zid, s, t)) continue; }
        if (!eveDon(zid, s, t)) continue;
        eveVardi(zid, s, t);
        continue;
      }

      if (G.acik === false) continue;

      // ---- yurumekte olan bacagi ilerlet
      if (s.bacak) { if (ilerlet(zid, s, t)) continue; }

      switch (s.faz) {
        case 'gez': {
          if (s.kalanBacak > 0) {
            if (yeniGezintiBacagi(zid, s, t)) { s.kalanBacak--; continue; }
            s.fazBitis = t + say(G.yenidenDeneMs, 3000);
            s.kalanBacak = 0;
            s.faz = 'donus';
            continue;
          }
          s.faz = 'donus';
          continue;
        }
        case 'bulus': {
          // hedefe vardi (ya da bacak kurulamadi) -> sohbet
          const es = s.esId ? b.npcler.get(s.esId) : null;
          if (!es || es.esId !== s.npcId) { s.faz = 'donus'; s.esId = null; continue; }
          if (es.faz === 'bulus' && !es.bacak) {
            // ikisi de vardi: birbirine don
            yonuDuzelt(zid, s.entityId, s, Math.atan2(es.x - s.x, es.z - s.z));
            yonuDuzelt(zid, es.entityId, es, Math.atan2(s.x - es.x, s.z - es.z));
            const sure = aralik(say(S.sureMinMs, 6000), say(S.sureMaxMs, 15000));
            s.faz = 'sohbet'; s.fazBitis = t + sure;
            es.faz = 'sohbet'; es.fazBitis = t + sure;
            sayac.sohbet++;
          } else if (t > s.fazBitis) {
            s.faz = 'donus'; s.esId = null;       // es gelemedi (duvar) - vazgec
          }
          continue;
        }
        case 'sohbet': {
          if (t >= s.fazBitis) { s.faz = 'donus'; s.esId = null; }
          continue;
        }
        case 'donus': {
          if (!eveDon(zid, s, t)) continue;
          eveVardi(zid, s, t);
          continue;
        }
        default: {   // 'ev'
          if (t < s.fazBitis) continue;
          gezintiBaslat(zid, b, s, oyuncular, t);
          continue;
        }
      }
    }
  }

  /**
   * Eve yurumeyi surdurur. true = ev noktasindayiz (varis islenebilir).
   * KURTARMA: nav eve donusu ust uste kapatirsa (NPC bir kose icine sikismis
   * olabilir) entity.teleport (136) ile ev noktasina oturtulur. Isinlanma
   * NORMAL yol degil, son caredir; rotY'ye dokunmadigi icin hemen ardindan
   * yon duzeltmesi gelir (eveVardi).
   */
  function eveDon(zid, s, t) {
    const uz = mes(s.x, s.z, s.evX, s.evZ);
    if (uz <= 0.2) { s.donusDeneme = 0; return true; }
    if (t < (s.donusSonraki ?? 0)) return false;
    if (bacakBaslat(zid, s, s.evX, s.evZ, t, 0.1)) { s.donusDeneme = 0; return false; }

    /* SIKISMA COZUCU: dogrudan ev yonu kapali (NPC bir kosede ya da duvarin
       dibinde). Ev yonunu +-60/90/135 derece dondurup KISA bir ara adim
       atiyoruz; boylece NPC duvardan siyrilip bir sonraki tikte eve
       yonelebiliyor. Olculdu: npc_ch_kisaeng2/6 gibi engel orani yuksek
       noktalarda (gecerli bacak %27 / %50) donus bu adim olmadan tikaniyordu. */
    const dx = s.evX - s.x, dz = s.evZ - s.z;
    const ad = Math.min(uz, 3);
    for (const aci of [Math.PI / 3, -Math.PI / 3, Math.PI / 2, -Math.PI / 2, Math.PI * 0.75, -Math.PI * 0.75]) {
      const c = Math.cos(aci), sn = Math.sin(aci);
      const nx = s.x + (dx * c - dz * sn) / uz * ad;
      const nz = s.z + (dx * sn + dz * c) / uz * ad;
      if (bacakBaslat(zid, s, nx, nz, t, 0.3)) { s.donusDeneme = 0; return false; }
    }

    s.donusDeneme = (s.donusDeneme ?? 0) + 1;
    s.donusSonraki = t + say(G.yenidenDeneMs, 3000);
    if (s.donusDeneme < 5) return false;
    s.donusDeneme = 0;
    s.x = s.evX; s.z = s.evZ; s.y = s.evY; s.bacak = null;
    for (const ws of oyunculariAl(zid)) {
      if (!ws.gorunen?.has(s.entityId)) continue;
      frame(ws, 'entity.teleport', {
        id: s.entityId, x: +s.x.toFixed(2), z: +s.z.toFixed(2), y: +(s.y ?? 0).toFixed(2),
      });
    }
    log(`[npc-yasam] ${zid}/${s.npcId}: nav eve donusu kapatti - ev noktasina oturtuldu`);
    return true;
  }

  /** Eve varis: konumu tam eve oturt, AUTHORED yonu tek karede geri yukle. */
  function eveVardi(zid, s, t) {
    s.x = s.evX; s.z = s.evZ; s.y = s.evY;
    s.faz = 'ev';
    s.fazBitis = t + aralik(say(G.evdeDinlenMinMs, 8000), say(G.evdeDinlenMaxMs, 25000));
    if (!s.yonDuzeltildi) {
      yonuDuzelt(zid, s.entityId, s, s.evRotY);
      s.yonDuzeltildi = true;
    }
  }

  function yeniGezintiBacagi(zid, s, t) {
    const deneme = Math.max(1, Math.trunc(say(G.deneme, 4)));
    for (let i = 0; i < deneme; i++) {
      const sure = aralik(say(G.bacakMinMs, 3000), say(G.bacakMaxMs, 9000));
      const uz = HIZ * (sure / 1000);
      const a = rnd() * Math.PI * 2;
      if (bacakBaslat(zid, s, s.x + Math.cos(a) * uz, s.z + Math.sin(a) * uz, t, ADIM_MIN, YARICAP)) {
        s.yonDuzeltildi = false;
        return true;
      }
    }
    return false;
  }

  function gezintiBaslat(zid, b, s, oyuncular, t) {
    // --- SOHBET denemesi: yan yana duran bosta bir komsu var mi?
    if (S.acik !== false && rnd() < say(S.olasilik, 0.35)) {
      const R = say(S.eslesmeMesafesiU, 20);
      for (const [, o] of b.npcler) {
        if (o === s || !o.entityId || o.faz !== 'ev' || o.esId) continue;
        if (t < (KILIT.get(o.npcId) ?? 0)) continue;
        if (mes(s.evX, s.evZ, o.evX, o.evZ) > R) continue;
        if (enYakinOyuncu(oyuncular, o.x, o.z) > ILGI) continue;
        const mx = (s.evX + o.evX) / 2, mz = (s.evZ + o.evZ) / 2;
        const a = bacakBaslat(zid, s, mx, mz, t, 0.5, BULUSMA_R);
        const c = bacakBaslat(zid, o, mx, mz, t, 0.5, BULUSMA_R);
        if (a || c) {
          s.esId = o.npcId; o.esId = s.npcId;
          s.faz = 'bulus'; o.faz = 'bulus';
          s.yonDuzeltildi = false; o.yonDuzeltildi = false;
          const zamanAsimi = t + 20_000;             // es gelemezse vazgecme suresi
          s.fazBitis = zamanAsimi; o.fazBitis = zamanAsimi;
          return;
        }
        s.bacak = null; o.bacak = null;
        break;
      }
    }

    // --- normal gezinti: 1..3 bacak, sonra MUTLAKA eve donus
    if (YARICAP < ADIM_MIN) { s.fazBitis = t + 60_000; return; }   // yer dar - gezinme yok
    s.faz = 'gez';
    s.kalanBacak = Math.max(1, Math.round(aralik(say(G.gezintiBacakMin, 1), say(G.gezintiBacakMax, 3))));
    if (yeniGezintiBacagi(zid, s, t)) s.kalanBacak--;
    else { s.faz = 'ev'; s.fazBitis = t + say(G.yenidenDeneMs, 3000); }
  }

  // ==========================================================================
  // SENLIK (HALAY) - ambient karakter-preset koyluler
  // ==========================================================================
  function senlikKur(zid) {
    const b = bolgeDurumu(zid);
    const ayar = SEN.bolgeler?.[zid];
    /* `ayar` YOKSA senlik kurulmaz: bolgeler tablosunda yeri olmayan bir
       bolgede preset/kusam listesi de yoktur. */
    const istenen = SEN.acik !== false && ayar && ayar.acik !== false
      ? Math.max(0, Math.trunc(say(GCFG.npcYasamSenlikKisi, say(SEN.kisiSayisi, 0))))
      : 0;

    if (!istenen) { if (b.senlik) senlikSil(zid, b); return b; }
    if (b.senlik && b.senlik.koyluler.length === istenen && b.senlik.imza === (ayar.presetler ?? []).join(',')) return b;
    if (b.senlik) senlikSil(zid, b);

    const zone = WORLD?.zones?.[zid];
    if (!zone) return b;

    const halkaR = Math.max(1, say(SEN.halkaYaricapU, 6));
    const merkez = meydanSec(zid, zone, halkaR);
    if (!merkez) { log(`[npc-yasam] ${zid}: meydan bulunamadi - senlik kapali`); return b; }

    const presetler = (ayar.presetler ?? []).filter(Boolean);
    const kusam = SEN.kusamSetleri?.[ayar.kusam] ?? {};
    const danslar = (SEN.danslar ?? []).filter(Boolean);
    if (!presetler.length || !danslar.length) return b;

    const koyluler = [];
    for (let i = 0; i < istenen; i++) {
      const preset = presetler[i % presetler.length];
      const a = (i / istenen) * Math.PI * 2;
      const hx = merkez.x + Math.cos(a) * halkaR;
      const hz = merkez.z + Math.sin(a) * halkaR;
      /* Halka yuvasi nav.bin'e sorulur: kapali yonde koylu merkeze dogru
         yaklasir (olculdu: 6 birimlik halka hotan'da %78.9, donwhang'da
         %90.8 engelsiz - kalan yuvalar boyle kurtariliyor). */
      const yer = yurunebilir(zid, merkez.x, merkez.z, hx, hz, merkez.y);
      const y = zemin(zid, yer.x, yer.z, merkez.y);
      const id = typeof world?.yeniVarlikId === 'function' ? world.yeniVarlikId() : (NPC_ID_UST + 1 + i);
      koyluler.push({
        entityId: id,
        preset,
        ad: SEN.presetAdlari?.[preset] ?? preset,
        kusam,
        yuvaX: yer.x, yuvaZ: yer.z, yuvaY: y,
        x: yer.x, z: yer.z, y,
        rotY: Math.atan2(merkez.x - yer.x, merkez.z - yer.z),   // merkeze bakar
        bacak: null,
        dansId: danslar[i % danslar.length],
        sonDans: 0,
        yondu: true,
      });
    }
    b.senlik = {
      merkez, halkaR, koyluler,
      imza: (ayar.presetler ?? []).join(','),
      /* Koyluler halka yuvalarinda doguyor; 'topla' evresi fazBitis 0 ile
         hemen 'halay'a gecer - yani oyuncu meydana girdiginde dans ZATEN
         donuyor olur. */
      faz: 'topla',
      fazBitis: 0,
    };
    log(`[npc-yasam] ${zid}: senlik ${koyluler.length} koylu, meydan (${merkez.x.toFixed(1)}, ${merkez.z.toFixed(1)}) [${merkez.kaynak}] engelsiz %${merkez.puan.toFixed(1)}`);
    return b;
  }

  /**
   * MEYDAN SECIMI - koordinat UYDURULMAZ. world.json'daki uc aday
   * (playerSpawn / respawnPoint / NPC agirlik merkezi) halka yaricapinda
   * nav.bin'e karsi puanlanir, en engelsizi kazanir.
   * Olculen puanlar (6 birim halka): jangan playerSpawn %100, europe %100,
   * samarkand %100, donwhang %90.8, hotan playerSpawn %78.9 / npcCentroid %100.
   */
  function meydanSec(zid, zone, halkaR) {
    const adaylar = [];
    if (zone.playerSpawn) adaylar.push(['playerSpawn', zone.playerSpawn.x, zone.playerSpawn.z]);
    if (zone.respawnPoint) adaylar.push(['respawnPoint', zone.respawnPoint.x, zone.respawnPoint.z]);
    const npcs = zone.npcs ?? [];
    if (npcs.length) {
      adaylar.push(['npcAgirlikMerkezi',
        npcs.reduce((a, n) => a + n.x, 0) / npcs.length,
        npcs.reduce((a, n) => a + n.z, 0) / npcs.length]);
    }
    let en = null;
    for (const [kaynak, cx, cz] of adaylar) {
      const y = zemin(zid, cx, cz, undefined);
      let ok = 0; const N = 24;
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2;
        const tx = cx + Math.cos(a) * halkaR, tz = cz + Math.sin(a) * halkaR;
        const r = yurunebilir(zid, cx, cz, tx, tz, y);
        if (Math.hypot(r.x - tx, r.z - tz) < 0.5) ok++;
      }
      const puan = ok / N * 100;
      if (!en || puan > en.puan) en = { x: cx, z: cz, y, puan, kaynak };
    }
    return en && en.puan > 0 ? en : null;
  }

  function senlikSil(zid, b) {
    if (!b.senlik) return;
    const idler = b.senlik.koyluler.map(k => k.entityId);
    for (const ws of oyunculariAl(zid)) {
      const gorulen = idler.filter(id => ws.gorunen?.has(id));
      if (!gorulen.length) continue;
      for (const id of gorulen) ws.gorunen.delete(id);
      frame(ws, 'state.delta', { rem: gorulen });
    }
    b.senlik = null;
  }

  function koyluYuku(k) {
    return {
      id: k.entityId, kind: 'npc',
      /* modelKey = KARAKTER PRESETI. Gorunum fabrikasi kind'a degil buna
         bakiyor -> tam iskeletli karakter gorunumu (walk/run/idle + dans). */
      modelKey: k.preset,
      name: k.ad,
      x: +k.x.toFixed(2), z: +k.z.toFixed(2), y: +(k.y ?? 0).toFixed(2),
      rotY: +(k.rotY ?? 0).toFixed(3),
      ...(k.bacak ? { moving: { tx: +k.bacak.tx.toFixed(2), tz: +k.bacak.tz.toFixed(2), speed: k.bacak.hiz } } : {}),
      /* npcId BILEREK YOK: istemcinin k_t() kapisi npcId yoksa modelKey ile
         NPC katalogunda arar, karakter preseti orada olmadigi icin null
         doner -> tiklama hicbir sey yapmaz, sunucuya mesaj gitmez. */
      appearance: { style: k.preset, equip: { ...k.kusam } },
    };
  }

  /** Kendi varliklarimizin gorunurlugunu biz yonetiriz (world.js bilmiyor). */
  function senlikGorunurluk(zid, sen, oyuncular) {
    for (const ws of oyuncular) {
      const g = ws.gorunen ?? (ws.gorunen = new Set());
      const ekle = [], cikar = [];
      for (const k of sen.koyluler) {
        const d = mes(k.x, k.z, ws.char.x, ws.char.z);
        const var_ = g.has(k.entityId);
        if (!var_ && d <= ILGI) { g.add(k.entityId); ekle.push(koyluYuku(k)); }
        else if (var_ && d > BIRAK) { g.delete(k.entityId); cikar.push(k.entityId); }
      }
      if (ekle.length || cikar.length) {
        const d = {};
        if (ekle.length) d.add = ekle;
        if (cikar.length) d.rem = cikar;
        frame(ws, 'state.delta', d);
      }
    }
  }

  function senlikTik(zid, b, oyuncular, t) {
    const sen = b.senlik;
    if (!sen) return;

    // Meydani goren oyuncu yoksa: koyluler yuvalarina otursun, tik yakma.
    const yakin = enYakinOyuncu(oyuncular, sen.merkez.x, sen.merkez.z);
    if (yakin > ILGI + sen.halkaR + say(SEN.dagilmaYaricapU, 12)) {
      for (const k of sen.koyluler) {
        if (k.bacak || k.x !== k.yuvaX || k.z !== k.yuvaZ) {
          k.bacak = null; k.x = k.yuvaX; k.z = k.yuvaZ; k.y = k.yuvaY;
          k.rotY = Math.atan2(sen.merkez.x - k.x, sen.merkez.z - k.z);
        }
      }
      sen.faz = 'topla'; sen.fazBitis = 0;
      senlikGorunurluk(zid, sen, oyuncular);
      return;
    }

    // ---- evre gecisi
    if (t >= sen.fazBitis) {
      if (sen.faz === 'halay') { sen.faz = 'dagil'; sen.fazBitis = t + say(SEN.dagilmaSuresiMs, 20000); }
      else if (sen.faz === 'dagil') { sen.faz = 'topla'; sen.fazBitis = t + say(SEN.toplanmaSuresiMs, 12000); for (const k of sen.koyluler) k.yondu = false; }
      else { sen.faz = 'halay'; sen.fazBitis = t + say(SEN.halaySuresiMs, 30000); }
    }

    const dagilR = say(SEN.dagilmaYaricapU, 12);
    for (const k of sen.koyluler) {
      // bacagi ilerlet
      if (k.bacak) {
        const o = (t - k.bacak.bas) / Math.max(1, k.bacak.bit - k.bacak.bas);
        if (o >= 1) {
          k.x = k.bacak.tx; k.z = k.bacak.tz; k.y = zemin(zid, k.x, k.z, k.y); k.bacak = null;
        } else {
          k.x = k.bacak.fx + (k.bacak.tx - k.bacak.fx) * o;
          k.z = k.bacak.fz + (k.bacak.tz - k.bacak.fz) * o;
          k.y = zemin(zid, k.x, k.z, k.y);
          k.rotY = Math.atan2(k.bacak.tx - k.bacak.fx, k.bacak.tz - k.bacak.fz);
          continue;
        }
      }

      if (sen.faz === 'topla') {
        if (mes(k.x, k.z, k.yuvaX, k.yuvaZ) > 0.3) { koyluDon(zid, k, t); continue; }
        if (!k.yondu) { koyluYonu(zid, k, Math.atan2(sen.merkez.x - k.x, sen.merkez.z - k.z)); k.yondu = true; }
      } else if (sen.faz === 'dagil') {
        if (t >= (k.sonrakiMs ?? 0)) {
          const a = rnd() * Math.PI * 2;
          const u = 2 + rnd() * Math.max(0, dagilR - 2);
          koyluBacak(zid, k, sen.merkez.x + Math.cos(a) * u, sen.merkez.z + Math.sin(a) * u, t);
          k.sonrakiMs = t + aralik(say(G.bekleMinMs, 2000), say(G.bekleMaxMs, 7000));
          k.yondu = false;
        }
      } else {
        // ---- HALAY: merkeze bak ve dans klibini klip suresi kadar tekrarla
        if (mes(k.x, k.z, k.yuvaX, k.yuvaZ) > 0.3) { koyluDon(zid, k, t); continue; }
        if (!k.yondu) { koyluYonu(zid, k, Math.atan2(sen.merkez.x - k.x, sen.merkez.z - k.z)); k.yondu = true; }
        const klip = Math.max(200, say(SEN.dansKlipMs, 3000));
        if (t - k.sonDans >= klip) {
          k.sonDans = t;
          dansYolla(zid, k);
        }
      }
    }

    senlikGorunurluk(zid, sen, oyuncular);
  }

  /** Halka yuvasina donus - nav kapaliysa her tikte degil, araliklarla dener. */
  function koyluDon(zid, k, t) {
    if (t < (k.donusSonraki ?? 0)) return;
    if (!koyluBacak(zid, k, k.yuvaX, k.yuvaZ, t)) {
      k.donusSonraki = t + say(G.yenidenDeneMs, 3000);
      /* Yuvaya donus kalici olarak kapaliysa (koylu bir kose icine sikismis)
         yuvayi BULUNDUGU yere tasi - istemciye ekstra kare gitmez. */
      k.donusDeneme = (k.donusDeneme ?? 0) + 1;
      if (k.donusDeneme >= 5) { k.yuvaX = k.x; k.yuvaZ = k.z; k.yuvaY = k.y; k.donusDeneme = 0; k.yondu = false; }
    } else { k.donusDeneme = 0; }
  }

  function koyluBacak(zid, k, tx, tz, t) {
    const yol = yurunebilir(zid, k.x, k.z, tx, tz, k.y);
    const uz = mes(k.x, k.z, yol.x, yol.z);
    if (uz < 0.3) return false;
    k.bacak = {
      fx: k.x, fz: k.z, tx: yol.x, tz: yol.z, hiz: HIZ,
      bas: t, bit: t + Math.round(uz / HIZ * 1000),
    };
    k.rotY = Math.atan2(yol.x - k.x, yol.z - k.z);
    sayac.bacak++;
    hareketYolla(zid, k.entityId, k.x, k.z, k.y ?? 0, yol.x, yol.z, HIZ);
    return true;
  }

  function koyluYonu(zid, k, rotY) {
    const tx = k.x + Math.sin(rotY) * DUZELT_U;
    const tz = k.z + Math.cos(rotY) * DUZELT_U;
    hareketYolla(zid, k.entityId, k.x, k.z, k.y ?? 0, tx, tz, HIZ);
    k.x = tx; k.z = tz; k.rotY = rotY;
    sayac.duzeltme++;
  }

  /**
   * DANS - bare skill.fire (143).
   * sistem_beceri.js'ten GECIRILMEZ: dans becerilerinin reqWeapons'i eu_harp
   * ve o esya items.json'da YOK, yani normal dogrulama dansi reddederdi.
   * Istemci tarafinda bekleyen bir cast olmadigi icin onServerSkillFire
   * dogrudan finisher'a gecer (@18387421) ve karakter gorunumunun
   * playSkillFinisher'ini calistirir (@19672327).
   */
  function dansYolla(zid, k) {
    for (const ws of oyunculariAl(zid)) {
      if (!ws.gorunen?.has(k.entityId)) continue;
      frame(ws, 'skill.fire', { id: k.entityId, skillId: k.dansId });
    }
    sayac.dans++;
  }

  // ==========================================================================
  // ANA TIK
  // ==========================================================================
  function tumTik(t = simdi()) {
    sayac.tik++;
    if (!acikMi()) {
      for (const [zid, b] of BOLGE) if (b.senlik) senlikSil(zid, b);
      return;
    }
    const zoneIdler = new Set([...beyaz.keys(), ...Object.keys(SEN.bolgeler ?? {})]);
    for (const zid of zoneIdler) {
      const oyuncular = oyunculariAl(zid);
      if (!oyuncular.length) continue;                 // bos bolgede TIK YAKMA

      const b = npcleriKur(zid);
      senlikKur(zid);
      if (b.npcler.size && kimlikCoz(zid, oyuncular)) npcTik(zid, b, oyuncular, t);
      if (b.senlik) senlikTik(zid, b, oyuncular, t);
    }
  }

  const zaman = setInterval(() => {
    try { tumTik(); }
    catch (e) { log(`[npc-yasam] tik hatasi: ${String(e?.message ?? e).slice(0, 160)}`); }
  }, tikMs);
  zaman.unref?.();

  // ==========================================================================
  // ORNEK
  // ==========================================================================
  const ornek = {
    /**
     * HICBIR MESAJI TUKETMEZ - her zaman false doner.
     * Tek isi: bir oyuncu mesaji bir NPC'ye dokunduysa (dukkan/depo/gorev/
     * isinlanma penceresi, hedefleme) o NPC'yi EVINE KILITLEMEK. "NPC ile
     * diyalog acikken NPC yerinde kalir" istegi budur.
     */
    mesaj(ws, t, d) {
      if (!d || typeof d !== 'object') return false;
      const sure = say(K.diyalogKilidiMs, 30000);
      if (sure > 0) {
        const ham = typeof d.npcId === 'string' ? d.npcId : null;
        if (ham) KILIT.set(ham.startsWith('tp_') ? ham.slice(3) : ham, simdi() + sure);
        const id = Number(d.id ?? d.entityId ?? d.targetId);
        if (Number.isFinite(id) && id > NPC_ID_ALT && id < NPC_ID_UST) {
          const zid = ws?.zoneId;
          const b = zid ? BOLGE.get(zid) : null;
          if (b) for (const [k, s] of b.npcler) if (s.entityId === id) { KILIT.set(k, simdi() + sure); break; }
        }
      }
      return false;
    },

    /** zone.init.self'e katki yok - baska modullerin alanlarina dokunmaz. */
    selfAlanlari() { return {}; },

    dur() {
      clearInterval(zaman);
      ONCEKI_DURUM = { BOLGE, KILIT, sayac };
    },

    durum() {
      const out = { acik: acikMi(), tikMs, bolgeler: {}, sayac: { ...sayac }, atilan };
      for (const [zid, b] of BOLGE) {
        out.bolgeler[zid] = {
          npc: b.npcler.size,
          kimlik: b.kimlik,
          gezen: [...b.npcler.values()].filter(s => s.bacak).length,
          sohbet: [...b.npcler.values()].filter(s => s.faz === 'sohbet').length,
          evde: [...b.npcler.values()].filter(s => s.faz === 'ev').length,
          senlik: b.senlik ? { koylu: b.senlik.koyluler.length, faz: b.senlik.faz, merkez: b.senlik.merkez } : null,
        };
      }
      return out;
    },

    /* ---- HARNESS KANCALARI (uretimde kullanilmaz) ---- */
    _tik(t) { tumTik(t ?? simdi()); },
    _bolge(zid) { return BOLGE.get(zid) ?? null; },
    _kilit(npcId, bitis) { KILIT.set(npcId, bitis); },
    _ayar() { return { CFG, G, S, K, SEN, ILGI, HIZ, YARICAP, EV_MAX, tikMs }; },
  };

  ONCEKI_ORNEK = ornek;
  const toplam = [...beyaz.values()].reduce((a, l) => a + l.length, 0);
  log(`npc-yasam: ${acikMi() ? 'ACIK' : 'KAPALI'} - gezen NPC ${toplam}`
    + `${atilan.length ? ` (${atilan.length} ihlal atildi: ${atilan.join(', ')})` : ''}`
    + `, senlik ${SEN.acik !== false ? `${say(SEN.kisiSayisi, 0)} koylu/bolge` : 'kapali'}, tik ${tikMs} ms`);
  return ornek;
}

/* ======================================================================== */
/*  AYAR OKUMA                                                              */
/* ======================================================================== */
function ayarlariOku(dataDir, log) {
  const yol = path.join(dataDir, 'npc-yasam.json');
  try {
    if (!fs.existsSync(yol)) {
      log('[npc-yasam] data/npc-yasam.json yok - sistem KAPALI');
      return { ...VARSAYILAN };
    }
    const o = JSON.parse(fs.readFileSync(yol, 'utf8'));
    return { ...VARSAYILAN, ...o };
  } catch (e) {
    log(`[npc-yasam] npc-yasam.json okunamadi (${String(e?.message ?? e).slice(0, 100)}) - sistem KAPALI`);
    return { ...VARSAYILAN };
  }
}

/* ======================================================================== */
/*  BEYAZ LISTE DOGRULAMASI                                                 */
/*                                                                          */
/*  Beyaz listedeki bir NPC herhangi bir oyun sistemi tarafindan referans    */
/*  ediliyorsa HAREKETTEN CIKARILIR. Sessiz bozulma yerine gorunur uyari.    */
/*  Kaynaklar:                                                              */
/*    - data/npcshops.json  shops{}     (dukkan / depo / onarim / egitmen)   */
/*    - data/professions.json                                               */
/*    - world.json teleporters[]        (zaten hicbir zaman listeye girmez)  */
/*    - server/sistem_*.js kaynak metinleri (elle gomulmus npcId'ler)        */
/* ======================================================================== */
function beyazListeyiDogrula(CFG, WORLD, dataDir, sunucuDir, log) {
  const beyaz = new Map();
  const atilan = [];

  const islevli = new Set();
  const ekle = (metin) => {
    if (!metin || !WORLD?.zones) return;
    for (const [, z] of Object.entries(WORLD.zones)) {
      for (const n of z.npcs ?? []) {
        if (islevli.has(n.npcId)) continue;
        if (metin.includes(`"${n.npcId}"`) || metin.includes(`'${n.npcId}'`)) islevli.add(n.npcId);
      }
    }
  };

  try {
    const s = JSON.parse(fs.readFileSync(path.join(dataDir, 'npcshops.json'), 'utf8'));
    for (const k of Object.keys(s?.shops ?? {})) islevli.add(k);
  } catch { /* dosya yoksa bir sonraki kaynak */ }
  try { ekle(fs.readFileSync(path.join(dataDir, 'professions.json'), 'utf8')); } catch { /* yok */ }

  /* sistem_*.js taramasi surec basina BIR KEZ (~1 MB okuma). */
  if (SISTEM_KAYNAK === null) {
    let birlesik = '';
    try {
      for (const f of fs.readdirSync(sunucuDir)) {
        if (!/^sistem_.*\.js$/.test(f) || f.includes('.bak')) continue;
        if (f === 'sistem_npc-yasam.js') continue;
        birlesik += fs.readFileSync(path.join(sunucuDir, f), 'utf8');
      }
    } catch { /* okunamadi - digerkaynaklar yeterli */ }
    SISTEM_KAYNAK = birlesik;
  }
  ekle(SISTEM_KAYNAK);

  for (const [zid, liste] of Object.entries(CFG.beyazListe ?? {})) {
    if (zid.startsWith('$') || !Array.isArray(liste)) continue;
    const zone = WORLD?.zones?.[zid];
    const gecerli = [];
    for (const npcId of liste) {
      if (typeof npcId !== 'string') continue;
      if (zone && !(zone.npcs ?? []).some(n => n.npcId === npcId)) {
        atilan.push(`${npcId}(bolgede yok)`);
        continue;
      }
      if (islevli.has(npcId)) { atilan.push(`${npcId}(islevli)`); continue; }
      gecerli.push(npcId);
    }
    beyaz.set(zid, gecerli);
  }
  if (atilan.length) {
    log(`[npc-yasam] BEYAZ LISTE IHLALI - hareketten cikarildi: ${atilan.join(', ')}`);
  }
  return { beyaz, atilan };
}

/* =============================================================================
 * RECETE - BASKA KOSUMLARIN ELINDEKI DOSYALARDA GEREKEN IKI SATIR
 * =============================================================================
 * Bu modul, sozlesmeye uygun olmasina ragmen, server.js'e KAYDEDILMEDIGI
 * SURECE YUKLENMEZ. Gereken degisiklikler (bu tur onlara YAZMADI):
 *
 * 1) server.js - SISTEM_ADLARI dizisinin BASINA:
 *        const SISTEM_ADLARI = [
 *          'npc-yasam',            // <-- EN ONDE olmali
 *          'envanter', 'stat-ustalik', ...
 *        ];
 *    NEDEN EN ONDE: modul hicbir mesaji tuketmez (mesaj() daima false doner),
 *    ama NPC'ye dokunan mesajlari GORMEK zorundadir (diyalog kilidi). Dizinin
 *    sonundayken onunde duran modul mesaji tuketirse kilit hic kurulmaz.
 *
 * 2) server.js - sistemCtx() icine TEK SATIR (opsiyonel ama TAVSIYE EDILEN):
 *        zoneNpcEntities,
 *    Bu satir olmadan modul NPC varlik kimliklerini ws.gorunen'deki NPC
 *    bandindan YENIDEN KURAR (ardisik blok kontrolu ile); kontrol tutmazsa
 *    bolgeyi guvenlik geregi kapatir. Satir eklenirse yeniden kurma hic
 *    devreye girmez.
 *
 * 3) admin.js - ALANLAR dizisine iki satir (GM panelinden ac/kapa):
 *        { k: 'npcYasamAcik', ad: 'Yasayan dunya - NPC yasam dongusu (0 = kapali)',
 *          tip: 'tamsayi', min: 0, max: 1,
 *          aciklama: 'Dekoratif NPC\'ler evlerinin cevresinde gezer, komsusuyla '
 *            + 'bulusur ve yerine doner; kasaba meydaninda halay ceken ambient '
 *            + 'koyluler dogar. 0 = kapali. Islevli (dukkan/depo/egitmen/isinlanma) '
 *            + 'NPC\'ler bu ayardan BAGIMSIZ olarak her zaman yerinde kalir.' },
 *        { k: 'npcYasamSenlikKisi', ad: 'Meydandaki halayci sayisi (0 = kapali)',
 *          tip: 'tamsayi', min: 0, max: 12,
 *          aciklama: 'Kasaba meydaninda halay ceken ambient koylu sayisi. Her '
 *            + 'koylu istemcide kabaca bir oyuncu kadar maliyetlidir.' },
 *    Bu anahtarlar referans oyunun game-config.json'inda YOKTUR; admin.js kalibi
 *    geregi deger yalniz data/sunucu-ayarlari.json'da yasar ve panelde
 *    "varsayilan" sutunu `—` gorunur (sistem_yerinde-dirilis.js ile ayni
 *    durum). Anahtar tanimlanmadigi surece modul data/npc-yasam.json'daki
 *    `acik` alanini kullanir (varsayilan: ACIK).
 *
 * =============================================================================
 * ISTEMCI YAMASI ISTENIRSE - ONCELIK SIRALI (bu modul olmadan da degerli)
 * =============================================================================
 * P1 (en yuksek deger / en dusuk risk, sunucu isi SIFIR, yeni varlik SIFIR):
 *     W3 klip siniflandiricisina `/(^|_)time\d*$/` ve `/basic\d+$/` desenlerini
 *     IDLE olarak ekle ve ye('idle') secimini h.idle[0] yerine periyodik
 *     rastgele secime cevir. Olculdu: 143 NPC modelinin 76'sinda istemcinin HIC
 *     oynatmadigi 111 OLU idle varyanti var - bu tek degisiklik NPC'leri
 *     yerlerinden kalkmadan "yasatir".
 * P2: NPC gorunumune lokomosyon kaynagi ver (runSpeedU > 0 + walk klibi yedegi)
 *     -> gezen dekoratif NPC'lerin KAYMASI biter.
 * P3: gercek emote karesi (`emote {id, clip}`) - gather.action'in cut|mine
 *     enum'unun ust kumesi. GERCEK NPC modelleriyle halayi mumkun kilan TEK
 *     yamadir (yeni dans animasyonu uretilmesi kosuluyla).
 */
