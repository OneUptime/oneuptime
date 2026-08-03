import AutoRemediationSuggestionStatus from "../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import ObjectID from "../../Types/ObjectID";
import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/AutoRemediationSuggestion";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import { UpdateQueryBuilder, UpdateResult } from "typeorm";
import { QueryDeepPartialEntity } from "typeorm/query-builder/QueryPartialEntity";

/*
 * The fields a status transition may set. Primitives only — the query-builder
 * update below bypasses column transformers, so ObjectID-backed columns must
 * be passed as their pre-transformed string form (ObjectID.toString()).
 */
export interface SuggestionTransitionSet {
  status: AutoRemediationSuggestionStatus;
  runbookId?: string | undefined;
  runbookNameSnapshot?: string | undefined;
  rationaleMarkdown?: string | undefined;
  runbookExecutionId?: string | undefined;
  approvedByUserId?: string | undefined;
  approvedAt?: Date | undefined;
  dismissedByUserId?: string | undefined;
  dismissedAt?: Date | undefined;
}

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * A genuinely atomic status transition: one conditional UPDATE whose WHERE
   * carries the expected current status. Returns the number of rows changed —
   * 0 means another actor won the race. This is what makes double-approving
   * (and therefore double-starting a runbook) impossible; updateOneBy is
   * SELECT-then-save and cannot implement a claim.
   */
  @CaptureSpan()
  public async attemptStatusTransition(data: {
    suggestionId: ObjectID;
    fromStatus: AutoRemediationSuggestionStatus;
    set: SuggestionTransitionSet;
  }): Promise<number> {
    const queryBuilder: UpdateQueryBuilder<Model> = this.getRepository()
      .createQueryBuilder()
      .update(Model)
      .set(data.set as QueryDeepPartialEntity<Model>)
      .where('"_id" = :id', { id: data.suggestionId.toString() })
      .andWhere('"status" = :fromStatus', { fromStatus: data.fromStatus })
      .andWhere('"deletedAt" IS NULL');

    const result: UpdateResult = await queryBuilder.execute();

    return result.affected || 0;
  }
}

export default new Service();
