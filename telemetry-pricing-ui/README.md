# Telemetry pricing UI screenshots

These screenshots render the actual telemetry notice returned by `getTelemetryPayAsYouGoFormFields()` with the repository's Tailwind styles. The local preview supplies a Free plan project with billing enabled. No component markup is recreated.

- `desktop.png`: 720 × 349 viewport, with the notice at a modal-sized 480px width.
- `mobile.png`: 375 × 385 viewport.

The preview was also checked at 320px. All three widths fit without clipping or horizontal overflow. The pricing link is reachable with the keyboard and has a visible focus ring.

The preview is isolated from the app server. These images show the production notice, not a completed full-app ingestion key creation flow.
