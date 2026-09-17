/**
 * GM PANELI - KARAKTER GORUNUMU VE DUZENLEME
 *
 * admin.js'ten ayri dosya: ayar paneli kucuk ve kararli, karakter paneli ise
 * veritabanina, canli dunyaya ve esya kataloguna dokunuyor. Ikisini ayirmak
 * ayar panelinin bir DB hatasi yuzunden calismaz hale gelmesini onluyor.
 *
 * KAPLAR (hepsi referans oyun paketinden dogrulandi - hicbiri uydurulmadi):
 *   kusam  15 yuva -> rY dizisi, index-BUMMQVRB.js @8687659
 *                     [weapon, shield, head, shoulder, chest, gloves, pants, boots,
 *                      avatarDress, avatarHat, avatarAttach, earring, necklace, ringL, ringR]
 *                     inv.move mesajindaki `equip.i` tam olarak bu dizinin INDEKSI.
 *   canta  N yuva  -> config/game-config.json  bagSlots = 32
 *   banka          -> s2c `bank.items` (182); kaynak SRO_WEB_GAME.dbo.WebBank (JID bazli)
 *   lonca kasasi   -> s2c `guild.bank` (123)
 *   PET CANTASI YOKTUR: pakette pet envanteri mesaji YOK. Protokolde yalnizca
 *                     pet.state (161) ve gpet.state (214) var; buyuyen pet
 *                     topladigini OYUNCUNUN cantasina koyuyor
 *                     (sistem_binek-pet.js satir 644). Bu yuzden "pet" bolumu
 *                     petin kendi durumu + cantadaki tomar yuvasidir.
 *
 * Esya ikonlari: data/itemstats.json icindeki `icon` alani ->
 *                client/assets/icons/<icon>.png   (2860/2860 esyanin ikonu diskte var)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BURASI = path.dirname(fileURLToPath(import.meta.url));

/** Kusam yuvalari - SIRA PAKETTEN (rY, @8687659). */
export const KUSAM_YUVALARI = [
  'weapon', 'shield', 'head', 'shoulder', 'chest', 'gloves', 'pants', 'boots',
  'avatarDress', 'avatarHat', 'avatarAttach', 'earring', 'necklace', 'ringL', 'ringR',
];

const YUVA_ADI = {
  weapon: 'Silah', shield: 'Kalkan', head: 'Başlık', shoulder: 'Omuzluk', chest: 'Zırh',
  gloves: 'Eldiven', pants: 'Pantolon', boots: 'Bot', avatarDress: 'Kostüm',
  avatarHat: 'Kostüm şapka', avatarAttach: 'Kostüm ek', earring: 'Küpe',
  necklace: 'Kolye', ringL: 'Yüzük (sol)', ringR: 'Yüzük (sağ)',
};

/** vSRO _Inventory yuva sirasi (routes_auth.js equipOf ile AYNI olmak ZORUNDA). */
const VSRO_KUSAM_SIRASI = ['head', 'chest', 'shoulder', 'gloves', 'pants', 'boots', 'weapon', 'shield'];
const VSRO_CANTA_BASI = 13;

/**
 * Duzenlenebilir sayisal alanlar.
 * Sinirlar vSRO _Char KOLON TIPLERINDEN geliyor (canli DB'den okundu):
 *   CurLevel tinyint | Strength/Intellect/RemainStatPoint smallint
 *   RemainSkillPoint/SExpOffset/HP/MP int | ExpOffset/RemainGold bigint
 */
export const SAYISAL_ALANLAR = {
  level:      { ad: 'Seviye',       min: 1, max: 255,        kolon: 'CurLevel',         buyuk: false },
  xp:         { ad: 'Deneyim',      min: 0, max: 9e15,       kolon: 'ExpOffset',        buyuk: true },
  sp:         { ad: 'Beceri puanı', min: 0, max: 2147483647, kolon: 'RemainSkillPoint', buyuk: false },
  spExp:      { ad: 'SP deneyimi',  min: 0, max: 2147483647, kolon: 'SExpOffset',       buyuk: false },
  statPoints: { ad: 'Stat puanı',   min: 0, max: 32767,      kolon: 'RemainStatPoint',  buyuk: false },
  str:        { ad: 'Güç (STR)',    min: 1, max: 32767,      kolon: 'Strength',         buyuk: false },
  int:        { ad: 'Zekâ (INT)',   min: 1, max: 32767,      kolon: 'Intellect',        buyuk: false },
  gold:       { ad: 'Altın',        min: 0, max: 9e15,       kolon: 'RemainGold',       buyuk: true },
  hp:         { ad: 'HP',           min: 0, max: 2147483647, kolon: 'HP',               buyuk: false },
  mp:         { ad: 'MP',           min: 0, max: 2147483647, kolon: 'MP',               buyuk: false },
};

/* --------------------------------------------------------------- esya katalogu */
const KATALOG = new Map();
/** CodeName128 -> referans oyun esya kimligi (itemmap.json'un TERSI). */
const KOD_TERSI = new Map();

function katalogYukle(dataDir, log) {
  if (KATALOG.size) return;
  try {
    const ham = JSON.parse(fs.readFileSync(path.join(dataDir, 'itemstats.json'), 'utf8'));
    for (const v of Object.values(ham)) if (v?.id) KATALOG.set(v.id, v);
  } catch (e) { log?.(`[admin] esya katalogu okunamadi: ${e.message}`); }

  /* TAM ESLEME: data/itemmap-tam.json
       { "<oyunId>": { code, refId, codeW?, refIdW? } }   2860/2860 kayit
     Tersine muhendislikle cikarildi ve canli DB fiyat parmak iziyle (Price +
     SellPrice + CostRepair + CostRevive) esya esya dogrulandi. Kural:
       <aile><NN>[_varyant] -> ITEM_<IRK>_<AILE>_<NN>_<V>
       varyant:  ''->_A  _b->_B  _c->_C  _bronze->_A_RARE  _silver->_B_RARE  _gold->_C_RARE
       zirh cinsiyetsiz: tek referans oyun esyasi = vSRO'da _M_ ve _W_ IKI kayit
     Bu sayede CEVRIMDISI karakterin _Inventory satirlari da gercek esya olarak
     cozuluyor (once yalnizca 52 baslangic esyasi cozulebiliyordu). */
  try {
    const tam = JSON.parse(fs.readFileSync(path.join(dataDir, 'itemmap-tam.json'), 'utf8'));
    for (const [jw, v] of Object.entries(tam)) {
      if (v?.code) KOD_TERSI.set(String(v.code).toUpperCase(), jw);
      if (v?.codeW) KOD_TERSI.set(String(v.codeW).toUpperCase(), jw);
    }
    log?.(`[admin] esya eslemesi: ${KOD_TERSI.size} vSRO kodu -> ${Object.keys(tam).length} referans oyun esyasi`);
  } catch (e) {
    /* Tam harita yoksa eski dar haritaya dus - sessizce "bos" GOSTERMIYORUZ,
       cozulemeyen kod panelde ham haliyle gorunur. */
    log?.(`[admin] itemmap-tam.json okunamadi (${e.code ?? e.message}), dar haritaya duşuluyor`);
    try {
      const im = JSON.parse(fs.readFileSync(path.join(BURASI, 'itemmap.json'), 'utf8'));
      for (const grup of Object.values(im)) {
        for (const [anahtar, v] of Object.entries(grup)) {
          if (v?.code) KOD_TERSI.set(String(v.code).toUpperCase(), anahtar);
        }
      }
    } catch { /* hicbiri yoksa ham kod gosterilir */ }
  }
}

function kodOku(kod) {
  if (!kod) return null;
  const k = KOD_TERSI.get(String(kod).toUpperCase());
  if (!k) return null;
  /* Harita katalogda GERCEKTEN olan bir kimlige isaret etmeli; aksi halde
     panelde ikonsuz bir hayalet satir olusur. */
  return KATALOG.has(k) ? k : null;
}

/**
 * Panelde gosterilecek esya ozeti (gercek oyun ikonu dahil).
 *
 * `cins` verilirse ('male' | 'female') dogru cinsiyetin ikonu secilir. Zirh ve
 * avatar parcalarinin ikonlari cinsiyete gore AYRI dosyalardir
 * (sro_item_eu_clothes01_head_m / _w); cinsiyet bilinmeden secilen ikon kadin
 * karakterde erkek zirhi gosteriyordu.
 */
export function esyaOzet(it, cins) {
  if (!it) return null;
  const v = it.visuals ?? {};
  const oncelik = cins === 'female'
    ? [it.icon, v.female?.icon, v.male?.icon]
    : [it.icon, v.male?.icon, v.female?.icon];
  return {
    id: it.id,
    ad: it.name ?? it.id,
    ikon: oncelik.find(Boolean) ?? null,
    tur: it.type ?? it.kind ?? null,
    yuva: it.slot ?? null,
    derece: it.degree ?? null,
    seviye: it.reqLevel ?? null,
    irk: it.race ?? null,
    yiginMax: it.stackMax ?? 1,
    silahTuru: it.weaponType ?? null,
    alis: it.buyPrice ?? null,
  };
}

/** Bir kabin tek yuvasini panel bicimine cevirir. */
function yuvaKaydi(kap, indeks, v, cins) {
  const ad = YUVA_ADI[kap] ?? null;
  if (!v) return { kap, slot: indeks, ad, bos: true };
  const k = typeof v === 'string' ? { itemId: v, qty: 1 } : v;
  return {
    kap, slot: indeks, ad, bos: false,
    itemId: k.itemId, qty: k.qty ?? 1,
    plus: k.plus ?? 0, dur: k.dur ?? null, maxDur: k.maxDur ?? null,
    blues: k.blues ?? null, rolls: k.rolls ?? null, variance: k.variance ?? null,
    katalog: esyaOzet(KATALOG.get(k.itemId), cins),
  };
}

/** vSRO CodeName128'den cinsiyet: ..._M_... erkek, ..._W_... kadin. */
function koddanCinsiyet(kod) {
  const k = String(kod ?? '').toUpperCase();
  if (k.includes('_W_')) return 'female';
  if (k.includes('_M_')) return 'male';
  return null;
}

/* ==================================================================== FABRIKA */
export function createKarakterPaneli({ dataDir, GCFG, log, ctx = {} }) {
  katalogYukle(dataDir, log);

  /* ---------------------------------------------------------------- canli dunya */
  /**
   * Cevrimici karakteri bolge durumundan bulur.
   *
   * TIP TUZAGI (bu yuzden panel oyundaki karakteri "cevrimdisi" gosteriyordu):
   * routes_auth.js karakteri istemciye `id: String(c.CharID)` olarak veriyor,
   * yani `ws.char.id` bir METIN ("1"). Panel ise URL'den gelen kimligi
   * Number() ile sayiya ceviriyordu ve `===` ile karsilastiriyordu:
   *     "1" === 1   ->   false
   * Sonuc: eslesme HIC olmuyor, her karakter DB yolundan (cevrimdisi) okunuyor,
   * "Canli Durum" sekmesi ayni oyuncuyu cevrimici gosterse bile. Karsilastirmayi
   * iki tarafta da Number()'a indirgiyoruz.
   */
  function canliBul(charId) {
    const hedef = Number(charId);
    if (!Number.isFinite(hedef)) return null;
    try {
      for (const [zid, z] of (ctx.world?.zoneState ?? new Map())) {
        for (const ws of z.players) {
          if (!ws?.char) continue;
          if (Number(ws.char.id) === hedef) return { ws, ch: ws.char, zoneId: zid };
        }
      }
    } catch { /* dunya henuz kurulmadi */ }
    /* Yedek yol: bazi akislarda oyuncu world.zoneState'e degil yalnizca
       server.js'in `zones` kumesine kayitli olabilir (ctx.cevrimiciSoketler
       verildiyse oradan da bak). */
    try {
      for (const ws of (ctx.cevrimiciSoketler?.() ?? [])) {
        if (ws?.char && Number(ws.char.id) === hedef) {
          return { ws, ch: ws.char, zoneId: ws.zoneId };
        }
      }
    } catch { /* kanca yok */ }
    return null;
  }

  function yolla(ws, t, d) {
    if (ctx.frame) return ctx.frame(ws, t, d);
    if (ws?.readyState === 1) ws.send(JSON.stringify({ t, d }));
  }

  /* ---------------------------------------------------------------- kendi SQL havuzu
   * server.js'e bagimli olmadan calisir; panel acilmadikca hic baglanmaz. */
  let HAVUZ = null, SQL = null, HAVUZ_HATA = null, SEMA = null;
  async function havuz() {
    if (HAVUZ) return HAVUZ;
    if (HAVUZ_HATA) return null;
    try {
      SQL = (await import('mssql')).default;
      const C = JSON.parse(fs.readFileSync(path.join(BURASI, 'config.json'), 'utf8')).sql;
      HAVUZ = await new SQL.ConnectionPool({
        server: C.server, user: C.user, password: C.password,
        database: C.databases.web, options: C.options,
      }).connect();
      SEMA = { web: C.databases.web, shard: C.databases.shard, hesap: C.databases.account };
      return HAVUZ;
    } catch (e) {
      HAVUZ_HATA = e.message;
      log(`[admin] SQL havuzu açılamadı: ${e.message}`);
      return null;
    }
  }

  /* ---------------------------------------------------------------- banka */
  async function bankaOku(JID) {
    const j = Number(JID);
    if (!Number.isInteger(j) || j <= 0) return { yok: 'JID bilinmiyor' };
    const p = await havuz();
    if (!p) return { yok: HAVUZ_HATA ?? 'veritabanı yok' };
    try {
      const r = await p.request().input('j', SQL.Int, j)
        .query('SELECT Slot, StackJson FROM dbo.WebBank WHERE JID=@j ORDER BY Slot');
      const k = await p.request().input('j', SQL.Int, j)
        .query('SELECT Capacity FROM dbo.WebBankInfo WHERE JID=@j');
      const kapasite = k.recordset[0]?.Capacity ?? 0;
      const enBuyuk = r.recordset.length ? Math.max(...r.recordset.map(x => x.Slot)) + 1 : 0;
      const yuvalar = new Array(Math.max(kapasite, enBuyuk)).fill(null);
      for (const row of r.recordset) {
        try { yuvalar[row.Slot] = JSON.parse(row.StackJson); } catch { /* bozuk satir */ }
      }
      return { kapasite, yuvalar: yuvalar.map((v, i) => yuvaKaydi('bank', i, v)) };
    } catch (e) { return { yok: e.message }; }
  }

  /* ---------------------------------------------------------------- pet / binek */
  function petOzeti(ws) {
    const g = ws?.gpet, b = ws?.pet;
    return {
      buyuyenPet: g ? {
        petId: g.petId, seviye: g.level, xp: Math.round(g.xp ?? 0),
        hp: Math.round(g.hp ?? 0), hgp: Math.round(g.hgp ?? 0), hgpMax: g.hgpMax ?? null,
        olu: !!g.dead, mod: g.mode ?? null, cantaYuvasi: g.bagSlot ?? null,
      } : null,
      binek: b ? { petId: b.petId, hp: Math.round(b.hp ?? 0), cantaYuvasi: b.bagSlot ?? null } : null,
      not: 'referans oyun protokolünde ayrı bir pet envanteri mesajı yok — büyüyen pet topladığını oyuncunun çantasına koyar.',
    };
  }

  /* ---------------------------------------------------------------- cevrimdisi (DB) */
  async function dbDetay(id) {
    const p = await havuz();
    if (!p) return { hata: HAVUZ_HATA ?? 'veritabanı yok' };
    try {
      /* style/race/gender SRO_WEB_GAME.dbo.WebCharStyle'dan gelir (refObjId ->
         stil). WebListCharacters yordami da AYNI tabloyu kullaniyor; burada da
         onu kullanmak panelin oyun ici gorunumle ayni bilgiyi vermesini saglar.
         Tablo SRO_WEB_GAME'de, _Char SRO_VT_SHARD'da - capraz veritabani JOIN. */
      const c = (await p.request().input('c', SQL.Int, id).query(`
        SELECT ch.CharID, ch.CharName16, ch.CurLevel, ch.ExpOffset, ch.SExpOffset,
               ch.Strength, ch.Intellect, ch.RemainGold, ch.RemainSkillPoint,
               ch.RemainStatPoint, ch.HP, ch.MP, ch.LatestRegion,
               ch.PosX, ch.PosY, ch.PosZ, ch.Deleted, ch.GuildID, ch.InventorySize,
               st.style, st.race, st.gender
          FROM [${SEMA.shard}].dbo._Char ch
          LEFT JOIN [${SEMA.web}].dbo.WebCharStyle st ON st.refObjId = ch.RefObjID
         WHERE ch.CharID=@c`)).recordset[0];
      if (!c) return { hata: 'karakter bulunamadı' };

      const inv = (await p.request().input('c', SQL.Int, id).query(`
        SELECT i.Slot, i.ItemID, o.CodeName128
          FROM [${SEMA.shard}].dbo._Inventory i
          LEFT JOIN [${SEMA.shard}].dbo._Items it ON it.ID64 = i.ItemID
          LEFT JOIN [${SEMA.shard}].dbo._RefObjCommon o ON o.ID = it.RefItemID
         WHERE i.CharID=@c AND i.ItemID <> 0 ORDER BY i.Slot`)).recordset;

      let jid = null;
      try {
        jid = (await p.request().input('c', SQL.Int, id).query(`
          SELECT TOP 1 u.UserJID AS JID FROM [${SEMA.shard}].dbo._User u WHERE u.CharID=@c`)).recordset[0]?.JID ?? null;
      } catch { /* _User semasi farkli olabilir */ }

      const kusam = KUSAM_YUVALARI.map((yuva, i) => {
        const vs = VSRO_KUSAM_SIRASI.indexOf(yuva);
        const row = vs < 0 ? null : inv.find(x => x.Slot === vs);
        if (!row) return { kap: yuva, slot: i, ad: YUVA_ADI[yuva], bos: true };
        const jw = kodOku(row.CodeName128);
        return {
          kap: yuva, slot: i, ad: YUVA_ADI[yuva], bos: false, qty: 1,
          itemId: jw, vsroKod: row.CodeName128,
          katalog: jw ? esyaOzet(KATALOG.get(jw), c.gender ?? koddanCinsiyet(row.CodeName128)) : null,
        };
      });

      return {
        kaynak: 'veritabanı', cevrimici: false, duzenlenebilir: false,
        bilgi: {
          charId: c.CharID, ad: c.CharName16, bolge: c.LatestRegion,
          x: Math.round(c.PosX), z: Math.round(c.PosZ), silinmis: !!c.Deleted,
          loncaId: c.GuildID, cantaBoyu: c.InventorySize, JID: jid,
          stil: c.style ?? null, irk: c.race ?? null, cinsiyet: c.gender ?? null,
        },
        sayisal: {
          level: c.CurLevel, xp: Number(c.ExpOffset), sp: c.RemainSkillPoint,
          spExp: c.SExpOffset, statPoints: c.RemainStatPoint, str: c.Strength,
          int: c.Intellect, gold: Number(c.RemainGold), hp: c.HP, mp: c.MP,
        },
        turetilmis: null,
        kusam,
        /* Cantayi TAM IZGARA olarak dondur - yalniz dolu yuvalari degil.
           Onceden dolu satirlar donuyordu ve panel "CANTA (3 YUVA)" yaziyordu;
           oysa canta bagSlots (32) yuvalik. Boyut oncelikle karakterin kendi
           InventorySize'indan (vSRO kolonu), yoksa gameConfig.bagSlots'tan. */
        canta: (() => {
          const boy = Math.max(GCFG.bagSlots ?? 32, (c.InventorySize ?? 0) - VSRO_CANTA_BASI);
          const izgara = new Array(boy).fill(null);
          for (const x of inv) {
            const i = x.Slot - VSRO_CANTA_BASI;
            if (i < 0 || i >= boy) continue;
            const jw = kodOku(x.CodeName128);
            izgara[i] = {
              kap: 'bag', slot: i, bos: false, qty: 1,
              itemId: jw, vsroKod: x.CodeName128,
              katalog: jw ? esyaOzet(KATALOG.get(jw), c.gender ?? koddanCinsiyet(x.CodeName128)) : null,
            };
          }
          return izgara.map((v, i) => v ?? { kap: 'bag', slot: i, bos: true });
        })(),
        banka: await bankaOku(jid),
        pet: { buyuyenPet: null, binek: null, not: 'Çevrimdışı — pet durumu yalnız oturum içinde tutulur.' },
        uyari: 'Karakter çevrimdışı. Eşya düzenlemek için oyuna girmesi gerekiyor; sayısal değerler yine de değiştirilebilir (doğrudan _Char tablosuna yazılır).',
      };
    } catch (e) { return { hata: e.message }; }
  }

  async function dbSayisalYaz(id, s) {
    const p = await havuz();
    if (!p) return { hata: HAVUZ_HATA ?? 'veritabanı yok' };
    try {
      const rq = p.request().input('c', SQL.Int, id);
      const set = [];
      for (const [k, v] of Object.entries(s)) {
        const a = SAYISAL_ALANLAR[k]; if (!a) continue;
        rq.input(k, a.buyuk ? SQL.BigInt : SQL.Int, v);
        set.push(`${a.kolon}=@${k}`);
      }
      if (!set.length) return { ok: true };
      await rq.query(`UPDATE [${SEMA.shard}].dbo._Char SET ${set.join(', ')} WHERE CharID=@c`);
      return { ok: true };
    } catch (e) { return { hata: e.message }; }
  }

  /* ---------------------------------------------------------------- yazma */
  function yuvaYaz(canli, y) {
    const ch = canli.ch;
    const kap = String(y.kap ?? '');
    const slot = Number(y.slot);
    const temizle = y.itemId === null || y.itemId === '' || y.itemId === undefined;

    let kayit = null;
    if (!temizle) {
      const it = KATALOG.get(String(y.itemId));
      if (!it) return { hata: `katalogda böyle bir eşya yok: ${y.itemId}` };
      const adet = Math.max(1, Math.min(Number(y.qty) || 1, it.stackMax ?? 1));
      kayit = { itemId: it.id, qty: adet };
      const plus = Number(y.plus) || 0;
      /* +0..+22: perPlus alani olan esyalarda gecerli; ustu istemcide gosterilmiyor. */
      if (plus > 0) kayit.plus = Math.min(plus, 22);
      if (Array.isArray(it.rollRanges?.durability)) {
        kayit.maxDur = it.rollRanges.durability[1];
        kayit.dur = Number(y.dur) || kayit.maxDur;
      }
    }

    if (kap === 'bag') {
      if (!Array.isArray(ch.bag)) ch.bag = new Array(GCFG.bagSlots).fill(null);
      if (!Number.isInteger(slot) || slot < 0 || slot >= ch.bag.length) {
        return { hata: `çanta yuvası 0..${ch.bag.length - 1} arasında olmalı` };
      }
      ch.bag[slot] = kayit;
      return { mesaj: `çanta[${slot}] = ${temizle ? 'boş' : kayit.itemId + (kayit.qty > 1 ? ' x' + kayit.qty : '')}` };
    }
    if (KUSAM_YUVALARI.includes(kap)) {
      ch.equip = ch.equip ?? {};
      if (kayit) ch.equip[kap] = kayit; else delete ch.equip[kap];
      return { mesaj: `kuşam.${kap} = ${temizle ? 'boş' : kayit.itemId}` };
    }
    return { hata: `bilinmeyen kap: ${kap}` };
  }

  /** Panelin yazacagi S$ kaydini uretir (yuvaYaz ile AYNI kurallar). */
  function kayitUret(y) {
    const temizle = y.itemId === null || y.itemId === '' || y.itemId === undefined;
    if (temizle) return { kayit: null };
    const it = KATALOG.get(String(y.itemId));
    if (!it) return { hata: `katalogda böyle bir eşya yok: ${y.itemId}` };
    const adet = Math.max(1, Math.min(Number(y.qty) || 1, it.stackMax ?? 1));
    const kayit = { itemId: it.id, qty: adet };
    const plus = Number(y.plus) || 0;
    if (plus > 0) kayit.plus = Math.min(plus, 22);
    if (Array.isArray(it.rollRanges?.durability)) {
      kayit.maxDur = it.rollRanges.durability[1];
      kayit.dur = Number(y.dur) || kayit.maxDur;
    }
    return { kayit };
  }

  /** Karakterin hesap kimligini (JID) bulur - cevrimdisi banka duzenlemesi icin. */
  async function jidBul(charId) {
    const p = await havuz();
    if (!p) return null;
    try {
      const r = await p.request().input('c', SQL.Int, Number(charId))
        .query(`SELECT TOP 1 u.UserJID AS JID FROM [${SEMA.shard}].dbo._User u WHERE u.CharID=@c`);
      return r.recordset[0]?.JID ?? null;
    } catch { return null; }
  }

  /**
   * BANKA YUVASI YAZ - SRO_WEB_GAME.dbo.WebBank.
   *
   * Banka HESAP GENELIDIR (JID bazli), karaktere degil. Kayit bicimi
   * sistem_banka-depo.js ile AYNI olmak zorunda: (JID, Slot, StackJson) ve
   * ayni MERGE kalibi - iki taraf birbirinin satirini bozmasin.
   *
   * DIKKAT: oyuncu o anda banka penceresini acmissa modul kendi bellek
   * kopyasini tutuyor olabilir. Bu yuzden yazdiktan sonra istemciye
   * `bank.items` (182) karesini YENIDEN yolluyoruz; modulun bellegine
   * disaridan DOKUNMUYORUZ (kapsulleme korunuyor).
   */
  async function bankaYuvaYaz(JID, y, kayit) {
    const j = Number(JID);
    if (!Number.isInteger(j) || j <= 0) return { hata: 'JID bilinmiyor' };
    const slot = Number(y.slot);
    if (!Number.isInteger(slot) || slot < 0) return { hata: 'geçersiz banka yuvası' };
    const p = await havuz();
    if (!p) return { hata: HAVUZ_HATA ?? 'veritabanı yok' };
    try {
      if (!kayit) {
        await p.request().input('j', SQL.Int, j).input('s', SQL.Int, slot)
          .query('DELETE FROM dbo.WebBank WHERE JID=@j AND Slot=@s');
        return { mesaj: `banka[${slot}] = boş` };
      }
      await p.request().input('j', SQL.Int, j).input('s', SQL.Int, slot)
        .input('v', SQL.NVarChar(SQL.MAX), JSON.stringify(kayit))
        .query(`MERGE dbo.WebBank AS t
                USING (SELECT @j AS JID, @s AS Slot) AS k
                   ON t.JID = k.JID AND t.Slot = k.Slot
                WHEN MATCHED THEN UPDATE SET StackJson = @v
                WHEN NOT MATCHED THEN INSERT (JID, Slot, StackJson) VALUES (@j, @s, @v);`);
      return { mesaj: `banka[${slot}] = ${kayit.itemId}${kayit.qty > 1 ? ' x' + kayit.qty : ''}` };
    } catch (e) { return { hata: e.message }; }
  }

  /** Degisikligi oyuncunun istemcisine ANINDA yansitir - yeniden giris gerekmez. */
  function canliBildir(canli) {
    const { ws, ch, zoneId } = canli;
    try {
      if (ctx.envanterPayload) yolla(ws, 'inv.update', ctx.envanterPayload(ch));
      if (ctx.derived) {
        yolla(ws, 'stats.update', {
          base: { str: ch.str, int: ch.int, unspent: ch.statPoints },
          derived: ctx.derived(ch), hp: Math.round(ch.hp), mp: Math.round(ch.mp),
        });
      }
      /* Gorunum degistiyse bolgedeki HERKES gormeli - appearance.update (151).
         Sema: { id, equip: Record<string,string> }  (paket @25623981) */
      const gorunum = {};
      for (const y of KUSAM_YUVALARI) {
        const e = ch.equip?.[y];
        if (e) gorunum[y] = typeof e === 'string' ? e : e.itemId;
      }
      yolla(ws, 'appearance.update', { id: ws.entityId, equip: gorunum });
      ctx.broadcast?.(zoneId, 'appearance.update', { id: ws.entityId, equip: gorunum });
    } catch (e) { log(`[admin] canlı bildirim hatası: ${e.message}`); }
  }

  /* ================================================================== DIS YUZ */
  return {
    /**
     * GET /api/v1/admin/esya?q=...&tur=...&irk=...&derece=...&limit=...
     *
     * Arama artik COK TERIMLI: bosluklarla ayrilan her terim hem kimlikte hem
     * adda aranir ve HEPSI eslesmelidir ("gold blade" -> Gold Sealed ... Blade).
     * Ayrica tur / irk / derece suzgecleri var. Siralama: once tam eslesme,
     * sonra kimlik basi eslesmesi, sonra alfabetik - GM aradigini ilk satirda
     * gorsun.
     */
    esyaAra(q, secenek = {}) {
      const ham = String(q ?? '').trim().toLowerCase();
      const terimler = ham ? ham.split(/\s+/).filter(Boolean) : [];
      const tur = secenek.tur ? String(secenek.tur) : null;
      const irk = secenek.irk ? String(secenek.irk) : null;
      const derece = secenek.derece != null && secenek.derece !== '' ? Number(secenek.derece) : null;
      const limit = Math.max(1, Math.min(Number(secenek.limit) || 200, 600));

      const bulunan = [];
      for (const it of KATALOG.values()) {
        if (tur && (it.type ?? it.kind) !== tur) continue;
        if (irk && it.race !== irk) continue;
        if (derece != null && Number(it.degree) !== derece) continue;
        if (terimler.length) {
          const kimlik = it.id.toLowerCase();
          const ad = String(it.name ?? '').toLowerCase();
          if (!terimler.every(t => kimlik.includes(t) || ad.includes(t))) continue;
        }
        bulunan.push(it);
      }

      /* Alaka sirasi - yalniz arama varken anlamli. */
      if (terimler.length) {
        const ilk = terimler[0];
        const puan = (it) => {
          const kimlik = it.id.toLowerCase();
          const ad = String(it.name ?? '').toLowerCase();
          if (kimlik === ham || ad === ham) return 0;
          if (kimlik.startsWith(ilk) || ad.startsWith(ilk)) return 1;
          return 2;
        };
        bulunan.sort((a, b) => puan(a) - puan(b) || a.id.localeCompare(b.id));
      }

      return {
        satirlar: bulunan.slice(0, limit).map(it => esyaOzet(it)),
        eslesen: bulunan.length,
        toplam: KATALOG.size,
        kesildi: bulunan.length > limit,
        /* Panelin suzgec kutularini DOLDURMASI icin - liste UYDURULMAZ,
           katalogdan turer. */
        turler: [...new Set([...KATALOG.values()].map(x => x.type ?? x.kind).filter(Boolean))].sort(),
        irklar: [...new Set([...KATALOG.values()].map(x => x.race).filter(Boolean))].sort(),
        dereceler: [...new Set([...KATALOG.values()].map(x => x.degree).filter(v => v != null))].sort((a, b) => a - b),
      };
    },

    /** GET /api/v1/admin/karakter?id=123 */
    async detay(charId) {
      const id = Number(charId);
      if (!Number.isInteger(id)) return { hata: 'geçersiz CharID' };
      const canli = canliBul(id);
      if (!canli) return await dbDetay(id);

      const { ch, ws, zoneId } = canli;
      return {
        kaynak: 'canlı', cevrimici: true, duzenlenebilir: true,
        bilgi: {
          charId: ch.id, ad: ch.name, irk: ch.race, cinsiyet: ch.gender, bolge: zoneId,
          x: Math.round(ch.x), z: Math.round(ch.z), y: Math.round((ch.y ?? 0) * 10) / 10,
          JID: ws?.user?.JID ?? ws?.JID ?? null,
        },
        sayisal: {
          level: ch.level, xp: ch.xp ?? 0, sp: ch.sp ?? 0, spExp: ch.spExp ?? 0,
          statPoints: ch.statPoints ?? 0, str: ch.str, int: ch.int,
          gold: ch.gold ?? 0, hp: Math.round(ch.hp), mp: Math.round(ch.mp),
        },
        turetilmis: ctx.derived ? ctx.derived(ch) : null,
        kusam: KUSAM_YUVALARI.map((y, i) => yuvaKaydi(y, i, ch.equip?.[y], ch.gender)),
        canta: (Array.isArray(ch.bag) ? ch.bag : new Array(GCFG.bagSlots).fill(null))
          .map((v, i) => yuvaKaydi('bag', i, v, ch.gender)),
        banka: await bankaOku(ws?.user?.JID ?? ws?.JID),
        pet: petOzeti(ws),
        /* CANLI EK BILGI - yalniz oyundaki karakterde var. Bu alanlar
           zone.init.self semasinin (_ht, 36 alan) parcalari; sistem modulleri
           `selfAlanlari` kancasiyla dolduruyor. Panelde gostermek, bir alanin
           BOS kalip kalmadigini (ornek: premium kaybi, buff kaybi) GM'in
           gozuyle gormesini saglar. */
        canliEk: {
          savasta: !!ws.savas,
          hedefId: ws.hedefId ?? null,
          olu: !!ch.dead,
          dogusKorumasiBitis: ch.safeUntil ?? null,
          korumaKaldiSn: ch.safeUntil ? Math.max(0, Math.round((ch.safeUntil - Date.now()) / 1000)) : 0,
          premiumTier: ch.premiumTier ?? null,
          premiumBitis: ch.premiumExpiresAt ?? null,
          lonca: ch.guild ?? null,
          ustalik: Array.isArray(ch.masteries) ? ch.masteries.length : 0,
          ogrenilenBeceri: Array.isArray(ch.knownSkills) ? ch.knownSkills.length : 0,
          meslek: Array.isArray(ch.professions) ? ch.professions.length : 0,
          buff: Array.isArray(ch.buffs) ? ch.buffs.length : 0,
          durum: Array.isArray(ch.statuses) ? ch.statuses.length : 0,
          bekleme: Array.isArray(ch.cooldowns) ? ch.cooldowns.length : 0,
          iksirBeklemesi: Array.isArray(ch.potionCooldowns) ? ch.potionCooldowns.length : 0,
          hotbarVar: !!ch.hotbar,
          otoIksirVar: !!ch.autoPotion,
          makroVar: !!ch.macro,
        },
      };
    },

    /** POST /api/v1/admin/karakter  { charId, sayisal?, yuva? } */
    async guncelle(g) {
      const id = Number(g?.charId);
      if (!Number.isInteger(id)) return { code: 400, body: { error: 'geçersiz CharID' } };
      const canli = canliBul(id);
      const yapilan = [];

      /* -------------------------------------------------------- GM ISLEMLERI
       * Yeni REST ucu ACMIYORUZ: server.js su an baska bir gorevin sahipligi
       * altinda. Islemler ayni POST /api/v1/admin/karakter govdesinde
       * `islem` alaniyla tasiniyor.
       * Hepsi CANLI karakter gerektirir (bellekteki duruma dokunuyorlar). */
      if (g?.islem) {
        if (!canli) return { code: 409, body: { error: 'bu işlem için karakter ÇEVRİMİÇİ olmalı' } };
        const { ws, ch, zoneId } = canli;
        const islem = String(g.islem);

        if (islem === 'isinla') {
          const x = Number(g.x), z = Number(g.z);
          if (!Number.isFinite(x) || !Number.isFinite(z)) {
            return { code: 400, body: { error: 'geçersiz konum' } };
          }
          ch.x = x; ch.z = z;
          /* Zemine oturt - yoksa oyuncu havada ya da yerin altinda kalir.
             ctx.zoneGroundY verilmediyse dunyanin kendi zemin fonksiyonuna
             dus (World.groundY); o da yoksa y'ye dokunma. */
          const zemin = ctx.zoneGroundY ?? ctx.world?.groundY?.bind(ctx.world);
          if (zemin) { const y = zemin(zoneId, x, z, ch.y); if (Number.isFinite(y)) ch.y = y; }
          /* Yuruyus bacagini KES: yoksa oyuncu isinlandigi yerden eski
             hedefine dogru kendi kendine yurumeye devam eder. */
          ch.bacak = null;
          ws.savas = null; ws.hedefId = null;
          /* s2c 136 entity.teleport {id,x,z,y} - hem kendisine hem bolgeye.
             Cevredekiler de gormeli, aksi halde onlarin ekraninda eski
             konumda duruyor gorunur. */
          const tp = { id: ws.entityId, x: ch.x, z: ch.z, y: ch.y ?? 0 };
          yolla(ws, 'entity.teleport', tp);
          ctx.broadcast?.(zoneId, 'entity.teleport', tp, ws);
          yapilan.push(`ışınlandı → ${Math.round(x)}, ${Math.round(z)}`);
        } else if (islem === 'iyilestir') {
          const d = ctx.derived ? ctx.derived(ch) : null;
          ch.hp = d?.maxHp ?? ch.hp;
          ch.mp = d?.maxMp ?? ch.mp;
          ch.dead = false;
          yolla(ws, 'vitals.update', { hp: Math.round(ch.hp), mp: Math.round(ch.mp) });
          if (d) {
            ctx.broadcast?.(zoneId, 'entity.hp',
              { id: ws.entityId, hp: Math.round(ch.hp), maxHp: d.maxHp });
          }
          yapilan.push(`canı dolduruldu (${Math.round(ch.hp)}/${d?.maxHp ?? '?'})`);
        } else if (islem === 'dirilt') {
          /* gm.js 'revive' akisinin AYNASI (gm.js:295-309). 'iyilestir' olu
             karakterde YARIM kalir: ch.dead=false + vitals.update istemcideki
             olum perdesini KAPATMAZ - istemcide dead bayragini kapatan TEK
             mesaj revive.result (202) (paket @27126653; sema
             {id, ok, hp?, mp?, casterId?, skillId?}). Yalniz CEVRIMICI olu
             karakterde anlamli: _Char'da dead kolonu yok, cevrimdisi karakter
             giriste zaten canli (HP>=1) dogar. DB'ye anlik yazim YOK -
             gm revive gibi kalicilik periyodik ilerlemeImzasi ile. */
          if (!ch.dead) return { code: 400, body: { error: 'karakter zaten hayatta' } };
          const d = ctx.derived ? ctx.derived(ch) : { maxHp: ch.hp, maxMp: ch.mp };
          ch.dead = false; ch.hp = d.maxHp; ch.mp = d.maxMp;
          const sonuc = { id: ws.entityId, ok: true, hp: Math.round(ch.hp), mp: Math.round(ch.mp) };
          yolla(ws, 'revive.result', sonuc);
          ctx.broadcast?.(zoneId, 'revive.result', sonuc, ws);
          /* gm.js statYolla esdegeri: vitals + stats + bolgeye entity.hp. */
          yolla(ws, 'vitals.update', { hp: Math.round(ch.hp), mp: Math.round(ch.mp) });
          if (ctx.derived) {
            yolla(ws, 'stats.update', {
              base: { str: ch.str, int: ch.int, unspent: ch.statPoints ?? 0 },
              derived: d, hp: Math.round(ch.hp), mp: Math.round(ch.mp),
            });
            ctx.broadcast?.(zoneId, 'entity.hp',
              { id: ws.entityId, hp: Math.round(ch.hp), maxHp: d.maxHp });
          }
          yapilan.push(`yerinde diriltildi (${Math.round(ch.hp)}/${Math.round(ch.mp)})`);
        } else if (islem === 'kov') {
          /* s2c 241 kick {reason} - enum: login_elsewhere | slow_link |
             rate_limit | shutdown | gm | char_deleted | save_failed
             (paket @25632xxx). GM tarafindan dusurme icin 'gm' var. */
          yolla(ws, 'kick', { reason: 'gm' });
          setTimeout(() => { try { ws.close(4003); } catch { /* zaten kapali */ } }, 250);
          yapilan.push('oyundan düşürüldü (kick: gm)');
        } else if (islem === 'cantaTemizle') {
          const n = (ch.bag ?? []).filter(Boolean).length;
          ch.bag = new Array(ch.bag?.length ?? GCFG.bagSlots).fill(null);
          yapilan.push(`çanta temizlendi (${n} eşya silindi)`);
        } else {
          return { code: 400, body: { error: `bilinmeyen işlem: ${islem}` } };
        }
      }

      if (g?.sayisal && Object.keys(g.sayisal).length) {
        const s = {};
        for (const [k, v] of Object.entries(g.sayisal)) {
          const a = SAYISAL_ALANLAR[k];
          if (!a) return { code: 400, body: { error: `bilinmeyen alan: ${k}` } };
          const n = Number(v);
          if (!Number.isFinite(n) || !Number.isInteger(n)) return { code: 400, body: { error: `${a.ad}: tam sayı olmalı` } };
          if (n < a.min || n > a.max) return { code: 400, body: { error: `${a.ad}: ${a.min} ile ${a.max} arasında olmalı` } };
          s[k] = n;
        }
        if (canli) for (const [k, v] of Object.entries(s)) canli.ch[k] = v;
        const db = await dbSayisalYaz(id, s);
        yapilan.push(`sayısal → ${Object.entries(s).map(([k, v]) => `${k}=${v}`).join(', ')}`
          + (db.hata ? `  (DB yazılamadı: ${db.hata})` : '  (DB kalıcı)'));
      }

      if (g?.yuva) {
        /* BANKA ayri yol: hesap geneli ve DB'de duruyor -> karakter cevrimdisi
           olsa bile duzenlenebilir. */
        if (g.yuva.kap === 'bank') {
          const u = kayitUret(g.yuva);
          if (u.hata) return { code: 400, body: { error: u.hata } };
          const jid = canli ? (canli.ws?.user?.JID ?? canli.ws?.JID) : await jidBul(id);
          const r = await bankaYuvaYaz(jid, g.yuva, u.kayit);
          if (r.hata) return { code: 400, body: { error: r.hata } };
          yapilan.push(r.mesaj);
          if (canli) {
            const b = await bankaOku(jid);
            if (!b.yok) {
              yolla(canli.ws, 'bank.items', {
                capacity: b.kapasite,
                slots: b.yuvalar.filter(x => !x.bos).map(x => ({
                  slot: x.slot,
                  stack: { itemId: x.itemId, qty: x.qty,
                    ...(x.plus ? { plus: x.plus } : {}),
                    ...(x.dur != null ? { dur: x.dur, maxDur: x.maxDur } : {}) },
                })),
              });
            }
          }
        } else {
          if (!canli) {
            return { code: 409, body: { error: 'çanta/kuşam düzenlemek için karakter ÇEVRİMİÇİ olmalı (banka çevrimdışı da düzenlenebilir)' } };
          }
          const r = yuvaYaz(canli, g.yuva);
          if (r.hata) return { code: 400, body: { error: r.hata } };
          yapilan.push(r.mesaj);
        }
      }

      if (!yapilan.length) return { code: 400, body: { error: 'değişiklik yok' } };
      if (canli) canliBildir(canli);
      log(`[admin] karakter ${id}: ${yapilan.join(' | ')}`);
      return { code: 200, body: { ok: true, yapilan, detay: await this.detay(id) } };
    },

    /** Panelin kapatilirken havuzu birakmasi icin. */
    async kapat() { try { await HAVUZ?.close(); } catch { /* zaten kapali */ } HAVUZ = null; },
  };
}
