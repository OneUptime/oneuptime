# Source Maps

## Overview

Production front-end bundles are minified, so a browser exception captured through the OpenTelemetry web SDK arrives with stack frames like:

```
TypeError: Cannot read properties of undefined (reading 'id')
    at e.onSelect (https://app.example.com/assets/main.a8f1b2.js:1:48291)
```

Upload your build's source maps to OneUptime and the Exceptions dashboard resolves those frames back to the original file, line, function name — and, when the map was built with `sourcesContent`, the surrounding lines of your original source.

Maps are uploaded to OneUptime over an authenticated API and are **never fetched from your site**, so you can (and should) keep building with `hidden-source-map` (webpack) or `sourcemap: 'hidden'` (Vite / Rollup) and never publish the `.map` files next to your bundles.

## How matching works

A source map is stored against three keys:

| Key | Must match |
|---|---|
| Service name | The `service.name` OpenTelemetry resource attribute your web app sends telemetry with |
| Service version | The `service.version` resource attribute (your release identifier) |
| Bundle path | The minified file the map was generated for, e.g. `main.a8f1b2.js` |

When you open an exception, OneUptime looks up the maps uploaded for that exception's service and release, matches each stack frame to a bundle by file name (path suffixes are fine — `main.a8f1b2.js` matches `https://app.example.com/assets/main.a8f1b2.js`), and resolves the minified line and column through the map. Resolution happens lazily when the exception is viewed, never on the ingestion path — so a map uploaded a few minutes *after* the first error of a new release still applies retroactively.

This means your web app must send `service.version` with its telemetry:

```javascript
import { Resource } from "@opentelemetry/resources";

const resource = new Resource({
  "service.name": "my-web-app",
  "service.version": "1.4.2", // same value you upload maps with
});
```

Any stable release identifier works — a semantic version, a git commit SHA, a build number — as long as the uploaded `serviceVersion` and the `service.version` resource attribute are the same string.

## Uploading source maps

Upload from CI after each production build, using a **Telemetry Ingestion Key** (_Project Settings → Telemetry Ingestion Keys_) for authentication:

```bash
curl --fail -X POST "https://oneuptime.com/source-maps/v1/upload" \
  -H "x-oneuptime-token: YOUR_TELEMETRY_INGESTION_KEY" \
  -F "serviceName=my-web-app" \
  -F "serviceVersion=1.4.2" \
  -F "sourcemap=@dist/assets/main.a8f1b2.js.map" \
  -F "sourcemap=@dist/assets/vendor.9c3d4e.js.map"
```

For self-hosted installations, replace `oneuptime.com` with your OneUptime host. `Authorization: Bearer YOUR_KEY` is accepted as an alternative to the `x-oneuptime-token` header.

Details:

- Each uploaded file's bundle path is its file name with the trailing `.map` stripped — `main.a8f1b2.js.map` becomes `main.a8f1b2.js`. If your map file name does not follow that convention, upload one file per request and pass an explicit `bundlePath` field.
- Re-uploading the same bundle for the same service and version replaces the previous map, so CI retries are safe.
- Each `.map` file may be up to 50 MB. Up to 100 maps can be uploaded per request, and files must be [source map v3](https://tc39.es/ecma426/) JSON (which is what every modern bundler emits).
- Build with `sourcesContent` included (the default for most bundlers) to get original source snippets around each resolved frame in the dashboard.

A typical CI step uploads every map the build emitted:

```bash
VERSION="$(git rev-parse --short HEAD)"

find dist -name "*.js.map" -print0 | while IFS= read -r -d '' map; do
  curl --fail -X POST "https://oneuptime.com/source-maps/v1/upload" \
    -H "x-oneuptime-token: $ONEUPTIME_INGESTION_KEY" \
    -F "serviceName=my-web-app" \
    -F "serviceVersion=$VERSION" \
    -F "sourcemap=@$map"
done
```

## Viewing resolved stack traces

Open any exception under **Exceptions** in the dashboard. Frames that were resolved through a source map show a **MAPPED** badge and display the original function name and file location; expanding a frame shows the original source snippet (when the map carries `sourcesContent`) alongside the minified location.

Uploaded maps for a service can be reviewed and deleted under **Resources → Services → your service → Source Maps**.

## Retention

Source maps are kept for 90 days after upload, then deleted automatically. A map is only useful while exceptions from its release are within your telemetry retention window, so this comfortably outlives the exceptions it unminifies. Re-upload maps for a release if you need them again.

## Security

- Maps are uploaded over an authenticated endpoint and stored in your OneUptime project — they are never fetched from your website, so hidden source maps stay hidden.
- The raw map content (which includes your original source when built with `sourcesContent`) can only be read back by project owners and admins. Other team members see just the resolved frames and the few source lines around each crash site of exceptions they already have access to.
- Deleting a service deletes its source maps.
