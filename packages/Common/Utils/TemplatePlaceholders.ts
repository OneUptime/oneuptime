/*
 * "{{...}}" PLACEHOLDERS, FOUND IN TIME IN LINE WITH THE TEXT'S LENGTH.
 *
 * A placeholder is what the pattern /{{(.*?)}}/g finds: "{{", then the
 * fewest characters other than a line break, then "}}". The runtime that
 * fills a workflow's arguments (VMAPI), the workflow builder's checks
 * (TemplateSyntax, JsonSyntax) and the WhatsApp templates all read
 * placeholders this way, and each finds here exactly what it found before.
 *
 * That pattern read on to the end of the line from every "{{" that has no
 * "}}" after it on its line, and the search tried again from the next "{{" -
 * so on a line of "{{{{{{..." its time grew with the square of the line's
 * length. Each pattern below takes such a "{{" and the rest of its line in a
 * last alternative, which the functions here give back as it was written,
 * so the search goes on from the next line: no later "{{" on that line has
 * a "}}" after it either.
 */

/*
 * A placeholder (group 1 is what is between its braces), or - when no "}}"
 * follows a "{{" on its line - that "{{" and the rest of the line, with no
 * group.
 */
const PLACEHOLDER_OR_REST_OF_LINE: RegExp = /{{(.*?)}}|{{.*/g;

/*
 * The same, for a loop body's own names: a placeholder that is not a loop's
 * own tag ({{#each ...}}, {{/each}}, {{@index}}). A "{{" that starts one of
 * those tags is no placeholder and takes nothing with it, as before; the
 * search goes on right after it.
 */
const LOOP_VARIABLE_OR_REST_OF_LINE: RegExp =
  /\{\{((?!#each\b|\/each\b|@index\b).*?)\}\}|\{\{(?!#each\b|\/each\b|@index\b).*/g;

/*
 * A loop's opening tag, "{{#each path}}", as /\{\{#each\s+(.*?)\}\}/g found
 * it - group 1 is the path - or what no tag can start in.
 *
 * The white space after "#each" is taken whole: a shorter run would leave
 * the path starting with white space, which finds no "}}" the whole run did
 * not. When no "}}" follows on the line the white space ends on, the second
 * alternative takes the rest of that line - up to a "{{#each" that only
 * white space follows to the line's end: the white space after that one runs
 * on to the next line, where a "}}" may follow it.
 */
const EACH_OPENING_OR_REST_OF_LINE: RegExp =
  /\{\{#each\s+(?!\s)(.*?)\}\}|\{\{#each\s+(?:(?!\{\{#each\s*$)[^\n\r\u2028\u2029])*/gm;

export interface TemplatePlaceholder {
  // Index of the first "{" in the text.
  start: number;
  // Index just past the last "}".
  end: number;
  // The placeholder as written, braces included.
  text: string;
  // What is between the braces, as written.
  inner: string;
}

type ReadMatchesFunction = (
  pattern: RegExp,
  text: string,
  from: number,
  limit: number,
) => Array<TemplatePlaceholder>;

const readMatches: ReadMatchesFunction = (
  pattern: RegExp,
  text: string,
  from: number,
  limit: number,
): Array<TemplatePlaceholder> => {
  const found: Array<TemplatePlaceholder> = [];

  pattern.lastIndex = from;

  while (found.length < limit) {
    const match: RegExpExecArray | null = pattern.exec(text);

    if (!match) {
      break;
    }

    // What the last alternative took: no placeholder.
    if (match[1] === undefined) {
      continue;
    }

    found.push({
      start: match.index,
      end: match.index + match[0].length,
      text: match[0],
      inner: match[1],
    });
  }

  pattern.lastIndex = 0;

  return found;
};

export type FindTemplatePlaceholdersFunction = (
  text: string,
  limit?: number,
) => Array<TemplatePlaceholder>;

/*
 * Every placeholder in the text, in order, as text.matchAll(/{{(.*?)}}/g)
 * gives them - or only the first `limit` of them.
 */
export const findTemplatePlaceholders: FindTemplatePlaceholdersFunction = (
  text: string,
  limit: number = Infinity,
): Array<TemplatePlaceholder> => {
  if (typeof text !== "string" || text.indexOf("{{") === -1) {
    return [];
  }

  return readMatches(PLACEHOLDER_OR_REST_OF_LINE, text, 0, limit);
};

export type HasTemplatePlaceholderFunction = (text: string) => boolean;

// As /{{(.*?)}}/.test(text).
export const hasTemplatePlaceholder: HasTemplatePlaceholderFunction = (
  text: string,
): boolean => {
  return findTemplatePlaceholders(text, 1).length > 0;
};

export type ReplacePlaceholderFunction = (
  placeholder: TemplatePlaceholder,
) => string;

type ReplaceMatchesFunction = (
  pattern: RegExp,
  text: string,
  replace: ReplacePlaceholderFunction,
) => string;

const replaceMatches: ReplaceMatchesFunction = (
  pattern: RegExp,
  text: string,
  replace: ReplacePlaceholderFunction,
): string => {
  return text.replace(
    pattern,
    (whole: string, inner: string | undefined, offset: number): string => {
      // What the last alternative took goes back as it was written.
      if (inner === undefined) {
        return whole;
      }

      return replace({
        start: offset,
        end: offset + whole.length,
        text: whole,
        inner: inner,
      });
    },
  );
};

export type ReplaceTemplatePlaceholdersFunction = (
  text: string,
  replace: ReplacePlaceholderFunction,
) => string;

/*
 * The text with every placeholder replaced by what `replace` gives for it,
 * as text.replace(/{{(.*?)}}/g, ...) wrote it. What `replace` gives is
 * placed as it is: no "$" in it is read as a pattern.
 */
export const replaceTemplatePlaceholders: ReplaceTemplatePlaceholdersFunction =
  (text: string, replace: ReplacePlaceholderFunction): string => {
    if (typeof text !== "string" || text.indexOf("{{") === -1) {
      return text;
    }

    return replaceMatches(PLACEHOLDER_OR_REST_OF_LINE, text, replace);
  };

/*
 * As replaceTemplatePlaceholders, for the placeholders of a loop body's own
 * text that are not a loop's own tags - as
 * text.replace(/\{\{((?!#each\b|\/each\b|@index\b).*?)\}\}/g, ...) wrote it.
 */
export const replaceLoopVariablePlaceholders: ReplaceTemplatePlaceholdersFunction =
  (text: string, replace: ReplacePlaceholderFunction): string => {
    if (typeof text !== "string" || text.indexOf("{{") === -1) {
      return text;
    }

    return replaceMatches(LOOP_VARIABLE_OR_REST_OF_LINE, text, replace);
  };

export type FindEachOpeningFunction = (
  text: string,
  from: number,
) => TemplatePlaceholder | null;

/*
 * The first "{{#each path}}" at or after `from`, as
 * /\{\{#each\s+(.*?)\}\}/g with lastIndex `from` found it: `inner` is what
 * stands between the white space after "#each" and the "}}".
 */
export const findEachOpening: FindEachOpeningFunction = (
  text: string,
  from: number,
): TemplatePlaceholder | null => {
  if (typeof text !== "string") {
    return null;
  }

  return readMatches(EACH_OPENING_OR_REST_OF_LINE, text, from, 1)[0] || null;
};
