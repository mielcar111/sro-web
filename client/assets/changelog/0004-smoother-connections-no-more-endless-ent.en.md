## Added

- **Macro speed item** — the Macro window has a new Speed item slot. Drop a Scroll of Movement in it and the macro drinks a fresh one whenever the speed buff runs out, so your hunter keeps sprinting between camps. If you run out of scrolls, the macro tells you once and keeps hunting.

## Changed

- **Clearer "busy" messages** — instead of the vague "Busy — try again in a moment", the game now tells you what is actually stopping you: "You are stunned", "You are knocked down", "You cannot act — you are incapacitated", or "Not while the return scroll is channeling."
- **Knockdown feels honest** — while your character is on the ground, potions and attacks pause instead of spamming failed attempts, and everything resumes the moment you stand up.

## Fixed

- **Endless "Entered Hotan" loop** — after a brief connection hiccup, the game could get stuck reconnecting every half minute: the screen kept flashing black with an "Entered …" message, breaking combat and stalls until you relogged. One hiccup now reconnects once and stays connected.
- **Character stuck doing nothing in a fight** — queuing a skill that could never start (for example a short-range skill while a longer-range one kept firing) froze all attacking until you died. A queued skill that cannot start now cancels itself after a few seconds and your regular attacks resume; clicking the ground or stopping the attack also clears it.
