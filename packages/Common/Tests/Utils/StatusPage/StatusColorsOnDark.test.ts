/**
 * Status colours on the dark theme's card (Utils/StatusPage/StatusColorsOnDark).
 *
 * The colours people pick are made for a light page. On the dark card the
 * darkest of them all but vanish - the recommended rules' very dark red is
 * 1.6:1 against it - so the dark theme moves only the ones that do not
 * read, and keeps their hue:
 *
 *   - text in a status colour reaches WCAG AA, 4.5:1, against the card;
 *   - an uptime bar keeps its colour, and one under WCAG's 3:1 for graphical
 *     objects gets an edge in a lighter shade of itself that reaches it.
 *
 * Every number here is measured with the same WCAG 2 arithmetic the
 * colours are worked out with (Utils/ColorContrast).
 */

import { Moroon500, Red, Yellow, Green } from "../../../Types/BrandColors";
import Color, { RGB } from "../../../Types/Color";
import { getContrastRatio, parseColor } from "../../../Utils/ColorContrast";
import {
  DARK_THEME_CARD,
  DARK_THEME_PAGE,
  STATUS_TEXT_MINIMUM_CONTRAST,
  UPTIME_BAR_MINIMUM_CONTRAST,
  getStatusTextColorOnDark,
  getUptimeBarEdgeOnDark,
} from "../../../Utils/StatusPage/StatusColorsOnDark";
import {
  NO_DATA_BAR_COLOR,
  RECOMMENDED_HISTORY_CHART_BAR_COLOR_RULES,
} from "../../../Utils/StatusPage/HistoryChartBarColors";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

const rgb: (color: string) => RGB = (color: string): RGB => {
  const parsed: RGB | null = parseColor(color);

  if (!parsed) {
    throw new Error(`Not a colour: ${color}`);
  }

  return parsed;
};

const contrastOnCard: (color: string) => number = (color: string): number => {
  return getContrastRatio(rgb(color), DARK_THEME_CARD);
};

// The hue of a colour, in degrees, for colours that have one.
const hueOf: (color: RGB) => number = (color: RGB): number => {
  const red: number = color.red / 255;
  const green: number = color.green / 255;
  const blue: number = color.blue / 255;
  const max: number = Math.max(red, green, blue);
  const min: number = Math.min(red, green, blue);
  const delta: number = max - min;

  if (delta === 0) {
    return 0;
  }

  let hue: number;

  if (max === red) {
    hue = ((green - blue) / delta) % 6;
  } else if (max === green) {
    hue = (blue - red) / delta + 2;
  } else {
    hue = (red - green) / delta + 4;
  }

  return (hue * 60 + 360) % 360;
};

const hueDistance: (first: number, second: number) => number = (
  first: number,
  second: number,
): number => {
  const distance: number = Math.abs(first - second) % 360;
  return Math.min(distance, 360 - distance);
};

// Every colour a fresh project's statuses, states and severities start with.
const PRODUCT_DEFAULTS: Array<[string, string]> = [
  ["Operational", Green.toString()],
  ["Degraded", Yellow.toString()],
  ["Offline", Red.toString()],
  ["Critical Incident", Moroon500.toString()],
];

describe("the dark card the colours are measured on", () => {
  test("is Theme.css's dark --ou-surface-primary, and the page under it its --ou-background-primary", () => {
    const themeCss: string = fs.readFileSync(
      path.resolve(__dirname, "../../../UI/Styles/Theme.css"),
      "utf8",
    );
    const darkBlock: string = themeCss.slice(
      themeCss.indexOf("html.dark {"),
      themeCss.indexOf("}", themeCss.indexOf("html.dark {")),
    );

    expect(darkBlock).toContain("--ou-surface-primary: #172033;");
    expect(darkBlock).toContain("--ou-background-primary: #0f172a;");
    expect(DARK_THEME_CARD).toEqual(rgb("#172033"));
    expect(DARK_THEME_PAGE).toEqual(rgb("#0f172a"));
  });

  test("the thresholds are WCAG's", () => {
    expect(STATUS_TEXT_MINIMUM_CONTRAST).toBe(4.5);
    expect(UPTIME_BAR_MINIMUM_CONTRAST).toBe(3);
  });
});

describe("text in a status colour on the dark theme", () => {
  test.each(PRODUCT_DEFAULTS)(
    "%s (%s) reads at 4.5:1 on the dark card and on the page",
    (_name: string, color: string) => {
      const dark: string = getStatusTextColorOnDark(color)!;

      expect(contrastOnCard(dark)).toBeGreaterThanOrEqual(4.5);
      expect(getContrastRatio(rgb(dark), DARK_THEME_PAGE)).toBeGreaterThan(4.5);
    },
  );

  test("a colour that already reads is kept exactly as it was picked", () => {
    for (const color of ["#2ab57d", "#ffbf53", "#22c55e", "#fde047"]) {
      expect(contrastOnCard(color)).toBeGreaterThanOrEqual(4.5);
      expect(getStatusTextColorOnDark(color)).toBe(color);
    }
  });

  test("a colour that does not read is lightened, keeping its hue", () => {
    // The default Critical Incident colour: 2.4:1 on the dark card.
    const picked: string = Moroon500.toString();
    const dark: string = getStatusTextColorOnDark(picked)!;

    expect(contrastOnCard(picked)).toBeLessThan(4.5);
    expect(dark).not.toBe(picked);
    expect(contrastOnCard(dark)).toBeGreaterThanOrEqual(4.5);
    expect(hueDistance(hueOf(rgb(dark)), hueOf(rgb(picked)))).toBeLessThan(4);
  });

  test("hundreds of picked colours all read on the dark card, and the ones that read already are kept", () => {
    const random: SeededRandom = seededRandom(4521);

    for (let draw: number = 0; draw < 600; draw++) {
      const color: string = Color.rgbToColor({
        red: random(256),
        green: random(256),
        blue: random(256),
      }).toString();
      const dark: string = getStatusTextColorOnDark(color)!;

      expect([color, contrastOnCard(dark) >= 4.5]).toEqual([color, true]);

      if (contrastOnCard(color) >= 4.5) {
        expect(dark).toBe(color.toLowerCase());
      }
    }
  });

  test("every spelling of a colour gets the same shade", () => {
    expect(getStatusTextColorOnDark("#B70400")).toBe(
      getStatusTextColorOnDark("#b70400"),
    );
    expect(getStatusTextColorOnDark(new Color("#b70400"))).toBe(
      getStatusTextColorOnDark("#b70400"),
    );
    expect(getStatusTextColorOnDark("rgb(183, 4, 0)")).toBe(
      getStatusTextColorOnDark("#b70400"),
    );
  });

  test.each([null, undefined, "", "not a colour", "#12"])(
    "%p is not a colour: nothing to swap in",
    (value: string | null | undefined) => {
      expect(getStatusTextColorOnDark(value)).toBeNull();
    },
  );
});

describe("an uptime bar on the dark theme", () => {
  test("of the recommended rules, only the very dark red needs an edge", () => {
    const edges: Array<[string, string | null]> =
      RECOMMENDED_HISTORY_CHART_BAR_COLOR_RULES.map(
        (rule: { barColor: Color }): [string, string | null] => {
          const color: string = rule.barColor.toString();
          return [color, getUptimeBarEdgeOnDark(color)];
        },
      );

    expect(
      edges.map(([color, edge]: [string, string | null]) => {
        return [color, edge !== null];
      }),
    ).toEqual([
      ["#22c55e", false],
      ["#fde047", false],
      ["#c2410c", false],
      ["#7f1d1d", true],
    ]);
  });

  test("the very dark red's edge is a red that stands out from the card at 3:1", () => {
    const edge: string = getUptimeBarEdgeOnDark("#7f1d1d")!;

    expect(contrastOnCard("#7f1d1d")).toBeLessThan(2);
    expect(contrastOnCard(edge)).toBeGreaterThanOrEqual(3);
    expect(hueDistance(hueOf(rgb(edge)), hueOf(rgb("#7f1d1d")))).toBeLessThan(
      4,
    );
  });

  test("the edge is only as light as it must be, so the bar keeps its lightness among the others", () => {
    /*
     * The recommended colours are told apart by lightness, for people with
     * red-green colour blindness. The edge sits at the 3:1 boundary, not far
     * past it: well darker than the orange above it.
     */
    const edge: string = getUptimeBarEdgeOnDark("#7f1d1d")!;

    expect(contrastOnCard(edge)).toBeLessThan(3.2);
  });

  test("the no-data grey and the default bar colours need no edge", () => {
    for (const color of [
      NO_DATA_BAR_COLOR.toString(),
      Green.toString(),
      Yellow.toString(),
      Red.toString(),
    ]) {
      expect([color, getUptimeBarEdgeOnDark(color)]).toEqual([color, null]);
    }
  });

  test("every bar colour either stands out from the card, or gets an edge that does", () => {
    const random: SeededRandom = seededRandom(9137);

    for (let draw: number = 0; draw < 600; draw++) {
      const color: string = Color.rgbToColor({
        red: random(256),
        green: random(256),
        blue: random(256),
      }).toString();
      const edge: string | null = getUptimeBarEdgeOnDark(color);

      if (contrastOnCard(color) >= 3) {
        expect([color, edge]).toEqual([color, null]);
      } else {
        expect([color, edge !== null && contrastOnCard(edge) >= 3]).toEqual([
          color,
          true,
        ]);
      }
    }
  });

  test.each([null, undefined, "", "transparent-ish"])(
    "%p is not a colour: no edge",
    (value: string | null | undefined) => {
      expect(getUptimeBarEdgeOnDark(value)).toBeNull();
    },
  );
});
