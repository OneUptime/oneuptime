import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import GreaterThan from "../../../Types/BaseDatabase/GreaterThan";
import Includes from "../../../Types/BaseDatabase/Includes";
import { JSONObject } from "../../../Types/JSON";
import {
  CLOUD_APP_SIGNAL_ROW_LIMIT,
  CLOUD_APP_SIGNAL_WINDOW_MINUTES,
  CloudAppSignalResult,
  buildCloudAppSignalRequest,
  fetchCloudAppInstances,
  fetchCloudAppSignals,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/AppPlatforms/Utils/CloudAppReads";
import { CLOUD_INSTANCE_LIVE_WINDOW_MINUTES } from "../../../../App/FeatureSet/Dashboard/src/Pages/AppPlatforms/Utils/CloudResourceTelemetryScope";

/*
 * What an apps list reads beside its rows: ONE grouped
 * /telemetry/traces/analytics read per environment (not three per app), of
 * entry spans only - a request, not every span under it - and the live
 * instances of its apps.
 */

const NOW: Date = new Date("2026-11-01T10:00:00.000Z");

const ENVIRONMENTS: Map<
  string,
  { cloudPlatform: string; cloudAccountId?: string; cloudRegion?: string }
> = new Map([
  [
    "env-ecs",
    {
      cloudPlatform: "aws_ecs",
      cloudAccountId: "123456789012",
      cloudRegion: "us-east-1",
    },
  ],
  ["env-run", { cloudPlatform: "gcp_cloud_run", cloudRegion: "europe-west1" }],
  // Created by hand, no platform yet: nothing of it can be scoped.
  ["env-new", { cloudPlatform: "" }],
]);

const APPS: Array<{
  _id: string;
  cloudResourceId: string;
  telemetryAttributes: Record<string, string>;
}> = [
  {
    _id: "app-checkout",
    cloudResourceId: "env-ecs",
    telemetryAttributes: { "aws.ecs.task.family": "checkout-api" },
  },
  {
    _id: "app-api",
    cloudResourceId: "env-run",
    telemetryAttributes: { "faas.name": "api" },
  },
  {
    _id: "app-worker",
    cloudResourceId: "env-run",
    telemetryAttributes: { "faas.name": "worker" },
  },
  {
    _id: "app-new",
    cloudResourceId: "env-new",
    telemetryAttributes: { "service.name": "new" },
  },
];

let posts: Array<JSONObject>;

function answer(rowsFor: (body: JSONObject) => unknown): void {
  jest.spyOn(API, "post").mockImplementation((async (options: {
    data: JSONObject;
  }) => {
    posts.push(options.data);
    const rows: unknown = rowsFor(options.data);
    if (rows instanceof Error) {
      return new HTTPErrorResponse(403, { error: rows.message }, {});
    }
    return new HTTPResponse(200, { data: rows } as JSONObject, {});
  }) as never);
}

beforeEach(() => {
  posts = [];
  jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("buildCloudAppSignalRequest", () => {
  test("asks for a table of entry spans grouped by the apps' attributes, in the environment", () => {
    expect(
      buildCloudAppSignalRequest({
        read: { groupBy: ["resource.aws.ecs.task.family"] },
        environment: ENVIRONMENTS.get("env-ecs")!,
        start: new Date("2026-11-01T09:00:00.000Z"),
        end: NOW,
      }),
    ).toEqual({
      startTime: "2026-11-01T09:00:00.000Z",
      endTime: "2026-11-01T10:00:00.000Z",
      chartType: "table",
      metric: "count",
      groupBy: ["resource.aws.ecs.task.family"],
      attributes: {
        "resource.cloud.platform": "aws_ecs",
        "resource.cloud.account.id": "123456789012",
        "resource.cloud.region": "us-east-1",
      },
      entryOnly: true,
      limit: CLOUD_APP_SIGNAL_ROW_LIMIT,
    });
  });

  test("an app's own attributes narrow it to the app, for its revisions' read", () => {
    expect(
      buildCloudAppSignalRequest({
        read: { groupBy: ["resource.aws.ecs.task.revision"] },
        environment: ENVIRONMENTS.get("env-ecs")!,
        start: NOW,
        end: NOW,
        attributes: { "resource.aws.ecs.task.family": "checkout-api" },
      })["attributes"],
    ).toEqual({
      "resource.cloud.platform": "aws_ecs",
      "resource.cloud.account.id": "123456789012",
      "resource.cloud.region": "us-east-1",
      "resource.aws.ecs.task.family": "checkout-api",
    });
  });
});

describe("fetchCloudAppSignals", () => {
  test("reads each environment once, over the last hour, and gives every app its own row", async () => {
    answer((body: JSONObject): unknown => {
      const groupBy: Array<string> = body["groupBy"] as Array<string>;
      if (groupBy[0] === "resource.faas.name") {
        return [
          {
            groupValues: { "resource.faas.name": "api" },
            count: 120,
            errorCount: 6,
            p95DurationMs: 240,
          },
        ];
      }
      return [
        {
          groupValues: { "resource.aws.ecs.task.family": "checkout-api" },
          count: 50,
          errorCount: 0,
          p95DurationMs: 80,
        },
      ];
    });

    const result: CloudAppSignalResult = await fetchCloudAppSignals({
      apps: APPS,
      environments: ENVIRONMENTS,
      now: NOW,
    });

    // Two scoped environments, two reads: never one per app.
    expect(posts).toHaveLength(2);
    for (const body of posts) {
      expect(body["endTime"]).toBe(NOW.toISOString());
      expect(
        (NOW.getTime() - new Date(body["startTime"] as string).getTime()) /
          60000,
      ).toBe(CLOUD_APP_SIGNAL_WINDOW_MINUTES);
      expect(body["entryOnly"]).toBe(true);
    }

    expect(result.failed).toBe(false);
    expect(result.signals.get("app-checkout")).toEqual({
      requests: 50,
      errors: 0,
      errorRatePercent: 0,
      p95Ms: 80,
    });
    expect(result.signals.get("app-api")).toEqual({
      requests: 120,
      errors: 6,
      errorRatePercent: 5,
      p95Ms: 240,
    });
    // In the read, with no row: it sent no request in the hour.
    expect(result.signals.get("app-worker")).toEqual({
      requests: 0,
      errors: 0,
      errorRatePercent: null,
      p95Ms: null,
    });
    // Its environment has no platform yet: unknown, not zero.
    expect(result.signals.has("app-new")).toBe(false);
  });

  test("a read that fails says so, and leaves its apps unknown while the others are read", async () => {
    answer((body: JSONObject): unknown => {
      return (body["groupBy"] as Array<string>)[0] === "resource.faas.name"
        ? new Error("no access to traces")
        : [];
    });

    const result: CloudAppSignalResult = await fetchCloudAppSignals({
      apps: APPS,
      environments: ENVIRONMENTS,
      now: NOW,
    });

    expect(result.failed).toBe(true);
    expect(result.signals.has("app-api")).toBe(false);
    expect(result.signals.get("app-checkout")).toEqual(
      expect.objectContaining({ requests: 0 }),
    );
  });

  test("a read that throws is a failed read, not a broken list", async () => {
    jest.spyOn(API, "post").mockRejectedValue(new Error("offline"));

    const result: CloudAppSignalResult = await fetchCloudAppSignals({
      apps: APPS.slice(0, 1),
      environments: ENVIRONMENTS,
      now: NOW,
    });

    expect(result).toEqual({ signals: new Map(), failed: true });
  });

  test("no app, no read", async () => {
    answer((): unknown => {
      return [];
    });

    await fetchCloudAppSignals({
      apps: [],
      environments: ENVIRONMENTS,
      now: NOW,
    });

    expect(posts).toHaveLength(0);
  });
});

describe("fetchCloudAppInstances", () => {
  test("reads the apps' live instances only, with the app and revision each runs", async () => {
    const getList: jest.SpiedFunction<typeof ModelAPI.getList> = jest
      .spyOn(ModelAPI, "getList")
      .mockResolvedValue({ data: [], count: 0, skip: 0, limit: 0 } as never);

    await fetchCloudAppInstances([
      "75000000-0000-4000-8000-000000000001",
      "",
      "75000000-0000-4000-8000-000000000002",
    ]);

    expect(getList).toHaveBeenCalledTimes(1);
    const request: {
      query: { cloudAppId: Includes; lastSeenAt: GreaterThan<Date> };
      select: Record<string, boolean>;
    } = getList.mock.calls[0]![0] as never;

    // An empty id is never sent as one.
    expect(
      request.query.cloudAppId.values.map((id: unknown): string => {
        return String(id);
      }),
    ).toEqual([
      "75000000-0000-4000-8000-000000000001",
      "75000000-0000-4000-8000-000000000002",
    ]);
    expect(request.query.lastSeenAt).toBeInstanceOf(GreaterThan);
    const minutesAgo: number =
      (Date.now() - request.query.lastSeenAt.value.getTime()) / 60000;
    expect(minutesAgo).toBeGreaterThan(CLOUD_INSTANCE_LIVE_WINDOW_MINUTES - 1);
    expect(minutesAgo).toBeLessThan(CLOUD_INSTANCE_LIVE_WINDOW_MINUTES + 1);
    expect(request.select).toEqual({
      cloudAppId: true,
      revision: true,
      lastSeenAt: true,
    });
  });

  test("no app, or only empty ids, no read", async () => {
    const getList: jest.SpiedFunction<typeof ModelAPI.getList> = jest.spyOn(
      ModelAPI,
      "getList",
    );

    await expect(fetchCloudAppInstances([])).resolves.toEqual([]);
    await expect(fetchCloudAppInstances(["", ""])).resolves.toEqual([]);

    expect(getList).not.toHaveBeenCalled();
  });
});
