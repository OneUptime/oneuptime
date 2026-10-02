import ActionButtonSchema from "../ActionButton/ActionButtonSchema";
import TableRow from "./TableRow";
import Columns from "./Types/Columns";
import GenericObject from "../../../Types/GenericObject";
import React, { ReactElement } from "react";
import { Droppable, DroppableProvided } from "react-beautiful-dnd";

export interface ComponentProps<T extends GenericObject> {
  data: Array<T>;
  getRowProps?: ((item: T) => React.HTMLAttributes<HTMLElement>) | undefined;
  id: string;
  columns: Columns<T>;
  actionButtons?: undefined | Array<ActionButtonSchema<T>> | undefined;
  enableDragAndDrop?: undefined | boolean;
  dragAndDropScope?: string | undefined;
  dragDropIdField?: keyof T | undefined;
  dragDropIndexField?: keyof T | undefined;
  isDragDisabled?: boolean | undefined;
  dragDisabledReason?: string | undefined;

  // bulk actions
  isBulkActionsEnabled?: undefined | boolean;
  onItemSelected?: undefined | ((item: T) => void);
  onItemDeselected?: undefined | ((item: T) => void);
  selectedItems: Array<T>;
  matchBulkSelectedItemByField: keyof T | undefined; // which field to use to match selected items. For exmaple this could be '_id'
  /*
   * Which rows may be ticked at all. Absent means every row, so a table that
   * does not care is unaffected. See TableRow.isItemSelectable.
   */
  isItemSelectable?: ((item: T) => boolean) | undefined;
  /** The accessible name for a row's checkbox: "Select {this}". */
  bulkItemToString?: ((item: T) => string) | undefined;
  /** Why a locked row is locked, in the caller's own words. */
  itemNotSelectableReason?: ((item: T) => string) | undefined;

  // responsive
  isMobile?: boolean;
}

type TableBodyFunction = <T extends GenericObject>(
  props: ComponentProps<T>,
) => ReactElement;

const TableBody: TableBodyFunction = <T extends GenericObject>(
  props: ComponentProps<T>,
): ReactElement => {
  type GetBodyFunction = (provided?: DroppableProvided) => ReactElement;

  /*
   * A row's React key: its id when the list can be dragged. Rows that move
   * must keep their identity - keyed by position, React would hand a moved
   * row's state (an open menu, a focused grip) to whichever row lands in
   * its old place.
   */
  const getRowKey: (item: T, index: number) => string | number = (
    item: T,
    index: number,
  ): string | number => {
    if (props.enableDragAndDrop && props.dragDropIdField) {
      const id: string | undefined = item[props.dragDropIdField]?.toString();

      if (id) {
        return id;
      }
    }

    return index;
  };

  const getDragProps: (index: number) => {
    dragIndex: number;
    isDragDisabled: boolean | undefined;
    dragDisabledReason: string | undefined;
  } = (index: number) => {
    return {
      dragIndex: index,
      isDragDisabled: props.isDragDisabled,
      dragDisabledReason: props.dragDisabledReason,
    };
  };

  /*
   * Everything about ONE row's checkbox, computed once and spread into both the
   * desktop and the mobile TableRow. The selected-ness test used to be written
   * out twice, identically, a hundred lines apart; adding three more selection
   * props to both copies is how that kind of duplication turns into a row that
   * is locked at one breakpoint and not the other.
   */
  type SelectionPropsFunction = (item: T) => {
    isItemSelected: boolean;
    isItemSelectable: boolean;
    itemSelectLabel: string | undefined;
    itemNotSelectableReason: string | undefined;
    itemLabel: string | undefined;
  };

  const getSelectionProps: SelectionPropsFunction = (item: T) => {
    const matchBy: keyof T | undefined = props.matchBulkSelectedItemByField;

    const isItemSelected: boolean = Boolean(
      matchBy !== undefined &&
        props.selectedItems?.some((selectedItem: T) => {
          return (
            selectedItem[matchBy]?.toString() === item[matchBy]?.toString()
          );
        }),
    );

    const itemLabel: string | undefined = props.bulkItemToString
      ? props.bulkItemToString(item)
      : undefined;

    const label: string | undefined = itemLabel
      ? `Select ${itemLabel}`
      : undefined;

    return {
      isItemSelected: isItemSelected,
      isItemSelectable: props.isItemSelectable
        ? props.isItemSelectable(item)
        : true,
      itemSelectLabel: label,
      itemNotSelectableReason: props.itemNotSelectableReason
        ? props.itemNotSelectableReason(item)
        : undefined,
      itemLabel: itemLabel,
    };
  };

  const getBody: GetBodyFunction = (
    provided?: DroppableProvided,
  ): ReactElement => {
    // Mobile view: render as list
    if (props.isMobile) {
      return (
        <div
          id={props.id}
          ref={provided?.innerRef}
          {...provided?.droppableProps}
          className="divide-y divide-gray-200 bg-white"
        >
          {props.data &&
            props.data.map((item: T, i: number) => {
              return (
                <TableRow
                  isBulkActionsEnabled={props.isBulkActionsEnabled}
                  onItemSelected={props.onItemSelected}
                  onItemDeselected={props.onItemDeselected}
                  {...getSelectionProps(item)}
                  dragAndDropScope={props.dragAndDropScope}
                  enableDragAndDrop={props.enableDragAndDrop}
                  key={getRowKey(item, i)}
                  {...getDragProps(i)}
                  item={item}
                  rowProps={props.getRowProps?.(item)}
                  columns={props.columns}
                  actionButtons={props.actionButtons}
                  dragDropIdField={props.dragDropIdField}
                  dragDropIndexField={props.dragDropIndexField}
                  isMobile={true}
                />
              );
            })}
          {provided?.placeholder}
        </div>
      );
    }

    // Desktop view: render as table
    return (
      <tbody
        id={props.id}
        ref={provided?.innerRef}
        {...provided?.droppableProps}
        className="divide-y divide-gray-200 bg-white"
      >
        {props.data &&
          props.data.map((item: T, i: number) => {
            return (
              <TableRow
                isBulkActionsEnabled={props.isBulkActionsEnabled}
                onItemSelected={props.onItemSelected}
                onItemDeselected={props.onItemDeselected}
                {...getSelectionProps(item)}
                dragAndDropScope={props.dragAndDropScope}
                enableDragAndDrop={props.enableDragAndDrop}
                key={getRowKey(item, i)}
                {...getDragProps(i)}
                item={item}
                rowProps={props.getRowProps?.(item)}
                columns={props.columns}
                actionButtons={props.actionButtons}
                dragDropIdField={props.dragDropIdField}
                dragDropIndexField={props.dragDropIndexField}
                isMobile={false}
              />
            );
          })}
        {provided?.placeholder}
      </tbody>
    );
  };

  if (props.enableDragAndDrop) {
    return (
      <Droppable droppableId={props.dragAndDropScope || ""}>
        {(provided: DroppableProvided) => {
          return getBody(provided);
        }}
      </Droppable>
    );
  }
  return getBody();
};

export default TableBody;
