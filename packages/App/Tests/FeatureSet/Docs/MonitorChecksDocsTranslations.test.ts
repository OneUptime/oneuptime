import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import DocsPlaceholders from "../../../FeatureSet/Docs/Utils/Placeholders";
import DocsRender from "../../../FeatureSet/Docs/Utils/Render";
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
  tableShape,
} from "./DocsTranslationChecks";
import MonitorCriteria from "Common/Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import { describe, expect, it } from "@jest/globals";

/*
 * Docs overhaul task 7: the DNS, DNSSEC, SSL Certificate, Domain and Manual
 * monitor pages, JavaScript Expressions and Monitor Secrets, in every docs
 * language. Each translation says what the English page says: the same
 * sections, steps, tables, lists, cards, code and diagrams, links that land
 * on a heading in the reader's language, a title that is the nav link's,
 * and the product named the way that language's product draws it.
 *
 * "The way the product draws it" has two sources on these pages:
 *
 *   - A bold Dashboard label (DocsDashboardLabels) is its value in that
 *     language's Dashboard locale, Persian included, as on the probe monitor
 *     pages (drawnActionLabel). "Create Monitor Status Event" and "Create
 *     Monitor Secret" are filled into that language's "Create {{itemName}}".
 *     Menu paths ("A → B → C") are drawn segment by segment.
 *   - The criteria filters and most of their conditions (DNS Record Value,
 *     Is Valid Certificate, Domain Expires In Days, Greater Than), the type
 *     picker's DNS Monitoring and Basic Monitoring categories and the RDAP
 *     and WHOIS lookup methods have no Dashboard locale key: every
 *     language's Dashboard shows them in English, so every translation
 *     names them in English (SHOWN_IN_ENGLISH). When the Dashboard gains a
 *     key for one, a test below fails until the pages name it as drawn.
 *
 * The incident and alert titles a new monitor's default criteria create are
 * English in every project, so every translation quotes them as created.
 *
 * Bold words that are Dashboard labels only by coincidence are PROSE, with
 * why; bold words that are neither labels nor shown in English are the
 * pages' own leads (PROSE_LEADS), which a translation words freely.
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

const DNS_MONITOR: string = "monitor/dns-monitor";
const DNSSEC_MONITOR: string = "monitor/dnssec-monitor";
const SSL_MONITOR: string = "monitor/ssl-certificate-monitor";
const DOMAIN_MONITOR: string = "monitor/domain-monitor";
const MANUAL_MONITOR: string = "monitor/manual-monitor";
const JAVASCRIPT_EXPRESSION: string = "monitor/javascript-expression";
const MONITOR_SECRETS: string = "monitor/monitor-secrets";

const PAGES: ReadonlyArray<TranslatedPage> = [
  { page: DNS_MONITOR, navTitle: "DNS Monitor" },
  { page: DNSSEC_MONITOR, navTitle: "DNSSEC Monitor" },
  { page: SSL_MONITOR, navTitle: "SSL Certificate Monitor" },
  { page: DOMAIN_MONITOR, navTitle: "Domain Monitor" },
  { page: MANUAL_MONITOR, navTitle: "Manual Monitor" },
  { page: JAVASCRIPT_EXPRESSION, navTitle: "JavaScript Expressions" },
  { page: MONITOR_SECRETS, navTitle: "Monitor Secrets" },
];

const PAGE_NAMES: Array<string> = PAGES.map((entry: TranslatedPage): string => {
  return entry.page;
});

// The monitor types whose default criteria a page lists, by page.
const DEFAULT_CRITERIA_TYPES: Record<string, MonitorType> = {
  [DNS_MONITOR]: MonitorType.DNS,
  [DNSSEC_MONITOR]: MonitorType.DNSSEC,
  [SSL_MONITOR]: MonitorType.SSLCertificate,
  [DOMAIN_MONITOR]: MonitorType.Domain,
};

// The numeric conditions every number filter offers, none of them keyed.
const NUMBER_CONDITIONS_IN_ENGLISH: Array<string> = [
  "Greater Than",
  "Less Than",
  "Greater Than Or Equal To",
  "Less Than Or Equal To",
];

// The text conditions besides Contains, which is keyed.
const TEXT_CONDITIONS_IN_ENGLISH: Array<string> = [
  "Not Contains",
  "Starts With",
  "Ends With",
  "Equal To",
  "Not Equal To",
];

/*
 * Bold names every language's Dashboard shows in English, because its
 * locale has no key for them, by page. A translation keeps each one bold and
 * in English, so the reader finds it as the screen shows it.
 */
const SHOWN_IN_ENGLISH: Record<string, Array<string>> = {
  [DNS_MONITOR]: [
    // The type picker's category.
    "DNS Monitoring",
    // The criteria filters (CheckOn) and their conditions (FilterType).
    "DNS Is Online",
    "DNS Response Time (in ms)",
    "DNS Record Exists",
    "DNS Record Value",
    "DNSSEC Is Valid",
    ...NUMBER_CONDITIONS_IN_ENGLISH,
    ...TEXT_CONDITIONS_IN_ENGLISH,
    // The over-time aggregates and No Data options without a key.
    "Maximum Value",
    "Minimum Value",
    "All Values",
    "Any Value",
    "Ignore",
    "Treat As Zero",
  ],
  [DNSSEC_MONITOR]: [
    "DNS Monitoring",
    "DNSSEC Chain Is Valid",
    "DNSSEC DNSKEY Record Exists",
    "DNSSEC DS Record Exists At Parent",
    "DNSSEC Signature Expires In Days",
    "DNSSEC Resolver Consensus (AD Flag)",
    "DNSSEC Nameservers Are Consistent",
    ...NUMBER_CONDITIONS_IN_ENGLISH,
  ],
  [SSL_MONITOR]: [
    "Is Valid Certificate",
    "Is Not A Valid Certificate",
    "Is Expired Certificate",
    "Is Self Signed Certificate",
    "Expires In Days",
    "Expires In Hours",
    ...NUMBER_CONDITIONS_IN_ENGLISH,
  ],
  [DOMAIN_MONITOR]: [
    "Basic Monitoring",
    // The Lookup Method dropdown's options other than Auto.
    "RDAP",
    "WHOIS",
    "Is Online",
    "Is Request Timeout",
    "Domain Expires In Days",
    "Domain Is Expired",
    "Domain Registrar",
    "Domain Name Server",
    "Domain Status Code",
    ...NUMBER_CONDITIONS_IN_ENGLISH,
    ...TEXT_CONDITIONS_IN_ENGLISH,
    "All Values",
  ],
  [JAVASCRIPT_EXPRESSION]: ["JavaScript Expression", "Evaluates To True"],
};

/*
 * Bold words that are Dashboard labels by coincidence but are prose where the
 * English page uses them, which a translation words as its language needs.
 */
const PROSE: Record<string, Array<string>> = {
  // "- **Online** — the name resolves": the online criteria's lead word.
  [DNS_MONITOR]: ["Online"],
  /*
   * "An **alert** called ...": the word, stressed against "incident". Some
   * locales leave the "alert" key in English, which reads badly in a
   * sentence.
   */
  [SSL_MONITOR]: ["alert"],
  [DOMAIN_MONITOR]: ["alert"],
};

/*
 * The bold leads of the pages' own lists and sentences: "A role that can
 * create monitors", a default criteria's name, a best practice. They are
 * neither Dashboard labels nor shown in English, so a translation words
 * them freely; listing them makes a new bold name on these pages fail below
 * until it is put in SHOWN_IN_ENGLISH or here.
 */
const PROSE_LEADS: Record<string, Array<string>> = {
  [DNS_MONITOR]: [
    "A role that can create monitors",
    "A probe that can reach the DNS server.",
  ],
  [DNSSEC_MONITOR]: [
    "A role that can create monitors",
    "A signed zone.",
    "Outbound DNS from the probe",
    "Chain is broken",
    "Chain is valid",
    "Pick resolvers that are always reachable.",
    "Warn before signatures expire.",
    "Monitor every signed zone.",
    "Keep the nameserver consistency check on,",
  ],
  [SSL_MONITOR]: [
    "A role that can create monitors",
    "A probe that can reach the host and port.",
    "Certificate is not valid",
    "Certificate expires soon",
    "Certificate is valid",
    "Give yourself time to renew",
    "Monitor every endpoint",
    "Include other ports",
    "Check after renewal",
  ],
  [DOMAIN_MONITOR]: [
    "offline",
    "not registered",
    "A role that can create monitors",
    "Outbound access from the probe",
    "Domain check failed",
    "Domain expires soon",
    "Domain is not expired",
    "Give yourself time to renew",
    "Cover failed lookups",
    "Monitor all critical domains",
    "Track registrar changes",
  ],
  [MANUAL_MONITOR]: [],
  [JAVASCRIPT_EXPRESSION]: [
    "A quoted placeholder on its own is always true.",
    "Values are not escaped.",
    "A missing path stays as written.",
  ],
  [MONITOR_SECRETS]: [
    "The Growth plan or above",
    "A role that can manage secrets",
  ],
};

const PATH_SEPARATOR: string = " → ";

// An inline code span, which may hold asterisks of its own.
const INLINE_CODE_SPAN: RegExp = /`[^`\n]*`/g;

// Code in rendered HTML: a code block or an inline code span.
const RENDERED_CODE: RegExp = /<pre[\s\S]*?<\/pre>|<code[\s\S]*?<\/code>/g;

// A rendered HTML tag, whose attributes may hold underscores of their own.
const HTML_TAG: RegExp = /<[^>]*>/g;

const MONITOR_NAME: string = "Acme";

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

/*
 * The prose lines that open a bold span or an inline code span and never
 * close it: "**Not Equal To** / `200** in the offline one" leaves the code
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

/*
 * A page as the docs route draws it, without its title line, and the
 * emphasis markers left in its text: a bold or italic span CommonMark did
 * not close. A bold span that ends in punctuation and runs straight into a
 * letter, as in "**タイムアウト（ミリ秒）**を", is not closed, and its
 * asterisks show. An underscore never closes inside a word, so "_之后_的"
 * shows both underscores.
 */
async function strayMarkers(
  markdown: string,
  language: string,
): Promise<Array<string>> {
  const html: string = await DocsRender.render(
    DocsPlaceholders.render(markdown.split("\n").slice(1).join("\n"), language),
  );

  return html
    .replace(RENDERED_CODE, "")
    .split("\n")
    .map((line: string): string => {
      return line.replace(HTML_TAG, "");
    })
    .filter((line: string): boolean => {
      return line.includes("**") || line.includes("_");
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

/*
 * The incident and alert titles a new monitor of this type gets, as the
 * English pages quote them: "_monitor name_ is offline".
 */
function defaultTitles(monitorType: MonitorType): Array<string> {
  const instances: Array<MonitorCriteriaInstance> =
    MonitorCriteria.getDefaultMonitorCriteria({
      monitorType: monitorType,
      monitorName: MONITOR_NAME,
      onlineMonitorStatusId: ObjectID.generate(),
      offlineMonitorStatusId: ObjectID.generate(),
      defaultIncidentSeverityId: ObjectID.generate(),
      defaultAlertSeverityId: ObjectID.generate(),
      warningAlertSeverityId: ObjectID.generate(),
    }).data?.monitorCriteriaInstanceArray || [];

  const titles: Array<string> = [];

  for (const instance of instances) {
    const created: Array<{ title: string }> = [
      ...(instance.data?.createIncidents ? instance.data.incidents : []),
      ...(instance.data?.createAlerts ? instance.data.alerts : []),
    ];

    for (const item of created) {
      const title: string = item.title.replace(MONITOR_NAME, "_monitor name_");

      if (!titles.includes(title)) {
        titles.push(title);
      }
    }
  }

  return titles;
}

describe("the lists this test keeps", () => {
  it("name only pages of this group", () => {
    for (const lists of [
      SHOWN_IN_ENGLISH,
      PROSE,
      PROSE_LEADS,
      DEFAULT_CRITERIA_TYPES,
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

  it("know every bold word on the English pages: a label, shown in English, or a lead", () => {
    for (const page of PAGE_NAMES) {
      const unlisted: Array<string> = boldLabels(englishPage(page)).filter(
        (span: string): boolean => {
          return (
            !isActionLabel(span) &&
            !(SHOWN_IN_ENGLISH[page] || []).includes(span) &&
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

      expect({ page: page, enough: labels >= 8 }).toEqual({
        page: page,
        enough: true,
      });
    }
  });

  it("find the incident and alert titles of every page with default criteria", () => {
    for (const page of Object.keys(DEFAULT_CRITERIA_TYPES)) {
      const titles: Array<string> = defaultTitles(
        DEFAULT_CRITERIA_TYPES[page] as MonitorType,
      );

      expect(titles.length).toBeGreaterThan(0);

      for (const title of titles) {
        expect({ page: page, title: title, quoted: true }).toEqual({
          page: page,
          title: title,
          quoted: englishPage(page).includes(`"${title}"`),
        });
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
    "$page closes every bold and code span it opens",
    (entry: TranslatedPage) => {
      expect(unbalancedLines(englishPage(entry.page))).toEqual([]);
    },
  );

  it.each([DNS_MONITOR, DNSSEC_MONITOR, SSL_MONITOR, DOMAIN_MONITOR])(
    "%s says how many steps creating it takes, and has that many",
    (page: string) => {
      const english: string = englishPage(page);

      expect(stepCount(english)).toBe(6);
      expect(english).toContain("): Six steps in the dashboard.");
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

    it("names in English what every Dashboard shows in English", () => {
      const translated: string = readPage(language, entry.page);
      const missing: Array<string> = (
        SHOWN_IN_ENGLISH[entry.page] || []
      ).filter((name: string): boolean => {
        return !translated.includes(`**${name}**`);
      });

      expect(missing).toEqual([]);
    });

    it("quotes the incident and alert titles exactly as a new monitor creates them", () => {
      const monitorType: MonitorType | undefined =
        DEFAULT_CRITERIA_TYPES[entry.page];
      const translated: string = readPage(language, entry.page);
      const missing: Array<string> = (
        monitorType ? defaultTitles(monitorType) : []
      ).filter((title: string): boolean => {
        return !translated.includes(title);
      });

      expect(missing).toEqual([]);
    });
  });
});

/*
 * The comparisons are the shared ones (DocsTranslationChecks); these pages
 * add menu paths with arrows, numbered steps and quoted default titles.
 */
describe("the helpers, on these pages' shapes", () => {
  it("tell a menu path from a label", () => {
    const markdown: string =
      "**Monitors → Settings → Secrets** and **Create Monitor Secret**";

    expect(menuPaths(markdown)).toEqual([["Monitors", "Settings", "Secrets"]]);
    expect(boldLabels(markdown)).toEqual(["Create Monitor Secret"]);
  });

  it("find a line whose code span is closed by asterisks", () => {
    const broken: string =
      "**DNS Record Value** / **Not Equal To** / `93.184.216.34** in the offline one";
    const whole: string =
      "**DNS Record Value** / **Not Equal To** / `93.184.216.34` in the offline one";

    expect(unbalancedLines(broken)).toEqual([broken]);
    expect(unbalancedLines(whole)).toEqual([]);
    // Asterisks inside code are code, not bold.
    expect(unbalancedLines("Use `a ** b` here.")).toEqual([]);
  });

  it("find asterisks the renderer leaves when a bold span runs into a letter", async () => {
    expect(
      await strayMarkers(
        "# Title\n\n**タイムアウト（ミリ秒）**を設定します。",
        "ja",
      ),
    ).toHaveLength(1);
    expect(
      await strayMarkers(
        "# Title\n\n**タイムアウト（ミリ秒）** を設定します。",
        "ja",
      ),
    ).toEqual([]);
  });

  it("find underscores the renderer leaves when an italic span sits inside a word", async () => {
    expect(
      await strayMarkers("# Title\n\n第一次尝试_之后_的重试。", "zh-CN"),
    ).toHaveLength(1);
    // The quoted titles' italic name closes before a space.
    expect(
      await strayMarkers(
        "# Title\n\n名为“_monitor name_ is offline”的事件。",
        "zh-CN",
      ),
    ).toEqual([]);
    // Underscores in code and in link targets are not emphasis.
    expect(
      await strayMarkers(
        "# Title\n\nSet `PROBE_MONITOR_RETRY_LIMIT` [here](/docs/a_b).",
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
      "```bash",
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

  it("fill Create {{itemName}} with the record's name, as German draws it", () => {
    expect(drawnActionLabel("en", "Create Monitor Status Event")).toBe(
      "Create Monitor Status Event",
    );
    expect(drawnActionLabel("de", "Create Monitor Status Event")).toBe(
      "Monitor-Statusereignis erstellen",
    );
  });

  it("quote the titles a new DNS monitor creates", () => {
    expect(defaultTitles(MonitorType.DNS)).toEqual([
      "_monitor name_ is offline",
    ]);
  });

  it("compare a flowchart by its nodes and arrows, not its words", () => {
    const english: string = [
      "flowchart TB",
      '    query["Query the record type"] --> answer{"Records returned?"}',
      '    answer -->|"No, retries left"| query',
    ].join("\n");
    const translated: string = [
      "flowchart TB",
      '    query["Den Eintragstyp abfragen"] --> answer{"Einträge zurückgegeben?"}',
      '    answer -->|"Nein, Wiederholungen übrig"| query',
    ].join("\n");
    const rewired: string = [
      "flowchart TB",
      '    query["Den Eintragstyp abfragen"] --> answer{"Einträge zurückgegeben?"}',
      '    query -->|"Nein, Wiederholungen übrig"| answer',
    ].join("\n");

    expect(diagramSkeleton(translated)).toBe(diagramSkeleton(english));
    expect(diagramSkeleton(rewired)).not.toBe(diagramSkeleton(english));
  });
});
