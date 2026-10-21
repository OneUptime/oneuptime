import PostgresAppInstance from "../Infrastructure/PostgresDatabase";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import RunnerJob from "../../Models/DatabaseModels/RunnerJob";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import RunbookStepType from "../../Types/Runbook/RunbookStepType";
import RunnerJobOrigin, {
  AI_COMMAND_JOB_ORIGINS,
} from "../../Types/Runbook/RunnerJobOrigin";
import RunnerJobStatus from "../../Types/Runbook/RunnerJobStatus";

/*
 * The lease a claim grants: the same as a Runner's (RunnerJobService's
 * DEFAULT_LEASE_MS), because the job heartbeat and result a claim leads to
 * go through RunnerJobService unchanged. The agent heartbeats the job every
 * 10 seconds while it runs; if it goes quiet for this long, the job times
 * out as lease_expired.
 */
export const KUBERNETES_AI_AGENT_JOB_LEASE_MS: number = 30_000;

/*
 * dataSource.query answers with rows for a SELECT and with [rows, affected]
 * for an UPDATE ... RETURNING, depending on the driver path. Accept both.
 * (The same helper RunnerJobService keeps privately.)
 */
function unwrapRows(result: unknown): Array<JSONObject> {
  if (Array.isArray(result)) {
    if (
      result.length === 2 &&
      Array.isArray(result[0]) &&
      typeof result[1] === "number"
    ) {
      return result[0] as Array<JSONObject>;
    }

    return result as Array<JSONObject>;
  }

  return [];
}

/*
 * The Kubernetes AI agent's side of the kubectl job queue.
 *
 * The agent is not a Runner, but its work is ordinary RunnerJob rows — the
 * lease, heartbeat, result, redaction and history all stay RunnerJob's. The
 * one thing that differs is WHICH rows it may claim: only kubectl jobs an AI
 * run composed (AI_COMMAND_JOB_ORIGINS) that the enqueue chokepoint targeted
 * at this agent (RunnerJob.targetKubernetesAiAgentId). A runbook step, a
 * Bash or SSH command, or a job for any other target can never be leased by
 * the agent pod, whatever it asks for.
 *
 * A claim writes the agent's id into assignedAgentId (a column without a
 * foreign key), so RunnerJobService.heartbeatJob and submitResult — which
 * key on it — serve the agent exactly as they serve a Runner.
 */
export class Service {
  /*
   * Atomically claim the oldest pending kubectl job targeted at this agent,
   * in its project: FOR UPDATE SKIP LOCKED, so two claims (a restarted pod
   * overlapping its predecessor) never lease the same row.
   */
  @CaptureSpan()
  public async claimNextJob(data: {
    projectId: ObjectID;
    kubernetesAiAgentId: ObjectID;
    leaseMs?: number | undefined;
  }): Promise<RunnerJob | null> {
    const dataSource: ReturnType<typeof PostgresAppInstance.getDataSource> =
      PostgresAppInstance.getDataSource();

    if (!dataSource) {
      throw new BadDataException("Database is not connected");
    }

    const leaseMs: number = data.leaseMs ?? KUBERNETES_AI_AGENT_JOB_LEASE_MS;

    const sql: string = `
      WITH claimed AS (
        SELECT "_id" FROM "RunnerJob"
        WHERE "projectId" = $1::uuid
          AND "status" = $2
          AND "targetKubernetesAiAgentId" = $3::uuid
          AND "stepType" = $6
          AND "origin" = ANY($7::text[])
          AND "claimDeadlineAt" > NOW()
          AND "deletedAt" IS NULL
        ORDER BY "createdAt" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      UPDATE "RunnerJob" j
      SET "status" = $4,
          "assignedAgentId" = $3::uuid,
          "claimedAt" = NOW(),
          "leaseExpiresAt" = NOW() + ($5 || ' milliseconds')::interval,
          "updatedAt" = NOW(),
          "version" = j."version" + 1
      FROM claimed
      WHERE j."_id" = claimed."_id"
      RETURNING j."_id", j."projectId", j."origin", j."aiRunId",
                j."autoRemediationSuggestionId", j."kubernetesClusterId",
                j."stepId", j."stepType", j."targetKubernetesAiAgentId",
                j."payload", j."timeoutInMs", j."status", j."claimedAt",
                j."leaseExpiresAt";
    `;

    const rows: Array<JSONObject> = unwrapRows(
      await dataSource.query(sql, [
        data.projectId.toString(),
        RunnerJobStatus.Pending,
        data.kubernetesAiAgentId.toString(),
        RunnerJobStatus.Claimed,
        leaseMs.toString(),
        RunbookStepType.Kubectl,
        AI_COMMAND_JOB_ORIGINS,
      ]),
    );

    if (!rows || rows.length === 0) {
      return null;
    }

    return Service.toClaimedJob({
      row: rows[0]!,
      kubernetesAiAgentId: data.kubernetesAiAgentId,
    });
  }

  // The claimed row as a RunnerJob, the way RunnerJobService.claimNextJob builds it.
  public static toClaimedJob(data: {
    row: JSONObject;
    kubernetesAiAgentId: ObjectID;
  }): RunnerJob {
    const r: JSONObject = data.row;
    const job: RunnerJob = new RunnerJob();

    job._id = String(r["_id"]);
    job.projectId = new ObjectID(String(r["projectId"]));
    job.origin =
      (r["origin"] as RunnerJobOrigin) || RunnerJobOrigin.AiInvestigation;

    if (r["aiRunId"]) {
      job.aiRunId = new ObjectID(String(r["aiRunId"]));
    }

    if (r["autoRemediationSuggestionId"]) {
      job.autoRemediationSuggestionId = new ObjectID(
        String(r["autoRemediationSuggestionId"]),
      );
    }

    if (r["kubernetesClusterId"]) {
      job.kubernetesClusterId = new ObjectID(String(r["kubernetesClusterId"]));
    }

    job.stepId = String(r["stepId"]);
    job.stepType = r["stepType"] as RunbookStepType;
    job.targetKubernetesAiAgentId = new ObjectID(
      String(r["targetKubernetesAiAgentId"] || data.kubernetesAiAgentId),
    );

    if (r["payload"] && typeof r["payload"] === "object") {
      job.payload = r["payload"] as JSONObject;
    }

    job.timeoutInMs = Number(r["timeoutInMs"]);
    job.status = r["status"] as RunnerJobStatus;

    if (r["claimedAt"]) {
      job.claimedAt = new Date(String(r["claimedAt"]));
    }

    if (r["leaseExpiresAt"]) {
      job.leaseExpiresAt = new Date(String(r["leaseExpiresAt"]));
    }

    job.assignedAgentId = data.kubernetesAiAgentId;

    return job;
  }
}

export default new Service();
