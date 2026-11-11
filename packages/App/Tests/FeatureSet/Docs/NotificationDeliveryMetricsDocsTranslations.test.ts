import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import {
  DocsFence,
  DocsHeading,
  DocsLink,
  hasPage,
  readPage,
  scanMarkdown,
} from "./DocsContentSupport";
import { drawnDashboardLabel, isDashboardLabel } from "./DocsDashboardLabels";
import {
  boldLabels,
  boldPaths,
  lineShape,
  stepCount,
  tabLabels,
  unbalancedLines,
} from "./DocsPageShape";
import { drawnPath, drawnPathSegment } from "./DocsProductsMenu";
import {
  CARD_LINE,
  anchorProblems,
  cardLines,
  cardTargets,
  comparableFence,
  diagramLabelLines,
  inlineCode,
  labelLineWidth,
  listItemCount,
  navTitle,
  prose,
  strayMarkers,
  tableShape,
  toLatinDigits,
} from "./DocsTranslationChecks";
import { describe, expect, it } from "@jest/globals";

/*
 * SELF HOSTED > NOTIFICATION DELIVERY METRICS (issue #6644), IN EVERY DOCS
 * LANGUAGE.
 *
 * NotificationDeliveryMetricsDocsFacts holds the English page to the code;
 * this suite holds each translation to the English page:
 *
 *   - line for line: every heading, table row, fence, tab and component on
 *     the English one's line, so a later English edit shows where it lands;
 *   - the same settings and commands word for word, and the same inline
 *     code: metric and attribute names, their values, settings and
 *     conditions are what a reader types, in every language;
 *   - every link on the English one's line, to the same page, its anchor a
 *     heading of the page it opens; the same cards, tabs, lists and steps;
 *   - the same numbers on every line: bucket edges, objectives, waits;
 *   - the diagram built as the English one, its metric names kept and no
 *     line of a label wider than the English diagram's widest, so it lays
 *     out in the docs column as the English one does;
 *   - every line of prose translated, under a title that is the nav link's;
 *   - the metrics explorer's labels and menu path as that language's
 *     Dashboard draws them (drawnDashboardLabel, drawnPath), Persian
 *     included: a bold span per segment joined by " > ", and no "→" left.
 */

const PAGE: string = "self-hosted/notification-delivery-metrics";
const NAV_TITLE: string = "Notification Delivery Metrics";

const LANGUAGES: Array<string> = SUPPORTED_DOCS_LANGUAGE_CODES.filter(
  (language: string): boolean => {
    return language !== "en";
  },
);

const ENGLISH: string = readPage("en", PAGE);

const FENCE_LINE: RegExp = /^\s*```/;
const INLINE_CODE_SPAN: RegExp = /`[^`\n]*`/g;
const LINK_TARGET: RegExp = /\]\([^)\s]*\)/g;
const LATIN_WORD: RegExp = /[A-Za-z]{4,}/g;
const NUMBER: RegExp = /\d+(?:\.\d+)?/g;
// \s takes the no-break spaces French and others group digits with.
const DIGIT_GROUP: RegExp = /(\d)[\s.,'٬](\d{3})(?!\d)/g;
const DECIMAL_MARK: RegExp = /(\d)[,٫](\d)/g;
const METRIC_NAME: RegExp = /notification\.[a-z_.]*[a-z]/g;
const RIGHT_ARROW: string = "→";

/*
 * Names every language writes as they are, longest first: a line of them
 * and code is not an untranslated line.
 */
const NAMES: Array<string> = [
  "OpenTelemetry",
  "OneUptime",
  "Docker Compose",
  "Kubernetes",
  "Prometheus",
  "Microsoft Teams",
  "Mattermost",
  "WhatsApp",
  "Telegram",
  "Twilio",
  "Google",
  "Apple",
  "Slack",
  "Expo",
  "Meta",
].sort((a: string, b: string): number => {
  return b.length - a.length;
});

// The text of a page's lines outside its fences, by line number.
function proseLines(markdown: string): Array<[number, string]> {
  const lines: Array<[number, string]> = [];
  let inFence: boolean = false;

  markdown.split("\n").forEach((line: string, index: number): void => {
    if (FENCE_LINE.test(line)) {
      inFence = !inFence;
      return;
    }

    if (!inFence) {
      lines.push([index + 1, line]);
    }
  });

  return lines;
}

// Whether a line reads as English: three Latin words of four letters or more.
function isUntranslatedText(line: string): boolean {
  let text: string = line
    .replace(INLINE_CODE_SPAN, " ")
    .replace(LINK_TARGET, "]");

  for (const name of NAMES) {
    text = text.split(name).join(" ");
  }

  return (text.match(LATIN_WORD) || []).length >= 3;
}

// The lines of a translation still the English line in their place.
function untranslatedLines(language: string): Array<string> {
  const translated: Array<string> = readPage(language, PAGE).split("\n");

  return proseLines(ENGLISH)
    .filter((entry: [number, string]): boolean => {
      const [number, line] = entry;

      return (
        number > 1 &&
        line === translated[number - 1] &&
        isUntranslatedText(line)
      );
    })
    .map((entry: [number, string]): string => {
      return `${entry[0]}: ${entry[1]}`;
    });
}

/*
 * A text with its numbers' digit groups joined: 1,000,000 to 1000000. One
 * pass joins every other group, so it runs until nothing changes.
 */
function withoutDigitGroups(text: string): string {
  let joined: string = text;
  let previous: string = "";

  while (joined !== previous) {
    previous = joined;
    joined = joined.replace(DIGIT_GROUP, "$1$2");
  }

  return joined;
}

// The numbers a line states, code and link targets left out, sorted.
function numbersIn(line: string): Array<string> {
  return Array.from(
    withoutDigitGroups(
      toLatinDigits(
        line.replace(INLINE_CODE_SPAN, " ").replace(LINK_TARGET, "]"),
      ),
    )
      .replace(DECIMAL_MARK, "$1.$2")
      .matchAll(NUMBER),
  )
    .map((match: RegExpMatchArray): string => {
      return match[0];
    })
    .sort();
}

// The numbers of every line outside the fences: "line: n, n".
function numbersByLine(markdown: string): Array<string> {
  return proseLines(markdown)
    .map((entry: [number, string]): string => {
      return `${entry[0]}: ${numbersIn(entry[1]).join(", ")}`;
    })
    .filter((text: string): boolean => {
      return !text.endsWith(": ");
    });
}

// Every link of a page: "line: page", its anchor left to anchorProblems.
function linkedPagesByLine(markdown: string): Array<string> {
  return scanMarkdown(markdown).links.map((link: DocsLink): string => {
    return `${link.line}: ${link.target.startsWith("#") ? "#" : link.target.split("#")[0]}`;
  });
}

// The diagram of a page.
function diagram(markdown: string): DocsFence {
  const found: Array<DocsFence> = scanMarkdown(markdown).fences.filter(
    (fence: DocsFence): boolean => {
      return fence.lang === "mermaid";
    },
  );

  expect(found).toHaveLength(1);

  return found[0] as DocsFence;
}

// The metric names a diagram draws, sorted.
function metricNamesIn(code: string): Array<string> {
  return Array.from(code.matchAll(METRIC_NAME))
    .map((match: RegExpMatchArray): string => {
      return match[0];
    })
    .sort();
}

/*
 * Every bold label and menu path of the English page as this language's
 * Dashboard draws it: [English bold, drawn bold]. A Persian path is one
 * bold span per segment, joined by " > ".
 */
function boldDrawings(language: string): Array<[string, string]> {
  return [
    ...boldLabels(ENGLISH).map((label: string): [string, string] => {
      return [`**${label}**`, `**${drawnDashboardLabel(language, label)}**`];
    }),
    ...boldPaths(ENGLISH).map((segments: Array<string>): [string, string] => {
      return [drawnPath("en", segments), drawnPath(language, segments)];
    }),
  ];
}

describe("the English page", () => {
  it("bolds only Dashboard labels and one menu path, so every language can draw them", () => {
    for (const label of boldLabels(ENGLISH)) {
      expect({ label, drawn: isDashboardLabel(label) }).toEqual({
        label,
        drawn: true,
      });
    }

    expect(boldPaths(ENGLISH)).toEqual([
      ["Actions", "Create monitor from this view"],
    ]);
  });

  it("has no two headings with the same anchor, and skips no level", () => {
    const headings: Array<DocsHeading> = scanMarkdown(ENGLISH).headings;
    const slugs: Array<string> = headings.map((heading: DocsHeading) => {
      return heading.slug;
    });

    expect(slugs.length).toBe(new Set(slugs).size);

    headings.forEach((heading: DocsHeading, index: number): void => {
      const previous: number =
        index === 0 ? 1 : (headings[index - 1] as DocsHeading).level;

      expect({
        heading: heading.text,
        skips: heading.level > previous + 1,
      }).toEqual({ heading: heading.text, skips: false });
    });
  });

  it("declares a language on every fence, and draws one diagram", () => {
    for (const fence of scanMarkdown(ENGLISH).fences) {
      expect({ line: fence.line, lang: fence.lang }).toEqual({
        line: fence.line,
        lang: expect.stringMatching(/^[a-z]+$/),
      });
    }

    expect(metricNamesIn(diagram(ENGLISH).code).length).toBeGreaterThan(5);
  });

  it("closes every bold and code span it opens", () => {
    expect(unbalancedLines(ENGLISH)).toEqual([]);
  });
});

describe.each(LANGUAGES)("%s", (language: string) => {
  const translated: () => string = (): string => {
    return readPage(language, PAGE);
  };

  it("is translated, under the nav link's title", () => {
    expect(hasPage(language, PAGE)).toBe(true);

    const title: string = navTitle(language, NAV_TITLE);

    expect(typeof title).toBe("string");
    expect(title).not.toBe(NAV_TITLE);
    expect(translated().split("\n")[0]).toBe(`# ${title}`);
  });

  it("lies line for line beside the English page", () => {
    expect(lineShape(translated())).toEqual(lineShape(ENGLISH));
  });

  it("translates every line of prose", () => {
    expect(untranslatedLines(language)).toEqual([]);
  });

  it("keeps every setting and command word for word, and the diagram's build", () => {
    expect(scanMarkdown(translated()).fences.map(comparableFence)).toEqual(
      scanMarkdown(ENGLISH).fences.map(comparableFence),
    );
  });

  it("keeps every piece of inline code: metrics, attributes, values, settings and conditions", () => {
    expect(inlineCode(translated())).toEqual(inlineCode(ENGLISH));
  });

  it("states the numbers of every line", () => {
    expect(numbersByLine(translated())).toEqual(numbersByLine(ENGLISH));
  });

  it("has the English page's headings, tabs, steps, tables and list items", () => {
    const levels: (markdown: string) => Array<number> = (
      markdown: string,
    ): Array<number> => {
      return scanMarkdown(markdown).headings.map((heading: DocsHeading) => {
        return heading.level;
      });
    };

    expect(levels(translated())).toEqual(levels(ENGLISH));
    expect(tabLabels(translated())).toEqual(tabLabels(ENGLISH));
    expect(stepCount(translated())).toBe(stepCount(ENGLISH));
    expect(tableShape(translated())).toEqual(tableShape(ENGLISH));
    expect(listItemCount(translated())).toBe(listItemCount(ENGLISH));
  });

  it("gives every heading an anchor of its own", () => {
    const slugs: Array<string> = scanMarkdown(translated()).headings.map(
      (heading: DocsHeading): string => {
        return heading.slug;
      },
    );

    expect(slugs.length).toBe(new Set(slugs).size);
  });

  it("writes its cards with an ASCII ': ' after the link, to the English cards' pages", () => {
    const lines: Array<string> = cardLines(translated());

    expect(lines.length).toBe(cardLines(ENGLISH).length);

    for (const line of lines) {
      expect({ line, ascii: CARD_LINE.test(line) }).toEqual({
        line,
        ascii: true,
      });
    }

    expect(cardTargets(lines)).toEqual(cardTargets(cardLines(ENGLISH)));
  });

  it("has every link on the English one's line, to the same page", () => {
    expect(linkedPagesByLine(translated())).toEqual(linkedPagesByLine(ENGLISH));
  });

  it("links only to anchors that are headings of the page they open", () => {
    expect(anchorProblems(language, PAGE)).toEqual([]);
  });

  it("closes every bold and code span it opens", () => {
    expect(unbalancedLines(translated())).toEqual([]);
  });

  it("draws every bold span, with no asterisks or underscores left on the page", async () => {
    expect(await strayMarkers(translated(), language)).toEqual([]);
  });

  it("names the metrics explorer's labels and menu path as this language's Dashboard draws them", () => {
    const page: string = translated();
    const missing: Array<string> = boldDrawings(language)
      .map((drawing: [string, string]): string => {
        return drawing[1];
      })
      .filter((drawn: string): boolean => {
        return !page.includes(drawn);
      });

    expect(missing).toEqual([]);
  });

  it("leaves no label in English where this language's Dashboard draws it otherwise", () => {
    const page: string = translated();
    const drawings: Array<[string, string]> = boldDrawings(language);
    const meant: Set<string> = new Set(
      drawings.map((drawing: [string, string]): string => {
        return drawing[1];
      }),
    );

    if (language === "fa") {
      for (const segments of boldPaths(ENGLISH)) {
        segments.forEach((_segment: string, index: number): void => {
          meant.add(`**${drawnPathSegment(language, segments, index)}**`);
        });
      }
    }

    const leftover: Array<string> = drawings
      .filter((drawing: [string, string]): boolean => {
        const [englishBold, drawnBold] = drawing;

        return (
          englishBold !== drawnBold &&
          !meant.has(englishBold) &&
          page.includes(englishBold)
        );
      })
      .map((drawing: [string, string]): string => {
        return drawing[0];
      });

    expect(leftover).toEqual([]);
  });

  it("draws the diagram with the English one's metric names, no label line wider than the English diagram's widest", () => {
    const english: DocsFence = diagram(ENGLISH);
    const own: DocsFence = diagram(translated());
    const widest: number = Math.max(
      ...diagramLabelLines(english.code).map(labelLineWidth),
    );
    const tooWide: Array<string> = diagramLabelLines(own.code).filter(
      (line: string): boolean => {
        return labelLineWidth(line) > widest;
      },
    );

    expect(metricNamesIn(own.code)).toEqual(metricNamesIn(english.code));
    expect(tooWide).toEqual([]);
  });

  if (language === "fa") {
    it("joins its menu path with ' > ', leaving no '→' in its prose", () => {
      const text: string = prose(translated()).replace(INLINE_CODE_SPAN, " ");

      expect(text.split(RIGHT_ARROW).length - 1).toBe(0);
    });
  }
});

describe("the helpers, on this page's shapes", () => {
  it("find an untranslated line of prose, but not a line of names and code", () => {
    expect(
      isUntranslatedText(
        "Every message counts in `notification.send.count`, on every channel.",
      ),
    ).toBe(true);
    expect(
      isUntranslatedText("| `a` | `notification.send.lag` | **P99** | — |"),
    ).toBe(false);
    expect(isUntranslatedText("@tab Docker Compose")).toBe(false);
  });

  it("read the numbers of a line in any digits or digit groups, code and link targets left out", () => {
    expect(numbersIn("about 15 minutes, `5, 10`, 95%")).toEqual(["15", "95"]);
    expect(numbersIn("۳۰ ثانیه")).toEqual(["30"]);
    expect(numbersIn("bei 30 000")).toEqual(["30000"]);
    expect(
      numbersIn(
        "[Twilio](/docs/self-hosted/twilio-integration#3-configure-network-access)",
      ),
    ).toEqual([]);
  });

  it("draw the menu path from the Dashboard's own labels", () => {
    expect(drawnPath("en", ["Actions", "Create monitor from this view"])).toBe(
      "**Actions → Create monitor from this view**",
    );
    expect(drawnPath("de", ["Actions", "Create monitor from this view"])).toBe(
      `**${drawnDashboardLabel("de", "Actions")} → ${drawnDashboardLabel(
        "de",
        "Create monitor from this view",
      )}**`,
    );
  });

  it("read every metric name a diagram draws", () => {
    expect(
      metricNamesIn(
        'a["Provider<br/>notification.send.count"]\n a -->|"notification.send.lag"| b',
      ),
    ).toEqual(["notification.send.count", "notification.send.lag"]);
  });
});
