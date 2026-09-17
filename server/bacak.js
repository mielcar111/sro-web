/**
 * "BACAK" (leg) - zamana yayilan hareket.
 *
 * NEDEN VAR: Sunucu `move.click` aldiginda oyuncuyu hedefe ANINDA isinliyordu.
 * Bu, sunucunun konumunu istemcininkinden kalici olarak ayirdi (canli olcum:
 * 25.70 birim). Sonuclari zincirleme:
 *
 *  1) Istemcinin applyMove'u, KENDI karakteri icin:
 *        if (hypot(vec.x - node.fx, vec.z - node.fz) > 3) { ...; vec.y = node.fy; return; }
 *     3 birimi asan ayrismada Y'yi kayitsiz sartsiz sunucunun fy'siyle EZIYOR -
 *     yani oyuncunun BULUNMADIGI bir noktadan ornekleniml yukseklikle.
 *
 *  2) Carpisma Y BANDINA bagli. Jangan'daki 143.832 blocker'in 143.828'i
 *     (%99,997) yMin/yMax tasiyor ve istemcinin isBlocked'i her collider'i
 *     oyuncunun O ANKI y'sine gore eliyor (kq()). Yanlis Y -> TUM duvarlar
 *     yok sayiliyor -> objelerin icinden geciliyor.
 *
 *  3) Geri donus yok: sampleY bir yuzeyi ancak `yuzeyY <= y + 0.75` ise kabul
 *     ediyor (u9e). Y bir platformun 0.75 biriminden fazla altina yazilirsa o
 *     platform BIR DAHA ASLA secilemiyor -> karakter kalici olarak zeminin altinda.
 *
 * COZUM: sunucu isinlanmaz; hedefi "bacak" olarak saklar ve her tikte yol
 * boyunca ilerletir. Boylece bir sonraki entity.move'un fx/fz'si istemcinin
 * GERCEK konumunu tarif eder, `>3` dali hic calismaz, Y hic ezilmez.
 *
 * Istemci zaten kendi yolunu `advanceSelf` -> `moveCircle` ile carpismali
 * olarak yuruyor; sunucu ona PARALEL ilerler. Bu yuzden tikte tekrar
 * entity.move GONDERILMEZ - tek bir kare yeterlidir.
 */

/** y izlemede kullanilan ara adim - kat secimi (kopru alti/ustu) bozulmasin. */
const Y_ADIM_U = 0.5;

/**
 * KAYMALI HAREKET ISARETI - yalnizca OYUNCUNUN KENDI karakterine konur.
 *
 * Istemci iki ayri yurume yolu kullaniyor:
 *   KENDI karakteri  -> advanceSelf -> colliders.moveCircle  (@25673731)
 *                       her karede duvar boyunca KAYAR
 *   UZAK varliklar   -> igt()                                (@25674600)
 *                       fx->tx arasinda DUZ interpolasyon, kayma YOK
 * Bu yuzden kayma yalnizca oyuncuda uygulanmali: canavar/pet/binek icin
 * kaydirilmis (kavisli) bir yol sunucuyla istemcinin gordugunu ayirir.
 *
 * Symbol.for kullaniliyor cunku JSON.stringify sembol anahtarlarini ATLAR -
 * isaret accounts.json'a ya da veritabanina sizmaz.
 */
export const KAYMALI = Symbol.for('oyun.kaymaliHareket');

/**
 * Kaymali yolda sunucunun DUZ cizgiden ne kadar ayrildigini olcup
 * `bacak.sapti` isaretini koyariz. Esik 3 birim: istemcinin applyMove'u
 * uzak varlikta `hypot(vec.x - node.fx, vec.z - node.fz) > 3` olunca sert
 * SNAP yapiyor (@25663224). Ayrilma bu esigi asarsa cagiran (gameloop)
 * izleyicilere entity.move'u TAZELEMELI, yoksa onlar oyuncuyu duvarin
 * icinden duz yururken gorur.
 */
const SAPMA_ESIGI_U = 3;

/**
 * Bir tikte tuketilebilecek EN FAZLA sure.
 *
 * KAYNAK: plan_tam.json madde 6. Bu bir OYUN SABITI DEGIL, sunucu duraklarsa
 * (GC, disk, uzun bir tik) oyuncunun tek karede ileri firlamasini onleyen
 * guvenlik kelepcesi. Yol yine adim adim dogrulandigi icin duvardan gecirmez;
 * yalnizca istemciyle arasindaki ani acilmayi (applyMove'un `>3` SNAP dali)
 * engeller.
 */
const DT_TAVAN_MS = 250;

/**
 * Tikte gercekten gecen sure.
 *
 * NEDEN: cagiran SABIT tickMs (100) geciyordu; Node'un setInterval'i bu
 * makinede 100 tikte 10787 ms atesliyor (%7.87 sapma), yani sunucu her
 * saniye ~%8 AZ yol aliyordu. Istemci ise gercek kare suresini kullaniyor
 * (paket advanceSelf @25673731: `v_r = arg_e/1e3 * speedOwner.speed`).
 * 13 saniyelik tek tiklamada sunucu ~7.9 birim geriye dusuyor; ardindan
 * gelen move.stop oyuncuyu geri isinliyor ya da sonraki entity.move'da
 * fark 3u'yu asip sert SNAP + Y ezmesi oluyor.
 *
 * KURAL: dt = min(max(dtMs, duvarSaati), DT_TAVAN_MS)
 *
 *   max(...) : setInterval ERKEN atesLEMEZ - yalniz zamaninda ya da GEC.
 *              Bu yuzden duvar saati dtMs'ten kucuk cikiyorsa olcum
 *              anlamsizdir (ornegin tikleri anlik donguyle taklit eden bir
 *              simulasyon/test). O durumda cagiranin verdigi nominal sure
 *              kullanilir, yani BUGUNKU davranis birebir korunur ve hicbir
 *              cagiran gerileyemez. Duzeltme yalnizca GEC atesleme acigini
 *              kapatir.
 *   tavan    : uzun bir durakla sonrasi tek karede ileri firlamayi onler.
 *
 * Olcum duvar saatinden yapilir; ilk tikte bacagin kuruldugu an baz alinir
 * (istemcinin path.t0'i da tiklamada baslar).
 */
function gercekDt(bacak, simdi, dtMs) {
  const nominal = (dtMs > 0) ? dtMs : 0;
  const duvar = (bacak.sonTik > 0) ? (simdi - bacak.sonTik) : nominal;
  let dt = Math.max(nominal, duvar > 0 ? duvar : 0);
  if (dt > DT_TAVAN_MS) dt = DT_TAVAN_MS;
  bacak.sonTik = simdi;
  return dt;
}

/**
 * Yeni bacak kurar.
 *
 * @param {object} varlik       ws.char veya canavar - {x, z, y} tasir
 * @param {string} zoneId
 * @param {number} hedefX
 * @param {number} hedefZ
 * @param {number} hiz          birim/saniye (oyuncu: gameConfig.playerMoveSpeedU)
 * @param {(zoneId:string,x0:number,z0:number,x1:number,z1:number,y0?:number)=>{x:number,z:number,y?:number}} yurunebilir
 * @returns {object|null} entity.move govdesi ({fx,fz,fy,tx,tz,speed}) veya null
 *
 * DIKKAT: varlik.x/z/y'ye DOKUNMAZ. Sadece varlik.bacak'i kurar.
 */
export function bacakKur(varlik, zoneId, hedefX, hedefZ, hiz, yurunebilir) {
  if (!varlik || !(hiz > 0)) return null;
  const fx = varlik.x, fz = varlik.z, fy = varlik.y ?? 0;
  const simdi = Date.now();

  /* ---- KAYMALI DAL (oyuncu / istemcisi moveCircle yuruten varliklar) ----
     Istemci KENDI karakterini her karede colliders.moveCircle ile yuruyor:
     duvara degen adimi en fazla 4 kez disari itip duvar boyunca KAYDIRIYOR
     (paket advanceSelf @25673731 -> moveCircle @8489012). Sunucu ise duz
     cizgide ilk engelde duruyor ve o KISA hedefi entity.move ile istemciye
     zorla kabul ettiriyordu (applyMove @25663224 istemcinin hedefini
     sunucununkiyle degistirir) - kose donen oyuncu duvara carpip kaliyordu.

     Cozum: hedefi KIRPMA; sadece collider disina it (resolvePoint) ve her
     tikte ayni moveCircle'i sunucuda da calistir. Iki taraf ayni algoritma
     + ayni veriyle ayni yolu kayarak yuruyor.

     Iki kapi birden gerekli: varlik KAYMALI isaretini tasimali (yalniz
     oyuncunun kendi karakteri) VE cozucu bir `hareket` sunmali. Aksi halde
     eski duz-cizgi dali aynen calisir (pet/binek/canavar). */
  const coz = yurunebilir?.hareket;
  if (varlik[KAYMALI] === true && typeof coz === 'function') {
    const h = (typeof yurunebilir.hedefCoz === 'function')
      ? yurunebilir.hedefCoz(zoneId, hedefX, hedefZ, fy)
      : { x: hedefX, z: hedefZ };
    if (Math.hypot(h.x - fx, h.z - fz) < 1e-3) { varlik.bacak = null; return null; }

    varlik.bacak = { fx, fz, tx: h.x, tz: h.z, hiz, zoneId, coz, sonTik: simdi, sapti: false };
    varlik.rotY = Math.atan2(h.x - fx, h.z - fz);
    return { fx, fz, fy, tx: h.x, tz: h.z, speed: hiz };
  }

  /* ---- DUZ CIZGI DALI (canavarlar, pet/binek) --------------------------
     UZAK varliklar istemcide igt() ile fx->tx arasinda DUZ interpolasyon
     ediliyor (@25674600), kayma YOK. Bu yuzden onlarin hedefi yuruYolu ile
     KIRPILMALI; kaydirilmis (kavisli) bir hedef duvardan gecmis gorunurdu. */
  const yol = yurunebilir(zoneId, fx, fz, hedefX, hedefZ, fy);
  const uzunluk = Math.hypot(yol.x - fx, yol.z - fz);
  if (uzunluk < 1e-3) { varlik.bacak = null; return null; }

  varlik.bacak = { tx: yol.x, tz: yol.z, hiz, sonTik: simdi };
  varlik.rotY = Math.atan2(yol.x - fx, yol.z - fz);   // istemci de boyle donduruyor

  // `ty` YOK: entity.move semasi T$(`entity.move`,134,X({id,fx,fz,fy?,tx,tz,speed}))
  // varis yuksekligini SUNUCU BILDIRMEZ - istemci yol boyunca kendisi turetir.
  return { fx, fz, fy, tx: yol.x, tz: yol.z, speed: hiz };
}

/**
 * Bacagi dtMs kadar ilerletir. Konum degistiyse true doner.
 *
 * Zaman orani DEGIL yay uzunlugu kullanilir: oyuncu yolu ortasinda yeniden
 * tiklayabilir, boyle bir durumda bas/bit zamanlari anlamini yitirir.
 *
 * @param {object} varlik
 * @param {string} zoneId
 * @param {number} dtMs
 * @param {(zoneId:string,x:number,z:number,oncekiY?:number)=>number} zeminY
 */
export function bacakIlerlet(varlik, zoneId, dtMs, zeminY) {
  const b = varlik?.bacak;
  if (!b) return false;

  // SABIT tickMs degil, duvar saatinden GERCEK gecen sure (bkz. gercekDt)
  const dt = gercekDt(b, Date.now(), dtMs);
  if (dt <= 0) return false;

  /* ---- KAYMALI DAL: istemcinin advanceSelf'iyle birebir --------------
     `(blocked || hedefe varildi) -> path = null` kurali dahil (@25673731). */
  if (typeof b.coz === 'function') {
    const mesafe = b.hiz * (dt / 1000);
    if (mesafe <= 0) return false;
    const eskiX = varlik.x, eskiZ = varlik.z;
    const s = b.coz(zoneId ?? b.zoneId, eskiX, eskiZ, varlik.y, b.tx, b.tz, mesafe);
    const tasindi = (s.x !== eskiX || s.z !== eskiZ);
    if (tasindi) varlik.rotY = Math.atan2(s.x - eskiX, s.z - eskiZ);
    varlik.x = s.x; varlik.z = s.z;
    if (s.y !== undefined) varlik.y = s.y;

    /* Kayma sunucuyu DUZ cizgiden ne kadar ayirdi? Izleyiciler bu bacagi
       igt() ile DUZ interpolasyon ediyor; ayrilma 3 birimi asarsa onlarin
       gordugu konum yanlistir (bkz. SAPMA_ESIGI_U). Cagiran bu bayragi
       gorup entity.move'u tazeleyebilir. */
    if (!b.sapti) {
      const lx = b.tx - b.fx, lz = b.tz - b.fz;
      const L = Math.hypot(lx, lz);
      if (L > 1e-6) {
        const dik = Math.abs((varlik.x - b.fx) * lz - (varlik.z - b.fz) * lx) / L;
        if (dik > SAPMA_ESIGI_U) b.sapti = true;
      }
    }

    if (s.engellendi || (varlik.x === b.tx && varlik.z === b.tz)) varlik.bacak = null;
    return tasindi;
  }

  const dx = b.tx - varlik.x, dz = b.tz - varlik.z;
  const kalan = Math.hypot(dx, dz);
  if (kalan < 1e-4) { varlik.bacak = null; return false; }

  const adim = Math.min(kalan, b.hiz * (dt / 1000));
  if (adim <= 0) return false;

  const hx = dx / kalan, hz = dz / kalan;
  const hedefX = varlik.x + hx * adim;
  const hedefZ = varlik.z + hz * adim;

  /* Y'yi parca boyunca ARA ADIMLARLA izle. Tek seferde ornekleyip gecersek
     0.75 birimlik kafa bosluğu penceresi atlanabilir ve karakter alt kata
     duser. Istemcinin Hq()'su da tam olarak boyle yapiyor. */
  if (zeminY) {
    const n = Math.max(1, Math.ceil(adim / Y_ADIM_U));
    let y = varlik.y ?? 0;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      y = zeminY(zoneId, varlik.x + hx * adim * t, varlik.z + hz * adim * t, y);
    }
    varlik.y = y;
  }

  varlik.x = hedefX;
  varlik.z = hedefZ;
  if (kalan - adim < 1e-4) varlik.bacak = null;   // varildi
  return true;
}

/** Varlik payload'i icin `moving` alani (yurumeyen varlikta undefined). */
export function bacakPayload(varlik) {
  const b = varlik?.bacak;
  if (!b) return undefined;
  return { tx: +b.tx.toFixed(3), tz: +b.tz.toFixed(3), speed: b.hiz };
}

/** Bacagi iptal eder (durdurma, olum, isinlanma). */
export function bacakDurdur(varlik) {
  if (varlik) varlik.bacak = null;
}
