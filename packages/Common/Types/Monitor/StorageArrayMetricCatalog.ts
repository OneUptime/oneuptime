import { StorageArrayResourceScope } from "./MonitorStepStorageArrayMonitor";
import { translationKey } from "../Translator";
import StorageArrayPlatformRegistry from "../StorageArray/StorageArrayPlatformRegistry";
import {
  StorageArrayMetricCategory,
  StorageArrayMetricDefinition,
  StorageArrayPlatform,
} from "../StorageArray/StorageArrayPlatform";

export type { StorageArrayMetricCategory, StorageArrayMetricDefinition };

/*
 * THE STORAGE ARRAY METRIC CATALOG: every platform's metrics, in the order
 * the platforms are listed (StorageArrayPlatformRegistry), each platform's
 * own catalog in its folder (Platforms/<Vendor>/<Product>/). What a storage
 * array monitor's metric picker offers, the unit each metric is read in,
 * the label that names each kind of object, and the charts' labels.
 *
 * Built once per change of the registry, so the whole catalog is one array
 * between changes, as it was when it was written out here.
 */
let catalogCache: {
  version: number;
  metrics: Array<StorageArrayMetricDefinition>;
} | null = null;

function getCatalog(): Array<StorageArrayMetricDefinition> {
  const version: number = StorageArrayPlatformRegistry.getVersion();
  if (!catalogCache || catalogCache.version !== version) {
    catalogCache = {
      version,
      metrics: StorageArrayPlatformRegistry.getPlatforms().flatMap(
        (
          platform: StorageArrayPlatform,
        ): Array<StorageArrayMetricDefinition> => {
          return [...platform.metrics];
        },
      ),
    };
  }
  return catalogCache.metrics;
}

export function getAllStorageArrayMetrics(): Array<StorageArrayMetricDefinition> {
  return getCatalog();
}

/*
 * The metrics a platform exports. An unknown or empty system (an array not
 * yet reporting, or a platform OneUptime has no catalog for) gets every
 * metric, so the picker is never empty.
 */
export function getStorageArrayMetricsForSystem(
  system: string | null | undefined,
): Array<StorageArrayMetricDefinition> {
  const forSystem: Array<StorageArrayMetricDefinition> = getCatalog().filter(
    (m: StorageArrayMetricDefinition) => {
      return (m.storageSystems as Array<string>).includes(system as string);
    },
  );
  return forSystem.length > 0 ? forSystem : getCatalog();
}

export function getStorageArrayMetricsByCategory(
  category: StorageArrayMetricCategory,
): Array<StorageArrayMetricDefinition> {
  return getCatalog().filter((m: StorageArrayMetricDefinition) => {
    return m.category === category;
  });
}

export function getStorageArrayMetricById(
  id: string,
): StorageArrayMetricDefinition | undefined {
  return getCatalog().find((m: StorageArrayMetricDefinition) => {
    return m.id === id;
  });
}

/*
 * The FIRST catalog entry for a metric name. Several entries share a name
 * (read and write latency differ only by their dimension filter), so a
 * caller that knows the filters should prefer getStorageArrayMetric.
 */
export function getStorageArrayMetricByMetricName(
  metricName: string,
): StorageArrayMetricDefinition | undefined {
  return getCatalog().find((m: StorageArrayMetricDefinition) => {
    return m.metricName === metricName;
  });
}

/*
 * The catalog entry that matches a metric name AND the query's attribute
 * filters — the most specific one wins (every attribute the entry pins must
 * match). Falls back to the first entry for the name.
 */
export function getStorageArrayMetric(
  metricName: string,
  attributes?: Record<string, unknown> | undefined,
): StorageArrayMetricDefinition | undefined {
  const candidates: Array<StorageArrayMetricDefinition> = getCatalog().filter(
    (m: StorageArrayMetricDefinition) => {
      return m.metricName === metricName;
    },
  );

  let best: StorageArrayMetricDefinition | undefined = undefined;
  let bestSpecificity: number = -1;
  for (const candidate of candidates) {
    const pinned: Record<string, string> = candidate.attributes || {};
    const keys: Array<string> = Object.keys(pinned);
    const matches: boolean = keys.every((key: string) => {
      return (
        attributes !== undefined && String(attributes[key]) === pinned[key]
      );
    });
    if (matches && keys.length > bestSpecificity) {
      best = candidate;
      bestSpecificity = keys.length;
    }
  }

  return best || candidates[0];
}

export function getAllStorageArrayMetricCategories(): Array<StorageArrayMetricCategory> {
  return [
    "Array Health",
    "Capacity",
    "Performance",
    "Volumes",
    "Hosts",
    "Replication",
    "Hardware",
    "File Systems",
    "Buckets",
  ];
}

/*
 * Each group's heading in the metric picker, a key: a category is the value
 * the catalog's metrics name, so the picker looks its heading up here, once
 * (#8653).
 */
const categoryLabels: Record<StorageArrayMetricCategory, string> = {
  "Array Health": translationKey("Array Health"),
  Capacity: translationKey("Capacity"),
  Performance: translationKey("Performance"),
  Volumes: translationKey("Volumes"),
  Hosts: translationKey("Hosts"),
  Replication: translationKey("Replication"),
  Hardware: translationKey("Hardware"),
  "File Systems": translationKey("File Systems"),
  Buckets: translationKey("Buckets"),
};

export function getStorageArrayMetricCategoryLabel(
  category: StorageArrayMetricCategory,
): string {
  return categoryLabels[category] || category;
}

/*
 * The datapoint label that names one object of a resource scope on a
 * platform (its StorageArrayPlatform.objectLabels) - the label a resource
 * filter equality-filters and a per-object template groups by. Pass the
 * query's metric name when there is one: a few series name their object
 * with a different label than the rest of their scope (a replica link
 * series carries its pod as `local_pod`), and a filter on the scope's
 * usual label would match none of them. An array whose platform is not
 * known reads as the default platform.
 */
export function getStorageArrayObjectLabel(
  scope: StorageArrayResourceScope,
  system: string | null | undefined,
  metricName?: string | undefined,
): string | null {
  const platform: StorageArrayPlatform =
    StorageArrayPlatformRegistry.getPlatformOrDefault(system);

  /*
   * Only for the metric's own scope: a filter for another kind of object on
   * this query (a volume filter on a replica-link series) keeps its usual
   * label rather than being rewritten onto this metric's. The platform's
   * own catalog is asked first: two platforms may name a metric alike.
   */
  const metric: StorageArrayMetricDefinition | undefined = metricName
    ? platform.metrics.find((m: StorageArrayMetricDefinition): boolean => {
        return m.metricName === metricName;
      }) || getStorageArrayMetricByMetricName(metricName)
    : undefined;
  if (metric?.objectLabel && metric.defaultResourceScope === scope) {
    return metric.objectLabel;
  }

  if (scope === StorageArrayResourceScope.Array) {
    return null;
  }

  return platform.objectLabels[scope] || null;
}
