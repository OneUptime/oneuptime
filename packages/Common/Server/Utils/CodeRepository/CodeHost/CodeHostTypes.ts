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

/*
 * One file OneUptime writes in a commit: its path in the repository and
 * its whole new text (chat's code writes, CodeHostWriter).
 */
export interface CodeHostFileWrite {
  filePath: string;
  content: string;
}

// A commit OneUptime made: its SHA, and its page on the host.
export interface CodeHostCommitMade {
  commitSha: string;
  htmlUrl: string;
}

// A pull (or merge) request OneUptime opened.
export interface CodeHostOpenedPullRequest {
  // The server's own id for it (GitLab's global id, Forgejo's id).
  id: number;
  // Its number on its pages: GitLab's iid ("!12"), Forgejo's index ("#12").
  number: number;
  htmlUrl: string;
  state: PullRequestState;
}

/*
 * One commit, as a deploy's list of them says it (get_change_details):
 * the first line of its message, who wrote it, when, and the pull (or
 * merge) requests its message names.
 */
export interface CodeHostCommitSummary {
  sha: string;
  // The first line of the commit message.
  message: string;
  authorName: string;
  authorLogin?: string | undefined;
  date?: string | undefined;
  // "(#482)", "Merge pull request #482", GitLab's "See merge request x!12".
  pullRequestNumbers: Array<number>;
}

/*
 * A file a commit, or a range of them, changed. Forgejo and Gitea say
 * which files and how, not how many lines: their counts are left out.
 */
export interface CodeHostCommitFile {
  path: string;
  // "added", "removed", "modified" or "renamed".
  status: string;
  additions?: number | undefined;
  deletions?: number | undefined;
}

/*
 * What a deploy shipped since the one before it: the commits from one to
 * the other, newest first, and the files they changed.
 */
export interface CodeHostCommitRange {
  /*
   * "ahead" (the head has commits the base does not), "behind" (the head
   * is older than the base: a rollback) or "identical" - GitHub's words,
   * to which GitHub adds "diverged".
   */
  status: string;
  totalCommits: number;
  // Newest first, at most CODE_HOST_MAX_COMMITS.
  commits: Array<CodeHostCommitSummary>;
  files: Array<CodeHostCommitFile>;
  isTruncated: boolean;
}

// A pull (or merge) request a commit came from.
export interface CodeHostPullRequestSummary {
  number: number;
  title: string;
  authorLogin?: string | undefined;
  mergedAt?: string | undefined;
  url: string;
}

// The most commits and files a deploy's list keeps, as GitHub's does.
export const CODE_HOST_MAX_COMMITS: number = 30;
export const CODE_HOST_MAX_FILES: number = 50;
