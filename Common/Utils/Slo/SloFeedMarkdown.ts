import SloStatus from "../../Types/ServiceLevelObjective/SloStatus";
import SloWindowType from "../../Types/ServiceLevelObjective/SloWindowType";
import { escapeMarkdownInline } from "../Markdown/MarkdownEscape";

/*
 * The words of the SLO feed.
 *
 * Every SLO feed item is written by server code - the SLO service hooks, the
 * burn rate rule service and the evaluation worker - but what it SAYS lives
 * here, in one module with no database, React or window import, for two
 * reasons:
 *
 *   - Safety. Feed items render without the markdown viewer's safe mode, and
 *     almost every value in them is user-controlled: SLO, monitor, rule, label
 *     and status names, descriptions, timezones. Everything that is not a
 *     number we computed goes through escapeMarkdownInline exactly once, here,
 *     so no caller can forget to and no caller can do it twice.
 *
 *   - Change detection. "What changed" is decided by comparing a row read
 *     before an update with the row read after it. That comparison has to
 *     agree with how the value is shown ("99.9%" -> "99.9%" is not a change,
 *     a label set in a different order is not a change), so the diff and the
 *     formatting sit side by side and are unit-tested together.
 */

export const SLO_FEED_NOT_SET_TEXT: string = "_not set_";
export const SLO_FEED_NONE_TEXT: string = "_none_";

/*
 * A description is free text of any length; the feed is a timeline, not an
 * editor. Long values are cut here and the full text stays one click away on
 * the SLO itself.
 */
const MAX_INLINE_TEXT_LENGTH: number = 160;

// Names listed inline in a single "Labels: a, b, c" style value.
const MAX_LISTED_NAMES: number = 10;

// Monitors named in the one-line summary of an attach/detach item.
const MAX_SUMMARY_MONITORS: number = 3;

// Monitors listed in More Information before collapsing into "and N more".
const MAX_DETAIL_MONITORS: number = 50;

export type SloFeedRow = Record<string, unknown>;

export interface SloFeedMarkdown {
  feedInfoInMarkdown: string;
  moreInformationInMarkdown: string;
}

/*
 * ---------------------------------------------------------------------------
 * Numbers and durations
 * ---------------------------------------------------------------------------
 */

export type FormatSloFeedNumberFunction = (
  value: number,
  maximumFractionDigits?: number,
) => string;

/*
 * Rounds for reading, never for deciding. "-0" is folded into "0" because a
 * budget that rounds to zero is not "negative zero percent" to anybody.
 */
export const formatSloFeedNumber: FormatSloFeedNumberFunction = (
  value: number,
  maximumFractionDigits: number = 2,
): string => {
  if (!Number.isFinite(value)) {
    return "0";
  }

  const factor: number = Math.pow(10, maximumFractionDigits);
  const rounded: number = Math.round(value * factor) / factor;

  return (Object.is(rounded, -0) ? 0 : rounded).toString();
};

export type FormatSloFeedPercentFunction = (
  value: number,
  maximumFractionDigits?: number,
) => string;

export const formatSloFeedPercent: FormatSloFeedPercentFunction = (
  value: number,
  maximumFractionDigits: number = 2,
): string => {
  return `${formatSloFeedNumber(value, maximumFractionDigits)}%`;
};

type PluralizeFunction = (count: string, singular: string) => string;

const pluralize: PluralizeFunction = (
  count: string,
  singular: string,
): string => {
  return `${count} ${count === "1" ? singular : `${singular}s`}`;
};

export type FormatSloFeedMinutesFunction = (minutes: number) => string;

/*
 * Burn rate windows are stored in minutes but thought about in hours and days
 * ("1 hour", "6 hours"), so a whole number of hours or days is shown as one.
 */
export const formatSloFeedMinutes: FormatSloFeedMinutesFunction = (
  minutes: number,
): string => {
  if (!Number.isFinite(minutes)) {
    return SLO_FEED_NOT_SET_TEXT;
  }

  if (minutes !== 0 && minutes % 1440 === 0) {
    return pluralize(formatSloFeedNumber(minutes / 1440), "day");
  }

  if (minutes !== 0 && minutes % 60 === 0) {
    return pluralize(formatSloFeedNumber(minutes / 60), "hour");
  }

  return pluralize(formatSloFeedNumber(minutes), "minute");
};

export type FormatSloFeedDurationFunction = (seconds: number) => string;

/*
 * An error budget in the unit a person would say it in: seconds only when it
 * really is seconds, minutes up to two hours, then hours, then days. The sign
 * is dropped - callers say "remaining" or "over budget" around it.
 */
export const formatSloFeedDuration: FormatSloFeedDurationFunction = (
  seconds: number,
): string => {
  const absoluteSeconds: number = Number.isFinite(seconds)
    ? Math.abs(seconds)
    : 0;

  if (absoluteSeconds < 60) {
    return pluralize(formatSloFeedNumber(absoluteSeconds, 0), "second");
  }

  if (absoluteSeconds < 2 * 60 * 60) {
    return pluralize(formatSloFeedNumber(absoluteSeconds / 60, 0), "minute");
  }

  if (absoluteSeconds < 48 * 60 * 60) {
    return pluralize(formatSloFeedNumber(absoluteSeconds / 3600, 1), "hour");
  }

  return pluralize(formatSloFeedNumber(absoluteSeconds / 86400, 1), "day");
};

/*
 * ---------------------------------------------------------------------------
 * Text and relations
 * ---------------------------------------------------------------------------
 */

export type FormatSloFeedTextFunction = (
  value: unknown,
  maximumLength?: number,
) => string;

/*
 * User text for the middle of a sentence: escaped, trimmed, and cut at a
 * length a timeline can carry. Cutting happens BEFORE escaping so an escape
 * sequence can never be split in half and leave a dangling backslash.
 */
export const formatSloFeedText: FormatSloFeedTextFunction = (
  value: unknown,
  maximumLength: number = MAX_INLINE_TEXT_LENGTH,
): string => {
  if (value === undefined || value === null) {
    return "";
  }

  const text: string = String(value).replace(/\s+/g, " ").trim();

  if (text.length <= maximumLength) {
    return escapeMarkdownInline(text);
  }

  return `${escapeMarkdownInline(text.substring(0, maximumLength).trimEnd())}…`;
};

type NormalizeIdFunction = (value: string) => string | null;

/*
 * Ids are uuids, and Postgres hands them back lower-case whatever case an API
 * caller wrote them in - so "the same monitor" must compare equal across both.
 */
const normalizeId: NormalizeIdFunction = (value: string): string | null => {
  const id: string = value.trim().toLowerCase();

  return id && id !== "[object object]" ? id : null;
};

type ToIdStringFunction = (value: unknown) => string | null;

const toIdString: ToIdStringFunction = (value: unknown): string | null => {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === "object") {
    const record: Record<string, unknown> = value as Record<string, unknown>;

    // A model row (`_id` string / `id` ObjectID) or a `{ _id }` payload stub.
    if (record["_id"] !== undefined && record["_id"] !== null) {
      return normalizeId(String(record["_id"]));
    }

    if (record["id"] !== undefined && record["id"] !== null) {
      return normalizeId(String(record["id"]));
    }
  }

  // A bare id string, or an ObjectID whose toString is the id.
  return normalizeId(String(value));
};

export type GetSloFeedEntityIdsFunction = (value: unknown) => Array<string>;

/*
 * The ids in a many-to-many value, whatever shape it arrived in: model rows
 * read from the database, `{ _id }` stubs from the dashboard form, bare id
 * strings or ObjectIDs from the API. Sorted and de-duplicated, so two sets
 * that differ only in order compare equal.
 */
export const getSloFeedEntityIds: GetSloFeedEntityIdsFunction = (
  value: unknown,
): Array<string> => {
  if (!Array.isArray(value)) {
    return [];
  }

  const ids: Set<string> = new Set<string>();

  for (const item of value) {
    const id: string | null = toIdString(item);

    if (id) {
      ids.add(id);
    }
  }

  return Array.from(ids).sort();
};

type GetEntityNameFunction = (item: unknown) => string;

const getEntityName: GetEntityNameFunction = (item: unknown): string => {
  if (!item || typeof item !== "object") {
    return "";
  }

  const record: Record<string, unknown> = item as Record<string, unknown>;

  // User.name is a Name value object, Label.name a string - both stringify.
  for (const key of ["name", "email"]) {
    const candidate: unknown = record[key];

    if (candidate !== undefined && candidate !== null) {
      const text: string = String(candidate).trim();

      if (text) {
        return text;
      }
    }
  }

  return "";
};

export type FormatSloFeedEntityNamesFunction = (value: unknown) => string;

/*
 * "Production, Tier 1" for a label set, alphabetical so the before and after
 * of an unchanged set read identically. A related row whose name could not be
 * read is still counted rather than silently dropped.
 */
export const formatSloFeedEntityNames: FormatSloFeedEntityNamesFunction = (
  value: unknown,
): string => {
  if (!Array.isArray(value) || value.length === 0) {
    return SLO_FEED_NONE_TEXT;
  }

  const names: Array<string> = value
    .map((item: unknown): string => {
      return getEntityName(item) || "Unnamed";
    })
    .sort((a: string, b: string): number => {
      return a.localeCompare(b);
    });

  const listed: Array<string> = names
    .slice(0, MAX_LISTED_NAMES)
    .map((name: string): string => {
      return formatSloFeedText(name, 80);
    });

  const remaining: number = names.length - listed.length;

  return remaining > 0
    ? `${listed.join(", ")} and ${remaining} more`
    : listed.join(", ");
};

export type NormalizeSloFeedBooleanFunction = (
  value: unknown,
) => boolean | null;

/*
 * The CRUD API does not coerce Boolean columns, so "false" can reach a hook as
 * a string. Anything that is not recognisably true or false is "not set".
 */
export const normalizeSloFeedBoolean: NormalizeSloFeedBooleanFunction = (
  value: unknown,
): boolean | null => {
  if (value === true || value === false) {
    return value;
  }

  if (typeof value === "string") {
    const normalized: string = value.trim().toLowerCase();

    if (normalized === "true" || normalized === "1") {
      return true;
    }

    if (normalized === "false" || normalized === "0") {
      return false;
    }

    return null;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  return null;
};

type NormalizeNumberFunction = (value: unknown) => number | null;

const normalizeNumber: NormalizeNumberFunction = (
  value: unknown,
): number | null => {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const numeric: number = typeof value === "number" ? value : Number(value);

  return Number.isFinite(numeric) ? numeric : null;
};

/*
 * ---------------------------------------------------------------------------
 * Column changes
 * ---------------------------------------------------------------------------
 */

export enum SloFeedValueKind {
  // Short user text shown in full (a name, a timezone, an enum value).
  Text = "Text",
  // Free text shown truncated, and never quoted in a one-line summary.
  LongText = "LongText",
  // Compared, never printed: templates and notes can be long markdown.
  Opaque = "Opaque",
  Percent = "Percent",
  Days = "Days",
  Minutes = "Minutes",
  // A burn rate multiple, e.g. 14.4x.
  Multiplier = "Multiplier",
  Count = "Count",
  Boolean = "Boolean",
  // A many-to-many relation selected as rows with a name.
  EntityList = "EntityList",
  // A foreign key column whose name is read from `relationProperty`.
  EntityReference = "EntityReference",
}

export interface SloFeedColumn {
  column: string;
  title: string;
  kind: SloFeedValueKind;
  // EntityReference only: the relation that carries the referenced row's name.
  relationProperty?: string | undefined;
  // What an unset value reads as, when "not set" would be misleading.
  emptyText?: string | undefined;
  // EntityList / EntityReference: columns to select on the related rows.
  relationSelect?: Record<string, true> | undefined;
}

export interface SloFeedColumnChange {
  column: string;
  title: string;
  kind: SloFeedValueKind;
  // null when there was no before-row to compare against.
  from: string | null;
  to: string;
}

const DEFAULT_RELATION_SELECT: Record<string, true> = {
  _id: true,
  name: true,
};

export type GetSloFeedColumnsInPayloadFunction = (
  data: unknown,
  columns: Array<SloFeedColumn>,
) => Array<SloFeedColumn>;

/*
 * The watched columns an update payload actually writes. A key present with
 * the value `undefined` writes nothing, so it does not count - otherwise a
 * form that spreads an object with an undefined field would cost a read and
 * post an item about a column it never touched.
 */
export const getSloFeedColumnsInPayload: GetSloFeedColumnsInPayloadFunction = (
  data: unknown,
  columns: Array<SloFeedColumn>,
): Array<SloFeedColumn> => {
  if (!data || typeof data !== "object") {
    return [];
  }

  const record: Record<string, unknown> = data as Record<string, unknown>;

  return columns.filter((column: SloFeedColumn): boolean => {
    return (
      Object.prototype.hasOwnProperty.call(record, column.column) &&
      record[column.column] !== undefined
    );
  });
};

export type GetSloFeedSelectFunction = (
  columns: Array<SloFeedColumn>,
) => Record<string, unknown>;

/*
 * The select for a before/after read of exactly the columns being watched,
 * with relation columns expanded to the fields the feed prints.
 */
export const getSloFeedSelect: GetSloFeedSelectFunction = (
  columns: Array<SloFeedColumn>,
): Record<string, unknown> => {
  const select: Record<string, unknown> = {};

  for (const column of columns) {
    if (column.kind === SloFeedValueKind.EntityList) {
      select[column.column] = {
        ...(column.relationSelect || DEFAULT_RELATION_SELECT),
      };
      continue;
    }

    select[column.column] = true;

    if (
      column.kind === SloFeedValueKind.EntityReference &&
      column.relationProperty
    ) {
      select[column.relationProperty] = {
        ...(column.relationSelect || DEFAULT_RELATION_SELECT),
      };
    }
  }

  return select;
};

export type IsSloFeedValueEqualFunction = (
  column: SloFeedColumn,
  before: SloFeedRow,
  after: SloFeedRow,
) => boolean;

export const isSloFeedValueEqual: IsSloFeedValueEqualFunction = (
  column: SloFeedColumn,
  before: SloFeedRow,
  after: SloFeedRow,
): boolean => {
  const beforeValue: unknown = before[column.column];
  const afterValue: unknown = after[column.column];

  switch (column.kind) {
    case SloFeedValueKind.EntityList:
      return (
        getSloFeedEntityIds(beforeValue).join(",") ===
        getSloFeedEntityIds(afterValue).join(",")
      );
    case SloFeedValueKind.EntityReference:
      return toIdString(beforeValue) === toIdString(afterValue);
    case SloFeedValueKind.Percent:
    case SloFeedValueKind.Days:
    case SloFeedValueKind.Minutes:
    case SloFeedValueKind.Multiplier:
    case SloFeedValueKind.Count:
      return normalizeNumber(beforeValue) === normalizeNumber(afterValue);
    case SloFeedValueKind.Boolean:
      return (
        normalizeSloFeedBoolean(beforeValue) ===
        normalizeSloFeedBoolean(afterValue)
      );
    default:
      // Text kinds: an empty string and a null are both "not set".
      return (
        String(beforeValue ?? "").trim() === String(afterValue ?? "").trim()
      );
  }
};

export type FormatSloFeedValueFunction = (
  column: SloFeedColumn,
  row: SloFeedRow,
) => string;

export const formatSloFeedValue: FormatSloFeedValueFunction = (
  column: SloFeedColumn,
  row: SloFeedRow,
): string => {
  const value: unknown = row[column.column];
  const emptyText: string = column.emptyText || SLO_FEED_NOT_SET_TEXT;

  switch (column.kind) {
    case SloFeedValueKind.EntityList:
      return formatSloFeedEntityNames(value);
    case SloFeedValueKind.EntityReference: {
      if (!toIdString(value)) {
        return emptyText;
      }

      const name: string = column.relationProperty
        ? getEntityName(row[column.relationProperty])
        : "";

      // The row is referenced but its name could not be read.
      return name ? formatSloFeedText(name, 80) : "_a deleted item_";
    }
    case SloFeedValueKind.Boolean: {
      const flag: boolean | null = normalizeSloFeedBoolean(value);

      if (flag === null) {
        return emptyText;
      }

      return flag ? "On" : "Off";
    }
    case SloFeedValueKind.Percent:
    case SloFeedValueKind.Days:
    case SloFeedValueKind.Minutes:
    case SloFeedValueKind.Multiplier:
    case SloFeedValueKind.Count: {
      const numeric: number | null = normalizeNumber(value);

      if (numeric === null) {
        return emptyText;
      }

      if (column.kind === SloFeedValueKind.Percent) {
        return formatSloFeedPercent(numeric, 3);
      }

      if (column.kind === SloFeedValueKind.Days) {
        return pluralize(formatSloFeedNumber(numeric), "day");
      }

      if (column.kind === SloFeedValueKind.Minutes) {
        return formatSloFeedMinutes(numeric);
      }

      if (column.kind === SloFeedValueKind.Multiplier) {
        return `${formatSloFeedNumber(numeric)}x`;
      }

      return formatSloFeedNumber(numeric);
    }
    case SloFeedValueKind.Opaque:
      return String(value ?? "").trim() ? "_set_" : emptyText;
    default: {
      const text: string = formatSloFeedText(value);

      return text || emptyText;
    }
  }
};

export type GetSloFeedColumnChangesFunction = (data: {
  columns: Array<SloFeedColumn>;
  before: SloFeedRow | null;
  after: SloFeedRow;
}) => Array<SloFeedColumnChange>;

/*
 * The changes worth telling somebody about. With a before-row, a column whose
 * value did not actually change is dropped - a settings form re-submits every
 * field it shows, and "Target: 99.9% -> 99.9%" is noise. Without one (the
 * before-read failed, or the write path deliberately takes none), every
 * written column is reported with its new value only.
 */
export const getSloFeedColumnChanges: GetSloFeedColumnChangesFunction = (data: {
  columns: Array<SloFeedColumn>;
  before: SloFeedRow | null;
  after: SloFeedRow;
}): Array<SloFeedColumnChange> => {
  const changes: Array<SloFeedColumnChange> = [];

  for (const column of data.columns) {
    if (data.before && isSloFeedValueEqual(column, data.before, data.after)) {
      continue;
    }

    changes.push({
      column: column.column,
      title: column.title,
      kind: column.kind,
      from: data.before ? formatSloFeedValue(column, data.before) : null,
      to: formatSloFeedValue(column, data.after),
    });
  }

  return changes;
};

type JoinTitlesFunction = (titles: Array<string>) => string;

// "**A**", "**A** and **B**", "**A**, **B** and **C**".
const joinTitles: JoinTitlesFunction = (titles: Array<string>): string => {
  const bold: Array<string> = titles.map((title: string): string => {
    return `**${title}**`;
  });

  if (bold.length <= 1) {
    return bold.join("");
  }

  return `${bold.slice(0, -1).join(", ")} and ${bold[bold.length - 1]}`;
};

type FormatChangeLineFunction = (change: SloFeedColumnChange) => string;

const formatChangeLine: FormatChangeLineFunction = (
  change: SloFeedColumnChange,
): string => {
  if (change.kind === SloFeedValueKind.Opaque) {
    return `**${change.title}**: changed`;
  }

  if (change.from === null) {
    return `**${change.title}**: ${change.to}`;
  }

  return `**${change.title}**: ${change.from} → ${change.to}`;
};

type FormatChangeSummaryFunction = (
  changes: Array<SloFeedColumnChange>,
) => string;

/*
 * A single short change is spelled out in the one-line summary, so the
 * timeline answers "what changed" without opening anything. Several changes,
 * or a long one, are named in the summary and spelled out in More Information.
 */
const formatChangeSummary: FormatChangeSummaryFunction = (
  changes: Array<SloFeedColumnChange>,
): string => {
  const onlyChange: SloFeedColumnChange | undefined =
    changes.length === 1 ? changes[0] : undefined;

  if (
    onlyChange &&
    onlyChange.kind !== SloFeedValueKind.LongText &&
    onlyChange.kind !== SloFeedValueKind.Opaque
  ) {
    return onlyChange.from === null
      ? `**${onlyChange.title}** set to ${onlyChange.to}`
      : `**${onlyChange.title}** changed from ${onlyChange.from} to ${onlyChange.to}`;
  }

  return `${joinTitles(
    changes.map((change: SloFeedColumnChange): string => {
      return change.title;
    }),
  )} changed`;
};

/*
 * ---------------------------------------------------------------------------
 * SLO lifecycle items
 * ---------------------------------------------------------------------------
 */

/*
 * The SLO columns whose edit earns a "was updated" item. A whitelist, never a
 * blacklist: the evaluation worker writes this row on every tick (SLI, budget,
 * burn rate, status, cadence stamps) and a blacklist would let the next worker
 * column added to the model post an item every few minutes per SLO.
 *
 * isEnabled / isArchived and the monitor set are watched too, but get items
 * of their own (see SLO_FEED_WATCHED_COLUMN_NAMES).
 */
export const SLO_FEED_UPDATE_COLUMNS: Array<SloFeedColumn> = [
  { column: "name", title: "Name", kind: SloFeedValueKind.Text },
  {
    column: "description",
    title: "Description",
    kind: SloFeedValueKind.LongText,
  },
  { column: "labels", title: "Labels", kind: SloFeedValueKind.EntityList },
  {
    column: "targetPercentage",
    title: "Target",
    kind: SloFeedValueKind.Percent,
  },
  {
    column: "windowType",
    title: "Compliance window",
    kind: SloFeedValueKind.Text,
  },
  {
    column: "windowDays",
    title: "Rolling window length",
    kind: SloFeedValueKind.Days,
  },
  {
    column: "timezone",
    title: "Timezone",
    kind: SloFeedValueKind.Text,
    emptyText: "UTC (default)",
  },
  {
    column: "atRiskThresholdPercentage",
    title: "At-risk threshold",
    kind: SloFeedValueKind.Percent,
    emptyText: "_default_",
  },
  {
    column: "multiMonitorMode",
    title: "Multi-monitor mode",
    kind: SloFeedValueKind.Text,
  },
  {
    column: "downtimeMonitorStatuses",
    title: "Downtime monitor statuses",
    kind: SloFeedValueKind.EntityList,
  },
];

export const SLO_FEED_IS_ENABLED_COLUMN: SloFeedColumn = {
  column: "isEnabled",
  title: "Enabled",
  kind: SloFeedValueKind.Boolean,
};

export const SLO_FEED_IS_ARCHIVED_COLUMN: SloFeedColumn = {
  column: "isArchived",
  title: "Archived",
  kind: SloFeedValueKind.Boolean,
};

export const SLO_FEED_MONITORS_COLUMN: SloFeedColumn = {
  column: "monitors",
  title: "Monitors",
  kind: SloFeedValueKind.EntityList,
};

export type GetSloFeedWatchedColumnsFunction = (data: {
  payload: unknown;
  // Only hand-made monitor edits are this feed's to describe - see the caller.
  includeMonitors: boolean;
}) => Array<SloFeedColumn>;

export const getSloFeedWatchedColumns: GetSloFeedWatchedColumnsFunction =
  (data: {
    payload: unknown;
    includeMonitors: boolean;
  }): Array<SloFeedColumn> => {
    const watched: Array<SloFeedColumn> = [
      ...SLO_FEED_UPDATE_COLUMNS,
      SLO_FEED_IS_ENABLED_COLUMN,
      SLO_FEED_IS_ARCHIVED_COLUMN,
    ];

    if (data.includeMonitors) {
      watched.push(SLO_FEED_MONITORS_COLUMN);
    }

    return getSloFeedColumnsInPayload(data.payload, watched);
  };

export interface SloFeedBurnRateRuleSummary {
  name?: string | undefined;
  burnRateThreshold?: number | undefined;
  longWindowInMinutes?: number | undefined;
  shortWindowInMinutes?: number | undefined;
}

type DescribeBurnRateConditionFunction = (
  rule: SloFeedBurnRateRuleSummary,
) => string | null;

// "above 14.4x over 1 hour, confirmed over 5 minutes".
const describeBurnRateCondition: DescribeBurnRateConditionFunction = (
  rule: SloFeedBurnRateRuleSummary,
): string | null => {
  const threshold: number | null = normalizeNumber(rule.burnRateThreshold);
  const longWindow: number | null = normalizeNumber(rule.longWindowInMinutes);
  const shortWindow: number | null = normalizeNumber(rule.shortWindowInMinutes);

  if (threshold === null || longWindow === null) {
    return null;
  }

  const confirmation: string =
    shortWindow === null
      ? ""
      : `, confirmed over ${formatSloFeedMinutes(shortWindow)}`;

  return `burn rate above ${formatSloFeedNumber(threshold)}x over ${formatSloFeedMinutes(longWindow)}${confirmation}`;
};

export type DescribeSloFeedWindowFunction = (data: {
  windowType?: SloWindowType | string | undefined | null;
  windowDays?: number | undefined | null;
  timezone?: string | undefined | null;
}) => string;

export const describeSloFeedWindow: DescribeSloFeedWindowFunction = (data: {
  windowType?: SloWindowType | string | undefined | null;
  windowDays?: number | undefined | null;
  timezone?: string | undefined | null;
}): string => {
  if (data.windowType === SloWindowType.CalendarMonth) {
    const timezone: string = formatSloFeedText(data.timezone) || "UTC";

    return `Calendar month (${timezone})`;
  }

  const windowDays: number | null = normalizeNumber(data.windowDays);

  // The worker measures a rolling window with no length as 30 days.
  return `Rolling ${pluralize(formatSloFeedNumber(windowDays ?? 30), "day")}`;
};

export type GetSloCreatedFeedMarkdownFunction = (data: {
  sloMarkdownLink: string;
  // Already-safe markdown for the creating user, or null for no user.
  createdByUserMarkdown: string | null;
  targetPercentage?: number | undefined | null;
  windowType?: SloWindowType | string | undefined | null;
  windowDays?: number | undefined | null;
  timezone?: string | undefined | null;
  sliType?: string | undefined | null;
  atRiskThresholdPercentage?: number | undefined | null;
  description?: string | undefined | null;
  defaultBurnRateRules: Array<SloFeedBurnRateRuleSummary>;
}) => SloFeedMarkdown;

export const getSloCreatedFeedMarkdown: GetSloCreatedFeedMarkdownFunction =
  (data: {
    sloMarkdownLink: string;
    createdByUserMarkdown: string | null;
    targetPercentage?: number | undefined | null;
    windowType?: SloWindowType | string | undefined | null;
    windowDays?: number | undefined | null;
    timezone?: string | undefined | null;
    sliType?: string | undefined | null;
    atRiskThresholdPercentage?: number | undefined | null;
    description?: string | undefined | null;
    defaultBurnRateRules: Array<SloFeedBurnRateRuleSummary>;
  }): SloFeedMarkdown => {
    const details: Array<string> = [
      data.createdByUserMarkdown
        ? `**Created by**: ${data.createdByUserMarkdown}`
        : "**Created by**: No user - it was created through the OneUptime API or by an automation.",
    ];

    const target: number | null = normalizeNumber(data.targetPercentage);

    if (target !== null) {
      details.push(`**Target**: ${formatSloFeedPercent(target, 3)}`);
    }

    details.push(`**Compliance window**: ${describeSloFeedWindow(data)}`);

    if (data.sliType) {
      details.push(`**SLI**: ${formatSloFeedText(data.sliType)}`);
    }

    const atRisk: number | null = normalizeNumber(
      data.atRiskThresholdPercentage,
    );

    if (atRisk !== null) {
      details.push(
        `**At-risk threshold**: ${formatSloFeedPercent(atRisk)} of the error budget remaining`,
      );
    }

    /*
     * The two default rules are part of what "creating an SLO" means, so they
     * are described here rather than as two more items that would bury the
     * creation under its own bookkeeping.
     */
    const rules: Array<string> = data.defaultBurnRateRules.map(
      (rule: SloFeedBurnRateRuleSummary): string => {
        const name: string = formatSloFeedText(rule.name) || "Unnamed rule";
        const condition: string | null = describeBurnRateCondition(rule);

        return condition ? `${name} (${condition})` : name;
      },
    );

    if (rules.length > 0) {
      details.push(`**Default burn rate rules**: ${rules.join("; ")}`);
    }

    const description: string = formatSloFeedText(data.description);

    if (description) {
      details.push(`**Description**: ${description}`);
    }

    return {
      feedInfoInMarkdown: data.createdByUserMarkdown
        ? `🎯 ${data.sloMarkdownLink} was created by **${data.createdByUserMarkdown}**.`
        : `🎯 ${data.sloMarkdownLink} was created.`,
      moreInformationInMarkdown: details.join("\n\n"),
    };
  };

export type GetSloUpdatedFeedMarkdownFunction = (data: {
  sloMarkdownLink: string;
  changes: Array<SloFeedColumnChange>;
}) => SloFeedMarkdown;

export const getSloUpdatedFeedMarkdown: GetSloUpdatedFeedMarkdownFunction =
  (data: {
    sloMarkdownLink: string;
    changes: Array<SloFeedColumnChange>;
  }): SloFeedMarkdown => {
    return {
      feedInfoInMarkdown: `📝 ${data.sloMarkdownLink} was updated: ${formatChangeSummary(data.changes)}.`,
      moreInformationInMarkdown: data.changes
        .map(formatChangeLine)
        .join("\n\n"),
    };
  };

export type GetSloEnabledFeedMarkdownFunction = (data: {
  sloMarkdownLink: string;
  isEnabled: boolean;
  isArchived: boolean;
}) => SloFeedMarkdown;

export const getSloEnabledFeedMarkdown: GetSloEnabledFeedMarkdownFunction =
  (data: {
    sloMarkdownLink: string;
    isEnabled: boolean;
    isArchived: boolean;
  }): SloFeedMarkdown => {
    if (data.isEnabled) {
      return {
        feedInfoInMarkdown: `▶️ ${data.sloMarkdownLink} was enabled.`,
        moreInformationInMarkdown: data.isArchived
          ? "The SLO is still archived, so it stays out of evaluation until it is restored from the archive."
          : "Evaluation resumes on the next worker tick, which recalculates the SLI, error budget and status.",
      };
    }

    return {
      feedInfoInMarkdown: `⏸️ ${data.sloMarkdownLink} was disabled.`,
      moreInformationInMarkdown:
        "A disabled SLO is not evaluated: its SLI, error budget and status stop updating and its burn rate rules do not fire. Any burn rate alerts and incidents its rules had open were resolved.",
    };
  };

export type GetSloArchivedFeedMarkdownFunction = (data: {
  sloMarkdownLink: string;
  isArchived: boolean;
  isEnabled: boolean;
}) => SloFeedMarkdown;

export const getSloArchivedFeedMarkdown: GetSloArchivedFeedMarkdownFunction =
  (data: {
    sloMarkdownLink: string;
    isArchived: boolean;
    isEnabled: boolean;
  }): SloFeedMarkdown => {
    if (data.isArchived) {
      return {
        feedInfoInMarkdown: `🗄️ ${data.sloMarkdownLink} was archived.`,
        moreInformationInMarkdown:
          "Archived SLOs are hidden from the SLO list and are not evaluated. Any burn rate alerts and incidents its rules had open were resolved.",
      };
    }

    return {
      feedInfoInMarkdown: `♻️ ${data.sloMarkdownLink} was restored from the archive.`,
      moreInformationInMarkdown: data.isEnabled
        ? "The SLO is back on the SLO list and is evaluated again from the next worker tick."
        : "The SLO is back on the SLO list. It is still disabled, so it is not evaluated until it is enabled.",
    };
  };

export interface SloFeedMonitorReference {
  name: string;
  // Absolute dashboard URL of the monitor.
  link: string;
}

export type GetSloMonitorsChangedFeedMarkdownFunction = (data: {
  sloMarkdownLink: string;
  monitors: Array<SloFeedMonitorReference>;
  change: "attached" | "detached";
}) => SloFeedMarkdown;

export const getSloMonitorsChangedFeedMarkdown: GetSloMonitorsChangedFeedMarkdownFunction =
  (data: {
    sloMarkdownLink: string;
    monitors: Array<SloFeedMonitorReference>;
    change: "attached" | "detached";
  }): SloFeedMarkdown => {
    const sorted: Array<SloFeedMonitorReference> = [...data.monitors].sort(
      (a: SloFeedMonitorReference, b: SloFeedMonitorReference): number => {
        return a.name.localeCompare(b.name);
      },
    );

    const links: Array<string> = sorted.map(
      (monitor: SloFeedMonitorReference): string => {
        const name: string =
          formatSloFeedText(monitor.name, 80) || "Unnamed monitor";

        return `[${name}](${monitor.link})`;
      },
    );

    const emoji: string = data.change === "attached" ? "🔗" : "✂️";
    const preposition: string = data.change === "attached" ? "to" : "from";

    let feedInfoInMarkdown: string;

    if (links.length === 1) {
      feedInfoInMarkdown = `${emoji} Monitor ${links[0]} was ${data.change} ${preposition} ${data.sloMarkdownLink}.`;
    } else {
      const named: Array<string> = links.slice(0, MAX_SUMMARY_MONITORS);
      const unnamed: number = links.length - named.length;

      feedInfoInMarkdown = `${emoji} ${links.length} monitors were ${data.change} ${preposition} ${data.sloMarkdownLink}: ${named.join(", ")}${unnamed > 0 ? ` and ${unnamed} more` : ""}.`;
    }

    const listed: Array<string> = links.slice(0, MAX_DETAIL_MONITORS);
    const remaining: number = links.length - listed.length;

    const lines: Array<string> = [
      `**Monitors ${data.change}**:`,
      listed
        .map((link: string): string => {
          return `- ${link}`;
        })
        .join("\n") + (remaining > 0 ? `\n- and ${remaining} more` : ""),
      "The SLO is measured against its new monitor set from the next worker tick.",
    ];

    return {
      feedInfoInMarkdown: feedInfoInMarkdown,
      moreInformationInMarkdown: lines.join("\n\n"),
    };
  };

/*
 * ---------------------------------------------------------------------------
 * Status transitions (evaluation worker)
 * ---------------------------------------------------------------------------
 */

export type GetSloStatusEmojiFunction = (status: SloStatus) => string;

export const getSloStatusEmoji: GetSloStatusEmojiFunction = (
  status: SloStatus,
): string => {
  switch (status) {
    case SloStatus.Healthy:
      return "🟢";
    case SloStatus.AtRisk:
      return "🟡";
    case SloStatus.BudgetExhausted:
      return "🔴";
    case SloStatus.Paused:
      return "⏸️";
    default:
      return "⚠️";
  }
};

export interface SloFeedStatusMeasurement {
  sliPercentage: number;
  targetPercentage: number;
  errorBudgetRemainingPercentage: number;
  errorBudgetRemainingSeconds: number;
  currentBurnRate: number;
  currentBurnRateWindowInMinutes: number;
  atRiskThresholdPercentage: number;
}

export type GetSloStatusChangedFeedMarkdownFunction = (data: {
  sloMarkdownLink: string;
  // The status before this transition; unset for an SLO never evaluated.
  previousStatus?: SloStatus | undefined | null;
  newStatus: SloStatus;
  // A real measurement (the evaluation path) ...
  measurement?: SloFeedStatusMeasurement | undefined;
  // ... or why there is none (the Paused / Misconfigured guards).
  reason?: string | undefined;
}) => SloFeedMarkdown;

export const getSloStatusChangedFeedMarkdown: GetSloStatusChangedFeedMarkdownFunction =
  (data: {
    sloMarkdownLink: string;
    previousStatus?: SloStatus | undefined | null;
    newStatus: SloStatus;
    measurement?: SloFeedStatusMeasurement | undefined;
    reason?: string | undefined;
  }): SloFeedMarkdown => {
    const details: Array<string> = [
      `**Status**: ${data.previousStatus || "Not evaluated yet"} → ${data.newStatus}`,
    ];

    if (data.reason) {
      details.push(`**Why**: ${data.reason}`);
    }

    if (data.measurement) {
      const measurement: SloFeedStatusMeasurement = data.measurement;

      /*
       * Four decimals on the SLI: targets go to 99.999, and an SLI that rounds
       * UP to its own target would read as healthy when it is not.
       */
      details.push(
        `**SLI**: ${formatSloFeedPercent(measurement.sliPercentage, 4)} against a ${formatSloFeedPercent(measurement.targetPercentage, 3)} target`,
      );

      const budgetDuration: string = formatSloFeedDuration(
        measurement.errorBudgetRemainingSeconds,
      );

      details.push(
        measurement.errorBudgetRemainingSeconds < 0
          ? `**Error budget remaining**: ${formatSloFeedPercent(measurement.errorBudgetRemainingPercentage)} (over budget by ${budgetDuration})`
          : `**Error budget remaining**: ${formatSloFeedPercent(measurement.errorBudgetRemainingPercentage)} (${budgetDuration})`,
      );

      details.push(
        `**Current burn rate**: ${formatSloFeedNumber(measurement.currentBurnRate)}x over the last ${formatSloFeedMinutes(measurement.currentBurnRateWindowInMinutes)}`,
      );

      details.push(
        `**At-risk threshold**: ${formatSloFeedPercent(measurement.atRiskThresholdPercentage)} of the error budget remaining`,
      );
    }

    if (
      data.newStatus === SloStatus.Paused ||
      data.newStatus === SloStatus.Misconfigured
    ) {
      details.push(
        `While the SLO is ${data.newStatus}, its SLI and error budget are not recalculated and its burn rate rules do not fire. Any burn rate alerts and incidents its rules had open were resolved.`,
      );
    }

    const was: string = data.previousStatus
      ? ` (was ${data.previousStatus})`
      : "";

    return {
      feedInfoInMarkdown: `${getSloStatusEmoji(data.newStatus)} ${data.sloMarkdownLink} is now **${data.newStatus}**${was}.`,
      moreInformationInMarkdown: details.join("\n\n"),
    };
  };

/*
 * ---------------------------------------------------------------------------
 * Burn rate rules
 * ---------------------------------------------------------------------------
 */

const USER_RELATION_SELECT: Record<string, true> = {
  _id: true,
  name: true,
  email: true,
};

/*
 * The burn rate rule columns whose edit earns a "changed" item. A whitelist
 * for the same reason as the SLO's: the evaluation worker stamps the rule's
 * lifecycle columns (lastAlertCreatedAt and friends) through the hooked update
 * path every time it fires or resolves.
 */
export const SLO_BURN_RATE_RULE_FEED_COLUMNS: Array<SloFeedColumn> = [
  { column: "name", title: "Name", kind: SloFeedValueKind.Text },
  { column: "isEnabled", title: "Enabled", kind: SloFeedValueKind.Boolean },
  {
    column: "burnRateThreshold",
    title: "Burn rate threshold",
    kind: SloFeedValueKind.Multiplier,
  },
  {
    column: "longWindowInMinutes",
    title: "Long window",
    kind: SloFeedValueKind.Minutes,
  },
  {
    column: "shortWindowInMinutes",
    title: "Short window",
    kind: SloFeedValueKind.Minutes,
  },
  {
    column: "refireSuppressionMinutes",
    title: "Re-fire suppression",
    kind: SloFeedValueKind.Minutes,
    emptyText: "_default_",
  },
  {
    column: "minimumSampleCount",
    title: "Minimum sample count",
    kind: SloFeedValueKind.Count,
  },
  {
    column: "shouldCreateAlert",
    title: "Create alert",
    kind: SloFeedValueKind.Boolean,
  },
  {
    column: "alertSeverityId",
    title: "Alert severity",
    kind: SloFeedValueKind.EntityReference,
    relationProperty: "alertSeverity",
  },
  {
    column: "onCallDutyPolicies",
    title: "Alert on-call policies",
    kind: SloFeedValueKind.EntityList,
  },
  {
    column: "alertTitleTemplate",
    title: "Alert title template",
    kind: SloFeedValueKind.Opaque,
  },
  {
    column: "alertDescriptionTemplate",
    title: "Alert description template",
    kind: SloFeedValueKind.Opaque,
  },
  {
    column: "alertRemediationNotes",
    title: "Alert remediation notes",
    kind: SloFeedValueKind.Opaque,
  },
  {
    column: "isAlertPrivate",
    title: "Private alert",
    kind: SloFeedValueKind.Boolean,
  },
  {
    column: "autoResolveAlert",
    title: "Auto-resolve alert",
    kind: SloFeedValueKind.Boolean,
  },
  {
    column: "alertLabels",
    title: "Alert labels",
    kind: SloFeedValueKind.EntityList,
  },
  {
    column: "alertOwnerTeams",
    title: "Alert owner teams",
    kind: SloFeedValueKind.EntityList,
  },
  {
    column: "alertOwnerUsers",
    title: "Alert owner users",
    kind: SloFeedValueKind.EntityList,
    relationSelect: USER_RELATION_SELECT,
  },
  {
    column: "shouldCreateIncident",
    title: "Declare incident",
    kind: SloFeedValueKind.Boolean,
  },
  {
    column: "incidentSeverityId",
    title: "Incident severity",
    kind: SloFeedValueKind.EntityReference,
    relationProperty: "incidentSeverity",
  },
  {
    column: "incidentOnCallDutyPolicies",
    title: "Incident on-call policies",
    kind: SloFeedValueKind.EntityList,
  },
  {
    column: "incidentTitleTemplate",
    title: "Incident title template",
    kind: SloFeedValueKind.Opaque,
  },
  {
    column: "incidentDescriptionTemplate",
    title: "Incident description template",
    kind: SloFeedValueKind.Opaque,
  },
  {
    column: "incidentRemediationNotes",
    title: "Incident remediation notes",
    kind: SloFeedValueKind.Opaque,
  },
  {
    column: "isIncidentPrivate",
    title: "Private incident",
    kind: SloFeedValueKind.Boolean,
  },
  {
    column: "autoResolveIncident",
    title: "Auto-resolve incident",
    kind: SloFeedValueKind.Boolean,
  },
  {
    column: "incidentLabels",
    title: "Incident labels",
    kind: SloFeedValueKind.EntityList,
  },
  {
    column: "incidentOwnerTeams",
    title: "Incident owner teams",
    kind: SloFeedValueKind.EntityList,
  },
  {
    column: "incidentOwnerUsers",
    title: "Incident owner users",
    kind: SloFeedValueKind.EntityList,
    relationSelect: USER_RELATION_SELECT,
  },
  {
    column: "addSloOwnersAsOwners",
    title: "Add SLO owners as owners",
    kind: SloFeedValueKind.Boolean,
  },
];

export interface SloFeedBurnRateRuleDetails extends SloFeedBurnRateRuleSummary {
  isEnabled?: boolean | undefined;
  shouldCreateAlert?: boolean | undefined;
  shouldCreateIncident?: boolean | undefined;
}

type DescribeRuleOutputsFunction = (
  rule: SloFeedBurnRateRuleDetails,
) => string | null;

const describeRuleOutputs: DescribeRuleOutputsFunction = (
  rule: SloFeedBurnRateRuleDetails,
): string | null => {
  const alert: boolean | null = normalizeSloFeedBoolean(rule.shouldCreateAlert);
  const incident: boolean | null = normalizeSloFeedBoolean(
    rule.shouldCreateIncident,
  );

  if (alert === null && incident === null) {
    return null;
  }

  // The column defaults: a rule raises an alert unless told otherwise.
  const raisesAlert: boolean = alert !== false;
  const declaresIncident: boolean = incident === true;

  if (raisesAlert && declaresIncident) {
    return "raises an alert and declares an incident";
  }

  if (declaresIncident) {
    return "declares an incident";
  }

  return raisesAlert ? "raises an alert" : "raises nothing";
};

type GetRuleDetailsFunction = (
  rule: SloFeedBurnRateRuleDetails,
) => Array<string>;

const getRuleDetails: GetRuleDetailsFunction = (
  rule: SloFeedBurnRateRuleDetails,
): Array<string> => {
  const details: Array<string> = [];
  const condition: string | null = describeBurnRateCondition(rule);

  if (condition) {
    details.push(`**Fires on**: ${condition}`);
  }

  const outputs: string | null = describeRuleOutputs(rule);

  if (outputs) {
    details.push(`**When it fires**: it ${outputs}`);
  }

  const enabled: boolean | null = normalizeSloFeedBoolean(rule.isEnabled);

  if (enabled !== null) {
    details.push(`**Enabled**: ${enabled ? "Yes" : "No"}`);
  }

  return details;
};

type FormatRuleNameFunction = (name: string | undefined | null) => string;

const formatRuleName: FormatRuleNameFunction = (
  name: string | undefined | null,
): string => {
  return formatSloFeedText(name, 80) || "Unnamed rule";
};

export type GetBurnRateRuleAddedFeedMarkdownFunction = (data: {
  sloMarkdownLink: string;
  rule: SloFeedBurnRateRuleDetails;
}) => SloFeedMarkdown;

export const getBurnRateRuleAddedFeedMarkdown: GetBurnRateRuleAddedFeedMarkdownFunction =
  (data: {
    sloMarkdownLink: string;
    rule: SloFeedBurnRateRuleDetails;
  }): SloFeedMarkdown => {
    return {
      feedInfoInMarkdown: `🔥 Burn rate rule **${formatRuleName(data.rule.name)}** was added to ${data.sloMarkdownLink}.`,
      moreInformationInMarkdown: getRuleDetails(data.rule).join("\n\n"),
    };
  };

export type GetBurnRateRuleChangedFeedMarkdownFunction = (data: {
  sloMarkdownLink: string;
  ruleName: string | undefined | null;
  changes: Array<SloFeedColumnChange>;
}) => SloFeedMarkdown;

export const getBurnRateRuleChangedFeedMarkdown: GetBurnRateRuleChangedFeedMarkdownFunction =
  (data: {
    sloMarkdownLink: string;
    ruleName: string | undefined | null;
    changes: Array<SloFeedColumnChange>;
  }): SloFeedMarkdown => {
    const ruleName: string = formatRuleName(data.ruleName);
    const onlyChange: SloFeedColumnChange | undefined =
      data.changes.length === 1 ? data.changes[0] : undefined;

    // Turning a rule on or off is the one change people scan the feed for.
    if (onlyChange && onlyChange.column === "isEnabled") {
      const isEnabled: boolean = onlyChange.to === "On";

      return {
        feedInfoInMarkdown: `🔥 Burn rate rule **${ruleName}** on ${data.sloMarkdownLink} was ${isEnabled ? "enabled" : "disabled"}.`,
        moreInformationInMarkdown: isEnabled
          ? "The rule is evaluated again on the next worker tick."
          : "A disabled rule does not fire. Any alerts and incidents it had open were resolved.",
      };
    }

    return {
      feedInfoInMarkdown: `🔥 Burn rate rule **${ruleName}** on ${data.sloMarkdownLink} was updated: ${formatChangeSummary(data.changes)}.`,
      moreInformationInMarkdown: data.changes
        .map(formatChangeLine)
        .join("\n\n"),
    };
  };

export type GetBurnRateRuleRemovedFeedMarkdownFunction = (data: {
  sloMarkdownLink: string;
  rule: SloFeedBurnRateRuleDetails;
}) => SloFeedMarkdown;

export const getBurnRateRuleRemovedFeedMarkdown: GetBurnRateRuleRemovedFeedMarkdownFunction =
  (data: {
    sloMarkdownLink: string;
    rule: SloFeedBurnRateRuleDetails;
  }): SloFeedMarkdown => {
    return {
      feedInfoInMarkdown: `🔥 Burn rate rule **${formatRuleName(data.rule.name)}** was removed from ${data.sloMarkdownLink}.`,
      moreInformationInMarkdown: [
        ...getRuleDetails({
          name: data.rule.name,
          burnRateThreshold: data.rule.burnRateThreshold,
          longWindowInMinutes: data.rule.longWindowInMinutes,
          shortWindowInMinutes: data.rule.shortWindowInMinutes,
        }),
        "Any alerts and incidents the rule had open were resolved.",
      ].join("\n\n"),
    };
  };
