import PullRequestState from "../../../../Types/CodeRepository/PullRequestState";
import FixPullRequestCiStatus, {
  FixPullRequestCiCheckRunCounts,
} from "../../../../Types/AI/FixPullRequestCiStatus";

/*
 * What a Git server's API answers, as every client of one (GitLab, Forgejo
 * and Gitea, GitHub) hands it on: one shape, whichever server it came from.
 */

// The account an access token acts as.
export interface CodeHostAccount {
  login: string;
  name: string;
}

// A repository the token can reach, for the picker of Code's connect dialog.
export interface CodeHostRepository {
  // The server's own id for it (GitLab's project id, Forgejo's repository id).
  id: string;
  // Its own name: "checkout-api".
  name: string;
  // Its owner's path: "acme", or a GitLab group's full path "acme/backend".
  ownerPath: string;
  // "acme/checkout-api".
  fullName: string;
  description: string | null;
  defaultBranch: string;
  // Its page on the server.
  webUrl: string;
  // What git clones over HTTPS.
  cloneUrl: string;
  isPrivate: boolean;
  /*
   * Whether the token may push to it: AI pushes its branch there. A
   * repository it may only read is listed, but cannot be connected.
   */
  canPush: boolean;
}

// One page of the repositories a token reaches.
export interface CodeHostRepositoryPage {
  repositories: Array<CodeHostRepository>;
  // There are more, past this page.
  hasMore: boolean;
}

export interface CodeHostBranch {
  name: string;
  headSha: string;
  isProtected: boolean;
}

export interface CodeHostBranchNames {
  names: Array<string>;
  // Every branch that matches is in the list.
  isComplete: boolean;
}

// One file's contents, read without a clone.
export interface CodeHostFileContent {
  content: string;
  filePath: string;
  sizeInBytes: number;
  totalLines: number;
  htmlUrl: string;
}

// A pull (or merge) request's state, with its merge commit once merged.
export interface CodeHostPullRequestState {
  state: PullRequestState;
  mergeCommitSha?: string | undefined;
  mergedAt?: Date | undefined;
}

// The CI on a pull request's head, rolled up the way GitHub's check runs are.
export interface CodeHostCiSummary extends FixPullRequestCiCheckRunCounts {
  conclusion: FixPullRequestCiStatus;
}

// What a server says about itself: its product and version, when it says.
export interface CodeHostServerInfo {
  product: string | null;
  version: string | null;
}
