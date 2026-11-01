import ActionButtonSchema from "../ActionButton/ActionButtonSchema";
import RowActions from "../ActionButton/RowActions";
import { ButtonStyleType } from "../Button/Button";
import CheckboxElement from "../Checkbox/Checkbox";
import ColorInput from "../ColorViewer/ColorViewer";
import Icon, { ThickProp } from "../Icon/Icon";
import ConfirmModal from "../Modal/ConfirmModal";
import FieldType from "../Types/FieldType";
import Column from "./Types/Column";
import {
  getTableCellClassName,
  getTableCellContentClassName,
  isFillingNameColumn,
  isGivingValueColumn,
} from "./CellClassName";
import {
  TABLE_ACTIONS_CONTENT_CLASS_NAME,
  TABLE_CLICKABLE_ROW_CLASS_NAME,
  TABLE_DRAG_HANDLE_CELL_CLASS_NAME,
  TABLE_END_FILLER_BODY_CELL_CLASS_NAME,
  TABLE_END_FILLER_TEST_ID,
  TABLE_MOBILE_FIELD_CLASS_NAME,
  TABLE_MOBILE_FIELD_NAME_CLASS_NAME,
  TABLE_MOBILE_FIELD_VALUE_CLASS_NAME,
  TABLE_MOBILE_ROW_CLASS_NAME,
  TABLE_MOBILE_SELECTED_ROW_CLASS_NAME,
  TABLE_ROW_CLASS_NAME,
  TABLE_ROW_RULE_CLASS_NAME,
  TABLE_SELECT_CELL_CLASS_NAME,
  TABLE_SELECTED_ROW_CLASS_NAME,
  TABLE_STICKY_END_BODY_CELL_CLASS_NAME,
  TABLE_STUCK_END_CELL_CLASS_NAME,
  getTableCellPaddingClassName,
} from "./TableLayout";
import { TABLE_STICKY_END_ATTRIBUTE } from "./TableStickyEndFocus";
import TableEmptyValue, { isDashPlaceholder } from "./TableEmptyValue";
import { showFullValueWhenCutShort } from "./FullValueTitle";
import Columns from "./Types/Columns";
import Color from "../../../Types/Color";
import OneUptimeDate from "../../../Types/Date";
import GenericObject from "../../../Types/GenericObject";
import IconProp from "../../../Types/Icon/IconProp";
import useTranslateValue from "../../Utils/Translation";
import React, { ReactElement, useState, useEffect } from "react";
import {
  Draggable,
  DraggableProvided,
  DraggableStateSnapshot,
} from "react-beautiful-dnd";
import LongTextViewer from "../LongText/LongTextViewer";
import IsolatedText from "../IsolatedText/IsolatedText";
import InfoTooltip from "../Tooltip/InfoTooltip";
import DragHandle from "./DragHandle";

export interface ComponentProps<T extends GenericObject> {
  item: T;
  rowProps?: React.HTMLAttributes<HTMLElement> | undefined;
  columns: Columns<T>;
  actionButtons?: Array<ActionButtonSchema<T>> | undefined;
  enableDragAndDrop?: boolean | undefined;
  dragAndDropScope?: string | undefined;
  dragDropIdField?: keyof T | undefined;
  dragDropIndexField?: keyof T | undefined;
  /*
   * Where this row is in the list on screen - what react-beautiful-dnd needs
   * as the Draggable's index (0, 1, 2... with no gaps). It used to be handed
   * the row's stored order number instead, which broke the moment those
   * numbers started at 1, skipped one or repeated.
   */
  dragIndex?: number | undefined;
  // Reordering is off for now (a filter is on, or a move is being saved).
  isDragDisabled?: boolean | undefined;
  // Why, in the caller's words - shown on the grip.
  dragDisabledReason?: string | undefined;
  /*
   * The header's cell widths, taken as a drag starts: the lifted row keeps
   * them so it still lines up with its columns (see Table).
   */
  dragColumnWidths?: Array<number> | null | undefined;

  // bulk actions
  isBulkActionsEnabled?: undefined | boolean;
  onItemSelected?: undefined | ((item: T) => void);
  onItemDeselected?: undefined | ((item: T) => void);
  isItemSelected?: boolean | undefined;
  /*
   * FALSE locks this row's checkbox. Defaulted true by the caller, so a table
   * that says nothing about selectability keeps behaving exactly as before.
   *
   * A locked box is better than an unlocked one that fails afterwards whenever
   * the reason is knowable up front: the action a bulk selection leads to is
   * usually irreversible from the user's side (mail sent, rows deleted), and
   * "you cannot pick this, here is why" costs one hover where "you picked it and
   * nothing happened" costs a support conversation.
   */
  isItemSelectable?: boolean | undefined;
  /*
   * The accessible name for this row's checkbox - "Select Ada Lovelace" rather
   * than an unnamed box repeated once per row.
   */
  itemSelectLabel?: string | undefined;
  /** Hover text for a row whose box is locked. Says why, in the caller's words. */
  itemNotSelectableReason?: string | undefined;
  /** What this row is ("Monitor: Checkout API"), for its ⋯ menu's name. */
  itemLabel?: string | undefined;

  /*
   * The last row of the page draws no rule under itself: the footer's own
   * rule is right under it.
   */
  isLastRow?: boolean | undefined;
  /*
   * The rows scroll sideways (the columns are wider than the card): the
   * Actions cell, which sticks at the right edge, is ruled off from the
   * cells passing under it.
   */
  isOverflowing?: boolean | undefined;
  /*
   * A cell after the columns, as the header draws one, to take the room
   * the columns a person sized leave (TableLayout).
   */
  hasEndFiller?: boolean | undefined;

  // responsive
  isMobile?: boolean;
}

type TableRowFunction = <T extends GenericObject>(
  props: ComponentProps<T>,
) => ReactElement;

const TableRow: TableRowFunction = <T extends GenericObject>(
  props: ComponentProps<T>,
): ReactElement => {
  // Helper function to get nested property values using dot notation
  const getNestedValue: (obj: any, path: string) => any = (
    obj: any,
    path: string,
  ): any => {
    return path.split(".").reduce((current: any, key: string) => {
      return current?.[key];
    }, obj);
  };

  const [tooltipModalText, setTooltipModalText] = useState<string>("");

  /*
   * On a phone a row is a card that labels each value with its column's
   * title, which TableHeader - hidden there - would otherwise have
   * translated.
   */
  const { translateString } = useTranslateValue();

  // Track mobile view for responsive behavior
  const [isMobile, setIsMobile] = useState<boolean>(false);

  useEffect(() => {
    const checkMobile: () => void = (): void => {
      setIsMobile(window.innerWidth < 768); // md breakpoint
    };

    checkMobile();
    window.addEventListener("resize", checkMobile);

    return () => {
      window.removeEventListener("resize", checkMobile);
    };
  }, []);

  /*
   * The local isMobile state above starts false and is only corrected inside
   * an effect, i.e. after the first paint. TableBody already knows which
   * layout it is mounting and says so explicitly, so prefer what it passed:
   * without this, a mobile card renders its hideOnMobile columns for one frame
   * and then drops them, which is a visible jump on exactly the narrow screens
   * the flag exists to protect.
   */
  const isMobileView: boolean = props.isMobile ?? isMobile;

  // The columns this row will actually put on screen.
  const renderedColumns: Array<Column<T>> = (props.columns || []).filter(
    (column: Column<T>) => {
      return !(column.hideOnMobile && isMobileView);
    },
  );

  /*
   * Absent means selectable, so every existing caller is unaffected. Only an
   * explicit false locks the box.
   */
  const isItemSelectable: boolean = props.isItemSelectable !== false;

  /*
   * A row that opens its record on a click (its page hands it an onClick)
   * takes the pointer's hand, as a link does.
   */
  const isClickable: boolean = Boolean(props.rowProps?.onClick);

  /*
   * The bulk-select box, identical on the mobile card and the desktop row. It is
   * one function rather than two copies because the two used to drift: the
   * mobile copy still has no `disabled` handling of its own, and a locked row
   * that is only locked at one breakpoint is not locked.
   */
  const getBulkSelectCheckbox: () => ReactElement = (): ReactElement => {
    return (
      <CheckboxElement
        value={Boolean(props.isItemSelected)}
        disabled={!isItemSelectable}
        ariaLabel={props.itemSelectLabel}
        hoverText={
          isItemSelectable
            ? props.itemSelectLabel
            : props.itemNotSelectableReason || props.itemSelectLabel
        }
        onChange={(value: boolean) => {
          if (!isItemSelectable) {
            return;
          }

          if (value) {
            props.onItemSelected?.(props.item);
          } else {
            props.onItemDeselected?.(props.item);
          }
        }}
      />
    );
  };

  type GetRowFunction = (
    provided?: DraggableProvided,
    snapshot?: DraggableStateSnapshot,
  ) => ReactElement;

  const getDragHandle: (provided?: DraggableProvided) => ReactElement = (
    provided?: DraggableProvided,
  ): ReactElement => {
    return (
      <DragHandle
        dragHandleProps={provided?.dragHandleProps}
        itemLabel={props.itemLabel}
        isDisabled={props.isDragDisabled}
        disabledReason={props.dragDisabledReason}
      />
    );
  };

  /*
   * A cell's value, read off the row the way its column says. Undefined for
   * a column with nothing to draw (no key); an empty value is the quiet dash
   * (TableEmptyValue), or the column's own words when it has some.
   */
  const getColumnContent: (column: Column<T>) => React.ReactNode = (
    column: Column<T>,
  ): React.ReactNode => {
    if (!column.key) {
      return null;
    }

    if (column.getElement) {
      const element: ReactElement = column.getElement(props.item);

      return isDashPlaceholder(element) ? <TableEmptyValue /> : element;
    }

    const value: unknown = props.item[column.key];

    /*
     * A missing value: the column's own words in the grey an absent value
     * is drawn in, or a dash.
     */
    const getNoValue: () => ReactElement = (): ReactElement => {
      if (column.noValueMessage) {
        return (
          <span className="text-gray-500">
            {translateString(column.noValueMessage) ?? column.noValueMessage}
          </span>
        );
      }

      return <TableEmptyValue />;
    };

    switch (column.type) {
      case FieldType.Date:
      case FieldType.DateTime:
        return value
          ? OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
              value as string,
              column.type === FieldType.Date,
            )
          : getNoValue();
      case FieldType.USDCents:
        return value
          ? ((value as number) || 0) / 100 + " USD"
          : column.noValueMessage || "0 USD";
      case FieldType.Percent:
        return value ? value + "%" : column.noValueMessage || "0%";
      case FieldType.Color:
        return value ? <ColorInput value={value as Color} /> : getNoValue();
      case FieldType.LongText:
        return value ? <LongTextViewer text={value as string} /> : getNoValue();
      case FieldType.Boolean:
        /*
         * Yes is a tick; No is the quiet dash - a column of crosses down
         * every row that is off read louder than the few that are on. A
         * screen reader hears the word either way.
         */
        return value ? (
          <span
            className="inline-flex h-6 items-center text-gray-700"
            data-testid="table-boolean-yes"
          >
            <Icon
              icon={IconProp.Check}
              className="h-5 w-5"
              thick={ThickProp.Thick}
            />
            <span className="sr-only">{translateString("Yes") ?? "Yes"}</span>
          </span>
        ) : (
          <TableEmptyValue screenReaderText="No" />
        );
      default: {
        const text: string | undefined = getNestedValue(
          props.item,
          String(column.key),
        )?.toString();

        /*
         * Read the way it is written: an English description in a Persian
         * table keeps its full stop at its end (IsolatedText).
         */
        return text ? <IsolatedText text={text} /> : getNoValue();
      }
    }
  };

  const getRow: GetRowFunction = (
    provided?: DraggableProvided,
    snapshot?: DraggableStateSnapshot,
  ): ReactElement => {
    /*
     * The row being dragged floats above the others, so it reads as picked
     * up rather than as a row that lost its place.
     */
    const draggingClassName: string = snapshot?.isDragging
      ? "shadow-lg ring-1 ring-gray-200"
      : "";

    // Mobile view: render as a card
    if (props.isMobile) {
      return (
        <>
          <div
            {...props.rowProps}
            {...provided?.draggableProps}
            ref={provided?.innerRef}
            className={[
              props.isItemSelected
                ? TABLE_MOBILE_SELECTED_ROW_CLASS_NAME
                : TABLE_MOBILE_ROW_CLASS_NAME,
              isClickable
                ? `${TABLE_CLICKABLE_ROW_CLASS_NAME} active:bg-gray-100`
                : "",
              draggingClassName,
              props.rowProps?.className || "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {/*
             * The card's controls - its grip and its select box - share one
             * line above its fields rather than stacking a line each.
             */}
            {props.enableDragAndDrop || props.isBulkActionsEnabled ? (
              /*
               * -ml-1 lines the grip's dots up with the fields' words, its
               * hit area being wider than they are; a select box alone
               * lines up as it is.
               */
              <div
                className={`mb-3 flex items-center gap-2${
                  props.enableDragAndDrop ? " -ml-1" : ""
                }`}
              >
                {props.enableDragAndDrop ? getDragHandle(provided) : <></>}
                {props.isBulkActionsEnabled ? getBulkSelectCheckbox() : <></>}
              </div>
            ) : (
              <></>
            )}

            <dl className="space-y-2.5">
              {renderedColumns.map((column: Column<T>, i: number) => {
                if (column.type === FieldType.Actions) {
                  const customAction: ReactElement | null = column.getElement
                    ? column.getElement(props.item)
                    : null;

                  return (
                    <div
                      key={i}
                      className="flex flex-wrap items-center gap-2 pt-1"
                    >
                      {customAction}
                      <RowActions<T>
                        item={props.item}
                        actionButtons={props.actionButtons}
                        isMobile={true}
                        className="justify-start"
                        itemLabel={props.itemLabel}
                      />
                    </div>
                  );
                }

                /*
                 * A plain yes/no field says nothing when it is no, as the
                 * table's quiet dash does. A column that draws its own
                 * element says what it says either way - a rule's Status
                 * is "Disabled" as surely as "Enabled", and a card that
                 * left it out drew a disabled rule like an enabled one.
                 */
                const value: React.ReactNode =
                  column.key &&
                  column.type === FieldType.Boolean &&
                  !column.getElement
                    ? props.item[column.key]
                      ? getColumnContent(column)
                      : null
                    : getColumnContent(column);

                // A card leaves out the fields that have nothing to say.
                if (
                  !value ||
                  (typeof value === "string" && value.trim() === "") ||
                  (React.isValidElement(value) &&
                    value.type === TableEmptyValue)
                ) {
                  return null;
                }

                return (
                  <div
                    key={i}
                    className={TABLE_MOBILE_FIELD_CLASS_NAME}
                    onClick={() => {
                      if (column.tooltipText) {
                        setTooltipModalText(column.tooltipText(props.item));
                      }
                    }}
                  >
                    <dt
                      className={
                        column.hideTitleOnMobile
                          ? "sr-only"
                          : TABLE_MOBILE_FIELD_NAME_CLASS_NAME
                      }
                    >
                      {/*
                       * A card has no header row, so the (i) a column's
                       * header carries on a wide screen sits beside the
                       * field's name here - or what the column's numbers
                       * mean could not be asked on a phone at all.
                       */}
                      {column.headerTooltip?.trim() &&
                      !column.hideTitleOnMobile ? (
                        <span className="inline-flex items-center gap-1">
                          <span>
                            {translateString(column.title) ?? column.title}
                          </span>
                          <InfoTooltip
                            label={column.title}
                            text={column.headerTooltip}
                          />
                        </span>
                      ) : (
                        translateString(column.title) ?? column.title
                      )}
                    </dt>
                    <dd
                      className={
                        i === 0
                          ? `${TABLE_MOBILE_FIELD_VALUE_CLASS_NAME} font-medium`
                          : TABLE_MOBILE_FIELD_VALUE_CLASS_NAME
                      }
                    >
                      {value}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </div>
          {tooltipModalText && (
            <ConfirmModal
              title={`Help`}
              description={`${tooltipModalText}`}
              submitButtonText={"Close"}
              onSubmit={() => {
                setTooltipModalText("");
              }}
              submitButtonType={ButtonStyleType.NORMAL}
            />
          )}
        </>
      );
    }

    /*
     * While lifted, the row is laid out on its own: as a fixed-layout table
     * whose cells keep the widths of the header cells above them.
     */
    const lockedWidths: Array<number> | null =
      snapshot?.isDragging && props.dragColumnWidths
        ? props.dragColumnWidths
        : null;

    let cellIndex: number = 0;

    const getLockedCellStyle: () => React.CSSProperties | undefined = ():
      | React.CSSProperties
      | undefined => {
      const width: number | undefined = lockedWidths
        ? lockedWidths[cellIndex]
        : undefined;

      cellIndex++;

      return width
        ? { width: width, minWidth: width, maxWidth: width }
        : undefined;
    };

    const rowStyle: React.CSSProperties | undefined = lockedWidths
      ? {
          ...(provided?.draggableProps.style || {}),
          display: "table",
          tableLayout: "fixed",
        }
      : provided?.draggableProps.style;

    // The cells the row draws before its columns: a grip, then a select box.
    const leadingCellCount: number =
      (props.enableDragAndDrop ? 1 : 0) + (props.isBulkActionsEnabled ? 1 : 0);

    const ruleClassName: string = props.isLastRow
      ? ""
      : ` ${TABLE_ROW_RULE_CLASS_NAME}`;

    // Desktop view: render as table row
    return (
      <>
        <tr
          {...props.rowProps}
          {...provided?.draggableProps}
          style={rowStyle}
          ref={provided?.innerRef}
          data-selected={props.isItemSelected ? "true" : undefined}
          className={[
            props.isItemSelected
              ? TABLE_SELECTED_ROW_CLASS_NAME
              : TABLE_ROW_CLASS_NAME,
            isClickable ? TABLE_CLICKABLE_ROW_CLASS_NAME : "",
            snapshot?.isDragging ? draggingClassName : "",
            props.rowProps?.className || "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {props.enableDragAndDrop && (
            <td
              className={`${TABLE_DRAG_HANDLE_CELL_CLASS_NAME} ${getTableCellPaddingClassName(
                { isFirst: true, isLast: false },
              )}${ruleClassName}`}
              style={getLockedCellStyle()}
            >
              {/*
               * In a flex box, not on a line of text: set on the cell's
               * line, the 28px grip took the line's spacing under it too,
               * and every row of a drag-ordered list stood 3px taller.
               */}
              <div className="flex">{getDragHandle(provided)}</div>
            </td>
          )}
          {props.isBulkActionsEnabled && (
            <td
              className={`${TABLE_SELECT_CELL_CLASS_NAME} ${getTableCellPaddingClassName(
                { isFirst: !props.enableDragAndDrop, isLast: false },
              )}${ruleClassName}`}
              style={getLockedCellStyle()}
            >
              {getBulkSelectCheckbox()}
            </td>
          )}
          {props.columns &&
            renderedColumns.map((column: Column<T>, i: number) => {
              const isActions: boolean = column.type === FieldType.Actions;

              /*
               * Shared with the loading skeleton, so the two can no longer
               * drift, and the one place that decides whether this cell's
               * text may wrap.
               */
              const className: string = getTableCellClassName<T>({
                column: column,
                isLastRenderedColumn: i === renderedColumns.length - 1,
                isFirstRenderedCell: leadingCellCount === 0 && i === 0,
                isLastRow: props.isLastRow,
                isPrimaryColumn: i === 0,
              });

              /*
               * The Actions cell sticks at the table's right edge, and when
               * the rows scroll sideways is ruled off from the cells passing
               * under it.
               */
              const stickyClassName: string = isActions
                ? ` ${TABLE_STICKY_END_BODY_CELL_CLASS_NAME}${
                    props.isOverflowing
                      ? ` ${TABLE_STUCK_END_CELL_CLASS_NAME}`
                      : ""
                  }`
                : "";

              /*
               * An Actions column with a key and an element of its own draws
               * that element before the row's buttons.
               */
              const columnContent: React.ReactNode = isActions
                ? column.key && column.getElement
                  ? column.getElement(props.item)
                  : null
                : getColumnContent(column);

              /*
               * The column's own classes, plus the width cap - which has to
               * sit on this div rather than on the <td>, because max-width
               * is ignored on a table-cell box.
               */
              const contentWrapperClassName: string =
                getTableCellContentClassName<T>(column, {
                  isPrimaryColumn: i === 0,
                });

              return (
                <td
                  key={i}
                  className={`${className}${stickyClassName}`}
                  /*
                   * The stuck Actions cell, which a focused cell is kept
                   * clear of (TableStickyEndFocus).
                   */
                  {...(isActions
                    ? { [TABLE_STICKY_END_ATTRIBUTE]: "true" }
                    : {})}
                  style={getLockedCellStyle()}
                  onClick={() => {
                    if (column.tooltipText) {
                      setTooltipModalText(column.tooltipText(props.item));
                    }
                  }}
                  data-row-click-ignore={
                    column.tooltipText ? "true" : undefined
                  }
                >
                  {!isActions &&
                    columnContent !== null &&
                    columnContent !== undefined && (
                      <div
                        className={contentWrapperClassName}
                        /*
                         * The row's name, which may use the room of a table
                         * that fits (useTableScrollState's
                         * TABLE_NAME_ATTRIBUTE).
                         */
                        data-table-name={
                          isFillingNameColumn<T>(column, i === 0)
                            ? "true"
                            : undefined
                        }
                        /*
                         * Any other value that may be cut short a little
                         * more before the rows scroll sideways
                         * (useTableScrollState's TABLE_VALUE_ATTRIBUTE).
                         */
                        data-table-value={
                          isGivingValueColumn<T>(column, i === 0)
                            ? "true"
                            : undefined
                        }
                        onMouseEnter={
                          column.wrapContent
                            ? undefined
                            : showFullValueWhenCutShort
                        }
                      >
                        {columnContent}
                      </div>
                    )}
                  {isActions && (
                    <div
                      className={[
                        "flex items-center justify-end gap-2",
                        TABLE_ACTIONS_CONTENT_CLASS_NAME,
                        contentWrapperClassName,
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      {columnContent}
                      <RowActions<T>
                        item={props.item}
                        actionButtons={props.actionButtons}
                        isMobile={isMobileView}
                        itemLabel={props.itemLabel}
                      />
                    </div>
                  )}
                </td>
              );
            })}
          {props.hasEndFiller && (
            <td
              aria-hidden="true"
              data-testid={TABLE_END_FILLER_TEST_ID}
              className={`${TABLE_END_FILLER_BODY_CELL_CLASS_NAME}${ruleClassName}`}
              style={getLockedCellStyle()}
            />
          )}
        </tr>
        {tooltipModalText && (
          <ConfirmModal
            title={`Help`}
            description={`${tooltipModalText}`}
            submitButtonText={"Close"}
            onSubmit={() => {
              setTooltipModalText("");
            }}
            submitButtonType={ButtonStyleType.NORMAL}
          />
        )}
      </>
    );
  };

  if (props.enableDragAndDrop && props.dragDropIdField) {
    return (
      <Draggable
        draggableId={props.item[props.dragDropIdField]?.toString() || ""}
        index={props.dragIndex || 0}
        isDragDisabled={Boolean(props.isDragDisabled)}
      >
        {(provided: DraggableProvided, snapshot: DraggableStateSnapshot) => {
          return getRow(provided, snapshot);
        }}
      </Draggable>
    );
  }

  return getRow();
};

export default TableRow;
