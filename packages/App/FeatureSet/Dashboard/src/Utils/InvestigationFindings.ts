import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import { LogVolumeSummary, TopErrorPatternRow } from "./LogsInsights";

/*
 * The deterministic "explain this spike" engine: correlates the evidence
 * the investigation drawer already fetched — the window's log signal,
 * top error patterns, and the event markers (deploys, incidents,
 * alerts) — into ranked, human findings. No model calls, no heuristics
 * that cannot be pointed at: every finding names its evidence. Pure so
 * App/Tests can pin each rule.
 */

export type InvestigationMarkerKind = "incident" | "alert" | "change";

export interface InvestigationMarker {
  kind: InvestigationMarkerKind;
  label: string;
  timeMs: number;
}

export interface InvestigationEvidence {
  windowStartMs: number;
  windowEndMs: number;
  /** "host.name = web-01" style chips describing the scope. */
  scopeChips: Array<string>;
  logVolume: LogVolumeSummary | null;
  errorPatterns: Array<TopErrorPatternRow>;
  /** Raw histogram buckets ({time, severity, count}) for trend math. */
  logBuckets: Array<JSONObject>;
  markers: Array<InvestigationMarker>;
}

export type InvestigationFindingSeverity = "info" | "warning" | "critical";

export interface InvestigationFinding {
  severity: InvestigationFindingSeverity;
  text: string;
}

// Log severities that count as errors (matches the server's default set).
const ERROR_SEVERITIES: Set<string> = new Set<string>(["Error", "Fatal"]);

/*
 * Trend thresholds: below these the halves comparison is noise, not a
 * finding.
 */
const MIN_ERRORS_FOR_TREND: number = 10;
const TREND_RATIO_THRESHOLD: number = 1.5;

// A single pattern "dominates" when it carries at least this error share.
const DOMINANT_PATTERN_SHARE: number = 0.5;

// Error rates at or above this are called out on their own.
const HIGH_ERROR_RATE_PERCENT: number = 5;

export interface ErrorHalves {
  firstHalf: number;
  secondHalf: number;
}

/**
 * Error-severity counts for the two halves of the window, split by
 * bucket timestamp (not index — buckets can be sparse).
 */
export function computeErrorHalves(
  buckets: Array<JSONObject>,
  windowStartMs: number,
  windowEndMs: number,
): ErrorHalves {
  const midpointMs: number = windowStartMs + (windowEndMs - windowStartMs) / 2;
  const halves: ErrorHalves = { firstHalf: 0, secondHalf: 0 };

  for (const bucket of buckets || []) {
    if (!ERROR_SEVERITIES.has(String(bucket["severity"] || ""))) {
      continue;
    }
    const count: number =
      typeof bucket["count"] === "number" ? (bucket["count"] as number) : 0;
    const timeMs: number = new Date(String(bucket["time"] || "")).getTime();
    if (Number.isNaN(timeMs)) {
      continue;
    }
    if (timeMs < midpointMs) {
      halves.firstHalf += count;
    } else {
      halves.secondHalf += count;
    }
  }

  return halves;
}

function formatMinutesBefore(eventMs: number, windowEndMs: number): string {
  const minutes: number = Math.max(
    0,
    Math.round((windowEndMs - eventMs) / 60000),
  );
  if (minutes === 0) {
    return "moments before the end of this window";
  }
  return `${minutes} minute${minutes === 1 ? "" : "s"} before the end of this window`;
}

/**
 * The ranked findings. Change events lead (deploys are the most common
 * root cause), then error-signal shifts, then concurrent incidents —
 * ending with honest guidance when nothing stands out.
 */
export function buildInvestigationFindings(
  evidence: InvestigationEvidence,
): Array<InvestigationFinding> {
  const findings: Array<InvestigationFinding> = [];

  const changeMarkers: Array<InvestigationMarker> = evidence.markers.filter(
    (marker: InvestigationMarker): boolean => {
      return marker.kind === "change";
    },
  );
  for (const marker of changeMarkers) {
    findings.push({
      severity: "critical",
      text: `${marker.label} landed ${formatMinutesBefore(marker.timeMs, evidence.windowEndMs)} — deployments and config changes are the most common cause of behavior shifts.`,
    });
  }

  const halves: ErrorHalves = computeErrorHalves(
    evidence.logBuckets,
    evidence.windowStartMs,
    evidence.windowEndMs,
  );
  if (
    halves.secondHalf >= MIN_ERRORS_FOR_TREND &&
    halves.secondHalf >= halves.firstHalf * TREND_RATIO_THRESHOLD
  ) {
    const ratioLabel: string =
      halves.firstHalf === 0
        ? "from zero"
        : `${(halves.secondHalf / halves.firstHalf).toFixed(1)}×`;
    findings.push({
      severity: "warning",
      text: `Error-severity log volume rose ${ratioLabel} in the second half of the window (${halves.firstHalf} → ${halves.secondHalf}).`,
    });
  }

  const topPattern: TopErrorPatternRow | undefined = evidence.errorPatterns[0];
  const errorCount: number = evidence.logVolume?.errorCount || 0;
  if (
    topPattern &&
    errorCount > 0 &&
    topPattern.count >= errorCount * DOMINANT_PATTERN_SHARE
  ) {
    const share: number = Math.min(
      100,
      Math.round((topPattern.count / errorCount) * 100),
    );
    findings.push({
      severity: "warning",
      text: `One error pattern accounts for ~${share}% of the window's errors: "${topPattern.sampleBody || topPattern.pattern}".`,
    });
  }

  if (
    evidence.logVolume &&
    evidence.logVolume.errorRatePercent >= HIGH_ERROR_RATE_PERCENT
  ) {
    findings.push({
      severity: "warning",
      text: `${evidence.logVolume.errorRatePercent.toFixed(1)}% of the window's log lines are error severity (${evidence.logVolume.errorCount.toLocaleString()} of ${evidence.logVolume.total.toLocaleString()}).`,
    });
  }

  for (const marker of evidence.markers) {
    if (marker.kind === "change") {
      continue;
    }
    findings.push({
      severity: "info",
      text: `${marker.label} was declared inside this window — it may share this root cause.`,
    });
  }

  if (findings.length === 0) {
    findings.push({
      severity: "info",
      text: "No change events, error-pattern shifts, or concurrent incidents stand out in this window — try widening the window, or check the traces and exceptions tabs below.",
    });
  }

  return findings;
}

function describeWindow(evidence: InvestigationEvidence): string {
  return `${OneUptimeDate.getDateAsFormattedString(new Date(evidence.windowStartMs))} — ${OneUptimeDate.getDateAsFormattedString(new Date(evidence.windowEndMs))}`;
}

function describeScope(evidence: InvestigationEvidence): string {
  return evidence.scopeChips.length > 0
    ? evidence.scopeChips.join(", ")
    : "the whole project (time window only)";
}

/**
 * A prepared prompt for the Ask AI panel — the evidence, restated, with
 * a clear question. Pre-fills the chat input; the user reviews and
 * sends.
 */
export function buildInvestigationPrompt(
  evidence: InvestigationEvidence,
  findings: Array<InvestigationFinding>,
): string {
  const lines: Array<string> = [
    `I'm investigating a metric anomaly in the window ${describeWindow(evidence)}, scoped to ${describeScope(evidence)}.`,
  ];

  if (evidence.logVolume) {
    lines.push(
      `Log signal: ${evidence.logVolume.total.toLocaleString()} lines, ${evidence.logVolume.errorCount.toLocaleString()} errors (${evidence.logVolume.errorRatePercent.toFixed(1)}%).`,
    );
  }

  if (evidence.errorPatterns.length > 0) {
    lines.push("Top error patterns:");
    for (const pattern of evidence.errorPatterns.slice(0, 5)) {
      lines.push(
        `- (${pattern.count}×) ${pattern.sampleBody || pattern.pattern}`,
      );
    }
  }

  if (findings.length > 0) {
    lines.push("What already stands out:");
    for (const finding of findings) {
      lines.push(`- ${finding.text}`);
    }
  }

  lines.push(
    "What is the most likely root cause, and what should I check next?",
  );

  return lines.join("\n");
}

/**
 * Markdown for the incident's internal note — the investigation,
 * pinned to the incident timeline where the team collaborates.
 */
export function buildInvestigationNoteMarkdown(input: {
  evidence: InvestigationEvidence;
  findings: Array<InvestigationFinding>;
  explorerUrl: string | null;
}): string {
  const { evidence, findings } = input;
  const lines: Array<string> = [
    "### Investigation snapshot",
    "",
    `**Window:** ${describeWindow(evidence)}`,
    `**Scope:** ${describeScope(evidence)}`,
  ];

  if (evidence.logVolume) {
    lines.push(
      `**Log signal:** ${evidence.logVolume.total.toLocaleString()} lines · ${evidence.logVolume.errorCount.toLocaleString()} errors · ${evidence.logVolume.errorRatePercent.toFixed(1)}% error rate`,
    );
  }

  lines.push("", "**Findings:**");
  for (const finding of findings) {
    const marker: string =
      finding.severity === "critical"
        ? "🔴"
        : finding.severity === "warning"
          ? "🟠"
          : "🔵";
    lines.push(`- ${marker} ${finding.text}`);
  }

  if (evidence.errorPatterns.length > 0) {
    lines.push("", "**Top error patterns:**");
    for (const pattern of evidence.errorPatterns.slice(0, 5)) {
      lines.push(
        `- \`${(pattern.sampleBody || pattern.pattern).replace(/`/g, "'")}\` — ${pattern.count.toLocaleString()}×`,
      );
    }
  }

  if (input.explorerUrl) {
    lines.push(
      "",
      `[Open these charts in the Metric Explorer](${input.explorerUrl})`,
    );
  }

  return lines.join("\n");
}
