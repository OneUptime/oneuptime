"use strict";

/**
 * A browser suite writes the product's no-break space through
 * packages/E2E/SuiteHelpers/NoBreakSpaces.ts, never by hand.
 *
 * The product holds a number to its unit with a no-break space (U+00A0,
 * #8302): "182 ms". A spec that typed it - as the character, as its
 * escape (backslash, u00A0) or as String.fromCharCode(0xa0) - read like
 * one with a plain space, and the specs that typed a plain space went red
 * without anyone seeing why (#8689, #8748). NoBreakSpaces gives them withUnit(182, "ms") and
 * NO_BREAK_SPACE, which say what they hold, and withSpacesShown, which
 * makes a failure say which space it read (#8725).
 *
 * A function the page runs (the callback of evaluate, evaluateAll,
 * waitForFunction, addInitScript ...) cannot import a module, so it may
 * write the space itself; so may SuiteHelpers, where the helper lives.
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
  "build",
  "dist",
  "SuiteHelpers",
]);

// Calls whose function argument runs in the page.
const PAGE_SIDE_CALLS = new Set([
  "evaluate",
  "evaluateAll",
  "evaluateHandle",
  "$eval",
  "$$eval",
  "waitForFunction",
  "addInitScript",
]);

const RAW = String.fromCharCode(0xa0);
const ESCAPE = /\\u00[aA]0|\\xa0|\\xA0|\\u\{a0\}|\\u\{A0\}/;
const FROM_CHAR_CODE = /String\.fromCharCode\(\s*(0xa0|0xA0|160)\s*\)/;

function specsUnder(directory) {
  const found = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || SKIPPED_DIRECTORIES.has(entry.name)) {
      continue;
    }

    const full = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      found.push(...specsUnder(full));
    } else if (/\.spec\.ts$/.test(entry.name)) {
      found.push(full);
    }
  }

  return found.sort();
}

// Whether `node` is inside a function the page runs.
function isPageSide(node) {
  for (let at = node; at && at.parent; at = at.parent) {
    const parent = at.parent;

    if (
      (ts.isArrowFunction(at) || ts.isFunctionExpression(at)) &&
      ts.isCallExpression(parent) &&
      parent.arguments.includes(at) &&
      ts.isPropertyAccessExpression(parent.expression) &&
      PAGE_SIDE_CALLS.has(parent.expression.name.text)
    ) {
      return true;
    }
  }

  return false;
}

/*
 * Every no-break space a spec writes by hand outside a function the page
 * runs: its line and how it was written.
 */
function handWrittenSpacesOf(file, source) {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const found = [];
  const add = (node, how) => {
    if (!isPageSide(node)) {
      found.push({
        line:
          sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
            .line + 1,
        how,
      });
    }
  };

  function visit(node) {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isRegularExpressionLiteral(node)
    ) {
      const written = node.getText(sourceFile);

      if (written.includes(RAW)) {
        add(node, "the character itself");
      } else if (ESCAPE.test(written)) {
        add(node, "an escape");
      }
    } else if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.getText(sourceFile) === "String.fromCharCode" &&
      FROM_CHAR_CODE.test(node.getText(sourceFile))
    ) {
      add(node, "String.fromCharCode");
      return;
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  return found;
}

describe("the reader of hand-written no-break spaces", () => {
  test("finds the character, an escape and fromCharCode, and leaves what the page runs and a plain space alone", () => {
    const source = [
      'const a = "182' + RAW + 'ms";',
      'const b = "182\\u00A0ms";',
      "const c = /\\d+\\u00a0ms/;",
      "const d = String.fromCharCode(0xa0);",
      "const e = `182${x}\\u00a0ms`;",
      "const f = String.fromCharCode(160);",
      'const g = "182 ms";',
      "await page.evaluate(() => { return '\\u00A0'; });",
      "await locator.evaluateAll((cells) => cells.map(() => String.fromCharCode(0xa0)));",
      "// a comment about \\u00A0",
    ].join("\n");

    expect(handWrittenSpacesOf("Sample.spec.ts", source)).toEqual([
      { line: 1, how: "the character itself" },
      { line: 2, how: "an escape" },
      { line: 3, how: "an escape" },
      { line: 4, how: "String.fromCharCode" },
      { line: 5, how: "an escape" },
      { line: 6, how: "String.fromCharCode" },
    ]);
  });
});

describe("browser suites write the no-break space through SuiteHelpers/NoBreakSpaces", () => {
  const specs = specsUnder(E2E_DIR);

  test("the specs and the helper are where they are kept (the check below is not vacuous)", () => {
    expect(specs.length).toBeGreaterThan(200);
    expect(
      fs.readFileSync(
        path.join(E2E_DIR, "SuiteHelpers", "NoBreakSpaces.ts"),
        "utf8",
      ),
    ).toMatch(/export const withUnit/);
  });

  test("no spec writes U+00A0 by hand outside what the page runs", () => {
    const found = [];

    for (const file of specs) {
      const source = fs.readFileSync(file, "utf8");

      if (
        !source.includes(RAW) &&
        !ESCAPE.test(source) &&
        !FROM_CHAR_CODE.test(source)
      ) {
        continue;
      }

      for (const space of handWrittenSpacesOf(file, source)) {
        found.push(
          `${path.relative(E2E_DIR, file).split(path.sep).join("/")}:${space.line} writes a no-break space as ${space.how}: use withUnit or NO_BREAK_SPACE from SuiteHelpers/NoBreakSpaces`,
        );
      }
    }

    expect(found).toEqual([]);
  });
});
