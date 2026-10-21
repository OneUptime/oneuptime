import AgentStatus from "./AgentStatus";
import IngestClient, {
  CANCELLED_REQUEST_SETTLE_MS,
  IngestResponse,
} from "./IngestClient";
import Logger from "./Logger";
import { AgentPosture } from "./Posture";
import { AgentIdentity, AgentSession } from "./Registration";
import { waitAtMost } from "./Sleep";

/*
 * The heartbeat keeps the agent "connected" on the cluster's AI agent page
 * (online means a heartbeat within the last 5 minutes) and carries the
 * posture of the pod that is running now: in the cluster or not, writes
 * allowed or not, which namespaces, which kubectl.
 *
 * At most one heartbeat is in flight at a time — a tick that finds one
 * pending does nothing — and none is sent without an identity (before the
 * first registration, or while re-registering). Rejections are handed to
 * the session, which re-registers after a few in a row.
 */

/*
 * How long stop() waits, by default, for a heartbeat already on the wire.
 * The agent's shutdown passes its own grace instead (Agent.ts).
 */
export const HEARTBEAT_STOP_MAX_WAIT_MS: number = 5_000;

export interface HeartbeatDependencies {
  client: IngestClient;
  session: AgentSession;
  status: AgentStatus;
  getPosture: () => Promise<AgentPosture>;
  agentVersion: string | null;
  intervalMs: number;
}

export default class HeartbeatLoop {
  private inFlight: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopped: boolean = false;
  private failuresInARow: number = 0;
  // Cancels the heartbeat on the wire when stop() gives up waiting for it.
  private readonly requestController: AbortController = new AbortController();

  public constructor(private readonly deps: HeartbeatDependencies) {}

  public start(): void {
    if (this.timer || this.stopped) {
      return;
    }

    this.timer = setInterval((): void => {
      void this.tick();
    }, this.deps.intervalMs);
  }

  // One heartbeat, unless one is already in flight. Never throws.
  public tick(): Promise<void> {
    if (this.stopped) {
      return Promise.resolve();
    }

    if (this.inFlight) {
      return this.inFlight;
    }

    const identity: AgentIdentity | null = this.deps.session.getIdentity();

    if (!identity) {
      return Promise.resolve();
    }

    this.inFlight = this.send(identity)
      .catch((err: unknown): void => {
        Logger.warn("Heartbeat failed unexpectedly", {
          error: err instanceof Error ? err.message : String(err),
        });
      })
      .finally((): void => {
        this.inFlight = null;
      });

    return this.inFlight;
  }

  /*
   * Stop for good: nothing is sent after this, and a heartbeat already on
   * the wire is waited for, up to maxWaitMs. The agent's /disconnect must
   * come after its answer, or a heartbeat the server handles after the
   * sign-off marks the agent connected again — and the replacement pod is
   * refused (previous_instance_online) until that heartbeat is 5 minutes
   * old. One still unanswered after maxWaitMs is cancelled, so the wait
   * never outlasts the pod's termination grace period.
   *
   * Resolves true when nothing was left unanswered.
   */
  public async stop(
    maxWaitMs: number = HEARTBEAT_STOP_MAX_WAIT_MS,
  ): Promise<boolean> {
    this.stopped = true;

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    const inFlight: Promise<void> | null = this.inFlight;

    if (await waitAtMost(inFlight, maxWaitMs)) {
      return true;
    }

    this.requestController.abort();
    // The cancelled request settles at once (a tick never throws).
    await waitAtMost(inFlight, CANCELLED_REQUEST_SETTLE_MS);
    return false;
  }

  private async send(identity: AgentIdentity): Promise<void> {
    const posture: AgentPosture = await this.deps.getPosture();

    // Stopped while the posture was being read: send nothing.
    if (this.stopped) {
      return;
    }

    this.deps.status.posture = posture;

    const response: IngestResponse = await this.deps.client.heartbeat(
      identity,
      {
        agentVersion: this.deps.agentVersion || undefined,
        posture,
      },
      { signal: this.requestController.signal },
    );

    if (response.kind === "ok") {
      if (this.failuresInARow > 0) {
        Logger.info("Heartbeats are reaching OneUptime again.", {
          failedBefore: this.failuresInARow,
        });
      }

      this.failuresInARow = 0;
      this.deps.status.lastHeartbeatAt = new Date();
      this.deps.session.recordAccepted(identity);
      return;
    }

    if (response.kind === "auth" || response.kind === "api_missing") {
      Logger.warn("OneUptime rejected the heartbeat", {
        answer: response.message,
      });
      this.deps.session.recordRejected(identity, response);
      return;
    }

    // Cancelled by stop(): the agent is shutting down, nothing to report.
    if (this.requestController.signal.aborted) {
      return;
    }

    // transient or other: the identity is not in question; try next tick.
    this.failuresInARow++;
    this.deps.status.recordError(response.message);

    if (this.failuresInARow === 1) {
      Logger.warn(`Heartbeat failed: ${response.message}`);
    } else {
      Logger.debug(`Heartbeat failed again: ${response.message}`, {
        failuresInARow: this.failuresInARow,
      });
    }
  }
}
