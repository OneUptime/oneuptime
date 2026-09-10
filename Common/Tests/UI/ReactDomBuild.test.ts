import { describe, expect, test } from "@jest/globals";
import childProcess from "child_process";
import path from "path";

const COMMON_ROOT: string = path.resolve(__dirname, "..", "..");

interface RendererBuild {
  rendererFiles: Array<string>;
  clientFiles: Array<string>;
  foreignRendererFiles: Array<string>;
  outputBytes: number;
}

describe("frontend renderer deduplication", () => {
  test.each(["production", "development"])(
    "bundles one renderer for the entry point and shared portals in %s",
    (environment: string) => {
      // Use a subprocess because esbuild requires Node's native Uint8Array.
      // Separate physical installs reproduce the app/Common package layout;
      // symlinking both to one install would hide the original duplication.
      const result: RendererBuild = JSON.parse(
        childProcess.execFileSync(
          process.execPath,
          [
            "-e",
            String.raw`
              const fs = require("fs");
              const os = require("os");
              const path = require("path");
              const esbuild = require("esbuild");
              const { createConfig } = require("./UI/esbuild-config");
              const reactDomRoot = path.dirname(require.resolve("react-dom/package.json"));
              const root = fs.mkdtempSync(path.join(os.tmpdir(), "oneuptime-renderer-"));

              async function run() {
                try {
                  for (const name of ["app", "shared"]) {
                    const destination = path.join(root, name, "node_modules/react-dom");
                    fs.cpSync(reactDomRoot, destination, { recursive: true });
                  }

                  const entry = path.join(root, "app/index.js");
                  fs.writeFileSync(entry, [
                    'import { createRoot } from "react-dom/client";',
                    'export { createRoot };',
                    'export { createPortal, flushSync } from "../shared/index.js";',
                  ].join("\n"));
                  fs.writeFileSync(path.join(root, "shared/index.js"),
                    'export { createPortal, flushSync } from "react-dom";');

                  const config = createConfig({
                    serviceName: "Dashboard",
                    publicPath: "/dashboard/dist/",
                    entryPoint: entry,
                    outdir: path.join(root, "dist"),
                  });
                  const built = await esbuild.build({
                    ...config,
                    nodePaths: [path.resolve("node_modules")],
                    metafile: true,
                    write: false,
                    logLevel: "silent",
                  });
                  const inputs = Object.keys(built.metafile.inputs);
                  const rendererFiles = inputs.filter((file) =>
                    /react-dom[/\\]cjs[/\\]react-dom\.(production\.min|development)\.js$/.test(file));
                  const clientFiles = inputs.filter((file) => /react-dom[/\\]client\.js$/.test(file));
                  const foreignRendererFiles = inputs.filter((file) =>
                    path.resolve(file).startsWith(root) && file.includes("react-dom"));
                  console.log(JSON.stringify({
                    rendererFiles,
                    clientFiles,
                    foreignRendererFiles,
                    outputBytes: built.outputFiles.reduce((sum, file) => sum + file.contents.length, 0),
                  }));
                } finally {
                  fs.rmSync(root, { recursive: true, force: true });
                }
              }
              run().catch((error) => { console.error(error); process.exitCode = 1; });
            `,
          ],
          {
            cwd: COMMON_ROOT,
            env: { ...process.env, NODE_ENV: environment },
            encoding: "utf8",
          },
        ),
      ) as RendererBuild;

      expect(result.outputBytes).toBeGreaterThan(0);
      expect(result.rendererFiles).toHaveLength(1);
      expect(result.rendererFiles[0]).toContain(
        environment === "production"
          ? "react-dom.production.min.js"
          : "react-dom.development.js",
      );
      expect(result.clientFiles).toHaveLength(1);
      expect(result.foreignRendererFiles).toEqual([]);
    },
  );
});
