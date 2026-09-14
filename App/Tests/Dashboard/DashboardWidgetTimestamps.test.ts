/**
 * A source-level guard for the whole dashboard widget family.
 *
 * DashboardDateTime.test.ts proves the helper formats correctly; nothing there
 * stops a new widget from going back to printing a bare date. This does: it
 * reads every widget component and fails if one asks OneUptimeDate for a
 * date-only string, which is how "Jul 16, 2026" got into five widgets in the
 * first place.
 *
 * The widgets themselves are React components that need a browser to render,
 * and this suite runs under jest's node environment — so the check is static.
 */
import fs from "fs";
import path from "path";

const COMPONENTS_DIR: string = path.join(
  __dirname,
  "../../FeatureSet/Dashboard/src/Components/Dashboard/Components",
);

const UTILS_DIR: string = path.join(
  __dirname,
  "../../FeatureSet/Dashboard/src/Components/Dashboard/Utils",
);

/*
 * Every way OneUptimeDate can be asked for a date with no time of day.
 *
 * Two take `onlyShowDate` as their second positional argument...
 */
const POSITIONAL_FORMATTERS: Array<string> = [
  "getDateAsLocalFormattedString",
  "getDateAsUserFriendlyLocalFormattedString",
];

// ...two take it inside an options object...
const OPTIONS_FORMATTERS: Array<string> = [
  "getDateAsFormattedString",
  "getDateAsUserFriendlyFormattedString",
];

// ...and one is a wrapper that always passes it.
const DATE_ONLY_WRAPPERS: Array<string> = ["OneUptimeDate.getDateString"];

const DATE_ONLY_OPTION: RegExp = /onlyShowDate\s*:\s*true/;

// A rendered label paired with its full timestamp on hover.
const LABEL_WITH_HOVER_TITLE: RegExp = /title=\{[^}]*[Tt]itle\}/;

interface SourceFile {
  name: string;
  contents: string;
}

function readSourceFiles(directory: string): Array<SourceFile> {
  return fs
    .readdirSync(directory)
    .filter((name: string): boolean => {
      return name.endsWith(".ts") || name.endsWith(".tsx");
    })
    .map((name: string): SourceFile => {
      return {
        name: name,
        contents: fs.readFileSync(path.join(directory, name), "utf8"),
      };
    });
}

/**
 * Every argument list passed to `functionName` in `source`, with each list
 * split into its top-level arguments. Walks balanced parentheses so nested
 * calls and object literals in the arguments do not confuse it, and collapses
 * whitespace so prettier's line wrapping does not either.
 */
function argumentListsFor(
  source: string,
  functionName: string,
): Array<Array<string>> {
  const lists: Array<Array<string>> = [];
  const needle: string = `${functionName}(`;

  let searchFrom: number = 0;

  for (;;) {
    const callIndex: number = source.indexOf(needle, searchFrom);

    if (callIndex === -1) {
      return lists;
    }

    let depth: number = 0;
    let cursor: number = callIndex + needle.length - 1;
    let closingIndex: number = -1;

    while (cursor < source.length) {
      const character: string = source[cursor] as string;

      if (character === "(") {
        depth++;
      } else if (character === ")") {
        depth--;

        if (depth === 0) {
          closingIndex = cursor;
          break;
        }
      }

      cursor++;
    }

    if (closingIndex === -1) {
      // Unbalanced source; nothing more to read.
      return lists;
    }

    const inner: string = source.slice(callIndex + needle.length, closingIndex);
    const args: Array<string> = [];
    let current: string = "";
    let innerDepth: number = 0;

    for (const character of inner) {
      if (character === "(" || character === "[" || character === "{") {
        innerDepth++;
      } else if (character === ")" || character === "]" || character === "}") {
        innerDepth--;
      }

      if (character === "," && innerDepth === 0) {
        args.push(current.trim());
        current = "";
        continue;
      }

      current += character;
    }

    if (current.trim() !== "") {
      args.push(current.trim());
    }

    lists.push(args);
    searchFrom = closingIndex + 1;
  }
}

/**
 * The text between `opener`'s bracket and its matching close, or null when
 * `opener` is not present. Used to read one array literal out of a component
 * without pulling in whatever follows it.
 */
function bracketedBlockAfter(source: string, opener: string): string | null {
  const openerIndex: number = source.indexOf(opener);

  if (openerIndex === -1) {
    return null;
  }

  let depth: number = 0;
  let cursor: number = openerIndex + opener.length - 1;

  while (cursor < source.length) {
    const character: string = source[cursor] as string;

    if (character === "[") {
      depth++;
    } else if (character === "]") {
      depth--;

      if (depth === 0) {
        return source.slice(openerIndex + opener.length, cursor);
      }
    }

    cursor++;
  }

  return null;
}

// Strip comments so a code sample inside a comment cannot fail the suite.
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

describe("dashboard widget timestamps", () => {
  const widgetFiles: Array<SourceFile> = readSourceFiles(COMPONENTS_DIR);

  it("finds the widget components to check", () => {
    // A wrong path would otherwise make every check below vacuously pass.
    expect(widgetFiles.length).toBeGreaterThan(20);
    expect(
      widgetFiles.some((file: SourceFile): boolean => {
        return file.name === "DashboardIncidentListComponent.tsx";
      }),
    ).toBe(true);
  });

  it("no widget renders a date without a time", () => {
    const offenders: Array<string> = [];

    for (const file of widgetFiles) {
      const source: string = withoutComments(file.contents);

      for (const formatter of POSITIONAL_FORMATTERS) {
        for (const args of argumentListsFor(source, formatter)) {
          // args[1] is `onlyShowDate`.
          if (args[1] === "true") {
            offenders.push(`${file.name}: ${formatter}(…, true)`);
          }
        }
      }

      for (const formatter of OPTIONS_FORMATTERS) {
        for (const args of argumentListsFor(source, formatter)) {
          // args[1] is an options object carrying `onlyShowDate`.
          if (DATE_ONLY_OPTION.test(args[1] || "")) {
            offenders.push(
              `${file.name}: ${formatter}(…, { onlyShowDate: true })`,
            );
          }
        }
      }

      for (const wrapper of DATE_ONLY_WRAPPERS) {
        if (source.includes(`${wrapper}(`)) {
          offenders.push(`${file.name}: ${wrapper}()`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("routes the widgets that show a timestamp through the shared helper", () => {
    /*
     * Every widget that puts a timestamp on screen. If one of them stops
     * importing the helper it has gone back to formatting its own.
     */
    const timestampWidgets: Array<string> = [
      "DashboardIncidentListComponent.tsx",
      "DashboardAlertListComponent.tsx",
      "DashboardTraceListComponent.tsx",
      "DashboardLogStreamComponent.tsx",
      "DashboardTableComponent.tsx",
      "DashboardHostListComponent.tsx",
    ];

    for (const name of timestampWidgets) {
      const file: SourceFile | undefined = widgetFiles.find(
        (candidate: SourceFile): boolean => {
          return candidate.name === name;
        },
      );

      expect(file).toBeDefined();
      expect(`${name}: ${(file as SourceFile).contents}`).toContain(
        "../Utils/DashboardDateTime",
      );
    }
  });

  it("hangs the full, zone-qualified timestamp on a hover title", () => {
    /*
     * The visible label drops the timezone abbreviation to fit a narrow
     * column. That is only acceptable because the exact, zone-qualified
     * instant is one hover away — a widget that renders the label without
     * wiring the title has thrown the timezone away.
     */
    const widgetsWithHoverTitle: Array<string> = [
      "DashboardIncidentListComponent.tsx",
      "DashboardAlertListComponent.tsx",
      "DashboardTraceListComponent.tsx",
      "DashboardLogStreamComponent.tsx",
      "DashboardTableComponent.tsx",
      "DashboardHostListComponent.tsx",
    ];

    const offenders: Array<string> = [];

    for (const name of widgetsWithHoverTitle) {
      const file: SourceFile = widgetFiles.find(
        (candidate: SourceFile): boolean => {
          return candidate.name === name;
        },
      ) as SourceFile;

      expect(file).toBeDefined();

      const source: string = withoutComments(file.contents);

      if (!LABEL_WITH_HOVER_TITLE.test(source)) {
        offenders.push(`${name}: renders a label with no title={...title}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("shows a timestamp in honeycomb view too, not just in the table", () => {
    /*
     * These widgets render either a table or a grid of tiles. The tile view
     * has no columns, so its hover tooltip is the only place a timestamp can
     * appear — and switching view mode must not silently drop it.
     */
    const honeycombWidgets: Array<[string, string]> = [
      ["DashboardIncidentListComponent.tsx", "Declared"],
      ["DashboardAlertListComponent.tsx", "Created"],
      ["DashboardTraceListComponent.tsx", "Time"],
      ["DashboardHostListComponent.tsx", "At"],
    ];

    for (const [name, timestampLabel] of honeycombWidgets) {
      const file: SourceFile = widgetFiles.find(
        (candidate: SourceFile): boolean => {
          return candidate.name === name;
        },
      ) as SourceFile;

      expect(file).toBeDefined();

      const source: string = withoutComments(file.contents);

      /*
       * Narrow to the tooltip's detail rows when they are written inline, but
       * fall back to the whole file rather than failing an innocent refactor
       * that hoists them into a local or a helper.
       */
      const details: string =
        bracketedBlockAfter(source, "details: [") ?? source;

      // The row a user actually reads on hover.
      expect(`${name} tooltip details: ${details}`).toContain(
        `label: "${timestampLabel}"`,
      );
    }
  });

  it("keeps the formatting in the helper rather than in the widgets", () => {
    const helperNames: Array<string> = fs.readdirSync(UTILS_DIR);

    expect(helperNames).toContain("DashboardDateTime.ts");

    /*
     * Widgets should never reach for the raw time helpers themselves — that is
     * how the date half and the time half end up resolved in different zones.
     */
    const rawTimeHelpers: Array<string> = [
      "OneUptimeDate.getLocalTimeString",
      "OneUptimeDate.getLocalHours",
      "OneUptimeDate.getLocalMinutes",
    ];

    /*
     * Chart x-axis ticks are the one exception, and only for the whole-string
     * helper. A tick is a bare clock reading by design - the axis as a whole
     * says which day is on screen, so there is no date half for a time half to
     * disagree with - and asking OneUptimeDate for it is precisely what puts
     * the reading in the configured timezone and on the reader's 12/24-hour
     * clock. Hand-assembly from getLocalHours/getLocalMinutes stays banned
     * here too, and anything rendering a date *and* a time still has to go
     * through DashboardDateTime.
     */
    const AXIS_TICK_FORMATTERS: Array<string> = [
      "LogChartData.ts",
      "TraceChartData.ts",
    ];

    const offenders: Array<string> = [];

    for (const file of widgetFiles) {
      const source: string = withoutComments(file.contents);

      for (const helper of rawTimeHelpers) {
        if (
          helper === "OneUptimeDate.getLocalTimeString" &&
          AXIS_TICK_FORMATTERS.includes(file.name)
        ) {
          continue;
        }

        if (source.includes(`${helper}(`)) {
          offenders.push(`${file.name}: ${helper}()`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
