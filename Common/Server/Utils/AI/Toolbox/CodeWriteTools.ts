import CodeRepository from "../../../../Models/DatabaseModels/CodeRepository";
import AIAgentTaskPullRequest from "../../../../Models/DatabaseModels/AIAgentTaskPullRequest";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import URL from "../../../../Types/API/URL";
import PullRequest from "../../../../Types/CodeRepository/PullRequest";
import AIAgentTaskPullRequestService from "../../../Services/AIAgentTaskPullRequestService";
import GitHubUtil, {
  GitHubBranchInfo,
  GitHubCommitResult,
  GitHubFileChange,
} from "../../CodeRepository/GitHub/GitHub";
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

/*
 * Tools that let the chat agent WRITE code: commit to a branch, and open a
 * pull request.
 *
 * The trust boundary here is the sharpest in the toolbox. This agent reads
 * telemetry — log lines and exception messages authored by whatever the
 * monitored application threw, which an attacker can influence — and it can
 * now turn that input into code. AISentinelVision.md's answer to exactly this
 * threat ("a prompt-injected log line must never become a merged backdoor") is
 * structural, not behavioural: a human reviews before anything merges.
 *
 * So the invariant these tools enforce, and which nothing here may relax:
 *   THE DEFAULT BRANCH IS NEVER WRITTEN. Protected branches are never written.
 * Every chat-authored commit lands somewhere a human must still merge from.
 * The default branch is read from GitHub rather than from our stored
 * mainBranchName, because that column is a copy made at import time and drifts.
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
function parseFileChanges(args: JSONObject): Array<GitHubFileChange> {
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

  const changes: Array<GitHubFileChange> = [];
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
 * THE safety gate. Resolves a branch and refuses it if it is the repository's
 * real default branch or is protected — so a chat-authored commit can only
 * ever land somewhere a human still has to merge from.
 */
async function assertBranchIsWritable(data: {
  repository: CodeRepository;
  branchName: string;
}): Promise<GitHubBranchInfo> {
  const installationId: string = data.repository.gitHubAppInstallationId!;
  const organizationName: string = data.repository.organizationName!;
  const repositoryName: string = data.repository.repositoryName!;

  const defaultBranchName: string = await GitHubUtil.getDefaultBranchName({
    installationId,
    organizationName,
    repositoryName,
  });

  if (
    defaultBranchName &&
    data.branchName.toLowerCase() === defaultBranchName.toLowerCase()
  ) {
    throw new BadDataException(
      `"${data.branchName}" is the default branch of ${organizationName}/${repositoryName}, and chat may never commit to it. Use open_code_pull_request instead so a human reviews the change before it lands.`,
    );
  }

  const branch: GitHubBranchInfo | null = await GitHubUtil.getBranch({
    installationId,
    organizationName,
    repositoryName,
    branchName: data.branchName,
  });

  if (!branch) {
    throw new BadDataException(
      `Branch "${data.branchName}" does not exist in ${organizationName}/${repositoryName}. Use open_code_pull_request to create a new branch, or name an existing one.`,
    );
  }

  if (branch.isProtected) {
    throw new BadDataException(
      `Branch "${data.branchName}" is protected in ${organizationName}/${repositoryName}, so chat may not commit to it. Use open_code_pull_request instead.`,
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

function describeChanges(changes: Array<GitHubFileChange>): string {
  return changes
    .map((change: GitHubFileChange) => {
      return `- ${change.filePath}`;
    })
    .join("\n");
}

export const CommitCodeToBranchTool: ObservabilityTool = {
  name: "commit_code_to_branch",
  description:
    "Commit file changes to an EXISTING branch of a connected repository. Never commits to the default or a protected branch — those are refused. Use this only when the user names a branch to commit onto; otherwise prefer open_code_pull_request. Read each file with read_code_file first: content replaces the whole file.",
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

    const changes: Array<GitHubFileChange> = parseFileChanges(args);
    const repository: CodeRepository = await resolveTargetRepository(ctx, args);

    await assertBranchIsWritable({ repository, branchName });

    const commit: GitHubCommitResult = await GitHubUtil.commitFilesToBranch({
      installationId: repository.gitHubAppInstallationId!,
      organizationName: repository.organizationName!,
      repositoryName: repository.repositoryName!,
      branchName: branchName,
      changes: changes,
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
    "Propose a code change: creates a new branch off the default branch, commits the changes, and opens a DRAFT pull request for a human to review. This is the safe, preferred way to change code from chat — it never writes to the default branch. Read each file with read_code_file first: content replaces the whole file.",
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
    return `Open draft pull request: ${ToolArgs.getString(args, "title") || "Untitled"}`;
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

    const changes: Array<GitHubFileChange> = parseFileChanges(args);
    const repository: CodeRepository = await resolveTargetRepository(ctx, args);

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

    const installationId: string = repository.gitHubAppInstallationId!;
    const organizationName: string = repository.organizationName!;
    const repositoryName: string = repository.repositoryName!;

    const baseBranchName: string = await GitHubUtil.getDefaultBranchName({
      installationId,
      organizationName,
      repositoryName,
    });

    if (!baseBranchName) {
      throw new BadDataException(
        `Could not determine the default branch of ${organizationName}/${repositoryName}.`,
      );
    }

    const headBranchName: string = buildAiBranchName(title);

    const created: boolean = await GitHubUtil.createBranch({
      installationId,
      organizationName,
      repositoryName,
      newBranchName: headBranchName,
      fromBranchName: baseBranchName,
    });

    if (!created) {
      throw new BadDataException(
        `Branch ${headBranchName} already exists in ${organizationName}/${repositoryName}. Try again — a fresh branch name will be generated.`,
      );
    }

    await GitHubUtil.commitFilesToBranch({
      installationId,
      organizationName,
      repositoryName,
      branchName: headBranchName,
      changes: changes,
      commitMessage: ToolArgs.getString(args, "commitMessage") || title,
    });

    const pullRequest: PullRequest =
      await GitHubUtil.createPullRequestWithToken({
        installationId,
        organizationName,
        repositoryName,
        baseBranchName: baseBranchName,
        headBranchName: headBranchName,
        title: title,
        body: `${description}\n\n---\n_Proposed by OneUptime AI from a chat conversation. Review carefully before merging: this change was written by an agent that reads production telemetry._`,
        isDraft: true,
      });

    /*
     * Record the PR so the open-PR cap can see it and the
     * AIAgent:SyncPullRequestStates worker keeps its state current. aiRunId /
     * aiAgentId stay unset: this PR came from a chat turn, not an agent run,
     * and the worker guards on aiRunId before emitting run events.
     */
    const record: AIAgentTaskPullRequest = new AIAgentTaskPullRequest();
    record.projectId = ctx.projectId;
    record.codeRepositoryId = repository.id!;
    record.title = title;
    record.description = description;
    record.pullRequestId = pullRequest.pullRequestId;
    record.pullRequestNumber = pullRequest.pullRequestNumber;
    record.pullRequestState = pullRequest.state;
    record.headRefName = headBranchName;
    record.baseRefName = baseBranchName;
    record.repoOrganizationName = organizationName;
    record.repoName = repositoryName;
    record.pullRequestUrl = URL.fromString(
      `https://github.com/${organizationName}/${repositoryName}/pull/${pullRequest.pullRequestNumber}`,
    );

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
        `Opened DRAFT pull request #${pullRequest.pullRequestNumber} on ${organizationName}/${repositoryName}.`,
        `url: ${pullRequestUrl}`,
        `branch: ${headBranchName} → ${baseBranchName}`,
        `files:\n${describeChanges(changes)}`,
        `It is a DRAFT and is NOT merged. Give the user the link and say it needs their review.`,
      ].join("\n"),
      rowCount: changes.length,
      citationLabel: `Draft PR #${pullRequest.pullRequestNumber}: ${title}`,
      redactionCount: 0,
      isTruncated: false,
    };
  },
};

export { MAX_FILES_PER_COMMIT, AI_BRANCH_PREFIX };
