import PositiveNumber from "../../Types/PositiveNumber";
import ObjectID from "../../Types/ObjectID";
import AIRunStatus from "../../Types/AI/AIRunStatus";
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
 * set through this path.
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
