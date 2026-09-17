## Changed

- **Imbue damage now matches the original game** — the extra damage from a
  fire, cold or lightning imbue is counted through each skill's own multiplier
  only, the way the original does it, instead of being added in full and then
  multiplied on top. Imbued hits deal less than before; multi-arrow bow combos
  are affected the most.
- **Gold cap raised** — a character can now carry up to 999,999,999,999 gold.
  Picking up gold or selling to a shop that would push you past the cap is
  refused with a clear message, and storage and Guild Vault withdrawals name
  the cap instead of failing silently.
- **Speed buffs: the strongest one wins** — casting Grass Walk while a speed
  scroll is active no longer slows you down to the weaker buff. The faster
  speed always applies, in any order and after relogging.
- **Escape closes windows first** — pressing Esc while running closes the
  topmost window before it stops your run.
- **Memory figures in bug reports** — bug reports now carry the client's memory
  numbers, which helps us track down crashes after very long sessions.

## Fixed

- **Camera stuck turning** — the camera no longer keeps rotating after you let
  go of the right mouse button while the left one is held, or when the release
  happens outside the game window.
- **Could not invite anyone to a party** — "Invite to Party" on a selected
  player now creates your party first when you are solo, the Party Match board
  offers a Create party button when you have none, and invite prompts no
  longer vanish instantly on PCs whose clock runs ahead of the server.
- **Trade window remembered old gold** — after a cancelled trade the gold box
  no longer shows an amount the other side never saw, and one click on
  Approve is enough after typing a gold amount.
- **Macro froze inside Fire Wall and Ice Wall** — the Macro keeps attacking
  targets within reach while you are walled in, instead of standing idle.
- **Whole Therapy had no visual** — the Force healing skill now shows its
  ground circle for the whole duration of the buff.
- **Giant monsters' hit effects** — impacts from Giant monsters landing on you
  are no longer drawn at the giant's size.
- **Spamming skill keys** — mashing a skill no longer cuts its animation short
  or ends in a "too many requests" disconnect; extra presses are simply
  absorbed.
- **Ishade, Hashade and Ultra Blood Devil erased your debuffs** — these
  stationary monsters no longer reset themselves and clear every debuff,
  poison and Fear whenever they picked their short-range attack.
- **Party members looked half dead under Life Turnover** — party cards and the
  target frame now use the caster's real maximum HP.
- **Knocked out of your own wall** — you can no longer be knocked back out of
  your Fire Wall or Ice Wall into a spot you could not walk back from.
- **Flying Dragon flew backwards** — the thrown spear now flies toward the
  target even at point-blank range.
- **Long sessions in a background tab** — effects fired while the game tab is
  hidden are no longer kept alive until you come back, which reduces memory
  growth during long unattended hunts.
