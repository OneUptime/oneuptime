import AutoRemediationApprovalSource from "../../Types/AutoRemediation/AutoRemediationApprovalSource";
import AutoRemediationExecutionMode from "../../Types/AutoRemediation/AutoRemediationExecutionMode";
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
  /*
   * How the suggestion acts, when the transition decides it: a runbook
   * OneUptime AI picked to start right away that is proposed instead says
   * so (Suggest), so the row never claims a start that did not happen.
   */
  executionMode?: AutoRemediationExecutionMode | undefined;
  runbookId?: string | undefined;
  runbookNameSnapshot?: string | undefined;
  rationaleMarkdown?: string | undefined;
  runbookExecutionId?: string | undefined;
  approvedByUserId?: string | undefined;
  approvedAt?: Date | undefined;
  // Where the person approved it: the AI card, Slack or Microsoft Teams.
  approvedFrom?: AutoRemediationApprovalSource | undefined;
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
  /*
   * How the runbook a Runbook suggestion proposes went the last times
   * OneUptime AI ran it (RemediationTrackRecord as plain JSON), set when it
   * is proposed. jsonb, stored as-is, like commandPlan.
   */
  runbookTrackRecord?: JSONObject | undefined;
}

/*
 * The first of the two approvals a riskier fix needs where the project asks
 * two people to approve one (Project.requireTwoApprovalsForRiskierFixes):
 * who gave it (as ObjectID.toString(), like every id this update sets),
 * when, and where.
 */
export interface FirstApprovalSet {
  firstApprovedByUserId: string;
  firstApprovedAt: Date;
  firstApprovedFrom: AutoRemediationApprovalSource;
}

/*
 * What starting a round of an AI fix again sets (RemediationRound.tryAgain),
 * and what putting it back sets when its run could not be created: its
 * status, its run, and what its last run left on it. ObjectID-backed
 * columns as their string form, like SuggestionTransitionSet.
 */
export interface RoundRunChangeSet {
  status: AutoRemediationSuggestionStatus;
  aiRunId: string | null;
  commandPlan: JSONObject | null;
  mcpToolCallPlan: JSONObject | null;
  rationaleMarkdown: string | null;
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
   * A round of an AI fix started again, or put back (RemediationRound
   * .tryAgain): one conditional UPDATE whose WHERE carries the round as it
   * was read - its status AND its run - so of two presses at once exactly
   * one starts it, and a round that moved on meanwhile (its stranded run
   * settled, a person dismissed it) is left alone. Returns the rows
   * changed; 0 means another actor won.
   */
  @CaptureSpan()
  public async attemptRoundRunChange(data: {
    suggestionId: ObjectID;
    fromStatus: AutoRemediationSuggestionStatus;
    fromAiRunId: ObjectID | null;
    set: RoundRunChangeSet;
  }): Promise<number> {
    let queryBuilder: UpdateQueryBuilder<Model> = this.getRepository()
      .createQueryBuilder()
      .update(Model)
      .set(data.set as unknown as QueryDeepPartialEntity<Model>)
      .where('"_id" = :id', { id: data.suggestionId.toString() })
      .andWhere('"status" = :fromStatus', { fromStatus: data.fromStatus })
      .andWhere('"deletedAt" IS NULL');

    queryBuilder = data.fromAiRunId
      ? queryBuilder.andWhere('"aiRunId" = :fromAiRunId', {
          fromAiRunId: data.fromAiRunId.toString(),
        })
      : queryBuilder.andWhere('"aiRunId" IS NULL');

    const result: UpdateResult = await queryBuilder.execute();

    return result.affected || 0;
  }

  /*
   * Records the first of two approvals (RemediationApproval): one
   * conditional UPDATE whose WHERE carries both what makes it the first -
   * the fix still waits for approval, and nobody approved it first yet - so
   * of two first approvals at once exactly one is recorded, and the other
   * person's press is read again as the second. The status stays
   * Suggested: nothing runs on one approval. Returns the rows changed; 0
   * means the fix moved on, or someone approved it first meanwhile.
   */
  @CaptureSpan()
  public async attemptFirstApproval(data: {
    suggestionId: ObjectID;
    set: FirstApprovalSet;
  }): Promise<number> {
    const queryBuilder: UpdateQueryBuilder<Model> = this.getRepository()
      .createQueryBuilder()
      .update(Model)
      .set(data.set as unknown as QueryDeepPartialEntity<Model>)
      .where('"_id" = :id', { id: data.suggestionId.toString() })
      .andWhere('"status" = :status', {
        status: AutoRemediationSuggestionStatus.Suggested,
      })
      .andWhere('"firstApprovedByUserId" IS NULL')
      .andWhere('"deletedAt" IS NULL');

    const result: UpdateResult = await queryBuilder.execute();

    return result.affected || 0;
  }

  /*
   * The second of two approvals: attemptStatusTransition's claim
   * (Suggested -> Approved, once), guarded as well on the first approval
   * being the one the approver was shown and on it being someone else's -
   * the WHERE says both, so neither a first approval taken back nor the
   * first approver's own second press can ever run the fix. Returns the
   * rows changed; 0 means someone else acted on the fix first.
   */
  @CaptureSpan()
  public async attemptSecondApproval(data: {
    suggestionId: ObjectID;
    firstApprovedByUserId: string;
    set: SuggestionTransitionSet;
  }): Promise<number> {
    const approverId: string | undefined = data.set.approvedByUserId;

    if (
      !approverId ||
      approverId.toLowerCase() === data.firstApprovedByUserId.toLowerCase()
    ) {
      return 0;
    }

    const queryBuilder: UpdateQueryBuilder<Model> = this.getRepository()
      .createQueryBuilder()
      .update(Model)
      .set(data.set as unknown as QueryDeepPartialEntity<Model>)
      .where('"_id" = :id', { id: data.suggestionId.toString() })
      .andWhere('"status" = :fromStatus', {
        fromStatus: AutoRemediationSuggestionStatus.Suggested,
      })
      .andWhere('"firstApprovedByUserId" = :firstApprovedByUserId', {
        firstApprovedByUserId: data.firstApprovedByUserId,
      })
      .andWhere('"firstApprovedByUserId" <> :approverId', { approverId })
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
    /*
     * Held to what each column takes, as every raw write path must
     * (truncateStringColumnsToMaxLength): this UPDATE skips the checks a
     * service write makes, and verificationNote (varchar(500)) quotes the
     * command and the values a GitOps controller put back, which can run
     * longer. Unheld, Postgres refused the UPDATE, and each sweep refused it
     * again: the verification stayed Pending, with no post, no auto-resolve
     * and no rollback.
     */
    const set: VerificationTransitionSet =
      this.truncateStringColumnsToMaxLength({ ...data.set } as Record<
        string,
        unknown
      >) as unknown as VerificationTransitionSet;

    const queryBuilder: UpdateQueryBuilder<Model> = this.getRepository()
      .createQueryBuilder()
      .update(Model)
      .set(set as QueryDeepPartialEntity<Model>)
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
