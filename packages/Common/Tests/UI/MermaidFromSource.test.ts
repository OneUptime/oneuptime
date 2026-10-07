import { describe, expect, test } from "@jest/globals";
import childProcess from "child_process";
import fs from "fs";
import path from "path";
import {
  MERMAID_BROWSER_ENTRY,
  MERMAID_SOURCE_PLUGIN_NAME,
  isPrebuiltMermaidBundle,
} from "../../UI/esbuild-mermaid";

/*
 * Every diagram OneUptime draws runs mermaid built from its ES module source
 * (UI/esbuild-mermaid.js), so katex and mermaid's other dependencies are the
 * copies npm installed - the ones Common's overrides and npm audit apply to.
 * mermaid's prebuilt bundles each embed their own copies, and none of them
 * may be bundled or served.
 *
 * The builds run in a node subprocess, the way the frontends' build scripts
 * and MermaidBrowserBuild.ts load esbuild: esbuild refuses to load under the
 * jsdom environment Common's jest uses (see EsbuildConfig.test.ts).
 */

const COMMON_ROOT: string = path.resolve(__dirname, "..", "..");

const INSTALLED_KATEX: string = path.dirname(
  require.resolve("katex/package.json"),
);

const INSTALLED_KATEX_VERSION: string = (
  JSON.parse(
    fs.readFileSync(path.join(INSTALLED_KATEX, "package.json"), "utf8"),
  ) as { version: string }
).version;

// KaTeX's own error prefix: present in every copy of katex, minified or not.
const KATEX_MARKER: string = "KaTeX parse error";

/*
 * What a reader of a diagram downloaded before: mermaid's prebuilt
 * dist/mermaid.min.js, inlined whole into one chunk by the shim this
 * replaced.
 */
const PREBUILT_BUNDLE_BYTES: number = fs.statSync(
  path.join(
    path.dirname(require.resolve("mermaid/package.json")),
    "dist",
    "mermaid.min.js",
  ),
).size;

interface OutputSummary {
  path: string;
  bytes: number;
  hasKatex: boolean;
  hasInstalledKatexVersion: boolean;
  staticImports: Array<string>;
  dynamicImports: Array<string>;
}

interface BuildSummary {
  ok: boolean;
  errors: Array<string>;
  inputs: Array<string>;
  outputs: Array<OutputSummary>;
  entry: string;
}

/*
 * Builds `entrySource` the way a frontend does - createConfig() from
 * esbuild-config.js, plugins and all - into memory, and reports what esbuild
 * read and wrote.
 */
function buildLikeAFrontend(
  entrySource: string,
  nodeEnvironment: string = "production",
): BuildSummary {
  const output: string = childProcess.execFileSync(
    process.execPath,
    [
      "-e",
      String.raw`
        const fs = require("fs");
        const os = require("os");
        const path = require("path");
        const esbuild = require("esbuild");
        const { createConfig } = require("./UI/esbuild-config");
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "oneuptime-mermaid-"));
        const entry = path.join(root, "index.js");
        fs.writeFileSync(entry, process.env.ENTRY_SOURCE);

        async function run() {
          try {
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
            const marker = process.env.KATEX_MARKER;
            const version = JSON.stringify(process.env.KATEX_VERSION);
            const outputs = Object.entries(built.metafile.outputs).map(([file, meta]) => {
              const written = built.outputFiles.find((candidate) => {
                return path.relative(process.cwd(), candidate.path) === file ||
                  candidate.path === path.resolve(file);
              });
              const text = written ? written.text : "";
              return {
                path: file,
                bytes: meta.bytes,
                hasKatex: text.includes(marker),
                hasInstalledKatexVersion: text.includes(version),
                staticImports: meta.imports.filter((i) => i.kind === "import-statement").map((i) => i.path),
                dynamicImports: meta.imports.filter((i) => i.kind === "dynamic-import").map((i) => i.path),
              };
            });
            const entryOutput = Object.entries(built.metafile.outputs).find(([, meta]) => {
              return meta.entryPoint && path.resolve(meta.entryPoint) === entry;
            });
            console.log(JSON.stringify({
              ok: true,
              errors: [],
              inputs: Object.keys(built.metafile.inputs).map((input) => path.resolve(input)),
              outputs,
              entry: entryOutput ? entryOutput[0] : "",
            }));
          } catch (error) {
            console.log(JSON.stringify({
              ok: false,
              errors: (error.errors || []).map((e) => e.text).concat(error.errors ? [] : [String(error)]),
              inputs: [],
              outputs: [],
              entry: "",
            }));
          } finally {
            fs.rmSync(root, { recursive: true, force: true });
          }
        }
        run();
      `,
    ],
    {
      cwd: COMMON_ROOT,
      env: {
        ...process.env,
        NODE_ENV: nodeEnvironment,
        ENTRY_SOURCE: entrySource,
        KATEX_MARKER,
        KATEX_VERSION: INSTALLED_KATEX_VERSION,
      },
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    },
  );

  return JSON.parse(output) as BuildSummary;
}

// The outputs a browser loads, following static imports only, from `start`.
function staticClosure(
  build: BuildSummary,
  start: string,
  exclude: Set<string> = new Set<string>(),
): Set<string> {
  const byPath: Map<string, OutputSummary> = new Map<string, OutputSummary>(
    build.outputs.map((output: OutputSummary): [string, OutputSummary] => {
      return [output.path, output];
    }),
  );
  const seen: Set<string> = new Set<string>();
  const queue: Array<string> = [start];

  while (queue.length > 0) {
    const current: string = queue.shift() as string;

    if (seen.has(current) || exclude.has(current)) {
      continue;
    }

    seen.add(current);
    queue.push(...(byPath.get(current)?.staticImports || []));
  }

  return seen;
}

function bytesOf(build: BuildSummary, outputs: Set<string>): number {
  return build.outputs
    .filter((output: OutputSummary): boolean => {
      return outputs.has(output.path);
    })
    .reduce((sum: number, output: OutputSummary): number => {
      return sum + output.bytes;
    }, 0);
}

const MARKDOWN_VIEWER_LIKE_ENTRY: string = [
  // MarkdownViewer's shape: mermaid only through a dynamic import().
  "export function loadMermaid() {",
  '  return import("mermaid").then(function (m) { return m.default; });',
  "}",
].join("\n");

describe("isPrebuiltMermaidBundle", () => {
  const mermaidDist: string = path.join(
    "/srv",
    "node_modules",
    "mermaid",
    "dist",
  );

  test.each([
    ["mermaid.min.js"],
    ["mermaid.js"],
    ["mermaid.esm.mjs"],
    ["mermaid.esm.min.mjs"],
    [path.join("chunks", "mermaid.esm.min", "katex-ABCDEFGH.mjs")],
    [path.join("chunks", "mermaid.esm", "flowDiagram-ABCDEFGH.mjs")],
  ])("recognises dist/%s", (file: string) => {
    expect(isPrebuiltMermaidBundle(path.join(mermaidDist, file))).toBe(true);
  });

  test("recognises one with Windows separators", () => {
    expect(
      isPrebuiltMermaidBundle(
        "C:\\app\\node_modules\\mermaid\\dist\\mermaid.min.js",
      ),
    ).toBe(true);
  });

  test.each([
    [path.join(mermaidDist, "mermaid.core.mjs")],
    [path.join(mermaidDist, "chunks", "mermaid.core", "chunk-ABCDEFGH.mjs")],
    [path.join(mermaidDist, "mermaid.d.ts")],
    [
      path.join(
        "/srv",
        "node_modules",
        "@mermaid-js",
        "parser",
        "dist",
        "mermaid-parser.core.mjs",
      ),
    ],
    [path.join("/srv", "node_modules", "katex", "dist", "katex.mjs")],
    [path.join("/srv", "src", "mermaid.min.js")],
  ])("leaves %s alone", (file: string) => {
    expect(isPrebuiltMermaidBundle(file)).toBe(false);
  });

  test("names the plugin and the browser entry", () => {
    expect(MERMAID_SOURCE_PLUGIN_NAME).toBe("mermaid-from-source");
    expect(MERMAID_BROWSER_ENTRY).toBe("mermaid.mjs");
  });
});

describe("the frontends bundle mermaid from its source", () => {
  test.each(["production", "development"])(
    "takes mermaid's source build and the katex npm installed (%s)",
    (nodeEnvironment: string) => {
      const build: BuildSummary = buildLikeAFrontend(
        MARKDOWN_VIEWER_LIKE_ENTRY,
        nodeEnvironment,
      );

      expect(build.errors).toEqual([]);
      expect(build.ok).toBe(true);

      // mermaid's ES module source, and none of its prebuilt bundles.
      expect(
        build.inputs.some((input: string): boolean => {
          return input.endsWith(
            path.join("node_modules", "mermaid", "dist", "mermaid.core.mjs"),
          );
        }),
      ).toBe(true);
      expect(build.inputs.filter(isPrebuiltMermaidBundle)).toEqual([]);

      // katex from the installed package, the only copy read.
      const katexInputs: Array<string> = build.inputs.filter(
        (input: string): boolean => {
          return input.includes(`${path.sep}katex${path.sep}`);
        },
      );

      expect(katexInputs).toEqual([
        path.join(INSTALLED_KATEX, "dist", "katex.mjs"),
      ]);

      // Exactly one katex in the output, at the installed version.
      const withKatex: Array<OutputSummary> = build.outputs.filter(
        (output: OutputSummary): boolean => {
          return output.hasKatex;
        },
      );

      expect(withKatex).toHaveLength(1);
      expect((withKatex[0] as OutputSummary).hasInstalledKatexVersion).toBe(
        true,
      );
    },
  );

  test("keeps mermaid and katex out of the entry's first load", () => {
    const build: BuildSummary = buildLikeAFrontend(MARKDOWN_VIEWER_LIKE_ENTRY);

    expect(build.ok).toBe(true);

    const firstLoad: Set<string> = staticClosure(build, build.entry);
    const katexChunk: OutputSummary = build.outputs.find(
      (output: OutputSummary): boolean => {
        return output.hasKatex;
      },
    ) as OutputSummary;

    expect(firstLoad.has(katexChunk.path)).toBe(false);
    expect(
      build.outputs.some((output: OutputSummary): boolean => {
        return (
          firstLoad.has(output.path) && /mermaid/.test(path.basename(output.path))
        );
      }),
    ).toBe(false);
  });

  test("loads katex only for a label that needs it, and a fraction of the prebuilt bundle for a diagram", () => {
    const build: BuildSummary = buildLikeAFrontend(MARKDOWN_VIEWER_LIKE_ENTRY);

    expect(build.ok).toBe(true);

    const entry: OutputSummary = build.outputs.find(
      (output: OutputSummary): boolean => {
        return output.path === build.entry;
      },
    ) as OutputSummary;

    // The chunk import("mermaid") loads: mermaid's core.
    expect(entry.dynamicImports).toHaveLength(1);

    const core: string = entry.dynamicImports[0] as string;
    const firstLoad: Set<string> = staticClosure(build, build.entry);
    const firstDiagram: Set<string> = staticClosure(build, core, firstLoad);
    const katexChunk: OutputSummary = build.outputs.find(
      (output: OutputSummary): boolean => {
        return output.hasKatex;
      },
    ) as OutputSummary;

    // katex is its own chunk, reached only through import().
    expect(firstDiagram.has(katexChunk.path)).toBe(false);
    expect(
      build.outputs.some((output: OutputSummary): boolean => {
        return output.dynamicImports.includes(katexChunk.path);
      }),
    ).toBe(true);

    /*
     * What the first diagram costs before its own type's chunk. A budget, not
     * a pin: it was a third of the prebuilt bundle (about 700 KB against
     * 3.6 MB) when this was written. Half catches the prebuilt bundle coming
     * back, or every diagram type being inlined into the core.
     */
    expect(bytesOf(build, firstDiagram)).toBeLessThan(
      PREBUILT_BUNDLE_BYTES / 2,
    );
  });

  test.each([
    ['import("mermaid/dist/mermaid.min.js")'],
    ['import("mermaid/dist/mermaid.esm.min.mjs")'],
    ['import("mermaid/dist/mermaid.js")'],
  ])("refuses to bundle a prebuilt bundle: %s", (importExpression: string) => {
    const build: BuildSummary = buildLikeAFrontend(
      `export function load() { return ${importExpression}; }`,
    );

    expect(build.ok).toBe(false);
    expect(build.errors.join("\n")).toContain("prebuilt bundles");
  });

  test("refuses a prebuilt bundle reached by a relative path too", () => {
    const prebuilt: string = path.join(
      path.dirname(require.resolve("mermaid/package.json")),
      "dist",
      "mermaid.esm.min.mjs",
    );
    const build: BuildSummary = buildLikeAFrontend(
      `export function load() { return import(${JSON.stringify(prebuilt)}); }`,
    );

    expect(build.ok).toBe(false);
    expect(build.errors.join("\n")).toContain("prebuilt bundles");
  });
});

describe("the docs and the blog get the same source build", () => {
  interface BrowserBundleSummary {
    entry: string;
    files: Array<string>;
    inputs: Array<string>;
  }

  test("buildMermaidBrowserBundle reads mermaid's source and the installed katex", () => {
    const summary: BrowserBundleSummary = JSON.parse(
      childProcess.execFileSync(
        process.execPath,
        [
          "-e",
          String.raw`
            const path = require("path");
            const { buildMermaidBrowserBundle } = require("./UI/esbuild-mermaid");
            buildMermaidBrowserBundle().then((bundle) => {
              console.log(JSON.stringify({
                entry: bundle.entry,
                files: bundle.files.map((file) => file.path),
                inputs: bundle.inputs.map((input) => path.resolve(input)),
              }));
            }).catch((error) => {
              console.error(error);
              process.exitCode = 1;
            });
          `,
        ],
        {
          cwd: COMMON_ROOT,
          encoding: "utf8",
          maxBuffer: 64 * 1024 * 1024,
        },
      ),
    ) as BrowserBundleSummary;

    expect(summary.entry).toBe(MERMAID_BROWSER_ENTRY);
    expect(summary.files).toContain(MERMAID_BROWSER_ENTRY);
    expect(
      summary.files.filter((file: string): boolean => {
        return file !== MERMAID_BROWSER_ENTRY && !file.startsWith("chunks/");
      }),
    ).toEqual([]);

    expect(summary.inputs.filter(isPrebuiltMermaidBundle)).toEqual([]);
    expect(
      summary.inputs.filter((input: string): boolean => {
        return input.includes(`${path.sep}katex${path.sep}`);
      }),
    ).toEqual([path.join(INSTALLED_KATEX, "dist", "katex.mjs")]);
  });
});
