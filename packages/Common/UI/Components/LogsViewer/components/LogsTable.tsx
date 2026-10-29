import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  ReactNode,
} from "react";
import {
  translatableTerm,
  translationKey,
  Translator,
} from "../../../Utils/TranslateTemplate";
import useTranslator from "../../../Utils/UseTranslator";
import TranslatedSentence from "../../TranslatedSentence/TranslatedSentence";
import Log from "../../../../Models/AnalyticsModels/Log";
import Service from "../../../../Models/DatabaseModels/Service";
import Dictionary from "../../../../Types/Dictionary";
import OneUptimeDate from "../../../../Types/Date";
import Route from "../../../../Types/API/Route";
import URL from "../../../../Types/API/URL";
import CopyTextButton from "../../CopyTextButton/CopyTextButton";
import IsolatedText from "../../IsolatedText/IsolatedText";
import ComponentLoader from "../../ComponentLoader/ComponentLoader";
import Link from "../../Link/Link";
import Navigation from "../../../Utils/Navigation";
import SeverityBadge from "./SeverityBadge";
import { getSeverityTheme, SeverityTheme } from "./severityTheme";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import Icon from "../../Icon/Icon";
import IconProp from "../../../../Types/Icon/IconProp";
import {
  getLogsAttributeKeyFromColumnId,
  isLogsAttributeColumnId,
  normalizeLogsTableColumns,
} from "../types";
import { TelemetryEntityNameMap } from "../../../Utils/Telemetry/TelemetryEntityNames";
import {
  getLogEntityDisplay,
  LogEntityDisplay,
  LogsResourceEntityMaps,
} from "../LogsEntityNames";
import { ResizableColumns } from "../../Table/ColumnResize/useResizableColumns";
import ResizableHeaderCell, {
  ColumnResize,
} from "../../Table/ColumnResize/ResizableHeaderCell";
import { ColumnWidthKind } from "../../Table/ColumnResize/ColumnWidths";
import ResetColumnWidthsButton from "../../Table/ColumnResize/ResetColumnWidthsButton";

export interface LogsTableProps {
  logs: Array<Log>;
  serviceMap: Dictionary<Service>;
  /*
   * Names for primaryEntityIds serviceMap does not hold — a RUM
   * application, a host, a serverless function (see LogsEntityNames). The
   * Service column falls back to it instead of printing the raw id.
   */
  entityNameMap?: TelemetryEntityNameMap | undefined;
  /*
   * Preloaded host / Docker host / Podman host / Kubernetes cluster maps.
   * Agent-ingested telemetry is primary-keyed on those rows, and such ids
   * are named from these maps rather than sent to the resolver.
   */
  resourceEntityMaps?: LogsResourceEntityMaps | undefined;
  isLoading: boolean;
  emptyMessage?: string | undefined;
  /*
   * Drawn in place of the empty list's message when set - the Logs page's
   * first steps (LogsViewer's emptyContentWhenUnfiltered).
   */
  emptyContent?: ReactNode | undefined;
  onRowClick: (log: Log, rowId: string) => void;
  selectedLogId?: string | null;
  renderExpandedContent?: (log: Log) => ReactElement | null;
  sortField?: LogsTableSortField | undefined;
  sortOrder?: SortOrder | undefined;
  onSortChange?: (field: LogsTableSortField) => void;
  selectedColumns?: Array<string> | undefined;
  focusedRowIndex?: number | undefined;
  getTraceRoute?:
    | ((traceId: string, log: Log) => Route | URL | undefined)
    | undefined;
  getSpanRoute?:
    | ((spanId: string, log: Log) => Route | URL | undefined)
    | undefined;
  /*
   * Async fallback for spanId-only rows: the sync builder needs the trace id
   * the row doesn't carry, so the destination is resolved on click (one Span
   * lookup) rather than per-row.
   */
  resolveSpanRoute?:
    | ((spanId: string, log: Log) => Promise<Route | URL | undefined>)
    | undefined;
  /*
   * The list's columns as wide as a person made them (Table/ColumnResize):
   * an edge on each column's header to drag, and Reset column widths at the
   * header row's end while one is sized - as a table with no ⋯ keeps it.
   * Left out, the columns are the list's own.
   */
  resizableColumns?: ResizableColumns | undefined;
}

/*
 * How each of the list's columns may be cut short as it is narrowed: the
 * time and the severity never (a date, a badge), the message wraps, any
 * other value gives way to 8rem (ColumnWidths' ColumnWidthKind).
 */
export const getLogsColumnWidthKind: (columnId: string) => ColumnWidthKind = (
  columnId: string,
): ColumnWidthKind => {
  if (columnId === "time" || columnId === "severity") {
    return ColumnWidthKind.Whole;
  }

  if (columnId === "message") {
    return ColumnWidthKind.Prose;
  }

  return ColumnWidthKind.Text;
};

export const resolveLogIdentifier: (log: Log, index: number) => string = (
  log: Log,
  index: number,
): string => {
  const possibleIds: Array<unknown> = [
    (log as any).id,
    (log as any)._id,
    (log as any)._objectId,
    log.traceId,
    log.timeUnixNano,
  ];

  for (const candidate of possibleIds) {
    if (!candidate) {
      continue;
    }

    try {
      return candidate.toString();
    } catch {
      continue;
    }
  }

  return `log-row-${index}`;
};

export type LogsTableSortField = "time" | "severityText";

// The list's own box: the rows, their loader and their empty state.
export const LOGS_TABLE_TEST_ID: string = "logs-table";

// What an empty list says, and the line under it when its host says nothing.
export const LOGS_TABLE_EMPTY_TITLE: string = translationKey("No logs found");
export const LOGS_TABLE_EMPTY_HINT: string = translationKey(
  "Adjust filters or check again later.",
);

// "No logs found." and "no logs found" read as the same sentence.
const asSentenceKey: (text: string) => string = (text: string): string => {
  let value: string = text.trim().toLowerCase();

  while (value.endsWith(".")) {
    value = value.slice(0, -1).trimEnd();
  }

  return value;
};

/**
 * The line under "No logs found". A host's message says why nothing came
 * or what to try; one that only says "No logs found" again - an incident's
 * or an alert's logs, a log monitor's preview - would print the title twice
 * in a row, so it gives way to the list's own hint, as an unset one does.
 */
export function getLogsTableEmptyHint(
  emptyMessage: string | undefined,
): string {
  if (
    !emptyMessage ||
    asSentenceKey(emptyMessage).length === 0 ||
    asSentenceKey(emptyMessage) === asSentenceKey(LOGS_TABLE_EMPTY_TITLE)
  ) {
    return LOGS_TABLE_EMPTY_HINT;
  }

  return emptyMessage;
}

const stringifyLogValue: (value: unknown) => string = (
  value: unknown,
): string => {
  if (value === undefined || value === null) {
    return "-";
  }

  if (typeof value === "string") {
    return value || "-";
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value.toString();
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const LogsTable: FunctionComponent<LogsTableProps> = (
  props: LogsTableProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const showEmptyState: boolean = !props.isLoading && props.logs.length === 0;
  /*
   * Loading with no rows yet - the first page, or a list that waits for a
   * saved view to apply (issue #4709). The loader gets the room the rows
   * will take, as the other explorers' lists give theirs, rather than a
   * strip across the column headings.
   */
  const isLoadingFirstRows: boolean =
    props.isLoading && props.logs.length === 0;
  const activeSortField: LogsTableSortField | undefined = props.sortField;
  const activeSortOrder: SortOrder = props.sortOrder || SortOrder.Descending;
  const selectedColumns: Array<string> = normalizeLogsTableColumns(
    props.selectedColumns,
  );
  const showTraceColumn: boolean = selectedColumns.includes("traceId");
  const showSpanColumn: boolean = selectedColumns.includes("spanId");

  const resolveSortIcon: (field: LogsTableSortField) => IconProp = (
    field: LogsTableSortField,
  ): IconProp => {
    if (activeSortField !== field) {
      return IconProp.ArrowUpDown;
    }

    return activeSortOrder === SortOrder.Descending
      ? IconProp.ChevronDown
      : IconProp.ChevronUp;
  };

  const resolveSortIconClass: (field: LogsTableSortField) => string = (
    field: LogsTableSortField,
  ): string => {
    const base: string = "h-3.5 w-3.5 flex-none transition-colors";
    if (activeSortField === field) {
      return `${base} text-indigo-500`;
    }

    return `${base} text-gray-300`;
  };

  const openSpanLazily: (spanId: string, log: Log) => void = (
    spanId: string,
    log: Log,
  ): void => {
    const resolver:
      | ((spanId: string, log: Log) => Promise<Route | URL | undefined>)
      | undefined = props.resolveSpanRoute;

    if (!resolver) {
      return;
    }

    const navigateToSpan: () => Promise<void> = async (): Promise<void> => {
      try {
        const route: Route | URL | undefined = await resolver(spanId, log);

        if (route) {
          Navigation.navigate(route);
        }
      } catch {
        // Resolution failed — leave the user where they are.
      }
    };

    void navigateToSpan();
  };

  const linkClassName: string =
    "font-mono text-indigo-600 hover:text-indigo-500 hover:underline";

  /*
   * Every rendered trace id is a link when the host supplied a route builder;
   * plain text otherwise. Wrapped so a click follows the link without also
   * toggling the row's expansion.
   */
  const renderTraceIdValue: (traceId: string, log: Log) => ReactElement = (
    traceId: string,
    log: Log,
  ): ReactElement => {
    const traceRoute: Route | URL | undefined = props.getTraceRoute
      ? props.getTraceRoute(traceId, log)
      : undefined;

    if (!traceRoute) {
      return (
        <span className="font-mono" title={traceId}>
          {traceId}
        </span>
      );
    }

    return (
      <span
        onClick={(event: React.MouseEvent<HTMLSpanElement>) => {
          event.stopPropagation();
        }}
      >
        <Link
          to={traceRoute}
          className={linkClassName}
          title={translator.translateTemplate("View trace {{id}}", {
            id: traceId,
          })}
        >
          {traceId}
        </Link>
      </span>
    );
  };

  /*
   * Span ids link through the sync builder when it can produce a route (the
   * row carries a trace id), fall back to click-time resolution for
   * spanId-only rows, and degrade to plain text when neither is available.
   */
  const renderSpanIdValue: (spanId: string, log: Log) => ReactElement = (
    spanId: string,
    log: Log,
  ): ReactElement => {
    const spanRoute: Route | URL | undefined = props.getSpanRoute
      ? props.getSpanRoute(spanId, log)
      : undefined;

    if (spanRoute) {
      return (
        <span
          onClick={(event: React.MouseEvent<HTMLSpanElement>) => {
            event.stopPropagation();
          }}
        >
          <Link
            to={spanRoute}
            className={linkClassName}
            title={translator.translateTemplate("View span {{id}}", {
              id: spanId,
            })}
          >
            {spanId}
          </Link>
        </span>
      );
    }

    if (props.resolveSpanRoute) {
      return (
        <span
          onClick={(event: React.MouseEvent<HTMLSpanElement>) => {
            event.stopPropagation();
          }}
        >
          <Link
            onClick={() => {
              openSpanLazily(spanId, log);
            }}
            className={linkClassName}
            title={translator.translateTemplate("View span {{id}}", {
              id: spanId,
            })}
          >
            {spanId}
          </Link>
        </span>
      );
    }

    return (
      <span className="font-mono" title={spanId}>
        {spanId}
      </span>
    );
  };

  /*
   * A column's edge, which a person drags to size it, named after the
   * column as its header says it.
   */
  const getColumnResize: (
    columnId: string,
    title: string,
  ) => ColumnResize | undefined = (
    columnId: string,
    title: string,
  ): ColumnResize | undefined => {
    if (!props.resizableColumns) {
      return undefined;
    }

    return {
      columns: props.resizableColumns,
      columnId: columnId,
      columnTitle: title,
      kind: getLogsColumnWidthKind(columnId),
    };
  };

  // A sized list ends each row with a cell that takes the room left over.
  const hasEndFiller: boolean = Boolean(
    props.resizableColumns?.hasColumnWidths,
  );

  const getHeaderCell: (columnId: string) => ReactElement = (
    columnId: string,
  ): ReactElement => {
    if (columnId === "time") {
      return (
        <ResizableHeaderCell
          scope="col"
          className="px-4 py-2.5"
          key={columnId}
          resize={getColumnResize(
            columnId,
            translator.translateText("Time") || "Time",
          )}
        >
          <button
            type="button"
            className={`flex items-center gap-2 text-left font-semibold tracking-wider text-gray-500 transition-colors hover:text-gray-700 focus:outline-none ${
              activeSortField === "time" ? "text-gray-700" : ""
            }`}
            onClick={() => {
              props.onSortChange?.("time");
            }}
            aria-sort={
              activeSortField === "time"
                ? activeSortOrder === SortOrder.Descending
                  ? "descending"
                  : "ascending"
                : "none"
            }
          >
            <span>{translator.translateText("Time")}</span>
            <Icon
              icon={resolveSortIcon("time")}
              className={resolveSortIconClass("time")}
              aria-hidden="true"
            />
          </button>
        </ResizableHeaderCell>
      );
    }

    if (columnId === "severity") {
      return (
        <ResizableHeaderCell
          scope="col"
          className="px-4 py-2.5"
          key={columnId}
          resize={getColumnResize(
            columnId,
            translator.translateText("Severity") || "Severity",
          )}
        >
          <button
            type="button"
            className={`flex items-center gap-2 text-left font-semibold tracking-wider text-gray-500 transition-colors hover:text-gray-700 focus:outline-none ${
              activeSortField === "severityText" ? "text-gray-700" : ""
            }`}
            onClick={() => {
              props.onSortChange?.("severityText");
            }}
            aria-sort={
              activeSortField === "severityText"
                ? activeSortOrder === SortOrder.Descending
                  ? "descending"
                  : "ascending"
                : "none"
            }
          >
            <span>{translator.translateText("Severity")}</span>
            <Icon
              icon={resolveSortIcon("severityText")}
              className={resolveSortIconClass("severityText")}
              aria-hidden="true"
            />
          </button>
        </ResizableHeaderCell>
      );
    }

    const title: string =
      columnId === "service"
        ? translator.translateText("Service") || "Service"
        : columnId === "message"
          ? translator.translateText("Message") || "Message"
          : columnId === "traceId"
            ? translator.translateText("Trace ID") || "Trace ID"
            : columnId === "spanId"
              ? translator.translateText("Span ID") || "Span ID"
              : getLogsAttributeKeyFromColumnId(columnId) || columnId;

    return (
      <ResizableHeaderCell
        scope="col"
        className="px-4 py-2.5"
        key={columnId}
        resize={getColumnResize(columnId, title)}
      >
        <span>{title}</span>
      </ResizableHeaderCell>
    );
  };

  return (
    <div
      className={isLoadingFirstRows ? "relative min-h-48" : "relative"}
      data-testid={LOGS_TABLE_TEST_ID}
    >
      <div className="overflow-x-auto bg-white">
        {props.resizableColumns ? props.resizableColumns.styles : <></>}
        <table
          className="min-w-full"
          {...(props.resizableColumns?.tableAttributes || {})}
        >
          <thead className="bg-gray-50/80">
            <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">
              {selectedColumns.map((columnId: string) => {
                return getHeaderCell(columnId);
              })}
              {hasEndFiller ? (
                <th
                  scope="col"
                  className="p-0"
                  aria-hidden={
                    props.resizableColumns?.isResetInCardMenu ? true : undefined
                  }
                  data-testid="logs-table-end-filler"
                >
                  {/*
                   * Reset column widths, unless the card the list is in
                   * keeps it in its ⋯ (useResizableColumns).
                   */}
                  {props.resizableColumns?.isResetInCardMenu ? (
                    <></>
                  ) : (
                    <div className="flex items-center justify-end py-1.5 pl-3 pr-4">
                      <ResetColumnWidthsButton
                        onClick={() => {
                          props.resizableColumns?.columnWidths.resetColumnWidths();
                        }}
                      />
                    </div>
                  )}
                </th>
              ) : (
                <></>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {props.logs.map((log: Log, index: number) => {
              const rowId: string = resolveLogIdentifier(log, index);
              const primaryEntityId: string =
                log.primaryEntityId?.toString() || "";
              const entityDisplay: LogEntityDisplay = getLogEntityDisplay({
                primaryEntityId,
                serviceMap: props.serviceMap,
                resourceMaps: props.resourceEntityMaps,
                entityNameMap: props.entityNameMap,
              });
              const serviceName: string =
                entityDisplay.name || translator.translateText("Unknown") || "";
              const serviceColor: string = entityDisplay.color || "#94a3b8";
              const serviceTitle: string = entityDisplay.typeLabel
                ? translator.translateTemplate("{{type}}: {{name}}", {
                    type: translatableTerm(entityDisplay.typeLabel),
                    name: serviceName,
                  })
                : serviceName;

              const message: string = log.body?.toString() || "";
              const traceId: string = log.traceId?.toString() || "";
              const spanId: string = log.spanId?.toString() || "";

              const isSelected: boolean = props.selectedLogId === rowId;
              const isFocused: boolean = props.focusedRowIndex === index;
              const severityTheme: SeverityTheme = getSeverityTheme(
                log.severityText,
              );

              return (
                <Fragment key={rowId}>
                  <tr
                    onClick={() => {
                      props.onRowClick(log, rowId);
                    }}
                    className={`group cursor-pointer align-top transition-colors hover:bg-gray-50/70 border-l-[3px] ${severityTheme.borderClass} ${
                      isSelected
                        ? "bg-indigo-50/50 ring-1 ring-inset ring-indigo-200"
                        : isFocused
                          ? "bg-gray-100/70 ring-1 ring-inset ring-gray-300"
                          : ""
                    }`}
                    data-focused={isFocused || undefined}
                    aria-selected={isSelected}
                    aria-expanded={isSelected}
                  >
                    {selectedColumns.map((columnId: string) => {
                      if (columnId === "time") {
                        return (
                          <td
                            className="whitespace-nowrap px-4 py-2 text-[13px] font-mono text-gray-600"
                            key={columnId}
                          >
                            {log.time
                              ? OneUptimeDate.getDateAsUserFriendlyFormattedString(
                                  log.time,
                                )
                              : "-"}
                          </td>
                        );
                      }

                      if (columnId === "service") {
                        return (
                          <td className="px-4 py-2" key={columnId}>
                            <div className="flex items-center gap-3 text-sm text-gray-700">
                              <span
                                className="h-2.5 w-2.5 flex-none rounded-full shadow-sm"
                                style={{ backgroundColor: serviceColor }}
                                aria-hidden="true"
                              />
                              <span className="truncate" title={serviceTitle}>
                                {serviceName}
                              </span>
                            </div>
                          </td>
                        );
                      }

                      if (columnId === "severity") {
                        return (
                          <td className="px-4 py-2" key={columnId}>
                            <SeverityBadge severity={log.severityText} />
                          </td>
                        );
                      }

                      if (columnId === "message") {
                        return (
                          <td className="px-4 py-2" key={columnId}>
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex min-w-0 flex-1 flex-col gap-1">
                                {/*
                                 * Read the way it is written (IsolatedText):
                                 * an English message on a Persian page keeps
                                 * its full stop at its end.
                                 */}
                                <p
                                  className="whitespace-pre-wrap break-words text-sm text-gray-800"
                                  title={message}
                                >
                                  {message ? (
                                    <IsolatedText text={message} />
                                  ) : (
                                    "-"
                                  )}
                                </p>
                                {((traceId && !showTraceColumn) ||
                                  (spanId && !showSpanColumn)) && (
                                  <div className="flex flex-wrap gap-3 text-[11px] tracking-wide text-gray-400">
                                    {traceId && !showTraceColumn && (
                                      <span>
                                        <TranslatedSentence
                                          template="Trace: {{id}}"
                                          slots={{
                                            id: renderTraceIdValue(
                                              traceId,
                                              log,
                                            ),
                                          }}
                                        />
                                      </span>
                                    )}
                                    {spanId && !showSpanColumn && (
                                      <span>
                                        <TranslatedSentence
                                          template="Span: {{id}}"
                                          slots={{
                                            id: renderSpanIdValue(spanId, log),
                                          }}
                                        />
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>
                              <CopyTextButton
                                textToBeCopied={message}
                                size="xs"
                                variant="ghost"
                                iconOnly={true}
                                title="Copy log message"
                                className="opacity-0 transition-opacity group-hover:opacity-100"
                              />
                            </div>
                          </td>
                        );
                      }

                      if (columnId === "traceId") {
                        return (
                          <td
                            className="max-w-xs px-4 py-2 text-sm text-gray-600"
                            key={columnId}
                          >
                            <span className="block truncate font-mono">
                              {traceId ? renderTraceIdValue(traceId, log) : "-"}
                            </span>
                          </td>
                        );
                      }

                      if (columnId === "spanId") {
                        return (
                          <td
                            className="max-w-xs px-4 py-2 text-sm text-gray-600"
                            key={columnId}
                          >
                            <span className="block truncate font-mono">
                              {spanId ? renderSpanIdValue(spanId, log) : "-"}
                            </span>
                          </td>
                        );
                      }

                      if (isLogsAttributeColumnId(columnId)) {
                        const attributeKey: string | null =
                          getLogsAttributeKeyFromColumnId(columnId);
                        const attributeValue: unknown =
                          attributeKey &&
                          typeof log.attributes === "object" &&
                          log.attributes
                            ? (log.attributes as Record<string, unknown>)[
                                attributeKey
                              ]
                            : undefined;

                        const displayValue: string =
                          stringifyLogValue(attributeValue);

                        return (
                          <td
                            className="max-w-xs px-4 py-2 text-sm text-gray-600"
                            key={columnId}
                          >
                            <span
                              className="block truncate"
                              title={displayValue}
                            >
                              {displayValue}
                            </span>
                          </td>
                        );
                      }

                      return (
                        <td
                          className="px-4 py-2 text-sm text-gray-600"
                          key={columnId}
                        >
                          -
                        </td>
                      );
                    })}
                    {hasEndFiller ? (
                      <td aria-hidden="true" className="p-0" />
                    ) : (
                      <></>
                    )}
                  </tr>

                  {isSelected && props.renderExpandedContent && (
                    <tr className="bg-white">
                      <td
                        colSpan={
                          selectedColumns.length + (hasEndFiller ? 1 : 0)
                        }
                        className="px-6 pb-6 pt-3"
                      >
                        {props.renderExpandedContent(log)}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {props.isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/80 backdrop-blur-sm">
          <ComponentLoader />
        </div>
      )}

      {showEmptyState && props.emptyContent !== undefined && (
        <div className="bg-white" data-testid="logs-table-empty-content">
          {props.emptyContent}
        </div>
      )}

      {/*
       * Drawn as every other explorer draws an empty list (TelemetryViewer):
       * a search icon, what is true, and what to try. It was a boxed card of
       * upper-case monospace text, unlike any other empty list.
       */}
      {showEmptyState && props.emptyContent === undefined && (
        <div
          className="flex flex-col items-center justify-center gap-2 bg-white px-6 py-12 text-center"
          data-testid="logs-table-empty"
        >
          <Icon icon={IconProp.Search} className="h-8 w-8 text-gray-300" />
          <p className="text-sm font-medium text-gray-500">
            {translator.translateText(LOGS_TABLE_EMPTY_TITLE)}
          </p>
          <p className="max-w-xl text-xs text-gray-400">
            {translator.translateText(
              getLogsTableEmptyHint(props.emptyMessage),
            )}
          </p>
        </div>
      )}
    </div>
  );
};

export default LogsTable;
