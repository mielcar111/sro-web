/**
 * PARTI SISTEMI  -  sistem_parti.js
 * =================================================================
 * Isledigi c2s mesajlari (opcode'lar protocol.js ile birebir):
 *    71  party.create   { expShare:bool, itemShare:bool }
 *    72  party.match    { op: sub | unsub | register | unregister
 *                             | apply | applyCancel | applyRespond , ... }
 *    88  party.invite   { targetId:int }            <- ENTITY id, charId DEGIL
 *    89  party.respond  { accept:bool }
 *    90  party.leave    { }
 *    91  party.kick     { charId:string }
 *    92  party.lead     { charId:string }
 *
 * Urettigi s2c kareleri:
 *   168 party.invited            172? hayir - 168
 *   169 party.update
 *   170 party.left
 *   174 party.matchBoard
 *   175 party.matchApplication
 *   195 sys.notice   (sadece Tht listesindeki gecerli anahtarlarla)
 *   240 err          (sadece Sht listesindeki gecerli kodlarla)
 *
 * -----------------------------------------------------------------
 * SEMA KAYNAGI - hepsi okunabilir istemci paketinden ALINDI:
 *   playjs_source\index-BUMMQVRB.js
 *
 *   char 25611125 : T$(`party.create`, 71, X({ expShare: RJ(), itemShare: RJ() }), `misc`)
 *   char 25611218 : var Dht = qJ([`chinese`,`european`,`both`])
 *                   T$(`party.match`, 72, HJ(`op`, [ ...7 dal... ]), `misc`)
 *                     sub | unsub
 *                     register     { title: J().min(1).max(64), raceReq: Dht,
 *                                    minLevel: int 1..200, maxLevel: int 1..200 }
 *                     unregister
 *                     apply        { matchId: Y().int().positive() }
 *                     applyCancel
 *                     applyRespond { applicantCharId: J(), accept: RJ() }
 *   char 25611906 : T$(`party.invite`, 88, X({ targetId: Y().int() }), `misc`)
 *   char 25611964 : T$(`party.respond`, 89, X({ accept: RJ() }), `misc`)
 *   char 25612016 : T$(`party.leave`, 90, X({}), `misc`)
 *   char 25612046 : T$(`party.kick`, 91, X({ charId: J() }), `misc`)
 *   char 25612095 : T$(`party.lead`, 92, X({ charId: J() }), `misc`)
 *
 *   char 25625268 : T$(`party.invited`, 168, X({
 *                     fromCharId: J(), fromName: J(), fromLevel: Y().int(),
 *                     partySize: Y().int(), partyCap: Y().int().optional(),
 *                     expiresAt: Y() }))
 *   char 25625300 : var Nht = X({          // party.update icindeki UYE semasi
 *                     charId:J(), name:J(), level:int, entityId:int, zoneId:J(),
 *                     x:int?, z:int?, hp:int, maxHp:int, mp:int?, maxMp:int?,
 *                     buffs:[]?, statuses:[]?, dead:bool?, linkdead:bool?,
 *                     premiumTier:?, style:J()?, topMasteries:[]?, race:J()? })
 *                   -> charId, name, level, entityId, zoneId, hp, maxHp ZORUNLU.
 *   char 25625918 : T$(`party.update`, 169, X({ partyId:J(), leaderCharId:J(),
 *                     members: BJ(Nht), expShare:bool?, itemShare:bool?,
 *                     matchId:int? }))
 *   char 25626099 : T$(`party.left`, 170, X({ reason: qJ([`left`,`kicked`,`disband`]) }))
 *   char 25626174 : T$(`party.matchBoard`, 174, X({ rows: BJ(X({
 *                     matchId:int, title:J(), leaderName:J(), raceReq:Dht,
 *                     minLevel:int, maxLevel:int, memberCount:int, maxMembers:int,
 *                     expShare:bool, itemShare:bool, ltp:bool })),
 *                     appliedMatchId:int? }))
 *   char 25626511 : T$(`party.matchApplication`, 175, X({ applicant: X({
 *                     charId:J(), name:J(), level:int, race:J(), expiresAt:Y()
 *                   }).nullable() }))
 *
 *   char 25602274 : var Sht = `...ERR_PARTY_FULL.ERR_PARTY_NOT_LEADER.
 *                   ERR_PARTY_IN_PARTY.ERR_PARTY_NO_INVITE.ERR_PARTY_NOT_MEMBER.
 *                   ERR_PARTY_MATCH_STATE...`   (err.code enum'u)
 *   char 25603200 : var Tht = `...sys.party.invite_sent,sys.party.invite_declined,
 *                   sys.party.join_failed,sys.party.not_in_party,
 *                   sys.party.match_registered,sys.party.match_unregistered,
 *                   sys.party.match_applied,sys.party.match_apply_refused,
 *                   sys.party.match_apply_expired...`   (sys.notice key enum'u)
 *
 * LTP TANIMI - uydurma degil, istemcinin kendi kodu:
 *   char 27517950  DLt(): v_r = !expShare && !itemShare  ->  LTP rozeti
 *   char 27527278  v_u = (expShare===false && itemShare===false)
 *                        ? gameConfig.ltpMaxMembers : gameConfig.partyMaxSize
 *   locale ui.party.ltp_title = "Long Term Party - 4 members max;
 *                                +10% XP/SP while the party is full"
 *   => LTP = iki paylasim da KAPALI. Kapasite ltpMaxMembers(4).
 *      Parti DOLU iken (>= ltpMinMembers) +ltpXpBonusPct(%10) XP/SP.
 *
 * BASVURU KAPILARI - istemci MLt() satir bilesenindeki engelleri birebir
 * yansitiyoruz (char 27522100 civari):
 *   blocked_in_party  : zaten bir partidesin
 *   blocked_pending   : baska bir ilana basvurun duruyor
 *   blocked_full      : memberCount >= maxMembers
 *   blocked_level     : level < minLevel || level > maxLevel
 *   blocked_race      : raceReq !== 'both' && raceReq !== race
 *
 * KALICILIK:
 *   Partinin KENDISI calisma zamaninda tutulur (vSRO'da parti tablosu yoktur,
 *   SRO_VT_SHARD'da '%Party%' eslesen tek nesne _Guild_MatchHostileGuild'dir).
 *   Parti ESLESTIRME PANOSU ise gercekten DB'de:
 *     SRO_WEB_GAME.dbo.WebPartyMatch          (12 kolon - canli semadan okundu)
 *       matchId int IDENTITY PK, leaderCharID int, title nvarchar(100),
 *       raceReq varchar(16) NULL, minLevel int def 1, maxLevel int def 999,
 *       maxMembers int def 8, expShare bit def 1, itemShare bit def 1,
 *       ltp bit def 0, isOpen bit def 1, createdAt datetime def getdate()
 *     SRO_WEB_GAME.dbo.WebPartyMatchApplication   (5 kolon)
 *       id bigint IDENTITY PK, matchId int, CharID int,
 *       status varchar(12) def 'pending', at datetime def getdate()
 *   (title zaten partyMatchTitleMaxLen=40'a kirpildigi icin nvarchar(100)
 *    kolonu tasmaz.)
 *   ctx.web bu veritabanina bagli havuzdur. web yoksa pano yalnizca bellekte
 *   yasar (matchId yerel sayacla uretilir) ve sistem calismaya devam eder.
 */

/* ---------------------------------------------------------------- sabitler */

/** sys.notice icin GECERLI parti anahtarlari (Tht listesinden). */
const NOTICE = {
  INVITE_SENT: 'sys.party.invite_sent',
  INVITE_DECLINED: 'sys.party.invite_declined',
  JOIN_FAILED: 'sys.party.join_failed',
  NOT_IN_PARTY: 'sys.party.not_in_party',
  MATCH_REGISTERED: 'sys.party.match_registered',
  MATCH_UNREGISTERED: 'sys.party.match_unregistered',
  MATCH_APPLIED: 'sys.party.match_applied',
  MATCH_APPLY_REFUSED: 'sys.party.match_apply_refused',
  MATCH_APPLY_EXPIRED: 'sys.party.match_apply_expired',
};

/** err.code icin GECERLI kodlar (Sht listesinden). */
const ERR = {
  VALIDATION: 'ERR_VALIDATION',
  RANGE: 'ERR_RANGE',
  NOT_FOUND: 'ERR_NOT_FOUND',
  BUSY: 'ERR_BUSY',
  DEAD: 'ERR_DEAD',
  FULL: 'ERR_PARTY_FULL',
  NOT_LEADER: 'ERR_PARTY_NOT_LEADER',
  IN_PARTY: 'ERR_PARTY_IN_PARTY',
  NO_INVITE: 'ERR_PARTY_NO_INVITE',
  NOT_MEMBER: 'ERR_PARTY_NOT_MEMBER',
  MATCH_STATE: 'ERR_PARTY_MATCH_STATE',
};

const IRKLAR = new Set(['chinese', 'european', 'both']);

const ISLENEN = new Set([
  'party.create', 'party.invite', 'party.respond', 'party.leave',
  'party.kick', 'party.lead', 'party.match',
]);

/* ---------------------------------------------------------------- modul */

/* ====================================== ORNEK OMRU / DEVIR (KALICILIK DEGIL)
 * server.js `sistemleriKur()` (server.js:1337) SISTEMLER dizisini bosaltip TUM
 * modulleri bastan kuruyor - acilista iki kez, sonra admin panelindeki HER
 * ayar degisiminde. Parti/ilan defterleri kur() ICINDE dursaydi, o anda oyunda
 * olan BUTUN PARTILER sunucuda dagilirdi (istemcide pencere acik kalarak).
 *
 * DIKKAT: bu KALICILIK DEGIL - hicbir sey diske yazilmiyor. Parti uyeligi
 * bilerek OTURUM ICI kaliyor: paket tarafinda partiyi diske yazan bir kare
 * yok, zone.init.self (_ht, 36 alan) icinde `party` alani YOK ve istemci
 * auth.ok'ta `j$.setParty(null)` ile partiyi kendisi temizliyor
 * (paket @27116400). Yalnizca AYNI SUREC ICINDEKI yeniden kurulumu atlatiyoruz.
 *
 * `davetler` ve `basvurular` BILEREK ornek kapsaminda: davet 30 sn'lik gecici
 * teklif (GCFG.partyInviteTimeoutMs) ve setTimeout'u eski ornekle birlikte
 * olur - devretmek "asla dolmayan davet" uretirdi.
 */
const PARTILER = new Map();       // partyId -> parti
const CHAR_PARTI = new Map();     // charId  -> partyId
const ILANLAR = new Map();        // matchId -> ilan
const PARTI_ILAN = new Map();     // partyId -> matchId

export function kur(ctx = {}) {
  const {
    world = null,
    frame = () => {},
    log = () => {},
    GCFG = {},
    web = null,
    derived = null,
    /* MADDE 19 (capraz istek 36, fark #193): uye yukune buff/durum eklemek
       icin sistem_beceri.varlikAlanlari kancasi. */
    sistemOrnegi = null,
  } = ctx;

  /* --- ayarlar: hepsi data/game-config.json'dan. Yedek degerler istemcinin
     KENDI Zod .default()'larindan (char 8649687 civari); orada default'u
     olmayan alanlar icin yedek YOK, eksikse gurultulu log basariz. --- */
  const AYAR = {
    partyMaxSize: GCFG.partyMaxSize,
    partyShareRangeU: GCFG.partyShareRangeU,
    partyXpBonusPerMember: GCFG.partyXpBonusPerMember,
    xpShareMode: GCFG.xpShareMode ?? 'party',            // Zod default `party`
    partyInviteTimeoutMs: GCFG.partyInviteTimeoutMs,
    ltpMinMembers: GCFG.ltpMinMembers ?? 4,              // Zod default 4
    ltpMaxMembers: GCFG.ltpMaxMembers ?? 4,              // Zod default 4
    ltpXpBonusPct: GCFG.ltpXpBonusPct ?? 10,             // Zod default 10
    partyMatchTitleMaxLen: GCFG.partyMatchTitleMaxLen ?? 40, // Zod default 40
  };
  for (const [k, v] of Object.entries(AYAR)) {
    if (v == null) log(`parti: game-config.${k} EKSIK - bu ayara bagli kontrol calismaz`);
  }

  /* --- durum ---  (devir kurallari: yukaridaki ORNEK OMRU blogu) */
  const partiler = PARTILER;      // partyId  -> parti      [devrolur]
  const charParti = CHAR_PARTI;   // charId   -> partyId    [devrolur]
  const davetler = new Map();     // hedefCharId -> davet   [GECICI - devrolmaz]
  const ilanlar = ILANLAR;        // matchId  -> ilan       [devrolur]
  const partiIlan = PARTI_ILAN;   // partyId  -> matchId    [devrolur]
  const basvurular = new Map();   // basvuranCharId -> basvuru [GECICI]
  const panoAbone = new Set();    // ws                     [GECICI]
  let sonrakiPartyId = 1;
  /* Devralinan partiler varsa sayaci onlarin ustune tasi (id CAKISMASI olmasin).
     Kimlik bicimi `p<N>` (asagida `id: \`p${sonrakiPartyId++}\``), o yuzden
     `p` oneki soyulmadan Number() NaN doner ve sayac bozulurdu. */
  for (const id of partiler.keys()) {
    const n = Number(String(id).replace(/^p/, ''));
    if (Number.isFinite(n)) sonrakiPartyId = Math.max(sonrakiPartyId, n + 1);
  }
  /* yalnizca web yokken kullanilir. Devralinan ilanlarin ustune tasiniyor:
     aksi halde yeniden kurulumdan sonra ayni matchId ikinci kez uretilir ve
     eski ilan sessizce ezilirdi. */
  let yerelMatchId = 0;
  for (const mid of ilanlar.keys()) {
    const n = Number(mid);
    if (Number.isFinite(n)) yerelMatchId = Math.max(yerelMatchId, n);
  }

  /* ------------------------------------------------------------ yardimci */

  const now = () => Date.now();
  const S = (v) => String(v ?? '');
  const tam = (v) => Math.round(Number(v) || 0);

  /** Bagli TUM oyuncu soketleri (world.zoneState herkese acik bir Map). */
  function tumIstemciler() {
    if (typeof ctx.istemciler === 'function') return ctx.istemciler();
    const out = [];
    const zs = world?.zoneState;
    if (!zs) return out;
    for (const z of zs.values()) {
      for (const c of (z.players ?? [])) if (c?.isAuthed && c.char) out.push(c);
    }
    return out;
  }

  /**
   * charId / entityId -> ws indeksi. Bir islemin BASINDA bir kez kurulur ve
   * o islem boyunca yeniden kullanilir.
   * Neden: eskiden her uye icin bagli TUM oyuncular yeniden taraniyordu.
   * 8 kisilik bir partide tek bir party.update 16 tam tarama demekti ve
   * paylasimHesapla HER canavar olumunde cagriliyor.
   * @param {object|null} haric indekse ALINMAYACAK soket (kopan soket).
   */
  function indeksYap(haric = null) {
    const byChar = new Map(), byEntity = new Map();
    for (const c of tumIstemciler()) {
      if (c === haric) continue;
      byChar.set(S(c.char.id), c);
      byEntity.set(c.entityId, c);
    }
    return { byChar, byEntity };
  }

  function wsCharId(charId, idx = null) {
    const hedef = S(charId);
    if (idx) return idx.byChar.get(hedef) ?? null;
    for (const c of tumIstemciler()) if (S(c.char.id) === hedef) return c;
    return null;
  }

  function wsEntity(entityId, idx = null) {
    if (idx) return idx.byEntity.get(entityId) ?? null;
    for (const c of tumIstemciler()) if (c.entityId === entityId) return c;
    return null;
  }

  function hata(ws, code, params) {
    frame(ws, 'err', params ? { code, params } : { code });
    return true;
  }

  function bildir(ws, key, params) {
    if (!ws) return;
    frame(ws, 'sys.notice', params ? { key, params } : { key });
  }

  function maxHpOf(ch) {
    if (typeof derived === 'function') { const d = derived(ch); if (d?.maxHp) return tam(d.maxHp); }
    return tam(ch.maxHp ?? ch.hp ?? 0);
  }
  function maxMpOf(ch) {
    if (typeof derived === 'function') { const d = derived(ch); if (d?.maxMp) return tam(d.maxMp); }
    return tam(ch.maxMp ?? ch.mp ?? 0);
  }

  /** LTP mi? Istemcinin kurali: iki paylasim da KAPALI. */
  const ltpMi = (p) => p.expShare === false && p.itemShare === false;
  /** Kapasite: LTP ise ltpMaxMembers, degilse partyMaxSize. */
  const kapasite = (p) => (ltpMi(p) ? AYAR.ltpMaxMembers : AYAR.partyMaxSize);

  const partiOf = (charId) => partiler.get(charParti.get(S(charId))) ?? null;
  const partiOfWs = (ws) => (ws?.char ? partiOf(ws.char.id) : null);

  /* --------------------------------------------------------- uye kaydi */

  /** Uye anlik goruntusunu (isim/seviye/hp/konum) canli sokete gore tazeler. */
  function uyeTazele(uye, c) {
    if (!c?.char) return uye;
    const ch = c.char;
    uye.name = S(ch.name);
    uye.level = tam(ch.level);
    uye.entityId = tam(c.entityId);
    uye.zoneId = S(c.zoneId ?? ch.zone);
    uye.x = tam(ch.x);
    uye.z = tam(ch.z);
    uye.hp = Math.max(0, tam(ch.hp));
    uye.maxHp = Math.max(1, maxHpOf(ch));
    uye.mp = Math.max(0, tam(ch.mp));
    uye.maxMp = Math.max(0, maxMpOf(ch));
    uye.style = ch.style == null ? null : S(ch.style);
    uye.race = ch.race == null ? null : S(ch.race);
    return uye;
  }

  function uyeYarat(c) {
    const ch = c.char;
    return uyeTazele({
      charId: S(ch.id), name: '', level: 1, entityId: 0, zoneId: '',
      x: 0, z: 0, hp: 0, maxHp: 1, mp: 0, maxMp: 0,
      style: null, race: null, katildi: now(),
    }, c);
  }

  /** party.update icin uye yuku (Nht semasi). */
  function uyePayload(uye, idx = null) {
    const c = wsCharId(uye.charId, idx);
    if (c) uyeTazele(uye, c);
    const p = {
      charId: uye.charId,
      name: uye.name,
      level: uye.level,
      entityId: uye.entityId,      // cevrimdisi uyede son bilinen id kalir
      zoneId: uye.zoneId,
      x: uye.x, z: uye.z,
      hp: uye.hp, maxHp: uye.maxHp,
      mp: uye.mp, maxMp: uye.maxMp,
      dead: uye.hp <= 0,
    };
    if (!c) p.linkdead = true;     // sokedi kopmus uye - istemci gri gosterir
    if (uye.style != null) p.style = uye.style;
    if (uye.race != null) p.race = uye.race;
    /* MADDE 19 (capraz istek 36b, fark #193): party.update uye kaydina
       buff/durum rozetleri. sistem_beceri.varlikAlanlari zaten tel semasina
       uygun {buffs, statuses} uretiyor; modul yoksa alanlar hic eklenmez
       (sema her ikisini de optional tasiyor - sistem_parti.js:50 basligi). */
    if (c?.char) {
      const va = sistemOrnegi?.('beceri')?.varlikAlanlari?.(c.char) ?? {};
      if (va.buffs) p.buffs = va.buffs;
      if (va.statuses) p.statuses = va.statuses;
      /* S1 MADDE 8 (D sikayeti): party.update uye kaydina premiumTier -
         parti kartindaki altin cerceve. Istemci okuyuculari hazir (Nht uye
         semasi premiumTier optional @25626672; party-card @27511911,
         pw-member-row @27531180), eksik yalniz bu sunucu alaniydi.
         varlikAlanlari sure kontrolunu kendisi yapar (gecersiz/suresi dolmus
         -> {}); alan opsiyonel oldugu icin yoklugu da gecerli - sure dolunca
         bir sonraki party.update alani birakir, cerceve kendiliginden soner. */
      const pv = sistemOrnegi?.('kucuk-sistemler')?.varlikAlanlari?.(c.char);
      if (pv?.premiumTier) p.premiumTier = pv.premiumTier;
    }
    return p;
  }

  /* ------------------------------------------------------- yayim (169) */

  function updatePayload(p, idx = null) {
    const d = {
      partyId: p.id,
      leaderCharId: p.leaderCharId,
      members: p.uyeler.map(u => uyePayload(u, idx)),
      expShare: p.expShare,
      itemShare: p.itemShare,
    };
    const mid = partiIlan.get(p.id);
    if (mid != null) d.matchId = mid;
    return d;
  }

  /** Partinin TUM cevrimici uyelerine party.update yollar. */
  function yayinla(p, idx = null) {
    if (!p) return;
    const ix = idx ?? indeksYap();
    const d = updatePayload(p, ix);
    for (const u of p.uyeler) {
      const c = wsCharId(u.charId, ix);
      if (c) frame(c, 'party.update', d);
    }
  }

  function partiYarat(c, expShare, itemShare) {
    const p = {
      id: `p${sonrakiPartyId++}`,
      leaderCharId: S(c.char.id),
      uyeler: [uyeYarat(c)],
      expShare: !!expShare,
      itemShare: !!itemShare,
      olusturuldu: now(),
    };
    partiler.set(p.id, p);
    charParti.set(p.leaderCharId, p.id);
    return p;
  }

  /**
   * Liderlik degistiginde ACIK ilanin lider bilgisini de tazeler.
   * Yoksa pano satiri (174 rows[].leaderName) partiden ayrilmis eski liderin
   * adini gostermeye devam ediyordu.
   */
  function ilanLideriTazele(p) {
    const mid = partiIlan.get(p.id);
    if (mid == null) return false;
    const il = ilanlar.get(mid);
    if (!il) return false;
    const yeni = p.uyeler.find(u => u.charId === p.leaderCharId);
    il.leaderCharId = p.leaderCharId;
    if (yeni?.name) il.leaderName = yeni.name;
    return true;
  }

  /** Uyeyi partiden cikarir; parti bosalirsa parti (ve ilani) yok olur. */
  function uyeCikar(p, charId, sebep) {
    const id = S(charId);
    const i = p.uyeler.findIndex(u => u.charId === id);
    if (i < 0) return false;
    p.uyeler.splice(i, 1);
    charParti.delete(id);

    const idx = indeksYap();
    const c = wsCharId(id, idx);
    if (c) frame(c, 'party.left', { reason: sebep });

    if (!p.uyeler.length) {
      ilaniKaldir(p, false, idx);
      partiler.delete(p.id);
      return true;
    }
    if (p.leaderCharId === id) {
      // Lider ayrildi: liderlik en ESKI uyeye gecer (katilma sirasi).
      p.uyeler.sort((a, b) => a.katildi - b.katildi);
      p.leaderCharId = p.uyeler[0].charId;
      ilanLideriTazele(p);
    }
    yayinla(p, idx);
    panoYayinla(idx);
    return true;
  }

  /* ------------------------------------------------------ pano (174/175) */

  function ilanSatir(il) {
    const p = partiler.get(il.partyId);
    return {
      matchId: il.matchId,
      title: il.title,
      leaderName: il.leaderName,
      raceReq: il.raceReq,
      minLevel: il.minLevel,
      maxLevel: il.maxLevel,
      memberCount: p ? p.uyeler.length : 0,
      maxMembers: il.maxMembers,
      expShare: il.expShare,
      itemShare: il.itemShare,
      ltp: il.ltp,
    };
  }

  function panoGonder(ws) {
    const rows = [];
    for (const il of ilanlar.values()) {
      if (!il.isOpen) continue;
      if (!partiler.has(il.partyId)) continue;   // partisi dagilmis ilan
      rows.push(ilanSatir(il));
    }
    rows.sort((a, b) => a.matchId - b.matchId);
    const d = { rows };
    const bv = ws?.char ? basvurular.get(S(ws.char.id)) : null;
    if (bv) d.appliedMatchId = bv.matchId;
    frame(ws, 'party.matchBoard', d);
  }

  function panoYayinla(idx = null) {
    if (!panoAbone.size) return;
    const ix = idx ?? indeksYap();
    /* Indeks bosken (ctx.world hic gelmemisse) kimseyi atmayiz - yoksa tek bir
       eksik baglama TUM aboneleri sessizce dusururdu. */
    const bagli = ix.byChar.size > 0;
    for (const ws of [...panoAbone]) {
      const kopmus = ws?.isAuthed === false ||
                     (bagli && !ix.byChar.has(S(ws?.char?.id)));
      if (kopmus) { panoAbone.delete(ws); continue; }   // kopan soket birikmesin
      panoGonder(ws);
    }
  }

  function basvuruTemizle(charId, { liderBilgilendir = true } = {}) {
    const id = S(charId);
    const bv = basvurular.get(id);
    if (!bv) return null;
    basvurular.delete(id);
    if (bv.zamanlayici) clearTimeout(bv.zamanlayici);
    const il = ilanlar.get(bv.matchId);
    if (liderBilgilendir && il) {
      const p = partiler.get(il.partyId);
      const lider = p ? wsCharId(p.leaderCharId) : null;
      if (lider) frame(lider, 'party.matchApplication', { applicant: null });
    }
    return bv;
  }

  function ilaniKaldir(p, bildirimVar = true, idx = null) {
    const mid = partiIlan.get(p.id);
    if (mid == null) return false;
    const ix = idx ?? indeksYap();
    partiIlan.delete(p.id);
    const il = ilanlar.get(mid);
    if (il) { il.isOpen = false; ilanlar.delete(mid); }
    // Bu ilana bekleyen basvurular dusurulur.
    for (const [cid, bv] of [...basvurular]) {
      if (bv.matchId !== mid) continue;
      basvuruTemizle(cid, { liderBilgilendir: false });
      dbBasvuruDurum(mid, cid, 'expired');   // DB'de 'pending' asili kalmasin
      const c = wsCharId(cid, ix);
      if (c) bildir(c, NOTICE.MATCH_APPLY_EXPIRED);
    }
    dbIlanKapat(mid);
    if (bildirimVar) {
      for (const u of p.uyeler) bildir(wsCharId(u.charId, ix), NOTICE.MATCH_UNREGISTERED);
    }
    panoYayinla(ix);
    return true;
  }

  /* --------------------------------------------------------------- DB */

  function dbHata(nerede, e) {
    log(`parti/DB ${nerede}: ${String(e?.message ?? e).slice(0, 140)}`);
  }

  /* Acilis temizligi bitene kadar YENI ilan yazilmamali - asagiya bak. */
  let dbHazir = Promise.resolve();

  /** WebPartyMatch'e yazar, matchId doner. web yoksa yerel sayac. */
  async function dbIlanAc(il) {
    if (!web) return ++yerelMatchId;
    try {
      await dbHazir;                 // acilis temizligi bu satiri EZMESIN
      const r = await web.request()
        .input('leaderCharID', Number(il.leaderCharId) || 0)
        .input('title', il.title)
        .input('raceReq', il.raceReq)
        .input('minLevel', il.minLevel)
        .input('maxLevel', il.maxLevel)
        .input('maxMembers', il.maxMembers)
        .input('expShare', il.expShare)
        .input('itemShare', il.itemShare)
        .input('ltp', il.ltp)
        .query(`INSERT INTO dbo.WebPartyMatch
                  (leaderCharID, title, raceReq, minLevel, maxLevel,
                   maxMembers, expShare, itemShare, ltp, isOpen)
                OUTPUT INSERTED.matchId
                VALUES (@leaderCharID, @title, @raceReq, @minLevel, @maxLevel,
                        @maxMembers, @expShare, @itemShare, @ltp, 1)`);
      const id = r.recordset?.[0]?.matchId;
      if (id) return Number(id);
    } catch (e) { dbHata('ilanAc', e); }
    return ++yerelMatchId;
  }

  function dbIlanKapat(matchId) {
    if (!web) return;
    web.request().input('matchId', matchId)
      .query('UPDATE dbo.WebPartyMatch SET isOpen = 0 WHERE matchId = @matchId')
      .catch(e => dbHata('ilanKapat', e));
  }

  function dbBasvuruYaz(matchId, charId) {
    if (!web) return;
    web.request().input('matchId', matchId).input('CharID', Number(charId) || 0)
      .query(`INSERT INTO dbo.WebPartyMatchApplication (matchId, CharID, status)
              VALUES (@matchId, @CharID, 'pending')`)
      .catch(e => dbHata('basvuruYaz', e));
  }

  function dbBasvuruDurum(matchId, charId, durum) {
    if (!web) return;
    web.request().input('matchId', matchId).input('CharID', Number(charId) || 0)
      .input('status', durum)
      .query(`UPDATE dbo.WebPartyMatchApplication SET status = @status
              WHERE matchId = @matchId AND CharID = @CharID AND status = 'pending'`)
      .catch(e => dbHata('basvuruDurum', e));
  }

  /* Sunucu yeniden basladiginda parti diye bir sey kalmaz; onceki oturumdan
     acik kalmis ilanlar da gecersizdir. Acilista hepsini kapatiyoruz.
     ONEMLI: bu UPDATE ateslenip birakilirsa (fire-and-forget) havuz onu
     acilistan hemen sonra yazilan TAZE bir ilanin INSERT'inden SONRA
     calistirabilir ve `WHERE isOpen = 1` o taze ilani da kapatir. Bu yuzden
     sozu dbHazir'da tutuyoruz; dbIlanAc once onu bekliyor. */
  if (web) {
    dbHazir = web.request()
      .query('UPDATE dbo.WebPartyMatch SET isOpen = 0 WHERE isOpen = 1')
      .then(r => log(`parti: onceki oturumdan ${r?.rowsAffected?.[0] ?? 0} ilan kapatildi`))
      .catch(e => dbHata('acilisTemizlik', e));
  }

  /* ------------------------------------------------------- 71 create */

  function create(ws, d) {
    if (partiOfWs(ws)) return hata(ws, ERR.IN_PARTY);
    if (typeof d?.expShare !== 'boolean' || typeof d?.itemShare !== 'boolean') {
      return hata(ws, ERR.VALIDATION);
    }
    const p = partiYarat(ws, d.expShare, d.itemShare);
    log(`parti kuruldu ${p.id} lider=${ws.char.name} exp=${p.expShare} item=${p.itemShare}` +
        `${ltpMi(p) ? ' LTP' : ''}`);
    yayinla(p);
    return true;
  }

  /* ------------------------------------------------------- 88 invite */

  function invite(ws, d) {
    const hedefEntity = Number(d?.targetId);
    if (!Number.isInteger(hedefEntity)) return hata(ws, ERR.VALIDATION);
    if (hedefEntity === ws.entityId) return hata(ws, ERR.VALIDATION);

    const hedef = wsEntity(hedefEntity);
    if (!hedef?.char) return hata(ws, ERR.NOT_FOUND);
    if (S(hedef.char.id) === S(ws.char.id)) return hata(ws, ERR.VALIDATION);
    if (partiOfWs(hedef)) return hata(ws, ERR.IN_PARTY);
    if (davetler.has(S(hedef.char.id))) return hata(ws, ERR.BUSY);

    // Ayni bolge + menzil. game-config'te davet icin AYRI bir mesafe YOK;
    // parti ile ilgili tek mesafe partyShareRangeU (150).
    if (S(hedef.zoneId ?? hedef.char.zone) !== S(ws.zoneId ?? ws.char.zone)) {
      return hata(ws, ERR.RANGE);
    }
    if (AYAR.partyShareRangeU != null) {
      const dx = (hedef.char.x ?? 0) - (ws.char.x ?? 0);
      const dz = (hedef.char.z ?? 0) - (ws.char.z ?? 0);
      if (dx * dx + dz * dz > AYAR.partyShareRangeU ** 2) return hata(ws, ERR.RANGE);
    }

    /* Parti yoksa ORTULU olarak kurulur: hedef panelindeki "Partiye davet et"
       dugmesi (char 27627973) create diyalogunu ACMADAN dogrudan invite
       yolluyor. Varsayilanlar diyalogun kendi baslangic degerleri:
       useState(!0)/useState(!0) -> iki paylasim da ACIK (char 27505300). */
    let p = partiOfWs(ws);
    if (!p) {
      p = partiYarat(ws, true, true);
      yayinla(p);
    } else if (p.leaderCharId !== S(ws.char.id)) {
      return hata(ws, ERR.NOT_LEADER);
    }
    if (p.uyeler.length >= kapasite(p)) return hata(ws, ERR.FULL);

    const bitis = now() + (AYAR.partyInviteTimeoutMs ?? 0);
    const davet = {
      partyId: p.id,
      fromCharId: S(ws.char.id),
      hedefCharId: S(hedef.char.id),
      expiresAt: bitis,
      zamanlayici: null,
    };
    if (AYAR.partyInviteTimeoutMs > 0) {
      davet.zamanlayici = setTimeout(() => {
        if (davetler.get(davet.hedefCharId) === davet) davetler.delete(davet.hedefCharId);
      }, AYAR.partyInviteTimeoutMs);
      davet.zamanlayici.unref?.();
    }
    davetler.set(davet.hedefCharId, davet);

    frame(hedef, 'party.invited', {
      fromCharId: davet.fromCharId,
      fromName: S(ws.char.name),
      fromLevel: tam(ws.char.level),
      partySize: p.uyeler.length,
      partyCap: kapasite(p),
      expiresAt: bitis,
    });
    bildir(ws, NOTICE.INVITE_SENT, { name: S(hedef.char.name) });
    return true;
  }

  /* ------------------------------------------------------ 89 respond */

  function respond(ws, d) {
    if (typeof d?.accept !== 'boolean') return hata(ws, ERR.VALIDATION);
    const id = S(ws.char.id);
    const davet = davetler.get(id);
    if (!davet) return hata(ws, ERR.NO_INVITE);
    davetler.delete(id);
    if (davet.zamanlayici) clearTimeout(davet.zamanlayici);
    if (davet.expiresAt <= now()) return hata(ws, ERR.NO_INVITE);

    const davetci = wsCharId(davet.fromCharId);
    const p = partiler.get(davet.partyId);

    if (!d.accept) {
      bildir(davetci, NOTICE.INVITE_DECLINED, { name: S(ws.char.name) });
      return true;
    }
    if (!p) {                                   // parti bu arada dagildi
      bildir(davetci, NOTICE.JOIN_FAILED, { name: S(ws.char.name) });
      return hata(ws, ERR.NO_INVITE);
    }
    if (partiOfWs(ws)) {                        // bu arada baska partiye girdi
      bildir(davetci, NOTICE.JOIN_FAILED, { name: S(ws.char.name) });
      return hata(ws, ERR.IN_PARTY);
    }
    if (p.uyeler.length >= kapasite(p)) {
      bildir(davetci, NOTICE.JOIN_FAILED, { name: S(ws.char.name) });
      return hata(ws, ERR.FULL);
    }

    p.uyeler.push(uyeYarat(ws));
    charParti.set(id, p.id);
    basvuruTemizle(id);                         // partiye girdi, basvurusu dusar
    const idx = indeksYap();                    // tek indeks, iki yayim
    yayinla(p, idx);
    panoYayinla(idx);
    return true;
  }

  /* -------------------------------------------------------- 90 leave */

  function leave(ws) {
    const p = partiOfWs(ws);
    if (!p) { bildir(ws, NOTICE.NOT_IN_PARTY); return hata(ws, ERR.NOT_MEMBER); }
    uyeCikar(p, ws.char.id, 'left');
    return true;
  }

  /* --------------------------------------------------------- 91 kick */

  function kick(ws, d) {
    const p = partiOfWs(ws);
    if (!p) { bildir(ws, NOTICE.NOT_IN_PARTY); return hata(ws, ERR.NOT_MEMBER); }
    if (p.leaderCharId !== S(ws.char.id)) return hata(ws, ERR.NOT_LEADER);
    const id = S(d?.charId);
    if (!id) return hata(ws, ERR.VALIDATION);
    if (id === S(ws.char.id)) return hata(ws, ERR.VALIDATION);   // kendini atamaz
    if (!p.uyeler.some(u => u.charId === id)) return hata(ws, ERR.NOT_MEMBER);
    uyeCikar(p, id, 'kicked');
    return true;
  }

  /* --------------------------------------------------------- 92 lead */

  function lead(ws, d) {
    const p = partiOfWs(ws);
    if (!p) { bildir(ws, NOTICE.NOT_IN_PARTY); return hata(ws, ERR.NOT_MEMBER); }
    if (p.leaderCharId !== S(ws.char.id)) return hata(ws, ERR.NOT_LEADER);
    const id = S(d?.charId);
    if (!id) return hata(ws, ERR.VALIDATION);
    if (id === p.leaderCharId) return hata(ws, ERR.VALIDATION);
    if (!p.uyeler.some(u => u.charId === id)) return hata(ws, ERR.NOT_MEMBER);
    p.leaderCharId = id;
    const idx = indeksYap();
    if (ilanLideriTazele(p)) panoYayinla(idx);    // ilandaki lider adi da degisir
    yayinla(p, idx);
    return true;
  }

  /* -------------------------------------------------------- 72 match */

  async function match(ws, d) {
    switch (d?.op) {
      case 'sub':
        panoAbone.add(ws);
        panoGonder(ws);
        // Lider isem bekleyen basvuruyu da tazele
        {
          const p = partiOfWs(ws);
          const mid = p ? partiIlan.get(p.id) : null;
          if (p && mid != null && p.leaderCharId === S(ws.char.id)) {
            const bv = [...basvurular.values()].find(b => b.matchId === mid) ?? null;
            frame(ws, 'party.matchApplication', {
              applicant: bv ? {
                charId: bv.charId, name: bv.name, level: bv.level,
                race: bv.race, expiresAt: bv.expiresAt,
              } : null,
            });
          }
        }
        return true;

      case 'unsub':
        panoAbone.delete(ws);
        return true;

      case 'register': return register(ws, d);
      case 'unregister': {
        const p = partiOfWs(ws);
        if (!p) { bildir(ws, NOTICE.NOT_IN_PARTY); return hata(ws, ERR.NOT_MEMBER); }
        if (p.leaderCharId !== S(ws.char.id)) return hata(ws, ERR.NOT_LEADER);
        if (partiIlan.get(p.id) == null) return hata(ws, ERR.MATCH_STATE);
        const idx = indeksYap();                // tek indeks, iki yayim
        ilaniKaldir(p, true, idx);
        yayinla(p, idx);
        return true;
      }
      case 'apply': return apply(ws, d);
      case 'applyCancel': {
        const bv = basvuruTemizle(S(ws.char.id));
        if (!bv) return hata(ws, ERR.MATCH_STATE);
        dbBasvuruDurum(bv.matchId, bv.charId, 'cancelled');
        panoGonder(ws);
        return true;
      }
      case 'applyRespond': return applyRespond(ws, d);
      default:
        return hata(ws, ERR.VALIDATION);
    }
  }

  async function register(ws, d) {
    const p = partiOfWs(ws);
    if (!p) { bildir(ws, NOTICE.NOT_IN_PARTY); return hata(ws, ERR.NOT_MEMBER); }
    if (p.leaderCharId !== S(ws.char.id)) return hata(ws, ERR.NOT_LEADER);
    if (partiIlan.get(p.id) != null) return hata(ws, ERR.MATCH_STATE);

    const title = S(d?.title).trim().slice(0, AYAR.partyMatchTitleMaxLen);
    if (!title) return hata(ws, ERR.VALIDATION);
    const raceReq = S(d?.raceReq);
    if (!IRKLAR.has(raceReq)) return hata(ws, ERR.VALIDATION);
    /* Istemci semasi: minLevel/maxLevel = Y().int().min(1).max(200).
       Sunucu istemciye GUVENMEZ - ust siniri da burada uyguluyoruz, yoksa
       elle uydurulmus bir paket panoya 1..999999 araligi yazabilirdi. */
    const minLevel = tam(d?.minLevel), maxLevel = tam(d?.maxLevel);
    if (minLevel < 1 || minLevel > 200 || maxLevel < 1 || maxLevel > 200 ||
        minLevel > maxLevel) return hata(ws, ERR.VALIDATION);

    const il = {
      matchId: 0,
      partyId: p.id,
      leaderCharId: p.leaderCharId,
      leaderName: S(ws.char.name),
      title, raceReq, minLevel, maxLevel,
      maxMembers: kapasite(p),
      expShare: p.expShare,
      itemShare: p.itemShare,
      ltp: ltpMi(p),
      isOpen: true,
    };
    il.matchId = await dbIlanAc(il);
    if (!partiler.has(p.id)) { dbIlanKapat(il.matchId); return true; }  // arada dagildi
    ilanlar.set(il.matchId, il);
    partiIlan.set(p.id, il.matchId);

    /* DB bekleyisi (await) bitti; indeksi BURADA kuruyoruz ki bekleme
       sirasinda giren/cikan oyuncular dogru gorunsun. */
    const idx = indeksYap();
    for (const u of p.uyeler) bildir(wsCharId(u.charId, idx), NOTICE.MATCH_REGISTERED);
    yayinla(p, idx);     // party.update artik matchId tasiyor
    panoYayinla(idx);
    return true;
  }

  function apply(ws, d) {
    const matchId = tam(d?.matchId);
    if (matchId <= 0) return hata(ws, ERR.VALIDATION);
    const il = ilanlar.get(matchId);
    if (!il || !il.isOpen) return hata(ws, ERR.NOT_FOUND);
    const p = partiler.get(il.partyId);
    if (!p) return hata(ws, ERR.NOT_FOUND);

    // istemcinin MLt() engelleri - birebir
    if (partiOfWs(ws)) return hata(ws, ERR.IN_PARTY);              // blocked_in_party
    if (basvurular.has(S(ws.char.id))) return hata(ws, ERR.MATCH_STATE); // blocked_pending
    if (p.uyeler.length >= il.maxMembers) return hata(ws, ERR.FULL);     // blocked_full
    const lvl = tam(ws.char.level);
    if (lvl < il.minLevel || lvl > il.maxLevel) return hata(ws, ERR.VALIDATION); // blocked_level
    if (il.raceReq !== 'both' && il.raceReq !== S(ws.char.race)) {
      return hata(ws, ERR.VALIDATION);                             // blocked_race
    }
    // Ayni ilana ait bekleyen baska bir basvuru varsa lider once onu cevaplasin.
    if ([...basvurular.values()].some(b => b.matchId === matchId)) {
      return hata(ws, ERR.BUSY);
    }

    /* Basvurunun omru: game-config'te basvuru icin AYRI sure YOK; parti
       davetiyle ayni sureyi (partyInviteTimeoutMs) kullaniyoruz. */
    const bitis = now() + (AYAR.partyInviteTimeoutMs ?? 0);
    const bv = {
      matchId, charId: S(ws.char.id), name: S(ws.char.name),
      level: lvl, race: S(ws.char.race), expiresAt: bitis, zamanlayici: null,
    };
    if (AYAR.partyInviteTimeoutMs > 0) {
      bv.zamanlayici = setTimeout(() => {
        if (basvurular.get(bv.charId) !== bv) return;
        basvuruTemizle(bv.charId);
        dbBasvuruDurum(bv.matchId, bv.charId, 'expired');
        const c = wsCharId(bv.charId);
        if (c) { bildir(c, NOTICE.MATCH_APPLY_EXPIRED); panoGonder(c); }
      }, AYAR.partyInviteTimeoutMs);
      bv.zamanlayici.unref?.();
    }
    basvurular.set(bv.charId, bv);
    dbBasvuruYaz(matchId, bv.charId);

    const lider = wsCharId(p.leaderCharId);
    if (lider) {
      frame(lider, 'party.matchApplication', {
        applicant: {
          charId: bv.charId, name: bv.name, level: bv.level,
          race: bv.race, expiresAt: bv.expiresAt,
        },
      });
    }
    bildir(ws, NOTICE.MATCH_APPLIED, { title: il.title });
    panoGonder(ws);       // appliedMatchId guncellensin
    return true;
  }

  function applyRespond(ws, d) {
    const p = partiOfWs(ws);
    if (!p) { bildir(ws, NOTICE.NOT_IN_PARTY); return hata(ws, ERR.NOT_MEMBER); }
    if (p.leaderCharId !== S(ws.char.id)) return hata(ws, ERR.NOT_LEADER);
    const mid = partiIlan.get(p.id);
    if (mid == null) return hata(ws, ERR.MATCH_STATE);
    if (typeof d?.accept !== 'boolean') return hata(ws, ERR.VALIDATION);

    const id = S(d?.applicantCharId);
    const bv = basvurular.get(id);
    if (!bv || bv.matchId !== mid) return hata(ws, ERR.MATCH_STATE);

    basvuruTemizle(id);                        // lidere applicant:null gider
    const aday = wsCharId(id);

    if (!d.accept) {
      dbBasvuruDurum(mid, id, 'refused');
      if (aday) { bildir(aday, NOTICE.MATCH_APPLY_REFUSED); panoGonder(aday); }
      return true;
    }
    if (!aday) { dbBasvuruDurum(mid, id, 'expired'); return true; }   // cikmis
    if (partiOfWs(aday)) {
      dbBasvuruDurum(mid, id, 'expired');
      bildir(ws, NOTICE.JOIN_FAILED, { name: bv.name });
      return hata(ws, ERR.IN_PARTY);
    }
    if (p.uyeler.length >= kapasite(p)) {
      dbBasvuruDurum(mid, id, 'expired');
      bildir(ws, NOTICE.JOIN_FAILED, { name: bv.name });
      return hata(ws, ERR.FULL);
    }

    dbBasvuruDurum(mid, id, 'accepted');
    p.uyeler.push(uyeYarat(aday));
    charParti.set(id, p.id);
    const idx = indeksYap();                    // tek indeks, iki yayim
    yayinla(p, idx);
    panoYayinla(idx);
    return true;
  }

  /* -------------------------------------------------- XP PAYLASIMI */

  /**
   * Oldurmeyi yapan `ws` icin XP/SP dagilimini hesaplar.
   *
   * Kurallar (hepsi game-config + istemci metninden):
   *   - xpShareMode !== 'party'  -> paylasim yok.
   *   - Partisi yok / expShare kapali -> havuz BOLUNMEZ, oldurende kalir.
   *   - expShare acik: ayni bolgede, partyShareRangeU (150) menzilde, YASAYAN,
   *     cevrimici uyeler pay alir. Havuz carpani
   *         1 + partyXpBonusPerMember * (uyeSayisi - 1)
   *     (tek kisi = bonus yok; "per member" = her EK uye icin +0.1)
   *   - LTP (iki paylasim da kapali) ve parti DOLU (>= ltpMinMembers) ise
   *     ayrica  * (1 + ltpXpBonusPct/100)   -> "+10% XP/SP while the party is full"
   *   - Tam sayiya asagi yuvarlanir, artan oldurene verilir (kayip olmaz).
   *
   * @returns {Array<{ws:object, charId:string, xp:number, spExp:number,
   *                   pay:number, carpan:number}>}
   *          Her zaman en az bir kayit doner (ilk kayit HER ZAMAN olduren).
   */
  function paylasimHesapla(ws, xp, spExp = 0) {
    const xpHam = Math.max(0, Math.floor(Number(xp) || 0));
    const spHam = Math.max(0, Math.floor(Number(spExp) || 0));
    const tekil = () => ([{
      ws, charId: S(ws?.char?.id), xp: xpHam, spExp: spHam, pay: 1, carpan: 1,
    }]);

    if (!ws?.char) return tekil();
    const p = partiOfWs(ws);
    if (!p) return tekil();

    // Cevrimici + ayni bolge + menzil + yasayan uyeler
    // (indeks bir kez kuruluyor - bu yordam HER canavar olumunde cagriliyor)
    const idx = indeksYap();
    const uygun = [];
    for (const u of p.uyeler) {
      const c = wsCharId(u.charId, idx);
      if (!c?.char) continue;
      if (S(c.zoneId ?? c.char.zone) !== S(ws.zoneId ?? ws.char.zone)) continue;
      if ((c.char.hp ?? 0) <= 0) continue;
      if (AYAR.partyShareRangeU != null) {
        const dx = (c.char.x ?? 0) - (ws.char.x ?? 0);
        const dz = (c.char.z ?? 0) - (ws.char.z ?? 0);
        if (dx * dx + dz * dz > AYAR.partyShareRangeU ** 2) continue;
      }
      uygun.push(c);
    }
    if (!uygun.some(c => c === ws)) uygun.unshift(ws);   // olduren daima icinde

    // LTP bonusu: parti dolu (>= ltpMinMembers) - uye sayisina bakilir
    let carpan = 1;
    if (ltpMi(p) && p.uyeler.length >= AYAR.ltpMinMembers) {
      carpan *= 1 + (AYAR.ltpXpBonusPct / 100);
    }

    const paylas = AYAR.xpShareMode === 'party' && p.expShare === true && uygun.length > 1;
    if (paylas && AYAR.partyXpBonusPerMember != null) {
      carpan *= 1 + AYAR.partyXpBonusPerMember * (uygun.length - 1);
    }

    const xpHavuz = Math.floor(xpHam * carpan);
    const spHavuz = Math.floor(spHam * carpan);

    if (!paylas) {
      return [{ ws, charId: S(ws.char.id), xp: xpHavuz, spExp: spHavuz, pay: 1, carpan }];
    }

    const n = uygun.length;
    const xpPay = Math.floor(xpHavuz / n);
    const spPay = Math.floor(spHavuz / n);
    const out = uygun.map(c => ({
      ws: c, charId: S(c.char.id), xp: xpPay, spExp: spPay, pay: 1 / n, carpan,
    }));
    // Artani oldurene ver - toplam havuzdan tek XP bile kaybolmasin.
    const i = out.findIndex(o => o.ws === ws);
    out[i].xp += xpHavuz - xpPay * n;
    out[i].spExp += spHavuz - spPay * n;
    // Olduren listenin BASINDA olsun (cagiran ilk kaydi "kendi" sayabilsin)
    if (i > 0) out.unshift(out.splice(i, 1)[0]);
    return out;
  }

  /* ------------------------------------------- ESYA PAYLASIMI (ganimet sirasi) */

  /**
   * PP MADDE 6 (changelog 0021 tr:8): "Parti Esya Paylasimi gercekten
   * paylasiyor - esyalar yerden alindiginda SIRADAKI uyeye veriliyor ve
   * menzildeki herkese kimin ne aldigi bildiriliyor."
   *
   * Alan (alma isteğini yapan) `ws` icin sirayla esya alacak uyeyi COZER;
   * sirayi ILERLETMEZ - cagiran (gameloop #almaDenemesi) esyayi alicinin
   * cantasina koymayi BASARIRSA `ilerlet()` cagirir. Canta doluysa sira o
   * uyede KALIR (tr.json err.loot.share_full: "Sira bir parti uyesinde ve
   * cantasi dolu.") ve esya yerde birakilir.
   *
   * Uygunluk olcutleri paylasimHesapla ile BIREBIR AYNI (cevrimici + ayni
   * bolge + partyShareRangeU menzili + yasayan); oradaki dongu davranis
   * riskine girmemek icin cagirilmadi, olcutler kopyalandi.
   *
   * @returns {null | {ws:object, uygunlar:object[], ilerlet:()=>void}}
   *          null = paylasim yok (parti yok / itemShare kapali / menzilde
   *          baska uygun uye yok) -> alan kendine alir, bugunku davranis.
   */
  function ganimetAlicisi(ws) {
    if (!ws?.char) return null;
    const p = partiOfWs(ws);
    if (!p || p.itemShare !== true) return null;

    const idx = indeksYap();
    const uygunIdx = [];                     // [{i: uye dizini, c: soket}]
    for (let i = 0; i < p.uyeler.length; i++) {
      const c = wsCharId(p.uyeler[i].charId, idx);
      if (!c?.char) continue;
      if (S(c.zoneId ?? c.char.zone) !== S(ws.zoneId ?? ws.char.zone)) continue;
      if ((c.char.hp ?? 0) <= 0) continue;
      if (AYAR.partyShareRangeU != null) {
        const dx = (c.char.x ?? 0) - (ws.char.x ?? 0);
        const dz = (c.char.z ?? 0) - (ws.char.z ?? 0);
        if (dx * dx + dz * dz > AYAR.partyShareRangeU ** 2) continue;
      }
      uygunIdx.push({ i, c });
    }
    // Menzilde tek kisi (alanin kendisi) -> paylasilacak kimse yok.
    if (uygunIdx.length <= 1) return null;

    /* Sira uye DIZINI uzerinden doner (katilma sirasi); menzil disi/cevrimdisi
       uye sirasini o an kullanamadigi icin uzerinden atlanir. */
    const bas = tam(p.ganimetSira) % p.uyeler.length;
    let secilen = null;
    for (let k = 0; k < p.uyeler.length && !secilen; k++) {
      const i = (bas + k) % p.uyeler.length;
      secilen = uygunIdx.find((u) => u.i === i) ?? null;
    }
    if (!secilen) return null;               // olmamali (uygunIdx dolu) - emniyet
    return {
      ws: secilen.c,
      uygunlar: uygunIdx.map((u) => u.c),
      ilerlet: () => { p.ganimetSira = (secilen.i + 1) % p.uyeler.length; },
    };
  }

  /* ------------------------------------------------- KANAL YAYINI (sohbet) */

  /**
   * `ws`in partisindeki CEVRIMICI uyelerin soketleri.
   *
   * NEDEN VAR (fark #1 / #181): server.js chat.send dalinda kanal 'party'
   * ise HICBIR yayim yok - satir yalnizca `frame(ws,'chat.recv',kare)` ile
   * YAZANA geri yansitiliyor ve kodun kendi yorumu bunu "uye listesi
   * cekirdekte YOK" diye gerekcelendiriyor. Bu dogru degil: uye kumesi
   * (p.uyeler) + wsCharId() cozumu burada zaten var, sadece disa
   * acilmiyordu. Istemci kendi yazdigini YEREL OLARAK EKLEMIYOR
   * (paket @27378460: fn_d yalnizca W$.send yapiyor), yani her satiri
   * sunucu dagitmak zorunda; sohbet paneli sekmeyi `m.ch === tab` ile
   * suzuyor (@27378180, ui.chat.tab_party).
   *
   * @param {object} ws  yazan oyuncu
   * @returns {object[]} soket dizisi (partisi yoksa BOS dizi - cagiran
   *                     "parti yok" durumunu bundan anlar)
   */
  function uyeSoketleri(ws) {
    const p = partiOfWs(ws);
    if (!p) return [];
    const idx = indeksYap();
    const out = [];
    for (const u of p.uyeler) {
      const c = wsCharId(u.charId, idx);
      if (c) out.push(c);
    }
    return out;
  }

  /**
   * Bir kareyi partinin TUM cevrimici uyelerine yollar.
   *
   * @param {object} ws     kaynak oyuncu
   * @param {string} tip    s2c mesaj adi (ornek: 'chat.recv')
   * @param {object} veri   kare govdesi
   * @param {{gonderenHaric?: boolean}} [secenek]
   *        gonderenHaric=true -> kaynak soket ATLANIR (cagiran kendi
   *        frame'ini zaten yolluyorsa ciftlemeyi onler)
   * @returns {number} kare gonderilen soket sayisi; 0 = partisi yok/kimse
   *                   cevrimici degil (cagiran o zaman satiri DAGITMAMALI)
   */
  function kanalaYayinla(ws, tip, veri, { gonderenHaric = false } = {}) {
    if (!ws?.char || typeof tip !== 'string') return 0;
    const hedefler = uyeSoketleri(ws);
    if (!hedefler.length) return 0;
    let n = 0;
    for (const c of hedefler) {
      if (gonderenHaric && c === ws) continue;
      frame(c, tip, veri);
      n++;
    }
    return n;
  }

  /* ---------------------------------------------------- oturum kancalari */

  /** Soket kapandiginda: uyelik KALIR (linkdead), yalnizca gecici kayitlar silinir. */
  function cikis(ws) {
    if (!ws?.char) return;
    const id = S(ws.char.id);
    panoAbone.delete(ws);
    const davet = davetler.get(id);
    if (davet) { if (davet.zamanlayici) clearTimeout(davet.zamanlayici); davetler.delete(id); }
    // Bu oyuncunun BASKASINA yolladigi bekleyen davetleri de dusur
    for (const [hid, dv] of [...davetler]) {
      if (dv.fromCharId !== id) continue;
      if (dv.zamanlayici) clearTimeout(dv.zamanlayici);
      davetler.delete(hid);
    }
    const bv = basvuruTemizle(id);
    if (bv) dbBasvuruDurum(bv.matchId, id, 'cancelled');
    const p = partiOf(id);
    if (!p) return;

    /* Kopan soket zoneState'ten cikarilmis OLABILIR de olmayabilir de:
       server.js close'unda WORLDSIM.oyuncuCik(ws) once cagriliyor ama bu
       kancanin oraya nereye konuldugu baglamaya bagli. Sira ne olursa olsun
       dogru calissin diye bu soketi indeksten HARIC tutuyoruz - kalan uyeler
       onu boylece kesin linkdead gorur. */
    const idx = indeksYap(ws);
    const cevrimici = p.uyeler.reduce((n, u) => n + (idx.byChar.has(u.charId) ? 1 : 0), 0);
    if (!cevrimici) {
      /* Son cevrimici uye de dustu: bu partiyi artik kimse goremez. Bellekte
         sonsuza kadar tutmuyoruz (sunucu yeniden basladiginda da yok olurdu);
         aksi halde partiler/charParti hic kucumeyen bir birikim olurdu. */
      ilaniKaldir(p, false, idx);
      for (const u of p.uyeler) charParti.delete(u.charId);
      partiler.delete(p.id);
      panoYayinla(idx);
      return;
    }
    yayinla(p, idx);            // kalanlar uyeyi linkdead gorsun
  }

  /** Tekrar giriste parti durumunu geri yollar (zone.init sonrasi cagrilabilir). */
  function girisSonrasi(ws) {
    if (!ws?.char) return false;
    const p = partiOfWs(ws);
    if (!p) return false;
    yayinla(p);
    return true;
  }

  /** Tani/olcum icin ozet. */
  function durum() {
    return {
      parti: partiler.size,
      uye: [...partiler.values()].reduce((a, p) => a + p.uyeler.length, 0),
      davet: davetler.size,
      ilan: ilanlar.size,
      basvuru: basvurular.size,
      panoAbone: panoAbone.size,
    };
  }

  /* ------------------------------------------------------- yonlendirici */

  function mesaj(ws, t, d) {
    if (!ISLENEN.has(t)) return false;            // ilgilenmiyorum -> false
    if (!ws?.isAuthed || !ws.char) return false;
    try {
      switch (t) {
        case 'party.create': return create(ws, d);
        case 'party.invite': return invite(ws, d);
        case 'party.respond': return respond(ws, d);
        case 'party.leave': return leave(ws);
        case 'party.kick': return kick(ws, d);
        case 'party.lead': return lead(ws, d);
        case 'party.match': {
          const r = match(ws, d);
          if (r && typeof r.then === 'function') {
            r.catch(e => log('parti mesaj hatasi:', String(e?.message ?? e).slice(0, 140)));
          }
          return true;
        }
        default: return false;
      }
    } catch (e) {
      log('parti mesaj hatasi:', String(e?.message ?? e).slice(0, 140));
      return hata(ws, ERR.VALIDATION);
    }
  }

  return {
    mesaj, paylasimHesapla, cikis, girisSonrasi, durum, ISLENEN,
    /* fark #1 / #181: 'party' sohbet kanalinin yayim ucu. server.js
       chat.send dalinda kullanilir (bkz. BAGLAMA NOTU). */
    uyeSoketleri, kanalaYayinla,
    /* PP MADDE 6: parti esya paylasimi sira cozumu - gameloop #almaDenemesi
       kullanir (changelog 0021 "siradaki uyeye veriliyor"). */
    ganimetAlicisi,
  };
}

export default { kur };

/* =====================================================================
 * BAGLAMA NOTU  (server.js icin)
 * ---------------------------------------------------------------------
 * ctx'ten KULLANDIKLARIM:
 *   world   -> world.zoneState (Map) uzerinden bagli TUM oyuncu soketlerini
 *              tariyorum (charId / entityId -> ws cozumu icin). Baska hicbir
 *              world yordami cagrilmiyor. Istersen ctx.istemciler = () => ws[]
 *              gecerek bu taramayi bypass edebilirsin (varsa o kullanilir).
 *   frame   -> tum s2c kareleri
 *   log     -> tanilar
 *   GCFG    -> partyMaxSize, partyShareRangeU, partyXpBonusPerMember,
 *              xpShareMode, partyInviteTimeoutMs, ltpMinMembers,
 *              ltpMaxMembers, ltpXpBonusPct, partyMatchTitleMaxLen
 *   web     -> SRO_WEB_GAME havuzu: WebPartyMatch / WebPartyMatchApplication
 *   derived -> uye maxHp/maxMp (party.update semasinda ZORUNLU)
 *   KULLANMADIKLARIM: combat, broadcast, ITEMSTATS, zoneGroundY,
 *   yurunebilirNokta, envanterPayload, SHARD (parti tablosu shard'da yok).
 *
 * BAGLAMA (3 satir):
 *   import { kur as kurParti } from './sistem_parti.js';
 *   const PARTI = kurParti({ world: WORLDSIM, frame, log, GCFG,
 *                            web: webPool, derived });
 *   // wss mesaj dongusunde, LOOP.mesaj'dan HEMEN SONRA:
 *   if (PARTI.mesaj(ws, t, d)) return;
 *
 * ISTEGE BAGLI ama tavsiye edilen 2 kanca:
 *   ws.on('close') icinde   ->  PARTI.cikis(ws);
 *       Sira onemli DEGIL: cikis() kopan soketi indeksten kendisi haric
 *       tutuyor, yani WORLDSIM.oyuncuCik(ws)'ten once de sonra da dogru
 *       calisir. Kalan uyeler kopani linkdead:true gorur; partinin SON
 *       cevrimici uyesi de dustugunde parti bellekten silinir.
 *   zone.init yollandiktan sonra -> PARTI.girisSonrasi(ws);
 *
 * DENETIM SONRASI DUZELTILENLER (bu dosyada, baska dosyaya dokunulmadi):
 *   1) DB yarismasi: acilis temizligi (UPDATE ... WHERE isOpen=1) atesle-birak
 *      idi; havuz onu taze bir ilanin INSERT'inden SONRA calistirinca yeni
 *      ilani da kapatiyordu. Artik dbHazir sozu bekleniyor.
 *   2) Lider partiden ayrilinca pano satiri (174 rows[].leaderName) eski
 *      liderin adini gosteriyordu -> ilanLideriTazele().
 *   3) register: minLevel/maxLevel ust siniri (istemci semasi max 200)
 *      sunucuda uygulanmiyordu.
 *   4) Ilan kapaninca dusen basvurular DB'de 'pending' asili kaliyordu.
 *   5) Tum uyeleri cevrimdisi olan parti bellekte sonsuza kadar yasiyordu.
 *   6) Kopan pano abonesi panoAbone kumesinde birikiyordu.
 *   7) Perf: her uye icin bagli TUM oyuncular yeniden taraniyordu
 *      (paylasimHesapla HER olumde cagriliyor) -> islem basina tek indeks.
 *
 * XP PAYLASIMI - gameloop.js #olum icinde odul verilirken:
 *   const dagilim = PARTI.paylasimHesapla(ws, xp, spExp);
 *   for (const d of dagilim) { ...d.ws'e d.xp / d.spExp uygula... }
 *   dagilim[0] HER ZAMAN oldurendir; partisi yoksa tek elemanli doner,
 *   yani mevcut davranis birebir korunur.
 *   TUKETEN IKINCI TARAF HAZIR: sistem_gorev.js `oldurmeKaydet(ws, mob)`
 *   ayni listeyi (xp/spExp = 0 vererek) gorev sayaci icin kullaniyor.
 *
 * PARTI SOHBETI - server.js chat.send dalinda (fark #1 / #181):
 *   Bugun kanal 'party' icin HICBIR yayim yok; satir yalnizca yazana geri
 *   yansitiliyor. Eklenecek (server.js BASKA AJANDA, burada yalnizca uc
 *   hazirlandi):
 *
 *     if (kanal === 'party') {
 *       const PARTI = sistemOrnegi('parti');
 *       // gonderenHaric: alttaki tekil frame(ws,'chat.recv',kare) duruyorsa
 *       const n = PARTI?.kanalaYayinla(ws, 'chat.recv', kare,
 *                                      { gonderenHaric: true }) ?? 0;
 *       if (!n && !PARTI?.uyeSoketleri(ws).length) {
 *         return bildir(ws, 'sys.party.not_in_party');   // satiri DAGITMA
 *       }
 *       return;
 *     }
 *
 *   Istemci kendi satirini YEREL EKLEMEZ (@27378460), o yuzden gonderen de
 *   kareyi almalidir - ya kanalaYayinla'yi gonderenHaric olmadan cagir, ya
 *   da mevcut tekil frame'i birak. IKISINI BIRDEN yaparsan satir iki kez
 *   gorunur.
 *
 * ISLEDIGIM MESAJLAR (7): party.create, party.invite, party.respond,
 *   party.leave, party.kick, party.lead, party.match
 * GONDERDIGIM KARELER (7): party.invited(168), party.update(169),
 *   party.left(170), party.matchBoard(174), party.matchApplication(175),
 *   sys.notice(195), err(240)
 * ===================================================================== */
