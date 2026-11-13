import {
  DASH_PLACEHOLDERS,
  EMPTY_VALUE_MARK,
  isDashPlaceholder,
  isDashText,
} from "../Detail/EmptyValue";
import useTranslateValue from "../../Utils/Translation";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * What a table's cell shows for a value that is not there: a quiet dash.
 *
 * Every row of the Incidents list said "No labels attached." and "No
 * owners." - the same words down the whole column, the loudest thing in
 * rows that had nothing to say. A dash is the mark a detail card leaves for
 * an empty field (Detail/EmptyValue), and a reader scanning a column takes
 * it in at a glance; the words are still there for a screen reader, which
 * hears the column's own sentence ("No labels attached.") or "Not set".
 *
 * On the row's 24px line, in the grey a missing value is drawn in, so it
 * sits level with the values in the cells beside it.
 */
export const TABLE_EMPTY_VALUE_CLASS_NAME: string =
  "text-sm leading-6 text-gray-400";

export const TABLE_EMPTY_VALUE_TEST_ID: string = "table-empty-value";

/*
 * The marks pages draw for "nothing here" in a cell of their own, and
 * whether a column's own element is only one (a bare `<p>-</p>`): one rule
 * for a table's cell and a detail card's field (Detail/EmptyValue).
 */
export { DASH_PLACEHOLDERS, isDashPlaceholder };

export interface ComponentProps {
  /*
   * What a screen reader hears in place of the dash: the column's own
   * sentence ("No labels attached.", "No owners."). "Not set" when there is
   * none - or when it is only a dash, which says nothing out loud.
   */
  screenReaderText?: string | undefined;
}

const TableEmptyValue: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const words: string = props.screenReaderText?.trim() || "";
  const text: string = words && !isDashText(words) ? words : "Not set";

  return (
    <span
      className={TABLE_EMPTY_VALUE_CLASS_NAME}
      data-testid={TABLE_EMPTY_VALUE_TEST_ID}
    >
      <span aria-hidden="true">{EMPTY_VALUE_MARK}</span>
      <span className="sr-only">{translateString(text) ?? text}</span>
    </span>
  );
};

/*
 * A column's own words for a value that is not there ("Never", "No
 * labels"), in the grey a missing value is drawn in, and in the reader's
 * language.
 */
export const TABLE_NO_VALUE_MESSAGE_CLASS_NAME: string = "text-gray-500";

export interface TableNoValueMessageProps {
  text: string;
}

export const TableNoValueMessage: FunctionComponent<
  TableNoValueMessageProps
> = (props: TableNoValueMessageProps): ReactElement => {
  const { translateString } = useTranslateValue();

  return (
    <span className={TABLE_NO_VALUE_MESSAGE_CLASS_NAME}>
      {translateString(props.text) ?? props.text}
    </span>
  );
};

/*
 * What a cell shows for a value that is not there, given the words its
 * column has for that (Column.noValueMessage): those words when it has
 * some, and the quiet dash when it has none - or when they are only a dash
 * ("-", "–", "—"), which some sixty columns wrote. Those drew a hyphen
 * darker than the dash beside it, with nothing for a screen reader to hear,
 * so one row showed two marks for the same "nothing here" (#7264).
 *
 * A function rather than a component of its own: a phone's card leaves out
 * a field whose value is the quiet dash, and knows it by its element's type
 * (TableRow), as a cell's folded lines do (TableFoldedValues).
 */
export const getTableNoValue: (
  noValueMessage?: string | undefined,
) => ReactElement = (noValueMessage?: string | undefined): ReactElement => {
  if (!noValueMessage?.trim() || isDashText(noValueMessage)) {
    return <TableEmptyValue />;
  }

  return <TableNoValueMessage text={noValueMessage} />;
};

export default TableEmptyValue;
