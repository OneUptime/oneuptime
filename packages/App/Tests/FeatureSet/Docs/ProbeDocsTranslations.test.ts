import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import {
  DocsHeading,
  hasPage,
  readPage,
  scanMarkdown,
} from "./DocsContentSupport";
import {
  dashboardLocale,
  drawnActionLabel,
  drawnCreateButton,
  isActionLabel,
} from "./DocsDashboardLabels";
import {
  PATH_SEPARATOR,
  boldLabels,
  boldPaths,
  lineShape,
  stepCount,
  tabLabels,
  tables,
  unbalancedLines,
} from "./DocsPageShape";
import {
  CARD_LINE,
  anchorProblems,
  cardLines,
  cardTargets,
  comparableFence,
  inlineCode,
  listItemCount,
  navTitle,
  prose,
  strayMarkers,
  tableShape,
} from "./DocsTranslationChecks";
import { describe, expect, it } from "@jest/globals";

/*
 * Docs overhaul task 18b, the Probe pages: Custom Probes and Incoming
 * Request Ingress, in every docs language. Each translation says what the
 * English page says:
 *
 *   - line for line: the same number of lines, each heading, table row,
 *     fence, component line and tab on the English one's line, so the two
 *     can be laid side by side and a later English edit shows where it lands;
 *   - the same code, diagrams (by their nodes and arrows), inline code (the
 *     environment variables, the log lines the probe writes), tables, lists,
 *     steps, tabs and cards, and links that land on a heading in the
 *     reader's language;
 *   - a title that is the nav link's, in that language's docs locale;
 *   - the Dashboard named the way that language's Dashboard draws it: a bold
 *     label is its drawnActionLabel (Persian included), a table's create
 *     button its drawnCreateButton, and a menu path is drawn segment by
 *     segment, a product of the Products menu by the menu's own title.
 *
 * Names that are not the Dashboard's words stay as written (NAMES: a key on
 * the keyboard, a product). Every other bold word is one of the pages' own
 * leads (PROSE_LEADS), which a translation words freely. A new bold word on
 * these English pages fails "know every bold word" until it is in a list.
 */

const LANGUAGES: Array<string> = SUPPORTED_DOCS_LANGUAGE_CODES.filter(
  (language: string): boolean => {
    return language !== "en";
  },
);

interface TranslatedPage {
  page: string;
  // The page's nav link, as the docs' English locale keys it.
  navTitle: string;
}

const CUSTOM_PROBE: string = "probe/custom-probe";
const INGRESS: string = "probe/incoming-request-ingress";

const PAGES: ReadonlyArray<TranslatedPage> = [
  { page: CUSTOM_PROBE, navTitle: "Custom Probes" },
  { page: INGRESS, navTitle: "Incoming Request Ingress" },
];

const PAGE_NAMES: Array<string> = PAGES.map((entry: TranslatedPage): string => {
  return entry.page;
});

// A table's create button, drawn as translateNamedAction draws it.
const CREATE_BUTTONS: Record<string, Array<string>> = {
  [CUSTOM_PROBE]: ["Create Probe"],
};

/*
 * Bold words that happen to be Dashboard labels but name something else:
 * the Enter key, and Kubernetes as a kind of setup. They stay as written.
 */
const NAMES: Record<string, Array<string>> = {
  [CUSTOM_PROBE]: ["Enter", "Kubernetes"],
};

/*
 * The products of the Products menu a path can start at, with the key the
 * menu draws each one's title from (navbar.items).
 */
const PRODUCTS_MENU_KEYS: Record<string, string> = {
  Monitors: "monitorsTitle",
};

/*
 * The pages' own bold leads: neither Dashboard labels nor names, so a
 * translation words them freely.
 */
const PROSE_LEADS: Record<string, Array<string>> = {
  [CUSTOM_PROBE]: [
    "The probe connects out.",
    "It checks only its own monitors.",
    "OneUptime watches that it runs.",
    "The Growth plan, on OneUptime Cloud.",
    "Permission to create probes.",
    "A machine in the network you want to monitor.",
    "The probe's own requests to OneUptime.",
    "The HTTP checks of monitors",
    "Not the other checks.",
    "Docker with `--network host`, or Compose with `network_mode: host`",
    "A Docker bridge network",
    "Which hosts are queried:",
    "Outbound:",
    "Inbound:",
    "The probe's network is fine",
  ],
  [INGRESS]: [
    "Your service sends the request to the probe.",
    "The probe answers at once.",
    "The probe forwards it.",
    "OneUptime reads it as usual.",
    "not",
    "A running custom probe.",
    "An Incoming Request monitor.",
    "A port your services can reach on the probe's host.",
    "The endpoint is unauthenticated by design",
    "Keep the listener on your private network.",
    "Add TLS in front of it if you need encryption on your network.",
    "Cap the body size yourself if 50 MB is too much.",
  ],
};

const ONLY_CODE: RegExp = /^`[^`]+`$/;

function englishPage(page: string): string {
  return readPage("en", page);
}

// A bold label as this language's Dashboard draws it on this page.
function drawnLabel(language: string, page: string, english: string): string {
  if ((CREATE_BUTTONS[page] || []).includes(english)) {
    return drawnCreateButton(language, english);
  }

  return drawnActionLabel(language, english);
}

/*
 * A menu path's segment as that language draws it: a product in the
 * Products menu is the menu's own title for it.
 */
function drawnPathSegment(
  language: string,
  segments: Array<string>,
  index: number,
): string {
  const segment: string = segments[index] as string;
  const key: string | undefined = PRODUCTS_MENU_KEYS[segment];

  if (language !== "en" && index === 0 && key) {
    const navbar: unknown = dashboardLocale(language)["navbar"];
    const items: unknown = (navbar as Record<string, unknown> | undefined)?.[
      "items"
    ];
    const title: unknown = (items as Record<string, unknown> | undefined)?.[
      key
    ];

    if (typeof title === "string" && title.trim()) {
      return title;
    }
  }

  return drawnActionLabel(language, segment);
}

function drawnPath(language: string, segments: Array<string>): string {
  return segments
    .map((_segment: string, index: number): string => {
      return drawnPathSegment(language, segments, index);
    })
    .join(PATH_SEPARATOR);
}

/*
 * A menu path as a page in this language writes it. Persian is read right
 * to left, where "→" points back at where the reader came from, so it bolds
 * each segment and joins them with ">", which a right-to-left line mirrors
 * (as the SLO pages do). Every other language bolds the path as one span.
 */
const RTL_PATH_SEPARATOR: string = " > ";

function writtenPath(language: string, segments: Array<string>): string {
  if (language === "fa") {
    return segments
      .map((_segment: string, index: number): string => {
        return `**${drawnPathSegment(language, segments, index)}**`;
      })
      .join(RTL_PATH_SEPARATOR);
  }

  return `**${drawnPath(language, segments)}**`;
}

describe("the lists this test keeps", () => {
  it("name only pages of this group", () => {
    for (const lists of [CREATE_BUTTONS, NAMES, PROSE_LEADS]) {
      for (const page of Object.keys(lists)) {
        expect(PAGE_NAMES).toContain(page);
      }
    }
  });

  it("name as create buttons and names only bold words the English pages have, which the Dashboard has", () => {
    for (const lists of [CREATE_BUTTONS, NAMES]) {
      for (const page of Object.keys(lists)) {
        const labels: Array<string> = boldLabels(englishPage(page));

        for (const name of lists[page] as Array<string>) {
          expect({ page, name, bold: true, label: true }).toEqual({
            page,
            name,
            bold: labels.includes(name),
            label: isActionLabel(name),
          });
        }
      }
    }
  });

  it("list as leads only bold words the English pages have, that are no Dashboard label", () => {
    for (const page of Object.keys(PROSE_LEADS)) {
      const labels: Array<string> = boldLabels(englishPage(page));

      for (const lead of PROSE_LEADS[page] as Array<string>) {
        expect({ page, lead, found: true, label: false }).toEqual({
          page,
          lead,
          found: labels.includes(lead),
          label: isActionLabel(lead),
        });
      }
    }
  });

  it("know every bold word on the English pages: a label, a name, or a lead", () => {
    for (const page of PAGE_NAMES) {
      const unlisted: Array<string> = boldLabels(englishPage(page)).filter(
        (span: string): boolean => {
          return (
            !isActionLabel(span) && !(PROSE_LEADS[page] || []).includes(span)
          );
        },
      );

      expect({ page, unlisted }).toEqual({ page, unlisted: [] });
    }
  });

  it("know every menu path's segments as Dashboard labels", () => {
    for (const page of PAGE_NAMES) {
      for (const segments of boldPaths(englishPage(page))) {
        for (const segment of segments) {
          expect({ page, segment, label: true }).toEqual({
            page,
            segment,
            label: isActionLabel(segment),
          });
        }
      }
    }
  });
});

describe("the English pages", () => {
  it.each(PAGES)("$page is titled as its nav link", (entry: TranslatedPage) => {
    expect(englishPage(entry.page).split("\n")[0]).toBe(`# ${entry.navTitle}`);
  });

  it.each(PAGES)(
    "$page draws at least one diagram, with a caption",
    (entry: TranslatedPage) => {
      const diagrams: Array<{ info: string }> = scanMarkdown(
        englishPage(entry.page),
      ).fences.filter((fence: { lang: string }): boolean => {
        return fence.lang === "mermaid";
      });

      expect(diagrams.length).toBeGreaterThan(0);

      for (const diagram of diagrams) {
        expect(diagram.info).toMatch(/title="[^"]+"/);
      }
    },
  );

  it.each(PAGES)(
    "$page ends on a Next steps section of cards, after its Troubleshooting",
    (entry: TranslatedPage) => {
      const headings: Array<DocsHeading> = scanMarkdown(
        englishPage(entry.page),
      ).headings;
      const last: DocsHeading = headings[headings.length - 1] as DocsHeading;
      const troubleshooting: DocsHeading | undefined = headings.find(
        (heading: DocsHeading): boolean => {
          return heading.level === 2 && heading.text === "Troubleshooting";
        },
      );

      expect(last).toEqual(expect.objectContaining({ level: 2 }));
      expect(last.text).toBe("Next steps");
      expect(troubleshooting).toBeDefined();
      expect(cardLines(englishPage(entry.page)).length).toBeGreaterThan(0);
    },
  );

  it.each(PAGES)(
    "$page closes every bold and code span it opens",
    (entry: TranslatedPage) => {
      expect(unbalancedLines(englishPage(entry.page))).toEqual([]);
    },
  );

  it.each(PAGES)(
    "$page offers Docker, Docker Compose and Kubernetes, in that order, wherever it offers a setup",
    (entry: TranslatedPage) => {
      const labels: Array<string> = tabLabels(englishPage(entry.page));

      expect(labels.slice(0, 3)).toEqual([
        "Docker",
        "Docker Compose",
        "Kubernetes",
      ]);
    },
  );
});

describe.each(LANGUAGES)("%s", (language: string) => {
  describe.each(PAGES)("$page", (entry: TranslatedPage) => {
    const english: string = englishPage(entry.page);

    it("is translated, under the nav link's title", () => {
      expect(hasPage(language, entry.page)).toBe(true);

      const translated: string = readPage(language, entry.page);
      const title: string = navTitle(language, entry.navTitle);

      expect(translated).not.toEqual(english);
      expect(typeof title).toBe("string");
      expect(translated.split("\n")[0]).toBe(`# ${title}`);
    });

    it("lies line for line beside the English page: headings, table rows, fences, components and tabs on the same lines", () => {
      expect(lineShape(readPage(language, entry.page))).toEqual(
        lineShape(english),
      );
    });

    it("keeps every code block, and builds every diagram the same way", () => {
      expect(
        scanMarkdown(readPage(language, entry.page)).fences.map(
          comparableFence,
        ),
      ).toEqual(scanMarkdown(english).fences.map(comparableFence));
    });

    it("keeps every piece of inline code: the variables, values and log lines", () => {
      expect(inlineCode(readPage(language, entry.page))).toEqual(
        inlineCode(english),
      );
    });

    it("keeps the tab labels: the setups are named as they are everywhere", () => {
      expect(tabLabels(readPage(language, entry.page))).toEqual(
        tabLabels(english),
      );
    });

    it("keeps the code in the first column of every table, row by row", () => {
      const translated: Array<Array<Array<string>>> = tables(
        readPage(language, entry.page),
      );

      tables(english).forEach((table: Array<Array<string>>, index: number) => {
        table.forEach((row: Array<string>, rowIndex: number) => {
          if (rowIndex > 0 && ONLY_CODE.test(row[0] as string)) {
            expect({
              table: index,
              row: rowIndex,
              cell: translated[index]?.[rowIndex]?.[0],
            }).toEqual({
              table: index,
              row: rowIndex,
              cell: row[0],
            });
          }
        });
      });
    });

    it("closes every bold and code span it opens", () => {
      expect(unbalancedLines(readPage(language, entry.page))).toEqual([]);
    });

    it("draws every bold and italic span, with no asterisks or underscores left on the page", async () => {
      expect(
        await strayMarkers(readPage(language, entry.page), language),
      ).toEqual([]);
    });

    it("has the English page's headings, steps, tables and list items", () => {
      const translated: string = readPage(language, entry.page);

      expect(
        scanMarkdown(translated).headings.map((heading: DocsHeading) => {
          return heading.level;
        }),
      ).toEqual(
        scanMarkdown(english).headings.map((heading: DocsHeading) => {
          return heading.level;
        }),
      );
      expect(stepCount(translated)).toBe(stepCount(english));
      expect(tableShape(translated)).toEqual(tableShape(english));
      expect(listItemCount(translated)).toBe(listItemCount(english));
    });

    it("writes its cards with an ASCII ': ' after the link, to the English cards' pages", () => {
      const translated: Array<string> = cardLines(
        readPage(language, entry.page),
      );

      expect(translated.length).toBe(cardLines(english).length);

      for (const line of translated) {
        expect({ line, ascii: CARD_LINE.test(line) }).toEqual({
          line,
          ascii: true,
        });
      }

      expect(cardTargets(translated)).toEqual(cardTargets(cardLines(english)));
    });

    it("links only to anchors that are headings of the page they open", () => {
      expect(anchorProblems(language, entry.page)).toEqual([]);
    });

    it("names every Dashboard label the English page names, as this language's Dashboard draws it", () => {
      const translated: string = readPage(language, entry.page);
      const names: Array<string> = NAMES[entry.page] || [];
      const missing: Array<string> = boldLabels(english)
        .filter((label: string): boolean => {
          return isActionLabel(label) && !names.includes(label);
        })
        .map((label: string): string => {
          return drawnLabel(language, entry.page, label);
        })
        .filter((drawn: string): boolean => {
          return !translated.includes(`**${drawn}**`);
        });

      expect(missing).toEqual([]);
    });

    it("gives every menu path, segment by segment, as this language's Dashboard draws it", () => {
      const translated: string = readPage(language, entry.page);
      const missing: Array<string> = boldPaths(english)
        .map((segments: Array<string>): string => {
          return writtenPath(language, segments);
        })
        .filter((written: string): boolean => {
          return !translated.includes(written);
        });

      expect(missing).toEqual([]);
    });

    it("writes menu paths the way its script reads them", () => {
      const arrows: (markdown: string) => number = (
        markdown: string,
      ): number => {
        return prose(markdown).split("→").length - 1;
      };
      const translated: string = readPage(language, entry.page);

      if (language === "fa") {
        expect(arrows(translated)).toBe(0);
      } else {
        expect(arrows(translated)).toBe(arrows(english));
      }
    });

    it("keeps the names as written", () => {
      const translated: string = readPage(language, entry.page);
      const missing: Array<string> = (NAMES[entry.page] || []).filter(
        (name: string): boolean => {
          return !translated.includes(`**${name}**`);
        },
      );

      expect(missing).toEqual([]);
    });
  });
});

describe("the helpers, on these pages' shapes", () => {
  it("draw a Products menu product by the menu's own title, and the rest as labels", () => {
    const monitors: string = (
      (dashboardLocale("de")["navbar"] as Record<string, unknown>)[
        "items"
      ] as Record<string, string>
    )["monitorsTitle"] as string;

    expect(drawnPath("de", ["Monitors", "Settings", "Probes"])).toBe(
      [
        monitors,
        drawnActionLabel("de", "Settings"),
        drawnActionLabel("de", "Probes"),
      ].join(PATH_SEPARATOR),
    );
    expect(drawnPath("en", ["Monitors", "Settings", "Probes"])).toBe(
      "Monitors → Settings → Probes",
    );
  });

  it("write a Persian path as bold segments joined by '>', and every other language's as one bold span", () => {
    const segments: Array<string> = ["Monitors", "Settings", "Probes"];

    expect(writtenPath("fa", segments)).toBe(
      segments
        .map((_segment: string, index: number): string => {
          return `**${drawnPathSegment("fa", segments, index)}**`;
        })
        .join(" > "),
    );
    expect(writtenPath("fa", segments)).not.toContain("→");
    expect(writtenPath("de", segments)).toBe(
      `**${drawnPath("de", segments)}**`,
    );
    expect(writtenPath("en", segments)).toBe(
      "**Monitors → Settings → Probes**",
    );
  });

  it("draw the probe table's create button from the Create template", () => {
    expect(drawnLabel("en", CUSTOM_PROBE, "Create Probe")).toBe("Create Probe");
    expect(drawnLabel("de", CUSTOM_PROBE, "Create Probe")).toBe(
      drawnCreateButton("de", "Create Probe"),
    );
  });
});
