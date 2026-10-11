import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";
import {
  HandRolledGenerator,
  LCG_MULTIPLIERS,
  SEEDED_RANDOM_FIX,
  SEEDED_RANDOM_HELPER,
  WEYL_INCREMENTS,
  describeGenerator,
  findHandRolledGenerators,
  reportHandRolledGenerators,
  valueOf,
} from "./SeededRandomScan";
import { REPOSITORY_DIRECTORY, listTestFiles } from "./TagStripScan";

/*
 * EVERY TEST DRAWS FROM ONE SEEDED GENERATOR.
 *
 * Property tests, fuzz sweeps and generated fixtures need numbers that are
 * the same on every run. Suites wrote their own generators for that - 76
 * files carried one - and the most copied, `state * 1103515245 + 12345`
 * with a plain "*", repeats: its multiply passes 2^53, so its state falls
 * into a loop of 10,466 values within a few thousand draws and its low bits
 * stop changing. A suite that asked it for 20,000 texts got 48 to about a
 * thousand different ones. Others read the low bits of a power-of-two
 * generator, which go round every 2, 4, 8 ... draws.
 *
 * Now every test draws from Tests/Helpers/SeededRandom (texts from an
 * alphabet: Tests/Helpers/GeneratedTexts), and this guard reads every test
 * file of the checkout - the walk of TestTagStripGuard: every file of code
 * under a Tests, tests or __tests__ folder, every *.test.* and *.spec.*
 * file, and all of packages/E2E - and fails on any that rolls a generator
 * of its own (Tests/Helpers/SeededRandomScan says what that is: a multiply
 * by an LCG's multiplier, mulberry32's step, an xorshift step, in code or in
 * a script a child process or a page runs).
 *
 * The generators this file must find are written with their numbers
 * substituted in (`${...}`), so it holds none itself. ee/'s tests are read
 * by ee/Tests/Server/SeededRandomGuard.test.ts, from ee's own suite: the
 * Common Test job removes ee/ before it runs.
 */

// Thousands of files are read: a second or two here, more on a runner.
const SCAN_TIMEOUT_IN_MS: number = 300000;

// Lines of code, as a file.
const code: (...lines: Array<string>) => string = (
  ...lines: Array<string>
): string => {
  return lines.join("\n");
};

// What the detector found in a file of code: the line and the finding.
const findingsIn: (file: string, text: string) => Array<[number, string]> = (
  file: string,
  text: string,
): Array<[number, string]> => {
  return findHandRolledGenerators(file, text).map(
    (generator: HandRolledGenerator): [number, string] => {
      return [generator.line, generator.finding];
    },
  );
};

// The numbers the generators below are made of, written as they are in tests.
const ANSI: string = "1103515245";
const ANSI_IN_HEX: string = "0x41c64e6d";
const NUMERICAL_RECIPES: string = "1664525";
const PARK_MILLER: string = "16_807";
const PARK_MILLER_2: string = "48271";
const BORLAND: string = "22695477";
const CLASSIC: string = "9301";
const KNUTH_64: string = "6364136223846793005n";
const MULBERRY: string = "0x6d2b79f5";
const SPLITMIX: string = "0x9e3779b97f4a7c15n";
const SHIFT_LEFT: string = "<<";

const ANSI_FINDING: string =
  "a multiply by the ANSI C / glibc LCG's 1103515245";

describe("every test draws from one seeded generator", () => {
  const testFiles: Array<string> = listTestFiles(REPOSITORY_DIRECTORY);
  let found: Array<HandRolledGenerator> = [];

  beforeAll(() => {
    found = reportHandRolledGenerators(testFiles);
  }, SCAN_TIMEOUT_IN_MS);

  test("the walk reads the test files of every package, their helpers and fixtures", () => {
    /*
     * Guards the guard: a moved folder or a broken walk would otherwise
     * leave the scan below passing over nothing.
     */
    expect(testFiles.length).toBeGreaterThan(5000);
    expect(testFiles).toEqual(
      expect.arrayContaining([
        SEEDED_RANDOM_HELPER,
        "packages/Common/Tests/Helpers/GeneratedTexts.ts",
        "packages/Common/Tests/Server/Utils/Topology/TopologyEstateGenerator.ts",
        "packages/Common/Tests/Utils/AI/PromptTextInLongRunningProcess.test.ts",
        "packages/App/Tests/Workers/Jobs/TelemetryMonitor/ProxmoxNativeClusterSimulator.ts",
        "packages/App/Tests/Dashboard/TopologyLayoutCollision.test.ts",
        "packages/App/FeatureSet/MobileRecorder/Tests/ContractParity.test.ts",
        "packages/Probe/Tests/Utils/Discovery/NetbiosNbstatCodec.test.ts",
        "packages/Home/Tests/Books/BookHtml.test.ts",
        // The offline E2E fixtures, which are no *.test.* files.
        "packages/E2E/Topology/Fixture.js",
        "packages/E2E/Topology/Datasets.js",
      ]),
    );
  });

  test(
    "no test file but Tests/Helpers/SeededRandom rolls a generator of its own",
    () => {
      expect(
        found
          .filter((generator: HandRolledGenerator): boolean => {
            return generator.file !== SEEDED_RANDOM_HELPER;
          })
          .map(describeGenerator),
      ).toEqual([]);
    },
    SCAN_TIMEOUT_IN_MS,
  );

  test("the detector finds the one generator, in Tests/Helpers/SeededRandom", () => {
    // A detector that found nothing anywhere would pass the test above too.
    expect(
      found
        .filter((generator: HandRolledGenerator): boolean => {
          return generator.file === SEEDED_RANDOM_HELPER;
        })
        .map((generator: HandRolledGenerator): string => {
          return generator.finding;
        }),
    ).toEqual(["mulberry32's step"]);
  });
});

describe("what the detector calls a generator of a test's own", () => {
  test.each([
    [
      "the plain-multiply copy that repeats",
      "Gen.test.ts",
      code(
        "let state: number = seed;",
        `state = (state * ${ANSI} + 12345) & 0x7fffffff;`,
      ),
      [[2, ANSI_FINDING]],
    ],
    [
      "the same multiplier in hex",
      "Gen.test.ts",
      code(`seed = (seed * ${ANSI_IN_HEX} + 12345) % 2147483648;`),
      [[1, ANSI_FINDING]],
    ],
    [
      "a multiplier with separators, on the left of the multiply",
      "Gen.test.ts",
      code(
        `seed = (seed * ${PARK_MILLER}) % 2_147_483_647;`,
        `state = (${PARK_MILLER_2} * state) % 2147483647;`,
      ),
      [
        [1, "a multiply by the Park-Miller (MINSTD) generator's 16807"],
        [2, "a multiply by the Park-Miller (MINSTD) generator's 48271"],
      ],
    ],
    [
      "a multiply through Math.imul",
      "Gen.test.ts",
      code(
        `state = (Math.imul(state, ${NUMERICAL_RECIPES}) + 1013904223) >>> 0;`,
      ),
      [[1, "a multiply by the Numerical Recipes LCG's 1664525"]],
    ],
    [
      "a multiplier held in a name the file multiplies by",
      "Gen.test.ts",
      code(
        `const MULTIPLIER: number = ${ANSI};`,
        "state = (state * MULTIPLIER + 12345) >>> 0;",
      ),
      [[1, ANSI_FINDING]],
    ],
    [
      "a multiplier held in a static field",
      "Gen.test.ts",
      code(
        "class Generator {",
        `  public static readonly FACTOR: number = ${BORLAND};`,
        "  private state: number = 1;",
        "  public next(): number {",
        "    this.state = (Math.imul(this.state, Generator.FACTOR) + 1) >>> 0;",
        "    return this.state;",
        "  }",
        "}",
      ),
      [[2, "a multiply by the Borland LCG's 22695477"]],
    ],
    [
      "a 64-bit generator in bigints",
      "Gen.test.ts",
      code(
        `state = (state * ${KNUTH_64} + 1442695040888963407n) & 0xffffffffffffffffn;`,
      ),
      [
        [
          1,
          "a multiply by the Knuth MMIX / PCG 64-bit LCG's 6364136223846793005",
        ],
      ],
    ],
    [
      "mulberry32",
      "Gen.test.ts",
      code(
        `state = (state + ${MULBERRY}) >>> 0;`,
        "let mixed: number = Math.imul(state ^ (state >>> 15), state | 1);",
      ),
      [[1, "mulberry32's step"]],
    ],
    [
      "splitmix64",
      "Gen.test.ts",
      code(`state += ${SPLITMIX};`),
      [[1, "splitmix64's step"]],
    ],
    [
      "xorshift, step by step",
      "Gen.test.ts",
      code(
        `x ^= x ${SHIFT_LEFT} 13;`,
        "x ^= x >>> 17;",
        `x ^= x ${SHIFT_LEFT} 5;`,
      ),
      [
        [1, "an xorshift step"],
        [3, "an xorshift step"],
      ],
    ],
    [
      "xorshift, assigned and folded to 32 bits",
      "Gen.test.ts",
      code(
        `state = (state ^ (state ${SHIFT_LEFT} 13)) >>> 0;`,
        `this.state ^= (this.state ${SHIFT_LEFT} 5) | 0;`,
      ),
      [
        [1, "an xorshift step"],
        [2, "an xorshift step"],
      ],
    ],
    [
      "xorshift, returned",
      "Gen.test.ts",
      code(
        `const next = (x: number): number => (x ^ (x ${SHIFT_LEFT} 13)) >>> 0;`,
      ),
      [[1, "an xorshift step"]],
    ],
    [
      "the 9301 / 49297 / 233280 generator",
      "Gen.test.ts",
      code(`seed = (seed * ${CLASSIC} + 49297) % 233280;`),
      [[1, "a multiply by the 9301 / 49297 / 233280 LCG's 9301"]],
    ],
    [
      "a generator in a script a child process runs",
      "Child.test.ts",
      code(
        "const script: string = String.raw`",
        "  let seed = 9;",
        `  seed = (seed * ${ANSI} + 12345) & 0x7fffffff;`,
        "`;",
        `const evaluated: string = "x ^= x ${SHIFT_LEFT} 13";`,
        `const page: string = 'state = (state + ${MULBERRY}) | 0; s = s ^ (s ${SHIFT_LEFT} 5);';`,
      ),
      // A template's finding on its own line; a quoted string's where it starts.
      [
        [3, ANSI_FINDING],
        [5, "an xorshift step"],
        [6, "mulberry32's step"],
        [6, "an xorshift step"],
      ],
    ],
    [
      "a generator in a fixture of plain JavaScript",
      "packages/E2E/Some/Fixture.js",
      code(
        "function seededRandom(seed) {",
        "  let state = seed >>> 0;",
        `  return () => (state = (state * ${NUMERICAL_RECIPES} + 1013904223) >>> 0) / 4294967296;`,
        "}",
      ),
      [[3, "a multiply by the Numerical Recipes LCG's 1664525"]],
    ],
    [
      "a generator in a component test",
      "Widget.test.tsx",
      code(
        "const random = (): number => {",
        `  seed = (seed * ${ANSI} + 12345) % 2147483648;`,
        "  return seed / 2147483648;",
        "};",
        "const view: JSX.Element = <div>{random()}</div>;",
      ),
      [[2, ANSI_FINDING]],
    ],
  ])(
    "%s",
    (
      _case: string,
      file: string,
      text: string,
      expected: Array<Array<number | string>>,
    ) => {
      expect(findingsIn(file, text)).toEqual(expected);
    },
  );
});

describe("what it passes", () => {
  test.each([
    [
      "a hash of a value: FNV",
      code(
        "let hash: number = 0x811c9dc5;",
        "hash = Math.imul(hash ^ text.charCodeAt(index), 16777619) >>> 0;",
      ),
    ],
    [
      "a multiplicative hash of an index",
      code("const high: number = Math.imul(index + 1, 2654435761) >>> 0;"),
    ],
    [
      "a mixer's right shifts",
      code("h ^= h >>> 16;", "h = Math.imul(h, 0x85ebca6b);", "h ^= h >>> 13;"),
    ],
    [
      "a multiplier only compared or listed",
      code(
        `expect(port).toBe(${PARK_MILLER_2});`,
        `const KNOWN: Array<number> = [${ANSI}, ${NUMERICAL_RECIPES}];`,
        `const STEPS: Array<number> = [${MULBERRY}];`,
        `const label: string = "seeded with ${ANSI}";`,
      ),
    ],
    [
      "a multiplier in a comment",
      code(
        `// The old generator multiplied by ${ANSI} with a plain "*".`,
        `/* state = (state * ${ANSI} + 12345) */`,
        "const value: number = 1;",
      ),
    ],
    [
      "a left shift that is not of the value it is XORed into",
      code(
        `const mask: number = 1 ${SHIFT_LEFT} 13;`,
        `flags ^= other ${SHIFT_LEFT} 2;`,
        `x = y ^ (x ${SHIFT_LEFT} 1);`,
        `const gray: number = v ^ (v >>> 1);`,
      ),
    ],
    [
      "a multiply by a number no well-known generator uses",
      code(
        "const bytes: number = count * 4096;",
        "const id: number = index * 7919 + 1;",
      ),
    ],
    [
      "a draw from the suites' generator",
      code(
        'import { seededRandom } from "Common/Tests/Helpers/SeededRandom";',
        "const random: () => number = seededRandom(20261011);",
        "const index: number = Math.floor(random() * 6);",
      ),
    ],
  ])("%s", (_case: string, text: string) => {
    expect(findingsIn("Pass.test.ts", text)).toEqual([]);
  });

  test("reports a generator in a template on its own line, whatever the line breaks", () => {
    const lines: Array<string> = [
      "const script: string = `",
      "  let seed = 9;",
      `  seed = (seed * ${ANSI} + 12345) & 0x7fffffff;`,
      "`;",
    ];

    for (const lineBreak of ["\n", "\r\n"]) {
      expect(findingsIn("Child.test.ts", lines.join(lineBreak))).toEqual([
        [3, ANSI_FINDING],
      ]);
    }
  });

  test("passes a script that only looks like one", () => {
    expect(
      findingsIn(
        "Child.test.ts",
        code(
          `const script: string = "x = y ^ (x ${SHIFT_LEFT} 1); total = total * 2;";`,
          `const note: string = "multiplied by ${ANSI}, once";`,
        ),
      ),
    ).toEqual([]);
  });

  test("reads a file holding a string megabytes long in good time", () => {
    /*
     * Every number and every "^" is read with the few characters around it,
     * once: 2.5 MB take a fraction of a second, where reading all the text
     * before each number took seven.
     */
    const longText: string = `x ^ y ${SHIFT_LEFT} 2, ${PARK_MILLER_2} `.repeat(
      120000,
    );
    const started: number = Date.now();

    expect(
      findingsIn("Long.test.ts", code(`const big: string = "${longText}";`)),
    ).toEqual([]);
    expect(Date.now() - started).toBeLessThan(3000);
  });

  test("reads every multiplier and step it knows, however it is written", () => {
    expect(valueOf(ANSI_IN_HEX)).toBe(BigInt(ANSI));
    expect(valueOf(PARK_MILLER)).toBe(BigInt(16807));
    expect(valueOf(KNUTH_64)).toBe(BigInt("6364136223846793005"));
    expect(valueOf(SPLITMIX)).toBe(BigInt("11400714819323198485"));
    expect(valueOf("not a number")).toBeNull();
    expect(LCG_MULTIPLIERS.get(BigInt(ANSI))).toBe("the ANSI C / glibc LCG");
    expect(WEYL_INCREMENTS.get(valueOf(MULBERRY)!)).toBe("mulberry32");
  });
});

describe("a checkout written elsewhere", () => {
  const generator: string = code(`state = (state * ${ANSI} + 12345) >>> 0;`);
  const TREE: Record<string, string> = {
    "packages/Some/Tests/Gen.test.ts": generator,
    "packages/Some/Tests/Helpers/Fixtures.ts": code("", generator),
    "packages/E2E/Some/Fixture.js": generator,
    // Product code, a dependency and a build: no test files of the walk.
    "packages/Some/Utils/Jitter.ts": generator,
    "packages/Some/node_modules/lib/Tests/Gen.test.ts": generator,
    "packages/Some/build/Tests/Gen.test.ts": generator,
  };

  let root: string = "";

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "seeded-random-scan-"));

    for (const [file, text] of Object.entries(TREE)) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), text);
    }
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("reports each test file's generator by file and line, with what to draw from instead", () => {
    expect(
      reportHandRolledGenerators(listTestFiles(root, root), root).map(
        describeGenerator,
      ),
    ).toEqual([
      `packages/E2E/Some/Fixture.js:1 rolls its own generator (${ANSI_FINDING}).`,
      `packages/Some/Tests/Gen.test.ts:1 rolls its own generator (${ANSI_FINDING}).`,
      `packages/Some/Tests/Helpers/Fixtures.ts:2 rolls its own generator (${ANSI_FINDING}).`,
    ]);
    expect(SEEDED_RANDOM_FIX).toContain(
      'import { seededRandom } from "Common/Tests/Helpers/SeededRandom"',
    );
    expect(SEEDED_RANDOM_FIX).toContain("Tests/Helpers/GeneratedTexts");
  });

  test("reads the files from the repository's root when given no root", () => {
    expect(reportHandRolledGenerators([SEEDED_RANDOM_HELPER])).toHaveLength(1);
    // A file of the tree written here is no file of the repository's.
    expect(() => {
      return reportHandRolledGenerators(["packages/Some/Tests/Gen.test.ts"]);
    }).toThrow(/ENOENT/);
  });
});
