import {
  APIRequestContext,
  Browser,
  Page,
  expect,
  test,
} from "@playwright/test";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import ObjectID from "Common/Types/ObjectID";
import Faker from "Common/Utils/Faker";
import { registerAndCreateProject } from "./Helpers/ProductOnboarding";
import {
  createItem,
  deleteItem,
  JSONish,
  toId,
} from "./Helpers/MonitorAlerting";
import { serialize } from "./Helpers/Serialize";
import { publicPost, publicPostStatus } from "./Helpers/StatusPagePublic";

/*
 * SLO widgets on a public dashboard: project -> SLO -> public dashboard ->
 * anonymous visitor.
 *
 * The point of this spec is the negative half. It is easy to make an
 * unauthenticated endpoint return the right row and much easier to make it
 * return more than the row: the SLO widget publishes an SLO's headline
 * numbers, and its definition — description, bound monitors, labels, query
 * config, evaluation schedule — must stay behind the session. So every read
 * below asserts both what came back AND what did not.
 *
 * A second SLO is created and deliberately left off the dashboard. Nothing on
 * the public surface may be able to reach it: not by asking for it by id, not
 * by widening the query, not by pointing a componentId at it.
 *
 * Anti-flake notes:
 * - every read goes through a request context with no session cookies, since
 *   a public endpoint that only answers its own project's session is broken
 *   and a same-session request would never catch that
 * - names are run-unique so a re-run never collides with leftover rows
 * - nothing asserts an EVALUATED number. The SLO evaluation worker runs on
 *   its own schedule and will not have touched a seconds-old SLO, so the
 *   state columns are legitimately null and the history series legitimately
 *   empty. The assertions are about which FIELDS and which ROWS are served.
 * - chromium only: this is server behaviour, not a rendering engine.
 */

test.describe.configure({ mode: "serial", retries: 1 });

/** An SLO id that exists in no project, for the forged-query assertions. */
const FORGED_SLO_ID: string = "00000000-0000-4000-8000-000000000000";

/** Exactly the fields the SLO widget renders. */
const PUBLISHED_FIELDS: Array<string> = [
  "name",
  "targetPercentage",
  "currentSliPercentage",
  "errorBudgetRemainingPercentage",
  "errorBudgetRemainingSeconds",
  "currentBurnRate",
  "sloStatus",
];

/*
 * Columns that describe HOW the SLO is defined rather than how it is doing.
 * None of these may ever appear in a public response.
 */
const PRIVATE_FIELDS: Array<string> = [
  "description",
  "slug",
  "monitors",
  "monitorLabels",
  "autoAddedMonitors",
  "downtimeMonitorStatuses",
  "labels",
  "metricQueryConfig",
  "sliType",
  "multiMonitorMode",
  "windowType",
  "windowDays",
  "timezone",
  "atRiskThresholdPercentage",
  "errorBudgetTotalSeconds",
  "lastEvaluatedAt",
  "nextEvaluationAt",
  "createdByUserId",
];

type CreateSloFunction = (data: {
  page: Page;
  projectId: string;
  name: string;
}) => Promise<string>;

const createSlo: CreateSloFunction = async (data: {
  page: Page;
  projectId: string;
  name: string;
}): Promise<string> => {
  const slo: JSONish = await createItem({
    page: data.page,
    projectId: data.projectId,
    path: "/api/service-level-objective",
    item: {
      name: data.name,
      // Deliberately distinctive: the negative assertions search for it.
      description: `PRIVATE-DEFINITION-${data.name}`,
      projectId: data.projectId,
      sliType: "Monitor Uptime",
      targetPercentage: 99.9,
      windowType: "Rolling",
      windowDays: 30,
      atRiskThresholdPercentage: 20,
      multiMonitorMode: "Any Monitor Down",
    },
  });

  const sloId: string = toId(slo["_id"]);
  expect(sloId, `SLO ${data.name} should have been created`).not.toBe("");
  return sloId;
};

interface SloWidget {
  componentId: string;
  component: JSONish;
}

type BuildSloWidgetFunction = (data: {
  sloId: string;
  displayType: "Tile" | "Chart";
  topInDashboardUnits: number;
  widgetTitle: string;
}) => SloWidget;

const buildSloWidget: BuildSloWidgetFunction = (data: {
  sloId: string;
  displayType: "Tile" | "Chart";
  topInDashboardUnits: number;
  widgetTitle: string;
}): SloWidget => {
  const componentId: string = crypto.randomUUID();

  return {
    componentId,
    component: {
      _type: "DashboardComponent",
      componentId,
      componentType: "Slo",
      topInDashboardUnits: data.topInDashboardUnits,
      leftInDashboardUnits: 0,
      widthInDashboardUnits: 3,
      heightInDashboardUnits: 3,
      minWidthInDashboardUnits: 2,
      minHeightInDashboardUnits: 2,
      arguments: {
        serviceLevelObjectiveId: data.sloId,
        sloMetric: "Sli",
        displayType: data.displayType,
        widgetTitle: data.widgetTitle,
      },
    },
  };
};

type SloHistoryAggregateByFunction = (data: {
  startDate: Date;
  endDate: Date;
}) => JSONish;

/*
 * The exact body SloWidgetData.aggregateSloHistory posts — the full
 * aggregateBy the chart builds, run through serialize (a faithful stand-in for
 * JSONFunctions.serialize; see ./Helpers/Serialize), so the timestamps travel
 * as `{_type: "DateTime", value: ...}` rather than as bare ISO strings.
 *
 * Hand-rolling a simpler shape here would exercise a wire format nothing in
 * the product actually emits, and this spec is the only place the real one
 * meets a real server.
 */
const sloHistoryAggregateBy: SloHistoryAggregateByFunction = (data: {
  startDate: Date;
  endDate: Date;
}): JSONish => {
  return serialize({
    /*
     * The real client sends its own query alongside the window. The server
     * discards it and rebuilds from the stored widget, so this one names an
     * SLO that does not exist — if it were ever honoured, the request would
     * fail loudly rather than quietly return someone else's series.
     */
    query: {
      sloId: new ObjectID(FORGED_SLO_ID),
      metricName: "burn.rate",
      bucketStart: new InBetween<Date>(data.startDate, data.endDate),
    },
    aggregationType: "Avg",
    aggregateColumnName: "value",
    aggregationTimestampColumnName: "bucketStart",
    aggregationInterval: "FiveMinutes",
    startTimestamp: data.startDate,
    endTimestamp: data.endDate,
    sort: { bucketStart: "Ascending" },
    limit: 10000,
    skip: 0,
  } as JSONish) as JSONish;
};

type ExpectNoPrivateFieldsFunction = (data: {
  payload: JSONish | Array<JSONish>;
  privateDescription: string;
  label: string;
}) => void;

const expectNoPrivateFields: ExpectNoPrivateFieldsFunction = (data: {
  payload: JSONish | Array<JSONish>;
  privateDescription: string;
  label: string;
}): void => {
  const serialized: string = JSON.stringify(data.payload);

  for (const privateField of PRIVATE_FIELDS) {
    expect(
      serialized.includes(`"${privateField}"`),
      `${data.label} must not carry the SLO's ${privateField}`,
    ).toBe(false);
  }

  expect(
    serialized.includes(data.privateDescription),
    `${data.label} must not carry the SLO's description`,
  ).toBe(false);
};

test.describe("SLO widgets on a public dashboard", () => {
  test.skip(({ browserName }: { browserName: string }) => {
    return browserName !== "chromium";
  }, "server behaviour, one engine is enough");

  test("publishes an SLO's numbers to an anonymous visitor and nothing else", async ({
    page,
    browser,
  }: {
    page: Page;
    browser: Browser;
  }) => {
    test.setTimeout(600000);

    const unique: string = Faker.generateName().toString().replace(/\s/g, "-");

    const projectId: string = await registerAndCreateProject({
      page,
      projectNamePrefix: "SLO Public Dashboard E2E",
    });

    // The SLO the dashboard publishes.
    const publishedSloName: string = `Published SLO ${unique}`;
    const publishedSloId: string = await createSlo({
      page,
      projectId,
      name: publishedSloName,
    });

    /*
     * A second SLO in the same project that no widget points at. It is the
     * control: the public surface must be unable to reach it by any means.
     */
    const hiddenSloName: string = `Hidden SLO ${unique}`;
    const hiddenSloId: string = await createSlo({
      page,
      projectId,
      name: hiddenSloName,
    });

    const tileWidget: SloWidget = buildSloWidget({
      sloId: publishedSloId,
      displayType: "Tile",
      topInDashboardUnits: 0,
      widgetTitle: `Tile ${unique}`,
    });
    const chartWidget: SloWidget = buildSloWidget({
      sloId: publishedSloId,
      displayType: "Chart",
      topInDashboardUnits: 4,
      widgetTitle: `Chart ${unique}`,
    });

    const dashboard: JSONish = await createItem({
      page,
      projectId,
      path: "/api/dashboard",
      item: {
        name: `SLO Dashboard ${unique}`,
        description: "Created by SloPublicDashboard.spec.ts",
        projectId,
        isPublicDashboard: true,
        dashboardViewConfig: {
          _type: "DashboardViewConfig",
          heightInDashboardUnits: 24,
          components: [tileWidget.component, chartWidget.component],
          variables: [],
        },
      },
    });

    const dashboardId: string = toId(dashboard["_id"]);
    expect(dashboardId, "dashboard should have been created").not.toBe("");

    // Everything below runs with no session cookies at all.
    const anonymous: APIRequestContext = (await browser.newContext()).request;

    // ── the config the viewer's page renders from ────────────────────────
    const viewConfigResponse: JSONish = await publicPost({
      request: anonymous,
      path: `/public-dashboard-api/view-config/${dashboardId}`,
    });

    const serializedViewConfig: string = JSON.stringify(
      viewConfigResponse["dashboardViewConfig"],
    );

    /*
     * The SLO widgets must survive the anonymous view-config sanitizer — the
     * external Data Source widgets are stripped there, and an over-broad
     * strip would silently take these with them and leave a blank page.
     */
    expect(
      serializedViewConfig.includes(tileWidget.componentId),
      "the Tile SLO widget must survive into the anonymous view config",
    ).toBe(true);
    expect(
      serializedViewConfig.includes(chartWidget.componentId),
      "the Chart SLO widget must survive into the anonymous view config",
    ).toBe(true);

    // ── the SLO's current numbers ───────────────────────────────────────
    const listResponse: JSONish = await publicPost({
      request: anonymous,
      path: `/public-dashboard-api/resource-list/${dashboardId}/slo`,
      body: { componentId: tileWidget.componentId },
    });

    const rows: Array<JSONish> = (listResponse["data"] || []) as Array<JSONish>;
    expect(rows.length, "the widget's SLO should be served").toBe(1);

    const row: JSONish = rows[0]!;
    expect(row["name"]).toBe(publishedSloName);
    expect(Number(row["targetPercentage"])).toBe(99.9);

    /*
     * The exact assertion: every key that came back is one of the seven the
     * widget draws (plus the _id every list response carries). The state
     * columns are legitimately null on a seconds-old SLO, so their VALUES
     * are not asserted — their presence is not what matters, the absence of
     * everything else is.
     */
    for (const returnedField of Object.keys(row)) {
      expect(
        [...PUBLISHED_FIELDS, "_id"].includes(returnedField),
        `the public SLO row must not carry ${returnedField}`,
      ).toBe(true);
    }
    expectNoPrivateFields({
      payload: rows,
      privateDescription: `PRIVATE-DEFINITION-${publishedSloName}`,
      label: "the public SLO row",
    });

    // ── the series behind them ──────────────────────────────────────────
    const endDate: Date = new Date();
    const startDate: Date = new Date(endDate.getTime() - 60 * 60 * 1000);

    const historyResponse: JSONish = await publicPost({
      request: anonymous,
      path: `/public-dashboard-api/slo-history-aggregate/${dashboardId}`,
      body: {
        componentId: chartWidget.componentId,
        aggregateBy: sloHistoryAggregateBy({ startDate, endDate }),
      },
    });

    /*
     * A seconds-old SLO has no history yet, so the only safe assertion is
     * the SHAPE: an aggregation that ran and returned a series (usually
     * empty), rather than an error.
     */
    expect(
      Array.isArray(historyResponse["data"]),
      "the history endpoint should return a series",
    ).toBe(true);

    // ── the machine-readable overview ───────────────────────────────────
    const overview: JSONish = await publicPost({
      request: anonymous,
      path: `/public-dashboard-api/overview/${dashboardId}`,
    });

    /*
     * The summaries are what a crawler reads via llms.txt. An SLO widget
     * stores its heading under `widgetTitle`, so a summary builder that only
     * knows `chartTitle`/`title` would describe it as an untitled "Slo".
     */
    const summaries: Array<JSONish> = (overview["components"] ||
      []) as Array<JSONish>;
    const sloSummaries: Array<JSONish> = summaries.filter(
      (summary: JSONish) => {
        return summary["componentType"] === "Slo";
      },
    );

    expect(sloSummaries.length, "both SLO widgets should be summarised").toBe(
      2,
    );
    expect(
      sloSummaries.map((summary: JSONish) => {
        return summary["title"];
      }),
      "the overview should carry each SLO widget's title",
    ).toEqual(expect.arrayContaining([`Tile ${unique}`, `Chart ${unique}`]));
    /*
     * The summaries are derived from the stored config, so a description
     * check here could not fail. What CAN regress is the shape: assert each
     * summary is confined to its declared keys, so a future field added to
     * the builder has to be considered rather than shipped by default.
     */
    for (const summary of sloSummaries) {
      for (const key of Object.keys(summary)) {
        expect(
          [
            "componentType",
            "title",
            "description",
            "text",
            "metricNames",
          ].includes(key),
          `the overview summary must not carry ${key}`,
        ).toBe(true);
      }
    }

    // ── the SLO the dashboard does not show ─────────────────────────────
    const forgedList: JSONish = await publicPost({
      request: anonymous,
      path: `/public-dashboard-api/resource-list/${dashboardId}/slo`,
      body: {
        componentId: tileWidget.componentId,
        query: { _id: hiddenSloId },
        select: { description: true, monitors: true },
        limit: 100,
      },
    });

    /*
     * The forged query is discarded rather than refused, so the assertion is
     * that the read landed on the widget's own SLO anyway — and that the
     * forged `select` did not widen the projection. The description checked
     * for is the PUBLISHED SLO's: that is the one the server actually holds
     * a row for, so it is the one a widened select would leak.
     */
    const forgedRows: Array<JSONish> = (forgedList["data"] ||
      []) as Array<JSONish>;
    expect(forgedRows.length, "a forged query must not widen the read").toBe(1);
    expect(
      forgedRows[0]!["name"],
      "a forged _id must not redirect the read",
    ).toBe(publishedSloName);
    expect(
      forgedRows[0]!["name"],
      "a forged _id must not reach the SLO the dashboard does not show",
    ).not.toBe(hiddenSloName);
    expectNoPrivateFields({
      payload: forgedRows,
      privateDescription: `PRIVATE-DEFINITION-${publishedSloName}`,
      label: "a forged public SLO read",
    });

    /*
     * The two refusals below share their route, body and request context with
     * the successful history read above — only the componentId differs. That
     * request is their positive control: a 4xx here cannot be a typo'd path
     * or a missing dashboard id, because the same path just answered 200.
     */

    // A Tile widget publishes no series.
    const tileHistoryStatus: number = await publicPostStatus({
      request: anonymous,
      path: `/public-dashboard-api/slo-history-aggregate/${dashboardId}`,
      body: {
        componentId: tileWidget.componentId,
        aggregateBy: sloHistoryAggregateBy({ startDate, endDate }),
      },
    });

    expect(tileHistoryStatus, "a Tile widget must not serve SLO history").toBe(
      400,
    );

    // A componentId that is not a widget on this dashboard.
    const forgedComponentStatus: number = await publicPostStatus({
      request: anonymous,
      path: `/public-dashboard-api/slo-history-aggregate/${dashboardId}`,
      body: {
        componentId: crypto.randomUUID(),
        aggregateBy: sloHistoryAggregateBy({ startDate, endDate }),
      },
    });

    expect(
      forgedComponentStatus,
      "an unknown componentId must be refused",
    ).toBe(400);
  });

  test("does not serve SLO data from a dashboard that is not public", async ({
    page,
    browser,
  }: {
    page: Page;
    browser: Browser;
  }) => {
    test.setTimeout(600000);

    const unique: string = Faker.generateName().toString().replace(/\s/g, "-");

    const projectId: string = await registerAndCreateProject({
      page,
      projectNamePrefix: "SLO Private Dashboard E2E",
    });

    const sloId: string = await createSlo({
      page,
      projectId,
      name: `Private SLO ${unique}`,
    });

    const widget: SloWidget = buildSloWidget({
      sloId,
      displayType: "Chart",
      topInDashboardUnits: 0,
      widgetTitle: `Private ${unique}`,
    });

    const dashboard: JSONish = await createItem({
      page,
      projectId,
      path: "/api/dashboard",
      item: {
        name: `Private SLO Dashboard ${unique}`,
        description: "Created by SloPublicDashboard.spec.ts",
        projectId,
        isPublicDashboard: false,
        dashboardViewConfig: {
          _type: "DashboardViewConfig",
          heightInDashboardUnits: 24,
          components: [widget.component],
          variables: [],
        },
      },
    });

    const dashboardId: string = toId(dashboard["_id"]);
    expect(dashboardId, "dashboard should have been created").not.toBe("");

    const anonymous: APIRequestContext = (await browser.newContext()).request;
    const endDate: Date = new Date();
    const startDate: Date = new Date(endDate.getTime() - 60 * 60 * 1000);

    const listStatus: number = await publicPostStatus({
      request: anonymous,
      path: `/public-dashboard-api/resource-list/${dashboardId}/slo`,
      body: { componentId: widget.componentId },
    });
    const historyStatus: number = await publicPostStatus({
      request: anonymous,
      path: `/public-dashboard-api/slo-history-aggregate/${dashboardId}`,
      body: {
        componentId: widget.componentId,
        aggregateBy: sloHistoryAggregateBy({ startDate, endDate }),
      },
    });

    /*
     * The private dashboard has served its purpose: its anonymous reads are
     * already captured above. Delete it before building the control, because
     * on a billing-enabled (SaaS) run the project is on the Free plan, which
     * caps a project at one dashboard — and that count excludes soft-deleted
     * rows, so removing this one frees the slot for the control below.
     */
    await deleteItem({
      page,
      projectId,
      path: "/api/dashboard",
      id: dashboardId,
    });

    /*
     * A refusal only means something if the same request would have
     * SUCCEEDED against a public dashboard — otherwise a typo'd route or an
     * empty dashboard id 404s and these assertions pass while proving
     * nothing. So build the identical dashboard with isPublicDashboard set
     * and issue both requests against it.
     *
     * A second dashboard (built after deleting the first) rather than flipping
     * this one: `isPublicDashboard` is `create: PlanType.Free` but
     * `update: PlanType.Growth`, so the update would be refused on a
     * billing-enabled run for reasons that have nothing to do with what this
     * test is about.
     */
    const controlWidget: SloWidget = buildSloWidget({
      sloId,
      displayType: "Chart",
      topInDashboardUnits: 0,
      widgetTitle: `Control ${unique}`,
    });

    const controlDashboard: JSONish = await createItem({
      page,
      projectId,
      path: "/api/dashboard",
      item: {
        name: `Control SLO Dashboard ${unique}`,
        description: "Created by SloPublicDashboard.spec.ts",
        projectId,
        isPublicDashboard: true,
        dashboardViewConfig: {
          _type: "DashboardViewConfig",
          heightInDashboardUnits: 24,
          components: [controlWidget.component],
          variables: [],
        },
      },
    });

    const controlDashboardId: string = toId(controlDashboard["_id"]);
    expect(
      controlDashboardId,
      "control dashboard should have been created",
    ).not.toBe("");

    const listStatusWhenPublic: number = await publicPostStatus({
      request: anonymous,
      path: `/public-dashboard-api/resource-list/${controlDashboardId}/slo`,
      body: { componentId: controlWidget.componentId },
    });
    const historyStatusWhenPublic: number = await publicPostStatus({
      request: anonymous,
      path: `/public-dashboard-api/slo-history-aggregate/${controlDashboardId}`,
      body: {
        componentId: controlWidget.componentId,
        aggregateBy: sloHistoryAggregateBy({ startDate, endDate }),
      },
    });

    expect(
      listStatusWhenPublic,
      "positive control: the same SLO read must succeed once the dashboard is public",
    ).toBe(200);
    expect(
      historyStatusWhenPublic,
      "positive control: the same history read must succeed once the dashboard is public",
    ).toBe(200);

    expect(
      listStatus,
      `an anonymous SLO read on a private dashboard should be rejected, got ${listStatus}`,
    ).toBe(401);
    expect(
      historyStatus,
      `an anonymous SLO history read on a private dashboard should be rejected, got ${historyStatus}`,
    ).toBe(401);
  });
});
