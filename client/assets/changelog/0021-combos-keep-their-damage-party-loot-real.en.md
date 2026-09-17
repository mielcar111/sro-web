## Added

- **Right-click to store** — with Storage or the guild vault open, right-click anything in your bag to put it away. Taking things out that way already worked; putting them in was drag-only, and right-clicking a potion at the Storage Keeper drank it instead. While a vault is open, storing now wins the click.
- **A warning when the 3D view dies** — if your graphics card drops the game, the world used to just go blank while everything else carried on, so you could walk into a fight you could not see. You now get a clear message and a Reload button, and auto-hunt stops itself instead of fighting blind.

## Changed

- **Party Item Share actually shares** — items are now handed to the next member in turn when they are picked up, and everyone in range is told who got what. Before this, whoever clicked first kept everything, so the setting did nothing. Turn Item Share off when you want free-for-all.
- **Auto-hunt keeps running in a background tab** — switching to another tab used to stop it dead: your character stood still, stopped drinking potions, and often died. It now keeps hunting and healing while the tab is in the background.

## Fixed

- **Combos lost their damage when you pressed the next skill** — starting a combo and immediately pressing another skill cancelled every strike that had not landed yet, so Soul Spear - Emperor dealt one hit instead of two. The next skill now waits its turn and the combo finishes in full. This affects every combo family: the sword and spear chains, the Soul Spears, Crosswise and Flying Stone Smash, Devil and Demon Cut Blade, Dragon Sore Blade and both Arrow Combos.
- **A 1,000 stack always left one behind** — moving a full stack of wood or stone into Storage or the guild vault moved 999 and stranded a single unit, in both directions. Full stacks now move whole.
- **Two-handed weapons refused to equip over a shield** — switching to a two-handed staff, spear or bow while holding a one-hander and a shield simply did nothing, with no explanation. Both pieces now come off into your bag, and it only fails if your bag is genuinely full — which it now says.
- **A second tooltip covered up item stats** — hovering an item showed its stats, then a small grey box with its name appeared on top and hid the first few lines. That duplicate box is gone.
- **Damage numbers were invisible on tall monsters** — against Yetis, Bone Lords, Kerberos and the like, both the name and your damage sat above the top of the screen at normal zoom, so you never saw a number. The whole label now slides down into view. Ordinary monsters look exactly as before.
- **Monsters that broke off took no damage in silence** — a monster that gave up and ran back to its spawn is invulnerable on the way home, but the game said nothing: your swings played no animation, no numbers appeared, and a skill still spent its mana and cooldown for nothing. It now tells you the monster is returning, and stops chasing it.
- **Characters ran around frozen in a skill pose** — if a monster died while a skill was still loading, the pose stuck and your character slid along in it for a while. The animation now keeps to the skill's own timing and hands the body back to running.
- **Auto-hunt could roam forever while stuck** — a character wedged in scenery kept re-picking a camp and searching with no sign anything was wrong. It now offers the same one-click Return to town that manual walking does.
