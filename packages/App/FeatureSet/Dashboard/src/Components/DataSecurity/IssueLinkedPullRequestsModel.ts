import {
  PULL_REQUEST_CLOSED,
  PULL_REQUEST_MERGED,
  PULL_REQUEST_OPEN,
} from "./IssueLinkedPullRequestsCopy";
import DataSecurityIssuePullRequest from "Common/Models/DatabaseModels/DataSecurityIssuePullRequest";
import FixProductionReport, {
  parseFixProductionReport,
} from "Common/Types/AI/FixProductionReport";
import PullRequestState from "Common/Types/CodeRepository/PullRequestState";
import { getPullRequestLinkName } from "Common/Types/CodeRepository/PullRequestLink";
import { canIssueTakePullRequest } from "Common/Types/DataSecurity/DataSecurityIssuePullRequestLink";
import DataSecurityIssueStatus from "Common/Types/DataSecurity/DataSecurityIssueStatus";
import { JSONObject } from "Common/Types/JSON";
import { PillTone } from "Common/UI/Components/Pill/PillTone";

/*
 * THE PULL REQUESTS PEOPLE LINKED TO AN ISSUE AS ITS FIX (#10831), as its
 * How to Fix card draws them, React-free so a plain test pins each rule:
 * what a link reads, where it stands on its host - not merged yet, merged,
 * or closed - and, once merged, what production showed (the verdict an AI
 * fix of the issue shows, FixProductionVerdict), and whether the issue
 * offers Link Pull Request.
 */

export const LINKED_PULL_REQUEST_SELECT: {
  _id: true;
  pullRequestUrl: true;
  pullRequestNumber: true;
  pullRequestState: true;
  repoOrganizationName: true;
  repoName: true;
  mergedAt: true;
  productionCheck: true;
  productionStatus: true;
  productionStatusAt: true;
  productionSummary: true;
  deployedAt: true;
  deployedVersion: true;
  deployedCommitSha: true;
  createdAt: true;
  createdByUser: { _id: true; name: true; email: true };
} = {
  _id: true,
  pullRequestUrl: true,
  pullRequestNumber: true,
  pullRequestState: true,
  repoOrganizationName: true,
  repoName: true,
  mergedAt: true,
  productionCheck: true,
  productionStatus: true,
  productionStatusAt: true,
  productionSummary: true,
  deployedAt: true,
  deployedVersion: true,
  deployedCommitSha: true,
  createdAt: true,
  createdByUser: { _id: true, name: true, email: true },
};

// A linked pull request as a person names it: "acme/checkout#482", or its address.
export function getLinkedPullRequestName(
  row: DataSecurityIssuePullRequest,
): string {
  if (row.repoOrganizationName && row.repoName && row.pullRequestNumber) {
    return getPullRequestLinkName({
      owner: row.repoOrganizationName,
      repository: row.repoName,
      number: row.pullRequestNumber,
    });
  }

  return row.pullRequestUrl?.toString() || "";
}

// Where a linked pull request stands on its host, as its chip says it.
export interface LinkedPullRequestState {
  label: string;
  tone: PillTone;
}

export function getLinkedPullRequestState(
  row: DataSecurityIssuePullRequest,
): LinkedPullRequestState {
  if (row.pullRequestState === PullRequestState.Closed) {
    return { label: PULL_REQUEST_CLOSED, tone: PillTone.Paused };
  }

  if (row.pullRequestState === PullRequestState.Merged) {
    return { label: PULL_REQUEST_MERGED, tone: PillTone.Info };
  }

  return { label: PULL_REQUEST_OPEN, tone: PillTone.Neutral };
}

function toIso(value: Date | string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const date: Date = new Date(value);

  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/*
 * What production showed of a linked pull request, as an AI fix's report
 * says it - or undefined before it has a production status (not merged
 * yet), or one this reader does not know. A leak no read can tell about
 * has one from the moment it is linked.
 */
export function getLinkedPullRequestProduction(
  row: DataSecurityIssuePullRequest,
): FixProductionReport | undefined {
  const report: JSONObject = {
    status: row.productionStatus || null,
    check: row.productionCheck || null,
  };

  if (row.productionSummary) {
    report["summary"] = row.productionSummary;
  }

  const statusAt: string | undefined = toIso(row.productionStatusAt);
  const deployedAt: string | undefined = toIso(row.deployedAt);

  if (statusAt) {
    report["statusAt"] = statusAt;
  }

  if (deployedAt) {
    report["deployedAt"] = deployedAt;
  }

  if (row.deployedVersion) {
    report["deployedVersion"] = row.deployedVersion;
  }

  if (row.deployedCommitSha) {
    report["deployedCommitSha"] = row.deployedCommitSha;
  }

  return parseFixProductionReport(report);
}

// Who linked it, as a person names them: their name, else their email.
export function getLinkedPullRequestAuthor(
  row: DataSecurityIssuePullRequest,
): string {
  return (
    row.createdByUser?.name?.toString() ||
    row.createdByUser?.email?.toString() ||
    ""
  );
}

/*
 * Whether the issue offers Link Pull Request: an open or a resolved issue
 * (one set aside watches nothing), to a reader who may link one.
 */
export function canLinkIssuePullRequest(data: {
  status: DataSecurityIssueStatus | string | undefined;
  isAllowed: boolean;
}): boolean {
  return data.isAllowed && canIssueTakePullRequest(data.status);
}
