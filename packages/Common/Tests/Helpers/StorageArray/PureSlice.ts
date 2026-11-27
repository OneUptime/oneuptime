import StorageSystem from "../../../Types/StorageArray/StorageSystem";
import StorageSystemUtil from "../../../Types/StorageArray/StorageSystemUtil";
import StorageArrayPlatformRegistry from "../../../Types/StorageArray/StorageArrayPlatformRegistry";
import { StorageArrayPlatform } from "../../../Types/StorageArray/StorageArrayPlatform";

/*
 * PURE STORAGE'S SLICE OF A REGISTRY-WIDE ANSWER.
 *
 * The Pure goldens (PureStorageIngestGolden, PureStorageMonitoringGolden)
 * were written on #11000's day, when Pure's two platforms were the only
 * ones. Every platform registered since (Dell PowerStore, ...) adds its own
 * systems, kinds, metrics, templates and Recommendations to the answers
 * that list every platform's. The goldens pin Pure's: they read each answer
 * with the later platforms' own entries left out, and leave out of both
 * sides an input that names one of them (on #11000's day it named no
 * platform). Everything else - every lookup of a Pure value, every list
 * Pure's entries sit in, their order - is compared whole, so a later
 * platform that changed how a Pure array is read still fails them.
 */

export const PURE_SYSTEMS: ReadonlyArray<string> = [
  StorageSystem.PureStorageFlashArray,
  StorageSystem.PureStorageFlashBlade,
];

// The platforms registered after Pure's two.
export function getLaterPlatforms(): Array<StorageArrayPlatform> {
  return StorageArrayPlatformRegistry.getPlatforms().filter(
    (platform: StorageArrayPlatform): boolean => {
      return !PURE_SYSTEMS.includes(platform.storageSystem);
    },
  );
}

function purePlatforms(): Array<StorageArrayPlatform> {
  return StorageArrayPlatformRegistry.getPlatforms().filter(
    (platform: StorageArrayPlatform): boolean => {
      return PURE_SYSTEMS.includes(platform.storageSystem);
    },
  );
}

// Whether a platform value (or an alias of one) names a later platform.
export function isLaterSystem(value: string | null | undefined): boolean {
  const normalized: string | null = StorageSystemUtil.normalize(value);
  return getLaterPlatforms().some((platform: StorageArrayPlatform): boolean => {
    return platform.storageSystem === normalized;
  });
}

// A kind only later platforms report.
export function isLaterKind(kind: string): boolean {
  const pure: Set<string> = new Set(
    purePlatforms().flatMap((platform: StorageArrayPlatform): Array<string> => {
      return [...platform.kinds];
    }),
  );
  return (
    !pure.has(kind) &&
    getLaterPlatforms().some((platform: StorageArrayPlatform): boolean => {
      return platform.kinds.includes(kind);
    })
  );
}

// A metric catalog id of a later platform.
export function isLaterMetricId(id: string): boolean {
  return getLaterPlatforms().some((platform: StorageArrayPlatform): boolean => {
    return platform.metrics.some((metric: { id: string }): boolean => {
      return metric.id === id;
    });
  });
}

// A series a later platform's catalog or ingest reads.
export function isLaterMetricName(name: string): boolean {
  return getLaterPlatforms().some((platform: StorageArrayPlatform): boolean => {
    return Boolean(
      platform.metricPrefix && name.startsWith(platform.metricPrefix),
    );
  });
}

// An alert template id (heartbeat, metric or log template) of a later platform.
export function isLaterTemplateId(id: string): boolean {
  return getLaterPlatforms().some((platform: StorageArrayPlatform): boolean => {
    return (
      platform.heartbeat.templateId === id ||
      platform.alertTemplates.some((template: { id: string }): boolean => {
        return template.id === id;
      }) ||
      (platform.logAlertTemplates || []).some(
        (template: { id: string }): boolean => {
          return template.id === id;
        },
      )
    );
  });
}

// Pure's own snapshot series: what the scan reads for Pure's two platforms.
export function getPureSnapshotMetricNames(): Array<string> {
  return Array.from(
    new Set(
      purePlatforms().flatMap(
        (platform: StorageArrayPlatform): ReadonlyArray<string> => {
          return platform.snapshotMetricNames;
        },
      ),
    ),
  ).sort();
}
