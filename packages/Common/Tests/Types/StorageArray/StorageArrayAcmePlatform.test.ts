import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  StorageArrayResourceBufferEntry,
  StorageArraySnapshotBufferEntry,
} from "../../../Server/Utils/Telemetry/StorageArray/StorageArrayExtractor";
import StorageArrayExtractors from "../../../Server/Utils/Telemetry/StorageArray/StorageArrayExtractors";
import {
  bufferStorageArraySnapshotMetric,
  deriveStorageArrayCountsByKind,
  deriveStorageArraySnapshotExtras,
  getStorageArrayResourceRows,
  isStorageArraySnapshotMetric,
  StorageArraySnapshotDerivedExtras,
} from "../../../Server/Utils/Telemetry/StorageArraySnapshotScan";
import MonitorCriteriaEvaluator from "../../../Server/Utils/Monitor/MonitorCriteriaEvaluator";
import { JSONObject } from "../../../Types/JSON";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorStepStorageArrayMonitor, {
  StorageArrayResourceScope,
} from "../../../Types/Monitor/MonitorStepStorageArrayMonitor";
import MonitorRecommendationCatalog from "../../../Types/Monitor/Recommendation/MonitorRecommendationCatalog";
import {
  MonitorRecommendation,
  MonitorRecommendationResourceType,
} from "../../../Types/Monitor/Recommendation/MonitorRecommendationTypes";
import {
  StorageArrayAlertTemplate,
  getAllStorageArrayAlertTemplates,
  getStorageArrayAlertTemplateById,
  getStorageArrayAlertTemplatesForSystem,
  getStorageArrayDefaultAlertTemplateId,
} from "../../../Types/Monitor/StorageArrayAlertTemplates";
import {
  StorageArrayMetricDefinition,
  getAllStorageArrayMetrics,
  getStorageArrayMetricById,
  getStorageArrayMetricByMetricName,
  getStorageArrayMetricsForSystem,
  getStorageArrayObjectLabel,
} from "../../../Types/Monitor/StorageArrayMetricCatalog";
import ObjectID from "../../../Types/ObjectID";
import StorageArrayPlatformRegistry from "../../../Types/StorageArray/StorageArrayPlatformRegistry";
import StorageArrayResourceKind from "../../../Types/StorageArray/StorageArrayResourceKind";
import StorageArrayResourceKindUtil from "../../../Types/StorageArray/StorageArrayResourceKindUtil";
import StorageSystem from "../../../Types/StorageArray/StorageSystem";
import StorageSystemUtil from "../../../Types/StorageArray/StorageSystemUtil";
import ResourceHeartbeatUtil from "../../../Utils/Monitor/ResourceHeartbeat";
import {
  ACME_AGGREGATE_KIND,
  ACME_EXTRACTOR,
  ACME_METRIC_IDS,
  ACME_PLATFORM,
  ACME_STORAGE_SYSTEM,
  ACME_TEMPLATE_IDS,
  AcmeSeries,
  acmeAggregatesScrape,
  acmeDatapoint,
  acmeVolumesScrape,
} from "../../Helpers/StorageArray/AcmePlatform";

/*
 * A PLATFORM PLUGS IN WITHOUT A SHIPPED FILE CHANGING (#11000).
 *
 * Acme (Tests/Helpers/StorageArray/AcmePlatform.ts) is declared in a test
 * and registered at runtime, with its extractor. From there this follows it
 * the way the product does: ingest discovers its array and inventory and
 * counts both kinds, the catalog and the monitor's metric picker offer its
 * metrics, its templates and Recommendations offer its monitors, a monitor
 * made from its template fires an alert on its own series, and the
 * evaluator names the aggregate the alert is about. Pure Storage's platforms
 * read the same before and after, and no file under Pure's folders - or
 * anywhere shipped - names Acme.
 *
 * The Dashboard's side of it (its tabs, counts and inventory page) is
 * StorageArrayAcmePlatformPages.test.tsx.
 */

const ARRAY_ID: string = "acme-array-id";

// Acme's value or one of its series, as a shipped file would name them.
const NAMES_ACME: RegExp = /acme[._]/i;
const FLASHARRAY: string = StorageSystem.PureStorageFlashArray;
const FLASHBLADE: string = StorageSystem.PureStorageFlashBlade;

interface EvaluatorPrivate {
  getStorageArrayObjectKind: (
    metricName: string,
    storageSystem?: string | null | undefined,
  ) => string | null;
  getStorageArrayAffectedResourceEntry: (input: {
    resource: JSONObject;
    arrayName: string;
    metricName: string;
    value: string;
  }) => { kind: string; name: unknown; details: unknown };
}

const Evaluator: EvaluatorPrivate =
  MonitorCriteriaEvaluator as unknown as EvaluatorPrivate;

// What every reader answers for Pure Storage, to compare before and after.
function pureReadings(): string {
  return JSON.stringify(
    [FLASHARRAY, FLASHBLADE].map((system: string) => {
      return {
        system,
        known: StorageSystemUtil.isKnownSystem(system),
        metrics: getStorageArrayMetricsForSystem(system),
        templates: getStorageArrayAlertTemplatesForSystem(system).map(
          (template: StorageArrayAlertTemplate) => {
            return {
              id: template.id,
              name: template.name,
              severity: template.severity,
              storageSystems: template.storageSystems,
            };
          },
        ),
        defaultTemplate: getStorageArrayDefaultAlertTemplateId(system),
        kinds: StorageArrayResourceKindUtil.getKindsForSystem(system),
        volumeLabel: getStorageArrayObjectLabel(
          StorageArrayResourceScope.Volume,
          system,
        ),
        recommendations: MonitorRecommendationCatalog.getRecommendations(
          MonitorRecommendationResourceType.StorageArray,
          { storageSystem: system },
        ).map((recommendation: MonitorRecommendation): string => {
          return recommendation.templateId;
        }),
        volumeKind: StorageArrayPlatformRegistry.getObjectKindForMetricName(
          "purefa_volume_space_bytes",
          system,
        ),
      };
    }),
  );
}

const PURE_BEFORE: string = pureReadings();
const ALL_METRICS_BEFORE: number = getAllStorageArrayMetrics().length;
const ALL_TEMPLATES_BEFORE: number = getAllStorageArrayAlertTemplates().length;

beforeAll(() => {
  StorageArrayPlatformRegistry.register(ACME_PLATFORM);
  StorageArrayExtractors.register(ACME_EXTRACTOR);
});

afterAll(() => {
  StorageArrayExtractors.unregister(ACME_STORAGE_SYSTEM);
  StorageArrayPlatformRegistry.unregister(ACME_STORAGE_SYSTEM);
});

interface Ingested {
  rows: Array<StorageArrayResourceBufferEntry>;
  extras: StorageArraySnapshotDerivedExtras;
  countsByKind: Record<string, number> | null;
  read: Array<string>;
}

/*
 * One batch of one array, exactly as OtelMetricsIngestService handles it:
 * the gate, the declared storage.system, the buffers, then what its flush
 * derives and writes.
 */
function ingest(
  batch: Array<AcmeSeries>,
  declaredStorageSystem: string | null = ACME_STORAGE_SYSTEM,
): Ingested {
  const resourceBuffer: Map<
    string,
    Map<string, StorageArrayResourceBufferEntry>
  > = new Map();
  const arrayBuffer: Map<string, StorageArraySnapshotBufferEntry> = new Map();
  const read: Set<string> = new Set();

  for (const series of batch) {
    if (!isStorageArraySnapshotMetric(series.metricName)) {
      continue;
    }
    read.add(series.metricName);
    bufferStorageArraySnapshotMetric({
      arrayIdStr: ARRAY_ID,
      metricName: series.metricName,
      datapoint: acmeDatapoint({ value: series.value, labels: series.labels }),
      resourceBuffer,
      arrayBuffer,
      declaredStorageSystem,
    });
  }

  const snap: StorageArraySnapshotBufferEntry | undefined =
    arrayBuffer.get(ARRAY_ID);
  const rows: Array<StorageArrayResourceBufferEntry> =
    getStorageArrayResourceRows(
      Array.from(resourceBuffer.get(ARRAY_ID)?.values() || []),
      snap,
    );
  return {
    rows,
    extras: deriveStorageArraySnapshotExtras(rows, snap),
    countsByKind: deriveStorageArrayCountsByKind(rows, snap),
    read: Array.from(read).sort(),
  };
}

function rowsOf(
  ingested: Ingested,
  kind: string,
): Array<{ name: string | null; used: number | null; size: number | null }> {
  return ingested.rows
    .filter((row: StorageArrayResourceBufferEntry): boolean => {
      return row.kind === kind;
    })
    .map((row: StorageArrayResourceBufferEntry) => {
      return {
        name: row.name,
        used: row.usedBytes,
        size: row.capacityBytes,
      };
    })
    .sort((a: { name: string | null }, b: { name: string | null }): number => {
      return (a.name || "").localeCompare(b.name || "");
    });
}

const TEMPLATE_ARGS: {
  arrayIdentifier: string;
  onlineMonitorStatusId: ObjectID;
  offlineMonitorStatusId: ObjectID;
  defaultIncidentSeverityId: ObjectID;
  defaultAlertSeverityId: ObjectID;
  monitorName: string;
} = {
  arrayIdentifier: "acme-prod-01",
  onlineMonitorStatusId: ObjectID.generate(),
  offlineMonitorStatusId: ObjectID.generate(),
  defaultIncidentSeverityId: ObjectID.generate(),
  defaultAlertSeverityId: ObjectID.generate(),
  monitorName: "acme-prod-01: Aggregate Nearly Full",
};

describe("Acme is discovered", () => {
  test("as a platform, under its value and its aliases", () => {
    expect(StorageArrayPlatformRegistry.getPlatform(ACME_STORAGE_SYSTEM)).toBe(
      ACME_PLATFORM,
    );
    expect(StorageSystemUtil.isKnownSystem(ACME_STORAGE_SYSTEM)).toBe(true);
    for (const spelling of ["acme", "ACME", "acme_array", " Acme.Array "]) {
      expect(StorageSystemUtil.normalize(spelling)).toBe(ACME_STORAGE_SYSTEM);
    }
    expect(StorageSystemUtil.getDisplayName(ACME_STORAGE_SYSTEM)).toBe(
      "Acme Array",
    );
    expect(StorageSystemUtil.getShortName(ACME_STORAGE_SYSTEM)).toBe("Acme");
    expect(StorageSystemUtil.getVendorName(ACME_STORAGE_SYSTEM)).toBe("Acme");
    expect(StorageSystemUtil.fromMetricName("acme_volume_used_bytes")).toBe(
      ACME_STORAGE_SYSTEM,
    );
  });

  test("its array, named and versioned, by ingest", () => {
    const ingested: Ingested = ingest(
      acmeVolumesScrape([{ name: "vol-a", usedBytes: 100 }]),
    );
    expect(ingested.read).toEqual(["acme_info", "acme_volume_used_bytes"]);
    expect(ingested.extras).toMatchObject({
      storageSystem: ACME_STORAGE_SYSTEM,
      reportedName: "acme-prod-01",
      osName: "AcmeOS",
      osVersion: "9.1",
    });
  });

  test("by its series alone, when its agent declares no platform", () => {
    const ingested: Ingested = ingest(
      acmeVolumesScrape([{ name: "vol-a", usedBytes: 100 }]),
      null,
    );
    expect(ingested.extras.storageSystem).toBe(ACME_STORAGE_SYSTEM);
    expect(rowsOf(ingested, StorageArrayResourceKind.Volume)).toHaveLength(1);
  });
});

describe("Acme's inventory and counts", () => {
  test("a volumes scrape lists its volumes, and counts them", () => {
    const ingested: Ingested = ingest(
      acmeVolumesScrape([
        { name: "vol-b", usedBytes: 2048 },
        { name: "vol-a", usedBytes: 1024, state: "offline" },
        { name: "vol-c", usedBytes: 0 },
      ]),
    );
    expect(rowsOf(ingested, StorageArrayResourceKind.Volume)).toEqual([
      { name: "vol-a", used: 1024, size: null },
      { name: "vol-b", used: 2048, size: null },
      { name: "vol-c", used: 0, size: null },
    ]);
    expect(
      ingested.rows.find((row: StorageArrayResourceBufferEntry): boolean => {
        return row.name === "vol-a";
      })?.status,
    ).toBe("offline");
    // Only the kind the batch listed in full is counted.
    expect(ingested.countsByKind).toEqual({ Volume: 3 });
    // The shared column a page reads for a shared kind is written as well.
    expect(ingested.extras.volumeCount).toBe(3);
  });

  test("an aggregates scrape lists its aggregates - a kind of its own - and counts them", () => {
    const ingested: Ingested = ingest(
      acmeAggregatesScrape([
        { name: "aggr1", usedBytes: 700, sizeBytes: 1000 },
        { name: "aggr2", usedBytes: 50, sizeBytes: 2000 },
      ]),
    );
    expect(rowsOf(ingested, ACME_AGGREGATE_KIND)).toEqual([
      { name: "aggr1", used: 700, size: 1000 },
      { name: "aggr2", used: 50, size: 2000 },
    ]);
    expect(ingested.countsByKind).toEqual({ [ACME_AGGREGATE_KIND]: 2 });
    // No shared column holds aggregates; nothing else is counted.
    expect(ingested.extras.volumeCount).toBeUndefined();
  });

  test("a batch of both endpoints counts both", () => {
    expect(
      ingest([
        ...acmeVolumesScrape([{ name: "vol-a", usedBytes: 1 }]),
        ...acmeAggregatesScrape([
          { name: "aggr1", usedBytes: 1, sizeBytes: 2 },
        ]),
      ]).countsByKind,
    ).toEqual({ [ACME_AGGREGATE_KIND]: 1, Volume: 1 });
  });

  test("an endpoint whose last object was deleted counts 0", () => {
    expect(ingest(acmeAggregatesScrape([])).countsByKind).toEqual({
      [ACME_AGGREGATE_KIND]: 0,
    });
  });

  test("a series of another platform's prefix in an Acme batch is that platform's", () => {
    const ingested: Ingested = ingest([
      ...acmeVolumesScrape([{ name: "vol-a", usedBytes: 1 }]),
      {
        metricName: "purefa_info",
        value: 1,
        labels: { array_name: "fa-prod-01", scrape_endpoint: "array" },
      },
    ]);
    // The first platform seen keeps the batch.
    expect(ingested.extras.storageSystem).toBe(ACME_STORAGE_SYSTEM);
    expect(ingested.read).toContain("purefa_info");
  });

  test("a series Acme does not read leaves the inventory alone", () => {
    const ingested: Ingested = ingest([
      {
        metricName: "acme_aggregate_used_percent",
        value: 70,
        labels: { aggregate: "aggr1", scrape_endpoint: "aggregates" },
      },
    ]);
    expect(ingested.read).toEqual([]);
    expect(ingested.rows).toEqual([]);
    expect(ingested.countsByKind).toBeNull();
  });

  test("its kinds are named from its own words", () => {
    expect(
      StorageArrayResourceKindUtil.getKindsForSystem(ACME_STORAGE_SYSTEM),
    ).toEqual([StorageArrayResourceKind.Volume, ACME_AGGREGATE_KIND]);
    expect(
      StorageArrayResourceKindUtil.isKindForSystem(
        ACME_AGGREGATE_KIND,
        ACME_STORAGE_SYSTEM,
      ),
    ).toBe(true);
    expect(
      StorageArrayResourceKindUtil.isKindForSystem(
        ACME_AGGREGATE_KIND,
        FLASHARRAY,
      ),
    ).toBe(false);
    expect(
      StorageArrayResourceKindUtil.getSingularLabel(ACME_AGGREGATE_KIND),
    ).toBe("Aggregate");
    expect(
      StorageArrayResourceKindUtil.getPluralLabel(ACME_AGGREGATE_KIND),
    ).toBe("Aggregates");
    // A shared kind keeps the shared words.
    expect(
      StorageArrayResourceKindUtil.getPluralLabel(
        StorageArrayResourceKind.Volume,
      ),
    ).toBe("Volumes");
  });
});

describe("Acme's monitors", () => {
  test("its metrics are in the catalog, the picker offers them for its arrays alone", () => {
    expect(getAllStorageArrayMetrics()).toHaveLength(ALL_METRICS_BEFORE + 3);
    expect(
      getStorageArrayMetricsForSystem(ACME_STORAGE_SYSTEM).map(
        (metric: StorageArrayMetricDefinition): string => {
          return metric.id;
        },
      ),
    ).toEqual([
      ACME_METRIC_IDS.volumeUsed,
      ACME_METRIC_IDS.aggregateUsed,
      ACME_METRIC_IDS.aggregateUsedPercent,
    ]);
    expect(getStorageArrayMetricById(ACME_METRIC_IDS.aggregateUsed)).toBe(
      ACME_PLATFORM.metrics[1],
    );
    expect(
      getStorageArrayMetricByMetricName("acme_aggregate_used_percent")?.id,
    ).toBe(ACME_METRIC_IDS.aggregateUsedPercent);
    for (const system of [FLASHARRAY, FLASHBLADE]) {
      expect(
        getStorageArrayMetricsForSystem(system).some(
          (metric: StorageArrayMetricDefinition): boolean => {
            return metric.id.startsWith("acme-");
          },
        ),
      ).toBe(false);
    }
  });

  test("a resource filter reads the label Acme names its volumes by", () => {
    expect(
      getStorageArrayObjectLabel(
        StorageArrayResourceScope.Volume,
        ACME_STORAGE_SYSTEM,
      ),
    ).toBe("volume");
    // Pure's volumes keep theirs.
    expect(
      getStorageArrayObjectLabel(StorageArrayResourceScope.Volume, FLASHARRAY),
    ).toBe("name");
  });

  test("its templates: the heartbeat first, then its own", () => {
    const templates: Array<StorageArrayAlertTemplate> =
      getStorageArrayAlertTemplatesForSystem(ACME_STORAGE_SYSTEM);
    expect(
      templates.map((template: StorageArrayAlertTemplate) => {
        return [template.id, template.name, template.severity];
      }),
    ).toEqual([
      [ACME_TEMPLATE_IDS.heartbeat, "Array Stopped Reporting", "Critical"],
      [ACME_TEMPLATE_IDS.aggregateFull, "Aggregate Nearly Full", "Warning"],
    ]);
    expect(getStorageArrayDefaultAlertTemplateId(ACME_STORAGE_SYSTEM)).toBe(
      ACME_TEMPLATE_IDS.heartbeat,
    );
    expect(getAllStorageArrayAlertTemplates()).toHaveLength(
      ALL_TEMPLATES_BEFORE + 2,
    );
    expect(
      getStorageArrayAlertTemplateById(ACME_TEMPLATE_IDS.aggregateFull)
        ?.storageSystems,
    ).toEqual([ACME_STORAGE_SYSTEM]);
  });

  test("a monitor made from its template watches its series on that array, grouped by aggregate", () => {
    const step: MonitorStep = getStorageArrayAlertTemplateById(
      ACME_TEMPLATE_IDS.aggregateFull,
    )!.getMonitorStep(TEMPLATE_ARGS);
    const monitor: MonitorStepStorageArrayMonitor =
      step.data!.storageArrayMonitor!;

    expect(monitor.arrayIdentifier).toBe("acme-prod-01");
    expect(monitor.storageSystem).toBe(ACME_STORAGE_SYSTEM);
    expect(monitor.rollingTime).toBe(
      ACME_PLATFORM.alertTemplates[0]!.rollingTime,
    );
    const query: JSONObject = monitor.metricViewConfig.queryConfigs[0]!
      .metricQueryData as unknown as JSONObject;
    expect(query["filterData"]).toMatchObject({
      metricName: "acme_aggregate_used_percent",
      aggegationType: "Max",
    });
    expect(query["groupByAttributeKeys"]).toEqual(["aggregate"]);
    // The chart's unit is the catalog's.
    expect(
      monitor.metricViewConfig.queryConfigs[0]!.metricAliasData!.legendUnit,
    ).toBe("%");
  });

  test("it fires an alert above 90%, and recovers below its 85% line", () => {
    const step: MonitorStep = getStorageArrayAlertTemplateById(
      ACME_TEMPLATE_IDS.aggregateFull,
    )!.getMonitorStep(TEMPLATE_ARGS);
    const [offline, online] = step.data!.monitorCriteria.data!
      .monitorCriteriaInstanceArray as Array<MonitorCriteriaInstance>;

    expect(offline!.data!.filters[0]).toMatchObject({
      filterType: "Greater Than",
      value: 90,
    });
    expect(offline!.data!.createAlerts).toBe(true);
    expect(offline!.data!.alerts[0]).toMatchObject({
      title:
        "[Storage Array] Aggregate Nearly Full - acme-prod-01: Aggregate Nearly Full",
    });
    expect(offline!.data!.alerts[0]!.alertSeverityId?.toString()).toBe(
      TEMPLATE_ARGS.defaultAlertSeverityId.toString(),
    );
    expect(offline!.data!.monitorStatusId?.toString()).toBe(
      TEMPLATE_ARGS.offlineMonitorStatusId.toString(),
    );
    // Below the line by the shared recovery margin, so it does not flap.
    expect(online!.data!.filters[0]).toMatchObject({ filterType: "Less Than" });
    expect(Number(online!.data!.filters[0]!.value)).toBeLessThan(85);
    expect(Number(online!.data!.filters[0]!.value)).toBeGreaterThan(70);
  });

  test("its heartbeat watches acme_info, which a Pure array never sends", () => {
    const step: MonitorStep = getStorageArrayAlertTemplateById(
      ACME_TEMPLATE_IDS.heartbeat,
    )!.getMonitorStep(TEMPLATE_ARGS);
    expect(
      (
        step.data!.storageArrayMonitor!.metricViewConfig.queryConfigs[0]!
          .metricQueryData as unknown as JSONObject
      )["filterData"],
    ).toMatchObject({ metricName: "acme_info", aggegationType: "Count" });
    // A storage array monitor's heartbeat is any platform's.
    expect(ResourceHeartbeatUtil.getForMonitorStep(step)?.metricNames).toEqual([
      "purefa_info",
      "purefb_info",
      "acme_info",
    ]);
  });

  test("Recommendations offers an Acme array its templates, and no Pure array them", () => {
    const templateIds: (system: string) => Array<string> = (
      system: string,
    ): Array<string> => {
      return MonitorRecommendationCatalog.getRecommendations(
        MonitorRecommendationResourceType.StorageArray,
        { storageSystem: system },
      ).map((recommendation: MonitorRecommendation): string => {
        return recommendation.templateId;
      });
    };
    expect(templateIds(ACME_STORAGE_SYSTEM)).toEqual([
      ACME_TEMPLATE_IDS.heartbeat,
      ACME_TEMPLATE_IDS.aggregateFull,
    ]);
    for (const system of [FLASHARRAY, FLASHBLADE]) {
      expect(
        templateIds(system).some((id: string): boolean => {
          return id.startsWith("acme-");
        }),
      ).toBe(false);
    }
    const recommendation: MonitorRecommendation | undefined =
      MonitorRecommendationCatalog.getRecommendations(
        MonitorRecommendationResourceType.StorageArray,
        { storageSystem: ACME_STORAGE_SYSTEM },
      )[1];
    expect(recommendation).toMatchObject({
      name: "Aggregate Nearly Full",
      category: "Capacity",
    });
    expect(
      recommendation!.getMonitorStep({
        resourceIdentifier: "acme-prod-01",
        onlineMonitorStatusId: TEMPLATE_ARGS.onlineMonitorStatusId,
        offlineMonitorStatusId: TEMPLATE_ARGS.offlineMonitorStatusId,
        defaultIncidentSeverityId: TEMPLATE_ARGS.defaultIncidentSeverityId,
        defaultAlertSeverityId: TEMPLATE_ARGS.defaultAlertSeverityId,
        monitorName: "acme-prod-01",
      } as never).data!.storageArrayMonitor!.arrayIdentifier,
    ).toBe("acme-prod-01");
  });

  test("the alert names the aggregate it is about", () => {
    expect(
      Evaluator.getStorageArrayObjectKind(
        "acme_aggregate_used_percent",
        ACME_STORAGE_SYSTEM,
      ),
    ).toBe(ACME_AGGREGATE_KIND);
    expect(Evaluator.getStorageArrayObjectKind("acme_volume_used_bytes")).toBe(
      StorageArrayResourceKind.Volume,
    );
    const entry: { kind: string; name: unknown } =
      Evaluator.getStorageArrayAffectedResourceEntry({
        resource: {
          objectName: "aggr1",
          hostName: undefined,
          componentName: undefined,
          componentType: undefined,
          podName: undefined,
          alertSummary: undefined,
        } as unknown as JSONObject,
        arrayName: "acme-prod-01",
        metricName: "acme_aggregate_used_percent",
        value: "93",
      });
    expect(entry.kind).toBe("Aggregate");
    expect(JSON.stringify(entry.name)).toContain("aggr1");
  });
});

describe("Pure Storage, with Acme beside it", () => {
  test("every reader answers for Pure exactly as before Acme was registered", () => {
    expect(pureReadings()).toBe(PURE_BEFORE);
  });

  test("no shipped file names Acme: it lives in the tests alone", () => {
    const repositoryRoot: string = path.resolve(__dirname, "../../../../..");
    // Every shipped file of Storage Arrays, and the shared ones it reads.
    const shipped: Array<string> = [
      "packages/Common/Types/StorageArray",
      "packages/Common/Types/Monitor/StorageArrayAlertTemplates.ts",
      "packages/Common/Types/Monitor/StorageArrayMetricCatalog.ts",
      "packages/Common/Types/Monitor/Recommendation",
      "packages/Common/Server/Utils/Telemetry/StorageArray",
      "packages/Common/Server/Utils/Telemetry/StorageArraySnapshotScan.ts",
      "packages/Common/Server/Services/StorageArrayService.ts",
      "packages/Common/Server/Services/StorageArrayResourceService.ts",
      "packages/Common/Utils/Monitor/ResourceHeartbeat.ts",
      "packages/App/FeatureSet/Dashboard/src/Pages/StorageArray",
      "packages/App/FeatureSet/Dashboard/src/Components/StorageArray",
      "packages/App/FeatureSet/Telemetry/Services/OtelMetricsIngestService.ts",
      "agents/StorageArrayAgent",
    ];
    const naming: Array<string> = [];
    const visit: (relative: string) => void = (relative: string): void => {
      const absolute: string = path.join(repositoryRoot, relative);
      if (fs.statSync(absolute).isDirectory()) {
        for (const entry of fs.readdirSync(absolute)) {
          visit(`${relative}/${entry}`);
        }
        return;
      }
      if (NAMES_ACME.test(fs.readFileSync(absolute, "utf8"))) {
        naming.push(relative);
      }
    };
    for (const directory of shipped) {
      visit(directory);
    }
    expect(naming).toEqual([]);
  });
});
