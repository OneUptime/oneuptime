import StorageSystem from "./StorageSystem";
import { StorageArrayPlatform } from "./StorageArrayPlatform";
import StorageArrayPlatformRegistry from "./StorageArrayPlatformRegistry";

/*
 * What a `storage.system` value means: which platform it names, how that
 * platform is called and which metrics are its. Every answer comes from
 * StorageArrayPlatformRegistry, so a platform listed there - or registered
 * by a test - is known here without a change to this file.
 *
 * A system OneUptime does not know still works: a well-formed value is kept
 * as it came (lowercased), so an array of another platform is still
 * discovered and shown under that name. Only the platform-specific pages,
 * metrics and alert templates need a platform from the registry.
 */
const WELL_FORMED_SYSTEM: RegExp = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export class StorageSystemUtil {
  // Every platform's value, the shipped ones first.
  public static getAllSystems(): Array<StorageSystem> {
    return StorageArrayPlatformRegistry.getPlatforms().map(
      (platform: StorageArrayPlatform): StorageSystem => {
        return platform.storageSystem as StorageSystem;
      },
    );
  }

  public static isKnownSystem(
    value: string | null | undefined,
  ): value is StorageSystem {
    return StorageArrayPlatformRegistry.getPlatform(value) !== null;
  }

  /*
   * Normalize what an agent stamped in `storage.system` to a platform's
   * value, without regard to case or surrounding whitespace. Unknown but
   * well-formed values are returned lowercased; anything else is null.
   */
  public static normalize(raw: string | null | undefined): string | null {
    if (raw === null || raw === undefined) {
      return null;
    }
    const value: string = raw.trim().toLowerCase();
    if (!value) {
      return null;
    }
    for (const platform of StorageArrayPlatformRegistry.getPlatforms()) {
      if (
        platform.storageSystem === value ||
        platform.aliases.includes(value)
      ) {
        return platform.storageSystem;
      }
    }
    return WELL_FORMED_SYSTEM.test(value) ? value : null;
  }

  /*
   * The platform a metric belongs to, from its name's prefix; null when no
   * platform's prefix matches (or the platform's exporter has none).
   */
  public static fromMetricName(
    metricName: string | null | undefined,
  ): StorageSystem | null {
    const platform: StorageArrayPlatform | null =
      StorageArrayPlatformRegistry.getPlatformByMetricName(metricName);
    return platform ? (platform.storageSystem as StorageSystem) : null;
  }

  public static getMetricPrefix(system: StorageSystem): string {
    return StorageArrayPlatformRegistry.getPlatform(system)?.metricPrefix || "";
  }

  public static getDisplayName(system: string | null | undefined): string {
    if (!system) {
      return "Unknown";
    }
    return (
      StorageArrayPlatformRegistry.getPlatform(system)?.displayName || system
    );
  }

  public static getShortName(system: string | null | undefined): string {
    if (!system) {
      return "Unknown";
    }
    return (
      StorageArrayPlatformRegistry.getPlatform(system)?.shortName || system
    );
  }

  public static getVendorName(system: string | null | undefined): string {
    return (
      StorageArrayPlatformRegistry.getPlatform(system)?.vendorName || "Unknown"
    );
  }

  /*
   * Whether a value names one of Pure's two platforms. Kept for the code
   * that asks; Storage Arrays' own pages, ingest and monitors read the
   * platform from the registry instead, and must not branch on a vendor.
   */
  public static isFlashArray(system: string | null | undefined): boolean {
    return system === StorageSystem.PureStorageFlashArray;
  }

  public static isFlashBlade(system: string | null | undefined): boolean {
    return system === StorageSystem.PureStorageFlashBlade;
  }
}

export default StorageSystemUtil;
