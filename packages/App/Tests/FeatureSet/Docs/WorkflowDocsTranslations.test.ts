import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { PermissionHelper } from "Common/Types/Permission";
import ComponentMetadata, {
  Argument,
  Port,
  ReturnValue,
} from "Common/Types/Workflow/Component";
import Components from "Common/Types/Workflow/Components";
import { WORKFLOW_ARCHIVED_BEFORE_RUN_MESSAGE } from "Common/Types/Workflow/WorkflowArchive";
import { WORKFLOW_TURNED_OFF_MESSAGE } from "Common/Types/Workflow/WorkflowEnabled";
import {
  ScannedPage,
  hasPage,
  readPage,
  scanMarkdown,
} from "./DocsContentSupport";
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
  comparableFence,
  inlineCode,
  listItemCount,
  navTitle,
  prose,
  tableShape,
} from "./DocsTranslationChecks";
import { describe, expect, it } from "@jest/globals";

/*
 * The seven Workflows pages - the overview, authoring, triggers, components,
 * variables, runs and configuration & safety - are translated into every
 * docs language, and each translation says what the English page says: the
 * same sections, tables, lists, code and diagrams, links that land on a
 * heading in the reader's language, a title that is the nav link's, and the
 * Dashboard named the way that language's Dashboard draws it - Persian
 * included, as on the on-call and runbook pages (drawnActionLabel, which
 * also fills the "Duplicate", "Export", "Edit" and "Delete {{itemName}}"
 * buttons a model's pages draw).
 *
 * Three kinds of name stay in English, and are held to that here
 * (KEPT_IN_ENGLISH):
 *   - what a step defines itself: its settings, its outputs and the values
 *     it returns (Request Body, Success, Message Text...). The canvas draws
 *     outputs and returned values as the step names them, and the docs name
 *     a step's settings the same way, as the IRC integration page and the
 *     incident pages (Incident Template) do;
 *   - role and permission names, as the team permission picker lists them;
 *   - plan names.
 * The bold words that are prose rather than a control (PROSE) are listed
 * with why, and what the server writes, which no language translates, is
 * quoted as written (SERVER_MESSAGES).
 */

const LANGUAGES: Array<string> = SUPPORTED_DOCS_LANGUAGE_CODES.filter(
  (language: string): boolean => {
    return language !== "en";
  },
);

interface WorkflowPage {
  page: string;
  // The page's nav link, as the docs' English locale keys it.
  navTitle: string;
}

const PAGES: ReadonlyArray<WorkflowPage> = [
  { page: "workflows/index", navTitle: "Workflows Overview" },
  { page: "workflows/authoring", navTitle: "Authoring a Workflow" },
  { page: "workflows/triggers", navTitle: "Workflow Triggers" },
  { page: "workflows/components", navTitle: "Workflow Components" },
  { page: "workflows/variables", navTitle: "Workflow Variables" },
  { page: "workflows/runs-and-logs", navTitle: "Workflow Runs" },
  {
    page: "workflows/configuration",
    navTitle: "Workflow Configuration & Safety",
  },
];

const PAGE_NAMES: Array<string> = PAGES.map((entry: WorkflowPage): string => {
  return entry.page;
});

// A step's outputs, as the canvas draws them under the block.
const OUTPUTS: Array<string> = ["Success", "Error", "Yes", "No", "Out"];

const PLANS: Array<string> = ["Growth"];

/*
 * Bold names the translations keep in English, on purpose, by page. Each is
 * a step's own setting, output or returned value, a role or permission
 * name, or a plan name ("the lists this test keeps" checks which).
 */
const KEPT_IN_ENGLISH: Record<string, Array<string>> = {
  "workflows/index": [
    ...OUTPUTS.filter((name: string): boolean => {
      return name !== "Out";
    }),
    // The API Post (JSON) and Log blocks' settings in the example.
    "URL",
    "Request Body",
    "Value",
    "Project Admin",
    ...PLANS,
  ],
  "workflows/authoring": [
    "Success",
    "Error",
    // The Log block's setting, a Webhook's value, Text to JSON's setting.
    "Value",
    "Request Body",
    "Text",
  ],
  "workflows/triggers": [
    // What the Webhook and Incoming Email triggers return.
    "Request Headers",
    "Request Body",
    "From",
    "To",
    "Subject",
    "Body",
    "Attachments",
  ],
  "workflows/components": [
    ...OUTPUTS,
    // API.
    "URL",
    "Request Body",
    "Request Headers",
    "Response Headers",
    "Response Body",
    // Generate Text with AI.
    "Prompt",
    "Context",
    "Temperature",
    "Response",
    "Provider",
    "Model",
    "Total Tokens",
    "Completion Tokens",
    // The chat steps.
    "Slack Incoming Webhook URL",
    "Message Text",
    "Telegram Bot Token",
    "Channel",
    "Port",
    // Send Email.
    "From Email",
    "To Email",
    "Subject",
    "SMTP Port",
    "SMTP Username",
    "SMTP Password",
    // Run Custom JavaScript and the JSON steps.
    "JavaScript Code",
    "Value",
    "JSON",
    "Text",
    // If / Else.
    "Value to check",
    "Comparison",
    "Compare with",
    // Sleep.
    "Days",
    "Hours",
    "Minutes",
    // Execute Workflow: its setting, and the trigger it needs.
    "Workflow",
    "Manual",
    // The record steps.
    "Incident Template",
    "Query",
    "Skip",
  ],
  "workflows/variables": [
    // Settings and outputs of the blocks in the examples.
    "Query",
    "Request Body",
    "Message Text",
    "Value to check",
    "Comparison",
    "Compare with",
    "URL",
    "Yes",
    "Success",
    "Error",
    // A permission's name.
    "Edit Workflow Variables",
  ],
  "workflows/runs-and-logs": [
    // Outputs a step took, and the Log block.
    "Success",
    "Error",
    "Yes",
    "No",
    "Log",
  ],
  "workflows/configuration": [
    // Role and permission names, as the permission picker lists them.
    "Project Admin",
    "Project Member",
    "Edit Workflow",
    "Delete Workflow",
    // Generate Text with AI's settings, and the Incoming Email trigger's values.
    "Prompt",
    "Context",
    "From",
    "To",
    // Create One Incident's setting, and the outputs a refused step takes.
    "Incident Template",
    "Error",
  ],
};

/*
 * Bold words that are Dashboard labels by coincidence but are prose where
 * the English page uses them.
 */
const PROSE: Record<string, Array<string>> = {
  "workflows/index": [
    // "How a workflow works" and "Key terms": terms, in the reader's words.
    "Components",
    "Connections",
    "Workflow",
    "Trigger",
    "Component",
    "Output",
    "Run",
    // "Build your first workflow": what each step is about.
    "Create",
    "Add components",
    "Test",
    // "How workflows fit": the products, in a sentence.
    "Monitors",
    "Incidents",
    "alerts",
    "Runbooks",
  ],
  "workflows/configuration": [
    // "Mark a global variable as a secret": the word, not the switch.
    "secret",
  ],
};

/*
 * What the server writes, quoted on these pages: every language quotes it
 * as written, in English.
 */
const SERVER_MESSAGES: Record<string, Array<string>> = {
  "workflows/authoring": [WORKFLOW_TURNED_OFF_MESSAGE],
  "workflows/components": [
    "… (truncated — see OneUptime for the full text)",
    "Reconnecting too fast",
  ],
  "workflows/runs-and-logs": ["… (truncated)"],
  "workflows/configuration": [WORKFLOW_ARCHIVED_BEFORE_RUN_MESSAGE],
};

const PATH_SEPARATOR: string = " → ";

function englishPage(page: string): string {
  return readPage("en", page);
}

// The bold spans of a page that are one label, not a path.
function boldLabels(markdown: string): Array<string> {
  return boldSpans(prose(markdown)).filter((span: string): boolean => {
    return !span.includes("→");
  });
}

// The bold spans of a page that are a path of Dashboard labels.
function menuPaths(markdown: string): Array<Array<string>> {
  return boldSpans(prose(markdown))
    .filter((span: string): boolean => {
      return span.includes(PATH_SEPARATOR);
    })
    .map((span: string): Array<string> => {
      return span.split("→").map((segment: string): string => {
        return segment.trim();
      });
    })
    .filter((segments: Array<string>): boolean => {
      return segments.every((segment: string): boolean => {
        return isActionLabel(segment);
      });
    });
}

// The Dashboard labels a page names, minus the ones kept or worded as prose.
function checkedLabels(page: string): Array<string> {
  const kept: Array<string> = KEPT_IN_ENGLISH[page] || [];
  const proseWords: Array<string> = PROSE[page] || [];

  return boldLabels(englishPage(page)).filter((label: string): boolean => {
    return (
      isActionLabel(label) &&
      !kept.includes(label) &&
      !proseWords.includes(label)
    );
  });
}

// Everything a built-in step defines: its title, settings, outputs and values.
function stepDefinedNames(): Set<string> {
  const names: Set<string> = new Set<string>();

  for (const component of Components as Array<ComponentMetadata>) {
    names.add(component.title);

    for (const argument of component.arguments as Array<Argument>) {
      names.add(argument.name);
    }

    for (const argument of (component.runWorkflowManuallyArguments ||
      []) as Array<Argument>) {
      names.add(argument.name);
    }

    for (const port of [
      ...component.inPorts,
      ...component.outPorts,
    ] as Array<Port>) {
      names.add(port.title);
    }

    for (const returnValue of component.returnValues as Array<ReturnValue>) {
      names.add(returnValue.name);
    }
  }

  // What every record step names its settings (Types/Workflow/Components/BaseModel).
  for (const name of [
    "Query",
    "Select Fields",
    "Skip",
    "Limit",
    "JSON Object",
    "JSON Array",
    "Data (JSON Object)",
    "Listen on",
    "Incident Template",
  ]) {
    names.add(name);
  }

  return names;
}

function isPermissionOrRole(name: string): boolean {
  return PermissionHelper.getAllPermissionProps().some(
    (props: { title: string }): boolean => {
      return props.title === name;
    },
  );
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
            ok: labels.includes(label) && isActionLabel(label),
          });
        }
      }
    }
  });

  it("keep in English only what a step defines, a role or permission, or a plan", () => {
    const steps: Set<string> = stepDefinedNames();

    for (const page of Object.keys(KEPT_IN_ENGLISH)) {
      for (const name of KEPT_IN_ENGLISH[page] as Array<string>) {
        expect({
          page,
          name,
          why: steps.has(name) || isPermissionOrRole(name) || PLANS.includes(name),
        }).toEqual({ page, name, why: true });
      }
    }
  });

  it("find plenty to check on every page", () => {
    for (const page of PAGE_NAMES) {
      expect({ page: page, many: checkedLabels(page).length >= 15 }).toEqual({
        page: page,
        many: true,
      });
    }

    expect(
      PAGE_NAMES.reduce((total: number, page: string): number => {
        return total + menuPaths(englishPage(page)).length;
      }, 0),
    ).toBeGreaterThanOrEqual(10);
  });

  it("quote messages the English pages quote, which no Dashboard locale has", () => {
    for (const page of Object.keys(SERVER_MESSAGES)) {
      for (const message of SERVER_MESSAGES[page] as Array<string>) {
        expect({ page, message, quoted: true }).toEqual({
          page,
          message,
          quoted: englishPage(page).includes(message),
        });
        expect({ message, isLabel: isActionLabel(message) }).toEqual({
          message,
          isLabel: false,
        });
      }
    }
  });
});

describe("the English pages", () => {
  it.each(PAGES)("$page is titled as its nav link", (entry: WorkflowPage) => {
    expect(englishPage(entry.page).split("\n")[0]).toBe(`# ${entry.navTitle}`);
  });

  it("name the Products menu's group as the Dashboard's English locale does", () => {
    const group: string = (
      (dashboardLocale("en")["navbar"] as Record<string, unknown>)[
        "categories"
      ] as Record<string, string>
    )["analyticsAutomation"] as string;

    expect(group).toBe("Dashboards & Automation");
    expect(englishPage("workflows/index")).toContain(`**${group}**`);
  });
});

describe.each(LANGUAGES)("%s workflow pages", (language: string) => {
  describe.each(PAGES)("$page", (entry: WorkflowPage) => {
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
      const missing: Array<string> = checkedLabels(entry.page)
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

    it("keeps in English the names a step, a role or a plan has", () => {
      const translated: string = readPage(language, entry.page);

      for (const name of KEPT_IN_ENGLISH[entry.page] || []) {
        expect({
          name: name,
          kept: translated.includes(`**${name}**`),
        }).toEqual({ name: name, kept: true });
      }
    });

    it("quotes what the server writes as the server writes it, in English", () => {
      const translated: string = prose(readPage(language, entry.page));

      for (const message of SERVER_MESSAGES[entry.page] || []) {
        expect({ message, quoted: translated.includes(message) }).toEqual({
          message,
          quoted: true,
        });
      }
    });
  });

  it("names the Products menu's group as this language's Dashboard does", () => {
    const group: string = (
      (dashboardLocale(language)["navbar"] as Record<string, unknown>)[
        "categories"
      ] as Record<string, string>
    )["analyticsAutomation"] as string;

    expect(typeof group).toBe("string");
    expect(readPage(language, "workflows/index")).toContain(`**${group}**`);
  });
});

describe("the label helpers, on these pages' buttons", () => {
  it("draw a named action from its template when the locale has no phrase for it", () => {
    expect(isActionLabel("Duplicate Workflow")).toBe(true);
    expect(drawnActionLabel("en", "Duplicate Workflow")).toBe(
      "Duplicate Workflow",
    );

    const template: string = dashboardLocale("de")[
      "Duplicate {{itemName}}"
    ] as string;
    const item: string = dashboardLocale("de")["Workflow"] as string;

    expect(drawnActionLabel("de", "Duplicate Workflow")).toBe(
      template.replace("{{itemName}}", item),
    );
  });

  it("prefer a phrase the locale has whole", () => {
    expect(drawnActionLabel("de", "Delete Workflow")).toBe(
      dashboardLocale("de")["Delete Workflow"],
    );
  });

  it("leave text no template draws in English", () => {
    expect(isActionLabel("Send Message to Teams")).toBe(false);
    expect(drawnActionLabel("de", "Send Message to Teams")).toBe(
      "Send Message to Teams",
    );
  });

  it("tell a menu path from a label", () => {
    const markdown: string =
      "**Workflows → Logs → Runs**, **Manual › JSON** and **Run Workflow**";

    expect(menuPaths(markdown)).toEqual([["Workflows", "Logs", "Runs"]]);
    expect(boldLabels(markdown)).toEqual(["Manual › JSON", "Run Workflow"]);
  });
});
