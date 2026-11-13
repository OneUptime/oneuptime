import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { anchorsOf, hasPage, readPage } from "./DocsContentSupport";
import { drawnActionLabel, isActionLabel } from "./DocsDashboardLabels";
import { pathWithArrows } from "./DocsPageShape";
import {
  menuSections,
  readDashboardSource,
  sectionByTitle,
} from "./DocsDashboardMenus";
import {
  CARD_LINE,
  anchorProblems,
  boldSpans,
  cardLines,
  cardTargets,
  inlineCode,
  navTitle,
  prose,
  strayMarkers,
  tableShape,
} from "./DocsTranslationChecks";
import { GETTING_STARTED_PLACES, cardTargetsAt } from "./GettingStartedPage";
import {
  GLOSSARY,
  cardLinkTargets,
  GlossaryTermBlock,
  WHICH_ONE,
  glossaryTerms,
  linkedPage,
  linksOf,
  sectionHeadings,
  sectionUnder,
  tablesIn,
} from "./GlossaryDocsSupport";
import GlossaryTerm from "Common/Types/Docs/GlossaryTerm";
import { slugifyMarkdownHeading } from "Common/Server/Types/MarkdownSlugify";
import Project from "Common/Models/DatabaseModels/Project";
import { describe, expect, it } from "@jest/globals";

/*
 * "WHICH ONE DO I USE?" (#6818): the things in OneUptime that look alike,
 * side by side, one short table each, in every docs language.
 *
 * One page with a section per set rather than a page per set: someone
 * puzzled by one pair is usually puzzled by the next, the Introduction
 * menu stays short, and each section has an anchor that the overview of
 * every thing it compares links to from its first paragraph.
 *
 * Held here:
 *
 *   - its five sets, each under the question it answers, each one short
 *     table that fits a screen, whose first column opens the page the
 *     Glossary gives the same thing - so the two pages never send a reader
 *     to different places;
 *   - what it says about the product: where monitor groups are turned on
 *     and that they start off, where each key is created;
 *   - the overviews' first paragraphs that link to it (and to the Glossary);
 *   - each translation: the same tables and links, the Dashboard's words in
 *     that language, anchors that land.
 */

const LANGUAGES: Array<string> = SUPPORTED_DOCS_LANGUAGE_CODES.filter(
  (language: string): boolean => {
    return language !== "en";
  },
);

const ENGLISH: string = readPage("en", WHICH_ONE);
const PATH_SEPARATOR: string = " → ";

// Each set: its question, and the Glossary term of each row, in order.
interface ComparedSet {
  heading: string;
  rows: Array<GlossaryTerm>;
}

const SETS: ReadonlyArray<ComparedSet> = [
  {
    heading: "## Incident, alert or another kind of problem?",
    rows: [
      GlossaryTerm.Incident,
      GlossaryTerm.Alert,
      GlossaryTerm.Episode,
      GlossaryTerm.Exception,
      GlossaryTerm.AIInsights,
      GlossaryTerm.SecurityCase,
    ],
  },
  {
    heading: "## Workflow, runbook, playbook or AI rule?",
    rows: [
      GlossaryTerm.Workflow,
      GlossaryTerm.Runbook,
      GlossaryTerm.Playbook,
      GlossaryTerm.AIRule,
    ],
  },
  {
    heading: "## Monitor group, service or label?",
    rows: [GlossaryTerm.MonitorGroup, GlossaryTerm.Service, GlossaryTerm.Label],
  },
  {
    heading: "## Probe, agent, collector or Runner?",
    rows: [
      GlossaryTerm.Probe,
      GlossaryTerm.InfrastructureAgent,
      GlossaryTerm.OpenTelemetryCollector,
      GlossaryTerm.KubernetesAgent,
      GlossaryTerm.Runner,
      // Ingestion key or API key?
      GlossaryTerm.IngestionKey,
      GlossaryTerm.APIKey,
    ],
  },
  {
    heading: "## Dashboard, public dashboard or status page?",
    rows: [
      GlossaryTerm.Dashboard,
      GlossaryTerm.PublicDashboard,
      GlossaryTerm.StatusPage,
    ],
  },
];

/*
 * The overviews that link here, or to the Glossary, from their first
 * paragraph: the page and the anchor each opens.
 */
const FIRST_PARAGRAPH_LINKS: Record<string, string> = {
  "incidents/index": `/docs/${WHICH_ONE}#incident-alert-or-another-kind-of-problem`,
  "alerts/index": `/docs/${WHICH_ONE}#incident-alert-or-another-kind-of-problem`,
  "workflows/index": `/docs/${WHICH_ONE}#workflow-runbook-playbook-or-ai-rule`,
  "runbooks/index": `/docs/${WHICH_ONE}#workflow-runbook-playbook-or-ai-rule`,
  "monitor/monitor-groups": `/docs/${WHICH_ONE}#monitor-group-service-or-label`,
  "telemetry/services": `/docs/${WHICH_ONE}#monitor-group-service-or-label`,
  "probe/custom-probe": `/docs/${WHICH_ONE}#probe-agent-collector-or-runner`,
  "telemetry/ingestion-keys": `/docs/${WHICH_ONE}#ingestion-key-or-api-key`,
  "dashboards/index": `/docs/${WHICH_ONE}#dashboard-public-dashboard-or-status-page`,
  "status-pages/index": `/docs/${WHICH_ONE}#dashboard-public-dashboard-or-status-page`,
  "slo/introduction": `/docs/${GLOSSARY}#slo`,
  "on-call/index": `/docs/${GLOSSARY}#on-call-policy`,
  "inventory/overview": `/docs/${GLOSSARY}#what-you-watch`,
};

const GLOSSARY_TERMS: Array<GlossaryTermBlock> = glossaryTerms(
  readPage("en", GLOSSARY),
);

function glossaryTerm(id: GlossaryTerm): GlossaryTermBlock {
  return GLOSSARY_TERMS.find((block: GlossaryTermBlock): boolean => {
    return block.anchor === id;
  }) as GlossaryTermBlock;
}

// The rows of every table in a set's section, in order.
function rowsOf(markdown: string, heading: string): Array<Array<string>> {
  return tablesIn(sectionUnder(markdown, heading)).flat();
}

// A page's first paragraph: the line under its title.
function firstParagraph(markdown: string): string {
  return markdown.split("\n")[2] as string;
}

const WORDS: RegExp = /\S+/g;

describe("Which One Do I Use?, in English", () => {
  it("is in the Introduction group, right after the Glossary", () => {
    const introduction: NavGroup = (DocsNav as Array<NavGroup>).find(
      (group: NavGroup): boolean => {
        return group.title === "Introduction";
      },
    ) as NavGroup;
    const urls: Array<string> = introduction.links.map(
      (link: NavLink): string => {
        return link.url;
      },
    );

    expect(urls.indexOf(`/docs/${WHICH_ONE}`)).toBe(
      urls.indexOf(`/docs/${GLOSSARY}`) + 1,
    );
    expect(ENGLISH.split("\n")[0]).toBe("# Which One Do I Use?");
    // Getting Started's first screen opens it: New to OneUptime?, under the eight jobs (#6822).
    expect(
      cardTargetsAt(
        readPage("en", "introduction/getting-started"),
        GETTING_STARTED_PLACES.newcomers,
      ),
    ).toContain(`/docs/${WHICH_ONE}`);
  });

  it("compares five sets, each under the question it answers, then ends on next steps", () => {
    expect(sectionHeadings(ENGLISH)).toEqual([
      ...SETS.map((set: ComparedSet): string => {
        return set.heading;
      }),
      "## Next steps",
    ]);
  });

  it("opens with a card for each set, in order", () => {
    const opening: string = ENGLISH.split("\n## ")[0] as string;

    expect(cardLinkTargets(cardLines(opening))).toEqual(
      SETS.map((set: ComparedSet): string => {
        return `#${slugifyMarkdownHeading(set.heading.slice(3))}`;
      }),
    );
  });

  it("fits each set on one screen: one short table, a sentence before it, at most one after", () => {
    for (const set of SETS) {
      const section: string = sectionUnder(ENGLISH, set.heading);
      const tables: Array<Array<Array<string>>> = tablesIn(section);
      const words: number = (
        section.replace(/\(\/docs\/[^)]*\)/g, "").match(WORDS) || []
      ).length;

      for (const table of tables) {
        expect({ set: set.heading, rows: table.length <= 6 }).toEqual({
          set: set.heading,
          rows: true,
        });
      }

      expect({
        set: set.heading,
        tables: tables.length >= 1 && tables.length <= 2,
      }).toEqual({ set: set.heading, tables: true });
      expect({ set: set.heading, words: words, short: words <= 330 }).toEqual({
        set: set.heading,
        words: words,
        short: true,
      });
    }
  });

  it("opens each choice from its first column, at the page the Glossary gives the same thing", () => {
    for (const set of SETS) {
      const rows: Array<Array<string>> = rowsOf(ENGLISH, set.heading);

      expect({ set: set.heading, rows: rows.length }).toEqual({
        set: set.heading,
        rows: set.rows.length,
      });

      rows.forEach((row: Array<string>, index: number) => {
        const links: Array<{ text: string; target: string }> = linksOf(
          row[0] as string,
        );
        const id: GlossaryTerm = set.rows[index] as GlossaryTerm;
        const glossaryTargets: Array<string> = linksOf(
          glossaryTerm(id).names,
        ).map((link: { target: string }): string => {
          return link.target;
        });

        // The cell is the link, and nothing else.
        expect({
          cell: row[0],
          one:
            links.length === 1 &&
            row[0] === `[${links[0]?.text}](${links[0]?.target})`,
        }).toEqual({ cell: row[0], one: true });
        expect({
          cell: row[0],
          term: id,
          glossary: glossaryTargets.includes(links[0]?.target as string),
        }).toEqual({ cell: row[0], term: id, glossary: true });
      });
    }
  });

  it("says which key each install takes, the same way in every row", () => {
    const rows: Array<Array<string>> = tablesIn(
      sectionUnder(ENGLISH, "## Probe, agent, collector or Runner?"),
    )[0] as Array<Array<string>>;

    expect(
      rows.map((row: Array<string>): string => {
        return row[3] as string;
      }),
    ).toEqual([
      "Its own probe ID and key",
      "The monitor's secret key",
      "An ingestion key",
      "An ingestion key",
      "Its own Runner ID and key",
    ]);

    // As each page that installs it says.
    expect(readPage("en", "probe/custom-probe")).toContain("PROBE_KEY");
    expect(readPage("en", "monitor/server-monitor")).toContain(
      "the monitor's secret key",
    );
    expect(readPage("en", "telemetry/hosts")).toContain("An ingestion key.");
    expect(readPage("en", "telemetry/kubernetes-agent")).toContain(
      "An ingestion key.",
    );
    expect(readPage("en", "runbooks/agents")).toContain("ONEUPTIME_RUNNER_KEY");
  });

  it("creates each key where Project Settings keeps it, and turns monitor groups on where they start off", () => {
    const settings: Array<{ title: string; items: Array<string> }> =
      menuSections(readDashboardSource("Pages/Settings/SideMenu.tsx"));

    expect(sectionByTitle(settings, "Telemetry & APM").items).toContain(
      "Ingestion Keys",
    );
    expect(sectionByTitle(settings, "Advanced").items).toEqual(
      expect.arrayContaining(["API Keys", "Feature Flags"]),
    );

    const keys: string = sectionUnder(ENGLISH, "### Ingestion key or API key?");

    expect(keys).toContain(
      "**Project Settings → Telemetry & APM → Ingestion Keys**",
    );
    expect(keys).toContain("**Project Settings → Advanced → API Keys**");

    expect(
      (
        new Project().getTableColumnMetadata(
          "isFeatureFlagMonitorGroupsEnabled",
        ) as { defaultValue?: unknown }
      ).defaultValue,
    ).toBe(false);
    expect(
      sectionUnder(ENGLISH, "## Monitor group, service or label?"),
    ).toContain(
      "Monitor groups start turned off: turn them on under **Project Settings → Advanced → Feature Flags**.",
    );
  });

  it("is linked from the first paragraph of the overview of each thing it compares", () => {
    for (const [page, target] of Object.entries(FIRST_PARAGRAPH_LINKS)) {
      const links: Array<string> = linksOf(
        firstParagraph(readPage("en", page)),
      ).map((link: { target: string }): string => {
        return link.target;
      });

      expect({ page: page, links: links }).toEqual({
        page: page,
        links: expect.arrayContaining([target]),
      });

      const [linked, anchor] = target.replace(/^\/docs\//, "").split("#") as [
        string,
        string,
      ];

      expect({
        target: target,
        heading: anchorsOf("en", linked).has(anchor),
      }).toEqual({ target: target, heading: true });
    }
  });
});

describe.each(LANGUAGES)("Which One Do I Use? in %s", (language: string) => {
  const translated: string = hasPage(language, WHICH_ONE)
    ? readPage(language, WHICH_ONE)
    : "";

  it("is translated, under the nav link's title", () => {
    expect(hasPage(language, WHICH_ONE)).toBe(true);
    expect(translated).not.toEqual(ENGLISH);
    expect(translated.split("\n")[0]).toBe(
      `# ${navTitle(language, "Which One Do I Use?")}`,
    );
  });

  it("keeps every table, and opens the same page from each row's first column", () => {
    expect(tableShape(translated)).toEqual(tableShape(ENGLISH));

    const englishRows: Array<string> = tablesIn(ENGLISH)
      .flat()
      .map((row: Array<string>): string => {
        return linksOf(row[0] as string)
          .map((link: { target: string }): string => {
            return linkedPage(link.target);
          })
          .join(",");
      });
    const rows: Array<string> = tablesIn(translated)
      .flat()
      .map((row: Array<string>): string => {
        return linksOf(row[0] as string)
          .map((link: { target: string }): string => {
            return linkedPage(link.target);
          })
          .join(",");
      });

    expect(rows).toEqual(englishRows);
    expect(inlineCode(translated)).toEqual(inlineCode(ENGLISH));
  });

  it("names every Dashboard label and menu path the English page names, as this language's Dashboard draws them", () => {
    const missing: Array<string> = boldSpans(prose(ENGLISH))
      .map((span: string): string | null => {
        if (span.includes(PATH_SEPARATOR)) {
          const segments: Array<string> = span.split(PATH_SEPARATOR);

          // With the arrows this language's pages draw ("←" beside a Persian step, #7611).
          return segments.every((segment: string): boolean => {
            return isActionLabel(segment.trim());
          })
            ? pathWithArrows(
                segments.map((segment: string): string => {
                  return drawnActionLabel(language, segment.trim());
                }),
                language,
              )
            : null;
        }

        return isActionLabel(span) ? drawnActionLabel(language, span) : null;
      })
      .filter((drawn: string | null): drawn is string => {
        return drawn !== null && !translated.includes(`**${drawn}**`);
      });

    expect(missing).toEqual([]);
  });

  it("writes its cards with an ASCII ': ' after the link, and opens this language's sections", () => {
    const lines: Array<string> = cardLines(translated);

    expect(lines.length).toBe(cardLines(ENGLISH).length);

    for (const line of lines) {
      expect({ line: line, ascii: CARD_LINE.test(line) }).toEqual({
        line: line,
        ascii: true,
      });
    }

    const headings: Array<string> = sectionHeadings(translated)
      .slice(0, SETS.length)
      .map((heading: string): string => {
        return `#${slugifyMarkdownHeading(heading.slice(3))}`;
      });

    expect(
      cardLinkTargets(lines).slice(0, SETS.length).map(decodeURIComponent),
    ).toEqual(headings);
    expect(cardTargets(lines).slice(SETS.length)).toEqual(
      cardTargets(cardLines(ENGLISH)).slice(SETS.length),
    );
  });

  it("links only to anchors that are headings of the page they open", () => {
    expect(anchorProblems(language, WHICH_ONE)).toEqual([]);
  });

  it("closes every bold span it opens, as the page is drawn", async () => {
    expect(await strayMarkers(translated, language)).toEqual([]);
  });

  it("is linked from the first paragraph of the same overviews, at this language's headings", () => {
    const problems: Array<string> = [];

    for (const [page, target] of Object.entries(FIRST_PARAGRAPH_LINKS)) {
      const links: Array<string> = linksOf(
        firstParagraph(readPage(language, page)),
      ).map((link: { target: string }): string => {
        return link.target;
      });
      const expected: string = linkedPage(target);
      const found: string | undefined = links.find((link: string): boolean => {
        return linkedPage(link) === expected;
      });

      if (!found) {
        problems.push(`${page}: no link to ${expected}`);
        continue;
      }

      const anchor: string = decodeURIComponent(found.split("#")[1] || "");

      if (!anchorsOf(language, expected).has(anchor)) {
        problems.push(`${page}: ${found} is no heading`);
      }
    }

    expect(problems).toEqual([]);
  });
});
