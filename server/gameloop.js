/**
 * Oyun dongusu: hedefleme, otomatik saldiri, olum, odul, ganimet, canavar YZ.
 *
 * Mesaj payload'lari istemcinin Zod semalarindan BIREBIR alinmistir
 * (data/schemas.json):
 *
 *   c2s 18 target.set    {id}
 *   c2s 19 target.clear  {}
 *   c2s 20 combat.attack {id}
 *   c2s 21 combat.stop   {}
 *   c2s 50 loot.pickup   {id}
 *   c2s 80 respawn.request {}
 *
 *   s2c 137 entity.hp        {id, hp, maxHp}
 *   s2c 140 combat.event     {src, dst, kind, dmg, ...}
 *   s2c 141 combat.death     {id, killerId, aid?}
 *   s2c 144 progress.update  {xp, xpToNext, spExp, spExpToNext, sp}
 *   s2c 145 progress.levelUp {level, statPoints}
 *   s2c 150 vitals.update    {hp, mp}
 *   s2c 155 entity.pickup    {id}
 *   s2c 206 progress.gainFx  {sourceId, xpDelta, spExpDelta, recipientLevelAfter,
 *                             xpVisualDenominator, killerId, aid?}
 *
 * Zod zorunlu alanlari eksik gonderilirse istemci paketi SESSIZCE atar -
 * o yuzden hepsi dolduruluyor.
 *
 * `aid` HIJYENI (madde 12 - kullanicinin "hasar animasyondan once dusuyor"
 * sikayetinin koku). Istemcide iki AYRI temas zamanlayicisi var:
 *
 *   OYUNCUNUN OTOMATIK SALDIRISI -> aid GONDERILMEZ.
 *     Djt() (@27108693) `kind==='auto' && aid===undefined && src.kind==='player'`
 *     kosulunu gecince silahin base-attacks hitOffsetsMs dizisini alip
 *     openHitSchedule(HY(src)) ile her vurusu KENDI temas anina yerlestirir
 *     (kilic [200,566]). aid takilirsa bu kapi kapanir, kod
 *     `UY.gate(VY(src,aid))` dalina duser ve o anahtarda kapi olmadigi icin
 *     hasar ANINDA uygulanir (@25082330).
 *
 *   CANAVARIN SALDIRISI -> combat.monsterAction ve combat.event AYNI aid'i
 *     tasir. monsterAction `UY.onCastStart(id, VY(id,aid), contactMs)` ile
 *     kapiyi acar (@27109872), combat.event ayni anahtarla bekler
 *     (@27112800). Iki aid ayrisirsa yine ANINDA hasar olur.
 *
 * combat.death / progress.gainFx da ayni kurali izler: aid yoksa Ojt()
 * HY(killerId) kapisini (melee temas cizelgesi) kullanir.
 */

const GANIMET_OMRU_MS = 60_000;   // game-config: lootDespawnMs
const ALMA_MENZILI = 3;           // game-config: pickupRangeU
const SAHIP_KILIDI_MS = 15_000;   // game-config: lootOwnerLockMs
const ALMA_ARAMA_MENZILI = 50;    // game-config: pickupSearchRangeU
const ALMA_ZAMAN_ASIMI_MS = 15_000;  // yaklasma bu surede bitmezse iptal

/* PP MADDE 3 (changelog 0025 tr:8-11): "bir karakter artik uzerinde
   999.999.999.999 altina kadar tasiyabiliyor. Siniri asacak bir altin alma
   ... acik bir mesajla reddediliyor." Ayni tavani sistem_dukkan (satis),
   sistem_banka-depo ve sistem_lonca (cekimler) uygular; asilacaksa
   err key 'err.gold_cap' + params {cap} gider (tr.json s.145, {cap} paramli). */
const ALTIN_TAVANI = 999_999_999_999;

import fs from 'node:fs';
import path from 'node:path';
import { bacakIlerlet, bacakKur, bacakDurdur } from './bacak.js';
/* madde 25/26: dusen ekipmanin ORNEGI (yeniYigin) + kirilma bildirimi
   (ANAHTAR.KIRILDI = 'sys.combat.item_broke', Tht enum @25605319). */
import * as esya from './esya.js';
/* madde 16/18/52 (capraz istek 32/33): durum degistiricileri (SAF motor,
   I/O yok) - canavar YZ kilitleri + uyku kirilmasi. Durum LISTESI
   sistem_beceri.js'in durumListesi() kancasindan gelir. */
import * as durumlar from './durumlar.js';

/**
 * KOVALAMA BACAGINI YENILEME ESIGI (birim).
 *
 * KAYNAK: istemcinin applyMove'u uzak varlikta
 *   `Math.hypot(vec.x - node.fx, vec.z - node.fz) > 3` olunca konumu ZORLA
 * fx/fz'ye tasiyor (sert SNAP, paket index-BUMMQVRB.js @25663224). Bacagi
 * hedef bu esikten daha az kaydiginda yenilersek her yenileme bir SNAP riski
 * olur; bu yuzden yenileme esigi SNAP esiginin ALTINDA tutuluyor.
 * Oyuncunun yaklasma bacaginda (#hedefeYaklas) ayni amacla 1.5 kullaniliyor.
 */
const KOVALAMA_YENILE_U = 2;

/* ------------------------------------------------------------------
 * EVE YURUYEREK DONUS (GERCEK/gereksinim_leash_yuruyerek_2026-09-04.md).
 *
 * BILINCLI SAPMA: mesafe leash'i VARSAYILAN OLARAK KAPALI. Kullanici
 * gereksinimi birebir: "Moblari istedigim yere kadar lure yapabileyim;
 * bulundugu maptaki sabit bir seye baglama, belli bir radius disina cikinca
 * isinlan/yeniden dog yapma." vSRO/referans oyunda mesafe leash'i VARDIR - bu
 * yuzden sapma burada belgeleniyor ve GM panelindeki "Canavar takip siniri"
 * ayariyla (canavarTakipSiniriU > 0) eski davranis geri alinabiliyor.
 *
 * Dogal sinir BOLGE'dir: #canavarYZ yalniz mobun KENDI bolgesindeki
 * (z.players) oyunculari hedef alir, bolge degistiren oyuncu o kumeden
 * dustugu icin hedef zaten birakilir. Yani mob kendi bolgesinden CIKAMAZ.
 */

/**
 * EVE VARIS TOLERANSI (birim).
 *
 * KAYNAK YOK - bacakIlerlet hedefe TAM oturuyor (bacak.js:240
 * `kalan - adim < 1e-4 -> bacak = null`), yani duz yolda bu paya hic
 * gerek kalmaz. Pay YALNIZCA nav kirpmasi icindir: yurunebilir() ev
 * noktasini engel disina itip yolu kisaltirsa mob evinin bir birim
 * yaninda durur ve sonsuza kadar "vardim mi" diye sormamasi gerekir.
 */
const EV_VARIS_U = 1;

/**
 * DONUSTE TIKANMA PENCERESI (ms).
 *
 * KAYNAK YOK (gezinme.js'in YENIDEN_DENE_MS'i gibi isaretlenmistir).
 * Sabit bir SURE/MESAFE esigi DEGIL - ilerleme olcusune baglidir: yuruyen
 * bir mob her tikte `runSpeedU * tickMs/1000` birim yol alir, dolayisiyla
 * bu pencere boyunca eve dogru YARIM TIKLIK yol bile alamamak "nav hic yol
 * vermedi / mob sikisti" demektir. Esik mobun KENDI hizindan turetildigi
 * icin yavas Mangyang (1.2 U/sn) ile hizli Tiger Girl (6 U/sn) ayni
 * olcutle degerlendirilir.
 */
const DONUS_TIKANMA_MS = 5000;

/* ------------------------------------------------------------------
 * NPC/KAPI ILGI YONETIMI SABITLERI (perf kok neden duzeltmesi).
 *
 * KANIT (GERCEK/bulgular_hizli_2026-09-03.json, wf_73438edb perf alani):
 * server.js zoneNpcEntities() bolgenin TUM npcs[]+teleporters[] listesini
 * zone.init'e MESAFE SUZGECI OLMADAN serpiyor ve NPC'ler world z.entities'te
 * olmadigi icin ilgiGuncelle onlari ASLA cikarmiyor. Istemci gonderilen her
 * varliga looping idle grubu baslatiyor (~72 kanal/NPC) -> 45 NPC x ~72 =
 * ~3240 animatable, bolgenin NERESINDE olursan ol. Canli referans oyun ayni sehir
 * noktasinda 4 varlik gonderiyor (GERCEK/zone_init.json) - yani canli sunucu
 * NPC'leri de mesafeyle yonetiyor. Duzeltme SUNUCUDA olmali (istemci uzak
 * varliklari uyutmuyor; viewDistance yalniz sis/kamera).
 *
 * Yaricaplar UYDURMA DEGIL: world.js:23-24'teki ayni ilgi sabitleri
 * (GORUS_MESAFESI=120 / GORUS_BIRAKMA=150, disa acilmiyor) - canavarlarla
 * ayni mekanizmaya baglanma istegi geregi birebir kopya.
 *
 * ID BANTLARI (uydurma degil): world.js:21 "Oyuncular 1..499999, NPC'ler
 * 500000.., canavarlar 1000000.." - server.js:863 `npcEntitySeq = 500000`,
 * world.js:22 MOB_ID_BASE = 1_000_000. Pet/ganimet/unique varliklarin tamami
 * world.yeniVarlikId() kullanir (>= 1_000_001), yani ws.gorunen icindeki
 * (500000, 1000000) araligi YALNIZ zoneNpcEntities ciktisidir.
 *
 * KAPILAR (teleporter) MUAF: canli kanit - Jangan Gate 138.6u uzaktayken
 * bile zone.init listesinde (bulgular R1 istisna notu). */
const NPC_ID_TABAN = 500_000;      // server.js:863 npcEntitySeq baslangici (id > taban)
const NPC_MOB_ID_TABAN = 1_000_000; // world.js:22 MOB_ID_BASE (bandin ust siniri)
const NPC_GORUS_U = 120;           // world.js:23 GORUS_MESAFESI
const NPC_BIRAKMA_U = 150;         // world.js:24 GORUS_BIRAKMA (histerezis)

export class GameLoop {
  constructor({ world, combat, frame, broadcast, log, tickMs = 200, gezinme = null, yurunebilir = null, oyuncuHizi = 7.5, envanterPayload = null, cantaYuvasi = 32, kaydet = null, respawnHpPct = 0.5, mesguliyet = null, sistemOrnegi = null, ganimetAyar = null }) {
    this.world = world;
    this.combat = combat;
    this.frame = frame;
    this.broadcast = broadcast;
    this.log = log ?? (() => {});
    this.tickMs = tickMs;
    /** Bosta gezinme motoru (gezinme.js). Yoksa canavarlar eskisi gibi durur. */
    this.gezinme = gezinme;
    /** Hedefe yaklasma icin navmesh yol bulucu (server.yurunebilirNokta). */
    this.yurunebilir = yurunebilir;
    /** gameConfig.playerMoveSpeedU - yaklasma hizi. */
    this.oyuncuHizi = oyuncuHizi;
    /* madde 13: hiz artik SABIT DEGIL - server.js `oyuncuHizi(ws)` fonksiyonu
       geciriyor (taban game-config playerMoveSpeedU + binek mounts.json
       speedU + buff moveSpeedPct). bacak.js:119 `!(hiz > 0)` fonksiyonu
       REDDEDER; sayi verilirse (testlerin sahte ctx'i) eski davranis surer. */
    this.hizOku = (ws) => (typeof this.oyuncuHizi === 'function'
      ? this.oyuncuHizi(ws) : this.oyuncuHizi);
    /** ws.char -> {gold,bag,equip} (server.selfPayload ile ayni bicim). */
    this.envanterPayload = envanterPayload;
    /** gameConfig.bagSlots = 32. */
    this.cantaYuvasi = cantaYuvasi;
    /** ws -> kalici kayit (server.envanteriKaydet). */
    this.kaydet = kaydet;
    /* gameConfig.respawnHpPct = .5  (config/game-config.json ve istemcinin
       gomulu varsayilani @9096178; sema @8649307 Y().min(.01).max(1)).
       Burada 0.30 sabiti yaziliydi - dirilis cani veriye aykiriydi. */
    this.respawnHpPct = respawnHpPct;
    /* MESGULIYET KILIDI KANCASI - istege bagli, verilmezse hicbir sey degismez.
       Imza: (ws) => { code, key } | null
       Cekirdek burada okuyamadigi kilitler icin: tezgah acik
       (sistem_tezgah.js `sahipTezgah` Map'i modul-ici), donus/isinlanma
       kanali (sistem_donus-isinlanma.js `AKTIF` Map'i) ve ileride
       eklenecek etkisizlestirme (CC) durumlari.
       Referans istemci bu uc kapiyi da KENDI uyguluyor:
         - tezgah:  paket @25677424 lgt() `s.ownStallOpen` -> her tiklama ignore
         - kanal:   @25681965 / @25683344 / @27037841 `returning !== null`
         - CC:      @25687834 g1() `case attack: if (Q.selfCcLocked()) break;`
       Istemci bu durumlarda mesaji HIC gondermedigi ve hicbir uyari
       basmadigi icin reddi SUNUCU bildirmek zorunda (err.busy.*). */
    this.mesguliyet = typeof mesguliyet === 'function' ? mesguliyet : null;
    /* Baska sistem modulunun ORNEK'ine ada gore erisim (server.js:1394 zaten
       GECIRIYOR, cekirdek bugune kadar OKUMUYORDU). Madde 28 oldurme sayaci
       ve gorev katalogu tazelemesi bunun uzerinden baglaniyor. */
    this.sistemOrnegi = typeof sistemOrnegi === 'function' ? sistemOrnegi : null;
    /* CANLI GCFG REFERANSI. server.js:1530 bu alani ZATEN geciriyor
       (`ganimetAyar: GCFG`) ve kod yorumunda "gameloop.js bu alani okuyana
       kadar zararsizdir" diyor - artik okunuyor. KOPYA DEGIL REFERANS:
       admin.js tazele() farklari CALISAN GCFG nesnesine yaziyor, bu yuzden
       GM panelinden yapilan degisiklik yeniden baslatma olmadan etkili olur
       (ayni desen world.js `gcfg` ve COMBAT.oranlar'da kullaniliyor).
       Test/sahte ctx'lerde null gelir -> tum okuyucular varsayilana duser. */
    this.ayar = (ganimetAyar && typeof ganimetAyar === 'object') ? ganimetAyar : null;
    /* MADDE 28 - GENEL OLDURME KANCASI.
       sistem_gorev.js:876 "gameloop.js #olum icinde HIC bir gorev kancasi yok
       ve genel bir olum kancasi mekanizmasi da yok" diyor. Kayit defteri
       ADA gore tutuluyor: ayni ad iki kez kaydedilirse ikincisi birincinin
       yerini alir ve asagidaki `gorev` koprusu susar (cift sayim olmaz). */
    this.olumKancalari = new Map();
    this.aidSayaci = 1;
    this.tikSayaci = 0;
    /* msk_* -> {slot, mermi} (madde 12d). Dosya yoksa iki alan da
       GONDERILMEZ; uydurma yuva adi uretilmez. */
    this.mobBeceriFx = this.#mobBeceriFxYukle();
    /* MADDE 43 (capraz istek 66): msk_* katalogu - aiChance/coolMs/castMs/
       school/coefficientPct (_RefSkill; data/monster-skills.json,
       gen_monster_skills.mjs). Dosya yoksa harita bos kalir ve beceri secimi
       eski round-robin'e duser. */
    this.mobBeceri = this.#mobBeceriYukle();
    /* NPC ILGI KATALOGU: zoneId -> {hazir, liste:[{id, tp, x, z, payload}]}.
       Tembel kurulur (#npcKatalog) - id'ler zone.init'i almis oyuncularin
       `gorunen` kumesinden okunur (bkz. NPC_ID_TABAN blogu). */
    this.npcIlgi = new Map();
    this.zaman = null;
  }

  /**
   * MADDE 28 - genel oldurme kancasi kaydi.
   *
   * Imza: fn(ws, mob, {kisi, uyeler, zoneId}) -> void
   *   ws     : oldurmeyi yapan oturum
   *   mob    : olen canavar varligi (mob.def.id = katalog mobId'si)
   *   kisi   : odul/gorev payini bolen UYGUN parti uyesi sayisi (>=1)
   *   uyeler : sistem_parti.paylasimHesapla ciktisi ([0] her zaman olduren)
   *
   * `ad` verilirse ayni adla ikinci kayit oncekini EZER. 'gorev' adiyla bir
   * kanca kaydedilirse asagidaki sistemOrnegi('gorev').sayacArtir koprusu
   * DEVRE DISI kalir - boylece sistem_gorev.js ileride kendini kaydettirse
   * bile sayac iki kez artmaz.
   *
   * @returns {() => void} kaydi geri alan fonksiyon
   */
  olumKancasiEkle(fn, ad = null) {
    if (typeof fn !== 'function') return () => {};
    const anahtar = ad ?? Symbol('olumKancasi');
    this.olumKancalari.set(anahtar, fn);
    return () => this.olumKancalari.delete(anahtar);
  }

  /**
   * CANAVAR BECERI FX KATALOGU (madde 12d) - data/monster-skill-fx.json.
   *
   * KAYNAK: istemci paketinin KENDI gomulu tablosu (index-BUMMQVRB.js
   * @13076400 civarindan baslayan 294 kayitlik dizi; dosya
   * GERCEK/paket_veri/monster-skill-fx.json'dan BIREBIR kopyalandi -
   * data/base-attacks.json ile ayni yol).
   *
   * Iki alani buradan cikariyoruz:
   *
   *  1) YUVA ADI. Istemcinin playAttackSlot'u (@26676607) klibi ADINDA arar:
   *       `color.attack.find(n => n.name.toLowerCase().includes(slot)) || <RASTGELE>`
   *     Bizim urettigimiz `attack0${idx+1}` 10 becerili mob_isyutaru'da
   *     "attack010" cikiyordu; hicbir klibe uymadigi icin istemci RASTGELE
   *     bir saldiri klibi oynatiyordu. Gercek yuva becerinin KOD adinda
   *     zaten yaziyor: MSKILL_CH_MANGNYANG_ATTACK01 -> "attack01".
   *     (294 kaydin tamami attack01..attack07 / summon01..04 ile cozuluyor.)
   *
   *  2) MERMI. Menzilli canavarin msk_* kaydi mermi modeli tasiyor:
   *       model: "fx/projectiles/banditarcher_arrow.glb", script: "SCT_ARROW"
   *     Istemcinin onMonsterAction'i (@27023390)
   *       `!node.projectile || node.school !== 'physical' || v_r2 || ...`
   *     kosuluyla genel oku firlatiyor; bayrak gonderilmedigi icin hicbir
   *     mermi ucmuyordu. ESIK UYDURULMADI: veride mermi tasiyan 38 becerinin
   *     sahibi 25 mobun attackRangeU'su 2.1 ile 46 arasinda dagiliyor, yani
   *     "menzil > 3 ise mermi" varsayimi YANLIS olurdu.
   */
  #mobBeceriFxYukle() {
    const harita = new Map();
    const kok = this.world?.dataDir;
    if (!kok) return harita;
    const p = path.join(kok, 'monster-skill-fx.json');
    if (!fs.existsSync(p)) {
      this.log('monster-skill-fx.json yok - canavar yuva adi/mermi bayragi gonderilmeyecek');
      return harita;
    }
    try {
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      for (const r of (j?.fx ?? [])) {
        if (!r?.id) continue;
        /* Kod adinin SON attack/summon parcasi. SUMMON_R1_02 gibi kayitlarda
           son parca sayisal oldugu icin "son parcayi al" yetmiyor; bu yuzden
           duzenli ifadenin SON eslesmesi aliniyor. */
        const es = String(r.code ?? '').toLowerCase().match(/(?:attack|summon)\d*/g);
        const mermi = (r.effects ?? []).some(e =>
          (typeof e?.model === 'string' && e.model.includes('fx/projectiles'))
          || String(e?.script ?? '').startsWith('SCT_ARROW'));
        harita.set(r.id, { slot: es ? es[es.length - 1] : null, mermi });
      }
      this.log(`canavar beceri fx: ${harita.size} kayit`);
    } catch (e) {
      this.log(`monster-skill-fx.json okunamadi: ${e.message.slice(0, 100)}`);
    }
    return harita;
  }

  /** MADDE 43: data/monster-skills.json -> Map(id -> msk kaydi). */
  #mobBeceriYukle() {
    const harita = new Map();
    const kok = this.world?.dataDir;
    if (!kok) return harita;
    const p = path.join(kok, 'monster-skills.json');
    if (!fs.existsSync(p)) {
      this.log('monster-skills.json yok - canavar becerileri yalniz animasyon');
      return harita;
    }
    try {
      for (const s of (JSON.parse(fs.readFileSync(p, 'utf8'))?.skills ?? [])) {
        if (s?.id) harita.set(s.id, s);
      }
      this.log(`canavar beceri katalogu: ${harita.size} kayit`);
    } catch (e) {
      this.log(`monster-skills.json okunamadi: ${e.message.slice(0, 100)}`);
    }
    return harita;
  }

  basla() {
    if (this.zaman) return;
    this.zaman = setInterval(() => { try { this.#tik(); } catch (e) { this.log('tik hatasi:', e.message); } }, this.tickMs);
    this.log(`oyun dongusu basladi (${this.tickMs}ms)`);
  }
  dur() { if (this.zaman) { clearInterval(this.zaman); this.zaman = null; } }

  // ============================================================ istemci mesajlari
  /**
   * Bu mesaji isledik mi? true donerse sunucu baska bir sey yapmaz.
   *
   * `q` = istemcinin istek sira numarasi (zarf {t,d,q}, paket @25653087;
   * sayac @25651442 `Zht = 1, U$ = () => Zht++`). err(240) semasinda
   * `q: Y().optional()` (@25631967) ve istemci onunla iyimser arayuzu geri
   * aliyor ($gt -> cancelByQ @25694958, sxt -> esya beklemesi @25929654).
   * Cekirdek yonlendirici (server.js:1201 `LOOP.mesaj(ws, t, d)`) su an
   * q'yu GECIRMIYOR; imza hazir, gecirildigi anda err kareleri q tasir.
   */
  mesaj(ws, t, d, q) {
    switch (t) {
      case 'target.set':   return this.#hedefSec(ws, d);
      case 'target.clear': ws.hedefId = null; return true;
      case 'combat.attack': return this.#saldiriBasla(ws, d, q);
      case 'combat.stop':  return this.#saldiriDur(ws);
      case 'loot.pickup':  return this.#ganimetAl(ws, d);
      case 'respawn.request': return this.#dirilt(ws);
      default: return false;
    }
  }

  /**
   * err(240) yardimcisi. `key` VARSA istemci onu, yoksa `err.<code>`
   * anahtarini basar (paket @27135789: `if (key && b2(key)) {pushSys(key); return}
   * let v_r = 'err.'+code; b2(v_r) && pushSys(v_r)`). Ikisi de locale'de
   * yoksa oyuncu HICBIR SEY gormez - o yuzden kod/anahtar ciftleri
   * tr.json'dan dogrulanarak secildi.
   */
  #hata(ws, code, key, q, params) {
    const d = { code };
    if (key) d.key = key;
    if (typeof q === 'number') d.q = q;
    /* params: Record<string, string|number> - err semasinda opsiyonel
       (@25631967); yalniz gold_cap gibi {cap} yer tutuculu anahtarlar verir. */
    if (params && typeof params === 'object' && Object.keys(params).length) d.params = params;
    this.frame(ws, 'err', d);
    return true;
  }

  /**
   * Su an savas eylemi (hedefleme/otomatik saldiri) yasak mi?
   * Yasaksa {code, key}, degilse null doner.
   *
   * Sira: dogus korumasi -> binek -> toplama aleti -> modul kilitleri.
   * (Referans istemcinin combat.attack yolunda YALNIZ CC kapisi var -
   *  @25687834 - digerlerini hic gondermiyor; bu yuzden kapilarin
   *  BIRBIRINE gore sirasi paketten okunamiyor, yalniz hangi metnin
   *  gosterilecegini belirliyor.)
   */
  #savasKilidi(ws) {
    const ch = ws.char;

    /* 1) DOGUS KORUMASI - IKI YONLU.
       Sure: gameConfig.spawnSafeTimeMs = 20000 (paket sema @8649600
       `.default(2e4)`, gomulu deger @9097156; GERCEK/paket_veri/config/
       game-config.json ve canli yakalama zone_init.json'da olculen 19911 ms).
       Damga server.js:1128'de KARAKTERE vuruluyor (ch.safeUntil) -
       burasi SADECE OKUR. (Eskiden `ws.safeUntil` okunuyordu; boyle bir
       alan hicbir yerde yazilmadigi icin koruma HIC calismiyordu.)
       Kural iki yonlu: tr.json ui.spawn.protected_chip_desc
       "...canavarlar ve oyuncular sana saldiramaz, SEN DE saldiramazsin".
       Kod: Sht enum'unda (@25603148) dogusa OZEL kod yok -> genel
       ERR_VALIDATION; anahtar Eht enum'unda VAR (@25608042) ve tr.json
       err.spawn.protected = "Dogus korumasi altindayken saldiramazsin." */
    if ((ch?.safeUntil ?? 0) > Date.now()) {
      return { code: 'ERR_VALIDATION', key: 'err.spawn.protected' };
    }

    /* 2) BINEK. tr.json err.mount.no_combat = "Binekteyken savasamazsin -
       once attan in." (Eht @25607632). Istemci combat.attack'i binek
       kapisi OLMADAN gonderiyor (@25688366'da yalniz selfCcLocked var),
       yani tek kapi sunucu. `ws.binek` sistem_binek-pet.js:488'de kuruluyor. */
    if (ws.binek) return { code: 'ERR_PET_COMBAT', key: 'err.mount.no_combat' };

    /* 3) TOPLAMA ALETI. Paket @8693535: lY = {profession_axe:`lumberjack`,
       profession_pickaxe:`miner`}, uY(wt) = wt in lY; istemcinin beceri
       on-kapisi (@25692593) alet kusanikken err.profession.tool_no_combat
       basiyor. tr.json: "Toplama aleti tutarken savasamazsin." */
    if (this.#aletTutuyor(ch)) {
      return { code: 'ERR_VALIDATION', key: 'err.profession.tool_no_combat' };
    }

    /* 4) MODUL KILITLERI (tezgah acik / donus kanali / CC) - kanca varsa. */
    const m = this.mesguliyet?.(ws);
    return m && m.code ? m : null;
  }

  /**
   * Giyili silah bir meslek aleti mi? Cozum COMBAT'ta: profession_axe /
   * profession_pickaxe itemstats.json'da (paketteki Qst) YOK, yalnizca
   * extra-items.json'da - bu yuzden Combat ayri bir kume tutuyor
   * (bkz. combat.meslekAletiMi). Eski surum sadece itemStats'a bakiyordu,
   * yani kapi hicbir zaman tetiklenmiyordu.
   */
  #aletTutuyor(ch) {
    return this.combat.meslekAletiMi?.(ch) === true;
  }

  /**
   * c2s 21 combat.stop {} - angajmani bitirir.
   *
   * BACAK DA BIRAKILIR: yoksa sunucu oyuncuyu hedefe dogru yurumeye devam
   * eder. Istemcinin oto-av makrosu autolari birakirken combat.stop yollayip
   * (paket @25950164) hemen ardindan KENDI hareketini kuruyor; sunucu
   * yurumeye devam ederse ikisi kavga eder. Ayni temizlik bolge.js:136/149
   * ve move.stop dalinda (server.js:1291-1296) zaten yapiliyor - entity.stop
   * karesi oradakiyle birebir ayni.
   */
  #saldiriDur(ws) {
    ws.savas = null;
    if (ws.char?.bacak) {
      bacakDurdur(ws.char);
      const st = { id: ws.entityId, x: ws.char.x, z: ws.char.z, y: ws.char.y ?? 0 };
      this.frame(ws, 'entity.stop', st);
      this.broadcast(ws.zoneId, 'entity.stop', st, ws);
    }
    return true;
  }

  #hedefSec(ws, d) {
    const e = this.world.varlik(ws.zoneId, Number(d?.id));
    ws.hedefId = e && !e.dead ? e.id : null;
    return true;
  }

  /**
   * c2s 20 `combat.attack {id}` - SADECE HEDEF SECER, vurus temposuna dokunmaz.
   *
   * ISTISMAR (duzeltildi): eskiden burada `ws.savas = {hedefId, sonVurus: 0}`
   * yaziliyordu. Yani her tiklama vurus sayacini SIFIRLIYORDU; makrolu fareyle
   * (veya sadece hizli tiklamayla) tik basina - 100 ms - bir vurus cikiyordu.
   *
   * DOGRUSU: vurus sayaci KARAKTERE aittir (ch.sonVurus) ve hedef degisse de
   * yeniden gonderim olsa da SIFIRLANMAZ. Kanit: referans oyunun KENDI istemci
   * makrosu combat.attack'i dxt = 1500 ms araliklarla yeniden gonderiyor
   * (index-BUMMQVRB.js @25949475 ve @25950348:
   *    v_r - anchorOwner.lastAttackIssue >= dxt && W$.send(`combat.attack`, ...) )
   * Kilic reuseMs'i 1200 ms; eger yeniden gonderim sayaci sifirlasaydi makro
   * tempoyu DEGISTIRIRDI. Sunucu temposu silahin base-attacks.reuseMs'inden
   * gelir ve istemcinin ne siklikta mesaj yolladigindan bagimsizdir.
   */
  #saldiriBasla(ws, d, q) {
    /* Olu oyuncuda istemci de sessiz donuyor (paket @25691996 E1():
       `let c = ...self; if (!c || c.dead) return;`) - kare gondermiyoruz. */
    if (ws.char?.dead) return true;

    const hedef = this.world.varlik(ws.zoneId, Number(d?.id));
    /* Hedef yok / oldu / canavar degil -> ERR_NOT_FOUND.
       Kod Sht enum'unda VAR (paket @25603148) ve tr.json'da karsiligi VAR:
       err.ERR_NOT_FOUND = "Hedef bulunamadi - az once degismis olabilir."
       `key` gerekmez; istemci key yoksa `err.<code>`e duser (@27135789).
       Bu dal eskiden SESSIZCE yutuluyordu. */
    if (!hedef || hedef.dead || hedef.kind !== 'monster') {
      ws.savas = null;
      return this.#hata(ws, 'ERR_NOT_FOUND', null, q);
    }

    /* EVE DONEN CANAVAR HEDEF ALINAMAZ (gereksinim_leash_yuruyerek md. 3):
       "Donus sirasinda ... agro almaz, saldirmaz ve HASAR ALMAZ (yolda tekrar
       kovalanip sonsuz dongu olmasin)." Hedef secimi burada reddedilir ki
       ws.savas hic kurulmasin; ikinci kemer #hasarUygula'da.
       Anahtar mevcut olan: tr.json s.141 err.combat.target_returning =
       "Bu canavar savasi birakti ve dogdugu yere donuyor." (yeni metin YOK). */
    if (hedef.donuyor) {
      ws.savas = null;
      return this.#hata(ws, 'ERR_VALIDATION', 'err.combat.target_returning', q);
    }

    /* KAPILAR: dogus korumasi (iki yonlu), binek, toplama aleti ve modul
       mesguliyet kilitleri - hepsi #savasKilidi'nda toplandi. */
    const kilit = this.#savasKilidi(ws);
    if (kilit) {
      ws.savas = null;
      return this.#hata(ws, kilit.code, kilit.key, q);
    }

    ws.hedefId = hedef.id;
    /* Ayni hedefe yeniden tiklama tamamen ETKISIZ - sayac zaten karakterde. */
    if (ws.savas?.hedefId === hedef.id) return true;
    ws.savas = { hedefId: hedef.id };
    return true;
  }

  #dirilt(ws) {
    if (!ws.char?.dead) return true;
    const d = this.combat.turetilmis(ws.char);
    ws.char.dead = false;
    ws.char.hp = Math.max(1, Math.floor(d.maxHp * this.respawnHpPct));
    ws.char.mp = Math.max(1, Math.floor(d.maxMp * this.respawnHpPct));
    const sp = this.world.worldData.zones[ws.zoneId]?.respawnPoint
            ?? this.world.worldData.zones[ws.zoneId]?.playerSpawn;
    if (sp) {
      ws.char.x = sp.x; ws.char.z = sp.z;
      /* MADDE 7 - Y TOHUMU: sp.y SONUC degil TOHUM olarak gecilir.
         world.json artik dogus noktasinin y'sini tasiyor (donwhang -12,
         europe 12.6, hotan 37.5, samarkand 27). Tohumsuz cagrida
         server.js:139 zoneGroundY ARAZI yuksekligini tohum yapiyor ve
         terrain.js BAS_BOSLUGU=0.75 tavani yuzunden araziden 0.75u
         yukaridaki hicbir yuzey secilemiyor (olcum: hotan respawn
         tohumsuz 34.842, tohumlu 36.643). */
      ws.char.y = this.world.groundY(ws.zoneId, sp.x, sp.z, sp.y);
    }
    ws.savas = null;
    ws.hedefId = null;
    /* MADDE 4 - BACAK IPTALI. entity.teleport gonderen HER yol once bacagi
       silmeli (bolge.js:135/148 ve sistem_donus-isinlanma.js:296 dogru
       ornekler). Silinmezse dirilen karakter bir sonraki tikte sehir dogus
       noktasindan OLDUGU YERE dogru kendi kendine yuruyor; bacak kurulusta
       dogrulandigi icin duvarlardan geciyor ve fark 3u'yu asinca istemcinin
       applyMove'u sert SNAP + Y ezmesi yapiyor (@25665291 applyTeleport
       `path = null; snap = true` - istemci de tam bunu yapiyor).
       ws.alma da birakiliyor: olmeden once basladigi ganimet yaklasmasi
       dirilince sehirden tekrar yola cikardi. */
    bacakDurdur(ws.char);
    ws.alma = null;

    const tp = { id: ws.entityId, x: ws.char.x, z: ws.char.z, y: ws.char.y };
    this.frame(ws, 'entity.teleport', tp);
    /* Cevredekiler de bedeni sehre GITMIS gormeli - yoksa olen oyuncu
       digerlerinin ekraninda oldugu yerde yatiyor kalir. */
    this.broadcast(ws.zoneId, 'entity.teleport', tp, ws);

    /* OLUM PERDESINI KAPATAN TEK MESAJ: s2c 202 revive.result.
       Istemci (@27126653):
         W$.on('revive.result', m => { ... m.id === Q.selfId &&
             (setOffer(null), setSelf({dead:false, hp:m.hp, mp:m.mp})) })
       entity.teleport(136) semasinda `dead` alani YOK ve applyTeleport
       `dead`e DOKUNMUYOR; bu mesaj gonderilmedigi icin "Oldun" perdesi
       sehre donuste bile ASLA kapanmiyordu. casterId/skillId sema geregi
       istege bagli - sehre donuste kaster yok, gonderilmiyor. */
    const sonuc = { id: ws.entityId, ok: true, hp: ws.char.hp, mp: ws.char.mp };
    this.frame(ws, 'revive.result', sonuc);
    this.broadcast(ws.zoneId, 'revive.result', sonuc, ws);

    this.frame(ws, 'vitals.update', { hp: ws.char.hp, mp: ws.char.mp });
    this.broadcast(ws.zoneId, 'entity.hp',
      { id: ws.entityId, hp: ws.char.hp, maxHp: d.maxHp }, null);
    return true;
  }

  /**
   * c2s 50 loot.pickup {id}
   *
   * ISTEMCININ GERCEKTE YAPTIGI (paket index-BUMMQVRB.js @25688492):
   *
   *   case `pickup`:
   *     let vec2 = Q.self();
   *     vec2 && Math.hypot(vec.x-vec2.x, vec.z-vec2.z) > p1.gameConfig.pickupRangeU
   *       && Q.predictSelfMove(vec.x, vec.z),
   *     W$.send(`loot.pickup`, { id: id2 });
   *
   * Yani istemci MESAFEYE BAKMADAN mesaji hemen gonderir; uzaksa yalnizca
   * KENDI icinde yurumeyi ongorur (predictSelfMove - `move.click` YOKTUR).
   * Kisayol yolu (loot.pickupNearest -> BMt(), @27166351) ise
   * gameConfig.pickupSearchRangeU = 50 birime kadarki en yakin ganimeti secip
   * ayni tiklama isleyicisine verir.
   *
   * SONUC: sunucu 50 birim uzaktan istek alabilir ve YAKLASMAYI KENDISI
   * yapmak zorundadir. Eskiden burada `> pickupRangeU*2` ise SESSIZCE
   * `return true` vardi: kullanicinin gordugu sey tam olarak buydu -
   * "yerden dusenleri alamiyorum" (istemci hicbir cevap almiyordu).
   */
  #ganimetAl(ws, d) {
    const e = this.world.varlik(ws.zoneId, Number(d?.id));
    if (!e || e.kind !== 'ground_item') return true;
    if (ws.char?.dead) return true;

    // Arama yaricapinin disi: istemci bunu zaten uretmez, guvenlik siniri.
    const dx0 = e.x - ws.char.x, dz0 = e.z - ws.char.z;
    if (dx0 * dx0 + dz0 * dz0 > ALMA_ARAMA_MENZILI ** 2) return true;

    if (this.#almaDenemesi(ws.zoneId, ws, e)) return true;

    /* Menzil disinda: bekleyen alma kaydi + ganimete dogru bacak.
       entity.move GONDERILMEZ - istemci predictSelfMove ile ayni yolu zaten
       yuruyor; kare gondermek onu geri cekerdi (bkz. bacak.js basligi). */
    ws.alma = { id: e.id, baslangic: Date.now() };
    if (this.yurunebilir) {
      bacakKur(ws.char, ws.zoneId, e.x, e.z, this.hizOku(ws), this.yurunebilir);
    }
    return true;
  }

  /** Bekleyen almalari her tikte dener (menzile girince tamamlanir). */
  #almaTik(zoneId, z, simdi) {
    for (const ws of z.players) {
      const a = ws.alma;
      if (!a) continue;
      if (!ws.isAuthed || ws.char?.dead) { ws.alma = null; continue; }
      const e = this.world.varlik(zoneId, a.id);
      // ganimet yok oldu (baskasi aldi / suresi doldu) ya da yurume cok uzadi
      if (!e || e.kind !== 'ground_item' || simdi - a.baslangic > ALMA_ZAMAN_ASIMI_MS) {
        ws.alma = null; continue;
      }
      if (this.#almaDenemesi(zoneId, ws, e)) ws.alma = null;
    }
  }

  /**
   * Menzildeyse ganimeti alir ve true doner. Menzil disindaysa false.
   *
   * CANLI REFERANS OYUN MESAJ SIRASI (semalar data/schemas.json):
   *   state.delta {rem:[esyaId]}
   *   inv.update  {gold, bag, equip}          <- opcode 149, TUM envanter
   *   sys.notice  {key, params}               <- sys.loot.gold / sys.loot.picked_up
   *   entity.pickup {id: ALAN VARLIGIN id'si} <- opcode 155
   *
   * `entity.pickup.id` ESYANIN DEGIL ALANIN id'sidir: istemcinin onPickup'i
   * (paket @27027697) `Q.entities.get(id)` yapip `kind==='player'||'pet'`
   * ise `playAnim('pickup')` + alma sesi calar. Esya id'si gonderilirse o
   * varlik zaten silinmis oldugu icin HICBIR SEY olmaz.
   */
  #almaDenemesi(zoneId, ws, e) {
    const dx = e.x - ws.char.x, dz = e.z - ws.char.z;
    if (dx * dx + dz * dz > ALMA_MENZILI ** 2) return false;

    // sahiplik kilidi - gameConfig.lootOwnerLockMs = 15000
    if (e.sahip && e.sahip !== ws.entityId && Date.now() < (e.sahipBitis ?? 0)) {
      /* 'loot_locked' err.code enum'unda (Sht, paket @25603148) YOKTU.
         Enum'daki karsilik ERR_OWNER_LOCK (ayni listede). Anahtar
         UYDURULMUYOR: Eht (err.key) listesinde ganimet kilidine ait bir
         anahtar yok ve tr.json'da da err.ERR_OWNER_LOCK bulunmuyor - yani
         satir yine gorunmez, ama kare artik protokole UYGUN (istemci
         @27135789 console.warn basar ve q'lu iyimser tahminleri geri alir).
         Referansin kendi eksigi; anahtar uydurmak sadakati bozardi. */
      this.frame(ws, 'err', { code: 'ERR_OWNER_LOCK' });
      return true;   // beklemenin anlami yok
    }

    let bildirim = null;
    let alici = ws;                 // esyanin/altinin girdigi karakterin soketi
    let dagitimBildir = null;       // PP MADDE 6: menzildeki uyelere giden bildirim
    if (e.gold) {
      /* PP MADDE 3 (changelog 0025): tavani ASACAK altin ganimeti ACIK
         mesajla reddedilir - altin YERDE KALIR, oyuncu sebebini gorur.
         Kod: Sht enum'unda tavana ozel kod yok -> genel ERR_VALIDATION
         (dogus korumasi kalibiyla ayni); anahtar tr.json s.145
         err.gold_cap = "Uzerinde {cap} altindan fazlasini tasiyamazsin." */
      /* DB bigint alanlari (tedious) METIN dondurebilir: ham `+` metin
         birlestirir ("1000000017"+500 -> 1 trilyon sanilir, tavan yanlis
         tetiklenir ve altin yerde kalir). Toplamadan once sayiya cevrilir. */
      const eldekiAltin = Number(ws.char.gold ?? 0);
      if (eldekiAltin + e.gold > ALTIN_TAVANI) {
        return this.#hata(ws, 'ERR_VALIDATION', 'err.gold_cap', undefined,
                          { cap: ALTIN_TAVANI });
      }
      ws.char.gold = eldekiAltin + e.gold;
      bildirim = { key: 'sys.loot.gold', params: { gold: e.gold } };
    } else if (e.itemId) {
      /* PP MADDE 6 (changelog 0021 tr:8): parti Esya Paylasimi ACIKKEN
         yerden alinan esya SIRADAKI uyeye gider ve menzildeki herkese kimin
         ne aldigi bildirilir. Paylasim yoksa (parti yok / itemShare kapali /
         menzilde baska uygun uye yok) alan kendine alir - bugunku davranis. */
      const dagitim = this.sistemOrnegi?.('parti')?.ganimetAlicisi?.(ws) ?? null;
      if (dagitim?.ws?.char) alici = dagitim.ws;
      /* MADDE 26 (capraz istek 39b): dususte uretilen HAZIR yigin gecirilir -
         yerdeki ornek ile cantaya giren ayni kayit olur. */
      const konan = this.#cantayaEkle(alici.char, e.itemId, e.qty ?? 1, e.yigin ?? null);
      if (!konan) {
        /* Canta dolu: ganimet YERDE KALIR.
           ONCEKI YORUM YANLISTI: `inventory_full` Sht enum'unda (@25603148)
           YOK - istemci kodu tanimadigi icin hicbir sey basmiyordu
           ("aliyorum ama hicbir sey olmuyor"). Dogru kod ERR_BAG_FULL ve
           tr.json'da karsiligi VAR: err.ERR_BAG_FULL = "Cantan dolu."
           PP MADDE 6: sira BASKA uyedeyse ve ONUN cantasi doluysa anahtar
           err.loot.share_full ("Sira bir parti uyesinde ve cantasi dolu.",
           tr.json s.155); sira ILERLEMEZ (dagitim.ilerlet cagrilmaz). */
        if (alici !== ws) {
          return this.#hata(ws, 'ERR_BAG_FULL', 'err.loot.share_full');
        }
        this.frame(ws, 'err', { code: 'ERR_BAG_FULL' });
        return true;
      }
      const def = this.combat.itemStats?.get(e.itemId);
      if (dagitim) {
        dagitim.ilerlet();          // esya girdi -> sira bir sonraki uyeye
        /* "menzildeki herkese kimin ne aldigi bildiriliyor" - tr.json s.1749
           sys.loot.item_distributed = "Parti payi: {item} -> {player}".
           Alici da bu satiri gordugu icin ayrica sys.loot.picked_up gitmez. */
        dagitimBildir = {
          hedefler: dagitim.uygunlar,
          kare: { key: 'sys.loot.item_distributed',
                  params: { item: def?.name ?? e.itemId,
                            player: String(alici.char.name ?? '') } },
        };
      } else {
        bildirim = { key: 'sys.loot.picked_up', params: { item: def?.name ?? e.itemId } };
      }
    }

    bacakDurdur(ws.char);
    this.broadcast(zoneId, 'state.delta', { rem: [e.id] }, null);
    this.world.varlikSil(zoneId, e.id);
    /* Envanter karesi ve kalici kayit ESYAYI ALAN karaktere gider (paylasim
       yolunda alan ile alici farkli olabilir; alanin cantasi degismedi). */
    if (this.envanterPayload) this.frame(alici, 'inv.update', this.envanterPayload(alici.char));
    if (bildirim) this.frame(ws, 'sys.notice', bildirim);
    if (dagitimBildir) {
      for (const uye of dagitimBildir.hedefler) this.frame(uye, 'sys.notice', dagitimBildir.kare);
    }
    // alma animasyonunu HERKES gorur (kendisi dahil)
    this.frame(ws, 'entity.pickup', { id: ws.entityId });
    this.broadcast(zoneId, 'entity.pickup', { id: ws.entityId }, ws);
    this.kaydet?.(alici);
    return true;
  }

  /**
   * Esyayi cantaya koyar. TAMAMI sigmazsa canta HIC degismez ve false doner.
   *
   * ATOMIKLIK (duzeltildi): eski surum once mevcut yiginlari doldurup sonra
   * bos yuva ariyordu; ortada yer bitince `false` donuyordu ama canta ZATEN
   * degismis oluyordu. #almaDenemesi bu durumda ganimeti yerde biraktigi
   * icin adet>1 dususlerde esya COGALIYORDU. Bugun data/drops.json'daki tum
   * qty degeri 1 oldugu icin tetiklenmiyordu - gizli hata.
   *
   * Yigin siniri UYDURULMADI: data/items.json `stackMax` alanindan gelir
   * (istemci paketindeki ayni katalog; sema @8689566 stackMax 1..1000).
   * Yuva sayisi gameConfig.bagSlots = 32.
   */
  #cantayaEkle(ch, itemId, adet, hazirYigin = null) {
    const yuvaSayisi = ch.bag?.length || this.cantaYuvasi;
    if (!Array.isArray(ch.bag) || ch.bag.length !== yuvaSayisi) {
      const eski = Array.isArray(ch.bag) ? ch.bag : [];
      ch.bag = new Array(yuvaSayisi).fill(null);
      for (let i = 0; i < Math.min(eski.length, yuvaSayisi); i++) ch.bag[i] = eski[i];
    }
    const def = this.combat.itemStats?.get(itemId);
    const yiginMax = Math.max(1, Number(def?.stackMax ?? 1));
    let kalan = Math.max(1, Number(adet) || 1);

    /* 1) PLAN - gercek cantaya DOKUNMADAN nereye ne konacagini hesapla. */
    const plan = [];                                   // [{i, yeniQty}] | [{i, yigin}]
    const doluluk = ch.bag.map(s => (s ? (s.qty ?? 1) : null));   // null = bos yuva
    if (yiginMax > 1) {
      for (let i = 0; i < ch.bag.length && kalan > 0; i++) {
        const s = ch.bag[i];
        if (!s || s.itemId !== itemId || doluluk[i] === null) continue;
        const yer = yiginMax - doluluk[i];
        if (yer <= 0) continue;
        const k = Math.min(yer, kalan);
        doluluk[i] += k; kalan -= k;
        plan.push({ i, yeniQty: doluluk[i] });
      }
    }
    for (let i = 0; i < ch.bag.length && kalan > 0; i++) {
      if (doluluk[i] !== null) continue;               // dolu yuva
      const k = Math.min(yiginMax, kalan);
      doluluk[i] = k; kalan -= k;
      /* MADDE 26 (capraz istek 39c): hazir yigin (dusen esyanin ornegi) varsa
         AYNEN o kayit cantaya girer; yoksa (GM komutu, gorev odulu vb.)
         yeniYigin dogru S$ kaydini uretir. */
      plan.push({ i, yigin: hazirYigin
        ? { ...hazirYigin, qty: k }
        : esya.yeniYigin(def ?? itemId, k) });         // S$ semasi: {itemId, qty, ...}
    }
    if (kalan > 0) return false;                       // SIGMADI - canta hic degismedi

    // 2) UYGULA
    for (const p of plan) {
      if (p.yigin) ch.bag[p.i] = p.yigin;
      else ch.bag[p.i] = { ...ch.bag[p.i], qty: p.yeniQty };
    }
    return true;
  }

  // ==================================================================== tik
  #tik() {
    const simdi = Date.now();
    this.tikSayaci++;
    for (const [zoneId, z] of this.world.zoneState) {
      if (!z.players.size) {
        /* [sartname madde 15] Ganimet omru oyuncudan BAGIMSIZ islemeli
           (gameConfig lootDespawnMs = 60000, paket @9096809). Bos bolgede
           z.entities yalnizca alinmamis ganimet tutar - world.js oyuncuCik
           son oyuncu cikinca TUM yuvalari kapatir ve NPC'ler z.entities'te
           degil - tarama ucuz. Bekleyen alma istegi OLAMAZ (players bos),
           #almaTik ile SIRA CATISMASI yok. Temizlik ASLA #almaTik'ten
           ONCEYE alinmamali ve `z.acik.size` daraltmasi KULLANILMAMALI
           (oyuncuCik z.acik'i bosaltir, kosul duzeltmeyi geri alirdi). */
        if (z.entities.size) this.#ganimetTemizle(zoneId, z, simdi);
        continue;
      }
      this.#oyuncuHareketi(zoneId, z);      // saldiridan ONCE: menzil taze konumu gormeli
      this.#oyuncuSaldirilari(zoneId, z, simdi);
      this.#canavarYZ(zoneId, z, simdi);
      this.#yenilenme(zoneId, z, simdi);
      this.#almaTik(zoneId, z, simdi);      // bekleyen loot.pickup istekleri
      this.#ganimetTemizle(zoneId, z, simdi);
      this.#cesetTemizle(zoneId);           // madde 47
      this.#respawn(zoneId);
      /* MADDE 47 - IKINCI YARI: ilgiGuncelle bugune kadar YALNIZ yuruyen
         oyuncu icin cagriliyordu (#oyuncuHareketi'ndeki `if (!ws.char.bacak)
         continue` kapisindan sonra). Bu yuzden yerinde duran oyuncunun
         ekranina yuruyerek giren canavar HIC eklenmiyor, cikan da HIC
         silinmiyordu. 3 tikte bir duran oyuncular icin de calistir.
         "2-3 tikte bir" plan_tam.json madde 47'nin kendi tarifi; oyun
         sabiti degil, ritim tercihi. */
      if (this.tikSayaci % 3 === 0) {
        for (const ws of z.players) {
          if (!ws.isAuthed || !ws.char || ws.char.bacak) continue;   // yuruyen zaten aldi
          const delta = this.world.ilgiGuncelle?.(ws);   // `?.`: sahte dunyada tik cokmesin
          if (delta) this.frame(ws, 'state.delta', delta);
        }
        /* NPC/kapi varliklari da ayni ritimle ilgi yonetimine girer (perf kok
           neden duzeltmesi - bkz. NPC_ID_TABAN sabit blogu). NPC'ler statik
           oldugu icin yuruyen/duran ayrimi gerekmez; 3 tiklik (600 ms) pencere
           30u'luk histerezis bandinin cok icinde (oyuncu hizi 7.5u/s). */
        this.#npcIlgiTik(zoneId, z);
      }
    }
  }

  /**
   * MADDE 47 - suresi dolan cesetleri ilgi alanindan cikarir.
   *
   * Cesedi silen TEK yol world.ilgiGuncelle'nin `dead` daliydi ve o da yalniz
   * oyuncu yururken calisiyordu: yuruyen oyuncunun ekraninda ceset ANINDA yok
   * olup olum animasyonu kesiliyor, duran oyuncunun ekraninda respawn'a kadar
   * kaliyordu. world.cesetTik gameConfig.corpseDespawnMs'i (6000, paket
   * @8649659) uygular ve oyuncu basina rem listesi + `gorunen` temizligi doner.
   */
  #cesetTemizle(zoneId) {
    /* `?.` bilerek: world.cesetTik yoksa (eski world.js / testlerin sahte
       dunyasi) tik COKMEMELI - #tik'in try/catch'i o turdaki geri kalan tum
       islemleri de atlatirdi. */
    const liste = this.world.cesetTik?.(zoneId);
    if (!liste?.length) return;
    for (const { ws, rem } of liste) this.frame(ws, 'state.delta', { rem });
  }

  // ------------------------------------------------------ NPC/kapi ilgi yonetimi
  /**
   * Bolgenin NPC/kapi varlik KATALOGU (id -> konum/yuk eslesmesi), tembel.
   *
   * server.js zoneNpcEntities() id'leri `++npcEntitySeq` ile TEK senkron
   * cagrida uretir ve npcCache'te SABIT tutar; dizilis sirasi worldData'daki
   * `npcs[]` (katalogda tanimi olanlar) + `teleporters[]` sirasidir. Ayni
   * sirayla artan id'ler, zone.init'i almis oyuncularin `gorunen` kumesindeki
   * (NPC_ID_TABAN, NPC_MOB_ID_TABAN) bandinda birebir durur - kucukten buyuge
   * siralanip liste sirasina oturtulur. Sayim TUTMAZSA bolge filtresiz
   * birakilir (bugunku davranis = guvenli taraf) ve BIR KEZ loglanir.
   *
   * Yeniden ekleme yuku zoneNpcEntities ile AYNI alanlari tasir (y kaydi
   * yoksa zoneGroundY = world.groundY tohumsuz; sonuc 0 ise alan gonderilmez).
   */
  #npcKatalog(zoneId, z) {
    let k = this.npcIlgi.get(zoneId);
    if (k) return k.hazir ? k : null;

    const zdef = this.world.worldData?.zones?.[zoneId];
    const katalog = this.world.worldData?.npcCatalog ?? {};
    const beklenen = [];
    for (const n of zdef?.npcs ?? []) {
      const def = katalog[n.npcId];
      if (def) beklenen.push({ tp: false, n, def });
    }
    for (const t of zdef?.teleporters ?? []) beklenen.push({ tp: true, t });
    if (!beklenen.length) {
      k = { hazir: true, liste: [] };
      this.npcIlgi.set(zoneId, k);
      return k;
    }

    /* Id'ler oyunculardan: zone.init tum listeyi gorunen'e koydu
       (server.js WORLDSIM.gorunenleriKur). Birlesim aliniyor - bu bandi
       yalniz bu dosya inceltir, kurulumdan once kimse silmis olamaz. */
    const idler = new Set();
    for (const p of z.players) {
      if (!(p.gorunen instanceof Set)) continue;
      for (const id of p.gorunen) {
        if (id > NPC_ID_TABAN && id < NPC_MOB_ID_TABAN) idler.add(id);
      }
    }
    if (!idler.size) return null;               // zone.init'li oyuncu henuz yok - sonraki tik
    if (idler.size !== beklenen.length) {
      this.npcIlgi.set(zoneId, { hazir: false });
      this.log(`npc ilgi: ${zoneId} id sayimi tutmadi (${idler.size}/${beklenen.length}) - filtre kapali`);
      return null;
    }

    const sirali = [...idler].sort((a, b) => a - b);
    const liste = sirali.map((id, i) => {
      const b = beklenen[i];
      if (b.tp) {
        // kapilar MUAF (canli kanit: Jangan Gate 138.6u'da listede) - yuk gerekmez
        return { id, tp: true, x: b.t.x, z: b.t.z };
      }
      const { n, def } = b;
      const y = n.y ?? this.world.groundY?.(zoneId, n.x, n.z) ?? 0;
      return {
        id, tp: false, x: n.x, z: n.z,
        payload: {
          id, kind: 'npc', modelKey: def.modelKey, name: def.name,
          x: n.x, z: n.z,
          ...(y === 0 ? {} : { y }),        // zoneNpcEntities yAlani kurali
          rotY: n.rotY ?? 0,
          npcId: n.npcId,
        },
      };
    });
    k = { hazir: true, liste };
    this.npcIlgi.set(zoneId, k);
    this.log(`npc ilgi: ${zoneId} ${liste.length} varlik ilgi yonetimine bagladi`);
    return k;
  }

  /**
   * NPC/kapi varliklarini oyuncu basina 120u ilgi yaricapina baglar
   * (canavarlarla ayni add<=120 / rem>150 histerezisi). zone.init hepsini
   * gondermisti; ilk gecis uzaktakileri `rem` ile cikarir, yaklasan oyuncuya
   * `add` ile geri gonderir (istemci hazir: add->addEntity / rem->removeEntity,
   * paket @19721362). world.ilgiGuncelle bu bandi HIC dolasmadigi icin
   * (yalniz z.entities) iki mekanizma cakismaz.
   */
  #npcIlgiTik(zoneId, z) {
    const k = this.#npcKatalog(zoneId, z);
    if (!k?.liste?.length) return;
    for (const ws of z.players) {
      if (!ws.isAuthed || !ws.char || !(ws.gorunen instanceof Set)) continue;
      let add = null, rem = null;
      for (const n of k.liste) {
        if (n.tp) continue;                              // kapilar muaf
        const dx = n.x - ws.char.x, dz = n.z - ws.char.z;
        const d2 = dx * dx + dz * dz;
        const goruyor = ws.gorunen.has(n.id);
        if (!goruyor && d2 <= NPC_GORUS_U ** 2) {
          ws.gorunen.add(n.id);
          (add ??= []).push(n.payload);
        } else if (goruyor && d2 > NPC_BIRAKMA_U ** 2) {
          ws.gorunen.delete(n.id);
          (rem ??= []).push(n.id);
        }
      }
      if (add || rem) {
        const d = {};
        if (add) d.add = add;
        if (rem) d.rem = rem;
        this.frame(ws, 'state.delta', d);
      }
    }
  }

  /**
   * Oyuncularin "bacak"larini tik basina ilerletir.
   *
   * Sunucu artik move.click'te hedefe ISINLANMIYOR (bkz. bacak.js). Konum
   * burada, istemcinin yurudugu hizla PARALEL ilerler. Boylece bir sonraki
   * entity.move'un fx/fz'si istemcinin gercek konumunu tarif eder ve
   * istemcinin `>3` SNAP dali - dolayisiyla Y ezilmesi - hic tetiklenmez.
   *
   * Tikte entity.move TEKRAR gonderilmez: istemci kendi yolunu zaten yuruyor,
   * varista path'i kendisi null'lar (igt / advanceSelf).
   */
  #oyuncuHareketi(zoneId, z) {
    for (const ws of z.players) {
      if (!ws.isAuthed || !ws.char) continue;
      /* OTURUM DAMGASI - _RefDropOptLvlSel'in ReqOnlineTime kapisi icin
         (+1 icin 20 dk, +2 icin 40 dk ...). Tik giristen hemen sonra
         donmeye basladigi icin damga pratikte giris anidir (bir tik kadar sapma).
         [ISARETLI BOSLUK] vSRO'nun sayaci karakterin TOPLAM oynama suresidir;
         klonda oyle bir sutun yok, o yuzden OTURUM suresi kullaniliyor -
         bilincli, belgelenmis yaklasim. combat.plusUret() damga yoksa kapiyi
         hic uygulamaz. */
      if (!ws._oturumT0) ws._oturumT0 = Date.now();
      /* MADDE 4 - EK GUVENLIK: olu karakterin bacagi ATLANMAZ, SILINIR.
         Eskiden `ws.char.dead` dalinda sadece `continue` vardi; bacak
         duruyordu ve oyuncu dirilir dirilmez (dead=false) o eski hedefe
         dogru yurumeye devam ediyordu. */
      if (ws.char.dead) { if (ws.char.bacak) bacakDurdur(ws.char); continue; }
      if (!ws.char.bacak) continue;
      /* MADDE 39 - HAREKET KILIDI (emici duvar / cc / serilme).
         tr.json ui.buffs.wall_title: "... Duvar ayaktayken hareket edemezsin
         ...". server.js move.click ayni kapiyi YENI hedef icin kuruyor;
         burasi YURUMEKTE OLAN bacagi keser (duvar/cc yururken de basabilir).
         Ozel bir err anahtari YOK -> sessiz durdurma (istemci de duvar
         acikken hareket girisimini gostermiyor, paket @25687834). */
      if (this.sistemOrnegi?.('beceri')?.hareketKilidi?.(ws)) {
        bacakDurdur(ws.char);
        continue;
      }
      if (bacakIlerlet(ws.char, zoneId, this.tickMs, this.world.groundY)) {
        /* KAYMA'nin yan etkisi: oyuncunun yolu artik DUZ CIZGI DEGIL (sunucu
           istemcinin moveCircle'ini birebir kopyaliyor, duvar boyunca kayiyor).
           IZLEYICILER ise uzak varligi igt() ile fx->tx arasinda DUZ
           interpolasyon ediyor (@25674600); sapma 3 birimi asinca onlarin
           gordugu konum yanlis olur (bacak.js SAPMA_ESIGI_U = 3, istemcinin
           applyMove SNAP esigi @25663224).
           Tazeleme SADECE IZLEYICILERE gider - oyuncunun KENDISINE
           gonderilirse applyMove kendi yolunu sifirlar. */
        const b = ws.char.bacak;
        if (b?.sapti) {
          b.sapti = false; b.fx = ws.char.x; b.fz = ws.char.z;   // yeni referans
          this.broadcast(zoneId, 'entity.move', {
            id: ws.entityId,
            fx: +ws.char.x.toFixed(2), fz: +ws.char.z.toFixed(2),
            fy: +(ws.char.y ?? 0).toFixed(2),
            tx: +b.tx.toFixed(2), tz: +b.tz.toFixed(2), speed: b.hiz,
          }, ws);   // <- 4. arg ws: kendisine GONDERME
        }
        const delta = this.world.ilgiGuncelle(ws);
        if (delta) this.frame(ws, 'state.delta', delta);
      }
    }
  }

  /**
   * Oyuncuyu hedefin menziline yurutur (bir "bacak" kurar).
   * Hedef hareket ederse bacak yenilenir; menzile girince #oyuncuSaldirilari
   * bacagi birakir.
   */
  #hedefeYaklas(zoneId, ws, hedef, menzil) {
    if (!this.yurunebilir) return;
    const dx = hedef.x - ws.char.x, dz = hedef.z - ws.char.z;
    const d = Math.hypot(dx, dz) || 1;
    // menzilin biraz icine gir ki hedef kipirdayinca hemen menzil disi kalmasin
    const varis = Math.max(0, d - menzil * 0.9);
    if (varis < 0.05) return;
    const hx = ws.char.x + (dx / d) * varis;
    const hz = ws.char.z + (dz / d) * varis;

    // zaten oraya dogru yuruyorsak yeniden planlamaya gerek yok
    const b = ws.char.bacak;
    if (b && Math.hypot(b.tx - hx, b.tz - hz) < 1.5) return;

    const mv = bacakKur(ws.char, zoneId, hx, hz,
                        this.hizOku(ws), this.yurunebilir);
    if (mv) {
      const kare = { id: ws.entityId, ...mv };
      this.frame(ws, 'entity.move', kare);
      this.broadcast(zoneId, 'entity.move', kare, ws);
    }
  }

  // ---------------------------------------------------------- oyuncu saldirisi
  #oyuncuSaldirilari(zoneId, z, simdi) {
    for (const ws of z.players) {
      const s = ws.savas;
      if (!s || !ws.isAuthed || ws.char?.dead) continue;

      /* KAPILAR TIK ICINDE DE GECERLI: oyuncu angajman surerken ata binerse,
         toplama aleti kusanirsa, tezgah acarsa ya da etkisiz hale duserse
         otomatik vurus DURMALI. Burada err GONDERILMEZ - tik 200 ms'de bir
         donuyor, her turda kare yollamak istemciyi mesajla bogar; angajman
         sessizce birakilir (istemci de bu durumlarda hicbir sey basmiyor,
         paket @25687834). Sebebi oyuncu bir sonraki tiklamasinda gorur. */
      if (this.#savasKilidi(ws)) { ws.savas = null; continue; }

      /* DELIK 2 (bulgu ALAN 1): beceri cast'i / aksiyon penceresi (MADDE 37)
         surerken otomatik salinim ATLANIR - tek beceri basisinda bile beceri
         vurusu + oto salinimlar ic ice akiyordu (olcum B1: 1433 ms'lik pencere
         icinde 2 oto karesi; videodaki "5 sayi birden"in ana kaynagi).
         ws.savas SIFIRLANMAZ: autoContinue "beceriden SONRA oto devam eder"
         (Action_AutoAttackType=1 paritesi) korunur ve sonVurus ilerlemedigi
         icin pencere bitince tempo kaldigi yerden dogru surer. Modul yoksa
         ?. ile bugunku davranisa duser (test_vurus_temposu sistemOrnegi
         vermeden kurar - kanca undefined, davranis ayni). */
      const BEC = this.sistemOrnegi?.('beceri');
      if (BEC?.beceriMesgul?.(ws, simdi)) continue;

      /* Vurus periyodu SILAHIN taban saldirisindan (base-attacks.reuseMs):
         kilic 1200, mizrak 1166, yay 840, asa 1666, yumruk 1500 ms.
         combat.json'daki baseIntervalMs kendi yorumunda "legacy fallback only".

         SAYAC KARAKTERDE (ws.char.sonVurus) - savas oturumunda DEGIL.
         Boylece hedef degistirmek, yeniden tiklamak veya makroyla saniyede
         10 kez `combat.attack` yollamak tempoyu HIZLANDIRAMAZ. Bkz.
         #saldiriBasla basligindaki paket kaniti (dxt = 1500 ms). */
      /* MADDE 52 (capraz istek 30): durum yavaslamasi tempoya carpilir.
         KAYNAK: paket g$() @25590140 = 1/max(.1, PROD(1+atkSlowPct));
         h$ @25588614: fb atkSlowPct -0.5, sl -0.25. Carpani sistem_beceri.js
         uretir (durum motorundan); modul yoksa ?. ile 1'e duser. */
      const tempo = this.combat.vurusPeriyodu(ws.char)
        * (BEC?.vurusTempoCarpani?.(ws, simdi) ?? 1);
      if (simdi - (ws.char.sonVurus ?? 0) < tempo) continue;

      const hedef = this.world.varlik(zoneId, s.hedefId);
      if (!hedef || hedef.dead) {
        ws.savas = null;
        /* Hedef tik arasinda YOK OLDUYSA haber ver (ERR_NOT_FOUND, tr.json
           "Hedef bulunamadi - az once degismis olabilir."). Hedef sadece
           OLDUYSE susulur: olum zaten combat.death (141) ile bildiriliyor,
           ikinci bir hata satiri gurultu olur. */
        if (!hedef) this.#hata(ws, 'ERR_NOT_FOUND', null);
        continue;
      }

      const dx = hedef.x - ws.char.x, dz = hedef.z - ws.char.z;
      /* Menzil OYUNCUNUN silahindan gelir. Paketteki Zgt():
           rangeU > 0 ise (beceri) onu; degilse giyili silahin attackDistanceU'su;
           silah yoksa combatConfig.autoAttack.rangeU (2.5 = ciplak el).
         Kontrol MERKEZ-MERKEZ - entityRadiusU EKLENMEZ (paket satir 626814). */
      const menzil = this.combat.oyuncuMenzili(ws.char);
      const d2 = dx * dx + dz * dz;

      if (d2 > menzil * menzil) {
        /* MENZIL DISINDA -> HEDEFE YURU.
           Istemcinin `attack` tiklamasi SADECE combat.attack gonderiyor;
           predictSelfMove/move.click YOK (paket satir 626660). Yani yaklastirmayi
           SUNUCU yapmak zorunda. Eskiden burada `continue` vardi: karakter oldugu
           yerde kalip sisirilmis menzille uzaktan vuruyordu. */
        this.#hedefeYaklas(zoneId, ws, hedef, menzil);
        continue;
      }
      // menzile girdi - yaklasma bacagini birak
      if (ws.char.bacak) { bacakDurdur(ws.char); }

      ws.char.sonVurus = simdi;
      /* VURUS HAZIRLIGI - s2c 216 auto.windup {id, targetId, castMs}.
         Istemci vurus animasyonunun temposunu buradan suruyor
         (paket: applyAutoSwing({id, targetId, releaseMs: castMs})).
         Hic gonderilmiyordu; hasar aniden beliriyordu. */
      /* castMs artik VERIDEN geliyor: base-attacks kaydinin `castMs` alani,
         yoksa `hitOffsetsMs[0]` (bkz. combat.vurusHazirligi). Eskiden
         `vurusPeriyodu * 0.35` yaziyordu - 0.35 carpani HICBIR kaynakta
         yoktu. Istemci bu degeri kendi silah tablosundaki releaseMs'in
         UZERINE yaziyor (paket @27109580 applyAutoSwing({releaseMs: castMs}),
         ucus efekti @27027343 `node.releaseMs ?? flightFx.releaseMs`), yani
         uydurma carpan mermi/temas anini kaydiriyordu. */
      const wu = { id: ws.entityId, targetId: hedef.id,
                   castMs: this.combat.vurusHazirligi(ws.char) };
      this.frame(ws, 'auto.windup', wu);
      this.broadcast(zoneId, 'auto.windup', wu, ws);

      /* MADDE 34 - COKLU VURUSTA HER VURUS KENDI ZARINI ATAR.
         Eskiden combat.vurus() TEK kez cagrilip ayni hasar n kez
         gonderiliyordu ve `crit: i === 0 ? ... : false` yaziyordu; ikinci
         vurus TANIM GEREGI asla kritik olamiyordu, blok tutarsa iki vurus da
         0 oluyordu. data/combat.json autoAttack yorumu: "the native result
         builder loops every packet of a swing synchronously" - yani her
         paket (vurus) KENDI sonucunu uretir. Vurus sayisi silahin taban
         saldirisindan gelir ve zardan bagimsizdir (base-attacks.json hits:
         kilic/blade 2, eu_axe 2, eu_dagger 2), o yuzden ilk rulodan okunup
         geri kalan rulolar ona gore atiliyor. */
      /* MADDE 19 (capraz istek 29): otomatik saldiri BUFF MODLARINI gormeli.
         combat.turetilmis() modlari bilmiyor; sistem_beceri.js modlu surumu
         turetilmisMod(ch) olarak disa aciyor. Modul yoksa ?. ile bugunku
         davranisa duser (kirilma yok). */
      const derMod = BEC?.turetilmisMod?.(ws.char) ?? this.combat.turetilmis(ws.char);
      const saldiran = { ...ws.char, derived: derMod };
      const ilk = this.combat.vurus(saldiran, hedef);
      const n = Math.max(1, ilk.vurusSayisi ?? 1);
      const vuruslar = [ilk];
      for (let i = 1; i < n; i++) vuruslar.push(this.combat.vurus(saldiran, hedef));
      this.#hasarUygula(zoneId, ws, hedef, vuruslar);
    }
  }

  /**
   * Oyuncunun otomatik saldirisinin sonuclarini uygular.
   * @param {object[]} vuruslar  combat.vurus() ciktilarindan olusan dizi
   *                             (madde 34: her vurus KENDI zarini atmistir)
   */
  #hasarUygula(zoneId, ws, hedef, vuruslar) {
    /* EVE DONEN CANAVAR HASAR ALMAZ (gereksinim_leash_yuruyerek md. 3).
       #saldiriBasla kapisi ws.savas'in kurulmasini zaten engelliyor; bu
       KEMER, savas donus BASLAMADAN once kurulmussa (ayni tikte) devreye
       girer. `return` agro satirindan ONCE oldugu icin mob hedef de almaz -
       yani "tekrar kovalamaz" kosulu da burada saglanir. */
    if (hedef.donuyor) {
      ws.savas = null;
      this.#hata(ws, 'ERR_VALIDATION', 'err.combat.target_returning');
      return;
    }
    /* MADDE 12a / 65 - AGRO ONCE.
       Eskiden `if (v.hasar <= 0) return;` satiri agro blogunun USTUNDEYDI:
       bloklanan ya da iskalanan bir vurus canavari UYANDIRMIYORDU. Oysa
       bloklanan vurus da bir SALDIRIDIR - istemci blok dalinda hedefe
       playAnim('block') oynatiyor (@27021440). Yalniz HP guncellemesi ve
       olum kontrolu hasar>0 kosuluna bagli kaldi. */
    hedef.hedefEntityId = ws.entityId;
    hedef.sonHasarAlma = Date.now();
    /* Kovalama bacagi da `gez` alaninda aynalaniyor (bkz. #kovalamaKur);
       onu gezinme.iptal ile silmek kovalamayi kesintiye ugratirdi. */
    if (hedef.gez && !hedef.gez.kov) this.gezinme?.iptal(hedef, hedef.sonHasarAlma);

    /* combat.event semasi (T$ 140): dstHp ZORUNLU ve kacinma alaninin adi
       `miss` (bizde `missed` yaziyordu -> sema disi, sessizce dusuyordu).
       dstHp gonderilmeyince istemci can cubugunda "undefined/54" gosteriyordu.
       Canli referans oyun ornegi:
         {"src":104981,"dst":105062,"kind":"auto","dmg":6,"hitIndex":0,
          "crit":false,"dstHp":48}
       Cok vuruslu saldirilarda (kilic hits:2) her vurus AYRI kare olur;
       ikinci ve sonrakiler `followup:true` tasir. */
    /* HER VURUS TAM HASARI verir - bolunmez. Canli olcumde kilic (hits:2)
       6 ve 6 vurdu, yani 12'yi ikiye bolmedi; formul zaten VURUS BASINA
       degeri veriyor. */
    /* MADDE 12a - `aid` YOK.
       Istemcinin Djt() kapisi (@27108693) tam olarak sunu istiyor:
         if (kind !== 'auto' || aid !== undefined || src.kind !== 'player') return;
       aid TAKILMAZSA silahin base-attacks hitOffsetsMs dizisi okunup
       `applyAutoSwing({melee:true, contactsMs})` + `UY.openHitSchedule(...)`
       ile HER VURUS kendi temas anina yerlestiriliyor (kilic [200,566]).
       aid takildigi anda o kapi kapaniyor, kod `v_o = kind==='auto' &&
       aid!==undefined` dalina dusuyor ve `UY.gate(VY(src,aid))` cagriliyor;
       o anahtarda hicbir kapi acilmadigi icin gate() geri cagirmayi ANINDA
       calistiriyor (@25082330 `if (!anchorAtOwner) { arg_t(); return; }`).
       Kullanicinin "hasar animasyondan once dusuyor" sikayetinin koku bu.
       Canli referans oyun yakalamasinda auto olayinda aid YOK. */
    let toplam = 0;
    const BEC = this.sistemOrnegi?.('beceri');
    for (let i = 0; i < vuruslar.length; i++) {
      const v = vuruslar[i];
      const d = Math.max(0, v.hasar);
      if (d > 0) { hedef.hp = Math.max(0, hedef.hp - d); toplam += d; }
      /* MADDE 20 (capraz istek 31): imbue rideri YALNIZ ilk vurusta ve hasar
         gectiyse. Ana `dmg` DEGISMEZ - istemci `dmg + (imbueDmg ?? 0)`
         ciziyor (@27018044); kritik carpani imbue bilesenine UYGULANMAZ
         (combat.json crit $comment). */
      const imb = (i === 0 && d > 0) ? BEC?.imbueOnHit?.(ws, hedef) : null;
      if (imb?.dmg > 0) { hedef.hp = Math.max(0, hedef.hp - imb.dmg); toplam += imb.dmg; }
      const olay = {
        src: ws.entityId, dst: hedef.id, kind: 'auto',
        dmg: d,
        crit: !!v.kritik,
        blocked: !!v.blok, miss: !!v.kacti,
        hitIndex: i,
        dstHp: Math.round(hedef.hp),
        ...(i > 0 ? { followup: true } : {}),
        ...(v.tabanId ? { baseAttackId: v.tabanId } : {}),
        ...(imb?.dmg > 0 ? { imbueDmg: imb.dmg } : {}),
        ...(imb?.dmg > 0 && imb.groupId ? { imbueGroup: imb.groupId } : {}),
      };
      /* Kesirli hasar emniyeti (bulgu ALAN 1): combat.event(140) dmg int olmali -
         istemci String(n) ile yuvarlamadan cizer. Bugun no-op, regresyon kemeri. */
      if (typeof olay.dmg === 'number' && !Number.isInteger(olay.dmg)) olay.dmg = Math.round(olay.dmg);
      this.frame(ws, 'combat.event', olay);
      this.broadcast(zoneId, 'combat.event', olay, ws);
      /* MADDE 25 (capraz istek 41): asinma zarinda KIRILAN parca bildirimi.
         combat.vurus() kirilanlar dizisini doner (esya.ASINMA oranlari,
         enhance.json durability blogu). Hedef canavar oldugu icin yalniz
         'saldiran' sahibi olabilir. */
      for (const k of v.kirilanlar ?? []) {
        if (k.sahip === 'saldiran') this.#esyaKirildi(ws, k.itemId);
      }
    }

    /* TEHDIT PUANI (bulgular recetesi 1): verilen hasar puan olarak eklenir -
       son-vuran ezmesi kalkar, hedef secimi en yuksek puana gecer
       (#canavarYZ). Oran 1:1 INTERIM isaretli (paket puan curumesi/orani
       tasimiyor - bulgular "acik" maddesi). `tehditHpIzi` bu vurusun dis-hasar
       izleyicisinde (#canavarYZ) IKINCI kez sayilmamasi icin esitlenir. */
    if (toplam > 0) {
      this.#tehditKazandir(zoneId, hedef, ws, toplam);
      hedef.tehditHpIzi = hedef.hp;
    }

    if (toplam <= 0) return;

    const hp = { id: hedef.id, hp: Math.round(hedef.hp), maxHp: hedef.maxHp };
    this.frame(ws, 'entity.hp', hp);
    this.broadcast(zoneId, 'entity.hp', hp, ws);

    /* MADDE 12a devami: combat.death de aid'siz gider. Istemcinin Ojt()'si
       (@27109000) `aid === undefined ? HY(killerId) : VY(killerId, aid)`
       diyor; HY(src) = "${src}:auto" tam olarak openHitSchedule'in actigi
       anahtardir, yani olum SON VURUSUN ardina duser. */
    if (hedef.hp <= 0) this.#olum(zoneId, ws, hedef);
  }

  /**
   * MADDE 25 (capraz istek 41): kirilan parca icin TEK SEFERLIK bildirim +
   * envanter/stat tazeleme. tr.json sys.combat.item_broke =
   * "{item} kirildi! Bir tuccarda tamir ettir." (Tht enum @25605319).
   * Kirik parca artik stat vermiyor (combat.js kirikMi kapilari) ->
   * turetilmis statlar bayat kalmasin diye stats.update da gider.
   */
  #esyaKirildi(ws, itemId) {
    const def = this.combat.itemStats?.get(itemId);
    this.frame(ws, 'sys.notice', {
      key: esya.ANAHTAR.KIRILDI,
      params: { item: def?.name ?? itemId },
    });
    if (this.envanterPayload) this.frame(ws, 'inv.update', this.envanterPayload(ws.char));
    this.frame(ws, 'stats.update', this.combat.turetilmis(ws.char));
    this.kaydet?.(ws);
  }

  // ------------------------------------------------------------------- olum
  /** @param {number} [aid] YALNIZ beceri/canavar eylemi yolunda verilir (madde 12a). */
  #olum(zoneId, ws, mob, aid) {
    /* MADDE 22 - respawn gecikmesi YUVADAN gelir (data/spawns.json
       respawnDelaySec = Tab_RefNest.dwDelayTimeMin/Max; paket sema @8718198
       respawnMinMs/respawnMaxMs). Sabit 30_000 hicbir kaynaktan gelmiyordu:
       7350 yuvanin yalnizca 287'sinin (%3.9) araligi 30 sn'yi kapsiyor,
       2374'u (%32.3) 8-12 sn. Argumani HIC vermiyoruz - world.js kendi
       penceresini kullanir. */
    this.world.olumKaydet(zoneId, mob);
    /* Kovalama bacagini da birak: olen canavar yurumez (world.olumKaydet
       `gez`i siliyor ama `bacak` bu dosyada kuruluyor). */
    this.#kovalamaBirak(mob);
    /* TEHDIT TEMIZLIGI (bulgular recetesi 6): olen mob respawn'da ayni varlik
       nesnesiyle geri geliyor - eski hayatin puanlari tasinamaz. */
    mob.tehdit = null;
    mob.zorlaHedef = null;
    mob.tehditHpIzi = null;
    /* Eve donus durumu da dusmeli: respawn AYNI varlik nesnesini geri
       getiriyor ve kalinti `donuyor` dirilen canavari hem dokunulmaz hem
       saldirmaz birakirdi (tehdit defteriyle ayni gerekce). */
    this.#donusuBitir(mob);
    const olay = { id: mob.id, killerId: ws.entityId, ...(aid === undefined ? {} : { aid }) };
    this.frame(ws, 'combat.death', olay);
    this.broadcast(zoneId, 'combat.death', olay, ws);
    ws.savas = null;
    if (ws.hedefId === mob.id) ws.hedefId = null;

    /* MADDE 16/54 (capraz istek 32): OLUMDE DURUM TEMIZLIGI. Istemcinin
       applyDeath dali (@25671100) durum listesine DOKUNMUYOR - temizleme
       bildirilmezse rozet ekranda asili kalir. sistem_beceri.js kendi olum
       yolunda ayni temizligi yapiyor; burasi otomatik saldiri yolu. */
    {
      const BEC = this.sistemOrnegi?.('beceri');
      const l = BEC?.durumListesi?.(zoneId, mob.id);
      if (l?.length && BEC?.durumMotoru) {
        const r = BEC.durumMotoru.temizle(l, 'death');
        if (r.degisti) {
          const kare = { id: mob.id, statuses: [],
            removed: r.dusenler.map((x) => ({ code: x.code, reason: x.reason })) };
          this.frame(ws, 'statuses.update', kare);
          this.broadcast(zoneId, 'statuses.update', kare, ws);
        }
      }
    }

    // --- odul ---
    const { xp, spExp } = this.combat.odul(mob, ws.char);
    /* FARK #0/#180 (capraz istek 49) - PARTI XP/SP PAYLASIMI.
       Odul artik TEK ortak noktadan dagitilir: sistem_parti.paylasimHesapla
       uygun uyeleri (cevrimici + ayni bolge + partyShareRangeU + yasayan)
       bulup paylari boler; partisiz oyuncuda tek kayit doner, yani davranis
       birebir korunur. Modul yoksa ?. ile eski tek-alici yola duser. */
    const dagilim = this.sistemOrnegi?.('parti')?.paylasimHesapla?.(ws, xp, spExp);
    for (const d of dagilim ?? [{ ws, xp: Math.max(0, xp), spExp: Math.max(0, spExp) }]) {
      if (!d?.ws?.char) continue;
      this.#odulUygula(zoneId, d.ws, d.xp ?? 0, d.spExp ?? 0, mob, aid, d.ws === ws);
    }

    // --- gorev / meslek / basari sayaclari (madde 28) ---
    /* dagilim ZATEN paylasimHesapla ciktisi - #oldurmeBildir'e verilir ki
       ayni tikte paylasimHesapla iki kez cagrilmasin (uye listesi ayni). */
    this.#oldurmeBildir(zoneId, ws, mob, dagilim ?? null);

    // --- ganimet ---
    this.#ganimetDus(zoneId, ws, mob);
  }

  /**
   * FARK #0/#180 (capraz istek 49) - TEK ALICIYA odul uygulama.
   * #olum'daki eski tek-oyuncu blogunun yardimciya cikarilmis hali; parti
   * dagiliminda HER ALICI icin ayri cagrilir. `olduren` yalniz gainFx'in
   * kime gidecegini secer: progress.gainFx killer'in vurus kapisina
   * (HY/VY anahtari) demirli oldugu icin sadece oldurene gonderilir -
   * uyeler paylarini progress.update + sys.progress.xp ile gorur.
   */
  #odulUygula(zoneId, hedefWs, xp, spExp, mob, aid, olduren) {
    const ch = hedefWs.char;
    /* PREMIUM XP/SP BONUSU (D5-C) - ALICI BASINA, dagitimdan SONRA.
       Katsayilar combat.js premiumBonusPct()'de sabit (paket @9299985
       $comment "additive % boost to XP and SP from monster kills";
       bronze 10 @9300246 / silver 15 @9300566 / gold 20 @9300882).
       ch.premiumTier'i D5-A yansitiyor; alan yoksa carpan 1 = bugunku
       davranis. odul() HAVUZUNA konmadi: paylasimHesapla havuzu partiye
       boluyor, hesap-bazli premium tum partiye dagilirdi. Istemci
       progress.gainFx'te NIHAI xpDelta bekler (sema @25622147, bonus
       kirilim alani yok) -> burada carpmak tel uyumunu bozmaz. */
    const prem = this.combat.premiumCarpani?.(ch) ?? 1;
    if (prem !== 1) {
      xp = Math.max(0, Math.round(xp * prem));
      spExp = Math.max(0, Math.round(spExp * prem));
    }
    const oncekiSeviye = ch.level;
    const sonuc = this.combat.xpEkle(ch, xp);
    this.combat.spEkle(ch, spExp);

    const tbl = this.combat.progress?.xpToNext;
    const xpToNext = tbl ? (Number(tbl[String(ch.level)] ?? 0) || null) : null;

    if (olduren) {
      this.frame(hedefWs, 'progress.gainFx', {
        sourceId: mob.id, xpDelta: Math.max(0, xp), spExpDelta: Math.max(0, spExp),
        recipientLevelAfter: ch.level,
        xpVisualDenominator: Math.max(1, xpToNext ?? 1),
        /* aid VARSA gecer, yoksa alan HIC gonderilmez (madde 12a). Istemcinin
           Pjt()'si Ojt() ile ayni kapiyi seciyor: aid yoksa HY(killerId)
           (= melee temas cizelgesi), varsa VY(killerId, aid). */
        killerId: hedefWs.entityId, ...(aid === undefined ? {} : { aid }),
      });
    }
    this.frame(hedefWs, 'progress.update', {
      xp: ch.xp, xpToNext,
      spExp: ch.spExp,
      spExpToNext: this.combat.progress?.spExpPerSpPoint ?? 400,
      sp: ch.sp ?? 0,
    });
    /* "600 XP kazanildi (+960 SP puani)" satiri - locale anahtari sys.progress.xp.
       Bu HIC gonderilmiyordu, o yuzden oldurunce sistem kutusunda bir sey cikmiyordu. */
    if (xp > 0 || spExp > 0) {
      this.frame(hedefWs, 'sys.notice', {
        key: 'sys.progress.xp',
        params: { xp: Math.max(0, xp), sp: Math.max(0, spExp) },
      });
    }
    if (sonuc.seviyeAtladi) {
      this.frame(hedefWs, 'progress.levelUp',
        { level: ch.level, statPoints: ch.statPoints ?? 0 });
      /* SEVIYE ATLAMA EFEKTI - s2c 188 fx.levelUp {id}.
         Hic gonderilmiyordu; referans oyunda seviye atlayinca altin halka efekti
         cikiyor, bizde hicbir sey olmuyordu. Efekt dosyalari (fx/ 1208 dosya)
         eksik degil - TETIKLEYICI MESAJ eksikti. Cevredekiler de gormeli. */
      this.frame(hedefWs, 'fx.levelUp', { id: hedefWs.entityId });
      this.broadcast(zoneId, 'fx.levelUp', { id: hedefWs.entityId }, hedefWs);
      // "Seviye atladin - artik seviye {level}!"
      this.frame(hedefWs, 'sys.notice', {
        key: 'sys.progress.level_up', params: { level: ch.level },
      });
      const d = this.combat.turetilmis(ch);
      ch.hp = d.maxHp; ch.mp = d.maxMp;
      this.frame(hedefWs, 'vitals.update', { hp: ch.hp, mp: ch.mp });
      /* MADDE 28c - GOREV KATALOGU TAZELEME.
         katalogGonder yalniz girise ve accept/abandon/claim sonrasina
         bagliydi; seviye atlayan oyuncu yeni acilan gorevleri HIC gormuyordu
         ve katalog isteyen bir c2s opcode YOK (167 T$ kaydinda yok), yani
         itmek zorundayiz. */
      try { this.sistemOrnegi?.('gorev')?.katalogGonder?.(hedefWs); }
      catch (e) { this.log('gorev katalogu tazelenemedi:', e.message); }
      this.log(`${ch.name} seviye ${oncekiSeviye} -> ${ch.level}`);
    }
  }

  /**
   * MADDE 28 - OLDURME SAYACI KANCASI.
   *
   * (a) sistem_gorev.js sayacArtir()'i disa aciyor ama TUM agacta SIFIR
   *     cagirani vardi: oyuncu 25 mangyang olduruyor, sayac 0/25 kaliyordu.
   * (b) BIRIM = 720720 = LCM(1..16) (paket eRt @27557820) ve istemci kesirli
   *     oldurmeyi toFixed(2) ile yaziyor -> bir oldurme parti uyeleri
   *     arasinda BOLUNUYOR. Naif baglanirsa parti ilerlemeyi HIZLANDIRMAK
   *     yerine YAVASLATIR: pay = floor(720720/uyeSayisi) LISTEDEKI HER
   *     UYEYE yazilmali. sistem_parti.paylasimHesapla(ws, 0, 0) uygun uye
   *     listesini (ayni bolge + partyShareRangeU menzili + yasayan) zaten
   *     uretiyor ve [0] daima olduren oluyor.
   *
   * Sira: once kayitli GENEL kancalar, sonra - 'gorev' adiyla kayit YOKSA -
   * sistemOrnegi('gorev').sayacArtir koprusu. Boylece sistem_gorev.js
   * ileride kendini kaydettirdiginde sayac iki kez artmaz.
   */
  #oldurmeBildir(zoneId, ws, mob, uyelerHazir = null) {
    let uyeler = [{ ws }];
    if (Array.isArray(uyelerHazir) && uyelerHazir.length) {
      /* capraz istek 49: #olum'un XP dagilimi zaten paylasimHesapla ciktisi -
         ayni uye listesi; ikinci kez hesaplanmaz. */
      uyeler = uyelerHazir;
    } else {
      try {
        const d = this.sistemOrnegi?.('parti')?.paylasimHesapla?.(ws, 0, 0);
        if (Array.isArray(d) && d.length) uyeler = d;
      } catch (e) { this.log('parti payi hesaplanamadi:', e.message); }
    }
    const kisi = uyeler.length;
    const bilgi = { kisi, uyeler, zoneId };

    for (const [, fn] of this.olumKancalari) {
      try { fn(ws, mob, bilgi); }
      catch (e) { this.log('olum kancasi hatasi:', e.message); }
    }
    if (this.olumKancalari.has('gorev')) return;

    const gorev = this.sistemOrnegi?.('gorev');
    if (!gorev?.sayacArtir) return;
    for (const u of uyeler) {
      if (!u?.ws?.char) continue;
      /* sayacArtir 2. parametre olarak MOB NESNESINI de kabul ediyor
         (mob.def.id'yi kendisi cozuyor); mob.id VARLIK numarasidir,
         verilirse sessizce hicbir sey olmaz. */
      try { gorev.sayacArtir(u.ws, mob, kisi); }
      catch (e) { this.log('gorev sayaci artirilamadi:', e.message); }
    }
  }

  #ganimetDus(zoneId, ws, mob) {
    /* MADDE 51 - noDropDeltaMin = 9. ganimet() imzasi artik ganimet SAHIBINI
       de aliyor; delta = oyuncuSeviyesi - canavarSeviyesi >= 9 ise altin ve
       esya DUSMEZ (data/progress.json sabitler.levelGapPolicy.noDropDeltaMin
       ve data/drops.json monsterRewards.noDropDeltaMin, paket sema @8687350).
       XP/SP ayri egriyle (xpSpFactorByDelta) zaten azaliyor, gorev sayimi bu
       daldan GECMEDIGI icin etkilenmiyor. */
    const g = this.combat.ganimet(mob, ws.char);
    const eklenen = [];
    const yerlestir = () => {
      const a = Math.random() * Math.PI * 2, r = 1 + Math.random() * 2;
      return { x: mob.x + Math.cos(a) * r, z: mob.z + Math.sin(a) * r };
    };
    /* MADDE 7 kurali ganimette de gecerli: groundY'ye TOHUM olarak olen
       canavarin y'si veriliyor. Tohumsuz cagri kopru/platform ustunde olen
       mobun ganimetini ALT KATA dusuruyordu (terrain.js BAS_BOSLUGU 0.75). */
    if (g.gold > 0) {
      const p = yerlestir();
      /* CANLI REFERANS OYUN OLCUMU (state.delta.add):
           {"id":163635,"kind":"ground_item","modelKey":"drop_item_bag",
            "name":"1290 Gold","qty":1,"gold":1290, x,z,y,rotY}
         Bizim 'gold' ve 'drop_box' anahtarlari HICBIR YERDE yok - istemci model
         bulamayinca ganimeti CIZMIYOR, o yuzden "yerden esya alamiyorum". */
      const e = {
        id: this.world.yeniVarlikId(), kind: 'ground_item',
        modelKey: 'drop_item_bag', name: `${g.gold} Gold`, gold: g.gold, qty: 1,
        x: p.x, z: p.z, y: this.world.groundY(zoneId, p.x, p.z, mob.y), rotY: 0,
        sahip: ws.entityId, sahipBitis: Date.now() + SAHIP_KILIDI_MS,
        bitis: Date.now() + GANIMET_OMRU_MS,
      };
      this.world.varlikEkle(zoneId, e);
      eklenen.push(this.#ganimetPayload(e));
    }
    for (const it of g.items.slice(0, 4)) {
      const p = yerlestir();
      /* modelKey ve gorunen ad ESYA KATALOGUNDAN gelir (itemstats.json):
           drop_equip_bundle / drop_acc_bundle / drop_item_bag / drop_elixir ... */
      const def = this.combat.itemStats?.get(it.itemId);
      const adet = Array.isArray(it.qty) ? it.qty[0] : (it.qty ?? 1);
      /* MADDE 26 (capraz istek 39): dusen ekipmanin ORNEGI (S$ alanlari:
         plus/variance/dur/maxDur) burada uretilir ve varlikta saklanir;
         boylece yerdeki esya ile cantaya giren AYNI kayittir (fark #16).
         `yigin` tel semasina GIRMEZ - #ganimetPayload sizdirmiyor.

         2026-09-04 - "(+%0)" KOK NEDENI: ucuncu argument (secenek) HIC
         verilmiyordu, esya.js de acikca "cagiran vermezse 0" diyor. Sonuc:
         dusen HER esya variance=0/plus=0, yani alti nitelik grubunun altisi
         da rollRanges'in ALT SINIRINDA (olcum: heavy01_boots_bronze
         50/50 dayaniklilik, 3 fiz.sav, 4 buy.sav, %4.1, %5.4, 5 savusturma
         = aralik minimumlarinin tamami). Kural tek yerde: combat.dususOrnegi
         (varyans = grup basina 0..31 zar, +N = drops.json $optLevelSel). */
      const yigin = esya.yeniYigin(def ?? it.itemId, adet,
        this.combat.dususOrnegi(def, {
          cevrimiciDk: ws._oturumT0 ? (Date.now() - ws._oturumT0) / 60_000 : null,
        }));
      const e = {
        id: this.world.yeniVarlikId(), kind: 'ground_item',
        modelKey: def?.modelKey ?? 'drop_item_bag',
        name: def?.name ?? it.itemId, itemId: it.itemId,
        qty: adet,
        yigin,
        x: p.x, z: p.z, y: this.world.groundY(zoneId, p.x, p.z, mob.y), rotY: 0,
        sahip: ws.entityId, sahipBitis: Date.now() + SAHIP_KILIDI_MS,
        bitis: Date.now() + GANIMET_OMRU_MS,
      };
      this.world.varlikEkle(zoneId, e);
      eklenen.push(this.#ganimetPayload(e));
    }
    if (eklenen.length) {
      this.frame(ws, 'state.delta', { add: eklenen });
      this.broadcast(zoneId, 'state.delta', { add: eklenen }, ws);
    }
  }

  #ganimetPayload(e) {
    const p = {
      id: e.id, kind: 'ground_item', modelKey: e.modelKey, name: e.name,
      x: +e.x.toFixed(2), z: +e.z.toFixed(2), y: +e.y.toFixed(2), rotY: 0,
    };
    if (e.itemId) { p.itemId = e.itemId; p.qty = e.qty ?? 1; }
    if (e.gold) { p.gold = e.gold; p.qty = e.qty ?? 1; }
    return p;
  }

  #ganimetTemizle(zoneId, z, simdi) {
    const sil = [];
    for (const e of z.entities.values()) {
      if (e.kind === 'ground_item' && e.bitis && e.bitis < simdi) sil.push(e.id);
    }
    if (!sil.length) return;
    for (const id of sil) this.world.varlikSil(zoneId, id);
    this.broadcast(zoneId, 'state.delta', { rem: sil }, null);
  }

  // --------------------------------------------------------------- canavar YZ
  #canavarYZ(zoneId, z, simdi) {
    /* Gorunenler kumesi: en az bir oyuncunun ilgi alanindaki varlik id'leri.
       Bosta gezinme SADECE bunlar icin calisir - Samarkand'da 7.500 canavar var,
       hepsini her tikte yurutmek CPU'yu ve agi bosa yakar. */
    /* Gorunenler kumesi agro icin de gerekli - bu yuzden gezinme kapali olsa
       bile HER ZAMAN kurulur. (Eskiden sadece `if (this.gezinme)` icinde
       kuruluyordu; gezinme yokken agro da olmezdi.) */
    const gorunenler = new Set();
    for (const p of z.players) { if (p.gorunen) for (const id of p.gorunen) gorunenler.add(id); }

    /* MADDE 16/18 (capraz istek 32): durum listeleri sistem_beceri.js'te
       tutuluyor; modul yoksa (testlerin sahte ctx'i) tum kapilar acik kalir. */
    const BEC = this.sistemOrnegi?.('beceri');

    for (const mob of z.entities.values()) {
      if (mob.kind !== 'monster') continue;
      /* Olen mob donus durumunu TASIMAZ: respawnTik ayni varlik nesnesiyle
         geri geliyor (bkz. #olum tehdit temizligi) - kalinti `donuyor`
         dirilen canavari dokunulmaz ve saldirmaz birakirdi. #olum bunu zaten
         temizliyor; bu satir olumu baska bir modulun yazdigi yol icin kemer. */
      if (mob.dead) { if (mob.donuyor) this.#donusuBitir(mob); continue; }

      /* EVE YURUYEREK DONUS DURUMU (gereksinim_leash_yuruyerek md. 3):
         "donuyor" iken YZ'nin GERI KALANI (tehdit, agro, kovalama, saldiri)
         hic calismaz - "agro almaz, saldirmaz" kosulu yapisal olarak burada
         saglanir, ayri bir bayrak kontrolune gerek kalmaz. */
      if (mob.donuyor) { this.#eveDonusTik(zoneId, mob, simdi); continue; }

      let hedefId = mob.hedefEntityId;

      /* MADDE 18 - ko/kb SERILME penceresi: hic hareket/saldiri yok. */
      if (BEC?.seriliMi?.(zoneId, mob.id, simdi)) continue;
      /* Degistirici demeti TEK gecis (durumlar.degistiriciler): liste bos ise
         hesap atlanir - 7500 canavarli bolgede bosa dongu donmesin. */
      let durumM = null;
      {
        const dl = BEC?.durumListesi?.(zoneId, mob.id);
        if (dl?.length) durumM = durumlar.degistiriciler(dl, simdi);
      }
      if (durumM?.hedefUnut) {                                               // ca
        mob.hedefEntityId = null; hedefId = null;
        /* Eski davranisla ayni "kalici unutma": tehdit defteri de silinir,
           mob ancak yeni hasar/yakinlik agrosuyla geri doner. */
        mob.tehdit?.clear();
        mob.zorlaHedef = null;
      }

      /* DIS HASAR -> TEHDIT (bulgular recetesi 1'in tamamlayicisi).
         sistem_beceri.js (:1702/:2025/:2054) ve sistem_binek-pet.js (:2072)
         mob HP'sini kendi yollarindan dusurup yalniz hedefEntityId +
         sonHasarAlma yaziyor - o dosyalara dokunmadan hasar, HP DUSUS FARKI
         olarak son yazana puanlanir (#hasarUygula kendi vurusunu isledikten
         sonra iziyi esitledigi icin buraya yalniz DIS hasar duser). Ayni 200
         ms'lik pencerede iki ayri dis vurucu olursa fark son yazana gider -
         yaklasiklik, bulgulardaki "hasar->puan 1:1 INTERIM" sinifinda. */
      {
        const izi = mob.tehditHpIzi ?? mob.maxHp ?? mob.hp;
        if (mob.hp < izi && mob.hedefEntityId != null) {
          this.#tehditKazandir(zoneId, mob, mob.hedefEntityId, izi - mob.hp);
        }
        mob.tehditHpIzi = mob.hp;
      }

      /* ZORLA HEDEF (taunt.forcedMs - skills.json taunt {points, forcedMs}):
         sure dolana kadar hedef kilidi; kilit sahibi gecersizlesirse
         (cikti/oldu/korumada) kilit duser. */
      if (mob.zorlaHedef) {
        const zh = mob.zorlaHedef;
        const p = simdi < zh.bitis ? this.#oyuncuBul(z, zh.id) : null;
        const gecerli = p && p.isAuthed && p.char && !p.char.dead
          && !(p.char.safeUntil && simdi < p.char.safeUntil);
        if (gecerli) { hedefId = zh.id; mob.hedefEntityId = zh.id; }
        else mob.zorlaHedef = null;
      }

      /* TEHDIT SECIMI (bulgular recetesi 1): defter doluysa hedef = en
         yuksek puanli GECERLI oyuncu - son-vuran ezmesi kalkti. Defter
         bossa eski yol (yakinlik agrosu / hedefEntityId) aynen surer. */
      if (!mob.zorlaHedef && mob.tehdit?.size) {
        const secilen = this.#tehditSec(z, mob, simdi);
        if (secilen != null) { hedefId = secilen; mob.hedefEntityId = secilen; }
      }

      /* --------------------------------------------------------- AGRO
         Bu blok EKSIKTI: hedefEntityId'yi yalnizca #hasarUygula (satir 203)
         atiyordu, yani canavarlar SADECE vurulunca karsilik veriyordu.
         158 mobun 99'u `aggressive` oldugu halde hicbiri kendiliginden
         saldirmiyordu. Olculen: mob_tiger 5 birim otede, oyuncu hic
         saldirmadan 12 sn -> hedef=null, vurus=0 (zz_olc_yz.mjs).

         Yaricap: def.aggroRangeU. referans oyun paketinin KENDI dogrulayicisi
         (index-BUMMQVRB.js @25050303) su degismezi zorunlu kiliyor:
           aggro === 'aggressive' && aggroRangeU <= 0  ->  HATA
         yani agresiflik ile aggroRangeU>0 ayni seyin iki yuzu. Bu yuzden
         ayrica `aggro === 'aggressive'` kontrolu gerekmez; yaricap 0 olan
         (59 pasif mobun tamami) kendiliginden asla saldirmaz.

         NOT (bilerek yapilmadi): vSRO Tab_RefTactics'te sampiyon taktikleri
         DAIMA btAggressType=0'dir (238/238 bag; 37'si pasif tabani agresife
         cevirir). referans oyun bunu UYGULAMIYOR - config/monster-variants.json
         $comment: "NOT scaled by rarity anywhere: ... aggro/leash range".
         referans oyun ile birebir kalmak icin nadirlik agroyu DEGISTIRMEZ. */
      if (!hedefId && gorunenler.has(mob.id)) {
        const yaricap = mob.def?.aggroRangeU ?? 0;
        if (yaricap > 0) {
          let enIyi = null, enIyiD2 = yaricap * yaricap;
          for (const p of z.players) {
            if (!p.isAuthed || !p.char || p.char.dead) continue;
            /* DOGUS KORUMASI (2. yon): korumali oyuncu AGRO CEKMEZ.
               tr.json ui.spawn.protected_chip_desc: "canavarlar ve oyuncular
               SANA SALDIRAMAZ, sen de saldiramazsin" -> kural cift yonlu.
               Kontrolu hedef SECIMINDE yapiyoruz: boylece koruma bitince
               canavar normal sekilde agro alir, ama koruma suresince oyuncuyu
               hic gormemis gibi davranir (referans oyunda dogar dogmaz uzerine
               yaratik ustusmuyor). */
            if (p.char.safeUntil && simdi < p.char.safeUntil) continue;
            /* AGGRO SUPPRESS (bulgular recetesi 4 - skills.json
               buff.aggroSuppress {classMaskRaw, maxMonsterLevel}, 25 kayit,
               "Protects you from the attack of Monsters"): buff aktifken
               mob.level <= maxMonsterLevel olan canavar oyuncuyu YOK sayar.
               Yalniz YENI agro kapisi - saldirarak uretilen tehdit puani
               misillemeyi acik birakir (recete boyle tarif ediyor). */
            if (this.#agroBastirildi(p, mob, simdi)) continue;
            const ax = p.char.x - mob.x, az = p.char.z - mob.z;
            const ad2 = ax * ax + az * az;
            if (ad2 <= enIyiD2) { enIyiD2 = ad2; enIyi = p; }
          }
          if (enIyi) {
            mob.hedefEntityId = hedefId = enIyi.entityId;
            this.gezinme?.iptal(mob, simdi);
          }
        }
      }

      if (!hedefId) {
        /* Hedefi yok -> yuvasinin icinde dolas. Kovalama bacagi ONCE
           birakilmali: `gez` alani kovalamada da kullaniliyor ve gezinme.tik
           orada `bas`/`bit` zaman damgalarini bekliyor. */
        this.#kovalamaBirak(mob);

        /* HEDEF BIRAKILDI -> EVE YURUYEREK DONUS (md. "Istenen davranis").
           TEK NOKTA: gereksinimdeki butun birakma kosullari (hedef oldu /
           bolge degistirdi / baglanti koptu / dogus korumasi / taunt kilidi
           bitti ve tehdit sifirlandi / hedefUnut) yukaridaki dallarda
           `mob.hedefEntityId = null` yaziyor ve o dallar `continue` ediyor;
           bir sonraki tikte hepsi BURAYA duser. Boylece her birakma yolunu
           ayri ayri yamamak yerine tek kapi kullaniliyor.
           Mob yuvasinin icindeyse (evdenUzakMi false) donus yok - normal
           bosta gezinme surer, yani bugunku davranis birebir korunur. */
        if (this.#evdenUzakMi(mob)) { this.#eveDonusBaslat(zoneId, z, mob, simdi); continue; }

        /* MADDE 16: fz/st/se/stns (ccLock) veya rt (rootLock) hareketi kilitler. */
        if (this.gezinme && !durumM?.hareketKilit) this.gezinme.tik(zoneId, mob, simdi, gorunenler);
        continue;
      }

      const ws = [...z.players].find(p => p.entityId === hedefId);
      if (!ws || !ws.isAuthed || ws.char?.dead) {
        mob.hedefEntityId = null; this.#kovalamaBirak(mob); continue;
      }
      /* Kovalanan oyuncu korumaya girdiyse (olup dirildi, bolge degistirdi)
         canavar hedefi BIRAKIR - koruma yalniz yeni agroyu degil devam eden
         saldiriyi da keser. */
      if (ws.char.safeUntil && simdi < ws.char.safeUntil) {
        /* Koruma devam eden saldiriyi keserken tehdit kaydi da duser -
           mob korumali oyuncuyu "hic gormemis gibi" davranir (mevcut kural,
           tehdit defteriyle tutarli hale getirildi). Dogus korumasi
           davranisinin kendisi AYNEN korunuyor. */
        mob.tehdit?.delete(ws.entityId);
        mob.hedefEntityId = null; this.#kovalamaBirak(mob); continue;
      }

      /* Kovalamaya gecerken yurumekte olan GEZINME bacagini birak. Kovalama
         bacaginin kendisi de `gez` alaninda aynalaniyor (kov:true) - onu
         iptal etmek her tikte kendi bacagimizi silmek olurdu. */
      if (mob.gez && !mob.gez.kov) this.gezinme?.iptal(mob, simdi);

      /* MESAFE LEASH'I - ARTIK VARSAYILAN OLARAK KAPALI (bilincli sapma;
         gereksinim_leash_yuruyerek_2026-09-04.md "NETLESTIRME" blogu).
         Kullanici lure'un serbest olmasini istedi: mob oyuncuyu KENDI
         BOLGESI icinde sinirsiz kovalar, "belli bir radius disina cikinca
         isinlan/yeniden dog" davranisi kalkti.

         GM anahtari: "Canavar takip siniri" (canavarTakipSiniriU).
           0  -> sinirsiz (VARSAYILAN, bu sapma)
           >0 -> eski mesafe leash'i; verilen sayi mobun kendi leashRangeU'su
                 (mobs.json'da 30-41) YERINE gecer.
         Yuva yaricapi HER IKI HALDE de eklenir - orijinal koddaki gerekce
         aynen gecerli: Tab_RefNest yaricapi medyan 60 birim, mobun
         leashRangeU'su 30-41; sadece leashRangeU kullanilirsa canavar kendi
         yuvasinin icinde bile "cok uzaklastim" der.

         Sinir asildiginda ARTIK ISINLANMA YOK: hedef birakilir ve mob
         "donuyor" durumuna gecip evine YURUR (#eveDonusBaslat). */
      const takipSiniri = this.#takipSiniri();
      if (takipSiniri > 0) {
        const ex = mob.x - mob.evX, ez = mob.z - mob.evZ;
        const leash = (mob.evYaricap ?? 0) + takipSiniri;
        if (ex * ex + ez * ez > leash * leash) {
          this.#eveDonusBaslat(zoneId, z, mob, simdi);
          continue;
        }
      }

      const dx = ws.char.x - mob.x, dz = ws.char.z - mob.z;
      const d2 = dx * dx + dz * dz;
      /* Canavarin menzili KENDI attackRangeU'su (mobs.json, 158/158 mobda var).
         Uydurma "+1.5" kaldirildi. */
      const menzil = mob.def?.attackRangeU ?? this.combat.saldiriMenzili;

      if (d2 > menzil * menzil) {
        /* MADDE 16: hareket kilidi kovalamayi da durdurur; yavaslatma (dt/sl)
           hiz carpani olarak gecer (qmt @25589973). */
        if (durumM?.hareketKilit) { this.#kovalamaBirak(mob); continue; }
        this.#kovala(zoneId, mob, Math.sqrt(d2), menzil, dx, dz,
                     durumM?.hareketCarpani ?? 1);
        continue;
      }

      // menzile girdi - kovalama bacagini birak (bacak varsa mob yurumeye devam ederdi)
      if (mob.bacak || mob.gez?.kov) this.#kovalamaBirak(mob);

      /* MADDE 16: cc (fz/st/se/stns) veya fe (attackDisable) saldiriyi kapatir. */
      if (durumM && (durumM.ccKilit || durumM.saldiriKapali)) continue;

      // saldir
      /* MADDE 52 + npcActionDelayPct: saldiri araligi durum carpanlarindan
         gecer (g$ @25590140; fb npcActionDelayPct 200, sl 125 - h$ @25588614). */
      const araliki = (mob.def?.attackIntervalMs ?? 3000)
        * (durumM ? durumM.saldiriSuresiCarpani * durumM.npcEylemGecikmeCarpani : 1);
      if (simdi - (mob.sonVurus ?? 0) < araliki) continue;
      mob.sonVurus = simdi;

      /* CANAVAR SALDIRI ANIMASYONU - s2c combat.monsterAction.
         Canli referans oyun ornegi:
           {"id":105062,"aid":1,"skillId":"msk_160","slot":"attack01",
            "targetId":104981,"castMs":0,"contactMs":1320,"school":"physical"}
         Beceriler mobs.json combat.skills dizisinden (Mangyang: msk_160/msk_161).

         MADDE 12b - TEK AID. Eskiden monsterAction `aid: sira` (mobun kendi
         vurusSayaci) tasiyor, combat.event ise `this.aidSayaci++` (global)
         kullaniyordu; iki anahtar ASLA tutmuyordu. Istemci monsterAction'da
         `UY.onCastStart(id, VY(id, aid), contactMs)` ile (id:aid) anahtarli
         bir kapi aciyor (@27109872), combat.event'te ayni anahtari ariyor
         (@27112800 `UY.gate(v_o ? VY(src, aid) : void 0, fn)`); kapi
         bulunamayinca gate() geri cagirmayi ANINDA calistiriyor
         (@25082330). Mangyang'da contactMs 1320 ms - yani canavarin kolu
         inmeden can gidiyordu. Artik TEK aid uretilip her ikisinde de
         kullaniliyor; mob.vurusSayaci yalniz BECERI SIRASI icin kaldi. */
      const beceriler = mob.def?.combat?.skills ?? [];
      const aid = this.aidSayaci++;
      let skillId = null, sk = null;
      if (beceriler.length) {
        /* MADDE 43 (capraz istek 66): beceri secimi aiChance AGIRLIKLI zar +
           coolMs kapisi. KAYNAK: _RefSkill AI_AttackChance / Action_CoolTime
           (data/monster-skills.json, gen_monster_skills.mjs). `summon`
           tasiyanlar unique band sisteminin (sistem_dirilis-unique.js) isi -
           burada ATLANIR. Katalog yoksa ESKI round-robin davranisi surer. */
        mob.beceriCd ??= new Map();
        const adaylar = [];
        for (const id of beceriler) {
          const s = this.mobBeceri.get(id);
          if (!s || s.summon || (s.aiChance ?? 0) <= 0) continue;
          if (simdi < (mob.beceriCd.get(id) ?? 0)) continue;
          adaylar.push(s);
        }
        const toplamAgirlik = adaylar.reduce((a, s) => a + s.aiChance, 0);
        if (toplamAgirlik > 0) {
          let r = Math.random() * toplamAgirlik;
          for (const s of adaylar) { r -= s.aiChance; if (r <= 0) { sk = s; break; } }
          sk ??= adaylar.at(-1);
        }
        if (sk) {
          skillId = sk.id;
          mob.beceriCd.set(sk.id, simdi + Math.max(sk.coolMs ?? 0, sk.reuseMs ?? 0));
        } else {
          // katalog yok / hepsi bekliyor -> eski round-robin davranis
          const sira = (mob.vurusSayaci = (mob.vurusSayaci ?? 0) + 1);
          skillId = beceriler[(sira - 1) % beceriler.length];
        }
        const fx = this.mobBeceriFx.get(skillId);
        /* MADDE 12d - YUVA ADI VERIDEN.
           `attack0${idx+1}` 10 becerili mob_isyutaru'da "attack010"
           uretiyordu; istemcinin playAttackSlot'u klibi ADINDA arayip
           (@26676607) bulamayinca RASTGELE bir saldiri klibi oynatiyordu.
           Gercek yuva msk_* kaydinin kod adinda: MSKILL_CH_MANGNYANG_ATTACK01
           -> "attack01". Katalogda olmayan 36 beceride alan HIC gonderilmez
           (istemci zaten rastgele klibe duser - uydurma yapmiyoruz). */
        /* MADDE 12d - MERMI. Istemci
           `!node.projectile || node.school !== 'physical' || v_r2 || ...`
           (@27023390) kosuluyla oku firlatiyor. Bayrak becerinin KENDI FX
           kaydindan geliyor (model "fx/projectiles/*.glb" ya da
           script "SCT_ARROW"); attackRangeU esigi UYDURULMADI - mermi
           tasiyan 38 becerinin sahibi mobin menzili 2.1 ile 46 arasinda. */
        /* `?.`: eski combat.js / testlerin sahte ctx'inde fonksiyon yok -
           tik COKMESIN (dosyanin genel geriye-uyum kalibi, bkz.
           canavarBecerisiVurusu). 'physical' uydurma degil: combat.event
           school enum'unun fiziksel dali ve magAtk'siz mobun eski davranisi
           (madde 10, combat.js canavarOkulu ayni varsayilana duser). */
        const okul = this.combat.canavarOkulu?.(mob) ?? 'physical';
        const eylem = {
          id: mob.id, aid, skillId,
          targetId: ws.entityId,
          /* MADDE 43: castMs GERCEK Action_CastingTime (msk_286 = 1072).
             contactMs DEGISMEZ - temas ani _RefSkill'de yok (mangyang canli
             1320, sutunlar 0/0/2400/3000; animasyonun dmgEvent'i), 0.44
             isaretli sabit madde 12'deki gibi kalir. */
          castMs: sk?.castMs ?? 0,
          contactMs: araliki > 0 ? Math.round(araliki * 0.44) : 0,
          /* MADDE 10 + 43: etiket ile HASAR ayni kaynaktan. Beceri kataloginda
             school varsa o ('special' tel enum'unda YOK - o zaman mob
             sutunlarindan cozulur); yoksa canavarOkulu. */
          school: (sk?.school === 'physical' || sk?.school === 'magical')
            ? sk.school : okul,
          ...(fx?.slot ? { slot: fx.slot } : {}),
          ...(fx?.mermi ? { projectile: true } : {}),
        };
        this.frame(ws, 'combat.monsterAction', eylem);
        this.broadcast(zoneId, 'combat.monsterAction', eylem, ws);
      }

      /* MADDE 43 (capraz istek 66/67): msk kaydinda katsayi varsa hasar
         BECERI cekirdeginden (combat.canavarBecerisiVurusu - flatMin/Max +
         coefficientPct _RefSkill att blogundan). Geriye uyumlu ?. - eski
         combat.js ile canavarVurusu'na duser. */
      const v = (sk?.coefficientPct != null && this.combat.canavarBecerisiVurusu)
        ? this.combat.canavarBecerisiVurusu(mob, ws.char, sk)
        : this.combat.canavarVurusu(mob, ws.char);

      /* SEMA (combat.event 140): `dstHp` ZORUNLU, kacirma alaninin adi
         `miss` - `missed` DEGIL. Bu dal (canavar -> oyuncu) ikisini de
         yanlis yapiyordu, yani oyuncunun UZERINE gelen hicbir hasar
         rakami/animasyonu istemcide gorunmuyordu. Ayni hata oyuncu -> canavar
         dalinda (#vurus) daha once duzeltilmisti; burada kalmis.
         `dstHp` gonderebilmek icin YENI hp once hesaplaniyor. */
      const der = this.combat.turetilmis(ws.char);
      const ham = Math.max(0, Math.round(v.hasar));
      /* MADDE 39 (capraz istek 33): GELEN HASAR SUZGECI - emici kabuk ->
         disperse -> MP kalkani -> duvar (sistem_beceri.gelenHasarSuzgeci).
         absorbed/mpAbsorbed alanlari combat.event(140) semasinda VAR. */
      const okulKisa = ((sk?.school === 'magical')
        || (sk?.school !== 'physical' && this.combat.canavarOkulu?.(mob) === 'magical'))
        ? 'mag' : 'phys';
      const suzgec = BEC?.gelenHasarSuzgeci?.(ws, ham, okulKisa)
        ?? { hasar: ham, absorbed: 0, mpAbsorbed: 0 };
      const hasar = Math.max(0, Math.round(suzgec.hasar));
      const yeniHp = Math.max(0, Math.round((ws.char.hp ?? der.maxHp) - hasar));
      const olay = {
        src: mob.id, dst: ws.entityId, kind: 'auto', dmg: hasar,
        crit: !!v.kritik, blocked: !!v.blok, miss: !!v.kacti,
        dstHp: yeniHp,
        ...(suzgec.absorbed > 0 ? { absorbed: suzgec.absorbed } : {}),
        ...(suzgec.mpAbsorbed > 0 ? { mpAbsorbed: suzgec.mpAbsorbed } : {}),
        /* MADDE 12b: aid YALNIZ monsterAction gonderildiyse eklenir - kapiyi
           acan mesaj o. Beceri listesi bos olan mobda aid gonderirsek
           istemci `v_o` dalina dusup applyCombat'i `swingShown:true` ile
           isler, yani vurus animasyonunu HIC oynatmaz. */
        ...(skillId ? { aid } : {}),
        /* MADDE 12c: canavar olayina skillId. Istemci
           `kind==='auto' && skillId?.startsWith('msk_')` kosuluyla
           onMonsterHit'i cagirip 294 msk_* kaydinin hitEffect'ini
           oynatiyor (@27021500); alan gonderilmedigi icin hicbiri
           calismiyordu. */
        ...(skillId ? { skillId } : {}),
      };
      /* Kesirli hasar emniyeti (bulgu ALAN 1): combat.event(140) dmg int olmali -
         istemci String(n) ile yuvarlamadan cizer. Bugun no-op, regresyon kemeri. */
      if (typeof olay.dmg === 'number' && !Number.isInteger(olay.dmg)) olay.dmg = Math.round(olay.dmg);
      this.frame(ws, 'combat.event', olay);
      this.broadcast(zoneId, 'combat.event', olay, ws);

      /* MADDE 25 (capraz istek 41): darbe basina TEK zirh asinma zari
         combat.canavarVurusu icinde atildi; kirildiysa bildir. */
      if (v.kirilan?.itemId) this.#esyaKirildi(ws, v.kirilan.itemId);

      /* CAPRAZ ISTEK 68: canavar becerisinin statusApplications'i hedefe
         durum motoru uzerinden basar (QJ semasi @8660676 ile BIREBIR ayni
         alanlar). Oyuncu hedefin direnc profili YOK -> direncler: null.
         Vurus tutmadan (miss/blok) durum basilmaz. */
      if (sk?.statusApplications?.length && !v.kacti && !v.blok
          && BEC?.durumListesi && BEC?.durumMotoru) {
        const l = BEC.durumListesi(zoneId, ws.entityId);
        const r = BEC.durumMotoru.beceridenUygula(l, sk.statusApplications, {
          direncler: null,
          hedefSeviye: ws.char.level ?? 0,
          kaynak: mob.id, skillId: sk.id, simdi,
        });
        if (r.degisti) {
          const kare = { id: ws.entityId, statuses: r.aktif };
          this.frame(ws, 'statuses.update', kare);
          this.broadcast(zoneId, 'statuses.update', kare, ws);
        }
      }

      /* MP kalkani MP'yi ZATEN dusurdu -> hasar 0'a inse bile vitals gider. */
      if (hasar <= 0) {
        if (suzgec.mpAbsorbed > 0) {
          this.frame(ws, 'vitals.update',
            { hp: ws.char.hp ?? der.maxHp, mp: ws.char.mp ?? der.maxMp });
        }
        continue;
      }

      ws.char.hp = yeniHp;
      /* SON HASAR ANI - savas disi yenilenme kapisi bunu okuyor
         (#yenilenme: `simdi - (ws.sonHasar ?? 0) < r.outOfCombatMs`,
         combat.json regen.outOfCombatMs = 5000). Alan hicbir yerde
         YAZILMIYORDU: vurulan ama saldirmayan oyuncu aninda can yenilemeye
         basliyordu, yani 5000 ms'lik kural olu koddu. */
      ws.sonHasar = simdi;
      /* CAPRAZ ISTEK 33 (uyku kirilmasi, tr.json status.se.desc): hasar alan
         oyuncunun se/uyku durumu duser. */
      if (BEC?.durumListesi) {
        const kir = durumlar.hasarAldi(BEC.durumListesi(zoneId, ws.entityId), { hasar });
        if (kir.degisti) {
          const kare = { id: ws.entityId, statuses: kir.aktif,
            removed: kir.dusenler.map((x) => ({ code: x.code, reason: x.reason })) };
          this.frame(ws, 'statuses.update', kare);
          this.broadcast(zoneId, 'statuses.update', kare, ws);
        }
      }
      this.frame(ws, 'vitals.update', { hp: ws.char.hp, mp: ws.char.mp ?? der.maxMp });
      this.broadcast(zoneId, 'entity.hp',
        { id: ws.entityId, hp: ws.char.hp, maxHp: der.maxHp }, ws);

      if (ws.char.hp <= 0) {
        ws.char.dead = true;
        ws.savas = null;
        /* MADDE 4 - olum yolunda bacak IPTAL. Silinmezse ceset bir sonraki
           tikte yurumeye devam ediyor, dirilis isinlanmasindan sonra da eski
           hedefine dogru kendi kendine gidiyordu. ws.alma da birakiliyor. */
        bacakDurdur(ws.char);
        ws.alma = null;
        const o = { id: ws.entityId, killerId: mob.id, ...(skillId ? { aid } : {}) };
        this.frame(ws, 'combat.death', o);
        this.broadcast(zoneId, 'combat.death', o, ws);
        mob.hedefEntityId = null;
        mob.tehdit?.delete(ws.entityId);   // olen oyuncunun puani dusulur (dirilince temiz)
        this.#kovalamaBirak(mob);
      }
    }
  }

  // -------------------------------------------------------- tehdit (aggro) motoru
  /*
   * KAYNAK (bulgular_hizli wf_73438edb, "EKSIK PARITE" bulgusu): referans
   * paket beceri-tehdit mekaniklerini SEMA + VERI olarak tasiyor ve klonun
   * data/skills.json'unda ayni kayitlar mevcut:
   *   taunt {points, forcedMs}                     222 kayit (or. 1016/2000)
   *   aggroDrop {points, areaU, maxTargets}         16 kayit
   *   buff.aggroSuppress {classMaskRaw, maxMonsterLevel}  25 kayit
   *   buff.aggroRedirect {pct}                       7 kayit ("Protect")
   * `points` alanlari referans oyunun sunucu tarafinda TEHDIT-PUANI modeli
   * isledigini gosteriyor; recete: hasar -> puan (1:1 INTERIM - paket oran/
   * curume tasimiyor), hedef = en yuksek puan, leash/olumde temizlik.
   *
   * SINIR NOTU: taunt/aggroDrop birer BECERI KULLANIM etkisidir; kullanim
   * yolu sistem_beceri.js'te (bu koşumun dosyasi DEGIL). Asagidaki
   * tauntUygula/aggroDropUygula kancalari ARTIK BAGLI: sistem_beceri.js
   * atesle() "TEHDIT BAGLAMA" blogu, server.js sistemCtx'in tembel
   * tauntUygula/aggroDropUygula kancalari uzerinden buraya ulasir
   * (dogrulama: test_tehdit_baglama.mjs). Cekirdek motor (puan, secim,
   * temizlik, suppress) ise bu dosyada zaten canli. classMaskRaw'in bit anlami hicbir kaynakta cozulmedi - kural
   * uydurmamak icin YALNIZ maxMonsterLevel kapisi uygulaniyor (recete de
   * yalniz onu tarif ediyor).
   */

  /** z.players icinde entityId ile oyuncu arama (kucuk kume - dogrusal yeter). */
  #oyuncuBul(z, entityId) {
    for (const p of z.players) if (p.entityId === entityId) return p;
    return null;
  }

  /** Mobun tehdit defterine puan ekler (defter tembel kurulur). */
  tehditEkle(mob, entityId, puan) {
    if (!mob || entityId == null || !(puan > 0)) return;
    const m = (mob.tehdit ??= new Map());
    m.set(entityId, (m.get(entityId) ?? 0) + puan);
  }

  /**
   * Puan kazanimi + AGGRO REDIRECT (bulgular recetesi 5).
   *
   * "Protect" (skills.json buff.aggroRedirect {pct}, target:'ally',
   * aciklama "divert some of their hostility ... to yourself"): korunan
   * uyenin puan KAZANIMININ pct'si buffi atan kastere akar. ARTIK CANLI:
   * sistem_beceri.js buff kaydina kaster kimligini yaziyor (s.buff.set
   * govdesindeki `kaynak: ws.entityId` alani; dogrulama:
   * test_tehdit_baglama.mjs). Kaster verisi tasimayan ESKI kayitlarda
   * aktarim yine YAPILMAZ - pct veriden, kimlik uydurulmaz.
   */
  #tehditKazandir(zoneId, mob, kaynak, puan) {
    if (!mob || !(puan > 0)) return;
    const z = this.world.zoneState?.get?.(zoneId);
    const ws = (kaynak && typeof kaynak === 'object')
      ? kaynak
      : (z ? this.#oyuncuBul(z, kaynak) : null);
    const id = ws?.entityId ?? (typeof kaynak === 'number' ? kaynak : null);
    if (id == null) return;

    let kalan = puan;
    if (ws) {
      const simdi = Date.now();
      for (const b of ws.bec?.buff?.values?.() ?? []) {
        const rd = b?.skill?.buff?.aggroRedirect;
        if (!rd) continue;
        const bitis = Number(b.payload?.expiresAt ?? 0);
        if (bitis > 0 && simdi > bitis) continue;
        const kasterId = b.kaynak ?? b.casterId ?? b.payload?.casterId;
        if (kasterId == null || Number(kasterId) === id) continue;
        const kaster = z ? this.#oyuncuBul(z, Number(kasterId)) : null;
        if (!kaster?.isAuthed || !kaster.char || kaster.char.dead) continue;
        const pct = Math.min(100, Number(rd.pct) || 0);
        if (!(pct > 0)) continue;
        const pay = puan * pct / 100;
        this.tehditEkle(mob, kaster.entityId, pay);
        kalan = puan - pay;
        break;   // tek redirect buffi islenir (cakisma kurali icin kaynak yok)
      }
    }
    this.tehditEkle(mob, id, kalan);
  }

  /** Defterden en yuksek puanli GECERLI oyuncuyu secer; gecersizleri dusurur. */
  #tehditSec(z, mob, simdi) {
    const m = mob.tehdit;
    if (!m?.size) return null;
    let enIyi = null, enPuan = -Infinity;
    for (const [id, puan] of m) {
      const p = this.#oyuncuBul(z, id);
      if (!p || !p.isAuthed || !p.char || p.char.dead
          || (p.char.safeUntil && simdi < p.char.safeUntil)) {
        m.delete(id);          // cikti/oldu/korumada -> defterden duser
        continue;
      }
      if (puan > enPuan) { enPuan = puan; enIyi = id; }
    }
    return enIyi;
  }

  /**
   * buff.aggroSuppress kapisi: oyuncunun aktif bufflarindan biri
   * aggroSuppress tasiyorsa ve mob seviyesi maxMonsterLevel'i asmiyorsa
   * TRUE (mob oyuncuyu yakinlik agrosunda yok sayar). Buff okuma deseni
   * sistem_beceri.js'in kendi disa acik kancalariyla ayni
   * (hizCarpani: `ws?.bec?.buff?.values?.()`); expiresAt=0 surekli buff.
   */
  #agroBastirildi(p, mob, simdi) {
    const bec = p?.bec?.buff;
    if (!bec?.size) return false;
    const seviye = Number(mob.level ?? mob.def?.level ?? 0);
    for (const b of bec.values()) {
      const sup = b?.skill?.buff?.aggroSuppress;
      if (!sup) continue;
      const bitis = Number(b.payload?.expiresAt ?? 0);
      if (bitis > 0 && simdi > bitis) continue;
      const maks = Number(sup.maxMonsterLevel);
      if (Number.isFinite(maks) && seviye <= maks) return true;
    }
    return false;
  }

  /**
   * TAUNT (skills.json taunt {points, forcedMs}) - DISA ACIK KANCA.
   * sistem_beceri.js beceri kullanim yolundan cagrilmak uzere: points kadar
   * tehdit + forcedMs boyunca hedef kilidi. Bu dosya kancayi KENDI cagirmaz
   * (kullanim yolu bu koşumun dosyasi degil - bkz. motor basligi).
   * @returns {boolean} mob gecerliyse true
   */
  tauntUygula(zoneId, mobId, ws, taunt) {
    const mob = this.world.varlik(zoneId, Number(mobId));
    /* `mob.donuyor`: eve donen mob AGRO ALMAZ (#eveDonusBaslat md. 7a).
       #eveDonusBaslat tehdit defterini, zorlaHedef'i ve hedefEntityId'yi
       temizliyor; donus SIRASINDA gelen bir taunt ucunu de geri yazardi ve
       #canavarYZ donus dalinda `continue` ettigi icin bu fark ancak
       #eveVardi ile donuyor=false olunca ortaya cikardi: mob eve varir
       varmaz kilitli hedefiyle uyanirdi. Kapi tauntUygula'nin ICINDE, cunku
       tek disa acik cagri yolu bu (sistem_beceri.js hem tekil hedef hem
       alan taunt'unu buradan gecirir). */
    if (!mob || mob.kind !== 'monster' || mob.dead || mob.donuyor || ws?.entityId == null) return false;
    const puan = Number(taunt?.points) || 0;
    if (puan > 0) this.tehditEkle(mob, ws.entityId, puan);
    const sure = Number(taunt?.forcedMs) || 0;
    if (sure > 0) {
      mob.zorlaHedef = { id: ws.entityId, bitis: Date.now() + sure };
      mob.hedefEntityId = ws.entityId;
      this.gezinme?.iptal(mob, Date.now());
    }
    return true;
  }

  /**
   * AGGRO DROP (skills.json aggroDrop {points, areaU, maxTargets}) - DISA
   * ACIK KANCA ("Removes Monsters hostility"). areaU icindeki EN YAKIN
   * maxTargets mobun, kullanicinin puanindan points dusulur; puan sifira
   * inen (ya da yalniz yakinlik agrosuyla kilitlenmis) mob hedefi birakir.
   * @returns {number} etkilenen mob sayisi
   */
  aggroDropUygula(zoneId, ws, drop) {
    const z = this.world.zoneState?.get?.(zoneId);
    if (!z || ws?.entityId == null || !ws.char) return 0;
    const alan = Number(drop?.areaU) || 0;
    const puan = Number(drop?.points) || 0;
    if (!(alan > 0) || !(puan > 0)) return 0;
    const enFazla = Math.max(1, Number(drop?.maxTargets) || 1);
    const alan2 = alan * alan;

    const adaylar = [];
    for (const mob of z.entities.values()) {
      if (mob.kind !== 'monster' || mob.dead) continue;
      const eski = mob.tehdit?.get(ws.entityId) ?? 0;
      if (!(eski > 0) && mob.hedefEntityId !== ws.entityId) continue;
      const dx = mob.x - ws.char.x, dz = mob.z - ws.char.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > alan2) continue;
      adaylar.push({ mob, d2, eski });
    }
    adaylar.sort((a, b) => a.d2 - b.d2);

    let n = 0;
    for (const { mob, eski } of adaylar.slice(0, enFazla)) {
      const yeni = Math.max(0, eski - puan);
      if (mob.tehdit) {
        if (yeni > 0) mob.tehdit.set(ws.entityId, yeni);
        else mob.tehdit.delete(ws.entityId);
      }
      if (yeni <= 0 && mob.hedefEntityId === ws.entityId
          && mob.zorlaHedef?.id !== ws.entityId) {
        mob.hedefEntityId = null;
        this.#kovalamaBirak(mob);
      }
      n++;
    }
    return n;
  }

  /**
   * MADDE 24 - KOVALAMA "TEK BACAK" MODELI.
   *
   * ESKI DAVRANIS (dort ayri fark, hepsi ayni 15 satirda):
   *  (a) Konum her tikte `hiz * tickMs/1000` ilerliyor ama entity.move 500
   *      ms'de bir yayinlaniyordu ve karede yalnizca SON 1 tiklik parca
   *      tarif ediliyordu: istemci mobu 0.1 s'de varip 0.4 s idle bekliyor,
   *      fark `hiz x 0.5` birimde sabitleniyordu (runSpeedU 8.25 -> 4.1u).
   *      3 birimi asinca istemcinin applyMove'u sert SNAP yapiyor
   *      (@25663224) - kullanicinin "canavarlar isinlaniyor" sikayeti.
   *  (b) `this.yurunebilir` HIC cagrilmiyordu: kovalayan canavar duvardan /
   *      binadan geciyordu. Ayni canavar bostayken (gezinme.js:154) nav
   *      kullaniyor - yani asimetri.
   *  (c) world.js #varlikPayload `moving` alanini yalniz `e.gez` doluysa
   *      dolduruyor; kovalarken gez null'landigi icin gorus alanina giren
   *      mob DURUYOR gibi geliyordu.
   *  (d) groundY 4. argumansiz cagriliyordu (madde 7).
   *
   * YENI: bacak.js'in TEK BACAK modeli. bacakKur nav'a soruyor (b) ve
   * gercek varisi doner; bacakIlerlet duvar saatinden GERCEK dt kullaniyor
   * (madde 6) ve Y'yi 0.5'lik ara adimlarla TOHUMLU izliyor (d). Bacak
   * kuruldugunda TEK entity.move yayinlanir, sonra parca bitene kadar YENI
   * KARE GONDERILMEZ - istemcinin yurume suresi sunucununkine esitlenir.
   * `mob.gez` bir AYNA olarak dolduruluyor (kov:true) ki world.js'in
   * `moving` yuku dogru ciksin (c) - ayni desen sistem_binek-pet.js:324'te
   * pet/binek icin zaten kullaniliyor.
   *
   * Bacak YALNIZ su durumlarda yenilenir (fark #51'in tarifi):
   *   - bacak yok / bitti,
   *   - hedef nokta KOVALAMA_YENILE_U'dan fazla kaydi.
   */
  #kovala(zoneId, mob, d, menzil, dx, dz, hizCarpani = 1) {
    /* runSpeedU 158 mobun 152'sinde dolu; 6'sinda yok -> walkSpeedU'ya duser,
       o da yoksa canavar YURUMEZ (sayi uydurmuyoruz, eski `?? 3.3` kalkti).
       hizCarpani = durum yavaslamasi (madde 16, qmt @25589973); 1 = etkisiz. */
    const hiz = (mob.def?.runSpeedU || mob.def?.walkSpeedU || 0) * hizCarpani;
    if (!(hiz > 0)) return;

    // menzilin biraz icine gir ki oyuncu kipirdayinca hemen menzil disi kalmasin
    const varis = Math.max(0, d - menzil * 0.9);
    const hx = mob.x + (dx / d) * varis;
    const hz = mob.z + (dz / d) * varis;

    /* YENILEME KAPISI. Karsilastirma ISTENEN hedefe gore yapilir, bacagin
       KIRPILMIS ucuna gore degil: duvar dibinde nav yolu kisaltinca `b.tx`
       istenen noktadan uzak kalir ve "bacak eskidi" sanip her tikte yeni
       kare yayinlardik.
       `kovKurulu` ayrica nav'in HIC yol vermedigi durumu ayirir: hedef
       kipirdamadikca ayni imkansiz noktayi her tikte yeniden sormayiz
       (gezinme.js ayni sorunu YENIDEN_DENE_MS sayaciyla cozuyor; burada
       sayaca gerek yok cunku oyuncu kipirdayinca kapi zaten aciliyor). */
    const onceki = mob.kovHedef;
    const kaydi = onceki ? Math.hypot(onceki.x - hx, onceki.z - hz) : Infinity;
    const yenile = kaydi > KOVALAMA_YENILE_U || (!mob.bacak && mob.kovKurulu);
    if (yenile && varis > 0.05) {
      const mv = bacakKur(mob, zoneId, hx, hz, hiz, this.#kovalamaNav());
      mob.kovHedef = { x: hx, z: hz };
      mob.kovKurulu = !!mv;
      if (mv) {
        /* `gez` AYNASI - world.js #varlikPayload'in `moving` alani icin.
           `bas`/`bit` de yaziliyor: gezinme.tik ayni alani okuyor ve
           bir gecis aninda bu bacak elinde kalirsa NaN uretmesin. */
        const uz = Math.hypot(mv.tx - mv.fx, mv.tz - mv.fz);
        mob.gez = {
          fx: mv.fx, fz: mv.fz, tx: mv.tx, tz: mv.tz, hiz,
          bas: Date.now(), bit: Date.now() + Math.round(uz / hiz * 1000),
          kov: true,
        };
        this.broadcast(zoneId, 'entity.move', {
          id: mob.id,
          fx: +mv.fx.toFixed(2), fz: +mv.fz.toFixed(2), fy: +(mv.fy ?? 0).toFixed(2),
          tx: +mv.tx.toFixed(2), tz: +mv.tz.toFixed(2), speed: hiz,
        }, null);
      } else {
        /* nav hicbir yon vermedi (duvar dibi): bacak kurulmadi, mob bekler.
           Leash kapisi zaten bir sonraki tiklerde devreye girer. */
        mob.gez = null;
      }
    }

    if (mob.bacak) {
      bacakIlerlet(mob, zoneId, this.tickMs, this.world.groundY);
      if (!mob.bacak) mob.gez = null;   // vardi/engellendi -> istemci de idle'a doner
    }
  }

  /**
   * KOVALAMA NAV'I - `yurunebilir` kancasinin NULL-DONUS YEDEGI.
   *
   * KANIT (bulgular_hizli, agro alani son bulgu): #kovala kancaya TAM
   * bagimliydi - `!this.yurunebilir` ise erken cikiyordu ve kanca gecersiz
   * bir nokta dondururse bacakKur `yol.x` okurken patlar, #tik'in try/catch'i
   * o turdaki TUM bolgeleri atlatirdi. Sonuc: mob agro alir ama YURUYEMEZ
   * (video kaniti b: vurulan mob saldirganina donup KOVALAMALI).
   *
   * Yedek davranis UYDURMA DEGIL - server.js yurunebilirNokta'nin kendi
   * nav'siz dali ile birebir ayni: `if (!nav) return { x: x1, z: z1 }`
   * (server.js:244-245). Yani kanca yok/bozuksa hedefe duz cizgi kirpilir;
   * bacakIlerlet Y'yi zaten tohumlu izliyor. Kanca saglikli bir nokta
   * dondurdugu surece davranis birebir eski davranistir.
   */
  #kovalamaNav() {
    return (zid, x0, z0, x1, z1, y0) => {
      const r = this.yurunebilir ? this.yurunebilir(zid, x0, z0, x1, z1, y0) : null;
      return (r && Number.isFinite(r.x) && Number.isFinite(r.z)) ? r : { x: x1, z: z1 };
    };
  }

  /** Kovalama bacagini ve `moving` aynasini birakir. */
  #kovalamaBirak(mob) {
    if (mob.gez?.kov) mob.gez = null;
    mob.kovHedef = null;
    mob.kovKurulu = false;
    bacakDurdur(mob);
  }

  /* ==================================================== EVE YURUYEREK DONUS
   * KAYNAK: GERCEK/gereksinim_leash_yuruyerek_2026-09-04.md
   *
   * REFERANS PAKET KANITI (changelog 0021, "Fixed" blogu - dosyalar
   * GUNCEL-2026-09-02/assets/changelog/0021-combos-keep-their-damage-*.md):
   *   tr: "vazgecip dogdugu yere donen bir canavar yolda hasar almaz, ama
   *        oyun bunu hic soylemiyordu ... Artik canavarin dondugunu soyluyor
   *        ve pesinden kosmayi birakiyor."
   *   en: "a monster that gave up and RAN BACK to its spawn is INVULNERABLE
   *        on the way home"
   * Yani referansta da (1) donus bir HAREKETTIR (isinlanma degil) ve
   * (2) yolda dokunulmazlik VARDIR. Donus HIZI icin referansta sayisal bir
   * karsilik YOKTUR - gereksinimin dedigi gibi mobun kendi runSpeedU'su
   * kullaniliyor, uydurma bir sabit konmuyor.
   *
   * ESKI DAVRANIS (kusur): leash asilinca `mob.x = mob.evX; mob.z = mob.evZ`
   * + `entity.teleport` -> istemcide canavar YOK OLUP uzakta beliriyordu
   * ("bambaska yerde sifirdan doguyor" sikayeti).
   *
   * YENI DAVRANIS:
   *   1. Hedef birakilir; saldiranlarin angajmani kesilir ve
   *      err.combat.target_returning gider; tehdit defteri temizlenir
   *      (bu kisim ESKI koddan AYNEN tasindi - changelog 0021 tr:18 paritesi).
   *   2. Mob "donuyor" durumuna gecer ve ev noktasina YURUR: mevcut
   *      #kovala/bacak.js altyapisi menzil=0 ile cagrilir, yani hedef
   *      dogrudan evX/evZ olur ve hiz mob.def.runSpeedU'dur.
   *   3. Donus boyunca: agro almaz, saldirmaz, HASAR ALMAZ.
   *      - agro/saldiri: #canavarYZ donus dalinda `continue` ediyor,
   *      - hasar: #saldiriBasla + #hasarUygula kapilari (oyuncunun kendi
   *        yolu) ve BURADAKI HP DONDURMASI - HP'yi bu dosyanin DISINDAN
   *        dusuren moduller (sistem_beceri.js vb. bu seride degil) icin
   *        kemer; dusen deger her tikte geri yazilir.
   *   4. Eve varinca HP tam dolar (eskiden ISINLANMA aninda doluyordu).
   *   5. Guvenlik agi: nav hic yol vermiyorsa / mob sikismissa (ilerleme
   *      olcusu) SON CARE isinlanma + log.
   */

  /**
   * GM ayari "Canavar takip siniri" (birim).
   * 0 / tanimsiz / gecersiz -> SINIRSIZ (varsayilan sapma).
   * Deger CANLI GCFG'den okunur (this.ayar) - panelden degisince yeniden
   * baslatma gerekmez.
   */
  #takipSiniri() {
    const v = Number(this.ayar?.canavarTakipSiniriU);
    return (Number.isFinite(v) && v > 0) ? v : 0;
  }

  /** Mob yuvasinin (ev noktasi + yuva yaricapi) DISINDA mi? */
  #evdenUzakMi(mob) {
    if (!Number.isFinite(mob?.evX) || !Number.isFinite(mob?.evZ)) return false;
    /* Esik = yuvanin KENDI iki yaricapinin buyugu (world.js:562):
         evYaricap    = Tab_RefNest.nRadius        -> gezinme siniri
         evDogYaricap = Tab_RefNest.nGenerateRadius -> DOGUS dagilimi
       Ikisi ayni sey degil ve 16.563 yuvanin 1.506'sinda dogus yaricapi
       gezinme yaricapindan BUYUK; yalniz evYaricap kullanilsaydi bu
       yuvalarda taze dogan canavar dogar dogmaz "evimden uzagim" deyip
       merkeze yurumeye baslardi. Alt sinir EV_VARIS_U: yaricapi 0 olan
       yuvalarda varis toleransi kadar sapma "evde degil" sayilmasin. */
    const esik = Math.max(mob.evYaricap ?? 0, mob.evDogYaricap ?? 0, EV_VARIS_U);
    const dx = mob.x - mob.evX, dz = mob.z - mob.evZ;
    return dx * dx + dz * dz > esik * esik;
  }

  /** Hedefi birakip "eve yuruyerek donus" durumunu baslatir. */
  #eveDonusBaslat(zoneId, z, mob, simdi) {
    /* PP MADDE 7a (changelog 0021 tr:18): "vazgecip dogdugu yere donen bir
       canavar ... Artik canavarin dondugunu soyluyor ve pesinden kosmayi
       birakiyor." Canavari birakip evine donerken hala saldiran herkese acik
       mesaj gider ve angajmanlari kesilir (yoksa oto-saldiri mobu yolda
       yeniden kovalayip sonsuz dongu kurar). Sht enum'unda ozel kod yok ->
       genel ERR_VALIDATION (dogus korumasi kalibi); anahtar tr.json s.141
       err.combat.target_returning = "Bu canavar savasi birakti ve dogdugu
       yere donuyor." */
    for (const p of z.players) {
      if (p.savas?.hedefId !== mob.id) continue;
      p.savas = null;
      if (p.isAuthed) this.#hata(p, 'ERR_VALIDATION', 'err.combat.target_returning');
    }
    mob.hedefEntityId = null;
    /* TEHDIT TEMIZLIGI (bulgular recetesi 6): eve donuste defter sifirlanir. */
    mob.tehdit?.clear();
    mob.zorlaHedef = null;
    this.#kovalamaBirak(mob);          // kovalama bacagi gecersiz
    this.gezinme?.iptal(mob, simdi);   // bosta gezinme bacagi gecersiz

    mob.donuyor = true;
    mob.donusHp = mob.hp;              // yolda hasar almaz - HP burada donar
    mob.donusBas = simdi;
    mob.donusEnYakinD = Math.hypot(mob.x - mob.evX, mob.z - mob.evZ);
    mob.donusIlerlemeAn = simdi;
    /* Ilk bacak AYNI tikte kurulsun: aksi halde mob bir tik boyunca hareketsiz
       durur ve istemci onu "duruyor" olarak cizer. */
    this.#eveDonusTik(zoneId, mob, simdi);
  }

  /** "donuyor" durumundaki mobun tek tiklik isi. */
  #eveDonusTik(zoneId, mob, simdi) {
    /* (a) HASAR ALMAZ - bu dosyanin disindan gelen HP dususu geri alinir.
       Kapali dongu: mob.hp donusHp'nin ALTINA inemez. */
    if (Number.isFinite(mob.donusHp) && mob.hp < mob.donusHp) {
      mob.hp = mob.donusHp;
      mob.tehditHpIzi = mob.hp;   // dis-hasar izleyicisi bunu hasar sanmasin
      this.broadcast(zoneId, 'entity.hp',
        { id: mob.id, hp: Math.round(mob.hp), maxHp: mob.maxHp }, null);
    }

    const dx = mob.evX - mob.x, dz = mob.evZ - mob.z;
    const d = Math.hypot(dx, dz);

    // (b) EVE VARDI -> tam can, durum kapanir. ISINLANMA YOK.
    if (!(d > EV_VARIS_U)) { this.#eveVardi(zoneId, mob); return; }

    /* (c) Hiz verisi yoksa mob YURUYEMEZ (158 mobun 6'sinda runSpeedU yok,
       walkSpeedU'ya duser; o da yoksa hicbir sey). Bu, gereksinimdeki
       "nav basarisiz/tikali + hedefsiz" halinin ozel bir durumudur. */
    const hiz = mob.def?.runSpeedU || mob.def?.walkSpeedU || 0;
    if (!(hiz > 0)) { this.#eveIsinla(zoneId, mob, 'yurume hizi verisi yok'); return; }

    /* (d) GUVENLIK AGI - ILERLEME OLCUSU (bkz. DONUS_TIKANMA_MS).
       Yuruyen mob her tikte `hiz * tickMs/1000` birim yol alir; eve olan
       uzaklik bu yolun YARISI kadar bile azalmiyorsa ilerleme yok demektir. */
    const tikYolu = hiz * (this.tickMs / 1000);
    if (d < (mob.donusEnYakinD ?? Infinity) - tikYolu * 0.5) {
      mob.donusEnYakinD = d;
      mob.donusIlerlemeAn = simdi;
    } else if (simdi - (mob.donusIlerlemeAn ?? simdi) > DONUS_TIKANMA_MS) {
      this.#eveIsinla(zoneId, mob,
        `nav yol vermedi / sikisti (${DONUS_TIKANMA_MS} ms ilerleme yok, ev ${d.toFixed(1)}u)`);
      return;
    }

    /* (e) YURU. #kovala menzil=0 ile cagrildiginda varis noktasi TAM olarak
       ev noktasi olur (varis = d - 0*0.9 = d) ve hiz mobun kendi
       runSpeedU'sudur; bacak kuruldugunda TEK entity.move yayinlanir. */
    this.#kovala(zoneId, mob, d, 0, dx, dz, 1);
  }

  /** Eve YURUYEREK varis: tam can + durumun kapanmasi (teleport YOK). */
  #eveVardi(zoneId, mob) {
    mob.hp = mob.maxHp;
    mob.tehditHpIzi = mob.maxHp;   // tam-can dis-hasar izleyicisine hasar gibi gorunmesin
    this.#kovalamaBirak(mob);
    this.#donusuBitir(mob);
    this.broadcast(zoneId, 'entity.hp', { id: mob.id, hp: mob.hp, maxHp: mob.maxHp }, null);
  }

  /** SON CARE: yol tikali kaldi -> eski isinlanma davranisi + log. */
  #eveIsinla(zoneId, mob, sebep) {
    mob.x = mob.evX; mob.z = mob.evZ;
    /* MADDE 7 - TOHUM: 4. arguman verilmezse kopru/platform ustundeki canavar
       eve donerken ALT KATA duser (server.js:139 zoneGroundY tohumsuz cagrida
       arazi yuksekligini tohum yapiyor). */
    mob.y = this.world.groundY(zoneId, mob.x, mob.z, mob.y);
    mob.hp = mob.maxHp;
    mob.tehditHpIzi = mob.maxHp;
    this.#kovalamaBirak(mob);
    this.gezinme?.iptal(mob, Date.now());
    this.#donusuBitir(mob);
    this.log(`[eve-donus] guvenlik agi: ${mob.def?.id ?? mob.modelKey ?? mob.id} `
      + `(${zoneId}) eve ISINLANDI - ${sebep}`);
    this.broadcast(zoneId, 'entity.teleport', { id: mob.id, x: mob.x, z: mob.z, y: mob.y }, null);
    this.broadcast(zoneId, 'entity.hp', { id: mob.id, hp: mob.hp, maxHp: mob.maxHp }, null);
  }

  /** Donus durum alanlarini temizler (varis, isinlanma, olum). */
  #donusuBitir(mob) {
    mob.donuyor = false;
    mob.donusHp = null;
    mob.donusBas = null;
    mob.donusEnYakinD = null;
    mob.donusIlerlemeAn = null;
  }

  // ------------------------------------------------------------- yenilenme
  #yenilenme(zoneId, z, simdi) {
    const r = this.combat.regen;
    for (const ws of z.players) {
      if (!ws.isAuthed || ws.char?.dead) continue;
      const savasta = ws.savas || (simdi - (ws.sonHasar ?? 0) < r.outOfCombatMs);
      if (savasta) continue;
      if (simdi - (ws.sonRegen ?? 0) < 1000) continue;
      ws.sonRegen = simdi;
      const d = this.combat.turetilmis(ws.char);
      const yeniHp = Math.min(d.maxHp, (ws.char.hp ?? 0) + Math.ceil(d.maxHp * r.hpPctPerSec));
      const yeniMp = Math.min(d.maxMp, (ws.char.mp ?? 0) + Math.ceil(d.maxMp * r.mpPctPerSec));
      if (yeniHp !== ws.char.hp || yeniMp !== ws.char.mp) {
        ws.char.hp = yeniHp; ws.char.mp = yeniMp;
        this.frame(ws, 'vitals.update', { hp: yeniHp, mp: yeniMp });
      }
    }
  }

  #respawn(zoneId) {
    const dirilen = this.world.respawnTik(zoneId);
    if (!dirilen.length) return;
    /* MADDE 48 + fark 189: eskiden `broadcast(zoneId,'state.delta',{add},null)`
       ile TUM bolgeye MESAFE SUZGECI OLMADAN gonderiliyor ve `ws.gorunen`
       GUNCELLENMIYORDU -> uzakta dirilen canavar istemciye ekleniyor ama
       gorunen'de olmadigi icin ilgiGuncelle onu bir daha ASLA rem edemiyor
       (rem kosulu `gorunen.has(id)`) = KALICI HAYALET VARLIK.
       Ayrica yuk ELDEN yaziliyordu ve rarity / scalePct / npcId / moving
       alanlarini DUSURUYORDU. world.respawnYayini ucunu birden cozer:
       ilgi suzgeci + gorunen guncellemesi + tam #varlikPayload. */
    /* world.respawnYayini yoksa HICBIR kare gonderilmez ve bu DOGRUDUR:
       varlik artik `dead:false` oldugu ve ceset temizligi onu `gorunen`den
       cikardigi icin ilgiGuncelle (her tik yuruyen, 3 tikte bir duran
       oyuncu icin) onu zaten `add` olarak yollar. Eski broadcast'e DUSMEK
       hayalet varlik hatasini geri getirirdi. */
    const yayin = this.world.respawnYayini?.(zoneId, dirilen);
    if (!yayin?.length) return;
    for (const { ws, add } of yayin) this.frame(ws, 'state.delta', { add });
  }
}
