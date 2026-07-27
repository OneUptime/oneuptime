import { loader } from "@monaco-editor/react";

/**
 * Points Monaco at the copy of its runtime that ships with the app.
 *
 * @monaco-editor/loader otherwise fetches it from cdn.jsdelivr.net at runtime,
 * which never resolves on an air-gapped install and leaves every code editor
 * stuck on "Loading...". The path is baked in by the build, which is the only
 * place that knows where this service is mounted.
 *
 * The monaco-editor version in Common/package.json stays pinned to the exact
 * one @monaco-editor/loader would have fetched. The loader resolves init() with
 * whatever the AMD module `vs/editor/editor.main` exports, and that shape is
 * not stable across Monaco releases - 0.53 and 0.54 nest the API under
 * `exports.m`, so serving one of those against a loader that does not unwrap it
 * leaves `monaco.editor` undefined and every editor throws instead of mounting.
 * Serving the build the loader was written against sidesteps the question, and
 * MonacoRuntime.test.ts fails if the two ever drift apart.
 */
export default function configureMonacoLoader(): void {
  const assetPath: string | undefined = process.env["MONACO_ASSET_PATH"];

  if (!assetPath) {
    return;
  }

  loader.config({
    paths: {
      vs: assetPath,
    },
  });
}
