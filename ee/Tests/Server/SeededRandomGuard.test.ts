import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";
import { seededRandom } from "Common/Tests/Helpers/SeededRandom";
import {
  HandRolledGenerator,
  SEEDED_RANDOM_FIX,
  describeGenerator,
  findHandRolledGenerators,
  reportHandRolledGenerators,
} from "Common/Tests/Helpers/SeededRandomScan";
import {
  REPOSITORY_DIRECTORY,
  listTestFiles,
} from "Common/Tests/Helpers/TagStripScan";

/*
 * ee/'s tests draw from the one seeded generator too.
 *
 * packages/Common/Tests/Helpers/SeededRandomGuard.test.ts fails any test
 * file that rolls a pseudo-random generator of its own - a copy of
 * `state * 1103515245 + 12345`, mulberry32, an xorshift - instead of drawing
 * from Common/Tests/Helpers/SeededRandom, the suites' one generator. It
 * walks every test file of the checkout, but the Common Test job removes
 * ee/ before it runs (core passes without the Enterprise Edition), so in CI
 * it never reads one of ee/'s. This suite runs the same detector
 * (Common/Tests/Helpers/SeededRandomScan) over ee/'s test files, from ee's
 * own jest run: the Enterprise Edition Test job, the only one with ee/
 * checked out.
 *
 * ee/'s test files are what the walk of the whole checkout reads under ee/:
 * every file of code under ee/Tests, and any *.test.* or *.spec.* file
 * elsewhere in ee/, outside node_modules, builds and hidden folders.
 *
 * The generators the negative controls plant are written with their numbers
 * substituted in, so this file holds none itself.
 */

const EE_DIR: string = path.resolve(__dirname, "..", "..");
const REPOSITORY_ROOT: string = path.resolve(EE_DIR, "..");

// Lines of code, as a file.
const code: (...lines: Array<string>) => string = (
  ...lines: Array<string>
): string => {
  return lines.join("\n");
};

// The generators in ee/'s test files under a checkout's root, as a failure lists them.
const generatorsInEe: (root: string) => Array<string> = (
  root: string,
): Array<string> => {
  return reportHandRolledGenerators(
    listTestFiles(path.join(root, "ee"), root),
    root,
  ).map(describeGenerator);
};

const ANSI: string = "1103515245";
const MULBERRY: string = "0x6d2b79f5";
const SHIFT_LEFT: string = "<<";

describe("ee/'s tests draw from the one seeded generator", () => {
  const eeTestFiles: Array<string> = listTestFiles(EE_DIR, REPOSITORY_ROOT);

  test("the shared detector reads this checkout", () => {
    expect(REPOSITORY_DIRECTORY).toBe(REPOSITORY_ROOT);
  });

  test("the walk reads ee/'s test files, helpers and fixtures included", () => {
    /*
     * Guards the guard: a moved folder or a broken walk would otherwise
     * leave the scan below passing over nothing.
     */
    expect(eeTestFiles.length).toBeGreaterThan(50);
    expect(eeTestFiles).toEqual(
      expect.arrayContaining([
        "ee/Tests/Server/SeededRandomGuard.test.ts",
        "ee/Tests/Server/License/Helpers/LicenseTestKit.ts",
        "ee/Tests/UI/TeamCompliance/ComplianceFixtures.ts",
        "ee/Tests/UI/Identity/ScimForms.test.tsx",
      ]),
    );
    expect(
      eeTestFiles.every((file: string): boolean => {
        return file.startsWith("ee/");
      }),
    ).toBe(true);
  });

  test("finds no ee/ test file that rolls a generator of its own", () => {
    // The strings ARE the message: a failure names every file and line.
    expect(generatorsInEe(REPOSITORY_ROOT)).toEqual([]);
  });

  test("what the findings say to draw from instead works from ee/'s tests", () => {
    expect(SEEDED_RANDOM_FIX).toContain(
      'import { seededRandom } from "Common/Tests/Helpers/SeededRandom"',
    );

    // It resolves through the "Common/..." specifier ee/'s tests import with.
    const random: (limit?: number) => number = seededRandom(20261011);
    const draw: number = random(6);

    expect(Number.isInteger(draw) && draw >= 0 && draw < 6).toBe(true);
    expect(seededRandom(20261011)(6)).toBe(draw);
  });
});

describe("negative controls: the same pipeline catches an ee/ test that rolls a generator", () => {
  test("a copied generator in an ee/ server test is found, with its line", () => {
    expect(
      findHandRolledGenerators(
        "ee/Tests/Server/License/LicenseFuzz.test.ts",
        code(
          'import { expect, test } from "@jest/globals";',
          "let seed: number = 7;",
          `seed = (seed * ${ANSI} + 12345) & 0x7fffffff;`,
        ),
      ).map((generator: HandRolledGenerator): [number, string] => {
        return [generator.line, generator.finding];
      }),
    ).toEqual([[3, "a multiply by the ANSI C / glibc LCG's 1103515245"]]);
  });

  describe("an ee/ test file planted in a checkout", () => {
    const PLANTED: Record<string, string> = {
      "ee/Tests/Server/License/LicenseFuzz.test.ts": code(
        "let seed: number = 7;",
        `seed = (seed * ${ANSI} + 12345) & 0x7fffffff;`,
      ),
      "ee/Tests/UI/License/Helpers/Shuffle.ts": code(
        "export const next = (state: number): number => {",
        `  state = (state + ${MULBERRY}) >>> 0;`,
        "  return state;",
        "};",
      ),
      "ee/Dashboard/Widget.test.tsx": code(
        `x ^= x ${SHIFT_LEFT} 13;`,
        "const view = <div />;",
      ),
      // Drawing from the one generator: passed.
      "ee/Tests/Server/Clean.test.ts": code(
        'import { seededRandom } from "Common/Tests/Helpers/SeededRandom";',
        "const random: () => number = seededRandom(1);",
      ),
      // Product code, and a core test beside ee/: not ee/'s tests to read.
      "ee/Server/Jitter.ts": code(`state = (state * ${ANSI}) >>> 0;`),
      "packages/Some/Tests/Gen.test.ts": code(
        `state = (state * ${ANSI}) >>> 0;`,
      ),
    };

    let root: string = "";

    beforeAll(() => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), "ee-seeded-random-"));

      for (const [file, text] of Object.entries(PLANTED)) {
        fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
        fs.writeFileSync(path.join(root, file), text);
      }
    });

    afterAll(() => {
      fs.rmSync(root, { recursive: true, force: true });
    });

    test("is reported by file and line, and only ee/'s test files are", () => {
      expect(generatorsInEe(root)).toEqual([
        "ee/Dashboard/Widget.test.tsx:1 rolls its own generator (an xorshift step).",
        "ee/Tests/Server/License/LicenseFuzz.test.ts:2 rolls its own generator (a multiply by the ANSI C / glibc LCG's 1103515245).",
        "ee/Tests/UI/License/Helpers/Shuffle.ts:2 rolls its own generator (mulberry32's step).",
      ]);
    });
  });
});
