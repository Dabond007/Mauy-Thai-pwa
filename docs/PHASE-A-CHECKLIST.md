# Phase A — on-device checklist (Pixel 9, Chrome)

Spec §12.3 / §13. Turn on **Settings → Debug overlay → On** (or open the app with `?debug=1`) before you start. Write down what you see in each step: what you tested, what happened, and the debug numbers if something looked wrong.

Before testing, open the app once while online. On the update toast, tap **Refresh** so the new version loads.

## 1. Framing check (Home → Start)

Prop the phone up in portrait at about waist height.

| Try this | Expect |
|---|---|
| Stand about 3 m back, centred | Chip turns **Good to go**, the progress bar fills, then the app moves on |
| Stand close, with your feet out of the picture | Red, "Step back until I can see your feet" |
| Stand too far back (about 4.5 m or more) | Amber, "Come a little closer" |
| Stand off to one side | "Move a little to your left/right". The direction should be right **as you see yourself on screen** |
| Turn side-on to the phone | "Face the phone" |
| Dim the room | "More light would help" after about 2 s |

Spoken tips should come at most once every 5 s.

## 2. Calibration (Home → Calibrate)

1. **Raise your left hand.** Afterwards, the debug labels on your wrists should read **L** on your real left hand and **R** on your right. Check this by raising each hand. *This is the main left/right check.*
2. **Stance.** Hold still with your hands up. The app should say the correct foot is forward. Note whether it was right first time. Repeat in the other stance if you want to check southpaw.
3. **Three slow jabs.** You should hear a tone on each jab. Reach is then about 1.3–1.7 shoulder widths (shown on the summary screen).

## 3. Out of frame (Home → Start → stance check)

| Try this | Expect |
|---|---|
| Walk fully out of the picture, 10 times | Each time: "Out of frame", the timer freezes and the outline appears. Come back: "Back in frame", then 3-2-1 beeps, then the timer resumes |
| Throw 20 fast punches in your stance | **No** "Out of frame" |
| Throw a few fast kicks | **No** "Out of frame" |
| Stay in your stance for the full minute | The summary shows 0 times out of frame |

Note how many of the 10 walk-outs worked, and whether anything fired by mistake.

## 4. Airplane mode

Open the app once online. Then turn on airplane mode, close the app completely, and reopen it. Home, Start and the camera should all still work.

## 5. Model benchmark

With the debug overlay on, note the `fps` and `infer` numbers during the stance check. Then switch **Settings → Pose model → Heavy** and check again. Heavy should only be kept if it holds 25+ fps.

## Also useful

- Voice: does it ever talk over itself, cut out, or go silent?
- Does the skeleton line up with your body on screen?
- The debug lines `guard Δ`, `elbow` and `lean`: do the numbers move sensibly when you drop your hands, straighten an arm, or lean back?
