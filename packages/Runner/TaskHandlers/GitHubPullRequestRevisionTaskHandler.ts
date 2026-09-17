import GitHubTaskHandlerBase from "./GitHubTaskHandlerBase";
import { TaskContext, TaskResult } from "./TaskHandlerInterface";
import { GitHubTaskDetails } from "../Utils/BackendAPI";
import RepositoryManager, {
  RepositoryConfig,
  CloneResult,
} from "../Utils/RepositoryManager";
import BuildVerification, {
  VerificationOutcome,
} from "../Utils/BuildVerification";
import { CodeAgent, CodeAgentResult } from "../CodeAgents/Index";
import CodeFixTaskType from "Common/Types/AI/CodeFixTaskType";

/*
 * GitHubPullRequestRevision: "@mention revise this — the retry loop should back
 * off exponentially", written on an open pull request.
 *
 * The one recipe that pushes to a branch it did not create. Everything about
 * it follows from that:
 *
 *   - It checks out the pull request's OWN head branch, pinned at trigger time
 *     by the webhook handler, and pushes back to that same branch. It never
 *     creates a branch and never opens a pull request; the review thread the
 *     person is already reading simply gains commits.
 *
 *   - It refuses to run against a fork. The webhook handler already turns
 *     those away, and this is the second line of the same fence: a fork's
 *     branch is not in the repository this installation can write to, so a
 *     push would either fail or create a stray same-named branch here.
 *
 *   - It never force-pushes and never rewrites history. Reviewers have read
 *     these commits; the revision is additive.
 */
export default class GitHubPullRequestRevisionTaskHandler extends GitHubTaskHandlerBase {
  public readonly taskType: string = CodeFixTaskType.GitHubPullRequestRevision;
  public readonly name: string = "GitHub Pull Request Revision Handler";

  /*
   * The branch captured when the person asked, NOT whatever GitHub reports
   * now. A force-push or rename in between must not silently move the run onto
   * different work than the one they approved.
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
    const { context, details, cloneResult, repositoryManager, agent } = data;

    if (!details.pullRequest) {
      return this.createFailureResult(
        "This task has no pull request to revise.",
        { isError: true },
      );
    }

    const headRefName: string | null = details.pullRequest.headRefName;

    /*
     * No pinned branch means the server declined to give this run one — which
     * it does for a fork, whose branch is not in the repository this
     * installation can push to. The webhook handler already refuses those, so
     * reaching here means something changed underneath us; refuse rather than
     * pushing a "revision" onto whatever branch happens to be checked out.
     */
    if (!headRefName) {
      return this.createFailureResult(
        "This pull request has no branch in this repository to push to — it may come from a fork.",
        { isError: true },
      );
    }

    const prompt: string = this.buildPrompt(details);

    await this.log(
      context,
      `Revising pull request #${details.pullRequest.number} on branch ${headRefName}`,
    );

    const agentResult: CodeAgentResult = await this.runCodeAgent({
      agent: agent,
      repositoryPath: cloneResult.repositoryPath,
      prompt: prompt,
    });

    if (agentResult.filesModified.length === 0) {
      await this.log(
        context,
        `Code agent completed without changing any files: ${agentResult.summary}`,
        "warning",
      );

      return this.createNoFixResult(
        agentResult.summary ||
          "I read the pull request and the request and did not find a change worth making.",
      );
    }

    await this.log(
      context,
      `Code agent modified ${agentResult.filesModified.length} file(s)`,
    );

    const verification: VerificationOutcome =
      await BuildVerification.verifyWithRepairs({
        repo: details.repository,
        repositoryPath: cloneResult.repositoryPath,
        agent: agent,
        originalPrompt: prompt,
        log: async (message: string): Promise<void> => {
          await this.log(context, message);
        },
      });

    await repositoryManager.addPaths(cloneResult.repositoryPath, [
      ...agentResult.filesModified,
      ...verification.repairPaths,
    ]);

    await repositoryManager.commitChanges(
      cloneResult.repositoryPath,
      this.buildCommitMessage(details),
    );

    /*
     * A plain push to the same branch. If someone pushed to the pull request
     * between the clone and here, git refuses the non-fast-forward and the run
     * fails honestly — which is the right outcome. Forcing would silently
     * discard their commit.
     */
    await this.log(context, `Pushing revision to ${headRefName}...`);
    await repositoryManager.pushBranch(
      cloneResult.repositoryPath,
      headRefName,
      data.repositoryConfig,
    );

    const verificationNote: string = verification.summary
      ? ` ${verification.summary}`
      : "";

    return {
      success: true,
      message: `Pushed a revision to pull request #${details.pullRequest.number} (${agentResult.filesModified.length} file(s) changed).${verificationNote}`,
      pullRequestsCreated: 0,
      data: {
        revisedPullRequestNumber: details.pullRequest.number,
        filesChanged: agentResult.filesModified.length,
        agentSummary: agentResult.summary,
      },
    };
  }

  private buildPrompt(details: GitHubTaskDetails): string {
    const pullRequest: NonNullable<GitHubTaskDetails["pullRequest"]> =
      details.pullRequest!;

    return `You are a senior software engineer revising an OPEN pull request in this repository, in response to review feedback.

The working copy is already checked out on the pull request's branch (\`${pullRequest.headRefName!}\`), so the changes under review are already applied. You are adding to that work, not redoing it.

## The pull request

**#${pullRequest.number}: ${pullRequest.title}**
Targets \`${pullRequest.baseRefName}\` · ${pullRequest.changedFilesCount} file(s) changed, +${pullRequest.additions} −${pullRequest.deletions}

<pull-request-description>
${pullRequest.body || "_No description._"}
</pull-request-description>

${this.buildDiffSection(details)}
${this.buildConversationSection(details)}
${this.buildRequestSection(details)}
## Task

Make the change that was asked for, on top of the work already in this branch.

1. Read the request and the discussion, and work out precisely what should be different.
2. Find the relevant code — remember it is already modified by this pull request.
3. Make that change, and only that change.
4. Read back what you wrote and check it does what was asked.

${this.buildRepositoryConventionsSection()}
- Do NOT revert or redo the existing work in this branch unless that is explicitly what was asked for. Reviewers have already read these commits.
- Do NOT change the pull request's target branch, title or description; you are only changing code.

Finish with a plain-text summary of what you changed, written for the reviewer who asked.`;
  }

  private buildCommitMessage(details: GitHubTaskDetails): string {
    const instruction: string = (details.instruction || "").trim();

    const subject: string = instruction
      ? this.shortTitle(instruction, 60)
      : "address review feedback";

    return `fix: ${subject}

Revision requested on pull request #${details.pullRequest?.number}${
      details.triggeredByLogin ? ` by @${details.triggeredByLogin}` : ""
    }.

Automatically generated by OneUptime AI Agent.`;
  }

  private shortTitle(title: string, maxLength: number): string {
    const cleaned: string = title.replace(/\s+/g, " ").trim();

    return cleaned.length <= maxLength
      ? cleaned
      : `${cleaned.substring(0, maxLength - 3)}...`;
  }

  public getDescription(): string {
    return "Revises an open pull request in place from review feedback: new commits on the same branch, never a second pull request.";
  }
}
