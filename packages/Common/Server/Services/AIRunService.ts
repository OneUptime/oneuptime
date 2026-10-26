import PositiveNumber from "../../Types/PositiveNumber";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import AIRunStatus from "../../Types/AI/AIRunStatus";
import AIRunType from "../../Types/AI/AIRunType";
import AIRunCodeFixRecommendation from "../../Types/AI/AIRunCodeFixRecommendation";
import AIRunHumanVerdict from "../../Types/AI/AIRunHumanVerdict";
import BadDataException from "../../Types/Exception/BadDataException";
import CodeFixTaskType, {
  CodeFixContextKind,
  CodeFixTaskTypeHelper,
} from "../../Types/AI/CodeFixTaskType";
import CodeFixTaskContext, {
  getCodeTaskRequest,
  getGitHubTaskContext,
  getInvestigationCodeFixTaskSnapshot,
  InvestigationCodeFixTaskContext,
} from "../../Types/AI/CodeFixTaskContext";
import { CodeTaskChanges, CodeTaskOutcome } from "../../Types/AI/CodeTask";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import QueryHelper from "../Types/Database/QueryHelper";
import CountBy from "../Types/Database/CountBy";
import CreateBy from "../Types/Database/CreateBy";
import FindBy from "../Types/Database/FindBy";
import { OnCreate, OnFind } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import ProjectService from "./ProjectService";
import Model from "../../Models/DatabaseModels/AIRun";
import { applyAIRunPrivacyFilter } from "../Utils/AI/AIRunPrivacyFilter";
import CodeFixClaimQuery, {
  CodeFixClaimQueryFacts,
  CodeFixClaimStatement,
} from "../Utils/AI/CodeFix/CodeFixClaimQuery";
import { CodeWorker } from "../../Types/Runner/CodeRepositoryRunner";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger from "../Utils/Logger";
import { UpdateQueryBuilder, UpdateResult } from "typeorm";
import { QueryDeepPartialEntity } from "typeorm/query-builder/QueryPartialEntity";

/*
 * The fields a status transition may set. Primitives only — the query-builder
 * update below bypasses column transformers, so ObjectID fields must not be
 * set through this path. ObjectID-backed columns may be set via their
 * pre-transformed string form (what the transformer would have written).
 */
export interface AIRunTransitionSet {
  status: AIRunStatus;
  attemptCount?: number | undefined;
  handedBackCount?: number | undefined;
  startedAt?: Date | undefined;
  lastHeartbeatAt?: Date | undefined;
  completedAt?: Date | undefined;
  errorMessage?: string | undefined;
  llmCallCount?: number | undefined;
  toolCallCount?: number | undefined;
  totalTokens?: number | undefined;
  codeFixRecommendation?: AIRunCodeFixRecommendation | undefined;
  // The claiming agent's id as a string (ObjectID.toString()) — see above.
  aiAgentId?: string | undefined;
  /*
   * The whole context, re-read and merged by the caller: TypeORM writes a
   * jsonb column by replacing it. The column has no transformer, so the
   * query-builder update stores the object as it is. For what has to be on
   * the run the moment it is terminal — see update-task-status.
   */
  taskContext?: CodeFixTaskContext | undefined;
  /*
   * What a code task's turn ended with, written in the same transition that
   * makes it Completed, so the conversation never shows a finished turn
   * without its reply (see update-task-status and CodeTaskOutcomeReader).
   * jsonb columns without a transformer: stored as they are.
   */
  taskOutcome?: CodeTaskOutcome | undefined;
  codeChanges?: CodeTaskChanges | undefined;
  needsUserInput?: boolean | undefined;
}

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * A genuinely atomic status transition: one conditional UPDATE whose WHERE
   * carries the expected current status (and optionally the expected
   * attemptCount / heartbeat snapshot). Returns the number of rows changed —
   * 0 means another actor won the race or refreshed the heartbeat.
   *
   * This exists because updateOneBy is SELECT-then-save: two concurrent
   * callers can both observe the precondition and both write, so it cannot
   * implement a claim. The durable investigation queue's exactly-once
   * guarantee rests on this method.
   */
  @CaptureSpan()
  public async attemptStatusTransition(data: {
    aiRunId: ObjectID;
    fromStatus: AIRunStatus;
    expectedAttemptCount?: number | undefined;
    expectedLastHeartbeatAt?: Date | undefined;
    set: AIRunTransitionSet;
  }): Promise<number> {
    const queryBuilder: UpdateQueryBuilder<Model> = this.getRepository()
      .createQueryBuilder()
      .update(Model)
      .set(data.set as QueryDeepPartialEntity<Model>)
      .where('"_id" = :id', { id: data.aiRunId.toString() })
      .andWhere('"status" = :fromStatus', { fromStatus: data.fromStatus })
      .andWhere('"deletedAt" IS NULL');

    if (data.expectedAttemptCount !== undefined) {
      queryBuilder.andWhere('"attemptCount" = :expectedAttemptCount', {
        expectedAttemptCount: data.expectedAttemptCount,
      });
    }

    if (data.expectedLastHeartbeatAt !== undefined) {
      queryBuilder.andWhere('"lastHeartbeatAt" = :expectedLastHeartbeatAt', {
        expectedLastHeartbeatAt: data.expectedLastHeartbeatAt,
      });
    }

    const result: UpdateResult = await queryBuilder.execute();

    return result.affected || 0;
  }

  /*
   * Count one production telemetry tool call of a code-fix run, when the run
   * may still make one: a single conditional UPDATE that adds one to the
   * run's toolCallCount while it is below `maxToolCalls`, the run is a
   * Running code-fix run and it is claimed by `aiAgentId`. True when the
   * call was counted - false when the run is at its cap or moved on - so two
   * calls at the same moment cannot both take the last one.
   *
   * For a code-fix run toolCallCount counts the tool calls the SERVER
   * executed for it (CodeAgentTelemetry); its file and command tools run on
   * the Runner and are not the server's to count.
   */
  @CaptureSpan()
  public async reserveCodeAgentToolCall(data: {
    aiRunId: ObjectID;
    aiAgentId: ObjectID;
    maxToolCalls: number;
  }): Promise<boolean> {
    const result: UpdateResult = await this.getRepository()
      .createQueryBuilder()
      .update(Model)
      .set({
        toolCallCount: () => {
          return 'COALESCE("toolCallCount", 0) + 1';
        },
      } as QueryDeepPartialEntity<Model>)
      .where('"_id" = :id', { id: data.aiRunId.toString() })
      .andWhere('"runType" = :runType', { runType: AIRunType.CodeFix })
      .andWhere('"status" = :status', { status: AIRunStatus.Running })
      .andWhere('"aiAgentId" = :aiAgentId', {
        aiAgentId: data.aiAgentId.toString(),
      })
      .andWhere('COALESCE("toolCallCount", 0) < :maxToolCalls', {
        maxToolCalls: data.maxToolCalls,
      })
      .andWhere('"deletedAt" IS NULL')
      .execute();

    return (result.affected || 0) > 0;
  }

  /*
   * Persist the AI-written TL;DR of a completed investigation's analysis.
   * Display-only, so this is a plain conditional UPDATE rather than a claim,
   * but it is still write-once: scoped to the run, to the Completed state,
   * and to a row that has no summary yet.
   *
   * The IS NULL guard is what makes the invariant structural rather than
   * incidental. A stale attempt — one that lost the Completed CAS because the
   * sweeper falsely requeued it — is kept out today only by statement order
   * in the engine, and by then the WINNER has already written both the report
   * and its summary, so a status-only guard would happily let the loser
   * overwrite a summary that describes a different analysis. Returns the rows
   * changed; 0 means the run moved on, was removed, or is already summarized.
   */
  @CaptureSpan()
  public async setInvestigationAnalysisTldr(data: {
    aiRunId: ObjectID;
    analysisTldr: string;
  }): Promise<number> {
    const result: UpdateResult = await this.getRepository()
      .createQueryBuilder()
      .update(Model)
      .set({
        analysisTldr: data.analysisTldr,
      } as QueryDeepPartialEntity<Model>)
      .where('"_id" = :id', { id: data.aiRunId.toString() })
      .andWhere('"status" = :status', { status: AIRunStatus.Completed })
      .andWhere('"analysisTldr" IS NULL')
      .andWhere('"deletedAt" IS NULL')
      .execute();

    return result.affected || 0;
  }

  /*
   * Atomically settle the code-fix decision written as Pending by the
   * winning investigation completion transition. The recommendation and
   * immutable analysis snapshot are one database UPDATE guarded by both the
   * run id and Pending state; a stale writer can never overwrite a decision
   * another actor already settled.
   */
  @CaptureSpan()
  public async finalizeInvestigationCodeFixRecommendation(
    data:
      | {
          aiRunId: ObjectID;
          recommendation: AIRunCodeFixRecommendation.Recommended;
          taskContext: InvestigationCodeFixTaskContext;
        }
      | {
          aiRunId: ObjectID;
          recommendation: AIRunCodeFixRecommendation.NotRecommended;
        },
  ): Promise<number> {
    const result: UpdateResult = await this.getRepository()
      .createQueryBuilder()
      .update(Model)
      .set({
        codeFixRecommendation: data.recommendation,
        ...(data.recommendation === AIRunCodeFixRecommendation.Recommended
          ? { taskContext: data.taskContext }
          : {}),
      } as QueryDeepPartialEntity<Model>)
      .where('"_id" = :id', { id: data.aiRunId.toString() })
      .andWhere('"status" = :status', { status: AIRunStatus.Completed })
      .andWhere('"codeFixRecommendation" = :pending', {
        pending: AIRunCodeFixRecommendation.Pending,
      })
      .andWhere('"deletedAt" IS NULL')
      .execute();

    return result.affected || 0;
  }

  /*
   * Atomically claim the oldest Queued code-fix run for an external agent
   * worker (the /ai-agent-task/get-pending-task route). The Queued -> Running
   * transition is the same status+attemptCount-guarded CAS the investigation
   * queue uses, so concurrent agents can never receive the same run. The
   * returned run is already Running, heartbeated, and owned by the agent.
   *
   * A claimed run missing its recipe's trigger record cannot be executed —
   * it is finalized as Error and the loop moves on to the next candidate.
   * Which record that is depends on the recipe's context kind:
   * exception-based recipes need triggeredByTelemetryExceptionId,
   * ImproveInstrumentation / FixFromIncident run against the incident/alert
   * whose investigation triggered them, and FixPerformance carries its
   * trace evidence in taskContext (no subject row at all).
   */
  @CaptureSpan()
  public async claimNextQueuedCodeFixRun(data: {
    aiAgentId: ObjectID;
    /*
     * The claiming agent's project, when it is project-scoped. A Runner a
     * customer installs carries a project-scoped credential and must only
     * ever see that project's work — without this filter it would claim the
     * oldest queued run across every tenant. Left undefined only for a
     * global Runner (no projectId), which serves all projects by design.
     */
    projectId?: ObjectID | undefined;
    /*
     * Who is claiming, for the repositories' Runner choice
     * (Types/Runner/CodeRepositoryRunner): a project's Runner takes only the
     * runs of the repositories that pick it, a global Runner only those of
     * repositories that pick none (CodeFixClaimQuery).
     */
    worker: CodeWorker;
    /*
     * The recipes the claiming Runner has a handler for (its request's
     * supportedTaskTypes). Null for a Runner that does not say: it is only
     * handed the recipes every Runner has had, so a request from Code waits
     * for a Runner that can do it instead of failing in one that cannot.
     */
    supportedTaskTypes?: Array<CodeFixTaskType> | null | undefined;
  }): Promise<Model | null> {
    const maxClaimAttempts: number = 5;

    // A null recipe is FixException (rows created before recipes existed).
    const claimableTaskTypes: Array<CodeFixTaskType> =
      data.supportedTaskTypes ||
      CodeFixTaskTypeHelper.getTaskTypesForRunnersThatDoNotSay();

    for (let attempt: number = 0; attempt < maxClaimAttempts; attempt++) {
      /*
       * The oldest run this worker may take, by the repository's Runner as
       * it is now; then read like any other, still Queued (a run another
       * worker took meanwhile is passed over).
       */
      const candidateId: string | null =
        await this.findNextClaimableCodeFixRunId({
          worker: data.worker,
          projectId: data.projectId,
          claimableTaskTypes,
        });

      if (!candidateId) {
        return null;
      }

      const run: Model | null = await this.findOneBy({
        query: {
          _id: candidateId,
          runType: AIRunType.CodeFix,
          status: AIRunStatus.Queued,
          ...(data.projectId ? { projectId: data.projectId } : {}),
        },
        select: {
          _id: true,
          projectId: true,
          triggeredByTelemetryExceptionId: true,
          triggeredByIncidentId: true,
          triggeredByAlertId: true,
          attemptCount: true,
          codeFixTaskType: true,
          taskContext: true,
          codeRepositoryId: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (!run || !run.id) {
        // Taken, or no longer the worker's, since the candidate was read.
        continue;
      }

      const claimedCount: number = await this.attemptStatusTransition({
        aiRunId: run.id,
        fromStatus: AIRunStatus.Queued,
        expectedAttemptCount: run.attemptCount || 0,
        set: {
          status: AIRunStatus.Running,
          startedAt: OneUptimeDate.getCurrentDate(),
          lastHeartbeatAt: OneUptimeDate.getCurrentDate(),
          attemptCount: (run.attemptCount || 0) + 1,
          aiAgentId: data.aiAgentId.toString(),
        },
      });

      if (claimedCount === 0) {
        // Another agent won this run — try the next candidate.
        continue;
      }

      /*
       * Normalize the task recipe BEFORE the executability guard: a null
       * codeFixTaskType means FixException (rows created before task
       * recipes existed), the worker dispatches on this value, and the
       * guard below is recipe-dependent.
       */
      run.codeFixTaskType = CodeFixTaskTypeHelper.fromDatabaseValue(
        run.codeFixTaskType,
      );

      /*
       * Recipe-dependent executability guard, grouped by the recipe's
       * context kind: exception-based recipes are unexecutable without
       * their telemetry exception; recipes whose subject is an
       * incident/alert (ImproveInstrumentation, FixFromIncident)
       * legitimately carry NO exception id; and FixPerformance carries
       * neither — its trace evidence lives in taskContext. Rejecting a
       * kind for lacking another kind's record would Error every run its
       * trigger enqueues.
       */
      const contextKind: CodeFixContextKind =
        CodeFixTaskTypeHelper.getContextKind(run.codeFixTaskType);

      let missingContextMessage: string | null = null;

      if (contextKind === CodeFixContextKind.TelemetryException) {
        missingContextMessage = run.triggeredByTelemetryExceptionId
          ? null
          : "Queued code-fix run has no telemetry exception to fix.";
      } else if (contextKind === CodeFixContextKind.IncidentOrAlertSubject) {
        if (!run.triggeredByIncidentId && !run.triggeredByAlertId) {
          missingContextMessage =
            "Queued code-fix run has no incident or alert subject.";
        } else if (
          run.codeFixTaskType === CodeFixTaskType.FixFromIncident &&
          !getInvestigationCodeFixTaskSnapshot(run.taskContext)
        ) {
          /*
           * A subject alone is mutable context: a later investigation can post
           * another RootCause before the worker starts. FixFromIncident must
           * therefore carry the exact Recommended run + analysis it was
           * authorized from. Contextless legacy rows fail closed.
           */
          missingContextMessage =
            "Queued FixFromIncident run has no complete pinned investigation analysis snapshot.";
        }
      } else if (CodeFixTaskTypeHelper.isCodeRequest(run.codeFixTaskType)) {
        /*
         * A request from Code is the person's words and the repository they
         * asked in: without either there is nothing to do, and nowhere to do
         * it (the repository may have been removed from the project).
         */
        if (!getCodeTaskRequest(run.taskContext)) {
          missingContextMessage =
            "Queued request has no request in its task context.";
        } else if (!run.codeRepositoryId) {
          missingContextMessage =
            "The repository this request was made in is no longer connected to the project.";
        }
      } else if (CodeFixTaskTypeHelper.isGitHubTaskType(run.codeFixTaskType)) {
        /*
         * The GitHub recipes carry their whole world in taskContext.github:
         * which repository, which installation, and which issue OR pull
         * request. getGitHubTaskContext rejects a half-built context — one
         * missing its repository, or naming both an issue and a pull
         * request — so a run that could not decide what it is about fails
         * here rather than picking one at execution time.
         */
        missingContextMessage = getGitHubTaskContext(run.taskContext)
          ? null
          : "Queued GitHub run has no complete GitHub conversation in its task context.";
      } else if (
        run.codeFixTaskType === CodeFixTaskType.ImproveLogging ||
        run.codeFixTaskType === CodeFixTaskType.ImproveTracing
      ) {
        // Service-scoped instrumentation recipes carry the service instead.
        missingContextMessage = run.taskContext?.telemetryServiceId
          ? null
          : "Queued code-fix run has no telemetry service in its task context.";
      } else {
        missingContextMessage = run.taskContext?.traceId
          ? null
          : "Queued code-fix run has no trace evidence in its task context.";
      }

      if (missingContextMessage) {
        await this.attemptStatusTransition({
          aiRunId: run.id,
          fromStatus: AIRunStatus.Running,
          set: {
            status: AIRunStatus.Error,
            completedAt: OneUptimeDate.getCurrentDate(),
            errorMessage: missingContextMessage,
          },
        });
        continue;
      }

      return run;
    }

    return null;
  }

  /*
   * The id of the oldest queued code-fix run this worker may take now, or
   * null (CodeFixClaimQuery: the repository's Runner choice, read through
   * the run's repository as it is now).
   */
  @CaptureSpan()
  public async findNextClaimableCodeFixRunId(
    facts: CodeFixClaimQueryFacts,
  ): Promise<string | null> {
    const statement: CodeFixClaimStatement =
      CodeFixClaimQuery.getNextRunStatement(facts);

    const rows: Array<{ _id?: unknown }> =
      (await this.getRepository().manager.query(
        statement.sql,
        statement.parameters,
      )) as Array<{ _id?: unknown }>;

    const id: unknown = rows[0]?._id;

    return id ? String(id) : null;
  }

  /*
   * How many queued code-fix runs this worker may take now: the queue depth
   * a Runner autoscales on (get-pending-task-count), read by the same rule
   * as the claim.
   */
  @CaptureSpan()
  public async countClaimableCodeFixRuns(
    facts: CodeFixClaimQueryFacts,
  ): Promise<number> {
    const statement: CodeFixClaimStatement =
      CodeFixClaimQuery.getCountStatement(facts);

    const rows: Array<{ count?: unknown }> =
      (await this.getRepository().manager.query(
        statement.sql,
        statement.parameters,
      )) as Array<{ count?: unknown }>;

    const count: number = Number(rows[0]?.count || 0);

    return Number.isFinite(count) ? count : 0;
  }

  /*
   * The latest CodeFix run of EACH task recipe for an exception — at most
   * one run per CodeFixTaskType, newest first (so the first element is the
   * latest run overall). Backs /telemetry-exception/get-ai-agent-task: the
   * exception page must show a FixException run and a WriteRegressionTest
   * run side by side, not just whichever was created last.
   *
   * codeFixTaskType is normalized on the returned models: legacy null rows
   * come back as FixException.
   */
  @CaptureSpan()
  public async getLatestCodeFixRunPerTaskType(data: {
    telemetryExceptionId: ObjectID;
  }): Promise<Array<Model>> {
    const taskTypes: Array<CodeFixTaskType> = Object.values(CodeFixTaskType);

    const latestRuns: Array<Model | null> = await Promise.all(
      taskTypes.map((taskType: CodeFixTaskType): Promise<Model | null> => {
        return this.findOneBy({
          query: {
            runType: AIRunType.CodeFix,
            triggeredByTelemetryExceptionId: data.telemetryExceptionId,
            // Null means FixException — see the class comment above.
            codeFixTaskType:
              taskType === CodeFixTaskType.FixException
                ? QueryHelper.equalToOrNull(CodeFixTaskType.FixException)
                : taskType,
          },
          select: {
            _id: true,
            status: true,
            errorMessage: true,
            createdAt: true,
            codeFixTaskType: true,
          },
          sort: {
            createdAt: SortOrder.Descending,
          },
          props: {
            isRoot: true,
          },
        });
      }),
    );

    const runs: Array<Model> = latestRuns.filter(
      (run: Model | null): boolean => {
        return Boolean(run);
      },
    ) as Array<Model>;

    for (const run of runs) {
      run.codeFixTaskType = CodeFixTaskTypeHelper.fromDatabaseValue(
        run.codeFixTaskType,
      );
    }

    runs.sort((a: Model, b: Model): number => {
      return (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0);
    });

    return runs;
  }

  /*
   * Measurement layer (Phase 2): record a human's one-click verdict
   * (Confirmed / Rejected) on one exact COMPLETED investigation run for an
   * incident or alert. Overwriting an existing verdict is deliberate — a
   * user may change their mind; the verdict is per-run state, not an audit
   * trail. Throws when no completed investigation exists for the subject.
   * Callers must have already access-checked the subject under the USER's
   * permissions — this method reads and writes as root (investigation runs
   * are system-authored, so the per-user privacy pin would hide them).
   */
  @CaptureSpan()
  public async applyHumanVerdictToInvestigation(data: {
    aiRunId: ObjectID;
    projectId: ObjectID;
    incidentId?: ObjectID | undefined;
    alertId?: ObjectID | undefined;
    verdict: AIRunHumanVerdict;
    verdictByUserId: ObjectID;
  }): Promise<{ runId: ObjectID; verdict: AIRunHumanVerdict }> {
    if (!data.incidentId && !data.alertId) {
      throw new BadDataException(
        "An incident or alert subject is required to record a verdict.",
      );
    }

    const run: Model | null = await this.findOneBy({
      query: {
        _id: data.aiRunId,
        projectId: data.projectId,
        runType: AIRunType.Investigation,
        status: AIRunStatus.Completed,
        ...(data.incidentId
          ? { triggeredByIncidentId: data.incidentId }
          : { triggeredByAlertId: data.alertId! }),
      },
      select: { _id: true },
      props: { isRoot: true },
    });

    if (!run || !run.id) {
      throw new BadDataException(
        "The selected completed AI investigation does not exist for this subject — refresh the page before recording a verdict.",
      );
    }

    await this.updateOneById({
      id: run.id,
      data: {
        humanVerdict: data.verdict,
        humanVerdictAt: OneUptimeDate.getCurrentDate(),
        humanVerdictByUserId: data.verdictByUserId,
      },
      props: { isRoot: true },
    });

    return { runId: run.id, verdict: data.verdict };
  }

  /*
   * Stamp CodeFix runs with the project's next task number, so every AI task
   * has the short human-citable handle "#42" that incidents and alerts have.
   *
   * CodeFix only, on purpose: chat turns and investigations share this table
   * but are not tasks, and numbering them would advance the counter on every
   * Ask-AI message — a repository's tasks in Code would then read #7,
   * #31, #244.
   *
   * Best-effort. The counter needs Redis (Semaphore) and a second write; a
   * blip there must not lose a fix run, because the number is a display
   * convenience and the run itself is the work. On failure the run is created
   * with a null taskNumber, which the list renders as "-" and the detail page
   * hides — the run stays fully usable, just uncitable.
   *
   * A reply in a code task's conversation (codeTaskId set) is a turn of a
   * task that already has its number, so it takes none.
   */
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    const projectId: ObjectID | undefined =
      createBy.data.projectId || createBy.props.tenantId || undefined;

    if (
      createBy.data.runType === AIRunType.CodeFix &&
      projectId &&
      !createBy.data.codeTaskId
    ) {
      try {
        createBy.data.taskNumber =
          await ProjectService.incrementAndGetAIRunCounter(projectId);
      } catch (error) {
        logger.error(
          `Could not allocate a task number for a code-fix run in project ${projectId.toString()}; creating it unnumbered: ${error}`,
        );
      }
    }

    return { createBy, carryForward: null };
  }

  protected override async onBeforeFind(
    findBy: FindBy<Model>,
  ): Promise<OnFind<Model>> {
    findBy.query = applyAIRunPrivacyFilter(findBy.query, findBy.props);
    return { findBy, carryForward: null };
  }

  /*
   * countBy MUST repeat the filter. DatabaseService has no onBeforeCount hook
   * (only onCountSuccess / onCountError), and BaseAPI.getList issues findBy
   * and countBy with the SAME client query, so filtering in onBeforeFind alone
   * would return a correctly-scoped list beside an unscoped project-wide
   * count on every page. IncidentService repeats it for the same reason.
   */
  @CaptureSpan()
  public override async countBy(
    countBy: CountBy<Model>,
  ): Promise<PositiveNumber> {
    countBy.query = applyAIRunPrivacyFilter(countBy.query, countBy.props);
    return super.countBy(countBy);
  }
}

export default new Service();
