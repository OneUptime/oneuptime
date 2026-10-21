import InProcessMemo from "../InProcessMemo";
import { HostCollectorOsType } from "../../../Types/HostCollector/HostCollector";

/*
 * A project's Collector Configs as a managed host's poll reads them
 * (HostCollectorAgent), kept by each process for half a minute: a project's
 * hosts poll every 30 seconds each, and its configs change when a person
 * saves one. The process that saves a config forgets them at once
 * (HostCollectorConfigService); the others pick the change up within the
 * half minute - so a saved config reaches its hosts within about a minute.
 */

export interface HostCollectorProjectConfig {
  id: string;
  osType: HostCollectorOsType;
  labelIds: Array<string>;
  order: number;
  configYaml: string;
  configHash: string;
}

const PROJECT_CONFIGS_MEMO_TTL_MS: number = 30 * 1000;
const PROJECT_CONFIGS_MEMO_MAX_ENTRIES: number = 5000;

const memo: InProcessMemo<Array<HostCollectorProjectConfig>> =
  new InProcessMemo<Array<HostCollectorProjectConfig>>({
    ttlInMs: PROJECT_CONFIGS_MEMO_TTL_MS,
    maxEntries: PROJECT_CONFIGS_MEMO_MAX_ENTRIES,
  });

export default class HostCollectorProjectConfigsMemo {
  public static get(
    projectId: string,
  ): Array<HostCollectorProjectConfig> | undefined {
    return memo.get(projectId);
  }

  public static set(
    projectId: string,
    configs: Array<HostCollectorProjectConfig>,
  ): void {
    memo.set(projectId, configs);
  }

  public static forget(projectId: string): void {
    memo.delete(projectId);
  }

  public static clear(): void {
    memo.clear();
  }
}
