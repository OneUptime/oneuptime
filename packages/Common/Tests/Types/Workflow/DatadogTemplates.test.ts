/*
 * The Datadog templates, as the picker lists them and as they are built:
 * their category, what each says and asks for, the five steps they are
 * made of and how those are wired, the setup their read step opens with,
 * and the read step itself, run in the workflow sandbox on what Datadog's
 * Webhooks integration posts with the payload that setup gives
 * (AlertingToolTemplateFixtures.datadogPostedBody).
 *
 * The read step decides what each notification means for the record:
 *
 *   Triggered, Re-Triggered    open it: titled after the monitor, at the
 *                              severity its priority maps to, paged for P1,
 *                              P2 and no priority (priorityNumber <= 2)
 *   Recovered                  resolve it, saying why, with a link
 *   Warn, No Data (and Re-)    a private note saying what the monitor is at
 *   Renotify, anything else    nothing
 *
 * and keeps what came from Datadog inert: its text placed as written, its
 * double braces broken up, a link written only to a Datadog site.
 *
 * Run end to end against a project, with paging, in
 * DatadogTemplateSimulation.
 */

import { JSONObject, JSONValue } from "../../../Types/JSON";
import ComponentID from "../../../Types/Workflow/ComponentID";
import { ComponentType } from "../../../Types/Workflow/Component";
import {
  ConditionOperator,
  ConditionValueType,
} from "../../../Types/Workflow/Components/Condition";
import {
  FROM_ANOTHER_TOOL_ARGUMENT_IDS,
  FROM_ANOTHER_TOOL_WORDS,
  FromAnotherToolAction,
  SEVERITY_POSITIONS,
  readWhatHappened,
} from "../../../Types/Workflow/Components/FromAnotherTool";
import {
  PAGE_ARGUMENT_IDS,
  PageAbout,
} from "../../../Types/Workflow/Components/OnCallPageSettings";
import IconProp from "../../../Types/Icon/IconProp";
import {
  DATADOG_ALERT_CYCLE_KEY_CUSTOM_FIELD,
  DATADOG_LINK_HOSTS,
  DATADOG_PAGE_UP_TO_PRIORITY,
  DATADOG_PRIORITIES,
  DATADOG_WEBHOOK_PAYLOAD,
  DatadogTransition,
  ONEUPTIME_SYNCED_FROM_DATADOG_MARKER,
  WorkflowTemplate,
  WorkflowTemplateCategories,
  WorkflowTemplateCategory,
  WorkflowTemplateOutline,
  buildGraphForTemplate,
  getTemplateGraphSpec,
  getWorkflowTemplate,
  getWorkflowTemplateCategoryInfo,
  getWorkflowTemplateOutline,
  getWorkflowTemplates,
  getWorkflowTemplatesByCategory,
} from "../../../Types/Workflow/Templates";
import {
  ALERT,
  ALERT_CYCLE_KEY,
  AlertingToolKind,
  DATADOG_LINK,
  INCIDENT,
  KINDS,
  READ_STEP,
  datadogPostedBody,
  runReadScript,
  scriptOf,
} from "./AlertingToolTemplateFixtures";
import { FastestRun, fastestRunAsync } from "../../Helpers/FastestRun";
import { describe, expect, jest, test } from "@jest/globals";

// The sandbox boots a fresh isolate for every script run.
jest.setTimeout(120000);

const FROM_DATADOG: string = ONEUPTIME_SYNCED_FROM_DATADOG_MARKER;
const IN_DATADOG: string = ` ([open it in Datadog](${DATADOG_LINK}))`;
const WORD_JOINER: string = "⁠";

interface SpecNode {
  componentId: string;
  metadataId: string;
  componentType: ComponentType;
  position: { x: number; y: number };
  args?: JSONObject | undefined;
}

interface SpecEdge {
  fromComponentId: string;
  toComponentId: string;
  fromPort: string;
}

interface Spec {
  nodes: Array<SpecNode>;
  edges: Array<SpecEdge>;
}

const specOf: (templateId: string) => Spec = (templateId: string): Spec => {
  return getTemplateGraphSpec(templateId) as unknown as Spec;
};

const nodeOf: (templateId: string, componentId: string) => SpecNode = (
  templateId: string,
  componentId: string,
): SpecNode => {
  const node: SpecNode | undefined = specOf(templateId).nodes.find(
    (candidate: SpecNode): boolean => {
      return candidate.componentId === componentId;
    },
  );

  if (!node) {
    throw new Error(`${templateId} has no step ${componentId}.`);
  }

  return node;
};

const templateOf: (templateId: string) => WorkflowTemplate = (
  templateId: string,
): WorkflowTemplate => {
  const template: WorkflowTemplate | null = getWorkflowTemplate(templateId);

  if (!template) {
    throw new Error(`There is no template ${templateId}.`);
  }

  return template;
};

// A value the read step returns, as the steps after it refer to it.
const readValue: (key: string) => string = (key: string): string => {
  return `{{local.components.${READ_STEP}.returnValues.returnValue.${key}}}`;
};

// What the read step returns for a notification Datadog posted.
const read: (
  kind: AlertingToolKind,
  payload: JSONValue,
  options?: { asObject?: boolean; editCode?: (code: string) => string },
) => Promise<JSONObject> = async (
  kind: AlertingToolKind,
  payload: JSONValue,
  options?: { asObject?: boolean; editCode?: (code: string) => string },
): Promise<JSONObject> => {
  return await runReadScript({
    templateId: kind.datadogTemplateId,
    payload: payload,
    asObject: options?.asObject,
    editCode: options?.editCode,
  });
};

const textOf: (result: JSONObject, key: string) => string = (
  result: JSONObject,
  key: string,
): string => {
  const value: JSONValue | undefined = result[key];

  if (typeof value !== "string") {
    throw new Error(`${key} is not text: ${JSON.stringify(result)}`);
  }

  return value;
};

const withoutJoiners: (text: string) => string = (text: string): string => {
  return text.split(WORD_JOINER).join("");
};

const DATADOG_IDS: Array<string> = [
  INCIDENT.datadogTemplateId,
  ALERT.datadogTemplateId,
];

/* --------------------------------- The category --------------------------------- */

describe("the Datadog category", () => {
  test("sits after Zabbix in the picker, with New Relic after it and the general Integrations last", () => {
    const order: Array<WorkflowTemplateCategory> = [
      ...WorkflowTemplateCategories,
    ];
    const datadog: number = order.indexOf(WorkflowTemplateCategory.Datadog);

    expect(datadog).toBe(order.indexOf(WorkflowTemplateCategory.Zabbix) + 1);
    expect(order.indexOf(WorkflowTemplateCategory.NewRelic)).toBe(datadog + 1);
    expect(order.indexOf(WorkflowTemplateCategory.Integrations)).toBe(
      datadog + 2,
    );
    expect(order[order.length - 1]).toBe(WorkflowTemplateCategory.Integrations);
  });

  test("is labelled with the product's name, says what it is for in one line, and has a chart's icon", () => {
    expect(
      getWorkflowTemplateCategoryInfo(WorkflowTemplateCategory.Datadog),
    ).toEqual({
      category: WorkflowTemplateCategory.Datadog,
      label: "Datadog",
      description:
        "Open an incident or alert when a Datadog monitor triggers, and resolve it on recovery.",
      icon: IconProp.ChartBar,
    });
  });

  test("holds the incident template, then the alert one, and nothing outside it is named for Datadog", () => {
    expect(
      getWorkflowTemplatesByCategory(WorkflowTemplateCategory.Datadog).map(
        (template: WorkflowTemplate): string => {
          return template.id;
        },
      ),
    ).toEqual(DATADOG_IDS);

    for (const other of getWorkflowTemplates()) {
      if (other.category === WorkflowTemplateCategory.Datadog) {
        continue;
      }

      expect({
        id: other.id,
        named: `${other.id} ${other.name}`.toLowerCase().includes("datadog"),
      }).toEqual({ id: other.id, named: false });
    }
  });

  test("its templates are short enough to list without parts, so none is filed under one", () => {
    for (const templateId of DATADOG_IDS) {
      expect(templateOf(templateId).subcategory).toBeUndefined();
    }
  });
});

/* --------------------------------- Each template --------------------------------- */

describe.each(KINDS)("$datadogTemplateId", (kind: AlertingToolKind) => {
  const templateId: string = kind.datadogTemplateId;
  const r: string = kind.noun;

  test(`is named for what it does: ${kind.Created === "Declared" ? "declare" : "create"} an ${r} when a Datadog monitor triggers`, () => {
    const template: WorkflowTemplate = templateOf(templateId);

    expect(template.name).toBe(
      `${kind.Created === "Declared" ? "Declare" : "Create"} an ${r} when a Datadog monitor triggers`,
    );
    expect(template.description).toBe(
      `Pages on-call for P1 and P2 monitors, adds warnings as private notes, and resolves the ${r} when the monitor recovers.`,
    );
    expect(template.workflowName).toBe(`Datadog monitors to ${r}s`);
    expect(template.icon).toBe(IconProp.ChartBar);
    expect(template.category).toBe(WorkflowTemplateCategory.Datadog);
  });

  test("tells the person who creates it where to look next: the trigger's URL, and the step that says what to paste into Datadog", () => {
    expect(templateOf(templateId).teaches).toBe(
      "How one step follows a Datadog monitor from the moment it triggers until it recovers. Open the trigger for its URL, and the step after it for what to paste into Datadog.",
    );
  });

  test("says, for as long as the workflow exists, everything it does", () => {
    const description: string = templateOf(templateId).workflowDescription;

    expect(description).toContain("when a Datadog monitor");
    expect(description).toContain("P1 and P2 monitors");
    expect(description).toContain("monitors with no priority");
    expect(description).toContain("Warn and No Data notifications");
    expect(description).toContain(`resolves the ${r}`);
    // An incident is kept off status pages: another tool's text was not written for customers.
    expect(description.includes("kept off status pages")).toBe(
      kind === INCIDENT,
    );
  });

  test("asks for nothing to fill in: the URL is the trigger's own, and nothing is left for the Builder", () => {
    const template: WorkflowTemplate = templateOf(templateId);

    expect(template.variables).toEqual([]);
    expect(template.oauth2Variables).toBeUndefined();
    expect(template.setUpInBuilder).toBeUndefined();
  });

  test("asks who to page for P1 and P2 monitors, and lets nobody be picked, which leaves the If / Else out with the Page step", () => {
    expect(templateOf(templateId).whoToPage).toEqual([
      {
        componentId: "page-on-call-policy-1",
        title: "Who to page for P1 and P2 monitors",
        description: `The on-call policies paged for a new ${r} from a P1 or P2 monitor, or one with no priority. Leave it empty to page nobody.`,
        required: false,
        leftOutWhenNobody: ["if-page-1"],
      },
    ]);
  });

  test("is five steps, one under the other: the Webhook, the read step, the record step, the If / Else and the Page step", () => {
    const spec: Spec = specOf(templateId);

    expect(
      spec.nodes.map((node: SpecNode): string => {
        return `${node.componentId} ${node.metadataId} ${node.componentType}`;
      }),
    ).toEqual([
      `webhook-1 ${ComponentID.Webhook} ${ComponentType.Trigger}`,
      `${READ_STEP} ${ComponentID.JavaScriptCheck} ${ComponentType.Component}`,
      `${kind.step} ${kind.noun}-from-another-tool ${ComponentType.Component}`,
      `if-page-1 ${ComponentID.IfElse} ${ComponentType.Component}`,
      `page-on-call-policy-1 ${ComponentID.PageOnCallPolicy} ${ComponentType.Component}`,
    ]);

    // Each step a row below the one before it, in one column.
    const ys: Array<number> = spec.nodes.map((node: SpecNode): number => {
      return node.position.y;
    });

    expect([...ys].sort((a: number, b: number): number => {
      return a - b;
    })).toEqual(ys);
    expect(new Set(ys).size).toBe(ys.length);
  });

  test("goes on from each step by the way that works: the read step's Yes, a new record, the If / Else's Yes", () => {
    expect(
      specOf(templateId).edges.map((edge: SpecEdge): string => {
        return `${edge.fromComponentId} -${edge.fromPort}-> ${edge.toComponentId}`;
      }),
    ).toEqual([
      `webhook-1 -out-> ${READ_STEP}`,
      `${READ_STEP} -yes-> ${kind.step}`,
      `${kind.step} -opened-> if-page-1`,
      "if-page-1 -yes-> page-on-call-policy-1",
    ]);
  });

  test("hands the read step what Datadog posted, as the request's body", () => {
    const args: JSONObject = nodeOf(templateId, READ_STEP).args || {};

    expect(JSON.parse(String(args["arguments"]))).toEqual({
      payload: "{{local.components.webhook-1.returnValues.request-body}}",
    });
  });

  test("keeps one record per alert, by its cycle key, with everything else the read step returns", () => {
    const ids: typeof FROM_ANOTHER_TOOL_ARGUMENT_IDS =
      FROM_ANOTHER_TOOL_ARGUMENT_IDS;

    expect(nodeOf(templateId, kind.step).args).toEqual({
      [ids.whatHappened]: readValue("whatHappened"),
      [ids.outsideId]: readValue("alertCycleKey"),
      [ids.outsideIdField]: DATADOG_ALERT_CYCLE_KEY_CUSTOM_FIELD,
      [ids.title]: readValue("title"),
      [ids.description]: readValue("description"),
      [ids.severity]: readValue("severity"),
      [ids.note]: readValue("note"),
      [ids.reason]: readValue("reason"),
    });
    expect(DATADOG_ALERT_CYCLE_KEY_CUSTOM_FIELD).toBe("datadogAlertCycleKey");
  });

  test("pages only for a new record whose monitor is P1 or P2, or has no priority: priorityNumber at most 2", () => {
    expect(nodeOf(templateId, "if-page-1").args).toEqual({
      "input-1-type": ConditionValueType.Number,
      "input-1": readValue("priorityNumber"),
      operator: ConditionOperator.LessThanOrEqualTo,
      "input-2-type": ConditionValueType.Number,
      "input-2": "2",
    });
    expect(DATADOG_PAGE_UP_TO_PRIORITY).toBe(2);
  });

  test(`pages about the ${r} the record step ${kind === INCIDENT ? "opened" : "created"}, and leaves who to page to the wizard`, () => {
    const record: string = `{{local.components.${kind.step}.returnValues.record._id}}`;

    expect(nodeOf(templateId, "page-on-call-policy-1").args).toEqual(
      kind === INCIDENT
        ? {
            [PAGE_ARGUMENT_IDS.about]: PageAbout.Incident,
            [PAGE_ARGUMENT_IDS.incidentId]: record,
          }
        : {
            [PAGE_ARGUMENT_IDS.about]: PageAbout.Alert,
            [PAGE_ARGUMENT_IDS.alertId]: record,
          },
    );
  });

  test("built with a policy picked, the Page step pages it; built with nobody, the If / Else and the Page step are left out", () => {
    let generated: number = 0;
    const generateId: () => string = (): string => {
      generated++;
      return `datadog-${generated}`;
    };
    const policy: string = "7b1c2d3e-0000-4000-8000-000000000001";
    const withPolicy: JSONObject = buildGraphForTemplate(templateId, generateId, {
      "page-on-call-policy-1": [policy],
    }) as JSONObject;
    const withNobody: JSONObject = buildGraphForTemplate(
      templateId,
      generateId,
      {},
    ) as JSONObject;
    const stepsOf: (graph: JSONObject) => Array<string> = (
      graph: JSONObject,
    ): Array<string> => {
      return (graph["nodes"] as Array<JSONObject>).map(
        (node: JSONObject): string => {
          return String((node["data"] as JSONObject)["id"]);
        },
      );
    };
    const page: JSONObject | undefined = (
      withPolicy["nodes"] as Array<JSONObject>
    ).find((node: JSONObject): boolean => {
      return (node["data"] as JSONObject)["id"] === "page-on-call-policy-1";
    });

    expect(
      ((page?.["data"] as JSONObject)["arguments"] as JSONObject)[
        PAGE_ARGUMENT_IDS.onCallPolicies
      ],
    ).toEqual([policy]);
    expect(stepsOf(withNobody)).toEqual(["webhook-1", READ_STEP, kind.step]);
    expect((withNobody["edges"] as Array<JSONObject>).length).toBe(2);
  });

  test("its outline in the picker reads Webhook, then the check, the record step, the If / Else and the Page step", () => {
    expect(getWorkflowTemplateOutline(templateId)).toEqual({
      triggerComponentId: ComponentID.Webhook,
      stepComponentIds: [
        ComponentID.JavaScriptCheck,
        `${kind.noun}-from-another-tool`,
        ComponentID.IfElse,
        ComponentID.PageOnCallPolicy,
      ],
      blockCount: 5,
    } as WorkflowTemplateOutline);
  });
});

describe("the incident template's searchable words", () => {
  /*
   * "Alert" is what Datadog calls a monitor's notification, and what
   * OneUptime calls the lighter record. A search for "alert" is a search for
   * the templates that make OneUptime alerts, so the incident one says
   * "monitor" instead, in every place a search reads.
   */
  test("never say alert, so a search for alerts does not bring it back", () => {
    const template: WorkflowTemplate = templateOf(INCIDENT.datadogTemplateId);

    for (const words of [
      template.name,
      template.description,
      template.teaches,
      template.category,
      getWorkflowTemplateCategoryInfo(template.category).label,
    ]) {
      expect(words.toLowerCase()).not.toContain("alert");
    }
  });
});

/* ----------------------------- Setting Datadog up ----------------------------- */

// The read step's first lines, without their slashes: from its heading to the shared helpers.
const setUpOf: (templateId: string) => Array<string> = (
  templateId: string,
): Array<string> => {
  const code: string = scriptOf(templateId);
  const start: string = "// ---- Set up in Datadog ----\n";
  const end: string = "\n// ---- Shared by the Datadog templates ----";

  expect(code.startsWith(start)).toBe(true);

  return code
    .slice(start.length, code.indexOf(end))
    .trim()
    .split("\n")
    .map((line: string): string => {
      expect(line.startsWith("//")).toBe(true);
      return line.replace(/^\/\/ ?/, "");
    });
};

// The JSON the setup says to paste, read back.
const pastedPayloadOf: (templateId: string) => JSONValue = (
  templateId: string,
): JSONValue => {
  const lines: Array<string> = setUpOf(templateId);
  const first: number = lines.findIndex((line: string): boolean => {
    return line.trim() === "{";
  });
  const last: number = lines.findIndex((line: string): boolean => {
    return line.trim() === "}";
  });

  return JSON.parse(lines.slice(first, last + 1).join("\n")) as JSONValue;
};

describe.each(KINDS)(
  "$datadogTemplateId's read step opens with how to set Datadog up",
  (kind: AlertingToolKind) => {
    const templateId: string = kind.datadogTemplateId;

    test("first of all its lines, where the Builder shows it", () => {
      expect(scriptOf(templateId).split("\n")[0]).toBe(
        "// ---- Set up in Datadog ----",
      );
    });

    test("a webhook in Datadog's Webhooks integration, named oneuptime, sent this workflow's URL", () => {
      const text: string = setUpOf(templateId).join("\n");

      expect(text).toContain("Webhooks integration tile");
      expect(text).toContain("Name: oneuptime");
      expect(text).toContain("@webhook-oneuptime");
      expect(text).toContain("URL: this workflow's URL");
      expect(text).toContain("Copy URL");
    });

    test("and the payload to paste, as JSON that is the templates' own", () => {
      expect(pastedPayloadOf(templateId)).toEqual({
        ...DATADOG_WEBHOOK_PAYLOAD,
      });
    });

    test("then the message each monitor needs, to notify the webhook", () => {
      const lines: Array<string> = setUpOf(templateId);

      expect(lines[lines.length - 1]).toBe(
        "Then add @webhook-oneuptime to the message of each monitor that should reach OneUptime.",
      );
    });
  },
);

describe("the payload Datadog is given", () => {
  test("fills each key with one of Datadog's template variables", () => {
    for (const variable of Object.values(DATADOG_WEBHOOK_PAYLOAD)) {
      expect(variable).toMatch(/^\$[A-Z_]{2,40}$/);
    }

    expect(DATADOG_WEBHOOK_PAYLOAD).toEqual({
      alert_cycle_key: "$ALERT_CYCLE_KEY",
      transition: "$ALERT_TRANSITION",
      alert_priority: "$ALERT_PRIORITY",
      title: "$EVENT_TITLE",
      body: "$TEXT_ONLY_MSG",
      host: "$HOSTNAME",
      scope: "$ALERT_SCOPE",
      link: "$LINK",
    });
  });

  test("names every key the read step reads, and no key it does not", () => {
    for (const templateId of DATADOG_IDS) {
      const code: string = scriptOf(templateId);
      const read: Array<string> = Array.from(
        code.matchAll(/payload\.([a-z_]+)/g),
        (match: RegExpMatchArray): string => {
          return match[1] as string;
        },
      );

      expect([...new Set(read)].sort()).toEqual(
        Object.keys(DATADOG_WEBHOOK_PAYLOAD).sort(),
      );
    }
  });

  /*
   * The Datadog guide's payload, for the Incoming Request monitor, has
   * transition, title, body, host and link, filled from the same variables.
   * A webhook with both payloads' keys serves both.
   */
  test("shares the Datadog guide's keys with their meaning, and leaves its priority, Datadog's $PRIORITY, alone", () => {
    expect(DATADOG_WEBHOOK_PAYLOAD["transition"]).toBe("$ALERT_TRANSITION");
    expect(DATADOG_WEBHOOK_PAYLOAD["title"]).toBe("$EVENT_TITLE");
    expect(DATADOG_WEBHOOK_PAYLOAD["body"]).toBe("$TEXT_ONLY_MSG");
    expect(DATADOG_WEBHOOK_PAYLOAD["host"]).toBe("$HOSTNAME");
    expect(DATADOG_WEBHOOK_PAYLOAD["link"]).toBe("$LINK");
    expect(DATADOG_WEBHOOK_PAYLOAD["priority"]).toBeUndefined();
    expect(Object.values(DATADOG_WEBHOOK_PAYLOAD)).not.toContain("$PRIORITY");
  });

  test("lists Datadog's priorities and transitions as Datadog writes them", () => {
    expect([...DATADOG_PRIORITIES]).toEqual(["P1", "P2", "P3", "P4", "P5"]);
    expect(Object.values(DatadogTransition)).toEqual([
      "Triggered",
      "Re-Triggered",
      "Recovered",
      "Warn",
      "Re-Warn",
      "No Data",
      "Re-No Data",
      "Renotify",
    ]);
  });

  test("links only to Datadog's own sites", () => {
    expect([...DATADOG_LINK_HOSTS]).toEqual([
      "datadoghq.com",
      "datadoghq.eu",
      "ddog-gov.com",
    ]);
  });
});

describe("the Datadog scripts", () => {
  test("hold no double braces, so nothing in them is substituted before they run", () => {
    for (const templateId of DATADOG_IDS) {
      const code: string = scriptOf(templateId);

      expect(code).not.toContain("{{");
      expect(code).not.toContain("}}");
    }
  });

  test("differ only in the record they name", () => {
    expect(
      scriptOf(ALERT.datadogTemplateId)
        .split("alerts")
        .join("incidents")
        .split("alert")
        .join("incident")
        .split("creates")
        .join("opens")
        .split("Created from")
        .join("Declared from"),
    ).toBe(
      scriptOf(INCIDENT.datadogTemplateId)
        .split("alerts")
        .join("incidents")
        .split("alert")
        .join("incident"),
    );
  });
});

/* --------------------------------- The read step --------------------------------- */

describe.each(KINDS)("$datadogTemplateId's read step", (kind: AlertingToolKind) => {
  const r: string = kind.noun;

  /* ------------------------------- A new alert ------------------------------- */

  test(`a monitor that triggers opens the ${r}: titled after the monitor, at the severity its priority maps to, linked to Datadog`, async () => {
    expect(await read(kind, datadogPostedBody())).toEqual({
      proceed: true,
      whatHappened: "open",
      alertCycleKey: ALERT_CYCLE_KEY,
      title: "Datadog: High CPU on web-1",
      description: [
        `${kind.Created} from a Datadog monitor alert${IN_DATADOG}.`,
        "",
        "- Priority in Datadog: P1",
        "- Host: web-1",
        "- Scope: host:web-1",
        "",
        "CPU on web-1 has been above 90% for 5 minutes.",
        "",
        "Runbook: restart the checkout pods.",
      ].join("\n"),
      severity: "most severe",
      priority: "P1",
      priorityNumber: 1,
      note: "",
      reason: "",
    });
  });

  test.each([
    ["P1", "most severe", 1],
    ["P2", "most severe", 2],
    ["P3", "middle", 3],
    ["P4", "least severe", 4],
    ["P5", "least severe", 5],
    ["", "most severe", 0],
    ["p2", "most severe", 2],
    [" P3 ", "middle", 3],
    ["P6", "most severe", 0],
    ["normal", "most severe", 0],
    ["$ALERT_PRIORITY", "most severe", 0],
  ])(
    "a monitor of priority %p opens at the project's %s place, numbered %p for the If / Else",
    async (priority: string, place: string, priorityNumber: number) => {
      const result: JSONObject = await read(
        kind,
        datadogPostedBody({ priority: priority }),
      );

      expect(result["severity"]).toBe(place);
      expect(result["priorityNumber"]).toBe(priorityNumber);
      expect(result["priority"]).toBe(
        priorityNumber === 0 ? "" : `P${priorityNumber}`,
      );
      // Each place is one the record step reads as a place among the project's severities.
      expect(SEVERITY_POSITIONS as ReadonlyArray<string>).toContain(place);
      expect(
        String(result["description"]).split("\n")[2],
      ).toBe(
        `- Priority in Datadog: ${priorityNumber === 0 ? "none" : `P${priorityNumber}`}`,
      );
    },
  );

  test("paging follows from the number: P1, P2 and no priority are at most 2, and P3 to P5 are not", async () => {
    const paged: Array<string> = [];

    for (const priority of ["", ...DATADOG_PRIORITIES]) {
      const result: JSONObject = await read(
        kind,
        datadogPostedBody({ priority: priority }),
      );

      if (Number(result["priorityNumber"]) <= DATADOG_PAGE_UP_TO_PRIORITY) {
        paged.push(priority || "no priority");
      }
    }

    expect(paged).toEqual(["no priority", "P1", "P2"]);
  });

  test(`Re-Triggered opens the ${r} too: the record step opens one only when the alert has none`, async () => {
    const result: JSONObject = await read(
      kind,
      datadogPostedBody({ transition: DatadogTransition.ReTriggered }),
    );

    expect(result["whatHappened"]).toBe("open");
    expect(result["title"]).toBe("Datadog: High CPU on web-1");
  });

  test.each([
    ["[P2] [Triggered on {host:web-1}] High CPU", "High CPU"],
    ["[Triggered on {host:web-1}] High CPU", "High CPU"],
    ["[Triggered] High CPU", "High CPU"],
    ["[Re-Triggered on {host:web-1}] High CPU", "High CPU"],
    ["[P1] [Re-Triggered] High CPU", "High CPU"],
    // A monitor whose own name starts with brackets keeps them.
    ["[Triggered] [prod] High CPU", "[prod] High CPU"],
    ["[prod] High CPU", "[prod] High CPU"],
    ["High CPU", "High CPU"],
    // A title that is nothing but what Datadog starts it with is kept whole.
    ["[P1] [Triggered]", "[P1] [Triggered]"],
  ])(
    "the title %p becomes %p: what Datadog starts it with is left out, and nothing else",
    async (title: string, name: string) => {
      const result: JSONObject = await read(
        kind,
        datadogPostedBody({ title: title }),
      );

      expect(withoutJoiners(textOf(result, "title"))).toBe(`Datadog: ${name}`);
    },
  );

  test(`a notification with no title names the ${r} by its alert cycle key`, async () => {
    const result: JSONObject = await read(kind, datadogPostedBody({ title: "" }));

    expect(result["title"]).toBe(`Datadog: Monitor alert ${ALERT_CYCLE_KEY}`);
  });

  test("a notification with no host, scope or message leaves those lines out", async () => {
    const result: JSONObject = await read(
      kind,
      datadogPostedBody({ host: "", scope: "", body: "", priority: "" }),
    );

    expect(result["description"]).toBe(
      [
        `${kind.Created} from a Datadog monitor alert${IN_DATADOG}.`,
        "",
        "- Priority in Datadog: none",
      ].join("\n"),
    );
  });

  test("a monitor of many groups is described by the tags of the group that alerted", async () => {
    const result: JSONObject = await read(
      kind,
      datadogPostedBody({ scope: "availability-zone:us-east-1a,role:api" }),
    );

    expect(String(result["description"])).toContain(
      "- Scope: availability-zone:us-east-1a,role:api",
    );
  });

  /* ------------------------------- Its recovery ------------------------------- */

  test(`Recovered resolves the ${r}, saying why on its timeline, with a link to the alert`, async () => {
    expect(
      await read(
        kind,
        datadogPostedBody({ transition: DatadogTransition.Recovered }),
      ),
    ).toEqual({
      proceed: true,
      whatHappened: "resolve",
      alertCycleKey: ALERT_CYCLE_KEY,
      title: "",
      description: "",
      severity: "",
      priority: "",
      priorityNumber: 0,
      note: "",
      reason: `${FROM_DATADOG}: the monitor recovered${IN_DATADOG}.`,
    });
  });

  test("a recovery with no link to a Datadog site still says why, without a link", async () => {
    const result: JSONObject = await read(
      kind,
      datadogPostedBody({
        transition: DatadogTransition.Recovered,
        link: "https://example.com/event",
      }),
    );

    expect(result["reason"]).toBe(`${FROM_DATADOG}: the monitor recovered.`);
  });

  /* ------------------------------ Warn and No Data ------------------------------ */

  test.each([
    [DatadogTransition.Warn, "is at Warn"],
    [DatadogTransition.ReWarn, "is at Warn again"],
    [DatadogTransition.NoData, "has no data"],
    [DatadogTransition.ReNoData, "still has no data"],
  ])(
    `%s adds a private note to the open ${r}, saying the monitor %s`,
    async (transition: string, now: string) => {
      expect(
        await read(kind, datadogPostedBody({ transition: transition })),
      ).toEqual({
        proceed: true,
        whatHappened: "note",
        alertCycleKey: ALERT_CYCLE_KEY,
        title: "",
        description: "",
        severity: "",
        priority: "",
        priorityNumber: 0,
        note: `${FROM_DATADOG}: the monitor ${now}${IN_DATADOG}.`,
        reason: "",
      });
    },
  );

  /* -------------------------------- Nothing to do -------------------------------- */

  test(`Renotify changes nothing: the alert is still open, and so is the ${r}`, async () => {
    expect(
      await read(
        kind,
        datadogPostedBody({ transition: DatadogTransition.Renotify }),
      ),
    ).toEqual({
      proceed: false,
      reason: `Datadog reminded that alert cycle ${ALERT_CYCLE_KEY} is still open, so nothing changed.`,
    });
  });

  test.each(["Muted", "Unmuted", "Something Datadog adds next year"])(
    `a transition the step does not know, %p, changes nothing, and says so`,
    async (transition: string) => {
      expect(
        await read(kind, datadogPostedBody({ transition: transition })),
      ).toEqual({
        proceed: false,
        reason: `Datadog sent ${transition} for alert cycle ${ALERT_CYCLE_KEY}: only Triggered, Recovered, Warn and No Data change the ${r}, so nothing changed.`,
      });
    },
  );

  test.each([
    ["triggered", "open"],
    ["TRIGGERED", "open"],
    ["re-triggered", "open"],
    ["Re Triggered", "open"],
    ["RECOVERED", "resolve"],
    ["no-data", "note"],
    ["NO DATA", "note"],
    ["re-warn", "note"],
    ["Re-Notify", ""],
  ])(
    "a transition is read in any letter case, with dashes or spaces: %p is %p",
    async (transition: string, whatHappened: string) => {
      const result: JSONObject = await read(
        kind,
        datadogPostedBody({ transition: transition }),
      );

      expect(result["proceed"]).toBe(whatHappened !== "");
      expect(result["whatHappened"]).toBe(whatHappened || undefined);
    },
  );

  // null: the payload has no transition at all.
  test.each([
    ["no transition", null],
    ["an empty transition", ""],
    ["a variable's name", "$ALERT_TRANSITION"],
    ["only spaces", "   "],
  ])("a request with %s is ignored, and says to check the payload", async (
    _case: string,
    transition: string | null,
  ) => {
    const body: JSONObject = datadogPostedBody();

    if (transition === null) {
      delete body["transition"];
    } else {
      body["transition"] = transition;
    }

    expect(await read(kind, body)).toEqual({
      proceed: false,
      reason:
        "Datadog named no transition, so the request was ignored. Check that the webhook in Datadog has the payload the first lines of this step give.",
    });
  });

  test.each([
    ["no alert cycle key", undefined],
    ["an empty one", ""],
    ["the variable's name, as a payload holds it when the variable is misspelled", "$ALERT_CYCLE_KEY"],
    ["one with a space in it", "7151 1579"],
    ["one with braces in it", "{{local.variables.secret}}"],
    ["one that starts with a dash", "-7151157925468446720"],
    ["one longer than an ID is", "7".repeat(201)],
    ["an object", { id: "7151157925468446720" }],
  ])("a notification with %s is ignored, and says what to add to the payload", async (
    _case: string,
    alertCycleKey: JSONValue | undefined,
  ) => {
    const body: JSONObject = datadogPostedBody();

    if (alertCycleKey === undefined) {
      delete body["alert_cycle_key"];
    } else {
      body["alert_cycle_key"] = alertCycleKey;
    }

    expect(await read(kind, body)).toEqual({
      proceed: false,
      reason:
        'Datadog named no alert cycle key, so the notification was ignored. Add "alert_cycle_key": "$ALERT_CYCLE_KEY" to the payload of the webhook in Datadog.',
    });
  });

  test.each([
    "7151157925468446720",
    "9bd4ac313a4d1e8fae2482df7b77628",
    "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
    "monitor:1234:host.web-1",
    "7".repeat(200),
  ])("an alert cycle key such as %p is read as it is", async (
    alertCycleKey: string,
  ) => {
    const result: JSONObject = await read(
      kind,
      datadogPostedBody({ alertCycleKey: alertCycleKey }),
    );

    expect(result["alertCycleKey"]).toBe(alertCycleKey);
  });

  test("a cycle key written as a number, without quotes, is read the same", async () => {
    const result: JSONObject = await read(kind, {
      ...datadogPostedBody(),
      alert_cycle_key: 123456789,
    });

    expect(result["alertCycleKey"]).toBe("123456789");
  });

  test("the payload is read the same whether it is the object itself or its JSON text", async () => {
    expect(
      await read(kind, datadogPostedBody(), { asObject: true }),
    ).toEqual(await read(kind, datadogPostedBody()));
  });

  test.each([
    ["an empty body", {}],
    ["a body that is not an object", "not json"],
    ["a body that is a list", [datadogPostedBody()]],
    ["nothing at all", null],
  ])("%s is ignored", async (_case: string, payload: JSONValue) => {
    const result: JSONObject = await read(kind, payload);

    expect(result["proceed"]).toBe(false);
    expect(String(result["reason"])).toContain("Datadog named no transition");
  });

  /* -------------------------------- Links -------------------------------- */

  test.each([
    [
      "https://app.datadoghq.com/event/event?id=7151157925468446720",
      "https://app.datadoghq.com/event/event?id=7151157925468446720",
    ],
    [
      "https://app.datadoghq.com/monitors/1234?group=host%3Aweb-1&from_ts=1730000000000&to_ts=1730000600000",
      "https://app.datadoghq.com/monitors/1234?group=host%3Aweb-1&from_ts=1730000000000&to_ts=1730000600000",
    ],
    [
      "https://us3.datadoghq.com/event/event?id=1",
      "https://us3.datadoghq.com/event/event?id=1",
    ],
    [
      "https://us5.datadoghq.com/event/event?id=1",
      "https://us5.datadoghq.com/event/event?id=1",
    ],
    [
      "https://ap1.datadoghq.com/event/event?id=1",
      "https://ap1.datadoghq.com/event/event?id=1",
    ],
    [
      "https://app.datadoghq.eu/event/event?id=1",
      "https://app.datadoghq.eu/event/event?id=1",
    ],
    [
      "https://app.ddog-gov.com/event/event?id=1",
      "https://app.ddog-gov.com/event/event?id=1",
    ],
    [
      "https://acme.datadoghq.com/event/event?id=1#overview",
      "https://acme.datadoghq.com/event/event?id=1#overview",
    ],
    // The scheme and the host in lower case; the rest as Datadog wrote it.
    [
      "HTTPS://APP.DATADOGHQ.COM/event/event?id=1",
      "https://app.datadoghq.com/event/event?id=1",
    ],
    ["  https://datadoghq.com/event  ", "https://datadoghq.com/event"],
  ])(
    "a link to a Datadog site, %p, is linked as %p",
    async (link: string, linked: string) => {
      const result: JSONObject = await read(
        kind,
        datadogPostedBody({ link: link }),
      );

      expect(String(result["description"]).split("\n")[0]).toBe(
        `${kind.Created} from a Datadog monitor alert ([open it in Datadog](${linked})).`,
      );
    },
  );

  test.each([
    ["an http address", "http://app.datadoghq.com/event/event?id=1"],
    ["another site", "https://example.com/event?id=1"],
    ["a site that only starts like Datadog's", "https://datadoghq.com.example.com/event"],
    ["a site that only ends like Datadog's", "https://notdatadoghq.com/event"],
    ["a user name before the host", "https://user@app.datadoghq.com/event"],
    ["a port", "https://app.datadoghq.com:8443/event"],
    ["a parenthesis, which would end the link", "https://app.datadoghq.com/event)[x](https://example.com"],
    ["a space", "https://app.datadoghq.com/event id"],
    ["an angle bracket", "https://app.datadoghq.com/<b>"],
    ["a quote", "https://app.datadoghq.com/event\"title"],
    ["a script", "javascript:alert(1)"],
    ["no address at all", ""],
    ["an address too long to be a link", `https://app.datadoghq.com/${"a".repeat(1000)}`],
  ])("%s is not linked, and the description says the rest", async (
    _case: string,
    link: string,
  ) => {
    const result: JSONObject = await read(
      kind,
      datadogPostedBody({ link: link }),
    );

    expect(String(result["description"]).split("\n")[0]).toBe(
      `${kind.Created} from a Datadog monitor alert.`,
    );
    expect(String(result["description"])).not.toContain("](");
  });

  /* ---------------------------- Datadog's text, inert ---------------------------- */

  test("markup in the monitor's title, host, scope and message is written as text: nothing in it acts", async () => {
    const markup: string =
      "<!channel> ![x](https://example.com/x.png) [click](https://example.com) <b>bold</b>";
    const result: JSONObject = await read(
      kind,
      datadogPostedBody({
        title: `[P1] [Triggered] ${markup}`,
        host: markup,
        scope: markup,
        body: `${markup}\n\`\`\`mermaid\ngraph TD; a-->b\n\`\`\``,
      }),
    );
    const title: string = textOf(result, "title");
    const description: string = textOf(result, "description");

    // Read exactly as written, once the invisible joiners are taken out.
    expect(withoutJoiners(title)).toBe(`Datadog: ${markup}`);
    expect(withoutJoiners(description)).toContain(`- Host: ${markup}`);
    expect(withoutJoiners(description)).toContain(`- Scope: ${markup}`);
    expect(withoutJoiners(description)).toContain("```mermaid");

    for (const text of [title, description.split("\n").slice(1).join("\n")]) {
      // No "<" starts a tag or a mention, no image is fetched, no link is followed, no diagram drawn.
      expect(text).not.toMatch(/<[^\s⁠]/);
      expect(text).not.toContain("![");
      expect(text).not.toContain("](");
      expect(text.toLowerCase()).not.toContain("```mermaid");
    }
  });

  test("double braces Datadog sent are broken up, so no later step reads them as a reference", async () => {
    const result: JSONObject = await read(
      kind,
      datadogPostedBody({
        title: "[Triggered] {{local.variables.secret}}",
        host: "{{global.variables.token}}",
        body: "{{local.components.webhook-1.returnValues.request-headers}}",
      }),
    );

    for (const key of ["title", "description"]) {
      expect(textOf(result, key)).not.toContain("{{");
      expect(textOf(result, key)).not.toContain("}}");
    }

    expect(textOf(result, "title")).toBe(
      "Datadog: { {local.variables.secret} }",
    );
  });

  test("a value still holding a variable's name is read as none", async () => {
    const result: JSONObject = await read(
      kind,
      datadogPostedBody({
        host: "$HOSTNAME",
        scope: "$ALERT_SCOPE",
        body: "$TEXT_ONLY_MSG",
        link: "$LINK",
      }),
    );

    expect(result["description"]).toBe(
      [
        `${kind.Created} from a Datadog monitor alert.`,
        "",
        "- Priority in Datadog: P1",
      ].join("\n"),
    );
  });

  test("control characters JSON rejects are dropped from what Datadog sent", async () => {
    const result: JSONObject = await read(
      kind,
      datadogPostedBody({ title: "[Triggered] High\u0000 CPU\u0007", host: "web\u001b-1" }),
    );

    expect(result["title"]).toBe("Datadog: High CPU");
    expect(String(result["description"])).toContain("- Host: web-1");
  });

  /* -------------------------------- Editing it -------------------------------- */

  test("SEVERITY_BY_NAME opens a priority at a severity named, over the places", async () => {
    const result: JSONObject = await read(
      kind,
      datadogPostedBody({ priority: "P3" }),
      {
        editCode: (code: string): string => {
          return code.replace(
            "const SEVERITY_BY_NAME = {};",
            "const SEVERITY_BY_NAME = { P3: 'Minor Incident' };",
          );
        },
      },
    );

    expect(result["severity"]).toBe("Minor Incident");
    expect(result["priorityNumber"]).toBe(3);
  });

  test("NO_PRIORITY_PLACE moves a monitor with no priority to another place", async () => {
    const result: JSONObject = await read(
      kind,
      datadogPostedBody({ priority: "" }),
      {
        editCode: (code: string): string => {
          return code.replace(
            "const NO_PRIORITY_PLACE = 'most severe';",
            "const NO_PRIORITY_PLACE = 'middle';",
          );
        },
      },
    );

    expect(result["severity"]).toBe("middle");
  });

  /* ------------------------------- Every value read ------------------------------- */

  test("every value the next steps read is there, whatever happened, so none reaches them as a reference", async () => {
    const keys: Array<string> = [
      "whatHappened",
      "alertCycleKey",
      "title",
      "description",
      "severity",
      "priority",
      "priorityNumber",
      "note",
      "reason",
    ];

    for (const transition of [
      DatadogTransition.Triggered,
      DatadogTransition.Recovered,
      DatadogTransition.Warn,
    ]) {
      const result: JSONObject = await read(
        kind,
        datadogPostedBody({ transition: transition }),
      );

      expect(Object.keys(result).sort()).toEqual([...keys, "proceed"].sort());
    }
  });

  test("what happened is always one of the record step's own words", async () => {
    for (const transition of [
      DatadogTransition.Triggered,
      DatadogTransition.Recovered,
      DatadogTransition.NoData,
    ]) {
      const result: JSONObject = await read(
        kind,
        datadogPostedBody({ transition: transition }),
      );
      const word: string = String(result["whatHappened"]);

      expect(readWhatHappened(word).action).not.toBe(
        FromAnotherToolAction.MoveToState,
      );
      expect([
        ...FROM_ANOTHER_TOOL_WORDS[FromAnotherToolAction.Open],
        ...FROM_ANOTHER_TOOL_WORDS[FromAnotherToolAction.Resolve],
        ...FROM_ANOTHER_TOOL_WORDS[FromAnotherToolAction.Note],
      ]).toContain(word);
    }
  });
});

/* ------------------------------------ Time ------------------------------------ */

/*
 * A webhook's body can hold anything, megabytes on one line included. Each
 * value is cut to what the record keeps before it is placed, and every pass
 * over it is a loop, indexOf or a pattern that never looks back, so a long
 * value is read well inside the sandbox's own limit, and the title stays
 * within the record's 500 characters whatever the placing adds.
 */
describe("time", () => {
  const LIMIT_IN_MS: number = 3000;
  const SIZE: number = 100000;

  const repeatTo: (unit: string) => string = (unit: string): string => {
    return unit.repeat(Math.floor(SIZE / unit.length));
  };

  test.each([
    ["'<' before letters", repeatTo("<a")],
    ["images", repeatTo("![")],
    ["link tails", repeatTo("](")],
    ["fences", repeatTo("```mermaid\n")],
    ["spaces", `${repeatTo(" ")}x`],
    ["line breaks", `a${repeatTo("\n")}b`],
    ["braces", repeatTo("{{")],
  ])(
    "a notification whose every value is a long run of %s is read in linear time",
    async (_case: string, value: string) => {
      const timed: FastestRun<JSONObject> = await fastestRunAsync({
        run: async (): Promise<JSONObject> => {
          return await read(INCIDENT, {
            ...datadogPostedBody(),
            title: `[P1] [Triggered] ${value}`,
            body: value,
            host: value,
            scope: value,
            link: value,
          });
        },
        limitInMs: LIMIT_IN_MS,
      });

      expect(timed.inMs).toBeLessThan(LIMIT_IN_MS);
      expect(timed.result["whatHappened"]).toBe("open");
      expect(textOf(timed.result, "title").length).toBeLessThanOrEqual(500);
      expect(textOf(timed.result, "description").length).toBeLessThanOrEqual(
        20000,
      );
      expect(textOf(timed.result, "title")).not.toContain("{{");
      expect(textOf(timed.result, "description")).not.toContain("{{");
    },
  );

  test("a title full of what gets a joiner still fits the record's 500 characters, cut where it says so", async () => {
    const result: JSONObject = await read(
      ALERT,
      datadogPostedBody({ title: `[Triggered] ${"<!".repeat(400)}` }),
    );
    const title: string = textOf(result, "title");

    expect(title).toHaveLength(500);
    expect(title.endsWith("…")).toBe(true);
    expect(title).not.toMatch(/<[A-Za-z/!?]/);
  });
});
