import Color from "../../../../Types/Color";
import { getContrastRatio, parseColor } from "../../../../Utils/ColorContrast";
import { DISTINCT_COLORS } from "../../../../Utils/DistinctColor";
import { COLOR_PICKER_SWATCHES } from "../../../../UI/Components/ColorPicker/ColorPalette";
import {
  COLOR_CODE_EXAMPLE,
  COLOR_CODE_INVALID_CHARACTERS_MESSAGE,
  COLOR_CODE_INVALID_LENGTH_MESSAGE,
  ColorCodeInput,
  colorToHsv,
  findSwatch,
  getHueAtPoint,
  getSaturationAtPoint,
  HUE_BIG_STEP,
  HUE_STEP,
  Hsv,
  MIN_MARK_CONTRAST,
  hsvToHex,
  hsvToRgb,
  moveHueByKey,
  moveSaturationByKey,
  normalizeColorValue,
  PointerBox,
  readColorCodeInput,
  rgbToHex,
  rgbToHsv,
  SATURATION_BIG_STEP,
  SATURATION_STEP,
  shouldUseDarkMark,
} from "../../../../UI/Components/ColorPicker/ColorValue";
import { describe, expect, test } from "@jest/globals";

/*
 * The arithmetic behind the color field: what a stored value is, what a
 * typed code means, and where a point or a key press lands on the
 * saturation square and the hue strip. Pure, so every rule is pinned here
 * on its own; the components' tests drive the same rules through the DOM.
 */

const BOX: PointerBox = { left: 100, top: 50, width: 200, height: 100 };

describe("normalizeColorValue: a stored color as the field compares it", () => {
  test.each([
    ["#6366F1", "#6366f1"],
    ["#6366f1", "#6366f1"],
    ["  #6366f1  ", "#6366f1"],
    ["6366f1", "#6366f1"],
    ["#abc", "#aabbcc"],
    ["#ABC", "#aabbcc"],
    ["rgb(99, 102, 241)", "#6366f1"],
    ["rgb(99 102 241)", "#6366f1"],
    ["#6366f1ff", "#6366f1"],
  ])("%p is %p", (stored: string, expected: string) => {
    expect(normalizeColorValue(stored)).toBe(expected);
  });

  test("a Color and its JSON form read the same as its text", () => {
    expect(normalizeColorValue(new Color("#EF4444"))).toBe("#ef4444");
    expect(normalizeColorValue({ _type: "Color", value: "#EF4444" })).toBe(
      "#ef4444",
    );
  });

  test("nothing is no color", () => {
    expect(normalizeColorValue(null)).toBe("");
    expect(normalizeColorValue(undefined)).toBe("");
    expect(normalizeColorValue("")).toBe("");
    expect(normalizeColorValue("   ")).toBe("");
    expect(normalizeColorValue({ _type: "Color" })).toBe("");
  });

  test("text that is not a color is kept as it is, so it is still shown", () => {
    expect(normalizeColorValue("transparent")).toBe("transparent");
    expect(normalizeColorValue(" not a color ")).toBe("not a color");
  });
});

describe("readColorCodeInput: what someone typed in the code box", () => {
  test("an empty box is empty, not wrong", () => {
    expect(readColorCodeInput("")).toEqual({ kind: "empty" });
    expect(readColorCodeInput("   ")).toEqual({ kind: "empty" });
  });

  test.each([
    ["#32a852", "#32a852"],
    ["#32A852", "#32a852"],
    ["32a852", "#32a852"],
    [" #32a852 ", "#32a852"],
  ])("%p is the color %p", (typed: string, hex: string) => {
    expect(readColorCodeInput(typed)).toEqual({
      kind: "valid",
      hex,
      isShorthand: false,
    });
  });

  test("three digits are shorthand: #abc is #aabbcc", () => {
    expect(readColorCodeInput("#abc")).toEqual({
      kind: "valid",
      hex: "#aabbcc",
      isShorthand: true,
    });
    expect(readColorCodeInput("F00")).toEqual({
      kind: "valid",
      hex: "#ff0000",
      isShorthand: true,
    });
  });

  test.each(["#32a85g", "red", "#zzzzzz", "rgb(1,2,3)", "#32 a852", "##32a852"])(
    "%p uses characters a code cannot have, and says which ones it can",
    (typed: string) => {
      const input: ColorCodeInput = readColorCodeInput(typed);

      expect(input).toEqual({
        kind: "invalid",
        message: COLOR_CODE_INVALID_CHARACTERS_MESSAGE,
      });
    },
  );

  test.each(["#32a85", "#3", "#32a8521", "#32a85211", "32a8"])(
    "%p has the wrong number of characters, and says how many",
    (typed: string) => {
      expect(readColorCodeInput(typed)).toEqual({
        kind: "invalid",
        message: COLOR_CODE_INVALID_LENGTH_MESSAGE,
      });
    },
  );

  test("the messages are plain, give an example, and the example is a color", () => {
    for (const message of [
      COLOR_CODE_INVALID_CHARACTERS_MESSAGE,
      COLOR_CODE_INVALID_LENGTH_MESSAGE,
    ]) {
      expect(message).toContain(COLOR_CODE_EXAMPLE);
      expect(message).not.toMatch(/hex|invalid|error/i);
    }

    expect(readColorCodeInput(COLOR_CODE_EXAMPLE).kind).toBe("valid");
  });
});

describe("findSwatch", () => {
  test("finds a palette color however it is written", () => {
    const first: string = COLOR_PICKER_SWATCHES[0]!.hex;

    expect(findSwatch(first, COLOR_PICKER_SWATCHES)?.hex).toBe(first);
    expect(findSwatch(first.toUpperCase(), COLOR_PICKER_SWATCHES)?.hex).toBe(
      first,
    );
  });

  test("finds nothing for a custom color, for none, or for text", () => {
    expect(findSwatch("#3e409a", COLOR_PICKER_SWATCHES)).toBeUndefined();
    expect(findSwatch("", COLOR_PICKER_SWATCHES)).toBeUndefined();
    expect(findSwatch("transparent", COLOR_PICKER_SWATCHES)).toBeUndefined();
  });
});

describe("shouldUseDarkMark: the tick a picked swatch carries", () => {
  test("every palette color takes a white tick, at 3:1 or more", () => {
    for (const color of DISTINCT_COLORS) {
      expect(shouldUseDarkMark(color.toString())).toBe(false);
      expect(
        getContrastRatio(parseColor(color)!, {
          red: 255,
          green: 255,
          blue: 255,
        }),
      ).toBeGreaterThanOrEqual(MIN_MARK_CONTRAST);
    }
  });

  test.each(["#fef08a", "#ffffff", "#e0f2fe", "#a7f3d0"])(
    "a pale custom color %p takes a dark one",
    (pale: string) => {
      expect(shouldUseDarkMark(pale)).toBe(true);
    },
  );

  test("dark custom colors take a white one, and text takes the default", () => {
    expect(shouldUseDarkMark("#3e409a")).toBe(false);
    expect(shouldUseDarkMark("#000000")).toBe(false);
    expect(shouldUseDarkMark("not a color")).toBe(false);
  });
});

describe("hex, RGB and HSV", () => {
  test("every palette color survives the trip through HSV unchanged", () => {
    for (const color of DISTINCT_COLORS) {
      const hex: string = color.toString().toLowerCase();
      const hsv: Hsv | null = colorToHsv(hex);

      expect(hsv).not.toBeNull();
      expect(hsvToHex(hsv!)).toBe(hex);
    }
  });

  test("the corners of the square are what they look like", () => {
    expect(hsvToHex({ h: 0, s: 1, v: 1 })).toBe("#ff0000");
    expect(hsvToHex({ h: 120, s: 1, v: 1 })).toBe("#00ff00");
    expect(hsvToHex({ h: 240, s: 1, v: 1 })).toBe("#0000ff");
    // Left edge: no color at all, white at the top.
    expect(hsvToHex({ h: 240, s: 0, v: 1 })).toBe("#ffffff");
    // Bottom edge: black, whatever the hue.
    expect(hsvToHex({ h: 240, s: 1, v: 0 })).toBe("#000000");
  });

  test("values outside the square are held to it", () => {
    expect(hsvToRgb({ h: 360, s: 2, v: 2 })).toEqual({
      red: 255,
      green: 0,
      blue: 0,
    });
    expect(hsvToRgb({ h: -120, s: 1, v: 1 })).toEqual(
      hsvToRgb({ h: 240, s: 1, v: 1 }),
    );
    expect(rgbToHex({ red: 300, green: -5, blue: Number.NaN })).toBe(
      "#ff0000",
    );
  });

  test("RGB to HSV reads hue, saturation and brightness", () => {
    expect(rgbToHsv({ red: 255, green: 0, blue: 0 })).toEqual({
      h: 0,
      s: 1,
      v: 1,
    });

    const grey: Hsv = rgbToHsv({ red: 128, green: 128, blue: 128 });

    expect(grey.s).toBe(0);
    expect(grey.v).toBeCloseTo(128 / 255);
  });

  test("a grey keeps the hue it was given, so the hue strip stays put", () => {
    expect(colorToHsv("#808080", 200)?.h).toBe(200);
    expect(colorToHsv("#000000", 33)?.h).toBe(33);
    // A colored one has its own.
    expect(colorToHsv("#ff0000", 200)?.h).toBe(0);
    // Nothing to read.
    expect(colorToHsv("not a color")).toBeNull();
  });
});

describe("pointing at the square and the strip", () => {
  test("the square: left to right is grey to color, top to bottom bright to black", () => {
    expect(getSaturationAtPoint({ x: 100, y: 50, box: BOX })).toEqual({
      s: 0,
      v: 1,
    });
    expect(getSaturationAtPoint({ x: 300, y: 150, box: BOX })).toEqual({
      s: 1,
      v: 0,
    });
    expect(getSaturationAtPoint({ x: 200, y: 100, box: BOX })).toEqual({
      s: 0.5,
      v: 0.5,
    });
  });

  test("a drag that overshoots is held to the edge it passed", () => {
    expect(getSaturationAtPoint({ x: 900, y: -400, box: BOX })).toEqual({
      s: 1,
      v: 1,
    });
    expect(getSaturationAtPoint({ x: -50, y: 900, box: BOX })).toEqual({
      s: 0,
      v: 0,
    });
  });

  test("the strip runs round the wheel left to right, and holds to its ends", () => {
    expect(getHueAtPoint({ x: 100, box: BOX })).toBe(0);
    expect(getHueAtPoint({ x: 300, box: BOX })).toBe(359);
    expect(getHueAtPoint({ x: 200, box: BOX })).toBeCloseTo(179.5);
    expect(getHueAtPoint({ x: -999, box: BOX })).toBe(0);
    expect(getHueAtPoint({ x: 9999, box: BOX })).toBe(359);
  });

  test("a square or strip not laid out yet reads nothing", () => {
    const empty: PointerBox = { left: 0, top: 0, width: 0, height: 0 };

    expect(getSaturationAtPoint({ x: 0, y: 0, box: empty })).toBeNull();
    expect(getHueAtPoint({ x: 0, box: empty })).toBeNull();
  });
});

describe("the keys of the square and the strip", () => {
  const MIDDLE: Hsv = { h: 180, s: 0.5, v: 0.5 };

  test.each([
    ["ArrowRight", false, { s: 0.5 + SATURATION_STEP }],
    ["ArrowLeft", false, { s: 0.5 - SATURATION_STEP }],
    ["ArrowUp", false, { v: 0.5 + SATURATION_STEP }],
    ["ArrowDown", false, { v: 0.5 - SATURATION_STEP }],
    ["ArrowRight", true, { s: 0.5 + SATURATION_BIG_STEP }],
    ["ArrowDown", true, { v: 0.5 - SATURATION_BIG_STEP }],
    ["PageUp", false, { v: 0.5 + SATURATION_BIG_STEP }],
    ["PageDown", false, { v: 0.5 - SATURATION_BIG_STEP }],
    ["Home", false, { s: 0 }],
    ["End", false, { s: 1 }],
  ] as Array<[string, boolean, Partial<Hsv>]>)(
    "the square: %s (Shift %s)",
    (key: string, shiftKey: boolean, change: Partial<Hsv>) => {
      const next: Hsv | null = moveSaturationByKey({
        hsv: MIDDLE,
        key,
        shiftKey,
      });

      expect(next).not.toBeNull();
      expect(next!.h).toBe(180);

      for (const [axis, value] of Object.entries(change)) {
        expect(next![axis as keyof Hsv]).toBeCloseTo(value as number);
      }
    },
  );

  test("the square stops at its edges", () => {
    expect(
      moveSaturationByKey({
        hsv: { h: 0, s: 1, v: 1 },
        key: "ArrowRight",
        shiftKey: true,
      }),
    ).toEqual({ h: 0, s: 1, v: 1 });
    expect(
      moveSaturationByKey({
        hsv: { h: 0, s: 0, v: 0 },
        key: "ArrowDown",
        shiftKey: false,
      }),
    ).toEqual({ h: 0, s: 0, v: 0 });
  });

  test.each([
    ["ArrowRight", false, 180 + HUE_STEP],
    ["ArrowUp", false, 180 + HUE_STEP],
    ["ArrowLeft", false, 180 - HUE_STEP],
    ["ArrowDown", false, 180 - HUE_STEP],
    ["ArrowRight", true, 180 + HUE_BIG_STEP],
    ["PageUp", false, 180 + HUE_BIG_STEP],
    ["PageDown", false, 180 - HUE_BIG_STEP],
    ["Home", false, 0],
    ["End", false, 359],
  ] as Array<[string, boolean, number]>)(
    "the strip: %s (Shift %s) goes to %i",
    (key: string, shiftKey: boolean, hue: number) => {
      expect(moveHueByKey({ hue: 180, key, shiftKey })).toBe(hue);
    },
  );

  test("the strip stops at its ends", () => {
    expect(moveHueByKey({ hue: 359, key: "ArrowRight", shiftKey: true })).toBe(
      359,
    );
    expect(moveHueByKey({ hue: 0, key: "ArrowLeft", shiftKey: false })).toBe(
      0,
    );
  });

  test("keys they do not use are left to the page", () => {
    expect(
      moveSaturationByKey({ hsv: MIDDLE, key: "Tab", shiftKey: false }),
    ).toBeNull();
    expect(moveSaturationByKey({ hsv: MIDDLE, key: "a", shiftKey: false })).toBeNull();
    expect(moveHueByKey({ hue: 10, key: "Enter", shiftKey: false })).toBeNull();
  });
});
