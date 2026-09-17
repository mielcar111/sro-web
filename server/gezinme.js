/**
 * BOSTA GEZINME (idle wander) - canavarlarin yuvalarinin icinde dolasmasi.
 *
 * SORUN: gameloop.js #canavarYZ icinde `if (!hedefId) continue;` vardi; yani
 * SADECE kendisine vuran oyuncuyu kovalayan canavar hareket ediyordu. Vurulmamis
 * canavar hicbir tikte tek bir bayt bile uretmiyordu -> hepsi heykel gibi duruyordu.
 * (Olculdu: 20 canavar gorus alanindayken 12 saniye / ~60 tik boyunca yayinlanan
 *  mesaj sayisi = 0, konum degisimi = 0/8.)
 *
 * ISTEMCI TARAFI - NASIL CALISIYOR (playjs_source/index-BUMMQVRB.js):
 *
 *  1) s2c 134 entity.move {id, fx, fz, fy?, tx, tz, speed}      (satir 624275)
 *  2) applyMove: uzak varlik icin, gonderilen fx/fz istemcinin bildigi konuma
 *     <= 3 birim ise yolu KESMEDEN devam ettirir (satir 625888).
 *  3) igt(): her karede (tx-fx, tz-fz) dogrusunda `speed` birim/sn ile ilerletir,
 *     rotY = atan2(dx,dz) ile canavari YURUDUGU YONE dondurur ve varista
 *     `path = null` yapar (satir 626203). Yani DURMA paketi gerekmez;
 *     yol bitince istemci kendiliginden idle'a doner.
 *  4) mobView.update(): `vec.moving` (= path !== null) false ise `idle` klibi,
 *     true ise fn_be(speed, moveAnimMult) klibi oynatilir (satir 645487).
 *  5) fn_be = (speed, mult) => speed / max(.1, mult) >= view.runSpeedU * .9
 *              ? `run` : `walk`                                 (satir 645302)
 *     view.runSpeedU = o modelKey'i paylasan canavarlarin EN BUYUK runSpeedU'su
 *     (satir 645795-645805). moveAnimMult, statu (yavaslatma vb.) yoksa 1.
 *
 *     => YURUME animasyonu icin speed alanina walkSpeedU koymak ZORUNLU.
 *        Mangyang: walkSpeedU 1.2, runSpeedU 3.3 -> esik 2.97 -> 1.2 < 2.97 -> `walk`.
 *        Kovalarken runSpeedU 3.3 >= 2.97 -> `run`. Ayni mesaj, tek fark `speed`.
 *
 *  6) state.delta / zone.init varlik payload'inda `moving:{tx,tz,speed}` alani var
 *     (istemci semasi Qmt, satir 623365). Yurumekte olan bir canavar oyuncunun
 *     gorus alanina girdiginde bu alan gonderilmezse istemci onu DURUYOR sanip
 *     idle oynatir. world.js #varlikPayload bu alani doldurmali.
 *
 * VERI KAYNAKLARI (hicbiri uydurma degil):
 *   hiz    : data/mobs.json[mob].walkSpeedU - istemci paketindeki katalogun
 *            birebir kopyasi (index-BUMMQVRB.js satir 183020, degisken rct)
 *   sinir  : data/spawns.json[].radius = Tab_RefNest.nRadius * 0.15
 *            (gen_spawns.mjs; 0.15 olcegi NPC eslesmesiyle turetilmis)
 *   engel  : nav.bin  (server.js yurunebilirNokta -> nav.js yuruYolu)
 *   zemin  : heights.bin (terrain.js groundY)
 *
 * SURELER: ASAGIDAKI 4 SAYININ KAYNAGI YOKTUR. Ne istemci paketinde, ne
 * game-config'de, ne canli yakalamada, ne de vSRO veritabaninda "canavar kac
 * saniye bekler / adimi kac birimdir" diyen bir alan bulunamadi. Bu yuzden
 * TEK BIR YERDE, acikca isaretli birakildilar; raporda OLCUM TARIFI var.
 */

/* ------------------------------------------------------------------ */
/*  KAYNAGI OLMAYAN AYARLAR - olculene kadar burada durur.
 *  Bacak MESAFE degil SURE olarak veriliyor: mesafe = walkSpeedU * sure.
 *  Boylece yavas Mangyang (1.2 U/sn) da hizli Tiger Girl (6 U/sn) de ayni
 *  ritimde yurur; tek bir sabit mesafe verilirse yavas mob tek bacakta
 *  dakikalarca duz cizgi cizer.                                       */
const BACAK_MIN_MS = 3000;   // KAYNAK YOK - tek yurume bacaginin alt siniri
const BACAK_MAX_MS = 9000;   // KAYNAK YOK - tek yurume bacaginin ust siniri
const BEKLE_MIN_MS = 2000;   // KAYNAK YOK - bacaklar arasi duraklama alt sinir
const BEKLE_MAX_MS = 7000;   // KAYNAK YOK - bacaklar arasi duraklama ust sinir
const ADIM_MIN_U   = 2;      // KAYNAK YOK - bundan kisa bacak anlamsiz, atlanir
/* ------------------------------------------------------------------ */

const YENIDEN_DENE_MS = 3000;   // nav her yonu kapattiysa tekrar deneme araligi
const DENEME = 4;               // bir tikte en fazla kac yon denenir

export class Gezinme {
  /**
   * @param {object} o
   * @param {import('./world.js').World} o.world
   * @param {(ws:any,t:string,d:any)=>void} o.frame
   * @param {(zoneId:string,x0:number,z0:number,x1:number,z1:number,baslangicY?:number)=>{x:number,z:number,y?:number,engellendi:boolean}} [o.yurunebilir]
   * @param {(...a:any)=>void} [o.log]
   */
  constructor({ world, frame, yurunebilir, log }) {
    this.world = world;
    this.frame = frame;
    /* 6. parametre (baslangicY) yedek imzada da DURMALI - yoksa cagrilar
       sessizce y'siz kaliyor gorunur. Bkz. #yeniBacak notu. */
    this.yurunebilir = yurunebilir ?? ((z, x0, z0, x1, z1, y0) => ({ x: x1, z: z1, y: y0, engellendi: false }));
    this.log = log ?? (() => {});
    this.sayac = { bacak: 0, engel: 0 };
  }

  /** Kovalama/olum/isinlanma - yurumekte olan bacagi iptal eder. */
  iptal(mob, simdi = Date.now()) {
    mob.gez = null;
    mob.gezSonraki = simdi + this.#bekleme();
  }

  #bekleme() {
    return BEKLE_MIN_MS + Math.random() * (BEKLE_MAX_MS - BEKLE_MIN_MS);
  }

  /**
   * Tek canavar icin bir tik.
   * @param {string} zoneId
   * @param {object} mob
   * @param {number} simdi
   * @param {Set<number>} gorunenler  en az bir oyuncunun gordugu varlik id'leri
   */
  tik(zoneId, mob, simdi, gorunenler) {
    // Kimsenin gormedigi canavar gezinmez: Samarkand'da 7.500 canavar var,
    // hepsini her tikte yurutmek hem CPU'yu hem agi bosa yakar.
    if (!gorunenler.has(mob.id)) { if (mob.gez) mob.gez = null; return; }

    // ---- yurumekte olan bacagi ilerlet -------------------------------
    const g = mob.gez;
    if (g) {
      const t = (simdi - g.bas) / Math.max(1, g.bit - g.bas);
      if (t >= 1) {
        mob.x = g.tx; mob.z = g.tz;
        mob.y = this.world.groundY(zoneId, mob.x, mob.z, mob.y);
        mob.gez = null;
        mob.gezSonraki = simdi + this.#bekleme();
      } else {
        mob.x = g.fx + (g.tx - g.fx) * t;
        mob.z = g.fz + (g.tz - g.fz) * t;
        mob.y = this.world.groundY(zoneId, mob.x, mob.z, mob.y);
        mob.rotY = Math.atan2(g.tx - g.fx, g.tz - g.fz);   // istemci de boyle donduruyor
      }
      return;
    }

    // ---- duraklama ---------------------------------------------------
    if (simdi < (mob.gezSonraki ?? 0)) return;

    // ---- yeni bacak --------------------------------------------------
    const hiz = mob.def?.walkSpeedU;
    if (!hiz || hiz <= 0) { mob.gezSonraki = simdi + 60_000; return; }   // veri yok -> gezinme yok

    const R = mob.evYaricap ?? 0;
    if (R < ADIM_MIN_U) { mob.gezSonraki = simdi + 60_000; return; }     // nRadius=0 -> yuvada sabit

    for (let d = 0; d < DENEME; d++) {
      // bacak uzunlugu = kendi yurume hizi * hedef sure  (mob'a gore olceklenir)
      const sure = BACAK_MIN_MS + Math.random() * (BACAK_MAX_MS - BACAK_MIN_MS);
      let uz = hiz * (sure / 1000);
      const a = Math.random() * Math.PI * 2;
      let tx = mob.x + Math.cos(a) * uz;
      let tz = mob.z + Math.sin(a) * uz;

      // yuva diskinin disina cikma: hedefi disk sinirina cek
      const ex = tx - mob.evX, ez = tz - mob.evZ;
      const eu = Math.hypot(ex, ez);
      if (eu > R) { tx = mob.evX + ex / eu * R; tz = mob.evZ + ez / eu * R; }

      uz = Math.hypot(tx - mob.x, tz - mob.z);
      if (uz < ADIM_MIN_U) continue;   // sinira yapisik - baska yon dene

      /* 6. parametre = baslangic Y TOHUMU. Gecmezsek nav.js
         `groundY(x0, z0, undefined)` ile ARAZI tohumuna dusuyor; kopru ya da
         platform ustundeki canavarin gezinme yolu ALT KAT yuksekliklerine
         gore dogrulaniyor ve egim/kat karari yanlis veriliyordu. Istemci de
         her hareket cozumunde y baglamini tasiyor (moveCircle @8489012). */
      const yol = this.yurunebilir(zoneId, mob.x, mob.z, tx, tz, mob.y);
      const gercek = Math.hypot(yol.x - mob.x, yol.z - mob.z);
      if (gercek < ADIM_MIN_U) { this.sayac.engel++; continue; }         // duvar dibi

      const fx = mob.x, fz = mob.z, fy = mob.y ?? 0;
      mob.gez = {
        fx, fz, tx: yol.x, tz: yol.z, hiz,
        bas: simdi, bit: simdi + Math.round(gercek / hiz * 1000),
      };
      mob.rotY = Math.atan2(yol.x - fx, yol.z - fz);
      this.sayac.bacak++;
      this.#yolla(zoneId, mob, fx, fz, fy);
      return;
    }
    mob.gezSonraki = simdi + YENIDEN_DENE_MS;
  }

  /** entity.move'u SADECE bu canavari goren oyunculara gonderir. */
  #yolla(zoneId, mob, fx, fz, fy) {
    const g = mob.gez;
    for (const ws of this.world.bolgeOyunculari(zoneId)) {
      if (!ws.isAuthed || !ws.gorunen?.has(mob.id)) continue;
      this.frame(ws, 'entity.move', {
        id: mob.id,
        fx: +fx.toFixed(2), fz: +fz.toFixed(2), fy: +fy.toFixed(2),
        tx: +g.tx.toFixed(2), tz: +g.tz.toFixed(2),
        speed: g.hiz,          // walkSpeedU -> istemci `walk` klibini secer
      });
    }
  }
}
