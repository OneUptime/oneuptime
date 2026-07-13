import ObjectID from "../../../../Types/ObjectID";
import PullRequestState from "../../../../Types/CodeRepository/PullRequestState";
import AIAgentTaskPullRequestService from "../../../Services/AIAgentTaskPullRequestService";
import CaptureSpan from "../../Telemetry/CaptureSpan";

/*
 * Per-repository open-PR cap (Preventive-lane X guardrail, G11).
 *
 * A repository may have at most `CodeRepository.maxOpenFixPullRequests`
 * OPEN AI-authored fix pull requests at a time (null/unset = the default
 * below, 0 = no AI fix PRs for this repository). Open-PR counts come from
 * AIAgentTaskPullRequest rows, whose states the AIAgent:SyncPullRequestStates
 * worker keeps current — merging or closing an AI PR frees a slot within
 * its 30-minute sync window.
 *
 * Enforced SERVER-SIDE at the repository-token gate
 * (/ai-agent-data/get-repository-token): the agent worker cannot clone or
 * push without an installation token, so a repo at its cap is physically
 * unable to receive another AI branch or PR — no token, no push. The
 * worker surfaces the rejection message as the run's failure guidance.
 */

// Open AI fix PRs allowed per repository when no explicit cap is set.
export const DEFAULT_MAX_OPEN_FIX_PULL_REQUESTS: number = 5;

export interface OpenPullRequestCapDecision {
  allowed: boolean;
  // The effective cap after defaulting (<= 0 means AI fix PRs are blocked).
  limit: number;
  // True when the configured cap blocks AI fix PRs outright (0 or less).
  paused: boolean;
  openCount: number;
}

export default class OpenPullRequestCap {
  /*
   * The pure cap decision, separated from IO so it can be tested directly.
   * At/over the cap rejects: `openCount >= limit` means the repository
   * already carries a full review queue of unreviewed AI PRs.
   */
  public static evaluate(data: {
    configuredLimit: number | null | undefined;
    openCount: number;
  }): OpenPullRequestCapDecision {
    const limit: number =
      data.configuredLimit === null || data.configuredLimit === undefined
        ? DEFAULT_MAX_OPEN_FIX_PULL_REQUESTS
        : data.configuredLimit;

    if (limit <= 0) {
      return {
        allowed: false,
        limit,
        paused: true,
        openCount: data.openCount,
      };
    }

    return {
      allowed: data.openCount < limit,
      limit,
      paused: false,
      openCount: data.openCount,
    };
  }

  /*
   * Count the repository's Open AI fix PRs and decide against its cap.
   * The count is by codeRepositoryId (states maintained by the
   * SyncPullRequestStates worker).
   */
  @CaptureSpan()
  public static async checkForRepository(data: {
    codeRepositoryId: ObjectID;
    configuredLimit: number | null | undefined;
  }): Promise<OpenPullRequestCapDecision> {
    // A blocked repo (cap 0) never needs the count query.
    const pausedCheck: OpenPullRequestCapDecision = this.evaluate({
      configuredLimit: data.configuredLimit,
      openCount: 0,
    });

    if (pausedCheck.paused) {
      return pausedCheck;
    }

    const openCount: number = (
      await AIAgentTaskPullRequestService.countBy({
        query: {
          codeRepositoryId: data.codeRepositoryId,
          pullRequestState: PullRequestState.Open,
        },
        props: { isRoot: true },
      })
    ).toNumber();

    return this.evaluate({
      configuredLimit: data.configuredLimit,
      openCount,
    });
  }

  /*
   * Human-readable rejection naming the cap and the setting that controls
   * it — the agent worker records this as the run's failure guidance.
   */
  public static describeRejection(data: {
    decision: OpenPullRequestCapDecision;
    repositoryName: string;
  }): string {
    if (data.decision.paused) {
      return `AI fix pull requests are blocked for repository ${data.repositoryName} — its "Max Open Fix Pull Requests" setting is 0. Raise or unset the setting on the repository's Settings page to allow AI fix pull requests again.`;
    }

    return `Repository ${data.repositoryName} is at its open AI fix pull request cap (${data.decision.openCount} open of a maximum ${data.decision.limit}). Review and merge or close the open AI pull requests to free a slot, or raise the "Max Open Fix Pull Requests" setting on the repository's Settings page (unset means the default of ${DEFAULT_MAX_OPEN_FIX_PULL_REQUESTS}).`;
  }
}
