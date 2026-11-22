import DataSecurityAiProposal from "../../../../Models/DatabaseModels/DataSecurityAiProposal";
import DataSecurityIssue from "../../../../Models/DatabaseModels/DataSecurityIssue";
import { DataSecurityIssueFeedEventType } from "../../../../Models/DatabaseModels/DataSecurityIssueFeed";
import DataStore from "../../../../Models/DatabaseModels/DataStore";
import { DataStoreFeedEventType } from "../../../../Models/DatabaseModels/DataStoreFeed";
import Project from "../../../../Models/DatabaseModels/Project";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Includes from "../../../../Types/BaseDatabase/Includes";
import {
  Gray500,
  Green500,
  Purple500,
  Red500,
  Yellow500,
} from "../../../../Types/BrandColors";
import Color from "../../../../Types/Color";
import OneUptimeDate from "../../../../Types/Date";
import {
  decodeRemediationApprovalStep,
  getRemediationApprovalStep,
  isSameApprover,
  isSameRemediationApprovalStep,
  RemediationApprovalStep,
  RemediationApprovalStepKind,
} from "../../../../Types/AutoRemediation/RemediationApprovals";
import {
  DATA_SECURITY_AI_PROPOSAL_KINDS,
  DataSecurityAiAskReason,
  DataSecurityAiChangeSafety,
  DataSecurityAiProposalKind,
  DataSecurityAiProposalStatus,
  DataSecurityAiWithoutAskingVerdict,
  DataSecurityAiWorkDecision,
  getDataSecurityAiApprovalsNeeded,
  getDataSecurityAiPlanFingerprint,
  getDataSecurityAiPlanLane,
  isDataSecurityAiProposalUndoable,
  isDataSecurityAiProposalWaiting,
} from "../../../../Types/DataSecurity/DataSecurityAi";
import {
  DataSecurityAiDecisionEntry,
  DataSecurityAiDecisionReason,
} from "../../../../Types/DataSecurity/DataSecurityAiDecision";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../../Types/Exception/NotFoundException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import Query from "../../../Types/Database/Query";
import FeedMarkdown, { mdText } from "../../../../Utils/Markdown/FeedMarkdown";
import DataSecurityAiProposalService from "../../../Services/DataSecurityAiProposalService";
import DataSecurityIssueFeedService from "../../../Services/DataSecurityIssueFeedService";
import DataSecurityIssueService from "../../../Services/DataSecurityIssueService";
import { NO_OWNER_CHECK_ID } from "../../../../Types/DataSecurity/DataSecurityCheckCatalog";
import DataStoreFeedService from "../../../Services/DataStoreFeedService";
import ProjectService from "../../../Services/ProjectService";
import logger from "../../Logger";
import CallerPermission from "../../Permission/CallerPermission";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import {
  DataSecurityAiAction,
  DataSecurityAiChangeMade,
  DataSecurityAiChangeUndone,
  DataSecurityAiPlannedChange,
} from "./DataSecurityAiAction";
import DataSecurityAiActions from "./DataSecurityAiActions";

/*
 * WHERE A PROPOSAL OF ONEUPTIME AI'S CHANGES STATE (#10364): made by the
 * engine (propose - and, where the rules allow and the change is safe, made
 * right away without asking), approved, dismissed or undone by a person
 * through Data Security's routes, expired or proven when its issue closes.
 *
 * A person's press is held to them, as an incident's fix is
 * (Utils/AutoRemediation/RemediationApproval):
 *
 *   - they must read the proposal (its table's read list: the issue's
 *     readers), else it is not found;
 *   - approving takes the permission the change itself takes (the action's
 *     getApproveRefusal: a scrub rule takes what creating one takes), and
 *     the change is made with the person's own props - a refusal there puts
 *     the proposal back, and nothing changed;
 *   - undoing takes what taking the change back takes; dismissing takes the
 *     permission to change the issue;
 *   - an approval names the plan its person was shown (the plan's
 *     fingerprint) and the step it was offered as: a proposal that changed,
 *     or a step that changed, does nothing;
 *   - a riskier change needs two people where the project asks for two
 *     (getDataSecurityAiApprovalsNeeded): the first approval is recorded,
 *     and the second, by someone else, makes the change.
 *
 * Every change of state is a claim (DataSecurityAiProposalService): of two
 * presses at once exactly one acts. Every one is written on the issue's and
 * the store's timelines - as OneUptime AI, or with the person who pressed.
 */

export interface DataSecurityAiProposalActionResult extends JSONObject {
  proposalId: string;
  status: DataSecurityAiProposalStatus;
  // A riskier change's first approval: it waits for someone else's.
  waitsForSecondApproval: boolean;
}

// The longest reason a dismissal keeps.
export const MAX_DISMISS_REASON_LENGTH: number = 500;

// Why a press lost to someone else's.
export const PROPOSAL_JUST_ACTED_ON_MESSAGE: string =
  "Someone else just acted on this proposal. Refresh to see where it stands.";

export const PROPOSAL_NOT_FOUND_MESSAGE: string =
  "This proposal could not be found.";

export const PROPOSAL_CHANGED_SINCE_SHOWN_MESSAGE: string =
  "This proposal changed since it was shown to you, so nothing was done. Look at what it changes now before you approve.";

export const PROPOSAL_APPROVER_MUST_BE_A_PERSON_MESSAGE: string =
  "A proposal is approved by a person signed in to OneUptime, so nothing was done.";

export const PROPOSAL_ALREADY_APPROVED_FIRST_MESSAGE: string =
  "You already approved this change. It is a riskier change, and this project asks two people to approve one, so it is made once someone else approves it too.";

export const PROPOSAL_TAKES_NO_CHANGES_MESSAGE: string =
  "This kind of proposal is approved as OneUptime AI proposed it, so nothing was done. Approve it as it is, or dismiss it.";

export const PROPOSAL_TWO_APPROVALS_TAKE_NO_CHANGES_MESSAGE: string =
  "A change two people approve is approved as it was proposed, so nothing was done. Approve it as it is, or dismiss it.";

export const DISMISS_REASON_REQUIRED_MESSAGE: string =
  "Say why you are dismissing this proposal, so OneUptime AI and your team know.";

export const DISMISS_PERMISSION_MESSAGE: string =
  "Dismissing a proposal takes the permission to change Data Security issues.";

// The permissions that may dismiss: whoever may change the issue.
export const DISMISS_PROPOSAL_PERMISSIONS: ReadonlyArray<Permission> =
  new DataSecurityIssue().updateRecordPermissions;

/*
 * Why a press of an approval whose step changed did nothing, in a
 * proposal's words: what the press would do now.
 */
export function getProposalApprovalStepChangedMessage(
  now: RemediationApprovalStep,
): string {
  if (now.kind === RemediationApprovalStepKind.Second) {
    return "Someone else approved this change while you were reviewing it, so approving it now would make it. Nothing was done: review it again before you approve.";
  }

  if (now.kind === RemediationApprovalStepKind.First) {
    return "This change now needs two people to approve it, and yours would be the first. Nothing was done: review it again before you approve.";
  }

  return "One approval now makes this change, so yours would make it. Nothing was done: review it again before you approve.";
}

function idText(value: ObjectID | undefined | null): string {
  return value ? value.toString() : "";
}

function messageOf(error: unknown): string {
  const message: string =
    error instanceof Error ? error.message : String(error || "");

  // As much as the proposal's Why It Failed holds.
  return message.slice(0, 500) || "The change could not be made.";
}

function readCountedFirstApprover(
  proposal: DataSecurityAiProposal,
  planFingerprint: string,
): ObjectID | undefined {
  return proposal.firstApprovedByUserId &&
    proposal.firstApprovedPlanFingerprint === planFingerprint
    ? proposal.firstApprovedByUserId
    : undefined;
}

export default class DataSecurityAiProposals {
  /*
   * The proposal a person pressed, read as them: one they may not read - or
   * of another project - is not found, the same either way.
   */
  public static async readForPerson(data: {
    props: DatabaseCommonInteractionProps;
    projectId: ObjectID;
    proposalId: unknown;
  }): Promise<DataSecurityAiProposal> {
    const id: string =
      typeof data.proposalId === "string" ? data.proposalId.trim() : "";

    if (!ObjectID.isValidUUID(id)) {
      throw new NotFoundException(PROPOSAL_NOT_FOUND_MESSAGE);
    }

    const readable: DataSecurityAiProposal | null =
      await DataSecurityAiProposalService.findOneBy({
        query: { _id: new ObjectID(id), projectId: data.projectId },
        select: { _id: true },
        props: data.props,
      });

    if (!readable?.id) {
      throw new NotFoundException(PROPOSAL_NOT_FOUND_MESSAGE);
    }

    const proposal: DataSecurityAiProposal | null =
      await DataSecurityAiProposalService.findOneBy({
        query: { _id: readable.id, projectId: data.projectId },
        select: {
          _id: true,
          version: true,
          projectId: true,
          dataSecurityIssueId: true,
          dataStoreId: true,
          kind: true,
          work: true,
          safety: true,
          status: true,
          title: true,
          plan: true,
          planFingerprint: true,
          result: true,
          firstApprovedByUserId: true,
          firstApprovedPlanFingerprint: true,
        },
        props: { isRoot: true },
      });

    if (!proposal?.id) {
      throw new NotFoundException(PROPOSAL_NOT_FOUND_MESSAGE);
    }

    return proposal;
  }

  private static actionOf(
    proposal: DataSecurityAiProposal,
  ): DataSecurityAiAction {
    const action: DataSecurityAiAction | null = DataSecurityAiActions.get(
      proposal.kind,
    );

    if (!action) {
      throw new BadDataException(
        "This kind of proposal is not one this version of OneUptime can make, so nothing was done.",
      );
    }

    return action;
  }

  // What the issue's and the store's timelines say, once each.
  public static async writeTimelines(data: {
    projectId: ObjectID;
    proposal: Pick<
      DataSecurityAiProposal,
      "dataSecurityIssueId" | "dataStoreId"
    > & { id?: ObjectID | null | undefined };
    issueEvent: DataSecurityIssueFeedEventType;
    storeEvent: DataStoreFeedEventType;
    markdown: string;
    moreInformationInMarkdown?: string | undefined;
    color: Color;
    userId?: ObjectID | undefined;
  }): Promise<void> {
    if (data.proposal.dataSecurityIssueId) {
      await DataSecurityIssueFeedService.createDataSecurityIssueFeedItem({
        projectId: data.projectId,
        dataSecurityIssueId: data.proposal.dataSecurityIssueId,
        eventType: data.issueEvent,
        displayColor: data.color,
        feedInfoInMarkdown: data.markdown,
        moreInformationInMarkdown: data.moreInformationInMarkdown,
        userId: data.userId,
        // The entry's Undo, Approve or Dismiss reads the proposal by it (#10366).
        ...(data.proposal.id
          ? {
              dataSecurityAiProposalId: new ObjectID(
                data.proposal.id.toString(),
              ),
            }
          : {}),
      });
    }

    if (data.proposal.dataStoreId) {
      await DataStoreFeedService.createDataStoreFeedItem({
        projectId: data.projectId,
        dataStoreId: data.proposal.dataStoreId,
        dataStoreFeedEventType: data.storeEvent,
        displayColor: data.color,
        feedInfoInMarkdown: data.markdown,
        moreInformationInMarkdown: data.moreInformationInMarkdown,
        userId: data.userId,
      });
    }
  }

  /*
   * The proposals that are for the same thing as a new one, of its kind:
   * an issue's; a store's owners, whatever issue they hang on (#10374);
   * an owner rule's, by the rule it is - its plan key - since each rule is
   * a thing of its own.
   */
  public static getSameSubjectQuery(data: {
    projectId: ObjectID;
    kind: DataSecurityAiProposalKind;
    issue?: DataSecurityIssue | null | undefined;
    store?: DataStore | null | undefined;
    planKey: string;
  }): Query<DataSecurityAiProposal> {
    if (data.kind === DataSecurityAiProposalKind.CreateOwnerRule) {
      return {
        projectId: data.projectId,
        kind: data.kind,
        planKey: data.planKey.slice(0, 100),
      };
    }

    if (data.kind === DataSecurityAiProposalKind.SetStoreOwners) {
      if (!data.store?.id) {
        throw new BadDataException("An owner proposal is for a store.");
      }

      return {
        projectId: data.projectId,
        kind: data.kind,
        dataStoreId: data.store.id,
      };
    }

    if (!data.issue?.id) {
      throw new BadDataException(`A ${data.kind} proposal is for an issue.`);
    }

    return {
      projectId: data.projectId,
      kind: data.kind,
      dataSecurityIssueId: data.issue.id,
    };
  }

  /*
   * A change an action planned, recorded as a proposal - and, where the
   * verdict lets it run without asking, made right away as OneUptime AI.
   * The same change proposed for the same thing before (its plan key) is
   * not proposed again, unless that one expired; a plan of the same kind
   * that differs replaces the one still waiting. What happened is the entry
   * Why AI did not act reads.
   */
  @CaptureSpan()
  public static async propose(data: {
    projectId: ObjectID;
    /*
     * The issue it is for - none for an owner rule, or for the owners of a
     * store with no issue (#10374) - and its store: none for an owner rule.
     */
    issue?: DataSecurityIssue | null | undefined;
    store?: DataStore | null | undefined;
    // The action that planned the change: it makes it, too.
    action: DataSecurityAiAction;
    change: DataSecurityAiPlannedChange;
    work: DataSecurityAiWorkDecision;
    verdict: DataSecurityAiWithoutAskingVerdict;
    aiRunId?: ObjectID | undefined;
    // Where it waits among the rest: the issue's risk score unless given.
    riskScore?: number | undefined;
    now: Date;
  }): Promise<DataSecurityAiDecisionEntry> {
    const kind: DataSecurityAiProposalKind = data.action.kind;
    const work: DataSecurityAiDecisionEntry["work"] =
      DATA_SECURITY_AI_PROPOSAL_KINDS[kind].work;
    const entry: (
      reason: DataSecurityAiDecisionReason,
      more?: Partial<DataSecurityAiDecisionEntry>,
    ) => DataSecurityAiDecisionEntry = (
      reason: DataSecurityAiDecisionReason,
      more?: Partial<DataSecurityAiDecisionEntry>,
    ): DataSecurityAiDecisionEntry => {
      return {
        work,
        reason,
        kind,
        ruleId: data.work.ruleId,
        ruleName: data.work.ruleName,
        ...more,
      };
    };

    const earlier: Array<DataSecurityAiProposal> =
      await DataSecurityAiProposalService.findBy({
        query: DataSecurityAiProposals.getSameSubjectQuery({
          projectId: data.projectId,
          kind,
          issue: data.issue,
          store: data.store,
          planKey: data.change.planKey,
        }),
        select: { _id: true, status: true, planKey: true },
        skip: 0,
        limit: 100,
        props: { isRoot: true },
      });

    const same: DataSecurityAiProposal | undefined = earlier.find(
      (proposal: DataSecurityAiProposal): boolean => {
        return (
          proposal.planKey === data.change.planKey &&
          proposal.status !== DataSecurityAiProposalStatus.Expired
        );
      },
    );

    if (same?.id) {
      return entry(DataSecurityAiDecisionReason.AlreadyProposed, {
        proposalId: same.id.toString(),
      });
    }

    /*
     * A newer plan of the same kind replaces the one still waiting - but
     * every owner rule is a thing of its own, and replaces none. A kind
     * that plans changes in lanes - Scrub It rules that may run on their
     * own beside those that must wait (#10366) - replaces only the waiting
     * one of the same lane: the planKey's text before its first ":".
     */
    const lane: string = getDataSecurityAiPlanLane(data.change.planKey);
    const replaced: Array<DataSecurityAiProposal> =
      kind === DataSecurityAiProposalKind.CreateOwnerRule
        ? []
        : earlier.filter((proposal: DataSecurityAiProposal): boolean => {
            return getDataSecurityAiPlanLane(proposal.planKey || "") === lane;
          });

    for (const waiting of replaced) {
      if (waiting.id && isDataSecurityAiProposalWaiting(waiting.status)) {
        await DataSecurityAiProposalService.attemptTransition({
          proposalId: waiting.id,
          fromStatuses: [DataSecurityAiProposalStatus.Proposed],
          set: {
            status: DataSecurityAiProposalStatus.Expired,
            expiredAt: data.now,
          },
        });
      }
    }

    const safety: DataSecurityAiChangeSafety =
      data.change.safety || DATA_SECURITY_AI_PROPOSAL_KINDS[kind].safety;
    const proposal: DataSecurityAiProposal = new DataSecurityAiProposal();

    proposal.projectId = data.projectId;

    if (data.issue?.id) {
      proposal.dataSecurityIssueId = data.issue.id;
    }

    if (data.store?.id) {
      proposal.dataStoreId = data.store.id;
    }

    proposal.kind = kind;
    proposal.work = work;
    proposal.safety = safety;
    proposal.status = DataSecurityAiProposalStatus.Proposed;
    proposal.title = data.change.title.slice(0, 500);
    proposal.changeMarkdown = data.change.changeMarkdown;
    proposal.reasonMarkdown = data.change.reasonMarkdown;
    proposal.proofMarkdown = data.change.proofMarkdown;
    proposal.undoMarkdown = data.change.undoMarkdown;
    proposal.plan = data.change.plan;
    proposal.planKey = data.change.planKey.slice(0, 100);
    proposal.planFingerprint = getDataSecurityAiPlanFingerprint({
      kind,
      plan: data.change.plan,
    });
    proposal.riskScore = data.riskScore ?? (data.issue?.riskScore || 0);
    proposal.autonomy = data.work.autonomy;

    // Why it waits, where OneUptime AI could have made it on its own.
    if (
      !data.verdict.runWithoutAsking &&
      data.verdict.askReason &&
      data.verdict.askReason !== DataSecurityAiAskReason.WorkAsksFirst
    ) {
      proposal.askReason = data.verdict.askReason;
    }

    if (data.work.ruleId && ObjectID.isValidUUID(data.work.ruleId)) {
      proposal.autoRemediationRuleId = new ObjectID(data.work.ruleId);
      proposal.autoRemediationRuleName = (data.work.ruleName || "").slice(
        0,
        100,
      );
    }

    if (data.aiRunId) {
      proposal.aiRunId = data.aiRunId;
    }

    const created: DataSecurityAiProposal =
      await DataSecurityAiProposalService.create({
        data: proposal,
        props: { isRoot: true },
      });
    const proposalId: string = created.id?.toString() || "";

    if (data.action.onProposed) {
      try {
        await data.action.onProposed({ projectId: data.projectId });
      } catch (error) {
        logger.error(
          `DataSecurity AI: what follows proposal ${proposalId} could not be queued: ${error}`,
        );
      }
    }

    if (!data.verdict.runWithoutAsking) {
      await DataSecurityAiProposals.writeTimelines({
        projectId: data.projectId,
        proposal: created,
        issueEvent: DataSecurityIssueFeedEventType.AiProposed,
        storeEvent: DataStoreFeedEventType.AiProposed,
        color: Purple500,
        markdown:
          mdText`OneUptime AI proposes: **${proposal.title}**. It waits for a person to approve or dismiss it in Data Security > AI.`.toString(),
        moreInformationInMarkdown: data.change.changeMarkdown,
      });

      return entry(DataSecurityAiDecisionReason.Proposed, {
        proposalId,
        askReason: proposal.askReason || undefined,
      });
    }

    return await DataSecurityAiProposals.makeWithoutAsking({
      projectId: data.projectId,
      proposal: created,
      action: data.action,
      entry,
    });
  }

  /*
   * A change OneUptime AI makes on its own: claimed from Proposed (so a
   * person's approval at the same moment makes it once), made as OneUptime,
   * and written on the timelines with how to undo it. A failure leaves
   * nothing changed and says why.
   */
  private static async makeWithoutAsking(data: {
    projectId: ObjectID;
    proposal: DataSecurityAiProposal;
    action: DataSecurityAiAction;
    entry: (
      reason: DataSecurityAiDecisionReason,
      more?: Partial<DataSecurityAiDecisionEntry>,
    ) => DataSecurityAiDecisionEntry;
  }): Promise<DataSecurityAiDecisionEntry> {
    const proposalId: ObjectID = new ObjectID(data.proposal.id!.toString());
    const now: Date = OneUptimeDate.getCurrentDate();
    const claimed: number =
      await DataSecurityAiProposalService.attemptTransition({
        proposalId,
        fromStatuses: [DataSecurityAiProposalStatus.Proposed],
        set: { status: DataSecurityAiProposalStatus.Approved, approvedAt: now },
      });

    if (claimed === 0) {
      return data.entry(DataSecurityAiDecisionReason.Proposed, {
        proposalId: proposalId.toString(),
      });
    }

    try {
      const made: DataSecurityAiChangeMade = await data.action.apply({
        projectId: data.projectId,
        proposal: data.proposal,
        actor: { props: { isRoot: true } },
      });

      await DataSecurityAiProposalService.attemptTransition({
        proposalId,
        fromStatuses: [DataSecurityAiProposalStatus.Approved],
        set: {
          status: DataSecurityAiProposalStatus.AppliedWithoutAsking,
          appliedAt: OneUptimeDate.getCurrentDate(),
          result: made.result,
        },
      });

      await DataSecurityAiProposals.writeTimelines({
        projectId: data.projectId,
        proposal: data.proposal,
        issueEvent: DataSecurityIssueFeedEventType.AiChangeMade,
        storeEvent: DataStoreFeedEventType.AiChangeMade,
        color: Green500,
        markdown: FeedMarkdown.join(
          [
            mdText`OneUptime AI made this change without asking, as the project's AI rules allow: **${data.proposal.title || ""}**.`,
            mdText`${FeedMarkdown.asMarkdown(made.summaryMarkdown)} Undo it here, or from Data Security > AI.`,
          ],
          " ",
        ).toString(),
        // How it was proven, under the entry (#10366).
        moreInformationInMarkdown: made.detailsMarkdown || undefined,
      });

      // Who is told beyond the timelines: never a reason the change fails.
      if (data.action.onMadeWithoutAsking) {
        try {
          await data.action.onMadeWithoutAsking({
            projectId: data.projectId,
            proposal: data.proposal,
            made,
          });
        } catch (error) {
          logger.error(
            `DataSecurity AI: could not tell anyone of change ${proposalId.toString()} of project ${data.projectId.toString()}: ${error}`,
          );
        }
      }

      return data.entry(DataSecurityAiDecisionReason.AppliedWithoutAsking, {
        proposalId: proposalId.toString(),
      });
    } catch (error) {
      await DataSecurityAiProposals.recordFailure({
        projectId: data.projectId,
        proposal: data.proposal,
        error,
      });

      return data.entry(DataSecurityAiDecisionReason.ApplyFailed, {
        proposalId: proposalId.toString(),
        detail: "apply-failed",
      });
    }
  }

  private static async recordFailure(data: {
    projectId: ObjectID;
    proposal: DataSecurityAiProposal;
    error: unknown;
    userId?: ObjectID | undefined;
  }): Promise<void> {
    const message: string = messageOf(data.error);

    logger.error(
      `DataSecurity AI: could not make proposal ${idText(data.proposal.id)} of project ${data.projectId.toString()}: ${message}`,
    );

    await DataSecurityAiProposalService.attemptTransition({
      proposalId: data.proposal.id!,
      fromStatuses: [DataSecurityAiProposalStatus.Approved],
      set: {
        status: DataSecurityAiProposalStatus.Failed,
        failedAt: OneUptimeDate.getCurrentDate(),
        failureMessage: message,
      },
    });

    await DataSecurityAiProposals.writeTimelines({
      projectId: data.projectId,
      proposal: data.proposal,
      issueEvent: DataSecurityIssueFeedEventType.AiChangeFailed,
      storeEvent: DataStoreFeedEventType.AiChangeFailed,
      color: Red500,
      markdown:
        mdText`The change OneUptime AI proposed could not be made, and nothing changed: ${message}`.toString(),
      userId: data.userId,
    });
  }

  /*
   * A person approves a proposal: the change is made as them, with their
   * permissions - or, for a riskier change where the project asks two
   * people, their approval is recorded and the change waits for someone
   * else's. A person may change it first where its kind takes changes
   * ("change one first": another owner, #10374): what they approve is then
   * what they changed it to, held to what the kind allows. A change two
   * people approve is approved as it was proposed.
   */
  @CaptureSpan()
  public static async approve(data: {
    props: DatabaseCommonInteractionProps;
    projectId: ObjectID;
    proposalId: unknown;
    expectedPlanFingerprint?: unknown;
    expectedApprovalStep?: unknown;
    changes?: unknown;
  }): Promise<DataSecurityAiProposalActionResult> {
    const proposal: DataSecurityAiProposal =
      await DataSecurityAiProposals.readForPerson(data);
    const userId: ObjectID | undefined = data.props.userId || undefined;

    if (!userId) {
      throw new BadDataException(PROPOSAL_APPROVER_MUST_BE_A_PERSON_MESSAGE);
    }

    if (!isDataSecurityAiProposalWaiting(proposal.status)) {
      throw new BadDataException(PROPOSAL_JUST_ACTED_ON_MESSAGE);
    }

    const planFingerprint: string = getDataSecurityAiPlanFingerprint(proposal);

    if (
      data.expectedPlanFingerprint !== undefined &&
      data.expectedPlanFingerprint !== null &&
      data.expectedPlanFingerprint !== planFingerprint
    ) {
      throw new BadDataException(PROPOSAL_CHANGED_SINCE_SHOWN_MESSAGE);
    }

    const action: DataSecurityAiAction =
      DataSecurityAiProposals.actionOf(proposal);
    let changes: JSONObject | undefined;

    if (data.changes !== undefined && data.changes !== null) {
      if (!action.readChanges) {
        throw new BadDataException(PROPOSAL_TAKES_NO_CHANGES_MESSAGE);
      }

      changes = await action.readChanges({
        projectId: data.projectId,
        proposal,
        changes: data.changes,
      });
    }

    const refusal: string | null = action.getApproveRefusal({
      props: data.props,
      proposal,
      changes,
    });

    if (refusal) {
      throw new NotAuthorizedException(refusal);
    }

    const project: Project | null = await ProjectService.findOneById({
      id: data.projectId,
      select: { _id: true, requireTwoApprovalsForRiskierFixes: true },
      props: { isRoot: true },
    });

    if (!project) {
      throw new NotFoundException(PROPOSAL_NOT_FOUND_MESSAGE);
    }

    const step: RemediationApprovalStep = getRemediationApprovalStep({
      approvalsNeeded: getDataSecurityAiApprovalsNeeded({
        requireTwoApprovalsForRiskierChanges:
          project.requireTwoApprovalsForRiskierFixes === true,
        safety: proposal.safety,
      }),
      firstApprovedByUserId: readCountedFirstApprover(
        proposal,
        planFingerprint,
      ),
    });

    if (data.expectedApprovalStep !== undefined) {
      const offered: RemediationApprovalStep | null =
        decodeRemediationApprovalStep(data.expectedApprovalStep);

      if (!offered || !isSameRemediationApprovalStep(offered, step)) {
        throw new BadDataException(getProposalApprovalStepChangedMessage(step));
      }
    }

    // What two people approve is the plan both were shown.
    if (changes && step.kind !== RemediationApprovalStepKind.Only) {
      throw new BadDataException(
        PROPOSAL_TWO_APPROVALS_TAKE_NO_CHANGES_MESSAGE,
      );
    }

    const now: Date = OneUptimeDate.getCurrentDate();

    if (step.kind === RemediationApprovalStepKind.First) {
      const recorded: number =
        await DataSecurityAiProposalService.attemptFirstApproval({
          proposalId: proposal.id!,
          atVersion: proposal.version || 0,
          set: {
            firstApprovedByUserId: userId.toString(),
            firstApprovedAt: now,
            firstApprovedPlanFingerprint: planFingerprint,
          },
        });

      if (recorded === 0) {
        throw new BadDataException(PROPOSAL_JUST_ACTED_ON_MESSAGE);
      }

      await DataSecurityAiProposals.writeTimelines({
        projectId: data.projectId,
        proposal,
        issueEvent: DataSecurityIssueFeedEventType.AiProposalApproved,
        storeEvent: DataStoreFeedEventType.AiProposalApproved,
        color: Yellow500,
        markdown:
          mdText`Approved OneUptime AI's proposal **${proposal.title || ""}**. It is a riskier change, so it is made once someone else approves it too.`.toString(),
        userId,
      });

      return {
        proposalId: proposal.id!.toString(),
        status: DataSecurityAiProposalStatus.Proposed,
        waitsForSecondApproval: true,
      };
    }

    let claimed: number = 0;

    if (step.kind === RemediationApprovalStepKind.Second) {
      if (isSameApprover(step.firstApprovedByUserId, userId)) {
        throw new BadDataException(PROPOSAL_ALREADY_APPROVED_FIRST_MESSAGE);
      }

      claimed = await DataSecurityAiProposalService.attemptSecondApproval({
        proposalId: proposal.id!,
        atVersion: proposal.version || 0,
        firstApprovedByUserId: proposal.firstApprovedByUserId!.toString(),
        planFingerprint,
        set: {
          status: DataSecurityAiProposalStatus.Approved,
          approvedByUserId: userId.toString(),
          approvedAt: now,
        },
      });
    } else {
      claimed = await DataSecurityAiProposalService.attemptTransition({
        proposalId: proposal.id!,
        fromStatuses: [DataSecurityAiProposalStatus.Proposed],
        atVersion: proposal.version || 0,
        set: {
          status: DataSecurityAiProposalStatus.Approved,
          approvedByUserId: userId.toString(),
          approvedAt: now,
        },
      });
    }

    if (claimed === 0) {
      throw new BadDataException(PROPOSAL_JUST_ACTED_ON_MESSAGE);
    }

    let made: DataSecurityAiChangeMade;

    try {
      made = await action.apply({
        projectId: data.projectId,
        proposal,
        actor: { props: data.props, userId },
        changes,
      });
    } catch (error) {
      // Refused for the person: nothing changed, and it waits again.
      if (error instanceof NotAuthorizedException) {
        await DataSecurityAiProposalService.attemptTransition({
          proposalId: proposal.id!,
          fromStatuses: [DataSecurityAiProposalStatus.Approved],
          set: {
            status: DataSecurityAiProposalStatus.Proposed,
            approvedByUserId: null,
            approvedAt: null,
          },
        });

        throw error;
      }

      await DataSecurityAiProposals.recordFailure({
        projectId: data.projectId,
        proposal,
        error,
        userId,
      });

      throw new BadDataException(
        `The change could not be made, and nothing changed. ${messageOf(error)}`,
      );
    }

    await DataSecurityAiProposalService.attemptTransition({
      proposalId: proposal.id!,
      fromStatuses: [DataSecurityAiProposalStatus.Approved],
      set: {
        status: DataSecurityAiProposalStatus.Applied,
        appliedAt: OneUptimeDate.getCurrentDate(),
        result: made.result,
      },
    });

    await DataSecurityAiProposals.writeTimelines({
      projectId: data.projectId,
      proposal,
      issueEvent: DataSecurityIssueFeedEventType.AiChangeMade,
      storeEvent: DataStoreFeedEventType.AiChangeMade,
      color: Green500,
      markdown: FeedMarkdown.join(
        [
          changes
            ? mdText`Approved OneUptime AI's proposal **${proposal.title || ""}** after changing it, and the change was made with this person's permissions.`
            : mdText`Approved OneUptime AI's proposal **${proposal.title || ""}**, and the change was made with this person's permissions.`,
          FeedMarkdown.asMarkdown(made.summaryMarkdown),
        ],
        " ",
      ).toString(),
      // How it was proven, and what a person still must do, under the entry (#10366).
      moreInformationInMarkdown: made.detailsMarkdown || undefined,
      userId,
    });

    return {
      proposalId: proposal.id!.toString(),
      status: DataSecurityAiProposalStatus.Applied,
      waitsForSecondApproval: false,
    };
  }

  /*
   * A person says no, with a reason: the proposal stays on the record, and
   * OneUptime AI does not propose the same change for the issue again.
   */
  @CaptureSpan()
  public static async dismiss(data: {
    props: DatabaseCommonInteractionProps;
    projectId: ObjectID;
    proposalId: unknown;
    reason: unknown;
  }): Promise<DataSecurityAiProposalActionResult> {
    const proposal: DataSecurityAiProposal =
      await DataSecurityAiProposals.readForPerson(data);
    const userId: ObjectID | undefined = data.props.userId || undefined;
    const reason: string =
      typeof data.reason === "string" ? data.reason.trim() : "";

    if (!userId) {
      throw new BadDataException(PROPOSAL_APPROVER_MUST_BE_A_PERSON_MESSAGE);
    }

    if (
      !data.props.isMasterAdmin &&
      !CallerPermission.holdsAnyOf(data.props, DISMISS_PROPOSAL_PERMISSIONS)
    ) {
      throw new NotAuthorizedException(DISMISS_PERMISSION_MESSAGE);
    }

    if (!reason) {
      throw new BadDataException(DISMISS_REASON_REQUIRED_MESSAGE);
    }

    if (!isDataSecurityAiProposalWaiting(proposal.status)) {
      throw new BadDataException(PROPOSAL_JUST_ACTED_ON_MESSAGE);
    }

    const dismissed: number =
      await DataSecurityAiProposalService.attemptTransition({
        proposalId: proposal.id!,
        fromStatuses: [DataSecurityAiProposalStatus.Proposed],
        set: {
          status: DataSecurityAiProposalStatus.Dismissed,
          dismissedByUserId: userId.toString(),
          dismissedAt: OneUptimeDate.getCurrentDate(),
          dismissReason: reason.slice(0, MAX_DISMISS_REASON_LENGTH),
        },
      });

    if (dismissed === 0) {
      throw new BadDataException(PROPOSAL_JUST_ACTED_ON_MESSAGE);
    }

    await DataSecurityAiProposals.writeTimelines({
      projectId: data.projectId,
      proposal,
      issueEvent: DataSecurityIssueFeedEventType.AiProposalDismissed,
      storeEvent: DataStoreFeedEventType.AiProposalDismissed,
      color: Gray500,
      markdown:
        mdText`Dismissed OneUptime AI's proposal **${proposal.title || ""}**: ${reason.slice(0, MAX_DISMISS_REASON_LENGTH)}`.toString(),
      userId,
    });

    return {
      proposalId: proposal.id!.toString(),
      status: DataSecurityAiProposalStatus.Dismissed,
      waitsForSecondApproval: false,
    };
  }

  /*
   * A person takes a change back - one OneUptime AI made without asking, or
   * one approved - as them, with their permissions. A refusal leaves the
   * change as it was.
   */
  @CaptureSpan()
  public static async undo(data: {
    props: DatabaseCommonInteractionProps;
    projectId: ObjectID;
    proposalId: unknown;
  }): Promise<DataSecurityAiProposalActionResult> {
    const proposal: DataSecurityAiProposal =
      await DataSecurityAiProposals.readForPerson(data);
    const userId: ObjectID | undefined = data.props.userId || undefined;

    if (!userId) {
      throw new BadDataException(PROPOSAL_APPROVER_MUST_BE_A_PERSON_MESSAGE);
    }

    if (!isDataSecurityAiProposalUndoable(proposal.status)) {
      throw new BadDataException(
        "Only a change that was made can be undone, and this one was not, or was undone already.",
      );
    }

    const action: DataSecurityAiAction =
      DataSecurityAiProposals.actionOf(proposal);
    const refusal: string | null = action.getUndoRefusal({
      props: data.props,
      proposal,
    });

    if (refusal) {
      throw new NotAuthorizedException(refusal);
    }

    const before: DataSecurityAiProposalStatus = proposal.status!;
    const claimed: number =
      await DataSecurityAiProposalService.attemptTransition({
        proposalId: proposal.id!,
        fromStatuses: [before],
        atVersion: proposal.version || 0,
        set: {
          status: DataSecurityAiProposalStatus.Undone,
          undoneByUserId: userId.toString(),
          undoneAt: OneUptimeDate.getCurrentDate(),
        },
      });

    if (claimed === 0) {
      throw new BadDataException(PROPOSAL_JUST_ACTED_ON_MESSAGE);
    }

    let undone: DataSecurityAiChangeUndone;

    try {
      undone = await action.undo({
        projectId: data.projectId,
        proposal,
        actor: { props: data.props, userId },
      });
    } catch (error) {
      // Not undone: the change stands as it was.
      await DataSecurityAiProposalService.attemptTransition({
        proposalId: proposal.id!,
        fromStatuses: [DataSecurityAiProposalStatus.Undone],
        set: { status: before, undoneByUserId: null, undoneAt: null },
      });

      throw error;
    }

    await DataSecurityAiProposals.writeTimelines({
      projectId: data.projectId,
      proposal,
      issueEvent: DataSecurityIssueFeedEventType.AiChangeUndone,
      storeEvent: DataStoreFeedEventType.AiChangeUndone,
      color: Gray500,
      markdown: FeedMarkdown.join(
        [
          mdText`Undid **${proposal.title || ""}**, which OneUptime AI ${before === DataSecurityAiProposalStatus.AppliedWithoutAsking ? "made without asking" : "proposed"}.`,
          FeedMarkdown.asMarkdown(undone.summaryMarkdown),
        ],
        " ",
      ).toString(),
      userId,
    });

    return {
      proposalId: proposal.id!.toString(),
      status: DataSecurityAiProposalStatus.Undone,
      waitsForSecondApproval: false,
    };
  }

  /*
   * An issue that closed: its check passed - each change made for it is
   * proven, the proof being the check - or it was resolved some other way,
   * accepted or set aside. Either way, what still waits for a person for
   * it is no longer needed. Never throws: the issue closed whatever this
   * could write.
   */
  @CaptureSpan()
  public static async onIssuesClosed(data: {
    issueIds: Array<ObjectID>;
    checkPassed: boolean;
    now?: Date | undefined;
  }): Promise<void> {
    const at: Date = data.now || OneUptimeDate.getCurrentDate();

    for (const issueId of data.issueIds) {
      try {
        if (data.checkPassed) {
          await DataSecurityAiProposalService.markProvenForIssue({
            dataSecurityIssueId: issueId,
            at,
          });
        }

        await DataSecurityAiProposalService.expireWaitingForIssue({
          dataSecurityIssueId: issueId,
          at,
        });
      } catch (error) {
        logger.error(
          `DataSecurity AI: could not settle the proposals of closed issue ${issueId.toString()}: ${error}`,
        );
      }

      /*
       * Apart from the issue's own proposals: an owner rule that could not
       * be read as proven never keeps them waiting.
       */
      if (data.checkPassed) {
        try {
          await DataSecurityAiProposals.proveOwnerRules({ issueId, at });
        } catch (error) {
          logger.error(
            `DataSecurity AI: could not prove the owner rules of closed issue ${issueId.toString()}: ${error}`,
          );
        }
      }
    }
  }

  /*
   * A store's "Nobody owns this sensitive store" passed: an owner rule
   * OneUptime AI proposed that set owners on the store is proven by it
   * (#10374), as a store's own owners are by their issue's check.
   */
  private static async proveOwnerRules(data: {
    issueId: ObjectID;
    at: Date;
  }): Promise<void> {
    const issue: DataSecurityIssue | null =
      await DataSecurityIssueService.findOneById({
        id: data.issueId,
        select: {
          _id: true,
          projectId: true,
          checkId: true,
          dataStoreId: true,
        },
        props: { isRoot: true },
      });

    if (
      !issue?.projectId ||
      !issue.dataStoreId ||
      issue.checkId !== NO_OWNER_CHECK_ID
    ) {
      return;
    }

    await DataSecurityAiProposalService.markOwnerRuleProvenForStore({
      projectId: issue.projectId,
      dataStoreId: issue.dataStoreId,
      at: data.at,
    });
  }

  // How many proposals of the project wait for a person: the side menu's count.
  public static async countWaiting(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<number> {
    return (
      await DataSecurityAiProposalService.countBy({
        query: {
          projectId: data.projectId,
          status: new Includes([DataSecurityAiProposalStatus.Proposed]),
        },
        props: data.props,
      })
    ).toNumber();
  }
}
