import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import IconProp from "../../../Types/Icon/IconProp";

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
