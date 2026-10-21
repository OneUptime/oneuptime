import { expect, test } from "@playwright/test";
import { execFile } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import {
  Shard,
  ShardItem,
  ShardWeights,
  defaultWeight,
  exactFileMatcher,
  filesForShard,
  findTestFiles,
  packShards,
  parseShard,
  readShardWeights,
} from "./Sharding";

/*
 * The release workflows split the default e2e suite between runners with
 * E2E_SHARD (see Sharding.ts). A sharding bug would not fail anything: a test
 * that no shard picks up simply never runs, and every job stays green. So this
 * suite pins the packing, and then asks Playwright itself: for the shard
 * counts the workflows use, the shards' --list outputs must be disjoint and
 * must add up to exactly the unsharded --list.
 *
 * Run with `npm run test-sharding`. No browser and no stack: --list only
 * loads the spec files.
 */

const E2E_DIR: string = path.resolve(__dirname, "..");
const TEST_DIR: string = path.join(E2E_DIR, "Tests");
const WEIGHTS_FILE: string = path.join(__dirname, "ShardWeights.json");
const PROJECTS: Array<string> = ["chromium", "firefox"];

/*
 * The shard counts .github/workflows/test-release.yaml and release.yml run
 * the suite with: four for the SaaS stack, three for the self-hosted one.
 */
const WORKFLOW_SHARD_TOTALS: Array<number> = [3, 4];

function item(file: string, project: string, weight: number): ShardItem {
  return { file, project, weight };
}

function keysOf(shards: Array<Array<ShardItem>>): Array<Array<string>> {
  return shards.map((shard: Array<ShardItem>) => {
    return shard
      .map((entry: ShardItem) => {
        return `${entry.project}:${entry.file}`;
      })
      .sort();
  });
}

test.describe("parseShard", () => {
  test("reads unset or blank as unsharded", () => {
    expect(parseShard(undefined)).toBeNull();
    expect(parseShard("")).toBeNull();
    expect(parseShard("  ")).toBeNull();
  });

  test("reads <current>/<total>", () => {
    expect(parseShard("2/4")).toEqual({ current: 2, total: 4 });
    expect(parseShard(" 1 / 1 ")).toEqual({ current: 1, total: 1 });
  });

  test("refuses anything else, so a typo fails instead of running the wrong tests", () => {
    for (const value of ["0/4", "5/4", "2/0", "2", "a/b", "2/4/6", "-1/4"]) {
      expect(() => {
        return parseShard(value);
      }).toThrow(/E2E_SHARD/);
    }
  });
});

test.describe("packShards", () => {
  const items: Array<ShardItem> = [
    item("a.spec.ts", "chromium", 90),
    item("a.spec.ts", "firefox", 80),
    item("b.spec.ts", "chromium", 70),
    item("b.spec.ts", "firefox", 60),
    item("c.spec.ts", "chromium", 50),
    item("c.spec.ts", "firefox", 40),
    item("d.spec.ts", "chromium", 30),
    item("d.spec.ts", "firefox", 20),
    item("e.spec.ts", "chromium", 10),
    item("e.spec.ts", "firefox", 0),
  ];

  test("places every item on exactly one shard", () => {
    for (const total of [1, 2, 3, 4, 10]) {
      const placed: Array<string> = keysOf(packShards(items, total)).flat();

      expect(placed.sort()).toEqual(keysOf([items])[0]);
    }
  });

  test("leaves no shard empty while there are items for it", () => {
    for (const total of [1, 2, 5, 10]) {
      for (const shard of packShards(items, total)) {
        expect(shard.length).toBeGreaterThan(0);
      }
    }
  });

  test("depends only on the items, not on their order", () => {
    const reversed: Array<ShardItem> = [...items].reverse();

    for (const total of [2, 3, 4]) {
      expect(keysOf(packShards(reversed, total))).toEqual(
        keysOf(packShards(items, total)),
      );
    }
  });

  test("puts the heaviest item on its own shard, then fills the lightest", () => {
    const shards: Array<Array<ShardItem>> = packShards(
      [
        item("heavy.spec.ts", "chromium", 100),
        item("light1.spec.ts", "chromium", 30),
        item("light2.spec.ts", "chromium", 30),
        item("light3.spec.ts", "chromium", 30),
      ],
      2,
    );

    expect(keysOf(shards)).toEqual([
      ["chromium:heavy.spec.ts"],
      [
        "chromium:light1.spec.ts",
        "chromium:light2.spec.ts",
        "chromium:light3.spec.ts",
      ],
    ]);
  });
});

test.describe("filesForShard", () => {
  const files: Array<string> = [
    "Accounts/Login.spec.ts",
    "Dashboard/Slow.spec.ts",
    "Dashboard/New.spec.ts",
    "Home/Landing.spec.ts",
  ];
  const weights: ShardWeights = {
    "Accounts/Login.spec.ts": { chromium: 5, firefox: 4 },
    "Dashboard/Slow.spec.ts": { chromium: 300, firefox: 280 },
    "Home/Landing.spec.ts": { chromium: 20, firefox: 18 },
    // A spec that no longer exists is ignored.
    "Gone/Deleted.spec.ts": { chromium: 999, firefox: 999 },
  };

  function shardsOf(total: number): Array<Record<string, Array<string>>> {
    return Array.from({ length: total }, (_: unknown, index: number) => {
      const shard: Shard = { current: index + 1, total };
      return filesForShard({ files, projects: PROJECTS, weights, shard });
    });
  }

  test("runs every file in every project exactly once across the shards, including one with no weight yet", () => {
    for (const total of [1, 2, 3, 4, 8]) {
      for (const project of PROJECTS) {
        const runs: Array<string> = shardsOf(total).flatMap(
          (selection: Record<string, Array<string>>) => {
            return selection[project] || [];
          },
        );

        expect(runs.sort()).toEqual([...files].sort());
      }
    }
  });

  test("never runs a file that is not a test file any more", () => {
    for (const selection of shardsOf(3)) {
      for (const project of PROJECTS) {
        expect(selection[project]).not.toContain("Gone/Deleted.spec.ts");
      }
    }
  });

  test("refuses more shards than there are files to split", () => {
    expect(() => {
      return filesForShard({
        files,
        projects: PROJECTS,
        weights,
        shard: { current: 1, total: files.length * PROJECTS.length + 1 },
      });
    }).toThrow(/E2E_SHARD/);
  });

  test("packs an unknown file at the median known weight", () => {
    expect(
      defaultWeight({
        "A.spec.ts": { chromium: 5, firefox: 4 },
        "B.spec.ts": { chromium: 300, firefox: 20 },
        "C.spec.ts": { chromium: 18 },
      }),
    ).toBe(18);
    expect(defaultWeight({})).toBeGreaterThan(0);
  });
});

test.describe("findTestFiles", () => {
  test("collects what Playwright's default testMatch does, and skips node_modules", () => {
    const root: string = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-shard-"));
    const write: (file: string) => void = (file: string): void => {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), "");
    };

    try {
      for (const file of [
        "A/One.spec.ts",
        "A/Two.test.js",
        "B/Three.spec.tsx",
        "B/Four.SPEC.ts",
        "B/Five.spec.mts",
        // Playwright's extension check is case-sensitive.
        "B/Six.spec.TS",
        "A/Helpers/Helper.ts",
        "A/notes.md",
        "node_modules/pkg/Ignored.spec.ts",
        "C/node_modules/Ignored.spec.ts",
      ]) {
        write(file);
      }

      expect(findTestFiles(root)).toEqual([
        "A/One.spec.ts",
        "A/Two.test.js",
        "B/Five.spec.mts",
        "B/Four.SPEC.ts",
        "B/Three.spec.tsx",
      ]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

test.describe("exactFileMatcher", () => {
  test("matches its own file and no other", () => {
    const matcher: RegExp = exactFileMatcher(
      "/repo/Tests",
      "Accounts/Login.spec.ts",
    );

    expect(matcher.test("/repo/Tests/Accounts/Login.spec.ts")).toBe(true);
    expect(matcher.test("/repo/Tests/Accounts/LoginEnumeration.spec.ts")).toBe(
      false,
    );
    expect(matcher.test("/repo/Tests/Other/Accounts/Login.spec.ts")).toBe(
      false,
    );
    expect(matcher.test("/repo/Tests/Accounts/LoginXspec.ts")).toBe(false);
  });
});

test.describe("ShardWeights.json", () => {
  test("holds a positive number of seconds for each file and project", () => {
    const weights: ShardWeights = readShardWeights(WEIGHTS_FILE);

    expect(Object.keys(weights).length).toBeGreaterThan(0);
    for (const byProject of Object.values(weights)) {
      for (const [project, seconds] of Object.entries(byProject)) {
        expect(PROJECTS).toContain(project);
        expect(Number.isFinite(seconds) && seconds > 0).toBe(true);
      }
    }
  });
});

/*
 * One `playwright test --list --reporter=json` of the main config, as the set
 * of "<project> > <file>:<line>:<column> > <titles>" it lists.
 */
interface ListedSpec {
  title: string;
  file: string;
  line: number;
  column: number;
  tests: Array<{ projectName: string }>;
}

interface ListedSuite {
  title: string;
  specs?: Array<ListedSpec>;
  suites?: Array<ListedSuite>;
}

interface ListedReport {
  suites?: Array<ListedSuite>;
  errors?: Array<{ message?: string }>;
}

function listedTests(report: ListedReport): Array<string> {
  const listed: Array<string> = [];

  const visit: (suite: ListedSuite, titles: Array<string>) => void = (
    suite: ListedSuite,
    titles: Array<string>,
  ): void => {
    for (const spec of suite.specs || []) {
      for (const listedTest of spec.tests) {
        listed.push(
          `${listedTest.projectName} > ${spec.file}:${spec.line}:${spec.column} > ${[...titles, spec.title].join(" > ")}`,
        );
      }
    }
    for (const child of suite.suites || []) {
      visit(child, [...titles, child.title]);
    }
  };

  for (const suite of report.suites || []) {
    visit(suite, []);
  }

  return listed.sort();
}

function listSuite(shard: string | undefined): Promise<Array<string>> {
  const env: NodeJS.ProcessEnv = { ...process.env };

  // A clean environment for the child run: not this worker's, not a shard's.
  for (const key of Object.keys(env)) {
    if (key.startsWith("TEST_") || key === "E2E_SHARD") {
      delete env[key];
    }
  }
  if (shard) {
    env["E2E_SHARD"] = shard;
  }

  return new Promise(
    (
      resolve: (value: Array<string>) => void,
      reject: (reason: Error) => void,
    ) => {
      execFile(
        process.execPath,
        [
          require.resolve("@playwright/test/cli"),
          "test",
          "--config",
          "playwright.config.ts",
          "--list",
          "--reporter=json",
        ],
        { cwd: E2E_DIR, env, maxBuffer: 256 * 1024 * 1024 },
        (error: Error | null, stdout: string, stderr: string) => {
          if (error) {
            reject(
              new Error(
                `--list ${shard ? `with E2E_SHARD=${shard}` : "unsharded"} failed: ${error.message}\n${stderr}`,
              ),
            );
            return;
          }

          const report: ListedReport = JSON.parse(stdout) as ListedReport;

          if (report.errors && report.errors.length > 0) {
            reject(
              new Error(
                `--list ${shard ? `with E2E_SHARD=${shard}` : "unsharded"} reported errors: ${JSON.stringify(report.errors)}`,
              ),
            );
            return;
          }

          resolve(listedTests(report));
        },
      );
    },
  );
}

test.describe("the shards the workflows run", () => {
  test("together list exactly the unsharded suite, each test in one shard", async () => {
    // Also warms Playwright's transform cache for the shard runs below.
    const unsharded: Array<string> = await listSuite(undefined);

    // Two projects over every spec file: far more than a handful of tests.
    expect(unsharded.length).toBeGreaterThan(
      findTestFiles(TEST_DIR).length * PROJECTS.length,
    );

    for (const total of WORKFLOW_SHARD_TOTALS) {
      const shards: Array<Array<string>> = await Promise.all(
        Array.from({ length: total }, (_: unknown, index: number) => {
          return listSuite(`${index + 1}/${total}`);
        }),
      );

      const seen: Map<string, number> = new Map();

      shards.forEach((listed: Array<string>, index: number) => {
        expect(
          listed.length,
          `shard ${index + 1}/${total} lists no tests`,
        ).toBeGreaterThan(0);

        for (const id of listed) {
          expect(
            seen.get(id),
            `"${id}" is listed by shard ${seen.get(id)}/${total} and shard ${index + 1}/${total}`,
          ).toBeUndefined();
          seen.set(id, index + 1);
        }
      });

      expect(
        [...seen.keys()].sort(),
        `the ${total} shards do not add up to the unsharded suite`,
      ).toEqual(unsharded);
    }
  });
});
