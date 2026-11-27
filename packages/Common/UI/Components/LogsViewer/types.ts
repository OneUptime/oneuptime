import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import IconProp from "../../../Types/Icon/IconProp";
import { LockedFilterDetail } from "../../../Types/Telemetry/LockedFilterDetail";

export interface LiveLogsOptions {
  isLive: boolean;
  onToggle: (next: boolean) => void;
  isDisabled?: boolean;
}

export interface HistogramBucket {
  time: string;
  severity: string;
  count: number;
}

export interface FacetValue {
  value: string;
  count: number;
  // Server-resolved display name (e.g. serviceId → service name).
  displayName?: string | undefined;
}

export type FacetData = Record<string, Array<FacetValue>>;

export interface ActiveFilter {
  facetKey: string;
  value: string;
  displayKey: string;
  displayValue: string;
  readOnly?: boolean | undefined;
  /*
   * When set, the chip renders a small icon-link that opens this route (e.g.
   * a trace/span chip linking out to the trace view). Chips without a
   * resolvable destination render as plain chips.
   */
  openRoute?: Route | URL | undefined;
  /*
   * For a read-only chip: its search syntax (or why there is none), shown in
   * the chip's tooltip. Display only.
   */
  lockedDetail?: LockedFilterDetail | undefined;
  /*
   * An attribute filter's stored value, when it holds an operator (contains,
   * is any of, is empty: a Search, an Includes, an IsNull...). The chip then
   * says the filter as one sentence in the reader's language
   * (DictionaryFilterSentence) - "http.route stimmt überein /api/*" - in
   * place of "key: value", whose value would put the operator's English
   * word before it (#8309). Display only: `value` stays what removal and
   * keys read.
   */
  filterValue?: unknown;
  /*
   * The record the chip names is gone - deleted since a link or a saved
   * view named it, or out of the reader's reach - by every read the viewer
   * made of it (#11213): drawn "No longer available", never as its id.
   * `value` still filters as saved. Display only.
   */
  isNotFound?: boolean | undefined;
  // The record the chip names is archived: drawn "{{name}} (archived)".
  isArchived?: boolean | undefined;
}

/*
 * One cross-signal pivot action rendered in the toolbar's "related signals"
 * group (e.g. "Traces" / "Metrics" on the logs explorer). The tooltip is
 * where callers surface scope fields the target explorer cannot carry.
 */
export interface LogsSignalPivotAction {
  id: string;
  label: string;
  icon?: IconProp | undefined;
  tooltip: string;
  onClick: () => void;
}

export type LogsViewMode = "list" | "analytics";

export interface LogsSavedViewOption {
  id: string;
  name: string;
  isDefault?: boolean;
}

export interface LogsTableColumnOption {
  id: string;
  label: string;
  attributeKey?: string;
}

export const LOGS_ATTRIBUTE_COLUMN_PREFIX: string = "attribute:";

export const DEFAULT_LOGS_TABLE_COLUMNS: Array<string> = [
  "time",
  "service",
  "severity",
  "message",
];

export const CORE_LOGS_TABLE_COLUMN_OPTIONS: Array<LogsTableColumnOption> = [
  {
    id: "time",
    label: "Time",
  },
  {
    id: "service",
    label: "Service",
  },
  {
    id: "severity",
    label: "Severity",
  },
  {
    id: "message",
    label: "Message",
  },
  {
    id: "traceId",
    label: "Trace ID",
  },
  {
    id: "spanId",
    label: "Span ID",
  },
];

export const getLogsAttributeColumnId: (attributeKey: string) => string = (
  attributeKey: string,
): string => {
  return `${LOGS_ATTRIBUTE_COLUMN_PREFIX}${attributeKey}`;
};

export const isLogsAttributeColumnId: (columnId: string) => boolean = (
  columnId: string,
): boolean => {
  return columnId.startsWith(LOGS_ATTRIBUTE_COLUMN_PREFIX);
};

export const getLogsAttributeKeyFromColumnId: (
  columnId: string,
) => string | null = (columnId: string): string | null => {
  if (!isLogsAttributeColumnId(columnId)) {
    return null;
  }

  return columnId.slice(LOGS_ATTRIBUTE_COLUMN_PREFIX.length) || null;
};

export const normalizeLogsTableColumns: (
  columns: Array<string> | undefined | null,
) => Array<string> = (
  columns: Array<string> | undefined | null,
): Array<string> => {
  const sanitizedColumns: Array<string> = [];
  const seen: Set<string> = new Set();

  for (const columnId of columns || []) {
    if (!columnId || seen.has(columnId)) {
      continue;
    }

    seen.add(columnId);
    sanitizedColumns.push(columnId);
  }

  if (sanitizedColumns.length === 0) {
    return [...DEFAULT_LOGS_TABLE_COLUMNS];
  }

  return sanitizedColumns;
};
