import {
  compareCodePoints,
  compareNaturally,
  getNaturalSortKey,
  getWrittenName,
  NATURAL_SORT_KEY_MAX_LENGTH,
  NATURAL_SORT_KEY_NUMBERED_TIER,
  NATURAL_SORT_KEY_SEPARATOR,
  NATURAL_SORT_KEY_UNNUMBERED_TIER,
  sortByNaturalName,
  sortNaturally,
} from "../../Utils/NaturalOrder";
import { generatedTexts } from "../Helpers/GeneratedTexts";
import { SeededRandom, seededRandom, shuffled } from "../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";
import { FastestRun, fastestRun } from "../Helpers/FastestRun";

/*
 * NATURAL ORDER (Utils/NaturalOrder), the order labels are listed in
 * everywhere (OneUptime issue #5183): a name that starts with a number
 * first, in the order of that number, then every other name alphabetically;
 * a number anywhere in a name read by its value; case and accents not
 * moving a name. One sort key holds it, compared code point by code point -
 * in the browser by compareCodePoints, on the server by Postgres's "C"
 * collation (Label.nameSortKey) - so the two agree to the last label.
 */

const sign: (value: number) => number = (value: number): number => {
  return value === 0 ? 0 : value < 0 ? -1 : 1;
};

// A name that starts with a number, spaces aside.
const NUMBERED_NAME: RegExp = /^\s*\d/u;

describe("the customer's numbered labels (#5183)", () => {
  test("the issue's own list: numbers in order, then the rest alphabetically", () => {
    expect(
      sortNaturally([
        "Production",
        "4. Business System",
        "Claude",
        "2. SubCategory",
        "1. Category",
        "3. Item",
      ]),
    ).toEqual([
      "1. Category",
      "2. SubCategory",
      "3. Item",
      "4. Business System",
      "Claude",
      "Production",
    ]);
  });

  test("the labels of the monitors list's screenshot (#5187), a key and a value in each", () => {
    expect(
      sortNaturally([
        "4.Business System=Customer Mobile App",
        "3.Item=Connectivity",
        "2.SubCategory=Website",
        "Claude",
        "1.Category=Application",
      ]),
    ).toEqual([
      "1.Category=Application",
      "2.SubCategory=Website",
      "3.Item=Connectivity",
      "4.Business System=Customer Mobile App",
      "Claude",
    ]);
  });

  test("10 comes after 9, not after 1: numbers of several digits by their value", () => {
    expect(
      sortNaturally([
        "10. Owner",
        "9. Region",
        "1. Category",
        "100. Archive",
        "2. SubCategory",
        "11. Team",
      ]),
    ).toEqual([
      "1. Category",
      "2. SubCategory",
      "9. Region",
      "10. Owner",
      "11. Team",
      "100. Archive",
    ]);
  });

  test("labels with the same number: alphabetically by what follows it, whatever its case", () => {
    expect(
      sortNaturally([
        "2.SubCategory=Website",
        "2.SubCategory=api",
        "2.SubCategory=Database",
        "2.SubCategory=batch jobs",
      ]),
    ).toEqual([
      "2.SubCategory=api",
      "2.SubCategory=batch jobs",
      "2.SubCategory=Database",
      "2.SubCategory=Website",
    ]);
  });

  test("a label without a number comes after every numbered one - even one that starts with a symbol", () => {
    expect(
      sortNaturally([
        "Zeta",
        "#infra",
        "(legacy)",
        "_internal",
        "apple",
        "12. Last",
        "1. First",
      ]),
    ).toEqual([
      "1. First",
      "12. Last",
      "#infra",
      "(legacy)",
      "_internal",
      "apple",
      "Zeta",
    ]);
  });

  test("the number need not be followed by a dot", () => {
    expect(
      sortNaturally(["10 - Owner", "2_SubCategory", "1-Category", "3 Item"]),
    ).toEqual(["1-Category", "2_SubCategory", "3 Item", "10 - Owner"]);
  });
});

describe("numbers inside a name", () => {
  test("are read by their value too", () => {
    expect(sortNaturally(["Tier 10", "Tier 2", "Tier 1"])).toEqual([
      "Tier 1",
      "Tier 2",
      "Tier 10",
    ]);
    expect(sortNaturally(["v10", "v9", "v1.10", "v1.9"])).toEqual([
      "v1.9",
      "v1.10",
      "v9",
      "v10",
    ]);
    expect(sortNaturally(["eu-west-12", "eu-west-2", "eu-east-1"])).toEqual([
      "eu-east-1",
      "eu-west-2",
      "eu-west-12",
    ]);
  });

  test("a number comes before a letter in the same place", () => {
    expect(sortNaturally(["release b", "release 2", "release a"])).toEqual([
      "release 2",
      "release a",
      "release b",
    ]);
  });

  test("leading zeros do not change a number; the name as written breaks the tie", () => {
    expect(sortNaturally(["01. B", "1. A", "001. C", "2. D"])).toEqual([
      "1. A",
      "01. B",
      "001. C",
      "2. D",
    ]);
    expect(sortNaturally(["7", "007", "08"])).toEqual(["007", "7", "08"]);
  });

  test("zero is a number like any other", () => {
    expect(sortNaturally(["1. One", "0. Zero", "00. Zeros"])).toEqual([
      "0. Zero",
      "00. Zeros",
      "1. One",
    ]);
  });

  test("a number of more digits than any name holds is still read, its first 99 digits", () => {
    const huge: string = `${"9".repeat(120)} huge`;
    const small: string = "5 small";

    expect(sortNaturally([huge, small])).toEqual([small, huge]);
    expect(
      getNaturalSortKey(huge).startsWith(
        `${NATURAL_SORT_KEY_NUMBERED_TIER}99${"9".repeat(99)}`,
      ),
    ).toBe(true);
  });

  test("full-width and circled digits are the digits they stand for", () => {
    // "１０" is two full-width digits; NFKD folds them to "10".
    expect(sortNaturally(["\u{FF11}\u{FF10}. Owner", "9. Region"])).toEqual([
      "9. Region",
      "\u{FF11}\u{FF10}. Owner",
    ]);
    expect(getNaturalSortKey("\u{2460} First")[0]).toBe(
      NATURAL_SORT_KEY_NUMBERED_TIER,
    );
  });
});

describe("case, accents and spaces", () => {
  test("case does not move a name; the name as written breaks a tie", () => {
    expect(sortNaturally(["beta", "Alpha", "ALPHA2", "alpha"])).toEqual([
      "Alpha",
      "alpha",
      "ALPHA2",
      "beta",
    ]);
  });

  test("an accented letter sits with its letter", () => {
    expect(sortNaturally(["Ezra", "Église", "école", "Eagle"])).toEqual([
      "Eagle",
      "école",
      "Église",
      "Ezra",
    ]);
    // Letters NFKD does not take apart are folded as keys are (KeyFromName).
    expect(sortNaturally(["Strasse 2", "Straße 1", "Strasse 1"])).toEqual([
      "Strasse 1",
      "Straße 1",
      "Strasse 2",
    ]);
  });

  test("spaces count once, and not at a name's ends", () => {
    expect(getNaturalSortKey("  2.   Item  ")).toBe(
      getNaturalSortKey("2. Item"),
    );
    expect(compareNaturally("2.\tItem", "2. Item")).toBe(0);
    expect(getWrittenName("  a \n b  ")).toBe("a b");
  });

  test("a shorter name comes before a longer one it begins", () => {
    expect(sortNaturally(["ab c", "abc", "ab"])).toEqual(["ab", "ab c", "abc"]);
  });

  test("a control character in a name does not move it", () => {
    // Read as "az": after "ab", where a raw \u0007 would have put it first.
    expect(sortNaturally(["a\u0007z", "ab", "b"])).toEqual([
      "ab",
      "a\u0007z",
      "b",
    ]);
    expect(compareNaturally("a\u0007z", "ab")).toBeGreaterThan(0);
  });
});

describe("the sort key", () => {
  test("starts with the tier: 0 for a numbered name, 1 for any other", () => {
    expect(getNaturalSortKey("2. SubCategory")).toBe(
      `${NATURAL_SORT_KEY_NUMBERED_TIER}012. subcategory${NATURAL_SORT_KEY_SEPARATOR}2. SubCategory`,
    );
    expect(getNaturalSortKey("Production")).toBe(
      `${NATURAL_SORT_KEY_UNNUMBERED_TIER}production${NATURAL_SORT_KEY_SEPARATOR}Production`,
    );
    expect(getNaturalSortKey("10.Owner")).toBe(
      `${NATURAL_SORT_KEY_NUMBERED_TIER}0210.owner${NATURAL_SORT_KEY_SEPARATOR}10.Owner`,
    );
  });

  test("the separator is lower than anything a folded name holds", () => {
    expect(NATURAL_SORT_KEY_SEPARATOR.charCodeAt(0)).toBe(1);
    expect(compareCodePoints(NATURAL_SORT_KEY_SEPARATOR, " ")).toBeLessThan(0);
  });

  test("an empty, missing or blank name is a key too, never a throw", () => {
    for (const name of ["", "   ", null, undefined]) {
      expect(getNaturalSortKey(name)).toBe(
        `${NATURAL_SORT_KEY_UNNUMBERED_TIER}${NATURAL_SORT_KEY_SEPARATOR}`,
      );
    }
    expect(compareNaturally(null, undefined)).toBe(0);
    expect(compareNaturally("", "a")).toBeLessThan(0);
  });

  test("fits the column it is kept in, whatever the name", () => {
    // Every digit becomes three characters: a name of 100 is 301 long.
    const digits: string = "1.".repeat(50);
    expect(getNaturalSortKey(digits).length).toBeLessThanOrEqual(
      NATURAL_SORT_KEY_MAX_LENGTH,
    );

    // U+FDFA unfolds into eighteen characters: cut, never failed.
    const unfolding: string = "\u{FDFA}".repeat(100);
    const key: string = getNaturalSortKey(unfolding);
    expect(key.length).toBeLessThanOrEqual(NATURAL_SORT_KEY_MAX_LENGTH);
    expect(key.length).toBeGreaterThan(NATURAL_SORT_KEY_MAX_LENGTH - 2);
  });

  test("is never cut between the two halves of a character", () => {
    for (const filler of ["", "a", "ab"]) {
      const key: string = getNaturalSortKey(
        `${filler}${"\u{1F525}".repeat(400)}`,
      );

      expect(key.length).toBeLessThanOrEqual(NATURAL_SORT_KEY_MAX_LENGTH);

      const last: number = key.charCodeAt(key.length - 1);
      // Not a high surrogate left without its low one.
      expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
      expect(Buffer.from(key, "utf8").toString("utf8")).toBe(key);
    }
  });

  test("is read in time that grows with the name, not its square", () => {
    const long: string = "12 ab ".repeat(70000);
    const timed: FastestRun<void> = fastestRun({
      run: (): void => {
        getNaturalSortKey(long);
        getNaturalSortKey(" \t".repeat(200000));
        getNaturalSortKey("9".repeat(400000));
      },
      limitInMs: 2000,
    });

    expect(timed.inMs).toBeLessThan(2000);
  });
});

describe("code point order, as Postgres compares text under the C collation", () => {
  test("a character beyond U+FFFF comes after one from U+E000 to U+FFFF", () => {
    // JavaScript's own < puts the emoji first: its first unit is 0xD83D.
    expect("\u{1F525}" < "\u{E000}").toBe(true);
    expect(compareCodePoints("\u{E000}", "\u{1F525}")).toBeLessThan(0);
    expect(compareCodePoints("\u{1F525}", "\u{FFFD}")).toBeGreaterThan(0);
    expect(compareCodePoints("\u{1F525}", "\u{1F526}")).toBeLessThan(0);
  });

  test("agrees with comparing UTF-8 bytes, which is what C does, on every kind of text", () => {
    const alphabet: Array<string> = [
      "a",
      "Z",
      "0",
      "9",
      " ",
      ".",
      "\u{0001}",
      "é",
      "ß",
      "\u{4E2D}",
      "\u{E000}",
      "\u{FFFD}",
      "\u{1F525}",
      "\u{10FFFF}",
      "\u{7F}",
      "\u{80}",
    ];
    const texts: Array<string> = generatedTexts(3000, 5183, alphabet, 8);

    for (let index: number = 0; index + 1 < texts.length; index += 2) {
      const first: string = texts[index]!;
      const second: string = texts[index + 1]!;

      expect([first, second, sign(compareCodePoints(first, second))]).toEqual([
        first,
        second,
        sign(
          Buffer.compare(
            Buffer.from(first, "utf8"),
            Buffer.from(second, "utf8"),
          ),
        ),
      ]);
    }
  });

  test("is 0 for the same text, and a shorter text that begins a longer one comes first", () => {
    expect(compareCodePoints("abc", "abc")).toBe(0);
    expect(compareCodePoints("ab", "abc")).toBeLessThan(0);
    expect(compareCodePoints("abc", "ab")).toBeGreaterThan(0);
  });
});

describe("a total order, the same however the names arrive", () => {
  const alphabet: Array<string> = [
    "1",
    "2",
    "10",
    "0",
    ".",
    " ",
    "=",
    "a",
    "B",
    "é",
    "Item",
    "SubCategory",
    "#",
    "_",
    "\u{1F525}",
  ];
  // One of each name as written: two that differ only in spaces read alike.
  const names: Array<string> = Array.from(
    new Map(
      generatedTexts(400, 51870, alphabet, 6).map(
        (name: string): [string, string] => {
          return [getWrittenName(name), name];
        },
      ),
    ).values(),
  );

  test("sorting any shuffle of the names gives one order", () => {
    const random: SeededRandom = seededRandom(5187);
    const expected: Array<string> = sortNaturally(names);

    for (let round: number = 0; round < 20; round++) {
      expect(sortNaturally(shuffled(names, random))).toEqual(expected);
    }
  });

  test("antisymmetric and transitive over every pair and triple sampled", () => {
    const random: SeededRandom = seededRandom(51831);

    for (let round: number = 0; round < 2000; round++) {
      const a: string = names[random(names.length)]!;
      const b: string = names[random(names.length)]!;
      const c: string = names[random(names.length)]!;

      expect(sign(compareNaturally(a, b)) + sign(compareNaturally(b, a))).toBe(
        0,
      );

      if (compareNaturally(a, b) <= 0 && compareNaturally(b, c) <= 0) {
        expect(compareNaturally(a, c)).toBeLessThanOrEqual(0);
      }
    }
  });

  test("0 only for names written the same, spaces aside", () => {
    for (let index: number = 0; index + 1 < names.length; index++) {
      const name: string = names[index]!;

      expect(compareNaturally(name, ` ${name}  `)).toBe(0);
      expect(compareNaturally(name, names[index + 1]!)).not.toBe(0);
    }
  });

  test("every numbered name comes before every other", () => {
    const sorted: Array<string> = sortNaturally(names);
    const firstUnnumbered: number = sorted.findIndex((name: string) => {
      return !NUMBERED_NAME.test(name);
    });

    expect(firstUnnumbered).toBeGreaterThan(0);

    for (const name of sorted.slice(firstUnnumbered)) {
      expect([name, NUMBERED_NAME.test(name)]).toEqual([name, false]);
    }
  });
});

describe("sorting helpers", () => {
  test("sortNaturally gives a new array and leaves the one given as it was", () => {
    const names: Array<string> = ["b", "10", "a", "2"];
    const sorted: Array<string> = sortNaturally(names);

    expect(sorted).toEqual(["2", "10", "a", "b"]);
    expect(names).toEqual(["b", "10", "a", "2"]);
    expect(sorted).not.toBe(names);
  });

  test("sortByNaturalName reads each name once, and keeps items of one name in the order given", () => {
    const items: Array<{ id: number; name: string }> = [
      { id: 1, name: "b" },
      { id: 2, name: "a" },
      { id: 3, name: "b" },
      { id: 4, name: "2" },
      { id: 5, name: "a" },
    ];
    let reads: number = 0;

    const sorted: Array<{ id: number; name: string }> = sortByNaturalName(
      items,
      (item: { name: string }): string => {
        reads++;
        return item.name;
      },
    );

    expect(
      sorted.map((item: { id: number }): number => {
        return item.id;
      }),
    ).toEqual([4, 2, 5, 1, 3]);
    expect(reads).toBe(items.length);
  });

  test("an empty list is an empty list", () => {
    expect(sortNaturally([])).toEqual([]);
    expect(
      sortByNaturalName([], (item: string): string => {
        return item;
      }),
    ).toEqual([]);
  });
});
