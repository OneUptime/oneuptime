import {
  SUPPORTED_DOCS_LANGUAGE_CODES,
  getDocsLanguageDirection,
} from "../../../FeatureSet/Docs/Utils/I18n";
import {
  CLOUD_DOCS_PAGES,
  CLOUD_ENVIRONMENTS,
  CLOUD_PAGE_NAMES,
  CLOUD_RESOURCES,
  CONSOLE_PATHS,
  CREATE_BUTTONS,
  CloudDocsPage,
  IDENTITY_TABLE_HEADINGS,
  KEPT_AS_WRITTEN,
  PERSIAN_PATH_SEPARATOR,
  PRODUCTS_MENU_KEYS,
  PROSE_LEADS,
  SHAPE_TABS,
} from "./CloudDocsPages";
import {
  DocsFence,
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
 * Docs overhaul task 23, the Cloud pages: Cloud Environments, the AWS ECS,
 * Google Cloud Run and Azure Container Apps guides, Other Cloud Platforms,
 * Cloud Troubleshooting and Cloud Resources, in every docs language. Each
 * translation says what the English page says:
 *
 *   - line for line: the same number of lines, each heading, table row,
 *     fence, component line and tab on the English one's line, so the two
 *     can be laid side by side and a later English edit shows where it lands;
 *   - the same code, diagrams (by their nodes and arrows), inline code
 *     (the attributes, variables and commands), tables, lists, steps, tabs
 *     and cards, the same numbers, and links that land on a heading in the
 *     reader's language;
 *   - a title that is the nav link's, in that language's docs locale;
 *   - OneUptime's Dashboard named the way that language's Dashboard draws it
 *     (drawnActionLabel, Persian included; a table's create button by
 *     drawnCreateButton), and its menu paths drawn segment by segment;
 *   - the cloud consoles' labels and paths, the providers' names, the tab
 *     labels (the in-app guide's) and the resource type tables of Cloud
 *     Resources kept as written (CloudDocsPages says why).
 *
 * A new bold word on the English pages fails "know every bold word" until
 * it is a Dashboard label or listed in CloudDocsPages.
 */

const LANGUAGES: Array<string> = SUPPORTED_DOCS_LANGUAGE_CODES.filter(
  (language: string): boolean => {
    return language !== "en";
  },
);

/*
 * The widest label line each page's diagrams may draw, in Latin letters
 * (labelLineWidth counts a Chinese, Japanese or Korean character twice),
 * measured to keep every language's diagrams inside the 590px docs column
 * in a browser with the docs' own font. The docs scroll a wider diagram
 * rather than shrink it.
 */
const WIDEST_LABEL_LINE: Record<string, number> = {
  "telemetry/cloud-environments": 27,
  "telemetry/cloud-aws-ecs": 26,
  "telemetry/cloud-gcp-cloud-run": 25,
  "telemetry/cloud-azure-container-apps": 23,
  "telemetry/cloud-other-platforms": 23,
  "telemetry/cloud-troubleshooting": 31,
  "telemetry/cloud-resources": 23,
};

const ONLY_CODE: RegExp = /^`[^`]+`$/;
const RIGHT_ARROW: string = "→";
const HEADING_LINE: RegExp = /^(#{1,6})\s/;
const INLINE_CODE_SPAN: RegExp = /`[^`\n]*`/g;
const LINK_TARGET: RegExp = /\]\([^)\s]*\)/g;
const NUMBER: RegExp = /\d+(?:\.\d+)?/g;
const THOUSANDS: RegExp = /(\d)[,.٬   '](?=\d{3}\b)/g;
// The Arabic decimal separator (U+066B) Persian writes inside a number.
const ARABIC_DECIMAL_SEPARATOR: RegExp = /(\d)٫(?=\d)/g;
// A letter of a script written right to left: Persian's (Arabic), Hebrew.
const RIGHT_TO_LEFT_LETTER: RegExp = /[\p{Script=Arabic}\p{Script=Hebrew}]/u;
const LETTER: RegExp = /\p{L}/u;
const DIAGRAM_TITLE_TEXT: RegExp = /\btitle="([^"]+)"/;
// A state diagram's transition and its label: "Reporting --> Archived: 7 days".
const STATE_TRANSITION_LABEL: RegExp = /-->\s*[^\s:]+\s*:(.*)$/;

function englishPage(page: string): string {
  return readPage("en", page);
}

function listed(
  lists: Readonly<Record<string, Array<string>>>,
  page: string,
): Array<string> {
  return lists[page] || [];
}

function joined(segments: Array<string>): string {
  return segments.join(PATH_SEPARATOR);
}

function isConsolePath(page: string, segments: Array<string>): boolean {
  return listed(CONSOLE_PATHS, page).includes(joined(segments));
}

// The page's OneUptime menu paths, as their segments.
function dashboardPaths(page: string): Array<Array<string>> {
  return boldPaths(englishPage(page)).filter(
    (segments: Array<string>): boolean => {
      return !isConsolePath(page, segments);
    },
  );
}

// A bold label as this language's Dashboard draws it on this page.
function drawnLabel(language: string, page: string, english: string): string {
  if (listed(CREATE_BUTTONS, page).includes(english)) {
    return drawnCreateButton(language, english);
  }

  return drawnActionLabel(language, english);
}

// The English page's bold labels that name the Dashboard.
function dashboardLabels(page: string): Array<string> {
  return boldLabels(englishPage(page)).filter((label: string): boolean => {
    return (
      isActionLabel(label) &&
      !listed(KEPT_AS_WRITTEN, page).includes(label) &&
      !listed(PROSE_LEADS, page).includes(label)
    );
  });
}

/*
 * A menu path's segment as that language draws it: a product of the
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

// A OneUptime menu path as a page in this language writes it.
function writtenPath(language: string, segments: Array<string>): string {
  if (language === "fa") {
    return segments
      .map((_segment: string, index: number): string => {
        return `**${drawnPathSegment(language, segments, index)}**`;
      })
      .join(PERSIAN_PATH_SEPARATOR);
  }

  return `**${segments
    .map((_segment: string, index: number): string => {
      return drawnPathSegment(language, segments, index);
    })
    .join(PATH_SEPARATOR)}**`;
}

// The arrows of a page's prose outside its console paths.
function arrowsOutsideConsolePaths(page: string, markdown: string): number {
  let text: string = prose(markdown);

  for (const consolePath of listed(CONSOLE_PATHS, page)) {
    text = text.split(`**${consolePath}**`).join("");
  }

  return text.split(RIGHT_ARROW).length - 1;
}

// Every number a page's prose states, as Latin digits without separators.
function statedNumbers(markdown: string): Set<string> {
  const text: string = toLatinDigits(
    prose(markdown).replace(INLINE_CODE_SPAN, " ").replace(LINK_TARGET, "]"),
  )
    .replace(ARABIC_DECIMAL_SEPARATOR, "$1.")
    .replace(THOUSANDS, "$1");

  return new Set(text.match(NUMBER) || []);
}

// The code of every diagram on the page, in this language.
function diagramsOn(language: string, page: string): Array<string> {
  return scanMarkdown(readPage(language, page))
    .fences.filter((fence: { lang: string }): boolean => {
      return fence.lang === "mermaid";
    })
    .map((fence: { code: string }): string => {
      return fence.code;
    });
}

/*
 * The lines of a page's diagrams, their titles and state labels included,
 * that a right-to-left reader would meet back to front. The docs lay each
 * line of a label, and a diagram's title, out in the direction of its first
 * letter (unicode-bidi: plaintext in the docs' style.css, held by
 * RightToLeftDocsLayout), so a Persian line that opens with a Latin word
 * ("OTLP به", OTLP to) is laid out left to right and read from its last
 * word. A line of Latin words only reads left to right, as it should.
 */
function linesLaidOutBackwards(markdown: string): Array<string> {
  return scanMarkdown(markdown)
    .fences.filter((fence: DocsFence): boolean => {
      return fence.lang === "mermaid";
    })
    .flatMap((fence: DocsFence): Array<string> => {
      const title: string | undefined =
        fence.info.match(DIAGRAM_TITLE_TEXT)?.[1];
      const isStateDiagram: boolean = fence.code
        .trimStart()
        .startsWith("stateDiagram");
      const transitions: Array<string> = isStateDiagram
        ? fence.code.split("\n").flatMap((line: string): Array<string> => {
            const label: string | undefined =
              line.match(STATE_TRANSITION_LABEL)?.[1];

            return label === undefined ? [] : label.trim().split("<br/>");
          })
        : [];

      return [
        ...(title === undefined ? [] : [title]),
        ...diagramLabelLines(fence.code),
        ...transitions,
      ];
    })
    .filter((line: string): boolean => {
      const first: string | undefined = line.match(LETTER)?.[0];

      return (
        first !== undefined &&
        RIGHT_TO_LEFT_LETTER.test(line) &&
        !RIGHT_TO_LEFT_LETTER.test(first)
      );
    });
}

function widestLabelLine(language: string, page: string): number {
  return Math.max(
    0,
    ...diagramsOn(language, page)
      .flatMap(diagramLabelLines)
      .map(labelLineWidth),
  );
}

/*
 * The indexes, among a page's tables, of the tables that hold the
 * product's resource types: the ones under an identity heading.
 */
function identityTableIndexes(markdown: string): Array<number> {
  const indexes: Array<number> = [];
  let heading: string = "";
  let tableIndex: number = -1;
  let inTable: boolean = false;

  for (const line of prose(markdown).split("\n")) {
    if (HEADING_LINE.test(line)) {
      heading = line.trim();
    }

    if (line.startsWith("|")) {
      if (!inTable) {
        tableIndex++;
        inTable = true;

        if (IDENTITY_TABLE_HEADINGS.includes(heading)) {
          indexes.push(tableIndex);
        }
      }
    } else {
      inTable = false;
    }
  }

  return indexes;
}

describe("the lists this test keeps", () => {
  it("name only pages of this group", () => {
    for (const lists of [
      CONSOLE_PATHS,
      KEPT_AS_WRITTEN,
      CREATE_BUTTONS,
      PROSE_LEADS,
    ]) {
      for (const page of Object.keys(lists)) {
        expect(CLOUD_PAGE_NAMES).toContain(page);
      }
    }
  });

  it("keep as written only bold words the English pages have", () => {
    for (const page of Object.keys(KEPT_AS_WRITTEN)) {
      const labels: Array<string> = boldLabels(englishPage(page));

      for (const name of listed(KEPT_AS_WRITTEN, page)) {
        expect({ page, name, bold: labels.includes(name) }).toEqual({
          page,
          name,
          bold: true,
        });
      }
    }
  });

  it("name as create buttons only bold Dashboard labels the English pages have", () => {
    for (const page of Object.keys(CREATE_BUTTONS)) {
      const labels: Array<string> = boldLabels(englishPage(page));

      for (const button of listed(CREATE_BUTTONS, page)) {
        expect({ page, button, bold: true, label: true }).toEqual({
          page,
          button,
          bold: labels.includes(button),
          label: isActionLabel(button),
        });
      }
    }
  });

  it("list as leads only bold words the English pages have", () => {
    for (const page of Object.keys(PROSE_LEADS)) {
      const labels: Array<string> = boldLabels(englishPage(page));

      for (const lead of listed(PROSE_LEADS, page)) {
        expect({ page, lead, found: labels.includes(lead) }).toEqual({
          page,
          lead,
          found: true,
        });
      }
    }
  });

  it("know every bold word on the English pages: a Dashboard label, kept as written, or a lead", () => {
    for (const page of CLOUD_PAGE_NAMES) {
      const unlisted: Array<string> = boldLabels(englishPage(page)).filter(
        (span: string): boolean => {
          return (
            !isActionLabel(span) &&
            !listed(KEPT_AS_WRITTEN, page).includes(span) &&
            !listed(PROSE_LEADS, page).includes(span)
          );
        },
      );

      expect({ page, unlisted }).toEqual({ page, unlisted: [] });
    }
  });

  it("know every OneUptime menu path's segments as Dashboard labels", () => {
    for (const page of CLOUD_PAGE_NAMES) {
      for (const segments of dashboardPaths(page)) {
        expect(PRODUCTS_MENU_KEYS[segments[0] as string]).toBeDefined();

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
  it.each(CLOUD_DOCS_PAGES)(
    "$page is titled as its nav link",
    (entry: CloudDocsPage) => {
      expect(englishPage(entry.page).split("\n")[0]).toBe(
        `# ${entry.navTitle}`,
      );
    },
  );

  it.each(CLOUD_DOCS_PAGES)(
    "$page draws at least one diagram, each with a caption, narrow enough for the 590px docs column",
    (entry: CloudDocsPage) => {
      const diagrams: Array<{ info: string }> = scanMarkdown(
        englishPage(entry.page),
      ).fences.filter((fence: { lang: string }): boolean => {
        return fence.lang === "mermaid";
      });

      expect(diagrams.length).toBeGreaterThan(0);

      for (const diagram of diagrams) {
        expect(diagram.info).toMatch(/title="[^"]+"/);
      }

      expect(widestLabelLine("en", entry.page)).toBeLessThanOrEqual(
        WIDEST_LABEL_LINE[entry.page] as number,
      );
    },
  );

  it.each(CLOUD_DOCS_PAGES)(
    "$page ends on a Next steps section of cards, after its Troubleshooting",
    (entry: CloudDocsPage) => {
      const headings: Array<DocsHeading> = scanMarkdown(
        englishPage(entry.page),
      ).headings;
      const last: DocsHeading = headings[headings.length - 1] as DocsHeading;
      const hasTroubleshooting: boolean =
        entry.page === "telemetry/cloud-troubleshooting" ||
        headings.some((heading: DocsHeading): boolean => {
          return (
            heading.level === 2 &&
            (heading.text === "Troubleshooting" ||
              heading.text === "Still stuck")
          );
        });

      expect(last).toEqual(expect.objectContaining({ level: 2 }));
      expect(last.text).toBe("Next steps");
      expect(hasTroubleshooting).toBe(true);
      expect(cardLines(englishPage(entry.page)).length).toBeGreaterThan(0);
    },
  );

  it.each(CLOUD_DOCS_PAGES)(
    "$page closes every bold and code span it opens",
    (entry: CloudDocsPage) => {
      expect(unbalancedLines(englishPage(entry.page))).toEqual([]);
    },
  );

  it.each(CLOUD_DOCS_PAGES)(
    "$page offers only the in-app guide's setups as tabs",
    (entry: CloudDocsPage) => {
      for (const label of tabLabels(englishPage(entry.page))) {
        expect(SHAPE_TABS).toContain(label);
      }
    },
  );
});

describe.each(LANGUAGES)("%s", (language: string) => {
  describe.each(CLOUD_DOCS_PAGES)("$page", (entry: CloudDocsPage) => {
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

    it("draws its diagrams narrow enough for the 590px docs column", () => {
      expect({
        page: entry.page,
        widest: widestLabelLine(language, entry.page),
        fits:
          widestLabelLine(language, entry.page) <=
          (WIDEST_LABEL_LINE[entry.page] as number),
      }).toEqual({
        page: entry.page,
        widest: widestLabelLine(language, entry.page),
        fits: true,
      });
    });

    it("opens every diagram line that holds right-to-left words with one, so the line reads in their direction", () => {
      expect(linesLaidOutBackwards(readPage(language, entry.page))).toEqual(
        [],
      );
    });

    it("keeps every piece of inline code: the attributes, variables and commands", () => {
      expect(inlineCode(readPage(language, entry.page))).toEqual(
        inlineCode(english),
      );
    });

    it("states every number the English page states", () => {
      expect(Array.from(statedNumbers(readPage(language, entry.page))).sort()).toEqual(
        Array.from(statedNumbers(english)).sort(),
      );
    });

    it("keeps the tab labels: the in-app guide's names for the setups", () => {
      expect(tabLabels(readPage(language, entry.page))).toEqual(
        tabLabels(english),
      );
    });

    it("keeps every table cell that is only code, row by row", () => {
      const translated: Array<Array<Array<string>>> = tables(
        readPage(language, entry.page),
      );

      tables(english).forEach((table: Array<Array<string>>, index: number) => {
        table.forEach((row: Array<string>, rowIndex: number) => {
          row.forEach((cell: string, cellIndex: number) => {
            if (rowIndex > 0 && ONLY_CODE.test(cell)) {
              expect({
                table: index,
                row: rowIndex,
                cell: translated[index]?.[rowIndex]?.[cellIndex],
              }).toEqual({ table: index, row: rowIndex, cell: cell });
            }
          });
        });
      });
    });

    it("keeps the resource type tables' rows as the product names them", () => {
      const translated: Array<Array<Array<string>>> = tables(
        readPage(language, entry.page),
      );
      const englishTables: Array<Array<Array<string>>> = tables(english);

      for (const index of identityTableIndexes(english)) {
        expect((translated[index] || []).slice(1)).toEqual(
          (englishTables[index] as Array<Array<string>>).slice(1),
        );
      }
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
      const missing: Array<string> = dashboardLabels(entry.page)
        .map((label: string): string => {
          return drawnLabel(language, entry.page, label);
        })
        .filter((drawn: string): boolean => {
          return !translated.includes(`**${drawn}**`);
        });

      expect(missing).toEqual([]);
    });

    it("gives every OneUptime menu path, segment by segment, as this language's Dashboard draws it", () => {
      const translated: string = readPage(language, entry.page);
      const missing: Array<string> = dashboardPaths(entry.page)
        .map((segments: Array<string>): string => {
          return writtenPath(language, segments);
        })
        .filter((written: string): boolean => {
          return !translated.includes(written);
        });

      expect(missing).toEqual([]);
    });

    it("keeps the consoles' paths and labels, and the providers' names, as written", () => {
      const translated: string = readPage(language, entry.page);
      const missing: Array<string> = [
        ...listed(CONSOLE_PATHS, entry.page),
        ...listed(KEPT_AS_WRITTEN, entry.page),
      ].filter((name: string): boolean => {
        return !translated.includes(`**${name}**`);
      });

      expect(missing).toEqual([]);
    });

    it("writes menu paths the way its script reads them", () => {
      const translated: string = readPage(language, entry.page);

      if (language === "fa") {
        expect(arrowsOutsideConsolePaths(entry.page, translated)).toBe(0);
      } else {
        expect(prose(translated).split(RIGHT_ARROW).length).toBe(
          prose(english).split(RIGHT_ARROW).length,
        );
      }
    });
  });
});

describe("the helpers, on these pages' shapes", () => {
  it("draw a Products menu product by the menu's own title, and the rest as labels", () => {
    const cloud: string = (
      (dashboardLocale("de")["navbar"] as Record<string, unknown>)[
        "items"
      ] as Record<string, string>
    )["cloudTitle"] as string;

    expect(drawnPathSegment("de", ["Cloud", "All Environments"], 0)).toBe(
      cloud,
    );
    expect(writtenPath("de", ["Cloud", "All Environments"])).toBe(
      `**${cloud}${PATH_SEPARATOR}${drawnActionLabel("de", "All Environments")}**`,
    );
    expect(writtenPath("en", ["Cloud", "All Environments"])).toBe(
      "**Cloud → All Environments**",
    );
  });

  it("write a Persian path as bold segments joined by '>', and leave no arrow outside the console paths", () => {
    const segments: Array<string> = ["Cloud", "Settings", "Label Rules"];

    expect(writtenPath("fa", segments)).toBe(
      segments
        .map((_segment: string, index: number): string => {
          return `**${drawnPathSegment("fa", segments, index)}**`;
        })
        .join(" > "),
    );
    expect(writtenPath("fa", segments)).not.toContain(RIGHT_ARROW);
    expect(
      arrowsOutsideConsolePaths(
        "telemetry/cloud-aws-ecs",
        "**AWS Console → Amazon Elastic Container Service → Task definitions** > x",
      ),
    ).toBe(0);
    expect(arrowsOutsideConsolePaths("telemetry/cloud-aws-ecs", "a → b")).toBe(
      1,
    );
  });

  it("draw the environments table's create button from the Create template", () => {
    expect(
      drawnLabel("en", CLOUD_ENVIRONMENTS, "Create Cloud Resource"),
    ).toBe("Create Cloud Resource");
    expect(
      drawnLabel("de", CLOUD_ENVIRONMENTS, "Create Cloud Resource"),
    ).toBe(drawnCreateButton("de", "Create Cloud Resource"));
  });

  it("find a right-to-left diagram line that opens with a Latin word, in a label, a title or a state's transition", () => {
    const flowchart: string = [
      '```mermaid title="یک وظیفهٔ ECS با کالکتور sidecar"',
      "flowchart TB",
      '    app["برنامهٔ شما"] -->|"OTLP به<br/>localhost:4318"| col["otel-collector<br/>sidecar"]',
      '    col -->|"ارسال OTLP روی HTTPS"| ou["OneUptime"]',
      "```",
    ].join("\n");
    const stateDiagram: string = [
      '```mermaid title="وضعیت یک منبع ابری"',
      "stateDiagram-v2",
      '    state "گزارش‌دهی" as Reporting',
      "    [*] --> Reporting: نخستین متریک",
      "    Reporting --> Archived: ۷ روز<br/>OTLP نیست",
      "```",
    ].join("\n");

    // At least one docs language is laid out right to left, so the check bites.
    expect(
      LANGUAGES.filter((language: string): boolean => {
        return getDocsLanguageDirection(language) === "rtl";
      }),
    ).toContain("fa");

    expect(linesLaidOutBackwards(flowchart)).toEqual(["OTLP به"]);
    expect(
      linesLaidOutBackwards(flowchart.replace('"OTLP به', '"ارسال OTLP به')),
    ).toEqual([]);
    expect(
      linesLaidOutBackwards(flowchart.replace('title="یک', 'title="ECS: یک')),
    ).toEqual(["ECS: یک وظیفهٔ ECS با کالکتور sidecar", "OTLP به"]);
    expect(linesLaidOutBackwards(stateDiagram)).toEqual(["OTLP نیست"]);
    expect(
      linesLaidOutBackwards(stateDiagram.replace("OTLP نیست", "بدون OTLP")),
    ).toEqual([]);
    // A line of Latin words only ("localhost:4318", "OneUptime") reads left to right, as do the English pages.
    expect(
      CLOUD_DOCS_PAGES.flatMap((entry: CloudDocsPage): Array<string> => {
        return linesLaidOutBackwards(englishPage(entry.page));
      }),
    ).toEqual([]);
  });

  it("read numbers however a language writes them", () => {
    expect(Array.from(statedNumbers("**5,000** and 12.000 and ۱۵ and 1 000"))).toEqual([
      "5000",
      "12000",
      "15",
      "1000",
    ]);
    expect(Array.from(statedNumbers("`4318` and [x](/docs/a/b#c-2)"))).toEqual([]);
  });

  it("find the resource type tables of Cloud Resources under their headings", () => {
    const english: string = englishPage(CLOUD_RESOURCES);
    const all: Array<Array<Array<string>>> = tables(english);
    const indexes: Array<number> = identityTableIndexes(english);

    expect(indexes).toHaveLength(IDENTITY_TABLE_HEADINGS.length);
    expect(
      indexes.map((index: number): string => {
        return ((all[index] as Array<Array<string>>)[1] as Array<string>)[0] as string;
      }),
    ).toEqual([
      "`Microsoft.Compute/virtualMachines`",
      "`AWS/EC2`",
      "`gce_instance`",
    ]);
  });
});
