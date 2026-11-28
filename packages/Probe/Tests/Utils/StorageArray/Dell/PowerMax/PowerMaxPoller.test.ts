import { beforeEach, describe, expect, test } from "@jest/globals";
import { JSONObject } from "Common/Types/JSON";
import StorageArrayCollectionErrorCode from "Common/Types/StorageArray/Collection/StorageArrayCollectionErrorCode";
import {
  StorageArrayCollectionArraySummary,
  StorageArrayCollectionReport,
  StorageArrayConnectionTestReport,
} from "Common/Types/StorageArray/Collection/StorageArrayProbeCollection";
import {
  POWERMAX_ENDPOINTS,
  POWERMAX_LABELS,
  POWERMAX_METRICS,
  POWERMAX_PORT_KIND,
  POWERMAX_SYMMETRIX_ID_ATTRIBUTE,
  PowerMaxKind,
} from "Common/Types/StorageArray/Platforms/Dell/PowerMax/PowerMaxSeries";
import StorageArrayResourceKind from "Common/Types/StorageArray/StorageArrayResourceKind";
import {
  MAX_NEW_ALERT_DETAILS_PER_ARRAY,
  PowerMaxPoller,
  REALTIME_STORAGE_GROUP_FALLBACK_METRICS,
  VOLUME_METRICS,
  clearPowerMaxAlertCache,
} from "../../../../../Utils/StorageArray/Dell/PowerMax/PowerMaxPoller";
import { MB } from "../../../../../Utils/StorageArray/Dell/PowerMax/PowerMaxReading";
import { StorageArrayHttpRequest } from "../../../../../Utils/StorageArray/StorageArrayTransport";
import FakeUnisphere, {
  FakeArray,
  RecordedRequest,
} from "./Helpers/FakeUnisphere";
import {
  OtlpPoint,
  pointOf,
  pointsOf,
  resourceAttributesOf,
} from "./Helpers/OtlpPoints";
import {
  ADDRESS,
  ARRAY_REMOTE,
  ARRAY_V3,
  ARRAY_V4,
  NOW_MS,
  PASSWORD,
  PollerHarness,
  USERNAME,
  collectionJob,
  harness,
  makeUnisphere,
  remoteArray,
  testJob,
  v3Array,
  v4Array,
  withClassicDirectors,
} from "./Helpers/PowerMaxScenario";
import {
  VERSION_10_0,
  VERSION_10_1,
  alert,
  enhancedError,
} from "./Helpers/UnisphereRecordings";

/*
 * THE POWERMAX POLLER, END TO END (#11004), against a Unisphere that
 * answers as Dell documents it (FakeUnisphere, Dell's own examples): a
 * PowerMax 8500 on PowerMaxOS 10, a PowerMax 2000 on 5978 and a remote
 * array seen through SRDF.
 *
 * A test says what the account can see on each array and whether Unisphere
 * collects its performance, and names what is wrong in every case; a
 * collection reads every local array into the platform's series, leaves out
 * one part with a warning rather than fail, fails only for what stops every
 * array, and fits into one upload. Neither ever puts the password anywhere
 * but the Authorization header.
 */

const M: typeof POWERMAX_METRICS = POWERMAX_METRICS;
const L: typeof POWERMAX_LABELS = POWERMAX_LABELS;

// One alert's details: /104/system/symmetrix/{id}/alert/{alertId}.
const ALERT_DETAIL_PATH: RegExp = /\/alert\/.+/;

function poller(
  unisphere: FakeUnisphere,
  options: {
    collectionTimeoutInMs?: number;
    testTimeoutInMs?: number;
    maxPayloadBytes?: number;
  } = {},
): { poller: PowerMaxPoller; harness: PollerHarness } {
  const setup: PollerHarness = harness(unisphere);
  return {
    harness: setup,
    poller: new PowerMaxPoller({
      dependencies: setup.dependencies,
      ...options,
    }),
  };
}

function arrayOf(
  summary: { arrays: Array<StorageArrayCollectionArraySummary> } | undefined,
  id: string,
): StorageArrayCollectionArraySummary {
  const array: StorageArrayCollectionArraySummary | undefined =
    summary?.arrays.find((entry: StorageArrayCollectionArraySummary) => {
      return entry.id === id;
    });
  if (!array) {
    throw new Error(`No array ${id} in the summary`);
  }
  return array;
}

function resourceOf(
  report: StorageArrayCollectionReport,
  id: string,
): JSONObject {
  const resource: JSONObject | undefined = (
    (report.resourceMetrics || []) as Array<JSONObject>
  ).find((entry: JSONObject): boolean => {
    return resourceAttributesOf(entry)[POWERMAX_SYMMETRIX_ID_ATTRIBUTE] === id;
  });
  if (!resource) {
    throw new Error(`No resource for ${id}`);
  }
  return resource;
}

function listed(resource: JSONObject): Record<string, number> {
  const marks: Record<string, number> = {};
  for (const point of pointsOf(resource, M.inventoryListed)) {
    marks[point.labels[L.scrapeEndpoint]!] = point.value;
  }
  return marks;
}

// Nothing a poller answers may carry the password, however it failed.
function expectNoPassword(value: unknown): void {
  const text: string = JSON.stringify(value);
  expect(text.includes(PASSWORD)).toBe(false);
  expect(
    text.includes(Buffer.from(`${USERNAME}:${PASSWORD}`).toString("base64")),
  ).toBe(false);
}

beforeEach(() => {
  clearPowerMaxAlertCache();
});

describe("PowerMaxPoller: Test connection", () => {
  test("says what the account can see on each array, and whether Unisphere collects its performance", async () => {
    const unisphere: FakeUnisphere = makeUnisphere();
    const { poller: reader, harness: setup } = poller(unisphere);

    const report: StorageArrayConnectionTestReport =
      await reader.test(testJob());

    expect(report.status).toBe("Succeeded");
    expect(report.storageArrayConnectionTestId).toBe(
      testJob().storageArrayConnectionTestId,
    );
    expect(report.summary).toMatchObject({
      serverProductName: "Unisphere for PowerMax",
      serverVersion: "T10.4.0.83",
      apiVersion: "104",
      warnings: [],
    });
    expect(arrayOf(report.summary, ARRAY_V4)).toEqual({
      id: ARRAY_V4,
      model: "PowerMax_8500",
      osVersion: "6079.275.0",
      isLocal: true,
      isCollected: false,
      isPerformanceCollected: true,
      isRealtimeCollected: true,
      realtimeObjects: ["Oracle_PROD_SG"],
      // The gatekeeper is not a volume hosts see.
      counts: {
        [PowerMaxKind.StorageGroup]: 4,
        [StorageArrayResourceKind.Volume]: 4,
      },
      warnings: [],
    });
    expect(arrayOf(report.summary, ARRAY_V3)).toMatchObject({
      model: "PowerMax_2000",
      osVersion: "5978.669.669",
      isLocal: true,
      isPerformanceCollected: false,
      counts: {
        [PowerMaxKind.StorageGroup]: 2,
        [StorageArrayResourceKind.Volume]: 2,
      },
      warnings: [
        `Performance collection is off for ${ARRAY_V3}: turn it on in Unisphere at Settings > Performance > System Registrations (Diagnostic). Until then, its inventory and alerts are collected, its performance is not.`,
      ],
    });
    expect(arrayOf(report.summary, ARRAY_REMOTE)).toMatchObject({
      isLocal: false,
      warnings: [
        `${ARRAY_REMOTE} is a remote array this Unisphere sees through SRDF. Connect the Unisphere at its own site to collect it.`,
      ],
    });

    // Reached through the address's pinned addresses, closed after.
    expect(setup.transports).toEqual([
      {
        host: "unisphere.example.com",
        port: 8443,
        pinnedAddresses: ["192.0.2.10"],
        trustedFingerprint: null,
      },
    ]);
    expect(setup.closed()).toBe(1);
    expectNoPassword(report);
  });

  test("counts with one id per kind and Unisphere's total, and asks nothing of a remote array but what it is", async () => {
    const unisphere: FakeUnisphere = makeUnisphere();
    await poller(unisphere).poller.test(testJob());

    const groups: Array<RecordedRequest> = unisphere.requestsTo(
      `/univmax/rest/v1/systems/${ARRAY_V4}/storage-groups`,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]!.query).toMatchObject({ select: "id", limit: "1" });
    expect(
      unisphere.requests.filter((request: RecordedRequest): boolean => {
        return request.path.includes(ARRAY_REMOTE);
      }),
    ).toHaveLength(1);
  });

  test("a Unisphere before 10.3 is counted id by id, and says what it cannot list", async () => {
    const unisphere: FakeUnisphere = makeUnisphere({ version: VERSION_10_1 });
    const report: StorageArrayConnectionTestReport =
      await poller(unisphere).poller.test(testJob());

    expect(report.status).toBe("Succeeded");
    expect(report.summary!.apiVersion).toBe("101");
    expect(arrayOf(report.summary, ARRAY_V4).counts).toEqual({
      [PowerMaxKind.StorageGroup]: 4,
      [StorageArrayResourceKind.Volume]: 4,
    });
    expect(report.summary!.warnings).toEqual([
      "Unisphere T10.1.0.468 lists no ports or SRDF groups for a read-only account. Upgrade to Unisphere for PowerMax 10.3 or later to see them; directors, storage groups, volumes and performance are read either way.",
    ]);
    // No paging on 10.1: never `limit`, which it refuses.
    for (const request of unisphere.requests) {
      expect(request.query["limit"]).toBeUndefined();
    }
  });

  test("an account without PerfMonitor is told so, and the test still succeeds", async () => {
    const report: StorageArrayConnectionTestReport = await poller(
      makeUnisphere(),
    ).poller.test(testJob({ username: "monitor-only" }));

    expect(report.status).toBe("Succeeded");
    expect(arrayOf(report.summary, ARRAY_V4)).toMatchObject({
      isPerformanceCollected: null,
      isRealtimeCollected: null,
      counts: {
        [PowerMaxKind.StorageGroup]: 4,
        [StorageArrayResourceKind.Volume]: 4,
      },
      warnings: [
        `The account may not read whether Unisphere collects the performance of ${ARRAY_V4}: give the Unisphere user the PerfMonitor role.`,
      ],
    });
  });

  test("performance collected but not readable by the account says to add PerfMonitor", async () => {
    const unisphere: FakeUnisphere = makeUnisphere({
      overrides: [
        {
          pathPrefix: `/univmax/rest/v1/systems/${ARRAY_V4}/performance-categories`,
          status: 403,
          body: JSON.stringify(enhancedError(403, "0x0403", "Forbidden")),
        },
      ],
    });
    const report: StorageArrayConnectionTestReport =
      await poller(unisphere).poller.test(testJob());

    expect(arrayOf(report.summary, ARRAY_V4).warnings).toEqual([
      `The account may not read the performance of ${ARRAY_V4}. Give the Unisphere user the PerfMonitor role, as well as Monitor.`,
    ]);
  });

  test("an array the account may not count says so, and the others are counted", async () => {
    const unisphere: FakeUnisphere = makeUnisphere({
      overrides: [
        {
          pathPrefix: `/univmax/rest/v1/systems/${ARRAY_V3}/volumes`,
          status: 500,
          body: JSON.stringify({ message: "Internal server error" }),
        },
      ],
    });
    const report: StorageArrayConnectionTestReport =
      await poller(unisphere).poller.test(testJob());

    expect(report.status).toBe("Succeeded");
    expect(arrayOf(report.summary, ARRAY_V3).counts).toEqual({
      [PowerMaxKind.StorageGroup]: 2,
    });
    expect(arrayOf(report.summary, ARRAY_V3).warnings).toContain(
      `The account could not count the volumes of ${ARRAY_V3}: Internal server error`,
    );
  });

  test("an account with a role on one array only reads that one, and says why not the others", async () => {
    const report: StorageArrayConnectionTestReport = await poller(
      makeUnisphere(),
    ).poller.test(testJob({ username: "one-array" }));

    expect(report.status).toBe("Succeeded");
    expect(arrayOf(report.summary, ARRAY_V4).counts).toEqual({
      [PowerMaxKind.StorageGroup]: 4,
      [StorageArrayResourceKind.Volume]: 4,
    });
    expect(arrayOf(report.summary, ARRAY_V3)).toEqual({
      id: ARRAY_V3,
      isLocal: true,
      isCollected: false,
      counts: {},
      warnings: [
        `one-array may not read array ${ARRAY_V3} in Unisphere. Give the user the Monitor role on it (and PerfMonitor for performance).`,
      ],
    });
  });

  test("trusts the certificate the job names", async () => {
    const { poller: reader, harness: setup } = poller(makeUnisphere());
    await reader.test(
      testJob({
        trustedCertificateFingerprint:
          "AB:CD:EF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC",
      }),
    );
    expect(setup.transports[0]!.trustedFingerprint).toBe(
      "AB:CD:EF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC",
    );
  });

  test("a bare host is read on Unisphere's own port", async () => {
    const { poller: reader, harness: setup } = poller(makeUnisphere());
    const report: StorageArrayConnectionTestReport = await reader.test(
      testJob({ address: "unisphere.example.com" }),
    );
    expect(report.status).toBe("Succeeded");
    expect(setup.transports[0]).toMatchObject({
      host: "unisphere.example.com",
      port: 8443,
    });
  });
});

describe("PowerMaxPoller: what Test connection names when it fails", () => {
  async function failure(
    unisphere: FakeUnisphere,
    job: Parameters<PowerMaxPoller["test"]>[0] = testJob(),
    options: Parameters<typeof poller>[1] = {},
  ): Promise<StorageArrayConnectionTestReport> {
    const report: StorageArrayConnectionTestReport = await poller(
      unisphere,
      options,
    ).poller.test(job);
    expect(report.status).toBe("Failed");
    expectNoPassword(report);
    return report;
  }

  test("a wrong password", async () => {
    const report: StorageArrayConnectionTestReport = await failure(
      makeUnisphere(),
      testJob({ password: "not-the-password" }),
    );
    expect(report.errorCode).toBe(StorageArrayCollectionErrorCode.InvalidLogin);
    expect(report.errorMessage).toBe(
      `Unisphere at unisphere.example.com:8443 refused the login for ${USERNAME}: the user name or password is wrong, or the account is locked or not yet set up in Unisphere.`,
    );
  });

  test("an unknown user", async () => {
    const report: StorageArrayConnectionTestReport = await failure(
      makeUnisphere(),
      testJob({ username: "who" }),
    );
    expect(report.errorCode).toBe(StorageArrayCollectionErrorCode.InvalidLogin);
  });

  test("an account that may not use the REST API at all", async () => {
    const report: StorageArrayConnectionTestReport = await failure(
      makeUnisphere(),
      testJob({ username: "locked-out" }),
    );
    expect(report.errorCode).toBe(StorageArrayCollectionErrorCode.MissingRole);
    expect(report.errorMessage).toBe(
      "locked-out logged in to Unisphere at unisphere.example.com:8443 but may not use its REST API. Give the user the Monitor role (and PerfMonitor for performance).",
    );
  });

  test("an account with no role on any array", async () => {
    const report: StorageArrayConnectionTestReport = await failure(
      makeUnisphere(),
      testJob({ username: "no-roles" }),
    );
    expect(report.errorCode).toBe(StorageArrayCollectionErrorCode.MissingRole);
    expect(report.errorMessage).toBe(
      "no-roles logged in to Unisphere at unisphere.example.com:8443 but may not list its arrays. Give the user the Monitor role (and PerfMonitor for performance) on every array it should read.",
    );
  });

  test("an account that may read none of the arrays it lists", async () => {
    const unisphere: FakeUnisphere = makeUnisphere({
      users: {
        [USERNAME]: {
          password: PASSWORD,
          roles: [],
          arrayRoles: { "000000000000": ["Monitor"] },
        },
      },
    });
    const report: StorageArrayConnectionTestReport = await failure(unisphere);
    expect(report.errorCode).toBe(StorageArrayCollectionErrorCode.MissingRole);
    expect(report.errorMessage).toBe(
      `${USERNAME} may not read array ${ARRAY_V4} in Unisphere. Give the user the Monitor role on it (and PerfMonitor for performance).`,
    );
  });

  test("a Unisphere older than 10.1, with Dell's own 10.0 answer", async () => {
    const report: StorageArrayConnectionTestReport = await failure(
      makeUnisphere({ version: VERSION_10_0 }),
    );
    expect(report.errorCode).toBe(
      StorageArrayCollectionErrorCode.UnsupportedVersion,
    );
    expect(report.errorMessage).toBe(
      "Unisphere T10.0.1.12 is older than OneUptime reads. Upgrade to Unisphere for PowerMax 10.1 or later (10.3 or later to see ports and SRDF groups).",
    );
  });

  test("an address that is not Unisphere: no version path", async () => {
    const report: StorageArrayConnectionTestReport = await failure(
      makeUnisphere({
        overrides: [
          {
            pathPrefix: "/univmax/restapi/version",
            status: 404,
            body: "<html>Not Found</html>",
          },
        ],
      }),
    );
    expect(report.errorCode).toBe(
      StorageArrayCollectionErrorCode.NotManagementServer,
    );
    expect(report.errorMessage).toBe(
      "unisphere.example.com:8443 is not Unisphere for PowerMax's REST API (it does not answer /univmax/restapi/version). Enter the address and port you open Unisphere at, usually port 8443.",
    );
  });

  test("an address that is not Unisphere: a web page", async () => {
    const report: StorageArrayConnectionTestReport = await failure(
      makeUnisphere({
        overrides: [
          {
            pathPrefix: "/univmax/restapi/version",
            status: 200,
            body: "<!doctype html><title>Welcome</title>",
          },
        ],
      }),
    );
    expect(report.errorCode).toBe(
      StorageArrayCollectionErrorCode.NotManagementServer,
    );
  });

  test("a Unisphere that answers with an error", async () => {
    const report: StorageArrayConnectionTestReport = await failure(
      makeUnisphere({
        overrides: [
          {
            pathPrefix: "/univmax/restapi/version",
            status: 503,
            body: JSON.stringify({ message: "Unisphere is starting" }),
          },
        ],
      }),
    );
    expect(report.errorCode).toBe(StorageArrayCollectionErrorCode.ApiError);
    expect(report.errorMessage).toBe(
      "Unisphere at unisphere.example.com:8443 answered with an error: Unisphere is starting",
    );
  });

  test("a Unisphere that manages no array", async () => {
    const report: StorageArrayConnectionTestReport = await failure(
      makeUnisphere({ arrays: [] }),
    );
    expect(report.errorCode).toBe(StorageArrayCollectionErrorCode.NoArrays);
    expect(report.errorMessage).toBe(
      "Unisphere manages no array the account can see. Check that this Unisphere manages PowerMax arrays, and that the user has the Monitor role on them.",
    );
  });

  test("a Unisphere that only sees remote arrays", async () => {
    const report: StorageArrayConnectionTestReport = await failure(
      makeUnisphere({ arrays: [remoteArray()] }),
    );
    expect(report.errorCode).toBe(StorageArrayCollectionErrorCode.NoArrays);
    expect(report.errorMessage).toBe(
      "Unisphere sees one array, all remote (through SRDF). Connect the Unisphere that manages them locally.",
    );
  });

  test("an address that is no address", async () => {
    const report: StorageArrayConnectionTestReport = await failure(
      makeUnisphere(),
      testJob({ address: "ftp://unisphere.example.com" }),
    );
    expect(report.errorCode).toBe(
      StorageArrayCollectionErrorCode.InvalidAddress,
    );
  });

  test("a host name DNS does not know", async () => {
    const unisphere: FakeUnisphere = makeUnisphere();
    const setup: PollerHarness = harness(unisphere);
    const report: StorageArrayConnectionTestReport = await new PowerMaxPoller({
      dependencies: {
        ...setup.dependencies,
        resolve: async (): Promise<Array<string>> => {
          throw Object.assign(new Error("getaddrinfo ENOTFOUND"), {
            code: "ENOTFOUND",
          });
        },
      },
    }).test(testJob());

    expect(report.errorCode).toBe(
      StorageArrayCollectionErrorCode.AddressNotFound,
    );
    expect(report.errorMessage).toBe(
      "The probe cannot find unisphere.example.com in DNS (ENOTFOUND). Check the spelling, or use Unisphere's IP address.",
    );
    expect(unisphere.requests).toHaveLength(0);
  });

  test("an address the probe never connects to", async () => {
    const setup: PollerHarness = harness(makeUnisphere());
    const report: StorageArrayConnectionTestReport = await new PowerMaxPoller({
      dependencies: {
        ...setup.dependencies,
        resolve: async (): Promise<Array<string>> => {
          throw new Error(
            "The storage server address resolves to a loopback address (127.0.0.1), which is not allowed.",
          );
        },
      },
    }).test(testJob());

    expect(report.errorCode).toBe(
      StorageArrayCollectionErrorCode.AddressNotAllowed,
    );
  });

  test("a refused connection", async () => {
    const setup: PollerHarness = harness(makeUnisphere());
    const report: StorageArrayConnectionTestReport = await new PowerMaxPoller({
      dependencies: {
        ...setup.dependencies,
        createTransport: () => {
          return {
            transport: async () => {
              throw Object.assign(new Error("connect ECONNREFUSED"), {
                code: "ECONNREFUSED",
              });
            },
            close: () => {},
          };
        },
      },
    }).test(testJob());

    expect(report.errorCode).toBe(
      StorageArrayCollectionErrorCode.ConnectionRefused,
    );
    expect(report.errorMessage).toBe(
      "unisphere.example.com:8443 refused the connection: nothing listens on port 8443 there. Check the port Unisphere serves its REST API on.",
    );
  });

  test("a Unisphere that takes too long", async () => {
    const report: StorageArrayConnectionTestReport = await failure(
      makeUnisphere({
        delayInMs: (request: StorageArrayHttpRequest): number => {
          return request.path.endsWith("/system/symmetrix") ? 2000 : 0;
        },
      }),
      testJob(),
      { testTimeoutInMs: 1500 },
    );
    expect(report.errorCode).toBe(StorageArrayCollectionErrorCode.TimedOut);
    expect(report.errorMessage).toBe(
      "The test of Unisphere at unisphere.example.com:8443 took longer than 2 seconds. Unisphere may be overloaded: read it every 10 minutes, or check its health.",
    );
  });

  test("a probe bug is answered, never thrown", async () => {
    const setup: PollerHarness = harness(makeUnisphere());
    const report: StorageArrayConnectionTestReport = await new PowerMaxPoller({
      dependencies: {
        ...setup.dependencies,
        createTransport: () => {
          return {
            transport: async () => {
              throw new TypeError("undefined is not a function");
            },
            close: () => {},
          };
        },
      },
    }).test(testJob());

    expect(report.status).toBe("Failed");
    expect(report.errorCode).toBe(StorageArrayCollectionErrorCode.Internal);
    expect(report.errorMessage).toBe(
      "The probe hit an unexpected error: undefined is not a function",
    );
  });
});

describe("PowerMaxPoller: a collection", () => {
  test("reads every local array into one resource each, and the remote one into none", async () => {
    const unisphere: FakeUnisphere = makeUnisphere();
    const { poller: reader, harness: setup } = poller(unisphere);

    const report: StorageArrayCollectionReport =
      await reader.collect(collectionJob());

    expect(report).toMatchObject({
      storageArrayConnectionId: collectionJob().storageArrayConnectionId,
      settingsVersion: 7,
      collectedAt: new Date(NOW_MS).toISOString(),
      status: "Succeeded",
    });
    expect(report.resourceMetrics).toHaveLength(2);
    expect(report.summary).toMatchObject({
      serverProductName: "Unisphere for PowerMax",
      serverVersion: "T10.4.0.83",
      apiVersion: "104",
      resourceCount: 2,
      warnings: [],
    });

    expect(arrayOf(report.summary, ARRAY_V4)).toEqual({
      id: ARRAY_V4,
      model: "PowerMax_8500",
      osVersion: "6079.275.0",
      isLocal: true,
      isCollected: true,
      isPerformanceCollected: true,
      isRealtimeCollected: true,
      realtimeObjects: ["Oracle_PROD_SG"],
      counts: {
        [PowerMaxKind.StorageGroup]: 4,
        [StorageArrayResourceKind.Volume]: 4,
        [PowerMaxKind.StorageResourcePool]: 1,
        [PowerMaxKind.Director]: 5,
        [POWERMAX_PORT_KIND]: 3,
        [PowerMaxKind.SrdfGroup]: 2,
      },
      warnings: [],
    });
    expect(arrayOf(report.summary, ARRAY_V3)).toMatchObject({
      isCollected: true,
      isPerformanceCollected: false,
      counts: {
        [PowerMaxKind.StorageGroup]: 2,
        [StorageArrayResourceKind.Volume]: 2,
        [PowerMaxKind.StorageResourcePool]: 2,
        [PowerMaxKind.Director]: 1 + 1,
        [POWERMAX_PORT_KIND]: 1,
        [PowerMaxKind.SrdfGroup]: 0,
      },
      // Health scores an array has none of are not missed.
      warnings: [],
    });
    expect(arrayOf(report.summary, ARRAY_REMOTE).isCollected).toBe(false);

    let datapoints: number = 0;
    for (const resource of report.resourceMetrics as Array<JSONObject>) {
      for (const scope of resource["scopeMetrics"] as Array<JSONObject>) {
        for (const metric of scope["metrics"] as Array<JSONObject>) {
          datapoints += (
            (metric["gauge"] as JSONObject)["dataPoints"] as Array<unknown>
          ).length;
        }
      }
    }
    expect(report.summary!.datapointCount).toBe(datapoints);
    expect(setup.closed()).toBe(1);
    expectNoPassword(report);
  });

  test("never changes the array: every call is a read, or one of Unisphere's performance queries", async () => {
    const unisphere: FakeUnisphere = makeUnisphere();
    await poller(unisphere).poller.collect(collectionJob());

    for (const request of unisphere.requests) {
      if (request.method === "POST") {
        expect([
          "/univmax/restapi/performance/realtime/metrics",
          "/univmax/restapi/performance/Volume/metrics",
        ]).toContain(request.path);
      } else {
        expect(request.method).toBe("GET");
      }
      expect(request.authorization).toBe(
        `Basic ${Buffer.from(`${USERNAME}:${PASSWORD}`).toString("base64")}`,
      );
    }
  });

  test("marks every kind it read in full, so an empty list reads as empty", async () => {
    const report: StorageArrayCollectionReport =
      await poller(makeUnisphere()).poller.collect(collectionJob());

    expect(listed(resourceOf(report, ARRAY_V4))).toEqual({
      [POWERMAX_ENDPOINTS.array]: 3,
      [POWERMAX_ENDPOINTS.storageGroups]: 4,
      [POWERMAX_ENDPOINTS.volumes]: 4,
      [POWERMAX_ENDPOINTS.srps]: 1,
      [POWERMAX_ENDPOINTS.directors]: 5,
      [POWERMAX_ENDPOINTS.ports]: 3,
      [POWERMAX_ENDPOINTS.srdfGroups]: 2,
    });
    // No alert and no SRDF group: still read in full.
    expect(listed(resourceOf(report, ARRAY_V3))).toMatchObject({
      [POWERMAX_ENDPOINTS.array]: 0,
      [POWERMAX_ENDPOINTS.srdfGroups]: 0,
    });
  });

  test("the 8500's open alerts: what nobody acknowledged, Minor and up", async () => {
    const report: StorageArrayCollectionReport =
      await poller(makeUnisphere()).poller.collect(collectionJob());

    expect(
      pointsOf(resourceOf(report, ARRAY_V4), M.alertOpen).map(
        (point: OtlpPoint) => {
          return [point.labels[L.severity], point.labels[L.object]];
        },
      ),
    ).toEqual([
      ["critical", "OR-2C"],
      ["warning", "Oracle_PROD_SG"],
      ["warning", "SDAT1608_SG603"],
    ]);
  });

  test("the 8500's hardware: the offline director, the offline port someone relies on", async () => {
    const resource: JSONObject = resourceOf(
      await poller(makeUnisphere()).poller.collect(collectionJob()),
      ARRAY_V4,
    );

    expect(
      pointsOf(resource, M.directorOffline).map((point: OtlpPoint) => {
        return point.labels[L.director];
      }),
    ).toEqual(["OR-2C"]);
    expect(
      pointsOf(resource, M.portOffline).map((point: OtlpPoint) => {
        return [point.labels[L.portId], point.labels[L.protocol]];
      }),
    ).toEqual([["OR-4C:4", "iSCSI"]]);
    // The SRDF ports OR-1C:1 and :2 replicate group 88: in use.
    expect(
      pointOf(resource, M.portInfo, { [L.portId]: "OR-3C:35" })!.labels[
        L.inUse
      ],
    ).toBe("true");
  });

  test("the 8500's SRDF: group 88 in sync, group 12 suspended and behind", async () => {
    const resource: JSONObject = resourceOf(
      await poller(makeUnisphere()).poller.collect(collectionJob()),
      ARRAY_V4,
    );

    expect(
      pointOf(resource, M.srdfGroupInfo, { [L.srdfGroup]: "88" })!.labels,
    ).toMatchObject({
      [L.state]: "Synchronized",
      [L.mode]: "Synchronous",
      [L.remoteSymmetrixId]: ARRAY_REMOTE,
    });
    expect(
      pointsOf(resource, M.srdfGroupNotHealthy).map((point: OtlpPoint) => {
        return [point.labels[L.srdfGroup], point.labels[L.state]];
      }),
    ).toEqual([["12", "Suspended"]]);
    expect(
      pointOf(resource, M.srdfGroupLagSeconds, { [L.srdfGroup]: "12" })!.value,
    ).toBe(42);
    expect(
      pointOf(resource, M.srdfGroupThroughput, { [L.srdfGroup]: "12" })!.value,
    ).toBe(12.5 * MB);
    expect(
      pointOf(resource, M.srdfGroupResponseTime, { [L.srdfGroup]: "88" })!
        .value,
    ).toBe(900);
  });

  test("storage groups' 5-minute response times, in microseconds, from Unisphere's StorageGroup category", async () => {
    const resource: JSONObject = resourceOf(
      await poller(makeUnisphere()).poller.collect(collectionJob()),
      ARRAY_V4,
    );

    expect(
      pointOf(resource, M.storageGroupResponseTime, {
        [L.storageGroup]: "Oracle_PROD_SG",
      }),
    ).toEqual({
      value: 4200,
      labels: { [L.storageGroup]: "Oracle_PROD_SG" },
      timeMs: NOW_MS - 300_000,
    });
    expect(
      pointOf(resource, M.storageGroupInfo, {
        [L.storageGroup]: "Oracle_PROD_SG",
      })!.labels[L.realtime],
    ).toBe("true");
    expect(pointOf(resource, M.arrayIops)!.value).toBe(1500);
    expect(
      pointsOf(resource, M.arrayResponseTime).map((point: OtlpPoint) => {
        return [point.labels[L.operation], point.value];
      }),
    ).toEqual([
      ["read", 200],
      ["write", 400],
    ]);
  });

  test("real time: the registered group's 5-second points of the last five minutes, with the metrics its category has", async () => {
    const unisphere: FakeUnisphere = makeUnisphere();
    const resource: JSONObject = resourceOf(
      await poller(unisphere).poller.collect(collectionJob()),
      ARRAY_V4,
    );

    expect(
      pointsOf(resource, M.storageGroupRealtimeIops).map((point: OtlpPoint) => {
        return [point.timeMs, point.value];
      }),
    ).toEqual([
      [NOW_MS - 10_000, 810],
      [NOW_MS - 5_000, 820],
    ]);
    expect(
      pointsOf(resource, M.storageGroupRealtimeReadResponseTime).map(
        (point: OtlpPoint) => {
          return point.value;
        },
      ),
    ).toEqual([3000, 3200]);

    // Asked only for what the StorageGroups category lists (Dell's help answer).
    const asked: RecordedRequest = unisphere.requestsTo(
      "/univmax/restapi/performance/realtime/metrics",
    )[0]!;
    expect(asked.body).toEqual({
      symmetrixId: ARRAY_V4,
      category: "StorageGroups",
      instanceId: "Oracle_PROD_SG",
      metrics: ["HostIOs", "HostMBs", "ReadResponseTime", "WriteResponseTime"],
      startDate: NOW_MS - 300_000,
      endDate: NOW_MS,
    });
    // Without reads and writes, no overall response time is made up.
    expect(pointsOf(resource, M.storageGroupRealtimeResponseTime)).toEqual([]);
  });

  test("real time: with reads and writes listed, the overall response time is the two weighed", async () => {
    const v4: FakeArray = v4Array();
    v4.realtimeMetrics = [...v4.realtimeMetrics, "HostReads", "HostWrites"];
    const resource: JSONObject = resourceOf(
      await poller(
        makeUnisphere({ arrays: [v4, v3Array(), remoteArray()] }),
      ).poller.collect(collectionJob()),
      ARRAY_V4,
    );

    expect(
      pointsOf(resource, M.storageGroupRealtimeResponseTime)[0]!.value,
    ).toBeCloseTo(((3 * 600 + 6 * 210) / 810) * 1000, 6);
  });

  test("real time: when Unisphere cannot list the category's metrics, it asks for the ones every array has", async () => {
    const unisphere: FakeUnisphere = makeUnisphere({
      overrides: [
        {
          pathPrefix: "/univmax/restapi/performance/realtime/help/",
          status: 404,
          body: "{}",
        },
      ],
    });
    const report: StorageArrayCollectionReport =
      await poller(unisphere).poller.collect(collectionJob());

    expect(report.status).toBe("Succeeded");
    expect(
      unisphere.requestsTo("/univmax/restapi/performance/realtime/metrics")[0]!
        .body!["metrics"],
    ).toEqual([...REALTIME_STORAGE_GROUP_FALLBACK_METRICS]);
    expect(arrayOf(report.summary, ARRAY_V4).warnings).toEqual([]);
  });

  test("volumes' figures: each volume's newest 5-minute sample, IoRate as its IOPS", async () => {
    const unisphere: FakeUnisphere = makeUnisphere();
    const resource: JSONObject = resourceOf(
      await poller(unisphere).poller.collect(collectionJob()),
      ARRAY_V4,
    );

    expect(pointOf(resource, M.volumeIops, { [L.volume]: "00847" })).toEqual({
      value: 400,
      labels: { [L.volume]: "00847" },
      timeMs: NOW_MS - 300_000,
    });
    expect(
      pointOf(resource, M.volumeResponseTime, { [L.volume]: "00848" })!.value,
    ).toBe(4100);
    // Dell's metric names, the registered groups, at most an hour back.
    expect(
      unisphere.requestsTo("/univmax/restapi/performance/Volume/metrics")[0]!
        .body,
    ).toEqual({
      systemId: ARRAY_V4,
      commaSeparatedStorageGroupList: "Oracle_PROD_SG",
      startDate: NOW_MS - 900_000,
      endDate: NOW_MS,
      dataFormat: "Average",
      metrics: [...VOLUME_METRICS],
    });
  });

  test("an array whose performance collection is off is read without its performance", async () => {
    const unisphere: FakeUnisphere = makeUnisphere();
    const report: StorageArrayCollectionReport =
      await poller(unisphere).poller.collect(collectionJob());

    const resource: JSONObject = resourceOf(report, ARRAY_V3);
    expect(pointsOf(resource, M.arrayIops)).toEqual([]);
    expect(pointsOf(resource, M.arrayPerformanceCollection)[0]!.value).toBe(0);
    expect(
      unisphere.requests.filter((request: RecordedRequest): boolean => {
        return request.path.includes(`${ARRAY_V3}/performance-categories`);
      }),
    ).toEqual([]);
    // Its capacity is its pools' sum.
    expect(pointsOf(resource, M.arrayUsableBytes)[0]!.value).toBe(
      62.87 * 2 ** 40 + 20 * 2 ** 40,
    );
  });

  test("an alert is read once: a later collection reads only the alerts raised since", async () => {
    const unisphere: FakeUnisphere = makeUnisphere();
    const reader: PowerMaxPoller = poller(unisphere).poller;
    await reader.collect(collectionJob());
    const firstReads: number = unisphere.requests.filter(
      (request: RecordedRequest): boolean => {
        return ALERT_DETAIL_PATH.test(request.path);
      },
    ).length;
    expect(firstReads).toBe(3);

    unisphere.array(ARRAY_V4).alerts.push(
      alert({
        alertId: "new-alert",
        symmetrixId: ARRAY_V4,
        severity: "WARNING",
      }),
    );
    const report: StorageArrayCollectionReport =
      await reader.collect(collectionJob());

    expect(
      unisphere.requests.filter((request: RecordedRequest): boolean => {
        return ALERT_DETAIL_PATH.test(request.path);
      }).length,
    ).toBe(4);
    expect(pointsOf(resourceOf(report, ARRAY_V4), M.alertOpen)).toHaveLength(4);
  });

  test("reads at most so many new alerts in one collection, and the rest in the next", async () => {
    const v4: FakeArray = v4Array();
    v4.alerts = [];
    for (
      let index: number = 0;
      index < MAX_NEW_ALERT_DETAILS_PER_ARRAY + 50;
      index++
    ) {
      v4.alerts.push(
        alert({
          alertId: `alert-${index}`,
          symmetrixId: ARRAY_V4,
          severity: "WARNING",
        }),
      );
    }
    const unisphere: FakeUnisphere = makeUnisphere({
      arrays: [v4, v3Array()],
    });
    const reader: PowerMaxPoller = poller(unisphere).poller;

    const first: StorageArrayCollectionReport =
      await reader.collect(collectionJob());
    expect(arrayOf(first.summary, ARRAY_V4).warnings).toEqual([
      `50 more open alerts of ${ARRAY_V4} are read in the next collections.`,
    ]);
    expect(pointsOf(resourceOf(first, ARRAY_V4), M.alertOpen)).toHaveLength(
      MAX_NEW_ALERT_DETAILS_PER_ARRAY,
    );

    const second: StorageArrayCollectionReport =
      await reader.collect(collectionJob());
    expect(arrayOf(second.summary, ARRAY_V4).warnings).toEqual([]);
    expect(pointsOf(resourceOf(second, ARRAY_V4), M.alertOpen)).toHaveLength(
      MAX_NEW_ALERT_DETAILS_PER_ARRAY + 50,
    );
  });

  test("an alert deleted between the list and its read is not open any more", async () => {
    const unisphere: FakeUnisphere = makeUnisphere({
      overrides: [
        {
          pathPrefix: `/univmax/restapi/104/system/symmetrix/${ARRAY_V4}/alert/7b15910a`,
          status: 404,
          body: JSON.stringify({ message: "Cannot find alert" }),
        },
      ],
    });
    const report: StorageArrayCollectionReport =
      await poller(unisphere).poller.collect(collectionJob());

    expect(pointsOf(resourceOf(report, ARRAY_V4), M.alertOpen)).toHaveLength(2);
    expect(arrayOf(report.summary, ARRAY_V4).warnings).toEqual([]);
  });
});

describe("PowerMaxPoller: one part out of reach leaves that part out", () => {
  test("a list Unisphere fails to answer: a warning, no mark, the rest read", async () => {
    const unisphere: FakeUnisphere = makeUnisphere({
      overrides: [
        {
          pathPrefix: `/univmax/rest/v1/systems/${ARRAY_V4}/storage-groups`,
          status: 500,
          body: JSON.stringify({ message: "Internal server error" }),
        },
      ],
    });
    const report: StorageArrayCollectionReport =
      await poller(unisphere).poller.collect(collectionJob());

    expect(report.status).toBe("Succeeded");
    expect(arrayOf(report.summary, ARRAY_V4).warnings).toEqual([
      `Unisphere did not answer the storage groups of ${ARRAY_V4}: Internal server error`,
    ]);
    const resource: JSONObject = resourceOf(report, ARRAY_V4);
    expect(listed(resource)[POWERMAX_ENDPOINTS.storageGroups]).toBeUndefined();
    expect(listed(resource)[POWERMAX_ENDPOINTS.volumes]).toBe(4);
    // Its groups' performance is still measured.
    expect(pointsOf(resource, M.storageGroupResponseTime)).toHaveLength(2);
  });

  test("a part the account's role may not read says which role", async () => {
    const unisphere: FakeUnisphere = makeUnisphere({
      overrides: [
        {
          pathPrefix: `/univmax/rest/v1/systems/${ARRAY_V4}/directors`,
          status: 403,
          body: JSON.stringify(enhancedError(403, "0x0403", "Forbidden")),
        },
      ],
    });
    const report: StorageArrayCollectionReport =
      await poller(unisphere).poller.collect(collectionJob());

    expect(arrayOf(report.summary, ARRAY_V4).warnings).toEqual([
      `The account may not read the directors of ${ARRAY_V4}: give the Unisphere user the Monitor role.`,
    ]);
    expect(
      listed(resourceOf(report, ARRAY_V4))[POWERMAX_ENDPOINTS.directors],
    ).toBeUndefined();
  });

  test("an attribute an older Unisphere does not know is read without it", async () => {
    const unisphere: FakeUnisphere = makeUnisphere({
      unknownAttributes: {
        "storage-groups": ["effective_used_capacity_gb"],
        volumes: ["effective_used_capacity_gb"],
      },
    });
    const report: StorageArrayCollectionReport =
      await poller(unisphere).poller.collect(collectionJob());

    const resource: JSONObject = resourceOf(report, ARRAY_V4);
    expect(arrayOf(report.summary, ARRAY_V4).warnings).toEqual([]);
    expect(pointsOf(resource, M.storageGroupInfo)).toHaveLength(4);
    expect(pointsOf(resource, M.storageGroupCapacityBytes)).toHaveLength(4);
    expect(pointsOf(resource, M.storageGroupUsedBytes)).toEqual([]);
    expect(pointsOf(resource, M.volumeUsedBytes)).toEqual([]);
  });

  test("a performance category with nothing in it is not a warning; one that fails is", async () => {
    const unisphere: FakeUnisphere = makeUnisphere({
      overrides: [
        {
          pathPrefix: `/univmax/rest/v1/systems/${ARRAY_V4}/performance-categories/SRP`,
          status: 500,
          body: JSON.stringify({ message: "Timed out reading SRP" }),
        },
      ],
    });
    const report: StorageArrayCollectionReport =
      await poller(unisphere).poller.collect(collectionJob());

    expect(arrayOf(report.summary, ARRAY_V4).warnings).toEqual([
      `Unisphere did not answer the SRP performance of ${ARRAY_V4}: Timed out reading SRP`,
    ]);
  });

  test("real-time figures Unisphere refuses are a warning, the rest kept", async () => {
    const unisphere: FakeUnisphere = makeUnisphere({
      overrides: [
        {
          method: "POST",
          pathPrefix: "/univmax/restapi/performance/Volume/metrics",
          status: 400,
          body: JSON.stringify({
            message: "Storage group is not registered for real time",
          }),
        },
      ],
    });
    const report: StorageArrayCollectionReport =
      await poller(unisphere).poller.collect(collectionJob());

    expect(arrayOf(report.summary, ARRAY_V4).warnings).toEqual([
      `Unisphere did not answer the volume figures of the real-time storage groups on ${ARRAY_V4}: Storage group is not registered for real time`,
    ]);
    expect(
      pointsOf(resourceOf(report, ARRAY_V4), M.storageGroupRealtimeIops),
    ).toHaveLength(2);
  });

  test("a login refused in the middle stops the collection: it is never a warning", async () => {
    const unisphere: FakeUnisphere = makeUnisphere({
      overrides: [
        {
          pathPrefix: `/univmax/rest/v1/systems/${ARRAY_V4}/volumes`,
          status: 401,
          body: "",
        },
      ],
    });
    const report: StorageArrayCollectionReport =
      await poller(unisphere).poller.collect(collectionJob());

    expect(report.status).toBe("Failed");
    expect(report.errorCode).toBe(StorageArrayCollectionErrorCode.InvalidLogin);
    expect(report.resourceMetrics).toBeUndefined();
    expectNoPassword(report);
  });

  test("an array the account may not read is listed with why; the others are collected", async () => {
    const report: StorageArrayCollectionReport = await poller(
      makeUnisphere(),
    ).poller.collect(collectionJob({ username: "one-array" }));

    expect(report.status).toBe("Succeeded");
    expect(report.resourceMetrics).toHaveLength(1);
    expect(arrayOf(report.summary, ARRAY_V3)).toMatchObject({
      isCollected: false,
      warnings: [
        `one-array may not read array ${ARRAY_V3} in Unisphere. Give the user the Monitor role on it (and PerfMonitor for performance).`,
      ],
    });
  });
});

describe("PowerMaxPoller: Unisphere 10.1 and 10.2", () => {
  test("directors one by one, SRDF groups from the storage groups, no ports, and a warning", async () => {
    const unisphere: FakeUnisphere = makeUnisphere({
      version: VERSION_10_1,
      arrays: [withClassicDirectors(v4Array())],
    });
    const report: StorageArrayCollectionReport =
      await poller(unisphere).poller.collect(collectionJob());

    expect(report.status).toBe("Succeeded");
    expect(report.summary!.warnings).toEqual([
      "Unisphere T10.1.0.468 lists no ports or SRDF groups for a read-only account. Upgrade to Unisphere for PowerMax 10.3 or later to see them.",
    ]);
    const resource: JSONObject = resourceOf(report, ARRAY_V4);
    expect(listed(resource)).toMatchObject({
      [POWERMAX_ENDPOINTS.directors]: 25,
      [POWERMAX_ENDPOINTS.srdfGroups]: 2,
    });
    expect(listed(resource)[POWERMAX_ENDPOINTS.ports]).toBeUndefined();
    expect(
      pointsOf(resource, M.directorOffline).map((point: OtlpPoint) => {
        return point.labels[L.director];
      }),
    ).toEqual(["FA-3D"]);
    expect(
      pointsOf(resource, M.srdfGroupNotHealthy).map((point: OtlpPoint) => {
        return [point.labels[L.srdfGroup], point.labels[L.state]];
      }),
    ).toEqual([["12", "Suspended"]]);
    // Never the 10.3 endpoints.
    for (const request of unisphere.requests) {
      expect(request.path).not.toMatch(/\/(directors|ports|rdf-groups)$/);
    }
  });
});

describe("PowerMaxPoller: one upload", () => {
  test("too large with its volumes: the largest array's volumes go, with a warning, and their list is no longer marked complete", async () => {
    const unisphere: FakeUnisphere = makeUnisphere();
    const full: StorageArrayCollectionReport =
      await poller(unisphere).poller.collect(collectionJob());
    const fullSize: number = Buffer.byteLength(
      JSON.stringify(full.resourceMetrics),
    );
    clearPowerMaxAlertCache();

    const report: StorageArrayCollectionReport = await poller(makeUnisphere(), {
      maxPayloadBytes: fullSize - 1,
    }).poller.collect(collectionJob());

    expect(report.status).toBe("Succeeded");
    const warning: string = `The volumes of ${ARRAY_V4} were left out of this collection: all of it is larger than one probe upload may be. Read this Unisphere less often, or connect its arrays through more than one Unisphere.`;
    expect(report.summary!.warnings).toEqual([warning]);
    expect(arrayOf(report.summary, ARRAY_V4).warnings).toEqual([warning]);
    const resource: JSONObject = resourceOf(report, ARRAY_V4);
    expect(pointsOf(resource, M.volumeInfo)).toEqual([]);
    expect(pointsOf(resource, M.volumeIops)).toEqual([]);
    expect(listed(resource)[POWERMAX_ENDPOINTS.volumes]).toBeUndefined();
    // Everything else stays, the 2000's volumes too.
    expect(listed(resource)[POWERMAX_ENDPOINTS.storageGroups]).toBe(4);
    expect(pointsOf(resourceOf(report, ARRAY_V3), M.volumeInfo)).toHaveLength(
      2,
    );
    expect(
      Buffer.byteLength(JSON.stringify(report.resourceMetrics)),
    ).toBeLessThanOrEqual(fullSize - 1);
  });

  test("too large even without volumes: the collection says so", async () => {
    const report: StorageArrayCollectionReport = await poller(makeUnisphere(), {
      maxPayloadBytes: 1024,
    }).poller.collect(collectionJob());

    expect(report.status).toBe("Failed");
    expect(report.errorCode).toBe(
      StorageArrayCollectionErrorCode.PayloadTooLarge,
    );
    expect(report.errorMessage).toMatch(
      /^The collection is \d+ MiB of metrics, more than one probe upload may be \(0 MiB\), even without its volumes\.$/,
    );
  });
});

describe("PowerMaxPoller: the probe's limits", () => {
  test("a list longer than a collection reads is cut, said, and not marked complete", async () => {
    const v4: FakeArray = v4Array();
    const volumes: Array<JSONObject> = [];
    for (let index: number = 0; index < 10_001; index++) {
      volumes.push({
        id: index.toString(16).toUpperCase().padStart(5, "0"),
        type: "TDEV",
        status: "Ready",
        emulation: "FBA",
        cap_gb: 1,
        effective_used_capacity_gb: 0,
        num_of_storage_groups: 1,
        storage_groups: [{ id: "Bulk_SG" }],
      });
    }
    v4.volumes = volumes;
    const report: StorageArrayCollectionReport = await poller(
      makeUnisphere({ arrays: [v4] }),
    ).poller.collect(collectionJob());

    expect(report.status).toBe("Succeeded");
    const summary: StorageArrayCollectionArraySummary = arrayOf(
      report.summary,
      ARRAY_V4,
    );
    expect(summary.counts[StorageArrayResourceKind.Volume]).toBe(10_001);
    expect(summary.warnings).toEqual([
      `Only the first 10000 of 10001 volumes of ${ARRAY_V4} are listed. Their storage groups' figures cover every volume.`,
    ]);
    const resource: JSONObject = resourceOf(report, ARRAY_V4);
    expect(pointsOf(resource, M.volumeInfo)).toHaveLength(10_000);
    expect(listed(resource)[POWERMAX_ENDPOINTS.volumes]).toBeUndefined();
  });

  test("a collection that takes too long fails, saying how long it may take", async () => {
    const report: StorageArrayCollectionReport = await poller(
      makeUnisphere({
        delayInMs: (request: StorageArrayHttpRequest): number => {
          return request.path.includes("/volumes") ? 2000 : 0;
        },
      }),
      { collectionTimeoutInMs: 1500 },
    ).poller.collect(collectionJob());

    expect(report.status).toBe("Failed");
    expect(report.errorCode).toBe(StorageArrayCollectionErrorCode.TimedOut);
    expect(report.errorMessage).toBe(
      "The collection of Unisphere at unisphere.example.com:8443 took longer than 2 seconds. Unisphere may be overloaded: read it every 10 minutes, or check its health.",
    );
  });
});

describe("PowerMaxPoller: the platform", () => {
  test("polls Dell PowerMax, and picks the newest REST API from 10.1", () => {
    const reader: PowerMaxPoller = new PowerMaxPoller();
    expect(reader.storageSystem).toBe("dell.powermax");
    expect(
      reader.pickApiVersion({
        version: "T10.4.0.83",
        apiVersion: "104",
        supportedApiVersions: ["104", "103", "101"],
      }),
    ).toBe(104);
    expect(
      reader.pickApiVersion({
        version: "T10.1.0.468",
        apiVersion: "100",
        supportedApiVersions: ["101", "100"],
      }),
    ).toBe(101);
    expect(() => {
      return reader.pickApiVersion({
        version: "V9.2.1.4",
        apiVersion: "92",
        supportedApiVersions: ["92", "91"],
      });
    }).toThrow("Unisphere V9.2.1.4 is older than OneUptime reads.");
    expect(() => {
      return reader.pickApiVersion({
        version: "unknown",
        apiVersion: "",
        supportedApiVersions: [],
      });
    }).toThrow();
  });

  test("the address in a job is where every request goes", async () => {
    const { poller: reader, harness: setup } = poller(makeUnisphere());
    await reader.collect(
      collectionJob({ address: "https://10.0.0.5:9443/univmax/restapi" }),
    );
    expect(setup.transports[0]).toMatchObject({ host: "10.0.0.5", port: 9443 });
  });

  test("the address the scenario uses is the one Unisphere's users open", () => {
    expect(ADDRESS).toBe("https://unisphere.example.com:8443");
  });
});
