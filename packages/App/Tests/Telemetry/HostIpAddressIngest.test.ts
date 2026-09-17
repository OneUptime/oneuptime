/*
 * The Queue infrastructure module pulls in BullMQ (ESM-only msgpackr) at
 * import time via the services' queue imports; nothing queue-related is
 * under test here, so the module is replaced — same idiom as
 * OtelIdDecoding.test.ts in this directory.
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
 * test here, so the module is replaced WITH A FACTORY — an automock would
 * still require (and type-check) the real file.
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

import OtelIngestBaseService from "../../FeatureSet/Telemetry/Services/OtelIngestBaseService";
import OtelMetricsIngestService from "../../FeatureSet/Telemetry/Services/OtelMetricsIngestService";
import GlobalCache from "Common/Server/Infrastructure/GlobalCache";
import HostService from "Common/Server/Services/HostService";
import LabelService from "Common/Server/Services/LabelService";
import Host from "Common/Models/DatabaseModels/Host";
import ObjectID from "Common/Types/ObjectID";
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
 * Issue #3006 end-to-end at the ingest boundary.
 *
 * A Debian Docker host with IPv6 enabled reported `host.ip` as an array of
 * 55 addresses (~1450 characters): the LAN IPv4, 11 docker-bridge IPv4s, 36
 * IPv6 link-locals and 7 IPv6 ULAs. That overflowed the varchar(500)
 * Host.hostIpAddresses column, which aborted the Host metadata UPDATE — the
 * same statement that carries lastSeenAt and otelCollectorStatus — so the
 * host was displayed as "Disconnected" while its telemetry kept arriving.
 *
 * Both ingest write paths are covered: autoDiscoverHost (traces/logs/spans)
 * and runBatchHostEnrichment (the batched metrics enrichment).
 *
 * All Postgres/Redis access is mocked; the OTLP attribute walk and the IP
 * normalization run for real.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const HOST_ROW_ID: ObjectID = ObjectID.generate();

/* eslint-disable @typescript-eslint/no-explicit-any */
const baseService: Record<string, any> =
  OtelIngestBaseService as unknown as Record<string, any>;
const metricsService: Record<string, any> =
  OtelMetricsIngestService as unknown as Record<string, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

/** The exact address mix reported in the issue: 55 entries. */
function reportedHostIps(): Array<string> {
  const addresses: Array<string> = ["192.168.1.42"];

  for (let i: number = 0; i < 11; i++) {
    addresses.push(`172.${17 + i}.0.1`);
  }
  for (let i: number = 0; i < 36; i++) {
    addresses.push(`fe80::42:acff:fe11:${(0x1000 + i).toString(16)}`);
  }
  for (let i: number = 0; i < 7; i++) {
    addresses.push(`fd00:dead:beef:${i}::1`);
  }

  return addresses;
}

function stringAttribute(key: string, value: string): JSONObject {
  return { key: key, value: { stringValue: value } };
}

function stringArrayAttribute(key: string, values: Array<string>): JSONObject {
  return {
    key: key,
    value: {
      arrayValue: {
        values: values.map((value: string) => {
          return { stringValue: value };
        }),
      },
    },
  };
}

/*
 * Resource attributes as otelcol-contrib's `resourcedetection: [system, env]`
 * emits them on the reporter's box: os.type is the host signal, and host.ip
 * carries one entry per interface. Deliberately NO container.runtime — the
 * system detector does not set it, and a Docker runtime signal would route
 * the batch to the DockerHost table instead of Host.
 */
function hostAttributes(ipAddresses: Array<string>): JSONArray {
  return [
    stringAttribute("host.name", "docker-host-1"),
    stringAttribute("os.type", "linux"),
    stringAttribute("os.description", "Debian GNU/Linux 12 (bookworm)"),
    stringArrayAttribute("host.ip", ipAddresses),
  ] as JSONArray;
}

let updateLastSeenCalls: Array<{
  hostId: ObjectID;
  extra: Record<string, unknown>;
}> = [];

function mockHostWrites(): void {
  const host: Host = new Host();
  host._id = HOST_ROW_ID.toString();
  host.projectId = PROJECT_ID;
  host.hostIdentifier = "docker-host-1";

  jest
    .spyOn(HostService, "findOrCreateByHostIdentifier")
    .mockResolvedValue(host);

  jest
    .spyOn(HostService, "updateLastSeen")
    .mockImplementation(async (hostId: ObjectID, extra?: unknown) => {
      updateLastSeenCalls.push({
        hostId: hostId,
        extra: (extra ?? {}) as Record<string, unknown>,
      });
    });

  jest.spyOn(HostService, "attachLabels").mockResolvedValue(undefined);
  jest.spyOn(LabelService, "findOrCreateLabelsByNames").mockResolvedValue([]);
}

function storedIpAddresses(): string {
  return updateLastSeenCalls[0]?.extra["hostIpAddresses"] as string;
}

describe("getStringArrayAttribute", () => {
  test("reads an OTLP arrayValue of strings", () => {
    const attributes: JSONArray = [
      stringArrayAttribute("host.ip", ["10.0.0.5", "fe80::1"]),
    ] as JSONArray;

    expect(
      baseService["getStringArrayAttribute"](attributes, "host.ip"),
    ).toEqual(["10.0.0.5", "fe80::1"]);
  });

  test("falls back to a flattened single stringValue", () => {
    const attributes: JSONArray = [
      stringAttribute("host.ip", "10.0.0.5"),
    ] as JSONArray;

    expect(
      baseService["getStringArrayAttribute"](attributes, "host.ip"),
    ).toEqual(["10.0.0.5"]);
  });

  test("returns an empty array when the attribute is absent", () => {
    expect(
      baseService["getStringArrayAttribute"](
        [stringAttribute("host.name", "h1")] as JSONArray,
        "host.ip",
      ),
    ).toEqual([]);
  });

  test("skips blank entries inside the array", () => {
    const attributes: JSONArray = [
      stringArrayAttribute("host.ip", ["10.0.0.5", "   ", "fe80::1"]),
    ] as JSONArray;

    expect(
      baseService["getStringArrayAttribute"](attributes, "host.ip"),
    ).toEqual(["10.0.0.5", "fe80::1"]);
  });

  test("returns all 55 addresses from the reported payload", () => {
    const attributes: JSONArray = hostAttributes(reportedHostIps());

    expect(
      baseService["getStringArrayAttribute"](attributes, "host.ip"),
    ).toHaveLength(55);
  });
});

describe("autoDiscoverHost with an oversized host.ip array", () => {
  beforeEach(() => {
    updateLastSeenCalls = [];

    jest.spyOn(GlobalCache, "getString").mockResolvedValue(null);
    jest.spyOn(GlobalCache, "setString").mockResolvedValue(undefined);
    jest.spyOn(baseService, "shouldRunMaintenance").mockResolvedValue(true);
    jest
      .spyOn(baseService, "tryLinkHostToProxmoxGuest")
      .mockResolvedValue(undefined);

    mockHostWrites();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("still discovers the host and returns its id", async () => {
    const hostId: ObjectID | null = await baseService["autoDiscoverHost"]({
      projectId: PROJECT_ID,
      attributes: hostAttributes(reportedHostIps()),
    });

    expect(hostId?.toString()).toBe(HOST_ROW_ID.toString());
  });

  test("updates liveness — the symptom in the issue was that it did not", async () => {
    await baseService["autoDiscoverHost"]({
      projectId: PROJECT_ID,
      attributes: hostAttributes(reportedHostIps()),
    });

    expect(updateLastSeenCalls).toHaveLength(1);
    expect(updateLastSeenCalls[0]?.hostId.toString()).toBe(
      HOST_ROW_ID.toString(),
    );
  });

  test("stores all 55 addresses, well past the old 500-character bound", async () => {
    await baseService["autoDiscoverHost"]({
      projectId: PROJECT_ID,
      attributes: hostAttributes(reportedHostIps()),
    });

    const stored: string = storedIpAddresses();
    expect(stored.split(", ")).toHaveLength(55);
    expect(stored.length).toBeGreaterThan(500);
  });

  test("keeps every reported address verbatim", async () => {
    const reported: Array<string> = reportedHostIps();

    await baseService["autoDiscoverHost"]({
      projectId: PROJECT_ID,
      attributes: hostAttributes(reported),
    });

    for (const address of reported) {
      expect(storedIpAddresses()).toContain(address);
    }
  });

  test("dedupes addresses a collector reports twice", async () => {
    const duplicated: Array<string> = [
      "10.0.0.5",
      "10.0.0.5",
      "FE80::1",
      "fe80::1",
    ];

    await baseService["autoDiscoverHost"]({
      projectId: PROJECT_ID,
      attributes: hostAttributes(duplicated),
    });

    expect(storedIpAddresses()).toBe("10.0.0.5, FE80::1");
  });

  test("leaves the column unset when host.ip is absent", async () => {
    await baseService["autoDiscoverHost"]({
      projectId: PROJECT_ID,
      attributes: [
        stringAttribute("host.name", "docker-host-1"),
        stringAttribute("os.type", "linux"),
      ] as JSONArray,
    });

    expect(updateLastSeenCalls).toHaveLength(1);
    expect(storedIpAddresses()).toBeUndefined();
  });

  test("does not fall over on a pathological 5000-address report", async () => {
    const huge: Array<string> = Array.from(
      { length: 5000 },
      (_unused: unknown, i: number) => {
        return `2001:0db8::${i.toString(16)}`;
      },
    );

    const hostId: ObjectID | null = await baseService["autoDiscoverHost"]({
      projectId: PROJECT_ID,
      attributes: hostAttributes(huge),
    });

    expect(hostId?.toString()).toBe(HOST_ROW_ID.toString());
    expect(updateLastSeenCalls).toHaveLength(1);
    expect(storedIpAddresses().length).toBeLessThanOrEqual(10000);
  });
});

describe("runBatchHostEnrichment with an oversized host.ip array", () => {
  function resourceMetrics(ipAddresses: Array<string>): JSONArray {
    return [
      {
        resource: { attributes: hostAttributes(ipAddresses) },
        scopeMetrics: [],
      },
    ] as JSONArray;
  }

  beforeEach(() => {
    updateLastSeenCalls = [];
    mockHostWrites();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("stores all 55 addresses on the metrics path too", async () => {
    await metricsService["runBatchHostEnrichment"]({
      projectId: PROJECT_ID,
      resourceMetrics: resourceMetrics(reportedHostIps()),
    });

    expect(updateLastSeenCalls).toHaveLength(1);
    expect(storedIpAddresses().split(", ")).toHaveLength(55);
  });

  test("dedupes on the metrics path too", async () => {
    await metricsService["runBatchHostEnrichment"]({
      projectId: PROJECT_ID,
      resourceMetrics: resourceMetrics(["10.0.0.5", "10.0.0.5", "::1"]),
    });

    expect(storedIpAddresses()).toBe("10.0.0.5, ::1");
  });

  test("leaves the column unset when host.ip is absent", async () => {
    await metricsService["runBatchHostEnrichment"]({
      projectId: PROJECT_ID,
      resourceMetrics: [
        {
          resource: {
            attributes: [
              stringAttribute("host.name", "docker-host-1"),
              stringAttribute("os.type", "linux"),
            ],
          },
          scopeMetrics: [],
        },
      ] as JSONArray,
    });

    expect(updateLastSeenCalls).toHaveLength(1);
    expect(storedIpAddresses()).toBeUndefined();
  });
});

describe("runBatchHostEnrichment Kubernetes Host suppression", () => {
  beforeEach(() => {
    updateLastSeenCalls = [];
    mockHostWrites();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each([
    ["pod name", "k8s.pod.name", "checkout-7d9f"],
    ["pod UID", "k8s.pod.uid", "pod-uid-1"],
    ["node name", "k8s.node.name", "worker-1"],
    ["node UID", "k8s.node.uid", "node-uid-1"],
    ["cluster name", "k8s.cluster.name", "prod-us"],
    ["namespace name", "k8s.namespace.name", "shop"],
    ["deployment name", "k8s.deployment.name", "checkout"],
  ])(
    "does not create or enrich a Host for a Kubernetes %s identity",
    async (_label: string, identityKey: string, identityValue: string) => {
      await metricsService["runBatchHostEnrichment"]({
        projectId: PROJECT_ID,
        resourceMetrics: [
          {
            resource: {
              attributes: [
                stringAttribute("host.name", "checkout-7d9f"),
                stringAttribute("os.type", "linux"),
                stringAttribute(identityKey, identityValue),
              ],
            },
            scopeMetrics: [],
          },
        ] as JSONArray,
      });

      expect(HostService.findOrCreateByHostIdentifier).not.toHaveBeenCalled();
      expect(updateLastSeenCalls).toHaveLength(0);
    },
  );
});
