# Zombie Smith

A playable prototype of the two-part loop: **make the weapon by hand, then go
and use it.**

Part one is a Jacksmith-style crafting bench where timing, tracking and torque
decide what the weapon actually becomes. Part two is an isometric,
**turn-based** scavenging run where that weapon has to earn its keep against a
street full of the dead.

No engine, no build step, no asset files — vanilla ES modules and a 2D canvas.
Every sprite, tile and sound is generated at runtime.

```bash
npm start          # serve at http://localhost:8080
npm test           # 94 logic tests, including a 40-battle soak
node tools/smoke.mjs --shots ./shots   # headless playthrough + screenshots
```

ES modules will not load from `file://`, so use the server (or any static
server) rather than opening `index.html` directly.

---

## The loop

```
Workshop ──> Deploy ──> Isometric turn-based run ──> Debrief ──> (a day passes) ──> Workshop
   │                          │                          │
   │  forge / press /         │  loot, fight, flee       │  machines run,
   │  chem / mods /           │  or extract              │  wounds mend,
   │  blueprints / roster     │                          │  rations get eaten
```

## Part 1 — the bench

Crafting a weapon runs up to three hands-on stages, and **each stage feeds a
different part of the stat block**. A player who is good with the hammer but
sloppy on the grinder gets a hard-hitting, inaccurate weapon — not a uniformly
mediocre one.

| Stage | Verb | What it decides |
|---|---|---|
| **Shape** | Stop an oscillating marker inside a shrinking band, six or seven times, while the steel cools | Damage and durability |
| **Grind** | Track a moving spark along the edge with the mouse | Accuracy and critical chance |
| **Fit** | Lock a spinning driver inside a shrinking sector, four bolts | AP cost and magazine size |

The **heat gauge** during shaping is the interesting constraint: strike power
falls off as the metal cools, and reheating costs fuel and a limited number of
trips back to the coals. A flawless assembly shaves an action point off every
attack for the life of the weapon; a botched one adds one.

**Stock material** is a real decision, not a price tag — rebar hits harder but
is clumsy and hard to shape true; gun alloy is superb and expensive. Each stock
has a *workability* that widens or narrows every timing window, and a Gunsmith
at the bench widens them further.

Also here: the **ammo press** (six strokes, one batch each, a missed stroke
still burns the materials), the **chem bench** (fill the vial to the line —
overfill wraps past the top and spills), attachments, repair, renaming, and a
blueprint tree.

**Automation** is the floor, not the ceiling: researched machines run one cycle
per night and produce about 60% of what a good hand-press does, so hand work
stays the power fantasy.

## Part 2 — the run

Diablo-style 2:1 isometric, painter's-algorithm depth sorting, fog of war, and
strictly turn-based combat.

- **Action points.** Move one tile per AP; attacks cost what the weapon costs.
  Reload, brace, swap, overwatch and medipack all compete for the same budget.
- **Cover is geometry you can see.** A crate between you and the shooter takes
  20 off their roll, a wall takes 40. Crates block movement but not sight —
  you shoot over them.
- **Every hit chance shows its working.** Hovering a zombie breaks the number
  down into weapon, aim, range, cover, target speed and bracing. A turn-based
  game that hides its maths is a slot machine.
- **Noise is the real enemy.** Gunfire wakes everything within its radius and
  fills the horde meter; at 100% a fresh pack arrives from off-map and the
  threshold gets worse. Melee is quiet. Suppressors are quiet. This is what
  makes the crafted-weapon choice matter tactically.
- **Going down is not dying.** At zero health a survivor bleeds for three
  rounds. A medipack saves them. Nothing else does.
- **Fleeing is a real option.** Two pads: the entry you arrived through (leave
  any time, keep everything you carry) and the extraction pad at the far end
  (bonus cache, 25% more XP). Pushing deeper pays better — containers roll
  richer the further they sit from the entry.

Five zombie archetypes: shamblers, runners, brutes (armoured), spitters
(ranged, mostly ignores cover) and screamers (call the street in the moment
they see you — kill them first, quietly).

## Design questions, answered

The brief left five open; the prototype commits to an answer so it can be
played and argued with.

| Question | This build's answer |
|---|---|
| How much direct control during runs? | **Full tactical control.** No auto-battler — you place every step and every shot. |
| Permadeath? | **Yes, but with a rescue window.** Downed survivors bleed for three rounds and can be stabilised. Dying is permanent and takes their gear with them. |
| How punishing is loss? | **A wipe costs the haul and the dead's equipment.** Falling back costs nothing but the bonus. Injuries cost days, not characters. |
| Tone? | **Tense and dry**, not comedy. Makeshift gear played straight. |
| First playable scope | Six stations, five sites, seven weapon patterns, four classes, twelve perks, sixteen blueprints, a full campaign day cycle. |

## Controls

**Run:** left-click a lit tile to move, left-click a zombie to attack (hover
first for the odds), `1`/`2`/`3` or `Tab` to select, `R` reload, `Q` swap
weapon, `B` brace, `E` overwatch, `F` medipack, `Space` end turn, `X` leave,
`WASD`/arrows pan, wheel zooms, `H` help.

**Workshop:** `F` forge, `A` ammo press, `C` chem bench, `W` armoury,
`R` survivors, `B` blueprints, `Space` head out. `Esc` backs out of anything.

## Layout

```
src/core/     loop, scene stack, input, seeded rng, procedural audio, save, state
src/data/     materials, weapon templates, mods, enemies, classes, perks, research
src/game/     crafting maths, minigame mechanics, loot tables, survivors, machines
src/run/      iso projection, map generation, A*, FOV, combat, zombie AI, renderer
src/scenes/   title, workshop, forge, bench, armoury, roster, research, deploy, run, debrief
src/ui/       theme and immediate-mode widgets
tests/        94 tests; tools/smoke.mjs drives a real browser
```

A few decisions worth knowing about if you extend it:

- **Immediate-mode UI.** `button()` both draws and reports the click, so there
  is no retained widget tree to keep in sync with game state.
- **Scene transitions consume the input that caused them** (`core/loop.js`).
  Without that, one press of Space walks you through three screens, because
  the newly pushed scene sees the same key edge while rendering.
- **Line of sight is canonicalised before tracing.** A raw Bresenham walk is
  not symmetric, which would let a zombie see a survivor who cannot see it
  back.
- **Props only spawn on room interiors**, so a crate can never wall off a
  doorway — map connectivity holds by construction, and there is a test for it.
- **Everything model-side is pure enough to test headlessly.** The soak suite
  plays 40 complete battles per run, driving the same functions the run scene
  does, and asserts invariants after every phase (no negative AP, no stacked
  units, nothing standing inside geometry, no ammo appearing from nowhere).

## Balance

The soak suite doubles as a balance guard rail, since "is this beatable?" is
otherwise unanswerable without hours of play. Two bots run: a reckless one
that walks at the exit and shoots everything, and a careful one that triages
the wounded and retreats when it is losing.

Current numbers (careful bot — and it still never uses cover, braces, or picks
targets intelligently, so a human should do better):

- **Day 1–8:** ~30% wipe rate. Tense, survivable.
- **Day 2 vs day 22:** 1 wipe in 16 versus 11 in 16. The ramp is real.

The test fails if a careful early-game squad starts wiping more than 40% of the
time, so an accidental difficulty regression shows up as a red test.

## What is deliberately not here

Base defence, a story layer, weapon-specific hit reactions, save slots, and
mobile/touch input. The scavenging AI is intentionally simple — zombies sense,
remember a noise, and path at you; they do not flank or coordinate.

## Licence

MIT.
