import { EMPTY_VALUE_MARK } from "../../UI/Components/Detail/EmptyValue";

/*
 * What the quiet dash (TableEmptyValue, Detail/EmptyValue) reads as text:
 * its mark, then the words a screen reader hears in its place. A cell or a
 * fact that used to draw a hyphen of its own ("-") for a value that is not
 * there reads this now (#7603, #8209).
 */
export const QUIET_DASH_TEXT: string = `${EMPTY_VALUE_MARK}Not set`;

// The same in a reader's language, given its words for "Not set".
export function quietDashTextIn(notSet: string): string {
  return `${EMPTY_VALUE_MARK}${notSet}`;
}
