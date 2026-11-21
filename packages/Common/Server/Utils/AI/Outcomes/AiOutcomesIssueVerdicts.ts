import DataSecurityIssueService from "../../../Services/DataSecurityIssueService";
import DataStoreService from "../../../Services/DataStoreService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import AiOutcomesBuilder, {
  AiOutcomesIssueVerdictRow,
} from "./AiOutcomesBuilder";
import DataSecurityIssue from "../../../../Models/DatabaseModels/DataSecurityIssue";
import DataStore from "../../../../Models/DatabaseModels/DataStore";
import {
  AI_OUTCOMES_RECORDS_PAGE_SIZE,
  AI_OUTCOMES_SCAN_LIMIT,
  AiOutcomesIssueVerdictOutcome,
  AiOutcomesPart,
  AiOutcomesRecord,
  AiOutcomesRecords,
} from "../../../../Types/AI/AiOutcomes";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Includes from "../../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import DataSecurityIssueStatus from "../../../../Types/DataSecurity/DataSecurityIssueStatus";
import { DataSecurityAiVerdict } from "../../../../Types/DataSecurity/DataSecurityIssueAnalysis";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../../Types/Exception/PaymentRequiredException";
import ObjectID from "../../../../Types/ObjectID";

/*
 * AI RESULTS FOR DATA SECURITY: ONEUPTIME AI'S VERDICTS ON ISSUES (#10369).
 *
 * The analysis gives every issue it reads a verdict - Real, Likely by
 * design, Likely a wrong finding, Cannot tell - and people decide what
 * becomes of the issue. This reads the issues it analyzed in the window,
 * newest first, for the AI Results page to count how often what people
 * decided agreed with its verdict (AiOutcomesBuilder.getIssueVerdictOutcome),
 * week by week - and, for each number, the issues it counts.
 *
 * Read with the caller's own props: a caller who may not read Data
 * Security issues gets no verdict numbers (null), not zeros, and the
 * issues a number opens are only the ones they may read. Whether a store
 * is marked public by design - how a by-design verdict is agreed with - is
 * read as OneUptime: a flag that is counted, never shown. Only dates,
 * verdicts, statuses and the issues' titles leave.
 *
 * Bounded as every part of the page is: the window's newest
 * AI_OUTCOMES_SCAN_LIMIT analyzed issues.
 */

export interface AiOutcomesIssueVerdictReadRow
  extends AiOutcomesIssueVerdictRow {
  id: string;
  title: string;
}

export interface AiOutcomesIssueVerdictRows {
  rows: Array<AiOutcomesIssueVerdictReadRow>;
  // The scan limit was reached: the newest were counted.
  isPartial: boolean;
}

function isRefusal(error: unknown): boolean {
  return (
    error instanceof NotAuthorizedException ||
    error instanceof PaymentRequiredException
  );
}

export default class AiOutcomesIssueVerdicts {
  /*
   * The issues OneUptime AI analyzed in the window ending at `now`, as the
   * caller may read them; null when they may read no Data Security issue.
   */
  public static async readRows(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    now: Date;
  }): Promise<AiOutcomesIssueVerdictRows | null> {
    let issues: Array<DataSecurityIssue>;

    try {
      issues = await DataSecurityIssueService.findBy({
        query: {
          projectId: data.projectId,
          aiAnalyzedAt: QueryHelper.inBetween(
            AiOutcomesBuilder.getWindowStart(data.now),
            data.now,
          ),
        },
        select: {
          _id: true,
          title: true,
          aiVerdict: true,
          aiAnalyzedAt: true,
          status: true,
          dataStoreId: true,
        },
        sort: { aiAnalyzedAt: SortOrder.Descending },
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

    // Only a by-design verdict on a resolved issue asks how it was resolved.
    const storeIds: Array<string> = [];

    for (const issue of issues) {
      const storeId: string = issue.dataStoreId?.toString() || "";

      if (
        storeId &&
        issue.aiVerdict === DataSecurityAiVerdict.LikelyByDesign &&
        issue.status === DataSecurityIssueStatus.Resolved &&
        !storeIds.includes(storeId)
      ) {
        storeIds.push(storeId);
      }
    }

    const publicByDesign: Set<string> = new Set();

    if (storeIds.length > 0) {
      const stores: Array<DataStore> = await DataStoreService.findBy({
        query: {
          projectId: data.projectId,
          _id: new Includes(
            storeIds.map((id: string): ObjectID => {
              return new ObjectID(id);
            }),
          ),
          isPublicByDesign: true,
        },
        select: { _id: true },
        skip: 0,
        limit: storeIds.length,
        props: { isRoot: true },
      });

      for (const store of stores) {
        publicByDesign.add((store.id || store._id)?.toString() || "");
      }
    }

    return {
      rows: issues
        .filter((issue: DataSecurityIssue): boolean => {
          return Boolean(issue.id && issue.aiAnalyzedAt);
        })
        .map((issue: DataSecurityIssue): AiOutcomesIssueVerdictReadRow => {
          return {
            id: issue.id!.toString(),
            title: issue.title || "",
            createdAt: new Date(issue.aiAnalyzedAt!),
            verdict: issue.aiVerdict,
            status: issue.status,
            isStorePublicByDesign: publicByDesign.has(
              issue.dataStoreId?.toString() || "",
            ),
          };
        }),
      isPartial: issues.length >= AI_OUTCOMES_SCAN_LIMIT,
    };
  }

  /*
   * The issues one verdict number counts (#7768): the rows counted under
   * its outcome, newest first, a page at a time. `total` is the number.
   */
  public static async readRecords(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    outcome: AiOutcomesIssueVerdictOutcome;
    windowEnd: Date;
    skip?: number | undefined;
    pageSize?: number | undefined;
  }): Promise<AiOutcomesRecords> {
    const read: AiOutcomesIssueVerdictRows | null = await this.readRows({
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
    const matching: Array<AiOutcomesIssueVerdictReadRow> = read.rows
      .filter((row: AiOutcomesIssueVerdictReadRow): boolean => {
        return (
          AiOutcomesBuilder.getIssueVerdictOutcome(row) === data.outcome &&
          AiOutcomesBuilder.isInWindow(data.windowEnd, row.createdAt)
        );
      })
      .sort(
        (
          a: AiOutcomesIssueVerdictReadRow,
          b: AiOutcomesIssueVerdictReadRow,
        ): number => {
          return (
            b.createdAt.getTime() - a.createdAt.getTime() ||
            a.id.localeCompare(b.id)
          );
        },
      );
    const page: Array<AiOutcomesIssueVerdictReadRow> = matching.slice(
      skip,
      skip + pageSize,
    );

    return {
      part: AiOutcomesPart.IssueVerdicts,
      outcome: data.outcome,
      total: matching.length,
      records: page.map(
        (row: AiOutcomesIssueVerdictReadRow): AiOutcomesRecord => {
          return {
            id: row.id,
            at: row.createdAt.toISOString(),
            subject: {
              kind: "dataSecurityIssue",
              id: row.id,
              ...(row.title ? { title: row.title } : {}),
            },
            ...(row.verdict ? { issueVerdict: row.verdict } : {}),
            ...(row.status ? { issueStatus: row.status } : {}),
          };
        },
      ),
      nextSkip:
        skip + page.length < matching.length ? skip + page.length : null,
    };
  }
}
