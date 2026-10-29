import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import childProcess from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

/*
 * NO ZOD IN THE FRONTENDS' BUNDLES.
 *
 * Common's Types (Email, ObjectID, Color, MonitorStep and the rest) built
 * their OpenAPI schemas with zod, so every frontend - the Dashboard,
 * Accounts, the Admin Dashboard, status pages and public dashboards -
 * bundled zod and zod-to-openapi: about 105 KB and 7 KB of the chunks every
 * page loads (an Accounts or status page build, 2026-10-28), for schemas no
 * browser reads, and zod 4 probed whether it may compile code as the monitor
 * criteria made their schemas on load. The schemas are built in Common's
 * Utils/Schema now, which only the server loads.
 *
 * ZodOutOfBrowserGuard walks the frontends' imports; this builds what they
 * load and reads what is in it. It bundles the Types that built schemas and
 * both model indexes - the Dashboard's tables and forms load every model, and
 * the models load the Types of their columns - with the frontends' own
 * esbuild configuration (Common/UI/esbuild-config's createConfig, as a
 * production build), and checks that nothing of zod, of zod-to-openapi or of
 * Utils/Schema is in it. A second build runs the bundle as a browser would:
 * the Types and models load and work, and nothing turns a string into code,
 * which a status page's Content-Security-Policy (no 'unsafe-eval') would
 * refuse.
 */

const COMMON_DIRECTORY: string = path.resolve(__dirname, "..", "..", "..");
const ESBUILD_CONFIG: string = path.join(
  COMMON_DIRECTORY,
  "UI",
  "esbuild-config.js",
);
const COMMON_MODULES: string = path.join(COMMON_DIRECTORY, "node_modules");

// The Types that built their own API schema, and what loads every model.
const BUNDLED_MODULES: ReadonlyArray<string> = [
  "Types/Color.ts",
  "Types/Database/DatabaseProperty.ts",
  "Types/Date.ts",
  "Types/Domain.ts",
  "Types/Email.ts",
  "Types/IP/IP.ts",
  "Types/Monitor/CriteriaAlert.ts",
  "Types/Monitor/CriteriaFilter.ts",
  "Types/Monitor/CriteriaIncident.ts",
  "Types/Monitor/IncomingMonitor/IncidentGroupingConfig.ts",
  "Types/Monitor/MonitorCriteria.ts",
  "Types/Monitor/MonitorCriteriaInstance.ts",
  "Types/Monitor/MonitorStep.ts",
  "Types/Monitor/MonitorSteps.ts",
  "Types/Name.ts",
  "Types/ObjectID.ts",
  "Types/Phone.ts",
  "Types/Port.ts",
  "Types/Version.ts",
  "Models/DatabaseModels/Index.ts",
  "Models/AnalyticsModels/Index.ts",
];

const temporaryRoots: Array<string> = [];

afterAll(() => {
  for (const root of temporaryRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

interface ProbeAnswer {
  email: string;
  objectId: string;
  monitorStepsType: string;
  databaseModels: number;
  analyticsModels: number;
}

interface BundleReport {
  error: string;
  // Bytes in the output from each: zod, zod-to-openapi, Common's Utils/Schema.
  zodBytes: number;
  zodToOpenApiBytes: number;
  schemaModules: Array<string>;
  // Every input the output holds code of, and every module it leaves to load at run time.
  inputs: number;
  externalImports: Array<string>;
  probe: ProbeAnswer | null;
  // What the bundle turned from a string into code while it loaded and ran.
  evaluatedCode: Array<string>;
}

/*
 * Builds `entry` with the frontends' production esbuild configuration, in a
 * child Node (esbuild and the configuration load as the frontends' build
 * scripts load them), and reports what the output holds. Then it builds a
 * CommonJS copy, runs it as a browser would, and returns what the probe the
 * entry sets on globalThis answers.
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
    const SCHEMA_MODULES = "Utils/Schema/";

    (async () => {
      const result = await esbuild.build(configFor("esm"));
      let zodBytes = 0;
      let zodToOpenApiBytes = 0;
      let inputs = 0;
      const schemaModules = new Set();
      const externalImports = new Set();

      for (const output of Object.values(result.metafile.outputs)) {
        for (const [input, info] of Object.entries(output.inputs)) {
          if (info.bytesInOutput === 0) {
            continue;
          }
          inputs += 1;
          if (input.includes(NODE_MODULES_ZOD)) {
            zodBytes += info.bytesInOutput;
          }
          if (input.includes(NODE_MODULES_ZOD_TO_OPENAPI)) {
            zodToOpenApiBytes += info.bytesInOutput;
          }
          if (input.includes(SCHEMA_MODULES)) {
            schemaModules.add(input.slice(input.indexOf(SCHEMA_MODULES)));
          }
        }
        for (const imported of output.imports) {
          if (imported.external) {
            externalImports.add(imported.path);
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

      let probe;
      try {
        runBundle(require, { exports: {} }, {});
        probe = globalThis.zodBrowserBundleProbe();
      } finally {
        globalThis.Function = RealFunction;
      }

      console.log(JSON.stringify({
        error: "",
        zodBytes,
        zodToOpenApiBytes,
        schemaModules: [...schemaModules].sort(),
        inputs,
        externalImports: [...externalImports].sort(),
        probe,
        evaluatedCode,
      }));
    })().catch((error) => {
      console.log(JSON.stringify({
        error: String((error && error.stack) || error),
        zodBytes: 0,
        zodToOpenApiBytes: 0,
        schemaModules: [],
        inputs: 0,
        externalImports: [],
        probe: null,
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

// An entry that loads every module as a frontend does, and a probe that uses a few.
function writeEntry(root: string): string {
  const entry: string = path.join(root, "Entry.ts");
  const modulePath: (id: string) => string = (id: string): string => {
    return JSON.stringify(path.join(COMMON_DIRECTORY, id));
  };

  fs.writeFileSync(
    entry,
    [
      `import Email from ${modulePath("Types/Email.ts")};`,
      `import ObjectID from ${modulePath("Types/ObjectID.ts")};`,
      `import MonitorSteps from ${modulePath("Types/Monitor/MonitorSteps.ts")};`,
      `import DatabaseModels from ${modulePath("Models/DatabaseModels/Index.ts")};`,
      `import AnalyticsModels from ${modulePath("Models/AnalyticsModels/Index.ts")};`,
      ...BUNDLED_MODULES.map((id: string, index: number): string => {
        return `import * as Module${index} from ${modulePath(id)};`;
      }),
      "",
      "// Every module in use, so nothing of theirs is shaken out.",
      `(globalThis as any).zodBrowserBundleModules = [${BUNDLED_MODULES.map(
        (_id: string, index: number): string => {
          return `Module${index}`;
        },
      ).join(", ")}];`,
      "(globalThis as any).zodBrowserBundleProbe = () => {",
      "  return {",
      '    email: new Email(" USER@Example.com ").toString(),',
      '    objectId: new ObjectID("123e4567-e89b-12d3-a456-426614174000").toString(),',
      "    monitorStepsType: String(new MonitorSteps().toJSON()['_type']),",
      "    databaseModels: DatabaseModels.length,",
      "    analyticsModels: AnalyticsModels.length,",
      "  };",
      "};",
      "",
    ].join("\n"),
  );

  return entry;
}

describe("zod in the frontends' bundles", () => {
  test("the modules bundled are there", () => {
    for (const id of BUNDLED_MODULES) {
      expect({
        id,
        exists: fs.existsSync(path.join(COMMON_DIRECTORY, id)),
      }).toEqual({ id, exists: true });
    }
  });

  describe("bundled as the frontends bundle them", () => {
    let report: BundleReport;

    beforeAll(() => {
      const root: string = fs.mkdtempSync(
        path.join(os.tmpdir(), "oneuptime-zod-bundle-"),
      );
      temporaryRoots.push(root);
      // The entry's own imports resolve as Common's do.
      fs.symlinkSync(COMMON_MODULES, path.join(root, "node_modules"), "dir");

      report = bundle(writeEntry(root));
    }, 300000);

    test("the build succeeds, and holds the Types and every model", () => {
      expect(report.error).toBe("");
      // Hundreds of models and the Types of their columns.
      expect(report.inputs).toBeGreaterThan(1000);
    });

    test("nothing of zod or zod-to-openapi is in it", () => {
      expect({
        zodBytes: report.zodBytes,
        zodToOpenApiBytes: report.zodToOpenApiBytes,
      }).toEqual({ zodBytes: 0, zodToOpenApiBytes: 0 });

      // Nor is either left for the page to load at run time.
      expect(
        report.externalImports.filter((specifier: string): boolean => {
          return (
            specifier.startsWith("zod") || specifier.includes("zod-to-openapi")
          );
        }),
      ).toEqual([]);
    });

    test("no module of Common's Utils/Schema is in it", () => {
      expect(report.schemaModules).toEqual([]);
    });

    test("in a browser the Types and the models load and work", () => {
      expect(report.probe).not.toBeNull();

      const probe: ProbeAnswer = report.probe as ProbeAnswer;

      expect({
        email: probe.email,
        objectId: probe.objectId,
        monitorStepsType: probe.monitorStepsType,
      }).toEqual({
        email: "user@example.com",
        objectId: "123e4567-e89b-12d3-a456-426614174000",
        monitorStepsType: "MonitorSteps",
      });
      expect(probe.databaseModels).toBeGreaterThan(400);
      expect(probe.analyticsModels).toBeGreaterThan(5);
    });

    test("in a browser it turns no string into code, so a page that forbids eval reports nothing", () => {
      expect(report.evaluatedCode).toEqual([]);
    });
  });
});
