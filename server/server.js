/**
 * Tarayici MMO sunucusu.
 *
 *   HTTP  -> istemciyi (../client) statik servis eder + /api/v1 REST
 *   WS    -> oyun protokolu (opcode 16..244, JSON cerceve {t,d,q})
 *
 * Baslatma:  node server.js       (veya ..\BASLAT.bat)
 * Ayarlar :  config.json
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
/* util.format: console.log'un kendi bicimlendiricisi. Kalici gunluk kopyasi
   konsolda GORUNEN metnin AYNISINI diske yazsin diye kullaniliyor - elle
   String(a).join(' ') yapmak nesneleri '[object Object]'e cevirirdi. */
import util from 'node:util';
/* pipeline: `src.pipe(dst)` hedef erken kapandiginda KAYNAGI yok etmez -
   yarida kesilen indirmede fs okuma handle'i kalici sizar (olcum icin
   govdeGonder'deki nota bak). pipeline erken kapanmayi hata sayip zincirdeki
   TUM akislari destroy eder. */
import { pipeline } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';
import { C2S, S2C, emptyEquip, derivedStats } from './protocol.js';

/* chat.recv (160) `ch` alaninin izinli degerleri - istemci semasindan birebir:
   qJ([`local`,`global`,`party`,`guild`,`system`])  (index-BUMMQVRB.js @25624521).
   c2s chat.send (64) ise yalnizca local|global|party|guild gonderebiliyor. */
const KANALLAR = new Set(['local', 'global', 'party', 'guild']);
import { loadHeights, groundY, sampleY, yuzeyIndeksi, suTabaniKur } from './terrain.js';
import { loadNav, yuruYolu, daireHareket, cozNokta, yaricapAyarla, yaricapAl } from './nav.js';
import { bacakKur, bacakIlerlet, bacakPayload, bacakDurdur, KAYMALI } from './bacak.js';
import { validateCreate, startingEquip, raceOfStyle, genderOfStyle, raceList } from './charcreate.js';
import { createAuthRoutes } from './routes_auth.js';
import { buildCommands, handleGmChat } from './gm.js';
import { createAdmin } from './admin.js';
import { createKarakterPaneli } from './admin_karakter.js';
import { createMallPaneli } from './admin_mall.js';
import { createBildirimPaneli } from './admin_bildirim.js';
import { toOyun } from './db.js';
import { World } from './world.js';
import { Combat } from './combat.js';
import { Gezinme } from './gezinme.js';
import { GameLoop } from './gameloop.js';
import { girisAkisi, batchZarfi, envClockKare, GUN_HIZI } from './giris.js';
import { kurBolgeGecisi } from './bolge.js';
import { createKalicilik } from './kalicilik.js';
import * as esya from './esya.js';


const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.join(HERE, '..', 'client');
const DATA = path.join(HERE, 'data');

/* ================================================== KALICI CALISMA GUNLUGU
 * SORUN (olculdu): sunucunun TEK gunluk kanali stdout idi. `..\BASLAT.bat`
 * yalnizca `node server.js` diyor, ciktiyi YONLENDIRMIYOR - yani BASLAT.bat
 * ile (ya da herhangi bir baska kabuktan) acilan orneğin logu SADECE kendi
 * konsol penceresinde kaliyordu. Diskteki SON\server.log ise yalnizca
 * ciktisini elle `> server.log` ile yonlendiren orneğe aitti.
 *
 * SONUCU: "log temiz" iddiasi ancak yonlendirmeyi yapan kisinin KENDI orneği
 * icin dogrulanabiliyordu. Baska birinin baslattigi ornek (olculdu: PID 23976
 * @23:14 ve PID 37524 @23:28) kara kutuydu; kapanis dogrulamasi da, testlerin
 * hangi surece vurdugu da sabit bir hedefe oturtulamiyordu.
 *
 * COZUM: gunluk kanalini BASLATMA BICIMINDEN BAGIMSIZ kil. Surec kendi log
 * dosyasini kendisi acar. Ayrica console.log/warn/error uclerine ayni dosyaya
 * yazan bir KOPYA takilir - boylece alt modullerin ciktisi da diske duser
 * (orn. admin_bildirim.js'in varsayilan `log = console.log` parametresi).
 * stdout kanali oldugu gibi kalir: mevcut `> server.log` yonlendirmeleri ve
 * konsol takibi aynen calismaya devam eder, bu bir EK kanaldir.
 *
 * writeSync + acik fd bilerek secildi: WriteStream tamponu surec cokerken
 * bosalmayabilir, o zaman da tam ihtiyac duyulan SON satir kaybolur.
 * writeSync isletim sistemi onbellegine aninda yazar (fsync yok, maliyeti
 * yok) - surec olse bile satir diskte kalir. */
const LOG_KLASORU = path.join(HERE, '..', 'loglar');
const CALISMA_KIMLIGI = path.join(LOG_KLASORU, 'calisan-sunucu.json');

/** Calisan orneğin KODUNUN parmak izi. Ornek baslatildiktan sonra server.js
 *  degistiyse surec ESKI kodu kosuyor demektir (olculdu: PID 37524 23:28'de
 *  basladi, server.js 00:19'da degisti). Kapanis dogrulamasi bunu bilmeden
 *  yapilirsa diskteki surumu degil, calisan bambaska bir surumu dogrular. */
const KOD_SHA = (() => {
  try {
    return crypto.createHash('sha256')
      .update(fs.readFileSync(fileURLToPath(import.meta.url)))
      .digest('hex').slice(0, 12);
  } catch { return 'bilinmiyor'; }
})();

/** Bu kosunun log dosyasi. Ad ISO damgasiyla basladigi icin duz metin
 *  siralamasi = zaman siralamasi (asagidaki budama buna dayaniyor). */
const LOG_DOSYASI = (() => {
  try {
    fs.mkdirSync(LOG_KLASORU, { recursive: true });
    /* Kosu gunlukleri sinirsiz birikmesin - en yeni 20 kosu tutulur. */
    const eskiler = fs.readdirSync(LOG_KLASORU)
      .filter((n) => /^sunucu-.+\.log$/.test(n)).sort();
    for (const n of eskiler.slice(0, Math.max(0, eskiler.length - 19))) {
      try { fs.unlinkSync(path.join(LOG_KLASORU, n)); } catch { /* kilitli olabilir */ }
    }
    const damga = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    return path.join(LOG_KLASORU, `sunucu-${damga}-pid${process.pid}.log`);
  } catch { return null; }
})();

const LOG_FD = (() => {
  try { return LOG_DOSYASI ? fs.openSync(LOG_DOSYASI, 'a') : null; }
  catch { return null; }
})();

/** Gunluk yazimi ASLA sunucuyu dusurmemeli: her hata yutulur, konsol kanali
 *  zaten ayakta kalir. */
const gunlugeYaz = (seviye, metin) => {
  if (LOG_FD === null) return;
  try {
    /* log() satirin basina zaten "SS:DD:SS " koyuyor; dosyada TAM ISO damgasi
       kullandigimiz icin o tekrari kirp - tarih dosyada, saat konsolda. */
    const govde = metin.replace(/^\d{2}:\d{2}:\d{2} /, '');
    fs.writeSync(LOG_FD, `${new Date().toISOString()} [${seviye}] ${govde}\n`);
  } catch { /* disk dolu / fd kapali - sessizce vazgec */ }
};

/* console uclerine kopya tak. Orijinal referans saklanir ve override'in
   ICINDE asla console.* cagrilmaz - yoksa sonsuz dongu olurdu. */
for (const [ad, seviye] of [['log', 'log'], ['warn', 'uyari'], ['error', 'hata']]) {
  const asil = console[ad].bind(console);
  console[ad] = (...a) => { asil(...a); gunlugeYaz(seviye, util.format(...a)); };
}

/* Node'un varsayilan cokme yazicisi DOGRUDAN stderr'e basar, console.error'dan
   GECMEZ - yani yukaridaki kopya onu yakalamaz ve cokme sebebi diske hic
   dusmez. Bu yuzden acikca ele aliniyor. Davranis korunur: bu iki olayda
   surec eskiden de oluyordu (Node varsayilani exit 1); tek fark, artik
   nedeni log dosyasinda duruyor. */
const olumcul = (tur) => (e) => {
  gunlugeYaz('olumcul', `${tur}: ${e?.stack || e}`);
  try { process.stderr.write(`${tur}: ${e?.stack || e}\n`); } catch { /* yok */ }
  process.exit(1);
};
process.on('uncaughtException', olumcul('yakalanmamis-istisna'));
process.on('unhandledRejection', olumcul('ele-alinmamis-red'));

/** Calisan ornek kaydi: KIM calisiyor, NEREYE log yaziyor, HANGI kodu kosuyor.
 *  Kapanis dogrulamasini yapan kisi orneği kendisi baslatmamis olsa bile
 *  calisan surecin gunlugunu bu dosyadan bulur. */
const kimlikYaz = (adres) => {
  try {
    fs.mkdirSync(LOG_KLASORU, { recursive: true });
    fs.writeFileSync(CALISMA_KIMLIGI, JSON.stringify({
      pid: process.pid,
      baslangic: new Date().toISOString(),
      adres,
      log: LOG_DOSYASI,
      kodSha: KOD_SHA,
      node: process.version,
    }, null, 2));
  } catch (e) { gunlugeYaz('uyari', `calisan-sunucu.json yazilamadi: ${e.message}`); }
};

/** YALNIZ kendi kaydimizi sileriz. Sonradan baslamis baska bir orneğin
 *  kaydini silmek onu tekrar gorunmez yapardi - duzeltilen sorunun ta kendisi. */
const kimlikSil = () => {
  try {
    if (JSON.parse(fs.readFileSync(CALISMA_KIMLIGI, 'utf8')).pid === process.pid)
      fs.unlinkSync(CALISMA_KIMLIGI);
  } catch { /* dosya yok ya da bizim degil - dokunma */ }
};

/** pid hala yasiyor mu? Sinyal 0 sureci OLDURMEZ, yalniz varligini sorar;
 *  EPERM = surec var ama bize ait degil, yani yine yasiyor. */
const surecYasiyor = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (e) { return e?.code === 'EPERM'; }
};

/** Bu surec baslarken diskte duran onceki ornek kaydi (varsa). */
const ONCEKI_ORNEK = (() => {
  try { return JSON.parse(fs.readFileSync(CALISMA_KIMLIGI, 'utf8')); }
  catch { return null; }
})();

process.on('exit', kimlikSil);
/* SIGTERM/SIGBREAK Windows'ta her zaman tetiklenmez; dinlemek zararsiz ve
   tetiklendiginde kapanis sebebi gunluge duser. */
for (const sinyal of ['SIGINT', 'SIGTERM', 'SIGBREAK']) {
  process.on(sinyal, () => {
    console.log(`${sinyal} alindi - sunucu kapaniyor (PID ${process.pid})`);
    process.exit(0);
  });
}

const CFG = JSON.parse(fs.readFileSync(path.join(HERE, 'config.json'), 'utf8'));
/** Istemcinin GOMULU zone katalogundan cikarilmis gercek meta veri.
 *  kind/name uydurulmaz - istemci ne diyorsa o. Yanlis kind gonderilirse
 *  arayuz yanlis bolge tipini gosterir. */
const ZONES = JSON.parse(fs.readFileSync(path.join(HERE, 'zones.json'), 'utf8'));
/** Istemcinin gomulu dunya katalogu: gercek spawn noktalari, 137 NPC yerlesimi,
 *  29 isinlanma noktasi. Hicbiri uydurulmadi - extract_world.py ile cikarildi. */
const WORLD = JSON.parse(fs.readFileSync(path.join(HERE, 'world.json'), 'utf8'));
const CHARMAP = JSON.parse(fs.readFileSync(path.join(HERE, 'charmap.json'), 'utf8'));
const ITEMMAP = JSON.parse(fs.readFileSync(path.join(HERE, 'itemmap.json'), 'utf8'));
/**
 * OYUN AYARLARI - referans oyunun KENDI config/game-config.json'i.
 * Istemci paketinde `Fst` nesnesi olarak gomulu duruyor ve orada
 *   gameConfig = PY(vat, Fst, "config/game-config.json")
 * ile oyunun ayar nesnesi oluyor. Kendi yorumu: "Global gameplay tunables."
 * Buradaki hicbir sayi bizim tarafimizdan secilmedi - hepsi paketten cikarildi.
 * Elle yazilmis sabitler yerine DAIMA bunu kullan.
 */
const GCFG = JSON.parse(fs.readFileSync(path.join(HERE, 'data', 'game-config.json'), 'utf8'));
let AUTH = null;   // routes_auth - SQL baglaninca kurulur

/* ============================================================ PROTOKOL SEMASI
 * data/schemas.json istemci paketinden cikarilmis protokol dokumudur
 * (196 mesaj, 102'si c2s). Cekirdegin buradan okudugu IKI sey var ve ikisi de
 * UYDURULMUYOR - dogrudan paketten cikan dosyadan turetiliyor:
 *
 * 1) HIZ SINIFI (rateClass) - referans oyunun protokol kaydinin 4. parametresi:
 *        T$(name, id, schema, rateClass)                    (paket @25603840)
 *    102 c2s mesajinin TAMAMI etiketli: opcode 16..126 arasi 100 mesaj +
 *    auth(1) + ping(2). Sinif adetleri (paket sayimi = schemas.json sayimi,
 *    birebir dogrulandi):
 *        misc 27, exchange 16, inv 15, trade 9, shop 7, combat 6, stall 6,
 *        progression 5, move 4, quest 3, chat 2, auth 1, ping 1.
 *    ping'in KENDI sinifi olmasi onemli: istemci kalp atisini 2000 ms'de bir
 *    gonderiyor (paket @27536663 LLt = 2e3), yani ping butcesi diger
 *    trafikten AYRI tutulmali.
 *
 * 2) KAPALI ENUM'LAR - err(240).code, err(240).key, sys.notice(195).key,
 *    kick(241).reason. Enum disi deger gondermek SESSIZ KAYIP demek:
 *      - gecersiz err.code: istemci `err.<code>` yerellestirmesini bulamayip
 *        ekrana HICBIR SEY basmaz, yalnizca console.warn eder (@27135789)
 *      - gecersiz sys.notice anahtari: sohbete  ⟦anahtar⟧  copu duser (@25546596)
 *    Bu yuzden asagidaki hata()/bildir() yardimcilari her degeri bu
 *    kumelere karsi dogrular.
 */
const SEMALAR = JSON.parse(fs.readFileSync(path.join(HERE, 'data', 'schemas.json'), 'utf8'));
/** schemas.json enum'lari ya duz dizi ya {__tip__:'enum', __degerler__:[...]}. */
const enumDegerleri = (a) => (Array.isArray(a) ? a
  : Array.isArray(a?.__degerler__) ? a.__degerler__ : []);
/** mesajAdi -> rateClass. Map: istemciden gelen ham `t` ile prototip
 *  kirlenmesi olmasin ("constructor" gibi adlar duz nesnede truthy doner). */
const RATE_CLASS = new Map(Object.entries(SEMALAR.mesajlar ?? {})
  .filter(([, m]) => m?.yon === 'c2s' && typeof m?.rateClass === 'string')
  .map(([ad, m]) => [ad, m.rateClass]));
/** Paketteki 13 sinif - hiz siniri ayarlarinin gecerli anahtar kumesi. */
const RATE_SINIFLARI = Object.freeze([...new Set(RATE_CLASS.values())].sort());
const ERR_KODLARI          = new Set(enumDegerleri(SEMALAR.mesajlar?.err?.alanlar?.code));           // 43
const ERR_ANAHTARLARI      = new Set(enumDegerleri(SEMALAR.mesajlar?.err?.alanlar?.key));            // 80
const BILDIRIM_ANAHTARLARI = new Set(enumDegerleri(SEMALAR.mesajlar?.['sys.notice']?.alanlar?.key)); // 130 + 'raw'
const KICK_SEBEPLERI       = new Set(enumDegerleri(SEMALAR.mesajlar?.kick?.alanlar?.reason));        // 7

/* Yerellestirme = hangi kodun EKRANDA gorunecegi. Istemci once `key`i,
   yoksa `err.<code>`u ariyor; ikisi de tr.json'da yoksa satir HIC cikmiyor
   (paket @27135789: `b2(v_r) && pushSys(v_r, v_n)`). Asagidaki kume o
   "sessiz" kodlari CALISMA ZAMANINDA tr.json'dan cikarir - elle liste
   tutmuyoruz ki yerellestirme buyudukce kendiliginden kucusun. */
const YERELLESTIRME = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(CLIENT, 'assets', 'locales', 'tr.json'), 'utf8')); }
  catch { return null; }
})();
const ERR_SESSIZ_KODLAR = new Set(
  YERELLESTIRME ? [...ERR_KODLARI].filter(k => !(`err.${k}` in YERELLESTIRME)) : []);




/** Arazi yuksekligi: y=0 gonderirsek oyuncu zeminin ALTINDA kalir ve dunya
 *  bombos gorunur. heights.bin'den gercek zemini orneklyoruz. */
/* Yuzey indeksi onbellegi - nav.bin ucgenlerinden bir kez kurulur. */
const yuzeyOnbellek = new Map();
function zoneYuzeyler(zoneId) {
  if (yuzeyOnbellek.has(zoneId)) return yuzeyOnbellek.get(zoneId);
  const nav = loadNav(CLIENT, zoneId);
  const idx = nav?.surfaces?.length ? yuzeyIndeksi(nav.surfaces) : null;
  yuzeyOnbellek.set(zoneId, idx);
  if (idx) log(`${zoneId}: ${idx.tris.length} zemin ucgeni (nav.bin yuzeyleri)`);
  return idx;
}

/**
 * Durma yuksekligi = arazi + nav.bin YUZEY AGLARI (cesme kenari, merdiven,
 * platform...). Eskiden sadece heights.bin ornekleniyordu; oyuncu bu
 * yapilarin ALTINDAKI arazi seviyesine dusuyordu ("yerin dibine giriyorum").
 * oncekiY, hangi KAT'ta oldugunu belirler (kopru altı / ustu).
 */
function zoneGroundY(zoneId, x, z, oncekiY) {
  const h = loadHeights(CLIENT, zoneId);
  if (!h) return 0;
  const idx = zoneYuzeyler(zoneId);
  if (!idx) return groundY(h, x, z);
  return sampleY(h, idx, x, z, oncekiY ?? groundY(h, x, z)).y;
}

/**
 * Hareketi navmesh'e karsi dogrular.
 * Istemci sadece HEDEF noktayi yolluyor; engelin neresi oldugunu sunucu bulur.
 * Bu olmadan oyuncu duvarlarin ve binalarin icinden gecer.
 */
/**
 * Baslangictan hedefe yurunebilen en uzak nokta.
 * baslangicY: oyuncunun SU ANKI yuksekligi. Zemin ornekleme (hangi kat) ve
 * egim/basamak siniri buna gore hesaplanir - istemci de boyle yapiyor.
 */
/* ======================================================================
 * BOLGE TANIMI - egim siniri + su tabani + sinirlar TEK KAYNAKTAN.
 *
 * ONCEKI HATA (kritik): hem zoneSuTabani hem zoneEgim
 *      const z = ZONES[zoneId] || WORLD.zones?.[zoneId]
 * yaziyordu. ZONES (server/zones.json) girdisi TRUTHY ama yalnizca
 * {id,name,kind,bounds,bin} tasiyor; `||` kisa devre yaptigi icin
 * WORLD.zones (slopeLimitUpPerU = 1000, water = 68..141 dikdortgen)
 * HIC OKUNMUYORDU. Sonuclari:
 *   - nav.js EGIM_VARSAYILAN = 1.2 kullaniyordu; bolgenin gercek degeri
 *     1000, yani istemcinin 833 KATI ALTI bir sinir. 0.30'luk normal bir
 *     merdiven basamagi bile yolu kesiyordu ("takilip buga giriyorum").
 *   - `water` bos dizi olarak geliyordu -> suTabaniKur() hic kurulmuyordu ->
 *     oyuncu suyun dibine yuruyordu (istemci kiyida durur).
 *
 * COZUM: `||` (nesne bazli) yerine ALAN BAZLI birlestirme. Sira:
 *      WORLD.zones[z]?.alan  ??  ZONES[z]?.alan  ??  GCFG.alan
 * Istemci de ayni sirayi kullaniyor (paket @25660600):
 *      this.slopeUp = v_n?.slopeLimitUpPerU ?? J$.gameConfig.slopeLimitUpPerU
 *      this.bounds  = v_n?.boundsU ?? null
 * ====================================================================== */
/** bounds'u tek bicime cevirir: dizi [minX,maxX,minZ,maxZ] ya da nesne. */
function sinirNormal(b) {
  if (!b) return null;
  if (Array.isArray(b)) {
    return (b.length === 4 && b.every(Number.isFinite))
      ? { minX: b[0], maxX: b[1], minZ: b[2], maxZ: b[3] } : null;
  }
  return Number.isFinite(b.minX) ? b : null;
}

const bolgeTanimOnbellek = new Map();
function bolgeTanimi(zoneId) {
  if (bolgeTanimOnbellek.has(zoneId)) return bolgeTanimOnbellek.get(zoneId);
  const W = WORLD.zones?.[zoneId];
  const Z = ZONES[zoneId];
  const t = {
    id: zoneId,
    name: W?.name ?? Z?.name ?? zoneId,
    kind: W?.kind ?? Z?.kind ?? 'field',
    egimUp:   W?.slopeLimitUpPerU   ?? Z?.slopeLimitUpPerU   ?? GCFG.slopeLimitUpPerU,
    egimDown: W?.slopeLimitDownPerU ?? Z?.slopeLimitDownPerU ?? GCFG.slopeLimitDownPerU,
    overrides: W?.slopeOverrides ?? Z?.slopeOverrides ?? [],
    water: W?.water ?? Z?.water ?? [],
    /* boundsU ASIL kaynak (paket zone JSON'u; istemci @25660600
       `this.bounds = v_n?.boundsU ?? null`). `bounds` world.json/zones.json'un
       turetilmis bicimi - world.json'da nesne, zones.json'da
       [minX,maxX,minZ,maxZ] DIZISI; ikisi de tek bicime cevrilir. */
    boundsU: sinirNormal(W?.boundsU ?? Z?.boundsU ?? W?.bounds ?? Z?.bounds),
    playerSpawn: W?.playerSpawn ?? Z?.playerSpawn ?? null,
    respawnPoint: W?.respawnPoint ?? Z?.respawnPoint ?? W?.playerSpawn ?? null,
  };
  bolgeTanimOnbellek.set(zoneId, t);
  return t;
}

/* Su tabani onbellegi - bolge basina bir kez kurulur (tembel siniflandirmali). */
const suTabanOnbellek = new Map();
function zoneSuTabani(zoneId) {
  if (suTabanOnbellek.has(zoneId)) return suTabanOnbellek.get(zoneId);
  const h = loadHeights(CLIENT, zoneId);
  const su = bolgeTanimi(zoneId).water;
  const f = h && su.length ? suTabaniKur(h, su) : null;
  suTabanOnbellek.set(zoneId, f);
  if (f) log(`${zoneId}: ${su.length} su alani (taban kisiti aktif)`);
  return f;
}

/** Bolgenin egim ayari - paketteki zone tanimindan (slopeLimit*PerU + slopeOverrides). */
function zoneEgim(zoneId) {
  const t = bolgeTanimi(zoneId);
  return { up: t.egimUp, down: t.egimDown, overrides: t.overrides };
}

/** nav.js'in isteyecegi hareket baglami (istemcideki `vec3`). */
function hareketBaglami(zoneId, y) {
  return {
    y,
    ornekY: (px, pz, oncekiY) => zoneGroundY(zoneId, px, pz, oncekiY),
    egim: zoneEgim(zoneId),
    taban: zoneSuTabani(zoneId) ?? undefined,
  };
}

function yurunebilirNokta(zoneId, x0, z0, x1, z1, baslangicY) {
  const nav = loadNav(CLIENT, zoneId);
  if (!nav) return { x: x1, z: z1, engellendi: false };
  return yuruYolu(
    nav, x0, z0, x1, z1,
    (px, pz, oncekiY) => zoneGroundY(zoneId, px, pz, oncekiY),
    undefined, baslangicY, zoneEgim(zoneId), zoneSuTabani(zoneId),
  );
}

/* ---------------------------------------------------------------------
 * OYUNCU HAREKETI (tik basina kayma) - istemcinin advanceSelf'i ile PARITE.
 *
 * Istemci kendi karakterini her KAREDE moveCircle ile yuruyor (@25673731):
 * duvara degen adimi en fazla 4 kez disari itip duvar boyunca KAYDIRIYOR.
 * Sunucu ise duz cizgi uzerinde ilk engelde duruyordu ve o kisa hedefi
 * entity.move ile istemciye ZORLA kabul ettiriyordu (applyMove @25663224
 * istemcinin hedefini sunucununkiyle degistirir) - kose donmek isteyen
 * oyuncu duvara carpip duruyordu.
 *
 * Artik sunucu da tik basina ayni moveCircle'i calistiriyor; hedef KIRPILMIYOR,
 * iki taraf ayni algoritmayla ayni yolu kayarak yuruyor.
 * bacak.js bu iki yardimciyi `yurunebilir.hareket` / `.hedefCoz` uzerinden bulur.
 * ------------------------------------------------------------------- */
yurunebilirNokta.hareket = function (zoneId, x0, z0, y0, x1, z1, enFazla) {
  const nav = loadNav(CLIENT, zoneId);
  if (!nav) {
    const d = Math.hypot(x1 - x0, z1 - z0);
    const t = d > 0 ? Math.min(1, enFazla / d) : 0;
    return { x: x0 + (x1 - x0) * t, z: z0 + (z1 - z0) * t, y: y0, engellendi: false };
  }
  return daireHareket(nav, { x: x0, z: z0 }, { x: x1, z: z1 }, enFazla,
                      yaricapAl(), hareketBaglami(zoneId, y0));
};

/** Tiklanan hedefi collider disina it - istemcinin resolveWalkTarget'i
 *  (@25673000) once boundsU'ya kirpiyor, sonra resolvePoint uyguluyor.
 *  Kirpma kismi move.click kapilarina ait; burada yalniz resolvePoint. */
yurunebilirNokta.hedefCoz = function (zoneId, x, z, y) {
  const nav = loadNav(CLIENT, zoneId);
  if (!nav) return { x, z };
  return cozNokta(nav, x, z, y, yaricapAl());
};

fs.mkdirSync(DATA, { recursive: true });
const STORE = path.join(DATA, 'accounts.json');
const db = fs.existsSync(STORE)
  ? JSON.parse(fs.readFileSync(STORE, 'utf8'))
  : { accounts: {}, characters: {}, nextEntityId: 1000 };
const save = () => fs.writeFileSync(STORE, JSON.stringify(db, null, 2));

/** Oyuncu varlik id sayaci - RAM'de yeter, kalici olmasi gerekmiyor. */
let entitySayaci = 1000;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const now = () => Date.now();

/* Carpisma yaricapini gameConfig'ten besle. Istemci her moveCircle/isBlocked
   cagrisinda `Y$`i (= gameConfig.entityRadiusU) kullaniyor (@8489012); bizde
   nav.js'te 0.5 SABIT idi, admin panelinden deger degistiginde takip etmiyordu.
   loadNav'dan ONCE cagrilmali - izgara hucreleri yaricap payiyla kuruluyor. */
yaricapAyarla(GCFG.entityRadiusU);

/* BOLGE TANIMI DOGRULAMA LOGU - `||` kisa devresi yuzunden egim siniri ve su
   alanlari HIC okunmuyordu; bir daha sessizce ayrismasin diye acilista basiyoruz.
   `up` burada 1.2 gorunuyorsa birlestirme yine bozulmus demektir (gercek: 1000). */
for (const zid of Object.keys(WORLD.zones ?? {})) {
  const t = bolgeTanimi(zid);
  log(`bolge ${zid}: egim up=${t.egimUp} down=${t.egimDown} ` +
      `override=${t.overrides.length} su=${t.water.length} ` +
      `sinir=${t.boundsU ? 'var' : 'YOK'} dogusY=${t.playerSpawn?.y ?? 'YOK'} ` +
      `yaricap=${yaricapAl()}`);
}

/* TIK SAYACI - istemcinin zaman ekseni buradan cikiyor.
   Istemci (paket index-BUMMQVRB.js @625770):
       tickTime(t)  = serverTime0 + (t - tick0) * (1000 / gameConfig.tickHz)
       tick0/serverTime0 = zone.init'teki tick / serverTime
   Sayaci setInterval'de ++ yaparsak Node'un zamanlayici sapmasi birikip
   tick*100 ile duvar saatini ayirir; bu yuzden DUVAR SAATINDEN turetiyoruz.
   Boylece tickTime(tik()) her zaman ~now() verir (en fazla 1 tik sapma).
   game-config.json tickHz = 10 -> config.json tickMs = 100 (zaten esit). */
const TIK_BASI = Date.now();
const tik = () => Math.floor((Date.now() - TIK_BASI) / CFG.world.tickMs);
const uid = () => crypto.randomUUID();
const hash = (p) => crypto.createHash('sha256').update(p + '::son').digest('hex');

/** Dunya motoru + savas: veriye dayali, data/ altindaki JSON'lardan beslenir. */
const WORLDSIM = new World({
  dataDir: DATA, zones: ZONES, worldData: WORLD, groundY: zoneGroundY, log,
  /* madde 49: dogus/respawn noktasi nav.bin'e karsi dogrulanir. Ayni
     fonksiyon zaten GEZINME'ye veriliyor (asagida new Gezinme). Fonksiyon
     bildirimi oldugu icin burada guvenle referans verilebilir. */
  yurunebilir: yurunebilirNokta,
  /* Ceset suresi (corpseDespawnMs) GM panelinden degisince aninda uygulansin
     diye CALISAN GCFG nesnesinin REFERANSI - kopya degil (admin.js
     sunucu-ayarlari.json farklarini GCFG uzerine yaziyor). */
  gcfg: GCFG,
  /* MADDE 62 (capraz istek 35): canavar varlik yukune `statuses` alani.
     Fonksiyon bildirimi hoisted - burada guvenle referans verilebilir. */
  sistemOrnegi,
});
const COMBAT = new Combat({ dataDir: DATA, world: WORLDSIM, log });
/* esya.js itemstats.json'i ctx'siz cagiranlar (charcreate.js) icin tembel
   yukluyor; ayni haritayi baglayinca ~2860 kayitlik IKINCI kopya olusmaz.
   Baglanmasa da her sey calisir - yalniz bellek tasarrufu (madde 26 notu). */
esya.katalogBagla(COMBAT.itemStats);

/** Turetilmis degerler artik combat.js'ten - protocol.js'teki eski
 *  yaklasik formul degil. (L1 STR20 -> maxHp 200, 480 degil.) */
const derived = (ch) => COMBAT.turetilmis(ch);
/* GM ADMIN PANELI - /admin sayfasi + /api/v1/admin/* uclari.
   referans oyunun game-config.json'i ASLA yazilmaz; degisiklikler
   data/sunucu-ayarlari.json'da tutulur ve calisan GCFG'ye uygulanir. */
const ADMIN = createAdmin({
  dataDir: DATA, GCFG, log,
  ctx: {
    world: WORLDSIM,
    /** Cevrimici oyuncular - zones kumesinden. */
    cevrimiciListe: () => {
      const out = [];
      try {
        for (const [zid, set] of zones) {
          for (const c of set) {
            if (!c.isAuthed || !c.char) continue;
            out.push({
              ad: c.char.name, seviye: c.char.level, bolge: zid,
              x: Math.round(c.char.x), z: Math.round(c.char.z),
              hp: Math.round(c.char.hp), maxHp: derived(c.char).maxHp,
              gm: !!(c.user?.sec_primary === 1 && c.user?.sec_content === 1),
            });
          }
        }
      } catch { /* zones henuz yok */ }
      return out;
    },
    /** Tum sunucuya duyuru - sistem kanalindan. */
    duyuru: (metin) => {
      try {
        /* SEMA: chat.recv (160) = { ch, from, text, fromTier? }.
           Alan adi `ch` - `channel` DEGIL.
           DENETIM DUZELTMESI: burada "istemcinin Zod dogrulamasindan
           gecemiyor" yaziyordu, bu YANLIS. Istemci GELEN kareyi HIC
           dogrulamiyor - kodek duz JSON (`bht = { encode: JSON.stringify,
           decode: JSON.parse }`) ve onFrame -> dispatch -> invoke zinciri
           payload'i isleyiciye oldugu gibi veriyor; T$ tablosundaki `schema`
           alani gelen yolda KULLANILMIYOR. Gercek etki: sistem duyurusu
           `ch: undefined` ile geliyordu, sistem paneli `m.ch === 'system'`
           filtresini kullandigi icin (paket, HRt bileseni) duyuru sistem
           panelinde HIC gorunmuyor, bunun yerine normal sohbetin "all"
           sekmesine sizyordu. */
        for (const [zid] of zones) broadcast(zid, 'chat.recv', { ch: 'system', from: 'Sistem', text: metin });
      } catch { /* yok */ }
    },
    sorgu: (tur, like) => adminSorgu(tur, like),
    hesapGuncelle: (JID, g) => adminHesapGuncelle(JID, g),
    /* Tum bolgelere ayni kareyi yollar - duyuru bicimleri buradan gecer
       (chat.recv 160 ve sys.notice 195). */
    yayin: (t, d) => { try { for (const [zid] of zones) broadcast(zid, t, d); } catch { /* zones yok */ } },
  },
  uygula: (g) => {
    /* Canli etki: oranlar ve kosu hizi. Acilista LOOP henuz tanimli
       olmadigi icin (TDZ) erisim korumali.
       NOT: asagidaki uc atama artik CANLI YOL DEGIL - combat.js
       etkinOranlar() zaten world.gcfg'yi (= bu `g`) once okuyor. Atamalar
       yalnizca YEDEK alani (this.oranlar, game-config.json anlik goruntusu)
       GCFG ile es tutar; world/gcfg baglanmadan kurulan Combat ornekleri
       (olcum/curut betikleri) icin anlamli. Buraya YENI oran anahtari
       EKLEMEK GEREKMEZ: itemDropRate ve muhur kademeleri hic yazilmadigi
       halde canli calisir - eskiden acilis logunun yalan soylemesinin
       nedeni de tam olarak bu asimetriydi. */
    if (COMBAT?.oranlar) {
      COMBAT.oranlar.xpRate = g.xpRate; COMBAT.oranlar.spRate = g.spRate;
      COMBAT.oranlar.goldRate = g.goldRate;
    }
    /* madde 13: `LOOP.oyuncuHizi = g.playerMoveSpeedU` satiri KALDIRILDI.
       oyuncuHizi artik fonksiyon ve GCFG'yi her cagrida CANLI okuyor; admin
       panelinden ayar degisince ek is gerekmiyor. Sabit sayiyi geri yazmak
       binek/buff carpanini SESSIZCE oldururdu. */
    /* Moduller ayarlari kur() aninda kopyalayabiliyor - yeniden kurup
       taze degerleri okumalarini saglariz. Sunucu yeniden baslatilmaz. */
    try { if (typeof sistemleriKur === 'function') sistemleriKur(true); } catch { /* henuz yok */ }
  },
});

/* ORAN ACILIS LOGU - BURADA, createAdmin(...)'DAN SONRA basilir. Cunku
   createAdmin ic tazele()'si data/sunucu-ayarlari.json farklarini CALISAN
   GCFG nesnesine yazar; ganimet()/odul() dusus aninda o canli GCFG'yi okur.
   Log eskiden combat.js kurucusunda (bu satirin ~60 satir YUKARISINDA calisan
   `new Combat`) basiliyordu ve yalnizca game-config.json anlik goruntusunu
   gosteriyordu: sealMoonRate=6 uygulanirken "gumus x1" yaziyordu. Satir
   COMBAT.etkinOranlar() uzerinden gectigi icin artik gercekten uygulanan
   carpanlari gosterir. TASIMA: yeni bir ayar kaynagi eklenirse bu cagri hep
   EN SON ayar yazicisindan sonra kalmali. */
COMBAT.oranlariLogla();

/* Karakter paneli: kusam / canta / banka / pet gorunumu ve duzenleme.
   Ayri dosya (admin_karakter.js) - ayar paneli bir DB hatasindan etkilenmesin. */
const KARAKTER = createKarakterPaneli({
  dataDir: DATA, GCFG, log,
  ctx: {
    world: WORLDSIM,
    frame, broadcast,
    derived, envanterPayload,
  },
});

/* Item Mall editoru (ayri dosya: admin_mall.js). Katalog iki kopya halinde
   yasiyor - data/items.json.itemMall (tahsilat) + istemci paketindeki gomulu
   vct literali (gorunum/buton kontrolu); kaydet ikisini AYNI istekte yazar,
   sonra sistemleriKur(true) ile RESTARTSIZ canli etki (admin.js `uygula`
   kalibiyla ayni; sistemleriKur fonksiyon bildirimi oldugundan buradan
   cagrilabilir). */
const MALL_PANEL = createMallPaneli({
  dataDir: DATA, clientDir: CLIENT, log,
  canliTazele: () => sistemleriKur(true),
});

/* Hata bildirimleri + ozellik istekleri (ayri dosya: admin_bildirim.js).
   Oyun ici "Hata Bildir" penceresi BU sunucuya POST atiyor (istemci paketi
   J5.submitBugReport -> '/api/v1/bug-reports'); disari, referans oyuna ya da
   herhangi bir ucuncu tarafa HICBIR baglanti yok. Modul hem kayit yolunu
   (dosya logu + SRO_WEB_GAME) hem GM paneli uclarini tasir; kendi SQL
   havuzunu acar (admin_karakter.js kalibi) - ana havuz dusse de panel
   ayakta kalir. */
const BILDIRIM = createBildirimPaneli({ dataDir: DATA, clientDir: CLIENT, log });


/* ---------------------------------------------------------- ADMIN DB yardimcilari
 * Panelin hesap/karakter listeleri. `pool` (SRO_VT_SHARD) SQL baglaninca dolar.
 * GM yetkisi ve ban SRO_VT_ACCOUNT.TB_User uzerinden yonetilir. */
async function adminSorgu(tur, like) {
  if (!pool || !sql) return { hata: 'veritabani yok' };
  const A = CFG.sql.databases.account, S = CFG.sql.databases.shard;
  try {
    if (tur === 'hesaplar') {
      const r = await pool.request().input('q', sql.VarChar(64), like).query(`
        SELECT TOP 50 u.JID, u.StrUserID, u.sec_primary, u.sec_content,
               (SELECT COUNT(*) FROM ${S}.dbo._User cu
                JOIN ${S}.dbo._Char c ON c.CharID = cu.CharID AND c.Deleted = 0
                WHERE cu.UserJID = u.JID AND c.CharID > 0) AS karakterSayisi
        FROM ${A}.dbo.TB_User u
        WHERE u.StrUserID LIKE @q OR CAST(u.JID AS varchar(20)) LIKE @q
        ORDER BY u.JID`);
      return { satirlar: r.recordset.map(x => ({
        JID: x.JID, kullanici: x.StrUserID, karakter: x.karakterSayisi,
        gm: x.sec_primary === 1 && x.sec_content === 1,
      })) };
    }
    if (tur === 'karakterler') {
      const r = await pool.request().input('q', sql.VarChar(64), like).query(`
        SELECT TOP 50 c.CharID, c.CharName16, c.CurLevel, c.RemainGold,
               c.LatestRegion, c.Deleted, u.UserJID
        FROM ${S}.dbo._Char c
        LEFT JOIN ${S}.dbo._User u ON u.CharID = c.CharID
        WHERE c.CharID > 0
          AND (c.CharName16 LIKE @q OR CAST(c.CharID AS varchar(20)) LIKE @q)
        ORDER BY c.CharID`);
      return { satirlar: r.recordset.map(x => ({
        CharID: x.CharID, ad: x.CharName16, seviye: x.CurLevel,
        altin: Number(x.RemainGold), bolge: x.LatestRegion,
        silinmis: !!x.Deleted, JID: x.UserJID ?? null,
      })) };
    }
  } catch (e) { return { hata: String(e.message).slice(0, 160) }; }
  return { hata: 'bilinmeyen sorgu' };
}

/** GM yetkisi ver/al, ban. Degisiklik ANINDA gecerli (gmTazele 5 sn onbellek). */
async function adminHesapGuncelle(JID, g) {
  if (!pool || !sql) return { error: 'veritabani yok' };
  const A = CFG.sql.databases.account;
  try {
    if (g.gm !== undefined) {
      const v = g.gm ? 1 : 0;
      await pool.request().input('j', sql.Int, JID).input('v', sql.TinyInt, v)
        .query(`UPDATE ${A}.dbo.TB_User SET sec_primary = @v, sec_content = @v WHERE JID = @j`);
    }
    return { ok: true };
  } catch (e) { return { error: String(e.message).slice(0, 160) }; }
}

/** Savas/YZ/ganimet dongusu - frame ve broadcast asagida tanimli. */
let LOOP = null;

// ---------------------------------------------------------------- SQL (istege bagli)
let sql = null, pool = null, refItems = [], refMobs = [];
/** SRO_WEB_GAME havuzu - sistem modullerinin kalicilik katmani (sistemCtx.web). */
let WEBPOOL = null;
/* Envanter kaliciligi (canta + kusam) - SQL baglaninca kurulur. */
let KALICI = null;
function envanterKaydet(ch) { return KALICI ? KALICI.kaydet(ch) : Promise.resolve(false); }
async function initSql() {
  if (!CFG.sql?.enabled) { log('SQL kapali (config.json -> sql.enabled)'); return; }
  try {
    sql = (await import('mssql')).default;
    pool = await new sql.ConnectionPool({
      server: CFG.sql.server, user: CFG.sql.user, password: CFG.sql.password,
      database: CFG.sql.databases.shard, options: CFG.sql.options,
    }).connect();
    log('SQL bagli ->', CFG.sql.server, '/', CFG.sql.databases.shard);
    const it = await pool.request().query(
      "SELECT TOP 400 CodeName128, Service FROM _RefObjCommon WHERE CodeName128 LIKE 'ITEM_%' AND Service=1");
    refItems = it.recordset.map(r => r.CodeName128);
    const mb = await pool.request().query(
      "SELECT TOP 400 CodeName128 FROM _RefObjCommon WHERE CodeName128 LIKE 'MOB_%' AND Service=1");
    refMobs = mb.recordset.map(r => r.CodeName128);
    log(`SRO_VT_SHARD referans verisi: ${refItems.length} item, ${refMobs.length} mob`);

    /* WEBPOOL modul duzeyinde: sistem modullerinin KALICILIK katmani buna
       bagli. Eskiden bu havuz initSql icinde `const webPool` olarak yerelde
       kaliyordu ve sistemCtx() herkese `web: null` veriyordu - yani
       hotbar/otoIksir/makro, banka, lonca, gorev, meslek, borsa, tezgah,
       parti... 10 modulun tamami SADECE BELLEKTE calisiyordu ve sunucu
       yeniden baslayinca her sey siliniyordu. */
    WEBPOOL = await new sql.ConnectionPool({
      server: CFG.sql.server, user: CFG.sql.user, password: CFG.sql.password,
      database: CFG.sql.databases.web, options: CFG.sql.options,
    }).connect();
    AUTH = createAuthRoutes({
      web: WEBPOOL, world: WORLD, charmap: CHARMAP, itemmap: ITEMMAP,
      zoneGroundY, cfg: CFG, log,
    });
    log(`${CFG.sql.databases.web} bagli - kimlik/karakter uclari aktif`);

    /* Canta/kusam kaliciligi: WebBank ile AYNI kalip (StackJson).
       Detay ve neden _Inventory kullanilmadigi: kalicilik.js basligi. */
    KALICI = createKalicilik({ web: WEBPOOL, sql, log, bagSlots: GCFG.bagSlots });
    await KALICI.tabloKur();

    /* Havuz hazir: modulleri TAZE ctx ile yeniden kur (artik web dolu).
       Bazi moduller ayrica webBagla(pool) sunuyor - once onu dene ki
       kur() sirasinda kurulmus yerel durum kaybolmasin. */
    let bagli = 0;
    for (const { ad, ornek } of SISTEMLER) {
      if (typeof ornek?.webBagla === 'function') {
        try { ornek.webBagla(WEBPOOL, sql); bagli++; } catch (e) {
          log(`sistem_${ad} webBagla hatasi: ${String(e.message).slice(0, 100)}`);
        }
      }
    }
    const kalan = SISTEMLER.filter(s => typeof s.ornek?.webBagla !== 'function').length;
    if (kalan) sistemleriKur(true);            // webBagla'si olmayanlar icin
    log(`kalicilik: ${bagli} modul webBagla ile, ${kalan} modul yeniden kurularak baglandi`);
  } catch (e) {
    log('SQL baglanamadi (sunucu yine de calisir):', e.message.slice(0, 120));
    pool = null;
  }
}

// ---------------------------------------------------------------- HTTP yardimcilari
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.mjs': 'application/javascript',
  '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.avif': 'image/avif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.glb': 'model/gltf-binary', '.bin': 'application/octet-stream', '.gz': 'application/gzip',
  '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wasm': 'application/wasm',
  '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.md': 'text/markdown; charset=utf-8',
};
const send = (res, code, body, type = 'application/json') => {
  const b = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(code, { 'content-type': type, 'access-control-allow-origin': '*',
    'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS' });
  res.end(b);
};
/* S2 MADDE 3 - 4MB govde siniri. ESKIDEN: sinir asiminda req.destroy()
   sonrasi 'end' hic gelmedigi icin promise COZULMUYORDU - istek yanitsiz
   askida kaliyordu (screenshot'lu, data-URL tasiyan bug raporlari siniri
   asabiliyor). SIMDI: destroy'dan ONCE promise cozulur ve `res` verildiyse
   kisa HTTP 413 {error:'report_too_large'} cevabi basilir (istemci K5 bu
   anahtari taniyor); soket, cevap disari ciktiktan sonra kapatilir.
   SOZLESME: `res` gecen cagiran null donusunu KONTROL ETMELI (413 zaten
   gitti, ikinci cevap yazmamali); res'siz eski cagiranlara {} doner (bos
   govdeyle ayni yol, davranis bozulmaz) ve soket eskisi gibi kapatilir. */
const readBody = (req, res) => new Promise((ok) => {
  let d = '';
  let asildi = false;
  req.on('data', c => {
    if (asildi) return;             // sinir asildi: kalan parcalari yut
    d += c;
    if (d.length > 4e6) {
      asildi = true; d = '';
      if (res && !res.headersSent) {
        res.on('finish', () => req.destroy());   // cevap flush olsun, sonra kes
        send(res, 413, { error: 'report_too_large' });
        ok(null);
      } else {
        ok({});
        req.destroy();
      }
    }
  });
  req.on('end', () => { if (asildi) return; try { ok(d ? JSON.parse(d) : {}); } catch { ok({}); } });
});

// ---------------------------------------------------------------- token
const tokens = new Map();   // jwt -> accountId
const tickets = new Map();  // ticket -> {accountId, charId, exp}
function issueToken(accountId) { const t = uid().replace(/-/g, ''); tokens.set(t, accountId); return t; }
function authOf(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? tokens.get(h.slice(7)) : null;
}

/**
 * Istemci giris sonrasi `res.account.email` okuyor:
 *     Jjt(r.token); ... F$.getState().loggedIn(r.account.email)
 * `account` nesnesi eksik olursa istemci hata atar ve giris ekraninda takilir.
 * emailVerified false birakilirsa istemci "api.email_not_verified" gosterir.
 */
function accountView(a) {
  if (!a) return { account: null };
  return {
    accountId: a.id,
    account: {
      id: a.id, email: a.email, emailVerified: true,
      createdAt: a.createdAt, premiumTier: null, premiumExpiresAt: null, jade: 0,
    },
  };
}

// ---------------------------------------------------------------- karakter
/**
 * `style` istemcinin karakter katalogundaki id ile BIREBIR ayni olmali
 * (client/assets/characters/<style>/ klasoru). Uydurma bir deger verilirse
 * istemci modeli hic istemez ve karakter onizlemesi "yukleniyor..." da takilir -
 * 404 bile gorunmez, cunku istek hic yapilmaz.
 */
const STYLES = {
  'chinese|male':    ['chinaman_adventurer', 'chinaman_bogy', 'chinaman_fighter', 'chinaman_warrior'],
  'chinese|female':  ['chinawoman_adventurer', 'chinawoman_fighter', 'chinawoman_warrior', 'chinawoman_kisaeng'],
  'european|male':   ['europeman_adventurer', 'europeman_knight', 'europeman_warrior', 'europeman_gladiator'],
  'european|female': ['europewoman_adventurer', 'europewoman_knight', 'europewoman_amazoness', 'europewoman_gladiator'],
};
function resolveStyle(race, gender, wanted) {
  const list = STYLES[`${race}|${gender}`] || STYLES['chinese|male'];
  return list.includes(wanted) ? wanted : list[0];
}

/* Bolgenin dogus noktasi. `y` ARTIK TASINIYOR: paketteki bolge JSON'lari
   playerSpawn.y icin gercek deger veriyor (donwhang -12, hotan 37.5,
   europe 12.6, samarkand 27 - GERCEK/paket_veri/zones/*.json). world.json'da
   bu alan dusmustu; geri kondu. y'nin ONEMI: zoneGroundY'ye TOHUM olarak
   verilir, sonuc olarak degil - asagidaki nota bak. */
function spawnPointOf(zoneId) {
  const t = bolgeTanimi(zoneId);
  const p = t.playerSpawn ?? t.respawnPoint;
  return p ? { x: p.x, z: p.z, y: p.y } : { x: CFG.world.startX, z: CFG.world.startZ, y: undefined };
}

/**
 * Y TOHUMU KURALI - elinde YETKILI bir y varsa onu zoneGroundY'ye TOHUM ver,
 * sonuc olarak ATAMA; tohum yoksa arazi kullanilir.
 *
 * NEDEN: terrain.js sampleY bir yuzeyi ancak `yuzeyY <= oncekiY + 0.75` ise
 * kabul ediyor (paket u9e = .75, @8499227). Tohum verilmezse arazi seviyesi
 * tohum olur ve araziden 0.75 birimden yuksek HICBIR yuzey secilemez -
 * kopru/iskele/platform ustundeki oyuncu ALT KATA duser. Alt katta ise
 * Y-bantli collider'larin (%99.997) tamami devre disi kalir: duvarlardan
 * gecme ve "yerin dibine giriyorum" bu zincirden cikiyor.
 * Olcum: hotan respawn tohumsuz -> 34.842, tohum 37.5 -> 36.643.
 */
function zeminTohumlu(zoneId, x, z, ...tohumlar) {
  for (const t of tohumlar) {
    if (typeof t === 'number' && Number.isFinite(t)) return zoneGroundY(zoneId, x, z, t);
  }
  return zoneGroundY(zoneId, x, z);
}

function makeCharacter(accountId, req) {
  const id = uid();
  const sp = spawnPointOf(CFG.world.startZone);
  const ch = {
    id, accountId,
    name: req.name, race: req.race, style: req.style, gender: req.gender,
    armorClass: req.armorClass, weapon: req.weapon,
    level: 1, xp: 0, spExp: 0, sp: 0, statPoints: 0, str: 20, int: 20,
    zone: CFG.world.startZone, x: sp.x, z: sp.z,
    // bolge dogus noktasinin y'si TOHUM (yetkili kat bilgisi), sonuc degil
    y: zeminTohumlu(CFG.world.startZone, sp.x, sp.z, sp.y),
    gold: 10000, createdAt: now(),
    equip: startingEquip(req),          // wNt() ile ayni baslangic ekipmani
    /* D5-C madde 3: 45 YANLISTI - o vSRO _Char.InventorySize varsayilani
       (13 kusam + 32 canta), CANTA yuva sayisi degil. CANTA-12 (sartname
       madde 10): varsayilan 384 = 12 sayfa x 32; istemci sekme sayisini
       ceil(bag.length/32) ile kendisi cizer (paket @19914023), yani 12 sayfa
       icin bundle yamasi gerekmez. Paketteki c2s bagSlot max(159) semalari
       OLU KODDUR - sema YALNIZ sunucuda uygulanir, istemci gonderim/alimda
       runtime dogrulama yapmaz (m$.send semasiz ham JSON); sunucu
       gevsetilirken istemcinin sessiz reddine guvenilemez (madde 19 yorum
       duzeltmesi). SQL kapali moddaki olu dal ama tutarli olsun. */
    bag: new Array(384).fill(null),
  };
  const d = derivedStats(ch);
  ch.hp = d.maxHp; ch.mp = d.maxMp;
  db.characters[id] = ch; save();
  return ch;
}

/**
 * inv.update govdesi: { gold, bag, equip } - self.inventory ile AYNI bicim.
 * Canli referans oyun ganimet alinca tam envanter anligorunumu gonderiyor:
 *   inv.update {"gold":2670,"bag":[...32...],"equip":{...}}
 */
function envanterPayload(ch) {
  return {
    gold: ch.gold ?? 0,
    bag: Array.isArray(ch.bag) ? ch.bag : new Array(GCFG.bagSlots).fill(null),
    equip: (() => {
      const e = emptyEquip();
      for (const [slot, v] of Object.entries(ch.equip ?? {})) {
        if (!v || !(slot in e)) continue;
        e[slot] = typeof v === 'string' ? { itemId: v, qty: 1 } : v;
      }
      return e;
    })(),
  };
}

/* ------------------------------------------------------ MODUL KATKI KANCALARI
 * zone.init.self (_ht) 36 alanli; bunlarin 13'u cekirdegin bilmedigi sistem
 * verisi (ustalik, meslek, ogrenilen beceri, buff/status, bekleme sureleri,
 * lonca, premium, hotbar/otoIksir/makro). Moduller bu alanlari zaten
 * uretiyor ve `selfAlanlari(ch)` / `varlikAlanlari(ch)` olarak DISA
 * ACIYOR - ama server.js bu fonksiyonlari HIC CAGIRMIYORDU. Sonuc:
 * her giriste hotbar bos, lonca yok, ustalik yok, ogrenilen beceri yok...
 * Sema gecerliydi (tipler dogru) o yuzden hicbir hata gorunmuyordu; kare
 * sadece BOS gidiyordu. Bu iki yardimci o kancalari isletir.
 *
 * Ad catismasi olmaz: her modul yalniz kendi alanlarini dondurur ve alan
 * adlari _ht / $mt ile birebir (modul ici yorumlarda belirtilmis). */
function modulKatkisi(kanca, ch) {
  const out = {};
  /* DENETIM: kanca ADI tek degil. Moduller ayni isi iki farkli adla disa
     aciyor - sistem_lonca / sistem_arayuz-durumu `selfAlanlari`,
     sistem_stat-ustalik ise `kendiParcasi` (kendi BAGLAMA NOTU'nda, satir
     ~591, "selfPayload icindeki SABIT masteries: [], knownSkills: []
     satirinin yerine ...STATUST.kendiParcasi(ch)" yaziyor). Yalnizca
     `selfAlanlari` cagrildigi surece ustalik ve ogrenilen beceri listesi
     zone.init.self icinde BOS gidiyordu: sema gecerli ([] hem masteries
     hem knownSkills icin dogru tip) oldugu icin sema testi bunu goremez -
     "isleniyor gorunup aslinda is yapmayan" ayni tuzagin devami. */
  const adlar = Array.isArray(kanca) ? kanca : [kanca];
  // SISTEMLER bu fonksiyondan SONRA tanimli (TDZ); cagri zamani her zaman
  // modul kurulumundan sonradir ama yine de savunmaci davraniyoruz.
  let liste; try { liste = SISTEMLER; } catch { return out; }
  for (const { ad, ornek } of liste ?? []) {
    for (const k2 of adlar) {
      const fn = ornek?.[k2];
      if (typeof fn !== 'function') continue;
      try {
        const k = fn(ch);
        if (k && typeof k === 'object') Object.assign(out, k);
      } catch (e) {
        log(`sistem_${ad}.${k2} hatasi: ${String(e.message).slice(0, 120)}`);
      }
    }
  }
  return out;
}

function selfPayload(ch, entityId) {
  const d = derived(ch);
  const taban = {
    entityId, charId: ch.id, name: ch.name, race: ch.race, style: ch.style, gender: ch.gender,
    /* xpToNext ilerleme tablosundan gelir - 400*level DEGIL.
       Olcum: referans oyun seviye 1 icin 118 veriyor, progress.json da 118 diyor.
       Tablo bitince (maxLevel) null - sema nullable. */
    level: ch.level, xp: ch.xp, xpToNext: COMBAT.progress?.xpToNext?.[ch.level] ?? null,
    spExp: ch.spExp, spExpToNext: 400, sp: ch.sp, statPoints: ch.statPoints,
    str: ch.str, int: ch.int, hp: ch.hp, mp: ch.mp,
    derived: d,
    masteries: [], professions: [], knownSkills: [], buffs: [], statuses: [],
    // inventory.equip: her yuva ya null ya da S$ nesnesi {itemId, qty, ...}
    inventory: {
      gold: ch.gold,
      /* gameConfig.bagSlots = 32 (olctugum deger paketle birebir dogrulandi). */
      bag: Array.isArray(ch.bag) ? ch.bag : new Array(GCFG.bagSlots).fill(null),
      equip: (() => {
        const e = emptyEquip();
        for (const [slot, v] of Object.entries(ch.equip ?? {})) {
          if (!v || !(slot in e)) continue;
          e[slot] = typeof v === 'string' ? { itemId: v, qty: 1 } : v;
        }
        return e;
      })(),
    },
    dead: !!ch.dead,
    /* gameConfig.spawnSafeTimeMs = 20000 (olctugum ~19911 ms ile birebir).
       DEGER ARTIK KARAKTERDEN OKUNUR (ch.safeUntil) - boylece sunucunun
       uyguladigi koruma ile istemcinin gosterdigi cip AYNI ani gosterir.
       Eskiden burada her cagrida yeniden hesaplaniyordu; kare her
       gonderildiginde koruma bastan basliyor gibi gorunuyordu. */
    safeUntil: ch.safeUntil ?? (now() + GCFG.spawnSafeTimeMs),
    /* potionCooldowns KARAKTERDEN okunur - sistem_envanter iksir
       bekletmelerini `ch.potionCooldowns` icinde tam paket biciminde
       ([{group, readyAt}] - sema _ht @25597966) tutuyor ve BAGLAMA
       NOTU'nda (sistem_envanter.js ~607) bunu istiyor. Sabit [] kaldigi
       surece bolge gecisinde / yeniden giriste iksir bekletmesi
       istemcide sifirlaniyordu (sunucu tarafi bekletmeyi uygulamaya
       devam ettigi icin oyuncu "iksir calismiyor" gorurdu). */
    cooldowns: [], actionCooldowns: [],
    potionCooldowns: Array.isArray(ch.potionCooldowns) ? ch.potionCooldowns : [],
    premiumTier: null, premiumExpiresAt: null,
    guild: null, guildPenaltyUntil: null,
    hotbar: null, autoPotion: null, macro: null,
  };
  /* Moduller varsayilanlarin USTUNE yazar (bos taban -> gercek veri). */
  return Object.assign(taban, modulKatkisi(['selfAlanlari', 'kendiParcasi'], ch));
}

function entityPayload(ch, entityId) {
  return {
    ...modulKatkisi('varlikAlanlari', ch),   // lonca etiketi, premium kademesi...
    id: entityId, kind: 'player',
    modelKey: ch.style,
    name: ch.name, x: ch.x, z: ch.z, y: ch.y ?? 0, rotY: 0,
    /* OLU BAYRAGI - SABIT false DEGIL.
       Istemci hareketi VARLIK DEPOSUNDAKI `dead` uzerinden kapatiyor
       (paket @25681891 wgt: `return !vec || vec.dead ? !1 : ...`,
        @25682xxx Egt: `if (!vec || vec.dead) { u1('you_dead'); return }`,
        @25685442 Ugt: `if (!vec || vec.dead || ...) return`).
       Burasi hep false gonderdigi icin olum perdesi acikken bile oyuncu
       tiklayarak her yeri geziyordu. Olum perdesi AYRI bir kaynaktan
       (combat.death + self.dead) besleniyor, o yuzden celiski gorunmuyordu. */
    level: ch.level, hp: ch.hp, maxHp: derived(ch).maxHp, dead: !!ch.dead,
    /* `moving` olmadan, yururken gorus alanina giren bir oyuncu karsi tarafta
       DURUYOR gorunur (istemci addEntity: path yalnizca moving'den kurulur).
       world.js canavarlar icin bunu zaten yapiyordu, oyuncularda eksikti. */
    ...(bacakPayload(ch) ? { moving: bacakPayload(ch) } : {}),
    // appearance.equip: Record<slot, itemId>. Kayit hem duz string hem
    // {itemId} nesnesi olabiliyor (SQL'den string, olusturmada nesne).
    appearance: {
      style: ch.style,
      equip: Object.fromEntries(
        Object.entries(ch.equip ?? {})
          .filter(([, v]) => v)
          .map(([k, v]) => [k, typeof v === 'string' ? v : v.itemId])),
    },
  };
}

/**
 * Bolgenin NPC ve isinlanma varliklarini uretir.
 * Konumlar istemcinin kendi katalogundan; y arazi yuksekliginden hesaplanir.
 * entityId'ler oyunculardan ayrilsin diye 1..99999 araligindan negatif tarafta degil,
 * ayri bir sayacla veriliyor.
 */
let npcEntitySeq = 500000;
const npcCache = new Map();
function zoneNpcEntities(zoneId) {
  if (npcCache.has(zoneId)) return npcCache.get(zoneId);
  const z = WORLD.zones[zoneId];
  const out = [];
  if (z) {
    /* Y VE ROTY VERIDEN GELIR - HESAPLANMAZ.
       referans oyunun zone tanimlarindaki npcs[] kayitlarinda opsiyonel `y` ve `rotY`
       alanlari var (137 NPC'nin 122'sinde y, 137'sinde rotY). Uretici bunlari
       yutuyordu; biz de y'yi zoneGroundY ile HESAPLIYORDUK. Ornek fark:
       npc_ch_warehouse gercek y = -4.864, bizim hesap -7.61 -> NPC yere gomuluyordu.
       Ayrica y'si olan her kayitta rotY 0'a ezilmisti, yani NPC'ler yanlis yone
       bakiyordu. Kayitta y yoksa zemine oturt; sonuc 0 ise alani hic gonderme
       (istemci `vec.y ?? 0` yapiyor, sonuc ayni - canli referans oyun de boyle davraniyor:
       npc_ch_smith kaydinda y alani YOK). */
    const yAlani = (v) => (v === 0 ? {} : { y: v });
    for (const n of z.npcs ?? []) {
      const def = WORLD.npcCatalog[n.npcId];
      if (!def) continue;
      out.push({
        id: ++npcEntitySeq, kind: 'npc', modelKey: def.modelKey, name: def.name,
        x: n.x, z: n.z,
        ...yAlani(n.y ?? zoneGroundY(zoneId, n.x, n.z)),
        rotY: n.rotY ?? 0,
        npcId: n.npcId,
      });
    }
    for (const t of z.teleporters ?? []) {
      out.push({
        id: ++npcEntitySeq, kind: 'npc', modelKey: t.modelKey, name: t.name || t.id,
        x: t.x, z: t.z,
        // `||` idi: y === 0 olan kayitlarda sessizce hesaplanana dusuyordu
        ...yAlani(t.y ?? zoneGroundY(zoneId, t.x, t.z)),
        rotY: t.rotY ?? 0,
        /* `tp_` ONEKI ZORUNLU - uydurma degil, istemcinin kapisi.
           Kgt (index-BUMMQVRB.js @25685670) bir NPC'yi ancak soyle
           isinlayici sayiyor:
             if (node.npcId?.startsWith(`tp_`)) {
               ... zonesById.get(zoneId)?.teleporters.find(t => t.id === node.npcId.slice(3))
             }
           Ayrica imlec de ayni kapiya bakiyor (dgt, @25678584):
             node.npcId?.startsWith(`tp_`) ? `teleport` : `talk`
           Onek OLMADAN istemci isinlanma penceresini HIC ACMIYORDU, yani
           `teleport.use` (82) hic gonderilmiyor, dolayisiyla `zone.transfer`
           (132) da hic uretilmiyordu. Sunucu tarafi oneki geri soyuyor
           (sistem_donus-isinlanma.js: ham.startsWith('tp_') -> slice(3)). */
        npcId: `tp_${t.id}`,
      });
    }
  }
  npcCache.set(zoneId, out);
  return out;
}

// ---------------------------------------------------------------- REST
const VERSION = '1.0.0-son';
async function rest(req, res, url) {
  const p = url.pathname;
  if (req.method === 'OPTIONS') return send(res, 204, '');

  // ---- kimlik / karakter: tamami SRO_WEB_GAME yordamlari uzerinden -------
  if (p.startsWith('/api/v1/auth/') || p === '/api/v1/characters' ||
      p.startsWith('/api/v1/admin/') ||
      /^\/api\/v1\/characters\/[^/]+/.test(p)) {
    if (!AUTH) return send(res, 503, { error: 'Veritabani baglanmadi' });
    const acc = AUTH.authOf(req);

    if (p === '/api/v1/auth/register' && req.method === 'POST') {
      const r = await AUTH.register(await readBody(req), req); return send(res, r.code, r.body);
    }
    if (p === '/api/v1/auth/login' && req.method === 'POST') {
      const r = await AUTH.login(await readBody(req), req); return send(res, r.code, r.body);
    }
    if (p === '/api/v1/auth/session' && req.method === 'POST') {
      const r = await AUTH.session(await readBody(req)); return send(res, r.code, r.body);
    }
    if (p === '/api/v1/auth/logout' && req.method === 'POST') {
      const r = await AUTH.logout(await readBody(req), req); return send(res, r.code, r.body);
    }
    if (p === '/api/v1/auth/forgot/question' && req.method === 'POST') {
      const r = await AUTH.forgotQuestion(await readBody(req)); return send(res, r.code, r.body);
    }
    if (p === '/api/v1/auth/forgot/reset' && req.method === 'POST') {
      const r = await AUTH.forgotReset(await readBody(req)); return send(res, r.code, r.body);
    }
    if (p === '/api/v1/auth/me') {
      if (!acc) return send(res, 401, { error: 'unauthorized' });
      return send(res, 200, { accountId: acc.JID, userId: acc.userId,
                              isGm: await AUTH.gmTazele(acc.JID) });
    }

    if (!acc) return send(res, 401, { error: 'unauthorized' });

    /* --------------------------------------------------------- GM ADMIN
       Yetki: hesabin isGm bayragi (TB_User.sec_primary/sec_content). */
    if (p.startsWith('/api/v1/admin/')) {
      /* GM yetkisi CANLI okunur - DB'de rutbe verilince cikip girmek gerekmez. */
      const gm = await AUTH.gmTazele(acc.JID);
      if (!gm) return send(res, 403, { error: 'GM yetkisi gerekli' });
      if (p === '/api/v1/admin/ayarlar' && req.method === 'GET')
        return send(res, 200, ADMIN.listele());
      if (p === '/api/v1/admin/ayarlar' && req.method === 'POST') {
        const r = ADMIN.kaydet(await readBody(req));
        return send(res, r.code, r.body);
      }
      if (p === '/api/v1/admin/durum' && req.method === 'GET')
        return send(res, 200, ADMIN.durum());
      if (p === '/api/v1/admin/hesaplar' && req.method === 'GET')
        return send(res, 200, await ADMIN.hesaplar(url.searchParams.get('q') || ''));
      if (p === '/api/v1/admin/karakterler' && req.method === 'GET')
        return send(res, 200, await ADMIN.karakterler(url.searchParams.get('q') || ''));
      if (p === '/api/v1/admin/hesap' && req.method === 'POST') {
        const r = await ADMIN.hesapGuncelle(await readBody(req));
        return send(res, r.code, r.body);
      }
      if (p === '/api/v1/admin/duyuru' && req.method === 'POST') {
        const r = ADMIN.duyuru(await readBody(req));
        return send(res, r.code, r.body);
      }
      if (p === '/api/v1/admin/duyuru-secenekleri' && req.method === 'GET')
        return send(res, 200, ADMIN.duyuruSecenekleri());
      /* --- karakter paneli: kusam / canta / banka / pet + duzenleme --- */
      if (p === '/api/v1/admin/karakter' && req.method === 'GET')
        return send(res, 200, await KARAKTER.detay(url.searchParams.get('id')));
      if (p === '/api/v1/admin/karakter' && req.method === 'POST') {
        const r = await KARAKTER.guncelle(await readBody(req));
        return send(res, r.code, r.body);
      }
      if (p === '/api/v1/admin/esya' && req.method === 'GET')
        return send(res, 200, KARAKTER.esyaAra(url.searchParams.get('q') || '', {
          tur: url.searchParams.get('tur') || null,
          irk: url.searchParams.get('irk') || null,
          derece: url.searchParams.get('derece') || null,
          limit: url.searchParams.get('limit') || null,
        }));
      /* --- item mall editoru: katalog + dogrulamali cift-kopya kayit --- */
      if (p === '/api/v1/admin/mall' && req.method === 'GET')
        return send(res, 200, await MALL_PANEL.listele());
      if (p === '/api/v1/admin/mall' && req.method === 'POST') {
        const r = await MALL_PANEL.kaydet(await readBody(req));
        return send(res, r.code, r.body);
      }
      /* --- hata bildirimleri + ozellik istekleri (admin_bildirim.js) ---
         Hepsi bu GM kapisinin (AUTH.gmTazele) ARKASINDA: yukarida gm
         dogrulanmadan bu bloga girilemiyor. Ekran goruntusu de dahil -
         raporlarda oyuncunun ekrani var, GM olmayan goremez. */
      if (p === '/api/v1/admin/bildirimler' && req.method === 'GET') {
        await BILDIRIM.otoAktar();      // eski gunluk satirlari BIR KEZ tasinir
        return send(res, 200, await BILDIRIM.listele({
          tur: url.searchParams.get('tur'),
          kategori: url.searchParams.get('kategori'),
          durum: url.searchParams.get('durum'),
          onem: url.searchParams.get('onem'),
          q: url.searchParams.get('q'),
          bas: url.searchParams.get('bas'), bit: url.searchParams.get('bit'),
          sayfa: url.searchParams.get('sayfa'),
          /* `limit` panelin gonderdigi ad, `adet` REST tarafinin adi. */
          adet: url.searchParams.get('adet') ?? url.searchParams.get('limit'),
        }));
      }
      /* Ozet ucu IKI ADLA da yanit verir: panel (client/admin.html) tekil
         '/bildirim-ozet' cagiriyor, REST'in geri kalani cogul kaliba
         ('/bildirimler') uyuyor. Ikisi de ayni govdeyi dondurur - panelin
         acilistaki rozet istegi bir ad farkindan sessizce dusmesin. */
      if ((p === '/api/v1/admin/bildirim-ozet' || p === '/api/v1/admin/bildirimler-ozet')
          && req.method === 'GET') {
        await BILDIRIM.otoAktar();
        return send(res, 200, await BILDIRIM.ozet());
      }
      if (p === '/api/v1/admin/bildirimler-ice-aktar' && req.method === 'POST')
        return send(res, 200, await BILDIRIM.iceAktar());
      /* Gorsel ucu detay ucundan ONCE eslesmeli - yoksa ':ref' deseni
         '<ref>/gorsel' yolunu da yutar. */
      let mb = p.match(/^\/api\/v1\/admin\/bildirimler\/([0-9a-f]{4,16})\/gorsel$/);
      if (mb && req.method === 'GET') {
        const g = await BILDIRIM.gorsel(mb[1]);
        if (!g) return send(res, 404, { hata: 'görsel yok' });
        /* Icerik SUNUCUDA calistirilmaz. Tur uzantidan degil ICERIKTEN
           (PNG/JPEG sihirli bayti) belirlenir - hem yazarken hem okurken -
           ve `nosniff` ile tarayicinin tahmin yurutmesi kapatilir; bu yuzden
           `inline` guvenli ve panelin onizlemesi icin gerekli. Dosya adi
           ref'ten uretildi (kullanici girdisi ada girmiyor). */
        res.writeHead(200, {
          'content-type': g.mime,
          'content-length': g.veri.length,
          'x-content-type-options': 'nosniff',
          'content-disposition': `inline; filename="${g.ad}"`,
          'cache-control': 'private, max-age=300',
        });
        res.end(g.veri);
        return true;
      }
      mb = p.match(/^\/api\/v1\/admin\/bildirimler\/([0-9a-f]{4,16})$/);
      if (mb && req.method === 'GET')
        return send(res, 200, await BILDIRIM.detay(mb[1]));
      if (mb && req.method === 'POST') {
        const r = await BILDIRIM.durumGuncelle(mb[1], await readBody(req), acc.JID);
        return send(res, r.code, r.body);
      }
      if (mb && req.method === 'DELETE') {
        const r = await BILDIRIM.sil(mb[1]);
        return send(res, r.code, r.body);
      }
      if (p === '/api/v1/admin/sifirla' && req.method === 'POST') {
        const r = ADMIN.sifirla();
        return send(res, r.code, r.body);
      }
      return send(res, 404, { error: 'not_found' });
    }

    if (p === '/api/v1/characters' && req.method === 'GET')
      /* Istemciye DIZI bicimli equip gider (onizleme bileseni iterable bekliyor);
         bilet/oyun ici temsil KAYIT olarak kalir - bkz. routes_auth.equipDizisi. */
      return send(res, 200, { characters: await AUTH.listCharactersClient(acc) });

    if (p === '/api/v1/characters' && req.method === 'POST') {
      const r = await AUTH.createCharacter(acc, await readBody(req));
      return send(res, r.code, r.body);
    }

    let m2 = p.match(/^\/api\/v1\/characters\/([^/]+)\/enter$/);
    if (m2 && req.method === 'POST') {
      const list = await AUTH.listCharacters(acc);
      const ch = list.find(c => c.id === m2[1]);
      if (!ch) return send(res, 404, { error: 'no_character' });
      const ticket = uid().replace(/-/g, '');
      // Karakterin tam kaydini bilete koyuyoruz: WS tarafi eskiden JSON
      // deposuna bakiyordu ve SQL'e gecince "no_character" veriyordu.
      tickets.set(ticket, { JID: acc.JID, charId: ch.id, char: ch, exp: now() + 60_000 });
      const host = req.headers.host || `localhost:${CFG.http.port}`;
      const proto = (req.headers['x-forwarded-proto'] === 'https') ? 'wss' : 'ws';
      log('dunyaya giris:', ch.name);
      return send(res, 200, { wsUrl: `${proto}://${host}/ws`, ticket });
    }

    m2 = p.match(/^\/api\/v1\/characters\/([^/]+)$/);
    if (m2 && req.method === 'DELETE') {
      const ok = await AUTH.deleteCharacter(acc, m2[1]);
      return send(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'no_character' });
    }
    return send(res, 404, { error: 'not_found' });
  }

  if (p === '/api/v1/bug-reports' && req.method === 'POST') {
    const b = await readBody(req, res);
    if (b === null) return true;   // 4MB asildi: readBody 413 report_too_large yolladi (S2 madde 3)
    /* PP MADDE 9: govde OLDUGU GIBI ( ...b ) yazilir - istemcinin 0024 ile
       eklemeye basladigi sohbet baglami `context` alaninin icinde gelir ve
       spread sayesinde dususuz loglanir. Dosya-log yolu burasi; WebBugReport
       DB insert'i ayri is (setup_procs.mjs'teki WebAddBugReport proc'u).
       KARAR (2026-09-03, kapatildi): DB'de TEK baglam kolonu [context]tir -
       eski contextJson kolonu bos tablodan (0 satir, olculdu) DROP edildi;
       setup_web_schema.mjs ve WebAddBugReport (@Context -> [context]) buna
       esitlendi + canli proc hedefli yeniden dagitildi (setup_procs.mjs
       WHOLESALE kosulmadi - WebSetPremium dagitimi Madde 13'un isi). Insert
       kodlanirken b.context -> [context]; ikinci baglam kolonu ACILMAYACAK. */
    /* ARTIK DB'YE DE YAZILIYOR (2026-09-04). Eskiden bu satir yalnizca
       dosya logunu yaziyordu; tablo (dbo.WebBugReport) ve yordam
       (dbo.WebAddBugReport) VARDI ama hic cagrilmiyordu - olculdu: tabloda
       0 satir. admin_bildirim.hataKaydet SIRAYLA: goruntuyu diske yazar,
       DOSYA LOGUNU yazar (yedek kanal, DB'den ONCE - DB kapali olsa bile
       rapor kaybolmaz), sonra DB'ye insert eder.
       Hesap: bu uc kimlik KAPISININ DISINDA (oyuncunun raporu jetonsuz da
       kabul edilir) ama istemci her istekte Bearer jetonu yolluyor (paket
       q5) - jeton cozulebiliyorsa JID satira yazilir, cozulemezse NULL. */
    const kim = (() => { try { return AUTH?.authOf(req) ?? null; } catch { return null; } })();
    return send(res, 200, (await BILDIRIM.hataKaydet(b, { JID: kim?.JID ?? null })).body);
  }

  /* PP MADDE 8 - ozellik istegi ucu (hata bildirim penceresinin 2. sekmesi).
     REST sozlesmesi paketten (q5/J5 + K5): POST /api/v1/feature-requests,
     govde {title, description, clientVersion}; istemci kapisi title>=8 ve
     description>=100 - sunucu aynasi ayni esikleri uygular. Dusuk efor ->
     HTTP 4xx + {error:'request_low_effort'} (K5 api.request_low_effort
     metnini basar: "daha ayrintili anlat"). Basari -> {ref, cooldownSec}
     (bug-reports ile ayni desen) -> istemci ui.feat.sent {ref} gosterir;
     cooldown istemci tarafinda localStorage'da tutulur - bug-reports'ta da
     sunucu tarafi hesap-cooldown'u olmadigi icin burada da eklenmedi. */
  if (p === '/api/v1/feature-requests' && req.method === 'POST') {
    const b = await readBody(req, res);
    if (b === null) return true;   // 4MB asildi: readBody 413 yolladi
    if (String(b?.title ?? '').length < 8 || String(b?.description ?? '').trim().length < 100)
      return send(res, 400, { error: 'request_low_effort' });
    /* Dosya logu + DB (dbo.WebFeatureRequest). Ozellik istekleri icin sema
       tarafinda hicbir sey YOKTU (olculdu: sys.tables/sys.procedures'ta
       '%Feature%' 0 satir) - tablo ve WebAddFeatureRequest yordami
       admin_bildirim.js icinde IDEMPOTENT olarak kuruluyor. */
    const kimF = (() => { try { return AUTH?.authOf(req) ?? null; } catch { return null; } })();
    return send(res, 200, (await BILDIRIM.ozellikKaydet(b, { JID: kimF?.JID ?? null })).body);
  }

  // istemcinin bekledigi acik uclar
  if (p === '/api/v1/public/security-questions') {
    if (!AUTH) return send(res, 503, { error: 'Veritabani baglanmadi' });
    return send(res, 200, { questions: await AUTH.guvenlikSorulari() });
  }
  if (p === '/api/v1/public/races')       return send(res, 200, { races: raceList() });
  if (p === '/api/v1/public/status')      return send(res, 200, { online: wss?.clients.size ?? 0, status: 'up' });
  if (p === '/api/v1/public/server-info')  return send(res, 200, { name: 'SON', version: VERSION, rates: { xp: 1, sp: 1, gold: 1 } });
  if (p === '/api/v1/public/community')    return send(res, 200, {});
  if (p === '/api/v1/public/uniques')      return send(res, 200, { uniques: [] });
  if (p.startsWith('/api/v1/public/rankings')) return send(res, 200, { board: [], rows: [] });
  if (p.startsWith('/api/v1/news'))        return send(res, 200, { news: [], items: [], total: 0 });
  if (p.startsWith('/api/v1/'))            return send(res, 404, { error: 'not_found' });
  return false;
}

// ---------------------------------------------------------------- statik istemci
/* Metin turleri sikistirilir; .glb/.ddj/.png zaten ikili sikistirilmis - onlari
   yeniden sikistirmak sadece CPU yakar. referans oyun da .glb'ye content-encoding
   koymuyor, index.html'e `br` koyuyor. */
/* '.md' EKLENDI (surum notlari). Istemci bunlari GERCEKTEN indiriyor: paketteki
   tFt() `fetch('/assets/changelog/<dosya>').then(r => r.text())` yapiyor ve rFt()
   giriste index.json'daki EN YENI girdiyi gorulmemisse pencereyi KENDILIGINDEN
   aciyor - yani her yama gunu her oyuncu en az 1 .md indiriyor, arsivi gezen
   oyuncu 26'ya kadar. Olculdu: 66 dosya (>1 KB) 220546 -> 92921 bayt br11
   (%57.9); en yeni girdi 1142-1295 -> 486-675 bayt.
   YENI RISK SINIFI YOK: manifestte listeli, sikistirilabilir ve >1 KB olan 672
   varligin 672'si ZATEN br/gz ile sunuluyor, service worker onlari sha256
   dogrulayip onbellege yaziyor. Bunlarin arasinda AYNI klasordeki ve AYNI kod
   yolundan ($Pt) cekilen changelog/index.json da var - yalnizca govdeler disarida
   kalmisti. sha256 dogrulamasi etkilenmez: fetch content-encoding'i seffaf acar,
   arrayBuffer() COZULMUS baytlari verir, manifest hash'i ham dosyanindir ve ham
   dosyaya DOKUNULMAZ (yalnizca kardes .br/.gz eklenir).
   '.md' MIME'i (text/markdown) yukaridaki MIME haritasinda zaten vardi.
   NOT: gen_sikistir.mjs:UZANTILAR ile BIREBIR ayni kalmali - betik ayrisirsa
   durur (sunucuKumesiniDogrula). */
const SIKISTIRILIR = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.txt', '.map', '.md']);

/* ETag onbellegi: yol -> { imza, etag }. Dosya boyutu+mtime degisirse yeniden
   uretilir. referans oyun icerik md5'i kullaniyor; 1.5 GB'lik varligi her istekte
   hashlemek mantiksiz oldugu icin boyut+mtime imzasi kullaniyoruz - tarayici
   acisindan davranis birebir ayni (degisince etag degisir, degismezse 304). */
const etagOnbellek = new Map();
function etagUret(file, st) {
  const imza = `${st.size}-${st.mtimeMs}`;
  const onceki = etagOnbellek.get(file);
  if (onceki && onceki.imza === imza) return onceki.etag;
  const etag = '"' + crypto.createHash('md5').update(file + imza).digest('hex') + '"';
  etagOnbellek.set(file, { imza, etag });
  return etag;
}

/* ------------------------------------------------ FINAL3 / MADDE 4: LRU dosya bellegi
 * OLCUM - SUNUCU TARAFI (izole A/B, port 3098, birebir ayni etag mantigi,
 * NODE HTTP ISTEMCISI, 3 tur medyan):
 *   415 varlik / 6 paralel   475.14 ms -> 201.42 ms  (2.36x)
 *   istek p50 4.59 -> 1.56 ms, p95 23.42 -> 8.49 ms
 *   279 kucuk varlik (<60 KB) 121.62 -> 61.31 ms
 * Bu rakamlar sunucunun CEVAP URETME bedelidir. Tarayicida olculmus bir
 * karsiligi YOK; tarayici bunlarin uzerine kendi istek zamanlamasi/dekod
 * ustunu ekler (olculmus ornegi asagida, MADDE 3 notunun (B) satiri). Yani
 * ORANLAR (2.36x) tasinabilir, MUTLAK ms degerleri kullanici deneyimi DEGIL.
 * Eskiden her istek bir fs.stat + open/read/close cifti odiyordu; bellekte
 * tutulan tek sey etag METNIYDI, govde degil.
 *
 * RAM KISITI (kullanicinin "3 GB" sikayeti) yuzunden bilerek KUCUK tutuldu:
 *   - toplam tavan varsayilan 96 MB (olculen bedel: 683 dosya = 55.8 MB RSS),
 *   - 2 MB ustu dosya HIC onbellege girmez, stream olarak akar
 *     (3.76 MB .glb TTFB'si zaten 1.1-1.4 ms - onbellege almanin faydasi yok,
 *      bedeli buyuk),
 *   - ikisi de config.json http.dosyaOnbellekMB / http.dosyaOnbellekTekMB ya da
 *     JW_DOSYA_ONBELLEK_MB / JW_DOSYA_ONBELLEK_TEK_MB ile ayarlanabilir,
 *     0 = onbellek tamamen kapali (eski davranis).
 *
 * TAZELIK: fs.stat ATLANMAZ. Boyut+mtime imzasi, diskte degisen dosyanin bayat
 * govde olarak servis edilmesini engelleyen TEK korumadir; /app/index-*.js
 * patch_login.py tarafindan AYNI AD altinda yerinde yamalandigi icin sarttir. */
const sayiyaCevir = (v, varsayilan) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : varsayilan;
};
const ONB_MB      = sayiyaCevir(process.env.JW_DOSYA_ONBELLEK_MB     ?? CFG.http?.dosyaOnbellekMB,     96);
const ONB_TEK_MB  = sayiyaCevir(process.env.JW_DOSYA_ONBELLEK_TEK_MB ?? CFG.http?.dosyaOnbellekTekMB,   2);
const ONB_TAVAN   = Math.round(ONB_MB * 1024 * 1024);
const ONB_TEK_MAX = Math.round(ONB_TEK_MB * 1024 * 1024);

const dosyaOnbellek = new Map();          // yol -> { imza, buf }   (ekleme sirasi = LRU sirasi)
let onbBayt = 0, onbIsabet = 0, onbIska = 0, onbAtim = 0, onbBayat = 0;

function onbellekAl(file, st) {
  if (ONB_TAVAN === 0) return null;
  const kayit = dosyaOnbellek.get(file);
  if (!kayit) return null;
  if (kayit.imza !== `${st.size}-${st.mtimeMs}`) {   // disk degismis -> at
    dosyaOnbellek.delete(file);
    onbBayt -= kayit.buf.length;
    onbBayat++;
    return null;
  }
  dosyaOnbellek.delete(file);                        // MRU'ya tasi (Map ekleme sirali)
  dosyaOnbellek.set(file, kayit);
  onbIsabet++;
  return kayit.buf;
}

function onbellekKoy(file, st, buf) {
  if (ONB_TAVAN === 0 || buf.length > ONB_TEK_MAX || buf.length > ONB_TAVAN) return;
  const eski = dosyaOnbellek.get(file);
  if (eski) { dosyaOnbellek.delete(file); onbBayt -= eski.buf.length; }
  dosyaOnbellek.set(file, { imza: `${st.size}-${st.mtimeMs}`, buf });
  onbBayt += buf.length;
  while (onbBayt > ONB_TAVAN && dosyaOnbellek.size > 0) {      // en eskiden at
    const ilk = dosyaOnbellek.entries().next().value;
    if (!ilk) break;
    dosyaOnbellek.delete(ilk[0]);
    onbBayt -= ilk[1].buf.length;
    onbAtim++;
  }
}

/* Bellek kullanimini logla: 60 sn'de bir, YALNIZCA aradan trafik gectiyse
   (bosta duran sunucu log kirletmez). RSS de basilir ki "3 GB" sikayeti
   sunucu mu tarayici mi sorusu olcumle ayrilabilsin. */
let onbSonRapor = -1;
const onbellekIzleyici = setInterval(() => {
  const toplam = onbIsabet + onbIska;
  if (toplam === onbSonRapor) return;
  onbSonRapor = toplam;
  const oran = toplam ? Math.round((onbIsabet / toplam) * 100) : 0;
  log(`statik onbellek: ${dosyaOnbellek.size} dosya / ${(onbBayt / 1048576).toFixed(1)} MB ` +
      `(tavan ${ONB_MB} MB) - isabet ${onbIsabet} (%${oran}), iska ${onbIska}, ` +
      `atim ${onbAtim}, bayat ${onbBayat}; rss ${(process.memoryUsage().rss / 1048576).toFixed(0)} MB`);
  /* Kardes varyant kapisinin karari da gorunur olsun: `mirasli` sayisi
     dusmuyorsa o dosyalarin .meta imzasi yok demektir (gen_sikistir.mjs
     yeniden kosulmali); `bayat` sifir olmali. */
  if (varyantImzali + varyantMirasi + varyantBayat > 0) {
    log(`kardes varyant kapisi: ${varyantImzali} imzali, ${varyantMirasi} mirasli (.meta yok), ` +
        `${varyantBayat} bayat -> anlik sikistirma`);
  }
}, 60000);
onbellekIzleyici.unref?.();

/* Tek govde gonderme noktasi: once LRU, sonra (kucukse) readFile + LRU'ya yaz,
   buyukse eskisi gibi stream. `basliklar` content-length HARIC her seyi tasir. */
function govdeGonder(res, basliklar, file, st) {
  const onbellek = onbellekAl(file, st);
  if (onbellek) {
    res.writeHead(200, { ...basliklar, 'content-length': onbellek.length });
    return res.end(onbellek);
  }
  if (ONB_TAVAN > 0 && st.size <= ONB_TEK_MAX) {
    onbIska++;
    return fs.readFile(file, (err, buf) => {
      if (err) {
        log('okuma hatasi', file, err.code);
        if (!res.headersSent) send(res, 500, 'okuma hatasi', 'text/plain; charset=utf-8');
        else res.destroy();
        return;
      }
      onbellekKoy(file, st, buf);
      res.writeHead(200, { ...basliklar, 'content-length': buf.length });
      res.end(buf);
    });
  }
  /* AKIS YOLU (> ONB_TEK_MAX). BURADA FD SIZINTISI OLCULDU - artik pipeline.

     ESKI KOD: `akis.pipe(res)`. pipe() hedef akis erken KAPANDIGINDA yalnizca
     unpipe eder, kaynagi yok ETMEZ; dolayisiyla istemci indirmeyi yarida
     keserse (sekme kapatma, yeniden yukleme, bolge degistirme) fs okuma
     handle'i acik kalir ve bir daha kapanmaz.
       Olcum (calisan surec, /assets/zones/hotan_province/heights.bin, 17.81 MB):
         40 TAM indirme          -> +1 handle   (normal)
         40 YARIDA KESILEN indirme -> +39 handle (3 sn sonra da, 15 sn sonra da)
         iki ardisik tur: 330 -> 370 -> 408  (birikiyor)
       2 MB alti dosyalarda (onbellek yolu) sizinti YOK - fark -1.
     Operasyonel sonucu iki katliydi: (1) Windows'ta sizan handle dosyanin
     uzerine rename'i engelliyor - gen_sikistir.mjs --zorla tam da entry
     paketinin .br'sinde EPERM alip atliyordu; (2) uzun calisan sunucuda
     bolgeye girerken cekilen EN BUYUK varliklar (nav.bin/heights.bin) tam da
     bu yolda oldugu icin her sekme kapatan oyuncu kalici bir handle birakiyordu.

     pipeline() hedefin erken 'close'unu ERR_STREAM_PREMATURE_CLOSE'a cevirir ve
     zincirdeki TUM akislari destroy eder -> fd ayni turda kapanir. Kaynak okuma
     hatasinda da soketi yok eder, yani eski `akis.on('error')` satirinin isini
     de ustlenir (bu yuzden kaldirildi; cift destroy cagrisi olmasin). */
  res.writeHead(200, { ...basliklar, 'content-length': st.size });
  const akis = fs.createReadStream(file);
  return pipeline(akis, res, (err) => {
    /* Yarida kesme NORMAL bir istemci davranisi - log kirletmesin. */
    if (err && err.code !== 'ERR_STREAM_PREMATURE_CLOSE' && err.code !== 'ERR_STREAM_DESTROYED') {
      log('gonderme hatasi', file, err.code || err.message);
    }
  });
}

/* BAYAT VARYANT GORUNUR OLSUN. Kardes <ad>.br/.gz diskte VAR ama kaynaktan
   eski oldugunda cevap yine DOGRU gider (anlik sikistirmaya dusulur) - ne var
   ki bu, olculmus 5.2x'lik kazancin sessizce kaybi demektir; hicbir yerde iz
   birakmadigi icin de fark edilmesi aylar alabilir. Burada her kardes icin
   TEK satir loglanir.
   Anahtar kaynagin mtime'i: ayni bayat durum icin log bir kez basilir, ama
   kaynak yeniden yamalandiginda (yeni mtime) yeniden uyarilir - yani "yamadan
   sonra gen_sikistir.mjs unutuldu" her seferinde gorunur. Harita sinirsiz
   buyumesin diye tavanda tumuyle bosaltilir; en fazla yeniden uyarilir. */
const bayatUyarilan = new Map();          // kardes yolu -> uyarilan kaynak mtime
function bayatVaryantUyar(kardes, kaynakMtimeMs, kardesMtimeMs, sebep = '') {
  if (bayatUyarilan.get(kardes) === kaynakMtimeMs) return;
  if (bayatUyarilan.size >= 512) bayatUyarilan.clear();
  bayatUyarilan.set(kardes, kaynakMtimeMs);
  const yol = path.relative(CLIENT, kardes).split(path.sep).join('/');
  /* Gecikme yalnizca MIRAS (mtime) kuralinda anlamli; imza kurali reddettiginde
     fark negatif cikabiliyor ("-1000 ms eski" gibi anlamsiz bir satir) - o
     durumda sebep zaten kendini anlatiyor, sayi basilmaz. */
  const fark = Math.round(kaynakMtimeMs - kardesMtimeMs);
  log(`bayat varyant yok sayildi${fark > 0 ? ` (${fark} ms eski)` : ''}: ${yol}` +
      `${sebep ? ` [${sebep}]` : ''}` +
      ' -> anlik sikistirmaya dusuldu; `node gen_sikistir.mjs` calistirilmali');
}

/* ---------------------------------------------- VARYANT TAZELIK IMZASI (.meta)
 * KOK NEDEN (2026-09-05 kapanis denetiminde CANLI URETILDI - varsayim degil):
 * eski tazelik olcutu `kardes.mtimeMs >= kaynak.mtimeMs` idi ve pencereyi
 * gen_sikistir.mjs kuruyordu (varyant mtime = kaynak mtime + 1000 ms). Bu
 * +1 sn ofset bir KOR NOKTA aciyordu: kaynak, varyant uretildikten sonraki
 * 1 saniye ICINDE tekrar degisirse kaynagin yeni mtime'i HALA varyanttan
 * kucuk kaliyor, kapi varyanti TAZE saniyor ve BAYAT GOVDEYI servis ediyordu.
 * Daha kotusu: gen_sikistir.mjs ayni karsilastirmayi kullandigi icin o dosyayi
 * "zaten guncel" sayip atliyor -> durum KENDI KENDINE IYILESMIYORDU.
 *
 * OLCUT: varyantin yaninda `<varyant>.meta` adli kucuk bir JSON durur ve
 * URETILDIGI ANDAKI KAYNAGIN IMZASINI (boyut + mtimeMs) tasir. Kapi
 * BUYUKTUR-ESITTIR degil, TAM ESITLIK sorar:
 *     meta.kaynakBoyut === st.size && meta.kaynakMtimeMs === st.mtimeMs
 * Kaynak bir kez daha yazilirsa mtimeMs (ve cogu zaman boyut) degisir, esitlik
 * bozulur ve varyant - ne kadar "yeni" gorunurse gorunsun - reddedilir.
 *
 * SURUM 1'DE KALAN ~0.5 ms'LIK KOR NOKTA VE SURUM 2'DE NASIL KAPANDI:
 * boyut+mtime bir ZAMAN kimligidir, ICERIK kimligi degil. Bu makinede dosya
 * mtime'i ~0.496 ms adimlarla ilerliyor (400 ardisik yazim olculdu, mtimeMs
 * KESIRLI - ornek 1788563609820.613). Yani kaynak, gen_sikistir.mjs onu
 * OKUDUKTAN sonra ayni mtime tik'i icinde ve AYNI BOYUTTA bir kez daha
 * yazilirsa imza hic degismiyor, bayat varyant "taze" gorunuyordu. Sunucu bu
 * farki TEK BASINA goremez: kapiyi gecmenin sebebi kaynagi hic okumamak, farki
 * gormenin bedeli ise her varyant icin 19 MB'lik entry paketini hash'lemektir.
 *
 * BU YUZDEN COZUM URETICI TARAFINDA VE KANITA DAYALI. Imzayi yazan taraf
 * (gen_sikistir.mjs:metaYaz) artik .meta'yi yazmadan ONCE iki seyi ISPATLIYOR:
 *   (1) ICERIK KANITI - varyanti yazdiktan sonra kaynagi diskten YENIDEN
 *       hash'ler ve sikistirdigi baytlarin sha256'siyla karsilastirir. Ayni
 *       tik icinde yapilmis, boyutu degistirmeyen ikinci bir yazim tam burada
 *       yakalanir: imza YAZILMAZ, varyant devre disi kalir.
 *   (2) TIK KAPANMA KANITI - kaynagin mtime'i uzerinden dosya sistemi
 *       cozunurlugunden acikca buyuk bir sure gecmeden imza yazilmaz. Boylece
 *       imza yazildiktan SONRA gelen her yazim KESINLIKLE farkli bir mtime
 *       uretir ve buradaki tam esitlik onu reddeder.
 * Ikisi birlikte pencereyi daraltmaz, KAPATIR: "imzali ama bayat" bir varyant
 * icin geriye bir zamanlama senaryosu kalmiyor. Kaynagin hash'lenmesi URETIM
 * zamanina tasindi; istek yolunda tek bir ek bayt bile okunmuyor.
 *
 * VARYANTIN KENDI KIMLIGI (surum 2): .meta artik yalniz KAYNAGI degil
 * VARYANTI da pinliyor (varyantBoyut + varyantMtimeMs). Surum 1'de imza
 * dosyasi varyantin baytlari hakkinda HICBIR SEY soylemiyordu: `x.js.br`
 * imzasina dokunulmadan uzerine yazilirsa (yarim kalmis kopya, elle mudahale,
 * baska kalitede uretilmis eski bir govde) kapi onu sorgusuz TAZE sayiyordu.
 * Artik varyantin boyut+mtime'i imzadakinden farkliysa varyant reddedilir:
 * dogru govde yine gider, yalnizca anlik sikistirmaya dusulur ve tek satir
 * log basilir.
 *
 * MIRAS UYUMU: .meta yoksa ya da surumu taninmiyorsa (elle uretilmis kardes,
 * betigin eski surumu, SURUM 1 imzalari) eski mtime kurali AYNEN uygulanir -
 * hicbir varyant bir gecede olu sayilmaz. Surum 1 imzalari bir sonraki
 * `node gen_sikistir.mjs` kosumunda kendiliginden surum 2'ye yukseltilir
 * (icerik ayni cikarsa YENIDEN SIKISTIRMA YOK, yalnizca imza yenilenir).
 * Sayaclar 60 sn'lik onbellek satirinda basilir; "mirasli" sayisi yuksek
 * kalirsa gen_sikistir.mjs yeniden kosulmali demektir.
 *
 * MALIYET: .meta yalniz varyantin KENDI (boyut+mtime) imzasi degistiginde
 * okunur - yani varyant basina omurde bir kez; sonrasi bellekten. Govde
 * gonderme yolu (LRU) hic degismedi.
 * GUVENLIK: `.meta` HTTP uzerinden SUNULMAZ (asagida acik 404) - icinde ic
 * uretim bilgisi var ve istemcinin isine yaramaz. */
const META_SURUM = 2;
const META_UZANTI = '.meta';
const metaOnbellek = new Map();      // varyant yolu -> { imza, meta|null }
let varyantImzali = 0, varyantMirasi = 0, varyantBayat = 0;

function metaKarari(meta, st, kst) {
  if (meta && meta.v === META_SURUM
      && Number.isFinite(meta.kaynakBoyut) && Number.isFinite(meta.kaynakMtimeMs)
      && Number.isFinite(meta.varyantBoyut) && Number.isFinite(meta.varyantMtimeMs)) {
    /* ONCE VARYANTIN KENDI KIMLIGI. Imza yalnizca imzalandigi andaki baytlar
       icin konusur; varyant o andan sonra degistiyse imzanin kaynak hakkinda
       soyledigi sey artik DISKTEKI bu dosya icin gecerli degildir. */
    if (meta.varyantBoyut !== kst.size || meta.varyantMtimeMs !== kst.mtimeMs) {
      return { taze: false, imzali: true,
        sebep: `varyant imzalandiktan SONRA degismis: diskte ${kst.size}b/${kst.mtimeMs}, ` +
               `imzada ${meta.varyantBoyut}b/${meta.varyantMtimeMs}` };
    }
    const taze = meta.kaynakBoyut === st.size && meta.kaynakMtimeMs === st.mtimeMs;
    return { taze, imzali: true, sebep: taze ? 'imza' :
      `imza uyusmuyor: kaynak ${st.size}b/${st.mtimeMs}, imza ${meta.kaynakBoyut}b/${meta.kaynakMtimeMs}` };
  }
  const taze = kst.mtimeMs >= st.mtimeMs;
  return { taze, imzali: false,
    sebep: taze ? 'imzasiz (miras mtime kurali)' : 'imzasiz + kaynak daha yeni' };
}

/* OLUMSUZ SONUC (imza dosyasi YOK) HIC ONBELLEKLENMEZ - surum 2'de 30 sn'lik
   TTL KALDIRILDI.
   Eskiden "bu varyantin .meta'si yok" karari 30 sn bellekte tutuluyordu; yani
   gen_sikistir.mjs bir varyanta sonradan imza eklerse - ki varyantin KENDI
   baytlarina/mtime'ina dokunmadan ekleyebilir, icerik zaten dogruydu - calisan
   sunucu bunu en gec 30 sn sonra goruyor, o sure boyunca zayif MIRAS kuralini
   uygulamayi surduruyordu. TTL'in kazandirdigi bir sey de yoktu: imzasiz
   durumda tek maliyet ENOENT ile donen bir acma cagrisidir (fs.stat ile ayni
   tek syscall) ve bu yol YALNIZCA imzasi olmayan - yani betik kosulduktan
   sonra bos kalmasi gereken - varyantlar icin isliyor. Bu yuzden olumsuz sonuc
   saklanmaz, her istekte yeniden yoklanir: imza dosyasi diskte belirdigi ANDA
   gecerli olur, gecikme sifir.
   OLUMLU sonuc (imza VAR) TTL'siz onbelleklenir: anahtar varyantin kendi
   boyut+mtime imzasidir, varyant degistiginde girdi kendiliginden duser. */
function varyantTazeMi(kardes, kst, st, cb) {
  const imza = `${kst.size}-${kst.mtimeMs}`;
  const onceki = metaOnbellek.get(kardes);
  if (onceki && onceki.imza === imza) return cb(metaKarari(onceki.meta, st, kst));
  fs.readFile(kardes + META_UZANTI, 'utf8', (err, txt) => {
    let meta = null;
    if (!err) { try { meta = JSON.parse(txt); } catch { meta = null; } }
    if (meta === null) {
      metaOnbellek.delete(kardes);          // imzasiz: bir daha yoklanacak
    } else {
      if (metaOnbellek.size >= 4096) metaOnbellek.clear();
      metaOnbellek.set(kardes, { imza, meta });
    }
    cb(metaKarari(meta, st, kst));
  });
}

/* `yolEz` (yol ezmesi): istek URL'i yerine servis edilecek istemci-koku goreli
   yol. TAKMA ADLI ROTALAR ICINDIR - ornegin /admin, icerde /admin.html olarak
   sunulur. Boyle bir rota kendi readFileSync'ini yazarsa asagidaki zincirin
   TAMAMINI (kardes .br/.gz varyanti, bayat-varyant kapisi, varyant basina ETag,
   304, vary, LRU onbellek) kaybeder; tek dogru yol buraya devretmektir.
   Ezme degeri KOD ICINDEN gelir, istekten DEGIL - bu yuzden decodeURIComponent
   uygulanmaz; yol gecisi korumasi (file.startsWith(CLIENT)) yine de asagida
   her iki durumda da calisir. */
function serveStatic(req, res, url, yolEz) {
  let rel = yolEz || decodeURIComponent(url.pathname);
  if (rel === '/' || !path.extname(rel)) rel = '/index.html';
  const file = path.join(CLIENT, rel.replace(/^\/+/, '').split('/').join(path.sep));
  if (!file.startsWith(CLIENT)) return send(res, 403, 'forbidden', 'text/plain');
  /* Varyant imza dosyalari SUNULMAZ: `<ad>.br.meta` sunucunun ic tazelik
     kaydidir (uretim zamani, kaynak imzasi, sha256), istemcinin isine yaramaz
     ve manifestte de yoktur. Uzanti MIME haritasinda olmadigi icin aksi halde
     application/octet-stream olarak inebilirdi. Taramada dogrulandi: client/
     altinda `.meta` uzantili BASKA (mesru) dosya yok. */
  if (rel.toLowerCase().endsWith(META_UZANTI)) {
    return send(res, 404, 'not found: ' + rel, 'text/plain; charset=utf-8');
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      // Uzantili bir yol yoksa GERCEK 404 don. Aksi halde .js istegine index.html
      // dondururuz ve tarayici "MIME type text/html" diye modulu reddeder -
      // eksik chunk'i tesbit etmeyi imkansiz kilan sinsi bir hata.
      if (path.extname(rel)) {
        log('404', rel);
        return send(res, 404, 'not found: ' + rel, 'text/plain; charset=utf-8');
      }
      const idx = path.join(CLIENT, 'index.html');
      if (fs.existsSync(idx)) {
        return send(res, 200, fs.readFileSync(idx), MIME['.html']);
      }
      return send(res, 404, 'istemci bulunamadi - SON/client bos mu?', 'text/plain; charset=utf-8');
    }

    const uzanti = path.extname(file).toLowerCase();
    const etagTemel = etagUret(file, st);

    /* Sikistirma pazarligi 304 yolundan ONCE yapilir: cevabin `vary`
       bildirmesi gerekip gerekmedigini 304 dalinin da bilmesi lazim. */
    const kabul = String(req.headers['accept-encoding'] || '');
    const sikistirilabilir = SIKISTIRILIR.has(uzanti) && st.size > 1024;
    let kodlama = null;
    if (sikistirilabilir) {
      if (/\bbr\b/.test(kabul)) kodlama = 'br';
      else if (/\bgzip\b/.test(kabul)) kodlama = 'gzip';
    }

    /* FINAL3 / MADDE 3 - VARYANT BASINA ETag. Ayni URL identity / br / gzip
       govdeleriyle donebiliyor; RFC 9110 8.8.1'e gore her TEMSILIN etag'i
       farkli olmali. Eskiden ucu de ayni etag'i tasiyordu: identity govdeyi
       "X" ile onbellekleyen istemci sonra `Accept-Encoding: br` + `If-None-
       Match: X` ile sorunca 304 aliyor ve sikistirilmamis govdeyi br sanmasi
       mumkun oluyordu (`vary` cogu tarayicida ortuyor, ara vekilde ortmuyor).
       Kaynak etag DEGISMEDIGI icin identity onbellekleri gecerli kalir;
       yalnizca br/gz govdeler bir kereligine yeniden dogrulanir. */
    const etag = kodlama
      ? etagTemel.slice(0, -1) + (kodlama === 'br' ? '-br"' : '-gz"')
      : etagTemel;

    /* S2 MADDE 2 - onbellek stratejisi (canli referans oyun olcumu birebir):
       hash'li /app/* ve /manifests/* -> 'public, max-age=31536000, immutable'
       (tarayici HIC istek atmaz; sicak aciliste 57 kosullu istegin ~1'e
       inmesi beklenir). KRITIK ISTISNA: yamalanabilir entry index-*.js/css
       immutable OLMAZ - ayni ad altinda SON_LOGIN_PATCH ile yerinde
       yamalaniyor (canli ile sha256 farki olculdu); immutable basilirsa
       yama oyunculara 1 yil ulasmaz. /version.json -> 'no-store'.
       KURAL: ileride entry DISI bir /app veya /manifests dosyasi yerinde
       yamalanacaksa dosya YENIDEN ADLANDIRILMALI.
       304 dali cache-control'u ayni `ortak` nesnesinden okudugu icin ek
       degisiklik gerekmez; vary davranisina DOKUNULMADI (SW sha256
       dogrulamasinin on kosulu - asagidaki RFC 9110 notu). */
    const yamalanabilir = /^\/app\/index-[^/]+\.(js|css)$/.test(rel);
    const kalici = (rel.startsWith('/app/') || rel.startsWith('/manifests/')) && !yamalanabilir;

    const ortak = {
      'content-type': MIME[uzanti] || 'application/octet-stream',
      /* referans oyunun olculen basligi birebir. Hash'siz dosyada tarayici her
         acilista dosyayi yeniden INDIRMEZ; If-None-Match ile sorar, 304
         alir, diskten okur. Bu basliklar yokken 954 varligin hepsi bastan
         iniyordu - karakter onizlemesinin ve dunyanin gec gelmesinin
         sebebi buydu. */
      'cache-control': rel === '/version.json' ? 'no-store'
        : (kalici ? 'public, max-age=31536000, immutable'
                  : 'public, max-age=0, must-revalidate'),
      etag,
      'last-modified': new Date(st.mtimeMs).toUTCString(),
      'access-control-allow-origin': '*',
      /* Ayni URL hem `br` hem duz govde donebiliyor; `vary` olmadan
         tarayici ikisini tek onbellek girdisi sanar. Sikistirilabilir
         turlerin TUM cevaplarinda (identity 200 dahil) bildirilir. */
      ...(sikistirilabilir ? { vary: 'accept-encoding' } : {}),
    };

    // Tarayicidaki kopya hala gecerli mi?
    const gelenEtag = req.headers['if-none-match'];
    if (gelenEtag && gelenEtag.split(',').some(v => v.trim() === etag)) {
      /* RFC 9110 15.4.5: 304 cevabi, ayni istek 200 donseydi gonderilecek
         dogrulama/onbellek basliklarini TASIMAK ZORUNDA - `vary` dahil.
         `vary` eksikken tarayici `br` ile sakladigi govdeyi identity
         istege de veriyor; govde bozuluyor, service worker'in sha256
         dogrulamasi tutmuyor, varlik `game-assets`e hic yazilmiyor. */
      const basliklar = {
        etag,
        'cache-control': ortak['cache-control'],
        'last-modified': ortak['last-modified'],
      };
      if (sikistirilabilir) basliklar.vary = 'accept-encoding';
      res.writeHead(304, basliklar);
      return res.end();
    }

    if (!kodlama) return govdeGonder(res, ortak, file, st);

    /* FINAL3 / MADDE 3 - ON-SIKISTIRILMIS KARDES DOSYA (<ad>.br / <ad>.gz).
       OLCUM: 19.13 MiB entry bundle HER SOGUK ISTEKTE yeniden brotli'leniyordu
       (calisan sunucuda 509.75 ms saf CPU; cikti hicbir yerde saklanmiyordu ve
       diskte tek bir .br dosyasi yoktu).

       (A) SUNUCU TARAFI - izole A/B, port 3099, NODE HTTP ISTEMCISI, 3 tur medyan:
         giris grafi (57 dosya)  anlik br5 374.21 ms -> kardes br11 25.35 ms (14.8x)
         yalniz entry            anlik br5 346.77 ms -> kardes br11  5.17 ms
         tel uzerindeki boyut    2.98 MB -> 2.45 MB  (br11 daha iyi de sikistiriyor)

       (B) TARAYICI TARAFI - gercek Chrome, fetch(cache:'reload'), 6 paralel,
           ayni graf, tel 2.463 MB (34 br govde + 24 ham govde):
         giris grafi             519.71 ms -> 88.9-101.2 ms  (~5.2x)

       ** BU IKI BANDI KARISTIRMA. ** 25.35 ms sunucunun cevap uretme bedelidir,
       KULLANICININ gordugu sure DEGIL: ayni graf ayni telle gercek Chrome
       icinden cekildiginde 88.9-101.2 ms cikiyor. Aradaki fark tarayicinin
       kendi istek zamanlamasi/dekod ustunden gelir, sunucudan degil - dolayisiyla
       kardes dosyalarla daha da kisaltilamaz. Kullaniciya, surum notuna ya da
       herhangi bir rapora yazilacak rakam (B) satiridir: 519.71 -> ~89-101 ms,
       ~5.2x. (A) yalnizca sunucu regresyonunu yakalamak icindir.
       Kardes dosyalari `node gen_sikistir.mjs` uretir.

       BAYAT VARYANT KAPISI: varyant kaynagin GUNCEL temsili degilse yok sayilir
       ve mevcut anlik sikistirmaya dusulur. Olcut 2026-09-05'te mtime
       karsilastirmasindan `<varyant>.meta` IMZA ESITLIGINE cevrildi, ayni gun
       imza surumu 2'ye cikarilip icerik kaniti + varyant kimligi eklendi (kor
       nokta ve olcumler icin yukaridaki "VARYANT TAZELIK IMZASI" notu). Kapi
       IKI ISI birden goruyor:
         (1) patch_login.py (ve paket yamalari) entry'yi AYNI AD altinda yerinde
             degistiriyor - kapi olmasa yamadan sonra ESKI govde servis edilirdi;
         (2) diskteki her <ad>.gz bir Content-Encoding varyanti DEGIL. assets/
             altindaki 29 .gz (heights/nav/statics/splat) manifestte KENDI URL'i
             ve sha256'si olan ICERIK varligidir; biri kaynagiyla ortusmezse
             gen_sikistir.mjs onun IMZASINI SILIP mtime'ini kaynaktan GERIYE
             alarak tam da bu kapiyla devre disi birakir (iki kural birden
             kapanir: imza yok + kaynak daha yeni).
       Imzali varyantlarda karar tek basina `.meta` esitligidir; mtime penceresi
       (varyant mtime = kaynak + 1 sn) yalnizca imzasiz MIRAS yolu icin
       korunuyor. Pencereyi de imzayi da kuran taraf gen_sikistir.mjs'dir.
       ** BU YUZDEN KAPI TEK BASINA YETMEZ: pencere kurulmadiysa dogruluk
       korunur ama hiz sessizce eski haline doner. Sessiz kalmasin diye
       reddedilen kardes bir kez loglanir (bayatVaryantUyar). **
       KAYNAGIN UZANTISI SIKISTIRILIR KUMESINE EKLENIRSE once
       `node gen_sikistir.mjs` kosulmali: kume disindaki varyantlar da 4. adimda
       dogrulanip pencereye alinir (olculdu: .bin kardeslerinin 22'si o adim
       yokken kaynagindan 0.34-4.11 sn eskiydi ve kumeye alinsalar ilk gun
       hepsi anlik sikistirmaya duserdi - hem de 60 MB'lik govdelerle).
       304 zinciri bozulmaz: etag/last-modified/cache-control/vary yukaridaki
       `ortak`tan gelir, content-length kardesin GERCEK boyutudur. */
    const kardes = file + (kodlama === 'br' ? '.br' : '.gz');
    /* ANLIK SIKISTIRMA DALI - govdeGonder ile AYNI SIZINTI DESENI.
       `okuma.pipe(akis).pipe(res)` yarida kesilen indirmede ne fs okuma
       handle'ini ne de zlib akisini yok ediyordu; burada sizan yalnizca fd
       degil, zlib'in yerel (native) baglami da oluyordu. pipeline zincirin
       tamamini destroy eder. */
    const anlikSikistir = () => {
      res.writeHead(200, { ...ortak, 'content-encoding': kodlama });
      const akis = kodlama === 'br'
        ? zlib.createBrotliCompress({ params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } })
        : zlib.createGzip({ level: 6 });
      const okuma = fs.createReadStream(file);
      pipeline(okuma, akis, res, (perr) => {
        if (perr && perr.code !== 'ERR_STREAM_PREMATURE_CLOSE' && perr.code !== 'ERR_STREAM_DESTROYED') {
          log('sikistirma hatasi', file, perr.code || perr.message);
        }
      });
    };
    return fs.stat(kardes, (kerr, kst) => {
      if (kerr || !kst.isFile()) return anlikSikistir();
      varyantTazeMi(kardes, kst, st, (karar) => {
        if (karar.taze) {
          if (karar.imzali) varyantImzali++; else varyantMirasi++;
          return govdeGonder(res, { ...ortak, 'content-encoding': kodlama }, kardes, kst);
        }
        varyantBayat++;
        bayatVaryantUyar(kardes, st.mtimeMs, kst.mtimeMs, karar.sebep);
        anlikSikistir();
      });
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    /* sw.js / sw-lib.js ARTIK GERCEK DOSYALAR (referans oyundan indirildi,
       client/ altinda duruyor) - serveStatic sunuyor. Eskiden burada bos bir
       taslak worker donuyordu; o yuzden hicbir varlik Cache Storage'a
       yazilmiyor ve her acilista 178 MB yeniden iniyordu. referans oyunda ayni
       noktada 794 varlik AGA HIC CIKMADAN onbellekten geliyor. */
    /* /admin -> client/admin.html  (panelin kendisi; yetki REST tarafinda)

       ESKIDEN burada `send(res, 200, fs.readFileSync(f), MIME['.html'])` vardi:
       serveStatic'i TAMAMEN atliyordu. Olculen sonuc - panel her acilista 116 KB
       govdeyi SIKISTIRILMADAN (content-encoding yok, chunked), ETag'siz,
       last-modified'siz ve vary'siz gonderiyordu; yani (1) uretilen
       admin.html.br / admin.html.gz bu rota icin tamamen OLUYDU, (2) tarayicidaki
       kopya hicbir zaman yeniden dogrulanamadigi icin her F5 tam govdeyi bastan
       indiriyordu (304 imkansiz), (3) LRU statik onbellek de devrede degildi -
       her istek senkron readFileSync ile olay dongusunu blokluyordu.

       Artik yol icerde /admin.html'e yaziliyor ve serveStatic'e devrediliyor:
       kardes varyant, bayat-varyant kapisi, varyant basina ETag, 304 ve vary
       zincirinin tamami tek noktadan gelir. /admin ile /admin.html ayni ETag'i
       urettigi icin iki URL arasinda onbellek tutarsizligi da olusmaz.

       Dosya yoksa davranis DEGISMEZ: eskisi gibi asagidaki serveStatic cagrisina
       dusulur (uzantisiz yol -> index.html). */
    if (url.pathname === '/admin' || url.pathname === '/admin/') {
      if (fs.existsSync(path.join(CLIENT, 'admin.html'))) {
        return serveStatic(req, res, url, '/admin.html');
      }
    }

    if (url.pathname.startsWith('/api/')) {
      const handled = await rest(req, res, url);
      if (handled !== false) return;
      return send(res, 404, { error: 'not_found' });
    }
    serveStatic(req, res, url);
  } catch (e) {
    log('HTTP hata:', e.message);
    if (!res.headersSent) send(res, 500, { error: 'server_error' });
  }
});

// ---------------------------------------------------------------- WebSocket
const wss = new WebSocketServer({ server, path: '/ws' });
/* ws, `{ server }` verildiginde http sunucusunun 'error' olayini wss'e AYNEN
 * ILETIR (ws/lib/websocket-server.js -> addListeners: error: emit.bind(this,
 * 'error')). wss'in kendi 'error' dinleyicisi YOKSA EventEmitter sozlesmesi
 * geregi hata FIRLATILIR - ve o firlatma `server.emit('error')` zincirini
 * yarida keser: dosyanin en altindaki `server.once('error')` isleyicisine
 * SIRA GELMEZ (ws'in dinleyicisi 1766'da, bizimki ~3117'de kayitli).
 *
 * OLCULDU: port mesgulken (`node server.js`, PID 37524 3000'i tutuyor)
 * `listenerCount('error') = 2` ve EADDRINUSE dali HIC calismadi; ekrana ham
 * `uncaughtException` yigin izi dustu. Ayni sessiz kesinti yuzunden
 * EADDRNOTAVAIL -> 0.0.0.0 YEDEGI de hicbir zaman devreye giremezdi: IPv6
 * yigini kapali bir makinede sunucu, kendi yorumunun vaat ettigi yedege
 * dusmek yerine cokerdi.
 *
 * Cozum: wss'e kendi dinleyicisini ver. Hatayi YUTMAZ - yalnizca firlatmayi
 * engeller, boylece asagidaki isleyici sirasini alir ve karar onda kalir. */
wss.on('error', (e) => {
  const metin = e?.code ? `${e.code} ${e.message}` : String(e?.message || e);
  /* syscall === 'listen' ise bu ws'e ait bir ariza DEGIL, http sunucusundan
     iletilmis dinleme hatasidir; karari asagidaki server.once('error') verir.
     Ayirt etmezsek gunlukte ws katmani sucluymus gibi gorunur. */
  if (e?.syscall === 'listen') log(`http dinleme hatasi ws'e iletildi: ${metin}`);
  else log('ws sunucu hatasi:', metin);
});
const zones = new Map();  // zoneId -> Set(client)

/* ====================================================== YENIDEN BAGLANMA (resume)
 * Istemci, KICK KARESI OLMADAN kopan bir soketten sonra 1000 ms bekleyip
 * TEK BIR kez `auth` gonderiyor - ama BILET YOK, yalnizca
 * { resumeToken, version, proto: 9 } (paket @25652482-25652830; auth semasi
 * @25608723'te ticket/resumeToken/version/proto'nun DORDU DE opsiyonel).
 * Token sunucudan auth.ok(129) ile geliyor: X({ charId: J(), resumeToken: J() })
 * - iki alan da ZORUNLU (@25618380).
 *
 * ESKIDEN: token uretiliyor, istemciye veriliyor ama HICBIR YERDE
 * SAKLANMIYORDU; biletsiz gelen kare `tickets.get(undefined)` -> undefined
 * -> hata + close(4001) oluyordu. Yani istemcinin tek resume denemesi HER
 * ZAMAN basarisizdi ve oyuncu "connection lost" goruyordu.
 *
 * Omur: gameConfig.linkdeadGraceMs = 15000 (data/game-config.json). Jetonun
 * tam olarak bu pencereyi kullandigina dair PAKET KANITI YOK - bu bizim
 * secimimiz; degeri oradan alarak en azindan tek bir kaynaga bagliyoruz.
 * Jeton TEK KULLANIMLIK: okununca silinir.
 */
const resumeJetonlari = new Map();  // token -> { JID, sec_primary, sec_content, char, exp }

function frame(ws, t, d, q) {
  /* GIRIS TAMPONU: giris.js akisi ws._toplu'yu bir diziye cevirdiginde kare
     tele yazilmaz, tampona alinir ve sonunda TEK bir `batch` zarfinda gider -
     referans oyunun yaptigi da tam olarak bu (bkz. giris.js basligi, madde 1).
     Tampon akisin `finally` blogunda HER DURUMDA kapatilir. */
  if (ws._toplu) { ws._toplu.push(q === undefined ? { t, d } : { t, d, q }); return; }
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(q === undefined ? { t, d } : { t, d, q }));
}
/** Ham JSON metnini yollar (batch zarfi gibi {t,d} kalibina uymayanlar icin). */
function hamGonder(ws, metin) {
  if (ws.readyState === ws.OPEN) ws.send(metin);
}
function broadcast(zoneId, t, d, except) {
  for (const c of zones.get(zoneId) ?? []) if (c !== except) frame(c, t, d);
}

/* ============================================================ ORTAK BILDIRIM
 * err (240) ve sys.notice (195) kareleri icin TEK uretici. Sistem modulleri
 * bunu `ctx.hata` / `ctx.bildir` / `ctx.hamDuyuru` olarak alir.
 *
 * NEDEN TEK YERDE: bugun 17 farkli yerel hata() var ve ARGUMAN SIRALARI
 * cakisiyor (kimi hata(ws,code,key), kimi hata(ws,code,q,key,params), kimi
 * hata(ws,code,params)). Yardimci ADLANDIRILMIS SECENEK NESNESI aldigi icin
 * siralama hatasi yapilamaz.
 *
 * SEMA (paket @25631967):
 *   err = X({ code: qJ(Sht), key: qJ(Eht).optional(), msg: J().optional(),
 *             q: Y().optional(), params: GJ(J(), VJ([J(), Y()])).optional() })
 * SEMA (paket @25631829):
 *   sys.notice = X({ key: qJ(Tht), params: ...optional(),
 *                    display: qJ([`line`,`banner`]).optional() })
 *
 * ONEMLI: `q` err karesinin ICINDEKI alandir, zarf q'su degil - istemcinin
 * isleyicisi `codeOwner.q` okuyor (@27135789). q gitmezse iyimser cast
 * iptal edilmez ($gt/cancelByQ @25694958) ve esya bekleme suresi geri
 * alinmaz (sxt @25929654).
 */

/** params degeri SADECE string|number olabilir (sema: z.record(z.string(),
 *  z.union([z.string(), z.number()]))). Sayilar istemcide Intl.NumberFormat'tan
 *  geciyor (@25546059) - sayiyi ONCEDEN String()'e cevirmek binlik ayracini
 *  oyuncunun dilinden koparir. undefined/null ayiklanir: eksik yer tutucu
 *  ekranda HAM `{gold}` olarak kalir (@25546596). */
function paramTemizle(p) {
  if (!p || typeof p !== 'object') return undefined;
  const out = {};
  for (const [k, v] of Object.entries(p)) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'number') { if (Number.isFinite(v)) out[k] = v; continue; }
    out[k] = typeof v === 'string' ? v : String(v);
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * err (240) gonderir. HER ZAMAN true doner -> `return hata(ws, ...)` kalibi
 * sistem modulunun mesaj() sozlesmesiyle ("mesaji ben sahiplendim") uyumlu.
 *
 * @param code     ZORUNLU, err.code enum'undan (43 kod, schemas.json)
 * @param key      err.key enum'undan (80 anahtar); VARSA istemci `err.<code>`
 *                 yerine BUNU gosterir
 * @param params   Record<string, string|number>. ID alanlarini HAM ver
 *                 (itemId/skillId/masteryId/monsterId ...) - istemci q5() ile
 *                 yerellestirilmis adi kendisi koyar (@27114703)
 * @param msg      SADECE tarayici konsolu; oyuncu GORMEZ (@27135789)
 * @param q        istemcinin istek sirasi (skill.cast 22 / inv.use 49 reddinde SART)
 * @param bildirim yerellestirmesi olmayan kodlar icin esli sys.notice anahtari
 */
function hata(ws, code, { key, params, msg, q, bildirim, bildirimParams } = {}) {
  let kod = code;
  if (!ERR_KODLARI.has(kod)) {
    /* Enum disi kod istemcide sessizce kaybolur; en azindan gorunur bir
       kod gonderip sunucu gunlugune dusuruyoruz. */
    log(`PROTOKOL: bilinmeyen err.code "${kod}" -> ERR_VALIDATION`);
    kod = 'ERR_VALIDATION';
  }
  const d = { code: kod };
  if (key) {
    if (ERR_ANAHTARLARI.has(key)) d.key = key;
    else log(`PROTOKOL: bilinmeyen err.key "${key}" - dusuruldu`);
  }
  const p = paramTemizle(params);
  if (p) d.params = p;
  if (msg) d.msg = String(msg).slice(0, 200);
  if (typeof q === 'number') d.q = q;
  frame(ws, 'err', d);
  /* Gorunurluk agi: yerellestirmesi olmayan kod + key yok -> oyuncu hicbir
     sey gormez. Cagiran esli bir bildirim verdiyse onu da yolla (ayni
     konvansiyon sistem_gorev.js:757-770'te belgeli). */
  if (bildirim && !d.key && ERR_SESSIZ_KODLAR.has(kod)) bildir(ws, bildirim, bildirimParams);
  return true;
}

/** sys.notice (195). display yalnizca 'line' | 'banner'. HER ZAMAN true doner. */
function bildir(ws, key, params, display) {
  if (!ws) return true;
  if (!BILDIRIM_ANAHTARLARI.has(key)) {
    /* Enum disi anahtar sohbette ⟦anahtar⟧ COPU uretir (@25546596). Ozellikle
       istemcinin KENDI urettigi anahtarlar (sys.macro.*, sys.trace.*,
       sys.action.*, sys.revive.failed, sys.profession.gathered ...) buradan
       gonderilemez - onlari istemci zaten kendisi basiyor. */
    log(`PROTOKOL: bilinmeyen sys.notice anahtari "${key}" - gonderilmedi`);
    return true;
  }
  const d = { key };
  const p = paramTemizle(params);
  if (p) d.params = p;
  if (display === 'line' || display === 'banner') d.display = display;
  frame(ws, 'sys.notice', d);
  return true;
}

/** Cevrilmeyen HAM metin duyurusu. key='raw' -> params.text oldugu gibi basilir;
 *  display='banner' ise afis suresi min(12000, 4000 + uzunluk*40) ms (@27128108).
 *  Ust sinir gameConfig.chatMaxLen = 200. */
function hamDuyuru(ws, metin, display = 'banner') {
  return bildir(ws, 'raw', { text: String(metin ?? '').slice(0, GCFG.chatMaxLen ?? 200) }, display);
}

/**
 * kick (241) + kisa gecikmeli kapanis.
 *
 * KICK KARESI SART: kicksiz kapanista istemci bunu ariza sanip resumeToken
 * ile 1000 ms sonra TEK BIR kez geri geliyor (paket @25652482-25652830) -
 * yani duz `close()` bir hiz-siniri kickini ise yaramaz hale getirir.
 * kick gelince istemci once W$.disconnect() cagiriyor (@27135573), boylece
 * yeniden baglanma DENENMIYOR ve sebep anahtari (`kick.<reason>`)
 * yerellestiriliyor.
 * 200 ms gecikme gm.js:154-159'daki calisan kalibin aynisi - kare tel
 * uzerinde cikmadan soketi kapatmamak icin.
 */
function kickAt(ws, reason, kapanisKodu = 4002) {
  if (!ws || ws._kickAtildi) return true;
  if (!KICK_SEBEPLERI.has(reason)) {
    log(`PROTOKOL: bilinmeyen kick.reason "${reason}" - kare gonderilmedi`);
  } else {
    ws._kickAtildi = true;
    frame(ws, 'kick', { reason });
  }
  /* Jeton iptali: atilan oturum resumeToken ile geri gelemesin. */
  if (ws._resumeToken) { resumeJetonlari.delete(ws._resumeToken); ws._resumeToken = null; }
  setTimeout(() => { try { ws.close(kapanisKodu); } catch { /* zaten kapali */ } }, 200);
  return true;
}

/* ========================================================== HIZ SINIRLAYICI
 * Iki asamali, SINIF BAZLI kayan pencere:
 *   yumusak -> err(240) { code:'ERR_RATE', q }   (tr.json err.ERR_RATE =
 *              "Yavasla - cok fazla istek."). BAGLANTI KOPMAZ.
 *              `key` KONMAZ: err.key enum'unda (Eht) hiz ile ilgili anahtar
 *              YOK; istemci `err.${code}` geri donusunu kullaniyor.
 *   sert    -> kick(241) { reason:'rate_limit' } (tr.json kick.rate_limit =
 *              "Baglanti kesildi - cok fazla istek.")
 *
 * ESIK DEGERLERI UYDURULMAZ: 27 MB'lik istemci paketinde tek bir sayisal
 * esik yok - `rateClass` tanimlayicisi tam 3 kez geciyor ve ucu de T$
 * govdesinde; burst/refill/windowMs/perSec/tokenBucket hic gecmiyor. Yani
 * hem yumusak hem sert esik SUNUCUDA tutulur ve istemcide on-kisitlama yoktur.
 * Bu yuzden butceler data/sunucu-ayarlari.json > hizSiniri altindan okunur
 * (admin tazele() o dosyanin anahtarlarini GCFG'ye kopyalar) ve:
 *   - varsayilan mod GOZLEM'dir: hicbir sey engellenmez, yalnizca sinif
 *     basina TEPE hiz loglanir; gercek esikler O OLCUMDEN konur,
 *   - butcesi tanimsiz sinif SINIRSIZDIR (fail-open),
 *   - pencereMs varsayilani 10000: BIZIM secimimiz (sistem_tezgah.js:167'deki
 *     mevcut ad-hoc pencereyle ayni), referans oyundan gelmiyor.
 */
const HIZ_VARSAYILAN = Object.freeze({ gozlem: true, pencereMs: 10_000, siniflar: {} });
/** ws -> Map<sinif, number[]>  (zaman damgalari). WeakMap: soket gidince cop olur. */
const HIZ_PENCERE = new WeakMap();
/** Kova bellek koruyucusu - OYUN KURALI DEGIL, sadece selde dizinin sismesini onler. */
const HIZ_KOVA_TAVANI = 5000;

function hizAyari() {
  const a = GCFG.hizSiniri;
  return (a && typeof a === 'object') ? a : HIZ_VARSAYILAN;
}

/**
 * @returns 'gec' | 'yavasla' | 'kick'
 */
function hizKapisi(ws, t) {
  const sinif = RATE_CLASS.get(t);
  if (!sinif) return 'gec';          // c2s olmayan / bilinmeyen ad: default dali zaten yutuyor
  const cfg = hizAyari();
  const b = cfg.siniflar?.[sinif] ?? null;
  const pencere = Number(b?.pencereMs ?? cfg.pencereMs) || 0;
  if (!(pencere > 0)) return 'gec';  // butce tanimsiz -> sinirsiz
  let kova = HIZ_PENCERE.get(ws);
  if (!kova) { kova = new Map(); HIZ_PENCERE.set(ws, kova); }
  let liste = kova.get(sinif);
  if (!liste) { liste = []; kova.set(sinif, liste); }
  const s = now();
  while (liste.length && s - liste[0] > pencere) liste.shift();
  if (liste.length >= HIZ_KOVA_TAVANI) liste.shift();
  liste.push(s);

  if (cfg.gozlem !== false) {
    /* OLCUM MODU - engelleme yok. Yeni tepe kirildikca, sinif basina en
       fazla 10 saniyede bir satir yazilir (gunluk selini onlemek icin). */
    const tepe = (ws._hizTepe ??= Object.create(null));
    if (liste.length > (tepe[sinif] ?? 0)) {
      tepe[sinif] = liste.length;
      const damga = (ws._hizLog ??= Object.create(null));
      if (s - (damga[sinif] ?? 0) > 10_000) {
        damga[sinif] = s;
        log(`hiz-gozlem ${ws.char?.name ?? '?'} ${sinif}: tepe ${liste.length}/${pencere}ms`);
      }
    }
    return 'gec';
  }
  const kickEsik = Number(b?.kick) || 0;
  const tavan = Number(b?.tavan) || 0;
  if (kickEsik > 0 && liste.length > kickEsik) return 'kick';
  if (tavan > 0 && liste.length > tavan) return 'yavasla';
  return 'gec';
}

/* ============================================================= BOLGE GECISI
 * `zone.transfer` (132) HIC gonderilmiyordu; bolgeler arasi gecis bu yuzden
 * calismiyordu. Akisin tamami ve paketten okunan kanitlar bolge.js basliginda.
 * Ozet:   zone.transfer { zoneId }   ->   zone.init { ... }   (AYNI SOKET)
 * wsUrl/ticket gonderilmedigi surece istemci baglantiyi KOPARMAZ, sadece
 * hedef bolgenin varliklarini on-yukler (istemci isleyicisi bayt 27117640).
 * Kapilar (gates) bu dunyada BOS - ayrinti yine bolge.js basliginda.
 */
const { bolgeGecisi, kapiTik, KAPILAR } = kurBolgeGecisi({
  zones, world: WORLDSIM, worldData: WORLD, zoneMeta: ZONES,
  frame, broadcast, log, zoneGroundY,
  selfPayload, entityPayload, zoneNpcEntities, bacakDurdur,
  konumuKaydet, sistemler: () => SISTEMLER, now,
  /* zone.init'in ZAMAN EKSENI ve GIRIS KARELERI - ayrinti giris.js basliginda.
     Bolge gecisi de bir zone.init'tir: istemci orada evcil/gpet durumunu
     temizliyor, bu yuzden ayni kare dizisi tekrar gonderilmeli. */
  tik,
  girisKareleri: (ws) => girisKareleriniYolla(ws, 'bolge gecisi'),
});

/* Bosta gezinme: hedefi olmayan canavarlar yuvalarinin icinde YURUR.
   Hiz mobs.json walkSpeedU, sinir Tab_RefNest.nRadius*0.15, engel nav.bin. */
const GEZINME = new Gezinme({
  world: WORLDSIM, frame, yurunebilir: yurunebilirNokta, log,
});
LOOP = new GameLoop({
  world: WORLDSIM, combat: COMBAT, frame, broadcast, log,
  tickMs: CFG.world.tickMs, gezinme: GEZINME,
  // hedefe YAKLASMA icin - istemci attack'ta hicbir hareket mesaji uretmiyor
  yurunebilir: yurunebilirNokta,
  /* madde 13: SABIT SAYI degil FONKSIYON (ws) => hiz. gameloop.js hizOku
     sarmalayicisi sayi/fonksiyon ikisini de kabul eder (G2, madde 13);
     fonksiyon binek hizini (mounts.json speedU) ve moveSpeedPct buff
     carpanini da tasir - sabit sayi o kaldiraclari sessizce oldururdu. */
  oyuncuHizi,
  /* madde 5: tezgah kilidi - gameloop #savasKilidi bu kancayi okuyor
     (gameloop.js:292); bugune kadar hic BAGLANMAMISTI. */
  mesguliyet: mesguliyetKilidi,
  envanterPayload,
  // gameConfig.respawnHpPct = .5 (gameloop icinde 0.30 sabiti yaziliydi)
  respawnHpPct: GCFG.respawnHpPct ?? 0.5,
  /* GANIMET SABITLERI TEK KAYNAKTAN: gameloop.js bugun 60000/3/15000/50
     degerlerini kendi icinde SABIT tutuyor; dogru degerler ama GCFG
     degisince (admin paneli lootOwnerLockMs/pickupRangeU'yu duzenliyor)
     kayarlar. game-config.json: lootDespawnMs 60000, lootOwnerLockMs 15000,
     pickupRangeU 3, pickupSearchRangeU 50 (paket gomulu varsayilan @9096782).
     gameloop.js bu alani okuyana kadar zararsizdir. */
  ganimetAyar: GCFG,
  /* Baska modulun ORNEK'ine erisim (ornek: binek-pet binekte(ws) kapisi).
     gameloop.js kullanmadigi surece etkisizdir. */
  sistemOrnegi,
});
LOOP.basla();

/* ------------------------------------------------------------------ SISTEM MODULLERI
 * Protokolde 100 istemci mesaji var; cekirdek sunucu 11 tanesini isliyor
 * (hareket, hedefleme, saldiri, ganimet alma, sohbet, cikis). Kalan sistemler
 * AYRI MODULLER halinde yaziliyor: sistem_<ad>.js
 *
 * Sozlesme:   export function kur(ctx) { return { mesaj(ws, t, d) => bool } }
 *   mesaj() ilgilenmedigi mesajda false doner, yonlendirici siradakini dener.
 *
 * Modul dosyasi yoksa sessizce atlanir - eksik sistem sunucuyu durdurmaz.
 */
const SISTEM_ADLARI = [
  // 1. dalga
  'envanter', 'stat-ustalik', 'dukkan', 'beceri', 'gorev',
  'donus-isinlanma', 'banka-depo', 'arayuz-durumu', 'binek-pet', 'parti',
  // 2. dalga
  'ticaret', 'tezgah', 'borsa', 'lonca', 'gelistirme', 'meslek',
  /* YERINDE DIRILIS SECENEGI - olum ekranindaki teklif kutusu
     (revive.offer 201). S2 MADDE 1: kucuk-sistemler ile dirilis-unique
     modullerinden ONCE gelmeli (DIKKAT: bu blokta modul adlarini TIRNAKSIZ
     yaz - testler SISTEM_ADLARI dizisini kaynaktan tek-tirnak regexi ile
     ayristiriyor, tirnakli ad cift kuruluma yol acar).
     Ucu de revive.respond isliyor ve bu modul yalniz KENDI
     teklif kimliklerini (offerId >= 900000000) kabul edip digerlerine false
     donuyor; giris kancasi yok, selfAlanlari() bos - diger mesajlara yan
     etki sifir. Dizinin SONUNDAYKEN onde duran acgozlu case'ler her kabulu
     yutup unknown_offer donduruyordu (olculdu:
     GERCEK/denetim/curutme_revive_dispatch.mjs - kabul -> ok:false,
     oyuncu olu kaliyordu; one alinca ok:true, hp/mp full). */
  'yerinde-dirilis',
  'kucuk-sistemler',
  /* 3. dalga - dirilis + unique dogumu.
     s2c 201 revive.offer / 202 revive.result / 203 unique.timers / 204 unique.board
     Modul ayrica data/spawns.json'daki 64 unique yuvasini normal canavar
     dogusundan AYIRIYOR: onlar sirali yuva olarak duruyordu ve Jangan'da 11
     Tiger Girl AYNI ANDA sahaya cikiyordu.
     SON SIRADA kalmali ve YUKLU kalmali (S2 madde 5 on kosulu): gercekten
     bilinmeyen offerId'lere unknown_offer cevabini bu modul verir -
     kaldirilirsa revive.respond tamamen cevapsiz kalir. */
  'dirilis-unique',
];
const SISTEMLER = [];
/** Modul ornekleri (import edilmis mod nesneleri) - yeniden kurmak icin saklanir. */
const SISTEM_MODULLERI = new Map();

function sistemCtx() {
  return {
    world: WORLDSIM, combat: COMBAT, frame, broadcast, log,
    GCFG, ITEMSTATS: COMBAT.itemStats, zoneGroundY, yurunebilirNokta, dataDir: DATA, now,
    /* `web` ARTIK CANLI HAVUZ: initSql() bitince WEBPOOL doluyor ve moduller
       ya webBagla() ile ya da sistemleriKur() ile yeniden baglaniyor.
       Ilk kurulumda (initSql'den once) hala null - moduller bunu zaten
       "kalicilik kapali, bellekte calis" olarak ele aliyor. */
    envanterPayload, derived, SHARD: CFG.sql.databases.shard, web: WEBPOOL, sql,
    /* BOLGELER ARASI GECIS. Modul ws.zoneId'yi tek basina degistiremez:
       broadcast kumesi (`zones` Map'i) yalnizca server.js'te. Bu kanca
       olmadan sistem_donus-isinlanma capraz hedefleri REDDEDIYORDU ve
       `zone.transfer` (132) hic uretilmiyordu. true/false doner. */
    bolgeGecisi,
    /* ORTAK err/sys.notice URETICISI - bkz. "ORTAK BILDIRIM" blogu.
       Moduller kendi yerel hata()'larini kademeli olarak buna devredebilir:
           const { hata: ortakHata } = ctx;
           const hata = (ws, code, key, q) => ortakHata(ws, code, { key, q });
       Yardimci HER ZAMAN true doner (mesaj() sozlesmesi) ve enum disi
       code/key gondermeyi engeller. */
    hata, bildir, hamDuyuru,
    /* err/sys.notice/kick enum'lari - modul kendi dogrulamasini yapmak
       isterse (schemas.json'dan turetilmis, elle liste tutulmuyor). */
    ERR_KODLARI, ERR_ANAHTARLARI, BILDIRIM_ANAHTARLARI, KICK_SEBEPLERI,
    /* kick(241) + gecikmeli kapanis. Duz close() YETMEZ: istemci kicksiz
       kopusu ariza sanip resumeToken ile 1 sn sonra geri geliyor (@25652668). */
    kickAt,
    /* Baska bir sistem modulunun ORNEK'ine ada gore erisim.
       Ornek: binek/pet modulunun hiz(ws) / binekte(ws) kancalari.
       Modul yoksa null doner - cagiran daima ?. ile kullanmali. */
    sistemOrnegi,
    /* Hiz sinifi tablosu (schemas.json'dan): mesajAdi -> rateClass. */
    RATE_CLASS, RATE_SINIFLARI,
    /* MADDE 28 KANCASI: canavar oldurme olayina abone ol.
       fn(ws, mob, {kisi, uyeler, zoneId}) -> void; geri alma fonksiyonu doner.
       `ad` verilirse ayni ad ikinci kayitta oncekini EZER (Map anahtari) -
       boylece sistemleriKur() ile yeniden kurulan modul kancasini birikmeden
       tazeler; 'gorev' adi kullanilirsa gameloop'un sistemOrnegi('gorev')
       koprusu susar (gameloop.js olumKancasiEkle basligi). Gorev sayaci bu
       kanca OLMADAN da calisiyor (gameloop sistemOrnegi ile dogrudan
       cagiriyor); bu satir meslek/basari/lonca gorevi gibi BASKA modullerin
       de oldurmeye baglanabilmesi icin. */
    olumKancasiEkle: (fn, ad) => LOOP?.olumKancasiEkle?.(fn, ad) ?? (() => {}),
    /* TEHDIT KANCALARI (gameloop.js tehdit motoru "SINIR NOTU"): taunt ve
       aggroDrop birer beceri kullanim etkisi - kullanim yolu sistem_beceri.js
       (atesle "TEHDIT BAGLAMA" blogu), motor LOOP'ta. olumKancasiEkle ile
       ayni TEMBEL kalip: acilista LOOP henuz null olabilir, kur() aninda
       yakalanmaz, cagri aninda cozulur. */
    tauntUygula: (zoneId, mobId, ws, taunt) =>
      LOOP?.tauntUygula?.(zoneId, mobId, ws, taunt) ?? false,
    aggroDropUygula: (zoneId, ws, drop) =>
      LOOP?.aggroDropUygula?.(zoneId, ws, drop) ?? 0,
  };
}

/** Sistem modulu ornegi (ad -> ORNEK). Yoksa null. */
function sistemOrnegi(ad) {
  return SISTEMLER.find(s => s.ad === ad)?.ornek ?? null;
}

/* madde 13: oyuncunun O ANKI hizi. Taban game-config playerMoveSpeedU,
   binek mounts.json speedU (13.5/14.25/15.75), ustune moveSpeedPct buff
   carpani (sistem_binek-pet.hiz icinde sistem_beceri.hizCarpani okunur).
   Istemci hizi HESAPLAMIYOR, entity.move.speed'i okuyor (paket @25663413
   `this.selfSpeed = node.speed` - dogrulandi). Modul kurulmamissa taban
   hiza duser = bugunku davranis. GCFG her cagrida CANLI okunur, boylece
   admin panelinden playerMoveSpeedU degisince ek is gerekmez. */
function oyuncuHizi(ws) {
  return sistemOrnegi('binek-pet')?.hiz?.(ws) ?? GCFG.playerMoveSpeedU;
}

/* madde 5: MODUL MESGULIYET KILIDI - gameloop.js:70 `mesguliyet` kancasinin
   sozlesmesi (ws) => {code,key} | null. Cekirdegin goremedigi tek kilit
   TEZGAH: sistem_tezgah.js:642 acilista ws.tezgahAcik = true yaziyor ve
   istemci tezgah acikken HER tiklamayi yutuyor (paket @25677424 lgt:
   ownStallOpen -> ignore) - yani bu kareler yalniz uydurulmus istemciden
   gelir, sunucu reddetmek zorunda. err.busy.stall_open tr.json'da ve Eht
   enum'unda VAR (sistem_tezgah.js:100 dogrulamasi).
   Donus kanali kilidi EKLENMEDI: sistem_donus-isinlanma AKTIF haritasini
   disari acmiyor (_durum test icindir) ve kendi mesajlarini zaten kendisi
   kapiyor. Takas kilidi de EKLENMEDI: takas penceresi acikken tuvalin
   tiklanamadigina dair paket kaniti YOK - kanitsiz kapi gercek oyuncuyu
   bozabilir (dukkan tarafindaki takas kapisi madde 60'ta ayri ele aliniyor). */
function mesguliyetKilidi(ws) {
  if (ws?.tezgahAcik) return { code: 'ERR_BUSY', key: 'err.busy.stall_open' };
  return null;
}

/**
 * Modulleri (yeniden) kurar.
 *
 * NEDEN YENIDEN KURMA: bazi moduller ayarlari kur() aninda `const`'a
 * kopyaliyor (ornek: `const CANTA_YUVASI = GCFG.bagSlots`). Boyle bir modul
 * GCFG sonradan degisse bile eski degeri kullanmaya devam eder. Admin
 * panelinden ayar degistirilince modulleri yeniden kurarak hepsinin TAZE
 * degerleri okumasini garanti ediyoruz - sunucuyu yeniden baslatmaya gerek yok.
 */
function sistemleriKur(sessiz = false) {
  SISTEMLER.length = 0;
  for (const ad of SISTEM_ADLARI) {
    const mod = SISTEM_MODULLERI.get(ad);
    if (!mod) continue;
    try {
      const ornek = mod.kur(sistemCtx());
      if (ornek && typeof ornek.mesaj === 'function') SISTEMLER.push({ ad, ornek });
    } catch (e) {
      log(`sistem_${ad} kurulamadi: ${String(e.message).slice(0, 120)}`);
    }
  }
  if (!sessiz) log(`sistem modulu: ${SISTEMLER.length}/${SISTEM_ADLARI.length}`);
  return SISTEMLER.length;
}

/**
 * Bir mesaji sistem modullerine sirayla dagitir; ilk sahiplenen isler.
 * true = mesaj tuketildi.
 * Ayri fonksiyon olmasinin sebebi: giris akisi da SENTETIK `zone.ready`
 * mesajini AYNI yoldan gecirmek zorunda (bkz. giris.js, madde 3).
 */
function sistemlereDagit(ws, t, d, q) {
  for (const s of SISTEMLER) {
    /* `q`yu MUTLAKA gecir: istemci skill.cast(22) ve inv.use(49) icin
       {t,d,q} gonderiyor (sayac @25651442, gonderim @25653087) ve err
       karesinde onu GERI BEKLIYOR. q gitmezse istemcinin err isleyicisi
       (@27135789) once $gt(q) ile IYIMSER CAST'i iptal edemez (cast cubugu
       ekranda asili kalir, @25694958) ve sxt(q, code) ile IYIMSER ESYA
       BEKLEME SURESINI geri alamaz (@25929654). sistem_beceri.js:1043,
       sistem_envanter.js:547 ve sistem_stat-ustalik.js:519 imzalari zaten
       (ws, t, d, q); q'yu almayan moduller fazladan argumani gormezden gelir. */
    try { if (s.ornek.mesaj(ws, t, d, q)) return true; }
    catch (e) { log(`sistem_${s.ad} hata (${t}):`, String(e?.message ?? e).slice(0, 120)); }
  }
  return false;
}

/**
 * zone.init'ten SONRA gelen kare dizisini yollar (giris + bolge gecisi).
 * Canli yakalamadaki (GERCEK/zone_init.json) dizi:
 *     zone.init -> env.clock -> unique.timers -> guild.state
 *               -> batch[ pet.state, gpet.state, taction.marks,
 *                         carrier.state, quest.catalog, quest.state ]
 * Butun gerekce, sema kaynaklari ve `zone.ready` acikligi giris.js basliginda.
 */
function girisKareleriniYolla(ws, etiket = 'giris') {
  try {
    const yollanan = girisAkisi(ws, {
      gonder: frame,
      ham: hamGonder,
      dagit: sistemlereDagit,
      sistemler: SISTEMLER,
      tick: tik(),
      serverTime: now(),
      carrierSlotsMax: GCFG.carrier?.baseSlots,
      log,
    });
    log(`${etiket} kareleri: ${yollanan.tekil.join(', ')} + batch[${yollanan.toplu.join(', ')}]`);
    return yollanan;
  } catch (e) {
    log(`${etiket} kareleri hatasi:`, String(e?.message ?? e).slice(0, 160));
    return null;
  }
}

for (const ad of SISTEM_ADLARI) {
  const dosya = path.join(HERE, `sistem_${ad}.js`);
  if (!fs.existsSync(dosya)) continue;
  try {
    const mod = await import(pathToFileURL(dosya).href);
    if (typeof mod.kur !== 'function') { log(`sistem_${ad}: kur() yok, atlandi`); continue; }
    SISTEM_MODULLERI.set(ad, mod);
    log(`sistem yuklendi: ${ad}`);
  } catch (e) {
    log(`sistem_${ad} yuklenemedi: ${String(e.message).slice(0, 120)}`);
  }
}
sistemleriKur();

/* GM KOMUTLARI - gm.js modulu 13 komutla hazirdi ama handleGmChat HIC
   CAGRILMIYORDU; bu yuzden "/gm ..." satirlari sadece sohbete yaziliyordu.
   Yetki kontrolu gm.js icindeki isGm(ws.user) ile yapilir
   (TB_User.sec_primary/sec_content = 1). */
/**
 * GM KOMUT BAGLAMI - gm.js'in BEKLEDIGI TAM kanca kumesi.
 *
 * ESKIDEN yalniz {world, broadcast, frame, zoneNpcEntities, zoneGroundY, db}
 * geciriliyordu; oysa gm.js su sekiz kancayi da kullaniyor:
 *   nextTempEntityId, addTempEntities, clearTempEntities,
 *   broadcastAll, onlinePlayers, findPlayer, reloadConfig, logGm
 * ve komutlarin bir kismi cagri nesnesinden `derived` bekliyor.
 * Eksik olduklari icin /gm heal "derived is not a function",
 * /gm dummy ve /gm spawn "ctx.nextTempEntityId is not a function" hatasi
 * veriyordu - komutlarin cogu HIC calismiyordu.
 *
 * Gecici varliklar entitySayaci'ni PAYLASIR (oyuncu id'leriyle carpismasin)
 * ve bolge bazinda tutulur ki `/gm clear` yalnizca kendi urettiklerini silsin.
 */
const GECICI_VARLIKLAR = new Map();   // zoneId -> Set<entityId>

function gmBaglami() {
  return {
    world: WORLDSIM, broadcast, frame, zoneNpcEntities, zoneGroundY, db: null, log,
    derived,
    /* Genisletilmis komutlarin ihtiyaclari: /gm item ve /gm find katalog,
       /gm gold ve /gm clearbag envanter karesi, /gm rate admin modulu,
       /gm save kayit, /gm zone bolge gecisi. */
    ITEMSTATS: COMBAT.itemStats,
    envanterPayload,
    admin: ADMIN,
    kaydet: (w) => { konumuKaydet(w); return Promise.resolve(); },
    bolgeGecisi: (w, z) => bolgeGecisi(w, z),

    /** Oyuncu id'leriyle CARPISMAYAN yeni gecici varlik kimligi. */
    nextTempEntityId: () => ++entitySayaci,

    /** Uretilen varliklari dunyaya ekler ve bolgeye yayar. */
    addTempEntities: (zoneId, liste) => {
      if (!Array.isArray(liste) || !liste.length) return 0;
      const kume = GECICI_VARLIKLAR.get(zoneId) ?? new Set();
      for (const e of liste) {
        try { WORLDSIM.varlikEkle?.(zoneId, e); } catch { /* dunya kabul etmezse yalniz yayinla */ }
        kume.add(e.id);
      }
      GECICI_VARLIKLAR.set(zoneId, kume);
      broadcast(zoneId, 'state.delta', { add: liste });
      return liste.length;
    },

    /** YALNIZCA GM'in urettigi gecici varliklari siler - dogal canavarlara dokunmaz. */
    clearTempEntities: (zoneId) => {
      const kume = GECICI_VARLIKLAR.get(zoneId);
      if (!kume || !kume.size) return [];
      const idler = [...kume];
      for (const id of idler) {
        try { WORLDSIM.varlikSil?.(zoneId, id); } catch { /* zaten yok */ }
      }
      GECICI_VARLIKLAR.delete(zoneId);
      return idler;
    },

    /** TUM bolgelere ayni kareyi yollar (duyuru icin). */
    broadcastAll: (t, d) => {
      try { for (const [zid] of zones) broadcast(zid, t, d); } catch { /* zones yok */ }
    },

    /** Cevrimici oyuncu ozetleri. */
    onlinePlayers: () => {
      const out = [];
      try {
        for (const [zid, set] of zones) {
          for (const c of set) {
            if (!c.isAuthed || !c.char) continue;
            out.push({ name: c.char.name, level: c.char.level, zone: zid,
                       x: Math.round(c.char.x), z: Math.round(c.char.z) });
          }
        }
      } catch { /* zones yok */ }
      return out;
    },

    /** Ada gore oyuncu soketi bul (buyuk/kucuk harf duyarsiz). */
    findPlayer: (ad) => {
      const hedef = String(ad ?? '').toLowerCase();
      if (!hedef) return null;
      try {
        for (const [, set] of zones) {
          for (const c of set) {
            if (c.isAuthed && String(c.char?.name ?? '').toLowerCase() === hedef) return c;
          }
        }
      } catch { /* zones yok */ }
      return null;
    },

    /** /gm reloadcombat - savas ayarlarini yeniden yukle. */
    reloadConfig: () => {
      try {
        const n = COMBAT.yenidenYukle ? COMBAT.yenidenYukle() : 0;
        sistemleriKur(true);
        return n || 1;
      } catch (e) { log(`reloadConfig: ${String(e.message).slice(0, 120)}`); return 0; }
    },

    /** GM islem kutugu - su an yalnizca sunucu gunlugune. */
    logGm: (ws, komut, ok) => {
      log(`[gm] ${ws.char?.name ?? '?'} : ${komut} -> ${ok ? 'ok' : 'HATA'}`);
    },
  };
}

const GM_KOMUTLARI = buildCommands(gmBaglami());
log(`GM komutlari: ${GM_KOMUTLARI.size}`);

/**
 * OYUNCUYU DUNYAYA ALIR - hem BILETLE giriste hem RESUME ile geri donuste.
 *
 * ASENKRON OLMASININ SEBEBI: sistem modullerinin kalici verisi (ustalik,
 * ogrenilen beceri, hotbar/otoIksir/makro, lonca) zone.init.self ICINDE
 * gitmek zorunda - istemci bu kayitlari BASKA hicbir kareden okumuyor.
 * Bu yuzden modullerin yukle(ch) kancalari zone.init YOLLANMADAN ONCE
 * await ediliyor (bkz. modulleriYukle).
 *
 * @param surdurme  true ise resumeToken ile geri donus (bilet yok).
 */
async function dunyayaAl(ws, tk, ch, surdurme = false) {
  // SQL'den gelen kayit: konum/zone alanlarini oyun icin normalize et
  ch.zone ??= CFG.world.startZone;
  if (ch.x == null || ch.z == null) {
    const sp = spawnPointOf(ch.zone);
    ch.x = sp.x; ch.z = sp.z;
  }
  /* TEK-NOKTA SAYI NORMALIZASYONU (kok recete): tedious bigint kolonlari
     (_Char.RemainGold/ExpOffset) METIN dondurur; `??=` metni GECIRIR
     ("1000" ?? 0 -> "1000") ve asagi akista ham `+` birlestirme yapar
     ("1000000017"+500 -> 1 trilyon sanilir, gameloop.js:585 kalibi).
     dunyayaAl HER dunyaya giriste (bilet + resume) calistigi icin burasi
     tek bogaz noktasi; routes_auth.js:734/736 Number() ilk hat, tuketici
     sarmalari (sayi/tamsayi) ikinci hat olarak KALIR. */
  const N = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  ch.str = N(ch.str, 20); ch.int = N(ch.int, 20);
  ch.xp = N(ch.xp, 0); ch.spExp = N(ch.spExp, 0); ch.sp = N(ch.sp, 0);
  ch.statPoints = N(ch.statPoints, 0); ch.gold = N(ch.gold, 0);
  ch.hp = N(ch.hp, ch.hp); ch.mp = N(ch.mp, ch.mp);
  {
    const d0 = derived(ch);
    /* FARK #114 (kritik): OLU KARAKTERIN CANI DOLDURULMAZ.
       resume yolu AYNI ch nesnesini yeniden kullaniyor (resumeJetonlari
       {char: ch}); oluyken kopan oyuncuda ch.dead=true ve hp=0'dir. Eski
       `if (!ch.hp) ch.hp = maxHp` bu durumda cani dolduruyordu: istemciye
       dead=true + DOLU HP giden "yari olu" bir hal cikiyordu (perde acik,
       ama HP cubugu dolu). POLITIKA: olu durum KALICI - istemci perdeyi
       self.dead'den aciyor (sema `dead: RJ()` @25597869, varlikta
       @25591416 optional) ve oyuncu "Sehre don" ile respawn.request (80)
       gonderiyor; #dirilt HP'yi respawnHpPct ile kendisi kurar. */
    if (ch.dead) {
      ch.hp = 0;
    } else if (!ch.hp || ch.hp > d0.maxHp) {
      ch.hp = d0.maxHp;
    }
    if (!ch.mp || ch.mp > d0.maxMp) ch.mp = d0.maxMp;
  }
  ws.user = { JID: tk.JID, sec_primary: tk.sec_primary, sec_content: tk.sec_content };

  /* MODUL VERISI zone.init'ten ONCE yuklenir - ayrinti modulleriYukle'de.
     Bayraklar (isAuthed/char/zoneId) BU BEKLEMEDEN SONRA kuruluyor: aksi
     halde bekleme suresince gelen mesajlar "yetkili ama dunyada degil"
     bir sokete duser (zones kumesinde yok, WORLDSIM.oyuncuGir cagrilmadi). */
  await modulleriYukle(ch);
  /* Kayitli canta/kusam. ESKIDEN await EDILMIYORDU (isleyici senkrondu):
     zone.init.self.inventory BASLANGIC setiyle gidiyor, kayit birkac ms
     sonra inv.update ile yamaniyordu. Bu hem gorunur bir "esyalar sonradan
     geldi" titremesi hem de yaris kapisi: arada calisan bir modul ch.bag'i
     okuyup/yazip kaydi ezebiliyordu. Artik ONCE yukleniyor.
     Kayit yoksa (ilk giris) yukle() false doner, baslangic seti kalir. */
  if (KALICI) {
    try { await KALICI.yukle(ch); }
    catch (e) { log('envanter yuklenemedi:', String(e?.message ?? e).slice(0, 140)); }
  }
  /* Bekleme sirasinda soket kapandiysa dunyaya sokma - aksi halde bolge
     kumesinde olu bir soket ve hayalet varlik kalir. */
  if (ws.readyState !== ws.OPEN) return;

  ws.isAuthed = true;
  ws.char = ch;
  /* KAYMALI HAREKET yalniz OYUNCUNUN KENDI karakterinde. Istemci kendi
     karakterini moveCircle ile (duvar boyunca kayarak), uzak varliklari ise
     igt() ile DUZ interpolasyonla yuruyor; isaret olmadan pet/binek/canavar
     da kaymali dala girerdi ve istemcinin gordugu yol sunucununkinden
     ayrilirdi. Symbol anahtari JSON'a yazilmaz - kalicilikta iz birakmaz. */
  ch[KAYMALI] = true;
  ws.entityId = ++entitySayaci;
  ws.zoneId = ch.zone;
  /* HER GIRISTE zemine otur - AMA kayitli y'yi TOHUM olarak kullanarak.
     Eskiden `ch.y = zoneGroundY(zone, x, z)` yaziyordu; tohum verilmedigi
     icin kayitli y (oyuncunun cikis yaptigi KAT) siliniyor ve oyuncu
     her giriste kopru/platform altindaki araziye dusuyordu. Yedek tohum
     bolgenin dogus noktasi y'si (paket zone JSON'u). */
  ch.y = zeminTohumlu(ws.zoneId, ch.x, ch.z, ch.y, bolgeTanimi(ws.zoneId).playerSpawn?.y);
  /* DOGUS KORUMASI - artik KARAKTERDE tutuluyor, yalniz kare icinde degil.
     Eskiden selfPayload icinde hesaplanip gonderiliyordu ama sunucu onu
     hicbir yerde KONTROL ETMIYORDU: oyuncu dogar dogmaz saldirabiliyordu.
     referans oyunda kural iki yonlu (tr.json ui.spawn.protected_chip_desc:
     "canavarlar ve oyuncular sana saldiramaz, sen de saldiramazsin").
     Kontroller: gameloop #saldiriBasla (oyuncu -> canavar) ve
     #canavarYZ (canavar -> oyuncu). */
  ch.safeUntil = now() + GCFG.spawnSafeTimeMs;

  /* auth.ok (129) semasi: X({ charId: J(), resumeToken: J() }) - IKI ALAN DA
     ZORUNLU (paket @25618380). Token artik SAKLANIYOR: istemci kicksiz bir
     kopustan 1000 ms sonra onunla TEK bir kez geri geliyor (@25652668).
     Eskiden uretilip atiliyordu, dolayisiyla o deneme HER ZAMAN basarisizdi. */
  const yeniJeton = uid().replace(/-/g, '');
  if (ws._resumeToken) resumeJetonlari.delete(ws._resumeToken);
  ws._resumeToken = yeniJeton;
  resumeJetonlari.set(yeniJeton, {
    JID: tk.JID, sec_primary: tk.sec_primary, sec_content: tk.sec_content, char: ch,
    /* gameConfig.linkdeadGraceMs = 15000 (data/game-config.json). Jetonun tam
       olarak bu pencereyi kullandigina dair PAKET KANITI YOK - deger tek bir
       kaynaga baglansin diye oradan aliniyor. */
    exp: now() + (GCFG.linkdeadGraceMs ?? 15_000),
  });
  frame(ws, 'auth.ok', { charId: ch.id, resumeToken: yeniJeton });

  /* AYNI KARAKTERLE acik kalan eski soketi dusur.
     Sayfa yenilendiginde tarayici 'close' olayini gecikmeli yolluyor;
     eski soket bolge kumesinde kalinca oyuncu SEHIRDE KENDI HAYALETINI
     goruyordu ("1 tanede benden var") ve sohbet iki kez geliyordu.
     referans oyunun canli zone.init'inde tek bir player varligi vardi. */
  for (const [zid, kume] of zones) {
    for (const c of [...kume]) {
      if (c === ws || !c.isAuthed || c.char?.id !== ch.id) continue;
      kume.delete(c);
      WORLDSIM.oyuncuCik(c);
      broadcast(zid, 'state.delta', { rem: [c.entityId] }, c);
      /* ESKIDEN: frame(c,'err',{code:'session_replaced'}) + close(4009).
         'session_replaced' err.code enum'unda (Sht @25603148) YOK -> istemci
         `err.session_replaced` yerellestirmesini bulamayip EKRANA HICBIR SEY
         basmiyordu. Dogrusu kick(241) reason='login_elsewhere'
         (@25632124; tr.json kick.login_elsewhere = "Baglanti kesildi - bu
         hesaba baska bir yerden giris yapildi."). Ustelik kick karesi
         istemcide W$.disconnect() cagirdigi icin (@27135573) dusen oturum
         resume DENEMEZ - resumeToken destegi eklendikten sonra bu SART,
         yoksa eski istemci 1 sn sonra oturumu geri alip dongu kurar.
         kickAt ayrica o soketin resume jetonunu da iptal ediyor. */
      kickAt(c, 'login_elsewhere', 4009);
      log(`eski oturum dusuruldu: ${ch.name} (entity ${c.entityId})`);
    }
  }

  if (!zones.has(ws.zoneId)) zones.set(ws.zoneId, new Set());
  const peers = [...zones.get(ws.zoneId)].filter(c => c.isAuthed);
  zones.get(ws.zoneId).add(ws);

  const zmeta = ZONES[ws.zoneId] || { name: ws.zoneId, kind: 'field' };
  frame(ws, 'zone.init', {
    zoneId: ws.zoneId, zoneName: zmeta.name, kind: zmeta.kind,
    /* tick SABIT 0 IDI - istemci bunu zaman ekseninin sifir noktasi
       (tick0) olarak aliyor ve sonraki her batch icin
       tickTime(t) = serverTime0 + (t - tick0)*100 hesapliyor. Sayacimiz
       surekli artarken tick0'i 0 vermek, ilerideki her kareyi sunucu
       acilisindan bu yana gecen sure kadar GELECEGE tasiyordu. */
    tick: tik(), serverTime: now(),
    self: selfPayload(ch, ws.entityId),
    // ONEMLI: oyuncunun KENDI varligi da bu dizide olmali. Istemci
    //   entities.find(n => n.id === self.entityId)
    // ile kendi avatarini buradan yaratiyor; eksikse avatar hic olusmaz,
    // kamera takip edecek bir sey bulamaz ve dunya bombos gorunur.
    entities: (() => {
      WORLDSIM.oyuncuGir(ws);
      const liste = [
        entityPayload(ch, ws.entityId),
        ...zoneNpcEntities(ws.zoneId),
        ...peers.map(c => entityPayload(c.char, c.entityId)),
        // Yakindaki canavarlar. TUM bolgeyi degil sadece gorus alanini
        // gonderiyoruz - Samarkand'da 7.500 canavar var, hepsini birden
        // yollamak hem agi hem istemciyi bogar.
        ...WORLDSIM.yakindakiler(ws),
      ];
      WORLDSIM.gorunenleriKur(ws, liste);
      return liste;
    })(),
  });
  broadcast(ws.zoneId, 'state.delta', { add: [entityPayload(ch, ws.entityId)] }, ws);

  /* GIRIS KARELERI - canli yakalamadaki (GERCEK/zone_init.json) dizi:
       zone.init -> env.clock -> unique.timers -> guild.state
                 -> batch[ pet.state, gpet.state, taction.marks,
                           carrier.state, quest.catalog, quest.state ]
     Ayrintili gerekce + sema kaynaklari giris.js basliginda.
     NOT: buradaki `zone.ready` SENTETIK - istemci o mesaji HIC gondermiyor
     (27 MB'lik pakette send(`zone.ready`) sifir adet), ama moduller giris
     kurulumlarini ona baglamis; sunucu uretmezse hicbiri calismiyordu. */
  girisKareleriniYolla(ws, surdurme ? 'surdurme' : 'giris');

  log(`WS ${surdurme ? 'surdurme' : 'giris'}: ${ch.name} (entity ${ws.entityId}) -> ${ws.zoneId}`);
}

/**
 * Modullerin KARAKTER BAZLI kalici verisini ch uzerine kurar.
 *
 * Uc modul bunu kendi BAGLAMA NOTU'nda acikca istiyor ve ucu de
 * yukle(ch) adiyla disa aciyor:
 *   sistem_stat-ustalik.js:463  -> ch.masteries / ch.knownSkills (vSRO)
 *   sistem_arayuz-durumu.js:359 -> ch.hotbar / ch.autoPotion / ch.macro
 *   sistem_lonca.js:1273        -> lonca uyeligi
 * Cagrilmadigi surece zone.init.self bu alanlari BOS gonderiyordu; sema
 * gecerli oldugu icin ([] dogru tip) hicbir hata gorunmuyor, ama istemcinin
 * beceri tepsisi bos kaliyor ve her cast ERR_UNKNOWN_SKILL yiyordu.
 * Bir modul patlarsa giris DEVAM EDER - kalicilik sessizce kapali kalir.
 */
async function modulleriYukle(ch) {
  for (const { ad, ornek } of SISTEMLER) {
    if (typeof ornek?.yukle !== 'function') continue;
    try { await ornek.yukle(ch); }
    catch (e) { log(`sistem_${ad}.yukle hatasi: ${String(e?.message ?? e).slice(0, 140)}`); }
  }
}

wss.on('connection', (ws) => {
  ws.isAuthed = false;
  /* referans oyun canli yakalamasi: sunucu BAGLANTI aninda `hello` yolluyor,
     istemci sonra `auth` gonderiyor. Bizde hello auth'un ICINDE idi.
     requiredVersion opsiyonel - gondermiyoruz ki surum uyusmazligi
     (close 4007) cikmasin. */
  frame(ws, 'hello', { worldId: CFG.world.id, proto: CFG.world.proto, serverTime: now() });
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    const { t, d = {}, q } = msg;

    /* HIZ KAPISI - HER mesajin ONUNDE, `auth` dahil (auth'un kendi sinifi var).
       Karar tablosu ve neden esiklerin sunucuda tutuldugu icin bkz.
       "HIZ SINIRLAYICI" blogu.
         yavasla -> err(240) ERR_RATE, baglanti KOPMAZ
         kick    -> kick(241) rate_limit + kapanis
       `q` yankilaniyor: istemci err.q ile iyimser cast'i (cancelByQ
       @25694958) ve esya bekleme suresini (sxt @25929654) geri aliyor;
       ERR_RATE q'suz gelirse asili kalan cast cubugu duzelmez. */
    const hizKarar = hizKapisi(ws, t);
    if (hizKarar === 'kick') return kickAt(ws, 'rate_limit');
    if (hizKarar === 'yavasla') return hata(ws, 'ERR_RATE', { q });

    if (t === 'auth') {
      /* IKI GIRIS YOLU (auth semasi @25608723: ticket/resumeToken/version/proto
         DORDU DE opsiyonel - ayrimi BILETIN VARLIGI belirler):
           a) BILET  : REST /characters/:id/enter'in verdigi tek kullanimlik bilet
           b) RESUME : kick karesi OLMADAN kopan soketten 1000 ms sonra
                       istemcinin TEK denemesi - { resumeToken, version, proto:9 }
                       (paket @25652482-25652830). */
      let tk = null, surdurme = false;
      if (!d.ticket && d.resumeToken) {
        surdurme = true;
        tk = resumeJetonlari.get(d.resumeToken) ?? null;
        resumeJetonlari.delete(d.resumeToken);          // TEK KULLANIMLIK
        /* 'bad_ticket' gibi uydurma kodlar err.code enum'unda (Sht @25603148)
           YOK: istemci `err.<kod>` yerellestirmesini bulamayip ekrana HICBIR
           SEY basmiyordu. ERR_AUTH enum'un gecerli 2. degeri. */
        if (!tk || tk.exp < now()) { hata(ws, 'ERR_AUTH'); return ws.close(4001); }
      } else {
        tk = tickets.get(d.ticket);
        if (!tk || tk.exp < now()) { hata(ws, 'ERR_AUTH'); return ws.close(4001); }
      }
      if (d.proto !== undefined && d.proto !== CFG.world.proto) {
        /* close(4007) AYNEN KALIR - dogru semantik: istemci bu kodu surum
           uyusmazligi sayip resume DENEMIYOR, B$() ile 60 000 ms icinde en
           fazla 2 kez sayfayi yeniliyor (@25649392: Vht=2, Hht=6e4). */
        hata(ws, 'ERR_VERSION'); return ws.close(4007);
      }
      if (!surdurme) tickets.delete(d.ticket);
      const ch = tk.char ?? null;
      if (!ch) { hata(ws, 'ERR_AUTH'); return ws.close(4001); }
      dunyayaAl(ws, tk, ch, surdurme).catch((e) => {
        log('giris hatasi:', String(e?.message ?? e).slice(0, 160));
        try { ws.close(1011); } catch { /* zaten kapali */ }
      });
      return;
    }

    if (!ws.isAuthed) return;

    // Savas/hedef/ganimet mesajlarini oyun dongusu isler.
    // `q` GECIRILIYOR: err karesinde geri yansitilmazsa istemcinin iyimser
    // cast'i ve esya bekleme suresi geri alinamiyor (bkz. sistemlereDagit).
    if (LOOP && LOOP.mesaj(ws, t, d, q)) return;

    // Sistem modulleri (envanter, dukkan, beceri, gorev ...) - ilk sahiplenen isler.
    if (sistemlereDagit(ws, t, d, q)) return;

    switch (t) {
      case 'ping':
        frame(ws, 'pong', { t: d.t ?? 0, serverTime: now() }); break;

      case 'zone.ready':
        /* Bu dala normalde HIC GIRILMEZ: istemci `zone.ready` GONDERMIYOR
           (paket icinde send(`zone.ready`) sifir adet; sadece sema tablosunda
           geciyor, @624050). Giriste mesaji SUNUCU uretiyor - bkz. auth
           blogundaki girisAkisi() cagrisi. Dal, ileride bir istemci surumu
           gercekten yollarsa saati TAZELESIN diye duruyor.

           SEMA (@624412): env.clock (205) =
               { serverTime, time 0..1, moonPhase 0..29, rate }
           `dayPct` diye bir alan YOK ve ucu de ZORUNLU.
           DENETIM DUZELTMESI: burada eskiden "eski kare istemcide TAMAMEN
           REDDEDILIYORDU" yaziyordu; bu DOGRU DEGIL. Istemci gelen kareyi
           Zod ile dogrulamiyor (dispatch -> invoke, paket @625563), env.clock
           isleyicisi de sadece `uyt.setAnchor(e)` cagiriyor (@654484) ve
           setAnchor gelen nesneyi mevcut duruma YAYIYOR (@25774052):
               setAnchor: e => set({ ...e, serverDelta: e.serverTime - Date.now() })
           Yani {serverTime, dayPct} yollayinca dayPct sessizce yok sayiliyor,
           time/moonPhase/rate ise MAGAZA VARSAYILANINDA kaliyordu
           (time .5, moonPhase 15, rate 0) - sonuc: gun-gece dongusu ogle
           vaktinde DONMUS kaliyordu, "reddedilme" degil.
           rate CANLI YAKALAMADAN gelir (GERCEK/zone_init.json):
               0.0005000000237487257 = Math.fround(0.0005)  -> 1 gun = 2000 sn.
           rate 0 vermek gun-gece dongusunu DONDURUR (istemci c9e ile kendi
           ilerletiyor), o yuzden gercek hiz yollaniyor. */
        frame(ws, 'env.clock', envClockKare(now(), GUN_HIZI));
        /* `sys.welcome` diye bir locale anahtari YOK (uydurulmustu) - kaldirildi.
           Gecerli anahtarlar client/assets/locales/tr.json icindeki sys.* (189 adet). */
        break;

      case 'move.click': {
        /* ISINLANMA YOK. Eskiden burada ws.char.x/z/y aninda hedefe tasiniyordu;
           bu, sunucunun konumunu istemcininkinden kalici olarak ayirip
           (olculen 25.70 birim) istemcinin applyMove'undaki `>3` dalini surekli
           tetikliyordu. O dal oyuncunun Y'sini sunucunun fy'siyle EZIYOR, yanlis Y
           de Y-bantli collider'larin (%99.997) tamamini devre disi birakiyor:
           duvarlarin icinden gecme ve zemine gomulme bundandi. Ayrintili aciklama
           bacak.js basliginda.

           Artik sadece "bacak" kuruluyor; konumu her tik bacakIlerlet ilerletiyor.
           Istemci de kendi advanceSelf/moveCircle'i ile ayni yolu yuruyor. */
        /* OLU OYUNCU HAREKET EDEMEZ.
         *
         * Kullanicinin bildirimi: "oldugumde gezebiliyorum, referans oyunda boyle
         * birsey yok, oldugun yerde duruyorsun."
         *
         * MESRU ISTEMCI ZATEN GONDERMEZ - hareketin UC ayri yolunda da olum
         * kapisi var (paket index-BUMMQVRB.js):
         *   @25681891 wgt():  return !vec || vec.dead ? !1 : (...)
         *   Egt():            if (!vec || vec.dead) { u1(`you_dead`); return }
         *   @25685442 Ugt():  if (!vec || vec.dead || ...) return
         * Yani bu kare olu bir oyuncudan geliyorsa ya istemcinin varlik
         * deposundaki `dead` bayragi yanlis (bizim entityPayload'imiz uzun
         * sure `dead: false` SABIT gonderdi - duzeltildi) ya da uydurulmus
         * bir istemci var. Iki durumda da sunucu REDDETMELI: sunucu otorite.
         *
         * Sessizce dusuruyoruz - istemci zaten bu durumda kare gondermedigi
         * icin mesru oyuncuya hicbir uyari gitmemeli. */
        if (ws.char?.dead) break;

        /* madde 5 - KAPILAR (hepsi SESSIZ red: mesru istemci bu durumlarin
           hicbirinde move.click GONDERMIYOR, uyariya gerek yok):
           1) NaN/Infinity: sema X({x:Y(), z:Y()}) @25608908 sayi istiyor ama
              sunucu dogrulamiyordu - NaN bacaga sizip konumu bozabilirdi.
           2) Tezgah: istemci tezgah acikken her tiklamayi yutuyor
              (@25677424); ayni kilit mesguliyetKilidi ile savas yolunda da var.
           3) CC / emici duvar / serilme: istemci de gondermiyor
              (@25681974 Egt selfCcLocked, tr.json ui.buffs.wall_title
              "...Duvar ayaktayken hareket edemezsin..."). */
        const hamX = d.x ?? d.tx ?? ws.char.x;
        const hamZ = d.z ?? d.tz ?? ws.char.z;
        if (!Number.isFinite(hamX) || !Number.isFinite(hamZ)) break;
        if (mesguliyetKilidi(ws)) break;
        if (sistemOrnegi('beceri')?.hareketKilidi?.(ws)) break;

        /* DALMA KESME (referans oyun paritesi): hareket niyeti angajmani bitirir.
           Referans istemci zemin tiklamasinda YALNIZ move.click gonderir -
           once combat.stop karesi YOK (paket zemin-tik isleyicisi @19674900,
           7 combat.stop gonderiminin hicbiri bu yolda); angajmani sunucu
           kapatmak zorunda. Yoksa #oyuncuSaldirilari her tikte #hedefeYaklas
           ile oyuncuya moba donuk YENI bacak yayinlar ve istemcinin applyMove
           self-koruma olmadigi icin tiklanan yol EZILIR (olculen: move.click
           tx=-15.00 -> tik+1'de bacak tx=17.30 GERI DONDU).
           SINIRLAR: satir kapilarin ARKASINDA durmali (cast/CC/tezgah
           kilidinde dusen kare angajman BOZMAMALI - referans istemci o
           durumda kareyi zaten hic gondermiyor, qgt @18744244). YALNIZ
           ws.savas silinir: ws.hedefId (secili hedef korunur - istemci
           target.set/clear'i hic gondermiyor), ws.alma, gpet g.hedefId ve
           mob.hedefEntityId'ye DOKUNULMAZ; combat.stop yolu (#saldiriDur)
           aynen kalir (makro silah degisimi + filler release sozlesmesi). */
        ws.savas = null;

        /* madde 5: hedef BOLGE SINIRINA kirpilir - istemcinin
           resolveWalkTarget'i ile birebir (paket @25672655, dogrulandi):
               x = Eq(x, bounds.minX + .5, bounds.maxX - .5)
               z = Eq(z, bounds.minZ + .5, bounds.maxZ - .5)
           0.5 payi paketten. Collider disina itme (resolvePoint) zaten
           bacakKur icinde calisiyor (yurunebilirNokta.hedefCoz, bacak.js:140);
           geriye yalniz bu kirpma kalmisti. boundsU 5 bolgenin hepsinde var
           (bolgeTanimi normalize ediyor); yoksa kirpma atlanir. */
        let hedefX = hamX, hedefZ = hamZ;
        const sinir = bolgeTanimi(ws.zoneId).boundsU;
        if (sinir) {
          hedefX = Math.min(Math.max(hedefX, sinir.minX + 0.5), sinir.maxX - 0.5);
          hedefZ = Math.min(Math.max(hedefZ, sinir.minZ + 0.5), sinir.maxZ - 0.5);
        }
        /* madde 13: hiz artik oyuncuHizi(ws) - binek + buff carpanli. */
        const mv = bacakKur(ws.char, ws.zoneId, hedefX, hedefZ,
                            oyuncuHizi(ws), yurunebilirNokta);
        if (mv) {
          const kare = { id: ws.entityId, ...mv };   // `ty` YOK - semada tanimli degil
          frame(ws, 'entity.move', kare);
          broadcast(ws.zoneId, 'entity.move', kare, ws);
        }
        break;   // ilgi guncellemesi tike tasindi (konum orada degisiyor)
      }

      case 'move.stop': {
        /* madde 5 / fark #119: olu oyuncudan move.stop da kabul edilmez -
           mesru istemci gondermiyor (applyDeath path'i kendisi null'luyor). */
        if (ws.char?.dead) break;
        bacakDurdur(ws.char);          // yurumeyi kes - konum artik GERCEK ara nokta
        const st = { id: ws.entityId, x: ws.char.x, z: ws.char.z, y: ws.char.y ?? 0 };
        frame(ws, 'entity.stop', st);
        broadcast(ws.zoneId, 'entity.stop', st, ws);
        break;
      }

      case 'chat.send': {
        const metin = String(d.text ?? '').slice(0, 200);
        if (!metin) break;                 // c2s sema: text J().min(1).max(200)
        /* Once GM komutu mu diye bak. Komut degilse null doner ve normal
           sohbet gibi devam eder. */
        /* GM yetkisini CANLI tazele: DB'de rutbe verilince oyuncunun oyundan
           cikip girmesi gerekmesin. ws.user gm.js'teki isGm() tarafindan
           sec_primary/sec_content uzerinden okunuyor. */
        const gmKontrol = metin.trim().startsWith('/gm') && ws.user?.JID != null
          ? AUTH.gmTazele(ws.user.JID).then((g) => {
              ws.user.sec_primary = g ? 1 : (ws.user.sec_primary ?? 0);
              ws.user.sec_content = g ? 1 : (ws.user.sec_content ?? 0);
            }).catch(() => {})
          : Promise.resolve();

        gmKontrol.then(() => handleGmChat(metin, ws, GM_KOMUTLARI, gmBaglami())
          .then((r) => {
          if (!r) {
            /* SEMA: chat.recv (160) = { ch, from, text, fromTier? }
               ch = local|global|party|guild|system  -  `channel` diye bir alan YOK.
               Eski kod hem yanlis alan adi kullaniyor hem de istemcinin
               gonderdigi kanali (c2s chat.send 64: { ch, text }) yok sayip her
               satiri 'global' etiketliyordu.
               DENETIM DUZELTMESI: burada "kare Zod'dan gecemedigi icin
               HICBIR sohbet satiri ekrana dusmuyordu" yaziyordu - DOGRU
               DEGIL. Istemcinin gelen yolunda dogrulama YOK (kodek duz
               JSON; T$ semasi gelen karede kullanilmiyor). Sohbet deposu
               `push(d)` ile kareyi OLDUGU GIBI sakliyor, sohbet paneli ise
               once `m.ch !== 'system'` suzuyor, sonra secili sekme icin
               `m.ch === tab` suzuyor. Yani `channel` adiyla gonderilen
               satir "all" sekmesinde GORUNUYOR, ama global/party/guild
               sekmelerinde ve sistem panelinde KAYBOLUYORDU; kanal rengi/
               oneki de cozulemiyordu. */
            const kanal = KANALLAR.has(d?.ch) ? d.ch : 'local';
            /* S1 MADDE 9 - sohbette altin isim: chat.recv (160) semasinda
               fromTier OPSIYONEL; istemci paneli color:NTt(fromTier) +
               fontWeight:600 ile boyar (NTt = premium.tiers nameColor,
               gold #ffd94a). premiumTier(ws) API'si disa acik ve sure
               dolmussa null doner; tier yokken alan HIC eklenmez (referans oyun
               paritesi). Kare TEK burada kurulup party/lonca/global/local/
               yansima dallarinin HEPSINE gittigi icin tier dal ici DEGIL
               kurulum noktasinda yazilir. GM cevabi (ch:'system'), duyuru()
               ve chat.pm (162) karelerine EKLENMEZ - onlarin semasinda yok. */
            const tier = sistemOrnegi('kucuk-sistemler')?.premiumTier?.(ws) ?? null;
            const kare = { ch: kanal, from: ws.char.name, text: metin,
                           ...(tier ? { fromTier: tier } : {}) };
            /* FARK #1/#181 - PARTI SOHBETI. Istemci kendi yazdigi satiri
               YEREL EKLEMIYOR (paket @27378460: yalniz W$.send), yani her
               satiri sunucu dagitmak zorunda - gonderen DAHIL.
               kanalaYayinla (sistem_parti.js:1068) partisiz oyuncuda 0
               doner; tr.json sys.party.not_in_party = "Bir partide degilsin."
               (sema Tht enum'unda da var - dogrulandi).
               Bu dallardan RETURN edilir - alttaki tekil frame'e dusulurse
               satir gonderene IKI kez gorunur. */
            if (kanal === 'party') {
              const PARTI = sistemOrnegi('parti');
              if (typeof PARTI?.kanalaYayinla === 'function') {
                if (!PARTI.kanalaYayinla(ws, 'chat.recv', kare)) {
                  bildir(ws, 'sys.party.not_in_party');
                }
              } else {
                frame(ws, 'chat.recv', kare);   // modul yok: eski davranis (yalniz gonderen)
              }
              return;
            }
            /* FARK #1/#181 - LONCA SOHBETI. sistem_lonca.js kanalaYayinla
               kancasi ARTIK VAR (capraz istek 65) - cevrimici lonca uyelerine
               gonderen DAHIL dagitir; loncasiz oyuncuda 0 doner. Lonca disi
               oyuncu icin gecerli bir bildirim anahtari YOK (Tht listesinde
               sys.guild.not_in_* bulunmuyor - dogrulandi), uydurmuyoruz:
               sessiz birakiyoruz. */
            if (kanal === 'guild') {
              const LONCA = sistemOrnegi('lonca');
              if (typeof LONCA?.kanalaYayinla === 'function') {
                LONCA.kanalaYayinla(ws, 'chat.recv', kare);
              } else {
                frame(ws, 'chat.recv', kare);   // kanca yok: eski davranis (yalniz gonderen)
              }
              return;
            }
            if (kanal === 'global') {
              for (const [zid] of zones) broadcast(zid, 'chat.recv', kare, ws);
            } else if (kanal === 'local') {
              broadcast(ws.zoneId, 'chat.recv', kare, ws);
            }
            /* global/local: broadcast gonderen HARIC yayinladi; kendi satiri
               burada yansitilir (istemci yerel eklemiyor - @27378460). */
            frame(ws, 'chat.recv', kare);
            return;
          }
          // GM cevabi SADECE komutu yazana, sistem kanalindan
          for (const satir of String(r.mesaj ?? '').split('\n')) {
            frame(ws, 'chat.recv', { ch: 'system', from: 'GM', text: satir.slice(0, 200) });
          }
        })).catch((e) => log('gm hatasi:', String(e.message).slice(0, 120)));
        break;
      }

      case 'world.logout':
        /* `kick` (241) semasi: { reason: qJ([login_elsewhere, slow_link,
           rate_limit, shutdown, gm, char_deleted, save_failed]) } - `logout`
           bu listede YOK, `accountId` diye bir alan da yok.
           DENETIM DUZELTMESI: burada "Kare zaten reddediliyordu" yaziyordu -
           DOGRU DEGIL. Istemci gelen kareyi dogrulamiyor; kick isleyicisi
           `kick.${reason}` anahtarini ariyor, bulamayinca `kick.generic`
           metnine dusuyor. Yani oyuncu reddedilmis bir kare degil, GENEL
           bir "baglanti kesildi" metni goruyordu. Ustelik istemci
           world.logout'u gonderdikten hemen
           sonra kendisi disconnect + loggedOut() cagiriyor
           (index-BUMMQVRB.js @27318738), yani sunucunun kick gondermesi
           GEREKMIYOR: sadece soketi kapat. */
        ws.close(1000);
        break;

      default:
        if (!Object.values(C2S).includes(t)) return;
        // Henuz uygulanmamis mesajlar: sessizce yok say, ama gorunur olsun.
        if (!ws._warned) ws._warned = new Set();
        if (!ws._warned.has(t)) { ws._warned.add(t); log('uygulanmamis mesaj:', t); }
    }
  });

  ws.on('close', () => {
    if (ws.zoneId && zones.has(ws.zoneId)) {
      zones.get(ws.zoneId).delete(ws);
      if (ws.isAuthed) {
        WORLDSIM.oyuncuCik(ws);
        broadcast(ws.zoneId, 'state.delta', { rem: [ws.entityId] });
        /* MADDE 58 / FARK #4 #107: MODUL CIKIS KANCALARI. Eskiden hicbir
           sistemin cikis/ayril'i cagrilmiyordu; sonuclari:
             - sistem_gorev: ILERLEME_YAZ_MS (15 sn) penceresinde biriken
               oldurmeler DB'ye inmeden kaybolabiliyordu + oturum haritalari
               hic temizlenmiyordu (sistem_gorev.js:508),
             - sistem_parti/lonca: cikan uye listede canli goruluyor,
               bekleyen davetler asili kaliyordu (sistem_parti.js:1084,
               sistem_lonca.js:1572 - modulun kendi '[EKSIK] 5' notu),
             - sistem_kucuk-sistemler: mezat abonelik sizintisi (:2117),
             - sistem_donus-isinlanma: AKTIF/ISARET RAM tutusu (:855).
           modulleriYukle ile ayni try/catch kalibi - patlayan tek modul
           digerlerinin temizligini engellemez. konumuKaydet'ten ONCE:
           moduller ws.char'i hala dolu gormeli. */
        for (const { ad, ornek } of SISTEMLER) {
          try { ornek.cikis?.(ws); }
          catch (e) { log(`sistem_${ad}.cikis hatasi: ${String(e?.message ?? e).slice(0, 120)}`); }
          try { ornek.ayril?.(ws); }
          catch (e) { log(`sistem_${ad}.ayril hatasi: ${String(e?.message ?? e).slice(0, 120)}`); }
        }
        konumuKaydet(ws);          // ilerleme + konum + envanter
        save();
        /* Kalicilik imzasini birak - ayni karakter tekrar girdiginde ilk
           kaydin "degismedi" sanilip atlanmasini onler. */
        if (ws.char?.id != null) { KALICI?.unut(ws.char.id); KAYIT_IMZASI.delete(ws.char.id); KAYIT_UCUSTA.delete(ws.char.id); }
        log('WS cikis:', ws.char?.name);
      }
    }
  });
});

/**
 * Karakterin konumunu SRO_VT_SHARD._Char tablosuna yazar.
 * Bunu yapmazsak _Char.PosX/PosZ hic guncellenmez ve oyuncu her girise
 * dogum noktasindan (Jangan) baslar. WebSaveCharPos yordami zaten vardi
 * ama HIC CAGRILMIYORDU.
 */
/**
 * Karakteri kaydeder.
 *
 * ESKIDEN: yalnizca KONUM + HP/MP yaziliyordu (saveCharPos). Seviye, deneyim,
 * beceri/stat puani, STR/INT, altin ve CANTA hicbir yere yazilmiyordu; bu
 * yuzden cikip girince oyuncu 1. seviyeye ve bos cantaya donuyordu.
 * Kullanicinin dogrudan gozlemi: "_Char tablosunda hala 1 lvl im fakat oyunda
 * 4 lvl gorunuyom" ve "cantamdaki itemlerde gidiyor".
 *
 * SIMDI: saveCharProgress ilerlemeyi + konumu TEK UPDATE ile _Char'a yazar,
 * envanterKaydet ise canta/kusami SRO_WEB_GAME.dbo.WebCharInventory'ye yazar.
 */
function konumuKaydet(ws) {
  if (!ws?.isAuthed || !ws.char?.id) return;
  const ch = ws.char;
  const p = AUTH.saveCharProgress
    ? AUTH.saveCharProgress(ch.id, ch)
    /* `zone`: bolge kutulari dikis seridinde CAKISIYOR, LatestRegion de
       x/z'den turetildigi icin koordinat tek basina bolgeyi belirlemiyor
       (routes_auth.js bolgeBul basligina bak). saveCharProgress ch.zone'u
       zaten aliyor; bu yedek dal da ayni bilgiyi gecirmeli. */
    : AUTH.saveCharPos(ch.id, { x: ch.x, z: ch.z, y: ch.y ?? 0, hp: ch.hp, mp: ch.mp, zone: ch.zone });
  p.catch(e => log('karakter kaydedilemedi:', String(e.message).slice(0, 160)));
  envanterKaydet(ch).catch(e => log('envanter kaydedilemedi:', String(e.message).slice(0, 160)));
}

/* KAYIT NABZI - "her 0 ms de kayit etsin" (kullanici).
 *
 * Gercekten her 0 ms'de SQL calistirmak imkansiz (her yazma bir ag gidis-
 * donusu); onun yerine HER OYUN TIKINDE (100 ms) degisiklik var mi diye
 * bakiyoruz ve varsa ANINDA yaziyoruz. Yani bir deger degistiginde en gec
 * bir tik sonra DB'ye duser - kullanici acisindan anlik. Degisiklik yoksa
 * tek bir sorgu bile calismaz.
 *
 * Artik 2 saniyede bir bakiyoruz ama YALNIZCA DEGISENI yaziyoruz: her
 * karakterin ilerleme alanlarindan ucuz bir imza cikariyoruz ve imza
 * degismediyse hicbir SQL sorgusu calismiyor. Sonuc: seviye atlayinca,
 * altin degisince, esya alinca degisiklik ~2 sn icinde _Char'a duser;
 * hicbir sey olmayan sunucuda ise sorgu yuku SIFIR kalir.
 *
 * NOT (durustce): referans oyunun SUNUCU kodu istemci paketinde yok, bu yuzden
 * onun kayit sikligini dogrudan okuyamiyoruz. Ancak istemcide
 * `sys.save.failing`, `err.save_unhealthy`, `err.save_unhealthy_other` ve
 * kick sebebi `save_failed` anahtarlari VAR (tr.json + paket @25609xxx) -
 * yani referans oyunda kayit sik ve SAGLIGI IZLENEN bir islem. Bizdeki tasarim
 * bunun ayni davranisi: sik dene, degismediyse yazma, hatayi gunluge dus. */
const KAYIT_IMZASI = new Map();   // charId -> imza
const KAYIT_UCUSTA = new Set();   // charId - su an DB'ye yaziyor

function ilerlemeImzasi(ch) {
  return [ch.level, ch.xp, ch.sp, ch.spExp, ch.statPoints, ch.str, ch.int,
          ch.gold, Math.round(ch.hp), Math.round(ch.mp),
          Math.round(ch.x), Math.round(ch.z)].join(',');
}

setInterval(() => {
  for (const set of zones.values()) {
    for (const c of set) {
      const ch = c.char;
      if (!c.isAuthed || !ch?.id) continue;
      /* Onceki yazma hala surerken yenisini baslatma - yoksa yavas bir SQL
         aninda kuyruk buyur ve ayni satira yaris eden UPDATE'ler cikar. */
      if (KAYIT_UCUSTA.has(ch.id)) continue;

      const imza = ilerlemeImzasi(ch);
      const ilerlemeDegisti = KAYIT_IMZASI.get(ch.id) !== imza;
      if (!ilerlemeDegisti) {
        /* Ilerleme ayni ama envanter degismis olabilir. envanterKaydet kendi
           imzasini tutuyor: degismediyse HIC sorgu calistirmaz. */
        envanterKaydet(ch).catch(() => {});
        continue;
      }

      KAYIT_IMZASI.set(ch.id, imza);
      KAYIT_UCUSTA.add(ch.id);
      const bitir = () => KAYIT_UCUSTA.delete(ch.id);
      Promise.all([
        AUTH?.saveCharProgress ? AUTH.saveCharProgress(ch.id, ch) : Promise.resolve(),
        envanterKaydet(ch),
      ]).then(bitir, (e) => {
        bitir();
        /* Imzayi GERI AL ki bir sonraki tikte yeniden denensin - yoksa
           gecici bir DB hatasi o degisikligi kalici olarak kaybettirir. */
        KAYIT_IMZASI.delete(ch.id);
        log('karakter kaydedilemedi:', String(e.message).slice(0, 160));
      });
    }
  }
}, CFG.world.tickMs ?? 100);

// dunya tik dongusu
setInterval(() => {
  /* ZAMAN DARBESI.
     ESKIDEN: frame(c, 'batch.tick', { tick, serverTime }) yollaniyordu.
     Bu bir PROTOKOL HATASIYDI - `batch.tick` tel uzerinde bir mesaj DEGIL,
     istemcinin `batch` ZARFINDAN turettigi ic olaydir ve degeri bir SAYIDIR:
         onFrame(f): if (f.t === 'batch') { invoke('batch.tick', f.tick); ... }
         setBatchTick(n): currentBatchTime = serverTime0 + (n - tick0) * 100
     Nesne gonderince (nesne - sayi) = NaN olup currentBatchTime bozuluyordu;
     bu deger 3 birimden fazla ziplayan varlik hareketlerinde t0 olarak
     kullaniliyor (paket @625854/@625877/@625908).
     SIMDI: gercek zarf gonderiliyor. Icerik bos - tel trafigi ayni kaldi,
     ama istemcinin zaman ekseni artik dogru ilerliyor.
     (Ileride yuksek frekansli kareler bu zarfin `d` dizisine toplanabilir;
      referans oyunun yaptigi da budur - bkz. rapordaki "bulunan eksikler".) */
  const zarf = JSON.stringify(batchZarfi(tik(), []));
  for (const [zoneId, set] of zones) {
    if (!set.size) continue;
    for (const c of set) if (c.isAuthed) hamGonder(c, zarf);
  }
  /* Kapi (gates) yaricap kontrolu. Bu dunyada kapi verisi YOK (5 bolgenin
     hepsinde gates: []), o yuzden KAPILAR bos ve dongu hic donmez. */
  if (KAPILAR.size) {
    try { kapiTik(); } catch (e) { log('kapi tiki hatasi:', String(e.message).slice(0, 120)); }
  }
}, CFG.world.tickMs);

// ---------------------------------------------------------------- baslat
await initSql();
/* S2 MADDE 4 - IPv6 cift yigin dinleyici. Olcum: yalniz IPv4 dinlerken
   'localhost' istekleri once ::1'i deniyor ve ~2 sn ceza yiyor (Winsock
   connect-retry: urllib 'localhost' 2039.8ms/istek vs 127.0.0.1 2.9ms);
   canli referans site cift yigin (AAAA+A). host '::' hem ::1 hem
   127.0.0.1'i kabul eder (deneysel olcum: ikisi de <1ms baglandi).
   IPv6 yigini kapali makinede '::' EADDRNOTAVAIL verir - 0.0.0.0
   yedegine duseriz, yoksa sunucu hic acilmaz. listen hatasi ASYNC 'error'
   olayiyla gelir, try/catch yakalamaz - o yuzden once() ile dinliyoruz.
   Bilinen YAN ETKI (kozmetik): IPv4 istemcilerin remoteAddress'i
   '::ffff:127.0.0.1' bicimine doner - yalniz routes_auth.js RegIp/
   WebLoginLog log alanlarina yazilir, IP esitligiyle kapilanan mantik
   yok (grep dogrulandi). Baslangic logu localhost yerine 127.0.0.1 ilan
   eder: yedege dusulen makinede localhost -> ::1 cozumu yine 2 sn yer. */
const baslatLogu = () => {
  const adr = server.address();
  const adres = adr ? `${adr.address}:${adr.port}` : `${CFG.http.host}:${CFG.http.port}`;
  const hasClient = fs.existsSync(path.join(CLIENT, 'index.html'));
  log('='.repeat(58));
  log(`  Sunucu hazir  ->  http://127.0.0.1:${CFG.http.port}`);
  log(`  WebSocket     ->  ws://127.0.0.1:${CFG.http.port}/ws   (proto ${CFG.world.proto})`);
  log(`  Istemci       ->  ${hasClient ? 'YUKLU' : 'EKSIK (SON/client bos)'}`);
  log(`  SQL           ->  ${pool ? 'bagli' : 'kapali/bagli degil'}`);
  log(`  Protokol      ->  ${Object.keys(C2S).length} giden + ${Object.keys(S2C).length} gelen mesaj`);
  log(`  Statik onbellek -> ${ONB_MB ? `${ONB_MB} MB tavan, tek dosya <= ${ONB_TEK_MB} MB` : 'KAPALI'}`);
  /* ORNEK KIMLIGI. Kapanis dogrulamasi bu uc satira dayanir: hangi surec
     calisiyor, hangi KOD surumunu kosuyor, logunu nereye yaziyor. */
  log(`  Surec         ->  PID ${process.pid}  (node ${process.version})`);
  log(`  Kod surumu    ->  server.js sha256:${KOD_SHA}`);
  log(`  Calisma logu  ->  ${LOG_DOSYASI ?? 'ACILAMADI - yalniz konsol'}`);
  log('='.repeat(58));
  kimlikYaz(adres);
};
server.once('error', (e) => {
  if (e?.code === 'EADDRNOTAVAIL' && CFG.http.host === '::') {
    log(`'::' dinlenemedi (EADDRNOTAVAIL) - IPv6 yigini kapali; 0.0.0.0 yedegiyle deneniyor`);
    server.listen(CFG.http.port, '0.0.0.0', baslatLogu);
    return;
  }
  if (e?.code === 'EADDRINUSE') {
    /* Eskiden bu dal ham bir uncaughtException yigin izi basiyordu ve port
       sahibi kimdir sorusu cevapsiz kaliyordu. Davranis ayni (surec duser),
       fark: sebep ve SAHIP artik acikca yaziliyor - ayni anda ikinci bir
       ornek acmaya calisan kisi durumu aninda goruyor. */
    const sahip = ONCEKI_ORNEK && surecYasiyor(ONCEKI_ORNEK.pid)
      ? `PID ${ONCEKI_ORNEK.pid} (${ONCEKI_ORNEK.baslangic}, log: ${ONCEKI_ORNEK.log})`
      : 'kimligi kayitli olmayan baska bir surec';
    log(`Port ${CFG.http.port} MESGUL - ${sahip} tutuyor. Bu ornek baslatilmadi.`);
    process.exit(1);
  }
  throw e;   // baska hata: eski davranis - surec dussun (sebep artik gunlukte)
});
/* Onceki ornek uyarisi listen'DEN ONCE basilir: EADDRINUSE ile dusersek bile
   kullanici sebebi gormus olur. */
if (ONCEKI_ORNEK && ONCEKI_ORNEK.pid !== process.pid) {
  if (surecYasiyor(ONCEKI_ORNEK.pid)) {
    log(`UYARI: PID ${ONCEKI_ORNEK.pid} hala calisiyor (${ONCEKI_ORNEK.baslangic}, ` +
        `kod ${ONCEKI_ORNEK.kodSha}, log: ${ONCEKI_ORNEK.log}). Ayni portu iki ornek ` +
        `paylasamaz - biri EADDRINUSE ile dusecek.`);
  } else {
    log(`Onceki ornek (PID ${ONCEKI_ORNEK.pid}, ${ONCEKI_ORNEK.baslangic}) temiz ` +
        `kapanmamis; kaydi bayat - uzerine yaziliyor.`);
  }
}
server.listen(CFG.http.port, CFG.http.host, baslatLogu);
