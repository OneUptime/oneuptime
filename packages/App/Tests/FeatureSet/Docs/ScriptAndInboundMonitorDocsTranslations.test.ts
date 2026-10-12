import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import {
  DocsHeading,
  ScannedPage,
  hasPage,
  readPage,
  scanMarkdown,
} from "./DocsContentSupport";
import { drawnActionLabel, isActionLabel } from "./DocsDashboardLabels";
import {
  CARD_LINE,
  anchorProblems,
  boldSpans,
  cardLines,
  cardTargets,
  comparableFence,
  diagramSkeleton,
  inlineCode,
  listItemCount,
  navTitle,
  prose,
  strayMarkers,
  tableShape,
} from "./DocsTranslationChecks";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Docs overhaul task 8: the Custom Code, SQL Query, Synthetic, Incoming
 * Request, Incoming Email and External Status Page monitor pages, in every
 * docs language. Each translation says what the English page says: the same
 * sections, steps, tables, lists, cards, code and diagrams, links that land
 * on a heading in the reader's language, a title that is the nav link's, and
 * the product named the way that language's product draws it.
 *
 * "The way the product draws it" has three sources on these pages:
 *
 *   - A bold Dashboard label (DocsDashboardLabels) is its value in that
 *     language's Dashboard locale, Persian included, as on the other monitor
 *     pages (drawnActionLabel). Menu paths ("A → B → C") are drawn segment by
 *     segment.
 *   - The criteria filters and most of their conditions (Result Value, SQL
 *     Is Online, Not Recieved In Minutes, Equal To), the type picker's
 *     categories (Synthetic Monitoring, Inbound Monitoring), the Custom
 *     JavaScript Code type and the status page providers have no Dashboard
 *     locale key: every language's Dashboard shows them in English, so every
 *     translation names them in English (SHOWN_IN_ENGLISH). When the
 *     Dashboard gains a key for one, a test below fails until the pages name
 *     it as drawn.
 *   - The Admin Dashboard's own locale draws the one Admin Dashboard setting
 *     the Incoming Email page names (ADMIN_DASHBOARD_LABELS).
 *
 * Azure's and Amazon's buttons stay in English (THIRD_PARTY_IN_ENGLISH):
 * their consoles are not OneUptime's to translate. Bold words that are
 * Dashboard labels only by coincidence are PROSE, with why; bold words that
 * are neither labels nor shown in English are the pages' own leads
 * (PROSE_LEADS), which a translation words freely.
 *
 * Other pages link to headings of these pages, and their translations used
 * to name the old translated headings (the JavaScript Expressions pages
 * named the Incoming Email page's old "Available criteria fields" heading).
 * LINKS_INTO_THESE_PAGES holds each of those links to the heading it means
 * in every language.
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

const CUSTOM_CODE_MONITOR: string = "monitor/custom-code-monitor";
const SQL_MONITOR: string = "monitor/sql-monitor";
const SYNTHETIC_MONITOR: string = "monitor/synthetic-monitor";
const INCOMING_REQUEST_MONITOR: string = "monitor/incoming-request-monitor";
const INCOMING_EMAIL_MONITOR: string = "monitor/incoming-email-monitor";
const EXTERNAL_STATUS_PAGE_MONITOR: string =
  "monitor/external-status-page-monitor";

const PAGES: ReadonlyArray<TranslatedPage> = [
  { page: CUSTOM_CODE_MONITOR, navTitle: "Custom Code Monitor" },
  { page: SQL_MONITOR, navTitle: "SQL Query Monitor" },
  { page: SYNTHETIC_MONITOR, navTitle: "Synthetic Monitor" },
  { page: INCOMING_REQUEST_MONITOR, navTitle: "Incoming Request Monitor" },
  { page: INCOMING_EMAIL_MONITOR, navTitle: "Incoming Email Monitor" },
  {
    page: EXTERNAL_STATUS_PAGE_MONITOR,
    navTitle: "External Status Page Monitor",
  },
];

const PAGE_NAMES: Array<string> = PAGES.map((entry: TranslatedPage): string => {
  return entry.page;
});

// The text conditions the criteria form offers without a locale key.
const TEXT_CONDITIONS_IN_ENGLISH: Array<string> = [
  "Not Contains",
  "Equal To",
  "Not Equal To",
];

// The two time conditions of Incoming Request and Email Received, spelled as the form spells them.
const RECEIVED_CONDITIONS_IN_ENGLISH: Array<string> = [
  "Recieved In Minutes",
  "Not Recieved In Minutes",
];

/*
 * Bold names every language's Dashboard shows in English, because its
 * locale has no key for them, by page. A translation keeps each one bold and
 * in English, so the reader finds it as the screen shows it.
 */
const SHOWN_IN_ENGLISH: Record<string, Array<string>> = {
  [CUSTOM_CODE_MONITOR]: [
    // The type picker's card and the category it sits in.
    "Custom JavaScript Code",
    "Synthetic Monitoring",
    // The criteria filter (CheckOn) and a condition (FilterType).
    "Result Value",
    "Is Empty",
  ],
  [SQL_MONITOR]: [
    "Database Monitoring",
    // The Database Type dropdown's options.
    "PostgreSQL",
    "MySQL",
    "Microsoft SQL Server",
    // The driver the official probe image ships, by its registered name.
    "ODBC Driver 18",
    "SQL Is Online",
    "SQL Query Row Count",
    "SQL Query Scalar Value",
    "SQL Query Execution Time (in ms)",
    "SQL Query Error",
    "JavaScript Expression",
  ],
  [SYNTHETIC_MONITOR]: [
    "Synthetic Monitoring",
    "Result Value",
    "Screen Size",
    "Equal To",
    "Not Equal To",
  ],
  [INCOMING_REQUEST_MONITOR]: [
    ...RECEIVED_CONDITIONS_IN_ENGLISH,
    "Not Contains",
    "Request Header",
    "Request Header Value",
    "JavaScript Expression",
    "Evaluates To True",
    // The HTTP methods the heartbeat URL accepts.
    "GET",
    "POST",
  ],
  [INCOMING_EMAIL_MONITOR]: [
    "Inbound Monitoring",
    "Email Received",
    ...RECEIVED_CONDITIONS_IN_ENGLISH,
    "Email From Address",
    "Email Body",
    "Email To Address",
    "JavaScript Expression",
    ...TEXT_CONDITIONS_IN_ENGLISH,
    "Starts With",
    "Ends With",
    "Is Empty",
    "Is Not Empty",
    "Evaluates To True",
    // The inbound email provider, by its product name.
    "SendGrid Inbound Parse",
  ],
  [EXTERNAL_STATUS_PAGE_MONITOR]: [
    "Basic Monitoring",
    // The Provider dropdown's options other than Auto.
    "Atlassian Statuspage",
    "incident.io",
    "RSS",
    "Atom",
    "External Status Page Is Online",
    "External Status Page Overall Status",
    "External Status Page Component Status",
    "External Status Page Active Incidents",
    "External Status Page Response Time (in ms)",
  ],
};

/*
 * Another company's buttons and fields, which their own consoles draw:
 * Azure's action group (its Email notification, Resend and Test) and the
 * Amazon SNS confirmation email's link. A translation keeps them bold and in
 * English; "Resend" and "Test" are also OneUptime labels, by coincidence.
 */
const THIRD_PARTY_IN_ENGLISH: Record<string, Array<string>> = {
  [INCOMING_EMAIL_MONITOR]: ["Resend", "Test", "Confirm subscription"],
};

/*
 * Bold names the Admin Dashboard draws, which a translation names as that
 * language's Admin Dashboard locale has them.
 */
const ADMIN_DASHBOARD_LABELS: Record<string, Array<string>> = {
  [INCOMING_EMAIL_MONITOR]: ["Monitor Log Retention (Days)"],
};

/*
 * Bold words that are Dashboard labels by coincidence but are prose where the
 * English page uses them, which a translation words as its language needs.
 */
const PROSE: Record<string, Array<string>> = {
  /*
   * "A **probe** that can reach every endpoint": the lead of a Before you
   * begin item. Several locales leave the "probe" key in English, which
   * reads badly in a sentence.
   */
  [CUSTOM_CODE_MONITOR]: ["probe"],
  // The probe's operating system, a row of the Windows Integrated Authentication table.
  [SQL_MONITOR]: ["probe", "Windows"],
  [SYNTHETIC_MONITOR]: ["probe"],
  // "taken from the **first** matching element": the word, stressed.
  [INCOMING_REQUEST_MONITOR]: ["first"],
  // Azure's buttons (THIRD_PARTY_IN_ENGLISH), not OneUptime's.
  [INCOMING_EMAIL_MONITOR]: ["Resend", "Test"],
};

/*
 * The bold leads of the pages' own lists and sentences: a security control,
 * a best practice, a word stressed. They are neither Dashboard labels nor
 * shown in English, so a translation words them freely; listing them makes a
 * new bold name on these pages fail below until it is put in
 * SHOWN_IN_ENGLISH or here.
 */
const PROSE_LEADS: Record<string, Array<string>> = {
  [CUSTOM_CODE_MONITOR]: ["Timeout.", "Memory.", "Redirects."],
  [SQL_MONITOR]: [
    // The values the probe reports, named for what they are.
    "Scalar Value",
    "Query Error",
    // The security controls.
    "Least-privilege database user",
    "Read-only execution",
    "Single-statement, allow-listed queries",
    "Statement timeout",
    "Bounded rows",
    "Credential redaction",
    "read-only database user",
    "Linux or macOS",
    "single read-only statement",
  ],
  [SYNTHETIC_MONITOR]: ["even if the script throws", "only"],
  [INCOMING_REQUEST_MONITOR]: [
    "Heartbeat monitoring",
    "Receiving alerts from another system",
    "not",
    "above",
    "one",
    "separate incident per distinct value",
    "distinct",
    "last segment of the path",
    "only",
    "verbatim",
    "Set the time window appropriately",
    "Include meaningful data",
    "Use POST with `Content-Type: application/json`",
    "Don't mix the two jobs on one monitor",
    "Monitor the monitor",
  ],
  [INCOMING_EMAIL_MONITOR]: [
    "The old address stops working immediately",
    "Your criteria see it too.",
    "Verification belongs to the address.",
    "not",
    "A title gets one line of each.",
    "This monitor's address is masked.",
    "A check for missing email uses the last email.",
    "Email Address Security",
    "Email Size",
    "Processing Time",
    "Case Insensitivity",
    "Plain Text",
  ],
  [EXTERNAL_STATUS_PAGE_MONITOR]: [
    "active incident count",
    "overall status",
    "within",
    "Use the Auto provider",
    "Scope to a component group",
    "Monitor specific components",
    "Combine with your own monitors",
  ],
};

/*
 * Links from other pages to a heading of these pages. Each language's copy
 * of the page that links must name the heading of the same place in that
 * language's copy of the page it links to: the anchors are made from the
 * translated heading text.
 */
interface LinkIntoPage {
  from: string;
  to: string;
  anchor: string;
}

const LINKS_INTO_THESE_PAGES: ReadonlyArray<LinkIntoPage> = [
  {
    // The JavaScript Expression filter's Incoming Email section.
    from: "monitor/javascript-expression",
    to: INCOMING_EMAIL_MONITOR,
    anchor: "available-filter-types",
  },
  {
    // Database Health uses the same trusted connection as the SQL Query monitor.
    from: "monitor/database-health-monitor",
    to: SQL_MONITOR,
    anchor: "windows-integrated-authentication",
  },
  {
    from: SYNTHETIC_MONITOR,
    to: CUSTOM_CODE_MONITOR,
    anchor: "alerting-on-the-returned-data",
  },
  {
    from: SYNTHETIC_MONITOR,
    to: CUSTOM_CODE_MONITOR,
    anchor: "reserved-attribute-keys",
  },
  {
    // custom_code_monitor_options; only Persian has a translated copy.
    from: "terraform/monitor-steps",
    to: CUSTOM_CODE_MONITOR,
    anchor: "alerting-on-the-returned-data",
  },
];

const ADMIN_DASHBOARD_LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/AdminDashboard/src/Locales",
);

const PATH_SEPARATOR: string = " → ";

// An inline code span, which may hold asterisks of its own.
const INLINE_CODE_SPAN: RegExp = /`[^`\n]*`/g;

function englishPage(page: string): string {
  return readPage("en", page);
}

// The bold spans of a page that are one label, not a path.
function boldLabels(markdown: string): Array<string> {
  return boldSpans(prose(markdown)).filter((span: string): boolean => {
    return !span.includes(PATH_SEPARATOR);
  });
}

// The bold spans of a page that are a path of Dashboard labels.
function menuPaths(markdown: string): Array<Array<string>> {
  return boldSpans(prose(markdown))
    .filter((span: string): boolean => {
      return span.includes(PATH_SEPARATOR);
    })
    .map((span: string): Array<string> => {
      return span.split(PATH_SEPARATOR).map((segment: string): string => {
        return segment.trim();
      });
    })
    .filter((segments: Array<string>): boolean => {
      return segments.every((segment: string): boolean => {
        return isActionLabel(segment);
      });
    });
}

// The value of an Admin Dashboard label in this language's Admin Dashboard locale.
function adminDashboardLabel(language: string, english: string): string {
  const locale: Record<string, unknown> = JSON.parse(
    fs.readFileSync(
      path.join(ADMIN_DASHBOARD_LOCALES_DIR, `${language}.json`),
      "utf8",
    ),
  ) as Record<string, unknown>;
  const value: unknown = locale[english];

  return typeof value === "string" && value.trim() ? value : english;
}

/*
 * The prose lines that open a bold span or an inline code span and never
 * close it: "**Result Value** / `UP** in the offline one" leaves the code
 * open and swallows the rest of the line into it.
 */
function unbalancedLines(markdown: string): Array<string> {
  return prose(markdown)
    .split("\n")
    .filter((line: string): boolean => {
      const ticks: number = line.split("`").length - 1;
      const outsideCode: string = line.replace(INLINE_CODE_SPAN, "");
      const stars: number = outsideCode.split("**").length - 1;

      return ticks % 2 !== 0 || stars % 2 !== 0;
    });
}

// The number of :::steps steps on a page: the H3s inside its steps blocks.
function stepCount(markdown: string): number {
  let inSteps: boolean = false;
  let inFence: boolean = false;
  let steps: number = 0;

  for (const line of markdown.split("\n")) {
    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
      continue;
    }

    if (inFence) {
      continue;
    }

    if (line.trim() === ":::steps") {
      inSteps = true;
      continue;
    }

    if (inSteps && line.trim() === ":::") {
      inSteps = false;
      continue;
    }

    if (inSteps && line.startsWith("### ")) {
      steps++;
    }
  }

  return steps;
}

// The headings of a page below its title, in order.
function sections(markdown: string): Array<DocsHeading> {
  return scanMarkdown(markdown).headings.filter(
    (heading: DocsHeading): boolean => {
      return heading.line !== 1;
    },
  );
}

/*
 * The anchor of the heading of a page in a language that sits where the
 * English page's heading with this anchor sits, or null when the English
 * page has no such heading.
 */
function anchorInLanguage(
  language: string,
  page: string,
  englishAnchor: string,
): string | null {
  const english: Array<DocsHeading> = sections(englishPage(page));
  const index: number = english.findIndex((heading: DocsHeading): boolean => {
    return heading.slug === englishAnchor;
  });

  if (index < 0) {
    return null;
  }

  const translated: Array<DocsHeading> = sections(readPage(language, page));

  return translated[index]?.slug || null;
}

describe("the lists this test keeps", () => {
  it("name only pages of this group", () => {
    for (const lists of [
      SHOWN_IN_ENGLISH,
      THIRD_PARTY_IN_ENGLISH,
      ADMIN_DASHBOARD_LABELS,
      PROSE,
      PROSE_LEADS,
    ]) {
      for (const page of Object.keys(lists)) {
        expect(PAGE_NAMES).toContain(page);
      }
    }
  });

  it("call prose only bold Dashboard labels the English page has", () => {
    for (const page of Object.keys(PROSE)) {
      const labels: Array<string> = boldLabels(englishPage(page));

      for (const label of PROSE[page] as Array<string>) {
        expect({ page: page, label: label, ok: true }).toEqual({
          page: page,
          label: label,
          ok: labels.includes(label) && isActionLabel(label),
        });
      }
    }
  });

  /*
   * A name the Dashboard shows in English today and translates tomorrow
   * fails here: then every translation names it as drawn, and it leaves the
   * list.
   */
  it("keep in English only bold names the Dashboard has no translation for", () => {
    for (const page of Object.keys(SHOWN_IN_ENGLISH)) {
      const labels: Array<string> = boldLabels(englishPage(page));

      for (const name of SHOWN_IN_ENGLISH[page] as Array<string>) {
        expect({ page: page, name: name, bold: true, label: false }).toEqual({
          page: page,
          name: name,
          bold: labels.includes(name),
          label: isActionLabel(name),
        });
      }
    }
  });

  it("keep another company's buttons only where the English page bolds them", () => {
    for (const page of Object.keys(THIRD_PARTY_IN_ENGLISH)) {
      const labels: Array<string> = boldLabels(englishPage(page));

      for (const name of THIRD_PARTY_IN_ENGLISH[page] as Array<string>) {
        expect({ page: page, name: name, bold: true }).toEqual({
          page: page,
          name: name,
          bold: labels.includes(name),
        });
      }
    }
  });

  it("name Admin Dashboard labels the Admin Dashboard has, and the English page bolds", () => {
    for (const page of Object.keys(ADMIN_DASHBOARD_LABELS)) {
      const labels: Array<string> = boldLabels(englishPage(page));

      for (const label of ADMIN_DASHBOARD_LABELS[page] as Array<string>) {
        expect({ page: page, label: label, bold: true, key: label }).toEqual({
          page: page,
          label: label,
          bold: labels.includes(label),
          key: adminDashboardLabel("en", label),
        });
        // Not a Dashboard label too, which would ask for the Dashboard's word.
        expect(isActionLabel(label)).toBe(false);
      }
    }
  });

  it("know every bold word on the English pages: a label, shown in English, another app's, or a lead", () => {
    for (const page of PAGE_NAMES) {
      const unlisted: Array<string> = boldLabels(englishPage(page)).filter(
        (span: string): boolean => {
          return (
            !isActionLabel(span) &&
            !(SHOWN_IN_ENGLISH[page] || []).includes(span) &&
            !(THIRD_PARTY_IN_ENGLISH[page] || []).includes(span) &&
            !(ADMIN_DASHBOARD_LABELS[page] || []).includes(span) &&
            !(PROSE_LEADS[page] || []).includes(span)
          );
        },
      );

      expect({ page: page, unlisted: unlisted }).toEqual({
        page: page,
        unlisted: [],
      });
    }
  });

  it("list as leads only bold words the English page has", () => {
    for (const page of Object.keys(PROSE_LEADS)) {
      const spans: Array<string> = boldLabels(englishPage(page));

      for (const lead of PROSE_LEADS[page] as Array<string>) {
        expect({ page: page, lead: lead, found: true, label: false }).toEqual({
          page: page,
          lead: lead,
          found: spans.includes(lead),
          label: isActionLabel(lead),
        });
      }
    }
  });

  it("find plenty to check on every page", () => {
    for (const page of PAGE_NAMES) {
      const labels: number = boldLabels(englishPage(page)).filter(
        (label: string): boolean => {
          return isActionLabel(label);
        },
      ).length;

      expect({ page: page, enough: labels >= 15 }).toEqual({
        page: page,
        enough: true,
      });
    }
  });

  it("name links that the English pages really have, to headings the English pages really have", () => {
    for (const link of LINKS_INTO_THESE_PAGES) {
      expect({ link: link, linked: true, heading: true }).toEqual({
        link: link,
        linked: englishPage(link.from).includes(
          `](/docs/${link.to}#${link.anchor})`,
        ),
        heading: anchorInLanguage("en", link.to, link.anchor) === link.anchor,
      });
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
    "$page ends on a Next steps section of cards",
    (entry: TranslatedPage) => {
      const scanned: ScannedPage = scanMarkdown(englishPage(entry.page));
      const last: DocsHeading = scanned.headings[
        scanned.headings.length - 1
      ] as DocsHeading;

      expect(last).toEqual(expect.objectContaining({ level: 2 }));
      expect(last.text).toBe("Next steps");
      expect(cardLines(englishPage(entry.page)).length).toBeGreaterThan(0);
    },
  );

  it.each(PAGES)(
    "$page has a Troubleshooting section before Next steps",
    (entry: TranslatedPage) => {
      const headings: Array<string> = scanMarkdown(
        englishPage(entry.page),
      ).headings.map((heading: DocsHeading): string => {
        return `${"#".repeat(heading.level)} ${heading.text}`;
      });

      expect(headings).toContain("## Troubleshooting");
      expect(headings.indexOf("## Troubleshooting")).toBeLessThan(
        headings.indexOf("## Next steps"),
      );
    },
  );

  it.each(PAGES)(
    "$page closes every bold and code span it opens",
    (entry: TranslatedPage) => {
      expect(unbalancedLines(englishPage(entry.page))).toEqual([]);
    },
  );

  it.each(PAGES)(
    "$page opens with steps to create the monitor",
    (entry: TranslatedPage) => {
      expect(stepCount(englishPage(entry.page))).toBeGreaterThanOrEqual(5);
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
      expect(title).not.toBe(entry.navTitle);
      expect(translated.split("\n")[0]).toBe(`# ${title}`);
    });

    it("keeps every code block, and builds every diagram the same way", () => {
      const translated: ScannedPage = scanMarkdown(
        readPage(language, entry.page),
      );

      expect(translated.fences.map(comparableFence)).toEqual(
        scanMarkdown(english).fences.map(comparableFence),
      );
    });

    it("keeps every piece of inline code", () => {
      expect(inlineCode(readPage(language, entry.page))).toEqual(
        inlineCode(english),
      );
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
        expect({ line: line, ascii: CARD_LINE.test(line) }).toEqual({
          line: line,
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
      const proseWords: Array<string> = PROSE[entry.page] || [];
      const missing: Array<string> = boldLabels(english)
        .filter((label: string): boolean => {
          return isActionLabel(label) && !proseWords.includes(label);
        })
        .filter((label: string): boolean => {
          return !translated.includes(
            `**${drawnActionLabel(language, label)}**`,
          );
        })
        .map((label: string): string => {
          return `${label} -> ${drawnActionLabel(language, label)}`;
        });

      expect(missing).toEqual([]);
    });

    it("gives every menu path, segment by segment, as this language's Dashboard draws it", () => {
      const translated: string = readPage(language, entry.page);
      const missing: Array<string> = menuPaths(english)
        .map((segments: Array<string>): string => {
          return segments
            .map((segment: string): string => {
              return drawnActionLabel(language, segment);
            })
            .join(PATH_SEPARATOR);
        })
        .filter((localized: string): boolean => {
          return !translated.includes(`**${localized}**`);
        });

      expect(missing).toEqual([]);
    });

    it("names in English what every Dashboard shows in English, and another company's buttons", () => {
      const translated: string = readPage(language, entry.page);
      const missing: Array<string> = [
        ...(SHOWN_IN_ENGLISH[entry.page] || []),
        ...(THIRD_PARTY_IN_ENGLISH[entry.page] || []),
      ].filter((name: string): boolean => {
        return !translated.includes(`**${name}**`);
      });

      expect(missing).toEqual([]);
    });

    it("names Admin Dashboard settings as this language's Admin Dashboard draws them", () => {
      const translated: string = readPage(language, entry.page);
      const missing: Array<string> = (ADMIN_DASHBOARD_LABELS[entry.page] || [])
        .map((label: string): string => {
          return adminDashboardLabel(language, label);
        })
        .filter((drawn: string): boolean => {
          return !translated.includes(`**${drawn}**`);
        });

      expect(missing).toEqual([]);
    });
  });

  describe("links into these pages from other pages", () => {
    it.each(LINKS_INTO_THESE_PAGES)(
      "$from links to the heading of $to it means ($anchor)",
      (link: LinkIntoPage) => {
        if (!hasPage(language, link.from)) {
          // Served in English, whose link names the English heading.
          return;
        }

        const anchor: string | null = anchorInLanguage(
          language,
          link.to,
          link.anchor,
        );

        expect(anchor).not.toBeNull();
        expect(readPage(language, link.from)).toContain(
          `](/docs/${link.to}#${anchor})`,
        );
      },
    );
  });
});

/*
 * The comparisons are the shared ones (DocsTranslationChecks); these pages
 * add menu paths with arrows, numbered steps, an Admin Dashboard label and
 * links into them from other pages.
 */
describe("the helpers, on these pages' shapes", () => {
  it("tell a menu path from a label", () => {
    const markdown: string =
      "**Monitors → Settings → Secrets** and **Field Path (Optional)**";

    expect(menuPaths(markdown)).toEqual([["Monitors", "Settings", "Secrets"]]);
    expect(boldLabels(markdown)).toEqual(["Field Path (Optional)"]);
  });

  it("find a line whose code span is closed by asterisks", () => {
    const broken: string =
      "**Result Value** / **Not Equal To** / `UP** in the offline one";
    const whole: string =
      "**Result Value** / **Not Equal To** / `UP` in the offline one";

    expect(unbalancedLines(broken)).toEqual([broken]);
    expect(unbalancedLines(whole)).toEqual([]);
    // Asterisks inside code are code, not bold.
    expect(unbalancedLines("Use `a ** b` here.")).toEqual([]);
  });

  it("find asterisks the renderer leaves when a bold span ends in punctuation and runs into a letter", async () => {
    expect(
      await strayMarkers(
        "# Title\n\n- **超时。**脚本运行超过 60 秒。",
        "zh-CN",
      ),
    ).toHaveLength(1);
    expect(
      await strayMarkers(
        "# Title\n\n- **超时**。脚本运行超过 60 秒。",
        "zh-CN",
      ),
    ).toEqual([]);
    expect(
      await strayMarkers(
        "# Title\n\n**メール本文 (HTML)**に HTML ソースが表示されます。",
        "ja",
      ),
    ).toHaveLength(1);
    expect(
      await strayMarkers(
        "# Title\n\n**メール本文 (HTML)** に HTML ソースが表示されます。",
        "ja",
      ),
    ).toEqual([]);
  });

  it("find underscores the renderer leaves when an italic span sits inside a word", async () => {
    expect(
      await strayMarkers("# Title\n\n例如_结果值等于_的条件。", "zh-CN"),
    ).toHaveLength(1);
    // Underscores in code and in link targets are not emphasis.
    expect(
      await strayMarkers(
        "# Title\n\nSet `PROBE_ALLOW_PRIVATE_NETWORK_MONITORS` [here](/docs/a_b).",
        "en",
      ),
    ).toEqual([]);
  });

  it("count the steps of every :::steps block, and only those", () => {
    const markdown: string = [
      "# Page",
      "## Create it",
      ":::steps",
      "### One",
      "```javascript",
      "### not a step",
      "```",
      "### Two",
      ":::",
      "### After the steps",
      ":::steps",
      "1. A numbered step is not a heading",
      ":::",
    ].join("\n");

    expect(stepCount(markdown)).toBe(2);
  });

  it("read an Admin Dashboard label from the Admin Dashboard's locale, not the Dashboard's", () => {
    expect(adminDashboardLabel("en", "Monitor Log Retention (Days)")).toBe(
      "Monitor Log Retention (Days)",
    );
    expect(adminDashboardLabel("da", "Monitor Log Retention (Days)")).toBe(
      "Opbevaring af overvågningslogfiler (dage)",
    );
    expect(isActionLabel("Monitor Log Retention (Days)")).toBe(false);
  });

  it("find the heading of the same place in a translated page", () => {
    // The Incoming Email page's filter types, which the JavaScript Expressions page names.
    const english: string | null = anchorInLanguage(
      "en",
      INCOMING_EMAIL_MONITOR,
      "available-filter-types",
    );

    expect(english).toBe("available-filter-types");
    expect(
      anchorInLanguage("en", INCOMING_EMAIL_MONITOR, "no-such-heading"),
    ).toBeNull();
  });

  it("compare a sequence diagram by its participants and messages, not its words", () => {
    const english: string = [
      "sequenceDiagram",
      "    participant O as OneUptime",
      "    participant P as Probe",
      "    O->>P: Script, secrets filled in",
      "    P->>O: Result, logs, time, metrics",
    ].join("\n");
    const translated: string = [
      "sequenceDiagram",
      "    participant O as OneUptime",
      "    participant P as Sonde",
      "    O->>P: Skript, Geheimnisse eingesetzt",
      "    P->>O: Ergebnis, Protokolle, Zeit, Metriken",
    ].join("\n");
    const reversed: string = [
      "sequenceDiagram",
      "    participant O as OneUptime",
      "    participant P as Sonde",
      "    P->>O: Skript, Geheimnisse eingesetzt",
      "    P->>O: Ergebnis, Protokolle, Zeit, Metriken",
    ].join("\n");

    expect(diagramSkeleton(translated)).toBe(diagramSkeleton(english));
    expect(diagramSkeleton(reversed)).not.toBe(diagramSkeleton(english));
  });
});
