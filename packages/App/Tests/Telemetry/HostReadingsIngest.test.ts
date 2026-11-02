/*
 * The Queue infrastructure module pulls in BullMQ (ESM-only msgpackr) at
 * import time via the services' queue imports; nothing queue-related is
 * under test here, so the module is replaced - same idiom as
 * CollectorAgentVersionIngest.test.ts in this directory.
 */
jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: {
      addJob: jest.fn(),
    },
    QueueName: {
      Workflow: "Workflow",
      Worker: "Worker",
      Telemetry: "Telemetry",
      Runbook: "Runbook",
    },
  };
});

/*
 * PasswordHash carries a pre-existing TS5.9 diagnostic that fails any suite
 * whose runtime require graph reaches it (DatabaseService, the base class
 * of every concrete service, imports it). Nothing password-related is under
 * test here, so the module is replaced WITH A FACTORY.
 */
jest.mock("Common/Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

import OtelMetricsIngestService from "../../FeatureSet/Telemetry/Services/OtelMetricsIngestService";
import HostService from "Common/Server/Services/HostService";
import LabelService from "Common/Server/Services/LabelService";
import Host from "Common/Models/DatabaseModels/Host";
import ObjectID from "Common/Types/ObjectID";
import { HEARTBEAT_ROW_PRESENT } from "Common/Server/Utils/Telemetry/ResourceHeartbeat";
import { HostReadingColumns } from "Common/Server/Utils/Telemetry/HostReadingsScan";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A host's readings reach its record through the metrics ingest's batch
 * host enrichment (runBatchHostEnrichment): one merged heartbeat per host
 * per batch. This sends batches shaped as OneUptime's default host
 * collector config sends them - one resource per hostmetrics scraper, one
 * per process, one per systemd unit - and checks what each host's
 * updateLastSeen is handed: the readings the Hosts list, its Needs
 * attention card and the host's page show (HostReadingsScan works each
 * one out; its own suite pins the arithmetic).
 *
 * All Postgres/Redis access is mocked; the attribute and metric walk runs
 * for real.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const GIB: number = 1024 * 1024 * 1024;
const SCRAPE_NANO: string = `${Date.UTC(2026, 10, 2, 10, 0, 0)}000000`;

/* eslint-disable @typescript-eslint/no-explicit-any */
const metricsService: Record<string, any> =
  OtelMetricsIngestService as unknown as Record<string, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

function stringAttribute(key: string, value: string): JSONObject {
  return { key: key, value: { stringValue: value } };
}

function point(attributes: Record<string, string>, value: number): JSONObject {
  return {
    attributes: Object.keys(attributes).map((key: string): JSONObject => {
      return stringAttribute(key, attributes[key]!);
    }),
    timeUnixNano: SCRAPE_NANO,
    asDouble: value,
  };
}

function intPoint(
  attributes: Record<string, string>,
  value: number,
): JSONObject {
  return {
    attributes: Object.keys(attributes).map((key: string): JSONObject => {
      return stringAttribute(key, attributes[key]!);
    }),
    timeUnixNano: SCRAPE_NANO,
    asInt: String(value),
  };
}

function resource(
  hostName: string,
  metrics: Array<JSONObject>,
  extra: Array<JSONObject> = [],
): JSONObject {
  return {
    resource: {
      attributes: [
        stringAttribute("host.name", hostName),
        stringAttribute("os.type", "linux"),
        ...extra,
      ],
    },
    scopeMetrics: [{ scope: { name: "hostmetrics" }, metrics: metrics }],
  };
}

// One hostmetrics scrape of a 2-CPU Linux host, a scraper per resource.
function hostmetricsScrape(hostName: string): Array<JSONObject> {
  return [
    resource(hostName, [
      {
        name: "system.cpu.utilization",
        gauge: {
          dataPoints: [
            point({ cpu: "cpu0", state: "user" }, 0.5),
            point({ cpu: "cpu0", state: "system" }, 0.1),
            point({ cpu: "cpu0", state: "idle" }, 0.4),
            point({ cpu: "cpu1", state: "user" }, 0.3),
            point({ cpu: "cpu1", state: "system" }, 0.1),
            point({ cpu: "cpu1", state: "idle" }, 0.6),
          ],
        },
      },
      {
        name: "system.cpu.logical.count",
        sum: { dataPoints: [intPoint({}, 2)] },
      },
    ]),
    resource(hostName, [
      {
        name: "system.memory.usage",
        sum: {
          dataPoints: [
            intPoint({ state: "used" }, 6 * GIB),
            intPoint({ state: "free" }, 1 * GIB),
            intPoint({ state: "cached" }, 1 * GIB),
          ],
        },
      },
      {
        name: "system.memory.utilization",
        gauge: {
          dataPoints: [
            point({ state: "used" }, 0.75),
            point({ state: "free" }, 0.125),
            point({ state: "cached" }, 0.125),
          ],
        },
      },
    ]),
    resource(hostName, [
      {
        name: "system.filesystem.usage",
        sum: {
          dataPoints: [
            intPoint({ mountpoint: "/", state: "used" }, 40),
            intPoint({ mountpoint: "/", state: "free" }, 55),
            intPoint({ mountpoint: "/", state: "reserved" }, 5),
            intPoint({ mountpoint: "/var", state: "used" }, 96),
            intPoint({ mountpoint: "/var", state: "free" }, 4),
            intPoint({ mountpoint: "/var", state: "reserved" }, 0),
          ],
        },
      },
      {
        name: "system.filesystem.inodes.usage",
        sum: {
          dataPoints: [
            intPoint({ mountpoint: "/", state: "used" }, 200),
            intPoint({ mountpoint: "/", state: "free" }, 800),
          ],
        },
      },
    ]),
    resource(hostName, [
      {
        name: "system.paging.usage",
        sum: {
          dataPoints: [
            intPoint({ device: "/swapfile", state: "used" }, 1 * GIB),
            intPoint({ device: "/swapfile", state: "free" }, 3 * GIB),
          ],
        },
      },
    ]),
    resource(hostName, [
      {
        name: "system.cpu.load_average.15m",
        gauge: { dataPoints: [point({}, 1.25)] },
      },
    ]),
    resource(hostName, [
      {
        name: "system.uptime",
        gauge: { dataPoints: [point({}, 3600)] },
      },
    ]),
    // A process's own resource: its CPU is not the host's.
    resource(
      hostName,
      [
        {
          name: "process.cpu.utilization",
          gauge: { dataPoints: [point({ state: "user" }, 0.99)] },
        },
      ],
      [stringAttribute("process.pid", "4242")],
    ),
  ];
}

function systemdUnit(
  hostName: string,
  unit: string,
  activeState: string,
): JSONObject {
  return resource(
    hostName,
    [
      {
        name: "systemd.unit.state",
        sum: {
          dataPoints: ["active", "inactive", "failed", "activating"].map(
            (state: string): JSONObject => {
              return intPoint(
                { "systemd.unit.active_state": state },
                state === activeState ? 1 : 0,
              );
            },
          ),
        },
      },
    ],
    [stringAttribute("systemd.unit.name", unit)],
  );
}

describe("runBatchHostEnrichment hands each host its readings", () => {
  let calls: Array<{ hostId: string; extra: Record<string, unknown> }>;

  beforeEach(() => {
    calls = [];
    jest
      .spyOn(HostService, "findOrCreateByHostIdentifier")
      .mockImplementation(
        async (data: { hostIdentifier: string }): Promise<Host> => {
          const host: Host = new Host();
          host._id =
            data.hostIdentifier === "db-01"
              ? "22222222-2222-4222-8222-222222222222"
              : "11111111-1111-4111-8111-111111111111";
          host.projectId = PROJECT_ID;
          host.hostIdentifier = data.hostIdentifier;
          return host;
        },
      );
    jest
      .spyOn(HostService, "updateLastSeen")
      .mockImplementation(async (id: ObjectID, extra?: unknown) => {
        calls.push({
          hostId: id.toString(),
          extra: (extra ?? {}) as Record<string, unknown>,
        });
        return HEARTBEAT_ROW_PRESENT;
      });
    jest.spyOn(HostService, "attachLabels").mockResolvedValue(undefined);
    jest.spyOn(LabelService, "findOrCreateLabelsByNames").mockResolvedValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function readingsOf(index: number): HostReadingColumns | undefined {
    return calls[index]!.extra["readings"] as HostReadingColumns | undefined;
  }

  test("a full hostmetrics scrape gives one write with every reading", async () => {
    await metricsService["runBatchHostEnrichment"]({
      projectId: PROJECT_ID,
      resourceMetrics: hostmetricsScrape("web-01") as JSONArray,
    });

    expect(calls).toHaveLength(1);
    const readings: HostReadingColumns | undefined = readingsOf(0);
    expect(readings).toEqual({
      // Mean user 0.4 + mean system 0.1.
      latestCpuPercent: 50,
      latestMemoryPercent: 75,
      latestSwapPercent: 25,
      latestDiskPercent: 96,
      latestDiskMountpoint: "/var",
      latestInodesPercent: 20,
      latestInodesMountpoint: "/",
      latestLoadAverage15m: 1.25,
      bootedAt: new Date(Date.UTC(2026, 10, 2, 9, 0, 0)),
    });
    // The host's other facts are still written beside them.
    expect(calls[0]!.extra["cpuCores"]).toBe(2);
    expect(calls[0]!.extra["osType"]).toBe("linux");
  });

  test("a process's CPU never becomes the host's", async () => {
    await metricsService["runBatchHostEnrichment"]({
      projectId: PROJECT_ID,
      resourceMetrics: [
        resource(
          "web-01",
          [
            {
              name: "process.cpu.utilization",
              gauge: { dataPoints: [point({ state: "user" }, 0.99)] },
            },
          ],
          [stringAttribute("process.pid", "1")],
        ),
      ] as JSONArray,
    });

    expect(calls).toHaveLength(1);
    expect(readingsOf(0)).toBeUndefined();
  });

  test("the host's systemd units say which of them failed, counted exactly", async () => {
    await metricsService["runBatchHostEnrichment"]({
      projectId: PROJECT_ID,
      resourceMetrics: [
        systemdUnit("web-01", "sshd.service", "active"),
        systemdUnit("web-01", "nginx.service", "failed"),
        systemdUnit("web-01", "backup.service", "failed"),
      ] as JSONArray,
    });

    expect(calls).toHaveLength(1);
    expect(readingsOf(0)).toEqual({
      failedSystemdUnitCount: 2,
      failedSystemdUnits: ["backup.service", "nginx.service"],
    });
  });

  test("units that are all running say none failed", async () => {
    await metricsService["runBatchHostEnrichment"]({
      projectId: PROJECT_ID,
      resourceMetrics: [
        systemdUnit("web-01", "sshd.service", "active"),
      ] as JSONArray,
    });

    expect(readingsOf(0)).toEqual({
      failedSystemdUnitCount: 0,
      failedSystemdUnits: [],
    });
  });

  test("two hosts in one batch each get their own readings", async () => {
    await metricsService["runBatchHostEnrichment"]({
      projectId: PROJECT_ID,
      resourceMetrics: [
        ...hostmetricsScrape("web-01"),
        resource("db-01", [
          {
            name: "system.memory.utilization",
            gauge: { dataPoints: [point({ state: "used" }, 0.97)] },
          },
        ]),
        systemdUnit("db-01", "postgresql.service", "failed"),
      ] as JSONArray,
    });

    expect(calls).toHaveLength(2);
    const web: { hostId: string; extra: Record<string, unknown> } = calls.find(
      (call: { hostId: string }): boolean => {
        return call.hostId === "11111111-1111-4111-8111-111111111111";
      },
    )!;
    const db: { hostId: string; extra: Record<string, unknown> } = calls.find(
      (call: { hostId: string }): boolean => {
        return call.hostId === "22222222-2222-4222-8222-222222222222";
      },
    )!;
    expect((web.extra["readings"] as HostReadingColumns).latestCpuPercent).toBe(
      50,
    );
    expect(
      (web.extra["readings"] as HostReadingColumns).failedSystemdUnitCount,
    ).toBeUndefined();
    expect(db.extra["readings"]).toEqual({
      latestMemoryPercent: 97,
      failedSystemdUnitCount: 1,
      failedSystemdUnits: ["postgresql.service"],
    });
  });

  test("a batch with no readings hands none, so no column is touched", async () => {
    await metricsService["runBatchHostEnrichment"]({
      projectId: PROJECT_ID,
      resourceMetrics: [
        resource("web-01", [
          {
            name: "system.network.io",
            sum: {
              dataPoints: [
                intPoint({ device: "eth0", direction: "receive" }, 1000),
              ],
            },
          },
        ]),
      ] as JSONArray,
    });

    expect(calls).toHaveLength(1);
    expect(readingsOf(0)).toBeUndefined();
  });

  test("a Kubernetes node's metrics are no host's readings", async () => {
    await metricsService["runBatchHostEnrichment"]({
      projectId: PROJECT_ID,
      resourceMetrics: [
        resource(
          "worker-1",
          [
            {
              name: "system.memory.utilization",
              gauge: { dataPoints: [point({ state: "used" }, 0.99)] },
            },
          ],
          [stringAttribute("k8s.node.name", "worker-1")],
        ),
      ] as JSONArray,
    });

    expect(calls).toHaveLength(0);
  });
});
