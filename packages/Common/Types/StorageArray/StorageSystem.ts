/*
 * The storage platforms the Storage Arrays product understands.
 *
 * The value is what the OneUptime Storage Array Agent stamps in the
 * `storage.system` resource attribute and what StorageArray.storageSystem
 * stores. It follows the OpenTelemetry `db.system.name` style: the vendor,
 * a dot, then the product (`aws.dynamodb`, `microsoft.sql_server`).
 *
 * Pure Storage renamed itself Everpure in February 2026. FlashArray and
 * FlashBlade kept their names, as did the metric namespaces (`purefa_`,
 * `purefb_`), so the values keep the name every operator knows; the
 * `everpure.*` spellings are accepted as aliases.
 */
enum StorageSystem {
  PureStorageFlashArray = "purestorage.flasharray",
  PureStorageFlashBlade = "purestorage.flashblade",
}

interface StorageSystemInfo {
  displayName: string;
  shortName: string;
  vendorName: string;
  // Every metric the platform exports starts with this prefix.
  metricPrefix: string;
  aliases: Array<string>;
}

const STORAGE_SYSTEM_INFO: Record<StorageSystem, StorageSystemInfo> = {
  [StorageSystem.PureStorageFlashArray]: {
    displayName: "Pure Storage FlashArray",
    shortName: "FlashArray",
    vendorName: "Pure Storage",
    metricPrefix: "purefa_",
    aliases: [
      "purestorage.flasharray",
      "purestorage_flasharray",
      "purestorage-flasharray",
      "pure.flasharray",
      "pure_flasharray",
      "pure-flasharray",
      "everpure.flasharray",
      "everpure_flasharray",
      "purefa",
      "flasharray",
    ],
  },
  [StorageSystem.PureStorageFlashBlade]: {
    displayName: "Pure Storage FlashBlade",
    shortName: "FlashBlade",
    vendorName: "Pure Storage",
    metricPrefix: "purefb_",
    aliases: [
      "purestorage.flashblade",
      "purestorage_flashblade",
      "purestorage-flashblade",
      "pure.flashblade",
      "pure_flashblade",
      "pure-flashblade",
      "everpure.flashblade",
      "everpure_flashblade",
      "purefb",
      "flashblade",
    ],
  },
};

/*
 * A system OneUptime does not know still works: a well-formed value is kept
 * as it came (lowercased), so an array of another platform is still
 * discovered and shown under that name. Only the platform-specific pages,
 * metrics and alert templates need a system from the enum.
 */
const WELL_FORMED_SYSTEM: RegExp = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export class StorageSystemUtil {
  public static getAllSystems(): Array<StorageSystem> {
    return Object.values(StorageSystem);
  }

  public static isKnownSystem(
    value: string | null | undefined,
  ): value is StorageSystem {
    if (!value) {
      return false;
    }
    return (Object.values(StorageSystem) as Array<string>).includes(value);
  }

  /*
   * Normalize what an agent stamped in `storage.system` to a StorageSystem
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
    for (const system of StorageSystemUtil.getAllSystems()) {
      if (STORAGE_SYSTEM_INFO[system].aliases.includes(value)) {
        return system;
      }
    }
    return WELL_FORMED_SYSTEM.test(value) ? value : null;
  }

  // The platform a metric belongs to, from its name; null when unknown.
  public static fromMetricName(
    metricName: string | null | undefined,
  ): StorageSystem | null {
    if (!metricName) {
      return null;
    }
    for (const system of StorageSystemUtil.getAllSystems()) {
      if (metricName.startsWith(STORAGE_SYSTEM_INFO[system].metricPrefix)) {
        return system;
      }
    }
    return null;
  }

  public static getMetricPrefix(system: StorageSystem): string {
    return STORAGE_SYSTEM_INFO[system].metricPrefix;
  }

  public static getDisplayName(system: string | null | undefined): string {
    if (!system) {
      return "Unknown";
    }
    if (StorageSystemUtil.isKnownSystem(system)) {
      return STORAGE_SYSTEM_INFO[system].displayName;
    }
    return system;
  }

  public static getShortName(system: string | null | undefined): string {
    if (!system) {
      return "Unknown";
    }
    if (StorageSystemUtil.isKnownSystem(system)) {
      return STORAGE_SYSTEM_INFO[system].shortName;
    }
    return system;
  }

  public static getVendorName(system: string | null | undefined): string {
    if (StorageSystemUtil.isKnownSystem(system)) {
      return STORAGE_SYSTEM_INFO[system].vendorName;
    }
    return "Unknown";
  }

  public static isFlashArray(system: string | null | undefined): boolean {
    return system === StorageSystem.PureStorageFlashArray;
  }

  public static isFlashBlade(system: string | null | undefined): boolean {
    return system === StorageSystem.PureStorageFlashBlade;
  }
}

export default StorageSystem;
