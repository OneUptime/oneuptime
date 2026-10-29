import ActionButtonSchema from "../ActionButton/ActionButtonSchema";
import { DetailValueContext } from "../Detail/DetailValueContext";
import {
  TableCardContext,
  TableCellContext,
  TableFoldedColumnsContext,
} from "./TableCellContext";
import TableRow from "./TableRow";
import Columns from "./Types/Columns";
import GenericObject from "../../../Types/GenericObject";
import { getRecordIdText } from "../ObjectID/RecordIdText";
import useTranslator from "../../Utils/UseTranslator";
import { Translator } from "../../Utils/TranslateTemplate";
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
  // The header's cell widths while a row is dragged (see Table).
  dragColumnWidths?: Array<number> | null | undefined;

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

  /*
   * The rows scroll sideways: the Actions cell, stuck at the right edge, is
   * ruled off from the cells passing under it (TableLayout).
   */
  isOverflowing?: boolean | undefined;

  // responsive
  isMobile?: boolean;
  /*
   * A column is left out here whose value the cells show in their own
   * place (Column.hideBelowLargeScreen, useAreTableColumnsFolded).
   */
  areColumnsFolded?: boolean | undefined;
}

type TableBodyFunction = <T extends GenericObject>(
  props: ComponentProps<T>,
) => ReactElement;

/*
 * The ids of the rows on the page, in order - the keys that keep each row
 * its own (see getRowKey below). Null where the table names no id field, or
 * a row has no id, or two rows share one: keyed by position then.
 */
export const getUniqueRowIds: <T extends GenericObject>(
  data: Array<T>,
  idField: keyof T | undefined,
) => Array<string> | null = <T extends GenericObject>(
  data: Array<T>,
  idField: keyof T | undefined,
): Array<string> | null => {
  if (idField === undefined) {
    return null;
  }

  const ids: Array<string> = [];
  const seen: Set<string> = new Set();

  for (const item of data) {
    const id: string = getRecordIdText(item?.[idField]);

    if (!id || seen.has(id)) {
      return null;
    }

    seen.add(id);
    ids.push(id);
  }

  return ids;
};

const TableBody: TableBodyFunction = <T extends GenericObject>(
  props: ComponentProps<T>,
): ReactElement => {
  const translator: Translator = useTranslator();

  type GetBodyFunction = (provided?: DroppableProvided) => ReactElement;

  /*
   * A row's React key: its record's id. Rows that move must keep their
   * identity - keyed by position, React would hand a moved row's state (an
   * open menu, a focused grip, a focused View button, labels opened) to
   * whichever row lands in its old place. Rows move when they are dragged,
   * and also when a list that keeps itself current (ModelTable/UseLiveRows)
   * reads a new incident in above them: keyed by position, the View the
   * keyboard was on became the next incident's, and Enter opened that one.
   *
   * Keyed by position still where the rows have no ids, or share one: React
   * needs each key once.
   */
  const rowIds: Array<string> | null = getUniqueRowIds(
    props.data,
    props.dragDropIdField,
  );

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

    return rowIds?.[index] ?? index;
  };

  const getDragProps: (index: number) => {
    dragIndex: number;
    isDragDisabled: boolean | undefined;
    dragDisabledReason: string | undefined;
    dragColumnWidths: Array<number> | null | undefined;
  } = (index: number) => {
    return {
      dragIndex: index,
      isDragDisabled: props.isDragDisabled,
      dragDisabledReason: props.dragDisabledReason,
      dragColumnWidths: props.dragColumnWidths,
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

    /*
     * "Select Checkout API", in the reader's words: the same sentence a
     * telemetry list's row box and a status page's resource box say.
     */
    const label: string | undefined = itemLabel
      ? translator.translateTemplate("Select {{name}}", { name: itemLabel })
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
          className="divide-y divide-gray-100 bg-white"
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
      >
        {props.data &&
          props.data.map((item: T, i: number) => {
            return (
              <TableRow
                isLastRow={i === props.data.length - 1}
                isOverflowing={props.isOverflowing}
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

  /*
   * A table's rows draw their cells as a table does - a record's labels on
   * the row's one line, the first two and "+N"; nothing to list as a quiet
   * dash (TableCellContext) - even where the table itself is drawn inside a
   * detail card's value (DetailValueContext). On a phone each row is a card
   * (TableCardContext), where a list's long names run onto the next line
   * instead of ending in "...".
   */
  return (
    <DetailValueContext.Provider value={false}>
      <TableCellContext.Provider value={true}>
        <TableCardContext.Provider value={Boolean(props.isMobile)}>
          <TableFoldedColumnsContext.Provider
            value={Boolean(props.areColumnsFolded)}
          >
            {props.enableDragAndDrop ? (
              <Droppable droppableId={props.dragAndDropScope || ""}>
                {(provided: DroppableProvided) => {
                  return getBody(provided);
                }}
              </Droppable>
            ) : (
              getBody()
            )}
          </TableFoldedColumnsContext.Provider>
        </TableCardContext.Provider>
      </TableCellContext.Provider>
    </DetailValueContext.Provider>
  );
};

export default TableBody;
