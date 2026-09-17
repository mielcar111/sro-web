/**
 * YERINDE DIRILIS SECENEGI  (s2c 201 revive.offer / c2s 85 revive.respond)
 *
 * ================================ NEDEN =====================================
 * Kullanicinin istegi: olum ekraninda "Sehre don" ve "Yardim bekle" yaninda
 * UCUNCU bir secenek - "oldugun yerde diril". Seviye esigi GM panelinden
 * canli degisebilsin, dirilis TAM canla olsun.
 *
 * KISIT: istemci paketi (index-BUMMQVRB.js) referans oyun tarafindan derlenmis;
 * ONA DUGME EKLEYEMEYIZ. Olum perdesinde yalnizca iki dugme var:
 *   tr.json ui.death.return_to_town "Sehre don"
 *           ui.death.wait_for_help  "Yardim bekle"
 *
 * COZUM: protokolde ZATEN uygun bir yol var. Istemci `revive.offer` karesini
 * alinca AYRI bir kutu (prompt-toast revive-offer) aciyor; kutuda Kabul /
 * Reddet dugmeleri var. Yani sunucunun teklif gondermesi, kullanicinin
 * istedigi ucuncu secenegi istemciye HIC DOKUNMADAN uretir.
 *
 * !!! GORUNURLUK - eski "olum perdesinden bagimsiz, ikisi ayni anda
 * gorunuyor" yorumu YANLISTI: teklif kutusu DOM'a perdeyle ayni anda girer
 * AMA tam olum perdesinin ALTINDA soluk ve TIKLANAMAZ kalir. CSS kaniti
 * (index-uZgABEga.css @72089/@72767/@925-1021):
 *   .prompt-toast   z-index var(--k-z-windows) = 30
 *   .death-overlay  z-index var(--k-z-death)   = 200   (inset:0 - tum
 *                                                       tiklamalari yutar)
 * Kutu ancak "Yardim bekle" ile perde .death-waiting cubuguna kuculunce
 * kullanilabilir olur. GERCEK AKIS:
 *   Ol -> Yardim bekle -> "Sehre don" (cubukta) + "Kabul Et / Reddet"
 *   (kutuda) yan yana = kullanicinin istedigi iki secenek.
 *
 * PAKET KANITI (index-BUMMQVRB.js):
 *   sema  : T$(`revive.offer`, 201, X({ offerId:int, casterId:int,
 *             casterName:J(), skillId:J(), expiresAt:Y(),
 *             hp:int>=0, mp:int>=0 }))
 *           T$(`revive.respond`, 85, X({ offerId:int, accept:RJ() }), `misc`)
 *           T$(`revive.result`, 202, X({ id:int, ok:RJ(), hp?, mp?,
 *             casterId?, skillId?, reason? }))
 *   isleyici: W$.on(`revive.offer`, e => R5.getState().setOffer(e))
 *   pencere : function hRt() { ... setTimeout(() => setOffer(null),
 *               max(0, offer.expiresAt - Q.serverNow())) ...
 *               fn_n = accept => W$.send(`revive.respond`,
 *                 { offerId, accept }) ... }
 *             -> `expiresAt` SUNUCU SAATINDE bir zaman damgasidir
 *                (Q.serverNow ile karsilastiriliyor), sure DEGIL.
 *   sonuc   : W$.on(`revive.result`, r => { ... Q.applyRevive(r);
 *               r.id === selfId && (setOffer(null),
 *                 setSelf({dead:false, hp:r.hp, mp:r.mp})) })
 *             -> `dead` bayragini kapatan TEK mesaj budur; ISINLANMA YOK,
 *                oyuncu OLDUGU YERDE dirilir. Tam istenen davranis.
 *   metin   : tr.json ui.revive.prompt   "seni diriltmek istiyor. Kabul
 *                                         ediyor musun?"
 *             tr.json ui.revive.restore  "{hp} HP / {mp} MP geri kazandirir"
 *             (casterName kutunun basinda KALIN yaziliyor)
 *
 * =============================== AYAR =======================================
 * Esik `yerindeDirilisMaxLevel` anahtariyla tutulur. Bu anahtar referans oyunun
 * game-config.json'inda YOKTUR - bizim eklentimizdir. admin.js orijinali
 * olmayan alanlari zaten destekliyor (orijinal: null gosterilir) ve deger
 * data/sunucu-ayarlari.json'da yasar; game-config.json'a ASLA yazilmaz.
 * 0 verilirse ozellik tamamen kapanir.
 *
 * ========================= NEDEN AYRI MODUL =================================
 * sistem_dirilis-unique.js de revive.offer/respond kullaniyor (BECERI ile
 * dirilis). Ikisi carpismasin diye:
 *   - teklif kimlikleri AYRI ARALIKTAN uretilir (bkz. TEKLIF_TABAN)
 *   - bu modul YALNIZCA kendi urettigi offerId'lere yanit verir; digerlerinde
 *     `false` donerek mesaji siradaki module birakir
 */

/** Teklif kimligi tabani - diger modullerin araligiyla carpismasin. */
const TEKLIF_TABAN = 900000000;

/** Teklif ne kadar ekranda kalsin (ms). Istemci expiresAt'te kutuyu kapatir. */
const TEKLIF_OMRU_MS = 60000;

/** Olum ile teklif arasindaki gecikme - olum perdesi once otursun. */
const TEKLIF_GECIKMESI_MS = 700;

/** Nabiz araligi: olen oyuncuyu bu sıklıkta tarariz. */
const NABIZ_MS = 500;

/* Modul yeniden kurulunca (GM panelinden ayar kaydedilince sistemleriKur()
   calisiyor) acik teklifler kaybolmasin diye devir alinir. */
let ONCEKI_ORNEK = null;
let ONCEKI_DURUM = null;

export function kur(ctx) {
  if (ONCEKI_ORNEK) {
    try { ONCEKI_ORNEK.dur(); } catch { /* onemsiz */ }
    ONCEKI_ORNEK = null;
  }
  const devir = ONCEKI_DURUM;
  ONCEKI_DURUM = null;

  const { world, frame, broadcast } = ctx;
  const GCFG = ctx.GCFG ?? {};
  const log = ctx.log ?? (() => {});
  const derived = ctx.derived ?? ((ch) => ctx.combat?.turetilmis?.(ch) ?? { maxHp: 1, maxMp: 0 });
  const simdi = ctx.now ?? (() => Date.now());

  /** offerId -> { charId, entityId, verilis } */
  const teklifler = devir?.teklifler ?? new Map();
  let sayac = devir?.sayac ?? 0;

  const esik = () => {
    const n = Number(GCFG.yerindeDirilisMaxLevel);
    return Number.isFinite(n) ? Math.trunc(n) : 0;
  };

  /** Bu oyuncuya yerinde dirilis sunulmali mi? */
  function uygunMu(ws) {
    const ch = ws?.char;
    if (!ch || !ch.dead) return false;
    const e = esik();
    if (e <= 0) return false;                       // ozellik kapali
    if (Number(ch.level ?? 1) > e) return false;    // seviye esigin ustunde
    /* KENDI KENDINE ONARIM: temizlik dongusu (nabizdaki sure asimi supurmesi)
       teklifi haritadan siliyor ama kayitta char referansi olmadigi icin
       bayraga dokunamiyor; bayrak dolu kalinca o olumde bir daha ASLA teklif
       gelmiyordu (olcum curut_yerinde_timeout.mjs: teklif acikken +70s ->
       harita bos, bayrak dolu, +5dk yeni teklif 0, tek cikis "Sehre don").
       -1 sentineli (yukaridaki RED KILIDI) BILEREK haric tutulur - onarim
       onu da acsaydi red kilidi bir sonraki nabizda cozulur ve nag dongusu
       geri gelirdi. (Kayda char referansi koyma varyanti KULLANILMADI:
       baglantisi kopan oyuncunun char nesnesini 65sn haritada tutardi.) */
    if (ch._yerindeTeklifId && ch._yerindeTeklifId !== -1
        && !teklifler.has(ch._yerindeTeklifId)) ch._yerindeTeklifId = null;
    if (ch._yerindeTeklifId) return false;          // acik teklif ya da red kilidi (-1)
    if (!ch._oldugundaMs) return false;             // olum ani bilinmiyor
    return simdi() - ch._oldugundaMs >= TEKLIF_GECIKMESI_MS;
  }

  function teklifYolla(ws) {
    const ch = ws.char;
    const d = derived(ch);
    const offerId = TEKLIF_TABAN + (++sayac);
    const kare = {
      offerId,
      /* casterId int olmak ZORUNDA (sema). Sistem teklifi oldugu icin
         oyuncunun KENDI varlik kimligini veriyoruz: istemci bu alani
         yalnizca gostermek/eslestirmek icin tutuyor, bir varlik aramiyor
         (isleyici sadece setOffer(e) yapiyor). */
      casterId: ws.entityId,
      casterName: 'Sistem',
      /* skillId sema geregi zorunlu bir dize. Gercek bir beceri DEGIL -
         bu bir sistem teklifi; istemci alani yalnizca revive.result'a
         geri koymak icin saklıyor. */
      skillId: 'system_selfrevive',
      expiresAt: simdi() + TEKLIF_OMRU_MS,   // SUNUCU SAATI (sure degil)
      hp: Math.max(0, Math.round(d.maxHp ?? 1)),
      mp: Math.max(0, Math.round(d.maxMp ?? 0)),
    };
    teklifler.set(offerId, { charId: ch.id, entityId: ws.entityId, verilis: simdi() });
    ch._yerindeTeklifId = offerId;
    frame(ws, 'revive.offer', kare);
    return offerId;
  }

  function dirilt(ws, offerId) {
    const ch = ws.char;
    const d = derived(ch);
    ch.dead = false;
    /* TAM can/mana - kullanicinin acik istegi ("canim hp mp full").
       Normal sehre donuste GCFG.respawnHpPct (0.5) kullanilir; burada
       BILEREK farkli davraniyoruz. */
    ch.hp = Math.max(1, Math.round(d.maxHp ?? 1));
    ch.mp = Math.max(0, Math.round(d.maxMp ?? 0));
    /* Yuruyus bacagi ve savas durumu temizlenmeli - yoksa dirilen karakter
       oldugu yerden eski hedefine dogru kendi kendine yurur. */
    ch.bacak = null;
    ws.savas = null;
    ws.hedefId = null;
    ch._yerindeTeklifId = null;
    ch._oldugundaMs = 0;

    /* ISINLANMA YOK - oyuncu oldugu yerde dirilir. `dead` bayragini
       kapatan TEK mesaj budur (paket: revive.result isleyicisi). */
    const sonuc = {
      id: ws.entityId, ok: true, hp: ch.hp, mp: ch.mp,
      casterId: ws.entityId, skillId: 'system_selfrevive',
    };
    frame(ws, 'revive.result', sonuc);
    broadcast(ws.zoneId, 'revive.result', sonuc, ws);
    frame(ws, 'vitals.update', { hp: ch.hp, mp: ch.mp });
    broadcast(ws.zoneId, 'entity.hp', { id: ws.entityId, hp: ch.hp, maxHp: d.maxHp });
    teklifler.delete(offerId);
    log(`[yerinde-dirilis] ${ch.name} (sv ${ch.level}) yerinde dirildi`);
  }

  /* ------------------------------------------------------------- nabiz */
  const zaman = setInterval(() => {
    try {
      for (const [, z] of (world?.zoneState ?? new Map())) {
        for (const ws of z.players) {
          if (!ws?.isAuthed || !ws.char) continue;
          const ch = ws.char;

          /* Olum anini isaretle - cekirdek bize olum olayi bildirmiyor,
             bu yuzden bayragin DEGISIMINI kendimiz yakaliyoruz. */
          if (ch.dead && !ch._oldugundaMs) ch._oldugundaMs = simdi();
          if (!ch.dead) {
            ch._oldugundaMs = 0;
            ch._yerindeTeklifId = null;
            continue;
          }
          if (uygunMu(ws)) teklifYolla(ws);
        }
      }
      /* Suresi dolan teklifleri temizle. */
      const t = simdi();
      for (const [id, k] of teklifler) {
        if (t - k.verilis > TEKLIF_OMRU_MS + 5000) teklifler.delete(id);
      }
    } catch (e) {
      log(`[yerinde-dirilis] nabiz hatasi: ${String(e.message).slice(0, 120)}`);
    }
  }, NABIZ_MS);
  zaman.unref?.();

  const ornek = {
    /**
     * c2s 85 revive.respond {offerId, accept}
     * YALNIZCA bu modulun urettigi teklifleri isler; digerlerinde false
     * donup mesaji siradaki module (sistem_dirilis-unique) birakir.
     */
    mesaj(ws, t, d) {
      if (t !== 'revive.respond') return false;
      const offerId = Number(d?.offerId);
      if (!Number.isFinite(offerId) || offerId < TEKLIF_TABAN) return false;
      const kayit = teklifler.get(offerId);
      if (!kayit) return false;                    // bizim degil / suresi dolmus
      if (Number(ws?.char?.id) !== Number(kayit.charId)) return false;

      if (!d?.accept) {
        teklifler.delete(offerId);
        /* RED KILIDI (sentinel -1): bayrak null birakilinca nabiz 500ms
           sonra YENI teklif uretiyordu (olcum curut_nag_dongusu.mjs: redden
           428/450ms sonra yeni revive.offer - dongu SONSUZ; istemci reddi
           yerel kesin siler, R5 store TEK teklif yuvasi tutar - nag gercek
           bir beceri teklifini bile ezebilir). referans oyun semantigi: red
           kesindir, teklif kendiliginden geri gelmez. -1 uygunMu'da truthy
           oldugu icin AYNI OLUM boyunca yeniden teklif kesilir; nabzin
           !dead dali dirilince bayragi zaten null'a cevirir -> SONRAKI
           olumde teklif normal gelir. -1 hicbir zaman teklifler Map'inde
           olmadigi icin mesaj() akisiyla carpismaz. */
        if (ws.char) ws.char._yerindeTeklifId = -1;
        return true;                               // reddedildi - kesin kapat
      }
      if (!ws.char?.dead) {
        frame(ws, 'revive.result', { id: ws.entityId, ok: false, reason: 'not_dead' });
        teklifler.delete(offerId);
        return true;
      }
      dirilt(ws, offerId);
      return true;
    },

    /** zone.init.self'e katki - su an ek alan yok, ileriye donuk kanca. */
    selfAlanlari() { return {}; },

    dur() {
      clearInterval(zaman);
      ONCEKI_DURUM = { teklifler, sayac };
    },

    durum() { return { acikTeklif: teklifler.size, esik: esik() }; },
  };

  ONCEKI_ORNEK = ornek;
  log(`yerinde-dirilis: esik seviye ${esik() || 'KAPALI'}`);
  return ornek;
}
