import DatabaseService from "./DatabaseService";
import AIRemediationAction from "../../Models/DatabaseModels/AIRemediationAction";
import AIRemediationActionStatus from "../../Types/AI/AIRemediationActionStatus";
import ObjectID from "../../Types/ObjectID";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import { UpdateQueryBuilder, UpdateResult } from "typeorm";
import { QueryDeepPartialEntity } from "typeorm/query-builder/QueryPartialEntity";

/*
 * The fields a status transition may set. Primitives only — the query-builder
 * update below bypasses column transformers, so ObjectID fields must be
 * passed as strings (ObjectID.toString()); `null` explicitly clears a column
 * (used when a budget-refused approval is reverted to Proposed).
 */
export interface AIRemediationActionTransitionSet {
  status: AIRemediationActionStatus;
  approvedByUserId?: string | null | undefined;
  approvedAt?: Date | null | undefined;
  rejectedByUserId?: string | undefined;
  rejectedAt?: Date | undefined;
  rejectionReason?: string | undefined;
  executedAt?: Date | undefined;
  runbookId?: string | undefined;
  runbookExecutionId?: string | undefined;
  errorMessage?: string | null | undefined;
}

export class Service extends DatabaseService<AIRemediationAction> {
  public constructor() {
    super(AIRemediationAction);
  }

  /*
   * A genuinely atomic status transition: one conditional UPDATE whose WHERE
   * carries the expected current status. Returns the number of rows changed
   * (0 or 1) — 0 means another actor won the transition (a concurrent
   * approve, the expiry sweeper, ...) and the caller must do NOTHING with
   * the action, because the winner already owns its side effects.
   *
   * This exists because updateBy/updateOneBy is SELECT-then-save: two
   * concurrent callers can both observe the precondition and both write, so
   * it cannot implement a claim (the AIRunService.attemptStatusTransition
   * lesson). Every transition in the executor, the API, and the sweeper
   * routes through this so double-execution is structurally impossible.
   */
  @CaptureSpan()
  public async attemptStatusTransition(data: {
    actionId: ObjectID;
    fromStatus: AIRemediationActionStatus;
    set: AIRemediationActionTransitionSet;
  }): Promise<number> {
    const queryBuilder: UpdateQueryBuilder<AIRemediationAction> =
      this.getRepository()
        .createQueryBuilder()
        .update(AIRemediationAction)
        .set(data.set as QueryDeepPartialEntity<AIRemediationAction>)
        .where('"_id" = :id', { id: data.actionId.toString() })
        .andWhere('"status" = :fromStatus', { fromStatus: data.fromStatus })
        .andWhere('"deletedAt" IS NULL');

    const result: UpdateResult = await queryBuilder.execute();

    return result.affected || 0;
  }
}

export default new Service();
