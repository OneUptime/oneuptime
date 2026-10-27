/*
 * The Zabbix templates, as the catalog holds them: the category the picker
 * shows, the six templates and what each asks for, the Zabbix URL and API
 * token their wizard takes, what they send Zabbix's API, their scripts,
 * what their steps read and write as the workflow's principal, and where
 * their cards lie on the canvas.
 *
 * What they do when they run is ZabbixTemplateSimulation's; what each
 * script decides is ZabbixTemplateScripts'. Templates.test.ts holds every
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
  ZabbixEventKind,
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
      return candidate.metadataId === ComponentID.JavaScriptCode;
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

  test("only the workflow that pages leaves something for the Builder: who to page", () => {
    for (const candidate of ZABBIX) {
      expect({
        id: candidate.id,
        setUpInBuilder: candidate.setUpInBuilder,
      }).toEqual({
        id: candidate.id,
        setUpInBuilder: PROBLEM_TEMPLATES.includes(candidate.id)
          ? "An on-call policy to page. You pick it in the Builder."
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

describe("what the templates send Zabbix's API", () => {
  const apiSteps: Array<[string, TemplateNodeSpec]> = ZABBIX_IDS.flatMap(
    (templateId: string): Array<[string, TemplateNodeSpec]> => {
      return spec(templateId)
        .nodes.filter((candidate: TemplateNodeSpec): boolean => {
          return candidate.metadataId === ComponentID.ApiPost;
        })
        .map((candidate: TemplateNodeSpec): [string, TemplateNodeSpec] => {
          return [templateId, candidate];
        });
    },
  );

  test("only the two that call Zabbix call it: an event.get and an event.acknowledge, or one event.acknowledge", () => {
    expect(
      apiSteps.map(([templateId, step]: [string, TemplateNodeSpec]): string => {
        const body: JSONObject = JSON.parse(
          String(step.args?.["request-body"]),
        ) as JSONObject;

        return `${templateId} ${step.componentId} ${String(body["method"])}`;
      }),
    ).toEqual([
      "zabbix-update-problem-on-incident-state get-problem-1 event.get",
      "zabbix-update-problem-on-incident-state update-problem-1 event.acknowledge",
      "zabbix-message-from-incident-private-note post-message-1 event.acknowledge",
      "zabbix-update-problem-on-alert-state get-problem-1 event.get",
      "zabbix-update-problem-on-alert-state update-problem-1 event.acknowledge",
      "zabbix-message-from-alert-private-note post-message-1 event.acknowledge",
    ]);
  });

  test("each is a JSON-RPC 2.0 request to <Zabbix URL>/api_jsonrpc.php, with the token as a bearer token and never in the body", () => {
    for (const [, step] of apiSteps) {
      expect(step.args?.["url"]).toBe(
        "{{local.variables.zabbixUrl}}/api_jsonrpc.php",
      );
      expect(step.args?.["request-headers"]).toEqual({
        Authorization: "Bearer {{local.variables.zabbixApiToken}}",
      });

      const body: JSONObject = JSON.parse(
        String(step.args?.["request-body"]),
      ) as JSONObject;

      expect(Object.keys(body).sort()).toEqual([
        "id",
        "jsonrpc",
        "method",
        "params",
      ]);
      expect(body["jsonrpc"]).toBe("2.0");
    }
  });

  test("the request headers, where the token goes, are kept out of the run log", () => {
    const headers: Argument | undefined = metadataOf(
      ComponentID.ApiPost,
    ).arguments.find((argument: Argument): boolean => {
      return argument.id === "request-headers";
    });

    expect(headers?.isSensitive).toBe(true);
  });

  test("the token is read in the Authorization header and nowhere else", () => {
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
              `${ComponentID.ApiPost} request-headers`,
            );
          }
        }
      }
    }
  });

  test("the add-a-message call sends the message flag alone: a note acknowledges nothing", () => {
    for (const templateId of [
      "zabbix-message-from-incident-private-note",
      "zabbix-message-from-alert-private-note",
    ]) {
      const body: JSONObject = JSON.parse(
        String(node(templateId, "post-message-1").args?.["request-body"]),
      ) as JSONObject;

      expect((body["params"] as JSONObject)["action"]).toBe(
        String(ZABBIX_ACTION_MESSAGE),
      );
    }
  });

  test("event.get asks for what the choice needs: whether the problem is resolved or acknowledged, and whether its trigger may be closed by hand", () => {
    for (const templateId of [
      "zabbix-update-problem-on-incident-state",
      "zabbix-update-problem-on-alert-state",
    ]) {
      const body: JSONObject = JSON.parse(
        String(node(templateId, "get-problem-1").args?.["request-body"]),
      ) as JSONObject;

      expect(body["params"]).toEqual({
        eventids: [
          "{{local.components.plan-state-1.returnValues.returnValue.eventId}}",
        ],
        output: ["eventid", "r_eventid", "acknowledged"],
        selectRelatedObject: ["triggerid", "manual_close"],
      });
    }
  });

  test("the flags the scripts add up are Zabbix's: 1 closes, 2 acknowledges, 4 adds a message", () => {
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

  test("there are sixteen: three where Zabbix's events arrive, and five in the two that call Zabbix, for each kind", () => {
    expect(scripts).toHaveLength(16);
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
        componentId !== "choose-action-1"
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
    "%s starts from a Webhook, and takes a path for each event the media type names",
    (templateId: string) => {
      const trigger: TemplateNodeSpec = node(
        templateId,
        ZABBIX_WEBHOOK_COMPONENT_ID,
      );

      expect(trigger.metadataId).toBe(ComponentID.Webhook);
      expect(trigger.componentType).toBe(ComponentType.Trigger);

      const switchStep: TemplateNodeSpec = node(templateId, "switch-1");

      expect(switchStep.args?.["value"]).toBe(
        "{{local.components.read-event-1.returnValues.returnValue.kind}}",
      );
      expect(
        (switchStep.args?.["cases"] as Array<JSONObject>).map(
          (entry: JSONObject): unknown => {
            return entry["value"];
          },
        ),
      ).toEqual([
        ZabbixEventKind.Problem,
        ZabbixEventKind.Recovery,
        ZabbixEventKind.Update,
      ]);
    },
  );

  test.each(PROBLEM_TEMPLATES)(
    "%s pages for Zabbix's High and Disaster problems: severity 4 and up",
    (templateId: string) => {
      expect(node(templateId, "if-page-1").args).toEqual({
        "input-1-type": "number",
        "input-1":
          "{{local.components.read-event-1.returnValues.returnValue.severityNumber}}",
        operator: ">=",
        "input-2-type": "number",
        "input-2": String(ZABBIX_PAGE_FROM_SEVERITY),
      });
      expect(ZABBIX_SEVERITY_NAMES[ZABBIX_PAGE_FROM_SEVERITY]).toBe("High");
    },
  );

  test("every path finds the problem's record by the event ID its custom fields keep", () => {
    for (const templateId of PROBLEM_TEMPLATES) {
      const finds: Array<TemplateNodeSpec> = spec(templateId).nodes.filter(
        (candidate: TemplateNodeSpec): boolean => {
          return candidate.metadataId.endsWith("-find-one");
        },
      );

      expect(finds).toHaveLength(3);

      for (const find of finds) {
        expect(find.args?.["query"]).toEqual({
          customFields: {
            [ZABBIX_EVENT_ID_CUSTOM_FIELD]:
              "{{local.components.read-event-1.returnValues.returnValue.eventId}}",
          },
        });
      }
    }
  });
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

  test("every record written - a new incident or alert, a note, a state change - writes only columns the principal may set", () => {
    let writes: number = 0;

    for (const [templateId, step] of databaseSteps()) {
      if (!step.metadataId.endsWith("-create-one")) {
        continue;
      }

      writes++;

      const modelType: { new (): BaseModel } = modelOf(step.metadataId);
      const data: JSONObject = JSON.parse(String(step.args?.["json"]));

      expect({
        step: `${templateId} ${step.componentId}`,
        refused: refusalOf((): void => {
          TablePermission.checkTableLevelPermissions(
            modelType,
            PRINCIPAL,
            DatabaseRequestType.Create,
          );
          ColumnPermissions.checkDataColumnPermissions(
            modelType,
            data as never,
            PRINCIPAL,
            DatabaseRequestType.Create,
          );
        }),
      }).toEqual({ step: `${templateId} ${step.componentId}`, refused: null });
    }

    // Per kind: the record, its note, and two state changes.
    expect(writes).toBe(8);
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

  test.each(PROBLEM_TEMPLATES)(
    "%s: the three paths and what is ignored lie side by side, left to right as the Switch / Case's outputs",
    (templateId: string) => {
      const left: (componentId: string) => number = (
        componentId: string,
      ): number => {
        return node(templateId, componentId).position.x;
      };
      const r: string = templateId.includes("incident") ? "incident" : "alert";

      expect(left(`find-${r}-0`)).toBeLessThan(left(`find-${r}-1`));
      expect(left(`find-${r}-1`)).toBeLessThan(left(`find-${r}-2`));
      expect(left(`find-${r}-2`)).toBeLessThan(left("log-ignored"));
    },
  );
});
