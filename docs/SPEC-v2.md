# Nak Muay Trainer — Technical Specification v2.0

**A Muay Thai basics coach that teaches, watches your form, and talks to you like a trainer**

| | |
|---|---|
| Platform | Progressive Web App (installable, offline) |
| Primary device | Google Pixel 9, Chrome |
| Version | 2.0 (replaces v1.0, March 2026) |
| Date | October 2026 |
| Primary user | One beginner (the author), training alone at home |

---

## 0. Why v2 exists

v1 made a working app, but in use it felt **glitchy and like a hitbox game rather than a coach**. Reviewing the v1 spec and code alongside real use turned up these root causes. Each one maps to a v2 decision.

| What went wrong in v1 | Root cause | v2 decision |
|---|---|---|
| Scores felt random; "Perfect" almost never happened | v1 scored **reaction time** against the voice callout (Perfect = within 100 ms). Hearing a word, reacting and landing a punch takes roughly 400–700 ms, so the score measured lag, not technique. | Score **form per rep**. Timing is only a loose "did you attempt it" window (§9). |
| No sense of being taught | v1 assumed the user already knew the moves; the Move Library was passive viewing. | A **Learn → Drill → Round** progression with demos, slow sets, end-of-set coaching and mastery gates (§4–5). |
| "Correct" was yes/no | The classifier checked "arm straight and fast enough" for the *expected* move only. | A **rep detector** that segments every attempt (guard → strike → back to guard), identifies *what* was thrown, and grades a short **form checklist** (§6–7). |
| Stance/guard alerts never fired | Foot checks silently gave up whenever ankles weren't visible (often, in portrait at 640×480). Thresholds were magic numbers, not your body. | A **framing check** before training, **calibration to your body**, and checks that declare when they can't see enough instead of failing silently (§3, §7.3). |
| Possible lead/rear arm swap | v1 assumed MediaPipe's "left" landmarks are the user's right because the preview is mirrored. Only the on-screen `<video>` is mirrored (CSS); the frames MediaPipe analyses are not. So "left" is probably your real left, and the jab check may have been watching the rear arm. Not confirmed. | **Verify at runtime:** calibration asks you to raise your left hand and records the mapping (§7.2). Never assume it. |
| Straight punches hard to read | A jab thrown straight at a front camera barely changes the arm's 2D shape. | Use MediaPipe **world landmarks** (3D, metres) for angles, plus scale cues; give each check a **detectability rating** and never voice low-confidence faults (§6, §7). |
| Voice flow hung or talked over itself | `speechSynthesis` `onend` is unreliable on Android; several features called `speak()` and cancelled each other. | One **voice queue with priorities** that never waits on `onend` to move the session forward (§8.4). |
| Changes shipped that did nothing | Fixes were written without any way to see what the detector saw, and without device testing. | A **debug overlay**, **unit tests on recorded/synthetic landmark sequences**, and **on-device exit criteria** for every phase (§12–13). |

---

## 1. Goals and non-goals

### Goals
1. **Teach Muay Thai basics** to a beginner training alone: stance, guard, footwork, punches, kicks, knees, checks.
2. **Give useful form feedback**: a few faults that matter, explained in plain words, at the right moments.
3. **Feel reliable**: never count a rep you didn't throw; never stay silent when you clearly dropped your hands; say so plainly when it can't see you.
4. **Stay fun**: XP, levels, streaks and mastery badges stay.
5. **Stay private and offline**: video never leaves the phone and is never stored (§10).

### Non-goals (v2)
- Heavy bag mode (removed — the bag hides your arms and makes form feedback unreliable).
- Elbows, spinning techniques, question-mark kick, flying knee (later versions).
- Any AI agent, LLM or cloud service. All coaching logic is on-device rules.
- Sparring/partner detection (single person only).

---

## 2. Design principles

1. **Teach first, score second.** The score exists to motivate practice, not to judge reaction speed.
2. **Say less, say it well.** One correction at a time, at the end of a set; only urgent things interrupt (§8).
3. **Calibrate to the person.** Thresholds are relative to *your* calibrated stance and body size, not universal constants.
4. **Be honest about what the camera can see.** Every check declares confidence. If confidence is low, the app stays quiet about it rather than guessing.
5. **Prove it on the device.** No feature is "done" until it passes its on-device exit criteria (§13) with the debug overlay confirming what the detector saw.

---

## 3. Setup, camera placement and framing check

### 3.1 Recommended placement
- Phone in **portrait**, propped at roughly **waist height**.
- **About 30° off the line you strike along, on your rear-hand side** (right for orthodox, left for southpaw): roughly 3 m in front of you and 1.5 m to the side. You face a spot on the wall, your imaginary opponent, not the phone.
- Your whole body, including feet, is in frame with room to kick.
- Even, front-facing light; avoid a bright window behind you.

**Changed in Phase A (October 2026).** v2 started with a straight-on placement, and on-device logs showed why it doesn't work for straight strikes. A jab thrown straight at the phone moved the 3D reach only 0.05–0.15 shoulder widths. A fully extended arm read 122–137° at the elbow. The jab step in calibration took up to 41 s for three jabs.

Expert motion capture placed at virtual angles (`docs/research/camera-angle.md`) showed why:
- **Straight on**, only 20–32% of a jab or cross travels across the picture.
- **At 30°**, about half does.
- **At 45°**, 67–83% does.

The user's 30° angle-test log confirmed it on the phone:
- lead elbow at jab peak read 137–152°
- reach was about 45% larger
- the rep detector found 15 of 16 called-out jabs and crosses and labelled every one correctly

The rear-hand side keeps the chest and both gloves toward the phone, which the guard checks need. The user chose 30° over 45°. Kicks and uppercuts are well visible at any angle.

### 3.2 Camera configuration
| Constraint | Value | Why |
|---|---|---|
| `facingMode` | `user` | Front camera |
| Aspect | Portrait (request ideal 720×1280) | A standing body is tall; portrait fits feet and head without standing so far back |
| `frameRate` | ideal 30 | Matches pose detection |
| Audio | `false` | Never request the microphone |

MediaPipe downsamples internally, so higher camera resolution mainly helps framing, not inference cost.

### 3.3 Framing check (runs before every session and continuously during it)
The framing check computes a **status** (green / amber / red) and gives **one spoken and on-screen tip at a time**.

| Check | Measure | Tip when off |
|---|---|---|
| Whole body visible | Nose, shoulders, hips, knees, ankles, heels all have visibility ≥ 0.6 | "Step back until I can see your feet" |
| Distance | Body height (top of head estimate → mid-heels) is 55–85 % of frame height | "Step back a little" / "Come a little closer" |
| Centred | Hip midpoint x within the middle 40 % of the frame | "Move a little to your left/right" (directions as you see them on screen) |
| Edge margin | No required landmark within 3 % of a frame edge | "Give yourself room to kick — step back" |
| Camera tilt | Heels near the bottom edge with large headroom, or the reverse | "Tilt the phone down/up a bit" |
| Lighting | Mean visibility of required landmarks < 0.7 for 2 s | "More light would help" |
| Facing | Torso facing estimated from world-landmark shoulder vector is within ±50° of the camera (at the 30° placement the torso reads ~25°) | "Turn a little toward the phone" |

- **Red** (required landmarks missing) blocks starting. **Amber** allows starting with a warning. **Green** starts immediately.
- All values are starting points to tune on device (§12).

### 3.4 Out of frame (during training)
A presence state machine runs every frame:

```
TRACKING ──(required landmarks lost > 1.0 s)──▶ OUT_OF_FRAME
OUT_OF_FRAME ──(required landmarks stable 1.5 s)──▶ RESUMING ──(3-2-1 tones)──▶ TRACKING
```

- "Required landmarks" depend on the drill: **upper body + hips** for punch-only drills, **full body** for anything with kicks, knees, checks or footwork.
- On entering OUT_OF_FRAME: the set timer freezes, reps stop being scored, the screen shows a silhouette outline guide, and the voice says **"Out of frame"** (user's chosen wording; not "pause").
- On recovery: the voice says **"Back in frame"**, then 3-2-1 tones, then the set continues where it left off.
- Brief dropouts (< 1.0 s, e.g. a fast kick blurring an ankle) do not trigger anything.

---

## 4. Learning model

The user asked for teaching that works, and for research on the right mix and frequency. The motor-learning evidence is real but often mixed; the table records what v2 does, why, and how strong the evidence is.

| Principle | What v2 does | Evidence (see §A) |
|---|---|---|
| **Show, then point at what matters** | Every technique opens with a looping stick-figure demo with **1–2 highlighted key points** (e.g. "rear glove stays on cheek"). | Novices struggle to pick out the important parts of a demonstration; directing attention to key features helped novices in a golf-swing study. Moderate. |
| **Summary feedback at the end of a set** | Per-rep voice corrections are replaced by a short end-of-set summary. (This is also what the user asked for.) | Reduced/summary feedback is a long-standing recommendation (guidance hypothesis), but replications are mixed and a meta-analysis found no clear retention effect. Mixed — chosen mainly for user preference and to avoid nagging. |
| **Bandwidth: only report faults that are frequent** | A fault is mentioned only if it occurred in ≥ 30 % of the set's reps (≥ 2 reps for guard faults). Occasional slips are left alone. | Bandwidth feedback improved consistency beyond frequency effects alone (Lee & Carnahan 1990); a judo study applied it to a combat skill. Moderate. |
| **Fade feedback as you improve** | As a technique's mastery rises, the coach says less (§8.3). | Faded feedback is commonly recommended; beginner-specific primary evidence is thin. Weak–moderate. |
| **Praise good reps** | Every clean rep gets a bright chime; summaries lead with what went well; the first clean rep after a correction gets "That's it." | Feedback after good trials enhanced learning (Chiviacowsky & Wulf 2007 and replications). Moderate. |
| **Cue the effect, not the body part** | Cue wording focuses on targets and outcomes ("punch through the target", "push the door shut with your foot") rather than joints. | External focus of attention generally beats internal focus (Wulf). Moderate–strong; sources here mostly secondary. |
| **Blocked first, mixed later** | New techniques are practised in blocked sets (same move repeated). Once a technique is Solid, review sets interleave it with other known moves, and combos/rounds mix freely. | Random practice is classically better for retention, but sport studies with beginners found blocked and random both work. Mixed — v2 picks blocked for motivation early, mixing for review. |
| **Whole movements, slowed down** | Techniques are practised whole at a slow tempo rather than split into parts. Combos are split into their component techniques first. | Whole practice suits tasks whose parts are tightly linked (a single strike); part practice suits looser sequences (combos). Weak (secondary source) but intuitive. |
| **Let the learner steer a little** | After each summary: **Again** or **Next**. Optional "Tip?" button gives the top fault at any time. | Self-controlled feedback/practice shows learning benefits in several studies; mechanism debated. Moderate. |
| **Space it out** | Sessions are short and recur across days; each session revisits earlier techniques. | Spacing is well established generally; not specifically researched here. |

### 4.1 Concrete mix and frequency (starting values)

| Item | Value |
|---|---|
| Reps per set (Learn) | 8 |
| Sets per technique per session (Learn) | 3 |
| Rest between sets | 20–30 s (the summary plays during rest) |
| New techniques per session | Max 2 |
| Review techniques per session | 2–3, interleaved once Solid |
| Session length (default "Daily Basics") | ~20–25 min |
| Immediate voice cues per set | Max 2 (guard + frame events), excluding "Out of frame"/"Back in frame" |
| End-of-set summary | ≤ 3 short sentences: result, one positive, one focus |

All values are tunable and will be revisited after the first two weeks of real use.

### 4.2 Default session recipe: "Daily Basics"

| Block | Content | Time |
|---|---|---|
| 1. Setup | Framing check; calibration if first time or 7+ days since | 0.5–2 min |
| 2. Warm-up | Hold stance and guard 20 s, then footwork set (steps forward/back/side) | ~2 min |
| 3. Learn | 1–2 New/Learning techniques: demo → 3 × 8 reps with summaries | ~6–8 min |
| 4. Review | 2–3 Solid techniques, interleaved, 2 sets | ~5 min |
| 5. Combo drill | 3–4 combos built only from Solid techniques | ~4 min |
| 6. Round | 1–2 × 2 min callout rounds, no interruptions except guard and frame | ~4 min |
| 7. Wrap-up | Session summary, XP, mastery changes, what's next | ~1 min |

Before anything is Solid, blocks 4–5 are skipped and the session is shorter.

---

## 5. Modes and screens

### 5.1 Screen flow
`Home → (Daily Basics | Learn | Drill | Round | Library | Progress | Settings)`

| Screen | Purpose |
|---|---|
| **Home** | Level/XP bar, daily streak, "Start Daily Basics", what's next (e.g. "Cross: 2 more Solid sets to unlock combos") |
| **Setup** | Framing check with live silhouette guide and tips; calibration flow |
| **Learn** | Demo → sets → summaries for one technique |
| **Drill** | Combos: announce → go tone → throw at your pace → per-move result |
| **Round** | Timed callouts (combos), minimal interruptions, end-of-round summary |
| **Library** | All techniques: demo, key points, your mastery level and most common fault |
| **Progress** | Mastery per technique, history, XP over time |
| **Settings** | Stance, voice rate/volume/verbosity, tones on/off, debug overlay, re-calibrate, data export/delete |

### 5.2 Learn mode flow
1. **Demo**: stick figure loops the technique; 1–2 key points highlight in turn while the voice reads them (≤ 15 s). Tap to skip.
2. **Set**: a soft cue tick asks for each rep. Tempo starts slow (one cue every ~3 s, waiting for you to return to guard) and tightens toward ~1.8 s as the set goes well. A rep is never marked missed for being slow in Learn mode; it is "missed" only if you don't attempt within 4 s.
3. **During the set**: per-rep tone (§8.2). Voice only for guard-down and frame events.
4. **Summary** (during rest): e.g. *"Seven of eight clean. Great snap back to guard. Next set: keep your rear glove glued to your cheek."* On screen: a strip of the 8 reps (clean / good / fix / missed) and the top fault with its cue.
5. **Next set**: after a 25 s rest the next set starts by itself, because the user is ~3 m from the phone. **Next set** and **End** buttons are optional. After 3 sets, mastery updates.

**Hold techniques (Stance, Guard)** use the same flow, with a 20 s hold per set judged in ten 2 s windows. Each window counts as a rep for ratings, XP, summaries and mastery. Until the stick-figure demos arrive (Phase C), the demo step is the key points, spoken and shown as text.

### 5.3 Drill mode flow (combos)
1. Voice announces the whole combo: *"Jab, cross, low kick."*
2. **Go** tone after the announcement (the scheduler uses an estimated speech duration; it does not wait on `onend` — §8.4).
3. You throw the combo at your own pace. The rep detector segments each technique in order.
4. Per-technique result tones; then a one-line verdict (*"Combo clean"* or *"Good — the low kick lost its pivot"*).
5. Time allowance: 3 s + 1 s per technique (generous; this is not a reaction test). Wrong order or wrong technique counts as a miss for that slot.
6. Every 4 combos: short summary using the same rules as Learn.

### 5.4 Round mode
- Fixed-length rounds (1–3 min) of random combos from Solid techniques, with the gap between combos adapting to performance (shorter gaps when clean, longer when struggling). This replaces v1's adaptive voice rate, which no longer applies because combos are announced in full.
- Only guard and frame events interrupt. Everything else goes into the end-of-round summary.

---

## 6. Technique catalogue and form checks (v2 scope)

### 6.1 Techniques in scope

| Group | Techniques |
|---|---|
| Foundations | Fighting stance, Guard (Thai high guard) |
| Footwork | Step forward, Step back, Side step left, Side step right, Switch stance |
| Punches | Jab, Cross, Lead hook, Rear hook, Lead uppercut, Rear uppercut |
| Kicks | Lead teep, Rear teep, Rear roundhouse (body), Lead roundhouse (body), Switch kick, Rear low kick, Lead low kick (inside) |
| Knees | Rear knee, Lead (switch) knee |
| Leg defence | Lead check, Rear check |
| Hand defence | High guard block |

Every technique has a JSON definition (§7.5) with: phases, required landmarks, detection features, form checks, cue text, demo keyframes, and a **detectability** rating for itself and for each check.

### 6.2 Form checks

The user is a beginner, so v2 picks the checks from common beginner errors reported by gyms and coaches (§A) and keeps only those the camera can plausibly measure.

**Severity:** *Major* faults downgrade a rep to "Fix"; *minor* faults downgrade it to "Good".
**Detectability:** H = reliable from a front camera; M = usable with calibration, voiced only when confidence is high; L = shown in debug only until validated on device.

**Foundations**

| Technique | Check | Sev. | Det. | Cue (external focus where possible) |
|---|---|---|---|---|
| Stance | Feet roughly shoulder-width (stance width within calibrated band) | Major | M | "Feet on railway tracks, not a tightrope" |
| Stance | Correct foot forward for chosen stance | Major | M | "Left foot forward" / "Right foot forward" |
| Stance | Weight centred (hip midpoint over the feet midpoint) | Minor | M | "Stand tall between your feet" |
| Guard | Both wrists at or above calibrated guard height | Major | H | "Gloves by your eyebrows" |
| Guard | Elbows tucked (within the shoulder line) | Minor | M | "Elbows in, like holding a towel against your ribs" |

**Punches**

| Technique | Check | Sev. | Det. | Cue |
|---|---|---|---|---|
| Jab, Cross | Arm reaches full extension at peak: wrist reach ≥ ~90 % of the calibrated reach (§7.2). Until reach is calibrated, the check reports unknown. (Phase A data: a full jab straight at the front camera read only ~125–135° elbow angle in world landmarks, so a fixed 150° threshold would fail every jab.) | Minor | M | "Punch through the target" |
| Jab | Rear hand stays at guard during the punch: no more than 0.75 shoulder widths below calibrated guard height (the user's 30° log: drops of 0.8–1.3 on 7 of 8 jabs) | Major | H | "Rear glove glued to your cheek" |
| All punches | Return to guard within ~0.6 s of peak | Major | H | "Snap it straight back to your face" |
| Cross | Shoulders and hips rotate: world shoulder line turns ≥ ~25°, measured from 400 ms before launch, since the hips start first. Unknown when the rep follows another too closely to have a clean "before". | Major | M | "Drive your rear hip toward the target" |
| Cross | Rear foot pivots: heel→toe direction turns ≥ ~35° (experts 57–70°; the user's typical turn was ~35°, `docs/research/technique-qualities.md`) | Minor | M | "Squash the bug under your back foot" |
| Cross | No wind-up (wrist doesn't move backward before launch) | Minor | M | "Fire straight from your chin — no pulling back" |
| Cross, hooks, uppercuts | Non-punching hand stays at guard | Major | H | "Other glove stays on your chin" |
| Hooks | Elbow bent ~90° and raised near shoulder height at peak | Minor | M | "Make a hook shape — elbow up level with your fist" |
| Uppercuts | Fist travels upward from close range; no big drop first | Minor | M | "Lift from your legs, straight up the middle" |

**Kicks, knees and checks**

| Technique | Check | Sev. | Det. | Cue |
|---|---|---|---|---|
| Roundhouse (all) | Support foot pivots (support heel turns/lifts) | Major | M | "Turn your standing heel toward the target" |
| Roundhouse (all) | Hips turn over (world hip line rotates) | Major | M | "Kick through the bag, not to it" |
| Roundhouse (all) | Same-side guard hand stays up while the kicking-side arm swings | Major | H | "Keep one glove on your chin" |
| Roundhouse (all) | No big lean back (torso angle within calibrated band) | Minor | M | "Chin over your standing knee" |
| Low kick | Peak ankle height below hip | — (identification) | H | — |
| All kicks/knees | Return to stance after the strike | Major | H | "Put it back where it came from" |
| Teep | Knee chambers before the leg extends | Major | M | "Knee up first, then push the door shut with the ball of your foot" |
| Teep | Hands stay up | Major | H | "Gloves up while you push" |
| Switch kick | Switch step is small and quick before the kick | Minor | M | "Quick small switch — hop, don't walk" |
| Knee | Knee drives up above hip height | Minor | H | "Drive your knee up through the target" |
| Knee | Hips push forward (not leaning back excessively) | Minor | L | "Hips into it" |
| Check | Lifted knee comes close to the same-side elbow | Major | M | "Touch your knee to your elbow" |
| Check | Hands stay up | Major | H | "Gloves up — shin does the work" |

**Footwork**

| Technique | Check | Sev. | Det. | Cue |
|---|---|---|---|---|
| All steps | Stance width restored after the step | Major | M | "Land back in your stance" |
| Side steps | Feet don't cross | Major | H | "Lead with the foot closest to where you're going" |
| All steps | Hands stay up during the step | Major | H | "Gloves up while you move" |
| Forward/back | Detected via body scale change (front camera sees depth as size) | — | M | — |

Additional checks can be added per technique once the core set is validated.

---

## 7. Detection pipeline

```
camera frame (never stored)
  → MediaPipe Pose Landmarker (image + world landmarks, visibility, presence)
  → filter (One Euro, per landmark, timestamp-based)
  → body model (body-relative features per frame)
  → presence/framing state machine
  → rep detector (per-technique phase machine)
  → technique identification + form evaluation
  → coach (feedback policy) → voice queue / tones / HUD
```

### 7.1 Pose engine changes from v1
- **Self-hosted MediaPipe**: WASM and `.task` model files are bundled in the repo and served from the app's own origin. No CDN at runtime (privacy and true offline; §10).
- **Use `worldLandmarks`** (hip-centred 3D, metres) for angles and rotations; use image landmarks for framing and on-screen drawing.
- **Use `presence` and `visibility`** per landmark for confidence.
- **One Euro filter** instead of fixed-alpha EMA: less jitter when still, less lag when moving fast. Parameters tuned on device.
- **Velocities in body units per second** computed from timestamps, not per frame (v1's per-frame velocity changed meaning whenever the frame rate changed).
- **Model**: `pose_landmarker_full`. `heavy` was benchmarked on the Pixel 9 in Phase A at about 16 FPS (57 ms inference), below the 25 FPS bar, and had lower knee/heel visibility, so it is not offered. Full measured about 23 FPS (25 ms inference).

### 7.2 Calibration (first run, then on demand)
1. **Handedness check**: "Raise your **left** hand above your head." Whichever landmark wrist rises is recorded as the user's left. If it's MediaPipe's index 16, the app sets a `swapSides` flag. This settles the v1 mirror question empirically on the real device.
2. **Stance**: "Get in your fighting stance and hold still." Both orthodox and southpaw are fully supported. The app records which foot is forward and announces it ("Left foot forward. Orthodox stance."). It asks the user to tap Yes/No only when unsure, because the user is ~3 m from the phone and walking over to tap mid-calibration disrupts the remaining steps. It re-checks the stance at the start of every session, so you can train either side on different days. It can also be switched in Settings. All lead/rear mappings follow the current stance. The app stores:
   - stance width, in shoulder-widths
   - guard height (wrists relative to nose and shoulders)
   - elbow positions
   - torso angle at rest
3. **Reach**: "Throw three slow jabs." Records your full-extension geometry so the extension check is relative to your own arm.
4. Calibration takes under a minute and is stored per profile.

### 7.3 Body model (per frame)
Derived features, all normalised to the user (shoulder width or torso length as the unit):
- lead/rear wrist, elbow, knee, ankle, heel positions relative to the hip centre
- elbow and knee angles (world landmarks)
- shoulder-line and hip-line rotation relative to the calibrated stance
- guard distance: each wrist relative to calibrated guard height
- torso lean
- body scale (for forward/back steps)
- per-limb speed (body units/s)
- per-feature confidence (minimum visibility of the landmarks used)

Every check reads from this model and returns `{ pass | fail | unknown, confidence }`. **Unknown is a first-class result**: when landmarks aren't visible the check says "unknown" and is excluded from scoring and feedback, instead of v1's silent pass.

### 7.4 Rep detector
A generic phase machine driven by technique definitions:

```
GUARD ──(limb leaves guard zone & speed > launch threshold)──▶ LAUNCH
LAUNCH ──(limb reaches peak: max extension / height / rotation)──▶ PEAK
PEAK ──(limb back inside guard zone)──▶ RETURN ──▶ GUARD   (rep complete)
any ──(no progress for 2 s)──▶ GUARD (rep abandoned)
```

- **Identification**: when a rep completes, the detector scores it against every technique in the current pool (which limb launched, path shape, peak geometry) and labels it with the best match and a confidence. A rep that matches a different technique better than the expected one is "wrong technique", not a hit.
- **Straight punches (Phase B implementation)**: each arm has an *extension* score, where 0 = guard and 1 = calibrated full punch. The score is the larger of two measures, because the camera reads depth poorly and either cue can carry the punch:
  - the reach gain over the calibrated reach gain
  - the elbow opening over the calibrated elbow opening

  The score counts only while the wrist is no more than 0.5 shoulder widths below its shoulder, so dropping a hand can never become a punch. A rep starts at extension 0.45 and completes when both arms are back below 0.35. The punching arm must reach 0.75. The arm with the larger peak extension threw it: lead = jab, rear = cross.
- **Tracking glitches**: frames where a torso point jumps more than 0.35 torso lengths in one frame are replaced by the previous good frame, for up to 4 frames. Seen mid-cross in the 30° log.
- **Form evaluation** runs on the completed rep, with checks evaluated at the phase where they apply (e.g. "rear hand at guard" sampled during LAUNCH→PEAK; "return to guard" timed from PEAK).
- **Idle safety**: standing still or shifting weight must never produce a rep. Exit criterion: zero reps from 60 s of idle stance (§13).

### 7.5 Technique definition schema (`data/techniques/*.json`)

| Field | Description |
|---|---|
| `id`, `name`, `group` | e.g. `jab`, "Jab", `punch` |
| `side` | `lead` / `rear` / `both` |
| `required_landmarks` | `upper` or `full` (drives presence requirements) |
| `detectability` | H / M / L for the technique overall |
| `launch` | Limb and speed threshold (body units/s) to enter LAUNCH |
| `peak` | Peak criterion (`max_extension`, `max_height`, `max_rotation`, `body_scale_change`, ...) |
| `checks[]` | `{ id, phase, measure, threshold, severity, detectability, cue, fault_text }` |
| `key_points[]` | 1–2 demo highlights with voice text |
| `demo_keyframes[]` | Stick-figure keyframes for the demo animation |
| `mastery` | Optional overrides for mastery thresholds |

Thresholds are expressed relative to calibration (e.g. `"guard_height + 0.25 shoulder_widths"`), never in raw image coordinates.

---

## 8. Coaching and voice

### 8.1 What gets said when

| Event | Channel | When | Limit |
|---|---|---|---|
| Out of frame / Back in frame | Voice + screen | Immediately (§3.4) | Always |
| Hands down | Voice "Hands up" + screen | Guard below calibrated height for > 1.5 s **outside** any rep's LAUNCH/PEAK phase | Once per 10 s; max 2 per set |
| Per-rep result | Tone only | At rep completion | Every rep |
| First clean rep after a corrected fault | Voice "That's it" | At rep completion | Max 1 per set |
| End-of-set summary | Voice + screen | During rest | Every set (subject to fading) |
| Combo verdict | Voice (one line) | After each combo | Every combo |
| Round summary | Voice + screen | End of round | Every round |
| Framing tips | Voice + screen | Setup; during training only for red status | One tip per 5 s |

Everything else (all non-guard form faults) waits for the summary.

### 8.2 Tones (Web Audio, instant, no files)
| Event | Sound |
|---|---|
| Cue (Learn: "throw now") | Soft tick, 900 Hz, 50 ms |
| Go (after combo announcement) | 1100 Hz, 150 ms |
| Clean rep | Bright chime (two-note up) |
| Good rep | Single soft note |
| Fix rep | Low soft thud (not harsh — the user is a beginner) |
| Missed | No sound (silence is the feedback) |
| Round start/end | Bell |

### 8.3 Summary rules and fading
- **Structure**: result count → one positive (the best-performing check) → one focus (the most frequent fault above the bandwidth threshold, using its cue text). If nothing exceeds the bandwidth, the focus is "Same again — keep it sharp."
- **Priority among faults**: guard faults → return-to-guard → technique-defining faults (pivot, extension, chamber) → minor faults.
- **Fading by mastery**:
  - New/Learning: summary after every set with a focus cue.
  - Solid: summary every set, focus cue only if a fault exceeds 30 %.
  - Sharp: per-set summaries off; end-of-block summary only.
- **Wrong technique**: if it happens 2+ times in a set: "I asked for a jab — that looked like a cross."
- **Sentence length**: immediate cues ≤ 4 words; summary sentences ≤ 12 words.

### 8.4 Voice engine
- **Single queue with priorities**:
  - P0: frame events
  - P1: guard
  - P2: instructions, announcements and summaries
  - P3: praise

  A higher priority can cut off a lower one. Same priority waits its turn. Nothing else calls `speechSynthesis` directly.
- **Never block the session on `onend`.** Flow timing uses an estimated duration (characters ÷ rate, plus margin). `onstart`/`onend` are treated as hints, with a start watchdog. This is based on documented Android quirks: `pause()` acts as `cancel()`, `boundary` events don't fire, and `end` can arrive immediately or not at all.
- No speech during a rep's LAUNCH/PEAK phase except P0.
- Settings: voice, rate, volume, verbosity (Quiet / Normal / Chatty — scales the limits in §8.1).
- Built-in device TTS (offline on Pixel). Pre-recorded clips remain a possible later upgrade if TTS quality or latency disappoints.

---

## 9. Scoring and progression (kept, because it's fun)

### 9.1 Per-rep rating
| Rating | Meaning | XP |
|---|---|---|
| **Clean** | No faults (unknown checks ignored) | 10 |
| **Good** | Minor faults only | 6 |
| **Fix** | At least one major fault | 2 (effort counts) |
| **Missed** | No attempt in time, or wrong technique | 0 |

- **Streak**: count of Clean/Good reps since the last Missed. Multipliers: 5 → 1.5×, 10 → 2×, 20 → 3×, applied to Clean/Good reps only. A Fix neither adds to the count nor resets it, and earns its 2 XP with no multiplier; a Missed resets the count to 0.
- **Combo bonus**: +20 XP for a combo where every technique is Clean/Good.
- **Daily streak**: days in a row with at least one completed session.
- **Session XP** = sum of rep XP + bonuses. No difficulty multiplier (the mastery gates handle difficulty).

### 9.2 Mastery per technique
| Level | Requirement | Unlocks |
|---|---|---|
| New | Never practised | — |
| Learning | ≥ 1 set completed | — |
| Solid | ≥ 80 % Clean/Good across 2 consecutive sets of ≥ 8 reps | Use in Review, Drill and Round |
| Sharp | ≥ 90 % Clean/Good across 3 separate sessions | Fewer summaries (fading) |

Mastery is computed only from reps where the technique's key checks were measurable (not unknown).

### 9.3 Levels and unlock path
- Player level comes from cumulative XP on a gentle curve (fast early levels).
- **Techniques unlock by learning path, not by level**. Each path is gated by mastery of earlier steps:
  1. Stance, Guard, Footwork
  2. Jab, Cross
  3. Teep, Rear roundhouse, Check
  4. Hooks, Uppercuts
  5. Lead roundhouse, Switch kick, Low kicks, Knees
- Combos unlock when all their techniques are Solid.
- Badges for milestones (first Sharp technique, 7-day streak, 100 clean jabs, ...).

---

## 10. Privacy and data

Requirements, not aspirations:

1. **Video is never recorded, stored or transmitted.** Camera frames exist only in memory long enough for pose detection, then are discarded. No `MediaRecorder`, no canvas snapshots, no `toDataURL`/`toBlob` of camera content anywhere in the code.
2. **No network during training, and no third-party requests at all.** MediaPipe WASM and model files are self-hosted. A Content-Security-Policy restricts `connect-src` to `'self'` and `script-src` to `'self' 'wasm-unsafe-eval'` (Chrome requires `'wasm-unsafe-eval'` to compile WebAssembly; it does not allow JavaScript `eval`).
3. **No analytics, telemetry or AI services.**
4. **What is stored (IndexedDB, on the phone only)**: profiles, calibration numbers, per-rep results (technique, rating, which checks failed, timestamps), XP, mastery and settings. **Raw landmark streams are not stored** by default.
5. **Optional, off-by-default landmark capture** for tuning detection (approved by the user): records numbers only (no images), stays on the phone, is visible in Settings, and can be exported manually as JSON or deleted.
6. **Delete everything** button in Settings.
7. The camera indicator/permission is released whenever the training screen is left.

---

## 11. Architecture

v1's shell (PWA, event bus, screen router, layered canvases, HUD layout) is kept. The move classifier, combo engine, pose processing and audio paths are **rewritten**: their core assumptions (reaction-time scoring, expected-move-only checks, magic thresholds) don't survive the v2 design, and patching them caused most of the regressions so far.

| Path | Status | Responsibility |
|---|---|---|
| `index.html`, `manifest.json`, `css/app.css` | Keep, extend | Shell, new screens |
| `sw.js` | Rewrite | Cache-first for self-hosted assets only |
| `vendor/mediapipe/` | New | Self-hosted WASM + model |
| `js/app.js` | Keep, extend | Boot, bus, router |
| `js/camera.js` | Modify | Portrait constraints |
| `js/pose/pose-engine.js` | Rewrite | MediaPipe wrapper, world landmarks, timestamps |
| `js/pose/filter.js` | New | One Euro filter |
| `js/pose/body-model.js` | New | Normalised per-frame features + confidence |
| `js/pose/framing.js` | New | Framing status + presence state machine |
| `js/pose/calibration.js` | New | Handedness, stance, reach capture |
| `js/technique/rep-detector.js` | New | Generic phase machine + identification |
| `js/technique/form-eval.js` | New | Evaluates checks on a completed rep |
| `js/technique/registry.js` | New | Loads `data/techniques/*.json` |
| `js/coach/coach.js` | New | Feedback policy: what, when, bandwidth, fading, priorities |
| `js/coach/session.js` | New (replaces combo-engine) | Learn / Drill / Round / Daily Basics scheduling |
| `js/audio/voice.js` | New | Priority TTS queue with watchdogs |
| `js/audio/tones.js` | New (from audio.js) | Web Audio tones |
| `js/render/renderer.js` | Modify | Live skeleton, fault highlights, outline guide |
| `js/render/demo.js` | New | Keyframe stick-figure demos with highlights |
| `js/progression.js`, `js/storage.js` | New | XP, mastery, IndexedDB |
| `js/debug/overlay.js` | New | Debug overlay (§12.1) |
| `js/screens/*` | Rewrite/new | Home, Setup, Learn, Drill, Round, Library, Progress, Settings, Results |
| `data/techniques/*.json` | New (replaces moves.json) | Technique definitions |
| `data/combos.json` | Modify | Combos referencing technique IDs |
| `tests/` | New | Node test runner (`node --test`), no build step |

Pure modules (filter, body model, framing, rep detector, form eval, coach, progression) take plain data and have **no DOM or camera dependencies**, so they are unit-testable in Node.

---

## 12. Testing and tuning

### 12.1 Debug overlay (Settings → Debug, or `?debug=1`)
- Labels on wrists/ankles showing which side the app thinks is **your** left/lead.
- Current presence and framing status, FPS, inference time.
- Current rep phase, live key metrics for the active technique (e.g. elbow angle, guard distance, hip rotation) with their thresholds.
- Last rep: identified technique, confidence, each check's pass/fail/unknown.

This is the main tool for tuning, and for proving a change does what it claims before calling it done.

### 12.2 Automated tests
- Unit tests for filter, body model, framing, rep detector, form eval, coach policy and progression, using **synthetic landmark sequences** (generated from demo keyframes plus noise) and, if approved, **captured numeric sequences** from real sessions.
- Fixtures cover:
  - one clean rep per technique
  - each fault per technique
  - idle stance (60 s)
  - weight shifting
  - out-of-frame transitions
  - occluded landmarks

### 12.3 On-device checklist (run by the user, guided by the debug overlay)
A short scripted routine per phase: stand idle 60 s, 8 clean jabs, 8 jabs dropping the rear hand, walk out of frame and back, and so on. Each phase's exit criteria (§13) reference this checklist.

---

## 13. Delivery plan

Each phase ends with **on-device exit criteria** checked by the user. A phase isn't done until they pass.

| Phase | Scope | Exit criteria (on the Pixel 9) |
|---|---|---|
| **A. Foundation reset** | Self-hosted MediaPipe, portrait camera, world landmarks, One Euro filter, body model, framing check, out-of-frame flow, calibration (handedness, stance, guard, reach), voice queue, tones, debug overlay, test harness | Debug labels show the correct left/right for the user. "Out of frame" / "Back in frame" fire every time across 10 walk-outs and never on fast arm movement. Framing tips match reality. App works in airplane mode. |
| **B. Learn: first techniques** | Rep detector, form eval, coach policy and summaries, per-rep tones, XP and streaks, for Stance, Guard, Jab, Cross | ≥ 90 % of deliberate reps detected. 0 reps from 60 s idle. Jab vs cross identified correctly ≥ 90 %. Dropping the rear hand on 5 of 8 jabs produces that focus cue in the summary. "Hands up" fires within 2 s when hands drop between reps. |
| **C. Learn: full catalogue** | Remaining punches, footwork, kicks, knees, checks; demo animations with highlights; Library screen | Each technique: ≥ 85 % detection, ≥ 85 % identification within its group, no voiced low-confidence faults. Demos play for every technique. |
| **D. Drill, Round, Daily Basics, progression** | Combo flow, round mode, session recipe, mastery gates, unlock path, IndexedDB persistence, profiles | A full Daily Basics session completes without manual intervention. Combos segment correctly ≥ 85 %. Progress survives app restart. |
| **E. Polish** | Fading tuned on real data, history/progress charts, settings, export/delete, accessibility | Two weeks of real use with the user reporting feedback feels helpful, not naggy. |

---

## 14. Risks and mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| Front camera can't see depth for straight punches and teeps | High | World landmarks; body-scale cues; calibrated reach; mark checks M/L; never voice low-confidence faults |
| Wrong feedback erodes trust faster than missing feedback | High | Bandwidth threshold, confidence gating, "unknown" results, debug overlay; optional "that's wrong" tap on summaries to log and suppress a cue |
| Occlusion when turning for kicks (far arm/leg hidden) | Medium | Per-check confidence; don't penalise unknown; required-landmark sets per technique |
| Room too small for kicks at 2.5–3 m | Medium | Framing check edge-margin tip; punch-only sessions as a fallback |
| Android TTS quirks | Medium | Priority queue, estimated durations, watchdogs; tones carry rep-level feedback |
| Left/right mapping wrong on some devices | Medium | Handedness calibration on every device/profile; re-check on demand |
| Performance with `heavy` model or extra processing | Low–Med | Benchmark early (Phase A); fall back to `full`; keep per-frame work < 5 ms |
| Lighting at home | Low–Med | Lighting tip in framing check; amber status |

---

## 15. Decisions from user review (October 2026)

| Topic | Decision |
|---|---|
| Camera | Straight-on placement, with a framing check that says when the setup isn't optimal |
| Audience | Basics training for one beginner (the author) |
| Teaching | Demos, slow sets, explanations and mastery gates, mixed per the research in §4 |
| Form checks | Chosen by the spec from common beginner errors (§6.2) |
| Voice | Feedback at the end of each set; guard and frame events immediately |
| Privacy | Video never recorded or kept; no AI agents or cloud services |
| Gamification | Keep XP, levels and streaks |
| Out of frame | Auto-stop and resume; say "Out of frame", not "pause" |
| Scope | No heavy bag; all basic kicks, knees, checks and footwork |
| Code | Rewrite detection and session logic rather than patch |
| Stance | Support both orthodox and southpaw (§7.2) |
| Session rhythm | ~20–25 min, a few days a week |
| Space | ~2.5–3 m from the phone with room to kick is available |
| Landmark capture | Approved as an opt-in, off-by-default, numbers-only feature (§10.5) |

---

## Appendix A — Research notes and sources

**Feedback frequency and the guidance hypothesis.** Reduced and summary feedback is a long-standing recommendation, but results are mixed: some studies show a learning advantage over 100 % feedback, others don't replicate it, and a pre-registered meta-analysis found no significant change from immediate to delayed retention. A 2024 postural-control study favoured 67 % frequency. v2 uses end-of-set summaries primarily because the user prefers them and they avoid nagging, not because the evidence is decisive.
- [Frontiers in Psychology 2010 — feedback frequency and guidance](https://www.frontiersin.org/articles/10.3389/fpsyg.2010.00190/pdf)
- [Marschall, Bund & Wiemeyer 2007](https://orbilu.uni.lu/bitstream/10993/4589/1/Publikation_Marschall_Bund_Wiemeyer_2007_EJournal%20Bewegung%20und%20Training.PDF)
- [Sensors 2024 — feedback frequency in postural control](https://doaj.org/article/ebad24932aae4d1c9ca8fafc8e210483)
- [Frontiers in Neuroscience 2016 — concurrent auditory feedback](https://www.frontiersin.org/journals/neuroscience/articles/10.3389/fnins.2016.00251/pdf)
- [JEMS — reduced-frequency meta-analysis](https://www.scapps.org/jems/index.php/1/article/view/2529)

**Bandwidth feedback.** Feedback only when error exceeds a tolerance improved error reduction and consistency beyond frequency effects alone (Lee & Carnahan 1990); applied in a judo skill study (Lopes et al. 2018).
- [Lee & Carnahan 1990](https://experts.mcmaster.ca/scholarly-works/1313886)
- [Bandwidth KP in a judo motor skill](https://repositorio.ufmg.br/bitstream/1843/50742/2/Effects%20of%20the%20bandwidth%20knowledge%20of%20performance%20in%20the%20acquisition%20of%20a%20judo%20motor%20skill.pdf)
- [Cogent Psychology 2022 — adjusted bandwidth](https://doaj.org/article/c2045bc4dcab4c19845556aceefa2cbf)

**Feedback after good trials; self-controlled feedback.** Learners who controlled their feedback mostly asked for it after good trials; giving feedback after good trials enhanced learning in several studies. Mechanism (motivation vs information processing) is debated.
- [Frontiers in Psychology 2012](https://www.frontiersin.org/articles/10.3389/fpsyg.2012.00458/text)
- [Frontiers in Psychology 2014 — replication](https://www.frontiersin.org/articles/10.3389/fpsyg.2014.01325/full)

**External focus of attention.** Cues about the movement's effect generally beat cues about body parts (Wulf; constrained-action hypothesis). Sources found were mostly secondary.
- [University of Ottawa thesis](https://ruor.uottawa.ca/bitstreams/36095752-0740-4321-9d34-0917a7d24b57/download)
- [IDEA Fit — attentional focus and cueing](https://www.ideafit.com/attentional-focus-amp-cuing)
- [Eric Cressey — internal vs external cueing](https://ericcressey.com/a-coachs-view-on-internal-vs-external-cueing)

**Blocked vs random practice.** The classic contextual-interference effect favours random practice for retention, but sport studies with beginners (field hockey, volleyball) found blocked and random both effective.
- [JSSM 2012 — field hockey](https://jssm.org/jssm-11-304.xml-abst)
- [Volleyball contextual interference](https://pure.unic.ac.cy/en/publications/contextual-interference-effects-in-learning-volleyball-skills/)
- [Hall et al. 1994 — baseball](https://www.gwern.net/docs/spaced-repetition/1994-hall.pdf)

**Demonstrations and part/whole practice.** Novices benefit when demonstrations direct attention to key features; whole practice suits tightly linked skills.
- [Action observation and mental representation (combat sports)](https://www.sponet.de/sponet/Record/4044154?lng=en)
- [Brunel — visual guidance for novices](https://bura.brunel.ac.uk/bitstream/2438/12640/3/Fulltext.pdf)

**Beginner Muay Thai errors.** Gym and brand sources (not peer-reviewed, but consistent):
- Dropping the opposite hand on jabs and kicks
- Telegraphing the cross
- Teep without chambering the knee first
- Flat support foot and too little hip turn on roundhouses
- Leaning back on kicks
- A bladed boxing stance instead of a squarer Muay Thai stance

A small kinematic study of beginners' round kicks found most errors came from trunk rotation.
- [Bangtao Muay Thai — common beginner mistakes](https://bangtaomuaythai.com/?p=39561)
- [Fairtex — training tips](https://eu.fairtex.com/pages/training-tips)
- [FightCamp — roundhouse mistakes](https://blog.joinfightcamp.com/training/5-common-mistakes-to-avoid-when-doing-a-roundhouse-kick/)
- [Muay Thai Guy — roundhouse technique](https://www.muay-thai-guy.com/blog/muay-thai-roundhouse-kick)
- [EFDeportes — kinematic analysis of the Muay Thai kick](https://efdeportes.com/efd183/analise-cinematica-do-chute-no-muay-thai.htm)

**Pose estimation and viewing angle.** MediaPipe Pose accuracy depends strongly on viewing angle and exercise and drops quickly in less favourable conditions; no direct frontal-vs-45° benchmark was found.
- [Current Directions in Biomedical Engineering 2023](https://doaj.org/article/b1b1d4db2666494cacf7bcbcee8cdaa3)
- [Infant pose estimation, view comparison (arXiv 2024)](https://arxiv.org/pdf/2410.04980)
- [Polimi — MediaPipe for postural assessment](https://re.public.polimi.it/handle/11311/1302490)
- [MediaPipe Pose Landmarker guide](https://ai.google.dev/mediapipe/solutions/vision/pose_landmarker)

**Web Speech API on Android.**
- `pause()` behaves as `cancel()`
- `boundary` events don't fire
- `end` may fire immediately or not at all, so start watchdogs and timeouts are needed

Sources:
- [DEV — cross-browser speech synthesis](https://dev.to/jankapunkt/cross-browser-speech-synthesis-the-hard-way-and-the-easy-way-353)
- [IBMiX — speechless in the frontend](https://engineering.ibmix.de/blog/2024/08/speechless-in-the-frontend)
- [Coder's Block — speech synthesis quirks](https://codersblock.com/blog/javascript-text-to-speech-and-its-many-quirks/)
