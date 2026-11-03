"use strict";

/**
 * Boxes a browser suite compares are read in one frame.
 *
 * Each locator.boundingBox() is a round trip of its own, so two read one
 * after the other come from two moments: while the page moves - a side panel
 * sliding in, a dialog growing in, More fields scrolling its fields into
 * view, a table fitting its columns a frame after it paints - a gap or an
 * alignment between them is off by however far things moved in between
 * (Profiles' notice read 54 to 126 pixels from the words it lines up with,
 * 13 runs in 15 on a busy machine; October 2026). #5328 gave the suites
 * packages/E2E/SuiteHelpers/Frames.ts's boxesInOneFrame, which reads every
 * box in one evaluate, and moved the reads it found racing onto it; on
 * 2026-11-02 the other 103 runs of consecutive boundingBox() reads, in 54
 * specs, moved onto it too.
 *
 * This holds every spec under packages/E2E to it: two or more statements in
 * a row that each await one locator's boundingBox() are read with
 * boxesInOneFrame instead. A box read alone, or one read after an action
 * (to compare where something was with where it went), is left alone.
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const E2E_DIR = path.join(REPO_ROOT, "packages", "E2E");
const SKIPPED_DIRECTORIES = new Set([
  "node_modules",
  "test-results",
  "playwright-report",
]);

function specsUnder(directory) {
  const found = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || SKIPPED_DIRECTORIES.has(entry.name)) {
      continue;
    }

    const full = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      found.push(...specsUnder(full));
    } else if (entry.name.endsWith(".spec.ts")) {
      found.push(full);
    }
  }

  return found.sort();
}

// `const x = await <locator>.boundingBox();` (or `let`): the box's name.
function boxReadOf(statement) {
  if (
    !ts.isVariableStatement(statement) ||
    statement.declarationList.declarations.length !== 1
  ) {
    return null;
  }

  const declaration = statement.declarationList.declarations[0];
  const initializer = declaration.initializer;

  if (!initializer || !ts.isAwaitExpression(initializer)) {
    return null;
  }

  const call = initializer.expression;

  if (
    ts.isCallExpression(call) &&
    call.arguments.length === 0 &&
    ts.isPropertyAccessExpression(call.expression) &&
    call.expression.name.text === "boundingBox"
  ) {
    return declaration.name.getText();
  }

  return null;
}

/*
 * Every run of two or more consecutive one-box reads in a source: the line
 * of its first read and the boxes' names.
 */
function consecutiveBoxReadsOf(file, source) {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const runs = [];

  function visit(node) {
    if (ts.isBlock(node) || ts.isSourceFile(node)) {
      let run = [];
      const flush = () => {
        if (run.length >= 2) {
          runs.push({
            line:
              sourceFile.getLineAndCharacterOfPosition(
                run[0].statement.getStart(sourceFile),
              ).line + 1,
            names: run.map((read) => {
              return read.name;
            }),
          });
        }
        run = [];
      };

      for (const statement of node.statements) {
        const name = boxReadOf(statement);

        if (name) {
          run.push({ statement, name });
        } else {
          flush();
        }
      }

      flush();
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  return runs;
}

const specs = specsUnder(E2E_DIR);

describe("the reader of box reads", () => {
  test("finds two or more boxes read one after the other, and no box read alone or after an action", () => {
    const runs = consecutiveBoxReadsOf(
      "Sample.spec.ts",
      [
        "test('x', async ({ page }) => {",
        "  const first = await page.getByTestId('a').boundingBox();",
        "  const second = await page.getByTestId('b').boundingBox();",
        "  let third = await page.getByTestId('c').boundingBox();",
        "  await page.click('#open');",
        "  const after = await page.getByTestId('a').boundingBox();",
        "  const [one, two] = await boxesInOneFrame([a, b]);",
        "  // const x = await y.boundingBox();",
        "});",
      ].join("\n"),
    );

    expect(runs).toEqual([{ line: 2, names: ["first", "second", "third"] }]);
  });
});

describe("browser suites read the boxes they compare in one frame", () => {
  test("the specs are found where they are kept (the check below is not vacuous)", () => {
    expect(specs.length).toBeGreaterThan(200);
    expect(fs.existsSync(path.join(E2E_DIR, "SuiteHelpers", "Frames.ts"))).toBe(
      true,
    );
  });

  test("no spec reads two boxes one after the other with boundingBox()", () => {
    const found = [];

    for (const file of specs) {
      const source = fs.readFileSync(file, "utf8");

      if ((source.match(/boundingBox\(\)/g) || []).length < 2) {
        continue;
      }

      for (const run of consecutiveBoxReadsOf(file, source)) {
        found.push(
          `${path.relative(E2E_DIR, file).split(path.sep).join("/")}:${run.line} ${run.names.join(", ")}: read them with boxesInOneFrame (SuiteHelpers/Frames.ts)`,
        );
      }
    }

    expect(found).toEqual([]);
  });
});
