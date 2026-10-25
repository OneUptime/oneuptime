import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import childProcess from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

/*
 * ZOD IN THE FRONTENDS: WHAT COMMON'S TYPES USE, NOT ALL OF ZOD 4.
 *
 * Common's Types (Email, ObjectID, Color, MonitorStep and the rest) build
 * their OpenAPI schema with Utils/Schema/Zod, so every frontend - the
 * Dashboard, Accounts, Admin Dashboard, Status Page and public dashboards -
 * bundles zod. With zod 3 that cost 63 KB of the shared chunk. zod 4's
 * namespace carries every one of its ~45 locales, and a bundler keeps all of
 * a namespace that is handed around as a value: when Common moved to zod 4,
 * Zod.ts exported zod's namespace and gave it to extendZodWithOpenApi, and
 * zod grew to 483 KB of every frontend (about 100 KB gzipped), loaded on
 * every page, status pages included. Zod.ts now picks zod's functions by
 * name, and the bundle keeps what the schemas use: about 105 KB, English
 * only.
 *
 * This bundles every Type that imports Utils/Schema/Zod with the frontends'
 * own esbuild configuration (Common/UI/esbuild-config's createConfig, as a
 * production build), and reads what zod put into it. A second build runs the
 * bundle as a browser would and asks a Type for its schema: the zod in a
 * frontend still has zod-to-openapi's .openapi(), and turns no string into
 * code (zod 4's compiled parsers use new Function, which a status page's
 * Content-Security-Policy forbids; Zod.ts makes zod jitless in a browser).
 */

const COMMON_DIRECTORY: string = path.resolve(__dirname, "..", "..", "..");
const TYPES_DIRECTORY: string = path.join(COMMON_DIRECTORY, "Types");
const ESBUILD_CONFIG: string = path.join(
  COMMON_DIRECTORY,
  "UI",
  "esbuild-config.js",
);
const COMMON_MODULES: string = path.join(COMMON_DIRECTORY, "node_modules");

// zod 3 cost 63 KB here, the functions Zod.ts picks about 105 KB, all of zod 4 483 KB.
const ZOD_BYTES_CEILING: number = 160 * 1024;

const ZOD_MODULE_IMPORTS: ReadonlyArray<string> = [
  'Utils/Schema/Zod"',
  'from "zod"',
];

const temporaryRoots: Array<string> = [];

afterAll(() => {
  for (const root of temporaryRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// Every Type (not a test) that imports Common's Zod module, or zod itself.
function typesThatImportZod(): Array<string> {
  const found: Array<string> = [];
  const visit: (directory: string) => void = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath: string = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        visit(entryPath);
        continue;
      }

      if (!entry.name.endsWith(".ts") || entry.name.endsWith(".d.ts")) {
        continue;
      }

      const source: string = fs.readFileSync(entryPath, "utf8");

      if (
        ZOD_MODULE_IMPORTS.some((text: string): boolean => {
          return source.includes(text);
        })
      ) {
        found.push(entryPath);
      }
    }
  };

  visit(TYPES_DIRECTORY);

  return found.sort();
}

interface BundleReport {
  error: string;
  zodBytes: number;
  zodToOpenApiBytes: number;
  localeFiles: Array<string>;
  emailSchemaMetadata: unknown;
  // What the bundle turned from a string into code while it loaded and ran.
  evaluatedCode: Array<string>;
}

/*
 * Builds `entry` with the frontends' production esbuild configuration, in a
 * child Node (esbuild and the configuration load as the frontends' build
 * scripts load them), and reports what zod contributed to the output. Then
 * it builds a CommonJS copy, runs it, and returns what the probe the entry
 * sets on globalThis answers.
 */
function bundle(entry: string): BundleReport {
  const script: string = `
    const configModule = require(${JSON.stringify(ESBUILD_CONFIG)});
    const esbuild = require(require.resolve("esbuild", {
      paths: [${JSON.stringify(COMMON_MODULES)}],
    }));

    function configFor(format) {
      const config = configModule.createConfig({
        serviceName: "Dashboard",
        publicPath: "/dashboard/dist/",
        entryPoint: ${JSON.stringify(entry)},
        outdir: ${JSON.stringify(path.join(path.dirname(entry), "dist"))},
      });
      config.write = false;
      config.metafile = true;
      config.splitting = false;
      config.sourcemap = false;
      config.logLevel = "silent";
      config.format = format;
      return config;
    }

    const NODE_MODULES_ZOD = "node_modules/zod/";
    const NODE_MODULES_ZOD_TO_OPENAPI = "node_modules/@asteasolutions/zod-to-openapi/";
    const LOCALES = "node_modules/zod/v4/locales/";

    (async () => {
      const result = await esbuild.build(configFor("esm"));
      let zodBytes = 0;
      let zodToOpenApiBytes = 0;
      const localeFiles = new Set();

      for (const output of Object.values(result.metafile.outputs)) {
        for (const [input, info] of Object.entries(output.inputs)) {
          if (info.bytesInOutput === 0) {
            continue;
          }
          if (input.includes(NODE_MODULES_ZOD)) {
            zodBytes += info.bytesInOutput;
          }
          if (input.includes(NODE_MODULES_ZOD_TO_OPENAPI)) {
            zodToOpenApiBytes += info.bytesInOutput;
          }
          if (input.includes(LOCALES)) {
            localeFiles.add(input.slice(input.indexOf(LOCALES) + LOCALES.length));
          }
        }
      }

      const runnable = await esbuild.build(configFor("cjs"));
      const code = runnable.outputFiles.find((file) => {
        return file.path.endsWith(".js");
      }).text;
      const runBundle = new Function("require", "module", "exports", code);

      /*
       * Run it as a browser would: the global object is window and self,
       * with a document, and every string anything turns into code (new
       * Function, Function()) is written down - what a page whose
       * Content-Security-Policy has no 'unsafe-eval' refuses and reports.
       */
      globalThis.window = globalThis;
      globalThis.self = globalThis;
      globalThis.document = {};
      const RealFunction = globalThis.Function;
      const evaluatedCode = [];
      globalThis.Function = new Proxy(RealFunction, {
        construct(target, args) {
          evaluatedCode.push(args.map(String).join(", ").slice(0, 200));
          return Reflect.construct(target, args);
        },
        apply(target, thisArg, args) {
          evaluatedCode.push(args.map(String).join(", ").slice(0, 200));
          return Reflect.apply(target, thisArg, args);
        },
      });

      let emailSchemaMetadata;
      try {
        runBundle(require, { exports: {} }, {});
        emailSchemaMetadata = globalThis.zodBrowserBundleProbe();
      } finally {
        globalThis.Function = RealFunction;
      }

      console.log(JSON.stringify({
        error: "",
        zodBytes,
        zodToOpenApiBytes,
        localeFiles: [...localeFiles].sort(),
        emailSchemaMetadata,
        evaluatedCode,
      }));
    })().catch((error) => {
      console.log(JSON.stringify({
        error: String((error && error.stack) || error),
        zodBytes: 0,
        zodToOpenApiBytes: 0,
        localeFiles: [],
        emailSchemaMetadata: null,
        evaluatedCode: [],
      }));
    });
  `;

  return JSON.parse(
    childProcess.execFileSync(process.execPath, ["-e", script], {
      cwd: COMMON_DIRECTORY,
      env: { ...process.env, NODE_ENV: "production" },
      encoding: "utf8",
      timeout: 240000,
      maxBuffer: 16 * 1024 * 1024,
    }),
  ) as BundleReport;
}

// An entry that uses every Type as a frontend does, and a probe of Email's schema.
function writeEntry(root: string, types: Array<string>): string {
  const entry: string = path.join(root, "Entry.ts");
  const email: string = path.join(TYPES_DIRECTORY, "Email.ts");

  fs.writeFileSync(
    entry,
    [
      'import { getOpenApiMetadata } from "@asteasolutions/zod-to-openapi";',
      `import Email from ${JSON.stringify(email)};`,
      ...types.map((file: string, index: number): string => {
        return `import * as Type${index} from ${JSON.stringify(file)};`;
      }),
      "",
      "// Every Type in use, so nothing of theirs is shaken out.",
      `(globalThis as any).zodBrowserBundleTypes = [${types
        .map((_file: string, index: number): string => {
          return `Type${index}`;
        })
        .join(", ")}];`,
      "(globalThis as any).zodBrowserBundleProbe = () => {",
      "  const schema = Email.getSchema();",
      "  // A parse too: no frontend parses with zod today, and one that did would not evaluate code either.",
      '  schema.parse({ _type: "Email", value: "user@example.com" });',
      "  return getOpenApiMetadata(schema);",
      "};",
      "",
    ].join("\n"),
  );

  return entry;
}

describe("zod in the frontends' bundles", () => {
  const types: Array<string> = typesThatImportZod();

  test("the Types that build their schema with zod are found", () => {
    // 18 today: Email, ObjectID, Color, Date, the monitor criteria and steps, ...
    expect(types.length).toBeGreaterThan(10);
    expect(types).toContain(path.join(TYPES_DIRECTORY, "Email.ts"));
    expect(types).toContain(path.join(TYPES_DIRECTORY, "ObjectID.ts"));
    expect(types).toContain(
      path.join(TYPES_DIRECTORY, "Monitor", "MonitorSteps.ts"),
    );
  });

  describe("bundled as the frontends bundle them", () => {
    let report: BundleReport;

    beforeAll(() => {
      const root: string = fs.mkdtempSync(
        path.join(os.tmpdir(), "oneuptime-zod-bundle-"),
      );
      temporaryRoots.push(root);
      // The entry's own import (zod-to-openapi) resolves as Common's do.
      fs.symlinkSync(COMMON_MODULES, path.join(root, "node_modules"), "dir");

      report = bundle(writeEntry(root, types));
    }, 300000);

    test("the build succeeds", () => {
      expect(report.error).toBe("");
    });

    test("zod is in it: the Types do build schemas with it", () => {
      expect(report.zodBytes).toBeGreaterThan(0);
      expect(report.zodToOpenApiBytes).toBeGreaterThan(0);
    });

    test("only zod's English messages are in it, not its other locales", () => {
      // zod configures English as it loads; the rest stay out.
      expect(report.localeFiles).toEqual(["en.js"]);
    });

    test(`zod costs what the schemas use: under ${ZOD_BYTES_CEILING / 1024} KB, not all of zod 4 (483 KB)`, () => {
      expect(report.zodBytes).toBeLessThan(ZOD_BYTES_CEILING);
    });

    test("the bundled zod has zod-to-openapi's .openapi(): a Type's schema keeps its OpenAPI metadata", () => {
      expect(report.emailSchemaMetadata).toEqual({
        type: "object",
        description: "Email object",
        example: { _type: "Email", value: "user@example.com" },
      });
    });

    test("in a browser it turns no string into code, so a page that forbids eval reports nothing", () => {
      /*
       * zod 4 compiles each object schema's parser with new Function, and
       * probes whether it may as the first object schema is made - which
       * the monitor criteria Types do as their modules load. Status pages
       * forbid eval (StatusPageContentSecurityPolicy has no 'unsafe-eval'),
       * so every page load reported a refused eval. Zod.ts makes zod
       * jitless in a browser.
       */
      expect(report.evaluatedCode).toEqual([]);
    });
  });
});
