import {
  comparePromQLLabelSets,
  comparePromQLLabelValues,
  comparePromQLText,
  promQLNaturalLess,
  sortPromQLByLabels,
} from "../../../Utils/PromQL/PromQLLabelOrder";
import {
  PromQLLabels,
  formatPromQLLabels,
} from "../../../Utils/PromQL/PromQLLabels";
import {
  SeededRandom,
  seededRandom,
  shuffled,
} from "../../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";

/*
 * The orders sort_by_label() and sort_by_label_desc() sort in (issue #8027):
 * Go's string order, natsort's natural order and Prometheus' labels.Compare,
 * each ported from the code Prometheus 3.16.0 builds with.
 */

// A comparator from natsort's "less", for sorting a list with it.
const naturalComparator: (a: string, b: string) => number = (
  a: string,
  b: string,
): number => {
  if (promQLNaturalLess(a, b)) {
    return -1;
  }

  return promQLNaturalLess(b, a) ? 1 : 0;
};

const sign: (value: number) => number = (value: number): number => {
  // Math.sign(-0) is -0, which toEqual tells apart from 0.
  return value === 0 ? 0 : Math.sign(value);
};

describe("comparePromQLText, Go's string order", () => {
  test.each([
    ["a", "b", -1],
    ["b", "a", 1],
    ["a", "a", 0],
    ["", "", 0],
    ["", "a", -1],
    ["a", "ab", -1],
    ["ab", "a", 1],
    ["B", "a", -1],
    ["Z", "_", -1],
    ["_", "a", -1],
    ["~", "é", -1],
    ["z", "é", -1],
    ["ä", "é", -1],
    // A value past U+FFFF after every value below it, as in UTF-8.
    ["�", "\u{1F600}", -1],
    ["", "\u{10000}", -1],
    ["퟿", "\u{10000}", -1],
    ["\u{1F600}", "\u{1F601}", -1],
    ["\u{1F600}a", "\u{1F600}b", -1],
    ["x\u{1F600}", "x￿", 1],
  ])("%j against %j is %d", (a: string, b: string, expected: number) => {
    expect(comparePromQLText(a, b)).toBe(expected);
    expect(sign(comparePromQLText(b, a))).toBe(sign(-expected));
  });

  test("differs from JavaScript's < where UTF-16 puts U+10000 and above first", () => {
    expect("\u{1F600}" < "�").toBe(true);
    expect(comparePromQLText("\u{1F600}", "�")).toBe(1);
  });

  test("is code point order, which is UTF-8 byte order, for any two texts", () => {
    const random: SeededRandom = seededRandom(8027);
    const alphabet: Array<string> = [
      "a",
      "Z",
      "_",
      "0",
      "é",
      "퟿",
      "",
      "�",
      "￿",
      "\u{10000}",
      "\u{1F600}",
      "\u{10FFFF}",
    ];
    const text: () => string = (): string => {
      let value: string = "";
      const length: number = random(5);

      for (let index: number = 0; index < length; index++) {
        value += alphabet[random(alphabet.length)]!;
      }

      return value;
    };
    const byBytes: (a: string, b: string) => number = (
      a: string,
      b: string,
    ): number => {
      return Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
    };

    for (let round: number = 0; round < 2000; round++) {
      const a: string = text();
      const b: string = text();

      expect({ a, b, order: comparePromQLText(a, b) }).toEqual({
        a,
        b,
        order: byBytes(a, b),
      });
    }
  });
});

describe("promQLNaturalLess, natsort.Compare", () => {
  // natsort's own tests (github.com/facette/natsort, natsort_test.go).
  test("sorts natsort's first list as natsort's tests expect", () => {
    const list: Array<string> = [
      "1000X Radonius Maximus",
      "10X Radonius",
      "200X Radonius",
      "20X Radonius",
      "20X Radonius Prime",
      "30X Radonius",
      "40X Radonius",
      "Allegia 50 Clasteron",
      "Allegia 500 Clasteron",
      "Allegia 50B Clasteron",
      "Allegia 51 Clasteron",
      "Allegia 6R Clasteron",
      "Alpha 100",
      "Alpha 2",
      "Alpha 200",
      "Alpha 2A",
      "Alpha 2A-8000",
      "Alpha 2A-900",
      "Callisto Morphamax",
      "Callisto Morphamax 500",
      "Callisto Morphamax 5000",
      "Callisto Morphamax 600",
      "Callisto Morphamax 6000 SE",
      "Callisto Morphamax 6000 SE2",
      "Callisto Morphamax 700",
      "Callisto Morphamax 7000",
      "Xiph Xlater 10000",
      "Xiph Xlater 2000",
      "Xiph Xlater 300",
      "Xiph Xlater 40",
      "Xiph Xlater 5",
      "Xiph Xlater 50",
      "Xiph Xlater 500",
      "Xiph Xlater 5000",
      "Xiph Xlater 58",
    ];

    expect([...list].sort(naturalComparator)).toEqual([
      "10X Radonius",
      "20X Radonius",
      "20X Radonius Prime",
      "30X Radonius",
      "40X Radonius",
      "200X Radonius",
      "1000X Radonius Maximus",
      "Allegia 6R Clasteron",
      "Allegia 50 Clasteron",
      "Allegia 50B Clasteron",
      "Allegia 51 Clasteron",
      "Allegia 500 Clasteron",
      "Alpha 2",
      "Alpha 2A",
      "Alpha 2A-900",
      "Alpha 2A-8000",
      "Alpha 100",
      "Alpha 200",
      "Callisto Morphamax",
      "Callisto Morphamax 500",
      "Callisto Morphamax 600",
      "Callisto Morphamax 700",
      "Callisto Morphamax 5000",
      "Callisto Morphamax 6000 SE",
      "Callisto Morphamax 6000 SE2",
      "Callisto Morphamax 7000",
      "Xiph Xlater 5",
      "Xiph Xlater 40",
      "Xiph Xlater 50",
      "Xiph Xlater 58",
      "Xiph Xlater 300",
      "Xiph Xlater 500",
      "Xiph Xlater 2000",
      "Xiph Xlater 5000",
      "Xiph Xlater 10000",
    ]);
  });

  test("sorts natsort's second list as natsort's tests expect", () => {
    const sorted: Array<string> = [
      "z1.doc",
      "z2.doc",
      "z3.doc",
      "z4.doc",
      "z5.doc",
      "z6.doc",
      "z7.doc",
      "z8.doc",
      "z9.doc",
      "z10.doc",
      "z11.doc",
      "z12.doc",
      "z13.doc",
      "z14.doc",
      "z15.doc",
      "z16.doc",
      "z17.doc",
      "z18.doc",
      "z19.doc",
      "z20.doc",
      "z100.doc",
      "z101.doc",
      "z102.doc",
    ];

    expect([...sorted].sort().sort(naturalComparator)).toEqual(sorted);
    expect(shuffled(sorted, seededRandom(102)).sort(naturalComparator)).toEqual(
      sorted,
    );
  });

  test.each([
    // Numbers as numbers.
    ["9", "10", true],
    ["10", "9", false],
    ["a9", "a10", true],
    ["1.9", "1.10", true],
    ["v1.2.10", "v1.10.0", true],
    // Text as bytes: upper case, then "_", then lower case.
    ["B", "a", true],
    ["a", "B", false],
    ["Z", "_", true],
    ["_", "a", true],
    ["a b", "a-b", true],
    ["a-b", "a_b", true],
    ["z", "é", true],
    ["�", "\u{1F600}", true],
    // A digit run before anything else (by its byte).
    ["1", "a", true],
    ["a", "1", false],
    // The string that runs out of chunks first comes first.
    ["a", "a1", true],
    ["a1", "a", false],
    ["a", "ab", true],
    ["a100a", "a100b", true],
    ["a100b", "a b", true],
    // Leading zeros: equal numbers, and the shorter string first.
    ["01", "1a", true],
    ["1a", "01", false],
    // Past int64 (9223372036854775807) a run of digits is compared as text.
    ["9223372036854775807", "95", false],
    ["9223372036854775808", "95", true],
    ["10000000000000000000000", "5", true],
    ["5", "10000000000000000000000", false],
    ["5", "99999999999999999999", true],
    ["99999999999999999999", "5", false],
  ])("%j before %j: %s", (a: string, b: string, expected: boolean) => {
    expect(promQLNaturalLess(a, b)).toBe(expected);
  });

  test("answers false both ways round for an empty value", () => {
    for (const value of ["", "a", "1", "B", "\u{1F600}"]) {
      expect(promQLNaturalLess("", value)).toBe(false);
      expect(promQLNaturalLess(value, "")).toBe(false);
    }
  });

  test("answers true both ways round for values that differ in leading zeros only", () => {
    for (const [a, b] of [
      ["01", "1"],
      ["001", "01"],
      ["a01b", "a1b"],
      ["x007", "x7"],
    ] as Array<[string, string]>) {
      expect(promQLNaturalLess(a, b)).toBe(true);
      expect(promQLNaturalLess(b, a)).toBe(true);
    }
  });
});

describe("comparePromQLLabelValues, as sort_by_label() reads two values", () => {
  test("equal values tie", () => {
    expect(comparePromQLLabelValues("a", "a")).toBe(0);
    expect(comparePromQLLabelValues("", "")).toBe(0);
  });

  test("follows natural order wherever natsort answers one way round", () => {
    expect(comparePromQLLabelValues("a9", "a10")).toBe(-1);
    expect(comparePromQLLabelValues("a10", "a9")).toBe(1);
    expect(comparePromQLLabelValues("B", "a")).toBe(-1);
    expect(comparePromQLLabelValues("10000000000000000000000", "5")).toBe(-1);
  });

  test("puts an empty value (a missing label) before every other", () => {
    for (const value of ["a", "0", "B", "_", "\u{1F600}"]) {
      expect(comparePromQLLabelValues("", value)).toBe(-1);
      expect(comparePromQLLabelValues(value, "")).toBe(1);
    }
  });

  test("orders values natsort cannot tell apart by their text", () => {
    expect(comparePromQLLabelValues("01", "1")).toBe(-1);
    expect(comparePromQLLabelValues("1", "01")).toBe(1);
    expect(
      ["1", "01", "2", "001", "1a", "01a"].sort(comparePromQLLabelValues),
    ).toEqual(["001", "01", "1", "01a", "1a", "2"]);
  });

  test("is an order: antisymmetric and transitive over values of every kind", () => {
    const values: Array<string> = [
      "",
      "0",
      "00",
      "1",
      "01",
      "001",
      "1a",
      "01a",
      "2",
      "9",
      "10",
      "a",
      "A",
      "a1",
      "a01",
      "a10",
      "a2",
      "B",
      "_",
      "a b",
      "1.9",
      "1.10",
      "1.09",
      "é",
      "\u{1F600}",
      "�",
    ];

    for (const a of values) {
      for (const b of values) {
        expect({ a, b, order: sign(comparePromQLLabelValues(a, b)) }).toEqual({
          a,
          b,
          order: sign(-comparePromQLLabelValues(b, a)),
        });

        for (const c of values) {
          if (
            comparePromQLLabelValues(a, b) < 0 &&
            comparePromQLLabelValues(b, c) < 0
          ) {
            expect({ a, c, order: comparePromQLLabelValues(a, c) }).toEqual({
              a,
              c,
              order: -1,
            });
          }
        }
      }
    }
  });
});

describe("comparePromQLLabelSets, labels.Compare", () => {
  test.each([
    [{ g: "1" }, { g: "1" }, 0],
    [{ g: "1" }, { g: "2" }, -1],
    // The names first: a before b, whatever their values.
    [{ a: "z", g: "1" }, { b: "a", g: "1" }, -1],
    // A shorter set, equal so far, first.
    [{ g: "1" }, { g: "1", h: "x" }, -1],
    [{ g: "1", h: "x" }, { g: "1" }, 1],
    [{ g: "1", i: "x" }, { g: "1", i: "xy" }, -1],
    // An upper-case name is a smaller byte than "_": A before __name__.
    [{ __name__: "tie", A: "1" }, { __name__: "tie", a: "z" }, -1],
    [{ __name__: "a", z: "1" }, { __name__: "b", a: "1" }, -1],
    [{ v: "�" }, { v: "\u{1F600}" }, -1],
    // A label whose value is empty is a label the set does not have.
    [{ g: "1", h: "" }, { g: "1" }, 0],
    [{ a: "", g: "1" }, { b: "a", g: "1" }, 1],
    [{}, {}, 0],
    [{}, { a: "1" }, -1],
  ] as Array<[PromQLLabels, PromQLLabels, number]>)(
    "%j against %j is %d",
    (a: PromQLLabels, b: PromQLLabels, expected: number) => {
      expect(comparePromQLLabelSets(a, b)).toBe(expected);
      expect(sign(comparePromQLLabelSets(b, a))).toBe(sign(-expected));
    },
  );

  test("reads a label named like an Object member as any other", () => {
    expect(
      comparePromQLLabelSets({ constructor: "a" }, { constructor: "b" }),
    ).toBe(-1);
    expect(comparePromQLLabelSets({ toString: "a" }, {})).toBe(1);
    expect(comparePromQLLabelSets({}, { toString: "a" })).toBe(-1);
  });
});

describe("sortPromQLByLabels", () => {
  const items: Array<{ labels: PromQLLabels }> = [
    { labels: { __name__: "x", g: "1", a: "z" } },
    { labels: { __name__: "x", g: "1", b: "a" } },
    { labels: { __name__: "x", g: "1" } },
    { labels: { __name__: "x", g: "1", h: "x" } },
    { labels: { __name__: "x", g: "10" } },
    { labels: { __name__: "x", g: "9", z: "1" } },
    { labels: { __name__: "x", g: "9", y: "1" } },
    { labels: { __name__: "x" } },
    { labels: { __name__: "x", g: "01" } },
    { labels: { __name__: "x", g: "B" } },
    { labels: { __name__: "x", g: "a" } },
  ];

  const order: (
    list: ReadonlyArray<{ labels: PromQLLabels }>,
    names: Array<string>,
    descending: boolean,
  ) => Array<string> = (
    list: ReadonlyArray<{ labels: PromQLLabels }>,
    names: Array<string>,
    descending: boolean,
  ): Array<string> => {
    return sortPromQLByLabels(list, names, descending).map(
      (item: { labels: PromQLLabels }): string => {
        return formatPromQLLabels(item.labels);
      },
    );
  };

  const ascending: Array<string> = [
    "x",
    'x{g="01"}',
    'x{a="z", g="1"}',
    'x{b="a", g="1"}',
    'x{g="1"}',
    'x{g="1", h="x"}',
    'x{g="9", y="1"}',
    'x{g="9", z="1"}',
    'x{g="10"}',
    'x{g="B"}',
    'x{g="a"}',
  ];

  test("sorts by the label's values, ties by the whole label set", () => {
    expect(order(items, ["g"], false)).toEqual(ascending);
  });

  test("sorts descending as the same order backwards, ties included", () => {
    expect(order(items, ["g"], true)).toEqual([...ascending].reverse());
  });

  test("gives the same order whatever order the items come in", () => {
    for (let seed: number = 1; seed <= 50; seed++) {
      const input: Array<{ labels: PromQLLabels }> = shuffled(
        items,
        seededRandom(seed),
      );

      expect(order(input, ["g"], false)).toEqual(ascending);
      expect(order(input, ["g"], true)).toEqual([...ascending].reverse());
      expect(order(input, ["nolabel"], false)).toEqual(order(items, [], false));
    }
  });

  test("with no labels to sort by, sorts by the whole label sets", () => {
    expect(order(items, [], false)).toEqual([
      "x",
      'x{a="z", g="1"}',
      'x{b="a", g="1"}',
      'x{g="01"}',
      'x{g="1"}',
      'x{g="1", h="x"}',
      'x{g="10"}',
      'x{g="9", y="1"}',
      'x{g="9", z="1"}',
      'x{g="B"}',
      'x{g="a"}',
    ]);
  });

  test("reads the labels in the order given: the first decides, the next breaks its ties", () => {
    const pairs: Array<{ labels: PromQLLabels }> = [
      { labels: { a: "2", b: "1" } },
      { labels: { a: "1", b: "2" } },
      { labels: { a: "1", b: "1" } },
      { labels: { a: "2", b: "2" } },
    ];

    expect(order(pairs, ["a", "b"], false)).toEqual([
      '{a="1", b="1"}',
      '{a="1", b="2"}',
      '{a="2", b="1"}',
      '{a="2", b="2"}',
    ]);
    expect(order(pairs, ["b", "a"], false)).toEqual([
      '{a="1", b="1"}',
      '{a="2", b="1"}',
      '{a="1", b="2"}',
      '{a="2", b="2"}',
    ]);
  });

  test("leaves the items it was given as they were", () => {
    const input: Array<{ labels: PromQLLabels }> = [...items];

    sortPromQLByLabels(input, ["g"], false);

    expect(input).toEqual(items);
  });

  test("an empty list sorts to an empty list", () => {
    expect(sortPromQLByLabels([], ["g"], false)).toEqual([]);
    expect(sortPromQLByLabels([], ["g"], true)).toEqual([]);
  });
});
