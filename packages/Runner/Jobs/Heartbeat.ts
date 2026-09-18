import os from "os";
import { HEARTBEAT_INTERVAL_MS, RUNNER_VERSION } from "../Config";
import AgentClient, { HeartbeatResult } from "../Services/RunnerClient";
import RunnerCapabilities, {
  RunnerCapabilitySet,
} from "../Utils/RunnerCapabilities";
import logger from "Common/Server/Utils/Logger";

function getHostInfo(): {
  hostname: string;
  platform: string;
  arch: string;
  release: string;
} {
  return {
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    release: os.release(),
  };
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
  const tick: () => void = (): void => {
    const before: RunnerCapabilitySet = RunnerCapabilities.resolve();

    AgentClient.heartbeat({
      agentVersion: RUNNER_VERSION,
      hostInfo: getHostInfo(),
    })
      .then((result: HeartbeatResult) => {
        if (!result.ok || !result.capabilities) {
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
