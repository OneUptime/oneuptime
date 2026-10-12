import { describe, expect, test } from "@jest/globals";
import GreaterThan from "../../../Types/BaseDatabase/GreaterThan";
import GreaterThanOrEqual from "../../../Types/BaseDatabase/GreaterThanOrEqual";
import Includes from "../../../Types/BaseDatabase/Includes";
import IncludesNone from "../../../Types/BaseDatabase/IncludesNone";
import LessThan from "../../../Types/BaseDatabase/LessThan";
import LessThanOrEqual from "../../../Types/BaseDatabase/LessThanOrEqual";
import NotWildcard from "../../../Types/BaseDatabase/NotWildcard";
import Wildcard from "../../../Types/BaseDatabase/Wildcard";
import {
  escapeWildcards,
  toLikePattern,
} from "../../../Types/BaseDatabase/WildcardPattern";
import { JSONObject } from "../../../Types/JSON";
import queryStringToFilter, {
  LogFilter,
} from "../../../Types/Log/LogQueryToFilter";
import {
  SearchToken,
  SearchTokenComparisonOperator,
  SearchValueOperator,
  buildSearchTokenComparison,
  buildSearchTokenGlob,
  buildSearchTokenValue,
  compileAttributeChipValues,
  parseSearchQuery,
  queryValueToChipValues,
  searchTokenListEntry,
} from "../../../Types/Telemetry/TelemetrySearchQuery";
import { buildSearchTokenForOperatorValue } from "../../../Utils/Telemetry/LockedFilterSearch";
import { generatedTexts } from "../../Helpers/GeneratedTexts";

/*
 * A LOCKED FILTER'S LISTS AND COMPARISONS, COPIED INTO THE LOGS EXPLORER.
 *
 * "Is any of", "is none of" and several "matches" globs are written as a
 * list, "(a OR b)". Inside it the tokenizer is one bracket deep, so an entry
 * that closed a bracket it never opened - "a)", or "(a)", whose opening
 * bracket the grammar escapes - closed the list there: the rest of the list
 * was read as free text, and the filter matched other rows. Such an entry is
 * now quoted (searchTokenListEntry); every other entry is written as before.
 *
 * "Greater than" and the other comparisons read their value as written,
 * with no escape undone, but the value was escaped like any other: -5 was
 * written "\-5" and compared as that text, and "=5" after ">" read as ">=".
 * A comparison is now written as the grammar reads it
 * (buildSearchTokenComparison), and exactly as before wherever the old
 * spelling read back right.
 *
 * Each case is pasted with another filter after it and compiled by the logs
 * explorer: the list or comparison means what the filter meant, and the
 * filter after it still applies.
 */

const KEY: string = "k8s.ns";
const AFTER: string = "severity:error";
// The value grammar's numbers, which a compiled query holds as numbers.
const NUMERIC: RegExp = /^-?\d+(\.\d+)?$/;

// A stored comparison, as a locked filter holds one.
type Comparison =
  | GreaterThan<number | string>
  | GreaterThanOrEqual<number | string>
  | LessThan<number | string>
  | LessThanOrEqual<number | string>;

const COMPARISONS: Array<[SearchTokenComparisonOperator, SearchValueOperator]> =
  [
    [">", SearchValueOperator.GreaterThan],
    [">=", SearchValueOperator.GreaterThanOrEqual],
    ["<", SearchValueOperator.LessThan],
    ["<=", SearchValueOperator.LessThanOrEqual],
  ];

function pasted(token: string): LogFilter {
  return queryStringToFilter(`${token} ${AFTER}`);
}

// The class the logs explorer compiled for KEY, and its wire value.
function compiledFor(filter: LogFilter): [string, unknown] {
  const compiled: unknown = filter.attributes?.[KEY];

  if (compiled === undefined || compiled === null) {
    return ["nothing", undefined];
  }

  if (typeof compiled === "string") {
    return ["String", compiled];
  }

  return [
    (compiled as { constructor: { name: string } }).constructor.name,
    (compiled as { toJSON: () => JSONObject }).toJSON()["value"],
  ];
}

/*
 * What each entry of a compiled list matches, as LIKE patterns: a glob list
 * compiles its globs, a value list its literal values.
 */
function listPatterns(filter: LogFilter): Array<string> {
  const [compiledClass, value] = compiledFor(filter);
  const globs: boolean =
    compiledClass === "Wildcard" || compiledClass === "NotWildcard";

  if (!Array.isArray(value)) {
    return [];
  }

  return (value as Array<unknown>).map((entry: unknown): string => {
    return toLikePattern(
      globs ? String(entry) : escapeWildcards(String(entry)),
    );
  });
}

// The tokens a search string parses into, and the first one's reading.
function readBack(search: string): [number, string, string] {
  const tokens: Array<SearchToken> = parseSearchQuery(search);

  return [
    tokens.length,
    tokens[0]?.predicate.operator || "",
    tokens[0]?.predicate.value ?? "",
  ];
}

describe("searchTokenListEntry", () => {
  test.each([
    ["a closing bracket", "a)", '"a)"'],
    ["a closing square bracket", "x]", '"x]"'],
    [
      "a value wrapped in brackets, its opening one escaped",
      "\\(a)",
      '"\\(a)"',
    ],
    ["a bracket opened and closed, then one closed", "(a))", '"(a))"'],
    ["a pair it opens and closes", "f(x)", "f(x)"],
    ["an escaped closing bracket", "a\\)", "a\\)"],
    ["no bracket", "payments", "payments"],
    ["a quoted token", '"a b)"', '"a b)"'],
  ])("%s", (_name: string, token: string, entry: string) => {
    expect(searchTokenListEntry(token)).toBe(entry);
  });

  test("a token with no closing bracket is placed as it is", () => {
    const literals: Array<string> = generatedTexts(
      5000,
      4242,
      ["a", " ", "(", "[", "\\", '"', "*", "-", ":", "~"],
      9,
    );

    for (const literal of literals) {
      const token: string = buildSearchTokenValue(literal);

      expect([literal, searchTokenListEntry(token)]).toEqual([literal, token]);
    }
  });

  test("every generated value, as a list entry, stays one entry of its list", () => {
    const literals: Array<string> = generatedTexts(
      8000,
      9191,
      ["a", " ", "(", ")", "[", "]", "\\", '"', "*", "?", "-", ":", "~"],
      9,
    ).filter((literal: string): boolean => {
      return literal.trim().length > 0;
    });

    for (const literal of literals) {
      const entry: string = searchTokenListEntry(
        buildSearchTokenValue(literal),
      );
      const tokens: Array<SearchToken> = parseSearchQuery(
        `@${KEY}:(${entry} OR b) ${AFTER}`,
      );

      expect([literal, tokens.length]).toEqual([literal, 2]);
      expect([
        literal,
        tokens[0]!.predicate.operator,
        tokens[0]!.predicate.values,
      ]).toEqual([literal, SearchValueOperator.In, [literal, "b"]]);
    }
  });
});

describe("buildSearchTokenComparison", () => {
  test.each([
    ["a whole number", ">", "500", ">500"],
    ["a negative number", ">", "-5", ">-5"],
    ["a negative decimal", "<=", "-0.25", "<=-0.25"],
    ["a date", ">=", "2026-10-12T00:00:00.000Z", ">=2026-10-12T00:00:00.000Z"],
    ["a star", "<", "a*", "<a*"],
    ["a bracket pair", ">", "(1)", ">(1)"],
    ["a closing bracket", ">", "x)", ">x)"],
    ["a bracket left open", ">", "f(x", '>"f(x"'],
    ["a space", "<", "a b", '<"a b"'],
    ["a colon at the end", ">=", "a:", '>="a:"'],
    ["a leading equals sign after >", ">", "=5", '>"=5"'],
    ["a leading equals sign after <", "<", "=5", '<"=5"'],
    ["a leading equals sign after >=", ">=", "=5", ">==5"],
    ["a leading equals sign after <=", "<=", "=5", "<==5"],
  ] as Array<[string, SearchTokenComparisonOperator, string, string]>)(
    "%s",
    (
      _name: string,
      operator: SearchTokenComparisonOperator,
      literal: string,
      written: string,
    ) => {
      expect(buildSearchTokenComparison(operator, literal)).toBe(written);
    },
  );

  test("a quote, a backslash or nothing cannot be written", () => {
    for (const [operator] of COMPARISONS) {
      expect(buildSearchTokenComparison(operator, 'a"b')).toBeNull();
      expect(buildSearchTokenComparison(operator, "a\\b")).toBeNull();
      expect(buildSearchTokenComparison(operator, "")).toBeNull();
    }
  });

  test("every generated literal is read back exactly by each comparison, with a filter after it", () => {
    const literals: Array<string> = generatedTexts(
      6000,
      7171,
      ["5", "-", ".", "=", ":", "a", " ", "(", ")", "[", "]", "*", "~", "!"],
      8,
    ).filter((literal: string): boolean => {
      return literal.length > 0;
    });

    for (const literal of literals) {
      for (const [operator, meaning] of COMPARISONS) {
        const comparison: string | null = buildSearchTokenComparison(
          operator,
          literal,
        );

        expect([literal, operator, comparison === null]).toEqual([
          literal,
          operator,
          false,
        ]);
        expect([
          literal,
          operator,
          readBack(`@${KEY}:${comparison as string} ${AFTER}`),
        ]).toEqual([literal, operator, [2, meaning, literal]]);
      }
    }
  });

  test("a comparison the old escaped spelling read back right is written exactly as before", () => {
    const literals: Array<string> = generatedTexts(
      6000,
      7272,
      ["5", "-", ".", "=", ":", "a", " ", "(", ")", "*", "~"],
      8,
    ).filter((literal: string): boolean => {
      return literal.length > 0;
    });
    let kept: number = 0;

    for (const literal of literals) {
      for (const [operator, meaning] of COMPARISONS) {
        const old: string = `${operator}${buildSearchTokenValue(literal)}`;
        const oldReading: [number, string, string] = readBack(
          `@${KEY}:${old} ${AFTER}`,
        );

        if (
          oldReading[0] === 2 &&
          oldReading[1] === meaning &&
          oldReading[2] === literal
        ) {
          expect([
            literal,
            buildSearchTokenComparison(operator, literal),
          ]).toEqual([literal, old]);
          kept++;
        }
      }
    }

    // Most literals - plain numbers among them - read back right before.
    expect(kept).toBeGreaterThan(4000);
  });
});

describe("a locked filter's list, pasted with another filter after it", () => {
  test.each([
    ["a value wrapped in brackets", ["(a)", "b"]],
    ["a closing bracket", ["a)", "b"]],
    ["a closing square bracket last", ["b", "x]"]],
    ["a value wrapped in square brackets", ["[x]", "y"]],
    ["two of them", ["(a)", "b)", "c"]],
  ])(
    "is any of, %s, keeps every entry",
    (_name: string, entries: Array<string>) => {
      const token: string | null = buildSearchTokenForOperatorValue(
        KEY,
        new Includes(entries),
      );
      const filter: LogFilter = pasted(token as string);

      expect(filter.severityText).toBe("Error");
      expect(compiledFor(filter)).toEqual(["Includes", entries]);
    },
  );

  test("is none of, with a value wrapped in brackets, keeps every entry", () => {
    const token: string | null = buildSearchTokenForOperatorValue(
      KEY,
      new IncludesNone(["(a)", "b"]),
    );

    expect(token).toBe('-@k8s.ns:("\\(a)" OR b)');

    const filter: LogFilter = pasted(token as string);

    expect(filter.severityText).toBe("Error");
    expect(compiledFor(filter)).toEqual(["IncludesNone", ["(a)", "b"]]);
  });

  test("several globs with a closing bracket keep every glob", () => {
    for (const [value, compiledClass] of [
      [new Wildcard(["a)*", "(b)*"]), "Wildcard"],
      [new NotWildcard(["(x)", "y*"]), "NotWildcard"],
    ] as Array<[Wildcard<string> | NotWildcard<string>, string]>) {
      const globs: Array<string> = value.values as Array<string>;
      const filter: LogFilter = pasted(
        buildSearchTokenForOperatorValue(KEY, value) as string,
      );

      expect([compiledClass, filter.severityText]).toEqual([
        compiledClass,
        "Error",
      ]);
      expect([compiledClass, compiledFor(filter)[0]]).toEqual([
        compiledClass,
        compiledClass,
      ]);
      expect([compiledClass, listPatterns(filter)]).toEqual([
        compiledClass,
        globs.map((glob: string): string => {
          return toLikePattern(glob);
        }),
      ]);
    }
  });

  test("a list whose entries close nothing is spelled exactly as before", () => {
    expect(
      buildSearchTokenForOperatorValue(
        KEY,
        new Includes(["payments", "checkout"]),
      ),
    ).toBe("@k8s.ns:(payments OR checkout)");
    expect(
      buildSearchTokenForOperatorValue(KEY, new Includes(["a b", "c"])),
    ).toBe('@k8s.ns:("a b" OR c)');
    expect(
      buildSearchTokenForOperatorValue(KEY, new Includes(["f(x)", "g"])),
    ).toBe("@k8s.ns:(f(x) OR g)");
    expect(
      buildSearchTokenForOperatorValue(KEY, new IncludesNone(["x", "y"])),
    ).toBe("-@k8s.ns:(x OR y)");
    expect(
      buildSearchTokenForOperatorValue(KEY, new Wildcard(["api-*", "web-?"])),
    ).toBe("@k8s.ns:(api-* OR web-?)");
  });

  test("every generated list of values keeps its entries, positive and negated, and changes only where an entry closed a bracket", () => {
    const literals: Array<string> = generatedTexts(
      6000,
      5150,
      [
        "a",
        "b",
        " ",
        "(",
        ")",
        "[",
        "]",
        "\\",
        '"',
        "*",
        "?",
        "-",
        ":",
        "~",
        "!",
      ],
      7,
    ).filter((literal: string): boolean => {
      return literal.trim().length > 0;
    });
    let changed: number = 0;

    for (let index: number = 0; index + 1 < literals.length; index += 2) {
      const entries: Array<string> = [literals[index]!, literals[index + 1]!];

      for (const [value, compiledClass] of [
        [new Includes(entries), "Includes"],
        [new IncludesNone(entries), "IncludesNone"],
      ] as Array<[Includes | IncludesNone, string]>) {
        const token: string | null = buildSearchTokenForOperatorValue(
          KEY,
          value,
        );

        expect([entries, token === null]).toEqual([entries, false]);

        const filter: LogFilter = pasted(token as string);

        expect([entries, filter.severityText]).toEqual([entries, "Error"]);
        expect([entries, compiledFor(filter)]).toEqual([
          entries,
          [compiledClass, entries],
        ]);

        // The list as it was spelled before this change.
        const old: string = `(${entries
          .map((entry: string): string => {
            return buildSearchTokenValue(entry);
          })
          .join(" OR ")})`;

        if (!(token as string).endsWith(old)) {
          changed++;
          expect([
            entries,
            entries.some((entry: string): boolean => {
              const written: string = buildSearchTokenValue(entry);
              return searchTokenListEntry(written) !== written;
            }),
          ]).toEqual([entries, true]);
        }
      }
    }

    expect(changed).toBeGreaterThan(0);
  });

  test("every generated list of globs keeps its globs, positive and negated", () => {
    const globs: Array<string> = generatedTexts(
      6000,
      6161,
      ["a", " ", "(", ")", "]", "\\", "\\*", '\\"', '"', "*", "?", "-", ":"],
      7,
    )
      .map((glob: string): string => {
        return glob.trim();
      })
      .filter((glob: string): boolean => {
        return glob.length > 0;
      });

    for (let index: number = 0; index + 1 < globs.length; index += 2) {
      const pair: Array<string> = [globs[index]!, globs[index + 1]!];

      for (const value of [new Wildcard(pair), new NotWildcard(pair)]) {
        const token: string | null = buildSearchTokenForOperatorValue(
          KEY,
          value,
        );

        expect([pair, token === null]).toEqual([pair, false]);

        const filter: LogFilter = pasted(token as string);

        expect([pair, filter.severityText]).toEqual([pair, "Error"]);
        expect([pair, listPatterns(filter)]).toEqual([
          pair,
          pair.map((glob: string): string => {
            return toLikePattern(glob);
          }),
        ]);
      }
    }
  });

  test("a glob list entry is the token the glob gets alone, placed with searchTokenListEntry", () => {
    for (const glob of ["a)*", "(x)", "b*", "x]?"]) {
      expect(
        buildSearchTokenForOperatorValue(KEY, new Wildcard([glob, "z*"])),
      ).toBe(
        `@${KEY}:(${searchTokenListEntry(buildSearchTokenGlob(glob))} OR z*)`,
      );
    }
  });
});

describe("a locked filter's comparison, pasted with another filter after it", () => {
  test.each([
    [
      "greater than a negative number",
      new GreaterThan(-5),
      "@k8s.ns:>-5",
      "GreaterThan",
      -5,
    ],
    [
      "greater than or equal to a negative number",
      new GreaterThanOrEqual(-10),
      "@k8s.ns:>=-10",
      "GreaterThanOrEqual",
      -10,
    ],
    [
      "less than a negative decimal",
      new LessThan(-0.5),
      "@k8s.ns:<-0.5",
      "LessThan",
      -0.5,
    ],
    [
      "less than or equal to a negative decimal",
      new LessThanOrEqual(-2.25),
      "@k8s.ns:<=-2.25",
      "LessThanOrEqual",
      -2.25,
    ],
    [
      "greater than a text starting with an equals sign",
      new GreaterThan("=5"),
      '@k8s.ns:>"=5"',
      "GreaterThan",
      "=5",
    ],
    [
      "less than a text with a space",
      new LessThan("a b"),
      '@k8s.ns:<"a b"',
      "LessThan",
      "a b",
    ],
    [
      "greater than a text that leaves a bracket open",
      new GreaterThan("f(x"),
      '@k8s.ns:>"f(x"',
      "GreaterThan",
      "f(x",
    ],
    [
      "less than a text with a star",
      new LessThan("a*"),
      "@k8s.ns:<a*",
      "LessThan",
      "a*",
    ],
  ])(
    "%s",
    (
      _name: string,
      value: Comparison,
      token: string,
      compiledClass: string,
      compiled: number | string,
    ) => {
      expect(buildSearchTokenForOperatorValue(KEY, value)).toBe(token);

      const filter: LogFilter = pasted(token);

      expect(filter.severityText).toBe("Error");
      expect(compiledFor(filter)).toEqual([compiledClass, compiled]);
    },
  );

  test("a comparison with a quote or a backslash in its value has no token", () => {
    expect(
      buildSearchTokenForOperatorValue(KEY, new GreaterThan('a"b')),
    ).toBeNull();
    expect(
      buildSearchTokenForOperatorValue(KEY, new LessThanOrEqual("C:\\")),
    ).toBeNull();
  });

  test("every generated number is compared as itself, and positive ones are spelled as before", () => {
    const digits: Array<string> = generatedTexts(
      3000,
      8080,
      ["0", "1", "5", "9"],
      6,
    ).filter((text: string): boolean => {
      return text.length > 0;
    });

    for (const [index, text] of digits.entries()) {
      const sign: number = index % 2 === 0 ? 1 : -1;
      const divisor: number = index % 3 === 0 ? 4 : 1;
      // "|| 0" reads -0 as 0, which is how a threshold of 0 is written.
      const number: number = (sign * Number(text)) / divisor || 0;

      for (const [value, compiledClass, operator] of [
        [new GreaterThan(number), "GreaterThan", ">"],
        [new GreaterThanOrEqual(number), "GreaterThanOrEqual", ">="],
        [new LessThan(number), "LessThan", "<"],
        [new LessThanOrEqual(number), "LessThanOrEqual", "<="],
      ] as Array<[Comparison, string, string]>) {
        const token: string | null = buildSearchTokenForOperatorValue(
          KEY,
          value,
        );

        expect([number, token]).toEqual([
          number,
          `@${KEY}:${operator}${String(number)}`,
        ]);

        if (number >= 0) {
          expect([number, token]).toEqual([
            number,
            `@${KEY}:${operator}${buildSearchTokenValue(String(number))}`,
          ]);
        }

        const filter: LogFilter = pasted(token as string);

        expect([number, filter.severityText]).toEqual([number, "Error"]);
        expect([number, compiledFor(filter)]).toEqual([
          number,
          [compiledClass, number],
        ]);
      }
    }
  });
});

describe("a saved view's comparison, read back as a chip", () => {
  // What a compiled chip is, as its class and wire value.
  function chipMeaning(chips: Array<string>): [string, unknown] {
    const compiled: unknown = compileAttributeChipValues(chips);

    return [
      (compiled as { constructor: { name: string } }).constructor.name,
      (compiled as { toJSON: () => JSONObject }).toJSON()["value"],
    ];
  }

  test.each([
    ["a whole number", new GreaterThan(10), [">10"], ["GreaterThan", 10]],
    [
      "a negative decimal",
      new LessThanOrEqual(-2.5),
      ["<=-2.5"],
      ["LessThanOrEqual", -2.5],
    ],
    [
      "a text starting with an equals sign",
      new GreaterThan("=5"),
      ['>"=5"'],
      ["GreaterThan", "=5"],
    ],
    [
      "a text with a space",
      new LessThan("a b"),
      ['<"a b"'],
      ["LessThan", "a b"],
    ],
    [
      "a text with a quote, written as it always was",
      new GreaterThanOrEqual('a"b'),
      ['>=a"b'],
      ["GreaterThanOrEqual", 'a"b'],
    ],
  ] as Array<[string, Comparison, Array<string>, [string, unknown]]>)(
    "%s",
    (
      _name: string,
      value: Comparison,
      chips: Array<string>,
      meaning: [string, unknown],
    ) => {
      expect(queryValueToChipValues(value)).toEqual(chips);
      expect(chipMeaning(chips)).toEqual(meaning);
    },
  );

  test("every generated comparison comes back as a chip that means it", () => {
    const literals: Array<string> = generatedTexts(
      4000,
      9393,
      ["5", "-", ".", "=", ":", "a", " ", "(", ")", "*", "~", "!"],
      8,
    ).filter((literal: string): boolean => {
      return literal.trim().length > 0;
    });

    for (const literal of literals) {
      // The chip's value as the compiled query holds it: numbers as numbers.
      const expected: number | string = NUMERIC.test(literal.trim())
        ? Number(literal.trim())
        : literal;

      for (const [value, compiledClass] of [
        [new GreaterThan(literal), "GreaterThan"],
        [new GreaterThanOrEqual(literal), "GreaterThanOrEqual"],
        [new LessThan(literal), "LessThan"],
        [new LessThanOrEqual(literal), "LessThanOrEqual"],
      ] as Array<[Comparison, string]>) {
        const chips: Array<string> = queryValueToChipValues(value);

        expect([literal, compiledClass, chipMeaning(chips)]).toEqual([
          literal,
          compiledClass,
          [compiledClass, expected],
        ]);
      }
    }
  });
});
