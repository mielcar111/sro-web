/**
 * sistem_dirilis-unique.js — DIRILIS (revive) + UNIQUE (essiz canavar) sistemi
 *
 * Bu modul, sunucunun HIC gondermedigi dort s2c mesajini uretir:
 *
 *     201  revive.offer    baska bir oyuncunun dirilis becerisi -> olu oyuncuya teklif
 *     202  revive.result   teklifin sonucu (kabul/ret/hata) - OLUM PERDESINI KAPATAN mesaj
 *     203  unique.timers   6 unique'in canli/dogus sayaclari (60 sn periyot)
 *     204  unique.board    siralama karesi (unique puani / seviye / meslek)
 *
 * ve karsiligindaki c2s mesajlarini isler:
 *
 *      22  skill.cast      YALNIZCA kind === 'revive' beceriler (digerleri
 *                          sistem_beceri.js'e birakilir - mesaj() false doner)
 *      85  revive.respond  {offerId, accept}
 *      93  unique.op       {op:'board'|'levelBoard'|'professionBoard'}
 *
 * ===========================================================================
 * SEMA KAYNAGI — hicbir alan/sayi uydurulmadi
 * ===========================================================================
 * Okunabilir istemci paketi:
 *   playjs_source\index-BUMMQVRB.js
 * Zod takma adlari (paketten dogrulanmis):
 *   X = z.object  Y = z.number  J = z.string  BJ = z.array  RJ = z.boolean
 *   qJ = z.enum   JJ = z.literal  GJ = z.record  HJ = z.discriminatedUnion
 *
 * --- s2c SEMALARI (ham hal + paket bayt ofseti) ---------------------------
 *
 *  @25620791  T$(`revive.offer`, 201, X({
 *               offerId:    Y().int(),
 *               casterId:   Y().int(),
 *               casterName: J(),
 *               skillId:    J(),
 *               expiresAt:  Y(),
 *               hp:         Y().int().nonnegative(),
 *               mp:         Y().int().nonnegative()
 *             }))
 *
 *  @25620983  T$(`revive.result`, 202, X({
 *               id:       Y().int(),
 *               ok:       RJ(),
 *               hp:       Y().int().optional(),
 *               mp:       Y().int().optional(),
 *               casterId: Y().int().optional(),
 *               skillId:  J().optional(),
 *               reason:   J().optional()
 *             }))
 *
 *  @25621188  T$(`unique.timers`, 203, X({
 *               serverTime: Y(),
 *               uniques: BJ(X({
 *                 monsterId: J(), zoneId: J(), live: RJ(),
 *                 spawnAtMs: Y().nullable(), totalMs: Y().nullable()
 *               }))
 *             }))
 *             SERIT C EKI: bu kareye x/z/camps alanlari EKLENDI (bkz.
 *             timersPayload yorumu). EK DUZELTME D EKI: ayni kalipla
 *             hp/maxHp de EKLENDI (yalniz live=true iken dolu, yoksa null).
 *             Sema disi ama guvenli — istemci gelen
 *             kareyi Zod ile DOGRULAMIYOR (JQ kayitlarinin tuttugu agt/ogt
 *             haritalari hicbir yerde okunmuyor; onFrame -> dispatch ->
 *             invoke ham JSON'u dogrudan handler'a veriyor @18730066).
 *
 *  @25621377  T$(`unique.board`, 204, HJ(`kind`, [
 *               X({ kind: JJ(`unique`),
 *                   rows: BJ(X({rank:Y().int(), name:J(), level:Y().int(),
 *                               points:Y().int()})),
 *                   me:   X({rank:Y().int(), points:Y().int()}).nullable() }),
 *               X({ kind: JJ(`level`),
 *                   rows: BJ(X({rank:Y().int(), name:J(),
 *                               level:Y().int()}).strict()),
 *                   me:   X({rank:Y().int(), level:Y().int()}).nullable() }),
 *               X({ kind: JJ(`profession`), professionId: J(),
 *                   rows: BJ(X({rank:Y().int(), name:J(),
 *                               level:Y().int()}).strict()),
 *                   me:   X({rank:Y().int(), level:Y().int()}).nullable() })
 *             ]))
 *             DIKKAT: `level`/`profession` satirlari .strict() - FAZLA ALAN
 *             gonderirsen Zod paketi SESSIZCE atar. `points` YALNIZ unique'te.
 *
 * --- c2s SEMALARI ---------------------------------------------------------
 *
 *  @25612604  T$(`revive.respond`, 85, X({offerId:Y().int(), accept:RJ()}), `misc`)
 *  @25614545  T$(`unique.op`, 93, HJ(`op`, [
 *               X({op: JJ(`board`)}),
 *               X({op: JJ(`levelBoard`)}),
 *               X({op: JJ(`professionBoard`), professionId: J().min(1).max(64)})
 *             ]), `misc`)
 *  @25609193  T$(`skill.cast`, 22, X({groupId:J(), targetId:Y().int().optional(),
 *               gx:Y().optional(), gz:Y().optional(),
 *               stage:Y().int().min(1).max(7).optional(), aid:Y().int().optional()}))
 *
 * --- ISTEMCININ DAVRANISI (neden bu sirayla gonderiyoruz) -----------------
 *
 *  @27381264  Olum perdesi:  F$(s => s.self?.dead ?? !1)
 *             Iki dugme var:  ui.death.return_to_town -> W$.send('respawn.request')
 *                             ui.death.wait_for_help  -> sadece perdeyi degistirir
 *             YERINDE DIRIL diye bir dugme YOK: "yerinde dirilis" = baska bir
 *             oyuncunun revive becerisi (revive.offer -> revive.respond).
 *
 *  @27126653  W$.on('revive.result', m => {
 *               if (!m.ok) { pushSys('sys.revive.failed', {reason: m.reason ?? 'unknown'}); return; }
 *               Q.applyRevive(m);
 *               m.id === Q.selfId && (setOffer(null), setSelf({dead:false, ...hp, ...mp}));
 *             })
 *             >>> `dead` bayragini SIFIRLAYAN TEK MESAJ revive.result'tur.
 *                 entity.teleport(136) semasinda dead alani YOK, applyTeleport
 *                 `dead`e DOKUNMAZ. Yani SEHRE DONUSTE DE revive.result
 *                 gondermek zorundayiz - yoksa olum perdesi sonsuza dek acik kalir.
 *                 (Bu yuzden gameloop.js #dirilt de duzeltildi.)
 *
 *  @27580807  Teklif penceresi: expiresAt'ta kendini kapatir, dugmeler
 *               W$.send('revive.respond', {offerId, accept}) yollar ve teklifi
 *               ISTEMCI TARAFINDA siler -> "reddet" cevabina kare beklemez.
 *
 *  @27126467  ui.revive.restore = "%{hp} HP / %{mp} MP geri kazandirir"
 *  @25922297  Beceri ipucu:  hp: revive.hpFlat || revive.hpPct
 *             >>> revive.offer.hp/mp = GOSTERIM degeri (yuzde ya da duz),
 *                 revive.result.hp/mp = MUTLAK yeni can/mana (applyRevive
 *                 dogrudan character.hp = node.hp yapiyor).
 *
 *  @27132950  W$.on('unique.timers', m => z5.setTimers(m.uniques, m.serverTime))
 *  @27642700  Sayac hucresi:  kalan = (t.spawnAtMs ?? now) - now
 *                             yuzde = t.live ? 100 : t.totalMs ? (1-kalan/totalMs)*100 : 0
 *             >>> live iken spawnAtMs/totalMs NULL, olu iken MUTLAK ms + pencere.
 *
 *  @27565913  Siralama paneli sekme basina BIR KEZ unique.op yolluyor
 *             (currentOwner.current[value] bayragi). Cevap gelmezse pano
 *             SONSUZA DEK bos kalir -> her uc op'a da mutlaka cevap veriyoruz.
 *
 * --- CANLI OLCUM ----------------------------------------------------------
 *  GERCEK/zone_init.json -> "unique.timers":
 *      periyot_ms = 60000
 *      live:true  olanlarda spawnAtMs = null, totalMs = null
 *      live:false olanlarda spawnAtMs = 1787505642033, totalMs = 15691300
 *                 (15691300 ms = 261.5 dk, [180,360] dk penceresinin ICINDE ->
 *                  totalMs SABIT DEGIL, o dogus icin ATILAN gecikmedir)
 *      6 unique, uniques.json ile AYNI SIRADA.
 *
 * --- VERI KAYNAKLARI ------------------------------------------------------
 *   data/uniques.json     6 unique: camps (gercek Tab_RefNest konumlari),
 *                         respawnMinutes [180,360], bands, maxAdds
 *   data/monster-skills.json  msk_* kayitlari (gen_monster_skills.mjs canli
 *                         vSRO _RefSkill'den uretir; summon.waves = `ssou`
 *                         parametresi, sema paket Lat @8682600 / @8684461).
 *                         MADDE 42: bands[].skillId -> summon dalgalari.
 *   data/spawns.json      ayni yuvalarin y/radius/maxHp/level alanlari
 *                         (nestId ile eslesir)
 *   data/mobs.json        unique:true mob tanimlari (hp, level, modelKey, name)
 *   data/skills.json      kind:'revive' 37 beceri (8 grup) -> revive bloku:
 *                         {maxTargetLevel, expRecoveryPct, hpPct, mpPct, hpFlat, mpFlat}
 *   data/game-config.json respawnHpPct = 0.5, corpseDespawnMs = 6000
 *
 * --- LOCALE (client/assets/locales/tr.json ile DOGRULANDI) ----------------
 *   sys.unique.spawned      "{name} ortaya cikti!"
 *   sys.unique.defeated     "{name} maglup edildi!"
 *   sys.unique.defeated_by  "{name}, {killer} tarafindan maglup edildi!"
 *   sys.unique.points       "{points} unique puani kazandin ({name})"
 *   err.revive.target_level "Hedefin seviyesi diriltmek icin cok yuksek."
 *   err.skill.requires_downed / err.skill.needs_ally  (Eht enum'unda VAR)
 *   Hepsi paketin Tht/Eht enumlarinda da var (@25606850, @25839375).
 *
 * ===========================================================================
 * TEK UYDURULMAYAN-AMA-PAKETTE-OLMAYAN KARAR  (acikca isaretlendi)
 * ===========================================================================
 *   UNIQUE PUANI FORMULU pakette ve canli yakalamada YOK. Sadece sunlar var:
 *     - unique.board satirinda `points: Y().int()`
 *     - hub yayin semasinda `contributors: [{name, points}]`
 *   Bu yuzden uydurma bir sabit YAZILMADI; havuz VERIDEN aliniyor:
 *       toplam puan havuzu = unique'in mobs.json'daki `level` degeri
 *       (tigerwoman 20, kerberos 24, ivy 30, uruchi 40, isyutaru 60, bonelord 80)
 *       hasar payina gore bolusturulur, hasar veren herkes en az 1 puan alir.
 *   Havuzu degistirmek isteyen ctx.uniquePuanHavuzu(def) verebilir.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
/* MADDE 4 (capraz istek, 3. dalga): yerinde diriliste bacak IPTAL edilmeli.
   KAYNAK: paket applyTeleport @25665291 `path=null; snap=true` - istemci de
   dirilis/isinlanma sonrasi yolu sifirliyor; bacak.js:252 bacakDurdur. */
import { bacakDurdur } from './bacak.js';
/* PP MADDE 4 (changelog 0023): unique bos ganimetinin dusen ekipman ORNEGI
   (plus/variance/dur/maxDur) tek uretim noktasindan - gameloop #ganimetDus
   ile ayni desen (esya.yeniYigin). */
import * as esya from './esya.js';

/* unique.timers yayin periyodu - CANLI OLCUM (zone_init.json periyot_ms). */
const TIMERS_PERIYOT_MS = 60_000;

/* Modul tiki. Dirilis castleri (skills.json castMs = 3000) icin yeterince
   ince, unique zamanlayicisi icin fazlasiyla. gameConfig.tickHz = 10 -> 100 ms
   ile ayni aileden; 200 ms secildi cunku bu modulde vurus zamanlamasi yok. */
const TIK_MS = 200;

/* revive.offer gecerlilik suresi. PAKETTE YOK: sema yalnizca `expiresAt`
   (mutlak ms) tasiyor, degeri sunucu belirliyor. Parti davetinin olculmus
   karsiligi olan gameConfig.partyInviteTimeoutMs (30000) ile ayni tutuldu;
   ctx.GCFG.reviveOfferMs ile degistirilebilir. */
const TEKLIF_SURESI_MS = 30_000;

/** Siralama panosunda gonderilen satir sayisi (oyun kurali degil, sayfa boyu). */
const PANO_SATIR = 50;

const tamsayi = (v, y = 0) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : y);
const kirp = (v, a, b) => Math.max(a, Math.min(b, v));

/* server.js @921 sistemleriKur(true) admin ayari degisince kur()'u YENIDEN
   cagiriyor ve eski ornegin dur()'unu CAGIRMIYOR. Guard olmasa ikinci bir
   zamanlayici + ikinci bir unique planlayicisi dogar (unique'ler CIFT dogar).
   sistem_kucuk-sistemler.js de ayni korumayi kullaniyor. */
let ONCEKI_ORNEK = null;

/* DENETIM DUZELTMESI - YENIDEN KURULUM DEVRI.
   sistemleriKur() admin panelinden ayar degisince CAGRILIYOR. Devir olmadan
   her ayar degisikliginde:
     a) uniqueKur() spawnAtMs = simdi() yaziyordu -> 3-6 saatlik takvim
        SIFIRLANIYORDU (bir GM ayar dugmesine basarak unique cagirabilirdi),
     b) yuvalariAyir() canli unique varliklarini siliyor ama YUVA haritasi
        artik BOS oluyordu (spawnPoints zaten temizlenmis) -> yeni dogan
        unique nest y'sini ve nRadius'unu kaybediyordu,
     c) canli olan unique varligi silindigi icin uniqueTik `!e` dalina
        dusup TAM gecikmeyle yeniden zamanliyordu -> unique SAATLERCE
        ortadan kayboluyordu.
   Bu yuzden takvim + yuva + puan tablosu ornekler arasi devrediliyor. */
let ONCEKI_DURUM = null;

export function kur(ctx) {
  /* SIRA ONEMLI: devri once dur() dolduruyor, sonra okuyup temizliyoruz. */
  if (ONCEKI_ORNEK) {
    try { ONCEKI_ORNEK.dur(); } catch { /* onemsiz */ }
    ONCEKI_ORNEK = null;
  }
  const devir = ONCEKI_DURUM;
  ONCEKI_DURUM = null;
  const { world, combat, frame, broadcast } = ctx;
  const GCFG = ctx.GCFG ?? {};
  const log = ctx.log ?? (() => {});
  const derived = ctx.derived ?? ((ch) => combat?.turetilmis?.(ch) ?? { maxHp: 1, maxMp: 0 });
  const simdi = ctx.now ?? (() => Date.now());
  /** Testin dogus kampini/gecikmesini sabitleyebilmesi icin. */
  const zar = ctx.rastgele ?? Math.random;

  const dataDir = ctx.dataDir ?? world?.dataDir
    ?? path.join(path.dirname(fileURLToPath(import.meta.url)), 'data');

  const okuJson = (ad) => {
    const p = path.join(dataDir, ad);
    if (!fs.existsSync(p)) return null;
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
    catch (e) { log(`dirilis-unique: ${ad} bozuk - ${String(e.message).slice(0, 80)}`); return null; }
  };

  // =========================================================================
  // VERI
  // =========================================================================
  /** groupId -> [beceri...] (yalniz kind==='revive') */
  const DIRILIS_GRUP = new Map();
  /** id -> beceri (yalniz kind==='revive') */
  const DIRILIS_BECERI = new Map();

  (function beceriYukle() {
    const ham = okuJson('skills.json');
    if (!ham) { log('dirilis-unique: skills.json yok - dirilis becerisi kapali'); return; }
    const liste = Array.isArray(ham) ? ham : (ham.skills ?? []);
    for (const s of liste) {
      if (!s?.id || !s?.groupId || s.kind !== 'revive') continue;
      DIRILIS_BECERI.set(s.id, s);
      if (!DIRILIS_GRUP.has(s.groupId)) DIRILIS_GRUP.set(s.groupId, []);
      DIRILIS_GRUP.get(s.groupId).push(s);
    }
    for (const l of DIRILIS_GRUP.values()) {
      l.sort((a, b) => (a.skillLevel ?? 0) - (b.skillLevel ?? 0));
    }
    log(`dirilis-unique: ${DIRILIS_BECERI.size} dirilis becerisi / ${DIRILIS_GRUP.size} grup`);
  })();

  const uniquesDosya = okuJson('uniques.json');
  const UNIQUE_TANIM = (uniquesDosya?.uniques ?? []).filter((u) => u?.monsterId && u?.zoneId);

  /* MADDE 42 - CAGRI (summon) becerileri. data/monster-skills.json,
     gen_monster_skills.mjs ile CANLI vSRO _RefSkill tablosundan uretildi:
     `ssou` parametre bloklari = summon.waves [{monsterId,tierRaw,min,max}]
     (sema: paket Lat @8684461; ornek canli satir msk_3049 = "ssou",1953,0,3,6,
     1952,0,3,6). uniques.json bands[].skillId buradaki kayitlara baglanir.
     Dosya yoksa band tetiklenmesi calismaz - uydurma dalga URETILMEZ. */
  const MSK = new Map();
  (function beceriKatalogYukle() {
    const ham = okuJson('monster-skills.json');
    for (const s of ham?.skills ?? []) if (s?.id) MSK.set(s.id, s);
    if (!MSK.size) log('dirilis-unique: monster-skills.json yok - unique cagri dalgalari KAPALI');
  })();

  /** `${zoneId}|${nestId}` -> spawns.json yuvasi (y, radius, maxHp, level ...)
      Yeniden kurulumda spawnPoints ARTIK temiz oldugu icin devralinir. */
  const YUVA = new Map(devir?.yuva ?? []);
  /** monsterId -> durum */
  const UNIQUE = new Map();

  // =========================================================================
  // 1) SPAWNS.JSON'DAN UNIQUE YUVALARINI AYIR
  // -------------------------------------------------------------------------
  // spawns.json unique kamplarinin HEPSINI sirali yuva olarak tasiyor
  // (jangan'da 11 adet mob_tigerwoman, count:1). World bir bolgeyi ilk kez
  // doldurdugunda bunlarin TAMAMI ayni anda doguyor: 11 Tiger Girl sahada,
  // olunce 30 sn'de geri geliyor. Retail'de AYNI ANDA 1 tane olur ve
  // dogus araligi 3-6 saattir (uniques.json respawnMinutes [180,360],
  // spawns.json respawnDelaySec [10800,21600] ile birebir ayni pencere).
  //
  // Bu yuzden unique yuvalarini world.spawnPoints'ten CIKARIYORUZ; artik
  // dogumlarini bu modulun zamanlayicisi yapiyor. Cekirdek dosyalara
  // dokunulmuyor - world.spawnPoints acik bir alan.
  // =========================================================================
  const UNIQUE_MOB = new Set(UNIQUE_TANIM.map((u) => u.monsterId));

  function uniqueMi(mobId) {
    if (!mobId) return false;
    if (UNIQUE_MOB.has(mobId)) return true;
    return world?.mobDefs?.get?.(mobId)?.unique === true;
  }

  function yuvalariAyir() {
    let ayrilan = 0;
    const sp = world?.spawnPoints;
    if (sp && typeof sp.forEach === 'function') {
      for (const [zid, liste] of [...sp]) {
        if (!Array.isArray(liste)) continue;
        const kalan = [];
        for (const s of liste) {
          if (uniqueMi(s?.mobId)) {
            if (s.nestId != null) YUVA.set(`${zid}|${s.nestId}`, s);
            ayrilan++;
          } else kalan.push(s);
        }
        if (kalan.length !== liste.length) sp.set(zid, kalan);
      }
    }
    /* Savunma: bir bolge modul kurulmadan once doldurulmussa oradaki unique
       varliklarini da temizle (aksi halde 11 kopya sahada kalirdi). */
    let silinen = 0;
    const zs = world?.zoneState;
    if (zs && typeof zs.forEach === 'function') {
      for (const [, z] of zs) {
        if (!z?.entities) continue;
        for (const [id, e] of [...z.entities]) {
          if (uniqueMi(e?.mobId)) { z.entities.delete(id); silinen++; }
        }
      }
    }
    return { ayrilan, silinen };
  }

  // =========================================================================
  // 2) HASAR KANCASI  (unique'e kim ne kadar vurdu)
  // -------------------------------------------------------------------------
  // ctx'te hasar kancasi YOK ve hasar iki ayri yerde uygulaniyor:
  //   gameloop.js  #hasarUygula : hedef.hp -= d  (n kez)  SONRA
  //                               hedef.hedefEntityId = ws.entityId
  //   sistem_beceri.js vurusUygula: h.hp = yeniHp;  SONRA
  //                               h.hedefEntityId = ws.entityId
  // Ikisinde de sira AYNI: once can dusuyor, hemen ardindan saldiran
  // `hedefEntityId`ye yaziliyor. Varligi BIZ urettigimiz icin bu iki alani
  // erisimci (accessor) yapip biriken hasari saldirana yazabiliyoruz.
  // Ucuncu bir hasar kaynagi cikarsa hasar KIMSEYE yazilmaz (kayip degil,
  // sadece katkiya sayilmaz) - cokme uretmez.
  //
  // Daha temizi ctx'e bir `hasarKancasi(e, saldiranWs, hasar)` eklemek olurdu;
  // o ANA OTURUMUN isi (rapora yazildi).
  // =========================================================================
  function hasarKancasiTak(e, st, baslangicHp) {
    let _hp = baslangicHp;
    let _hedef = null;
    let biriken = 0;

    Object.defineProperty(e, 'hp', {
      configurable: true, enumerable: true,
      get: () => _hp,
      set: (v) => {
        const yeni = Number(v);
        const fark = _hp - yeni;
        if (fark > 0) biriken += fark;
        _hp = yeni;
      },
    });
    Object.defineProperty(e, 'hedefEntityId', {
      configurable: true, enumerable: true,
      get: () => _hedef,
      set: (v) => {
        _hedef = v;
        if (biriken > 0 && Number.isFinite(Number(v)) && Number(v) > 0) {
          hasarYaz(st, Number(v), biriken);
          biriken = 0;
        }
      },
    });
    e.hasarSifirla = () => { biriken = 0; };
  }

  function oyuncuEntity(zoneId, entityId) {
    const kume = world?.bolgeOyunculari?.(zoneId)
      ?? [...(world?.zoneState?.get?.(zoneId)?.players ?? [])];
    for (const c of kume) if (c?.entityId === entityId && c?.char) return c;
    return null;
  }

  function hasarYaz(st, entityId, hasar) {
    const ws = oyuncuEntity(st.zoneId, entityId);
    if (!ws?.char?.id) return;
    const k = String(ws.char.id);
    const r = st.hasar.get(k) ?? { charId: k, name: '', level: 1, dmg: 0, ws: null };
    r.dmg += hasar;
    r.name = String(ws.char.name ?? k);
    r.level = tamsayi(ws.char.level, 1);
    r.ws = ws;
    st.hasar.set(k, r);
    st.sonVuran = ws;
  }

  // =========================================================================
  // 3) UNIQUE ZAMANLAYICI
  // =========================================================================
  function uniqueKur() {
    for (const u of UNIQUE_TANIM) {
      const dk = Array.isArray(u.respawnMinutes) ? u.respawnMinutes : [180, 360];
      const st = {
        tanim: u,
        monsterId: u.monsterId,
        zoneId: u.zoneId,
        minMs: Math.max(1, tamsayi(dk[0], 180)) * 60_000,
        maxMs: Math.max(1, tamsayi(dk[1], 360)) * 60_000,
        live: false,
        /* SARTNAME MADDE 7 (gecikmeli sanal dogum) - ESKI VARYANTIN kalinti
           alani. EK KARAR (gereksinim_unique_nerede 2026-09-03) sonrasi tik
           yolu bolge beklemeden GERCEK dogum yapiyor; alan yalniz devirle
           gelen eski kayitlar + hazirDogum emniyet agi icin duruyor. */
        hazir: false,
        /* EK DUZELTME A (gereksinim_unique_nerede 2026-09-04): yeniden
           kurulum devrinden gelen dogumlar DUYURULMAZ - sys.unique.spawned
           yalniz gercek yeni dogumda gider. Bayrak dogum gerceklesene kadar
           (arka arkaya kurulumlarda devirle birlikte) tasinir. */
        sessizDogum: false,
        entityId: null,
        spawnAtMs: null,
        totalMs: null,
        kamp: null,
        hasar: new Map(),
        sonVuran: null,
        cesetSil: 0,
        /* MADDE 42: uniques.json $comment "each band fires once per life,
           descending" - can yuzdesi bir bandin altina ILK inince beceri
           bir kez ateslenir. adds = bu bossun cagirdigi canli yardimci
           varlik id'leri (maxAdds kirpmasi ve temizlik icin). */
        bandsFired: new Set(),
        adds: new Set(devir?.unique?.get(u.monsterId)?.adds ?? []),
      };
      /* Sunucu acilisi = dunyanin dogus ani: hepsi HEMEN dogmaya hazir.
         EK KARAR (gereksinim_unique_nerede 2026-09-03): dogum artik bolge
         beklemiyor - world.js TEMBEL DOGUS doneminde (world.js:195-198
         "#bolgeyiDoldur KALDIRILDI, yuvalar oyuncu yaklastikca aciliyor")
         varlikEkle bos bolgede yalnizca BOS bir zoneState kurar; eski
         "27.748 canavar bosuna uretilir" endisesi gecersizlesti. */
      st.totalMs = gecikmeAt(st);
      st.spawnAtMs = simdi();

      /* YENIDEN KURULUM DEVRI (bkz. ONCEKI_DURUM notu):
           - onceki ornekte OLU idiyse geri sayimi OLDUGU GIBI devral
             (yoksa her ayar degisikligi unique cagirir),
           - CANLI idiyse varligi yuvalariAyir() sildi; hemen geri dogsun
             (yoksa unique saatlerce ortadan kaybolur).
         Sunucu ilk kez aciliyorsa devir yok -> yukaridaki "hemen dog". */
      const onceki = devir?.unique?.get(u.monsterId);
      if (onceki) {
        if (onceki.live) {
          st.spawnAtMs = simdi();
          st.totalMs = tamsayi(onceki.totalMs, st.totalMs) || st.totalMs;
          /* EK DUZELTME A: bu dogum bir DEVIR yeniden dogumudur (canli
             unique'i yuvalariAyir() sildi, hemen geri koyuyoruz) - oyuncu
             onu ZATEN gordu, "ortaya cikti!" duyurusu TEKRARLANMAZ.
             (Kok neden: her admin Kaydet -> sistemleriKur(true) -> bu dal ->
             uniqueDogur duyurusu; olcum ekran goruntusuyle.) */
          st.sessizDogum = true;
        } else if (onceki.spawnAtMs != null) {
          st.spawnAtMs = tamsayi(onceki.spawnAtMs, st.spawnAtMs);
          st.totalMs = tamsayi(onceki.totalMs, st.totalMs);
          /* MADDE 7: pasif bolgede dolmus takvim de devredilir - yeniden
             kurulum "hazir" durumunu sifirlayip 200 ms'lik tik penceresi
             acmasin. */
          st.hazir = !!onceki.hazir;
          /* EK DUZELTME A: dogum henuz gerceklesmeden (200 ms'lik tik
             penceresi icinde) arka arkaya kurulum olursa bayrak kaybolmasin. */
          st.sessizDogum = !!onceki.sessizDogum;
        }
      }
      UNIQUE.set(u.monsterId, st);
    }
  }

  /** Yeniden kurulumda devredilecek asgari durum (canli nesne DEGIL, kopya). */
  function durumuDevret() {
    return {
      yuva: [...YUVA],
      unique: new Map([...UNIQUE].map(([k, s]) => [k, {
        live: s.live, spawnAtMs: s.spawnAtMs, totalMs: s.totalMs,
        /* MADDE 7: gecikmeli sanal dogum isareti de devredilir. */
        hazir: s.hazir,
        /* EK DUZELTME A: duyurusuz-dogum bayragi da devredilir - dogum daha
           gerceklesmeden ikinci bir kurulum olursa duyuru geri sizmasin. */
        sessizDogum: s.sessizDogum,
        /* MADDE 42: cagrilan adds'ler devredilmezse yeniden kurulumda
           takipsiz kalir; oldurulduklerinde gameloop onlari world.olumKaydet
           ile NORMAL respawn kuyruguna sokar ve sonsuza dek yeniden dogarlar
           (yuvasiz varlik evX/evZ'de dirilir). Devirle takip surer. */
        adds: [...s.adds],
      }])),
    };
  }

  function gecikmeAt(st) {
    return st.minMs + Math.floor(zar() * Math.max(1, st.maxMs - st.minMs + 1));
  }

  function uniqueZamanla(st) {
    st.live = false;
    st.hazir = false; /* MADDE 7: yeni geri sayim = sanal dogum isareti silinir. */
    /* EK DUZELTME A: yeni geri sayimin sonundaki dogum GERCEK dogumdur -
       duyurusuz-dogum bayragi tasinmaz. */
    st.sessizDogum = false;
    st.entityId = null;
    st.kamp = null;
    st.hasar = new Map();
    st.sonVuran = null;
    st.totalMs = gecikmeAt(st);
    st.spawnAtMs = simdi() + st.totalMs;
    /* MADDE 42: boss oldu/despawn oldu -> adds temizlenir (farklar_tam
       duzeltmeTaslagi: "add'ler unique olunce/despawn olunca temizlensin"). */
    addTemizle(st);
    st.bandsFired = new Set();
  }

  /** Bolge world tarafindan daha once acilmis mi? (canavarlar uretildi mi) */
  function bolgeAktif(zoneId) {
    return !!world?.zoneState?.get?.(zoneId);
  }

  function uniqueDogur(st) {
    const def = world?.mobDefs?.get?.(st.monsterId) ?? null;
    if (!def) { log(`dirilis-unique: ${st.monsterId} icin mobs.json tanimi yok`); return false; }
    const kamplar = Array.isArray(st.tanim.camps) ? st.tanim.camps : [];
    if (!kamplar.length) { log(`dirilis-unique: ${st.monsterId} icin kamp yok`); return false; }

    /* Retail'de zamanlayici her dogusta kamplardan BIRINI duzgun dagilimla
       secer (uniques.json $comment: "the scheduler rolls ONE camp uniformly
       per spawn, retail-style"). */
    const kamp = kamplar[Math.min(kamplar.length - 1, Math.floor(zar() * kamplar.length))];
    const yuva = YUVA.get(`${st.zoneId}|${kamp.nestId}`) ?? null;

    const x = Number(kamp.x), z = Number(kamp.z);
    const y = yuva?.y != null ? Number(yuva.y)
      : (world?.groundY ? world.groundY(st.zoneId, x, z) : 0);
    const maxHp = tamsayi(def.hp ?? yuva?.maxHp, 1);

    const e = {
      id: world.yeniVarlikId(),
      kind: 'monster',
      modelKey: def.modelKey ?? st.monsterId,
      name: def.name ?? st.monsterId,
      mobId: st.monsterId,
      x, z, y,
      rotY: zar() * Math.PI * 2,
      level: tamsayi(def.level ?? yuva?.level, 1),
      maxHp,
      dead: false,
      /* $mt.rarity = qJ(['champion','giant','unique']) @25591589 -
         istemci hedef cercevesinde ui.target.rarity_unique yazisini
         ve unique_<monsterId> ikonunu buradan seciyor. */
      rarity: 'unique',
      /* Unique kampindan cikmaz: nRadius gezinme siniri, dogus dagilimi 0
         (kamp noktasinin TAM ustunde dogar - camps zaten tekil nokta). */
      evX: x, evZ: z,
      evYaricap: tamsayi(yuva?.radius, 0),
      evDogYaricap: 0,
      gez: null, gezSonraki: 0,
      def,
    };
    hasarKancasiTak(e, st, maxHp);
    world.varlikEkle(st.zoneId, e);

    /* EK DUZELTME A: devir yeniden dogumu mu? Bayrak dogum BASARILI olunca
       tuketilir (basarisiz erken donuslerde durur ki sonraki deneme de
       duyurusuz kalsin). */
    const sessiz = st.sessizDogum === true;
    st.sessizDogum = false;

    st.live = true;
    st.hazir = false; /* MADDE 7: dogum gerceklesti, sanal dogum isareti biter. */
    st.entityId = e.id;
    st.kamp = kamp;
    st.hasar = new Map();
    st.sonVuran = null;
    st.spawnAtMs = null;
    st.totalMs = null;
    st.cesetSil = 0;
    /* MADDE 42: yeni hayat = bantlar sifirlanir ("once per life"); onceki
       hayattan takipsiz kalmis add varsa temizlenir. */
    addTemizle(st);
    st.bandsFired = new Set();

    /* state.delta ELLE YOLLANMAZ: gameloop.js her tikte world.ilgiGuncelle()
       cagirip gorus alanina gireni `add` ile ekliyor. Elle yollarsak
       `gorunen` kumesi guncellenmedigi icin ayni varlik IKI KEZ eklenir. */
    /* EK DUZELTME A: duyuru YALNIZ gercek yeni dogumda. Devir yeniden
       dogumu (admin Kaydet -> sistemleriKur devri) sessiz gecer; sayac
       cubugu (timersYayinla) yine tazelenir - istemci "Dogdu" gormeye
       devam eder, banner tekrarlanmaz. */
    if (!sessiz) {
      herkese('sys.notice', {
        key: 'sys.unique.spawned',
        params: { name: e.name },
        display: 'banner',
      });
    }
    timersYayinla();
    log(`unique dogdu: ${st.monsterId} @ ${st.zoneId} nest ${kamp.nestId ?? '?'} (entity ${e.id})`
      + (sessiz ? ' [devir - duyurusuz]' : ''));
    return true;
  }

  function uniqueOldu(st, e) {
    const def = world?.mobDefs?.get?.(st.monsterId) ?? null;
    const ad = e?.name ?? def?.name ?? st.monsterId;

    // --- katkilar -> puan ---------------------------------------------------
    const katkilar = [...st.hasar.values()].filter((r) => r.dmg > 0);
    /* Hicbir katki kaydedilemediyse (ucuncu bir hasar kaynagi) son agro
       hedefini oldurucu darbe sahibi say. */
    if (!katkilar.length && e?.hedefEntityId) {
      const ws = oyuncuEntity(st.zoneId, e.hedefEntityId);
      if (ws?.char?.id) {
        katkilar.push({
          charId: String(ws.char.id), name: String(ws.char.name ?? ''),
          level: tamsayi(ws.char.level, 1), dmg: 1, ws,
        });
        st.sonVuran = ws;
      }
    }

    const katil = st.sonVuran?.char?.name ? st.sonVuran : null;
    const toplamHasar = katkilar.reduce((a, r) => a + r.dmg, 0);
    const havuz = Math.max(
      katkilar.length,
      tamsayi(ctx.uniquePuanHavuzu?.(def) ?? def?.level ?? 1, 1),
    );

    if (katkilar.length) {
      katkilar.sort((a, b) => b.dmg - a.dmg);
      let dagitilan = 0;
      for (const r of katkilar) {
        const pay = toplamHasar > 0
          ? Math.max(1, Math.floor((havuz * r.dmg) / toplamHasar))
          : 1;
        r.puan = pay;
        dagitilan += pay;
      }
      // Artan/eksik puan en cok hasar verene yazilir (havuz asilmaz).
      const artan = havuz - dagitilan;
      if (artan !== 0) katkilar[0].puan = Math.max(1, katkilar[0].puan + artan);

      for (const r of katkilar) {
        puanEkle(r.charId, r.name, r.level, r.puan);
        if (r.ws?.char && acik(r.ws)) {
          frame(r.ws, 'sys.notice', {
            key: 'sys.unique.points',
            params: { points: r.puan, name: ad },
          });
        }
      }
      panoKaydet();
    }

    // --- duyuru -------------------------------------------------------------
    if (katil) {
      herkese('sys.notice', {
        key: 'sys.unique.defeated_by',
        params: { name: ad, killer: String(katil.char.name) },
        display: 'banner',
      });
    } else {
      herkese('sys.notice', {
        key: 'sys.unique.defeated', params: { name: ad }, display: 'banner',
      });
    }

    /* PP MADDE 4 (changelog 0023): unique bos ganimeti - bol altin+esya,
       bos seviyesine uygun GARANTI ekipman, %50 muhur. st.sonVuran ve e
       henuz taze (uniqueZamanla asagida sifirlar). */
    try { uniqueGanimet(st, e); }
    catch (er) { log(`dirilis-unique: ganimet dusurulamedi: ${String(er?.message ?? er).slice(0, 120)}`); }

    /* Ceset: world.olumKaydet unique'i 30 sn'lik NORMAL respawn kuyruguna
       koydu. Unique oradan dirilmemeli - kuyruk kaydini sil, varligi
       gameConfig.corpseDespawnMs (6000) sonra dunyadan cikar. */
    const z = world?.zoneState?.get?.(st.zoneId);
    if (z?.olu && e) z.olu = z.olu.filter((o) => o.id !== e.id);
    const silId = e?.id ?? st.entityId;
    if (silId != null) {
      const gecikme = Math.max(0, tamsayi(GCFG.corpseDespawnMs, 6000));
      cesetKuyrugu.push({ zoneId: st.zoneId, id: silId, at: simdi() + gecikme });
    }

    log(`unique oldu: ${st.monsterId} (katki ${katkilar.length}, havuz ${havuz})`);
    uniqueZamanla(st);
    timersYayinla();
  }

  const cesetKuyrugu = [];

  // =========================================================================
  // 3b) MADDE 42 - HP ESIKLI CAGRI (summon) DALGALARI
  // -------------------------------------------------------------------------
  // VERI: uniques.json bands [{hpPct, skillId}] + maxAdds ($comment: "bands =
  // INTERIM HP-fraction triggers for the db-exact ssou SUMMON ladder ...
  // each band fires once per life, descending. maxAdds clips waves that would
  // exceed the live-adds cap"). Dalga icerigi data/monster-skills.json
  // summon.waves - gen_monster_skills.mjs canli vSRO _RefSkill `ssou`
  // parametresinden uretti (msk_3049 = WHITETIGER 3-6 + WHITETIGER_CLON 3-6).
  // Beceri kayitlari paket Lat semasina uyar (@8682600; summon @8684461).
  // =========================================================================

  /** Bossun canli (olmemis) add sayisi; kaybolan id'ler kumeden dusurulur. */
  function canliAddSayisi(st) {
    let n = 0;
    for (const id of [...st.adds]) {
      const a = world.varlik(st.zoneId, id);
      if (!a) { st.adds.delete(id); continue; }
      if (!a.dead && (a.hp ?? 0) > 0) n++;
    }
    return n;
  }

  /** Can yuzdesi bir bandin altina ILK kez indiyse beceriyi ateslet. */
  function bandKontrol(st, e) {
    const bands = Array.isArray(st.tanim.bands) ? st.tanim.bands : [];
    if (!bands.length || !(Number(e.maxHp) > 0)) return;
    const yuzde = (Number(e.hp) / Number(e.maxHp)) * 100;
    for (const b of bands) {
      if (!b?.skillId || st.bandsFired.has(b.skillId)) continue;
      if (yuzde > Number(b.hpPct)) continue;
      st.bandsFired.add(b.skillId);   // hayat basina BIR kez ("once per life")
      bandAtesle(st, e, b);
    }
  }

  function bandAtesle(st, e, band) {
    const skill = MSK.get(band.skillId) ?? null;

    /* CAGRI ANIMASYONU - s2c combat.monsterAction (schemas.json opcode 197:
       targetId/castMs/contactMs ZORUNLU, school enum'u SADECE
       physical|magical -> 'special' beceri icin alan HIC gonderilmez).
       castMs/actionMs canli _RefSkill sutunlari (kerberos 1340/1660, CH
       summonlari 0/0); slot beceri kod adindan (MSKILL_.._SUMMON01 ->
       "summon01"), istemci playAttackSlot klibi adinda arar (@26676607). */
    const eylem = {
      id: e.id,
      aid: ++aidSayaci,
      skillId: band.skillId,
      targetId: Number(e.hedefEntityId) > 0 ? Number(e.hedefEntityId) : 0,
      castMs: Math.max(0, tamsayi(skill?.castMs, 0)),
      contactMs: Math.max(0, tamsayi(skill?.actionMs, 0)),
      ...(skill?.animationSlot ? { slot: skill.animationSlot } : {}),
    };
    try { broadcast(st.zoneId, 'combat.monsterAction', eylem, null); } catch { /* onemsiz */ }

    // --- dalgalar -> adds (maxAdds kirpmasi) --------------------------------
    const dalgalar = skill?.summon?.waves ?? [];
    if (!dalgalar.length) {
      log(`unique band: ${st.monsterId} ${band.skillId} @%${band.hpPct} (dalga verisi yok - yalniz animasyon)`);
      return;
    }
    const tavan = Math.max(0, tamsayi(st.tanim.maxAdds, 0));
    let canli = canliAddSayisi(st);
    let dogan = 0;
    for (const w of dalgalar) {
      const min = Math.max(0, tamsayi(w.min, 0));
      const max = Math.max(min, tamsayi(w.max, min));
      /* Adet [min,max] araliginda DUZGUN dagilim - spawns.json respawn
         cozucusuyle ayni kural (paket `uniform_seeded_v1` @8718970). */
      let adet = min + Math.floor(zar() * (max - min + 1));
      if (tavan > 0) adet = Math.min(adet, Math.max(0, tavan - canli - dogan));
      for (let i = 0; i < adet; i++) {
        if (addDogur(st, e, w.monsterId)) dogan++;
      }
    }
    log(`unique band: ${st.monsterId} ${band.skillId} @%${band.hpPct} -> ${dogan} add (canli ${canli + dogan}/${tavan || '-'})`);
  }

  /** Tek bir cagri varligi dogurur. @returns basarili mi */
  function addDogur(st, boss, mobId) {
    const def = world?.mobDefs?.get?.(mobId) ?? null;
    if (!def) { log(`dirilis-unique: cagri mobu mobs.json'da yok: ${mobId}`); return false; }

    /* Konum: bossun ETRAFINDA, yuvanin kendi yaricapi icinde. Dagitim kurali
       world.js #dogusNoktasi ile AYNI: sqrt'lu disk (alanca duzgun);
       yurunebilirlik dogrulamasi varsa uygulanir (madde 49 deseni). */
    const yaricap = Math.max(0, Number(boss.evYaricap) || 0);
    const aci = zar() * Math.PI * 2;
    const m = Math.sqrt(zar()) * yaricap;
    let x = boss.x + Math.cos(aci) * m;
    let z = boss.z + Math.sin(aci) * m;
    if (typeof world?.yurunebilir === 'function' && yaricap > 0) {
      try {
        const yol = world.yurunebilir(st.zoneId, boss.x, boss.z, x, z, boss.y);
        if (yol && Number.isFinite(yol.x) && Number.isFinite(yol.z)) { x = yol.x; z = yol.z; }
      } catch { /* nav yoksa ham nokta */ }
    }
    const maxHp = tamsayi(def.hp, 1);
    const a = {
      id: world.yeniVarlikId(),
      kind: 'monster',
      modelKey: def.modelKey ?? mobId,
      name: def.name ?? mobId,
      mobId,
      x, z,
      /* TOHUMLU groundY (madde 7/fark 167): bossun y'si kat secer. */
      y: world?.groundY ? world.groundY(st.zoneId, x, z, boss.y) : (boss.y ?? 0),
      rotY: zar() * Math.PI * 2,
      level: tamsayi(def.level, 1),
      hp: maxHp, maxHp, tabanMaxHp: maxHp,
      dead: false,
      /* Ev = dogdugu nokta; leash siniri yuvanin yaricapi (bosstaki ile ayni
         kaynak: spawns.json radius). Varyant zari ATILMAZ - cagri varligi
         yuva dogumu degildir. */
      evX: x, evZ: z,
      evYaricap: yaricap,
      evDogYaricap: 0,
      gez: null, gezSonraki: 0,
      /* Dogar dogmaz savasa katilir: bossun o anki hedefi. gameloop
         #canavarYZ korumali (safeUntil) oyuncuda hedefi zaten birakir. */
      hedefEntityId: Number(boss.hedefEntityId) > 0 ? Number(boss.hedefEntityId) : null,
      cagiran: st.monsterId,
      def,
    };
    world.varlikEkle(st.zoneId, a);
    st.adds.add(a.id);
    /* state.delta ELLE YOLLANMAZ - uniqueDogur'daki notla ayni sebep:
       gameloop ilgiGuncelle add'i gorus alanindakilere kendisi ekler. */
    return true;
  }

  /**
   * MADDE 42 - add bakimi (her tik): oldurulen add NORMAL respawn kuyruguna
   * girmis olur (gameloop #olum -> world.olumKaydet). Cagri varligi yeniden
   * DOGMAMALI: kuyruk kaydi silinir, ceset gameConfig.corpseDespawnMs sonra
   * dunyadan cikarilir (bossun kendi ceset akisiyla ayni desen).
   */
  function addBakimi(st) {
    if (!st.adds.size) return;
    const z = world?.zoneState?.get?.(st.zoneId);
    for (const id of [...st.adds]) {
      const a = world.varlik(st.zoneId, id);
      if (!a) { st.adds.delete(id); continue; }
      if (!a.dead && (a.hp ?? 0) > 0) continue;
      if (z?.olu) z.olu = z.olu.filter((o) => o.id !== id);
      const at = tamsayi(a.cesetSil, 0)
        || simdi() + Math.max(0, tamsayi(GCFG.corpseDespawnMs, 6000));
      cesetKuyrugu.push({ zoneId: st.zoneId, id, at });
      st.adds.delete(id);
    }
  }

  /** Boss oldu/despawn oldu: kalan TUM adds'ler kaldirilir (canli olanlar dahil). */
  function addTemizle(st) {
    if (!st.adds?.size) return;
    const z = world?.zoneState?.get?.(st.zoneId);
    for (const id of [...st.adds]) {
      if (z?.olu) z.olu = z.olu.filter((o) => o.id !== id);
      /* cesetKuyrugu hem `state.delta {rem}` yayinlar hem varligi siler -
         hayalet varlik kalmaz (D1 duzeltmesindeki desen). at = simdi. */
      if (world.varlik(st.zoneId, id)) cesetKuyrugu.push({ zoneId: st.zoneId, id, at: simdi() });
      st.adds.delete(id);
    }
  }

  // =========================================================================
  // 3c) PP MADDE 4 - UNIQUE BOS GANIMETI (changelog 0023 tr:3-7 ve tr:22-24)
  // -------------------------------------------------------------------------
  // "bol altin ve esya, bosun seviyesine uygun garanti bir ekipman parcasi
  //  ve %50 ihtimalle bir Muhurlu esya - bronz, gumus ya da altin; guclu
  //  boslarda iyi muhurlerin sansi daha yuksek." + "Unique boslar hicbir sey
  //  dusurmuyordu - dusuk seviyeli canavar ganimet kurali yuzunden ...
  //  Artik seviyeniz ne olursa olsun uniqueler kesmeye deger."
  //
  // KESIN ORANLAR PAKETTE YOK - yalniz changelog metnindeki kadari uygulanir,
  // gerisi UYDURULMAZ:
  //  - ALTIN+ESYA: bosun KENDI drops.json tablosu, combat.ganimet(e) SAHIPSIZ
  //    cagrilarak (combat.js:1194 "sahip bilinmiyorsa kapi kapali") -> seviye
  //    farki kapisi (noDropDeltaMin=9) devreye girmez; oran/aralik degerleri
  //    tablonun kendisi. CIFTLEME KORUMASI: olduren icin kapi ACIK idiyse
  //    (delta < 9) gameloop #ganimetDus ayni tabloyu ZATEN dusurdu - rulo
  //    atlanir, yalniz garanti parca eklenir.
  //  - GARANTI EKIPMAN: bosun kendi tablosundaki ekipman girdilerinden,
  //    tablonun kendi chance agirliklariyla (seviye uygunlugu tablodan
  //    gelir). %50 muhur zari tutarsa secim tablonun MUHURLU girdilerinden
  //    (dt_tigerwoman 116 bronz + 116 gumus + 116 altin), tutmazsa muhursuz
  //    girdilerden yapilir. Tabloda ekipman yoksa (dt_bonelord yalniz 7
  //    tuketilebilir tasiyor) YEDEK interim kural: katalogda reqLevel <=
  //    bos seviyesi olan esyalarin EN YUKSEK reqLevel grubundan biri.
  //  - %50 MUHUR: changelog'un acik orani. Kademe DAGILIMI hicbir kaynakta
  //    yok -> INTERIM monoton kural (bkz. muhurKademesi).
  // =========================================================================
  const EKIPMAN_TURLERI_U = new Set(['weapon', 'armor', 'shield', 'accessory']);

  /** INTERIM monoton muhur kademesi kurali (kaynakta dagilim YOK; tek kanit
   *  changelog 0023 "guclu boslarda iyi muhurlerin sansi daha yuksek").
   *  Agirliklar: bronz=(100-L), gumus=L, altin=L/2 - L buyudukce gumus/altin
   *  payi monoton artar (tigerwoman L20 -> ~%73/18/9, bonelord L80 ->
   *  ~%14/57/29). Olcum cikarsa yalniz bu fonksiyon degistirilir. */
  function muhurKademesi(L) {
    const w = [
      ['bronze', Math.max(1, 100 - L)],
      ['silver', Math.max(1, L)],
      ['gold', Math.max(1, L / 2)],
    ];
    let r = zar() * w.reduce((a, [, x]) => a + x, 0);
    for (const [k, x] of w) { r -= x; if (r <= 0) return k; }
    return 'bronze';
  }

  /**
   * Bos seviyesine uygun GARANTI ekipman tanimini secer; %50 zar tutarsa
   * MUHURLU kademeden (drop tablolari muhurlu esyalari AYRI girdiler olarak
   * zaten tasiyor: dt_tigerwoman 116+116+116 bronz/gumus/altin - baseId
   * eslemesi tablo girdileriyle ORTUSMEDIGI icin secim dogrudan `def.seal`
   * alanindan yapilir).
   */
  function garantiEkipman(e) {
    const L = tamsayi(e.level, 1);
    /* changelog 0023: "%50 ihtimalle bir Muhurlu esya". Kademe secilir,
       o kademede aday yoksa alta inilir, hic muhurlu aday yoksa muhursuz
       secilir (ikame esya uydurulmaz). */
    const kademeSira = zar() < 0.5
      ? { gold: ['gold', 'silver', 'bronze'],
          silver: ['silver', 'bronze'],
          bronze: ['bronze'] }[muhurKademesi(L)]
      : [];

    // 1) bosun KENDI tablosu - tablonun kendi chance agirliklariyla
    const tid = e.def?.dropTableId ?? null;
    const tablo = tid ? world?.dropTables?.get?.(tid) : null;
    const girdiler = [];
    for (const g of (tablo?.items ?? tablo?.entries ?? [])) {
      const def = combat?.itemStats?.get?.(g.itemId ?? g.id) ?? null;
      if (!def || !EKIPMAN_TURLERI_U.has(def.type)) continue;
      const ham = Number(g.chance ?? g.pct ?? 0);
      const agirlik = ham > 1 ? ham / 100 : ham;
      if (agirlik > 0) girdiler.push({ def, agirlik });
    }
    const tabloSec = (suzgec) => {
      const l = girdiler.filter(suzgec);
      if (!l.length) return null;
      let r = zar() * l.reduce((a, c) => a + c.agirlik, 0);
      for (const c of l) { r -= c.agirlik; if (r <= 0) return c.def; }
      return l[l.length - 1].def;
    };
    if (girdiler.length) {
      for (const k of kademeSira) {
        const s = tabloSec((c) => c.def.seal === k);
        if (s) return s;
      }
      return tabloSec((c) => !c.def.seal) ?? tabloSec(() => true);
    }

    /* 2) YEDEK (interim): tabloda hic ekipman yok (dt_bonelord yalniz 7
       tuketilebilir) -> katalogda reqLevel <= bos seviyesi olan esyalarin
       EN YUKSEK reqLevel grubundan duzgun dagilimla biri ("bos seviyesine
       uygun"un en yalin karsiligi; baska seviye->esya eslemesi hicbir
       kaynakta yok). Muhur zari tuttuysa once o kademenin katalog kayitlari
       denenir (muhurlu katalog reqLevel tavani 69 - L80 bosta "uygun"un
       en iyisi odur). */
    const katalogSec = (suzgec) => {
      let enIyi = -1;
      const grup = [];
      combat?.itemStats?.forEach?.((def) => {
        if (!def || !EKIPMAN_TURLERI_U.has(def.type) || !suzgec(def)) return;
        const rl = tamsayi(def.reqLevel, 0);
        if (rl > L || rl < enIyi) return;
        if (rl > enIyi) { enIyi = rl; grup.length = 0; }
        grup.push(def);
      });
      return grup.length ? grup[Math.floor(zar() * grup.length)] : null;
    };
    for (const k of kademeSira) {
      const s = katalogSec((def) => def.seal === k);
      if (s) return s;
    }
    return katalogSec((def) => !def.seal);
  }

  /** _RefDropOptLvlSel ReqOnlineTime kapisi icin oturum dakikasi.
   *  sistem_beceri.js:oturumDakikasi ile BIREBIR ayni: damgayi gameloop.js
   *  tikta koyar (ws._oturumT0), damga yoksa null doner ve combat.plusUret()
   *  kapiyi hic uygulamaz - eksik olcum "hep +0" uretmesin.
   *  ONEMLI: burada `simdi()` (ctx.now, testlerde sahte saat olabilir) DEGIL
   *  Date.now() kullanilir - damgayi koyan gameloop.js:1003 de Date.now()
   *  yaziyor; iki farkli saati cikarmak anlamsiz bir dakika verirdi.
   *
   *  SAHIPSIZ DUSUS ICIN KULLANILMAZ - bkz. sahipCevrimiciDk() asagida. */
  const oturumDakikasi = (ws) => (ws?._oturumT0 ? (Date.now() - ws._oturumT0) / 60_000 : null);

  /** ReqOnlineTime kapisina verilecek dakika - SAHIPLILIK farkini burasi cozer.
   *
   *  combat.plusUret()'in iki ayri "bos" degeri vardir ve KARISTIRILMAMALIDIR:
   *    null -> "olcum YOK" (kapi hic uygulanmaz; damgasiz ws icin bilincli
   *            secim, ki eksik olcum sessizce hep +0 uretmesin)
   *    0    -> "olculdu, KREDI YOK" (kapi en sert kademede uygulanir -> +0)
   *
   *  2026-09-05 - HATA: burasi sahip YOKKEN de oturumDakikasi(null) = null
   *  veriyordu, yani kapi SAHIPSIZ dususte hic uygulanmiyordu. Sonuc olculdu
   *  (200 dusus): sahipsiz ganimet +0..+5 atarken 30 dk cevrimici bir sahibin
   *  ganimeti yalniz +0/+1 alabiliyordu - herkese acik ganimet SAHIPLIDEN
   *  daha iyi dusuyordu. Diger uc ganimet yolu (gameloop #ganimetDus,
   *  sistem_beceri ganimetDus, sistem_binek-pet gpetOldurdu) her zaman bir ws
   *  tasidigi icin bu asimetri yalniz unique yolunda vardi.
   *
   *  Dogru okuma: ReqOnlineTime kredisi KISIYE aittir. Sahipsiz ganimeti
   *  (sonVuran yok/dusmus - GM ya da cevre olumu) kimin alacagi belli
   *  degildir, dolayisiyla hicbir kredi islemez -> 0. */
  const sahipCevrimiciDk = (ws) => (ws ? oturumDakikasi(ws) : 0);

  /**
   * Unique olumunde ganimeti YERE birakir (gameloop #ganimetDus deseninin
   * birebir aynasi: ground_item varliklari + state.delta {add} + sahiplik
   * kilidi + ganimet omru). Sahip = son vuran (st.sonVuran); bilinmiyorsa
   * ganimet sahipsiz dusurulur (herkes alabilir - #almaDenemesi kilidi
   * yalniz `sahip` doluyken isler).
   */
  function uniqueGanimet(st, e) {
    const sahipWs = st.sonVuran?.char ? st.sonVuran : null;
    const eklenecek = [];                      // {def, itemId, qty}
    let altin = 0;

    // 1) tablo rulosu - YALNIZ gameloop tarafi seviye kapisina takildiysa
    const kapiliydi = !!sahipWs?.char
      && combat?.ganimetKapisi?.(e, sahipWs.char) === true;
    if (kapiliydi && typeof combat?.ganimet === 'function') {
      const g = combat.ganimet(e);             // ch verilmez -> kapi kapali
      altin = Math.max(0, tamsayi(g?.gold, 0));
      /* Esya tavani 4: gameloop #ganimetDus `g.items.slice(0, 4)` ile ayni. */
      for (const it of (g?.items ?? []).slice(0, 4)) {
        if (!it?.itemId) continue;
        eklenecek.push({
          def: combat.itemStats?.get?.(it.itemId) ?? null,
          itemId: it.itemId,
          qty: Array.isArray(it.qty) ? Math.max(1, tamsayi(it.qty[0], 1)) : Math.max(1, tamsayi(it.qty, 1)),
        });
      }
    }

    // 2) GARANTI ekipman parcasi (%50 muhur zari garantiEkipman icinde)
    const parca = garantiEkipman(e);
    if (parca) {
      eklenecek.push({ def: parca, itemId: parca.id, qty: 1 });
    } else {
      log(`dirilis-unique: ${st.monsterId} icin garanti ekipman adayi yok - parca dusurulemedi`);
    }

    if (altin <= 0 && !eklenecek.length) return;

    // 3) yere birakma - gameloop #ganimetDus ile ayni kare/alan duzeni
    const t = simdi();
    const kilitMs = Math.max(0, tamsayi(GCFG.lootOwnerLockMs, 15_000));   // game-config: lootOwnerLockMs
    const omurMs = Math.max(0, tamsayi(GCFG.lootDespawnMs, 60_000));      // game-config: lootDespawnMs
    const yerlestir = () => {
      const a = zar() * Math.PI * 2, r = 1 + zar() * 2;
      return { x: e.x + Math.cos(a) * r, z: e.z + Math.sin(a) * r };
    };
    const zeminY = (x, z) => (typeof world?.groundY === 'function'
      ? world.groundY(st.zoneId, x, z, e.y) : (e.y ?? 0));
    const payloadlar = [];
    const birak = (v) => {
      world.varlikEkle(st.zoneId, v);
      const p = { id: v.id, kind: 'ground_item', modelKey: v.modelKey, name: v.name,
                  x: +v.x.toFixed(2), z: +v.z.toFixed(2), y: +v.y.toFixed(2), rotY: 0 };
      if (v.itemId) { p.itemId = v.itemId; p.qty = v.qty ?? 1; }
      if (v.gold) { p.gold = v.gold; p.qty = v.qty ?? 1; }
      payloadlar.push(p);
    };
    if (altin > 0) {
      const p = yerlestir();
      birak({ id: world.yeniVarlikId(), kind: 'ground_item',
              modelKey: 'drop_item_bag', name: `${altin} Gold`, gold: altin, qty: 1,
              x: p.x, z: p.z, y: zeminY(p.x, p.z), rotY: 0,
              ...(sahipWs ? { sahip: sahipWs.entityId, sahipBitis: t + kilitMs } : {}),
              bitis: t + omurMs });
    }
    /* +N kapisi tek dususte TEK kez okunur (ayni olumden dusen parcalar ayni
       dakikayi gorsun). Sahip yoksa 0 = "kredi yok" -> kapi en sert kademede;
       bkz. sahipCevrimiciDk() aciklamasi. */
    const dususCevrimiciDk = sahipCevrimiciDk(sahipWs);
    for (const it of eklenecek) {
      const p = yerlestir();
      /* Dusen ekipmanin ORNEGI burada uretilir ve varlikta saklanir - yerdeki
         esya ile cantaya giren AYNI kayit olur (gameloop MADDE 26 kurali;
         `yigin` tel semasina girmez, payload'a yazilmiyor).

         2026-09-05 - VARYANS: ucuncu argument (dusus ornegi) EKLENDI. Eskiden
         verilmiyordu ve esya.js "cagiran vermezse 0" dedigi icin UNIQUE'ten
         dusen her esya variance=0/plus=0 ile, yani ALTI nitelik grubunun
         altisi da rollRanges'in ALT SINIRINDA uretiliyordu - bos esyasi
         siradan bir mobunkinden KOTU cikiyordu. Cagri gameloop.js
         #ganimetDus ve sistem_beceri.js ganimetDus ile BIREBIR ayni kalip:
         kural tek yerde (combat.dususOrnegi) dursun diye burada yeniden
         formul yazilmaz. `combat.dususOrnegi` yoksa (eski/kisitli ctx)
         undefined gecer ve yeniYigin kendi `secenek = {}` varsayilanina
         duser - davranis eski haline doner, catlamaz. */
      const yigin = esya.yeniYigin(it.def ?? it.itemId, it.qty,
        combat?.dususOrnegi?.(it.def, { cevrimiciDk: dususCevrimiciDk }));
      birak({ id: world.yeniVarlikId(), kind: 'ground_item',
              modelKey: it.def?.modelKey ?? 'drop_item_bag',
              name: it.def?.name ?? it.itemId, itemId: it.itemId, qty: it.qty, yigin,
              x: p.x, z: p.z, y: zeminY(p.x, p.z), rotY: 0,
              ...(sahipWs ? { sahip: sahipWs.entityId, sahipBitis: t + kilitMs } : {}),
              bitis: t + omurMs });
    }
    if (payloadlar.length) {
      if (sahipWs && acik(sahipWs)) {
        frame(sahipWs, 'state.delta', { add: payloadlar });
        broadcast(st.zoneId, 'state.delta', { add: payloadlar }, sahipWs);
      } else {
        broadcast(st.zoneId, 'state.delta', { add: payloadlar }, null);
      }
      log(`unique ganimet: ${st.monsterId} -> altin ${altin}, esya ${eklenecek.length}`
        + ` (tablo rulosu ${kapiliydi ? 'MODULDEN' : 'gameloop tarafindan'})`);
    }
  }

  function uniqueTik() {
    const t = simdi();
    for (const st of UNIQUE.values()) {
      if (st.live) {
        const e = st.entityId != null ? world.varlik(st.zoneId, st.entityId) : null;
        if (!e) {
          /* Varlik baska bir sey tarafindan silindi (GM /clear vb.):
             oldu saymadan yeniden zamanla. */
          st.live = false; st.entityId = null;
          uniqueZamanla(st);
          timersYayinla();
          continue;
        }
        if (e.dead || e.hp <= 0) {
          st.live = false;
          st.entityId = e.id;
          uniqueOldu(st, e);
        } else {
          /* MADDE 42: boss yasiyor - HP bandi kontrolu + add bakimi. */
          bandKontrol(st, e);
          addBakimi(st);
        }
        continue;
      }
      if (st.spawnAtMs != null && t >= st.spawnAtMs) {
        /* EK KARAR (gereksinim_unique_nerede 2026-09-03): sure dolunca bolge
           BOS/hic acilmamis olsa bile GERCEK dogum - eski "hazir bekle,
           00:00:00'da takil" varyanti (madde 7) kaldirildi. Guvenli, cunku
           world.js TEMBEL DOGUS doneminde varlikEkle -> #bolge yalnizca BOS
           bir zoneState kurar (world.js:195-198: "#bolgeyiDoldur KALDIRILDI,
           yuvalar oyuncu yaklastikca aciliyor"), gameloop oyuncusuz bolgede
           canavar YZ'yi zaten atlar ve world.oyuncuCik yalniz YUVA
           varliklarini kapatir (z.acik) - dogrudan eklenen unique kalir.
           Dogum basarisiz olursa (mobs.json/kamp eksigi) spawnAtMs gecmiste
           kalir, sonraki tik yeniden dener (aktif-bolge dalinin eski
           davranisiyla ayni). Kabul: cubukta takili 00:00:00 kalmaz -
           ya geri sayim ya "Dogdu". */
        uniqueDogur(st);
      }
    }
    for (let i = cesetKuyrugu.length - 1; i >= 0; i--) {
      const c = cesetKuyrugu[i];
      if (c.at > t) continue;
      /* DENETIM DUZELTMESI: cekirdek her varlik silisinde ONCE
         state.delta {rem:[id]} yayinliyor (gameloop.js @266 ganimet alma,
         @605 ganimet suresi dolmasi). Bunu atlarsak varligi hala
         `ws.gorunen` kumesinde tasiyan istemcide ceset HAYALET olarak
         kalir - ilgiGuncelle silinmis varligi artik dolasmadigi icin
         `rem` bir daha URETILEMEZ. */
      try { broadcast(c.zoneId, 'state.delta', { rem: [c.id] }, null); } catch { /* onemsiz */ }
      world.varlikSil?.(c.zoneId, c.id);
      cesetKuyrugu.splice(i, 1);
    }
  }

  /* SARTNAME MADDE 7 - EMNIYET AGI. EK KARAR sonrasi tik yolu bolge
     beklemeden dogurdugu icin `hazir` yeni kodda hic set edilmiyor; bu
     fonksiyon yalniz DEVIRLE gelen eski `hazir` kayitlarini (kod gecisi
     penceresi) zone.ready aninda dogurtmak icin duruyor. Zararsiz: hazir
     olmayan kayitlarda dongu bos gecer. */
  function hazirDogum() {
    for (const st of UNIQUE.values()) {
      if (st.hazir && !st.live && bolgeAktif(st.zoneId)) uniqueDogur(st);
    }
  }

  // =========================================================================
  // 4) unique.timers (203)
  // =========================================================================
  /* SERIT C — "Nerede?" harita butonu (gereksinim_unique_nerede madde 2).
     -----------------------------------------------------------------------
     203 karesine unique KONUMU ekleniyor. Sema (paket @25621188) bir duz
     z.object(); istemci gelen kareyi ZOD ILE DOGRULAMIYOR — bu OLCULDU:
       - JQ(ad,id,sema,rateClass) kayitlari agt/ogt haritalarina YAZILIR ama
         paketin hicbir yerinde OKUNMAZ (agt/ogt yalniz @18693763/18693775
         tanim satirinda ve JQ govdesinde gecer),
       - alis yolu: ws.onmessage -> onFrame(decode) -> dispatch(e) ->
         invoke(e.t, e.d) -> handlers.get(t)(d)   (@18730066)
         => handler HAM JSON alir, hicbir alan suzulmez.
       - handler: m$.on('unique.timers', e => F5.getState().setTimers(
         e.uniques, e.serverTime))  (@19730578)  -> ek alanlar store'a
         oldugu gibi girer.
     Bu yuzden fazladan alanlar sema disi AMA zararsizdir; eski istemci de
     onlari gormezden gelir.

       x / z : YALNIZ live iken — unique varliginin ANLIK dunya konumu.
       camps : uniques.json'daki GERCEK Tab_RefNest noktalari; unique
               dogmamisken zamanlayici bunlardan BIRINI atar (uniqueDogur),
               yani "nerede dogabilir" kumesi. Sabit veri -> bir kez
               hazirlanir, karede referansla paylasilir.
     Sayilar tam sayiya yuvarlanir: harita 1 sektor = 288 dunya birimi
     (assets/map/manifest.json sectorU) — birim altindaki hassasiyet
     piksele donusmez, kare boyu ~1 KB kuculur. */
  const KAMP_NOKTA = new Map();
  for (const u of UNIQUE_TANIM) {
    const l = (Array.isArray(u.camps) ? u.camps : [])
      .filter((k) => Number.isFinite(Number(k?.x)) && Number.isFinite(Number(k?.z)))
      .map((k) => ({ x: Math.round(Number(k.x)), z: Math.round(Number(k.z)) }));
    if (l.length) KAMP_NOKTA.set(u.monsterId, l);
  }

  /** Canli unique'in anlik konumu; varlik yoksa dogdugu kamp; ikisi de
      yoksa null (istemci o zaman camps kumesini isaretler). */
  function canliKonum(st) {
    if (!st.live) return null;
    const e = st.entityId != null ? world?.varlik?.(st.zoneId, st.entityId) : null;
    const x = Number(e?.x ?? st.kamp?.x);
    const z = Number(e?.z ?? st.kamp?.z);
    if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
    return { x: Math.round(x), z: Math.round(z) };
  }

  /* EK DUZELTME D (gereksinim_unique_nerede madde 2) — CANLI HP.
     -----------------------------------------------------------------------
     Ayni kalip: 203 karesine x/z/camps nasil eklendiyse hp/maxHp de oyle
     eklenir (sema disi ek alan; istemci kareyi Zod ile dogrulamiyor, ham
     JSON store'a giriyor - bkz. timersPayload yorumu).
     YALNIZ live=true iken anlamli: olu/beklemede unique'te ikisi de null
     doner, istemci HP satirini o zaman hic cizmez.
     Kaynak alanlar UYDURULMADI: uniqueDogur varligi `maxHp` ile kuruyor ve
     hasarKancasiTak `hp`yi defineProperty getter'i olarak bagliyor
     (baslangic degeri maxHp) - yani ikisi de varligin GERCEK alanlari.
     Konum icin ayri bir world.varlik() aramasi yapilmasinin sebebi
     canliKonum'un sozlesmesini (yalniz konum) bozmamak; maliyet 60 sn'lik
     tikte 6 unique icin bir Map aramasi. */
  function canliCan(st) {
    if (!st.live) return null;
    const e = st.entityId != null ? world?.varlik?.(st.zoneId, st.entityId) : null;
    if (!e) return null;
    const maxHp = Math.round(Number(e.maxHp));
    if (!Number.isFinite(maxHp) || maxHp <= 0) return null;
    const ham = Math.round(Number(e.hp));
    if (!Number.isFinite(ham)) return null;
    return { hp: kirp(ham, 0, maxHp), maxHp };
  }

  function timersPayload() {
    const serverTime = simdi();
    return {
      serverTime,
      uniques: [...UNIQUE.values()].map((st) => {
        const k = canliKonum(st);
        const c = canliCan(st);
        return {
          monsterId: st.monsterId,
          zoneId: st.zoneId,
          live: st.live,
          /* CANLI OLCUM: live iken IKISI DE null (zone_init.json).
             Kelepce (spawnAtMs >= serverTime) sema/gosterim emniyeti olarak
             korunur; EK KARAR sonrasi dogum vaktinde gerceklestigi icin
             00:00:00 en fazla bir tik penceresi (200 ms) gorunur. */
          spawnAtMs: st.live ? null : Math.max(tamsayi(st.spawnAtMs, serverTime), serverTime),
          totalMs: st.live ? null : tamsayi(st.totalMs, 0),
          /* SERIT C ek alanlari (sema disi, istemci dogrulamiyor) */
          x: k ? k.x : null,
          z: k ? k.z : null,
          camps: KAMP_NOKTA.get(st.monsterId) ?? [],
          /* EK DUZELTME D: canli HP (yalniz live=true iken dolu) */
          hp: c ? c.hp : null,
          maxHp: c ? c.maxHp : null,
        };
      }),
    };
  }

  function timersYayinla() {
    const d = timersPayload();
    for (const ws of tumOyuncular()) frame(ws, 'unique.timers', d);
    sonTimers = simdi();
  }

  let sonTimers = 0;
  /** Ilk kez gordugumuz baglantilar - sayac cubugunu beklemesinler. */
  const timersGorduler = new WeakSet();

  function timersTik() {
    const t = simdi();
    if (t - sonTimers >= TIMERS_PERIYOT_MS) { timersYayinla(); return; }
    // yeni giren oyuncuya sayaclari hemen ver (istemci baska sekilde istemiyor)
    let d = null;
    for (const ws of tumOyuncular()) {
      if (timersGorduler.has(ws)) continue;
      timersGorduler.add(ws);
      d ??= timersPayload();
      frame(ws, 'unique.timers', d);
    }
  }

  // =========================================================================
  // 5) unique.board (204)  <-  unique.op (93)
  // =========================================================================
  /** charId -> {charId, name, level, points} */
  const PUAN = new Map();
  const PUAN_DOSYA = path.join(dataDir, 'unique-points.json');

  (function panoYukle() {
    if (!fs.existsSync(PUAN_DOSYA)) return;
    try {
      const ham = JSON.parse(fs.readFileSync(PUAN_DOSYA, 'utf8'));
      for (const r of ham?.rows ?? []) {
        if (!r?.charId) continue;
        PUAN.set(String(r.charId), {
          charId: String(r.charId), name: String(r.name ?? ''),
          level: tamsayi(r.level, 1), points: tamsayi(r.points, 0),
        });
      }
      log(`dirilis-unique: ${PUAN.size} unique puan kaydi yuklendi`);
    } catch (e) {
      log(`dirilis-unique: unique-points.json okunamadi - ${String(e.message).slice(0, 80)}`);
    }
  })();

  let kaydetZaman = null;
  /** Dosyaya ANINDA yazar (debounce'suz). dur() de bunu cagirir. */
  function panoyuYaz() {
    if (ctx.kayitYok) return;
    try {
      const rows = [...PUAN.values()].sort((a, b) => b.points - a.points);
      fs.writeFileSync(PUAN_DOSYA, JSON.stringify({
        $not: 'sistem_dirilis-unique.js tarafindan yazilir - unique puan panosu',
        rows,
      }, null, 1));
    } catch (e) {
      log(`dirilis-unique: unique-points.json yazilamadi - ${String(e.message).slice(0, 80)}`);
    }
  }

  function panoKaydet() {
    if (ctx.kayitYok) return;
    if (kaydetZaman) return;
    kaydetZaman = setTimeout(() => { kaydetZaman = null; panoyuYaz(); }, 2000);
    if (kaydetZaman.unref) kaydetZaman.unref();
  }

  function puanEkle(charId, name, level, puan) {
    const k = String(charId);
    const r = PUAN.get(k) ?? { charId: k, name: String(name ?? ''), level: tamsayi(level, 1), points: 0 };
    r.points += tamsayi(puan, 0);
    if (name) r.name = String(name);
    if (level) r.level = tamsayi(level, r.level);
    PUAN.set(k, r);
    /* Karakter nesnesine de yaz: baska sistemler (GM paneli, istatistik)
       okuyabilsin. Kalici kaydi unique-points.json yapiyor. */
    return r;
  }

  function uniquePanosu(ws) {
    const sirali = [...PUAN.values()]
      .filter((r) => r.points > 0)
      .sort((a, b) => (b.points - a.points) || String(a.name).localeCompare(String(b.name)));
    const rows = sirali.slice(0, PANO_SATIR).map((r, i) => ({
      rank: i + 1, name: r.name, level: tamsayi(r.level, 1), points: r.points,
    }));
    const benimId = String(ws.char?.id ?? '');
    const idx = sirali.findIndex((r) => r.charId === benimId);
    const me = idx >= 0 ? { rank: idx + 1, points: sirali[idx].points } : null;
    frame(ws, 'unique.board', { kind: 'unique', rows, me });
  }

  function seviyePanosu(ws) {
    /* Kaynak: o an bagli oyuncular + unique puan kaydinda gorulmus
       karakterlerin son bilinen seviyesi. ctx'te veritabani havuzu YOK
       (server.js sistemlere `web: null` geciyor), bu yuzden TUM shard'i
       tarayan bir sorgu YAPILAMAZ. ctx.seviyeKaynagi() verilirse o kullanilir. */
    let kayitlar;
    if (typeof ctx.seviyeKaynagi === 'function') {
      kayitlar = (ctx.seviyeKaynagi() ?? []).map((r) => ({
        charId: String(r.charId ?? r.id ?? r.name),
        name: String(r.name ?? ''), level: tamsayi(r.level, 1),
      }));
    } else {
      const harita = new Map();
      for (const r of PUAN.values()) {
        harita.set(r.charId, { charId: r.charId, name: r.name, level: tamsayi(r.level, 1) });
      }
      for (const c of tumOyuncular()) {
        if (!c.char?.id) continue;
        harita.set(String(c.char.id), {
          charId: String(c.char.id), name: String(c.char.name ?? ''),
          level: tamsayi(c.char.level, 1),
        });
      }
      kayitlar = [...harita.values()];
    }
    kayitlar = kayitlar.filter((r) => r.name)
      .sort((a, b) => (b.level - a.level) || a.name.localeCompare(b.name));

    /* .strict() - SADECE rank/name/level. Fazla alan gonderilirse istemci
       paketi kareyi sessizce atar. */
    const rows = kayitlar.slice(0, PANO_SATIR).map((r, i) => ({
      rank: i + 1, name: r.name, level: r.level,
    }));
    const benimId = String(ws.char?.id ?? '');
    const idx = kayitlar.findIndex((r) => r.charId === benimId);
    const me = idx >= 0 ? { rank: idx + 1, level: kayitlar[idx].level } : null;
    frame(ws, 'unique.board', { kind: 'level', rows, me });
  }

  function meslekPanosu(ws, professionId) {
    /* Meslek seviyeleri bu modulde DEGIL (sistem_meslek.js'in verisi).
       ctx.meslekKaynagi(professionId) verilmemisse BOS ama GECERLI bir
       kare yolluyoruz: istemci sekme basina bir kez soruyor (@27565913),
       cevap gelmezse pano sonsuza dek bos/asili kalir. */
    let kayitlar = [];
    if (typeof ctx.meslekKaynagi === 'function') {
      kayitlar = (ctx.meslekKaynagi(professionId) ?? []).map((r) => ({
        charId: String(r.charId ?? r.id ?? r.name),
        name: String(r.name ?? ''), level: tamsayi(r.level, 1),
      })).filter((r) => r.name)
        .sort((a, b) => (b.level - a.level) || a.name.localeCompare(b.name));
    }
    const rows = kayitlar.slice(0, PANO_SATIR).map((r, i) => ({
      rank: i + 1, name: r.name, level: r.level,
    }));
    const benimId = String(ws.char?.id ?? '');
    const idx = kayitlar.findIndex((r) => r.charId === benimId);
    const me = idx >= 0 ? { rank: idx + 1, level: kayitlar[idx].level } : null;
    frame(ws, 'unique.board', { kind: 'profession', professionId, rows, me });
  }

  function uniqueOp(ws, d) {
    const op = String(d?.op ?? '');
    if (op === 'board') { uniquePanosu(ws); return true; }
    if (op === 'levelBoard') { seviyePanosu(ws); return true; }
    if (op === 'professionBoard') {
      const pid = String(d?.professionId ?? '');
      if (!pid || pid.length > 64) { hata(ws, 'ERR_VALIDATION'); return true; }
      meslekPanosu(ws, pid);
      return true;
    }
    hata(ws, 'ERR_VALIDATION');
    return true;
  }

  // =========================================================================
  // 6) DIRILIS BECERISI  ->  revive.offer (201)
  // =========================================================================
  /** offerId -> teklif */
  const TEKLIF = new Map();
  let teklifSayaci = 1;
  let aidSayaci = 2_000_000;   // gameloop 1.., sistem_beceri 1_000_000.. kullaniyor

  function durum(ws) {
    let s = ws.dirilisBec;
    if (!s) s = ws.dirilisBec = { cd: new Map(), cast: null };
    return s;
  }

  /** Paket v1(): gruptaki EN YUKSEK seviyeli BILINEN beceri. */
  function beceriCoz(ch, groupId) {
    const liste = DIRILIS_GRUP.get(groupId);
    if (!liste) return null;
    const bilinen = new Set(ch?.knownSkills ?? []);
    for (let i = liste.length - 1; i >= 0; i--) if (bilinen.has(liste[i].id)) return liste[i];
    return null;
  }

  function mpMaliyeti(ch, skill) {
    const dus = tamsayi(derived(ch)?.mpDiscountPct, 0);
    const v = tamsayi(skill.mpCost, 0);
    if (dus <= 0) return Math.max(0, v);
    return Math.max(0, Math.trunc(v * (1 - Math.min(100, dus) / 100)));
  }

  function uzaklik2(a, b) {
    const dx = (a?.x ?? 0) - (b?.x ?? 0), dz = (a?.z ?? 0) - (b?.z ?? 0);
    return dx * dx + dz * dz;
  }

  /** Olu oyuncu hedefi (corpse). Olu oyuncular world varligi DEGIL. */
  function oluOyuncu(zoneId, entityId) {
    const kume = world?.bolgeOyunculari?.(zoneId)
      ?? [...(world?.zoneState?.get?.(zoneId)?.players ?? [])];
    for (const c of kume) if (c?.entityId === entityId && c?.char?.dead) return c;
    return null;
  }

  /**
   * c2s 22 skill.cast — YALNIZCA dirilis becerileri.
   * Baska her sey icin FALSE doner ki sistem_beceri.js islesin.
   */
  function dirilisCast(ws, d) {
    const ch = ws.char;
    const groupId = String(d?.groupId ?? '');
    if (!groupId || !DIRILIS_GRUP.has(groupId)) return false;   // bizim isimiz degil
    if (d?.stage != null) return false;                          // asama istegi bize gelmez

    const skill = beceriCoz(ch, groupId);
    if (!skill) return false;              // grup dirilis ama oyuncu bilmiyor -> beceri modulu
    if (skill.kind !== 'revive') return false;

    if (ch.dead) { hata(ws, 'ERR_DEAD'); return true; }
    if (skill.disabled) { hata(ws, 'ERR_VALIDATION', 'err.skill.disabled'); return true; }

    const s = durum(ws);
    const t0 = simdi();
    if (t0 < (s.cd.get(groupId) ?? 0)) { hata(ws, 'ERR_COOLDOWN'); return true; }

    const hedefId = d?.targetId != null ? tamsayi(d.targetId, -1) : -1;
    if (hedefId < 0 || hedefId === ws.entityId) {
      hata(ws, 'ERR_VALIDATION', 'err.skill.requires_downed'); return true;
    }
    const hedef = oluOyuncu(ws.zoneId, hedefId);
    if (!hedef) { hata(ws, 'ERR_NOT_FOUND', 'err.skill.requires_downed'); return true; }

    const rv = skill.revive ?? {};
    const enUst = tamsayi(rv.maxTargetLevel, 0);
    if (enUst > 0 && tamsayi(hedef.char.level, 1) > enUst) {
      hata(ws, 'ERR_REQ_LEVEL', 'err.revive.target_level'); return true;
    }

    const mp = mpMaliyeti(ch, skill);
    if (tamsayi(ch.mp, 0) < mp) { hata(ws, 'ERR_NO_MP'); return true; }

    const menzil = (skill.rangeU ?? 0) > 0
      ? skill.rangeU
      : (combat?.oyuncuMenzili?.(ch) ?? 0);
    if (menzil > 0 && uzaklik2(ch, hedef.char) > menzil * menzil) {
      hata(ws, 'ERR_RANGE'); return true;
    }

    // --- maliyet + bekleme -------------------------------------------------
    if (mp > 0) {
      ch.mp = Math.max(0, tamsayi(ch.mp, 0) - mp);
      frame(ws, 'vitals.update', { hp: Math.round(ch.hp ?? 0), mp: Math.round(ch.mp) });
    }
    const readyAt = t0 + tamsayi(skill.cooldownMs, 0);
    if (tamsayi(skill.cooldownMs, 0) > 0) s.cd.set(groupId, readyAt);
    frame(ws, 'cast.ok', { groupId, readyAt });

    const aid = ++aidSayaci;
    const castMs = Math.max(0, tamsayi(skill.castMs, 0));
    if (castMs > 0) {
      const kare = { id: ws.entityId, groupId, castMs, aid, at: t0, targetId: hedefId };
      yayin(ws, 'cast.start', kare);
      s.cast = { aid, skill, hedefId, groupId, ateslemeAt: t0 + castMs };
    } else {
      atesle(ws, skill, hedefId, aid, t0);
    }
    return true;
  }

  function atesle(ws, skill, hedefId, aid, t0) {
    if (!acik(ws) || ws.char?.dead) return;
    const hedef = oluOyuncu(ws.zoneId, hedefId);
    if (!hedef) {
      yayin(ws, 'cast.cancel', { id: ws.entityId, aid });
      frame(ws, 'cast.queued', {
        state: 'dropped', groupId: skill.groupId, reason: 'cancelled', aid,
      });
      return;
    }
    yayin(ws, 'skill.fire', { id: ws.entityId, skillId: skill.id, targetId: hedefId, aid, at: t0 });
    dirilisTeklifi({ hedef, caster: ws, skill });
  }

  /**
   * DISA ACIK API — GM komutu / baska sistem de cagirabilir.
   * @returns offerId | null
   */
  function dirilisTeklifi({ hedef, caster = null, skill = null, skillId = null } = {}) {
    if (!hedef?.char?.dead || !acik(hedef)) return null;
    const rv = skill?.revive ?? {};
    const t = derived(hedef.char) ?? { maxHp: 1, maxMp: 0 };

    /* MUTLAK degerler (revive.result icin): hpFlat + maxHp*hpPct/100.
       Dirilis becerisi yoksa (GM) game-config.respawnHpPct = 0.5. */
    const varsayilanPct = Math.round(Number(GCFG.respawnHpPct ?? 0.5) * 100);
    const hpPct = skill ? tamsayi(rv.hpPct, 0) : varsayilanPct;
    const mpPct = skill ? tamsayi(rv.mpPct, 0) : varsayilanPct;
    const hpFlat = skill ? tamsayi(rv.hpFlat, 0) : 0;
    const mpFlat = skill ? tamsayi(rv.mpFlat, 0) : 0;

    const maxHp = Math.max(1, tamsayi(t.maxHp, 1));
    const maxMp = Math.max(0, tamsayi(t.maxMp, 0));
    const mutlakHp = kirp(hpFlat + Math.floor((maxHp * hpPct) / 100), 1, maxHp);
    const mutlakMp = kirp(mpFlat + Math.floor((maxMp * mpPct) / 100), 0, maxMp);

    /* GOSTERIM degerleri: paket ipucu satiri (@25922297)
         hp: revive.hpFlat || revive.hpPct
       ve ui.revive.restore = "%{hp} HP / %{mp} MP geri kazandirir". */
    const gosterimHp = Math.max(0, hpFlat || hpPct);
    const gosterimMp = Math.max(0, mpFlat || mpPct);

    const offerId = teklifSayaci++;
    const expiresAt = simdi() + Math.max(1000, tamsayi(GCFG.reviveOfferMs, TEKLIF_SURESI_MS));
    const kayit = {
      offerId,
      charId: String(hedef.char.id),
      hedef,
      casterId: caster?.entityId ?? 0,
      casterName: String(caster?.char?.name ?? 'GM'),
      skillId: String(skill?.id ?? skillId ?? 'revive'),
      expiresAt, mutlakHp, mutlakMp,
    };
    TEKLIF.set(offerId, kayit);

    frame(hedef, 'revive.offer', {
      offerId,
      casterId: kayit.casterId,
      casterName: kayit.casterName,
      skillId: kayit.skillId,
      expiresAt,
      hp: gosterimHp,
      mp: gosterimMp,
    });
    return offerId;
  }

  // =========================================================================
  // 7) revive.respond (85)  ->  revive.result (202)
  // =========================================================================
  function dirilisCevabi(ws, d) {
    const offerId = tamsayi(d?.offerId, -1);
    const kabul = d?.accept === true;
    const teklif = TEKLIF.get(offerId);

    if (!teklif || teklif.charId !== String(ws.char?.id)) {
      frame(ws, 'revive.result', { id: ws.entityId, ok: false, reason: 'unknown_offer' });
      return true;
    }
    TEKLIF.delete(offerId);
    /* Reddetme: istemci teklifi kendi silmis (@27580807) - kare gondermiyoruz. */
    if (!kabul) return true;

    if (teklif.expiresAt <= simdi()) {
      frame(ws, 'revive.result', { id: ws.entityId, ok: false, reason: 'expired' });
      return true;
    }
    if (!ws.char.dead) {
      frame(ws, 'revive.result', { id: ws.entityId, ok: false, reason: 'not_dead' });
      return true;
    }
    dirilt(ws, {
      hp: teklif.mutlakHp, mp: teklif.mutlakMp,
      casterId: teklif.casterId, skillId: teklif.skillId,
    });
    return true;
  }

  /**
   * YERINDE DIRILIS. Isinlanma YOK - oyuncu oldugu yerde kalkar.
   * revive.result istemcide `dead` bayragini sifirlayan TEK mesajdir.
   */
  function dirilt(ws, { hp, mp, casterId = null, skillId = null }) {
    const ch = ws.char;
    const t = derived(ch) ?? { maxHp: 1, maxMp: 0 };
    const maxHp = Math.max(1, tamsayi(t.maxHp, 1));
    const maxMp = Math.max(0, tamsayi(t.maxMp, 0));
    const yeniHp = kirp(tamsayi(hp, 1), 1, maxHp);
    const yeniMp = kirp(tamsayi(mp, 0), 0, maxMp);

    ch.dead = false;
    ch.hp = yeniHp;
    ch.mp = yeniMp;
    ws.savas = null;
    ws.hedefId = null;
    /* MADDE 4 (capraz istek): yerinde dirilen oyuncunun OLMEDEN ONCEKI bacagi
       silinmezse bir sonraki tikte eski hedefine dogru kendi kendine yurur.
       gameloop.js #dirilt ve olum yollari ayni iptali zaten yapiyor; buradaki
       dal eksik kalmisti. KAYNAK: paket applyTeleport @25665291
       `path=null; snap=true`. Olmeden once baslamis ganimet yaklasmasi da
       birakilir. */
    bacakDurdur(ch);
    ws.alma = null;

    const sonuc = { id: ws.entityId, ok: true, hp: yeniHp, mp: yeniMp };
    if (casterId) sonuc.casterId = casterId;
    if (skillId) sonuc.skillId = skillId;
    frame(ws, 'revive.result', sonuc);
    broadcast(ws.zoneId, 'revive.result', sonuc, ws);

    frame(ws, 'vitals.update', { hp: yeniHp, mp: yeniMp });
    const can = { id: ws.entityId, hp: yeniHp, maxHp };
    frame(ws, 'entity.hp', can);
    broadcast(ws.zoneId, 'entity.hp', can, ws);

    /* Olen oyuncuyu hedefleyen canavarlarin agrosunu birak - dirilir dirilmez
       ayni canavar tarafindan tekrar dovulmesin (gameloop olunce zaten
       hedefEntityId'yi null yapiyor ama beceri ile olduren yol yapmiyor). */
    const z = world?.zoneState?.get?.(ws.zoneId);
    if (z?.entities) {
      for (const e of z.entities.values()) {
        if (e.hedefEntityId === ws.entityId) e.hedefEntityId = null;
      }
    }
    return sonuc;
  }

  function teklifTemizle() {
    const t = simdi();
    for (const [k, v] of TEKLIF) if (v.expiresAt <= t) TEKLIF.delete(k);
  }

  function castTik() {
    const t = simdi();
    for (const ws of tumOyuncular()) {
      const s = ws.dirilisBec;
      if (!s?.cast) continue;
      if (!acik(ws) || ws.char?.dead) { s.cast = null; continue; }
      if (t < s.cast.ateslemeAt) continue;
      const c = s.cast;
      s.cast = null;
      atesle(ws, c.skill, c.hedefId, c.aid, t);
    }
  }

  // =========================================================================
  // ORTAK YARDIMCILAR
  // =========================================================================
  const acik = (ws) => !!ws && (ws.readyState === undefined || ws.readyState === 1) && !!ws.char;

  function tumOyuncular() {
    const out = [];
    const zs = world?.zoneState;
    if (!zs || typeof zs.forEach !== 'function') return out;
    for (const [, z] of zs) {
      for (const c of z?.players ?? []) if (acik(c)) out.push(c);
    }
    return out;
  }

  function herkese(t, d) {
    for (const ws of tumOyuncular()) frame(ws, t, d);
  }

  function yayin(ws, t, d) {
    frame(ws, t, d);
    broadcast(ws.zoneId, t, d, ws);
  }

  function hata(ws, code, key = null) {
    const d = { code };
    if (key) d.key = key;
    frame(ws, 'err', d);
  }

  // =========================================================================
  // KURULUS
  // =========================================================================
  const ayrim = yuvalariAyir();
  uniqueKur();
  log(`dirilis-unique: ${UNIQUE.size} unique, ${ayrim.ayrilan} unique yuvasi ` +
      `normal dogumdan ayrildi${ayrim.silinen ? `, ${ayrim.silinen} kopya varlik silindi` : ''}`);

  function tik() {
    try { uniqueTik(); } catch (e) { log('dirilis-unique unique tik: ' + String(e.message).slice(0, 100)); }
    try { castTik(); } catch (e) { log('dirilis-unique cast tik: ' + String(e.message).slice(0, 100)); }
    try { teklifTemizle(); } catch { /* yok */ }
    try { timersTik(); } catch (e) { log('dirilis-unique timers tik: ' + String(e.message).slice(0, 100)); }
  }

  const zamanlayici = ctx.tikYok ? null : setInterval(() => {
    try { tik(); } catch (e) { log('dirilis-unique tik hatasi: ' + String(e.message).slice(0, 100)); }
  }, TIK_MS);
  if (zamanlayici?.unref) zamanlayici.unref();

  // =========================================================================
  // DISA ACILAN
  // =========================================================================
  const ORNEK = {
    /** Yonlendirici sozlesmesi: ilgilenmedigimiz mesajda false. */
    mesaj(ws, t, d) {
      if (!ws?.char) return false;
      switch (t) {
        /* respawn.request (80) BU MODULDE DEGIL: server.js once
           LOOP.mesaj() cagiriyor, oradaki gameloop.js #dirilt sehre donusu
           zaten sahipleniyor (revive.result gonderecek sekilde duzeltildi). */
        case 'skill.cast': return dirilisCast(ws, d ?? {});
        case 'revive.respond': return dirilisCevabi(ws, d ?? {});
        case 'unique.op': return uniqueOp(ws, d ?? {});
        /* SENTETIK zone.ready (giris.js girisAkisi). DUZELTILMIS ATIF
           (2026-09-03 denetimi): giris kareleri KUME olarak kanitli; SIRASI
           elle transkripsiyon olan zone_init.json'dan KANITLANAMAZ
           (GERCEK/denetim/sim3/test_giris-kareleri.mjs:153-160). giris.js
           TEKIL_SIRA klonun kendi secimidir - uc kare (env.clock /
           unique.timers / guild.state) bagimsiz store'lara yazar, sira
           islevsel fark yaratmaz. Kareyi burada tampona koyuyoruz; koymazsak
           giris.js varsayilanKare ile BOS liste yolluyor ve sayac cubugu ilk
           60 sn bos kaliyor.
           Mesaji TUKETMIYORUZ (false) - baska moduller de zone.ready dinliyor. */
        case 'zone.ready':
          try {
            /* SARTNAME MADDE 7: bu oyuncunun girisi bolgeyi aktive ettiyse
               takvimi dolmus (hazir) unique tik beklemeden HEMEN dogar -
               asagidaki 203 karesi onu canli gosterir. */
            hazirDogum();
            timersGorduler.add(ws); frame(ws, 'unique.timers', timersPayload());
          }
          catch { /* giris akisini bozma */ }
          return false;
        default: return false;
      }
    },
    tik,
    dur() {
      if (zamanlayici) clearInterval(zamanlayici);
      /* DENETIM DUZELTMESI: bekleyen 2 sn'lik kaydi SUSTURMA, BOSALT.
         Eski hali sadece clearTimeout yapiyordu; oldurulen unique'in
         puanlari, olumden sonraki 2 sn icinde bir sistemleriKur()
         (admin ayar degisikligi) olursa diske hic yazilmadan KAYBOLUYORDU. */
      if (kaydetZaman) { clearTimeout(kaydetZaman); kaydetZaman = null; panoyuYaz(); }
      /* Takvim + yuva bilgisini bir sonraki kur()'a devret. */
      try { ONCEKI_DURUM = durumuDevret(); } catch { /* onemsiz */ }
    },
    /** Dis kullanicilar (GM komutu, baska sistem). */
    dirilisTeklifi,
    dirilt,
    timersPayload,
    timersYayinla,
    _ic: {
      UNIQUE, TEKLIF, PUAN, YUVA, DIRILIS_GRUP, MSK,
      uniqueDogur, uniqueOldu, uniqueZamanla, hazirDogum,
      bandKontrol, addBakimi, addTemizle, canliAddSayisi,
    },
  };
  ONCEKI_ORNEK = ORNEK;
  return ORNEK;
}

/* ===========================================================================
 * BAGLAMA NOTU  (ANA OTURUM ICIN)
 * ---------------------------------------------------------------------------
 * 1) server.js SISTEM_ADLARI dizisine ekle:
 *        'dirilis-unique'
 *    SIRA ONEMLI DEGIL: bu modul skill.cast'i yalnizca kind==='revive'
 *    becerilerde sahipleniyor, digerlerinde false donuyor. Ancak
 *    sistem_beceri.js'in `!DESTEKLENEN.has(skill.kind)` kapisi revive'i
 *    ERR_VALIDATION ile YUTUYORDU; o kapiya `if (skill.kind === 'revive')
 *    return false;` eklendi (kucuk, isaretli yama).
 *
 * 2) gameloop.js #dirilt (sehre donus) revive.result gondermiyordu ->
 *    olum perdesi hic kapanmiyordu. Duzeltildi ve %30 yerine
 *    game-config.respawnHpPct (0.5) kullaniyor.
 *
 * 3) sistem_kucuk-sistemler.js ile CAKISMA (o dosya da @1872 uyariyor):
 *    O modul de revive.respond (85) ve unique.op (93) isliyor VE kendi unique
 *    zamanlayicisi var. IKISI BIRDEN kayitliysa yonlendirme sirasi YETMEZ -
 *    dogum mesajdan bagimsiz, kendi zamanlayicisinda olur; unique'ler CIFT
 *    dogar ve duyurular cift gider. Onerilen (o dosyanin da onerisi):
 *    dirilis+unique'i BU MODULE birak, sistem_kucuk-sistemler.js icinden
 *    `revive.respond` / `unique.op` case'lerini ve uniqueKur() cagrisini kaldir.
 *    (Ayrica o modul world.spawnPoints'e DOKUNMUYOR: tek basina kalirsa
 *    spawns.json'daki 64 unique yuvasi normal canavar gibi dogmaya devam eder.)
 *
 * 4) giris.js ile uyum: sentetik `zone.ready` bu modulde de dinleniyor
 *    (mesaj TUKETILMEZ) ve unique.timers karesi tampona konuyor. Giris
 *    sirasi giris.js TEKIL_SIRA'nin KENDI secimidir (kare KUMESI kanitli,
 *    sirasi elle transkripsiyon zone_init.json'dan kanitlanamaz):
 *        zone.init -> env.clock -> unique.timers -> guild.state -> batch[...]
 *    giris.js'in varsayilanKare('unique.timers') = {uniques: []} dali artik
 *    yalniz bu modul YUKLU DEGILKEN devreye girer.
 *
 * ctx'ten KULLANILANLAR:
 *   world     - dataDir, mobDefs, spawnPoints, zoneState, varlik(), varlikEkle(),
 *               varlikSil(), yeniVarlikId(), groundY(), bolgeOyunculari()
 *   combat    - turetilmis() (derived uzerinden), oyuncuMenzili()
 *   frame / broadcast / log / GCFG / derived
 * ctx'ten KULLANILMAYANLAR: ITEMSTATS, zoneGroundY, yurunebilirNokta,
 *   envanterPayload, SHARD, web
 *
 * ISTEGE BAGLI ctx KANCALARI (verilmezse makul varsayilan):
 *   ctx.rastgele()               deterministik test icin zar
 *   ctx.tikYok                   ic zamanlayiciyi kapatir (test tik'i elle surer)
 *   ctx.kayitYok                 unique-points.json yazmayi kapatir
 *   ctx.uniquePuanHavuzu(def)    puan havuzu (varsayilan: def.level)
 *   ctx.seviyeKaynagi()          levelBoard icin tam karakter listesi
 *   ctx.meslekKaynagi(pid)       professionBoard icin meslek seviyeleri
 *
 * ILERISI ICIN (daha temiz): ctx'e bir `hasarKancasi(varlik, saldiranWs, hasar)`
 * eklenirse bu moduldeki hp/hedefEntityId erisimci numarasi kaldirilabilir.
 *
 * ---------------------------------------------------------------------------
 * TESTLER
 *   node test_dirilis-unique.mjs           islev testi        (120 kontrol)
 *   node test_dirilis-unique_denetim.mjs   denetim regresyonu ( 22 kontrol)
 * Ikisi de sahte ctx ile calisir: canli sunucuya/veritabanina DOKUNMAZ,
 * yeni hesap/karakter ACMAZ.
 *
 * BAGIMSIZ DENETIMDE DUZELTILEN DORT KUSUR (yedek: .bak-denetim):
 *   D1 ceset silinirken `state.delta {rem:[id]}` yayinlanmiyordu -> istemcide
 *      hayalet ceset (world.ilgiGuncelle silinmis varligi bir daha gormez).
 *   D2 sistemleriKur() (admin ayar degisikligi) 3-6 saatlik unique takvimini
 *      SIFIRLIYORDU - ayar dugmesi unique cagirilabiliyordu.
 *   D3 ayni yeniden kurulum CANLI bir unique varken varligi siliyor ve tam
 *      gecikmeyle zamanliyordu -> unique saatlerce kayboluyordu.
 *   D4 dur() bekleyen puan kaydini clearTimeout ile susturuyordu -> olumden
 *      sonraki 2 sn icinde yeniden kurulum olursa puanlar kayboluyordu.
 * =========================================================================== */
