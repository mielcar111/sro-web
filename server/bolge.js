/**
 * BOLGELER ARASI GECIS  (zone.transfer 132 + yeniden zone.init 131)
 *
 * NEDEN AYRI DOSYA: server.js'te gomulu kalirsa birim testi yazilamaz
 * (server.js import edilir edilmez HTTP dinlemeye ve SQL'e baglanmaya
 * basliyor). bacak.js / nav.js / gezinme.js ile ayni cizgide bir cekirdek
 * yardimci modul; sistem_<ad>.js DEGIL, otomatik yuklenmez.
 *
 * =============================================================================
 * GERCEGIN KAYNAGI - hepsi istemci paketinden okundu, hicbiri uydurulmadi
 *   playjs_source\index-BUMMQVRB.js
 *
 * 1) SEMA (bayt 25617844):
 *      T$(`zone.init`, 131, X({ zoneId, zoneName, kind: qJ([`safe`,`field`]),
 *                               tick, serverTime, self: _ht, entities: BJ($mt) }))
 *      T$(`zone.transfer`, 132, X({ zoneId: J(),
 *                                   wsUrl: J().optional(),
 *                                   ticket: J().optional() }))
 *
 * 2) ISTEMCININ `zone.transfer` ISLEYICISI (bayt 27117640) - AYNEN:
 *      W$.on(`zone.transfer`, m => {
 *        W5(), kkt(m.zoneId);
 *        let k = Q.self()?.modelKey;
 *        k && xDt([k]),
 *        m.wsUrl && m.ticket && ( wQ(_2(`loading.traveling`)),
 *                                 F$.getState().setPhase(`connecting`),
 *                                 W$.connect(m.wsUrl, m.ticket) );
 *      });
 *    kkt (bayt 26975930):
 *      function kkt(id){ if (Dkt()) return;
 *        let z = IY().zonesById.get(id); if (!z?.bin) return;
 *        jY(z, {load: Okt}, a8()).catch(()=>{});      // bolge .bin'ini ON-YUKLE
 *        let d = z.ground?.splat?.dir; d && s8(`/assets/ground/splat/${d}...`)
 *      }
 *    => wsUrl VE ticket ikisi birden gonderilmedikce ISTEMCI BAGLANTIYI
 *       KOPARMAZ. Tek surecli sunucuda dogru akis:
 *
 *           zone.transfer { zoneId }      (yalnizca on-yukleme tetigi)
 *           zone.init     { ... }         (ayni soketten tam anligorunum)
 *
 *       wsUrl+ticket dali ancak bolgeler AYRI SUNUCU sureclerine bolununce
 *       gerekir; o zaman burada bilet uretilip adres yollanir.
 *
 * 3) `zone.init` YENIDEN GONDERILEBILIR mi? EVET (bayt 25659057):
 *      applyZoneInit(m, t) { this.reset(), ... }
 *      reset(){ for (let id of [...this.entities.keys()]) this.removeEntity(id);
 *               this.entities.clear(); }
 *    Istemci tum varliklari silip sifirdan kuruyor; ayrica (bayt 27115713)
 *    beginZoneEpoch / clearServerState / zoneInit / pushSys(`sys.zone.entered`).
 *    entityId'yi degistirmeye GEREK YOK.
 *
 * 4) KAPILAR (`gates`) - bolge semasi (bayt 8713499):
 *      gates: BJ(X({ id: J(), x: Y(), z: Y(), y: Y().optional(),
 *                    radiusU: Y().positive(), toZone: J(), toPos: CY }))
 *    Pakette `gates` SADECE iki yerde kullaniliyor:
 *      (a) 25050690 - dogrulama: hedef bolge var mi, toPos sinirlarin icinde mi
 *      (b) 26998127 - zemine cizilen DISK (uf.CreateDisc, radius: vec.radiusU)
 *    "Kapiya girdim" diye bir c2s mesaji YOK -> tetikleme SUNUCUNUN isi.
 *    VE BU DUNYADA VERI YOK: paket_veri/zones/*.json icindeki 5 gercek
 *    bolgenin hepsinde `gates: []` (dogrulandi). Kapili gecis yalnizca test
 *    bolgelerinde var (zone_city <-> zone_field, radiusU 4).
 *    => Gercek bolge gecisi TAMAMEN isinlayici NPC'lerle (gate_ch, gate_wc,
 *       gate_kt, gate_ca, gate_eu + ferry/flyship/tunnel NPC'leri).
 * =============================================================================
 */

/**
 * @param {object} d bagimliliklar - hepsi server.js'ten gelir
 * @param {Map<string,Set>} d.zones        zoneId -> Set(ws)   (broadcast kumesi)
 * @param {object} d.world                 World ornegi (world.js)
 * @param {object} d.worldData             world.json
 * @param {object} d.zoneMeta              zones.json (name/kind)
 * @param {Function} d.frame               frame(ws,t,d)
 * @param {Function} d.broadcast           broadcast(zoneId,t,d,except)
 * @param {Function} d.log
 * @param {Function} d.zoneGroundY         (zoneId,x,z,oncekiY?) -> y
 * @param {Function} d.selfPayload         (ch, entityId) -> zone.init.self
 * @param {Function} d.entityPayload       (ch, entityId) -> $mt
 * @param {Function} d.zoneNpcEntities     (zoneId) -> [$mt]
 * @param {Function} d.bacakDurdur         (ch) -> void
 * @param {Function} [d.konumuKaydet]      (ws) -> void   (kalicilastirma)
 * @param {Function} [d.sistemler]         () -> [{ad, ornek}]
 * @param {Function} [d.now]               () -> ms
 */
export function kurBolgeGecisi(d) {
  const {
    zones, world, worldData, zoneMeta, frame, broadcast,
    zoneGroundY, selfPayload, entityPayload, zoneNpcEntities, bacakDurdur,
  } = d;
  const log = d.log ?? (() => {});
  const konumuKaydet = d.konumuKaydet ?? (() => {});
  const sistemler = d.sistemler ?? (() => []);
  const now = d.now ?? (() => Date.now());
  /* Sunucunun tik sayaci. zone.init'teki `tick` istemcinin zaman ekseninin
     SIFIR NOKTASI (tick0) - sonraki her `batch` zarfi icin
        currentBatchTime = serverTime0 + (tick - tick0) * (1000/tickHz)
     hesaplaniyor (index-BUMMQVRB.js @625770). Sabit 0 verilirse gecis
     sonrasinda butun batch zamanlari sunucu acilisindan bu yana gecen sure
     kadar GELECEGE kayiyor. server.js gercek sayaci `tik` ile geciriyor. */
  const tik = d.tik ?? (() => 0);

  /** Bolge gercekten var mi? (Istemci kendi katalogunda olmayani hidrate edemez.) */
  function bolgeVar(zid) {
    return !!zid && !!worldData?.zones?.[zid];
  }

  function meta(zid) {
    return zoneMeta?.[zid] ?? { name: worldData?.zones?.[zid]?.name ?? zid, kind: 'field' };
  }

  /**
   * Oyuncuyu baska bir bolgeye tasir.
   * @returns {boolean} gecis yapildiysa true. Hedef bilinmiyorsa / varis
   *   noktasi bozuksa FALSE - cagiran o zaman ucreti geri verir ve hata
   *   yollar. Sessizce yanlis yere isinlamaktansa reddetmek dogru.
   */
  function bolgeGecisi(ws, yeniZone, hedef) {
    if (!ws?.isAuthed || !ws.char) return false;
    const zid = String(yeniZone ?? '');
    if (!bolgeVar(zid)) {
      log(`bolge gecisi reddedildi: bilinmeyen bolge "${zid}"`);
      return false;
    }
    if (!hedef || !Number.isFinite(hedef.x) || !Number.isFinite(hedef.z)) {
      log(`bolge gecisi reddedildi: ${zid} icin gecersiz varis noktasi`);
      return false;
    }

    const ch = ws.char;
    const eskiZone = ws.zoneId;

    /* AYNI BOLGE: transfer degil, sade isinlanma. Cagiran modul bunu zaten
       ayirt ediyor; savunma olarak burada da dogru davranalim. */
    if (eskiZone === zid) {
      bacakDurdur(ch);
      ws.savas = null; ws.hedefId = null;
      ch.x = hedef.x; ch.z = hedef.z;
      /* FARK #169: hedef.y SONUC degil TOHUM - zoneGroundY 4. argumanla
         dogru KATIN yuzeyini secer (kopru ustu / alti). Eski hal y'yi
         dogrudan atiyordu; sonuc genelde ayniydi ama yuzey secimi
         yapilmadigindan platform kenarlarinda kat bilgisi kayboluyordu.
         hedef.y yoksa zoneGroundY tohumsuz calisir (arazi). */
      ch.y = zoneGroundY(zid, hedef.x, hedef.z,
                         Number.isFinite(hedef.y) ? hedef.y : undefined);
      const kare = { id: ws.entityId, x: ch.x, z: ch.z, y: ch.y };
      frame(ws, 'entity.teleport', kare);
      broadcast(zid, 'entity.teleport', kare, ws);
      return true;
    }

    /* 1) ESKI bolgeden tamamen kopar.
       SIRA ONEMLI: world.oyuncuCik(ws) ws.zoneId'yi OKUYOR, bu yuzden
       ws.zoneId degismeden ONCE cagrilmali. */
    bacakDurdur(ch);            // yuruyus hedefi kalirsa oyuncu geri suruklenir
    ws.savas = null;            // bolge degistirdin: savas biter
    ws.hedefId = null;
    zones.get(eskiZone)?.delete(ws);
    world.oyuncuCik(ws);
    broadcast(eskiZone, 'state.delta', { rem: [ws.entityId] }, ws);
    /* Eski bolgedeki canavarlarin hedefi bu oyuncuysa birak. gameloop zaten
       `[...z.players].find(p => p.entityId === hedefId)` bulamayinca
       temizliyor, ama bir tik beklemeye gerek yok. */
    for (const e of world.zoneState?.get(eskiZone)?.entities.values() ?? []) {
      if (e.hedefEntityId === ws.entityId) e.hedefEntityId = null;
    }

    /* 2) Konumu tasi. ch.zone da guncellenir: konumuKaydet _Char'a
       LatestRegion'i x/z'den turetiyor ama moduller ch.zone'a bakiyor. */
    ws.zoneId = zid;
    ch.zone = zid;
    ch.x = hedef.x;
    ch.z = hedef.z;
    /* FARK #169: hedef.y TOHUM olarak gecer (yukaridaki ayni-bolge daliyla
       ayni gerekce) - varis noktasi kopru/platform ustundeyse oyuncu alt
       kata dusmez. */
    ch.y = zoneGroundY(zid, hedef.x, hedef.z,
                       Number.isFinite(hedef.y) ? hedef.y : undefined);

    /* 3) TRANSFER KARESI. zone.init'ten ONCE gitmeli: istemci burada hedef
       bolgenin .bin/varlik dosyalarini on-yuklemeye basliyor, boylece
       zone.init geldiginde hidrasyon beklemesi kisaliyor.
       wsUrl/ticket YOK -> ayni soket kullanilmaya devam eder. */
    frame(ws, 'zone.transfer', { zoneId: zid });

    /* 4) Yeni bolgeye kaydol. */
    if (!zones.has(zid)) zones.set(zid, new Set());
    const peers = [...zones.get(zid)].filter((c) => c.isAuthed && c !== ws && c.char);
    zones.get(zid).add(ws);

    /* 5) Yeni bolgenin TAM anligorunumu - auth dalindaki kurulumla AYNI.
       Oyuncunun KENDI varligi da listede olmali, yoksa istemci avatari hic
       yaratmaz: entities.find(n => n.id === self.entityId) (bayt 27115400). */
    const zm = meta(zid);
    frame(ws, 'zone.init', {
      zoneId: zid, zoneName: zm.name, kind: zm.kind,
      tick: tik(), serverTime: now(),
      self: selfPayload(ch, ws.entityId),
      entities: (() => {
        world.oyuncuGir(ws);           // gorunen kumesini de sifirlar
        const liste = [
          entityPayload(ch, ws.entityId),
          ...zoneNpcEntities(zid),
          ...peers.map((c) => entityPayload(c.char, c.entityId)),
          ...world.yakindakiler(ws),
        ];
        world.gorunenleriKur(ws, liste);
        return liste;
      })(),
    });
    broadcast(zid, 'state.delta', { add: [entityPayload(ch, ws.entityId)] }, ws);

    /* 6) Konumu hemen kalicilastir - gecis sirasinda kopan baglanti oyuncuyu
       eski bolgede birakmasin (30 sn'lik periyodik kayit beklenmez). */
    try { konumuKaydet(ws); } catch { /* kayit kritik degil */ }

    /* 7) Sistem modulleri haber alsin (istege bagli kanca). */
    for (const s of sistemler()) {
      try { s.ornek?.bolgeDegisti?.(ws, eskiZone, zid); }
      catch (e) { log(`sistem_${s.ad} bolgeDegisti hatasi:`, String(e.message).slice(0, 120)); }
    }

    /* 8) GIRIS KARELERINI TEKRARLA.
       zone.init isleyicisi istemcide durum SIFIRLIYOR (index-BUMMQVRB.js
       @654475):  E8.clearServerState() (pet) ve y8.clearServerState() (gpet).
       Yani her zone.init'ten sonra pet.state / gpet.state / carrier.state /
       taction.marks yeniden yollanmazsa evcil hayvan ve isaret arayuzu
       BOSALIYOR. server.js bu kancayi giris.js#girisAkisi ile dolduruyor;
       verilmezse gecis eskisi gibi calisir (sadece kareler eksik kalir). */
    try { d.girisKareleri?.(ws); }
    catch (e) { log('bolge gecisi giris kareleri hatasi:', String(e.message).slice(0, 140)); }

    log(`bolge gecisi: ${ch.name} ${eskiZone} -> ${zid} ` +
        `(${ch.x.toFixed(1)}, ${ch.z.toFixed(1)})`);
    return true;
  }

  // ------------------------------------------------------------------ kapilar
  /** zoneId -> [{id, x, z, r2, toZone, toPos}] - bos kalirsa tik hic calismaz. */
  const KAPILAR = new Map();
  {
    let n = 0;
    for (const [zid, z] of Object.entries(worldData?.zones ?? {})) {
      const liste = [];
      for (const g of z.gates ?? []) {
        const r = Number(g.radiusU);
        if (!(r > 0) || !g.toZone || !g.toPos) continue;
        liste.push({ id: g.id, x: g.x, z: g.z, r2: r * r, toZone: g.toZone, toPos: g.toPos });
        n++;
      }
      if (liste.length) KAPILAR.set(zid, liste);
    }
    if (n) log(`kapi (gates): ${n} adet, ${KAPILAR.size} bolgede`);
  }

  /**
   * Kapi yaricapina giren oyuncuyu karsi bolgeye gecirir.
   * KAPILAR bossa cagiran hic cagirmaz (bu dunyada durum bu).
   */
  function kapiTik() {
    for (const [zid, liste] of KAPILAR) {
      for (const ws of [...(zones.get(zid) ?? [])]) {
        if (!ws.isAuthed || !ws.char || ws.char.dead) continue;
        for (const g of liste) {
          const dx = ws.char.x - g.x, dz = ws.char.z - g.z;
          if (dx * dx + dz * dz > g.r2) continue;
          const y = g.toPos.y != null ? g.toPos.y
            : zoneGroundY(g.toZone, g.toPos.x, g.toPos.z);
          if (bolgeGecisi(ws, g.toZone, { x: g.toPos.x, z: g.toPos.z, y })) {
            /* `sys.teleport.arrived` tr.json'da GERCEKTEN var (satir 1814) ve
               params { destId, dest } ikisini birden istiyor (bayt 27115800). */
            frame(ws, 'sys.notice', {
              key: 'sys.teleport.arrived',
              params: { destId: g.id, dest: meta(g.toZone).name },
            });
          }
          break;                 // gecis oldu ya da reddedildi - bu tik yeter
        }
      }
    }
  }

  return { bolgeGecisi, kapiTik, KAPILAR };
}
