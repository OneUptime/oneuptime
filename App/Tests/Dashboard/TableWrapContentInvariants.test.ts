import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * WHY THIS FILE EXISTS
 *
 * OneUptime issue #3585: on the Discovery Scans table, editing a scan makes
 * the server write a 156-character sentence into `statusMessage`
 * (RETIRE_RUN_PAYLOAD in
 * Common/Server/Services/NetworkDeviceDiscoveryScanService.ts), the Discovery
 * page rendered it in the "Responded Hosts" cell, and the sentence painted
 * straight over the "Recurrence" and "Started" cells beside it.
 *
 * The cause is one line of CSS and one property of CSS: every desktop body
 * `<td>` in Common/UI/Components/Table/TableRow.tsx declares
 * `whitespace-nowrap`, and `white-space` is an INHERITED property — so the
 * nowrap reaches whatever element `getElement` returns, no matter what
 * classes that element carries. The `max-w-md` the page had put on its own
 * explanation div then made things WORSE rather than better: a capped box
 * around an unbreakable line is exactly an overflow, so the text left the
 * column instead of merely widening it.
 *
 * That defect is invisible to every kind of test this repo can run. The App
 * suite is `testEnvironment: "node"` with no DOM at all, and even under jsdom
 * there is NO LAYOUT: getBoundingClientRect returns zeros, `white-space` is
 * never resolved, nothing wraps, nothing overflows and no column has a width.
 * A test that "checks the text does not overlap" cannot be written here, or
 * anywhere in CI as it stands. So the only durable guard is a source-level
 * one — every assertion below is a class / attribute / call-site assertion
 * over the source TEXT, deliberately, in the places a reader would expect a
 * visual assertion.
 *
 * Sources are whitespace-squashed and matched with regexes rather than exact
 * lines, so a prettier run that re-wraps a JSX attribute or a ternary cannot
 * turn a standing invariant into a false alarm. An invariant test that breaks
 * on a reformat is worse than no invariant test at all.
 *
 * The shape (fs/path over Dashboard and Common sources, squash + regex) is
 * the one NetworkFormStepsInvariants.test.ts and
 * SummaryTileFilteringInvariants.test.ts already use in this directory.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const COMMON_TABLE: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "Common",
  "UI",
  "Components",
  "Table",
);

function squash(text: string): string {
  return text.replace(/\s+/g, " ");
}

function readSource(root: string, ...relativeParts: Array<string>): string {
  return squash(fs.readFileSync(path.join(root, ...relativeParts), "utf8"));
}

// Every .ts/.tsx file under a directory, recursively.
function sourceFilePaths(directory: string): Array<string> {
  const filePaths: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      filePaths.push(...sourceFilePaths(entryPath));
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      filePaths.push(entryPath);
    }
  }

  return filePaths;
}

function matchAll(pattern: RegExp, text: string): Array<string> {
  const values: Array<string> = [];
  // Cloned so a shared /g regex cannot carry lastIndex between calls.
  const scanner: RegExp = new RegExp(pattern.source, "g");

  let match: RegExpExecArray | null = scanner.exec(text);

  while (match !== null) {
    values.push(match[1]!);
    match = scanner.exec(text);
  }

  return values;
}

function countOccurrences(pattern: RegExp, text: string): number {
  return (text.match(new RegExp(pattern.source, "g")) || []).length;
}

/**
 * The body of one column declaration, found by its `title:` and running to the
 * next column's `title:` (or to the end of the file for the last one).
 *
 * Deliberately crude: a real parser is not worth it here, and the JSX inside a
 * `getElement` spells its own title as `title={...}`, never `title: "..."`, so
 * the next `title: "` really is the next column.
 */
function columnBlockByTitle(source: string, title: string): string {
  const needle: string = `title: "${title}"`;
  const startIndex: number = source.indexOf(needle);

  expect(startIndex).toBeGreaterThan(-1);

  const rest: string = source.slice(startIndex + needle.length);
  const nextTitleIndex: number = rest.search(/title:\s*"/);

  return nextTitleIndex === -1 ? rest : rest.slice(0, nextTitleIndex);
}

const TABLE_ROW: string = readSource(COMMON_TABLE, "TableRow.tsx");
const TABLE_SKELETON_ROWS: string = readSource(
  COMMON_TABLE,
  "TableSkeletonRows.tsx",
);
const DISCOVERY_PAGE: string = readSource(
  DASHBOARD_SRC,
  "Pages",
  "NetworkDevice",
  "Discovery.tsx",
);

/*
 * The composite `<td>` class string that TableRow and TableSkeletonRows each
 * used to hard-code, in either padding variant. Matched loosely — any
 * whitespace mode, any right padding — because the point is that NOBODY
 * spells this string inline any more, not that one particular spelling of it
 * is gone.
 */
const HARD_CODED_CELL_CLASS_LITERAL: RegExp =
  /"whitespace-[a-z]+ py-4 pl-4 pr-\d/;

const CELL_CLASS_HELPER_CALL: RegExp =
  /getTableCellClassName\s*(<[^>]*>)?\s*\(/;

/*
 * A ModelTable that renders as a List rather than a table. Its cells go
 * through Detail, not TableRow.
 */
const LIST_MODE_TABLE: RegExp = /showAs=\{\s*ShowAs\.List\s*\}/;

/*
 * `max-w-full` and `max-w-none` are named max-widths that cap nothing, so
 * neither can generate the overlap this rule is about.
 */
function isRealWidthCap(value: string): boolean {
  return value
    .replace(/max-w-full/g, "")
    .replace(/max-w-none/g, "")
    .includes("max-w-");
}

/*
 * GROUP 1 — on a table, the pairing that generated #3585 must stay unspellable.
 *
 * Inside a `<td>`, `contentClassName` lands on a div that inherits the row's
 * nowrap, so a `max-w-*` written there is a cap around a line that cannot
 * break: the overlap generator itself. A width cap belongs in
 * `wrapMaxWidthClassName`, which `getTableCellContentClassName` only ever
 * emits alongside `whitespace-normal break-words` — so through that option the
 * bad pairing cannot be expressed at all.
 *
 * SCOPE, deliberately narrow, because the rule is only true where there IS a
 * `<td>`. Files whose ModelTable renders `showAs={ShowAs.List}` are skipped: a
 * List goes through Detail rather than TableRow, never produces a `<td>` and
 * never inherits a nowrap, so a width cap there is harmless — and
 * `wrapMaxWidthClassName` is not read on that path at all (BaseModelTable's
 * Detail-field mapping forwards `contentClassName` alone), so banning it would
 * leave those authors no way to say what they mean. That is not a hypothetical
 * carve-out: every `contentClassName` in the Dashboard today except Discovery's
 * own is on such a table — the Incident / Alert / ScheduledMaintenance note
 * lists.
 *
 * Note what is NOT asserted: a `whitespace-*` utility inside
 * `contentClassName` is perfectly legitimate — those same note tables declare
 * `whitespace-nowrap` there on purpose. Only a real width cap is banned.
 *
 * The scan reads the value expression rather than only string literals, so a
 * cap written as a variable or a template literal is caught too. It stops at
 * the value's terminating comma, so one buried inside a multi-argument call
 * (`clsx("a", "max-w-md")`) would slip past. Accepted: nothing in the tree is
 * spelled that way, and a regex is not a parser.
 */
describe("a table column never caps its width through contentClassName", () => {
  test("no contentClassName on a <td>-rendering table declares a width cap", () => {
    const filePaths: Array<string> = sourceFilePaths(DASHBOARD_SRC);

    // Guards against a broken walk quietly asserting over nothing.
    expect(filePaths.length).toBeGreaterThan(100);

    const offenders: Array<string> = [];
    let declarationCount: number = 0;
    let skippedListFiles: number = 0;

    for (const filePath of filePaths) {
      const source: string = squash(fs.readFileSync(filePath, "utf8"));

      if (LIST_MODE_TABLE.test(source)) {
        skippedListFiles++;
        continue;
      }

      for (const value of matchAll(/contentClassName:\s*([^,}]*)/, source)) {
        declarationCount++;

        if (isRealWidthCap(value)) {
          offenders.push(`${path.relative(DASHBOARD_SRC, filePath)}: ${value}`);
        }
      }
    }

    /*
     * Both halves of the scope did something: table-mode declarations were
     * examined, and List-mode files were really found and skipped rather than
     * the exclusion being dead code that silently stops excluding anything.
     */
    expect(declarationCount).toBeGreaterThan(0);
    expect(skippedListFiles).toBeGreaterThan(0);

    expect(offenders).toEqual([]);
  });
});

/*
 * GROUP 2 — the shared cell class must keep coming from one place.
 *
 * The nowrap default is load-bearing for every date, count, badge and actions
 * cell in the product — roughly two hundred column declarations with no
 * layout coverage of their own — so the fix could not simply drop it; it made
 * the class a function of the column instead. If a renderer goes back to
 * writing the literal inline, the `wrapContent` opt-out silently stops
 * working for every cell that renderer draws, and nothing else in CI notices.
 */
describe("Table cell classes are built by the shared helper", () => {
  test("TableRow builds its <td> class with getTableCellClassName", () => {
    expect(TABLE_ROW).toMatch(CELL_CLASS_HELPER_CALL);
  });

  test("TableRow no longer hard-codes the <td> class literal", () => {
    /*
     * If this fails, someone re-inlined the cell classes in TableRow. The
     * shared nowrap default is load-bearing for every date, count, badge and
     * actions cell in the product, and inlining it takes `wrapContent` — the
     * fix for issue #3585 — out of the path for every table at once.
     */
    expect(TABLE_ROW).not.toMatch(HARD_CODED_CELL_CLASS_LITERAL);
  });

  test("TableRow builds its content wrapper class with getTableCellContentClassName", () => {
    expect(TABLE_ROW).toMatch(
      /getTableCellContentClassName\s*(<[^>]*>)?\s*\(\s*column\s*\)/,
    );

    /*
     * And reads `column.contentClassName` nowhere itself: the width cap for a
     * wrapping column has to be merged with it in one place, or a column that
     * declares both ends up with only one of the two on the div.
     */
    expect(TABLE_ROW).not.toMatch(/column\.contentClassName/);
  });

  test("TableSkeletonRows shares the same helper rather than its own copy", () => {
    /*
     * The skeleton's classes were originally copied out of TableRow by hand,
     * which is how two spellings of one cell come to exist in the first
     * place. Routing both through the helper is what stops the placeholder
     * rows from drifting out of alignment with the real rows that replace
     * them.
     */
    expect(TABLE_SKELETON_ROWS).toMatch(CELL_CLASS_HELPER_CALL);
    expect(TABLE_SKELETON_ROWS).not.toMatch(HARD_CODED_CELL_CLASS_LITERAL);
  });
});

/*
 * WHAT IS DELIBERATELY *NOT* ASSERTED HERE
 *
 * Nothing in this file pins how CellClassName.ts is written — not the ternary
 * that keeps `whitespace-nowrap` the default, not the `if (column.wrapContent)`
 * that gates the width cap, not the exact class string a plain column gets.
 * Those are the most important guarantees in the change, and source text is the
 * wrong way to hold them: a regex over the helper's body stays green when the
 * fix is reverted at the renderers (the helper is still spelled correctly, it
 * has simply stopped being called), and goes red for edits that emit exactly
 * the same classes — `??` for `||`, a renamed local, an early return, the two
 * literals lifted into constants.
 *
 * They are held behaviourally instead, against exact strings, in
 * Common/Tests/UI/Components/TableCellWrapping.test.tsx: "a column that
 * declares nothing keeps the pre-#3585 cell classes" pins both padding
 * variants byte-for-byte, "with no width named, the wrapper takes the exported
 * default cap" pins the default, and "a width cap alone emits nothing" pins the
 * gate. What THIS file adds is only the part no rendering test can see: that
 * the renderers still call the helper at all.
 */

/*
 * GROUP 3 — the page that reported #3585 stays fixed.
 *
 * Two columns opt in. "Responded Hosts" is the cell whose sentence overlapped.
 * "Recurrence" is the other half of the same deformed row: the server write
 * that sets the status message also blanks nextScanAt, so that column renders
 * a sentence of its own in the very same row, on one unbreakable line, with no
 * width cap at all. And the `max-w-md` the page used to put on its own
 * explanation divs is gone: capping the width is the helper's job now, and left
 * on a div that inherits nowrap that cap IS the overflow.
 */
describe("Discovery page columns opt into wrapping", () => {
  test("at least two columns declare wrapContent", () => {
    expect(
      countOccurrences(/wrapContent:\s*true/, DISCOVERY_PAGE),
    ).toBeGreaterThanOrEqual(2);
  });

  test("Responded Hosts wraps and no longer caps its own explanation divs", () => {
    const block: string = columnBlockByTitle(DISCOVERY_PAGE, "Responded Hosts");

    expect(block).toMatch(/wrapContent:\s*true/);

    /*
     * jsdom cannot be asked whether the text overflows — there is no layout
     * anywhere in CI — so the assertion is on the class that CAUSED the
     * overflow. A `max-w-*` anywhere inside this column, on an element that
     * inherits the row's whitespace mode, is the exact shape of the bug.
     */
    expect(block).not.toMatch(/max-w-/);
  });

  test("Recurrence wraps with its own narrower cap", () => {
    const block: string = columnBlockByTitle(DISCOVERY_PAGE, "Recurrence");

    expect(block).toMatch(/wrapContent:\s*true/);
    expect(block).toMatch(/wrapMaxWidthClassName:\s*"max-w-xs"/);
  });

  test("both explanation divs keep title={outcome.explanation}", () => {
    /*
     * The width cap means a long enough message can still be clipped by the
     * column, so the hover affordance that shows the whole sentence is not
     * decoration — it is the fallback. It sits on the two divs that render
     * `outcome.explanation`, and the cleanup that removed their `max-w-md`
     * neighbours must not take it with them.
     */
    const block: string = columnBlockByTitle(DISCOVERY_PAGE, "Responded Hosts");

    expect(countOccurrences(/title=\{outcome\.explanation\}/, block)).toBe(2);
  });
});
