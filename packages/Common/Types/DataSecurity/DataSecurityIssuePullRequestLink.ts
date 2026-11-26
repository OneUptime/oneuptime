import { RefusalWithValues } from "../Exception/RefusalWithValues";
import {
  PULL_REQUEST_LINK_CLOSED,
  PULL_REQUEST_LINK_NOT_AN_ADDRESS,
  PULL_REQUEST_LINK_NOT_CONNECTED,
  PULL_REQUEST_LINK_NOT_FOLLOWED,
  PULL_REQUEST_LINK_NOT_FOUND,
  PULL_REQUEST_LINK_READ_FAILED,
  PULL_REQUEST_LINK_REPOSITORY_NOT_READABLE,
} from "../SecurityCase/SecurityCasePullRequestLink";
import { translationKey } from "../Translator";
import DataSecurityIssueStatus from "./DataSecurityIssueStatus";

/*
 * LINKING A PERSON'S OWN PULL REQUEST TO A DATA SECURITY ISSUE (#10831):
 * the most an issue holds, which issues take one, and why a link is
 * refused.
 *
 * The refusals a security case's links share (#10604) are the same here,
 * word for word - an address that is no pull request's, a repository not
 * connected under Code or not readable by the person, a host that does not
 * have it, a pull request closed unmerged - and the ones that name what
 * the link is on are the issue's. The server refuses in English; the
 * Dashboard's dialog says each in the reader's language
 * (RefusalWithValues).
 */

// The most pull requests one issue holds: a fix is one or two, never a list.
export const DATA_SECURITY_ISSUE_PULL_REQUESTS_MAX: number = 10;

export {
  PULL_REQUEST_LINK_CLOSED,
  PULL_REQUEST_LINK_NOT_AN_ADDRESS,
  PULL_REQUEST_LINK_NOT_CONNECTED,
  PULL_REQUEST_LINK_NOT_FOLLOWED,
  PULL_REQUEST_LINK_NOT_FOUND,
  PULL_REQUEST_LINK_READ_FAILED,
  PULL_REQUEST_LINK_REPOSITORY_NOT_READABLE,
};

export const ISSUE_PULL_REQUEST_ISSUE_NOT_FOUND: string = translationKey(
  "This issue does not exist, or you cannot read it.",
);

export const ISSUE_PULL_REQUEST_TOO_MANY: string = translationKey(
  "This issue has 10 pull requests linked already. Take one off before you link another.",
);

export const ISSUE_PULL_REQUEST_SET_ASIDE: string = translationKey(
  "This issue was set aside: its risk was accepted, or it is not an issue. Reopen it to link the pull request that fixes it.",
);

export const ISSUE_PULL_REQUEST_ALREADY_LINKED: RefusalWithValues = {
  template: translationKey("{{pullRequest}} is linked to this issue already."),
  terms: [],
};

// Every refusal with values: the Dashboard reads each back out of the English it gets.
export const ISSUE_PULL_REQUEST_REFUSALS: ReadonlyArray<RefusalWithValues> = [
  PULL_REQUEST_LINK_NOT_CONNECTED,
  PULL_REQUEST_LINK_REPOSITORY_NOT_READABLE,
  PULL_REQUEST_LINK_NOT_FOLLOWED,
  PULL_REQUEST_LINK_NOT_FOUND,
  PULL_REQUEST_LINK_CLOSED,
  ISSUE_PULL_REQUEST_ALREADY_LINKED,
  PULL_REQUEST_LINK_READ_FAILED,
];

/*
 * Which issues take a link: an open one, or a resolved one - a fix that
 * merged after the check passed still says how it was fixed. An issue set
 * aside (its risk accepted, or not an issue) is closed by a person's
 * decision, and a fix linked to it would watch nothing.
 */
export function canIssueTakePullRequest(
  status: DataSecurityIssueStatus | string | undefined,
): boolean {
  return (
    status === DataSecurityIssueStatus.Open ||
    status === DataSecurityIssueStatus.Resolved
  );
}
