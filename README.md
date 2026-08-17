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
npm test           # 210 logic tests, including a 40-battle soak
node tools/smoke.mjs --shots ./shots   # headless playthrough + screenshots
node tools/build-single.mjs            # one self-contained HTML file
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

## The two clocks

The day is split in half, and each half runs against a five-minute budget shown
as a bar across the very top of the screen.

| Phase | Bar | Budget | Spent |
|---|---|---|---|
| Preparation — workshop, every station, Head Out | *WE ARE LOSING DAYLIGHT* | 5:00 | in real time |
| The run | *NIGHTFALL IS COMING* | 5:00 **+ whatever daylight you did not spend** | **by the round** |

Both run green through yellow and orange to red, and the spent part of the strip
carries a dimmed version of the same colour — so at the end the whole bar reads
red rather than reading empty. They never appear together, so they share one
ramp: one bar to learn, not two.

**Only the daylight clock runs in real time.** Its stages are dexterity
minigames, so dithering at the bench should cost something. The run is
turn-based, and a wall-clock timer over a turn-based fight punishes thinking —
the one thing turn-based combat exists to allow. So the night is a *deposit drawn
against by actions*: every survivor still with the squad burns **5 seconds per
round**. Deliberating is free; acting is not.

The unit is person-time rather than elapsed time — each body moving through a
dark building forces lockers, checks corners and covers the others, and the squad
only moves as fast as its slowest member. That makes squad size a real decision
at the door: three guns burn the night half again as fast as two, and the bar
prices the next round for you (`28 ROUNDS LEFT AT 15s/ROUND`).

Five seconds rather than ten, because it was measured against the soak suite: a
run takes 13–25 rounds, median 21, occasionally the full 40. At ten a three-hander
would get ten rounds and the night would expire before most runs reached an exit.
At five the base night covers 20 rounds — and a preparation that banks the whole
five minutes buys exactly 40, the longest a run can be.

**One clock for the whole preparation phase**, not one per station, is the point:
time at the forge is time not spent at the chem bench, so getting ready becomes a
set of choices about what is worth doing today. Whatever is left is banked at the
door (`bankDaylight`) and handed straight back as night — a fast preparation
literally buys more of the run. The nightfall bar carries a tick showing where
the earned time ends, and the fill crosses it at the moment the bonus is spent.

Running either clock out costs nothing yet. The daylight one is a reward for
moving fast rather than a penalty for thinking, and what happens when the night
expires is still to be designed — the plumbing is in place (`nightLeft`,
`nightSpan`, `nightBonus` on the campaign state) so the consequence can be added
without unpicking anything.

## Part 1 — the bench

Crafting a weapon runs up to three hands-on stages, and **each stage feeds a
different part of the stat block**. A player who is good with the hammer but
sloppy on the grinder gets a hard-hitting, inaccurate weapon — not a uniformly
mediocre one.

| Stage | Verb | What it decides |
|---|---|---|
| **Shape** | Choose which zone each blow lands in, then stop an oscillating marker inside a band, while the steel cools | Damage, accuracy and durability, weighted by where you struck |
| **Grind** | Track a moving spark along the edge with the mouse | Accuracy and critical chance |
| **Fit** | Lock a spinning driver inside a shrinking sector, four bolts | AP cost and magazine size |

Shaping is **allocation as well as execution**. Every blow goes into the
**edge** (damage), the **core** (accuracy) or the **haft** (durability), and
the share of your work in each zone tilts that stat by roughly ±30%. Spread
six blows evenly for a balanced weapon, or commit to one zone and accept that
the other two suffer. Timing decides how *well* it is made; allocation decides
*what it is*.

The **heat gauge** during shaping is the interesting constraint: strike power
falls off as the metal cools, and reheating costs fuel and a limited number of
trips back to the coals. A flawless assembly shaves an action point off every
attack for the life of the weapon; a botched one adds one.

**Stock material** is a real decision, not a price tag — rebar hits harder but
is clumsy and hard to shape true; gun alloy is superb and expensive. Each stock
has a *workability* that widens or narrows every timing window, and a Gunsmith
at the bench widens them further.

Also here: the **ammo press** (six strokes, one batch each, a missed stroke
still burns the materials), the **chem bench**, attachments, repair, renaming,
and a blueprint tree.

The **chem bench** is its own three-stage craft, and deliberately shares no
verb with the forge:

| Stage | Verb | Demand |
|---|---|---|
| **Chop** | The blade tracks your mouse along a board; click on each guide mark. The strip splits where the blade actually landed, so the pieces come out as uneven as your aim | Aim |
| **Pour** | The cursor *becomes* the beaker. Hold the left button and it pivots; liquid leaves it when the surface clears the lip, so the angle you need climbs as it empties | Metering |
| **Cook** | Hold the burner to climb, release to coast, keep the needle in the simmer band — and once it has simmered, keep it there | Regulation |

Each beaker holds a fixed supply, more than the recipe wants. You can top a
measure up but never take any back, so over- and under-pouring are both real
failures — and pouring while the lip is not over the flask puts it on the
bench, which is penalised on top of leaving you short.

**Every ingredient has a minimum**, marked in red on the gauge. Fall below it and
there is no medicine in the flask at all, however well the rest of the batch
goes. It sits exactly where the measure stops being worth anything, so the rule
reads as one thing rather than two, and it is deliberately one-sided: too little
of an active ingredient and the medicine does not work, while too much is waste
but still medicine. Along with scorching the flask, that is the second way to
lose a batch outright — and both name themselves on the report rather than
blaming the burner for everything.

Everything the player meters by is a **volume in millilitres** — a 51 ml mark,
53 ml in the flask, 2 ml over, 81 ml still in the beaker. Percentages are for
grades, not for measurements.

**Pouring is governed by the lip, not by a threshold.** The liquid surface stays
level with the bench while the vessel rotates about your hand, and liquid only
leaves when that surface clears the lip:

```
tan(angle needed) = (height / width) × (1 − fill) / fill
```

which falls out of `surface(a) < lip(a)`. A brim-full beaker tips out at 15°; by
the time enough has gone to reach a 50 ml mark it needs better than 70°. So
*keeping* a stream running means turning your wrist further and further, and the
flow follows the head over the lip — easing in, fading out, and stopping of its
own accord when the surface drops back. One set of functions
(`surfaceAt`/`lipAt`/`headAt`) serves the simulation, the projection and the
renderer, so the drawn liquid is always at the lip when the stream is running.
That was the bug this replaced: pouring began at a fixed tilt, and a quarter-full
beaker poured at an angle where the liquid was visibly nowhere near the lip.

Because the vessel dribbles for a second after release, the bench shows a
**projected landing mark** — where the measure ends up if you let go this
instant — and the readout tracks that, not the level already in the flask.
Aiming at it turns the stage from reacting to a number into anticipating one.
Around the mark sits a band that simply counts as right: without one, hitting an
analog target to the unit meant releasing inside a three-millisecond window, and
a flawless pour still read 97%.

A cut is judged against the nearest mark still standing, which used to make one
slip catastrophic: the miss consumed a mark the player was not aiming at, so
every cut after it was scored against the wrong one and the whole board
cascaded — a single bad swing took a board from 80% to 38%. The bench now names
the mark the next cut will be judged against (**NEXT CUT**, with the clean core
picked out inside the tolerance), so the mis-resolution cannot be walked into
blind. Credit also decays past the tolerance rather than dropping to zero at its
edge, so a near miss costs most of a piece instead of all of it and only a
genuinely wild swing writes one off. One bad cut in five now leaves the board at
85%.

The trail is the difficulty, and it is tuned by measurement rather than feel.
The wrist comes back slowly while liquid is still running, so a release commits
about 19 ml against a 4 ml clean band — watching the flask and releasing on the
number cannot work, and a test asserts that relationship. The spread of hold
times scoring a clean measure is pinned between 90 and 260ms: wider and the
measurement is a shrug, narrower and the stage is the unwinnable one it started
out as. A fuller beaker trails for longer than a nearly-empty one, because the
trail ends when the surface falls back below the lip rather than on a timer.
Anything you miss the flask with lands on the bench as a puddle that grows,
merges with its neighbours and **stays there** for the rest of the batch, sized
purely by volume so a stray fraction of a millilitre is a spot rather than a
spill.

Below a third of full flow the stream **breaks into drops** — shed at the lip,
falling under their own gravity, keeping their position rather than following the
cursor. That is how the tail of every pour ends, and it is also what stopped an
all-but-empty beaker drawing a permanent hairline down the screen: emptying is
asymptotic, so the flow never quite reached zero. A few tenths of a millilitre
now cling to the glass and will not come out, which is both true and tidier.

Cooking has two ways to spoil rather than one. Above the band it scorches, which
is still the only total loss. Below it — *once it has been up to temperature at
least once* — it goes **dull**, faster the further it falls. Reaching the simmer
is not the achievement; staying there is. A dull batch is weak but never worth
nothing, and coming up to heat the first time costs nothing at all.

**Automation** is the floor, not the ceiling: researched machines run one cycle
per night and produce about 60% of what a good hand-press does, so hand work
stays the power fantasy.

## Part 2 — the run

Diablo-style 2:1 isometric, painter's-algorithm depth sorting, fog of war, and
strictly turn-based combat.

- **Semi-automatic scavenging.** Press `V` and the squad handles itself: it
  walks, opens what it finds, reloads, and heads for extraction. It stops dead
  the instant anything happens you would want a say in — a zombie comes into
  view, someone takes a hit, a survivor goes down, or the horde meter fills —
  and any click or key takes the wheel back. Nothing is resolved off-screen:
  the autopilot only issues the same orders you could, and the fight itself is
  always yours.
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
| How much direct control during runs? | **Semi-automatic, with the fight always yours.** The squad walks and loots on its own and hands back control the moment anything happens. Combat is never resolved for you. |
| Permadeath? | **Yes, but with a rescue window.** Downed survivors bleed for three rounds and can be stabilised. Dying is permanent and takes their gear with them. |
| How punishing is loss? | **A wipe costs the haul and the dead's equipment.** Falling back costs nothing but the bonus. Injuries cost days, not characters. |
| Tone? | **Tense and dry**, not comedy. Makeshift gear played straight. |
| First playable scope | Six stations, five sites, seven weapon patterns, four classes, twelve perks, sixteen blueprints, a full campaign day cycle. |

## Art direction

There are no image files, so the art style is a set of rules in
`src/ui/palette.js` rather than a folder of sprites. Four commitments, and the
first three are enforced by tests because "does this look intentional?" is
otherwise a matter of opinion.

**Sodium and steel.** A cold blue-biased ramp for everything dead, warm sodium
and ember for the few things still burning — the squad's lamps, the forge, a
muzzle flash. Nothing picks a colour on its own; every world colour is derived
from that opposition.

**One light, committed.** Light comes from screen upper-left (grid `-x`). That
single decision drives which wall face is bright, which is dim, and which way
shadows fall. Solid geometry casts a directional shadow onto the tiles behind
it, so a wall reads as a wall and not a differently-coloured floor tile.

**Five sites, five palettes.** Each site biases the shared ramp toward its own
hue: blue steel at the transit depot, institutional green at the clinic, ochre
dust in the warehouse, mauve in the suburb, rust in the garage. Surfaces are
marked by material too — asphalt patches, tile grout, concrete grit, oil.

The bias values are deliberately strong. Measured at subtler settings all five
floors landed within 6 RGB units of each other, which is five sites that all
look the same; and wall tops came out byte-identical, so the geometry belonged
to no location at all. A test now asserts every pair of floors differs
measurably, that they stay dark enough to hold the tone, and that walls read
lighter than the floor they stand on.

**Silhouette over detail.** At this zoom a face is four pixels, so the archetypes
are told apart by proportion: shamblers lopsided, runners lean and forward,
brutes wide and plated, spitters swollen, screamers thin with a head thrown
back. Faces only draw while a walker is actually calling — the one moment the
detail carries information. Over the top, a tiled film grain jumped by whole
pixels each frame, for a printed, grubby feel without shimmer.

## Controls

**Run:** `V` hands over to semi-auto (any input takes it back), left-click a
lit tile to move, left-click a zombie to attack (hover first for the odds),
`1`/`2`/`3` or `Tab` to select, `R` reload, `Q` swap weapon, `B` brace,
`E` overwatch, `F` medipack, `Space` end turn, `X` leave, `WASD`/arrows pan,
wheel zooms, `H` help.

**Forge, shape stage:** `1`/`2`/`3` (or click a zone card) choose where the
next blow lands, `Space` strikes, `R` reheats.

**Chem bench:** click each mark to chop, then `Space` or click to leave the
finished board; hold the left button to tip the beaker and release to stop,
`Space` or right click sets it down; hold the left button or `Space` to work the
burner. Every stage prints its own bindings along the bottom of the screen.

**Workshop:** `F` forge, `A` ammo press, `C` chem bench, `W` armoury,
`R` survivors, `B` blueprints, `Space` head out. `Esc` backs out of anything.

## Layout

```
src/core/     loop, scene stack, input, seeded rng, procedural audio, save, state
src/data/     materials, weapon templates, mods, enemies, classes, perks, research
src/game/     crafting maths, minigame mechanics, chem bench physics, phase clocks,
              loot tables, survivors, machines
src/run/      iso projection, map generation, A*, FOV, combat, zombie AI,
              semi-auto scavenging, renderer
src/scenes/   title, workshop, forge, bench, armoury, roster, research, deploy, run, debrief
src/ui/       palette and light rules, phase-clock bars, theme, widgets
tests/        210 tests; tools/smoke.mjs drives a real browser
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
- **World colour comes from `ui/palette.js` and nowhere else.** Map generation
  used to carry colour fields; it now describes gameplay only. If you find
  yourself typing a hex literal in a renderer, derive it from the site palette
  instead, or the sites drift back into looking like each other.
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

- **Day 1–8:** ~20% wipe rate. Tense, survivable.
- **Day 2 vs day 22:** 0 wipes in 16 versus 12 in 16. The ramp is real.

The test fails if a careful early-game squad starts wiping more than 40% of the
time, so an accidental difficulty regression shows up as a red test.

### What measurement changed

Two problems only showed up once they were measured, and both are now guarded
by tests:

| | Before | After |
|---|---|---|
| Tiles that can reach crate cover in two moves | 30% | **78%** |
| Median walk from entry to extraction (day 10) | 34 tiles | **21 tiles** |

Cover was decorative: props were 4% of walkable area, so combat was two lines
trading shots in the open. Extraction was placed at the *furthest* room by
construction, which maximised the walk by definition — every run opened with
seven to ten rounds of nothing happening.

## What is deliberately not here

Base defence, a story layer, weapon-specific hit reactions, save slots, and
mobile/touch input. The zombie AI is intentionally simple — they sense,
remember a noise, and path at you; they do not flank or coordinate, and they
do not use doorways as chokepoints, so map geometry shapes the fight less than
it could. Colour is still doing too much work on its own in the hit-chance and
health readouts, which is an accessibility gap rather than a style choice.

## Licence

MIT.
