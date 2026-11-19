// UX rule: Docs/ux/README.md#a-records-overview
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * AN ERROR RATE OPENS THE REQUESTS THAT FAILED (#9593).
 *
 * On a service's, a serverless function's, a cloud environment's and app's,
 * a RUM application's, a queue's and a database's Overview, the Error rate
 * tile was the one tile without a link: the Requests tile beside it opened
 * the traces, and nothing on the page listed what failed - an error rate
 * said something failed, never what. Each one now opens the traces
 * explorer of the same resource on exactly the spans it counted that
 * failed (FailedSpansRoute: the failed status, the kind of span the tile
 * counted, its window).
 *
 * This reads every Overview tile in the Dashboard - an object with a title
 * and an iconColor, as ResourceOverviewTile is written - and holds each
 * error tile ("Error rate", "Errors") to a link. Each tile this change
 * linked is named below, with what it opens, so a page that moves or is
 * renamed does not slip out of the guard. LLM Usage's error rate, a hint
 * under its "AI calls" count rather than a tile, is held to its link
 * below it (#9750).
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const ERROR_TILE_TITLES: ReadonlySet<string> = new Set<string>([
  "Error rate",
  "Errors",
]);

interface ErrorTile {
  file: string;
  title: string;
  // The `to` property's code, or null when the tile has none.
  to: string | null;
}

function listSourceFiles(directory: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...listSourceFiles(fullPath));
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      files.push(fullPath);
    }
  }

  return files;
}

function propertyNamed(
  node: ts.ObjectLiteralExpression,
  name: string,
): ts.PropertyAssignment | undefined {
  for (const property of node.properties) {
    if (
      ts.isPropertyAssignment(property) &&
      ts.isIdentifier(property.name) &&
      property.name.text === name
    ) {
      return property;
    }
  }

  return undefined;
}

// Every Overview tile titled as an error tile, in one source file.
function readErrorTiles(file: string): Array<ErrorTile> {
  const source: string = fs.readFileSync(file, "utf8");

  if (!source.includes("iconColor")) {
    return [];
  }

  const sourceFile: ts.SourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const tiles: Array<ErrorTile> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node)) {
      const title: ts.PropertyAssignment | undefined = propertyNamed(
        node,
        "title",
      );

      if (
        title &&
        ts.isStringLiteral(title.initializer) &&
        ERROR_TILE_TITLES.has(title.initializer.text) &&
        propertyNamed(node, "iconColor")
      ) {
        const to: ts.PropertyAssignment | undefined = propertyNamed(node, "to");

        tiles.push({
          file: path.relative(DASHBOARD_SRC, file).split(path.sep).join("/"),
          title: title.initializer.text,
          to: to ? to.initializer.getText(sourceFile) : null,
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return tiles;
}

const ERROR_TILES: Array<ErrorTile> =
  listSourceFiles(DASHBOARD_SRC).flatMap(readErrorTiles);

function tileIn(file: string): ErrorTile {
  const tile: ErrorTile | undefined = ERROR_TILES.find(
    (candidate: ErrorTile): boolean => {
      return candidate.file === file;
    },
  );

  expect(tile).toBeDefined();

  return tile as ErrorTile;
}

// The tile's link, its whitespace squashed so a reflow changes nothing.
function linkOf(file: string): string {
  return (tileIn(file).to || "").replace(/\s+/g, " ");
}

describe("every error tile on an Overview", () => {
  test("is found", () => {
    // Seven Overviews draw one; a scan that finds none would prove nothing.
    expect(ERROR_TILES.length).toBeGreaterThanOrEqual(7);
  });

  test.each(
    ERROR_TILES.map((tile: ErrorTile): [string, ErrorTile] => {
      return [`${tile.file} (${tile.title})`, tile];
    }),
  )("opens what failed: %s", (_name: string, tile: ErrorTile) => {
    expect(tile.to).not.toBeNull();
  });
});

describe("each opens exactly the spans it counted that failed", () => {
  test("a service: every span of it", () => {
    const link: string = linkOf("Pages/Service/View/Index.tsx");

    expect(link).toContain("getFailedSpansRoute(");
    expect(link).toContain("PageMap.SERVICE_VIEW_TRACES");
    expect(link).toContain("timeRange: timeRange");
    expect(link).toContain("TraceSpanType.All");
  });

  test("a serverless function: every span of it", () => {
    const link: string = linkOf("Pages/Serverless/View/Overview.tsx");

    expect(link).toContain("getFailedSpansRoute(");
    expect(link).toContain("PageMap.SERVERLESS_FUNCTION_VIEW_TRACES");
    expect(link).toContain("TraceSpanType.All");
  });

  test("a cloud environment: its entry spans, while it has a figure", () => {
    const link: string = linkOf("Pages/AppPlatforms/View/Overview.tsx");

    expect(link).toContain("m && !traceNote");
    expect(link).toContain("getFailedSpansRoute(");
    expect(link).toContain("PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_TRACES");
    expect(link).toContain("TraceSpanType.Entry");
  });

  test("a cloud app: its Traces tab, which its page builds", () => {
    expect(linkOf("Components/AppPlatforms/CloudAppOverviewTab.tsx")).toBe(
      "m && !traceNote ? props.failedRequestsRoute : undefined",
    );

    const page: string = fs
      .readFileSync(
        path.join(DASHBOARD_SRC, "Pages/AppPlatforms/View/App.tsx"),
        "utf8",
      )
      .replace(/\s+/g, " ");

    expect(page).toContain("failedRequestsRoute={");
    expect(page).toContain("params: { tab: CloudAppTabName.Traces }");
    // A step to ?tab=Traces on the page itself opens that tab.
    expect(page).toContain("routerLocation.key");
  });

  test("a RUM application: every span of it", () => {
    const link: string = linkOf("Pages/Rum/View/Overview.tsx");

    expect(link).toContain("getFailedSpansRoute(");
    expect(link).toContain("PageMap.RUM_APPLICATION_VIEW_TRACES");
    expect(link).toContain("TraceSpanType.All");
  });

  test("a RUM application's failed page loads: its documentLoad spans that failed", () => {
    const page: string = fs
      .readFileSync(
        path.join(DASHBOARD_SRC, "Pages/Rum/View/Overview.tsx"),
        "utf8",
      )
      .replace(/\s+/g, " ");

    expect(page).toContain(
      "pageLoadStats.errorCount > 0 ? getFailedSpansRoute",
    );
    expect(page).toContain("spanName: PAGE_LOAD_SPAN_NAME");
    expect(page).toContain("to: pageLoadsRoute,");
  });

  test("a queue: the broker's metrics for its own count, else every failed span", () => {
    const link: string = linkOf("Pages/MessageQueue/View/Overview.tsx");

    expect(link).toContain("figures.errorsTileBroker");
    expect(link).toContain("PageMap.MESSAGE_QUEUE_VIEW_METRICS");
    expect(link).toContain("getFailedSpansRoute(");
    expect(link).toContain("PageMap.MESSAGE_QUEUE_VIEW_TRACES");
    expect(link).toContain("TraceSpanType.All");
  });

  test("a database: the client calls to it that failed", () => {
    const link: string = linkOf("Pages/Database/View/Overview.tsx");

    expect(link).toContain("getFailedSpansRoute(");
    expect(link).toContain("PageMap.DATABASE_SERVER_VIEW_TRACES");
    expect(link).toContain("SpanKind.Client");
  });
});

/*
 * LLM Usage's "AI calls" tile says its error rate under its count, drawn by
 * LlmTile rather than as an Overview tile, so the scan above does not see
 * it (#9750). Its rate counts the AI calls of the tab's range that failed
 * (LlmUsageReader: GenAI spans, status Error), so the rate opens Calls -
 * every AI call, as the tile counts them - on exactly those: its Status
 * filter on Error and its Seen At on the range (LlmCallsRoute).
 */
describe("LLM Usage's error rate", () => {
  const read: (file: string) => string = (file: string): string => {
    return fs
      .readFileSync(path.join(DASHBOARD_SRC, file), "utf8")
      .replace(/\s+/g, " ");
  };

  test("opens the AI calls of its range that failed, while any did", () => {
    const tile: string = read("Components/AI/LlmUsageTotals.tsx");

    expect(tile).toContain('label="AI calls"');
    expect(tile).toContain('"{{rate}} error rate"');
    expect(tile).toContain(
      "hintRoute={ figures && figures.erroredCalls > 0 ? getFailedLlmCallsRoute({",
    );
    expect(tile).toContain("RouteMap[PageMap.LLM_CALLS]");
    expect(tile).toContain("range: props.range,");
  });

  test("the link sets Calls' own filters: Error, and the range", () => {
    const route: string = read("Components/AI/LlmCallsRoute.ts");

    expect(route).toContain('filter["statusCode"] = [SpanStatus.Error];');
    expect(route).toContain("startTime: new InBetween<Date>(");
    expect(route).toContain("TableFilterUrlState.getLinkQueryParams(");
  });

  test("Calls filters by status, in the namespace the link writes", () => {
    const calls: string = read("Components/AI/LlmCallsTable.tsx");

    expect(calls).toContain("userPreferencesKey={LLM_CALLS_TABLE_ID}");
    // A filter the table offers, so the link's chip shows and comes off.
    expect(calls).toContain(
      "field: { statusCode: true, }, type: FieldType.MultiSelectDropdown,",
    );
    expect(calls).toContain(
      "field: { startTime: true, }, type: FieldType.DateTime,",
    );
  });
});
