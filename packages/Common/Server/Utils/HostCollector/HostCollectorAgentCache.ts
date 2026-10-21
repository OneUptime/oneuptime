import GlobalCache from "../../Infrastructure/GlobalCache";
import { JSONObject } from "../../../Types/JSON";
import logger from "../Logger";

/*
 * What a managed host's supervisor needs OneUptime to remember between its
 * polls (every 30 seconds per host), kept in the shared cache so a poll that
 * changes nothing reads no row and writes none:
 *
 *   - which host an instance belongs to (an instance sends only its id when
 *     nothing about it changed);
 *   - the host's state as last written, to tell what a poll changes.
 *
 * A short life, and dropped when someone changes what decides the host's
 * config (its labels, a picked config, Try again): HostService drops it.
 * Nothing here is the truth - a miss reads the host - and a cache that is
 * down only costs that read.
 */

const INSTANCE_NAMESPACE: string = "host-collector-instance";
const STATE_NAMESPACE: string = "host-collector-state";

// The host an instance belongs to rarely changes.
const INSTANCE_TTL_SECONDS: number = 60 * 60;
// The state: a change made outside the poll shows within a minute.
export const HOST_COLLECTOR_STATE_TTL_SECONDS: number = 60;

function getInstanceKey(projectId: string, instanceUid: string): string {
  return `${projectId}:${instanceUid}`;
}

export default class HostCollectorAgentCache {
  public static async getHostIdForInstance(data: {
    projectId: string;
    instanceUid: string;
  }): Promise<string | null> {
    try {
      return await GlobalCache.getString(
        INSTANCE_NAMESPACE,
        getInstanceKey(data.projectId, data.instanceUid),
      );
    } catch (err) {
      logger.debug(err);
      return null;
    }
  }

  public static async setHostIdForInstance(data: {
    projectId: string;
    instanceUid: string;
    hostId: string;
  }): Promise<void> {
    try {
      await GlobalCache.setString(
        INSTANCE_NAMESPACE,
        getInstanceKey(data.projectId, data.instanceUid),
        data.hostId,
        { expiresInSeconds: INSTANCE_TTL_SECONDS },
      );
    } catch (err) {
      logger.debug(err);
    }
  }

  public static async getState(hostId: string): Promise<JSONObject | null> {
    try {
      return await GlobalCache.getJSONObject(STATE_NAMESPACE, hostId);
    } catch (err) {
      logger.debug(err);
      return null;
    }
  }

  public static async setState(
    hostId: string,
    state: JSONObject,
  ): Promise<void> {
    try {
      await GlobalCache.setJSON(STATE_NAMESPACE, hostId, state, {
        expiresInSeconds: HOST_COLLECTOR_STATE_TTL_SECONDS,
      });
    } catch (err) {
      logger.debug(err);
    }
  }

  // Forget a host's state: its next poll reads the host again.
  public static async dropState(hostId: string): Promise<void> {
    try {
      await GlobalCache.deleteKey(STATE_NAMESPACE, hostId);
    } catch (err) {
      logger.debug(err);
    }
  }
}
