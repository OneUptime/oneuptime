# App Platforms: an App Service app's Overview (#6770)

The real `CloudAppOverviewTab` (Dashboard `Components/AppPlatforms`), rendered with the
Dashboard's esbuild config, Tailwind runtime, Theme.css and Inter, at 2x. Its reads (span
and metric aggregates, the site look-up) were answered from memory with fixed data:

- `app-sends-only-metrics-*`: the app from the issue. It sends metrics only, names no
  instance or version, and its Azure subscription is not connected.
- `subscription-connected-*`: the same app after its subscription is connected, with its
  site found under it (also in dark mode and in German).
- `healthy-app-1280-light`: an app that sends traces and names its instances and version,
  with its site connected. It has no Setup check.
