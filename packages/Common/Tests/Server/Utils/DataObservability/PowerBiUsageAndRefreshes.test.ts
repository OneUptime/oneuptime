import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  BiDashboardRead,
  BiToolRead,
  PowerBiConnector,
} from "../../../../Server/Utils/DataObservability/Bi/BiConnectors";
import BiRequestError from "../../../../Server/Utils/DataObservability/Bi/BiRequestError";
import {
  BiUsageLedger,
  BiUsageRead,
  BiUsageSummary,
  BiViewTally,
  emptyBiUsageLedger,
  MAX_LEDGER_VIEWERS,
  mergeBiUsage,
  readBiUsageLedger,
  summarizeBiUsage,
} from "../../../../Server/Utils/DataObservability/Bi/BiUsage";
import DataBiSync, {
  getRefreshFields,
  getWarningText,
} from "../../../../Server/Utils/DataObservability/Bi/DataBiSync";
import DataTableDashboards, {
  TableDashboard,
} from "../../../../Server/Utils/DataObservability/Bi/DataTableDashboards";
import {
  encodeContinuationToken,
  PowerBiView,
  readPowerBiActivityPage,
  readPowerBiUsage,
  readPowerBiView,
  tallyPowerBiViews,
} from "../../../../Server/Utils/DataObservability/Bi/PowerBiActivity";
import {
  combineRefreshHistories,
  PowerBiRefreshRead,
  readPowerBiRefresh,
  readPowerBiRefreshable,
  readPowerBiRefreshError,
  readPowerBiRefreshes,
  summarizePowerBiRefreshes,
} from "../../../../Server/Utils/DataObservability/Bi/PowerBiRefreshes";
import DataAssetLineageService from "../../../../Server/Services/DataAssetLineageService";
import DataBiConnectionService from "../../../../Server/Services/DataBiConnectionService";
import DataDashboardService from "../../../../Server/Services/DataDashboardService";
import OpenLineageIngest from "../../../../Server/Utils/DataObservability/OpenLineageIngest";
import DataBiConnection from "../../../../Models/DatabaseModels/DataBiConnection";
import DataDashboard from "../../../../Models/DatabaseModels/DataDashboard";
import DataBiTool from "../../../../Types/DataObservability/DataBiTool";
import {
  DataBiRefreshStatus,
  DataDashboardRefresh,
  DataDashboardRefreshHistory,
  readDataDashboardRefreshHistory,
  readDataDashboardUsageSummary,
} from "../../../../Types/DataObservability/DataDashboardActivity";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../../Server/Utils/DataSource/HttpFetch";

/*
 * Power BI's views and refreshes on BI dashboards: the activity log read an
 * hour at a time within its limits (its pages, its empty pages, its
 * continuation tokens, the request budget, a limit or an error part way),
 * refreshes from the admin list of refreshables and from each dataset's
 * history where a workspace allows it, the ledger views are counted from,
 * and the sync that keeps them on each dashboard.
 */

const NOW: Date = new Date("2026-11-10T10:30:00.000Z");
// The newest hour read at NOW: the one that ended an hour before.
const END: string = "2026-11-10T09:00:00.000Z";
// The oldest hour Power BI's 28 days let NOW read.
const OLDEST: string = "2026-10-13T11:00:00.000Z";

function hourPath(hour: string, activity: string): string {
  const end: string = new Date(
    new Date(hour).getTime() + 60 * 60 * 1000 - 1,
  ).toISOString();

  return `/admin/activityevents?startDateTime='${hour}'&endDateTime='${end}'&$filter=Activity%20eq%20'${activity}'`;
}

function continuationPath(token: string, activity: string): string {
  return `/admin/activityevents?continuationToken='${token}'&$filter=Activity%20eq%20'${activity}'`;
}

// A GET of Power BI's API answering by path, every path asked kept; any other path is an empty last page.
function fakeGet(
  routes: Record<string, unknown>,
  paths: Array<string> = [],
): (path: string) => Promise<unknown> {
  return async (path: string): Promise<unknown> => {
    paths.push(path);

    const answer: unknown = routes[path];

    if (answer instanceof Error) {
      throw answer;
    }

    return answer === undefined
      ? { activityEventEntities: [], lastResultSet: true }
      : answer;
  };
}

function viewEvent(data: {
  activity?: string;
  reportId?: string;
  appReportId?: string;
  dashboardId?: string;
  user?: string;
  at: string;
  isSuccess?: boolean;
}): JSONObject {
  return {
    Id: ObjectID.generate().toString(),
    Activity: data.activity || "ViewReport",
    CreationTime: data.at,
    UserId: data.user || "Ana@Acme.com",
    ...(data.reportId ? { ReportId: data.reportId } : {}),
    ...(data.appReportId ? { AppReportId: data.appReportId } : {}),
    ...(data.dashboardId ? { DashboardId: data.dashboardId } : {}),
    ...(data.isSuccess === false ? { IsSuccess: false } : {}),
  };
}

const ITEMS: Map<string, string> = new Map([
  ["r1", "R1"],
  ["app-r1", "APP-R1"],
  ["d1", "D1"],
]);

describe("reading Power BI's activity log", () => {
  test("a page's events and its next token; the last page names none, and an empty page can still have one", () => {
    expect(
      readPowerBiActivityPage({
        activityEventEntities: [{ Id: "1" }, "not an event", {}],
        continuationToken: "abc",
        lastResultSet: false,
      }),
    ).toEqual({ events: [{ Id: "1" }], continuationToken: "abc" });
    expect(
      readPowerBiActivityPage({
        activityEventEntities: [],
        continuationToken: "abc",
        lastResultSet: false,
      }),
    ).toEqual({ events: [], continuationToken: "abc" });
    expect(
      readPowerBiActivityPage({
        activityEventEntities: [{ Id: "2" }],
        continuationToken: "abc",
        lastResultSet: true,
      }).continuationToken,
    ).toBe(null);
    expect(
      readPowerBiActivityPage({
        activityEventEntities: [],
        continuationUri: null,
        continuationToken: null,
        lastResultSet: false,
      }).continuationToken,
    ).toBe(null);
    expect(readPowerBiActivityPage("nonsense")).toEqual({
      events: [],
      continuationToken: null,
    });
  });

  test("a view is of a listed report or dashboard: an app's copy first, by whom, and when", () => {
    const at: string = "2026-11-10T08:15:00.000Z";

    expect(readPowerBiView(viewEvent({ reportId: "R1", at }), ITEMS)).toEqual({
      externalId: "R1",
      viewer: "ana@acme.com",
      at: new Date(at),
    });
    expect(
      readPowerBiView(
        viewEvent({ reportId: "R1", appReportId: "APP-R1", at }),
        ITEMS,
      )?.externalId,
    ).toBe("APP-R1");
    expect(
      readPowerBiView(
        viewEvent({ reportId: "R1", appReportId: "not-listed", at }),
        ITEMS,
      )?.externalId,
    ).toBe("R1");
    expect(
      readPowerBiView(
        viewEvent({ activity: "viewdashboard", dashboardId: "d1", at }),
        ITEMS,
      )?.externalId,
    ).toBe("D1");
    expect(
      readPowerBiView(
        {
          Activity: "ViewDashboard",
          CreationTime: at,
          UserKey: "1003BFFD",
          ArtifactId: "D1",
        },
        ITEMS,
      ),
    ).toEqual({ externalId: "D1", viewer: "1003bffd", at: new Date(at) });
  });

  test("an item not listed, a failed view, another activity or no time is no view", () => {
    const at: string = "2026-11-10T08:15:00.000Z";

    expect(
      readPowerBiView(viewEvent({ reportId: "elsewhere", at }), ITEMS),
    ).toBe(null);
    expect(
      readPowerBiView(
        viewEvent({ reportId: "R1", at, isSuccess: false }),
        ITEMS,
      ),
    ).toBe(null);
    expect(
      readPowerBiView(
        viewEvent({ activity: "ExportReport", reportId: "R1", at }),
        ITEMS,
      ),
    ).toBe(null);
    expect(
      readPowerBiView(viewEvent({ reportId: "R1", at: "yesterday" }), ITEMS),
    ).toBe(null);
  });

  test("views are counted by item, viewer and hour, with the latest view of each", () => {
    const views: Array<PowerBiView> = [
      { externalId: "R1", viewer: "ana", at: new Date("2026-11-10T08:05:00Z") },
      { externalId: "R1", viewer: "ana", at: new Date("2026-11-10T08:45:00Z") },
      { externalId: "R1", viewer: "ana", at: new Date("2026-11-10T07:59:00Z") },
      { externalId: "R1", viewer: "kim", at: new Date("2026-11-10T08:10:00Z") },
      { externalId: "D1", viewer: "ana", at: new Date("2026-11-10T08:20:00Z") },
    ];

    expect(tallyPowerBiViews(views)).toEqual([
      {
        externalId: "R1",
        viewer: "ana",
        hour: "2026-11-10T08:00:00.000Z",
        views: 2,
        lastViewedAt: "2026-11-10T08:45:00.000Z",
      },
      {
        externalId: "R1",
        viewer: "ana",
        hour: "2026-11-10T07:00:00.000Z",
        views: 1,
        lastViewedAt: "2026-11-10T07:59:00.000Z",
      },
      {
        externalId: "R1",
        viewer: "kim",
        hour: "2026-11-10T08:00:00.000Z",
        views: 1,
        lastViewedAt: "2026-11-10T08:10:00.000Z",
      },
      {
        externalId: "D1",
        viewer: "ana",
        hour: "2026-11-10T08:00:00.000Z",
        views: 1,
        lastViewedAt: "2026-11-10T08:20:00.000Z",
      },
    ]);
  });

  test("a continuation token is sent encoded once, whether Power BI encoded it or not", () => {
    expect(encodeContinuationToken("%2BRID%3A244SAKl%3D%3D")).toBe(
      "%2BRID%3A244SAKl%3D%3D",
    );
    expect(encodeContinuationToken("+RID:244SAKl==")).toBe(
      "%2BRID%3A244SAKl%3D%3D",
    );
    // A % of its own, not an encoding.
    expect(encodeContinuationToken("50%off")).toBe("50%25off");
  });
});

describe("reading views an hour at a time", () => {
  test("the first read goes back from the newest hour, follows every page, empty ones too, and stops at its budget", async () => {
    const paths: Array<string> = [];
    const result: Awaited<ReturnType<typeof readPowerBiUsage>> =
      await readPowerBiUsage({
        get: fakeGet(
          {
            [hourPath("2026-11-10T08:00:00.000Z", "ViewReport")]: {
              activityEventEntities: [
                viewEvent({ reportId: "R1", at: "2026-11-10T08:05:00.000Z" }),
              ],
              continuationToken: "tok%2B1",
              lastResultSet: false,
            },
            [continuationPath("tok%2B1", "ViewReport")]: {
              activityEventEntities: [
                viewEvent({
                  reportId: "R1",
                  user: "kim@acme.com",
                  at: "2026-11-10T08:50:00.000Z",
                }),
              ],
              continuationToken: null,
              lastResultSet: true,
            },
            [hourPath("2026-11-10T08:00:00.000Z", "ViewDashboard")]: {
              activityEventEntities: [],
              continuationToken: "t2",
              lastResultSet: false,
            },
            [continuationPath("t2", "ViewDashboard")]: {
              activityEventEntities: [
                viewEvent({
                  activity: "ViewDashboard",
                  dashboardId: "D1",
                  at: "2026-11-10T08:30:00.000Z",
                }),
              ],
              lastResultSet: true,
            },
          },
          paths,
        ),
        cursor: { from: null, until: null },
        now: NOW,
        items: ITEMS,
        requestBudget: 6,
      });

    // Hour 08 took four requests and hour 07 two; hour 06 was cut short by the budget and not counted.
    expect(paths).toEqual([
      hourPath("2026-11-10T08:00:00.000Z", "ViewReport"),
      continuationPath("tok%2B1", "ViewReport"),
      hourPath("2026-11-10T08:00:00.000Z", "ViewDashboard"),
      continuationPath("t2", "ViewDashboard"),
      hourPath("2026-11-10T07:00:00.000Z", "ViewReport"),
      hourPath("2026-11-10T07:00:00.000Z", "ViewDashboard"),
    ]);
    expect(result.warning).toBe(null);
    expect(result.usage.previous).toEqual({ from: END, until: END });
    expect(result.usage.range).toEqual({
      from: "2026-11-10T07:00:00.000Z",
      until: END,
    });
    expect(
      result.usage.tallies.map((tally: BiViewTally): string => {
        return `${tally.externalId} ${tally.viewer} ${tally.views}`;
      }),
    ).toEqual(["R1 ana@acme.com 1", "R1 kim@acme.com 1", "D1 ana@acme.com 1"]);
  });

  test("a later read adds the hours since, oldest first, and goes no further back than Power BI's 28 days", async () => {
    const paths: Array<string> = [];
    const result: Awaited<ReturnType<typeof readPowerBiUsage>> =
      await readPowerBiUsage({
        get: fakeGet({}, paths),
        cursor: {
          from: new Date(OLDEST),
          until: new Date("2026-11-10T07:00:00.000Z"),
        },
        now: NOW,
        items: ITEMS,
      });

    expect(paths).toEqual([
      hourPath("2026-11-10T07:00:00.000Z", "ViewReport"),
      hourPath("2026-11-10T07:00:00.000Z", "ViewDashboard"),
      hourPath("2026-11-10T08:00:00.000Z", "ViewReport"),
      hourPath("2026-11-10T08:00:00.000Z", "ViewDashboard"),
    ]);
    expect(result.usage.range).toEqual({ from: OLDEST, until: END });
    expect(result.warning).toBe(null);
  });

  test("hours read only before Power BI's 28 days start over from the newest", async () => {
    const paths: Array<string> = [];

    await readPowerBiUsage({
      get: fakeGet({}, paths),
      cursor: {
        from: new Date("2026-09-01T00:00:00.000Z"),
        until: new Date("2026-09-02T00:00:00.000Z"),
      },
      now: NOW,
      items: ITEMS,
      requestBudget: 2,
    });

    expect(paths).toEqual([
      hourPath("2026-11-10T08:00:00.000Z", "ViewReport"),
      hourPath("2026-11-10T08:00:00.000Z", "ViewDashboard"),
    ]);
  });

  test("Power BI's hourly limit part way keeps the hours read and says the rest is read next hour", async () => {
    const result: Awaited<ReturnType<typeof readPowerBiUsage>> =
      await readPowerBiUsage({
        get: fakeGet({
          [hourPath("2026-11-10T08:00:00.000Z", "ViewReport")]: {
            activityEventEntities: [
              viewEvent({ reportId: "R1", at: "2026-11-10T08:05:00.000Z" }),
            ],
            lastResultSet: true,
          },
          [hourPath("2026-11-10T07:00:00.000Z", "ViewDashboard")]:
            new BiRequestError("Power BI answered 429: Too many requests", 429),
          [hourPath("2026-11-10T07:00:00.000Z", "ViewReport")]: {
            activityEventEntities: [
              viewEvent({ reportId: "R1", at: "2026-11-10T07:05:00.000Z" }),
            ],
            lastResultSet: true,
          },
        }),
        cursor: { from: null, until: null },
        now: NOW,
        items: ITEMS,
      });

    expect(result.usage.range.from).toBe("2026-11-10T08:00:00.000Z");
    // Hour 07's report views were read, but its dashboard views were not: the hour is not counted.
    expect(
      result.usage.tallies.map((tally: BiViewTally): string => {
        return tally.hour;
      }),
    ).toEqual(["2026-11-10T08:00:00.000Z"]);
    expect(result.warning).toContain("200 requests of its activity log");
  });

  test("any other error says why, and a log that never ends is not read forever", async () => {
    const failed: Awaited<ReturnType<typeof readPowerBiUsage>> =
      await readPowerBiUsage({
        get: fakeGet({
          [hourPath("2026-11-10T08:00:00.000Z", "ViewReport")]:
            new BiRequestError("Power BI answered 500: boom", 500),
        }),
        cursor: { from: null, until: null },
        now: NOW,
        items: ITEMS,
      });

    expect(failed.warning).toBe(
      "Views were not all read: Power BI answered 500: boom",
    );
    expect(failed.usage.range).toEqual({ from: END, until: END });
    expect(failed.usage.tallies).toEqual([]);

    const endless: Awaited<ReturnType<typeof readPowerBiUsage>> =
      await readPowerBiUsage({
        get: async (): Promise<unknown> => {
          return {
            activityEventEntities: [],
            continuationToken: "again",
            lastResultSet: false,
          };
        },
        cursor: { from: null, until: null },
        now: NOW,
        items: ITEMS,
      });

    expect(endless.warning).toContain("did not end after 50 pages");
    expect(endless.usage.range).toEqual({ from: END, until: END });
  });
});

describe("reading Power BI's refreshes", () => {
  test("a refresh's error: its code and the first words meant for a person", () => {
    expect(
      readPowerBiRefreshError(
        '{"errorCode":"ModelRefreshFailed_CredentialsNotSpecified"}',
      ),
    ).toBe("ModelRefreshFailed_CredentialsNotSpecified");
    expect(
      readPowerBiRefreshError({
        errorCode: "ModelRefresh_ShortMessage_ProcessingError",
        errorDescription: "The column 'id' of the table wasn't found.",
      }),
    ).toBe(
      "ModelRefresh_ShortMessage_ProcessingError: The column 'id' of the table wasn't found.",
    );
    expect(
      readPowerBiRefreshError(
        JSON.stringify({
          error: {
            code: "DM_GWPipeline_Gateway_DataSourceAccessError",
            "pbi.error": {
              details: [
                {
                  code: "DM_ErrorDetailNameCode_UnderlyingErrorMessage",
                  detail: { type: 1, value: "Login failed for user 'bi'." },
                },
              ],
            },
          },
        }),
      ),
    ).toBe(
      "DM_GWPipeline_Gateway_DataSourceAccessError: Login failed for user 'bi'.",
    );
    expect(readPowerBiRefreshError("Not JSON at all")).toBe("Not JSON at all");
    expect(readPowerBiRefreshError("")).toBe(null);
    expect(readPowerBiRefreshError(undefined)).toBe(null);
  });

  test("a refresh: how it went, when, how it started, and a failed one's error", () => {
    expect(
      readPowerBiRefresh({
        refreshType: "Scheduled",
        startTime: "2026-11-10T05:00:00Z",
        endTime: "2026-11-10T05:04:00Z",
        status: "Completed",
        requestId: "9399bb89-25d1-44f8-8576-136d7e9014b1",
      }),
    ).toEqual({
      status: DataBiRefreshStatus.Completed,
      startedAt: "2026-11-10T05:00:00.000Z",
      endedAt: "2026-11-10T05:04:00.000Z",
      type: "Scheduled",
      error: null,
    });
    expect(
      readPowerBiRefresh({
        refreshType: "ViaApi",
        startTime: "2026-11-10T06:00:00Z",
        endTime: "2026-11-10T06:01:00Z",
        status: "Failed",
        refreshAttempts: [
          {
            attemptId: 1,
            serviceExceptionJson: '{"errorCode":"FirstAttempt"}',
            type: "Data",
          },
          {
            attemptId: 2,
            serviceExceptionJson: '{"errorCode":"SecondAttempt"}',
            type: "Data",
          },
        ],
      })?.error,
    ).toBe("SecondAttempt");
    // Power BI says Unknown while a refresh runs.
    expect(
      readPowerBiRefresh({
        startTime: "2026-11-10T07:00:00Z",
        status: "Unknown",
      })?.status,
    ).toBe(DataBiRefreshStatus.InProgress);
    expect(
      readPowerBiRefresh({
        startTime: "2026-11-10T07:00:00Z",
        endTime: "2026-11-10T07:10:00Z",
        status: "Unknown",
      })?.status,
    ).toBe(DataBiRefreshStatus.Unknown);
    expect(
      readPowerBiRefresh({ status: "Cancelled", serviceExceptionJson: "{}" })
        ?.status,
    ).toBe(DataBiRefreshStatus.Cancelled);
    expect(readPowerBiRefresh(null)).toBe(null);
  });

  test("a dataset's history: the newest first, the latest ten kept, and the last seven days counted", () => {
    const values: Array<JSONObject> = [];

    for (let day: number = 0; day < 12; day++) {
      values.push({
        startTime: new Date(
          NOW.getTime() - (day + 1) * 24 * 60 * 60 * 1000,
        ).toISOString(),
        endTime: new Date(
          NOW.getTime() - (day + 1) * 24 * 60 * 60 * 1000 + 60_000,
        ).toISOString(),
        status: day % 3 === 0 ? "Failed" : "Completed",
        serviceExceptionJson:
          day % 3 === 0 ? '{"errorCode":"Timeout"}' : undefined,
      });
    }

    const history: DataDashboardRefreshHistory | null =
      summarizePowerBiRefreshes(values.reverse(), NOW);

    expect(history?.last?.status).toBe(DataBiRefreshStatus.Failed);
    expect(history?.last?.error).toBe("Timeout");
    expect(history?.refreshes).toHaveLength(10);
    // Days 1 to 7 before: days 0, 3 and 6 of them failed.
    expect(history?.refreshCount).toBe(7);
    expect(history?.failureCount).toBe(3);
    expect(summarizePowerBiRefreshes([], NOW)).toBe(null);
  });

  test("a refreshable: its dataset, its last refresh, and Power BI's counts", () => {
    expect(
      readPowerBiRefreshable({
        id: "CFAFBEB1-8037-4D0C-896E-A46FB27FF229",
        name: "SalesMarketing",
        kind: "Dataset",
        refreshCount: 22,
        refreshFailures: 2,
        lastRefresh: {
          refreshType: "ViaApi",
          startTime: "2026-11-10T09:25:43.153Z",
          endTime: "2026-11-10T09:31:43.153Z",
          status: "Failed",
          serviceExceptionJson: '{"errorCode":"ModelRefreshFailed"}',
        },
      }),
    ).toEqual({
      datasetId: "cfafbeb1-8037-4d0c-896e-a46fb27ff229",
      history: {
        last: {
          status: DataBiRefreshStatus.Failed,
          startedAt: "2026-11-10T09:25:43.153Z",
          endedAt: "2026-11-10T09:31:43.153Z",
          type: "ViaApi",
          error: "ModelRefreshFailed",
        },
        refreshCount: 22,
        failureCount: 2,
        refreshes: [
          expect.objectContaining({ status: DataBiRefreshStatus.Failed }),
        ],
      },
    });
    expect(readPowerBiRefreshable({ name: "no id" })).toBe(null);
  });

  test("a dashboard over several datasets: the latest failure, else the oldest refresh, counts added", () => {
    const refresh: (
      status: DataBiRefreshStatus,
      endedAt: string,
    ) => DataDashboardRefresh = (
      status: DataBiRefreshStatus,
      endedAt: string,
    ): DataDashboardRefresh => {
      return { status, startedAt: endedAt, endedAt, type: null, error: null };
    };
    const history: (
      last: DataDashboardRefresh,
      counts: [number, number],
    ) => DataDashboardRefreshHistory = (
      last: DataDashboardRefresh,
      counts: [number, number],
    ): DataDashboardRefreshHistory => {
      return {
        last,
        refreshCount: counts[0],
        failureCount: counts[1],
        refreshes: [last],
      };
    };
    const fresh: DataDashboardRefreshHistory = history(
      refresh(DataBiRefreshStatus.Completed, "2026-11-10T09:00:00.000Z"),
      [10, 0],
    );
    const stale: DataDashboardRefreshHistory = history(
      refresh(DataBiRefreshStatus.Completed, "2026-11-07T09:00:00.000Z"),
      [3, 0],
    );
    const failedEarly: DataDashboardRefreshHistory = history(
      refresh(DataBiRefreshStatus.Failed, "2026-11-09T09:00:00.000Z"),
      [5, 1],
    );
    const failedLate: DataDashboardRefreshHistory = history(
      refresh(DataBiRefreshStatus.Failed, "2026-11-10T08:00:00.000Z"),
      [5, 2],
    );

    expect(combineRefreshHistories([fresh, stale])?.last?.endedAt).toBe(
      "2026-11-07T09:00:00.000Z",
    );

    const combined: DataDashboardRefreshHistory | null | undefined =
      combineRefreshHistories([fresh, failedEarly, failedLate, stale]);

    expect(combined?.last?.endedAt).toBe("2026-11-10T08:00:00.000Z");
    expect(combined?.refreshCount).toBe(23);
    expect(combined?.failureCount).toBe(3);
    expect(
      combined?.refreshes.map((item: DataDashboardRefresh): string | null => {
        return item.endedAt;
      }),
    ).toEqual([
      "2026-11-10T09:00:00.000Z",
      "2026-11-10T08:00:00.000Z",
      "2026-11-09T09:00:00.000Z",
      "2026-11-07T09:00:00.000Z",
    ]);
    expect(combineRefreshHistories([fresh])).toBe(fresh);
    expect(combineRefreshHistories([undefined, undefined])).toBe(undefined);
    expect(combineRefreshHistories([null, undefined])).toBe(null);
    expect(combineRefreshHistories([])).toBe(undefined);
  });
});

describe("reading refreshes where Power BI lets the service principal", () => {
  function refreshables(count: number, offset: number): JSONObject {
    const value: Array<JSONObject> = [];

    for (let index: number = 0; index < count; index++) {
      value.push({
        id: `filler-${offset + index}`,
        lastRefresh: { status: "Completed", endTime: "2026-11-10T01:00:00Z" },
      });
    }

    return { value };
  }

  test("datasets on capacities from the list of refreshables, a thousand a page; one not listed has none", async () => {
    const paths: Array<string> = [];
    const firstPage: JSONObject = refreshables(999, 0);

    (firstPage["value"] as Array<JSONObject>).push({
      id: "DS-CAP",
      refreshCount: 4,
      refreshFailures: 1,
      lastRefresh: {
        status: "Failed",
        startTime: "2026-11-10T08:00:00Z",
        endTime: "2026-11-10T08:02:00Z",
        serviceExceptionJson: '{"errorCode":"Oops"}',
      },
    });

    const read: PowerBiRefreshRead = await readPowerBiRefreshes({
      get: fakeGet(
        {
          "/admin/capacities/refreshables?$top=1000&$skip=0": firstPage,
          "/admin/capacities/refreshables?$top=1000&$skip=1000": refreshables(
            3,
            1000,
          ),
        },
        paths,
      ),
      datasets: [
        { datasetId: "ds-cap", workspaceId: "w-cap", onCapacity: true },
        { datasetId: "DS-NEVER", workspaceId: "w-cap", onCapacity: true },
      ],
      now: NOW,
    });

    expect(paths).toEqual([
      "/admin/capacities/refreshables?$top=1000&$skip=0",
      "/admin/capacities/refreshables?$top=1000&$skip=1000",
    ]);
    expect(read.refreshes.get("ds-cap")).toEqual({
      last: expect.objectContaining({
        status: DataBiRefreshStatus.Failed,
        error: "Oops",
      }),
      refreshCount: 4,
      failureCount: 1,
      refreshes: [expect.objectContaining({ error: "Oops" })],
    });
    expect(read.refreshes.get("ds-never")).toBe(null);
    expect(read.warnings).toEqual([]);
  });

  test("on shared capacity, each dataset's history; a refusing workspace is asked once, one gone is skipped", async () => {
    const paths: Array<string> = [];
    const history: (workspace: string, dataset: string) => string = (
      workspace: string,
      dataset: string,
    ): string => {
      return `/groups/${workspace}/datasets/${dataset}/refreshes?$top=60`;
    };
    const read: PowerBiRefreshRead = await readPowerBiRefreshes({
      get: fakeGet(
        {
          "/admin/capacities/refreshables?$top=1000&$skip=0": {
            value: [
              {
                id: "ds-listed",
                lastRefresh: {
                  status: "Completed",
                  endTime: "2026-11-10T01:00:00Z",
                },
              },
            ],
          },
          [history("w-open", "ds-a")]: {
            value: [
              {
                status: "Failed",
                startTime: "2026-11-10T06:00:00Z",
                endTime: "2026-11-10T06:05:00Z",
                serviceExceptionJson:
                  '{"errorCode":"ModelRefreshFailed_CredentialsNotSpecified"}',
              },
              {
                status: "Completed",
                startTime: "2026-11-09T06:00:00Z",
                endTime: "2026-11-09T06:05:00Z",
              },
            ],
          },
          [history("w-open", "ds-gone")]: new BiRequestError(
            "Power BI answered 404: Not found",
            404,
          ),
          [history("w-closed", "ds-b")]: new BiRequestError(
            "Power BI answered 403: Forbidden",
            403,
          ),
          [history("w-closed", "ds-c")]: { value: [] },
        },
        paths,
      ),
      datasets: [
        { datasetId: "ds-a", workspaceId: "w-open", onCapacity: false },
        { datasetId: "ds-gone", workspaceId: "w-open", onCapacity: false },
        { datasetId: "ds-b", workspaceId: "w-closed", onCapacity: false },
        { datasetId: "ds-c", workspaceId: "w-closed", onCapacity: false },
        { datasetId: "ds-listed", workspaceId: "w-other", onCapacity: false },
      ],
      now: NOW,
    });

    expect(paths).toEqual([
      "/admin/capacities/refreshables?$top=1000&$skip=0",
      history("w-open", "ds-a"),
      history("w-open", "ds-gone"),
      history("w-closed", "ds-b"),
    ]);
    expect(read.refreshes.get("ds-a")).toEqual({
      last: expect.objectContaining({
        status: DataBiRefreshStatus.Failed,
        error: "ModelRefreshFailed_CredentialsNotSpecified",
      }),
      refreshCount: 2,
      failureCount: 1,
      refreshes: [
        expect.objectContaining({ status: DataBiRefreshStatus.Failed }),
        expect.objectContaining({ status: DataBiRefreshStatus.Completed }),
      ],
    });
    // In the list of refreshables after all: never asked one by one.
    expect(read.refreshes.get("ds-listed")?.last?.status).toBe(
      DataBiRefreshStatus.Completed,
    );
    // Gone, or refused: not read, so what was read before is kept.
    expect(read.refreshes.has("ds-gone")).toBe(false);
    expect(read.refreshes.has("ds-b")).toBe(false);
    expect(read.refreshes.has("ds-c")).toBe(false);
    expect(read.warnings).toEqual([
      "Refreshes of 2 datasets on shared capacity were not read: Power BI shows a dataset's refreshes only to its workspace's Contributors, Members and Admins. Add the service principal to its workspace to read them.",
    ]);
  });

  test("a list that fails leaves its datasets unread, and a limit stops the reads one by one", async () => {
    const read: PowerBiRefreshRead = await readPowerBiRefreshes({
      get: fakeGet({
        "/admin/capacities/refreshables?$top=1000&$skip=0": new BiRequestError(
          "Power BI answered 500: Try again",
          500,
        ),
        "/groups/w1/datasets/ds-1/refreshes?$top=60": new BiRequestError(
          "Power BI answered 429: Slow down",
          429,
        ),
      }),
      datasets: [
        { datasetId: "ds-cap", workspaceId: "w-cap", onCapacity: true },
        { datasetId: "ds-1", workspaceId: "w1", onCapacity: false },
        { datasetId: "ds-2", workspaceId: "w1", onCapacity: false },
      ],
      now: NOW,
    });

    expect(read.refreshes.size).toBe(0);
    expect(read.warnings).toEqual([
      "Refreshes of datasets on capacities were not read: Power BI answered 500: Try again",
      "Refreshes of datasets on shared capacity were not all read: Power BI asked for fewer requests, and the rest is read next hour.",
    ]);
  });
});

describe("the ledger views are counted from", () => {
  function tally(
    externalId: string,
    viewer: string,
    hour: string,
    views: number,
  ): BiViewTally {
    return {
      externalId,
      viewer,
      hour,
      views,
      lastViewedAt: new Date(
        new Date(hour).getTime() + 10 * 60 * 1000,
      ).toISOString(),
    };
  }

  const read: BiUsageRead = {
    previous: {
      from: "2026-11-01T00:00:00.000Z",
      until: "2026-11-10T07:00:00.000Z",
    },
    range: {
      from: "2026-10-31T22:00:00.000Z",
      until: END,
    },
    tallies: [],
  };

  test("each hour read is added once: a ledger that holds it already adds nothing", () => {
    const tallies: Array<BiViewTally> = [
      tally("R1", "ana", "2026-11-10T07:00:00.000Z", 3),
      tally("R1", "kim", "2026-11-10T08:00:00.000Z", 1),
      tally("R1", "ana", "2026-10-31T22:00:00.000Z", 2),
    ];
    const kept: BiUsageLedger = {
      ...emptyBiUsageLedger(),
      from: read.previous.from,
      until: read.previous.until,
      days: { "2026-11-09": 4 },
      viewers: {
        ana: {
          lastViewedAt: "2026-11-09T12:00:00.000Z",
          days: { "2026-11-09": 4 },
        },
      },
      lastViewedAt: "2026-11-09T12:00:00.000Z",
    };
    const once: BiUsageLedger = mergeBiUsage({
      ledger: kept,
      read,
      tallies,
      now: NOW,
    });

    expect(once.from).toBe(read.range.from);
    expect(once.until).toBe(read.range.until);
    expect(once.days).toEqual({
      "2026-10-31": 2,
      "2026-11-09": 4,
      "2026-11-10": 4,
    });
    expect(once.viewers["ana"]!.days).toEqual({
      "2026-10-31": 2,
      "2026-11-09": 4,
      "2026-11-10": 3,
    });
    expect(once.lastViewedAt).toBe("2026-11-10T08:10:00.000Z");

    // The same read again - its tool's range was not kept: nothing is counted twice.
    expect(mergeBiUsage({ ledger: once, read, tallies, now: NOW })).toEqual(
      once,
    );
  });

  test("a dashboard new to the tool holds what was read before, and counts only the hours read now", () => {
    const merged: BiUsageLedger = mergeBiUsage({
      ledger: readBiUsageLedger(null),
      read,
      tallies: [
        tally("R1", "ana", "2026-11-05T07:00:00.000Z", 9),
        tally("R1", "ana", "2026-11-10T08:00:00.000Z", 1),
      ],
      now: NOW,
    });

    expect(merged.days).toEqual({ "2026-11-10": 1 });
  });

  test("days leave the window as they pass, and so do viewers with none left", () => {
    const merged: BiUsageLedger = mergeBiUsage({
      ledger: {
        ...emptyBiUsageLedger(),
        from: read.previous.from,
        until: read.previous.until,
        days: { "2026-10-01": 7, "2026-11-08": 1 },
        viewers: {
          gone: {
            lastViewedAt: "2026-10-01T10:00:00.000Z",
            days: { "2026-10-01": 7 },
          },
          kim: {
            lastViewedAt: "2026-11-08T10:00:00.000Z",
            days: { "2026-11-08": 1 },
          },
        },
        lastViewedAt: "2026-11-08T10:00:00.000Z",
      },
      read,
      tallies: [],
      now: NOW,
    });

    expect(merged.days).toEqual({ "2026-11-08": 1 });
    expect(Object.keys(merged.viewers)).toEqual(["kim"]);
  });

  test("a dashboard viewed by more people than the ledger keeps keeps the latest, and every view counted", () => {
    const tallies: Array<BiViewTally> = [];

    for (let index: number = 0; index <= MAX_LEDGER_VIEWERS; index++) {
      tallies.push({
        externalId: "R1",
        viewer: `viewer-${index}@acme.com`,
        hour: "2026-11-10T08:00:00.000Z",
        views: 1,
        lastViewedAt: new Date(
          new Date("2026-11-10T08:00:00.000Z").getTime() + index * 1000,
        ).toISOString(),
      });
    }

    const merged: BiUsageLedger = mergeBiUsage({
      ledger: emptyBiUsageLedger(),
      read,
      tallies,
      now: NOW,
    });

    expect(Object.keys(merged.viewers)).toHaveLength(MAX_LEDGER_VIEWERS);
    expect(merged.viewers["viewer-0@acme.com"]).toBe(undefined);
    expect(merged.days["2026-11-10"]).toBe(MAX_LEDGER_VIEWERS + 1);
  });

  test("the last 28 days: views, viewers, who views most, and since when while they are still read", () => {
    const summary: BiUsageSummary = summarizeBiUsage(
      {
        from: "2026-11-08T00:00:00.000Z",
        until: END,
        lastViewedAt: "2026-11-10T08:10:00.000Z",
        days: { "2026-11-08": 5, "2026-11-10": 4 },
        viewers: {
          ana: {
            lastViewedAt: "2026-11-08T10:00:00.000Z",
            days: { "2026-11-08": 2 },
          },
          kim: {
            lastViewedAt: "2026-11-10T08:10:00.000Z",
            days: { "2026-11-08": 1, "2026-11-10": 4 },
          },
          lee: {
            lastViewedAt: "2026-11-08T11:00:00.000Z",
            days: { "2026-11-08": 2 },
          },
        },
      },
      NOW,
    );

    expect(summary.viewCount).toBe(9);
    expect(summary.viewerCount).toBe(3);
    expect(summary.lastViewedAt?.toISOString()).toBe(
      "2026-11-10T08:10:00.000Z",
    );
    expect(summary.summary).toEqual({
      since: "2026-11-08T00:00:00.000Z",
      topViewers: [
        { viewer: "kim", views: 5, lastViewedAt: "2026-11-10T08:10:00.000Z" },
        { viewer: "lee", views: 2, lastViewedAt: "2026-11-08T11:00:00.000Z" },
        { viewer: "ana", views: 2, lastViewedAt: "2026-11-08T10:00:00.000Z" },
      ],
    });
    // All 28 days read: no since.
    expect(
      summarizeBiUsage(
        { ...emptyBiUsageLedger(), from: OLDEST, until: END },
        NOW,
      ).summary.since,
    ).toBe(null);
  });

  test("a ledger kept is read strictly: anything that does not fit is left out", () => {
    expect(
      readBiUsageLedger({
        from: "2026-11-01T00:00:00.000Z",
        until: "not a time",
        days: { "2026-11-01": 3, yesterday: 2, "2026-11-02": -1 },
        viewers: {
          ana: {
            lastViewedAt: "2026-11-01T10:00:00.000Z",
            days: { "2026-11-01": 3 },
          },
          kim: { lastViewedAt: "never", days: {} },
        },
      }),
    ).toEqual({
      from: null,
      until: null,
      lastViewedAt: null,
      days: { "2026-11-01": 3 },
      viewers: {
        ana: {
          lastViewedAt: "2026-11-01T10:00:00.000Z",
          days: { "2026-11-01": 3 },
        },
      },
    });
    expect(readBiUsageLedger(["nonsense"])).toEqual(emptyBiUsageLedger());
  });
});

describe("Power BI's reader, with views and refreshes", () => {
  const scan: JSONObject = {
    workspaces: [
      {
        id: "w1",
        name: "Finance",
        isOnDedicatedCapacity: true,
        reports: [
          {
            id: "R1",
            name: "Revenue",
            datasetId: "DS1",
            modifiedBy: "kim@acme.com",
          },
        ],
        dashboards: [
          {
            id: "D1",
            displayName: "Board",
            tiles: [
              { id: "t1", reportId: "R1", datasetId: "DS1" },
              { id: "t2", datasetId: "DS2" },
              { id: "t3", title: "A text box" },
            ],
          },
        ],
        datasets: [
          {
            id: "DS1",
            tables: [
              {
                name: "Orders",
                source: [
                  {
                    expression:
                      'let Source = Sql.Database("db.acme.com", "orders"), T = Source{[Schema="dbo",Item="Orders"]}[Data] in T',
                  },
                ],
              },
            ],
          },
          {
            id: "DS2",
            tables: [
              {
                name: "Refunds",
                source: [
                  {
                    expression:
                      'let Source = Sql.Database("db.acme.com", "orders"), T = Source{[Schema="dbo",Item="Refunds"]}[Data] in T',
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };

  function transport(
    routes: Record<string, unknown>,
    requests: Array<string>,
  ): (request: DataSourceHttpRequest) => Promise<DataSourceHttpResponse> {
    return async (
      request: DataSourceHttpRequest,
    ): Promise<DataSourceHttpResponse> => {
      const url: string = request.url;

      requests.push(url);

      const answer: (
        body: unknown,
        statusCode?: number,
      ) => DataSourceHttpResponse = (
        body: unknown,
        statusCode: number = 200,
      ): DataSourceHttpResponse => {
        return { statusCode, bodyText: JSON.stringify(body), bodyJson: body };
      };

      if (url.includes("login.microsoftonline.com")) {
        return answer({ access_token: "aad" });
      }

      if (url.includes("/admin/workspaces/modified")) {
        return answer([{ id: "w1" }]);
      }

      if (url.includes("/admin/workspaces/getInfo")) {
        return answer({ id: "scan1" });
      }

      if (url.includes("/scanStatus/")) {
        return answer({ status: "Succeeded" });
      }

      if (url.includes("/scanResult/")) {
        return answer(scan);
      }

      const path: string = url.replace(
        "https://api.powerbi.com/v1.0/myorg",
        "",
      );
      const routed: unknown = routes[path];

      if (routed instanceof Error) {
        return answer({ error: { message: routed.message } }, 403);
      }

      return answer(
        routed === undefined
          ? { activityEventEntities: [], lastResultSet: true }
          : routed,
      );
    };
  }

  test("a report and a dashboard, each with its datasets' refreshes and its views", async () => {
    const requests: Array<string> = [];
    const read: BiToolRead = await PowerBiConnector.read({
      baseUrl: "",
      credentials: { tenantId: "t", clientId: "c", clientSecret: "s" },
      wait: async (): Promise<void> => {},
      now: NOW,
      usageCursor: {
        from: new Date(OLDEST),
        until: new Date("2026-11-10T08:00:00.000Z"),
      },
      transport: transport(
        {
          "/admin/capacities/refreshables?$top=1000&$skip=0": {
            value: [
              {
                id: "ds1",
                refreshCount: 7,
                refreshFailures: 0,
                lastRefresh: {
                  status: "Completed",
                  startTime: "2026-11-10T05:00:00Z",
                  endTime: "2026-11-10T05:03:00Z",
                },
              },
              {
                id: "DS2",
                refreshCount: 2,
                refreshFailures: 1,
                lastRefresh: {
                  status: "Failed",
                  startTime: "2026-11-10T04:00:00Z",
                  endTime: "2026-11-10T04:01:00Z",
                  serviceExceptionJson: '{"errorCode":"GatewayOffline"}',
                },
              },
            ],
          },
          [hourPath("2026-11-10T08:00:00.000Z", "ViewReport")]: {
            activityEventEntities: [
              viewEvent({ reportId: "r1", at: "2026-11-10T08:05:00.000Z" }),
              viewEvent({
                reportId: "elsewhere",
                at: "2026-11-10T08:06:00.000Z",
              }),
            ],
            lastResultSet: true,
          },
          [hourPath("2026-11-10T08:00:00.000Z", "ViewDashboard")]: {
            activityEventEntities: [
              viewEvent({
                activity: "ViewDashboard",
                dashboardId: "d1",
                user: "kim@acme.com",
                at: "2026-11-10T08:30:00.000Z",
              }),
            ],
            lastResultSet: true,
          },
        },
        requests,
      ),
    });

    expect(read.warnings).toEqual([]);
    expect(
      read.dashboards.map((dashboard: BiDashboardRead): JSONObject => {
        return {
          externalId: dashboard.externalId,
          name: dashboard.name,
          url: dashboard.url,
          tables: dashboard.tables.map((ref: { table: string }): string => {
            return ref.table;
          }),
          last: dashboard.refresh?.last?.status || null,
          error: dashboard.refresh?.last?.error || null,
        };
      }),
    ).toEqual([
      {
        externalId: "R1",
        name: "Revenue",
        url: "https://app.powerbi.com/groups/w1/reports/R1",
        tables: ["Orders"],
        last: DataBiRefreshStatus.Completed,
        error: null,
      },
      {
        externalId: "D1",
        name: "Board",
        url: "https://app.powerbi.com/groups/w1/dashboards/D1",
        tables: ["Orders", "Refunds"],
        // The dashboard is only as fresh as its failing dataset.
        last: DataBiRefreshStatus.Failed,
        error: "GatewayOffline",
      },
    ]);
    expect(read.dashboards[1]!.refresh?.refreshCount).toBe(9);
    expect(read.usage?.range).toEqual({ from: OLDEST, until: END });
    expect(
      read.usage?.tallies.map((tally: BiViewTally): string => {
        return `${tally.externalId} ${tally.viewer}`;
      }),
    ).toEqual(["R1 ana@acme.com", "D1 kim@acme.com"]);
    expect(
      requests.filter((url: string): boolean => {
        return url.includes("/activityevents");
      }),
    ).toHaveLength(2);
  });

  test("views and refreshes that cannot be read leave the dashboards read, and say why", async () => {
    const read: BiToolRead = await PowerBiConnector.read({
      baseUrl: "",
      credentials: { tenantId: "t", clientId: "c", clientSecret: "s" },
      wait: async (): Promise<void> => {},
      now: NOW,
      usageCursor: {
        from: new Date(OLDEST),
        until: new Date("2026-11-10T08:00:00.000Z"),
      },
      transport: transport(
        {
          "/admin/capacities/refreshables?$top=1000&$skip=0": new Error(
            "Unauthorized",
          ),
          [hourPath("2026-11-10T08:00:00.000Z", "ViewReport")]: new Error(
            "API is not accessible for application",
          ),
        },
        [],
      ),
    });

    expect(
      read.dashboards.map((dashboard: BiDashboardRead): string => {
        return dashboard.externalId;
      }),
    ).toEqual(["R1", "D1"]);
    // Not read: what was read before is kept.
    expect(read.dashboards[0]!.refresh).toBe(undefined);
    expect(read.usage?.range).toEqual({
      from: OLDEST,
      until: "2026-11-10T08:00:00.000Z",
    });
    expect(read.warnings).toEqual([
      "Refreshes of datasets on capacities were not read: Power BI answered 403: Unauthorized",
      "Views were not all read: Power BI answered 403: API is not accessible for application",
    ]);
  });
});

describe("keeping views and refreshes on each dashboard", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const usage: BiUsageRead = {
    previous: { from: OLDEST, until: "2026-11-10T08:00:00.000Z" },
    range: { from: OLDEST, until: END },
    tallies: [
      {
        externalId: "R1",
        viewer: "ana@acme.com",
        hour: "2026-11-10T08:00:00.000Z",
        views: 2,
        lastViewedAt: "2026-11-10T08:40:00.000Z",
      },
      {
        externalId: "R2",
        viewer: "kim@acme.com",
        hour: "2026-11-10T08:00:00.000Z",
        views: 1,
        lastViewedAt: "2026-11-10T08:20:00.000Z",
      },
    ],
  };

  const failedRefresh: DataDashboardRefreshHistory = {
    last: {
      status: DataBiRefreshStatus.Failed,
      startedAt: "2026-11-10T04:00:00.000Z",
      endedAt: "2026-11-10T04:01:00.000Z",
      type: "Scheduled",
      error: "GatewayOffline",
    },
    refreshCount: 3,
    failureCount: 1,
    refreshes: [],
  };

  function read(data: {
    externalId: string;
    refresh?: DataDashboardRefreshHistory | null | undefined;
  }): BiDashboardRead {
    return {
      externalId: data.externalId,
      name: data.externalId,
      url: null,
      folder: null,
      owner: null,
      changedAt: null,
      tables: [],
      ...(data.refresh !== undefined ? { refresh: data.refresh } : {}),
    };
  }

  test("a known dashboard's ledger gets the hours read, a new one starts its own, and refreshes are written as read", async () => {
    const connection: DataBiConnection = new DataBiConnection();
    const known: DataDashboard = new DataDashboard();

    connection._id = ObjectID.generate().toString();
    connection.projectId = ObjectID.generate();
    known._id = ObjectID.generate().toString();
    known.externalId = "R1";
    known.usageLedger = {
      from: OLDEST,
      until: "2026-11-10T08:00:00.000Z",
      lastViewedAt: "2026-11-09T09:00:00.000Z",
      days: { "2026-11-09": 3 },
      viewers: {
        "ana@acme.com": {
          lastViewedAt: "2026-11-09T09:00:00.000Z",
          days: { "2026-11-09": 3 },
        },
      },
    } as unknown as JSONObject;

    const find: jest.SpyInstance = jest
      .spyOn(DataDashboardService, "findBy")
      .mockResolvedValue([known]) as unknown as jest.SpyInstance;
    const update: jest.SpyInstance = jest
      .spyOn(DataDashboardService, "updateOneById")
      .mockResolvedValue(undefined as never) as unknown as jest.SpyInstance;
    const create: jest.SpyInstance = jest
      .spyOn(DataDashboardService, "create")
      .mockResolvedValue(undefined as never) as unknown as jest.SpyInstance;

    jest
      .spyOn(DataDashboardService, "deleteOneById")
      .mockResolvedValue(undefined as never);

    await DataBiSync.keep({
      connection,
      tool: DataBiTool.PowerBI,
      read: [
        read({ externalId: "R1", refresh: failedRefresh }),
        read({ externalId: "R2", refresh: null }),
      ],
      catalog: { stores: [], assets: [], storeNames: new Map() },
      usage,
      now: NOW,
    });

    expect(
      (find.mock.calls[0]![0] as { select: JSONObject }).select["usageLedger"],
    ).toBe(true);

    const updated: JSONObject = (
      update.mock.calls[0]![0] as { data: JSONObject }
    ).data;

    expect(updated["viewCount"]).toBe(5);
    expect(updated["viewerCount"]).toBe(1);
    expect((updated["lastViewedAt"] as Date).toISOString()).toBe(
      "2026-11-10T08:40:00.000Z",
    );
    expect(
      readDataDashboardUsageSummary(updated["usageSummary"])?.topViewers,
    ).toEqual([
      {
        viewer: "ana@acme.com",
        views: 5,
        lastViewedAt: "2026-11-10T08:40:00.000Z",
      },
    ]);
    expect((updated["usageLedger"] as JSONObject)["until"]).toBe(END);
    expect(updated["lastRefreshStatus"]).toBe(DataBiRefreshStatus.Failed);
    expect((updated["lastRefreshAt"] as Date).toISOString()).toBe(
      "2026-11-10T04:01:00.000Z",
    );
    expect(
      readDataDashboardRefreshHistory(updated["refreshHistory"])?.last?.error,
    ).toBe("GatewayOffline");

    const created: DataDashboard = (
      create.mock.calls[0]![0] as {
        data: DataDashboard;
      }
    ).data;

    expect(created.externalId).toBe("R2");
    expect(created.viewCount).toBe(1);
    expect(created.viewerCount).toBe(1);
    expect(created.lastViewedAt?.toISOString()).toBe(
      "2026-11-10T08:20:00.000Z",
    );
    // A dataset with no refresh: nothing to write.
    expect(created.lastRefreshStatus).toBe(undefined);
    expect(created.refreshHistory).toBe(undefined);
  });

  test("views and refreshes not read are left as they are; refreshes read as none are cleared", async () => {
    const connection: DataBiConnection = new DataBiConnection();
    const known: DataDashboard = new DataDashboard();

    connection._id = ObjectID.generate().toString();
    connection.projectId = ObjectID.generate();
    known._id = ObjectID.generate().toString();
    known.externalId = "M1";

    const find: jest.SpyInstance = jest
      .spyOn(DataDashboardService, "findBy")
      .mockResolvedValue([known]) as unknown as jest.SpyInstance;
    const update: jest.SpyInstance = jest
      .spyOn(DataDashboardService, "updateOneById")
      .mockResolvedValue(undefined as never) as unknown as jest.SpyInstance;

    jest
      .spyOn(DataDashboardService, "deleteOneById")
      .mockResolvedValue(undefined as never);

    await DataBiSync.keep({
      connection,
      tool: DataBiTool.Metabase,
      read: [read({ externalId: "M1" })],
      catalog: { stores: [], assets: [], storeNames: new Map() },
    });

    expect(
      (find.mock.calls[0]![0] as { select: JSONObject }).select["usageLedger"],
    ).toBe(undefined);

    const updated: JSONObject = (
      update.mock.calls[0]![0] as { data: JSONObject }
    ).data;

    for (const field of [
      "viewCount",
      "viewerCount",
      "lastViewedAt",
      "usageSummary",
      "usageLedger",
      "lastRefreshStatus",
      "lastRefreshAt",
      "refreshHistory",
    ]) {
      expect(field in updated).toBe(false);
    }

    expect(getRefreshFields(null)).toEqual({
      lastRefreshStatus: null,
      lastRefreshAt: null,
      refreshHistory: null,
    });
  });

  test("a read keeps the hours of views it read on the tool, and what it could not read as a warning, without the credentials", async () => {
    const connection: DataBiConnection = new DataBiConnection();

    connection._id = ObjectID.generate().toString();
    connection.projectId = ObjectID.generate();
    connection.tool = DataBiTool.PowerBI;
    connection.credentials = JSON.stringify({
      tenantId: "t",
      clientId: "c",
      clientSecret: "s3cr3t-value",
    });
    connection.usageReadFrom = new Date(OLDEST);
    connection.usageReadUntil = new Date("2026-11-10T08:00:00.000Z");

    jest
      .spyOn(DataBiConnectionService, "findOneById")
      .mockResolvedValue(connection);
    const updateConnection: jest.SpyInstance = jest
      .spyOn(DataBiConnectionService, "updateOneById")
      .mockResolvedValue(undefined as never) as unknown as jest.SpyInstance;
    const readSpy: jest.SpyInstance = jest
      .spyOn(PowerBiConnector, "read")
      .mockResolvedValue({
        dashboards: [],
        usage,
        warnings: [
          "Views were not all read: Power BI answered 401: bad secret s3cr3t-value",
        ],
      }) as unknown as jest.SpyInstance;

    jest.spyOn(OpenLineageIngest, "readCatalog").mockResolvedValue({
      stores: [],
      assets: [],
      storeNames: new Map(),
    });
    jest.spyOn(DataDashboardService, "findBy").mockResolvedValue([]);

    const result: { error: string | null } = await DataBiSync.syncConnection(
      connection.id!,
    );

    expect(result.error).toBe(null);
    expect(
      (readSpy.mock.calls[0]![0] as { usageCursor: unknown }).usageCursor,
    ).toEqual({
      from: new Date(OLDEST),
      until: new Date("2026-11-10T08:00:00.000Z"),
    });

    const kept: JSONObject = (
      updateConnection.mock.calls[0]![0] as { data: JSONObject }
    ).data;

    expect(kept["lastSyncError"]).toBe("");
    expect(kept["lastSyncWarning"]).toBe(
      "Views were not all read: Power BI answered 401: bad secret ****",
    );
    expect((kept["usageReadFrom"] as Date).toISOString()).toBe(OLDEST);
    expect((kept["usageReadUntil"] as Date).toISOString()).toBe(END);
    expect(getWarningText(["a", "b"], "")).toBe("a b");
  });
});

describe("a table's dashboards, with their views and last refresh", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("each says how often it was viewed, when last, and how its last refresh went", async () => {
    const tableId: ObjectID = ObjectID.generate();
    const dashboard: DataDashboard = new DataDashboard();
    const quiet: DataDashboard = new DataDashboard();

    jest.spyOn(DataAssetLineageService, "findBy").mockResolvedValue([]);

    dashboard._id = ObjectID.generate().toString();
    dashboard.name = "Revenue";
    dashboard.tool = DataBiTool.PowerBI;
    dashboard.viewCount = 42;
    dashboard.viewerCount = 7;
    dashboard.lastViewedAt = new Date("2026-11-10T08:40:00.000Z");
    dashboard.lastRefreshStatus = DataBiRefreshStatus.Failed;
    dashboard.lastRefreshAt = new Date("2026-11-10T04:01:00.000Z");
    dashboard.refreshHistory = {
      last: {
        status: DataBiRefreshStatus.Failed,
        startedAt: "2026-11-10T04:00:00.000Z",
        endedAt: "2026-11-10T04:01:00.000Z",
        type: "Scheduled",
        error: "GatewayOffline",
      },
      refreshCount: 3,
      failureCount: 1,
      refreshes: [],
    } as unknown as JSONObject;
    dashboard.dataAssets = [];
    quiet._id = ObjectID.generate().toString();
    quiet.name = "Orders";
    quiet.tool = DataBiTool.Metabase;
    quiet.dataAssets = [];

    jest
      .spyOn(DataDashboardService, "findBy")
      .mockResolvedValue([dashboard, quiet]);

    const found: Array<TableDashboard> = await DataTableDashboards.find({
      projectId: ObjectID.generate(),
      dataAssetId: tableId,
    });

    expect(found[0]).toMatchObject({
      name: "Revenue",
      viewCount: 42,
      viewerCount: 7,
      lastViewedAt: "2026-11-10T08:40:00.000Z",
      lastRefreshStatus: DataBiRefreshStatus.Failed,
      lastRefreshAt: "2026-11-10T04:01:00.000Z",
      lastRefreshError: "GatewayOffline",
    });
    expect(found[1]).toMatchObject({
      name: "Orders",
      viewCount: null,
      viewerCount: null,
      lastViewedAt: null,
      lastRefreshStatus: null,
      lastRefreshAt: null,
      lastRefreshError: null,
    });
  });
});
