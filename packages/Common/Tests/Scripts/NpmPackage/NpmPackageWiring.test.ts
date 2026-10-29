import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import yaml from "js-yaml";
import os from "os";
import path from "path";
import ts from "typescript";
import {
  COMMON_ROOT,
  LEFT_OUT,
  NODE_ENGINE,
  PACKAGE_DIRECTORY,
  PINNED_LEFT_OUT,
  PUBLIC_DIRECTORIES,
  PUBLIC_FILES,
  ROOT_EXPORTS,
  RootExport,
  compileRoots,
  declaredExports,
} from "../../../Scripts/NpmPackage/BuildNpmPackage";
import {
  CORE_MODULES,
  PACKAGE_NAME,
  ROOT_VALUES,
  TYPESCRIPT_MODES,
  TypeScriptMode,
  apiAndModelsProblems,
  isNetworkFailure,
  lastJsonLine,
  publishedModules,
} from "../../../Scripts/NpmPackage/SmokeTestNpmPackage";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";

/*
 * How what npm publishes as @oneuptime/common is wired into this
 * repository: what the build starts from in the real Common, the package
 * root's exports and the modules it leaves out on purpose, the scripts that
 * build and smoke-test it, the release that publishes it, the CI job that
 * runs the smoke test on every Node.js line the package supports, and what
 * README.md - the page npm shows - says about it.
 */

const REPOSITORY_ROOT: string = path.resolve(COMMON_ROOT, "..", "..");

// The end of a PINNED_LEFT_OUT reason: the module of Common's that keeps it out, as (Server/...) or (UI/...).
const WHAT_IT_LOADS: RegExp = /\(((?:Server|UI)\/[A-Za-z/]+)\)$/;

function read(relative: string): string {
  return fs.readFileSync(path.join(REPOSITORY_ROOT, relative), "utf8");
}

// The source file of a module of Common, by its id.
function sourceOf(id: string): string | null {
  for (const extension of [".ts", ".tsx"]) {
    const file: string = path.join(COMMON_ROOT, `${id}${extension}`);

    if (fs.existsSync(file)) {
      return file;
    }
  }

  return null;
}

// Every TypeScript source under a directory of Common, as absolute paths.
function sourcesUnder(directory: string): Array<string> {
  const found: Array<string> = [];

  const walk: (current: string) => void = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full: string = path.join(current, entry.name);

      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") {
          walk(full);
        }
      } else if (
        (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
        !entry.name.endsWith(".d.ts")
      ) {
        found.push(full);
      }
    }
  };

  walk(path.join(COMMON_ROOT, directory));

  return found;
}

describe("what the build of Common starts from", () => {
  const roots: Array<string> = compileRoots(COMMON_ROOT);
  const relative: Array<string> = roots.map((file: string): string => {
    return path.relative(COMMON_ROOT, file).split(path.sep).join("/");
  });

  test("every module of Types/, Utils/ and Models/, and ServiceRoute", () => {
    const expected: Array<string> = [
      ...PUBLIC_DIRECTORIES.flatMap((directory: string): Array<string> => {
        return sourcesUnder(directory);
      }),
      path.join(COMMON_ROOT, "ServiceRoute.ts"),
    ];

    expect(PUBLIC_DIRECTORIES).toEqual(["Types", "Utils", "Models"]);
    expect(PUBLIC_FILES).toEqual(["ServiceRoute"]);
    expect(expected.length).toBeGreaterThan(2000);

    for (const file of expected) {
      expect(roots).toContain(file);
    }
  });

  test("with the ambient declarations Common compiles with, and nothing of the server, the UI, the tests or the scripts", () => {
    expect(relative).toContain("Typings/Index.d.ts");
    expect(relative).toContain("UI/index.d.ts");

    const elsewhere: Array<string> = relative.filter((file: string) => {
      return !(
        PUBLIC_DIRECTORIES.some((directory: string): boolean => {
          return file.startsWith(`${directory}/`);
        }) ||
        file === "ServiceRoute.ts" ||
        file.startsWith("Typings/") ||
        file === "UI/index.d.ts"
      );
    });

    expect(elsewhere).toEqual([]);
  });

  test("writes what npm publishes into build/npm/package, the directory the release publishes", () => {
    expect(PACKAGE_DIRECTORY).toBe(
      path.join(COMMON_ROOT, "build", "npm", "package"),
    );
    expect(read("Scripts/NPM/PublishAllPackages.sh")).toContain(
      `publish_to_npm "packages/Common" "${path
        .relative(COMMON_ROOT, PACKAGE_DIRECTORY)
        .split(path.sep)
        .join("/")}"`,
    );
    expect(read(".gitignore").split("\n")).toContain(
      "packages/Common/build/npm/",
    );

    const jest: { modulePathIgnorePatterns: Array<string> } = JSON.parse(
      read("packages/Common/jest.config.json"),
    ) as { modulePathIgnorePatterns: Array<string> };

    // Its package.json is named @oneuptime/common too: jest must not crawl it.
    expect(jest.modulePathIgnorePatterns).toContain("<rootDir>/build/npm/");
  });
});

describe("the package root, and what is left out on purpose", () => {
  test("names each export once, from a module of Common that has it", () => {
    const names: Array<string> = ROOT_EXPORTS.map(
      (entry: RootExport): string => {
        return entry.name;
      },
    );

    expect(new Set(names).size).toBe(names.length);

    for (const entry of ROOT_EXPORTS) {
      const source: string | null = sourceOf(entry.module);

      expect({ entry, source: source !== null }).toEqual({
        entry,
        source: true,
      });

      const exported: Set<string> = declaredExports(
        ts,
        source as string,
        fs.readFileSync(source as string, "utf8"),
      );

      expect({
        entry,
        declared: exported.has(entry.export || "default"),
      }).toEqual({
        entry,
        declared: true,
      });
    }
  });

  test("hands out, when the code runs, exactly what the smoke test expects of it", () => {
    expect(Object.keys(ROOT_VALUES).sort()).toEqual(
      ROOT_EXPORTS.filter((entry: RootExport): boolean => {
        return !entry.typeOnly;
      })
        .map((entry: RootExport): string => {
          return entry.name;
        })
        .sort(),
    );
  });

  test("leaves out on purpose modules that exist, each with its reason", () => {
    expect(Object.keys(LEFT_OUT)).toEqual(["Utils/Analytics"]);

    for (const [id, reason] of Object.entries(LEFT_OUT)) {
      expect({ id, source: sourceOf(id) !== null }).toEqual({
        id,
        source: true,
      });
      expect(reason.length).toBeGreaterThan(20);
    }

    // Utils/Analytics is the web apps' product analytics: posthog-js.
    expect(read("packages/Common/Utils/Analytics.ts")).toContain(
      'from "posthog-js"',
    );
  });

  test("pins every other module it leaves out: each exists under Types/, Utils/ or Models/, says why and what it loads, in order, and none twice", () => {
    const pinned: Array<string> = Object.keys(PINNED_LEFT_OUT);

    // The build fails on any other set; npm run build-npm-package says which.
    expect(pinned.length).toBeGreaterThan(10);
    expect(pinned).toEqual([...pinned].sort());

    for (const [id, why] of Object.entries(PINNED_LEFT_OUT)) {
      expect({
        id,
        source: sourceOf(id) !== null,
        public: PUBLIC_DIRECTORIES.includes(id.split("/")[0] as string),
        alsoOnPurpose: id in LEFT_OUT,
      }).toEqual({ id, source: true, public: true, alsoOnPurpose: false });

      // What it loads that keeps it out, named at the end: (Server/...) or (UI/...).
      expect({
        id,
        why: why.length > 20,
        names: WHAT_IT_LOADS.test(why),
      }).toEqual({ id, why: true, names: true });
      // A module of Common's that is there.
      const loads: string = (
        WHAT_IT_LOADS.exec(why) as RegExpExecArray
      )[1] as string;

      expect({ id, loads, exists: sourceOf(loads) !== null }).toEqual({
        id,
        loads,
        exists: true,
      });
    }
  });

  test("supports the maintained Node.js lines", () => {
    expect(NODE_ENGINE).toBe(">=22");
  });
});

describe("the scripts", () => {
  const manifest: { scripts: Record<string, string> } = JSON.parse(
    read("packages/Common/package.json"),
  ) as { scripts: Record<string, string> };

  test("npm run build-npm-package builds the package, and npm run smoke-test-npm-package tests it", () => {
    expect(manifest.scripts["build-npm-package"]).toBe(
      "node --max-old-space-size=8192 Scripts/NpmPackage/BuildNpmPackage.js",
    );
    expect(manifest.scripts["smoke-test-npm-package"]).toBe(
      "node Scripts/NpmPackage/SmokeTestNpmPackage.js",
    );
  });

  test("Common's own manifest stays the monorepo's: no exports map, and its compile untouched", () => {
    const common: Record<string, unknown> = JSON.parse(
      read("packages/Common/package.json"),
    ) as Record<string, unknown>;

    // An exports map here would redirect every require("Common/...") (#4877).
    expect(common["exports"]).toBeUndefined();
    expect(common["name"]).toBe(PACKAGE_NAME);
    expect(manifest.scripts["compile"]).toBe("tsc");
  });

  test("the smoke test names modules every build has, and checks the types in each module mode", () => {
    for (const id of CORE_MODULES) {
      expect({ id, source: sourceOf(id) !== null }).toEqual({
        id,
        source: true,
      });
    }

    expect(
      TYPESCRIPT_MODES.map((mode: TypeScriptMode): Array<unknown> => {
        return [
          mode.extension,
          mode.options["module"],
          mode.options["moduleResolution"],
        ];
      }),
    ).toEqual([
      [".cts", "nodenext", "nodenext"],
      [".mts", "nodenext", "nodenext"],
      [".ts", "esnext", "bundler"],
      [".ts", "commonjs", "node10"],
    ]);
  });
});

describe("the smoke test's own reading", () => {
  let scratch: string = "";

  beforeAll(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "oneuptime-smoke-read-"));
  });

  afterAll(() => {
    if (scratch) {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });

  test("lists the modules an installed package publishes: its JavaScript under the public directories, and ServiceRoute", () => {
    for (const file of [
      "index.js",
      "ServiceRoute.js",
      "Types/ObjectID.js",
      "Types/ObjectID.mjs",
      "Types/ObjectID.d.ts",
      "Types/API/URL.js",
      "Models/DatabaseModels/Index.js",
      "Server/Types/Query.d.ts",
      "UI/Dropdown.d.ts",
    ]) {
      const full: string = path.join(scratch, file);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, "");
    }

    expect(publishedModules(scratch)).toEqual([
      "Models/DatabaseModels/Index",
      "ServiceRoute",
      "Types/API/URL",
      "Types/ObjectID",
    ]);
  });

  test("reads a check's report past what a module printed before it", () => {
    expect(lastJsonLine('loading...\n{"loaded":3,"failures":[]}\n\n')).toEqual({
      loaded: 3,
      failures: [],
    });
    expect(() => {
      lastJsonLine("no report at all");
    }).toThrow("printed no report");
  });

  test("tries npm install again only when it failed on the network", () => {
    for (const stderr of [
      "npm error code ECONNRESET\nnpm error network aborted",
      "npm error network This is a problem related to network connectivity.",
      "npm error code E503",
      "npm ERR! code ETIMEDOUT",
      "npm error request to https://registry.npmjs.org/zod failed, reason: socket hang up",
    ]) {
      expect({ stderr, retried: isNetworkFailure(stderr) }).toEqual({
        stderr,
        retried: true,
      });
    }

    for (const stderr of [
      "npm error code ERESOLVE",
      "npm error code E404",
      "npm error code ETARGET",
      "a log line that mentions ECONNRESET",
      "npm error Could not resolve dependency: ECONNRESETTER@1.0.0",
    ]) {
      expect({ stderr, retried: isNetworkFailure(stderr) }).toEqual({
        stderr,
        retried: false,
      });
    }
  });

  test("its network check takes time in line with the text it reads", () => {
    const text: string = `npm error ${"E".repeat(400000)}\n`.repeat(2);
    const timed: FastestRun<void> = fastestRun({
      run: (): void => {
        expect(isNetworkFailure(text)).toBe(false);
      },
      limitInMs: 2000,
    });
    expect(timed.inMs).toBeLessThan(2000);
  });

  // What the use of the API, JSON and the models prints when all is right.
  const GOOD: Record<string, unknown> = {
    listed: {
      isResponse: true,
      isError: false,
      statusCode: 200,
      data: {
        data: [
          {
            _id: "4b6c4d6a-2a8b-4c5e-9f1a-0d3e2c1b0a99",
            title: "Database is slow",
          },
        ],
        count: 1,
      },
    },
    refused: { isError: true, statusCode: 404, message: "Not found" },
    json: {
      serialized: {
        id: {
          _type: "ObjectID",
          value: "4b6c4d6a-2a8b-4c5e-9f1a-0d3e2c1b0a99",
        },
        at: { _type: "DateTime", value: "2026-10-25T10:00:00.000Z" },
      },
      idIsObjectID: true,
      idIsDeepObjectID: true,
      id: "4b6c4d6a-2a8b-4c5e-9f1a-0d3e2c1b0a99",
      atIsDate: true,
      at: "2026-10-25T10:00:00.000Z",
    },
    models: {
      databaseModels: 516,
      allClasses: true,
      hasIncident: true,
      analyticsModels: 29,
      tableName: "Incident",
      title: "Database is slow",
      website: "Website",
    },
  };

  test("finds nothing wrong with a use that went right, and names each part that did not", () => {
    expect(apiAndModelsProblems(GOOD)).toEqual([]);

    const wrong: (
      change: (report: Record<string, any>) => void,
    ) => Array<string> = (
      change: (report: Record<string, any>) => void,
    ): Array<string> => {
      const report: Record<string, any> = JSON.parse(JSON.stringify(GOOD));
      change(report);
      return apiAndModelsProblems(report);
    };

    expect(
      wrong((report: Record<string, any>) => {
        report["listed"].isError = true;
      })[0],
    ).toContain("the list call");
    expect(
      wrong((report: Record<string, any>) => {
        report["refused"].statusCode = 500;
      })[0],
    ).toContain("the refused call's status");
    expect(
      wrong((report: Record<string, any>) => {
        report["json"].idIsDeepObjectID = false;
      })[0],
    ).toContain("the deserialized ID and date");
    expect(
      wrong((report: Record<string, any>) => {
        report["models"].hasIncident = false;
      })[0],
    ).toContain("the models");
    expect(
      wrong((report: Record<string, any>) => {
        report["models"].databaseModels = 3;
      })[0],
    ).toContain("the database models: 3");
    expect(apiAndModelsProblems({}).length).toBeGreaterThan(3);
  });
});

describe("CI", () => {
  interface WorkflowStep {
    name?: string;
    uses?: string;
    run?: string;
    with?: Record<string, string>;
    "working-directory"?: string;
  }

  const workflow: {
    jobs: Record<
      string,
      {
        steps: Array<WorkflowStep>;
        permissions?: Record<string, string>;
        "timeout-minutes"?: number;
      }
    >;
  } = yaml.load(read(".github/workflows/test.common.yaml")) as {
    jobs: Record<
      string,
      {
        steps: Array<WorkflowStep>;
        permissions?: Record<string, string>;
        "timeout-minutes"?: number;
      }
    >;
  };
  const job: {
    steps: Array<WorkflowStep>;
    permissions?: Record<string, string>;
    "timeout-minutes"?: number;
  } = workflow.jobs["npm-package"] as {
    steps: Array<WorkflowStep>;
    permissions?: Record<string, string>;
    "timeout-minutes"?: number;
  };
  const steps: Array<WorkflowStep> = job.steps;
  const indexOf: (matches: (step: WorkflowStep) => boolean) => number = (
    matches: (step: WorkflowStep) => boolean,
  ): number => {
    return steps.findIndex(matches);
  };

  test("Common Test builds the package as the release does and packs it as npm publish does", () => {
    const removal: number = indexOf((step: WorkflowStep): boolean => {
      return (step.run || "").trim() === "rm -rf ee";
    });
    const install: number = indexOf((step: WorkflowStep): boolean => {
      return (
        step.uses === "./.github/actions/npm-install" &&
        step.with?.["working-directory"] === "packages/Common"
      );
    });
    const build: number = indexOf((step: WorkflowStep): boolean => {
      return (step.run || "").includes("npm run build-npm-package");
    });

    // Core is the Community Edition: ee/ goes before anything is installed.
    expect(removal).toBeGreaterThan(-1);
    expect(install).toBeGreaterThan(removal);
    expect(build).toBeGreaterThan(install);
    expect(steps[build]?.["working-directory"]).toBe("packages/Common");
    expect(steps[build]?.run).toContain(
      'npm pack ./build/npm/package --pack-destination "$RUNNER_TEMP/common-package"',
    );
    // It reads the checkout and the registry, and writes nothing.
    expect(job.permissions).toEqual({ contents: "read" });
    expect(job["timeout-minutes"]).toBeLessThanOrEqual(30);
  });

  test("and installs and uses the tarball on Node.js 26, then on every older line the package supports", () => {
    const minimum: number = Number(NODE_ENGINE.replace(">=", ""));
    const lines: Array<number> = [];
    let node: number | undefined = undefined;

    for (const step of steps) {
      if (step.uses === "actions/setup-node@v4") {
        node = Number(step.with?.["node-version"]);
      }

      if ((step.run || "").includes("SmokeTestNpmPackage.js")) {
        expect(step.run).toBe(
          'node Scripts/NpmPackage/SmokeTestNpmPackage.js --tarball "$RUNNER_TEMP"/common-package/oneuptime-common-*.tgz',
        );
        expect(step["working-directory"]).toBe("packages/Common");
        expect(step.name).toBe(
          `Install it in a new project and use it, on Node.js ${node}`,
        );
        lines.push(node as number);
      }
    }

    const expected: Array<number> = [];

    for (let line: number = 26; line >= minimum; line -= 2) {
      expected.push(line);
    }

    expect(lines).toEqual(expected);
    expect(lines).toEqual([26, 24, 22]);
  });
});

describe("README.md, the page npm shows", () => {
  const readme: string = read("packages/Common/README.md");

  test("says which Node.js it needs, and how to install it", () => {
    expect(readme).toContain(
      `It needs Node.js ${NODE_ENGINE.replace(">=", "")} or later, and works with \`require\` and with \`import\`.`,
    );
    expect(readme).toContain(`npm install ${PACKAGE_NAME}`);
  });

  /*
   * Common's modules change with every release (a data model gains the
   * columns its release added), and a package of another version can name
   * fields a self-hosted OneUptime does not have: the version is the
   * release's, and the README says to install that one, exactly.
   */
  test("says it has OneUptime's version number, and to install the version of the OneUptime it calls, exactly", () => {
    const common: { version: string } = JSON.parse(
      read("packages/Common/package.json"),
    ) as { version: string };

    // The repository's packages all have VERSION's number, Common among them.
    expect(common.version).toBe(read("VERSION").trim());
    // The release sets it before the build reads it into the npm manifest.
    expect(read("Scripts/NPM/PublishAllPackages.sh")).toContain(
      'npm version --allow-same-version "$package_version"',
    );

    expect(readme).toContain(
      "It is released with OneUptime, with the same version number,",
    );
    expect(readme).toContain(
      `npm install --save-exact ${PACKAGE_NAME}@<your-oneuptime-version>`,
    );
  });

  test("names everything the package root exports", () => {
    for (const entry of ROOT_EXPORTS) {
      expect({
        name: entry.name,
        named: readme.includes(`\`${entry.name}\``),
      }).toEqual({
        name: entry.name,
        named: true,
      });
    }
  });

  test("shows imports of modules the package publishes, by the paths it opens", () => {
    for (const id of [
      "Types/ObjectID",
      "Types/Monitor/MonitorType",
      "Models/DatabaseModels/Incident",
    ]) {
      expect(readme).toContain(`"${PACKAGE_NAME}/${id}"`);
      expect(sourceOf(id)).not.toBeNull();
    }
  });

  test("says how the repository builds and tests it", () => {
    expect(readme).toContain("npm run build-npm-package");
    expect(readme).toContain("npm run smoke-test-npm-package");
    expect(readme).toContain("Scripts/NPM/PublishAllPackages.sh");
  });
});
