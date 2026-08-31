import { rgbToHex } from "./color";
import { describe, expect, test } from "@jest/globals";

/*
 * Every state and severity badge in the app is painted with whatever this
 * function returns, from a `color` field the API is free to send in several
 * shapes (an {r,g,b} triple, a legacy {red,green,blue} one, or a hex string
 * wrapped in `value`/`color`). The function's job is to end up with a usable
 * colour no matter what arrives.
 *
 * The failure that matters is the silent one. This never throws; it just hands
 * back a colour, and a wrong colour is a badge that is unreadable or invisible
 * against the card behind it rather than an error anybody notices.
 */

/*
 * The documented fallback: a mid grey that is legible on both the light and the
 * dark card background. Anything the function cannot understand must come out
 * as this, because grey reads as "no status colour" while black reads as a
 * badge that failed to render.
 */
const NEUTRAL: string = "#9ca3af";

/*
 * The function's own parameter type, borrowed rather than re-declared.
 * ColorInput is module-private, and a hand-copied duplicate here would keep
 * compiling after someone widened the real one - which is exactly the moment a
 * test like this should stop.
 */
type ColorArg = Parameters<typeof rgbToHex>[0];

/*
 * Objects that name no channel this function understands. Typed as the real
 * parameter type so the cast is stated once, here, rather than at every call.
 */
const UNREADABLE_OBJECTS: Array<[string, ColorArg]> = [
  ["an empty object", {}],
  ["an object with no colour fields at all", { name: "Created" } as ColorArg],
  [
    "an object whose channels are not numbers",
    { r: "255", g: "0", b: "0" } as unknown as ColorArg,
  ],
  ["an object whose channels are NaN", { r: NaN, g: NaN, b: NaN }],
  [
    "an object whose channels are null",
    { r: null, g: null, b: null } as unknown as ColorArg,
  ],
];

describe("rgbToHex with an absent colour", () => {
  test.each([
    ["null", null],
    ["undefined", undefined],
  ])(
    "falls back to the neutral grey for %s",
    (_label: string, input: string | null | undefined): void => {
      expect(rgbToHex(input)).toBe(NEUTRAL);
    },
  );
});

describe("rgbToHex with a hex string", () => {
  test("accepts six digits with a leading hash", () => {
    expect(rgbToHex("#ff0000")).toBe("#ff0000");
    expect(rgbToHex("#000000")).toBe("#000000");
    expect(rgbToHex("#9ca3af")).toBe("#9ca3af");
  });

  test("accepts six digits without a leading hash and adds one", () => {
    /*
     * The API is inconsistent about the hash, and a string that came back
     * without one still has to end up as something React Native will accept as
     * a colour - a bare "ff0000" is not.
     */
    expect(rgbToHex("ff0000")).toBe("#ff0000");
    expect(rgbToHex("00ff00")).toBe("#00ff00");
  });

  test("expands three digits to six, with and without the hash", () => {
    expect(rgbToHex("#fff")).toBe("#ffffff");
    expect(rgbToHex("fff")).toBe("#ffffff");
    expect(rgbToHex("#f0a")).toBe("#ff00aa");
    expect(rgbToHex("012")).toBe("#001122");
  });

  test("normalises mixed case down to lower case", () => {
    /*
     * Not cosmetic. Callers compare these strings to pick an icon tint, and two
     * spellings of the same colour comparing unequal is a bug that only shows
     * up on whichever project happens to have configured its colours in caps.
     */
    expect(rgbToHex("#AbCdEf")).toBe("#abcdef");
    expect(rgbToHex("#FFF")).toBe("#ffffff");
    expect(rgbToHex("FF0000")).toBe("#ff0000");
  });

  test("tolerates surrounding whitespace", () => {
    expect(rgbToHex("  #ff0000  ")).toBe("#ff0000");
    expect(rgbToHex("\t#fff\n")).toBe("#ffffff");
  });

  test.each([
    ["an empty string", ""],
    ["whitespace only", "   "],
    ["a colour name", "red"],
    ["four digits", "#ff00"],
    ["five digits", "#ff000"],
    ["eight digits, i.e. hex with alpha", "#ff0000ff"],
    ["a non-hex character", "#gg0000"],
    ["a css function", "rgb(255, 0, 0)"],
    ["a hash on its own", "#"],
  ])(
    "falls back to the neutral grey for %s",
    (_label: string, input: string): void => {
      expect(rgbToHex(input)).toBe(NEUTRAL);
    },
  );
});

describe("rgbToHex with a wrapped hex string", () => {
  test("reads the value field", () => {
    expect(rgbToHex({ value: "#ff0000" })).toBe("#ff0000");
    expect(rgbToHex({ value: "f00" })).toBe("#ff0000");
  });

  test("reads the color field", () => {
    expect(rgbToHex({ color: "#00ff00" })).toBe("#00ff00");
    expect(rgbToHex({ color: "0F0" })).toBe("#00ff00");
  });

  test("prefers value over color, and either over the channels", () => {
    expect(rgbToHex({ value: "#ff0000", color: "#00ff00" })).toBe("#ff0000");
    expect(rgbToHex({ value: "#ff0000", r: 0, g: 0, b: 255 })).toBe("#ff0000");
    expect(rgbToHex({ color: "#00ff00", r: 0, g: 0, b: 255 })).toBe("#00ff00");
  });

  test("falls back to the neutral grey when the wrapped string is not hex", () => {
    expect(rgbToHex({ value: "not-a-colour" })).toBe(NEUTRAL);
    expect(rgbToHex({ color: "rgb(1,2,3)" })).toBe(NEUTRAL);
  });

  test("falls back to the neutral grey when the wrapper carries no usable hex and no channels", () => {
    /*
     * A non-string `value` does not satisfy the string branch, so this drops
     * through to the channel arithmetic with nothing to work from.
     */
    expect(rgbToHex({ value: 16711680 as unknown as string })).toBe(NEUTRAL);
  });
});

describe("rgbToHex with channels", () => {
  test("reads r, g and b", () => {
    expect(rgbToHex({ r: 255, g: 0, b: 0 })).toBe("#ff0000");
    expect(rgbToHex({ r: 220, g: 38, b: 38 })).toBe("#dc2626");
  });

  test("reads the legacy red, green and blue spelling", () => {
    expect(rgbToHex({ red: 255, green: 0, blue: 0 })).toBe("#ff0000");
    expect(rgbToHex({ red: 220, green: 38, blue: 38 })).toBe("#dc2626");
  });

  test("prefers the short spelling when an object carries both", () => {
    expect(
      rgbToHex({ r: 255, red: 0, g: 0, green: 255, b: 0, blue: 255 }),
    ).toBe("#ff0000");
  });

  test("pads single-digit channels to two hex digits", () => {
    /*
     * Without the padding, 1/2/3 would concatenate to "#123" - a valid-looking
     * but completely different colour, which is exactly the kind of wrong that
     * nobody notices in review.
     */
    expect(rgbToHex({ r: 1, g: 2, b: 3 })).toBe("#010203");
    expect(rgbToHex({ r: 0, g: 15, b: 16 })).toBe("#000f10");
  });

  test("clamps channels outside 0-255 instead of emitting a longer string", () => {
    /*
     * 300 would otherwise be "12c" and shift every digit after it, producing a
     * string React Native cannot parse at all.
     */
    expect(rgbToHex({ r: 300, g: -20, b: 255 })).toBe("#ff00ff");
    expect(rgbToHex({ r: 1000, g: 1000, b: 1000 })).toBe("#ffffff");
    expect(rgbToHex({ r: -1, g: -1, b: -1 })).toBe("#000000");
  });

  test("rounds fractional channels to the nearest whole one", () => {
    expect(rgbToHex({ r: 12.6, g: 0.4, b: 254.5 })).toBe("#0d00ff");
  });

  test("treats a partially specified triple as having zeroes for the rest", () => {
    /*
     * Deliberately still a colour: the object said something about at least one
     * channel, so we honour it rather than throwing the whole thing away.
     */
    expect(rgbToHex({ r: 255 })).toBe("#ff0000");
    expect(rgbToHex({ blue: 255 })).toBe("#0000ff");
  });

  test("keeps a genuine black black", () => {
    /*
     * The case the fallback below must not swallow. An object that really does
     * say r:0,g:0,b:0 has told us a colour, and "#000000" is the right answer -
     * so the check for an unusable object cannot simply be "did the arithmetic
     * come out as zero".
     */
    expect(rgbToHex({ r: 0, g: 0, b: 0 })).toBe("#000000");
    expect(rgbToHex({ red: 0, green: 0, blue: 0 })).toBe("#000000");
  });

  test.each(UNREADABLE_OBJECTS)(
    "falls back to the neutral grey for %s, rather than an invisible black",
    (_label: string, input: ColorArg): void => {
      /*
       * The bug this test exists for. An object with none of r/g/b/red/green/
       * blue used to fall through to the arithmetic, where every missing
       * channel became 0, and the badge came back "#000000" - black on a dark
       * card, i.e. an invisible chip - instead of the neutral grey the function
       * promises for everything else it cannot read.
       */
      expect(rgbToHex(input)).toBe(NEUTRAL);
    },
  );
});
