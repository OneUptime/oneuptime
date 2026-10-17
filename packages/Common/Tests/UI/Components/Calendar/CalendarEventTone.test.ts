import { describe, expect, test } from "@jest/globals";
import {
  getOpaqueWash,
  getSoftEventStyle,
  SOFT_EVENT_DARK_BACKGROUND_PROPERTY,
  SOFT_EVENT_DARK_SHADOW_PROPERTY,
  SOFT_EVENT_DARK_TEXT_PROPERTY,
  SoftEventStyle,
} from "../../../../UI/Components/Calendar/CalendarEventTone";
import { getPillColors } from "../../../../UI/Components/Pill/PillColors";
import {
  getContrastRatio,
  getRelativeLuminance,
  parseColor,
} from "../../../../Utils/ColorContrast";
import { DARK_THEME_CARD } from "../../../../Utils/StatusPage/StatusColorsOnDark";
import { RGB } from "../../../../Types/Color";

/*
 * A soft calendar block (CalendarEventTone): the colours of a state drawn
 * the way a Pill draws them - a pale wash, a stripe of the colour and its
 * text in a deeper shade - for the light theme inline, for the dark theme as
 * custom properties Theme.css swaps in.
 *
 * The scheduled maintenance calendar draws its events this way because a
 * new project's Scheduled state is black: a month of solid black blocks was
 * mostly black, and on the dark theme a black block all but vanished.
 */

const WHITE: RGB = { red: 255, green: 255, blue: 255 };

const HEX_PATTERN: RegExp = /^#[0-9a-f]{6}$/;

function rgb(color: string | undefined): RGB {
  const parsed: RGB | null = parseColor(color);

  expect(parsed).not.toBeNull();

  return parsed!;
}

// The stripe: the first inset shadow, 3px wide, in a colour.
function stripeOf(shadow: string): string {
  const first: string = shadow.split(", inset")[0]!;

  expect(first.startsWith("inset 3px 0 0 ")).toBe(true);

  return first.slice("inset 3px 0 0 ".length);
}

describe("getOpaqueWash", () => {
  test("lays a see-through wash onto the surface, as one opaque colour", () => {
    // Half black over white is a middle grey.
    expect(getOpaqueWash("rgba(0, 0, 0, 0.5)", WHITE)).toBe("#808080");
    // A tenth of amber over white is a very pale amber.
    expect(getOpaqueWash("rgba(255, 191, 83, 0.1)", WHITE)).toBe("#fff9ee");
  });

  test("onto the dark theme's card, a wash stays dark", () => {
    const wash: RGB = rgb(getOpaqueWash("rgba(0, 0, 0, 0.2)", DARK_THEME_CARD));

    expect(getRelativeLuminance(wash)).toBeLessThan(
      getRelativeLuminance(DARK_THEME_CARD),
    );
  });

  test("an opaque colour comes back as it is", () => {
    expect(getOpaqueWash("#2AB57D", WHITE)).toBe("#2ab57d");
    expect(getOpaqueWash("rgb(42, 181, 125)", WHITE)).toBe("#2ab57d");
  });

  test("something that is not a colour is left alone", () => {
    expect(getOpaqueWash("not a colour", WHITE)).toBe("not a colour");
  });
});

describe("getSoftEventStyle", () => {
  // A new project's states (ProjectService): Scheduled, Ongoing, Ended, Completed.
  const STATES: Array<string> = ["#000000", "#ffbf53", "#4a4a4a", "#2ab57d"];

  test("every colour is drawn as a pill draws it: its wash, its text, its dot as the stripe", () => {
    for (const color of STATES) {
      const style: SoftEventStyle = getSoftEventStyle(color);
      const pill: ReturnType<typeof getPillColors> = getPillColors(color);

      expect(style.color).toBe(pill.light.textColor);
      expect(stripeOf(String(style.boxShadow))).toBe(pill.light.dotColor);
      expect(String(style.boxShadow)).toContain(
        `inset 0 0 0 1px ${pill.light.ringColor}`,
      );

      // The wash is opaque, so the grid's lines do not show through it.
      expect(String(style.backgroundColor)).toMatch(HEX_PATTERN);
      expect(String(style[SOFT_EVENT_DARK_BACKGROUND_PROPERTY])).toMatch(
        HEX_PATTERN,
      );
    }
  });

  test("a black state is a pale block with readable text, not a black one", () => {
    const style: SoftEventStyle = getSoftEventStyle("#000000");
    const background: RGB = rgb(String(style.backgroundColor));

    expect(getRelativeLuminance(background)).toBeGreaterThan(0.75);
    expect(
      getContrastRatio(rgb(String(style.color)), background),
    ).toBeGreaterThanOrEqual(4.5);
    // The stripe keeps the state's own colour on the light theme.
    expect(stripeOf(String(style.boxShadow))).toBe("#000000");
  });

  test("on the dark theme, a black state's text reads and its stripe shows", () => {
    const style: SoftEventStyle = getSoftEventStyle("#000000");
    const background: RGB = rgb(
      String(style[SOFT_EVENT_DARK_BACKGROUND_PROPERTY]),
    );

    expect(
      getContrastRatio(
        rgb(String(style[SOFT_EVENT_DARK_TEXT_PROPERTY])),
        background,
      ),
    ).toBeGreaterThanOrEqual(4.5);

    const darkStripe: RGB = rgb(
      stripeOf(String(style[SOFT_EVENT_DARK_SHADOW_PROPERTY])),
    );

    // Not black on a dark card: lightened until it stands out from it.
    expect(
      getContrastRatio(darkStripe, DARK_THEME_CARD),
    ).toBeGreaterThanOrEqual(3);
  });

  test("an amber state keeps its hue, with text dark enough to read on the wash", () => {
    const style: SoftEventStyle = getSoftEventStyle("#ffbf53");
    const background: RGB = rgb(String(style.backgroundColor));
    const text: RGB = rgb(String(style.color));

    expect(getContrastRatio(text, background)).toBeGreaterThanOrEqual(4.5);
    // Warmer than it is blue: still an amber.
    expect(background.red).toBeGreaterThan(background.blue);
    expect(text.red).toBeGreaterThan(text.blue);
  });

  test("a missing colour is drawn in the pill's grey, not left unpainted", () => {
    const style: SoftEventStyle = getSoftEventStyle(undefined);

    expect(String(style.backgroundColor)).toMatch(HEX_PATTERN);
    expect(String(style.color)).toMatch(HEX_PATTERN);
  });
});
