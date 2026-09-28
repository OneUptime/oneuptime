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
 * OpenTelemetry's default: the span finished and no error was recorded. So
 * it has to read as healthy - green, and "Unset (no error)" where there is
 * room - never the grey that made a healthy service look "mostly unknown"
 * (#4118). The stored codes, the "Unset" name and `status:unset` stay as
 * they are.
 *
 * The last two blocks measure the chart colours, with colour math written in
 * this file from the published formulas, in the order the Traces chart
 * stacks them (Ok, Unset, Error), so the pairs checked are series that touch:
 * - Delta E is the OKLab distance between two colours x100; about 2 is just
 *   noticeable. Touching series need 15 with full colour vision, and 8 under
 *   simulated protanopia and deuteranopia (Machado et al. 2009 at full
 *   severity), the worst case of the red-green colour blindness about 1 man
 *   in 12 has.
 * - OKLCH chroma under 0.10 reads as grey, whatever the hue.
 * - Contrast is WCAG 2's ratio against the card the chart sits on. Those
 *   floors are today's measurements less a small margin. Unset on the light
 *   card and Ok on the dark one sit under the 3:1 WCAG asks of graphics, so
 *   the legend's names carry them: a change can do better, not quietly worse.
 */

// The app's card surfaces: Theme.css --ou-surface-primary, light and dark.
const LIGHT_CARD: string = "#ffffff";
const DARK_CARD: string = "#172033";
const LIGHT_CARD_TOKEN: RegExp =
  /:root\s*\{[^}]*?--ou-surface-primary:\s*(#[0-9a-fA-F]{6})\s*;/;
const DARK_CARD_TOKEN: RegExp =
  /html\.dark\s*\{[^}]*?--ou-surface-primary:\s*(#[0-9a-fA-F]{6})\s*;/;

const NORMAL_VISION_FLOOR: number = 15;
const RED_GREEN_FLOOR: number = 8;
const CHROMA_FLOOR: number = 0.1;
const LIGHT_CARD_CONTRAST_FLOOR: number = 2.5;
const DARK_CARD_CONTRAST_FLOOR: number = 2.9;

// OKLCH hues that read as green: Tailwind's green to emerald, not lime or teal.
const GREEN_HUE_MIN: number = 140;
const GREEN_HUE_MAX: number = 175;

const HEX_COLOR: RegExp = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/;

// One full Tailwind colour utility: kind, colour family, shade.
const TAILWIND_COLOR_CLASS: RegExp =
  /^(bg|text|ring)-([a-z]+)-(50|[1-9]00|950)$/;

// One or more sentences: a capital, single-spaced words, a full stop.
const SENTENCE: string = "[A-Z][^\\s.!?]*(?: [^\\s.!?]+)*[.!?]";
const SENTENCES: RegExp = new RegExp(`^${SENTENCE}(?: ${SENTENCE})*$`);

// A class name built from a template, such as bg-${family}-500.
const TEMPLATE_CLASS_FRAGMENT: RegExp = /(?:bg|text|ring)-[a-z0-9-]*\$\{/;

const REGEX_SPECIAL_CHARACTERS: RegExp = /[.*+?^${}()|[\]\\]/g;
const BLOCK_COMMENT: RegExp = /\/\*[\s\S]*?\*\//g;

type ClassField =
  | "dotClassName"
  | "ringClassName"
  | "barClassName"
  | "barTrackClassName"
  | "pillClassName";

const CLASS_FIELDS: Array<ClassField> = [
  "dotClassName",
  "ringClassName",
  "barClassName",
  "barTrackClassName",
  "pillClassName",
];

// The slots painted in the status's own colour; the bar track is the empty rail.
const STATUS_COLORED_FIELDS: Array<ClassField> = [
  "dotClassName",
  "ringClassName",
  "barClassName",
  "pillClassName",
];

// The light tints; the dot and bar are the series colour itself.
const TINT_FIELDS: Array<ClassField> = [
  "ringClassName",
  "barTrackClassName",
  "pillClassName",
];

// What each slot sets, in order: the pill is a background plus a text colour.
const FIELD_UTILITIES: Record<ClassField, Array<string>> = {
  dotClassName: ["bg"],
  ringClassName: ["ring"],
  barClassName: ["bg"],
  barTrackClassName: ["bg"],
  pillClassName: ["bg", "text"],
};

/*
 * Tailwind 3.4's default shades for the dot and bar classes: the Dashboard
 * loads tailwind-3.4.5 with no colour overrides.
 */
const TAILWIND_SHADES: Record<string, string> = {
  "bg-emerald-500": "#10b981",
  "bg-emerald-700": "#047857",
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

/*
 * The selector of every rule that applies under html.dark. Splitting on "}"
 * leaves each rule's selector just before its "{", inside @media too.
 */
const DARK_THEME_SELECTORS: Array<string> = THEME_CSS.split("}")
  .map((chunk: string): string => {
    const parts: Array<string> = chunk.split("{");
    return parts.length > 1 ? parts[parts.length - 2]! : "";
  })
  .filter((selector: string): boolean => {
    return selector.includes("html.dark");
  });

function escapeRegExp(text: string): string {
  return text.replace(REGEX_SPECIAL_CHARACTERS, "\\$&");
}

function hasDarkThemeRule(className: string): boolean {
  // Followed by a non-identifier character, so bg-red-50 is not bg-red-500.
  const classSelector: RegExp = new RegExp(
    `\\.${escapeRegExp(className)}(?![\\w-])`,
  );

  return DARK_THEME_SELECTORS.some((selector: string): boolean => {
    return classSelector.test(selector);
  });
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

type SeriesPair = [SpanStatusPresentation, SpanStatusPresentation];

// Series that touch in the stacked chart, bottom to top.
function touchingPairs(): Array<SeriesPair> {
  const pairs: Array<SeriesPair> = [];

  for (
    let index: number = 1;
    index < SPAN_STATUS_PRESENTATIONS.length;
    index++
  ) {
    pairs.push([
      SPAN_STATUS_PRESENTATIONS[index - 1]!,
      SPAN_STATUS_PRESENTATIONS[index]!,
    ]);
  }

  return pairs;
}

function pairName(pair: SeriesPair): string {
  return `${pair[0].label}/${pair[1].label}`;
}

// "Ok/Unset: 7.2" for every touching pair that measures under the floor.
function pairsBelow(
  floor: number,
  measure: (first: string, second: string) => number,
): Array<string> {
  return touchingPairs()
    .filter((pair: SeriesPair): boolean => {
      return measure(pair[0].color, pair[1].color) < floor;
    })
    .map((pair: SeriesPair): string => {
      return `${pairName(pair)}: ${measure(pair[0].color, pair[1].color).toFixed(1)}`;
    });
}

// "Ok 2.41:1" for every series under the floor on the given card.
function seriesBelowContrast(card: string, floor: number): Array<string> {
  return SPAN_STATUS_PRESENTATIONS.filter(
    (presentation: SpanStatusPresentation): boolean => {
      return contrastRatio(presentation.color, card) < floor;
    },
  ).map((presentation: SpanStatusPresentation): string => {
    return `${presentation.label} ${contrastRatio(presentation.color, card).toFixed(2)}:1`;
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

  test("REGRESSION: Unset's display label says no error was recorded", () => {
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
      "1": "#047857",
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

  test("REGRESSION: Unset's dot, ring, bar and pill are Ok's green, with no grey", () => {
    // They were bg-gray-300, ring-gray-100, bg-gray-400, bg-gray-50 text-gray-500.
    for (const field of STATUS_COLORED_FIELDS) {
      expect({ field, families: familiesOf(UNSET[field]) }).toEqual({
        field,
        families: familiesOf(OK[field]),
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

  test("every tint has a dark theme rule in Theme.css", () => {
    /*
     * A light tint with no html.dark rule keeps its light colour on the dark
     * card. The dot and bar are the series colour itself, measured against
     * the dark card below.
     */
    const unmapped: Array<string> = [];

    for (const presentation of SPAN_STATUS_PRESENTATIONS) {
      for (const field of TINT_FIELDS) {
        for (const className of presentation[field].split(" ")) {
          if (!hasDarkThemeRule(className)) {
            unmapped.push(`${presentation.label} ${field}: ${className}`);
          }
        }
      }
    }

    // The lookup found the dark rules and matches whole class names only.
    expect(DARK_THEME_SELECTORS.length).toBeGreaterThan(100);
    expect(hasDarkThemeRule("bg-emerald-5")).toBe(false);
    expect(unmapped).toEqual([]);
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
  test("the cards measured against are the app's own card surfaces", () => {
    const lightCard: RegExpExecArray | null = LIGHT_CARD_TOKEN.exec(THEME_CSS);
    const darkCard: RegExpExecArray | null = DARK_CARD_TOKEN.exec(THEME_CSS);

    expect(lightCard?.[1]?.toLowerCase()).toBe(LIGHT_CARD);
    expect(darkCard?.[1]?.toLowerCase()).toBe(DARK_CARD);
  });

  test("touching series stay apart with full colour vision", () => {
    expect(touchingPairs().map(pairName)).toEqual(["Ok/Unset", "Unset/Error"]);
    // Measured: Ok/Unset 19.3, Unset/Error 33.8.
    expect(pairsBelow(NORMAL_VISION_FLOOR, deltaE)).toEqual([]);
  });

  test("touching series stay apart under protanopia and deuteranopia", () => {
    // Measured, the worse of the two: Ok/Unset 18.9, Unset/Error 8.1 (deutan).
    expect(pairsBelow(RED_GREEN_FLOOR, redGreenDeltaE)).toEqual([]);
  });

  test("no series reads as grey", () => {
    // Measured chroma: Ok 0.105, Unset 0.149, Error 0.208.
    const greyish: Array<string> = SPAN_STATUS_PRESENTATIONS.filter(
      (presentation: SpanStatusPresentation): boolean => {
        return toOkLch(presentation.color).chroma < CHROMA_FLOOR;
      },
    ).map((presentation: SpanStatusPresentation): string => {
      return `${presentation.label} ${toOkLch(presentation.color).chroma.toFixed(3)}`;
    });

    expect(greyish).toEqual([]);
  });

  test("REGRESSION: Unset is a saturated green, like Ok, and Error stays red", () => {
    // Measured hue: Unset 162.5, Ok 165.6, Error 25.3.
    for (const presentation of [UNSET, OK]) {
      const color: OkLch = toOkLch(presentation.color);

      expect(color.chroma).toBeGreaterThanOrEqual(CHROMA_FLOOR);
      expect(color.hue).toBeGreaterThanOrEqual(GREEN_HUE_MIN);
      expect(color.hue).toBeLessThanOrEqual(GREEN_HUE_MAX);
    }

    expect(toOkLch(ERROR.color).hue).toBeLessThan(45);
  });

  test("explicit Ok is the darker green, so it reads as the stronger success", () => {
    // Measured OKLCH lightness: Ok 0.508, Unset 0.696.
    expect(toOkLch(OK.color).lightness).toBeLessThan(
      toOkLch(UNSET.color).lightness,
    );
  });

  test("every series stays visible on the light card", () => {
    // Measured: Unset 2.54, Error 3.76, Ok 5.48.
    expect(seriesBelowContrast(LIGHT_CARD, LIGHT_CARD_CONTRAST_FLOOR)).toEqual(
      [],
    );
  });

  test("every series stays visible on the dark card", () => {
    // Measured: Ok 2.97, Error 4.32, Unset 6.41.
    expect(seriesBelowContrast(DARK_CARD, DARK_CARD_CONTRAST_FLOOR)).toEqual(
      [],
    );
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
