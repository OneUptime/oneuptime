import { StorageArrayPlatform } from "../../../../Types/StorageArray/StorageArrayPlatform";
import StorageArrayPlatformRegistry from "../../../../Types/StorageArray/StorageArrayPlatformRegistry";
import StorageSystemUtil from "../../../../Types/StorageArray/StorageSystemUtil";
import { StorageArrayExtractor } from "./StorageArrayExtractor";
import FlashArrayExtractor from "./PureStorage/FlashArrayExtractor";
import FlashBladeExtractor from "./PureStorage/FlashBladeExtractor";
import PowerScaleExtractor from "./Dell/PowerScaleExtractor";

/*
 * EVERY PLATFORM'S EXTRACTOR, AND WHICH ONE READS A DATAPOINT (#11000).
 *
 * A new platform is its extractor (StorageArray/<Vendor>/) and one line in
 * BUILT_IN_EXTRACTORS, beside its StorageArrayPlatform. `register` adds one
 * at runtime, for a test that defines a platform of its own.
 *
 * Which extractor reads a datapoint (resolve):
 *
 *   1. The platform the agent declared (`storage.system`), when that
 *      platform reads the metric (its snapshotMetricNames). This is how a
 *      platform whose exporter's names carry no vendor prefix (NetApp
 *      Harvest's volume_*, aggr_*) is read at all.
 *   2. Otherwise the platform whose metric prefix the name starts with
 *      (StorageArrayPlatform.metricPrefix), so an agent that stamps no
 *      `storage.system` - every agent installed before it did - keeps
 *      working, and a declaration that is wrong cannot stop a platform's
 *      series from being read: an agent whose .env names no platform
 *      declares the compose default, the default platform's, and the
 *      series of its own platform are still read as that platform's.
 *
 * The ingest only hands the scan metrics some platform reads
 * (isStorageArraySnapshotMetric); a metric past that gate whose prefix is a
 * platform's still reaches that platform's extractor, which ignores what it
 * does not map.
 */

const BUILT_IN_EXTRACTORS: ReadonlyArray<StorageArrayExtractor> = [
  FlashArrayExtractor,
  FlashBladeExtractor,
  PowerScaleExtractor,
];

export interface ResolvedStorageArrayExtractor {
  platform: StorageArrayPlatform;
  extractor: StorageArrayExtractor;
}

// Each platform's metric names as a Set, built once per platform.
const metricNamesByPlatform: WeakMap<
  StorageArrayPlatform,
  ReadonlySet<string>
> = new WeakMap();

function readsMetric(
  platform: StorageArrayPlatform,
  metricName: string,
): boolean {
  let names: ReadonlySet<string> | undefined =
    metricNamesByPlatform.get(platform);
  if (!names) {
    names = new Set(platform.snapshotMetricNames);
    metricNamesByPlatform.set(platform, names);
  }
  return names.has(metricName);
}

export default class StorageArrayExtractors {
  private static extractors: Array<StorageArrayExtractor> = [
    ...BUILT_IN_EXTRACTORS,
  ];

  public static getExtractors(): ReadonlyArray<StorageArrayExtractor> {
    return StorageArrayExtractors.extractors;
  }

  public static getExtractor(
    storageSystem: string | null | undefined,
  ): StorageArrayExtractor | null {
    if (!storageSystem) {
      return null;
    }
    return (
      StorageArrayExtractors.extractors.find(
        (extractor: StorageArrayExtractor): boolean => {
          return extractor.storageSystem === storageSystem;
        },
      ) || null
    );
  }

  public static register(extractor: StorageArrayExtractor): void {
    if (StorageArrayExtractors.getExtractor(extractor.storageSystem)) {
      throw new Error(
        `A storage array extractor for ${extractor.storageSystem} is already registered`,
      );
    }
    StorageArrayExtractors.extractors = [
      ...StorageArrayExtractors.extractors,
      extractor,
    ];
  }

  public static unregister(storageSystem: string): void {
    StorageArrayExtractors.extractors =
      StorageArrayExtractors.extractors.filter(
        (extractor: StorageArrayExtractor): boolean => {
          return extractor.storageSystem !== storageSystem;
        },
      );
  }

  // Whether any registered platform reads a metric: the ingest's gate.
  public static isSnapshotMetric(metricName: string): boolean {
    return StorageArrayPlatformRegistry.getPlatforms().some(
      (platform: StorageArrayPlatform): boolean => {
        return readsMetric(platform, metricName);
      },
    );
  }

  public static resolve(data: {
    metricName: string;
    declaredStorageSystem?: string | null | undefined;
  }): ResolvedStorageArrayExtractor | null {
    const declared: StorageArrayPlatform | null =
      StorageArrayPlatformRegistry.getPlatform(
        StorageSystemUtil.normalize(data.declaredStorageSystem),
      );
    if (declared && readsMetric(declared, data.metricName)) {
      const extractor: StorageArrayExtractor | null =
        StorageArrayExtractors.getExtractor(declared.storageSystem);
      if (extractor) {
        return { platform: declared, extractor };
      }
    }

    const byPrefix: StorageArrayPlatform | null =
      StorageArrayPlatformRegistry.getPlatformByMetricName(data.metricName);
    if (byPrefix) {
      const extractor: StorageArrayExtractor | null =
        StorageArrayExtractors.getExtractor(byPrefix.storageSystem);
      if (extractor) {
        return { platform: byPrefix, extractor };
      }
    }

    return null;
  }
}
