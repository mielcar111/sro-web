/**
 * GM komut sistemi.
 *
 * ARASTIRMA SONUCU (referans oyun istemcisinden):
 *   - Oyun istemcisinde GM konsolu YOK. Sohbet kutusu komut ayristirmiyor;
 *     yazdigini oldugu gibi `chat.send {ch, text}` olarak sunucuya gonderiyor.
 *   - `/gm ...` komutlarinin tamami SUNUCU tarafinda isleniyor. Istemcideki tek
 *     iz, `$comment` metinlerinde gecen "/gm reloadcombat", "/gm spawn",
 *     "/gm node", "/gm dummy" ifadeleri.
 *   - referans oyunun yonetim paneli AYRI bir web uygulamasi (oyun paketinde degil).
 *     Paketteki {worldId, players[role,state]} ve {source: gm|admin|watch}
 *     semalari o ayri servise ait - 194 oyun opcode'una dahil DEGILLER.
 *
 * Dolayisiyla GM yetkisi soyle calisir:
 *   TB_User.sec_primary = 1 VE sec_content = 1  ->  oyuncu GM  (vSRO kurali)
 *   sohbete "/gm ..." yazar  ->  sunucu yakalar, calistirir, sonucu sys.notice ile doner
 *   her komut SRO_WEB_GAME.dbo.WebGmLog tablosuna yazilir
 */

/**
 * vSRO KURALI (dogrulandi): hesap GM ise
 *     TB_User.sec_primary = 1  VE  TB_User.sec_content = 1
 * Normal oyuncuda ikisi de 3'tur (sutun varsayilani).
 * `GMrank` bu shard'da NULL - kullanilmiyor.
 *
 * Bu yuzden guvenlik sorusu numarasi TB_User.sec_primary'ye YAZILMAZ;
 * yoksa 1 numarali soruyu secen her oyuncu GM olurdu. Soru numarasi
 * SRO_WEB_GAME.WebSecurity.questionId'de tutulur.
 */
export function isGm(user) {
  return Number(user?.sec_primary) === 1 && Number(user?.sec_content) === 1;
}

/** Komut kayit defteri. Her biri {ad, kullanim, aciklama, calistir}. */
export function buildCommands(ctx) {
  const { world, broadcast, frame, zoneNpcEntities, zoneGroundY, db } = ctx;

  const komutlar = new Map();
  const ekle = (ad, kullanim, aciklama, calistir) =>
    komutlar.set(ad, { ad, kullanim, aciklama, calistir });

  ekle('help', '/gm help', 'komut listesi', async ({ ws }) => {
    const satirlar = [...komutlar.values()].map(k => `${k.kullanim} — ${k.aciklama}`);
    return { ok: true, mesaj: 'GM komutlari:\n' + satirlar.join('\n') };
  });

  ekle('where', '/gm where', 'bulundugun konum', async ({ ws }) => ({
    ok: true,
    mesaj: `zone=${ws.zoneId} x=${ws.char.x.toFixed(1)} z=${ws.char.z.toFixed(1)} y=${(ws.char.y ?? 0).toFixed(1)}`,
  }));

  ekle('tp', '/gm tp <x> <z> [zone]', 'isinlanma', async ({ ws, args }) => {
    const x = Number(args[0]), z = Number(args[1]);
    if (!Number.isFinite(x) || !Number.isFinite(z)) return { ok: false, mesaj: 'x ve z sayi olmali' };
    const zone = args[2] || ws.zoneId;
    if (!world.zones[zone]) return { ok: false, mesaj: 'bilinmeyen bolge: ' + zone };
    ws.char.x = x; ws.char.z = z; ws.char.zone = zone;
    ws.char.y = zoneGroundY(zone, x, z);
    frame(ws, 'entity.teleport', { id: ws.entityId, x, z, y: ws.char.y });
    broadcast(ws.zoneId, 'entity.teleport', { id: ws.entityId, x, z, y: ws.char.y }, ws);
    return { ok: true, mesaj: `isinlandin -> ${zone} (${x.toFixed(0)}, ${z.toFixed(0)}, y=${ws.char.y.toFixed(1)})` };
  });

  ekle('goto', '/gm goto <npcAdi>', 'NPC yanina isinlan', async ({ ws, args }) => {
    const q = (args.join(' ') || '').toLowerCase();
    if (!q) return { ok: false, mesaj: 'NPC adi gerekli' };
    const hedef = zoneNpcEntities(ws.zoneId).find(n => n.name.toLowerCase().includes(q));
    if (!hedef) return { ok: false, mesaj: 'NPC bulunamadi: ' + q };
    ws.char.x = hedef.x; ws.char.z = hedef.z; ws.char.y = hedef.y;
    frame(ws, 'entity.teleport', { id: ws.entityId, x: hedef.x, z: hedef.z, y: hedef.y });
    return { ok: true, mesaj: `${hedef.name} yanina isinlandin` };
  });

  ekle('node', '/gm node', 'bulundugun noktanin zemin verisi', async ({ ws }) => {
    const y = zoneGroundY(ws.zoneId, ws.char.x, ws.char.z);
    return { ok: true, mesaj: `zemin y=${y.toFixed(3)} (x=${ws.char.x.toFixed(1)} z=${ws.char.z.toFixed(1)})` };
  });

  ekle('dummy', '/gm dummy [sayi]', 'test hedefi olustur', async ({ ws, args }) => {
    const n = Math.min(Math.max(parseInt(args[0] || '1', 10) || 1, 1), 10);
    const eklenen = [];
    for (let i = 0; i < n; i++) {
      const a = (Math.PI * 2 * i) / n, r = 8;
      const x = ws.char.x + Math.cos(a) * r, z = ws.char.z + Math.sin(a) * r;
      eklenen.push({
        id: ctx.nextTempEntityId(), kind: 'monster', modelKey: 'mangyang',
        name: 'Test Kuklasi', x, z, y: zoneGroundY(ws.zoneId, x, z), rotY: 0,
        level: 1, hp: 1000, maxHp: 1000, dead: false,
      });
    }
    ctx.addTempEntities(ws.zoneId, eklenen);
    frame(ws, 'state.delta', { add: eklenen });
    broadcast(ws.zoneId, 'state.delta', { add: eklenen }, ws);
    return { ok: true, mesaj: `${n} test hedefi olusturuldu` };
  });

  ekle('spawn', '/gm spawn <modelKey> [sayi]', 'canavar olustur', async ({ ws, args }) => {
    const model = args[0];
    if (!model) return { ok: false, mesaj: 'modelKey gerekli (ornek: bandit)' };
    const n = Math.min(Math.max(parseInt(args[1] || '1', 10) || 1, 1), 20);
    const eklenen = [];
    for (let i = 0; i < n; i++) {
      const x = ws.char.x + (Math.random() - 0.5) * 20;
      const z = ws.char.z + (Math.random() - 0.5) * 20;
      eklenen.push({
        id: ctx.nextTempEntityId(), kind: 'monster', modelKey: model,
        name: model, x, z, y: zoneGroundY(ws.zoneId, x, z), rotY: 0,
        level: 1, hp: 500, maxHp: 500, dead: false,
      });
    }
    ctx.addTempEntities(ws.zoneId, eklenen);
    frame(ws, 'state.delta', { add: eklenen });
    broadcast(ws.zoneId, 'state.delta', { add: eklenen }, ws);
    return { ok: true, mesaj: `${n}x ${model} olusturuldu` };
  });

  ekle('clear', '/gm clear', 'olusturulan gecici varliklari sil', async ({ ws }) => {
    const silinen = ctx.clearTempEntities(ws.zoneId);
    if (silinen.length) {
      frame(ws, 'state.delta', { rem: silinen });
      broadcast(ws.zoneId, 'state.delta', { rem: silinen }, ws);
    }
    return { ok: true, mesaj: `${silinen.length} varlik silindi` };
  });

  ekle('heal', '/gm heal', 'canini doldur', async ({ ws, derived }) => {
    const d = derived(ws.char);
    ws.char.hp = d.maxHp; ws.char.mp = d.maxMp;
    /* SEMA: vitals.update (150) = { hp, mp } - `id` alani YOK (mesaj zaten
       yalniz kendine gonderiliyor). Cevredekilerin can cubugunu guncellemek
       icin ayri mesaj var: entity.hp (137) = { id, hp, maxHp }. */
    frame(ws, 'vitals.update', { hp: ws.char.hp, mp: ws.char.mp });
    broadcast(ws.zoneId, 'entity.hp', { id: ws.entityId, hp: ws.char.hp, maxHp: d.maxHp }, ws);
    return { ok: true, mesaj: `can/mana dolduruldu (${d.maxHp}/${d.maxMp})` };
  });

  ekle('notice', '/gm notice <mesaj>', 'tum sunucuya duyuru', async ({ ws, args }) => {
    const metin = args.join(' ').slice(0, 200);
    if (!metin) return { ok: false, mesaj: 'mesaj gerekli' };
    /* SEMA: chat.recv (160) alan adi `ch` - `channel` DEGIL. */
    ctx.broadcastAll('chat.recv', { ch: 'system', from: 'DUYURU', text: metin });
    return { ok: true, mesaj: 'duyuru gonderildi' };
  });

  ekle('who', '/gm who', 'cevrimici oyuncular', async () => {
    const list = ctx.onlinePlayers();
    return {
      ok: true,
      mesaj: `cevrimici: ${list.length}\n` +
        list.map(p => `  ${p.name} sv${p.level} @${p.zoneId} (${p.x.toFixed(0)},${p.z.toFixed(0)})`).join('\n'),
    };
  });

  ekle('kick', '/gm kick <ad>', 'oyuncuyu at', async ({ args }) => {
    const ad = (args[0] || '').toLowerCase();
    const hedef = ctx.findPlayer(ad);
    if (!hedef) return { ok: false, mesaj: 'oyuncu bulunamadi' };
    frame(hedef, 'kick', { reason: 'gm' });
    setTimeout(() => { try { hedef.close(4002); } catch {} }, 200);
    return { ok: true, mesaj: `${hedef.char.name} atildi` };
  });

  ekle('reloadcombat', '/gm reloadcombat', 'savas ayarlarini yeniden yukle', async () => {
    const n = ctx.reloadConfig();
    return { ok: true, mesaj: `yapilandirma yeniden yuklendi (${n} dosya)` };
  });


  /* ==================================================================
   * GENISLETILMIS KOMUT SETI
   *
   * NEDEN BURADA URETILIYOR: referans oyunun istemci paketinde GM komut listesi
   * YOKTUR (dogrulandi: tr.json'da yalnizca `kick.gm` var, "/gm" dizesi
   * pakette komut olarak gecmiyor). Yani "referans oyundan alinacak" bir liste
   * yok - GM araclari tamamen sunucu tarafi. Bu yuzden komutlar referans oyundan
   * KOPYALANMIYOR, DOGRULANMIS PROTOKOL KARELERIYLE kuruluyor:
   *     vitals.update (150)  entity.hp (137)  entity.teleport (136)
   *     inv.update (149)     stats.update (146)  appearance.update (151)
   *     chat.recv (160)      sys.notice (195)    kick (241)
   *     revive.result (202)  combat.death (141)
   * Hicbiri uydurma degil; hepsi data/schemas.json ve paketteki T$()
   * tanimlariyla ayni alan adlarini kullaniyor. Alan adi yanlis olan kare
   * istemcinin Zod dogrulamasindan gecmez ve SESSIZCE dusurulur.
   * ================================================================== */

  /** Sayi ayristirici - gecersizse null. */
  const sayi = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  /** Hedef secici: arguman verilmisse o oyuncu, verilmemisse komutu yazan. */
  const hedefSec = (ws, ad) => {
    if (!ad) return { ws, kendisi: true };
    const h = ctx.findPlayer?.(ad);
    return h ? { ws: h, kendisi: false } : null;
  };

  /** Karakterin turetilmis degerlerini istemciye yeniden bildirir. */
  const statYolla = (hedefWs) => {
    const ch = hedefWs.char;
    const d = ctx.derived ? ctx.derived(ch) : null;
    frame(hedefWs, 'vitals.update', { hp: Math.round(ch.hp), mp: Math.round(ch.mp) });
    if (d) {
      frame(hedefWs, 'stats.update', {
        base: { str: ch.str, int: ch.int, unspent: ch.statPoints ?? 0 },
        derived: d, hp: Math.round(ch.hp), mp: Math.round(ch.mp),
      });
      broadcast(hedefWs.zoneId, 'entity.hp',
        { id: hedefWs.entityId, hp: Math.round(ch.hp), maxHp: d.maxHp });
    }
  };

  /** Envanteri istemciye yeniden bildirir. */
  const envYolla = (hedefWs) => {
    if (!ctx.envanterPayload) return;
    frame(hedefWs, 'inv.update', ctx.envanterPayload(hedefWs.char));
  };

  /* ------------------------------------------------------------ KARAKTER */

  ekle('level', '/gm level <sv> [oyuncu]', 'seviye ayarla', async ({ ws, args }) => {
    const n = sayi(args[0]);
    if (n === null || n < 1 || n > 255) return { ok: false, mesaj: 'seviye 1..255 olmali' };
    const h = hedefSec(ws, args[1]);
    if (!h) return { ok: false, mesaj: `oyuncu bulunamadi: ${args[1]}` };
    h.ws.char.level = Math.trunc(n);
    statYolla(h.ws);
    return { ok: true, mesaj: `${h.ws.char.name} seviye ${n}` };
  });

  ekle('gold', '/gm gold <miktar> [oyuncu]', 'altin ayarla', async ({ ws, args }) => {
    const n = sayi(args[0]);
    if (n === null || n < 0) return { ok: false, mesaj: 'miktar 0 veya uzeri olmali' };
    const h = hedefSec(ws, args[1]);
    if (!h) return { ok: false, mesaj: `oyuncu bulunamadi: ${args[1]}` };
    h.ws.char.gold = Math.trunc(n);
    envYolla(h.ws);
    return { ok: true, mesaj: `${h.ws.char.name} altin = ${Math.trunc(n).toLocaleString('tr')}` };
  });

  ekle('sp', '/gm sp <miktar> [oyuncu]', 'beceri puani ayarla', async ({ ws, args }) => {
    const n = sayi(args[0]);
    if (n === null || n < 0) return { ok: false, mesaj: 'miktar 0 veya uzeri olmali' };
    const h = hedefSec(ws, args[1]);
    if (!h) return { ok: false, mesaj: `oyuncu bulunamadi: ${args[1]}` };
    h.ws.char.sp = Math.trunc(n);
    statYolla(h.ws);
    return { ok: true, mesaj: `${h.ws.char.name} SP = ${Math.trunc(n)}` };
  });

  ekle('stat', '/gm stat <puan> [oyuncu]', 'dagitilmamis stat puani', async ({ ws, args }) => {
    const n = sayi(args[0]);
    if (n === null || n < 0 || n > 32767) return { ok: false, mesaj: 'puan 0..32767 olmali' };
    const h = hedefSec(ws, args[1]);
    if (!h) return { ok: false, mesaj: `oyuncu bulunamadi: ${args[1]}` };
    h.ws.char.statPoints = Math.trunc(n);
    statYolla(h.ws);
    return { ok: true, mesaj: `${h.ws.char.name} stat puani = ${Math.trunc(n)}` };
  });

  ekle('str', '/gm str <deger> [oyuncu]', 'guc ayarla', async ({ ws, args }) => {
    const n = sayi(args[0]);
    if (n === null || n < 1 || n > 32767) return { ok: false, mesaj: 'deger 1..32767 olmali' };
    const h = hedefSec(ws, args[1]);
    if (!h) return { ok: false, mesaj: `oyuncu bulunamadi: ${args[1]}` };
    h.ws.char.str = Math.trunc(n);
    statYolla(h.ws);
    return { ok: true, mesaj: `${h.ws.char.name} STR = ${Math.trunc(n)}` };
  });

  ekle('int', '/gm int <deger> [oyuncu]', 'zeka ayarla', async ({ ws, args }) => {
    const n = sayi(args[0]);
    if (n === null || n < 1 || n > 32767) return { ok: false, mesaj: 'deger 1..32767 olmali' };
    const h = hedefSec(ws, args[1]);
    if (!h) return { ok: false, mesaj: `oyuncu bulunamadi: ${args[1]}` };
    h.ws.char.int = Math.trunc(n);
    statYolla(h.ws);
    return { ok: true, mesaj: `${h.ws.char.name} INT = ${Math.trunc(n)}` };
  });

  ekle('kill', '/gm kill [oyuncu]', 'oldur', async ({ ws, args }) => {
    const h = hedefSec(ws, args[0]);
    if (!h) return { ok: false, mesaj: `oyuncu bulunamadi: ${args[0]}` };
    const ch = h.ws.char;
    ch.hp = 0; ch.dead = true;
    h.ws.savas = null; h.ws.hedefId = null; ch.bacak = null;
    /* SEMA: combat.death (141) = { id, killerId, aid? } */
    frame(h.ws, 'combat.death', { id: h.ws.entityId, killerId: ws.entityId });
    broadcast(h.ws.zoneId, 'combat.death', { id: h.ws.entityId, killerId: ws.entityId }, h.ws);
    frame(h.ws, 'vitals.update', { hp: 0, mp: Math.round(ch.mp) });
    return { ok: true, mesaj: `${ch.name} olduruldu` };
  });

  ekle('revive', '/gm revive [oyuncu]', 'oldugu yerde tam canla dirilt', async ({ ws, args }) => {
    const h = hedefSec(ws, args[0]);
    if (!h) return { ok: false, mesaj: `oyuncu bulunamadi: ${args[0]}` };
    const ch = h.ws.char;
    if (!ch.dead) return { ok: false, mesaj: `${ch.name} zaten hayatta` };
    const d = ctx.derived ? ctx.derived(ch) : { maxHp: ch.hp, maxMp: ch.mp };
    ch.dead = false; ch.hp = d.maxHp; ch.mp = d.maxMp;
    /* SEMA: revive.result (202) = { id, ok, hp, mp, casterId?, skillId? }
       Istemcide `dead` bayragini kapatan TEK mesaj budur (paket @27126653). */
    const sonuc = { id: h.ws.entityId, ok: true, hp: ch.hp, mp: ch.mp };
    frame(h.ws, 'revive.result', sonuc);
    broadcast(h.ws.zoneId, 'revive.result', sonuc, h.ws);
    statYolla(h.ws);
    return { ok: true, mesaj: `${ch.name} yerinde diriltildi (${ch.hp}/${ch.mp})` };
  });

  ekle('peace', '/gm peace [saniye]', 'dogus korumasi ver (saldirilamaz)', async ({ ws, args }) => {
    const sn = sayi(args[0]) ?? 300;
    if (sn < 0 || sn > 86400) return { ok: false, mesaj: 'saniye 0..86400 olmali' };
    /* Dogus korumasi CIFT YONLUDUR: koruma acikken oyuncu da saldiramaz
       (tr.json ui.spawn.protected_chip_desc). Bu yuzden komutun adi "god"
       degil "peace" - yanlis beklenti yaratmasin. */
    ws.char.safeUntil = Date.now() + sn * 1000;
    return { ok: true, mesaj: sn > 0
      ? `${sn} sn dokunulmazlik (bu surede SEN de saldiramazsin)`
      : 'dokunulmazlik kaldirildi' };
  });

  /* --------------------------------------------------------------- ESYA */

  ekle('item', '/gm item <kimlik> [adet] [plus]', 'cantaya esya koy', async ({ ws, args }) => {
    if (!ctx.ITEMSTATS) return { ok: false, mesaj: 'esya katalogu yok' };
    const kimlik = String(args[0] ?? '');
    const it = ctx.ITEMSTATS.get(kimlik);
    if (!it) return { ok: false, mesaj: `katalogda yok: ${kimlik} (/gm find ile ara)` };

    const ch = ws.char;
    if (!Array.isArray(ch.bag)) return { ok: false, mesaj: 'canta hazir degil' };
    const bos = ch.bag.indexOf(null);
    if (bos < 0) return { ok: false, mesaj: 'canta dolu' };

    const adet = Math.max(1, Math.min(sayi(args[1]) ?? 1, it.stackMax ?? 1));
    const kayit = { itemId: it.id, qty: adet };
    const plus = sayi(args[2]) ?? 0;
    if (plus > 0) kayit.plus = Math.min(Math.trunc(plus), 22);
    if (Array.isArray(it.rollRanges?.durability)) {
      kayit.maxDur = it.rollRanges.durability[1];
      kayit.dur = kayit.maxDur;
    }
    ch.bag[bos] = kayit;
    envYolla(ws);
    return { ok: true, mesaj: `${it.name ?? it.id} x${adet}${plus > 0 ? ' +' + plus : ''} -> yuva ${bos}` };
  });

  ekle('find', '/gm find <metin>', 'esya katalogunda ara', async ({ args }) => {
    if (!ctx.ITEMSTATS) return { ok: false, mesaj: 'esya katalogu yok' };
    const terimler = String(args.join(' ')).toLowerCase().split(/\s+/).filter(Boolean);
    if (!terimler.length) return { ok: false, mesaj: 'aranacak metin gerekli' };
    const bulunan = [];
    for (const it of ctx.ITEMSTATS.values()) {
      const kimlik = String(it.id).toLowerCase();
      const ad = String(it.name ?? '').toLowerCase();
      if (!terimler.every(t => kimlik.includes(t) || ad.includes(t))) continue;
      bulunan.push(`${it.id} — ${it.name ?? ''}`);
      if (bulunan.length >= 15) break;
    }
    if (!bulunan.length) return { ok: false, mesaj: 'eslesen esya yok' };
    return { ok: true, mesaj: `${bulunan.length} sonuc:\n` + bulunan.join('\n') };
  });

  ekle('clearbag', '/gm clearbag', 'cantayi bosalt', async ({ ws }) => {
    const ch = ws.char;
    const n = (ch.bag ?? []).filter(Boolean).length;
    ch.bag = new Array(ch.bag?.length ?? 32).fill(null);
    envYolla(ws);
    return { ok: true, mesaj: `${n} esya silindi` };
  });

  /* -------------------------------------------------------------- KONUM */

  /** Ortak isinlanma: zemine oturt, bacagi kes, hem kendine hem bolgeye bildir. */
  const isinla = (hedefWs, x, z) => {
    const ch = hedefWs.char;
    ch.x = x; ch.z = z;
    const zemin = ctx.zoneGroundY ?? world?.groundY;
    if (zemin) {
      const y = zemin(hedefWs.zoneId, x, z, ch.y);
      if (Number.isFinite(y)) ch.y = y;
    }
    /* Bacak kesilmezse oyuncu isinlandigi yerden eski hedefine dogru
       kendi kendine yurumeye devam eder. */
    ch.bacak = null;
    hedefWs.savas = null; hedefWs.hedefId = null;
    const tp = { id: hedefWs.entityId, x: ch.x, z: ch.z, y: ch.y ?? 0 };
    frame(hedefWs, 'entity.teleport', tp);
    broadcast(hedefWs.zoneId, 'entity.teleport', tp, hedefWs);
  };

  ekle('tp', '/gm tp <x> <z>', 'konuma isinlan', async ({ ws, args }) => {
    const x = sayi(args[0]), z = sayi(args[1]);
    if (x === null || z === null) return { ok: false, mesaj: 'kullanim: /gm tp <x> <z>' };
    isinla(ws, x, z);
    return { ok: true, mesaj: `isinlandin -> ${Math.round(x)}, ${Math.round(z)}` };
  });

  ekle('goto', '/gm goto <oyuncu>', 'oyuncunun yanina git', async ({ ws, args }) => {
    const h = ctx.findPlayer?.(args[0]);
    if (!h) return { ok: false, mesaj: `oyuncu bulunamadi: ${args[0]}` };
    if (h.zoneId !== ws.zoneId) {
      return { ok: false, mesaj: `${h.char.name} baska bolgede (${h.zoneId}) — once /gm zone ${h.zoneId}` };
    }
    isinla(ws, h.char.x + 2, h.char.z);
    return { ok: true, mesaj: `${h.char.name} yanina isinlandin` };
  });

  ekle('summon', '/gm summon <oyuncu>', 'oyuncuyu yanina cagir', async ({ ws, args }) => {
    const h = ctx.findPlayer?.(args[0]);
    if (!h) return { ok: false, mesaj: `oyuncu bulunamadi: ${args[0]}` };
    if (h.zoneId !== ws.zoneId) {
      return { ok: false, mesaj: `${h.char.name} baska bolgede (${h.zoneId})` };
    }
    isinla(h, ws.char.x + 2, ws.char.z);
    frame(h, 'chat.recv', { ch: 'system', from: 'Sistem',
      text: `${ws.char.name} seni yanina cagirdi.` });
    return { ok: true, mesaj: `${h.char.name} cagrildi` };
  });

  ekle('zone', '/gm zone [bolge]', 'bolge listesi / bolge degistir', async ({ ws, args }) => {
    const hedef = args[0];
    if (!hedef) {
      const liste = Object.keys(world?.worldData?.zones ?? {});
      return { ok: true, mesaj: `bolgeler (${liste.length}):\n` + liste.join('\n') };
    }
    if (!ctx.bolgeGecisi) return { ok: false, mesaj: 'bolge gecisi kancasi yok' };
    const oldu = await ctx.bolgeGecisi(ws, hedef);
    return oldu
      ? { ok: true, mesaj: `bolge -> ${hedef}` }
      : { ok: false, mesaj: `bolgeye gecilemedi: ${hedef}` };
  });

  /* ------------------------------------------------------------ AYARLAR */

  ekle('rate', '/gm rate [ad] [deger]', 'sunucu ayarlarini canli degistir', async ({ args }) => {
    if (!ctx.admin) return { ok: false, mesaj: 'admin modulu yok' };
    const liste = ctx.admin.listele();
    if (!args[0]) {
      const satirlar = liste.alanlar.map(a => `${a.k} = ${a.deger}`);
      return { ok: true, mesaj: `ayarlar (${satirlar.length}):\n` + satirlar.join('\n') };
    }
    const ad = String(args[0]);
    if (args[1] === undefined) {
      const a = liste.alanlar.find(x => x.k === ad);
      return a
        ? { ok: true, mesaj: `${ad} = ${a.deger} (varsayilan ${a.orijinal ?? '—'})` }
        : { ok: false, mesaj: `bilinmeyen ayar: ${ad}` };
    }
    const r = ctx.admin.kaydet({ [ad]: args[1] });
    return r.code === 200
      ? { ok: true, mesaj: `${ad} = ${args[1]} (aninda uygulandi)` }
      : { ok: false, mesaj: r.body?.error ?? 'kaydedilemedi' };
  });

  ekle('save', '/gm save', 'karakteri hemen kaydet', async ({ ws }) => {
    if (!ctx.kaydet) return { ok: false, mesaj: 'kayit kancasi yok' };
    await ctx.kaydet(ws);
    return { ok: true, mesaj: 'kaydedildi' };
  });

  ekle('pos', '/gm pos <oyuncu>', 'oyuncunun konumu', async ({ args }) => {
    const h = ctx.findPlayer?.(args[0]);
    if (!h) return { ok: false, mesaj: `oyuncu bulunamadi: ${args[0]}` };
    return { ok: true, mesaj: `${h.char.name}: ${h.zoneId} ${Math.round(h.char.x)}, ${Math.round(h.char.z)} (sv ${h.char.level})` };
  });

  return komutlar;
}

/**
 * Sohbete yazilan metni GM komutu olarak isler.
 * Komut degilse null doner (normal sohbet gibi devam eder).
 */
export async function handleGmChat(text, ws, komutlar, ctx) {
  const t = String(text ?? '').trim();
  if (!t.startsWith('/gm')) return null;

  if (!isGm(ws.user)) {
    return { ok: false, mesaj: 'bu komut icin GM yetkisi gerekli' };
  }

  const parcalar = t.slice(3).trim().split(/\s+/).filter(Boolean);
  const ad = (parcalar.shift() || 'help').toLowerCase();
  const komut = komutlar.get(ad);
  if (!komut) {
    return { ok: false, mesaj: `bilinmeyen komut: ${ad} (/gm help)` };
  }
  try {
    const sonuc = await komut.calistir({ ws, args: parcalar, ...ctx });
    ctx.logGm?.(ws, t, sonuc.ok);
    return sonuc;
  } catch (e) {
    return { ok: false, mesaj: 'komut hatasi: ' + e.message.slice(0, 120) };
  }
}
