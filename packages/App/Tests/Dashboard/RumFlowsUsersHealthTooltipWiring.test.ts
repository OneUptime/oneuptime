import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import nodePath from "path";
import {
  RUM_RECORDING_HEALTH_METRIC_DESCRIPTIONS,
  RUM_REPLAY_USERS_METRIC_DESCRIPTIONS,
  RUM_USER_FLOW_METRIC_DESCRIPTIONS,
} from "../../FeatureSet/Dashboard/src/Components/MetricDescriptions/RumMetricDescriptions";
import {
  USER_FLOW_DEFAULT_MAX_SESSIONS,
  USER_FLOW_MAX_PAGES_PER_JOURNEY,
} from "Common/Types/Rum/UserFlow";
import {
  USER_FLOW_MAX_LOOPS,
  USER_FLOW_MAX_NEIGHBOURS,
  USER_FLOW_MAX_OTHER_PAGES,
  USER_FLOW_MAX_PATH_LENGTH,
  USER_FLOW_MAX_PATHS,
} from "Common/Utils/Rum/UserFlow";
import { SESSION_REPLAY_FLUSH_INTERVAL_MS } from "Common/Types/Rum/SessionReplay";
import {
  SESSION_REPLAY_RECORDER_ACTIVE_WINDOW_MS,
  SESSION_REPLAY_REFUSAL_ALERT_THRESHOLD,
  SESSION_REPLAY_STALE_CHUNK_MS,
} from "Common/Utils/Rum/SessionReplayHealth";
import SessionSampling from "Common/Utils/Rum/SessionSampling";
import { USAGE_WARNING_PERCENT } from "../../FeatureSet/Dashboard/src/Components/SessionReplay/RecordingHealthModel";

/*
 * Source-level pins for the (i) tooltips on three Session Replay surfaces:
 *
 *  - User Flows: the five overview tiles (UserFlowOverview.tsx), every
 *    metric column of Top paths, Pages and Back and forth
 *    (UserFlowTables.tsx), and every figure and list in the panel a click
 *    on the map opens (UserFlowDetailPanel.tsx);
 *  - the Users table (SessionReplayUsersTable.tsx): Sessions, Last seen,
 *    Time and Signals;
 *  - Replay Health (RecordingHealthDashboard.tsx): the four pipeline
 *    stages, the refusal and drop lists and the two byte meters.
 *
 * Two halves. The WIRING half reads the .tsx sources as text (react is a
 * Dashboard dependency App's own install does not provide) and pins which
 * text sits on which title. The ACCURACY half reads the code that computes
 * each number - the ClickHouse reads, the Redis counters, the recorder, the
 * User Flows engine - and pins every claim a text makes to the line that
 * makes it true, so a change to the computation fails here until the words
 * are changed with it. The jsdom half (hovering each (i)) lives in
 * Common/Tests/UI/Rum/{UserFlowTooltips,SessionReplayUsersTableTooltips,
 * RecordingHealthTooltips}.test.tsx.
 */

const PACKAGES: string = nodePath.join(__dirname, "../../..");

const BLOCK_COMMENT_PATTERN: RegExp = /\/\*[\s\S]*?\*\//g;
// A `//` comment, but not the `//` of a URL scheme.
const LINE_COMMENT_PATTERN: RegExp = /(^|[^:])\/\/[^\n]*/g;
const WHITESPACE_RUN_PATTERN: RegExp = /\s+/g;

function stripComments(source: string): string {
  return source
    .replace(BLOCK_COMMENT_PATTERN, "")
    .replace(LINE_COMMENT_PATTERN, "$1");
}

function read(relativeToPackages: string): string {
  return stripComments(
    fs.readFileSync(nodePath.join(PACKAGES, relativeToPackages), "utf8"),
  );
}

// Whitespace-insensitive, so a prettier reflow does not break a pin.
function squash(source: string): string {
  return source.replace(WHITESPACE_RUN_PATTERN, " ");
}

function indexOfOrFail(source: string, needle: string, from?: number): number {
  const index: number = source.indexOf(needle, from);

  expect({ needle, found: index >= 0 }).toEqual({ needle, found: true });

  return index;
}

function countOf(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

const DASHBOARD: string = "App/FeatureSet/Dashboard/src";

const OVERVIEW: string = read(
  `${DASHBOARD}/Components/UserFlow/UserFlowOverview.tsx`,
);
const TABLES: string = read(
  `${DASHBOARD}/Components/UserFlow/UserFlowTables.tsx`,
);
const DETAIL_PANEL: string = read(
  `${DASHBOARD}/Components/UserFlow/UserFlowDetailPanel.tsx`,
);
const USER_FLOW_MAP: string = read(
  `${DASHBOARD}/Components/UserFlow/UserFlowMap.tsx`,
);
const USER_FLOW_API: string = read(
  `${DASHBOARD}/Components/UserFlow/UserFlowApi.ts`,
);
const USERS_TABLE: string = read(
  `${DASHBOARD}/Components/SessionReplay/SessionReplayUsersTable.tsx`,
);
const HEALTH_DASHBOARD: string = read(
  `${DASHBOARD}/Components/SessionReplay/RecordingHealthDashboard.tsx`,
);
const HEALTH_CARD: string = read(
  `${DASHBOARD}/Components/SessionReplay/RecordingHealthCard.tsx`,
);
const HEALTH_MODEL: string = read(
  `${DASHBOARD}/Components/SessionReplay/RecordingHealthModel.ts`,
);

const USER_FLOW_READ: string = read(
  "Common/Server/Utils/SessionReplay/SessionReplayUserFlowReadService.ts",
);
const USER_FLOW_ENGINE: string = read("Common/Utils/Rum/UserFlow.ts");
const REPLAY_READ: string = read(
  "Common/Server/Utils/SessionReplay/SessionReplayReadService.ts",
);
const HEALTH_COUNTERS: string = read(
  "Common/Server/Utils/SessionReplay/SessionReplayHealthCounters.ts",
);
const USAGE: string = read(
  "Common/Server/Utils/SessionReplay/SessionReplayUsage.ts",
);
const TELEMETRY_API: string = read("Common/Server/API/TelemetryAPI.ts");
const RUM_APPLICATION_SERVICE: string = read(
  "Common/Server/Services/RumApplicationService.ts",
);
const RUM_SESSION_MODEL: string = fs.readFileSync(
  nodePath.join(PACKAGES, "Common/Models/AnalyticsModels/RumSession.ts"),
  "utf8",
);
const INGEST_SERVICE: string = read(
  "App/FeatureSet/Telemetry/Services/SessionReplayIngestService.ts",
);
const INGEST_ROUTE: string = read(
  "App/FeatureSet/Telemetry/API/SessionReplayIngest.ts",
);
const OTEL_INGEST: string = read(
  "App/FeatureSet/Telemetry/Services/OtelIngestBaseService.ts",
);
const RECORDER: string = read("App/FeatureSet/BrowserRecorder/src/Recorder.ts");
const CHUNKER: string = read("App/FeatureSet/BrowserRecorder/src/Chunker.ts");
const ERROR_RECORDER: string = read(
  "App/FeatureSet/BrowserRecorder/src/ErrorRecorder.ts",
);
const FRUSTRATION: string = read(
  "App/FeatureSet/BrowserRecorder/src/FrustrationDetector.ts",
);
const SESSION_ID: string = read(
  "App/FeatureSet/BrowserRecorder/src/SessionId.ts",
);
const FINALIZER: string = read(
  "App/FeatureSet/Workers/Jobs/Rum/FinalizeSessions.ts",
);
const SESSION_REPLAY_TYPES: string = read("Common/Types/Rum/SessionReplay.ts");
const TRANSPORT: string = read(
  "App/FeatureSet/BrowserRecorder/src/Transport.ts",
);

const TILE_PATTERN: RegExp =
  /<Tile\s+label="([^"]+)"[\s\S]*?tooltip=\{RUM_USER_FLOW_METRIC_DESCRIPTIONS\.(\w+)\}/g;
const PAGE_COLUMN_PATTERN: RegExp =
  /key: "(\w+)",\s*label: "([^"]+)",\s*tooltip: RUM_USER_FLOW_METRIC_DESCRIPTIONS\.(\w+),/g;
const HEADER_WITH_INFO_PATTERN: RegExp =
  /<HeaderWithInfo\s+label="([^"]+)"\s+tooltip=\{RUM_USER_FLOW_METRIC_DESCRIPTIONS\.(\w+)\}/g;
const USERS_COLUMN_PATTERN: RegExp = /\{\s*title: "([^"]+)",([^{}]*)\}/g;
const USERS_TOOLTIP_PATTERN: RegExp =
  /headerTooltip: RUM_REPLAY_USERS_METRIC_DESCRIPTIONS\.(\w+)/;
const STAGE_TOOLTIP_PATTERN: RegExp =
  /(recorder|policy|uploads|sessions): RUM_RECORDING_HEALTH_METRIC_DESCRIPTIONS\.(\w+),/g;
const STAGE_KEY_PATTERN: RegExp = /key: "(\w+)",/g;
const COUNTER_LIST_PATTERN: RegExp =
  /<CounterList\s+title="([^"]+)"[\s\S]*?tooltip=\{\s*RUM_RECORDING_HEALTH_METRIC_DESCRIPTIONS\.(\w+)\s*\}/g;
const USAGE_METER_PATTERN: RegExp =
  /<UsageMeterRow\s+label="([^"]+)"\s+tooltip=\{\s*RUM_RECORDING_HEALTH_METRIC_DESCRIPTIONS\.(\w+)\s*\}/g;
const FRUSTRATION_CONSTANT_PATTERN: (name: string) => RegExp = (
  name: string,
): RegExp => {
  return new RegExp(`const ${name}: number = (\\d+);`);
};
/*
 * A detail-panel figure: <Stat label="..." or label={...}, then its tooltip.
 * The label is captured raw, so a template label reads as its source.
 */
const DETAIL_STAT_PATTERN: RegExp =
  /<Stat\s+label=(\{[^\n]+\}|"[^"]+")\s+tooltip=\{RUM_USER_FLOW_METRIC_DESCRIPTIONS\.(\w+)\}/g;
const DETAIL_LIST_PATTERN: RegExp =
  /<NeighbourList\s+title="([^"]+)"\s+tooltip=\{RUM_USER_FLOW_METRIC_DESCRIPTIONS\.(\w+)\}/g;

function pairs(source: string, pattern: RegExp): Array<[string, string]> {
  return Array.from(source.matchAll(pattern)).map(
    (match: RegExpMatchArray): [string, string] => {
      return [match[1]!, match[2]!];
    },
  );
}

function frustrationConstant(name: string): number {
  const match: RegExpMatchArray | null = FRUSTRATION.match(
    FRUSTRATION_CONSTANT_PATTERN(name),
  );

  expect({ name, found: Boolean(match) }).toEqual({ name, found: true });

  return Number(match![1]);
}

/* ------------------------------------------------------------------ */
/* Wiring                                                              */
/* ------------------------------------------------------------------ */

describe("User Flows overview tiles carry their own text", () => {
  test("each tile label is paired with its description", () => {
    expect(OVERVIEW).toContain(
      'import InfoTooltip from "Common/UI/Components/Tooltip/InfoTooltip";',
    );
    expect(OVERVIEW).toContain(
      'import { RUM_USER_FLOW_METRIC_DESCRIPTIONS } from "../MetricDescriptions/RumMetricDescriptions";',
    );
    expect(pairs(OVERVIEW, TILE_PATTERN)).toEqual([
      ["Sessions analysed", "sessionsAnalysed"],
      ["Pages per session", "pagesPerSession"],
      ["Single-page sessions", "singlePageSessions"],
      ["Top landing page", "topLandingPage"],
      ["Top exit page", "topExitPage"],
    ]);
    expect(countOf(OVERVIEW, "RUM_USER_FLOW_METRIC_DESCRIPTIONS.")).toBe(5);
  });

  test("the tile draws the (i) from its own label and tooltip, and the tooltip is required", () => {
    const tile: string = squash(
      OVERVIEW.slice(
        indexOfOrFail(OVERVIEW, "function Tile("),
        indexOfOrFail(OVERVIEW, "const TONE_CLASSES"),
      ),
    );

    expect(tile).toContain("tooltip: string;");
    expect(tile).not.toContain("tooltip?:");
    expect(tile).toContain(
      "<InfoTooltip label={props.label} text={props.tooltip} dataTestId={`${props.testId}-info`} />",
    );
  });

  test("the findings cards are buttons, so they carry no (i)", () => {
    const findings: string = OVERVIEW.slice(
      indexOfOrFail(OVERVIEW, 'data-testid="user-flow-insights"'),
    );

    expect(findings).not.toContain("InfoTooltip");
  });
});

describe("User Flows tables carry their own text", () => {
  test("every sortable Pages column has its description", () => {
    expect(
      Array.from(TABLES.matchAll(PAGE_COLUMN_PATTERN)).map(
        (match: RegExpMatchArray): Array<string> => {
          return [match[1]!, match[2]!, match[3]!];
        },
      ),
    ).toEqual([
      ["sessions", "Sessions", "pageSessions"],
      ["views", "Visits", "pageVisits"],
      ["entries", "Landed", "pageLanded"],
      ["exits", "Left", "pageLeft"],
      ["exitRate", "Exit rate", "pageExitRate"],
      ["errorSessions", "Errors", "pageErrors"],
      ["frustrationSessions", "Frustrated", "pageFrustrated"],
    ]);
  });

  test("the Top paths headers and the Back and forth header have theirs", () => {
    expect(pairs(TABLES, HEADER_WITH_INFO_PATTERN)).toEqual([
      ["Sessions", "pathSessions"],
      ["Avg. duration", "pathAvgDuration"],
      ["With errors", "pathWithErrors"],
      ["Sessions", "loopSessions"],
    ]);

    const loops: string = TABLES.slice(
      indexOfOrFail(TABLES, 'data-testid="user-flow-loops"'),
    );

    expect(loops).toContain('data-testid="user-flow-loops-header"');
    expect(loops).toContain("RUM_USER_FLOW_METRIC_DESCRIPTIONS.loopSessions");
  });

  test("the (i) is a sibling of the sort button, never inside it", () => {
    const helper: string = squash(
      TABLES.slice(
        indexOfOrFail(TABLES, "function HeaderWithInfo("),
        indexOfOrFail(TABLES, "type PageSortKey"),
      ),
    );

    expect(helper).toContain(
      "{props.children ?? props.label} <InfoTooltip label={props.label} text={props.tooltip}",
    );

    const pagesHeader: string = squash(
      TABLES.slice(
        indexOfOrFail(TABLES, "PAGE_COLUMNS.map("),
        indexOfOrFail(TABLES, "sortedPages.map("),
      ),
    );
    const open: number = indexOfOrFail(
      pagesHeader,
      "<HeaderWithInfo label={column.label} tooltip={column.tooltip} >",
    );
    const buttonOpen: number = indexOfOrFail(pagesHeader, "<button", open);
    const buttonClose: number = indexOfOrFail(
      pagesHeader,
      "</button>",
      buttonOpen,
    );
    const close: number = indexOfOrFail(
      pagesHeader,
      "</HeaderWithInfo>",
      buttonClose,
    );

    expect(close).toBeGreaterThan(buttonClose);
    // Nothing but the button is passed in: no (i) inside it.
    expect(pagesHeader.slice(buttonOpen, buttonClose)).not.toContain(
      "InfoTooltip",
    );
    expect(pagesHeader.slice(buttonOpen, buttonClose)).not.toContain(
      "HeaderWithInfo",
    );
  });

  test("the text keys are split between the three files with nothing left over", () => {
    const keys: Array<string> = Object.keys(RUM_USER_FLOW_METRIC_DESCRIPTIONS);
    const usedIn: (source: string) => Array<string> = (
      source: string,
    ): Array<string> => {
      return keys.filter((key: string): boolean => {
        return new RegExp(`RUM_USER_FLOW_METRIC_DESCRIPTIONS\\.${key}\\b`).test(
          source,
        );
      });
    };
    const inOverview: Array<string> = usedIn(OVERVIEW);
    const inTables: Array<string> = usedIn(TABLES);
    const inDetail: Array<string> = usedIn(DETAIL_PANEL);

    // Every key in exactly one file.
    expect([...inOverview, ...inTables, ...inDetail].sort()).toEqual(
      [...keys].sort(),
    );
    // The detail panel's texts, and only those, say so in their key.
    expect(
      inDetail.every((key: string): boolean => {
        return key.startsWith("detail");
      }),
    ).toBe(true);
    expect(
      [...inOverview, ...inTables].some((key: string): boolean => {
        return key.startsWith("detail");
      }),
    ).toBe(false);
  });
});

describe("the User Flows detail panel carries its own text", () => {
  test("every figure in the node and transition panels is paired with its description", () => {
    expect(DETAIL_PANEL).toContain(
      'import InfoTooltip from "Common/UI/Components/Tooltip/InfoTooltip";',
    );
    expect(pairs(DETAIL_PANEL, DETAIL_STAT_PATTERN)).toEqual([
      ['"Sessions"', "detailTransitionSessions"],
      ["{`Share of ${sourceLabel}`}", "detailShareOfSource"],
      ["{`Share of ${targetLabel}`}", "detailShareOfTarget"],
      ['"Returning to a seen page"', "detailReturning"],
      ['"Sessions at this step"', "detailStepSessions"],
      [
        '{graph.anchorPage ? "Of anchored sessions" : "Of all sessions"}',
        "detailOfAllSessions",
      ],
      ['"Started their session here"', "detailStartedHere"],
      ['"Left the application here"', "detailLeftHere"],
      ['"Hit an error here"', "detailErrorsHere"],
    ]);
    // Every <Stat is one of those nine: none was left without a text.
    expect(countOf(DETAIL_PANEL, "<Stat")).toBe(9);
  });

  test("the three page lists explain their counts in the title row", () => {
    expect(pairs(DETAIL_PANEL, DETAIL_LIST_PATTERN)).toEqual([
      ["Pages folded together (click to follow one)", "detailFoldedPages"],
      ["Where they came from (whole range)", "detailCameFrom"],
      ["Where they went next (whole range)", "detailWentNext"],
    ]);
    expect(countOf(DETAIL_PANEL, "<NeighbourList")).toBe(3);
  });

  test("the tooltip is required, and the (i) sits in the title row, not in a row button", () => {
    const stat: string = squash(
      DETAIL_PANEL.slice(
        indexOfOrFail(DETAIL_PANEL, "function Stat("),
        indexOfOrFail(DETAIL_PANEL, "function SampleSessions("),
      ),
    );
    const list: string = squash(
      DETAIL_PANEL.slice(
        indexOfOrFail(DETAIL_PANEL, "function NeighbourList("),
        indexOfOrFail(DETAIL_PANEL, "function findNode("),
      ),
    );

    expect(stat).toContain("tooltip: string;");
    expect(stat).not.toContain("tooltip?:");
    expect(stat).toContain(
      "<InfoTooltip label={props.label} text={props.tooltip} />",
    );
    expect(stat).not.toContain("<button");
    expect(list).toContain("tooltip: string;");
    expect(list).not.toContain("tooltip?:");

    const info: number = indexOfOrFail(
      list,
      "<InfoTooltip label={props.title} text={props.tooltip}",
    );
    const rows: number = indexOfOrFail(list, "props.items.map(");

    // The (i) is drawn before, and outside, the list of row buttons.
    expect(info).toBeLessThan(rows);
    expect(list.slice(0, info)).not.toContain("<button");
  });

  test("the map itself is left alone: SVG nodes and bands with their own hover text and legend", () => {
    expect(USER_FLOW_MAP).not.toContain("InfoTooltip");
    expect(USER_FLOW_MAP).toContain('data-testid="user-flow-legend"');
    expect(USER_FLOW_MAP).toContain('role="button"');
  });
});

describe("Session Replay Users columns carry their own text", () => {
  test("Sessions, Last seen, Time and Signals have a header tooltip; User and Actions do not", () => {
    const columns: string = USERS_TABLE.slice(
      indexOfOrFail(USERS_TABLE, "const SESSION_REPLAY_USER_COLUMNS"),
      indexOfOrFail(USERS_TABLE, "].map("),
    );
    const tooltips: Record<string, string | null> = {};

    for (const match of columns.matchAll(USERS_COLUMN_PATTERN)) {
      const tooltip: RegExpMatchArray | null = match[2]!.match(
        USERS_TOOLTIP_PATTERN,
      );

      tooltips[match[1]!] = tooltip ? tooltip[1]! : null;
    }

    expect(tooltips).toEqual({
      User: null,
      Sessions: "sessions",
      "Last seen": "lastSeen",
      Time: "time",
      Signals: "signals",
      Actions: null,
    });
    expect(countOf(USERS_TABLE, "RUM_REPLAY_USERS_METRIC_DESCRIPTIONS.")).toBe(
      Object.keys(RUM_REPLAY_USERS_METRIC_DESCRIPTIONS).length,
    );
  });

  test("the column map carries headerTooltip through to the shared Table", () => {
    const mapper: string = squash(
      USERS_TABLE.slice(
        indexOfOrFail(USERS_TABLE, "].map("),
        indexOfOrFail(USERS_TABLE, "const SessionReplayUsersTable:"),
      ),
    );

    expect(mapper).toContain("headerTooltip?: string;");
    expect(mapper).toContain("...column,");
  });
});

describe("Replay Health figures carry their own text", () => {
  test("every pipeline stage the model builds has a tooltip, drawn beside its label", () => {
    const stageKeys: Set<string> = new Set(
      Array.from(HEALTH_MODEL.matchAll(STAGE_KEY_PATTERN)).map(
        (match: RegExpMatchArray): string => {
          return match[1]!;
        },
      ),
    );

    expect(Array.from(stageKeys).sort()).toEqual(
      ["policy", "recorder", "sessions", "uploads"].sort(),
    );
    expect(pairs(HEALTH_DASHBOARD, STAGE_TOOLTIP_PATTERN)).toEqual([
      ["recorder", "recorderLoaded"],
      ["policy", "recordingAllowed"],
      ["uploads", "chunksReceived"],
      ["sessions", "sessionsLast24h"],
    ]);
    expect(squash(HEALTH_DASHBOARD)).toContain(
      "<InfoTooltip label={stage.label} text={PIPELINE_STAGE_TOOLTIPS[stage.key]}",
    );
  });

  test("the two counters and the two meters are paired with their descriptions", () => {
    expect(pairs(HEALTH_DASHBOARD, COUNTER_LIST_PATTERN)).toEqual([
      ["Refused at the gate", "refusedAtGate"],
      ["Dropped after acceptance", "droppedAfterAcceptance"],
    ]);
    expect(pairs(HEALTH_DASHBOARD, USAGE_METER_PATTERN)).toEqual([
      ["Project bytes today", "projectBytesToday"],
      ["This application this month", "applicationBytesThisMonth"],
    ]);

    const counterList: string = squash(
      HEALTH_DASHBOARD.slice(
        indexOfOrFail(HEALTH_DASHBOARD, "function CounterList("),
        indexOfOrFail(HEALTH_DASHBOARD, "function UsageMeterRow("),
      ),
    );
    const meter: string = squash(
      HEALTH_DASHBOARD.slice(
        indexOfOrFail(HEALTH_DASHBOARD, "function UsageMeterRow("),
        indexOfOrFail(HEALTH_DASHBOARD, "function DefinitionRow("),
      ),
    );

    expect(counterList).toContain(
      "<InfoTooltip label={props.title} text={props.tooltip}",
    );
    expect(meter).toContain(
      "<InfoTooltip label={props.label} text={props.tooltip}",
    );
  });

  test("the policy and recorder panels and the summary card carry no (i)", () => {
    const policyAndRecorder: string = HEALTH_DASHBOARD.slice(
      indexOfOrFail(HEALTH_DASHBOARD, "function DefinitionRow("),
      indexOfOrFail(HEALTH_DASHBOARD, "function LoadingSkeleton("),
    );

    expect(policyAndRecorder).not.toContain("InfoTooltip");
    expect(HEALTH_CARD).not.toContain("InfoTooltip");
    expect(HEALTH_CARD).not.toContain(
      "RUM_RECORDING_HEALTH_METRIC_DESCRIPTIONS",
    );
    expect(
      countOf(HEALTH_DASHBOARD, "RUM_RECORDING_HEALTH_METRIC_DESCRIPTIONS."),
    ).toBe(Object.keys(RUM_RECORDING_HEALTH_METRIC_DESCRIPTIONS).length);
  });
});

/* ------------------------------------------------------------------ */
/* Accuracy: User Flows                                                */
/* ------------------------------------------------------------------ */

describe("User Flows texts match what the page computes", () => {
  test("sessions that STARTED in the range, newest 5,000 at most", () => {
    expect(USER_FLOW_DEFAULT_MAX_SESSIONS).toBe(5000);
    // The page never asks for another cap, so the default applies.
    expect(USER_FLOW_API).not.toContain("limit");
    expect(squash(TELEMETRY_API)).toContain(
      "readLimitFromBody( body, USER_FLOW_DEFAULT_MAX_SESSIONS, USER_FLOW_MAX_SESSIONS, )",
    );
    // The window is on the session's start, and the newest come first.
    expect(USER_FLOW_READ).toContain("AND startTime >= ");
    expect(USER_FLOW_READ).toContain("AND startTime <= ");
    expect(USER_FLOW_READ).toContain(
      "ORDER BY flowStartUnixMs DESC, flowSessionId DESC",
    );
    expect(RUM_USER_FLOW_METRIC_DESCRIPTIONS.sessionsAnalysed).toContain(
      "recordings that started in the selected range",
    );
    expect(RUM_USER_FLOW_METRIC_DESCRIPTIONS.sessionsAnalysed).toContain(
      "At most the newest 5,000 recordings are read",
    );
  });

  test("a page is listed once per recording chunk, and repeats back to back are collapsed", () => {
    expect(SESSION_REPLAY_FLUSH_INTERVAL_MS).toBe(15 * 1000);
    // The chunk's route list is a set: a return inside one chunk is lost.
    expect(squash(CHUNKER)).toContain("if (this.routes.has(url)) { return; }");
    // Back-to-back repeats: on the server and again in the engine.
    expect(USER_FLOW_READ).toContain(
      "flowAt = 1 OR flowRoute != flowRawRoutes[flowAt - 1]",
    );
    expect(squash(USER_FLOW_ENGINE)).toContain(
      "if (collapsed[collapsed.length - 1] !== page) { collapsed.push(page); }",
    );
    // A journey this long is far beyond anything the texts talk about.
    expect(USER_FLOW_MAX_PAGES_PER_JOURNEY).toBeGreaterThanOrEqual(100);

    for (const text of [
      RUM_USER_FLOW_METRIC_DESCRIPTIONS.pagesPerSession,
      RUM_USER_FLOW_METRIC_DESCRIPTIONS.pageVisits,
    ]) {
      expect(text).toContain("recording chunk (about 15 seconds)");
      expect(text).toContain("is missed");
    }

    // Only BACK-TO-BACK repeats go, so A -> B -> A stays three pages long.
    expect(squash(USER_FLOW_ENGINE)).toContain(
      "const lengths: Array<number> = journeys.map( (journey: UserFlowJourney): number => { return journey.pages.length; }, );",
    );
    expect(RUM_USER_FLOW_METRIC_DESCRIPTIONS.pagesPerSession).toContain(
      "Going back to an earlier page counts again",
    );
  });

  test("Back and forth lists the 10 most common pairs, each session once", () => {
    expect(USER_FLOW_MAX_LOOPS).toBe(10);
    expect(USER_FLOW_ENGINE).toContain(".slice(0, USER_FLOW_MAX_LOOPS)");
    expect(USER_FLOW_ENGINE).toContain(
      "share: ratio(loop.sessions, journeys.length),",
    );
    expect(RUM_USER_FLOW_METRIC_DESCRIPTIONS.loopSessions).toContain(
      "The 10 most common pairs are listed",
    );
    expect(RUM_USER_FLOW_METRIC_DESCRIPTIONS.loopSessions).toContain(
      "counted once per session",
    );
  });

  test("Top paths lists 25 journeys, compared on their first 8 pages", () => {
    expect(USER_FLOW_MAX_PATHS).toBe(25);
    expect(USER_FLOW_MAX_PATH_LENGTH).toBe(8);
    expect(USER_FLOW_ENGINE).toContain(".slice(0, USER_FLOW_MAX_PATHS)");
    expect(USER_FLOW_ENGINE).toContain(
      "share: ratio(accumulator.sessions, journeys.length),",
    );
    expect(RUM_USER_FLOW_METRIC_DESCRIPTIONS.pathSessions).toContain(
      "The 25 most common journeys are listed",
    );
    expect(RUM_USER_FLOW_METRIC_DESCRIPTIONS.pathSessions).toContain(
      "longer than 8 pages are compared on their first 8",
    );
    expect(RUM_USER_FLOW_METRIC_DESCRIPTIONS.pathAvgDuration).toContain(
      "past the 8 shown",
    );
  });

  test("Avg. duration is the recorded span, first chunk start to last chunk end", () => {
    expect(USER_FLOW_READ).toContain(
      "toFloat64(toUnixTimestamp64Milli(max(chunkEndTime)) - toUnixTimestamp64Milli(min(chunkStartTime))) AS flowSpanMs",
    );
    expect(USER_FLOW_READ).toContain(
      "durationMs: Math.max(0, rollup?.spanMs || 0),",
    );
    expect(USER_FLOW_ENGINE).toContain(
      "avgDurationMs: ratio(accumulator.totalDurationMs, accumulator.sessions),",
    );
    expect(RUM_USER_FLOW_METRIC_DESCRIPTIONS.pathAvgDuration).toContain(
      "from the start of their first recording chunk to the end of their last, idle time included",
    );
  });

  test("With errors counts an error anywhere in the session; the Pages column only those placed on the page", () => {
    expect(USER_FLOW_ENGINE).toContain(
      "hadErrors: session.errorCount > 0 || errorPages.size > 0,",
    );
    expect(squash(USER_FLOW_ENGINE)).toContain(
      "if (journey.errorPages.has(page)) { accumulator.errorSessions += 1; }",
    );
    expect(RUM_USER_FLOW_METRIC_DESCRIPTIONS.pathWithErrors).toContain(
      "anywhere in the session",
    );
    expect(RUM_USER_FLOW_METRIC_DESCRIPTIONS.pageErrors).toContain(
      "while on this page",
    );
  });

  test("a signal is placed on the page its chunk was sent from", () => {
    // The envelope's url is where the recorder is when it builds the chunk.
    expect(RECORDER).toContain("url: this.routeRecorder.getCurrentUrl(),");
    // The read keeps each signal-bearing chunk with that url.
    expect(USER_FLOW_READ).toContain(
      "(url, toFloat64(errorCount), toFloat64(rageClickCount + deadClickCount + errorClickCount + refreshRageCount)),",
    );
    expect(RUM_USER_FLOW_METRIC_DESCRIPTIONS.pageErrors).toContain(
      "placed on the page the visitor was on when its recording chunk was sent",
    );
    expect(RUM_USER_FLOW_METRIC_DESCRIPTIONS.pageFrustrated).toContain(
      "Placed on pages the same way as Errors",
    );
  });

  test("an error is what the recorder counts, failed file loads included", () => {
    expect(ERROR_RECORDER).toContain(
      'export type RecordedErrorKind = "error" | "unhandledrejection" | "resource";',
    );
    // Every kind, resource failures too, reaches onError...
    expect(ERROR_RECORDER).toContain(
      "this.options.onError(atUnixMs, masked, isTriggerWorthy);",
    );
    // ...and onError is what counts it.
    expect(squash(RECORDER)).toContain(
      '_error: RecordedError, isTriggerWorthy: boolean, ): void => { this.chunker.countSignal("errorCount");',
    );

    for (const text of [
      RUM_USER_FLOW_METRIC_DESCRIPTIONS.pathWithErrors,
      RUM_USER_FLOW_METRIC_DESCRIPTIONS.pageErrors,
    ]) {
      expect(text).toContain(
        "an uncaught JavaScript error, an unhandled promise rejection or a file that failed to load",
      );
    }
  });

  test("Frustrated names the four signals with the recorder's own thresholds", () => {
    expect(USER_FLOW_READ).toContain(
      "toFloat64(sum(rageClickCount + deadClickCount + errorClickCount + refreshRageCount)) AS flowFrustrationTotal",
    );
    expect(frustrationConstant("RAGE_CLICK_THRESHOLD")).toBe(3);
    expect(frustrationConstant("RAGE_CLICK_WINDOW_MS")).toBe(1000);
    expect(frustrationConstant("DEAD_CLICK_TIMEOUT_MS")).toBe(3000);
    expect(frustrationConstant("ERROR_CLICK_WINDOW_MS")).toBe(1000);
    expect(RUM_SESSION_MODEL).toContain(
      '"Bursts of >=3 reloads of the same path within 60s"',
    );

    /*
     * Refresh rage counts page LOADS of one path, the first load included:
     * the recorder logs every start, not only reloads, so three loads (two
     * reloads, or A -> B -> A -> B -> A by full page loads) are enough -
     * which is why the text says "loaded 3 or more times", not "reloads".
     */
    expect(SESSION_ID).toContain(
      "const REFRESH_RAGE_WINDOW_MS: number = 60 * 1000;",
    );
    expect(SESSION_ID).toContain("const REFRESH_RAGE_THRESHOLD: number = 3;");
    expect(SESSION_ID).toContain(
      "return loadCountInWindow >= REFRESH_RAGE_THRESHOLD;",
    );
    expect(countOf(RECORDER, "SessionId.recordPageLoad(")).toBe(1);
    expect(squash(RECORDER)).toContain(
      "const refreshRageCount: number = SessionId.recordPageLoad( this.windowRef.location.href, Date.now(), );",
    );

    const text: string = RUM_USER_FLOW_METRIC_DESCRIPTIONS.pageFrustrated;

    expect(text).toContain("3 or more clicks within a second in one spot");
    expect(text).toContain("did nothing for 3 seconds");
    expect(text).toContain("an error within a second of a click");
    expect(text).toContain("the same page loaded 3 or more times in a minute");
    expect(text).not.toContain("reloads within a minute");
  });

  test("Exit rate divides Left by Sessions", () => {
    expect(USER_FLOW_ENGINE).toContain(
      "exitRate: ratio(accumulator.exits, accumulator.sessions),",
    );
    expect(RUM_USER_FLOW_METRIC_DESCRIPTIONS.pageExitRate).toContain(
      "Left divided by Sessions",
    );
  });
});

describe("User Flows detail panel texts match the map it explains", () => {
  test("a band's two shares divide by the node it starts from and the node it leads to", () => {
    const panel: string = squash(DETAIL_PANEL);

    expect(panel).toContain(
      "label={`Share of ${sourceLabel}`} tooltip={RUM_USER_FLOW_METRIC_DESCRIPTIONS.detailShareOfSource} value={formatUserFlowShare( source && source.sessions > 0 ? link.sessions / source.sessions : 0, )}",
    );
    expect(panel).toContain(
      "label={`Share of ${targetLabel}`} tooltip={RUM_USER_FLOW_METRIC_DESCRIPTIONS.detailShareOfTarget} value={formatUserFlowShare( target && target.sessions > 0 ? link.sessions / target.sessions : 0, )}",
    );
    // Source and target are in lived order, whichever way the map runs.
    expect(USER_FLOW_ENGINE).toContain(
      'const source: UserFlowNode = direction === "backward" ? node : previous;',
    );
    expect(RUM_USER_FLOW_METRIC_DESCRIPTIONS.detailShareOfSource).toContain(
      "the page it starts from",
    );
    expect(RUM_USER_FLOW_METRIC_DESCRIPTIONS.detailShareOfTarget).toContain(
      "the page it leads to",
    );
  });

  test("a return is judged against the whole journey, before the map too; amber from 50%", () => {
    const engine: string = squash(USER_FLOW_ENGINE);

    // Forward from a page: what came before the first arrival is "seen".
    expect(engine).toContain(
      "for (let index: number = 0; index < first; index++) { seenBefore.add(journey.pages[index] as string); }",
    );
    // Backward: the pages further back than the map draws are "seen".
    expect(engine).toContain(
      "for (let index: number = limit; index < pages.length; index++) { seenBefore.add(pages[index] as string); }",
    );
    expect(squash(DETAIL_PANEL)).toContain(
      'link.sessions > 0 && link.revisitSessions / link.sessions >= 0.5 ? "warning"',
    );
    expect(RUM_USER_FLOW_METRIC_DESCRIPTIONS.detailReturning).toContain(
      "even before the part the map shows",
    );
    expect(RUM_USER_FLOW_METRIC_DESCRIPTIONS.detailReturning).toContain(
      "Amber from 50%",
    );
  });

  test("a node's share of its step, and of every session the map is drawn from", () => {
    const panel: string = squash(DETAIL_PANEL);

    expect(panel).toContain(
      "graph.sessions > 0 ? node.sessions / graph.sessions : 0;",
    );
    expect(panel).toContain(
      "columnTotal > 0 ? node.sessions / columnTotal : 0, )} of the step`",
    );
    // graph.sessions: the journeys the map draws, those with the anchor.
    expect(USER_FLOW_ENGINE).toContain("sessions: slices.length,");
    expect(RUM_USER_FLOW_METRIC_DESCRIPTIONS.detailStepSessions).toContain(
      "every session with a page at this step",
    );
    expect(RUM_USER_FLOW_METRIC_DESCRIPTIONS.detailOfAllSessions).toContain(
      "only those that visited the chosen page",
    );
  });

  test("left here and started here are the node's terminal count; the last column's overflow is not", () => {
    const engine: string = squash(USER_FLOW_ENGINE);

    expect(engine).toContain(
      "if (step === limit - 1) { if (pages.length > steps) { node.continued += 1; } else { node.terminal += 1; } }",
    );
    expect(squash(DETAIL_PANEL)).toContain(
      'node.sessions > 0 && node.terminal / node.sessions >= 0.5 ? "danger"',
    );
    expect(RUM_USER_FLOW_METRIC_DESCRIPTIONS.detailLeftHere).toContain(
      "red from 50%",
    );
    expect(RUM_USER_FLOW_METRIC_DESCRIPTIONS.detailLeftHere).toContain(
      "sessions that went on further are not counted",
    );
    expect(RUM_USER_FLOW_METRIC_DESCRIPTIONS.detailStartedHere).toContain(
      "sessions that came from further back are not counted",
    );
  });

  test("Hit an error here is the page's error sessions, on any visit, at this step", () => {
    expect(squash(USER_FLOW_ENGINE)).toContain(
      "if (journey.errorPages.has(page)) { node.errorSessions += 1; }",
    );
    expect(RUM_USER_FLOW_METRIC_DESCRIPTIONS.detailErrorsHere).toContain(
      "on this visit or another",
    );
    // The hint beside it names two signals; the text names all four.
    expect(RUM_USER_FLOW_METRIC_DESCRIPTIONS.detailErrorsHere).toContain(
      "rage, dead and error clicks, repeated reloads",
    );
  });

  test("the neighbour lists read whole journeys, top 6, as a share of the page's sessions", () => {
    expect(USER_FLOW_MAX_NEIGHBOURS).toBe(6);
    expect(USER_FLOW_ENGINE).toContain(
      "next: accumulator.next.top(USER_FLOW_MAX_NEIGHBOURS),",
    );
    expect(USER_FLOW_ENGINE).toContain(
      "previous: accumulator.previous.top(USER_FLOW_MAX_NEIGHBOURS),",
    );
    expect(squash(DETAIL_PANEL)).toContain(
      'title="Where they came from (whole range)" tooltip={RUM_USER_FLOW_METRIC_DESCRIPTIONS.detailCameFrom} items={stats.previous} total={stats.sessions}',
    );

    for (const text of [
      RUM_USER_FLOW_METRIC_DESCRIPTIONS.detailCameFrom,
      RUM_USER_FLOW_METRIC_DESCRIPTIONS.detailWentNext,
    ]) {
      expect(text).toContain("not only this step of the map");
      expect(text).toContain("The 6 most common are listed");
    }
  });

  test("Other pages lists up to 50 of what it folds, as a share of its own sessions", () => {
    expect(USER_FLOW_MAX_OTHER_PAGES).toBe(50);
    expect(USER_FLOW_ENGINE).toContain(
      "node.otherPages = counter.top(USER_FLOW_MAX_OTHER_PAGES);",
    );
    expect(squash(DETAIL_PANEL)).toContain(
      "items={node.otherPages} total={node.sessions}",
    );
    expect(RUM_USER_FLOW_METRIC_DESCRIPTIONS.detailFoldedPages).toContain(
      "at most 50 are listed",
    );
  });
});

/* ------------------------------------------------------------------ */
/* Accuracy: Users                                                     */
/* ------------------------------------------------------------------ */

describe("Users texts match the per-person rollup", () => {
  test("sessions that started in the range; live and first seen as the rollup defines them", () => {
    const listUsers: string = REPLAY_READ.slice(
      indexOfOrFail(REPLAY_READ, "public static async listUsers("),
    );

    expect(listUsers).toContain("AND startTime >= ");
    expect(listUsers).toContain("AND startTime <= ");
    expect(squash(REPLAY_READ)).toContain(
      '{ alias: "rollupLiveSessionCount", expression: "toFloat64(countIf(aggIsFinalized = 0))", }',
    );
    expect(squash(REPLAY_READ)).toContain(
      '{ alias: "rollupFirstSeenUnixMs", expression: "toFloat64(min(aggStartTime))", }',
    );
    expect(RUM_REPLAY_USERS_METRIC_DESCRIPTIONS.sessions).toContain(
      "started in the selected range",
    );
    expect(RUM_REPLAY_USERS_METRIC_DESCRIPTIONS.sessions).toContain(
      "their earliest session in the range started",
    );
  });

  test("'live' means not yet finalized, which outlasts the visitor by minutes", () => {
    /*
     * The finalizer closes a session a grace period after every tab ended,
     * or after SESSION_REPLAY_IDLE_FINALIZE_MS with no chunk at all; until
     * then it counts as live although nothing more is being recorded.
     */
    expect(SESSION_REPLAY_TYPES).toContain(
      "export const SESSION_REPLAY_IDLE_FINALIZE_MS: number = 10 * 60 * 1000;",
    );
    expect(SESSION_REPLAY_TYPES).toContain(
      "export const SESSION_REPLAY_ENDED_FINALIZE_GRACE_MS: number = 60 * 1000;",
    );
    expect(FINALIZER).toContain("pageCount: aggregate.pageCount,");
    expect(RUM_REPLAY_USERS_METRIC_DESCRIPTIONS.sessions).toContain(
      "still live (not yet closed off, which can take a few minutes after the visitor leaves)",
    );
    expect(RUM_REPLAY_USERS_METRIC_DESCRIPTIONS.sessions).not.toContain(
      "still being recorded",
    );
  });

  test("Last seen is the newest session's START", () => {
    expect(REPLAY_READ).toContain(
      '{ alias: "rollupLastSeenUnixMs", expression: "toFloat64(max(aggStartTime))" },',
    );
    expect(RUM_REPLAY_USERS_METRIC_DESCRIPTIONS.lastSeen).toContain(
      "newest session in the selected range started, not when they were last active",
    );
  });

  test("Time adds up each session's duration, idle time included", () => {
    expect(squash(REPLAY_READ)).toContain(
      '{ alias: "rollupTotalDurationMs", expression: "toFloat64(sum(aggDurationMs))", }',
    );
    expect(REPLAY_READ).toContain(
      '{ alias: "aggDurationMs", expression: LIVE_DURATION_EXPRESSION },',
    );
    expect(RUM_REPLAY_USERS_METRIC_DESCRIPTIONS.time).toContain(
      "idle time included",
    );
  });

  test("the page line counts in-app route changes, never the page a full load opened", () => {
    expect(REPLAY_READ).toContain(
      '{ alias: "rollupPageCount", expression: "toFloat64(sum(aggPageCount))" },',
    );
    expect(INGEST_SERVICE).toContain("pageCount: envelope.signals.routeCount,");
    // routeCount moves only on a route change...
    expect(countOf(RECORDER, 'this.chunker.countSignal("routeCount");')).toBe(
      1,
    );
    expect(squash(RECORDER)).toContain(
      'onRouteChange: (atUnixMs: number, route: RecordedRoute): void => { this.chunker.countSignal("routeCount");',
    );
    // ...and the page a load opened is added to the route list, not counted.
    const entry: number = indexOfOrFail(
      RECORDER,
      "this.chunker.addRoute(this.entryUrl);",
    );

    expect(RECORDER.slice(entry, entry + 400).includes("countSignal")).toBe(
      false,
    );
    expect(RUM_REPLAY_USERS_METRIC_DESCRIPTIONS.time).toContain(
      "page changes made inside the app without a full reload; a page opened by a full load is not counted",
    );
  });

  test("Signals adds up errors and the four frustration counters; a live session keeps a maximum", () => {
    expect(REPLAY_READ).toContain(
      '"(aggRageClickCount + aggDeadClickCount + aggErrorClickCount + aggRefreshRageCount)"',
    );
    expect(REPLAY_READ).toContain(
      '{ alias: "rollupErrorCount", expression: "toFloat64(sum(aggErrorCount))" },',
    );
    expect(INGEST_SERVICE).toContain(
      "errorCount: Math.max(previous.errorCount, next.errorCount),",
    );
    expect(RUM_REPLAY_USERS_METRIC_DESCRIPTIONS.signals).toContain(
      "rage, dead and error clicks and repeated reloads",
    );
    expect(RUM_REPLAY_USERS_METRIC_DESCRIPTIONS.signals).toContain(
      "A live session can show fewer until it is closed off",
    );
  });

  test("a repeating error adds to the count at most once every 5 seconds", () => {
    expect(ERROR_RECORDER).toContain(
      "export const REPEAT_MARKER_INTERVAL_MS: number = 5000;",
    );

    const repeat: string = squash(
      ERROR_RECORDER.slice(
        indexOfOrFail(ERROR_RECORDER, "private handleRepeat("),
        indexOfOrFail(ERROR_RECORDER, "private reportCapOnce("),
      ),
    );

    // Too soon after the last one: it returns before onError, so nothing counts.
    expect(repeat).toContain(
      "if (atUnixMs - known.lastMarkerAtMs < REPEAT_MARKER_INTERVAL_MS) { return; }",
    );
    expect(repeat).toContain(
      "this.options.onError(atUnixMs, known.masked, known.isTriggerWorthy);",
    );
    expect(RUM_REPLAY_USERS_METRIC_DESCRIPTIONS.signals).toContain(
      "an error that keeps repeating adds at most one every 5 seconds",
    );
  });
});

/* ------------------------------------------------------------------ */
/* Accuracy: Replay Health                                             */
/* ------------------------------------------------------------------ */

describe("Replay Health texts match the ingest-status sources", () => {
  test("Recorder loaded is the application's last contact of any kind, written once a minute", () => {
    expect(TELEMETRY_API).toContain(
      'lastConfigFetchAt: toIsoOrNull(applicationView["lastSeenAt"]),',
    );
    expect(RUM_APPLICATION_SERVICE).toContain(
      "lastSeenAt: OneUptimeDate.getCurrentDate(),",
    );
    expect(RUM_APPLICATION_SERVICE).toContain(
      "const LAST_SEEN_THROTTLE_SECONDS: number = 60;",
    );
    // Stamped by the replay config fetch and chunk upload...
    expect(countOf(INGEST_ROUTE, "markApplicationAlive(")).toBe(3);
    // ...and by every OTLP batch the application sends.
    expect(OTEL_INGEST).toContain(
      "await RumApplicationService.updateLastSeen(rumApplicationId, {",
    );
    expect(SESSION_REPLAY_RECORDER_ACTIVE_WINDOW_MS).toBe(24 * 60 * 60 * 1000);

    const text: string =
      RUM_RECORDING_HEALTH_METRIC_DESCRIPTIONS.recorderLoaded;

    expect(text).toContain("written at most once a minute");
    expect(text).toContain("any other telemetry the app sends");
    expect(text).toContain("Amber after 24 hours");
  });

  test("Recording allowed: sessions are picked by id and record from their first moment", () => {
    for (const id of ["a1b2c3", "ffff0000", "session-42"]) {
      expect(SessionSampling.isSampled(id, 50)).toBe(
        SessionSampling.isSampled(id, 50),
      );
    }

    expect(squash(RECORDER)).toContain(
      "if (isSampled) { this.trigger(SessionReplayTriggerReason.Sampled); }",
    );
    expect(RUM_RECORDING_HEALTH_METRIC_DESCRIPTIONS.recordingAllowed).toContain(
      "Sessions are picked by their id",
    );
  });

  test("Chunks received is stamped once a chunk is stored, once a minute at most", () => {
    const stored: number = indexOfOrFail(
      INGEST_SERVICE,
      "await Promise.all(pendingAcks);",
    );
    const stamped: number = indexOfOrFail(
      INGEST_SERVICE,
      "RumApplicationService.markSessionReplayChunkReceived(",
    );

    expect(stamped).toBeGreaterThan(stored);
    expect(RUM_APPLICATION_SERVICE).toContain(
      "const REPLAY_CHUNK_RECEIVED_THROTTLE_SECONDS: number = 60;",
    );
    expect(SESSION_REPLAY_STALE_CHUNK_MS).toBe(6 * 60 * 60 * 1000);
    expect(SESSION_REPLAY_REFUSAL_ALERT_THRESHOLD).toBe(5);

    const text: string =
      RUM_RECORDING_HEALTH_METRIC_DESCRIPTIONS.chunksReceived;

    expect(text).toContain("about 15 seconds of footage");
    expect(text).toContain("was stored, written at most once a minute");
    expect(text).toContain("amber after 6 hours");
    expect(text).toContain("5 or more");
  });

  test("Sessions in 24h: started in the last 24 hours, and only finished empty or lost sessions are unplayable", () => {
    expect(REPLAY_READ).toContain(
      "value: new Date(data.nowUnixMs - 24 * 60 * 60 * 1000),",
    );
    expect(REPLAY_READ).toContain(
      "uniqExactIf(sessionId, isFinalized AND (chunkCount = 0 OR sealedReason = ",
    );
    expect(REPLAY_READ).toContain(
      "playableSessionsLast24h: Math.max(0, sessionCount - unplayableCount),",
    );
    expect(REPLAY_READ).toContain(
      "export const SESSION_REPLAY_ACTIVITY_SUMMARY_CACHE_TTL_MS: number = 30 * 1000;",
    );
    // The newest start is read with no time bound.
    expect(REPLAY_READ).toContain(
      'lastStartStatement.append(" ORDER BY startTime DESC LIMIT 1");',
    );

    const text: string =
      RUM_RECORDING_HEALTH_METRIC_DESCRIPTIONS.sessionsLast24h;

    expect(text).toContain("started in the past 24 hours");
    expect(text).toContain("up to 30 seconds");
    expect(text).toContain("sessions still recording count as playable");
    expect(text).toContain("The newest start can be older than 24 hours");
  });

  test("refusals and drops are kept per UTC day and read as today plus yesterday", () => {
    expect(HEALTH_COUNTERS).toContain(
      "return new Date(unixMs).toISOString().substring(0, 10);",
    );
    expect(
      countOf(HEALTH_COUNTERS, "utcDay: this.getUtcDayBucket(nowUnixMs),"),
    ).toBe(2);
    expect(
      countOf(
        HEALTH_COUNTERS,
        "utcDay: this.getUtcDayBucket(nowUnixMs - DAY_MS),",
      ),
    ).toBe(2);

    for (const text of [
      RUM_RECORDING_HEALTH_METRIC_DESCRIPTIONS.refusedAtGate,
      RUM_RECORDING_HEALTH_METRIC_DESCRIPTIONS.droppedAfterAcceptance,
    ]) {
      expect(text).toContain(
        "kept per UTC day and this adds today to all of yesterday, so it covers between 24 and 48 hours",
      );
    }
  });

  test("a refusal is one per request; a drop is counted after the 202", () => {
    const gate: string = squash(
      INGEST_SERVICE.slice(
        indexOfOrFail(INGEST_SERVICE, "public static async gateChunkRequest("),
      ),
    );

    expect(gate).toContain(
      'if (decision.reason !== "accepted") { SessionReplayHealthCounters.recordRefusal({',
    );
    expect(squash(INGEST_SERVICE)).toContain(
      "private static recordDrop( reason: string,",
    );
    expect(RUM_RECORDING_HEALTH_METRIC_DESCRIPTIONS.refusedAtGate).toContain(
      "Each request counts once",
    );
    expect(
      RUM_RECORDING_HEALTH_METRIC_DESCRIPTIONS.droppedAfterAcceptance,
    ).toContain("accepted with a 202 and then did not store");
  });

  test("bytes are the upload bodies, per UTC day for the project and per UTC month for the application", () => {
    expect(USAGE).toContain(
      "return new Date().toISOString().substring(0, 10);",
    );
    expect(USAGE).toContain("return new Date().toISOString().substring(0, 7);");
    expect(INGEST_ROUTE).toContain("payloadBytes: stagedBody.length,");
    expect(squash(INGEST_SERVICE)).toContain(
      "await SessionReplayRateLimiter.consumeByteBudget({ projectId: data.projectId, bytes: data.payloadBytes, });",
    );
    // gzip where the browser has CompressionStream, raw where it does not.
    expect(TRANSPORT).toContain(
      'if (typeof globalRecord["CompressionStream"] !== "function") {',
    );
    expect(TRANSPORT).toContain(
      'return { bytes: new Uint8Array(compressed), encoding: "gzip" };',
    );
    expect(USAGE_WARNING_PERCENT).toBe(80);
    expect(
      RUM_RECORDING_HEALTH_METRIC_DESCRIPTIONS.projectBytesToday,
    ).toContain("since 00:00 UTC for the whole project");
    expect(
      RUM_RECORDING_HEALTH_METRIC_DESCRIPTIONS.projectBytesToday,
    ).toContain("as the recorders sent them (usually compressed)");
    expect(
      RUM_RECORDING_HEALTH_METRIC_DESCRIPTIONS.applicationBytesThisMonth,
    ).toContain("since the 1st of the month (UTC)");
  });

  test("the application's monthly counter only moves while a budget is set", () => {
    const guard: number = indexOfOrFail(
      INGEST_SERVICE,
      "if (policy.monthlyBudgetInGB !== null && policy.monthlyBudgetInGB > 0) {",
    );
    const consume: number = indexOfOrFail(
      INGEST_SERVICE,
      "SessionReplayRateLimiter.consumeApplicationMonthlyBudget({",
    );

    expect(consume).toBeGreaterThan(guard);
    expect(countOf(INGEST_SERVICE, "consumeApplicationMonthlyBudget(")).toBe(1);
    expect(
      RUM_RECORDING_HEALTH_METRIC_DESCRIPTIONS.applicationBytesThisMonth,
    ).toContain("Only counted while a budget is set, so with none it reads 0");
  });
});
