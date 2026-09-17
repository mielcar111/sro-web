/**
 * sistem_gelistirme.js — esya gelistirme (simya) ve buyu taslari
 *
 * Islenen c2s mesajlari (opcode'lar okunabilir istemci paketinden birebir):
 *    53  item.enhance     hiz sinifi: inv
 *    94  item.reset       hiz sinifi: inv    (HJ = discriminated union, ayirt edici `op`)
 *    25  item.spscroll    hiz sinifi: inv    (HJ, ayirt edici `op`)
 *    38  stone.craft      hiz sinifi: inv
 *    39  stone.apply      hiz sinifi: inv
 *
 * Uretilen s2c mesajlari:
 *   186 item.enhanced    212 stone.applied    211 stone.crafted
 *   146 stats.update     147 mastery.update   148 skills.update   149 inv.update
 *   195 sys.notice       240 err
 *
 * ==================================================================== SEMA KAYNAGI
 * Hepsi okunabilir istemci paketinden ALINDI, hicbiri uydurulmadi:
 *   playjs_source\index-BUMMQVRB.js
 *
 * Zod takma adlari (paketten): X=z.object  Y=z.number  J=z.string  JJ=z.literal
 *                              BJ=z.array  RJ=z.boolean qJ=z.enum   VJ=z.union
 *                              GJ=z.record HJ=z.discriminatedUnion
 *
 * --- ortak yardimci semalar -------------------------------------- ofset 25608939
 *   E$ = X({ c: qJ([`bag`,`equip`]), i: Y().int().min(0).max(159) })
 *   D$ = Y().int().min(1).max(1000)
 *
 * --- c2s ---------------------------------------------------------------------
 *   ofset 25609637
 *     T$(`item.enhance`, 53, X({ elixir: E$, target: E$, powder: E$.optional() }), `inv`)
 *
 *   ofset 25613840
 *     T$(`item.reset`, 94, HJ(`op`, [
 *          X({ op: JJ(`stats`),   bagSlot: Y().int().min(0).max(159) }),
 *          X({ op: JJ(`mastery`), bagSlot: Y().int().min(0).max(159), masteryId: J() })
 *        ]), `inv`)
 *
 *   ofset 25614105
 *     T$(`item.spscroll`, 25, HJ(`op`, [
 *          X({ op: JJ(`create`), bagSlot: Y().int().min(0).max(159),
 *              tier: Y().int().min(0).max(2) }),
 *          X({ op: JJ(`use`),    bagSlot: Y().int().min(0).max(159) })
 *        ]), `inv`)
 *
 *   ofset 25632684
 *     T$(`stone.craft`, 38, X({ stoneId: J() }), `inv`)
 *     T$(`stone.apply`, 39, X({ target: E$, stone: E$ }), `inv`)
 *
 * --- s2c ---------------------------------------------------------------------
 *   ofset 25630417
 *     T$(`item.enhanced`, 186, X({ target: E$, success: RJ(), plus: Y().int().min(0) }))
 *
 *   ofset 25632801
 *     T$(`stone.crafted`, 211, X({ itemId: J(), asm: Y().int().nullable(),
 *                                  xp: Y().int().nonnegative() }))
 *     T$(`stone.applied`, 212, X({
 *          target: E$, success: RJ(), effect: J(), value: Y().optional(),
 *          mode: qJ([`append`,`replace`,`counter`]).optional(),
 *          assimilation: X({ kind: qJ([`prevented`,`white`,`blue`,`blue_noop`]),
 *                            whiteSlot: Y().int().optional() }).optional() }))
 *
 *   ofset 25630xxx  stats.update 146 / mastery.update 147 / skills.update 148
 *     stats.update   X({ base: X({str,int,unspent}), derived: rht, hp, mp })
 *     mastery.update X({ masteryId: J(), level: Y().int(), sp: Y().int() })
 *     skills.update  X({ known: BJ(J()), sp: Y().int() })
 *
 * --- envanter yigini (S$) ----------------------------------------- ofset 25593826
 *   S$ = X({ itemId:J(), qty:Y().int().min(1), plus:Y().int().min(0).optional(),
 *            dur:.optional(), maxDur:.optional(), variance:Y().int().nonneg().optional(),
 *            blues: BJ(X({ id:Y().int().positive(), value:Y() })).optional(),
 *            rolls: GJ(J(), Y()).optional() })
 *   DIKKAT: `blues[].id` SAYIDIR - magic-opts.json katalog satirinin id'si.
 *           `effect` metni yigina YAZILMAZ, id uzerinden cozulur.
 *
 * --- ekipman yuvasi sirasi ---------------------------------------- ofset 8687640
 *   rY = [weapon, shield, head, shoulder, chest, gloves, pants, boots,
 *         avatarDress, avatarHat, avatarAttach, earring, necklace, ringL, ringR]
 *   Sunucudaki protocol.js EQUIP_SLOTS ile BIREBIR AYNI - {c:`equip`, i} bu diziye indeks.
 *
 * ================================================== ISTEMCIDEN CIKARILAN KURALLAR
 * Basari/basarisizlik SUNUCUDA belirlenir; asagidaki fonksiyonlar istemcinin
 * ONIZLEME kodundan cikarildi, boylece gosterilen oran ile gerceklesen oran ayni.
 *
 *  Dmt (ofset 25580180) - temel simya orani:
 *     Dmt(plus, cfg, tozVar) = min(1, successByPlus[plus] * (tozVar ? powderBonusMult : 1))
 *  Onizleme paneli (ofset 25256900) - Sans yuku ekler:
 *     oran = min(1, Dmt(...) + (luckYuku > 0 ? luckBonusPct/100 : 0))
 *     Sans yukunun buyuklugu orani DEGISTIRMEZ, sadece varligi +%5 ekler.
 *
 *  Pmt (ofset 25581273) - tas uygulanabilir mi:
 *     hedef ekipman degilse            -> err `target`
 *     tas derecesi != esya derecesi    -> err `degree`
 *     (effect,degree) katalog satiri yok -> err `unknown_opt`
 *     satirin groups'u esyaya uymuyor  -> err `target`
 *     kind=counter: ayni aile varsa value>=6 -> `counter_cap`, degilse mod=counter
 *                   ayni aile yoksa ve satir sayisi >= maxBlueLines -> `capacity`
 *     kind=stat:    ayni aile varsa mod=replace
 *                   yoksa ve satir sayisi >= maxBlueLines -> `capacity`, degilse append
 *
 *  Amt/jmt (ofset 25580500) - hedef grubu yuklemleri:
 *     weapon/shield/armor/accessory + helm(armor+head)/mail(armor+chest)/pants(armor+pants)
 *
 *  eot (ofset 8688748) - deger merdiveni; params[1..3]'un her biri IKI adet uint16:
 *     ust = floor(n/65536)%65536, alt = n%65536; sifir olmayanlar sirayla eklenir.
 *
 *  Bmt (ofset 25586263) - stat sifirlama:
 *     baseStr = startingStats.str + (level-1);  baseInt ayni
 *     iade    = (str - baseStr) + (int - baseInt)
 *
 *  Vmt (ofset 25586586) - ustalik sifirlama iadesi:
 *     sum(spCostToLevel[1..level]) + sum(o ustaliga ait ogrenilmis becerilerin spCost)
 *
 *  Omt (ofset 623018) - SAYAC tipli mavi satir etkileri (8 adet):
 *     luck, astr, ape, atha, soli, rep, dura, nrep. Bunlarda `value` bir
 *     nitelik degeri degil YUK sayisidir; ozumsemede yeniden zar ATILMAZ.
 *
 *  ght (ofset 623626) - `self.professions` satiri = X({ id, level, xp, xpToNext })
 *     Anahtar `id`; istemci Imt'ye beslerken ofset 666499'da kendisi
 *     `{professionId: p.id}` diye cevirir.
 *
 *  oht (ofset 623555) - `self.masteries` satiri = X({ masteryId, level:.min(1) })
 *     Level 0 satir birakilamaz - sifirlanan ustalik listeden CIKARILIR.
 *
 *  ymt/xmt (ofset 25577455) - beyaz nitelik (variance) bit duzeni:
 *     her nitelik grubu 5 bit; xmt(variance, yuva) = floor(variance / 2^(yuva*5)) % 32
 *     grup sayisi: weapon 7, armor 6, shield 6, accessory 2
 *
 *  MY (ofset 25041008) - SP parsomeni kademeleri:
 *     [{burnSp:100000,itemId:sp_scroll_01},{1000000,_02},{10000000,_03}]
 *     NY(burn) = floor(burn*20/100) -> verilen SP; extra-items.json sp alani ile dogrulandi.
 *
 * ==================================================== VERI KAYNAKLARI (uydurma yok)
 *   data/gelistirme/enhance.json       <- paket_veri/config/enhance.json
 *   data/gelistirme/magic-stones.json  <- paket_veri/config/magic-stones.json
 *   data/gelistirme/magic-opts.json    <- paket_veri/magic-opts.json (416 satir)
 *   data/gelistirme/extra-items.json   <- paket_veri/config/extra-items.json (25 esya)
 *   data/gelistirme/mastery-costs.json <- paket_veri/mastery-costs.json
 *   data/gelistirme/masteries.json     <- paket_veri/masteries.json (13 ustalik)
 *   ctx.ITEMSTATS                      <- data/itemstats.json (2860 esya)
 *
 *   Buyu tasi esya tanimlari data dosyasinda YOKTUR; istemci bunlari yuklerken
 *   uretir (ofset 25058009). Ayni uretim burada birebir yapilir:
 *     id `magicstone_<effect>_<degree>`, type `magicstone`, stackMax 50,
 *     effect/degree/kind/baseChancePct alanlari aile tanimindan.
 *   Boylece 15 aile x 8 derece = 120 tas + 25 ek esya katalog uzerine binilir.
 *   ctx.ITEMSTATS MUTASYONA UGRATILMAZ - kopya Map kullanilir (combat.js paylasiyor).
 *
 * ========================================================= AGIRLIKLI POLITIKA NOTU
 * Ozumsemenin (assimilation) HANGI seyi yeniden zar attigi hicbir veri dosyasinda
 * yazmiyor; paket yalnizca sonucun bicimini veriyor (`prevented`/`white`/`blue`/
 * `blue_noop`). Bu modul: koruma yuku varsa `prevented`, yoksa yazi-tura ile
 * `white` (bir variance yuvasi) veya `blue` (BASKA bir mavi satir) secer; yeniden
 * zar atilacak baska mavi satir yoksa `blue_noop` doner. Bu tek NON-PARITY karardir
 * ve burada acikca isaretlenmistir.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
/* MADDE 9 (capraz istek 12): nitelik gruplari ve okuma TEK cekirdekten
   (combat.js). Iki tanim birbirinden ayrilirsa gelistirme ile savas farkli
   stat gorur. nitelikYaz YALNIZ burada kullanildigi icin yerel kaldi. */
import { NITELIK_GRUPLARI, nitelikOku } from './combat.js';

const BURASI = path.dirname(fileURLToPath(import.meta.url));
const VERI = path.join(BURASI, 'data', 'gelistirme');
const VERI_KOK = path.join(BURASI, 'data');

/* Ekipman yuvasi sirasi - istemcideki rY ve protocol.js EQUIP_SLOTS ile AYNI. */
const EKIPMAN_YUVALARI = [
  'weapon', 'shield', 'head', 'shoulder', 'chest', 'gloves', 'pants', 'boots',
  'avatarDress', 'avatarHat', 'avatarAttach', 'earring', 'necklace', 'ringL', 'ringR',
];

/* SP parsomeni kademeleri - paket MY dizisi (ofset 25041008). */
const SP_KADEMELERI = [
  { burnSp: 100000, itemId: 'sp_scroll_01' },
  { burnSp: 1000000, itemId: 'sp_scroll_02' },
  { burnSp: 10000000, itemId: 'sp_scroll_03' },
];

/* ymt - nitelik gruplari; variance icindeki 5 bitlik yuvalarin sirasi.
   MADDE 9 (capraz istek 12): yerel kopya SILINDI - combat.js NITELIK_GRUPLARI
   ile BIREBIR ayni icerikti; ad korunarak paylasilan cekirdege baglandi. */
const NITELIK_YUVALARI = NITELIK_GRUPLARI;

/* Amt - katalog satirinin `groups` girdisi ile esya tanimini eslestiren yuklemler. */
const GRUP_YUKLEMLERI = {
  weapon: (d) => d.type === 'weapon',
  shield: (d) => d.type === 'shield',
  armor: (d) => d.type === 'armor',
  helm: (d) => d.type === 'armor' && d.slot === 'head',
  mail: (d) => d.type === 'armor' && d.slot === 'chest',
  pants: (d) => d.type === 'armor' && d.slot === 'pants',
  accessory: (d) => d.type === 'accessory',
};

/* Omt (ofset 623018) - istemcinin SAYAC (yuk) tipli mavi satir kumesi.
   Bu etkilerde `value` bir deger degil YUK SAYISIdir; istemci tooltip'te
   Fmt() yuzde hesabini bunlar icin ATLAR (ofset 658114). Buyu tasi ailesi
   yalnizca luck/astr/ape uretir ama ganimetten gelen ekipmanda atha/soli/
   rep/dura/nrep satirlari da bulunabilir - ozumsemede bunlarin yuku
   YENIDEN ZAR ATILMAMALI. */
const SAYAC_ETKILERI = new Set(['luck', 'astr', 'ape', 'atha', 'soli', 'rep', 'dura', 'nrep']);

/** vY (ofset 8702063) - bu esya gelistirilebilir/tas takilabilir bir ekipman mi. */
const ekipmanMi = (d) => !!d && (d.type === 'weapon' || d.type === 'shield'
  || d.type === 'armor' || d.type === 'accessory');

/* ------------------------------------------------------------------ dogrulayici
   Zod'un kucuk aynasi. X({...}) bilinmeyen anahtarlari ATAR; .optional() anahtar
   hic olmayabilir ama null OLAMAZ; HJ ayirt edici alana gore tek dal secer. */
class SemaHatasi extends Error {
  constructor(yol, sebep) { super(`${yol || '<kok>'}: ${sebep}`); this.yol = yol || '<kok>'; this.sebep = sebep; }
}
const hata = (yol, sebep) => { throw new SemaHatasi(yol, sebep); };

function nesneMi(v, yol) {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) hata(yol, 'nesne bekleniyor');
  return v;
}
function metin(v, yol) {
  if (typeof v !== 'string') hata(yol, 'metin bekleniyor');
  return v;
}
function tamSayi(v, yol, enAz, enCok) {
  if (typeof v !== 'number' || !Number.isInteger(v)) hata(yol, 'tam sayi bekleniyor');
  if (enAz !== undefined && v < enAz) hata(yol, `en az ${enAz}`);
  if (enCok !== undefined && v > enCok) hata(yol, `en cok ${enCok}`);
  return v;
}
/** E$ = X({ c: qJ([`bag`,`equip`]), i: Y().int().min(0).max(159) }) - paket
 *  dokumu; istemci semasi OLU (calismaz). Sunucu tavani SARTNAME-3 MADDE 11:
 *  383 (12 sayfa x 32 - 1). */
function semaRef(v, yol) {
  const o = nesneMi(v, yol);
  if (o.c !== 'bag' && o.c !== 'equip') hata(`${yol}.c`, 'bag|equip bekleniyor');
  return { c: o.c, i: tamSayi(o.i, `${yol}.i`, 0, 383) };
}
/** bagSlot: Y().int().min(0).max(159) - paket dokumu; sunucu tavani 383 (madde 11). */
const semaCantaYuvasi = (v, yol) => tamSayi(v, yol, 0, 383);

const SEMALAR = {
  'item.enhance'(d) {                                   // ofset 25609637
    const o = nesneMi(d, 'item.enhance');
    const cikti = {
      elixir: semaRef(o.elixir, 'elixir'),
      target: semaRef(o.target, 'target'),
    };
    if ('powder' in o && o.powder !== undefined) cikti.powder = semaRef(o.powder, 'powder');
    return cikti;
  },
  'item.reset'(d) {                                     // ofset 25613840 (HJ `op`)
    const o = nesneMi(d, 'item.reset');
    if (o.op === 'stats') return { op: 'stats', bagSlot: semaCantaYuvasi(o.bagSlot, 'bagSlot') };
    if (o.op === 'mastery') {
      return {
        op: 'mastery',
        bagSlot: semaCantaYuvasi(o.bagSlot, 'bagSlot'),
        masteryId: metin(o.masteryId, 'masteryId'),
      };
    }
    return hata('op', 'stats|mastery bekleniyor');
  },
  'item.spscroll'(d) {                                  // ofset 25614105 (HJ `op`)
    const o = nesneMi(d, 'item.spscroll');
    if (o.op === 'create') {
      return {
        op: 'create',
        bagSlot: semaCantaYuvasi(o.bagSlot, 'bagSlot'),
        tier: tamSayi(o.tier, 'tier', 0, 2),
      };
    }
    if (o.op === 'use') return { op: 'use', bagSlot: semaCantaYuvasi(o.bagSlot, 'bagSlot') };
    return hata('op', 'create|use bekleniyor');
  },
  'stone.craft'(d) {                                    // ofset 25632684
    const o = nesneMi(d, 'stone.craft');
    return { stoneId: metin(o.stoneId, 'stoneId') };
  },
  'stone.apply'(d) {                                    // ofset 25632737
    const o = nesneMi(d, 'stone.apply');
    return { target: semaRef(o.target, 'target'), stone: semaRef(o.stone, 'stone') };
  },
};

/* ------------------------------------------------------------------- veri yukleme */
function jsonOku(ad, kok = VERI) {
  const p = path.join(kok, ad);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

/**
 * eot (ofset 8688748) - bir katalog satirinin deger merdiveni.
 * params[1], params[2], params[3]'un her biri iki adet uint16 tasir.
 */
function degerMerdiveni(opt) {
  const cikti = [];
  const p = opt?.params ?? [];
  for (const n of [p[1] ?? 0, p[2] ?? 0, p[3] ?? 0]) {
    const ust = Math.floor(n / 65536) % 65536;
    const alt = n % 65536;
    if (ust) cikti.push(ust);
    if (alt) cikti.push(alt);
  }
  return cikti;
}

/* xmt - nitelikOku ARTIK combat.js'ten geliyor (madde 9 / capraz istek 12);
   yerel kopya silindi, formul birebir ayniydi. */

/** variance icindeki tek bir yuvayi yeni degerle degistirir (digerlerine dokunmaz). */
function nitelikYaz(variance, yuva, yeni) {
  const carpan = 2 ** (yuva * 5);
  const eski = nitelikOku(variance, yuva);
  return variance - eski * carpan + (yeni % 32) * carpan;
}

/* ------------------------------------------------------------------------- kur() */
export function kur(ctx) {
  const {
    frame, log = () => {}, GCFG = {}, ITEMSTATS = new Map(),
    envanterPayload = null, derived = null, combat = null,
    /* Baska modulun ORNEK'ine ada gore erisim (server.js sistemCtx). Ustalik
       sifirlamasindan sonra vSRO satirlarini esitlemek icin gerekiyor. */
    sistemOrnegi = null,
  } = ctx;

  /* ================================= USTALIK SIFIRLAMASI -> vSRO ESITLEMESI
   * SORUN: `item.reset` op='mastery' ch.masteries ve ch.knownSkills'ten
   * satirlari BELLEKTE siliyor ve SP'yi iade ediyor, ama kalicilik
   * sistem_stat-ustalik.js'te ve o modul _CharSkill / _CharSkillMastery
   * satirlarini yerinde birakiyordu. Bir sonraki giriste
   * sistem_stat-ustalik.yukle(ch) o satirlari GERI OKUYOR -> silinen
   * beceriler SP IADE EDILMIS halde geri geliyor: her sifirlamada BEDAVA SP.
   *
   * COZUM: sifirlamadan hemen sonra kardes modulun `esitle(ch)` API'sini
   * cagiriyoruz (sistem_stat-ustalik.js:540 - "SIFIRLAMA SONRASI ESITLEME",
   * bellekteki ch'ye gore fazla vSRO satirlarini siler, yabanci satirlara
   * dokunmaz). Modul yoksa ya da kalicilik kapaliysa sessizce gecer. */
  function ustaligiEsitle(ch) {
    try {
      const st = typeof sistemOrnegi === 'function' ? sistemOrnegi('stat-ustalik') : null;
      const p = st?.esitle?.(ch);
      if (p && typeof p.catch === 'function') {
        p.catch((e) => log('gelistirme: ustalik esitlemesi:', String(e?.message ?? e).slice(0, 120)));
      }
    } catch (e) {
      log('gelistirme: ustalik esitlemesi:', String(e?.message ?? e).slice(0, 120));
    }
  }

  /* Testte belirlenimli olabilmesi icin zar disaridan verilebilir. */
  const zar = typeof ctx.rastgele === 'function' ? ctx.rastgele : Math.random;
  const zarInt = (n) => Math.floor(zar() * n) % Math.max(1, n);
  const zarSec = (dizi) => dizi[zarInt(dizi.length)];

  /* --- veri ---------------------------------------------------------------- */
  const ENHANCE = jsonOku('enhance.json') ?? {};
  const TASLAR = jsonOku('magic-stones.json') ?? { families: [], craft: {} };
  const OPTS = (jsonOku('magic-opts.json') ?? { opts: [] }).opts ?? [];
  const EKESYA = jsonOku('extra-items.json') ?? [];
  /* Ustalik sifirlamasi icin: beceri->{mastery,spCost}, ustalik seviye maliyetleri
     ve ustalik adlari. Sunucunun KENDI data/skills.json'u zaten `skills`,
     `masteries` ve `masteryCosts` bloklarini tasiyor - once oradan okunur,
     bulunamazsa data/gelistirme altindaki paket kopyalarina dusulur.
     combat.js bir beceri katalogu tutmadigi icin bu okuma gerekli. */
  const BECERILER = jsonOku('skills.json', VERI_KOK) ?? {};
  const BECERI = new Map();
  if (ctx.skills instanceof Map) {
    for (const [id, s] of ctx.skills) BECERI.set(id, { mastery: s.mastery, spCost: s.spCost ?? 0 });
  } else {
    for (const s of BECERILER.skills ?? []) {
      if (s?.id) BECERI.set(s.id, { mastery: s.mastery, spCost: s.spCost ?? 0 });
    }
  }
  const USTALIK_MALIYET = BECERILER.masteryCosts?.spCostToLevel
    ?? (jsonOku('mastery-costs.json') ?? {}).spCostToLevel ?? {};
  const USTALIKLAR = BECERILER.masteries ?? jsonOku('masteries.json') ?? [];

  const MAX_PLUS = ENHANCE.maxPlus ?? 10;
  const BASARI = ENHANCE.successByPlus ?? {};
  const TOZ_CARPANI = ENHANCE.powderBonusMult ?? 1.5;
  const BASARISIZLIK = ENHANCE.failurePolicy ?? 'reset';
  const TOZ_DERECE_SART = ENHANCE.powderTierMustMatchDegree !== false;
  const MAX_MAVI = TASLAR.maxBlueLines ?? 9;
  const SANS_BONUS_PCT = TASLAR.enhanceCounters?.luckBonusPct ?? 5;
  const ASTRAL_TABAN = TASLAR.enhanceCounters?.astralFloorPlus ?? 4;
  const COUNTER_TAVAN = 6;                        // Pmt icindeki sabit (value >= 6)

  /* --- katalog: itemstats + ek esyalar + uretilmis buyu taslari -------------- */
  const KATALOG = new Map(ITEMSTATS);             // ITEMSTATS'e ASLA yazmiyoruz
  for (const it of Array.isArray(EKESYA) ? EKESYA : []) if (it?.id) KATALOG.set(it.id, it);
  let uretilenTas = 0;
  for (const aile of TASLAR.families ?? []) {
    for (let derece = 1; derece <= 8; derece++) {
      KATALOG.set(`magicstone_${aile.effect}_${derece}`, {
        id: `magicstone_${aile.effect}_${derece}`,
        name: `${aile.name} (D${derece})`,
        type: 'magicstone',
        icon: aile.icon,
        modelKey: 'drop_magic_stone',
        reqLevel: 1,
        buyPrice: null,
        sellPrice: aile.sellPrice,
        stackMax: 50,
        effect: aile.effect,
        degree: derece,
        kind: aile.kind,
        baseChancePct: aile.baseChancePct,
      });
      uretilenTas++;
    }
  }

  /* Katalog satirlari: (effect,level) -> opt ve id -> opt */
  const OPT_ID = new Map(OPTS.map((o) => [o.id, o]));
  const OPT_ARA = new Map(OPTS.map((o) => [`${o.effect}:${o.level}`, o]));

  /* materialByResourceTier - (resource,tier) -> malzeme esyasi */
  const MALZEME = new Map();
  for (const it of KATALOG.values()) {
    if (it?.type === 'material' && it.resource && it.tier) MALZEME.set(`${it.resource}:${it.tier}`, it);
  }

  const USTALIK_AD = new Map(
    (Array.isArray(USTALIKLAR) ? USTALIKLAR : []).map((m) => [m.id, m.name ?? m.id]),
  );

  log(`gelistirme: katalog ${KATALOG.size} esya (${uretilenTas} uretilmis tas), `
    + `${OPTS.length} mavi secenek satiri, ${MALZEME.size} malzeme, ${BECERI.size} beceri`);

  /* ------------------------------------------------------------ cerceve gonderme */
  const uyar = (ws, code, key, params) => {
    const d = { code };
    if (key) d.key = key;
    if (params) d.params = params;
    frame(ws, 'err', d);
  };
  const bildir = (ws, key, params) => frame(ws, 'sys.notice', params ? { key, params } : { key });
  const envanterYolla = (ws, ch) => { if (envanterPayload) frame(ws, 'inv.update', envanterPayload(ch)); };

  /* ------------------------------------------------------------ envanter islemleri */
  const canta = (ch) => {
    if (!Array.isArray(ch.bag)) ch.bag = new Array(GCFG.bagSlots ?? 32).fill(null);
    return ch.bag;
  };

  /** {c,i} referansini {yigin, yaz(yeniYigin)} olarak cozer. */
  function refCoz(ch, ref) {
    if (ref.c === 'bag') {
      const b = canta(ch);
      if (ref.i >= b.length) return null;
      return {
        yigin: b[ref.i] ?? null,
        yaz: (v) => { b[ref.i] = v; },
      };
    }
    const yuva = EKIPMAN_YUVALARI[ref.i];
    if (!yuva) return null;
    if (!ch.equip || typeof ch.equip !== 'object') ch.equip = {};
    const ham = ch.equip[yuva] ?? null;
    return {
      // Bazi kayitlar ekipmani duz metin id olarak tutuyor - S$ bicimine cevir.
      yigin: typeof ham === 'string' ? { itemId: ham, qty: 1 } : ham,
      yaz: (v) => { ch.equip[yuva] = v; },
    };
  }

  /** Bir yigindan `adet` duser; sifira inince yuvayi bosaltir. */
  function dus(kap, adet = 1) {
    const y = kap.yigin;
    if (!y) return false;
    const kalan = (y.qty ?? 1) - adet;
    if (kalan <= 0) kap.yaz(null); else { y.qty = kalan; kap.yaz(y); }
    return true;
  }

  /**
   * Cantaya esya ekler. Once ayni id + ayni `rolls.asm` olan yigina biner
   * (farkli ozumseme oranli taslar birbirine BINMEZ), sonra bos yuvaya duser.
   */
  function cantayaEkle(ch, itemId, adet, ekAlanlar = null) {
    const def = KATALOG.get(itemId);
    if (!def) return false;
    const b = canta(ch);
    const tavan = def.stackMax ?? 1;
    const asm = ekAlanlar?.rolls?.asm ?? null;
    if (tavan > 1) {
      for (let i = 0; i < b.length; i++) {
        const y = b[i];
        if (!y || y.itemId !== itemId) continue;
        if ((y.rolls?.asm ?? null) !== asm) continue;
        if ((y.qty ?? 1) + adet > tavan) continue;
        y.qty = (y.qty ?? 1) + adet;
        return true;
      }
    }
    for (let i = 0; i < b.length; i++) {
      if (b[i]) continue;
      b[i] = { itemId, qty: adet, ...(ekAlanlar ?? {}) };
      return true;
    }
    return false;
  }

  /** Cantadaki toplam adet (malzeme sayimi icin). */
  function cantadaAdet(ch, itemId) {
    let n = 0;
    for (const y of canta(ch)) if (y && y.itemId === itemId) n += y.qty ?? 1;
    return n;
  }

  /** Cantadan verilen adedi yiginlar arasindan tuketir. */
  function cantadanTuket(ch, itemId, adet) {
    const b = canta(ch);
    let kalan = adet;
    for (let i = 0; i < b.length && kalan > 0; i++) {
      const y = b[i];
      if (!y || y.itemId !== itemId) continue;
      const al = Math.min(kalan, y.qty ?? 1);
      kalan -= al;
      const yeni = (y.qty ?? 1) - al;
      if (yeni <= 0) b[i] = null; else y.qty = yeni;
    }
    return kalan === 0;
  }

  /* --------------------------------------------------------- mavi satir yardimci */
  const mavilar = (yigin) => (Array.isArray(yigin?.blues) ? yigin.blues : []);
  /** Mmt - ayni aileye ait mavi satirin indeksi (yoksa -1). */
  const maviIndeks = (blues, effect) => blues.findIndex((b) => OPT_ID.get(b.id)?.effect === effect);
  /** Nmt - ayni aileye ait sayacin degeri (yoksa 0). */
  const sayacDegeri = (blues, effect) => {
    const i = maviIndeks(blues, effect);
    return i >= 0 ? blues[i].value : 0;
  };
  /** Bir sayac yukunu bir azaltir; sifirlaninca satir tamamen silinir. */
  function sayacHarca(yigin, effect) {
    const b = mavilar(yigin);
    const i = maviIndeks(b, effect);
    if (i < 0 || b[i].value <= 0) return false;
    b[i].value -= 1;
    if (b[i].value <= 0) b.splice(i, 1);
    yigin.blues = b;
    return true;
  }

  /** jmt - katalog satirinin hedef gruplari esyaya uyuyor mu. */
  const grupUyar = (opt, def) => (opt.groups ?? []).some((g) => GRUP_YUKLEMLERI[g.group]?.(def) ?? false);

  /** Pmt - tas uygulanabilir mi (istemci onizlemesiyle birebir). */
  function tasKapisi(tasDef, hedefDef, blues) {
    if (!ekipmanMi(hedefDef)) return { ok: false, err: 'target' };
    if (hedefDef.degree !== tasDef.degree) return { ok: false, err: 'degree' };
    const opt = OPT_ARA.get(`${tasDef.effect}:${tasDef.degree}`);
    if (!opt) return { ok: false, err: 'unknown_opt' };
    if (!grupUyar(opt, hedefDef)) return { ok: false, err: 'target' };
    const i = maviIndeks(blues, tasDef.effect);
    if (tasDef.kind === 'counter') {
      if (i >= 0) {
        return blues[i].value >= COUNTER_TAVAN
          ? { ok: false, err: 'counter_cap' }
          : { ok: true, opt, mode: 'counter' };
      }
      return blues.length >= MAX_MAVI
        ? { ok: false, err: 'capacity' }
        : { ok: true, opt, mode: 'counter' };
    }
    if (i >= 0) return { ok: true, opt, mode: 'replace' };
    return blues.length >= MAX_MAVI
      ? { ok: false, err: 'capacity' }
      : { ok: true, opt, mode: 'append' };
  }

  /** Dmt + Sans yuku - istemcinin gosterdigi orani birebir uretir. */
  function simyaOrani(plus, tozVar, sansYuku) {
    const taban = BASARI[String(plus)] ?? 0;
    const tozlu = Math.min(1, tozVar ? taban * TOZ_CARPANI : taban);
    const sans = sansYuku > 0 ? SANS_BONUS_PCT / 100 : 0;
    return Math.min(1, tozlu + sans);
  }

  const esyaAdi = (def, itemId) => def?.name ?? itemId ?? '?';

  /* Tas ureticisi tarif ve seviye kapisi - client stoneRecipeFor (ofset 25070750). */
  function tasTarifi(tasDef) {
    const c = TASLAR.craft ?? {};
    const anahtar = String(tasDef.degree);
    const tier = c.tierByDegree?.[anahtar];
    const girdiTanim = tasDef.kind === 'counter' ? c.inputs?.counter : c.inputs?.stat;
    const girdiler = [
      { resource: 'wood', tier, qty: girdiTanim?.wood ?? 0 },
      { resource: 'stone', tier, qty: girdiTanim?.stone ?? 0 },
    ].filter((g) => g.qty > 0);
    if (tasDef.kind === 'counter' && (c.inputs?.counter?.t5Qty ?? 0) > 0) {
      const kaynak = c.counterT5Resource?.[tasDef.effect];
      const varOlan = girdiler.find((g) => g.resource === kaynak && g.tier === 5);
      if (varOlan) varOlan.qty += c.inputs.counter.t5Qty;
      else girdiler.push({ resource: kaynak, tier: 5, qty: c.inputs.counter.t5Qty });
    }
    return {
      inputs: girdiler,
      reqLevel: c.reqLevelByDegree?.[anahtar] ?? 1,
      xp: c.xpByDegree?.[anahtar] ?? 0,
    };
  }

  /* Meslek durumu: sistem henuz kurulu degilse (ch.professions yok) kapi UYGULANMAZ,
     kuruluysa gercek meslek satiri aranir. Boylece eksik sistem bu modulu kilitlemez.
     ALAN ADI: istemcinin `self.professions` satir semasi ght (ofset 623626) =
        X({ id: J(), level: Y().int(), xp: Y().int(), xpToNext: Y().int().nullable() })
     yani anahtar `id`'dir, `professionId` DEGIL. (Istemci Imt'ye beslerken
     ofset 666499'da `professions.map(p => ({ professionId: p.id }))` diye
     KENDISI cevirir.) Meslek sistemini baska bir dalga yaziyor; hangi adi
     kullanirsa kullansin kilitlenmeyelim diye ikisi de kabul ediliyor. */
  function meslek(ch, id) {
    /* Meslek listesi karakterin UZERINDE nerede duruyor?
       sistem_meslek.js (kardes modul) `ch.meslekler` diyor (meslekler(ch),
       satir 388); istemci yukune cikarken meslekPayload onu `professions`
       adiyla ght satirlarina ceviriyor. Ikisini de tariyoruz: hangi ad
       kullanilirsa kullanilsin kapi calissin, HICBIRI yoksa (meslek sistemi
       kapali) kapi UYGULANMASIN. */
    const liste = Array.isArray(ch.meslekler) ? ch.meslekler
      : (Array.isArray(ch.professions) ? ch.professions : null);
    if (!liste) return { kurulu: false, satir: null };
    const satir = liste.find((p) => (p?.id ?? p?.professionId) === id) ?? null;
    return { kurulu: true, satir };
  }

  /* ==================================================================== 53 item.enhance */
  function mesajEnhance(ws, ch, d) {
    const hedefKap = refCoz(ch, d.target);
    const eliksirKap = refCoz(ch, d.elixir);
    if (!hedefKap?.yigin || !eliksirKap?.yigin) {
      uyar(ws, 'ERR_NOT_FOUND'); return;
    }
    const hedef = hedefKap.yigin;
    const hedefDef = KATALOG.get(hedef.itemId);
    if (!ekipmanMi(hedefDef)) { uyar(ws, 'ERR_VALIDATION'); return; }

    const eliksirDef = KATALOG.get(eliksirKap.yigin.itemId);
    if (eliksirDef?.type !== 'elixir') { uyar(ws, 'ERR_VALIDATION'); return; }
    // ui.alchemy.elixir_type_mismatch kapisi (ofset 27254300)
    if (eliksirDef.appliesTo && hedefDef.type !== eliksirDef.appliesTo) {
      uyar(ws, 'ERR_VALIDATION'); return;
    }

    const plus = hedef.plus ?? 0;
    if (plus >= MAX_PLUS) { uyar(ws, 'ERR_VALIDATION'); return; }

    /* Toz istege bagli; verilmisse gercekten toz olmali ve derecesi tutmali. */
    let tozKap = null;
    if (d.powder) {
      tozKap = refCoz(ch, d.powder);
      const tozDef = tozKap?.yigin ? KATALOG.get(tozKap.yigin.itemId) : null;
      if (tozDef?.type !== 'powder') { uyar(ws, 'ERR_VALIDATION'); return; }
      if (TOZ_DERECE_SART && tozDef.luckTier !== hedefDef.degree) { uyar(ws, 'ERR_VALIDATION'); return; }
    }

    const sansYuku = sayacDegeri(mavilar(hedef), 'luck');
    const oran = simyaOrani(plus, !!tozKap, sansYuku);

    /* Tuketim: eliksir HER DENEMEDE gider, toz kullanildiysa o da.
       Sans yuku de deneme basina bir tane harcanir (ui.tooltip.stone_luck_hint). */
    dus(eliksirKap, 1);
    if (tozKap) dus(tozKap, 1);
    if (sansYuku > 0) {
      sayacHarca(hedef, 'luck');
      bildir(ws, 'sys.stone.luck_used', { item: esyaAdi(hedefDef, hedef.itemId) });
    }

    const basarili = zar() < oran;
    let yeniPlus = plus;

    if (basarili) {
      yeniPlus = plus + 1;
      hedef.plus = yeniPlus;
      bildir(ws, 'sys.economy.alchemy_ok', { item: esyaAdi(hedefDef, hedef.itemId), plus: yeniPlus });
    } else if (BASARISIZLIK === 'reset' && plus > 0) {
      const astral = sayacDegeri(mavilar(hedef), 'astr');
      if (astral > 0 && plus >= ASTRAL_TABAN) {
        // Astral yuku: sifirlanmak yerine tabana iner, bir yuk harcar.
        yeniPlus = ASTRAL_TABAN;
        hedef.plus = yeniPlus;
        sayacHarca(hedef, 'astr');
        bildir(ws, 'sys.stone.astral_saved', { item: esyaAdi(hedefDef, hedef.itemId), plus: yeniPlus });
      } else {
        yeniPlus = 0;
        hedef.plus = 0;
        bildir(ws, 'sys.economy.alchemy_reset', { item: esyaAdi(hedefDef, hedef.itemId) });
      }
    } else {
      // +0'da ya da sifirlamasiz politikada: esya olduğu gibi kalir, eliksir gider.
      hedef.plus = plus;
      bildir(ws, 'sys.economy.alchemy_fail', { item: esyaAdi(hedefDef, hedef.itemId), plus });
    }

    hedefKap.yaz(hedef);
    frame(ws, 'item.enhanced', { target: d.target, success: basarili, plus: yeniPlus });
    envanterYolla(ws, ch);
  }

  /* ==================================================================== 38 stone.craft */
  function mesajStoneCraft(ws, ch, d) {
    const tasDef = KATALOG.get(d.stoneId);
    if (tasDef?.type !== 'magicstone') { uyar(ws, 'ERR_NOT_FOUND'); return; }

    const m = meslek(ch, 'enchanter');
    if (m.kurulu && !m.satir) {
      uyar(ws, 'ERR_REQ_PROFESSION', 'err.profession.required', { profession: 'Enchanter' });
      return;
    }

    const tarif = tasTarifi(tasDef);
    const seviye = m.satir ? (m.satir.level ?? 1) : (ch.level ?? 1);
    if (seviye < tarif.reqLevel) {
      uyar(ws, 'ERR_REQ_LEVEL', 'err.stone.level', { level: tarif.reqLevel });
      return;
    }

    /* Malzeme kontrolu - hepsi yeterli mi (once bak, sonra tuket). */
    for (const g of tarif.inputs) {
      const mat = MALZEME.get(`${g.resource}:${g.tier}`);
      if (!mat) { uyar(ws, 'ERR_NOT_FOUND', 'err.stone.materials', { item: `${g.resource} t${g.tier}`, need: g.qty }); return; }
      if (cantadaAdet(ch, mat.id) < g.qty) {
        uyar(ws, 'ERR_NOT_FOUND', 'err.stone.materials', { item: mat.name, need: g.qty });
        return;
      }
    }

    /* Ozumseme orani stat taslarda yigina yazilir, sayaclarda null. */
    const asm = tasDef.kind === 'stat'
      ? zarSec((TASLAR.families ?? []).find((f) => f.effect === tasDef.effect)?.assimilationBytes ?? [10])
      : null;
    const ek = asm === null ? null : { rolls: { asm } };

    /* Canta yeri once denenir; yer yoksa malzeme YAKILMAZ. */
    const yedek = canta(ch).map((y) => (y ? { ...y } : null));
    for (const g of tarif.inputs) {
      const mat = MALZEME.get(`${g.resource}:${g.tier}`);
      cantadanTuket(ch, mat.id, g.qty);
    }
    if (!cantayaEkle(ch, tasDef.id, 1, ek)) {
      ch.bag = yedek;                                  // geri al
      uyar(ws, 'ERR_BAG_FULL');
      return;
    }

    /* Uretim HER ZAMAN basarilidir (risk uygulamada) - magic-stones.json craft notu. */
    /* PLAN MD.46 - URETIM TP'SI ARTIK OLU DEGIL.
       ESKIDEN: `m.satir.xp = (m.satir.xp ?? 0) + tarif.xp;` - seviye atlama
       dongusu YOK, profession.update (207) YOK, sys.profession.level_up YOK,
       WebSaveCharProfession YOK. Enchanter TP'si Meslekler penceresinde hic
       degismiyor ve cikista tamamen kayboluyordu.
       ARTIK: kardes modulun TEK yetkili yordami cagriliyor - seviye dongusu,
       207 karesi, bildirim ve SQL yazimi orada tek yerde.
       ctx.sistemOrnegi zaten bu modulde var (ustalik esitlemesi icin). */
    let verilenTp = tarif.xp;
    if (m.satir) {
      try {
        const ms = typeof sistemOrnegi === 'function' ? sistemOrnegi('meslek') : null;
        const r = ms?.meslekTpEkle?.(ws, 'enchanter', tarif.xp);
        if (r) verilenTp = r.verilen;
        /* Meslek modulu yoksa (ya da o karakterde meslek satiri yoksa) eski
           davranisa dus: en azindan bellekteki TP artsin, sunucu durmasin. */
        else m.satir.xp = (m.satir.xp ?? 0) + tarif.xp;
      } catch (e) {
        log('gelistirme: meslek TP:', String(e?.message ?? e).slice(0, 120));
        m.satir.xp = (m.satir.xp ?? 0) + tarif.xp;
      }
    }
    bildir(ws, 'sys.stone.crafted', { item: esyaAdi(tasDef, tasDef.id) });
    /* xp alani BILGI amaclidir (istemci sadece elixir_suc.ogg caliyor,
       paket @27123931). GERCEKTEN verilen TP gonderiliyor - GCFG
       professionXpRate 1 disinda bir degere cekilirse ekrandaki sayi
       yalan olmasin. */
    frame(ws, 'stone.crafted', { itemId: tasDef.id, asm, xp: verilenTp });
    envanterYolla(ws, ch);
  }

  /* ==================================================================== 39 stone.apply */
  function mesajStoneApply(ws, ch, d) {
    const hedefKap = refCoz(ch, d.target);
    const tasKap = refCoz(ch, d.stone);
    if (!hedefKap?.yigin || !tasKap?.yigin) { uyar(ws, 'ERR_NOT_FOUND'); return; }

    const hedef = hedefKap.yigin;
    const hedefDef = KATALOG.get(hedef.itemId);
    const tas = tasKap.yigin;
    const tasDef = KATALOG.get(tas.itemId);
    if (tasDef?.type !== 'magicstone') { uyar(ws, 'ERR_VALIDATION'); return; }

    const blues = mavilar(hedef);
    const kapi = tasKapisi(tasDef, hedefDef, blues);
    if (!kapi.ok) {
      /* Kapi hatasinda tas TUKETILMEZ. err.stone.* anahtarlari locale'de dogrulandi. */
      const anahtar = {
        target: 'err.stone.target', degree: 'err.stone.degree',
        capacity: 'err.stone.capacity', counter_cap: 'err.stone.counter_cap',
        unknown_opt: 'err.stone.target',
      }[kapi.err];
      uyar(ws, 'ERR_VALIDATION', anahtar, { item: esyaAdi(hedefDef, hedef.itemId) });
      return;
    }

    const tasAdi = esyaAdi(tasDef, tas.itemId);
    const hedefAdi = esyaAdi(hedefDef, hedef.itemId);

    /* Tas basarili da olsa basarisiz da olsa TUKENIR ("Tas parcalandi"). */
    dus(tasKap, 1);

    const basarili = zar() * 100 < (tasDef.baseChancePct ?? 50);
    if (!basarili) {
      bildir(ws, 'sys.stone.apply_fail', { stone: tasAdi, item: hedefAdi });
      frame(ws, 'stone.applied', { target: d.target, success: false, effect: tasDef.effect });
      envanterYolla(ws, ch);
      return;
    }

    /* Etkiyi uygula.
       merdiven BOS olamaz (120 tasin hepsi dolu merdivene cozuluyor, teste
       bakiniz) ama bos gelse zarSec undefined dondurur ve yigina
       {value: undefined} yazilirdi - S$ semasi `value: Y()` sayi bekler.
       Bu yuzden bos merdivende 0'a duseriz, asla undefined yazmayiz. */
    const merdiven = degerMerdiveni(kapi.opt);
    const merdivendenSec = () => (merdiven.length ? zarSec(merdiven) : 0);
    let yeniDeger;
    const i = maviIndeks(blues, tasDef.effect);
    if (kapi.mode === 'counter') {
      if (i >= 0) { blues[i].value += 1; yeniDeger = blues[i].value; }
      else { yeniDeger = 1; blues.push({ id: kapi.opt.id, value: 1 }); }
    } else if (kapi.mode === 'replace') {
      yeniDeger = merdivendenSec();                 // yeni deger DAHA DUSUK olabilir
      blues[i] = { id: kapi.opt.id, value: yeniDeger };
    } else {
      yeniDeger = merdivendenSec();
      blues.push({ id: kapi.opt.id, value: yeniDeger });
    }
    hedef.blues = blues;

    const cevap = {
      target: d.target, success: true, effect: tasDef.effect,
      value: yeniDeger, mode: kapi.mode,
    };
    bildir(ws, 'sys.stone.apply_ok', { stone: tasAdi, item: hedefAdi });

    /* --- ozumseme: SADECE stat taslarda (sayaclar asla ozumsemez) ------------ */
    const asmPct = tasDef.kind === 'stat' ? (tas.rolls?.asm ?? 0) : 0;
    if (asmPct > 0 && zar() * 100 < asmPct) {
      const koruma = sayacDegeri(blues, 'ape');
      if (koruma > 0) {
        sayacHarca(hedef, 'ape');
        cevap.assimilation = { kind: 'prevented' };
        bildir(ws, 'sys.stone.assim_prevented', { item: hedefAdi });
      } else {
        /* NON-PARITY: beyaz/mavi secimi veriyle belirlenmiyor - yazi tura. */
        const beyaziSec = zar() < 0.5;
        const yuvalar = NITELIK_YUVALARI[hedefDef.type] ?? [];
        if (beyaziSec && yuvalar.length > 0 && hedef.variance !== undefined) {
          const yuva = zarInt(yuvalar.length);
          hedef.variance = nitelikYaz(hedef.variance, yuva, zarInt(32));
          cevap.assimilation = { kind: 'white', whiteSlot: yuva };
          bildir(ws, 'sys.stone.assim_white', { item: hedefAdi });
        } else {
          /* Yeni takilan satir DISINDA yeniden zar atilabilecek mavi satir ara. */
          const adaylar = [];
          for (let k = 0; k < blues.length; k++) {
            if (blues[k].id === kapi.opt.id) continue;
            const o = OPT_ID.get(blues[k].id);
            if (!o) continue;
            if (SAYAC_ETKILERI.has(o.effect)) continue;          // Omt - yuk, deger degil
            if (degerMerdiveni(o).length > 1) adaylar.push(k);
          }
          if (adaylar.length === 0) {
            cevap.assimilation = { kind: 'blue_noop' };
          } else {
            const k = zarSec(adaylar);
            const o = OPT_ID.get(blues[k].id);
            const m2 = degerMerdiveni(o);
            blues[k] = { id: o.id, value: m2.length ? zarSec(m2) : blues[k].value };
            hedef.blues = blues;
            cevap.assimilation = { kind: 'blue' };
            bildir(ws, 'sys.stone.assim_blue', { item: hedefAdi });
          }
        }
      }
    }

    hedefKap.yaz(hedef);
    frame(ws, 'stone.applied', cevap);
    envanterYolla(ws, ch);
  }

  /* ==================================================================== 25 item.spscroll */
  function mesajSpScroll(ws, ch, d) {
    const b = canta(ch);
    if (d.bagSlot >= b.length) { uyar(ws, 'ERR_NOT_FOUND'); return; }
    const yigin = b[d.bagSlot];
    if (!yigin) { uyar(ws, 'ERR_NOT_FOUND'); return; }
    const def = KATALOG.get(yigin.itemId);

    if (d.op === 'create') {
      if (def?.type !== 'spSaver') { uyar(ws, 'ERR_VALIDATION'); return; }
      const kademe = SP_KADEMELERI[d.tier];
      if (!kademe) { uyar(ws, 'ERR_VALIDATION'); return; }
      if ((ch.sp ?? 0) < kademe.burnSp) { uyar(ws, 'ERR_NO_SP'); return; }
      const parsomenDef = KATALOG.get(kademe.itemId);
      if (!parsomenDef) { uyar(ws, 'ERR_NOT_FOUND'); return; }

      /* Once yer var mi diye dene; yer yoksa SP yanmaz. */
      const yedek = b.map((y) => (y ? { ...y } : null));
      const kap = { yigin, yaz: (v) => { b[d.bagSlot] = v; } };
      dus(kap, 1);
      if (!cantayaEkle(ch, kademe.itemId, 1)) {
        ch.bag = yedek;
        uyar(ws, 'ERR_BAG_FULL');
        return;
      }
      ch.sp = (ch.sp ?? 0) - kademe.burnSp;
      bildir(ws, 'sys.spscroll.created', {
        burn: kademe.burnSp, item: esyaAdi(parsomenDef, kademe.itemId),
      });
      frame(ws, 'skills.update', {
        known: Array.isArray(ch.knownSkills) ? ch.knownSkills : [], sp: ch.sp,
      });
      envanterYolla(ws, ch);
      return;
    }

    /* op === 'use' */
    if (def?.type !== 'spScroll') { uyar(ws, 'ERR_VALIDATION'); return; }
    const kazanc = def.sp ?? 0;
    const kap = { yigin, yaz: (v) => { b[d.bagSlot] = v; } };
    dus(kap, 1);
    ch.sp = (ch.sp ?? 0) + kazanc;
    bildir(ws, 'sys.spscroll.used', { sp: kazanc });
    frame(ws, 'skills.update', {
      known: Array.isArray(ch.knownSkills) ? ch.knownSkills : [], sp: ch.sp,
    });
    envanterYolla(ws, ch);
  }

  /* ==================================================================== 94 item.reset */
  function mesajReset(ws, ch, d) {
    const b = canta(ch);
    if (d.bagSlot >= b.length) { uyar(ws, 'ERR_NOT_FOUND'); return; }
    const yigin = b[d.bagSlot];
    if (!yigin) { uyar(ws, 'ERR_NOT_FOUND'); return; }
    const def = KATALOG.get(yigin.itemId);
    const kap = { yigin, yaz: (v) => { b[d.bagSlot] = v; } };

    if (d.op === 'stats') {
      if (def?.type !== 'statReset') { uyar(ws, 'ERR_VALIDATION'); return; }
      /* Bmt (ofset 25586263) */
      const baslangic = combat?.cfg?.startingStats ?? { str: 20, int: 20 };
      const tabanStr = baslangic.str + ((ch.level ?? 1) - 1);
      const tabanInt = baslangic.int + ((ch.level ?? 1) - 1);
      const iade = ((ch.str ?? tabanStr) - tabanStr) + ((ch.int ?? tabanInt) - tabanInt);
      if (iade <= 0) { uyar(ws, 'ERR_VALIDATION'); return; }   // ui.reset.nothing

      dus(kap, 1);
      ch.str = tabanStr;
      ch.int = tabanInt;
      ch.statPoints = (ch.statPoints ?? 0) + iade;

      const d2 = derived ? derived(ch) : null;
      if (d2) {
        ch.hp = Math.min(ch.hp ?? d2.maxHp, d2.maxHp);
        ch.mp = Math.min(ch.mp ?? d2.maxMp, d2.maxMp);
        frame(ws, 'stats.update', {
          base: { str: ch.str, int: ch.int, unspent: ch.statPoints },
          derived: d2, hp: ch.hp, mp: ch.mp,
        });
      }
      bildir(ws, 'sys.reset.stats', { points: iade });
      envanterYolla(ws, ch);
      return;
    }

    /* op === 'mastery' */
    if (def?.type !== 'masteryReset') { uyar(ws, 'ERR_VALIDATION'); return; }
    const ustaliklar = Array.isArray(ch.masteries) ? ch.masteries : [];
    const satir = ustaliklar.find((m) => m.masteryId === d.masteryId);
    const seviye = satir?.level ?? 0;
    const bilinen = Array.isArray(ch.knownSkills) ? ch.knownSkills : [];

    /* Vmt (ofset 25586586): ustalik seviye maliyetleri + o ustaligin becerileri */
    let iade = 0;
    for (let s = 1; s <= seviye; s++) iade += USTALIK_MALIYET[String(s)] ?? 0;
    const unutulan = [];
    for (const bid of bilinen) {
      const bdef = BECERI.get(bid);
      if (bdef && bdef.mastery === d.masteryId) { iade += bdef.spCost ?? 0; unutulan.push(bid); }
    }
    if (iade <= 0) { uyar(ws, 'ERR_VALIDATION'); return; }     // ui.reset.nothing

    dus(kap, 1);
    /* Satiri LEVEL 0 birakmak YASAK: istemcinin ustalik satiri semasi
       oht (ofset 623555) = X({ masteryId: J(), level: Y().int().min(1) })
       yani level>=1 zorunlu. Level 0 kalirsa bir sonraki `self` karesi
       istemcide dogrulamadan gecemez. Sifirlanan ustalik LISTEDEN CIKARILIR.
       (s2c mastery.update semasinda level'in alt siniri yok - istemcinin
        kendi isleyicisi ofset 654706'da satiri level:0 ile guncelliyor,
        bu yalnizca oturum ici gorunum.) */
    if (satir) {
      const yer = ustaliklar.indexOf(satir);
      if (yer >= 0) ustaliklar.splice(yer, 1);
      ch.masteries = ustaliklar;
    }
    if (unutulan.length > 0) {
      ch.knownSkills = bilinen.filter((s) => !unutulan.includes(s));
    }
    ch.sp = (ch.sp ?? 0) + iade;

    bildir(ws, 'sys.reset.mastery', {
      mastery: USTALIK_AD.get(d.masteryId) ?? d.masteryId, sp: iade,
    });
    frame(ws, 'mastery.update', { masteryId: d.masteryId, level: 0, sp: ch.sp });
    frame(ws, 'skills.update', {
      known: Array.isArray(ch.knownSkills) ? ch.knownSkills : [], sp: ch.sp,
    });
    /* KALICILIK: silinen ustalik/beceri satirlarini vSRO'dan da dusur -
       yoksa bir sonraki giriste SP iadesiyle birlikte geri gelirler. */
    ustaligiEsitle(ch);
    envanterYolla(ws, ch);
  }

  const ISLEYICILER = {
    'item.enhance': mesajEnhance,
    'item.reset': mesajReset,
    'item.spscroll': mesajSpScroll,
    'stone.craft': mesajStoneCraft,
    'stone.apply': mesajStoneApply,
  };

  /* -------------------------------------------------------------- mesaj yonlendirici */
  function mesaj(ws, t, d) {
    const isleyici = ISLEYICILER[t];
    if (!isleyici) return false;                 // ilgilenmiyoruz -> siradaki modul
    const ch = ws?.char;
    if (!ch) return true;                        // karaktersiz soket: yut

    let veri;
    try {
      veri = SEMALAR[t](d);
    } catch (e) {
      if (e instanceof SemaHatasi) {
        uyar(ws, 'ERR_VALIDATION', undefined, undefined);
        log(`gelistirme sema hatasi (${t}): ${e.message}`);
        return true;
      }
      throw e;
    }
    isleyici(ws, ch, veri);
    return true;
  }

  /* mesaj() sozlesme geregi; digerleri birim testi icin disari acilir. */
  return {
    mesaj,
    /* --- test yuzeyi --- */
    KATALOG, OPT_ID, OPT_ARA, MALZEME,
    simyaOrani, tasKapisi, degerMerdiveni, nitelikOku, nitelikYaz, tasTarifi,
    sabitler: { MAX_PLUS, MAX_MAVI, SANS_BONUS_PCT, ASTRAL_TABAN, COUNTER_TAVAN, BASARISIZLIK },
  };
}
