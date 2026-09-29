import { CustomizableColumn } from "./ColumnPreference";
import Button, { ButtonSize, ButtonStyleType } from "../Button/Button";
import CheckboxElement from "../Checkbox/Checkbox";
import Icon from "../Icon/Icon";
import Input, { InputType } from "../Input/Input";
import Modal, { ModalWidth } from "../Modal/Modal";
import AnalyticsBaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IconProp from "../../../Types/Icon/IconProp";
import React, { ReactElement, useMemo, useState } from "react";
import {
  DragDropContext,
  Draggable,
  DraggableProvided,
  DraggableStateSnapshot,
  Droppable,
  DroppableProvided,
  DropResult,
} from "react-beautiful-dnd";

/*
 * A pool of columns the viewer can bring INTO the picker, rather than one
 * checklist entry per possibility.
 *
 * Attribute columns are the motivating case: the keys inside a row's
 * `attributes` map differ per event class and per source, so a project can
 * easily have several hundred of them. Listing every one as a checkbox turns
 * "which columns do I want?" into a scroll through noise (and hands "Show all"
 * a way to put 500 columns on screen), so they are offered through a search
 * box that only materializes what was asked for.
 */
export interface AddableColumnsConfig<
  TBaseModel extends BaseModel | AnalyticsBaseModel,
> {
  title: string;
  description?: string | undefined;
  placeholder?: string | undefined;
  // Still fetching the pool. The section says so rather than reading as empty.
  isLoading?: boolean | undefined;
  errorMessage?: string | undefined;
  // Shown when the pool itself is empty, e.g. nothing has been ingested yet.
  emptyMessage?: string | undefined;
  /*
   * Every column that could be added, in the order they should be offered.
   * Ones already in the picker are filtered out here rather than by the
   * caller, so a column added and then removed reappears in the pool.
   */
  columns: Array<CustomizableColumn<TBaseModel>>;
  /*
   * How many matches to render at once. The pool can be in the thousands and
   * an unbounded list would put all of it in the DOM; the search box is what
   * gets you to the rest.
   */
  maxResults?: number | undefined;
}

export interface ComponentProps<
  TBaseModel extends BaseModel | AnalyticsBaseModel,
> {
  // Every customizable column, already in the order the table renders them.
  columns: Array<CustomizableColumn<TBaseModel>>;
  // Optional pool of columns the viewer can add. Omit to hide the whole section.
  addableColumns?: AddableColumnsConfig<TBaseModel> | undefined;
  onSave: (columns: Array<CustomizableColumn<TBaseModel>>) => void;
  onClose: () => void;
  // Drop the stored layout and go back to what the table ships with.
  onReset: () => void;
  title?: string | undefined;
  description?: string | undefined;
  /*
   * False once the viewer has customized anything, which is when Reset earns
   * its place in the footer.
   */
  isDefaultLayout?: boolean | undefined;
}

type ColumnCustomizationModalFunction = <
  TBaseModel extends BaseModel | AnalyticsBaseModel,
>(
  props: ComponentProps<TBaseModel>,
) => ReactElement;

/*
 * The "Customize Columns" picker: a checkbox and a drag handle per column.
 *
 * Two constraints shape it:
 *
 *  - The last visible column cannot be switched off. A table with no columns
 *    renders as an empty shell with no header row, and the only control that
 *    could undo that is the one the viewer just closed.
 *
 *  - Reordering is offered through Up/Down buttons as well as drag. Drag alone
 *    is unusable with a keyboard or a screen reader, and pointer-only
 *    reordering is also the part that cannot be exercised in tests.
 *
 * Changes are staged locally and only handed back on Save, so Cancel really
 * does cancel.
 */
const ColumnCustomizationModal: ColumnCustomizationModalFunction = <
  TBaseModel extends BaseModel | AnalyticsBaseModel,
>(
  props: ComponentProps<TBaseModel>,
): ReactElement => {
  const [entries, setEntries] = useState<Array<CustomizableColumn<TBaseModel>>>(
    [...props.columns],
  );
  const [searchText, setSearchText] = useState<string>("");

  const visibleCount: number = useMemo(() => {
    return entries.filter((entry: CustomizableColumn<TBaseModel>) => {
      return entry.isVisible;
    }).length;
  }, [entries]);

  const normalizedSearch: string = searchText.trim().toLowerCase();
  const isSearching: boolean = normalizedSearch.length > 0;

  const shownEntries: Array<CustomizableColumn<TBaseModel>> = useMemo(() => {
    if (!isSearching) {
      return entries;
    }

    return entries.filter((entry: CustomizableColumn<TBaseModel>) => {
      return (entry.column.title || "")
        .toLowerCase()
        .includes(normalizedSearch);
    });
  }, [entries, normalizedSearch, isSearching]);

  /*
   * Both bulk actions are switched off when they have nothing left to do -
   * "Show all" with everything already on is a no-op, and "Hide all" cannot go
   * below the one column that has to stay.
   */
  const isEverythingVisible: boolean = visibleCount === entries.length;
  const isOnlyOneVisible: boolean = visibleCount <= 1;

  /*
   * ---------------------------------------------------------------------
   * The "add a column" pool
   * ---------------------------------------------------------------------
   */
  const [addSearchText, setAddSearchText] = useState<string>("");

  const stagedIds: Set<string> = useMemo(() => {
    return new Set(
      entries.map((entry: CustomizableColumn<TBaseModel>) => {
        return entry.id;
      }),
    );
  }, [entries]);

  // Everything in the pool that is not already sitting in the list above.
  const addableColumns: Array<CustomizableColumn<TBaseModel>> = useMemo(() => {
    return (props.addableColumns?.columns || []).filter(
      (entry: CustomizableColumn<TBaseModel>) => {
        return !stagedIds.has(entry.id);
      },
    );
  }, [props.addableColumns?.columns, stagedIds]);

  const normalizedAddSearch: string = addSearchText.trim().toLowerCase();

  const matchingAddableColumns: Array<CustomizableColumn<TBaseModel>> =
    useMemo(() => {
      if (normalizedAddSearch.length === 0) {
        return addableColumns;
      }

      return addableColumns.filter((entry: CustomizableColumn<TBaseModel>) => {
        return (entry.column.title || "")
          .toLowerCase()
          .includes(normalizedAddSearch);
      });
    }, [addableColumns, normalizedAddSearch]);

  const addableResultLimit: number = props.addableColumns?.maxResults ?? 25;

  const shownAddableColumns: Array<CustomizableColumn<TBaseModel>> =
    useMemo(() => {
      return matchingAddableColumns.slice(0, addableResultLimit);
    }, [matchingAddableColumns, addableResultLimit]);

  type AddColumnFunction = (entry: CustomizableColumn<TBaseModel>) => void;

  /*
   * An added column goes on the end and starts visible. Adding a column you
   * then have to go and switch on would be a strange thing to ask of someone
   * who just searched for it by name.
   */
  const addColumn: AddColumnFunction = (
    entry: CustomizableColumn<TBaseModel>,
  ): void => {
    setEntries((current: Array<CustomizableColumn<TBaseModel>>) => {
      if (
        current.some((existing: CustomizableColumn<TBaseModel>) => {
          return existing.id === entry.id;
        })
      ) {
        return current;
      }

      return [...current, { ...entry, isVisible: true, isPinned: false }];
    });
  };

  type RemoveColumnFunction = (id: string) => void;

  const removeColumn: RemoveColumnFunction = (id: string): void => {
    setEntries((current: Array<CustomizableColumn<TBaseModel>>) => {
      const target: CustomizableColumn<TBaseModel> | undefined = current.find(
        (entry: CustomizableColumn<TBaseModel>) => {
          return entry.id === id;
        },
      );

      if (!target || !target.isRemovable) {
        return current;
      }

      /*
       * Removing is hiding plus forgetting, so it is bound by the same rule:
       * the last column standing cannot go.
       */
      const isLastVisible: boolean =
        target.isVisible &&
        current.filter((entry: CustomizableColumn<TBaseModel>) => {
          return entry.isVisible;
        }).length <= 1;

      if (isLastVisible) {
        return current;
      }

      return current.filter((entry: CustomizableColumn<TBaseModel>) => {
        return entry.id !== id;
      });
    });
  };

  type ToggleFunction = (id: string, isVisible: boolean) => void;

  const toggleColumn: ToggleFunction = (
    id: string,
    isVisible: boolean,
  ): void => {
    setEntries((current: Array<CustomizableColumn<TBaseModel>>) => {
      const isLastVisible: boolean =
        !isVisible &&
        current.filter((entry: CustomizableColumn<TBaseModel>) => {
          return entry.isVisible;
        }).length <= 1;

      if (isLastVisible) {
        // Refuse rather than render a table with nothing in it.
        return current;
      }

      return current.map((entry: CustomizableColumn<TBaseModel>) => {
        return entry.id === id ? { ...entry, isVisible } : entry;
      });
    });
  };

  type MoveFunction = (fromIndex: number, toIndex: number) => void;

  const moveColumn: MoveFunction = (
    fromIndex: number,
    toIndex: number,
  ): void => {
    setEntries((current: Array<CustomizableColumn<TBaseModel>>) => {
      if (
        fromIndex === toIndex ||
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= current.length ||
        toIndex >= current.length
      ) {
        return current;
      }

      const next: Array<CustomizableColumn<TBaseModel>> = [...current];
      const [moved] = next.splice(fromIndex, 1);

      if (!moved) {
        return current;
      }

      next.splice(toIndex, 0, moved);

      return next;
    });
  };

  type OnDragEndFunction = (result: DropResult) => void;

  const onDragEnd: OnDragEndFunction = (result: DropResult): void => {
    /*
     * Guard on the object, not on the index: a drop into the first slot has
     * `index === 0`, which a truthiness check would throw away.
     */
    if (!result.destination) {
      return;
    }

    moveColumn(result.source.index, result.destination.index);
  };

  type SetAllVisibleFunction = (isVisible: boolean) => void;

  const setAllVisible: SetAllVisibleFunction = (isVisible: boolean): void => {
    setEntries((current: Array<CustomizableColumn<TBaseModel>>) => {
      if (!isVisible) {
        /*
         * "Hide all" still has to leave one column standing, so it keeps the
         * first one - the leftmost, which is normally the row's name.
         */
        let isFirstKept: boolean = false;

        return current.map((entry: CustomizableColumn<TBaseModel>) => {
          if (!isFirstKept) {
            isFirstKept = true;
            return { ...entry, isVisible: true };
          }

          return { ...entry, isVisible: false };
        });
      }

      return current.map((entry: CustomizableColumn<TBaseModel>) => {
        return { ...entry, isVisible: true };
      });
    });
  };

  type GetBulkActionFunction = (data: {
    title: string;
    dataTestId: string;
    disabled: boolean;
    onClick: () => void;
  }) => ReactElement;

  /*
   * Rendered as plain buttons rather than through <Button>: these sit inside
   * the body as a compact pair, and the shared button styles are sized for a
   * footer.
   */
  const getBulkAction: GetBulkActionFunction = (data: {
    title: string;
    dataTestId: string;
    disabled: boolean;
    onClick: () => void;
  }): ReactElement => {
    return (
      <button
        type="button"
        data-testid={data.dataTestId}
        disabled={data.disabled}
        onClick={data.onClick}
        className="rounded-md px-2 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-white hover:text-gray-900 hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:text-gray-300 disabled:hover:bg-transparent disabled:hover:shadow-none"
      >
        {data.title}
      </button>
    );
  };

  type GetRowFunction = (data: {
    entry: CustomizableColumn<TBaseModel>;
    index: number;
    dragHandle?: ReactElement | undefined;
  }) => ReactElement;

  const getRowContents: GetRowFunction = (data: {
    entry: CustomizableColumn<TBaseModel>;
    index: number;
    dragHandle?: ReactElement | undefined;
  }): ReactElement => {
    const { entry, index } = data;

    const isOnlyVisibleColumn: boolean = entry.isVisible && visibleCount <= 1;

    return (
      <div className="group flex items-center gap-2 px-3 py-2 transition-colors hover:bg-gray-50">
        {data.dragHandle || <div className="w-5 flex-none" />}

        <div className="min-w-0 flex-1">
          <CheckboxElement
            value={entry.isVisible}
            disabled={isOnlyVisibleColumn}
            dataTestId={`column-toggle-${entry.id}`}
            outerDivClassName="relative flex items-center"
            title={
              <span
                className={
                  entry.isVisible
                    ? "text-sm font-medium text-gray-900"
                    : "text-sm font-normal text-gray-400"
                }
              >
                {entry.column.title}
              </span>
            }
            onChange={(value: boolean) => {
              toggleColumn(entry.id, value);
            }}
          />
        </div>

        {isOnlyVisibleColumn && (
          <span
            className="flex-none rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500"
            data-testid={`column-locked-${entry.id}`}
          >
            Required
          </span>
        )}

        <div className="flex flex-none items-center gap-0.5">
          <Button
            buttonSize={ButtonSize.Small}
            buttonStyle={ButtonStyleType.ICON}
            icon={IconProp.ChevronUp}
            title=""
            tooltip="Move up"
            ariaLabel={`Move ${entry.column.title} up`}
            className="text-gray-400 hover:bg-gray-200 hover:text-gray-700 disabled:text-gray-200 disabled:hover:bg-transparent"
            dataTestId={`column-move-up-${entry.id}`}
            disabled={isSearching || index === 0}
            onClick={() => {
              moveColumn(index, index - 1);
            }}
          />
          <Button
            buttonSize={ButtonSize.Small}
            buttonStyle={ButtonStyleType.ICON}
            icon={IconProp.ChevronDown}
            title=""
            tooltip="Move down"
            ariaLabel={`Move ${entry.column.title} down`}
            className="text-gray-400 hover:bg-gray-200 hover:text-gray-700 disabled:text-gray-200 disabled:hover:bg-transparent"
            dataTestId={`column-move-down-${entry.id}`}
            disabled={isSearching || index === entries.length - 1}
            onClick={() => {
              moveColumn(index, index + 1);
            }}
          />
          {entry.isRemovable && (
            <Button
              buttonSize={ButtonSize.Small}
              buttonStyle={ButtonStyleType.ICON}
              icon={IconProp.Close}
              title=""
              tooltip="Remove column"
              ariaLabel={`Remove ${entry.column.title}`}
              className="text-gray-400 hover:bg-red-100 hover:text-red-600 disabled:text-gray-200 disabled:hover:bg-transparent"
              dataTestId={`column-remove-${entry.id}`}
              disabled={isOnlyVisibleColumn}
              onClick={() => {
                removeColumn(entry.id);
              }}
            />
          )}
        </div>
      </div>
    );
  };

  type GetListFunction = () => ReactElement;

  const getList: GetListFunction = (): ReactElement => {
    if (shownEntries.length === 0) {
      return (
        <div
          className="flex flex-col items-center gap-2 px-3 py-10 text-center"
          data-testid="column-customization-no-results"
        >
          <Icon icon={IconProp.Search} className="h-6 w-6 text-gray-300" />
          <p className="text-sm text-gray-500">
            No columns match &quot;{searchText}&quot;.
          </p>
        </div>
      );
    }

    /*
     * Dragging a filtered list would move a column to a position that only
     * makes sense inside the filter, so while a search is active the list is
     * rendered plain and the reorder controls are disabled.
     */
    if (isSearching) {
      return (
        <div className="divide-y divide-gray-100">
          {shownEntries.map((entry: CustomizableColumn<TBaseModel>) => {
            return (
              <div key={entry.id}>
                {getRowContents({
                  entry,
                  index: entries.indexOf(entry),
                })}
              </div>
            );
          })}
        </div>
      );
    }

    return (
      <DragDropContext onDragEnd={onDragEnd}>
        <Droppable droppableId="model-table-columns">
          {(droppableProvided: DroppableProvided) => {
            return (
              <div
                ref={droppableProvided.innerRef}
                {...droppableProvided.droppableProps}
                className="divide-y divide-gray-100"
                aria-label="Columns"
              >
                {shownEntries.map(
                  (entry: CustomizableColumn<TBaseModel>, index: number) => {
                    return (
                      <Draggable
                        draggableId={entry.id}
                        index={index}
                        key={entry.id}
                      >
                        {(
                          draggableProvided: DraggableProvided,
                          draggableSnapshot: DraggableStateSnapshot,
                        ) => {
                          return (
                            <div
                              ref={draggableProvided.innerRef}
                              {...draggableProvided.draggableProps}
                              className={
                                draggableSnapshot.isDragging
                                  ? "rounded-md bg-white shadow-lg ring-1 ring-gray-200"
                                  : "bg-white"
                              }
                            >
                              {getRowContents({
                                entry,
                                index,
                                dragHandle: (
                                  <div
                                    {...draggableProvided.dragHandleProps}
                                    className="flex w-5 flex-none cursor-grab justify-center text-gray-300 transition-colors group-hover:text-gray-500 active:cursor-grabbing"
                                    aria-label={`Drag to reorder ${entry.column.title}`}
                                    title="Drag to reorder"
                                  >
                                    <Icon
                                      icon={IconProp.GripVertical}
                                      className="h-4 w-4"
                                    />
                                  </div>
                                ),
                              })}
                            </div>
                          );
                        }}
                      </Draggable>
                    );
                  },
                )}
                {droppableProvided.placeholder}
              </div>
            );
          }}
        </Droppable>
      </DragDropContext>
    );
  };

  type GetAddColumnSectionFunction = () => ReactElement;

  const getAddColumnSection: GetAddColumnSectionFunction = (): ReactElement => {
    const config: AddableColumnsConfig<TBaseModel> | undefined =
      props.addableColumns;

    if (!config) {
      return <></>;
    }

    type GetBodyFunction = () => ReactElement;

    const getBody: GetBodyFunction = (): ReactElement => {
      if (config.errorMessage) {
        return (
          <p
            className="px-3 py-4 text-sm text-red-500"
            data-testid="add-column-error"
          >
            {config.errorMessage}
          </p>
        );
      }

      if (config.isLoading) {
        return (
          <p
            className="px-3 py-4 text-sm text-gray-500"
            data-testid="add-column-loading"
          >
            Loading...
          </p>
        );
      }

      if (addableColumns.length === 0) {
        return (
          <p
            className="px-3 py-4 text-sm text-gray-500"
            data-testid="add-column-empty"
          >
            {(config.columns || []).length === 0
              ? config.emptyMessage || "Nothing to add."
              : "Every one of these is already in the list above."}
          </p>
        );
      }

      if (shownAddableColumns.length === 0) {
        return (
          <p
            className="px-3 py-4 text-sm text-gray-500"
            data-testid="add-column-no-results"
          >
            No matches for &quot;{addSearchText}&quot;.
          </p>
        );
      }

      return (
        <div className="divide-y divide-gray-100">
          {shownAddableColumns.map((entry: CustomizableColumn<TBaseModel>) => {
            return (
              <div
                key={entry.id}
                className="flex items-center gap-2 px-3 py-2 transition-colors hover:bg-gray-50"
              >
                <span className="min-w-0 flex-1 break-words text-sm text-gray-700">
                  {entry.column.title}
                </span>
                <Button
                  buttonSize={ButtonSize.Small}
                  buttonStyle={ButtonStyleType.ICON}
                  icon={IconProp.Add}
                  title=""
                  tooltip="Add column"
                  ariaLabel={`Add ${entry.column.title}`}
                  className="flex-none text-gray-400 hover:bg-gray-200 hover:text-gray-700"
                  dataTestId={`add-column-${entry.id}`}
                  onClick={() => {
                    addColumn(entry);
                  }}
                />
              </div>
            );
          })}
        </div>
      );
    };

    return (
      <div className="space-y-2 pt-1" data-testid="add-column-section">
        <div>
          <h4 className="text-sm font-medium text-gray-900">{config.title}</h4>
          {config.description ? (
            <p className="text-xs text-gray-500">{config.description}</p>
          ) : (
            <></>
          )}
        </div>

        <div className="relative">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
            <Icon icon={IconProp.Search} className="h-4 w-4 text-gray-400" />
          </div>
          <Input
            type={InputType.TEXT}
            placeholder={config.placeholder || "Search..."}
            value={addSearchText}
            dataTestId="add-column-search"
            outerDivClassName="w-full"
            className="block w-full rounded-md border border-gray-300 bg-white py-2 pl-9 pr-9 text-sm placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            onChange={(value: string) => {
              setAddSearchText(value);
            }}
          />
          {addSearchText.length > 0 && (
            <button
              type="button"
              aria-label="Clear search"
              title="Clear search"
              data-testid="add-column-search-clear"
              onClick={() => {
                setAddSearchText("");
              }}
              className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 transition-colors hover:text-gray-600 focus:outline-none focus-visible:text-gray-600"
            >
              <Icon icon={IconProp.Close} className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="max-h-48 overflow-y-auto overscroll-contain rounded-md border border-gray-200 bg-white">
          {getBody()}
        </div>

        {/*
         * Said out loud rather than silently truncating: a viewer who cannot
         * see their key otherwise has no way to know that typing more of it
         * would find it.
         */}
        {matchingAddableColumns.length > shownAddableColumns.length && (
          <p className="text-xs text-gray-400" data-testid="add-column-hint">
            Showing {shownAddableColumns.length} of{" "}
            {matchingAddableColumns.length}. Search to narrow this down.
          </p>
        )}
      </div>
    );
  };

  return (
    <Modal
      title={props.title || "Customize Columns"}
      description={
        props.description ||
        "Choose which columns to show and drag them into the order you want."
      }
      modalWidth={ModalWidth.Medium}
      submitButtonText="Save"
      closeButtonText="Cancel"
      onClose={props.onClose}
      onSubmit={() => {
        props.onSave(entries);
      }}
      leftFooterElement={
        props.isDefaultLayout ? (
          <></>
        ) : (
          <Button
            title="Reset to default"
            icon={IconProp.Refresh}
            buttonSize={ButtonSize.Normal}
            buttonStyle={ButtonStyleType.NORMAL}
            dataTestId="column-customization-reset"
            onClick={() => {
              props.onReset();
            }}
          />
        )
      }
    >
      <div className="space-y-3" data-testid="column-customization-modal">
        <div className="relative">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
            <Icon icon={IconProp.Search} className="h-4 w-4 text-gray-400" />
          </div>
          <Input
            type={InputType.TEXT}
            placeholder="Search columns..."
            value={searchText}
            dataTestId="column-customization-search"
            outerDivClassName="w-full"
            className="block w-full rounded-md border border-gray-300 bg-white py-2 pl-9 pr-9 text-sm placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            onChange={(value: string) => {
              setSearchText(value);
            }}
          />
          {searchText.length > 0 && (
            <button
              type="button"
              aria-label="Clear search"
              title="Clear search"
              data-testid="column-customization-search-clear"
              onClick={() => {
                setSearchText("");
              }}
              className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 transition-colors hover:text-gray-600 focus:outline-none focus-visible:text-gray-600"
            >
              <Icon icon={IconProp.Close} className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex items-center justify-between gap-3">
          <div
            className="text-xs font-medium text-gray-500"
            data-testid="column-customization-count"
          >
            {visibleCount} of {entries.length} columns shown
          </div>
          <div className="flex flex-none items-center gap-1 rounded-md bg-gray-50 p-0.5 ring-1 ring-inset ring-gray-200">
            {getBulkAction({
              title: "Show all",
              dataTestId: "column-customization-show-all",
              disabled: isEverythingVisible,
              onClick: () => {
                setAllVisible(true);
              },
            })}
            {getBulkAction({
              title: "Hide all",
              dataTestId: "column-customization-hide-all",
              disabled: isOnlyOneVisible,
              onClick: () => {
                setAllVisible(false);
              },
            })}
          </div>
        </div>

        <div className="max-h-80 overflow-y-auto overscroll-contain rounded-md border border-gray-200 bg-white">
          {getList()}
        </div>

        <p
          className="text-xs text-gray-400"
          data-testid="column-customization-hint"
        >
          {isSearching
            ? "Clear the search to reorder columns."
            : "Drag a row, or use the arrows, to change the column order."}
        </p>

        {getAddColumnSection()}
      </div>
    </Modal>
  );
};

export default ColumnCustomizationModal;
