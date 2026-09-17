/**
 * DUKKAN SISTEMI  -  shop.buy / shop.sell / item.repair / item.repairHammer
 * ---------------------------------------------------------------------------
 * Hicbir sayi uydurulmadi. Kaynaklar:
 *
 *  1) Istemci paketi  playjs_source/index-BUMMQVRB.js  (T$ mesaj kayitlari)
 *
 *     T$(`shop.buy`, 51, X({                        // ~satir 623971
 *       npcId: J(),
 *       itemId: J(),
 *       qty: Y().int().min(1).max(1e3)              // D$ = qty semasi
 *     }), `shop`)
 *
 *     T$(`shop.sell`, 52, X({                       // ~satir 623975
 *       npcId: J(),
 *       bagSlot: Y().int().min(0).max(159),
 *       qty: Y().int().min(1).max(1e3)
 *     }), `shop`)
 *
 *     T$(`item.repair`, 54, X({                     // ~satir 623983
 *       npcId: J()
 *     }), `shop`)
 *
 *     T$(`item.repairHammer`, 42, X({               // ~satir 624900
 *       bagSlot: Y().int().min(0).max(159)
 *     }), `inv`)
 *
 *  2) Fiyat / dayaniklilik:  data/items.json + ctx.ITEMSTATS
 *     (buyPrice, sellPrice, costRepair, costRevive, stackMax, rollRanges.durability)
 *
 *  3) Dukkan stogu:  data/npcshops.json -> shops[npcId].shop.stock / .tabs[].items
 *     yedek: world.json -> npcCatalog[npcId].shop.tabs[].items
 *     Istemci de ayni birlesimi yapiyor (paket ~satir 611062):
 *       shopOwner.shop.stock = [...new Set([...stock, ...tabs.flatMap(t => t.items)])]
 *
 *  4) Etkilesim menzili:  npcshops.json shops[].interactRangeU (config/interact-radii.json
 *     degerleri sroCode ile eslenmis: 15 / 15.25 / 18.25 / 22.75), yoksa
 *     game-config.json npcInteractRangeU = 25.
 *     Istemci: Ict(npc, cfg.npcInteractRangeU) = npc.interactRangeU ?? cfg.npcInteractRangeU
 *
 *  5) Tamir ucreti - istemcideki _Lt() fonksiyonunun BIREBIR aynisi
 *     (paket ~satir 665165):
 *       for (item of bag+equip, dur!=null && maxDur!=null) {
 *         def = itemsById.get(item.itemId)
 *         if (!def || !vY(def) || def.type === 'accessory') continue
 *         per = Math.max(1, def.costRepair / item.maxDur)
 *         cost += item.dur <= 0
 *               ? def.costRevive + Math.round((item.maxDur - 1) * per)
 *               : Math.round((item.maxDur - item.dur) * per)
 *       }
 *       vY = type === 'weapon' | 'shield' | 'armor' | 'accessory'   (~satir 658288)
 *
 *  6) Tamir cekici onizleme puani - istemcideki gLt() (paket ~satir 665160):
 *       for (item of bag+equip, dur!=null && maxDur!=null)
 *         points += Math.max(0, item.maxDur - item.dur)
 *
 *  7) Satin alinan ekipmanin bicimi - CANLI yakalama GERCEK/zone_init.json:
 *       {"itemId":"sword01","qty":1,"plus":0,"variance":0,"dur":62,"maxDur":62}
 *     sword01 rollRanges.durability = [62,76] -> variance 0 => 62.
 *     Yani variance 0 (aralik alt siniri) sunucunun yerlesik kurali; combat.js
 *     de ayni sekilde okuyor.
 *
 *  8) Bildirim anahtarlari - istemcinin sys.notice `key` enum'u (Tht listesi,
 *     paket ~satir 623917) VE client/assets/locales/tr.json icinde gercekten var:
 *       sys.economy.bought              {qty} x {item} satin alindi - {gold} altin
 *       sys.economy.sold                {qty} x {item} satildi - {gold} altin
 *       sys.economy.repaired            Tum ekipman {gold} altina tamir edildi
 *       sys.economy.repaired_free       Tamir cekici kullanildi - {points} ...
 *       sys.economy.nothing_to_repair   Tamir gereken bir sey yok.
 *
 *  9) Hata kodlari - istemcinin err `code` enum'u (Sht listesi, paket ~satir 623903).
 *     Enumda OLMAYAN bir kod gonderirsen istemci paketi Zod'da sessizce duser.
 *
 * 10) DENETIM NOTU (err.ERR_DEAD ceviri bosluku): istemcinin err isleyicisi
 *     (paket ~satir 654861) once `key`, sonra `err.<code>` anahtarini dener ve
 *     ANAHTAR YOKSA EKRANA HIC SATIR BASMAZ. tr.json'da err.ERR_VALIDATION /
 *     ERR_RANGE / ERR_NO_GOLD / ERR_BAG_FULL / ERR_NOT_FOUND var ama
 *     `err.ERR_DEAD` YOK. Bu yuzden olum kapisinda kod ERR_DEAD kalirken
 *     yanina Eht enumunda VE tr.json'da bulunan `err.busy.downed`
 *     ("Yere serildin.") anahtari eklenir.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
/* Esya ORNEK alanlarinin (plus/variance/dur/maxDur) tek uretim noktasi -
   plan maddesi 26. Kural ve kanitlar esya.js basliginda. */
import { yeniYigin } from './esya.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Bu modulun sahiplendigi c2s mesajlari. Digerleri icin mesaj() false doner. */
const MESAJLAR = new Set(['shop.buy', 'shop.sell', 'item.repair', 'item.repairHammer']);

/** Istemcideki vY(): "ekipman" sayilan turler. */
const EKIPMAN_TURLERI = new Set(['weapon', 'shield', 'armor', 'accessory']);

/** Istemcinin err.code enum'undan (Sht) kullandiklarimiz. */
const HATA = {
  DOGRULAMA: 'ERR_VALIDATION',
  MENZIL: 'ERR_RANGE',
  ALTIN: 'ERR_NO_GOLD',
  CANTA: 'ERR_BAG_FULL',
  OLU: 'ERR_DEAD',
  BULUNAMADI: 'ERR_NOT_FOUND',
};

/* PP MADDE 3 (changelog 0025 tr:8-11): karakter ustunde en fazla
   999.999.999.999 altin; siniri asacak dukkana SATIS acik mesajla reddedilir
   (err.gold_cap + {cap}, tr.json s.145). Ayni tavan gameloop (altin
   ganimeti), sistem_banka-depo ve sistem_lonca (cekimler) ile ortak deger. */
const ALTIN_TAVANI = 999_999_999_999;

// ---------------------------------------------------------------- yardimcilar

/** data/ altindan JSON okur; yoksa null. */
function okuJson(dataDir, dosya) {
  const adaylar = [path.join(dataDir, dosya), path.join(HERE, 'data', dosya)];
  for (const p of adaylar) {
    try {
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch { /* bozuk dosya -> sonraki aday */ }
  }
  return null;
}

/** Dizi/nesne farketmeksizin esya kayitlarini dolasir. */
function esyaListesi(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  if (Array.isArray(v.items)) return v.items;
  return Object.values(v);
}

// ============================================================================

/**
 * @param {object} ctx  server.js'in gecirdigi baglam.
 *   Kullanilanlar: world, frame, log, GCFG, ITEMSTATS, envanterPayload, web, SHARD
 */
export function kur(ctx) {
  const {
    world = null,
    frame = () => {},
    log = () => {},
    GCFG = {},
    ITEMSTATS = null,
    envanterPayload = null,
    web = null,
    SHARD = null,
    /* MADDE 60 (capraz istek 64): takas kilidi icin sistem_ticaret.takastaMi. */
    sistemOrnegi = null,
  } = ctx ?? {};

  const dataDir = world?.dataDir ?? path.join(HERE, 'data');
  const CANTA_YUVASI = Number(GCFG.bagSlots) > 0 ? Number(GCFG.bagSlots) : 32;
  const VARSAYILAN_MENZIL = Number(GCFG.npcInteractRangeU) > 0
    ? Number(GCFG.npcInteractRangeU) : 25;

  // ------------------------------------------------------------ esya katalogu
  /* ITEMSTATS 2860 esya iceriyor ama `repair_hammer` gibi item-mall esyalari
     yalnizca data/items.json'da (3005 kayit, config/extra-items.json birlesik).
     Once items.json'i yukle, sonra ctx'ten gelen ITEMSTATS'i ustune bindir. */
  const KATALOG = new Map();
  for (const it of esyaListesi(okuJson(dataDir, 'items.json'))) {
    if (it?.id) KATALOG.set(it.id, it);
  }
  const itemsJsonSayisi = KATALOG.size;
  if (ITEMSTATS && typeof ITEMSTATS.forEach === 'function') {
    ITEMSTATS.forEach((def, id) => { if (def) KATALOG.set(id, def); });
  }
  const esyaTanim = (id) => (id ? KATALOG.get(id) ?? null : null);

  // ------------------------------------------------------------ dukkan katalogu
  /** npcId -> { id, name, menzil, tamir, stok:Set<string>, dukkanVar:boolean } */
  const DUKKANLAR = new Map();

  const dukkanEkle = (npcId, kayit) => {
    if (!npcId || !kayit) return;
    const eski = DUKKANLAR.get(npcId);
    const stok = eski?.stok ?? new Set();
    const tabs = kayit.shop?.tabs ?? [];
    for (const s of kayit.shop?.stock ?? []) if (typeof s === 'string') stok.add(s);
    for (const t of tabs) for (const s of t?.items ?? []) if (typeof s === 'string') stok.add(s);
    /* DIKKAT: Number(null) === 0 ve 0 "sonlu" bir sayidir; sadece isFinite'e
       bakarsak interactRangeU: null olan bir kayit menzili 0'a cekip dukkani
       tumden ulasilmaz yapardi. Bu yuzden > 0 sarti da var. */
    const mr = Number(kayit.interactRangeU);
    DUKKANLAR.set(npcId, {
      id: npcId,
      name: kayit.name ?? eski?.name ?? npcId,
      // interactRangeU yoksa game-config npcInteractRangeU (istemci Ict() ile ayni)
      menzil: Number.isFinite(mr) && mr > 0
        ? mr
        : (eski?.menzil ?? VARSAYILAN_MENZIL),
      tamir: kayit.repair === true || eski?.tamir === true,
      dukkanVar: !!kayit.shop || eski?.dukkanVar === true,
      stok,
    });
  };

  const npcshops = okuJson(dataDir, 'npcshops.json');
  /* SADECE dukkan/tamir kayitlari. MADDE 45 ile npcshops.json'a 5 DEPO NPC'si
     (bank: true, shop/repair YOK) eklendi; onlari da DUKKANLAR'a yazsaydik
     dukkani olmayan bir NPC once MENZIL kapisina takilir ve istemciye
     ERR_NOT_FOUND yerine ERR_RANGE donerdi. Asagidaki world.json yedek
     dongusu de ayni sarti kullaniyor - tek kural. */
  for (const [npcId, kayit] of Object.entries(npcshops?.shops ?? {})) {
    if (kayit?.shop || kayit?.repair) dukkanEkle(npcId, kayit);
  }
  const npcshopsSayisi = DUKKANLAR.size;

  // world.json npcCatalog - npcshops.json'da olmayan dukkanlar icin yedek
  for (const [npcId, kayit] of Object.entries(world?.worldData?.npcCatalog ?? {})) {
    if (kayit?.shop || kayit?.repair) dukkanEkle(npcId, kayit);
  }

  // --------------------------------------------------------- NPC konumlari
  /** zoneId -> Map(npcId -> {x, z}) - menzil kontrolu icin. */
  const KONUMLAR = new Map();
  const konumEkle = (zoneId, npcId, x, z) => {
    if (!zoneId || !npcId || !Number.isFinite(x) || !Number.isFinite(z)) return;
    if (!KONUMLAR.has(zoneId)) KONUMLAR.set(zoneId, new Map());
    const m = KONUMLAR.get(zoneId);
    if (!m.has(npcId)) m.set(npcId, { x, z });
  };
  // birincil kaynak: sunucunun GERCEKTEN dogurdugu NPC'ler (server.js zoneNpcEntities
  // de ayni listeyi kullaniyor)
  for (const [zoneId, z] of Object.entries(world?.worldData?.zones ?? {})) {
    for (const n of z?.npcs ?? []) konumEkle(zoneId, n?.npcId, n?.x, n?.z);
  }
  // yedek: npcshops.json shops[].placements (ayni istemci verisinden turetilmis)
  for (const [npcId, kayit] of Object.entries(npcshops?.shops ?? {})) {
    for (const p of kayit?.placements ?? []) konumEkle(p?.zone, npcId, p?.x, p?.z);
  }

  log(`dukkan: ${DUKKANLAR.size} NPC (npcshops.json ${npcshopsSayisi}), `
    + `${KATALOG.size} esya (items.json ${itemsJsonSayisi}), `
    + `${[...KONUMLAR.values()].reduce((a, m) => a + m.size, 0)} yerlesim`);
  /* envanterPayload olmadan islem YAPILIR ama istemciye inv.update gitmez;
     oyuncunun cantasi/altini ekranda eski kalir (sessiz desenkron). Sunucu
     her zaman geciriyor - eksikse kurulum hatasidir, gorulsun. */
  if (typeof envanterPayload !== 'function') {
    log('dukkan: UYARI - ctx.envanterPayload yok, inv.update gonderilemeyecek');
  }

  // ------------------------------------------------------------ canta islemleri

  /** ch.bag'i her zaman dogru uzunlukta bir dizi haline getirir ve dondurur. */
  function canta(ch) {
    const n = Array.isArray(ch.bag) && ch.bag.length > 0 ? ch.bag.length : CANTA_YUVASI;
    if (!Array.isArray(ch.bag) || ch.bag.length !== n) {
      const eski = Array.isArray(ch.bag) ? ch.bag : [];
      ch.bag = new Array(n).fill(null);
      for (let i = 0; i < Math.min(eski.length, n); i++) ch.bag[i] = eski[i] ?? null;
    }
    return ch.bag;
  }

  const yiginSiniri = (def) => Math.max(1, Number(def?.stackMax ?? 1));

  /**
   * Yeni esya kaydi (istemcinin S$ semasi).
   * Ekipmanin dayanikliligi rollRanges.durability aralik ALT SINIRIDIR
   * (variance 0) - canli yakalamada sword01 62/62, aralik [62,76].
   *
   * MADDE 26: govde esya.js'e TASINDI. Ayni kural bes yerde ayri ayri
   * yazilmisti ve ucu (charcreate / gameloop ganimeti / kalicilik) alanlari
   * hic uretmiyordu. Artik tek sahibi esya.yeniYigin(); burada yalniz cagri
   * kaliyor ki dukkan/ganimet/baslangic esyasi BIREBIR ayni bicimde olsun.
   * NOT: dayaniklilik artik "aralik[0]" diye elle degil, combat.js'in
   * paylasilan statRulo()'suyla variance'in 0. grubundan hesaplaniyor -
   * variance 0'da sonuc AYNI (62/46/39, canli yakalamayla dogrulandi).
   */
  const yeniEsya = (def, adet) => yeniYigin(def, adet);

  /**
   * Cantaya `adet` esya sigar mi? Sigiyorsa uygulama plani, sigmiyorsa null.
   * ONCE plan cikarilir, sonra uygulanir - yarim yerlestirme olmaz.
   */
  function yerlestirmePlani(bag, def, adet) {
    const yigin = yiginSiniri(def);
    const plan = [];
    let kalan = adet;
    if (yigin > 1) {
      for (let i = 0; i < bag.length && kalan > 0; i++) {
        const s = bag[i];
        if (!s || s.itemId !== def.id) continue;
        const yer = yigin - (s.qty ?? 1);
        if (yer <= 0) continue;
        const k = Math.min(yer, kalan);
        plan.push({ i, ekle: k });
        kalan -= k;
      }
    }
    for (let i = 0; i < bag.length && kalan > 0; i++) {
      if (bag[i]) continue;
      const k = Math.min(yigin, kalan);
      plan.push({ i, yeni: k });
      kalan -= k;
    }
    return kalan > 0 ? null : plan;
  }

  function planiUygula(bag, def, plan) {
    for (const p of plan) {
      if (p.ekle) bag[p.i].qty = (bag[p.i].qty ?? 1) + p.ekle;
      else bag[p.i] = yeniEsya(def, p.yeni);
    }
  }

  // ------------------------------------------------------------ tamir hesabi

  /** Cantadaki + giyili tum esyalar (null olmayan) - istemcideki hLt() gibi. */
  function tumEsyalar(ch) {
    const out = [];
    for (const s of canta(ch)) if (s && typeof s === 'object') out.push(s);
    for (const v of Object.values(ch.equip ?? {})) {
      if (v && typeof v === 'object') out.push(v);
    }
    return out;
  }

  /** Istemcideki hLt() filtresi: dur ve maxDur tanimli olanlar. */
  const dayaniklilikVar = (it) =>
    it && it.dur !== undefined && it.dur !== null
      && it.maxDur !== undefined && it.maxDur !== null;

  /** Istemcideki gLt(): toplam eksik dayaniklilik puani. */
  function eksikDayaniklilik(ch) {
    let toplam = 0;
    for (const it of tumEsyalar(ch)) {
      if (!dayaniklilikVar(it)) continue;
      toplam += Math.max(0, Number(it.maxDur) - Number(it.dur));
    }
    return toplam;
  }

  /** Istemcideki _Lt() ucret dongusunun kabul ettigi esyalar. */
  function ucretliMi(it) {
    if (!dayaniklilikVar(it)) return false;
    const def = esyaTanim(it.itemId);
    if (!def || !EKIPMAN_TURLERI.has(def.type) || def.type === 'accessory') return false;
    return true;
  }

  /** Istemcideki _Lt(): NPC tamir ucreti (altin). */
  function tamirUcreti(ch) {
    let ucret = 0;
    for (const it of tumEsyalar(ch)) {
      if (!ucretliMi(it)) continue;
      const def = esyaTanim(it.itemId);
      const maxDur = Number(it.maxDur);
      const dur = Number(it.dur);
      const birim = Math.max(1, Number(def.costRepair ?? 0) / maxDur);
      ucret += dur <= 0
        ? Number(def.costRevive ?? 0) + Math.round((maxDur - 1) * birim)
        : Math.round((maxDur - dur) * birim);
    }
    return ucret;
  }

  /** Secilen esyalarin dayanikliligini tam doldurur; yenilenen puani doner. */
  function dayanikliligiDoldur(ch, secici) {
    let puan = 0;
    for (const it of tumEsyalar(ch)) {
      if (!secici(it)) continue;
      const eksik = Math.max(0, Number(it.maxDur) - Number(it.dur));
      if (eksik <= 0) continue;
      it.dur = Number(it.maxDur);
      puan += eksik;
    }
    return puan;
  }

  // ------------------------------------------------------------ kalicilik

  /* vSRO _Char.RemainGold - altin zaten GIRISTE buradan okunuyor
     (routes_auth.js listCharacters: gold: Number(c.RemainGold)), yani
     yazinca dongu kapaniyor. Canta esyalari bu yapida DB'den hic
     okunmadigi icin (_Inventory yalnizca kusam yuvalari 0..12 icin
     okunuyor) _Items'a yazmak yalnizca yazilip hic okunmayan kayit
     uretirdi; bu yuzden burada SADECE altin kaliciladi. */
  const SHARD_AD = typeof SHARD === 'string' && /^[A-Za-z0-9_]+$/.test(SHARD) ? SHARD : null;

  /**
   * MADDE 60b (capraz istek 64, fark #137): altin yazimi DEBOUNCE edilir -
   * pes pese alimlarda her islem ayri UPDATE atmasin. 2000 ms fark #137
   * taslagindaki ONERIDIR (oyun sabiti degil, OLCULMEDI). Bekleyenler modul
   * cikisinda hemen indirilir ki close->konumuKaydet ile yarismasin.
   */
  const ALTIN_BEKLEYEN = new Map();  // charId -> zamanlayici
  function altiniKaydet(ch) {
    const charId = Number(ch?.id);
    if (!Number.isFinite(charId)) return;
    if (ALTIN_BEKLEYEN.has(charId)) return;              // zaten planli
    ALTIN_BEKLEYEN.set(charId, setTimeout(() => {
      ALTIN_BEKLEYEN.delete(charId);
      altiniHemenYaz(ch);
    }, 2000));
  }
  /** Bu karakter icin bekleyen yazimi HEMEN indir (cikis yolu). */
  function altinBosalt(ch) {
    const charId = Number(ch?.id);
    if (!Number.isFinite(charId)) return;
    const z = ALTIN_BEKLEYEN.get(charId);
    if (z) { clearTimeout(z); ALTIN_BEKLEYEN.delete(charId); altiniHemenYaz(ch); }
  }

  function altiniHemenYaz(ch) {
    if (!web || !SHARD_AD || ch?.id === undefined || ch?.id === null) return;
    const charId = Number(ch.id);
    if (!Number.isFinite(charId)) return;
    try {
      const istek = web.request();
      istek.input('c', charId);
      istek.input('g', Math.max(0, Math.round(Number(ch.gold ?? 0))));
      const p = istek.query(
        `UPDATE ${SHARD_AD}.dbo._Char SET RemainGold = @g WHERE CharID = @c`);
      if (p && typeof p.catch === 'function') {
        p.catch((e) => log('dukkan: altin kaydedilemedi:', String(e?.message ?? e).slice(0, 120)));
      }
    } catch (e) {
      log('dukkan: altin kaydedilemedi:', String(e?.message ?? e).slice(0, 120));
    }
  }

  // ------------------------------------------------------------ cerceve gonderimi

  /* err (240) semasi (paket ~satir 624842):
   *   X({ code: qJ(Sht), key: qJ(Eht).optional(), msg?, q?, params? })
   * Istemcinin isleyicisi (paket ~satir 654861) once `key`e bakar, yoksa
   * `err.<code>` anahtarini dener - VE ANAHTAR YOKSA HIC SATIR BASMAZ:
   *     let v_r = `err.${code}`; b2(v_r) && pushSys(v_r, params);
   * tr.json'da err.ERR_VALIDATION / ERR_RANGE / ERR_NO_GOLD / ERR_BAG_FULL /
   * ERR_NOT_FOUND VAR, ama `err.ERR_DEAD` YOK (sistem_tezgah.js ve
   * sistem_ticaret.js de ayni bosluga takilmis). Kodu dogru birakip
   * (ERR_DEAD, Sht enumunda) yanina Eht enumunda VE tr.json'da gercekten
   * bulunan `err.busy.downed` ("Yere serildin.") anahtarini koyuyoruz;
   * boylece oyuncu sessiz bir basarisizlik yerine sebebi goruyor. */
  const hata = (ws, code, key, params) => {
    const d = { code };
    if (key) d.key = key;
    /* err semasi params'i opsiyonel tasir (@25631967) - yalniz gold_cap gibi
       {cap} yer tutuculu anahtarlar verir. */
    if (params && typeof params === 'object' && Object.keys(params).length) d.params = params;
    frame(ws, 'err', d);
    return true;
  };
  const oluHatasi = (ws) => hata(ws, HATA.OLU, 'err.busy.downed');
  const bildir = (ws, key, params) => frame(ws, 'sys.notice', params ? { key, params } : { key });

  /**
   * MADDE 60 (capraz istek 64, fark #138): tezgah/takas acikken dukkan islemi
   * YOK. tr.json err.busy.stall_open "Tezgahin acikken olmaz." /
   * err.busy.trade_open "Takas acikken olmaz."; istemci kapisi paket @25677424
   * lgt ownStallOpen->ignore. sistem_ticaret.js:717/730 AYNI kapilari kendi
   * girislerinde kuruyor - ornek onlar; takastaMi kancasi tam bu amac icin
   * disa acilmis (sistem_ticaret.js:947). true donerse islem reddedildi.
   */
  function mesgulKapisi(ws) {
    if (ws.tezgahAcik) return hata(ws, 'ERR_BUSY', 'err.busy.stall_open');
    if (sistemOrnegi?.('ticaret')?.takastaMi?.(ws)) return hata(ws, 'ERR_BUSY', 'err.busy.trade_open');
    return false;
  }

  function envanteriYolla(ws) {
    if (envanterPayload) frame(ws, 'inv.update', envanterPayload(ws.char));
  }

  // ------------------------------------------------------------ ortak kapilar

  /** Oyuncu bu mesaji isleyebilecek durumda mi? */
  function oyuncuHazir(ws) {
    if (!ws?.isAuthed || !ws.char) return false;
    return true;
  }

  /**
   * NPC'yi bulur ve menzili dogrular.
   * @returns {{dukkan:object}|{kod:string}}
   */
  function npcKapisi(ws, npcId) {
    if (typeof npcId !== 'string' || !npcId) return { kod: HATA.DOGRULAMA };
    const dukkan = DUKKANLAR.get(npcId);
    if (!dukkan) return { kod: HATA.BULUNAMADI };
    const konum = KONUMLAR.get(ws.zoneId)?.get(npcId);
    // NPC bu bolgede degil -> oyuncu ona ulasamaz
    if (!konum) return { kod: HATA.BULUNAMADI };
    const dx = Number(ws.char.x) - konum.x;
    const dz = Number(ws.char.z) - konum.z;
    if (!Number.isFinite(dx) || !Number.isFinite(dz)) return { kod: HATA.MENZIL };
    if (dx * dx + dz * dz > dukkan.menzil * dukkan.menzil) return { kod: HATA.MENZIL };
    return { dukkan };
  }

  // ============================================================ mesaj islemleri

  /** c2s 51 shop.buy {npcId, itemId, qty} */
  function satinAl(ws, d) {
    const ch = ws.char;
    if (ch.dead) return oluHatasi(ws);
    if (mesgulKapisi(ws)) return true;   // madde 60: tezgah/takas kilidi

    const qty = Number(d?.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > 1000) return hata(ws, HATA.DOGRULAMA);
    if (typeof d?.itemId !== 'string' || !d.itemId) return hata(ws, HATA.DOGRULAMA);

    const kapi = npcKapisi(ws, d?.npcId);
    if (kapi.kod) return hata(ws, kapi.kod);
    const dukkan = kapi.dukkan;
    if (!dukkan.dukkanVar) return hata(ws, HATA.BULUNAMADI);

    // esya bu NPC'nin stogunda mi?
    if (!dukkan.stok.has(d.itemId)) return hata(ws, HATA.BULUNAMADI);

    const def = esyaTanim(d.itemId);
    // buyPrice null olan esyalar (item-mall) dukkanda satilmaz - istemci de
    // listesini `buyPrice !== null` ile suzuyor.
    if (!def || def.buyPrice === null || def.buyPrice === undefined) {
      return hata(ws, HATA.BULUNAMADI);
    }

    /* Istemci tek seferde en fazla stackMax alir:
       vIt() = Math.min(stackMax, floor(gold/buyPrice), bostaYer) */
    const yigin = yiginSiniri(def);
    if (qty > yigin) return hata(ws, HATA.DOGRULAMA);

    const ucret = Number(def.buyPrice) * qty;
    if ((ch.gold ?? 0) < ucret) return hata(ws, HATA.ALTIN);

    const bag = canta(ch);
    const plan = yerlestirmePlani(bag, def, qty);
    if (!plan) return hata(ws, HATA.CANTA);

    planiUygula(bag, def, plan);
    ch.gold = (ch.gold ?? 0) - ucret;

    envanteriYolla(ws);
    bildir(ws, 'sys.economy.bought', { qty, item: def.name ?? def.id, gold: ucret });
    altiniKaydet(ch);
    return true;
  }

  /** c2s 52 shop.sell {npcId, bagSlot, qty} */
  function sat(ws, d) {
    const ch = ws.char;
    if (ch.dead) return oluHatasi(ws);
    if (mesgulKapisi(ws)) return true;   // madde 60: tezgah/takas kilidi

    const qty = Number(d?.qty);
    const yuva = Number(d?.bagSlot);
    if (!Number.isInteger(qty) || qty < 1 || qty > 1000) return hata(ws, HATA.DOGRULAMA);
    if (!Number.isInteger(yuva) || yuva < 0) return hata(ws, HATA.DOGRULAMA);

    const kapi = npcKapisi(ws, d?.npcId);
    if (kapi.kod) return hata(ws, kapi.kod);
    // istemci de satis hedefini `npcsById.get(npcId)?.shop` ile suzuyor
    if (!kapi.dukkan.dukkanVar) return hata(ws, HATA.BULUNAMADI);

    const bag = canta(ch);
    if (yuva >= bag.length) return hata(ws, HATA.DOGRULAMA);
    const kayit = bag[yuva];
    if (!kayit) return hata(ws, HATA.BULUNAMADI);
    if ((kayit.qty ?? 1) < qty) return hata(ws, HATA.DOGRULAMA);

    const def = esyaTanim(kayit.itemId);
    if (!def) return hata(ws, HATA.BULUNAMADI);

    // istemci onizlemesi de duz sellPrice * qty gosteriyor (plus etkisi YOK)
    const kazanc = Math.max(0, Number(def.sellPrice ?? 0)) * qty;

    /* PP MADDE 3 (changelog 0025): satis geliri altin tavanini ASACAKSA
       islem YAPILMADAN acik mesajla reddedilir - esya cantada kalir,
       altin degismez. Kismi satisla tavana "sigdirma" YOK: changelog
       "satis ... reddediliyor" diyor, kirpma tarif etmiyor. */
    /* DB bigint alanlari (tedious) METIN dondurebilir: ham `+` metin
       birlestirir ("1000000017"+500 -> 1 trilyon sanilir, tavan yanlis
       tetiklenir). Toplamadan once sayiya cevrilir. */
    const eldekiAltin = Number(ch.gold ?? 0);
    if (eldekiAltin + kazanc > ALTIN_TAVANI) {
      return hata(ws, HATA.DOGRULAMA, 'err.gold_cap', { cap: ALTIN_TAVANI });
    }

    const kalan = (kayit.qty ?? 1) - qty;
    if (kalan > 0) kayit.qty = kalan; else bag[yuva] = null;
    ch.gold = eldekiAltin + kazanc;

    envanteriYolla(ws);
    bildir(ws, 'sys.economy.sold', { qty, item: def.name ?? def.id, gold: kazanc });
    altiniKaydet(ch);
    return true;
  }

  /** c2s 54 item.repair {npcId} - NPC'de ucretli toplu tamir */
  function tamirEt(ws, d) {
    const ch = ws.char;
    if (ch.dead) return oluHatasi(ws);
    if (mesgulKapisi(ws)) return true;   // madde 60: tezgah/takas kilidi

    const kapi = npcKapisi(ws, d?.npcId);
    if (kapi.kod) return hata(ws, kapi.kod);
    if (!kapi.dukkan.tamir) return hata(ws, HATA.BULUNAMADI);

    const ucret = tamirUcreti(ch);
    if (ucret <= 0) {
      bildir(ws, 'sys.economy.nothing_to_repair');
      return true;
    }
    if ((ch.gold ?? 0) < ucret) return hata(ws, HATA.ALTIN);

    dayanikliligiDoldur(ch, ucretliMi);
    ch.gold = (ch.gold ?? 0) - ucret;

    envanteriYolla(ws);
    bildir(ws, 'sys.economy.repaired', { gold: ucret });
    altiniKaydet(ch);
    return true;
  }

  /** c2s 42 item.repairHammer {bagSlot} - ucretsiz toplu tamir, cekici harcar */
  function tamirCekici(ws, d) {
    const ch = ws.char;
    if (ch.dead) return oluHatasi(ws);

    const yuva = Number(d?.bagSlot);
    if (!Number.isInteger(yuva) || yuva < 0) return hata(ws, HATA.DOGRULAMA);

    const bag = canta(ch);
    if (yuva >= bag.length) return hata(ws, HATA.DOGRULAMA);
    const kayit = bag[yuva];
    if (!kayit) return hata(ws, HATA.BULUNAMADI);

    // istemci de yuvadaki esyanin type === `repairHammer` olmasini ariyor
    const def = esyaTanim(kayit.itemId);
    if (!def || def.type !== 'repairHammer') return hata(ws, HATA.BULUNAMADI);

    // istemcinin onizledigi puan: gLt() - dur/maxDur'u olan HER esya
    const puan = eksikDayaniklilik(ch);
    if (puan <= 0) {
      bildir(ws, 'sys.economy.nothing_to_repair');
      return true;    // cekici harcanmaz
    }

    const yenilenen = dayanikliligiDoldur(ch, dayaniklilikVar);
    const kalan = (kayit.qty ?? 1) - 1;
    if (kalan > 0) kayit.qty = kalan; else bag[yuva] = null;

    envanteriYolla(ws);
    bildir(ws, 'sys.economy.repaired_free', { points: yenilenen });
    return true;
  }

  // ============================================================ yonlendirici

  return {
    /** Ilgilenmedigi mesajda false doner - yonlendirici digerlerini dener. */
    mesaj(ws, t, d) {
      if (!MESAJLAR.has(t)) return false;
      if (!oyuncuHazir(ws)) return false;
      try {
        switch (t) {
          case 'shop.buy':          return satinAl(ws, d);
          case 'shop.sell':         return sat(ws, d);
          case 'item.repair':       return tamirEt(ws, d);
          case 'item.repairHammer': return tamirCekici(ws, d);
          default:                  return false;
        }
      } catch (e) {
        log('dukkan hatasi:', t, String(e?.message ?? e).slice(0, 160));
        return hata(ws, HATA.DOGRULAMA);
      }
    },

    /* MADDE 60b: soket kapaninca bekleyen altin yazimi HEMEN indirilir
       (server.js ws.on('close') tum ornekler icin cikis(ws) cagiriyor). */
    cikis(ws) { if (ws?.char) altinBosalt(ws.char); },

    // --- test / tani icin disa acilanlar (sunucu akisinda kullanilmaz) ---
    _tamirUcreti: tamirUcreti,
    _eksikDayaniklilik: eksikDayaniklilik,
    _dukkan: (npcId) => DUKKANLAR.get(npcId) ?? null,
    _esya: esyaTanim,
  };
}

/* ===========================================================================
 * BAGLAMA NOTU  (server.js icin)
 * ---------------------------------------------------------------------------
 * import { kur as kurDukkan } from './sistem_dukkan.js';
 * const DUKKAN = kurDukkan({
 *   world: WORLDSIM,          // .dataDir ve .worldData (npcCatalog + zones[].npcs) icin
 *   frame, log,
 *   GCFG,                     // bagSlots, npcInteractRangeU
 *   ITEMSTATS: COMBAT.itemStats,
 *   envanterPayload,
 *   web: <SRO_WEB_GAME havuzu | null>,
 *   SHARD: CFG.sql.databases.shard,
 * });
 * ...ws.on('message') icindeki yonlendiricide:
 *   if (DUKKAN.mesaj(ws, t, d)) return;
 *
 * ctx'ten KULLANILANLAR : world (dataDir + worldData), frame, log, GCFG,
 *                         ITEMSTATS, envanterPayload, web, SHARD
 * ctx'ten KULLANILMAYAN : combat, broadcast, zoneGroundY, yurunebilirNokta, derived
 *
 * ISLENEN c2s MESAJLARI : shop.buy (51), shop.sell (52),
 *                         item.repair (54), item.repairHammer (42)
 *
 * GONDERILEN s2c KARELERI:
 *   inv.update (149)  { gold, bag, equip }      - her basarili islemden sonra
 *   sys.notice (195)  { key, params }           - sys.economy.bought / .sold /
 *                                                 .repaired / .repaired_free /
 *                                                 .nothing_to_repair
 *   err        (240)  { code }                  - ERR_VALIDATION / ERR_RANGE /
 *                                                 ERR_NO_GOLD / ERR_BAG_FULL /
 *                                                 ERR_NOT_FOUND
 *                     { code, key }             - ERR_DEAD + `err.busy.downed`
 *                                                 (err.ERR_DEAD tr.json'da YOK)
 *
 * KALICILIK: yalnizca altin -> `UPDATE <SHARD>.dbo._Char SET RemainGold=@g
 *            WHERE CharID=@c` (giriste routes_auth.js zaten RemainGold okuyor).
 *            Canta esyalari bu yapida DB'den okunmadigi icin _Items'a
 *            YAZILMAZ; yazilsa yalnizca olu kayit olurdu.
 * =========================================================================== */
