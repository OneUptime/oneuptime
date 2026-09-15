import { JSONObject } from "../JSON";
import { AIChatCitationTarget, AIChatWidget } from "./AIChatTypes";

/*
 * Structured evidence for an AI investigation report. The report markdown only
 * carries a flat "Evidence checked" list of labels; the investigation panel
 * needs to know what each citation actually queried so a responder can open
 * it, see its arguments and load the rows behind it.
 *
 * Everything here is derived server-side from the run's own AIRunEvents
 * (never from model-authored text), so a prompt-injected report cannot forge
 * a citation's tool, arguments or deep link.
 */

/*
 * One read-only query the investigation ran, keyed by its citation id. The
 * report's inline [C#] markers refer to these.
 */
export interface InvestigationEvidenceItem {
  // "C1", "C2" — sequential within the attempt that produced the report.
  citationId: string;
  toolName: string;
  // Server-minted citation label, e.g. "Active incidents (7 total)".
  label: string;
  // Rows the query returned. 0 is meaningful: checked, found nothing.
  rowCount: number;
  durationInMs?: number | undefined;
  /*
   * The tool arguments as executed, reduced to primitives and arrays of
   * primitives with long strings clipped, so the panel can show what was
   * asked without shipping arbitrary JSON to every viewer.
   */
  queryArguments: JSONObject;
  // Where the underlying data lives in the dashboard, when there is a page for it.
  target?: AIChatCitationTarget | undefined;
  // ISO timestamp of when the query ran.
  executedAt?: string | undefined;
  /*
   * Whether POST /ai-investigation/evidence can re-run this query for the
   * viewer. False for tools that are not part of the read-only toolbox.
   */
  canLoadRows: boolean;
}

export type InvestigationReferenceKind = "incident" | "alert";

/*
 * An incident or alert the report mentions by number ("#6954"), resolved
 * against the project's own records under the VIEWER's permissions. Only
 * numbers that resolve become links; everything else stays plain text.
 */
export interface InvestigationEventReference {
  kind: InvestigationReferenceKind;
  number: number;
  // ObjectID of the incident/alert as a string.
  id: string;
  // incidentNumberWithPrefix / alertNumberWithPrefix, or "#<number>".
  displayNumber: string;
  title: string;
  stateName?: string | undefined;
  // Hex color of the current state, e.g. "#10b981".
  stateColor?: string | undefined;
}

/*
 * Response of POST /ai-investigation/evidence: one citation's query re-run
 * with the viewer's own permissions.
 */
export interface InvestigationEvidenceRowsResponse {
  citationId: string;
  toolName: string;
  label: string;
  rowCount: number;
  /*
   * Rendered with the dashboard's AI chat widget renderers (incident list,
   * table, chart, trace waterfall...). Built from rows the viewer can read.
   */
  widget?: AIChatWidget | undefined;
  /*
   * Plain-text rows for tools that have no widget. Never markdown — the panel
   * renders it inside a <pre>.
   */
  text?: string | undefined;
  isTruncated: boolean;
  // When this re-run executed (ISO).
  executedAt: string;
  /*
   * True when the query's time window was pinned to the original
   * investigation (explicit start/end), so the rows match what the AI saw
   * apart from retention and permissions. False means the query reflects
   * current data (e.g. "active incidents").
   */
  isPinnedToInvestigationTime: boolean;
  // When the original query ran (ISO), if known.
  investigatedAt?: string | undefined;
}
