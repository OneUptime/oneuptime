import {
  DEFAULT_BACKGROUND_COLOR,
  DEFAULT_TEXT_COLOR,
  INVALID_COLOR,
  LOW_CONTRAST_DISTANCE,
  LowContrastText,
  colorDistance,
  lowContrastText,
  readBackgroundLayers,
  readColor,
} from "./SpamAssassinTextColors";
import { FastestRun, fastestRun } from "./FastestRun";
import { describe, expect, test } from "@jest/globals";

/*
 * THE GUARD READS TEXT COLOURS AS SPAMASSASSIN DOES (SpamAssassinTextColors).
 *
 * The App suite EmailTextContrast holds every email template to this
 * reading, so it has to be SpamAssassin's own, quirks and all: here it is
 * held to what SpamAssassin itself answered. Each case below was sent, as
 * a one-part HTML email, to SpamAssassin 4.0.1 (Debian bookworm's
 * spamassassin package, local tests only: spamassassin -L -t) on
 * 2026-10-31, and its verdict - whether it scored HTML_FONT_LOW_CONTRAST -
 * recorded beside it. The reading agrees with all of them.
 */

interface RecordedCase {
  name: string;
  // The email's body, inside <body>.
  html: string;
  // Whether SpamAssassin 4.0.1 scored the email HTML_FONT_LOW_CONTRAST.
  spamAssassinScoresIt: boolean;
}

const RECORDED: Array<RecordedCase> = [
  {
    name: "old-preheader",
    html: '<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#f1f5f9;opacity:0;">Acme uptime report</div><p>Hello there, this is the body.</p>',
    spamAssassinScoresIt: true,
  },
  {
    name: "new-preheader",
    html: '<div style="display: none; max-height: 0; overflow: hidden; opacity: 0; mso-hide: all;">Acme uptime report</div><p>Hello there, this is the body.</p>',
    spamAssassinScoresIt: false,
  },
  {
    name: "white-on-bgcolor-attribute",
    html: '<table><tr><td bgcolor="#2563eb"><a href="https://x.example" style="color:#ffffff;">View incident</a></td></tr></table>',
    spamAssassinScoresIt: true,
  },
  {
    name: "white-on-background-color",
    html: '<table><tr><td style="background-color:#2563eb;"><a href="https://x.example" style="color:#ffffff;">View incident</a></td></tr></table>',
    spamAssassinScoresIt: false,
  },
  {
    name: "white-on-background-shorthand",
    html: '<table><tr><td style="background:#2563eb url(x.png) no-repeat;"><span style="color:#fff">View incident</span></td></tr></table>',
    spamAssassinScoresIt: false,
  },
  {
    name: "white-on-uppercase-background-shorthand",
    html: '<table><tr><td style="BACKGROUND:#2563eb;"><span style="color:#fff">View incident</span></td></tr></table>',
    spamAssassinScoresIt: true,
  },
  {
    name: "near-white-grey-on-white",
    html: '<p style="color:#f1f5f9;">Barely there words</p>',
    spamAssassinScoresIt: true,
  },
  {
    name: "light-grey-on-white",
    html: '<p style="color:#cbd5e1;">Light but readable words</p>',
    spamAssassinScoresIt: false,
  },
  {
    name: "h1-colour-ignored",
    html: '<div style="background-color:#0f172a;"><h1 style="color:#ffffff;">Dark header</h1></div>',
    spamAssassinScoresIt: false,
  },
  {
    name: "rgb-values",
    html: '<p style="color: rgb(250, 250, 250);">Words in rgb</p>',
    spamAssassinScoresIt: true,
  },
  {
    name: "rgba-values",
    html: '<div style="background-color:#000000"><p style="color: rgba(0, 0, 0, 0.5);">Words in rgba</p></div>',
    spamAssassinScoresIt: true,
  },
  {
    name: "named-white",
    html: '<p style="color:white;">Named white words</p>',
    spamAssassinScoresIt: true,
  },
  {
    name: "transparent-text",
    html: '<p style="color:transparent;">Transparent words</p>',
    spamAssassinScoresIt: true,
  },
  {
    name: "transparent-background",
    html: '<div style="background-color:#ffffff;"><p style="background-color:transparent;color:#fefefe;">Words on transparent</p></div>',
    spamAssassinScoresIt: true,
  },
  {
    name: "important",
    html: '<p style="color:#fafafa !important;">Important words</p>',
    spamAssassinScoresIt: true,
  },
  {
    name: "font-color",
    html: '<font color="#fdfdfd">Font words</font>',
    spamAssassinScoresIt: true,
  },
  {
    name: "body-text",
    html: '<body text="#fcfcfc">Body words</body>',
    spamAssassinScoresIt: true,
  },
  {
    name: "td-closes-font",
    html: '<table><tr><td><font color="#fefefe"><td>Second cell words</td></tr></table>',
    spamAssassinScoresIt: false,
  },
  {
    name: "end-tag-closes-what-it-holds",
    html: '<div><span style="color:#fefefe;"></div><p>After words</p>',
    spamAssassinScoresIt: false,
  },
  {
    name: "dark-text-on-bgcolor-attribute",
    html: '<table><tr><td bgcolor="#0f172a"><p style="color:#111827;">Dark words</p></td></tr></table>',
    spamAssassinScoresIt: false,
  },
  {
    name: "h1-white-ignored",
    html: '<h1 style="color:#ffffff;">Title words</h1>',
    spamAssassinScoresIt: false,
  },
  {
    name: "style-rgb-percent",
    html: '<p style="color: rgb(98%, 98%, 98%);">Percent words</p>',
    spamAssassinScoresIt: false,
  },
  {
    name: "background-rgb-percent",
    html: '<div style="background: rgb(0%, 0%, 0%);"><p style="color:#000000;">Black on black</p></div>',
    spamAssassinScoresIt: true,
  },
  {
    name: "strong-colour-ignored",
    html: '<p>Plain <strong style="color:#ffffff;">strong words</strong> here</p>',
    spamAssassinScoresIt: false,
  },
  {
    name: "short-hex",
    html: '<p style="color:#eee;">Short hex words</p>',
    spamAssassinScoresIt: false,
  },
  {
    name: "dark-on-dark",
    html: '<div style="background-color:#0f172a;"><p style="color:#111827;">Dark on dark</p></div>',
    spamAssassinScoresIt: true,
  },
  {
    name: "nbsp-only",
    html: '<p style="color:#ffffff;">&nbsp;</p><p>Body words</p>',
    spamAssassinScoresIt: false,
  },
  {
    name: "comment-only",
    html: '<!--[if mso]><p style="color:#ffffff;">Outlook words</p><![endif]--><p>Body words</p>',
    spamAssassinScoresIt: false,
  },
  {
    name: "style-element",
    html: '<style>p { color: #ffffff; }</style><p>Body words</p>',
    spamAssassinScoresIt: false,
  },
  {
    name: "th-as-td",
    html: '<table><tr><th style="color:#fefefe;">Header words</th></tr></table>',
    spamAssassinScoresIt: true,
  },
  {
    name: "background-gradient",
    html: '<div style="background: linear-gradient(#000, #fff), #2563eb;"><p style="color:#ffffff;">Gradient words</p></div>',
    spamAssassinScoresIt: false,
  },
  {
    name: "background-colour-name",
    html: '<div style="background: navy;"><p style="color:#000080;">Navy words</p></div>',
    spamAssassinScoresIt: true,
  },
];

// The email each case was sent as, around its body.
const asEmailHtml: (html: string) => string = (html: string): string => {
  return `<!DOCTYPE html><html><head><title>Case</title></head>${
    html.startsWith("<body") ? html : `<body>${html}</body>`
  }</html>`;
};

describe("lowContrastText, held to SpamAssassin 4.0.1's own verdicts", () => {
  test("thirty-odd recorded cases: enough for this to mean something", () => {
    expect(RECORDED.length).toBeGreaterThanOrEqual(30);
    expect(
      RECORDED.filter((recorded: RecordedCase): boolean => {
        return recorded.spamAssassinScoresIt;
      }).length,
    ).toBeGreaterThanOrEqual(10);
  });

  test.each(RECORDED)(
    "$name",
    ({ html, spamAssassinScoresIt }: RecordedCase) => {
      expect(lowContrastText(asEmailHtml(html)).length > 0).toBe(
        spamAssassinScoresIt,
      );
    },
  );
});

describe("lowContrastText", () => {
  test("says which text, in which colours, and how close they are", () => {
    const found: Array<LowContrastText> = lowContrastText(
      '<div style="display:none;color:#f1f5f9;">Acme  uptime\nreport</div><p>Body</p>',
    );

    expect(found).toHaveLength(1);
    expect(found[0]!.text).toBe("Acme uptime report");
    expect(found[0]!.textColor).toBe("#f1f5f9");
    expect(found[0]!.backgroundColor).toBe(DEFAULT_BACKGROUND_COLOR);
    expect(found[0]!.distance).toBeGreaterThan(7);
    expect(found[0]!.distance).toBeLessThan(LOW_CONTRAST_DISTANCE);
  });

  test("display:none hides nothing from it: hidden text is read in its colours too", () => {
    expect(
      lowContrastText('<span style="display: none; color: #ffffff;">x</span>'),
    ).toHaveLength(1);
    expect(lowContrastText('<span style="display: none;">x</span>')).toEqual(
      [],
    );
  });

  test("text starts black on white, which is far apart", () => {
    expect(DEFAULT_TEXT_COLOR).toBe("#000000");
    expect(DEFAULT_BACKGROUND_COLOR).toBe("#ffffff");
    expect(lowContrastText("<p>Plain words</p>")).toEqual([]);
    expect(lowContrastText("Words with no element at all")).toEqual([]);
  });

  test("white on a colour set by background-color or background is not hidden; on one set by bgcolor alone it is", () => {
    expect(
      lowContrastText(
        '<table><tr><td style="background-color:#2563eb;"><a style="color:#ffffff;">View</a></td></tr></table>',
      ),
    ).toEqual([]);
    expect(
      lowContrastText(
        '<table><tr><td bgcolor="#2563eb" style="background-color:#2563eb;"><a style="color:#ffffff;">View</a></td></tr></table>',
      ),
    ).toEqual([]);
    expect(
      lowContrastText(
        '<table><tr><td bgcolor="#2563eb"><a style="color:#ffffff;">View</a></td></tr></table>',
      ),
    ).toHaveLength(1);
  });

  test("a colour an element does not carry for SpamAssassin is the colour around it", () => {
    expect(
      lowContrastText(
        '<div style="background-color:#ffffff;"><h1 style="color:#ffffff;">Title</h1><strong style="color:#fefefe;">Bold</strong></div>',
      ),
    ).toEqual([]);
  });

  test("an end tag closes what was left open inside its element", () => {
    expect(
      lowContrastText('<div><span style="color:#ffffff;"></div><p>After</p>'),
    ).toEqual([]);
    expect(
      lowContrastText(
        '<table><tr><td><font color="#ffffff"><td>Next cell</td></tr></table>',
      ),
    ).toEqual([]);
    // An end tag of nothing open closes nothing.
    expect(
      lowContrastText(
        '<div style="background-color:#000000;"></span><p style="color:#000000;">Black on black</p></div>',
      ),
    ).toHaveLength(1);
  });

  test("references are decoded before the words are counted", () => {
    expect(
      lowContrastText(
        '<p style="color:#ffffff;">&nbsp; &#160;</p><p style="color:#ffffff;">&amp;</p>',
      ).map((found: LowContrastText): string => {
        return found.text;
      }),
    ).toEqual(["&"]);
  });

  test("what styles, scripts and comments hold is never text", () => {
    expect(
      lowContrastText(
        '<style>p { color: #fff; }</style><script>var white = "#fff";</script><!-- <p style="color:#fff">x</p> --><!--[if mso]><p style="color:#fff">x</p><![endif]-->',
      ),
    ).toEqual([]);
  });

  test("an email of a hundred thousand elements takes well under two seconds", () => {
    const html: string = `<div style="background-color:#0f172a;">${'<p style="color:#e2e8f0;">Readable line of the report</p><span>'.repeat(
      50000,
    )}</div>`;

    const timed: FastestRun<Array<LowContrastText>> = fastestRun({
      run: (): Array<LowContrastText> => {
        return lowContrastText(html);
      },
      limitInMs: 2000,
    });

    expect(timed.inMs).toBeLessThan(2000);
    expect(timed.result).toEqual([]);
  });
});

describe("readColor, as SpamAssassin's name_to_rgb", () => {
  test("hex, short hex, names and rgb() values", () => {
    expect(readColor("#ABCDEF")).toBe("#abcdef");
    expect(readColor(" #fff ")).toBe("#ffffff");
    expect(readColor("#abcd")).toBe("#aabbcc");
    expect(readColor("#1234567")).toBe("#123456");
    expect(readColor("#12")).toBe("#112200");
    expect(readColor("white")).toBe("#ffffff");
    expect(readColor("NAVY")).toBe("#000080");
    expect(readColor("rebeccapurple")).toBe(INVALID_COLOR);
    expect(readColor("rgb(255, 0, 16)")).toBe("#ff0010");
    expect(readColor("rgb(100%, 50%, 0%)")).toBe("#ff7f00");
  });

  test("anything else is invalid, as SpamAssassin reads it", () => {
    expect(readColor("fff")).toBe(INVALID_COLOR);
    expect(readColor("transparent")).toBe(INVALID_COLOR);
    expect(readColor("var(--text)")).toBe(INVALID_COLOR);
    expect(readColor("rgba(0, 0, 0, 0.5)")).toBe(INVALID_COLOR);
    expect(readColor("")).toBe(INVALID_COLOR);
  });
});

describe("readBackgroundLayers, as SpamAssassin's parse_css_background", () => {
  test("values at spaces, layers at commas, never inside brackets or quotes", () => {
    expect(
      readBackgroundLayers(
        'url("a b.png") no-repeat, linear-gradient(#000, #fff) #2563eb',
      ),
    ).toEqual([
      ['url("a b.png")', "no-repeat"],
      ["linear-gradient(#000, #fff)", "#2563eb"],
    ]);
    expect(readBackgroundLayers("#ffffff")).toEqual([["#ffffff"]]);
    expect(readBackgroundLayers("")).toEqual([]);
  });
});

describe("colorDistance, as SpamAssassin's html_font_invisible", () => {
  test("the same colour is 0; black on white is the largest", () => {
    expect(colorDistance("#ffffff", "#ffffff")).toBe(0);
    expect(colorDistance("#000000", "#ffffff")).toBeCloseTo(191.15, 1);
  });

  test("green weighs most, then red, then blue", () => {
    expect(colorDistance("#00ff00", "#000000")).toBeCloseTo(0.7152 * 255, 5);
    expect(colorDistance("#ff0000", "#000000")).toBeCloseTo(0.2126 * 255, 5);
    expect(colorDistance("#0000ff", "#000000")).toBeCloseTo(0.0722 * 255, 5);
  });

  test("the uptime report's old preview line: under the limit on white", () => {
    expect(colorDistance("#f1f5f9", "#ffffff")).toBeLessThan(
      LOW_CONTRAST_DISTANCE,
    );
    expect(colorDistance("#cbd5e1", "#ffffff")).toBeGreaterThan(
      LOW_CONTRAST_DISTANCE,
    );
  });

  test("nothing to measure for a colour that is not one", () => {
    expect(colorDistance(INVALID_COLOR, "#ffffff")).toBeNull();
    // Two colours SpamAssassin could not read read as the same.
    expect(colorDistance(INVALID_COLOR, INVALID_COLOR)).toBe(0);
  });
});
