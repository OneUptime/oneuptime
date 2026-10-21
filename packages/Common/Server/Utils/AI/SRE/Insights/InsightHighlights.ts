import AIInsightService from "../../../../Services/AIInsightService";
import QueryHelper from "../../../../Types/Database/QueryHelper";
import InvestigationReportSummary from "../InvestigationReportSummary";
import InsightHighlightsBuilder, {
  InsightHighlightsRow,
} from "./InsightHighlightsBuilder";
import AIInsight from "../../../../../Models/DatabaseModels/AIInsight";
import AIInsightStatus from "../../../../../Types/AI/AIInsightStatus";
import {
  AI_INSIGHT_HIGHLIGHTS_SCAN_LIMIT,
  AIInsightHighlights,
} from "../../../../../Types/AI/AIInsightHighlights";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../../../Types/ObjectID";

/*
 * Reads what the AI Insights inbox leads with and hands it to
 * InsightHighlightsBuilder: the newest open findings, under the caller's own
 * props, so the permission layer decides what they may see — a caller whose
 * grants reach only the services they own hears only about those (AIInsight
 * is OwnedThrough its service). A finding's triage report becomes its
 * Summary as plain text here (InvestigationReportSummary), flattened and
 * capped like a TL;DR.
 */

export const OPEN_INSIGHT_STATUSES: Array<AIInsightStatus> = [
  AIInsightStatus.Detected,
  AIInsightStatus.ActionRequired,
  AIInsightStatus.FixOpened,
];

export default class InsightHighlights {
  public static async read(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    now?: Date | undefined;
  }): Promise<AIInsightHighlights> {
    const insights: Array<AIInsight> = await AIInsightService.findBy({
      query: {
        projectId: data.projectId,
        status: QueryHelper.any(OPEN_INSIGHT_STATUSES),
      },
      select: {
        _id: true,
        title: true,
        insightType: true,
        severity: true,
        serviceName: true,
        telemetryServiceId: true,
        occurrenceCount: true,
        firstSeenAt: true,
        lastSeenAt: true,
        triageSummaryMarkdown: true,
      },
      sort: { lastSeenAt: SortOrder.Descending, _id: SortOrder.Ascending },
      limit: AI_INSIGHT_HIGHLIGHTS_SCAN_LIMIT,
      skip: 0,
      props: data.props,
    });

    const rows: Array<InsightHighlightsRow> = insights
      .filter((insight: AIInsight): boolean => {
        return Boolean(insight.id && insight.title);
      })
      .map((insight: AIInsight): InsightHighlightsRow => {
        const triageSummary: string | null =
          InvestigationReportSummary.fromReport(insight.triageSummaryMarkdown);

        return {
          id: insight.id!.toString(),
          title: insight.title!,
          insightType: insight.insightType || "",
          severity: insight.severity || "",
          serviceName: insight.serviceName || undefined,
          telemetryServiceId: insight.telemetryServiceId?.toString(),
          occurrenceCount:
            typeof insight.occurrenceCount === "number"
              ? insight.occurrenceCount
              : undefined,
          firstSeenAt: insight.firstSeenAt
            ? new Date(insight.firstSeenAt)
            : undefined,
          lastSeenAt: insight.lastSeenAt
            ? new Date(insight.lastSeenAt)
            : undefined,
          ...(triageSummary ? { triageSummary } : {}),
        };
      });

    return InsightHighlightsBuilder.build({
      now: data.now || new Date(),
      rows,
      isPartial: insights.length >= AI_INSIGHT_HIGHLIGHTS_SCAN_LIMIT,
    });
  }
}
