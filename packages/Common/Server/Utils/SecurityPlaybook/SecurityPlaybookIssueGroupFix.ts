import DataSecurityIssue from "../../../Models/DatabaseModels/DataSecurityIssue";
import DataSecurityIssueGroup from "../../../Models/DatabaseModels/DataSecurityIssueGroup";
import { SecurityCaseFeedEventType } from "../../../Models/DatabaseModels/SecurityCaseFeed";
import {
  DataSecurityIssueGroupFacts,
  describeIssueGroupCause,
  readDataSecurityIssueGroupFacts,
} from "../../../Types/DataSecurity/DataSecurityIssueGroup";
import {
  DataSecurityIssueGroupFixPart,
  DataSecurityIssueGroupFixPlanJSON,
  DataSecurityIssueGroupFixResultJSON,
} from "../../../Types/DataSecurity/DataSecurityIssueGroupFix";
import DataSecurityIssueStatus from "../../../Types/DataSecurity/DataSecurityIssueStatus";
import SecurityDetectionSource from "../../../Types/SecurityCase/SecurityDetectionSource";
import { SecurityPlaybookStepStatus } from "../../../Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../Utils/Markdown/FeedMarkdown";
import DataSecurityIssueService from "../../Services/DataSecurityIssueService";
import QueryHelper from "../../Types/Database/QueryHelper";
import DataSecurityIssueGroupFix, {
  GroupFixMember,
  getIssuesPageUrl,
} from "../DataSecurity/DataSecurityIssueGroupFix";
import logger from "../Logger";
import type {
  PlaybookStepContext,
  PlaybookStepOutcome,
} from "./SecurityPlaybookActions";

/*
 * FIX WITH AI, ON A DATA SECURITY CASE (#10370).
 *
 * A Data Security case is about a store whose issue was Critical. When the
 * case's issues are in groups of issues one mistake made, the playbook's
 * Fix With AI step starts each group's fix - the cause, once - rather than
 * anything for the one store:
 *
 *   - the one pull request, for the stores declared as code, in the
 *     repository the grouping found their code in: asked as OneUptime and
 *     kept on the case (triggeredBySecurityCaseId), as the step asks one
 *     for an exception;
 *   - never the change through the cloud connections, which always asks a
 *     person (#10364): the step says how many stores made in the console
 *     wait for one approval on the Issues list.
 *
 * A case none of whose open issues is in a group is the step's as before
 * (the exceptions its requests threw): null.
 */

// The most groups one step fixes: a case is about one store, so it has few.
export const MAX_CASE_GROUPS_FIXED: number = 5;

// The most of a case's issues read for their groups.
const MAX_CASE_ISSUES_READ: number = 100;

const ROOT: { isRoot: true } = { isRoot: true };

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : String(error || "unknown error");
}

// The groups of a case's issues, by id, each once: the first few.
export function getCaseGroupIds(
  issues: ReadonlyArray<Pick<DataSecurityIssue, "dataSecurityIssueGroupId">>,
): Array<string> {
  return Array.from(
    new Set(
      issues
        .map(
          (
            issue: Pick<DataSecurityIssue, "dataSecurityIssueGroupId">,
          ): string => {
            return (
              issue.dataSecurityIssueGroupId?.toString().toLowerCase() || ""
            );
          },
        )
        .filter(Boolean),
    ),
  ).slice(0, MAX_CASE_GROUPS_FIXED);
}

export default class SecurityPlaybookIssueGroupFix {
  public static async fixGroupsOfCase(
    context: PlaybookStepContext,
  ): Promise<PlaybookStepOutcome | null> {
    // A Data Security case only: every other case's step reads nothing more.
    if (
      !context.securityCase.id ||
      context.securityCase.source !== SecurityDetectionSource.DataSecurity
    ) {
      return null;
    }

    const groupIds: Array<string> = getCaseGroupIds(
      await DataSecurityIssueService.findBy({
        query: {
          projectId: context.projectId,
          securityCaseId: context.securityCase.id,
          status: DataSecurityIssueStatus.Open,
          dataSecurityIssueGroupId: QueryHelper.notNull(),
        },
        select: { _id: true, dataSecurityIssueGroupId: true },
        skip: 0,
        limit: MAX_CASE_ISSUES_READ,
        props: ROOT,
      }),
    );

    if (groupIds.length === 0) {
      return null;
    }

    const started: Array<MarkdownText> = [];
    const notStarted: Array<MarkdownText> = [];
    let waitingInConsole: number = 0;

    for (const groupId of groupIds) {
      let cause: string = "A group of the case's issues";

      try {
        const group: DataSecurityIssueGroup =
          await DataSecurityIssueGroupFix.readGroup({
            projectId: context.projectId,
            groupId,
          });
        const facts: DataSecurityIssueGroupFacts | null =
          readDataSecurityIssueGroupFacts(group.facts);

        if (facts) {
          cause = describeIssueGroupCause(facts);
        }

        const members: Array<GroupFixMember> =
          await DataSecurityIssueGroupFix.readMembers({
            projectId: context.projectId,
            groupId: group.id!,
          });
        const plan: DataSecurityIssueGroupFixPlanJSON =
          await DataSecurityIssueGroupFix.planOf({
            projectId: context.projectId,
            group,
            members,
            props: ROOT,
          });

        waitingInConsole += plan.cloud?.stores.length || 0;

        if (!plan.pullRequest || plan.pullRequest.stores.length === 0) {
          continue;
        }

        if (!plan.pullRequest.location) {
          notStarted.push(
            mdText`${cause}: OneUptime could not find the code that declares its stores. Fix the cause from the Issues list, where you pick the repository.`,
          );
          continue;
        }

        const result: DataSecurityIssueGroupFixResultJSON =
          await DataSecurityIssueGroupFix.run({
            projectId: context.projectId,
            groupId,
            props: ROOT,
            parts: [DataSecurityIssueGroupFixPart.PullRequest],
            triggeredBySecurityCaseId: context.securityCase.id,
          });

        if (result.pullRequest?.aiRunId) {
          started.push(
            mdText`one pull request for ${String(plan.pullRequest.stores.length)} stores, one cause: ${cause}${
              result.pullRequest.wasAlreadyAsked
                ? mdText` (already on its way)`
                : FeedMarkdown.empty()
            }`,
          );
        } else {
          notStarted.push(
            mdText`${cause}: ${result.pullRequest?.message || "no pull request was asked for"}`,
          );
        }
      } catch (error) {
        logger.error(
          `Security playbook: could not fix issue group ${groupId} of case ${context.securityCase.id.toString()}: ${error}`,
        );
        notStarted.push(mdText`${cause}: ${errorMessage(error)}`);
      }
    }

    const details: Array<MarkdownText> = [];

    if (notStarted.length > 0) {
      details.push(
        mdText`Not asked for:\n${FeedMarkdown.bulletList(notStarted)}`,
      );
    }

    if (waitingInConsole > 0) {
      details.push(
        mdText`${String(waitingInConsole)} of the stores were made in the console. Changing them through their cloud connections always asks a person, so they wait for one approval on ${FeedMarkdown.link(
          "the Issues list",
          getIssuesPageUrl(context.projectId),
        )} (Fix the cause).`,
      );
    }

    const detailsInMarkdown: MarkdownText | undefined =
      details.length > 0 ? FeedMarkdown.join(details, "\n\n") : undefined;

    if (started.length === 0) {
      return {
        status: SecurityPlaybookStepStatus.Skipped,
        summary: mdText`No pull request was asked for the cause behind the case's Data Security issues.`,
        ...(detailsInMarkdown ? { detailsInMarkdown } : {}),
      };
    }

    return {
      status: SecurityPlaybookStepStatus.Succeeded,
      summary: mdText`Asked OneUptime AI to fix the cause behind the case's Data Security issues: ${FeedMarkdown.join(started, "; ")}. Each pull request shows on its issues' pages and in Code.`,
      feedEventType: SecurityCaseFeedEventType.ResponseAction,
      ...(detailsInMarkdown ? { detailsInMarkdown } : {}),
    };
  }
}
