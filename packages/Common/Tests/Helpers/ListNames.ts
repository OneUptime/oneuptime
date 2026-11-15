/*
 * WHETHER A TERM NAMES WHAT ITS LIST DOES (#7386, #8029).
 *
 * The Dashboard has two keys for most things: the title-case name its side
 * menu, its Products menu and its page titles say ("Status Pages"), and the
 * lower-case term its counts and sentences say ("Archive 3 status pages?").
 * A reader picks "Страницы состояния" in the menu and must not then be asked
 * about "статус-страницы": the two say one noun.
 *
 * A term names its list when the first three letters of its first word
 * begin a word of the list's name: "arbejdsgang" and "Arbejdsgange", "سير
 * عمل" and "مهام سير العمل"; never "workflow" and "Flux de travail". Two
 * things a term may carry that its list does not are set aside first:
 *
 *   - Arabic's article (ال) before a word of three letters or more:
 *     المراقبات is مراقبات;
 *   - a Chinese measure word before a counted noun: zh-CN counts "3 个指标"
 *     under its "指标" list, zh-TW "3 個指標" under "指標".
 */

// Arabic's article before a word of three letters or more: المراقبات.
const ARABIC_ARTICLE: RegExp = /^ال(?=.{3})/u;

// The measure word Chinese counts a noun with: 个 (zh-CN), 個 (zh-TW).
const CHINESE_MEASURE_WORD: RegExp = /^[个個](?=.)/u;

// A name's words, in lower case, Arabic's article taken off.
export function nameWords(name: string): Array<string> {
  return name
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((word: string): string => {
      return word.replace(ARABIC_ARTICLE, "");
    });
}

export function namesItsList(term: string, list: string): boolean {
  const counted: string = term.trim().replace(CHINESE_MEASURE_WORD, "");
  const lead: string = nameWords(counted)[0]!.slice(0, 3);

  if (!lead) {
    return false;
  }

  return nameWords(list).some((word: string): boolean => {
    return word.startsWith(lead);
  });
}
