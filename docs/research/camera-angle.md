# Camera angle: what motion capture says (October 2026)

## Question

Should the phone face the user straight on (spec §3.1), or sit at an angle to the direction they strike? On-device logs showed that a jab thrown straight at the phone barely registers. The 3D reach moved 0.05–0.15 shoulder widths, and a straight arm read as 125–135° at the elbow. When the user turned slightly, jabs were detected.

## Method

`tools/mocap/` takes expert motion capture of each technique: the ACCAD Male2 martial arts set, one performer, karate style (CC BY 3.0). It places a virtual portrait phone 3 m away at waist height, at angles from 0° to 60° off the strike's target direction. Positive angles put the phone on the fighter's **rear-hand side**; −30° is the lead-hand side. For each move and angle it reports:

- **Visible %**: the share of the strike's movement that travels across the picture rather than toward the camera. Pose detection measures movement across the picture well and movement toward the camera poorly. This is the main measure.
- **2D angle at peak**: how bent the elbow (punches) or knee (kicks) looks in the picture at full extension, compared with the true 3D angle.
- **Hidden**: the share of the movement during which a wrist, elbow, knee or ankle is behind the torso, as seen by the phone.

This is geometry from perfect 3D data. It does not include MediaPipe's own errors, so the angle-test logs from the phone are still needed.

## Results

### Straight punches: the angle matters a lot

| Move (file) | −30° | 0° | 15° | 30° | 45° | 60° |
|---|---|---|---|---|---|---|
| Jab, orthodox (E1): visible % | 64 | **32** | 33 | 49 | 67 | 82 |
| Jab, southpaw (E2): visible % | 58 | **28** | 35 | 53 | 71 | 86 |
| Cross, southpaw (E3): visible % | 34 | **22** | 45 | 66 | 83 | 95 |
| Cross, orthodox (E4): visible % | 37 | **20** | 42 | 64 | 81 | 94 |

Elbow angle seen at full extension (true 3D angle in brackets):

| Move | 0° | 15° | 30° | 45° | 60° |
|---|---|---|---|---|---|
| Jab E1 (136°) | 26° | 88° | 120° | 133° | 139° |
| Jab E2 (123°) | 19° | 67° | 101° | 119° | 127° |
| Cross E3 (140°) | 26° | 57° | 125° | 145° | 152° |
| Cross E4 (122°) | 11° | 42° | 118° | 141° | 149° |

Straight on, an extended arm looks almost fully bent in the picture: 11–26°, against a true 122–140°. This matches the on-device logs. At 30° the picture gets close to the true angle, and at 45° it matches.

### Uppercuts and kicks: fine from any angle

| Move | 0° | 30° | 45° | 60° |
|---|---|---|---|---|
| Uppercut (E7/E8): visible % | 94–95 | 97 | 98–99 | 99–100 |
| Teep / push kick (G17/G18): visible % | 69 | 72–74 | 79–82 | 88–90 |
| Rear roundhouse (G8/G9): visible % | 70–73 | 80–81 | 88 | 94–95 |
| Rear body roundhouse (G14/G15): visible % | 66–67 | 77–78 | 86–87 | 93–94 |
| Lead roundhouse (G10): visible % | 95 | 94 | 95 | 96 |
| Front kick (G3): visible % | 86 | 87 | 90 | 94 |

Kicks and uppercuts move largely upward or sideways, so most of the movement is visible at every angle. Teeps gain the most from turning: 69% visible straight on, about 80% at 45°.

### What gets hidden on the rear-hand side

- Up to 45°, little is hidden. The lead elbow is behind the torso for at most 10–40% of a cross or body kick.
- At 60°, the lead elbow is hidden for 60–77% of rear roundhouse kicks. The extra visibility over 45° is small and the hidden limbs grow, so 60° is past the useful range.
- The lead hook hides the rear arm (30–82% of the movement) at every angle, because the body turns away. Hooks will need the "unknown" handling the spec already has for low-confidence checks.

### Lead-hand side or rear-hand side?

At −30° (lead-hand side), jabs show more (58–64%) but crosses much less (34–37%) than at +30° (jabs 49–53%, crosses 64–66%). The rear-hand side also keeps the chest and both gloves facing the phone, which the guard checks need. The rear-hand side is the better overall choice.

## Conclusion

1. **Straight on is the worst placement** for jab, cross and teep, which are the techniques beginners learn first.
2. **Recommended: about 45° on the rear-hand side.** Jab and cross are 67–83% visible, the elbow angle seen matches the true angle, kicks are 79–88% visible, and little is hidden.
3. **30° is an acceptable fallback** for small rooms: about half the punch is visible, and the elbow angle reads within about 20°.
4. Avoid 60° and beyond: little extra is gained, and more limbs are hidden.

Caveats:
- One karate performer. A Muay Thai stance is squarer, which turns the chest further toward a rear-side phone; if anything, that helps.
- Perfect 3D data. MediaPipe's real errors at each angle can only come from the phone.
- The **angle-test logs (30° and 45°)** are the deciding evidence before the spec's placement section (§3.1) and framing check (§3.3) change.

Data: [ACCAD Open Motion Project](https://accad.osu.edu/research/motion-lab/mocap-system-and-data), The Ohio State University, CC BY 3.0.
