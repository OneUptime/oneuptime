import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The monitor overview is a composition: a page, four data hooks, a pure
 * presentation model and a card per question. This App suite runs in plain
 * Node with no renderer, so every way of breaking that composition is
 * silent. Drop a card from the page and it still compiles; give a card its
 * own timer and the page still works, just with twice the requests; put the
 * secret-key select back into a module constant and the page works for an
 * admin and fails for every Viewer. The cards and the page itself are
 * rendered in Common/Tests/App/Dashboard/Monitor*.test.tsx.
 *
 * So these read the sources and assert the INVARIANTS of the composition.
 * Sources are whitespace-squashed so a prettier re-wrap cannot fail a real
 * check, and comments are stripped so prose describing what was removed
 * cannot either. The module set is walked from the page's own imports rather
 * than listed, so a card added later is covered automatically.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const MONITOR_COMPONENTS_DIR: string = path.join(
  DASHBOARD_SRC,
  "Components",
  "Monitor",
);

const THEME_CSS_PATH: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "Common",
  "UI",
  "Styles",
  "Theme.css",
);

function squash(text: string): string {
  return text.replace(/\s+/g, " ");
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

function readCodeAt(absolutePath: string): string {
  return squash(stripComments(fs.readFileSync(absolutePath, "utf8")));
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

// A module under Components/Monitor, named by its path without extension.
function resolveMonitorModule(moduleKey: string): string {
  for (const extension of [".tsx", ".ts"]) {
    const candidate: string = path.join(
      MONITOR_COMPONENTS_DIR,
      `${moduleKey}${extension}`,
    );

    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(`Components/Monitor/${moduleKey} does not exist.`);
}

/*
 * The walk covers the overview's own modules and the trace preview it
 * embeds. Shared components outside those (Slo, EventView, Common UI) are
 * tested where they live.
 */
function isOverviewModule(moduleKey: string): boolean {
  return (
    moduleKey.startsWith("Overview/") ||
    moduleKey === "TraceMonitor/TraceMonitorPreview"
  );
}

const INDEX_PATH: string = path.join(
  DASHBOARD_SRC,
  "Pages",
  "Monitor",
  "View",
  "Index.tsx",
);
const INDEX_RAW: string = fs.readFileSync(INDEX_PATH, "utf8");
const INDEX_CODE: string = readCodeAt(INDEX_PATH);

const IMPORT_SOURCE: RegExp = /from "([^"]+)"/g;

function getOverviewModules(): Map<string, string> {
  const modules: Map<string, string> = new Map();
  const pending: Array<string> = [];

  for (const match of INDEX_CODE.matchAll(IMPORT_SOURCE)) {
    const source: string = match[1]!;
    const prefix: string = "../../../Components/Monitor/";

    if (source.startsWith(prefix)) {
      pending.push(source.slice(prefix.length));
    }
  }

  while (pending.length > 0) {
    const moduleKey: string = pending.pop()!;

    if (modules.has(moduleKey) || !isOverviewModule(moduleKey)) {
      continue;
    }

    const code: string = readCodeAt(resolveMonitorModule(moduleKey));
    modules.set(moduleKey, code);

    for (const match of code.matchAll(IMPORT_SOURCE)) {
      const source: string = match[1]!;

      if (!source.startsWith(".")) {
        continue;
      }

      pending.push(
        path.posix.normalize(
          path.posix.join(path.posix.dirname(moduleKey), source),
        ),
      );
    }
  }

  return modules;
}

const OVERVIEW_MODULES: Map<string, string> = getOverviewModules();

function getModuleCode(moduleKey: string): string {
  const code: string | undefined = OVERVIEW_MODULES.get(moduleKey);

  if (code === undefined) {
    throw new Error(
      `The overview does not reach Components/Monitor/${moduleKey}.`,
    );
  }

  return code;
}

// The page and every walked module, for checks that apply to all of them.
function getAllOverviewCode(): Array<[string, string]> {
  return [["Pages/Monitor/View/Index", INDEX_CODE], ...OVERVIEW_MODULES];
}

// Asserts that every needle is present and that they appear in this order.
function expectInOrder(code: string, order: Array<string>): void {
  const positions: Array<number> = order.map((needle: string) => {
    return code.indexOf(needle);
  });

  for (const [index, position] of positions.entries()) {
    expect({ needle: order[index], found: position >= 0 }).toEqual({
      needle: order[index],
      found: true,
    });
  }

  expect(
    [...positions].sort((a: number, b: number) => {
      return a - b;
    }),
  ).toEqual(positions);
}

/*
 * The source text of every call's argument object, brace-matched so nested
 * selects do not cut it short.
 */
function getCallArguments(code: string, callee: string): Array<string> {
  const calls: Array<string> = [];
  let from: number = code.indexOf(callee);

  while (from !== -1) {
    const openIndex: number = code.indexOf("{", from);
    let depth: number = 0;
    let end: number = -1;

    for (let i: number = openIndex; i < code.length; i++) {
      if (code[i] === "{") {
        depth++;
      } else if (code[i] === "}") {
        depth--;

        if (depth === 0) {
          end = i;
          break;
        }
      }
    }

    if (openIndex === -1 || end === -1) {
      throw new Error(`Unbalanced braces after ${callee}.`);
    }

    calls.push(code.slice(openIndex, end + 1));
    from = code.indexOf(callee, end);
  }

  return calls;
}

// Where the main (two-thirds) column and the side column start.
const MAIN_COLUMN_START: number = INDEX_CODE.indexOf(
  '<div className="min-w-0 xl:col-span-2">',
);
const SIDE_COLUMN_START: number = INDEX_CODE.indexOf(
  '<div className="min-w-0">',
  MAIN_COLUMN_START + 1,
);
const MAIN_COLUMN_CODE: string = INDEX_CODE.slice(
  MAIN_COLUMN_START,
  SIDE_COLUMN_START,
);
const SIDE_COLUMN_CODE: string = INDEX_CODE.slice(SIDE_COLUMN_START);

describe("Monitor overview page", () => {
  test("the first load is the event skeleton with four stat cells, before anything else", () => {
    expect(INDEX_CODE).toMatch(
      /if \(!data\.hasLoaded\) \{ return \(? ?<EventOverviewSkeleton statCount=\{4\} loadingText="Loading monitor" \/> ?\)?; \}/,
    );

    // The component's first return is the skeleton: nothing renders ahead of it.
    const body: string = INDEX_CODE.slice(
      INDEX_CODE.indexOf("const MonitorView"),
    );
    const firstReturn: RegExpMatchArray | null = body.match(
      /\breturn \(? ?<([A-Za-z]+)/,
    );

    expect(firstReturn?.[1]).toBe("EventOverviewSkeleton");
    expect(body.indexOf("return ")).toBe(firstReturn?.index);
  });

  test("every hook runs before the first return, so none is called conditionally", () => {
    const body: string = INDEX_CODE.slice(
      INDEX_CODE.indexOf("const MonitorView"),
    );
    const firstReturn: number = body.indexOf("return ");
    const hookCalls: Array<RegExpMatchArray> = Array.from(
      body.matchAll(/\b(use[A-Z][A-Za-z]*)(?:<[^()]*>)?\(/g),
    );

    expect(
      hookCalls
        .map((match: RegExpMatchArray) => {
          return match[1]!;
        })
        .sort(),
    ).toEqual(
      [
        "useEffect",
        "useMonitorOpenWork",
        "useMonitorOverviewData",
        "useMonitorOwners",
        "useMonitorUptimeSummary",
        "useOutletContext",
        "useRef",
        "useState",
      ].sort(),
    );

    for (const match of hookCalls) {
      expect({
        hook: match[1],
        beforeFirstReturn: match.index! < firstReturn,
      }).toEqual({ hook: match[1], beforeFirstReturn: true });
    }
  });

  test("makes no request of its own and keeps none of the old page's machinery", () => {
    for (const forbidden of [
      "PageLoader",
      "isLoading",
      "ModelAPI.",
      "API.",
      "DisabledWarning",
      "strongTitle=",
      "setInterval(",
      "useAsyncEffect",
    ]) {
      expect({ forbidden, present: INDEX_CODE.includes(forbidden) }).toEqual({
        forbidden,
        present: false,
      });
    }
  });

  test("a failed first load offers the retry, and a missing row says why", () => {
    expect(INDEX_CODE).toContain(
      "<ErrorMessage message={data.error || MONITOR_OVERVIEW_NOT_FOUND_MESSAGE} onRefreshClick={data.retryFirstLoad} />",
    );
  });

  test("renders the notice, the hero, the stat bar and then the grid", () => {
    expectInOrder(INDEX_CODE, [
      "<DependencySuppressionWarning",
      '<div className="mb-5"> <MonitorOverviewHero',
      "<MonitorOverviewStatBar",
      '<div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-3">',
      '<div className="min-w-0 xl:col-span-2">',
    ]);

    // The stat bar is dropped with the uptime history while awaiting data.
    expect(INDEX_CODE).toMatch(
      /\{sections\.showUptime \? \( <MonitorOverviewStatBar className="mb-5"/,
    );
  });

  test("main column: setup, uptime history, response time, summary, telemetry preview, activity", () => {
    expectInOrder(MAIN_COLUMN_CODE, [
      "<MonitorSetupCard",
      "<MonitorUptimeHistoryCard",
      "<MonitorResponseTimeCard",
      "<Summary",
      "<MonitorTelemetryPreview",
      "<MonitorActivityCard",
    ]);

    // Each is shown exactly when the presentation model says so.
    expect(MAIN_COLUMN_CODE).toContain(
      "{sections.setup !== null ? ( <MonitorSetupCard",
    );
    expect(MAIN_COLUMN_CODE).toContain(
      "{sections.showUptime ? ( <MonitorUptimeHistoryCard",
    );
    expect(MAIN_COLUMN_CODE).toContain(
      "{sections.responseTimeMetric !== null ? ( <MonitorResponseTimeCard",
    );
    expect(MAIN_COLUMN_CODE).toContain(
      "{sections.summary.isShown ? ( <Summary",
    );
    expect(MAIN_COLUMN_CODE).toContain(
      "{sections.telemetryPreview !== null ? ( <MonitorTelemetryPreview",
    );

    // Activity is the one card every monitor gets.
    expect(MAIN_COLUMN_CODE).not.toMatch(/\? \( <MonitorActivityCard/);
  });

  test("side column: open work, status changes, the family card, details, custom fields", () => {
    expect(SIDE_COLUMN_START).toBeGreaterThan(MAIN_COLUMN_START);

    expectInOrder(SIDE_COLUMN_CODE, [
      "<MonitorOpenWorkCard",
      "<MonitorStatusChangesCard",
      "<MonitorProbesCard",
      "<MonitorConnectionCard",
      "<MonitorManualGuideCard",
      "<MonitorOverviewDetailsCard",
      "<OverviewCustomFields",
    ]);

    // At most one family card, chosen by the presentation model.
    expect(SIDE_COLUMN_CODE).toContain(
      '{sections.sideCard === "probes" ? ( <MonitorProbesCard',
    );
    expect(SIDE_COLUMN_CODE).toMatch(
      /\{sections\.sideCard === "connection" && sections\.connection !== null \? \( <MonitorConnectionCard/,
    );
    expect(SIDE_COLUMN_CODE).toContain(
      '{sections.sideCard === "manual" ? ( <MonitorManualGuideCard',
    );
  });

  test("the custom fields card is last, stacked, and names the monitor's own models", () => {
    expect(SIDE_COLUMN_CODE).toContain(
      '<OverviewCustomFields modelId={modelId} modelType={Monitor} customFieldType={MonitorCustomField} resourceName="Monitor" headerLayout="stacked" /> </div> </div> </Fragment>',
    );

    /*
     * OverviewCustomFieldsCoverage.test.ts reads the FIRST modelType={X} of
     * the raw file, so no other one may appear, not even in a comment.
     */
    expect(countOccurrences(INDEX_RAW, "modelType={")).toBe(1);
    expect(countOccurrences(INDEX_RAW, "customFieldType={")).toBe(1);
  });
});

describe("Monitor overview data flow", () => {
  test("the walk reaches the data hooks, the presentation adapter and every card", () => {
    expect(Array.from(OVERVIEW_MODULES.keys()).sort()).toEqual(
      expect.arrayContaining([
        "Overview/MonitorActivityCard",
        "Overview/MonitorConnectionCard",
        "Overview/MonitorManualGuideCard",
        "Overview/MonitorOpenWorkCard",
        "Overview/MonitorOverviewDetailsCard",
        "Overview/MonitorOverviewHero",
        "Overview/MonitorOverviewInput",
        "Overview/MonitorOverviewLinks",
        "Overview/MonitorOverviewSelect",
        "Overview/MonitorOverviewStatBar",
        "Overview/MonitorOverviewTones",
        "Overview/MonitorOverviewTypes",
        "Overview/MonitorProbesCard",
        "Overview/MonitorResponseTimeCard",
        "Overview/MonitorSetupCard",
        "Overview/MonitorStatusChangesCard",
        "Overview/MonitorStatusDot",
        "Overview/MonitorTelemetryPreview",
        "Overview/MonitorUptimeHistoryCard",
        "Overview/useMonitorOpenWork",
        "Overview/useMonitorOverviewData",
        "Overview/useMonitorOwners",
        "Overview/useMonitorUptimeSummary",
        "TraceMonitor/TraceMonitorPreview",
      ]),
    );
  });

  test("there is exactly one poll, in the data hook; no card runs its own timer", () => {
    const polls: Array<string> = [];

    for (const [moduleKey, code] of getAllOverviewCode()) {
      for (
        let index: number = 0;
        index < countOccurrences(code, "setInterval(");
        index++
      ) {
        polls.push(moduleKey);
      }
    }

    expect(polls).toEqual(["Overview/useMonitorOverviewData"]);
  });

  test("refresh-status is fired only by the data hook, once per monitor, and not awaited", () => {
    const callers: Array<string> = [];

    for (const [moduleKey, code] of getAllOverviewCode()) {
      for (
        let index: number = 0;
        index < countOccurrences(code, "/monitor/refresh-status/");
        index++
      ) {
        callers.push(moduleKey);
      }
    }

    expect(callers).toEqual(["Overview/useMonitorOverviewData"]);

    /*
     * Inside the once-per-id guard, and stored rather than awaited: the
     * page must not wait on a repair, and a poll must never repeat it.
     */
    expect(getModuleCode("Overview/useMonitorOverviewData")).toMatch(
      /if \(refreshStatusFiredForRef\.current !== monitorIdString\) \{ refreshStatusFiredForRef\.current = monitorIdString; refreshStatusPromiseRef\.current = API\.get\(\{ url: URL\.fromString\(APP_API_URL\.toString\(\)\)\.addRoute\( "\/monitor\/refresh-status\/" \+ options\.monitorId\.toString\(\), \), headers: ModelAPI\.getCommonHeaders\(\), \}\)/,
    );
  });

  test("the Monitor row is read only by the data hook, with the secret-key select spread at the call", () => {
    const readers: Array<string> = [];

    for (const [moduleKey, code] of getAllOverviewCode()) {
      if (code.includes("ModelAPI.getItem")) {
        readers.push(moduleKey);
      }
    }

    expect(readers).toEqual(["Overview/useMonitorOverviewData"]);

    /*
     * getReadableMonitorSecretKeySelect() reads the permission snapshot when
     * it is called. Spread into a module constant, it would freeze whoever
     * loaded the module first into everyone's select, and a Viewer's read
     * of an admin's secret-key columns fails the whole row.
     */
    const calls: Array<string> = getCallArguments(
      getModuleCode("Overview/useMonitorOverviewData"),
      "ModelAPI.getItem<Monitor>(",
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain(
      "select: { ...MONITOR_OVERVIEW_BASE_SELECT, ...getReadableMonitorSecretKeySelect(), }",
    );
    expect(getModuleCode("Overview/MonitorOverviewSelect")).not.toContain(
      "getReadableMonitorSecretKeySelect",
    );
  });

  test("no module lists every monitor status, or reads the whole status timeline", () => {
    for (const [moduleKey, code] of getAllOverviewCode()) {
      expect({
        moduleKey,
        listsStatuses:
          code.includes("ModelAPI.getList<MonitorStatus>(") ||
          code.includes("modelType: MonitorStatus,"),
      }).toEqual({ moduleKey, listsStatuses: false });

      for (const call of getCallArguments(
        code,
        "ModelAPI.getList<MonitorStatusTimeline>(",
      )) {
        expect({
          moduleKey,
          capped: !call.includes("LIMIT_PER_PROJECT"),
        }).toEqual({ moduleKey, capped: true });
        expect(call).toContain("limit: MONITOR_OVERVIEW_STATUS_ROW_LIMIT,");
      }
    }

    // The uptime history comes from the server's daily aggregate instead.
    expect(getModuleCode("Overview/useMonitorUptimeSummary")).toContain(
      '"/monitor/uptime-summary/"',
    );
    expect(getModuleCode("Overview/MonitorOverviewSelect")).toContain(
      "export const MONITOR_OVERVIEW_STATUS_ROW_LIMIT: number = 5;",
    );
  });

  test("every reload token is derived from the one poll", () => {
    // Uptime: every fifth poll, a status change or the Refresh button.
    expect(INDEX_CODE).toContain(
      'refreshKey: [ data.statusChangeCount, Math.floor(data.pollCount / MONITOR_OVERVIEW_UPTIME_POLLS_PER_RELOAD), data.manualRefreshCount, ].join("|"),',
    );
    // Open work: every poll, a status change or the Refresh button.
    expect(INDEX_CODE).toContain(
      "refreshToken: data.pollCount + data.statusChangeCount + data.manualRefreshCount,",
    );
    // Owners: once per monitor and on the Refresh button.
    expect(INDEX_CODE).toMatch(
      /useMonitorOwners\(\{ monitorId: modelId, refreshToken: data\.manualRefreshCount, \}\)/,
    );
    // The feed also shows the details card's own edits.
    expect(INDEX_CODE).toContain(
      "const feedRefreshToken: number = data.manualRefreshCount + data.statusChangeCount + detailsSaveCount;",
    );
    expect(INDEX_CODE).toContain(
      "refreshToggle={`${data.statusChangeCount}|${data.manualRefreshCount}`}",
    );
    // A real change only; never flipped by the page loading.
    expect(INDEX_CODE).toContain(
      "refresher={data.manualRefreshCount % 2 === 1}",
    );
  });

  test("a details save refreshes the page, the header and the feed, unless the reader has moved on", () => {
    expect(INDEX_CODE).toContain(
      'if (currentModelIdRef.current !== modelIdString) { return; } data.refresh({ reason: "details-saved" }); outlet?.refreshHeader(); setDetailsSaveCount(',
    );
    expect(INDEX_CODE).toContain("onSaveSuccess={onDetailsSaved}");
    expect(INDEX_CODE).toContain(
      "useOutletContext< MonitorViewOutletContext | undefined >()",
    );
  });

  test("the Summary card gets the monitor's own probes and per-probe verdicts", () => {
    const summary: string = MAIN_COLUMN_CODE.slice(
      MAIN_COLUMN_CODE.indexOf("<Summary"),
      MAIN_COLUMN_CODE.indexOf("/>", MAIN_COLUMN_CODE.indexOf("<Summary")),
    );

    for (const prop of [
      "probes={probes}",
      "disabledProbeIds={disabledProbeIds}",
      "monitorSteps={monitor.monitorSteps}",
      "monitorId={modelId}",
      "description={sections.summary.description}",
      "probeLoadError={probeLoadError}",
      "probeMonitorResponses={probeData?.attached.probeResponses}",
      "evaluationSummariesByProbeId={evaluation?.byProbeId}",
      "evaluationSummary={evaluation?.latest?.summary}",
    ]) {
      expect({ prop, passed: summary.includes(prop) }).toEqual({
        prop,
        passed: true,
      });
    }

    expect(INDEX_CODE).toContain(
      "const probes: Array<Probe> = probeData?.attached.probes || [];",
    );
    expect(INDEX_CODE).toContain(
      "const disabledProbeIds: Array<string> = probeData?.attached.disabledProbeIds || [];",
    );
  });

  test("the hero, the probes card and the response-time card share one probe summary", () => {
    expect(INDEX_CODE).toContain(
      "presentation = MonitorOverviewPresentationUtil.build(presentationInput);",
    );
    expect(INDEX_CODE).toContain("summary={presentationInput.probes}");
    expect(INDEX_CODE).toContain(
      "responseTime={presentationInput.probes?.responseTime ?? null}",
    );
  });
});

describe("Monitor overview side cards", () => {
  const SIDE_CARDS: Array<string> = [
    "Overview/MonitorOpenWorkCard",
    "Overview/MonitorStatusChangesCard",
    "Overview/MonitorProbesCard",
    "Overview/MonitorConnectionCard",
    "Overview/MonitorManualGuideCard",
    "Overview/MonitorOverviewDetailsCard",
  ];

  test("every side-column card mounted by the page is in this list", () => {
    const mounted: Array<string> = SIDE_CARDS.filter((moduleKey: string) => {
      return SIDE_COLUMN_CODE.includes(`<${path.posix.basename(moduleKey)}`);
    });

    expect(mounted).toEqual(SIDE_CARDS);
  });

  test("each uses the stacked header, with a description short enough for the narrow column", () => {
    /*
     * Card descriptions are hidden below md, and in a one-third column a
     * long one wraps under the title and pushes the card down. Seventy
     * characters is what fits on one line at xl.
     */
    const stackedDescription: RegExp =
      /description(?:=|: )"([^"]*)",? headerLayout(?:=|: )"stacked"/g;

    for (const moduleKey of SIDE_CARDS) {
      const descriptions: Array<string> = Array.from(
        getModuleCode(moduleKey).matchAll(stackedDescription),
      ).map((match: RegExpMatchArray) => {
        return match[1]!;
      });

      expect({ moduleKey, stacked: descriptions.length > 0 }).toEqual({
        moduleKey,
        stacked: true,
      });

      for (const description of descriptions) {
        expect({
          moduleKey,
          description,
          fits: description.length <= 70,
        }).toEqual({ moduleKey, description, fits: true });
      }
    }
  });

  test("the details card edits in place and reads as a compact single column", () => {
    const code: string = getModuleCode("Overview/MonitorOverviewDetailsCard");

    expect(code).toContain('editButtonText="Edit"');
    expect(code).toContain("style: DetailStyle.Compact,");
    expect(code).toContain("showDetailsInNumberOfColumns: 1,");
    expect(code).toContain("onSaveSuccess={() => { props.onSaveSuccess(); }}");

    // Name, description and labels stay editable; nothing else is.
    const formFields: string = code.slice(
      code.indexOf("formFields={["),
      code.indexOf("refresher="),
    );
    const editable: Array<string> = Array.from(
      formFields.matchAll(/field: \{ ([A-Za-z]+): true, \}/g),
    ).map((match: RegExpMatchArray) => {
      return match[1]!;
    });

    expect(editable).toEqual(["name", "description", "labels"]);
  });
});

describe("Monitor overview links", () => {
  /*
   * The route registries are squashed but NOT comment-stripped: their route
   * strings contain "/*" wildcards, which the naive stripper above reads as a
   * block comment opening and swallows every registration up to the next
   * "*\/", so a real registration would look missing.
   */
  const readSquashedAt: (absolutePath: string) => string = (
    absolutePath: string,
  ): string => {
    return squash(fs.readFileSync(absolutePath, "utf8"));
  };

  const PAGE_MAP_CODE: string = readSquashedAt(
    path.join(DASHBOARD_SRC, "Utils", "PageMap.ts"),
  );
  const ROUTE_MAP_CODE: string = readSquashedAt(
    path.join(DASHBOARD_SRC, "Utils", "RouteMap.ts"),
  );
  const MONITORS_ROUTES_CODE: string = readSquashedAt(
    path.join(DASHBOARD_SRC, "Routes", "MonitorsRoutes.tsx"),
  );

  const MONITORS_ROUTE_PATH_BLOCK: string = ROUTE_MAP_CODE.slice(
    ROUTE_MAP_CODE.indexOf("export const MonitorsRoutePath"),
    ROUTE_MAP_CODE.indexOf(
      "};",
      ROUTE_MAP_CODE.indexOf("export const MonitorsRoutePath"),
    ),
  );

  const linkedPageKeys: Set<string> = new Set();

  for (const [, code] of getAllOverviewCode()) {
    for (const match of code.matchAll(/PageMap\.([A-Z_]+)/g)) {
      linkedPageKeys.add(match[1]!);
    }
  }

  test("the overview links to the monitor pages that do the work", () => {
    expect(Array.from(linkedPageKeys)).toEqual(
      expect.arrayContaining([
        "MONITOR_VIEW_SETTINGS",
        "MONITOR_VIEW_PROBES",
        "MONITOR_VIEW_CRITERIA",
        "MONITOR_VIEW_DOCUMENTATION",
        "MONITOR_VIEW_STATUS_TIMELINE",
        "MONITOR_VIEW_INCIDENTS",
        "MONITOR_VIEW_ALERTS",
        "MONITOR_VIEW_METRICS",
        "MONITOR_VIEW_OWNERS",
        "INCIDENT_VIEW",
        "ALERT_VIEW",
        "NETWORK_DEVICE_VIEW",
      ]),
    );
  });

  test("every page the overview links to exists", () => {
    for (const key of linkedPageKeys) {
      expect({
        key,
        inPageMap: PAGE_MAP_CODE.includes(`${key} = "${key}"`),
      }).toEqual({ key, inPageMap: true });
      expect({
        key,
        inRouteMap: ROUTE_MAP_CODE.includes(`[PageMap.${key}]: new Route(`),
      }).toEqual({ key, inRouteMap: true });
    }
  });

  test("every monitor sub-page the overview links to is a routed child of the monitor view", () => {
    for (const key of linkedPageKeys) {
      if (!key.startsWith("MONITOR_VIEW_")) {
        continue;
      }

      expect({
        key,
        hasPath: MONITORS_ROUTE_PATH_BLOCK.includes(`[PageMap.${key}]:`),
      }).toEqual({ key, hasPath: true });
      expect({
        key,
        routed: MONITORS_ROUTES_CODE.includes(`PageMap.${key}`),
      }).toEqual({ key, routed: true });
    }
  });
});

describe("Monitor overview dark mode", () => {
  /*
   * Dark mode is a stylesheet that remaps light utility classes
   * (Common/UI/Styles/Theme.css), not dark: variants. A class it does not
   * remap stays light in dark mode: a white card or a pale badge on a dark
   * page. Theme.css groups selectors inside :is(...), so this searches its
   * text rather than parsing it.
   */
  const THEME_CSS: string = fs.readFileSync(THEME_CSS_PATH, "utf8");

  /*
   * The whole variant chain is part of the token: Theme.css remaps
   * `lg:bg-white` only with a rule of its own, so it must never be read as
   * the bare `bg-white`. The lookbehind stops a match starting after a
   * colon, which is how a variant used to be dropped.
   */
  const COLOR_TOKEN: RegExp =
    /(?<![\w:-])((?:[a-z0-9-]+:)*(?:bg|text|border|ring|divide)-(?:white|black|transparent|(?:gray|slate|red|amber|yellow|emerald|green|sky|blue|indigo|orange|rose|purple|pink|teal|cyan|lime|violet|fuchsia|zinc|neutral|stone)-\d{2,3})(?:\/\d+)?)(?![\w-])/g;

  // Text on a solid fill, and the solid fills themselves, read the same in both themes.
  const SOLID_FILL: RegExp = /^(?:bg|text|border|ring)-[a-z]+-(?:500|600)$/;

  const IDENTIFIER_CHAR: RegExp = /[\w-]/;

  const TEMPLATE_COLOR_TOKEN: RegExp = /(bg|text|border|ring|divide)-\$\{/;

  const isRemapped: (token: string) => boolean = (token: string): boolean => {
    // Under any variant, a solid fill still reads the same in both themes.
    const utility: string = token.slice(token.lastIndexOf(":") + 1);

    if (utility === "text-white" || SOLID_FILL.test(utility)) {
      return true;
    }

    if (THEME_CSS.includes(`[class~="${token}"]`)) {
      return true;
    }

    const escapedClass: string = token
      .replace(/:/g, "\\:")
      .replace(/\//g, "\\/");
    let from: number = THEME_CSS.indexOf(`.${escapedClass}`);

    while (from !== -1) {
      const next: string = THEME_CSS[from + escapedClass.length + 1] || " ";

      // Followed by a non-identifier character, so bg-gray-50 is not bg-gray-500.
      if (!IDENTIFIER_CHAR.test(next)) {
        return true;
      }

      from = THEME_CSS.indexOf(`.${escapedClass}`, from + 1);
    }

    return false;
  };

  test("no module uses dark: variants or builds a colour class from a template", () => {
    for (const [moduleKey, code] of getAllOverviewCode()) {
      expect({ moduleKey, dark: code.includes("dark:") }).toEqual({
        moduleKey,
        dark: false,
      });
      expect({
        moduleKey,
        template: TEMPLATE_COLOR_TOKEN.test(code),
      }).toEqual({ moduleKey, template: false });
    }
  });

  test("every colour class the overview uses is remapped for dark mode", () => {
    const tokens: Set<string> = new Set();
    const unmapped: Array<string> = [];

    for (const [moduleKey, code] of getAllOverviewCode()) {
      for (const match of code.matchAll(COLOR_TOKEN)) {
        const token: string = match[1]!;
        tokens.add(token);

        if (!isRemapped(token)) {
          unmapped.push(`${moduleKey}: ${token}`);
        }
      }
    }

    // The walk found the overview's colours at all, so this is not vacuous.
    expect(Array.from(tokens)).toEqual(
      expect.arrayContaining([
        "bg-emerald-50",
        "text-red-700",
        "text-amber-700",
        "border-gray-200",
        "divide-gray-100",
      ]),
    );
    expect(unmapped).toEqual([]);
  });

  test("the guard itself tells a remapped class from one that is not", () => {
    expect(isRemapped("bg-gray-50")).toBe(true);
    expect(isRemapped("hover:bg-gray-50")).toBe(true);
    // A made-up shade no stylesheet will ever remap.
    expect(isRemapped("bg-gray-55")).toBe(false);
    expect(isRemapped("text-purple-950")).toBe(false);
    // Theme.css has no rule for these variants, only for the bare classes.
    expect(isRemapped("bg-white")).toBe(true);
    expect(isRemapped("lg:bg-white")).toBe(false);
    expect(isRemapped("md:bg-gray-50")).toBe(false);
  });

  test("the token walk keeps a class's whole variant chain", () => {
    const tokensIn: (code: string) => Array<string> = (
      code: string,
    ): Array<string> => {
      return Array.from(code.matchAll(COLOR_TOKEN)).map(
        (match: RegExpMatchArray) => {
          return match[1]!;
        },
      );
    };

    expect(
      tokensIn(
        'className="bg-white lg:bg-white sm:hover:text-gray-900 disabled:bg-gray-100 hover:bg-gray-50/50"',
      ),
    ).toEqual([
      "bg-white",
      "lg:bg-white",
      "sm:hover:text-gray-900",
      "disabled:bg-gray-100",
      "hover:bg-gray-50/50",
    ]);
  });
});

describe("Shared chart plot floor", () => {
  /*
   * ChartGroup's plot floor (min-h-48 under hideCard) is opt-in. The
   * overview's Response time card gets it through MetricView, whose panel
   * can grow. Dashboard chart widgets are a fixed height and clip what
   * overflows, so a floor there pushes the series controls (the chart's
   * only legend) and the x-axis out of the widget: they must not pass it.
   */
  const COMPONENTS_DIR: string = path.join(DASHBOARD_SRC, "Components");
  const METRIC_VIEW_CODE: string = readCodeAt(
    path.join(COMPONENTS_DIR, "Metrics", "MetricView.tsx"),
  );
  const METRIC_CHARTS_CODE: string = readCodeAt(
    path.join(COMPONENTS_DIR, "Metrics", "MetricCharts.tsx"),
  );

  test.each([
    ["DashboardChartComponent.tsx"],
    ["DashboardDataSourceChartComponent.tsx"],
  ])(
    "the dashboard widget %s renders its charts without the floor",
    (fileName: string) => {
      const code: string = readCodeAt(
        path.join(COMPONENTS_DIR, "Dashboard", "Components", fileName),
      );

      // The widget renders the hideCard charts this is about...
      expect(code).toContain("<MetricCharts");
      expect(code).toContain("hideCard={true}");
      // ...and never asks for the floor.
      expect(code).not.toContain("minPlotHeight");
    },
  );

  test("MetricView asks for the floor only for its growable hideCard panel", () => {
    expect(METRIC_VIEW_CODE).toContain(
      "hideCard={props.hideCardInCharts} minPlotHeight={props.hideCardInCharts}",
    );
    expect(countOccurrences(METRIC_VIEW_CODE, "minPlotHeight")).toBe(1);
  });

  test("MetricCharts hands the host's choice to ChartGroup", () => {
    expect(METRIC_CHARTS_CODE).toContain(
      "minPlotHeight?: boolean | undefined;",
    );
    expect(METRIC_CHARTS_CODE).toContain("minPlotHeight={props.minPlotHeight}");
  });
});

describe("Monitor overview pure modules", () => {
  /*
   * RouteMap and Navigation read window when they load, so a module that
   * imports them cannot be unit tested without a browser, and neither can
   * anything that imports it. These are the modules the Common tests import
   * directly.
   */
  const PURE_MODULES: Array<string> = [
    path.join(DASHBOARD_SRC, "Utils", "OverviewSection.ts"),
    path.join(MONITOR_COMPONENTS_DIR, "Overview", "MonitorOverviewTypes.ts"),
    path.join(MONITOR_COMPONENTS_DIR, "Overview", "MonitorOverviewSelect.ts"),
    path.join(MONITOR_COMPONENTS_DIR, "Overview", "MonitorOverviewInput.ts"),
  ];

  const WINDOW_AT_LOAD: RegExp = /from "[^"]*(?:RouteMap|Navigation)"/;

  test.each(
    PURE_MODULES.map((absolutePath: string) => {
      return [
        path.relative(DASHBOARD_SRC, absolutePath),
        absolutePath,
      ] as const;
    }),
  )(
    "%s imports neither RouteMap nor Navigation, directly or through the dashboard",
    (_label: string, absolutePath: string) => {
      const seen: Set<string> = new Set();
      const pending: Array<string> = [absolutePath];

      while (pending.length > 0) {
        const current: string = pending.pop()!;

        if (seen.has(current)) {
          continue;
        }

        seen.add(current);

        const code: string = readCodeAt(current);

        expect({
          module: path.relative(DASHBOARD_SRC, current),
          readsWindow: WINDOW_AT_LOAD.test(code),
        }).toEqual({
          module: path.relative(DASHBOARD_SRC, current),
          readsWindow: false,
        });

        for (const match of code.matchAll(IMPORT_SOURCE)) {
          const source: string = match[1]!;

          if (!source.startsWith(".")) {
            continue;
          }

          const base: string = path.resolve(path.dirname(current), source);

          for (const extension of [".ts", ".tsx"]) {
            if (fs.existsSync(`${base}${extension}`)) {
              pending.push(`${base}${extension}`);
            }
          }
        }
      }
    },
  );
});
