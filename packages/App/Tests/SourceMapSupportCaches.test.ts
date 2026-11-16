import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import { SpawnSyncReturns, spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

/*
 * Stack traces in a server that runs for weeks keep naming the right
 * TypeScript lines, and the maps they are made with no longer pile up.
 *
 * ts-node installs source-map-support for stack traces, and Common's
 * transpiler (Common/Server/Utils/TsNode/Transpiler.js) hands it each
 * module's source map. The library decodes a script's map the first time a
 * stack trace passes through it, and kept every decoded map, and the text of
 * every file it read on the way, for the life of the process: 1,047 MB once
 * each of the 8,382 scripts of Common's services had been in a stack trace.
 * The transpiler now gives it caches that keep what it used last: decoded
 * maps up to 48 MB (by its estimate, ~24 bytes per character of encoded
 * mappings, with the sources a map keeps), and files' text up to 8 M
 * characters.
 *
 * These run the App's real ts-node in production, with the library as every
 * server installs it, over 30 modules whose maps weigh four times that
 * budget, and hold it to: every stack trace names the throw's own line and
 * column, before and after the module's map has been let go of and decoded
 * again; the cache stays within its budget; and the heap it holds stays a
 * fraction of what the library kept by itself (the control, which gives the
 * library back plain objects). They also hold the library to what the
 * transpiler relies on, so an upgrade that changes it fails here first.
 */

const APP_ROOT: string = path.resolve(__dirname, "..");
const PACKAGES_ROOT: string = path.resolve(APP_ROOT, "..");
const TRANSPILER: string = path.join(
  PACKAGES_ROOT,
  "Common",
  "Server",
  "Utils",
  "TsNode",
  "Transpiler.js",
);
const LIBRARY: string = require.resolve("@cspotcode/source-map-support", {
  paths: [path.dirname(require.resolve("ts-node"))],
});
const TRACE_MAPPING: string = require.resolve("@jridgewell/trace-mapping", {
  paths: [path.dirname(LIBRARY)],
});

// Every server that runs through ts-node, and so through the library.
const SERVERS: Array<string> = [
  "App",
  "Home",
  "Nginx",
  "Probe",
  "Runner",
  "TestServer",
];

// A line of the library that uses one of its two caches.
const CACHE_USE: RegExp = /sharedData\.(sourceMapCache|fileContentsCache)/;

const MODULES: number = 30;
const VALUE_LINES: number = 2000;
// Where each module throws: after its values and the function's first line.
const THROW_LINE: number = VALUE_LINES + 2;
// `  throw new Error(...)`: V8 points at `new`.
const THROW_COLUMN: number = 9;
const BUDGET_MB: number = 48;

let fixtureDirectory: string = "";

function moduleFile(index: number): string {
  return path.join(fixtureDirectory, `Module${index}.ts`);
}

// A module whose map decodes to a few megabytes, ending in a throw.
function moduleSource(index: number): string {
  const lines: Array<string> = [];
  for (let line: number = 0; line < VALUE_LINES; line++) {
    lines.push(
      `export const value${line} = (input: number): number => input * ${line % 7} + ${line} - (input % ${(line % 5) + 2}) * ${index + 1};`,
    );
  }
  lines.push("export function fail(): never {");
  lines.push(`  throw new Error("thrown from module ${index}");`);
  lines.push("}");
  return `${lines.join("\n")}\n`;
}

interface Run {
  // The first frame of each module's stack trace, in each of two rounds.
  frames: Array<Array<string>>;
  // Whether module 0's map had been let go of before the second round.
  firstEvictedBeforeSecondRound: boolean;
  keptMaps: number;
  keptWeightMb: number;
  keptTextCharacters: number;
  heapGrowthMb: number;
  allWeightMb: number;
}

/*
 * Node with ts-node registered as the image starts it, from the App's
 * tsconfig (its transpiler), in production: stack traces through every
 * module, twice. With `plainCaches`, the library gets plain objects back,
 * as it had before the transpiler bounded them.
 */
function runServer(plainCaches: boolean): Run {
  const script: string = `
    const path = require("path");
    const { pathToFileURL } = require("url");
    const transpiler = require(${JSON.stringify(TRANSPILER)});
    const shared = globalThis[Symbol.for("source-map-support/sharedData")];
    if (${JSON.stringify(plainCaches)}) {
      shared.sourceMapCache = Object.create(null);
      shared.fileContentsCache = Object.create(null);
    }
    const files = [];
    for (let i = 0; i < ${MODULES}; i++) {
      files.push(path.join(${JSON.stringify(fixtureDirectory)}, "Module" + i + ".ts"));
    }
    const modules = files.map((file) => require(file));
    const heap = () => {
      for (let i = 0; i < 3; i++) global.gc();
      return process.memoryUsage().heapUsed / 1048576;
    };
    const before = heap();
    const frames = [[], []];
    let allWeight = 0;
    let firstEvictedBeforeSecondRound = false;
    for (const round of [0, 1]) {
      if (round === 1) {
        firstEvictedBeforeSecondRound = !(pathToFileURL(files[0]).href in shared.sourceMapCache);
      }
      modules.forEach((module, i) => {
        try {
          module.fail();
        } catch (error) {
          frames[round].push(error.stack.split("\\n")[1].trim());
        }
        if (round === 0) {
          const entry = shared.sourceMapCache[pathToFileURL(files[i]).href];
          allWeight += transpiler.sourceMapCacheEntryBytes(entry);
        }
      });
    }
    const after = heap();
    let keptWeight = 0;
    let keptMaps = 0;
    for (const key of Object.keys(shared.sourceMapCache)) {
      const entry = shared.sourceMapCache[key];
      keptWeight += transpiler.sourceMapCacheEntryBytes(entry);
      if (entry && entry.map) keptMaps++;
    }
    let keptTextCharacters = 0;
    for (const key of Object.keys(shared.fileContentsCache)) {
      keptTextCharacters += transpiler.fileContentsCacheEntryCharacters(shared.fileContentsCache[key]);
    }
    console.log(JSON.stringify({
      frames,
      firstEvictedBeforeSecondRound,
      keptMaps,
      keptWeightMb: keptWeight / 1048576,
      keptTextCharacters,
      heapGrowthMb: after - before,
      allWeightMb: allWeight / 1048576,
    }));
  `;

  const result: SpawnSyncReturns<string> = spawnSync(
    process.execPath,
    ["--expose-gc", "--require", "ts-node/register", "-e", script],
    {
      cwd: APP_ROOT,
      env: {
        ...process.env,
        NODE_ENV: "production",
        TS_NODE_TRANSPILE_ONLY: "1",
        TS_NODE_PROJECT: path.join(APP_ROOT, "tsconfig.json"),
      },
      encoding: "utf8",
      timeout: 240000,
    },
  );

  const line: string | undefined = (result.stdout || "")
    .split("\n")
    .filter((each: string): boolean => {
      return each.startsWith("{");
    })
    .pop();

  if (!line) {
    throw new Error(
      `The App's ts-node printed nothing (exit ${String(result.status)}):\n${result.stderr}`,
    );
  }

  return JSON.parse(line) as Run;
}

let bounded: Run;
let control: Run;

beforeAll(() => {
  fixtureDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "source-map-support-caches-"),
  );
  for (let index: number = 0; index < MODULES; index++) {
    fs.writeFileSync(moduleFile(index), moduleSource(index));
  }
  bounded = runServer(false);
  control = runServer(true);
}, 600000);

afterAll(() => {
  if (fixtureDirectory) {
    fs.rmSync(fixtureDirectory, { recursive: true, force: true });
  }
});

describe("stack traces through more maps than the budget holds", () => {
  test("the modules' maps weigh several times the budget (the checks below are not vacuous)", () => {
    expect(bounded.allWeightMb).toBeGreaterThan(BUDGET_MB * 3);
    expect(control.keptMaps).toBeGreaterThanOrEqual(MODULES);
  });

  test("each names the line and column of its own throw, in both rounds", () => {
    for (const run of [bounded, control]) {
      for (const round of run.frames) {
        expect(round).toEqual(
          Array.from(
            { length: MODULES },
            (_unused: unknown, index: number): string => {
              return `at Object.fail (${moduleFile(index)}:${THROW_LINE}:${THROW_COLUMN})`;
            },
          ),
        );
      }
    }
  });

  test("a map let go of is decoded again, and maps the same", () => {
    expect(bounded.firstEvictedBeforeSecondRound).toBe(true);
    expect(control.firstEvictedBeforeSecondRound).toBe(false);
    expect(bounded.frames[1]![0]).toBe(control.frames[1]![0]);
  });

  test("the library keeps maps within the budget, the files' text within its own", () => {
    expect(bounded.keptWeightMb).toBeLessThanOrEqual(BUDGET_MB);
    expect(bounded.keptMaps).toBeGreaterThan(5);
    expect(bounded.keptMaps).toBeLessThan(MODULES);
    expect(bounded.keptTextCharacters).toBeLessThanOrEqual(8 * 1024 * 1024);
  });

  test("and the heap it holds stays near the budget, where by itself it kept every map", () => {
    // Measured: 45 MB bounded, 172 MB by itself.
    expect(bounded.heapGrowthMb).toBeLessThan(BUDGET_MB + 16);
    expect(control.heapGrowthMb).toBeGreaterThan(BUDGET_MB * 2.5);
    expect(control.heapGrowthMb).toBeGreaterThan(bounded.heapGrowthMb * 2.5);
  });
});

describe("the source-map-support every server installs", () => {
  const library: string = fs.readFileSync(LIBRARY, "utf8");

  test("is the one each server's lockfile installs, with the same trace-mapping", () => {
    const installed: { version: string } = JSON.parse(
      fs.readFileSync(path.join(path.dirname(LIBRARY), "package.json"), "utf8"),
    ) as { version: string };
    const traceMapping: { version: string } = JSON.parse(
      fs.readFileSync(
        path.join(path.dirname(TRACE_MAPPING), "..", "package.json"),
        "utf8",
      ),
    ) as { version: string };

    for (const server of SERVERS) {
      const lock: {
        packages: Record<string, { version?: string }>;
      } = JSON.parse(
        fs.readFileSync(
          path.join(PACKAGES_ROOT, server, "package-lock.json"),
          "utf8",
        ),
      ) as { packages: Record<string, { version?: string }> };

      expect({
        server,
        library:
          lock.packages["node_modules/@cspotcode/source-map-support"]?.version,
        traceMapping:
          lock.packages[
            "node_modules/@cspotcode/source-map-support/node_modules/@jridgewell/trace-mapping"
          ]?.version,
      }).toEqual({
        server,
        library: installed.version,
        traceMapping: traceMapping.version,
      });
    }
  });

  test("shares its state in the version the transpiler knows", () => {
    expect(library).toContain("var sharedDataVersion = 1;");
    expect(library).toContain(
      "var sharedDataKey = 'source-map-support/sharedData';",
    );
    expect(library).toContain("sharedDataKey = Symbol.for(sharedDataKey);");
  });

  test("only reads, writes and asks hasOwnProperty of its caches by key, and replaces them only to empty them before every stack trace", () => {
    const uses: Array<string> = library
      .split("\n")
      .filter((line: string): boolean => {
        return CACHE_USE.test(line);
      })
      .map((line: string): string => {
        return line.trim();
      });

    expect(uses).toEqual([
      "return sharedData.fileContentsCache[getCacheKey(key)];",
      "return Object.prototype.hasOwnProperty.call(sharedData.fileContentsCache, key);",
      "return sharedData.fileContentsCache[key];",
      "return sharedData.fileContentsCache[getCacheKey(key)] = value;",
      "return sharedData.sourceMapCache[getCacheKey(key)];",
      "return sharedData.sourceMapCache[getCacheKey(key)] = value;",
      "sharedData.fileContentsCache = Object.create(null);",
      "sharedData.sourceMapCache = Object.create(null);",
    ]);
    // clearCaches(), the two replacements, runs only when asked to empty them.
    expect(
      library
        .split("\n")
        .filter((line: string): boolean => {
          return line.includes("clearCaches()");
        })
        .map((line: string): string => {
          return line.trim();
        }),
    ).toEqual(["function clearCaches() {", "clearCaches();"]);
    expect(library).toMatch(
      /if \(sharedData\.emptyCacheBetweenOperations\) \{\s*clearCaches\(\);/,
    );
  });

  test("keeps each map as trace-mapping's TraceMap, which holds its encoded mappings as _encoded and its sources", () => {
    const traceMapping: string = fs.readFileSync(TRACE_MAPPING, "utf8");

    expect(library).toContain("map: new AnyMap(urlAndMap.map, urlAndMap.url)");
    expect(traceMapping).toContain("this._encoded = mappings;");
    expect(traceMapping).toContain("this.sourcesContent = sourcesContent;");
  });
});
