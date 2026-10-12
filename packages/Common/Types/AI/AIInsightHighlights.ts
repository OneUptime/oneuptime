/*
 * What is worth knowing first about a project's open AI insights — the
 * findings OneUptime AI's watch on the telemetry filed before anything
 * paged: the response of POST /ai-insight/highlights, which the AI Insights
 * inbox (AI → Insights) leads with, above its filters and its list.
 *
 *   - the finding to look at first: the most severe open one, the most
 *     recently seen first, with what OneUptime AI's triage concluded about
 *     it when it triaged it;
 *   - the service behind the most open findings, when one stands out;
 *   - what is new: the open findings first seen in the last 7 days.
 *
 * Derived from the open AIInsight rows the caller may read — nothing is
 * invented and no model is called. The triage's own words are shown as
 * its, as plain text.
 */

export const AI_INSIGHT_HIGHLIGHTS_PATH: string = "/ai-insight/highlights";

// How many of the newest open findings the highlights read at most.
export const AI_INSIGHT_HIGHLIGHTS_SCAN_LIMIT: number = 500;

// What "new" means: first seen this many days ago at most.
export const AI_INSIGHT_HIGHLIGHTS_NEW_WINDOW_IN_DAYS: number = 7;

/*
 * A service stands out once this many open findings name it, more than any
 * other service, and not every open finding of the project.
 */
export const AI_INSIGHT_HIGHLIGHTS_SERVICE_MIN: number = 2;

// One open finding, as the highlights name it.
export interface AIInsightHighlightFinding {
  id: string;
  title: string;
  // AIInsightType.
  insightType: string;
  // AIInsightSeverity.
  severity: string;
  // The telemetry service it is about, when it names one.
  serviceName?: string | undefined;
  occurrenceCount?: number | undefined;
  // ISO.
  firstSeenAt?: string | undefined;
  lastSeenAt?: string | undefined;
  /*
   * What OneUptime AI's triage concluded, as plain text (the start of its
   * summary, capped), when it triaged the finding.
   */
  triageSummary?: string | undefined;
}

// The service behind the most open findings.
export interface AIInsightHighlightService {
  // The telemetry service's id, when the findings carry it.
  id?: string | undefined;
  name: string;
  count: number;
}

export interface AIInsightHighlights {
  // The open findings the caller may read (Detected, ActionRequired, FixOpened), as read.
  openCount: number;
  // The finding to look at first.
  topFinding?: AIInsightHighlightFinding | undefined;
  // The service behind the most open findings, when one stands out.
  topService?: AIInsightHighlightService | undefined;
  // Open findings first seen in the last 7 days, and the newest of them.
  newCount: number;
  newest?: AIInsightHighlightFinding | undefined;
  /*
   * True when there were more open findings than were read: the counts
   * cover the most recently seen of them.
   */
  isPartial: boolean;
}
