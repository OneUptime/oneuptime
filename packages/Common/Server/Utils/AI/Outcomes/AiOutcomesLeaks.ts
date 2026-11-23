import AIRunService from "../../../Services/AIRunService";
import CodeRepositoryService from "../../../Services/CodeRepositoryService";
import DataSecurityIssueService from "../../../Services/DataSecurityIssueService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import AiOutcomesBuilder, { AiOutcomesLeakRow } from "./AiOutcomesBuilder";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import DataSecurityIssue from "../../../../Models/DatabaseModels/DataSecurityIssue";
import AIRunType from "../../../../Types/AI/AIRunType";
import {
  AI_OUTCOMES_RECORDS_PAGE_SIZE,
  AI_OUTCOMES_SCAN_LIMIT,
  AiOutcomesLeaks as AiOutcomesLeakCounts,
  AiOutcomesPart,
  AiOutcomesRecord,
  AiOutcomesRecords,
} from "../../../../Types/AI/AiOutcomes";
import CodeFixTaskType from "../../../../Types/AI/CodeFixTaskType";
import {
  getProductionReviewTaskContext,
  getReviewedPullRequest,
  ProductionReviewTaskContext,
  ReviewedPullRequest,
} from "../../../../Types/AI/CodeFixTaskContext";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import {
  PRODUCTION_REVIEW_LEAK_CHECK_IDS,
  ProductionReviewCaughtLeak,
} from "../../../../Types/CodeRepository/ProductionReviewSensitiveData";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../../Types/Exception/PaymentRequiredException";
import ObjectID from "../../../../Types/ObjectID";

/*
 * AI RESULTS: LEAKS CAUGHT BEFORE THEY MERGED, AGAINST THOSE FOUND AFTER
 * (#10376).
 *
 * A pull request's production review remembers each leak it posted, once,
 * on the pull request's review task (ProductionReviewTaskContext
 * .caughtLeaks), with when a later review no longer found it. This reads
 * them for the window - the leaks caught, by the week each was first
 * posted - beside the issues Data Security's scans opened in the window on
 * the checks those leaks are the early form of
 * (PRODUCTION_REVIEW_LEAK_CHECK_IDS): what the page compares.
 *
 * Who sees it: a caller who may read the project's code repositories,
 * whose reviews these are, and Data Security's issues, as they may read
 * them - both, since a comparison of one with nothing is none. Anyone else
 * gets null, not zeros. The reviews are read as OneUptime (an AI run is
 * private to its author in the run table); only dates, check ids and each
 * pull request's number, title and address leave, for the records a
 * number opens. Bounded as every part of the page is: the window's newest
 * AI_OUTCOMES_SCAN_LIMIT reviews, and issues.
 */

// One leak caught in a pull request, with the review it was caught in.
export interface AiOutcomesCaughtLeakRow extends AiOutcomesLeakRow {
  runId: string;
  key: string;
  checkId: string;
  pullRequestNumber?: number | undefined;
  pullRequestTitle?: string | undefined;
  pullRequestUrl?: string | undefined;
}

// One issue a scan opened on a check a pull request's rules catch early.
export interface AiOutcomesFoundLeakRow extends AiOutcomesLeakRow {
  issueId: string;
  title: string;
  checkId: string;
}

export interface AiOutcomesLeakRows {
  caught: Array<AiOutcomesCaughtLeakRow>;
  found: Array<AiOutcomesFoundLeakRow>;
  // The scan limit was reached: the newest were counted.
  isPartial: boolean;
}

function isRefusal(error: unknown): boolean {
  return (
    error instanceof NotAuthorizedException ||
    error instanceof PaymentRequiredException
  );
}

const WEB_ADDRESS: RegExp = /^https?:\/\//i;

export default class AiOutcomesLeaks {
  /*
   * The leaks of the window ending at `now`, caught and found; null when
   * the caller may read the code repositories' reviews or Data Security's
   * issues not.
   */
  public static async readRows(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    now: Date;
  }): Promise<AiOutcomesLeakRows | null> {
    const windowStart: Date = AiOutcomesBuilder.getWindowStart(data.now);
    let issues: Array<DataSecurityIssue>;

    try {
      await CodeRepositoryService.findBy({
        query: { projectId: data.projectId },
        select: { _id: true },
        skip: 0,
        limit: 1,
        props: data.props,
      });

      issues = await DataSecurityIssueService.findBy({
        query: {
          projectId: data.projectId,
          checkId: QueryHelper.any([...PRODUCTION_REVIEW_LEAK_CHECK_IDS]),
          firstDetectedAt: QueryHelper.inBetween(windowStart, data.now),
        },
        select: {
          _id: true,
          title: true,
          checkId: true,
          firstDetectedAt: true,
        },
        sort: { firstDetectedAt: SortOrder.Descending },
        skip: 0,
        limit: AI_OUTCOMES_SCAN_LIMIT,
        props: data.props,
      });
    } catch (error) {
      if (isRefusal(error)) {
        return null;
      }

      throw error;
    }

    // A review that caught something in the window was updated in it.
    const runs: Array<AIRun> = await AIRunService.findBy({
      query: {
        projectId: data.projectId,
        runType: AIRunType.CodeFix,
        codeFixTaskType: CodeFixTaskType.GitHubPullRequestProductionReview,
        updatedAt: QueryHelper.inBetween(windowStart, data.now),
      },
      select: {
        _id: true,
        title: true,
        taskContext: true,
      },
      sort: { updatedAt: SortOrder.Descending },
      skip: 0,
      limit: AI_OUTCOMES_SCAN_LIMIT,
      props: { isRoot: true },
    });

    const caught: Array<AiOutcomesCaughtLeakRow> = [];

    for (const run of runs) {
      const review: ProductionReviewTaskContext | null =
        getProductionReviewTaskContext(run.taskContext);
      const reviewed: ReviewedPullRequest | null = getReviewedPullRequest(
        run.taskContext,
      );

      if (!review || !run.id) {
        continue;
      }

      for (const leak of AiOutcomesLeaks.readCaughtLeaks(review)) {
        const at: Date = new Date(leak.at);

        if (
          Number.isNaN(at.getTime()) ||
          at.getTime() < windowStart.getTime() ||
          at.getTime() > data.now.getTime()
        ) {
          continue;
        }

        const fixedAt: Date | null = leak.fixedAt
          ? new Date(leak.fixedAt)
          : null;

        caught.push({
          runId: run.id.toString(),
          key: leak.key,
          checkId: leak.checkId,
          createdAt: at,
          isCaught: true,
          ...(fixedAt &&
          !Number.isNaN(fixedAt.getTime()) &&
          fixedAt.getTime() <= data.now.getTime()
            ? { fixedAt }
            : {}),
          ...(reviewed ? { pullRequestNumber: reviewed.number } : {}),
          ...(run.title ? { pullRequestTitle: run.title } : {}),
          ...(reviewed?.url && WEB_ADDRESS.test(reviewed.url)
            ? { pullRequestUrl: reviewed.url }
            : {}),
        });
      }
    }

    return {
      caught,
      found: issues
        .filter((issue: DataSecurityIssue): boolean => {
          return Boolean(issue.id && issue.firstDetectedAt);
        })
        .map((issue: DataSecurityIssue): AiOutcomesFoundLeakRow => {
          return {
            issueId: issue.id!.toString(),
            title: issue.title || "",
            checkId: issue.checkId || "",
            createdAt: new Date(issue.firstDetectedAt!),
            isCaught: false,
          };
        }),
      isPartial:
        runs.length >= AI_OUTCOMES_SCAN_LIMIT ||
        issues.length >= AI_OUTCOMES_SCAN_LIMIT,
    };
  }

  // A review's caught leaks, each one whole.
  private static readCaughtLeaks(
    review: ProductionReviewTaskContext,
  ): Array<ProductionReviewCaughtLeak> {
    return (Array.isArray(review.caughtLeaks) ? review.caughtLeaks : []).filter(
      (leak: ProductionReviewCaughtLeak): boolean => {
        return Boolean(
          leak &&
            typeof leak.key === "string" &&
            typeof leak.at === "string" &&
            typeof leak.checkId === "string",
        );
      },
    );
  }

  /*
   * The records one leak number counts (#7768): the rows counted under its
   * outcome, newest first, a page at a time. `total` is the number.
   */
  public static async readRecords(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    outcome: keyof AiOutcomesLeakCounts;
    windowEnd: Date;
    skip?: number | undefined;
    pageSize?: number | undefined;
  }): Promise<AiOutcomesRecords> {
    const read: AiOutcomesLeakRows | null = await this.readRows({
      projectId: data.projectId,
      props: data.props,
      now: data.windowEnd,
    });

    if (!read) {
      throw new NotAuthorizedException(
        "Your role cannot read what this number counts. A Project Admin can give you access.",
      );
    }

    const skip: number = Math.max(0, Math.floor(data.skip || 0));
    const pageSize: number = Math.max(
      1,
      Math.floor(data.pageSize || AI_OUTCOMES_RECORDS_PAGE_SIZE),
    );
    const rows: Array<AiOutcomesCaughtLeakRow | AiOutcomesFoundLeakRow> = [
      ...read.caught,
      ...read.found,
    ]
      .filter(
        (row: AiOutcomesCaughtLeakRow | AiOutcomesFoundLeakRow): boolean => {
          return AiOutcomesBuilder.getLeakOutcome(row) === data.outcome;
        },
      )
      .sort(
        (
          a: AiOutcomesCaughtLeakRow | AiOutcomesFoundLeakRow,
          b: AiOutcomesCaughtLeakRow | AiOutcomesFoundLeakRow,
        ): number => {
          return b.createdAt.getTime() - a.createdAt.getTime();
        },
      );
    const page: Array<AiOutcomesCaughtLeakRow | AiOutcomesFoundLeakRow> =
      rows.slice(skip, skip + pageSize);

    return {
      part: AiOutcomesPart.Leaks,
      outcome: data.outcome,
      total: rows.length,
      records: page.map(
        (
          row: AiOutcomesCaughtLeakRow | AiOutcomesFoundLeakRow,
        ): AiOutcomesRecord => {
          if ("issueId" in row) {
            return {
              id: row.issueId,
              at: row.createdAt.toISOString(),
              dataSecurityIssue: {
                id: row.issueId,
                ...(row.title ? { title: row.title } : {}),
              },
              ...(row.checkId ? { checkId: row.checkId } : {}),
            };
          }

          return {
            id: `${row.runId}:${row.key}`,
            at: row.createdAt.toISOString(),
            checkId: row.checkId,
            ...(row.pullRequestNumber !== undefined
              ? { pullRequestNumber: row.pullRequestNumber }
              : {}),
            ...(row.pullRequestTitle
              ? { pullRequestTitle: row.pullRequestTitle }
              : {}),
            ...(row.pullRequestUrl
              ? { pullRequestUrl: row.pullRequestUrl }
              : {}),
          };
        },
      ),
      nextSkip: skip + page.length < rows.length ? skip + page.length : null,
    };
  }
}
