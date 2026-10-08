import AIInsightSeverity from "../../../../../Types/AI/AIInsightSeverity";
import {
  AI_INSIGHT_HIGHLIGHTS_NEW_WINDOW_IN_DAYS,
  AI_INSIGHT_HIGHLIGHTS_SERVICE_MIN,
  AIInsightHighlightFinding,
  AIInsightHighlightService,
  AIInsightHighlights,
} from "../../../../../Types/AI/AIInsightHighlights";

/*
 * The pure half of what the AI Insights inbox leads with
 * (AIInsightHighlights): from the open findings the caller may read
 * (InsightHighlights reads them), the one to look at first, the service
 * behind the most of them, and what is new this week. No I/O, no clock of
 * its own, no model: the same rows always give the same highlights.
 */

// One open finding as build() takes it.
export interface InsightHighlightsRow {
  id: string;
  title: string;
  insightType: string;
  severity: string;
  serviceName?: string | undefined;
  telemetryServiceId?: string | undefined;
  occurrenceCount?: number | undefined;
  firstSeenAt?: Date | undefined;
  lastSeenAt?: Date | undefined;
  // What triage concluded, already plain text (InvestigationReportSummary).
  triageSummary?: string | undefined;
}

const DAY_IN_MS: number = 24 * 60 * 60 * 1000;

// High before Medium before Low; a severity a newer server added, last.
function getSeverityRank(severity: string): number {
  switch (severity) {
    case AIInsightSeverity.High:
      return 0;
    case AIInsightSeverity.Medium:
      return 1;
    case AIInsightSeverity.Low:
      return 2;
    default:
      return 3;
  }
}

function getTime(date: Date | undefined): number {
  return date ? date.getTime() : 0;
}

export default class InsightHighlightsBuilder {
  // A finding as the highlights name it.
  public static toFinding(row: InsightHighlightsRow): AIInsightHighlightFinding {
    const triageSummary: string = (row.triageSummary || "").trim();

    return {
      id: row.id,
      title: row.title,
      insightType: row.insightType,
      severity: row.severity,
      ...(row.serviceName ? { serviceName: row.serviceName } : {}),
      ...(typeof row.occurrenceCount === "number"
        ? { occurrenceCount: row.occurrenceCount }
        : {}),
      ...(row.firstSeenAt ? { firstSeenAt: row.firstSeenAt.toISOString() } : {}),
      ...(row.lastSeenAt ? { lastSeenAt: row.lastSeenAt.toISOString() } : {}),
      ...(triageSummary ? { triageSummary } : {}),
    };
  }

  /*
   * The finding to look at first: the most severe, then the most recently
   * seen, then the one seen most often.
   */
  public static getTopFinding(
    rows: Array<InsightHighlightsRow>,
  ): InsightHighlightsRow | undefined {
    return [...rows].sort(
      (a: InsightHighlightsRow, b: InsightHighlightsRow): number => {
        return (
          getSeverityRank(a.severity) - getSeverityRank(b.severity) ||
          getTime(b.lastSeenAt) - getTime(a.lastSeenAt) ||
          (b.occurrenceCount || 0) - (a.occurrenceCount || 0) ||
          a.id.localeCompare(b.id)
        );
      },
    )[0];
  }

  /*
   * The service behind the most open findings — at least
   * AI_INSIGHT_HIGHLIGHTS_SERVICE_MIN of them, more than any other service,
   * and not every open finding there is (that would only say the project
   * has one service).
   */
  public static getTopService(
    rows: Array<InsightHighlightsRow>,
  ): AIInsightHighlightService | undefined {
    const services: Map<string, AIInsightHighlightService> = new Map<
      string,
      AIInsightHighlightService
    >();

    for (const row of rows) {
      const name: string = (row.serviceName || "").trim();

      if (!name) {
        continue;
      }

      const key: string = row.telemetryServiceId || `name:${name.toLowerCase()}`;
      const service: AIInsightHighlightService = services.get(key) || {
        ...(row.telemetryServiceId ? { id: row.telemetryServiceId } : {}),
        name,
        count: 0,
      };

      service.count++;
      services.set(key, service);
    }

    const ranked: Array<AIInsightHighlightService> = Array.from(
      services.values(),
    ).sort(
      (a: AIInsightHighlightService, b: AIInsightHighlightService): number => {
        return b.count - a.count || a.name.localeCompare(b.name);
      },
    );

    const top: AIInsightHighlightService | undefined = ranked[0];
    const second: AIInsightHighlightService | undefined = ranked[1];

    if (
      !top ||
      top.count < AI_INSIGHT_HIGHLIGHTS_SERVICE_MIN ||
      (second && second.count >= top.count) ||
      top.count >= rows.length
    ) {
      return undefined;
    }

    return top;
  }

  public static build(data: {
    now: Date;
    // The open findings, as read.
    rows: Array<InsightHighlightsRow>;
    isPartial: boolean;
  }): AIInsightHighlights {
    const newSince: number =
      data.now.getTime() - AI_INSIGHT_HIGHLIGHTS_NEW_WINDOW_IN_DAYS * DAY_IN_MS;

    const newRows: Array<InsightHighlightsRow> = data.rows
      .filter((row: InsightHighlightsRow): boolean => {
        return getTime(row.firstSeenAt) >= newSince;
      })
      .sort((a: InsightHighlightsRow, b: InsightHighlightsRow): number => {
        return (
          getTime(b.firstSeenAt) - getTime(a.firstSeenAt) ||
          a.id.localeCompare(b.id)
        );
      });

    const top: InsightHighlightsRow | undefined = this.getTopFinding(data.rows);
    const topService: AIInsightHighlightService | undefined =
      this.getTopService(data.rows);
    // The newest is said only when it is not the finding already named first.
    const newest: InsightHighlightsRow | undefined = newRows.find(
      (row: InsightHighlightsRow): boolean => {
        return row.id !== top?.id;
      },
    );

    return {
      openCount: data.rows.length,
      ...(top ? { topFinding: this.toFinding(top) } : {}),
      ...(topService ? { topService } : {}),
      newCount: newRows.length,
      ...(newest ? { newest: this.toFinding(newest) } : {}),
      isPartial: data.isPartial,
    };
  }
}
