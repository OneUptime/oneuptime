import OneUptimeDate from "../../../Types/Date";
import {
  AI_ACTION_ARGUMENTS_KEPT_BY_ONEUPTIME,
  AIChatWidget,
  AIChatWidgetColumn,
  AIChatWidgetSpan,
  AIChatWidgetStat,
  AIChatWidgetType,
  isAIChatReadResourceCard,
} from "../../../Types/AI/AIChatTypes";
import {
  AIActionCardFact,
  isAIActionMoment,
  isKnownAIActionCardWords,
} from "../../../Types/AI/AIActionWords";
import {
  getFactsNotInHeading,
  ResourceCardFact,
} from "../../../Types/AI/ResourceCardFacts";
import { JSONObject } from "../../../Types/JSON";
import {
  TableDateTexts,
  getTableDateTexts,
} from "../../Components/Table/TableDate";
import {
  getReaderNumberLocale,
  inEnglishDates,
} from "../../../Types/DateLanguage";

/*
 * The formatting rules the AI chat widgets use on screen, factored out so the
 * markdown and PDF exports render the same numbers, dates and captions the user
 * actually saw. Every helper here mirrors a specific widget component; where a
 * component does something surprising (0 rendering as "0" rather than a dash,
 * a string "1234" not getting thousands separators while the number 1234 does)
 * the behavior is reproduced deliberately rather than tidied up, so an export
 * never disagrees with the chat it came from.
 *
 * These run in the browser, so toLocaleString() and moment resolve against the
 * same locale and timezone the chat rendered in.
 */

// Display caps applied by the widget components themselves.
export const MAX_TABLE_ROWS: number = 25; // DataTableWidget
export const MAX_ENTITY_ITEMS: number = 12; // EntityListWidget
export const MAX_SPANS: number = 40; // TraceWaterfallWidget

// EntityListWidget.toStr
export function toDisplayString(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

// EntityListWidget.timeAgo
export function toTimeAgo(value: unknown): string {
  if (!value) {
    return "";
  }
  try {
    return OneUptimeDate.fromNow(OneUptimeDate.fromString(value as string));
  } catch {
    return "";
  }
}

// What a chat table's cell shows, and what it says under the pointer.
export interface ChatTableCellText {
  text: string;
  fullText: string;
  // A date's moment, for the cell's <time>; undefined for anything else.
  dateTime?: string | undefined;
}

// A value that is not a date the formatters can write is shown as it came.
function readDate(value: unknown): Date | null {
  if (typeof value !== "string" && !(value instanceof Date)) {
    return null;
  }

  try {
    const date: Date = OneUptimeDate.fromString(value);

    return isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
}

/*
 * DataTableWidget's cell. A date is written as every table writes one -
 * "Oct 14, 11:57 AM", its year only when it is not this year's, no zone
 * (Table/TableDate) - and whole under the pointer, with how long ago it
 * was: "Oct 14 2026, 11:57 AM GMT · 3 minutes ago". The whole of it in the
 * cell took a third of the chat panel, and its year and zone said the same
 * on every row.
 */
export function getChatTableCellText(
  value: unknown,
  column: AIChatWidgetColumn,
): ChatTableCellText {
  if (value === null || value === undefined || value === "") {
    return { text: "—", fullText: "—" };
  }

  if (column.type === "date") {
    const date: Date | null = readDate(value);
    const texts: TableDateTexts | null = date
      ? getTableDateTexts({ value: date })
      : null;

    if (date && texts) {
      return {
        text: texts.text,
        fullText: `${texts.fullText} · ${OneUptimeDate.fromNow(date)}`,
        dateTime: texts.isoText,
      };
    }

    return { text: String(value), fullText: String(value) };
  }

  if (column.type === "number" && typeof value === "number") {
    const text: string = value.toLocaleString(getReaderNumberLocale());

    return { text, fullText: text };
  }

  return { text: String(value), fullText: String(value) };
}

/*
 * The most letters a word of a table cell keeps whole on a narrow screen
 * (issue #6969): "Operational", "Investigating", "Kubernetes". A longer
 * one - an id, a host name - has nothing to wrap at, and whole it would
 * push the table's other columns out of view, so it may break anywhere.
 * A word wraps after each of its hyphens anyway, so its longest part
 * between them is what counts ("legacy-payments-api").
 */
export const CHAT_TABLE_WHOLE_WORD_LENGTH: number = 16;

// A cell's text between its spaces, the spaces kept.
const CHAT_TABLE_SPACES: RegExp = /(\s+)/;

// Where a word may wrap on its own: after each hyphen.
const CHAT_TABLE_WORD_HYPHEN: string = "-";

/*
 * What makes a word a path, as an endpoint, a URL or a file has one: a
 * slash ("/ledger/entries", "C:\Windows\System32"). A path may break
 * anywhere however short its parts, and wraps after its slashes first
 * (getChatTableWordParts). Kept whole, "POST /ledger/entries" was as wide
 * as a long word, and a phone's table of endpoints no longer fit its card.
 * A short one ("N/A") never breaks: a text column is at least 5rem wide.
 */
const CHAT_TABLE_PATH_SLASHES: ReadonlyArray<string> = ["/", "\\"];

function isChatTablePathSlash(letter: string | undefined): boolean {
  return letter !== undefined && CHAT_TABLE_PATH_SLASHES.includes(letter);
}

// Whether a word of a cell may break anywhere: a path, or a word too long to keep whole.
function mayBreakAnywhere(word: string): boolean {
  const isPath: boolean = CHAT_TABLE_PATH_SLASHES.some(
    (slash: string): boolean => {
      return word.includes(slash);
    },
  );

  return (
    isPath ||
    word.split(CHAT_TABLE_WORD_HYPHEN).some((wrapsAlone: string): boolean => {
      // Letters as a person counts them, not UTF-16 units.
      return Array.from(wrapsAlone).length > CHAT_TABLE_WHOLE_WORD_LENGTH;
    })
  );
}

// A run of a table cell's text, and whether it may break between any two letters.
export interface ChatTableCellPiece {
  text: string;
  breaksAnywhere: boolean;
}

/*
 * A text cell of DataTableWidget in runs (issue #6969): its words of up to
 * CHAT_TABLE_WHOLE_WORD_LENGTH letters - between hyphens - kept whole,
 * which the cell breaks only when one is wider than the whole column, and
 * each longer word, or path, on its own, which may break anywhere.
 * Breaking every word anywhere let a phone's table make a column narrower
 * than its words, and "Operational" was drawn as "Operationa" and "l".
 */
export function getChatTableCellPieces(
  text: string,
): Array<ChatTableCellPiece> {
  const pieces: Array<ChatTableCellPiece> = [];

  // Split at its spaces, kept: a word, then the spaces after it, by turns.
  const parts: Array<string> = text.split(CHAT_TABLE_SPACES);

  for (let index: number = 0; index < parts.length; index++) {
    const part: string = parts[index]!;

    if (!part) {
      continue;
    }

    const isSpace: boolean = index % 2 === 1;
    const breaksAnywhere: boolean = !isSpace && mayBreakAnywhere(part);
    const last: ChatTableCellPiece | undefined = pieces[pieces.length - 1];

    if (last && !last.breaksAnywhere && !breaksAnywhere) {
      last.text += part;
    } else {
      pieces.push({ text: part, breaksAnywhere });
    }
  }

  return pieces;
}

// The dot of a dotted name, "payments.example.com", which it may wrap before.
const CHAT_TABLE_NAME_DOT: string = ".";

// A letter of any script: what a name after a dot starts with.
const CHAT_TABLE_LETTER: RegExp = /^\p{L}$/u;

// A letter or a digit of any script: what a name before a dot ends with.
const CHAT_TABLE_LETTER_OR_DIGIT: RegExp = /^[\p{L}\p{N}]$/u;

/*
 * Whether the dot at a place in a word starts a name of a dotted one - a
 * host's "payments.example.com" - so the word may wrap before it: a dot
 * between a name's last letter or digit and the next name's first letter.
 * Never a number's ("10.0.12.34", "3.14"), a run of dots, or one at either
 * end. Letters as a person counts them: an emoji is never half read.
 */
function isChatTableNameDot(word: string, index: number): boolean {
  if (word[index] !== CHAT_TABLE_NAME_DOT || index === 0) {
    return false;
  }

  const before: string | undefined = Array.from(
    word.slice(Math.max(0, index - 2), index),
  ).pop();
  const afterCode: number | undefined = word.codePointAt(index + 1);

  return (
    before !== undefined &&
    CHAT_TABLE_LETTER_OR_DIGIT.test(before) &&
    afterCode !== undefined &&
    CHAT_TABLE_LETTER.test(String.fromCodePoint(afterCode))
  );
}

/*
 * A word that may break anywhere, in the parts it wraps between first
 * (issue #6969): after each run of slashes inside it, so a path wraps as
 * "/api/", "v2/" and "checkout", and a part breaks only when it is wider
 * than the whole column. Broken anywhere, "/ledger/entries" was drawn as
 * "/ledger/en" and "tries". The slashes a word starts with stay with its
 * first part ("/api/"), and so do those after a colon, with the name after
 * them ("https://payments", "C:\Windows\"): alone on a line they say
 * nothing, and take a line of the three a cell shows.
 *
 * A dotted name wraps before each dot that starts a name in it, as a style
 * guide breaks a URL: a URL's host, after the two slashes that follow its
 * scheme or start the word ("https://payments", ".example", ".com/"), and
 * a word with no slash at all - a long host name. Broken anywhere, a
 * monitor named by its URL was drawn as "https://payments.ex" over
 * "ample.com/" at the panel's width. A path's other names keep their dots:
 * "charge.ts" never wraps before its ".ts". The parts put together are the
 * word.
 */
export function getChatTableWordParts(word: string): Array<string> {
  if (!word) {
    return [];
  }

  const parts: Array<string> = [];
  let start: number = 0;
  // Whether the part being read has a letter yet, not only slashes.
  let hasLetter: boolean = false;
  // Whether the name being read wraps before its dots: a word with no slash.
  let isDottedName: boolean = !CHAT_TABLE_PATH_SLASHES.some(
    (slash: string): boolean => {
      return word.includes(slash);
    },
  );

  // By UTF-16 unit: a slash and a dot are one, and never half of a pair.
  for (let index: number = 0; index < word.length; index++) {
    if (isChatTablePathSlash(word[index])) {
      continue;
    }

    if (isChatTablePathSlash(word[index - 1])) {
      // The letter before the run of slashes just read, if any.
      let before: number = index - 1;
      while (isChatTablePathSlash(word[before])) {
        before--;
      }

      /*
       * A URL's host is the name after two slashes or more, which follow
       * its scheme's colon or start the word: a path's names, each after
       * one slash, are not hosts.
       */
      isDottedName =
        index - 1 - before >= 2 && (before < 0 || word[before] === ":");

      if (hasLetter && word[before] !== ":") {
        parts.push(word.slice(start, index));
        start = index;
      }
    } else if (
      isDottedName &&
      index > start &&
      isChatTableNameDot(word, index)
    ) {
      parts.push(word.slice(start, index));
      start = index;
    }

    hasLetter = true;
  }

  parts.push(word.slice(start));

  return parts;
}

/*
 * A table cell in the markdown and PDF exports. A date is written whole -
 * "Oct 14 2026, 11:57 AM GMT" - as the chat says it under the pointer: a
 * document is read later and elsewhere, so it keeps the year and the zone
 * the chat's short form leaves out, and drops "3 minutes ago", which was
 * only true the moment it was exported.
 */
export function formatTableCell(
  value: unknown,
  column: AIChatWidgetColumn,
): string {
  if (value === null || value === undefined || value === "") {
    return "—";
  }
  if (column.type === "date") {
    const date: Date | null = readDate(value);
    const texts: TableDateTexts | null = date
      ? getTableDateTexts({ value: date })
      : null;

    return texts ? texts.fullText : String(value);
  }
  if (column.type === "number" && typeof value === "number") {
    return value.toLocaleString(getReaderNumberLocale());
  }
  return String(value);
}

/*
 * A resource card's facts as the exports write them: each once, as the
 * card draws them (Types/AI/ResourceCardFacts), and a moment - when an
 * on-call shift started, when it hands off - as the export writes its own
 * dates ("Oct 26 2026, 13:00 GMT"), never the ISO text the card stores for
 * them ("2026-10-26T13:00:00.000Z"), which the PDF printed as it was.
 *
 * A stored fact is a moment when the card's words say so at its place and
 * its stored English is that moment's ISO text: a card saved before words,
 * or one whose words are not ours, prints as stored.
 */
export function getExportedResourceCardFacts(
  widget: AIChatWidget,
): Array<ResourceCardFact> {
  const stored: Array<ResourceCardFact> = widget.data.fields || [];
  const words: Array<AIActionCardFact> = isKnownAIActionCardWords(
    widget.data.words,
    { isRead: isAIChatReadResourceCard(widget.data) },
  )
    ? widget.data.words.facts || []
    : [];

  const fields: Array<ResourceCardFact> = stored.map(
    (field: ResourceCardFact, index: number): ResourceCardFact => {
      const value: AIActionCardFact["value"] | undefined =
        words.length === stored.length ? words[index]?.value : undefined;

      if (!value || !isAIActionMoment(value) || value.moment !== field.value) {
        return field;
      }

      const moment: Date = new Date(value.moment);

      if (isNaN(moment.getTime())) {
        return field;
      }

      return {
        label: field.label,
        // The export is English throughout, in the reader's time zone.
        value: inEnglishDates((): string => {
          return OneUptimeDate.getDateAsLocalFormattedString(moment);
        }),
      };
    },
  );

  return getFactsNotInHeading({
    heading: widget.data.heading,
    subheading: widget.data.subheading,
    fields,
  });
}

// StatCardsWidget: the number/string union is discriminated at runtime.
export function formatStatValue(stat: AIChatWidgetStat): string {
  const value: string =
    typeof stat.value === "number"
      ? stat.value.toLocaleString(getReaderNumberLocale())
      : stat.value;
  return stat.unit ? `${value} ${stat.unit}` : value;
}

// ChartWidget.formatValue
export function formatChartValue(
  value: number,
  unit?: string | undefined,
): string {
  const rounded: number =
    Math.abs(value) >= 100 ? Math.round(value) : Math.round(value * 100) / 100;
  const text: string = rounded.toLocaleString(getReaderNumberLocale());
  return unit ? `${text} ${unit}` : text;
}

// ToolApprovalCard.argsPreview
export function formatToolArguments(args: JSONObject): string {
  const parts: Array<string> = [];
  for (const key of Object.keys(args)) {
    const value: unknown = args[key];
    if (value === undefined || value === null || value === "") {
      continue;
    }
    // What OneUptime keeps in an action for itself: nothing to read.
    if (AI_ACTION_ARGUMENTS_KEPT_BY_ONEUPTIME.includes(key)) {
      continue;
    }
    const valueString: string =
      typeof value === "object" ? JSON.stringify(value) : String(value);
    parts.push(
      `${key}: ${
        valueString.length > 80
          ? `${valueString.substring(0, 80)}…`
          : valueString
      }`,
    );
  }
  return parts.join("  ·  ");
}

/*
 * TraceWaterfallWidget: depth is the length of the parent chain, guarded
 * against cycles and runaway nesting exactly as the component guards it.
 */
export function computeSpanDepth(
  span: AIChatWidgetSpan,
  parentBySpanId: Map<string, string | undefined>,
): number {
  let depth: number = 0;
  let current: string | undefined = span.parentSpanId;
  const seen: Set<string> = new Set();
  while (current && parentBySpanId.has(current) && !seen.has(current)) {
    seen.add(current);
    depth++;
    current = parentBySpanId.get(current);
    if (depth > 12) {
      break;
    }
  }
  return depth;
}

export function buildParentBySpanId(
  spans: Array<AIChatWidgetSpan>,
): Map<string, string | undefined> {
  const parentBySpanId: Map<string, string | undefined> = new Map();
  for (const span of spans) {
    parentBySpanId.set(span.spanId, span.parentSpanId);
  }
  return parentBySpanId;
}

export interface SpanBarMetrics {
  leftPercent: number;
  widthPercent: number;
}

// TraceWaterfallWidget bar geometry, including its clamps.
export function computeSpanBar(
  span: AIChatWidgetSpan,
  totalDurationMs: number,
): SpanBarMetrics {
  const leftPercent: number = Math.min(
    99,
    (span.startOffsetMs / totalDurationMs) * 100,
  );
  const widthPercent: number = Math.max(
    1.5,
    Math.min(100 - leftPercent, (span.durationMs / totalDurationMs) * 100),
  );
  return { leftPercent: leftPercent, widthPercent: widthPercent };
}

// TraceWaterfallWidget floors the denominator so the division is always safe.
export function totalTraceDuration(widget: AIChatWidget): number {
  return Math.max(widget.data.totalDurationMs || 0, 1);
}

/*
 * The fields EntityListWidget actually reads off an item, per list type. The
 * component ignores everything else on the item, so the export does too.
 */
export interface EntityListEntry {
  heading: string;
  body: string;
  badges: Array<string>;
  footer: string;
}

export function toEntityListEntry(
  item: JSONObject,
  widgetType: AIChatWidgetType,
): EntityListEntry {
  if (widgetType === AIChatWidgetType.ExceptionList) {
    const badges: Array<string> = [
      `${toDisplayString(item["occurrences"]) || "0"}×`,
    ];
    if (item["isResolved"]) {
      badges.push("Resolved");
    }
    return {
      heading: toDisplayString(item["type"]) || "Exception",
      body: toDisplayString(item["message"]),
      badges: badges,
      footer: `Last seen ${toTimeAgo(item["lastSeenAt"])}`,
    };
  }

  const numberField: string =
    widgetType === AIChatWidgetType.AlertList
      ? toDisplayString(item["alertNumber"])
      : toDisplayString(item["incidentNumber"]);

  const badges: Array<string> = [];
  if (item["state"]) {
    badges.push(toDisplayString(item["state"]));
  }
  if (item["severity"]) {
    badges.push(toDisplayString(item["severity"]));
  }

  return {
    heading: `${numberField ? `#${numberField} · ` : ""}${toDisplayString(
      item["title"],
    )}`,
    body: item["description"] ? toDisplayString(item["description"]) : "",
    badges: badges,
    footer: item["createdAt"] ? `Created ${toTimeAgo(item["createdAt"])}` : "",
  };
}

export function isEntityListWidget(type: AIChatWidgetType): boolean {
  return (
    type === AIChatWidgetType.IncidentList ||
    type === AIChatWidgetType.AlertList ||
    type === AIChatWidgetType.ExceptionList
  );
}

export function isChartWidget(type: AIChatWidgetType): boolean {
  return (
    type === AIChatWidgetType.TimeSeriesChart ||
    type === AIChatWidgetType.BarChart
  );
}

/*
 * A chart point resolved for export. `x` keeps the raw value so the exporter
 * can label a category axis, while `date` is set only when the value actually
 * parses as a time.
 */
export interface ExportChartPoint {
  x: string;
  date: Date | undefined;
  y: number;
}

export interface ExportChartSeries {
  name: string;
  points: Array<ExportChartPoint>;
}

/*
 * Resolves a chart widget's series for export.
 *
 * Note this deliberately keeps the RAW points rather than reproducing the
 * on-screen bucketing. The chart component re-buckets points into intervals to
 * fit Recharts, and that pass is lossy in ways that are fine for a glanceable
 * chart but not for a downloaded record: it matches points to buckets by
 * formatted-label string equality and silently drops the misses, so a weekly
 * chart keeps roughly one point in seven and a monthly one can skip a month
 * outright. An export is the artifact people keep and audit, so it plots what
 * the tools actually returned. For the common case — the server already emits
 * one point per bucket — the two agree exactly.
 */
export function toExportChartSeries(
  widget: AIChatWidget,
): Array<ExportChartSeries> {
  const series: Array<ExportChartSeries> = [];

  for (const raw of widget.data.series || []) {
    const points: Array<ExportChartPoint> = [];
    for (const point of raw.points || []) {
      if (point.y === null || point.y === undefined) {
        continue;
      }
      let date: Date | undefined = undefined;
      try {
        const parsed: Date = OneUptimeDate.fromString(point.x);
        if (!isNaN(parsed.getTime())) {
          date = parsed;
        }
      } catch {
        date = undefined;
      }
      points.push({ x: point.x, date: date, y: point.y });
    }
    series.push({ name: raw.name, points: points });
  }

  return series;
}

export function chartHasData(series: Array<ExportChartSeries>): boolean {
  return series.some((item: ExportChartSeries) => {
    return item.points.length > 0;
  });
}

/*
 * True when every plotted point carries a real timestamp, which is what lets
 * the exporter lay out a proportional time axis instead of even categories.
 */
export function chartIsTimeBased(series: Array<ExportChartSeries>): boolean {
  let seen: boolean = false;
  for (const item of series) {
    for (const point of item.points) {
      if (!point.date) {
        return false;
      }
      seen = true;
    }
  }
  return seen;
}
