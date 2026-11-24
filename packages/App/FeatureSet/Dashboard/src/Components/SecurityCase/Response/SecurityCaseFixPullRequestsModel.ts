import {
  PULL_REQUEST_CLOSED,
  PULL_REQUEST_MERGED,
  PULL_REQUEST_MERGED_TOOLTIP,
  PULL_REQUEST_OPEN,
  PULL_REQUEST_SHIPPED,
  PULL_REQUEST_SHIPPED_IN_TOOLTIP,
} from "./SecurityCaseResponseCopy";
import { ResponseStep } from "./SecurityCaseResponseTypes";
import SecurityCasePullRequest from "Common/Models/DatabaseModels/SecurityCasePullRequest";
import PullRequestState from "Common/Types/CodeRepository/PullRequestState";
import { getPullRequestLinkName } from "Common/Types/CodeRepository/PullRequestLink";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import {
  RESPONSE_STEP_KINDS,
  isResponseStepOfKind,
} from "Common/Utils/SecurityCase/ResponsePlan/ResponsePlanKeys";

/*
 * THE PULL REQUESTS PEOPLE LINKED TO A CASE'S FIX STEP (#10604), as the
 * Response Plan's card draws them, React-free so a plain test pins each
 * rule: which step takes them, what a link reads, where it stands - not
 * merged yet, merged and waiting for its deploy, shipped, or closed - and
 * whether the step offers Link Pull Request.
 */

export const FIX_PULL_REQUEST_SELECT: {
  _id: true;
  pullRequestUrl: true;
  pullRequestNumber: true;
  pullRequestState: true;
  repoOrganizationName: true;
  repoName: true;
  mergedAt: true;
  deployedAt: true;
  deployedVersion: true;
  createdAt: true;
} = {
  _id: true,
  pullRequestUrl: true,
  pullRequestNumber: true,
  pullRequestState: true,
  repoOrganizationName: true,
  repoName: true,
  mergedAt: true,
  deployedAt: true,
  deployedVersion: true,
  createdAt: true,
};

// The Fix step whose check follows a fix to its deploy: the route's.
export function isRouteFixStep(step: Pick<ResponseStep, "key">): boolean {
  return isResponseStepOfKind(step.key, RESPONSE_STEP_KINDS.fixPublicApp);
}

// A linked pull request as a person names it: "acme/search#482".
export function getFixPullRequestName(row: SecurityCasePullRequest): string {
  if (row.repoOrganizationName && row.repoName && row.pullRequestNumber) {
    return getPullRequestLinkName({
      owner: row.repoOrganizationName,
      repository: row.repoName,
      number: row.pullRequestNumber,
    });
  }

  return row.pullRequestUrl?.toString() || "";
}

// Where a linked pull request stands, as its chip says it.
export interface FixPullRequestStanding {
  label: string;
  tone: PillTone;
  tooltip?: { template: string; values: Record<string, string> } | undefined;
}

export function getFixPullRequestStanding(
  row: SecurityCasePullRequest,
): FixPullRequestStanding {
  if (row.pullRequestState === PullRequestState.Closed) {
    return { label: PULL_REQUEST_CLOSED, tone: PillTone.Paused };
  }

  if (row.pullRequestState === PullRequestState.Merged && row.deployedAt) {
    return {
      label: PULL_REQUEST_SHIPPED,
      tone: PillTone.Success,
      ...(row.deployedVersion
        ? {
            tooltip: {
              template: PULL_REQUEST_SHIPPED_IN_TOOLTIP,
              values: { version: row.deployedVersion },
            },
          }
        : {}),
    };
  }

  if (row.pullRequestState === PullRequestState.Merged) {
    return {
      label: PULL_REQUEST_MERGED,
      tone: PillTone.Info,
      tooltip: { template: PULL_REQUEST_MERGED_TOOLTIP, values: {} },
    };
  }

  return { label: PULL_REQUEST_OPEN, tone: PillTone.Neutral };
}

/*
 * Whether the step offers Link Pull Request: the route's Fix step, while
 * the case is open and the step is still to do. Its links stay drawn
 * either way.
 */
export function canLinkPullRequest(data: {
  step: Pick<ResponseStep, "key" | "isDone">;
  isClosed: boolean;
  isAllowed: boolean;
  linkedCount: number;
  max: number;
}): boolean {
  return (
    isRouteFixStep(data.step) &&
    !data.isClosed &&
    !data.step.isDone &&
    data.isAllowed &&
    data.linkedCount < data.max
  );
}
