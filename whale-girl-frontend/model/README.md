# Whale Girl — Live2D model assets

Drop a Cubism 4.x-format export here so that the model settings file sits at:

    whale-girl-frontend/model/whale.model3.json

Expected siblings (as referenced by the "FileReferences" section of the
.model3.json — names below are examples, they must match the JSON exactly):

    whale.model3.json
    whale.moc3
    textures/            (1024 or 2048 px textures)
    whale.physics3.json  (optional, physics is not required to render)
    motions/*.motion3.json
    expressions/*.exp3.json

Notes
- The frontend uses pixi-live2d-display 0.4.0, which embeds the Cubism 4
  runtime (Cubism SDK for Web 4.x). Export from Live2D Cubism Editor with
  the Cubism 4.x runtime target.
- If the asset is missing or invalid, the frontend falls back to a
  placeholder whale — the page never crashes, which keeps OBS stable.
- This folder is git-ignored (except this file): model files are large and
  licensed, so they stay out of version control.
