import DataSecurityAiProposal from "../../../../../Models/DatabaseModels/DataSecurityAiProposal";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { DataSecurityAiProposalKind } from "../../../../../Types/DataSecurity/DataSecurityAi";
import {
  DataSecurityIssueGroupFixPart,
  DataSecurityIssueGroupFixResultJSON,
} from "../../../../../Types/DataSecurity/DataSecurityIssueGroupFix";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import Permission from "../../../../../Types/Permission";
import { mdText } from "../../../../../Utils/Markdown/FeedMarkdown";
import DataSecurityIssueGroupFix, {
  CLOUD_FIX_PERMISSIONS,
  CLOUD_FIX_REFUSED_MESSAGE,
  GROUP_PULL_REQUEST_PERMISSIONS,
  GROUP_PULL_REQUEST_REFUSED_MESSAGE,
} from "../../../DataSecurity/DataSecurityIssueGroupFix";
import CallerPermission from "../../../Permission/CallerPermission";
import {
  DataSecurityAiAction,
  DataSecurityAiActor,
  DataSecurityAiChangeMade,
  DataSecurityAiChangeUndone,
  DataSecurityAiPlanOutcome,
} from "../DataSecurityAiAction";

/*
 * THE FIX OF A GROUP OF ISSUES ONE MISTAKE MADE, AS ONEUPTIME AI PROPOSES
 * IT (#10370).
 *
 * After each grouping, while OneUptime AI works on the project's Data
 * Security issues, it proposes each group's fix (DataSecurityIssueGroupProposals)
 * as the project's AI rules say for the group's riskiest issue - out of the
 * box, Fix is Suggest, so the pull request is proposed and waits:
 *
 *   - FixIssueGroupInCode: one pull request to the code that declares the
 *     group's stores, in the repository the grouping found for them. A rule
 *     that sets Fix to Without asking opens it on its own - a pull request
 *     merges nothing (OpensPullRequest).
 *   - FixIssueGroupInCloud: the response action on every store made in the
 *     console, one approval. It reaches the customer's cloud, so it always
 *     asks: a change of access (Block public access, Revoke sharing) as
 *     ChangesAccess, which runs on its own only where a rule names it -
 *     nothing here names it - and any other setting as ChangesCloudSettings,
 *     which always asks.
 *
 * Both are planned for the group, never for one issue, so the engine never
 * plans them; approving one makes the group's fix of that part, with the
 * approver's own permissions, exactly as Fix the Cause does from the
 * Issues list (DataSecurityIssueGroupFix.run). Neither is undone here: a
 * pull request is closed where it was opened, and a cloud setting is set
 * back in the cloud's own console.
 */

function holdsAnyOf(
  props: DatabaseCommonInteractionProps,
  permissions: ReadonlyArray<Permission>,
): boolean {
  return (
    Boolean(props.isRoot) ||
    Boolean(props.isMasterAdmin) ||
    CallerPermission.holdsAnyOf(props, permissions)
  );
}

function groupIdOf(proposal: DataSecurityAiProposal): string {
  const fromPlan: unknown = proposal.plan?.["groupId"];

  return (
    proposal.dataSecurityIssueGroupId?.toString() ||
    (typeof fromPlan === "string" ? fromPlan : "")
  );
}

// The ids a plan lists.
function readIds(value: unknown): Array<string> {
  return (Array.isArray(value) ? value : []).filter(
    (id: unknown): id is string => {
      return typeof id === "string" && ObjectID.isValidUUID(id);
    },
  );
}

// What a person changed before approving: the repository, or the stores ticked in.
async function readGroupFixChanges(data: {
  changes: unknown;
  key: "codeRepositoryId" | "includeDataStoreIds";
}): Promise<JSONObject> {
  const changes: unknown = data.changes;

  if (!changes || typeof changes !== "object" || Array.isArray(changes)) {
    throw new BadDataException("Say what you changed before approving.");
  }

  const value: unknown = (changes as JSONObject)[data.key];

  if (data.key === "codeRepositoryId") {
    if (typeof value !== "string" || !ObjectID.isValidUUID(value)) {
      throw new BadDataException(
        "Choose the repository the pull request goes to.",
      );
    }

    return { codeRepositoryId: value };
  }

  return { includeDataStoreIds: readIds(value) };
}

export const FixIssueGroupInCodeAction: DataSecurityAiAction = {
  kind: DataSecurityAiProposalKind.FixIssueGroupInCode,

  // Planned for a group of issues, never for one.
  appliesToCheck(_checkId: string | undefined): boolean {
    return false;
  },

  async plan(): Promise<DataSecurityAiPlanOutcome> {
    return { kind: "nothing", detail: "planned-for-the-group" };
  },

  getApproveRefusal(data: {
    props: DatabaseCommonInteractionProps;
  }): string | null {
    return holdsAnyOf(data.props, GROUP_PULL_REQUEST_PERMISSIONS)
      ? null
      : GROUP_PULL_REQUEST_REFUSED_MESSAGE;
  },

  getUndoRefusal(): string | null {
    return "A pull request is closed where it was opened: close it in Code, or on its repository. Nothing in your cloud changed.";
  },

  async readChanges(data: { changes: unknown }): Promise<JSONObject> {
    return await readGroupFixChanges({
      changes: data.changes,
      key: "codeRepositoryId",
    });
  },

  async apply(data: {
    projectId: ObjectID;
    proposal: DataSecurityAiProposal;
    actor: DataSecurityAiActor;
    changes?: JSONObject | undefined;
  }): Promise<DataSecurityAiChangeMade> {
    const planned: unknown = data.proposal.plan?.["repositoryId"];
    const result: DataSecurityIssueGroupFixResultJSON =
      await DataSecurityIssueGroupFix.run({
        projectId: data.projectId,
        groupId: groupIdOf(data.proposal),
        props: data.actor.props,
        parts: [DataSecurityIssueGroupFixPart.PullRequest],
        codeRepositoryId: data.changes?.["codeRepositoryId"] || planned,
      });
    const pullRequest: DataSecurityIssueGroupFixResultJSON["pullRequest"] =
      result.pullRequest;

    if (!pullRequest?.aiRunId) {
      throw new BadDataException(
        pullRequest?.message ||
          "This group has no stores declared as code any more, so no pull request was asked for.",
      );
    }

    return {
      result: { aiRunId: pullRequest.aiRunId },
      summaryMarkdown: (pullRequest.wasAlreadyAsked
        ? mdText`The group's pull request was already on its way.`
        : mdText`OneUptime AI is writing one pull request for the cause, in the code that declares the group's stores. It appears under Code, and on each of the group's issues.`
      ).toString(),
    };
  },

  async undo(): Promise<DataSecurityAiChangeUndone> {
    throw new BadDataException(
      "A pull request is closed where it was opened: close it in Code, or on its repository.",
    );
  },
};

export const FixIssueGroupInCloudAction: DataSecurityAiAction = {
  kind: DataSecurityAiProposalKind.FixIssueGroupInCloud,

  // Planned for a group of issues, never for one.
  appliesToCheck(_checkId: string | undefined): boolean {
    return false;
  },

  async plan(): Promise<DataSecurityAiPlanOutcome> {
    return { kind: "nothing", detail: "planned-for-the-group" };
  },

  getApproveRefusal(data: {
    props: DatabaseCommonInteractionProps;
  }): string | null {
    return holdsAnyOf(data.props, CLOUD_FIX_PERMISSIONS)
      ? null
      : CLOUD_FIX_REFUSED_MESSAGE;
  },

  getUndoRefusal(): string | null {
    return "Data Security does not change a cloud setting back by itself: set it back in each store's cloud console. Each store's timeline says what was changed.";
  },

  async readChanges(data: { changes: unknown }): Promise<JSONObject> {
    return await readGroupFixChanges({
      changes: data.changes,
      key: "includeDataStoreIds",
    });
  },

  async apply(data: {
    projectId: ObjectID;
    proposal: DataSecurityAiProposal;
    actor: DataSecurityAiActor;
    changes?: JSONObject | undefined;
  }): Promise<DataSecurityAiChangeMade> {
    const listed: Array<string> = [
      ...readIds(data.proposal.plan?.["storeIds"]),
      ...readIds(data.proposal.plan?.["leftOutStoreIds"]),
    ];
    const result: DataSecurityIssueGroupFixResultJSON =
      await DataSecurityIssueGroupFix.run({
        projectId: data.projectId,
        groupId: groupIdOf(data.proposal),
        props: data.actor.props,
        parts: [DataSecurityIssueGroupFixPart.Cloud],
        includeDataStoreIds: data.changes?.["includeDataStoreIds"],
        // Only the stores the proposal listed: none that joined the group since.
        onlyDataStoreIds: listed,
      });
    const cloud: DataSecurityIssueGroupFixResultJSON["cloud"] = result.cloud;

    if (!cloud) {
      throw new BadDataException(
        "None of this group's stores made in the console can be changed from here any more, so nothing was done.",
      );
    }

    if (cloud.refusal) {
      throw new NotAuthorizedException(cloud.refusal);
    }

    return {
      result: {
        action: cloud.action,
        changed: cloud.changed,
        unchanged: cloud.unchanged,
        failed: cloud.failed.length,
      },
      summaryMarkdown:
        mdText`**${cloud.action}** on the group's stores made in the console: ${String(cloud.changed)} changed, ${String(cloud.unchanged)} already as they should be${
          cloud.failed.length > 0
            ? `, ${cloud.failed.length} could not be changed`
            : ""
        }. Each store's timeline says what was done, and each issue resolves on its own once its check passes.`.toString(),
    };
  },

  async undo(): Promise<DataSecurityAiChangeUndone> {
    throw new BadDataException(
      "Data Security does not change a cloud setting back by itself: set it back in each store's cloud console.",
    );
  },
};
