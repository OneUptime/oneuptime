import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The SLO overview is a composition: a page, a data hook, and a card per
 * question. This App suite runs in plain Node with no renderer, so every way
 * of breaking that composition is silent — drop a card from the page and it
 * still compiles; add a second poll to a card and the page still works,
 * just with twice the requests; point the open-alerts card back at the old
 * fingerprint and the counts quietly stop matching the Alerts page. The
 * cards themselves are rendered in Common/Tests/App/Dashboard/SloOverview*.
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

const SLO_COMPONENTS_DIR: string = path.join(
  DASHBOARD_SRC,
  "Components",
  "Slo",
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

function resolveSloComponent(moduleName: string): string {
  for (const extension of [".tsx", ".ts"]) {
    const candidate: string = path.join(
      SLO_COMPONENTS_DIR,
      `${moduleName}${extension}`,
    );

    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(`Components/Slo/${moduleName} does not exist.`);
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

const INDEX_PATH: string = path.join(
  DASHBOARD_SRC,
  "Pages",
  "Slo",
  "View",
  "Index.tsx",
);
const INDEX_CODE: string = readCodeAt(INDEX_PATH);

/*
 * Every Components/Slo module the overview reaches: the page's imports, then
 * each module's own "./X" imports, transitively.
 */
function getOverviewModules(): Map<string, string> {
  const modules: Map<string, string> = new Map();
  const pending: Array<string> = [];

  const pageImports: RegExp =
    /from "\.\.\/\.\.\/\.\.\/Components\/Slo\/([A-Za-z]+)"/g;

  for (const match of INDEX_CODE.matchAll(pageImports)) {
    pending.push(match[1]!);
  }

  while (pending.length > 0) {
    const moduleName: string = pending.pop()!;

    if (modules.has(moduleName)) {
      continue;
    }

    const code: string = readCodeAt(resolveSloComponent(moduleName));
    modules.set(moduleName, code);

    for (const match of code.matchAll(/from "\.\/([A-Za-z]+)"/g)) {
      pending.push(match[1]!);
    }
  }

  return modules;
}

const OVERVIEW_MODULES: Map<string, string> = getOverviewModules();

function getModuleCode(moduleName: string): string {
  const code: string | undefined = OVERVIEW_MODULES.get(moduleName);

  if (code === undefined) {
    throw new Error(
      `The overview does not reach Components/Slo/${moduleName}.`,
    );
  }

  return code;
}

describe("SLO overview page composition", () => {
  test("mounts every section of the overview", () => {
    for (const component of [
      "SloNoticeBanner",
      "SloOverviewHero",
      "SloKpiStrip",
      "SloBudgetBurnDownCard",
      "SloFeed",
      "SloActiveBurnEventsCard",
      "SloBurnRateRulesSummaryCard",
      "SloOverviewGettingStartedCard",
      "CardModelDetail",
    ]) {
      expect({
        component,
        mounted: INDEX_CODE.includes(`<${component}`),
      }).toEqual({ component, mounted: true });
    }
  });

  test("omits configuration and monitors cards while retaining the monitor count and setup flow", () => {
    for (const component of [
      "SloConfigurationSummaryCard",
      "SloMonitorsSummaryCard",
    ]) {
      expect(INDEX_CODE).not.toContain(component);
      expect(OVERVIEW_MODULES.has(component)).toBe(false);
    }

    // The concise monitor count and the new-SLO setup flow still belong here.
    expect(INDEX_CODE).toMatch(
      /<SloOverviewHero[^>]*monitorCount=\{monitorIds\.length\}/,
    );
    expect(INDEX_CODE).toContain("<SloOverviewGettingStartedCard");
  });

  test("keeps the notice banner's pinned props", () => {
    expect(INDEX_CODE).toContain(
      "<SloNoticeBanner sloId={modelId} refreshToggle={bannerRefreshCount.toString()} />",
    );
  });

  test("first load mirrors the page: the event skeleton with four stat cells", () => {
    expect(INDEX_CODE).toContain(
      '<EventOverviewSkeleton statCount={4} loadingText="Loading SLO" />',
    );
  });

  test("lays out a two-thirds main column beside a one-third sidebar, in reading order", () => {
    const order: Array<string> = [
      "<SloOverviewHero",
      "<SloKpiStrip",
      "xl:grid-cols-3",
      "xl:col-span-2",
      "<SloBudgetBurnDownCard",
      "<SloFeed",
      "<CardModelDetail",
      "<SloActiveBurnEventsCard",
      "<SloBurnRateRulesSummaryCard",
    ];

    const positions: Array<number> = order.map((needle: string) => {
      return INDEX_CODE.indexOf(needle);
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
  });

  test("a new SLO gets the getting-started card instead of the numbers", () => {
    expect(INDEX_CODE).toContain(
      "const isGettingStarted: boolean = monitorIds.length === 0 && data.monitorRuleCount === 0;",
    );
    expect(INDEX_CODE).toMatch(
      /\{isGettingStarted \? \( <><\/> \) : \( <SloKpiStrip/,
    );
    expect(INDEX_CODE).toMatch(
      /\{isGettingStarted \? \( <SloOverviewGettingStartedCard[^]*?\) : \( <SloBudgetBurnDownCard/,
    );
  });

  test("the banner waits for the row, and steps aside for the getting-started card unless measurement is off", () => {
    expect(INDEX_CODE).toContain(
      'if (!data.hasLoaded) { return <EventOverviewSkeleton statCount={4} loadingText="Loading SLO" />; }',
    );
    expect(INDEX_CODE).toContain(
      "const showBanner: boolean = !isGettingStarted || slo.isEnabled === false || slo.isArchived === true;",
    );
    expect(INDEX_CODE).toContain("{showBanner ? banner : <></>}");
  });

  test("the details card edits only name, description and labels, from the shared form fields", () => {
    expect(INDEX_CODE).toContain(
      'import { getSloDetailsFormFields } from "../SloFormFields";',
    );
    expect(INDEX_CODE).toContain("formFields={getSloDetailsFormFields()}");

    const detailsCard: string = INDEX_CODE.slice(
      INDEX_CODE.indexOf("<CardModelDetail"),
    );
    const columns: Array<string> = Array.from(
      detailsCard.matchAll(/field: \{ ([A-Za-z]+): /g),
    ).map((match: RegExpMatchArray) => {
      return match[1]!;
    });

    expect(columns).toEqual(["name", "description", "labels"]);
  });
});

describe("SLO overview data flow", () => {
  test("the walk reaches the data hook and every card", () => {
    expect(Array.from(OVERVIEW_MODULES.keys()).sort()).toEqual(
      expect.arrayContaining([
        "SloActiveBurnEventsCard",
        "SloBudgetBar",
        "SloBudgetBurnDownCard",
        "SloBurnRateRulesSummaryCard",
        "SloKpiStrip",
        "SloOverviewGettingStartedCard",
        "SloOverviewHero",
        "useSloHistorySeries",
        "useSloOverviewData",
      ]),
    );
  });

  test("there is exactly one poll, in the data hook — no card runs its own timer", () => {
    const polls: Array<string> = [];

    for (const [moduleName, code] of OVERVIEW_MODULES) {
      for (
        let index: number = 0;
        index < countOccurrences(code, "setInterval(");
        index++
      ) {
        polls.push(moduleName);
      }
    }

    expect(INDEX_CODE).not.toContain("setInterval(");
    expect(polls).toEqual(["useSloOverviewData"]);
  });

  test("the SLO row is fetched once for the whole page", () => {
    const fetchers: Array<string> = [];

    for (const [moduleName, code] of OVERVIEW_MODULES) {
      if (code.includes("ModelAPI.getItem<ServiceLevelObjective>")) {
        fetchers.push(moduleName);
      }
    }

    /*
     * The notice banner is the one sanctioned exception: every SLO sub-page
     * mounts it with only { sloId, refreshToggle }, so it reads its own row.
     * The overview keeps it off the poll — its toggle is the notice
     * fingerprint counter, never the poll's refresh count.
     */
    expect(
      fetchers.filter((moduleName: string) => {
        return moduleName !== "SloNoticeBanner";
      }),
    ).toEqual(["useSloOverviewData"]);
    expect(INDEX_CODE).not.toContain("refreshToggle={data.refreshCount");
    expect(INDEX_CODE).not.toContain("ModelAPI.");
  });

  test("the burn-down refreshes on evaluation and open events on the poll", () => {
    expect(INDEX_CODE).toMatch(
      /<SloBudgetBurnDownCard sloId=\{modelId\} slo=\{slo\} refreshToken=\{ slo\.lastEvaluatedAt/,
    );
    expect(INDEX_CODE).toMatch(
      /<SloActiveBurnEventsCard sloId=\{modelId\} refreshToken=\{data\.refreshCount\} \/>/,
    );
  });

  test("burn rate rules are loaded once and shared by the KPI strip and the rules card", () => {
    expect(INDEX_CODE).toContain("rules={data.burnRateRules}");
    expect(INDEX_CODE).toContain(
      "lowestEnabledBurnRateThreshold={getLowestBurnRateThreshold(",
    );

    for (const [moduleName, code] of OVERVIEW_MODULES) {
      if (moduleName === "useSloOverviewData") {
        continue;
      }

      expect({
        moduleName,
        fetchesRules: code.includes(
          "ModelAPI.getList<ServiceLevelObjectiveBurnRateRule>",
        ),
      }).toEqual({ moduleName, fetchesRules: false });
    }
  });

  test("open alerts and incidents are found through the SLO affected-resource relation", () => {
    const code: string = getModuleCode("SloActiveBurnEventsCard");

    expect(code).toContain(
      "serviceLevelObjectives: new Includes([data.sloId])",
    );
    expect(code).toContain(
      "currentIncidentStateId: new Includes(data.unresolvedStateIds)",
    );
    expect(code).toContain(
      "currentAlertStateId: new Includes(data.unresolvedStateIds)",
    );
    expect(code).toContain(
      "IncidentStateUtil.getUnresolvedIncidentStates(projectId)",
    );
    expect(code).toContain(
      "AlertStateUtil.getUnresolvedAlertStates(projectId)",
    );
    expect(code).not.toContain("seriesFingerprint");
  });

  test("history is read through the aggregate endpoint, averaged, oldest first", () => {
    const code: string = getModuleCode("useSloHistorySeries");

    expect(code).toContain("AnalyticsModelAPI.aggregate<SloHistory>(");
    expect(code).toContain("aggregationType: AggregationType.Avg");
    expect(code).toContain("sort: { bucketStart: SortOrder.Ascending, }");
    expect(code).toContain("const value: number = Number(row.value);");
    expect(code).not.toContain("AnalyticsModelAPI.getList");
  });

  test("no overview module reads the deprecated monitorLabels column", () => {
    expect(INDEX_CODE).not.toContain("monitorLabels");

    for (const [moduleName, code] of OVERVIEW_MODULES) {
      expect({
        moduleName,
        readsMonitorLabels: code.includes("monitorLabels"),
      }).toEqual({ moduleName, readsMonitorLabels: false });
    }
  });
});

describe("SLO overview links", () => {
  /*
   * The route registries are squashed but NOT comment-stripped: their route
   * strings contain "/*" wildcards, which the naive stripper above reads as a
   * block comment opening and swallows every registration up to the next
   * "*\/" — so a real registration would look missing.
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
  const SLO_ROUTES_CODE: string = readSquashedAt(
    path.join(DASHBOARD_SRC, "Routes", "SloRoutes.tsx"),
  );

  const SLO_ROUTE_PATH_BLOCK: string = ROUTE_MAP_CODE.slice(
    ROUTE_MAP_CODE.indexOf("export const SloRoutePath"),
    ROUTE_MAP_CODE.indexOf(
      "};",
      ROUTE_MAP_CODE.indexOf("export const SloRoutePath"),
    ),
  );

  const linkedPageKeys: Set<string> = new Set();

  for (const code of OVERVIEW_MODULES.values()) {
    for (const match of code.matchAll(/PageMap\.([A-Z_]+)/g)) {
      linkedPageKeys.add(match[1]!);
    }
  }

  test("the overview links to the SLO pages that do the work", () => {
    expect(Array.from(linkedPageKeys)).toEqual(
      expect.arrayContaining([
        "SLO_VIEW_MONITORS",
        "SLO_VIEW_MONITOR_RULES",
        "SLO_VIEW_BURN_RATE_RULES",
        "SLO_VIEW_METRICS",
        "SLO_VIEW_SETTINGS",
        "SLO_VIEW_OWNERS",
        "SLO_VIEW_ALERTS",
        "SLO_VIEW_INCIDENTS",
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

  test("every SLO sub-page the overview links to is a routed child of the SLO view", () => {
    for (const key of linkedPageKeys) {
      if (!key.startsWith("SLO_VIEW_")) {
        continue;
      }

      expect({
        key,
        hasPath: SLO_ROUTE_PATH_BLOCK.includes(`[PageMap.${key}]:`),
      }).toEqual({ key, hasPath: true });
      expect({
        key,
        routed: SLO_ROUTES_CODE.includes(`PageMap.${key}`),
      }).toEqual({
        key,
        routed: true,
      });
    }
  });
});
