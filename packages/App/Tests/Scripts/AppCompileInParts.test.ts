import { describe, expect, test } from "@jest/globals";
import { spawnSync, SpawnSyncReturns } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import ts from "typescript";

/*
 * THE APP'S COMPILE TYPE-CHECKS EVERY SOURCE AND EVERY TEST, IN PROGRAMS
 * THAT EACH FIT ITS HEAP (#8503).
 *
 * `npm run compile` in packages/App was one tsc program of the App's sources
 * and its tests until 2026-11-15, when it outgrew the compile's 8 GiB heap
 * on main (16,441 files, about 9.7 GB): the Compile workflow's Compile App
 * step and the image build's `RUN npm run compile` ran out of memory. Now
 * tsconfig.json builds the sources and leaves Tests out, and
 * scripts/compile-tests.js type-checks the tests in the parts of
 * tsconfig.tests.json, one tsc process each (the script says how much of
 * the heap each used). The App's jest config transpiles only, so this is
 * the one place a test is type-checked. These checks keep it so:
 *
 *   - compile runs both halves, the sources first, and CI and the image
 *     build run compile;
 *   - the build leaves Tests out, and the whole test program holds every
 *     test file and the App's global declarations;
 *   - every part extends the whole program and changes only which files it
 *     holds, the parts between them hold every one of its files, and the
 *     script refuses to run when they do not;
 *   - every test file's nearest tsconfig.json, which editors and ESLint's
 *     typed linting give it, includes it and is a part.
 */

const APP: string = path.resolve(__dirname, "..", "..");
const REPOSITORY: string = path.resolve(APP, "..", "..");
const SCRIPT: string = path.join(APP, "scripts", "compile-tests.js");
const SCRIPT_TEXT: string = fs.readFileSync(SCRIPT, "utf8");

const WHOLE_PROGRAM: string = "tsconfig.tests.json";

// The parts the script runs, as its PARTS lists them.
function partsOfScript(scriptText: string): Array<string> {
  const list: RegExpMatchArray | null = scriptText.match(
    /const PARTS = \[([\s\S]*?)\];/,
  );

  expect(list).not.toBeNull();

  return Array.from(list![1]!.matchAll(/"([^"]+)"/g)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

const PARTS: Array<string> = partsOfScript(SCRIPT_TEXT);

// Each part's own directory, whose tsconfig.json extends it.
const LINT_PROJECT_OF_PART: Record<string, string> = {
  "tsconfig.tests.dashboard.json": "Tests/Dashboard/tsconfig.json",
  "tsconfig.tests.featureset.json": "Tests/FeatureSet/tsconfig.json",
  "tsconfig.tests.rest.json": "Tests/tsconfig.json",
};

interface ParsedConfig {
  options: ts.CompilerOptions;
  fileNames: Array<string>;
}

// A tsconfig as tsc reads it: its options, and the root files its include matches.
function parseConfig(configPath: string): ParsedConfig {
  const diagnostics: Array<ts.Diagnostic> = [];
  const parsed: ts.ParsedCommandLine | undefined =
    ts.getParsedCommandLineOfConfigFile(
      configPath,
      {},
      {
        ...ts.sys,
        onUnRecoverableConfigFileDiagnostic: (
          diagnostic: ts.Diagnostic,
        ): void => {
          diagnostics.push(diagnostic);
        },
      },
    );

  expect(diagnostics).toEqual([]);
  expect(parsed).toBeDefined();
  expect(parsed!.errors).toEqual([]);

  return {
    options: parsed!.options,
    fileNames: parsed!.fileNames.map((fileName: string): string => {
      return path.resolve(fileName);
    }),
  };
}

// The config file's own JSON, comments allowed.
function readConfigJson(configPath: string): Record<string, unknown> {
  const read: { config?: unknown; error?: ts.Diagnostic } = ts.readConfigFile(
    configPath,
    ts.sys.readFile,
  );

  expect(read.error).toBeUndefined();

  return read.config as Record<string, unknown>;
}

function inApp(file: string): string {
  return path.join(APP, file);
}

const TYPESCRIPT_FILE: RegExp = /\.tsx?$/;

// Every TypeScript file under a directory, as tsc's include would see it.
function typeScriptFilesUnder(directory: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") {
        files.push(...typeScriptFilesUnder(full));
      }
    } else if (TYPESCRIPT_FILE.test(entry.name)) {
      files.push(full);
    }
  }

  return files;
}

const BUILD: ParsedConfig = parseConfig(inApp("tsconfig.json"));
const WHOLE: ParsedConfig = parseConfig(inApp(WHOLE_PROGRAM));
const TEST_FILES: Array<string> = typeScriptFilesUnder(inApp("Tests"));

describe("npm run compile", () => {
  const manifest: { scripts: Record<string, string> } = JSON.parse(
    fs.readFileSync(inApp("package.json"), "utf8"),
  ) as { scripts: Record<string, string> };

  test("builds the sources, then type-checks the tests in parts, each with an 8 GiB heap", () => {
    expect(manifest.scripts["compile"]).toBe(
      'export NODE_OPTIONS="--max-old-space-size=8192${NODE_OPTIONS:+ $NODE_OPTIONS}" && tsc && node scripts/compile-tests.js',
    );
    expect(manifest.scripts["compile-tests"]).toBe(
      "node scripts/compile-tests.js",
    );
    expect(SCRIPT_TEXT).toContain("const HEAP_MB = 8192;");
  });

  test("is what CI's Compile App step and the image build run", () => {
    const workflow: string = fs.readFileSync(
      path.join(REPOSITORY, ".github", "workflows", "compile.yml"),
      "utf8",
    );
    const dockerfile: string = fs.readFileSync(inApp("Dockerfile.tpl"), "utf8");

    expect(workflow).toContain(
      "command: cd packages/App && npm run compile && npm run dep-check",
    );
    expect(dockerfile).toMatch(/^RUN npm run compile$/m);
  });
});

describe("the build and the test program", () => {
  test("the build leaves every test out and still holds the sources", () => {
    const tests: string = inApp("Tests") + path.sep;

    expect(
      BUILD.fileNames.filter((fileName: string): boolean => {
        return fileName.startsWith(tests);
      }),
    ).toEqual([]);
    expect(BUILD.fileNames).toContain(inApp("Index.ts"));
    expect(BUILD.fileNames.length).toBeGreaterThan(500);
  });

  test("the test program holds every test file under Tests, and the App's global declarations", () => {
    expect(TEST_FILES.length).toBeGreaterThan(2000);

    const held: Set<string> = new Set<string>(WHOLE.fileNames);

    expect(
      TEST_FILES.filter((file: string): boolean => {
        return !held.has(file);
      }),
    ).toEqual([]);
    expect(held.has(inApp("Typings/ImageFiles.d.ts"))).toBe(true);
  });

  test("the test program only type-checks, with the build's rules", () => {
    expect(WHOLE.options.noEmit).toBe(true);
    expect(readConfigJson(inApp(WHOLE_PROGRAM))["extends"]).toBe(
      "./tsconfig.json",
    );

    for (const option of [
      "strict",
      "target",
      "module",
      "jsx",
      "exactOptionalPropertyTypes",
      "noUncheckedIndexedAccess",
      "experimentalDecorators",
    ]) {
      expect([option, WHOLE.options[option]]).toEqual([
        option,
        BUILD.options[option],
      ]);
    }

    expect(WHOLE.options.paths).toEqual(BUILD.options.paths);
  });
});

describe("the parts of the test program", () => {
  test("are the three the script runs", () => {
    expect(PARTS).toEqual([
      "tsconfig.tests.dashboard.json",
      "tsconfig.tests.featureset.json",
      "tsconfig.tests.rest.json",
    ]);
  });

  test("each extends the whole program and changes only which files it holds", () => {
    for (const part of PARTS) {
      const json: Record<string, unknown> = readConfigJson(inApp(part));

      expect([part, json["extends"]]).toEqual([part, `./${WHOLE_PROGRAM}`]);
      expect([part, json["compilerOptions"]]).toEqual([part, undefined]);
      expect([part, json["files"]]).toEqual([part, undefined]);
      expect([part, parseConfig(inApp(part)).options.noEmit]).toEqual([
        part,
        true,
      ]);
    }
  });

  test("hold every file of the whole program between them, each test in one", () => {
    const partsOfFile: Map<string, Array<string>> = new Map<
      string,
      Array<string>
    >();

    for (const part of PARTS) {
      for (const fileName of parseConfig(inApp(part)).fileNames) {
        partsOfFile.set(fileName, [...(partsOfFile.get(fileName) || []), part]);
      }
    }

    expect(
      WHOLE.fileNames.filter((fileName: string): boolean => {
        return !partsOfFile.has(fileName);
      }),
    ).toEqual([]);

    // A test checked twice costs time: only the global declarations are in every part.
    expect(
      TEST_FILES.filter((file: string): boolean => {
        return (partsOfFile.get(file) || []).length !== 1;
      }),
    ).toEqual([]);
  });

  test("each part's directory has a tsconfig.json that is exactly that part", () => {
    expect(Object.keys(LINT_PROJECT_OF_PART).sort()).toEqual([...PARTS].sort());

    for (const part of PARTS) {
      const project: string = LINT_PROJECT_OF_PART[part]!;
      const json: Record<string, unknown> = readConfigJson(inApp(project));

      expect([project, json["extends"]]).toEqual([
        project,
        path
          .relative(path.dirname(inApp(project)), inApp(part))
          .split(path.sep)
          .join("/"),
      ]);
      expect(Object.keys(json)).toEqual(["extends"]);
      expect([project, parseConfig(inApp(project)).fileNames.sort()]).toEqual([
        project,
        parseConfig(inApp(part)).fileNames.sort(),
      ]);
    }
  });

  test("every test file's nearest tsconfig.json includes it, as editors and ESLint read it", () => {
    const projectFiles: Map<string, Set<string>> = new Map<
      string,
      Set<string>
    >();
    const misplaced: Array<string> = [];

    for (const file of TEST_FILES) {
      let directory: string = path.dirname(file);

      while (!fs.existsSync(path.join(directory, "tsconfig.json"))) {
        directory = path.dirname(directory);
      }

      const project: string = path.join(directory, "tsconfig.json");

      if (!projectFiles.has(project)) {
        projectFiles.set(
          project,
          new Set<string>(parseConfig(project).fileNames),
        );
      }

      if (!projectFiles.get(project)!.has(file)) {
        misplaced.push(
          `${path.relative(APP, file)} (nearest: ${path.relative(APP, project)})`,
        );
      }
    }

    expect(misplaced).toEqual([]);
    expect(
      Array.from(projectFiles.keys())
        .map((project: string): string => {
          return path.relative(APP, project).split(path.sep).join("/");
        })
        .sort(),
    ).toEqual(Object.values(LINT_PROJECT_OF_PART).sort());
  });
});

describe("scripts/compile-tests.js", () => {
  /*
   * A copy of the App's configs and the script in a directory of its own,
   * with one part left out, so the script's own check runs for real.
   */
  test("refuses to run when the parts leave a test out, naming it", () => {
    const sandbox: string = fs.mkdtempSync(
      path.join(os.tmpdir(), "app-compile-tests-"),
    );

    try {
      fs.mkdirSync(path.join(sandbox, "scripts"));
      fs.mkdirSync(path.join(sandbox, "Tests", "Dashboard"), {
        recursive: true,
      });
      fs.mkdirSync(path.join(sandbox, "Tests", "Workers"), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(sandbox, "Tests", "Dashboard", "Kept.test.ts"),
        "export const kept: number = 1;\n",
      );
      fs.writeFileSync(
        path.join(sandbox, "Tests", "Workers", "Left.test.ts"),
        "export const left: number = 1;\n",
      );
      fs.writeFileSync(
        path.join(sandbox, "tsconfig.json"),
        JSON.stringify({ compilerOptions: { strict: true } }),
      );
      fs.writeFileSync(
        path.join(sandbox, WHOLE_PROGRAM),
        JSON.stringify({
          extends: "./tsconfig.json",
          compilerOptions: { noEmit: true },
          include: ["Tests/**/*.ts"],
        }),
      );
      fs.writeFileSync(
        path.join(sandbox, "tsconfig.tests.dashboard.json"),
        JSON.stringify({
          extends: `./${WHOLE_PROGRAM}`,
          include: ["Tests/Dashboard/**/*.ts"],
        }),
      );
      // The other two parts hold a test each, and Tests/Workers is in none.
      for (const [part, directory] of [
        ["tsconfig.tests.featureset.json", "FeatureSet"],
        ["tsconfig.tests.rest.json", "Runbook"],
      ] as Array<[string, string]>) {
        fs.mkdirSync(path.join(sandbox, "Tests", directory));
        fs.writeFileSync(
          path.join(sandbox, "Tests", directory, "Kept.test.ts"),
          "export const kept: number = 1;\n",
        );
        fs.writeFileSync(
          path.join(sandbox, part),
          JSON.stringify({
            extends: `./${WHOLE_PROGRAM}`,
            include: [`Tests/${directory}/**/*.ts`],
          }),
        );
      }
      fs.copyFileSync(
        SCRIPT,
        path.join(sandbox, "scripts", "compile-tests.js"),
      );
      fs.symlinkSync(
        path.join(APP, "node_modules"),
        path.join(sandbox, "node_modules"),
        "dir",
      );

      const run: SpawnSyncReturns<string> = spawnSync(
        process.execPath,
        [path.join(sandbox, "scripts", "compile-tests.js")],
        { cwd: sandbox, encoding: "utf8" },
      );

      expect(run.status).toBe(1);
      expect(run.stderr).toContain(
        "compile-tests: 1 file(s) of tsconfig.tests.json are in none of its parts",
      );
      expect(run.stderr).toContain(
        path.join("Tests", "Workers", "Left.test.ts"),
      );
      // Refused before any part ran.
      expect(run.stdout).not.toContain("compile-tests: type-checking");
    } finally {
      fs.rmSync(sandbox, { recursive: true, force: true });
    }
  });
});
