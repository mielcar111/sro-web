/**
 * ENVANTER SISTEMI - inv.move / inv.use / inv.split / inv.destroy
 * ============================================================================
 *
 * Hicbir sayi/metin uydurulmadi. Her kural asagidaki KAYNAKLARDAN alindi:
 *
 * [S1] Istemci paketi  playjs_source/index-BUMMQVRB.js  (T$ sema kayitlari)
 *      ofset 25609928..25610250:
 *        E$ = X({ c: qJ([`bag`,`equip`]), i: Y().int().min(0).max(159) })
 *        D$ = Y().int().min(1).max(1e3)
 *        T$(`inv.destroy`, 47, X({ bagSlot: int(0..159), itemId: J(), qty: D$ }), `inv`)
 *        T$(`inv.split`,   43, X({ bagSlot: int(0..159), itemId: J(), qty: D$ }), `inv`)
 *        T$(`inv.move`,    48, X({ from: E$, to: E$ }), `inv`)
 *        T$(`inv.use`,     49, X({ bagSlot: int(0..159), petTarget: lht.optional() }), `inv`)
 *      ofset 25596186:  lht = qJ([`growth`, `mount`])          <- petTarget enum
 *      ofset 25594700:  S$  = { itemId, qty>=1, plus?, dur?, maxDur?, variance?,
 *                               blues?[{id,value}], rolls?{string:number} }
 *      ofset 25595485:  aht = { gold:int>=0, bag:[S$|null], equip:iht }   <- inv.update (149)
 *      ofset 25623886:  T$(`inv.update`, 149, aht)
 *      ofset 25631378:  T$(`fx.itemUsed`, 187, X({ id:int, group:qJ([hp,mp,vigor,pill,speed]) }))
 *      ofset 8687659:   rY = [weapon,shield,head,shoulder,chest,gloves,pants,boots,
 *                             avatarDress,avatarHat,avatarAttach,earring,necklace,ringL,ringR]
 *                       iY = ad => rY.indexOf(ad)      <- equip.i = rY INDEKSI
 *      ofset 8692600:   uot = [spear,glavie,bow,eu_tsword,eu_axe,eu_dagger,eu_crossbow,
 *                              eu_tstaff,eu_harp,profession_axe,profession_pickaxe]
 *                       dot(wt) = uot.includes(wt)     <- IKI ELLI silah listesi
 *      ofset 27441700:  envanter paneli:  ghostDef = (yuva==='shield' && dot(silah) &&
 *                       !equip.shield) ? silahDef : undefined
 *                       -> istemci, iki elli silah takiliyken KALKAN yuvasini kapatiyor
 *      ofset 25792304:  cift tik kusanma -> W$.send('inv.move', {from:{c:'bag',i},
 *                       to:{c:'equip', i: iY(slot==='ring' ? (!ringL||ringR?'ringL':'ringR')
 *                       : slot)}})
 *      ofset 25928200:  inv.use SADECE type==='consumable' (ve petConsumable) icin
 *                       gonderiliyor; istemci cooldownGroup basina iyimser bekleme kuruyor
 *      ofset 25929680:  err geldiginde:  code !== 'ERR_COOLDOWN' && code !== 'ERR_VALIDATION'
 *                       ise iyimser bekleme GERI ALINIR (q eslesmesiyle)
 *      ofset 25603148:  Sht = gecerli err.code enum'u (ERR_TWO_HANDED, ERR_BAG_FULL ...)
 *      ofset 25607034:  Eht = gecerli err.key enum'u (err.potion.full, err.potion.recovering)
 *      ofset 25604186:  Tht = gecerli sys.notice key enum'u (sys.economy.destroyed ...)
 *      ofset 27136247:  err isleyici: once `key`, yoksa `err.${code}` locale'i gosterilir
 *      ofset 27435481:  T9 = gameConfig.bagSlots  (canta sayfa boyu)
 *      ofset 25597966:  self.potionCooldowns = [{ group:string, readyAt:number }]
 *
 * [S2] data/schemas.json  (ayni paketten cikarilmis sema dokumu) - yukaridakileri dogrular.
 * [S3] data/itemstats.json (2860 esya): type/slot/stackMax/reqLevel/race/weaponType/
 *      restoreHp/restoreMp/restoreHpPct/restoreMpPct/cooldownGroup/cooldownMs/cure/buff
 * [S4] data/game-config.json: bagSlots = 32
 * [S5] client/assets/locales/tr.json: sys.economy.destroyed / err.potion.full /
 *      err.potion.recovering anahtarlarinin GERCEKTEN var oldugu dogrulandi.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/* [S1 @8687659] rY - equip.i bu dizinin INDEKSIDIR. Sira degistirilemez. */
const KUSAM_YUVALARI = [
  'weapon', 'shield', 'head', 'shoulder', 'chest', 'gloves', 'pants', 'boots',
  'avatarDress', 'avatarHat', 'avatarAttach', 'earring', 'necklace', 'ringL', 'ringR',
];

/* [S1 @8692600] uot / dot() - iki elli (kalkan yuvasini kapatan) silah turleri. */
const IKI_ELLI = new Set([
  'spear', 'glavie', 'bow', 'eu_tsword', 'eu_axe', 'eu_dagger',
  'eu_crossbow', 'eu_tstaff', 'eu_harp', 'profession_axe', 'profession_pickaxe',
]);

/* [S1 @8702904] bY = vY(def) || def.type==='avatar' - kusanilabilir esya tipleri. */
const KUSANILABILIR_TIP = new Set(['weapon', 'shield', 'armor', 'accessory', 'avatar']);

/* [S1 @25631378] fx.itemUsed.group enum'u. `purification` BU LISTEDE YOK. */
const FX_GRUPLARI = new Set(['hp', 'mp', 'vigor', 'pill', 'speed']);

/* [S1] E$ semasi paket dokumunda i in 0..159 der; ama o sema YALNIZ SUNUCUDA
   uygulanir - istemci gonderim/alimda runtime dogrulama yapmaz (m$.send sema
   calistirmaz, agt/ogt olu kod; sartname-3 madde 19). Sunucu gevsetilirken
   istemcinin sessiz reddine guvenilemez. SARTNAME-3 MADDE 11: tavan 12 sayfa
   x 32 - 1 = 383 (eski 159). */
const YUVA_MAX = 383;

/* vSRO _Inventory kusam yuvasi sirasi (routes_auth.js equipOf ile AYNI).
   0 head, 1 chest, 2 shoulder, 3 gloves, 4 pants, 5 boots, 6 weapon, 7 shield */
const VSRO_YUVA = ['head', 'chest', 'shoulder', 'gloves', 'pants', 'boots', 'weapon', 'shield'];
const VSRO_CANTA_BASI = 13;   // routes_auth: "Slot < 13" = kusam; >=13 canta

/**
 * [S1 @8693480] lY - toplama aleti weaponType'i -> MESLEK kimligi.
 *     var lY = { profession_axe: `lumberjack`, profession_pickaxe: `miner` };
 *     function uY(arg_e) { return arg_e in lY; }
 * Tablo BURAYA SABIT YAZILMAZ: data/professions.json'daki `toolWeaponType`
 * alanindan turetilir (paket_veri/config/professions.json ile birebir ayni
 * dosya; lumberjack->profession_axe, miner->profession_pickaxe). Boylece veri
 * degisirse kod da izler.
 */
function aletMeslekHaritasi() {
  const m = new Map();
  try {
    const p = JSON.parse(fs.readFileSync(path.join(HERE, 'data', 'professions.json'), 'utf8'));
    for (const d of p?.professions ?? []) {
      if (d?.toolWeaponType && d?.id) m.set(String(d.toolWeaponType), String(d.id));
    }
  } catch { /* dosya yoksa harita bos kalir -> kapi kendiliginden KAPALI (fail-open) */ }
  return m;
}

export function kur(ctx) {
  const {
    frame, broadcast, log = () => {},
    GCFG = {}, ITEMSTATS = new Map(),
    envanterPayload, derived, web = null, SHARD = 'SRO_VT_SHARD',
  } = ctx ?? {};

  const CANTA_YUVASI = Number(GCFG.bagSlots) || 32;         // [S4] 32
  const yaz = (...a) => log('[envanter]', ...a);

  /* [S1 @8693480] lY karsiligi - data/professions.json'dan turetilir. */
  const ALET_MESLEGI = aletMeslekHaritasi();

  /* ---------------------------------------------------------------- yardimci */

  const def = (itemId) => (itemId ? ITEMSTATS.get(itemId) : undefined);

  /** S$ yigin nesnesi mi? Kayit hem duz string hem nesne olabiliyor (SQL'den string). */
  const yigin = (v) => (v == null ? null : (typeof v === 'string' ? { itemId: v, qty: 1 } : v));

  const yiginMax = (itemId) => Math.max(1, Number(def(itemId)?.stackMax ?? 1));

  /** Yigin "sade" mi (yalniz itemId+qty)? Sadece sade yiginlar birlestirilir. */
  function sadeYigin(s) {
    if (!s) return false;
    if (s.plus || s.dur != null || s.maxDur != null || s.variance) return false;
    if (Array.isArray(s.blues) && s.blues.length) return false;
    if (s.rolls && Object.keys(s.rolls).length) return false;
    return true;
  }

  /**
   * ch.bag / ch.equip'i tek bicime getirir.
   * Canta UZUNLUGU ASLA KUCULTULMEZ (esya kaybi olmasin) - yoksa GCFG.bagSlots.
   * gameloop.js #cantayaEkle ile ayni davranis.
   */
  function normalize(ch) {
    const n = Array.isArray(ch.bag) && ch.bag.length ? ch.bag.length : CANTA_YUVASI;
    if (!Array.isArray(ch.bag) || ch.bag.length !== n) {
      const eski = Array.isArray(ch.bag) ? ch.bag : [];
      ch.bag = new Array(n).fill(null);
      for (let i = 0; i < Math.min(eski.length, n); i++) ch.bag[i] = yigin(eski[i]);
    } else {
      for (let i = 0; i < ch.bag.length; i++) ch.bag[i] = yigin(ch.bag[i]);
    }
    const e = {};
    for (const ad of KUSAM_YUVALARI) e[ad] = yigin(ch.equip?.[ad] ?? null);
    ch.equip = e;
    if (!Array.isArray(ch.potionCooldowns)) ch.potionCooldowns = [];
    return ch;
  }

  /** [S1 @27136247] err: once `key`, yoksa `err.<code>` locale'i gosterilir. */
  function hata(ws, code, q, key, params) {
    const d = { code };
    if (key) d.key = key;
    if (params) d.params = params;
    if (q !== undefined) d.q = q;    // istemcinin iyimser bekleme geri alimi q ile eslesir
    frame(ws, 'err', d);
    return true;                     // mesaj BIZE aitti - yonlendirici baskasini denemesin
  }

  /** appearance.equip -> Record<yuvaAdi, itemId>  [S1 @25623981 / @26643202] */
  function gorunum(ch) {
    const r = {};
    for (const ad of KUSAM_YUVALARI) { const s = ch.equip[ad]; if (s) r[ad] = s.itemId; }
    return r;
  }

  /** Kusam degisti: derived yeniden hesapla, hp/mp kirp, 3 kare gonder. */
  function kusamYayinla(ws) {
    const ch = ws.char;
    const d = derived ? derived(ch) : null;
    if (d) {
      /* SADECE YUKARI KIRPMA. `hp || maxHp` gibi bir kisayol OLU karakteri
         (hp 0) tam canla diriltirdi - kusam degistirmek dirilis olamaz. */
      if (typeof ch.hp !== 'number' || Number.isNaN(ch.hp)) ch.hp = d.maxHp;
      else if (ch.hp > d.maxHp) ch.hp = d.maxHp;
      if (typeof ch.mp !== 'number' || Number.isNaN(ch.mp)) ch.mp = d.maxMp;
      else if (ch.mp > d.maxMp) ch.mp = d.maxMp;
      // [S2] stats.update: base{str,int,unspent} + derived + hp/mp (hp/mp INT)
      frame(ws, 'stats.update', {
        base: { str: ch.str ?? 20, int: ch.int ?? 20, unspent: ch.statPoints ?? 0 },
        derived: d, hp: Math.round(ch.hp), mp: Math.round(ch.mp),
      });
    }
    const kare = { id: ws.entityId, equip: gorunum(ch) };
    frame(ws, 'appearance.update', kare);
    broadcast?.(ws.zoneId, 'appearance.update', kare, ws);
    kaliciYaz(ws).catch(e => yaz('kalicilik hatasi:', String(e?.message).slice(0, 120)));
  }

  const envanterYayinla = (ws) => frame(ws, 'inv.update', envanterPayload(ws.char));

  /* ------------------------------------------------------- kusanma kosullari */

  /** def.slot -> kusam yuvasi adi. `ring` iki yuvaya da uyar [S1 @25792304]. */
  function yuvaUyar(d, yuvaAdi) {
    if (!d?.slot) return false;
    if (d.slot === 'ring') return yuvaAdi === 'ringL' || yuvaAdi === 'ringR';
    return d.slot === yuvaAdi;
  }

  /**
   * Esya bu yuvaya kusanilabilir mi? {ok} veya {ok:false, code, key}.
   * Ustalik (reqMastery) kosulu SADECE karakterde gercek bir ustalik listesi
   * varsa denetlenir - ustalik sistemi henuz yok, aksi halde tum Avrupa zirhi
   * kusanilamaz hale gelirdi.
   */
  function kusamKontrol(ch, s, yuvaAdi) {
    const d = def(s?.itemId);
    if (!d) return { ok: false, code: 'ERR_NOT_FOUND' };
    if (!KUSANILABILIR_TIP.has(d.type)) return { ok: false, code: 'ERR_VALIDATION' };
    if (!yuvaUyar(d, yuvaAdi)) return { ok: false, code: 'ERR_VALIDATION' };
    if (Number(d.reqLevel ?? 1) > Number(ch.level ?? 1)) return { ok: false, code: 'ERR_REQ_LEVEL' };
    if (d.race && ch.race && d.race !== ch.race) {
      /* PARITE (PP madde 7) - IRK KAPISI ANAHTARI. Yeni istemcinin KENDI
         kapisi (paket index-CMAf3Hp2.js @18814492) esyanin irkina bakiyor:
           pushSys(r.race === `european` ? `err.equip.europe_only`
                                         : `err.equip.china_only`)
         Ayni dallanma birebir aynalanir. Iki anahtar da yeni err.key
         enum'unda (@18696058) ve tr.json s.142-143'te VAR (dogrulandi).
         ERR_RACE kodu KALIR - istemci code enum'u ve `err.<code>` geri
         dususu icin (tr.json s.95 err.ERR_RACE de mevcut). */
      return { ok: false, code: 'ERR_RACE',
               key: d.race === 'european' ? 'err.equip.europe_only' : 'err.equip.china_only' };
    }
    /* MESLEK ALETI KAPISI.
       NEDEN: meslek aleti, o meslege sahip OLMAYAN karakterce kusanilamaz.
       KAYNAK paket @25791740 (envanter cift-tik kusanma yolu):
         if (item2.type === `weapon` && uY(item2.weaponType)) {
           let v_e2 = lY[item2.weaponType];
           if (!inventoryOwner?.professions?.some(node => node.id === v_e2)) {
             ... pushSys(`err.profession.required`, {profession: ...}), !1
           }
         }
       Istemci bu durumda inv.move'u HIC GONDERMIYOR (mesru istemci bu kapiya
       takilmaz) -> sunucudaki kontrol yalniz uydurulmus istemciye karsidir.
       KOD  : ERR_REQ_PROFESSION (Sht enum'unda VAR, @25603332)
       KEY  : err.profession.required (Eht enum'unda VAR, @25608357;
              tr.json = "Bunun icin {profession} meslegi gerekir.")
       FAIL-OPEN: meslek listesi (ch.meslekler) HENUZ DIZI DEGILSE kapi
       uygulanmaz. sistem_meslek.js listeyi giristen SONRA asenkron dolduruyor
       (yuklemeTik -> WebGetCharProfessions); dizi olmadan reddetmek, gercek
       oduncuyu giris aninda kilitlerdi. Ayni savunmaci kalip yukaridaki
       reqMastery kontrolunde de kullaniliyor. */
    const gerekenMeslek = d.type === 'weapon' ? ALET_MESLEGI.get(String(d.weaponType ?? '')) : undefined;
    if (gerekenMeslek && Array.isArray(ch.meslekler)) {
      if (!ch.meslekler.some(m => m && String(m.id) === gerekenMeslek)) {
        return { ok: false, code: 'ERR_REQ_PROFESSION', key: 'err.profession.required',
                 params: { profession: gerekenMeslek } };
      }
    }
    /* USTALIK KAPISI - "VEYA", "VE" DEGIL.
     *
     * HATA (duzeltildi): burada `for` dongusu vardi ve girdilerden BIRI bile
     * saglanmazsa reddediyordu, yani reqMastery listesini VE olarak okuyordu.
     * Katalogda 576 esya 3 ya da 4 ustalik listeliyor (or. eu_light01_head ->
     * warrior / rogue / cleric); VE kurali bu esyalarin HICBIRININ
     * kusanilamamasi demekti. Kullanicinin bildirimi: buyucu ve rahip
     * ustaliklarini yukseltmis olmasina ragmen "warlock Sv 1 gerekli" hatasi.
     *
     * DOGRUSU - istemcinin KENDI kapisi (paket @27249405, esya ipucu):
     *   let v_e2 = someOwner.some(character =>
     *     (v_c?.find(m => m.masteryId === character.mastery)?.level ?? 0)
     *       >= character.level);
     * `.some(...)` -> girdilerden HERHANGI BIRI yeterli. Ipucu da ayni
     * seviyedeki ustalik adlarini " / " ile birlestirip tek satir basiyor
     * ("Buyucu / Kara Buyucu / Ozan / Rahip Sv 1 gerekli") - VE olsaydi her
     * ustalik icin AYRI satir cikardi.
     *
     * FAIL-OPEN korunuyor: ch.masteries henuz dolmamissa (sistem_stat-ustalik
     * listeyi giristen SONRA asenkron yukluyor) kapi uygulanmaz.
     */
    if (Array.isArray(d.reqMastery) && d.reqMastery.length
        && Array.isArray(ch.masteries) && ch.masteries.length) {
      const saglandi = d.reqMastery.some((g) => {
        const m = ch.masteries.find(x => (x.masteryId ?? x.id) === g.mastery);
        return m && Number(m.level ?? 0) >= Number(g.level ?? 1);
      });
      if (!saglandi) {
        /* Hata mesajinda TEK bir ustalik adi gosterilir (sema {mastery, level}
           tek deger bekliyor). En dusuk seviyeli girdiyi seciyoruz - oyuncuya
           en KOLAY ulasilabilir kosulu soylemek en yardimci olani. */
        const en = d.reqMastery.reduce((a, b) =>
          Number(b.level ?? 1) < Number(a.level ?? 1) ? b : a);
        return { ok: false, code: 'ERR_REQ_MASTERY',
                 params: { mastery: en.mastery, level: en.level ?? 1 } };
      }
    }
    return { ok: true, d };
  }

  const ikiElliMi = (s) => {
    const d = def(s?.itemId);
    return !!(d && d.type === 'weapon' && IKI_ELLI.has(d.weaponType));
  };

  /* ------------------------------------------------------------- inv.move 48 */

  function tasi(ws, veri, q) {
    const ch = normalize(ws.char);
    const f = veri?.from, t = veri?.to;
    if (!gecerliRef(f, ch) || !gecerliRef(t, ch)) return hata(ws, 'ERR_VALIDATION', q);
    if (f.c === t.c && f.i === t.i) return true;                 // ayni yuva - islem yok

    // uzerinde calisilan KOPYALAR; ancak basarida gercek kayda yazilir
    const bag = ch.bag.slice();
    const eq = { ...ch.equip };
    const kaynak = f.c === 'bag' ? bag[f.i] : eq[KUSAM_YUVALARI[f.i]];
    if (!kaynak) return hata(ws, 'ERR_NOT_FOUND', q);

    let kusamDegisti = false;

    if (f.c === 'bag' && t.c === 'bag') {
      const hedef = bag[t.i];
      if (hedef && hedef.itemId === kaynak.itemId
          && yiginMax(kaynak.itemId) > 1 && sadeYigin(hedef) && sadeYigin(kaynak)) {
        // ayni esya + yiginlanabilir -> BIRLESTIR, artan kaynakta kalir
        const max = yiginMax(kaynak.itemId);
        const yer = max - (hedef.qty ?? 1);
        if (yer > 0) {
          const k = Math.min(yer, kaynak.qty ?? 1);
          // paylasilan nesneyi YERINDE degistirme - kopya uzerinde calisiyoruz
          bag[t.i] = { ...hedef, qty: (hedef.qty ?? 1) + k };
          const kalan = (kaynak.qty ?? 1) - k;
          bag[f.i] = kalan > 0 ? { ...kaynak, qty: kalan } : null;
        } else {
          bag[f.i] = hedef; bag[t.i] = kaynak;                   // dolu yigin -> takas
        }
      } else {
        bag[f.i] = hedef ?? null; bag[t.i] = kaynak;             // takas / tasima
      }

    } else if (f.c === 'bag' && t.c === 'equip') {
      const yuvaAdi = KUSAM_YUVALARI[t.i];
      const k = kusamKontrol(ch, kaynak, yuvaAdi);
      if (!k.ok) return hata(ws, k.code, q, k.key, k.params);
      // [S1 @27441700] iki elli silah takiliyken KALKAN yuvasi kapali
      if (yuvaAdi === 'shield' && ikiElliMi(eq.weapon)) return hata(ws, 'ERR_TWO_HANDED', q);
      const eski = eq[yuvaAdi] ?? null;
      eq[yuvaAdi] = kaynak;
      bag[f.i] = eski;                                           // klasik takas
      // iki elli silah kusanildi -> takili kalkan cantaya iner
      if (yuvaAdi === 'weapon' && ikiElliMi(kaynak) && eq.shield) {
        const bos = bag.indexOf(null);
        if (bos < 0) return hata(ws, 'ERR_BAG_FULL', q);         // kopya atildi, kayit bozulmadi
        bag[bos] = eq.shield; eq.shield = null;
      }
      kusamDegisti = true;

    } else if (f.c === 'equip' && t.c === 'bag') {
      const yuvaAdi = KUSAM_YUVALARI[f.i];
      const hedef = bag[t.i];
      if (hedef) {
        const k = kusamKontrol(ch, hedef, yuvaAdi);              // takas: gelen esya uymali
        if (!k.ok) return hata(ws, k.code, q, k.key, k.params);
        if (yuvaAdi === 'shield' && ikiElliMi(eq.weapon)) return hata(ws, 'ERR_TWO_HANDED', q);
        if (yuvaAdi === 'weapon' && ikiElliMi(hedef) && eq.shield) return hata(ws, 'ERR_TWO_HANDED', q);
      }
      eq[yuvaAdi] = hedef ?? null;
      bag[t.i] = kaynak;
      kusamDegisti = true;

    } else {                                                     // equip -> equip
      const a = KUSAM_YUVALARI[f.i], b = KUSAM_YUVALARI[t.i];
      const hedef = eq[b];
      const k1 = kusamKontrol(ch, kaynak, b);
      if (!k1.ok) return hata(ws, k1.code, q, k1.key, k1.params);
      if (hedef) {
        const k2 = kusamKontrol(ch, hedef, a);
        if (!k2.ok) return hata(ws, k2.code, q, k2.key, k2.params);
      }
      eq[b] = kaynak; eq[a] = hedef ?? null;
      kusamDegisti = true;
    }

    ch.bag = bag; ch.equip = eq;
    envanterYayinla(ws);
    if (kusamDegisti) kusamYayinla(ws);
    return true;
  }

  function gecerliRef(r, ch) {
    if (!r || (r.c !== 'bag' && r.c !== 'equip')) return false;
    const i = Number(r.i);
    if (!Number.isInteger(i) || i < 0 || i > YUVA_MAX) return false;
    return r.c === 'bag' ? i < ch.bag.length : i < KUSAM_YUVALARI.length;
  }

  /* -------------------------------------------------------------- inv.use 49 */

  const bekleyen = (ch, grup) => ch.potionCooldowns.find(x => x.group === grup) ?? null;

  function bekletmeKur(ch, grup, ms) {
    const readyAt = Date.now() + Math.max(0, Number(ms) || 0);
    const v = bekleyen(ch, grup);
    if (v) v.readyAt = readyAt; else ch.potionCooldowns.push({ group: grup, readyAt });
  }

  function kullan(ws, veri, q) {
    const ch = normalize(ws.char);
    const i = Number(veri?.bagSlot);
    if (!Number.isInteger(i) || i < 0 || i > YUVA_MAX || i >= ch.bag.length) {
      return hata(ws, 'ERR_VALIDATION', q);
    }
    const s = ch.bag[i];
    if (!s) return hata(ws, 'ERR_NOT_FOUND', q);
    const d = def(s.itemId);
    if (!d) return hata(ws, 'ERR_NOT_FOUND', q);
    /* DENETIM DUZELTMESI: `err.ERR_DEAD` tr.json'da YOK (3025 anahtar tarandi) -
       anahtarsiz ERR_DEAD istemcide HIC SATIR BASMIYOR [S1 @27136247].
       Eht enum'unda gecen ve tr.json'da GERCEKTEN bulunan karsilik:
       err.busy.downed = "Yere serildin."  (oyunun kendi olu/serilmis terimi;
       krs. err.skill.requires_downed = "Hedef yere serilmis olmali.") */
    if (ch.dead) return hata(ws, 'ERR_DEAD', q, 'err.busy.downed');

    /* [S1 @25928200] istemci inv.use'u yalniz consumable / petConsumable icin yollar.
       petConsumable = buyume peti besleme/diriltme.

       PET SISTEMI ARTIK VAR (sistem_binek-pet.js `esyaKullan(ws, def, petTarget)`
       disa aciyor) ama modul kopruleri ctx uzerinden gecmek zorunda - moduller
       birbirini dogrudan import etmiyor. Kopru BAGLANANA KADAR eski davranis
       (ERR_PET_STATE) aynen korunur, yani bu degisiklik hicbir seyi bozmaz.
       Sema: inv.use(49) {bagSlot, petTarget}, petTarget enum lht =
       qJ([`growth`,`mount`])  (paket @25596186 / @25609306).
       Sozlesme (sistem_binek-pet.js ORNEK.esyaKullan): true = uygulandi, 1 adet
       dus | false = err ZATEN gonderildi, dokunma | null/undefined = benim
       esyam degil. */
    if (d.type === 'petConsumable') {
      const petHedef = veri?.petTarget === 'growth' || veri?.petTarget === 'mount'
        ? veri.petTarget : undefined;
      const r = ctx?.binekEsyaKullan?.(ws, d, petHedef);
      if (r === true) {
        const kalanPet = (s.qty ?? 1) - 1;
        ch.bag[i] = kalanPet > 0 ? { ...s, qty: kalanPet } : null;
        envanterYayinla(ws);
        return true;
      }
      if (r === false) return true;                 // modul kendi err'ini yolladi
      return hata(ws, 'ERR_PET_STATE', q);          // kopru yok -> eski davranis
    }
    if (d.type !== 'consumable') return hata(ws, 'ERR_VALIDATION', q);
    if (Number(d.reqLevel ?? 1) > Number(ch.level ?? 1)) return hata(ws, 'ERR_REQ_LEVEL', q);

    const grup = String(d.cooldownGroup ?? 'hp');
    const bek = bekleyen(ch, grup);
    /* ERR_COOLDOWN: istemci KENDI iyimser beklemesini geri ALMAZ [S1 @25929680] -
       dogru davranis, cunku bekleme gercekten devam ediyor. */
    if (bek && Date.now() < bek.readyAt) {
      return hata(ws, 'ERR_COOLDOWN', q, 'err.potion.recovering');
    }

    const dr = derived ? derived(ch) : null;
    const maxHp = Math.max(1, Math.round(dr?.maxHp ?? ch.hp ?? 1));
    const maxMp = Math.max(1, Math.round(dr?.maxMp ?? ch.mp ?? 1));
    const hpVer = Math.floor(Number(d.restoreHp ?? 0)) + Math.floor(maxHp * Number(d.restoreHpPct ?? 0));
    const mpVer = Math.floor(Number(d.restoreMp ?? 0)) + Math.floor(maxMp * Number(d.restoreMpPct ?? 0));

    /* Iyilestirmesi olmayan iksirler:
       - cure (universal/purification haplari): S2 MADDE 16 - artik durumlar.js
         arindir()'ina BAGLI (asagidaki esyaArindir). Arinma gerceklesirse
         NORMAL tuketim akisi isler (adet duser, cooldownGroup uygulanir) ve
         ERR_BUSY GITMEZ - istemcinin iyimser beklemesi yerinde kalir
         [S1 @25929680 geri alma semantigi bozulmaz].
       - buff (hiz parsomeni): BUFF motoru koprusu HENUZ YOK - eski davranis.
       Arinacak durum yoksa / kopru yoksa esyayi bos yere harcamamak icin
       tuketmeden reddediyoruz. ERR_BUSY secildi: ERR_COOLDOWN/ERR_VALIDATION
       disindaki her kod istemcinin iyimser beklemesini GERI ALDIRIR
       [S1 @25929680] - iksir harcanmadigi icin beklemenin de silinmesi gerekir. */
    if (hpVer <= 0 && mpVer <= 0) {
      if (d.cure && esyaArindir(ws, ch, i, s, d, grup)) return true;
      return hata(ws, 'ERR_BUSY', q, d.cure || d.buff ? undefined : 'err.potion.full');
    }

    const hp0 = Math.round(Math.min(ch.hp ?? maxHp, maxHp));
    const mp0 = Math.round(Math.min(ch.mp ?? maxMp, maxMp));
    const doluHp = hpVer > 0 ? hp0 >= maxHp : true;
    const doluMp = mpVer > 0 ? mp0 >= maxMp : true;
    // Etkisinin TAMAMI bosa gidecekse tuketme [S5 err.potion.full = "Zaten dolu."]
    if (doluHp && doluMp) return hata(ws, 'ERR_BUSY', q, 'err.potion.full');

    ch.hp = Math.min(maxHp, hp0 + hpVer);
    ch.mp = Math.min(maxMp, mp0 + mpVer);

    // esyayi eksilt
    const kalan = (s.qty ?? 1) - 1;
    ch.bag[i] = kalan > 0 ? { ...s, qty: kalan } : null;

    bekletmeKur(ch, grup, d.cooldownMs);

    envanterYayinla(ws);
    frame(ws, 'vitals.update', { hp: Math.round(ch.hp), mp: Math.round(ch.mp) });
    // [S1 @25631378] group enum'unda olmayan grup (purification) icin fx GONDERILMEZ
    if (FX_GRUPLARI.has(grup)) {
      const fx = { id: ws.entityId, group: grup };
      frame(ws, 'fx.itemUsed', fx);
      broadcast?.(ws.zoneId, 'fx.itemUsed', fx, ws);
    }
    return true;
  }

  /**
   * S2 MADDE 16 - CURE ESYALARI (pill_universal_* / pill_purification_*).
   *
   * Beceri tarafindaki arinmayla (sistem_beceri.js arindirUygula, MADDE 40)
   * AYNI motor ve AYNI semantik. Kopru ctx.sistemOrnegi('beceri') uzerinden -
   * moduller birbirini dogrudan import etmiyor (petConsumable koprusuyle ayni
   * kalip); kancalar sistem_beceri.js "DIS MODULLERE ACIK KANCALAR" blogunda:
   * durumListesi(zoneId, entityId) + durumMotoru (tek ornek).
   *
   * Veri (data/itemstats.json, 9 cure kaydi):
   *   cure.kind 'universal'    -> amounts[6] = 6 element durumu. Beceri
   *     dokumani (paket @25075309 LY bitleri): curt.maskRaw 63 = fz|fb|es|bu|
   *     ps|zb ve durumlar.js DURUM_META bit 0..5 birebir ayni altili; maske
   *     amounts UZUNLUGUNDAN turetilir ((1<<6)-1 = 63), elle sayi yazilmaz.
   *     `amounts` DEGERLERININ (or. 228) sayisal kullanimi paketten COZULEMEDI
   *     (beceri MADDE 40 curt.amount notuyla ayni durum) - sayi uydurulmadi,
   *     adaylar dogrudan dusurulur.
   *   cure.kind 'purification' -> becerideki curl semantigi: maskRaw adaylari
   *     + baseChancePct zari (100 = kesin; elimizdeki 4 kayitta hep 100).
   *     cureLevel ayni cozulmemis alan - beceri yolundaki gibi UYGULANMAZ.
   *
   * Doner: true  = arinma uygulandi, esya tuketildi, kareler gitti;
   *        false = uygulanamadi (kopru yok / arinacak durum yok / zar tutmadi)
   *                - cagiran ERR_BUSY reddine duser, esya HARCANMAZ.
   */
  function esyaArindir(ws, ch, i, s, d, grup) {
    const BECERI = ctx?.sistemOrnegi?.('beceri');
    const motor = BECERI?.durumMotoru;
    if (!motor || typeof BECERI?.durumListesi !== 'function') return false;

    const l = BECERI.durumListesi(ws.zoneId, ws.entityId);
    if (!l.length) return false;

    const maske = d.cure.kind === 'universal'
      ? (1 << (Array.isArray(d.cure.amounts) ? d.cure.amounts.length : 0)) - 1
      : (Number(d.cure.maskRaw) || 0);
    const icinde = (kod) => {
      const b = motor.DURUM_META?.[kod]?.bit;
      return Number.isFinite(b) && (maske & (1 << b)) !== 0;
    };
    const sans = d.cure.kind === 'purification' ? Number(d.cure.baseChancePct ?? 0) : 100;
    const kodlar = [];
    for (const k of l) {
      if (!icinde(k.code)) continue;
      if (sans < 100 && Math.random() * 100 >= sans) continue;   // curl zari (beceri ile ayni)
      kodlar.push(k.code);
    }
    if (!kodlar.length) return false;

    /* @26756085: reason 'cured' istemcide ACT_S (arinma) efektini oynatir. */
    const r = motor.arindir(l, kodlar, 'cured');
    if (!r.degisti) return false;

    // NORMAL tuketim akisi (S2 madde 16): adet dus + cooldownGroup uygula
    const kalan = (s.qty ?? 1) - 1;
    ch.bag[i] = kalan > 0 ? { ...s, qty: kalan } : null;
    bekletmeKur(ch, grup, d.cooldownMs);
    envanterYayinla(ws);

    // s2c 199 statuses.update - sistem_beceri.durumYayinla ile ayni kare bicimi
    const kare = {
      id: ws.entityId, statuses: motor.aktif(l),
      removed: r.dusenler.map((x) => ({ code: x.code, reason: x.reason })),
    };
    frame(ws, 'statuses.update', kare);
    broadcast?.(ws.zoneId, 'statuses.update', kare, ws);

    // [S1 @25631378] grup enum'da ise fx ('pill' VAR, 'purification' YOK)
    if (FX_GRUPLARI.has(grup)) {
      const fx = { id: ws.entityId, group: grup };
      frame(ws, 'fx.itemUsed', fx);
      broadcast?.(ws.zoneId, 'fx.itemUsed', fx, ws);
    }
    return true;
  }

  /* ------------------------------------------------------------ inv.split 43 */

  function bol(ws, veri, q) {
    const ch = normalize(ws.char);
    const i = Number(veri?.bagSlot);
    const adet = Number(veri?.qty);
    if (!Number.isInteger(i) || i < 0 || i >= ch.bag.length) return hata(ws, 'ERR_VALIDATION', q);
    if (!Number.isInteger(adet) || adet < 1 || adet > 1000) return hata(ws, 'ERR_VALIDATION', q);
    const s = ch.bag[i];
    if (!s) return hata(ws, 'ERR_NOT_FOUND', q);
    // istemci itemId'yi de yolluyor - desenkron korumasi
    if (veri.itemId !== s.itemId) return hata(ws, 'ERR_VALIDATION', q);
    if (yiginMax(s.itemId) <= 1) return hata(ws, 'ERR_VALIDATION', q);
    if (adet >= (s.qty ?? 1)) return hata(ws, 'ERR_VALIDATION', q);   // en az 1 kalmali
    const bos = ch.bag.indexOf(null);
    if (bos < 0) return hata(ws, 'ERR_BAG_FULL', q);

    ch.bag[bos] = { ...s, qty: adet };
    ch.bag[i] = { ...s, qty: (s.qty ?? 1) - adet };
    envanterYayinla(ws);
    return true;
  }

  /* ---------------------------------------------------------- inv.destroy 47 */

  function yokEt(ws, veri, q) {
    const ch = normalize(ws.char);
    const i = Number(veri?.bagSlot);
    const adet = Number(veri?.qty);
    if (!Number.isInteger(i) || i < 0 || i >= ch.bag.length) return hata(ws, 'ERR_VALIDATION', q);
    if (!Number.isInteger(adet) || adet < 1 || adet > 1000) return hata(ws, 'ERR_VALIDATION', q);
    const s = ch.bag[i];
    if (!s) return hata(ws, 'ERR_NOT_FOUND', q);
    if (veri.itemId !== s.itemId) return hata(ws, 'ERR_VALIDATION', q);
    if (adet > (s.qty ?? 1)) return hata(ws, 'ERR_VALIDATION', q);

    const kalan = (s.qty ?? 1) - adet;
    ch.bag[i] = kalan > 0 ? { ...s, qty: kalan } : null;
    envanterYayinla(ws);
    // [S5] tr.json: "sys.economy.destroyed" = "{qty} × {item} yok edildi."
    frame(ws, 'sys.notice', {
      key: 'sys.economy.destroyed',
      params: { qty: adet, item: def(s.itemId)?.name ?? s.itemId },
    });
    return true;
  }

  /* --------------------------------------------------------------- kalicilik */

  /* routes_auth.js'in vsroToOyun esleme KURALLARININ TERSI. Kapsam bilerek
     dardir: itemmap.json yalnizca 1. derece baslangic setini tasiyor; oyun ici
     dusen esyalarin vSRO karsiligi YOK ve DB'ye yazilmaz (bellekte kalir). */
  const oyunToVsro = (() => {
    const m = new Map();
    try {
      const im = JSON.parse(fs.readFileSync(path.join(HERE, 'itemmap.json'), 'utf8'));
      for (const [k, v] of Object.entries(im.armor ?? {})) {
        const [irk, , sinif, slot] = k.split('|');
        m.set(`${irk === 'european' ? 'eu_' : ''}${sinif}01_${slot}`, v.code);
      }
      for (const [k, v] of Object.entries(im.weapons ?? {})) m.set(k + '01', v.code);
      for (const [k, v] of Object.entries(im.shields ?? {})) {
        m.set((k === 'european' ? 'eu_' : '') + 'shield01', v.code);
      }
    } catch { /* itemmap yoksa kalicilik kapali kalir */ }
    return m;
  })();

  /**
   * SAF PLANLAYICI (test edilebilir): mevcut _Inventory satirlarindan ve hedef
   * kusamdan, yazilacak `{slot, itemId}` listesini uretir.
   *   satirlar : [{ Slot:int, ItemID:number|string, CodeName128:string|null }]
   *   hedefEquip: ch.equip (referans oyun bicimi)
   * Kural: vSRO'da _Inventory ANAHTARI (CharID, Slot) - "esyayi tasima" demek
   * IKI SATIRIN ItemID'sini degistirmek demektir. Yalnizca VAR OLAN satirlar
   * kullanilir; olmayan yuvaya yazilmaz (yoksa esya buharlasir).
   */
  function vsroPlani(satirlar, hedefEquip) {
    const varOlan = new Map();                       // slot -> {ItemID, CodeName128}
    for (const r of satirlar) varOlan.set(Number(r.Slot), r);
    const kodSatir = new Map();                      // CodeName128 -> ItemID (ilk eslesme)
    const hamId = new Map();                         // Number(ItemID) -> DB'deki HAM deger
    for (const r of satirlar) {
      const n = Number(r.ItemID);
      if (n > 0 && !hamId.has(n)) hamId.set(n, r.ItemID);
      if (r.CodeName128 && n > 0 && !kodSatir.has(r.CodeName128)) kodSatir.set(r.CodeName128, n);
    }
    const sonuc = new Map();                         // slot -> ItemID (nihai)
    for (const [slot, r] of varOlan) sonuc.set(slot, Number(r.ItemID) || 0);

    const bosCantaYuvasi = () => {
      for (const slot of [...varOlan.keys()].sort((a, b) => a - b)) {
        if (slot >= VSRO_CANTA_BASI && !(sonuc.get(slot) > 0)) return slot;
      }
      return -1;
    };

    for (let vs = 0; vs < VSRO_YUVA.length; vs++) {
      if (!varOlan.has(vs)) continue;                // satir yok - dokunma
      const jw = hedefEquip[VSRO_YUVA[vs]];
      const istenenKod = jw ? oyunToVsro.get(jw.itemId) : null;
      const suanki = sonuc.get(vs) || 0;
      const istenenId = istenenKod ? (kodSatir.get(istenenKod) ?? null) : 0;

      if (istenenKod && istenenId === null) continue;   // DB karsiligi yok - dokunma
      if (suanki === (istenenId || 0)) continue;        // zaten dogru

      if (suanki > 0) {                                 // eski esyayi cantaya indir
        const bos = bosCantaYuvasi();
        if (bos < 0) return null;                       // yer yok - HIC yazma
        sonuc.set(bos, suanki);
      }
      if (istenenId) {                                  // istenen esyanin eski yerini bosalt
        for (const [slot, id] of sonuc) if (id === istenenId && slot !== vs) sonuc.set(slot, 0);
      }
      sonuc.set(vs, istenenId || 0);
    }

    const plan = [];
    for (const [slot, id] of sonuc) {
      // itemId: DB'deki HAM degeri koru (ID64 bigint; Number'a dusurmek tasma yapabilir)
      if ((Number(varOlan.get(slot)?.ItemID) || 0) !== id) {
        plan.push({ slot, itemId: id ? (hamId.get(id) ?? id) : 0 });
      }
    }
    return plan.sort((a, b) => a.slot - b.slot);
  }

  /** Plani uygular. ctx.web yoksa (su an null) sessizce atlanir. */
  async function kaliciYaz(ws) {
    if (!web || !ws?.char?.id || !oyunToVsro.size) return;
    const charId = Number(ws.char.id);
    if (!Number.isInteger(charId) || charId <= 0) return;
    const sql = (await import('mssql')).default;
    const q0 = await web.request()
      .input('c', sql.Int, charId)
      .query(`SELECT i.Slot, i.ItemID, o.CodeName128
                FROM ${SHARD}.dbo._Inventory i
                LEFT JOIN ${SHARD}.dbo._Items it ON it.ID64 = i.ItemID
                LEFT JOIN ${SHARD}.dbo._RefObjCommon o ON o.ID = it.RefItemID
               WHERE i.CharID = @c`);
    const plan = vsroPlani(q0.recordset ?? [], ws.char.equip ?? {});
    if (!plan || !plan.length) return;
    for (const p of plan) {
      // ItemID = _Items.ID64 (bigint) - Int olarak baglamak tasmaya yol acar
      await web.request()
        .input('c', sql.Int, charId)
        .input('s', sql.Int, p.slot)
        .input('it', sql.BigInt, String(p.itemId))
        .query(`UPDATE ${SHARD}.dbo._Inventory SET ItemID=@it WHERE CharID=@c AND Slot=@s`);
    }
    yaz(`kusam kaydedildi: char ${charId}, ${plan.length} yuva`);
  }

  /* ------------------------------------------------------------- yonlendirme */

  return {
    /** q 4. parametre OLARAK GELIRSE err karelerinde yankilanir (bkz. BAGLAMA NOTU). */
    mesaj(ws, t, d, q) {
      if (!ws?.char) return false;
      switch (t) {
        case 'inv.move':    return tasi(ws, d ?? {}, q);
        case 'inv.use':     return kullan(ws, d ?? {}, q);
        case 'inv.split':   return bol(ws, d ?? {}, q);
        case 'inv.destroy': return yokEt(ws, d ?? {}, q);
        default:            return false;     // ilgilenmiyoruz - yonlendirici devam etsin
      }
    },
    // birim testi ve ileride baska modullerin kullanmasi icin
    _ic: { normalize, vsroPlani, KUSAM_YUVALARI, IKI_ELLI, oyunToVsro },
  };
}

/* ============================================================================
 * BAGLAMA NOTU  (server.js icin)
 * ----------------------------------------------------------------------------
 * ctx'den KULLANDIKLARIM:
 *   frame, broadcast, log, GCFG (bagSlots), ITEMSTATS (Map), envanterPayload(ch),
 *   derived(ch), web (mssql pool | null), SHARD,
 *   binekEsyaKullan (petConsumable koprusu),
 *   sistemOrnegi('beceri') (S2 madde 16: cure esyalari icin durumListesi +
 *   durumMotoru koprusu - modul yoksa cure haplari eski ERR_BUSY reddine duser).
 *   KULLANMADIKLARIM: world, combat, zoneGroundY, yurunebilirNokta.
 *   ws uzerinden okuduklarim: ws.char, ws.entityId, ws.zoneId.
 *
 * ISLEDIGIM MESAJLAR (digerlerinde false doner):
 *   c2s 48 inv.move | c2s 49 inv.use | c2s 43 inv.split | c2s 47 inv.destroy
 *
 * GONDERDIGIM S2C KARELERI:
 *   149 inv.update      - her degisiklikte, TAM envanter (envanterPayload)
 *   146 stats.update    - kusam degisince (derived yeniden hesaplanir)
 *   151 appearance.update - kusam degisince: kendine frame + bolgeye broadcast
 *   150 vitals.update   - iksir icilince
 *   187 fx.itemUsed     - iksir icilince (grup enum'da ise) kendine + bolgeye
 *   199 statuses.update - cure hapi durum dusurunce (S2 madde 16): kendine
 *                         frame + bolgeye broadcast (sistem_beceri ile ayni kare)
 *   195 sys.notice      - inv.destroy sonrasi sys.economy.destroyed
 *   240 err             - ERR_VALIDATION / ERR_NOT_FOUND / ERR_BAG_FULL /
 *                         ERR_TWO_HANDED / ERR_REQ_LEVEL / ERR_RACE /
 *                         ERR_REQ_MASTERY / ERR_COOLDOWN / ERR_BUSY /
 *                         ERR_DEAD / ERR_PET_STATE   (hepsi paketteki Sht enum'unda)
 *
 * err.q GOVDEDEDIR, ZARFTA DEGIL: istemcinin err isleyicisi `codeOwner.q`, yani
 *   d.q okuyor (@27134326: `$gt(codeOwner.q), sxt(codeOwner.q, codeOwner.code)`)
 *   ve err semasi q'yu ZATEN govdesinde tasiyor (@25631829). Bu yuzden hata()
 *   q'yu d'nin icine koyuyor; server.js'in frame(ws,t,d,q) 4. parametresi
 *   (zarf alani) err icin ISE YARAMAZDI.
 *
 * KALAN LOCALE BOSLUGU (modulun degil, tr.json'un eksigi - DENETIMDE BULUNDU):
 *   `err.ERR_TWO_HANDED` tr.json'da YOK (3025 anahtar tarandi) ve Eht enum'unun
 *   80 anahtarinin hicbiri "iki elli silah" demiyor -> iki elli silah reddi
 *   istemcide SESSIZ kaliyor (esya geri siciriyor, satir yazilmiyor). Kod dogru
 *   (ERR_TWO_HANDED Sht enum'unda VAR); gorunur olmasi icin tr.json'a
 *   "err.ERR_TWO_HANDED" satiri eklenmeli. Sirf mesaj ciksin diye YANLIS bir
 *   kod secilmedi.
 *   ERR_DEAD ayni bosluktaydi; Eht'te GERCEKTEN bulunan ve tr.json'da karsiligi
 *   olan `err.busy.downed` ("Yere serildin.") anahtari eklenerek cozuldu.
 *
 * ISTENEN IKI KUCUK SERVER.JS DUZENLEMESI (ikisi de ZORUNLU DEGIL):
 *   1) Yonlendirici modullere `q`'yu da versin:  ornek.mesaj(ws, t, d, q)
 *      Neden: istemci iyimser iksir beklemesini SADECE ayni q'lu err karesiyle
 *      geri aliyor (paket @25929680). 3 parametreli cagri da calisir, yalnizca
 *      reddedilen iksirin bekleme cubugu suresi dolana dek ekranda kalir.
 *   2) selfPayload icindeki sabit `potionCooldowns: []` yerine
 *      `ch.potionCooldowns ?? []` yazilsin - bu modul bekletmeleri orada
 *      (paketteki [{group, readyAt}] biciminde) tutuyor; boylece bolge
 *      degisiminde/yeniden girişte bekleme kaybolmaz.
 * ============================================================================ */
