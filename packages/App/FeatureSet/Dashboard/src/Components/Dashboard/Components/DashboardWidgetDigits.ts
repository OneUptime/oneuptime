/*
 * THE ROOM A WIDGET'S NUMBER GIVES EACH OF ITS DIGITS.
 *
 * A Gauge's centre, a Value widget's number, an SLO tile's and a clock's
 * time are drawn with digits of one width (tabular-nums): a number that
 * changes as the board refreshes keeps its width and its place. Inter
 * draws Latin digits so with nothing to see. Persian's own digits (۰ to
 * ۹), which these widgets write on a Persian board (#7094), are drawn by
 * Vazirmatn, whose digits of one width are each as wide as its widest
 * one: a ۱ stood alone in the room of a ۷, and the board read "۱ ۱:۲ ۹"
 * for "۱۱:۲۹" and "۶ ۷٫۹ ۰" for "۶۷٫۹۰". A number written in those digits,
 * or in Arabic's own (٠ to ٩), takes each digit's own width
 * (proportional-nums).
 */

// Arabic's own digits (٠ to ٩) and Persian's (۰ to ۹), drawn by Vazirmatn.
const ARABIC_SCRIPT_DIGIT: RegExp = /[\u0660-\u0669\u06F0-\u06F9]/;

export const TABULAR_NUMBERS_CLASS_NAME: string = "tabular-nums";
export const PROPORTIONAL_NUMBERS_CLASS_NAME: string = "proportional-nums";

// The class a number written as `text` is drawn with: see above.
export const getNumberSpacingClassName: (
  text: string | null | undefined,
) => string = (text: string | null | undefined): string => {
  return text && ARABIC_SCRIPT_DIGIT.test(text)
    ? PROPORTIONAL_NUMBERS_CLASS_NAME
    : TABULAR_NUMBERS_CLASS_NAME;
};
