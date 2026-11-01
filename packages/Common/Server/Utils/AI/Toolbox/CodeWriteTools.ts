import CodeRepository from "../../../../Models/DatabaseModels/CodeRepository";
import AIAgentTaskPullRequest from "../../../../Models/DatabaseModels/AIAgentTaskPullRequest";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import URL from "../../../../Types/API/URL";
import AIAgentTaskPullRequestService from "../../../Services/AIAgentTaskPullRequestService";
import CodeRepositoryService from "../../../Services/CodeRepositoryService";
import CodeHostWriters, {
  CodeHostWriter,
  CodeHostWriterGap,
  CodeHostWriterResult,
} from "../../CodeRepository/CodeHost/CodeHostWriter";
import {
  CodeHostBranch,
  CodeHostCommitMade,
  CodeHostFileWrite,
  CodeHostOpenedPullRequest,
} from "../../CodeRepository/CodeHost/CodeHostTypes";
import OpenPullRequestCap, {
  OpenPullRequestCapDecision,
} from "../CodeFix/OpenPullRequestCap";
import {
  ObservabilityTool,
  ToolArgs,
  ToolContext,
  ToolExecutionResult,
} from "./ToolTypes";
import { resolveTargetRepository } from "./CodeTools";
import PromptText from "../../../../Utils/AI/PromptText";
import CodeRepositoryType from "../../../../Types/CodeRepository/CodeRepositoryType";
import {
  CodeHost,
  CodeHostFacts,
} from "../../../../Types/CodeRepository/CodeHost";

/*
 * Tools that let the chat agent WRITE code: commit to a branch, and open a
 * pull request.
 *
 * The trust boundary here is the sharpest in the toolbox. This agent reads
 * telemetry — log lines and exception messages authored by whatever the
 * monitored application threw, which an attacker can influence — and it can
 * now turn that input into code. The answer to exactly this threat (a
 * prompt-injected log line must never become a merged backdoor) is
 * structural, not behavioural: a human reviews before anything merges.
 *
 * So the invariant these tools enforce, and which nothing here may relax:
 *   THE DEFAULT BRANCH IS NEVER WRITTEN. Protected branches are never written.
 * Every chat-authored commit lands somewhere a human must still merge from.
 * The default branch is read from the host rather than from our stored
 * mainBranchName, because that column is a copy made at import time and drifts.
 *
 * Chat writes to a repository on GitHub, GitLab, Forgejo or Gitea - through
 * the GitHub App, or the repository's connection (CodeHostWriter) - and
 * opens a pull request there: a merge request on GitLab. A Git server has
 * no pull requests to open, so chat writes nothing to one.
 */

let cachedUpdatePermissions: Array<Permission> | null = null;
/*
 * Writing code is gated on CodeRepository UPDATE, not read: whoever may point
 * OneUptime at a repository is the same person trusted to let it write there.
 * There is no finer-grained "may write code" permission, and G1's policy
 * gateway (risk tiers, capability-scoped tokens) does not exist yet — so this
 * deliberately errs narrow.
 *
 * Resolved lazily rather than at module load, for the same circular-dependency
 * reason as the read tools.
 */
const resolveUpdatePermissions: () => Array<Permission> =
  (): Array<Permission> => {
    if (!cachedUpdatePermissions) {
      cachedUpdatePermissions = new CodeRepository().getUpdatePermissions();
    }
    return cachedUpdatePermissions;
  };

/*
 * One commit's worth of edits. Chat has 16 tool calls; a sprawling refactor is
 * not what this is for, and each blob costs a round trip inside one 45s call.
 */
const MAX_FILES_PER_COMMIT: number = 10;
const MAX_FILE_BYTES: number = 256 * 1024;
const AI_BRANCH_PREFIX: string = "oneuptime-ai";

const FileChangesSchema: JSONObject = {
  type: "array",
  description:
    "The files to write. Each entry replaces that file's ENTIRE contents, so send the complete new file, not a diff or a fragment. Read the file with read_code_file first so you do not destroy code you never saw.",
  items: {
    type: "object",
    properties: {
      filePath: {
        type: "string",
        description:
          "Repository-relative path, e.g. 'src/billing/charge.ts'. A path that does not exist yet creates a new file.",
      },
      content: {
        type: "string",
        description: "The complete new contents of the file.",
      },
    },
    required: ["filePath", "content"],
  },
};

/*
 * Parse and validate the model's file changes. Everything here is untrusted
 * LLM output, so each entry is type-checked and bounded rather than trusted.
 */
function parseFileChanges(args: JSONObject): Array<CodeHostFileWrite> {
  const raw: unknown = args["changes"];

  if (!Array.isArray(raw) || raw.length === 0) {
    throw new BadDataException(
      "changes is required: a non-empty array of { filePath, content } objects.",
    );
  }

  if (raw.length > MAX_FILES_PER_COMMIT) {
    throw new BadDataException(
      `A single commit may change at most ${MAX_FILES_PER_COMMIT} files (got ${raw.length}). Make a smaller, focused change.`,
    );
  }

  const changes: Array<CodeHostFileWrite> = [];
  const seen: Set<string> = new Set<string>();

  for (const entry of raw as JSONArray) {
    const item: JSONObject = entry as JSONObject;
    const filePath: string | undefined = ToolArgs.getString(item, "filePath");
    const content: unknown = item["content"];

    if (!filePath) {
      throw new BadDataException(
        "Every entry in changes needs a non-empty filePath.",
      );
    }

    /*
     * content is read directly rather than via ToolArgs.getString: an empty
     * string is a legitimate new-file body, and getString would reject it.
     */
    if (typeof content !== "string") {
      throw new BadDataException(
        `The change for "${filePath}" needs a content string holding the file's complete new contents.`,
      );
    }

    if (Buffer.byteLength(content, "utf8") > MAX_FILE_BYTES) {
      throw new BadDataException(
        `"${filePath}" is larger than the ${MAX_FILE_BYTES / 1024}KB per-file limit for chat-authored commits.`,
      );
    }

    /*
     * The model reads files with their embedded data left out - a data: URL
     * in a stylesheet reads as "[image omitted: PNG, 2 KB]" (PromptText). A
     * file written back whole with that note in it would lose the image in
     * the pull request, so it is refused, with why.
     */
    const omittedNote: string | null = PromptText.findNote(content);

    if (omittedNote) {
      throw new BadDataException(
        `The new contents of "${filePath}" contain "${omittedNote}". You were shown that note in place of an image or other data embedded in the file, which you cannot read, and writing it would replace the data. Leave this file to a person, or change only files without embedded data.`,
      );
    }

    // A leading slash or traversal is a path the model invented, not a repo path.
    const normalized: string = filePath.replace(/^\/+/, "");

    if (normalized.includes("..") || normalized.trim() === "") {
      throw new BadDataException(
        `"${filePath}" is not a valid repository-relative path.`,
      );
    }

    if (seen.has(normalized)) {
      throw new BadDataException(
        `"${normalized}" appears twice in changes; each file may be written once per commit.`,
      );
    }

    seen.add(normalized);
    changes.push({ filePath: normalized, content: content });
  }

  return changes;
}

/*
 * The repository a change is written to must be one the person asking may
 * change in OneUptime: the gate's CodeRepository update permission, held to
 * this repository - their labels and their team's blocks - as an update of
 * it is held (findOneUpdatableById). Reading a repository is not enough to
 * write to it. The branch, the commit and the pull request are then made by
 * OneUptime itself - its GitHub App, or the repository's connection to
 * GitLab, Forgejo or Gitea - as every code change OneUptime makes is.
 */
async function assertMayChangeRepository(data: {
  ctx: ToolContext;
  repository: CodeRepository;
}): Promise<void> {
  const changeable: CodeRepository | null =
    await CodeRepositoryService.findOneUpdatableById({
      id: data.repository.id!,
      select: { _id: true },
      props: data.ctx.props,
    });

  if (!changeable) {
    throw new NotAuthorizedException(
      `You do not have permission to change the repository ${data.repository.organizationName}/${data.repository.repositoryName} in OneUptime, so chat cannot write code to it for you.`,
    );
  }
}

/*
 * Chat writes code through the host's API - the GitHub App's, or a GitLab,
 * Forgejo or Gitea repository's connection - with commits made without a
 * clone, and the pull (or merge) request. A Git server has no pull
 * requests: a change there is asked for in Code, where AI works in the
 * repository on a Runner and pushes a branch - said so, plainly.
 */
export function assertChatWritesToRepository(repository: CodeRepository): void {
  const type: CodeRepositoryType = CodeHost.readType(
    repository.repositoryHostedAt,
  );

  if (type === CodeRepositoryType.Git) {
    throw new BadDataException(
      `${repository.organizationName}/${repository.repositoryName} is on a Git server, which has no pull requests for chat to open. Ask for the change in Code instead, where AI works in the repository and pushes a branch you open a pull request from.`,
    );
  }
}

/*
 * The writer of the repository: GitHub's through the installation
 * findReadableRepositories proved is the project's, any other host's
 * through its connection, read again as root - or why there is none.
 */
async function openWriter(data: {
  ctx: ToolContext;
  repository: CodeRepository;
}): Promise<CodeHostWriter> {
  const type: CodeRepositoryType = CodeHost.readType(
    data.repository.repositoryHostedAt,
  );

  if (type === CodeRepositoryType.GitHub) {
    return CodeHostWriters.gitHub({
      installationId: data.repository.gitHubAppInstallationId!,
      organizationName: data.repository.organizationName!,
      repositoryName: data.repository.repositoryName!,
    });
  }

  const opened: CodeHostWriterResult = await CodeHostWriters.openForRepository({
    projectId: data.ctx.projectId,
    repositoryId: data.repository.id!,
  });

  if (opened.writer) {
    return opened.writer;
  }

  const facts: CodeHostFacts = CodeHost.getFacts(type);
  const name: string = `${data.repository.organizationName}/${data.repository.repositoryName}`;

  throw new BadDataException(
    opened.gap === CodeHostWriterGap.NoApi
      ? `${name} is on a Git server, which has no pull requests for chat to open. Ask for the change in Code instead.`
      : `${name}'s connection to ${facts.name} does not work now, so chat cannot write to it. Replace its access token on the repository's Settings page in Code.`,
  );
}

// A pull (or merge) request as its host writes it: GitLab's "!12", "#12".
function getPullRequestLabel(
  type: CodeRepositoryType | string | null | undefined,
  number: number,
): string {
  return `${CodeHost.readType(type) === CodeRepositoryType.GitLab ? "!" : "#"}${number}`;
}

/*
 * THE safety gate. Resolves a branch and refuses it if it is the repository's
 * real default branch or is protected — so a chat-authored commit can only
 * ever land somewhere a human still has to merge from. The host's own
 * answer decides, never the stored copy of the default branch.
 */
async function assertBranchIsWritable(data: {
  repository: CodeRepository;
  writer: CodeHostWriter;
  branchName: string;
}): Promise<CodeHostBranch> {
  const name: string = `${data.repository.organizationName}/${data.repository.repositoryName}`;

  const defaultBranchName: string = await data.writer.getDefaultBranchName();

  if (
    defaultBranchName &&
    data.branchName.toLowerCase() === defaultBranchName.toLowerCase()
  ) {
    throw new BadDataException(
      `"${data.branchName}" is the default branch of ${name}, and chat may never commit to it. Use open_code_pull_request instead so a human reviews the change before it lands.`,
    );
  }

  const branch: CodeHostBranch | null = await data.writer.getBranch(
    data.branchName,
  );

  if (!branch) {
    throw new BadDataException(
      `Branch "${data.branchName}" does not exist in ${name}. Use open_code_pull_request to create a new branch, or name an existing one.`,
    );
  }

  if (branch.isProtected) {
    throw new BadDataException(
      `Branch "${data.branchName}" is protected in ${name}, so chat may not commit to it. Use open_code_pull_request instead.`,
    );
  }

  return branch;
}

// A branch name that is obviously machine-authored, and legal in git.
function buildAiBranchName(title: string): string {
  const slug: string =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "change";

  /*
   * A short random suffix rather than a timestamp: Date.now() would collide
   * for two changes proposed in the same millisecond, and the suffix only has
   * to disambiguate, not order.
   */
  const suffix: string = ObjectID.generate().toString().slice(-8);

  return `${AI_BRANCH_PREFIX}/${slug}-${suffix}`;
}

function describeChanges(changes: Array<CodeHostFileWrite>): string {
  return changes
    .map((change: CodeHostFileWrite) => {
      return `- ${change.filePath}`;
    })
    .join("\n");
}

export const CommitCodeToBranchTool: ObservabilityTool = {
  name: "commit_code_to_branch",
  description:
    "Commit file changes to an EXISTING branch of a connected repository on GitHub, GitLab, Forgejo or Gitea. Never commits to the default or a protected branch — those are refused. Use this only when the user names a branch to commit onto; otherwise prefer open_code_pull_request. Read each file with read_code_file first: content replaces the whole file.",
  isMutation: true,
  inputSchema: {
    type: "object",
    properties: {
      branchName: {
        type: "string",
        description:
          "The existing branch to commit onto. Must not be the default branch or a protected branch.",
      },
      commitMessage: {
        type: "string",
        description: "A concise, conventional commit message.",
      },
      changes: FileChangesSchema,
      repositoryId: {
        type: "string",
        description:
          "Which repository, from list_code_repositories. Optional when the project has exactly one connected repository.",
      },
    },
    required: ["branchName", "commitMessage", "changes"],
  },
  get requiredPermissions(): Array<Permission> {
    return resolveUpdatePermissions();
  },
  buildActionTitle: (args: JSONObject): string => {
    const branch: string = ToolArgs.getString(args, "branchName") || "a branch";
    const count: number = Array.isArray(args["changes"])
      ? args["changes"].length
      : 0;
    return `Commit ${count} file${count === 1 ? "" : "s"} to ${branch}`;
  },
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    const branchName: string | undefined = ToolArgs.getString(
      args,
      "branchName",
    );
    const commitMessage: string | undefined = ToolArgs.getString(
      args,
      "commitMessage",
    );

    if (!branchName) {
      throw new BadDataException("branchName is required.");
    }

    if (!commitMessage) {
      throw new BadDataException("commitMessage is required.");
    }

    const changes: Array<CodeHostFileWrite> = parseFileChanges(args);
    const repository: CodeRepository = await resolveTargetRepository(ctx, args);

    assertChatWritesToRepository(repository);
    await assertMayChangeRepository({ ctx, repository });

    const writer: CodeHostWriter = await openWriter({ ctx, repository });

    await assertBranchIsWritable({ repository, writer, branchName });

    const commit: CodeHostCommitMade = await writer.commitFiles({
      branchName: branchName,
      files: changes,
      commitMessage: commitMessage,
    });

    return {
      dataForLlm: [
        `Committed ${changes.length} file(s) to branch ${branchName} of ${repository.organizationName}/${repository.repositoryName}.`,
        `commitSha: ${commit.commitSha}`,
        `commitUrl: ${commit.htmlUrl}`,
        `files:\n${describeChanges(changes)}`,
        `This commit is NOT merged and NOT on the default branch. Tell the user it is on ${branchName} and still needs review.`,
      ].join("\n"),
      rowCount: changes.length,
      citationLabel: `Commit ${commit.commitSha.slice(0, 7)} on ${branchName} (${changes.length} file${changes.length === 1 ? "" : "s"})`,
      redactionCount: 0,
      isTruncated: false,
    };
  },
};

export const OpenCodePullRequestTool: ObservabilityTool = {
  name: "open_code_pull_request",
  description:
    "Propose a code change: creates a new branch off the default branch, commits the changes, and opens a pull request (a merge request on GitLab), ready for review, for a human to review and merge. Works in repositories on GitHub, GitLab, Forgejo and Gitea. This is the safe, preferred way to change code from chat — it never writes to the default branch and never merges. Read each file with read_code_file first: content replaces the whole file.",
  isMutation: true,
  inputSchema: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "The pull request title — a short summary of the fix.",
      },
      description: {
        type: "string",
        description:
          "The pull request body. Explain what broke, the evidence (cite the exception/logs you used), and why this change fixes it.",
      },
      changes: FileChangesSchema,
      commitMessage: {
        type: "string",
        description: "Commit message. Defaults to the title when omitted.",
      },
      repositoryId: {
        type: "string",
        description:
          "Which repository, from list_code_repositories or find_code_for_exception. Optional when the project has exactly one connected repository.",
      },
    },
    required: ["title", "description", "changes"],
  },
  get requiredPermissions(): Array<Permission> {
    return resolveUpdatePermissions();
  },
  buildActionTitle: (args: JSONObject): string => {
    return `Open pull request: ${ToolArgs.getString(args, "title") || "Untitled"}`;
  },
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    const title: string | undefined = ToolArgs.getString(args, "title");
    const description: string | undefined = ToolArgs.getString(
      args,
      "description",
    );

    if (!title) {
      throw new BadDataException("title is required.");
    }

    if (!description) {
      throw new BadDataException(
        "description is required — explain the change and cite the evidence for it.",
      );
    }

    const changes: Array<CodeHostFileWrite> = parseFileChanges(args);
    const repository: CodeRepository = await resolveTargetRepository(ctx, args);

    assertChatWritesToRepository(repository);
    await assertMayChangeRepository({ ctx, repository });

    /*
     * The same per-repository open-PR cap the autonomous fix agent obeys. Chat
     * PRs are recorded as AIAgentTaskPullRequest rows below, so they count
     * against it too — otherwise chat would be an uncapped way to flood a
     * review queue the cap exists to protect.
     */
    const capDecision: OpenPullRequestCapDecision =
      await OpenPullRequestCap.checkForRepository({
        codeRepositoryId: repository.id!,
        configuredLimit: repository.maxOpenFixPullRequests,
      });

    if (!capDecision.allowed) {
      throw new BadDataException(
        OpenPullRequestCap.describeRejection({
          decision: capDecision,
          repositoryName: `${repository.organizationName}/${repository.repositoryName}`,
        }),
      );
    }

    const organizationName: string = repository.organizationName!;
    const repositoryName: string = repository.repositoryName!;
    const writer: CodeHostWriter = await openWriter({ ctx, repository });

    const baseBranchName: string = await writer.getDefaultBranchName();

    if (!baseBranchName) {
      throw new BadDataException(
        `Could not determine the default branch of ${organizationName}/${repositoryName}.`,
      );
    }

    const headBranchName: string = buildAiBranchName(title);

    const created: boolean = await writer.createBranch({
      branchName: headBranchName,
      fromBranchName: baseBranchName,
    });

    if (!created) {
      throw new BadDataException(
        `Branch ${headBranchName} already exists in ${organizationName}/${repositoryName}. Try again — a fresh branch name will be generated.`,
      );
    }

    await writer.commitFiles({
      branchName: headBranchName,
      files: changes,
      commitMessage: ToolArgs.getString(args, "commitMessage") || title,
    });

    const pullRequest: CodeHostOpenedPullRequest = await writer.openPullRequest(
      {
        baseBranchName: baseBranchName,
        headBranchName: headBranchName,
        title: title,
        body: `${description}\n\n---\n_Proposed by OneUptime AI from a chat conversation. Review carefully before merging: this change was written by an agent that reads production telemetry._`,
      },
    );
    const label: string = getPullRequestLabel(
      writer.provider,
      pullRequest.number,
    );

    /*
     * Record the PR so the open-PR cap can see it and the
     * AIAgent:SyncPullRequestStates worker keeps its state current. An
     * unrecorded PR is an UNCAPPED PR, so this is load-bearing, not bookkeeping.
     *
     * aiRunId / aiAgentId stay unset — this PR came from a chat turn, not an
     * agent run. Both columns are nullable for exactly this case (aiAgentId was
     * made nullable by AllowNullAiAgentOnPullRequest1784135099754; it was
     * NOT NULL before, which made this create() throw *after* the PR was
     * already open on GitHub). The sync worker guards on aiRunId before
     * emitting run events, so a null agent is safe there.
     *
     * isRoot because AIAgentTaskPullRequest has no create ACL for a normal
     * user: it is OneUptime's own record of the pull request it opened. The
     * authorization already happened at the tool's permission gate and at
     * assertMayChangeRepository, both under ctx.props.
     */
    const record: AIAgentTaskPullRequest = new AIAgentTaskPullRequest();
    record.projectId = ctx.projectId;
    record.codeRepositoryId = repository.id!;
    record.title = title;
    record.description = description;
    record.pullRequestId = pullRequest.id;
    record.pullRequestNumber = pullRequest.number;
    record.pullRequestState = pullRequest.state;
    record.headRefName = headBranchName;
    record.baseRefName = baseBranchName;
    record.repoOrganizationName = organizationName;
    record.repoName = repositoryName;
    record.pullRequestUrl = URL.fromString(pullRequest.htmlUrl);

    if (ctx.props.userId) {
      record.createdByUserId = ctx.props.userId;
    }

    await AIAgentTaskPullRequestService.create({
      data: record,
      props: { isRoot: true },
    });

    const pullRequestUrl: string = record.pullRequestUrl.toString();

    return {
      dataForLlm: [
        `Opened ${writer.pullRequestTerm} ${label} on ${organizationName}/${repositoryName}, ready for review.`,
        `url: ${pullRequestUrl}`,
        `branch: ${headBranchName} → ${baseBranchName}`,
        `files:\n${describeChanges(changes)}`,
        `It is NOT merged. Give the user the link and say it needs their review.`,
      ].join("\n"),
      rowCount: changes.length,
      citationLabel: `${writer.provider === CodeRepositoryType.GitLab ? "MR" : "PR"} ${label}: ${title}`,
      redactionCount: 0,
      isTruncated: false,
    };
  },
};

export { MAX_FILES_PER_COMMIT, AI_BRANCH_PREFIX };
