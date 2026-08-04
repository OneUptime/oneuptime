import axios, { AxiosInstance, AxiosResponse } from "axios";
import { RUNNER_INGEST_URL, RUNNER_KEY } from "../Config";
import RunnerIdentity from "../Utils/RunnerIdentity";
import { JSONObject } from "Common/Types/JSON";
import logger from "Common/Server/Utils/Logger";

export type ClaimedJobStepType = "Bash" | "JavaScript" | "SSH" | "Kubernetes";

export interface ClaimedJob {
  jobId: string;
  /*
   * Absent for AI-composed command jobs (origin "AiRemediation"), which have
   * no parent runbook execution.
   */
  runbookExecutionId?: string | undefined;
  /*
   * "Runbook" (default when the server predates the field) or
   * "AiRemediation". The executor re-checks the local AI-commands capability
   * and command policy for AiRemediation jobs before running anything.
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
 * the id is assigned by the server during registration, so it is not known
 * at module-load time.
 */
function authBody(extra: JSONObject = {}): JSONObject {
  return {
    agentId: RunnerIdentity.getRunnerId().toString(),
    agentKey: RUNNER_KEY,
    ...extra,
  };
}

export interface HeartbeatResult {
  ok: boolean;
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
    return { ok: false };
  }

  public static async claimNextJob(): Promise<ClaimedJob | null> {
    const res: AxiosResponse = await http.post("/claim-next-job", authBody());
    if (res.status >= 200 && res.status < 300) {
      const job: ClaimedJob | null | undefined = (res.data as JSONObject)?.[
        "job"
      ] as ClaimedJob | null | undefined;
      return job ?? null;
    }
    logger.error(
      `claim-next-job rejected (${res.status}): ${JSON.stringify(res.data)}`,
    );
    return null;
  }

  public static async jobHeartbeat(jobId: string): Promise<boolean> {
    const res: AxiosResponse = await http.post(
      `/job/${encodeURIComponent(jobId)}/heartbeat`,
      authBody(),
    );
    return res.status >= 200 && res.status < 300;
  }

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
      return true;
    }
    logger.error(
      `submit-job-result rejected (${res.status}): ${JSON.stringify(res.data)}`,
    );
    return false;
  }
}
