import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "Common/Types/JSON";
import {
  POWERMAX_ENDPOINTS,
  POWERMAX_LABELS,
  POWERMAX_METRICS,
  POWERMAX_PORT_KIND,
  POWERMAX_SYMMETRIX_ID_ATTRIBUTE,
  PowerMaxKind,
} from "Common/Types/StorageArray/Platforms/Dell/PowerMax/PowerMaxSeries";
import StorageArrayResourceKind from "Common/Types/StorageArray/StorageArrayResourceKind";
import PowerMaxOtlpBuilder, {
  getOverallResponseTimeMs,
} from "../../../../../Utils/StorageArray/Dell/PowerMax/PowerMaxOtlpBuilder";
import {
  GB,
  MB,
  PowerMaxArrayReading,
  PowerMaxDirector,
  PowerMaxPort,
  PowerMaxSrdfGroup,
  PowerMaxStorageGroup,
  TB,
} from "../../../../../Utils/StorageArray/Dell/PowerMax/PowerMaxReading";
import StorageArrayOtlpResource, {
  STORAGE_ARRAY_OTLP_SCOPE_NAME,
} from "../../../../../Utils/StorageArray/StorageArrayOtlp";
import { ARRAY_REMOTE, ARRAY_V4, NOW_MS } from "./Helpers/PowerMaxScenario";
import {
  OtlpPoint,
  metricNames,
  pointOf,
  pointsOf,
  resourceAttributesOf,
} from "./Helpers/OtlpPoints";

/*
 * One PowerMax reading as the platform's series (#11004): the names and
 * labels the extractor reads (PowerMaxSeries), Unisphere's milliseconds
 * as microseconds and its MB per second as bytes per second, and the
 * "listed in full" marks that let the server read an empty list as empty -
 * only for a list read in full.
 */

const M: typeof POWERMAX_METRICS = POWERMAX_METRICS;
const L: typeof POWERMAX_LABELS = POWERMAX_LABELS;

function reading(
  overrides: Partial<PowerMaxArrayReading> = {},
): PowerMaxArrayReading {
  return {
    symmetrixId: ARRAY_V4,
    model: "PowerMax_8500",
    microcode: "6079.275.0",
    isLocal: true,
    capacity: null,
    healthScores: [],
    registration: {
      diagnostic: null,
      realtime: null,
      realtimeStorageGroups: [],
    },
    performance: new Map(),
    storageGroups: null,
    volumes: null,
    srps: null,
    directors: null,
    ports: null,
    srdfGroups: null,
    alerts: null,
    realtimeStorageGroups: new Map(),
    volumePerformance: new Map(),
    totals: {},
    warnings: [],
    ...overrides,
  };
}

function build(data: Partial<PowerMaxArrayReading>): JSONObject {
  return PowerMaxOtlpBuilder.build({
    reading: reading(data),
    unisphereVersion: "T10.4.0.83",
    timeMs: NOW_MS,
  }).build("9.9.9");
}

function group(
  overrides: Partial<PowerMaxStorageGroup> = {},
): PowerMaxStorageGroup {
  return {
    id: "Oracle_PROD_SG",
    type: "child",
    srp: "SRP_1",
    serviceLevel: "Diamond",
    volumeCount: 2,
    capacityBytes: 2048 * GB,
    usedBytes: 1536 * GB,
    dataReductionRatio: 2.5,
    isRealtime: true,
    srdfStates: [],
    srdfModes: [],
    srdfGroups: [],
    ...overrides,
  };
}

function listed(resource: JSONObject): Record<string, number> {
  const marks: Record<string, number> = {};
  for (const point of pointsOf(resource, M.inventoryListed)) {
    marks[point.labels[L.scrapeEndpoint]!] = point.value;
  }
  return marks;
}

describe("PowerMaxOtlpBuilder: the resource", () => {
  test("is one resource named by the array's Symmetrix ID; the server stamps its name and platform", () => {
    const resource: JSONObject = build({});

    expect(resourceAttributesOf(resource)).toEqual({
      [POWERMAX_SYMMETRIX_ID_ATTRIBUTE]: ARRAY_V4,
    });
    expect(resource["scopeMetrics"]).toEqual([
      expect.objectContaining({
        scope: { name: STORAGE_ARRAY_OTLP_SCOPE_NAME, version: "9.9.9" },
      }),
    ]);
  });

  test("always says what the array is, on the collection's time", () => {
    const point: OtlpPoint = pointsOf(build({}), M.arrayInfo)[0]!;

    expect(point).toEqual({
      value: 1,
      labels: {
        [L.symmetrixId]: ARRAY_V4,
        [L.model]: "PowerMax_8500",
        [L.microcode]: "6079.275.0",
        [L.unisphereVersion]: "T10.4.0.83",
      },
      timeMs: NOW_MS,
    });
  });

  test("an unknown model or microcode is left off its labels", () => {
    expect(
      pointsOf(build({ model: null, microcode: null }), M.arrayInfo)[0]!.labels,
    ).toEqual({
      [L.symmetrixId]: ARRAY_V4,
      [L.unisphereVersion]: "T10.4.0.83",
    });
  });

  test("a reading with nothing read writes nothing but the array's info", () => {
    expect(metricNames(build({}))).toEqual([M.arrayInfo]);
  });
});

describe("PowerMaxOtlpBuilder: capacity and health", () => {
  test("writes usable, used, the used share, subscribed and data reduction", () => {
    const resource: JSONObject = build({
      capacity: {
        usableBytes: 61.12 * TB,
        usedBytes: 17.27 * TB,
        subscribedBytes: 261.74 * TB,
        dataReductionRatio: 3,
      },
    });

    expect(pointsOf(resource, M.arrayUsableBytes)[0]!.value).toBe(61.12 * TB);
    expect(pointsOf(resource, M.arrayUsedBytes)[0]!.value).toBe(17.27 * TB);
    expect(pointsOf(resource, M.arrayUsedPercent)[0]!.value).toBeCloseTo(
      (17.27 / 61.12) * 100,
      10,
    );
    expect(pointsOf(resource, M.arraySubscribedBytes)[0]!.value).toBe(
      261.74 * TB,
    );
    expect(pointsOf(resource, M.arrayDataReductionRatio)[0]!.value).toBe(3);
    // Usable first: the extractor derives the free space from it.
    expect(metricNames(resource).indexOf(M.arrayUsableBytes)).toBeLessThan(
      metricNames(resource).indexOf(M.arrayUsedBytes),
    );
  });

  test("the used share is at most 100%, and none without usable capacity", () => {
    expect(
      pointsOf(
        build({
          capacity: {
            usableBytes: TB,
            usedBytes: 2 * TB,
            subscribedBytes: null,
            dataReductionRatio: null,
          },
        }),
        M.arrayUsedPercent,
      )[0]!.value,
    ).toBe(100);
    expect(
      pointsOf(
        build({
          capacity: {
            usableBytes: 0,
            usedBytes: 0,
            subscribedBytes: null,
            dataReductionRatio: null,
          },
        }),
        M.arrayUsedPercent,
      ),
    ).toEqual([]);
  });

  test("each health score is one series, by its metric", () => {
    expect(
      pointsOf(
        build({
          healthScores: [
            { metric: "capacity", score: 100 },
            { metric: "configuration", score: 65 },
          ],
        }),
        M.arrayHealthScore,
      ).map((point: OtlpPoint) => {
        return [point.labels[L.healthMetric], point.value];
      }),
    ).toEqual([
      ["capacity", 100],
      ["configuration", 65],
    ]);
  });

  test("says whether Unisphere collects the array's performance, and in real time", () => {
    expect(
      pointsOf(
        build({
          registration: {
            diagnostic: true,
            realtime: true,
            realtimeStorageGroups: ["a"],
          },
        }),
        M.arrayPerformanceCollection,
      ),
    ).toEqual([
      expect.objectContaining({ value: 1, labels: { [L.realtime]: "true" } }),
    ]);
    expect(
      pointsOf(
        build({
          registration: {
            diagnostic: false,
            realtime: null,
            realtimeStorageGroups: [],
          },
        }),
        M.arrayPerformanceCollection,
      ),
    ).toEqual([
      expect.objectContaining({ value: 0, labels: { [L.realtime]: "false" } }),
    ]);
    // Unknown: nothing said.
    expect(pointsOf(build({}), M.arrayPerformanceCollection)).toEqual([]);
  });
});

describe("PowerMaxOtlpBuilder: the array's performance", () => {
  const at: number = NOW_MS - 300_000;

  function arrayPerformance(metrics: Record<string, number>): JSONObject {
    return build({
      performance: new Map([
        ["Array", [{ id: ARRAY_V4, metrics, timestampMs: at }]],
      ]),
    });
  }

  test("IOPS, bytes per second, response times in microseconds, by read and write, at the sample's time", () => {
    const resource: JSONObject = arrayPerformance({
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
    });

    expect(pointsOf(resource, M.arrayIops)[0]).toEqual({
      value: 1500,
      labels: {},
      timeMs: at,
    });
    expect(pointsOf(resource, M.arrayThroughput)[0]!.value).toBe(375 * MB);
    expect(pointsOf(resource, M.arrayReadIops)[0]!.value).toBe(1200);
    expect(pointsOf(resource, M.arrayWriteIops)[0]!.value).toBe(300);
    expect(pointsOf(resource, M.arrayReadThroughput)[0]!.value).toBe(
      375 * 0.8 * MB,
    );
    expect(pointsOf(resource, M.arrayWriteThroughput)[0]!.value).toBe(
      375 * 0.2 * MB,
    );
    expect(
      pointsOf(resource, M.arrayResponseTime).map((point: OtlpPoint) => {
        return [point.labels[L.operation], point.value];
      }),
    ).toEqual([
      ["read", 200],
      ["write", 400],
    ]);
    expect(pointsOf(resource, M.arrayCacheHitPercent)[0]!.value).toBe(93);
    expect(pointsOf(resource, M.arrayWritePendingPercent)[0]!.value).toBe(4);
    expect(pointsOf(resource, M.arrayFrontEndBusyPercent)[0]!.value).toBe(20);
    expect(pointsOf(resource, M.arrayBackEndBusyPercent)[0]!.value).toBe(10);
    expect(pointsOf(resource, M.arraySrdfBusyPercent)[0]!.value).toBe(5);
  });

  test("the write share is what reads leave when Unisphere gives only the read share", () => {
    const resource: JSONObject = arrayPerformance({
      HostIOs: 100,
      PercentReads: 70,
    });
    expect(pointsOf(resource, M.arrayReadIops)[0]!.value).toBe(70);
    expect(pointsOf(resource, M.arrayWriteIops)[0]!.value).toBeCloseTo(30, 10);
  });

  test("no read share, no read and write split", () => {
    const resource: JSONObject = arrayPerformance({ HostIOs: 100 });
    expect(pointsOf(resource, M.arrayReadIops)).toEqual([]);
    expect(pointsOf(resource, M.arrayWriteIops)).toEqual([]);
  });

  test("a negative response time (Unisphere's for none) is not written", () => {
    const resource: JSONObject = arrayPerformance({
      ReadResponseTime: -1,
      WriteResponseTime: 0.5,
    });
    expect(pointsOf(resource, M.arrayResponseTime)).toEqual([
      expect.objectContaining({ value: 500 }),
    ]);
  });

  test("the array's own instance is read, else the category's first", () => {
    const resource: JSONObject = build({
      performance: new Map([
        [
          "Array",
          [
            { id: "000000000001", metrics: { HostIOs: 1 }, timestampMs: at },
            { id: ARRAY_V4, metrics: { HostIOs: 2 }, timestampMs: at },
          ],
        ],
      ]),
    });
    expect(pointsOf(resource, M.arrayIops)[0]!.value).toBe(2);

    const other: JSONObject = build({
      performance: new Map([
        [
          "Array",
          [{ id: "000000000001", metrics: { HostIOs: 7 }, timestampMs: null }],
        ],
      ]),
    });
    // A sample with no time is written on the collection's.
    expect(pointsOf(other, M.arrayIops)[0]).toEqual({
      value: 7,
      labels: {},
      timeMs: NOW_MS,
    });
  });
});

describe("PowerMaxOtlpBuilder: alerts", () => {
  test("each open alert is one series with what it is about; the list is marked complete", () => {
    const resource: JSONObject = build({
      alerts: [
        {
          id: "7b15910a",
          severity: "critical",
          type: "ARRAY",
          object: "OR-2C",
          objectType: "Director",
          description: "Director OR-2C is offline.",
          createdMs: 1629119437000,
        },
        {
          id: "d38a65d0",
          severity: "warning",
          type: null,
          object: null,
          objectType: null,
          description: "Unisphere alert",
          createdMs: null,
        },
      ],
    });

    expect(listed(resource)).toEqual({ [POWERMAX_ENDPOINTS.array]: 2 });
    expect(
      pointsOf(resource, M.alertOpen).map((p: OtlpPoint) => {
        return p.labels;
      }),
    ).toEqual([
      {
        [L.alertId]: "7b15910a",
        [L.severity]: "critical",
        [L.alertType]: "ARRAY",
        [L.object]: "OR-2C",
        [L.objectType]: "Director",
        [L.description]: "Director OR-2C is offline.",
        [L.created]: "2021-08-16T13:10:37.000Z",
      },
      {
        [L.alertId]: "d38a65d0",
        [L.severity]: "warning",
        [L.description]: "Unisphere alert",
      },
    ]);
  });

  test("no open alert still says the alerts were read; alerts not read say nothing", () => {
    expect(listed(build({ alerts: [] }))).toEqual({
      [POWERMAX_ENDPOINTS.array]: 0,
    });
    expect(listed(build({ alerts: null }))).toEqual({});
  });
});

describe("PowerMaxOtlpBuilder: storage groups", () => {
  test("each group's info, capacity and volumes; the list marked complete with its count", () => {
    const resource: JSONObject = build({
      storageGroups: [
        group(),
        group({
          id: "VMware_DS_SG",
          isRealtime: false,
          serviceLevel: null,
          srdfStates: ["Synchronized", "Suspended"],
          srdfModes: ["Asynchronous", "Adaptive Copy"],
        }),
      ],
    });

    expect(listed(resource)).toEqual({
      [POWERMAX_ENDPOINTS.storageGroups]: 2,
    });
    expect(
      pointsOf(resource, M.storageGroupInfo).map((p: OtlpPoint) => {
        return p.labels;
      }),
    ).toEqual([
      {
        [L.storageGroup]: "Oracle_PROD_SG",
        [L.storageGroupType]: "child",
        [L.srp]: "SRP_1",
        [L.serviceLevel]: "Diamond",
        [L.realtime]: "true",
      },
      {
        [L.storageGroup]: "VMware_DS_SG",
        [L.storageGroupType]: "child",
        [L.srp]: "SRP_1",
        [L.realtime]: "false",
        // The worst of its pairs' states.
        [L.state]: "Suspended",
        [L.mode]: "Asynchronous, Adaptive Copy",
      },
    ]);
    expect(
      pointOf(resource, M.storageGroupCapacityBytes, {
        [L.storageGroup]: "Oracle_PROD_SG",
      })!.value,
    ).toBe(2048 * GB);
    expect(
      pointOf(resource, M.storageGroupUsedBytes, {
        [L.storageGroup]: "Oracle_PROD_SG",
      })!.value,
    ).toBe(1536 * GB);
    expect(pointsOf(resource, M.storageGroupVolumes)[0]!.value).toBe(2);
    expect(pointsOf(resource, M.storageGroupDataReductionRatio)[0]!.value).toBe(
      2.5,
    );
  });

  test("a list cut at the probe's limit is not marked complete", () => {
    const resource: JSONObject = build({
      storageGroups: [group()],
      totals: { [PowerMaxKind.StorageGroup]: 9000 },
    });
    expect(listed(resource)).toEqual({});
    expect(pointsOf(resource, M.storageGroupInfo)).toHaveLength(1);
  });

  test("no groups read and none there: marked complete at 0", () => {
    expect(listed(build({ storageGroups: [] }))).toEqual({
      [POWERMAX_ENDPOINTS.storageGroups]: 0,
    });
  });

  test("the 5-minute performance of every group measured, listed or not, in microseconds and bytes", () => {
    const at: number = NOW_MS - 300_000;
    const resource: JSONObject = build({
      performance: new Map([
        [
          "StorageGroup",
          [
            {
              id: "Oracle_PROD_SG",
              metrics: {
                ResponseTime: 4.2,
                ReadResponseTime: 3.1,
                WriteResponseTime: 6.5,
                HostIOs: 800,
                HostReads: 600,
                HostWrites: 200,
                HostMBs: 120,
                HostMBReads: 90,
                HostMBWritten: 30,
                PercentHit: 88,
                HostIOLimitPercentTimeExceeded: 12,
              },
              timestampMs: at,
            },
          ],
        ],
      ]),
    });
    const labels: Record<string, string> = {
      [L.storageGroup]: "Oracle_PROD_SG",
    };

    expect(pointOf(resource, M.storageGroupResponseTime, labels)).toEqual({
      value: 4200,
      labels,
      timeMs: at,
    });
    expect(pointOf(resource, M.storageGroupReadResponseTime)!.value).toBe(3100);
    expect(pointOf(resource, M.storageGroupWriteResponseTime)!.value).toBe(
      6500,
    );
    expect(pointOf(resource, M.storageGroupIops)!.value).toBe(800);
    expect(pointOf(resource, M.storageGroupReadIops)!.value).toBe(600);
    expect(pointOf(resource, M.storageGroupWriteIops)!.value).toBe(200);
    expect(pointOf(resource, M.storageGroupThroughput)!.value).toBe(120 * MB);
    expect(pointOf(resource, M.storageGroupReadThroughput)!.value).toBe(
      90 * MB,
    );
    expect(pointOf(resource, M.storageGroupWriteThroughput)!.value).toBe(
      30 * MB,
    );
    expect(pointOf(resource, M.storageGroupCacheHitPercent)!.value).toBe(88);
    expect(
      pointOf(resource, M.storageGroupHostIoLimitExceededPercent)!.value,
    ).toBe(12);
    // Performance alone is no list.
    expect(listed(resource)).toEqual({});
  });

  test("real time: every 5-second point of each registered group", () => {
    const resource: JSONObject = build({
      realtimeStorageGroups: new Map([
        [
          "Oracle_PROD_SG",
          [
            {
              timestampMs: NOW_MS - 10_000,
              metrics: {
                HostIOs: 810,
                HostMBs: 121,
                ReadResponseTime: 3,
                WriteResponseTime: 6,
                HostReads: 600,
                HostWrites: 210,
              },
            },
            {
              timestampMs: NOW_MS - 5_000,
              metrics: { HostIOs: 820, HostMBs: 122, ResponseTime: 4 },
            },
          ],
        ],
      ]),
    });

    expect(
      pointsOf(resource, M.storageGroupRealtimeIops).map((p: OtlpPoint) => {
        return [p.timeMs, p.value];
      }),
    ).toEqual([
      [NOW_MS - 10_000, 810],
      [NOW_MS - 5_000, 820],
    ]);
    expect(pointsOf(resource, M.storageGroupRealtimeThroughput)[0]!.value).toBe(
      121 * MB,
    );
    // No ResponseTime of its own: read and write weighed by reads and writes.
    const overall: Array<OtlpPoint> = pointsOf(
      resource,
      M.storageGroupRealtimeResponseTime,
    );
    expect(overall[0]!.value).toBeCloseTo(
      ((3 * 600 + 6 * 210) / (600 + 210)) * 1000,
      6,
    );
    // Unisphere's own when it has one.
    expect(overall[1]!.value).toBe(4000);
    expect(
      pointsOf(resource, M.storageGroupRealtimeReadResponseTime)[0]!.value,
    ).toBe(3000);
    expect(
      pointsOf(resource, M.storageGroupRealtimeWriteResponseTime)[0]!.value,
    ).toBe(6000);
  });
});

describe("PowerMaxOtlpBuilder: the overall response time", () => {
  test("is Unisphere's own, else read and write weighed by the I/O of each", () => {
    expect(getOverallResponseTimeMs({ ResponseTime: 2 })).toBe(2);
    expect(getOverallResponseTimeMs({ ResponseTime: 0 })).toBe(0);
    expect(
      getOverallResponseTimeMs({
        ReadResponseTime: 1,
        WriteResponseTime: 3,
        HostReads: 3,
        HostWrites: 1,
      }),
    ).toBe(1.5);
  });

  test("is none without both times and both counts, or with no I/O at all", () => {
    expect(getOverallResponseTimeMs({})).toBeUndefined();
    expect(
      getOverallResponseTimeMs({ ReadResponseTime: 1, WriteResponseTime: 3 }),
    ).toBeUndefined();
    expect(
      getOverallResponseTimeMs({
        ReadResponseTime: 1,
        WriteResponseTime: 3,
        HostReads: 0,
        HostWrites: 0,
      }),
    ).toBeUndefined();
    expect(
      getOverallResponseTimeMs({
        ReadResponseTime: 1,
        WriteResponseTime: 3,
        HostReads: -1,
        HostWrites: 5,
      }),
    ).toBeUndefined();
  });
});

describe("PowerMaxOtlpBuilder: volumes", () => {
  test("each volume's info and capacity, by its number and label; the list marked complete", () => {
    const resource: JSONObject = build({
      volumes: [
        {
          id: "00847",
          identifier: "ora_data_01",
          type: "TDEV",
          status: "Ready",
          emulation: "FBA",
          capacityBytes: 1024 * GB,
          usedBytes: 768 * GB,
          storageGroup: "Oracle_PROD_SG",
        },
        {
          id: "006E7",
          identifier: null,
          type: "TDEV",
          status: "Not Ready",
          emulation: "FBA",
          capacityBytes: 50 * GB,
          usedBytes: null,
          storageGroup: null,
        },
      ],
    });

    expect(listed(resource)).toEqual({ [POWERMAX_ENDPOINTS.volumes]: 2 });
    expect(
      pointsOf(resource, M.volumeInfo).map((p: OtlpPoint) => {
        return p.labels;
      }),
    ).toEqual([
      {
        [L.volume]: "00847",
        [L.volumeName]: "ora_data_01",
        [L.storageGroup]: "Oracle_PROD_SG",
        [L.emulation]: "FBA",
        [L.status]: "Ready",
      },
      {
        [L.volume]: "006E7",
        [L.emulation]: "FBA",
        [L.status]: "Not Ready",
      },
    ]);
    expect(
      pointsOf(resource, M.volumeCapacityBytes).map((p: OtlpPoint) => {
        return p.labels;
      }),
    ).toEqual([
      { [L.volume]: "00847", [L.volumeName]: "ora_data_01" },
      { [L.volume]: "006E7" },
    ]);
    // An unknown used capacity is not 0.
    expect(pointsOf(resource, M.volumeUsedBytes)).toHaveLength(1);
  });

  test("a cut list is not complete", () => {
    expect(
      listed(
        build({
          volumes: [],
          totals: { [StorageArrayResourceKind.Volume]: 20000 },
        }),
      ),
    ).toEqual({});
  });

  test("a volume's real-time figures: IoRate is its IOPS, response times in microseconds", () => {
    const at: number = NOW_MS - 300_000;
    const resource: JSONObject = build({
      volumePerformance: new Map([
        [
          "00847",
          {
            timestampMs: at,
            metrics: {
              IoRate: 400,
              HostMBs: 64,
              ResponseTime: 4.4,
              ReadResponseTime: 3.2,
              WriteResponseTime: 6.6,
            },
          },
        ],
        // An older answer naming HostIOs is still read.
        ["00848", { timestampMs: at, metrics: { HostIOs: 12 } }],
      ]),
    });

    expect(pointOf(resource, M.volumeIops, { [L.volume]: "00847" })).toEqual({
      value: 400,
      labels: { [L.volume]: "00847" },
      timeMs: at,
    });
    expect(
      pointOf(resource, M.volumeIops, { [L.volume]: "00848" })!.value,
    ).toBe(12);
    expect(pointOf(resource, M.volumeThroughput)!.value).toBe(64 * MB);
    expect(pointOf(resource, M.volumeResponseTime)!.value).toBe(4400);
    expect(pointOf(resource, M.volumeReadResponseTime)!.value).toBe(3200);
    expect(pointOf(resource, M.volumeWriteResponseTime)!.value).toBeCloseTo(
      6600,
      9,
    );
  });
});

describe("PowerMaxOtlpBuilder: storage resource pools", () => {
  test("each pool's capacity and used share; its performance by pool", () => {
    const resource: JSONObject = build({
      srps: [
        {
          id: "SRP_1",
          emulation: "FBA",
          usableBytes: 62.87 * TB,
          usedBytes: 36.96 * TB,
          subscribedBytes: 347.88 * TB,
          dataReductionRatio: 38.2,
        },
      ],
      performance: new Map([
        [
          "SRP",
          [
            {
              id: "SRP_1",
              metrics: { ResponseTime: 0.6, HostIOs: 1500, HostMBs: 375 },
              timestampMs: NOW_MS - 300_000,
            },
          ],
        ],
      ]),
    });

    expect(listed(resource)).toEqual({ [POWERMAX_ENDPOINTS.srps]: 1 });
    expect(pointsOf(resource, M.srpInfo)[0]!.labels).toEqual({
      [L.srp]: "SRP_1",
      [L.emulation]: "FBA",
    });
    expect(pointsOf(resource, M.srpUsableBytes)[0]!.value).toBe(62.87 * TB);
    expect(pointsOf(resource, M.srpUsedBytes)[0]!.value).toBe(36.96 * TB);
    expect(pointsOf(resource, M.srpUsedPercent)[0]!.value).toBeCloseTo(
      (36.96 / 62.87) * 100,
      10,
    );
    expect(pointsOf(resource, M.srpSubscribedBytes)[0]!.value).toBe(
      347.88 * TB,
    );
    expect(pointsOf(resource, M.srpDataReductionRatio)[0]!.value).toBe(38.2);
    expect(pointsOf(resource, M.srpResponseTime)[0]!.value).toBe(600);
    expect(pointsOf(resource, M.srpIops)[0]!.value).toBe(1500);
    expect(pointsOf(resource, M.srpThroughput)[0]!.value).toBe(375 * MB);
  });
});

describe("PowerMaxOtlpBuilder: directors", () => {
  const directors: Array<PowerMaxDirector> = [
    {
      id: "OR-1C",
      role: "frontend",
      type: "OSHostAndRDF",
      status: "Online",
      isOnline: true,
      engine: 1,
      slot: 1,
    },
    {
      id: "OR-2C",
      role: "frontend",
      type: "OSHostAndRDF",
      status: "Offline",
      isOnline: false,
      engine: 1,
      slot: 2,
    },
    {
      id: "DF-1C",
      role: "backend",
      type: "Back end",
      status: null,
      isOnline: false,
      engine: null,
      slot: null,
    },
  ];

  test("each director's info by its role; one that is not online has the offline series with why", () => {
    const resource: JSONObject = build({ directors });

    expect(listed(resource)).toEqual({ [POWERMAX_ENDPOINTS.directors]: 3 });
    expect(pointsOf(resource, M.directorInfo)[0]!.labels).toEqual({
      [L.director]: "OR-1C",
      [L.component]: "OR-1C",
      [L.role]: "frontend",
      [L.directorType]: "OSHostAndRDF",
      [L.status]: "Online",
      [L.engine]: "1",
      [L.slot]: "1",
    });
    expect(
      pointsOf(resource, M.directorOffline).map((p: OtlpPoint) => {
        return p.labels;
      }),
    ).toEqual([
      {
        [L.director]: "OR-2C",
        [L.component]: "OR-2C",
        [L.role]: "frontend",
        [L.status]: "Offline",
      },
      {
        [L.director]: "DF-1C",
        [L.component]: "DF-1C",
        [L.role]: "backend",
        [L.status]: "unknown",
      },
    ]);
  });

  test("their performance from the front-end, back-end and SRDF categories, whichever names Dell uses", () => {
    const at: number = NOW_MS - 300_000;
    const resource: JSONObject = build({
      performance: new Map([
        [
          "FEDirector",
          [
            {
              id: "OR-1C",
              metrics: {
                PercentBusy: 12.5,
                HostIOs: 700,
                HostMBs: 150,
                ReadResponseTime: 0.13,
                WriteResponseTime: 0.33,
              },
              timestampMs: at,
            },
          ],
        ],
        [
          "BEDirector",
          [
            {
              id: "DF-4B",
              metrics: { PercentBusy: 0, IOs: 23.342194, MBs: 1.8610752 },
              timestampMs: at,
            },
          ],
        ],
        [
          "RDFDirector",
          [
            {
              id: "RF-1E",
              metrics: { PercentBusy: 3, IOs: 10, MBSentAndReceived: 2 },
              timestampMs: at,
            },
          ],
        ],
      ]),
    });

    expect(
      pointsOf(resource, M.directorIops).map((p: OtlpPoint) => {
        return [p.labels[L.director], p.value];
      }),
    ).toEqual([
      ["OR-1C", 700],
      ["DF-4B", 23.342194],
      ["RF-1E", 10],
    ]);
    expect(
      pointsOf(resource, M.directorThroughput).map((p: OtlpPoint) => {
        return p.value;
      }),
    ).toEqual([150 * MB, 1.8610752 * MB, 2 * MB]);
    expect(
      pointsOf(resource, M.directorBusyPercent).map((p: OtlpPoint) => {
        return p.value;
      }),
    ).toEqual([12.5, 0, 3]);
    expect(pointOf(resource, M.directorReadResponseTime)!.value).toBe(130);
    expect(pointOf(resource, M.directorWriteResponseTime)!.value).toBe(330);
    expect(pointOf(resource, M.directorIops)!.labels).toEqual({
      [L.director]: "OR-1C",
      [L.component]: "OR-1C",
    });
  });
});

describe("PowerMaxOtlpBuilder: ports", () => {
  const port: PowerMaxPort = {
    id: "OR-3C:35",
    director: "OR-3C",
    port: "35",
    protocol: "NVMe over FC",
    type: "OSHostAndRDF",
    status: "ON",
    isOnline: true,
    isInUse: true,
    speedGbps: 16,
    rxPowerMilliwatts: 0.5,
    txPowerMilliwatts: 0.6,
  };

  test("each port's info, line rate in bytes per second and light levels", () => {
    const resource: JSONObject = build({ ports: [port] });

    expect(listed(resource)).toEqual({ [POWERMAX_ENDPOINTS.ports]: 1 });
    expect(pointsOf(resource, M.portInfo)[0]!.labels).toEqual({
      [L.portId]: "OR-3C:35",
      [L.component]: "OR-3C:35",
      [L.director]: "OR-3C",
      [L.port]: "35",
      [L.protocol]: "NVMe over FC",
      [L.portType]: "OSHostAndRDF",
      [L.status]: "ON",
      [L.inUse]: "true",
    });
    expect(pointsOf(resource, M.portSpeedBytes)[0]!.value).toBe(2_000_000_000);
    expect(pointsOf(resource, M.portRxPowerMilliwatts)[0]!.value).toBe(0.5);
    expect(pointsOf(resource, M.portTxPowerMilliwatts)[0]!.value).toBe(0.6);
    expect(pointsOf(resource, M.portOffline)).toEqual([]);
  });

  test("a port is down only when someone relies on it", () => {
    const resource: JSONObject = build({
      ports: [
        {
          ...port,
          id: "OR-4C:4",
          director: "OR-4C",
          port: "4",
          status: "Offline",
          isOnline: false,
        },
        {
          ...port,
          id: "OR-2C:6",
          director: "OR-2C",
          port: "6",
          status: "PendOn",
          isOnline: false,
          isInUse: false,
          speedGbps: 0,
        },
        {
          ...port,
          id: "FA-1D:4",
          director: "FA-1D",
          port: "4",
          status: null,
          isOnline: false,
        },
      ],
    });

    expect(
      pointsOf(resource, M.portOffline).map((p: OtlpPoint) => {
        return [p.labels[L.portId], p.labels[L.status]];
      }),
    ).toEqual([
      ["OR-4C:4", "Offline"],
      ["FA-1D:4", "unknown"],
    ]);
    // No line rate is not 0 bytes per second.
    expect(
      pointsOf(resource, M.portSpeedBytes).map((p: OtlpPoint) => {
        return p.labels[L.portId];
      }),
    ).toEqual(["OR-4C:4", "FA-1D:4"]);
  });

  test("port performance from the front-end, back-end and SRDF port categories, by director and number", () => {
    const resource: JSONObject = build({
      performance: new Map([
        [
          "FEPort",
          [
            {
              id: "OR-3C:035",
              metrics: {
                PercentBusy: 7,
                IOs: 320,
                MBRead: 40,
                MBWritten: 12,
                ResponseTime: 0.48414138,
              },
              timestampMs: NOW_MS - 300_000,
            },
            { id: "not-a-port", metrics: { IOs: 1 }, timestampMs: null },
          ],
        ],
        [
          "RDFPort",
          [
            {
              id: "OR-1C:1",
              metrics: { PercentBusy: 2, IOs: 30, MBRead: 1, MBWritten: 3 },
              timestampMs: NOW_MS - 300_000,
            },
          ],
        ],
      ]),
    });

    expect(
      pointsOf(resource, M.portIops).map((p: OtlpPoint) => {
        return p.labels;
      }),
    ).toEqual([
      {
        [L.portId]: "OR-3C:35",
        [L.component]: "OR-3C:35",
        [L.director]: "OR-3C",
        [L.port]: "35",
      },
      {
        [L.portId]: "OR-1C:1",
        [L.component]: "OR-1C:1",
        [L.director]: "OR-1C",
        [L.port]: "1",
      },
    ]);
    expect(pointOf(resource, M.portReadThroughput)!.value).toBe(40 * MB);
    expect(pointOf(resource, M.portWriteThroughput)!.value).toBe(12 * MB);
    expect(pointOf(resource, M.portResponseTime)!.value).toBeCloseTo(
      484.14138,
      6,
    );
    expect(pointOf(resource, M.portBusyPercent)!.value).toBe(7);
  });
});

describe("PowerMaxOtlpBuilder: SRDF groups", () => {
  const sync: PowerMaxSrdfGroup = {
    id: "88",
    label: "SGKG20a5ba",
    type: "Dynamic",
    modes: ["Synchronous"],
    states: ["Synchronized"],
    isOffline: false,
    remoteSymmetrixId: ARRAY_REMOTE,
    remoteGroup: "88",
    lagSeconds: null,
    volumeCount: 1,
    capacityBytes: 3.22 * GB,
    isWitnessDegraded: false,
  };

  test("each group's info; a group in sync is healthy", () => {
    const resource: JSONObject = build({ srdfGroups: [sync] });

    expect(listed(resource)).toEqual({ [POWERMAX_ENDPOINTS.srdfGroups]: 1 });
    expect(pointsOf(resource, M.srdfGroupInfo)[0]!.labels).toEqual({
      [L.srdfGroup]: "88",
      [L.srdfLabel]: "SGKG20a5ba",
      [L.remoteSymmetrixId]: ARRAY_REMOTE,
      [L.remoteSrdfGroup]: "88",
      [L.mode]: "Synchronous",
      [L.state]: "Synchronized",
    });
    expect(pointsOf(resource, M.srdfGroupNotHealthy)).toEqual([]);
    expect(pointsOf(resource, M.srdfGroupVolumes)[0]!.value).toBe(1);
    expect(pointsOf(resource, M.srdfGroupCapacityBytes)[0]!.value).toBe(
      3.22 * GB,
    );
    // A synchronous group has no lag.
    expect(pointsOf(resource, M.srdfGroupLagSeconds)).toEqual([]);
  });

  test("a group whose pairs are suspended, or whose link is offline, is not healthy, with why", () => {
    const resource: JSONObject = build({
      srdfGroups: [
        {
          ...sync,
          id: "12",
          label: null,
          modes: ["Asynchronous"],
          states: ["Consistent", "Suspended"],
          lagSeconds: 42,
        },
        { ...sync, id: "13", isOffline: true },
      ],
    });

    expect(
      pointsOf(resource, M.srdfGroupNotHealthy).map((p: OtlpPoint) => {
        return p.labels;
      }),
    ).toEqual([
      {
        [L.srdfGroup]: "12",
        [L.state]: "Suspended",
        [L.remoteSymmetrixId]: ARRAY_REMOTE,
      },
      {
        [L.srdfGroup]: "13",
        [L.srdfLabel]: "SGKG20a5ba",
        [L.state]: "Offline",
        [L.remoteSymmetrixId]: ARRAY_REMOTE,
      },
    ]);
    expect(
      pointOf(resource, M.srdfGroupInfo, { [L.srdfGroup]: "12" })!.labels[
        L.state
      ],
    ).toBe("Suspended");
    expect(pointsOf(resource, M.srdfGroupLagSeconds)[0]).toEqual(
      expect.objectContaining({ value: 42, labels: { [L.srdfGroup]: "12" } }),
    );
  });

  test("SRDF/A and SRDF/S performance by group number", () => {
    const at: number = NOW_MS - 300_000;
    const resource: JSONObject = build({
      performance: new Map([
        [
          "RDFA",
          [
            {
              id: "12",
              metrics: {
                AvgCycleTime: 30,
                RDF_R1_R2_MBs: 12.5,
                RdfResponseTime: 1.5,
              },
              timestampMs: at,
            },
          ],
        ],
        [
          "RDFS",
          [
            {
              id: "88",
              metrics: { HostMBWritten: 3.25, RDFS_WriteResponseTime: 0.9 },
              timestampMs: at,
            },
          ],
        ],
      ]),
    });

    expect(
      pointsOf(resource, M.srdfGroupThroughput).map((p: OtlpPoint) => {
        return [p.labels[L.srdfGroup], p.value];
      }),
    ).toEqual([
      ["12", 12.5 * MB],
      ["88", 3.25 * MB],
    ]);
    expect(
      pointsOf(resource, M.srdfGroupResponseTime).map((p: OtlpPoint) => {
        return [p.labels[L.srdfGroup], p.value];
      }),
    ).toEqual([
      ["12", 1500],
      ["88", 900],
    ]);
    expect(pointsOf(resource, M.srdfGroupCycleTimeSeconds)[0]!.value).toBe(30);
  });
});

describe("PowerMaxOtlpBuilder: counts", () => {
  test("counts the kinds read, the full total where a list was cut, and nothing for a kind not read", () => {
    expect(
      PowerMaxOtlpBuilder.getCounts(
        reading({
          storageGroups: [group(), group({ id: "B" })],
          volumes: [],
          srps: null,
          directors: [],
          ports: null,
          srdfGroups: [],
          totals: { [StorageArrayResourceKind.Volume]: 12000 },
        }),
      ),
    ).toEqual({
      [PowerMaxKind.StorageGroup]: 2,
      [StorageArrayResourceKind.Volume]: 12000,
      [PowerMaxKind.Director]: 0,
      [PowerMaxKind.SrdfGroup]: 0,
    });
    expect(POWERMAX_PORT_KIND).toBe(StorageArrayResourceKind.NetworkInterface);
  });
});

describe("StorageArrayOtlpResource", () => {
  test("writes only finite numbers, labels with a value, and counts its datapoints", () => {
    const resource: StorageArrayOtlpResource = new StorageArrayOtlpResource({
      resourceAttributes: { a: "1", empty: "" },
      timeMs: 1000.9,
    });
    resource.gauge("m", 1, { x: "y", none: "" });
    resource.gauge("m", Number.NaN);
    resource.gauge("m", null);
    resource.gauge("m", undefined);
    resource.gauge("m", Number.POSITIVE_INFINITY);
    resource.gauge("n", 2, {}, 2000);

    expect(resource.getDatapointCount()).toBe(2);
    expect(resource.hasMetric("m")).toBe(true);
    expect(resource.hasMetric("zzz")).toBe(false);
    expect(resource.build("v")).toEqual({
      resource: { attributes: [{ key: "a", value: { stringValue: "1" } }] },
      scopeMetrics: [
        {
          scope: { name: STORAGE_ARRAY_OTLP_SCOPE_NAME, version: "v" },
          metrics: [
            {
              name: "m",
              gauge: {
                dataPoints: [
                  {
                    asDouble: 1,
                    timeUnixNano: "1000000000",
                    attributes: [{ key: "x", value: { stringValue: "y" } }],
                  },
                ],
              },
            },
            {
              name: "n",
              gauge: {
                dataPoints: [
                  {
                    asDouble: 2,
                    timeUnixNano: "2000000000",
                    attributes: [],
                  },
                ],
              },
            },
          ],
        },
      ],
    });
  });

  test("drops every metric of a prefix, and one label's datapoints of one metric", () => {
    const resource: StorageArrayOtlpResource = new StorageArrayOtlpResource({
      resourceAttributes: {},
      timeMs: 0,
    });
    resource.gauge("v_a", 1);
    resource.gauge("v_a", 2);
    resource.gauge("v_b", 3);
    resource.gauge("keep", 4);
    resource.gauge("listed", 1, { endpoint: "volumes" });
    resource.gauge("listed", 2, { endpoint: "ports" });

    expect(resource.dropMetrics("v_")).toBe(3);
    expect(resource.getDatapointCount()).toBe(3);
    expect(resource.dropDatapoints("listed", "endpoint", "volumes")).toBe(1);
    expect(resource.getDatapointCount()).toBe(2);
    expect(resource.dropDatapoints("listed", "endpoint", "volumes")).toBe(0);
    expect(resource.dropDatapoints("absent", "endpoint", "volumes")).toBe(0);
    expect(resource.dropDatapoints("listed", "endpoint", "ports")).toBe(1);
    expect(resource.hasMetric("listed")).toBe(false);
    expect(metricNames(resource.build("v"))).toEqual(["keep"]);
  });
});
