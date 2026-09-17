## Changed

- **City loading is much faster** — the loading screen now only waits for what's actually around you; the rest of the city keeps streaming in quietly beyond the fog, where you can't see it yet. Entering Constantinople, Hotan, Samarkand, Jangan or Donwhang takes a fraction of the time it used to.
- **Smaller downloads on every trip** — the world data behind each region is now compressed before it reaches you, and your download starts the moment you pick a teleport destination instead of after the screen goes dark. First visits to a city pull several megabytes less.
- **Town arrivals stop waiting on monsters** — teleporting into a safe town no longer holds the loading screen for creature models that only matter out in the field.

## Fixed

- **Long sessions no longer eat memory** — traveling between cities used to make the game hold on to a little more memory with every trip, until multi-hour sessions turned sluggish or crashed the tab. Everything a departed zone no longer needs is properly let go now, so a long trade run ends as smooth as it started.
