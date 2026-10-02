import * as BrandColors from "../../../Types/BrandColors";
import Color, { RGB } from "../../../Types/Color";
import Dictionary from "../../../Types/Dictionary";
import { getContrastRatio, parseColor } from "../../../Utils/ColorContrast";
import EmailColorUtil, {
  EMAIL_COLOR_SURFACE,
  EMAIL_COLOR_TEXT_CONTRAST,
  EmailColorPair,
} from "../../../Utils/Email/EmailColorUtil";
import { describe, expect, test } from "@jest/globals";

/*
 * Every email that names a severity, a state or a monitor status paints it
 * with the colour a project configured for it: a dot in the colour itself and
 * the name in that colour, or in the nearest shade of it that reads.
 *
 * Two promises are pinned here, because breaking either is silent:
 *
 *   1. NOTHING BUT A COLOUR REACHES A STYLE ATTRIBUTE. The Color type keeps
 *      any string it is handed and the API accepts any string for it, while
 *      Handlebars escapes HTML, not CSS. So whatever a project typed, what a
 *      template receives is a #rrggbb this helper wrote - or nothing.
 *   2. THE NAME READS. A pale yellow "Low" on the email's light chips is
 *      decoration, not information; the text shade must clear WCAG AA on
 *      every surface the emails put it on, while the dot keeps the true
 *      colour.
 */

const HEX_OUTPUT: RegExp = /^#[0-9a-f]{6}$/;

// Every light surface a coloured name sits on in the emails.
const EMAIL_SURFACES: Array<[string, RGB]> = [
  ["rollup chip #eef2f7", { red: 238, green: 242, blue: 247 }],
  ["detail card #f8fafc", { red: 248, green: 250, blue: 252 }],
  ["white row #ffffff", { red: 255, green: 255, blue: 255 }],
  ["zebra row #f7f9fc", { red: 247, green: 249, blue: 252 }],
];

function hexToRgb(value: string): RGB {
  return parseColor(value)!;
}

// A deterministic spread over the whole colour space.
function sampleColors(count: number): Array<string> {
  const colors: Array<string> = [];
  let seed: number = 7;

  for (let index: number = 0; index < count; index++) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    colors.push(`#${(seed % 16777216).toString(16).padStart(6, "0")}`);
  }

  return colors;
}

const STOCK_COLORS: Array<string> = Object.values(BrandColors)
  .filter((value: unknown): value is Color => {
    return value instanceof Color;
  })
  .map((color: Color): string => {
    return color.toString();
  });

describe("EmailColorUtil.sanitize accepts colours, written any common way", () => {
  test.each([
    ["#ef4444", "#ef4444"],
    ["#EF4444", "#ef4444"],
    ["ef4444", "#ef4444"],
    ["  #ef4444  ", "#ef4444"],
    ["#f44", "#ff4444"],
    ["#F44", "#ff4444"],
    ["#ef4444cc", "#ef4444"],
    ["rgb(239, 68, 68)", "#ef4444"],
    ["rgb(239,68,68)", "#ef4444"],
    ["RGB(239, 68, 68)", "#ef4444"],
    ["rgb(239 68 68)", "#ef4444"],
    ["rgba(239, 68, 68, 0.5)", "#ef4444"],
    ["rgba(239, 68, 68, 1)", "#ef4444"],
    ["rgba(239, 68, 68, .25)", "#ef4444"],
    ["rgba(239, 68, 68, 50%)", "#ef4444"],
    ["rgb(239 68 68 / 50%)", "#ef4444"],
    ["rgb(0, 0, 0)", "#000000"],
    ["rgb(255, 255, 255)", "#ffffff"],
  ])("%p becomes %p", (input: string, expected: string) => {
    expect(EmailColorUtil.sanitize(input)).toBe(expected);
  });

  test("reads a Color, the type every severity and state stores", () => {
    expect(EmailColorUtil.sanitize(new Color("#22C55E"))).toBe("#22c55e");
  });

  test.each(STOCK_COLORS)(
    "keeps the stock colour %s exactly",
    (stock: string) => {
      expect(EmailColorUtil.sanitize(stock)).toBe(stock.toLowerCase());
    },
  );

  test("always writes its own lowercase #rrggbb", () => {
    for (const color of [...STOCK_COLORS, ...sampleColors(200)]) {
      expect(EmailColorUtil.sanitize(color)).toMatch(HEX_OUTPUT);
    }
  });
});

describe("EmailColorUtil.sanitize refuses anything that is not a colour", () => {
  test.each([null, undefined, "", "   "])("nothing: %p", (value: unknown) => {
    expect(
      EmailColorUtil.sanitize(value as string | null | undefined),
    ).toBeNull();
  });

  test.each([
    "red",
    "transparent",
    "currentColor",
    "inherit",
    "#12345",
    "#1234",
    "#ggg",
    "#ef44444",
    "rgb(300, 0, 0)",
    "rgb(1, 2)",
    "rgb(-1, 2, 3)",
    "rgb(1.5, 2, 3)",
    "hsl(0, 84%, 60%)",
    "var(--danger)",
  ])("a value it cannot read as hex or rgb(): %p", (value: string) => {
    expect(EmailColorUtil.sanitize(value)).toBeNull();
  });

  /*
   * The values that matter: each would have been a CSS or HTML injection had
   * it been placed in `style="color: {{color}};"`. parseColor alone reads the
   * front of an rgb() value and would have accepted the first rgb() case, so
   * the whole value is matched before anything is parsed.
   */
  test.each([
    "#fff; background-image: url(https://evil.example/track.gif)",
    "#fff;background:url(x)",
    "rgb(1, 2, 3); background: url(x)",
    "rgb(1, 2, 3) url(x)",
    "rgb(1,2,3))",
    '#fff" onmouseover="alert(1)',
    "#fff' onmouseover='alert(1)",
    "#fff><script>alert(1)</script>",
    "</style><script>alert(1)</script>",
    "expression(alert(1))",
    "url(javascript:alert(1))",
    "#fff\nposition: fixed",
    "#fff/**/;x:y",
    "#ef4444 !important",
    "{{color}}",
  ])("an injection attempt: %p", (value: string) => {
    expect(EmailColorUtil.sanitize(value)).toBeNull();
  });

  test("an object that only pretends to be a colour", () => {
    const impostor: Color = {
      toString: (): string => {
        return "#fff; position: fixed";
      },
    } as unknown as Color;

    expect(EmailColorUtil.sanitize(impostor)).toBeNull();
  });

  test("a very long value", () => {
    expect(EmailColorUtil.sanitize(`#${"f".repeat(10000)}`)).toBeNull();
  });
});

describe("EmailColorUtil.getColorPair", () => {
  test("keeps a colour that already reads for both the dot and the name", () => {
    const pair: EmailColorPair = EmailColorUtil.getColorPair("#1e3a8a")!;

    expect(pair).toEqual({ color: "#1e3a8a", textColor: "#1e3a8a" });
  });

  test("keeps black as it is", () => {
    expect(EmailColorUtil.getColorPair("#000000")).toEqual({
      color: "#000000",
      textColor: "#000000",
    });
  });

  test("darkens a pale yellow for the name and keeps it for the dot", () => {
    const pair: EmailColorPair = EmailColorUtil.getColorPair("#facc15")!;
    const yellow: RGB = hexToRgb("#facc15");
    const text: RGB = hexToRgb(pair.textColor);

    expect(pair.color).toBe("#facc15");
    expect(pair.textColor).not.toBe("#facc15");
    expect(getContrastRatio(text, EMAIL_COLOR_SURFACE)).toBeGreaterThanOrEqual(
      EMAIL_COLOR_TEXT_CONTRAST,
    );
    expect(getContrastRatio(yellow, EMAIL_COLOR_SURFACE)).toBeLessThan(
      EMAIL_COLOR_TEXT_CONTRAST,
    );
    // Still a yellow: red and green lead, blue trails.
    expect(text.red).toBeGreaterThan(text.blue);
    expect(text.green).toBeGreaterThan(text.blue);
  });

  test("darkens a mid green, keeping it green", () => {
    const text: RGB = hexToRgb(
      EmailColorUtil.getColorPair("#22c55e")!.textColor,
    );

    expect(text.green).toBeGreaterThan(text.red);
    expect(text.green).toBeGreaterThan(text.blue);
  });

  test("gives white a gray that reads, rather than an invisible name", () => {
    const pair: EmailColorPair = EmailColorUtil.getColorPair("#ffffff")!;
    const text: RGB = hexToRgb(pair.textColor);

    expect(pair.color).toBe("#ffffff");
    expect(text.red).toBe(text.green);
    expect(text.green).toBe(text.blue);
    expect(getContrastRatio(text, EMAIL_COLOR_SURFACE)).toBeGreaterThanOrEqual(
      EMAIL_COLOR_TEXT_CONTRAST,
    );
  });

  test("moves a shade no further than it needs to", () => {
    const text: RGB = hexToRgb(
      EmailColorUtil.getColorPair("#22c55e")!.textColor,
    );

    expect(getContrastRatio(text, EMAIL_COLOR_SURFACE)).toBeLessThan(
      EMAIL_COLOR_TEXT_CONTRAST + 0.3,
    );
  });

  test("works from an rgb() colour and from a Color", () => {
    expect(EmailColorUtil.getColorPair("rgb(250, 204, 21)")).toEqual(
      EmailColorUtil.getColorPair("#facc15"),
    );
    expect(EmailColorUtil.getColorPair(new Color("#FACC15"))).toEqual(
      EmailColorUtil.getColorPair("#facc15"),
    );
  });

  test.each([null, undefined, "", "red", "#fff;x:y"])(
    "has no pair for %p",
    (value: unknown) => {
      expect(
        EmailColorUtil.getColorPair(value as string | null | undefined),
      ).toBeNull();
    },
  );

  test("is deterministic", () => {
    expect(EmailColorUtil.getColorPair("#fd625e")).toEqual(
      EmailColorUtil.getColorPair("#fd625e"),
    );
  });

  describe.each(EMAIL_SURFACES)(
    "every name reads on the %s",
    (_label: string, surface: RGB) => {
      test("for the stock colours and 400 sampled ones", () => {
        for (const color of [...STOCK_COLORS, ...sampleColors(400)]) {
          const pair: EmailColorPair = EmailColorUtil.getColorPair(color)!;

          expect(pair.color).toBe(EmailColorUtil.sanitize(color));
          expect(pair.textColor).toMatch(HEX_OUTPUT);
          expect(
            getContrastRatio(hexToRgb(pair.textColor), surface),
          ).toBeGreaterThanOrEqual(EMAIL_COLOR_TEXT_CONTRAST);
        }
      });
    },
  );

  test("a colour that already reads is never changed", () => {
    for (const color of [...STOCK_COLORS, ...sampleColors(400)]) {
      const sanitized: string = EmailColorUtil.sanitize(color)!;

      if (
        getContrastRatio(hexToRgb(sanitized), EMAIL_COLOR_SURFACE) >=
        EMAIL_COLOR_TEXT_CONTRAST
      ) {
        expect(EmailColorUtil.getColorPair(color)!.textColor).toBe(sanitized);
      }
    }
  });
});

describe("EmailColorUtil.getTemplateVariables", () => {
  test("names both variables after the name they colour", () => {
    const vars: Dictionary<string> = EmailColorUtil.getTemplateVariables(
      "incidentSeverity",
      new Color("#facc15"),
    );

    expect(Object.keys(vars).sort()).toEqual([
      "incidentSeverityColor",
      "incidentSeverityTextColor",
    ]);
    expect(vars["incidentSeverityColor"]).toBe("#facc15");
    expect(vars["incidentSeverityTextColor"]).toBe(
      EmailColorUtil.getColorPair("#facc15")!.textColor,
    );
  });

  test.each([
    "currentState",
    "previousState",
    "alertSeverity",
    "episodeSeverity",
    "alertEpisodeSeverity",
    "incidentEpisodeSeverity",
    "incidentState",
    "episodeState",
    "eventState",
    "currentStatus",
    "previousStatus",
  ])("works for %s", (name: string) => {
    expect(EmailColorUtil.getTemplateVariables(name, "#3b82f6")).toEqual({
      [`${name}Color`]: "#3b82f6",
      [`${name}TextColor`]: EmailColorUtil.getColorPair("#3b82f6")!.textColor,
    });
  });

  test.each([null, undefined, "", "red", "rgb(1, 2, 3); x: y"])(
    "is empty when there is no usable colour (%p), so a spread adds nothing",
    (value: unknown) => {
      const vars: Dictionary<string> = {
        incidentSeverity: "Critical",
        ...EmailColorUtil.getTemplateVariables(
          "incidentSeverity",
          value as string | null | undefined,
        ),
      };

      expect(vars).toEqual({ incidentSeverity: "Critical" });
    },
  );

  test("never hands a template anything but #rrggbb", () => {
    for (const color of [
      ...STOCK_COLORS,
      ...sampleColors(100),
      "rgb(10, 20, 30)",
      "#ABC",
    ]) {
      for (const value of Object.values(
        EmailColorUtil.getTemplateVariables("currentState", color),
      )) {
        expect(value).toMatch(HEX_OUTPUT);
      }
    }
  });
});
