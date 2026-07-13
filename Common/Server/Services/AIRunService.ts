import PositiveNumber from "../../Types/PositiveNumber";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import AIRunStatus from "../../Types/AI/AIRunStatus";
import AIRunType from "../../Types/AI/AIRunType";
import CodeFixTaskType, {
  CodeFixTaskTypeHelper,
} from "../../Types/AI/CodeFixTaskType";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import QueryHelper from "../Types/Database/QueryHelper";
import CountBy from "../Types/Database/CountBy";
import FindBy from "../Types/Database/FindBy";
import { OnFind } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/AIRun";
import { pinQueryToRequestingUser } from "../Utils/AI/AIChatPrivacyFilter";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
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
  startedAt?: Date | undefined;
  lastHeartbeatAt?: Date | undefined;
  completedAt?: Date | undefined;
  errorMessage?: string | undefined;
  llmCallCount?: number | undefined;
  toolCallCount?: number | undefined;
  totalTokens?: number | undefined;
  // The claiming agent's id as a string (ObjectID.toString()) — see above.
  aiAgentId?: string | undefined;
}

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * A genuinely atomic status transition: one conditional UPDATE whose WHERE
   * carries the expected current status (and optionally the expected
   * attemptCount). Returns the number of rows changed — 0 means another
   * actor won the race.
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

    const result: UpdateResult = await queryBuilder.execute();

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
   * Which record that is depends on the task recipe: exception-based
   * recipes need triggeredByTelemetryExceptionId, while
   * ImproveInstrumentation / FixFromIncident run against the incident/alert
   * whose investigation triggered them.
   */
  @CaptureSpan()
  public async claimNextQueuedCodeFixRun(data: {
    aiAgentId: ObjectID;
  }): Promise<Model | null> {
    const maxClaimAttempts: number = 5;

    for (let attempt: number = 0; attempt < maxClaimAttempts; attempt++) {
      const run: Model | null = await this.findOneBy({
        query: {
          runType: AIRunType.CodeFix,
          status: AIRunStatus.Queued,
        },
        sort: {
          createdAt: SortOrder.Ascending,
        },
        select: {
          _id: true,
          projectId: true,
          triggeredByTelemetryExceptionId: true,
          triggeredByIncidentId: true,
          triggeredByAlertId: true,
          attemptCount: true,
          codeFixTaskType: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (!run || !run.id) {
        return null;
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
       * Recipe-dependent executability guard: exception-based recipes are
       * unexecutable without their telemetry exception, but recipes whose
       * subject is an incident/alert (ImproveInstrumentation,
       * FixFromIncident) legitimately carry NO exception id — rejecting
       * those here would Error every run their triggers enqueue.
       */
      const missingContextMessage: string | null =
        CodeFixTaskTypeHelper.requiresTelemetryException(run.codeFixTaskType)
          ? run.triggeredByTelemetryExceptionId
            ? null
            : "Queued code-fix run has no telemetry exception to fix."
          : run.triggeredByIncidentId || run.triggeredByAlertId
            ? null
            : "Queued code-fix run has no incident or alert subject.";

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

  protected override async onBeforeFind(
    findBy: FindBy<Model>,
  ): Promise<OnFind<Model>> {
    findBy.query = pinQueryToRequestingUser(
      findBy.query,
      findBy.props,
      "userId",
    );
    return { findBy, carryForward: null };
  }

  @CaptureSpan()
  public override async countBy(
    countBy: CountBy<Model>,
  ): Promise<PositiveNumber> {
    countBy.query = pinQueryToRequestingUser(
      countBy.query,
      countBy.props,
      "userId",
    );
    return super.countBy(countBy);
  }
}

export default new Service();
