import os from "os";
import {
  HEARTBEAT_INTERVAL_MS,
  IS_KUBERNETES_AGENT_MODE,
  RUNNER_VERSION,
} from "../Config";
import AgentClient, { HeartbeatResult } from "../Services/RunnerClient";
import Register from "../Services/RegisterRunner";
import RunnerCapabilities, {
  RunnerCapabilitySet,
} from "../Utils/RunnerCapabilities";
import KubernetesPosture from "../Utils/KubernetesPosture";
import { JSONObject } from "Common/Types/JSON";
import logger from "Common/Server/Utils/Logger";

/*
 * Consecutive rejected heartbeats before a kubernetes-agent Runner
 * re-registers. Its key is server-issued and rotated at registration, so a
 * rejection most likely means the row was re-created or rotated behind it;
 * re-registering with the ingestion key repairs that without a restart.
 */
const REREGISTER_AFTER_REJECTED_HEARTBEATS: number = 3;

async function getHostInfo(): Promise<JSONObject> {
  const info: JSONObject = {
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    release: os.release(),
  };

  /*
   * The Kubernetes posture rides on every heartbeat so the cluster's AI page
   * reflects the container that is running now (in-cluster or not, writes
   * allowed or not, which kubectl), not the one that registered last week.
   */
  if (IS_KUBERNETES_AGENT_MODE || KubernetesPosture.isInCluster()) {
    info["kubernetes"] =
      (await KubernetesPosture.build()) as unknown as JSONObject;
  }

  return info;
}

function describe(capabilities: RunnerCapabilitySet): string {
  return `runbooks=${capabilities.canRunRunbooks ? "on" : "off"} codeFixes=${
    capabilities.canRunCodeFixTasks ? "on" : "off"
  } aiCommands=${capabilities.canRunAiCommands ? "on" : "off"}`;
}

/*
 * The heartbeat is also the capability channel. The dashboard is the control
 * plane for what a Runner may do, so each tick adopts what the project
 * currently grants — an operator toggling a capability takes effect within one
 * heartbeat instead of waiting for someone to restart the container.
 *
 * The work loops read the resolved capability on every tick rather than being
 * started and stopped, so adopting a change is just this assignment.
 */
export default function startHeartbeat(): void {
  let rejectedInARow: number = 0;

  const tick: () => void = (): void => {
    const before: RunnerCapabilitySet = RunnerCapabilities.resolve();

    getHostInfo()
      .then((hostInfo: JSONObject) => {
        return AgentClient.heartbeat({
          agentVersion: RUNNER_VERSION,
          hostInfo,
        });
      })
      .then(async (result: HeartbeatResult) => {
        if (!result.ok) {
          rejectedInARow++;
          if (
            IS_KUBERNETES_AGENT_MODE &&
            rejectedInARow >= REREGISTER_AFTER_REJECTED_HEARTBEATS
          ) {
            rejectedInARow = 0;
            logger.warn(
              "Heartbeats are being rejected — re-registering the Kubernetes agent Runner with the ingestion key.",
            );
            await Register.registerRunner();
          }
          return;
        }

        rejectedInARow = 0;

        if (!result.capabilities) {
          return;
        }

        RunnerCapabilities.setGrantedByServer(result.capabilities);

        const after: RunnerCapabilitySet = RunnerCapabilities.resolve();

        if (
          after.canRunRunbooks !== before.canRunRunbooks ||
          after.canRunCodeFixTasks !== before.canRunCodeFixTasks ||
          after.canRunAiCommands !== before.canRunAiCommands
        ) {
          logger.info(
            `Capabilities changed by the dashboard: ${describe(before)} -> ${describe(after)}.`,
          );
        }
      })
      .catch((err: unknown) => {
        logger.warn(
          `Heartbeat failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
  };

  tick();
  setInterval(tick, HEARTBEAT_INTERVAL_MS);
}
