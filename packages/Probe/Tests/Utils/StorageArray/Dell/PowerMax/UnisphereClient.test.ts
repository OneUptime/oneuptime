import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "Common/Types/JSON";
import UnisphereClient, {
  UNISPHERE_APPLICATION_TYPE,
  UnispherePage,
  UnispherePerformanceInstance,
  UnisphereHttpError,
  UnisphereNotRestApiError,
  UnisphereTimedPoint,
  UnisphereVersion,
  readApiVersionNumber,
  toNumber,
  toQueryString,
  toText,
} from "../../../../../Utils/StorageArray/Dell/PowerMax/UnisphereClient";
import {
  StorageArrayHttpRequest,
  StorageArrayHttpResponse,
  StorageArrayTransport,
} from "../../../../../Utils/StorageArray/StorageArrayTransport";
import FakeUnisphere from "./Helpers/FakeUnisphere";
import {
  ARRAY_REMOTE,
  ARRAY_V3,
  ARRAY_V4,
  NOW_MS,
  PASSWORD,
  USERNAME,
  makeUnisphere,
} from "./Helpers/PowerMaxScenario";
import {
  SYMMETRIX_LIST_KEY_OPENAPI,
  VERSION_10_0,
  VERSION_10_1,
  enhancedStorageGroup,
} from "./Helpers/UnisphereRecordings";

/*
 * The Unisphere for PowerMax REST client (#11004), against a fake that
 * answers with Dell's documented examples: the paths it calls, how it
 * logs in, how it reads Dell's answers - both spellings of a list, the
 * newest of several samples, paged lists with Dell's `next` - and how it
 * turns a refusal into an error that says the status and Dell's message,
 * never the password.
 */

function client(
  unisphere: FakeUnisphere,
  data: { username?: string; password?: string; apiVersion?: string } = {},
): UnisphereClient {
  const result: UnisphereClient = new UnisphereClient({
    transport: unisphere.transport(),
    username: data.username ?? USERNAME,
    password: data.password ?? PASSWORD,
  });
  result.setApiVersion(data.apiVersion ?? "104");
  return result;
}

function capture(answer: StorageArrayHttpResponse): {
  transport: StorageArrayTransport;
  requests: Array<StorageArrayHttpRequest>;
} {
  const requests: Array<StorageArrayHttpRequest> = [];
  return {
    requests,
    transport: async (
      request: StorageArrayHttpRequest,
    ): Promise<StorageArrayHttpResponse> => {
      requests.push(request);
      return answer;
    },
  };
}

describe("UnisphereClient: reading Dell's values", () => {
  test("numbers come as numbers or numeric strings; anything else is no number", () => {
    expect(toNumber(12.5)).toBe(12.5);
    expect(toNumber("12.5")).toBe(12.5);
    expect(toNumber(" 7 ")).toBe(7);
    expect(toNumber("")).toBeNull();
    expect(toNumber("n/a")).toBeNull();
    expect(toNumber(Number.NaN)).toBeNull();
    expect(toNumber(Number.POSITIVE_INFINITY)).toBeNull();
    expect(toNumber(null)).toBeNull();
    expect(toNumber(undefined)).toBeNull();
    expect(toNumber(true)).toBeNull();
  });

  test("text is trimmed, and an empty one is none", () => {
    expect(toText(" FA-1D ")).toBe("FA-1D");
    expect(toText("")).toBeNull();
    expect(toText("   ")).toBeNull();
    expect(toText(42)).toBe("42");
    expect(toText(Number.NaN)).toBeNull();
    expect(toText({})).toBeNull();
    expect(toText(null)).toBeNull();
  });

  test("Unisphere's versions read as its REST API's numbers", () => {
    expect(readApiVersionNumber("T10.1.0.468")).toBe(101);
    expect(readApiVersionNumber("V10.0.1.12")).toBe(100);
    expect(readApiVersionNumber("V9.2.1.4")).toBe(92);
    expect(readApiVersionNumber("10.4.0.83")).toBe(104);
    expect(readApiVersionNumber("104")).toBe(104);
    expect(readApiVersionNumber("92")).toBe(92);
    expect(readApiVersionNumber("unknown")).toBeNull();
    expect(readApiVersionNumber("")).toBeNull();
    expect(readApiVersionNumber(null)).toBeNull();
  });

  test("a query keeps the commas, semicolons and parentheses Unisphere reads, and drops empty values", () => {
    expect(
      toQueryString({
        select: "id,rdf_infos.states",
        filter: "num_of_storage_groups gt 0",
        limit: 1000,
        expiration_delay_secs: undefined,
        resume_token: "",
        other: "a;b(c)",
      }),
    ).toBe(
      "?select=id,rdf_infos.states&filter=num_of_storage_groups%20gt%200&limit=1000&other=a;b(c)",
    );
    expect(toQueryString({})).toBe("");
    expect(toQueryString({ a: undefined })).toBe("");
    expect(toQueryString({ flag: true })).toBe("?flag=true");
  });
});

describe("UnisphereClient: every request", () => {
  test("logs in with Basic authentication and says it is OneUptime, reading JSON", async () => {
    const { transport, requests } = capture({
      status: 200,
      headers: {},
      body: JSON.stringify(VERSION_10_1),
    });
    const unisphere: UnisphereClient = new UnisphereClient({
      transport,
      username: USERNAME,
      password: PASSWORD,
    });

    await unisphere.getVersion();

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      method: "GET",
      path: "/univmax/restapi/version",
    });
    expect(requests[0]!.headers["Authorization"]).toBe(
      `Basic ${Buffer.from(`${USERNAME}:${PASSWORD}`).toString("base64")}`,
    );
    expect(requests[0]!.headers["Accept"]).toBe("application/json");
    expect(requests[0]!.headers["Application-Type"]).toBe(
      UNISPHERE_APPLICATION_TYPE,
    );
    expect(requests[0]!.headers["User-Agent"]).toMatch(/^OneUptime-Probe\//);
    // A GET sends no body, and says no content type.
    expect(requests[0]!.body).toBeUndefined();
    expect(requests[0]!.headers["Content-Type"]).toBeUndefined();
  });

  test("a performance query is a POST of JSON", async () => {
    const { transport, requests } = capture({
      status: 200,
      headers: {},
      body: JSON.stringify({ resultList: { result: [] } }),
    });
    const unisphere: UnisphereClient = new UnisphereClient({
      transport,
      username: USERNAME,
      password: PASSWORD,
    });

    await unisphere.getRealtimeStorageGroupMetrics({
      symmetrixId: ARRAY_V4,
      storageGroupId: "Oracle_PROD_SG",
      startMs: 1,
      endMs: 2,
      metrics: ["HostIOs"],
    });

    expect(requests[0]!.method).toBe("POST");
    expect(requests[0]!.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(requests[0]!.body!)).toEqual({
      symmetrixId: ARRAY_V4,
      category: "StorageGroups",
      instanceId: "Oracle_PROD_SG",
      metrics: ["HostIOs"],
      startDate: 1,
      endDate: 2,
    });
  });

  test("a classic path carries the REST API version it was set to; performance and the version do not", async () => {
    const unisphere: FakeUnisphere = makeUnisphere();
    const reader: UnisphereClient = client(unisphere, { apiVersion: "101" });

    expect(reader.getApiVersion()).toBe("101");
    expect(reader.getApiVersionNumber()).toBe(101);

    await reader.listArrayIds();
    await reader.getRegistrationDetails(ARRAY_V4);

    expect(
      unisphere.requests.map((request: { path: string }) => {
        return request.path;
      }),
    ).toEqual([
      "/univmax/restapi/101/system/symmetrix",
      `/univmax/restapi/performance/Array/registrationdetails/${ARRAY_V4}`,
    ]);
  });

  test("a refusal says its status, the path without its query, and Dell's message", async () => {
    const { transport } = capture({
      status: 400,
      headers: {},
      body: JSON.stringify({
        message: "A problem occurred retrieving the Storage Groups resource",
        http_status_code: 400,
        messages: [{ code: "0x0309", severity: "ERROR", message: "expired" }],
      }),
    });
    const unisphere: UnisphereClient = new UnisphereClient({
      transport,
      username: USERNAME,
      password: PASSWORD,
    });

    const error: unknown = await unisphere
      .get("/univmax/rest/v1/systems/000220200269/storage-groups?select=id")
      .catch((caught: unknown) => {
        return caught;
      });

    expect(error).toBeInstanceOf(UnisphereHttpError);
    const http: UnisphereHttpError = error as UnisphereHttpError;
    expect(http.status).toBe(400);
    expect(http.codes).toEqual(["0x0309"]);
    expect(http.serverMessage).toBe(
      "A problem occurred retrieving the Storage Groups resource",
    );
    expect(http.message).toBe(
      "Unisphere answered /univmax/rest/v1/systems/000220200269/storage-groups with HTTP 400: A problem occurred retrieving the Storage Groups resource",
    );
    expect(http.message).not.toContain(PASSWORD);
  });

  test("an HTML error page is a refusal with its status alone", async () => {
    const { transport } = capture({
      status: 401,
      headers: {},
      body: "<html><body>Unauthorized</body></html>",
    });
    const unisphere: UnisphereClient = new UnisphereClient({
      transport,
      username: USERNAME,
      password: PASSWORD,
    });

    await expect(unisphere.getVersion()).rejects.toMatchObject({
      name: "UnisphereHttpError",
      status: 401,
      serverMessage: "",
      message: "Unisphere answered /univmax/restapi/version with HTTP 401",
    });
  });

  test("a long server message is cut to 300 characters", async () => {
    const { transport } = capture({
      status: 500,
      headers: {},
      body: JSON.stringify({ message: "x".repeat(1000) }),
    });
    const unisphere: UnisphereClient = new UnisphereClient({
      transport,
      username: USERNAME,
      password: PASSWORD,
    });

    const error: UnisphereHttpError = (await unisphere
      .getVersion()
      .catch((caught: unknown) => {
        return caught;
      })) as UnisphereHttpError;

    expect(error.serverMessage).toHaveLength(300);
  });

  test("a 200 that is not JSON is not Unisphere's REST API", async () => {
    const { transport } = capture({
      status: 200,
      headers: {},
      body: "<!doctype html><title>Welcome to nginx</title>",
    });
    const unisphere: UnisphereClient = new UnisphereClient({
      transport,
      username: USERNAME,
      password: PASSWORD,
    });

    const error: unknown = await unisphere
      .getVersion()
      .catch((caught: unknown) => {
        return caught;
      });
    expect(error).toBeInstanceOf(UnisphereNotRestApiError);
    expect((error as Error).message).toBe(
      "/univmax/restapi/version did not answer as Unisphere's REST API: its answer is not JSON.",
    );
  });

  test("an empty 200 reads as an empty object", async () => {
    const { transport } = capture({ status: 200, headers: {}, body: "  " });
    const unisphere: UnisphereClient = new UnisphereClient({
      transport,
      username: USERNAME,
      password: PASSWORD,
    });

    await expect(unisphere.get("/anything")).resolves.toEqual({});
    await expect(unisphere.listArrayIds()).resolves.toEqual([]);
  });
});

describe("UnisphereClient: the server and its arrays", () => {
  test("reads Unisphere's version as Dell's example writes it", async () => {
    const version: UnisphereVersion = await client(
      makeUnisphere({ version: VERSION_10_0 }),
    ).getVersion();

    expect(version).toEqual({
      version: "T10.0.1.12",
      apiVersion: "100",
      supportedApiVersions: ["100", "92", "91"],
    });
  });

  test("a version with no API version or list reads them off the version", async () => {
    const { transport } = capture({
      status: 200,
      headers: {},
      body: JSON.stringify({ version: "T10.2.0.1" }),
    });
    const version: UnisphereVersion = await new UnisphereClient({
      transport,
      username: USERNAME,
      password: PASSWORD,
    }).getVersion();

    expect(version).toEqual({
      version: "T10.2.0.1",
      apiVersion: "102",
      supportedApiVersions: ["102"],
    });
  });

  test("a version answer that names no version is not Unisphere's", async () => {
    const { transport } = capture({
      status: 200,
      headers: {},
      body: JSON.stringify({ status: "ok" }),
    });
    await expect(
      new UnisphereClient({
        transport,
        username: USERNAME,
        password: PASSWORD,
      }).getVersion(),
    ).rejects.toBeInstanceOf(UnisphereNotRestApiError);
  });

  test("supported versions that are not REST API numbers are left out", async () => {
    const { transport } = capture({
      status: 200,
      headers: {},
      body: JSON.stringify({
        version: "T10.4.0.83",
        api_version: "104",
        supported_api_versions: ["104", "beta", 103, "1040"],
      }),
    });
    const version: UnisphereVersion = await new UnisphereClient({
      transport,
      username: USERNAME,
      password: PASSWORD,
    }).getVersion();

    expect(version.supportedApiVersions).toEqual(["104", "103"]);
  });

  test("lists the arrays under PyU4V's key and under the OpenAPI example's", async () => {
    await expect(client(makeUnisphere()).listArrayIds()).resolves.toEqual([
      ARRAY_V4,
      ARRAY_V3,
      ARRAY_REMOTE,
    ]);
    await expect(
      client(
        makeUnisphere({ listKey: SYMMETRIX_LIST_KEY_OPENAPI }),
      ).listArrayIds(),
    ).resolves.toEqual([ARRAY_V4, ARRAY_V3, ARRAY_REMOTE]);
  });

  test("reads one array, its capacity, health, pools, alerts and directors where Dell puts them", async () => {
    const unisphere: FakeUnisphere = makeUnisphere();
    const reader: UnisphereClient = client(unisphere);

    expect((await reader.getSystemArray(ARRAY_V4))["model"]).toBe(
      "PowerMax_8500",
    );
    expect(
      (
        (await reader.getProvisioningArray(ARRAY_V4))[
          "system_capacity"
        ] as JSONObject
      )["usable_total_tb"],
    ).toBe(61.12);
    expect(
      (
        (await reader.getHealth(ARRAY_V4))[
          "health_score_metric"
        ] as Array<unknown>
      ).length,
    ).toBe(3);
    expect(await reader.listSrpIds(ARRAY_V3)).toEqual(["SRP_1", "SRP_2"]);
    expect((await reader.getSrp(ARRAY_V4, "SRP_1"))["srpId"]).toBe("SRP_1");

    // Only the open alerts of one severity: what the poller asks.
    expect(await reader.listOpenAlertIds(ARRAY_V4, "CRITICAL")).toEqual([
      "7b15910a-16e0-4b57-989a-d918efcba116",
    ]);
    expect(await reader.listOpenAlertIds(ARRAY_V4, "FATAL")).toEqual([]);
    const lastAlertQuery: { query: Record<string, string> } =
      unisphere.requests[unisphere.requests.length - 1]!;
    expect(lastAlertQuery.query).toEqual({
      acknowledged: "false",
      severity: "FATAL",
    });

    expect(
      (await reader.getAlert(ARRAY_V4, "d38a65d0-3a54-4170-9621-c876e0fe9ca4"))[
        "severity"
      ],
    ).toBe("WARNING");
  });

  test("an object id is escaped in its path", async () => {
    const { transport, requests } = capture({
      status: 200,
      headers: {},
      body: "{}",
    });
    const reader: UnisphereClient = new UnisphereClient({
      transport,
      username: USERNAME,
      password: PASSWORD,
    });
    reader.setApiVersion("104");

    await reader.getSrp(ARRAY_V4, "SRP 1/../x");
    await reader.getAlert(ARRAY_V4, "a?b");

    expect(requests[0]!.path).toBe(
      `/univmax/restapi/104/sloprovisioning/symmetrix/${ARRAY_V4}/srp/SRP%201%2F..%2Fx`,
    );
    expect(requests[1]!.path).toBe(
      `/univmax/restapi/104/system/symmetrix/${ARRAY_V4}/alert/a%3Fb`,
    );
  });

  test("an answer that is no object reads as none", async () => {
    const { transport } = capture({ status: 200, headers: {}, body: "[1,2]" });
    const reader: UnisphereClient = new UnisphereClient({
      transport,
      username: USERNAME,
      password: PASSWORD,
    });

    await expect(reader.getSystemArray(ARRAY_V4)).resolves.toEqual({});
    await expect(reader.listSrpIds(ARRAY_V4)).resolves.toEqual([]);
    await expect(reader.listDirectorIds(ARRAY_V4)).resolves.toEqual([]);
    await expect(reader.getRegistrationDetails(ARRAY_V4)).resolves.toBeNull();
    await expect(reader.listPerformanceCategories(ARRAY_V4)).resolves.toEqual(
      [],
    );
  });
});

describe("UnisphereClient: performance", () => {
  test("reads the registration Unisphere keeps for the array", async () => {
    const reader: UnisphereClient = client(makeUnisphere());

    await expect(
      reader.getRegistrationDetails(ARRAY_V4),
    ).resolves.toMatchObject({
      symmetrixId: ARRAY_V4,
      realtime: true,
      diagnostic: true,
      selectedSGs: "Oracle_PROD_SG",
    });
    // No registration: an empty list.
    await expect(
      reader.getRegistrationDetails(ARRAY_REMOTE),
    ).resolves.toBeNull();
  });

  test("lists the performance categories, by id or by name", async () => {
    const reader: UnisphereClient = client(makeUnisphere());
    expect(await reader.listPerformanceCategories(ARRAY_V4)).toEqual([
      "Array",
      "StorageGroup",
      "SRP",
      "FEDirector",
      "BEDirector",
      "FEPort",
      "RDFA",
      "RDFS",
    ]);

    const { transport } = capture({
      status: 200,
      headers: {},
      body: JSON.stringify({
        performance_categories: ["Array", { id: "SRP" }, 7, null],
      }),
    });
    expect(
      await new UnisphereClient({
        transport,
        username: USERNAME,
        password: PASSWORD,
      }).listPerformanceCategories(ARRAY_V4),
    ).toEqual(["Array", "SRP", "7"]);
  });

  test("keeps each instance's newest sample, its time apart from its metrics", async () => {
    const reader: UnisphereClient = client(makeUnisphere());
    const instances: Array<UnispherePerformanceInstance> =
      await reader.getPerformanceCategory(ARRAY_V4, "Array");

    expect(instances).toEqual([
      {
        id: ARRAY_V4,
        metrics: {
          HostIOs: 1500,
          HostMBs: 375,
          PercentReads: 80,
          PercentWrites: 20,
          ReadResponseTime: 0.2,
          WriteResponseTime: 0.4,
          PercentHit: 93,
          PercentCacheWP: 4,
          FEUtilization: 20,
          BEUtilization: 10,
          RDFUtilization: 5,
        },
        timestampMs: NOW_MS - 300_000,
      },
    ]);

    // Dell's BEDirector example, read as published.
    const directors: Array<UnispherePerformanceInstance> =
      await reader.getPerformanceCategory(ARRAY_V4, "BEDirector");
    expect(
      directors.map((instance: UnispherePerformanceInstance) => {
        return instance.id;
      }),
    ).toEqual(["DF-4B", "DF-3B"]);
    expect(directors[0]!.metrics["IOs"]).toBe(23.342194);
    expect(directors[0]!.timestampMs).toBe(1686657300000);
  });

  test("an instance with no id or no samples is left out; a sample with no time has none", async () => {
    const { transport } = capture({
      status: 200,
      headers: {},
      body: JSON.stringify({
        metric_instances: [
          { metrics: [{ HostIOs: 1, timestamp: 1 }] },
          { id: "SG_EMPTY", metrics: [] },
          { id: "SG_NOTIME", metrics: [{ HostIOs: "5", Label: "x" }] },
          "garbage",
        ],
      }),
    });
    const instances: Array<UnispherePerformanceInstance> =
      await new UnisphereClient({
        transport,
        username: USERNAME,
        password: PASSWORD,
      }).getPerformanceCategory(ARRAY_V4, "StorageGroup");

    expect(instances).toEqual([
      { id: "SG_NOTIME", metrics: { HostIOs: 5 }, timestampMs: null },
    ]);
  });

  test("lists a real-time category's metrics, as Unisphere's help answers them", async () => {
    const unisphere: FakeUnisphere = makeUnisphere();
    const metrics: Array<string> = await client(unisphere).listRealtimeMetrics(
      ARRAY_V4,
      "StorageGroups",
    );

    expect(metrics).toContain("HostIOs");
    expect(metrics).toContain("ReadResponseTime");
    expect(unisphere.requests[0]!.path).toBe(
      `/univmax/restapi/performance/realtime/help/${ARRAY_V4}/StorageGroups/metrics`,
    );
  });

  test("reads a real-time group's points in time order, inside the window asked", async () => {
    const reader: UnisphereClient = client(makeUnisphere());
    const points: Array<UnisphereTimedPoint> =
      await reader.getRealtimeStorageGroupMetrics({
        symmetrixId: ARRAY_V4,
        storageGroupId: "Oracle_PROD_SG",
        startMs: NOW_MS - 300_000,
        endMs: NOW_MS,
        metrics: ["HostIOs", "ReadResponseTime"],
      });

    expect(points).toEqual([
      {
        timestampMs: NOW_MS - 10_000,
        metrics: { HostIOs: 810, ReadResponseTime: 3 },
      },
      {
        timestampMs: NOW_MS - 5_000,
        metrics: { HostIOs: 820, ReadResponseTime: 3.2 },
      },
    ]);
  });

  test("points come back sorted, and a point with no time is left out", async () => {
    const { transport } = capture({
      status: 200,
      headers: {},
      body: JSON.stringify({
        resultList: {
          result: [
            { HostIOs: 3, timestamp: 30 },
            { HostIOs: 1, timestamp: 10 },
            { HostIOs: 9 },
            { HostIOs: 0, timestamp: 0 },
            { HostIOs: 2, timestamp: "20" },
          ],
        },
      }),
    });
    const points: Array<UnisphereTimedPoint> = await new UnisphereClient({
      transport,
      username: USERNAME,
      password: PASSWORD,
    }).getRealtimeStorageGroupMetrics({
      symmetrixId: ARRAY_V4,
      storageGroupId: "x",
      startMs: 0,
      endMs: 100,
      metrics: ["HostIOs"],
    });

    expect(
      points.map((point: UnisphereTimedPoint) => {
        return point.timestampMs;
      }),
    ).toEqual([10, 20, 30]);
  });

  test("reads every volume's points of the storage groups asked, with Dell's request shape", async () => {
    const unisphere: FakeUnisphere = makeUnisphere();
    const volumes: Array<{
      volumeId: string;
      storageGroups: string | null;
      points: Array<UnisphereTimedPoint>;
    }> = await client(unisphere).getVolumeMetrics({
      symmetrixId: ARRAY_V4,
      storageGroupIds: ["Oracle_PROD_SG", "Empty_SG"],
      startMs: NOW_MS - 900_000,
      endMs: NOW_MS,
      metrics: ["IoRate", "ResponseTime"],
    });

    expect(unisphere.requests[0]!.body).toEqual({
      systemId: ARRAY_V4,
      commaSeparatedStorageGroupList: "Oracle_PROD_SG,Empty_SG",
      startDate: NOW_MS - 900_000,
      endDate: NOW_MS,
      dataFormat: "Average",
      metrics: ["IoRate", "ResponseTime"],
    });
    expect(volumes).toEqual([
      {
        volumeId: "00847",
        storageGroups: "Oracle_PROD_SG",
        points: [
          {
            timestampMs: NOW_MS - 600_000,
            metrics: { IoRate: 380, ResponseTime: 4 },
          },
          {
            timestampMs: NOW_MS - 300_000,
            metrics: { IoRate: 400, ResponseTime: 4.4 },
          },
        ],
      },
      {
        volumeId: "00848",
        storageGroups: "Oracle_PROD_SG",
        points: [
          {
            timestampMs: NOW_MS - 300_000,
            metrics: { IoRate: 410, ResponseTime: 4.1 },
          },
        ],
      },
    ]);
  });

  test("a volume metric Dell's enumeration does not have is refused whole", async () => {
    await expect(
      client(makeUnisphere()).getVolumeMetrics({
        symmetrixId: ARRAY_V4,
        storageGroupIds: ["Oracle_PROD_SG"],
        startMs: NOW_MS - 900_000,
        endMs: NOW_MS,
        metrics: ["HostIOs"],
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe("UnisphereClient: the enhanced lists", () => {
  test("asks only for the attributes named, filtered, paged from 10.3", async () => {
    const unisphere: FakeUnisphere = makeUnisphere();
    const page: UnispherePage = await client(unisphere).listEnhanced({
      symmetrixId: ARRAY_V4,
      objectType: "volumes",
      select: ["id", "cap_gb", "storage_groups"],
      filter: ["num_of_storage_groups gt 0"],
      pageSize: 1000,
      maxItems: 10_000,
    });

    expect(unisphere.requests[0]!.path).toBe(
      `/univmax/rest/v1/systems/${ARRAY_V4}/volumes`,
    );
    expect(unisphere.requests[0]!.query).toEqual({
      select: "id,cap_gb,storage_groups",
      filter: "num_of_storage_groups gt 0",
      limit: "1000",
      expiration_delay_secs: "60",
    });
    // The gatekeeper, in no storage group, is not listed.
    expect(
      page.items.map((item: JSONObject) => {
        return item["id"];
      }),
    ).toEqual(["006E7", "006E8", "00847", "00848"]);
    expect(page.items[2]).toEqual({
      id: "00847",
      cap_gb: 1024,
      storage_groups: [
        { id: "Oracle_PROD_SG", resource_type: "storage-groups" },
      ],
    });
    expect(page.total).toBe(4);
    expect(page.isTruncated).toBe(false);
  });

  test("a Unisphere before 10.3 is asked without paging, and answers in one list", async () => {
    const unisphere: FakeUnisphere = makeUnisphere({ version: VERSION_10_1 });
    const page: UnispherePage = await client(unisphere, {
      apiVersion: "101",
    }).listEnhanced({
      symmetrixId: ARRAY_V4,
      objectType: "storage-groups",
      select: ["id"],
      pageSize: 1000,
      maxItems: 10_000,
    });

    expect(unisphere.requests[0]!.query).toEqual({ select: "id" });
    expect(page.items).toHaveLength(4);
    expect(page.total).toBe(4);
  });

  test("follows Dell's `next` page by page until none remains", async () => {
    const unisphere: FakeUnisphere = makeUnisphere();
    const groups: Array<JSONObject> = [];
    for (let index: number = 0; index < 2501; index++) {
      groups.push(
        enhancedStorageGroup({
          id: `SG_${String(index).padStart(4, "0")}`,
          symmetrixId: ARRAY_V4,
          volumes: 1,
          capGb: 1,
          usedGb: 0,
        }),
      );
    }
    unisphere.array(ARRAY_V4).storageGroups = groups;

    const page: UnispherePage = await client(unisphere).listEnhanced({
      symmetrixId: ARRAY_V4,
      objectType: "storage-groups",
      select: ["id", "num_of_volumes"],
      pageSize: 1000,
      maxItems: 10_000,
    });

    expect(page.items).toHaveLength(2501);
    expect(page.items[2500]).toEqual({ id: "SG_2500", num_of_volumes: 1 });
    expect(page.total).toBe(2501);
    expect(page.isTruncated).toBe(false);

    // Three pages: the first asked, then Dell's next (under /univmax).
    const asked: Array<{ path: string; query: Record<string, string> }> =
      unisphere.requestsTo(
        `/univmax/rest/v1/systems/${ARRAY_V4}/storage-groups`,
      );
    expect(asked).toHaveLength(3);
    expect(asked[1]!.query["resume_token"]).toBe("token-1");
    expect(asked[1]!.query["select"]).toBe("id,num_of_volumes");
    expect(asked[2]!.query["resume_token"]).toBe("token-2");
  });

  test("builds the next page itself when the server gives a token and no `next`", async () => {
    const answers: Array<JSONObject> = [
      {
        storage_groups: [{ id: "A" }],
        paging: {
          total_instances: 2,
          remaining_instances: 1,
          resume_token: "tok",
        },
      },
      {
        storage_groups: [{ id: "B" }],
        paging: { total_instances: 2, remaining_instances: 0 },
      },
    ];
    const requests: Array<StorageArrayHttpRequest> = [];
    const reader: UnisphereClient = new UnisphereClient({
      transport: async (
        request: StorageArrayHttpRequest,
      ): Promise<StorageArrayHttpResponse> => {
        requests.push(request);
        return {
          status: 200,
          headers: {},
          body: JSON.stringify(answers.shift()),
        };
      },
      username: USERNAME,
      password: PASSWORD,
    });
    reader.setApiVersion("103");

    const page: UnispherePage = await reader.listEnhanced({
      symmetrixId: ARRAY_V4,
      objectType: "storage-groups",
      select: ["id"],
      pageSize: 1,
      maxItems: 10,
    });

    expect(page.items).toEqual([{ id: "A" }, { id: "B" }]);
    expect(requests[1]!.path).toBe(
      `/univmax/rest/v1/systems/${ARRAY_V4}/storage-groups?select=id&limit=1&expiration_delay_secs=60&resume_token=tok`,
    );
  });

  test("a full `next` under /univmax is followed as it is", async () => {
    const answers: Array<JSONObject> = [
      {
        results: [{ id: "FA-1D" }],
        paging: {
          total_instances: 2,
          remaining_instances: 1,
          resume_token: "t",
          next: `/univmax/rest/v1/systems/${ARRAY_V4}/directors?resume_token=t&limit=1`,
        },
      },
      { results: [{ id: "FA-2D" }] },
    ];
    const requests: Array<StorageArrayHttpRequest> = [];
    const reader: UnisphereClient = new UnisphereClient({
      transport: async (
        request: StorageArrayHttpRequest,
      ): Promise<StorageArrayHttpResponse> => {
        requests.push(request);
        return {
          status: 200,
          headers: {},
          body: JSON.stringify(answers.shift()),
        };
      },
      username: USERNAME,
      password: PASSWORD,
    });
    reader.setApiVersion("104");

    const page: UnispherePage = await reader.listEnhanced({
      symmetrixId: ARRAY_V4,
      objectType: "directors",
      select: ["id"],
      pageSize: 1,
      maxItems: 10,
    });

    expect(page.items).toEqual([{ id: "FA-1D" }, { id: "FA-2D" }]);
    expect(requests[1]!.path).toBe(
      `/univmax/rest/v1/systems/${ARRAY_V4}/directors?resume_token=t&limit=1`,
    );
  });

  test("stops at the most it was asked to read, and says how many there are", async () => {
    const unisphere: FakeUnisphere = makeUnisphere();
    const page: UnispherePage = await client(unisphere).listEnhanced({
      symmetrixId: ARRAY_V4,
      objectType: "storage-groups",
      select: ["id"],
      pageSize: 1,
      maxItems: 1,
    });

    // One id and the total: how a test counts what the account can see.
    expect(page).toEqual({
      items: [{ id: "PF_PMUNI-16037_1" }],
      total: 4,
      isTruncated: true,
    });
    expect(
      unisphere.requestsTo(
        `/univmax/rest/v1/systems/${ARRAY_V4}/storage-groups`,
      ),
    ).toHaveLength(1);
  });

  test("reads each kind's list under Dell's keys: storage_groups, volumes, results", async () => {
    const reader: UnisphereClient = client(makeUnisphere());
    for (const [objectType, count] of [
      ["storage-groups", 4],
      ["volumes", 5],
      ["directors", 5],
      ["ports", 3],
      ["rdf-groups", 2],
    ] as Array<
      [
        "storage-groups" | "volumes" | "directors" | "ports" | "rdf-groups",
        number,
      ]
    >) {
      const page: UnispherePage = await reader.listEnhanced({
        symmetrixId: ARRAY_V4,
        objectType,
        select: ["id"],
        pageSize: 1000,
        maxItems: 10_000,
      });
      expect({ objectType, count: page.items.length }).toEqual({
        objectType,
        count,
      });
    }
  });

  test("an unknown attribute is refused with HTTP 400, as the enhanced endpoints do", async () => {
    await expect(
      client(
        makeUnisphere({
          unknownAttributes: {
            "storage-groups": ["effective_used_capacity_gb"],
          },
        }),
      ).listEnhanced({
        symmetrixId: ARRAY_V4,
        objectType: "storage-groups",
        select: ["id", "effective_used_capacity_gb"],
        pageSize: 1000,
        maxItems: 10,
      }),
    ).rejects.toMatchObject({ status: 400, codes: ["0x0002"] });
  });

  test("an expired resume token is refused with Dell's 0x0309", async () => {
    const reader: UnisphereClient = client(makeUnisphere());
    await expect(
      reader.get(
        `/univmax/rest/v1/systems/${ARRAY_V4}/storage-groups?resume_token=gone&limit=2`,
      ),
    ).rejects.toMatchObject({ status: 400, codes: ["0x0309"] });
  });
});
