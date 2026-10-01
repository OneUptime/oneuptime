import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  TOGGLE_CHECK_CLASS,
  TOGGLE_KNOB_OFF_CLASS,
  TOGGLE_KNOB_ON_CLASS,
  TOGGLE_TRACK_BASE_CLASS,
  TOGGLE_TRACK_DISABLED_CLASS,
  TOGGLE_TRACK_ENABLED_CLASS,
  TOGGLE_TRACK_OFF_CLASS,
  TOGGLE_TRACK_OFF_HOVER_CLASS,
  TOGGLE_TRACK_ON_CLASS,
  TOGGLE_TRACK_ON_HOVER_CLASS,
} from "../../../UI/Components/Toggle/Toggle";
import { declaredValue, THEME_RULES, StyleRule } from "./ThemeStylesheet";

/*
 * The switch, held to WCAG 1.4.11 in both themes.
 *
 * What the maintainer reported: "a small, very pale grey switch in the off
 * state that barely shows against the white background". It was a gray-200
 * track (1.2:1 on white) with a white knob (1.2:1 on the track). Non-text
 * contrast asks 3:1 for what identifies a control and its state: here the
 * track's edge against the page, and the knob against the track.
 *
 * The light colours are Tailwind's palette, looked up from the classes the
 * component exports; the dark ones are read from the [data-ou-toggle-*] rules
 * in Theme.css. A class added to the switch without an entry in either table
 * fails here first, which is the point: someone has to say what it is on a
 * dark card before it ships.
 */

// Tailwind v3's palette, for the classes the switch is drawn with.
const LIGHT_PALETTE: Record<string, string> = {
  white: "#ffffff",
  "gray-50": "#f9fafb",
  "gray-200": "#e5e7eb",
  "gray-500": "#6b7280",
  "gray-700": "#374151",
  "indigo-600": "#4f46e5",
  "indigo-700": "#4338ca",
};

// Where a switch sits: a card or modal, and a gray-50 panel or page.
const LIGHT_SURFACES: Record<string, string> = {
  "a white card": LIGHT_PALETTE["white"]!,
  "a gray-50 panel": LIGHT_PALETTE["gray-50"]!,
};

function themeVariable(name: string): string {
  const value: string | undefined = declaredValue("html.dark", name);

  if (!value) {
    throw new Error(`Theme.css declares no ${name} for html.dark`);
  }

  return value;
}

const DARK_SURFACES: Record<string, string> = {
  "a dark card": themeVariable("--ou-surface-primary"),
  "a dark panel": themeVariable("--ou-surface-secondary"),
};

function channel(value: number): number {
  const srgb: number = value / 255;

  return srgb <= 0.04045 ? srgb / 12.92 : Math.pow((srgb + 0.055) / 1.055, 2.4);
}

function luminance(hex: string): number {
  const match: RegExpMatchArray | null = hex
    .trim()
    .match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);

  if (!match) {
    throw new Error(`Not a #rrggbb colour: ${hex}`);
  }

  return (
    0.2126 * channel(parseInt(match[1]!, 16)) +
    0.7152 * channel(parseInt(match[2]!, 16)) +
    0.0722 * channel(parseInt(match[3]!, 16))
  );
}

function contrast(first: string, second: string): number {
  const a: number = luminance(first);
  const b: number = luminance(second);

  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/*
 * Specificity (ids, classes, types) of the plain selectors this suite
 * compares. :is() counts as its most specific argument, and every argument
 * of the theme's :is() lists is a single class or attribute.
 */
function specificity(selector: string): [number, number, number] {
  const flattened: string = selector.replace(/:is\([^)]*\)/g, ".is-argument");
  const ids: number = (flattened.match(/#[\w-]+/g) || []).length;
  const classes: number = (
    flattened.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) || []
  ).length;
  const types: number = (
    flattened
      .replace(/\[[^\]]+\]/g, " ")
      .replace(/[.:#][\w-]+/g, " ")
      .match(/[a-z][\w-]*/gi) || []
  ).length;

  return [ids, classes, types];
}

function compareSpecificity(
  first: [number, number, number],
  second: [number, number, number],
): number {
  for (let i: number = 0; i < 3; i++) {
    if (first[i]! !== second[i]!) {
      return first[i]! > second[i]! ? 1 : -1;
    }
  }

  return 0;
}

function tokens(classList: string): Array<string> {
  return classList.split(/\s+/).filter((token: string): boolean => {
    return token.length > 0;
  });
}

/*
 * The colour a class list gives one property, from the light palette:
 * ("border-gray-500 bg-white", "border") -> #6b7280.
 */
function lightColour(classList: string, utility: string): string {
  const prefix: string = `${utility}-`;
  const token: string | undefined = tokens(classList).find(
    (candidate: string): boolean => {
      return candidate.startsWith(prefix) && !candidate.includes(":");
    },
  );

  if (!token) {
    throw new Error(`No ${utility}- colour in "${classList}"`);
  }

  const colour: string | undefined = LIGHT_PALETTE[token.slice(prefix.length)];

  if (!colour) {
    throw new Error(
      `${token} has no entry in this suite's palette: add it, with its hex, and check it against the surfaces below`,
    );
  }

  return colour;
}

// The value a dark rule sets, by its exact selector.
function darkDeclaration(selector: string, property: string): string {
  const value: string | undefined = declaredValue(selector, property);

  if (!value) {
    throw new Error(`Theme.css has no "${property}" for ${selector}`);
  }

  return value.replace(/\s*!important$/, "");
}

const DARK = {
  offOutline: darkDeclaration(
    "html.dark [data-ou-toggle-track].border-gray-500",
    "border-color",
  ),
  offKnob: darkDeclaration(
    "html.dark [data-ou-toggle-knob].bg-gray-500",
    "background-color",
  ),
  onTrack: darkDeclaration(
    "html.dark [data-ou-toggle-track].bg-indigo-600",
    "background-color",
  ),
  onTrackBorder: darkDeclaration(
    "html.dark [data-ou-toggle-track].bg-indigo-600",
    "border-color",
  ),
  onKnob: darkDeclaration(
    "html.dark [data-ou-toggle-knob].bg-white",
    "background-color",
  ),
  check: darkDeclaration(
    "html.dark [data-ou-toggle-knob] .text-indigo-600",
    "color",
  ),
};

describe("the switch in the light theme", () => {
  test("the old off state is what failed: a gray-200 pill and a white knob", () => {
    const oldTrack: string = LIGHT_PALETTE["gray-200"]!;

    expect(contrast(oldTrack, LIGHT_PALETTE["white"]!)).toBeLessThan(1.5);
    expect(contrast(LIGHT_PALETTE["white"]!, oldTrack)).toBeLessThan(1.5);
  });

  test.each(Object.entries(LIGHT_SURFACES))(
    "off: the outline stands out on %s",
    (_name: string, surface: string) => {
      expect(
        contrast(lightColour(TOGGLE_TRACK_OFF_CLASS, "border"), surface),
      ).toBeGreaterThanOrEqual(3);
    },
  );

  test("off: the knob stands out on its track", () => {
    expect(
      contrast(
        lightColour(TOGGLE_KNOB_OFF_CLASS, "bg"),
        lightColour(TOGGLE_TRACK_OFF_CLASS, "bg"),
      ),
    ).toBeGreaterThanOrEqual(3);
  });

  test.each(Object.entries(LIGHT_SURFACES))(
    "on: the filled track stands out on %s",
    (_name: string, surface: string) => {
      expect(
        contrast(lightColour(TOGGLE_TRACK_ON_CLASS, "bg"), surface),
      ).toBeGreaterThanOrEqual(3);
    },
  );

  test("on: the knob stands out on the track, and the tick on the knob", () => {
    const track: string = lightColour(TOGGLE_TRACK_ON_CLASS, "bg");
    const knob: string = lightColour(TOGGLE_KNOB_ON_CLASS, "bg");

    expect(contrast(knob, track)).toBeGreaterThanOrEqual(3);
    expect(
      contrast(lightColour(TOGGLE_CHECK_CLASS, "text"), knob),
    ).toBeGreaterThanOrEqual(3);
  });

  test("on: the outline is the fill, so the track is one solid shape", () => {
    expect(lightColour(TOGGLE_TRACK_ON_CLASS, "border")).toBe(
      lightColour(TOGGLE_TRACK_ON_CLASS, "bg"),
    );
  });

  test("hover deepens each state rather than fading it", () => {
    const offHover: string =
      LIGHT_PALETTE[
        tokens(TOGGLE_TRACK_OFF_HOVER_CLASS)[0]!.replace("hover:border-", "")
      ]!;
    const onHover: string =
      LIGHT_PALETTE[
        tokens(TOGGLE_TRACK_ON_HOVER_CLASS)
          .find((token: string): boolean => {
            return token.startsWith("hover:bg-");
          })!
          .replace("hover:bg-", "")
      ]!;

    expect(contrast(offHover, LIGHT_PALETTE["white"]!)).toBeGreaterThan(
      contrast(lightColour(TOGGLE_TRACK_OFF_CLASS, "border"), "#ffffff"),
    );
    expect(contrast(onHover, LIGHT_PALETTE["white"]!)).toBeGreaterThan(
      contrast(lightColour(TOGGLE_TRACK_ON_CLASS, "bg"), "#ffffff"),
    );
  });

  test("the keyboard focus ring is the brand indigo, offset from the track", () => {
    expect(tokens(TOGGLE_TRACK_BASE_CLASS)).toEqual(
      expect.arrayContaining([
        "focus-visible:ring-2",
        "focus-visible:ring-indigo-600",
        "focus-visible:ring-offset-2",
      ]),
    );
    expect(
      contrast(LIGHT_PALETTE["indigo-600"]!, LIGHT_PALETTE["white"]!),
    ).toBeGreaterThanOrEqual(3);
  });

  test("disabled is dimmed and refuses the pointer; enabled invites it", () => {
    expect(tokens(TOGGLE_TRACK_DISABLED_CLASS)).toEqual(
      expect.arrayContaining(["opacity-50", "cursor-not-allowed"]),
    );
    expect(tokens(TOGGLE_TRACK_ENABLED_CLASS)).toEqual(["cursor-pointer"]);
  });
});

describe("the switch in the dark theme", () => {
  test.each(Object.entries(DARK_SURFACES))(
    "off: the outline stands out on %s",
    (_name: string, surface: string) => {
      expect(contrast(DARK.offOutline, surface)).toBeGreaterThanOrEqual(3);
    },
  );

  // The off track is .bg-white, which the dark theme makes the card itself.
  test.each(Object.entries(DARK_SURFACES))(
    "off: the knob stands out on the track, drawn on %s",
    (_name: string, surface: string) => {
      expect(contrast(DARK.offKnob, surface)).toBeGreaterThanOrEqual(3);
    },
  );

  test.each(Object.entries(DARK_SURFACES))(
    "on: the filled track stands out on %s",
    (_name: string, surface: string) => {
      expect(contrast(DARK.onTrack, surface)).toBeGreaterThanOrEqual(3);
    },
  );

  test("on: the knob stands out on the track, and the tick on the knob", () => {
    expect(contrast(DARK.onKnob, DARK.onTrack)).toBeGreaterThanOrEqual(3);
    expect(contrast(DARK.check, DARK.onKnob)).toBeGreaterThanOrEqual(3);
  });

  test("on: the outline is the fill here too", () => {
    expect(DARK.onTrackBorder).toBe(DARK.onTrack);
  });

  /*
   * Without these the light classes would carry into the dark theme: the
   * brand indigo-600 is 2.6:1 on a dark card, and gray-500 only 3.0:1 on a
   * dark panel.
   */
  test("the light colours would not have been enough", () => {
    expect(
      contrast(LIGHT_PALETTE["indigo-600"]!, DARK_SURFACES["a dark card"]!),
    ).toBeLessThan(3);
    expect(
      contrast(LIGHT_PALETTE["gray-500"]!, DARK_SURFACES["a dark panel"]!),
    ).toBeLessThan(3.1);
    expect(contrast(DARK.offOutline, DARK_SURFACES["a dark panel"]!))
      .toBeGreaterThan(
        contrast(LIGHT_PALETTE["gray-500"]!, DARK_SURFACES["a dark panel"]!),
      );
  });

  test("each hover has a dark colour of its own", () => {
    expect(
      darkDeclaration(
        'html.dark [data-ou-toggle-track][class~="hover:border-gray-700"]:hover',
        "border-color",
      ),
    ).toBeDefined();
    expect(
      darkDeclaration(
        'html.dark [data-ou-toggle-track][class~="hover:bg-indigo-700"]:hover',
        "background-color",
      ),
    ).toBeDefined();
  });

  /*
   * The tick's rule must beat the theme's general light-indigo text rule,
   * which would put a pale tick on a pale knob: more specific, so it wins
   * whatever the order of the two in the sheet.
   */
  test("the tick's colour wins over the dark theme's general indigo text", () => {
    // ThemeStylesheet splits a prelude on every comma, :is() lists included.
    const general: StyleRule | undefined = THEME_RULES.find(
      (rule: StyleRule): boolean => {
        return (
          rule.selectors[0]!.startsWith("html.dark :is(") &&
          rule.selectors.includes(".text-indigo-600")
        );
      },
    );

    expect(general).toBeDefined();
    expect(general!.declarations["color"]).not.toBe(DARK.check);
    expect(
      contrast(general!.declarations["color"]!, DARK.onKnob),
    ).toBeLessThan(3);

    const generalSpecificity: [number, number, number] = specificity(
      general!.selectors.join(", "),
    );
    const tickSpecificity: [number, number, number] = specificity(
      "html.dark [data-ou-toggle-knob] .text-indigo-600",
    );

    expect(compareSpecificity(tickSpecificity, generalSpecificity)).toBe(1);
  });

  test("the hooks those rules hang on are the ones the component renders", () => {
    const toggleSource: string = fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "..",
        "UI",
        "Components",
        "Toggle",
        "Toggle.tsx",
      ),
      "utf8",
    );

    for (const attribute of [
      "data-ou-toggle-track",
      "data-ou-toggle-knob",
      "data-ou-toggle-check",
    ]) {
      expect({ attribute, rendered: toggleSource.includes(`${attribute}=""`) })
        .toEqual({ attribute, rendered: true });
    }
  });
});
