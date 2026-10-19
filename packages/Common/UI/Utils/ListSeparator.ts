/*
 * What goes between two names listed one after another, by the script they
 * are written in:
 *
 *   - "Description, Labels" - a comma and a space;
 *   - "説明、ラベル" in Chinese and Japanese - the ideographic comma, with
 *     no space after it;
 *   - "توضیحات، برچسب‌ها" in Persian - the Arabic comma and a space.
 *
 * Read from the text rather than from the reader's language, so a list a
 * locale has not translated yet keeps its English commas instead of
 * "Description、Labels". A React-free module: a component, a form's folded
 * line (FoldedSection) and a Dashboard sentence can all read it.
 */

// Chinese and Japanese list with 、 (Han, Hiragana, Katakana).
const IDEOGRAPHIC_SCRIPT_REGEX: RegExp =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

// Persian (and Arabic, Urdu) list with ،.
const ARABIC_SCRIPT_REGEX: RegExp = /\p{Script=Arabic}/u;

export const LIST_SEPARATOR: string = ", ";

export const IDEOGRAPHIC_LIST_SEPARATOR: string = "、";

export const ARABIC_LIST_SEPARATOR: string = "، ";

export type GetListSeparatorFunction = (texts: ReadonlyArray<string>) => string;

// The separator for a list of these texts: ", ", "、" or "، ".
export const getListSeparator: GetListSeparatorFunction = (
  texts: ReadonlyArray<string>,
): string => {
  if (
    texts.some((text: string): boolean => {
      return IDEOGRAPHIC_SCRIPT_REGEX.test(text);
    })
  ) {
    return IDEOGRAPHIC_LIST_SEPARATOR;
  }

  if (
    texts.some((text: string): boolean => {
      return ARABIC_SCRIPT_REGEX.test(text);
    })
  ) {
    return ARABIC_LIST_SEPARATOR;
  }

  return LIST_SEPARATOR;
};
