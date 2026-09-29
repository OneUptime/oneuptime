import GitHubTaskHandlerBase from "./GitHubTaskHandlerBase";
import { TaskContext, TaskResult } from "./TaskHandlerInterface";
import {
  GitHubReviewCommentInput,
  GitHubTaskDetails,
  PostGitHubReviewResult,
} from "../Utils/BackendAPI";
import RepositoryManager, {
  RepositoryConfig,
  CloneResult,
} from "../Utils/RepositoryManager";
import { CodeAgent, CodeAgentResult } from "../CodeAgents/Index";
import CodeFixTaskType from "Common/Types/AI/CodeFixTaskType";

/*
 * GitHubPullRequestReview: "@mention review", or a review requested from the
 * app's bot user.
 *
 * The only recipe that writes nothing to the repository. It clones so the
 * agent can read AROUND the diff — a review that can only see the changed
 * lines cannot tell you the caller three files away still passes the old
 * argument — and then posts its opinion as a review COMMENT.
 *
 * Never an approval and never a change request. An approval from an app can
 * satisfy a branch protection rule, which would quietly turn an automated
 * reviewer into an automated merger; the strength of the opinion belongs in
 * the words, not in a status a rule can act on. That decision is enforced
 * server-side in GitHubConversation.createPullRequestReview — this handler
 * cannot override it, and should not try.
 *
 * If the agent modifies a file anyway, the change is DISCARDED: nothing here
 * commits, stages or pushes, and the clone is deleted when the run ends.
 */
export default class GitHubPullRequestReviewTaskHandler extends GitHubTaskHandlerBase {
  public readonly taskType: string = CodeFixTaskType.GitHubPullRequestReview;
  public readonly name: string = "GitHub Pull Request Review Handler";

  // A review body GitHub will accept and a person will actually read.
  private static readonly MAX_REVIEW_BODY_LENGTH: number = 60000;

  /*
   * What to post when the agent produced anchors but no prose. Falling back to
   * the raw answer would put the JSON block itself on the pull request as the
   * review body — a wall of machine output where the reader expects a verdict.
   */
  private static readonly EMPTY_REVIEW_BODY: string =
    "I reviewed this pull request and left my findings as inline comments.";

  /*
   * The pull request's own branch when it is reachable, and NOTHING when it is
   * not — a fork's branch is in another repository, so the clone falls back to
   * this repository's default branch and the review is written against the
   * base plus the diff. buildPrompt says which of the two the agent is looking
   * at, because a reviewer that thinks it is reading the changed code when it
   * is reading the base will confidently review the wrong thing.
   */
  protected getBranchToCheckout(
    details: GitHubTaskDetails,
  ): string | undefined {
    return details.pullRequest?.headRefName || undefined;
  }

  protected async runTask(data: {
    context: TaskContext;
    details: GitHubTaskDetails;
    repositoryConfig: RepositoryConfig;
    cloneResult: CloneResult;
    repositoryManager: RepositoryManager;
    agent: CodeAgent;
  }): Promise<TaskResult> {
    const { context, details, cloneResult, agent } = data;

    if (!details.pullRequest) {
      return this.createFailureResult(
        "This task has no pull request to review.",
        { isError: true },
      );
    }

    await this.log(
      context,
      `Reviewing pull request #${details.pullRequest.number}`,
    );

    const agentResult: CodeAgentResult = await this.runCodeAgent({
      agent: agent,
      repositoryPath: cloneResult.repositoryPath,
      prompt: this.buildPrompt(details),
    });

    if (agentResult.filesModified.length > 0) {
      /*
       * The agent was told to read only. It wrote anyway — a prompt-following
       * failure worth seeing in the log. Nothing is staged or pushed, and the
       * workspace is deleted when this run ends, so the edits go nowhere; the
       * review itself is still worth posting.
       */
      await this.log(
        context,
        `The review agent modified ${agentResult.filesModified.length} file(s); discarding them — a review never changes code.`,
        "warning",
      );
    }

    const review: ParsedReview = GitHubPullRequestReviewTaskHandler.parseReview(
      agentResult.summary,
    );

    if (!review.body.trim()) {
      return this.createNoFixResult(
        "The review agent finished without producing a review.",
      );
    }

    await this.log(
      context,
      `Posting review (${review.comments.length} inline comment(s))...`,
    );

    const posted: PostGitHubReviewResult =
      await context.backendAPI.postGitHubReview({
        taskId: context.taskId.toString(),
        body: review.body.substring(
          0,
          GitHubPullRequestReviewTaskHandler.MAX_REVIEW_BODY_LENGTH,
        ),
        comments: review.comments,
      });

    await this.log(context, `Review posted: ${posted.reviewUrl}`);

    return {
      success: true,
      message: `Reviewed pull request #${details.pullRequest.number}`,
      pullRequestsCreated: 0,
      data: {
        reviewUrl: posted.reviewUrl,
        inlineComments: review.comments.length,
      },
    };
  }

  /*
   * Split the agent's answer into the review prose and its inline anchors.
   *
   * The anchors come back as a fenced ```json block at the end, which is the
   * most reliable structured output to get out of a text completion without a
   * second round trip. Everything about the parsing is forgiving on purpose: a
   * malformed block costs the ANCHORS, never the review. A reviewer would much
   * rather read good prose with no inline pins than nothing at all — and the
   * server drops any individual anchor it cannot use, with GitHub itself as
   * the final arbiter of whether a line is in the diff.
   */
  public static parseReview(summary: string): ParsedReview {
    const text: string = summary || "";

    /*
     * The LAST ```json fence, not the first. The leading `[\s\S]*` is greedy on
     * purpose: a review whose prose quotes a JSON snippet in its own fence and
     * then ends with the real anchor block would otherwise capture everything
     * between the two fences, fail to parse, and silently lose every anchor —
     * on exactly the reviews that were doing the most work.
     */
    const fenceMatch: RegExpMatchArray | null = text.match(
      /^([\s\S]*)```json\s*\n([\s\S]*?)\n?```\s*$/,
    );

    if (!fenceMatch || fenceMatch[2] === undefined) {
      return { body: text.trim(), comments: [] };
    }

    const body: string = (fenceMatch[1] || "").trim();

    let parsed: unknown;

    try {
      parsed = JSON.parse(fenceMatch[2]);
    } catch {
      // Not JSON after all — treat the whole answer as prose.
      return { body: text.trim(), comments: [] };
    }

    const rawComments: unknown = Array.isArray(parsed)
      ? parsed
      : (parsed as { comments?: unknown })?.comments;

    if (!Array.isArray(rawComments)) {
      return {
        body: body || GitHubPullRequestReviewTaskHandler.EMPTY_REVIEW_BODY,
        comments: [],
      };
    }

    const comments: Array<GitHubReviewCommentInput> = [];

    for (const entry of rawComments) {
      /*
       * A null or non-object entry is DROPPED, not dereferenced. A trailing
       * comma in the model's JSON produces a literal null in the array, and
       * reading `.path` off it throws — turning one stray character into a
       * failed run on a review that was otherwise complete.
       */
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        continue;
      }

      const candidate: {
        path?: unknown;
        line?: unknown;
        body?: unknown;
      } = entry as { path?: unknown; line?: unknown; body?: unknown };

      if (
        typeof candidate.path === "string" &&
        candidate.path.trim() &&
        typeof candidate.line === "number" &&
        Number.isInteger(candidate.line) &&
        candidate.line > 0 &&
        typeof candidate.body === "string" &&
        candidate.body.trim()
      ) {
        comments.push({
          path: candidate.path.trim(),
          line: candidate.line,
          body: candidate.body.trim(),
        });
      }
    }

    return {
      body: body || GitHubPullRequestReviewTaskHandler.EMPTY_REVIEW_BODY,
      comments: comments,
    };
  }

  private buildPrompt(details: GitHubTaskDetails): string {
    const pullRequest: NonNullable<GitHubTaskDetails["pullRequest"]> =
      details.pullRequest!;

    return `You are a senior engineer reviewing a pull request in this repository. You are READ-ONLY: do not modify, create or delete any file. Read the code, then write a review.

${
  pullRequest.headRefName
    ? `The working copy is checked out on the pull request's branch (\`${pullRequest.headRefName}\`), so you can read the code AS CHANGED, and read the code around it that the diff does not show.`
    : `This pull request comes from a fork, so its branch is not available here. The working copy is checked out on the BASE branch — the code as it is WITHOUT these changes. Read the diff below for what changes, and read the working copy for the surrounding code the diff does not show. Do not describe the working copy as if it already contained this pull request's changes, and say in your review that you reviewed a fork from the base branch.`
}

## The pull request

**#${pullRequest.number}: ${pullRequest.title}** by @${pullRequest.authorLogin}
Targets \`${pullRequest.baseRefName}\` · ${pullRequest.changedFilesCount} file(s) changed, +${pullRequest.additions} −${pullRequest.deletions}

<pull-request-description>
${pullRequest.body || "_No description._"}
</pull-request-description>

${this.buildDiffSection(details)}
${this.buildConversationSection(details)}
${this.buildRequestSection(details)}
## What to look for, in order

1. **Correctness.** Does the change do what it says? Off-by-one errors, wrong conditions, unhandled null/undefined, mishandled errors, race conditions, resource leaks.
2. **Breakage.** Does it break existing callers? Search for the functions and types it changes and check every call site — this is the thing a diff-only reviewer cannot do and you can.
3. **Security.** Injection, missing authorization checks, secrets in code, unsafe deserialization, user input reaching a dangerous sink.
4. **Tests.** Is the new behaviour covered, in this repository's existing style? Say what is missing, specifically.
5. **Fit.** Does it follow the conventions already in this repository?

## How to write it

- Lead with a two-or-three sentence verdict: what this changes, and whether you found anything that should block it.
- Then the findings, most important first. For each one: where it is (\`path/to/file.ts:123\`), what goes wrong, and — concretely — what to do instead.
- Cite real file paths and real line numbers. Read the file to confirm the line before you cite it.
- Say plainly when you find nothing wrong. A short honest review is worth more than a long one padded with style nits.
- Do NOT nitpick formatting, naming preferences or anything a linter would catch.
- Do NOT approve or reject. You are one reviewer among others; give your reading and let a human decide.
- Do not repeat points already made in the discussion above.

## Output format

Write the review as markdown. Then, if you have findings that anchor to a specific changed line, end your answer with a single fenced JSON block listing them:

\`\`\`json
{"comments": [{"path": "src/api/user.ts", "line": 42, "body": "This dereferences \`user\` before the null check three lines below."}]}
\`\`\`

Rules for that block, if you include one:
- Only lines that appear as ADDED or CHANGED in this pull request's diff. GitHub cannot anchor a comment to an unchanged line, and one bad anchor loses every anchor.
- \`line\` is the line number in the file AFTER the change.
- Leave the block out entirely if you have no line-anchored findings. The prose review is what matters.`;
  }

  public getDescription(): string {
    return "Reviews a pull request and posts the review as a comment — reading the whole repository, not just the diff. Never approves, never changes code.";
  }
}

export interface ParsedReview {
  body: string;
  comments: Array<GitHubReviewCommentInput>;
}
