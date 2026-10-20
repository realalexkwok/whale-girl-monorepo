# Whale Girl — Live2D model assets

The model settings file must sit at:

    whale-girl-frontend/model/whale.model3.json

## Drop in the DS鲸鱼娘 (DeepSeek whale girl)

Source: dsh-pet-live2d@3.1.3, folder `pets/ds-whale-girl/` (npm package or
https://github.com/A8Chann/dsh-pet-live2d). Commands:

    curl -sL https://registry.npmjs.org/dsh-pet-live2d/-/dsh-pet-live2d-3.1.3.tgz -o /tmp/dsh-pet.tgz
    tar -xzf /tmp/dsh-pet.tgz -C /tmp
    mkdir -p whale-girl-frontend/model
    cp -R /tmp/package/pets/ds-whale-girl/* whale-girl-frontend/model/
    mv whale-girl-frontend/model/c_0120.model3.json whale-girl-frontend/model/whale.model3.json

Rename ONLY the settings file: the "FileReferences" paths are relative to it, so
`model/`, `textures/`, `motions/` and `expressions/` keep their names and layout.

## Files this model references (minimum set)

    whale.model3.json
    model/c_0120.moc3
    model/c_0120.physics3.json
    model/c_0120.cdi3.json
    textures/texture_00.png, texture_01.png
    motions/*.motion3.json     (8 motions: Idle, Hammer, BubbleGum, ...)
    expressions/*.exp3.json    (44 expressions)

The DSH-plugin extras (pet.json, catalog.json, voice.json, previews/,
安装说明.md) are host metadata for the dsh-pet-live2d plugin and are NOT
consumed by this frontend — keep or delete them freely.

## Validate before opening the page

    cd whale-girl-server && node scripts/validate_model.js

Checks: the settings file parses, Version ≤ 4, every FileReferences path
exists, the moc3 header version is ≤ 4; prints the referenced size. A non-zero
exit code means "fix the paths or re-export for Cubism 4.x".

## Constraints

- pixi-live2d-display 0.4.0 embeds the Cubism 4 runtime: models exported for
  Cubism 2.1/3/4 load; Cubism 5-only exports do not — re-export the asset with
  the Cubism 4.x runtime target.
- If the asset is missing or invalid, the page falls back to the placeholder
  whale and logs exactly ONE console error (OBS keeps running).
- This folder is git-ignored except this README: model files are large and
  licensed, so they stay out of version control.

## License (DS鲸鱼娘)

CC BY-NC-SA 4.0 — attribution, non-commercial, share-alike. Copyright chain:
上善无形 (original character 「溟月」, pixiv 62155430) → ZipZipPipe (DeepSeek
maid redesign, pixiv 18604994) → 氵六青 (Live2D rigging, bilibili 11272072).
Keep the bundled LICENSE file. Commercial use requires each author's separate
permission. The Cubism Core runtime (live2dcubismcore.min.js) is Live2D Inc.
proprietary software loaded from the official CDN — it is not shipped here.
