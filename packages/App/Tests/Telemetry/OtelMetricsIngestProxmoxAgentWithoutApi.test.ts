import OtelMetricsIngestService from "../../FeatureSet/Telemetry/Services/OtelMetricsIngestService";
import OtelIngestBaseService from "../../FeatureSet/Telemetry/Services/OtelIngestBaseService";
import MetricPipelineRuleService from "../../FeatureSet/Telemetry/Services/MetricPipelineRuleService";
import ProxmoxResourceService, {
  ParsedProxmoxResource,
  ProxmoxResourceLatestMetric,
  ProxmoxResourceStartOnBoot,
} from "Common/Server/Services/ProxmoxResourceService";
import ProxmoxClusterService from "Common/Server/Services/ProxmoxClusterService";
import LabelService from "Common/Server/Services/LabelService";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import GlobalCache from "Common/Server/Infrastructure/GlobalCache";
import logger from "Common/Server/Utils/Logger";
import TelemetryUtil from "Common/Server/Utils/Telemetry/Telemetry";
import { clearProxmoxNodeRosterCache } from "Common/Server/Utils/Telemetry/ProxmoxNativeNodeLiveness";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { SpyInstance } from "jest-mock";

/*
 * GitHub issue #7439: a Proxmox cluster whose agent could no longer read the
 * Proxmox VE API - the node it reads went down (agent files before 0.161.2
 * read PVE_HOST alone), every node stopped answering, or its token was
 * revoked - still read Connected in OneUptime while its pages went stale.
 * The agent keeps sending while it is blind: its collector's own scrape
 * metrics (up = 0 for the failed scrape, scrape_duration_seconds ...) and
 * the per-node collectors of the nodes still up (pve_onboot_status,
 * pve_replication_*, pve_subscription_*), every batch stamped with
 * proxmox.cluster.name. Any such batch refreshed the cluster's lastSeenAt,
 * so it never turned Disconnected; and pve_onboot_status refreshed the
 * guests it named, with their old status and metrics, so they looked freshly
 * reported.
 *
 * This drives such batches through the real metrics ingest - the OTLP walk,
 * the snapshot fold and the flush - with only the Postgres seams mocked, and
 * pins:
 *
 *   - only a batch that READ the cluster (its nodes, guests, storage,
 *     version, backup coverage or quorum) turns it Connected
 *     (ProxmoxClusterService.updateLastSeen);
 *   - a batch of the agent's own scrape metrics, or of the node collectors
 *     alone, never does - and is still stored, every series of it;
 *   - what only a node's own scrape said about a guest (its start-on-boot
 *     flag) is written as configuration (bulkUpdateStartOnBoot): never the
 *     guest's lastSeenAt (bulkUpsert), its latest-metric mirror
 *     (bulkUpdateLatestMetrics) or a count;
 *   - in the same batch as the read, the flag folds into the guest's row as
 *     it always did;
 *   - and the fenced ingest heartbeat says the agent was heard
 *     (updateAgentLastSeen) whatever the batch carries, and never that the
 *     cluster was read.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const CLUSTER_ID: ObjectID = ObjectID.generate();
const RESOURCE_ID: string = CLUSTER_ID.toString();

const CTIME_S: number = 1700000000;
const TIME_NANO: number = CTIME_S * 1_000_000_000;
const OBSERVED_AT: Date = new Date(CTIME_S * 1000);
const GIB: number = 1024 * 1024 * 1024;
const AGENT_VERSION: string = "0.161.2";

const AUTO_DISCOVERY_MOCKS_RETURNING_NULL: Array<string> = [
  "autoDiscoverKubernetesCluster",
  "autoDiscoverDockerHost",
  "autoDiscoverPodmanHost",
  "autoDiscoverOpenStackCloud",
  "autoDiscoverVMwareVCenter",
  "autoDiscoverCephCluster",
  "autoDiscoverStorageArray",
  "autoDiscoverDockerSwarmCluster",
  "autoDiscoverIoTFleet",
  "autoDiscoverHost",
  "autoDiscoverServerless",
  "autoDiscoverCloudResource",
  "autoDiscoverRum",
  "autoDiscoverDatabaseServer",
];

/* eslint-disable @typescript-eslint/no-explicit-any */
const metricsService: Record<string, any> =
  OtelMetricsIngestService as unknown as Record<string, any>;
const baseService: Record<string, any> =
  OtelIngestBaseService as unknown as Record<string, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

function attrs(values: Record<string, string>): JSONArray {
  return Object.entries(values).map(([key, value]: [string, string]) => {
    return { key, value: { stringValue: value } };
  });
}

function gauge(
  name: string,
  value: number,
  labels: Record<string, string>,
): JSONObject {
  return {
    name,
    unit: "1",
    gauge: {
      dataPoints: [
        {
          timeUnixNano: TIME_NANO,
          attributes: attrs(labels),
          ...(Number.isInteger(value) ? { asInt: value } : { asDouble: value }),
        },
      ],
    },
  };
}

// A block as the agent's collector sends it: every resource stamped.
function agentBlock(metrics: Array<JSONObject>): JSONObject {
  return {
    resource: {
      attributes: attrs({
        "proxmox.cluster.name": "homelab",
        "oneuptime.agent.version": AGENT_VERSION,
      }),
    },
    scopeMetrics: [{ scope: {}, metrics }],
  };
}

/*
 * The collector's own metrics for the cluster scrape that failed: the
 * exporter answered 500 because no node's API answered (or the token was
 * refused), so the scrape carried no pve_* series at all.
 */
function scrapeMetricsOnly(): JSONObject {
  const scrape: Record<string, string> = {
    job: "oneuptime-proxmox",
    instance: "pve-exporter:9221",
  };
  return agentBlock([
    gauge("up", 0, scrape),
    gauge("scrape_duration_seconds", 0.512, scrape),
    gauge("scrape_samples_scraped", 0, scrape),
    gauge("scrape_series_added", 0, scrape),
  ]);
}

/*
 * The node collectors of a node still up (the oneuptime-proxmox-nodes job):
 * the start-on-boot flag of every guest it holds, its replication jobs and
 * its subscription.
 */
function nodeCollectorsOnly(
  node: string = "pve2",
  onboot: Record<string, number> = { "qemu/100": 1, "lxc/101": 0 },
): JSONObject {
  const metrics: Array<JSONObject> = [];
  for (const [id, value] of Object.entries(onboot)) {
    metrics.push(
      gauge("pve_onboot_status", value, {
        id,
        node,
        type: id.split("/")[0]!,
      }),
    );
  }
  metrics.push(
    gauge("pve_replication_duration_seconds", 2.5, {
      id: "100-0",
      guest: "100",
      type: "local",
      source: node,
      target: "pve3",
    }),
    gauge("pve_subscription_status", 1, {
      id: `node/${node}`,
      status: "Active",
    }),
  );
  return agentBlock(metrics);
}

// The cluster collectors' answer: what reading the cluster from a node says.
function clusterRead(
  options: {
    guests?: Array<{ id: string; name: string; node: string; up: number }>;
  } = {},
): JSONObject {
  const guests: Array<{ id: string; name: string; node: string; up: number }> =
    options.guests || [
      { id: "qemu/100", name: "web", node: "pve2", up: 1 },
      { id: "lxc/101", name: "dns", node: "pve2", up: 0 },
    ];
  const metrics: Array<JSONObject> = [
    gauge("pve_version_info", 1, {
      release: "9.0",
      repoid: "deb1ca70",
      version: "9.0.10",
    }),
    gauge("pve_up", 1, { id: "cluster/homelab" }),
  ];
  for (const node of ["pve1", "pve2"]) {
    metrics.push(
      gauge("pve_node_info", 1, {
        id: `node/${node}`,
        name: node,
        level: "",
      }),
      // pve1 is the node that went down; the cluster says so.
      gauge("pve_up", node === "pve1" ? 0 : 1, { id: `node/${node}` }),
    );
  }
  for (const guest of guests) {
    metrics.push(
      gauge("pve_guest_info", 1, {
        id: guest.id,
        name: guest.name,
        node: guest.node,
        type: guest.id.split("/")[0]!,
        template: "0",
        tags: "",
      }),
      gauge("pve_up", guest.up, { id: guest.id }),
      gauge("pve_cpu_usage_ratio", 0.25, { id: guest.id }),
      gauge("pve_memory_usage_bytes", 2 * GIB, { id: guest.id }),
      gauge("pve_memory_size_bytes", 8 * GIB, { id: guest.id }),
    );
  }
  return agentBlock(metrics);
}

function request(blocks: Array<JSONObject>): TelemetryRequest {
  return {
    projectId: PROJECT_ID,
    body: { resourceMetrics: blocks },
    headers: {},
  } as unknown as TelemetryRequest;
}

interface Spies {
  rows: Array<JSONObject>;
  bulkUpsert: SpyInstance<typeof ProxmoxResourceService.bulkUpsert>;
  bulkUpdateLatestMetrics: SpyInstance<
    typeof ProxmoxResourceService.bulkUpdateLatestMetrics
  >;
  bulkUpdateStartOnBoot: SpyInstance<
    typeof ProxmoxResourceService.bulkUpdateStartOnBoot
  >;
  updateLastSeen: SpyInstance<typeof ProxmoxClusterService.updateLastSeen>;
  updateAgentLastSeen: SpyInstance<
    typeof ProxmoxClusterService.updateAgentLastSeen
  >;
}

function setupIngestMocks(): Spies {
  const rows: Array<JSONObject> = [];
  jest
    .spyOn(metricsService, "runBatchHostEnrichment")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(metricsService, "submitMetricsBuffer")
    .mockImplementation((...args: Array<unknown>): Promise<void> => {
      const buffer: Array<JSONObject> = args[0] as Array<JSONObject>;
      rows.push(...buffer.splice(0, buffer.length));
      return Promise.resolve();
    });

  for (const method of AUTO_DISCOVERY_MOCKS_RETURNING_NULL) {
    jest.spyOn(metricsService, method).mockResolvedValue(null as never);
  }
  jest
    .spyOn(metricsService, "autoDiscoverProxmoxCluster")
    .mockResolvedValue(CLUSTER_ID as never);
  jest.spyOn(metricsService, "resolveTelemetryResource").mockResolvedValue({
    serviceName: "proxmox/homelab",
    primaryEntityId: CLUSTER_ID,
    primaryEntityType: ServiceType.ProxmoxCluster,
    dataRententionInDays: 15,
    serviceRetentionConfig: null,
    serviceRetentionInDays: null,
    projectRetentionConfig: null,
    projectRetentionInDays: 15,
  } as never);

  jest.spyOn(MetricPipelineRuleService, "loadRules").mockResolvedValue({
    projectRules: [],
    rulesByServiceId: new Map(),
  } as never);
  jest
    .spyOn(TelemetryUtil, "indexMetricNameServiceNameMap")
    .mockResolvedValue(undefined as never);

  return {
    rows,
    bulkUpsert: jest
      .spyOn(ProxmoxResourceService, "bulkUpsert")
      .mockResolvedValue(undefined),
    bulkUpdateLatestMetrics: jest
      .spyOn(ProxmoxResourceService, "bulkUpdateLatestMetrics")
      .mockResolvedValue(undefined),
    bulkUpdateStartOnBoot: jest
      .spyOn(ProxmoxResourceService, "bulkUpdateStartOnBoot")
      .mockResolvedValue(undefined),
    updateLastSeen: jest
      .spyOn(ProxmoxClusterService, "updateLastSeen")
      .mockResolvedValue({ isRowGone: false }),
    updateAgentLastSeen: jest
      .spyOn(ProxmoxClusterService, "updateAgentLastSeen")
      .mockResolvedValue({ isRowGone: false }),
  };
}

async function ingest(blocks: Array<JSONObject>): Promise<void> {
  await OtelMetricsIngestService.processMetricsFromQueue(request(blocks));
}

function storedNames(rows: Array<JSONObject>): Set<string> {
  return new Set(
    rows.map((row: JSONObject): string => {
      return row["name"] as string;
    }),
  );
}

function upsertedIds(spies: Spies): Array<string> {
  return spies.bulkUpsert.mock.calls
    .flatMap(
      (
        call: Parameters<typeof ProxmoxResourceService.bulkUpsert>,
      ): Array<ParsedProxmoxResource> => {
        return call[0].resources;
      },
    )
    .map((r: ParsedProxmoxResource): string => {
      return r.externalId;
    })
    .sort();
}

function startOnBootWrites(spies: Spies): Array<ProxmoxResourceStartOnBoot> {
  return spies.bulkUpdateStartOnBoot.mock.calls
    .flatMap(
      (
        call: Parameters<typeof ProxmoxResourceService.bulkUpdateStartOnBoot>,
      ): Array<ProxmoxResourceStartOnBoot> => {
        expect(call[0].projectId.toString()).toBe(PROJECT_ID.toString());
        expect(call[0].proxmoxClusterId.toString()).toBe(CLUSTER_ID.toString());
        return call[0].resources;
      },
    )
    .sort((a: ProxmoxResourceStartOnBoot, b: ProxmoxResourceStartOnBoot) => {
      return a.externalId.localeCompare(b.externalId);
    });
}

beforeEach(() => {
  clearProxmoxNodeRosterCache();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("an agent that cannot read the Proxmox VE API does not keep its cluster Connected (issue #7439)", () => {
  test("its own scrape metrics alone never turn the cluster Connected - and are still stored", async () => {
    const spies: Spies = setupIngestMocks();

    await ingest([scrapeMetricsOnly()]);

    expect(spies.updateLastSeen).not.toHaveBeenCalled();
    expect(spies.bulkUpsert).not.toHaveBeenCalled();
    expect(spies.bulkUpdateLatestMetrics).not.toHaveBeenCalled();
    expect(spies.bulkUpdateStartOnBoot).not.toHaveBeenCalled();
    // Nothing is dropped: Metrics Explorer still shows the failed scrape.
    expect(storedNames(spies.rows)).toEqual(
      new Set([
        "up",
        "scrape_duration_seconds",
        "scrape_samples_scraped",
        "scrape_series_added",
      ]),
    );
  });

  test("the node collectors of the nodes still up never turn it Connected either", async () => {
    const spies: Spies = setupIngestMocks();

    await ingest([nodeCollectorsOnly("pve2"), nodeCollectorsOnly("pve3", {})]);

    expect(spies.updateLastSeen).not.toHaveBeenCalled();
    for (const name of [
      "pve_onboot_status",
      "pve_replication_duration_seconds",
      "pve_subscription_status",
    ]) {
      expect(storedNames(spies.rows)).toContain(name);
    }
  });

  test("a guest only a node's own scrape named keeps its lastSeenAt and its readings: just its start-on-boot flag is written", async () => {
    const spies: Spies = setupIngestMocks();

    await ingest([nodeCollectorsOnly("pve2")]);

    // Not as a row the batch reported: no lastSeenAt, no metrics.
    expect(spies.bulkUpsert).not.toHaveBeenCalled();
    expect(spies.bulkUpdateLatestMetrics).not.toHaveBeenCalled();
    expect(spies.bulkUpdateStartOnBoot).toHaveBeenCalledTimes(1);
    expect(startOnBootWrites(spies)).toEqual([
      {
        kind: "Guest",
        externalId: "lxc/101",
        onboot: false,
        parentNodeName: "pve2",
      },
      {
        kind: "Guest",
        externalId: "qemu/100",
        onboot: true,
        parentNodeName: "pve2",
      },
    ]);
  });

  test("a batch that read the cluster turns it Connected, with its counts, version and quorum", async () => {
    const spies: Spies = setupIngestMocks();

    await ingest([clusterRead()]);

    expect(spies.updateLastSeen).toHaveBeenCalledTimes(1);
    const [clusterId, extras] = spies.updateLastSeen.mock.calls[0]!;
    expect(clusterId.toString()).toBe(CLUSTER_ID.toString());
    expect(extras).toEqual({
      pveVersion: "9.0.10",
      nodeCount: 2,
      onlineNodeCount: 1,
      guestCount: 2,
      isQuorate: true,
    });
    expect(upsertedIds(spies)).toEqual([
      "lxc/101",
      "node/pve1",
      "node/pve2",
      "qemu/100",
    ]);
    expect(spies.bulkUpdateStartOnBoot).not.toHaveBeenCalled();
  });

  test("in the same batch as the read, a guest's start-on-boot flag folds into its row, as it always did", async () => {
    const spies: Spies = setupIngestMocks();

    await ingest([clusterRead(), nodeCollectorsOnly("pve2")]);

    expect(spies.bulkUpdateStartOnBoot).not.toHaveBeenCalled();
    const resources: Array<ParsedProxmoxResource> =
      spies.bulkUpsert.mock.calls[0]![0].resources;
    const web: ParsedProxmoxResource | undefined = resources.find(
      (r: ParsedProxmoxResource): boolean => {
        return r.externalId === "qemu/100";
      },
    );
    expect(web?.onboot).toBe(true);
    expect(web?.isUp).toBe(true);
    expect(web?.lastSeenAt.getTime()).toBe(OBSERVED_AT.getTime());
    expect(spies.updateLastSeen).toHaveBeenCalledTimes(1);
  });

  test("a guest the read did not report is not counted, upserted or given readings, though its node named it", async () => {
    const spies: Spies = setupIngestMocks();

    await ingest([
      clusterRead({
        guests: [{ id: "qemu/100", name: "web", node: "pve2", up: 1 }],
      }),
      nodeCollectorsOnly("pve2", { "qemu/100": 1, "qemu/102": 1 }),
    ]);

    expect(upsertedIds(spies)).toEqual(["node/pve1", "node/pve2", "qemu/100"]);
    const mirrored: Array<string> = spies.bulkUpdateLatestMetrics.mock.calls
      .flatMap(
        (
          call: Parameters<
            typeof ProxmoxResourceService.bulkUpdateLatestMetrics
          >,
        ): Array<ProxmoxResourceLatestMetric> => {
          return call[0].metrics;
        },
      )
      .map((m: ProxmoxResourceLatestMetric): string => {
        return m.externalId;
      });
    expect(mirrored).not.toContain("qemu/102");
    expect(
      startOnBootWrites(spies).map((r: ProxmoxResourceStartOnBoot): string => {
        return r.externalId;
      }),
    ).toEqual(["qemu/102"]);
    expect(spies.updateLastSeen.mock.calls[0]![1]?.guestCount).toBe(1);
  });

  test("once the API answers again, the next read turns the cluster Connected again", async () => {
    const spies: Spies = setupIngestMocks();

    await ingest([scrapeMetricsOnly(), nodeCollectorsOnly("pve2")]);
    await ingest([scrapeMetricsOnly()]);
    expect(spies.updateLastSeen).not.toHaveBeenCalled();

    await ingest([clusterRead()]);
    expect(spies.updateLastSeen).toHaveBeenCalledTimes(1);
  });

  test("a failed start-on-boot write is logged and never costs the read its Connected", async () => {
    const spies: Spies = setupIngestMocks();
    spies.bulkUpdateStartOnBoot.mockRejectedValue(new Error("deadlock"));
    const warn: SpyInstance<typeof logger.warn> = jest
      .spyOn(logger, "warn")
      .mockImplementation((): void => {
        return undefined;
      });

    await ingest([
      clusterRead({
        guests: [{ id: "qemu/100", name: "web", node: "pve2", up: 1 }],
      }),
      nodeCollectorsOnly("pve2", { "qemu/102": 1 }),
    ]);

    expect(spies.updateLastSeen).toHaveBeenCalledTimes(1);
    expect(
      warn.mock.calls.some((call: Parameters<typeof logger.warn>): boolean => {
        return String(call[0]).includes(
          "Proxmox snapshot writeback (start-on-boot) failed",
        );
      }),
    ).toBe(true);
  });
});

/*
 * The fenced heartbeat every batch that names the cluster runs through
 * (autoDiscoverProxmoxCluster): it hears the agent, whatever the batch
 * carries, and never reads the cluster.
 */
describe("the ingest heartbeat says the agent was heard, never that the cluster was read", () => {
  let agentCalls: Array<Record<string, unknown>>;
  let readCalls: number;

  beforeEach(() => {
    agentCalls = [];
    readCalls = 0;
    OtelIngestBaseService.clearInProcessMemos();
    // The id cache is primed, so findOrCreateByName never runs.
    jest
      .spyOn(GlobalCache, "getString")
      .mockResolvedValue(RESOURCE_ID as never);
    jest.spyOn(GlobalCache, "setString").mockResolvedValue(undefined as never);
    jest
      .spyOn(baseService, "shouldRunMaintenance")
      .mockResolvedValue(true as never);
    jest
      .spyOn(LabelService, "findOrCreateLabelsByNames")
      .mockResolvedValue([] as never);
    jest
      .spyOn(ProxmoxClusterService, "updateAgentLastSeen")
      .mockImplementation(async (_id: ObjectID, extra?: unknown) => {
        agentCalls.push((extra ?? {}) as Record<string, unknown>);
        return { isRowGone: false };
      });
    jest
      .spyOn(ProxmoxClusterService, "updateLastSeen")
      .mockImplementation(async () => {
        readCalls++;
        return { isRowGone: false };
      });
  });

  afterEach(() => {
    OtelIngestBaseService.clearInProcessMemos();
  });

  test("a batch of the agent's own scrape metrics: the agent is heard, with its version", async () => {
    const id: ObjectID | null = await baseService["autoDiscoverProxmoxCluster"](
      {
        projectId: PROJECT_ID,
        attributes: attrs({
          "proxmox.cluster.name": "homelab",
          "oneuptime.agent.version": AGENT_VERSION,
        }),
      },
    );

    expect(id?.toString()).toBe(RESOURCE_ID);
    expect(agentCalls).toEqual([{ agentVersion: AGENT_VERSION }]);
    expect(readCalls).toBe(0);
  });

  test("an agent from before the version stamp is heard too, with no version", async () => {
    await baseService["autoDiscoverProxmoxCluster"]({
      projectId: PROJECT_ID,
      attributes: attrs({ "proxmox.cluster.name": "homelab" }),
    });

    expect(agentCalls).toEqual([{ agentVersion: undefined }]);
    expect(readCalls).toBe(0);
  });

  test("inside the fence window the heartbeat is not repeated", async () => {
    jest
      .spyOn(baseService, "shouldRunMaintenance")
      .mockResolvedValue(false as never);

    await baseService["autoDiscoverProxmoxCluster"]({
      projectId: PROJECT_ID,
      attributes: attrs({ "proxmox.cluster.name": "homelab" }),
    });

    expect(agentCalls).toEqual([]);
    expect(readCalls).toBe(0);
  });
});
