import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import { SpyInstance } from "jest-mock";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * ISSUE #6338 ON THE PUBLIC PAGE: EVERY WIDGET IS DRAWN EXACTLY AS BEFORE.
 *
 * /view-config now serves each widget only the settings its type is
 * served, and each variable only the fields its type is served
 * (Types/Dashboard/PublicDashboardServedSettings): a log chart, a trace
 * chart or table and a security events widget only their title, which is
 * all the page draws of them; every other widget the settings it has, and
 * no key it does not have; no variable its Query variable's query.
 *
 * Here the real public page draws a stored dashboard twice: from what
 * /view-config serves now, and from what it served before - every
 * setting and every field whole (servedWhole). The fake public API
 * answers /view-config the way the real route builds it, sent as JSON,
 * and every widget's read with data, so each widget draws its rows, its
 * numbers or its note. What the page draws, and every request it sends,
 * must be the same both times. A setting the page reads that is no longer
 * served would show as a difference.
 *
 * The clock is held still (only Date is faked), so a clock widget, a time
 * range and every request's window read the same both times.
 */

jest.setTimeout(240000);

const publicPostMock: MockFunction = getJestMockFunction();
const publicFetchMock: MockFunction = getJestMockFunction();

jest.mock("../../../../App/FeatureSet/PublicDashboard/src/Utils/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return publicPostMock(...args);
      },
      fetch: (...args: Array<any>) => {
        return publicFetchMock(...args);
      },
      getFriendlyErrorMessage: (err: Error) => {
        return err.message;
      },
    },
  };
});

import DashboardViewPage from "../../../../App/FeatureSet/PublicDashboard/src/Pages/DashboardView/DashboardViewPage";
import { DASHBOARD_WIDGET_FALLBACK_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardWidgetFallback";
import PublicDashboardViewConfig from "../../../Server/Utils/Dashboard/PublicDashboardViewConfig";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import DashboardComponentType, {
  DataSourceComponentTypes,
} from "../../../Types/Dashboard/DashboardComponentType";
import { DashboardVariableType } from "../../../Types/Dashboard/DashboardVariable";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import {
  PUBLIC_DASHBOARD_UNDRAWN_WIDGET_TYPES,
  PUBLIC_DASHBOARD_WIDGET_SETTINGS,
  PublicDashboardServedWidgetType,
  PublicDashboardWidgetSettings,
  isPublicDashboardUndrawnWidgetType,
} from "../../../Types/Dashboard/PublicDashboardServedSettings";
import { JSONObject } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import ObjectID from "../../../Types/ObjectID";
import { getDashboardWidgetSortColumns } from "../../../Utils/Dashboard/DashboardWidgetSorts";
import { widgetSettingsOf } from "../../Helpers/DashboardWidgetSettingsDeclared";
import { servedWhole } from "../../Helpers/PublicDashboardServedWhole";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";

const DASHBOARD_ID: ObjectID = new ObjectID(
  "d4d4d4d4-1111-4111-8111-d4d4d4d4d4d4",
);

const NOW: Date = new Date("2026-11-08T12:00:00.000Z");

const DASHBOARD_NAME: string = "Status board";

const NOT_AVAILABLE: string = "not available on public dashboards";

type Serve = (stored: unknown) => DashboardViewConfig | null;

const servedNow: Serve = (stored: unknown): DashboardViewConfig | null => {
  return PublicDashboardViewConfig.sanitize(stored as DashboardViewConfig);
};

let serve: Serve = servedNow;
let storedConfig: unknown = null;
let servedJson: string = "";
const sentRequests: Array<string> = [];

const COLOR: JSONObject = { _type: "Color", value: "#ef4444" };

/*
 * One row a list widget draws: the fields the lists read, whichever list
 * it is - a title, a name, a time, a state, a status, a cluster, a host.
 */
const ROW: JSONObject = {
  _id: "0f8fad5b-d9cb-469f-a165-70867728950e",
  title: "Checkout is down",
  name: "checkout-7d9f",
  createdAt: "2026-11-08T11:00:00.000Z",
  lastSeenAt: "2026-11-08T11:59:00.000Z",
  currentIncidentState: { name: "Investigating", color: COLOR },
  incidentSeverity: { name: "Critical", color: COLOR },
  currentAlertState: { name: "Firing", color: COLOR },
  alertSeverity: { name: "High", color: COLOR },
  currentMonitorStatus: {
    name: "Operational",
    color: COLOR,
    priority: 1,
    isOperationalState: true,
  },
  monitorType: "API",
  namespaceKey: "payments",
  phase: "Running",
  isReady: true,
  status: "running",
  state: "running",
  kubernetesClusterId: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  kubernetesCluster: { name: "prod-eu" },
  otelCollectorStatus: "connected",
  osType: "linux",
  osVersion: "22.04",
  cpuCores: 8,
  totalMemoryBytes: 17179869184,
};

// One log line a log stream draws, and one span a trace list draws.
const LOG_ROW: JSONObject = {
  time: "2026-11-08T11:58:00.000Z",
  severityText: "Error",
  body: "Payment declined",
  traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
  spanId: "00f067aa0ba902b7",
};

const SPAN_ROW: JSONObject = {
  name: "POST /checkout",
  startTime: "2026-11-08T11:58:00.000Z",
  durationUnixNano: 125000000,
  statusCode: 2,
  traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
  spanId: "00f067aa0ba902b7",
  kind: "SPAN_KIND_SERVER",
};

// The answer of the fake public API: data for every widget's read.
function respond(url: string, data: unknown): HTTPResponse<JSONObject> {
  if (url.includes("/view-config/")) {
    const served: DashboardViewConfig | null = serve(storedConfig);

    // Over the wire.
    servedJson = JSON.stringify({
      name: DASHBOARD_NAME,
      dashboardViewConfig: served
        ? JSONFunctions.serialize(served as unknown as JSONObject)
        : null,
    });

    return new HTTPResponse(200, JSON.parse(servedJson) as JSONObject, {});
  }

  sentRequests.push(`${url} ${JSON.stringify(data ?? null)}`);

  if (url.includes("/metrics-aggregate/")) {
    return new HTTPResponse(
      200,
      {
        data: [
          { timestamp: "2026-11-08T11:30:00.000Z", value: 42 },
          { timestamp: "2026-11-08T11:45:00.000Z", value: 64 },
        ],
      },
      {},
    );
  }

  if (url.includes("/metric-types/")) {
    return new HTTPResponse(
      200,
      { metricTypes: [{ name: "system.cpu.utilization", unit: "%" }] },
      {},
    );
  }

  if (url.includes("/attribute-values/")) {
    return new HTTPResponse(200, { values: ["prod", "staging"] }, {});
  }

  if (url.includes("/resource-list/")) {
    const row: JSONObject = url.endsWith("/log")
      ? LOG_ROW
      : url.endsWith("/span")
        ? SPAN_ROW
        : ROW;

    return new HTTPResponse(
      200,
      { data: [row], count: 1, skip: 0, limit: 10 },
      {},
    );
  }

  return new HTTPResponse(200, { data: [] }, {});
}

interface Drawn {
  // The page as drawn, ids React makes up and charts' sync names aside.
  html: string;
  // The words a visitor reads on the board.
  text: string;
  // Every request the page sent, in order, but /view-config.
  requests: Array<string>;
  // What /view-config sent.
  servedJson: string;
  // Widgets drawn as "This widget could not be shown".
  fallbacks: number;
}

/*
 * The page as drawn, with the names React makes up for each drawing - an
 * id (":r3:"), a table's column-width scope ("r3") - and a chart group's
 * random sync name set aside: they differ from one drawing to the next.
 */
function normalized(html: string): string {
  return html
    .replace(/:r[0-9a-z]+:/g, ":r:")
    .replace(/="r[0-9a-z]{1,4}"/g, '="r"')
    .replace(/syncid="[^"]*"/g, 'syncid=""');
}

// Waits until the page sends nothing more.
async function settle(): Promise<void> {
  let seen: number = -1;

  for (let round: number = 0; round < 60; round++) {
    await act(async () => {
      await new Promise((resolve: (value: unknown) => void) => {
        setTimeout(resolve, 25);
      });
    });

    if (round > 2 && seen === sentRequests.length) {
      return;
    }

    seen = sentRequests.length;
  }
}

async function drawPublicPage(stored: unknown, how: Serve): Promise<Drawn> {
  storedConfig = stored;
  serve = how;
  servedJson = "";
  sentRequests.length = 0;
  window.localStorage.clear();

  render(
    <MemoryRouter>
      <DashboardViewPage dashboardId={DASHBOARD_ID} />
    </MemoryRouter>,
  );

  await waitFor(() => {
    expect(screen.queryByText(DASHBOARD_NAME)).not.toBeNull();
  });

  await settle();

  const drawn: Drawn = {
    html: normalized(document.body.innerHTML),
    text: screen.getByTestId("dashboard-board").textContent || "",
    requests: [...sentRequests],
    servedJson: servedJson,
    fallbacks: screen.queryAllByTestId(DASHBOARD_WIDGET_FALLBACK_TEST_ID)
      .length,
  };

  cleanup();

  return drawn;
}

// The page drawn from what is served now, and from what was served before.
async function drawBothWays(
  stored: unknown,
): Promise<{ before: Drawn; now: Drawn }> {
  const before: Drawn = await drawPublicPage(stored, servedWhole);
  const now: Drawn = await drawPublicPage(stored, servedNow);

  return { before, now };
}

// Where two drawings first differ, and a little of each there.
function firstDifference(before: string, now: string): string | null {
  if (before === now) {
    return null;
  }

  let index: number = 0;

  while (index < before.length && before[index] === now[index]) {
    index++;
  }

  const from: number = Math.max(0, index - 160);

  return `at ${index}: before "${before.slice(from, index + 160)}" now "${now.slice(from, index + 160)}"`;
}

function expectDrawnAlike(
  label: string,
  drawn: { before: Drawn; now: Drawn },
): void {
  expect([label, drawn.now.requests]).toEqual([label, drawn.before.requests]);
  expect([label, drawn.now.text]).toEqual([label, drawn.before.text]);
  expect([label, firstDifference(drawn.before.html, drawn.now.html)]).toEqual(
    [label, null],
  );
}

function decisionOf(componentType: string): PublicDashboardWidgetSettings {
  return PUBLIC_DASHBOARD_WIDGET_SETTINGS[
    componentType as PublicDashboardServedWidgetType
  ];
}

/*
 * Every setting a type has, read from its declaration, its editor and its
 * sort - not from the table under test, so a setting it wrongly withholds
 * is still stored, and shows as a page drawn differently.
 */
function settingsOf(componentType: string): Array<string> {
  return widgetSettingsOf(componentType as DashboardComponentType);
}

const LABEL_ID: string = "e5e5e5e5-5555-4555-8555-e5e5e5e5e5e5";
const SLO_ID: string = "c3c3c3c3-3333-4333-8333-c3c3c3c3c3c3";

const VARIABLES: Array<JSONObject> = [
  {
    id: "cluster",
    name: "cluster",
    label: "Cluster",
    type: DashboardVariableType.TelemetryAttribute,
    attributeKey: "k8s.cluster.name",
    defaultValue: "prod",
    query: "SELECT DISTINCT cluster FROM internal_secret_clusters",
  },
  {
    id: "labels",
    name: "labels",
    label: "Team",
    type: DashboardVariableType.ProjectLabel,
    labelOptions: [{ label: "Payments", value: LABEL_ID }],
    isMultiSelect: true,
    selectedValues: [LABEL_ID],
  },
  {
    id: "region",
    name: "region",
    label: "Region",
    type: DashboardVariableType.Query,
    query: "SELECT region FROM internal_secret_accounts",
    defaultValue: "eu",
  },
  {
    id: "env",
    name: "env",
    label: "Environment",
    type: DashboardVariableType.CustomList,
    customListValues: "production,staging",
    selectedValue: "production",
    attributeKey: "internal_secret_attribute",
  },
  {
    id: "search",
    name: "search",
    label: "Search",
    type: DashboardVariableType.TextInput,
    defaultValue: "checkout",
    labelOptions: [{ label: "internal_secret_label", value: LABEL_ID }],
  },
];

// A saved metric query, as the chart, value, gauge and table widgets keep it.
function metricQuery(mark: string, metricName: string): JSONObject {
  return {
    metricAliasData: {
      metricVariable: "a",
      title: `${mark} query`,
      legend: `${mark} legend`,
    },
    metricQueryData: {
      filterData: {
        metricName: metricName,
        aggegationType: "Avg",
        attributes: { "k8s.cluster.name": "prod" },
      },
      groupByAttributeKeys: ["host.name"],
    },
  };
}

/*
 * A value for each setting a widget has, as its editor saves it: words a
 * visitor can read carry the mark, so a setting the page draws that went
 * missing shows on the page.
 */
function settingValue(
  componentType: string,
  setting: string,
  mark: string,
): unknown {
  switch (setting) {
    case "metricQueryConfig":
      return metricQuery(mark, "system.cpu.utilization");
    case "metricQueryConfigs":
      return [
        metricQuery(mark, "system.cpu.utilization"),
        metricQuery(`${mark} second`, "system.memory.usage"),
      ];
    case "metricFormulaConfigs":
      return [
        {
          metricAliasData: { metricVariable: "f", title: `${mark} formula` },
          metricFormulaData: { metricFormula: "a / 2" },
        },
      ];
    case "columns":
      return [
        {
          id: "c1",
          variable: "a",
          header: `${mark} latency`,
          kind: "Metric",
          metricName: "system.cpu.utilization",
          aggregation: "Avg",
          thresholds: { warning: 40, critical: 60 },
        },
        {
          id: "c2",
          variable: "b",
          header: `${mark} half`,
          kind: "Formula",
          formula: "a / 2",
        },
      ];
    case "groupByAttributes":
      return [{ key: "host.name", header: `${mark} host` }];
    case "groupByAttributeKeys":
      return ["host.name"];
    case "attributeFilters":
      return componentType === DashboardComponentType.Table
        ? { "deployment.environment": "production" }
        : { "url.host": "internal-secret.example.com" };
    case "chartType":
      return "Bar";
    case "reduce":
      return "Max";
    case "decimals":
      return 2;
    case "thresholdStyle":
      return "Background";
    case "warningThreshold":
      return 50;
    case "criticalThreshold":
      return 90;
    case "minValue":
      return 0;
    case "maxValue":
      return 100;
    case "trendDirection":
      return "HigherIsWorse";
    case "hideUnit":
      return true;
    case "timezone":
      return "Asia/Tokyo";
    case "clockFace":
      return "Digital";
    case "hourFormat":
      return "24 Hour";
    case "html":
      return `<p>${mark} html</p>`;
    case "css":
      return "p { color: teal; }";
    case "javascript":
      return "document.body.dataset.ready = 'yes';";
    case "maxRows":
      return 5;
    case "maxSites":
      return 10;
    case "limit":
      return 20;
    case "maxEvents":
      return 300;
    case "topLimit":
      return 5;
    case "viewMode":
      return componentType === DashboardComponentType.NetworkMap
        ? "list"
        : "list";
    case "sort": {
      const columns: Array<{ key: string }> =
        getDashboardWidgetSortColumns(componentType);

      return columns.length > 0 ? `${columns[0]!.key}:asc` : "col:c1:desc";
    }
    case "serviceLevelObjectiveId":
      return SLO_ID;
    case "serviceLevelObjectiveVariableId":
      return "cluster";
    case "labelVariableId":
      return "labels";
    case "labelIds":
      return [LABEL_ID];
    case "sloMetric":
      return "Sli";
    case "displayType":
      return "Tile";
    case "namespaces":
      return "payments";
    case "podPhases":
      return ["Running"];
    case "monitorTypes":
      return ["API"];
    case "sloStatuses":
      return ["Met"];
    case "severityFilter":
      return "Error";
    case "attributeFilterQuery":
      return 'k8s.namespace.name = "payments"';
    case "metric":
      return "p99Duration";
    case "groupByAttribute":
      return "enduser.id";
    case "color":
      return "#6366f1";
    case "colorsByGroup":
      return { "enduser.id=alice": "#10b981" };
    default:
      break;
  }

  if (setting.endsWith("Ids")) {
    return ["7c9e6679-7425-40de-944b-e07fc1f90ae7"];
  }

  if (
    setting.startsWith("is") ||
    setting.startsWith("show") ||
    setting.startsWith("allow") ||
    setting === "includeChildSpans"
  ) {
    return true;
  }

  return `${mark} ${setting}`;
}

/*
 * Every setting a widget type has - what the page draws carries the mark,
 * what it does not a secret - and settings it does not have, which a
 * script left there, holding secrets too.
 */
function everySetting(componentType: string, mark: string): JSONObject {
  const settings: JSONObject = {};
  const decision: PublicDashboardWidgetSettings = decisionOf(componentType);

  for (const setting of settingsOf(componentType)) {
    const value: unknown = settingValue(componentType, setting, mark);

    settings[setting] = (
      !decision.served.includes(setting) &&
      !Object.keys(decision.servedWhileOn || {}).includes(setting) &&
      typeof value === "string"
        ? `secret ${setting} ${value}`
        : value
    ) as JSONObject;
  }

  settings["notes"] = `secret notes of ${mark}`;
  settings["queryConfigs"] = [
    {
      metricQueryData: {
        filterData: { metricName: `secret.metric.${componentType}` },
      },
    },
  ];

  return settings;
}

function widgetOf(
  componentType: string,
  settings: JSONObject,
  top: number = 0,
): JSONObject {
  return {
    componentId: ObjectID.generate().toString(),
    componentType: componentType,
    topInDashboardUnits: top,
    leftInDashboardUnits: 0,
    widthInDashboardUnits: 12,
    heightInDashboardUnits: 4,
    arguments: settings,
  };
}

function dashboardOf(
  components: Array<JSONObject>,
  variables: Array<JSONObject> = VARIABLES,
): JSONObject {
  return {
    _type: "DashboardViewConfig",
    heightInDashboardUnits: 60,
    components: components,
    variables: variables,
  };
}

let consoleErrorSpy: SpyInstance<typeof console.error>;
let consoleWarnSpy: SpyInstance<typeof console.warn>;

beforeEach(() => {
  // Only the date is held still: timers run, so the page settles as it does.
  jest.useFakeTimers({
    now: NOW,
    doNotFake: [
      "hrtime",
      "nextTick",
      "performance",
      "queueMicrotask",
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "requestIdleCallback",
      "cancelIdleCallback",
      "setImmediate",
      "clearImmediate",
      "setInterval",
      "clearInterval",
      "setTimeout",
      "clearTimeout",
    ],
  });

  publicPostMock.mockImplementation((...args: Array<any>) => {
    return Promise.resolve(
      respond(String(args[0]?.url || ""), args[0]?.data),
    );
  });
  publicFetchMock.mockImplementation((...args: Array<any>) => {
    return Promise.resolve(
      respond(String(args[0]?.url || ""), args[0]?.data),
    );
  });

  consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {
    return undefined;
  });
  consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation(() => {
    return undefined;
  });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  jest.clearAllMocks();
  consoleErrorSpy.mockRestore();
  consoleWarnSpy.mockRestore();
});

describe.each([...PUBLIC_DASHBOARD_UNDRAWN_WIDGET_TYPES])(
  "%s, which a public dashboard cannot draw",
  (componentType: DashboardComponentType) => {
    test("draws its title and its note exactly as before, from its title alone", async () => {
      const title: string = `${componentType} title`;
      const settings: JSONObject = {
        ...everySetting(componentType, componentType),
        title: title,
      };

      const drawn: { before: Drawn; now: Drawn } = await drawBothWays(
        dashboardOf([widgetOf(componentType, settings)]),
      );

      expectDrawnAlike(componentType, drawn);

      // Its title, and its note, in its place.
      expect(drawn.now.text).toContain(title);
      expect(drawn.now.text).toContain(NOT_AVAILABLE);
      expect(drawn.now.fallbacks).toBe(0);

      // It asks for nothing: a public dashboard reads no logs, traces or events.
      expect(drawn.now.requests).toEqual(drawn.before.requests);

      // Before, every one of its settings was served; now none but its title.
      for (const setting of decisionOf(componentType).withheld) {
        expect([setting, drawn.before.servedJson.includes(`"${setting}"`)]).toEqual(
          [setting, true],
        );
        expect([setting, drawn.now.servedJson.includes(`"${setting}"`)]).toEqual(
          [setting, false],
        );
      }

      expect(drawn.before.servedJson).toContain("secret notes");
      expect(drawn.now.servedJson).not.toContain("secret");
      expect(drawn.now.servedJson).toContain(title);
    });
  },
);

// The setting a widget's heading, or its words, are read from, when it is not `title`.
const HEADING_SETTING: Record<string, string> = {
  [DashboardComponentType.Chart]: "chartTitle",
  [DashboardComponentType.Gauge]: "gaugeTitle",
  [DashboardComponentType.Table]: "tableTitle",
  [DashboardComponentType.Slo]: "widgetTitle",
  [DashboardComponentType.Clock]: "label",
  [DashboardComponentType.Text]: "text",
  [DashboardComponentType.Html]: "html",
};

describe("every widget the public page draws, from the settings its type is served", () => {
  const DRAWN_TYPES: Array<string> = Object.keys(
    PUBLIC_DASHBOARD_WIDGET_SETTINGS,
  ).filter((componentType: string): boolean => {
    return !isPublicDashboardUndrawnWidgetType(componentType);
  });

  test("covers every type but the Data Source widgets and those the page cannot draw", () => {
    expect([...DRAWN_TYPES].sort()).toEqual(
      Object.values(DashboardComponentType)
        .filter((componentType: DashboardComponentType): boolean => {
          return (
            !DataSourceComponentTypes.includes(componentType) &&
            !isPublicDashboardUndrawnWidgetType(componentType)
          );
        })
        .sort(),
    );
  });

  test.each(DRAWN_TYPES)(
    "%s draws exactly as before, and asks for exactly what it asked for",
    async (componentType: string) => {
      const drawn: { before: Drawn; now: Drawn } = await drawBothWays(
        dashboardOf([
          widgetOf(componentType, everySetting(componentType, componentType)),
        ]),
      );

      expectDrawnAlike(componentType, drawn);

      // Drawn, not "This widget could not be shown".
      expect([componentType, drawn.now.fallbacks]).toEqual([componentType, 0]);

      // Not vacuous: what it was set up to say, it says.
      const heading: string = HEADING_SETTING[componentType] || "title";
      const words: string = `${componentType} ${heading}`;

      expect([
        componentType,
        heading,
        componentType === DashboardComponentType.Html
          ? drawn.now.html.includes(words)
          : drawn.now.text.includes(words),
      ]).toEqual([componentType, heading, true]);

      // What no widget type has, which no board reads, is no longer served.
      expect(drawn.before.servedJson).toContain("secret notes");
      expect(drawn.now.servedJson).not.toContain("secret");
    },
  );

  test("an HTML widget with scripts off draws exactly as before, and its script is no longer served", async () => {
    const settings: JSONObject = {
      html: "<p>Deploys today</p>",
      css: "p { color: teal; }",
      javascript: "fetch('https://internal-secret.example.com/?token=s3cr3t')",
      allowScripts: false,
      allowForms: false,
      allowPopups: true,
    };

    const drawn: { before: Drawn; now: Drawn } = await drawBothWays(
      dashboardOf([widgetOf(DashboardComponentType.Html, settings)]),
    );

    expectDrawnAlike("Html, scripts off", drawn);
    expect(drawn.before.servedJson).toContain("s3cr3t");
    expect(drawn.now.servedJson).not.toContain("s3cr3t");
    // The page left the script out of the widget before, too.
    expect(drawn.before.html).not.toContain("s3cr3t");
  });

  /*
   * The one widget the page draws differently: an HTML widget whose only
   * content is a script that may not run. The page always left the script
   * out of the widget's document, so the frame was empty; now that it is
   * not served either, the widget says what it holds to draw: "No HTML
   * configured". Nothing a visitor could read changes.
   */
  test("an HTML widget whose only content is a script that may not run says it has no HTML to draw", async () => {
    const settings: JSONObject = {
      html: "",
      css: "",
      javascript: "fetch('https://internal-secret.example.com/?token=s3cr3t')",
      allowScripts: false,
    };

    const drawn: { before: Drawn; now: Drawn } = await drawBothWays(
      dashboardOf([widgetOf(DashboardComponentType.Html, settings)]),
    );

    expect(drawn.before.text).not.toContain("No HTML configured");
    expect(drawn.before.html).not.toContain("s3cr3t");
    expect(drawn.now.text).toContain("No HTML configured");
    expect(drawn.now.servedJson).not.toContain("s3cr3t");
    expect(drawn.now.requests).toEqual(drawn.before.requests);
  });
});

describe("the variables, from the fields each type of variable is served", () => {
  test("the toolbar draws every type of variable exactly as before, and the widgets filter by them alike, without a Query variable's query", async () => {
    const drawn: { before: Drawn; now: Drawn } = await drawBothWays(
      dashboardOf([
        widgetOf(
          DashboardComponentType.Chart,
          everySetting(DashboardComponentType.Chart, "Chart"),
        ),
        widgetOf(
          DashboardComponentType.MonitorList,
          everySetting(DashboardComponentType.MonitorList, "Monitors"),
          4,
        ),
        widgetOf(
          DashboardComponentType.Text,
          { text: "Status of {{env}} in {{region}}" },
          8,
        ),
      ]),
    );

    expectDrawnAlike("variables", drawn);

    // The toolbar shows every variable, each with its picker.
    for (const label of ["Cluster", "Team", "Region", "Environment", "Search"]) {
      expect([label, drawn.now.html.includes(`>${label}<`)]).toEqual([
        label,
        true,
      ]);
    }

    for (const choice of ["production", "staging", "Payments"]) {
      expect([choice, drawn.now.html.includes(choice)]).toEqual([choice, true]);
    }

    // The attribute's values were asked for, as before.
    expect(
      drawn.now.requests.some((request: string): boolean => {
        return request.includes("/attribute-values/");
      }),
    ).toBe(true);

    expect(drawn.before.servedJson).toContain("internal_secret_accounts");
    expect(drawn.now.servedJson).not.toContain("internal_secret");
  });
});

/*
 * PROPERTY: A SEEDED DASHBOARD IS DRAWN EXACTLY AS BEFORE, FROM WHAT IS
 * SERVED NOW, WHICH HOLDS NONE OF ITS SECRETS.
 *
 * Seeded dashboards of a few widgets of any type the page draws or cannot
 * draw, each with every setting its type has and some it does not, in
 * random places and with their settings now and then written as JSON
 * text, and the variables of every type.
 */
describe("property: a seeded dashboard is drawn exactly as before, from what is served now", () => {
  const TYPES: Array<string> = Object.keys(PUBLIC_DASHBOARD_WIDGET_SETTINGS);

  const generate: (random: SeededRandom, name: string) => JSONObject = (
    random: SeededRandom,
    name: string,
  ): JSONObject => {
    const components: Array<JSONObject> = [];
    const count: number = 1 + random(5);

    for (let index: number = 0; index < count; index++) {
      const componentType: string = TYPES[random(TYPES.length)]!;
      const settings: JSONObject = everySetting(
        componentType,
        `${name} ${index}`,
      );

      // Now and then a list drawn as a honeycomb, or a setting left out.
      if ("viewMode" in settings && random(2) === 0) {
        settings["viewMode"] = "honeycomb";
      }

      for (const key of Object.keys(settings)) {
        if (random(6) === 0) {
          delete settings[key];
        }
      }

      const widget: JSONObject = widgetOf(componentType, settings, index * 4);

      if (random(4) === 0) {
        widget["arguments"] = JSON.stringify(settings) as unknown as JSONObject;
      }

      components.push(widget);
    }

    return dashboardOf(
      components,
      VARIABLES.filter((): boolean => {
        return random(3) !== 0;
      }),
    );
  };

  test.each([6338, 1, 2, 3])("seed %i", async (seed: number) => {
    const random: SeededRandom = seededRandom(seed);

    for (let run: number = 0; run < 3; run++) {
      const stored: JSONObject = generate(random, `s${seed}r${run}`);
      const label: string = `seed ${seed}, dashboard ${run}`;
      const drawn: { before: Drawn; now: Drawn } = await drawBothWays(stored);

      expectDrawnAlike(label, drawn);
      expect([label, drawn.now.servedJson.includes("secret")]).toEqual([
        label,
        false,
      ]);
    }
  });
});
