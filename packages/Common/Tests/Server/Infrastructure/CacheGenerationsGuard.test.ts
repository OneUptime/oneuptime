import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * GUARD: the caches that keep their entries by generation - the status page
 * overview and the on-call calendar feeds - take their generations from
 * CacheGenerations, and keep none of their own. Two copies of the scheme
 * had drifted apart: one read Redis first and its own memory only while
 * Redis failed, so a purge whose write did not reach Redis was ignored in
 * the very process that made it as soon as Redis answered again. One copy
 * keeps the failure cases in one place, with one set of tests
 * (CacheGenerations.test.ts).
 */

const COMMON_DIR: string = path.resolve(__dirname, "../../..");
const REPO_DIR: string = path.resolve(COMMON_DIR, "../..");

const HELPER: string = "Server/Infrastructure/CacheGenerations.ts";

// The caches that keep entries by generation, relative to packages/Common.
const GENERATION_CACHES: ReadonlyArray<string> = [
  "Server/Utils/StatusPage/StatusPageOverviewCache.ts",
  "Server/Infrastructure/OnCallCalendarFeedCache.ts",
];

// Pieces of the scheme that live in CacheGenerations alone.
const SCHEME_PIECES: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  { name: "the outage marker", pattern: /UNREACHABLE_GENERATION/ },
  { name: "a remembered shared generation", pattern: /sharedGenerations?\b/ },
  {
    name: "a generation kept in memory",
    pattern: /memoryGenerations?\b|generations\s*:\s*InMemoryTTLCache/,
  },
  {
    name: "a generation token of its own",
    pattern: /randomBytes\(\s*6\s*\)/,
  },
  {
    name: "a generation read from or written to Redis",
    pattern: /GlobalCache\.(getString|setString)\([^;]*[gG]eneration/,
  },
];

function read(relativePath: string): string {
  return fs.readFileSync(path.join(COMMON_DIR, relativePath), "utf8");
}

// Every .ts file under a directory, but node_modules.
function sourceFiles(directory: string): Array<string> {
  const files: Array<string> = [];

  if (!fs.existsSync(directory)) {
    return files;
  }

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) {
      continue;
    }

    const fullPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...sourceFiles(fullPath));
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      files.push(fullPath);
    }
  }

  return files;
}

describe("GUARD: caches kept by generation use CacheGenerations", () => {
  test.each(GENERATION_CACHES)(
    "%s takes its generations from one CacheGenerations",
    (cache: string) => {
      const source: string = read(cache);

      expect(source).toMatch(
        /import CacheGenerations(, \{[^}]*\})? from "[./]*(Infrastructure\/)?CacheGenerations";/,
      );
      expect(source.match(/new CacheGenerations\(\{/g)).toHaveLength(1);
      // Read and started through it.
      expect(source).toMatch(/generations\.get\(/);
      expect(source).toMatch(/generations\.bump\(/);
    },
  );

  test.each(
    GENERATION_CACHES.flatMap((cache: string) => {
      return SCHEME_PIECES.map((piece: { name: string; pattern: RegExp }) => {
        return { cache, ...piece };
      });
    }),
  )(
    "$cache keeps no copy of the scheme: $name",
    ({ cache, pattern }: { cache: string; pattern: RegExp }) => {
      expect(read(cache)).not.toMatch(pattern);
    },
  );

  test("no other server code keeps a copy of the scheme", () => {
    const copies: Array<string> = [];

    for (const directory of [
      path.join(COMMON_DIR, "Server"),
      path.join(REPO_DIR, "packages", "App", "FeatureSet"),
      path.join(REPO_DIR, "ee", "Server"),
    ]) {
      for (const file of sourceFiles(directory)) {
        if (file === path.join(COMMON_DIR, HELPER)) {
          continue;
        }

        const source: string = fs.readFileSync(file, "utf8");

        for (const piece of SCHEME_PIECES.slice(0, 3)) {
          if (piece.pattern.test(source)) {
            copies.push(`${path.relative(REPO_DIR, file)}: ${piece.name}`);
          }
        }
      }
    }

    expect(copies).toEqual([]);
  });

  test("the helper is used by exactly the caches named here", () => {
    const users: Array<string> = sourceFiles(path.join(COMMON_DIR, "Server"))
      .filter((file: string): boolean => {
        return (
          file !== path.join(COMMON_DIR, HELPER) &&
          /from "[./]*(Infrastructure\/)?CacheGenerations"/.test(
            fs.readFileSync(file, "utf8"),
          )
        );
      })
      .map((file: string): string => {
        return path.relative(COMMON_DIR, file);
      })
      .sort();

    // A new cache kept by generation is named above, and held to the same.
    expect(users).toEqual([...GENERATION_CACHES].sort());
  });
});
