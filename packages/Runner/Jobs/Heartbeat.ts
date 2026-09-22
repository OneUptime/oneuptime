import os from "os";
import { HEARTBEAT_INTERVAL_MS, RUNNER_VERSION } from "../Config";
import AgentClient, { HeartbeatResult } from "../Services/RunnerClient";
import Register from "../Services/RegisterRunner";
import RunnerCapabilities, {
  RunnerCapabilitySet,
} from "../Utils/RunnerCapabilities";
import KubernetesPosture from "../Utils/KubernetesPosture";
import KubernetesAgentMode from "../Utils/KubernetesAgentMode";
import { JSONObject } from "Common/Types/JSON";
import logger from "Common/Server/Utils/Logger";

/*
 * Consecutive credential rejections before a kubernetes-agent Runner
 * re-registers. Its key is server-issued and rotated at registration, so a
 * rejection most likely means the row was re-created or rotated behind it;
 * re-registering with the ingestion key repairs that without a restart.
 */
export const REREGISTER_AFTER_REJECTED_HEARTBEATS: number = 3;

/*
 * How many registration attempts one re-registration round may make before
 * giving up. RegisterRunner backs off 30s, 60s, 120s and 240s between the
 * five attempts, so a whole round takes about seven and a half minutes. A
 * round that fails leaves the Runner on its current identity; the next
 * round starts only after another run of rejections, so a revoked ingestion
 * key costs a bounded trickle of attempts, never a flood.
 */
export const REREGISTER_MAX_ATTEMPTS: number = 5;

/*
 * The statuses the Runner work mount answers a bad or unknown identity
 * with (the ingest middleware says 400 for an invalid id/key; 401/403 for
 * any auth layer in front of it). Only these count toward re-registration:
 * a 5xx during a server deploy is not the key's fault, and rotating the
 * key in the middle of an outage would only add churn to it.
 */
const CREDENTIAL_REJECTION_STATUS_CODES: Array<number> = [400, 401, 403];

export async function getHostInfo(): Promise<JSONObject> {
  const info: JSONObject = {
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    release: os.release(),
  };

  /*
   * The Kubernetes posture rides on every heartbeat of the kubernetes-agent
   * Runner — and ONLY that Runner — so the cluster's AI page reflects the
   * container that is running now (writes allowed or not, which kubectl),
   * not the one that registered last week. An ordinary Runner that merely
   * runs in a pod reports no posture at all: being in a pod says nothing
   * about which cluster, and a posture would make the server treat it as
   * that cluster's in-cluster agent and hand it credential-less commands.
   */
  if (KubernetesAgentMode.isActive()) {
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

function isCredentialRejection(statusCode: number | undefined): boolean {
  return (
    statusCode !== undefined &&
    CREDENTIAL_REJECTION_STATUS_CODES.includes(statusCode)
  );
}

/*
 * The heartbeat is also the capability channel. The dashboard is the control
 * plane for what a Runner may do, so each tick adopts what the project
 * currently grants — an operator toggling a capability takes effect within one
 * heartbeat instead of waiting for someone to restart the container.
 *
 * The work loops read the resolved capability on every tick rather than being
 * started and stopped, so adopting a change is just this assignment.
 *
 * Concurrency, because the key can be rotated from here: at most ONE
 * heartbeat is in flight at a time (a tick that finds one pending does
 * nothing), no heartbeat is sent while a re-registration is in progress, and
 * at most ONE re-registration runs at a time, with a bounded number of
 * attempts. Together those mean two heartbeats can never race each other
 * into rotating the key twice, a rejection can never be counted against a
 * key that has already been replaced, and a server that keeps rejecting the
 * Runner produces a bounded trickle of registration attempts rather than an
 * ever-growing set of retry-forever loops.
 */
export class HeartbeatLoop {
  private rejectedInARow: number = 0;
  private heartbeatInFlight: boolean = false;
  private reregistration: Promise<void> | null = null;

  public isReregistering(): boolean {
    return this.reregistration !== null;
  }

  public isHeartbeatInFlight(): boolean {
    return this.heartbeatInFlight;
  }

  public getRejectedInARow(): number {
    return this.rejectedInARow;
  }

  // Test seam: the in-flight re-registration, to await its settlement.
  public getReregistration(): Promise<void> | null {
    return this.reregistration;
  }

  public async tick(): Promise<void> {
    if (this.heartbeatInFlight) {
      logger.debug(
        "Skipping heartbeat: the previous one has not been answered yet.",
      );
      return;
    }

    if (this.reregistration) {
      logger.debug("Skipping heartbeat: re-registration is in progress.");
      return;
    }

    this.heartbeatInFlight = true;

    try {
      const before: RunnerCapabilitySet = RunnerCapabilities.resolve();
      const hostInfo: JSONObject = await getHostInfo();

      const result: HeartbeatResult = await AgentClient.heartbeat({
        agentVersion: RUNNER_VERSION,
        hostInfo,
      });

      if (!result.ok) {
        this.onRejected(result);
        return;
      }

      this.rejectedInARow = 0;

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
    } catch (err) {
      /*
       * A network error or timeout says nothing about the key, so it is not
       * a rejection and does not count toward re-registration.
       */
      logger.warn(
        `Heartbeat failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.heartbeatInFlight = false;
    }
  }

  private onRejected(result: HeartbeatResult): void {
    if (!isCredentialRejection(result.statusCode)) {
      return;
    }

    this.rejectedInARow++;

    if (
      !KubernetesAgentMode.isActive() ||
      this.rejectedInARow < REREGISTER_AFTER_REJECTED_HEARTBEATS ||
      this.reregistration
    ) {
      return;
    }

    logger.warn(
      `Heartbeats are being rejected (${this.rejectedInARow} in a row) — re-registering the Kubernetes agent Runner with the ingestion key.`,
    );

    /*
     * Single-flight: the promise is held until it settles, and every tick in
     * the meantime does nothing. The rejection counter is reset only once
     * the round is over — a success means the next rejections are against
     * the NEW key and deserve a fresh count; a failure means we wait for
     * another full run of rejections before spending another round.
     */
    this.reregistration = Register.tryRegisterRunner({
      maxAttempts: REREGISTER_MAX_ATTEMPTS,
    })
      .then((registered: boolean) => {
        if (registered) {
          logger.info(
            "Re-registered the Kubernetes agent Runner; heartbeats resume with the new identity.",
          );
        } else {
          logger.error(
            `Could not re-register the Kubernetes agent Runner after ${REREGISTER_MAX_ATTEMPTS} attempts. Heartbeats continue with the current identity; another round starts if they keep being rejected. Check oneuptime.apiKey on the Kubernetes agent chart.`,
          );
        }
      })
      .catch((err: unknown) => {
        logger.error(
          `Re-registration failed unexpectedly: ${err instanceof Error ? err.message : String(err)}`,
        );
      })
      .finally(() => {
        this.rejectedInARow = 0;
        this.reregistration = null;
      });
  }
}

export default function startHeartbeat(): void {
  const loop: HeartbeatLoop = new HeartbeatLoop();

  const tick: () => void = (): void => {
    loop.tick().catch((err: unknown) => {
      logger.warn(
        `Heartbeat tick failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  };

  tick();
  setInterval(tick, HEARTBEAT_INTERVAL_MS);
}
