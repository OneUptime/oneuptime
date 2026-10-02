import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  TOGGLE_KNOB_BASE_CLASS,
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
 * The switch's colours, in both themes.
 *
 * The maintainer, looking at the outlined switch (a white pill inside a
 * gray-500 outline with a dark dot for a knob): "make it just like how the
 * rest of oneuptime looks like". It is the classic filled switch again: a
 * grey track and a white knob when off, the brand indigo when on.
 *
 * A light grey track cannot reach WCAG 1.4.11's 3:1 against a white form -
 * only an outline or a dark fill can, and those are what was turned down.
 * So each theme carries the state with what does reach it:
 *
 *   Light - the track's fill. On is indigo-600, 3:1 and more against the
 *           page, the knob and the off grey: on and off differ in
 *           lightness, never by hue alone. Off is gray-300, the grey of
 *           every input's edge, a step darker than the gray-200 pill that
 *           disappeared on a white modal.
 *   Dark  - the knob's side. The near-white knob is 3:1 and more against
 *           both tracks, as is the on track against the card.
 *
 * The light colours are Tailwind's palette, looked up from the classes the
 * component exports; the dark ones are read from the [data-ou-toggle-*]
 * rules in Theme.css. A class added to the switch without an entry in either
 * table fails here first, which is the point: someone has to say what it is
 * on a dark card before it ships.
 */

// Tailwind v3's palette, for the classes the switch is drawn with.
const LIGHT_PALETTE: Record<string, string> = {
  white: "#ffffff",
  "gray-50": "#f9fafb",
  "gray-200": "#e5e7eb",
  "gray-300": "#d1d5db",
  "gray-400": "#9ca3af",
  "gray-500": "#6b7280",
  "indigo-500": "#6366f1",
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

// A dark value as a colour: var(--ou-border-default) -> #475569.
function resolveDark(value: string): string {
  const variable: RegExpMatchArray | null = value.match(/^var\((--[\w-]+)\)$/);

  return variable ? themeVariable(variable[1]!) : value;
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

// Any border class, plain or on hover.
const BORDER_CLASS: RegExp = /^(?:hover:)?border-/;

function tokens(classList: string): Array<string> {
  return classList.split(/\s+/).filter((token: string): boolean => {
    return token.length > 0;
  });
}

// The one plain (no variant) class of a utility: ("bg-gray-300", "bg").
function lightToken(classList: string, utility: string): string {
  const prefix: string = `${utility}-`;
  const token: string | undefined = tokens(classList).find(
    (candidate: string): boolean => {
      return candidate.startsWith(prefix) && !candidate.includes(":");
    },
  );

  if (!token) {
    throw new Error(`No ${utility}- colour in "${classList}"`);
  }

  return token;
}

/*
 * The colour a class list gives one property, from the light palette:
 * ("bg-gray-300", "bg") -> #d1d5db.
 */
function lightColour(classList: string, utility: string): string {
  const token: string = lightToken(classList, utility);
  const colour: string | undefined =
    LIGHT_PALETTE[token.slice(utility.length + 1)];

  if (!colour) {
    throw new Error(
      `${token} has no entry in this suite's palette: add it, with its hex, and check it against the surfaces below`,
    );
  }

  return colour;
}

// The colour a hover class gives: "hover:bg-indigo-700" -> #4338ca.
function lightHoverColour(hoverClass: string): string {
  const token: string | undefined = tokens(hoverClass).find(
    (candidate: string): boolean => {
      return candidate.startsWith("hover:bg-");
    },
  );

  if (!token) {
    throw new Error(`No hover:bg- colour in "${hoverClass}"`);
  }

  const colour: string | undefined =
    LIGHT_PALETTE[token.slice("hover:bg-".length)];

  if (!colour) {
    throw new Error(`${token} has no entry in this suite's palette`);
  }

  return colour;
}

// The value a dark rule sets, by its exact selector.
function darkDeclaration(selector: string, property: string): string {
  const value: string | undefined = declaredValue(selector, property);

  if (!value) {
    throw new Error(`Theme.css has no "${property}" for ${selector}`);
  }

  return resolveDark(value.replace(/\s*!important$/, ""));
}

/*
 * The dark rules are looked up by the classes the component exports, so a
 * class changed in Toggle.tsx without its rule in Theme.css fails here.
 */
const OFF_TRACK_SELECTOR: string = `html.dark [data-ou-toggle-track].${lightToken(
  TOGGLE_TRACK_OFF_CLASS,
  "bg",
)}`;
const OFF_HOVER_SELECTOR: string = `html.dark [data-ou-toggle-track][class~="${TOGGLE_TRACK_OFF_HOVER_CLASS}"]:hover`;
const ON_TRACK_SELECTOR: string = `html.dark [data-ou-toggle-track].${lightToken(
  TOGGLE_TRACK_ON_CLASS,
  "bg",
)}`;
const ON_HOVER_SELECTOR: string = `html.dark [data-ou-toggle-track][class~="${TOGGLE_TRACK_ON_HOVER_CLASS}"]:hover`;
const KNOB_SELECTOR: string = `html.dark [data-ou-toggle-knob].${lightToken(
  TOGGLE_KNOB_BASE_CLASS,
  "bg",
)}`;

interface DarkSwitchColours {
  offTrack: string;
  offTrackHover: string;
  onTrack: string;
  onTrackHover: string;
  knob: string;
}

const DARK: DarkSwitchColours = {
  offTrack: darkDeclaration(OFF_TRACK_SELECTOR, "background-color"),
  offTrackHover: darkDeclaration(OFF_HOVER_SELECTOR, "background-color"),
  onTrack: darkDeclaration(ON_TRACK_SELECTOR, "background-color"),
  onTrackHover: darkDeclaration(ON_HOVER_SELECTOR, "background-color"),
  knob: darkDeclaration(KNOB_SELECTOR, "background-color"),
};

/*
 * The theme's general rule for a class, the one the switch's rule overrides:
 * "html.dark .bg-white", or an "html.dark :is(.bg-gray-300, ...)" list, which
 * ThemeStylesheet splits on its commas.
 */
function generalRuleFor(className: string): StyleRule {
  const rule: StyleRule | undefined = THEME_RULES.find(
    (candidate: StyleRule): boolean => {
      const first: string = candidate.selectors[0]!;

      if (first === `html.dark ${className}`) {
        return true;
      }

      return (
        first.startsWith("html.dark :is(") &&
        candidate.selectors.some((selector: string): boolean => {
          return (
            selector.replace(/^html\.dark :is\(/, "").replace(/\)$/, "") ===
            className
          );
        })
      );
    },
  );

  if (!rule) {
    throw new Error(`Theme.css has no general html.dark rule for ${className}`);
  }

  return rule;
}

/*
 * The one selector of that rule that reaches the class, put back together
 * when it is an :is() list the parser split: "html.dark :is(.bg-gray-300,
 * .bg-slate-300)", not the rule's other selectors as well.
 */
function generalSelectorFor(className: string): string {
  const selectors: Array<string> = generalRuleFor(className).selectors;

  if (selectors[0] === `html.dark ${className}`) {
    return selectors[0];
  }

  const closing: number = selectors.findIndex((selector: string): boolean => {
    return selector.endsWith(")");
  });

  return selectors.slice(0, closing + 1).join(", ");
}

describe("the switch in the light theme", () => {
  const offTrack: string = lightColour(TOGGLE_TRACK_OFF_CLASS, "bg");
  const onTrack: string = lightColour(TOGGLE_TRACK_ON_CLASS, "bg");
  const knob: string = lightColour(TOGGLE_KNOB_BASE_CLASS, "bg");

  test.each(Object.entries(LIGHT_SURFACES))(
    "on: the indigo track stands out on %s",
    (_name: string, surface: string) => {
      expect(contrast(onTrack, surface)).toBeGreaterThanOrEqual(3);
    },
  );

  test("on: the white knob stands out on the indigo track", () => {
    expect(contrast(knob, onTrack)).toBeGreaterThanOrEqual(3);
  });

  // So the state never rests on telling indigo from grey.
  test("on and off differ in lightness, not by hue alone", () => {
    expect(contrast(onTrack, offTrack)).toBeGreaterThanOrEqual(3);
    expect(luminance(onTrack)).toBeLessThan(luminance(offTrack));
  });

  /*
   * The first design's gray-200 pill and white knob were 1.2:1 on a white
   * form, and the maintainer's screenshot of it showed a switch that all but
   * disappeared. Off is a step darker, the gray-300 of an input's edge.
   */
  test.each(Object.entries(LIGHT_SURFACES))(
    "off: the grey track shows on %s more than the old gray-200 pill did",
    (_name: string, surface: string) => {
      const oldTrack: string = LIGHT_PALETTE["gray-200"]!;

      expect(contrast(oldTrack, surface)).toBeLessThan(1.25);
      expect(contrast(offTrack, surface)).toBeGreaterThan(
        contrast(oldTrack, surface),
      );
      expect(contrast(offTrack, surface)).toBeGreaterThanOrEqual(
        contrast(LIGHT_PALETTE["gray-300"]!, surface),
      );
    },
  );

  test("the knob is white in both states, with a shadow to set it off the grey", () => {
    expect(tokens(TOGGLE_KNOB_BASE_CLASS)).toEqual(
      expect.arrayContaining(["bg-white", "shadow", "rounded-full"]),
    );
    expect(knob).toBe(LIGHT_PALETTE["white"]);

    // Only the side changes with the state, never the colour.
    for (const sideClass of [TOGGLE_KNOB_OFF_CLASS, TOGGLE_KNOB_ON_CLASS]) {
      expect(
        tokens(sideClass).filter((token: string): boolean => {
          return !token.startsWith("translate-x-");
        }),
      ).toEqual([]);
    }
  });

  test("the track has no outline: its border is clear, the fill is the colour", () => {
    expect(tokens(TOGGLE_TRACK_BASE_CLASS)).toEqual(
      expect.arrayContaining(["border-2", "border-transparent"]),
    );

    for (const classList of [
      TOGGLE_TRACK_OFF_CLASS,
      TOGGLE_TRACK_ON_CLASS,
      TOGGLE_TRACK_OFF_HOVER_CLASS,
      TOGGLE_TRACK_ON_HOVER_CLASS,
    ]) {
      expect({
        classList,
        borderColours: tokens(classList).filter((token: string): boolean => {
          return BORDER_CLASS.test(token);
        }),
      }).toEqual({ classList, borderColours: [] });
    }
  });

  test("hover deepens each state rather than fading it", () => {
    const white: string = LIGHT_PALETTE["white"]!;

    expect(
      contrast(lightHoverColour(TOGGLE_TRACK_OFF_HOVER_CLASS), white),
    ).toBeGreaterThan(contrast(offTrack, white));
    expect(
      contrast(lightHoverColour(TOGGLE_TRACK_ON_HOVER_CLASS), white),
    ).toBeGreaterThan(contrast(onTrack, white));
    // The knob still stands out on the deeper indigo.
    expect(
      contrast(knob, lightHoverColour(TOGGLE_TRACK_ON_HOVER_CLASS)),
    ).toBeGreaterThanOrEqual(3);
  });

  test.each(Object.entries(LIGHT_SURFACES))(
    "the keyboard focus ring is the buttons' indigo-500, offset from the track, and shows on %s",
    (_name: string, surface: string) => {
      expect(tokens(TOGGLE_TRACK_BASE_CLASS)).toEqual(
        expect.arrayContaining([
          "focus:outline-none",
          "focus-visible:ring-2",
          "focus-visible:ring-indigo-500",
          "focus-visible:ring-offset-2",
        ]),
      );
      expect(
        contrast(LIGHT_PALETTE["indigo-500"]!, surface),
      ).toBeGreaterThanOrEqual(3);
    },
  );

  test("disabled is dimmed and refuses the pointer; enabled invites it", () => {
    expect(tokens(TOGGLE_TRACK_DISABLED_CLASS)).toEqual(
      expect.arrayContaining(["opacity-50", "cursor-not-allowed"]),
    );
    expect(tokens(TOGGLE_TRACK_ENABLED_CLASS)).toEqual(["cursor-pointer"]);
  });
});

describe("the switch in the dark theme", () => {
  test.each(Object.entries(DARK_SURFACES))(
    "on: the indigo track stands out on %s",
    (_name: string, surface: string) => {
      expect(contrast(DARK.onTrack, surface)).toBeGreaterThanOrEqual(3);
    },
  );

  test("the knob stands out on both tracks, so its side reads in either state", () => {
    expect(contrast(DARK.knob, DARK.onTrack)).toBeGreaterThanOrEqual(3);
    expect(contrast(DARK.knob, DARK.offTrack)).toBeGreaterThanOrEqual(3);
  });

  test.each(Object.entries(DARK_SURFACES))(
    "off: the track is a visible step lighter than %s",
    (_name: string, surface: string) => {
      expect(luminance(DARK.offTrack)).toBeGreaterThan(luminance(surface));
      expect(contrast(DARK.offTrack, surface)).toBeGreaterThanOrEqual(1.5);
    },
  );

  test("on is the lit state here too: lighter than off", () => {
    expect(luminance(DARK.onTrack)).toBeGreaterThan(luminance(DARK.offTrack));
    expect(contrast(DARK.onTrack, DARK.offTrack)).toBeGreaterThanOrEqual(1.5);
  });

  /*
   * Without the switch's own off rule, the theme's general .bg-gray-300 rule
   * would draw the track slate-500: as light as the indigo-500 on track, so
   * the two states would differ by hue alone.
   */
  test("the theme's general grey would have made off as light as on", () => {
    const offClass: string = `.${lightToken(TOGGLE_TRACK_OFF_CLASS, "bg")}`;
    const general: StyleRule = generalRuleFor(offClass);
    const generalColour: string = resolveDark(
      general.declarations["background-color"]!,
    );

    expect(generalColour).not.toBe(DARK.offTrack);
    expect(contrast(generalColour, DARK.onTrack)).toBeLessThan(1.2);
    expect(
      compareSpecificity(
        specificity(OFF_TRACK_SELECTOR),
        specificity(generalSelectorFor(offClass)),
      ),
    ).toBe(1);
  });

  /*
   * Without these the light classes would carry into the dark theme: the
   * brand indigo-600 is 2.6:1 on a dark card, and a light grey track would
   * hide the near-white knob on it.
   */
  test("the light colours would not have been enough", () => {
    expect(
      contrast(LIGHT_PALETTE["indigo-600"]!, DARK_SURFACES["a dark card"]!),
    ).toBeLessThan(3);
    expect(
      contrast(DARK.knob, lightColour(TOGGLE_TRACK_OFF_CLASS, "bg")),
    ).toBeLessThan(3);
  });

  test("each hover has a dark colour of its own, lighter than the state it is on", () => {
    expect(luminance(DARK.offTrackHover)).toBeGreaterThan(
      luminance(DARK.offTrack),
    );
    expect(luminance(DARK.onTrackHover)).toBeGreaterThan(
      luminance(DARK.onTrack),
    );
    // A hover rule outranks the resting rule it sits on.
    expect(
      compareSpecificity(
        specificity(OFF_HOVER_SELECTOR),
        specificity(OFF_TRACK_SELECTOR),
      ),
    ).toBe(1);
    expect(
      compareSpecificity(
        specificity(ON_HOVER_SELECTOR),
        specificity(ON_TRACK_SELECTOR),
      ),
    ).toBe(1);
  });

  /*
   * The knob keeps a near-white of its own: the theme's general .bg-white
   * rule makes white the card's colour, which would leave a hole where the
   * knob is.
   */
  test("the knob stays near-white instead of turning into the card", () => {
    expect(luminance(DARK.knob)).toBeGreaterThan(0.9);
    // Both are !important, so the more specific one decides.
    expect(declaredValue(KNOB_SELECTOR, "background-color")).toContain(
      "!important",
    );
    expect(
      generalRuleFor(".bg-white").declarations["background-color"],
    ).toContain("!important");
    expect(
      compareSpecificity(
        specificity(KNOB_SELECTOR),
        specificity(generalSelectorFor(".bg-white")),
      ),
    ).toBe(1);
  });

  /*
   * The older thumb rule (a white span straight under a switch button stays
   * near-white) also matched the session replay switch's off TRACK when that
   * track was white, and lit the whole track up on a dark card. Every rule
   * that keeps a switch's white span light must leave tracks out.
   */
  test("no rule keeping a switch's knob light lights up an off track", () => {
    const thumbSelectors: Array<string> = THEME_RULES.filter(
      (rule: StyleRule): boolean => {
        return rule.declarations["background-color"] === "#f8fafc !important";
      },
    )
      .flatMap((rule: StyleRule): Array<string> => {
        return rule.selectors;
      })
      .filter((selector: string): boolean => {
        return selector.includes("span.bg-white");
      });

    expect(thumbSelectors.length).toBeGreaterThan(0);

    for (const selector of thumbSelectors) {
      expect({
        selector,
        leavesTracksOut: selector.includes(":not([data-ou-toggle-track])"),
      }).toEqual({ selector, leavesTracksOut: true });
    }
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

    for (const attribute of ["data-ou-toggle-track", "data-ou-toggle-knob"]) {
      expect({
        attribute,
        rendered: toggleSource.includes(`${attribute}=""`),
      }).toEqual({ attribute, rendered: true });
    }

    // The outlined design's tick is gone, and so is its rule.
    expect(toggleSource).not.toContain("data-ou-toggle-check");
    expect(
      THEME_RULES.some((rule: StyleRule): boolean => {
        return rule.selectors.some((selector: string): boolean => {
          return selector.includes("data-ou-toggle-check");
        });
      }),
    ).toBe(false);
  });
});

/*
 * Every colour class the switch is drawn with, held to what Theme.css
 * re-colours. The dark theme is class remaps, not dark: variants: a class
 * with no rule keeps its light colour - a white knob on a white card - and
 * nothing fails. Both modules that draw a switch are read: the Toggle, and
 * the session replay's transport-row switch, which borrows its dark rules.
 */
describe("the switch's colour classes in the dark theme", () => {
  const UI_DIR: string = path.join(__dirname, "..", "..", "..", "UI");
  const REPOSITORY_ROOT: string = path.join(UI_DIR, "..", "..", "..");

  const TOGGLE_FILE: string = path.join(
    UI_DIR,
    "Components",
    "Toggle",
    "Toggle.tsx",
  );

  const REPLAY_UI_FILE: string = path.join(
    REPOSITORY_ROOT,
    "packages",
    "App",
    "FeatureSet",
    "Dashboard",
    "src",
    "Components",
    "SessionReplay",
    "ReplayUi.tsx",
  );

  /*
   * The code that draws a switch: the whole Toggle module, and only the
   * ReplaySwitch component out of the replay's control kit, from its
   * declaration to the next export.
   */
  function switchCode(file: string): string {
    const code: string = fs.readFileSync(file, "utf8");

    if (file !== REPLAY_UI_FILE) {
      return code;
    }

    const start: number = code.indexOf("export const ReplaySwitch");
    const end: number = code.indexOf("\nexport ", start + 1);

    if (start === -1) {
      throw new Error("ReplayUi.tsx no longer declares ReplaySwitch");
    }

    return code.slice(start, end === -1 ? undefined : end);
  }

  const FILES: Array<string> = [TOGGLE_FILE, REPLAY_UI_FILE];

  /*
   * text-red-400 is every form field's error colour (Input, TextArea,
   * Dropdown): 5.9:1 on a dark card, so it needs no rule of its own.
   */
  const SAME_IN_BOTH_THEMES: Array<string> = ["text-red-400"];

  // Block comments only: prose in Theme.css must not count as a rule.
  const THEME_CSS: string = fs
    .readFileSync(path.join(UI_DIR, "Styles", "Theme.css"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ");

  const COLOR_UTILITY: RegExp =
    /^(?:bg|text|border|ring|divide|from|via|to|outline|fill|stroke)-(?:white|black|(?:gray|slate|red|amber|yellow|emerald|green|sky|blue|indigo|orange|rose|purple|pink|teal|cyan|lime|violet|fuchsia|zinc|neutral|stone)-\d{2,3})(?:\/\d+)?$/;

  /*
   * A mid-tone hue (a 500 or 600) reads alike in both themes, and Theme.css
   * leaves most of them alone. Greys do not: they are always re-coloured.
   */
  const SOLID: RegExp =
    /^(?:bg|text|border|ring)-(?!(?:gray|slate|zinc|neutral|stone)-)[a-z]+-(?:500|600)$/;

  const IDENTIFIER_CHAR: RegExp = /[\w-]/;

  // Interaction variants Theme.css remaps by prefix: [class*="hover:text-indigo-"].
  const SUBSTRING_VARIANTS: Array<string> = Array.from(
    THEME_CSS.matchAll(/\[class\*="([^"]+)"\]/g),
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  ).filter((prefix: string): boolean => {
    return prefix.includes(":");
  });

  function utilityOf(token: string): string {
    let depth: number = 0;
    let lastColon: number = -1;

    for (let i: number = 0; i < token.length; i++) {
      const character: string = token.charAt(i);

      if (character === "[") {
        depth++;
      } else if (character === "]") {
        depth--;
      } else if (character === ":" && depth === 0) {
        lastColon = i;
      }
    }

    return token.slice(lastColon + 1);
  }

  function isRemapped(token: string): boolean {
    if (SOLID.test(utilityOf(token))) {
      return true;
    }

    if (THEME_CSS.includes(`[class~="${token}"]`)) {
      return true;
    }

    if (
      SUBSTRING_VARIANTS.some((prefix: string): boolean => {
        return token.startsWith(prefix);
      })
    ) {
      return true;
    }

    const escapedClass: string = token
      .replace(/\\/g, "\\\\")
      .replace(/:/g, "\\:")
      .replace(/\//g, "\\/");
    let from: number = THEME_CSS.indexOf(`.${escapedClass}`);

    while (from !== -1) {
      const next: string =
        THEME_CSS.charAt(from + escapedClass.length + 1) || " ";

      // So bg-gray-50 is not taken for bg-gray-500.
      if (!IDENTIFIER_CHAR.test(next)) {
        return true;
      }

      from = THEME_CSS.indexOf(`.${escapedClass}`, from + 1);
    }

    return false;
  }

  function colourTokens(file: string): Array<string> {
    const code: string = switchCode(file)
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/.*$/gm, " ");
    const texts: Array<string> = [];

    // Every quoted string, including the branches inside a template's ${}.
    for (const match of code.matchAll(/"([^"\n]*)"/g)) {
      texts.push(match[1] ?? "");
    }

    // And every template's own text, its substitutions left out.
    for (const match of code.matchAll(/`([^`]*)`/g)) {
      texts.push((match[1] ?? "").replace(/\$\{[^}]*\}/g, " "));
    }

    const found: Array<string> = [];

    for (const text of texts) {
      for (const token of text.split(/\s+/)) {
        if (token && COLOR_UTILITY.test(utilityOf(token))) {
          found.push(token);
        }
      }
    }

    return Array.from(new Set(found));
  }

  test("neither switch uses dark: variants", () => {
    for (const file of FILES) {
      expect({
        file: path.basename(file),
        usesDarkVariant: switchCode(file).includes("dark:"),
      }).toEqual({ file: path.basename(file), usesDarkVariant: false });
    }
  });

  test("the replay's switch is drawn with the Toggle's colours", () => {
    const replayTokens: Array<string> = colourTokens(REPLAY_UI_FILE);

    expect(replayTokens).toEqual(
      expect.arrayContaining([
        lightToken(TOGGLE_TRACK_OFF_CLASS, "bg"),
        lightToken(TOGGLE_TRACK_ON_CLASS, "bg"),
        lightToken(TOGGLE_KNOB_BASE_CLASS, "bg"),
      ]),
    );
    expect(switchCode(REPLAY_UI_FILE)).toContain("data-ou-toggle-track");
    expect(switchCode(REPLAY_UI_FILE)).toContain("data-ou-toggle-knob");
    // Nothing left of the outlined design.
    expect(replayTokens).not.toContain("border-gray-500");
    expect(replayTokens).not.toContain("bg-gray-500");
    expect(replayTokens).not.toContain("border-indigo-600");
  });

  test("every colour class the switch uses is re-coloured for the dark theme", () => {
    const toggleTokens: Array<string> = colourTokens(TOGGLE_FILE);

    // The scan found the switch's colours, so a pass is not vacuous.
    expect(toggleTokens).toEqual(
      expect.arrayContaining([
        "bg-gray-300",
        "hover:bg-gray-400",
        "bg-indigo-600",
        "hover:bg-indigo-700",
        "bg-white",
        "focus-visible:ring-indigo-500",
        "text-gray-900",
        "text-gray-500",
        "text-gray-400",
      ]),
    );

    const unmapped: Array<string> = FILES.flatMap(colourTokens).filter(
      (token: string): boolean => {
        return !isRemapped(token) && !SAME_IN_BOTH_THEMES.includes(token);
      },
    );

    expect(unmapped).toEqual([]);
  });

  /*
   * The other way round: every rule Theme.css keeps for the switch styles a
   * class one of the two switches still draws. A rule left behind by an
   * older design (the outline's border-gray-500, say) styles nothing - until
   * the class comes back on some other part of the switch and picks up a
   * colour nobody chose for it.
   */
  test("every switch rule in Theme.css styles a class a switch still draws", () => {
    const drawn: Set<string> = new Set(FILES.flatMap(colourTokens));
    const selectors: Array<string> = THEME_RULES.flatMap(
      (rule: StyleRule): Array<string> => {
        return rule.selectors;
      },
    ).filter((selector: string): boolean => {
      return (
        selector.includes("[data-ou-toggle-") ||
        selector.includes('button[role="switch"]')
      );
    });

    expect(selectors.length).toBeGreaterThanOrEqual(5);

    const stale: Array<string> = selectors.filter(
      (selector: string): boolean => {
        const classes: Array<string> = [
          ...Array.from(
            selector.matchAll(/\.([A-Za-z][\w-]*)/g),
            (match: RegExpMatchArray): string => {
              return match[1]!;
            },
          ).filter((className: string): boolean => {
            return className !== "dark";
          }),
          ...Array.from(
            selector.matchAll(/\[class~="([^"]+)"\]/g),
            (match: RegExpMatchArray): string => {
              return match[1]!;
            },
          ),
        ];

        return (
          classes.length === 0 ||
          classes.some((className: string): boolean => {
            return !drawn.has(className);
          })
        );
      },
    );

    expect(stale).toEqual([]);
  });
});
