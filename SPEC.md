# SPEC — Interactive Smith chart (replacement for Smith V3.10)

Phase 0 — functional specification and architecture. Nothing is coded at this stage.
Document drawn up on 2026-11-13 from F. Dellsperger's public documentation and from
chapter 8 of the SysRF course (Hochet & Favrat, 2017). At that date no binary had been downloaded, decompiled
or run. On 2026-11-14 the Smith V3.10 assembly was analysed statically (see § 12); it was never run.

## 1. Sources

| Ref. | Source | Content used |
|---|---|---|
| [S1] | `http://www.fritz.dellsperger.net/smith.html` | Smith V4.1 feature list, demo limits |
| [S2] | *Help Smith V4.1* (PDF, 82 pp., Jan. 2018), same site | Elements, parameters, sweeps, circles, netlist, file formats, version history |
| [S3] | *Readme V4.1* (PDF) | Release notes for 4.0 / 4.1 |
| [S4] | *What's New in V4.0* (PDF) | Tuning Cockpit |
| [S5] | *Examples V4.1* (PDF, 39 pp.) | 18 examples with screenshots (numerical values usable as references) |
| [C]  | SysRF course ch. 8, slides 1–17 | Concepts, test vectors, Smith V3.10 screenshot (slide 17) |

Notes:
- The site no longer publishes documentation specific to V3.10. The history [S2 p. 80] shows that V4.x
  adds only the *Tuning Cockpit* and fixes to V3.10; V3.10 itself had added the sweeps,
  the lossy series line and the ASCII export. **The parity target is therefore V4.1** (a superset of V3.10).
- The site is reachable only over HTTP (invalid HTTPS certificate); accessed as is.
- No instruction addressed to an agent was found in this content. It is used purely as data.

## 2. Discrepancies found in the test vectors (read before validating)

**2.1 Vector 8 — confirmed.** Topology of slide 16 (series C 6.8 pF → shunt C 3.9 pF → series L 15 nH →
shunt C 22 pF → load 92 nH + 2 Ω), at 869 MHz:

| Method | Zin |
|---|---|
| Series/parallel reduction (load → input) | 0.001787 − j157.191387 Ω |
| ABCD cascade (input → load) | 0.001787 − j157.191387 Ω (difference 8.5·10⁻¹⁴) |

Identical to the supplied reference value (0.0018 − j157.19 Ω). No discrepancy.

**2.2 Slide 16 ≠ slide 17 — inconsistency in the course.** The Smith V3.10 screenshot (slide 17) does not start from
92 nH + 2 Ω (i.e. 2 + j502.3 Ω) but from a load **DP1 = (2.000 + j10.000) Ω**, which corresponds to
1.83 nH at 869 MHz. The rest of the network is identical. The values displayed by V3.10 are reproduced
exactly by my independent calculation (two methods):

| Point | Smith V3.10 (slide 17) | Recomputed | Q displayed / recomputed |
|---|---|---|---|
| DP1 | 2.000 + j10.000 | 2.0000 + j10.0000 | 5.000 / 5.000 |
| TP2 (shunt C 22 pF) | 20.365 − j25.382 | 20.3653 − j25.3821 | 1.246 / 1.246 |
| TP3 (series L 15 nH) | 20.365 + j56.519 | 20.3653 + j56.5192 | 2.775 / 2.775 |
| TP4 (shunt C 3.9 pF) | 88.740 − j88.611 | 88.7399 − j88.6107 | 0.999 / 0.999 |
| TP5 (series C 6.8 pF) | 88.740 − j115.544 | 88.7399 − j115.5442 | 1.302 / 1.302 |

"Cursor" panel of the same screenshot, Z = (33.22 − j42.08) Ω: Γ = 0.486 ∠ −84.920°, RL = 6.27 dB,
VSWR = 2.89, Q = 1.27, Y = (11.56 + j14.64) mS — all found again.

Consequence: the "course result" visible on slide 17 (88.74 − j115.54 Ω) does not answer the problem statement of
slide 16 as written. Proposal: **keep vector 8 as is** (statement from slide 16) and **add the
slide 17 chain as vector 9** (it is the only reference produced by V3.10 itself).

**2.3 Vector 7.** f₀ = 868.197 MHz, Q = (1/Rs)·√(L/C) = 1.0001, x_L(f₀) = 0.6001. Consistent.

**2.4 Usable Dellsperger references.** Example 1 of [S5] (10 + j7 Ω, 150 MHz, series C 39.2 pF,
shunt L 26.6 nH → 10 − j20.067 then 50.269 − j0.078 Ω) is reproduced to the 3rd decimal. Examples 4, 9 and
10 are reproduced only to within 1–2 %, because the schematic shows only rounded values (1.9 pF, 0.208 λ):
they will serve as a plausibility check (3 % tolerance), not as 10⁻³ vectors.

## 3. Features found in Smith and decision

Decision: **R** = kept, **A** = kept and improved, **X** = excluded (reason in § 5).

### 3.1 Chart and readout

| Feature found | Source | Dec. | In the tool |
|---|---|---|---|
| Z chart, Y chart, or Z+Y superimposed (switchable planes) | [S2 p. 39], [C 11, 17] | A | + grid with density adapted to the zoom, labels normalized **or** in Ω / mS (as in V3.10) |
| Free normalization Z0 | [S1], [S2 p. 9] | R | Global, 50 Ω by default |
| Cursor window: RL, VSWR, Q, Γ, Y, Z, Z0, frequency | [S2 p. 4], [C 17] | A | + mismatch loss, reflected power, Γ in re/im and magnitude/phase, normalized values, equivalent series and parallel component at f |
| Zoom in / out / 1:1, centered on the chart | [S2 p. 27] | A | Mouse-wheel zoom centered on the pointer, panning, zoom out beyond \|Γ\| = 1 (region r < 0) |
| Points DPn (entered), TPm (transformed), SPp (sweep) | [S2 p. 2] | R | Same nomenclature in the points table |
| Datapoints table: Start, Point, Z, Q, Frequency | [S2 p. 4], [C 17] | A | + Y, Γ, VSWR, RL, selectable columns, CSV copy |
| Colour and line-width settings | [S2 p. 39] | A | Polished light / dark themes rather than per-line settings |

### 3.2 Load (datapoints)

| Feature found | Source | Dec. | In the tool |
|---|---|---|---|
| Mouse entry on the chart, then frequency | [S2 p. 7] | R | Click on the chart in "place the load" mode |
| Keyboard entry: Z, Y or Γ, Cartesian or polar | [S2 p. 7] | A | + S11 (dB/phase), + normalized value, + load described by a series or parallel R-L-C circuit (the slide 16 case) |
| Several datapoints, a single "Start" | [S2 p. 9] | A | Load = fixed value, R-L-C model, or multi-frequency **Z(f) table** |
| Import of S11 / S22 from Touchstone .s1p / .s2p | [S1], [S2 p. 7, 72] | A | MA / DB / RI formats, units Hz…GHz, arbitrary `R`; .s2p with port 2 terminated in a load of choice |
| CITI import | [S2 p. 74] | R | Taken back after the binary analysis (§ 12.2) |
| EZNEC `LastZ.txt` import | [S2 p. 76] | A | Via a generic "f, R, X" CSV import (covers EZNEC) |
| Editing a datapoint (double-click) | [S2 p. 27] | R | In the inspector, or by dragging the point |

### 3.3 Network elements

| Element found | Source | Dec. | In the tool |
|---|---|---|---|
| C, L, R in series | [S2 p. 14–16] | A | + optional finite Q (ESR, or Q at a given frequency) |
| C, L, R in parallel | [S2 p. 14–16] | A | same |
| Series line: Zc, εr_eff, length in λ, electrical (mm), physical (mm) | [S2 p. 17] | A | + degrees, + velocity factor, λ/4 preset |
| Lossy series line, α in dB/m, α(f) = α·√(f/f_DP) | [S2 p. 17] | A | Trajectory drawn even with losses (Smith does not draw it [S2 p. 10]); √f law or constant α |
| Open / short-circuited shunt stub (ideal) | [S2 p. 19–22] | A | + optional losses |
| Ideal transformer, ratio n (impedance n²) | [S2 p. 23] | R | Direction of the ratio shown in the UI (see § 6.4) |
| Parallel R-L-C inserted in series; series R-L-C inserted in parallel | [S2 p. 25–26] | A | + the other two combinations |
| Drawn trajectory (locus), value chosen by clicking on it | [S2 p. 9] | A | Arc end point **draggable** along its locus; value editable from the keyboard |
| Editing after insertion (double-click → dialog → Draw) | [S2 p. 11] | A | In-place editing, immediate update, no modal dialog |
| Tuning Cockpit: ±20 % sliders, "Reset Min/Max" | [S2 p. 12], [S4] | A | Slider on each element, adjustable range, mouse wheel = fine adjustment, keyboard arrows |
| Schematic built from the datapoint, rotation possible | [S2 p. 3], [C 17] | A | SVG schematic; orientation: see question Q4 |
| Limit "do not enter 0" | [S2 p. 11] | A | 0 and ∞ handled explicitly (§ 6.5) |

### 3.4 Tools

| Feature found | Source | Dec. | In the tool |
|---|---|---|---|
| Constant-VSWR circles | [S2 p. 35] | R | Several, labelled |
| Constant-Q loci, Q = \|Im Z\| / Re Z | [S2 p. 31], [C 9] | R | Several, labelled |
| Stability circles (input / output plane) | [S2 p. 36, 58] | R* | "Amplifier" package, see Q2 |
| Constant-gain circles (available, operating, unilateral) | [S2 p. 33, 62] | R* | same |
| Constant noise-figure circles | [S2 p. 37, 71] | R* | same |
| Circles window (visibility, highlighting, details) | [S2 p. 4] | R | List in the inspector |
| Frequency sweep (start, end, number of points) | [S2 p. 28] | A | Linear or log, "increasing f" direction shown by an arrow [C 15], live recomputation during tuning |
| Sweep on the datapoints | [S2 p. 29] | A | Automatic when the load is a Z(f) table |
| Undo / Redo (elements and datapoints only) | [S2 p. 28] | A | On the whole project state, including circles and settings |
| Project save / load (.xmlsc, licensed version) | [S1] | A | JSON, + shareable URL; no licence limit |
| "Touchstone" netlist .ckt (CAP, IND, RES, TLINP, TRF, SRLC, PRLC, DEF2P) | [S2 p. 43] | A | LTspice `.cir` export (requested) **and** `.ckt` in Dellsperger's format |
| ASCII export of datapoints and circles | [S2 p. 44] | R | CSV (separator `;` or `,`) |
| Printing chart / schematic / tables | [S2 p. 41] | A | SVG and PNG export, print stylesheet |
| Copy to clipboard | [S2 p. 42] | R | Chart and schematic (falls back to download if the browser refuses) |
| Shortcuts Ctrl+N/O/S/Z/Y, Ctrl+1/2/3 | [S2 p. 42] | A | Kept when the browser lets them through, + full keyboard navigation |

### 3.5 S-Plot mode

| Feature found | Source | Dec. | In the tool |
|---|---|---|---|
| Plot of S11 / S22 on the chart from a file | [S2 p. 45] | R | Imported trace on the main chart |
| Return-loss graph, linear or log f axis, cursor | [S2 p. 46] | A | \|S11\| (dB), VSWR, phase graphs, linked to the chart |
| MAG / MSG, K, μ table and graph | [S2 p. 46] | R* | "Amplifier" package |
| Polar plot of S12 / S21 | [S2 p. 46] | X | § 5 |
| S → H / Z / Y / A conversion and Touchstone export | [S2 p. 49] | X | § 5 |
| CITI → Touchstone conversion | [S2 p. 51] | X | § 5 |

## 4. Added features

| Addition | Detail |
|---|---|
| Automatic matching | L network (up to 4 solutions), π and T at imposed Q, single stub (open / short, 2 positions), double stub (imposed spacing, forbidden zone flagged), λ/4 transformer (real load, or approach line + λ/4 for a complex load), series line + reactance. Target: Z0 or any impedance (conjugate matching). |
| Solution ranking | By maximum node Q and by actual bandwidth (band where RL ≥ threshold, computed by numerical sweep of the synthesized network), with low-pass / high-pass character and DC pass or block |
| Preferred values | E12 / E24 / E96 rounding per element or global, with resulting Γ, RL and VSWR displayed before / after |
| Multi-band matching | Up to 8 bands; trace per band on the chart, bands on the plots, worst RL / VSWR per band against an RL goal. Optimizer (request of 2026-11-26, feedback from the professor): tunes the elements checked "Optimize" in the user's topology to minimize the worst \|Γ\| over all the bands. Search: Nelder-Mead on a p = 10 norm of \|Γ\|, variables mapped to [0, 1] (log scale for R, L, C, Zc, n), start from the current values + 12 pseudo-random starts with a fixed seed; the candidate with the smallest true maximum is kept. Project: `bands` field { on, rlGoal, list } and `opt` flag per element |
| Linked graphs | Three plots versus f, format chosen per plot (request of 2026-11-26): Log Mag \|S11\| dB, Lin Mag \|Γ\|, phase of Γ, VSWR, return loss, mismatch loss, Re / Im / \|Zin\|, group delay of Γ; formats stored in the settings (`prefs.plots`), not in the project; hovering over a graph = cursor on the chart, and vice versa |
| "Course" mode | Constant r or constant g circle followed by each element, Δx / Δb label as on slides 7, 8, 13, 14; z ↔ y symmetry about the centre (slides 10, 12) |
| Real components | Finite Q on L and C; losses on the stubs |
| Active region | r < 0 drawn outside the disc, flagged "active / unstable" |
| Engineering input | "6.8p", "15n", "869M", "2k2", "0.25λ", "90°", comma or period as decimal separator; wheel and arrows for fine adjustment |
| Project | Full undo / redo, JSON, state encoded in the URL hash |
| Exports | Chart SVG / PNG, schematic as SVG, LTspice `.cir` netlist, `.ckt` netlist, CSV |
| Displayed convention | Permanent banner "construction: load → source" |

## 5. Exclusions and reasons

| Excluded | Reason |
|---|---|
| CITI → Touchstone conversion | Viewer function; CITI **import** is taken back (§ 12.2) |
| S → H / Z / Y / A conversion and re-export, polar plot of S12 / S21 | Functions of an S-parameter viewer, outside the "chart + matching" scope |
| Reading `.xmlsc` / `.smc` projects | Format not publicly documented |
| Dockable windows, remembered positions | Replaced by a fixed, adaptive layout ("clean" constraint) |
| Licence, demo mode (5 elements / 5 points) | Not applicable |
| Touchstone 2.0 (`[Version] 2.0`), files with more than 2 ports | Rare for this use; explicit error message on import |
| Tolerance analysis (Monte Carlo), microstrip models (W/h → Zc, εr_eff) | Not requested; candidates for a later version. The optimizer, first excluded here, is now covered in § 4 (multi-band matching) |
| Complex characteristic impedance of lossy lines | Zc remains real (low-loss approximation, as in Smith); listed in the limitations |

## 6. RF conventions

### 6.1 Definitions
- ω = 2πf; Z_L = jωL; Z_C = 1/(jωC); z = Z/Z0; y = Y·Z0 = 1/z; Γ = (Z − Z0)/(Z + Z0), Z0 real > 0.
- VSWR = (1 + |Γ|)/(1 − |Γ|); RL = −20·log₁₀|Γ| (dB, positive); mismatch loss = −10·log₁₀(1 − |Γ|²).
- Node Q = |X|/R = |B|/G (definition used by the course and by Smith).
- r circle: centre (r/(r+1), 0), radius 1/(r+1). x arc: centre (1, 1/x), radius 1/|x|. Y chart: image under Γ → −Γ.
- Constant-Q locus: circular arcs with centre (0, ±1/Q), radius √(1 + 1/Q²), passing through Γ = ±1.

### 6.2 Construction direction
The network is built **from the load towards the source**. Element no. 1 is the one touching the load; Zin is
seen from the source after the last element. Series: z → z + Δz (movement along an r circle). Parallel:
y → y + Δy (movement along a g circle).

### 6.3 Lines
- Zin = Zc·(Z + Zc·tanh γl)/(Zc + Z·tanh γl), γ = α + jβ, β = 2π·f·√εr_eff / c.
- The electrical length (degrees or fraction of λ) is defined **at the design frequency f₀**; the physical
  length l = (θ/360°)·c/(f₀·√εr_eff) is fixed during a sweep. "Electrical length in mm" in Smith's sense
  = l·√εr_eff. Velocity factor v_r = 1/√εr_eff.
- Losses: α in dB/m of physical length, α[Np/m] = α[dB/m]/8.686; by default α(f) = α·√(f/f₀).
- Open stub: Y = tanh(γl)/Zc (lossless: j·tan βl / Zc). Short-circuited stub: Y = coth(γl)/Zc.

### 6.4 Other elements
- Ideal transformer of ratio n: Zin = n²·Z (n = turns on the source side / turns on the load side). Smith's
  documentation says only "impedance ratio is n²"; this direction is my choice, shown in the UI.
- Finite Q: L with series ESR = ω_ref·L/Q; C with series ESR = 1/(ω_ref·C·Q). The ESR is constant over frequency.
- Load during a sweep: fixed (Smith's behaviour), R-L-C model, or Z(f) table interpolated
  linearly on Γ, without extrapolation.

### 6.5 Edge cases
The engine propagates a homogeneous pair (V, I) instead of Z: short circuit = (0, 1), open circuit = (1, 0),
no division before display.

| Case | Handling |
|---|---|
| z = 0, z = ∞ | Represented exactly; Γ = −1 / +1; 1/z displayed "∞" without NaN |
| \|Γ\| = 1 | VSWR = ∞, mismatch loss = ∞, Q = ∞ |
| \|Γ\| > 1 (r < 0) | Point outside the disc, label "active / unstable"; VSWR undefined ("—"), negative RL displayed |
| f = 0 | Series L = short circuit, series C = open circuit, shunt L = short circuit, shunt C = no effect; line of zero electrical length |
| Zero or infinite element value | Accepted (transparent or blocking element), never an exception |
| Z + Z0 = 0 | Γ infinite: point not plotted, flagged |
| λ/4 stub, tan βl → ∞ | Goes through the homogeneous form: exact short circuit / open circuit |

## 7. Test plan (`tests.mjs`)

Relative tolerance 10⁻³ unless stated otherwise. `tests.mjs` **extracts the `<script id="smith-core">` block from `index.html`**
and evaluates it with `node:vm`: the tested code is exactly the shipped code, with no copy to keep in sync.

| Group | Checks |
|---|---|
| Course vectors 1–8 | As provided |
| Vector 9 (new) | Slide 17 chain: 5 points, 5 Q values, cursor readout (Γ, RL, VSWR, Q, Y) |
| Vector 10 (new) | Dellsperger example 1 (10 + j7 Ω, 150 MHz) |
| Plausibility (3 %) | Dellsperger examples 4, 9, 10 |
| Independent path | Each network evaluated by the (V, I) engine **and** by closed-form series/parallel reduction |
| Lines | λ/2 = identity; λ/4 = Zc²/Z; \|Γ\| preserved if Zc = Z0; long lossy line → Zc; tanh form vs ABCD matrix |
| Stubs | Short λ/4 = open circuit; open λ/4 = short circuit; open λ/8 = −jZc |
| Geometry | Points of the r, x, g, b, Q, VSWR circles checked by back-conversion z(Γ) |
| S ↔ Z | Round trip; Γin of a loaded .s2p: formula S11 + S12·S21·ΓL/(1 − S22·ΓL) vs ABCD conversion |
| Matching | Each solution fed back into the forward engine: \|Γ\| < 10⁻⁶; π / T: node Q = requested Q; number of L solutions according to the load region; double-stub forbidden zone |
| E series | Reference E12 / E24 tables, E96 by formula; rounding to nearest on a log scale |
| Inputs / outputs | Engineering notation; Touchstone MA / DB / RI; JSON and URL hash round trip; `.cir` / `.ckt` netlists re-read by a mini-parser and Zin recomputed |
| Edge cases | Table of § 6.5, no NaN |
| Amplifier (if Q2 = yes) | Dellsperger example 13: BFG33G at 2 GHz, K = 1.17, Gmax = 12.94 dB, Γ₂ and Z₂ for Zs = 50 + j30 Ω (signs of the imaginary parts to be re-read on the PDF page, lost in text extraction) |

What the tests do not cover: rendering and interaction (validated by screenshots in phases 2 to 5) and
actual execution of the netlist in LTspice (not available here).

## 8. Architecture of `index.html`

```
index.html
├─ <style>                 theme tokens (light / dark), layout grid, print
├─ <body>                  toolbar · schematic · SVG chart · inspector · graphs
├─ <script id="smith-core">   NO DOM access — extracted as is by tests.mjs
│   § complex      complex numbers, homogeneous pair (V, I)
│   § rf-math      Γ ↔ z ↔ y, VSWR, RL, Q, lines, stubs, circles (r, x, g, b, Q, VSWR,
│                  stability, gain, noise), E series, engineering notation
│   § network      project model, load → source evaluation, trajectories, sweep,
│                  synthesis (L, π, T, stubs, λ/4), ranking
│   § io (pure)    Touchstone, CSV, JSON, URL hash, .cir / .ckt netlists
│   → exposes a single global object `SmithCore`
└─ <script id="smith-app">
    § chart-render grid and plot geometry (adaptive) → SVG strings (pure functions),
                   Γ ↔ screen frame, zoom / pan
    § ui           state, undo / redo, schematic, inspector, points table, graphs, keyboard, wheel
    § io (DOM)     file opening / download, clipboard, PNG export
```

Layout:

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Project · Z0 · f₀ · Z|Y|Z+Y · Sweep · Matching · Course · Theme · Export │
├──────────────────────────────────────────────────────┬───────────────────┤
│ Schematic (load → source)  [+ series ▾][+ parallel ▾]│ Inspector         │
├──────────────────────────────────────────────────────┤  · chosen element │
│                                                      │  · cursor         │
│                  Chart (SVG)                         │  · DP / TP points │
│                                                      │  · circles        │
├──────────────────────────────────────────────────────┤  · solutions      │
│ |S11| dB · VSWR · phase   (collapsible)              │                   │
└──────────────────────────────────────────────────────┴───────────────────┘
```

Technical choices:
- **State**: a serializable `project` object (Z0, f₀, load, ordered list of elements, sweep, circles, view).
  Every modification produces a new state; undo / redo via a snapshot stack, continuous adjustments
  (wheel, slider, drag) being grouped into a single entry.
- **Rendering**: SVG only. The grid is recomputed on zoom change (a few hundred arcs);
  during tuning, only the trajectories and the sweep trace are redrawn.
- **Trajectories**: each element is sampled from 0 to its value (also valid for lossy lines and
  finite-Q components, which do not follow a circle exactly). In course mode, the exact r or g circle
  is superimposed.
- **Offline**: no external resources, system fonts.
- **Language**: UI available in English, French, German, Italian and Spanish (English is the source language; the browser language is detected, with a selector in the top bar). Code, documentation and commits in English (see Q3).

## 9. Phases

| Phase | Content | Exit criterion |
|---|---|---|
| 1 | `smith-core` (complex, rf-math, forward network) + `tests.mjs` | Vectors 1–10, lines, stubs, edge cases green |
| 2 | Chart rendering: Z / Y grids, circles, trajectories, zoom | Screenshots: slides 6, 7, 8, 13, 14 reproduced |
| 3 | Network editor, inspector, tuning, sweep, graphs, undo / redo | Slide 17 redone with mouse and keyboard |
| 4 | Matching, E series, Touchstone, exports, URL hash, course mode | Synthesis and I/O tests green |
| 4b | Amplifier package (if Q2 = yes): K, μ, MAG / MSG, stability, gain, noise circles | Dellsperger example 13 reproduced |
| 5 | Review: tests, slide 16 end to end in the UI, README, limitations | Deliverables complete |

One commit per phase (conventional commits, in English).

## 10. Questions to settle

| # | Question | Recommendation |
|---|---|---|
| Q1 | Slide 16 / 17: keep vector 8 and add the slide 17 chain as vector 9? | Yes |
| Q2 | Include the amplifier package (stability, gain, noise circles, K / μ / MAG / MSG)? Present in V3.10, absent from your list, outside chapter 8. | Yes, in a separate phase 4b, after matching |
| Q3 | UI language | Multilingual (en, fr, de, it, es), English source, French being the course language |
| Q4 | Schematic orientation: source on the left and load on the right (slide 16), or load on the left (Smith V3.10)? | Slide 16 by default, toggle to the V3.10 style |
| Q5 | Parity target V4.1 rather than V3.10 | Yes (superset) |

## 11. Implementation status (added at the end of the project)

Answers to the § 10 questions: Q1 to Q5 validated as recommended. The amplifier package is delivered.

Deviations from this document:

| Topic | Planned | Delivered |
|---|---|---|
| Colours | Distinct Z and Y | Only three hues (Z red, Y blue, sweep green), validated for colour-blindness; trajectories, circles and selection in ink, distinguished by stroke style and a label |
| Code blocks | `smith-core` and `smith-app` | A third block with no page access, `smith-chart` (SVG geometry), also tested under Node |
| Matching families | L, π, T, stubs, λ/4, line + reactance | The same, plus the single series line of computed impedance |
| Dragging a long line | not specified | The search stays within half a wavelength of the current length, so that a line of several λ keeps its turns |
| Shortcuts | Ctrl+N/O/S, Ctrl+1/2/3 | Ctrl+S and Ctrl+O; zoom is done with `+`, `−`, `0` (Ctrl+N and Ctrl+1/2/3 are reserved by browsers) |
| Clipboard | chart and schematic | chart only; the schematic is exported as SVG |
| Printing | stylesheet | present, not verified on paper |
| Points table | selectable columns | fixed columns (Z, Q); the CSV export contains all quantities |
| Slide examples | preloaded in an "Example" menu | removed on 2026-11-15 at the user's request: the tool starts on an empty project, with a "New project" button. The slide vectors stay in `tests.mjs` |
| Tuning slider | ± 20 % around the value | "Whole locus" range by default, from the zero value to the infinite value |
| Colors and line widths | excluded in favour of themes (§ 3.1) | taken back on 2026-11-15 at the user's request: "Settings" panel (default Z0 and frequency, colors, line widths, default slider range and E series), stored on this computer. The three-hue palette stays the starting one |
| Vertical schematic | not taken (§ 12.2) | taken on 2026-11-15: "Vertical schematic" checkbox in the settings |
| Menus | toolbar and panels only | menu bar (File, Edit, View, Options, Help) added on 2026-11-15 at the user's request, with built-in documentation and an "About" window naming the author. No "Window" menu (single window) |
| Dashes | em dash for a missing value | plain hyphen everywhere, at the user's request |
| Extended chart | Smith's "Expanded" option, not described in its help (`Help V3.10.chm`, read on 2026-11-15: no mention) | "Extended chart" checkbox: view up to |Γ| = 2 and grid of the r < 0 region. This is my interpretation of the option, not a verified reproduction of Smith |

The limitations are listed in `README.md`.

## 12. Static analysis of Smith V3.10 (2026-11-14)

Tool: REA 6.7.0 (`inspect-managed-artifact`, `inspect-managed-members`) on `Smith V3.10.exe`
(.NET 2.0, not obfuscated, 116 types, 1931 methods, 1534 strings). The binary was neither loaded nor run.
REA gives names, fields, strings, numeric constants and the call graph, **not decompiled code**: the
formulas were not read instruction by instruction. No code was copied.
The help file `Help V3.10.chm` was not read. No instruction addressed to an agent was found.

### 12.1 What the binary confirms, completes or contradicts

| Topic | Finding | Evidence |
|---|---|---|
| Tuning Cockpit | Absent from V3.10, as § 1 says | no matching class or string |
| Elements | The 12 elements of § 3.3, no more and no less | `CActualPart`, "Insert …" toolbar |
| `.xmlsc` projects | XML serialization of `CSmithChartDesign` (points, elements, Q, VSWR, stability, noise, gain, sweep). **Contradicts § 5** ("undocumented format") | `CFile.ReadData` |
| `.smc` projects | Old text format with `[DATAPOINTS]`, `[ELEMENTS]`… sections | `CFile.ReadData` |
| Shortcut | Ctrl+M toggles Smith Chart / S-Plot (missing from § 3.4) | `FormMain.Form1_KeyDown` |
| Default values | f = 500 MHz, Z0 = 50 Ω, εr = 1, line 50 Ω and 0.25 λ | `Smith V3.10.exe.config`, `FrmLineImpedance` |
| Zoom | Step of ×2, between 0.125 and 8 | `FormMain.btnZoomIn_Click`, `btnZoomOut_Click` |
| Entry | Negative real part, \|Γ\| > 1 and f = 0 are refused | messages of `FrmDataPoint` |
| Speed of light | 299 800 000 m/s in the calculation, 300 000 000 in the datapoint sweep, 299 792 458 in the edit dialog, the schematic and the netlist | constants of `CGlobalFunctions`, `FrmEditElement`, `FormMain.menuItemSaveNetlist_Click` |
| Losses | 8.686 dB/Np, √(f/f_DP) law | `CGlobalFunctions.RecalculateCircuit` |
| Precision | S parameters of the gain and stability circles stored in single precision | `r4` fields of `Gain` and `Stability` |
| Stubs | Lossless (`A=0 F=0` in the netlist) | `FormMain.menuItemSaveNetlist_Click` |
| Transformer | Label `1:n`, netlist `TRF … R1=0 N=`; **direction of the ratio still undetermined** | `FrmSchematic`, netlist |

Decision: the tool keeps c = 299 792 458 m/s and the exact dB ↔ Np conversion. The difference with Smith
only affects line losses, to within 0.003 %.

### 12.2 Differences found and what was done

| Smith V3.10 function | Evidence | Outcome |
|---|---|---|
| Gain table per frequency (MAG, MSG, K, μ) and its plots | `FrmGainTable`, `FrmGainGraphs` | **Taken**: table and plots in the amplifier panel, for the imported `.s2p` |
| S11 and S22 return-loss plot | `FrmReturnLossGraph` | **Taken**, same panel |
| ASCII export of the circles | `frmExportSelect` | **Taken**: "Circles CSV" (centre and radius in the Γ plane) |
| Q = 0.2 … 10 and VSWR = 1.2 … 10 check boxes | `FrmCircles` | **Taken**: preset buttons |
| DP, TP and circle labels can be switched on and off | `CSettings` | **Taken** |
| Drag and drop of a file | `FrmSmithChart.frmSmithChart_DragDrop` | **Taken** |
| Reading `.xmlsc` projects | `CFile.ReadData` | **Dropped** on 2026-11-14: the demo version does not save a project, so there is no sample file to fix the type codes (not visible in the metadata). To be taken back only if a real `.xmlsc` is provided |
| CITI import with noise parameters | `CFile.ReadCITIFile` | **Taken**: `io.parseCiti` (S[i,j], PortZ[1], Sopt, Rn, NFmin). Smith's examples `BFG33G.cti` and `BFG33_591Pt.cti` read back identically to the manufacturer `.s2p`. CITI → Touchstone conversion stays excluded |
| Several datapoints, sweep on datapoints | `CDatapoint`, `CalculateCircuitDatapointSweep` | Covered differently by the Z(f) table load |
| Vertical schematic, custom labels | `FrmSettings` | Vertical schematic taken on 2026-11-15 (§ 11); custom labels not taken |
| Polar S12 / S21 plot, S → H / Z / Y / A conversion, `.smc` format, recent files, dockable windows | `FrmS12`, `FrmS21`, `FormMain` | Excluded (§ 5) |
