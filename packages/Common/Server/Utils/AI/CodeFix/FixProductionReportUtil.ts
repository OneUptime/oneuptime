import AIAgentTaskPullRequest from "../../../../Models/DatabaseModels/AIAgentTaskPullRequest";
import FixProductionCheck, {
  FixProductionCheckHelper,
} from "../../../../Types/AI/FixProductionCheck";
import FixProductionReport from "../../../../Types/AI/FixProductionReport";
import FixProductionStatus, {
  FixProductionStatusHelper,
} from "../../../../Types/AI/FixProductionStatus";

/*
 * What production showed about a merged AI fix, read from its pull
 * request's production columns into the report every page shows it with
 * (Types/AI/FixProductionReport): Code's tasks, the AI Logs of incidents
 * and alerts - each from the pull request its task shows, whichever of its
 * turns opened it (CodeTaskListRows).
 */

// The columns a report is read from.
export const FIX_PRODUCTION_REPORT_SELECT: {
  productionStatus: true;
  productionCheck: true;
  productionSummary: true;
  productionStatusAt: true;
  deployedAt: true;
  deployedVersion: true;
  deployedCommitSha: true;
} = {
  productionStatus: true,
  productionCheck: true,
  productionSummary: true,
  productionStatusAt: true,
  deployedAt: true,
  deployedVersion: true,
  deployedCommitSha: true,
};

function toIso(value: Date | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const date: Date = new Date(value);

  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export default class FixProductionReportUtil {
  /*
   * A pull request's report, or undefined when it has no production
   * status (not merged, or not a kind of fix production shows), or one
   * this server does not know.
   */
  public static fromPullRequest(
    pullRequest: AIAgentTaskPullRequest,
  ): FixProductionReport | undefined {
    const status: FixProductionStatus | undefined =
      FixProductionStatusHelper.fromDatabaseValue(pullRequest.productionStatus);
    const check: FixProductionCheck | undefined =
      FixProductionCheckHelper.fromDatabaseValue(pullRequest.productionCheck);

    if (!status || !check) {
      return undefined;
    }

    const report: FixProductionReport = { status, check };

    if (pullRequest.productionSummary) {
      report.summary = pullRequest.productionSummary;
    }

    const statusAt: string | undefined = toIso(pullRequest.productionStatusAt);
    const deployedAt: string | undefined = toIso(pullRequest.deployedAt);

    if (statusAt) {
      report.statusAt = statusAt;
    }

    if (deployedAt) {
      report.deployedAt = deployedAt;
    }

    if (pullRequest.deployedVersion) {
      report.deployedVersion = pullRequest.deployedVersion;
    }

    if (pullRequest.deployedCommitSha) {
      report.deployedCommitSha = pullRequest.deployedCommitSha;
    }

    return report;
  }
}
