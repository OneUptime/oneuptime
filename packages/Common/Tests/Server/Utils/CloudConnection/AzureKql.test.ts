import { describe, expect, test } from "@jest/globals";
import {
  KqlText,
  isKqlText,
  kql,
  kqlLines,
  kqlStringLiteral,
} from "../../../../Server/Utils/CloudConnection/Azure/AzureKql";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { generatedTexts } from "../../../Helpers/GeneratedTexts";
import {
  kqlSyntaxProblems,
  kustoLiteralValue,
  kustoSingleQuotedLiteral,
  operatorsOf,
  resourceGraphProblems,
  shapeOf,
  stringLiteralValuesOf,
} from "./AzureKqlGrammar";

/*
 * THE KQL TAG (#11142): every value placed into a query an Azure connection
 * sends is a literal of its own, whatever it holds.
 *
 * Each literal is read back by Microsoft's own decoder (Kusto.Language's
 * KustoFacts.GetStringLiteralValue) and parsed in a whole query by
 * Microsoft's parser, so "escaped" here means what Kusto reads, not what
 * this module thinks it wrote. The live read's quoting before this wrote a
 * quote and a backslash with a backslash and left a line break as it was,
 * which ends a KQL literal: a resource ID or a log filter holding one made
 * a query Azure refuses.
 */

// [the text, the literal written for it]
const LITERALS: Array<[string, string]> = [
  ["", "''"],
  ["plain", "'plain'"],
  ["it's", "'it\\'s'"],
  ['say "hi"', "'say \"hi\"'"],
  ["C:\\dir\\file", "'C:\\\\dir\\\\file'"],
  ["\\'", "'\\\\\\''"],
  ["trailing\\", "'trailing\\\\'"],
  ["a\nb", "'a\\nb'"],
  ["a\r\nb", "'a\\r\\nb'"],
  ["a\tb", "'a\\tb'"],
  ["nul\u0000", "'nul\\u0000'"],
  [
    "\u0007\u0008\u000b\u000c\u001b\u001f",
    "'\\u0007\\u0008\\u000b\\u000c\\u001b\\u001f'",
  ],
  ["\u007f\u0080\u0085\u009f", "'\\u007f\\u0080\\u0085\\u009f'"],
  ["\u2028\u2029", "'\\u2028\\u2029'"],
  // A whole surrogate pair is one character; half of one is escaped.
  ["🚀", "'🚀'"],
  ["\ud83d", "'\\ud83d'"],
  ["\ude80x", "'\\ude80x'"],
  ["\ude80\ud83d", "'\\ude80\\ud83d'"],
  ["ünïcødé 中文 ✓", "'ünïcødé 中文 ✓'"],
  ["a | take 1 // c; d", "'a | take 1 // c; d'"],
  ["```", "'```'"],
  ["@'verbatim'", "'@\\'verbatim\\''"],
  ["h'hidden'", "'h\\'hidden\\''"],
  ["\u00a0non-breaking", "'\u00a0non-breaking'"],
];

/*
 * Pieces the sweeps draw texts from: everything that ends, breaks or
 * changes a literal - quotes, backslashes, escapes' letters, line breaks,
 * control characters, separators, halves of a surrogate pair - and
 * what a query is made of.
 */
const AWKWARD_ALPHABET: ReadonlyArray<string> = [
  "'",
  '"',
  "\\",
  "\n",
  "\r",
  "\t",
  "\u0000",
  "\u0007",
  "\u0008",
  "\u000c",
  "\u001f",
  "\u007f",
  "\u0085",
  "\u2028",
  "\u2029",
  "\ud83d",
  "\ude80",
  "🚀",
  "a",
  "Z",
  "0",
  "n",
  "u",
  "x",
  " ",
  "|",
  "/",
  ";",
  "`",
  "@",
  "h",
  "(",
  ")",
  "[",
  "]",
  "{",
  "}",
  "=~",
  "ü",
  "中",
];

// Pieces whose literal Microsoft's own encoder writes the same way: no control character but \n, \r and \t.
const PRINTABLE_ALPHABET: ReadonlyArray<string> = [
  "'",
  '"',
  "\\",
  "\n",
  "\r",
  "\t",
  "🚀",
  "a",
  "Z",
  "0",
  " ",
  "|",
  "/",
  "`",
  "@",
  "ü",
  "中",
];

function placedInAQuery(value: string): string {
  return kql`Resources | where id =~ ${value} | project id`.toString();
}

describe("a string literal", () => {
  test.each(LITERALS)(
    "%j is written %s, which Microsoft's decoder reads back as it was",
    (text: string, literal: string) => {
      expect(kqlStringLiteral(text)).toBe(literal);
      expect(kustoLiteralValue(literal)).toBe(text);
    },
  );

  test.each(LITERALS)(
    "%j, placed in a Resource Graph query, is one literal of a query Resource Graph runs",
    (text: string) => {
      const query: string = placedInAQuery(text);

      expect(resourceGraphProblems(query)).toEqual([]);
      expect(stringLiteralValuesOf(query)).toEqual([text]);
      expect(shapeOf(query)).toBe(shapeOf(placedInAQuery("plain")));
    },
  );

  test("is one line, whatever the text holds", () => {
    for (const [text] of LITERALS) {
      expect(kqlStringLiteral(text)).not.toMatch(/[\n\r\u2028\u2029]/);
    }
  });

  test("a text of every awkward kind is read back as it was by Microsoft's decoder (3,000 texts)", () => {
    const texts: Array<string> = generatedTexts(3000, 11142, AWKWARD_ALPHABET);

    // Only the shortest repeat: there are only so many texts of no piece or one.
    expect(new Set(texts).size).toBeGreaterThan(2700);

    for (const text of texts) {
      const literal: string = kqlStringLiteral(text);

      expect({ text, read: kustoLiteralValue(literal) }).toEqual({
        text,
        read: text,
      });
    }
  });

  test("a text of every awkward kind keeps a query's shape and parses (600 queries)", () => {
    const plainShape: string = shapeOf(placedInAQuery("plain"));

    for (const text of generatedTexts(600, 9375, AWKWARD_ALPHABET)) {
      const query: string = placedInAQuery(text);

      expect({ text, problems: kqlSyntaxProblems(query) }).toEqual({
        text,
        problems: [],
      });
      expect({ text, values: stringLiteralValuesOf(query) }).toEqual({
        text,
        values: [text],
      });
      expect({ text, shape: shapeOf(query) }).toEqual({
        text,
        shape: plainShape,
      });
    }
  });

  test("is the very literal Microsoft's own encoder writes, for a text of no control character but a line break, a return or a tab", () => {
    for (const text of generatedTexts(2000, 2718, PRINTABLE_ALPHABET)) {
      expect({ text, literal: kqlStringLiteral(text) }).toEqual({
        text,
        literal: kustoSingleQuotedLiteral(text),
      });
    }
  });

  test("reads back as Microsoft's own encoder's does, for every text", () => {
    for (const text of generatedTexts(2000, 31415, AWKWARD_ALPHABET)) {
      expect({
        text,
        read: kustoLiteralValue(kqlStringLiteral(text)),
      }).toEqual({
        text,
        read: kustoLiteralValue(kustoSingleQuotedLiteral(text)),
      });
    }
  });

  test("only text is a literal", () => {
    expect(() => {
      return kqlStringLiteral(7 as never);
    }).toThrow(BadDataException);
  });
});

const WHOLE_NUMBERS: Array<[number, string]> = [
  [0, "0"],
  [1, "1"],
  [2000, "2000"],
  [Number.MAX_SAFE_INTEGER, "9007199254740991"],
];

const NOT_WHOLE_NUMBERS: Array<number> = [
  -1,
  1.5,
  0.1,
  NaN,
  Infinity,
  -Infinity,
  Number.MAX_SAFE_INTEGER + 1,
];

const NOT_VALUES: Array<[string, unknown]> = [
  ["null", null],
  ["undefined", undefined],
  ["boolean", true],
  [
    "object",
    {
      toString: (): string => {
        return "Resources";
      },
    },
  ],
  ["bigint", BigInt(3)],
];

describe("a whole number", () => {
  test.each(WHOLE_NUMBERS)(
    "%d is its digits",
    (value: number, digits: string) => {
      expect(kql`T | take ${value}`.toString()).toBe(`T | take ${digits}`);
    },
  );

  test("negative zero is 0", () => {
    expect(kql`T | take ${-0}`.toString()).toBe("T | take 0");
  });

  test.each(NOT_WHOLE_NUMBERS)(
    "%d is refused: a row limit or a count of minutes is a whole number",
    (value: number) => {
      expect(() => {
        return kql`T | take ${value}`;
      }).toThrow(BadDataException);
      expect(() => {
        return kql`T | take ${value}`;
      }).toThrow("A KQL query takes a whole number of zero or more here");
    },
  );
});

describe("a list of texts", () => {
  test("is the literal of each, a comma between, for in~ (...)", () => {
    const query: KqlText = kql`Resources | where type in~ (${[
      "microsoft.network/virtualnetworks",
      "it's",
      "a\nb",
    ]}) | project id`;

    expect(query.toString()).toBe(
      "Resources | where type in~ ('microsoft.network/virtualnetworks', 'it\\'s', 'a\\nb') | project id",
    );
    expect(resourceGraphProblems(query.toString())).toEqual([]);
    expect(stringLiteralValuesOf(query.toString())).toEqual([
      "microsoft.network/virtualnetworks",
      "it's",
      "a\nb",
    ]);
  });

  test("of one text is that literal alone", () => {
    expect(kql`(${["only"]})`.toString()).toBe("('only')");
  });

  test("of no text is refused: in~ () is no query", () => {
    expect(() => {
      return kql`Resources | where type in~ (${[]})`;
    }).toThrow("A KQL list holds one value or more");
  });

  test("of anything but text is refused", () => {
    expect(() => {
      return kql`(${[1, 2] as never})`;
    }).toThrow("A KQL list is a list of text, not of number.");
  });
});

describe("the kql tag", () => {
  test("keeps the template's own text as it is written", () => {
    expect(
      kql`Resources | where type =~ 'microsoft.web/sites'`.toString(),
    ).toBe("Resources | where type =~ 'microsoft.web/sites'");
    expect(kql``.toString()).toBe("");
  });

  test("places a piece written with the tag as it is, and every string as a literal", () => {
    const source: KqlText = kql`search ${"x"}`;

    expect(kql`${source} | take ${5}`.toString()).toBe("search 'x' | take 5");
    expect(kql`${"Resources"} | take 1`.toString()).toBe(
      "'Resources' | take 1",
    );
  });

  test("a string that is KQL is still one literal: it never becomes query text", () => {
    const query: string =
      kql`Resources | where name =~ ${"x' | project secrets = properties //"} | project id`.toString();

    expect(operatorsOf(query)).toEqual(["where", "project"]);
    expect(stringLiteralValuesOf(query)).toEqual([
      "x' | project secrets = properties //",
    ]);
  });

  test.each(NOT_VALUES)(
    "refuses a value of type %s",
    (_kind: string, value: unknown) => {
      expect(() => {
        return kql`T | where x == ${value as never}`;
      }).toThrow(BadDataException);
    },
  );

  test("is the only way to make a KqlText", () => {
    expect(() => {
      return new KqlText(Symbol("not the key") as never, "Resources");
    }).toThrow("A KqlText is made with the kql tag or kqlLines.");
  });

  test("a KqlText is recognised by its mark, a look-alike is not", () => {
    expect(isKqlText(kql`Resources`)).toBe(true);
    expect(isKqlText("Resources")).toBe(false);
    expect(isKqlText(NOT_VALUES[3]![1])).toBe(false);
    expect(isKqlText(null)).toBe(false);
  });

  test("a KqlText is its text wherever it is written out", () => {
    const query: KqlText = kql`Resources | take ${3}`;

    expect(String(query)).toBe("Resources | take 3");
    expect(`${query}`).toBe("Resources | take 3");
    expect(JSON.stringify({ query: query.toString() })).toBe(
      '{"query":"Resources | take 3"}',
    );
  });
});

describe("the lines of a query", () => {
  test("are joined one after another", () => {
    expect(
      kqlLines([
        kql`Resources`,
        kql`| where type =~ ${"microsoft.web/sites"}`,
        kql`| project id`,
      ]).toString(),
    ).toBe("Resources\n| where type =~ 'microsoft.web/sites'\n| project id");
    expect(kqlLines([]).toString()).toBe("");
  });

  test("are each written with the tag: a string among them is refused", () => {
    expect(() => {
      return kqlLines([kql`Resources`, "| take 1" as never]);
    }).toThrow("A line of a KQL query is written with the kql tag.");
  });
});
