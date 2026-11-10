/*
 * WHAT A TEST LOOKS FOR IN AN ARABIC STRING, where Arabic's own rules
 * change a word's letters (the Dashboard's Locales/ARABIC.md).
 */

// A dot that starts a word: ".txt", ".csv".
const LEADING_DOT_REGEX: RegExp = /^\.(?=[A-Za-z0-9])/;

// A wildcard that ends a family of names: "browser.*".
const TRAILING_WILDCARD_REGEX: RegExp = /\.\*$/;

// Arabic's marks over and under its letters: a shadda, a tanween, a fatha.
const COMBINING_MARK_REGEX: RegExp = /\p{M}/gu;

/*
 * The definite article at the start of a word, after "و", "ف", "ب" or "ك"
 * when one is joined to it: "المؤشر", "بالحادثة", "كالمعتاد".
 */
const DEFINITE_ARTICLE_REGEX: RegExp =
  /(^|[^\p{L}\p{M}])([وفبك]?)ال(?=\p{L})/gu;

/*
 * A kasra tanween that ends a word, a shadda beside it or not: the mark of
 * a noun that drops its last letter, ي, when it is indefinite ("تقصٍّ" is
 * "تقصّي", a hunt; "قاضٍ" is "قاضي").
 */
const DROPPED_YA_REGEX: RegExp = /\u0651?\u064D\u0651?(?=$|[^\p{L}\p{M}])/gu;

/*
 * A word a sentence keeps as written - a file's extension, a family of
 * attributes - as a language writes it. The Arabic strings hold no
 * direction marks, so a dot that starts a Latin word right after Arabic is
 * drawn at the word's far end (".txt" reads "txt."), and so is a wildcard
 * that ends one before more Arabic ("browser.*" reads "*.browser"). Arabic
 * names a format without its dot ("ملف txt") and a family of attributes by
 * the name they start with ("السمات التي تبدأ بـ browser"). Every other
 * language writes the word as it is.
 */
export const wordAsWrittenIn: (language: string, word: string) => string = (
  language: string,
  word: string,
): string => {
  if (language !== "ar") {
    return word;
  }

  return word
    .replace(LEADING_DOT_REGEX, "")
    .replace(TRAILING_WILDCARD_REGEX, "");
};

/*
 * An Arabic text folded so one word can be found in another: without its
 * marks, without the definite article, and with the ي an indefinite noun
 * drops written back. A noun drops the article when it heads a construct
 * ("مؤشر مصدر البيانات", the data source's gauge, where the picker says
 * "المؤشر"), and a whole construct does after "كـ" ("حفظ كعملية تقصٍّ",
 * save as a hunt, where the list says "عملية التقصي") - as a German word
 * joins a compound without its last letters. The article goes first,
 * while a hamza is still part of its letter: "ألوان" (colours) starts with
 * "أل", not the article.
 */
export const foldedArabic: (text: string) => string = (
  text: string,
): string => {
  return text
    .normalize("NFC")
    .replace(DEFINITE_ARTICLE_REGEX, "$1$2")
    .replace(DROPPED_YA_REGEX, "ي")
    .normalize("NFD")
    .replace(COMBINING_MARK_REGEX, "");
};
