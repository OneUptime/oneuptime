import DataSecurityAiProposal from "../../Models/DatabaseModels/DataSecurityAiProposal";
import { DataSecurityAiProposalStatus } from "../../Types/DataSecurity/DataSecurityAi";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ProjectReferencesService from "./ProjectReferencesService";
import { UpdateQueryBuilder, UpdateResult } from "typeorm";
import { QueryDeepPartialEntity } from "typeorm/query-builder/QueryPartialEntity";

/*
 * What a change of a proposal's state may set. Primitives only: the
 * query-builder update below bypasses column transformers, so an id is
 * passed as its string (ObjectID.toString()), and a JSON column as plain
 * JSON.
 */
export interface DataSecurityAiProposalTransitionSet {
  status: DataSecurityAiProposalStatus;
  // null takes a claim back: an approval or an undo that did not happen.
  approvedByUserId?: string | null | undefined;
  approvedAt?: Date | null | undefined;
  appliedAt?: Date | undefined;
  result?: JSONObject | undefined;
  dismissedByUserId?: string | undefined;
  dismissedAt?: Date | undefined;
  dismissReason?: string | undefined;
  undoneByUserId?: string | null | undefined;
  undoneAt?: Date | null | undefined;
  expiredAt?: Date | undefined;
  failedAt?: Date | undefined;
  failureMessage?: string | undefined;
}

// The first of two approvals: who, when, and the plan it was given to.
export interface DataSecurityAiFirstApprovalSet {
  firstApprovedByUserId: string;
  firstApprovedAt: Date;
  firstApprovedPlanFingerprint: string;
}

/*
 * What OneUptime AI proposes for a Data Security issue (#10364). Rows are
 * OneUptime's alone: people act on one only through DataSecurityAiProposals,
 * and every change of its state is one of the claims below - a conditional
 * UPDATE whose WHERE carries the state it is changed from - so of two
 * presses at once exactly one approves, dismisses or undoes it, and a
 * change is never made twice.
 */
export class Service extends ProjectReferencesService<DataSecurityAiProposal> {
  public constructor() {
    super(DataSecurityAiProposal);
  }

  /*
   * Written by OneUptime about records it found itself, crediting whoever
   * approved - someone who may have left the project since. Refusing one
   * would only lose the record of a change.
   */
  protected override checksServerWrites(): boolean {
    return false;
  }

  /*
   * A change of state, claimed: one conditional UPDATE whose WHERE carries
   * the states it may change from (and, for an approval, the version its
   * checks read). Returns the rows changed - 0 means someone else acted on
   * it first, or it changed since it was read.
   */
  @CaptureSpan()
  public async attemptTransition(data: {
    proposalId: ObjectID;
    fromStatuses: ReadonlyArray<DataSecurityAiProposalStatus>;
    set: DataSecurityAiProposalTransitionSet;
    atVersion?: number | undefined;
  }): Promise<number> {
    if (data.fromStatuses.length === 0) {
      return 0;
    }

    let queryBuilder: UpdateQueryBuilder<DataSecurityAiProposal> =
      this.getRepository()
        .createQueryBuilder()
        .update(DataSecurityAiProposal)
        .set(
          data.set as unknown as QueryDeepPartialEntity<DataSecurityAiProposal>,
        )
        .where('"_id" = :id', { id: data.proposalId.toString() })
        .andWhere('"status" IN (:...fromStatuses)', {
          fromStatuses: [...data.fromStatuses],
        })
        .andWhere('"deletedAt" IS NULL');

    if (data.atVersion !== undefined) {
      queryBuilder = queryBuilder.andWhere('"version" = :version', {
        version: data.atVersion,
      });
    }

    const result: UpdateResult = await queryBuilder.execute();

    return result.affected || 0;
  }

  /*
   * The first of the two approvals a riskier change needs where the project
   * asks for two: recorded only while the proposal still waits, on the
   * version the approval's checks read, and when no first approval of this
   * very plan is recorded - so of two first approvals at once exactly one
   * is, and the other is read again as the second. Nothing runs on it.
   */
  @CaptureSpan()
  public async attemptFirstApproval(data: {
    proposalId: ObjectID;
    atVersion: number;
    set: DataSecurityAiFirstApprovalSet;
  }): Promise<number> {
    const result: UpdateResult = await this.getRepository()
      .createQueryBuilder()
      .update(DataSecurityAiProposal)
      .set(
        data.set as unknown as QueryDeepPartialEntity<DataSecurityAiProposal>,
      )
      .where('"_id" = :id', { id: data.proposalId.toString() })
      .andWhere('"status" = :status', {
        status: DataSecurityAiProposalStatus.Proposed,
      })
      .andWhere('"version" = :version', { version: data.atVersion })
      .andWhere(
        '("firstApprovedByUserId" IS NULL OR "firstApprovedPlanFingerprint" IS DISTINCT FROM :planFingerprint)',
        { planFingerprint: data.set.firstApprovedPlanFingerprint },
      )
      .andWhere('"deletedAt" IS NULL')
      .execute();

    return result.affected || 0;
  }

  /*
   * The second of two approvals: the claim to Approved, guarded as well on
   * the first approval being the one the approver was shown, given to this
   * very plan, and someone else's - so the first approver's own second
   * press never makes the change.
   */
  @CaptureSpan()
  public async attemptSecondApproval(data: {
    proposalId: ObjectID;
    atVersion: number;
    firstApprovedByUserId: string;
    planFingerprint: string;
    set: DataSecurityAiProposalTransitionSet;
  }): Promise<number> {
    const approverId: string = (data.set.approvedByUserId || "")
      .trim()
      .toLowerCase();

    if (
      !approverId ||
      approverId === data.firstApprovedByUserId.trim().toLowerCase() ||
      !data.planFingerprint
    ) {
      return 0;
    }

    const result: UpdateResult = await this.getRepository()
      .createQueryBuilder()
      .update(DataSecurityAiProposal)
      .set(
        data.set as unknown as QueryDeepPartialEntity<DataSecurityAiProposal>,
      )
      .where('"_id" = :id', { id: data.proposalId.toString() })
      .andWhere('"status" = :status', {
        status: DataSecurityAiProposalStatus.Proposed,
      })
      .andWhere('"version" = :version', { version: data.atVersion })
      .andWhere('"firstApprovedByUserId" = :firstApprovedByUserId', {
        firstApprovedByUserId: data.firstApprovedByUserId,
      })
      .andWhere('"firstApprovedPlanFingerprint" = :planFingerprint', {
        planFingerprint: data.planFingerprint,
      })
      .andWhere('"deletedAt" IS NULL')
      .execute();

    return result.affected || 0;
  }

  /*
   * An issue whose check passed: each change made for it is proven - the
   * proof is the check, never OneUptime AI's word. Only the changes that
   * still stand, and only once.
   */
  @CaptureSpan()
  public async markProvenForIssue(data: {
    dataSecurityIssueId: ObjectID;
    at: Date;
  }): Promise<number> {
    const result: UpdateResult = await this.getRepository()
      .createQueryBuilder()
      .update(DataSecurityAiProposal)
      .set({
        verifiedAt: data.at,
      } as unknown as QueryDeepPartialEntity<DataSecurityAiProposal>)
      .where('"dataSecurityIssueId" = :issueId', {
        issueId: data.dataSecurityIssueId.toString(),
      })
      .andWhere('"status" IN (:...statuses)', {
        statuses: [
          DataSecurityAiProposalStatus.Applied,
          DataSecurityAiProposalStatus.AppliedWithoutAsking,
        ],
      })
      .andWhere('"verifiedAt" IS NULL')
      .andWhere('"deletedAt" IS NULL')
      .execute();

    return result.affected || 0;
  }

  /*
   * An issue that no longer needs anything - resolved, accepted, or set
   * aside: what still waits for a person for it expires.
   */
  @CaptureSpan()
  public async expireWaitingForIssue(data: {
    dataSecurityIssueId: ObjectID;
    at: Date;
  }): Promise<number> {
    const result: UpdateResult = await this.getRepository()
      .createQueryBuilder()
      .update(DataSecurityAiProposal)
      .set({
        status: DataSecurityAiProposalStatus.Expired,
        expiredAt: data.at,
      } as unknown as QueryDeepPartialEntity<DataSecurityAiProposal>)
      .where('"dataSecurityIssueId" = :issueId', {
        issueId: data.dataSecurityIssueId.toString(),
      })
      .andWhere('"status" = :status', {
        status: DataSecurityAiProposalStatus.Proposed,
      })
      .andWhere('"deletedAt" IS NULL')
      .execute();

    return result.affected || 0;
  }
}

export default new Service();
