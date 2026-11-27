import { StorageArrayProbeCollector } from "./StorageArrayProbeCollector";
import POWERMAX_PROBE_COLLECTOR from "../Platforms/Dell/PowerMax/PowerMaxProbeCollector";

/*
 * EVERY STORAGE PLATFORM A PROBE COLLECTS (#11004), one line each. A
 * platform here is read from its management server by a probe
 * (StorageArrayProbeCollection) instead of by the Storage Array Agent, so
 * it has no agent configs; one connection adds every array behind it.
 *
 * Only a value equal to a collector's storageSystem matches, and nothing
 * indexes an object by it: the value comes from a stored row.
 */
const BUILT_IN_PROBE_COLLECTORS: ReadonlyArray<StorageArrayProbeCollector> = [
  POWERMAX_PROBE_COLLECTOR,
];

export default class StorageArrayProbeCollectors {
  public static getAll(): ReadonlyArray<StorageArrayProbeCollector> {
    return BUILT_IN_PROBE_COLLECTORS;
  }

  public static getCollector(
    storageSystem: string | null | undefined,
  ): StorageArrayProbeCollector | null {
    if (!storageSystem) {
      return null;
    }
    return (
      BUILT_IN_PROBE_COLLECTORS.find(
        (collector: StorageArrayProbeCollector): boolean => {
          return collector.storageSystem === storageSystem;
        },
      ) || null
    );
  }

  public static isProbeCollected(
    storageSystem: string | null | undefined,
  ): boolean {
    return StorageArrayProbeCollectors.getCollector(storageSystem) !== null;
  }

  // The platforms a connection may be made for, in the order listed.
  public static getStorageSystems(): Array<string> {
    return BUILT_IN_PROBE_COLLECTORS.map(
      (collector: StorageArrayProbeCollector): string => {
        return collector.storageSystem;
      },
    );
  }

  // The collector a new connection is for when it names none.
  public static getDefault(): StorageArrayProbeCollector {
    return BUILT_IN_PROBE_COLLECTORS[0]!;
  }
}
