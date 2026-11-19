import React, {
  ChangeEvent,
  FunctionComponent,
  ReactElement,
  useMemo,
  useRef,
  useState,
} from "react";
import { Translator } from "../../../Utils/TranslateTemplate";
import useTranslator from "../../../Utils/UseTranslator";
import {
  DEFAULT_LOGS_TABLE_COLUMNS,
  getLogsAttributeColumnId,
  LogsTableColumnOption,
  normalizeLogsTableColumns,
} from "../types";
import useComponentOutsideClick from "../../../Types/UseComponentOutsideClick";
import LayeredPopover from "../../Tooltip/LayeredPopover";

export interface ColumnSelectorProps {
  availableColumns: Array<LogsTableColumnOption>;
  selectedColumns: Array<string>;
  onChange: (columns: Array<string>) => void;
}

const triggerButtonClassName: string =
  "inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 shadow-sm transition-colors hover:border-gray-300 hover:bg-gray-50";

const actionButtonClassName: string =
  "rounded-md px-2 py-1 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700";

export const COLUMN_SELECTOR_PANEL_TEST_ID: string = "column-selector-panel";

const ColumnSelector: FunctionComponent<ColumnSelectorProps> = (
  props: ColumnSelectorProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const { ref, isComponentVisible, setIsComponentVisible } =
    useComponentOutsideClick(false);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const triggerRef: React.MutableRefObject<HTMLButtonElement | null> =
    useRef<HTMLButtonElement | null>(null);

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

  const trimmedAttributeKey: string = searchQuery.trim();
  const customAttributeColumnId: string = trimmedAttributeKey
    ? getLogsAttributeColumnId(trimmedAttributeKey)
    : "";
  const isCustomAttributeAlreadySelected: boolean =
    customAttributeColumnId !== "" &&
    selectedColumnIds.includes(customAttributeColumnId);
  const isCustomAttributeAlreadyAvailable: boolean = availableColumns.some(
    (column: LogsTableColumnOption): boolean => {
      return column.id === customAttributeColumnId;
    },
  );
  const canAddCustomAttribute: boolean =
    trimmedAttributeKey !== "" &&
    !isCustomAttributeAlreadySelected &&
    !isCustomAttributeAlreadyAvailable;

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
    /*
     * The panel is drawn over the page from its button, its end on the
     * button's end (LayeredPopover): inside the toolbar, under a list with
     * no filter bar, the list's card cut off all of it past the card's foot
     * (#9859). It stays inside the window's sides, so a 24rem panel never
     * runs off a phone wherever the wrapped toolbar puts the button.
     */
    <div ref={ref}>
      <button
        ref={triggerRef}
        type="button"
        className={triggerButtonClassName}
        onClick={() => {
          setIsComponentVisible(!isComponentVisible);
        }}
        aria-haspopup="dialog"
        aria-expanded={isComponentVisible}
      >
        <span>{translator.translateText("Columns")}</span>
        <span className="text-xs text-gray-500">
          {selectedColumnIds.length}
        </span>
      </button>

      {isComponentVisible && (
        <LayeredPopover
          anchorRef={triggerRef}
          ownerRef={ref}
          align="end"
          gap={8}
          onClose={() => {
            setIsComponentVisible(false);
          }}
        >
          <div
            className="w-96 max-w-[calc(100vw-1rem)] rounded-lg border border-gray-200 bg-white p-4 shadow-xl"
            data-testid={COLUMN_SELECTOR_PANEL_TEST_ID}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">
                  {translator.translateText("Columns")}
                </h3>
                <p className="text-xs text-gray-500">
                  {translator.translateText(
                    "Add, remove, and reorder visible columns.",
                  )}
                </p>
              </div>

              <button
                type="button"
                className="text-xs font-medium text-gray-500 transition-colors hover:text-gray-700"
                onClick={() => {
                  updateColumns(DEFAULT_LOGS_TABLE_COLUMNS);
                }}
              >
                {translator.translateText("Reset")}
              </button>
            </div>

            <div className="mt-4">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                {translator.translateText("Selected")}
              </p>

              <div className="space-y-2">
                {selectedColumns.map(
                  (column: LogsTableColumnOption, index: number) => {
                    const isFirst: boolean = index === 0;
                    const isLast: boolean =
                      index === selectedColumns.length - 1;

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
                            {translator.translateText("Up")}
                          </button>
                          <button
                            type="button"
                            className={actionButtonClassName}
                            onClick={() => {
                              moveColumn(column.id, 1);
                            }}
                            disabled={isLast}
                          >
                            {translator.translateText("Down")}
                          </button>
                          <button
                            type="button"
                            className={actionButtonClassName}
                            onClick={() => {
                              removeColumn(column.id);
                            }}
                            disabled={selectedColumns.length <= 1}
                          >
                            {translator.translateText("Remove")}
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
                <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                  {translator.translateText("Available")}
                </p>

                <input
                  data-unsaved-changes-ignore
                  value={searchQuery}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => {
                    setSearchQuery(event.target.value);
                  }}
                  onKeyDown={(
                    event: React.KeyboardEvent<HTMLInputElement>,
                  ): void => {
                    if (event.key === "Enter" && canAddCustomAttribute) {
                      event.preventDefault();
                      addColumn(customAttributeColumnId);
                      setSearchQuery("");
                    }
                  }}
                  placeholder={translator.translateText(
                    "Search or type attribute",
                  )}
                  className="w-48 rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-600 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                />
              </div>

              <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                {canAddCustomAttribute && (
                  <div className="flex items-center justify-between rounded-md border border-dashed border-indigo-200 bg-indigo-50/50 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-gray-700">
                        <span className="text-gray-500">
                          {translator.translateText("Attribute:")}{" "}
                        </span>
                        <span className="font-mono">{trimmedAttributeKey}</span>
                      </p>
                      <p className="text-xs text-gray-500">
                        {translator.translateText(
                          "Add as a column to show this attribute's value.",
                        )}
                      </p>
                    </div>

                    <button
                      type="button"
                      className="ml-3 rounded-md px-2 py-1 text-xs font-medium text-indigo-600 transition-colors hover:bg-indigo-100 hover:text-indigo-700"
                      onClick={() => {
                        addColumn(customAttributeColumnId);
                        setSearchQuery("");
                      }}
                    >
                      {translator.translateText("Add attribute")}
                    </button>
                  </div>
                )}

                {availableColumns.length === 0 && !canAddCustomAttribute && (
                  <div className="rounded-md border border-dashed border-gray-200 px-3 py-4 text-sm text-gray-500">
                    {translator.translateText(
                      trimmedAttributeKey
                        ? "No matching columns available."
                        : "Type an attribute name above to add it as a column.",
                    )}
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
                        {translator.translateText("Add")}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </LayeredPopover>
      )}
    </div>
  );
};

export default ColumnSelector;
