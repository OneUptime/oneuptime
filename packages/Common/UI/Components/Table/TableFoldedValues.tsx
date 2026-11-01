import TableEmptyValue from "./TableEmptyValue";
import { TABLE_SHRINKABLE_ATTRIBUTE } from "./TableLayout";
import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * One folded column's value, and its column's name: heard by a screen
 * reader before the value, and shown before it too where the value does
 * not say what it is by itself (a time among times: "Last match 2 hours
 * ago" under "5 minutes ago").
 */
export interface TableFoldedValue {
  title: string;
  content: React.ReactNode;
  isTitleShown?: boolean | undefined;
}

/*
 * How the cell's own value is laid out above what is folded under it:
 *   - Line: on one line, cut short with "..." of its own when the table
 *     gives way - a title, a name, a state's pill.
 *   - Whole: on one line, never cut short - a date, a number
 *     (CellClassName's VALUE_KINDS_KEPT_WHOLE); the folded values wrap
 *     under it rather than widen it.
 *   - Wrap: as many lines as it needs, as its column of prose always draws
 *     it (Column.wrapContent).
 */
export enum TableFoldedMainLayout {
  Line = "line",
  Whole = "whole",
  Wrap = "wrap",
}

export interface ComponentProps {
  // The cell's own value.
  main: React.ReactNode;
  // The values of the columns folded into it (Column.foldInto).
  folded: Array<TableFoldedValue>;
  mainLayout?: TableFoldedMainLayout | undefined;
}

export const TABLE_FOLDED_VALUES_TEST_ID: string = "table-folded-values";

export const TABLE_FOLDED_VALUE_TEST_ID: string = "table-folded-value";

export const TABLE_FOLDED_VALUE_TITLE_TEST_ID: string = "table-folded-title";

// The cell's own value, by its layout (TableFoldedMainLayout).
export const TABLE_FOLDED_MAIN_CLASS_NAMES: Record<
  TableFoldedMainLayout,
  string
> = {
  [TableFoldedMainLayout.Line]:
    "min-w-0 overflow-x-clip text-ellipsis whitespace-nowrap",
  [TableFoldedMainLayout.Whole]: "whitespace-nowrap",
  [TableFoldedMainLayout.Wrap]: "min-w-0 whitespace-normal break-words",
};

/*
 * A folded column's value, on a line of its own under the cell's: a quieter
 * grey for its words (a pill or a picture keeps its own colours), and left
 * out when it has nothing to say - the quiet dash, or nothing at all - as a
 * phone's card leaves out an empty field. Its words wrap rather than widen
 * the column it is folded into.
 */
export const TABLE_FOLDED_VALUE_CLASS_NAME: string =
  "min-w-0 whitespace-normal text-gray-500 [&:has(>div>[data-testid=table-empty-value]:only-child)]:hidden [&:has(>div:empty)]:hidden";

// The column's name shown before a value that does not say what it is.
export const TABLE_FOLDED_VALUE_TITLE_CLASS_NAME: string =
  "me-1.5 text-xs font-medium text-gray-500";

// A value the cell need not draw a line for.
const isEmptyContent: (content: React.ReactNode) => boolean = (
  content: React.ReactNode,
): boolean => {
  if (content === null || content === undefined || content === false) {
    return true;
  }

  if (typeof content === "string") {
    return content.trim() === "";
  }

  return React.isValidElement(content) && content.type === TableEmptyValue;
};

/*
 * A cell that shows, under its own value, the values of the columns folded
 * into it (TableFit, Column.foldInto): an incident's labels and owners under
 * its title, its severity under its state, how long it has lasted under when
 * it was declared - each on a line of its own, so the row keeps every value
 * while the table keeps to its card. A screen reader hears each one's
 * column name before it.
 *
 * Laid out as a box of the table's give-way - a grid of one column whose
 * lines each end in "..." of their own - so the cell can still be cut short
 * a little more when the table needs the room; a date's cell, whose date is
 * never cut short, is not one.
 */
const TableFoldedValues: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const values: Array<TableFoldedValue> = props.folded.filter(
    (value: TableFoldedValue): boolean => {
      return !isEmptyContent(value.content);
    },
  );

  if (values.length === 0) {
    return <>{props.main}</>;
  }

  const layout: TableFoldedMainLayout =
    props.mainLayout || TableFoldedMainLayout.Line;
  const isShrinkable: boolean = layout !== TableFoldedMainLayout.Whole;
  const shrinkable: Record<string, string> = isShrinkable
    ? { [TABLE_SHRINKABLE_ATTRIBUTE]: "true" }
    : {};

  return (
    <div
      className={
        isShrinkable
          ? "grid min-w-0 grid-cols-1 gap-y-1"
          : "flex flex-col gap-y-1"
      }
      data-testid={TABLE_FOLDED_VALUES_TEST_ID}
      /*
       * A box whose lines each end in "..." of their own: the table may cut
       * it short as one (useTableScrollState's getValueGiveKind).
       */
      {...shrinkable}
    >
      <div className={TABLE_FOLDED_MAIN_CLASS_NAMES[layout]} {...shrinkable}>
        {props.main}
      </div>
      {values.map((value: TableFoldedValue, index: number): ReactElement => {
        const title: string =
          translator.translateText(value.title) || value.title;

        return (
          <div
            key={`${value.title}-${index}`}
            className={TABLE_FOLDED_VALUE_CLASS_NAME}
            data-testid={TABLE_FOLDED_VALUE_TEST_ID}
            {...shrinkable}
          >
            {value.isTitleShown ? (
              <span
                className={TABLE_FOLDED_VALUE_TITLE_CLASS_NAME}
                data-testid={TABLE_FOLDED_VALUE_TITLE_TEST_ID}
              >
                {title}
              </span>
            ) : (
              <span className="sr-only">{title}</span>
            )}
            <div className={value.isTitleShown ? "inline" : "min-w-0"}>
              {value.content}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default TableFoldedValues;
