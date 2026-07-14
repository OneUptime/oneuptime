import {
  ImplicatedSpan,
  PerformanceFinding,
  PerformanceFindingType,
} from "../../../../Types/AI/CodeFixTaskContext";

/*
 * Deterministic span-tree analysis for the FixPerformance recipe — the part
 * of the recipe that must be trustworthy. NO LLM here: this module takes a
 * trace's spans and detects three mechanical performance patterns, each with
 * hard numeric thresholds and human-readable evidence (real counts and
 * durations). The findings are the recipe's entire grounding: the trigger
 * refuses to enqueue a fix task when this returns nothing, and the agent
 * prompt embeds the evidence verbatim.
 *
 * Patterns:
 *   1. N+1            — >=5 sibling spans under one parent with
 *                       near-identical names (digits/uuids/hex normalized)
 *                       and, when db.statement is present, near-identical
 *                       normalized statements.
 *   2. Dominant span  — a single span whose SELF time (duration not covered
 *                       by its children) is >=60% of the trace's total
 *                       duration. Self time, not raw duration: otherwise
 *                       every ancestor of a slow leaf — including the root,
 *                       trivially at 100% — would fire.
 *   3. Sequential     — >=3 same-name siblings executing strictly
 *                       one-after-another (each starts at or after the
 *                       previous end) whose combined duration is >=50% of
 *                       their parent — work that could run in parallel.
 *
 * Pure and unit-tested (SpanTreeAnalyzer.test.ts).
 */

// One span as the analyzer consumes it. Times are milliseconds.
export interface AnalyzableSpan {
  spanId: string;
  parentSpanId?: string | undefined;
  name: string;
  /*
   * Absolute (or trace-relative) start/end in ms — enables sequential
   * detection and exact self-time; durationMs alone still enables the rest.
   */
  startMs?: number | undefined;
  endMs?: number | undefined;
  durationMs?: number | undefined;
  // String-valued span attributes (db.statement, db.system, http.url, ...).
  attributes?: Record<string, string> | undefined;
}

// Thresholds — exported so tests and docs state them once.
export const N_PLUS_ONE_MIN_SIBLINGS: number = 5;
export const DOMINANT_SPAN_MIN_FRACTION: number = 0.6;
export const SEQUENTIAL_MIN_SIBLINGS: number = 3;
export const SEQUENTIAL_MIN_FRACTION_OF_PARENT: number = 0.5;
export const MAX_IMPLICATED_SPANS_PER_FINDING: number = 10;

const UUID_REGEX: RegExp =
  /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;
const LONG_HEX_REGEX: RegExp = /\b[0-9a-fA-F]{8,}\b/g;
const DIGIT_RUN_REGEX: RegExp = /\d+/g;

interface NormalizedSpan {
  spanId: string;
  parentSpanId: string | null;
  name: string;
  normalizedName: string;
  startMs: number | null;
  endMs: number | null;
  durationMs: number;
  attributes: Record<string, string>;
}

export default class SpanTreeAnalyzer {
  /*
   * Collapse the variable parts of a span name so repeated operations with
   * different ids compare equal: "GET /users/42" and "GET /users/97" both
   * become "GET /users/{n}". Order matters — uuids and long hex ids must
   * collapse before bare digit runs eat their digit characters.
   */
  public static normalizeSpanName(name: string): string {
    return name
      .trim()
      .replace(UUID_REGEX, "{id}")
      .replace(LONG_HEX_REGEX, "{id}")
      .replace(DIGIT_RUN_REGEX, "{n}")
      .replace(/\s+/g, " ");
  }

  /*
   * Collapse literals in a db.statement so "near-identical" queries compare
   * equal: quoted strings and numbers become ?, and runs of placeholders
   * collapse to one so IN-lists of different lengths still match.
   */
  public static normalizeDbStatement(statement: string): string {
    return statement
      .trim()
      .replace(/'[^']*'/g, "?")
      .replace(UUID_REGEX, "?")
      .replace(DIGIT_RUN_REGEX, "?")
      .replace(/\?(?:\s*,\s*\?)+/g, "?")
      .replace(/\s+/g, " ");
  }

  // The three detectors over one trace's spans. Empty array = no pattern.
  public static analyzeTrace(
    spans: Array<AnalyzableSpan>,
  ): Array<PerformanceFinding> {
    const normalized: Array<NormalizedSpan> = this.normalizeSpans(spans);

    if (normalized.length === 0) {
      return [];
    }

    const traceDurationMs: number = this.computeTraceDurationMs(normalized);

    if (traceDurationMs <= 0) {
      // Zero-length traces cannot support percentage-based evidence.
      return [];
    }

    const spansById: Map<string, NormalizedSpan> = new Map();
    const childrenByParent: Map<string, Array<NormalizedSpan>> = new Map();

    for (const span of normalized) {
      spansById.set(span.spanId, span);
    }

    for (const span of normalized) {
      if (!span.parentSpanId) {
        continue;
      }
      const siblings: Array<NormalizedSpan> | undefined = childrenByParent.get(
        span.parentSpanId,
      );
      if (siblings) {
        siblings.push(span);
      } else {
        childrenByParent.set(span.parentSpanId, [span]);
      }
    }

    const findings: Array<PerformanceFinding> = [];

    /*
     * Sibling groups that fired as N+1 — a sequential finding on the same
     * group would be noise (batching subsumes parallelizing).
     */
    const groupsReportedAsNPlusOne: Set<string> = new Set();

    findings.push(
      ...this.detectNPlusOne(
        childrenByParent,
        spansById,
        traceDurationMs,
        groupsReportedAsNPlusOne,
      ),
    );

    findings.push(
      ...this.detectDominantSpans(
        normalized,
        childrenByParent,
        traceDurationMs,
      ),
    );

    findings.push(
      ...this.detectSequentialSiblings(
        childrenByParent,
        spansById,
        traceDurationMs,
        groupsReportedAsNPlusOne,
      ),
    );

    /*
     * Biggest measured cost first (deterministic tie-breaks), so the top
     * finding's headline can title the pull request.
     */
    findings.sort((a: PerformanceFinding, b: PerformanceFinding): number => {
      if (b.combinedDurationMs !== a.combinedDurationMs) {
        return b.combinedDurationMs - a.combinedDurationMs;
      }
      if (a.findingType !== b.findingType) {
        return a.findingType.localeCompare(b.findingType);
      }
      return a.normalizedSpanName.localeCompare(b.normalizedSpanName);
    });

    return findings;
  }

  /*
   * Render findings as the markdown block embedded in the agent prompt and
   * the pull request body. Deterministic — rendered once server-side so the
   * worker and the PR always show the identical evidence.
   */
  public static renderFindingsMarkdown(
    findings: Array<PerformanceFinding>,
  ): string {
    const sections: Array<string> = findings.map(
      (finding: PerformanceFinding, index: number): string => {
        const lines: Array<string> = [
          `### Finding ${index + 1}: ${finding.headline}`,
          "",
          finding.evidence,
        ];

        if (finding.normalizedDbStatement) {
          lines.push(
            "",
            `Normalized statement${finding.dbSystem ? ` (${finding.dbSystem})` : ""}:`,
            "```sql",
            finding.normalizedDbStatement,
            "```",
          );
        }

        if (finding.httpUrl) {
          lines.push("", `HTTP URL: \`${finding.httpUrl}\``);
        }

        if (finding.implicatedSpans.length > 0) {
          lines.push("", "Implicated spans (name — duration):");
          for (const span of finding.implicatedSpans) {
            lines.push(
              `- "${span.name}" — ${this.formatMs(span.durationMs)} (spanId ${span.spanId})`,
            );
          }
          if (finding.spanCount > finding.implicatedSpans.length) {
            lines.push(
              `- … and ${finding.spanCount - finding.implicatedSpans.length} more`,
            );
          }
        }

        return lines.join("\n");
      },
    );

    return sections.join("\n\n");
  }

  private static normalizeSpans(
    spans: Array<AnalyzableSpan>,
  ): Array<NormalizedSpan> {
    const normalized: Array<NormalizedSpan> = [];

    for (const span of spans) {
      if (!span.spanId || !span.name) {
        continue;
      }

      const startMs: number | null =
        typeof span.startMs === "number" && Number.isFinite(span.startMs)
          ? span.startMs
          : null;
      const endMs: number | null =
        typeof span.endMs === "number" && Number.isFinite(span.endMs)
          ? span.endMs
          : null;

      let durationMs: number =
        typeof span.durationMs === "number" && Number.isFinite(span.durationMs)
          ? span.durationMs
          : startMs !== null && endMs !== null
            ? endMs - startMs
            : 0;

      if (durationMs < 0) {
        durationMs = 0;
      }

      normalized.push({
        spanId: span.spanId,
        parentSpanId: span.parentSpanId || null,
        name: span.name,
        normalizedName: this.normalizeSpanName(span.name),
        startMs,
        endMs,
        durationMs,
        attributes: span.attributes || {},
      });
    }

    return normalized;
  }

  /*
   * Total trace duration: the start/end envelope when timestamps exist;
   * otherwise the longest single span (in practice the root) is the honest
   * duration-only proxy.
   */
  private static computeTraceDurationMs(spans: Array<NormalizedSpan>): number {
    let minStart: number | null = null;
    let maxEnd: number | null = null;

    for (const span of spans) {
      if (span.startMs === null || span.endMs === null) {
        continue;
      }
      if (minStart === null || span.startMs < minStart) {
        minStart = span.startMs;
      }
      if (maxEnd === null || span.endMs > maxEnd) {
        maxEnd = span.endMs;
      }
    }

    if (minStart !== null && maxEnd !== null && maxEnd > minStart) {
      return maxEnd - minStart;
    }

    let maxDuration: number = 0;
    for (const span of spans) {
      if (span.durationMs > maxDuration) {
        maxDuration = span.durationMs;
      }
    }
    return maxDuration;
  }

  private static getDbStatement(span: NormalizedSpan): string | null {
    return (
      span.attributes["db.statement"] ||
      span.attributes["db.query.text"] ||
      null
    );
  }

  private static getDbSystem(span: NormalizedSpan): string | null {
    return (
      span.attributes["db.system"] || span.attributes["db.system.name"] || null
    );
  }

  private static getHttpUrl(span: NormalizedSpan): string | null {
    return span.attributes["http.url"] || span.attributes["url.full"] || null;
  }

  private static formatMs(ms: number): string {
    return `${Math.round(ms * 10) / 10}ms`;
  }

  private static formatPercent(fraction: number): string {
    return `${Math.round(fraction * 1000) / 10}%`;
  }

  private static toImplicatedSpans(
    spans: Array<NormalizedSpan>,
  ): Array<ImplicatedSpan> {
    return spans
      .slice(0, MAX_IMPLICATED_SPANS_PER_FINDING)
      .map((span: NormalizedSpan): ImplicatedSpan => {
        return {
          spanId: span.spanId,
          name: span.name,
          durationMs: Math.round(span.durationMs * 10) / 10,
        };
      });
  }

  /*
   * Same-operation sibling groups under one parent: key = normalized name
   * plus (when present) the normalized db.statement, so "27 SELECTs that
   * only differ by id" group together while different queries behind one
   * generic span name ("query") stay apart.
   */
  private static groupSiblings(
    siblings: Array<NormalizedSpan>,
  ): Map<string, Array<NormalizedSpan>> {
    const groups: Map<string, Array<NormalizedSpan>> = new Map();

    for (const span of siblings) {
      const statement: string | null = this.getDbStatement(span);
      const key: string = `${span.normalizedName} ${
        statement ? this.normalizeDbStatement(statement) : ""
      }`;
      const group: Array<NormalizedSpan> | undefined = groups.get(key);
      if (group) {
        group.push(span);
      } else {
        groups.set(key, [span]);
      }
    }

    return groups;
  }

  private static detectNPlusOne(
    childrenByParent: Map<string, Array<NormalizedSpan>>,
    spansById: Map<string, NormalizedSpan>,
    traceDurationMs: number,
    groupsReportedAsNPlusOne: Set<string>,
  ): Array<PerformanceFinding> {
    const findings: Array<PerformanceFinding> = [];

    for (const [parentSpanId, siblings] of childrenByParent) {
      const parent: NormalizedSpan | undefined = spansById.get(parentSpanId);

      for (const [groupKey, group] of this.groupSiblings(siblings)) {
        if (group.length < N_PLUS_ONE_MIN_SIBLINGS) {
          continue;
        }

        const sample: NormalizedSpan = group[0]!;
        const combinedDurationMs: number = group.reduce(
          (sum: number, span: NormalizedSpan): number => {
            return sum + span.durationMs;
          },
          0,
        );
        const statement: string | null = this.getDbStatement(sample);
        const normalizedStatement: string | null = statement
          ? this.normalizeDbStatement(statement)
          : null;
        const parentLabel: string = parent
          ? `"${parent.name}"`
          : `parent span ${parentSpanId}`;

        const evidenceLines: Array<string> = [
          `${group.length} sibling spans named "${sample.normalizedName}" execute under ${parentLabel} in this trace — the classic N+1 shape (one span per item instead of one batched operation).`,
          `Combined they take ${this.formatMs(combinedDurationMs)} of the ${this.formatMs(traceDurationMs)} trace (${this.formatPercent(combinedDurationMs / traceDurationMs)}); average ${this.formatMs(combinedDurationMs / group.length)} per span.`,
        ];

        if (normalizedStatement) {
          evidenceLines.push(
            `All ${group.length} spans run a near-identical statement (literals normalized to ?): ${normalizedStatement}`,
          );
        }

        groupsReportedAsNPlusOne.add(`${parentSpanId} ${groupKey}`);

        findings.push({
          findingType: PerformanceFindingType.NPlusOneQuery,
          headline: `N+1: ${group.length}× "${sample.normalizedName}"${parent ? ` under "${parent.name}"` : ""}`,
          evidence: evidenceLines.join("\n"),
          spanCount: group.length,
          combinedDurationMs: Math.round(combinedDurationMs * 10) / 10,
          traceDurationMs: Math.round(traceDurationMs * 10) / 10,
          percentOfTrace:
            Math.round((combinedDurationMs / traceDurationMs) * 1000) / 10,
          normalizedSpanName: sample.normalizedName,
          parentSpanName: parent?.name,
          normalizedDbStatement: normalizedStatement || undefined,
          dbSystem: this.getDbSystem(sample) || undefined,
          httpUrl: this.getHttpUrl(sample) || undefined,
          implicatedSpans: this.toImplicatedSpans(group),
        });
      }
    }

    return findings;
  }

  /*
   * Self time of a span: its duration minus the time covered by its direct
   * children — the exact interval union when timestamps exist, else the
   * clamped sum of child durations.
   */
  private static computeSelfTimeMs(
    span: NormalizedSpan,
    children: Array<NormalizedSpan>,
  ): number {
    if (children.length === 0) {
      return span.durationMs;
    }

    const timedChildren: Array<NormalizedSpan> = children.filter(
      (child: NormalizedSpan): boolean => {
        return child.startMs !== null && child.endMs !== null;
      },
    );

    if (
      span.startMs !== null &&
      span.endMs !== null &&
      timedChildren.length === children.length
    ) {
      // Union of child intervals clipped to the span's own interval.
      const intervals: Array<[number, number]> = timedChildren
        .map((child: NormalizedSpan): [number, number] => {
          return [
            Math.max(child.startMs!, span.startMs!),
            Math.min(child.endMs!, span.endMs!),
          ];
        })
        .filter((interval: [number, number]): boolean => {
          return interval[1] > interval[0];
        })
        .sort((a: [number, number], b: [number, number]): number => {
          return a[0] - b[0];
        });

      let covered: number = 0;
      let currentStart: number | null = null;
      let currentEnd: number | null = null;

      for (const [start, end] of intervals) {
        if (currentEnd === null || start > currentEnd) {
          if (currentStart !== null && currentEnd !== null) {
            covered += currentEnd - currentStart;
          }
          currentStart = start;
          currentEnd = end;
        } else if (end > currentEnd) {
          currentEnd = end;
        }
      }
      if (currentStart !== null && currentEnd !== null) {
        covered += currentEnd - currentStart;
      }

      return Math.max(span.durationMs - covered, 0);
    }

    const childDurationSum: number = children.reduce(
      (sum: number, child: NormalizedSpan): number => {
        return sum + child.durationMs;
      },
      0,
    );

    return Math.max(span.durationMs - childDurationSum, 0);
  }

  private static detectDominantSpans(
    spans: Array<NormalizedSpan>,
    childrenByParent: Map<string, Array<NormalizedSpan>>,
    traceDurationMs: number,
  ): Array<PerformanceFinding> {
    const findings: Array<PerformanceFinding> = [];

    for (const span of spans) {
      const selfTimeMs: number = this.computeSelfTimeMs(
        span,
        childrenByParent.get(span.spanId) || [],
      );

      if (selfTimeMs / traceDurationMs < DOMINANT_SPAN_MIN_FRACTION) {
        continue;
      }

      const statement: string | null = this.getDbStatement(span);
      const normalizedStatement: string | null = statement
        ? this.normalizeDbStatement(statement)
        : null;

      const evidenceLines: Array<string> = [
        `The single span "${span.name}" (spanId ${span.spanId}) spends ${this.formatMs(selfTimeMs)} in its own work — ${this.formatPercent(selfTimeMs / traceDurationMs)} of the ${this.formatMs(traceDurationMs)} trace. One operation dominates this request's latency.`,
      ];

      if (normalizedStatement) {
        evidenceLines.push(
          `The span's statement (literals normalized to ?): ${normalizedStatement}`,
        );
      }

      findings.push({
        findingType: PerformanceFindingType.DominantSpan,
        headline: `Dominant span: "${span.name}" is ${this.formatPercent(selfTimeMs / traceDurationMs)} of the trace`,
        evidence: evidenceLines.join("\n"),
        spanCount: 1,
        combinedDurationMs: Math.round(selfTimeMs * 10) / 10,
        traceDurationMs: Math.round(traceDurationMs * 10) / 10,
        percentOfTrace: Math.round((selfTimeMs / traceDurationMs) * 1000) / 10,
        normalizedSpanName: span.normalizedName,
        normalizedDbStatement: normalizedStatement || undefined,
        dbSystem: this.getDbSystem(span) || undefined,
        httpUrl: this.getHttpUrl(span) || undefined,
        implicatedSpans: this.toImplicatedSpans([span]),
      });
    }

    return findings;
  }

  private static detectSequentialSiblings(
    childrenByParent: Map<string, Array<NormalizedSpan>>,
    spansById: Map<string, NormalizedSpan>,
    traceDurationMs: number,
    groupsReportedAsNPlusOne: Set<string>,
  ): Array<PerformanceFinding> {
    const findings: Array<PerformanceFinding> = [];

    for (const [parentSpanId, siblings] of childrenByParent) {
      const parent: NormalizedSpan | undefined = spansById.get(parentSpanId);

      // Percent-of-parent needs a parent with a real duration.
      if (!parent || parent.durationMs <= 0) {
        continue;
      }

      for (const [groupKey, group] of this.groupSiblings(siblings)) {
        if (group.length < SEQUENTIAL_MIN_SIBLINGS) {
          continue;
        }

        // Batching (the N+1 fix) subsumes parallelizing — do not report both.
        if (groupsReportedAsNPlusOne.has(`${parentSpanId} ${groupKey}`)) {
          continue;
        }

        // Sequential execution is only observable with timestamps.
        if (
          group.some((span: NormalizedSpan): boolean => {
            return span.startMs === null || span.endMs === null;
          })
        ) {
          continue;
        }

        const ordered: Array<NormalizedSpan> = [...group].sort(
          (a: NormalizedSpan, b: NormalizedSpan): number => {
            return a.startMs! - b.startMs!;
          },
        );

        let isStrictlySequential: boolean = true;
        for (let i: number = 1; i < ordered.length; i++) {
          if (ordered[i]!.startMs! < ordered[i - 1]!.endMs!) {
            isStrictlySequential = false;
            break;
          }
        }

        if (!isStrictlySequential) {
          continue;
        }

        const combinedDurationMs: number = ordered.reduce(
          (sum: number, span: NormalizedSpan): number => {
            return sum + span.durationMs;
          },
          0,
        );

        if (
          combinedDurationMs / parent.durationMs <
          SEQUENTIAL_MIN_FRACTION_OF_PARENT
        ) {
          continue;
        }

        const sample: NormalizedSpan = ordered[0]!;
        const sampleStatement: string | null = this.getDbStatement(sample);

        findings.push({
          findingType: PerformanceFindingType.SequentialSiblings,
          headline: `Sequential: ${ordered.length}× "${sample.normalizedName}" run one-after-another under "${parent.name}"`,
          evidence: [
            `${ordered.length} sibling spans named "${sample.normalizedName}" under "${parent.name}" execute strictly sequentially — each starts only after the previous one ends, so none of the work overlaps.`,
            `Combined they take ${this.formatMs(combinedDurationMs)} of the parent's ${this.formatMs(parent.durationMs)} (${this.formatPercent(combinedDurationMs / parent.durationMs)}). If these operations are independent, running them concurrently would remove most of that wall-clock time.`,
          ].join("\n"),
          spanCount: ordered.length,
          combinedDurationMs: Math.round(combinedDurationMs * 10) / 10,
          traceDurationMs: Math.round(traceDurationMs * 10) / 10,
          percentOfTrace:
            Math.round((combinedDurationMs / traceDurationMs) * 1000) / 10,
          percentOfParent:
            Math.round((combinedDurationMs / parent.durationMs) * 1000) / 10,
          normalizedSpanName: sample.normalizedName,
          parentSpanName: parent.name,
          normalizedDbStatement: sampleStatement
            ? this.normalizeDbStatement(sampleStatement)
            : undefined,
          dbSystem: this.getDbSystem(sample) || undefined,
          httpUrl: this.getHttpUrl(sample) || undefined,
          implicatedSpans: this.toImplicatedSpans(ordered),
        });
      }
    }

    return findings;
  }
}
