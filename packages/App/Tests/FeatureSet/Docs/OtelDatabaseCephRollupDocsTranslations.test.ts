import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import {
  ScannedPage,
  hasPage,
  readPage,
  scanMarkdown,
} from "./DocsContentSupport";
import { drawnDashboardLabel, isDashboardLabel } from "./DocsDashboardLabels";
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
import {
  CephAlertTemplate,
  getAllCephAlertTemplates,
} from "Common/Types/Monitor/CephAlertTemplates";
import {
  DatabaseMetricDefinition,
  getAllDatabaseMetrics,
} from "Common/Types/Monitor/DatabaseMetricCatalog";
import { describe, expect, it } from "@jest/globals";

/*
 * Docs overhaul task 4: the OpenTelemetry page, the Database Health and Ceph
 * monitor pages and the notification rollup page are translated into every
 * docs language, and each translation says what the English page says: the
 * same sections, tables, lists, code and diagrams, links that land on a
 * heading in the reader's language, a title that is the nav link's, and the
 * Dashboard named the way that language's Dashboard draws it.
 *
 * "The way the Dashboard draws it" has three cases on these pages:
 *
 *   - A bold label that is a Dashboard label (DocsDashboardLabels) is, on
 *     the translated page, its value in that language's Dashboard locale -
 *     Persian included, as on the on-call, runbook and workflow pages
 *     (drawnDashboardLabel). Menu paths ("A → B → C") are drawn segment by
 *     segment.
 *   - A bold name the Dashboard has no locale key for is drawn in English in
 *     every language - the Ceph form's Quick Setup tab, the criteria's
 *     filter types and aggregations, the database metric picker's names -
 *     so the translations keep it exactly (SHOWN_IN_ENGLISH). If the
 *     Dashboard starts translating one, "names only bold text with no
 *     Dashboard label" fails and says which one to move.
 *   - Bold labels kept in English on purpose (KEPT_IN_ENGLISH) and bold
 *     words that are prose (PROSE) are listed with why.
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

const PAGES: ReadonlyArray<TranslatedPage> = [
  { page: "telemetry/open-telemetry", navTitle: "OpenTelemetry" },
  {
    page: "monitor/database-health-monitor",
    navTitle: "Database Health Monitor",
  },
  { page: "monitor/ceph-monitor", navTitle: "Ceph Monitor" },
  { page: "emails/notification-rollup", navTitle: "Notification Rollup" },
];

const PAGE_NAMES: Array<string> = PAGES.map((entry: TranslatedPage): string => {
  return entry.page;
});

const DATABASE_PAGE: string = "monitor/database-health-monitor";
const CEPH_PAGE: string = "monitor/ceph-monitor";

/*
 * The database metric picker lists the catalog's names
 * (DatabaseMetricCatalog's friendlyName) as they are, so the metric tables
 * keep them in English. These are the ones that happen to be Dashboard labels
 * elsewhere too; the rest are in SHOWN_IN_ENGLISH.
 */
const METRIC_NAMES_THAT_ARE_LABELS: Array<string> = [
  "Uptime",
  "Connections",
  "Queries",
  "Database Size",
  "Replication Lag",
];

/*
 * Bold Dashboard labels the translations keep in English, on purpose, by
 * page.
 */
const KEPT_IN_ENGLISH: Record<string, Array<string>> = {
  /*
   * A permission's name, as the team and API key permission pickers list it
   * (Permission.ts's title, which has no locale key). The "Create
   * {{itemName}}" template drawnDashboardLabel falls back to draws buttons,
   * not permissions.
   */
  "telemetry/open-telemetry": ["Create Telemetry Ingestion Key"],
  [DATABASE_PAGE]: METRIC_NAMES_THAT_ARE_LABELS,
};

/*
 * Bold words that are Dashboard labels by coincidence but are prose where the
 * English page uses them.
 */
const PROSE: Record<string, Array<string>> = {
  // "OneUptime finds exceptions inside your **logs**".
  "telemetry/open-telemetry": ["logs"],
  // "A **probe** with network access to the database".
  [DATABASE_PAGE]: ["probe"],
  // "One series per **active** health check".
  [CEPH_PAGE]: ["active"],
};

/*
 * Bold names the Dashboard draws in English in every language, because it
 * has no locale key for them. The translations keep each one exactly.
 */
const SHOWN_IN_ENGLISH: Record<string, Array<string>> = {
  [DATABASE_PAGE]: [
    // The monitor type picker's category heading.
    "Database Monitoring",
    // The criteria's filter types, and the over-time options.
    "Database Is Online",
    "Database Metric",
    "Database Collection Error",
    "JavaScript Expression",
    "All Values",
    "Ignore",
  ],
  [CEPH_PAGE]: [
    // The Ceph form's tabs that have no locale key (Advanced has one).
    "Quick Setup",
    "Custom Metric",
    // The Time Range picker's ends.
    "Past 1 Minute",
    "Past 365 Days",
    // The criteria's aggregations, conditions and no-data policies.
    "Maximum Value",
    "Minimum Value",
    "All Values",
    "Any Value",
    "Greater Than",
    "Less Than",
    "Greater Than Or Equal To",
    "Less Than Or Equal To",
    "Equal To",
    "Anomalously High",
    "Anomalously Low",
    "Anomalous",
    "Ignore",
    "Treat As Zero",
    // A template's name, as the Quick Setup picker shows it.
    "Inactive Placement Groups",
  ],
};

const PATH_SEPARATOR: string = " → ";

const TABLE_ROW: RegExp = /^\|(.*)\|\s*$/;
const TABLE_DELIMITER_CELL: RegExp = /^:?-+:?$/;

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
        return isDashboardLabel(segment);
      });
    });
}

// The cells of every table row outside code, the delimiter rows left out.
function tableRows(markdown: string): Array<Array<string>> {
  return prose(markdown)
    .split("\n")
    .map((line: string): RegExpMatchArray | null => {
      return line.trim().match(TABLE_ROW);
    })
    .filter((match: RegExpMatchArray | null): match is RegExpMatchArray => {
      return match !== null;
    })
    .map((match: RegExpMatchArray): Array<string> => {
      return (match[1] as string).split("|").map((cell: string): string => {
        return cell.trim();
      });
    })
    .filter((cells: Array<string>): boolean => {
      return !cells.every((cell: string): boolean => {
        return TABLE_DELIMITER_CELL.test(cell);
      });
    });
}

function templateNamesOnEnglishPage(): Array<CephAlertTemplate> {
  const names: Array<string> = tableRows(englishPage(CEPH_PAGE)).map(
    (cells: Array<string>): string => {
      return cells[0] as string;
    },
  );

  return getAllCephAlertTemplates().filter(
    (template: CephAlertTemplate): boolean => {
      return names.includes(template.name);
    },
  );
}

function metricNamesOnEnglishPage(): Array<string> {
  const bold: Array<string> = boldLabels(englishPage(DATABASE_PAGE));

  return getAllDatabaseMetrics()
    .map((metric: DatabaseMetricDefinition): string => {
      return metric.friendlyName;
    })
    .filter((name: string): boolean => {
      return bold.includes(name);
    });
}

describe("the lists this test keeps", () => {
  it("name only bold Dashboard labels the English page has", () => {
    for (const [lists, kind] of [
      [KEPT_IN_ENGLISH, "kept"],
      [PROSE, "prose"],
    ] as Array<[Record<string, Array<string>>, string]>) {
      for (const page of Object.keys(lists)) {
        expect(PAGE_NAMES).toContain(page);

        const labels: Array<string> = boldLabels(englishPage(page));

        for (const label of lists[page] as Array<string>) {
          expect({ kind: kind, page: page, label: label, ok: true }).toEqual({
            kind: kind,
            page: page,
            label: label,
            ok: labels.includes(label) && isDashboardLabel(label),
          });
        }
      }
    }
  });

  it("names only bold text with no Dashboard label in SHOWN_IN_ENGLISH", () => {
    for (const page of Object.keys(SHOWN_IN_ENGLISH)) {
      expect(PAGE_NAMES).toContain(page);

      const bold: Array<string> = boldLabels(englishPage(page));

      for (const name of SHOWN_IN_ENGLISH[page] as Array<string>) {
        expect({
          page: page,
          name: name,
          bold: bold.includes(name),
          dashboardLabel: isDashboardLabel(name),
        }).toEqual({
          page: page,
          name: name,
          bold: true,
          dashboardLabel: false,
        });
      }
    }
  });

  it("keep the database metric names as the catalog names them", () => {
    const catalogNames: Array<string> = getAllDatabaseMetrics().map(
      (metric: DatabaseMetricDefinition): string => {
        return metric.friendlyName;
      },
    );

    for (const name of METRIC_NAMES_THAT_ARE_LABELS) {
      expect(catalogNames).toContain(name);
    }

    // Every metric of the catalog is a bold name in the English tables.
    expect(metricNamesOnEnglishPage().sort()).toEqual([...catalogNames].sort());
  });

  it("find every Ceph template's name in the English tables", () => {
    expect(templateNamesOnEnglishPage().length).toBe(
      getAllCephAlertTemplates().length,
    );
  });

  it("find plenty to check on every page", () => {
    for (const page of PAGE_NAMES) {
      const labels: number = boldLabels(englishPage(page)).filter(
        (label: string): boolean => {
          return isDashboardLabel(label);
        },
      ).length;

      // The rollup page names a handful of controls; the others dozens.
      const enough: number = page === "emails/notification-rollup" ? 3 : 15;

      expect({ page: page, enough: labels >= enough }).toEqual({
        page: page,
        enough: true,
      });
      expect({
        page: page,
        paths: menuPaths(englishPage(page)).length > 0,
      }).toEqual({ page: page, paths: true });
    }
  });
});

describe("the English pages", () => {
  it.each(PAGES)("$page is titled as its nav link", (entry: TranslatedPage) => {
    expect(englishPage(entry.page).split("\n")[0]).toBe(`# ${entry.navTitle}`);
  });

  it.each(PAGES)(
    "$page ends on a Next steps section of cards",
    (entry: TranslatedPage) => {
      const scanned: ScannedPage = scanMarkdown(englishPage(entry.page));
      const last: { level: number; text: string } = scanned.headings[
        scanned.headings.length - 1
      ] as { level: number; text: string };

      expect(last).toEqual(expect.objectContaining({ level: 2 }));
      expect(last.text).toBe("Next steps");
      expect(cardLines(englishPage(entry.page)).length).toBeGreaterThan(0);
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

    it("has the English page's headings, tables and list items", () => {
      const translated: string = readPage(language, entry.page);

      expect(
        scanMarkdown(translated).headings.map((heading: { level: number }) => {
          return heading.level;
        }),
      ).toEqual(
        scanMarkdown(english).headings.map((heading: { level: number }) => {
          return heading.level;
        }),
      );
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
      const kept: Array<string> = KEPT_IN_ENGLISH[entry.page] || [];
      const proseWords: Array<string> = PROSE[entry.page] || [];
      const missing: Array<string> = boldLabels(english)
        .filter((label: string): boolean => {
          return (
            isDashboardLabel(label) &&
            !kept.includes(label) &&
            !proseWords.includes(label)
          );
        })
        .filter((label: string): boolean => {
          return !translated.includes(
            `**${drawnDashboardLabel(language, label)}**`,
          );
        })
        .map((label: string): string => {
          return `${label} -> ${drawnDashboardLabel(language, label)}`;
        });

      expect(missing).toEqual([]);
    });

    it("gives every menu path, segment by segment, as this language's Dashboard draws it", () => {
      const translated: string = readPage(language, entry.page);
      const missing: Array<string> = menuPaths(english)
        .map((segments: Array<string>): string => {
          return segments
            .map((segment: string): string => {
              return drawnDashboardLabel(language, segment);
            })
            .join(PATH_SEPARATOR);
        })
        .filter((localized: string): boolean => {
          return !translated.includes(`**${localized}**`);
        });

      expect(missing).toEqual([]);
    });

    it("keeps in English the names the product shows in English", () => {
      const translated: string = readPage(language, entry.page);
      const names: Array<string> = [
        ...(KEPT_IN_ENGLISH[entry.page] || []),
        ...(SHOWN_IN_ENGLISH[entry.page] || []),
      ];

      for (const name of names) {
        expect({
          name: name,
          kept: translated.includes(`**${name}**`),
        }).toEqual({ name: name, kept: true });
      }
    });
  });

  describe("the Database Health Monitor page", () => {
    it("names every metric as the database metric picker does", () => {
      const page: string = readPage(language, DATABASE_PAGE);

      for (const name of metricNamesOnEnglishPage()) {
        expect({ name: name, kept: page.includes(`**${name}**`) }).toEqual({
          name: name,
          kept: true,
        });
      }
    });

    it("quotes SQL Server's own error in English, as a heading the summary's search lands on", () => {
      const page: string = readPage(language, DATABASE_PAGE);

      expect(page).toContain(
        '### "The user does not have permission to perform this action"',
      );
      expect(page).toContain("VIEW SERVER STATE permission was denied");
    });
  });

  describe("the Ceph Monitor page", () => {
    it("lists every template by the name the Quick Setup picker shows, with its severity as drawn", () => {
      const rows: Array<Array<string>> = tableRows(
        readPage(language, CEPH_PAGE),
      );

      for (const template of templateNamesOnEnglishPage()) {
        const row: Array<string> | undefined = rows.find(
          (cells: Array<string>): boolean => {
            return cells[0] === template.name;
          },
        );

        expect({ template: template.name, listed: row !== undefined }).toEqual({
          template: template.name,
          listed: true,
        });
        expect({ template: template.name, severity: row?.[1] }).toEqual({
          template: template.name,
          severity: drawnDashboardLabel(language, template.severity),
        });
      }
    });
  });
});

/*
 * The comparisons are the shared ones (DocsTranslationChecks); these pages
 * add tables read by their first cell, and arrow paths.
 */
describe("the helpers, on these pages' shapes", () => {
  it("tell a menu path from a label", () => {
    const markdown: string =
      "**Project Settings → Telemetry & APM → Ingestion Keys** and **Secret Key**";

    expect(menuPaths(markdown)).toEqual([
      ["Project Settings", "Telemetry & APM", "Ingestion Keys"],
    ]);
    expect(boldLabels(markdown)).toEqual(["Secret Key"]);
  });

  it("read table rows without their delimiter rows, and nothing inside code", () => {
    const markdown: string = [
      "| Template | Severity |",
      "| --- | --- |",
      "| OSD Down | Critical |",
      "",
      "```text",
      "| Not | A row |",
      "```",
    ].join("\n");

    expect(tableRows(markdown)).toEqual([
      ["Template", "Severity"],
      ["OSD Down", "Critical"],
    ]);
  });

  it("compare a flowchart by its ids and arrows, not its words", () => {
    const english: string = [
      "flowchart TB",
      '    probe{"Probe query OK?"} -->|No| offline["Monitor offline"]',
    ].join("\n");
    const translated: string = [
      "flowchart TB",
      '    probe{"Probe-Abfrage OK?"} -->|"Nein"| offline["Monitor offline"]',
    ].join("\n");
    const rewired: string = [
      "flowchart TB",
      '    offline{"Probe-Abfrage OK?"} -->|"Nein"| probe["Monitor offline"]',
    ].join("\n");

    expect(diagramSkeleton(translated)).toBe(diagramSkeleton(english));
    expect(diagramSkeleton(rewired)).not.toBe(diagramSkeleton(english));
  });
});
