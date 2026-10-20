import AIAgentTaskPullRequest from "../../../../Models/DatabaseModels/AIAgentTaskPullRequest";
import FixProductionCheck, {
  FixProductionCheckHelper,
} from "../../../../Types/AI/FixProductionCheck";
import FixProductionReport from "../../../../Types/AI/FixProductionReport";
import FixProductionStatus, {
  FixProductionStatusHelper,
} from "../../../../Types/AI/FixProductionStatus";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../../Types/ObjectID";
import AIAgentTaskPullRequestService from "../../../Services/AIAgentTaskPullRequestService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import logger from "../../Logger";

/*
 * What production showed about a merged AI fix, read from its pull
 * request's production columns into the report every page shows it with
 * (Types/AI/FixProductionReport): Code's tasks, the AI Logs of incidents
 * and alerts.
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

  /*
   * Each run's report, by run id: the pull request whose status changed
   * last, when a run opened more than one. Read as root - callers have
   * decided who may see the runs - and never fatal: a failed read leaves
   * the reports out, and the runs are shown without them.
   */
  public static async readForRuns(data: {
    projectId: ObjectID;
    runIds: Array<ObjectID>;
  }): Promise<Map<string, FixProductionReport>> {
    const byRunId: Map<string, FixProductionReport> = new Map<
      string,
      FixProductionReport
    >();

    if (data.runIds.length === 0) {
      return byRunId;
    }

    try {
      const pullRequests: Array<AIAgentTaskPullRequest> =
        await AIAgentTaskPullRequestService.findBy({
          query: {
            projectId: data.projectId,
            aiRunId: QueryHelper.any(data.runIds),
            productionStatus: QueryHelper.notNull(),
          } as never,
          select: {
            _id: true,
            aiRunId: true,
            ...FIX_PRODUCTION_REPORT_SELECT,
          },
          sort: { productionStatusAt: SortOrder.Descending } as never,
          limit: data.runIds.length * 5,
          skip: 0,
          props: { isRoot: true },
        });

      for (const pullRequest of pullRequests) {
        const runId: string = pullRequest.aiRunId?.toString() || "";
        const report: FixProductionReport | undefined =
          FixProductionReportUtil.fromPullRequest(pullRequest);

        if (runId && report && !byRunId.has(runId)) {
          byRunId.set(runId, report);
        }
      }
    } catch (error) {
      logger.error(
        `Could not read the production verdicts of AI fix pull requests: ${error}`,
      );
    }

    return byRunId;
  }
}
