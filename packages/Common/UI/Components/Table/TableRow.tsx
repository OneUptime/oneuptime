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
} from "./CellClassName";
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
            className={`p-4 bg-white border-b border-gray-200 ${draggingClassName} ${props.rowProps?.className || ""}`}
          >
            {/*
             * The card's controls - its grip and its select box - share one
             * line above its fields rather than stacking a line each.
             */}
            {props.enableDragAndDrop ? (
              <div className="mb-3 -ml-1 flex items-center gap-2">
                {getDragHandle(provided)}
                {props.isBulkActionsEnabled ? getBulkSelectCheckbox() : <></>}
              </div>
            ) : (
              <></>
            )}

            {props.isBulkActionsEnabled && !props.enableDragAndDrop ? (
              <div className="mb-3">{getBulkSelectCheckbox()}</div>
            ) : (
              <></>
            )}

            <div className="space-y-3">
              {renderedColumns.map((column: Column<T>, i: number) => {
                if (column.type === FieldType.Actions) {
                  const customAction: ReactElement | null = column.getElement
                    ? column.getElement(props.item)
                    : null;

                  return (
                    <div key={i} className="flex flex-wrap items-center gap-2">
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

                const value: any =
                  column.key && !column.getElement ? (
                    column.type === FieldType.Date ? (
                      props.item[column.key] ? (
                        OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                          props.item[column.key] as string,
                          true,
                        )
                      ) : (
                        column.noValueMessage || ""
                      )
                    ) : column.type === FieldType.DateTime ? (
                      props.item[column.key] ? (
                        OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                          props.item[column.key] as string,
                          false,
                        )
                      ) : (
                        column.noValueMessage || ""
                      )
                    ) : column.type === FieldType.USDCents ? (
                      props.item[column.key] ? (
                        ((props.item[column.key] as number) || 0) / 100 + " USD"
                      ) : (
                        column.noValueMessage || "0 USD"
                      )
                    ) : column.type === FieldType.Percent ? (
                      props.item[column.key] ? (
                        props.item[column.key] + "%"
                      ) : (
                        column.noValueMessage || "0%"
                      )
                    ) : column.type === FieldType.Color ? (
                      props.item[column.key] ? (
                        <ColorInput value={props.item[column.key] as Color} />
                      ) : (
                        column.noValueMessage || "0%"
                      )
                    ) : column.type === FieldType.LongText ? (
                      props.item[column.key] ? (
                        <LongTextViewer
                          text={props.item[column.key] as string}
                        />
                      ) : (
                        column.noValueMessage || ""
                      )
                    ) : column.type === FieldType.Boolean ? (
                      props.item[column.key] ? (
                        <Icon
                          icon={IconProp.Check}
                          className={"h-5 w-5 text-gray-500"}
                          thick={ThickProp.Thick}
                        />
                      ) : (
                        <Icon
                          icon={IconProp.False}
                          className={"h-5 w-5 text-gray-500"}
                          thick={ThickProp.Thick}
                        />
                      )
                    ) : (
                      getNestedValue(
                        props.item,
                        String(column.key),
                      )?.toString() ||
                      column.noValueMessage ||
                      ""
                    )
                  ) : column.key && column.getElement ? (
                    column.getElement(props.item)
                  ) : null;

                // Skip empty values for mobile view
                if (
                  !value ||
                  (typeof value === "string" && value.trim() === "")
                ) {
                  return null;
                }

                return (
                  <div
                    key={i}
                    className="flex flex-col space-y-1"
                    onClick={() => {
                      if (column.tooltipText) {
                        setTooltipModalText(column.tooltipText(props.item));
                      }
                    }}
                  >
                    <div className="text-sm font-medium text-gray-500">
                      {translateString(column.title) ?? column.title}
                    </div>
                    <div className="text-sm text-gray-900">{value}</div>
                  </div>
                );
              })}
            </div>
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

    // Desktop view: render as table row
    return (
      <>
        <tr
          {...props.rowProps}
          {...provided?.draggableProps}
          style={rowStyle}
          ref={provided?.innerRef}
          className={
            `${props.rowProps?.className || ""} ${
              snapshot?.isDragging ? `bg-white ${draggingClassName}` : ""
            }`.trim() || undefined
          }
        >
          {props.enableDragAndDrop && (
            <td
              className="w-10 py-3 pl-4 pr-0 align-top"
              style={getLockedCellStyle()}
            >
              {getDragHandle(provided)}
            </td>
          )}
          {props.isBulkActionsEnabled && (
            <td className="w-10 py-3.5  align-top" style={getLockedCellStyle()}>
              <div className="ml-5">{getBulkSelectCheckbox()}</div>
            </td>
          )}
          {props.columns &&
            renderedColumns.map((column: Column<T>, i: number) => {
              /*
               * Shared with the loading skeleton, so the two can no longer
               * drift, and the one place that decides whether this cell's
               * text may wrap.
               */
              const className: string = getTableCellClassName<T>({
                column: column,
                isLastRenderedColumn: i === renderedColumns.length - 1,
              });

              let columnContent: React.ReactNode = null;

              if (column.key && !column.getElement) {
                columnContent =
                  column.type === FieldType.Date ? (
                    props.item[column.key] ? (
                      OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                        props.item[column.key] as string,
                        true,
                      )
                    ) : (
                      column.noValueMessage || ""
                    )
                  ) : column.type === FieldType.DateTime ? (
                    props.item[column.key] ? (
                      OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                        props.item[column.key] as string,
                        false,
                      )
                    ) : (
                      column.noValueMessage || ""
                    )
                  ) : column.type === FieldType.USDCents ? (
                    props.item[column.key] ? (
                      ((props.item[column.key] as number) || 0) / 100 + " USD"
                    ) : (
                      column.noValueMessage || "0 USD"
                    )
                  ) : column.type === FieldType.Percent ? (
                    props.item[column.key] ? (
                      props.item[column.key] + "%"
                    ) : (
                      column.noValueMessage || "0%"
                    )
                  ) : column.type === FieldType.Color ? (
                    props.item[column.key] ? (
                      <ColorInput value={props.item[column.key] as Color} />
                    ) : (
                      column.noValueMessage || "0%"
                    )
                  ) : column.type === FieldType.LongText ? (
                    props.item[column.key] ? (
                      <LongTextViewer text={props.item[column.key] as string} />
                    ) : (
                      column.noValueMessage || ""
                    )
                  ) : column.type === FieldType.Boolean ? (
                    props.item[column.key] ? (
                      <Icon
                        icon={IconProp.Check}
                        className={"h-5 w-5 text-gray-500"}
                        thick={ThickProp.Thick}
                      />
                    ) : (
                      <Icon
                        icon={IconProp.False}
                        className={"h-5 w-5 text-gray-500"}
                        thick={ThickProp.Thick}
                      />
                    )
                  ) : (
                    getNestedValue(
                      props.item,
                      String(column.key),
                    )?.toString() ||
                    column.noValueMessage ||
                    ""
                  );
              } else if (column.key && column.getElement) {
                columnContent = column.getElement(props.item);
              }

              /*
               * The column's own classes, plus the width cap a wrapping
               * column gets - which has to sit on this div rather than on the
               * <td>, because max-width is ignored on a table-cell box.
               */
              const contentWrapperClassName: string =
                getTableCellContentClassName<T>(column);

              const actionsContainerClassName: string = contentWrapperClassName
                ? `flex items-center justify-end gap-2 ${contentWrapperClassName}`
                : "flex items-center justify-end gap-2";

              return (
                <td
                  key={i}
                  className={className}
                  style={{
                    textAlign:
                      column.type === FieldType.Actions ? "right" : "left",
                    ...(getLockedCellStyle() || {}),
                  }}
                  onClick={() => {
                    if (column.tooltipText) {
                      setTooltipModalText(column.tooltipText(props.item));
                    }
                  }}
                >
                  {column.type !== FieldType.Actions &&
                    columnContent !== null &&
                    columnContent !== undefined && (
                      <div className={contentWrapperClassName}>
                        {columnContent}
                      </div>
                    )}
                  {column.type === FieldType.Actions && (
                    <div className={actionsContainerClassName}>
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
