import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/AIAgentTaskPullRequest";
import BadDataException from "../../Types/Exception/BadDataException";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PullRequestState from "../../Types/CodeRepository/PullRequestState";
import FixPullRequestCiStatus from "../../Types/AI/FixPullRequestCiStatus";
import PositiveNumber from "../../Types/PositiveNumber";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export interface AIFixOutcomeStats {
  total: number;
  open: number;
  merged: number;
  closedUnmerged: number;
  /*
   * merged / (merged + closedUnmerged), in whole percent. Null until at
   * least one PR reached a terminal state — a rate over zero outcomes is
   * noise, not signal.
   */
  acceptanceRatePercent: number | null;
  /*
   * Merged PRs whose last recorded ciStatus was Green or (for should-fail
   * regression-test PRs) ExpectedFailureObserved — merged is good,
   * merged-and-CI-green is better. Per gate G9, ONLY those two conclusions
   * count: a merged PR with no CI (NoCiConfigured), a never-polled null,
   * Pending or Red is NOT verified and drags the rate down honestly.
   */
  verifiedGreen: number;
  /*
   * verifiedGreen / merged, in whole percent. Null until at least one PR
   * merged — same honesty rule as acceptanceRatePercent.
   */
  verifiedGreenRatePercent: number | null;
}

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * Outcome counts for the project's AI-authored fix PRs — the G11
   * precision baseline (states kept current by AIAgent:SyncPullRequestStates).
   * Queries run with the caller's props so tenant scoping and read
   * permissions come from the model ACLs.
   */
  @CaptureSpan()
  public async getOutcomeStats(
    props: DatabaseCommonInteractionProps,
  ): Promise<AIFixOutcomeStats> {
    if (!props.tenantId) {
      throw new BadDataException("Project ID is required");
    }

    const countForState: (
      state: PullRequestState,
    ) => Promise<PositiveNumber> = (
      state: PullRequestState,
    ): Promise<PositiveNumber> => {
      return this.countBy({
        query: {
          projectId: props.tenantId!,
          pullRequestState: state,
        },
        props,
      });
    };

    /*
     * CI-verified merged PRs (B4 Tier 1). Only Green and
     * ExpectedFailureObserved count as verified — never NoCiConfigured,
     * null, Pending or Red (G9: absence of CI reads as unverified).
     */
    const countMergedWithCiStatus: (
      ciStatus: FixPullRequestCiStatus,
    ) => Promise<PositiveNumber> = (
      ciStatus: FixPullRequestCiStatus,
    ): Promise<PositiveNumber> => {
      return this.countBy({
        query: {
          projectId: props.tenantId!,
          pullRequestState: PullRequestState.Merged,
          ciStatus: ciStatus,
        },
        props,
      });
    };

    const [open, merged, closedUnmerged, mergedCiGreen, mergedCiExpectedFail]: [
      PositiveNumber,
      PositiveNumber,
      PositiveNumber,
      PositiveNumber,
      PositiveNumber,
    ] = await Promise.all([
      countForState(PullRequestState.Open),
      countForState(PullRequestState.Merged),
      countForState(PullRequestState.Closed),
      countMergedWithCiStatus(FixPullRequestCiStatus.Green),
      countMergedWithCiStatus(FixPullRequestCiStatus.ExpectedFailureObserved),
    ]);

    const mergedCount: number = merged.toNumber();
    const closedCount: number = closedUnmerged.toNumber();
    const terminalCount: number = mergedCount + closedCount;
    const verifiedGreenCount: number =
      mergedCiGreen.toNumber() + mergedCiExpectedFail.toNumber();

    return {
      total: open.toNumber() + terminalCount,
      open: open.toNumber(),
      merged: mergedCount,
      closedUnmerged: closedCount,
      acceptanceRatePercent:
        terminalCount === 0
          ? null
          : Math.round((mergedCount / terminalCount) * 100),
      verifiedGreen: verifiedGreenCount,
      verifiedGreenRatePercent:
        mergedCount === 0
          ? null
          : Math.round((verifiedGreenCount / mergedCount) * 100),
    };
  }
}

export default new Service();
