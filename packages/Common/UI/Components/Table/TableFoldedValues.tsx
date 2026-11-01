import TableEmptyValue from "./TableEmptyValue";
import { TABLE_FOLDED_MAIN_ATTRIBUTE } from "./FullValueTitle";
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
 *   - Line: a title, a name, a state's pill - its words onto a second line
 *     where the column is narrower than they are, and cut short with "..."
 *     only after that (TABLE_FOLDED_MAIN_LINE_CLASS_NAME).
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

/*
 * A title or a name above what is folded under it: on two lines before it
 * is cut short. A folded table leaves its row's title little room - 165px
 * in the incidents list at 1280px beside a side menu - and cut on one line
 * every title read "Elevated latency on pa..." (fewer letters still in
 * German), while the row beside it stood two and three lines tall with the
 * state over the severity; and in a right-to-left page an English title
 * lost its start ("...tency on payments-db"). Its words wrap from their
 * start, and what does not fit on two lines ends in "..." (the whole of it
 * under the pointer, FullValueTitle). A value laid out in boxes of its own -
 * a state over a line about it, a name beside its pill - is drawn as it
 * always is: clamped, its own second line would be hidden.
 */
export const TABLE_FOLDED_MAIN_LINE_CLASS_NAME: string =
  "min-w-0 overflow-x-clip whitespace-normal break-words [&:not(:has(>:is(div,p,ul,ol,table,[class*=flex],[class*=grid])))]:line-clamp-2";

// The cell's own value, by its layout (TableFoldedMainLayout).
export const TABLE_FOLDED_MAIN_CLASS_NAMES: Record<
  TableFoldedMainLayout,
  string
> = {
  [TableFoldedMainLayout.Line]: TABLE_FOLDED_MAIN_LINE_CLASS_NAME,
  [TableFoldedMainLayout.Whole]: "whitespace-nowrap",
  [TableFoldedMainLayout.Wrap]: "min-w-0 whitespace-normal break-words",
};

/*
 * What a cell draws while its value is still on its way (OwnersCell's
 * "Loading..."): folded under another value, it draws no line, so the rows
 * of a list do not grow by a line of "Loading..." each and shrink back as
 * the owners come in.
 */
export const TABLE_VALUE_LOADING_ATTRIBUTE: string = "data-table-loading";

/*
 * A folded column's value, on a line of its own under the cell's: a quieter
 * grey for its words (a pill or a picture keeps its own colours), and left
 * out when it has nothing to say - the quiet dash, nothing at all, or a
 * value still loading - as a phone's card leaves out an empty field. Its
 * words wrap rather than widen the column it is folded into.
 */
export const TABLE_FOLDED_VALUE_CLASS_NAME: string =
  "min-w-0 whitespace-normal text-gray-500 [&:has(>div>[data-testid=table-empty-value]:only-child)]:hidden [&:has(>div:empty)]:hidden [&:has(>div>[data-table-loading]:only-child)]:hidden";

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
      <div
        className={TABLE_FOLDED_MAIN_CLASS_NAMES[layout]}
        // What the cell's tooltip names (FullValueTitle).
        {...{ [TABLE_FOLDED_MAIN_ATTRIBUTE]: "true" }}
        {...shrinkable}
      >
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
