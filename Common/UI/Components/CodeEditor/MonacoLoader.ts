import { loader } from "@monaco-editor/react";

/**
 * Points Monaco at the copy of its runtime that ships with the app.
 *
 * @monaco-editor/loader otherwise fetches it from cdn.jsdelivr.net at runtime,
 * which never resolves on an air-gapped install and leaves every code editor
 * stuck on "Loading...". The path is baked in by the build, which is the only
 * place that knows where this service is mounted.
 *
 * The path has to be absolute. Monaco loads its language services in a worker
 * spun up from a blob: URL, and a blob worker has no base to resolve a
 * root-relative path against - it fetches "/dashboard/assets/monaco/vs/..." and
 * throws "Failed to parse URL". The editor still renders, so the only visible
 * symptom is that JSON/TypeScript validation and IntelliSense quietly stop
 * working. The CDN default never hit this because it was already absolute.
 *
 * The monaco-editor version in Common/package.json is pinned exactly, because
 * the loader resolves init() with whatever the AMD module `vs/editor/editor.main`
 * exports and that shape is not stable across releases - 0.53 and 0.54 nest the
 * API under `exports.m`, which leaves `monaco.editor` undefined and makes every
 * editor throw instead of mount. MonacoRuntime.test.ts guards the pin.
 */
export default function configureMonacoLoader(): void {
  const assetPath: string | undefined = process.env["MONACO_ASSET_PATH"];

  if (!assetPath) {
    return;
  }

  loader.config({
    paths: {
      vs: new URL(assetPath, window.location.origin).href,
    },
  });
}
