import { FormFactor } from "./Pages";

/*
 * What a Lighthouse report says fails, and how that differs from what
 * Baseline.json recorded. Results.spec.ts holds it to its job on reports it
 * writes itself.
 *
 * The suite scans the three categories whose audits answer the same on every
 * run: accessibility, best practices and SEO read the page, not how fast a
 * shared runner drew it. Performance is left to scans of oneuptime.com.
 */
export const ScannedCategories: ReadonlyArray<string> = [
  "accessibility",
  "best-practices",
  "seo",
];

/*
 * The report's own line between passed and failed: its HTML shows an audit
 * as passed from this score up (a binary audit scores 0 or 1).
 */
const PassingScore: number = 0.9;

// At most this many of a failing audit's elements or requests are named.
const ItemsNamed: number = 5;
const ItemLength: number = 300;

// The parts of a Lighthouse report (LH.Result) the suite reads.
export interface ReportAudit {
  title: string;
  score: number | null;
  scoreDisplayMode: string;
  // Why it fails, for an audit that names no elements (doctype, canonical).
  explanation?: string | undefined;
  errorMessage?: string | undefined;
  details?: { type: string; items?: unknown } | undefined;
}

export interface ReportCategory {
  title: string;
  score: number | null;
  auditRefs: Array<{ id: string; weight: number }>;
}

export interface Report {
  lighthouseVersion: string;
  runtimeError?: { code: string; message: string } | undefined;
  categories: Record<string, ReportCategory | undefined>;
  audits: Record<string, ReportAudit | undefined>;
}

export interface Baseline {
  // The Lighthouse that recorded it: another version may judge differently.
  lighthouse: string;
  // A page's path, then its form factor: the audits that failed, sorted.
  pages: Record<string, Partial<Record<FormFactor, Array<string>>>>;
}

// The audits that count toward a scanned category's score, by id.
function scoredAudits(report: Report): Array<string> {
  const ids: Set<string> = new Set();

  for (const category of ScannedCategories) {
    for (const auditRef of report.categories[category]?.auditRefs || []) {
      if (auditRef.weight > 0) {
        ids.add(auditRef.id);
      }
    }
  }

  return Array.from(ids);
}

// The scored audits that fail, sorted by id: what Baseline.json records.
export function failingAudits(report: Report): Array<string> {
  return scoredAudits(report)
    .filter((id: string): boolean => {
      const score: number | null | undefined = report.audits[id]?.score;

      return typeof score === "number" && score < PassingScore;
    })
    .sort();
}

/*
 * What kept Lighthouse from judging the page, or one of its scored audits:
 * a page that did not load, an audit that threw. Either would otherwise
 * read as a pass.
 */
export function scanErrors(report: Report): Array<string> {
  const errors: Array<string> = [];

  if (report.runtimeError) {
    errors.push(
      `Lighthouse could not scan the page: ${report.runtimeError.code}: ${report.runtimeError.message}`,
    );
  }

  for (const id of scoredAudits(report)) {
    const audit: ReportAudit | undefined = report.audits[id];

    if (audit?.scoreDisplayMode === "error") {
      errors.push(
        `Lighthouse could not run ${id} ("${audit.title}"): ${audit.errorMessage || "no reason given"}`,
      );
    }
  }

  return errors;
}

/*
 * On one line, at most ItemLength characters. Cut before the whitespace is
 * folded, so a console message megabytes long costs no more than a short one.
 */
function shortened(text: string): string {
  const oneLine: string = text
    .slice(0, ItemLength * 4)
    .replace(/\s+/g, " ")
    .trim();

  return oneLine.length > ItemLength
    ? `${oneLine.slice(0, ItemLength - 1)}…`
    : oneLine;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

// An element as the audit names it: its selector, its markup, what is wrong.
function elementOf(value: unknown): string | null {
  const element: Record<string, unknown> | null = asRecord(value);

  if (!element) {
    return null;
  }

  const parts: Array<string> = [
    element["selector"],
    element["snippet"],
    element["explanation"],
  ]
    .map(nonEmpty)
    .filter((part: string | null): part is string => {
      return part !== null;
    });

  return parts.length > 0 ? parts.join(" ") : null;
}

// What a table cell says: its own text, or the text or URL it holds.
function textOf(value: unknown): string | null {
  const cell: Record<string, unknown> | null = asRecord(value);

  return cell
    ? nonEmpty(cell["value"]) || nonEmpty(cell["text"])
    : nonEmpty(value);
}

// Where a row points: a URL, or a source location's.
function placeOf(row: Record<string, unknown>): string | null {
  return (
    nonEmpty(row["url"]) ||
    nonEmpty(row["href"]) ||
    nonEmpty(asRecord(row["sourceLocation"])?.["url"]) ||
    nonEmpty(asRecord(row["source"])?.["url"])
  );
}

/*
 * One element or request a failing audit names, as a line someone can find
 * in the page: an element's selector, its markup and why it fails; or what a
 * message or request says and where it comes from.
 */
export function describeItem(item: unknown): string {
  const row: Record<string, unknown> | null = asRecord(item);

  if (!row) {
    return shortened(String(item));
  }

  const element: string | null =
    elementOf(row["node"]) || elementOf(row["source"]);

  if (element) {
    return shortened(element);
  }

  const parts: Array<string> = [
    textOf(row["description"]) ||
      textOf(row["value"]) ||
      textOf(row["text"]) ||
      textOf(row["name"]),
    placeOf(row),
  ].filter((part: string | null): part is string => {
    return part !== null;
  });

  return shortened(parts.length > 0 ? parts.join(" at ") : JSON.stringify(row));
}

export function describeFailure(report: Report, id: string): string {
  const audit: ReportAudit | undefined = report.audits[id];
  const items: unknown = audit?.details?.items;
  const rows: Array<unknown> = Array.isArray(items) ? items : [];
  const explanation: string | null = nonEmpty(audit?.explanation);
  const lines: Array<string> = explanation
    ? [`\n    ${shortened(explanation)}`]
    : [];

  for (const row of rows.slice(0, ItemsNamed)) {
    lines.push(`\n    - ${describeItem(row)}`);
  }

  if (rows.length > ItemsNamed) {
    lines.push(`\n    - and ${rows.length - ItemsNamed} more`);
  }

  return `${id} fails: ${audit?.title || "(no title)"}${lines.join("")}`;
}

/*
 * Every way a page's report differs from what Baseline.json recorded for it,
 * each a sentence saying what to do. None is a pass.
 */
export function differencesFromBaseline(data: {
  report: Report;
  baseline: Baseline;
  path: string;
  formFactor: FormFactor;
}): Array<string> {
  const { report, baseline, path, formFactor } = data;
  const differences: Array<string> = scanErrors(report);

  if (baseline.lighthouse !== report.lighthouseVersion) {
    differences.push(
      `Baseline.json was recorded with Lighthouse ${baseline.lighthouse}, and this is ${report.lighthouseVersion}, which can judge differently: record it again (Lighthouse/README.md).`,
    );
  }

  const recorded: Array<string> | undefined =
    baseline.pages[path]?.[formFactor];

  if (!recorded) {
    differences.push(
      `Baseline.json has nothing for ${path} on ${formFactor}: record it (Lighthouse/README.md).`,
    );

    return differences;
  }

  const failing: Array<string> = failingAudits(report);

  for (const id of failing) {
    if (!recorded.includes(id)) {
      differences.push(describeFailure(report, id));
    }
  }

  for (const id of recorded) {
    if (!failing.includes(id)) {
      differences.push(
        `${id} passes now: take it out of ${path}'s ${formFactor} list in Baseline.json, or record it again (Lighthouse/README.md).`,
      );
    }
  }

  return differences;
}

// A category's score out of 100, as the report shows it, or "-" without one.
export function scoreOf(report: Report, category: string): string {
  const score: number | null | undefined = report.categories[category]?.score;

  return typeof score === "number" ? String(Math.round(score * 100)) : "-";
}
