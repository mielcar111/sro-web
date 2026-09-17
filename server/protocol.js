/**
 * Oyun protokolu - opcode tablosu.
 *
 * Tarayici istemcisi her cerceveyi  { t: <ad>, d: <veri>, q: <sira> }  seklinde
 * JSON olarak gonderir/alir. Opcode numaralari istemcinin kendi kayit
 * tablosundan birebir alinmistir (T$(ad, opcode, ZodSemasi, hizSinifi)).
 *
 * HIZ SINIFI (madde 60): paketteki kayit 4 parametrelidir -
 *     function T$(name, id, schema, rateClass)          (paket @25603840)
 * ve 102 c2s mesajinin TAMAMI etiketlidir (ornek @25608908:
 * move.click/move.stop/target.set -> `move`; shop.buy -> `shop`;
 * item.repairHammer -> `inv`; bank.depositGold -> `exchange`).
 * Tablo BURADA COGALTILMAZ: data/schemas.json her mesajda `rateClass`
 * alanini zaten tasiyor (13 sinif, sayim paketle birebir dogrulandi) ve
 * server.js "HIZ SINIRLAYICI" blogu onu oradan okuyor. Iki kopya tutmak
 * sessiz ayrisma riskidir.
 *
 *   16..126  istemci -> sunucu   (100 mesaj)
 *  128..216  sunucu  -> istemci  ( 89 mesaj)
 *  240..244  sistem / hata       (  5 mesaj)
 *
 * ONEMLI (2026-09-03 denetiminde DUZELTILDI): sema YALNIZ sunucuda uygulanir;
 * istemci gonderim/alimda runtime dogrulama YAPMAZ (paket olcumu: m$.send ve
 * dispatch semasiz ham JSON gecirir; agt/ogt kayit tablolari salt-yazilir olu
 * kod). Sunucu tarafi gevsetilirken istemcinin sessiz reddine GUVENILEMEZ.
 * Yukarida atif yapilan T$ Zod semalari istemci KAYNAGINDAN alinmis BELGEDIR;
 * o belgede `nullable` alanlar zorunlu anahtardir (deger null olabilir ama
 * anahtar bulunmak zorunda) - sunucu yayinlari bu sozlesmeye uymayi surdurur.
 */

export const C2S = {
  16: 'move.click', 17: 'move.stop', 18: 'target.set', 19: 'target.clear',
  20: 'combat.attack', 21: 'combat.stop', 22: 'skill.cast', 23: 'buff.cancel',
  24: 'macro.save', 25: 'item.spscroll', 30: 'autopotion.save', 31: 'hotbar.save',
  32: 'stats.allocate', 33: 'mastery.raise', 34: 'skill.learn', 35: 'profession.learn',
  36: 'gather.start', 37: 'gather.cancel', 38: 'stone.craft', 39: 'stone.apply',
  40: 'carrier.op', 41: 'profession.scroll', 42: 'item.repairHammer', 43: 'inv.split',
  47: 'inv.destroy', 48: 'inv.move', 49: 'inv.use', 50: 'loot.pickup',
  51: 'shop.buy', 52: 'shop.sell', 53: 'item.enhance', 54: 'item.repair',
  55: 'trade.request', 56: 'trade.respond', 57: 'trade.offerItem', 58: 'trade.retract',
  59: 'trade.setGold', 60: 'trade.approve', 61: 'trade.unapprove', 62: 'trade.confirm',
  63: 'trade.cancel', 64: 'chat.send', 65: 'pet.summon', 66: 'pet.dismiss',
  67: 'pet.settings', 68: 'chat.whisper', 69: 'mount.use', 70: 'mount.dismount',
  71: 'party.create', 72: 'party.match', 73: 'gpet.summon', 74: 'gpet.dismiss',
  75: 'gpet.command', 80: 'respawn.request', 81: 'zone.ready', 82: 'teleport.use',
  83: 'return.start', 84: 'return.cancel', 85: 'revive.respond', 86: 'taction.teleport',
  87: 'world.logout', 88: 'party.invite', 89: 'party.respond', 90: 'party.leave',
  91: 'party.kick', 92: 'party.lead', 93: 'unique.op', 94: 'item.reset',
  95: 'bank.moveItem', 96: 'exch.open', 97: 'exch.close', 98: 'exch.place',
  99: 'exch.cancel', 100: 'exch.withdrawGold', 101: 'exch.mockDeposit',
  102: 'exch.mockWithdraw', 103: 'exch.stake', 104: 'exch.claimStake',
  105: 'bank.depositGold', 106: 'bank.withdrawGold', 107: 'bank.depositItem',
  108: 'bank.withdrawItem', 109: 'stall.open', 110: 'stall.close', 111: 'stall.modify',
  112: 'stall.update', 113: 'stall.enter', 114: 'stall.leave', 115: 'stall.buy',
  116: 'quest.accept', 117: 'quest.abandon', 118: 'quest.claim', 119: 'mall.buy',
  120: 'premium.buy', 121: 'guild.create', 122: 'guild.manage', 123: 'guild.bank',
  124: 'guild.query', 125: 'auction.op', 126: 'item.expand',
};

export const S2C = {
  128: 'hello', 129: 'auth.ok', 130: 'pong', 131: 'zone.init', 132: 'zone.transfer',
  133: 'state.delta', 134: 'entity.move', 135: 'entity.stop', 136: 'entity.teleport',
  137: 'entity.hp', 138: 'cast.start', 139: 'cast.ok', 140: 'combat.event',
  141: 'combat.death', 142: 'buffs.update', 143: 'skill.fire', 144: 'progress.update',
  145: 'progress.levelUp', 146: 'stats.update', 147: 'mastery.update', 148: 'skills.update',
  149: 'inv.update', 150: 'vitals.update', 151: 'appearance.update', 152: 'trade.incoming',
  153: 'trade.update', 154: 'trade.close', 155: 'entity.pickup', 156: 'stall.own',
  157: 'stall.view', 158: 'stall.viewClosed', 159: 'stall.board', 160: 'chat.recv',
  161: 'pet.state', 162: 'chat.pm', 163: 'guild.state', 164: 'guild.invited',
  165: 'guild.left', 166: 'guild.bankState', 167: 'guild.log', 168: 'party.invited',
  169: 'party.update', 170: 'party.left', 171: 'guild.directory', 172: 'entity.guild',
  173: 'mount.update', 174: 'party.matchBoard', 175: 'party.matchApplication',
  176: 'exch.book', 177: 'exch.wallet', 178: 'exch.orders', 179: 'exch.trades',
  180: 'exch.fill', 181: 'exch.stakes', 182: 'bank.items', 183: 'quest.catalog',
  184: 'quest.state', 185: 'quest.progress', 186: 'item.enhanced', 187: 'fx.itemUsed',
  188: 'fx.levelUp', 189: 'premium.update', 190: 'entity.premium', 191: 'fx.returnStart',
  192: 'fx.returnStop', 193: 'return.begin', 194: 'return.end', 195: 'sys.notice',
  196: 'cast.cancel', 197: 'combat.monsterAction', 198: 'fx.petAppear',
  199: 'statuses.update', 200: 'cast.queued', 201: 'revive.offer', 202: 'revive.result',
  203: 'unique.timers', 204: 'unique.board', 205: 'env.clock', 206: 'progress.gainFx',
  207: 'profession.update', 208: 'gather.action', 209: 'gather.end', 210: 'gather.yield',
  211: 'stone.crafted', 212: 'stone.applied', 213: 'carrier.state', 214: 'gpet.state',
  215: 'taction.marks', 216: 'auto.windup',
};

export const SYS = { 240: 'err', 241: 'kick', 242: 'auction.list', 243: 'auction.mine', 244: 'auction.notice' };

/** 15 kusam yuvasi - hepsi ZORUNLU, bos olan null olmali. */
export const EQUIP_SLOTS = [
  'weapon', 'shield', 'head', 'shoulder', 'chest', 'gloves', 'pants', 'boots',
  'avatarDress', 'avatarHat', 'avatarAttach', 'earring', 'necklace', 'ringL', 'ringR',
];

export function emptyEquip() {
  const e = {};
  for (const s of EQUIP_SLOTS) e[s] = null;
  return e;
}

/**
 * derived - istemcinin `rht` semasi; her alan zorunlu sayi (paket @25594400:
 * `physAbsorb: Y()`, `magAbsorb: Y()`, `statusResists: X({fb,es,bu,ps,zb})`).
 *
 * DIKKAT - BU YETKILI HESAP DEGILDIR. Yalnizca SEMA BICIMI ureten bir yedektir
 * (server.js karakter yaratirken hp/mp tohumu icin cagirir); girdisi sadece
 * level/str/int oldugu icin EKIPMAN BILGISI YOKTUR:
 *   - physAbsorb / magAbsorb aksesuar rollRanges'inden gelir (data/itemstats.json,
 *     288 aksesuar; ymt accessory grubu = [['physAbsorb'],['magAbsorb']]),
 *   - statusResists mavi secenek satirlarindan gelir (magic-opts.json
 *     MATTR_RESIST_*), o da esyada durur.
 * Bu yuzden burada ikisi de YAPISAL OLARAK 0'dir - "hesaplanip cope atilan"
 * deger degil. Gercek degerler Combat.turetilmis() icinde uretilir; oyuna giren
 * her karaktere stats.update oradan gider.
 */
export function derivedStats({ level = 1, str = 20, int = 20 } = {}) {
  const maxHp = 200 + level * 80 + str * 10;
  const maxMp = 200 + level * 60 + int * 10;
  return {
    maxHp, maxMp,
    physAtkMin: 10 + str * 2, physAtkMax: 18 + str * 3,
    magAtkMin: 10 + int * 2, magAtkMax: 18 + int * 3,
    physAtkIncPct: 0, magAtkIncPct: 0, dmgIncPct: 0,
    physDef: 5 + level, magDef: 5 + level,
    physBalancePct: 100, magBalancePct: 100,
    hitRatio: 10 + level, parryRatio: 10 + level,
    blockRatio: 0, critRating: 0,
    physAbsorb: 0, magAbsorb: 0,
    mpDiscountPct: 0,
    statusResists: { fb: 0, es: 0, bu: 0, ps: 0, zb: 0 },
  };
}
