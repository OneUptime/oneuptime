import IconProp from "../../../Types/Icon/IconProp";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import { FilterType } from "../../../Types/Monitor/CriteriaFilter";
import { StorageArrayResourceScope } from "../../../Types/Monitor/MonitorStepStorageArrayMonitor";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import {
  STORAGE_ARRAY_COMPONENT_STATUSES,
  StorageArrayPlatform,
} from "../../../Types/StorageArray/StorageArrayPlatform";
import StorageArrayPlatformRegistry from "../../../Types/StorageArray/StorageArrayPlatformRegistry";
import StorageArrayResourceKind from "../../../Types/StorageArray/StorageArrayResourceKind";
import StorageSystem from "../../../Types/StorageArray/StorageSystem";
import {
  SCRAPE_ENDPOINT_LABEL,
  StorageArrayExtractor,
  StorageArrayResourceBufferEntry,
  StorageArraySeries,
  markScrapedEndpoint,
} from "../../../Server/Utils/Telemetry/StorageArray/StorageArrayExtractor";

/*
 * ACME: A STORAGE PLATFORM THAT EXISTS ONLY IN TESTS (#11000).
 *
 * The smallest complete StorageArrayPlatform: two kinds - the shared
 * Volume and an Aggregate of its own - three metrics, a heartbeat, one
 * alert template, a resource filter and an agent config, with the
 * extractor that reads its series. The tests register it at runtime
 * (registerAcme) and follow it from ingest to its tabs, counts, monitor
 * template and alert, so they prove a platform plugs in without a shipped
 * file changing. It is also the shortest example of what a new platform
 * writes: compare Platforms/PureStorage/ for a full one.
 *
 * Its agent scrapes two endpoints: `volumes` (each volume's used bytes,
 * named by the `volume` label) and `aggregates` (each aggregate's used and
 * total bytes, named by `aggregate`). Every endpoint also exports
 * acme_info, the heartbeat, with the array's name.
 */

export const ACME_STORAGE_SYSTEM: string = "acme.array";

// The kind only Acme has: shared code knows it from its kindDefinition alone.
export const ACME_AGGREGATE_KIND: string = "Aggregate";

export const ACME_METRIC_IDS: {
  volumeUsed: string;
  aggregateUsed: string;
  aggregateUsedPercent: string;
} = {
  volumeUsed: "acme-volume-used",
  aggregateUsed: "acme-aggregate-used",
  aggregateUsedPercent: "acme-aggregate-used-percent",
};

export const ACME_TEMPLATE_IDS: { heartbeat: string; aggregateFull: string } = {
  heartbeat: "acme-array-stopped-reporting",
  aggregateFull: "acme-aggregate-nearly-full",
};

// The platform is a value of its own; StorageSystem has no member for it.
const ACME: StorageSystem = ACME_STORAGE_SYSTEM as StorageSystem;

export const ACME_PLATFORM: StorageArrayPlatform = {
  storageSystem: ACME_STORAGE_SYSTEM,
  displayName: "Acme Array",
  shortName: "Acme",
  vendorName: "Acme",
  aliases: ["acme", "acme_array"],

  metricPrefix: "acme_",
  snapshotMetricNames: [
    "acme_info",
    "acme_volume_used_bytes",
    "acme_aggregate_used_bytes",
    "acme_aggregate_size_bytes",
  ],
  scrapeEndpoints: {
    volumes: [StorageArrayResourceKind.Volume],
    aggregates: [ACME_AGGREGATE_KIND],
  },

  kinds: [StorageArrayResourceKind.Volume, ACME_AGGREGATE_KIND],
  kindDefinitions: [
    {
      kind: ACME_AGGREGATE_KIND,
      singularLabel: "Aggregate",
      pluralLabel: "Aggregates",
      countLabel: {
        one: "{{count}} aggregate",
        other: "{{count}} aggregates",
      },
      icon: IconProp.Database,
      description:
        "The aggregates of this Acme array: the pools of disks its volumes are carved from.",
      noItemsMessage: "No aggregates in the inventory yet.",
    },
  ],
  // Acme reports no physical parts.
  hardwareKinds: [],
  metricFamilies: [
    { prefix: "acme_volume_", kind: StorageArrayResourceKind.Volume },
    { prefix: "acme_aggregate_", kind: ACME_AGGREGATE_KIND },
  ],
  componentStatuses: STORAGE_ARRAY_COMPONENT_STATUSES,
  objectLabels: { [StorageArrayResourceScope.Volume]: "volume" },

  metrics: [
    {
      id: ACME_METRIC_IDS.volumeUsed,
      friendlyName: "Volume Used",
      description: "Bytes each Acme volume holds.",
      metricName: "acme_volume_used_bytes",
      category: "Volumes",
      storageSystems: [ACME],
      defaultAggregation: MetricsAggregationType.Max,
      defaultResourceScope: StorageArrayResourceScope.Volume,
      objectLabel: "volume",
      unit: "bytes",
    },
    {
      id: ACME_METRIC_IDS.aggregateUsed,
      friendlyName: "Aggregate Used",
      description: "Bytes each Acme aggregate holds.",
      metricName: "acme_aggregate_used_bytes",
      category: "Capacity",
      storageSystems: [ACME],
      defaultAggregation: MetricsAggregationType.Max,
      defaultResourceScope: StorageArrayResourceScope.Array,
      objectLabel: "aggregate",
      unit: "bytes",
    },
    {
      id: ACME_METRIC_IDS.aggregateUsedPercent,
      friendlyName: "Aggregate Used Percent",
      description: "Share of each Acme aggregate in use, in percent.",
      metricName: "acme_aggregate_used_percent",
      category: "Capacity",
      storageSystems: [ACME],
      defaultAggregation: MetricsAggregationType.Max,
      defaultResourceScope: StorageArrayResourceScope.Array,
      objectLabel: "aggregate",
      unit: "%",
    },
  ],
  heartbeat: {
    templateId: ACME_TEMPLATE_IDS.heartbeat,
    metricName: "acme_info",
  },
  alertTemplates: [
    {
      id: ACME_TEMPLATE_IDS.aggregateFull,
      name: "Aggregate Nearly Full",
      summary: "An aggregate is more than 90% full.",
      description:
        "Fires when any aggregate of the array is more than 90% full, and recovers below 85%.",
      category: "Capacity",
      severity: "Warning",
      metricAlias: "aggregate_used_percent",
      metricName: "acme_aggregate_used_percent",
      groupByAttributeKey: "aggregate",
      aggregationType: MetricsAggregationType.Max,
      rollingTime: RollingTime.Past5Minutes,
      fire: { filterType: FilterType.GreaterThan, value: 90 },
      recover: { filterType: FilterType.LessThan, value: 85 },
      incidentTitle: "[Storage Array] Aggregate Nearly Full",
      incidentDescription:
        "An aggregate of the array is more than 90% full. Free space or add disks before its volumes stop taking writes.",
      criteriaName: "Aggregate Nearly Full",
      criteriaDescription: "An aggregate is more than 90% full.",
    },
  ],
  resourceFilters: [
    {
      key: "volumeName",
      description:
        "Filter to one Acme volume — the `volume` label of the acme_volume_* series (optional).",
    },
  ],

  overview: {
    countChips: [
      { kind: StorageArrayResourceKind.Volume, showWhenZero: true },
      { kind: ACME_AGGREGATE_KIND, showWhenZero: true },
    ],
    listCounts: [StorageArrayResourceKind.Volume, ACME_AGGREGATE_KIND],
    inventoryTile: {
      kind: ACME_AGGREGATE_KIND,
      sublabelKind: StorageArrayResourceKind.Volume,
    },
    topKind: StorageArrayResourceKind.Volume,
  },
  insightsSections: [
    {
      key: "aggregates",
      title: "Aggregates",
      description: "How full each aggregate is.",
      icon: IconProp.Database,
      metricIds: [ACME_METRIC_IDS.aggregateUsedPercent],
      groupByObject: true,
    },
  ],
  hardwareTables: [],

  agentConfigs: [
    {
      key: "acme",
      label: "Acme",
      description: "The agent reads the metrics the array serves itself.",
      collectorConfigFile: "otel-collector-config.acme.yaml",
      composeProfile: "",
      endpointVariable: "ACME_ENDPOINT",
      tokenVariable: "ACME_API_TOKEN",
      exampleEndpoint: "acme-01.example.com",
      exporterService: null,
      arrayNoun: "Acme array",
    },
  ],
};

/*
 * A copy of ACME_PLATFORM with some fields replaced, for the tests that
 * check what registration refuses.
 */
export function acmePlatformWith(
  overrides: Partial<StorageArrayPlatform>,
): StorageArrayPlatform {
  return { ...ACME_PLATFORM, ...overrides };
}

// Folds one Acme object into the batch's inventory.
function foldObject(
  series: StorageArraySeries,
  kind: string,
  name: string,
  apply: (row: StorageArrayResourceBufferEntry) => void,
): void {
  const row: StorageArrayResourceBufferEntry = series.newResource(kind, name);
  row.name = name;
  apply(row);
  series.fold(row);
}

/*
 * Acme's extractor: what its series mean. It marks the endpoint its batch
 * is the complete list of, names the array from acme_info, and turns each
 * volume and aggregate series into an inventory row.
 */
export const ACME_EXTRACTOR: StorageArrayExtractor = {
  storageSystem: ACME_STORAGE_SYSTEM,
  extract: (series: StorageArraySeries): void => {
    markScrapedEndpoint(
      series.array,
      series.label(SCRAPE_ENDPOINT_LABEL),
      ACME_PLATFORM,
    );

    if (series.metricName === "acme_info") {
      series.array.reportedName =
        series.label("array_name") || series.array.reportedName;
      series.array.osName = "AcmeOS";
      series.array.osVersion =
        series.label("version") || series.array.osVersion;
      return;
    }

    if (series.metricName === "acme_volume_used_bytes") {
      const volume: string | null = series.label("volume");
      if (volume) {
        foldObject(
          series,
          StorageArrayResourceKind.Volume,
          volume,
          (row: StorageArrayResourceBufferEntry) => {
            row.usedBytes = series.value;
            row.status = series.label("state");
          },
        );
      }
      return;
    }

    const aggregate: string | null = series.label("aggregate");
    if (!aggregate) {
      return;
    }
    if (series.metricName === "acme_aggregate_used_bytes") {
      foldObject(
        series,
        ACME_AGGREGATE_KIND,
        aggregate,
        (row: StorageArrayResourceBufferEntry) => {
          row.usedBytes = series.value;
        },
      );
    } else if (series.metricName === "acme_aggregate_size_bytes") {
      foldObject(
        series,
        ACME_AGGREGATE_KIND,
        aggregate,
        (row: StorageArrayResourceBufferEntry) => {
          row.capacityBytes = series.value;
        },
      );
    }
  },
};

// When the captured Acme batches were scraped: 2026-11-20T10:00:00Z.
export const ACME_CAPTURE_TIME_MS: number = Date.UTC(2026, 10, 20, 10, 0, 0);

/*
 * One OTLP number datapoint, as the collector's prometheus receiver hands
 * it to OneUptime: a double, the scrape time, every label an attribute.
 */
export function acmeDatapoint(data: {
  value: number;
  labels: Record<string, string>;
  timeMs?: number | undefined;
}): JSONObject {
  const attributes: JSONArray = Object.entries(data.labels).map(
    ([key, value]: [string, string]): JSONObject => {
      return { key, value: { stringValue: value } };
    },
  );
  return {
    asDouble: data.value,
    timeUnixNano: `${data.timeMs ?? ACME_CAPTURE_TIME_MS}000000`,
    attributes,
  };
}

// One series of an Acme batch.
export interface AcmeSeries {
  metricName: string;
  value: number;
  labels: Record<string, string>;
}

/*
 * A scrape of Acme's `volumes` endpoint: the heartbeat and each volume's
 * used bytes, every series labelled with its endpoint.
 */
export function acmeVolumesScrape(
  volumes: Array<{ name: string; usedBytes: number; state?: string }>,
): Array<AcmeSeries> {
  return [
    {
      metricName: "acme_info",
      value: 1,
      labels: {
        array_name: "acme-prod-01",
        version: "9.1",
        scrape_endpoint: "volumes",
      },
    },
    ...volumes.map(
      (volume: { name: string; usedBytes: number; state?: string }) => {
        return {
          metricName: "acme_volume_used_bytes",
          value: volume.usedBytes,
          labels: {
            volume: volume.name,
            state: volume.state || "online",
            scrape_endpoint: "volumes",
          },
        };
      },
    ),
  ];
}

// A scrape of Acme's `aggregates` endpoint: each aggregate's used and size.
export function acmeAggregatesScrape(
  aggregates: Array<{ name: string; usedBytes: number; sizeBytes: number }>,
): Array<AcmeSeries> {
  return [
    {
      metricName: "acme_info",
      value: 1,
      labels: {
        array_name: "acme-prod-01",
        version: "9.1",
        scrape_endpoint: "aggregates",
      },
    },
    ...aggregates.flatMap(
      (aggregate: {
        name: string;
        usedBytes: number;
        sizeBytes: number;
      }): Array<AcmeSeries> => {
        return [
          {
            metricName: "acme_aggregate_used_bytes",
            value: aggregate.usedBytes,
            labels: {
              aggregate: aggregate.name,
              scrape_endpoint: "aggregates",
            },
          },
          {
            metricName: "acme_aggregate_size_bytes",
            value: aggregate.sizeBytes,
            labels: {
              aggregate: aggregate.name,
              scrape_endpoint: "aggregates",
            },
          },
        ];
      },
    ),
  ];
}

// Adds Acme to the platforms, for one test file; unregisterAcme undoes it.
export function registerAcmePlatform(): void {
  StorageArrayPlatformRegistry.register(ACME_PLATFORM);
}

export function unregisterAcmePlatform(): void {
  StorageArrayPlatformRegistry.unregister(ACME_STORAGE_SYSTEM);
}
