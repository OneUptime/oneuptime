/*
 * Glob → SQL LIKE translation, shared by every wildcard-capable filter.
 *
 * Users type globs (`api-*`, `*.internal`, `a?c`); ClickHouse and Postgres
 * speak LIKE patterns (`%`, `_`). The two alphabets overlap in the worst
 * possible way: a `%` a user typed literally is a match-anything token to the
 * database, and an `_` matches any single character. So the translation has to
 * happen in ONE pass that can tell a metacharacter the user meant from one the
 * database will read — running `escapeIlikePattern` first and then replacing
 * `*` would work, but running it after would escape the `%` this function just
 * produced, and every caller getting that order wrong is a silent
 * match-nothing.
 *
 * Grammar:
 *   *      → zero or more characters   (LIKE `%`)
 *   ?      → exactly one character     (LIKE `_`)
 *   \*     → a literal asterisk        (also \? \\ , and \<anything> is that
 *                                       character, literally)
 *   %  _   → literal, escaped for the database
 *
 * Both databases honour backslash escapes inside LIKE patterns, and every
 * pattern this module produces is bound as a query parameter — never
 * interpolated — so this is a correctness concern, not an injection one.
 */

type EscapeLiteralCharFunction = (character: string) => string;

/** Escape one literal character so LIKE reads it as itself. */
const escapeLiteralChar: EscapeLiteralCharFunction = (
  character: string,
): string => {
  if (character === "\\") {
    return "\\\\";
  }

  if (character === "%") {
    return "\\%";
  }

  if (character === "_") {
    return "\\_";
  }

  return character;
};

export type GlobToLikePatternFunction = (glob: string) => string;

/**
 * Translate a user-typed glob into a LIKE/ILIKE pattern.
 *
 * `toLikePattern("api-*")` → `"api-%"`, `toLikePattern("*.internal")` →
 * `"%.internal"`, `toLikePattern("100%")` → `"100\\%"` (a literal percent,
 * because the user typed no wildcard at all).
 */
export const toLikePattern: GlobToLikePatternFunction = (
  glob: string,
): string => {
  let pattern: string = "";

  for (let index: number = 0; index < glob.length; index++) {
    const character: string = glob[index]!;

    if (character === "\\") {
      /*
       * A trailing lone backslash is the user's literal backslash — there is
       * no next character for it to escape.
       */
      const escaped: string | undefined = glob[index + 1];

      if (escaped === undefined) {
        pattern += escapeLiteralChar("\\");
        continue;
      }

      pattern += escapeLiteralChar(escaped);
      index++;
      continue;
    }

    if (character === "*") {
      pattern += "%";
      continue;
    }

    if (character === "?") {
      pattern += "_";
      continue;
    }

    pattern += escapeLiteralChar(character);
  }

  return pattern;
};

export type HasWildcardFunction = (value: string) => boolean;

/**
 * Does this value contain an UNESCAPED wildcard?
 *
 * This is what decides whether a typed value becomes a wildcard predicate or
 * plain equality, so it has to honour the same escapes `toLikePattern` does:
 * `a\*b` is a literal three-character-plus value, not a glob.
 */
export const hasWildcard: HasWildcardFunction = (value: string): boolean => {
  for (let index: number = 0; index < value.length; index++) {
    const character: string = value[index]!;

    if (character === "\\") {
      // Skip whatever it escapes; an escaped `*` is not a wildcard.
      index++;
      continue;
    }

    if (character === "*" || character === "?") {
      return true;
    }
  }

  return false;
};

export type EscapeWildcardsFunction = (value: string) => string;

/**
 * Make a value glob-inert, for building a search string out of data.
 *
 * A value that came from the data itself (a facet value the user clicked, an
 * attribute copied off a log row) must round-trip as itself — a Kubernetes
 * container arg like `--foo=*` or a URL pattern `/api/*` would otherwise come
 * back as a wildcard and match far more than the row it was copied from.
 */
export const escapeWildcards: EscapeWildcardsFunction = (
  value: string,
): string => {
  return value.replace(/([\\*?])/g, "\\$1");
};

/**
 * Strip the escapes from a glob, recovering the literal text the user meant.
 *
 * Used to render a chip and to fall back to exact equality when a value turns
 * out to carry no wildcard after all.
 */
export const unescapeWildcards: EscapeWildcardsFunction = (
  value: string,
): string => {
  let literal: string = "";

  for (let index: number = 0; index < value.length; index++) {
    const character: string = value[index]!;

    if (character === "\\" && index + 1 < value.length) {
      literal += value[index + 1]!;
      index++;
      continue;
    }

    literal += character;
  }

  return literal;
};
