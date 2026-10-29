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

/*
 * A pull (or merge) request, as a production review reads it: what it is,
 * where it goes, whether it is open, a draft, or from a fork, and who
 * opened it. GitLab's merge request iid and Forgejo's index are its number.
 */
export interface CodeHostPullRequestDetails {
  number: number;
  title: string;
  isOpen: boolean;
  isMerged: boolean;
  isDraft: boolean;
  htmlUrl: string;
  authorLogin: string;
  // The server's own id for the author: what GitLab's member reads take.
  authorId: string;
  headSha: string;
  headRefName: string;
  baseRefName: string;
  /*
   * Whether its code comes from anywhere but a branch of the repository
   * itself: a fork, a branch whose repository is gone - or, on Forgejo and
   * Gitea, a head pushed with AGit (refs/for/main), which anyone who may
   * read the repository can do. A branch of the repository was pushed by
   * someone who can write to it.
   */
  isFromFork: boolean;
  // The files it changes, as the server counts them; 0 when it does not say.
  changedFilesCount: number;
  // Lines it adds and removes, when the server says; 0 otherwise.
  changedLineCount: number;
  // When it last changed, as the server says: an ISO time, or "".
  updatedAt: string;
}

/*
 * One file a pull request changes, with its diff - the shape GitHub's pull
 * request files have, which a production review reads on every host.
 */
export interface CodeHostChangedFile {
  filename: string;
  // The file's name before the pull request renamed it, when it did.
  previousFilename?: string | null | undefined;
  // "added", "removed", "modified" or "renamed".
  status: string;
  additions: number;
  deletions: number;
  // Its hunks ("@@ ..."): null for a binary file, or one not sent.
  patch: string | null;
}

export interface CodeHostChangedFiles {
  files: Array<CodeHostChangedFile>;
  // The pull request changes more files than these.
  hasMore: boolean;
}

// A comment OneUptime wrote, as the server keeps it.
export interface CodeHostComment {
  commentId: number;
  htmlUrl: string;
}
