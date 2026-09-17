/**
 * sistem_lonca.js — lonca (guild) sistemi
 *
 * Islenen c2s mesajlari (opcode'lar protocol.js ile birebir):
 *   121  guild.create   sema: X({name})                      hiz sinifi: misc
 *   122  guild.manage   sema: HJ(`op`, [...12 secenek])       hiz sinifi: misc
 *   123  guild.bank     sema: HJ(`op`, [...6 secenek])        hiz sinifi: exchange
 *   124  guild.query    sema: HJ(`op`, [directory|log])       hiz sinifi: misc
 *
 * ======================================================== SEMA KAYNAGI (UYDURMA YOK)
 * Hepsi okunabilir istemci paketinden alindi:
 *   playjs_source\index-BUMMQVRB.js
 *
 * Zod takma adlari (paketten `function <ad>(` ile dogrulandi):
 *   X = z.object · Y = z.number · J = z.string · JJ = z.literal · BJ = z.array
 *   qJ = z.enum · VJ = z.union · HJ = z.discriminatedUnion · GJ = z.record · RJ = z.boolean
 *
 * --- c2s (ofset 25613000+ bloku) -------------------------------------------------
 *   T$(`guild.create`, 121, X({ name: J().min(3).max(16) }), `misc`)
 *
 *   T$(`guild.manage`, 122, HJ(`op`, [
 *     X({ op:JJ(`invite`),       targetId: Y().int() }),
 *     X({ op:JJ(`respond`),      accept: RJ() }),
 *     X({ op:JJ(`leave`) }),
 *     X({ op:JJ(`kick`),         charId: J() }),
 *     X({ op:JJ(`setRank`),      charId: J(), rank: v$.exclude([`master`]) }),
 *     X({ op:JJ(`setPerms`),     charId: J(), perms: Y().int().min(0).max(31) }),
 *     X({ op:JJ(`notice`),       text: J().max(500) }),
 *     X({ op:JJ(`transfer`),     charId: J() }),
 *     X({ op:JJ(`disband`) }),
 *     X({ op:JJ(`apply`),        guildId: J() }),
 *     X({ op:JJ(`applyCancel`),  guildId: J() }),
 *     X({ op:JJ(`applyRespond`), charId: J(), accept: RJ() }),
 *   ]), `misc`)
 *
 *   T$(`guild.bank`, 123, HJ(`op`, [
 *     X({ op:JJ(`open`),         npcId: J() }),
 *     X({ op:JJ(`depositGold`),  npcId: J(), amount: Y().int().min(1).max(2e9) }),
 *     X({ op:JJ(`withdrawGold`), npcId: J(), amount: Y().int().min(1).max(2e9) }),
 *     X({ op:JJ(`depositItem`),  npcId: J(), bagSlot: Y().int().min(0).max(159),  qty: D$ }),
 *     X({ op:JJ(`withdrawItem`), npcId: J(), bankSlot: Y().int().min(0).max(127), qty: D$ }),
 *     X({ op:JJ(`moveItem`),     npcId: J(), from: Y().int().min(0).max(127),
 *                                            to:   Y().int().min(0).max(127) }),
 *   ]), `exchange`)
 *
 *   T$(`guild.query`, 124, HJ(`op`, [
 *     X({ op:JJ(`directory`), page: Y().int().min(0), search: J().max(16).optional() }),
 *     X({ op:JJ(`log`),       page: Y().int().min(0) }),
 *   ]), `misc`)
 *
 *   v$ = qJ([`master`,`officer`,`member`,`recruit`])      (rutbe siralamasi da bu)
 *   D$ = Y().int().min(1).max(1e3)                        (miktar)
 *
 * --- s2c (ofset 25627549..25629200) ----------------------------------------------
 *   Pht = X({ charId:J(), name:J(), level:Y().int(), rank:v$, perms:Y().int(),
 *             online:RJ(), contributedXp:Y().int(), race:J().optional() })
 *
 *   T$(`guild.state`, 163, X({
 *     guild: X({ id:J(), name:J(), level:Y().int(), xp:Y().int(),
 *                nextLevelXp:Y().int().nullable(), rating:Y().int(),
 *                notice:J(), masterId:J(), memberCap:Y().int() }).nullable(),
 *     members: BJ(Pht).optional(),
 *     myPerms: Y().int().optional(),
 *     applications: BJ(X({ charId:J(), name:J(), level:Y().int(), at:Y() })).optional() }))
 *
 *   T$(`guild.invited`,  164, X({ guildId:J(), guildName:J(), fromName:J(), expiresAt:Y() }))
 *   T$(`guild.left`,     165, X({ reason:qJ([`left`,`kicked`,`disbanded`]),
 *                                 penaltyUntil:Y().optional() }))
 *   T$(`guild.bankState`,166, X({ gold:Y().int(), capacity:Y().int(),
 *                                 items:BJ(X({ slot:Y().int(), stack:S$ })) }))
 *   T$(`guild.log`,      167, X({ page:Y().int(), total:Y().int(),
 *                                 entries:BJ(X({ at:Y(), actorName:J(), action:J(),
 *                                   itemDefId:J().optional(), quantity:Y().int().optional(),
 *                                   gold:Y().int().optional() })) }))
 *   T$(`guild.directory`,171, X({ page:Y().int(), total:Y().int(),
 *                                 guilds:BJ(X({ id:J(), name:J(), level:Y().int(),
 *                                   memberCount:Y().int(), memberCap:Y().int(),
 *                                   rating:Y().int(), masterName:J(), applied:RJ() })) }))
 *   T$(`entity.guild`,   172, X({ id:Y().int(), guild:J().nullable() }))
 *
 *   zone.init.self (_ht, ofset 25598050):
 *     guild: X({ id:J(), name:J(), level:Y().int(), rank:v$ }).nullable()
 *     guildPenaltyUntil: Y().nullable().optional()
 *   entity (ofset 25591717): guild: J().optional()      <- lonca ADI
 *
 * ================================================ ISTEMCI DAVRANISI (paketten olculdu)
 *  1) `guild.state` alicisi (ofset 27132810) magazayi TAM DEGISTIRIR:
 *       members: guild ? members ?? [] : []   (myPerms/applications da ayni)
 *     Yani her guild.state karesi TAM olmali; eksik alan gonderirsen istemcide
 *     uye listesi/yetkiler SILINIR. Bu modul daima tam kare gonderir.
 *  2) self.guild.rank istemcide `members.find(charId===self.charId)?.rank ?? 'recruit'`
 *     ile hesaplanir - yani members dizisi gonderilmezse herkes "Acemi" gorunur.
 *  3) `guild.left` alicisi penaltyUntil VARSA self.guildPenaltyUntil'i gunceller.
 *     Sema penaltyUntil'i OPSIYONEL yapmis: ayrilmada var, atilma/dagilmada yok.
 *  4) Lonca kasasi AYRI bir NPC degil - depo NPC'sinin (npc.bank) menusunden
 *     `openGuildBank(npc.id)` ile aciliyor (ofset 27500568), yani npcId = NPC
 *     KATALOG KIMLIGI ('npc_ch_warehouse'), varlik id'si degil.
 *  5) Kasa izgarasi sayfa basina 36 yuva; kapasite guild.bankState.capacity.
 *  6) Rehber ve kayit sayfa boyu = 10 (Math.ceil(total/10), ofset 27412650 / 27424700).
 *  7) `sys.guild.*` anahtarlarinin TAMAMI sys.notice enum'unda (Tht) VAR;
 *     `err.key` enum'unda (Eht) lonca anahtari YOK - o yuzden lonca uyarilari
 *     sys.notice ile gider, sadece protokol/dogrulama hatasi `err` ile.
 *  8) sys.notice params'i istemcide q5() ile zenginlestirilir: `itemId` gonderirsen
 *     `{item}` yer tutucusu esya ADINA cevrilir (ofset 27114963). Bu yuzden
 *     bank_item_in/out'ta {itemId, qty} gonderiyoruz.
 *
 * ================================================ SAYISAL DEGERLERIN KAYNAGI
 *   SEVIYE TABLOSU (XFt, ofset 27404250): level/cumXp/memberCap/bankSlots 1..10 —
 *     paketten AYNEN kopyalandi.
 *   YETKI BITLERI (y9, ofset 27404280): INVITE 1, KICK 2, BANK_WITHDRAW 4,
 *     NOTICE 8, PROMOTE 16  (toplam 31 = semanin .max(31) siniri).
 *   AD KURALI (ZFt, ofset 27405180): 3..16, /^[A-Za-z][A-Za-z0-9 ]*$/,
 *     sonu bosluk olamaz, cift bosluk olamaz.
 *   CEZA 24 SAAT: locale tr.json — "24 saat beklemelisin" (sys.guild.join_failed_penalty)
 *     ve "Ayrıl? (24s ceza)" (ui.guild.leave_confirm).
 *   KURMA UCRETSIZ: locale ui.guild.create_free — "Lonca kurmak şu an ücretsiz."
 *   NPC MENZILI: gameConfig.npcInteractRangeU = 25.
 *
 *   PAKETTE KARSILIGI OLMAYAN, BURADA SUNUCU POLITIKASI OLARAK SECILEN 3 DEGER
 *   (rapora da yazildi — istersen degistir, istemci hepsini oldugu gibi kabul eder):
 *     · DAVET SURESI: gameConfig.partyInviteTimeoutMs (30000) ODUNC ALINDI.
 *       Pakette lonca daveti icin ayri bir sure YOK; istemci sunucunun verdigi
 *       expiresAt'i aynen kullaniyor (ofset 27410412).
 *     · ACIK BASVURU SINIRI: 5 (sys.guild.apply_limit metni var ama sayi yok).
 *     · LIDERLIGI DEVREDEN eski lider `officer` olur (master alti en yuksek rutbe).
 *   `rating` alani icin pakette HIC formul yok; saklanir, varsayilan 0, disaridan
 *   `puanAyarla()` ile degistirilebilir.
 *
 * ================================================================= KALICILIK
 *   SRO_WEB_GAME'de HAZIR lonca tablosu/yordami YOK (mevcut 25 tablo + 30 yordam
 *   tarandi). Gereken sema ve yordamlar `sistem_lonca_sema.sql` dosyasina yazildi -
 *   ANA OTURUM calistiracak. Bu modul `ctx.web` null iken TAMAMEN BELLEKTE calisir
 *   (sunucu yeniden baslayinca loncalar kaybolur), `web` verilince ayni akis
 *   yordamlarla diske yazar.
 *
 *   SRO_VT_SHARD'daki vSRO tablolari (_Guild/_GuildMember/_GuildChest) BILEREK
 *   kullanilmadi: referans oyun modelinde metin lonca kimligi, xp/rating/notice/perms
 *   bit maskesi, basvuru listesi, kayit defteri ve {plus,dur,blues,rolls} tasiyan
 *   kasa yigini var; vSRO semasinda bunlarin karsiligi yok (_GuildChest sadece
 *   ItemID bigint tutuyor).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* ------------------------------------------------------- paketten alinan sabitler */

/** y9 — yetki bit maskesi (ofset 27404280). */
export const YETKI = Object.freeze({
  INVITE: 1, KICK: 2, BANK_WITHDRAW: 4, NOTICE: 8, PROMOTE: 16,
});
const YETKI_HEPSI = 31;                       // semanin .max(31) siniri ile ayni

/** v$ — rutbeler, YUKSEKTEN ALCAGA. Istemci b9 dizisi ile birebir ayni sira. */
export const RUTBELER = Object.freeze(['master', 'officer', 'member', 'recruit']);
const rutbeSira = (r) => RUTBELER.indexOf(r);

/** XFt — lonca seviye tablosu (ofset 27404250). cumXp = KUMULATIF xp. */
export const SEVIYE_TABLOSU = Object.freeze([
  { level: 1,  cumXp: 0,       memberCap: 20, bankSlots: 12 },
  { level: 2,  cumXp: 10000,   memberCap: 23, bankSlots: 18 },
  { level: 3,  cumXp: 40000,   memberCap: 26, bankSlots: 24 },
  { level: 4,  cumXp: 115000,  memberCap: 30, bankSlots: 30 },
  { level: 5,  cumXp: 265000,  memberCap: 33, bankSlots: 36 },
  { level: 6,  cumXp: 565000,  memberCap: 36, bankSlots: 48 },
  { level: 7,  cumXp: 1165000, memberCap: 40, bankSlots: 60 },
  { level: 8,  cumXp: 2365000, memberCap: 44, bankSlots: 72 },
  { level: 9,  cumXp: 4765000, memberCap: 47, bankSlots: 84 },
  { level: 10, cumXp: 9565000, memberCap: 50, bankSlots: 96 },
]);
const ENUST_SEVIYE = SEVIYE_TABLOSU[SEVIYE_TABLOSU.length - 1].level;
const seviyeSatiri = (lvl) =>
  SEVIYE_TABLOSU[Math.min(Math.max(1, lvl), ENUST_SEVIYE) - 1];
/** nextLevelXp: son seviyede null (istemci null'i "MAX" olarak gosteriyor). */
const sonrakiSeviyeXp = (lvl) =>
  lvl >= ENUST_SEVIYE ? null : SEVIYE_TABLOSU[lvl].cumXp;

/* PP MADDE 3 (changelog 0025 tr:8-11): karakter ustunde en fazla
   999.999.999.999 altin; siniri asacak LONCA KASASI cekimi "sessizce
   basarisiz olmak yerine" acik mesajla reddedilir (err.gold_cap + {cap},
   tr.json s.145). Ayni tavan gameloop (altin ganimeti), sistem_dukkan
   (satis) ve sistem_banka-depo (depo cekimi) ile ortak deger. */
const ALTIN_TAVANI = 999_999_999_999;

/** lIt — istemcinin tanidigi kayit eylemleri (ofset 27424700). Baskasi gonderilirse
 *  istemci satiri bos gosterir, o yuzden bu liste disina cikmiyoruz. */
export const KAYIT_EYLEMLERI = Object.freeze([
  'create', 'join', 'leave', 'kick', 'promote', 'demote', 'perms', 'notice',
  'transfer', 'level_up', 'deposit_gold', 'withdraw_gold', 'deposit_item',
  'withdraw_item', 'disband',
]);

/** ZFt — lonca adi kurali (ofset 27405180). */
export function adGecerliMi(ad) {
  if (typeof ad !== 'string') return false;
  if (ad.length < 3 || ad.length > 16) return false;
  if (!/^[A-Za-z][A-Za-z0-9 ]*$/.test(ad)) return false;
  if (ad.endsWith(' ')) return false;
  if (ad.includes('  ')) return false;
  return true;
}

/** Rehber ve kayit sayfa boyu (istemci Math.ceil(total/10) yapiyor). */
const SAYFA_BOYU = 10;

/** Ayrilma cezasi — locale: "24 saat". */
const CEZA_MS = 24 * 60 * 60 * 1000;

/** Depo NPC'leri: `bank: true` bayragi tasiyan kayitlar.
 *  Lonca kasasi bu NPC'lerin menusunden aciliyor (ofset 27500568).
 *
 *  MADDE 45: bu liste eskiden KAYNAK KODA GOMULUYDU; sistem_banka-depo ise
 *  ayni gercegi BASKA bir dosyadan okuyordu - tek gercek, iki kaynak. Artik
 *  ikisi de data/npcshops.json'daki `bank: true` bayragindan besleniyor
 *  (5 depo NPC'si o maddede bu dosyaya eklendi; sema kaniti paket @8703450
 *  civari Xot = X({ id, name, modelKey, shop?, bank: RJ().optional(), ... })).
 *  Menzil de artik sabit degil, NPC basina `interactRangeU` (istemci
 *  Ict(npc, cfg.npcInteractRangeU) = npc.interactRangeU ?? 25, paket
 *  @25686854; config/interact-radii.json: NPC_CH/WC_WAREHOUSE_M 22.75,
 *  NPC_KT/EU/CA_WAREHOUSE 15).
 *
 *  Dosya okunamazsa liste BOS kalir ve npcGecerli() HER NPC'yi reddeder -
 *  kapiyi gevsetmek yerine kapatmak dogru taraftir (bkz. fark #156).
 *  @type {Map<string, number>} npcId -> etkilesim yaricapi (0 = "yaricap yok")
 */
const BANKA_NPCLERI = (() => {
  const m = new Map();
  try {
    const p = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data', 'npcshops.json');
    const ham = JSON.parse(fs.readFileSync(p, 'utf8'));
    for (const [id, kayit] of Object.entries(ham?.shops ?? {})) {
      if (!kayit?.bank) continue;
      /* Number(null) === 0 tuzagi: sadece isFinite'e bakarsak
         interactRangeU: null olan kayit menzili 0'a cekerdi (sistem_dukkan.js
         :177 ile ayni kalip). */
      const mr = Number(kayit.interactRangeU);
      m.set(id, Number.isFinite(mr) && mr > 0 ? mr : 0);
    }
  } catch { /* dosya yok/bozuk -> bos kume, kapi KAPALI */ }
  return m;
})();

/* ------------------------------------------------------------------ dogrulayici
   Zod'un kucuk aynasi (sistem_arayuz-durumu.js ile ayni kurallar):
     - X({...}) bilinmeyen anahtarlari ATAR
     - .optional() -> anahtar hic olmayabilir; null OLAMAZ
     - HJ(`op`,[...]) -> `op` degerine gore TEK secenek dogrulanir             */

export class SemaHatasi extends Error {
  constructor(yol, sebep) {
    super(`${yol || '<kok>'}: ${sebep}`);
    this.yol = yol || '<kok>';
    this.sebep = sebep;
  }
}
const hata = (yol, sebep) => { throw new SemaHatasi(yol, sebep); };

function nesneMi(v, yol) {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) hata(yol, 'nesne bekleniyor');
  return v;
}
function metin(v, yol, { enAz, enCok } = {}) {
  if (typeof v !== 'string') hata(yol, 'metin bekleniyor');
  if (enAz !== undefined && v.length < enAz) hata(yol, `en az ${enAz} karakter`);
  if (enCok !== undefined && v.length > enCok) hata(yol, `en cok ${enCok} karakter`);
  return v;
}
function sayi(v, yol, { tam = false, enAz, enCok } = {}) {
  if (typeof v !== 'number' || !Number.isFinite(v)) hata(yol, 'sayi bekleniyor');
  if (tam && !Number.isInteger(v)) hata(yol, 'tam sayi bekleniyor');
  if (enAz !== undefined && v < enAz) hata(yol, `en az ${enAz}`);
  if (enCok !== undefined && v > enCok) hata(yol, `en cok ${enCok}`);
  return v;
}
function mantik(v, yol) {
  if (typeof v !== 'boolean') hata(yol, 'mantiksal deger bekleniyor');
  return v;
}
function secenek(v, yol, liste) {
  if (!liste.includes(v)) hata(yol, `su degerlerden biri olmali: ${liste.join('|')}`);
  return v;
}
/** D$ = Y().int().min(1).max(1e3) */
const miktar = (v, yol) => sayi(v, yol, { tam: true, enAz: 1, enCok: 1000 });

/** HJ(`op`, [...]) — ayirt edici birlesim. tablo: op -> alan dogrulayici. */
function ayrimliBirlesim(d, yol, tablo) {
  const o = nesneMi(d, yol);
  const op = o.op;
  if (typeof op !== 'string' || !(op in tablo)) {
    hata(`${yol}.op`, `su degerlerden biri olmali: ${Object.keys(tablo).join('|')}`);
  }
  const cikti = { op };
  for (const [alan, dogrula] of Object.entries(tablo[op])) {
    cikti[alan] = dogrula(o[alan], `${yol}.${alan}`);
  }
  return cikti;
}

/* --- 121 guild.create ------------------------------------------------------- */
export function semaCreate(d, yol = 'guild.create') {
  const o = nesneMi(d, yol);
  return { name: metin(o.name, `${yol}.name`, { enAz: 3, enCok: 16 }) };
}

/* --- 122 guild.manage ------------------------------------------------------- */
const MANAGE_TABLO = {
  invite:       { targetId: (v, y) => sayi(v, y, { tam: true }) },
  respond:      { accept: mantik },
  leave:        {},
  kick:         { charId: (v, y) => metin(v, y) },
  setRank:      { charId: (v, y) => metin(v, y),
                  rank: (v, y) => secenek(v, y, ['officer', 'member', 'recruit']) },
  setPerms:     { charId: (v, y) => metin(v, y),
                  perms: (v, y) => sayi(v, y, { tam: true, enAz: 0, enCok: YETKI_HEPSI }) },
  notice:       { text: (v, y) => metin(v, y, { enCok: 500 }) },
  transfer:     { charId: (v, y) => metin(v, y) },
  disband:      {},
  apply:        { guildId: (v, y) => metin(v, y) },
  applyCancel:  { guildId: (v, y) => metin(v, y) },
  applyRespond: { charId: (v, y) => metin(v, y), accept: mantik },
};
export const semaManage = (d, yol = 'guild.manage') => ayrimliBirlesim(d, yol, MANAGE_TABLO);

/* --- 123 guild.bank --------------------------------------------------------- */
const npcAlani = (v, y) => metin(v, y);
const tutar = (v, y) => sayi(v, y, { tam: true, enAz: 1, enCok: 2e9 });
const BANK_TABLO = {
  open:         { npcId: npcAlani },
  depositGold:  { npcId: npcAlani, amount: tutar },
  withdrawGold: { npcId: npcAlani, amount: tutar },
  depositItem:  { npcId: npcAlani,
                  /* SARTNAME-3 MADDE 11: canta tavani 383 (12 sayfa); lonca
                     bankasinin KENDI yuvalari (bankSlot/from/to max 127) canta
                     degildir, DOKUNULMADI. */
                  bagSlot: (v, y) => sayi(v, y, { tam: true, enAz: 0, enCok: 383 }),
                  qty: miktar },
  withdrawItem: { npcId: npcAlani,
                  bankSlot: (v, y) => sayi(v, y, { tam: true, enAz: 0, enCok: 127 }),
                  qty: miktar },
  moveItem:     { npcId: npcAlani,
                  from: (v, y) => sayi(v, y, { tam: true, enAz: 0, enCok: 127 }),
                  to:   (v, y) => sayi(v, y, { tam: true, enAz: 0, enCok: 127 }) },
};
export const semaBank = (d, yol = 'guild.bank') => ayrimliBirlesim(d, yol, BANK_TABLO);

/* --- 124 guild.query -------------------------------------------------------- */
export function semaQuery(d, yol = 'guild.query') {
  const o = nesneMi(d, yol);
  if (o.op === 'directory') {
    const c = { op: 'directory', page: sayi(o.page, `${yol}.page`, { tam: true, enAz: 0 }) };
    // .optional(): anahtar yoksa hic konulmaz
    if ('search' in o && o.search !== undefined) {
      c.search = metin(o.search, `${yol}.search`, { enCok: 16 });
    }
    return c;
  }
  if (o.op === 'log') {
    return { op: 'log', page: sayi(o.page, `${yol}.page`, { tam: true, enAz: 0 }) };
  }
  hata(`${yol}.op`, 'su degerlerden biri olmali: directory|log');
}

export const SEMALAR = { semaCreate, semaManage, semaBank, semaQuery };

/* ================================================================= yardimcilar */

const simdi = () => Date.now();
const kimlik = (v) => (v === null || v === undefined ? null : String(v));
/** Kareye ASLA NaN/Infinity sizmasin: istemci semalari Y().int() bekliyor. */
const tamSayi = (v) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : 0);

/** S$ yigini kopyala (referans paylasmayalim; blues/rolls ic ice). */
function yiginKopya(s) {
  if (!s) return null;
  const c = { itemId: String(s.itemId), qty: Math.max(1, Math.trunc(s.qty ?? 1)) };
  for (const a of ['plus', 'dur', 'maxDur', 'variance']) {
    if (typeof s[a] === 'number') c[a] = Math.trunc(s[a]);
  }
  if (Array.isArray(s.blues)) c.blues = s.blues.map((b) => ({ id: b.id, value: b.value }));
  /* S$.rolls semasi GJ(J(), Y()) = metin -> SAYI. Sayi olmayan bir deger
     karisirsa istemci TUM guild.bankState karesini reddeder, kasa bos gorunur.
     Bu yuzden sadece sonlu sayilari tasiyoruz. */
  if (s.rolls && typeof s.rolls === 'object') {
    const r = {};
    for (const [k, v] of Object.entries(s.rolls)) if (Number.isFinite(v)) r[k] = v;
    if (Object.keys(r).length) c.rolls = r;
  }
  return c;
}
/** Iki yigin ayni "kimlikte" mi (yiginlanabilir mi)? Guclendirilmis / dayanikligi
 *  olan / mavi statli esyalar ASLA birlestirilmez - aksi halde +5 kilic ile +0
 *  kilic tek yigina dusup ozelliklerinden biri kaybolur. */
function yiginlanirMi(a, b) {
  if (!a || !b || a.itemId !== b.itemId) return false;
  const sade = (s) => s.plus === undefined && s.dur === undefined &&
    s.variance === undefined && !s.blues && !s.rolls;
  return sade(a) && sade(b);
}

/* ============================================================== KALICILIK KATMANI
 * ctx.web null ise TUM metotlar sessizce no-op olur ve sistem bellekte calisir.
 * Yordam adlari sistem_lonca_sema.sql ile birebir.                              */
/* ============================================================ SEMA KURULUMU
 * OLCUM (canli SRO_WEB_GAME, salt okunur):
 *   sys.tables  -> 29 Web* tablo; WebGuild* olan HICBIRI YOK
 *   sys.procedures -> 32 yordam; WebLoadGuilds/WebSaveGuild ... HICBIRI YOK
 * Yani `sistem_lonca_sema.sql` HIC calistirilmamis. `kalici.etkin` true
 * oldugu icin her yazim SQL hatasina dusup log'a yaziliyor ve yutuluyordu:
 * lonca, uye listesi, kasa, basvurular ve 24 saatlik ceza TAMAMEN BELLEKTE
 * kaliyor, sunucu yeniden basladiginda (ve admin panelinden ayar
 * degistirildiginde) hepsi siliniyordu.
 *
 * COZUM: semayi modul KENDISI, FIKIRSIZ ve EKLEMELI olarak kurar. Kalip
 * projede zaten var - kalicilik.js:44 `IF OBJECT_ID(...) IS NULL CREATE TABLE`.
 * IKI GUVENLIK KURALI:
 *   1) DROP CALISTIRMAYIZ. Dosyadaki `... IS NOT NULL DROP PROCEDURE` toplu
 *      isleri ATLANIR; yordamlar `CREATE OR ALTER PROCEDURE` ile kurulur
 *      (SQL Server 2016 SP1+; olculen sunucu 17.0.1125.2 = SQL Server 2025).
 *   2) Tablolar zaten `IF OBJECT_ID ... IS NULL CREATE TABLE` - var olan
 *      tabloya DOKUNULMAZ, veri silinmez.
 * Shard adi da sabit degil: dosyadaki SRO_VT_SHARD, config.json'daki
 * sql.databases.shard ile degistirilir (ctx.SHARD).
 */
export function semaMetniHazirla(ham, shardDb) {
  /* BASTAKI YORUMLARI SOY: toplu isler `/* ... *​/` bloklariyla basliyor ve
     hem "DROP mu?" testi hem `^CREATE PROCEDURE` degistirmesi metnin GERCEK
     ilk ifadesine bakmali. Yorumlar zaten calistirilacak bir sey degil. */
  const soy = (s) => {
    let t = s.trim();
    for (;;) {
      const y = t.replace(/^\/\*[\s\S]*?\*\/\s*/, '').replace(/^--[^\n]*\n\s*/, '');
      if (y === t) return t;
      t = y;
    }
  };
  return String(ham)
    .split(/^\s*GO\s*$/mi)                      // sqlcmd toplu-is ayraci
    .map(soy)
    .filter(Boolean)                            // yalniz-yorum toplu isleri at
    /* `USE <db>` gereksiz (havuz zaten SRO_WEB_GAME'e bagli) ve mssql
       surucusunde toplu-is baglamini bozar. */
    .filter((s) => !/^USE\s+/i.test(s))
    /* DROP iceren toplu isler ATLANIR (bkz. kural 1). Yordamin GOVDESINDEKI
       DELETE'ler bunun disinda: onlar CREATE PROCEDURE toplu isinin icinde
       ve calistirilmiyor, yalnizca TANIMLANIYOR. */
    .filter((s) => !/^IF\s+OBJECT_ID\([^)]*\)\s+IS\s+NOT\s+NULL\s+DROP\b/i.test(s))
    .map((s) => s.replace(/^CREATE\s+PROCEDURE\b/i, 'CREATE OR ALTER PROCEDURE'))
    .map((s) => s.replace(/SRO_VT_SHARD\.dbo\./g, `${shardDb}.dbo.`));
}

function kaliciKur(web, sql, log) {
  const yok = async () => null;
  if (!web || !sql) {
    return {
      etkin: false, semaKur: async () => false, yukle: yok, loncaYaz: yok,
      loncaSil: yok, uyeYaz: yok, uyeSil: yok, basvuruYaz: yok, kasaYaz: yok,
      kayitEkle: yok, cezaYaz: yok,
    };
  }
  const cagir = async (yordam, kur) => {
    try {
      const r = web.request();
      kur(r);
      return await r.execute(yordam);
    } catch (e) {
      log(`lonca SQL hatasi (${yordam}): ${String(e.message).slice(0, 160)}`);
      return null;
    }
  };
  return {
    etkin: true,
    /** Tablolari/yordamlari EKLEMELI olarak kurar. Yalniz bir kez calisir. */
    semaKur: async (shardDb) => {
      const dosya = SEMA_SQL;
      if (!fs.existsSync(dosya)) {
        log(`lonca: sema dosyasi yok (${dosya}) - kalicilik kapali kalacak`);
        return false;
      }
      const parcalar = semaMetniHazirla(fs.readFileSync(dosya, 'utf8'), shardDb);
      let n = 0;
      for (const p of parcalar) {
        try { await web.request().batch(p); n++; }
        catch (e) {
          log(`lonca sema hatasi (${p.slice(0, 60).replace(/\s+/g, ' ')}...): ` +
              String(e.message).slice(0, 160));
          return false;
        }
      }
      log(`lonca semasi hazir (${n} toplu is; DROP calistirilmadi)`);
      return true;
    },
    yukle: () => cagir('WebLoadGuilds', () => {}),
    loncaYaz: (g) => cagir('WebSaveGuild', (r) => r
      .input('GuildID', sql.Int, Number(g.id) || 0)
      .input('Name', sql.NVarChar(16), g.name)
      .input('NameKey', sql.NVarChar(16), g.name.toLowerCase())
      .input('Lvl', sql.Int, g.level)
      .input('Xp', sql.Int, g.xp)
      .input('Rating', sql.Int, g.rating)
      .input('Notice', sql.NVarChar(500), g.notice)
      .input('MasterCharID', sql.Int, Number(g.masterId) || 0)
      .input('Gold', sql.BigInt, g.gold)
      .input('CreatedAt', sql.BigInt, g.createdAt)),
    loncaSil: (id) => cagir('WebDeleteGuild', (r) =>
      r.input('GuildID', sql.Int, Number(id) || 0)),
    uyeYaz: (gid, u) => cagir('WebSaveGuildMember', (r) => r
      .input('GuildID', sql.Int, Number(gid) || 0)
      .input('CharID', sql.Int, Number(u.charId) || 0)
      .input('Rank', sql.VarChar(8), u.rank)
      .input('Perms', sql.Int, u.perms)
      .input('ContributedXp', sql.Int, u.contributedXp)
      .input('JoinedAt', sql.BigInt, u.joinedAt)),
    uyeSil: (charId) => cagir('WebDeleteGuildMember', (r) =>
      r.input('CharID', sql.Int, Number(charId) || 0)),
    basvuruYaz: (gid, charId, at, sil) => cagir('WebSetGuildApplication', (r) => r
      .input('GuildID', sql.Int, Number(gid) || 0)
      .input('CharID', sql.Int, Number(charId) || 0)
      .input('AppliedAt', sql.BigInt, at ?? 0)
      .input('Remove', sql.Bit, sil ? 1 : 0)),
    kasaYaz: (gid, slot, yigin) => cagir('WebSetGuildChestSlot', (r) => r
      .input('GuildID', sql.Int, Number(gid) || 0)
      .input('Slot', sql.Int, slot)
      .input('StackJson', sql.NVarChar(sql.MAX), yigin ? JSON.stringify(yigin) : null)),
    kayitEkle: (gid, k) => cagir('WebAddGuildLog', (r) => r
      .input('GuildID', sql.Int, Number(gid) || 0)
      .input('At', sql.BigInt, k.at)
      .input('ActorName', sql.NVarChar(64), k.actorName)
      .input('Action', sql.VarChar(16), k.action)
      .input('ItemDefId', sql.VarChar(64), k.itemDefId ?? null)
      .input('Quantity', sql.Int, k.quantity ?? null)
      .input('Gold', sql.BigInt, k.gold ?? null)),
    cezaYaz: (charId, until) => cagir('WebSetGuildPenalty', (r) => r
      .input('CharID', sql.Int, Number(charId) || 0)
      .input('Until', sql.BigInt, until)),
  };
}

/* ================================================ ORNEK OMRU / DEVIR DEFTERLERI
 * server.js `sistemleriKur()` (server.js:1337) SISTEMLER dizisini bosaltip TUM
 * modulleri bastan kuruyor; admin panelinden bir ayar degistirildiginde de
 * calisiyor. Loncalar kur() ICINDEKI Map'lerde dursaydi o anda LONCA, UYE
 * LISTESI, KASA, BASVURU ve CEZA tumden silinirdi (DB'den yeniden yukleme
 * ASENKRON, arada bir pencere kalir; DB kapaliyken ise kalici kayip).
 * Bu yuzden defterler MODUL KAPSAMINDA. Kalibi kardes moduller de kullaniyor:
 * sistem_dirilis-unique.js:207 ONCEKI_DURUM, sistem_binek-pet.js:152. */
const LONCALAR = new Map();      // id -> lonca
const AD_INDEKS = new Map();     // ad(kucuk harf) -> id
const UYE_INDEKS = new Map();    // charId -> loncaId
const CEZALAR = new Map();       // charId -> cezaBitis(ms)
/** Sema kurulumu + DB yuklemesi SUREC BASINA bir kez. */
let ACILIS_SOZU = null;

/* ==================================================================== ana modul */

export function kur(ctx = {}) {
  const {
    world = null, frame = () => {}, broadcast = () => {}, log = () => {},
    GCFG = {}, ITEMSTATS = new Map(), envanterPayload = null, web = null,
    sql = null, SHARD = 'SRO_VT_SHARD',
  } = ctx;

  const NPC_MENZIL = GCFG.npcInteractRangeU ?? 25;
  const DAVET_MS = GCFG.partyInviteTimeoutMs ?? 30000;   // pakette lonca karsiligi YOK
  const BASVURU_SINIRI = 5;                              // sunucu politikasi
  const kalici = kaliciKur(web, sql, log);

  /* ---------------------------------------------------------------- durum
   * DORT defter MODUL KAPSAMINDA (yukaridaki devir blogu): yeniden kurulum
   * loncalari silmesin. `davetler` ve `soketler` BILEREK ornek kapsaminda:
   *   - davet = 30 sn'lik gecici teklif (arastirma: "parti daveti / lonca
   *     daveti GECICI"); yeniden kurulumda dusmesi dogru davranis,
   *   - soketler = canli WS baglantilari; yeni ornek onlari girisTamam /
   *     ilk-temas kancasiyla zaten yeniden topluyor. */
  /** id -> lonca */
  const loncalar = LONCALAR;
  /** ad(kucuk harf) -> id */
  const adIndeks = AD_INDEKS;
  /** charId -> loncaId */
  const uyeIndeks = UYE_INDEKS;
  /** charId -> cezaBitis(ms) */
  const cezalar = CEZALAR;
  /** charId -> { guildId, fromName, expiresAt } */
  const davetler = new Map();
  /** charId -> ws (cevrimici oyuncular; girisTamam/cikis ile beslenir) */
  const soketler = new Map();
  let sonrakiBellekId = 1;
  for (const id of loncalar.keys()) sonrakiBellekId = Math.max(sonrakiBellekId, Number(id) + 1);

  /* -------------------------------------------------------- soket bulucular */
  /** Soket hala yazilabilir mi? server.js'teki frame() ile AYNI kosul:
   *  `ws.readyState === ws.OPEN`. readyState'i olmayan sahte soketleri
   *  (birim testi) acik sayiyoruz. */
  function acikMi(ws) {
    if (!ws) return false;
    if (ws.readyState === undefined || ws.OPEN === undefined) return true;
    return ws.readyState === ws.OPEN;
  }

  /** world.zoneState uzerinden TUM cevrimici soketleri gez (salt okuma).
   *  KAPALI soketler atlanir - yoksa `cikis()` cagrilmayan bir kurulumda
   *  koparan oyuncu sonsuza kadar "cevrimici" gorunur. */
  function* tumSoketler() {
    for (const ws of soketler.values()) if (acikMi(ws)) yield ws;
    if (!world?.zoneState) return;
    for (const z of world.zoneState.values()) {
      for (const c of z.players ?? []) {
        if (c?.char?.id && !soketler.has(String(c.char.id)) && acikMi(c)) yield c;
      }
    }
  }
  function soketBul(charId) {
    const anahtar = kimlik(charId);
    const dogrudan = soketler.get(anahtar);
    if (dogrudan) {
      if (acikMi(dogrudan)) return dogrudan;
      soketler.delete(anahtar);            // olu kaydi budad: harita sismesin
    }
    for (const ws of tumSoketler()) if (kimlik(ws.char?.id) === anahtar) return ws;
    return null;
  }
  const cevrimici = (charId) => soketBul(charId) !== null;

  /* -------------------------------------------------------------- lonca API */
  const loncaOf = (charId) => loncalar.get(uyeIndeks.get(kimlik(charId))) ?? null;
  /** Master TUM yetkilere sahiptir (istemci de master'i ayrica ozel tutuyor). */
  const yetkili = (uye, bit) =>
    !!uye && (uye.rank === 'master' || (uye.perms & bit) !== 0);

  function cezaliMi(charId) {
    const t = cezalar.get(kimlik(charId));
    if (!t) return false;
    if (t <= simdi()) { cezalar.delete(kimlik(charId)); return false; }
    return true;
  }

  /* ------------------------------------------------------------- kare uretim */
  function bildir(ws, key, params) {
    // sys.notice (195): key ZORUNLU ve Tht enum'undan; params opsiyonel.
    frame(ws, 'sys.notice', params ? { key, params } : { key });
  }
  function protokolHatasi(ws, t, neden) {
    // err (240): code Sht enum'undan. Lonca anahtari Eht'de olmadigi icin `key` YOK.
    frame(ws, 'err', { code: 'ERR_VALIDATION', msg: `${t}: ${neden}`.slice(0, 200) });
  }

  /** guild.state (163) — DAIMA TAM kare (istemci magazayi tamamen degistiriyor). */
  function durumPayload(lonca, charId) {
    /* Loncasizken canli referans oyun yakalamasi (GERCEK/zone_init.json) TAM olarak
       {"guild":null} yolluyor - digerleri .optional() ve istemcinin setState'i
       guild null iken zaten hepsini bosaltiyor. Birebir ayni kareyi uretiyoruz. */
    if (!lonca) return { guild: null };
    const ben = lonca.uyeler.get(kimlik(charId)) ?? null;
    const satir = seviyeSatiri(lonca.level);
    const gorebilir = yetkili(ben, YETKI.INVITE);
    return {
      guild: {
        id: lonca.id, name: lonca.name, level: lonca.level, xp: lonca.xp,
        nextLevelXp: sonrakiSeviyeXp(lonca.level), rating: lonca.rating,
        notice: lonca.notice, masterId: lonca.masterId, memberCap: satir.memberCap,
      },
      members: [...lonca.uyeler.values()].map((u) => {
        const m = {
          charId: u.charId, name: u.name, level: u.level, rank: u.rank,
          perms: u.rank === 'master' ? YETKI_HEPSI : u.perms,
          online: cevrimici(u.charId), contributedXp: u.contributedXp,
        };
        if (u.race) m.race = u.race;          // .optional(): yoksa anahtari koyma
        return m;
      }),
      myPerms: ben ? (ben.rank === 'master' ? YETKI_HEPSI : ben.perms) : 0,
      // Basvurular sadece davet yetkisi olana gonderilir (istemci sekmeyi de
      // ayni kosulla aciyor: master || perms & INVITE).
      applications: gorebilir
        ? [...lonca.basvurular.values()].map((b) => ({
            charId: b.charId, name: b.name, level: b.level, at: b.at }))
        : [],
    };
  }

  function durumGonder(charId) {
    const ws = soketBul(charId);
    if (!ws) return false;
    frame(ws, 'guild.state', durumPayload(loncaOf(charId), charId));
    return true;
  }
  /** Tum uyelere KISIYE OZEL guild.state gonder (myPerms/applications farkli).
   *  `haricCharId` verilirse o uye atlanir - girisTamam kendi karesini zaten
   *  ayrica yolluyor, iki kez gondermek giris batch'ini sisiriyordu. */
  function durumYayinla(lonca, haricCharId) {
    if (!lonca) return 0;
    const haric = haricCharId === undefined ? null : kimlik(haricCharId);
    let n = 0;
    for (const u of lonca.uyeler.values()) {
      if (haric !== null && u.charId === haric) continue;
      if (durumGonder(u.charId)) n++;
    }
    return n;
  }
  /** Tum uyelere ayni sys.notice. */
  function loncayaBildir(lonca, key, params, haricCharId) {
    if (!lonca) return;
    for (const u of lonca.uyeler.values()) {
      if (haricCharId && u.charId === kimlik(haricCharId)) continue;
      const ws = soketBul(u.charId);
      if (ws) bildir(ws, key, params);
    }
  }
  /**
   * FARK #1/#181 (capraz istek 51/65) - LONCA SOHBET KANCASI.
   * sistem_parti.js kanalaYayinla ile AYNI imza: gonderen DAHIL kac soket
   * kare aldiysa o sayi doner; loncasiz oyuncuda 0. server.js chat.send'in
   * `guild` dali bunu tuketiyor (kanca yokken yalniz-gonderen yansimasina
   * dusuyordu). Istemci kendi satirini YEREL EKLEMEZ (@27378460) - gonderen
   * kareyi MUTLAKA almali (gonderenHaric varsayilani false).
   * NOT: loncasiz oyuncu icin sunucu SESSIZ kalir - Tht enum'unda
   * sys.guild.not_in_* ANAHTARI YOK (dogrulandi), anahtar uydurulmuyor.
   */
  function kanalaYayinla(ws, tip, veri, { gonderenHaric = false } = {}) {
    const lonca = ws?.char?.id != null ? loncaOf(ws.char.id) : null;
    if (!lonca) return 0;
    let n = 0;
    for (const u of lonca.uyeler.values()) {
      const soket = soketBul(u.charId);
      if (!soket) continue;
      if (gonderenHaric && soket === ws) continue;
      frame(soket, tip, veri); n++;
    }
    return n;
  }

  /** entity.guild (172) — bolgedeki herkese isim rozetini bildir. */
  function rozetYayinla(ws, ad) {
    if (!ws?.zoneId || !ws.entityId) return;
    const kare = { id: ws.entityId, guild: ad ?? null };
    frame(ws, 'entity.guild', kare);
    broadcast(ws.zoneId, 'entity.guild', kare, ws);
    if (ws.char) ws.char.guildAd = ad ?? null;   // entityPayload icin
  }

  function kayitEkle(lonca, actorName, action, ek = {}) {
    if (!KAYIT_EYLEMLERI.includes(action)) return null;   // istemci tanimaz
    const k = { at: simdi(), actorName: String(actorName ?? ''), action };
    if (ek.itemDefId) k.itemDefId = String(ek.itemDefId);
    if (typeof ek.quantity === 'number') k.quantity = Math.trunc(ek.quantity);
    if (typeof ek.gold === 'number') k.gold = Math.trunc(ek.gold);
    lonca.kayit.unshift(k);                    // en yeni basta
    if (lonca.kayit.length > 500) lonca.kayit.length = 500;
    kalici.kayitEkle(lonca.id, k);
    return k;
  }

  /* -------------------------------------------------------- seviye ilerlemesi */
  function seviyeKontrol(lonca) {
    let yukseldi = false;
    while (lonca.level < ENUST_SEVIYE && lonca.xp >= SEVIYE_TABLOSU[lonca.level].cumXp) {
      lonca.level++;
      yukseldi = true;
      kayitEkle(lonca, lonca.name, 'level_up');
      loncayaBildir(lonca, 'sys.guild.level_up', { level: lonca.level });
    }
    if (yukseldi) kalici.loncaYaz(lonca);
    return yukseldi;
  }

  /** Disaridan cagrilir: uyenin katkisi + lonca xp'si. (Pakette bunu tetikleyen
   *  bir c2s mesaji YOK - av/gorev tarafi bagladiginda calisir.) */
  function katkiEkle(charOrId, xp) {
    const n = Math.trunc(Number(xp) || 0);
    if (n <= 0) return false;
    const charId = kimlik(typeof charOrId === 'object' ? charOrId?.id : charOrId);
    const lonca = loncaOf(charId);
    if (!lonca) return false;
    const uye = lonca.uyeler.get(charId);
    if (uye) { uye.contributedXp += n; kalici.uyeYaz(lonca.id, uye); }
    lonca.xp += n;
    kalici.loncaYaz(lonca);
    seviyeKontrol(lonca);
    durumYayinla(lonca);
    return true;
  }

  function puanAyarla(loncaId, puan) {
    const lonca = loncalar.get(kimlik(loncaId));
    if (!lonca) return false;
    lonca.rating = Math.trunc(Number(puan) || 0);
    kalici.loncaYaz(lonca);
    durumYayinla(lonca);
    return true;
  }

  /* ------------------------------------------------------------- uye kayitlari */
  function uyeKaydi(ch, rank, perms) {
    return {
      charId: kimlik(ch.id), name: String(ch.name ?? ''), level: ch.level ?? 1,
      rank, perms, contributedXp: 0, joinedAt: simdi(),
      race: ch.race ? String(ch.race) : null,
    };
  }

  function loncayaAl(lonca, ch) {
    const u = uyeKaydi(ch, 'recruit', 0);
    lonca.uyeler.set(u.charId, u);
    uyeIndeks.set(u.charId, lonca.id);
    lonca.basvurular.delete(u.charId);
    kalici.uyeYaz(lonca.id, u);
    kalici.basvuruYaz(lonca.id, u.charId, 0, true);
    kayitEkle(lonca, u.name, 'join');
    const ws = soketBul(u.charId);
    if (ws) {
      bildir(ws, 'sys.guild.joined', { name: lonca.name });
      rozetYayinla(ws, lonca.name);
    }
    loncayaBildir(lonca, 'sys.guild.member_joined', { name: u.name }, u.charId);
    durumYayinla(lonca);
    return u;
  }

  /** Uyeyi cikar. sebep: 'left' | 'kicked' | 'disbanded' */
  function loncadanCikar(lonca, charId, sebep) {
    const anahtar = kimlik(charId);
    const u = lonca.uyeler.get(anahtar);
    if (!u) return null;
    lonca.uyeler.delete(anahtar);
    uyeIndeks.delete(anahtar);
    kalici.uyeSil(anahtar);

    /* Ceza SADECE kendi ayrilmasinda. Sema penaltyUntil'i opsiyonel yapmis
       ve locale metni "Yakın zamanda bir loncadan AYRILDIN" diyor - atilan ya da
       loncasi dagilan oyuncu cezalandirilmaz. */
    let ceza;
    if (sebep === 'left') {
      ceza = simdi() + CEZA_MS;
      cezalar.set(anahtar, ceza);
      kalici.cezaYaz(anahtar, ceza);
    }
    const ws = soketBul(anahtar);
    if (ws) {
      frame(ws, 'guild.left', ceza ? { reason: sebep, penaltyUntil: ceza } : { reason: sebep });
      frame(ws, 'guild.state', { guild: null });
      if (ws.char) ws.char.guildPenaltyUntil = ceza ?? ws.char.guildPenaltyUntil ?? null;
      rozetYayinla(ws, null);
    }
    return u;
  }

  /* ------------------------------------------------------------------- kasa */
  const kasaKapasitesi = (lonca) => seviyeSatiri(lonca.level).bankSlots;

  function kasaPayload(lonca) {
    const items = [];
    for (const [slot, yigin] of lonca.kasa) {
      if (yigin) items.push({ slot, stack: yiginKopya(yigin) });
    }
    items.sort((a, b) => a.slot - b.slot);
    return { gold: Math.trunc(lonca.gold), capacity: kasaKapasitesi(lonca), items };
  }
  /** Kasayi acik tutan herkese guncel kareyi yolla (istemcide magaza tek kaynak). */
  function kasaYayinla(lonca) {
    if (!lonca) return;
    const kare = kasaPayload(lonca);
    for (const u of lonca.uyeler.values()) {
      const ws = soketBul(u.charId);
      if (ws && ws.loncaKasasi) frame(ws, 'guild.bankState', kare);
    }
  }
  /* ----------------------------------------------------- kasa yazim sagligi
   * Kasa yuvasi yazimlari "atesle-unut" idi: SQL hatasinda bellek ile
   * veritabani SESSIZCE ayrisiyor, oyuncuya hicbir sey soylenmiyordu.
   * Eht (err.key) enum'unda bu duruma ayrilmis anahtar VAR:
   *   err.busy.guild_bank  (paket @25607034, Eht listesi)
   *   tr.json: "Lonca kasasi mesgul - yeniden dene."
   * Kod ERR_BUSY (Sht enum'u, paket @25603148). Ayni desen sunucuda zaten
   * iki yerde var: sistem_banka-depo.js (err.busy.bank) ve
   * sistem_borsa.js (err.busy.exchange).
   *
   * KAPI YALNIZ HATA DURUMUNDA calisir. "Ucusta bir yazim var" diye
   * reddetmiyoruz: kasada arka arkaya esya tasiyan uye her seferinde
   * reddedilirdi ve bugun calisan davranis bozulurdu.
   *
   * KURTARMA: yazilamamis yuvalar kuyruga alinir ve periyodik olarak
   * yeniden denenir; hepsi yazilinca kilit acilir. Deneme araligi
   * SUNUCU POLITIKASIDIR - pakette ya da json'da karsiligi yok
   * (BASVURU_SINIRI gibi). */
  const KASA_YENIDEN_DENE_MS = 5000;
  /** loncaId -> Set<slot>  (veritabanina yazilamamis yuvalar) */
  const kasaBekleyen = new Map();

  /** Kasa yazimi saglikli mi? (bellek modunda daima saglikli) */
  const kasaSaglikli = (loncaId) => !kasaBekleyen.get(String(loncaId))?.size;

  function kasaYazDene(lonca, slot) {
    const gid = String(lonca.id);
    /* kaliciKur().cagir() hata halinde null, basarida sonuc nesnesi doner. */
    Promise.resolve(kalici.kasaYaz(lonca.id, slot, lonca.kasa.get(slot) ?? null))
      .then((r) => {
        if (r === null) {
          let kume = kasaBekleyen.get(gid);
          if (!kume) { kume = new Set(); kasaBekleyen.set(gid, kume); }
          if (!kume.has(slot)) {
            kume.add(slot);
            log(`lonca: kasa yazimi BASARISIZ (gid=${gid}, slot=${slot}) - kasa kilitlendi`);
          }
          return;
        }
        const kume = kasaBekleyen.get(gid);
        if (!kume) return;
        kume.delete(slot);
        if (!kume.size) { kasaBekleyen.delete(gid); log(`lonca: kasa yazimi duzeldi (gid=${gid})`); }
      })
      .catch((e) => log(`lonca: kasa yazimi istisnasi (gid=${gid}, slot=${slot}): ${String(e?.message ?? e).slice(0, 120)}`));
  }

  function kasaYaz(lonca, slot) {
    // Bellek modunda (web/sql yok) yazilacak bir sey yok; saglik da izlenmez.
    if (!kalici.etkin) return;
    kasaYazDene(lonca, slot);
  }

  /** Yazilamamis yuvalari yeniden dene - kilidin tek acilma yolu. */
  const kasaSayaci = setInterval(() => {
    for (const [gid, kume] of [...kasaBekleyen]) {
      const lonca = loncalar.get(gid);
      if (!lonca) { kasaBekleyen.delete(gid); continue; }
      for (const slot of [...kume]) kasaYazDene(lonca, slot);
    }
  }, KASA_YENIDEN_DENE_MS);
  if (typeof kasaSayaci.unref === 'function') kasaSayaci.unref();

  /** NPC dogrulama: depo NPC'si mi, oyuncunun bolgesinde mi, menzilde mi. */
  function npcGecerli(ws, npcId) {
    if (!BANKA_NPCLERI.has(npcId)) return false;
    /* MADDE 45: menzil NPC BASINA. Kayitta interactRangeU yoksa (0) yedek
       olarak game-config.npcInteractRangeU kullanilir - istemcinin Ict()
       varsayilaniyla ayni. */
    const menzil = BANKA_NPCLERI.get(npcId) || NPC_MENZIL;
    const bolgeler = world?.worldData?.zones ?? null;
    /* Dunya verisi HIC yoksa (sade ctx) menzil olculemez - gecir.
       Ama veri VARSA ve bolge taninmiyorsa REDDET: eskiden burada `return true`
       vardi, yani uydurma bir zoneId ile menzil kontrolu tamamen atlanabiliyordu. */
    if (!bolgeler) return true;
    const zon = bolgeler[ws.zoneId];
    if (!zon) return false;
    let enYakin = Infinity;
    for (const n of zon.npcs ?? []) {
      if (n.npcId !== npcId) continue;
      const dx = (n.x ?? 0) - (ws.char.x ?? 0);
      const dz = (n.z ?? 0) - (ws.char.z ?? 0);
      enYakin = Math.min(enYakin, Math.hypot(dx, dz));
    }
    if (enYakin === Infinity) return false;      // bu bolgede yok
    return enYakin <= menzil;
  }

  function cantaYuvalari(ch) {
    return Array.isArray(ch.bag) ? ch.bag : (ch.bag = new Array(GCFG.bagSlots ?? 32).fill(null));
  }
  const yiginMax = (itemId) => Math.max(1, ITEMSTATS?.get?.(itemId)?.stackMax ?? 1);

  function envanterGonder(ws) {
    if (envanterPayload) frame(ws, 'inv.update', envanterPayload(ws.char));
  }

  /* ================================================================== 121 create */
  function create(ws, d) {
    const ch = ws.char;
    const ad = d.name.trim();
    if (loncaOf(ch.id)) return bildir(ws, 'sys.guild.join_failed_in_guild');
    if (cezaliMi(ch.id)) return bildir(ws, 'sys.guild.join_failed_penalty');
    if (!adGecerliMi(ad)) return bildir(ws, 'sys.guild.name_invalid');
    if (adIndeks.has(ad.toLowerCase())) return bildir(ws, 'sys.guild.name_taken');

    const id = String(sonrakiBellekId++);
    const master = uyeKaydi(ch, 'master', YETKI_HEPSI);
    const lonca = {
      id, name: ad, level: 1, xp: 0, rating: 0, notice: '',
      masterId: master.charId, gold: 0, createdAt: simdi(),
      uyeler: new Map([[master.charId, master]]),
      basvurular: new Map(), kasa: new Map(), kayit: [],
    };
    loncalar.set(id, lonca);
    adIndeks.set(ad.toLowerCase(), id);
    uyeIndeks.set(master.charId, id);
    // Bu oyuncunun baska loncalara acik basvurulari varsa temizle.
    for (const g of loncalar.values()) {
      if (g !== lonca && g.basvurular.delete(master.charId)) {
        kalici.basvuruYaz(g.id, master.charId, 0, true);
        durumYayinla(g);
      }
    }
    kalici.loncaYaz(lonca);
    kalici.uyeYaz(id, master);
    kayitEkle(lonca, master.name, 'create');
    bildir(ws, 'sys.guild.created', { name: ad });
    durumGonder(ch.id);
    rozetYayinla(ws, ad);
    log(`lonca kuruldu: "${ad}" (id ${id}) lider ${master.name}`);
  }

  /* ================================================================== 122 manage */
  function manage(ws, d) {
    const ch = ws.char;
    const benimId = kimlik(ch.id);
    const lonca = loncaOf(benimId);
    const ben = lonca?.uyeler.get(benimId) ?? null;

    switch (d.op) {
      /* ------------------------------------------------------------- invite */
      case 'invite': {
        if (!lonca) return bildir(ws, 'sys.guild.no_permission');
        if (!yetkili(ben, YETKI.INVITE)) return bildir(ws, 'sys.guild.no_permission');
        if (lonca.uyeler.size >= seviyeSatiri(lonca.level).memberCap) {
          return bildir(ws, 'sys.guild.join_failed_full');
        }
        // targetId = AYNI BOLGEDEKI oyuncu varlik kimligi (istemci node.id yolluyor)
        let hedef = null;
        for (const c of world?.bolgeOyunculari?.(ws.zoneId) ?? []) {
          if (c.entityId === d.targetId && c.char) { hedef = c; break; }
        }
        if (!hedef) return frame(ws, 'err', { code: 'ERR_NOT_FOUND' });
        const hid = kimlik(hedef.char.id);
        if (hid === benimId) return frame(ws, 'err', { code: 'ERR_NOT_FOUND' });
        if (loncaOf(hid)) return bildir(ws, 'sys.guild.join_failed_in_guild');
        if (cezaliMi(hid)) return bildir(ws, 'sys.guild.join_failed_penalty');

        /* Ic kayitta davetcinin KIMLIGI de tutulur (ad esitligi ile aramak
           kirilgan). Tel uzerine giden kare semadaki 4 alanla SINIRLI kurulur -
           `guild.invited` semasinda fazladan alan yok. */
        const davet = {
          guildId: lonca.id, guildName: lonca.name, fromName: String(ch.name ?? ''),
          expiresAt: simdi() + DAVET_MS, davetciId: benimId,
        };
        davetler.set(hid, davet);
        frame(hedef, 'guild.invited', {
          guildId: davet.guildId, guildName: davet.guildName,
          fromName: davet.fromName, expiresAt: davet.expiresAt,
        });
        bildir(ws, 'sys.guild.invite_sent', { name: hedef.char.name });
        return;
      }

      /* ------------------------------------------------------------ respond */
      case 'respond': {
        const davet = davetler.get(benimId);
        davetler.delete(benimId);
        if (!davet || davet.expiresAt < simdi()) return;   // sessizce dus
        const hedefLonca = loncalar.get(davet.guildId);
        if (!hedefLonca) return;
        const davetciWs = davet.davetciId
          ? soketBul(davet.davetciId)
          : ([...tumSoketler()].find((c) => c.char?.name === davet.fromName) ?? null);
        if (!d.accept) {
          if (davetciWs) bildir(davetciWs, 'sys.guild.invite_declined', { name: ch.name });
          return;
        }
        if (loncaOf(benimId)) return bildir(ws, 'sys.guild.join_failed_in_guild');
        if (cezaliMi(benimId)) return bildir(ws, 'sys.guild.join_failed_penalty');
        if (hedefLonca.uyeler.size >= seviyeSatiri(hedefLonca.level).memberCap) {
          return bildir(ws, 'sys.guild.join_failed_full');
        }
        loncayaAl(hedefLonca, ch);
        return;
      }

      /* -------------------------------------------------------------- leave */
      case 'leave': {
        if (!lonca || !ben) return;
        if (ben.rank === 'master') return bildir(ws, 'sys.guild.master_cannot_leave');
        const u = loncadanCikar(lonca, benimId, 'left');
        if (!u) return;
        kayitEkle(lonca, u.name, 'leave');
        loncayaBildir(lonca, 'sys.guild.member_left', { name: u.name });
        durumYayinla(lonca);
        return;
      }

      /* --------------------------------------------------------------- kick */
      case 'kick': {
        if (!lonca || !ben) return bildir(ws, 'sys.guild.no_permission');
        const hedef = lonca.uyeler.get(kimlik(d.charId));
        if (!hedef) return frame(ws, 'err', { code: 'ERR_NOT_FOUND' });
        if (hedef.charId === benimId) return bildir(ws, 'sys.guild.no_permission');
        // Istemci ile ayni kural: KICK yetkisi + hedef benden DAHA DUSUK rutbe.
        if (!yetkili(ben, YETKI.KICK) || rutbeSira(hedef.rank) <= rutbeSira(ben.rank)) {
          return bildir(ws, 'sys.guild.no_permission');
        }
        loncadanCikar(lonca, hedef.charId, 'kicked');
        kayitEkle(lonca, ch.name, 'kick');
        loncayaBildir(lonca, 'sys.guild.member_kicked', { name: hedef.name });
        durumYayinla(lonca);
        return;
      }

      /* ------------------------------------------------------------ setRank */
      case 'setRank': {
        if (!lonca || ben?.rank !== 'master') return bildir(ws, 'sys.guild.no_permission');
        const hedef = lonca.uyeler.get(kimlik(d.charId));
        if (!hedef) return frame(ws, 'err', { code: 'ERR_NOT_FOUND' });
        if (hedef.rank === 'master') return bildir(ws, 'sys.guild.no_permission');
        if (hedef.rank === d.rank) return;
        const yukseldi = rutbeSira(d.rank) < rutbeSira(hedef.rank);
        hedef.rank = d.rank;
        kalici.uyeYaz(lonca.id, hedef);
        kayitEkle(lonca, ch.name, yukseldi ? 'promote' : 'demote');
        /* {rank} yer tutucusu: q5() rutbe icin bir esleme YAPMIYOR, params degeri
           oldugu gibi yaziliyor. Bu yuzden ham enum degeri gonderiliyor. */
        loncayaBildir(lonca, yukseldi ? 'sys.guild.promoted' : 'sys.guild.demoted',
          { name: hedef.name, rank: hedef.rank });
        durumYayinla(lonca);
        return;
      }

      /* ----------------------------------------------------------- setPerms */
      case 'setPerms': {
        if (!lonca || ben?.rank !== 'master') return bildir(ws, 'sys.guild.no_permission');
        const hedef = lonca.uyeler.get(kimlik(d.charId));
        if (!hedef) return frame(ws, 'err', { code: 'ERR_NOT_FOUND' });
        if (hedef.rank === 'master') return bildir(ws, 'sys.guild.no_permission');
        if (hedef.perms === d.perms) return;
        hedef.perms = d.perms;
        kalici.uyeYaz(lonca.id, hedef);
        kayitEkle(lonca, ch.name, 'perms');
        durumYayinla(lonca);
        return;
      }

      /* ------------------------------------------------------------- notice */
      case 'notice': {
        if (!lonca || !yetkili(ben, YETKI.NOTICE)) return bildir(ws, 'sys.guild.no_permission');
        lonca.notice = d.text;
        kalici.loncaYaz(lonca);
        kayitEkle(lonca, ch.name, 'notice');
        bildir(ws, 'sys.guild.notice_updated');
        durumYayinla(lonca);
        return;
      }

      /* ----------------------------------------------------------- transfer */
      case 'transfer': {
        if (!lonca || ben?.rank !== 'master') return bildir(ws, 'sys.guild.no_permission');
        const hedef = lonca.uyeler.get(kimlik(d.charId));
        if (!hedef || hedef.charId === benimId) return frame(ws, 'err', { code: 'ERR_NOT_FOUND' });
        hedef.rank = 'master';
        hedef.perms = YETKI_HEPSI;
        ben.rank = 'officer';        // master alti en yuksek rutbe (sunucu politikasi)
        ben.perms = YETKI_HEPSI;
        lonca.masterId = hedef.charId;
        kalici.uyeYaz(lonca.id, hedef);
        kalici.uyeYaz(lonca.id, ben);
        kalici.loncaYaz(lonca);
        kayitEkle(lonca, ch.name, 'transfer');
        loncayaBildir(lonca, 'sys.guild.transfer_done', { name: hedef.name });
        durumYayinla(lonca);
        return;
      }

      /* ------------------------------------------------------------ disband */
      case 'disband': {
        if (!lonca || ben?.rank !== 'master') return bildir(ws, 'sys.guild.no_permission');
        if (lonca.uyeler.size > 1) return bildir(ws, 'sys.guild.disband_members_remain');
        const kasaDolu = lonca.gold > 0 || [...lonca.kasa.values()].some(Boolean);
        if (kasaDolu) return bildir(ws, 'sys.guild.disband_bank_not_empty');

        kayitEkle(lonca, ch.name, 'disband');
        // Kalan tek uye (lider) - ceza YOK, sema penaltyUntil'i gondermiyoruz.
        loncadanCikar(lonca, benimId, 'disbanded');
        // Acik basvurulari olan oyunculara rehber tazelemesi icin durum yollamak
        // gerekmiyor; basvurular loncayla birlikte yok oluyor.
        loncalar.delete(lonca.id);
        adIndeks.delete(lonca.name.toLowerCase());
        kalici.loncaSil(lonca.id);
        bildir(ws, 'sys.guild.disbanded');
        log(`lonca dagitildi: "${lonca.name}" (id ${lonca.id})`);
        return;
      }

      /* -------------------------------------------------------------- apply */
      case 'apply': {
        if (loncaOf(benimId)) return bildir(ws, 'sys.guild.join_failed_in_guild');
        if (cezaliMi(benimId)) return bildir(ws, 'sys.guild.join_failed_penalty');
        const hedefLonca = loncalar.get(kimlik(d.guildId));
        if (!hedefLonca) return frame(ws, 'err', { code: 'ERR_NOT_FOUND' });
        if (hedefLonca.basvurular.has(benimId)) return;          // zaten basvurmus
        let acik = 0;
        for (const g of loncalar.values()) if (g.basvurular.has(benimId)) acik++;
        if (acik >= BASVURU_SINIRI) return bildir(ws, 'sys.guild.apply_limit');

        const b = { charId: benimId, name: ch.name, level: ch.level ?? 1, at: simdi() };
        hedefLonca.basvurular.set(benimId, b);
        kalici.basvuruYaz(hedefLonca.id, benimId, b.at, false);
        bildir(ws, 'sys.guild.apply_sent', { name: hedefLonca.name });
        durumYayinla(hedefLonca);
        return;
      }

      /* --------------------------------------------------------- applyCancel */
      case 'applyCancel': {
        const hedefLonca = loncalar.get(kimlik(d.guildId));
        if (!hedefLonca) return;
        if (!hedefLonca.basvurular.delete(benimId)) return;
        kalici.basvuruYaz(hedefLonca.id, benimId, 0, true);
        durumYayinla(hedefLonca);
        return;
      }

      /* -------------------------------------------------------- applyRespond */
      case 'applyRespond': {
        if (!lonca || !yetkili(ben, YETKI.INVITE)) return bildir(ws, 'sys.guild.no_permission');
        const basvuru = lonca.basvurular.get(kimlik(d.charId));
        if (!basvuru) return frame(ws, 'err', { code: 'ERR_NOT_FOUND' });
        lonca.basvurular.delete(basvuru.charId);
        kalici.basvuruYaz(lonca.id, basvuru.charId, 0, true);
        if (!d.accept) { durumYayinla(lonca); return; }
        if (lonca.uyeler.size >= seviyeSatiri(lonca.level).memberCap) {
          durumYayinla(lonca);
          return bildir(ws, 'sys.guild.join_failed_full');
        }
        if (loncaOf(basvuru.charId)) { durumYayinla(lonca); return; }
        if (cezaliMi(basvuru.charId)) { durumYayinla(lonca); return; }
        const aday = soketBul(basvuru.charId);
        // Cevrimdisi adayi da alabiliriz - kayittaki ad/seviye yeterli.
        loncayaAl(lonca, aday?.char ?? {
          id: basvuru.charId, name: basvuru.name, level: basvuru.level, race: null,
        });
        return;
      }

      default: return;
    }
  }

  /* ==================================================================== 123 bank */
  function bank(ws, d) {
    const ch = ws.char;
    const benimId = kimlik(ch.id);
    const lonca = loncaOf(benimId);
    const ben = lonca?.uyeler.get(benimId) ?? null;
    if (!lonca) return bildir(ws, 'sys.guild.no_permission');
    if (!npcGecerli(ws, d.npcId)) return frame(ws, 'err', { code: 'ERR_RANGE' });

    /* Kasa yazimi bozukken esya/altin TASIYAN islemler kilitlenir - aksi halde
       bellek ile veritabani ayrisir ve yeniden baslatmada esya kaybolur/cogalir.
       `open` serbest birakilir: oyuncu kasayi gorup durumu anlayabilsin.
       Anahtar err.busy.guild_bank (paket @25607034 Eht listesi; tr.json
       "Lonca kasasi mesgul - yeniden dene."), kod ERR_BUSY (paket @25603148). */
    if (d.op !== 'open' && !kasaSaglikli(lonca.id)) {
      return frame(ws, 'err', { code: 'ERR_BUSY', key: 'err.busy.guild_bank' });
    }

    const cekebilir = yetkili(ben, YETKI.BANK_WITHDRAW);
    const kapasite = kasaKapasitesi(lonca);

    switch (d.op) {
      case 'open': {
        ws.loncaKasasi = lonca.id;
        frame(ws, 'guild.bankState', kasaPayload(lonca));
        return;
      }

      case 'depositGold': {
        // ch.gold bozuksa (NaN/metin) Math.min NaN uretir ve kasaya NaN yazilir;
        // guild.bankState.gold semasi Y().int() - istemci o kareyi ATAR.
        const cepte = tamSayi(ch.gold);
        const tut = Math.min(d.amount, cepte);
        if (tut <= 0) return frame(ws, 'err', { code: 'ERR_NO_GOLD' });
        ch.gold = cepte - tut;
        lonca.gold = tamSayi(lonca.gold) + tut;
        kalici.loncaYaz(lonca);
        kayitEkle(lonca, ch.name, 'deposit_gold', { gold: tut });
        bildir(ws, 'sys.guild.bank_gold_in', { gold: tut });
        envanterGonder(ws);
        kasaYayinla(lonca);
        return;
      }

      case 'withdrawGold': {
        if (!cekebilir) return bildir(ws, 'sys.guild.bank_denied');
        const kasada = tamSayi(lonca.gold);
        const tut = Math.min(d.amount, kasada);
        if (tut <= 0) return frame(ws, 'err', { code: 'ERR_NO_GOLD' });
        /* PP MADDE 3 (changelog 0025): cekim karakter altinini tavanin
           ustune cikaracaksa HICBIR sey tasinmadan acik mesajla reddedilir.
           err.gold_cap yeni istemcinin Eht enum'unda ve tr.json s.145'te
           VAR ({cap} paramli) - buradaki eski "lonca anahtari Eht'de yok"
           kisiti bu anahtar icin gecerli degil. */
        if (tamSayi(ch.gold) + tut > ALTIN_TAVANI) {
          return frame(ws, 'err', { code: 'ERR_VALIDATION',
            key: 'err.gold_cap', params: { cap: ALTIN_TAVANI } });
        }
        lonca.gold = kasada - tut;
        ch.gold = tamSayi(ch.gold) + tut;
        kalici.loncaYaz(lonca);
        kayitEkle(lonca, ch.name, 'withdraw_gold', { gold: tut });
        bildir(ws, 'sys.guild.bank_gold_out', { gold: tut });
        envanterGonder(ws);
        kasaYayinla(lonca);
        return;
      }

      case 'depositItem': {
        const canta = cantaYuvalari(ch);
        if (d.bagSlot >= canta.length) return frame(ws, 'err', { code: 'ERR_VALIDATION' });
        const kaynak = canta[d.bagSlot];
        if (!kaynak) return frame(ws, 'err', { code: 'ERR_NOT_FOUND' });
        const adet = Math.min(d.qty, kaynak.qty ?? 1);
        const enFazla = yiginMax(kaynak.itemId);

        let kalan = adet;
        const degisen = new Set();
        if (enFazla > 1) {                       // once mevcut yiginlara doldur
          for (let s = 0; s < kapasite && kalan > 0; s++) {
            const hedef = lonca.kasa.get(s);
            if (!yiginlanirMi(hedef, kaynak)) continue;
            const yer = enFazla - hedef.qty;
            if (yer <= 0) continue;
            const n = Math.min(yer, kalan);
            hedef.qty += n; kalan -= n; degisen.add(s);
          }
        }
        for (let s = 0; s < kapasite && kalan > 0; s++) {   // sonra bos yuvalar
          if (lonca.kasa.get(s)) continue;
          const n = enFazla > 1 ? Math.min(enFazla, kalan) : 1;
          const yeni = yiginKopya(kaynak);
          yeni.qty = n;
          lonca.kasa.set(s, yeni);
          kalan -= n; degisen.add(s);
          if (enFazla === 1) break;              // ekipman: tek parca
        }
        const kondu = adet - kalan;
        if (kondu <= 0) return bildir(ws, 'sys.guild.bank_full');

        if (kondu >= (kaynak.qty ?? 1)) canta[d.bagSlot] = null;
        else kaynak.qty -= kondu;

        for (const s of degisen) kasaYaz(lonca, s);
        kayitEkle(lonca, ch.name, 'deposit_item',
          { itemDefId: kaynak.itemId, quantity: kondu });
        bildir(ws, 'sys.guild.bank_item_in', { qty: kondu, itemId: kaynak.itemId });
        if (kalan > 0) bildir(ws, 'sys.guild.bank_full');
        envanterGonder(ws);
        kasaYayinla(lonca);
        return;
      }

      case 'withdrawItem': {
        if (!cekebilir) return bildir(ws, 'sys.guild.bank_denied');
        if (d.bankSlot >= kapasite) return frame(ws, 'err', { code: 'ERR_VALIDATION' });
        const kaynak = lonca.kasa.get(d.bankSlot);
        if (!kaynak) return frame(ws, 'err', { code: 'ERR_NOT_FOUND' });
        const canta = cantaYuvalari(ch);
        const adet = Math.min(d.qty, kaynak.qty ?? 1);
        const enFazla = yiginMax(kaynak.itemId);

        let kalan = adet;
        if (enFazla > 1) {
          for (let s = 0; s < canta.length && kalan > 0; s++) {
            const hedef = canta[s];
            if (!yiginlanirMi(hedef, kaynak)) continue;
            const yer = enFazla - hedef.qty;
            if (yer <= 0) continue;
            const n = Math.min(yer, kalan);
            hedef.qty += n; kalan -= n;
          }
        }
        for (let s = 0; s < canta.length && kalan > 0; s++) {
          if (canta[s]) continue;
          const n = enFazla > 1 ? Math.min(enFazla, kalan) : 1;
          const yeni = yiginKopya(kaynak);
          yeni.qty = n;
          canta[s] = yeni;
          kalan -= n;
          if (enFazla === 1) break;
        }
        const alinan = adet - kalan;
        if (alinan <= 0) return frame(ws, 'err', { code: 'ERR_BAG_FULL' });

        if (alinan >= (kaynak.qty ?? 1)) lonca.kasa.delete(d.bankSlot);
        else kaynak.qty -= alinan;
        kasaYaz(lonca, d.bankSlot);

        kayitEkle(lonca, ch.name, 'withdraw_item',
          { itemDefId: kaynak.itemId, quantity: alinan });
        bildir(ws, 'sys.guild.bank_item_out', { qty: alinan, itemId: kaynak.itemId });
        if (kalan > 0) frame(ws, 'err', { code: 'ERR_BAG_FULL' });
        envanterGonder(ws);
        kasaYayinla(lonca);
        return;
      }

      case 'moveItem': {
        if (!cekebilir) return bildir(ws, 'sys.guild.bank_denied');
        if (d.from >= kapasite || d.to >= kapasite) {
          return frame(ws, 'err', { code: 'ERR_VALIDATION' });
        }
        if (d.from === d.to) return;
        const a = lonca.kasa.get(d.from) ?? null;
        const b = lonca.kasa.get(d.to) ?? null;
        if (!a) return frame(ws, 'err', { code: 'ERR_NOT_FOUND' });
        /* Birlestirme SADECE gercekten yer varken yapilir. Yer yoksa (hedef
           yigin dolu, ya da esya yiginlanamaz -> stackMax 1) islem YER
           DEGISTIRMEYE duser. Onceden `n <= 0` dalinda hicbir sey yapilmiyordu:
           ayni kimlikte iki ekipmani (ornek: iki adet duz kilic) birbirinin
           uzerine surukleyince kasa hic degismiyordu. */
        let birlestirildi = false;
        if (yiginlanirMi(a, b)) {
          const enFazla = yiginMax(a.itemId);
          const n = Math.min(enFazla - b.qty, a.qty);
          if (n > 0) {
            b.qty += n; a.qty -= n;
            if (a.qty <= 0) lonca.kasa.delete(d.from);
            birlestirildi = true;
          }
        }
        if (!birlestirildi) {                            // yer degistir
          if (b) lonca.kasa.set(d.from, b); else lonca.kasa.delete(d.from);
          lonca.kasa.set(d.to, a);
        }
        kasaYaz(lonca, d.from);
        kasaYaz(lonca, d.to);
        kasaYayinla(lonca);
        return;
      }

      default: return;
    }
  }

  /* =================================================================== 124 query */
  function query(ws, d) {
    const benimId = kimlik(ws.char.id);
    if (d.op === 'directory') {
      const arama = (d.search ?? '').trim().toLowerCase();
      const hepsi = [...loncalar.values()]
        .filter((g) => (arama ? g.name.toLowerCase().includes(arama) : true))
        // Once seviye, sonra puan, sonra ad - istemci siralama YAPMIYOR.
        .sort((a, b) => b.level - a.level || b.rating - a.rating ||
                        a.name.localeCompare(b.name));
      const bas = d.page * SAYFA_BOYU;
      frame(ws, 'guild.directory', {
        page: d.page, total: hepsi.length,
        guilds: hepsi.slice(bas, bas + SAYFA_BOYU).map((g) => ({
          id: g.id, name: g.name, level: g.level,
          memberCount: g.uyeler.size, memberCap: seviyeSatiri(g.level).memberCap,
          rating: g.rating,
          masterName: g.uyeler.get(g.masterId)?.name ?? '',
          applied: g.basvurular.has(benimId),
        })),
      });
      return;
    }
    // op === 'log'
    const lonca = loncaOf(benimId);
    if (!lonca) { frame(ws, 'guild.log', { page: d.page, total: 0, entries: [] }); return; }
    const bas = d.page * SAYFA_BOYU;
    frame(ws, 'guild.log', {
      page: d.page, total: lonca.kayit.length,
      entries: lonca.kayit.slice(bas, bas + SAYFA_BOYU).map((k) => ({ ...k })),
    });
  }

  /* ================================================================ yonlendirici */
  const ISLEYICILER = {
    'guild.create': [semaCreate, create],
    'guild.manage': [semaManage, manage],
    'guild.bank':   [semaBank,   bank],
    'guild.query':  [semaQuery,  query],
  };

  function mesaj(ws, t, d) {
    /* ILK TEMAS KANCASI (emniyet agi).
       `guild.state` PUSH-ONLY: pakette "bana lonca durumumu yolla" diye bir c2s
       mesaji YOK (c2s tarafinda yalnizca create/manage/bank/query var). Sunucu
       giriste kendiliginden yollamazsa lonca penceresi BOS kalir.
       giris.js su an `KANCA['lonca'] = 'girisTamam'` ile bunu zaten cagiriyor;
       burasi o baglanti koparsa diye duran yedek. `girisTamam` tek seferlik
       oldugu icin ikisi birden kosa da SADECE bir guild.state gider.
       Yan etki additif: ilgilenmedigimiz mesajda yine FALSE donuyoruz. */
    if (ws?.char && !ws.loncaKarsilandi) {
      try { girisTamam(ws); }
      catch (e) { log(`lonca girisTamam: ${String(e?.message ?? e).slice(0, 120)}`); }
    }

    const kayit = ISLEYICILER[t];
    if (!kayit) return false;                   // ilgilenmiyoruz -> router devam etsin
    if (!ws?.char) return true;                 // karaktersiz soket: yut
    const [sema, isle] = kayit;
    let temiz;
    try {
      temiz = sema(d ?? {});
    } catch (e) {
      const neden = e instanceof SemaHatasi ? e.message : String(e.message);
      log(`${t} reddedildi (${ws.char.name ?? ws.char.id}): ${neden}`);
      protokolHatasi(ws, t, neden);
      return true;
    }
    soketler.set(kimlik(ws.char.id), ws);        // firsatci kayit
    isle(ws, temiz);
    return true;
  }

  /* ========================================================= oturum kancalari */

  /* ------------------------------------------------------------- acilis
   * server.js `dbYukle()` diye bir kanca CAGIRMIYOR (olcum: `grep -c dbYukle
   * server.js` = 0) ve modul kurulurken `web` genelde HENUZ NULL (havuz
   * initSql'de aciliyor, sonra sistemleriKur(true) modulleri tazeliyor).
   * Bu yuzden acilisi KENDIMIZ tetikliyoruz ve SUREC BASINA bir kez
   * calistiriyoruz: once sema (ekleyerek), sonra tam yukleme.
   * Kanca noktasi: modulleriYukle(ch) -> yukle(ch), yani ilk girise kadar
   * gecikebilir ama HER ZAMAN zone.init'ten ONCE tamamlanir. */
  function acilis() {
    if (ACILIS_SOZU) return ACILIS_SOZU;
    /* KALICILIK KAPALIYKEN SONUCU HATIRLAMIYORUZ: acilista modul bir kez
       `web: null` ile kuruluyor (havuz initSql'de aciliyor) ve hemen ardindan
       dolu havuzla YENIDEN kuruluyor. Burada Promise'i saklasaydik, ikinci
       (gercek) ornek acilisi bir daha hic calistiramazdi. */
    if (!kalici.etkin) return Promise.resolve(0);
    ACILIS_SOZU = (async () => {
      const semaOk = await kalici.semaKur(SHARD);
      if (!semaOk) return 0;
      return dbYukle();
    })().catch((e) => {
      log(`lonca acilisi basarisiz: ${String(e?.message ?? e).slice(0, 160)}`);
      return 0;
    });
    return ACILIS_SOZU;
  }
  // Havuz zaten hazirsa girisi beklemeden basla (kurulum sirasi degisebilir).
  if (kalici.etkin) acilis();

  /** zone.init GONDERILMEDEN ONCE: ch.guild / ch.guildPenaltyUntil doldurulur. */
  async function yukle(ch) {
    await acilis();                              // sema + tam yukleme (tek sefer)
    const charId = kimlik(ch?.id);
    const lonca = loncaOf(charId);
    const uye = lonca?.uyeler.get(charId) ?? null;
    if (uye) {                                   // ad/seviye/irk tazele
      uye.name = String(ch.name ?? uye.name);
      uye.level = ch.level ?? uye.level;
      if (ch.race) uye.race = String(ch.race);
      kalici.uyeYaz(lonca.id, uye);
    }
    const ceza = cezalar.get(charId) ?? null;
    ch.guild = lonca && uye
      ? { id: lonca.id, name: lonca.name, level: lonca.level, rank: uye.rank }
      : null;
    ch.guildPenaltyUntil = ceza && ceza > simdi() ? ceza : null;
    ch.guildAd = lonca ? lonca.name : null;
    return selfAlanlari(ch);
  }

  /** selfPayload icine yayilir. Alan adlari _ht (zone.init.self) ile birebir. */
  function selfAlanlari(ch) {
    return {
      guild: ch?.guild ?? null,
      guildPenaltyUntil: ch?.guildPenaltyUntil ?? null,
    };
  }
  /** entityPayload icine yayilir; entity.guild alani .optional() - yoksa koyma. */
  function varlikAlanlari(ch) {
    const ad = ch?.guildAd ?? loncaOf(ch?.id)?.name ?? null;
    return ad ? { guild: ad } : {};
  }

  /** zone.init GONDERILDIKTEN SONRA cagrilir: canli yakalamada sunucu tam bu
   *  noktada guild.state yolluyor (zone.init -> env.clock -> guild.state). */
  function girisTamam(ws) {
    if (!ws?.char) return;
    /* TEK SEFERLIK. giris.js hem sentetik `zone.ready`yi dagiticidan geciriyor
       (asagidaki ilk-temas kancasini tetikler) hem de KANCA tablosundan
       `girisTamam`i DOGRUDAN cagiriyor. Bayrak olmasa giris batch'inde IKI adet
       guild.state giderdi. Bayrak sokete ozel; her yeni baglanti temiz baslar. */
    if (ws.loncaKarsilandi) return;
    ws.loncaKarsilandi = true;
    const charId = kimlik(ws.char.id);
    soketler.set(charId, ws);
    const lonca = loncaOf(charId);
    /* Uye kaydindaki ad/seviye/irk tazelensin: cevrimdisiyken basvurusu
       onaylanan oyuncunun kaydi basvuru anindaki seviyeyle donmus olabilir. */
    const uye = lonca?.uyeler.get(charId) ?? null;
    if (uye) {
      uye.name = String(ws.char.name ?? uye.name);
      uye.level = ws.char.level ?? uye.level;
      if (ws.char.race) uye.race = String(ws.char.race);
      ws.char.guildAd = lonca.name;
    }
    frame(ws, 'guild.state', durumPayload(lonca, charId));
    if (!lonca) return;
    rozetYayinla(ws, lonca.name);
    durumYayinla(lonca, charId);         // digerlerinde "cevrimici" noktasi yansin
  }

  /** bolge.js gecis sonunda BU kancayi cagiriyor (`s.ornek.bolgeDegisti`).
   *
   *  IKI SEY tazelenmeli:
   *   1) ROZET - `entity.guild` bolgeye ozel yayinlanir. Yeni bolgedeki
   *      oyuncular varligi `state.delta`/`zone.init` ile alir ama lonca adini
   *      bilmez (server.js entityPayload'a henuz `varlikAlanlari` baglanmadi).
   *   2) self.guild - gecis YENIDEN `zone.init` yolluyor ve o karenin
   *      `self` alani su an sabit `guild: null` tasiyor (server.js:452).
   *      Istemci setSelf ile self.guild'i NULL yapar; tek geri getirme yolu
   *      yeni bir `guild.state`. Yollamazsak oyuncu bolge degistirince
   *      loncasizmis gibi davranir (lonca sohbet kanali, rutbe rozeti...). */
  function bolgeDegisti(ws, _eskiZone, _yeniZone) {
    if (!ws?.char) return;
    const charId = kimlik(ws.char.id);
    const lonca = loncaOf(charId);
    frame(ws, 'guild.state', durumPayload(lonca, charId));
    if (!lonca) return;
    rozetYayinla(ws, lonca.name);
  }

  function cikis(ws) {
    if (!ws?.char) return;
    const charId = kimlik(ws.char.id);
    if (soketler.get(charId) === ws) soketler.delete(charId);
    davetler.delete(charId);
    ws.loncaKasasi = null;
    ws.loncaKarsilandi = false;
    const lonca = loncaOf(charId);
    if (lonca) durumYayinla(lonca);
  }

  /* ------------------------------------------------------------ DB'den yukleme */
  async function dbYukle() {
    if (!kalici.etkin) return 0;
    const r = await kalici.yukle();
    const kumeler = r?.recordsets;
    if (!Array.isArray(kumeler) || kumeler.length < 5) return 0;
    const [gs, us, bs, ks, cs] = kumeler;
    loncalar.clear(); adIndeks.clear(); uyeIndeks.clear(); cezalar.clear();
    for (const g of gs) {
      const id = String(g.GuildID);
      loncalar.set(id, {
        id, name: g.Name, level: g.Lvl, xp: g.Xp, rating: g.Rating,
        notice: g.Notice ?? '', masterId: String(g.MasterCharID),
        gold: Number(g.Gold), createdAt: Number(g.CreatedAt),
        uyeler: new Map(), basvurular: new Map(), kasa: new Map(), kayit: [],
      });
      adIndeks.set(String(g.Name).toLowerCase(), id);
      sonrakiBellekId = Math.max(sonrakiBellekId, Number(g.GuildID) + 1);
    }
    for (const u of us) {
      const lonca = loncalar.get(String(u.GuildID));
      if (!lonca) continue;
      const charId = String(u.CharID);
      lonca.uyeler.set(charId, {
        charId, name: u.CharName ?? '', level: u.CharLevel ?? 1, rank: u.Rank,
        perms: u.Perms ?? 0, contributedXp: u.ContributedXp ?? 0,
        joinedAt: Number(u.JoinedAt ?? 0), race: u.Race ?? null,
      });
      uyeIndeks.set(charId, lonca.id);
    }
    for (const b of bs) {
      const lonca = loncalar.get(String(b.GuildID));
      if (!lonca) continue;
      lonca.basvurular.set(String(b.CharID), {
        charId: String(b.CharID), name: b.CharName ?? '',
        level: b.CharLevel ?? 1, at: Number(b.AppliedAt),
      });
    }
    for (const k of ks) {
      const lonca = loncalar.get(String(k.GuildID));
      if (!lonca) continue;
      try { lonca.kasa.set(k.Slot, yiginKopya(JSON.parse(k.StackJson))); }
      catch { /* bozuk satiri atla */ }
    }
    for (const c of cs) cezalar.set(String(c.CharID), Number(c.Until));
    log(`lonca verisi yuklendi: ${loncalar.size} lonca, ${uyeIndeks.size} uye`);
    return loncalar.size;
  }

  /* --------------------------------------------------------------- disa acilan */
  return {
    mesaj, yukle, selfAlanlari, varlikAlanlari, girisTamam, bolgeDegisti, cikis,
    katkiEkle, puanAyarla, dbYukle,
    /* capraz istek 51/65: lonca sohbeti - server.js chat.send `guild` dali. */
    kanalaYayinla,
    /** Sema kurulumu + tam yukleme (surec basina tek sefer, kendi kendine
     *  tetiklenir). Disaridan beklemek isteyen icin disa acildi. */
    acilis,
    /* Salt-okunur pencere: karakter SILME kapilari icin (routes_auth.js).
       tr.json'da bu iki HTTP hatasinin karsiligi hazir bekliyor:
         api.guild_master         "Bu karakter bir loncanin lideri - once
                                   liderligi devret veya loncayi dagit."
         api.guild_bank_not_empty "Son uyesini silmeden once lonca bankasini bosalt."
       Istemci HTTP hatasini `api.<error>` anahtari olarak cozuyor
       (paket @27138578 X5()), yani `error` alani ANAHTAR olmali.
       Hicbir durum degistirmez. */
    loncaOfChar: (charId) => {
      const g = loncaOf(kimlik(charId));
      if (!g) return null;
      return {
        id: g.id,
        name: g.name,
        masterId: g.masterId,
        lider: String(g.masterId) === String(kimlik(charId)),
        uyeSayisi: g.uyeler.size,
        gold: tamSayi(g.gold),
        kasaDolu: [...g.kasa.values()].some((y) => !!y),
      };
    },
    kasaSaglikli,
    // test/GM erisimi
    _durum: { loncalar, adIndeks, uyeIndeks, cezalar, davetler, soketler },
    _durumPayload: durumPayload, _kasaPayload: kasaPayload,
  };
}

/* ====================================================== SEMA DOSYASI YOLU (bilgi) */
export const SEMA_SQL = path.join(
  path.dirname(fileURLToPath(import.meta.url)), 'sistem_lonca_sema.sql');
export const semaSqlVarMi = () => fs.existsSync(SEMA_SQL);

/* ============================================================== BAGLAMA NOTU ===
 *
 * ctx'den KULLANDIKLARIM:
 *   world (worldData.zones -> NPC konumu, bolgeOyunculari, zoneState),
 *   frame, broadcast, log, GCFG (npcInteractRangeU / partyInviteTimeoutMs / bagSlots),
 *   ITEMSTATS (stackMax), envanterPayload, web + sql (kalicilik).
 *   NOT: ctx'te `sql` YOK - modul `sql` gelmezse kalicilik katmanini kapatir ve
 *   BELLEKTE calisir. SQL istiyorsan kur() cagrisina `sql` (mssql modulu) ve
 *   dolu bir `web` havuzu ekle.
 *
 * ISLEDIGIM MESAJLAR (hepsinde true doner, digerlerinde false):
 *   guild.create (121) · guild.manage (122) · guild.bank (123) · guild.query (124)
 *
 * GONDERDIGIM S2C KARELERI:
 *   guild.state (163) · guild.invited (164) · guild.left (165) · guild.bankState (166)
 *   guild.log (167) · guild.directory (171) · entity.guild (172) · inv.update (149)
 *   sys.notice (195) · err (240)
 *
 * server.js'e BAGLAMA — DURUM (denetim sirasinda dogrulandi):
 *
 *  [OK] 1) SISTEM_ADLARI'nda 'lonca' VAR (server.js, 2. dalga satiri).
 *
 *  [OK] 2) GIRIS KANCASI BAGLI: giris.js -> `KANCA = { ..., 'lonca':'girisTamam' }`,
 *          `girisAkisi()` once sentetik `zone.ready`yi dagiticidan geciriyor,
 *          sonra girisTamam'i cagiriyor. `girisTamam` TEK SEFERLIK oldugu icin
 *          ikisi birden kossa da tam 1 adet guild.state uretilir.
 *          `TEKIL_SIRA` icinde 'guild.state' var - kare canli yakalamadaki
 *          sirada (env.clock -> unique.timers -> guild.state) gidiyor.
 *
 *  [OK] 3) BOLGE GECISI BAGLI: bolge.js gecis sonunda `bolgeDegisti` cagiriyor.
 *          Modul orada hem rozeti (entity.guild) yeniden yayinliyor hem de
 *          guild.state'i tazeliyor - cunku gecis `zone.init`i YENIDEN yolluyor.
 *
 *  [ EKSIK ] 4) selfPayload / entityPayload HALA SABIT:
 *          server.js:452  `guild: null, guildPenaltyUntil: null,`
 *          Yapilmasi gereken:
 *            - `auth` dalinda, selfPayload kurulmadan ONCE:  await LONCA.yukle(ch);
 *            - selfPayload icinde o satir yerine:            ...LONCA.selfAlanlari(ch),
 *            - entityPayload icine:                          ...LONCA.varlikAlanlari(ch),
 *              (entity semasindaki `guild` .optional() - lonca yoksa anahtar KONULMAZ.)
 *          Bu yapilana kadar `guildPenaltyUntil` istemciye HIC gitmez (24 saatlik
 *          ceza sayaci arayuzde gorunmez; sunucu tarafi engel yine de calisir) ve
 *          bolgeye YENI giren oyuncular rozeti yalnizca sonraki entity.guild
 *          yayinindan ogrenir. `bolgeDegisti` kancasi bunu buyuk olcude telafi
 *          ediyor ama dogrusu payload'a baglamaktir.
 *
 *  [ EKSIK ] 5) Soket kapanisinda `LONCA.cikis(ws)` cagrilmiyor.
 *          Olumcul degil: soketBul() olu kaydi kendisi buduyor, `online`
 *          noktalari dogru kaliyor. Yine de cikista cagrilmasi tercih edilir
 *          (bekleyen daveti hemen dusurur, lonca arkadaslarina aninda tazeleme).
 *
 *  [ ISTEGE BAGLI ] 6) KALICILIK: ctx'te `web: null` ve `sql` HIC yok -> sistem
 *          TAMAMEN BELLEKTE calisiyor, sunucu yeniden baslayinca loncalar gider.
 *          Acmak icin:  import sql from 'mssql'; kur({ ..., web: webPool, sql })
 *          ve acilista  await LONCA.dbYukle();  (once sistem_lonca_sema.sql).
 *
 *  [ ISTEGE BAGLI ] 7) Av/gorev tarafi lonca XP'si vermek isterse:
 *          LONCA.katkiEkle(ch, kazanilanXp);
 *          (Pakette bunu tetikleyen bir c2s mesaji YOK - politika tamamen sizin.)
 *
 * DB GEREKSINIMI (ana oturum olusturacak): sistem_lonca_sema.sql
 *   Tablolar : WebGuild, WebGuildMember, WebGuildApplication, WebGuildChest,
 *              WebGuildLog, WebGuildPenalty
 *   Yordamlar: WebLoadGuilds, WebSaveGuild, WebDeleteGuild, WebSaveGuildMember,
 *              WebDeleteGuildMember, WebSetGuildApplication, WebSetGuildChestSlot,
 *              WebAddGuildLog, WebSetGuildPenalty
 *   WebLoadGuilds 5 sonuc kumesi doner: loncalar, uyeler, basvurular, kasa, cezalar.
 * ============================================================================== */
