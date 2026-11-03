import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * NO PRODUCT CODE EVICTS WITH map.keys().next().
 *
 * A bounded cache in a Map evicts its oldest entry, the first in insertion
 * order. keys().next() answers it, but V8 leaves a deleted entry's slot in
 * the map's table until it compacts the table, and a new iterator starts at
 * the first slot: in a cache that evicts on every write, each keys().next()
 * walked past every slot evicted since the last compaction - 10 to 14
 * microseconds a write in a full cache of 10,000 to 50,000 entries.
 * Common/Utils/OldestKeyMap answers the same key in constant time and lets
 * go of what it deletes; on 2026-11-02 the 32 evictions of the product (in
 * Common, App, the Probe, Home and ee) moved onto it, and this keeps new
 * ones off keys().next(). InMemoryTTLCache keeps its own cursor
 * (Utils/OldestKeyCursor), which OldestKeyMap is built on.
 *
 * It reads the code with TypeScript's parser, so a comment or a string that
 * says keys().next() is not a finding, and a chain split over lines is.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../..");

// The packages whose code can import Common/Utils/OldestKeyMap.
const SCOPE: ReadonlyArray<string> = [
  "packages/Common",
  "packages/App",
  "packages/Probe",
  "packages/Runner",
  "packages/Home",
  "packages/CLI",
  "packages/TestServer",
  "ee",
];

const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set<string>([
  "node_modules",
  "build",
  "dist",
  "Tests",
  "coverage",
]);

const CODE_FILE: RegExp = /\.tsx?$/;
const WHITESPACE: RegExp = /\s+/g;
const DECLARATION_FILE: RegExp = /\.d\.ts$/;

function codeFilesUnder(directory: string): Array<string> {
  const found: Array<string> = [];

  if (!fs.existsSync(directory)) {
    return found;
  }

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || SKIPPED_DIRECTORIES.has(entry.name)) {
      continue;
    }

    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      found.push(...codeFilesUnder(full));
    } else if (
      CODE_FILE.test(entry.name) &&
      !DECLARATION_FILE.test(entry.name)
    ) {
      found.push(full);
    }
  }

  return found;
}

interface KeysNextRead {
  line: number;
  code: string;
}

type KeysNextReadsOfFunction = (
  file: string,
  source: string,
) => Array<KeysNextRead>;

// Every <expression>.keys().next() a source calls.
const keysNextReadsOf: KeysNextReadsOfFunction = (
  file: string,
  source: string,
): Array<KeysNextRead> => {
  const sourceFile: ts.SourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const reads: Array<KeysNextRead> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      node.arguments.length === 0 &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "next"
    ) {
      const iterator: ts.Expression = node.expression.expression;

      if (
        ts.isCallExpression(iterator) &&
        iterator.arguments.length === 0 &&
        ts.isPropertyAccessExpression(iterator.expression) &&
        iterator.expression.name.text === "keys"
      ) {
        reads.push({
          line:
            sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
              .line + 1,
          code: node.getText(sourceFile).replace(WHITESPACE, ""),
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return reads;
};

describe("the reader of keys().next() calls", () => {
  test("finds a chain on one line or split over two, and no comment or string", () => {
    expect(
      keysNextReadsOf(
        "Sample.ts",
        [
          "// cache.keys().next() in a comment",
          'const words: string = "map.keys().next().value";',
          "const a: string | undefined = cache.keys().next().value;",
          "const b: string | undefined = this.cache",
          "  .keys()",
          "  .next().value;",
          "const c: string | undefined = cache.values().next().value;",
          "const d: unknown = iterator.next();",
        ].join("\n"),
      ),
    ).toEqual([
      { line: 3, code: "cache.keys().next()" },
      { line: 4, code: "this.cache.keys().next()" },
    ]);
  });
});

describe("product code evicts through OldestKeyMap", () => {
  const files: Array<string> = SCOPE.flatMap(
    (folder: string): Array<string> => {
      return codeFilesUnder(path.join(REPOSITORY_ROOT, folder));
    },
  );

  test("the files are found where they are kept (the check below is not vacuous)", () => {
    const relative: Array<string> = files.map((file: string): string => {
      return path.relative(REPOSITORY_ROOT, file).split(path.sep).join("/");
    });

    expect(relative.length).toBeGreaterThan(5000);
    expect(relative).toContain("packages/Common/Utils/OldestKeyMap.ts");
    expect(relative).toContain(
      "packages/Probe/Utils/NetFlow/FlowAggregator.ts",
    );
    expect(relative).toContain("packages/Home/Utils/FixedWindowRateLimiter.ts");
  });

  test("no product file evicts with keys().next()", () => {
    const findings: Array<string> = [];

    for (const file of files) {
      const source: string = fs.readFileSync(file, "utf-8");

      if (!source.includes(".keys()")) {
        continue;
      }

      for (const read of keysNextReadsOf(file, source)) {
        findings.push(
          `${path.relative(REPOSITORY_ROOT, file).split(path.sep).join("/")}:${read.line} ${read.code} - evict with OldestKeyMap's oldestKey() (Common/Utils/OldestKeyMap)`,
        );
      }
    }

    expect(findings).toEqual([]);
  });
});
