import OtelMetricsIngestService from "../../FeatureSet/Telemetry/Services/OtelMetricsIngestService";
import MetricPipelineRuleService, {
  MetricRulesForProject,
} from "../../FeatureSet/Telemetry/Services/MetricPipelineRuleService";
import XcpNgResourceService, {
  XcpNgInventorySummary,
} from "Common/Server/Services/XcpNgResourceService";
import XcpNgPoolService from "Common/Server/Services/XcpNgPoolService";
import { ParsedXcpNgResource } from "Common/Server/Utils/Telemetry/XcpNgSnapshotScan";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import TelemetryUtil from "Common/Server/Utils/Telemetry/Telemetry";
import { HEARTBEAT_ROW_PRESENT } from "Common/Server/Utils/Telemetry/ResourceHeartbeat";
import MetricPipelineRule from "Common/Models/DatabaseModels/MetricPipelineRule";
import MetricPipelineRuleType from "Common/Types/Metrics/MetricPipelineRuleType";
import { MetricPointType } from "Common/Models/AnalyticsModels/Metric";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import XcpNgResourceKind from "Common/Types/XcpNg/XcpNgResourceKind";
import {
  XCP_NG_ID_ATTRIBUTE,
  XCP_NG_POOL_ID_ATTRIBUTE,
  XCP_NG_RATE_TYPED_AS_COUNTER_SERIES,
  XCP_NG_SCOPE_ATTRIBUTE,
  XcpNgDerivedSeries,
} from "Common/Types/XcpNg/XcpNgTelemetry";
import {
  OpenMetricsSample,
  PRODUCTION_POOL_ID,
  SCRAPE_1_NOW_SECONDS,
  SCRAPE_2_NOW_SECONDS,
  UNNAMED_POOL_ID,
  parseOpenMetrics,
  readRecordedScrape,
  toAgentResourceMetrics,
} from "Common/Tests/Server/Utils/Telemetry/XcpNgScrapeFixture";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * The XCP-ng path of the metrics ingest end to end: the recorded Xen
 * Orchestra scrape of two pools, turned into the OTLP the XCP-ng Agent
 * sends (one resource per pool, xcp_ng.pool.id / xcp_ng.pool.name /
 * xen_orchestra.name on it, the eight rates as gauges), goes through the
 * real OTLP walk, the real normalizer, the real fold and the real flush.
 * Only the Postgres seams (XcpNgResourceService.bulkUpsert /
 * getInventorySummary / findVmsThatRanRecently, XcpNgPoolService.
 * updateLastSeen / recordReportedNames), the pool's discovery and the
 * unrelated backends (other discoveries, service resolution, ClickHouse)
 * are mocked. Pins:
 *
 *   - one discovery, one inventory and one heartbeat per pool, nothing of
 *     one pool in the other's,
 *   - the rows stored: every point carries xcp_ng.scope / xcp_ng.id, the
 *     eight rates are gauges holding Xen Orchestra's values (also when a
 *     collector configured by hand sends them as sums), and the derived
 *     health series are there, per host and VM,
 *   - a VM halted after it ran reads 1 on xcp_ng.vm.stopped_after_running,
 *   - a pool Xen Orchestra lost (only a staleness marker) is not a read,
 *   - the fold runs before the pipeline rules, and a failing inventory
 *     write never costs the pool its heartbeat.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const PRODUCTION_ID: ObjectID = ObjectID.generate();
const UNNAMED_ID: ObjectID = ObjectID.generate();

const HOST_PROD1: string = "9c6c0b6e-4f2a-4a7e-8b1e-0d1f2a3b4c5d";
const HOST_PROD2: string = "4e1d3a2b-7c8d-4e9f-a0b1-c2d3e4f5a6b7";
const HOST_PROD3: string = "f0e1d2c3-b4a5-4968-8776-655443322110";
const HOST_LAB1: string = "6a7b8c9d-0e1f-4a2b-9c3d-4e5f6a7b8c9d";
const VM_WEB01: string = "e8a5b2c1-3d4e-4f5a-8b6c-7d8e9f0a1b2c";
const VM_APP02: string = "7b8c9d0e-1f2a-4b3c-9d4e-5f6a7b8c9d0e";
const VM_DOM0_PROD1: string = "0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e";
const SR_PROD_NFS: string = "1d2c3b4a-5e6f-4789-9abc-def012345678";

const SUMMARY: XcpNgInventorySummary = {
  hostCount: 3,
  runningHostCount: 2,
  disabledHostCount: 1,
  vmCount: 4,
  runningVmCount: 2,
  storageRepositoryCount: 3,
  vdiCount: 3,
  storageCapacityBytes: 2548 * 1024 * 1024 * 1024,
  storageUsedBytes: 2014 * 1024 * 1024 * 1024,
};

const AUTO_DISCOVERY_MOCKS_RETURNING_NULL: Array<string> = [
  "autoDiscoverKubernetesCluster",
  "autoDiscoverDockerHost",
  "autoDiscoverPodmanHost",
  "autoDiscoverProxmoxCluster",
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

function scrape(
  which: 1 | 2,
  options: { rateSeriesAsSums?: boolean } = {},
): Array<JSONObject> {
  return toAgentResourceMetrics(parseOpenMetrics(readRecordedScrape(which)), {
    scrapeSeconds: which === 1 ? SCRAPE_1_NOW_SECONDS : SCRAPE_2_NOW_SECONDS,
    rateSeriesAsSums: options.rateSeriesAsSums,
  });
}

function request(blocks: Array<JSONObject>): TelemetryRequest {
  return {
    projectId: PROJECT_ID,
    body: { resourceMetrics: blocks },
    headers: {},
  } as unknown as TelemetryRequest;
}

function noRules(): MetricRulesForProject {
  return { projectRules: [], rulesByServiceId: new Map() };
}

function dropEverythingRules(): MetricRulesForProject {
  // A Drop rule with no filters matches (and drops) every datapoint.
  const rule: MetricPipelineRule = new MetricPipelineRule();
  rule.ruleType = MetricPipelineRuleType.Drop;
  rule.filters = [];
  return { projectRules: [rule], rulesByServiceId: new Map() };
}

function poolIdentifierOf(attributes: JSONArray): string | null {
  for (const entry of attributes) {
    const attribute: JSONObject = entry as JSONObject;
    if (attribute["key"] === XCP_NG_POOL_ID_ATTRIBUTE) {
      return (attribute["value"] as JSONObject)["stringValue"] as string;
    }
  }
  return null;
}

function poolIdOf(poolIdentifier: string | null): ObjectID | null {
  if (poolIdentifier === PRODUCTION_POOL_ID) {
    return PRODUCTION_ID;
  }
  if (poolIdentifier === UNNAMED_POOL_ID) {
    return UNNAMED_ID;
  }
  return null;
}

interface Spies {
  discoverPool: jest.SpyInstance;
  bulkUpsert: jest.SpyInstance;
  getInventorySummary: jest.SpyInstance;
  findVmsThatRanRecently: jest.SpyInstance;
  updateLastSeen: jest.SpyInstance;
  recordReportedNames: jest.SpyInstance;
  stored: Array<JSONObject>;
}

function setupIngestMocks(
  data: {
    rules?: MetricRulesForProject;
    ranRecently?: Array<string>;
  } = {},
): Spies {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service: Record<string, any> = OtelMetricsIngestService as unknown as {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  };

  jest.spyOn(service, "runBatchHostEnrichment").mockResolvedValue(undefined);

  // What reaches ClickHouse, row by row.
  const stored: Array<JSONObject> = [];
  jest
    .spyOn(service, "submitMetricsBuffer")
    .mockImplementation(async (...args: Array<unknown>) => {
      const metrics: Array<JSONObject> = args[0] as Array<JSONObject>;
      stored.push(...metrics.splice(0, metrics.length));
    });

  for (const method of AUTO_DISCOVERY_MOCKS_RETURNING_NULL) {
    jest.spyOn(service, method).mockResolvedValue(null);
  }

  const discoverPool: jest.SpyInstance = jest
    .spyOn(service, "autoDiscoverXcpNgPool")
    .mockImplementation(async (...args: Array<unknown>) => {
      const input: { attributes: JSONArray } = args[0] as {
        attributes: JSONArray;
      };
      return poolIdOf(poolIdentifierOf(input.attributes));
    });

  jest
    .spyOn(service, "resolveTelemetryResource")
    .mockImplementation(async (...args: Array<unknown>) => {
      const input: { xcpNgPoolId?: ObjectID | null } = (args[0] || {}) as {
        xcpNgPoolId?: ObjectID | null;
      };
      const primary: ObjectID = input.xcpNgPoolId || PRODUCTION_ID;
      return {
        serviceName: `xcp-ng/${primary.toString()}`,
        primaryEntityId: primary,
        primaryEntityType: ServiceType.XcpNgPool,
        dataRententionInDays: 15,
        serviceRetentionConfig: null,
        serviceRetentionInDays: null,
        projectRetentionConfig: null,
        projectRetentionInDays: 15,
      };
    });

  jest
    .spyOn(MetricPipelineRuleService, "loadRules")
    .mockResolvedValue(data.rules ?? noRules());
  jest
    .spyOn(TelemetryUtil, "indexMetricNameServiceNameMap")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .mockResolvedValue(undefined as any);

  const bulkUpsert: jest.SpyInstance = jest
    .spyOn(XcpNgResourceService, "bulkUpsert")
    .mockResolvedValue(undefined);
  const getInventorySummary: jest.SpyInstance = jest
    .spyOn(XcpNgResourceService, "getInventorySummary")
    .mockResolvedValue(SUMMARY);
  const findVmsThatRanRecently: jest.SpyInstance = jest
    .spyOn(XcpNgResourceService, "findVmsThatRanRecently")
    .mockResolvedValue(new Set<string>(data.ranRecently || []));
  const updateLastSeen: jest.SpyInstance = jest
    .spyOn(XcpNgPoolService, "updateLastSeen")
    .mockResolvedValue(HEARTBEAT_ROW_PRESENT);
  const recordReportedNames: jest.SpyInstance = jest
    .spyOn(XcpNgPoolService, "recordReportedNames")
    .mockResolvedValue(undefined);

  return {
    discoverPool,
    bulkUpsert,
    getInventorySummary,
    findVmsThatRanRecently,
    updateLastSeen,
    recordReportedNames,
    stored,
  };
}

function inventoryOf(
  spies: Spies,
  poolId: ObjectID,
): Array<ParsedXcpNgResource> {
  const calls: Array<
    [
      {
        projectId: ObjectID;
        xcpNgPoolId: ObjectID;
        resources: Array<ParsedXcpNgResource>;
      },
    ]
  > = spies.bulkUpsert.mock.calls as Array<
    [
      {
        projectId: ObjectID;
        xcpNgPoolId: ObjectID;
        resources: Array<ParsedXcpNgResource>;
      },
    ]
  >;
  const ofPool: Array<ParsedXcpNgResource> = [];
  for (const [args] of calls) {
    expect(args.projectId.toString()).toBe(PROJECT_ID.toString());
    if (args.xcpNgPoolId.toString() === poolId.toString()) {
      ofPool.push(...args.resources);
    }
  }
  return ofPool;
}

function resourceOf(
  rows: Array<ParsedXcpNgResource>,
  kind: XcpNgResourceKind,
  externalId: string,
): ParsedXcpNgResource {
  const found: ParsedXcpNgResource | undefined = rows.find(
    (row: ParsedXcpNgResource) => {
      return row.kind === kind && row.externalId === externalId;
    },
  );
  if (!found) {
    throw new Error(`expected an inventory row ${kind} ${externalId}`);
  }
  return found;
}

function storedNamed(spies: Spies, name: string): Array<JSONObject> {
  return spies.stored.filter((row: JSONObject) => {
    return row["name"] === name;
  });
}

function attributeOf(row: JSONObject, key: string): unknown {
  return ((row["attributes"] || {}) as JSONObject)[key];
}

function storedOf(
  spies: Spies,
  name: string,
  scopeId: string,
): JSONObject | undefined {
  return storedNamed(spies, name).find((row: JSONObject) => {
    return attributeOf(row, XCP_NG_ID_ATTRIBUTE) === scopeId;
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("XCP-ng ingest - two pools behind one Xen Orchestra", () => {
  test("each pool is discovered by its UUID, and gets its own inventory and heartbeat", async () => {
    const spies: Spies = setupIngestMocks();

    await OtelMetricsIngestService.processMetricsFromQueue(request(scrape(1)));

    // One discovery per resource block: one block per pool.
    expect(spies.discoverPool).toHaveBeenCalledTimes(2);

    const production: Array<ParsedXcpNgResource> = inventoryOf(
      spies,
      PRODUCTION_ID,
    );
    const unnamed: Array<ParsedXcpNgResource> = inventoryOf(spies, UNNAMED_ID);

    const hostsOf: (rows: Array<ParsedXcpNgResource>) => Array<string> = (
      rows: Array<ParsedXcpNgResource>,
    ): Array<string> => {
      return rows
        .filter((row: ParsedXcpNgResource) => {
          return row.kind === XcpNgResourceKind.Host;
        })
        .map((row: ParsedXcpNgResource) => {
          return row.externalId;
        })
        .sort();
    };
    expect(hostsOf(production)).toEqual(
      [HOST_PROD1, HOST_PROD2, HOST_PROD3].sort(),
    );
    expect(hostsOf(unnamed)).toEqual([HOST_LAB1]);

    // Nothing of one pool lands in the other's inventory.
    for (const row of unnamed) {
      expect([
        HOST_PROD1,
        HOST_PROD2,
        HOST_PROD3,
        VM_WEB01,
        SR_PROD_NFS,
      ]).not.toContain(row.externalId);
    }

    // What the pages read, as Xen Orchestra reported it.
    expect(
      resourceOf(production, XcpNgResourceKind.Host, HOST_PROD3).isUp,
    ).toBe(false);
    expect(
      resourceOf(production, XcpNgResourceKind.Host, HOST_PROD2).isEnabled,
    ).toBe(false);
    expect(
      resourceOf(production, XcpNgResourceKind.VM, VM_DOM0_PROD1)
        .isControlDomain,
    ).toBe(true);
    expect(
      resourceOf(production, XcpNgResourceKind.VM, VM_WEB01).powerState,
    ).toBe("Running");
    expect(
      resourceOf(production, XcpNgResourceKind.StorageRepository, SR_PROD_NFS)
        .latestDiskPercent,
    ).toBeGreaterThan(90);

    // Each pool read is recounted from its stored inventory and heartbeats.
    expect(spies.getInventorySummary).toHaveBeenCalledTimes(2);
    expect(spies.updateLastSeen).toHaveBeenCalledTimes(2);
    const heartbeats: Array<string> = spies.updateLastSeen.mock.calls
      .map((call: Array<unknown>) => {
        return (call[0] as ObjectID).toString();
      })
      .sort();
    expect(heartbeats).toEqual(
      [PRODUCTION_ID.toString(), UNNAMED_ID.toString()].sort(),
    );
    for (const call of spies.updateLastSeen.mock.calls) {
      expect(call[1]).toEqual(SUMMARY);
    }
  });

  test("what Xen Orchestra calls each pool, and itself, is followed", async () => {
    const spies: Spies = setupIngestMocks();

    await OtelMetricsIngestService.processMetricsFromQueue(request(scrape(1)));

    const byPool: Map<
      string,
      { reportedName?: string | undefined; xenOrchestraName?: string }
    > = new Map();
    for (const call of spies.recordReportedNames.mock.calls) {
      const args: {
        xcpNgPoolId: ObjectID;
        reportedName?: string | undefined;
        xenOrchestraName?: string;
      } = call[0] as {
        xcpNgPoolId: ObjectID;
        reportedName?: string | undefined;
        xenOrchestraName?: string;
      };
      byPool.set(args.xcpNgPoolId.toString(), args);
    }
    expect(byPool.get(PRODUCTION_ID.toString())?.reportedName).toBe(
      "Production",
    );
    expect(byPool.get(PRODUCTION_ID.toString())?.xenOrchestraName).toBe(
      "xo-lab",
    );
    // A pool XAPI names nothing reports no name; OneUptime names it.
    expect(byPool.get(UNNAMED_ID.toString())?.reportedName).toBeUndefined();
    expect(byPool.get(UNNAMED_ID.toString())?.xenOrchestraName).toBe("xo-lab");
  });
});

describe("XCP-ng ingest - the rows stored", () => {
  test("every point carries xcp_ng.scope and xcp_ng.id, and its pool", async () => {
    const spies: Spies = setupIngestMocks();

    await OtelMetricsIngestService.processMetricsFromQueue(request(scrape(1)));

    const xcpRows: Array<JSONObject> = spies.stored.filter(
      (row: JSONObject) => {
        const name: string = row["name"] as string;
        return name.startsWith("xcp_") || name.startsWith("xcp_ng.");
      },
    );
    expect(xcpRows.length).toBeGreaterThan(100);
    for (const row of xcpRows) {
      expect([row["name"], attributeOf(row, XCP_NG_SCOPE_ATTRIBUTE)]).toEqual([
        row["name"],
        expect.stringMatching(/^(pool|host|vm|sr|vdi|xostor)$/),
      ]);
      expect([row["name"], attributeOf(row, XCP_NG_ID_ATTRIBUTE)]).toEqual([
        row["name"],
        expect.any(String),
      ]);
      expect(attributeOf(row, `resource.${XCP_NG_POOL_ID_ATTRIBUTE}`)).toMatch(
        new RegExp(`^(${PRODUCTION_POOL_ID}|${UNNAMED_POOL_ID})$`),
      );
    }
  });

  test.each([
    ["as the agent sends them (gauges)", false],
    ["as a collector configured by hand sends them (sums)", true],
  ])(
    "the eight rates typed as counters are stored as gauges, %s",
    async (_how: string, rateSeriesAsSums: boolean) => {
      const spies: Spies = setupIngestMocks();
      const samples: Array<OpenMetricsSample> = parseOpenMetrics(
        readRecordedScrape(1),
      );

      await OtelMetricsIngestService.processMetricsFromQueue(
        request(scrape(1, { rateSeriesAsSums })),
      );

      for (const name of XCP_NG_RATE_TYPED_AS_COUNTER_SERIES) {
        const served: Array<number> = samples
          .filter((s: OpenMetricsSample) => {
            return s.name === name && Boolean(s.labels["pool_id"]);
          })
          .map((s: OpenMetricsSample) => {
            return s.value;
          })
          .sort((a: number, b: number) => {
            return a - b;
          });
        const rows: Array<JSONObject> = storedNamed(spies, name);
        expect([name, rows.length]).toEqual([name, served.length]);
        for (const row of rows) {
          expect([name, row["metricPointType"]]).toEqual([
            name,
            MetricPointType.Gauge,
          ]);
        }
        // Xen Orchestra's per-second values, untouched.
        expect(
          rows
            .map((row: JSONObject) => {
              return row["value"] as number;
            })
            .sort((a: number, b: number) => {
              return a - b;
            }),
        ).toEqual(served);
      }
    },
  );

  test("the derived health series are stored for every host and VM", async () => {
    const spies: Spies = setupIngestMocks();

    await OtelMetricsIngestService.processMetricsFromQueue(request(scrape(1)));

    expect(
      storedOf(spies, XcpNgDerivedSeries.HostRunning, HOST_PROD1)?.["value"],
    ).toBe(1);
    expect(
      storedOf(spies, XcpNgDerivedSeries.HostRunning, HOST_PROD3)?.["value"],
    ).toBe(0);
    expect(
      storedOf(spies, XcpNgDerivedSeries.HostEnabled, HOST_PROD2)?.["value"],
    ).toBe(0);
    expect(
      storedOf(spies, XcpNgDerivedSeries.HostEnabled, HOST_PROD1)?.["value"],
    ).toBe(1);
    expect(
      storedOf(spies, XcpNgDerivedSeries.VmRunning, VM_WEB01)?.["value"],
    ).toBe(1);
    expect(
      storedOf(spies, XcpNgDerivedSeries.VmRunning, VM_APP02)?.["value"],
    ).toBe(0);
    // Hosts of both pools.
    expect(
      storedOf(spies, XcpNgDerivedSeries.HostRunning, HOST_LAB1)?.["value"],
    ).toBe(1);
    for (const row of storedNamed(spies, XcpNgDerivedSeries.HostRunning)) {
      expect(row["metricPointType"]).toBe(MetricPointType.Gauge);
      expect(attributeOf(row, XCP_NG_SCOPE_ATTRIBUTE)).toBe("host");
    }
  });

  test("a VM halted a minute after it ran reads 1 on stopped_after_running", async () => {
    // Scrape 2: web-01 halted. The inventory says it ran within the day.
    const spies: Spies = setupIngestMocks({ ranRecently: [VM_WEB01] });

    await OtelMetricsIngestService.processMetricsFromQueue(request(scrape(2)));

    expect(spies.findVmsThatRanRecently).toHaveBeenCalled();
    expect(
      storedOf(spies, XcpNgDerivedSeries.VmStoppedAfterRunning, VM_WEB01)?.[
        "value"
      ],
    ).toBe(1);
    expect(
      storedOf(spies, XcpNgDerivedSeries.VmRunning, VM_WEB01)?.["value"],
    ).toBe(0);
    // app-02 started in scrape 2: running, not stopped.
    expect(
      storedOf(spies, XcpNgDerivedSeries.VmStoppedAfterRunning, VM_APP02)?.[
        "value"
      ],
    ).toBe(0);
  });

  test("a VM that has been halted for long reads 0 on stopped_after_running", async () => {
    const spies: Spies = setupIngestMocks({ ranRecently: [] });

    await OtelMetricsIngestService.processMetricsFromQueue(request(scrape(2)));

    expect(
      storedOf(spies, XcpNgDerivedSeries.VmStoppedAfterRunning, VM_WEB01)?.[
        "value"
      ],
    ).toBe(0);
  });
});

describe("XCP-ng ingest - what is not a read, and what never blocks one", () => {
  test("a pool Xen Orchestra lost sends only a staleness marker: no inventory, no heartbeat", async () => {
    const spies: Spies = setupIngestMocks();
    const lost: Array<OpenMetricsSample> = parseOpenMetrics(
      readRecordedScrape(1),
    ).filter((s: OpenMetricsSample) => {
      return (
        s.name === "xcp_pool_connected" &&
        s.labels["pool_id"] === UNNAMED_POOL_ID
      );
    });
    const blocks: Array<JSONObject> = toAgentResourceMetrics(lost, {
      scrapeSeconds: SCRAPE_2_NOW_SECONDS,
      staleSeries: ["xcp_pool_connected"],
    });
    expect(blocks).toHaveLength(1);

    await OtelMetricsIngestService.processMetricsFromQueue(request(blocks));

    expect(spies.discoverPool).toHaveBeenCalledTimes(1);
    expect(spies.bulkUpsert).not.toHaveBeenCalled();
    expect(spies.updateLastSeen).not.toHaveBeenCalled();
  });

  test("the fold runs before the pipeline rules: a Drop rule does not blank the inventory", async () => {
    const spies: Spies = setupIngestMocks({ rules: dropEverythingRules() });

    await OtelMetricsIngestService.processMetricsFromQueue(request(scrape(1)));

    expect(inventoryOf(spies, PRODUCTION_ID).length).toBeGreaterThan(10);
    expect(spies.updateLastSeen).toHaveBeenCalledTimes(2);
  });

  test("a failing inventory write is swallowed, and the pool still heartbeats", async () => {
    const spies: Spies = setupIngestMocks();
    spies.bulkUpsert.mockRejectedValue(new Error("connection reset"));

    await expect(
      OtelMetricsIngestService.processMetricsFromQueue(request(scrape(1))),
    ).resolves.toBeUndefined();

    expect(spies.updateLastSeen).toHaveBeenCalledTimes(2);
  });

  test("a failing heartbeat is swallowed too", async () => {
    const spies: Spies = setupIngestMocks();
    spies.updateLastSeen.mockRejectedValue(new Error("connection reset"));

    await expect(
      OtelMetricsIngestService.processMetricsFromQueue(request(scrape(1))),
    ).resolves.toBeUndefined();

    expect(spies.bulkUpsert).toHaveBeenCalled();
  });

  test("a failing lookup of which VMs ran never blocks the rows", async () => {
    const spies: Spies = setupIngestMocks();
    spies.findVmsThatRanRecently.mockRejectedValue(new Error("timeout"));

    await OtelMetricsIngestService.processMetricsFromQueue(request(scrape(2)));

    // Stored, with the stopped VM read as not having run recently.
    expect(
      storedOf(spies, XcpNgDerivedSeries.VmStoppedAfterRunning, VM_WEB01)?.[
        "value"
      ],
    ).toBe(0);
    expect(spies.bulkUpsert).toHaveBeenCalled();
  });
});

describe("XCP-ng ingest - the name Xen Orchestra gives a pool", () => {
  function productionBlock(): JSONObject {
    const block: JSONObject | undefined = scrape(1).find((rm: JSONObject) => {
      return (
        poolIdentifierOf(
          ((rm["resource"] as JSONObject)["attributes"] as JSONArray) || [],
        ) === PRODUCTION_POOL_ID
      );
    });
    if (!block) {
      throw new Error("expected the Production pool's block");
    }
    return block;
  }

  function withPoolName(block: JSONObject, name: string | null): JSONObject {
    const copy: JSONObject = JSON.parse(JSON.stringify(block)) as JSONObject;
    const resource: JSONObject = copy["resource"] as JSONObject;
    const attributes: JSONArray = (
      (resource["attributes"] as JSONArray) || []
    ).filter((entry: unknown) => {
      return (entry as JSONObject)["key"] !== "xcp_ng.pool.name";
    });
    if (name !== null) {
      attributes.push({
        key: "xcp_ng.pool.name",
        value: { stringValue: name },
      });
    }
    resource["attributes"] = attributes;
    return copy;
  }

  function reportedNamesOf(
    spies: Spies,
    poolId: ObjectID,
  ): Array<string | undefined> {
    return spies.recordReportedNames.mock.calls
      .map((call: Array<unknown>) => {
        return call[0] as {
          xcpNgPoolId: ObjectID;
          reportedName?: string | undefined;
        };
      })
      .filter((args: { xcpNgPoolId: ObjectID }) => {
        return args.xcpNgPoolId.toString() === poolId.toString();
      })
      .map((args: { reportedName?: string | undefined }) => {
        return args.reportedName;
      });
  }

  test("a pool split into a named and a nameless block keeps the name", async () => {
    const spies: Spies = setupIngestMocks();
    const named: JSONObject = productionBlock();

    // The nameless block comes last, as a series without pool_name can.
    await OtelMetricsIngestService.processMetricsFromQueue(
      request([named, withPoolName(named, null)]),
    );

    expect(reportedNamesOf(spies, PRODUCTION_ID)).toEqual(["Production"]);
  });

  test("a name that is the pool's own UUID is no name", async () => {
    const spies: Spies = setupIngestMocks();

    /*
     * Xen Orchestra labels the hosts' RRD series with the pool's UUID until
     * it has loaded the pool itself.
     */
    await OtelMetricsIngestService.processMetricsFromQueue(
      request([withPoolName(productionBlock(), PRODUCTION_POOL_ID)]),
    );

    expect(reportedNamesOf(spies, PRODUCTION_ID)).toEqual([undefined]);
    // What Xen Orchestra calls itself is still followed.
    expect(spies.recordReportedNames).toHaveBeenCalledWith(
      expect.objectContaining({ xenOrchestraName: "xo-lab" }),
    );
  });

  test("an upper-case UUID as the name is no name either", async () => {
    const spies: Spies = setupIngestMocks();

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([
        withPoolName(productionBlock(), PRODUCTION_POOL_ID.toUpperCase()),
      ]),
    );

    expect(reportedNamesOf(spies, PRODUCTION_ID)).toEqual([undefined]);
  });
});
