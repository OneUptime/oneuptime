import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * ESLint lints every Common test inside the program of the nearest
 * tsconfig.json that includes it (projectService in eslint.config.js), one
 * ESLint process per program (Scripts/Lint/LintByProject.js), each with a
 * 12 GB heap. One program of every Common test outgrew that heap on
 * 2026-10-27: 7,996 files, killed after 916 s, and most of the memory was the
 * program itself - linting 798 of its files peaked at 9.9 GB.
 *
 * So the tests are linted in the parts `npm run compile-tests` already
 * type-checks, each holding only the sources its own tests reach:
 * Tests/App/tsconfig.json, Tests/UI/tsconfig.json and Tests/tsconfig.json
 * (the rest) each extend one. Measured that day: the rest (5,019 files)
 * peaked at 9.65 GB, Tests/App (1,776) at 7.36 GB, Tests/UI (1,201) at
 * 6.47 GB.
 *
 * These checks keep it so: each lint project is exactly its compile part;
 * every part has its lint project; every Common test is linted in exactly
 * one of them; and no part holds more than 6,000 files - past that, split
 * it the way Scripts/compile-tests.js explains, with a tsconfig.json of its
 * own in its directory, before ESLint runs out of memory again.
 */

const COMMON: string = path.resolve(__dirname, "..", "..");
const MAX_FILES_PER_PROGRAM: number = 6000;

// Each compile part, and the tsconfig.json that makes it the lint project.
const LINT_PROJECT_OF_PART: Record<string, string> = {
  "tsconfig.tests.app.json": "Tests/App/tsconfig.json",
  "tsconfig.tests.ui.json": "Tests/UI/tsconfig.json",
  "tsconfig.tests.rest.json": "Tests/tsconfig.json",
};

const rootFilesByConfig: Map<string, Set<string>> = new Map();

// The root files of a tsconfig, as TypeScript reads them.
function rootFilesOf(configPath: string): Set<string> {
  const cached: Set<string> | undefined = rootFilesByConfig.get(configPath);

  if (cached) {
    return cached;
  }

  const problems: Array<ts.Diagnostic> = [];
  const parsed: ts.ParsedCommandLine | undefined =
    ts.getParsedCommandLineOfConfigFile(configPath, undefined, {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (diagnostic: ts.Diagnostic) => {
        problems.push(diagnostic);
      },
    });

  expect([configPath, problems.length, parsed?.errors.length]).toEqual([
    configPath,
    0,
    0,
  ]);

  const files: Set<string> = new Set(
    parsed!.fileNames.map((fileName: string) => {
      return path.resolve(fileName);
    }),
  );
  rootFilesByConfig.set(configPath, files);

  return files;
}

// The parts compile-tests checks, read from the script itself.
function compileParts(): Array<string> {
  const source: string = fs.readFileSync(
    path.join(COMMON, "Scripts", "compile-tests.js"),
    "utf8",
  );
  const list: RegExpMatchArray | null = source.match(
    /const PARTS = \[([^\]]*)\]/,
  );

  expect(list).not.toBeNull();

  return [...list![1]!.matchAll(/"([^"]+)"/g)].map(
    (match: RegExpMatchArray) => {
      return match[1]!;
    },
  );
}

/*
 * The tsconfig.json TypeScript gives a file, and so ESLint's projectService:
 * the nearest one that includes it.
 */
function projectOf(file: string): string | null {
  let directory: string = path.dirname(file);

  for (;;) {
    const configPath: string = path.join(directory, "tsconfig.json");

    if (fs.existsSync(configPath) && rootFilesOf(configPath).has(file)) {
      return configPath;
    }

    if (directory === COMMON) {
      return null;
    }

    directory = path.dirname(directory);
  }
}

function inCommon(relativePath: string): string {
  return path.join(COMMON, relativePath);
}

function sameFiles(left: Set<string>, right: Set<string>): Array<string> {
  return [...left]
    .filter((file: string) => {
      return !right.has(file);
    })
    .concat(
      [...right].filter((file: string) => {
        return !left.has(file);
      }),
    )
    .map((file: string) => {
      return path.relative(COMMON, file);
    });
}

describe("Common tests are linted in the parts compile-tests checks", () => {
  test("every compile part has its lint project, and no other is listed", () => {
    expect(compileParts().sort()).toEqual(
      Object.keys(LINT_PROJECT_OF_PART).sort(),
    );
  });

  test.each(Object.entries(LINT_PROJECT_OF_PART))(
    "%s is the program %s lints in",
    (part: string, lintProject: string) => {
      // Files only one of them has: none.
      expect(
        sameFiles(
          rootFilesOf(inCommon(part)),
          rootFilesOf(inCommon(lintProject)),
        ),
      ).toEqual([]);
    },
  );

  test("every Common test is linted in exactly the part that checks it", () => {
    const testsDirectory: string = inCommon("Tests") + path.sep;
    const tests: Array<string> = [
      ...rootFilesOf(inCommon("tsconfig.tests.json")),
    ].filter((file: string) => {
      return file.startsWith(testsDirectory);
    });

    // If none were read, the checks below would pass by checking nothing.
    expect(tests.length).toBeGreaterThan(5000);

    const misplaced: Array<string> = tests
      .filter((file: string) => {
        const project: string | null = projectOf(file);
        const expected: string = file.startsWith(
          inCommon(path.join("Tests", "App")) + path.sep,
        )
          ? inCommon("Tests/App/tsconfig.json")
          : file.startsWith(inCommon(path.join("Tests", "UI")) + path.sep)
            ? inCommon("Tests/UI/tsconfig.json")
            : inCommon("Tests/tsconfig.json");

        return project !== expected;
      })
      .map((file: string) => {
        return path.relative(COMMON, file);
      });

    expect(misplaced).toEqual([]);
  });

  test.each(Object.values(LINT_PROJECT_OF_PART))(
    "%s holds at most 6,000 files: split it before ESLint runs out of memory",
    (lintProject: string) => {
      expect(rootFilesOf(inCommon(lintProject)).size).toBeLessThanOrEqual(
        MAX_FILES_PER_PROGRAM,
      );
    },
  );
});
