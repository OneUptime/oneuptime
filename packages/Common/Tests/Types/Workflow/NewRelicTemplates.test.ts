/*
 * The New Relic templates, as the picker lists them and as they are built:
 * their category, what each says and asks for, the four steps they are
 * made of and how those are wired, the setup their read step opens with,
 * and the read step itself, run in the workflow sandbox on what a New
 * Relic workflow's webhook posts with the payload New Relic fills in by
 * default (AlertingToolTemplateFixtures.newRelicPostedBody).
 *
 * The read step decides what each notification means for the record:
 *
 *   ACTIVATED (or CREATED)      open it: titled after the issue, at the
 *                               severity its priority maps to - and every
 *                               new record pages
 *   ACTIVATED, acknowledged     acknowledge it, saying why
 *   CLOSED                      resolve it, saying why
 *   any other state             nothing
 *
 * and keeps what came from New Relic inert: its text placed as written,
 * its double braces broken up, a link written only to a New Relic site.
 *
 * Run end to end against a project, with paging, in
 * NewRelicTemplateSimulation.
 */

import { JSONObject, JSONValue } from "../../../Types/JSON";
import ComponentID from "../../../Types/Workflow/ComponentID";
import { ComponentType } from "../../../Types/Workflow/Component";
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
  NEW_RELIC_ISSUE_ID_CUSTOM_FIELD,
  NEW_RELIC_LINK_HOSTS,
  NEW_RELIC_PRIORITIES,
  NEW_RELIC_WEBHOOK_PAYLOAD_FIELDS,
  NewRelicIssueState,
  ONEUPTIME_SYNCED_FROM_NEW_RELIC_MARKER,
  WorkflowTemplate,
  WorkflowTemplateCategories,
  WorkflowTemplateCategory,
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
  AlertingToolKind,
  INCIDENT,
  ISSUE_ID,
  KINDS,
  NEW_RELIC_LINK,
  READ_STEP,
  newRelicPostedBody,
  runReadScript,
  scriptOf,
} from "./AlertingToolTemplateFixtures";
import { FastestRun, fastestRunAsync } from "../../Helpers/FastestRun";
import { describe, expect, jest, test } from "@jest/globals";

// The sandbox boots a fresh isolate for every script run.
jest.setTimeout(120000);

const FROM_NEW_RELIC: string = ONEUPTIME_SYNCED_FROM_NEW_RELIC_MARKER;
const IN_NEW_RELIC: string = ` ([open it in New Relic](${NEW_RELIC_LINK}))`;
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

// What the read step returns for a notification New Relic posted.
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
    templateId: kind.newRelicTemplateId,
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

const NEW_RELIC_IDS: Array<string> = [
  INCIDENT.newRelicTemplateId,
  ALERT.newRelicTemplateId,
];

/* --------------------------------- The category --------------------------------- */

describe("the New Relic category", () => {
  test("sits after Datadog in the picker, right before the general Integrations", () => {
    const order: Array<WorkflowTemplateCategory> = [
      ...WorkflowTemplateCategories,
    ];

    expect(order.indexOf(WorkflowTemplateCategory.NewRelic)).toBe(
      order.indexOf(WorkflowTemplateCategory.Datadog) + 1,
    );
    expect(order.indexOf(WorkflowTemplateCategory.Integrations)).toBe(
      order.indexOf(WorkflowTemplateCategory.NewRelic) + 1,
    );
  });

  test("is labelled with the product's name as New Relic writes it, says what it is for in one line, and has a pulse's icon", () => {
    expect(WorkflowTemplateCategory.NewRelic).toBe("New Relic");
    expect(
      getWorkflowTemplateCategoryInfo(WorkflowTemplateCategory.NewRelic),
    ).toEqual({
      category: WorkflowTemplateCategory.NewRelic,
      label: "New Relic",
      description:
        "Open an incident or alert for each New Relic issue, and resolve it when the issue closes.",
      icon: IconProp.Activity,
    });
  });

  test("holds the incident template, then the alert one, and nothing outside it is named for New Relic", () => {
    expect(
      getWorkflowTemplatesByCategory(WorkflowTemplateCategory.NewRelic).map(
        (template: WorkflowTemplate): string => {
          return template.id;
        },
      ),
    ).toEqual(NEW_RELIC_IDS);

    for (const other of getWorkflowTemplates()) {
      if (other.category === WorkflowTemplateCategory.NewRelic) {
        continue;
      }

      const named: string = `${other.id} ${other.name}`.toLowerCase();

      expect({
        id: other.id,
        named: named.includes("new relic") || named.includes("new-relic"),
      }).toEqual({ id: other.id, named: false });
    }
  });

  test("its templates are short enough to list without parts, so none is filed under one", () => {
    for (const templateId of NEW_RELIC_IDS) {
      expect(templateOf(templateId).subcategory).toBeUndefined();
    }
  });
});

/* --------------------------------- Each template --------------------------------- */

describe.each(KINDS)("$newRelicTemplateId", (kind: AlertingToolKind) => {
  const templateId: string = kind.newRelicTemplateId;
  const r: string = kind.noun;

  test(`is named for what it does: ${kind === INCIDENT ? "declare" : "create"} an ${r} for each New Relic issue`, () => {
    const template: WorkflowTemplate = templateOf(templateId);

    expect(template.name).toBe(
      `${kind === INCIDENT ? "Declare" : "Create"} an ${r} for each New Relic issue`,
    );
    expect(template.description).toBe(
      `Pages on-call for each new issue, acknowledges the ${r} when the issue is acknowledged, and resolves it when the issue closes.`,
    );
    expect(template.workflowName).toBe(`New Relic issues to ${r}s`);
    expect(template.icon).toBe(IconProp.Activity);
    expect(template.category).toBe(WorkflowTemplateCategory.NewRelic);
  });

  test("tells the person who creates it where to look next: the trigger's URL, and the step that says how to set New Relic up", () => {
    expect(templateOf(templateId).teaches).toBe(
      "How one step follows a New Relic issue from start to end, by its ID. Open the trigger for its URL, and the step after it for how to set up New Relic.",
    );
  });

  test("says, for as long as the workflow exists, everything it does", () => {
    const description: string = templateOf(templateId).workflowDescription;

    expect(description).toContain("for each New Relic issue");
    expect(description).toContain("pages the on-call policy you pick");
    expect(description).toContain(
      `Acknowledging the issue in New Relic acknowledges the ${r}`,
    );
    expect(description).toContain(`closing it resolves the ${r}`);
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

  test("asks who to page for new issues, and lets nobody be picked, which leaves the Page step out", () => {
    expect(templateOf(templateId).whoToPage).toEqual([
      {
        componentId: "page-on-call-policy-1",
        title: "Who to page for new New Relic issues",
        description: `The on-call policies paged for each new ${r} from a New Relic issue. Leave it empty to page nobody.`,
        required: false,
      },
    ]);
  });

  test("is four steps, one under the other: the Webhook, the read step, the record step and the Page step", () => {
    const spec: Spec = specOf(templateId);

    expect(
      spec.nodes.map((node: SpecNode): string => {
        return `${node.componentId} ${node.metadataId} ${node.componentType}`;
      }),
    ).toEqual([
      `webhook-1 ${ComponentID.Webhook} ${ComponentType.Trigger}`,
      `${READ_STEP} ${ComponentID.JavaScriptCheck} ${ComponentType.Component}`,
      `${kind.step} ${kind.noun}-from-another-tool ${ComponentType.Component}`,
      `page-on-call-policy-1 ${ComponentID.PageOnCallPolicy} ${ComponentType.Component}`,
    ]);

    const ys: Array<number> = spec.nodes.map((node: SpecNode): number => {
      return node.position.y;
    });

    expect(
      [...ys].sort((a: number, b: number): number => {
        return a - b;
      }),
    ).toEqual(ys);
    expect(new Set(ys).size).toBe(ys.length);
  });

  /*
   * New Relic raises an issue from HIGH to CRITICAL in place, on the same
   * issue, and the record step opens one record per issue: an If / Else on
   * CRITICAL in front of the Page step would never page for an issue that
   * opened at HIGH and got worse. So every new record pages, and the New
   * Relic workflow's filter decides which issues are sent.
   */
  test("pages for every new record, with no If / Else in front of the Page step", () => {
    expect(
      specOf(templateId).edges.map((edge: SpecEdge): string => {
        return `${edge.fromComponentId} -${edge.fromPort}-> ${edge.toComponentId}`;
      }),
    ).toEqual([
      `webhook-1 -out-> ${READ_STEP}`,
      `${READ_STEP} -yes-> ${kind.step}`,
      `${kind.step} -opened-> page-on-call-policy-1`,
    ]);
    expect(
      specOf(templateId).nodes.some((node: SpecNode): boolean => {
        return node.metadataId === ComponentID.IfElse;
      }),
    ).toBe(false);
  });

  test("hands the read step what New Relic posted, as the request's body", () => {
    const args: JSONObject = nodeOf(templateId, READ_STEP).args || {};

    expect(JSON.parse(String(args["arguments"]))).toEqual({
      payload: "{{local.components.webhook-1.returnValues.request-body}}",
    });
  });

  test("keeps one record per issue, by its ID, with everything else the read step returns", () => {
    const ids: typeof FROM_ANOTHER_TOOL_ARGUMENT_IDS =
      FROM_ANOTHER_TOOL_ARGUMENT_IDS;

    expect(nodeOf(templateId, kind.step).args).toEqual({
      [ids.whatHappened]: readValue("whatHappened"),
      [ids.outsideId]: readValue("issueId"),
      [ids.outsideIdField]: NEW_RELIC_ISSUE_ID_CUSTOM_FIELD,
      [ids.title]: readValue("title"),
      [ids.description]: readValue("description"),
      [ids.severity]: readValue("severity"),
      [ids.reason]: readValue("reason"),
    });
    expect(NEW_RELIC_ISSUE_ID_CUSTOM_FIELD).toBe("newRelicIssueId");
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

  test("built with a policy picked, the Page step pages it; built with nobody, the Page step is left out", () => {
    let generated: number = 0;
    const generateId: () => string = (): string => {
      generated++;
      return `new-relic-${generated}`;
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
    expect(
      (withNobody["nodes"] as Array<JSONObject>).map(
        (node: JSONObject): string => {
          return String((node["data"] as JSONObject)["id"]);
        },
      ),
    ).toEqual(["webhook-1", READ_STEP, kind.step]);
    expect((withNobody["edges"] as Array<JSONObject>).length).toBe(2);
  });

  test("its outline in the picker reads Webhook, then the check, the record step and the Page step", () => {
    expect(getWorkflowTemplateOutline(templateId)).toEqual({
      triggerComponentId: ComponentID.Webhook,
      stepComponentIds: [
        ComponentID.JavaScriptCheck,
        `${kind.noun}-from-another-tool`,
        ComponentID.PageOnCallPolicy,
      ],
      blockCount: 4,
    });
  });
});

describe("the incident template's searchable words", () => {
  test("never say alert, so a search for alerts does not bring it back", () => {
    const template: WorkflowTemplate = templateOf(INCIDENT.newRelicTemplateId);

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

/* ----------------------------- Setting New Relic up ----------------------------- */

// The read step's first lines, without their slashes: from its heading to the shared helpers.
const setUpOf: (templateId: string) => string = (templateId: string): string => {
  const code: string = scriptOf(templateId);
  const start: string = "// ---- Set up in New Relic ----\n";
  const end: string = "\n// ---- Shared by the New Relic templates ----";

  expect(code.startsWith(start)).toBe(true);

  return code
    .slice(start.length, code.indexOf(end))
    .trim()
    .split("\n")
    .map((line: string): string => {
      expect(line.startsWith("// ")).toBe(true);
      return line.slice(3);
    })
    .join(" ");
};

describe.each(KINDS)(
  "$newRelicTemplateId's read step opens with how to set New Relic up",
  (kind: AlertingToolKind) => {
    const templateId: string = kind.newRelicTemplateId;

    test("first of all its lines, where the Builder shows it", () => {
      expect(scriptOf(templateId).split("\n")[0]).toBe(
        "// ---- Set up in New Relic ----",
      );
    });

    test("a Webhook destination whose endpoint URL is this workflow's, notified by a New Relic workflow", () => {
      const text: string = setUpOf(templateId);

      expect(text).toContain("Alerts → Destinations");
      expect(text).toContain("Webhook destination");
      expect(text).toContain("this workflow's URL");
      expect(text).toContain("Copy URL");
      expect(text).toContain("Alerts → Workflows");
      expect(text).toContain("activated, acknowledged and closed");
      expect(text).toContain("Its filter decides which issues reach OneUptime");
    });

    test("names every field of New Relic's payload the step reads, and how to add isAcknowledged", () => {
      const text: string = setUpOf(templateId);

      for (const field of Object.keys(NEW_RELIC_WEBHOOK_PAYLOAD_FIELDS)) {
        expect({ field, named: text.includes(field) }).toEqual({
          field,
          named: true,
        });
      }

      expect(text).toContain(
        `To acknowledge the ${kind.noun} when someone acknowledges the issue in New Relic, add one more field`,
      );
      expect(text).toContain(
        "named isAcknowledged and filled from New Relic's isAcknowledged variable with the json helper.",
      );
    });
  },
);

describe("the payload New Relic posts", () => {
  test("is read by the fields New Relic's default payload fills in, and isAcknowledged", () => {
    expect(NEW_RELIC_WEBHOOK_PAYLOAD_FIELDS).toEqual({
      id: "issueId",
      issueUrl: "issuePageUrl",
      title: "annotations.title.[0]",
      priority: "priority",
      state: "state",
      isAcknowledged: "isAcknowledged",
      impactedEntities: "entitiesData.names",
      alertPolicyNames: "accumulations.policyName",
      alertConditionNames: "accumulations.conditionName",
    });
  });

  test("names every field the read step reads, and no field it does not", () => {
    for (const templateId of NEW_RELIC_IDS) {
      const read: Array<string> = Array.from(
        scriptOf(templateId).matchAll(/payload\.([A-Za-z]+)/g),
        (match: RegExpMatchArray): string => {
          return match[1] as string;
        },
      );

      expect([...new Set(read)].sort()).toEqual(
        Object.keys(NEW_RELIC_WEBHOOK_PAYLOAD_FIELDS).sort(),
      );
    }
  });

  test("lists New Relic's states and priorities as New Relic writes them", () => {
    expect(Object.values(NewRelicIssueState)).toEqual([
      "CREATED",
      "ACTIVATED",
      "CLOSED",
    ]);
    expect([...NEW_RELIC_PRIORITIES]).toEqual([
      "CRITICAL",
      "HIGH",
      "MEDIUM",
      "LOW",
    ]);
  });

  test("links only to New Relic's own sites", () => {
    expect([...NEW_RELIC_LINK_HOSTS]).toEqual(["newrelic.com"]);
  });
});

describe("the New Relic scripts", () => {
  test("hold no double braces, so nothing in them is substituted before they run", () => {
    for (const templateId of NEW_RELIC_IDS) {
      const code: string = scriptOf(templateId);

      expect(code).not.toContain("{{");
      expect(code).not.toContain("}}");
    }
  });

  test("differ only in the record they name", () => {
    expect(
      scriptOf(ALERT.newRelicTemplateId)
        .split("alerts")
        .join("incidents")
        .split("alert")
        .join("incident")
        .split("creates")
        .join("opens")
        .split("Created from")
        .join("Declared from"),
    ).toBe(
      scriptOf(INCIDENT.newRelicTemplateId)
        .split("alerts")
        .join("incidents")
        .split("alert")
        .join("incident"),
    );
  });

  test("carry the same helpers as the Datadog ones, but for the tool they name", () => {
    const helpersOf: (code: string) => string = (code: string): string => {
      return code.slice(
        code.indexOf("// ---- Placing text written outside OneUptime ----"),
        code.indexOf("// ---- What this step does ----"),
      );
    };

    expect(helpersOf(scriptOf(INCIDENT.newRelicTemplateId))).toBe(
      helpersOf(scriptOf(INCIDENT.datadogTemplateId)),
    );
  });
});

/* --------------------------------- The read step --------------------------------- */

describe.each(KINDS)("$newRelicTemplateId's read step", (kind: AlertingToolKind) => {
  const r: string = kind.noun;

  /* -------------------------------- A new issue -------------------------------- */

  test(`an activated issue opens the ${r}: titled after the issue, at the severity its priority maps to, linked to New Relic`, async () => {
    expect(await read(kind, newRelicPostedBody())).toEqual({
      proceed: true,
      whatHappened: "open",
      issueId: ISSUE_ID,
      title: "New Relic: High CPU on checkout-service",
      description: [
        `${kind.Created} from a New Relic issue${IN_NEW_RELIC}.`,
        "",
        "- Priority in New Relic: CRITICAL",
        "- Entities: checkout-service, checkout-db",
        "- Policies: Production",
        "- Conditions: CPU above 90%",
      ].join("\n"),
      severity: "most severe",
      priority: "CRITICAL",
      reason: "",
    });
  });

  test.each([
    ["CRITICAL", "most severe", "CRITICAL"],
    ["HIGH", "middle", "HIGH"],
    ["MEDIUM", "least severe", "MEDIUM"],
    ["LOW", "least severe", "LOW"],
    ["critical", "most severe", "CRITICAL"],
    [" High ", "middle", "HIGH"],
    ["", "most severe", ""],
    ["P1", "most severe", ""],
  ])(
    "an issue of priority %p opens at the project's %s place, read as %p",
    async (priority: string, place: string, readAs: string) => {
      const result: JSONObject = await read(
        kind,
        newRelicPostedBody({ priority: priority }),
      );

      expect(result["severity"]).toBe(place);
      expect(result["priority"]).toBe(readAs);
      expect(SEVERITY_POSITIONS as ReadonlyArray<string>).toContain(place);
      expect(String(result["description"]).split("\n")[2]).toBe(
        `- Priority in New Relic: ${readAs || "not sent"}`,
      );
    },
  );

  test(`a CREATED issue opens the ${r} as an activated one does: the record step opens one per issue, once`, async () => {
    expect(
      await read(kind, newRelicPostedBody({ state: NewRelicIssueState.Created })),
    ).toEqual(await read(kind, newRelicPostedBody()));
  });

  test("a state is read in any letter case", async () => {
    const result: JSONObject = await read(
      kind,
      newRelicPostedBody({ state: "activated" }),
    );

    expect(result["whatHappened"]).toBe("open");
    expect(
      (await read(kind, newRelicPostedBody({ state: "Closed" })))[
        "whatHappened"
      ],
    ).toBe("resolve");
  });

  test(`an issue with no title names the ${r} by its ID`, async () => {
    const result: JSONObject = await read(
      kind,
      newRelicPostedBody({ title: "" }),
    );

    expect(result["title"]).toBe(`New Relic: Issue ${ISSUE_ID}`);
  });

  test("an issue with no entities, policies or conditions leaves those lines out", async () => {
    const result: JSONObject = await read(
      kind,
      newRelicPostedBody({ entities: [], policies: [], conditions: [] }),
    );

    expect(result["description"]).toBe(
      [
        `${kind.Created} from a New Relic issue${IN_NEW_RELIC}.`,
        "",
        "- Priority in New Relic: CRITICAL",
      ].join("\n"),
    );
  });

  test("lists are read as lists: names that are empty are left out, and anything that is not a list is none", async () => {
    const result: JSONObject = await read(
      kind,
      newRelicPostedBody({
        entities: ["web-1", "", "  ", "web-2", 42],
        policies: "Production",
        conditions: null,
      }),
    );

    expect(result["description"]).toBe(
      [
        `${kind.Created} from a New Relic issue${IN_NEW_RELIC}.`,
        "",
        "- Priority in New Relic: CRITICAL",
        "- Entities: web-1, web-2, 42",
      ].join("\n"),
    );
  });

  test("a long list is cut to its first 50 names", async () => {
    const entities: Array<string> = Array.from(
      { length: 80 },
      (_value: unknown, index: number): string => {
        return `host-${index + 1}`;
      },
    );
    const result: JSONObject = await read(
      kind,
      newRelicPostedBody({ entities: entities }),
    );
    const line: string = String(result["description"])
      .split("\n")
      .find((candidate: string): boolean => {
        return candidate.startsWith("- Entities: ");
      }) as string;

    expect(line).toBe(`- Entities: ${entities.slice(0, 50).join(", ")}`);
  });

  /* ------------------------------ Acknowledged ------------------------------ */

  test.each([true, "true", "TRUE"])(
    `an activated issue someone acknowledged (isAcknowledged %p) acknowledges the ${r}, saying why`,
    async (isAcknowledged: JSONValue) => {
      expect(
        await read(
          kind,
          newRelicPostedBody({ isAcknowledged: isAcknowledged }),
        ),
      ).toEqual({
        proceed: true,
        whatHappened: "acknowledge",
        issueId: ISSUE_ID,
        title: "",
        description: "",
        severity: "",
        priority: "",
        reason: `${FROM_NEW_RELIC}: the issue was acknowledged${IN_NEW_RELIC}.`,
      });
    },
  );

  test.each([false, "false", null, 1, "yes"])(
    "an issue whose isAcknowledged is %p is not acknowledged: it opens, as a new one does",
    async (isAcknowledged: JSONValue) => {
      expect(
        (await read(kind, newRelicPostedBody({ isAcknowledged })))[
          "whatHappened"
        ],
      ).toBe("open");
    },
  );

  test("with New Relic's default payload, which has no isAcknowledged, an acknowledged issue still reads as open: the record step leaves an open record as it is", async () => {
    const body: JSONObject = newRelicPostedBody();

    expect(body["isAcknowledged"]).toBeUndefined();
    expect((await read(kind, body))["whatHappened"]).toBe("open");
  });

  /* --------------------------------- Closed --------------------------------- */

  test(`a closed issue resolves the ${r}, saying why on its timeline, with a link to the issue`, async () => {
    expect(
      await read(kind, newRelicPostedBody({ state: NewRelicIssueState.Closed })),
    ).toEqual({
      proceed: true,
      whatHappened: "resolve",
      issueId: ISSUE_ID,
      title: "",
      description: "",
      severity: "",
      priority: "",
      reason: `${FROM_NEW_RELIC}: the issue was closed${IN_NEW_RELIC}.`,
    });
  });

  test("a closed issue that was acknowledged is resolved: closed wins", async () => {
    expect(
      (
        await read(
          kind,
          newRelicPostedBody({
            state: NewRelicIssueState.Closed,
            isAcknowledged: true,
          }),
        )
      )["whatHappened"],
    ).toBe("resolve");
  });

  test("a close with no link to a New Relic site still says why, without a link", async () => {
    const result: JSONObject = await read(
      kind,
      newRelicPostedBody({
        state: NewRelicIssueState.Closed,
        issueUrl: "https://example.com/issues/1",
      }),
    );

    expect(result["reason"]).toBe(`${FROM_NEW_RELIC}: the issue was closed.`);
  });

  /* -------------------------------- Nothing to do -------------------------------- */

  test.each(["DEACTIVATED", "UPDATED", "something new"])(
    `an issue in a state the step does not know, %p, changes nothing, and says so`,
    async (state: string) => {
      expect(await read(kind, newRelicPostedBody({ state: state }))).toEqual({
        proceed: false,
        reason: `New Relic issue ${ISSUE_ID} is ${state.toUpperCase()}: only an activated, acknowledged or closed issue changes the ${r}, so nothing changed.`,
      });
    },
  );

  test("an issue with no state changes nothing, and says so", async () => {
    expect(await read(kind, newRelicPostedBody({ state: "" }))).toEqual({
      proceed: false,
      reason: `New Relic issue ${ISSUE_ID} is in no state: only an activated, acknowledged or closed issue changes the ${r}, so nothing changed.`,
    });
  });

  test.each([
    ["no issue ID", undefined],
    ["an empty one", ""],
    ["one with a space in it", "7d4a2e1c 3b5f"],
    ["one with braces in it", "{{local.variables.secret}}"],
    ["one longer than an ID is", "a".repeat(201)],
    ["a list", [ISSUE_ID]],
  ])("a request with %s is ignored, and says what to check", async (
    _case: string,
    issueId: JSONValue | undefined,
  ) => {
    const body: JSONObject = newRelicPostedBody();

    if (issueId === undefined) {
      delete body["id"];
    } else {
      body["id"] = issueId;
    }

    expect(await read(kind, body)).toEqual({
      proceed: false,
      reason:
        "New Relic named no issue ID, so the request was ignored. Check that the payload of the webhook in New Relic keeps its id field.",
    });
  });

  test.each([
    ["an empty body", {}],
    ["a body that is not an object", "not json"],
    ["nothing at all", null],
  ])("%s is ignored", async (_case: string, payload: JSONValue) => {
    const result: JSONObject = await read(kind, payload);

    expect(result["proceed"]).toBe(false);
    expect(String(result["reason"])).toContain("New Relic named no issue ID");
  });

  test("the payload is read the same whether it is the object itself or its JSON text", async () => {
    expect(
      await read(kind, newRelicPostedBody(), { asObject: true }),
    ).toEqual(await read(kind, newRelicPostedBody()));
  });

  /* -------------------------------- Links -------------------------------- */

  test.each([
    [
      NEW_RELIC_LINK,
      NEW_RELIC_LINK,
    ],
    [
      `https://radar-api.service.eu.newrelic.com/accounts/1234567/issues/${ISSUE_ID}?notifier=WEBHOOK`,
      `https://radar-api.service.eu.newrelic.com/accounts/1234567/issues/${ISSUE_ID}?notifier=WEBHOOK`,
    ],
    [
      "https://one.newrelic.com/alerts-ai/issues?pane=eyJuZXJkbGV0SWQiOiJhbGVydGluZy11aS1jbGFzc2ljLmlzc3VlcyJ9",
      "https://one.newrelic.com/alerts-ai/issues?pane=eyJuZXJkbGV0SWQiOiJhbGVydGluZy11aS1jbGFzc2ljLmlzc3VlcyJ9",
    ],
    [
      "https://one.eu.newrelic.com/alerts-ai/issues?filters=a%3Db&state=open",
      "https://one.eu.newrelic.com/alerts-ai/issues?filters=a%3Db&state=open",
    ],
    ["HTTPS://ONE.NEWRELIC.COM/alerts", "https://one.newrelic.com/alerts"],
  ])(
    "a link to a New Relic site, %p, is linked as %p",
    async (issueUrl: string, linked: string) => {
      const result: JSONObject = await read(
        kind,
        newRelicPostedBody({ issueUrl: issueUrl }),
      );

      expect(String(result["description"]).split("\n")[0]).toBe(
        `${kind.Created} from a New Relic issue ([open it in New Relic](${linked})).`,
      );
    },
  );

  test.each([
    ["an http address", "http://one.newrelic.com/alerts"],
    ["another site", "https://example.com/issues/1"],
    ["a site that only starts like New Relic's", "https://newrelic.com.example.com/x"],
    ["a site that only ends like New Relic's", "https://notnewrelic.com/x"],
    ["a user name before the host", "https://me@one.newrelic.com/x"],
    ["a parenthesis, which would end the link", "https://one.newrelic.com/x)(y"],
    ["a space", "https://one.newrelic.com/a b"],
    ["a script", "javascript:alert(1)"],
    ["no address at all", ""],
    ["an address that is not text", 12345],
  ])("%s is not linked, and the description says the rest", async (
    _case: string,
    issueUrl: JSONValue,
  ) => {
    const body: JSONObject = newRelicPostedBody();

    body["issueUrl"] = issueUrl;

    const result: JSONObject = await read(kind, body);

    expect(String(result["description"]).split("\n")[0]).toBe(
      `${kind.Created} from a New Relic issue.`,
    );
    expect(String(result["description"])).not.toContain("](");
  });

  /* -------------------------- New Relic's text, inert -------------------------- */

  test("markup in the issue's title, entities, policies and conditions is written as text: nothing in it acts", async () => {
    const markup: string =
      "<!channel> ![x](https://example.com/x.png) [click](https://example.com) <img src=x>";
    const result: JSONObject = await read(
      kind,
      newRelicPostedBody({
        title: markup,
        entities: [markup],
        policies: [markup],
        conditions: [markup],
      }),
    );
    const title: string = textOf(result, "title");
    const description: string = textOf(result, "description");

    expect(withoutJoiners(title)).toBe(`New Relic: ${markup}`);
    expect(withoutJoiners(description)).toContain(`- Entities: ${markup}`);
    expect(withoutJoiners(description)).toContain(`- Policies: ${markup}`);
    expect(withoutJoiners(description)).toContain(`- Conditions: ${markup}`);

    for (const text of [title, description.split("\n").slice(1).join("\n")]) {
      expect(text).not.toMatch(/<[^\s⁠]/);
      expect(text).not.toContain("![");
      expect(text).not.toContain("](");
    }
  });

  test("double braces New Relic sent are broken up, so no later step reads them as a reference", async () => {
    const result: JSONObject = await read(
      kind,
      newRelicPostedBody({
        title: "{{local.variables.secret}}",
        entities: ["{{global.variables.token}}"],
      }),
    );

    for (const key of ["title", "description"]) {
      expect(textOf(result, key)).not.toContain("{{");
      expect(textOf(result, key)).not.toContain("}}");
    }

    expect(result["title"]).toBe("New Relic: { {local.variables.secret} }");
  });

  /* -------------------------------- Editing it -------------------------------- */

  test("SEVERITY_BY_NAME opens a priority at a severity named, over the places", async () => {
    const result: JSONObject = await read(
      kind,
      newRelicPostedBody({ priority: "HIGH" }),
      {
        editCode: (code: string): string => {
          return code.replace(
            "const SEVERITY_BY_NAME = {};",
            "const SEVERITY_BY_NAME = { HIGH: 'Major Incident' };",
          );
        },
      },
    );

    expect(result["severity"]).toBe("Major Incident");
  });

  /* ------------------------------- Every value read ------------------------------- */

  test("every value the next steps read is there, whatever happened, so none reaches them as a reference", async () => {
    const keys: Array<string> = [
      "whatHappened",
      "issueId",
      "title",
      "description",
      "severity",
      "priority",
      "reason",
      "proceed",
    ];

    for (const props of [
      {},
      { isAcknowledged: true },
      { state: NewRelicIssueState.Closed },
    ]) {
      const result: JSONObject = await read(kind, newRelicPostedBody(props));

      expect(Object.keys(result).sort()).toEqual([...keys].sort());
    }
  });

  test("what happened is always one of the record step's own words", async () => {
    for (const props of [
      {},
      { isAcknowledged: true },
      { state: NewRelicIssueState.Closed },
    ]) {
      const word: string = String(
        (await read(kind, newRelicPostedBody(props)))["whatHappened"],
      );

      expect(readWhatHappened(word).action).not.toBe(
        FromAnotherToolAction.MoveToState,
      );
      expect([
        ...FROM_ANOTHER_TOOL_WORDS[FromAnotherToolAction.Open],
        ...FROM_ANOTHER_TOOL_WORDS[FromAnotherToolAction.Acknowledge],
        ...FROM_ANOTHER_TOOL_WORDS[FromAnotherToolAction.Resolve],
      ]).toContain(word);
    }
  });
});

/* ------------------------------------ Time ------------------------------------ */

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
    ["spaces", `${repeatTo(" ")}x`],
    ["line breaks", `a${repeatTo("\n")}b`],
    ["braces", repeatTo("{{")],
  ])(
    "a notification whose every value is a long run of %s is read in linear time",
    async (_case: string, value: string) => {
      const timed: FastestRun<JSONObject> = await fastestRunAsync({
        run: async (): Promise<JSONObject> => {
          return await read(
            ALERT,
            newRelicPostedBody({
              title: value,
              issueUrl: value,
              entities: [value, value],
              policies: [value],
              conditions: [value],
            }),
          );
        },
        limitInMs: LIMIT_IN_MS,
      });

      expect(timed.inMs).toBeLessThan(LIMIT_IN_MS);
      expect(timed.result["whatHappened"]).toBe("open");
      expect(textOf(timed.result, "title").length).toBeLessThanOrEqual(500);
      expect(textOf(timed.result, "description").length).toBeLessThanOrEqual(
        20000,
      );
      expect(textOf(timed.result, "description")).not.toContain("{{");
    },
  );

  test("a list of a hundred thousand names is read in linear time, to its first 50", async () => {
    const entities: Array<string> = Array.from(
      { length: SIZE },
      (_value: unknown, index: number): string => {
        return `host-${index}`;
      },
    );
    const timed: FastestRun<JSONObject> = await fastestRunAsync({
      run: async (): Promise<JSONObject> => {
        return await read(INCIDENT, newRelicPostedBody({ entities: entities }));
      },
      limitInMs: LIMIT_IN_MS,
    });

    expect(timed.inMs).toBeLessThan(LIMIT_IN_MS);
    expect(textOf(timed.result, "description")).toContain(
      `- Entities: ${entities.slice(0, 50).join(", ")}`,
    );
  });
});
