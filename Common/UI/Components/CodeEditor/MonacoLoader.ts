import { loader } from "@monaco-editor/react";

/**
 * Points Monaco at the copy of its runtime that ships with the app.
 *
 * @monaco-editor/loader otherwise fetches it from cdn.jsdelivr.net at runtime,
 * which never resolves on an air-gapped install and leaves every code editor
 * stuck on "Loading...". The path is baked in by the build, which is the only
 * place that knows where this service is mounted.
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
