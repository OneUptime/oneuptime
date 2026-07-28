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
  Droppable,
  DroppableProvided,
  DropResult,
} from "react-beautiful-dnd";

export interface ComponentProps<
  TBaseModel extends BaseModel | AnalyticsBaseModel,
> {
  // Every customizable column, already in the order the table renders them.
  columns: Array<CustomizableColumn<TBaseModel>>;
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
      <div className="flex items-center gap-3 px-3 py-2">
        {data.dragHandle || <div className="w-4" />}

        <div className="flex-1 min-w-0">
          <CheckboxElement
            value={entry.isVisible}
            disabled={isOnlyVisibleColumn}
            dataTestId={`column-toggle-${entry.id}`}
            title={entry.column.title}
            onChange={(value: boolean) => {
              toggleColumn(entry.id, value);
            }}
          />
        </div>

        <div className="flex flex-none items-center gap-1">
          <Button
            buttonSize={ButtonSize.Small}
            buttonStyle={ButtonStyleType.ICON}
            icon={IconProp.ChevronUp}
            title=""
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
            dataTestId={`column-move-down-${entry.id}`}
            disabled={isSearching || index === entries.length - 1}
            onClick={() => {
              moveColumn(index, index + 1);
            }}
          />
        </div>
      </div>
    );
  };

  type GetListFunction = () => ReactElement;

  const getList: GetListFunction = (): ReactElement => {
    if (shownEntries.length === 0) {
      return (
        <div
          className="px-3 py-6 text-center text-sm text-gray-400"
          data-testid="column-customization-no-results"
        >
          No columns match &quot;{searchText}&quot;.
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
              >
                {shownEntries.map(
                  (entry: CustomizableColumn<TBaseModel>, index: number) => {
                    return (
                      <Draggable
                        draggableId={entry.id}
                        index={index}
                        key={entry.id}
                      >
                        {(draggableProvided: DraggableProvided) => {
                          return (
                            <div
                              ref={draggableProvided.innerRef}
                              {...draggableProvided.draggableProps}
                              className="bg-white"
                            >
                              {getRowContents({
                                entry,
                                index,
                                dragHandle: (
                                  <div
                                    {...draggableProvided.dragHandleProps}
                                    className="flex-none cursor-grab text-gray-400 hover:text-gray-600 active:cursor-grabbing"
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

  return (
    <Modal
      title={props.title || "Customize Columns"}
      description={
        props.description ||
        "Choose which columns to show and drag them into the order you want."
      }
      modalWidth={ModalWidth.Medium}
      icon={IconProp.TableCells}
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
            buttonSize={ButtonSize.Normal}
            buttonStyle={ButtonStyleType.OUTLINE}
            dataTestId="column-customization-reset"
            onClick={() => {
              props.onReset();
            }}
          />
        )
      }
    >
      <div className="space-y-3" data-testid="column-customization-modal">
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1">
            <Input
              type={InputType.TEXT}
              placeholder="Search columns..."
              value={searchText}
              dataTestId="column-customization-search"
              onChange={(value: string) => {
                setSearchText(value);
              }}
            />
          </div>
          <div className="flex flex-none gap-2">
            <Button
              title="Show all"
              buttonSize={ButtonSize.Small}
              buttonStyle={ButtonStyleType.OUTLINE}
              dataTestId="column-customization-show-all"
              onClick={() => {
                setAllVisible(true);
              }}
            />
            <Button
              title="Hide all"
              buttonSize={ButtonSize.Small}
              buttonStyle={ButtonStyleType.OUTLINE}
              dataTestId="column-customization-hide-all"
              onClick={() => {
                setAllVisible(false);
              }}
            />
          </div>
        </div>

        <div
          className="text-xs text-gray-500"
          data-testid="column-customization-count"
        >
          {visibleCount} of {entries.length} columns shown
        </div>

        <div className="rounded-md border border-gray-200 overflow-hidden">
          {getList()}
        </div>
      </div>
    </Modal>
  );
};

export default ColumnCustomizationModal;
