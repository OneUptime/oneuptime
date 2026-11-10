import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import childProcess from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import {
  findLibraryImports,
  isLibrarySpecifier,
  LibraryImport,
  packageOfSpecifier,
  scanLibraryImports,
} from "./LazyLoadedLibraries";

/*
 * Every library browser code import()s by name is an ES module, as the
 * frontends' build resolves it (issue #6638).
 *
 * The build (Common/UI/esbuild-config.js: ES modules, split into files)
 * puts a module that is only ever import()ed in a file of its own. The file
 * of an ES module exports what the module does. The file of a CommonJS
 * module can export nothing but `default` - its module.exports - so the
 * named exports the code reads are not there: the QR code element's
 * import("qrcode") handed it an object without toDataURL, and every QR code
 * in the product said "L.toDataURL is not a function". No test saw it: Jest
 * reads modules as CommonJS, and its import() hands over every export.
 *
 * So each import("<library>") found in browser code (LazyLoadedLibraries.ts)
 * is resolved here exactly as the build resolves it - the shared config's
 * aliases and plugins, from the file that makes the import() - and the
 * module it resolves to must be one esbuild reads as an ES module. A
 * CommonJS library is loaded through a module of our own that imports it
 * statically, which the build reads correctly: QRCodeImage.ts for qrcode,
 * CodeEditorGrammars.ts for highlight.js.
 *
 * A subprocess supplies the native Node environment esbuild requires, as in
 * SignInFirstLoadBuild.test.ts.
 */

const COMMON_ROOT: string = path.resolve(__dirname, "..", "..");
const REPOSITORY_ROOT: string = path.resolve(COMMON_ROOT, "..", "..");

/*
 * Libraries browser code import()s that are installed with one frontend's
 * dependencies only, not Common's - so where this suite runs with Common's
 * alone (the Common Test workflow), it cannot build them. Each was checked to
 * resolve to an ES module in the browser build when it was added here, and
 * is checked again wherever that frontend's dependencies are installed. A new
 * one is added only once it has been checked the same way.
 */
const CHECKED_WHERE_INSTALLED: Record<string, string> = {
  jspdf:
    "the Dashboard's: its browser entry and its exports' browser condition are dist/jspdf.es.min.js, an ES module",
  "jspdf-autotable":
    "the Dashboard's: its exports' import condition is dist/jspdf.plugin.autotable.mjs, an ES module",
  rrweb:
    "the Dashboard's: its exports' import condition is dist/rrweb.js, an ES module (type: module)",
};

/*
 * The library that broke, import()ed from where the element did: built
 * alongside the real imports to show the guard tells a CommonJS library
 * apart. Nothing import()s it by name now (QRCodeImage.ts imports it).
 */
const COMMONJS_PROBE: LibraryImport = {
  specifier: "qrcode",
  file: "packages/Common/UI/Components/QR/QR.tsx",
  line: 0,
};

interface Resolution {
  specifier: string;
  file: string;
  // The module the build resolves the import() to, or null when it cannot.
  resolvedPath: string | null;
  // As esbuild read that module: "esm", "cjs" - or "" when it said nothing.
  format: string;
}

let entryDirectory: string = "";
let libraryImports: Array<LibraryImport> = [];
let resolutions: Array<Resolution> = [];
let probeResolution: Resolution | null = null;

const resolveAsTheBuildDoes: (
  imports: Array<LibraryImport>,
) => Array<Resolution> = (imports: Array<LibraryImport>): Array<Resolution> => {
  entryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "lazy-libraries-"));
  const entry: string = path.join(entryDirectory, "LazyLibraries.ts");
  const probes: Array<{ specifier: string; importer: string }> = imports.map(
    (libraryImport: LibraryImport): { specifier: string; importer: string } => {
      return {
        specifier: libraryImport.specifier,
        importer: path.join(REPOSITORY_ROOT, libraryImport.file),
      };
    },
  );

  // One import() per library import found, each named by its place in the list.
  fs.writeFileSync(
    entry,
    probes
      .map((_probe: unknown, index: number): string => {
        return `export const load${index} = () => import("lazy-library:${index}");`;
      })
      .join("\n"),
  );

  const script: string = `
    const path = require("path");
    const commonRoot = ${JSON.stringify(COMMON_ROOT)};
    const probes = ${JSON.stringify(probes)};
    const esbuild = require(require.resolve("esbuild", { paths: [commonRoot] }));
    const { createConfig } = require(path.join(commonRoot, "UI/esbuild-config.js"));
    const config = createConfig({
      serviceName: "Accounts",
      publicPath: "/accounts/dist/",
      entryPoint: ${JSON.stringify(entry)},
    });
    const resolved = probes.map(() => null);

    const probePlugin = {
      name: "lazy-library-probes",
      setup(build) {
        build.onResolve({ filter: /^lazy-library:/ }, async (args) => {
          const index = Number(args.path.slice("lazy-library:".length));
          const probe = probes[index];
          // As the import() in that file is resolved: from its folder.
          const result = await build.resolve(probe.specifier, {
            kind: "dynamic-import",
            importer: probe.importer,
            resolveDir: path.dirname(probe.importer),
          });

          if (result.errors.length > 0 || !result.path) {
            return { path: args.path, namespace: "lazy-library-not-installed" };
          }

          resolved[index] = result.path;

          return { path: result.path, namespace: result.namespace };
        });

        build.onLoad(
          { filter: /.*/, namespace: "lazy-library-not-installed" },
          () => {
            return { contents: "export default null;", loader: "js" };
          },
        );
      },
    };

    esbuild.build({
      ...config,
      outdir: path.join(${JSON.stringify(entryDirectory)}, "out"),
      write: false,
      sourcemap: false,
      metafile: true,
      logLevel: "silent",
      plugins: [...config.plugins, probePlugin],
    }).then((result) => {
      // The metafile names inputs relative to the folder the build ran in.
      const formats = {};

      for (const [input, details] of Object.entries(result.metafile.inputs)) {
        formats[path.resolve(commonRoot, input)] = details.format || "";
      }

      console.log(JSON.stringify(resolved.map((resolvedPath) => {
        return {
          resolvedPath: resolvedPath,
          format: resolvedPath ? (formats[path.resolve(resolvedPath)] || "") : "",
        };
      })));
    }).catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
  `;

  const results: Array<{ resolvedPath: string | null; format: string }> =
    JSON.parse(
      childProcess.execFileSync(process.execPath, ["-e", script], {
        cwd: COMMON_ROOT,
        env: { ...process.env, NODE_ENV: "production" },
        encoding: "utf8",
        timeout: 240000,
        maxBuffer: 64 * 1024 * 1024,
      }),
    );

  return imports.map(
    (libraryImport: LibraryImport, index: number): Resolution => {
      return {
        specifier: libraryImport.specifier,
        file: libraryImport.file,
        resolvedPath: results[index]!.resolvedPath,
        format: results[index]!.format,
      };
    },
  );
};

// The packages Common's package.json installs, which this suite always has.
const commonDependencies: () => Array<string> = (): Array<string> => {
  const packageJson: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  } = JSON.parse(
    fs.readFileSync(path.join(COMMON_ROOT, "package.json"), "utf8"),
  );

  return [
    ...Object.keys(packageJson.dependencies || {}),
    ...Object.keys(packageJson.devDependencies || {}),
  ];
};

const where: (resolution: Resolution) => string = (
  resolution: Resolution,
): string => {
  return `import("${resolution.specifier}") in ${resolution.file}`;
};

beforeAll(() => {
  libraryImports = scanLibraryImports(REPOSITORY_ROOT);

  const all: Array<Resolution> = resolveAsTheBuildDoes([
    ...libraryImports,
    COMMONJS_PROBE,
  ]);

  probeResolution = all.pop()!;
  resolutions = all;
}, 300000);

afterAll(() => {
  if (entryDirectory) {
    fs.rmSync(entryDirectory, { recursive: true, force: true });
  }
});

describe("libraries the browser code import()s by name", () => {
  test("are found: the libraries Common loads where they are used are among them", () => {
    const specifiers: Array<string> = libraryImports.map(
      (libraryImport: LibraryImport): string => {
        return libraryImport.specifier;
      },
    );

    expect(specifiers).toEqual(
      expect.arrayContaining(["mermaid", "posthog-js", "react-beautiful-dnd"]),
    );
  });

  test("are each an ES module as the frontends' build resolves them", () => {
    const commonJs: Array<string> = resolutions
      .filter((resolution: Resolution): boolean => {
        return resolution.resolvedPath !== null && resolution.format !== "esm";
      })
      .map((resolution: Resolution): string => {
        return `${where(resolution)} resolves to ${path.relative(
          REPOSITORY_ROOT,
          resolution.resolvedPath!,
        )}, which the build reads as ${
          resolution.format || "neither an ES nor a CommonJS module"
        }. The build puts it in a file whose only export is default, so the names the code reads from it are not there (issue #6638). Load it through a module of our own that imports it statically, as packages/Common/UI/Components/QR/QRCodeImage.ts does qrcode.`;
      });

    expect(commonJs).toEqual([]);
  });

  test("are each built here, or were checked where they are installed", () => {
    const unchecked: Array<string> = resolutions
      .filter((resolution: Resolution): boolean => {
        return (
          resolution.resolvedPath === null &&
          !CHECKED_WHERE_INSTALLED[packageOfSpecifier(resolution.specifier)]
        );
      })
      .map((resolution: Resolution): string => {
        return `${where(resolution)}: the library is not installed where this suite runs, so it cannot tell whether the build reads it as an ES module. Check that it is one (its "browser", "module" or exports' "import" entry), then add it to CHECKED_WHERE_INSTALLED with what you found.`;
      });

    expect(unchecked).toEqual([]);
  });

  test("are always built here when Common installs them", () => {
    const installedWithCommon: Array<string> = commonDependencies();

    expect(
      resolutions
        .filter((resolution: Resolution): boolean => {
          return (
            resolution.resolvedPath === null &&
            installedWithCommon.includes(
              packageOfSpecifier(resolution.specifier),
            )
          );
        })
        .map(where),
    ).toEqual([]);

    // The ones the first test names, at least.
    expect(
      resolutions.filter((resolution: Resolution): boolean => {
        return resolution.resolvedPath !== null;
      }).length,
    ).toBeGreaterThanOrEqual(3);
  });

  test("checked where installed are each still import()ed somewhere", () => {
    const imported: Array<string> = libraryImports.map(
      (libraryImport: LibraryImport): string => {
        return packageOfSpecifier(libraryImport.specifier);
      },
    );

    expect(
      Object.keys(CHECKED_WHERE_INSTALLED).filter((library: string) => {
        return !imported.includes(library);
      }),
    ).toEqual([]);
  });

  test("do not include qrcode, which QRCodeImage.ts imports statically", () => {
    expect(
      libraryImports.filter((libraryImport: LibraryImport): boolean => {
        return packageOfSpecifier(libraryImport.specifier) === "qrcode";
      }),
    ).toEqual([]);
  });

  test("would have caught qrcode: the build reads it as CommonJS", () => {
    expect(probeResolution!.resolvedPath).toContain("node_modules/qrcode/");
    expect(probeResolution!.format).toBe("cjs");
  });
});

describe("findLibraryImports", () => {
  const find: (source: string, file?: string) => Array<string> = (
    source: string,
    file: string = "packages/Common/UI/Example.tsx",
  ): Array<string> => {
    return findLibraryImports(source, file).map(
      (libraryImport: LibraryImport): string => {
        return `${libraryImport.specifier}@${libraryImport.line}`;
      },
    );
  };

  test("finds an import() of a library, with the line it is on", () => {
    expect(
      find(
        [
          "const a: number = 1;",
          'const library = await import("qrcode");',
          "import(`posthog-js`).then(() => {});",
          'import("@scope/package/deep/path");',
        ].join("\n"),
      ),
    ).toEqual(["qrcode@2", "posthog-js@3", "@scope/package/deep/path@4"]);
  });

  test("finds one in a .tsx module, inside a component", () => {
    expect(
      find(
        'const Element = () => { React.useEffect(() => { import("qrcode"); }); return <div />; };',
        "packages/Common/UI/Example.tsx",
      ),
    ).toEqual(["qrcode@1"]);
  });

  test("leaves out our own modules", () => {
    expect(
      find(
        [
          'import("./QRCodeImage");',
          'import("../CodeEditor/CodeEditor");',
          'import("Common/UI/Utils/ModelAPI/ModelAPI");',
          'import("App/FeatureSet/Dashboard/src/Pages/Home");',
          'import("@oneuptime/ee-dashboard");',
          'import("/absolute/module");',
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  test("leaves out types, static imports, comments and strings", () => {
    expect(
      find(
        [
          'import QRCode from "qrcode";',
          'import type { PostHog } from "posthog-js";',
          'export { default } from "mermaid";',
          'type Library = typeof import("qrcode");',
          'let loaded: import("jspdf").jsPDF | null = null;',
          '// import("qrcode")',
          '/* import("qrcode") */',
          "const text: string = 'import(\"qrcode\")';",
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  test("leaves out an import() whose specifier is computed, which no build can resolve ahead", () => {
    expect(find("const name = 'qrcode';\nimport(name);")).toEqual([]);
  });
});

describe("the names it reads", () => {
  test.each([
    ["qrcode", true],
    ["@scope/package", true],
    ["highlight.js/lib/core", true],
    ["./QRCodeImage", false],
    ["../Utils/LazyLibrary", false],
    ["/root", false],
    ["Common/UI/Utils/API/API", false],
    ["App/FeatureSet/Accounts/src/Pages/Login", false],
    ["@oneuptime/ee-admin-dashboard", false],
    ["", false],
  ])("%s is a library: %s", (specifier: string, isLibrary: boolean) => {
    expect(isLibrarySpecifier(specifier)).toBe(isLibrary);
  });

  test.each([
    ["qrcode", "qrcode"],
    ["highlight.js/lib/core", "highlight.js"],
    ["@scope/package", "@scope/package"],
    ["@scope/package/deep/path", "@scope/package"],
  ])("%s is loaded from %s", (specifier: string, packageName: string) => {
    expect(packageOfSpecifier(specifier)).toBe(packageName);
  });
});
