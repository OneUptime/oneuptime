import { describe, expect, test } from "@jest/globals";
import Color, { RGB } from "../../../../Types/Color";
import {
  Black,
  Green,
  Red,
  Yellow,
  Moroon500,
} from "../../../../Types/BrandColors";
import {
  getUptimeDayToneProps,
  INCIDENT_MARK_COLOR,
  UptimeDayToneProps,
} from "../../../../UI/Components/Graphs/UptimeDayEventTone";
import {
  getPillColors,
  PillColors,
} from "../../../../UI/Components/Pill/PillColors";
import {
  composite,
  getContrastRatio,
  parseColor,
} from "../../../../Utils/ColorContrast";
import { MAINTENANCE_MARK_COLOR } from "../../../../Utils/StatusPage/HistoryChartBarColors";
import { DARK_THEME_CARD } from "../../../../Utils/StatusPage/StatusColorsOnDark";

/*
 * Contract under test - the colours the uptime history's tooltip and day
 * dialog name a day's events in (issue #5236's UI review).
 *
 * A state's or a severity's name used to be written in the project's own
 * colour on a wash of it. The colours a new project starts with are light:
 * a maintenance event in progress ("Ongoing", #ffbf53) read at 1.5:1, a
 * resolved incident (#2ab57d) at 2.3:1, the maintenance blue's count at
 * 3.2:1 - all under WCAG's 4.5:1 for text this small. They are the Pill's
 * tones now: a deeper shade of the colour on its wash, in both themes.
 */

const WHITE: RGB = { red: 255, green: 255, blue: 255 };

// A wash as the tone writes it, "rgba(r, g, b, a)", over a surface.
const RGBA_PATTERN: RegExp =
  /^rgba\((\d{1,3}), (\d{1,3}), (\d{1,3}), ([\d.]{1,8})\)$/;

function washOver(wash: string, surface: RGB): RGB {
  const match: RegExpExecArray | null = RGBA_PATTERN.exec(wash);

  if (!match) {
    throw new Error(`Not a wash: ${wash}`);
  }

  return composite(
    {
      red: Number(match[1]),
      green: Number(match[2]),
      blue: Number(match[3]),
    },
    Number(match[4]),
    surface,
  );
}

function contrastOf(text: string, background: RGB): number {
  return getContrastRatio(parseColor(text)!, background);
}

/*
 * Every colour a new project's states and severities start with
 * (ProjectService), the two kinds' own colours, and a pale one a project
 * might pick.
 */
const COLORS: Array<[string, Color]> = [
  ["Scheduled (black)", Black],
  ["Ongoing / Acknowledged / Low (amber)", Yellow],
  ["Ended (grey)", new Color("#4A4A4A")],
  ["Completed / Resolved (green)", Green],
  ["Identified (red)", Red],
  ["High severity (maroon)", Moroon500],
  ["the maintenance blue", MAINTENANCE_MARK_COLOR],
  ["the incidents' red", INCIDENT_MARK_COLOR],
  ["a pale yellow", new Color("#fde047")],
];

describe("a day's event names read in any colour", () => {
  test.each(COLORS)(
    "%s: its text reads at 4.5:1 on its wash, on a light card",
    (_name: string, color: Color) => {
      const props: UptimeDayToneProps = getUptimeDayToneProps(color);

      expect(
        contrastOf(
          String(props.style.color),
          washOver(String(props.style.backgroundColor), WHITE),
        ),
      ).toBeGreaterThanOrEqual(4.5);
    },
  );

  test.each(COLORS)(
    "%s: and on a dark card, in the dark theme's own shade",
    (_name: string, color: Color) => {
      const props: UptimeDayToneProps = getUptimeDayToneProps(color);

      expect(
        contrastOf(
          String(props.style["--ou-pill-dark-text"]),
          washOver(String(props.style["--ou-pill-dark-bg"]), DARK_THEME_CARD),
        ),
      ).toBeGreaterThanOrEqual(4.5);
    },
  );

  test("the stock in-progress amber used to read at 1.5:1 as its own colour", () => {
    // What the tooltip drew before: the colour itself on a 12% wash of it.
    const amber: RGB = parseColor(Yellow)!;

    expect(getContrastRatio(amber, composite(amber, 0.12, WHITE))).toBeLessThan(
      2,
    );
  });
});

describe("the tones are the Pill's, without its ring", () => {
  test("the text and the wash are the Pill's, in both themes", () => {
    const tone: PillColors = getPillColors(Yellow);
    const props: UptimeDayToneProps = getUptimeDayToneProps(Yellow);

    expect(props.style.color).toBe(tone.light.textColor);
    expect(props.style.backgroundColor).toBe(tone.light.backgroundColor);
    expect(props.style["--ou-pill-dark-text"]).toBe(tone.dark.textColor);
    expect(props.style["--ou-pill-dark-bg"]).toBe(tone.dark.backgroundColor);
  });

  test("carries the attribute the dark theme's rule keys off", () => {
    // html.dark [data-ou-pill] in Theme.css swaps the dark shades in.
    expect(getUptimeDayToneProps(Green)).toHaveProperty("data-ou-pill", "");
  });

  test("draws no ring in either theme: these are chips and counts, not pills", () => {
    const props: UptimeDayToneProps = getUptimeDayToneProps(Green);

    expect(props.style.boxShadow).toBe("none");
    expect(props.style["--ou-pill-dark-shadow"]).toBe("none");
  });

  test("keeps the caller's own sizing", () => {
    const props: UptimeDayToneProps = getUptimeDayToneProps(Green, {
      fontSize: "9px",
      padding: "1px 5px",
    });

    expect(props.style.fontSize).toBe("9px");
    expect(props.style.padding).toBe("1px 5px");
  });

  test("a colour given as text tones the same as the Color", () => {
    expect(getUptimeDayToneProps("#2ab57d")).toEqual(
      getUptimeDayToneProps(Green),
    );
  });
});
