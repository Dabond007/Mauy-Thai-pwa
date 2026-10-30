# Qualities of good technique, and what the phone can check (October 2026)

Sources:
- **Published research** (listed at the end).
- **Expert motion capture**: ACCAD, one karate performer, via `tools/mocap/`.
- **The user's 30° angle-test log** (29 October 2026): 8 jabs, 8 crosses, 4 rear kicks and 4 teeps, orthodox, called out by the app.

The research gives the *qualities* of a good strike: what moves, in what order. It rarely gives a threshold a phone can check. The thresholds below are starting points: experts set the target, and the user's own calibrated data sets what "good for you, today" means.

## Cross

| Quality | Evidence | Expert (mocap) | User (30° log) | Phone can measure? |
|---|---|---|---|---|
| Rear foot pivots ("squash the bug") | Coaching consensus. Research: trunk rotation and rear-leg drive are the biggest contributors to punch force (Lincoln review; Dinu & Louis 2020). | Rear foot turns 57–70°, heel lifts ~9 cm | Rear foot turns 22–71° (median ~35°) | **Yes, moderately.** The rear-foot direction is tracked. Heel lift isn't reliable from MediaPipe. |
| Hips and shoulders rotate, hips leading | Skilled boxers rotate the whole trunk; novices twist only the upper body (EMG/kinematics, straight punch). | Shoulders 71–74°, hips 40–71° | Hips 35–74° on 5 of 8 reps. Reps 6–8 read 126–176°, a tracking flip, not real. | **Yes, if label flips are filtered.** |
| Arm reaches full extension | Cross implies forward translation of the body (Dinu & Louis 2020). | Elbow 122–140° (experts don't lock out) | Rear elbow 125–159° | **Yes at 30–45°** against calibrated reach. |
| Other hand stays at the face | Coaching consensus (spec §6.2). | n/a (karate guard) | Lead hand drops 0.27–0.63 torso lengths. Visibility mostly fine. | Yes |

**Proposed check:** "rear foot turns at least ~40°" (about 60% of the expert's turn) as the pivot fault, with the cue "Squash the bug under your back foot". Pivot is often skipped by beginners; the user's median of ~35° says this would be the most common cross fault for them.

## Jab

| Quality | Evidence | Expert | User | Phone? |
|---|---|---|---|---|
| Little rotation, fast snap back | Jab has less body rotation than the cross; punch type matters more than skill level for most kinematics (Turkish 3D study). | Shoulders turn 20–23°, back to guard in 0.09–0.12 s | Lead elbow 137–152° at 30° (122–137° straight on) | Yes |
| Rear foot stays mostly planted | Expert data | Rear foot turns 14–23° | 11–28° | Yes. Separates jab from cross along with shoulder turn (jab ~20°, cross ~70°). |
| **Rear hand stays at the face** | Coaching consensus: the most common beginner fault (spec §A). | n/a | **Rear wrist reads 0.55–0.86 torso lengths lower on jabs 2–8**, but its visibility dips to 0.35–0.6 then | **Unclear.** At 30° your lead arm crosses in front of your rear hand as the camera sees it, so this may be a tracking artifact. Needs confirming (see below). |

## Roundhouse kick

What the research says (Gavagan & Sayers 2017, 3D motion capture of 8 expert Muay Thai fighters):
- The kick is fast: about 1.0 s from start to finish, including bringing the leg back down.
- **The pelvis turns about 92° (±23°)** through the kick. Rapid pelvic rotation, hip abduction and flexion, and moving the body toward the target characterise effective kicks.
- Muay Thai kicks keep more knee bend at impact than karate or taekwondo (43° vs 15–16°): the shin swings through rather than snapping.
- The knee bends to about 99° during the chamber.
- The study didn't report the support-foot pivot. The expert mocap support foot turned 22–123°, so it varies widely.

A 2019 study of Muay Thai beginners found clear differences between support legs, so beginners kick differently off each side.

**User's 4 kicks (30° log):** the data isn't usable yet.
- **Tracking broke:** torso-lean readings of 108° and 173°, and hip-turn readings that jump, are left/right label flips while you rotate, not real movement.
- **Kick 2 took you briefly out of frame,** so the app lost you for that rep.
- **Kicks 2–3 barely lifted:** the foot stayed 0.3–0.66 m below hip height.
- **Kick 4 rose 0.63 m above the hip,** with the hips turning about 140°.

**What the app should teach first** (beginner-relevant, camera-checkable):
1. **Turn the hips over.** Pelvis rotation at least ~60–70°, against the experts' ~90°. Cue: "Kick through the bag, not to it".
2. **Pivot the support foot.** Cue: "Turn your standing heel toward the target". The threshold can't be set from this data; it needs the user's logs after drills.
3. **Lift.** Foot reaches at least hip height for a body kick.
4. **Keep the other glove up** while the kicking-side arm swings.
5. **Return to stance.**

A Learn-mode progression for kicks: slow kicks with a pause at the top, then normal speed. That gives cleaner tracking and better learning.

## Teep

| Quality | Evidence | Expert | User | Phone? |
|---|---|---|---|---|
| Knee chambers first | Coaching consensus (spec §6.2) | Knee bends to 70–74° before extending | 77–88° on 3 of 4 (one at 142°: no chamber) | **Yes**: a knee that never bends below ~100° means no chamber |
| Little hip rotation | Expert data | Hips 5–7° | 21–25° | Yes |
| Leg extends forward | — | Foot about hip height | Mostly below hip | Yes, but depth-limited |

## Reliability problems found in this log

1. **Left/right label flips during rotation.** Hip and shoulder yaw jumped by 120–180° in a single frame. This needs a guard before any rotation check: unwrap the angle and reject jumps the body can't physically make in 1/30 s.
2. **Tracking during kicks** is worse than during punches: the kicking ankle's visibility goes down to 0.37–0.67, and the user went out of frame once.
3. **The rear wrist is hidden behind the jabbing arm** for part of each jab at 30°. A "rear hand dropped" fault is only reported when the wrist's visibility is high.

## Sources

- [Gavagan & Sayers 2017, roundhouse kick in Muay Thai, karate and taekwondo (PLoS ONE)](https://pmc.ncbi.nlm.nih.gov/articles/PMC5571909/)
- [Dinu & Louis 2020, punch biomechanics in elite and junior boxers (Frontiers)](https://frontiersin.org/journals/sports-and-active-living/articles/10.3389/fspor.2020.598861/full)
- [University of Lincoln, review of punching biomechanics](https://sas.blogs.lincoln.ac.uk/?p=1295)
- [Electromyographic and kinematic trunk analysis during the straight punch](https://www.sponet.de/sponet/Record/4017632?lng=en)
- [3D kinematic analysis of three punches in amateur boxing (METU thesis)](https://open.metu.edu.tr/handle/11511/21166)
- [Supporting leg in Muay Thai beginners' roundhouse kick](https://he01.tci-thaijo.org/index.php/JSST/article/view/215734)
- [Lower-limb asymmetry in Muay Thai novices' roundhouse kick](https://ir.upsi.edu.my/detailsg.php?det=4034)
- [Piorkowski et al. 2011, punch kinematics](https://clok.uclan.ac.uk/3757/1/piorkowski-et-al-2011-punch-kinematics.pdf)
- [ACCAD motion capture (CC BY 3.0)](https://accad.osu.edu/research/motion-lab/mocap-system-and-data)
