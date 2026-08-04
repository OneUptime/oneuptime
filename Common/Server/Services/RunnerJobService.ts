import DatabaseService from "./DatabaseService";
import ObjectID from "../../Types/ObjectID";
import BadDataException from "../../Types/Exception/BadDataException";
import Model from "../../Models/DatabaseModels/RunnerJob";
import RunnerJobStatus from "../../Types/Runbook/RunnerJobStatus";
import RunnerJobOrigin from "../../Types/Runbook/RunnerJobOrigin";
import RunbookStepType, {
  isRunnerExecutedStepType,
} from "../../Types/Runbook/RunbookStepType";
import { AI_COMMAND_STEP_TYPES } from "../../Types/AutoRemediation/AiRemediationCommandPlan";
import CommandPolicy from "../../Utils/AiRemediation/CommandPolicy";
import QueryHelper from "../Types/Database/QueryHelper";

/*
 * Project-wide hourly ceiling on AI-composed command jobs, counted on the
 * RunnerJob rows themselves so every path (FullAuto inline execution,
 * approved plans, rollbacks) shares one brake.
 */
export const MAX_AI_COMMAND_JOBS_PER_PROJECT_PER_HOUR: number = 30;
import SortOrder from "../../Types/BaseDatabase/SortOrder";
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

/*
 * A job in one of these states will never change again, so its row is a
 * durable record of what the step did. Everything else is still in flight and
 * can be waited on.
 */
const TERMINAL_STATUSES: Array<RunnerJobStatus> = [
  RunnerJobStatus.Succeeded,
  RunnerJobStatus.Failed,
  RunnerJobStatus.TimedOut,
  RunnerJobStatus.Cancelled,
];

export function isTerminalAgentJobStatus(
  status: RunnerJobStatus | undefined,
): boolean {
  return Boolean(status && TERMINAL_STATUSES.includes(status));
}

/*
 * TypeORM's dataSource.query returns `[rows, rowCount]` for UPDATE/DELETE
 * (even with RETURNING), and just `rows` for SELECT/INSERT. This helper
 * normalises the response so callers always see the rows array.
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
    payload?: JSONObject | undefined;
  }): Promise<Model> {
    if (!data.targetAgentId) {
      throw new BadDataException(
        "targetAgentId is required to dispatch a step to a Runner.",
      );
    }

    if (!isRunnerExecutedStepType(data.stepType)) {
      throw new BadDataException(
        `Runner does not execute step type "${data.stepType}".`,
      );
    }

    const claimDeadlineAt: Date = OneUptimeDate.addRemoveSeconds(
      OneUptimeDate.getCurrentDate(),
      Math.ceil((data.claimTimeoutInMs ?? DEFAULT_CLAIM_TIMEOUT_MS) / 1000),
    );

    const row: Model = new Model();
    row.projectId = data.projectId;
    row.runbookExecutionId = data.runbookExecutionId;
    row.origin = RunnerJobOrigin.Runbook;
    row.stepId = data.stepId;
    row.stepType = data.stepType;
    row.targetAgentId = data.targetAgentId;
    row.script = data.script;
    if (data.payload) {
      row.payload = data.payload;
    }
    row.timeoutInMs = data.timeoutInMs;
    row.status = RunnerJobStatus.Pending;
    row.claimDeadlineAt = claimDeadlineAt;

    return this.create({ data: row, props: { isRoot: true } });
  }

  /*
   * Enqueue an ad-hoc AI-composed command as an AiRemediation-origin job.
   * This is a server-side chokepoint on the path an LLM's output takes to a
   * shell, so it re-validates what the tool layer already checked: step
   * type and the hard command denylist. The claim path then only serves
   * these jobs to Runners whose canRunAiCommands capability is on.
   */
  @CaptureSpan()
  public async enqueueAiCommand(data: {
    projectId: ObjectID;
    aiRunId: ObjectID;
    autoRemediationSuggestionId: ObjectID;
    stepId: string;
    stepType: RunbookStepType;
    targetAgentId: ObjectID;
    command: string;
    credentialId?: string | undefined;
    timeoutInMs: number;
    claimTimeoutInMs?: number | undefined;
  }): Promise<Model> {
    if (!data.targetAgentId) {
      throw new BadDataException(
        "targetAgentId is required to dispatch a command to a Runner.",
      );
    }

    if (!AI_COMMAND_STEP_TYPES.includes(data.stepType)) {
      throw new BadDataException(
        `AI remediation does not execute step type "${data.stepType}".`,
      );
    }

    const command: string = (data.command || "").trim();
    if (!command) {
      throw new BadDataException("An AI command job needs a command.");
    }

    const denyReason: string | null = CommandPolicy.getDenyReason(command);
    if (denyReason) {
      throw new BadDataException(
        `Denied by the remediation command policy: ${denyReason}.`,
      );
    }

    if (data.stepType === RunbookStepType.SSH && !data.credentialId) {
      throw new BadDataException("An SSH command job needs a credentialId.");
    }

    /*
     * Project-wide hourly storm brake for the whole AI-command lane. It
     * lives HERE, at the single enqueue chokepoint, so it also bounds the
     * approved-plan and rollback paths — not just the FullAuto inline tool
     * that has its own pre-check for a friendlier message to the model.
     * Check-then-act, so a burst of concurrent runs can overshoot slightly;
     * the cap is a storm brake, not a quota.
     */
    const jobsInLastHour: number = (
      await this.countBy({
        query: {
          projectId: data.projectId,
          origin: RunnerJobOrigin.AiRemediation,
          createdAt: QueryHelper.greaterThan(OneUptimeDate.getSomeHoursAgo(1)),
        },
        props: { isRoot: true },
      })
    ).toNumber();

    if (jobsInLastHour >= MAX_AI_COMMAND_JOBS_PER_PROJECT_PER_HOUR) {
      throw new BadDataException(
        `This project has run ${jobsInLastHour} AI remediation commands in the last hour, which is its limit (${MAX_AI_COMMAND_JOBS_PER_PROJECT_PER_HOUR}). No further AI commands can run this hour.`,
      );
    }

    const claimDeadlineAt: Date = OneUptimeDate.addRemoveSeconds(
      OneUptimeDate.getCurrentDate(),
      Math.ceil((data.claimTimeoutInMs ?? DEFAULT_CLAIM_TIMEOUT_MS) / 1000),
    );

    const row: Model = new Model();
    row.projectId = data.projectId;
    row.origin = RunnerJobOrigin.AiRemediation;
    row.aiRunId = data.aiRunId;
    row.autoRemediationSuggestionId = data.autoRemediationSuggestionId;
    row.stepId = data.stepId;
    row.stepType = data.stepType;
    row.targetAgentId = data.targetAgentId;
    /*
     * Same layout the runbook step executors use: Bash carries the command
     * as the script; SSH carries an empty script plus structured payload,
     * and the credential is resolved at claim time — never stored here.
     */
    if (data.stepType === RunbookStepType.Bash) {
      row.script = command;
    } else {
      row.script = "";
      row.payload = {
        credentialId: data.credentialId as string,
        command: command,
      };
    }
    row.timeoutInMs = data.timeoutInMs;
    row.status = RunnerJobStatus.Pending;
    row.claimDeadlineAt = claimDeadlineAt;

    return this.create({ data: row, props: { isRoot: true } });
  }

  /*
   * The job this (execution, step) pair already produced, if any.
   *
   * A runbook execution runs inside a single BullMQ job, so a Worker restart
   * mid-step means the execution is re-delivered and RunRunbook walks back to
   * the same step — which is still persisted as Running. Without this lookup
   * the step would be dispatched a second time and the agent would run the
   * script again. The dispatcher calls this first: a terminal row is the
   * step's result, a live row is something to re-attach to.
   *
   * A step is dispatched at most once per execution, so the newest row is the
   * only one there can be; ordering is belt-and-braces against a torn write
   * from a previous release.
   */
  @CaptureSpan()
  public async findLatestJobForStep(data: {
    runbookExecutionId: ObjectID;
    stepId: string;
  }): Promise<Model | null> {
    const jobs: Array<Model> = await this.findBy({
      query: {
        runbookExecutionId: data.runbookExecutionId,
        stepId: data.stepId,
      },
      select: {
        _id: true,
        status: true,
        output: true,
        exitCode: true,
        errorMessage: true,
        createdAt: true,
      },
      sort: { createdAt: SortOrder.Descending },
      limit: 1,
      skip: 0,
      props: { isRoot: true },
    });

    return jobs[0] || null;
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
    /*
     * Which job origins this Runner's capabilities entitle it to claim.
     * Defaults to runbook jobs only — the AiRemediation origin must be
     * asked for explicitly by the ingress after checking canRunAiCommands.
     */
    allowedOrigins?: Array<RunnerJobOrigin> | undefined;
  }): Promise<Model | null> {
    const dataSource: ReturnType<typeof PostgresAppInstance.getDataSource> =
      PostgresAppInstance.getDataSource();

    if (!dataSource) {
      throw new BadDataException("Database is not connected");
    }

    const leaseMs: number = data.leaseMs ?? DEFAULT_LEASE_MS;

    const allowedOrigins: Array<RunnerJobOrigin> =
      data.allowedOrigins && data.allowedOrigins.length > 0
        ? data.allowedOrigins
        : [RunnerJobOrigin.Runbook];

    const sql: string = `
      WITH claimed AS (
        SELECT "_id" FROM "RunnerJob"
        WHERE "projectId" = $1::uuid
          AND "status" = $2
          AND "targetAgentId" = $3::uuid
          AND "origin" = ANY($6::text[])
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
      RETURNING j."_id", j."projectId", j."runbookExecutionId", j."origin",
                j."aiRunId", j."autoRemediationSuggestionId",
                j."stepId", j."stepType", j."targetAgentId", j."script",
                j."payload", j."timeoutInMs", j."status", j."claimedAt",
                j."leaseExpiresAt";
    `;

    const rows: Array<JSONObject> = unwrapRows(
      await dataSource.query(sql, [
        data.projectId.toString(),
        RunnerJobStatus.Pending,
        data.agentId.toString(),
        RunnerJobStatus.Claimed,
        leaseMs.toString(),
        allowedOrigins,
      ]),
    );

    if (!rows || rows.length === 0) {
      return null;
    }

    const r: JSONObject = rows[0]!;
    const job: Model = new Model();
    job._id = String(r["_id"]);
    job.projectId = new ObjectID(String(r["projectId"]));
    if (r["runbookExecutionId"]) {
      job.runbookExecutionId = new ObjectID(String(r["runbookExecutionId"]));
    }
    job.origin = (r["origin"] as RunnerJobOrigin) || RunnerJobOrigin.Runbook;
    if (r["aiRunId"]) {
      job.aiRunId = new ObjectID(String(r["aiRunId"]));
    }
    if (r["autoRemediationSuggestionId"]) {
      job.autoRemediationSuggestionId = new ObjectID(
        String(r["autoRemediationSuggestionId"]),
      );
    }
    job.stepId = String(r["stepId"]);
    job.stepType = r["stepType"] as RunbookStepType;
    job.targetAgentId = new ObjectID(String(r["targetAgentId"]));
    job.script = String(r["script"]);
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
      UPDATE "RunnerJob"
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
    const rows: Array<JSONObject> = unwrapRows(
      await dataSource.query(sql, [
        leaseMs.toString(),
        data.jobId.toString(),
        data.agentId.toString(),
        RunnerJobStatus.Claimed,
        RunnerJobStatus.Running,
      ]),
    );

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

    const status: RunnerJobStatus = data.success
      ? RunnerJobStatus.Succeeded
      : RunnerJobStatus.Failed;

    /*
     * Only the agent that holds the lease is allowed to write the terminal
     * result. If the lease has already moved on (Worker timed out and
     * reclaimed), this is a no-op.
     */
    const sql: string = `
      UPDATE "RunnerJob"
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
    const rows: Array<JSONObject> = unwrapRows(
      await dataSource.query(sql, [
        status,
        data.output ?? null,
        data.exitCode ?? null,
        data.errorMessage ?? null,
        data.jobId.toString(),
        data.agentId.toString(),
        RunnerJobStatus.Claimed,
        RunnerJobStatus.Running,
      ]),
    );

    return rows.length > 0;
  }

  /*
   * Called by the Worker after enqueueing. Polls the job row every
   * POLL_INTERVAL_MS until the job reaches a terminal status, or until the
   * combined claim + execution window is exhausted (in which case we mark
   * the job TimedOut ourselves and return it).
   *
   * waitStartedAt anchors that window. It defaults to now — right for a job
   * this Worker just enqueued — but a Worker re-attaching to a job left behind
   * by a restart passes the job's createdAt, so the step keeps the single
   * window its author configured instead of earning a fresh one per redelivery.
   */
  @CaptureSpan()
  public async pollUntilTerminal(data: {
    jobId: ObjectID;
    claimTimeoutInMs: number;
    executionTimeoutInMs: number;
    waitStartedAt?: Date | undefined;
  }): Promise<Model> {
    const overallDeadline: Date = OneUptimeDate.addRemoveSeconds(
      data.waitStartedAt || OneUptimeDate.getCurrentDate(),
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
          `RunnerJob ${data.jobId.toString()} disappeared while waiting.`,
        );
      }

      if (isTerminalAgentJobStatus(job.status)) {
        return job;
      }

      const now: Date = OneUptimeDate.getCurrentDate();

      // Pending with claim deadline elapsed -> no agent picked it up.
      if (
        job.status === RunnerJobStatus.Pending &&
        job.claimDeadlineAt &&
        now > job.claimDeadlineAt
      ) {
        return this.timeoutJob({
          jobId: data.jobId,
          reason:
            "No runbook agent picked up this step before the wait window expired. The agent may be offline — check that it is running and reachable, then try again.",
        });
      }

      // Claimed/Running with lease elapsed -> agent went silent.
      if (
        (job.status === RunnerJobStatus.Claimed ||
          job.status === RunnerJobStatus.Running) &&
        job.leaseExpiresAt &&
        now > job.leaseExpiresAt
      ) {
        return this.timeoutJob({
          jobId: data.jobId,
          reason:
            "The runbook agent stopped responding while this step was running. The agent may have crashed or lost its network connection — check that it is still online, then try running the runbook again.",
        });
      }

      if (now > overallDeadline) {
        return this.timeoutJob({
          jobId: data.jobId,
          reason:
            "This step ran longer than the allowed execution window. Increase the timeout on the step or make the script complete faster.",
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
      UPDATE "RunnerJob"
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
      RunnerJobStatus.TimedOut,
      data.reason,
      data.jobId.toString(),
      RunnerJobStatus.Succeeded,
      RunnerJobStatus.Failed,
      RunnerJobStatus.TimedOut,
      RunnerJobStatus.Cancelled,
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
        `RunnerJob ${data.jobId.toString()} not found while timing out.`,
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
        `UPDATE "RunnerJob"
         SET "status" = $1, "completedAt" = NOW(), "updatedAt" = NOW(), "version" = "version" + 1
         WHERE "runbookExecutionId" = $2::uuid
           AND "status" NOT IN ($3, $4, $5, $6)`,
        [
          RunnerJobStatus.Cancelled,
          data.runbookExecutionId.toString(),
          RunnerJobStatus.Succeeded,
          RunnerJobStatus.Failed,
          RunnerJobStatus.TimedOut,
          RunnerJobStatus.Cancelled,
        ],
      );
    } catch (err) {
      logger.error("Failed to cancel RunnerJobs for execution");
      logger.error(err);
    }
  }
}

export default new Service();
