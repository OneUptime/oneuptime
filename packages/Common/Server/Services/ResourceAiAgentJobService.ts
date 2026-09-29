import PostgresAppInstance from "../Infrastructure/PostgresDatabase";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import RunnerJob from "../../Models/DatabaseModels/RunnerJob";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import { isAiResourceType } from "../../Types/ResourceAiAgent/AiResourceType";
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
export const RESOURCE_AI_AGENT_JOB_LEASE_MS: number = 30_000;

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
 * The resource AI agent's side of the command job queue.
 *
 * The agent is not a Runner, but its work is ordinary RunnerJob rows — the
 * lease, heartbeat, result, redaction and history all stay RunnerJob's. The
 * one thing that differs is WHICH rows it may claim: only ResourceCommand
 * jobs an AI run composed (AI_COMMAND_JOB_ORIGINS) that the enqueue
 * chokepoint (RunnerJobService.enqueueAiResourceCommand) targeted at this
 * agent (RunnerJob.targetResourceAiAgentId). A runbook step, a Bash, SSH or
 * kubectl command, or a job for any other target can never be leased by the
 * agent, whatever it asks for.
 *
 * A claim writes the agent's id into assignedAgentId (a column without a
 * foreign key), so RunnerJobService.heartbeatJob and submitResult — which
 * key on it — serve the agent exactly as they serve a Runner.
 */
export class Service {
  /*
   * Atomically claim the oldest pending resource command targeted at this
   * agent, in its project: FOR UPDATE SKIP LOCKED, so two claims (a
   * restarted container overlapping its predecessor) never lease the same
   * row.
   */
  @CaptureSpan()
  public async claimNextJob(data: {
    projectId: ObjectID;
    resourceAiAgentId: ObjectID;
    leaseMs?: number | undefined;
  }): Promise<RunnerJob | null> {
    const dataSource: ReturnType<typeof PostgresAppInstance.getDataSource> =
      PostgresAppInstance.getDataSource();

    if (!dataSource) {
      throw new BadDataException("Database is not connected");
    }

    const leaseMs: number = data.leaseMs ?? RESOURCE_AI_AGENT_JOB_LEASE_MS;

    const sql: string = `
      WITH claimed AS (
        SELECT "_id" FROM "RunnerJob"
        WHERE "projectId" = $1::uuid
          AND "status" = $2
          AND "targetResourceAiAgentId" = $3::uuid
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
                j."resourceType", j."resourceId",
                j."stepId", j."stepType", j."targetResourceAiAgentId",
                j."payload", j."timeoutInMs", j."status", j."claimedAt",
                j."leaseExpiresAt";
    `;

    const rows: Array<JSONObject> = unwrapRows(
      await dataSource.query(sql, [
        data.projectId.toString(),
        RunnerJobStatus.Pending,
        data.resourceAiAgentId.toString(),
        RunnerJobStatus.Claimed,
        leaseMs.toString(),
        RunbookStepType.ResourceCommand,
        AI_COMMAND_JOB_ORIGINS,
      ]),
    );

    if (!rows || rows.length === 0) {
      return null;
    }

    return Service.toClaimedJob({
      row: rows[0]!,
      resourceAiAgentId: data.resourceAiAgentId,
    });
  }

  /*
   * The claimed row as a RunnerJob, the way RunnerJobService.claimNextJob
   * builds it. The row's resource columns are carried as read (a stored
   * type this build does not know is left out), so the ingress can check
   * them against the agent before serving the job.
   */
  public static toClaimedJob(data: {
    row: JSONObject;
    resourceAiAgentId: ObjectID;
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

    if (isAiResourceType(r["resourceType"])) {
      job.resourceType = r["resourceType"];
    }

    if (r["resourceId"]) {
      job.resourceId = new ObjectID(String(r["resourceId"]));
    }

    job.stepId = String(r["stepId"]);
    job.stepType = r["stepType"] as RunbookStepType;
    job.targetResourceAiAgentId = new ObjectID(
      String(r["targetResourceAiAgentId"] || data.resourceAiAgentId),
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

    job.assignedAgentId = data.resourceAiAgentId;

    return job;
  }
}

export default new Service();
