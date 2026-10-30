/*
 * The Zabbix templates, as the catalog holds them: the category the picker
 * shows, the six templates and what each asks for, the Zabbix URL and API
 * token their wizard takes, how they reach Zabbix's API, their scripts,
 * what their steps read as the workflow's principal, and where their cards
 * lie on the canvas.
 *
 * They were made simple (the maintainer: "4-5 components max"): the
 * workflow Zabbix sends its problems to is five steps - the Webhook,
 * read-event-1, Incident (or Alert) From Another Tool, and an If / Else and
 * a Page step for High and Disaster problems - where it was 48; the two that
 * write back to Zabbix are three and four, through Update Zabbix Problem.
 *
 * What they do when they run is ZabbixTemplateSimulation's, and that they
 * do what the old ones did is ZabbixTemplateEquivalence's; what each script
 * decides is ZabbixTemplateScripts'. Templates.test.ts holds every
 * template, these too, to the component registry and the builder's checks.
 */

import Alert from "../../../Models/DatabaseModels/Alert";
import AlertInternalNote from "../../../Models/DatabaseModels/AlertInternalNote";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import AlertStateTimeline from "../../../Models/DatabaseModels/AlertStateTimeline";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentInternalNote from "../../../Models/DatabaseModels/IncidentInternalNote";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "../../../Models/DatabaseModels/IncidentStateTimeline";
import ColumnPermissions from "../../../Server/Types/Database/Permissions/ColumnPermission";
import QueryPermission from "../../../Server/Types/Database/Permissions/QueryPermission";
import SelectPermission from "../../../Server/Types/Database/Permissions/SelectPermission";
import TablePermission from "../../../Server/Types/Database/Permissions/TablePermission";
import WorkflowPrincipal from "../../../Server/Utils/Workflow/WorkflowPrincipal";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseRequestType from "../../../Server/Types/BaseDatabase/DatabaseRequestType";
import IconProp from "../../../Types/Icon/IconProp";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import ComponentMetadata, {
  Argument,
  ComponentType,
  Port,
} from "../../../Types/Workflow/Component";
import ComponentID from "../../../Types/Workflow/ComponentID";
import { getComponentOutPorts } from "../../../Types/Workflow/ComponentOutPorts";
import { FROM_ANOTHER_TOOL_ARGUMENT_IDS } from "../../../Types/Workflow/Components/FromAnotherTool";
import {
  ZABBIX_UPDATE_ARGUMENT_IDS,
  ZabbixProblemUpdate,
} from "../../../Types/Workflow/Components/Zabbix";
import {
  ONEUPTIME_SYNCED_FROM_ZABBIX_MARKER,
  WorkflowTemplate,
  WorkflowTemplateCategories,
  WorkflowTemplateCategory,
  WorkflowTemplateVariable,
  ZABBIX_ACTION_ACKNOWLEDGE,
  ZABBIX_ACTION_CLOSE,
  ZABBIX_ACTION_MESSAGE,
  ZABBIX_API_TOKEN_PATTERN,
  ZABBIX_EVENT_ID_CUSTOM_FIELD,
  ZABBIX_MESSAGE_MAX_LENGTH,
  ZABBIX_PAGE_FROM_SEVERITY,
  ZABBIX_SEVERITY_NAMES,
  ZABBIX_SYNCED_FROM_ONEUPTIME_MARKER,
  ZABBIX_URL_PATTERN,
  ZABBIX_WEBHOOK_COMPONENT_ID,
  buildGraphForTemplate,
  getTemplateGraphSpec,
  getWorkflowTemplateCategoryInfo,
  getWorkflowTemplates,
  getWorkflowTemplatesByCategory,
} from "../../../Types/Workflow/Templates";
import { WORKFLOW_NODE_WIDTH } from "../../../UI/Components/Workflow/NodePlacement";
import { getOutputLayout } from "../../../UI/Components/Workflow/PortLayout";
import { loadComponentsAndCategories } from "../../../UI/Components/Workflow/Utils";
import { describe, expect, test } from "@jest/globals";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";

type TemplateGraphSpec = NonNullable<ReturnType<typeof getTemplateGraphSpec>>;
type TemplateNodeSpec = TemplateGraphSpec["nodes"][number];

const CATALOG: Array<ComponentMetadata> =
  loadComponentsAndCategories().components;

const ZABBIX: Array<WorkflowTemplate> = getWorkflowTemplatesByCategory(
  WorkflowTemplateCategory.Zabbix,
);

const ZABBIX_IDS: Array<string> = ZABBIX.map(
  (template: WorkflowTemplate): string => {
    return template.id;
  },
);

const PROBLEM_TEMPLATES: Array<string> = [
  "zabbix-declare-incident-from-problem",
  "zabbix-create-alert-from-problem",
];

const API_TEMPLATES: Array<string> = [
  "zabbix-update-problem-on-incident-state",
  "zabbix-message-from-incident-private-note",
  "zabbix-update-problem-on-alert-state",
  "zabbix-message-from-alert-private-note",
];

function spec(templateId: string): TemplateGraphSpec {
  const found: TemplateGraphSpec | null = getTemplateGraphSpec(templateId);

  if (!found) {
    throw new Error(`No template ${templateId}`);
  }

  return found;
}

function template(templateId: string): WorkflowTemplate {
  const found: WorkflowTemplate | undefined = ZABBIX.find(
    (candidate: WorkflowTemplate): boolean => {
      return candidate.id === templateId;
    },
  );

  if (!found) {
    throw new Error(`No Zabbix template ${templateId}`);
  }

  return found;
}

function node(templateId: string, componentId: string): TemplateNodeSpec {
  const found: TemplateNodeSpec | undefined = spec(templateId).nodes.find(
    (candidate: TemplateNodeSpec): boolean => {
      return candidate.componentId === componentId;
    },
  );

  if (!found) {
    throw new Error(`${templateId} has no step ${componentId}`);
  }

  return found;
}

function metadataOf(metadataId: string): ComponentMetadata {
  const found: ComponentMetadata | undefined = CATALOG.find(
    (component: ComponentMetadata): boolean => {
      return component.id === metadataId;
    },
  );

  if (!found) {
    throw new Error(`No workflow step ${metadataId}`);
  }

  return found;
}

// Every string a step's settings hold, nested ones included.
function stringsOf(value: JSONValue | undefined): Array<string> {
  if (typeof value === "string") {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry: JSONValue): Array<string> => {
      return stringsOf(entry);
    });
  }

  if (value && typeof value === "object") {
    return Object.values(value).flatMap((entry: JSONValue): Array<string> => {
      return stringsOf(entry);
    });
  }

  return [];
}

function scriptsOf(templateId: string): Array<[string, string]> {
  return spec(templateId)
    .nodes.filter((candidate: TemplateNodeSpec): boolean => {
      return candidate.metadataId === ComponentID.JavaScriptCheck;
    })
    .map((candidate: TemplateNodeSpec): [string, string] => {
      return [candidate.componentId, String(candidate.args?.["code"])];
    });
}

/* ------------------------------- The category ------------------------------- */

describe("the Zabbix category", () => {
  test("is in the picker after Huntress, before the general Integrations", () => {
    const order: Array<WorkflowTemplateCategory> = [
      ...WorkflowTemplateCategories,
    ];

    expect(order.indexOf(WorkflowTemplateCategory.Zabbix)).toBe(
      order.indexOf(WorkflowTemplateCategory.Huntress) + 1,
    );
    expect(order.indexOf(WorkflowTemplateCategory.Integrations)).toBe(
      order.indexOf(WorkflowTemplateCategory.Zabbix) + 1,
    );
  });

  test("is labelled with the product's name, says what it is for in one line, and has the icon of the servers Zabbix watches", () => {
    expect(
      getWorkflowTemplateCategoryInfo(WorkflowTemplateCategory.Zabbix),
    ).toEqual({
      category: WorkflowTemplateCategory.Zabbix,
      label: "Zabbix",
      description:
        "Open incidents or alerts for Zabbix problems, and keep both sides in step.",
      icon: IconProp.ServerStack,
    });
  });

  test("holds the six Zabbix templates, and nothing outside it is named for Zabbix", () => {
    expect(ZABBIX_IDS).toEqual([
      "zabbix-declare-incident-from-problem",
      "zabbix-update-problem-on-incident-state",
      "zabbix-message-from-incident-private-note",
      "zabbix-create-alert-from-problem",
      "zabbix-update-problem-on-alert-state",
      "zabbix-message-from-alert-private-note",
    ]);

    for (const other of getWorkflowTemplates()) {
      if (other.category === WorkflowTemplateCategory.Zabbix) {
        continue;
      }

      expect({
        id: other.id,
        named: `${other.id} ${other.name}`.toLowerCase().includes("zabbix"),
      }).toEqual({ id: other.id, named: false });
    }
  });
});

/* -------------------------- What each template is -------------------------- */

describe("the Zabbix templates, as the picker lists them", () => {
  test("say what they do in their names, and the workflows they make are named for it", () => {
    expect(
      ZABBIX.map((candidate: WorkflowTemplate): [string, string] => {
        return [candidate.name, candidate.workflowName];
      }),
    ).toEqual([
      [
        "Declare an incident for each Zabbix problem",
        "Zabbix problems to incidents",
      ],
      [
        "Acknowledge or close the Zabbix problem with the incident",
        "Sync incident state to Zabbix",
      ],
      [
        "Copy incident private notes to the Zabbix problem",
        "Copy incident private notes to Zabbix",
      ],
      ["Create an alert for each Zabbix problem", "Zabbix problems to alerts"],
      [
        "Acknowledge or close the Zabbix problem with the alert",
        "Sync alert state to Zabbix",
      ],
      [
        "Copy alert private notes to the Zabbix problem",
        "Copy alert private notes to Zabbix",
      ],
    ]);
  });

  test("the alert ones never say incident, and the incident ones never say alert", () => {
    for (const candidate of ZABBIX) {
      const words: string = [
        candidate.name,
        candidate.description,
        candidate.workflowName,
        candidate.workflowDescription,
      ]
        .join(" ")
        .toLowerCase();
      const other: string =
        candidate.subcategory === "Incidents" ? "alert" : "incident";

      expect({ id: candidate.id, saysTheOther: words.includes(other) }).toEqual(
        { id: candidate.id, saysTheOther: false },
      );
    }
  });

  /*
   * An incident is declared and an alert is created, in every word of an
   * alert template: its picker line and description, and its scripts and
   * log lines, which people read in the Builder. The UI review found two
   * lines saying an alert was "declared" for a Zabbix problem.
   */
  test("the alert ones say an alert is created, never declared, anywhere in them", () => {
    for (const candidate of ZABBIX) {
      if (candidate.subcategory !== "Alerts") {
        continue;
      }

      const everything: string = JSON.stringify({
        template: candidate,
        graph: getTemplateGraphSpec(candidate.id),
      }).toLowerCase();

      expect({
        id: candidate.id,
        saysDeclared: everything.includes("declare"),
      }).toEqual({ id: candidate.id, saysDeclared: false });
    }
  });

  /*
   * The picker shows a template's line on one line until it is picked: so
   * the line starts with what the template does, as the Jira ones do, not
   * with when.
   */
  test("each line starts with what the template does", () => {
    expect(
      ZABBIX.map((candidate: WorkflowTemplate): string => {
        return candidate.description;
      }),
    ).toEqual([
      "Pages on-call for High and Disaster problems, adds updates made in Zabbix as private notes, and resolves the incident when the problem recovers.",
      "Acknowledges the Zabbix problem when the incident is acknowledged, and closes it when the incident is resolved.",
      "Adds every new private note on an incident to its Zabbix problem as a message, so the people working in Zabbix see it too.",
      "Pages on-call for High and Disaster problems, adds updates made in Zabbix as private notes, and resolves the alert when the problem recovers.",
      "Acknowledges the Zabbix problem when the alert is acknowledged, and closes it when the alert is resolved.",
      "Adds every new private note on an alert to its Zabbix problem as a message, so the people working in Zabbix see it too.",
    ]);
  });

  test("the workflow Zabbix sends its problems to asks only for the Zabbix URL, the address its links go to", () => {
    for (const templateId of PROBLEM_TEMPLATES) {
      expect(
        template(templateId).variables.map(
          (variable: WorkflowTemplateVariable): [string, boolean, boolean] => {
            return [variable.name, variable.required, variable.isSecret];
          },
        ),
      ).toEqual([["zabbixUrl", true, false]]);
    }
  });

  test("the two that call Zabbix ask for its URL, then its API token, which alone is secret", () => {
    for (const templateId of API_TEMPLATES) {
      expect(
        template(templateId).variables.map(
          (variable: WorkflowTemplateVariable): [string, string, boolean] => {
            return [variable.name, variable.title, variable.isSecret];
          },
        ),
      ).toEqual([
        ["zabbixUrl", "Zabbix URL", false],
        ["zabbixApiToken", "Zabbix API Token", true],
      ]);
    }
  });

  test("none leaves anything for the Builder: the wizard asks who to page", () => {
    for (const candidate of ZABBIX) {
      expect({
        id: candidate.id,
        setUpInBuilder: candidate.setUpInBuilder,
      }).toEqual({ id: candidate.id, setUpInBuilder: undefined });
    }
  });

  test("only the workflow Zabbix sends its problems to pages, for High and Disaster, and picking nobody pages nobody", () => {
    for (const candidate of ZABBIX) {
      expect({ id: candidate.id, whoToPage: candidate.whoToPage }).toEqual({
        id: candidate.id,
        whoToPage: PROBLEM_TEMPLATES.includes(candidate.id)
          ? [
              {
                componentId: "page-on-call-policy-1",
                title: "Who to page for High and Disaster problems",
                description: `The on-call policies paged for a new ${
                  candidate.subcategory === "Alerts" ? "alert" : "incident"
                } from a High or Disaster problem. Pick none to page nobody.`,
                required: false,
                leftOutWhenNobody: ["if-page-1"],
              },
            ]
          : undefined,
      });
    }
  });
});

/* ------------------------------ The Zabbix URL ------------------------------ */

describe("the Zabbix URL the wizard takes", () => {
  test.each([
    "https://zabbix.example.com",
    "https://zabbix.example.com/",
    "http://zabbix.internal",
    "HTTPS://Zabbix.Example.com",
    "https://example.com/zabbix",
    "https://example.com/zabbix/",
    "https://example.com/tools/monitoring/zabbix",
    "https://zabbix.example.com:8443",
    "https://10.0.0.12/zabbix",
    "https://[2001:db8::7]:8080/zabbix",
    "https://zabbix-7.example.com/zabbix_frontend",
    "https://zábbix.example.com",
  ])("takes %s, an address Zabbix is opened at", (value: string) => {
    expect(ZABBIX_URL_PATTERN.test(value)).toBe(true);
  });

  test.each([
    ["the address of a page in it", "https://zabbix.example.com/zabbix.php"],
    [
      "a page with a query",
      "https://zabbix.example.com/zabbix.php?action=dashboard.view",
    ],
    [
      "a problem's page",
      "https://zabbix.example.com/tr_events.php?triggerid=1&eventid=2",
    ],
    ["its API's address", "https://zabbix.example.com/api_jsonrpc.php"],
    ["a fragment", "https://zabbix.example.com/#problems"],
    ["a user name", "https://admin@zabbix.example.com"],
    ["no scheme", "zabbix.example.com"],
    ["another scheme", "ftp://zabbix.example.com"],
    ["a script", "javascript:alert(1)"],
    ["a host with no letter or digit", "https://.-"],
    ["more than five path segments", "https://example.com/a/b/c/d/e/f"],
    ["a space", "https://zabbix.example.com/my zabbix"],
    ["markup", "https://zabbix.example.com/<b>"],
    ["more than 300 characters", `https://${"z".repeat(300)}.example.com`],
  ])("refuses %s", (_name: string, value: string) => {
    expect(ZABBIX_URL_PATTERN.test(value)).toBe(false);
  });

  test("the placeholder is a value it takes, and its message says what to type", () => {
    for (const candidate of ZABBIX) {
      const url: WorkflowTemplateVariable = candidate.variables.find(
        (variable: WorkflowTemplateVariable): boolean => {
          return variable.name === "zabbixUrl";
        },
      ) as WorkflowTemplateVariable;

      expect(url.format?.pattern).toBe(ZABBIX_URL_PATTERN);
      expect(ZABBIX_URL_PATTERN.test(url.placeholder)).toBe(true);
      expect(url.format?.message).toBe(
        "Enter only the address you open Zabbix at, such as https://zabbix.example.com, not a page in it.",
      );
    }
  });

  test("the script that links a problem reads the setting with the wizard's own pattern", () => {
    for (const templateId of PROBLEM_TEMPLATES) {
      for (const [, code] of scriptsOf(templateId)) {
        expect(code).toContain(
          `const SITE_SETTING = /${ZABBIX_URL_PATTERN.source}/u;`,
        );
      }
    }
  });

  test("reads a long value in time that grows with its length alone", () => {
    const timed: FastestRun<void> = fastestRun({
      run: (): void => {
        for (const value of [
          `https://${"a".repeat(400000)}`,
          `https://example.com${"/a".repeat(200000)}`,
          `https://${"a.".repeat(200000)}`,
          `https://[${":".repeat(400000)}`,
        ]) {
          expect(ZABBIX_URL_PATTERN.test(value)).toBe(false);
        }
      },
      limitInMs: 2000,
    });

    expect(timed.inMs).toBeLessThan(2000);
  });
});

describe("the Zabbix API token the wizard takes", () => {
  test.each([
    "bbcfce79a2d95037502f7e9a534906d3466c9a1484beb6ea0f4e7be28e8b8ce2",
    "BBCFCE79A2D95037502F7E9A534906D3466C9A1484BEB6EA0F4E7BE28E8B8CE2",
  ])(
    "takes %s: 64 hexadecimal characters, as Zabbix makes one",
    (value: string) => {
      expect(ZABBIX_API_TOKEN_PATTERN.test(value)).toBe(true);
    },
  );

  test.each([
    ["a session ID, half as long", "0424bd59b807674191e7d77572075f33"],
    ["a token with the word Bearer", `Bearer ${"a".repeat(64)}`],
    ["a character too many", "a".repeat(65)],
    ["a character too few", "a".repeat(63)],
    ["a letter past f", `${"a".repeat(63)}g`],
    ["the token's ID", "3"],
  ])("refuses %s", (_name: string, value: string) => {
    expect(ZABBIX_API_TOKEN_PATTERN.test(value)).toBe(false);
  });

  test("the placeholder is a value it takes", () => {
    for (const templateId of API_TEMPLATES) {
      const token: WorkflowTemplateVariable = template(
        templateId,
      ).variables.find((variable: WorkflowTemplateVariable): boolean => {
        return variable.name === "zabbixApiToken";
      }) as WorkflowTemplateVariable;

      expect(ZABBIX_API_TOKEN_PATTERN.test(token.placeholder)).toBe(true);
      expect(token.format?.pattern).toBe(ZABBIX_API_TOKEN_PATTERN);
    }
  });
});

/* --------------------------- What they send Zabbix --------------------------- */

describe("how the templates reach Zabbix's API", () => {
  const updateSteps: Array<[string, TemplateNodeSpec]> = ZABBIX_IDS.flatMap(
    (templateId: string): Array<[string, TemplateNodeSpec]> => {
      return spec(templateId)
        .nodes.filter((candidate: TemplateNodeSpec): boolean => {
          return candidate.metadataId === ComponentID.ZabbixUpdateProblem;
        })
        .map((candidate: TemplateNodeSpec): [string, TemplateNodeSpec] => {
          return [templateId, candidate];
        });
    },
  );

  test("only the two that write to Zabbix call it, each through one Update Zabbix Problem step", () => {
    expect(
      updateSteps.map(([templateId, step]: [string, TemplateNodeSpec]): string => {
        return `${templateId} ${step.componentId}`;
      }),
    ).toEqual([
      "zabbix-update-problem-on-incident-state update-problem-1",
      "zabbix-message-from-incident-private-note update-problem-1",
      "zabbix-update-problem-on-alert-state update-problem-1",
      "zabbix-message-from-alert-private-note update-problem-1",
    ]);

    for (const templateId of ZABBIX_IDS) {
      expect({
        templateId,
        apiSteps: spec(templateId).nodes.filter(
          (candidate: TemplateNodeSpec): boolean => {
            return candidate.metadataId.startsWith("api-");
          },
        ).length,
      }).toEqual({ templateId, apiSteps: 0 });
    }
  });

  test("each sends to the Zabbix URL the workflow's settings hold, with the API token", () => {
    for (const [, step] of updateSteps) {
      expect(step.args?.[ZABBIX_UPDATE_ARGUMENT_IDS.zabbixUrl]).toBe(
        "{{local.variables.zabbixUrl}}",
      );
      expect(step.args?.[ZABBIX_UPDATE_ARGUMENT_IDS.apiToken]).toBe(
        "{{local.variables.zabbixApiToken}}",
      );
      // Zabbix 6.4 and later: the token goes in a header, unless someone turns Zabbix 6.0 on.
      expect(step.args?.[ZABBIX_UPDATE_ARGUMENT_IDS.zabbix60]).toBeUndefined();
    }
  });

  test("the API token setting, where the token goes, is kept out of the run log", () => {
    const token: Argument | undefined = metadataOf(
      ComponentID.ZabbixUpdateProblem,
    ).arguments.find((argument: Argument): boolean => {
      return argument.id === ZABBIX_UPDATE_ARGUMENT_IDS.apiToken;
    });

    expect(token?.isSensitive).toBe(true);
  });

  test("the token is read in Update Zabbix Problem's API Token and nowhere else", () => {
    for (const templateId of ZABBIX_IDS) {
      for (const step of spec(templateId).nodes) {
        for (const [argumentId, value] of Object.entries(step.args || {})) {
          const naming: boolean = stringsOf(value as JSONValue).some(
            (text: string): boolean => {
              return text.includes("zabbixApiToken");
            },
          );

          if (naming) {
            expect(`${step.metadataId} ${argumentId}`).toBe(
              `${ComponentID.ZabbixUpdateProblem} ${ZABBIX_UPDATE_ARGUMENT_IDS.apiToken}`,
            );
          }
        }
      }
    }
  });

  test("the note templates add a message, and acknowledge nothing", () => {
    for (const templateId of [
      "zabbix-message-from-incident-private-note",
      "zabbix-message-from-alert-private-note",
    ]) {
      expect(
        node(templateId, "update-problem-1").args?.[
          ZABBIX_UPDATE_ARGUMENT_IDS.whatToDo
        ],
      ).toBe(ZabbixProblemUpdate.Message);
      expect(
        node(templateId, "update-problem-1").args?.[
          ZABBIX_UPDATE_ARGUMENT_IDS.message
        ],
      ).toBe(
        "{{local.components.build-message-1.returnValues.returnValue.message}}",
      );
    }
  });

  test("the state templates acknowledge or close as plan-state-1 says, for the problem it names", () => {
    for (const templateId of [
      "zabbix-update-problem-on-incident-state",
      "zabbix-update-problem-on-alert-state",
    ]) {
      const planned: (key: string) => string = (key: string): string => {
        return `{{local.components.plan-state-1.returnValues.returnValue.${key}}}`;
      };

      expect(node(templateId, "update-problem-1").args).toEqual(
        expect.objectContaining({
          [ZABBIX_UPDATE_ARGUMENT_IDS.eventId]: planned("eventId"),
          [ZABBIX_UPDATE_ARGUMENT_IDS.whatToDo]: planned("whatToDo"),
          [ZABBIX_UPDATE_ARGUMENT_IDS.message]: planned("message"),
        }),
      );
    }
  });

  test("the flags Update Zabbix Problem adds up are Zabbix's: 1 closes, 2 acknowledges, 4 adds a message", () => {
    expect([
      ZABBIX_ACTION_CLOSE,
      ZABBIX_ACTION_ACKNOWLEDGE,
      ZABBIX_ACTION_MESSAGE,
    ]).toEqual([1, 2, 4]);
  });
});

/* -------------------------------- The scripts -------------------------------- */

describe("the Zabbix templates' scripts", () => {
  const scripts: Array<[string, string, string]> = ZABBIX_IDS.flatMap(
    (templateId: string): Array<[string, string, string]> => {
      return scriptsOf(templateId).map(
        ([componentId, code]: [string, string]): [string, string, string] => {
          return [templateId, componentId, code];
        },
      );
    },
  );

  test("there are six, one in each template: read-event-1, plan-state-1 and build-message-1, for each kind", () => {
    expect(
      scripts.map(
        ([templateId, componentId]: [string, string, string]): string => {
          return `${templateId} ${componentId}`;
        },
      ),
    ).toEqual([
      "zabbix-declare-incident-from-problem read-event-1",
      "zabbix-update-problem-on-incident-state plan-state-1",
      "zabbix-message-from-incident-private-note build-message-1",
      "zabbix-create-alert-from-problem read-event-1",
      "zabbix-update-problem-on-alert-state plan-state-1",
      "zabbix-message-from-alert-private-note build-message-1",
    ]);
  });

  test("hold no double braces, which the runner would read as references before the script runs", () => {
    for (const [templateId, componentId, code] of scripts) {
      expect({
        script: `${templateId} ${componentId}`,
        opens: code.includes("{" + "{"),
        closes: code.includes("}" + "}"),
      }).toEqual({
        script: `${templateId} ${componentId}`,
        opens: false,
        closes: false,
      });
    }
  });

  test("each starts with the helper block the Zabbix templates share, with the markers and the custom field the rest of the catalog uses", () => {
    for (const [templateId, componentId, code] of scripts) {
      const head: string = code.slice(0, code.indexOf("const readJson"));

      expect({ script: `${templateId} ${componentId}`, head: head }).toEqual({
        script: `${templateId} ${componentId}`,
        head: expect.stringContaining(
          [
            "// ---- Shared by the Zabbix templates ----",
            `const FROM_ONEUPTIME = ${JSON.stringify(ZABBIX_SYNCED_FROM_ONEUPTIME_MARKER)};`,
            `const FROM_ZABBIX = ${JSON.stringify(ONEUPTIME_SYNCED_FROM_ZABBIX_MARKER)};`,
          ].join("\n"),
        ),
      });
      expect(head).toContain(
        `const EVENT_ID_FIELD = ${JSON.stringify(ZABBIX_EVENT_ID_CUSTOM_FIELD)};`,
      );
    }
  });

  test("the scripts that write Zabbix's messages cut them to what Zabbix keeps", () => {
    for (const [templateId, componentId, code] of scripts) {
      if (
        componentId !== "build-message-1" &&
        componentId !== "plan-state-1"
      ) {
        continue;
      }

      expect({
        script: `${templateId} ${componentId}`,
        limit: code.includes(String(ZABBIX_MESSAGE_MAX_LENGTH)),
      }).toEqual({ script: `${templateId} ${componentId}`, limit: true });
    }
  });

  test("the read step knows Zabbix's six severities by the names Zabbix gives them", () => {
    for (const templateId of PROBLEM_TEMPLATES) {
      expect(scriptsOf(templateId)[0]![1]).toContain(
        `const ZABBIX_SEVERITIES = ${JSON.stringify(ZABBIX_SEVERITY_NAMES)};`,
      );
    }

    expect(ZABBIX_SEVERITY_NAMES).toEqual([
      "Not classified",
      "Information",
      "Warning",
      "Average",
      "High",
      "Disaster",
    ]);
  });
});

/* ---------------------- The workflow Zabbix sends events to ---------------------- */

describe("the workflow Zabbix sends its problems to", () => {
  test.each(PROBLEM_TEMPLATES)(
    "%s is five steps, one after the other: the Webhook, read-event-1, the step that keeps the record, the If / Else and the Page step",
    (templateId: string) => {
      const r: string = templateId.includes("incident") ? "incident" : "alert";

      expect(
        spec(templateId).nodes.map(
          (candidate: TemplateNodeSpec): [string, string] => {
            return [candidate.componentId, candidate.metadataId];
          },
        ),
      ).toEqual([
        [ZABBIX_WEBHOOK_COMPONENT_ID, ComponentID.Webhook],
        ["read-event-1", ComponentID.JavaScriptCheck],
        [
          `${r}-from-another-tool-1`,
          r === "incident"
            ? ComponentID.IncidentFromAnotherTool
            : ComponentID.AlertFromAnotherTool,
        ],
        ["if-page-1", ComponentID.IfElse],
        ["page-on-call-policy-1", ComponentID.PageOnCallPolicy],
      ]);
      expect(
        spec(templateId).edges.map(
          (edge: { fromComponentId: string; fromPort: string; toComponentId: string }): string => {
            return `${edge.fromComponentId} ${edge.fromPort} ${edge.toComponentId}`;
          },
        ),
      ).toEqual([
        `${ZABBIX_WEBHOOK_COMPONENT_ID} out read-event-1`,
        `read-event-1 yes ${r}-from-another-tool-1`,
        `${r}-from-another-tool-1 opened if-page-1`,
        "if-page-1 yes page-on-call-policy-1",
      ]);
      expect(node(templateId, ZABBIX_WEBHOOK_COMPONENT_ID).componentType).toBe(
        ComponentType.Trigger,
      );
    },
  );

  test.each(PROBLEM_TEMPLATES)(
    "%s keeps one record per problem by the event ID, and hands it what read-event-1 read",
    (templateId: string) => {
      const r: string = templateId.includes("incident") ? "incident" : "alert";
      const read: (key: string) => string = (key: string): string => {
        return `{{local.components.read-event-1.returnValues.returnValue.${key}}}`;
      };

      expect(node(templateId, `${r}-from-another-tool-1`).args).toEqual({
        [FROM_ANOTHER_TOOL_ARGUMENT_IDS.whatHappened]: read("whatHappened"),
        [FROM_ANOTHER_TOOL_ARGUMENT_IDS.outsideId]: read("eventId"),
        [FROM_ANOTHER_TOOL_ARGUMENT_IDS.outsideIdField]:
          ZABBIX_EVENT_ID_CUSTOM_FIELD,
        [FROM_ANOTHER_TOOL_ARGUMENT_IDS.title]: read("title"),
        [FROM_ANOTHER_TOOL_ARGUMENT_IDS.description]: read("description"),
        [FROM_ANOTHER_TOOL_ARGUMENT_IDS.severity]: read("severity"),
        [FROM_ANOTHER_TOOL_ARGUMENT_IDS.note]: read("note"),
        [FROM_ANOTHER_TOOL_ARGUMENT_IDS.reason]: read("reason"),
      });
    },
  );

  test.each(PROBLEM_TEMPLATES)(
    "%s pages for Zabbix's High and Disaster problems: severity 4 and up, about the record it opened",
    (templateId: string) => {
      const r: string = templateId.includes("incident") ? "incident" : "alert";

      expect(node(templateId, "if-page-1").args).toEqual({
        "input-1-type": "number",
        "input-1":
          "{{local.components.read-event-1.returnValues.returnValue.severityNumber}}",
        operator: ">=",
        "input-2-type": "number",
        "input-2": String(ZABBIX_PAGE_FROM_SEVERITY),
      });
      expect(ZABBIX_SEVERITY_NAMES[ZABBIX_PAGE_FROM_SEVERITY]).toBe("High");
      expect(node(templateId, "page-on-call-policy-1").args).toEqual({
        about: r,
        [`${r}-id`]: `{{local.components.${r}-from-another-tool-1.returnValues.record._id}}`,
      });
    },
  );

  test.each(PROBLEM_TEMPLATES)(
    "%s with nobody picked to page is three steps, and pages nobody",
    (templateId: string) => {
      let counter: number = 0;
      const graph: JSONObject = buildGraphForTemplate(
        templateId,
        (): string => {
          counter++;
          return `nobody-${counter}`;
        },
        {},
      ) as JSONObject;

      expect(
        (graph["nodes"] as Array<JSONObject>).map((built: JSONObject): string => {
          return (built["data"] as JSONObject)["id"] as string;
        }),
      ).toEqual([
        ZABBIX_WEBHOOK_COMPONENT_ID,
        "read-event-1",
        `${templateId.includes("incident") ? "incident" : "alert"}-from-another-tool-1`,
      ]);
      expect(graph["edges"] as Array<JSONObject>).toHaveLength(2);
    },
  );
});

/* ---------------------- What the steps read and write ---------------------- */

/*
 * A step reads and writes as the workflow's principal: a Project Admin of
 * the project, never root (WorkflowPrincipal). A column it may not read
 * through a relation - an incident's custom fields or its Private flag,
 * through a note - is refused when the step runs, so every select, query
 * and write of these templates is put to the same checks the database
 * puts it to, as that principal.
 */
const MODELS: Array<[string, { new (): BaseModel }]> = [
  ["incident-severity-", IncidentSeverity],
  ["incident-state-timeline-", IncidentStateTimeline],
  ["incident-state-", IncidentState],
  ["incident-internal-note-", IncidentInternalNote],
  ["incident-", Incident],
  ["alert-severity-", AlertSeverity],
  ["alert-state-timeline-", AlertStateTimeline],
  ["alert-state-", AlertState],
  ["alert-internal-note-", AlertInternalNote],
  ["alert-", Alert],
];

function modelOf(metadataId: string): { new (): BaseModel } {
  const found: [string, { new (): BaseModel }] | undefined = MODELS.find(
    ([prefix]: [string, { new (): BaseModel }]): boolean => {
      return metadataId.startsWith(prefix);
    },
  );

  if (!found) {
    throw new Error(`No model for ${metadataId}`);
  }

  return found[1];
}

const PRINCIPAL: DatabaseCommonInteractionProps =
  WorkflowPrincipal.getPropsWithoutPlan({
    projectId: new ObjectID("11111111-2222-4333-8444-555555555555"),
    workflowId: new ObjectID("22222222-3333-4444-8555-666666666666"),
  });

function databaseSteps(): Array<[string, TemplateNodeSpec]> {
  return ZABBIX_IDS.flatMap(
    (templateId: string): Array<[string, TemplateNodeSpec]> => {
      return spec(templateId)
        .nodes.filter((candidate: TemplateNodeSpec): boolean => {
          return MODELS.some(([prefix]: [string, unknown]): boolean => {
            return candidate.metadataId.startsWith(prefix);
          });
        })
        .map((candidate: TemplateNodeSpec): [string, TemplateNodeSpec] => {
          return [templateId, candidate];
        });
    },
  );
}

function refusalOf(check: () => void): string | null {
  try {
    check();
    return null;
  } catch (error) {
    return (error as Error).message;
  }
}

describe("what the steps read and write, as the workflow's principal", () => {
  test("there is a database step to check in each template", () => {
    for (const templateId of ZABBIX_IDS) {
      expect(
        databaseSteps().some(([id]: [string, TemplateNodeSpec]): boolean => {
          return id === templateId;
        }),
      ).toBe(true);
    }
  });

  test("every select, a trigger's included, is one the principal may read, through every relation it reaches", () => {
    for (const [templateId, step] of databaseSteps()) {
      const select: JSONObject | undefined = step.args?.["select"] as
        | JSONObject
        | undefined;

      if (!select) {
        continue;
      }

      const modelType: { new (): BaseModel } = modelOf(step.metadataId);

      expect({
        step: `${templateId} ${step.componentId}`,
        refused: refusalOf((): void => {
          SelectPermission.checkSelectPermission(
            modelType,
            select as never,
            PRINCIPAL,
          );
          QueryPermission.checkRelationQueryPermission(
            modelType,
            {} as never,
            select as never,
            PRINCIPAL,
          );
        }),
      }).toEqual({ step: `${templateId} ${step.componentId}`, refused: null });
    }
  });

  test("so the note templates read the record by itself: its Private flag and custom fields are not readable through the note", () => {
    for (const [noteModel, select] of [
      [IncidentInternalNote, { incident: { isPrivate: true } }],
      [IncidentInternalNote, { incident: { customFields: true } }],
      [AlertInternalNote, { alert: { isPrivate: true } }],
      [AlertInternalNote, { alert: { customFields: true } }],
    ] as Array<[{ new (): BaseModel }, JSONObject]>) {
      expect(
        refusalOf((): void => {
          QueryPermission.checkRelationQueryPermission(
            noteModel,
            {} as never,
            select as never,
            PRINCIPAL,
          );
        }),
      ).toMatch(/does not support read on relation query/);
    }
  });

  test("every query asks only about columns the principal may read", () => {
    for (const [templateId, step] of databaseSteps()) {
      const query: JSONObject | undefined = step.args?.["query"] as
        | JSONObject
        | undefined;

      if (!query) {
        continue;
      }

      expect({
        step: `${templateId} ${step.componentId}`,
        refused: refusalOf((): void => {
          QueryPermission.checkQueryPermission(
            modelOf(step.metadataId),
            query as never,
            PRINCIPAL,
          );
        }),
      }).toEqual({ step: `${templateId} ${step.componentId}`, refused: null });
    }
  });

  /*
   * The records themselves are written by Incident and Alert From Another
   * Tool, through the records' own services, as the same principal: its
   * own suite (FromAnotherTool.test.ts) holds what it writes to the
   * principal's column permissions.
   */
  test("no Zabbix template writes a record through a Create One step any longer", () => {
    for (const [templateId, step] of databaseSteps()) {
      expect({
        step: `${templateId} ${step.componentId}`,
        writes: step.metadataId.endsWith("-create-one"),
      }).toEqual({ step: `${templateId} ${step.componentId}`, writes: false });
    }
  });
});

/* ------------------------------- On the canvas ------------------------------- */

interface Card {
  id: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/*
 * How tall the canvas draws these cards, at most, as measured in the
 * Builder: 192 px when a title takes two lines ("Find Many Incident
 * Severities"), and 218 px for a Page step whose card still asks for who
 * to page - which is how the template leaves it. The canvas's own default
 * height, 200 px, is shorter than both, and let a Page step lie over the
 * two steps under it. WorkflowBuilderZabbixCanvas.spec.ts (packages/E2E)
 * measures the cards the browser draws.
 */
const TALLEST_CARD: number = 192;
const TALLEST_PAGE_CARD: number = 218;

// What a connection needs under the card it leaves: it turns 20 px below it.
const ROOM_UNDER_A_CARD: number = 20;

// Each step as the canvas draws it: its width from its outputs, as Component.tsx does.
function cardsOf(graph: JSONObject): Array<Card> {
  return (graph["nodes"] as Array<JSONObject>).map(
    (built: JSONObject): Card => {
      const data: JSONObject = built["data"] as JSONObject;
      const position: { x: number; y: number } = built["position"] as {
        x: number;
        y: number;
      };
      const ports: Array<Port> = getComponentOutPorts({
        metadata: metadataOf(data["metadataId"] as string),
        arguments: data["arguments"] as JSONObject,
      });
      const width: number =
        getOutputLayout(
          ports.map((port: Port): string => {
            return port.title || "";
          }),
        ).widerCardWidth || WORKFLOW_NODE_WIDTH;

      return {
        id: data["id"] as string,
        left: position.x,
        top: position.y,
        right: position.x + width,
        bottom:
          position.y +
          (data["metadataId"] === ComponentID.PageOnCallPolicy
            ? TALLEST_PAGE_CARD
            : TALLEST_CARD),
      };
    },
  );
}

function graphOf(templateId: string): JSONObject {
  let counter: number = 0;

  return buildGraphForTemplate(templateId, (): string => {
    counter++;
    return `layout-${counter}`;
  }) as JSONObject;
}

describe("the Zabbix templates on the canvas", () => {
  test.each(ZABBIX_IDS)(
    "%s: no card lies on another, and each leaves room under it for the connections it starts",
    (templateId: string) => {
      const cards: Array<Card> = cardsOf(graphOf(templateId));
      const tooClose: Array<string> = [];

      cards.forEach((card: Card, index: number): void => {
        for (const other of cards.slice(index + 1)) {
          const sideBySide: boolean =
            card.left < other.right && other.left < card.right;
          const gap: number = Math.max(
            other.top - card.bottom,
            card.top - other.bottom,
          );

          if (sideBySide && gap < ROOM_UNDER_A_CARD) {
            tooClose.push(`${card.id} and ${other.id}: ${gap}`);
          }
        }
      });

      expect(tooClose).toEqual([]);
    },
  );

  test.each(ZABBIX_IDS)(
    "%s: the trigger is the top card, and every step is below the one it follows",
    (templateId: string) => {
      const graph: JSONObject = graphOf(templateId);
      const cards: Array<Card> = cardsOf(graph);
      const byNodeId: Map<string, Card> = new Map();

      (graph["nodes"] as Array<JSONObject>).forEach(
        (built: JSONObject, index: number): void => {
          byNodeId.set(built["id"] as string, cards[index] as Card);
        },
      );

      const top: number = Math.min(
        ...cards.map((card: Card): number => {
          return card.top;
        }),
      );

      expect(cards[0]?.top).toBe(top);
      expect(
        cards.filter((card: Card): boolean => {
          return card.top === top;
        }),
      ).toHaveLength(1);

      for (const edge of graph["edges"] as Array<JSONObject>) {
        const from: Card = byNodeId.get(edge["source"] as string) as Card;
        const to: Card = byNodeId.get(edge["target"] as string) as Card;

        expect({
          edge: `${from.id} to ${to.id}`,
          below: to.top > from.top,
        }).toEqual({ edge: `${from.id} to ${to.id}`, below: true });
      }
    },
  );

  test.each(ZABBIX_IDS)(
    "%s: one column, each connection running straight down from the output it leaves by",
    (templateId: string) => {
      const graph: JSONObject = graphOf(templateId);
      const cards: Array<Card> = cardsOf(graph);
      const byNodeId: Map<string, [Card, JSONObject]> = new Map();

      (graph["nodes"] as Array<JSONObject>).forEach(
        (built: JSONObject, index: number): void => {
          byNodeId.set(built["id"] as string, [cards[index] as Card, built]);
        },
      );

      for (const edge of graph["edges"] as Array<JSONObject>) {
        const [from, fromNode] = byNodeId.get(edge["source"] as string) as [
          Card,
          JSONObject,
        ];
        const [to] = byNodeId.get(edge["target"] as string) as [
          Card,
          JSONObject,
        ];
        const data: JSONObject = fromNode["data"] as JSONObject;
        const ports: Array<Port> = getComponentOutPorts({
          metadata: metadataOf(data["metadataId"] as string),
          arguments: data["arguments"] as JSONObject,
        });
        const index: number = ports.findIndex((port: Port): boolean => {
          return port.id === edge["sourceHandle"];
        });
        const dot: number =
          from.left + ((index + 0.5) / ports.length) * (from.right - from.left);
        const inDot: number = (to.left + to.right) / 2;

        expect({
          edge: `${from.id} to ${to.id}`,
          offBy: Math.abs(dot - inDot) <= 1 ? 0 : dot - inDot,
        }).toEqual({ edge: `${from.id} to ${to.id}`, offBy: 0 });
      }
    },
  );
});
