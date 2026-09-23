import { spawn } from "child_process";
import { JOB_HEARTBEAT_INTERVAL_MS, MAX_OUTPUT_BYTES } from "../Config";
import AgentClient, { ClaimedJob } from "./RunnerClient";
import SSHExecutor from "./SSHExecutor";
import KubernetesExecutor from "./KubernetesExecutor";
import KubectlExecutor from "./KubectlExecutor";
import RunnerCapabilities from "../Utils/RunnerCapabilities";
import KubernetesAgentMode from "../Utils/KubernetesAgentMode";
import logger from "Common/Server/Utils/Logger";
import VMUtil from "Common/Server/Utils/VM/VMAPI";
import CommandPolicy from "Common/Utils/AiRemediation/CommandPolicy";
import ReturnResult from "Common/Types/IsolatedVM/ReturnResult";
import RunbookStepType from "Common/Types/Runbook/RunbookStepType";
import RunnerJobOrigin, {
  AI_COMMAND_JOB_ORIGINS,
} from "Common/Types/Runbook/RunnerJobOrigin";
import { JSONObject } from "Common/Types/JSON";

interface ExecResult {
  success: boolean;
  output: string;
  exitCode?: number | undefined;
  errorMessage?: string | undefined;
}

function truncate(s: string): string {
  if (Buffer.byteLength(s, "utf8") <= MAX_OUTPUT_BYTES) {
    return s;
  }
  return (
    Buffer.from(s, "utf8").slice(0, MAX_OUTPUT_BYTES).toString("utf8") +
    "\n... [output truncated]"
  );
}

function runBashLocally(data: {
  script: string;
  timeoutInMs: number;
}): Promise<ExecResult> {
  return new Promise<ExecResult>((resolve: (v: ExecResult) => void) => {
    let stdout: string = "";
    let stderr: string = "";
    let stdoutBytes: number = 0;
    let stderrBytes: number = 0;
    let settled: boolean = false;

    const child: ReturnType<typeof spawn> = spawn("bash", ["-c", data.script], {
      timeout: data.timeoutInMs,
      killSignal: "SIGKILL",
    });

    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdoutBytes < MAX_OUTPUT_BYTES) {
        stdoutBytes += chunk.length;
        stdout += chunk.toString("utf8");
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderrBytes < MAX_OUTPUT_BYTES) {
        stderrBytes += chunk.length;
        stderr += chunk.toString("utf8");
      }
    });

    child.on("error", (err: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve({ success: false, output: "", errorMessage: err.message });
    });

    child.on("close", (code: number | null, signal: string | null) => {
      if (settled) {
        return;
      }
      settled = true;
      const combined: string = [
        stdout && `[stdout]\n${stdout}`,
        stderr && `[stderr]\n${stderr}`,
      ]
        .filter(Boolean)
        .join("\n");

      if (signal === "SIGKILL") {
        resolve({
          success: false,
          output: truncate(combined),
          errorMessage: `Killed (timeout ${data.timeoutInMs}ms)`,
        });
        return;
      }
      if (code === 0) {
        resolve({ success: true, output: truncate(combined), exitCode: 0 });
        return;
      }
      resolve({
        success: false,
        output: truncate(combined),
        exitCode: code ?? undefined,
        errorMessage: `Exit code ${code ?? "?"}`,
      });
    });
  });
}

/*
 * JavaScript runs inside the same isolated-vm sandbox the server used to use,
 * but now on the agent's machine rather than on the OneUptime Worker. The
 * isolate has no fs or process access and is killed at the timeout.
 *
 * It is NOT a network sandbox: the host deliberately bridges an HTTP client
 * into the isolate, so a script can reach anything the agent's machine can
 * reach. Run agents where you would run any other operator-authored automation
 * — the trust boundary is the Runbook author, not the isolate.
 */
async function runJavaScriptLocally(data: {
  script: string;
  timeoutInMs: number;
}): Promise<ExecResult> {
  try {
    const result: ReturnResult = await VMUtil.runCodeInSandbox({
      code: data.script,
      options: { args: {}, timeout: data.timeoutInMs },
    });

    const lines: string[] = [...(result.logMessages || [])];
    if (result.returnValue !== undefined) {
      lines.push(
        `Return: ${
          typeof result.returnValue === "string"
            ? result.returnValue
            : JSON.stringify(result.returnValue, null, 2)
        }`,
      );
    }
    const output: string = truncate(lines.join("\n"));

    if (result.scriptError) {
      return {
        success: false,
        output,
        errorMessage: result.scriptError.message,
      };
    }
    return { success: true, output };
  } catch (err) {
    return {
      success: false,
      output: "",
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}

/*
 * What the Runner will do with a claimed job: refuse it, with the reason, or
 * hand it to an executor. The executor-independent checks are all made here,
 * before anything runs, so a step refused here is never announced to the
 * server as starting (see runStep). `run` holds the executor call; nothing
 * has run until it is called. The executors keep their own checks (the
 * kubectl argv, write scope and node-operation checks run inside
 * KubectlExecutor, after the announcement).
 */
type PreparedStep =
  | { isRefused: true; errorMessage: string }
  | { isRefused: false; run: () => Promise<ExecResult> };

function refuseStep(errorMessage: string): PreparedStep {
  return { isRefused: true, errorMessage };
}

function prepareStep(job: ClaimedJob): PreparedStep {
  /*
   * The kubernetes-agent Runner runs kubectl and nothing else, whatever the
   * origin and whatever the server sent. Checked before any capability,
   * policy or executor is consulted: a Bash or SSH step inside the agent
   * pod would reach the same kubectl and the mounted ServiceAccount token
   * with none of the kubectl safeguards below in the way.
   */
  const agentRefusal: string | null = KubernetesAgentMode.getStepTypeRefusal(
    job.stepType,
  );

  if (agentRefusal) {
    return refuseStep(agentRefusal);
  }

  /*
   * Defense in depth for AI-composed command jobs. The server already gates
   * these on the dashboard capability and validates the command at enqueue,
   * but this binary runs on the customer's host — so the host's own refusal
   * (local env override) and the command denylist are re-checked HERE, where
   * no server compromise can skip them.
   */
  const isAiOrigin: boolean = AI_COMMAND_JOB_ORIGINS.includes(
    (job.origin || "") as RunnerJobOrigin,
  );

  if (isAiOrigin) {
    if (!RunnerCapabilities.resolve().canRunAiCommands) {
      return refuseStep(
        "This Runner does not accept AI-composed commands (disabled locally or by the dashboard).",
      );
    }

    /*
     * An investigation is read-only by construction: the only thing it may
     * ask a Runner to do is a Read-tier kubectl command, which
     * KubectlExecutor re-checks on the argv. Everything else is refused
     * before any executor is consulted.
     */
    if (
      job.origin === RunnerJobOrigin.AiInvestigation &&
      job.stepType !== RunbookStepType.Kubectl
    ) {
      return refuseStep(
        `AI investigation jobs may only run read-only kubectl, not ${String(job.stepType)}.`,
      );
    }

    if (
      job.stepType !== RunbookStepType.Bash &&
      job.stepType !== RunbookStepType.SSH &&
      job.stepType !== RunbookStepType.Kubectl
    ) {
      return refuseStep(
        `AI-composed jobs may not use step type ${String(job.stepType)}.`,
      );
    }

    if (job.stepType !== RunbookStepType.Kubectl) {
      const command: string =
        job.stepType === RunbookStepType.Bash
          ? job.script
          : String(job.payload?.["command"] || "");

      const denyReason: string | null = CommandPolicy.getDenyReason(command);
      if (denyReason) {
        return refuseStep(
          `Refused by the Runner's command policy: ${denyReason}.`,
        );
      }
    }
  }

  /*
   * kubectl: an argv plus, for a Runner outside the cluster, the credential
   * the server resolved. In-cluster, no credential arrives and kubectl uses
   * the pod's own ServiceAccount — so unlike SSH/Kubernetes, a missing
   * credential is not a refusal here; KubectlExecutor decides.
   */
  if (job.stepType === RunbookStepType.Kubectl) {
    const kubectlPayload: JSONObject | undefined = job.payload;

    if (!kubectlPayload) {
      return refuseStep("Kubectl step arrived without its instructions.");
    }

    return {
      isRefused: false,
      run: (): Promise<ExecResult> => {
        return KubectlExecutor.execute({
          payload: kubectlPayload,
          credential: job.credential,
          timeoutInMs: job.timeoutInMs,
          origin: job.origin,
        });
      },
    };
  }

  if (job.stepType === RunbookStepType.JavaScript) {
    return {
      isRefused: false,
      run: (): Promise<ExecResult> => {
        return runJavaScriptLocally({
          script: job.script,
          timeoutInMs: job.timeoutInMs,
        });
      },
    };
  }

  if (job.stepType === RunbookStepType.Bash) {
    return {
      isRefused: false,
      run: (): Promise<ExecResult> => {
        return runBashLocally({
          script: job.script,
          timeoutInMs: job.timeoutInMs,
        });
      },
    };
  }

  /*
   * SSH and Kubernetes steps act on OTHER systems, so they arrive as
   * structured instructions plus the credential the server resolved for this
   * Runner — never as a script. A missing credential means the server
   * declined to hand one over, which is a refusal, not something to retry
   * against the target.
   */
  if (
    job.stepType === RunbookStepType.SSH ||
    job.stepType === RunbookStepType.Kubernetes
  ) {
    const payload: JSONObject | undefined = job.payload;
    const credential: JSONObject | undefined = job.credential;

    if (!payload || !credential) {
      return refuseStep(
        `${job.stepType} step arrived without its ${
          payload ? "credential" : "instructions"
        }.`,
      );
    }

    if (job.stepType === RunbookStepType.SSH) {
      return {
        isRefused: false,
        run: (): Promise<ExecResult> => {
          return SSHExecutor.execute({
            payload,
            credential,
            timeoutInMs: job.timeoutInMs,
          });
        },
      };
    }

    return {
      isRefused: false,
      run: (): Promise<ExecResult> => {
        return KubernetesExecutor.execute({
          payload,
          credential,
          timeoutInMs: job.timeoutInMs,
        });
      },
    };
  }

  return refuseStep(`Unsupported step type: ${String(job.stepType)}`);
}

/*
 * The lease the server grants on a claim and renews on every job heartbeat
 * (DEFAULT_LEASE_MS in RunnerJobService; the Runner heartbeats at a third of
 * it). The server also sends the lease's end, as leaseExpiresAt, but on its
 * own clock: comparing that with this host's clock would make the result
 * retry window depend on clock skew, so the Runner counts the lease on its
 * own clock from the moment it last asked for it.
 */
export const JOB_LEASE_MS: number = 30_000;

/*
 * How long the heartbeat sent just before a step runs may hold the step up.
 * It is best effort: a server that does not answer within this gets no more
 * of the step's time, and the step runs.
 */
export const PRE_SPAWN_HEARTBEAT_TIMEOUT_MS: number = 5_000;

/*
 * Delivering a result: at most this many attempts, the n-th retry after
 * RESULT_RETRY_BASE_DELAY_MS * 2^(n-1), capped at RESULT_RETRY_MAX_DELAY_MS
 * (0.5 s, 1 s, 2 s, 4 s, 8 s: about 15 s of waiting in all), and never past
 * the end of the lease as the Runner last had it confirmed.
 */
export const RESULT_SUBMIT_MAX_ATTEMPTS: number = 6;
export const RESULT_RETRY_BASE_DELAY_MS: number = 500;
export const RESULT_RETRY_MAX_DELAY_MS: number = 8_000;

/*
 * Reported, instead of running the step, when the server answers the
 * pre-spawn heartbeat that the job is no longer this Runner's. It carries
 * no exit code and no output, which is how the server reads "did not run".
 */
export const NOT_RUN_LEASE_LOST_MESSAGE: string =
  "The Runner did not run this step: when it was about to start it, the server answered that the job is no longer this Runner's (its lease lapsed and it was timed out, or it already ended).";

export function getResultRetryDelayMs(retryNumber: number): number {
  return Math.min(
    RESULT_RETRY_BASE_DELAY_MS * Math.pow(2, Math.max(0, retryNumber - 1)),
    RESULT_RETRY_MAX_DELAY_MS,
  );
}

/*
 * What this Runner knows about its lease on one job, on its own clock.
 */
interface JobLease {
  /*
   * Until when (epoch ms, this host's clock) the server has confirmed the
   * job is this Runner's: the send time of the last heartbeat the server
   * renewed, plus JOB_LEASE_MS. The server set the lease from a moment
   * after that send, so the real lease lasts at least this long. Until the
   * first renewal it is counted from when the job reached the executor,
   * right after the claim that granted it.
   */
  confirmedUntilMs: number;
  // The server answered a heartbeat that the job is no longer this Runner's.
  isLost: boolean;
  // The job is done here; a heartbeat answered after this is ignored.
  isFinished: boolean;
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve: () => void) => {
    setTimeout(resolve, ms);
  });
}

function renewLease(lease: JobLease, sentAtMs: number): void {
  lease.confirmedUntilMs = Math.max(
    lease.confirmedUntilMs,
    sentAtMs + JOB_LEASE_MS,
  );
}

function markLeaseLost(data: { job: ClaimedJob; lease: JobLease }): void {
  if (data.lease.isLost) {
    return;
  }

  data.lease.isLost = true;

  logger.warn(
    `The server says job ${data.job.jobId} is no longer this Runner's (its lease lapsed and it was timed out, or it already ended). Its result will not be retried.`,
  );
}

/*
 * The heartbeat that keeps a running step's lease alive. It also moves the
 * Runner's view of the lease: a renewal extends it, and "no longer yours"
 * ends it, so the result is not retried against a job the server has let go.
 * A heartbeat that gets no answer changes nothing.
 */
function renewLeaseInBackground(data: {
  job: ClaimedJob;
  lease: JobLease;
}): void {
  if (data.lease.isLost || data.lease.isFinished) {
    return;
  }

  const sentAtMs: number = Date.now();

  AgentClient.jobHeartbeat(data.job.jobId)
    .then((isStillOurs: boolean) => {
      if (data.lease.isFinished) {
        return;
      }

      if (isStillOurs) {
        renewLease(data.lease, sentAtMs);
        return;
      }

      markLeaseLost(data);
    })
    .catch((err: unknown) => {
      logger.warn(
        `Job heartbeat for ${data.job.jobId} failed: ${describeError(err)}`,
      );
    });
}

/*
 * Tell the server the step is about to run, right before it does, so the
 * job's startedAt (set by its first heartbeat) means "about to run" rather
 * than "10 s into running", and a fast step whose result is lost still
 * shows it started.
 *
 * Best effort: when the heartbeat gets no answer, or no answer in
 * PRE_SPAWN_HEARTBEAT_TIMEOUT_MS, or the server cannot take it right now,
 * the step runs anyway. Only an answer that the job is no longer this
 * Runner's stops it (returns false): the server has already given up on the
 * job, possibly recorded it as never started, and may have moved on, so
 * running it now would act on the cluster behind the platform's back.
 */
async function markStepStarting(data: {
  job: ClaimedJob;
  lease: JobLease;
}): Promise<boolean> {
  const sentAtMs: number = Date.now();

  try {
    const isStillOurs: boolean = await AgentClient.jobHeartbeat(
      data.job.jobId,
      { timeoutInMs: PRE_SPAWN_HEARTBEAT_TIMEOUT_MS },
    );

    if (isStillOurs) {
      renewLease(data.lease, sentAtMs);
      return true;
    }

    markLeaseLost(data);
    return false;
  } catch (err) {
    logger.warn(
      `Could not tell the server job ${data.job.jobId} is starting (${describeError(
        err,
      )}); running it anyway.`,
    );
    return true;
  }
}

/*
 * Run the step, or refuse it, and return what to report. Nothing here is
 * about delivering the result: whatever this returns is exactly what is
 * reported, however many attempts the delivery takes.
 */
async function runStep(data: {
  job: ClaimedJob;
  lease: JobLease;
}): Promise<ExecResult> {
  try {
    const prepared: PreparedStep = prepareStep(data.job);

    if (prepared.isRefused) {
      return {
        success: false,
        output: "",
        errorMessage: prepared.errorMessage,
      };
    }

    const isStillOurs: boolean = await markStepStarting(data);

    if (!isStillOurs) {
      return {
        success: false,
        output: "",
        errorMessage: NOT_RUN_LEASE_LOST_MESSAGE,
      };
    }

    return await prepared.run();
  } catch (err) {
    logger.error(`Executor error for job ${data.job.jobId}`);
    logger.error(err);

    return { success: false, output: "", errorMessage: describeError(err) };
  }
}

/*
 * Deliver a step's result, and keep delivering THAT result: a kubectl that
 * ran and whose first POST was lost must be recorded with its exit code and
 * output, never replaced by the transport error (a Failed row with neither
 * reads as "never ran" on the server).
 *
 * A send that got no answer, or a 5xx/408/429, is retried with exponential
 * backoff (getResultRetryDelayMs), up to RESULT_SUBMIT_MAX_ATTEMPTS, and
 * only while the lease is confirmed: after that the server times the job
 * out and no longer takes its result. Resending is safe, because the server
 * refuses a second result for a job that already has one. The server's
 * answer that it will not take the result (a 4xx, or accepted: false) ends
 * delivery.
 */
async function deliverResult(data: {
  job: ClaimedJob;
  result: ExecResult;
  lease: JobLease;
}): Promise<void> {
  const submission: {
    jobId: string;
    success: boolean;
    output?: string | undefined;
    exitCode?: number | undefined;
    errorMessage?: string | undefined;
  } = {
    jobId: data.job.jobId,
    success: data.result.success,
    ...(typeof data.result.output === "string"
      ? { output: data.result.output }
      : {}),
    ...(typeof data.result.exitCode === "number"
      ? { exitCode: data.result.exitCode }
      : {}),
    ...(typeof data.result.errorMessage === "string"
      ? { errorMessage: data.result.errorMessage }
      : {}),
  };

  for (
    let attempt: number = 1;
    attempt <= RESULT_SUBMIT_MAX_ATTEMPTS;
    attempt++
  ) {
    let failure: string;

    try {
      const isAccepted: boolean = await AgentClient.submitJobResult(submission);

      if (!isAccepted) {
        logger.error(
          `The server did not store the result of job ${data.job.jobId}: it answered that it will not take it (the job is no longer this Runner's, typically because its lease lapsed and it was timed out${
            attempt > 1
              ? ", or an earlier attempt that got no answer already stored it"
              : ""
          }).`,
        );
      }

      return;
    } catch (err) {
      failure = describeError(err);
    }

    if (attempt >= RESULT_SUBMIT_MAX_ATTEMPTS) {
      logger.error(
        `Could not deliver the result of job ${data.job.jobId} after ${attempt} attempts (last: ${failure}). The server will time the job out.`,
      );
      return;
    }

    const delayMs: number = getResultRetryDelayMs(attempt);

    if (
      data.lease.isLost ||
      Date.now() + delayMs >= data.lease.confirmedUntilMs
    ) {
      logger.error(
        `Could not deliver the result of job ${data.job.jobId} (attempt ${attempt}: ${failure}), and the lease on it ${
          data.lease.isLost ? "is gone" : "ends before another attempt"
        }. The server will time the job out.`,
      );
      return;
    }

    logger.warn(
      `Delivering the result of job ${data.job.jobId} failed (attempt ${attempt} of ${RESULT_SUBMIT_MAX_ATTEMPTS}: ${failure}); retrying in ${delayMs} ms.`,
    );

    await sleep(delayMs);
  }
}

export default class Executor {
  public static async executeAndReport(job: ClaimedJob): Promise<void> {
    const lease: JobLease = {
      confirmedUntilMs: Date.now() + JOB_LEASE_MS,
      isLost: false,
      isFinished: false,
    };

    /*
     * Refresh the lease in the background so a long-running script
     * doesn't get reclaimed by another agent or marked TimedOut by the
     * Worker. It keeps going while the result is being delivered, so a
     * retry is not cut short by a lease the Runner let lapse itself, and is
     * cleared in finally.
     */
    const heartbeatTimer: ReturnType<typeof setInterval> = setInterval(() => {
      renewLeaseInBackground({ job, lease });
    }, JOB_HEARTBEAT_INTERVAL_MS);

    try {
      logger.info(
        `Executing ${job.stepType} job ${job.jobId} (step ${job.stepId})`,
      );

      const result: ExecResult = await runStep({ job, lease });

      await deliverResult({ job, result, lease });
    } catch (err) {
      // runStep and deliverResult handle their own failures; this is a net.
      logger.error(`Executor error for job ${job.jobId}`);
      logger.error(err);
    } finally {
      lease.isFinished = true;
      clearInterval(heartbeatTimer);
    }
  }
}
