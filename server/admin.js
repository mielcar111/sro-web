/**
 * GM ADMIN PANELI - sunucu ayarlarini oyun icinden/tarayicidan degistirme.
 *
 * NEDEN AYRI DOSYA: `data/game-config.json` referans oyunun KENDI dosyasidir
 * (paketten cikarildi). Uzerine yazarsak "gercegin kaynagi" bozulur ve bir
 * daha neyin referans oyundan neyin bizden geldigini ayirt edemeyiz. Bu yuzden
 * degisiklikler AYRI bir dosyada tutulur:
 *
 *     data/game-config.json        <- referans oyunun orijinali, ASLA yazilmaz
 *     data/sunucu-ayarlari.json    <- GM'in degisiklikleri (yalnizca farklar)
 *     etkin = { ...orijinal, ...degisiklikler }
 *
 * Yetki: yalnizca GM. Kontrol TB_User.sec_primary/sec_content uzerinden
 * (gm.js -> isGm), REST tarafinda AUTH.authOf(req).isGm ile.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Panelde duzenlenebilir alanlar. Her biri game-config.json'da GERCEKTEN var.
 *  `aciklama` panelde alanin altinda gosterilir - kisa, Turkce, davranisi
 *  UYDURMADAN anlatir (yalnizca kodda/kanitta dogrulanan etkiler yazilir). */
const ALANLAR = [
  { k: 'xpRate', ad: 'Deneyim oranı (XP)', tip: 'sayi', min: 0.1, max: 10000,
    aciklama: 'Kazanılan deneyimi (XP) xN çarpar.' },
  { k: 'spRate', ad: 'Beceri puanı oranı (SP)', tip: 'sayi', min: 0.1, max: 10000,
    aciklama: 'Kazanılan beceri puanı deneyimini xN çarpar.' },
  { k: 'goldRate', ad: 'Altın oranı', tip: 'sayi', min: 0.1, max: 10000,
    aciklama: 'Canavarlardan kazanılan altını xN çarpar.' },
  { k: 'itemDropRate', ad: 'Eşya düşme oranı', tip: 'sayi', min: 0.1, max: 1000,
    aciklama: 'Canavarlardan eşya düşme şansını xN çarpar.' },
  /* MUHUR KADEMELERI - eski tek `rareDropRate` uce ayrildi (createAdmin'deki
     tek seferlik goc eski dosyalardaki degeri uc anahtara AYNEN kopyalar).
     Esleme (DB stat paritesiyle kesin): bronze=_A_RARE "Seal of Star",
     silver=_B_RARE "Seal of Moon", gold=_C_RARE "Seal of Sun". Anahtarlar
     game-config.json'da YOKTUR ("BIZIM EKLENTIMIZ" kalibi) - panelde
     orijinal sutunu `—` gorunur, deger yalniz sunucu-ayarlari.json'da
     yasar; combat.js eski dosyalar icin canli rareDropRate'e geri duser. */
  /* OLCULEN ORANLAR (2026-09-04, 158 dusme tablosunun analitigi + dt_mangyang
     uzerinde 20 000 ve 200 000 olumluk simulasyon; kaynak
     GERCEK/bulgu_skill_muhur_2026-09-04.json SERIT B):
       - Merdiven vSRO'nun KENDISININDIR: _RefDropClassSel_RareEquip lv1
         satiri bronz 1/6, gumus 1/375, altin 1/9009.
       - Eski yardim metnindeki "~12 kat / ~142 kat" 158 tablonun TOPLAMINA
         aitti ve oyuncunun avlandigi seviyede YANILTICIYDI: lv1 tablosunda
         gercek merdiven cok daha dik (gumus bronzdan 62x, altin bronzdan
         1491x nadir). Metinler asagida gercek olculmus degerlerle duzeltildi.
     BILINCLI SAPMA (varsayilan olarak data/sunucu-ayarlari.json'da):
       sealMoonRate = 6, sealSunRate = 6.  Gerekce ve olcum icin bkz.
       GERCEK/gereksinim_drop_ayari_2026-09-04.md ("yasayan dunya" hedefi).
       Bronz'a DOKUNULMADI (sealStarRate yok = 1): sikayet "hep bronz
       dusuyor" idi, cozum bronzu kismak degil digerlerini yukseltmek.
       Gumus ve altin AYNI carpani aliyor - boylece her tablonun kendi
       gumus/altin orani KORUNUR (altin>=gumus'a donen tablo sayisi 3/158
       ile vSRO tabanindaki degerde kalir; farkli carpan verilseydi 46-57
       tabloda altin gumusten sik hale gelirdi).
       Olculen sonuc (dt_mangyang, lv1): gumus 1/417 -> 1/70, altin
       1/10025 -> 1/1671; bronz 1/6 degismedi. 1 = tam parite (geri alis). */
  { k: 'sealStarRate', ad: 'Seal of Star (Bronz Mühürlü) düşme çarpanı',
    tip: 'sayi', min: 0.1, max: 1000,
    aciklama: 'Bronz mühürlü ekipman düşme şansını xN çarpar. En sık kademe: '
      + 'başlangıç bölgesinde (Mangyang) her ~7 ölümde 1, lv20-39 tablolarında '
      + 'medyan ~1/29, lv60+ tablolarında ~1/1028. Varsayılan 1 = dokunulmadı.' },
  { k: 'sealMoonRate', ad: 'Seal of Moon (Gümüş Mühürlü) düşme çarpanı',
    tip: 'sayi', min: 0.1, max: 1000,
    aciklama: 'Gümüş mühürlü ekipman şansını xN çarpar. Çarpansız (x1) hâli '
      + 'oyuncunun avlandığı düşük seviyede bronzdan ~62 kat nadirdir '
      + '(Mangyang 1/7’ye karşı 1/418); katalog ortalamasında ~12 kat. '
      + 'Varsayılan 6 = bilinçli sapma, Mangyang’da ~1/70 (lv1-19 medyan ~1/17).' },
  { k: 'sealSunRate', ad: 'Seal of Sun (Altın Mühürlü) düşme çarpanı',
    tip: 'sayi', min: 0.1, max: 1000,
    aciklama: 'Altın mühürlü ekipman şansını xN çarpar. Çarpansız (x1) hâli '
      + 'düşük seviyede gümüşten ~24, bronzdan ~1491 kat nadirdir (Mangyang '
      + '1/10026 = pratikte hiç); katalog ortalamasında bronzdan ~142 kat. '
      + 'Varsayılan 6 = bilinçli sapma, Mangyang’da ~1/1671. Merdiven '
      + 'bozulmasın diye gümüşle AYNI değerde tutulması önerilir: farklı '
      + 'değer verilirse 158 tablonun 46-57’sinde altın gümüşten SIK olur.' },
  { k: 'professionXpRate', ad: 'Meslek XP oranı', tip: 'sayi', min: 0.1, max: 1000,
    aciklama: 'Meslek deneyim kazancını xN çarpar.' },
  { k: 'petXpRate', ad: 'Pet XP oranı', tip: 'sayi', min: 0.1, max: 1000,
    aciklama: 'Büyüyen pet deneyim kazancını xN çarpar.' },
  { k: 'playerMoveSpeedU', ad: 'Oyuncu koşu hızı (birim/sn)', tip: 'sayi', min: 1, max: 200,
    aciklama: 'Oyuncunun koşu hızı, birim/saniye.' },
  { k: 'pickupRangeU', ad: 'Ganimet alma menzili', tip: 'sayi', min: 1, max: 100,
    aciklama: 'Yerdeki ganimeti alabilmek için gereken en fazla uzaklık (birim).' },
  { k: 'targetSearchRangeU', ad: 'Hedef arama menzili', tip: 'sayi', min: 1, max: 500,
    aciklama: 'Hedef aramanın tarama yarıçapı (birim).' },
  { k: 'lootDespawnMs', ad: 'Ganimet yerde kalma (ms)', tip: 'tamsayi', min: 1000, max: 3600000,
    aciklama: 'Yere düşen ganimetin kaybolana kadar yerde kaldığı süre (ms).' },
  { k: 'lootOwnerLockMs', ad: 'Ganimet sahiplik kilidi (ms)', tip: 'tamsayi', min: 0, max: 600000,
    aciklama: 'Ganimetin yalnız sahibine kilitli kaldığı süre (ms).' },
  { k: 'corpseDespawnMs', ad: 'Ceset kalma süresi (ms)', tip: 'tamsayi', min: 500, max: 600000,
    aciklama: 'Ölen canavarın cesedinin sahnede kalma süresi (ms).' },
  { k: 'spawnSafeTimeMs', ad: 'Doğuş dokunulmazlığı (ms)', tip: 'tamsayi', min: 0, max: 600000,
    aciklama: 'Giriş/diriliş sonrası iki yönlü koruma süresi (ms): canavarlar ve '
      + 'oyuncular sana saldıramaz, sen de saldıramazsın (ekranda koruma çipi).' },
  { k: 'respawnHpPct', ad: 'Dirilişte HP oranı', tip: 'sayi', min: 0.05, max: 1,
    aciklama: 'Dirilişte HP’nin başlangıç oranı (0.05–1).' },
  { k: 'partyMaxSize', ad: 'Parti üst sınırı', tip: 'tamsayi', min: 2, max: 32,
    aciklama: 'Bir partiye girebilecek en fazla üye sayısı.' },
  { k: 'partyShareRangeU', ad: 'Parti paylaşım menzili', tip: 'sayi', min: 10, max: 2000,
    aciklama: 'Parti paylaşımının işlediği en fazla uzaklık (birim).' },
  { k: 'deathXpPenaltyPct', ad: 'Ölüm XP cezası (%)', tip: 'sayi', min: 0, max: 100,
    aciklama: 'Ölümde kaybedilen deneyim yüzdesi.' },
  /* BIZIM EKLENTIMIZ - referans oyunun game-config.json'inda YOKTUR.
     Bu yuzden "varsayilan" sutununda orijinal deger `—` gorunur ve deger
     yalnizca data/sunucu-ayarlari.json'da yasar; orijinal dosyaya ASLA
     yazilmaz (etkin() = {...GCFG, ...oku()} zaten boyle calisiyor).
     0 = ozellik KAPALI. Bkz. sistem_yerinde-dirilis.js */
  { k: 'yerindeDirilisMaxLevel', ad: 'Yerinde diriliş — üst seviye (0 = kapalı)',
    tip: 'tamsayi', min: 0, max: 255,
    aciklama: 'Bu seviye ve altındaki oyunculara öldükleri yerde diriliş teklifi '
      + 'gönderilir; 0 = özellik kapalı.' },
  /* BIZIM EKLENTIMIZ - referans oyunun game-config.json'inda YOKTUR (panelde
     "varsayilan" sutunu `—` gorunur, deger yalniz sunucu-ayarlari.json'da
     yasar). KAYNAK: GERCEK/gereksinim_leash_yuruyerek_2026-09-04.md.

     BILINCLI SAPMA: mesafe leash'i varsayilan olarak KAPALI (0 = sinirsiz).
     Kullanici mobu istedigi yere lure edebilmek istedi; mob oyuncuyu KENDI
     BOLGESI icinde sinirsiz kovalar, "radius disina cikinca isinlan/yeniden
     dog" davranisi kalkti. Isinlanma her halukarda kalkti: sinir asilsa bile
     mob evine YURUYEREK doner (gameloop.js #eveDonusBaslat).

     >0 verilirse eski mesafe leash'i geri gelir ve bu sayi mobun kendi
     leashRangeU'sunun (mobs.json'da 30-41) YERINE gecer; yuva yaricapi
     (Tab_RefNest, medyan 60 birim) her iki halde de eklenir - yoksa canavar
     kendi yuvasinin icinde bile "cok uzaklastim" der.
     Canli okunur: gameloop.js her tikte GCFG'ye bakar, restart gerekmez. */
  { k: 'canavarTakipSiniriU', ad: 'Canavar takip sınırı (birim, 0 = sınırsız)',
    tip: 'sayi', min: 0, max: 5000,
    aciklama: 'Canavarın doğduğu noktadan en fazla kaç birim uzağa kadar '
      + 'kovalayacağı. 0 = sınırsız (varsayılan): canavar oyuncuyu kendi '
      + 'bölgesi içinde sınırsız kovalar, istediğiniz kadar uzağa '
      + 'çekebilirsiniz. 0’dan büyük bir değer eski mesafe sınırını geri '
      + 'getirir ve canavarın kendi takip menzilinin yerine geçer (yuva '
      + 'yarıçapı ayrıca eklenir). Sınır aşıldığında canavar ışınlanmaz: '
      + 'hedefini bırakıp doğduğu yere YÜRÜYEREK döner, dönüş boyunca '
      + 'saldırmaz ve hasar almaz, eve varınca canı tamamen dolar.' },
  /* BIZIM EKLENTIMIZ - referans oyunun orijinal paketinde bu anahtarlar yok;
     game-config.json kopyamiza returnChannelMs=0 + tactionChannelMs=5000
     olarak eklendi (sartname: IKISI BIRLIKTE - tek basina returnChannelMs=0
     verilirse geri-dusus bagi premium harita isinlanma kanalini da 0'a
     dusurur). Panelden canli (restartsiz) degisir; kaydet -> tazele ->
     uygula -> sistemleriKur zinciri modulun kur()'una GCFG'yi yeniden
     okutur. Bos birakilan input kaydedilmez (bos-deger korumasi).
     Bkz. sistem_donus-isinlanma.js */
  { k: 'returnChannelMs', ad: 'Şehre dönüş kanal süresi (ms, 0 = anında)',
    tip: 'tamsayi', min: 0, max: 60000,
    aciklama: 'Şehre dönüş büyüsünün kanal (bekleme) süresi; 0 = anında ışınlar.' },
  { k: 'tactionChannelMs', ad: 'Harita ışınlanması kanal süresi (ms; ayarlanmazsa dönüş süresini izler)',
    tip: 'tamsayi', min: 0, max: 60000,
    aciklama: 'Harita ışınlanmasının kanal süresi; ayarlanmazsa şehre dönüş süresini izler.' },
];

/**
 * Panelin "hazir olay bildirimi" listesi.
 *
 * Kaynak: client/assets/locales/tr.json. Yalnizca "sys." ile baslayan ve
 * GERCEKTEN cevirisi olan anahtarlar listelenir - Tht enum'unda olup cevirisi
 * olmayan bir anahtar gonderilirse istemci BOS satir basar.
 * Metindeki {sustur} kaliplari parametre olarak cikarilir ki panel ilgili
 * kutulari gostersin (ornek: "sys.unique.spawned" -> {name}).
 */
let OLAY_ONBELLEK = null;
function olayAnahtarlari() {
  if (OLAY_ONBELLEK) return OLAY_ONBELLEK;
  OLAY_ONBELLEK = [];
  try {
    const yol = path.join(path.dirname(fileURLToPath(import.meta.url)),
      '..', 'client', 'assets', 'locales', 'tr.json');
    const t = JSON.parse(fs.readFileSync(yol, 'utf8'));
    for (const [k, v] of Object.entries(t)) {
      if (!k.startsWith('sys.') || typeof v !== 'string') continue;
      const params = [...String(v).matchAll(/\{(\w+)\}/g)].map(m => m[1]);
      OLAY_ONBELLEK.push({ k, metin: v, params });
    }
    OLAY_ONBELLEK.sort((a, b) => a.k.localeCompare(b.k));
  } catch { /* yerellestirme yoksa liste bos kalir */ }
  return OLAY_ONBELLEK;
}

export function createAdmin({ dataDir, GCFG, log, uygula, ctx = {} }) {
  const yol = path.join(dataDir, 'sunucu-ayarlari.json');

  /* SAF KOPYA - kalicilik tuzagi duzeltmesi. tazele() GCFG'yi YERINDE
     kirlettigi icin "orijinal referans oyun degeri" ancak ilk tazele()'den ONCE
     alinan bu derin kopyadan okunabilir. Olculen tuzak (GERCEK/denetim/
     curut_admin_kalicilik.mjs): esik 60 kaydet -> dosyada; sonra xpRate
     kaydet -> mutasyonlu GCFG ile 60===60 karsilastirmasi ESIGI dosyadan
     SILIYOR; restart'ta ozellik sessizce kapaniyor. Ayrica listele()
     "orijinal" sutunu ilk kayittan sonra bozuk, sifirla() bellegi geri
     almiyordu. */
  const ORJ = JSON.parse(JSON.stringify(GCFG));

  const oku = () => {
    try { return fs.existsSync(yol) ? JSON.parse(fs.readFileSync(yol, 'utf8')) : {}; }
    catch { return {}; }
  };
  const yaz = (o) => fs.writeFileSync(yol, JSON.stringify(o, null, 1));

  /* TEK SEFERLIK GOC - asagidaki tazele() cagrisindan ONCE kosmali.
     (1) Eski tek `rareDropRate` anahtari uc muhur kademesine ayrildi:
     dosyada varsa degeri sealStarRate/sealMoonRate/sealSunRate'e AYNEN
     kopyalanir (davranis degismez: uc kademe ayni carpanla baslar) ve
     eski anahtar silinir - tazele() ALANLAR'a bakmadan dosyadaki HER
     anahtari GCFG'ye yazdigi icin salt satir silmek yetmezdi, kalinti
     panelde gorunmeden uygulanmaya devam ederdi. (2) `bagSlots` panelden
     kaldirildi; kalintisi ayni nedenle temizlenir (GCFG.bagSlots
     game-config.json'dan gelmeye devam eder, okuyuculari etkilenmez). */
  {
    const d0 = oku();
    let kirli = false;
    if ('rareDropRate' in d0) {
      for (const k of ['sealStarRate', 'sealMoonRate', 'sealSunRate']) {
        if (!(k in d0)) d0[k] = d0.rareDropRate;
      }
      delete d0.rareDropRate;
      kirli = true;
    }
    if ('bagSlots' in d0) { delete d0.bagSlots; kirli = true; }
    if (kirli) {
      yaz(d0);
      log('[admin] goc: rareDropRate -> sealStarRate/sealMoonRate/sealSunRate, bagSlots kaldirildi');
    }
  }

  /** Etkin ayar = referans oyun orijinali + GM degisiklikleri. */
  function etkin() {
    return { ...GCFG, ...oku() };
  }

  /** Degisiklikleri CALISAN GCFG nesnesine uygular (yeniden baslatma gerekmez). */
  function tazele() {
    /* ONCE panel alanlarini ORJ'a geri dondur: bir onceki tazele()'nin
       yazdigi degerler GCFG'de kalirsa dosyadan SILINEN bir ayar bellekte
       yasamaya devam eder ve sifirla() canli degerleri geri alamazdi.
       Yalnizca ALANLAR taranir - panel disi anahtarlara dokunulmaz. */
    for (const a of ALANLAR) {
      if (Object.prototype.hasOwnProperty.call(ORJ, a.k)) GCFG[a.k] = ORJ[a.k];
      else delete GCFG[a.k];
    }
    const d = oku();
    for (const [k, v] of Object.entries(d)) GCFG[k] = v;
    uygula?.(GCFG);
    return Object.keys(d).length;
  }
  tazele();   // acilista varsa uygula

  function dogrula(k, ham) {
    const a = ALANLAR.find(x => x.k === k);
    if (!a) return { hata: `bilinmeyen ayar: ${k}` };
    const n = Number(ham);
    if (!Number.isFinite(n)) return { hata: `${a.ad}: sayi olmali` };
    if (a.tip === 'tamsayi' && !Number.isInteger(n)) return { hata: `${a.ad}: tam sayi olmali` };
    if (n < a.min || n > a.max) return { hata: `${a.ad}: ${a.min} ile ${a.max} arasinda olmali` };
    return { deger: n };
  }

  return {
    ALANLAR,
    etkin,

    /** GET /api/v1/admin/ayarlar */
    listele() {
      const e = etkin(), d = oku();
      return {
        alanlar: ALANLAR.map(a => ({
          ...a,
          deger: e[a.k],
          /* Mutasyonlu GCFG degil SAF KOPYA: yoksa "orijinal" sutunu ilk
             kayittan sonra GM'in kendi degerini gosteriyordu. */
          orijinal: Object.prototype.hasOwnProperty.call(ORJ, a.k) ? ORJ[a.k] : null,
          degistirilmis: Object.prototype.hasOwnProperty.call(d, a.k),
        })),
      };
    },

    /** POST /api/v1/admin/ayarlar  { xpRate: 50, ... } */
    kaydet(govde) {
      const d = oku();
      const hatalar = [], degisen = [];
      for (const [k, v] of Object.entries(govde ?? {})) {
        /* BOS-DEGER KORUMASI: admin.html Kaydet TUM inputlari yollar; hic
           set edilmemis bir alanin bos inputu Number('')===0 oldugu icin
           dogrulamadan gecer ve GM alakasiz bir ayari kaydettigi anda o alan
           sessizce 0 olurdu (ornn. returnChannelMs). Bos deger = dokunma. */
        if (v === '' || v == null) continue;
        const r = dogrula(k, v);
        if (r.hata) { hatalar.push(r.hata); continue; }
        /* Orijinaline esitse degisiklik kaydini SIL (temiz kalsin).
           Karsilastirma SAF KOPYA ile - mutasyonlu GCFG ile yapilinca ikinci
           Kaydet, degismeyen alanlari "orijinaline esit" sanip dosyadan
           siliyordu (kalicilik tuzagi olcumu). */
        if (ORJ[k] === r.deger) { delete d[k]; degisen.push(`${k} = varsayilan`); }
        else { d[k] = r.deger; degisen.push(`${k} = ${r.deger}`); }
      }
      if (hatalar.length) return { code: 400, body: { error: hatalar.join(' | ') } };
      yaz(d);
      const n = tazele();
      log(`[admin] ayar guncellendi: ${degisen.join(', ')} (aktif fark: ${n})`);
      return { code: 200, body: { ok: true, degisen, ayarlar: this.listele() } };
    },

    /* ================================================================ CANLI DURUM */
    /** GET /api/v1/admin/durum */
    durum() {
      const w = ctx.world;
      const bolgeler = [];
      let oyuncu = 0, canli = 0, olu = 0, ganimet = 0;
      for (const [zid, z] of (w?.zoneState ?? new Map())) {
        let c = 0, o = 0, g = 0;
        for (const e of z.entities.values()) {
          if (e.kind === 'ground_item') g++;
          else if (e.dead) o++; else c++;
        }
        oyuncu += z.players.size; canli += c; olu += o; ganimet += g;
        bolgeler.push({ bolge: zid, oyuncu: z.players.size, canavar: c, olu: o, ganimet: g });
      }
      const kb = (n) => Math.round(n / 1048576);
      return {
        calismaSuresiSn: Math.round(process.uptime()),
        bellekMB: kb(process.memoryUsage().rss),
        oyuncu, canavar: canli, oluCanavar: olu, ganimet,
        bolgeler: bolgeler.sort((a, b) => b.oyuncu - a.oyuncu),
        cevrimici: ctx.cevrimiciListe ? ctx.cevrimiciListe() : [],
      };
    },

    /* ================================================================ HESAPLAR */
    /** GET /api/v1/admin/hesaplar?q=... */
    async hesaplar(q) {
      if (!ctx.sorgu) return { hata: 'veritabani yok' };
      const like = `%${String(q ?? '').slice(0, 30)}%`;
      return ctx.sorgu('hesaplar', like);
    },

    /** POST /api/v1/admin/hesap  {JID, gm?, ban?} */
    async hesapGuncelle(g) {
      if (!ctx.hesapGuncelle) return { code: 500, body: { error: 'veritabani yok' } };
      const JID = Number(g?.JID);
      if (!Number.isInteger(JID) || JID <= 0) return { code: 400, body: { error: 'gecersiz JID' } };
      const r = await ctx.hesapGuncelle(JID, g);
      log(`[admin] hesap ${JID}: ${JSON.stringify(g)}`);
      return { code: 200, body: r };
    },

    /* ================================================================ KARAKTERLER */
    async karakterler(q) {
      if (!ctx.sorgu) return { hata: 'veritabani yok' };
      return ctx.sorgu('karakterler', `%${String(q ?? '').slice(0, 30)}%`);
    },

    /* ================================================================ DUYURU
     * referans oyunda duyurunun TEK bir bicimi yok. Paketten (index-BUMMQVRB.js)
     * dogrulanan gercek yollar:
     *
     *  chat.recv (160)  { ch: local|global|party|guild|system, from, text, fromTier? }
     *      -> sohbet kutusuna GONDERENLI satir
     *  sys.notice (195) { key: qJ(Tht), params?, display?: line|banner }
     *      -> istemci isleyicisi (bayt dogrulandi):
     *         key === 'raw'  ise  params.text SERBEST METIN olarak basilir
     *           K$.push({ch:'system', from:'', text})
     *           display==='banner' ise AYRICA D5.pushText(text, min(12000, 4000+len*40))
     *         aksi halde  K$.pushSys(key, params)  (yerellestirilmis, tr.json'dan)
     *           display==='banner' ise AYRICA D5.push(key, params)
     *
     *  display enum'u SADECE ['line','banner'] - baska bir bicim protokolde YOK.
     *  fromTier enum'u ['bronze','silver','gold'] (premium rozeti).
     */
    duyuruSecenekleri() {
      return {
        turler: [
          { k: 'sistem', ad: 'Sistem sohbet satırı', aciklama: 'chat.recv ch=system — gönderen adıyla sohbete düşer' },
          { k: 'genel', ad: 'Genel sohbet (global)', aciklama: 'chat.recv ch=global — genel kanala düşer' },
          { k: 'bildirim', ad: 'Bildirim satırı', aciklama: "sys.notice key=raw display=line — gönderen adı olmadan sistem satırı" },
          { k: 'bant', ad: 'Ekran bandı (banner)', aciklama: 'sys.notice key=raw display=banner — ekranda büyük bant + sohbet satırı' },
          { k: 'olay', ad: 'Hazır olay bildirimi', aciklama: 'sys.notice key=<seçilen> — tr.json’dan yerelleştirilmiş metin, satır veya bant' },
        ],
        /* Tht enum'u: 129 anahtar + 'raw'. Yalnizca tr.json'da GERCEKTEN karsiligi
           olanlari listeliyoruz - karsiligi olmayan anahtar istemcide bos satir basar. */
        olayAnahtarlari: olayAnahtarlari(),
        bicimler: [
          { k: 'line', ad: 'Satır' },
          { k: 'banner', ad: 'Ekran bandı' },
        ],
        rozetler: ['bronze', 'silver', 'gold'],
        metinSiniri: 200,
      };
    },

    /** POST /api/v1/admin/duyuru  { tur, metin?, from?, key?, params?, display? } */
    duyuru(g) {
      /* Geriye donuk uyum: eski panel duz metin gonderiyordu. */
      const govde = (typeof g === 'string') ? { tur: 'sistem', metin: g } : (g ?? {});
      const tur = String(govde.tur ?? 'sistem');
      const bicim = govde.display === 'banner' ? 'banner' : 'line';
      const metin = String(govde.metin ?? '').trim().slice(0, 200);
      const gonderen = String(govde.from ?? 'Sistem').slice(0, 16);

      if (tur === 'olay') {
        const anahtar = String(govde.key ?? '');
        if (!olayAnahtarlari().some(x => x.k === anahtar)) {
          return { code: 400, body: { error: `bilinmeyen bildirim anahtarı: ${anahtar}` } };
        }
        const params = (govde.params && typeof govde.params === 'object') ? govde.params : undefined;
        ctx.yayin?.('sys.notice', params ? { key: anahtar, params, display: bicim } : { key: anahtar, display: bicim });
        log(`[admin] duyuru olay: ${anahtar} (${bicim})`);
        return { code: 200, body: { ok: true, gonderildi: anahtar, bicim } };
      }

      if (!metin) return { code: 400, body: { error: 'boş mesaj' } };

      if (tur === 'bildirim' || tur === 'bant') {
        /* key 'raw' -> params.text serbest metin. display banner ise bant da cikar. */
        ctx.yayin?.('sys.notice', { key: 'raw', params: { text: metin }, display: tur === 'bant' ? 'banner' : 'line' });
      } else if (tur === 'genel') {
        ctx.yayin?.('chat.recv', { ch: 'global', from: gonderen, text: metin });
      } else {
        ctx.yayin?.('chat.recv', { ch: 'system', from: gonderen, text: metin });
      }
      log(`[admin] duyuru (${tur}): ${metin}`);
      return { code: 200, body: { ok: true, gonderildi: metin, tur } };
    },

    /** POST /api/v1/admin/sifirla */
    sifirla() {
      yaz({});
      tazele();
      log('[admin] tum ayarlar referans oyun varsayilanina donduruldu');
      return { code: 200, body: { ok: true, ayarlar: this.listele() } };
    },
  };
}
