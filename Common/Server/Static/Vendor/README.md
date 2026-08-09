# Vendored browser assets

Third-party browser assets that server-rendered OneUptime pages used to pull
from a public CDN. They live here, in the repo, because a self-hosted install
is not guaranteed to have outbound internet access - and when it does not, a
CDN `<script>` does not degrade, it hangs. See
https://github.com/OneUptime/oneuptime/issues/2570.

Every service mounts this directory read-only at `/oneuptime-assets` (see
`Common/Server/Utils/VendorAssets.ts`). Reference the files from a view by that
absolute path, never by a CDN URL - `Common/Tests/Server/Utils/OfflineAssets.test.ts`
fails the build on a CDN URL in any `.ejs` under `Common/Server/Views`,
`App/FeatureSet/*/{Views,views}` or `Home/Views`.

## Contents

| Path                       | Source                                                      |
| -------------------------- | ----------------------------------------------------------- |
| `tailwind/tailwind-3.4.5.js` | Tailwind Play CDN build 3.4.5                              |
| `highlight/`               | highlight.js 11.11.1, from cdnjs                             |
| `fonts/InterVariable.woff2` | Inter variable font, byte-identical to the copies under `App/FeatureSet/{Docs,APIReference}/Static/fonts/` |

The Tailwind file is the **only** copy in the tree. The five frontends used to
commit one each; `Common/UI/esbuild-config.js` now copies this one into each
`public/assets/js/` at build time, next to where it already copies Monaco, and
the built copies are gitignored. Their `index.ejs` still loads it from their own
prefix (`/dashboard/assets/js/...`) rather than through `/oneuptime-assets` - the
URLs did not change, only where the bytes come from.

Renaming it means editing five `index.ejs` files to match, so the version stays
in the filename and `TAILWIND_FILENAME` in the esbuild config.

Mermaid is not vendored here. It is already a dependency of `Common`, so
`VendorAssets.ts` serves `node_modules/mermaid/dist` at
`/oneuptime-assets/mermaid` instead - one version to keep current rather than
two, and none of the ~8 MB of lazily-loaded diagram chunks in git.

## Refreshing highlight.js

`highlight/languages` holds exactly the grammars the views ask for; the core
bundle already carries the rest of the common set. Adding a language to a view's
`langMap` means adding the matching file here, or that language silently stops
highlighting offline.

```bash
BASE="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1"
DEST="Common/Server/Static/Vendor/highlight"

curl -sSfL "$BASE/highlight.min.js" -o "$DEST/highlight.min.js"

for style in vs2015 github-dark; do
  curl -sSfL "$BASE/styles/$style.min.css" -o "$DEST/styles/$style.min.css"
done

for language in $(ls "$DEST/languages" | sed 's/\.min\.js$//'); do
  curl -sSfL "$BASE/languages/$language.min.js" -o "$DEST/languages/$language.min.js"
done
```

Note that `hcl`/`terraform` is deliberately absent: highlight.js has never
shipped that grammar, so the request 404'd against the CDN too.
