import DocsNav, {
  DocsNavSections,
  NavGroup,
  NavLink,
} from "../../../FeatureSet/Docs/Utils/Nav";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { DocsPageShape, shapeOf } from "./DocsContentRules";
import {
  DocsFence,
  DocsHeading,
  DocsLink,
  DocsPageLink,
  ScannedPage,
  anchorsOf,
  parseDocsLink,
  readPage,
  scanMarkdown,
} from "./DocsContentSupport";
import {
  drawnCreateButton,
  drawnDashboardLabel,
  isDashboardLabel,
} from "./DocsDashboardLabels";
import Incident from "Common/Models/DatabaseModels/Incident";
import { WorkflowRoute } from "Common/ServiceRoute";
import StandardWebhookSignature, {
  STANDARD_WEBHOOK_TOLERANCE_IN_SECONDS,
  StandardWebhookVerification,
} from "Common/Server/Utils/Webhook/StandardWebhookSignature";
import HuntressSeverity, {
  AllHuntressSeverities,
  HUNTRESS_SEVERITY_WHEN_UNKNOWN,
} from "Common/Types/Huntress/HuntressSeverity";
import { HUNTRESS_WEBHOOK_ROUTE } from "Common/Types/Huntress/HuntressWebhook";
import ComponentMetadata, {
  Argument,
  ComponentType,
  ReturnValue,
} from "Common/Types/Workflow/Component";
import ComponentID from "Common/Types/Workflow/ComponentID";
import Components from "Common/Types/Workflow/Components";
import {
  FROM_ANOTHER_TOOL_ARGUMENT_IDS,
  FROM_ANOTHER_TOOL_PORT_IDS,
  FromAnotherToolAction,
  readWhatHappened,
} from "Common/Types/Workflow/Components/FromAnotherTool";
import {
  AllHuntressTriggerEvents,
  HUNTRESS_INCIDENT_SEVERITY_RANK,
  HUNTRESS_INCIDENT_SEVERITY_SETTINGS,
  HuntressTriggerValue,
  getHuntressTriggerUrlPrefix,
} from "Common/Types/Workflow/HuntressTrigger";
import {
  HUNTRESS_INCIDENT_TEMPLATE_ID,
  HUNTRESS_REPORT_ID_CUSTOM_FIELD,
  HUNTRESS_TEMPLATE_OPTIONS,
  WorkflowTemplate,
  WorkflowTemplateCategory,
  getTemplateGraphSpec,
  getWorkflowTemplate,
  getWorkflowTemplateCategoryInfo,
} from "Common/Types/Workflow/Templates";
import { WORKFLOW_ENABLED_SWITCH_LABEL } from "Common/Types/Workflow/WorkflowEnabled";
import { MORE_FIELDS_SECTION_TITLE } from "Common/UI/Components/FoldedSection/FoldedSectionTitles";
import {
  HUNTRESS_TRIGGER_STATE_LABELS,
  HuntressTriggerPanelCopy,
  HuntressTriggerState,
} from "Common/UI/Components/Workflow/HuntressTriggerState";
import { describe, expect, test } from "@jest/globals";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { writtenPermissionTitle } from "./DocsRoleNames";

/*
 * The Huntress page of the docs' Integrations catalog, in all seventeen
 * languages, held to the product it describes.
 *
 * Huntress is a workflow trigger with a template, like the other tools
 * OneUptime is connected to, rather than a connection under Incidents. The
 * page walks a reader through creating the workflow from its template,
 * adding the endpoint in Huntress, saving its signing secret and sending a
 * test; then what the workflow does, the trigger's values and settings,
 * what became of the connections made before, and the errors the trigger
 * reports. Markdown is not compiled, so nothing else notices when the
 * trigger gains a value, a setting is renamed, a label is translated anew
 * or the webhook answers with other words. These tests read the page in
 * every language and check it against the trigger, the template, the
 * labels the Dashboard draws in that language, the signature check and the
 * sources of the webhook.
 */

type TemplateGraphSpec = NonNullable<ReturnType<typeof getTemplateGraphSpec>>;
type TemplateNodeSpec = TemplateGraphSpec["nodes"][number];

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");
const DOCS_LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Locales",
);

const PAGE: string = "integrations/huntress";
const CATALOG: string = "integrations/index";
const PAGE_URL: string = `/docs/${PAGE}`;
const ON_CALL_RULES_PAGE: string = "incidents/settings";

const LANGUAGES: Array<string> = [...SUPPORTED_DOCS_LANGUAGE_CODES];

const TRANSLATIONS: Array<string> = LANGUAGES.filter(
  (language: string): boolean => {
    return language !== "en";
  },
);

const BOLD: RegExp = /\*\*([^*\n]+?)\*\*/g;
const MENU_PATH_SEPARATOR: string = " → ";
const INLINE_CODE: RegExp = /`([^`\n]+)`/g;
const DETAILS_TITLE: RegExp = /^:::details[ \t]+"([^"]+)"[ \t]*$/;
const TABLE_ROW: RegExp = /^\|.*\|[ \t]*$/;
const CATALOG_LINK_CELL: RegExp = /^\[([^\]]+)\]\((\/docs\/[^)]+)\)$/;

// The sections of the English page, in order. Every translation has as many.
const ENGLISH_SECTIONS: ReadonlyArray<string> = [
  "How it works",
  "Before you begin",
  "Set up the integration",
  "What the workflow does",
  "The Huntress Incident Report trigger",
  "Huntress connections made before",
  "Security",
  "Using email instead",
  "Troubleshooting",
  "Next steps",
];

const ENGLISH_SUBSECTIONS: ReadonlyArray<string> = [
  "Create the workflow",
  "Pick who to page",
  "Add a webhook endpoint in Huntress",
  "Save the endpoint's signing secret",
  "Turn the workflow on, and send a test",
  "Severities",
  "Organizations",
];

/*
 * The messages Troubleshooting quotes, as the trigger starts them. The
 * server writes them in English whatever the reader's language, so every
 * language quotes them as they are.
 */
const TROUBLESHOOTING_TITLES: ReadonlyArray<string> = [
  "A request arrived but was refused, because no signing secret is saved for this workflow yet",
  "The request's signature does not match the signing secret",
  "The request was signed more than five minutes from now",
  "A request arrived while this workflow is off",
  "No Huntress workflow has this address.",
];

/*
 * The Dashboard's labels the page names, in English. Each language's page
 * names them as that language's Dashboard draws them - Persian included:
 * this page has always named the Persian Dashboard's words.
 */
const DASHBOARD_LABELS: ReadonlyArray<string> = [
  "Workflows",
  "Or start from a template",
  "Huntress",
  "Use this template",
  "Builder",
  "On-Call Policies",
  "Copy URL",
  "Add a webhook endpoint in Huntress",
  "Save Signing Secret",
  "Replace Signing Secret",
  "Enabled",
  "Receiving reports",
  "Incidents",
  "Settings",
  "Incident Severity",
  "Severity For Critical Reports",
  "Severity For High Reports",
  "Severity For Low Reports",
  "Only These Organizations",
  "More fields",
  "Incident Labels",
  "Run Workflow",
  "Integrations",
  "The last request was refused",
  "On-Call Executions",
];

// The button that opens the template picker: the Workflows table's own.
const CREATE_WORKFLOW_BUTTON: string = "Create Workflow";

/*
 * Huntress's portal is English only: every language names its menus and
 * buttons as Huntress shows them.
 */
const HUNTRESS_WORDS: ReadonlyArray<string> = [
  "Account Admin",
  "Add an Integration",
  "Webhooks",
  "Add Endpoint",
  "Incident Reports",
  "Escalations",
  "Platform Actions",
  "Account Notices",
  "View Signing Secret",
  "Send Test",
  "View Delivery Attempts",
];

/*
 * The roles that may set the workflow up: named as each language's
 * Dashboard names them (DocsRoleNames).
 */
const ROLE_WORDS: ReadonlyArray<string> = [
  "Project Owner",
  "Project Admin",
  "Workflow Admin",
];

/*
 * The Builder draws a step's title, a template's name and a value's name as
 * they are, in every language, so every page names them in English.
 */
const BUILDER_WORDS: ReadonlyArray<string> = [
  "Huntress Incident Report",
  "Open an incident for each Huntress incident report",
  // What the create dialog asks who to page by, as the template words it.
  "Who to page for high and critical reports",
  "Page an On-Call Policy",
  "Incident From Another Tool",
  "Switch / Case",
  "If / Else",
];

/*
 * ---------------------------------------------------------------- Helpers
 */

const readHuntressPage: (language: string) => string = (
  language: string,
): string => {
  return readPage(language, PAGE);
};

const scanHuntressPage: (language: string) => ScannedPage = (
  language: string,
): ScannedPage => {
  return scanMarkdown(readHuntressPage(language));
};

const matchesOf: (text: string, pattern: RegExp) => Array<string> = (
  text: string,
  pattern: RegExp,
): Array<string> => {
  return Array.from(text.matchAll(pattern), (match: RegExpMatchArray) => {
    return match[1] as string;
  });
};

/*
 * What a page names in bold. A menu path, "**Incidents → Settings →
 * Incident Severity**", names each screen on it as well.
 */
const boldTermsOf: (text: string) => Set<string> = (
  text: string,
): Set<string> => {
  const terms: Set<string> = new Set<string>();

  for (const term of matchesOf(text, BOLD)) {
    terms.add(term);

    for (const part of term.split(MENU_PATH_SEPARATOR)) {
      terms.add(part.trim());
    }
  }

  return terms;
};

const headingsAt: (
  scanned: ScannedPage,
  level: number,
) => Array<DocsHeading> = (
  scanned: ScannedPage,
  level: number,
): Array<DocsHeading> => {
  return scanned.headings.filter((heading: DocsHeading): boolean => {
    return heading.level === level;
  });
};

// A "## " section of a language's page, found where the English page has it.
const sectionOf: (language: string, englishSection: string) => string = (
  language: string,
  englishSection: string,
): string => {
  const index: number = ENGLISH_SECTIONS.indexOf(englishSection);

  if (index < 0) {
    throw new Error(`The English page has no "${englishSection}" section.`);
  }

  const scanned: ScannedPage = scanHuntressPage(language);
  const sections: Array<DocsHeading> = headingsAt(scanned, 2);
  const start: DocsHeading | undefined = sections[index];

  if (!start) {
    throw new Error(`${language} has no section where "${englishSection}" is.`);
  }

  const next: DocsHeading | undefined = sections[index + 1];

  return scanned.lines
    .slice(start.line - 1, next ? next.line - 1 : scanned.lines.length)
    .join("\n");
};

// The text of the page outside one of its "## " sections.
const pageWithout: (language: string, englishSection: string) => string = (
  language: string,
  englishSection: string,
): string => {
  return readHuntressPage(language).replace(
    sectionOf(language, englishSection),
    "",
  );
};

const detailsTitlesOf: (language: string) => Array<string> = (
  language: string,
): Array<string> => {
  return scanHuntressPage(language)
    .lines.map((line: string): string | null => {
      const match: RegExpMatchArray | null = line.match(DETAILS_TITLE);
      return match ? (match[1] as string) : null;
    })
    .filter((title: string | null): title is string => {
      return title !== null;
    });
};

interface CatalogRow {
  title: string;
  url: string;
  direction: string;
  description: string;
}

const cellsOf: (line: string) => Array<string> = (
  line: string,
): Array<string> => {
  return line
    .trim()
    .slice(1, -1)
    .split("|")
    .map((cell: string): string => {
      return cell.trim();
    });
};

// The catalog table's rows that link a docs page, in order.
const catalogRowsOf: (language: string) => Array<CatalogRow> = (
  language: string,
): Array<CatalogRow> => {
  const rows: Array<CatalogRow> = [];

  for (const line of readPage(language, CATALOG).split("\n")) {
    if (!TABLE_ROW.test(line)) {
      continue;
    }

    const cells: Array<string> = cellsOf(line);
    const link: RegExpMatchArray | null = (cells[0] || "").match(
      CATALOG_LINK_CELL,
    );

    if (!link || cells.length !== 3) {
      continue;
    }

    rows.push({
      title: link[1] as string,
      url: link[2] as string,
      direction: cells[1] as string,
      description: cells[2] as string,
    });
  }

  return rows;
};

/*
 * The row of the catalog's "Choose how to connect" table whose examples
 * link a page: the ways to connect, told apart by an example each has.
 */
const connectWayLinking: (language: string, url: string) => string = (
  language: string,
  url: string,
): string => {
  const rows: Array<string> = readPage(language, CATALOG)
    .split("\n")
    .filter((line: string): boolean => {
      return TABLE_ROW.test(line) && cellsOf(line).length === 3;
    })
    .filter((line: string): boolean => {
      const examples: string = cellsOf(line)[2] || "";
      return examples.includes(`](${url})`) && !line.startsWith("| [");
    });

  if (rows.length !== 1) {
    throw new Error(
      `${language}'s catalog has ${rows.length} ways to connect with ${url} as an example.`,
    );
  }

  return rows[0] as string;
};

const readJson: (file: string) => Record<string, unknown> = (
  file: string,
): Record<string, unknown> => {
  return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
};

const readSource: (...parts: Array<string>) => string = (
  ...parts: Array<string>
): string => {
  return fs.readFileSync(path.join(PACKAGES_DIR, ...parts), "utf8");
};

const integrationsGroup: () => NavGroup = (): NavGroup => {
  const group: NavGroup | undefined = DocsNav.find(
    (candidate: NavGroup): boolean => {
      return candidate.title === "Integrations";
    },
  );

  if (!group) {
    throw new Error("The docs nav has no Integrations group.");
  }

  return group;
};

const componentById: (id: string) => ComponentMetadata = (
  id: string,
): ComponentMetadata => {
  const component: ComponentMetadata | undefined = Components.find(
    (candidate: ComponentMetadata): boolean => {
      return candidate.id === id;
    },
  );

  if (!component) {
    throw new Error(`No workflow component has the id ${id}.`);
  }

  return component;
};

const huntressTrigger: () => ComponentMetadata = (): ComponentMetadata => {
  return componentById(ComponentID.HuntressIncidentReport);
};

const templateGraph: () => TemplateGraphSpec = (): TemplateGraphSpec => {
  const graph: TemplateGraphSpec | null = getTemplateGraphSpec(
    HUNTRESS_INCIDENT_TEMPLATE_ID,
  );

  if (!graph) {
    throw new Error("The Huntress template has no graph.");
  }

  return graph;
};

const templateNode: (componentId: string) => TemplateNodeSpec = (
  componentId: string,
): TemplateNodeSpec => {
  const node: TemplateNodeSpec | undefined = templateGraph().nodes.find(
    (candidate: TemplateNodeSpec): boolean => {
      return candidate.componentId === componentId;
    },
  );

  if (!node) {
    throw new Error(`The Huntress template has no ${componentId} step.`);
  }

  return node;
};

/*
 * ------------------------------------------------------------- Navigation
 */

describe("the Huntress page in the docs navigation", () => {
  test("is listed in the Integrations group, right after Datadog", () => {
    const urls: Array<string> = integrationsGroup().links.map(
      (link: NavLink): string => {
        return link.url;
      },
    );

    expect(urls).toContain(PAGE_URL);
    expect(urls.indexOf(PAGE_URL)).toBe(
      urls.indexOf("/docs/integrations/datadog") + 1,
    );
    expect(DocsNavSections).toContain(integrationsGroup().section);
  });

  test("is titled Huntress, and listed once", () => {
    const links: Array<NavLink> = DocsNav.flatMap(
      (group: NavGroup): Array<NavLink> => {
        return group.links.filter((link: NavLink): boolean => {
          return link.url === PAGE_URL;
        });
      },
    );

    expect(links).toEqual([{ title: "Huntress", url: PAGE_URL }]);
  });

  test.each(LANGUAGES)(
    "has its link title in the %s docs locale, as Huntress, beside Datadog",
    (language: string) => {
      const navLinks: Record<string, unknown> = readJson(
        path.join(DOCS_LOCALES_DIR, `${language}.json`),
      )["navLinks"] as Record<string, unknown>;
      const keys: Array<string> = Object.keys(navLinks);

      expect(navLinks["Huntress"]).toBe("Huntress");
      expect(keys.indexOf("Huntress")).toBe(keys.indexOf("Datadog") + 1);
    },
  );

  test.each(LANGUAGES)(
    "has a page in %s, titled after Huntress on its first line",
    (language: string) => {
      const firstLine: string = readHuntressPage(language).split("\n")[0] || "";

      expect(firstLine.startsWith("# ")).toBe(true);
      expect(firstLine).toContain("Huntress");
    },
  );
});

/*
 * ---------------------------------------------------------------- Catalog
 */

describe("the Integrations catalog", () => {
  test("lists Huntress in English as an inbound integration that pages on-call", () => {
    const row: CatalogRow | undefined = catalogRowsOf("en").find(
      (candidate: CatalogRow): boolean => {
        return candidate.url === PAGE_URL;
      },
    );

    expect(row).toEqual({
      title: "Huntress",
      url: PAGE_URL,
      direction: "Inbound",
      description:
        "Page on-call for Huntress incident reports, and resolve the incident when the report closes.",
    });
  });

  test.each(LANGUAGES)(
    "has the Huntress row right after Datadog's, as inbound as it, in %s",
    (language: string) => {
      const rows: Array<CatalogRow> = catalogRowsOf(language);
      const urls: Array<string> = rows.map((row: CatalogRow): string => {
        return row.url;
      });
      const datadogAt: number = urls.indexOf("/docs/integrations/datadog");
      const huntressAt: number = urls.indexOf(PAGE_URL);

      expect(datadogAt).toBeGreaterThanOrEqual(0);
      expect(huntressAt).toBe(datadogAt + 1);

      const datadog: CatalogRow = rows[datadogAt] as CatalogRow;
      const huntress: CatalogRow = rows[huntressAt] as CatalogRow;

      expect(huntress.title).toBe("Huntress");
      expect(huntress.direction).toBe(datadog.direction);
      expect(huntress.description).toContain("Huntress");
      expect(
        urls.filter((url: string) => {
          return url === PAGE_URL;
        }),
      ).toHaveLength(1);
    },
  );

  test.each(LANGUAGES)(
    "in %s, counts Huntress among the workflow templates, with Jira, and not among the built-in connections",
    (language: string) => {
      const templates: string = connectWayLinking(
        language,
        "/docs/integrations/jira",
      );
      const builtIn: string = connectWayLinking(
        language,
        "/docs/workspace-connections/slack",
      );

      expect(templates).not.toBe(builtIn);
      expect(templates).toContain(`](${PAGE_URL})`);
      expect(builtIn).not.toContain(`](${PAGE_URL})`);
    },
  );
});

/*
 * ------------------------------------------------------------------ Shape
 */

describe("every translation of the Huntress page keeps the English page's shape", () => {
  const english: ScannedPage = scanHuntressPage("en");

  test("the English page has the sections and steps the guide is built from", () => {
    expect(
      headingsAt(english, 2).map((heading: DocsHeading): string => {
        return heading.text;
      }),
    ).toEqual(ENGLISH_SECTIONS);
    expect(
      headingsAt(english, 3).map((heading: DocsHeading): string => {
        return heading.text;
      }),
    ).toEqual(ENGLISH_SUBSECTIONS);

    expect(shapeOf(english).components).toEqual([
      "cards",
      "steps(5)",
      "details",
      "details",
      "details",
      "details",
      "details",
      "details",
      "details",
      "cards",
    ]);
    expect(shapeOf(english).fences).toEqual(["mermaid"]);
    expect(shapeOf(english).alerts).toEqual(["NOTE", "TIP"]);
  });

  test("its setup steps are the ones the trigger's panel lists", () => {
    const steps: Array<string> = headingsAt(english, 3).map(
      (heading: DocsHeading): string => {
        return heading.text;
      },
    );

    expect(steps).toContain(HuntressTriggerPanelCopy.stepEndpointTitle);
    expect(steps).toContain(HuntressTriggerPanelCopy.stepSecretTitle);
    expect(HuntressTriggerPanelCopy.stepTestTitle).toBe("Send a test");
    // The panel's last step while the workflow is off, as the template creates it.
    expect(steps).toContain(HuntressTriggerPanelCopy.stepTurnOnTitle);
  });

  test("the turn-on step opens with the panel's own words for it", () => {
    // "Switch {{switch}} on at the top of the Builder." - the switch in bold.
    const panelSentence: string = `${
      HuntressTriggerPanelCopy.stepTurnOnBody.split(". ")[0]
    }.`;

    expect(panelSentence).toBe(
      "Switch {{switch}} on at the top of the Builder.",
    );
    expect(sectionOf("en", "Set up the integration")).toContain(
      panelSentence
        .replace("{{switch}}", `**${WORKFLOW_ENABLED_SWITCH_LABEL}**`)
        .replace("the Builder", "the **Builder**"),
    );
  });

  test.each(TRANSLATIONS)(
    "%s has the same headings, components, code, callouts and page links",
    (language: string) => {
      const ours: DocsPageShape = shapeOf(scanHuntressPage(language));

      expect(ours).toEqual(shapeOf(english));
    },
  );

  test.each(TRANSLATIONS)(
    "%s quotes the same code as the English page: values, URLs and names",
    (language: string) => {
      const ours: Set<string> = new Set(
        matchesOf(readHuntressPage(language), INLINE_CODE),
      );
      const theirs: Set<string> = new Set(
        matchesOf(readHuntressPage("en"), INLINE_CODE),
      );

      expect(Array.from(ours).sort()).toEqual(Array.from(theirs).sort());
    },
  );

  test.each(LANGUAGES)(
    "%s links the on-call rules section of its own Incident Settings page",
    (language: string) => {
      const anchors: Array<string | null> = scanHuntressPage(language)
        .links.map((link: DocsLink): DocsPageLink | null => {
          return parseDocsLink(link.target);
        })
        .filter((link: DocsPageLink | null): link is DocsPageLink => {
          return link !== null && link.page === ON_CALL_RULES_PAGE;
        })
        .map((link: DocsPageLink): string | null => {
          return link.anchor;
        });

      expect(anchors).toHaveLength(2);

      for (const anchor of anchors) {
        expect({
          language,
          anchor,
          exists: anchorsOf(language, ON_CALL_RULES_PAGE).has(anchor || ""),
        }).toEqual({ language, anchor, exists: true });
      }
    },
  );

  test.each(LANGUAGES)(
    "%s's Mermaid diagram keeps Huntress's event names",
    (language: string) => {
      const diagram: string =
        scanHuntressPage(language).fences.find((fence: DocsFence): boolean => {
          return fence.lang === "mermaid";
        })?.code || "";

      for (const event of [
        "incident_report.created",
        "incident_report.comment_added",
        "incident_report.closed",
      ]) {
        expect({ language, event, kept: diagram.includes(event) }).toEqual({
          language,
          event,
          kept: true,
        });
      }
    },
  );
});

/*
 * ---------------------------------------------------- The Dashboard's words
 */

describe("the Huntress page names the Dashboard as it reads in each language", () => {
  test("every label it names is one the Dashboard draws", () => {
    for (const label of [...DASHBOARD_LABELS, CREATE_WORKFLOW_BUTTON]) {
      expect({ label, drawn: isDashboardLabel(label) }).toEqual({
        label,
        drawn: true,
      });
    }
  });

  test("the trigger's panel, settings and Builder use these very words", () => {
    expect(HuntressTriggerPanelCopy.stepEndpointTitle).toBe(
      "Add a webhook endpoint in Huntress",
    );
    expect(HuntressTriggerPanelCopy.copyUrl).toBe("Copy URL");
    expect(HuntressTriggerPanelCopy.saveSecret).toBe("Save Signing Secret");
    expect(HuntressTriggerPanelCopy.replaceSecret).toBe(
      "Replace Signing Secret",
    );
    expect(HuntressTriggerPanelCopy.lastRefused).toBe(
      "The last request was refused",
    );
    expect(HUNTRESS_TRIGGER_STATE_LABELS[HuntressTriggerState.Receiving]).toBe(
      "Receiving reports",
    );
    expect(WORKFLOW_ENABLED_SWITCH_LABEL).toBe("Enabled");
    expect(MORE_FIELDS_SECTION_TITLE).toBe("More fields");
    expect(
      getWorkflowTemplateCategoryInfo(WorkflowTemplateCategory.Huntress).label,
    ).toBe("Huntress");

    const settings: Array<string> = huntressTrigger().arguments.map(
      (argument: Argument): string => {
        return argument.name;
      },
    );

    for (const label of [
      "Only These Organizations",
      "Severity For Critical Reports",
      "Severity For High Reports",
      "Severity For Low Reports",
    ]) {
      expect(settings).toContain(label);
    }

    const pageStep: ComponentMetadata = componentById(
      ComponentID.PageOnCallPolicy,
    );

    expect(
      pageStep.arguments.map((argument: Argument): string => {
        return argument.name;
      }),
    ).toContain("On-Call Policies");
  });

  test.each(LANGUAGES)(
    "%s names every Dashboard label in bold, as the Dashboard draws it",
    (language: string) => {
      const bold: Set<string> = boldTermsOf(readHuntressPage(language));

      for (const label of DASHBOARD_LABELS) {
        const word: string = drawnDashboardLabel(language, label);

        expect({ language, label, word, named: bold.has(word) }).toEqual({
          language,
          label,
          word,
          named: true,
        });
      }

      const button: string = drawnCreateButton(
        language,
        CREATE_WORKFLOW_BUTTON,
      );

      expect({ language, button, named: bold.has(button) }).toEqual({
        language,
        button,
        named: true,
      });
    },
  );

  test.each(LANGUAGES)(
    "%s names Huntress's menus in English, and the roles as its Dashboard does",
    (language: string) => {
      const bold: Set<string> = boldTermsOf(readHuntressPage(language));

      for (const word of HUNTRESS_WORDS) {
        expect({ language, word, named: bold.has(word) }).toEqual({
          language,
          word,
          named: true,
        });
      }

      for (const role of ROLE_WORDS) {
        const word: string = writtenPermissionTitle(language, role);

        expect({ language, role, word, named: bold.has(word) }).toEqual({
          language,
          role,
          word,
          named: true,
        });
      }
    },
  );

  test.each(LANGUAGES)(
    "%s names the template, its steps and the trigger's values as the Builder draws them",
    (language: string) => {
      const bold: Set<string> = boldTermsOf(readHuntressPage(language));

      const values: Array<string> = huntressTrigger().returnValues.map(
        (value: ReturnValue): string => {
          return value.name;
        },
      );

      for (const word of [...BUILDER_WORDS, ...values]) {
        expect({ language, word, named: bold.has(word) }).toEqual({
          language,
          word,
          named: true,
        });
      }
    },
  );

  test("the Huntress words the page names are the ones the trigger's panel tells the user", () => {
    for (const word of [
      "Add an Integration",
      "Webhooks",
      "Add Endpoint",
      "Incident Reports",
    ]) {
      expect(HuntressTriggerPanelCopy.stepEndpointBody).toContain(word);
    }

    expect(HuntressTriggerPanelCopy.stepSecretBody).toContain(
      "View Signing Secret",
    );
    expect(HuntressTriggerPanelCopy.secretDialogDescription).toContain(
      "View Signing Secret",
    );
    expect(HuntressTriggerPanelCopy.stepTestBody).toContain("Send Test");
  });
});

/*
 * ------------------------------------------------------- What it promises
 */

describe("the Huntress page states what the trigger and its template do", () => {
  const englishPage: string = readHuntressPage("en");
  const code: Set<string> = new Set(matchesOf(englishPage, INLINE_CODE));
  const triggerSection: string = sectionOf(
    "en",
    "The Huntress Incident Report trigger",
  );

  test("its values table lists exactly the trigger's values, in order", () => {
    const named: Array<string> = triggerSection
      .split("\n")
      .filter((line: string): boolean => {
        return TABLE_ROW.test(line) && line.startsWith("| **");
      })
      .flatMap((line: string): Array<string> => {
        return matchesOf(cellsOf(line)[0] || "", BOLD);
      });

    expect(named).toEqual(
      huntressTrigger().returnValues.map((value: ReturnValue): string => {
        return value.name;
      }),
    );
  });

  test("it names the trigger's settings, all optional and folded under More fields", () => {
    const bold: Set<string> = boldTermsOf(triggerSection);

    for (const argument of huntressTrigger().arguments) {
      expect({
        setting: argument.name,
        named: bold.has(argument.name),
      }).toEqual({ setting: argument.name, named: true });
      expect({
        setting: argument.name,
        required: argument.required,
        folded: argument.isAdvanced,
      }).toEqual({ setting: argument.name, required: false, folded: true });
    }

    expect(triggerSection).toContain(
      `Its settings, all optional, are folded under **${MORE_FIELDS_SECTION_TITLE}**`,
    );
  });

  test("the trigger is a trigger, titled as the page names it", () => {
    expect(huntressTrigger().componentType).toBe(ComponentType.Trigger);
    expect(huntressTrigger().title).toBe("Huntress Incident Report");
  });

  test("the events it names are the trigger's, in its order, and the template's cases", () => {
    expect(AllHuntressTriggerEvents).toEqual([
      "created",
      "comment-added",
      "closed",
    ]);
    expect(sectionOf("en", "How it works")).toContain(
      "`created`, `comment-added` or `closed`",
    );

    const rows: Array<string> = sectionOf("en", "What the workflow does")
      .split("\n")
      .filter((line: string): boolean => {
        return TABLE_ROW.test(line) && line.startsWith("| `");
      })
      .map((line: string): string => {
        return matchesOf(cellsOf(line)[0] || "", INLINE_CODE)[0] || "";
      });

    expect(rows).toEqual(AllHuntressTriggerEvents);

    // Incident From Another Tool reads the trigger's Event, in Huntress's own words.
    expect(
      (templateNode("incident-from-another-tool-1").args || {})[
        FROM_ANOTHER_TOOL_ARGUMENT_IDS.whatHappened
      ],
    ).toBe(
      `{{local.components.huntress-1.returnValues.${HuntressTriggerValue.Event}}}`,
    );
    expect(
      AllHuntressTriggerEvents.map((event: string): FromAnotherToolAction => {
        return readWhatHappened(event).action;
      }),
    ).toEqual([
      FromAnotherToolAction.Open,
      FromAnotherToolAction.Note,
      FromAnotherToolAction.Resolve,
    ]);
    expect(sectionOf("en", "What the workflow does")).toContain(
      "After the trigger, **Incident From Another Tool** does what each **Event** asks, by the report's number:",
    );
  });

  test("the severities it names are Huntress's, and one without is high", () => {
    for (const severity of AllHuntressSeverities) {
      expect(code.has(severity)).toBe(true);
    }

    expect(HUNTRESS_SEVERITY_WHEN_UNKNOWN).toBe(HuntressSeverity.High);
    expect(sectionOf("en", "What the workflow does")).toContain(
      "A report that names no severity is handled as high.",
    );
  });

  test("each Huntress severity opens at its setting's severity, or at its rank", () => {
    const section: string = sectionOf("en", "What the workflow does");
    const rankWords: Array<string> = [
      "The most severe",
      "The second",
      "The third",
    ];
    const titles: Record<HuntressSeverity, string> = {
      [HuntressSeverity.Critical]: "Critical",
      [HuntressSeverity.High]: "High",
      [HuntressSeverity.Low]: "Low",
    };

    for (const severity of AllHuntressSeverities) {
      const setting: Argument | undefined = huntressTrigger().arguments.find(
        (argument: Argument): boolean => {
          return argument.id === HUNTRESS_INCIDENT_SEVERITY_SETTINGS[severity];
        },
      );

      expect(setting).toBeDefined();

      const row: string | undefined = section
        .split("\n")
        .find((line: string): boolean => {
          return line.startsWith(`| ${titles[severity]} |`);
        });

      expect({ severity, row: Boolean(row) }).toEqual({ severity, row: true });
      expect(cellsOf(row || "")[2]).toBe(`**${setting?.name}**`);
      expect(cellsOf(row || "")[3]).toBe(
        rankWords[HUNTRESS_INCIDENT_SEVERITY_RANK[severity]],
      );
    }
  });

  test("the template it sends the reader to is the Huntress category's, built from the steps it names", () => {
    const template: WorkflowTemplate | null = getWorkflowTemplate(
      HUNTRESS_INCIDENT_TEMPLATE_ID,
    );

    expect(template?.name).toBe(
      "Open an incident for each Huntress incident report",
    );
    expect(template?.category).toBe(WorkflowTemplateCategory.Huntress);
    expect(sectionOf("en", "Set up the integration")).toContain(
      `pick **${template?.name}**`,
    );

    const metadataIds: Array<string> = templateGraph().nodes.map(
      (node: TemplateNodeSpec): string => {
        return node.metadataId;
      },
    );

    expect(templateNode("huntress-1").metadataId).toBe(
      ComponentID.HuntressIncidentReport,
    );
    expect(metadataIds).toEqual([
      ComponentID.HuntressIncidentReport,
      ComponentID.IncidentFromAnotherTool,
      ComponentID.IfElse,
      ComponentID.PageOnCallPolicy,
    ]);

    expect(componentById(ComponentID.PageOnCallPolicy).title).toBe(
      "Page an On-Call Policy",
    );
    expect(componentById(ComponentID.IncidentFromAnotherTool).title).toBe(
      `${new Incident().singularName} From Another Tool`,
    );
    expect(componentById(ComponentID.IfElse).title).toBe("If / Else");
    // The page suggests a Switch / Case for routing organizations: a step that exists.
    expect(componentById(ComponentID.Switch).title).toBe("Switch / Case");

    // The create dialog asks who to page, in the words the page names.
    expect(
      template?.whoToPage?.map((ask: { title: string }): string => {
        return ask.title;
      }),
    ).toEqual(["Who to page for high and critical reports"]);
    expect(sectionOf("en", "Set up the integration")).toContain(
      "under **Who to page for high and critical reports**, pick the on-call policies to page, or none to page nobody",
    );
  });

  test("the template pages for high and critical reports, and resolves on close, as the page says", () => {
    expect(HUNTRESS_TEMPLATE_OPTIONS.pages).toBe(true);
    expect(HUNTRESS_TEMPLATE_OPTIONS.pageOnCallFor).toBe(HuntressSeverity.High);
    expect(HUNTRESS_TEMPLATE_OPTIONS.resolveWhenClosed).toBe(true);

    // Pages unless the report is low.
    expect(templateNode("if-page-1").args).toEqual(
      expect.objectContaining({
        "input-2": HuntressSeverity.Low,
      }),
    );
    expect(sectionOf("en", "What the workflow does")).toContain(
      "For a high or critical report, **Page an On-Call Policy** pages your policy; a low report pages nobody.",
    );
    // closed resolves: the step moves the incident to a resolved state, and never only notes it here.
    expect(readWhatHappened("closed").action).toBe(
      FromAnotherToolAction.Resolve,
    );
    expect(
      (templateNode("incident-from-another-tool-1").args || {})[
        FROM_ANOTHER_TOOL_ARGUMENT_IDS.noteInsteadOfResolving
      ],
    ).toBeUndefined();
  });

  test("one report opens one incident: the template looks for the report's incident first, as the page says", () => {
    const edges: Array<{
      fromComponentId: string;
      toComponentId: string;
      fromPort: string;
    }> = templateGraph().edges;

    /*
     * Incident From Another Tool opens one only when no incident keeps the
     * report's number, and goes on by Opened only then: the Page step after
     * it pages for a new report alone.
     */
    expect(edges).toEqual([
      {
        fromComponentId: "huntress-1",
        toComponentId: "incident-from-another-tool-1",
        fromPort: "out",
      },
      {
        fromComponentId: "incident-from-another-tool-1",
        toComponentId: "if-page-1",
        fromPort: FROM_ANOTHER_TOOL_PORT_IDS.opened,
      },
      {
        fromComponentId: "if-page-1",
        toComponentId: "page-on-call-policy-1",
        fromPort: "yes",
      },
    ]);
    expect(sectionOf("en", "What the workflow does")).toContain(
      "A report that has an incident already opens no other.",
    );
  });

  test("the incident keeps the report's number in the custom field the page names", () => {
    expect(HUNTRESS_REPORT_ID_CUSTOM_FIELD).toBe("huntressReportId");
    expect(code.has(HUNTRESS_REPORT_ID_CUSTOM_FIELD)).toBe(true);
    expect(
      (templateNode("incident-from-another-tool-1").args || {})[
        FROM_ANOTHER_TOOL_ARGUMENT_IDS.outsideIdField
      ],
    ).toBe(HUNTRESS_REPORT_ID_CUSTOM_FIELD);
    expect(
      (templateNode("incident-from-another-tool-1").args || {})[
        FROM_ANOTHER_TOOL_ARGUMENT_IDS.outsideId
      ],
    ).toBe(
      `{{local.components.huntress-1.returnValues.${HuntressTriggerValue.ReportId}}}`,
    );
  });

  test("the trigger's URL it shows is the one the trigger serves", () => {
    const prefix: string = getHuntressTriggerUrlPrefix({
      workflowServiceUrl: `https://oneuptime.com${WorkflowRoute.toString()}`,
    });

    expect(code.has(`${prefix}<key>`)).toBe(true);
    expect(
      readSource(
        "Common",
        "Server",
        "Types",
        "Workflow",
        "Components",
        "Huntress.ts",
      ),
    ).toContain("`${HUNTRESS_TRIGGER_PATH}/:secretkey`");
  });

  test("the address a connection made before keeps is the one the workflow service still serves", () => {
    expect(HUNTRESS_WEBHOOK_ROUTE).toBe("/huntress/webhook");
    expect(
      code.has(
        `https://oneuptime.com/api${HUNTRESS_WEBHOOK_ROUTE}/<connection-id>`,
      ),
    ).toBe(true);
    expect(
      readSource(
        "App",
        "FeatureSet",
        "Workflow",
        "API",
        "HuntressLegacyWebhook.ts",
      ),
    ).toContain("`${HUNTRESS_WEBHOOK_ROUTE}/:secretkey`");
    expect(readSource("App", "FeatureSet", "Workflow", "Index.ts")).toContain(
      'app.use("/api", new HuntressLegacyWebhookAPI().router)',
    );
  });

  test("the window it gives a signature is the server's: five minutes", () => {
    expect(STANDARD_WEBHOOK_TOLERANCE_IN_SECONDS).toBe(5 * 60);
    expect(sectionOf("en", "How it works")).toContain(
      "no more than five minutes before it arrives",
    );
    expect(sectionOf("en", "Security")).toContain(
      "signed more than five minutes earlier or later",
    );
  });

  test("the headers it names are the ones a Huntress delivery is checked by", () => {
    for (const header of ["svix-id", "svix-timestamp", "svix-signature"]) {
      expect(code.has(header)).toBe(true);
    }

    const secret: string = `whsec_${crypto.randomBytes(24).toString("base64")}`;
    const body: string = JSON.stringify({
      event_type: "incident_report.created",
    });
    const now: Date = new Date();
    const timestamp: string = String(Math.floor(now.getTime() / 1000));

    const verification: StandardWebhookVerification =
      StandardWebhookSignature.verify({
        secret,
        headers: StandardWebhookSignature.readHeaders({
          "svix-id": "msg_1",
          "svix-timestamp": timestamp,
          "svix-signature": StandardWebhookSignature.sign({
            secret,
            messageId: "msg_1",
            timestamp,
            body,
          }),
        }),
        body,
        now,
      });

    expect(verification.verified).toBe(true);
  });

  test.each(LANGUAGES)(
    "%s sends nobody to Incidents → Integrations, but to say where Huntress used to be",
    (language: string) => {
      const integrations: string = drawnDashboardLabel(
        language,
        "Integrations",
      );
      const incidents: string = drawnDashboardLabel(language, "Incidents");
      const oldPath: string = `${incidents}${MENU_PATH_SEPARATOR}${integrations}`;

      expect(sectionOf(language, "Huntress connections made before")).toContain(
        `**${oldPath}${MENU_PATH_SEPARATOR}Huntress**`,
      );
      expect(
        pageWithout(language, "Huntress connections made before"),
      ).not.toContain(oldPath);
    },
  );
});

/*
 * --------------------------------------------------------- Troubleshooting
 */

describe("the Huntress page's troubleshooting quotes what the trigger says", () => {
  const SECRET: string = `whsec_${crypto.randomBytes(24).toString("base64")}`;
  const OTHER_SECRET: string = `whsec_${crypto.randomBytes(24).toString("base64")}`;
  const BODY: string = '{"event_type":"incident_report.created"}';

  type VerifyFunction = (data: {
    signWith: string;
    signedAt: Date;
    now: Date;
  }) => StandardWebhookVerification;

  const verifyWith: VerifyFunction = (data: {
    signWith: string;
    signedAt: Date;
    now: Date;
  }): StandardWebhookVerification => {
    const timestamp: string = String(
      Math.floor(data.signedAt.getTime() / 1000),
    );

    return StandardWebhookSignature.verify({
      secret: SECRET,
      headers: StandardWebhookSignature.readHeaders({
        "svix-id": "msg_1",
        "svix-timestamp": timestamp,
        "svix-signature": StandardWebhookSignature.sign({
          secret: data.signWith,
          messageId: "msg_1",
          timestamp,
          body: BODY,
        }),
      }),
      body: BODY,
      now: data.now,
    });
  };

  const messageOf: (verification: StandardWebhookVerification) => string = (
    verification: StandardWebhookVerification,
  ): string => {
    return verification.verified ? "" : verification.message;
  };

  test("the English page quotes exactly these messages, in this order", () => {
    expect(detailsTitlesOf("en")).toEqual(TROUBLESHOOTING_TITLES);
  });

  test("a delivery signed with another secret is refused in the words the page quotes", () => {
    const now: Date = new Date();

    expect(
      messageOf(
        verifyWith({ signWith: OTHER_SECRET, signedAt: now, now }),
      ).startsWith(TROUBLESHOOTING_TITLES[1] as string),
    ).toBe(true);
  });

  test("a delivery signed too long ago is refused in the words the page quotes", () => {
    const now: Date = new Date();
    const tenMinutesAgo: Date = new Date(now.getTime() - 10 * 60 * 1000);

    expect(
      messageOf(
        verifyWith({ signWith: SECRET, signedAt: tenMinutesAgo, now }),
      ).startsWith(TROUBLESHOOTING_TITLES[2] as string),
    ).toBe(true);
  });

  test("the trigger's webhook says the other three", () => {
    const handler: string = readSource(
      "Common",
      "Server",
      "Utils",
      "Huntress",
      "HuntressWebhookHandler.ts",
    );

    expect(handler).toContain(`"${TROUBLESHOOTING_TITLES[0]}. `);
    expect(handler).toContain(`"${TROUBLESHOOTING_TITLES[3]}, `);
    expect(handler).toContain(`"${TROUBLESHOOTING_TITLES[4]}"`);
  });

  test("an incident severity missing is told as the run says it, and fixed where the page says", () => {
    expect(sectionOf("en", "Troubleshooting")).toContain(
      "If **Incident From Another Tool** failed with `This project has no incident severities to put the incident at.`, add one under **Incidents → Settings → Incident Severity**.",
    );
    // The step's own words, for an incident.
    expect(
      readSource(
        "Common",
        "Server",
        "Types",
        "Workflow",
        "Components",
        "FromAnotherTool",
        "RecordFromAnotherTool.ts",
      ),
    ).toContain(
      "`This project has no ${noun} severities to put the ${noun} at.`",
    );
    expect(
      (templateNode("incident-from-another-tool-1").args || {})[
        FROM_ANOTHER_TOOL_ARGUMENT_IDS.severity
      ],
    ).toBe(
      `{{local.components.huntress-1.returnValues.${HuntressTriggerValue.IncidentSeverityId}}}`,
    );
  });

  test.each(TRANSLATIONS)(
    "%s quotes the same messages, in English",
    (language: string) => {
      expect(detailsTitlesOf(language)).toEqual(TROUBLESHOOTING_TITLES);
    },
  );
});
