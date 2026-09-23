import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from "axios";
import { RUNNER_INGEST_URL } from "../Config";
import RunnerIdentity from "../Utils/RunnerIdentity";
import KubernetesAgentMode from "../Utils/KubernetesAgentMode";
import { JSONObject } from "Common/Types/JSON";
import logger from "Common/Server/Utils/Logger";

export type ClaimedJobStepType =
  | "Bash"
  | "JavaScript"
  | "SSH"
  | "Kubernetes"
  | "Kubectl";

export interface ClaimedJob {
  jobId: string;
  /*
   * Absent for AI-composed command jobs (origin "AiRemediation"), which have
   * no parent runbook execution.
   */
  runbookExecutionId?: string | undefined;
  /*
   * "Runbook" (default when the server predates the field), "AiRemediation"
   * or "AiInvestigation". The executor re-checks the local AI-commands
   * capability and command policy for AI-origin jobs before running
   * anything; an AiInvestigation job may only ever be read-only kubectl.
   */
  origin?: string | undefined;
  stepId: string;
  stepType: ClaimedJobStepType;
  script: string;
  timeoutInMs: number;
  leaseExpiresAt?: string | undefined;
  /*
   * Structured instructions for step types that are not a script, and the
   * credential the server resolved for this Runner. Present together or not
   * at all.
   */
  payload?: JSONObject | undefined;
  credential?: JSONObject | undefined;
}

const http: AxiosInstance = axios.create({
  baseURL: RUNNER_INGEST_URL.toString(),
  timeout: 30_000,
  validateStatus: () => {
    return true;
  },
});

/*
 * Identity comes from RunnerIdentity, not the raw config: in cluster scope
 * the id is assigned by the server during registration, and in
 * kubernetes-agent mode both the id and the key are — so neither is known
 * at module-load time.
 */
function authBody(extra: JSONObject = {}): JSONObject {
  return {
    agentId: RunnerIdentity.getRunnerId().toString(),
    agentKey: RunnerIdentity.getRunnerKey(),
    ...extra,
  };
}

/*
 * Statuses that say "not now" rather than "no": the server (or a proxy in
 * front of it) could not handle the request at the moment. A 5xx, a request
 * timeout and a rate limit are worth sending again. Every other 4xx is the
 * server's answer about this request, and repeating it gets the same answer.
 */
export function isRetryableIngestStatus(statusCode: number): boolean {
  return statusCode >= 500 || statusCode === 408 || statusCode === 429;
}

/*
 * A job heartbeat or result the server could not take right now (see
 * isRetryableIngestStatus). It may not have reached the server, so what it
 * carried may still be unrecorded, and sending it again is safe: a result
 * the server did store is refused the second time (the job is no longer
 * running) rather than stored twice. axios raises its own errors for a
 * request that got no answer at all (refused, reset, timed out); those mean
 * the same.
 */
export class RunnerIngestUnavailableError extends Error {
  // A proxy's error page can be long; the message keeps the start of it.
  public static readonly MAX_BODY_CHARS: number = 300;

  public readonly statusCode: number;

  public constructor(data: {
    request: string;
    statusCode: number;
    body: unknown;
  }) {
    const body: string = JSON.stringify(data.body ?? null) ?? "null";

    super(
      `${data.request} failed with HTTP ${data.statusCode}: ${
        body.length > RunnerIngestUnavailableError.MAX_BODY_CHARS
          ? `${body.slice(0, RunnerIngestUnavailableError.MAX_BODY_CHARS)}…`
          : body
      }`,
    );
    this.name = "RunnerIngestUnavailableError";
    this.statusCode = data.statusCode;
  }
}

export interface HeartbeatResult {
  ok: boolean;
  /*
   * The HTTP status the server answered with. The heartbeat loop needs it
   * to tell a rejected credential (400/401/403 — worth re-registering for)
   * from a server that is merely unwell (5xx — not the key's fault, and
   * rotating it would only add churn to an outage).
   */
  statusCode?: number | undefined;
  /*
   * What the project currently grants this Runner. Absent when the server
   * predates capability reporting, in which case the caller keeps whatever it
   * resolved at boot.
   */
  capabilities?:
    | {
        canRunRunbooks: boolean;
        canRunCodeFixTasks: boolean;
        canRunAiCommands: boolean;
      }
    | undefined;
}

export default class AgentClient {
  public static async heartbeat(data: {
    agentVersion?: string | undefined;
    hostInfo?: JSONObject | undefined;
  }): Promise<HeartbeatResult> {
    const res: AxiosResponse = await http.post(
      "/heartbeat",
      authBody({
        ...(data.agentVersion ? { agentVersion: data.agentVersion } : {}),
        ...(data.hostInfo ? { hostInfo: data.hostInfo } : {}),
      }),
    );
    if (res.status >= 200 && res.status < 300) {
      const payload: JSONObject | undefined = (res.data as JSONObject)?.[
        "capabilities"
      ] as JSONObject | undefined;

      return {
        ok: true,
        statusCode: res.status,
        ...(payload
          ? {
              capabilities: {
                canRunRunbooks: payload["canRunRunbooks"] !== false,
                canRunCodeFixTasks: payload["canRunCodeFixTasks"] === true,
                canRunAiCommands: payload["canRunAiCommands"] === true,
              },
            }
          : {}),
      };
    }
    logger.error(
      `Heartbeat rejected (${res.status}): ${JSON.stringify(res.data)}`,
    );
    return { ok: false, statusCode: res.status };
  }

  /*
   * Claim the next job targeted at this Runner.
   *
   * The kubernetes-agent Runner asks only for Kubectl steps (`stepTypes`),
   * and a server that honours the filter never hands it anything else. A
   * server that predates the filter may still return a Bash, SSH,
   * JavaScript or Kubernetes job — that job is refused right here, at claim
   * time, before it can reach an executor: it is failed with the reason so
   * it does not sit until its lease lapses and get re-claimed in a loop,
   * and the caller sees no job.
   */
  public static async claimNextJob(): Promise<ClaimedJob | null> {
    const res: AxiosResponse = await http.post(
      "/claim-next-job",
      authBody(
        KubernetesAgentMode.isActive()
          ? { stepTypes: [...KubernetesAgentMode.allowedStepTypes] }
          : {},
      ),
    );
    if (res.status >= 200 && res.status < 300) {
      const job: ClaimedJob | null | undefined = (res.data as JSONObject)?.[
        "job"
      ] as ClaimedJob | null | undefined;

      if (!job) {
        return null;
      }

      const agentRefusal: string | null =
        KubernetesAgentMode.getStepTypeRefusal(job.stepType);

      if (agentRefusal) {
        logger.warn(
          `Refusing claimed ${String(job.stepType)} job ${job.jobId} at claim time: ${agentRefusal}`,
        );

        /*
         * Best effort. If the refusal does not land, the job is still not
         * run: the server times it out once its lease lapses.
         */
        try {
          await AgentClient.submitJobResult({
            jobId: job.jobId,
            success: false,
            errorMessage: agentRefusal,
          });
        } catch (err) {
          logger.warn(
            `Could not report the claim-time refusal of job ${job.jobId}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }

        return null;
      }

      return job;
    }
    logger.error(
      `claim-next-job rejected (${res.status}): ${JSON.stringify(res.data)}`,
    );
    return null;
  }

  /*
   * Sign off on a clean shutdown. The server marks this Runner offline the
   * moment it says so instead of when its last heartbeat ages out — which
   * is what lets the kubernetes-agent Runner's replacement pod register
   * (and take over the key) immediately after a rolling restart rather
   * than after the alive window. Best effort: an older server answers 404
   * and the replacement simply waits the window out.
   */
  public static async disconnect(): Promise<boolean> {
    const res: AxiosResponse = await http.post("/disconnect", authBody());
    if (res.status >= 200 && res.status < 300) {
      return true;
    }
    logger.warn(
      `disconnect rejected (${res.status}): ${JSON.stringify(res.data)}`,
    );
    return false;
  }

  /*
   * Renew this Runner's lease on a job. The server's first heartbeat for a
   * job also records when it started (startedAt) and marks it Running.
   *
   * Resolves true when the server renewed the lease, and false when it
   * answered that the job is no longer this Runner's: its lease lapsed and
   * it was timed out, it already has a result, or the request was refused
   * (404 and every other 4xx but 408/429). Rejects when the heartbeat may
   * not have reached the server (no answer, or a status
   * isRetryableIngestStatus accepts); whether the lease was renewed is then
   * unknown.
   *
   * `timeoutInMs` bounds this one request, for a caller that must not wait
   * the client's default 30 s on a server that does not answer.
   */
  public static async jobHeartbeat(
    jobId: string,
    options?: { timeoutInMs?: number | undefined } | undefined,
  ): Promise<boolean> {
    const requestConfig: AxiosRequestConfig | undefined = options?.timeoutInMs
      ? { timeout: options.timeoutInMs }
      : undefined;

    const res: AxiosResponse = await http.post(
      `/job/${encodeURIComponent(jobId)}/heartbeat`,
      authBody(),
      requestConfig,
    );

    if (res.status >= 200 && res.status < 300) {
      return true;
    }

    if (isRetryableIngestStatus(res.status)) {
      throw new RunnerIngestUnavailableError({
        request: `Job heartbeat for ${jobId}`,
        statusCode: res.status,
        body: res.data,
      });
    }

    return false;
  }

  /*
   * Report a job's result.
   *
   * Resolves true when the server stored it, and false when the server
   * answered and will not store it: `{ accepted: false }` (the job is no
   * longer this Runner's, or already has a result) or a 4xx other than
   * 408/429. Rejects when the result may not have reached the server (no
   * answer, or a status isRetryableIngestStatus accepts): it may then be
   * unrecorded, and sending it again is safe (a second copy of a result the
   * server did store is refused, not stored twice).
   */
  public static async submitJobResult(data: {
    jobId: string;
    success: boolean;
    output?: string | undefined;
    exitCode?: number | undefined;
    errorMessage?: string | undefined;
  }): Promise<boolean> {
    const res: AxiosResponse = await http.post(
      `/job/${encodeURIComponent(data.jobId)}/result`,
      authBody({
        success: data.success,
        ...(typeof data.output === "string" ? { output: data.output } : {}),
        ...(typeof data.exitCode === "number"
          ? { exitCode: data.exitCode }
          : {}),
        ...(typeof data.errorMessage === "string"
          ? { errorMessage: data.errorMessage }
          : {}),
      }),
    );

    if (res.status >= 200 && res.status < 300) {
      /*
       * The server answers 200 whether or not it stored the result and says
       * which in `accepted`. A body without the field is read as stored.
       */
      return (res.data as JSONObject | undefined)?.["accepted"] !== false;
    }

    if (isRetryableIngestStatus(res.status)) {
      throw new RunnerIngestUnavailableError({
        request: `Result for job ${data.jobId}`,
        statusCode: res.status,
        body: res.data,
      });
    }

    logger.error(
      `submit-job-result rejected (${res.status}): ${JSON.stringify(res.data)}`,
    );
    return false;
  }
}
