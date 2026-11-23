import AutoRemediationRule from "../../../../Models/DatabaseModels/AutoRemediationRule";
import DataSecurityIssueGroup from "../../../../Models/DatabaseModels/DataSecurityIssueGroup";
import Project from "../../../../Models/DatabaseModels/Project";
import { sha256Hex } from "../../../../Types/AutoRemediation/RemediationPlanFingerprint";
import OneUptimeDate from "../../../../Types/Date";
import {
  DataSecurityAiChangeSafety,
  DataSecurityAiAutonomy,
  DataSecurityAiPlan,
  DataSecurityAiProposalKind,
  DataSecurityAiWork,
  DataSecurityAiWorkDecision,
  decideDataSecurityAiWork,
  getDataSecurityAiWithoutAskingVerdict,
} from "../../../../Types/DataSecurity/DataSecurityAi";
import {
  DataSecurityCheckInfo,
  getDataSecurityCheck,
} from "../../../../Types/DataSecurity/DataSecurityCheckCatalog";
import {
  DataSecurityIssueGroupFacts,
  describeIssueGroupCause,
  readDataSecurityIssueGroupFacts,
} from "../../../../Types/DataSecurity/DataSecurityIssueGroup";
import {
  DataSecurityIssueGroupFixPart,
  DataSecurityIssueGroupFixPlanJSON,
  DataSecurityIssueGroupFixStoreJSON,
  DataSecurityIssueGroupLeftOutJSON,
  DataSecurityIssueGroupLeftOutReason,
} from "../../../../Types/DataSecurity/DataSecurityIssueGroupFix";
import { EXPOSURE_RESPONSE_ACTIONS } from "../../../../Types/DataSecurity/DataSecurityResponseAction";
import ObjectID from "../../../../Types/ObjectID";
import { DeclaredCodeChangeState } from "../../../../Utils/AiRemediation/DeclaredCodeChange";
import FeedMarkdown, { mdText } from "../../../../Utils/Markdown/FeedMarkdown";
import DataSecurityIssueGroupService from "../../../Services/DataSecurityIssueGroupService";
import ProjectService from "../../../Services/ProjectService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import DataSecurityIssueGroupFix, {
  GroupFixMember,
} from "../../DataSecurity/DataSecurityIssueGroupFix";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import {
  FixIssueGroupInCloudAction,
  FixIssueGroupInCodeAction,
} from "./Actions/IssueGroupFixActions";
import { DataSecurityAiPlannedChange } from "./DataSecurityAiAction";
import DataSecurityAiEngine from "./DataSecurityAiEngine";
import DataSecurityAiProposals from "./DataSecurityAiProposals";

/*
 * ONEUPTIME AI PROPOSES THE FIX OF EACH GROUP OF ISSUES ONE MISTAKE MADE
 * (#10370), UNDER THE PROJECT'S RULES (#10364).
 *
 * After each grouping, for each open group whose issues or facts changed,
 * while Enable AI and Work on new issues are on:
 *
 *   - the Fix work the project's AI rules give the group's riskiest issue
 *     decides it, as the engine decides it for that issue: Off proposes
 *     nothing; out of the box it is Suggest, so the fix waits for a person
 *     in Data Security > AI;
 *   - the pull request is proposed for the stores declared as code, in the
 *     repository the grouping found for their code - never without one. A
 *     rule that sets Fix to Without asking opens it on its own;
 *   - the one approval is proposed for the stores made in the console that
 *     the response action can change, leaving out what the plan leaves out
 *     and saying so. It always asks;
 *   - a group's fix is proposed once for the same stores: a group that
 *     takes in or loses a store gets a new proposal, which replaces the one
 *     still waiting.
 *
 * A person who fixes the group from the Issues list settles what waits for
 * it (expireWaitingForGroup). Never throws.
 */

// The most stores a proposal's preview names before it counts the rest.
const MAX_PREVIEW_STORES: number = 20;

// The most groups whose fix one grouping proposes: the changed ones come first.
export const MAX_GROUP_PROPOSALS_PER_RUN: number = 20;

const ROOT: { isRoot: true } = { isRoot: true };

function idOf(record: { _id?: unknown; id?: unknown }): string {
  const value: unknown = record.id || record._id;

  return value ? String(value).toLowerCase() : "";
}

// What makes a part's proposal the same: its group, its stores, and what it runs.
export function getIssueGroupPlanKey(data: {
  kind: DataSecurityAiProposalKind;
  groupId: string;
  storeIds: ReadonlyArray<string>;
  extra?: string | undefined;
}): string {
  return `${data.kind === DataSecurityAiProposalKind.FixIssueGroupInCode ? "group-code" : "group-cloud"}:${sha256Hex(
    `${data.groupId}\n${[...data.storeIds]
      .map((id: string): string => {
        return id.toLowerCase();
      })
      .sort()
      .join(",")}\n${data.extra || ""}`,
  ).slice(0, 24)}`;
}

// The stores a preview names: the first few by name, then how many more.
function previewStores(
  stores: ReadonlyArray<DataSecurityIssueGroupFixStoreJSON>,
): string {
  const named: Array<string> = stores
    .slice(0, MAX_PREVIEW_STORES)
    .map((store: DataSecurityIssueGroupFixStoreJSON): string => {
      return mdText`- **${store.name}**${store.region ? mdText` (${store.region})` : FeedMarkdown.empty()}`.toString();
    });
  const more: number = stores.length - named.length;

  return [...named, ...(more > 0 ? [`- …and ${more} more`] : [])].join("\n");
}

const LEFT_OUT_WORDS: Readonly<
  Record<DataSecurityIssueGroupLeftOutReason, string>
> = {
  [DataSecurityIssueGroupLeftOutReason.PublicByDesign]:
    "marked Public By Design",
  [DataSecurityIssueGroupLeftOutReason.FixWouldBreak]:
    "OneUptime AI's analysis says the fix would break what uses it; a person may tick it in",
  [DataSecurityIssueGroupLeftOutReason.NothingToRun]:
    "nothing Data Security can run fixes this check on it: fix it in its console",
  [DataSecurityIssueGroupLeftOutReason.NotThroughACloud]:
    "not found through a cloud connection",
  [DataSecurityIssueGroupLeftOutReason.ConnectionGone]:
    "its cloud connection is gone or turned off",
  [DataSecurityIssueGroupLeftOutReason.ResponseOff]:
    "its cloud connection's Data security response is off",
};

export default class DataSecurityIssueGroupProposals {
  @CaptureSpan()
  public static async proposeForGroups(data: {
    projectId: ObjectID;
    groupIds: ReadonlyArray<ObjectID>;
    now?: Date | undefined;
  }): Promise<number> {
    if (data.groupIds.length === 0) {
      return 0;
    }

    try {
      const project: Project | null = await ProjectService.findOneById({
        id: data.projectId,
        select: {
          _id: true,
          enableAi: true,
          enableAutomaticDataSecurityAi: true,
          requireTwoApprovalsForRiskierFixes: true,
        },
        props: ROOT,
      });

      if (
        !project ||
        project.enableAi === false ||
        project.enableAutomaticDataSecurityAi !== true
      ) {
        return 0;
      }

      const now: Date = data.now || OneUptimeDate.getCurrentDate();
      const groups: Array<DataSecurityIssueGroup> =
        await DataSecurityIssueGroupService.findBy({
          query: {
            projectId: data.projectId,
            _id: QueryHelper.any(
              data.groupIds
                .slice(0, MAX_GROUP_PROPOSALS_PER_RUN)
                .map((id: ObjectID): string => {
                  return id.toString();
                }),
            ),
          },
          select: {
            _id: true,
            checkId: true,
            cause: true,
            facts: true,
            name: true,
            issueCount: true,
            openIssueCount: true,
            codeTaskId: true,
          },
          skip: 0,
          limit: MAX_GROUP_PROPOSALS_PER_RUN,
          props: ROOT,
        });
      const rules: Array<AutoRemediationRule> | null =
        await DataSecurityAiEngine.readRules(data.projectId);
      const categoryOf: Map<string, string> = rules?.length
        ? (await DataSecurityAiEngine.readDataTypes(data.projectId)).categoryOf
        : new Map();
      let proposed: number = 0;

      for (const group of groups) {
        if ((group.openIssueCount || 0) === 0) {
          continue;
        }

        try {
          proposed += await DataSecurityIssueGroupProposals.proposeForGroup({
            projectId: data.projectId,
            group,
            rules,
            categoryOf,
            requireTwoApprovals:
              project.requireTwoApprovalsForRiskierFixes === true,
            now,
          });
        } catch (error) {
          logger.error(
            `DataSecurity AI: could not propose the fix of issue group ${idOf(group)}: ${error}`,
          );
        }
      }

      return proposed;
    } catch (error) {
      logger.error(
        `DataSecurity AI: could not propose the fixes of project ${data.projectId.toString()}'s issue groups: ${error}`,
      );
      return 0;
    }
  }

  // One group's parts, each proposed as its work and its change say.
  private static async proposeForGroup(data: {
    projectId: ObjectID;
    group: DataSecurityIssueGroup;
    rules: Array<AutoRemediationRule> | null;
    categoryOf: Map<string, string>;
    requireTwoApprovals: boolean;
    now: Date;
  }): Promise<number> {
    const members: Array<GroupFixMember> =
      await DataSecurityIssueGroupFix.readMembers({
        projectId: data.projectId,
        groupId: data.group.id!,
      });

    if (members.length === 0) {
      return 0;
    }

    const riskiest: GroupFixMember = [...members].sort(
      (left: GroupFixMember, right: GroupFixMember): number => {
        return (right.issue.riskScore || 0) - (left.issue.riskScore || 0);
      },
    )[0]!;
    const work: DataSecurityAiWorkDecision | null =
      await DataSecurityIssueGroupProposals.decideFixWork({
        projectId: data.projectId,
        member: riskiest,
        rules: data.rules,
        categoryOf: data.categoryOf,
      });

    if (!work || work.autonomy === DataSecurityAiAutonomy.Off) {
      return 0;
    }

    const plan: DataSecurityIssueGroupFixPlanJSON =
      await DataSecurityIssueGroupFix.planOf({
        projectId: data.projectId,
        group: data.group,
        members,
        props: ROOT,
      });
    const facts: DataSecurityIssueGroupFacts | null =
      readDataSecurityIssueGroupFacts(data.group.facts);

    if (!facts) {
      return 0;
    }

    const check: DataSecurityCheckInfo | undefined = getDataSecurityCheck(
      facts.checkId,
    );
    const cause: string = describeIssueGroupCause(facts);
    const riskScore: number = Math.max(
      ...members.map((member: GroupFixMember): number => {
        return member.issue.riskScore || 0;
      }),
    );
    const changesWithoutAskingThisHour: number =
      await DataSecurityAiEngine.countChangesWithoutAskingThisHour({
        projectId: data.projectId,
        now: data.now,
      });
    let proposed: number = 0;

    // The pull request: only where the grouping found the code, and none is on its way.
    const pullRequest: DataSecurityIssueGroupFixPlanJSON["pullRequest"] =
      plan.pullRequest;
    const isOnItsWay: boolean = Boolean(
      pullRequest?.existing &&
        [
          DeclaredCodeChangeState.Writing,
          DeclaredCodeChangeState.Opened,
          DeclaredCodeChangeState.WaitingForYou,
        ].includes(pullRequest.existing.state as DeclaredCodeChangeState),
    );

    if (pullRequest?.location && pullRequest.stores.length > 0 && !isOnItsWay) {
      const change: DataSecurityAiPlannedChange = {
        title:
          `Fix the cause of ${pullRequest.stores.length} issues in one pull request: ${cause}`.slice(
            0,
            500,
          ),
        changeMarkdown: [
          mdText`One pull request to the ${pullRequest.codeKind || "infrastructure"} code in **${pullRequest.location.repositoryName}**${
            pullRequest.location.paths.length > 0
              ? mdText` (${pullRequest.location.paths.join(", ")})`
              : FeedMarkdown.empty()
          }, changing the setting every store below takes, rather than each store's resource:`.toString(),
          "",
          previewStores(pullRequest.stores),
        ].join("\n"),
        reasonMarkdown:
          mdText`These ${String(pullRequest.stores.length)} stores fail the same check, **${check?.title || facts.checkId}**, and share one cause: ${cause}. One change to the code that declares them fixes every one.`.toString(),
        proofMarkdown:
          "Each issue resolves on its own once its check passes, after the pull request is merged and applied.",
        undoMarkdown:
          "A pull request merges nothing by itself: close it in Code, or on its repository, to undo this.",
        plan: {
          groupId: idOf(data.group),
          repositoryId: pullRequest.location.repositoryId,
          storeIds: pullRequest.stores.map(
            (store: DataSecurityIssueGroupFixStoreJSON): string => {
              return store.dataStoreId;
            },
          ),
          issueIds: pullRequest.stores.map(
            (store: DataSecurityIssueGroupFixStoreJSON): string => {
              return store.issueId;
            },
          ),
        },
        planKey: getIssueGroupPlanKey({
          kind: DataSecurityAiProposalKind.FixIssueGroupInCode,
          groupId: idOf(data.group),
          storeIds: pullRequest.stores.map(
            (store: DataSecurityIssueGroupFixStoreJSON): string => {
              return store.dataStoreId;
            },
          ),
          extra: pullRequest.location.repositoryId,
        }),
        safety: DataSecurityAiChangeSafety.OpensPullRequest,
        meetsDefaultConditions: false,
        isNamedByRule: false,
      };

      await DataSecurityAiProposals.propose({
        projectId: data.projectId,
        issue: null,
        store: null,
        group: data.group,
        action: FixIssueGroupInCodeAction,
        change,
        work,
        verdict: getDataSecurityAiWithoutAskingVerdict({
          work,
          safety: DataSecurityAiChangeSafety.OpensPullRequest,
          meetsDefaultConditions: false,
          isNamedByRule: false,
          requireTwoApprovalsForRiskierChanges: data.requireTwoApprovals,
          changesWithoutAskingThisHour,
        }),
        riskScore,
        now: data.now,
      });
      proposed++;
    }

    // The one approval, for the stores made in the console: it always asks.
    const cloud: DataSecurityIssueGroupFixPlanJSON["cloud"] = plan.cloud;

    if (cloud && cloud.stores.length > 0) {
      const safety: DataSecurityAiChangeSafety =
        EXPOSURE_RESPONSE_ACTIONS.includes(cloud.action)
          ? DataSecurityAiChangeSafety.ChangesAccess
          : DataSecurityAiChangeSafety.ChangesCloudSettings;
      const leftOut: Array<DataSecurityIssueGroupLeftOutJSON> =
        plan.leftOut.filter((store: DataSecurityIssueGroupLeftOutJSON) => {
          return store.part === DataSecurityIssueGroupFixPart.Cloud;
        });
      const change: DataSecurityAiPlannedChange = {
        title:
          `${cloud.action} on ${cloud.stores.length} stores made in the console, one cause: ${cause}`.slice(
            0,
            500,
          ),
        changeMarkdown: [
          mdText`**${cloud.action}** on each of these stores, through its cloud connection:`.toString(),
          "",
          previewStores(cloud.stores),
          ...(leftOut.length > 0
            ? [
                "",
                "Left out:",
                ...leftOut
                  .slice(0, MAX_PREVIEW_STORES)
                  .map((store: DataSecurityIssueGroupLeftOutJSON): string => {
                    return mdText`- **${store.name}**: ${LEFT_OUT_WORDS[store.reason]}`.toString();
                  }),
              ]
            : []),
        ].join("\n"),
        reasonMarkdown:
          mdText`These ${String(cloud.stores.length)} stores fail the same check, **${check?.title || facts.checkId}**, and share one cause: ${cause}. They were made in the console, so one approval changes each of them.`.toString(),
        proofMarkdown:
          "Each store is checked again right after, and its issue resolves on its own once its check passes.",
        undoMarkdown:
          "Data Security does not set a cloud setting back by itself: each store's timeline says what was changed, to set it back in its console.",
        plan: {
          groupId: idOf(data.group),
          action: cloud.action,
          storeIds: cloud.stores.map(
            (store: DataSecurityIssueGroupFixStoreJSON): string => {
              return store.dataStoreId;
            },
          ),
          leftOutStoreIds: leftOut.map(
            (store: DataSecurityIssueGroupLeftOutJSON): string => {
              return store.dataStoreId;
            },
          ),
        },
        planKey: getIssueGroupPlanKey({
          kind: DataSecurityAiProposalKind.FixIssueGroupInCloud,
          groupId: idOf(data.group),
          storeIds: cloud.stores.map(
            (store: DataSecurityIssueGroupFixStoreJSON): string => {
              return store.dataStoreId;
            },
          ),
          extra: cloud.action,
        }),
        safety,
        meetsDefaultConditions: false,
        isNamedByRule: false,
      };

      await DataSecurityAiProposals.propose({
        projectId: data.projectId,
        issue: null,
        store: null,
        group: data.group,
        action: FixIssueGroupInCloudAction,
        change,
        work,
        verdict: getDataSecurityAiWithoutAskingVerdict({
          work,
          safety,
          meetsDefaultConditions: false,
          isNamedByRule: false,
          requireTwoApprovalsForRiskierChanges: data.requireTwoApprovals,
          changesWithoutAskingThisHour,
        }),
        riskScore,
        now: data.now,
      });
      proposed++;
    }

    return proposed;
  }

  /*
   * The Fix work for a group, as the project's AI rules decide it for its
   * riskiest issue - the defaults (Suggest) with no rule; null when the
   * rules could not be read, or none matches: nothing a rule may keep out
   * is proposed.
   */
  private static async decideFixWork(data: {
    projectId: ObjectID;
    member: GroupFixMember;
    rules: Array<AutoRemediationRule> | null;
    categoryOf: Map<string, string>;
  }): Promise<DataSecurityAiWorkDecision | null> {
    if (!data.rules) {
      return null;
    }

    const plan: DataSecurityAiPlan = decideDataSecurityAiWork({
      isAiEnabled: true,
      isAutomaticOn: true,
      rules: {
        rulesSetUp: data.rules.length > 0,
        matchingRules:
          data.rules.length > 0
            ? DataSecurityAiEngine.matchRules(
                data.rules,
                await DataSecurityAiEngine.readRuleIssue({
                  projectId: data.projectId,
                  issue: data.member.issue,
                  store: data.member.store,
                  categoryOf: data.categoryOf,
                }),
              )
            : [],
      },
      issue: { severity: data.member.issue.severity },
    });

    return plan.skip ? null : plan.works[DataSecurityAiWork.Fix];
  }
}
