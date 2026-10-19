# FujiXCraft (Recipe Lab)

A Mac app that uses your Fujifilm camera as the render engine. It sends a RAW to
the camera over USB, the camera's own processor renders it with any film
simulation recipe, and the full-size JPEG comes back in about 1.5–3 seconds.

Tested on an X100V, firmware 3.01.

## Use

1. Camera: **Menu → Set Up → Connection Setting → PC Connection Mode → USB RAW CONV./BACKUP RESTORE**, then plug it in.
2. Quit X RAW Studio, X Acquire and the Fuji X Weekly app (only one app can hold the camera).
3. `npm install`, then `npm run dev`.
4. Click **Connect camera**, then open or drop an X100V `.RAF`.

- **Single** view: pick a recipe and edit it. Every change re-renders on the camera. Hold `\` to see the as-shot render.
- **Compare**: tick recipes in the library to render them side by side.
- **Paste recipe**: paste settings text from Fuji X Weekly.
- Renders are cached in a temporary folder while the app is open and deleted on quit.
  Only **Export full-size JPEG** saves a photo. Saved recipes live in
  `~/Library/Application Support/recipe-lab/recipes.json`.

## Known camera behaviour

- The camera only converts RAWs from its own model.
- **Never request TIFF output from an X100V.** It stops responding until it's
  power-cycled. TIFF export is only offered on X-Processor 5 bodies.
- DR200 needs ISO 320+ and DR400 needs ISO 640+. Over USB the camera accepts
  higher settings but renders a heavy green cast, so the app clamps dynamic
  range to the RAW's ISO and marks the render.
- A full recipe takes about 2.4 s of camera time against 1 s as shot. Clarity is
  the likely cause (it slows in-camera processing too), but that isn't measured yet.

## Credits

- The PTP protocol, profile field layout and recipe text parser are adapted from
  [FilmKit](https://github.com/eggricesoy/filmkit), MIT License, Copyright (c) 2026 eggricesoy.
- The protocol work builds on [rawji](https://github.com/pinpox/rawji),
  [fudge](https://github.com/petabyt/fudge) and libgphoto2.
- The built-in recipes are from [Fuji X Weekly](https://fujixweekly.com) by Ritchie Roesch.
