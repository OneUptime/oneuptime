import LinearRegExp from "../LinearRegExp/LinearRegExp";
import { getLinearRegExp } from "../LinearRegExp/PatternCache";
import lookupTable from "../LookupTable";

/*
 * PromQL's regular expressions, read in JavaScript.
 *
 * Prometheus matches with Go's RE2, always anchored at both ends: `=~"api"`
 * matches the value "api" and not "api-2". JavaScript reads nearly all of RE2
 * the same way; the few spellings it reads differently, and that people write
 * in label matchers, are translated here: the `(?i)` flag group at the start,
 * `(?P<name>...)` named groups, and POSIX classes such as `[[:digit:]]`.
 *
 * A matcher's pattern is written by a project's people, so it runs on the
 * linear-time matcher (Utils/LinearRegExp), as every such pattern does: in
 * time in line with the value it reads, as RE2 runs it. It is compiled once
 * and kept (PatternCache), by the pattern, so a query that asks it about
 * every series compiles it once.
 */

/*
 * Read by the name a pattern writes between `[:` and `:]`, so a Map: a
 * plain object would read `[[:constructor:]]` as the source text of the
 * function every object inherits, not as a name no class has.
 */
const POSIX_CLASSES: ReadonlyMap<string, string> = lookupTable<string>({
  alnum: "0-9A-Za-z",
  alpha: "A-Za-z",
  ascii: "\\x00-\\x7F",
  blank: "\\t ",
  cntrl: "\\x00-\\x1F\\x7F",
  digit: "0-9",
  graph: "!-~",
  lower: "a-z",
  print: " -~",
  punct: "!-\\/:-@\\[-`{-~",
  space: "\\t\\n\\v\\f\\r ",
  upper: "A-Z",
  word: "0-9A-Za-z_",
  xdigit: "0-9A-Fa-f",
});

const POSIX_CLASS_REGEX: RegExp = /\[:(\^?)([a-z]+):\]/g;

const LEADING_FLAGS_REGEX: RegExp = /^\(\?([imsU]+)\)/;

const NAMED_GROUP_REGEX: RegExp = /\(\?P</g;

export interface PromQLRegexOptions {
  /*
   * Whether exec reports what the groups captured, as label_replace() reads
   * them. Off, a match says only that the value matched.
   */
  captures?: boolean | undefined;
}

export interface CompiledPromQLRegex {
  regex: LinearRegExp;
  // The pattern as Prometheus anchors it, for engines that speak RE2.
  anchoredPattern: string;
}

/*
 * The regular expression a matcher's pattern means, anchored as Prometheus
 * anchors it. Throws what getLinearRegExp throws: a SyntaxError for a pattern
 * that is not a regular expression, and PatternProblemError for one the
 * linear-time matcher cannot run (a back-reference, or one too large).
 */
export const compilePromQLRegex: (
  pattern: string,
  options?: PromQLRegexOptions,
) => CompiledPromQLRegex = (
  pattern: string,
  options?: PromQLRegexOptions,
): CompiledPromQLRegex => {
  let body: string = pattern;
  let flags: string = "";

  const leadingFlags: RegExpExecArray | null = LEADING_FLAGS_REGEX.exec(body);

  if (leadingFlags) {
    body = body.slice(leadingFlags[0].length);

    for (const flag of leadingFlags[1]!) {
      // RE2's U (ungreedy) has no JavaScript twin; i, m and s do.
      if (flag !== "U" && !flags.includes(flag)) {
        flags += flag;
      }
    }
  }

  body = body.replace(NAMED_GROUP_REGEX, "(?<");

  body = body.replace(
    POSIX_CLASS_REGEX,
    (whole: string, negated: string, name: string): string => {
      const members: string | undefined = POSIX_CLASSES.get(name);

      // A negated POSIX class only reads inside its own bracket: `[^[:digit:]]`.
      if (!members || negated) {
        return whole;
      }

      return members;
    },
  );

  return {
    regex: getLinearRegExp(`^(?:${body})$`, flags, {
      captures: options?.captures === true,
    }),
    anchoredPattern: `^(?:${pattern})$`,
  };
};
