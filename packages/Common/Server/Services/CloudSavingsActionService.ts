import CloudSavingsAction from "../../Models/DatabaseModels/CloudSavingsAction";
import { CloudSavingsActionStatus } from "../../Types/Cloud/CloudSavingsAction";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ProjectReferencesService from "./ProjectReferencesService";
import { UpdateQueryBuilder, UpdateResult } from "typeorm";
import { QueryDeepPartialEntity } from "typeorm/query-builder/QueryPartialEntity";

/*
 * What a change of a savings action's state may set. Primitives only: the
 * query-builder update below bypasses column transformers, so an id is
 * passed as its string and a JSON column as plain JSON.
 */
export interface CloudSavingsActionTransitionSet {
  status: CloudSavingsActionStatus;
  approvedByUserId?: string | null | undefined;
  approvedAt?: Date | null | undefined;
  firstApprovedByUserId?: string | null | undefined;
  firstApprovedAt?: Date | null | undefined;
  appliedAt?: Date | null | undefined;
  failedAt?: Date | null | undefined;
  failureMessage?: string | null | undefined;
  dismissedByUserId?: string | undefined;
  dismissedAt?: Date | undefined;
  dismissReason?: string | undefined;
  undoneByUserId?: string | null | undefined;
  undoneAt?: Date | null | undefined;
  expiredAt?: Date | undefined;
  endedAt?: Date | undefined;
  savedHours?: number | undefined;
  nextStepAt?: Date | null | undefined;
  progress?: JSONObject | undefined;
  undoProgress?: JSONObject | undefined;
  summary?: string | undefined;
  measurement?: string | null | undefined;
  costBeforeDaily?: number | null | undefined;
  costAfterDaily?: number | null | undefined;
  realisedMonthlySavings?: number | null | undefined;
  measuredAt?: Date | null | undefined;
}

/*
 * The changes OneUptime proposes and makes in a cloud for a saving
 * (CloudSavingsAction, #11010). Rows are OneUptime's alone: people act on
 * one only through CloudSavingsActions, and every change of its state is a
 * claim - a conditional UPDATE whose WHERE carries the state it is changed
 * from - so of two presses at once exactly one approves, dismisses or
 * undoes it, and a cloud is never changed twice for one press.
 */
export class Service extends ProjectReferencesService<CloudSavingsAction> {
  public constructor() {
    super(CloudSavingsAction);
  }

  /*
   * Written by OneUptime about changes it made itself, crediting whoever
   * approved - someone who may have left the project since. Refusing one
   * would only lose the record of a change made in a customer's cloud.
   */
  protected override checksServerWrites(): boolean {
    return false;
  }

  /*
   * A change of state, claimed: returns the rows changed - 0 means someone
   * else acted on it first, or it changed since it was read.
   */
  @CaptureSpan()
  public async attemptTransition(data: {
    actionId: ObjectID;
    fromStatuses: ReadonlyArray<CloudSavingsActionStatus>;
    set: CloudSavingsActionTransitionSet;
    // Held to the first approval read: a second approval of the same row by two people at once.
    whileFirstApprovedBy?: string | null | undefined;
    // A step's lease: taken only while its next step is due, so one worker steps it.
    whileNextStepAtOrBefore?: Date | undefined;
  }): Promise<number> {
    if (data.fromStatuses.length === 0) {
      return 0;
    }

    let queryBuilder: UpdateQueryBuilder<CloudSavingsAction> =
      this.getRepository()
        .createQueryBuilder()
        .update(CloudSavingsAction)
        .set(data.set as unknown as QueryDeepPartialEntity<CloudSavingsAction>)
        .where('"_id" = :id', { id: data.actionId.toString() })
        .andWhere('"status" IN (:...fromStatuses)', {
          fromStatuses: [...data.fromStatuses],
        })
        .andWhere('"deletedAt" IS NULL');

    if (data.whileFirstApprovedBy !== undefined) {
      queryBuilder =
        data.whileFirstApprovedBy === null
          ? queryBuilder.andWhere('"firstApprovedByUserId" IS NULL')
          : queryBuilder.andWhere('"firstApprovedByUserId" = :first', {
              first: data.whileFirstApprovedBy,
            });
    }

    if (data.whileNextStepAtOrBefore) {
      queryBuilder = queryBuilder.andWhere('"nextStepAt" <= :due', {
        due: data.whileNextStepAtOrBefore,
      });
    }

    const result: UpdateResult = await queryBuilder.execute();

    return result.affected || 0;
  }
}

export default new Service();
