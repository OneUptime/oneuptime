import { describe, expect, test } from "@jest/globals";
import { TextRange } from "../../../Utils/DataSecurity/TextReadings";
import {
  placeRangesOnNumbers,
  placeRangesOnStrings,
  readStoredText,
  StoredText,
  StoredTextNumber,
} from "../../../Utils/Telemetry/ScrubStoredText";

/*
 * ---------------------------------------------------------------------------
 * A LIST OR A MAP AS THE TABLE STORES IT: ITS NUMBERS TOO (#11500), AND A
 * RANGE ACROSS A KEY AND ITS VALUE (#11502).
 *
 * readStoredText writes the JSON text JSON.stringify writes, and now keeps
 * where each finite number of the value is in it, as JSON writes it. A range
 * of that text is placed on the numbers it covers - the part of each, so a
 * pair of coordinates across two numbers is placed on both - and on the
 * part of each of the value's texts it covers, so a pattern whose words sit
 * in a key, `"cvv":"123"`, is placed on the value and never the key.
 * ---------------------------------------------------------------------------
 */

// Where a range of the JSON text is, as its characters.
function slice(stored: StoredText, range: TextRange): string {
  return stored.text.slice(range[0], range[1]);
}

// The range of the JSON text that holds a piece, the first time it is written.
function rangeOf(
  stored: StoredText,
  piece: string,
  from: number = 0,
): TextRange {
  const start: number = stored.text.indexOf(piece, from);

  expect(start).toBeGreaterThanOrEqual(0);

  return [start, start + piece.length];
}

describe("readStoredText keeps where each number is", () => {
  test("writes the text JSON.stringify writes, its numbers where JSON wrote them", () => {
    const value: unknown = [
      { system: "phone", value: 2012345678 },
      -0.1275,
      { nested: [1e21, 42, -7] },
    ];
    const stored: StoredText = readStoredText(value)!;

    expect(stored.text).toBe(JSON.stringify(value));
    expect(
      stored.numbers.map((number: StoredTextNumber): string => {
        return number.text;
      }),
    ).toEqual(["2012345678", "-0.1275", "1e+21", "42", "-7"]);

    for (const number of stored.numbers) {
      expect(stored.text.slice(number.start, number.end)).toBe(number.text);
    }
  });

  test("keeps no number JSON writes as null, and -0 as JSON writes it", () => {
    const stored: StoredText = readStoredText([
      NaN,
      Infinity,
      -Infinity,
      -0,
      5,
    ])!;

    expect(stored.text).toBe("[null,null,null,0,5]");
    expect(
      stored.numbers.map((number: StoredTextNumber): string => {
        return number.text;
      }),
    ).toEqual(["0", "5"]);
  });

  test("keeps no number of a value it does not write, and none of a text, true or false", () => {
    expect(readStoredText(42)).toBeNull();
    expect(readStoredText("42")).toBeNull();
    expect(readStoredText([true, false, null, "7"])!.numbers).toEqual([]);
    // {"b":3}: the key JSON leaves out takes no place.
    expect(readStoredText({ a: undefined, b: 3 })!.numbers).toEqual([
      { text: "3", start: 5, end: 6 },
    ]);
  });
});

describe("placeRangesOnNumbers (#11500)", () => {
  test("a range that is a number is placed on it, by its text as JSON wrote it", () => {
    const stored: StoredText = readStoredText([
      { system: "phone", value: 2012345678 },
    ])!;
    const placed: Map<string, Array<TextRange>> = placeRangesOnNumbers(stored, [
      rangeOf(stored, "2012345678"),
    ]);

    expect([...placed.entries()]).toEqual([["2012345678", [[0, 10]]]]);
  });

  test("a range across two numbers and the comma between them is placed on both", () => {
    const stored: StoredText = readStoredText([51.50722, -0.1275])!;
    const pair: TextRange = rangeOf(stored, "51.50722,-0.1275");

    expect(slice(stored, pair)).toBe("51.50722,-0.1275");
    expect([...placeRangesOnNumbers(stored, [pair]).entries()]).toEqual([
      ["51.50722", [[0, 8]]],
      ["-0.1275", [[0, 7]]],
    ]);
  });

  test("a range of part of a number is placed on that part", () => {
    const stored: StoredText = readStoredText([123456789])!;
    const [start] = rangeOf(stored, "123456789");

    expect([
      ...placeRangesOnNumbers(stored, [[start + 2, start + 5]]).entries(),
    ]).toEqual([["123456789", [[2, 5]]]]);
  });

  test("a range of a text, a key or the punctuation is placed on no number", () => {
    const stored: StoredText = readStoredText({ zip: "94107", count: 3 })!;

    expect(
      placeRangesOnNumbers(stored, [
        rangeOf(stored, "94107"),
        rangeOf(stored, "zip"),
        rangeOf(stored, "{"),
      ]).size,
    ).toBe(0);
  });

  test("a number written twice is placed by its text: both are hidden", () => {
    const stored: StoredText = readStoredText([2012345678, 2012345678])!;
    const placed: Map<string, Array<TextRange>> = placeRangesOnNumbers(stored, [
      rangeOf(stored, "2012345678"),
    ]);

    expect(placed.get("2012345678")).toEqual([[0, 10]]);
  });

  test("ranges out of order, overlapping and empty are each placed or left", () => {
    const stored: StoredText = readStoredText([11, 22, 33])!;
    const [start] = rangeOf(stored, "33");

    expect([
      ...placeRangesOnNumbers(stored, [
        [start, start + 2],
        [1, 3],
        [1, 1],
        [1, 2],
      ]).entries(),
    ]).toEqual([
      ["33", [[0, 2]]],
      [
        "11",
        [
          [0, 2],
          [0, 1],
        ],
      ],
    ]);
  });
});

describe("placeRangesOnStrings: a range across a key and its value is placed on the value (#11502)", () => {
  test("a pattern whose word is the key: placed on the value alone", () => {
    const stored: StoredText = readStoredText({ cvv: "123", brand: "visa" })!;
    const range: TextRange = rangeOf(stored, 'cvv":"123');

    expect([...placeRangesOnStrings(stored, [range]).entries()]).toEqual([
      ["123", [[0, 3]]],
    ]);
  });

  test("an assignment written against the JSON text: the value's part, never the key", () => {
    const stored: StoredText = readStoredText({
      name: "billing",
      api_key: "s3cr3tvalue",
    })!;
    const range: TextRange = rangeOf(stored, '"api_key":"s3cr3tvalue"');

    expect([...placeRangesOnStrings(stored, [range]).entries()]).toEqual([
      ["s3cr3tvalue", [[0, 11]]],
    ]);
  });

  test("a range across two values is placed on the part of each", () => {
    const stored: StoredText = readStoredText(["alpha", "beta"])!;
    const range: TextRange = rangeOf(stored, 'pha","be');

    expect([...placeRangesOnStrings(stored, [range]).entries()]).toEqual([
      ["alpha", [[2, 5]]],
      ["beta", [[0, 2]]],
    ]);
  });

  test("a range inside a key alone is placed on nothing, and one inside a value as before", () => {
    const stored: StoredText = readStoredText({ token1: "token22" })!;

    expect(placeRangesOnStrings(stored, [rangeOf(stored, "token1")]).size).toBe(
      0,
    );
    expect([
      ...placeRangesOnStrings(stored, [rangeOf(stored, "token22")]).entries(),
    ]).toEqual([["token22", [[0, 7]]]]);
  });

  test("a value written with escapes: placed on its characters as it reads, never inside an escape", () => {
    const value: string = 'line "one"\nphone';
    const stored: StoredText = readStoredText({ note: value })!;
    const written: string = JSON.stringify(value).slice(1, -1);
    const [start] = rangeOf(stored, written);

    // The whole value, its escapes and all.
    expect(
      placeRangesOnStrings(stored, [[start, start + written.length]]).get(
        value,
      ),
    ).toEqual([[0, value.length]]);
    // A part that ends inside the escape of the quote is left out.
    expect(
      placeRangesOnStrings(stored, [[start, start + 6]]).get(value),
    ).toBeUndefined();
    // One that ends after it is placed, the quote whole.
    expect(
      placeRangesOnStrings(stored, [[start, start + 7]]).get(value),
    ).toEqual([[0, 6]]);
  });

  test("a range that starts in the punctuation before a value starts at the value", () => {
    const stored: StoredText = readStoredText({ a: "xyz" })!;
    const [start, end] = rangeOf(stored, ':"xyz');

    expect([...placeRangesOnStrings(stored, [[start, end]]).entries()]).toEqual(
      [["xyz", [[0, 3]]]],
    );
  });
});
