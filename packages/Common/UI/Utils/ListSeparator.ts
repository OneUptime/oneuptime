/*
 * What goes between two names listed one after another, by the script they
 * are written in:
 *
 *   - "Description, Labels" - a comma and a space;
 *   - "説明、ラベル" in Chinese and Japanese - the ideographic comma, with
 *     no space after it;
 *   - "توضیحات، برچسب‌ها" in Persian - the Arabic comma and a space.
 *
 * And between two clauses of one line - a summary's steps, a list of notes -
 * the semicolon of that script (getClauseSeparator):
 *
 *   - "Step 1: Monitor destination; Step 2: Retry count" - a semicolon and
 *     a space;
 *   - "第 1 步：监视目标；第 2 步：重试次数" in Chinese and Japanese - the
 *     fullwidth semicolon, with no space after it;
 *   - "مرحله 1: هدف مانیتور؛ مرحله 2: تعداد تلاش مجدد" in Persian - the
 *     Arabic semicolon and a space.
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

export const CLAUSE_SEPARATOR: string = "; ";

export const IDEOGRAPHIC_CLAUSE_SEPARATOR: string = "；";

export const ARABIC_CLAUSE_SEPARATOR: string = "؛ ";

export type GetListSeparatorFunction = (texts: ReadonlyArray<string>) => string;

export type JoinListFunction = (texts: ReadonlyArray<string>) => string;

// The script whose punctuation a run of texts takes.
type PunctuationScript = "ideographic" | "arabic" | "latin";

/*
 * One text in Chinese or Japanese decides, then one in Arabic script: a
 * translated list may hold a name someone typed in English.
 */
const getPunctuationScript: (
  texts: ReadonlyArray<string>,
) => PunctuationScript = (texts: ReadonlyArray<string>): PunctuationScript => {
  if (
    texts.some((text: string): boolean => {
      return IDEOGRAPHIC_SCRIPT_REGEX.test(text);
    })
  ) {
    return "ideographic";
  }

  if (
    texts.some((text: string): boolean => {
      return ARABIC_SCRIPT_REGEX.test(text);
    })
  ) {
    return "arabic";
  }

  return "latin";
};

/*
 * Words listed one after another with the comma of the script they are
 * written in (getListSeparator): "Description, Labels", "توضیحات، برچسب‌ها",
 * "説明、ラベル". For a list of words the reader's language may word - its
 * own labels, counts and phrases - never of codes, addresses or names
 * someone typed.
 */
export const joinList: JoinListFunction = (
  texts: ReadonlyArray<string>,
): string => {
  return texts.join(getListSeparator(texts));
};

// The separator for a list of these texts: ", ", "、" or "، ".
export const getListSeparator: GetListSeparatorFunction = (
  texts: ReadonlyArray<string>,
): string => {
  const script: PunctuationScript = getPunctuationScript(texts);

  if (script === "ideographic") {
    return IDEOGRAPHIC_LIST_SEPARATOR;
  }

  if (script === "arabic") {
    return ARABIC_LIST_SEPARATOR;
  }

  return LIST_SEPARATOR;
};

/*
 * Clauses said one after another on one line, with the semicolon of the
 * script they are written in (getClauseSeparator): "Step 1: Monitor
 * destination; Step 2: Retry count", "第 1 步：监视目标；第 2 步：重试次数".
 * For clauses the reader's language may word, each a whole phrase -
 * clauses that are lists themselves join their names with joinList - never
 * for codes or values someone typed.
 */
export const joinClauses: JoinListFunction = (
  texts: ReadonlyArray<string>,
): string => {
  return texts.join(getClauseSeparator(texts));
};

// The separator for clauses of these texts: "; ", "；" or "؛ ".
export const getClauseSeparator: GetListSeparatorFunction = (
  texts: ReadonlyArray<string>,
): string => {
  const script: PunctuationScript = getPunctuationScript(texts);

  if (script === "ideographic") {
    return IDEOGRAPHIC_CLAUSE_SEPARATOR;
  }

  if (script === "arabic") {
    return ARABIC_CLAUSE_SEPARATOR;
  }

  return CLAUSE_SEPARATOR;
};
