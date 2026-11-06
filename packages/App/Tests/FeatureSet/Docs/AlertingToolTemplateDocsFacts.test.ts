import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import {
  DATADOG,
  NEW_RELIC,
  OTHER_TOOL_VARIABLES,
  OVERVIEW,
  TEMPLATE_NAMES,
} from "./IntegrationsDocsPages";
import { scanMarkdown } from "./DocsContentSupport";
import {
  bold,
  codeIn,
  englishPage,
  englishSection,
  lineStartingWith,
  readRepoFile,
  tableWithHeader,
} from "./InventoryAndApiDocsSupport";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import ComponentID from "Common/Types/Workflow/ComponentID";
import {
  FROM_ANOTHER_TOOL_ARGUMENT_IDS,
  FROM_ANOTHER_TOOL_PORT_IDS,
  FromAnotherToolAction,
  pickSeverityIndex,
  readWhatHappened,
} from "Common/Types/Workflow/Components/FromAnotherTool";
import {
  DATADOG_ALERT_CYCLE_KEY_CUSTOM_FIELD,
  DATADOG_LINK_HOSTS,
  DATADOG_PAGE_UP_TO_PRIORITY,
  DATADOG_PRIORITIES,
  DATADOG_WEBHOOK_PAYLOAD,
  DatadogTransition,
  NEW_RELIC_ISSUE_ID_CUSTOM_FIELD,
  NEW_RELIC_LINK_HOSTS,
  NEW_RELIC_PRIORITIES,
  NEW_RELIC_WEBHOOK_PAYLOAD_FIELDS,
  NewRelicIssueState,
  WorkflowTemplate,
  WorkflowTemplateCategory,
  getTemplateGraphSpec,
  getWorkflowTemplateCategoryInfo,
  getWorkflowTemplatesByCategory,
} from "Common/Types/Workflow/Templates";
import {
  ALERT,
  ALERT_CYCLE_KEY,
  AlertingToolKind,
  INCIDENT,
  KINDS,
  READ_STEP,
  datadogPostedBody,
  datadogVariableValues,
  newRelicPostedBody,
  runReadScript,
  scriptOf,
} from "Common/Tests/Types/Workflow/AlertingToolTemplateFixtures";
import {
  ALERT as ZABBIX_ALERT,
  INCIDENT as ZABBIX_INCIDENT,
} from "Common/Tests/Types/Workflow/ZabbixTemplateFixtures";
import { describe, expect, it, jest } from "@jest/globals";

/*
 * What the Datadog and New Relic pages say about their workflow templates,
 * held to the templates. The page's payload is parsed and compared with what
 * the templates say to paste (DATADOG_WEBHOOK_PAYLOAD,
 * NEW_RELIC_WEBHOOK_PAYLOAD_FIELDS), the templates' names and the wizard's
 * question are read from the picker's own list, and every table that says what
 * a notification does is run: each of its rows goes through the template's real
 * read step, in the workflow sandbox, for the incident template and the alert
 * one.
 *
 * AlertingIntegrationsDocsFacts holds the Datadog page's Incoming Request
 * monitor, and IntegrationsDocsTranslations holds the 16 translations of both
 * pages to these English pages, line for line, so a fact that changes here
 * changes in every language with the English. The templates themselves, run
 * end to end, are in Common's DatadogTemplates, NewRelicTemplates and their
 * simulations.
 */

// The sandbox boots a fresh isolate for every script run.
jest.setTimeout(120000);

const WORD_JOINER: string = "⁠";
const CONFIGURE_DATADOG: string = "## Configure Datadog";
const CONFIGURE_NEW_RELIC: string = "## Configure New Relic";
const WHAT_THE_WORKFLOW_DOES: string = "### What the workflow does";
const PRIORITIES_AND_PAGING: string = "### Priorities and paging";
const TEST_IT: string = "## Test it";
const TROUBLESHOOTING: string = "## Troubleshooting";
const SEVERITY_BY_NAME_EMPTY: string = "const SEVERITY_BY_NAME = {};";

// A Datadog template variable: $ALERT_ID.
const DATADOG_VARIABLE: RegExp = /\$[A-Z_]+/g;
// The JSON a curl command posts: -d '{...}'.
const CURL_BODY: RegExp = /-d '(\{[\s\S]*\})'/;
// A field of New Relic's payload, as its template writes it: "id": {{ json issueId }},
const NEW_RELIC_PAYLOAD_LINE: RegExp =
  /^\s*"([A-Za-z]+)": \{\{ (?:(json) )?([^{}]+?) \}\},?$/;
// The severity example a page gives: `{ P3: 'Minor Incident' }`.
const SEVERITY_EXAMPLE: RegExp = /^\{ ([A-Z0-9]+): '([^']+)' \}$/;

interface SpecNode {
  componentId: string;
  metadataId: string;
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

interface NewRelicPayloadField {
  key: string;
  // Whether New Relic's json helper fills it.
  json: boolean;
  variable: string;
}

function specOf(templateId: string): Spec {
  return getTemplateGraphSpec(templateId) as unknown as Spec;
}

function nodeOf(templateId: string, componentId: string): SpecNode {
  const node: SpecNode | undefined = specOf(templateId).nodes.find(
    (candidate: SpecNode): boolean => {
      return candidate.componentId === componentId;
    },
  );

  if (!node) {
    throw new Error(`${templateId} has no step ${componentId}`);
  }

  return node;
}

function metadataIdsOf(templateId: string): Array<string> {
  return specOf(templateId).nodes.map((node: SpecNode): string => {
    return node.metadataId;
  });
}

// The only code block of a language in a section.
function fenceIn(section: string, language: string): string {
  const fences: Array<{ code: string }> = scanMarkdown(section).fences.filter(
    (fence: { lang: string }): boolean => {
      return fence.lang === language;
    },
  );

  if (fences.length !== 1) {
    throw new Error(
      `Expected one ${language} block in the section, found ${fences.length}`,
    );
  }

  return (fences[0] as { code: string }).code;
}

// The JSON the page's test sends, as the workflow receives it.
function testPayloadOf(page: string): JSONObject {
  const body: RegExpMatchArray | null = fenceIn(
    englishSection(page, TEST_IT),
    "bash",
  ).match(CURL_BODY);

  if (!body) {
    throw new Error("The page's test posts no JSON body");
  }

  return JSON.parse(body[1] as string) as JSONObject;
}

// What the read step's whatHappened means to the step after it.
function actionOf(result: JSONObject): FromAnotherToolAction {
  return readWhatHappened(result["whatHappened"]).action;
}

function withoutJoiners(text: unknown): string {
  return String(text).split(WORD_JOINER).join("");
}

// The severity a place among a new project's severities is, in a new project.
function severityInNewProject(kind: AlertingToolKind, place: string): string {
  const fixture: { severities: Array<JSONObject> } =
    kind === INCIDENT ? ZABBIX_INCIDENT : ZABBIX_ALERT;
  const severities: Array<{ id: string; name: string }> = [
    ...fixture.severities,
  ]
    .sort((a: JSONObject, b: JSONObject): number => {
      return Number(a["order"]) - Number(b["order"]);
    })
    .map((severity: JSONObject): { id: string; name: string } => {
      return { id: String(severity["_id"]), name: String(severity["name"]) };
    });

  return (
    severities[pickSeverityIndex({ given: place, severities }).index] as {
      name: string;
    }
  ).name;
}

function templatesOf(category: WorkflowTemplateCategory): Array<string> {
  return getWorkflowTemplatesByCategory(category).map(
    (template: WorkflowTemplate): string => {
      return template.name;
    },
  );
}

/* --------------------------------- Datadog --------------------------------- */

describe("the Datadog page's templates", () => {
  const page: string = englishPage(DATADOG);
  const templates: Array<WorkflowTemplate> = getWorkflowTemplatesByCategory(
    WorkflowTemplateCategory.Datadog,
  );

  it("names the two templates as the picker lists them, under the picker's category", () => {
    const names: Array<string> = templatesOf(WorkflowTemplateCategory.Datadog);

    expect(names).toEqual([
      "Declare an incident when a Datadog monitor triggers",
      "Create an alert when a Datadog monitor triggers",
    ]);
    expect(names).toEqual(TEMPLATE_NAMES[DATADOG]?.slice(0, 2));
    expect(
      getWorkflowTemplateCategoryInfo(WorkflowTemplateCategory.Datadog).label,
    ).toBe("Datadog");
    expect(page).toContain(
      `The ${bold("Create a workflow")} dialog has two Datadog templates, under ${bold("Datadog")} in its category list: ${bold(names[0] as string)}, and ${bold(names[1] as string)} for alerts.`,
    );
    expect(page).toContain(
      `choose ${bold("Datadog")} in the category list, click ${bold(names[0] as string)}, or ${bold(names[1] as string)}, and click ${bold("Use this template")}.`,
    );
  });

  it("asks who to page by the wizard's own question, which nobody need answer", () => {
    for (const template of templates) {
      const question: { title: string; required: boolean } = template
        .whoToPage?.[0] as { title: string; required: boolean };

      expect(question.title).toBe("Who to page for P1 and P2 monitors");
      expect(question.required).toBe(false);
      expect(TEMPLATE_NAMES[DATADOG]).toContain(question.title);
      expect(page).toContain(
        `Under ${bold(question.title)}, pick the on-call policies to page, or none to page nobody, and click ${bold("Create Workflow")}.`,
      );
    }
  });

  it("gets the URL from the Webhook trigger, and says a workflow that is off answers 400", () => {
    for (const kind of KINDS) {
      expect(nodeOf(kind.datadogTemplateId, "webhook-1").metadataId).toBe(
        ComponentID.Webhook,
      );
    }

    expect(
      readRepoFile("App/FeatureSet/Workflow/Services/QueueWorkflow.ts"),
    ).toContain("throw new BadDataException(WORKFLOW_TURNED_OFF_MESSAGE)");
    expect(page).toContain(
      `Click the ${bold("Webhook")} trigger, then ${bold("Copy URL")}, and keep the URL for Datadog.`,
    );
    expect(page).toContain(
      "A workflow that is off answers Datadog with `400`.",
    );
  });

  it("says the read step opens with the same setup, and it does", () => {
    for (const kind of KINDS) {
      const script: string = scriptOf(kind.datadogTemplateId);

      expect(script.split("\n")[0]).toBe("// ---- Set up in Datadog ----");
      expect(script).toContain("@webhook-oneuptime");
    }

    expect(page).toContain(
      `The workflow's \`${READ_STEP}\` step opens with the same setup`,
    );
    expect(page).toContain("@webhook-oneuptime");
  });

  it("no longer builds a workflow from scratch, or says a workflow does not resolve on recovery", () => {
    expect(page).not.toContain("Start from scratch");
    expect(page).not.toContain("Create One Incident");
    expect(page).not.toContain("does not resolve");
    expect(page).not.toContain("## Receive alerts with a workflow");
  });

  it("recommends the template first, and the monitor for a project without workflows", () => {
    const rows: Array<Array<string>> = tableWithHeader(
      englishSection(DATADOG, "## Choose how OneUptime receives alerts"),
      "Way",
    );

    expect(
      rows.map((row: Array<string>): string => {
        return row[0] as string;
      }),
    ).toEqual([
      "The workflow template (recommended)",
      "An Incoming Request monitor",
    ]);
    expect(rows[0]?.[1]).toContain("paged to on-call for P1 and P2");
    expect(rows[0]?.[1]).toContain("resolved on recovery");
    expect(rows[1]?.[1]).toContain("on any plan");
  });
});

describe("the Datadog page's payload", () => {
  const configure: () => string = (): string => {
    return englishSection(DATADOG, CONFIGURE_DATADOG);
  };
  const pagePayload: () => Record<string, string> = (): Record<
    string,
    string
  > => {
    return JSON.parse(fenceIn(configure(), "json")) as Record<string, string>;
  };

  // The page's payload, with each variable as Datadog fills it in.
  function filledPayload(values: Record<string, string>): JSONObject {
    const filled: JSONObject = {};

    for (const [key, template] of Object.entries(pagePayload())) {
      filled[key] = template.replace(
        DATADOG_VARIABLE,
        (variable: string): string => {
          const value: string | undefined = values[variable];

          if (value === undefined) {
            throw new Error(`No sample value for ${variable}`);
          }

          return value;
        },
      );
    }

    return filled;
  }

  it("quotes the template's payload: every key, with its variable", () => {
    const payload: Record<string, string> = pagePayload();

    for (const [key, variable] of Object.entries(DATADOG_WEBHOOK_PAYLOAD)) {
      expect({ key, written: payload[key] }).toEqual({
        key,
        written: variable,
      });
    }

    expect(payload["alert_cycle_key"]).toBe("$ALERT_CYCLE_KEY");
    expect(payload["alert_priority"]).toBe("$ALERT_PRIORITY");
  });

  it("keeps the keys only the Incoming Request monitor reads, so one payload serves both ways", () => {
    const payload: Record<string, string> = pagePayload();

    expect(
      Object.keys(payload)
        .filter((key: string): boolean => {
          return !(key in DATADOG_WEBHOOK_PAYLOAD);
        })
        .sort(),
    ).toEqual(["alert_key", "priority"]);
    expect(payload["alert_key"]).toBe("$ALERT_ID $ALERT_SCOPE");
    expect(payload["priority"]).toBe("$PRIORITY");
    expect(configure()).toContain(
      "One payload serves both ways: the template goes by `alert_cycle_key` and `alert_priority`, and the monitor by `alert_key`.",
    );
  });

  it("explains in its table the variables the template goes by", () => {
    const explained: Array<string> = tableWithHeader(
      configure(),
      "Variable",
    ).map((row: Array<string>): string => {
      return codeIn(row[0] as string)[0] as string;
    });

    expect(explained).toEqual(
      expect.arrayContaining(["$ALERT_CYCLE_KEY", "$ALERT_PRIORITY"]),
    );

    const priority: Array<string> = tableWithHeader(
      configure(),
      "Variable",
    ).find((row: Array<string>): boolean => {
      return row[0] === "`$ALERT_PRIORITY`";
    }) as Array<string>;

    expect(DATADOG_PRIORITIES[0]).toBe("P1");
    expect(DATADOG_PRIORITIES[DATADOG_PRIORITIES.length - 1]).toBe("P5");
    expect(priority[1]).toContain("`P1` to `P5`");
  });

  it.each(KINDS)(
    "$datadogTemplateId reads the page's payload as it reads its own: the keys the monitor reads change nothing",
    async (kind: AlertingToolKind) => {
      const filled: JSONObject = filledPayload({
        ...datadogVariableValues(),
        $ALERT_ID: "1234",
        $PRIORITY: "normal",
      });
      const result: JSONObject = await runReadScript({
        templateId: kind.datadogTemplateId,
        payload: filled,
      });

      expect(result["proceed"]).toBe(true);
      expect(result["alertCycleKey"]).toBe(ALERT_CYCLE_KEY);
      expect(result).toEqual(
        await runReadScript({
          templateId: kind.datadogTemplateId,
          payload: datadogPostedBody(),
        }),
      );
    },
  );

  it("names the custom field the template keeps the key in, as the template writes it", () => {
    for (const kind of KINDS) {
      expect(
        nodeOf(kind.datadogTemplateId, kind.step).args?.[
          FROM_ANOTHER_TOOL_ARGUMENT_IDS.outsideIdField
        ],
      ).toBe(DATADOG_ALERT_CYCLE_KEY_CUSTOM_FIELD);
    }

    expect(englishPage(DATADOG)).toContain(
      `The incident keeps the key in its custom field \`${DATADOG_ALERT_CYCLE_KEY_CUSTOM_FIELD}\`.`,
    );
  });
});

describe("what the Datadog page says each transition does", () => {
  const section: () => string = (): string => {
    return englishSection(DATADOG, WHAT_THE_WORKFLOW_DOES);
  };
  const rows: () => Array<Array<string>> = (): Array<Array<string>> => {
    return tableWithHeader(section(), "Transition");
  };

  // What each row's words say the step after the read step is told to do, or null for nothing.
  const ROW_ACTIONS: Array<[string, FromAnotherToolAction | null]> = [
    ["Declares an incident", FromAnotherToolAction.Open],
    ["Resolves the alert's incident", FromAnotherToolAction.Resolve],
    ["Adds a private note", FromAnotherToolAction.Note],
    ["Nothing", null],
  ];

  it("lists every transition Datadog names, once", () => {
    const listed: Array<string> = rows().flatMap(
      (row: Array<string>): Array<string> => {
        return codeIn(row[0] as string);
      },
    );

    expect([...listed].sort()).toEqual(
      [...Object.values(DatadogTransition)].sort(),
    );
    expect(rows()).toHaveLength(ROW_ACTIONS.length);
  });

  it.each(KINDS)(
    "$datadogTemplateId does with each transition what its row says",
    async (kind: AlertingToolKind) => {
      for (const [index, row] of rows().entries()) {
        const [words, action] = ROW_ACTIONS[index] as [
          string,
          FromAnotherToolAction | null,
        ];

        expect(row[1]).toContain(words);

        for (const transition of codeIn(row[0] as string)) {
          const result: JSONObject = await runReadScript({
            templateId: kind.datadogTemplateId,
            payload: datadogPostedBody({ transition }),
          });

          expect({
            transition,
            proceed: result["proceed"],
            action: action === null ? null : actionOf(result),
          }).toEqual({ transition, proceed: action !== null, action });
        }
      }
    },
  );

  it.each(KINDS)(
    "$datadogTemplateId titles a new record and describes it as the Triggered row says",
    async (kind: AlertingToolKind) => {
      const result: JSONObject = await runReadScript({
        templateId: kind.datadogTemplateId,
        payload: datadogPostedBody({ title: "[Triggered] High CPU" }),
      });
      const description: string = withoutJoiners(result["description"]);

      expect(withoutJoiners(result["title"])).toBe("Datadog: High CPU");
      expect(description).toContain("open it in Datadog");
      expect(description).toContain("- Priority in Datadog: P1");
      expect(description).toContain("- Host: web-1");
      expect(description).toContain("- Scope: host:web-1");
      expect(description).toContain("CPU on web-1");
    },
  );

  it("names the row's title as the template writes it, and what the steps are", () => {
    const text: string = section();

    expect(rows()[0]?.[1]).toContain("titled `Datadog: <monitor>`");
    expect(rows()[0]?.[1]).toContain("kept off your status pages");
    expect(nodeOf(INCIDENT.datadogTemplateId, READ_STEP).metadataId).toBe(
      ComponentID.JavaScriptCheck,
    );
    expect(nodeOf(INCIDENT.datadogTemplateId, INCIDENT.step).metadataId).toBe(
      ComponentID.IncidentFromAnotherTool,
    );
    expect(nodeOf(ALERT.datadogTemplateId, ALERT.step).metadataId).toBe(
      ComponentID.AlertFromAnotherTool,
    );
    expect(text).toContain(
      `the \`${READ_STEP}\` ${bold("Check With JavaScript")} step reads the \`transition\` Datadog sends, and ${bold("Incident From Another Tool")}, or ${bold("Alert From Another Tool")} in the alert template, does what it means, by the alert's cycle key.`,
    );
  });

  it("says nothing goes back to Datadog: the template's steps call nothing outside", () => {
    for (const kind of KINDS) {
      expect(metadataIdsOf(kind.datadogTemplateId)).toEqual([
        ComponentID.Webhook,
        ComponentID.JavaScriptCheck,
        kind === INCIDENT
          ? ComponentID.IncidentFromAnotherTool
          : ComponentID.AlertFromAnotherTool,
        ComponentID.IfElse,
        ComponentID.PageOnCallPolicy,
      ]);
    }

    expect(section()).toContain("Nothing goes back to Datadog");
  });
});

describe("what the Datadog page says about priorities and paging", () => {
  const section: () => string = (): string => {
    return englishSection(DATADOG, PRIORITIES_AND_PAGING);
  };
  const NO_PRIORITY: string = "No priority";

  it("lists every priority Datadog has, and no priority", () => {
    expect(
      tableWithHeader(section(), "Datadog priority")
        .map((row: Array<string>): string => {
          return row[0] as string;
        })
        .filter((cell: string): boolean => {
          return cell !== NO_PRIORITY;
        }),
    ).toEqual([...DATADOG_PRIORITIES]);
    expect(
      tableWithHeader(section(), "Datadog priority").some(
        (row: Array<string>): boolean => {
          return row[0] === NO_PRIORITY;
        },
      ),
    ).toBe(true);
  });

  it("maps each priority and pages as its table says, by the read step and the If / Else's limit", async () => {
    for (const row of tableWithHeader(section(), "Datadog priority")) {
      const priority: string = row[0] === NO_PRIORITY ? "" : (row[0] as string);
      const mapped: Array<string> = [];
      let priorityNumber: number = -1;

      for (const kind of [INCIDENT, ALERT]) {
        const result: JSONObject = await runReadScript({
          templateId: kind.datadogTemplateId,
          payload: datadogPostedBody({ priority }),
        });

        mapped.push(severityInNewProject(kind, String(result["severity"])));
        priorityNumber = Number(result["priorityNumber"]);
      }

      expect({
        priority: row[0],
        incident: mapped[0],
        alert: mapped[1],
        onCall:
          priorityNumber <= DATADOG_PAGE_UP_TO_PRIORITY ? "Paged" : "Not paged",
      }).toEqual({
        priority: row[0],
        incident: row[1],
        alert: row[2],
        onCall: row[3],
      });
    }
  });

  it("states the paging rule in words, and says what your own severities get", () => {
    expect(section()).toContain(
      "when its monitor is P1 or P2, or has no priority",
    );
    expect(section()).toContain(
      "P3, P4 and P5 open an incident and page nobody.",
    );
    expect(section()).toContain(
      "With severities of your own, P1, P2 and no priority go to your most severe, P3 to the middle one, and P4 and P5 to your least severe.",
    );

    const script: string = scriptOf(INCIDENT.datadogTemplateId);

    expect(script).toContain(
      "const PRIORITY_PLACE = { P1: 'most severe', P2: 'most severe', P3: 'middle', P4: 'least severe', P5: 'least severe' };",
    );
    expect(script).toContain("const NO_PRIORITY_PLACE = 'most severe';");
  });

  it("gets its example of SEVERITY_BY_NAME to do what it says", async () => {
    const line: string = lineStartingWith(
      section(),
      "- To map a priority to one of yours by name",
    );
    const example: string = codeIn(line).find((code: string): boolean => {
      return SEVERITY_EXAMPLE.test(code);
    }) as string;
    const [, priority, severity] = example.match(
      SEVERITY_EXAMPLE,
    ) as RegExpMatchArray;

    expect(codeIn(line)).toContain("SEVERITY_BY_NAME");
    expect(codeIn(line)).toContain(READ_STEP);

    const result: JSONObject = await runReadScript({
      templateId: INCIDENT.datadogTemplateId,
      payload: datadogPostedBody({ priority: priority as string }),
      editCode: (code: string): string => {
        return code.replace(
          SEVERITY_BY_NAME_EMPTY,
          `const SEVERITY_BY_NAME = ${example};`,
        );
      },
    });

    expect(result["severity"]).toBe(severity);
  });

  it("pages with the If / Else it names: the priority's number, at most the limit, and P3 is 3", () => {
    for (const kind of KINDS) {
      const condition: JSONObject = nodeOf(kind.datadogTemplateId, "if-page-1")
        .args as JSONObject;

      expect(condition["operator"]).toBe("<=");
      expect(condition["input-2"]).toBe(String(DATADOG_PAGE_UP_TO_PRIORITY));
      expect(String(condition["input-1"])).toContain("priorityNumber");
    }

    expect(DATADOG_PAGE_UP_TO_PRIORITY).toBe(2);
    expect(DATADOG_PRIORITIES.indexOf("P3") + 1).toBe(3);
    expect(section()).toContain(
      `To page for P3 too, set ${bold("Compare with")} of the \`if-page-1\` ${bold("If / Else")} step to \`3\`.`,
    );
  });
});

describe("the Datadog page's test and troubleshooting", () => {
  it("sends what the page's payload sends", () => {
    const payload: Record<string, string> = JSON.parse(
      fenceIn(englishSection(DATADOG, CONFIGURE_DATADOG), "json"),
    ) as Record<string, string>;

    expect(Object.keys(testPayloadOf(DATADOG)).sort()).toEqual(
      Object.keys(payload).sort(),
    );
  });

  it.each(KINDS)(
    "$datadogTemplateId does what the test says: it opens, titled as it says and paged, and Recovered resolves",
    async (kind: AlertingToolKind) => {
      const sent: JSONObject = testPayloadOf(DATADOG);
      const opened: JSONObject = await runReadScript({
        templateId: kind.datadogTemplateId,
        payload: sent,
      });
      const recovered: JSONObject = await runReadScript({
        templateId: kind.datadogTemplateId,
        payload: { ...sent, transition: DatadogTransition.Recovered },
      });

      expect(actionOf(opened)).toBe(FromAnotherToolAction.Open);
      expect(withoutJoiners(opened["title"])).toBe("Datadog: High CPU");
      expect(Number(opened["priorityNumber"])).toBeLessThanOrEqual(
        DATADOG_PAGE_UP_TO_PRIORITY,
      );
      expect(actionOf(recovered)).toBe(FromAnotherToolAction.Resolve);
    },
  );

  it("says what the test does with the template, in the title the read step gives", () => {
    expect(englishSection(DATADOG, TEST_IT)).toContain(
      "With the template, an incident opens, titled `Datadog: High CPU`, and the on-call policies you picked are paged.",
    );
  });

  it("quotes the reasons the read step gives when a key is missing", async () => {
    const section: string = englishSection(DATADOG, TROUBLESHOOTING);
    const noCycleKey: JSONObject = await runReadScript({
      templateId: INCIDENT.datadogTemplateId,
      payload: { transition: DatadogTransition.Triggered },
    });
    const noTransition: JSONObject = await runReadScript({
      templateId: INCIDENT.datadogTemplateId,
      payload: { alert_cycle_key: ALERT_CYCLE_KEY },
    });

    expect(noCycleKey["proceed"]).toBe(false);
    expect(noCycleKey["reason"]).toContain("Datadog named no alert cycle key");
    expect(noCycleKey["reason"]).toContain(
      '"alert_cycle_key": "$ALERT_CYCLE_KEY"',
    );
    expect(noTransition["proceed"]).toBe(false);
    expect(noTransition["reason"]).toContain("Datadog named no transition");
    expect(section).toContain(
      '- `Datadog named no alert cycle key`: add `"alert_cycle_key": "$ALERT_CYCLE_KEY"`',
    );
    expect(section).toContain(
      '- `Datadog named no transition`: add `"transition": "$ALERT_TRANSITION"`',
    );
    expect(DATADOG_WEBHOOK_PAYLOAD["transition"]).toBe("$ALERT_TRANSITION");
  });

  it("says nobody picked leaves the paging out, as the wizard does", () => {
    for (const template of getWorkflowTemplatesByCategory(
      WorkflowTemplateCategory.Datadog,
    )) {
      expect(template.whoToPage?.[0]?.leftOutWhenNobody).toEqual(["if-page-1"]);
    }

    expect(englishSection(DATADOG, TROUBLESHOOTING)).toContain(
      `With nobody picked in the ${bold("Create a workflow")} dialog, the workflow has no step that pages.`,
    );
  });

  it("says a link goes only to a Datadog site, as the read step writes one", async () => {
    const outside: JSONObject = await runReadScript({
      templateId: INCIDENT.datadogTemplateId,
      payload: datadogPostedBody({ link: "https://example.com/event" }),
    });

    expect(String(outside["description"])).not.toContain("example.com");
    expect(DATADOG_LINK_HOSTS).toContain("datadoghq.com");
    expect(englishPage(DATADOG)).toContain(
      `${bold("Links go to Datadog.")} The template links an alert only on a Datadog site`,
    );
  });
});

/* -------------------------------- New Relic -------------------------------- */

describe("the New Relic page's templates", () => {
  const page: string = englishPage(NEW_RELIC);
  const templates: Array<WorkflowTemplate> = getWorkflowTemplatesByCategory(
    WorkflowTemplateCategory.NewRelic,
  );

  it("names the two templates as the picker lists them, under the picker's category", () => {
    const names: Array<string> = templatesOf(WorkflowTemplateCategory.NewRelic);

    expect(names).toEqual([
      "Declare an incident for each New Relic issue",
      "Create an alert for each New Relic issue",
    ]);
    expect(names).toEqual(TEMPLATE_NAMES[NEW_RELIC]?.slice(0, 2));
    expect(
      getWorkflowTemplateCategoryInfo(WorkflowTemplateCategory.NewRelic).label,
    ).toBe("New Relic");
    expect(page).toContain(
      `The ${bold("Create a workflow")} dialog has two New Relic templates, under ${bold("New Relic")} in its category list: ${bold(names[0] as string)}, and ${bold(names[1] as string)} for alerts.`,
    );
    expect(page).toContain(
      `choose ${bold("New Relic")} in the category list, click ${bold(names[0] as string)}, or ${bold(names[1] as string)}, and click ${bold("Use this template")}.`,
    );
  });

  it("asks who to page by the wizard's own question, which nobody need answer", () => {
    for (const template of templates) {
      const question: { title: string; required: boolean } = template
        .whoToPage?.[0] as { title: string; required: boolean };

      expect(question.title).toBe("Who to page for new New Relic issues");
      expect(question.required).toBe(false);
      expect(TEMPLATE_NAMES[NEW_RELIC]).toContain(question.title);
      expect(page).toContain(
        `Under ${bold(question.title)}, pick the on-call policies to page, or none to page nobody, and click ${bold("Create Workflow")}.`,
      );
    }
  });

  it("gets the URL from the Webhook trigger, and says a workflow that is off answers 400", () => {
    for (const kind of KINDS) {
      expect(nodeOf(kind.newRelicTemplateId, "webhook-1").metadataId).toBe(
        ComponentID.Webhook,
      );
    }

    expect(
      readRepoFile("App/FeatureSet/Workflow/Services/QueueWorkflow.ts"),
    ).toContain("throw new BadDataException(WORKFLOW_TURNED_OFF_MESSAGE)");
    expect(page).toContain(
      `Click the ${bold("Webhook")} trigger, then ${bold("Copy URL")}, and keep the URL for New Relic.`,
    );
    expect(page).toContain(
      "A workflow that is off answers New Relic with `400`.",
    );
  });

  it("sets New Relic up as the read step's first lines say: where, and when it notifies", () => {
    const configure: string = englishSection(NEW_RELIC, CONFIGURE_NEW_RELIC);

    for (const kind of KINDS) {
      const script: string = scriptOf(kind.newRelicTemplateId);

      expect(script.split("\n")[0]).toBe("// ---- Set up in New Relic ----");
      expect(script).toContain("go to Alerts → Destinations");
      expect(script).toContain("under Alerts → Workflows");
      expect(script).toContain("activated, acknowledged and closed");
      expect(script).toContain(
        "Its filter decides which issues reach OneUptime",
      );
    }

    expect(configure).toContain(
      `go to ${bold("Alerts → Destinations")} and add a ${bold("Webhook")} destination.`,
    );
    expect(configure).toContain(
      `${bold("Endpoint URL")} to the URL you copied from OneUptime`,
    );
    expect(configure).toContain(`Go to ${bold("Alerts → Workflows")}`);
    expect(configure).toContain(
      "Its filter decides which issues reach OneUptime",
    );
    expect(configure).toContain(
      `Keep ${bold("Activated")}, ${bold("Acknowledged")} and ${bold("Closed")} on.`,
    );
    expect(page).toContain(
      `The workflow's \`${READ_STEP}\` step opens with the same setup`,
    );
  });

  it("is listed in the Integrations group after Datadog, and in the overview's catalog with it", () => {
    const urls: Array<string> = (
      DocsNav.find((group: NavGroup): boolean => {
        return group.title === "Integrations";
      }) as NavGroup
    ).links.map((link: NavLink): string => {
      return link.url;
    });
    const rows: Array<Array<string>> = tableWithHeader(
      englishSection(OVERVIEW, "### Monitoring and alerting tools"),
      "Tool",
    );

    expect(urls.indexOf(`/docs/${NEW_RELIC}`)).toBe(
      urls.indexOf(`/docs/${DATADOG}`) + 1,
    );
    expect(rows[rows.length - 1]).toEqual([
      `[New Relic](/docs/${NEW_RELIC})`,
      "Inbound",
      "Turn New Relic issues into incidents or alerts, and resolve them when the issue closes.",
    ]);
    expect(rows[rows.length - 2]).toEqual([
      `[Datadog](/docs/${DATADOG})`,
      "Inbound",
      "Turn Datadog monitor alerts into incidents or alerts, and resolve them on recovery.",
    ]);
  });

  it("is off the overview's list of tools with no guide, and on its list of templates", () => {
    expect(
      englishSection(OVERVIEW, "## Build your own integration"),
    ).not.toContain("New Relic");

    const way: Array<string> = tableWithHeader(
      englishSection(OVERVIEW, "## Choose how to connect"),
      "Way",
    ).find((row: Array<string>): boolean => {
      return row[0] === "A workflow template";
    }) as Array<string>;

    expect(way[2]).toContain(`[Datadog](/docs/${DATADOG})`);
    expect(way[2]).toContain(`[New Relic](/docs/${NEW_RELIC})`);
  });
});

describe("the New Relic page's payload", () => {
  const configure: () => string = (): string => {
    return englishSection(NEW_RELIC, CONFIGURE_NEW_RELIC);
  };

  // The payload's fields, as the page writes them.
  function pageFields(): Array<NewRelicPayloadField> {
    return fenceIn(configure(), "json")
      .split("\n")
      .slice(1, -1)
      .filter((line: string): boolean => {
        return line.trim() !== "";
      })
      .map((line: string): NewRelicPayloadField => {
        const match: RegExpMatchArray | null = line.match(
          NEW_RELIC_PAYLOAD_LINE,
        );

        if (!match) {
          throw new Error(`Not a field of the payload: ${line}`);
        }

        return {
          key: match[1] as string,
          json: match[2] === "json",
          variable: match[3] as string,
        };
      });
  }

  it("quotes the template's fields: every one, from its variable, with the json helper", () => {
    const fields: Array<NewRelicPayloadField> = pageFields();

    for (const [key, variable] of Object.entries(
      NEW_RELIC_WEBHOOK_PAYLOAD_FIELDS,
    )) {
      expect(
        fields.find((field: NewRelicPayloadField): boolean => {
          return field.key === key;
        }),
      ).toEqual({ key, json: true, variable });
    }
  });

  it("is New Relic's default payload and the one line for isAcknowledged", () => {
    const keys: Array<string> = pageFields().map(
      (field: NewRelicPayloadField): string => {
        return field.key;
      },
    );

    expect(
      keys
        .filter((key: string): boolean => {
          return key !== "isAcknowledged";
        })
        .sort(),
    ).toEqual(Object.keys(newRelicPostedBody()).sort());
    expect(
      keys.filter((key: string): boolean => {
        return key === "isAcknowledged";
      }),
    ).toHaveLength(1);
    expect(fenceIn(configure(), "json")).toContain(
      '"isAcknowledged": {{ json isAcknowledged }},',
    );
    expect(configure()).toContain(
      'The line to add is `"isAcknowledged": {{ json isAcknowledged }},`.',
    );
  });

  it("lists for the shared references check exactly the variables its payload writes", () => {
    expect(
      pageFields().map((field: NewRelicPayloadField): string => {
        return `${field.json ? "json " : ""}${field.variable}`;
      }),
    ).toEqual(OTHER_TOOL_VARIABLES[NEW_RELIC]);
  });

  it("explains in its table every field the template reads, in the template's order", () => {
    expect(
      tableWithHeader(configure(), "Field").map(
        (row: Array<string>): string => {
          return codeIn(row[0] as string)[0] as string;
        },
      ),
    ).toEqual(Object.keys(NEW_RELIC_WEBHOOK_PAYLOAD_FIELDS));
  });

  it("names every priority and state the template knows", () => {
    const rows: Array<Array<string>> = tableWithHeader(configure(), "Field");
    const rowOf: (field: string) => string = (field: string): string => {
      return (
        rows.find((row: Array<string>): boolean => {
          return row[0] === `\`${field}\``;
        }) as Array<string>
      )[1] as string;
    };

    expect(codeIn(rowOf("priority"))).toEqual([...NEW_RELIC_PRIORITIES]);
    expect([...codeIn(rowOf("state"))].sort()).toEqual(
      [...Object.values(NewRelicIssueState)].sort(),
    );
  });

  it.each(KINDS)(
    "$newRelicTemplateId reads the page's payload, filled in as New Relic fills it in",
    async (kind: AlertingToolKind) => {
      const posted: JSONObject = newRelicPostedBody({ isAcknowledged: false });
      // Each field's line, with what New Relic writes in place of its variable.
      const filled: JSONObject = JSON.parse(
        pageFields().length === Object.keys(posted).length
          ? `{${pageFields()
              .map((field: NewRelicPayloadField): string => {
                const value: JSONValue | undefined = posted[field.key];

                return `${JSON.stringify(field.key)}: ${JSON.stringify(value)}`;
              })
              .join(",")}}`
          : "null",
      ) as JSONObject;

      expect(filled).toEqual(posted);

      const result: JSONObject = await runReadScript({
        templateId: kind.newRelicTemplateId,
        payload: filled,
      });

      expect(actionOf(result)).toBe(FromAnotherToolAction.Open);
      expect(result["issueId"]).toBe(posted["id"]);
    },
  );

  it("names the custom field the template keeps the ID in, as the template writes it", () => {
    for (const kind of KINDS) {
      expect(
        nodeOf(kind.newRelicTemplateId, kind.step).args?.[
          FROM_ANOTHER_TOOL_ARGUMENT_IDS.outsideIdField
        ],
      ).toBe(NEW_RELIC_ISSUE_ID_CUSTOM_FIELD);
    }

    expect(englishPage(NEW_RELIC)).toContain(
      `The incident keeps the ID in its custom field \`${NEW_RELIC_ISSUE_ID_CUSTOM_FIELD}\`.`,
    );
  });
});

describe("what the New Relic page says each state does", () => {
  const section: () => string = (): string => {
    return englishSection(NEW_RELIC, WHAT_THE_WORKFLOW_DOES);
  };
  const rows: () => Array<Array<string>> = (): Array<Array<string>> => {
    return tableWithHeader(section(), "What New Relic sends");
  };

  const CASES: Array<{
    cell: string;
    words: string;
    given: { state: string; isAcknowledged?: boolean };
    action: FromAnotherToolAction;
  }> = [
    {
      cell: "`state` is `ACTIVATED` or `CREATED`",
      words: "Declares an incident",
      given: { state: NewRelicIssueState.Activated },
      action: FromAnotherToolAction.Open,
    },
    {
      cell: "`state` is `ACTIVATED` or `CREATED`",
      words: "Declares an incident",
      given: { state: NewRelicIssueState.Created },
      action: FromAnotherToolAction.Open,
    },
    {
      cell: "`state` is `ACTIVATED` and `isAcknowledged` is `true`",
      words: "Acknowledges the issue's incident",
      given: { state: NewRelicIssueState.Activated, isAcknowledged: true },
      action: FromAnotherToolAction.Acknowledge,
    },
    {
      cell: "`state` is `CLOSED`",
      words: "Resolves the issue's incident",
      given: { state: NewRelicIssueState.Closed },
      action: FromAnotherToolAction.Resolve,
    },
  ];

  it("has a row for each state, in its order", () => {
    expect(
      rows().map((row: Array<string>): string => {
        return row[0] as string;
      }),
    ).toEqual([
      "`state` is `ACTIVATED` or `CREATED`",
      "`state` is `ACTIVATED` and `isAcknowledged` is `true`",
      "`state` is `CLOSED`",
    ]);
  });

  it.each(KINDS)(
    "$newRelicTemplateId does with each state what its row says",
    async (kind: AlertingToolKind) => {
      for (const testCase of CASES) {
        const row: Array<string> = rows().find(
          (candidate: Array<string>): boolean => {
            return candidate[0] === testCase.cell;
          },
        ) as Array<string>;
        const result: JSONObject = await runReadScript({
          templateId: kind.newRelicTemplateId,
          payload: newRelicPostedBody(testCase.given),
        });

        expect(row[1]).toContain(testCase.words);
        expect({ ...testCase.given, action: actionOf(result) }).toEqual({
          ...testCase.given,
          action: testCase.action,
        });
      }
    },
  );

  it.each(KINDS)(
    "$newRelicTemplateId: without isAcknowledged, as New Relic's default payload has it, an issue opens and closes the record but never acknowledges it",
    async (kind: AlertingToolKind) => {
      const posted: JSONObject = newRelicPostedBody();

      expect(Object.keys(posted)).not.toContain("isAcknowledged");
      expect(
        actionOf(
          await runReadScript({
            templateId: kind.newRelicTemplateId,
            payload: posted,
          }),
        ),
      ).toBe(FromAnotherToolAction.Open);
      expect(englishSection(NEW_RELIC, TROUBLESHOOTING)).toContain(
        "Without it, an incident opens and is resolved with its issue, but is never acknowledged.",
      );
    },
  );

  it.each(KINDS)(
    "$newRelicTemplateId titles a new record and describes it as the first row says",
    async (kind: AlertingToolKind) => {
      const result: JSONObject = await runReadScript({
        templateId: kind.newRelicTemplateId,
        payload: newRelicPostedBody(),
      });
      const description: string = withoutJoiners(result["description"]);

      expect(withoutJoiners(result["title"])).toBe(
        "New Relic: High CPU on checkout-service",
      );
      expect(description).toContain("open it in New Relic");
      expect(description).toContain("- Priority in New Relic: CRITICAL");
      expect(description).toContain("- Entities: checkout-service");
      expect(description).toContain("- Policies: Production");
      expect(description).toContain("- Conditions: CPU above 90%");
    },
  );

  it("names the row's title as the template writes it, and what the steps are", () => {
    expect(rows()[0]?.[1]).toContain("titled `New Relic: <issue>`");
    expect(rows()[0]?.[1]).toContain("kept off your status pages");
    expect(nodeOf(INCIDENT.newRelicTemplateId, READ_STEP).metadataId).toBe(
      ComponentID.JavaScriptCheck,
    );
    expect(section()).toContain(
      `the \`${READ_STEP}\` ${bold("Check With JavaScript")} step reads the \`state\` New Relic sends, and ${bold("Incident From Another Tool")}, or ${bold("Alert From Another Tool")} in the alert template, does what it means, by the issue's ID.`,
    );
  });

  it("says nothing goes back to New Relic: the template's steps call nothing outside", () => {
    for (const kind of KINDS) {
      expect(metadataIdsOf(kind.newRelicTemplateId)).toEqual([
        ComponentID.Webhook,
        ComponentID.JavaScriptCheck,
        kind === INCIDENT
          ? ComponentID.IncidentFromAnotherTool
          : ComponentID.AlertFromAnotherTool,
        ComponentID.PageOnCallPolicy,
      ]);
    }

    expect(section()).toContain("Nothing goes back to New Relic");
  });
});

describe("what the New Relic page says about priorities and paging", () => {
  const section: () => string = (): string => {
    return englishSection(NEW_RELIC, PRIORITIES_AND_PAGING);
  };

  it("says every new issue pages, and why, with the Page step right after the step that opens the record", () => {
    for (const kind of KINDS) {
      expect(
        specOf(kind.newRelicTemplateId).edges.find(
          (edge: SpecEdge): boolean => {
            return edge.toComponentId === "page-on-call-policy-1";
          },
        ),
      ).toEqual({
        fromComponentId: kind.step,
        toComponentId: "page-on-call-policy-1",
        fromPort: FROM_ANOTHER_TOOL_PORT_IDS.opened,
      });
      expect(metadataIdsOf(kind.newRelicTemplateId)).not.toContain(
        ComponentID.IfElse,
      );
    }

    expect(section()).toContain(
      "Every new issue pages the on-call policies you picked, whatever its priority: New Relic raises an issue from HIGH to CRITICAL in place, on the same issue,",
    );
    expect(section()).toContain(
      "narrow the filter of the workflow in New Relic",
    );
  });

  it("lists every priority New Relic has, in its order", () => {
    expect(
      tableWithHeader(section(), "New Relic priority").map(
        (row: Array<string>): string => {
          return row[0] as string;
        },
      ),
    ).toEqual([...NEW_RELIC_PRIORITIES]);
  });

  it("maps each priority as its table says, by the read step, and every row pages", async () => {
    for (const row of tableWithHeader(section(), "New Relic priority")) {
      const mapped: Array<string> = [];

      for (const kind of [INCIDENT, ALERT]) {
        const result: JSONObject = await runReadScript({
          templateId: kind.newRelicTemplateId,
          payload: newRelicPostedBody({ priority: row[0] as string }),
        });

        mapped.push(severityInNewProject(kind, String(result["severity"])));
      }

      expect({
        priority: row[0],
        incident: mapped[0],
        alert: mapped[1],
        onCall: "Paged",
      }).toEqual({
        priority: row[0],
        incident: row[1],
        alert: row[2],
        onCall: row[3],
      });
    }
  });

  it("says what your own severities get, as the read step places them", () => {
    expect(section()).toContain(
      "With severities of your own, CRITICAL goes to your most severe, HIGH to the middle one, and MEDIUM and LOW to your least severe.",
    );
    expect(scriptOf(INCIDENT.newRelicTemplateId)).toContain(
      "const PRIORITY_PLACE = { CRITICAL: 'most severe', HIGH: 'middle', MEDIUM: 'least severe', LOW: 'least severe' };",
    );
  });

  it("gets its example of SEVERITY_BY_NAME to do what it says", async () => {
    const line: string = lineStartingWith(
      section(),
      "To map a priority to one of yours by name",
    );
    const example: string = codeIn(line).find((code: string): boolean => {
      return SEVERITY_EXAMPLE.test(code);
    }) as string;
    const [, priority, severity] = example.match(
      SEVERITY_EXAMPLE,
    ) as RegExpMatchArray;

    expect(codeIn(line)).toContain("SEVERITY_BY_NAME");
    expect(codeIn(line)).toContain(READ_STEP);

    const result: JSONObject = await runReadScript({
      templateId: INCIDENT.newRelicTemplateId,
      payload: newRelicPostedBody({ priority: priority as string }),
      editCode: (code: string): string => {
        return code.replace(
          SEVERITY_BY_NAME_EMPTY,
          `const SEVERITY_BY_NAME = ${example};`,
        );
      },
    });

    expect(result["severity"]).toBe(severity);
  });
});

describe("the New Relic page's test and troubleshooting", () => {
  it("sends only fields of the page's payload, with the fields the template reads", () => {
    const sent: Array<string> = Object.keys(testPayloadOf(NEW_RELIC));
    const payload: string = fenceIn(
      englishSection(NEW_RELIC, CONFIGURE_NEW_RELIC),
      "json",
    );

    expect([...sent].sort()).toEqual(
      Object.keys(NEW_RELIC_WEBHOOK_PAYLOAD_FIELDS).sort(),
    );

    for (const key of sent) {
      expect(payload).toContain(`"${key}": {{`);
    }
  });

  it.each(KINDS)(
    "$newRelicTemplateId does what the test says: it opens, titled as it says, isAcknowledged acknowledges and CLOSED resolves",
    async (kind: AlertingToolKind) => {
      const sent: JSONObject = testPayloadOf(NEW_RELIC);
      const opened: JSONObject = await runReadScript({
        templateId: kind.newRelicTemplateId,
        payload: sent,
      });
      const acknowledged: JSONObject = await runReadScript({
        templateId: kind.newRelicTemplateId,
        payload: { ...sent, isAcknowledged: true },
      });
      const closed: JSONObject = await runReadScript({
        templateId: kind.newRelicTemplateId,
        payload: { ...sent, state: NewRelicIssueState.Closed },
      });

      expect(actionOf(opened)).toBe(FromAnotherToolAction.Open);
      expect(withoutJoiners(opened["title"])).toBe(
        "New Relic: High CPU on checkout-service",
      );
      expect(actionOf(acknowledged)).toBe(FromAnotherToolAction.Acknowledge);
      expect(actionOf(closed)).toBe(FromAnotherToolAction.Resolve);
    },
  );

  it("says what the test does, in the title the read step gives", () => {
    const section: string = englishSection(NEW_RELIC, TEST_IT);

    expect(section).toContain(
      "An incident opens, titled `New Relic: High CPU on checkout-service`, and the on-call policies you picked are paged.",
    );
    expect(section).toContain(
      "Send the same request with `isAcknowledged` set to `true`, and the incident is acknowledged.",
    );
    expect(section).toContain(
      "Send it with `state` set to `CLOSED`, and the incident is resolved.",
    );
  });

  it("quotes the reasons the read step gives when a field is missing", async () => {
    const section: string = englishSection(NEW_RELIC, TROUBLESHOOTING);
    const noId: JSONObject = await runReadScript({
      templateId: INCIDENT.newRelicTemplateId,
      payload: { state: NewRelicIssueState.Activated },
    });
    const noState: JSONObject = await runReadScript({
      templateId: INCIDENT.newRelicTemplateId,
      payload: { id: "7d4a2e1c-3b5f-4c8e-9a1d-2f6b8c0e4a71" },
    });

    expect(noId["proceed"]).toBe(false);
    expect(noId["reason"]).toContain("New Relic named no issue ID");
    expect(noState["proceed"]).toBe(false);
    expect(noState["reason"]).toContain("is in no state");
    expect(section).toContain(
      '- `New Relic named no issue ID`: keep the line `"id": {{ json issueId }},` in the payload.',
    );
    expect(section).toContain(
      '- `is in no state`: keep the line `"state": {{ json state }},` in the payload.',
    );
  });

  it("says a raise to CRITICAL pages nobody again, and nobody picked leaves the paging out", () => {
    const section: string = englishSection(NEW_RELIC, TROUBLESHOOTING);

    for (const kind of KINDS) {
      expect(
        specOf(kind.newRelicTemplateId).edges.some(
          (edge: SpecEdge): boolean => {
            return (
              edge.toComponentId === "page-on-call-policy-1" &&
              edge.fromPort === FROM_ANOTHER_TOOL_PORT_IDS.opened
            );
          },
        ),
      ).toBe(true);
    }

    expect(section).toContain(
      "A notification for an issue that has its incident pages nobody again, so a raise to CRITICAL pages nobody.",
    );
    expect(section).toContain(
      `With nobody picked in the ${bold("Create a workflow")} dialog, the workflow has no step that pages.`,
    );
  });

  it("says a link goes only to a New Relic site, as the read step writes one", async () => {
    const outside: JSONObject = await runReadScript({
      templateId: INCIDENT.newRelicTemplateId,
      payload: newRelicPostedBody({ issueUrl: "https://example.com/issue" }),
    });

    expect(String(outside["description"])).not.toContain("example.com");
    expect(NEW_RELIC_LINK_HOSTS).toEqual(["newrelic.com"]);
    expect(englishPage(NEW_RELIC)).toContain(
      `${bold("Links go to New Relic.")} The template links an issue only on a New Relic site`,
    );
  });

  it("links each page to the other", () => {
    expect(englishPage(NEW_RELIC)).toContain(
      `[Datadog](/docs/${DATADOG}): The same template, for Datadog monitors.`,
    );
    expect(englishPage(DATADOG)).toContain(
      `[New Relic](/docs/${NEW_RELIC}): The same template, for New Relic issues.`,
    );
  });
});
