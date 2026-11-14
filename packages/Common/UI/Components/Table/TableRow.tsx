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
  VALUE_KINDS_KEPT_WHOLE,
  getTableCellClassName,
  getTableCellContentClassName,
  isFillingNameColumn,
  isGivingValueColumn,
} from "./CellClassName";
import {
  TABLE_ACTIONS_CONTENT_CLASS_NAME,
  TABLE_CARD_BODY_WITH_CONTROLS_CLASS_NAME,
  TABLE_CARD_CONTROLS_CLASS_NAME,
  TABLE_CARD_FIELDS_CLASS_NAME,
  TABLE_CARD_WIDE_FIELD_CLASS_NAME,
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
  TABLE_WRAP_CELL_OTHER_WAY_LINE_CLASS_NAME,
  getTableCellPaddingClassName,
} from "./TableLayout";
import { TABLE_STICKY_END_ATTRIBUTE } from "./TableStickyEndFocus";
import TableEmptyValue, {
  getTableNoValue,
  isDashPlaceholder,
} from "./TableEmptyValue";
import { showFullValueWhenCutShort } from "./FullValueTitle";
import Columns from "./Types/Columns";
import Color from "../../../Types/Color";
import TableDate from "./TableDate";
import TableFoldedValues, {
  isEmptyFoldedContent,
  TableFoldedMainLayout,
  TableFoldedValue,
} from "./TableFoldedValues";
import { getColumnsFoldedInto } from "./FoldedColumns";
import { getElementLineText } from "./ColumnLineText";
import GenericObject from "../../../Types/GenericObject";
import IconProp from "../../../Types/Icon/IconProp";
import useTranslateValue from "../../Utils/Translation";
import useTranslator from "../../Utils/UseTranslator";
import { Translator } from "../../Utils/TranslateTemplate";
import {
  CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME,
  getLineDirection,
  LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME,
  LINE_OR_CLAMPED_LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME,
} from "../../Utils/LineDirection";
import {
  getReadingDirection,
  ReadingDirection,
} from "../../../Types/ReadingDirection";
import {
  getPhoneNumberDirection,
  getPhoneNumbersOfValue,
  getPhoneNumberValueText,
} from "../../../Types/PhoneNumberDirection";
import React, { ReactElement, useState } from "react";
import useIsBelowWidth, {
  PHONE_BELOW_WIDTH_IN_PX,
} from "../../Utils/UseIsBelowWidth";
import type {
  DraggableProvided,
  DraggableStateSnapshot,
} from "react-beautiful-dnd";
import { DragAndDropLibrary } from "../DragAndDrop/DragAndDropLoader";
import LongTextViewer from "../LongText/LongTextViewer";
import IsolatedText from "../IsolatedText/IsolatedText";
import PhoneNumberText from "../PhoneNumber/PhoneNumberText";
import PhoneNumberTextList from "../PhoneNumber/PhoneNumberTextList";
import InfoTooltip from "../Tooltip/InfoTooltip";
import DragHandle from "./DragHandle";

/*
 * The column types a cell draws as something of their own - a date, an
 * amount, a share, a colour, a long text, a tick - rather than as its value's
 * text on one line (TableRow's getColumnContent).
 */
const COLUMN_TYPES_NOT_DRAWN_AS_TEXT: ReadonlyArray<FieldType> = [
  FieldType.Date,
  FieldType.DateTime,
  FieldType.USDCents,
  FieldType.Percent,
  FieldType.Color,
  FieldType.LongText,
  FieldType.Boolean,
];

export interface ComponentProps<T extends GenericObject> {
  item: T;
  rowProps?: React.HTMLAttributes<HTMLElement> | undefined;
  columns: Columns<T>;
  actionButtons?: Array<ActionButtonSchema<T>> | undefined;
  enableDragAndDrop?: boolean | undefined;
  /*
   * The drag-and-drop library, once Table has loaded it (DragAndDropLoader):
   * until then the row is drawn as it will look, its grip included, and
   * does not drag.
   */
  dragAndDrop?: DragAndDropLibrary | null | undefined;
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

  /*
   * The columns folded away whose values the row shows under another
   * column's value (Column.foldInto, FoldedColumns' getColumnsFoldedInto).
   */
  foldedColumns?: Columns<T> | undefined;

  /*
   * Each column's id: a cell is kept by its column, not its place in the
   * row - a table that folds leaves out columns before it, and what has the
   * keyboard's focus in the cell (a row's View) stays with its column.
   */
  getColumnId?: ((column: Column<T>) => string | undefined) | undefined;

  // responsive: the row drawn as a card (TableFit)
  isMobile?: boolean;
  /*
   * A phone's window (below md): a card leaves out the columns marked
   * hideOnMobile. A tablet's card keeps them. Absent: what isMobile says,
   * or the window.
   */
  isPhone?: boolean | undefined;
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

  // The page's language, which decides which way its lines read.
  const translator: Translator = useTranslator();

  /*
   * Whether the window is a phone's, read as the row is first drawn (never
   * a frame later): for a row drawn without its table saying.
   */
  const isPhoneWindow: boolean = useIsBelowWidth(PHONE_BELOW_WIDTH_IN_PX);

  /*
   * TableBody knows which layout it is mounting and says so: a card, and
   * whether the window is a phone's. A card in a box too narrow for the
   * rows on a tablet (TableFit) is no phone's: it keeps every column.
   */
  const isMobileView: boolean = props.isMobile ?? isPhoneWindow;
  const isPhoneView: boolean = props.isPhone ?? isMobileView;

  // The columns this row will actually put on screen.
  const renderedColumns: Array<Column<T>> = (props.columns || []).filter(
    (column: Column<T>) => {
      return !(column.hideOnMobile && isPhoneView);
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
     * is drawn in, or the quiet dash - also for a column whose words are
     * only a dash ("-"), which drew a darker hyphen of its own beside the
     * dash of every other empty cell (getTableNoValue, #7264).
     */
    const getNoValue: () => ReactElement = (): ReactElement => {
      return getTableNoValue(column.noValueMessage);
    };

    switch (column.type) {
      case FieldType.Date:
      case FieldType.DateTime:
        /*
         * Short - "Oct 22, 7:25 AM", the year only when it is not this
         * year's - and whole under the pointer (TableDate).
         */
        return value ? (
          <TableDate
            value={value as string | Date}
            onlyShowDate={column.type === FieldType.Date}
          />
        ) : (
          getNoValue()
        );
      /*
       * No amount, no share: "0 USD", "0%" - or the column's own words for
       * that, drawn as every other empty value is.
       */
      case FieldType.USDCents:
        return value
          ? ((value as number) || 0) / 100 + " USD"
          : column.noValueMessage
            ? getNoValue()
            : "0 USD";
      case FieldType.Percent:
        return value
          ? value + "%"
          : column.noValueMessage
            ? getNoValue()
            : "0%";
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
      case FieldType.Phone: {
        /*
         * A phone number reads +447700900123 in every language: printed as
         * it is, an Arabic table put its "+" at the end (PhoneNumberText).
         * A list of them typed as one value is each of its numbers so.
         */
        const phoneNumbers: Array<string> = getPhoneNumbersOfValue(
          getNestedValue(props.item, String(column.key)),
        );

        if (phoneNumbers.length > 1) {
          return <PhoneNumberTextList phoneNumbers={phoneNumbers} />;
        }

        return phoneNumbers[0] ? (
          <PhoneNumberText phoneNumber={phoneNumbers[0]} />
        ) : (
          getNoValue()
        );
      }
      default: {
        const text: string | undefined = getPlainCellText(column);

        /*
         * Read the way it is written: an English description in a Persian
         * table keeps its full stop at its end (IsolatedText).
         */
        return text ? <IsolatedText text={text} /> : getNoValue();
      }
    }
  };

  /*
   * The text a column draws as it is, on its one line: any column without
   * an element of its own that is not a date, an amount, a share, a colour,
   * a long text or a tick (getColumnContent's default). Undefined for those,
   * and for an empty value.
   */
  const getPlainCellText: (column: Column<T>) => string | undefined = (
    column: Column<T>,
  ): string | undefined => {
    if (
      !column.key ||
      column.getElement ||
      COLUMN_TYPES_NOT_DRAWN_AS_TEXT.includes(column.type)
    ) {
      return undefined;
    }

    return (
      getNestedValue(props.item, String(column.key))?.toString() || undefined
    );
  };

  /*
   * The columns folded away whose values this row shows itself, under
   * another column's value (Column.foldInto): on a phone, none marked
   * hideOnMobile - a phone's card shows nothing of those.
   */
  const foldedColumns: Columns<T> = (props.foldedColumns || []).filter(
    (column: Column<T>): boolean => {
      return !(column.hideOnMobile && isPhoneView);
    },
  );

  /*
   * The way a column's own value reads when it is not the page's way: a
   * plain value in the other script - an English summary on a Persian page
   * - is cut short at its own end, not at its start (LineDirection). So is
   * an element whose column names the words it draws (getLineText), or
   * that draws a record's name or title (ColumnLineText: an incident's
   * title drawn as a link).
   */
  const getValueLineDirection: (
    column: Column<T>,
  ) => ReadingDirection | undefined = (
    column: Column<T>,
  ): ReadingDirection | undefined => {
    /*
     * A phone number's line reads left to right on a page read from the
     * right, though it has no letter to say so (getPhoneNumberDirection):
     * cut short, it keeps its "+44" and loses its last digits, and it still
     * starts where the column's other values do. A cell that draws more
     * than the number (an icon beside it) leaves its line the page's.
     */
    if (column.type === FieldType.Phone && column.key && !column.getElement) {
      const phoneNumber: string = getPhoneNumberValueText(
        getNestedValue(props.item, String(column.key)),
      );
      const direction: ReadingDirection = getPhoneNumberDirection(phoneNumber);

      return phoneNumber &&
        direction !== getReadingDirection(translator.language)
        ? direction
        : undefined;
    }

    const text: string | undefined = column.getElement
      ? getElementLineText<T>(column, props.item)
      : getPlainCellText(column);

    return text ? getLineDirection(text, translator.language) : undefined;
  };

  /*
   * The values of the columns folded into a cell (Column.foldInto) that have
   * something to say, each on a line of its own under the cell's value
   * (TableFoldedValues). A folded column with no value draws no line.
   */
  const getFoldedValuesOf: (column: Column<T>) => Array<TableFoldedValue> = (
    column: Column<T>,
  ): Array<TableFoldedValue> => {
    return getColumnsFoldedInto<T>({
      column: column,
      drawnColumns: renderedColumns,
      foldedColumns: foldedColumns,
    })
      .map((folded: Column<T>): TableFoldedValue => {
        return {
          title: folded.title,
          content: getColumnContent(folded),
          isTitleShown: folded.showTitleWhenFolded,
        };
      })
      .filter((value: TableFoldedValue): boolean => {
        return !isEmptyFoldedContent(value.content);
      });
  };

  /*
   * The way a cell's line reads: its value's (getValueLineDirection). A
   * cell with values folded under it keeps the page's way - its folded
   * lines are the page's words - and its value's own line reads its way
   * there instead (TableFoldedValues' mainDirection): an incident's English
   * title over its labels and owners on an Arabic page.
   */
  const getCellLineDirection: (
    column: Column<T>,
    foldedValues: Array<TableFoldedValue>,
  ) => ReadingDirection | undefined = (
    column: Column<T>,
    foldedValues: Array<TableFoldedValue>,
  ): ReadingDirection | undefined => {
    return foldedValues.length > 0 ? undefined : getValueLineDirection(column);
  };

  /*
   * What keeps a cell (or a card's field) its column's: the column's id,
   * where the table says it; its place in the row otherwise.
   */
  const getCellKey: (column: Column<T>, index: number) => string | number = (
    column: Column<T>,
    index: number,
  ): string | number => {
    return props.getColumnId?.(column) || index;
  };

  /*
   * A cell's value, with the values of the columns folded into it on lines
   * of their own under it (TableFoldedValues).
   */
  const getCellContent: (
    column: Column<T>,
    foldedValues: Array<TableFoldedValue>,
  ) => React.ReactNode = (
    column: Column<T>,
    foldedValues: Array<TableFoldedValue>,
  ): React.ReactNode => {
    const content: React.ReactNode = getColumnContent(column);

    if (foldedValues.length === 0) {
      return content;
    }

    return (
      <TableFoldedValues
        main={content}
        mainDirection={getValueLineDirection(column)}
        mainLayout={
          VALUE_KINDS_KEPT_WHOLE.includes(column.type)
            ? TableFoldedMainLayout.Whole
            : column.wrapContent
              ? TableFoldedMainLayout.Wrap
              : TableFoldedMainLayout.Line
        }
        folded={foldedValues}
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
             * The card's controls - its grip and its select box - stand at
             * the start of its first line, beside the row's name
             * (TABLE_CARD_CONTROLS_CLASS_NAME): a line of their own above
             * the fields was a card's tallest empty space.
             */}
            <div
              className={
                props.enableDragAndDrop || props.isBulkActionsEnabled
                  ? TABLE_CARD_BODY_WITH_CONTROLS_CLASS_NAME
                  : ""
              }
            >
              {props.enableDragAndDrop || props.isBulkActionsEnabled ? (
                /*
                 * -ml-1 lines the grip's dots up with the card's edge, its hit
                 * area being wider than they are; a select box alone lines up
                 * as it is. Centred on the name's 24px line.
                 */
                <div
                  className={`${TABLE_CARD_CONTROLS_CLASS_NAME}${
                    props.enableDragAndDrop ? " -ml-1" : ""
                  }`}
                >
                  {props.enableDragAndDrop ? getDragHandle(provided) : <></>}
                  {props.isBulkActionsEnabled ? getBulkSelectCheckbox() : <></>}
                </div>
              ) : (
                <></>
              )}

              <dl className={TABLE_CARD_FIELDS_CLASS_NAME}>
                {renderedColumns.map((column: Column<T>, i: number) => {
                  if (column.type === FieldType.Actions) {
                    const customAction: ReactElement | null = column.getElement
                      ? column.getElement(props.item)
                      : null;

                    return (
                      <div
                        key={getCellKey(column, i)}
                        className={`flex flex-wrap items-center gap-2 pt-1 ${TABLE_CARD_WIDE_FIELD_CLASS_NAME}`}
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

                  // The values folded under this field's own (Column.foldInto).
                  const foldedValues: Array<TableFoldedValue> =
                    getFoldedValuesOf(column);

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
                        ? getCellContent(column, foldedValues)
                        : null
                      : getCellContent(column, foldedValues);

                  // A card leaves out the fields that have nothing to say.
                  if (
                    !value ||
                    (typeof value === "string" && value.trim() === "") ||
                    (React.isValidElement(value) &&
                      value.type === TableEmptyValue)
                  ) {
                    return null;
                  }

                  /*
                   * Two fields to a line on a wide card: the row's name, and a
                   * column of prose, keep the card's whole width.
                   */
                  const isWideField: boolean =
                    i === 0 || Boolean(column.wrapContent);

                  /*
                   * The row's name - its first field - says what it is by
                   * itself, as a card's title: "Name" over every card's name
                   * was the same word down the whole list. A screen reader
                   * still hears it (the <dt> stays, visually hidden), as it
                   * does for a column that says so (hideTitleOnMobile).
                   */
                  const isCardTitleHidden: boolean =
                    i === 0 || Boolean(column.hideTitleOnMobile);

                  /*
                   * A value that reads the other way from the page - an
                   * English title on an Arabic page - reads its own way in
                   * a card as it does in a table's cell
                   * (getCellLineDirection): a card wraps it, and in the
                   * page's way its lines lined up on the right and its
                   * full stop came first. As wide as its words, it still
                   * starts where the card's other values do, each of its
                   * lines from its own start
                   * (CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME). A
                   * column that draws more than the value's words (a logo
                   * beside a name, a line of the page's under it) keeps the
                   * card's way, and sets its name apart itself.
                   */
                  const lineDirection: ReadingDirection | undefined =
                    getCellLineDirection(column, foldedValues);

                  const valueClassName: string =
                    i === 0
                      ? `${TABLE_MOBILE_FIELD_VALUE_CLASS_NAME} font-medium`
                      : TABLE_MOBILE_FIELD_VALUE_CLASS_NAME;

                  return (
                    <div
                      key={getCellKey(column, i)}
                      className={
                        isWideField
                          ? `${TABLE_MOBILE_FIELD_CLASS_NAME} ${TABLE_CARD_WIDE_FIELD_CLASS_NAME}`
                          : TABLE_MOBILE_FIELD_CLASS_NAME
                      }
                      onClick={() => {
                        if (column.tooltipText) {
                          setTooltipModalText(column.tooltipText(props.item));
                        }
                      }}
                    >
                      <dt
                        className={
                          isCardTitleHidden
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
                        {column.headerTooltip?.trim() && !isCardTitleHidden ? (
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
                          lineDirection
                            ? `${valueClassName} ${CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME}`
                            : valueClassName
                        }
                        dir={lineDirection}
                      >
                        {value}
                      </dd>
                    </div>
                  );
                })}
              </dl>
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

              // The values folded under this cell's own (Column.foldInto).
              const foldedValues: Array<TableFoldedValue> = isActions
                ? []
                : getFoldedValuesOf(column);

              /*
               * An Actions column with a key and an element of its own draws
               * that element before the row's buttons.
               */
              const columnContent: React.ReactNode = isActions
                ? column.key && column.getElement
                  ? column.getElement(props.item)
                  : null
                : getCellContent(column, foldedValues);

              /*
               * The column's own classes, plus the width cap - which has to
               * sit on this div rather than on the <td>, because max-width
               * is ignored on a table-cell box.
               */
              const contentWrapperClassName: string =
                getTableCellContentClassName<T>(column, {
                  isPrimaryColumn: i === 0,
                });

              /*
               * A plain value that reads the other way from the page: its
               * line reads its own way, so it is cut short at its own end,
               * and still starts where the column's other values do.
               */
              const lineDirection: ReadingDirection | undefined = isActions
                ? undefined
                : getCellLineDirection(column, foldedValues);

              /*
               * A column of prose (wrapContent) wraps its value rather than
               * cut it short, and aligned to its end, as a one-line value
               * is, every wrapped line of an English description on an
               * Arabic page lined up on the right, ragged where it starts.
               * Its box keeps the page's way and its width (its cap, its
               * floor); the value reads its own way in a box inside it
               * (TABLE_WRAP_CELL_OTHER_WAY_LINE_CLASS_NAME), as wide as its
               * words, at the page's start, each line from its own start.
               */
              const isWrappedOtherWay: boolean = Boolean(
                lineDirection && column.wrapContent,
              );
              const boxLineDirection: ReadingDirection | undefined =
                isWrappedOtherWay ? undefined : lineDirection;

              return (
                <td
                  key={getCellKey(column, i)}
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
                        className={
                          boxLineDirection
                            ? `${contentWrapperClassName} ${
                                /*
                                 * The row's name, and any other value that
                                 * gives way before the rows scroll sideways,
                                 * may be cut short to their first line
                                 * (line-clamp), whose "..." an end-aligned
                                 * box drew past its edge: an English alert
                                 * title on an Arabic page read "High Node
                                 * Memo." with one dot of three.
                                 */
                                isFillingNameColumn<T>(column, i === 0) ||
                                isGivingValueColumn<T>(column, i === 0)
                                  ? LINE_OR_CLAMPED_LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME
                                  : LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME
                              }`
                            : contentWrapperClassName
                        }
                        dir={boxLineDirection}
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
                        {isWrappedOtherWay ? (
                          <div
                            dir={lineDirection}
                            className={
                              TABLE_WRAP_CELL_OTHER_WAY_LINE_CLASS_NAME
                            }
                          >
                            {columnContent}
                          </div>
                        ) : (
                          columnContent
                        )}
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

  const Draggable: DragAndDropLibrary["Draggable"] | undefined =
    props.enableDragAndDrop && props.dragDropIdField
      ? props.dragAndDrop?.Draggable
      : undefined;

  if (Draggable && props.dragDropIdField) {
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
