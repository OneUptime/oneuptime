import Color, { RGB } from "../../Types/Color";
import { Green, Red, Yellow } from "../../Types/BrandColors";
import { parseColor } from "../../Utils/ColorContrast";
import {
  COLOR_BLIND_DISTINCT_COLOR_DIFFERENCE,
  ColorVision,
  DISTINCT_COLOR_DIFFERENCE,
  JUST_NOTICEABLE_COLOR_DIFFERENCE,
  RED_GREEN_COLOR_VISIONS,
  getColorDifference,
  getRedGreenColorBlindDifference,
  looksAlikeWithRedGreenColorBlindness,
  simulateColorVision,
} from "../../Utils/ColorVision";
import { SeededRandom, seededRandom } from "../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * How colours look to colour-blind people, and how far apart two colours
 * look (Utils/ColorVision).
 *
 * The case this exists for is issue #486: the Operational green and Offline
 * red every project starts with are one colour to a deuteranope, so a status
 * page's uptime history read as a row of identical bars to them. These tests
 * pin the arithmetic that says so, and the one rule built on it.
 */

function rgb(hex: string): RGB {
  const parsed: RGB | null = parseColor(hex);

  expect([hex, parsed === null]).toEqual([hex, false]);

  return parsed!;
}

const VISIONS: Array<ColorVision> = [
  ColorVision.Full,
  ColorVision.Protanopia,
  ColorVision.Deuteranopia,
  ColorVision.Tritanopia,
];

function randomColor(random: SeededRandom): RGB {
  return { red: random(256), green: random(256), blue: random(256) };
}

describe("ColorVision stands on its own", () => {
  test("imports nothing from React or the UI, only colour arithmetic", () => {
    const source: string = fs.readFileSync(
      path.resolve(__dirname, "../../Utils/ColorVision.ts"),
      "utf8",
    );
    const imports: Array<string> = Array.from(
      source.matchAll(/from\s+"([^"]+)"/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    expect(imports).toEqual(["../Types/Color", "./ColorContrast"]);
  });

  test("red-green colour blindness is deuteranopia, the commonest kind, then protanopia", () => {
    expect(RED_GREEN_COLOR_VISIONS).toEqual([
      ColorVision.Deuteranopia,
      ColorVision.Protanopia,
    ]);
  });

  test("the bars: just noticeable < colour-blind distinct < distinct", () => {
    expect(JUST_NOTICEABLE_COLOR_DIFFERENCE).toBe(2);
    expect(COLOR_BLIND_DISTINCT_COLOR_DIFFERENCE).toBe(8);
    expect(DISTINCT_COLOR_DIFFERENCE).toBe(15);
  });
});

describe("simulateColorVision", () => {
  test("full colour vision sees every colour as it is", () => {
    const random: SeededRandom = seededRandom(486);

    for (let draw: number = 0; draw < 500; draw++) {
      const color: RGB = randomColor(random);

      expect(simulateColorVision(color, ColorVision.Full)).toEqual(color);
    }
  });

  test.each(VISIONS)(
    "%s: every colour comes out as one a screen can show",
    (vision: ColorVision) => {
      const random: SeededRandom = seededRandom(1486);

      for (let draw: number = 0; draw < 500; draw++) {
        const seen: RGB = simulateColorVision(randomColor(random), vision);

        for (const channel of [seen.red, seen.green, seen.blue]) {
          expect(Number.isInteger(channel)).toBe(true);
          expect(channel).toBeGreaterThanOrEqual(0);
          expect(channel).toBeLessThanOrEqual(255);
        }
      }
    },
  );

  test.each(VISIONS)("%s: greys stay grey", (vision: ColorVision) => {
    for (const grey of ["#000000", "#404040", "#808080", "#ffffff"]) {
      const original: RGB = rgb(grey);
      const seen: RGB = simulateColorVision(original, vision);

      // Within a step of rounding on each channel.
      expect(Math.abs(seen.red - original.red)).toBeLessThanOrEqual(1);
      expect(Math.abs(seen.green - original.green)).toBeLessThanOrEqual(1);
      expect(Math.abs(seen.blue - original.blue)).toBeLessThanOrEqual(1);
    }
  });

  test("red-green colour blindness draws a red and a green alike: neither keeps its hue", () => {
    const red: RGB = rgb(Red.toString());
    const green: RGB = rgb(Green.toString());

    for (const vision of RED_GREEN_COLOR_VISIONS) {
      const seenRed: RGB = simulateColorVision(red, vision);
      const seenGreen: RGB = simulateColorVision(green, vision);

      // Both land on the same yellow-to-blue axis: red and green no longer lead.
      expect(seenRed.red).toBeLessThan(red.red);
      expect(seenGreen.green).toBeLessThan(green.green);
      expect(Math.abs(seenRed.red - seenRed.green)).toBeLessThan(40);
      expect(Math.abs(seenGreen.red - seenGreen.green)).toBeLessThan(40);
    }
  });
});

describe("getColorDifference", () => {
  test.each(VISIONS)(
    "%s: a colour is no distance from itself, and the distance is the same both ways",
    (vision: ColorVision) => {
      const random: SeededRandom = seededRandom(2486);

      for (let draw: number = 0; draw < 300; draw++) {
        const first: RGB = randomColor(random);
        const second: RGB = randomColor(random);

        expect(getColorDifference(first, first, vision)).toBe(0);

        const there: number = getColorDifference(first, second, vision);
        const back: number = getColorDifference(second, first, vision);

        expect(there).toBeGreaterThanOrEqual(0);
        expect(there).toBeCloseTo(back, 10);
      }
    },
  );

  test("black and white are 100 apart, whoever looks", () => {
    for (const vision of VISIONS) {
      expect(
        getColorDifference(rgb("#000000"), rgb("#ffffff"), vision),
      ).toBeCloseTo(100, 1);
    }
  });

  test("full colour vision is the default", () => {
    const first: RGB = rgb("#2ab57d");
    const second: RGB = rgb("#fd625e");

    expect(getColorDifference(first, second)).toBe(
      getColorDifference(first, second, ColorVision.Full),
    );
  });

  test("two shades a step apart are below what anyone notices", () => {
    expect(getColorDifference(rgb("#22c55e"), rgb("#22c55f"))).toBeLessThan(
      JUST_NOTICEABLE_COLOR_DIFFERENCE,
    );
  });

  /*
   * Issue #486, in numbers: the statuses' green and red are as far apart as
   * a red and a green can usefully be for most people, and one colour for a
   * deuteranope.
   */
  test("the default Operational green and Offline red: 31 apart, and 6 to a deuteranope", () => {
    const operational: RGB = rgb(Green.toString());
    const offline: RGB = rgb(Red.toString());

    expect(getColorDifference(operational, offline)).toBeCloseTo(30.9, 1);
    expect(
      getColorDifference(operational, offline, ColorVision.Deuteranopia),
    ).toBeCloseTo(6.1, 1);
    expect(
      getColorDifference(operational, offline, ColorVision.Protanopia),
    ).toBeCloseTo(12.5, 1);
    // Tritanopia leaves red and green apart.
    expect(
      getColorDifference(operational, offline, ColorVision.Tritanopia),
    ).toBeGreaterThan(DISTINCT_COLOR_DIFFERENCE);
  });

  test("tritanopia pulls a blue and a green of one lightness together instead", () => {
    const blue: RGB = rgb("#2563eb");
    const green: RGB = rgb("#16a34a");

    expect(getColorDifference(blue, green)).toBeGreaterThan(30);
    expect(
      getColorDifference(blue, green, ColorVision.Tritanopia),
    ).toBeLessThan(10);

    for (const vision of RED_GREEN_COLOR_VISIONS) {
      expect(getColorDifference(blue, green, vision)).toBeGreaterThan(30);
    }
  });

  test("the no-data grey is as close to the green as the red is, for a deuteranope", () => {
    const grey: RGB = rgb("#9ca3af");

    expect(
      getColorDifference(grey, rgb(Green.toString()), ColorVision.Deuteranopia),
    ).toBeLessThan(COLOR_BLIND_DISTINCT_COLOR_DIFFERENCE);
  });
});

describe("getRedGreenColorBlindDifference", () => {
  test("is the closer of protanopia and deuteranopia", () => {
    const random: SeededRandom = seededRandom(3486);

    for (let draw: number = 0; draw < 300; draw++) {
      const first: RGB = randomColor(random);
      const second: RGB = randomColor(random);

      expect(getRedGreenColorBlindDifference(first, second)).toBe(
        Math.min(
          getColorDifference(first, second, ColorVision.Protanopia),
          getColorDifference(first, second, ColorVision.Deuteranopia),
        ),
      );
    }
  });

  test("ignores tritanopia: a blue and a green it pulls together stay apart", () => {
    expect(
      getRedGreenColorBlindDifference(rgb("#2563eb"), rgb("#16a34a")),
    ).toBeGreaterThan(30);
  });
});

describe("looksAlikeWithRedGreenColorBlindness", () => {
  test("the default Operational green and Offline red do", () => {
    expect(looksAlikeWithRedGreenColorBlindness(Green, Red)).toBe(true);
    expect(looksAlikeWithRedGreenColorBlindness(Red, Green)).toBe(true);
  });

  test("the default Operational green and Degraded yellow do not", () => {
    expect(looksAlikeWithRedGreenColorBlindness(Green, Yellow)).toBe(false);
  });

  test("reads colours however they are written", () => {
    expect(looksAlikeWithRedGreenColorBlindness("#2AB57D", "#FD625E")).toBe(
      true,
    );
    expect(
      looksAlikeWithRedGreenColorBlindness(
        new Color("#2ab57d"),
        "rgb(253, 98, 94)",
      ),
    ).toBe(true);
    expect(looksAlikeWithRedGreenColorBlindness("#fff", "#000")).toBe(false);
  });

  test("a colour and itself, or a shade of it, do not: they look alike to everyone", () => {
    expect(looksAlikeWithRedGreenColorBlindness(Green, Green)).toBe(false);
    expect(looksAlikeWithRedGreenColorBlindness("#22c55e", "#22c55f")).toBe(
      false,
    );
    expect(looksAlikeWithRedGreenColorBlindness("#22c55e", "#16a34a")).toBe(
      false,
    );
  });

  test("black and white, and colours apart in lightness, do not", () => {
    expect(looksAlikeWithRedGreenColorBlindness("#000000", "#ffffff")).toBe(
      false,
    );
    // A light green and a very dark red: lightness tells them apart.
    expect(looksAlikeWithRedGreenColorBlindness("#22c55e", "#7f1d1d")).toBe(
      false,
    );
  });

  test.each([
    [null, "#22c55e"],
    ["#22c55e", undefined],
    ["", "#22c55e"],
    ["not a colour", "#22c55e"],
    ["#12345", "#22c55e"],
  ] as Array<[string | null | undefined, string | null | undefined]>)(
    "anything that is not a colour never does (%s, %s)",
    (first: string | null | undefined, second: string | null | undefined) => {
      expect(looksAlikeWithRedGreenColorBlindness(first, second)).toBe(false);
      expect(looksAlikeWithRedGreenColorBlindness(second, first)).toBe(false);
    },
  );

  test("is the same both ways round", () => {
    const random: SeededRandom = seededRandom(4486);

    const toHex: (color: RGB) => string = (color: RGB): string => {
      return Color.rgbToColor(color).toString();
    };

    for (let draw: number = 0; draw < 300; draw++) {
      const first: string = toHex(randomColor(random));
      const second: string = toHex(randomColor(random));

      expect(looksAlikeWithRedGreenColorBlindness(first, second)).toBe(
        looksAlikeWithRedGreenColorBlindness(second, first),
      );
    }
  });
});
