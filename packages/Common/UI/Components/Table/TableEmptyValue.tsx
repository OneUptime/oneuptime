import { EMPTY_VALUE_MARK } from "../Detail/EmptyValue";
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

// The marks pages draw for "nothing here" in a cell of their own.
export const DASH_PLACEHOLDERS: ReadonlyArray<string> = [
  "-",
  "\u2013",
  "\u2014",
];

/*
 * Whether a column's own element is a bare dash - `<>-</>`, `<p>-</p>`,
 * `<span>-</span>` with no classes of its own - the mark some fifty columns
 * draw for a value that is not there. In a table it becomes the quiet dash
 * every other empty cell is (TableRow), rather than a hyphen as dark as a
 * value; an element with classes of its own is kept as the page drew it.
 */
export const isDashPlaceholder: (node: React.ReactNode) => boolean = (
  node: React.ReactNode,
): boolean => {
  if (typeof node === "string") {
    return DASH_PLACEHOLDERS.includes(node.trim());
  }

  if (!React.isValidElement(node)) {
    return false;
  }

  const elementProps: { children?: React.ReactNode; className?: string } =
    node.props as { children?: React.ReactNode; className?: string };

  if (
    node.type !== React.Fragment &&
    node.type !== "span" &&
    node.type !== "p"
  ) {
    return false;
  }

  if (elementProps.className) {
    return false;
  }

  return (
    typeof elementProps.children === "string" &&
    DASH_PLACEHOLDERS.includes(elementProps.children.trim())
  );
};

export interface ComponentProps {
  /*
   * What a screen reader hears in place of the dash: the column's own
   * sentence ("No labels attached.", "No owners."). "Not set" when there is
   * none.
   */
  screenReaderText?: string | undefined;
}

const TableEmptyValue: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const text: string = props.screenReaderText?.trim() || "Not set";

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

export default TableEmptyValue;
