import os from "os";
import { HEARTBEAT_INTERVAL_MS, RUNBOOK_AGENT_VERSION } from "../Config";
import AgentClient from "../Services/AgentClient";
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

export default function startHeartbeat(): void {
  const tick: () => void = (): void => {
    AgentClient.heartbeat({
      agentVersion: RUNBOOK_AGENT_VERSION,
      hostInfo: getHostInfo(),
    }).catch((err: unknown) => {
      logger.warn(
        `Heartbeat failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  };

  tick();
  setInterval(tick, HEARTBEAT_INTERVAL_MS);
}
