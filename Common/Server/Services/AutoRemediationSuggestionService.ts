import AutoRemediationSuggestionStatus from "../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationVerificationStatus from "../../Types/AutoRemediation/AutoRemediationVerificationStatus";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import CountBy from "../Types/Database/CountBy";
import DeleteBy from "../Types/Database/DeleteBy";
import FindBy from "../Types/Database/FindBy";
import { OnDelete, OnFind, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/AutoRemediationSuggestion";
import { applyOptionalAlertRelatedRecordPrivacyFilter } from "../Utils/Alert/AlertPrivacyFilter";
import { applyOptionalIncidentRelatedRecordPrivacyFilter } from "../Utils/Incident/IncidentPrivacyFilter";
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
  verificationStatus?: AutoRemediationVerificationStatus | undefined;
  verificationDeadlineAt?: Date | undefined;
  /*
   * The frozen AI-composed command plan (AiRemediationCommandPlan as plain
   * JSON) for CommandPlan suggestions. jsonb column — no transformer, so
   * the query-builder update stores it as-is.
   */
  commandPlan?: JSONObject | undefined;
}

// What the outcome verifier may set when a verification concludes.
export interface VerificationTransitionSet {
  verificationStatus: AutoRemediationVerificationStatus;
  verificationCompletedAt?: Date | undefined;
  verificationNote?: string | undefined;
}

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * Suggestions are incident/alert child records whose rationale can quote
   * the AI's analysis of the subject — reads must respect the subject's
   * privacy exactly like feed items and internal notes do. Both link
   * columns are nullable (a row links an incident OR an alert), so the
   * null-tolerant filter variants apply: a NULL link passes its own clause
   * and the sibling column's filter does the gating.
   */
  @CaptureSpan()
  protected override async onBeforeFind(
    findBy: FindBy<Model>,
  ): Promise<OnFind<Model>> {
    findBy.query = applyOptionalIncidentRelatedRecordPrivacyFilter(
      findBy.query,
      findBy.props,
    );
    findBy.query = applyOptionalAlertRelatedRecordPrivacyFilter(
      findBy.query,
      findBy.props,
    );
    return { findBy, carryForward: null };
  }

  @CaptureSpan()
  public override async countBy(
    countBy: CountBy<Model>,
  ): Promise<PositiveNumber> {
    countBy.query = applyOptionalIncidentRelatedRecordPrivacyFilter(
      countBy.query,
      countBy.props,
    );
    countBy.query = applyOptionalAlertRelatedRecordPrivacyFilter(
      countBy.query,
      countBy.props,
    );
    return super.countBy(countBy);
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    updateBy.query = applyOptionalIncidentRelatedRecordPrivacyFilter(
      updateBy.query,
      updateBy.props,
    );
    updateBy.query = applyOptionalAlertRelatedRecordPrivacyFilter(
      updateBy.query,
      updateBy.props,
    );
    return { updateBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    deleteBy.query = applyOptionalIncidentRelatedRecordPrivacyFilter(
      deleteBy.query,
      deleteBy.props,
    );
    deleteBy.query = applyOptionalAlertRelatedRecordPrivacyFilter(
      deleteBy.query,
      deleteBy.props,
    );
    return { deleteBy, carryForward: null };
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
    /*
     * The double cast stops TS from structurally exploring JSONObject
     * (commandPlan) against the entity type — a recursive type that trips
     * TS2589. The set is intentionally a raw column map.
     */
    const queryBuilder: UpdateQueryBuilder<Model> = this.getRepository()
      .createQueryBuilder()
      .update(Model)
      .set(data.set as unknown as QueryDeepPartialEntity<Model>)
      .where('"_id" = :id', { id: data.suggestionId.toString() })
      .andWhere('"status" = :fromStatus', { fromStatus: data.fromStatus })
      .andWhere('"deletedAt" IS NULL');

    const result: UpdateResult = await queryBuilder.execute();

    return result.affected || 0;
  }

  /*
   * The verification twin of attemptStatusTransition: one conditional
   * UPDATE guarded on the expected current verificationStatus, so
   * concurrent verifier sweeps (multiple Workers replicas) settle each
   * verification exactly once.
   */
  @CaptureSpan()
  public async attemptVerificationTransition(data: {
    suggestionId: ObjectID;
    fromVerificationStatus: AutoRemediationVerificationStatus;
    set: VerificationTransitionSet;
  }): Promise<number> {
    const queryBuilder: UpdateQueryBuilder<Model> = this.getRepository()
      .createQueryBuilder()
      .update(Model)
      .set(data.set as QueryDeepPartialEntity<Model>)
      .where('"_id" = :id', { id: data.suggestionId.toString() })
      .andWhere('"verificationStatus" = :fromVerificationStatus', {
        fromVerificationStatus: data.fromVerificationStatus,
      })
      .andWhere('"deletedAt" IS NULL');

    const result: UpdateResult = await queryBuilder.execute();

    return result.affected || 0;
  }
}

export default new Service();
