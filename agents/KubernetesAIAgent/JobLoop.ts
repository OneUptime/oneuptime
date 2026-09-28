import AgentStatus from "./AgentStatus";
import IngestClient, { IngestResponse } from "./IngestClient";
import KubectlExecutor, {
  KubectlExecResult,
  PreparedKubectlCommand,
} from "./KubectlExecutor";
import Logger from "./Logger";
import { AgentIdentity, AgentSession } from "./Registration";
import { SleepFunction, sleep as defaultSleep, waitAtMost } from "./Sleep";
import { AI_COMMAND_JOB_ORIGINS } from "./Common/Types/Runbook/RunnerJobOrigin";
import {
  DEFAULT_KUBECTL_TIMEOUT_MS,
  MAX_KUBECTL_TIMEOUT_MS,
} from "./Common/Types/Kubernetes/KubernetesClusterAiAccess";

/*
 * Claims kubectl jobs from OneUptime and runs them, one at a time.
 *
 * The queue is the server's RunnerJob table: a claim hands the agent a job
 * with a lease, which the agent keeps alive with job heartbeats while the
 * command runs, and the result is delivered back to the same job. The lease
 * is what lets the server time out a job whose agent died; this loop's job
 * is to never act on a job the server has already given up on, and to get
 * the result of a command that did run recorded — with its exit code and
 * output — even when the first delivery is lost.
 */

/*
 * The lease the server grants on a claim and renews on every job heartbeat.
 * The server also sends leaseExpiresAt, but on its own clock: comparing
 * that with this pod's clock would make the result-retry window depend on
 * clock skew, so the agent counts the lease on its own clock from the
 * moment it last asked for it.
 */
export const JOB_LEASE_MS: number = 30_000;

// Job heartbeats while a command runs: a third of the lease.
export const JOB_HEARTBEAT_INTERVAL_MS: number = 10_000;

/*
 * How long the heartbeat sent just before a command runs may hold it up.
 * Best effort: a server that does not answer within this gets no more of
 * the command's time, and the command runs.
 */
export const PRE_SPAWN_HEARTBEAT_TIMEOUT_MS: number = 5_000;

/*
 * Delivering a result: at most this many attempts, the n-th retry after
 * 0.5 s, 1 s, 2 s, 4 s, 8 s (about 15 s in all), and never past the end of
 * the lease as the agent last had it confirmed — after that the server has
 * timed the job out and no longer takes its result.
 */
export const RESULT_SUBMIT_MAX_ATTEMPTS: number = 6;
export const RESULT_RETRY_BASE_DELAY_MS: number = 500;
export const RESULT_RETRY_MAX_DELAY_MS: number = 8_000;

const REFUSED: string = "Refused by the Kubernetes AI agent";

/*
 * Reported instead of running the command when the server answers the
 * pre-spawn heartbeat that the job is no longer this agent's. No exit code
 * and no output: that is how the server reads "did not run".
 */
export const NOT_RUN_LEASE_LOST_MESSAGE: string =
  "The Kubernetes AI agent did not run this command: when it was about to start, OneUptime answered that the job is no longer this agent's (its lease lapsed, or it already ended).";

// Reported for a job the agent claimed while it was already shutting down.
export const NOT_RUN_SHUTTING_DOWN_MESSAGE: string =
  "The Kubernetes AI agent did not run this command: it was shutting down (a restart or a chart upgrade). Try again in a minute.";

export const KUBECTL_STEP_TYPE: string = "Kubectl";

/*
 * Fields that would carry a Kubernetes credential. The agent only ever uses
 * its own ServiceAccount; a job that names a credential was meant for a
 * Runner and is refused rather than run with the wrong identity.
 */
const CREDENTIAL_FIELDS: Array<string> = [
  "credential",
  "credentialId",
  "kubernetesCredential",
  "kubernetesCredentialId",
];
const PAYLOAD_CREDENTIAL_FIELDS: Array<string> = [
  ...CREDENTIAL_FIELDS,
  "apiServerUrl",
  "token",
  "caCertificate",
  "kubeconfig",
];

export interface JobTimings {
  leaseMs: number;
  jobHeartbeatIntervalMs: number;
  preSpawnHeartbeatTimeoutMs: number;
  resultMaxAttempts: number;
  resultRetryBaseDelayMs: number;
  resultRetryMaxDelayMs: number;
}

export const DEFAULT_JOB_TIMINGS: JobTimings = {
  leaseMs: JOB_LEASE_MS,
  jobHeartbeatIntervalMs: JOB_HEARTBEAT_INTERVAL_MS,
  preSpawnHeartbeatTimeoutMs: PRE_SPAWN_HEARTBEAT_TIMEOUT_MS,
  resultMaxAttempts: RESULT_SUBMIT_MAX_ATTEMPTS,
  resultRetryBaseDelayMs: RESULT_RETRY_BASE_DELAY_MS,
  resultRetryMaxDelayMs: RESULT_RETRY_MAX_DELAY_MS,
};

export interface ClaimedJob {
  jobId: string;
  origin: string;
  stepId: string | null;
  stepType: string;
  timeoutInMs: number;
  leaseExpiresAt: string | null;
  payload: Record<string, unknown>;
  // The job exactly as claimed, for the credential check.
  raw: Record<string, unknown>;
}

// What this pod knows about its lease on one job, on its own clock.
interface JobLease {
  /*
   * Until when (epoch ms, this pod's clock) the server has confirmed the
   * job is this agent's: the send time of the last renewed heartbeat plus
   * the lease. Until the first renewal it counts from the claim.
   */
  confirmedUntilMs: number;
  // The server answered that the job is no longer this agent's.
  isLost: boolean;
  // The job is done here; a heartbeat answered after this is ignored.
  isFinished: boolean;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/*
 * The command's time budget: the server's, when it is a positive number, at
 * most MAX_KUBECTL_TIMEOUT_MS; DEFAULT_KUBECTL_TIMEOUT_MS otherwise.
 */
export function normalizeJobTimeout(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_KUBECTL_TIMEOUT_MS;
  }

  return Math.min(Math.floor(value), MAX_KUBECTL_TIMEOUT_MS);
}

/*
 * The job in a claim answer, or null when there is none or it cannot be
 * reported on (no job id).
 */
export function parseClaimedJob(raw: unknown): ClaimedJob | null {
  const job: Record<string, unknown> | null = asObject(raw);
  const jobId: string | null = job ? asString(job["jobId"]) : null;

  if (!job || !jobId) {
    return null;
  }

  return {
    jobId,
    origin: asString(job["origin"]) || "",
    stepId: asString(job["stepId"]),
    stepType: asString(job["stepType"]) || "",
    timeoutInMs: normalizeJobTimeout(job["timeoutInMs"]),
    leaseExpiresAt: asString(job["leaseExpiresAt"]),
    payload: asObject(job["payload"]) || {},
    raw: job,
  };
}

function isPresent(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

/*
 * The first local check (the rest are the executor's): the agent runs only
 * kubectl, only for OneUptime AI, and only with its own ServiceAccount.
 */
export function getJobRefusal(job: ClaimedJob): string | null {
  if (job.stepType !== KUBECTL_STEP_TYPE) {
    return `${REFUSED}: it only runs kubectl commands, and this job is a "${
      job.stepType || "(unknown)"
    }" step.`;
  }

  if (!(AI_COMMAND_JOB_ORIGINS as Array<string>).includes(job.origin)) {
    return `${REFUSED}: it only runs commands for OneUptime AI investigations and fixes, and this job came from "${
      job.origin || "(unknown)"
    }".`;
  }

  const carriesCredential: boolean =
    CREDENTIAL_FIELDS.some((field: string): boolean => {
      return isPresent(job.raw[field]);
    }) ||
    PAYLOAD_CREDENTIAL_FIELDS.some((field: string): boolean => {
      return isPresent(job.payload[field]);
    });

  if (carriesCredential) {
    return `${REFUSED}: the job carries a Kubernetes credential, but this agent only uses its own ServiceAccount.`;
  }

  return null;
}

export function getResultRetryDelayMs(
  retryNumber: number,
  timings: Pick<
    JobTimings,
    "resultRetryBaseDelayMs" | "resultRetryMaxDelayMs"
  > = DEFAULT_JOB_TIMINGS,
): number {
  return Math.min(
    timings.resultRetryBaseDelayMs * Math.pow(2, Math.max(0, retryNumber - 1)),
    timings.resultRetryMaxDelayMs,
  );
}

/*
 * Whether a job-heartbeat answer means "this job is no longer yours": the
 * server answers 404 for a lease that lapsed or a job that is not this
 * agent's, and any other refusal (a reset identity, a server without the
 * API) means the same for this job. A transient failure means nothing.
 */
function isLeaseLost(response: IngestResponse): boolean {
  return (
    response.kind === "auth" ||
    response.kind === "api_missing" ||
    response.kind === "other"
  );
}

export interface JobLoopDependencies {
  client: IngestClient;
  session: AgentSession;
  executor: KubectlExecutor;
  status: AgentStatus;
  pollIntervalMs: number;
  timings?: Partial<JobTimings> | undefined;
  sleep?: SleepFunction | undefined;
}

export default class JobLoop {
  private readonly timings: JobTimings;
  private readonly sleep: SleepFunction;
  private stopped: boolean = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  // The tick in progress: a claim, and the job it returned.
  private current: Promise<boolean> | null = null;
  private claimFailuresInARow: number = 0;

  public constructor(private readonly deps: JobLoopDependencies) {
    this.timings = { ...DEFAULT_JOB_TIMINGS, ...(deps.timings || {}) };
    this.sleep = deps.sleep || defaultSleep;
  }

  public start(): void {
    this.schedule(0);
  }

  /*
   * Stop claiming, then wait up to graceMs for the job in progress (and
   * its result delivery) to finish. Resolves true when nothing is left
   * running.
   */
  public async stop(graceMs: number): Promise<boolean> {
    this.stopped = true;

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    return waitAtMost(this.current, graceMs);
  }

  /*
   * One claim, and the job it returned run to the end (result delivered).
   * Resolves true when a job was handled — the loop then claims again at
   * once instead of waiting a poll interval. Never throws.
   */
  public tick(): Promise<boolean> {
    if (this.current) {
      return this.current;
    }

    this.current = this.claimAndRun()
      .catch((err: unknown): boolean => {
        Logger.error("The job loop failed unexpectedly", {
          error: err instanceof Error ? err.message : String(err),
        });
        return false;
      })
      .finally((): void => {
        this.current = null;
      });

    return this.current;
  }

  private schedule(delayMs: number): void {
    if (this.stopped || this.timer) {
      return;
    }

    this.timer = setTimeout((): void => {
      this.timer = null;
      void this.tick().then((handledJob: boolean): void => {
        this.schedule(handledJob ? 0 : this.deps.pollIntervalMs);
      });
    }, delayMs);
  }

  private async claimAndRun(): Promise<boolean> {
    if (this.stopped) {
      return false;
    }

    const identity: AgentIdentity | null = this.deps.session.getIdentity();

    if (!identity) {
      return false;
    }

    const response: IngestResponse =
      await this.deps.client.claimNextJob(identity);

    if (response.kind === "auth" || response.kind === "api_missing") {
      Logger.warn("OneUptime rejected the job claim", {
        answer: response.message,
      });
      this.deps.session.recordRejected(identity, response);
      return false;
    }

    if (response.kind !== "ok") {
      this.claimFailuresInARow++;
      this.deps.status.recordError(response.message);

      if (this.claimFailuresInARow === 1) {
        Logger.warn(`Could not ask OneUptime for work: ${response.message}`);
      } else {
        Logger.debug(`Could not ask OneUptime for work: ${response.message}`, {
          failuresInARow: this.claimFailuresInARow,
        });
      }

      return false;
    }

    this.claimFailuresInARow = 0;
    this.deps.session.recordAccepted(identity);

    const rawJob: unknown = response.body ? response.body["job"] : null;

    if (rawJob === null || rawJob === undefined) {
      return false;
    }

    const job: ClaimedJob | null = parseClaimedJob(rawJob);

    if (!job) {
      Logger.warn(
        "OneUptime handed out a job without a job id; it cannot be run or reported on.",
      );
      return false;
    }

    await this.runJob(identity, job);
    return true;
  }

  // Run one claimed job and deliver its result. Public for tests.
  public async runJob(identity: AgentIdentity, job: ClaimedJob): Promise<void> {
    const lease: JobLease = {
      confirmedUntilMs: Date.now() + this.timings.leaseMs,
      isLost: false,
      isFinished: false,
    };

    this.deps.status.runningJobId = job.jobId;

    /*
     * Keep the lease alive in the background so a long command is not
     * timed out by the server. It keeps going while the result is being
     * delivered, so a retry is not cut short by a lease the agent let lapse
     * itself.
     */
    const heartbeatTimer: ReturnType<typeof setInterval> = setInterval(
      (): void => {
        this.renewLeaseInBackground({ identity, job, lease });
      },
      this.timings.jobHeartbeatIntervalMs,
    );

    try {
      const result: KubectlExecResult = await this.runStep({
        identity,
        job,
        lease,
      });

      await this.deliverResult({ identity, job, result, lease });
    } finally {
      lease.isFinished = true;
      clearInterval(heartbeatTimer);
      this.deps.status.runningJobId = null;
      this.deps.status.jobsRun++;
      this.deps.status.lastJobAt = new Date();
    }
  }

  /*
   * Run the command, or refuse it, and return what to report. Whatever this
   * returns is exactly what is reported, however many attempts the
   * delivery takes.
   */
  private async runStep(data: {
    identity: AgentIdentity;
    job: ClaimedJob;
    lease: JobLease;
  }): Promise<KubectlExecResult> {
    const { job } = data;

    try {
      const refusal: string | null = getJobRefusal(job);

      if (refusal) {
        Logger.warn("Refused a job", { jobId: job.jobId, reason: refusal });
        return { success: false, output: "", errorMessage: refusal };
      }

      if (this.stopped) {
        return {
          success: false,
          output: "",
          errorMessage: NOT_RUN_SHUTTING_DOWN_MESSAGE,
        };
      }

      const prepared: PreparedKubectlCommand = this.deps.executor.prepare({
        payload: job.payload,
        origin: job.origin,
        timeoutInMs: job.timeoutInMs,
      });

      if (prepared.refusal !== null) {
        Logger.warn("Refused a kubectl command", {
          jobId: job.jobId,
          reason: prepared.refusal,
        });
        return { success: false, output: "", errorMessage: prepared.refusal };
      }

      const isStillOurs: boolean = await this.markStepStarting(data);

      if (!isStillOurs) {
        return {
          success: false,
          output: "",
          errorMessage: NOT_RUN_LEASE_LOST_MESSAGE,
        };
      }

      Logger.info("Running a kubectl command", {
        jobId: job.jobId,
        origin: job.origin,
        tier: prepared.tier,
      });
      Logger.debug("kubectl command", {
        jobId: job.jobId,
        command: prepared.displayCommand,
      });

      return await prepared.run();
    } catch (err: unknown) {
      Logger.error("The kubectl job failed unexpectedly", {
        jobId: job.jobId,
        error: err instanceof Error ? err.message : String(err),
      });

      return {
        success: false,
        output: "",
        errorMessage: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /*
   * Tell the server the command is about to run, right before it does, so
   * the job's start time means "about to run" and a fast command whose
   * result is lost still shows it started. Best effort: no answer (or a
   * transient one) and the command runs anyway. Only an answer that the
   * job is no longer this agent's stops it: the server has already given
   * up on the job, so running it now would act on the cluster behind the
   * platform's back.
   */
  private async markStepStarting(data: {
    identity: AgentIdentity;
    job: ClaimedJob;
    lease: JobLease;
  }): Promise<boolean> {
    const sentAtMs: number = Date.now();
    const response: IngestResponse = await this.deps.client.jobHeartbeat(
      data.identity,
      data.job.jobId,
      this.timings.preSpawnHeartbeatTimeoutMs,
    );

    if (response.kind === "ok") {
      this.renewLease(data.lease, sentAtMs);
      return true;
    }

    if (isLeaseLost(response)) {
      this.markLeaseLost(data.job, data.lease, response);
      return false;
    }

    Logger.warn(
      "Could not tell OneUptime the command is starting; running it anyway.",
      { jobId: data.job.jobId, answer: response.message },
    );
    return true;
  }

  private renewLease(lease: JobLease, sentAtMs: number): void {
    lease.confirmedUntilMs = Math.max(
      lease.confirmedUntilMs,
      sentAtMs + this.timings.leaseMs,
    );
  }

  private markLeaseLost(
    job: ClaimedJob,
    lease: JobLease,
    response: IngestResponse,
  ): void {
    if (lease.isLost) {
      return;
    }

    lease.isLost = true;

    Logger.warn(
      "OneUptime says this job is no longer this agent's (its lease lapsed, or it already ended); its result will not be retried.",
      { jobId: job.jobId, answer: response.message },
    );
  }

  private renewLeaseInBackground(data: {
    identity: AgentIdentity;
    job: ClaimedJob;
    lease: JobLease;
  }): void {
    if (data.lease.isLost || data.lease.isFinished) {
      return;
    }

    const sentAtMs: number = Date.now();

    void this.deps.client
      .jobHeartbeat(data.identity, data.job.jobId)
      .then((response: IngestResponse): void => {
        if (data.lease.isFinished) {
          return;
        }

        if (response.kind === "ok") {
          this.renewLease(data.lease, sentAtMs);
          return;
        }

        if (isLeaseLost(response)) {
          this.markLeaseLost(data.job, data.lease, response);
          return;
        }

        Logger.warn("Job heartbeat failed", {
          jobId: data.job.jobId,
          answer: response.message,
        });
      });
  }

  /*
   * Deliver the result, and keep delivering THAT result: a command that
   * ran and whose first POST was lost must be recorded with its exit code
   * and output, never replaced by the transport error. A send with no
   * usable answer is retried with backoff, while the lease lasts; resending
   * is safe because the server refuses a second result for a job that
   * already has one. Any other answer ends delivery.
   */
  private async deliverResult(data: {
    identity: AgentIdentity;
    job: ClaimedJob;
    result: KubectlExecResult;
    lease: JobLease;
  }): Promise<void> {
    const maxAttempts: number = Math.max(1, this.timings.resultMaxAttempts);

    for (let attempt: number = 1; attempt <= maxAttempts; attempt++) {
      const response: IngestResponse = await this.deps.client.submitJobResult(
        data.identity,
        data.job.jobId,
        {
          success: data.result.success,
          output: data.result.output,
          exitCode: data.result.exitCode,
          errorMessage: data.result.errorMessage,
        },
      );

      if (response.kind === "ok") {
        if (response.body && response.body["accepted"] === false) {
          Logger.error(
            "OneUptime did not store this job's result: the job is no longer this agent's (typically its lease lapsed and it was timed out).",
            { jobId: data.job.jobId, attempts: attempt },
          );
        } else {
          Logger.info("Delivered a kubectl result", {
            jobId: data.job.jobId,
            success: data.result.success,
            ...(typeof data.result.exitCode === "number"
              ? { exitCode: data.result.exitCode }
              : {}),
          });
        }
        return;
      }

      if (response.kind !== "transient") {
        Logger.error("OneUptime refused this job's result", {
          jobId: data.job.jobId,
          answer: response.message,
        });

        if (response.kind === "auth") {
          this.deps.session.recordRejected(data.identity, response);
        }
        return;
      }

      if (attempt >= maxAttempts) {
        Logger.error(
          `Could not deliver this job's result after ${attempt} attempts; OneUptime will time the job out.`,
          { jobId: data.job.jobId, lastAnswer: response.message },
        );
        return;
      }

      const delayMs: number = getResultRetryDelayMs(attempt, this.timings);

      if (
        data.lease.isLost ||
        Date.now() + delayMs >= data.lease.confirmedUntilMs
      ) {
        Logger.error(
          `Could not deliver this job's result, and the lease on it ${
            data.lease.isLost ? "is gone" : "ends before another attempt"
          }; OneUptime will time the job out.`,
          {
            jobId: data.job.jobId,
            attempts: attempt,
            lastAnswer: response.message,
          },
        );
        return;
      }

      Logger.warn(
        `Delivering this job's result failed (attempt ${attempt} of ${maxAttempts}); retrying in ${delayMs} ms.`,
        { jobId: data.job.jobId, answer: response.message },
      );

      await this.sleep(delayMs);
    }
  }
}
