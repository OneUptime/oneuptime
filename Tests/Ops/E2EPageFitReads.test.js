"use strict";

/**
 * Every browser suite reads whether a page scrolls sideways through one
 * helper, which reads it until the page has settled.
 *
 * A page that fits its window can draw a frame or two that does not: Common's
 * Table fits its columns to its card a frame after it paints (on a phone it
 * paints the desktop table first and becomes cards a moment later), the
 * dashboard canvas resizes its widgets after their rows show, a font swaps
 * in. About twenty suites read document.documentElement.scrollWidth once,
 * right after a resize or a click, and failed pages that fit on slow runners
 * (2026-11-02: CloudConnect's account Changes one run in 97 under load;
 * ExternalStatusPageMonitor raced in #5522's review). On 2026-11-02 the 201
 * such one-shot reads, and six suites' own polled copies, in 150 specs moved
 * onto packages/E2E/SuiteHelpers/PageFit.ts: expectNoSidewaysScroll(page)
 * reads the page again until it fits, for as long as an expect waits, and a
 * page that really runs past its window still fails, saying by how many
 * pixels.
 *
 * This holds every TypeScript file under packages/E2E but that helper to
 * reading the page's own width (document.documentElement.scrollWidth or
 * document.body.scrollWidth) never: a suite asks the helper. An element's
 * own scrollWidth (a cell, a card, a chip) is not the page's and is left
 * alone.
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const E2E_DIR = path.join(REPO_ROOT, "packages", "E2E");
const HELPER = "SuiteHelpers/PageFit.ts";
const SKIPPED_DIRECTORIES = new Set([
  "node_modules",
  "test-results",
  "playwright-report",
  "build",
  "dist",
]);

function typeScriptFilesUnder(directory) {
  const found = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || SKIPPED_DIRECTORIES.has(entry.name)) {
      continue;
    }

    const full = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      found.push(...typeScriptFilesUnder(full));
    } else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      found.push(full);
    }
  }

  return found.sort();
}

// `document.documentElement` or `document.body`, the page's own boxes.
function isPageElement(node) {
  return (
    ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "document" &&
    (node.name.text === "documentElement" || node.name.text === "body")
  );
}

/*
 * Every read of the page's own scrollWidth in a source: the line and the
 * code that reads it. Comments and strings are not code, so a comment that
 * names document.documentElement.scrollWidth is not a read.
 */
function pageWidthReadsOf(file, source) {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const reads = [];

  function visit(node) {
    if (
      ts.isPropertyAccessExpression(node) &&
      node.name.text === "scrollWidth" &&
      isPageElement(node.expression)
    ) {
      reads.push({
        line:
          sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
            .line + 1,
        code: node.getText(sourceFile),
      });
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  return reads;
}

function relativeToE2E(file) {
  return path.relative(E2E_DIR, file).split(path.sep).join("/");
}

const files = typeScriptFilesUnder(E2E_DIR);

describe("the reader of page width reads", () => {
  test("finds the page's own scrollWidth, read either way, and no other", () => {
    const reads = pageWidthReadsOf(
      "Sample.spec.ts",
      [
        "// document.documentElement.scrollWidth, in a comment",
        'const words = "document.body.scrollWidth";',
        "await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);",
        "await page.evaluate(() => {",
        "  return document.body.scrollWidth <= window.innerWidth;",
        "});",
        "await cell.evaluate((element) => element.scrollWidth > element.clientWidth);",
        "await page.evaluate(() => document.querySelector('main')!.scrollWidth);",
        "await page.evaluate(() => document.documentElement.clientWidth);",
      ].join("\n"),
    );

    expect(reads).toEqual([
      { line: 3, code: "document.documentElement.scrollWidth" },
      { line: 5, code: "document.body.scrollWidth" },
    ]);
  });
});

describe("browser suites read a page's sideways scroll through SuiteHelpers/PageFit.ts", () => {
  test("the helper is where the suites import it from, and reads the page", () => {
    expect(files.map(relativeToE2E)).toContain(HELPER);

    const helper = fs.readFileSync(path.join(E2E_DIR, HELPER), "utf8");

    expect(pageWidthReadsOf(HELPER, helper)).toEqual([
      expect.objectContaining({
        code: "document.documentElement.scrollWidth",
      }),
    ]);
    // It reads until the page fits, not once.
    expect(helper).toContain("expect\n    .poll(");
    expect(helper).toContain("export const expectNoSidewaysScroll");
  });

  test("the suites are found where they are kept (the check below is not vacuous)", () => {
    const relative = files.map(relativeToE2E);

    expect(relative.length).toBeGreaterThan(300);
    expect(relative).toContain("ModelTables/ModelTables.spec.ts");
    expect(relative).toContain("CloudConnect/CloudConnect.spec.ts");
  });

  test("no other file reads the page's own scrollWidth", () => {
    const reads = [];

    for (const file of files) {
      const relative = relativeToE2E(file);

      if (relative === HELPER) {
        continue;
      }

      const source = fs.readFileSync(file, "utf8");

      if (!source.includes("scrollWidth")) {
        continue;
      }

      for (const read of pageWidthReadsOf(file, source)) {
        reads.push(`${relative}:${read.line} reads ${read.code}`);
      }
    }

    expect(reads).toEqual([]);
  });
});
