## Changed

- **Down attacks hit much harder** — Slash, Double Stab, Cunning Stab, Bash, Charge Swing, Triple Swing, Down Cross, Dual Counter and Deadly Counter now deal their full authored bonus against knocked-down enemies, much closer to the original's down-attack math. On the stab, swing and counter lines the two authored bonuses stack, so a downed enemy takes roughly twice the damage it did before.
- **Attacks land when the server swings** — Slash, Shield Trash, Turn Rising and Maddening damage now counts the moment the skill fires instead of waiting for the animation to connect. Fights feel snappier and kills register sooner.
- **Physical and Magical Fence protect your allies** — the damage a Fence takes off your ally is now transferred to you, the Warrior who cast it; the transferred amounts follow the original's math. Watch your own HP when your ally is under fire.
- **Pain Quota splits pain by the original's numbers** — you keep your rank's share and the rest is divided evenly among party members within range, with the split amounts and sharing range following the original's math.
- **Howling Shout provokes a full pack** — the shout now reaches up to five monsters around you; before, standing in the middle of a pack could waste part of its reach.
- **Warrior stuns respect the level gap** — Sprint Assault, Axis Quiver, Double Twist and Sudden Twist are now less reliable and wear off faster against much higher-level enemies, modeled on the original's level-gap rule. Stuns against enemies near your own level are unchanged.
- **Vital Increase's trade-off recalculated** — its damage penalty now multiplies with other effects instead of adding.
- **Weak hits re-roll instead of hitting a fixed floor** — a hit that lands very low after armor is no longer pinned to a fixed minimum; it re-rolls into a low-damage band modeled on the original's rescue rule, so the smallest hits vary.

## Fixed

- **Buffs no longer survive a weapon swap** — Physical Fence, Magical Fence, Pain Quota and Protect placed on party members now end immediately when the casting Warrior switches away from a sword, two-handed sword or dual axes. Warcry correctly ends unless a two-handed sword stays equipped.
- **Links end with their caster** — if the Warrior who cast a Fence, Pain Quota or Protect dies, the linked buffs on party members end immediately; if the Warrior logs out, they end within a moment. Either way, nothing lingers without an owner.
- **Stolen link slots** — if another Warrior replaced your Fence on an ally, the old caster's connection slot is now freed properly instead of staying blocked.
- **Transferred damage shows cleanly** — damage diverted to you by a Fence or shared by Pain Quota now appears as a damage number without playing a phantom attack swing.
