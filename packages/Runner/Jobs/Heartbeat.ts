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
import { KubernetesRunnerPosture } from "Common/Types/Kubernetes/KubernetesClusterAiAccess";
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
 * giving up. For the kubernetes-agent Runner (the only one that
 * re-registers) RegisterRunner waits 30s, then at most 60s, between the
 * five attempts, so a whole round takes about three and a half minutes (a
 * refusal that needs an operator is retried every 5 minutes instead, and
 * logged once per round). A round that fails leaves the Runner on its
 * current identity; the next round starts only after another run of
 * rejections, so a revoked ingestion key costs a bounded trickle of
 * attempts, never a flood.
 */
export const REREGISTER_MAX_ATTEMPTS: number = 5;

/*
 * How long stopping the heartbeat waits for a heartbeat or a registration
 * attempt that is already on the wire. Well under GracefulShutdown's
 * per-handler bound, so the sign-off that follows still has time to run.
 */
export const HEARTBEAT_STOP_MAX_WAIT_MS: number = 5_000;

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
   * The full Kubernetes posture rides on every heartbeat of the
   * kubernetes-agent Runner — and ONLY that Runner — so the cluster's AI
   * page reflects the container that is running now (writes allowed or
   * not, which kubectl), not the one that registered last week.
   *
   * Any other Runner reports only its kubectl write limits: the write
   * switch, the node switch and the write namespaces its KubectlExecutor
   * refuses writes by, so the server refuses up front what this Runner
   * would refuse. Never in-cluster, never a cluster identity or a pod
   * namespace, even for a Runner that runs in a pod: being in a pod says
   * nothing about which cluster, and an in-cluster posture naming a
   * cluster would make the server treat it as that cluster's agent and
   * hand it credential-less commands.
   */
  const posture: KubernetesRunnerPosture = KubernetesAgentMode.isActive()
    ? await KubernetesPosture.build()
    : KubernetesPosture.buildWriteLimits();

  info["kubernetes"] = posture as unknown as JSONObject;

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
 *
 * Shutdown: once stop() is called nothing is sent again — no heartbeat and
 * no registration attempt — and stop() waits (boundedly) for a heartbeat or
 * a registration attempt already on the wire. The Runner signs off with
 * /disconnect only after that, because a heartbeat or a registration the
 * server processes after the sign-off marks the row Connected again and
 * locks the replacement pod out for the whole alive window. A registration
 * that succeeded has stored its new key by the time it settles, so the
 * /disconnect that follows carries the key the server just issued.
 */
export class HeartbeatLoop {
  private rejectedInARow: number = 0;
  private heartbeatInFlight: boolean = false;
  private inFlight: Promise<void> | null = null;
  private reregistration: Promise<void> | null = null;
  /*
   * The registration ATTEMPT of the current round that is on the wire, if
   * any — not the round, which also sleeps between attempts and would hold
   * a shutdown up for nothing.
   */
  private registrationAttempt: Promise<void> | null = null;
  private stopped: boolean = false;

  public isReregistering(): boolean {
    return this.reregistration !== null;
  }

  public isHeartbeatInFlight(): boolean {
    return this.heartbeatInFlight;
  }

  public isStopped(): boolean {
    return this.stopped;
  }

  public isRegistrationAttemptInFlight(): boolean {
    return this.registrationAttempt !== null;
  }

  /*
   * Stop for good: no heartbeat or registration attempt starts after this,
   * and a heartbeat or registration attempt already in flight is waited
   * for — at most maxWaitMs in all, so a hung request cannot hold up the
   * shutdown.
   */
  public async stop(
    maxWaitMs: number = HEARTBEAT_STOP_MAX_WAIT_MS,
  ): Promise<void> {
    this.stopped = true;

    const pending: Array<Promise<unknown>> = [];

    if (this.inFlight) {
      pending.push(this.inFlight);
    }

    if (this.registrationAttempt) {
      pending.push(this.registrationAttempt);
    }

    if (pending.length === 0) {
      return;
    }

    const settled: Promise<unknown> = Promise.allSettled(pending);

    await new Promise<void>((resolve: () => void) => {
      const timer: ReturnType<typeof setTimeout> = setTimeout(
        resolve,
        maxWaitMs,
      );
      const done: () => void = (): void => {
        clearTimeout(timer);
        resolve();
      };
      settled.then(done, done);
    });
  }

  public getRejectedInARow(): number {
    return this.rejectedInARow;
  }

  // Test seam: the in-flight re-registration, to await its settlement.
  public getReregistration(): Promise<void> | null {
    return this.reregistration;
  }

  public async tick(): Promise<void> {
    if (this.stopped) {
      logger.debug("Skipping heartbeat: the Runner has signed off.");
      return;
    }

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

    const run: Promise<void> = this.send();
    this.inFlight = run;

    try {
      await run;
    } finally {
      this.heartbeatInFlight = false;
      this.inFlight = null;
    }
  }

  private async send(): Promise<void> {
    try {
      const before: RunnerCapabilitySet = RunnerCapabilities.resolve();
      const hostInfo: JSONObject = await getHostInfo();

      /*
       * Gathering the posture takes a moment; if the Runner began signing
       * off meanwhile, nothing may reach the server any more.
       */
      if (this.stopped) {
        return;
      }

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
    }
  }

  private onRejected(result: HeartbeatResult): void {
    if (!isCredentialRejection(result.statusCode)) {
      return;
    }

    this.rejectedInARow++;

    if (
      this.stopped ||
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
      // A registration after the sign-off would mark the Runner online again.
      shouldContinue: (): boolean => {
        return !this.stopped;
      },
      // ... and so would one already on the wire: stop() waits for it.
      onAttempt: (attempt: Promise<void>): void => {
        this.trackRegistrationAttempt(attempt);
      },
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

  // Hold the attempt on the wire until it settles (see stop()).
  private trackRegistrationAttempt(attempt: Promise<void>): void {
    this.registrationAttempt = attempt;

    const clear: () => void = (): void => {
      if (this.registrationAttempt === attempt) {
        this.registrationAttempt = null;
      }
    };

    attempt.then(clear, clear);
  }
}

export interface HeartbeatHandle {
  /*
   * Stop the loop for good: clears the interval, then waits (boundedly)
   * for a heartbeat or registration attempt already on the wire. Resolves
   * once nothing more will be sent.
   */
  stop: () => Promise<void>;
}

export default function startHeartbeat(): HeartbeatHandle {
  const loop: HeartbeatLoop = new HeartbeatLoop();

  const tick: () => void = (): void => {
    loop.tick().catch((err: unknown) => {
      logger.warn(
        `Heartbeat tick failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  };

  tick();
  const interval: ReturnType<typeof setInterval> = setInterval(
    tick,
    HEARTBEAT_INTERVAL_MS,
  );

  return {
    stop: async (): Promise<void> => {
      clearInterval(interval);
      await loop.stop();
    },
  };
}

/*
 * The Runner's sign-off on SIGTERM/SIGINT, in the only safe order: stop the
 * heartbeat (and wait out a heartbeat or re-registration attempt already on
 * the wire) BEFORE telling the server this Runner is gone. The other way
 * round, a heartbeat or registration the server handles after the
 * /disconnect marks the row Connected again, and the kubernetes-agent
 * Runner's replacement pod is refused for the whole alive window instead of
 * registering at once.
 */
export async function signOff(heartbeat: HeartbeatHandle): Promise<void> {
  await heartbeat.stop();
  await AgentClient.disconnect();
}
