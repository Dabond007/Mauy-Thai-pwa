# Self-hosted MediaPipe

Served from the app's own origin so the app works offline and makes no
third-party requests (spec §7.1, §10).

| File | Source |
|---|---|
| `vision_bundle.mjs` | npm `@mediapipe/tasks-vision@0.10.35` |
| `wasm/vision_wasm_internal.js` | same package (SIMD build) |
| `wasm/vision_wasm_internal.wasm` | same package (SIMD build) |
| `models/pose_landmarker_full.task` | `storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/` |
| `models/pose_landmarker_heavy.task` | `storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/` |

License: Apache-2.0 (Google MediaPipe).

SHA-256:

```
5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1  models/pose_landmarker_full.task
64437af838a65d18e5ba7a0d39b465540069bc8aae8308de3e318aad31fcbc7b  models/pose_landmarker_heavy.task
e7fd9858e8e8f221d9b96eddc11f8e077f263e0b7bbd79d3cbe882b134274f8c  wasm/vision_wasm_internal.js
6a5c64584c2ab61c763b6e204afbdbc7ce1caf7f5216187322bca8df94f646bc  wasm/vision_wasm_internal.wasm
```

To upgrade: replace the files from a newer package version, update this table,
and bump `CACHE_VERSION` in `sw.js`.
