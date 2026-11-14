import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import {
  DocsGlossaryEntry,
  parseGlossary,
} from "../../../FeatureSet/Docs/Utils/Glossary";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { anchorsOf, hasPage, listPages, readPage } from "./DocsContentSupport";
import {
  dashboardLocale,
  drawnActionLabel,
  isActionLabel,
} from "./DocsDashboardLabels";
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
} from "./DocsTranslationChecks";
import { GETTING_STARTED_PLACES, cardTargetsAt } from "./GettingStartedPage";
import { pathWithArrows } from "./DocsPageShape";
import {
  menuSections,
  readCommonSource,
  readDashboardSource,
  sectionByTitle,
} from "./DocsDashboardMenus";
import {
  GLOSSARY,
  cardLinkTargets,
  GlossaryTermBlock,
  boldNamesOf,
  codeNamesOf,
  englishNavTitle,
  glossaryTerms,
  linkedPage,
  linksOf,
  namesOf,
  namesTheCodeUses,
  namesTheProductUses,
  sectionHeadings,
  tablesIn,
} from "./GlossaryDocsSupport";
import GlossaryTerm, {
  ALL_GLOSSARY_TERMS,
} from "Common/Types/Docs/GlossaryTerm";
import Project from "Common/Models/DatabaseModels/Project";
import {
  findRetiredNames,
  RETIRED_NAMES,
  RetiredName,
} from "Common/Types/Docs/RetiredNames";
import { describe, expect, it } from "@jest/globals";

/*
 * THE GLOSSARY (#6818): every word OneUptime uses, in a sentence or two, with
 * the other names it goes by and the page that covers it, in every docs
 * language.
 *
 * The page is the one source of a definition: the docs serve the same
 * Markdown as data for the Dashboard and Ask AI (Utils/Glossary.ts), and
 * code links to a term by the id Common/Types/Docs/GlossaryTerm gives it.
 * So this suite holds the page to what the product is, and to the shape
 * those readers rely on:
 *
 *   - its terms are GlossaryTerm's, in order, each a "### " heading under
 *     one of its groups, and each ends on a names line: the other names in
 *     bold or as code, then the pages that cover it, by their nav titles;
 *   - every other name is one the product, its API or the docs use, every
 *     term #6817 lists has its names, and every product of the menu has a
 *     term that names it;
 *   - each translation keeps every term in the English term's place, so the
 *     page answers each English anchor in every language, names the term
 *     and its other names as that language's Dashboard draws them, and
 *     links the same pages by their titles in that language.
 */

const LANGUAGES: Array<string> = SUPPORTED_DOCS_LANGUAGE_CODES.filter(
  (language: string): boolean => {
    return language !== "en";
  },
);

const ENGLISH: string = readPage("en", GLOSSARY);
const TERMS: Array<GlossaryTermBlock> = glossaryTerms(ENGLISH);

const PATH_SEPARATOR: string = " → ";

// The groups, in the order a newcomer meets them.
const GROUPS: ReadonlyArray<string> = [
  "Start here",
  "What you watch",
  "Working on a problem",
  "Telemetry and dashboards",
  "Automation and AI",
  "What you install, and the keys",
  "Words with more than one meaning",
];

function term(id: GlossaryTerm): GlossaryTermBlock {
  const found: GlossaryTermBlock | undefined = TERMS.find(
    (candidate: GlossaryTermBlock): boolean => {
      return candidate.anchor === id;
    },
  );

  expect({ id: id, found: Boolean(found) }).toEqual({ id: id, found: true });

  return found as GlossaryTermBlock;
}

// Everything a term says: its heading, its definition and its names line.
function wholeTerm(block: GlossaryTermBlock): string {
  return [block.term, ...block.definition, block.names].join("\n");
}

/*
 * The names #6817 found one thing going by, and the words it found doing
 * several jobs: each has a term here, with every other name it listed.
 */
const NAMES_6817: Record<string, Array<string>> = {
  [GlossaryTerm.OnCallRules]: [],
  [GlossaryTerm.NotificationSettings]: [],
  [GlossaryTerm.HowToReachMe]: ["Personal On-Call Rules"],
  [GlossaryTerm.OnCallSchedule]: ["Rotation", "On-Call Policy Schedule"],
  [GlossaryTerm.AIInsights]: ["Insights"],
  [GlossaryTerm.Episode]: ["Incident Episode", "Alert Episode"],
  [GlossaryTerm.OnCallPolicy]: [
    "On-Call Duty",
    "On-Call Duty Policy",
    "On Call",
    "OnCallDutyPolicy",
  ],
  [GlossaryTerm.Service]: ["Service Catalog", "Telemetry Service"],
  [GlossaryTerm.ScheduledMaintenance]: [
    "Scheduled Maintenance Event",
    "Scheduled Event",
    "Event",
  ],
  [GlossaryTerm.Profiles]: ["Performance Profiles", "Continuous Profiling"],
  [GlossaryTerm.Exception]: ["Exception Tracking", "/telemetry-exception"],
  [GlossaryTerm.Criteria]: [
    "Monitoring Criteria",
    "Monitor Criteria",
    "Monitor Steps",
  ],
  [GlossaryTerm.IngestionKey]: ["Telemetry Ingestion Key", "oneuptime.apiKey"],
  [GlossaryTerm.Resource]: [],
  [GlossaryTerm.Role]: [],
  [GlossaryTerm.Rule]: [],
  [GlossaryTerm.Settings]: [],
  [GlossaryTerm.Policy]: [],
  [GlossaryTerm.Template]: [],
  [GlossaryTerm.Workspace]: [],
};

const SEVERAL_JOBS: ReadonlyArray<GlossaryTerm> = [
  GlossaryTerm.Rule,
  GlossaryTerm.Role,
  GlossaryTerm.Resource,
  GlossaryTerm.Settings,
  GlossaryTerm.Policy,
  GlossaryTerm.Template,
  GlossaryTerm.Workspace,
];

/*
 * Every product of the products menu (Dashboard/Utils/NavigationItems.tsx,
 * by its navbar.items.*Title key), and the term that explains it. Several
 * infrastructure products share one term, which names each of them.
 */
const MENU_PRODUCTS: Record<string, GlossaryTerm> = {
  monitorsTitle: GlossaryTerm.Monitor,
  incidentsTitle: GlossaryTerm.Incident,
  alertsTitle: GlossaryTerm.Alert,
  onCallDutyTitle: GlossaryTerm.OnCallPolicy,
  statusPagesTitle: GlossaryTerm.StatusPage,
  scheduledMaintenanceTitle: GlossaryTerm.ScheduledMaintenance,
  slosTitle: GlossaryTerm.SLO,
  logsTitle: GlossaryTerm.Logs,
  metricsTitle: GlossaryTerm.Metrics,
  tracesTitle: GlossaryTerm.Traces,
  performanceProfilesTitle: GlossaryTerm.Profiles,
  exceptionsTitle: GlossaryTerm.Exception,
  llmObservabilityTitle: GlossaryTerm.AILLM,
  dataObservabilityTitle: GlossaryTerm.DataObservability,
  topologyTitle: GlossaryTerm.Topology,
  securityEventsTitle: GlossaryTerm.SecurityEvents,
  dataSecurityTitle: GlossaryTerm.DataSecurity,
  aiChatTitle: GlossaryTerm.AskAI,
  sentinelInsightsTitle: GlossaryTerm.AIInsights,
  codeTitle: GlossaryTerm.Code,
  inventoryTitle: GlossaryTerm.Inventory,
  servicesTitle: GlossaryTerm.Service,
  databasesTitle: GlossaryTerm.Databases,
  queuesTitle: GlossaryTerm.Queues,
  rumTitle: GlossaryTerm.RealUserMonitoring,
  hostsTitle: GlossaryTerm.Host,
  kubernetesTitle: GlossaryTerm.Kubernetes,
  dockerTitle: GlossaryTerm.Infrastructure,
  dockerSwarmTitle: GlossaryTerm.Infrastructure,
  podmanTitle: GlossaryTerm.Infrastructure,
  proxmoxTitle: GlossaryTerm.Infrastructure,
  openstackTitle: GlossaryTerm.Infrastructure,
  vmwareTitle: GlossaryTerm.Infrastructure,
  cephTitle: GlossaryTerm.Infrastructure,
  storageArraysTitle: GlossaryTerm.Infrastructure,
  iotTitle: GlossaryTerm.Infrastructure,
  networkTitle: GlossaryTerm.Network,
  cloudTitle: GlossaryTerm.Cloud,
  appPlatformsTitle: GlossaryTerm.AppPlatforms,
  serverlessTitle: GlossaryTerm.Serverless,
  dashboardsTitle: GlossaryTerm.Dashboard,
  workflowsTitle: GlossaryTerm.Workflow,
  runbooksTitle: GlossaryTerm.Runbook,
  formsTitle: GlossaryTerm.Form,
  usersTitle: GlossaryTerm.Team,
  teamsTitle: GlossaryTerm.Team,
  projectSettingsTitle: GlossaryTerm.Settings,
};

// A name #6817 retired: one of RetiredNames' names, or a name its patterns find.
function isRetiredName(name: string): boolean {
  return (
    RETIRED_NAMES.some((retired: RetiredName): boolean => {
      return retired.name === name;
    }) || findRetiredNames(name).length > 0
  );
}

/*
 * The overview pages that keep a list of their own words (#6818 keeps
 * them): the sentence that opens each list links to the Glossary, and the
 * words a list shares with the Glossary - by a term's name or one of its
 * other names - are pinned here, so renaming one in either place without
 * the other fails.
 */
const TERM_LISTS: Record<string, { heading: string; shared: Array<string> }> = {
  "incidents/index": {
    heading: "## Key terms",
    shared: ["Incident", "Incident state", "Incident severity", "Owner"],
  },
  "status-pages/index": {
    heading: "## Key terms",
    shared: ["Status page", "Resource", "Subscriber"],
  },
  "workflows/index": { heading: "## Key terms", shared: ["Workflow"] },
  "runbooks/index": {
    heading: "## Key concepts",
    shared: ["Runbook", "Runner"],
  },
  "slo/introduction": {
    heading: "## Key concepts",
    shared: ["SLO", "Error budget"],
  },
  "on-call/index": {
    heading: "## The building blocks",
    shared: [
      "On-call policy",
      "Escalation rule",
      "On-call schedule",
      "How to Reach Me",
    ],
  },
};

// A list's words: the first cell of each row, without bold or a "(...)" note.
function listWords(page: string, heading: string): Array<string> {
  const lines: Array<string> = readPage("en", page).split("\n");
  const start: number = lines.indexOf(heading);
  const section: Array<string> = lines.slice(start + 1);
  const end: number = section.findIndex((line: string): boolean => {
    return line.startsWith("## ");
  });
  const table: Array<Array<string>> = tablesIn(
    section.slice(0, end < 0 ? undefined : end).join("\n"),
  )[0] as Array<Array<string>>;

  return table.map((row: Array<string>): string => {
    return (row[0] as string)
      .replace(/\*\*/g, "")
      .replace(/\s*\([^)]*\)\s*$/, "")
      .trim();
  });
}

// Every name the Glossary gives a term, as a set of lower-case words.
function glossaryNames(): Set<string> {
  const names: Set<string> = new Set<string>();

  for (const block of TERMS) {
    names.add(block.term.toLowerCase());

    for (const name of namesOf(block.names)) {
      names.add(name.toLowerCase());
    }
  }

  return names;
}

/*
 * The names a project is given when it is created (Common/Server/Services/
 * ProjectService.ts), by the variable that holds each one.
 */
const SEEDED_NAMES: Map<string, string> = new Map(
  Array.from(
    readCommonSource("Server/Services/ProjectService.ts").matchAll(
      /(\w+)\.name = "([^"]+)";/g,
    ),
  ).map((match: RegExpMatchArray): [string, string] => {
    return [match[1] as string, match[2] as string];
  }),
);

function seeded(variable: string): string {
  const name: string | undefined = SEEDED_NAMES.get(variable);

  expect({ variable: variable, seeded: typeof name }).toEqual({
    variable: variable,
    seeded: "string",
  });

  return name as string;
}

// The inline code of every English docs page but the Glossary.
function codeTheDocsUse(): Set<string> {
  const code: Set<string> = new Set<string>();

  for (const page of listPages("en")) {
    if (page === GLOSSARY) {
      continue;
    }

    for (const span of inlineCode(readPage("en", page))) {
      code.add(span.replace(/^`+|`+$/g, ""));
    }
  }

  return code;
}

const WORDS: RegExp = /\S+/g;
// A sentence ends at ".", "!" or "?" before a space and a capital, or at the end.
const SENTENCE_END: RegExp = /[.!?](?=\s+[A-Z]|$)/g;

describe("the Glossary, in English", () => {
  it("is in the Introduction group, right after Core Concepts", () => {
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

    expect(urls.indexOf(`/docs/${GLOSSARY}`)).toBe(
      urls.indexOf("/docs/introduction/core-concepts") + 1,
    );
    expect(ENGLISH.split("\n")[0]).toBe("# Glossary");
  });

  it("is linked from Getting Started's first screen, from Core Concepts and from the Quickstart's next steps", () => {
    // Getting Started's first screen: New to OneUptime?, right under the eight jobs (#6822).
    const startHere: Array<string> = cardTargetsAt(
      readPage("en", "introduction/getting-started"),
      GETTING_STARTED_PLACES.newcomers,
    );

    expect(startHere).toContain(`/docs/${GLOSSARY}`);
    expect(
      readPage("en", "introduction/core-concepts").split("\n")[2],
    ).toContain(`[Glossary](/docs/${GLOSSARY})`);

    const quickstartNext: string = readPage(
      "en",
      "introduction/quickstart",
    ).split("## Next steps")[1] as string;

    expect(cardTargets(cardLines(quickstartNext))).toContain(
      `/docs/${GLOSSARY}`,
    );
  });

  it("has the terms Common's GlossaryTerm lists, in its order, each with the anchor code links to", () => {
    expect(
      TERMS.map((block: GlossaryTermBlock): string => {
        return block.anchor;
      }),
    ).toEqual([...ALL_GLOSSARY_TERMS]);
    expect(new Set(ALL_GLOSSARY_TERMS).size).toBe(ALL_GLOSSARY_TERMS.length);
  });

  it("is a glossary, not the API reference: about eighty terms", () => {
    expect(TERMS.length).toBeGreaterThanOrEqual(60);
    expect(TERMS.length).toBeLessThanOrEqual(100);
  });

  it("puts every term under one of its groups, in the order a newcomer meets them", () => {
    expect(
      sectionHeadings(ENGLISH).map((heading: string): string => {
        return heading.slice(3);
      }),
    ).toEqual([...GROUPS, "Next steps"]);

    for (const block of TERMS) {
      expect({ term: block.term, group: GROUPS.includes(block.group) }).toEqual(
        { term: block.term, group: true },
      );
    }

    // The loop every project runs comes first.
    expect(term(GlossaryTerm.Project).group).toBe("Start here");
    expect(term(GlossaryTerm.Monitor).group).toBe("Start here");
    expect(term(GlossaryTerm.Incident).group).toBe("Start here");
    expect(term(GlossaryTerm.OnCallPolicy).group).toBe("Start here");
    expect(term(GlossaryTerm.StatusPage).group).toBe("Start here");
  });

  it("opens with a card for each group, in order", () => {
    const opening: string = ENGLISH.split("\n## ")[0] as string;

    expect(cardLinkTargets(cardLines(opening))).toEqual(
      GROUPS.map((group: string): string => {
        return `#${group
          .toLowerCase()
          .replace(/[^a-z0-9\s-]/g, "")
          .replace(/\s+/g, "-")}`;
      }),
    );
  });

  it("defines every term in one short paragraph of at most three sentences", () => {
    for (const block of TERMS) {
      const definition: string = (block.definition[0] || "").replace(
        /`[^`]*`/g,
        "code",
      );
      const sentences: number = (definition.match(SENTENCE_END) || []).length;
      const words: number = (definition.match(WORDS) || []).length;

      expect({
        term: block.term,
        paragraphs: block.definition.length,
        short: sentences >= 1 && sentences <= 3 && words <= 75,
      }).toEqual({ term: block.term, paragraphs: 1, short: true });
    }
  });

  it("ends every term on a names line: its other names, then the pages that cover it, by their nav titles", () => {
    const line: RegExp =
      /^(Also called: (\*\*[^*]+\*\*|`[^`]+`)(, (\*\*[^*]+\*\*|`[^`]+`))*\. )?See \[[^\]]+\]\([^)]+\)( and \[[^\]]+\]\([^)]+\))?\.$/;

    for (const block of TERMS) {
      expect({ term: block.term, names: block.names, ok: true }).toEqual({
        term: block.term,
        names: block.names,
        ok: line.test(block.names),
      });

      for (const link of linksOf(block.names)) {
        const page: string = linkedPage(link.target);
        const title: string | null = englishNavTitle(page);

        expect({
          term: block.term,
          link: link.target,
          title: link.text,
        }).toEqual({ term: block.term, link: link.target, title: title });

        const anchor: string | undefined = link.target.split("#")[1];

        if (anchor) {
          expect({
            term: block.term,
            link: link.target,
            heading: anchorsOf("en", page).has(anchor),
          }).toEqual({ term: block.term, link: link.target, heading: true });
        }
      }
    }
  });

  it("links nothing from a definition: every link is on the names line", () => {
    for (const block of TERMS) {
      expect({
        term: block.term,
        links: linksOf(block.definition.join(" ")),
      }).toEqual({ term: block.term, links: [] });
    }
  });

  it("gives only other names the product, its API or the docs use, never the term's own", () => {
    const productNames: Set<string> = namesTheProductUses();
    const codeNames: Set<string> = namesTheCodeUses();
    const docsCode: Set<string> = codeTheDocsUse();
    const seen: Set<string> = new Set<string>();

    for (const block of TERMS) {
      for (const name of boldNamesOf(block.names)) {
        /*
         * A name #6817 retired (RetiredNames) was the product's own, and is
         * kept here so people who learned it find the term, though the
         * product no longer draws it.
         */
        expect({
          term: block.term,
          name: name,
          used: productNames.has(name) || isRetiredName(name),
        }).toEqual({ term: block.term, name: name, used: true });
      }

      for (const name of codeNamesOf(block.names)) {
        expect({
          term: block.term,
          name: name,
          used: codeNames.has(name) || docsCode.has(name),
        }).toEqual({ term: block.term, name: name, used: true });
      }

      for (const name of namesOf(block.names)) {
        expect({
          term: block.term,
          name: name,
          own: name.toLowerCase() === block.term.toLowerCase(),
        }).toEqual({ term: block.term, name: name, own: false });

        // One name, one term: a name that two terms claimed would find neither.
        expect({ name: name, twice: seen.has(name.toLowerCase()) }).toEqual({
          name: name,
          twice: false,
        });
        seen.add(name.toLowerCase());
      }
    }
  });

  it("defines every thing #6817 found going by several names, with each of them", () => {
    for (const [id, names] of Object.entries(NAMES_6817)) {
      const block: GlossaryTermBlock = term(id as GlossaryTerm);

      expect({ term: block.term, names: namesOf(block.names) }).toEqual({
        term: block.term,
        names: expect.arrayContaining(names),
      });
    }
  });

  it("explains the words with several jobs, each in their own group, saying which job is whose", () => {
    for (const id of SEVERAL_JOBS) {
      expect({ id: id, group: term(id).group }).toEqual({
        id: id,
        group: "Words with more than one meaning",
      });
    }

    /*
     * "On-Call Rules" and "Notification Settings" each named two things
     * until #6817 kept the name for one and renamed the other: each says
     * where it lives, and what the other is called now.
     */
    const onCallRules: string = term(GlossaryTerm.OnCallRules).definition.join(
      " ",
    );
    const notificationSettings: string = term(
      GlossaryTerm.NotificationSettings,
    ).definition.join(" ");

    expect(onCallRules).toContain("Under **Incidents** and **Alerts**");
    expect(onCallRules).toContain("**How to Reach Me**");
    expect(onCallRules).toContain("**User Settings**");
    expect(notificationSettings).toContain("Under **User Settings**");
    expect(notificationSettings).toContain("**Notification Channels**");
    expect(notificationSettings).toContain("**Project Settings**");

    for (const definition of [onCallRules, notificationSettings]) {
      expect(definition).not.toMatch(/^Two different/);
    }
  });

  it("has a term for every product in the menu, which names it", () => {
    const items: Record<string, string> = (
      dashboardLocale("en")["navbar"] as { items: Record<string, string> }
    ).items;
    const products: Array<string> = Object.keys(items).filter(
      (key: string): boolean => {
        return key.endsWith("Title");
      },
    );

    // A product added to the menu needs its term here first.
    expect(products.sort()).toEqual(Object.keys(MENU_PRODUCTS).sort());

    for (const [key, id] of Object.entries(MENU_PRODUCTS)) {
      const product: string = items[key] as string;
      const said: string = wholeTerm(term(id)).toLowerCase();
      const singular: string = product.replace(/s$/, "").toLowerCase();

      expect({
        product: product,
        term: id,
        named: said.includes(product.toLowerCase()) || said.includes(singular),
      }).toEqual({ product: product, term: id, named: true });
    }
  });

  it("keeps the words each overview's own list shares with it, under the same names, and those lists link to it", () => {
    const names: Set<string> = glossaryNames();

    for (const [page, list] of Object.entries(TERM_LISTS)) {
      const words: Array<string> = listWords(page, list.heading);

      expect({
        page: page,
        shared: words.filter((word: string): boolean => {
          return names.has(word.toLowerCase());
        }),
      }).toEqual({ page: page, shared: list.shared });

      const lines: Array<string> = readPage("en", page).split("\n");
      const intro: string = lines
        .slice(lines.indexOf(list.heading) + 1, lines.indexOf(list.heading) + 4)
        .join("\n");

      expect({
        page: page,
        links: intro.includes(`(/docs/${GLOSSARY})`),
      }).toEqual({ page: page, links: true });
    }
  });

  it("says what a new project is given: its teams, monitor statuses, states, severities and maintenance states", () => {
    expect(term(GlossaryTerm.Team).definition.join(" ")).toContain(
      `three teams: ${seeded("ownerTeam")}, ${seeded("adminTeam")} and ${seeded("memberTeam")}.`,
    );
    expect(term(GlossaryTerm.MonitorStatus).definition.join(" ")).toContain(
      `**${seeded("operationalStatus")}**, **${seeded("degradedStatus")}** and **${seeded("downStatus")}**`,
    );

    const incidentStates: Array<string> = [
      seeded("createdIncidentState"),
      seeded("acknowledgedIncidentState"),
      seeded("resolvedIncidentState"),
    ];
    const alertStates: Array<string> = [
      seeded("createdAlertState"),
      seeded("acknowledgedAlertState"),
      seeded("resolvedAlertState"),
    ];

    // Incidents and alerts start with the same three states.
    expect(alertStates).toEqual(incidentStates);
    expect(term(GlossaryTerm.State).definition.join(" ")).toContain(
      `starts with **${incidentStates[0]}**, **${incidentStates[1]}** and **${incidentStates[2]}**`,
    );
    expect(term(GlossaryTerm.Severity).definition.join(" ")).toContain(
      `starts with ${seeded("criticalIncident")}, ${seeded("majorIncident")} and ${seeded("minorIncident")} for incidents, and **${seeded("highSeverity")}** and **${seeded("lowSeverity")}** for alerts`,
    );
    expect(
      term(GlossaryTerm.ScheduledMaintenance).definition.join(" "),
    ).toContain(
      `moves through the maintenance states **${seeded("createdScheduledMaintenanceState")}**, **${seeded("ongoingScheduledMaintenanceState")}**, **${seeded("endedScheduledMaintenanceState")}** and **${seeded("completedScheduledMaintenanceState")}**`,
    );
  });

  it("finds monitor groups, API keys and AI where Project Settings keeps them, and monitor groups start off", () => {
    const settings: Array<{ title: string; items: Array<string> }> =
      menuSections(readDashboardSource("Pages/Settings/SideMenu.tsx"));

    expect(sectionByTitle(settings, "Advanced").items).toEqual(
      expect.arrayContaining(["Feature Flags", "API Keys"]),
    );
    expect(term(GlossaryTerm.MonitorGroup).definition.join(" ")).toContain(
      "Turn monitor groups on under **Project Settings → Advanced → Feature Flags**.",
    );
    expect(term(GlossaryTerm.APIKey).definition.join(" ")).toContain(
      "**Project Settings → Advanced → API Keys**",
    );

    const flag: { defaultValue?: unknown } =
      new Project().getTableColumnMetadata(
        "isFeatureFlagMonitorGroupsEnabled",
      ) as { defaultValue?: unknown };

    expect(flag.defaultValue).toBe(false);

    const enableAi: { title?: string } = new Project().getTableColumnMetadata(
      "enableAi",
    ) as { title?: string };

    expect(enableAi.title).toBe("Enable AI");
    expect(term(GlossaryTerm.OneUptimeAI).definition.join(" ")).toContain(
      "The **Enable AI** switch in **Project Settings** turns all of it off.",
    );
  });

  it("names the Server / VM monitor's agent by its command, and the header an ingestion key goes in", () => {
    expect(
      term(GlossaryTerm.InfrastructureAgent).definition.join(" "),
    ).toContain("`oneuptime-infrastructure-agent`");
    expect(readPage("en", "monitor/server-monitor")).toContain(
      "`oneuptime-infrastructure-agent`",
    );
    expect(term(GlossaryTerm.IngestionKey).definition.join(" ")).toContain(
      "`x-oneuptime-token`",
    );
    expect(readPage("en", "telemetry/ingestion-keys")).toContain(
      "`x-oneuptime-token`",
    );
  });
});

describe.each(LANGUAGES)("the Glossary in %s", (language: string) => {
  const translated: string = hasPage(language, GLOSSARY)
    ? readPage(language, GLOSSARY)
    : "";
  const translatedTerms: Array<GlossaryTermBlock> = glossaryTerms(translated);

  it("is translated, under the nav link's title", () => {
    expect(hasPage(language, GLOSSARY)).toBe(true);
    expect(translated).not.toEqual(ENGLISH);
    expect(translated.split("\n")[0]).toBe(
      `# ${navTitle(language, "Glossary")}`,
    );
  });

  it("keeps every term in the English term's place, so the page answers every English anchor and the data reads every term", () => {
    expect(translatedTerms.length).toBe(TERMS.length);

    const groups: Array<string> = sectionHeadings(translated);

    expect(groups.length).toBe(GROUPS.length + 1);

    // Each term is under the group in the English term's group's place.
    translatedTerms.forEach((block: GlossaryTermBlock, index: number) => {
      expect({
        term: TERMS[index]!.term,
        group: groups.indexOf(`## ${block.group}`),
      }).toEqual({
        term: TERMS[index]!.term,
        group: GROUPS.indexOf(TERMS[index]!.group),
      });
    });

    const entries: Array<DocsGlossaryEntry> | null = parseGlossary(
      ENGLISH,
      translated,
      language,
    );

    expect(entries).not.toBeNull();
    expect(
      (entries || []).map((entry: DocsGlossaryEntry): string => {
        return entry.id;
      }),
    ).toEqual([...ALL_GLOSSARY_TERMS]);
  });

  it("names each term as this language's Dashboard draws it, and no two terms alike", () => {
    const misnamed: Array<string> = [];
    const englishAnchors: Array<string> = TERMS.map(
      (block: GlossaryTermBlock): string => {
        return block.anchor;
      },
    );

    translatedTerms.forEach((block: GlossaryTermBlock, index: number) => {
      const english: GlossaryTermBlock = TERMS[index]!;

      if (isActionLabel(english.term)) {
        const drawn: string = drawnActionLabel(language, english.term);
        /*
         * A word the Dashboard draws that is another term's English anchor
         * would take that term's address on this page (Italian draws
         * Queues as "Code", the anchor of Code): such a term says more
         * after the Dashboard's word.
         */
        const takesAnAddress: boolean =
          englishAnchors.includes(anchorOfHeading(drawn)) &&
          anchorOfHeading(drawn) !== english.anchor;
        const named: boolean = takesAnAddress
          ? block.term.startsWith(`${drawn} `)
          : block.term === drawn;

        if (!named) {
          misnamed.push(
            `${english.term}: "${block.term}", the Dashboard draws "${drawn}"${takesAnAddress ? ` (then more words: "${anchorOfHeading(drawn)}" is another term's address)` : ""}`,
          );
        }
      }

      // No term's own anchor is another term's English address.
      if (
        englishAnchors.includes(block.anchor) &&
        block.anchor !== english.anchor
      ) {
        misnamed.push(
          `${english.term}: "${block.term}" takes the address of ${block.anchor}`,
        );
      }
    });

    expect(misnamed).toEqual([]);
    expect(
      new Set([
        ...translatedTerms.map((block: GlossaryTermBlock): string => {
          return block.anchor;
        }),
        ...sectionHeadings(translated).map((heading: string): string => {
          return anchorOfHeading(heading.slice(3));
        }),
      ]).size,
    ).toBe(TERMS.length + GROUPS.length + 1);
  });

  it("defines every term in its own words, on one paragraph, and ends it on a names line", () => {
    translatedTerms.forEach((block: GlossaryTermBlock, index: number) => {
      const english: GlossaryTermBlock = TERMS[index]!;

      expect({
        term: english.term,
        paragraphs: block.definition.length,
      }).toEqual({
        term: english.term,
        paragraphs: 1,
      });
      expect({
        term: english.term,
        same: block.definition[0] === english.definition[0],
      }).toEqual({ term: english.term, same: false });
      expect({ term: english.term, names: block.names !== "" }).toEqual({
        term: english.term,
        names: true,
      });
    });
  });

  it("gives each term's other names as this language's Dashboard and docs name them, and code as it is", () => {
    const problems: Array<string> = [];

    translatedTerms.forEach((block: GlossaryTermBlock, index: number) => {
      const english: GlossaryTermBlock = TERMS[index]!;

      if (
        JSON.stringify(codeNamesOf(block.names)) !==
        JSON.stringify(codeNamesOf(english.names))
      ) {
        problems.push(
          `${english.term}: code ${codeNamesOf(block.names).join(", ")}`,
        );
      }

      const bold: Array<string> = boldNamesOf(block.names);
      /*
       * What each English name is in this language: the Dashboard's word,
       * a docs page's title, or the translator's own (null). Two English
       * names this language says alike are one name here, and a name that
       * is the term itself in this language is no other name.
       */
      const expected: Array<string | null> = [];
      /*
       * A name #6817 retired has no Dashboard word any more, so its
       * translation is the translator's own, and it may be said as another
       * name here: retired names may add up to fewer names, or to none.
       */
      let foldable: number = 0;

      for (const name of boldNamesOf(english.names)) {
        const docsTitle: string | null = (DocsNav as Array<NavGroup>)
          .flatMap((group: NavGroup): Array<NavLink> => {
            return group.links;
          })
          .some((link: NavLink): boolean => {
            return link.title === name;
          })
          ? navTitle(language, name)
          : null;
        const drawn: string | null = isActionLabel(name)
          ? drawnActionLabel(language, name)
          : docsTitle;

        if (drawn === null && isRetiredName(name)) {
          foldable++;
          continue;
        }

        if (
          drawn !== null &&
          (drawn.toLowerCase() === block.term.toLowerCase() ||
            expected.includes(drawn))
        ) {
          continue;
        }

        expected.push(drawn);

        if (drawn !== null && !bold.includes(drawn)) {
          problems.push(`${english.term}: "${name}" should be **${drawn}**`);
        }
      }

      if (
        bold.length < expected.length ||
        bold.length > expected.length + foldable
      ) {
        problems.push(
          `${english.term}: ${bold.length} names, ${expected.length} expected${
            foldable ? ` and up to ${foldable} retired` : ""
          }`,
        );
      }

      const lower: Array<string> = bold.map((name: string): string => {
        return name.toLowerCase();
      });

      if (
        new Set(lower).size !== lower.length ||
        lower.includes(block.term.toLowerCase())
      ) {
        problems.push(`${english.term}: a name twice, or the term's own`);
      }
    });

    expect(problems).toEqual([]);
  });

  it("links each term to the same pages, by their titles in this language", () => {
    const problems: Array<string> = [];

    translatedTerms.forEach((block: GlossaryTermBlock, index: number) => {
      const english: GlossaryTermBlock = TERMS[index]!;
      const links: Array<{ text: string; target: string }> = linksOf(
        block.names,
      );
      const pages: Array<string> = links.map(
        (link: { target: string }): string => {
          return linkedPage(link.target);
        },
      );
      const englishPages: Array<string> = linksOf(english.names).map(
        (link: { target: string }): string => {
          return linkedPage(link.target);
        },
      );

      if (JSON.stringify(pages) !== JSON.stringify(englishPages)) {
        problems.push(`${english.term}: links ${pages.join(", ")}`);
      }

      for (const link of links) {
        const title: string = navTitle(
          language,
          englishNavTitle(linkedPage(link.target)) as string,
        );

        if (link.text !== title) {
          problems.push(`${english.term}: "${link.text}" should be "${title}"`);
        }
      }

      if (linksOf(block.definition.join(" ")).length > 0) {
        problems.push(`${english.term}: a link in the definition`);
      }
    });

    expect(problems).toEqual([]);
  });

  it("names every Dashboard label and menu path the English page names, as this language's Dashboard draws them", () => {
    const englishBold: Array<string> = boldSpans(prose(ENGLISH));
    const missing: Array<string> = englishBold
      .map((span: string): string | null => {
        if (span.includes(PATH_SEPARATOR)) {
          const segments: Array<string> = span.split(PATH_SEPARATOR);

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
        // A word that is a term's heading in this language is named there.
        return (
          drawn !== null &&
          !translated.includes(`**${drawn}**`) &&
          !translatedTerms.some((block: GlossaryTermBlock): boolean => {
            return block.term === drawn;
          })
        );
      });

    expect(missing).toEqual([]);
  });

  it("writes its cards with an ASCII ': ' after the link, to the English cards' places", () => {
    const lines: Array<string> = cardLines(translated);

    expect(cardTargets(lines).length).toBe(
      cardTargets(cardLines(ENGLISH)).length,
    );

    for (const line of lines) {
      expect({ line: line, ascii: CARD_LINE.test(line) }).toEqual({
        line: line,
        ascii: true,
      });
    }

    // The group cards open this language's group headings.
    const groupAnchors: Array<string> = sectionHeadings(translated)
      .slice(0, GROUPS.length)
      .map((heading: string): string => {
        return `#${anchorOfHeading(heading.slice(3))}`;
      });

    expect(
      cardLinkTargets(lines).slice(0, GROUPS.length).map(decodeURIComponent),
    ).toEqual(groupAnchors);
    expect(cardTargets(lines).slice(GROUPS.length)).toEqual(
      cardTargets(cardLines(ENGLISH)).slice(GROUPS.length),
    );
  });

  it("links only to anchors that are headings of the page they open", () => {
    expect(anchorProblems(language, GLOSSARY)).toEqual([]);
  });

  it("closes every bold span it opens, as the page is drawn", async () => {
    expect(await strayMarkers(translated, language)).toEqual([]);
  });
});

function anchorOfHeading(heading: string): string {
  return glossaryTerms(`### ${heading}`)[0]!.anchor;
}

describe("the helpers, on the Glossary's shape", () => {
  const sample: string = [
    "# Glossary",
    "",
    "Intro.",
    "",
    "## Start here",
    "",
    "### Monitor",
    "",
    "Checks one thing. It has `code`.",
    "",
    "Also called: **Check**, `MonitorModel`. See [Creating a Monitor](/docs/monitor/create-monitor).",
    "",
    "### Probe",
    "",
    "Runs checks.",
    "",
    "## Next steps",
    "",
    ":::cards",
    "- [Quickstart](/docs/introduction/quickstart): Go.",
    ":::",
  ].join("\n");

  it("read each term with its group, definition and names line", () => {
    const terms: Array<GlossaryTermBlock> = glossaryTerms(sample);

    expect(
      terms.map((block: GlossaryTermBlock): string => {
        return block.anchor;
      }),
    ).toEqual(["monitor", "probe"]);
    expect(terms[0]!.group).toBe("Start here");
    expect(terms[0]!.definition).toEqual(["Checks one thing. It has `code`."]);
    expect(namesOf(terms[0]!.names)).toEqual(["Check", "MonitorModel"]);
    expect(boldNamesOf(terms[0]!.names)).toEqual(["Check"]);
    expect(codeNamesOf(terms[0]!.names)).toEqual(["MonitorModel"]);
    expect(linksOf(terms[0]!.names)).toEqual([
      { text: "Creating a Monitor", target: "/docs/monitor/create-monitor" },
    ]);
    // A term with no names line is all definition.
    expect(terms[1]!.names).toBe("");
    expect(terms[1]!.definition).toEqual(["Runs checks."]);
  });

  it("find the nav title of a page, and none for a page outside the nav", () => {
    expect(englishNavTitle("introduction/core-concepts")).toBe("Core Concepts");
    expect(englishNavTitle("introduction/nowhere")).toBeNull();
    expect(linkedPage("/docs/ai/ai-sre#which-incidents")).toBe("ai/ai-sre");
  });

  it("know the product's names and its code's names", () => {
    expect(namesTheProductUses().has("Service Catalog")).toBe(true);
    expect(namesTheProductUses().has("Auto Remediation Rule")).toBe(true);
    expect(namesTheProductUses().has("Not A Name OneUptime Uses")).toBe(false);
    expect(namesTheCodeUses().has("OnCallDutyPolicy")).toBe(true);
    expect(namesTheCodeUses().has("/telemetry-exception")).toBe(true);
    expect(namesTheCodeUses().has("NotAModel")).toBe(false);
  });
});
