import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { listScanRoots, listSourceFiles } from "../../ForeignHiddenRuleGuard";
import {
  TitleRowWithDescription,
  scanTitleRowsWithDescriptions,
} from "../../Helpers/TitleRowDescriptionScan";

/*
 * "There's a lot of gap between the title of the card and the description
 * of the card. Can you please fix it? Please do it in other places as well
 * (if we have the same case everywhere)."
 *
 * Card's own headers are held to it by CardTitleDescriptionGap.test.tsx (in
 * jsdom, from Card's classes) and ModelTables/CardHeaders.spec.ts (in
 * Chromium). This guard holds the headers built by hand: a row of a heading
 * and something to press, then the description after the row. A row is as
 * tall as its tallest part, so a button taller than the heading's line
 * pushes the description down by the difference. Such a row keeps its
 * description under its title only when its actions hang over the
 * heading's line (a negative margin, as Card's actions do from md up) - or
 * draws the heading and the description as one block, the actions beside
 * it, which is not this pattern at all. See Tests/Helpers/
 * TitleRowDescriptionScan.ts for what is read.
 */

const REPOSITORY_ROOT: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
);

/*
 * The rows that keep their description under the title some other way, by
 * file, each with its reason. A new row fails the guard until its actions
 * hang over the heading's line or it is listed here; an entry that no
 * longer matches fails too.
 */
const KEEPS_ITS_OWN_LINE: Record<string, { count: number; reason: string }> = {
  "packages/App/FeatureSet/Dashboard/src/Components/SecurityEvents/HowItWorks/SecurityEventsHowItWorksCard.tsx":
    {
      count: 1,
      reason:
        "The severity levels' 'How ... are chosen' is a text link in the heading's own size (text-sm, no padding): the row is the heading's line, and the description follows it as it would without the link.",
    },
};

function relative(file: string): string {
  return path.relative(REPOSITORY_ROOT, file).split(path.sep).join("/");
}

let cachedRows: Array<TitleRowWithDescription> | null = null;

function scanHandBuiltRows(): Array<TitleRowWithDescription> {
  if (cachedRows) {
    return cachedRows;
  }

  cachedRows = listScanRoots(REPOSITORY_ROOT)
    .flatMap(listSourceFiles)
    .filter((file: string): boolean => {
      return file.endsWith(".tsx");
    })
    .flatMap((file: string): Array<TitleRowWithDescription> => {
      return scanTitleRowsWithDescriptions(
        relative(file),
        fs.readFileSync(file, "utf8"),
      );
    });

  return cachedRows;
}

describe("hand-built headers keep their description under their title", () => {
  test("the scan reads the product's frontends and finds the rows it is about", () => {
    const rows: Array<TitleRowWithDescription> = scanHandBuiltRows();

    // The Security overview's Get started card is one of them.
    expect(
      rows.some((row: TitleRowWithDescription): boolean => {
        return row.file.endsWith(
          "Components/SecurityOverview/SecurityGettingStarted.tsx",
        );
      }),
    ).toBe(true);
  });

  test("every row of a heading and actions over a description hangs its actions over the heading's line", () => {
    const pushedDown: Array<string> = scanHandBuiltRows()
      .filter((row: TitleRowWithDescription): boolean => {
        return !row.keepsDescriptionUnderTitle && !KEEPS_ITS_OWN_LINE[row.file];
      })
      .map((row: TitleRowWithDescription): string => {
        return `${row.file}:${row.line} (row "${row.rowClassName}", description "${row.descriptionClassName}")`;
      });

    /*
     * Draw the heading and its description as one block with the actions
     * beside it (Card's default header) - or use Card - or give the element
     * that holds the actions a negative margin that takes it back to the
     * heading's line (-my-* / -mb-*), so the row is no taller than the
     * heading.
     */
    expect(pushedDown).toEqual([]);
  });

  test("the rows listed as keeping their own line are still there, and no more of them", () => {
    const counts: Map<string, number> = new Map<string, number>();

    for (const row of scanHandBuiltRows()) {
      if (!row.keepsDescriptionUnderTitle) {
        counts.set(row.file, (counts.get(row.file) || 0) + 1);
      }
    }

    /*
     * Only the files in this checkout: CI's Common job deletes ee/ before
     * it runs, and the Enterprise job puts it back.
     */
    const stale: Array<string> = Object.entries(KEEPS_ITS_OWN_LINE)
      .filter(([file]: [string, { count: number }]): boolean => {
        return fs.existsSync(path.join(REPOSITORY_ROOT, file));
      })
      .filter(([file, entry]: [string, { count: number }]): boolean => {
        return (counts.get(file) || 0) !== entry.count;
      })
      .map(([file, entry]: [string, { count: number }]): string => {
        return `${file}: listed ${entry.count}, found ${counts.get(file) || 0}`;
      });

    expect(stale).toEqual([]);

    for (const entry of Object.values(KEEPS_ITS_OWN_LINE)) {
      expect(entry.reason.length).toBeGreaterThan(20);
    }
  });

  test("the two hand-built headers this was fixed in keep their fix", () => {
    const gettingStarted: string = fs.readFileSync(
      path.join(
        REPOSITORY_ROOT,
        "packages/App/FeatureSet/Dashboard/src/Components/SecurityOverview/SecurityGettingStarted.tsx",
      ),
      "utf8",
    );
    const diagnostics: string = fs.readFileSync(
      path.join(
        REPOSITORY_ROOT,
        "packages/App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventConnectionDiagnostics.tsx",
      ),
      "utf8",
    );

    // Get started's Dismiss hangs 2px over the title's line above and below.
    expect(gettingStarted).toContain('<div className="-my-0.5 flex-shrink-0">');
    // Recent runs: the heading and its sentence one block, Refresh beside it.
    expect(
      scanTitleRowsWithDescriptions("Diagnostics.tsx", diagnostics).filter(
        (row: TitleRowWithDescription): boolean => {
          return row.descriptionClassName.includes("text-xs");
        },
      ),
    ).toEqual([]);
    expect(diagnostics).toContain(
      'data-testid="security-connection-run-history-header"',
    );
  });
});

describe("the scan", () => {
  test("finds a row of a heading and a button followed by a description, as Card's stacked header drew it", () => {
    const rows: Array<TitleRowWithDescription> = scanTitleRowsWithDescriptions(
      "Example.tsx",
      `const A = () => (
        <div>
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-base font-semibold">Recent runs</h2>
            <Button title="Refresh" />
          </div>
          <p className="mt-1 text-sm text-gray-500">The latest runs.</p>
        </div>
      );`,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      line: 3,
      rowClassName: "flex items-start justify-between gap-3",
      descriptionClassName: "mt-1 text-sm text-gray-500",
      keepsDescriptionUnderTitle: false,
    });
  });

  test("passes the same row once its actions hang over the heading's line, on their wrapper or on the Button", () => {
    const wrapped: Array<TitleRowWithDescription> =
      scanTitleRowsWithDescriptions(
        "Example.tsx",
        `const A = () => (
          <section>
            <div className="flex items-start justify-between gap-3">
              <h2>Set up Security</h2>
              {isDone ? <></> : (
                <div className="-my-0.5 flex-shrink-0"><Button title="Dismiss" /></div>
              )}
            </div>
            <p className="mt-1 text-sm text-gray-600">What it does.</p>
          </section>
        );`,
      );
    const onTheButton: Array<TitleRowWithDescription> =
      scanTitleRowsWithDescriptions(
        "Example.tsx",
        `const A = () => (
          <section>
            <div className="flex items-center justify-between">
              <h3>Recent runs</h3>
              <Button title="Refresh" className="md:-mb-[7px]" />
            </div>
            <p className="text-xs text-gray-500">The latest runs.</p>
          </section>
        );`,
      );

    expect(wrapped).toHaveLength(1);
    expect(wrapped[0]!.keepsDescriptionUnderTitle).toBe(true);
    expect(onTheButton).toHaveLength(1);
    expect(onTheButton[0]!.keepsDescriptionUnderTitle).toBe(true);
  });

  test("leaves alone a heading and description drawn as one block beside the actions, a row ruled off from what follows, and what is not a description", () => {
    const sources: Array<string> = [
      // One block, the actions beside it: Card's default header.
      `const A = () => (
        <div className="flex items-start justify-between">
          <div><h3>Recent runs</h3><p className="text-xs text-gray-500">The latest.</p></div>
          <Button title="Refresh" />
        </div>
      );`,
      // A panel's header, ruled off: what follows is its body.
      `const A = () => (
        <div>
          <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2">
            <h3>Events</h3><button>Collapse</button>
          </div>
          <div className="px-3 pt-2 text-xs text-gray-500">Coverage.</div>
        </div>
      );`,
      // An error under a hero, not a description.
      `const A = () => (
        <div>
          <div className="flex flex-col gap-5 lg:flex-row">
            <h1>SLO</h1><Button title="Edit" />
          </div>
          <p className="mt-4 text-sm text-red-700">Could not load.</p>
        </div>
      );`,
      // A description only a screen reader reads.
      `const A = () => (
        <div>
          <div className="flex items-center"><h3>Events</h3><button>Go</button></div>
          <p className="sr-only text-xs text-gray-500">Explore.</p>
        </div>
      );`,
      // A heading with nothing to press beside it.
      `const A = () => (
        <div>
          <div className="flex items-center"><h3>Events</h3><span>3</span></div>
          <p className="text-sm text-gray-500">All of them.</p>
        </div>
      );`,
    ];

    for (const source of sources) {
      expect(scanTitleRowsWithDescriptions("Example.tsx", source)).toEqual([]);
    }
  });

  test("reads a row that only becomes a row from a screen up, and a description after a conditional", () => {
    const rows: Array<TitleRowWithDescription> = scanTitleRowsWithDescriptions(
      "Example.tsx",
      `const A = () => (
        <div>
          <div className="flex flex-col gap-1 sm:flex-row sm:justify-between">
            <h3 className="text-sm font-semibold">Levels</h3>
            <button className="self-start text-sm">How levels are chosen</button>
          </div>
          {isShown && <p className="mt-1 text-sm text-gray-500">From low to critical.</p>}
        </div>
      );`,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]!.keepsDescriptionUnderTitle).toBe(false);
  });
});
