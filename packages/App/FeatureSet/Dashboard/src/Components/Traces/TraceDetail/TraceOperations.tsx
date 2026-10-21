import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import React, {
  FunctionComponent,
  ReactElement,
  useMemo,
  useState,
} from "react";
import {
  OperationSortKey,
  OperationSummary,
  REPEATED_CALL_THRESHOLD,
  SortDirection,
  TraceServiceInfo,
  formatDurationNano,
  formatPercent,
  getServiceInfo,
  sortOperations,
} from "../../../Utils/TraceDetailPresentation";

export interface ComponentProps {
  operations: Array<OperationSummary>;
  serviceInfoById: Map<string, TraceServiceInfo>;
  onSelectOperation: (operation: OperationSummary) => void;
}

interface Column {
  key: OperationSortKey;
  label: string;
  align: "left" | "right";
  hint: string;
}

const COLUMNS: Array<Column> = [
  {
    key: "name",
    label: "Operation",
    align: "left",
    hint: "Service and span name",
  },
  {
    key: "count",
    label: "Calls",
    align: "right",
    hint: "How many spans ran this operation",
  },
  {
    key: "errors",
    label: "Errors",
    align: "right",
    hint: "Calls with an error status",
  },
  {
    key: "selfTime",
    label: "Self time",
    align: "right",
    hint: "Time spent in the operation itself, excluding its child spans",
  },
  {
    key: "total",
    label: "Total",
    align: "right",
    hint: "Sum of every call's duration",
  },
  {
    key: "average",
    label: "Avg",
    align: "right",
    hint: "Average call duration",
  },
  { key: "max", label: "Max", align: "right", hint: "The slowest call" },
];

/*
 * Spans rolled up by operation: the fastest way to see what a trace spent its
 * time on, and to spot the same query running dozens of times in a loop.
 */
const TraceOperations: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [sortKey, setSortKey] = useState<OperationSortKey>("selfTime");
  const [direction, setDirection] = useState<SortDirection>("desc");

  const rows: Array<OperationSummary> = useMemo(() => {
    return sortOperations(props.operations, sortKey, direction);
  }, [props.operations, sortKey, direction]);

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-200 px-4 py-10 text-center text-sm text-gray-500">
        No operations match the current filters.
      </div>
    );
  }

  return (
    <div
      className="overflow-x-auto rounded-lg border border-gray-200"
      data-testid="trace-operations"
    >
      <table className="min-w-full divide-y divide-gray-200 text-xs">
        <thead className="bg-gray-50">
          <tr>
            {COLUMNS.map((column: Column): ReactElement => {
              const isSorted: boolean = column.key === sortKey;
              return (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={
                    isSorted
                      ? direction === "asc"
                        ? "ascending"
                        : "descending"
                      : "none"
                  }
                  className={`whitespace-nowrap px-3 py-2 font-medium text-gray-500 ${column.align === "right" ? "text-right" : "text-left"}`}
                >
                  <button
                    type="button"
                    title={column.hint}
                    className={`inline-flex items-center gap-1 hover:text-gray-900 ${isSorted ? "text-gray-900" : ""}`}
                    onClick={() => {
                      if (isSorted) {
                        setDirection(direction === "asc" ? "desc" : "asc");
                      } else {
                        setSortKey(column.key);
                        setDirection(column.key === "name" ? "asc" : "desc");
                      }
                    }}
                  >
                    {column.label}
                    {isSorted && (
                      <Icon
                        icon={
                          direction === "asc"
                            ? IconProp.ChevronUp
                            : IconProp.ChevronDown
                        }
                        className="h-3 w-3"
                      />
                    )}
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white">
          {rows.map((operation: OperationSummary): ReactElement => {
            const service: TraceServiceInfo = getServiceInfo(
              props.serviceInfoById,
              operation.serviceId,
            );
            const isRepeated: boolean =
              operation.maxCallsFromOneParent >= REPEATED_CALL_THRESHOLD;
            return (
              <tr
                key={operation.key}
                className="cursor-pointer hover:bg-gray-50"
                data-testid="trace-operation-row"
                tabIndex={0}
                title="Show these spans in the waterfall"
                onClick={() => {
                  props.onSelectOperation(operation);
                }}
                onKeyDown={(
                  event: React.KeyboardEvent<HTMLTableRowElement>,
                ) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    props.onSelectOperation(operation);
                  }
                }}
              >
                <td className="max-w-md px-3 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 flex-none rounded-sm"
                      style={{ backgroundColor: service.color }}
                      aria-hidden="true"
                    />
                    <span className="flex-none text-gray-500">
                      {service.name}
                    </span>
                    <span
                      className="min-w-0 truncate font-medium text-gray-900"
                      title={operation.name}
                    >
                      {operation.name || "(unnamed span)"}
                    </span>
                    {isRepeated && (
                      <span
                        className="flex-none rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-600/20"
                        title="Called many times from a single parent span. This is often an N+1 query or a loop that could be batched."
                        data-testid="trace-operation-repeated"
                      >
                        ×{operation.maxCallsFromOneParent} from one parent
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-900">
                  {operation.count.toLocaleString()}
                </td>
                <td
                  className={`px-3 py-2 text-right tabular-nums ${operation.errorCount > 0 ? "font-medium text-red-600" : "text-gray-400"}`}
                >
                  {operation.errorCount.toLocaleString()}
                </td>
                <td className="px-3 py-2 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <div
                      className="max-sm:hidden h-1.5 w-16 overflow-hidden rounded-full bg-gray-100 sm:block"
                      aria-hidden="true"
                    >
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.min(100, operation.percentOfSelfTime)}%`,
                          backgroundColor: service.color,
                        }}
                      />
                    </div>
                    <span className="whitespace-nowrap tabular-nums text-gray-900">
                      {formatDurationNano(operation.selfTimeUnixNano)}
                    </span>
                    <span className="w-9 text-right tabular-nums text-gray-400">
                      {formatPercent(operation.percentOfSelfTime)}
                    </span>
                  </div>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-gray-600">
                  {formatDurationNano(operation.totalDurationUnixNano)}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-gray-600">
                  {formatDurationNano(operation.averageDurationUnixNano)}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-gray-600">
                  {formatDurationNano(operation.maxDurationUnixNano)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default TraceOperations;
