import {
  AIChatCitationTarget,
  AIChatCitationTargetType,
  AIChatWidget,
  AIChatWidgetType,
} from "Common/Types/AI/AIChatTypes";
import {
  InvestigationEventReference,
  InvestigationEvidenceItem,
  InvestigationEvidenceRowsResponse,
  InvestigationReferenceKind,
} from "Common/Types/AI/InvestigationEvidence";
import ColumnLength from "Common/Types/Database/ColumnLength";
import { JSONObject } from "Common/Types/JSON";
import {
  ParsedInvestigationReport,
  getCitationMarkerRegex,
} from "Common/Utils/AI/InvestigationReport";

// The event an investigation belongs to; same values as the panel's subject.
export type InvestigationReportSubjectType = InvestigationReferenceKind;

/*
 * Defensive readers for the investigation payload's structured parts, plus the
 * plain-text summary the incident/alert header shows.
 *
 * The panel talks to API replicas that may predate `evidence` and
 * `references`, and every field ends up in the DOM (as text, a route param or
 * a title attribute), so each item is validated field by field and anything
 * malformed is dropped rather than rendered.
 */

export const MAX_EVIDENCE_ITEMS: number = 100;
export const MAX_EVENT_REFERENCES: number = 50;
/*
 * The header clamps the summary on screen and offers Show more, so this is
 * only a bound on what it can expand to. It is the width of the
 * AIRun.analysisTldr column, so a stored TL;DR (which the server caps at 320
 * characters) always arrives whole; a clip below that cap cut complete
 * sentences short with an ellipsis. Only the fallback, a report Summary
 * flattened to text, can run past it.
 */
export const MAX_REPORT_SUMMARY_LENGTH: number = ColumnLength.LongText;

const CITATION_ID_REGEX: RegExp = /^C\d{1,3}$/;
const UUID_REGEX: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TEXT_LENGTH: number = 500;
/*
 * Route params land in a URL path, so only id-shaped values are kept: UUIDs
 * and the hex / token ids traces use.
 */
const TARGET_PARAM_VALUE_REGEX: RegExp = /^[A-Za-z0-9-]{1,128}$/;
const HEX_COLOR_REGEX: RegExp = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const MAX_ARGUMENT_KEYS: number = 25;
const TARGET_TYPES: Set<string> = new Set<string>(
  Object.values(AIChatCitationTargetType) as Array<string>,
);
const WIDGET_TYPES: Set<string> = new Set<string>(
  Object.values(AIChatWidgetType) as Array<string>,
);
// Matches the server's clip of the plain-text rows.
export const MAX_EVIDENCE_ROWS_TEXT_LENGTH: number = 20_000;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed: string = value.trim();

  return trimmed ? trimmed.slice(0, MAX_TEXT_LENGTH) : undefined;
}

function readNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : undefined;
}

function readIsoDate(value: unknown): string | undefined {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    return undefined;
  }

  return value;
}

export function isValidCitationId(value: unknown): value is string {
  return typeof value === "string" && CITATION_ID_REGEX.test(value);
}

export function getCitationNumber(citationId: string): number {
  const parsed: number = parseInt(citationId.slice(1), 10);

  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

function readTarget(value: unknown): AIChatCitationTarget | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }

  const targetType: unknown = value["type"];

  if (typeof targetType !== "string" || !TARGET_TYPES.has(targetType)) {
    return undefined;
  }

  const target: AIChatCitationTarget = {
    type: targetType as AIChatCitationTargetType,
  };
  const rawParams: unknown = value["params"];

  if (isPlainObject(rawParams)) {
    const params: { [key: string]: string } = {};

    for (const key of Object.keys(rawParams)) {
      const paramValue: unknown = rawParams[key];

      if (
        typeof paramValue === "string" &&
        TARGET_PARAM_VALUE_REGEX.test(paramValue)
      ) {
        params[key] = paramValue;
      }
    }

    if (Object.keys(params).length > 0) {
      target.params = params;
    }
  }

  return target;
}

function readQueryArguments(value: unknown): JSONObject {
  const args: JSONObject = {};

  if (!isPlainObject(value)) {
    return args;
  }

  for (const key of Object.keys(value).slice(0, MAX_ARGUMENT_KEYS)) {
    const argument: unknown = value[key];

    if (
      typeof argument === "string" ||
      typeof argument === "boolean" ||
      (typeof argument === "number" && Number.isFinite(argument))
    ) {
      args[key] = argument;
      continue;
    }

    if (Array.isArray(argument)) {
      const items: Array<string | number | boolean> = argument.filter(
        (item: unknown): item is string | number | boolean => {
          return (
            typeof item === "string" ||
            typeof item === "boolean" ||
            (typeof item === "number" && Number.isFinite(item))
          );
        },
      );

      args[key] = items;
    }
  }

  return args;
}

/*
 * `evidence` from the investigation payload. Missing or malformed input (an
 * older API replica) is an empty list; duplicate citation ids keep the first.
 */
export function parseInvestigationEvidence(
  value: unknown,
): Array<InvestigationEvidenceItem> {
  if (!Array.isArray(value)) {
    return [];
  }

  const items: Array<InvestigationEvidenceItem> = [];
  const seen: Set<string> = new Set<string>();

  for (const raw of value) {
    if (items.length >= MAX_EVIDENCE_ITEMS) {
      break;
    }

    if (!isPlainObject(raw)) {
      continue;
    }

    const citationId: unknown = raw["citationId"];

    if (!isValidCitationId(citationId)) {
      continue;
    }

    const toolName: string | undefined = readText(raw["toolName"]);

    if (seen.has(citationId) || !toolName) {
      continue;
    }

    seen.add(citationId);

    const item: InvestigationEvidenceItem = {
      citationId,
      toolName,
      label: readText(raw["label"]) || toolName,
      rowCount: readNonNegativeInteger(raw["rowCount"]) ?? 0,
      queryArguments: readQueryArguments(raw["queryArguments"]),
      canLoadRows: raw["canLoadRows"] === true,
    };

    const durationInMs: number | undefined = readNonNegativeInteger(
      raw["durationInMs"],
    );

    if (durationInMs !== undefined) {
      item.durationInMs = durationInMs;
    }

    const target: AIChatCitationTarget | undefined = readTarget(raw["target"]);

    if (target) {
      item.target = target;
    }

    const executedAt: string | undefined = readIsoDate(raw["executedAt"]);

    if (executedAt) {
      item.executedAt = executedAt;
    }

    items.push(item);
  }

  return items.sort(
    (a: InvestigationEvidenceItem, b: InvestigationEvidenceItem): number => {
      return getCitationNumber(a.citationId) - getCitationNumber(b.citationId);
    },
  );
}

function readWidget(value: unknown): AIChatWidget | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }

  const widgetType: unknown = value["type"];
  const widgetData: unknown = value["data"];

  if (
    typeof widgetType !== "string" ||
    !WIDGET_TYPES.has(widgetType) ||
    !isPlainObject(widgetData)
  ) {
    return undefined;
  }

  const widget: AIChatWidget = {
    id: readText(value["id"]) || "W1",
    type: widgetType as AIChatWidgetType,
    title: readText(value["title"]) || "",
    data: widgetData as AIChatWidget["data"],
  };
  const description: string | undefined = readText(value["description"]);

  if (description) {
    widget.description = description;
  }

  const citationId: unknown = value["citationId"];

  if (isValidCitationId(citationId)) {
    widget.citationId = citationId;
  }

  return widget;
}

/*
 * The body of POST /ai-investigation/evidence. Null when it is not a rows
 * response at all, so the caller can show an error instead of an empty state.
 */
export function parseInvestigationEvidenceRows(
  value: unknown,
): InvestigationEvidenceRowsResponse | null {
  if (!isPlainObject(value)) {
    return null;
  }

  const citationId: unknown = value["citationId"];

  if (!isValidCitationId(citationId)) {
    return null;
  }

  const rowCount: number | undefined = readNonNegativeInteger(
    value["rowCount"],
  );

  if (rowCount === undefined) {
    return null;
  }

  const response: InvestigationEvidenceRowsResponse = {
    citationId,
    toolName: readText(value["toolName"]) || "",
    label: readText(value["label"]) || "",
    rowCount,
    isTruncated: value["isTruncated"] === true,
    executedAt: readIsoDate(value["executedAt"]) || "",
    isPinnedToInvestigationTime: value["isPinnedToInvestigationTime"] === true,
  };

  const widget: AIChatWidget | undefined = readWidget(value["widget"]);

  if (widget) {
    response.widget = widget;
  }

  const text: unknown = value["text"];

  if (typeof text === "string" && text.trim()) {
    response.text = text.slice(0, MAX_EVIDENCE_ROWS_TEXT_LENGTH);
  }

  const investigatedAt: string | undefined = readIsoDate(
    value["investigatedAt"],
  );

  if (investigatedAt) {
    response.investigatedAt = investigatedAt;
  }

  return response;
}

function readReferenceKind(
  value: unknown,
): InvestigationReferenceKind | undefined {
  return value === "incident" || value === "alert" ? value : undefined;
}

// A hex colour only; anything else could smuggle CSS into a style attribute.
function readColor(value: unknown): string | undefined {
  return typeof value === "string" && HEX_COLOR_REGEX.test(value.trim())
    ? value.trim()
    : undefined;
}

/*
 * `references` from the investigation payload: incidents/alerts the report
 * mentions by number, already resolved server-side under the viewer's
 * permissions. Only well-formed rows with a UUID id survive.
 */
export function parseInvestigationReferences(
  value: unknown,
): Array<InvestigationEventReference> {
  if (!Array.isArray(value)) {
    return [];
  }

  const references: Array<InvestigationEventReference> = [];
  const seen: Set<string> = new Set<string>();

  for (const raw of value) {
    if (references.length >= MAX_EVENT_REFERENCES) {
      break;
    }

    if (!isPlainObject(raw)) {
      continue;
    }

    const kind: InvestigationReferenceKind | undefined = readReferenceKind(
      raw["kind"],
    );
    const referenceNumber: number | undefined = readNonNegativeInteger(
      raw["number"],
    );
    const id: unknown = raw["id"];

    if (
      !kind ||
      referenceNumber === undefined ||
      referenceNumber !== raw["number"] ||
      typeof id !== "string" ||
      !UUID_REGEX.test(id)
    ) {
      continue;
    }

    const key: string = getEventReferenceKey(kind, referenceNumber);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);

    const reference: InvestigationEventReference = {
      kind,
      number: referenceNumber,
      id,
      displayNumber: readText(raw["displayNumber"]) || `#${referenceNumber}`,
      title: readText(raw["title"]) || "",
    };

    const stateName: string | undefined = readText(raw["stateName"]);

    if (stateName) {
      reference.stateName = stateName;
    }

    const stateColor: string | undefined = readColor(raw["stateColor"]);

    if (stateColor) {
      reference.stateColor = stateColor;
    }

    references.push(reference);
  }

  return references;
}

export function getEventReferenceKey(
  kind: InvestigationReferenceKind,
  referenceNumber: number,
): string {
  return `${kind}:${referenceNumber}`;
}

/*
 * Markdown → one line of plain text for the event header. Formatting marks,
 * link targets, images and citation markers are dropped; the words stay.
 */
export function markdownToPlainText(markdown: string): string {
  if (typeof markdown !== "string") {
    return "";
  }

  return (
    markdown
      .replace(/\r\n?/g, "\n")
      // Fence lines themselves (the code inside stays as text).
      .replace(/^[ \t]*(?:```|~~~).*$/gm, " ")
      // Images keep their alt text, links keep their label.
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(getCitationMarkerRegex(), "")
      // Heading hashes, blockquote marks and list bullets at line start.
      .replace(/^[ \t]*#{1,6}[ \t]+/gm, "")
      .replace(/^[ \t]*>[ \t]?/gm, "")
      .replace(/^[ \t]*(?:[-*+]|\d{1,3}[.)])[ \t]+/gm, "")
      // Emphasis and inline code markers.
      .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "$2")
      .replace(/(^|[^\w*])\*(?=\S)([^*\n]*?\S)\*(?!\w)/g, "$1$2")
      .replace(/(^|[^\w_])_(?=\S)([^_\n]*?\S)_(?!\w)/g, "$1$2")
      .replace(/~~(?=\S)([\s\S]*?\S)~~/g, "$1")
      .replace(/`+([^`]*)`+/g, "$1")
      .replace(/\s+/g, " ")
      // A dropped citation leaves "word ." behind.
      .replace(/ ([.,;:!?])/g, "$1")
      .trim()
  );
}

// Clips at a word boundary when one is close, always within `maxLength`.
export function clipText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  const hardLimit: number = Math.max(1, maxLength - 1);
  const slice: string = text.slice(0, hardLimit);
  const lastSpace: number = slice.lastIndexOf(" ");
  const clipped: string =
    lastSpace >= Math.floor(hardLimit * 0.6)
      ? slice.slice(0, lastSpace)
      : slice;

  return `${clipped.replace(/[\s.,;:!?—–-]+$/, "")}…`;
}

/*
 * What the incident/alert header shows for a completed report: the AI TL;DR
 * when there is one, otherwise the report's own Summary as plain text. Null
 * when there is neither.
 */
export function getInvestigationReportSummaryText(data: {
  analysisTldr: string | null | undefined;
  report: ParsedInvestigationReport | null | undefined;
}): string | null {
  const tldr: string =
    typeof data.analysisTldr === "string"
      ? data.analysisTldr.replace(/\s+/g, " ").trim()
      : "";

  if (tldr) {
    return clipText(tldr, MAX_REPORT_SUMMARY_LENGTH);
  }

  const summary: string = data.report?.summary
    ? markdownToPlainText(data.report.summary)
    : "";

  return summary ? clipText(summary, MAX_REPORT_SUMMARY_LENGTH) : null;
}
