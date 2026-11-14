# Docs screenshots

The screenshots in the docs, drawn from the real Dashboard pages of this branch by the offline
fixtures, in all 17 docs languages (#6823). A German reader following German steps sees German
buttons. One command draws them again, with no server running:

```bash
cd packages/E2E
npm install --ignore-scripts
npm run docs-screens
```

It starts the fixtures it needs on ports of their own (6823 and 6824), so a fixture another
suite left running is never reused. It opens each shot's page, does its steps by the words on
screen, and draws it. It rewrites only the shots whose page changed, so an unchanged shot keeps
its file byte for byte and the history does not grow with each run. Then it writes the manifest
the docs read and prints what it wrote and what the pictures weigh.

| Variable | What it does |
| --- | --- |
| `DOCS_SCREENS_ONLY=a,b` | Draws only these shots. |
| `DOCS_SCREENS_LANGUAGES=en,de` | Draws only these languages. |
| `DOCS_SCREENS_FORCE=1` | Writes every picture, changed or not: after a change to the crop or the ring, which the fingerprint does not see. |
| `DOCS_SCREENS_WORKERS=1` | Draws one language at a time (two by default). |

## Where things are

| What | Where |
| --- | --- |
| The shot list: each shot's fixture, page, state, width, crop and ring | `packages/App/FeatureSet/Docs/Screens/DocsScreenList.ts` |
| File names, the English fallback, the manifest | `packages/App/FeatureSet/Docs/Screens/DocsScreenFiles.ts` |
| The fingerprint, and the staleness issue's text | `packages/App/FeatureSet/Docs/Screens/DocsScreenFingerprint.ts` |
| The pictures | `packages/App/FeatureSet/Docs/Static/images/screens/<language>/<shot>.webp` |
| The manifest: each shot's size in each language it is drawn in | `packages/App/FeatureSet/Docs/Static/images/screens/manifest.json` |
| Each picture's fingerprint | `packages/E2E/DocsScreens/Fingerprints/<language>.json` |
| The renderer | `DocsScreens.spec.ts` (a test per language), `ScreenDriver.ts` (the steps, the fingerprint and the crop) |
| The staleness issue | `ReportStale.js`, run by `.github/workflows/docs-screens.yml` |

## Showing a shot on a docs page

A docs page names the shot as the address of a Markdown image, with alt text written in the
page's own language:

```markdown
### Enter the address

![The step "What should we check?", with "Start checking" ringed](screen:website-down-address)

Under **What should we check?**, type the address...
```

Put the picture on the first line under the step's heading, as the guides do. Every translation
keeps the same `screen:` address on the same line, and writes its own alt text. The docs show
the picture in the language the page is written in, or the English one when the shot's fixture
cannot draw that language. They also set its width and height, so the page does not jump as it
loads (`Docs/Utils/Render.ts`).

The docs tests hold this:

- `images`: a `screen:` image names a shot that has an English picture;
- `screenAlt`: every screenshot has alt text, and no translation copies the English;
- `DocsScreenList.test.ts`: every shot on the list is shown by a page in every language, every
  screenshot a page shows is on the list, and every shot names a fixture and a Dashboard page
  that exist;
- `DocsScreenFiles.test.ts`: the pictures, the manifest and the fingerprints agree, and stay
  within the weight below.

## Adding a shot

1. Add it to `DOCS_SCREENS` in `DocsScreenList.ts`. Give it a fixture, the page by its
   `PageMap` key and its `RouteMap` address, the state to reach (the Dashboard's English words,
   as `Journeys/Journey.ts` writes a journey's steps), a width, a crop (a CSS selector, as tight
   as the card that matters) and the button to ring. A shot whose state starts with all of the
   previous shot's goes on from that page instead of opening it again, so list a guided
   setup's steps in order.
2. Run `DOCS_SCREENS_ONLY=<name> DOCS_SCREENS_LANGUAGES=en npm run docs-screens` and look at
   the picture. Then run it again with every language.
3. Show it on a page in all 17 languages, as above.

A guide that #6821 left as a follow-up gets its shots the same way: listing them, then one
line under each of its steps.

Most shots use the journeys fixture (`Journeys/`). It builds the whole Dashboard from this
branch over a project made a minute ago, and loads every Dashboard language through the
Dashboard's own locale loader: the docs screens set the language where the Dashboard keeps it
(`oneuptimeLang`). The incident shots use the event overview fixture, told by `?lang=`. A
fixture that loads only some languages lists them in `languages`, and the rest show its English
picture.

## Is a shot still current?

When a picture is drawn, its fingerprint is kept beside it: its words block by block (the
browser's `innerText`, which does not depend on where a line wraps), what its fields hold, the
order of its headings, buttons and fields, and its size. `npm run docs-screens:check` draws every
shot again and compares, without writing anything in the repository. A shot is stale when its
words or its outline changed, or its size moved by more than 10% (and 16 pixels).

Why not pixels? The same page draws different pixels on a Mac and on a Linux runner: fonts are
rasterized differently, and Chinese, Japanese, Korean and Hindi are drawn in different fallback
fonts. A pixel comparison would call every shot stale, or, loosened until it passes, miss a
renamed button. Words, outline and size give the same answer on any machine, and change when the
page a reader sees changes.

The Docs Screenshots workflow (`.github/workflows/docs-screens.yml`) runs the check every night,
when the shots or their list change on main, and by hand. It never runs on a pull request and
never fails for a stale shot. Instead it opens, or rewrites, one issue titled
**Docs screenshots are out of date**. The issue lists each stale shot with its languages and
why, and any shot that could not be drawn. The workflow closes the issue once every shot is
current again. To fix the shots, run `npm run docs-screens` and commit what it changes.

## What they weigh

Drawn at twice their CSS size and encoded by Chromium as WebP (quality 0.8), so text stays sharp
on a high-density screen. Measured on 2026-11-12, with 19 shots in 17 languages (323 pictures):

| | |
| --- | --- |
| Pictures | 323, from 17 KB to 114 KB, 48 KB on average |
| Added to the repository and to the docs in the App image | 15.2 MB of pictures and a 22 KB manifest |
| Added to the repository only | 0.3 MB of fingerprints (`packages/E2E` is not in the App image) |
| The same crop as PNG at the same ratio | about 2.4 times as much (95 KB against 40 KB on the shot measured first) |

That is well under 0.1% of a clone, and a docs page loads only its own pictures, lazily.
`DocsScreenFiles.test.ts` fails a picture over 200 KB (a crop too loose) and a total over 24 MB.
If the total ever becomes a problem, the pictures can move to release assets, with the manifest
pointing at them.
