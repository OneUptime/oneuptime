import axios, { AxiosInstance, AxiosResponse } from "axios";
import {
  RUNBOOK_AGENT_ID,
  RUNBOOK_AGENT_INGEST_URL,
  RUNBOOK_AGENT_KEY,
} from "../Config";
import { JSONObject } from "Common/Types/JSON";
import logger from "Common/Server/Utils/Logger";

export type ClaimedJobStepType = "Bash" | "JavaScript";

export interface ClaimedJob {
  jobId: string;
  runbookExecutionId: string;
  stepId: string;
  stepType: ClaimedJobStepType;
  script: string;
  timeoutInMs: number;
  leaseExpiresAt?: string | undefined;
}

const http: AxiosInstance = axios.create({
  baseURL: RUNBOOK_AGENT_INGEST_URL.toString(),
  timeout: 30_000,
  validateStatus: () => {
    return true;
  },
});

function authBody(extra: JSONObject = {}): JSONObject {
  return {
    agentId: RUNBOOK_AGENT_ID.toString(),
    agentKey: RUNBOOK_AGENT_KEY,
    ...extra,
  };
}

export default class AgentClient {
  public static async heartbeat(data: {
    agentVersion?: string | undefined;
    hostInfo?: JSONObject | undefined;
  }): Promise<boolean> {
    const res: AxiosResponse = await http.post(
      "/heartbeat",
      authBody({
        ...(data.agentVersion ? { agentVersion: data.agentVersion } : {}),
        ...(data.hostInfo ? { hostInfo: data.hostInfo } : {}),
      }),
    );
    if (res.status >= 200 && res.status < 300) {
      return true;
    }
    logger.error(
      `Heartbeat rejected (${res.status}): ${JSON.stringify(res.data)}`,
    );
    return false;
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
