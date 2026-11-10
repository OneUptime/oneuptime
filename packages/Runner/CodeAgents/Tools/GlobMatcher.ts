/*
 * Glob patterns over repository paths, for find_files and search_files'
 * glob (issue #6441): `*` is any run of characters within one folder name,
 * `?` one character, `[abc]` / `[a-z]` / `[!abc]` one of a set, `**` any
 * number of folders, and `{ts,tsx}` either. A pattern without a `/` matches
 * a file's name wherever it is; one with a `/` matches the path from the
 * folder searched.
 *
 * The patterns are the model's and the paths the repository's, so nothing
 * here builds a regular expression from them: a pattern with many stars
 * against a long name would make a backtracking regular expression take
 * exponential time. Names are matched with the two-pointer wildcard walk
 * and folders with a table over (pattern part, path part), so a match costs
 * at most the product of the two lengths.
 */

// The most patterns braces may expand into.
const MAX_BRACE_EXPANSIONS: number = 64;

// Any character that makes a pattern a glob rather than plain text.
const GLOB_CHARACTER_PATTERN: RegExp = /[*?[{]/;

// The longest pattern matched at all.
export const MAX_GLOB_PATTERN_LENGTH: number = 1_000;

export default class GlobMatcher {
  private readonly alternatives: Array<Array<string>>;
  private readonly matchesNameOnly: boolean;
  private readonly ignoreCase: boolean;

  public constructor(pattern: string, options?: { ignoreCase?: boolean }) {
    const trimmed: string = pattern
      .trim()
      .replace(/^\.\//, "")
      .substring(0, MAX_GLOB_PATTERN_LENGTH);

    this.ignoreCase = options?.ignoreCase === true;
    this.matchesNameOnly = !trimmed.includes("/");

    const prepared: string = this.ignoreCase ? trimmed.toLowerCase() : trimmed;

    this.alternatives = GlobMatcher.expandBraces(prepared).map(
      (alternative: string): Array<string> => {
        return alternative.split("/").filter((part: string): boolean => {
          return part.length > 0;
        });
      },
    );
  }

  // Whether a pattern uses any glob character at all.
  public static isGlob(pattern: string): boolean {
    return GLOB_CHARACTER_PATTERN.test(pattern);
  }

  // Whether the path (relative, with `/` between folders) matches.
  public matches(relativePath: string): boolean {
    const prepared: string = this.ignoreCase
      ? relativePath.toLowerCase()
      : relativePath;
    const parts: Array<string> = prepared
      .split("/")
      .filter((part: string): boolean => {
        return part.length > 0;
      });

    if (parts.length === 0) {
      return false;
    }

    for (const alternative of this.alternatives) {
      if (this.matchesNameOnly) {
        if (
          alternative.length === 1 &&
          GlobMatcher.matchesName(
            alternative[0] as string,
            parts[parts.length - 1] as string,
          )
        ) {
          return true;
        }

        continue;
      }

      if (GlobMatcher.matchesParts(alternative, parts)) {
        return true;
      }
    }

    return false;
  }

  /*
   * `{a,b}` written out as each of its patterns (nested braces too), at most
   * MAX_BRACE_EXPANSIONS of them; a brace with no comma is kept as written.
   */
  private static expandBraces(pattern: string): Array<string> {
    let results: Array<string> = [pattern];

    for (let round: number = 0; round < 8; round++) {
      let expanded: boolean = false;
      const next: Array<string> = [];

      for (const candidate of results) {
        const open: number = candidate.indexOf("{");
        let close: number = -1;
        let depth: number = 0;

        if (open !== -1) {
          for (let index: number = open; index < candidate.length; index++) {
            const character: string = candidate[index] as string;

            if (character === "{") {
              depth++;
            } else if (character === "}") {
              depth--;

              if (depth === 0) {
                close = index;
                break;
              }
            }
          }
        }

        if (open === -1 || close === -1) {
          next.push(candidate);
          continue;
        }

        const inside: string = candidate.substring(open + 1, close);
        const options: Array<string> = GlobMatcher.splitTopLevel(inside);

        if (options.length < 2) {
          next.push(candidate);
          continue;
        }

        expanded = true;

        for (const option of options) {
          next.push(
            `${candidate.substring(0, open)}${option}${candidate.substring(close + 1)}`,
          );
        }
      }

      results = next.slice(0, MAX_BRACE_EXPANSIONS);

      if (!expanded) {
        break;
      }
    }

    return results;
  }

  // "a,{b,c},d" -> ["a", "{b,c}", "d"]: commas outside nested braces.
  private static splitTopLevel(text: string): Array<string> {
    const parts: Array<string> = [];
    let depth: number = 0;
    let current: string = "";

    for (const character of text) {
      if (character === "{") {
        depth++;
      } else if (character === "}") {
        depth--;
      }

      if (character === "," && depth === 0) {
        parts.push(current);
        current = "";
        continue;
      }

      current += character;
    }

    parts.push(current);
    return parts;
  }

  /*
   * Pattern parts against path parts: `**` takes any number of path parts
   * (none included), any other part one path part. A table over the two
   * positions, so `**` repeated never backtracks.
   */
  private static matchesParts(
    pattern: Array<string>,
    parts: Array<string>,
  ): boolean {
    const rows: number = pattern.length + 1;
    const columns: number = parts.length + 1;
    // reachable[i][j]: pattern[0..i) matches parts[0..j).
    const reachable: Array<Array<boolean>> = [];

    for (let row: number = 0; row < rows; row++) {
      reachable.push(new Array<boolean>(columns).fill(false));
    }

    (reachable[0] as Array<boolean>)[0] = true;

    for (let row: number = 1; row < rows; row++) {
      const part: string = pattern[row - 1] as string;
      const previous: Array<boolean> = reachable[row - 1] as Array<boolean>;
      const current: Array<boolean> = reachable[row] as Array<boolean>;

      if (part === "**") {
        let any: boolean = false;

        for (let column: number = 0; column < columns; column++) {
          any = any || (previous[column] as boolean);
          current[column] = any;
        }

        continue;
      }

      for (let column: number = 1; column < columns; column++) {
        current[column] =
          (previous[column - 1] as boolean) &&
          GlobMatcher.matchesName(part, parts[column - 1] as string);
      }
    }

    return (reachable[rows - 1] as Array<boolean>)[columns - 1] as boolean;
  }

  /*
   * One name against one pattern part, `*` within the name: the
   * two-pointer walk that goes back only to the last star, so a pattern
   * with many stars costs at most the product of the lengths.
   */
  public static matchesName(pattern: string, name: string): boolean {
    let patternIndex: number = 0;
    let nameIndex: number = 0;
    let starIndex: number = -1;
    let starNameIndex: number = 0;

    while (nameIndex < name.length) {
      if (patternIndex < pattern.length) {
        const character: string = pattern[patternIndex] as string;

        if (character === "*") {
          starIndex = patternIndex;
          starNameIndex = nameIndex;
          patternIndex++;
          continue;
        }

        if (character === "[") {
          const set: { matches: boolean; length: number } | null =
            GlobMatcher.matchSet(
              pattern,
              patternIndex,
              name[nameIndex] as string,
            );

          if (set && set.matches) {
            patternIndex += set.length;
            nameIndex++;
            continue;
          }

          if (!set && name[nameIndex] === "[") {
            // An unclosed `[` is the character itself.
            patternIndex++;
            nameIndex++;
            continue;
          }
        } else if (character === "?" || character === name[nameIndex]) {
          patternIndex++;
          nameIndex++;
          continue;
        }
      }

      if (starIndex !== -1) {
        patternIndex = starIndex + 1;
        starNameIndex++;
        nameIndex = starNameIndex;
        continue;
      }

      return false;
    }

    while (pattern[patternIndex] === "*") {
      patternIndex++;
    }

    return patternIndex === pattern.length;
  }

  /*
   * `[...]` at `start` against one character: whether it matches, and how
   * long the set is - or null when the `[` is never closed.
   */
  private static matchSet(
    pattern: string,
    start: number,
    character: string,
  ): { matches: boolean; length: number } | null {
    let index: number = start + 1;
    let negated: boolean = false;

    if (pattern[index] === "!" || pattern[index] === "^") {
      negated = true;
      index++;
    }

    let matches: boolean = false;
    let first: boolean = true;

    while (index < pattern.length) {
      const current: string = pattern[index] as string;

      if (current === "]" && !first) {
        return { matches: matches !== negated, length: index - start + 1 };
      }

      first = false;

      if (
        pattern[index + 1] === "-" &&
        index + 2 < pattern.length &&
        pattern[index + 2] !== "]"
      ) {
        const low: string = current;
        const high: string = pattern[index + 2] as string;

        if (character >= low && character <= high) {
          matches = true;
        }

        index += 3;
        continue;
      }

      if (current === character) {
        matches = true;
      }

      index++;
    }

    return null;
  }
}
