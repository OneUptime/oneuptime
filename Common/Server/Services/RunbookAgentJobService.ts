import DatabaseService from "./DatabaseService";
import ObjectID from "../../Types/ObjectID";
import BadDataException from "../../Types/Exception/BadDataException";
import Model from "../../Models/DatabaseModels/RunbookAgentJob";
import RunbookAgentJobStatus from "../../Types/Runbook/RunbookAgentJobStatus";
import RunbookStepType from "../../Types/Runbook/RunbookStepType";
import OneUptimeDate from "../../Types/Date";
import { JSONObject } from "../../Types/JSON";
import PostgresAppInstance from "../Infrastructure/PostgresDatabase";
import logger from "../Utils/Logger";
import Sleep from "../../Types/Sleep";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

/*
 * Lease the Worker grants on each successful claim. While the lease is fresh
 * the job belongs to that agent; once it elapses, another agent (or the
 * Worker's poll loop) can mark the job TimedOut.
 */
const DEFAULT_LEASE_MS: number = 30_000;
/*
 * If the agent's executor heartbeats faster than this, the Worker keeps
 * extending the lease. The agent should call the job heartbeat endpoint at
 * least once every (DEFAULT_LEASE_MS / 2) ms.
 */
const DEFAULT_CLAIM_TIMEOUT_MS: number = 2 * 60_000;

const POLL_INTERVAL_MS: number = 500;

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  public async enqueue(data: {
    projectId: ObjectID;
    runbookExecutionId: ObjectID;
    stepId: string;
    stepType: RunbookStepType;
    targetAgentId: ObjectID;
    script: string;
    timeoutInMs: number;
    claimTimeoutInMs?: number | undefined;
  }): Promise<Model> {
    if (!data.targetAgentId) {
      throw new BadDataException(
        "targetAgentId is required to dispatch a step to a Runbook Agent.",
      );
    }

    if (
      data.stepType !== RunbookStepType.Bash &&
      data.stepType !== RunbookStepType.JavaScript
    ) {
      throw new BadDataException(
        `RunbookAgent does not execute step type "${data.stepType}".`,
      );
    }

    const claimDeadlineAt: Date = OneUptimeDate.addRemoveSeconds(
      OneUptimeDate.getCurrentDate(),
      Math.ceil((data.claimTimeoutInMs ?? DEFAULT_CLAIM_TIMEOUT_MS) / 1000),
    );

    const row: Model = new Model();
    row.projectId = data.projectId;
    row.runbookExecutionId = data.runbookExecutionId;
    row.stepId = data.stepId;
    row.stepType = data.stepType;
    row.targetAgentId = data.targetAgentId;
    row.script = data.script;
    row.timeoutInMs = data.timeoutInMs;
    row.status = RunbookAgentJobStatus.Pending;
    row.claimDeadlineAt = claimDeadlineAt;

    return this.create({ data: row, props: { isRoot: true } });
  }

  /*
   * Atomically claim the oldest Pending job in the agent's project targeted
   * at this specific agent. Uses FOR UPDATE SKIP LOCKED so concurrent agents
   * don't fight over the same row.
   */
  @CaptureSpan()
  public async claimNextJob(data: {
    agentId: ObjectID;
    projectId: ObjectID;
    leaseMs?: number | undefined;
  }): Promise<Model | null> {
    const dataSource: ReturnType<typeof PostgresAppInstance.getDataSource> =
      PostgresAppInstance.getDataSource();

    if (!dataSource) {
      throw new BadDataException("Database is not connected");
    }

    const leaseMs: number = data.leaseMs ?? DEFAULT_LEASE_MS;

    const sql: string = `
      WITH claimed AS (
        SELECT "_id" FROM "RunbookAgentJob"
        WHERE "projectId" = $1::uuid
          AND "status" = $2
          AND "targetAgentId" = $3::uuid
          AND "claimDeadlineAt" > NOW()
          AND "deletedAt" IS NULL
        ORDER BY "createdAt" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      UPDATE "RunbookAgentJob" j
      SET "status" = $4,
          "assignedAgentId" = $3::uuid,
          "claimedAt" = NOW(),
          "leaseExpiresAt" = NOW() + ($5 || ' milliseconds')::interval,
          "updatedAt" = NOW(),
          "version" = j."version" + 1
      FROM claimed
      WHERE j."_id" = claimed."_id"
      RETURNING j."_id", j."projectId", j."runbookExecutionId",
                j."stepId", j."stepType", j."targetAgentId", j."script",
                j."timeoutInMs", j."status", j."claimedAt", j."leaseExpiresAt";
    `;

    const rows: Array<JSONObject> = await dataSource.query(sql, [
      data.projectId.toString(),
      RunbookAgentJobStatus.Pending,
      data.agentId.toString(),
      RunbookAgentJobStatus.Claimed,
      leaseMs.toString(),
    ]);

    if (!rows || rows.length === 0) {
      return null;
    }

    const r: JSONObject = rows[0]!;
    const job: Model = new Model();
    job._id = String(r["_id"]);
    job.projectId = new ObjectID(String(r["projectId"]));
    job.runbookExecutionId = new ObjectID(String(r["runbookExecutionId"]));
    job.stepId = String(r["stepId"]);
    job.stepType = r["stepType"] as RunbookStepType;
    job.targetAgentId = new ObjectID(String(r["targetAgentId"]));
    job.script = String(r["script"]);
    job.timeoutInMs = Number(r["timeoutInMs"]);
    job.status = r["status"] as RunbookAgentJobStatus;
    if (r["claimedAt"]) {
      job.claimedAt = new Date(String(r["claimedAt"]));
    }
    if (r["leaseExpiresAt"]) {
      job.leaseExpiresAt = new Date(String(r["leaseExpiresAt"]));
    }
    job.assignedAgentId = data.agentId;
    return job;
  }

  @CaptureSpan()
  public async heartbeatJob(data: {
    jobId: ObjectID;
    agentId: ObjectID;
    leaseMs?: number | undefined;
  }): Promise<boolean> {
    const dataSource: ReturnType<typeof PostgresAppInstance.getDataSource> =
      PostgresAppInstance.getDataSource();
    if (!dataSource) {
      throw new BadDataException("Database is not connected");
    }

    const leaseMs: number = data.leaseMs ?? DEFAULT_LEASE_MS;

    /*
     * Only refresh the lease if this agent still owns the job and it hasn't
     * reached a terminal state. If another agent reclaimed it, the agent
     * should stop executing.
     */
    const sql: string = `
      UPDATE "RunbookAgentJob"
      SET "status" = CASE WHEN "status" = $4 THEN $5 ELSE "status" END,
          "startedAt" = COALESCE("startedAt", NOW()),
          "leaseExpiresAt" = NOW() + ($1 || ' milliseconds')::interval,
          "updatedAt" = NOW(),
          "version" = "version" + 1
      WHERE "_id" = $2::uuid
        AND "assignedAgentId" = $3::uuid
        AND "status" IN ($4, $5)
      RETURNING "_id";
    `;
    const rows: Array<JSONObject> = await dataSource.query(sql, [
      leaseMs.toString(),
      data.jobId.toString(),
      data.agentId.toString(),
      RunbookAgentJobStatus.Claimed,
      RunbookAgentJobStatus.Running,
    ]);

    return rows.length > 0;
  }

  @CaptureSpan()
  public async submitResult(data: {
    jobId: ObjectID;
    agentId: ObjectID;
    success: boolean;
    output?: string | undefined;
    exitCode?: number | undefined;
    errorMessage?: string | undefined;
  }): Promise<boolean> {
    const dataSource: ReturnType<typeof PostgresAppInstance.getDataSource> =
      PostgresAppInstance.getDataSource();
    if (!dataSource) {
      throw new BadDataException("Database is not connected");
    }

    const status: RunbookAgentJobStatus = data.success
      ? RunbookAgentJobStatus.Succeeded
      : RunbookAgentJobStatus.Failed;

    /*
     * Only the agent that holds the lease is allowed to write the terminal
     * result. If the lease has already moved on (Worker timed out and
     * reclaimed), this is a no-op.
     */
    const sql: string = `
      UPDATE "RunbookAgentJob"
      SET "status" = $1,
          "output" = $2,
          "exitCode" = $3,
          "errorMessage" = $4,
          "completedAt" = NOW(),
          "updatedAt" = NOW(),
          "version" = "version" + 1
      WHERE "_id" = $5::uuid
        AND "assignedAgentId" = $6::uuid
        AND "status" IN ($7, $8)
      RETURNING "_id";
    `;
    const rows: Array<JSONObject> = await dataSource.query(sql, [
      status,
      data.output ?? null,
      data.exitCode ?? null,
      data.errorMessage ?? null,
      data.jobId.toString(),
      data.agentId.toString(),
      RunbookAgentJobStatus.Claimed,
      RunbookAgentJobStatus.Running,
    ]);

    return rows.length > 0;
  }

  /*
   * Called by the Worker after enqueueing. Polls the job row every
   * POLL_INTERVAL_MS until the job reaches a terminal status, or until the
   * combined claim + execution window is exhausted (in which case we mark
   * the job TimedOut ourselves and return it).
   */
  @CaptureSpan()
  public async pollUntilTerminal(data: {
    jobId: ObjectID;
    claimTimeoutInMs: number;
    executionTimeoutInMs: number;
  }): Promise<Model> {
    const overallDeadline: Date = OneUptimeDate.addRemoveSeconds(
      OneUptimeDate.getCurrentDate(),
      Math.ceil(
        (data.claimTimeoutInMs + data.executionTimeoutInMs + 5_000) / 1000,
      ),
    );

    while (true) {
      const job: Model | null = await this.findOneById({
        id: data.jobId,
        select: {
          _id: true,
          status: true,
          output: true,
          exitCode: true,
          errorMessage: true,
          claimDeadlineAt: true,
          leaseExpiresAt: true,
          claimedAt: true,
          startedAt: true,
          completedAt: true,
          assignedAgentId: true,
        },
        props: { isRoot: true },
      });

      if (!job) {
        throw new BadDataException(
          `RunbookAgentJob ${data.jobId.toString()} disappeared while waiting.`,
        );
      }

      if (
        job.status === RunbookAgentJobStatus.Succeeded ||
        job.status === RunbookAgentJobStatus.Failed ||
        job.status === RunbookAgentJobStatus.TimedOut ||
        job.status === RunbookAgentJobStatus.Cancelled
      ) {
        return job;
      }

      const now: Date = OneUptimeDate.getCurrentDate();

      // Pending with claim deadline elapsed -> no agent picked it up.
      if (
        job.status === RunbookAgentJobStatus.Pending &&
        job.claimDeadlineAt &&
        now > job.claimDeadlineAt
      ) {
        return this.timeoutJob({
          jobId: data.jobId,
          reason: `The selected Runbook Agent did not claim the job before the deadline (${job.claimDeadlineAt.toISOString()}). Make sure the agent is online.`,
        });
      }

      // Claimed/Running with lease elapsed -> agent went silent.
      if (
        (job.status === RunbookAgentJobStatus.Claimed ||
          job.status === RunbookAgentJobStatus.Running) &&
        job.leaseExpiresAt &&
        now > job.leaseExpiresAt
      ) {
        return this.timeoutJob({
          jobId: data.jobId,
          reason: `Runbook Agent stopped sending heartbeats after claiming the job. Lease expired at ${job.leaseExpiresAt.toISOString()}.`,
        });
      }

      if (now > overallDeadline) {
        return this.timeoutJob({
          jobId: data.jobId,
          reason:
            "Overall execution window exceeded while waiting for the agent.",
        });
      }

      await Sleep.sleep(POLL_INTERVAL_MS);
    }
  }

  @CaptureSpan()
  public async timeoutJob(data: {
    jobId: ObjectID;
    reason: string;
  }): Promise<Model> {
    const dataSource: ReturnType<typeof PostgresAppInstance.getDataSource> =
      PostgresAppInstance.getDataSource();
    if (!dataSource) {
      throw new BadDataException("Database is not connected");
    }

    /*
     * Move to TimedOut only if the job hasn't already reached a terminal
     * state. The same agent's late-arriving result must lose to this race.
     */
    const sql: string = `
      UPDATE "RunbookAgentJob"
      SET "status" = $1,
          "errorMessage" = $2,
          "completedAt" = NOW(),
          "updatedAt" = NOW(),
          "version" = "version" + 1
      WHERE "_id" = $3::uuid
        AND "status" NOT IN ($4, $5, $6, $7)
      RETURNING "_id";
    `;
    await dataSource.query(sql, [
      RunbookAgentJobStatus.TimedOut,
      data.reason,
      data.jobId.toString(),
      RunbookAgentJobStatus.Succeeded,
      RunbookAgentJobStatus.Failed,
      RunbookAgentJobStatus.TimedOut,
      RunbookAgentJobStatus.Cancelled,
    ]);

    const updated: Model | null = await this.findOneById({
      id: data.jobId,
      select: {
        _id: true,
        status: true,
        output: true,
        exitCode: true,
        errorMessage: true,
        completedAt: true,
      },
      props: { isRoot: true },
    });

    if (!updated) {
      throw new BadDataException(
        `RunbookAgentJob ${data.jobId.toString()} not found while timing out.`,
      );
    }

    return updated;
  }

  @CaptureSpan()
  public async cancelJobsForExecution(data: {
    runbookExecutionId: ObjectID;
  }): Promise<void> {
    const dataSource: ReturnType<typeof PostgresAppInstance.getDataSource> =
      PostgresAppInstance.getDataSource();
    if (!dataSource) {
      throw new BadDataException("Database is not connected");
    }
    try {
      await dataSource.query(
        `UPDATE "RunbookAgentJob"
         SET "status" = $1, "completedAt" = NOW(), "updatedAt" = NOW(), "version" = "version" + 1
         WHERE "runbookExecutionId" = $2::uuid
           AND "status" NOT IN ($3, $4, $5, $6)`,
        [
          RunbookAgentJobStatus.Cancelled,
          data.runbookExecutionId.toString(),
          RunbookAgentJobStatus.Succeeded,
          RunbookAgentJobStatus.Failed,
          RunbookAgentJobStatus.TimedOut,
          RunbookAgentJobStatus.Cancelled,
        ],
      );
    } catch (err) {
      logger.error("Failed to cancel RunbookAgentJobs for execution");
      logger.error(err);
    }
  }
}

export default new Service();
