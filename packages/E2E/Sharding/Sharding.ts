import fs from "fs";
import path from "path";

/*
 * Splits the default e2e suite (playwright.config.ts) across CI jobs.
 *
 * CI sets E2E_SHARD="<current>/<total>" (1-based, like Playwright's --shard)
 * and every shard boots its own stack, so the release workflows can run the
 * suite on several runners at once instead of one test after another on one.
 *
 * Playwright's own --shard is not used because it hands each shard a
 * contiguous run of tests by COUNT, in file order, and this suite's cost is
 * nowhere near uniform: the Dashboard specs that sign up, create a project and
 * then wait on probes, ingestion and on-call sit next to each other in file
 * order, while most App and Api tests take a fraction of a second. On a real
 * run, four count-based shards came out at 3, 28, 5 and 21 minutes.
 *
 * So a shard here is a set of WHOLE spec files per browser project, packed
 * longest-first onto the least loaded shard using the per-file durations in
 * ShardWeights.json. Whole files keep every spec running exactly as it does
 * unsharded: in one worker, in file order, with its beforeAll hooks run once.
 * A file with no weight yet (a new spec) is packed at the median weight, so
 * it still runs, in exactly one shard; ShardWeights.json only decides which.
 *
 * Packing is deterministic: every shard computes the same assignment from the
 * same files and weights, so together the shards run every test exactly once.
 * Sharding/Sharding.spec.ts (npm run test-sharding) proves that against
 * Playwright's own --list on every pull request.
 */

export interface Shard {
  // 1-based.
  current: number;
  total: number;
}

// Test file (relative to the test directory, "/"-separated) -> project -> seconds.
export type ShardWeights = Record<string, Record<string, number>>;

export interface ShardItem {
  file: string;
  project: string;
  weight: number;
}

/*
 * Used when ShardWeights.json has no weights at all. Any positive number
 * would do: it only has to be the same for every shard.
 */
const FALLBACK_WEIGHT_IN_SECONDS: number = 60;

/*
 * What an unsharded run collects, since the main config sets no testMatch of
 * its own: Playwright's default testMatch, "**\/*.@(spec|test).?(c|m)[jt]s?(x)",
 * which it matches case-insensitively, but only on files whose extension is in
 * its (lower-case) list of script extensions - so Login.SPEC.ts runs and
 * Login.spec.TS does not.
 */
const TEST_FILE_PATTERN: RegExp = /\.(spec|test)\.[cm]?[jt]sx?$/i;
const SCRIPT_EXTENSION_PATTERN: RegExp = /\.[cm]?[jt]sx?$/;

const SHARD_PATTERN: RegExp = /^\s*(\d+)\s*\/\s*(\d+)\s*$/;

/**
 * Reads E2E_SHARD. Unset or empty means "not sharded"; anything else that is
 * not "<current>/<total>" with 1 <= current <= total throws, so a typo fails
 * the run instead of quietly running the whole suite (or none of it).
 */
export function parseShard(value: string | undefined): Shard | null {
  if (value === undefined || value.trim() === "") {
    return null;
  }

  const match: RegExpExecArray | null = SHARD_PATTERN.exec(value);

  if (!match) {
    throw new Error(
      `E2E_SHARD must look like "<current>/<total>", for example "2/4", but it is "${value}".`,
    );
  }

  const current: number = Number(match[1]);
  const total: number = Number(match[2]);

  if (total < 1 || current < 1 || current > total) {
    throw new Error(
      `E2E_SHARD "${value}" is out of range: the shard must be between 1 and the total, and the total at least 1.`,
    );
  }

  return { current, total };
}

/**
 * The test files Playwright collects under testDir with its default
 * testMatch: it walks every directory except node_modules, follows no
 * symbolic links, and takes the files whose names match the pattern above.
 * Paths are relative to testDir, "/"-separated and sorted.
 */
export function findTestFiles(testDir: string): Array<string> {
  const files: Array<string> = [];

  const visit: (directory: string) => void = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath: string = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") {
          visit(entryPath);
        }
      } else if (
        entry.isFile() &&
        TEST_FILE_PATTERN.test(entry.name) &&
        SCRIPT_EXTENSION_PATTERN.test(entry.name)
      ) {
        files.push(path.relative(testDir, entryPath).split(path.sep).join("/"));
      }
    }
  };

  visit(testDir);

  return files.sort(compareStrings);
}

export function readShardWeights(weightsFile: string): ShardWeights {
  return JSON.parse(fs.readFileSync(weightsFile, "utf8")) as ShardWeights;
}

/**
 * The weight of a file or project that ShardWeights.json does not know yet:
 * the median of the weights it does know.
 */
export function defaultWeight(weights: ShardWeights): number {
  const known: Array<number> = Object.values(weights)
    .flatMap((byProject: Record<string, number>) => {
      return Object.values(byProject);
    })
    .filter((weight: number) => {
      return Number.isFinite(weight) && weight > 0;
    })
    .sort((a: number, b: number) => {
      return a - b;
    });

  if (known.length === 0) {
    return FALLBACK_WEIGHT_IN_SECONDS;
  }

  return known[Math.floor(known.length / 2)] as number;
}

/**
 * Longest-processing-time-first: the heaviest item goes onto the least loaded
 * shard, then the next heaviest, and so on. Ties are broken by file and
 * project name and by shard number, so the result depends on nothing but the
 * input. Every weight counts as at least 1, so the first `total` items always
 * land on different shards and no shard is left empty while items remain.
 */
export function packShards(
  items: Array<ShardItem>,
  total: number,
): Array<Array<ShardItem>> {
  const shards: Array<Array<ShardItem>> = Array.from(
    { length: total },
    (): Array<ShardItem> => {
      return [];
    },
  );
  const loads: Array<number> = new Array<number>(total).fill(0);

  const ordered: Array<ShardItem> = [...items].sort(
    (a: ShardItem, b: ShardItem) => {
      return (
        effectiveWeight(b) - effectiveWeight(a) ||
        compareStrings(a.file, b.file) ||
        compareStrings(a.project, b.project)
      );
    },
  );

  for (const item of ordered) {
    let lightest: number = 0;

    for (let index: number = 1; index < total; index++) {
      if ((loads[index] as number) < (loads[lightest] as number)) {
        lightest = index;
      }
    }

    (shards[lightest] as Array<ShardItem>).push(item);
    loads[lightest] = (loads[lightest] as number) + effectiveWeight(item);
  }

  return shards;
}

/**
 * The files each project runs in the given shard, sorted. Every (file,
 * project) pair is one item to pack, so a file's Chromium and Firefox runs
 * can land on different shards; they run in different workers anyway.
 */
export function filesForShard(data: {
  files: Array<string>;
  projects: Array<string>;
  weights: ShardWeights;
  shard: Shard;
}): Record<string, Array<string>> {
  const fallback: number = defaultWeight(data.weights);
  const items: Array<ShardItem> = [];

  for (const file of data.files) {
    for (const project of data.projects) {
      const known: number | undefined = data.weights[file]?.[project];

      items.push({
        file,
        project,
        weight:
          known !== undefined && Number.isFinite(known) ? known : fallback,
      });
    }
  }

  if (items.length < data.shard.total) {
    throw new Error(
      `E2E_SHARD asks for ${data.shard.total} shards, but there are only ${items.length} spec files across all projects to split between them.`,
    );
  }

  const mine: Array<ShardItem> = packShards(items, data.shard.total)[
    data.shard.current - 1
  ] as Array<ShardItem>;

  const result: Record<string, Array<string>> = {};

  for (const project of data.projects) {
    result[project] = mine
      .filter((item: ShardItem) => {
        return item.project === project;
      })
      .map((item: ShardItem) => {
        return item.file;
      })
      .sort(compareStrings);
  }

  return result;
}

/**
 * A testMatch entry for exactly one file: Playwright tests RegExps against
 * the absolute path of every file it collects.
 */
export function exactFileMatcher(testDir: string, file: string): RegExp {
  const absolutePath: string = path.join(testDir, ...file.split("/"));

  return new RegExp(`^${absolutePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
}

/**
 * The config's projects for this run. Without E2E_SHARD they are returned
 * untouched. With it, each project's testMatch is narrowed to the files it
 * runs in this shard, and the choice is printed once (to stderr, so that
 * `--list --reporter=json` keeps clean JSON on stdout).
 */
export function shardProjects<T extends { name?: string }>(data: {
  projects: Array<T>;
  testDir: string;
  weightsFile: string;
  shardValue: string | undefined;
}): Array<T> {
  const shard: Shard | null = parseShard(data.shardValue);

  if (!shard) {
    return data.projects;
  }

  const projectNames: Array<string> = data.projects.map((project: T) => {
    if (!project.name) {
      throw new Error("Every project needs a name to be sharded.");
    }
    return project.name;
  });

  const files: Array<string> = findTestFiles(data.testDir);
  const selection: Record<string, Array<string>> = filesForShard({
    files,
    projects: projectNames,
    weights: readShardWeights(data.weightsFile),
    shard,
  });

  /*
   * Playwright loads this config in the runner and again in every worker;
   * only the runner has no TEST_WORKER_INDEX.
   */
  if (process.env["TEST_WORKER_INDEX"] === undefined) {
    const lines: Array<string> = [
      `E2E shard ${shard.current}/${shard.total} of ${files.length} spec files:`,
    ];

    for (const name of projectNames) {
      const chosen: Array<string> = selection[name] || [];
      lines.push(`  [${name}] ${chosen.length} files`);
      for (const file of chosen) {
        lines.push(`    ${file}`);
      }
    }

    process.stderr.write(`${lines.join("\n")}\n`);
  }

  return data.projects.map((project: T) => {
    return {
      ...project,
      testMatch: (selection[project.name as string] || []).map(
        (file: string) => {
          return exactFileMatcher(data.testDir, file);
        },
      ),
    };
  });
}

function effectiveWeight(item: ShardItem): number {
  return Math.max(1, item.weight);
}

function compareStrings(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  return a > b ? 1 : 0;
}
