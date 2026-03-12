import React, {
  ChangeEvent,
  FunctionComponent,
  ReactElement,
  useMemo,
  useState,
} from "react";
import {
  DEFAULT_LOGS_TABLE_COLUMNS,
  LogsTableColumnOption,
  normalizeLogsTableColumns,
} from "../types";
import useComponentOutsideClick from "../../../Types/UseComponentOutsideClick";

export interface ColumnSelectorProps {
  availableColumns: Array<LogsTableColumnOption>;
  selectedColumns: Array<string>;
  onChange: (columns: Array<string>) => void;
}

const triggerButtonClassName: string =
  "inline-flex items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:border-gray-300 hover:bg-gray-50";

const actionButtonClassName: string =
  "rounded-md px-2 py-1 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700";

const ColumnSelector: FunctionComponent<ColumnSelectorProps> = (
  props: ColumnSelectorProps,
): ReactElement => {
  const { ref, isComponentVisible, setIsComponentVisible } =
    useComponentOutsideClick(false);
  const [searchQuery, setSearchQuery] = useState<string>("");

  const selectedColumnIds: Array<string> = useMemo(() => {
    return normalizeLogsTableColumns(props.selectedColumns);
  }, [props.selectedColumns]);

  const availableColumnsById: Map<string, LogsTableColumnOption> =
    useMemo(() => {
      return new Map(
        props.availableColumns.map((column: LogsTableColumnOption) => {
          return [column.id, column] as [string, LogsTableColumnOption];
        }),
      );
    }, [props.availableColumns]);

  const selectedColumns: Array<LogsTableColumnOption> = useMemo(() => {
    return selectedColumnIds.map((columnId: string): LogsTableColumnOption => {
      return (
        availableColumnsById.get(columnId) || {
          id: columnId,
          label: columnId,
        }
      );
    });
  }, [availableColumnsById, selectedColumnIds]);

  const availableColumns: Array<LogsTableColumnOption> = useMemo(() => {
    const normalizedSearchQuery: string = searchQuery.trim().toLowerCase();

    return props.availableColumns.filter((column: LogsTableColumnOption) => {
      if (selectedColumnIds.includes(column.id)) {
        return false;
      }

      if (!normalizedSearchQuery) {
        return true;
      }

      return column.label.toLowerCase().includes(normalizedSearchQuery);
    });
  }, [props.availableColumns, searchQuery, selectedColumnIds]);

  const updateColumns: (columns: Array<string>) => void = (
    columns: Array<string>,
  ): void => {
    props.onChange(normalizeLogsTableColumns(columns));
  };

  const moveColumn: (columnId: string, direction: -1 | 1) => void = (
    columnId: string,
    direction: -1 | 1,
  ): void => {
    const currentIndex: number = selectedColumnIds.indexOf(columnId);

    if (currentIndex === -1) {
      return;
    }

    const nextIndex: number = currentIndex + direction;

    if (nextIndex < 0 || nextIndex >= selectedColumnIds.length) {
      return;
    }

    const nextColumns: Array<string> = [...selectedColumnIds];
    const currentColumn: string = nextColumns[currentIndex] as string;
    nextColumns[currentIndex] = nextColumns[nextIndex] as string;
    nextColumns[nextIndex] = currentColumn;

    updateColumns(nextColumns);
  };

  const removeColumn: (columnId: string) => void = (columnId: string): void => {
    if (selectedColumnIds.length <= 1) {
      return;
    }

    updateColumns(
      selectedColumnIds.filter((selectedColumnId: string) => {
        return selectedColumnId !== columnId;
      }),
    );
  };

  const addColumn: (columnId: string) => void = (columnId: string): void => {
    updateColumns([...selectedColumnIds, columnId]);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className={triggerButtonClassName}
        onClick={() => {
          setIsComponentVisible(!isComponentVisible);
        }}
        aria-haspopup="dialog"
        aria-expanded={isComponentVisible}
      >
        <span>Columns</span>
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
          {selectedColumnIds.length}
        </span>
      </button>

      {isComponentVisible && (
        <div className="absolute right-0 z-20 mt-2 w-96 rounded-lg border border-gray-200 bg-white p-4 shadow-xl">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Columns</h3>
              <p className="text-xs text-gray-500">
                Add, remove, and reorder visible columns.
              </p>
            </div>

            <button
              type="button"
              className="text-xs font-medium text-gray-500 transition-colors hover:text-gray-700"
              onClick={() => {
                updateColumns(DEFAULT_LOGS_TABLE_COLUMNS);
              }}
            >
              Reset
            </button>
          </div>

          <div className="mt-4">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
              Selected
            </p>

            <div className="space-y-2">
              {selectedColumns.map(
                (column: LogsTableColumnOption, index: number) => {
                  const isFirst: boolean = index === 0;
                  const isLast: boolean = index === selectedColumns.length - 1;

                  return (
                    <div
                      key={column.id}
                      className="flex items-center justify-between rounded-md border border-gray-200 px-3 py-2"
                    >
                      <span className="min-w-0 truncate text-sm text-gray-700">
                        {column.label}
                      </span>

                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          className={actionButtonClassName}
                          onClick={() => {
                            moveColumn(column.id, -1);
                          }}
                          disabled={isFirst}
                        >
                          Up
                        </button>
                        <button
                          type="button"
                          className={actionButtonClassName}
                          onClick={() => {
                            moveColumn(column.id, 1);
                          }}
                          disabled={isLast}
                        >
                          Down
                        </button>
                        <button
                          type="button"
                          className={actionButtonClassName}
                          onClick={() => {
                            removeColumn(column.id);
                          }}
                          disabled={selectedColumns.length <= 1}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  );
                },
              )}
            </div>
          </div>

          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                Available
              </p>

              <input
                value={searchQuery}
                onChange={(event: ChangeEvent<HTMLInputElement>) => {
                  setSearchQuery(event.target.value);
                }}
                placeholder="Search columns"
                className="w-40 rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-600 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              />
            </div>

            <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
              {availableColumns.length === 0 && (
                <div className="rounded-md border border-dashed border-gray-200 px-3 py-4 text-sm text-gray-500">
                  No matching columns available.
                </div>
              )}

              {availableColumns.map((column: LogsTableColumnOption) => {
                return (
                  <div
                    key={column.id}
                    className="flex items-center justify-between rounded-md border border-gray-100 px-3 py-2"
                  >
                    <span className="min-w-0 truncate text-sm text-gray-700">
                      {column.label}
                    </span>

                    <button
                      type="button"
                      className={actionButtonClassName}
                      onClick={() => {
                        addColumn(column.id);
                      }}
                    >
                      Add
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ColumnSelector;
