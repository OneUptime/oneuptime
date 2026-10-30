/*
 * A CONDITION'S ROW IS LAID OUT BY THE ROOM THE CONDITIONS HAVE, NOT BY THE
 * WINDOW.
 *
 * "If [Labels] [Has any of] [Production]" is one line only where the
 * conditions are wide enough for three pickers and a remove button. The row
 * used to switch to that line at the window's lg breakpoint (1024px) - but
 * nearly every rule form is a dialog, and beside its step list a dialog
 * gives the conditions about 478px at any window: a scheduled maintenance
 * reminder rule's Match step squeezed its field and operator pickers to
 * "Lab..." and "H..." and cut its value's placeholder short (#5282).
 *
 * So the list of conditions is a container (container-type: inline-size)
 * and each row reads its width:
 *
 *   under 24rem    If                              (x)   a phone: a line
 *                  [field                           ]    for the word and
 *                  [operator                        ]    the remove button,
 *                  [value                           ]    then the pickers
 *                                                        at full width
 *
 *   24rem - 37rem  If  [field                    ]  (x)  a dialog beside its
 *                      [operator                 ]       steps (478px): one
 *                      [value                    ]       picker a line
 *
 *   37rem - 56rem  If  [field       ] [operator  ]  (x)  a dialog with no
 *                      [value                    ]       steps: the two
 *                                                        pickers side by
 *                                                        side, the value
 *                                                        on a line of its own
 *
 *   56rem and up   If  [field] [operator] [value]   (x)  a page: one line
 *
 * The widths are where the pickers keep their words whole. A picker draws
 * about 80px around its words (its padding, the chevron), so "Incident
 * Severities" needs some 200px, "Has none of" 160px and the longest
 * operator, "Does not match pattern", 234px: two pickers side by side keep
 * it whole from 37rem, three on one line from 56rem. (German's "Entspricht
 * nicht dem Muster" needs 261px: at the bottom of the two ranges it ends
 * in "...", and its open list shows it whole.) On a phone the 3.5rem the
 * word "If" takes beside the pickers, and the remove button after them,
 * left the longest operator 198px; on a line of their own they leave the
 * pickers the row's width.
 *
 * Every cell is placed on its line and column at each width, and the
 * widths' rules are ranges where more than one would touch a cell, so no
 * two of them ever apply to one cell at once: none depends on another's
 * coming first in the stylesheet. Right to left, the grid's columns run
 * from the right by themselves.
 *
 * React-free, and every class a literal string, so whatever reads the
 * source for Tailwind's classes (the dark-mode scans) finds each one.
 */

/*
 * The list of conditions: the container the rows measure. 16px between two
 * conditions, twice the 8px between one condition's pickers, so a condition
 * stacked over several lines still reads as one.
 */
export const RULE_CRITERIA_LIST_CLASS_NAME: string =
  "space-y-4 [container-type:inline-size]";

// The widths, in rem, where a row's layout changes (see above).
export const RULE_CRITERIA_LAYOUT_WIDTHS_IN_REM: ReadonlyArray<number> = [
  24, 37, 56,
];

export const RULE_CRITERIA_ROW_CLASS_NAME: string =
  "grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2 gap-y-2 [@container(min-width:24rem)_and_(max-width:36.99rem)]:grid-cols-[3.5rem_minmax(0,1fr)_auto] [@container(min-width:37rem)_and_(max-width:55.99rem)]:grid-cols-[3.5rem_minmax(0,1fr)_minmax(0,1fr)_auto] [@container(min-width:56rem)]:grid-cols-[3.5rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.25fr)_auto]";

// "If", "And", "Or": the first column of the first line, at every width.
export const RULE_CRITERIA_CONNECTOR_CELL_CLASS_NAME: string =
  "col-[1] row-[1] flex h-10 items-center";

// The field picker: under the word on a phone, beside it from 24rem.
export const RULE_CRITERIA_FIELD_CELL_CLASS_NAME: string =
  "col-[1/-1] row-[2] min-w-0 [@container(min-width:24rem)]:col-[2] [@container(min-width:24rem)]:row-[1]";

// The operator: a line of its own, then under the field, then beside it.
export const RULE_CRITERIA_OPERATOR_CELL_CLASS_NAME: string =
  "col-[1/-1] row-[3] min-w-0 [@container(min-width:24rem)_and_(max-width:36.99rem)]:col-[2] [@container(min-width:24rem)_and_(max-width:36.99rem)]:row-[2] [@container(min-width:37rem)]:col-[3] [@container(min-width:37rem)]:row-[1]";

/*
 * The value: a line of its own, then under the operator, then under both
 * pickers (from the field's column to the operator's end), then the third
 * picker on the one line.
 */
export const RULE_CRITERIA_VALUE_CELL_CLASS_NAME: string =
  "col-[1/-1] row-[4] min-w-0 [@container(min-width:24rem)_and_(max-width:36.99rem)]:col-[2] [@container(min-width:24rem)_and_(max-width:36.99rem)]:row-[3] [@container(min-width:37rem)_and_(max-width:55.99rem)]:col-[2/4] [@container(min-width:37rem)_and_(max-width:55.99rem)]:row-[2] [@container(min-width:56rem)]:col-[4] [@container(min-width:56rem)]:row-[1]";

// The remove button: at the end of the first line, at every width.
export const RULE_CRITERIA_REMOVE_CELL_CLASS_NAME: string =
  "col-[2] row-[1] flex h-10 items-center justify-end [@container(min-width:24rem)_and_(max-width:36.99rem)]:col-[3] [@container(min-width:37rem)_and_(max-width:55.99rem)]:col-[4] [@container(min-width:56rem)]:col-[5]";
