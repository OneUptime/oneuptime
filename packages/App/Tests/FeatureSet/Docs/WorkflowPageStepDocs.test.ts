import { anchorsOf, readPage } from "./DocsContentSupport";
import { drawnActionLabel } from "./DocsDashboardLabels";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import slugify from "Common/Server/Types/MarkdownSlugify";
import {
  MAX_ON_CALL_DIRECT_PAGE_TARGETS,
  ON_CALL_DIRECT_PAGE_ACKNOWLEDGE_WAIT_IN_MINUTES,
} from "Common/Types/OnCallDutyPolicy/OnCallDirectPage";
import ComponentMetadata, {
  Argument,
  ArgumentChoice,
  Port,
  ReturnValue,
  isRecordListInputType,
} from "Common/Types/Workflow/Component";
import ComponentID from "Common/Types/Workflow/ComponentID";
import OnCallComponents from "Common/Types/Workflow/Components/OnCall";
import { PAGE_ARGUMENT_IDS } from "Common/Types/Workflow/Components/OnCallPageSettings";
import { WorkflowDocsPaths } from "Common/Types/Workflow/Documentation/DocumentationLinks";
import {
  WorkflowTemplate,
  WorkflowTemplateCategory,
  WorkflowTemplateWhoToPage,
  getTemplateGraphSpec,
  getWorkflowTemplate,
  getWorkflowTemplateCategoryInfo,
  getWorkflowTemplates,
} from "Common/Types/Workflow/Templates";
import { componentReturnValueReference } from "Common/Types/Workflow/TemplateSyntax";
import { DIRECT_PAGE_LABEL } from "Common/UI/Components/OnCallDirectPage/DirectPageLabel";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The Paging section of the workflow Components guide.
 *
 * "I want to conditionally page someone / a group of people / an on-call
 * person. Can I do this in workflow?" The section is the answer in the
 * docs: the four Page steps, how to make paging conditional, their
 * settings, what a page with no policy behind it is, and that a test run
 * pages for real.
 *
 * The steps' "How to use" help links to the section by anchor, and the docs
 * answer in the reader's language, so every language has it, under the
 * same heading. Each copy names the steps, their settings, outputs and
 * values as the steps do, the Dashboard's own labels as that language's
 * Dashboard draws them, and keeps the diagram and the code as they are.
 * The English section is held to what the code really does: the limit, the
 * wait, the template, and what a new step starts with.
 */

const LANGUAGES: Array<string> = [...SUPPORTED_DOCS_LANGUAGE_CODES];

const PAGE: string = "workflows/components";
const HEADING: string = "## Paging";
const LINK: string = "[Paging](#paging)";

const COMMON_UI: string = path.resolve(__dirname, "../../../../Common/UI");

type ReadSourceFunction = (file: string) => string;

const readCommonUi: ReadSourceFunction = (file: string): string => {
  return fs.readFileSync(path.join(COMMON_UI, file), "utf8");
};

const PAGE_STEPS: Array<ComponentMetadata> =
  OnCallComponents as Array<ComponentMetadata>;

type StepFunction = (id: ComponentID) => ComponentMetadata;

const step: StepFunction = (id: ComponentID): ComponentMetadata => {
  return PAGE_STEPS.find((component: ComponentMetadata): boolean => {
    return component.id === id;
  }) as ComponentMetadata;
};

type HeadingsFunction = (markdown: string) => Array<string>;

// A page's "## " headings, in order.
const headings: HeadingsFunction = (markdown: string): Array<string> => {
  return markdown
    .split("\n")
    .filter((line: string): boolean => {
      return line.startsWith("## ");
    })
    .map((line: string): string => {
      return line.substring(3).trim();
    });
};

type SectionFunction = (markdown: string) => string;

// The text under "## Paging", up to the next "## " heading.
const pagingSection: SectionFunction = (markdown: string): string => {
  const start: number = markdown.indexOf(`\n${HEADING}\n`);

  expect(start).toBeGreaterThanOrEqual(0);

  const rest: string = markdown.substring(start + HEADING.length + 2);
  const end: number = rest.indexOf("\n## ");

  return end === -1 ? rest : rest.substring(0, end);
};

type SectionOfFunction = (language: string) => string;

const sectionOf: SectionOfFunction = (language: string): string => {
  return pagingSection(readPage(language, PAGE));
};

type RowNamesFunction = (section: string) => Array<string>;

// The first cell of every table row that starts with a bold name.
const rowNames: RowNamesFunction = (section: string): Array<string> => {
  return section
    .split("\n")
    .filter((line: string): boolean => {
      return line.startsWith("| **");
    })
    .map((line: string): string => {
      return line.substring(2, line.indexOf("|", 2)).trim();
    });
};

type DiagramFunction = (section: string) => Array<string>;

// The lines of the section's one diagram, without its opening and closing fence.
const diagramOf: DiagramFunction = (section: string): Array<string> => {
  const lines: Array<string> = section.split("\n");
  const open: number = lines.findIndex((line: string): boolean => {
    return line.startsWith("```mermaid");
  });
  const close: number = lines.indexOf("```", open + 1);

  expect(open).toBeGreaterThanOrEqual(0);
  expect(close).toBeGreaterThan(open);

  return lines.slice(open + 1, close);
};

// The reference a Page step is given for the incident its workflow started on.
const INCIDENT_ID_REFERENCE: string = componentReturnValueReference(
  "incident-on-create-1",
  "model",
  ["_id"],
);

const ABOUT: Argument = (
  step(ComponentID.PageUsers).arguments as Array<Argument>
).find((argument: Argument): boolean => {
  return argument.id === PAGE_ARGUMENT_IDS.about;
}) as Argument;

describe("the Paging section of the Components guide", () => {
  test("is where the Page steps' help links to", () => {
    expect(WorkflowDocsPaths.paging).toBe("/workflows/components#paging");
    expect(slugify("Paging")).toBe("paging");
  });

  test("is in every language, under the same heading, between Email and Custom Code", () => {
    expect(LANGUAGES.length).toBeGreaterThanOrEqual(17);

    for (const language of LANGUAGES) {
      const all: Array<string> = headings(readPage(language, PAGE));
      const at: number = all.indexOf("Paging");

      expect({
        language,
        before: all[at - 1],
        after: all[at + 1],
        anchor: slugify(all[at] || ""),
      }).toEqual({
        language,
        before: "Email",
        after: "Custom Code",
        anchor: "paging",
      });
    }
  });

  test("has a row for each Page step, by the name the Add Component panel gives it, in every language", () => {
    const titles: Array<string> = PAGE_STEPS.map(
      (component: ComponentMetadata): string => {
        return component.title;
      },
    );

    expect(titles).toEqual([
      "Page Users",
      "Page a Team",
      "Page Whoever Is On Call",
      "Page an On-Call Policy",
    ]);

    for (const language of LANGUAGES) {
      expect({
        language,
        rows: rowNames(sectionOf(language)).slice(0, titles.length),
      }).toEqual({
        language,
        rows: titles.map((title: string): string => {
          return `**${title}**`;
        }),
      });
    }
  });

  test("names every setting as the steps do, in the order their form asks, in every language", () => {
    // Who to page: one setting on each step, by its own name.
    const who: Array<string> = PAGE_STEPS.map(
      (component: ComponentMetadata): string => {
        return (
          (component.arguments as Array<Argument>).find(
            (argument: Argument): boolean => {
              return isRecordListInputType(argument.type);
            },
          ) as Argument
        ).name;
      },
    );

    expect(who).toEqual([
      "Users",
      "Teams",
      "On-Call Schedules",
      "On-Call Policies",
    ]);

    // And what the page is about: the same settings on all four.
    const rest: Array<string> = (
      step(ComponentID.PageUsers).arguments as Array<Argument>
    )
      .slice(1)
      .map((argument: Argument): string => {
        return argument.name;
      });

    expect(rest).toEqual([
      "Page About",
      "Title",
      "Message",
      "Incident ID",
      "Alert ID",
      "Severity",
    ]);

    for (const component of PAGE_STEPS) {
      expect(
        (component.arguments as Array<Argument>)
          .slice(1)
          .map((argument: Argument): string => {
            return argument.name;
          }),
      ).toEqual(rest);
    }

    for (const language of LANGUAGES) {
      const section: string = sectionOf(language);
      const rows: Array<string> = rowNames(section).slice(PAGE_STEPS.length);

      // One row for who to page, then a row per setting or pair of settings.
      expect({ language, rows: rows.length }).toEqual({ language, rows: 5 });

      for (const name of who) {
        expect({
          language,
          name,
          inRow: rows[0]!.includes(`**${name}**`),
        }).toEqual({ language, name, inRow: true });
      }

      expect(rows[1]).toBe("**Page About**");
      expect(rows[2]).toContain("**Title**");
      expect(rows[2]).toContain("**Message**");
      expect(rows[3]).toContain("**Incident ID**");
      expect(rows[3]).toContain("**Alert ID**");
      expect(rows[4]).toBe("**Severity**");
    }
  });

  test("names the three things a page can be about as the setting's choices do, in every language", () => {
    const choices: Array<string> = (ABOUT.choices as Array<ArgumentChoice>).map(
      (choice: ArgumentChoice): string => {
        return choice.label;
      },
    );

    expect(choices).toEqual(["A new alert", "An incident", "An alert"]);

    for (const language of LANGUAGES) {
      const row: string = sectionOf(language)
        .split("\n")
        .find((line: string): boolean => {
          return line.startsWith("| **Page About**");
        }) as string;

      for (const choice of choices) {
        expect({
          language,
          choice,
          named: row.includes(`**${choice}**`),
        }).toEqual({ language, choice, named: true });
      }
    }
  });

  test("names the outputs and the values a Page step hands on, in every language", () => {
    const users: ComponentMetadata = step(ComponentID.PageUsers);

    expect(
      (users.outPorts as Array<Port>).map((port: Port): string => {
        return port.title;
      }),
    ).toEqual(["Success", "Error"]);

    const values: Array<string> = (
      users.returnValues as Array<ReturnValue>
    ).map((value: ReturnValue): string => {
      return value.name;
    });

    expect(values).toContain("Summary");
    expect(values).toContain("Paged Users");
    expect(values).toContain("Error");

    for (const language of LANGUAGES) {
      const section: string = sectionOf(language);

      for (const name of ["Success", "Error", "Summary", "Paged Users"]) {
        expect({
          language,
          name,
          named: section.includes(`**${name}**`),
        }).toEqual({ language, name, named: true });
      }
    }
  });

  test("names the Dashboard's own labels as each language's Dashboard draws them", () => {
    // Each is drawn through the translator, from the English the docs quote.
    expect(DIRECT_PAGE_LABEL).toBe("Direct page");
    expect(
      getWorkflowTemplateCategoryInfo(WorkflowTemplateCategory.OnCall).label,
    ).toBe("On-Call");
    expect(readCommonUi("Components/Workflow/Component.tsx")).toContain(
      '"Click to set up"',
    );
    expect(
      readCommonUi("Components/Workflow/ComponentSettingsModal.tsx"),
    ).toContain('title="Run just this step"');

    for (const language of LANGUAGES) {
      const section: string = sectionOf(language);

      for (const label of [
        "Add Component",
        "On-Call",
        "Create a workflow",
        "Click to set up",
        "More fields",
        DIRECT_PAGE_LABEL,
        "Run Workflow",
        "Run just this step",
      ]) {
        const drawn: string = drawnActionLabel(language, label);

        expect({
          language,
          label,
          named: section.includes(`**${drawn}**`),
        }).toEqual({ language, label, named: true });
      }

      // The new label is worded in every locale; none leaves it in English.
      if (language !== "en") {
        expect({
          language,
          drawn: drawnActionLabel(language, DIRECT_PAGE_LABEL),
        }).not.toEqual({ language, drawn: DIRECT_PAGE_LABEL });
      }
    }
  });

  test("keeps what to search for and the incident's reference as code, in every language", () => {
    expect(INCIDENT_ID_REFERENCE).toBe(
      "{{local.components.incident-on-create-1.returnValues.model._id}}",
    );

    for (const language of LANGUAGES) {
      const section: string = sectionOf(language);

      for (const code of ["`page`", `\`${INCIDENT_ID_REFERENCE}\``]) {
        expect({ language, code, kept: section.includes(code) }).toEqual({
          language,
          code,
          kept: true,
        });
      }
    }
  });

  test("draws the same workflow in every language: the blocks and outputs keep their names", () => {
    const english: Array<string> = diagramOf(sectionOf("en"));

    expect(english).toEqual([
      "flowchart TB",
      '    trigger["On Create Incident"] -->|"Success"| check["If / Else"]',
      '    check -->|"Yes"| page["Page Whoever Is On Call"]',
    ]);

    for (const language of LANGUAGES) {
      expect({ language, diagram: diagramOf(sectionOf(language)) }).toEqual({
        language,
        diagram: english,
      });
    }
  });

  test("links to If / Else and Switch / Case, which make paging conditional, in every language", () => {
    for (const language of LANGUAGES) {
      const section: string = sectionOf(language);

      for (const link of [
        "[If / Else](#conditions)",
        "[Switch / Case](#switch-case)",
      ]) {
        expect({ language, link, linked: section.includes(link) }).toEqual({
          language,
          link,
          linked: true,
        });
      }
    }
  });

  test("links to how each person is reached, on a heading the on-call page has in that language", () => {
    const target: string = "/docs/on-call/escalation-rules#";

    for (const language of LANGUAGES) {
      const section: string = sectionOf(language);
      const at: number = section.indexOf(target);

      expect({ language, linked: at >= 0 }).toEqual({ language, linked: true });

      const anchor: string = section.substring(
        at + target.length,
        section.indexOf(")", at),
      );

      expect({
        language,
        anchor,
        lands: anchorsOf(language, "on-call/escalation-rules").has(
          decodeURIComponent(anchor),
        ),
      }).toEqual({ language, anchor, lands: true });
    }

    expect(sectionOf("en")).toContain(
      "[How each person is reached](/docs/on-call/escalation-rules#how-each-person-is-reached)",
    );
  });

  test("warns that a test run pages for real, in every language", () => {
    for (const language of LANGUAGES) {
      const lines: Array<string> = sectionOf(language).trimEnd().split("\n");
      const marker: number = lines.indexOf("> [!WARNING]");

      expect({ language, warned: marker >= 0 }).toEqual({
        language,
        warned: true,
      });

      // The last thing the section says, with both ways to run named.
      expect(marker).toBe(lines.length - 2);
      expect(lines[marker + 1]).toContain(
        `**${drawnActionLabel(language, "Run Workflow")}**`,
      );
      expect(lines[marker + 1]).toContain(
        `**${drawnActionLabel(language, "Run just this step")}**`,
      );
    }
  });
});

describe("the English section says what the code does", () => {
  const section: string = sectionOf("en");

  test("the first three page at once with no escalation, and the fourth is the one that escalates", () => {
    expect(section).toContain(
      "The first three page everybody they name at once, and nobody else after that. For escalation, use **Page an On-Call Policy**.",
    );
  });

  test("gives the most people, teams and schedules one page names", () => {
    expect(MAX_ON_CALL_DIRECT_PAGE_TARGETS).toBe(100);
    expect(section).toContain(
      `A page names at most ${MAX_ON_CALL_DIRECT_PAGE_TARGETS} people, teams and schedules.`,
    );
  });

  test("gives how long a page with no policy waits for an acknowledgement", () => {
    expect(ON_CALL_DIRECT_PAGE_ACKNOWLEDGE_WAIT_IN_MINUTES).toBe(30);
    expect(section).toContain(
      `It stays open for ${ON_CALL_DIRECT_PAGE_ACKNOWLEDGE_WAIT_IN_MINUTES} minutes, and for as long after that as pages are still going out.`,
    );
    expect(section).toContain("it ends without paging anybody else");
  });

  test("names the template its diagram draws, and the one that pages by severity", () => {
    type Graph = NonNullable<ReturnType<typeof getTemplateGraphSpec>>;
    type GraphNode = Graph["nodes"][number];
    type GraphEdge = Graph["edges"][number];

    expect(section).toContain(
      "the templates under **On-Call** have this one ready, and one that pages by severity with **Switch / Case**",
    );

    // The diagram, as the On-Call template builds it.
    const critical: Graph = getTemplateGraphSpec(
      "incident-critical-page-on-call",
    ) as Graph;

    expect(
      getWorkflowTemplate("incident-critical-page-on-call")?.category,
    ).toBe(WorkflowTemplateCategory.OnCall);

    type MetadataOfFunction = (componentId: string) => string;

    const metadataOf: MetadataOfFunction = (componentId: string): string => {
      return (
        critical.nodes.find((node: GraphNode): boolean => {
          return node.componentId === componentId;
        }) as GraphNode
      ).metadataId;
    };

    type LeadsToFunction = (from: string, port: string) => Array<string>;

    const leadsTo: LeadsToFunction = (
      from: string,
      port: string,
    ): Array<string> => {
      return critical.edges
        .filter((edge: GraphEdge): boolean => {
          return edge.fromComponentId === from && edge.fromPort === port;
        })
        .map((edge: GraphEdge): string => {
          return metadataOf(edge.toComponentId);
        });
    };

    expect(metadataOf("incident-on-create-1")).toBe("incident-on-create");
    expect(leadsTo("incident-on-create-1", "success")).toEqual([
      ComponentID.IfElse,
    ]);
    expect(leadsTo("if-else-1", "yes")).toEqual([ComponentID.PageOnCall]);
    // Nothing on No: the run ends there, and No is not a failure.
    expect(leadsTo("if-else-1", "no")).toEqual([]);

    // And the other one: a Switch / Case with a Page step on its cases.
    const bySeverity: Graph = getTemplateGraphSpec(
      "incident-severity-page",
    ) as Graph;

    expect(getWorkflowTemplate("incident-severity-page")?.category).toBe(
      WorkflowTemplateCategory.OnCall,
    );
    expect(
      bySeverity.nodes.map((node: GraphNode): string => {
        return node.metadataId;
      }),
    ).toEqual(
      expect.arrayContaining([
        ComponentID.Switch,
        ComponentID.PageOnCallPolicy,
        ComponentID.PageTeam,
      ]),
    );
  });

  /*
   * A template names no one to page: its Page steps leave who to page
   * empty, and the create dialog asks for it, one question per Page step
   * (WorkflowTemplate.whoToPage), so the workflow opens with them set.
   */
  test("says the create dialog asks who each of a template's Page steps pages, which every paging template asks", () => {
    type Graph = NonNullable<ReturnType<typeof getTemplateGraphSpec>>;

    expect(section).toContain(
      "The **Create a workflow** dialog asks who each of a template's paging blocks pages, so the workflow opens with them set.",
    );
    expect(section).not.toContain("A template leaves who to page for you");

    let pagingTemplates: number = 0;

    for (const template of getWorkflowTemplates() as Array<WorkflowTemplate>) {
      const graph: Graph = getTemplateGraphSpec(template.id) as Graph;
      const asked: Array<string> = (template.whoToPage || []).map(
        (ask: WorkflowTemplateWhoToPage): string => {
          return ask.componentId;
        },
      );
      const pageSteps: Array<string> = graph.nodes
        .filter((node: Graph["nodes"][number]): boolean => {
          return PAGE_STEPS.some((component: ComponentMetadata): boolean => {
            return component.id === node.metadataId;
          });
        })
        .map((node: Graph["nodes"][number]): string => {
          return node.componentId;
        });

      if (pageSteps.length > 0) {
        pagingTemplates++;
      }

      expect({ template: template.id, asked: [...asked].sort() }).toEqual({
        template: template.id,
        asked: [...pageSteps].sort(),
      });
    }

    expect(pagingTemplates).toBeGreaterThanOrEqual(5);

    for (const templateId of [
      "incident-critical-page-on-call",
      "incident-severity-page",
    ]) {
      const graph: Graph = getTemplateGraphSpec(templateId) as Graph;

      for (const node of graph.nodes) {
        const pageStep: ComponentMetadata | undefined = PAGE_STEPS.find(
          (component: ComponentMetadata): boolean => {
            return component.id === node.metadataId;
          },
        );

        if (!pageStep) {
          continue;
        }

        const who: Argument = (pageStep.arguments as Array<Argument>).find(
          (argument: Argument): boolean => {
            return isRecordListInputType(argument.type);
          },
        ) as Argument;

        expect(Object.keys(node.args || {})).not.toContain(who.id);
      }
    }
  });

  test("says when Success and Error run, as the steps' outputs describe them", () => {
    expect(section).toContain(
      "**Success** runs once at least one person is paged, or one policy has started.",
    );

    const outputs: Array<string> = PAGE_STEPS.flatMap(
      (component: ComponentMetadata): Array<string> => {
        return (component.outPorts as Array<Port>).map((port: Port): string => {
          return `${port.title}: ${port.description}`;
        });
      },
    );

    expect(outputs).toContain(
      "Success: Runs once at least one person is paged.",
    );
    expect(outputs).toContain(
      "Success: Runs once at least one policy has started.",
    );
    expect(outputs).toContain(
      "Error: Runs when nobody was paged. Error says why.",
    );
  });

  test("says the Severity is folded away and what an empty one means, as the setting does", () => {
    const severity: Argument = (
      step(ComponentID.PageUsers).arguments as Array<Argument>
    ).find((argument: Argument): boolean => {
      return argument.id === PAGE_ARGUMENT_IDS.alertSeverity;
    }) as Argument;

    expect(severity.isAdvanced).toBe(true);
    expect(severity.description).toContain(
      "Left empty, it is the project's most severe.",
    );
    expect(section).toContain("under **More fields**");
    expect(section).toContain("Left empty, it is the project's most severe.");
  });
});

describe("the rest of the Components guide points to Paging", () => {
  test("from the table of which component to use, right after email, in every language", () => {
    for (const language of LANGUAGES) {
      const rows: Array<string> = readPage(language, PAGE)
        .split("\n")
        .filter((line: string): boolean => {
          return line.startsWith("|");
        });
      const at: number = rows.findIndex((line: string): boolean => {
        return line.includes(LINK);
      });

      expect({
        language,
        found: at >= 0,
        afterEmail: (rows[at - 1] || "").includes("](#email)"),
        once: rows.filter((line: string): boolean => {
          return line.includes(LINK);
        }).length,
      }).toEqual({ language, found: true, afterEmail: true, once: 1 });
    }
  });
});
