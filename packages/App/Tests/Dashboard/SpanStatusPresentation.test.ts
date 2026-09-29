import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { SpanStatus } from "Common/Models/AnalyticsModels/Span";
import { toSpanStatusCode } from "../../FeatureSet/Dashboard/src/Components/Traces/TracesSearchCompile";
import {
  SPAN_STATUS_PRESENTATIONS,
  SpanStatusPresentation,
  getSpanStatusColorMap,
  getSpanStatusDisplayLabelMap,
  getSpanStatusPresentation,
} from "../../FeatureSet/Dashboard/src/Utils/SpanStatusPresentation";

/*
 * How the Dashboard names and paints a span status. Unset (0) is
 * OpenTelemetry's default: the span finished and no error status was set. So
 * it has to read as healthy - green, and "Unset (no error)" where there is
 * room - never the grey that made a healthy service look "mostly unknown"
 * (#4118). The wording is about the status field: recording an exception
 * does not change a span's status, so an Unset span can still carry
 * exceptions. The stored codes, the "Unset" name and `status:unset` stay as
 * they are.
 *
 * The last two blocks measure the chart colours, with colour math written in
 * this file from the published formulas. They measure every pair of
 * statuses, not only the neighbours in the chart's stack (Ok, Unset, Error):
 * Ok and Error touch whenever a bucket has no Unset spans, the Status facet
 * lists the statuses by span count, and matching a bar to its legend entry
 * means telling every colour from every other.
 * - Delta E is the OKLab distance between two colours x100; about 2 is just
 *   noticeable. Every pair needs 15 with full colour vision, and 8 under
 *   simulated protanopia and deuteranopia (Machado et al. 2009 at full
 *   severity), the worst case of the red-green colour blindness about 1 man
 *   in 12 has.
 * - OKLCH chroma under 0.10 reads as grey, whatever the hue.
 * - Contrast is WCAG 2's ratio against the surfaces a status sits on, light
 *   and dark; graphics need 3:1. Ok and Error clear it on every surface.
 *   Unset's green does not on the light ones, so the legend and facet names
 *   carry it there. Its floors are today's measurements less a small margin:
 *   a change can do better, not quietly worse.
 */

type Theme = "light" | "dark";

// A surface a status colour sits on, and the Theme.css token that holds it.
interface Surface {
  name: string;
  theme: Theme;
  token: string;
  color: string;
}

/*
 * The card holds the chart, the Status facet, the legend and the trace list.
 * The tertiary surface is what bg-gray-100 is in both themes, so it is also
 * the track the list's duration bar runs in. The dark secondary surface is
 * what bg-gray-50 grounds and hovered rows turn to. The light secondary
 * surface (#f9fafb) lies between the light card and the light tertiary one,
 * so those two bound it.
 */
const LIGHT_CARD: Surface = {
  name: "light card",
  theme: "light",
  token: "--ou-surface-primary",
  color: "#ffffff",
};
const LIGHT_TERTIARY: Surface = {
  name: "light tertiary",
  theme: "light",
  token: "--ou-surface-tertiary",
  color: "#f3f4f6",
};
const DARK_CARD: Surface = {
  name: "dark card",
  theme: "dark",
  token: "--ou-surface-primary",
  color: "#172033",
};
const DARK_SECONDARY: Surface = {
  name: "dark secondary",
  theme: "dark",
  token: "--ou-surface-secondary",
  color: "#1e293b",
};
const DARK_TERTIARY: Surface = {
  name: "dark tertiary",
  theme: "dark",
  token: "--ou-surface-tertiary",
  color: "#273449",
};

const SURFACES: Array<Surface> = [
  LIGHT_CARD,
  LIGHT_TERTIARY,
  DARK_CARD,
  DARK_SECONDARY,
  DARK_TERTIARY,
];
const DARK_SURFACES: Array<Surface> = SURFACES.filter(
  (surface: Surface): boolean => {
    return surface.theme === "dark";
  },
);

const NORMAL_VISION_FLOOR: number = 15;
const RED_GREEN_FLOOR: number = 8;
const CHROMA_FLOOR: number = 0.1;
// WCAG 2.1's 3:1 for graphics (1.4.11, non-text contrast).
const GRAPHICS_CONTRAST: number = 3;
// Unset on the light surfaces: today's 2.54 and 2.31, less a small margin.
const UNSET_LIGHT_CARD_FLOOR: number = 2.5;
const UNSET_LIGHT_TERTIARY_FLOOR: number = 2.25;

// OKLCH hues that read as green: Tailwind's green to emerald, not lime or teal.
const GREEN_HUE_MIN: number = 140;
const GREEN_HUE_MAX: number = 175;

// And as cyan: past Tailwind's teal (about 185), short of sky blue (237 up).
const CYAN_HUE_MIN: number = 200;
const CYAN_HUE_MAX: number = 235;

// Ok before it was cyan: Tailwind's emerald-700, a darker step of Unset's green.
const OLD_DARK_GREEN_OK: string = "#047857";

const HEX_COLOR: RegExp = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/;

// One full Tailwind colour utility: kind, colour family, shade, opacity.
const TAILWIND_COLOR_CLASS: RegExp =
  /^(bg|text|ring|border)-([a-z]+)-(50|[1-9]00|950)(?:\/(\d{1,3}))?$/;

// At this opacity (%) or under, a class is a faint wash over its surface.
const FAINT_WASH_MAX_OPACITY: number = 20;

// One or more sentences: a capital, single-spaced words, a full stop.
const SENTENCE: string = "[A-Z][^\\s.!?]*(?: [^\\s.!?]+)*[.!?]";
const SENTENCES: RegExp = new RegExp(`^${SENTENCE}(?: ${SENTENCE})*$`);

// A class name built from a template, such as bg-${family}-500.
const TEMPLATE_CLASS_FRAGMENT: RegExp =
  /(?:bg|text|ring|border)-[a-z0-9-]*\$\{/;

const REGEX_SPECIAL_CHARACTERS: RegExp = /[.*+?^${}()|[\]\\]/g;
const BLOCK_COMMENT: RegExp = /\/\*[\s\S]*?\*\//g;

type ClassField =
  | "dotClassName"
  | "ringClassName"
  | "barClassName"
  | "barTrackClassName"
  | "pillClassName"
  | "pillBorderClassName"
  | "pillRingClassName";

const CLASS_FIELDS: Array<ClassField> = [
  "dotClassName",
  "ringClassName",
  "barClassName",
  "barTrackClassName",
  "pillClassName",
  "pillBorderClassName",
  "pillRingClassName",
];

// The slots painted in the status's own colour; the bar track is the empty rail.
const STATUS_COLORED_FIELDS: Array<ClassField> = [
  "dotClassName",
  "ringClassName",
  "barClassName",
  "pillClassName",
  "pillBorderClassName",
  "pillRingClassName",
];

// The tints and washes around the dot and bar, which are the series colour.
const TINT_FIELDS: Array<ClassField> = [
  "ringClassName",
  "barTrackClassName",
  "pillClassName",
  "pillBorderClassName",
  "pillRingClassName",
];

// What each slot sets, in order: the pill is a background plus a text colour.
const FIELD_UTILITIES: Record<ClassField, Array<string>> = {
  dotClassName: ["bg"],
  ringClassName: ["ring"],
  barClassName: ["bg"],
  barTrackClassName: ["bg"],
  pillClassName: ["bg", "text"],
  pillBorderClassName: ["border"],
  pillRingClassName: ["ring"],
};

/*
 * Tailwind 3.4's default shades for the dot, bar and track classes: the
 * Dashboard loads tailwind-3.4.5 with no colour overrides.
 */
const TAILWIND_SHADES: Record<string, string> = {
  "bg-cyan-600": "#0891b2",
  "bg-emerald-500": "#10b981",
  "bg-gray-100": "#f3f4f6",
  "bg-red-500": "#ef4444",
};

const MODULE_SOURCE: string = fs.readFileSync(
  path.join(
    __dirname,
    "..",
    "..",
    "FeatureSet",
    "Dashboard",
    "src",
    "Utils",
    "SpanStatusPresentation.ts",
  ),
  "utf8",
);

// Block comments only: prose in Theme.css must not count as a rule.
const THEME_CSS: string = fs
  .readFileSync(
    path.join(
      __dirname,
      "..",
      "..",
      "..",
      "Common",
      "UI",
      "Styles",
      "Theme.css",
    ),
    "utf8",
  )
  .replace(BLOCK_COMMENT, " ");

interface CssRule {
  selector: string;
  body: string;
}

/*
 * Every rule that applies under html.dark. Splitting on "}" leaves each
 * rule's selector and body either side of its last "{", inside @media too.
 */
const DARK_THEME_RULES: Array<CssRule> = THEME_CSS.split("}")
  .map((chunk: string): CssRule => {
    const parts: Array<string> = chunk.split("{");
    return parts.length > 1
      ? { selector: parts[parts.length - 2]!, body: parts[parts.length - 1]! }
      : { selector: "", body: "" };
  })
  .filter((rule: CssRule): boolean => {
    return rule.selector.includes("html.dark");
  });

function escapeRegExp(text: string): string {
  return text.replace(REGEX_SPECIAL_CHARACTERS, "\\$&");
}

function darkThemeRulesFor(className: string): Array<CssRule> {
  /*
   * As a class selector, followed by a non-identifier character so bg-red-50
   * is not bg-red-500, or as a [class~="..."] attribute selector, the way
   * Theme.css spells a class with a "/" in it.
   */
  const selectors: Array<RegExp> = [
    new RegExp(`\\.${escapeRegExp(className)}(?![\\w-])`),
    new RegExp(`\\[class~="${escapeRegExp(className)}"\\]`),
  ];

  return DARK_THEME_RULES.filter((rule: CssRule): boolean => {
    return selectors.some((selector: RegExp): boolean => {
      return selector.test(rule.selector);
    });
  });
}

function hasDarkThemeRule(className: string): boolean {
  return darkThemeRulesFor(className).length > 0;
}

// A colour token's value in Theme.css's light (:root) or dark (html.dark) block.
function themeToken(theme: Theme, token: string): string | undefined {
  const block: string = theme === "light" ? ":root" : "html\\.dark";
  const match: RegExpExecArray | null = new RegExp(
    `${block}\\s*\\{[^}]*?${escapeRegExp(token)}:\\s*(#[0-9a-fA-F]{6})\\s*;`,
  ).exec(THEME_CSS);

  return match?.[1]?.toLowerCase();
}

function isFaintWash(className: string): boolean {
  const opacity: string | undefined = TAILWIND_COLOR_CLASS.exec(className)?.[4];
  return opacity !== undefined && Number(opacity) <= FAINT_WASH_MAX_OPACITY;
}

function isSpelledOutInSource(className: string): boolean {
  return new RegExp(`(?<![\\w-])${escapeRegExp(className)}(?![\\w-])`).test(
    MODULE_SOURCE,
  );
}

function presentationOf(status: SpanStatus): SpanStatusPresentation {
  const found: SpanStatusPresentation | undefined =
    SPAN_STATUS_PRESENTATIONS.find(
      (presentation: SpanStatusPresentation): boolean => {
        return presentation.status === status;
      },
    );

  if (!found) {
    throw new Error(`No presentation for span status ${status}`);
  }

  return found;
}

const OK: SpanStatusPresentation = presentationOf(SpanStatus.Ok);
const UNSET: SpanStatusPresentation = presentationOf(SpanStatus.Unset);
const ERROR: SpanStatusPresentation = presentationOf(SpanStatus.Error);

function labelsOf(
  presentations: ReadonlyArray<SpanStatusPresentation>,
): Array<string> {
  return presentations.map((presentation: SpanStatusPresentation): string => {
    return presentation.label;
  });
}

// The colour family of each class in a class string ("emerald", "gray", ...).
function familiesOf(classNames: string): Array<string> {
  return classNames.split(" ").map((className: string): string => {
    return TAILWIND_COLOR_CLASS.exec(className)?.[2] || `?${className}`;
  });
}

// The distinct colour families of the given slots, in first-seen order.
function distinctFamiliesOf(
  presentation: SpanStatusPresentation,
  fields: Array<ClassField>,
): Array<string> {
  return Array.from(
    new Set(
      familiesOf(
        fields
          .map((field: ClassField): string => {
            return presentation[field];
          })
          .join(" "),
      ),
    ),
  );
}

/*
 * Colour math, from the published formulas: the sRGB transfer curve
 * (IEC 61966-2-1), Björn Ottosson's OKLab (2020), WCAG 2 relative luminance
 * and contrast, and the Machado-Oliveira-Fernandes (2009) colour-vision
 * matrices, which apply to linear RGB.
 */

type Channels = [number, number, number];
type Matrix = [Channels, Channels, Channels];

interface OkLab {
  lightness: number;
  a: number;
  b: number;
}

interface OkLch {
  lightness: number;
  chroma: number;
  hue: number;
}

const FULL_COLOR_VISION: Matrix = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

// Severity 1.0: what a protanope and a deuteranope see.
const PROTANOPIA: Matrix = [
  [0.152286, 1.052583, -0.204868],
  [0.114503, 0.786281, 0.099216],
  [-0.003882, -0.048116, 1.051998],
];

const DEUTERANOPIA: Matrix = [
  [0.367322, 0.860646, -0.227968],
  [0.280085, 0.672501, 0.047413],
  [-0.01182, 0.04294, 0.968881],
];

const LINEAR_SRGB_TO_LMS: Matrix = [
  [0.4122214708, 0.5363325363, 0.0514459929],
  [0.2119034982, 0.6806995451, 0.1073969566],
  [0.0883024619, 0.2817188376, 0.6299787005],
];

const LMS_TO_OKLAB: Matrix = [
  [0.2104542553, 0.793617785, -0.0040720468],
  [1.9779984951, -2.428592205, 0.4505937099],
  [0.0259040371, 0.7827717662, -0.808675766],
];

function mapChannels(
  channels: Channels,
  transform: (channel: number) => number,
): Channels {
  return [
    transform(channels[0]),
    transform(channels[1]),
    transform(channels[2]),
  ];
}

function multiply(matrix: Matrix, vector: Channels): Channels {
  const row: (weights: Channels) => number = (weights: Channels): number => {
    return (
      weights[0] * vector[0] + weights[1] * vector[1] + weights[2] * vector[2]
    );
  };

  return [row(matrix[0]), row(matrix[1]), row(matrix[2])];
}

function toLinearRgb(hex: string): Channels {
  const match: RegExpExecArray | null = HEX_COLOR.exec(hex);

  if (!match) {
    throw new Error(`Not a six-digit hex colour: ${hex}`);
  }

  const channels: Channels = [
    parseInt(match[1]!, 16) / 255,
    parseInt(match[2]!, 16) / 255,
    parseInt(match[3]!, 16) / 255,
  ];

  return mapChannels(channels, (encoded: number): number => {
    return encoded <= 0.04045
      ? encoded / 12.92
      : Math.pow((encoded + 0.055) / 1.055, 2.4);
  });
}

// The colour in OKLab, as seen with the given colour vision.
function toOkLab(hex: string, vision: Matrix = FULL_COLOR_VISION): OkLab {
  // Clamped to what a screen can show: a simulated colour can fall outside.
  const seen: Channels = mapChannels(
    multiply(vision, toLinearRgb(hex)),
    (channel: number): number => {
      return Math.min(1, Math.max(0, channel));
    },
  );
  const lab: Channels = multiply(
    LMS_TO_OKLAB,
    mapChannels(multiply(LINEAR_SRGB_TO_LMS, seen), Math.cbrt),
  );

  return { lightness: lab[0], a: lab[1], b: lab[2] };
}

function toOkLch(hex: string): OkLch {
  const lab: OkLab = toOkLab(hex);
  const hue: number = (Math.atan2(lab.b, lab.a) * 180) / Math.PI;

  return {
    lightness: lab.lightness,
    chroma: Math.hypot(lab.a, lab.b),
    hue: hue < 0 ? hue + 360 : hue,
  };
}

function okLabDistance(first: OkLab, second: OkLab): number {
  return (
    Math.hypot(
      first.lightness - second.lightness,
      first.a - second.a,
      first.b - second.b,
    ) * 100
  );
}

function deltaE(
  first: string,
  second: string,
  vision: Matrix = FULL_COLOR_VISION,
): number {
  return okLabDistance(toOkLab(first, vision), toOkLab(second, vision));
}

// The worse of the two red-green simulations.
function redGreenDeltaE(first: string, second: string): number {
  return Math.min(
    deltaE(first, second, PROTANOPIA),
    deltaE(first, second, DEUTERANOPIA),
  );
}

/*
 * The lightness, chroma and hue parts of Delta E, x100 like it: they add in
 * quadrature to the whole. The hue part is CIE's Delta H taken in OKLCH,
 * 2 sqrt(C1 C2) sin(dh / 2).
 */
function lightnessDifference(first: OkLch, second: OkLch): number {
  return Math.abs(first.lightness - second.lightness) * 100;
}

function chromaDifference(first: OkLch, second: OkLch): number {
  return Math.abs(first.chroma - second.chroma) * 100;
}

function hueDifference(first: OkLch, second: OkLch): number {
  const halfAngle: number = ((first.hue - second.hue) * Math.PI) / 360;

  return (
    2 *
    Math.sqrt(first.chroma * second.chroma) *
    Math.abs(Math.sin(halfAngle)) *
    100
  );
}

function relativeLuminance(hex: string): number {
  const rgb: Channels = toLinearRgb(hex);
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

function contrastRatio(first: string, second: string): number {
  const lighter: number = Math.max(
    relativeLuminance(first),
    relativeLuminance(second),
  );
  const darker: number = Math.min(
    relativeLuminance(first),
    relativeLuminance(second),
  );

  return (lighter + 0.05) / (darker + 0.05);
}

// What the chart-colour checks read from a status: its name and its colour.
interface Series {
  label: string;
  color: string;
}

type SeriesPair = [Series, Series];

// Every two series, in list order: any two statuses can end up side by side.
function everyPair(series: ReadonlyArray<Series>): Array<SeriesPair> {
  const pairs: Array<SeriesPair> = [];

  series.forEach((first: Series, index: number): void => {
    for (const second of series.slice(index + 1)) {
      pairs.push([first, second]);
    }
  });

  return pairs;
}

// Only the series next to each other in the chart's stack, bottom to top.
function stackNeighbours(series: ReadonlyArray<Series>): Array<SeriesPair> {
  return series.slice(1).map((second: Series, index: number): SeriesPair => {
    return [series[index]!, second];
  });
}

function pairName(pair: SeriesPair): string {
  return `${pair[0].label}/${pair[1].label}`;
}

// "Ok/Error: 2.4" for every pair that measures under the floor.
function pairsBelow(
  pairs: Array<SeriesPair>,
  floor: number,
  measure: (first: string, second: string) => number,
): Array<string> {
  return pairs
    .filter((pair: SeriesPair): boolean => {
      return measure(pair[0].color, pair[1].color) < floor;
    })
    .map((pair: SeriesPair): string => {
      return `${pairName(pair)}: ${measure(pair[0].color, pair[1].color).toFixed(1)}`;
    });
}

// "dark tertiary 2.29:1" for every surface the colour is under the floor on.
function contrastsBelow(
  color: string,
  floor: number,
  surfaces: ReadonlyArray<Surface>,
): Array<string> {
  return surfaces
    .filter((surface: Surface): boolean => {
      return contrastRatio(color, surface.color) < floor;
    })
    .map((surface: Surface): string => {
      return `${surface.name} ${contrastRatio(color, surface.color).toFixed(2)}:1`;
    });
}

type StatusInput = SpanStatus | number | string | null | undefined;

describe("getSpanStatusPresentation", () => {
  test.each<[string, StatusInput, SpanStatus]>([
    ["SpanStatus.Unset reads as Unset", SpanStatus.Unset, SpanStatus.Unset],
    ["SpanStatus.Ok reads as Ok", SpanStatus.Ok, SpanStatus.Ok],
    ["SpanStatus.Error reads as Error", SpanStatus.Error, SpanStatus.Error],
    ["the stored 0 reads as Unset", 0, SpanStatus.Unset],
    ["the stored 1 reads as Ok", 1, SpanStatus.Ok],
    ["the stored 2 reads as Error", 2, SpanStatus.Error],
    ['the facet key "0" reads as Unset', "0", SpanStatus.Unset],
    ['the facet key "1" reads as Ok', "1", SpanStatus.Ok],
    ['the facet key "2" reads as Error', "2", SpanStatus.Error],
    ["a missing status (null) reads as Unset", null, SpanStatus.Unset],
    [
      "a missing status (undefined) reads as Unset",
      undefined,
      SpanStatus.Unset,
    ],
    ["NaN reads as Unset", NaN, SpanStatus.Unset],
    ["an unknown code 3 reads as Unset", 3, SpanStatus.Unset],
    ["an unknown code 7 reads as Unset", 7, SpanStatus.Unset],
    ["a negative code -1 reads as Unset", -1, SpanStatus.Unset],
    ["an empty string reads as Unset", "", SpanStatus.Unset],
    /*
     * Only codes are read: a typed `status:ok` is compiled to a code first
     * (toSpanStatusCode), so the bare word is just not Ok or Error.
     */
    ['the word "ok" reads as Unset', "ok", SpanStatus.Unset],
  ])("%s", (_title: string, input: StatusInput, expected: SpanStatus): void => {
    expect(getSpanStatusPresentation(input).status).toBe(expected);
  });

  test("the lookup and the list agree on every field", () => {
    for (const presentation of SPAN_STATUS_PRESENTATIONS) {
      expect(getSpanStatusPresentation(presentation.status)).toEqual(
        presentation,
      );
      expect(getSpanStatusPresentation(String(presentation.status))).toEqual(
        presentation,
      );
    }
  });
});

describe("SPAN_STATUS_PRESENTATIONS", () => {
  test("lists Ok, Unset, Error: the Traces chart's stack, bottom to top", () => {
    expect(
      SPAN_STATUS_PRESENTATIONS.map(
        (presentation: SpanStatusPresentation): SpanStatus => {
          return presentation.status;
        },
      ),
    ).toEqual([SpanStatus.Ok, SpanStatus.Unset, SpanStatus.Error]);
  });

  test("has exactly one entry for every SpanStatus", () => {
    const byCode: (first: number, second: number) => number = (
      first: number,
      second: number,
    ): number => {
      return first - second;
    };
    const codes: Array<SpanStatus> = Object.values(SpanStatus).filter(
      (value: string | SpanStatus): value is SpanStatus => {
        return typeof value === "number";
      },
    );
    const listed: Array<SpanStatus> = SPAN_STATUS_PRESENTATIONS.map(
      (presentation: SpanStatusPresentation): SpanStatus => {
        return presentation.status;
      },
    );

    expect([...listed].sort(byCode)).toEqual([...codes].sort(byCode));
  });

  test("labels stay the names filters and `status:` search use", () => {
    expect(labelsOf(SPAN_STATUS_PRESENTATIONS)).toEqual([
      "Ok",
      "Unset",
      "Error",
    ]);

    for (const presentation of SPAN_STATUS_PRESENTATIONS) {
      // The enum member's own name, as monitors and the API spell it...
      expect(presentation.label).toBe(SpanStatus[presentation.status]);
      // ...and, typed after `status:`, it compiles back to the same code.
      expect(toSpanStatusCode(presentation.label.toLowerCase())).toBe(
        presentation.status,
      );
    }
  });

  test("REGRESSION: Unset's display label says no error", () => {
    // Legends, the Status facet and the trace list tiles used to say "Unset".
    expect(UNSET.displayLabel).toBe("Unset (no error)");
  });

  test("every display label leads with the status's own name", () => {
    // So a legend entry still points at `status:unset` and the Status filter.
    for (const presentation of SPAN_STATUS_PRESENTATIONS) {
      expect(presentation.displayLabel.startsWith(presentation.label)).toBe(
        true,
      );
    }

    // Ok and Error need no explaining.
    expect(OK.displayLabel).toBe("Ok");
    expect(ERROR.displayLabel).toBe("Error");
  });

  test("every description is whole sentences, and says what its status means", () => {
    for (const presentation of SPAN_STATUS_PRESENTATIONS) {
      expect(presentation.description).toMatch(SENTENCES);
      expect(presentation.description.split(" ").length).toBeGreaterThanOrEqual(
        4,
      );
    }

    expect(
      new Set(
        SPAN_STATUS_PRESENTATIONS.map(
          (presentation: SpanStatusPresentation): string => {
            return presentation.description;
          },
        ),
      ).size,
    ).toBe(SPAN_STATUS_PRESENTATIONS.length);

    // The tooltip is where Unset explains itself.
    expect(UNSET.description).toMatch(/no error/i);
  });

  test("each description speaks of the status field", () => {
    expect(UNSET.description).toBe(
      "No error status was set. Unset is the OpenTelemetry default for spans that finish without one.",
    );
    expect(OK.description).toBe(
      "Explicitly marked successful by the application or a trace pipeline.",
    );
    expect(ERROR.description).toBe(
      "The operation failed: the span's status is Error.",
    );
  });

  test("REGRESSION: no description says an error was recorded", () => {
    /*
     * Unset said "No error was recorded." and Error "The span recorded an
     * error." But recording an exception does not change a span's status: an
     * Unset span can still carry exceptions.
     */
    for (const presentation of SPAN_STATUS_PRESENTATIONS) {
      expect(presentation.description).not.toMatch(/\brecorded\b/i);
    }
  });
});

describe("getSpanStatusColorMap and getSpanStatusDisplayLabelMap", () => {
  test("are keyed by the stored code as a string, like the Status facet", () => {
    expect(Object.keys(getSpanStatusColorMap()).sort()).toEqual([
      "0",
      "1",
      "2",
    ]);
    expect(Object.keys(getSpanStatusDisplayLabelMap()).sort()).toEqual([
      "0",
      "1",
      "2",
    ]);
  });

  test("REGRESSION: the Status facet and the chart paint Unset green, not grey", () => {
    expect(getSpanStatusColorMap()).toEqual({
      "0": "#10b981",
      "1": "#0891b2",
      "2": "#ef4444",
    });
    // Tailwind's gray-400, which made healthy traffic look unknown.
    expect(getSpanStatusColorMap()["0"]).not.toBe("#9ca3af");
  });

  test("REGRESSION: the Status facet names Unset as no error", () => {
    expect(getSpanStatusDisplayLabelMap()).toEqual({
      "0": "Unset (no error)",
      "1": "Ok",
      "2": "Error",
    });
  });

  test("the maps agree with the presentations", () => {
    for (const presentation of SPAN_STATUS_PRESENTATIONS) {
      const key: string = String(presentation.status);

      expect(getSpanStatusColorMap()[key]).toBe(presentation.color);
      expect(getSpanStatusDisplayLabelMap()[key]).toBe(
        presentation.displayLabel,
      );
    }
  });
});

describe("SpanStatusPresentation colours and Tailwind classes", () => {
  test("every colour is six-digit hex", () => {
    /*
     * Consumers read the channels by position (the dashboard honeycomb picks
     * its tile text colour that way) or append an alpha suffix.
     */
    for (const presentation of SPAN_STATUS_PRESENTATIONS) {
      expect(presentation.color).toMatch(HEX_COLOR);
    }
  });

  test("every class slot holds literal, whole Tailwind colour classes", () => {
    /*
     * Theme.css re-colours classes for the dark theme by exact name, so a
     * class must be spelled out in full: no template fragments, no stray
     * spaces, and the kind of utility each slot's consumer expects.
     */
    const problems: Array<string> = [];

    for (const presentation of SPAN_STATUS_PRESENTATIONS) {
      for (const field of CLASS_FIELDS) {
        const utilities: Array<string> = presentation[field]
          .split(" ")
          .map((className: string): string => {
            return TAILWIND_COLOR_CLASS.exec(className)?.[1] || className;
          });

        if (utilities.join(" ") !== FIELD_UTILITIES[field].join(" ")) {
          problems.push(
            `${presentation.label} ${field}: "${presentation[field]}"`,
          );
        }
      }
    }

    expect(problems).toEqual([]);
  });

  test("every class is spelled out whole in the module's source", () => {
    /*
     * A class assembled from a template is invisible to anything that scans
     * source for class names, and to a search for the class Theme.css
     * re-colours.
     */
    const notLiteral: Array<string> = [];

    for (const presentation of SPAN_STATUS_PRESENTATIONS) {
      for (const field of CLASS_FIELDS) {
        for (const className of presentation[field].split(" ")) {
          if (!isSpelledOutInSource(className)) {
            notLiteral.push(`${presentation.label} ${field}: ${className}`);
          }
        }
      }
    }

    expect(MODULE_SOURCE).not.toMatch(TEMPLATE_CLASS_FRAGMENT);
    expect(notLiteral).toEqual([]);
  });

  test("the row's status dot and duration bar paint the series colour", () => {
    const shadeOf: (className: string) => string = (
      className: string,
    ): string => {
      return TAILWIND_SHADES[className] || `${className} (shade not listed)`;
    };

    for (const presentation of SPAN_STATUS_PRESENTATIONS) {
      expect({
        status: presentation.label,
        dot: shadeOf(presentation.dotClassName),
        bar: shadeOf(presentation.barClassName),
      }).toEqual({
        status: presentation.label,
        dot: presentation.color.toLowerCase(),
        bar: presentation.color.toLowerCase(),
      });
    }
  });

  test("each status paints every coloured slot in one family: Ok cyan, Unset emerald, Error red", () => {
    /*
     * So the pill, its border and ring, the dot and the bar all match the
     * chart series. The dashboard trace list used to pick its pill border by
     * hand: red for Error, emerald for anything else.
     */
    const families: Record<string, Array<string>> = {};

    for (const presentation of SPAN_STATUS_PRESENTATIONS) {
      families[presentation.label] = distinctFamiliesOf(
        presentation,
        STATUS_COLORED_FIELDS,
      );
    }

    expect(families).toEqual({
      Ok: ["cyan"],
      Unset: ["emerald"],
      Error: ["red"],
    });
  });

  test("REGRESSION: Unset's dot, ring, bar and pill are the success green, with no grey", () => {
    // They were bg-gray-300, ring-gray-100, bg-gray-400, bg-gray-50 text-gray-500.
    for (const field of STATUS_COLORED_FIELDS) {
      expect({ field, families: distinctFamiliesOf(UNSET, [field]) }).toEqual({
        field,
        families: ["emerald"],
      });
      expect(familiesOf(UNSET[field])).not.toContain("gray");
    }

    // The duration bar's empty track stays the neutral one Ok's rows use.
    expect(UNSET.barTrackClassName).toBe(OK.barTrackClassName);
  });

  test("red is Error's alone", () => {
    for (const presentation of SPAN_STATUS_PRESENTATIONS) {
      const families: Array<string> = familiesOf(
        CLASS_FIELDS.map((field: ClassField): string => {
          return presentation[field];
        }).join(" "),
      );

      if (presentation.status === SpanStatus.Error) {
        expect(Array.from(new Set(families))).toEqual(["red"]);
      } else {
        expect(families).not.toContain("red");
      }
    }
  });

  test("every tint has a dark theme rule in Theme.css, and the pill ring is a faint wash", () => {
    /*
     * A light tint with no html.dark rule keeps its light colour on the dark
     * card. The pill ring is instead a faint wash of a mid shade
     * (ring-*-600/10, like the filter builder's other pills): at a tenth of
     * its colour it takes on the surface under it, so it needs no rule. The
     * dot and bar are the series colour itself, measured against the dark
     * surfaces below.
     */
    const unmapped: Array<string> = [];
    const opaquePillRings: Array<string> = [];

    for (const presentation of SPAN_STATUS_PRESENTATIONS) {
      for (const field of TINT_FIELDS) {
        for (const className of presentation[field].split(" ")) {
          if (!isFaintWash(className) && !hasDarkThemeRule(className)) {
            unmapped.push(`${presentation.label} ${field}: ${className}`);
          }
        }
      }

      if (!isFaintWash(presentation.pillRingClassName)) {
        opaquePillRings.push(
          `${presentation.label}: ${presentation.pillRingClassName}`,
        );
      }
    }

    // The lookup found the dark rules and matches whole class names only...
    expect(DARK_THEME_RULES.length).toBeGreaterThan(100);
    expect(hasDarkThemeRule("bg-emerald-5")).toBe(false);
    // ...spelled as a class, or with a "/" in it as a [class~=...] selector.
    expect(hasDarkThemeRule("bg-emerald-50/60")).toBe(true);
    expect(isFaintWash("bg-emerald-50/60")).toBe(false);
    expect({ unmapped, opaquePillRings }).toEqual({
      unmapped: [],
      opaquePillRings: [],
    });
  });
});

describe("the colour math behind the measurements", () => {
  test("WCAG contrast gives its published anchors", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    // The lightest grey that passes 4.5:1 on white.
    expect(contrastRatio("#767676", "#ffffff")).toBeCloseTo(4.54, 2);
  });

  test("OKLCH gives the published values of the sRGB primaries", () => {
    const expectations: Array<[string, number, number, number]> = [
      ["#ff0000", 0.628, 0.2577, 29.23],
      ["#00ff00", 0.8664, 0.2948, 142.5],
      ["#0000ff", 0.452, 0.3132, 264.05],
    ];

    for (const [hex, lightness, chroma, hue] of expectations) {
      const measured: OkLch = toOkLch(hex);

      expect(measured.lightness).toBeCloseTo(lightness, 3);
      expect(measured.chroma).toBeCloseTo(chroma, 3);
      expect(measured.hue).toBeCloseTo(hue, 1);
    }

    expect(toOkLch("#ffffff").lightness).toBeCloseTo(1, 5);
    expect(toOkLch("#ffffff").chroma).toBeCloseTo(0, 5);
  });

  test("Delta E splits exactly into its lightness, chroma and hue parts", () => {
    // Cyan-600 and emerald-500, emerald-700 and emerald-500, red-500 and green-500.
    const pairs: Array<[string, string]> = [
      ["#0891b2", "#10b981"],
      ["#047857", "#10b981"],
      ["#ef4444", "#22c55e"],
    ];

    for (const [first, second] of pairs) {
      const firstLch: OkLch = toOkLch(first);
      const secondLch: OkLch = toOkLch(second);

      expect(
        Math.hypot(
          lightnessDifference(firstLch, secondLch),
          chromaDifference(firstLch, secondLch),
          hueDifference(firstLch, secondLch),
        ),
      ).toBeCloseTo(deltaE(first, second), 6);
    }

    // Opposite hues at equal chroma differ in hue by twice the chroma.
    expect(
      hueDifference(
        { lightness: 0.5, chroma: 0.1, hue: 30 },
        { lightness: 0.5, chroma: 0.1, hue: 210 },
      ),
    ).toBeCloseTo(20, 6);
  });

  test("the colour-vision simulations keep greys and pull red and green together", () => {
    for (const grey of ["#000000", "#808080", "#ffffff"]) {
      for (const vision of [PROTANOPIA, DEUTERANOPIA]) {
        expect(
          okLabDistance(toOkLab(grey), toOkLab(grey, vision)),
        ).toBeLessThan(0.01);
      }
    }

    // Tailwind's red-500 and green-500, a traffic light: 36.4 apart, 7.4 for a deuteranope.
    expect(deltaE("#ef4444", "#22c55e")).toBeGreaterThan(30);
    expect(deltaE("#ef4444", "#22c55e", DEUTERANOPIA)).toBeLessThan(
      RED_GREEN_FLOOR,
    );
  });
});

describe("SpanStatusPresentation chart colours, measured", () => {
  test("the surfaces measured against are the app's own", () => {
    for (const surface of SURFACES) {
      expect({
        surface: surface.name,
        color: themeToken(surface.theme, surface.token),
      }).toEqual({ surface: surface.name, color: surface.color });
    }

    /*
     * Ok's and Unset's duration bar runs in a bg-gray-100 track: Tailwind's
     * gray-100 in the light theme, the tertiary surface in the dark one.
     */
    const tertiaryBackground: RegExp =
      /background-color:\s*var\(--ou-surface-tertiary\)/;

    expect([OK.barTrackClassName, UNSET.barTrackClassName]).toEqual([
      "bg-gray-100",
      "bg-gray-100",
    ]);
    expect(TAILWIND_SHADES["bg-gray-100"]).toBe(LIGHT_TERTIARY.color);
    expect(
      darkThemeRulesFor("bg-gray-100").some((rule: CssRule): boolean => {
        return tertiaryBackground.test(rule.body);
      }),
    ).toBe(true);
  });

  test("every pair of statuses is measured, not only the stack's neighbours", () => {
    /*
     * The chart stacks Ok, Unset, Error bottom to top, but Ok sits right
     * under Error in any bucket with no Unset spans, and the Status facet and
     * the legend show every status against every other.
     */
    expect(everyPair(SPAN_STATUS_PRESENTATIONS).map(pairName)).toEqual([
      "Ok/Unset",
      "Ok/Error",
      "Unset/Error",
    ]);
    expect(stackNeighbours(SPAN_STATUS_PRESENTATIONS).map(pairName)).toEqual([
      "Ok/Unset",
      "Unset/Error",
    ]);
  });

  test("every pair stays apart with full colour vision", () => {
    // Measured: Ok/Unset 15.9, Ok/Error 31.7, Unset/Error 33.8.
    expect(
      pairsBelow(
        everyPair(SPAN_STATUS_PRESENTATIONS),
        NORMAL_VISION_FLOOR,
        deltaE,
      ),
    ).toEqual([]);
  });

  test("every pair stays apart under protanopia and deuteranopia", () => {
    /*
     * Measured, the worse of the two: Ok/Unset 15.1 (deutan), Ok/Error 16.8
     * (protan), Unset/Error 8.1 (deutan).
     */
    expect(
      pairsBelow(
        everyPair(SPAN_STATUS_PRESENTATIONS),
        RED_GREEN_FLOOR,
        redGreenDeltaE,
      ),
    ).toEqual([]);
  });

  test("REGRESSION: the old darker-green Ok fell into Error's red for protanopes, which only an every-pair check catches", () => {
    const oldPalette: Array<Series> = [
      { label: "Ok", color: OLD_DARK_GREEN_OK },
      { label: "Unset", color: UNSET.color },
      { label: "Error", color: ERROR.color },
    ];

    // A protanope saw it 2.4 from Error, so checking every pair fails it...
    expect(deltaE(OLD_DARK_GREEN_OK, ERROR.color, PROTANOPIA)).toBeCloseTo(
      2.4,
      1,
    );
    expect(
      pairsBelow(everyPair(oldPalette), RED_GREEN_FLOOR, redGreenDeltaE),
    ).toEqual(["Ok/Error: 2.4"]);
    // ...where the stack's neighbours alone passed it (Ok/Unset 18.9, Unset/Error 8.1)...
    expect(
      pairsBelow(stackNeighbours(oldPalette), RED_GREEN_FLOOR, redGreenDeltaE),
    ).toEqual([]);
    // ...as did full colour vision, which put Ok and Error 32.3 apart.
    expect(
      pairsBelow(everyPair(oldPalette), NORMAL_VISION_FLOOR, deltaE),
    ).toEqual([]);
  });

  test("no series reads as grey", () => {
    // Measured chroma: Ok 0.111, Unset 0.149, Error 0.208.
    const greyish: Array<string> = SPAN_STATUS_PRESENTATIONS.filter(
      (presentation: SpanStatusPresentation): boolean => {
        return toOkLch(presentation.color).chroma < CHROMA_FLOOR;
      },
    ).map((presentation: SpanStatusPresentation): string => {
      return `${presentation.label} ${toOkLch(presentation.color).chroma.toFixed(3)}`;
    });

    expect(greyish).toEqual([]);
  });

  test("REGRESSION: Unset is a saturated green, and Error stays red", () => {
    // Measured: Unset hue 162.5 at chroma 0.149, Error hue 25.3.
    const unset: OkLch = toOkLch(UNSET.color);

    expect(unset.chroma).toBeGreaterThanOrEqual(CHROMA_FLOOR);
    expect(unset.hue).toBeGreaterThanOrEqual(GREEN_HUE_MIN);
    expect(unset.hue).toBeLessThanOrEqual(GREEN_HUE_MAX);
    expect(toOkLch(ERROR.color).hue).toBeLessThan(45);
  });

  test("Ok is cyan, set apart from Unset's green by hue first and a little lightness", () => {
    /*
     * Measured OKLCH: Ok hue 221.7 at chroma 0.111 (cyan-700 would be 0.094,
     * too grey). Of the 15.9 between Ok and Unset, hue carries 12.7 and
     * lightness 8.7 (Ok 0.609, Unset 0.696).
     */
    const ok: OkLch = toOkLch(OK.color);
    const unset: OkLch = toOkLch(UNSET.color);
    const oldOk: OkLch = toOkLch(OLD_DARK_GREEN_OK);

    expect(ok.hue).toBeGreaterThanOrEqual(CYAN_HUE_MIN);
    expect(ok.hue).toBeLessThanOrEqual(CYAN_HUE_MAX);
    expect(ok.chroma).toBeGreaterThanOrEqual(CHROMA_FLOOR);
    expect(hueDifference(ok, unset)).toBeGreaterThan(
      lightnessDifference(ok, unset),
    );
    expect(ok.lightness).toBeLessThan(unset.lightness);

    /*
     * The old Ok was the other way round: a darker step of the same green
     * (0.7 of hue, 18.8 of lightness), and that darkness is what took it
     * into Error's red for protanopes.
     */
    expect(hueDifference(oldOk, unset)).toBeLessThan(
      lightnessDifference(oldOk, unset),
    );
  });

  test("Ok and Error clear 3:1 on every light and dark surface", () => {
    /*
     * Measured on the light card and tertiary, then the dark card, secondary
     * and tertiary: Ok 3.68, 3.35, 4.42, 3.97, 3.41; Error 3.76, 3.42, 4.32,
     * 3.89, 3.33.
     */
    for (const presentation of [OK, ERROR]) {
      expect({
        status: presentation.label,
        below: contrastsBelow(presentation.color, GRAPHICS_CONTRAST, SURFACES),
      }).toEqual({ status: presentation.label, below: [] });
    }
  });

  test("Unset clears 3:1 on the dark surfaces, and keeps its documented relief on the light ones", () => {
    // Measured: 6.41 on the dark card, 5.77 on the secondary, 4.95 on the tertiary.
    expect(
      contrastsBelow(UNSET.color, GRAPHICS_CONTRAST, DARK_SURFACES),
    ).toEqual([]);

    /*
     * Emerald-500 is 2.54 on the light card and 2.31 on the light tertiary,
     * under 3:1, so the legend and facet names carry it there.
     */
    expect(contrastRatio(UNSET.color, LIGHT_CARD.color)).toBeGreaterThanOrEqual(
      UNSET_LIGHT_CARD_FLOOR,
    );
    expect(
      contrastRatio(UNSET.color, LIGHT_TERTIARY.color),
    ).toBeGreaterThanOrEqual(UNSET_LIGHT_TERTIARY_FLOOR);
  });

  test("REGRESSION: the old darker-green Ok sat under 3:1 on every dark surface", () => {
    // It had room to spare on the light ones: 5.48 on the card, 4.98 on the tertiary.
    expect(
      contrastsBelow(OLD_DARK_GREEN_OK, GRAPHICS_CONTRAST, SURFACES),
    ).toEqual([
      "dark card 2.97:1",
      "dark secondary 2.67:1",
      "dark tertiary 2.29:1",
    ]);
  });

  test("REGRESSION: the old grey Unset next to Ok fails the colour-vision and chroma bars", () => {
    // The chart used to stack Unset #9ca3af (Tailwind gray-400) on Ok #10b981.
    const oldOk: string = "#10b981";
    const oldUnset: string = "#9ca3af";

    // Full colour vision told them apart (15.4)...
    expect(deltaE(oldOk, oldUnset)).toBeGreaterThanOrEqual(NORMAL_VISION_FLOOR);
    // ...but they had the same lightness, so deuteranopia all but merged them (5.7).
    expect(contrastRatio(oldOk, oldUnset)).toBeLessThan(1.01);
    expect(deltaE(oldOk, oldUnset, DEUTERANOPIA)).toBeLessThan(RED_GREEN_FLOOR);
    expect(redGreenDeltaE(oldOk, oldUnset)).toBeLessThan(RED_GREEN_FLOOR);
    // And the grey has next to no chroma (0.019).
    expect(toOkLch(oldUnset).chroma).toBeLessThan(CHROMA_FLOOR);
  });
});
