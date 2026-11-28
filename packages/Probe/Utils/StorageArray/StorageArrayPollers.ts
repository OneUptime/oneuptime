import { StorageArrayPoller } from "./StorageArrayPoller";
import PowerMaxPoller from "./Dell/PowerMax/PowerMaxPoller";

/*
 * Every storage platform this probe can read from its management server
 * (#11004), by its storage.system: one line each. A job for a platform
 * with no poller here is answered as failed, so a probe older than a
 * platform says so instead of staying silent.
 */
const BUILT_IN_POLLERS: ReadonlyArray<StorageArrayPoller> = [PowerMaxPoller];

export default class StorageArrayPollers {
  public static getPoller(
    storageSystem: string | null | undefined,
  ): StorageArrayPoller | null {
    if (!storageSystem) {
      return null;
    }
    return (
      BUILT_IN_POLLERS.find((poller: StorageArrayPoller): boolean => {
        return poller.storageSystem === storageSystem;
      }) || null
    );
  }

  public static getStorageSystems(): Array<string> {
    return BUILT_IN_POLLERS.map((poller: StorageArrayPoller): string => {
      return poller.storageSystem;
    });
  }
}
