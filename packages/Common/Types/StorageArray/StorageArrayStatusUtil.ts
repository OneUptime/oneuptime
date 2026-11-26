import {
  STORAGE_ARRAY_COMPONENT_STATUSES,
  StorageArrayComponentStatuses,
  StorageArrayPlatform,
} from "./StorageArrayPlatform";
import StorageArrayPlatformRegistry from "./StorageArrayPlatformRegistry";

/*
 * WHAT A PART'S STATUS WORD MEANS, ON ANY PLATFORM (#11001).
 *
 * Each platform names the words its parts report and what they mean
 * (StorageArrayPlatform.componentStatuses: a NetApp aggregate is offline,
 * a disk broken, a port down). The pages draw a part's word without asking
 * which platform wrote it - a status badge, a list's state, Needs
 * attention - so they read every platform's words at once: a word is
 * critical when any platform calls it critical, a warning when any calls
 * it one and none critical, healthy when a platform calls it all is well.
 * No two platforms so far disagree about a word; the ingest, which knows
 * the platform, reads its own lists (StorageArraySnapshotScan).
 */

const SHARED_HEALTHY: ReadonlyArray<string> = [
  "ok",
  "healthy",
  "ready",
  "enabled",
  "online",
  "replicating",
];

interface StatusLists {
  critical: ReadonlyArray<string>;
  warning: ReadonlyArray<string>;
  healthy: ReadonlyArray<string>;
}

let lists: StatusLists | null = null;
let listsVersion: number = -1;

function getLists(): StatusLists {
  const version: number = StorageArrayPlatformRegistry.getVersion();
  if (lists && listsVersion === version) {
    return lists;
  }
  const critical: Set<string> = new Set<string>(
    STORAGE_ARRAY_COMPONENT_STATUSES.critical,
  );
  const warning: Set<string> = new Set<string>(
    STORAGE_ARRAY_COMPONENT_STATUSES.warning,
  );
  const healthy: Set<string> = new Set<string>(SHARED_HEALTHY);
  for (const platform of StorageArrayPlatformRegistry.getPlatforms()) {
    const statuses: StorageArrayComponentStatuses = (
      platform as StorageArrayPlatform
    ).componentStatuses;
    for (const word of statuses.critical) {
      critical.add(word);
    }
    for (const word of statuses.warning) {
      warning.add(word);
    }
    for (const word of statuses.healthy || []) {
      healthy.add(word);
    }
  }
  lists = {
    critical: Array.from(critical),
    warning: Array.from(warning).filter((word: string): boolean => {
      return !critical.has(word);
    }),
    healthy: Array.from(healthy).filter((word: string): boolean => {
      return !critical.has(word) && !warning.has(word);
    }),
  };
  listsVersion = version;
  return lists;
}

export default class StorageArrayStatusUtil {
  public static getCriticalStatuses(): ReadonlyArray<string> {
    return getLists().critical;
  }

  public static getWarningStatuses(): ReadonlyArray<string> {
    return getLists().warning;
  }

  public static getHealthyStatuses(): ReadonlyArray<string> {
    return getLists().healthy;
  }

  private static normalize(status: string | null | undefined): string {
    return (status || "").trim().toLowerCase();
  }

  public static isCritical(status: string | null | undefined): boolean {
    return getLists().critical.includes(
      StorageArrayStatusUtil.normalize(status),
    );
  }

  public static isWarning(status: string | null | undefined): boolean {
    return getLists().warning.includes(
      StorageArrayStatusUtil.normalize(status),
    );
  }

  public static isHealthy(status: string | null | undefined): boolean {
    return getLists().healthy.includes(
      StorageArrayStatusUtil.normalize(status),
    );
  }
}
