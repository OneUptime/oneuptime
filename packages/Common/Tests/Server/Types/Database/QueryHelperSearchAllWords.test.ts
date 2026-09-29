import QueryHelper from "../../../../Server/Types/Database/QueryHelper";
import { describe, expect, it } from "@jest/globals";

/*
 * QueryHelper.searchAllWords backs POST /network-site/search, the dropdown
 * that lets the Device Topology search box find a site on ANY level of the
 * hierarchy (issue #3981). The customer recalls a site as a handful of words
 * ("michigan 104822") and expects "Unit 104822 - Michigan Ave" to come back,
 * so the helper turns every word into its own ILIKE and AND-joins them.
 *
 * As in the sibling QueryHelper suites, the SQL is produced by a function on
 * the Raw operator given the column alias, and the values live in the
 * operator's parameter bag. Neither is visible from the FindOperator's JSON,
 * so every test renders the operator with `getSql(alias)` and reads
 * `objectLiteralParameters`.
 *
 * The properties pinned here are the ones the endpoint relies on:
 *
 *   1. EVERY WORD, ANY ORDER. One ILIKE per word, AND-joined, each with its
 *      own bound parameter, the whole thing parenthesised so it cannot bleed
 *      into a neighbouring OR in the WHERE clause.
 *
 *   2. WORDS ARE LITERAL. A `%`, `_` or `\` the user typed is escaped, so
 *      "100%" is not a wildcard; glob characters are left alone because this
 *      is a substring search, not the wildcard operator.
 *
 *   3. NOTHING TO SEARCH FOR MATCHES NOTHING. An AND over zero predicates is
 *      vacuously true, and "the whole table" is never what an empty box meant.
 */

interface RawOperator {
  type: string;
  objectLiteralParameters: Record<string, unknown>;
  // TypeORM builds the SQL through this, given the column alias.
  getSql: (aliasPath: string) => string;
}

type AsRawFunction = (operator: unknown) => RawOperator;

const asRaw: AsRawFunction = (operator: unknown): RawOperator => {
  return operator as unknown as RawOperator;
};

// A stable alias to render every operator against.
const ALIAS: string = '"NetworkSite"."name"';

type SearchAllWordsFunction = (words: Array<string>) => RawOperator;

const searchAllWords: SearchAllWordsFunction = (
  words: Array<string>,
): RawOperator => {
  return asRaw(QueryHelper.searchAllWords(words));
};

type ParamValuesFunction = (operator: RawOperator) => Array<unknown>;

const paramValues: ParamValuesFunction = (
  operator: RawOperator,
): Array<unknown> => {
  return Object.values(operator.objectLiteralParameters);
};

type ParamNamesFunction = (operator: RawOperator) => Array<string>;

const paramNames: ParamNamesFunction = (
  operator: RawOperator,
): Array<string> => {
  return Object.keys(operator.objectLiteralParameters);
};

type CountFunction = (haystack: string, needle: string) => number;

const countOccurrences: CountFunction = (
  haystack: string,
  needle: string,
): number => {
  return haystack.split(needle).length - 1;
};

type PlaceholdersFunction = (sql: string) => Array<string>;

// The `:name` placeholders the SQL references, in the order they appear.
const placeholdersIn: PlaceholdersFunction = (sql: string): Array<string> => {
  const names: Array<string> = [];
  const matcher: RegExp = /:([A-Za-z0-9_]+)/g;
  let match: RegExpExecArray | null = matcher.exec(sql);
  while (match) {
    names.push(match[1] as string);
    match = matcher.exec(sql);
  }
  return names;
};

type IlikeFunction = (value: string, pattern: string) => boolean;

/*
 * A tiny model of Postgres ILIKE with its default `\` escape: `%` is any run
 * of characters, `_` is exactly one, `\x` is the literal x, and the match is
 * case-insensitive and anchored at both ends. It lets the tests below state
 * the behaviour in the customer's terms ("does this name come back?") rather
 * than only as pattern strings.
 */
const ilike: IlikeFunction = (value: string, pattern: string): boolean => {
  let source: string = "";
  for (let i: number = 0; i < pattern.length; i++) {
    const char: string = pattern[i] as string;
    if (char === "\\" && i + 1 < pattern.length) {
      i++;
      source += (pattern[i] as string).replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
    } else if (char === "%") {
      source += "[\\s\\S]*";
    } else if (char === "_") {
      source += "[\\s\\S]";
    } else {
      source += char.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
    }
  }
  return new RegExp(`^${source}$`, "iu").test(value);
};

type MatchesFunction = (operator: RawOperator, value: string) => boolean;

/*
 * Evaluates the rendered SQL against one column value. It is driven by the
 * SQL itself (split on AND, look up each placeholder) so that a regression
 * to OR-joining, or a condition that references the wrong parameter, shows
 * up as a wrong answer rather than passing on the parameter bag alone.
 */
const rowMatches: MatchesFunction = (
  operator: RawOperator,
  value: string,
): boolean => {
  const sql: string = operator.getSql(ALIAS);

  if (sql === "TRUE = FALSE") {
    return false;
  }

  const body: string = sql.slice(1, -1);

  return body.split(" AND ").every((condition: string): boolean => {
    const names: Array<string> = placeholdersIn(condition);
    expect(names).toHaveLength(1);
    expect(condition).toBe(`CAST(${ALIAS} AS TEXT) ILIKE :${names[0]}`);
    const pattern: unknown =
      operator.objectLiteralParameters[names[0] as string];
    expect(typeof pattern).toBe("string");
    return ilike(value, pattern as string);
  });
};

describe("QueryHelper.searchAllWords - SQL shape", () => {
  /*
   * The endpoint drops this straight into `where: { name: ... }`, so the
   * shape has to be something TypeORM can splice into a larger WHERE: a Raw
   * operator, bound placeholders only, one predicate per word, parenthesised.
   */

  it("returns a TypeORM Raw operator", () => {
    expect(searchAllWords(["michigan"]).type).toBe("raw");
    expect(searchAllWords([]).type).toBe("raw");
  });

  it("one word renders exactly one ILIKE with the pattern %word%", () => {
    const operator: RawOperator = searchAllWords(["michigan"]);
    const sql: string = operator.getSql(ALIAS);
    const names: Array<string> = paramNames(operator);

    expect(names).toHaveLength(1);
    expect(paramValues(operator)).toEqual(["%michigan%"]);
    expect(countOccurrences(sql.toUpperCase(), "ILIKE")).toBe(1);
    expect(sql).not.toContain(" AND ");
    expect(sql).toBe(`(CAST(${ALIAS} AS TEXT) ILIKE :${names[0]})`);
  });

  it("several words are AND-joined, one ILIKE and one parameter per word", () => {
    const operator: RawOperator = searchAllWords([
      "unit",
      "104822",
      "michigan",
    ]);
    const sql: string = operator.getSql(ALIAS);

    expect(countOccurrences(sql.toUpperCase(), "ILIKE")).toBe(3);
    expect(countOccurrences(sql, " AND ")).toBe(2);
    // An AND, never an OR: "any of the words" would flood the dropdown.
    expect(sql.toUpperCase()).not.toContain(" OR ");
    expect(paramValues(operator)).toEqual(["%unit%", "%104822%", "%michigan%"]);
  });

  it("gives every word a distinct parameter name, each referenced exactly once", () => {
    /*
     * Reusing one name would bind every condition to the same value; a name
     * the SQL never references would silently drop a word from the search.
     */
    const operator: RawOperator = searchAllWords(["a", "b", "c", "d"]);
    const sql: string = operator.getSql(ALIAS);
    const names: Array<string> = paramNames(operator);

    expect(new Set<string>(names).size).toBe(4);
    for (const name of names) {
      expect(countOccurrences(sql, `:${name}`)).toBe(1);
    }
    // The SQL references nothing outside the parameter bag, in word order.
    expect(placeholdersIn(sql)).toEqual(names);
  });

  it("generates parameter names TypeORM accepts as named placeholders", () => {
    const operator: RawOperator = searchAllWords(["alpha", "beta"]);

    for (const name of paramNames(operator)) {
      expect(name).toMatch(/^[A-Za-z]{10}$/);
    }
  });

  it("wraps the whole expression in one pair of parentheses", () => {
    /*
     * Without them, `a AND b` spliced next to an `OR` elsewhere in the WHERE
     * would bind wrongly (AND binds tighter than OR).
     */
    const operator: RawOperator = searchAllWords(["alpha", "beta", "gamma"]);
    const sql: string = operator.getSql(ALIAS);
    const names: Array<string> = paramNames(operator);

    expect(sql.startsWith("(")).toBe(true);
    expect(sql.endsWith(")")).toBe(true);
    expect(sql).toBe(
      `(${names
        .map((name: string) => {
          return `CAST(${ALIAS} AS TEXT) ILIKE :${name}`;
        })
        .join(" AND ")})`,
    );
  });

  it("casts the column alias it is given to TEXT in every condition", () => {
    const words: Array<string> = ["alpha", "beta"];
    const operator: RawOperator = searchAllWords(words);

    const siteSql: string = operator.getSql('"NetworkSite"."name"');
    const otherSql: string = operator.getSql('"Other"."title"');

    expect(
      countOccurrences(siteSql, 'CAST("NetworkSite"."name" AS TEXT)'),
    ).toBe(2);
    expect(countOccurrences(otherSql, 'CAST("Other"."title" AS TEXT)')).toBe(2);
    expect(otherSql).not.toContain("NetworkSite");
  });

  it("renders the same SQL every time it is asked", () => {
    /*
     * TypeORM may call getSql more than once while building a query; the
     * parameter names are fixed when the operator is built, not per render.
     */
    const operator: RawOperator = searchAllWords(["alpha", "beta"]);

    expect(operator.getSql(ALIAS)).toBe(operator.getSql(ALIAS));
  });

  it("gives two separate calls distinct parameter names", () => {
    /*
     * Two operators can land in one query (e.g. one per OR branch). TypeORM
     * merges their parameter bags, so a shared name would let one search's
     * value overwrite the other's.
     */
    const first: RawOperator = searchAllWords(["michigan"]);
    const second: RawOperator = searchAllWords(["michigan"]);

    const firstNames: Array<string> = paramNames(first);
    const secondNames: Array<string> = paramNames(second);

    expect(firstNames).toHaveLength(1);
    expect(secondNames).toHaveLength(1);
    expect(firstNames[0]).not.toBe(secondNames[0]);
    expect(first.getSql(ALIAS)).not.toBe(second.getSql(ALIAS));
  });

  it("handles the full eight-word budget the endpoint allows", () => {
    const words: Array<string> = [
      "one",
      "two",
      "three",
      "four",
      "five",
      "six",
      "seven",
      "eight",
    ];
    const operator: RawOperator = searchAllWords(words);
    const sql: string = operator.getSql(ALIAS);

    expect(countOccurrences(sql.toUpperCase(), "ILIKE")).toBe(8);
    expect(countOccurrences(sql, " AND ")).toBe(7);
    expect(new Set<string>(paramNames(operator)).size).toBe(8);
    expect(paramValues(operator)).toEqual(
      words.map((word: string) => {
        return `%${word}%`;
      }),
    );
  });

  it("keeps a repeated word as its own predicate (harmless, and de-duplication belongs to the caller)", () => {
    /*
     * NetworkSiteHierarchyUtil.splitSearchWords already de-duplicates before
     * calling in. Should a repeat slip through, `x AND x` means the same as
     * `x`; what matters is that the two conditions do not share a name.
     */
    const operator: RawOperator = searchAllWords(["unit", "unit"]);
    const names: Array<string> = paramNames(operator);

    expect(paramValues(operator)).toEqual(["%unit%", "%unit%"]);
    expect(new Set<string>(names).size).toBe(2);
    expect(rowMatches(operator, "Unit 7")).toBe(true);
  });
});

describe("QueryHelper.searchAllWords - values are bound and literal", () => {
  /*
   * The words come straight from a search box. They must never be spliced
   * into the SQL, and the LIKE metacharacters in them must mean themselves:
   * somebody searching for "unit_1" wants that name, not "unitX1".
   */

  it("binds every word rather than interpolating it", () => {
    const hostile: string = '\'; DROP TABLE "NetworkSite"; --';
    const operator: RawOperator = searchAllWords([hostile, "michigan"]);
    const sql: string = operator.getSql(ALIAS);

    expect(sql).not.toContain("DROP TABLE");
    expect(sql).not.toContain("michigan");
    expect(sql).not.toContain("'");
    expect(paramValues(operator)).toEqual([`%${hostile}%`, "%michigan%"]);
  });

  it.each([
    ["100%", "%100\\%%"],
    ["unit_1", "%unit\\_1%"],
    ["%", "%\\%%"],
    ["_", "%\\_%"],
    ["50%_off", "%50\\%\\_off%"],
    ["%%__", "%\\%\\%\\_\\_%"],
  ])(
    "escapes the LIKE metacharacters in %p to the pattern %p",
    (word: string, pattern: string) => {
      expect(paramValues(searchAllWords([word]))).toEqual([pattern]);
    },
  );

  it.each([
    ["a\\b", "%a\\\\b%"],
    ["\\", "%\\\\%"],
    ["C:\\sites\\", "%C:\\\\sites\\\\%"],
  ])(
    "doubles a backslash in %p so it cannot escape the next character (%p)",
    (word: string, pattern: string) => {
      expect(paramValues(searchAllWords([word]))).toEqual([pattern]);
    },
  );

  it("escapes a backslash that precedes a metacharacter as two literals", () => {
    /*
     * `\%` typed by a user is a backslash followed by a percent. Both have
     * to be escaped independently: `\\\%`. Escaping only the `%` would leave
     * `\\%`, i.e. a literal backslash followed by a wildcard.
     */
    expect(paramValues(searchAllWords(["\\%"]))).toEqual(["%\\\\\\%%"]);
    expect(paramValues(searchAllWords(["\\_"]))).toEqual(["%\\\\\\_%"]);
  });

  it.each([
    ["api-*", "%api-*%"],
    ["a?c", "%a?c%"],
    ["*", "%*%"],
    ["?", "%?%"],
  ])(
    "leaves the glob characters in %p untranslated (%p)",
    (word: string, pattern: string) => {
      /*
       * Unlike QueryHelper.wildcard, this is a plain substring search: a `*`
       * or `?` in a site name is just a character.
       */
      expect(paramValues(searchAllWords([word]))).toEqual([pattern]);
    },
  );

  it("differs from QueryHelper.wildcard, which does translate a glob", () => {
    expect(paramValues(asRaw(QueryHelper.wildcard("api-*")))).toEqual([
      "api-%",
    ]);
    expect(paramValues(searchAllWords(["api-*"]))).toEqual(["%api-*%"]);
  });

  it("escapes each word independently", () => {
    expect(paramValues(searchAllWords(["100%", "unit_1", "plain"]))).toEqual([
      "%100\\%%",
      "%unit\\_1%",
      "%plain%",
    ]);
  });

  it("preserves case (ILIKE is already case-insensitive)", () => {
    /*
     * Lower-casing buys nothing under ILIKE, and QueryHelper.wildcard's
     * suite records why it is avoided around escapes. The caller
     * (splitSearchWords) lower-cases for de-duplication; the helper itself
     * passes the word through untouched.
     */
    expect(paramValues(searchAllWords(["Michigan", "AVE"]))).toEqual([
      "%Michigan%",
      "%AVE%",
    ]);
  });

  it("keeps non-ASCII characters intact", () => {
    expect(paramValues(searchAllWords(["Zürich", "東京"]))).toEqual([
      "%Zürich%",
      "%東京%",
    ]);
  });
});

describe("QueryHelper.searchAllWords - trimming and blank words", () => {
  /*
   * The caller splits on whitespace, but the helper is public and may be fed
   * raw strings. A blank word would otherwise become `ILIKE '%%'`, which
   * matches every row and hides nothing, and an all-blank list would become
   * an AND over nothing.
   */

  it("trims the whitespace around each word", () => {
    expect(paramValues(searchAllWords(["  michigan  ", "\t104822\n"]))).toEqual(
      ["%michigan%", "%104822%"],
    );
  });

  it("does not split a word on its inner whitespace (splitting is the caller's job)", () => {
    const operator: RawOperator = searchAllWords(["  michigan ave  "]);

    expect(paramValues(operator)).toEqual(["%michigan ave%"]);
    expect(
      countOccurrences(operator.getSql(ALIAS).toUpperCase(), "ILIKE"),
    ).toBe(1);
  });

  it("skips empty and whitespace-only words without leaving a dangling AND", () => {
    const operator: RawOperator = searchAllWords([
      "",
      "michigan",
      "   ",
      "\t\n",
      "104822",
      "",
    ]);
    const sql: string = operator.getSql(ALIAS);

    expect(paramValues(operator)).toEqual(["%michigan%", "%104822%"]);
    expect(countOccurrences(sql.toUpperCase(), "ILIKE")).toBe(2);
    expect(countOccurrences(sql, " AND ")).toBe(1);
    expect(sql).not.toMatch(/AND\s*\)/);
    expect(sql).not.toMatch(/\(\s*AND/);
    expect(sql).not.toContain("AND  AND");
  });

  it("skips null and undefined entries instead of throwing", () => {
    const words: Array<string> = [
      null,
      "michigan",
      undefined,
    ] as unknown as Array<string>;

    expect(paramValues(searchAllWords(words))).toEqual(["%michigan%"]);
  });

  it("does not mutate the array it is given", () => {
    const words: Array<string> = ["  michigan  ", "", "100%"];
    const copy: Array<string> = [...words];

    searchAllWords(words);

    expect(words).toEqual(copy);
  });
});

describe("QueryHelper.searchAllWords - nothing to search for", () => {
  /*
   * An AND over zero predicates is vacuously true. If the helper rendered
   * `()` or dropped the condition, an empty search would return every site
   * in the project; it must return none.
   */

  it("renders TRUE = FALSE with no parameters for an empty list", () => {
    const operator: RawOperator = searchAllWords([]);

    expect(operator.getSql(ALIAS)).toBe("TRUE = FALSE");
    expect(operator.objectLiteralParameters).toEqual({});
  });

  it.each([[[""]], [["", "  ", "\t", "\n"]], [[" \r\n "]]])(
    "renders TRUE = FALSE with no parameters when every word is blank (%p)",
    (words: Array<string>) => {
      const operator: RawOperator = searchAllWords(words);

      expect(operator.getSql(ALIAS)).toBe("TRUE = FALSE");
      expect(operator.objectLiteralParameters).toEqual({});
    },
  );

  it("does not reference the column at all when there is nothing to match", () => {
    const operator: RawOperator = searchAllWords(["", " "]);
    const sql: string = operator.getSql(ALIAS);

    expect(sql).not.toContain(ALIAS);
    expect(sql.toUpperCase()).not.toContain("ILIKE");
    expect(placeholdersIn(sql)).toEqual([]);
  });

  it("matches no row, not every row", () => {
    const operator: RawOperator = searchAllWords([]);

    expect(rowMatches(operator, "Unit 104822 - Michigan Ave")).toBe(false);
    expect(rowMatches(operator, "")).toBe(false);
  });
});

describe("QueryHelper.searchAllWords - which names come back", () => {
  /*
   * The customer-facing contract of issue #3981, evaluated against the
   * rendered SQL with the ILIKE model above: every word must appear, in any
   * order, case-insensitively, as a literal substring.
   */

  const SITE: string = "Unit 104822 - Michigan Ave";

  it("finds a site from words typed in a different order than the name", () => {
    expect(rowMatches(searchAllWords(["michigan", "104822"]), SITE)).toBe(true);
    expect(rowMatches(searchAllWords(["104822", "michigan"]), SITE)).toBe(true);
    expect(rowMatches(searchAllWords(["ave", "unit"]), SITE)).toBe(true);
  });

  it("matches case-insensitively even though the pattern keeps its case", () => {
    expect(rowMatches(searchAllWords(["MICHIGAN", "Unit"]), SITE)).toBe(true);
  });

  it("matches partial words", () => {
    expect(rowMatches(searchAllWords(["mich", "0482"]), SITE)).toBe(true);
  });

  it("requires every word: one miss excludes the site", () => {
    expect(rowMatches(searchAllWords(["michigan", "999999"]), SITE)).toBe(
      false,
    );
    expect(rowMatches(searchAllWords(["chicago"]), SITE)).toBe(false);
  });

  it("treats a typed % literally", () => {
    const operator: RawOperator = searchAllWords(["100%"]);

    expect(rowMatches(operator, "Rack 100% uptime")).toBe(true);
    // As a wildcard, "100%" would also have matched these.
    expect(rowMatches(operator, "Rack 1000")).toBe(false);
    expect(rowMatches(operator, "Rack 100")).toBe(false);
  });

  it("treats a typed _ literally", () => {
    const operator: RawOperator = searchAllWords(["unit_1"]);

    expect(rowMatches(operator, "floor unit_1 east")).toBe(true);
    // As a wildcard, `_` would have matched any one character.
    expect(rowMatches(operator, "floor unitX1 east")).toBe(false);
    expect(rowMatches(operator, "floor unit-1 east")).toBe(false);
  });

  it("treats a typed backslash literally", () => {
    const operator: RawOperator = searchAllWords(["a\\b"]);

    expect(rowMatches(operator, "path a\\b here")).toBe(true);
    expect(rowMatches(operator, "path ab here")).toBe(false);
  });

  it("treats a typed * literally", () => {
    const operator: RawOperator = searchAllWords(["api-*"]);

    expect(rowMatches(operator, "api-*")).toBe(true);
    expect(rowMatches(operator, "api-gateway")).toBe(false);
  });

  it("ignores blank words rather than letting them match everything", () => {
    const operator: RawOperator = searchAllWords(["", "michigan", "  "]);

    expect(rowMatches(operator, SITE)).toBe(true);
    expect(rowMatches(operator, "Unit 5 - Chicago")).toBe(false);
  });
});

describe("QueryHelper.searchAllWords versus QueryHelper.search", () => {
  /*
   * Why the new helper exists. `search` keeps the whole string as ONE
   * substring, so "michigan 104822" only matches a name containing exactly
   * that phrase and misses "Unit 104822 - Michigan Ave". It also passes
   * LIKE metacharacters through, and an empty string becomes `%%`, which
   * matches everything. searchAllWords fixes all three for the site search.
   */

  const SITE: string = "Unit 104822 - Michigan Ave";

  it("search keeps the text as a single substring; searchAllWords splits the predicate per word", () => {
    const single: RawOperator = asRaw(QueryHelper.search("michigan 104822"));
    const perWord: RawOperator = searchAllWords(["michigan", "104822"]);

    expect(paramValues(single)).toEqual(["%michigan 104822%"]);
    expect(countOccurrences(single.getSql(ALIAS).toUpperCase(), "ILIKE")).toBe(
      1,
    );

    expect(paramValues(perWord)).toEqual(["%michigan%", "%104822%"]);
    expect(countOccurrences(perWord.getSql(ALIAS).toUpperCase(), "ILIKE")).toBe(
      2,
    );
  });

  it("only searchAllWords finds the site the customer was looking for", () => {
    const single: RawOperator = asRaw(QueryHelper.search("michigan 104822"));
    const patterns: Array<unknown> = paramValues(single);

    expect(patterns).toHaveLength(1);
    expect(ilike(SITE, patterns[0] as string)).toBe(false);
    expect(rowMatches(searchAllWords(["michigan", "104822"]), SITE)).toBe(true);
  });

  it("search does not escape LIKE metacharacters; searchAllWords does", () => {
    expect(paramValues(asRaw(QueryHelper.search("100%")))).toEqual(["%100%%"]);
    expect(paramValues(searchAllWords(["100%"]))).toEqual(["%100\\%%"]);
  });

  it("search lower-cases; searchAllWords leaves case to ILIKE", () => {
    expect(paramValues(asRaw(QueryHelper.search("Michigan")))).toEqual([
      "%michigan%",
    ]);
    expect(paramValues(searchAllWords(["Michigan"]))).toEqual(["%Michigan%"]);
  });

  it("an empty search matches everything; an empty searchAllWords matches nothing", () => {
    const everything: RawOperator = asRaw(QueryHelper.search(""));

    expect(paramValues(everything)).toEqual(["%%"]);
    expect(ilike(SITE, "%%")).toBe(true);

    expect(searchAllWords([]).getSql(ALIAS)).toBe("TRUE = FALSE");
    expect(rowMatches(searchAllWords([]), SITE)).toBe(false);
  });
});
