/*
 * The Jira templates, run end to end by the template simulator
 * (WorkflowTemplateSimulator): the graph the create wizard builds, its
 * values substituted the way RunWorkflow does, the real Check With
 * JavaScript, API, API Get By ID and Incident and Alert From Another Tool
 * steps, and every script in the real sandbox. Jira is a fake of its REST
 * API that keeps Jira's rules (FakeJira); the project is one held in memory
 * (TemplateWorld).
 *
 * The script tests prove that each script decides correctly given its
 * arguments. What they cannot prove is that the arguments the runner hands a
 * script are the ones it expects, that a request body is still valid JSON
 * after substitution, that the record step is given what the script said, or
 * that two templates chained together settle instead of echoing each other
 * forever. Those are properties of a whole graph, so this file runs whole
 * graphs, for an incident and for an alert:
 *
 *   - OneUptime to Jira: a record files one labelled issue; a state moves
 *     its issue; a note, or an edit, is a comment on it.
 *   - Jira to OneUptime: a new issue opens a record and is labelled with its
 *     id; a status moves the record forward; a comment, or an edit of the
 *     issue, is a private note on it.
 *   - Together: what one direction writes comes back through the other, and
 *     settles.
 *
 * Each of these is three to five steps now, where it was eight to eighteen,
 * with nothing on any Error output: a step that fails fails the run, and its
 * Steps entry says why. That they do what the old ones did, event for event,
 * is JiraTemplateEquivalence's.
 */

import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Alert from "../../../Models/DatabaseModels/Alert";
import Incident from "../../../Models/DatabaseModels/Incident";
import WorkflowPrincipal, {
  WorkflowPrincipalOptions,
} from "../../../Server/Utils/Workflow/WorkflowPrincipal";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import {
  JIRA_SYNCED_FROM_ONEUPTIME_MARKER,
  ONEUPTIME_SYNCED_FROM_JIRA_MARKER,
  WorkflowTemplate,
  WorkflowTemplateCategory,
  getWorkflowTemplatesByCategory,
} from "../../../Types/Workflow/Templates";
import FakeJira, {
  FAKE_JIRA_SITE,
  FAKE_JIRA_TOKEN,
  FakeJiraCall,
} from "./FakeJira";
import {
  DONE,
  IN_PROGRESS,
  RESOLVED_CHANGELOG,
  STARTED_CHANGELOG,
  TO_DO,
  changelogItem,
  jiraCommentEvent,
  jiraIssueCreatedEvent,
  jiraIssueUpdatedEvent,
  jiraUser,
} from "./JiraTemplateFixtures";
import {
  EquivalenceScenario,
  OtherTool,
  TemplateRun,
  runNewTemplate,
} from "./TemplateEquivalence";
import TemplateWorld from "./TemplateWorld";
import {
  SimulatedReply,
  SimulatedRequest,
  stubDnsLookups,
} from "./WorkflowTemplateSimulator";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

// The sandbox boots a fresh isolate for every script a run reaches.
jest.setTimeout(120000);

const VARIABLES: { [name: string]: string } = {
  jiraBaseUrl: FAKE_JIRA_SITE,
  jiraSiteUrl: FAKE_JIRA_SITE,
  jiraBasicAuthToken: FAKE_JIRA_TOKEN,
  jiraProjectKey: "OPS",
  jiraIssueType: "Task",
  oneuptimeUrl: "https://oneuptime.example.com",
};

const ISSUE_KEY: string = "OPS-17";
const ISSUE_LINK: string = `[${ISSUE_KEY}](${FAKE_JIRA_SITE}/browse/${ISSUE_KEY})`;

interface Kind {
  noun: "incident" | "alert";
  Noun: string;
  // An incident is declared; an alert is created.
  created: string;
  Created: string;
  createFromIssue: string;
  modelType: { new (): BaseModel };
  idColumn: string;
  numberField: string;
  number: string;
  step: string;
  // A new project's most severe, middle and least severe severities.
  severities: [string, string, string];
  noteTemplates: Array<string>;
  records: (world: TemplateWorld) => Array<BaseModel>;
  add: (world: TemplateWorld, props?: RecordProps) => BaseModel;
}

interface RecordProps {
  stateName?: string | undefined;
  isPrivate?: boolean | undefined;
  customFields?: JSONObject | undefined;
  title?: string | undefined;
}

const finish: (record: BaseModel, props?: RecordProps) => BaseModel = (
  record: BaseModel,
  props?: RecordProps,
): BaseModel => {
  record.setColumnValue(
    "description",
    "Customers in eu-west-1 see 502s at checkout.",
  );

  if (props?.isPrivate !== undefined) {
    record.setColumnValue("isPrivate", props.isPrivate);
  }

  return record;
};

const INCIDENT: Kind = {
  noun: "incident",
  Noun: "Incident",
  created: "declared",
  Created: "Declared",
  createFromIssue: "jira-declare-incident-from-issue",
  modelType: Incident,
  idColumn: "incidentId",
  numberField: "incidentNumberWithPrefix",
  number: "INC-1",
  step: "incident-from-another-tool-1",
  severities: ["Critical Incident", "Major Incident", "Minor Incident"],
  noteTemplates: [
    "jira-comment-from-incident-private-note",
    "jira-comment-from-incident-public-note",
  ],
  records: (world: TemplateWorld): Array<BaseModel> => {
    return world.incidents.records.rows;
  },
  add: (world: TemplateWorld, props?: RecordProps): BaseModel => {
    return finish(
      world.addIncident({
        title: props?.title || "Checkout API returns 502 for EU customers",
        stateName: props?.stateName,
        customFields: props?.customFields,
      }),
      props,
    );
  },
};

const ALERT: Kind = {
  noun: "alert",
  Noun: "Alert",
  created: "created",
  Created: "Created",
  createFromIssue: "jira-create-alert-from-issue",
  modelType: Alert,
  idColumn: "alertId",
  numberField: "alertNumberWithPrefix",
  number: "ALT-1",
  step: "alert-from-another-tool-1",
  severities: ["High", "Low", "Low"],
  noteTemplates: ["jira-comment-from-alert-private-note"],
  records: (world: TemplateWorld): Array<BaseModel> => {
    return world.alerts.records.rows;
  },
  add: (world: TemplateWorld, props?: RecordProps): BaseModel => {
    return finish(
      world.addAlert({
        title: props?.title || "Checkout API returns 502 for EU customers",
        stateName: props?.stateName,
        customFields: props?.customFields,
      }),
      props,
    );
  },
};

const KINDS: Array<Kind> = [INCIDENT, ALERT];

// The Jira of the last run: its issues, and every call it was sent.
let jira: FakeJira;

const jiraTool: (
  setUp?: (fake: FakeJira, world: TemplateWorld) => void,
) => (world: TemplateWorld) => OtherTool = (
  setUp?: (fake: FakeJira, world: TemplateWorld) => void,
): ((world: TemplateWorld) => OtherTool) => {
  return (world: TemplateWorld): OtherTool => {
    jira = new FakeJira();

    if (setUp) {
      setUp(jira, world);
    }

    return {
      http: (request: SimulatedRequest): SimulatedReply => {
        return jira.answer(request);
      },
      state: (): JSONValue => {
        return jira.state();
      },
    };
  };
};

beforeEach(() => {
  // The API steps resolve Jira's host before every request; it is a public one.
  stubDnsLookups("93.184.216.34");

  // The steps' caller, without the read of the project's plan.
  jest.spyOn(WorkflowPrincipal, "getProps").mockImplementation((async (
    data: WorkflowPrincipalOptions,
  ) => {
    return WorkflowPrincipal.getPropsWithoutPlan(data);
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// The label a linked issue carries for the project's first record.
const linkLabel: (kind: Kind, world: TemplateWorld) => string = (
  kind: Kind,
  world: TemplateWorld,
): string => {
  return `oneuptime-${kind.noun}-${(kind.records(world)[0] as BaseModel).id!.toString()}`;
};

// An issue linked to the project's first record, at a status.
const linkedIssue: (
  kind: Kind,
  status?: JSONObject,
) => (fake: FakeJira, world: TemplateWorld) => void = (
  kind: Kind,
  status?: JSONObject,
): ((fake: FakeJira, world: TemplateWorld) => void) => {
  return (fake: FakeJira, world: TemplateWorld): void => {
    fake.add({
      key: ISSUE_KEY,
      labels: ["oneuptime", linkLabel(kind, world)],
      status: status || TO_DO,
    });
  };
};

const recordTrigger: (kind: Kind, world: TemplateWorld) => JSONObject = (
  kind: Kind,
  world: TemplateWorld,
): JSONObject => {
  return {
    model: BaseModel.toJSON(
      kind.records(world)[0] as BaseModel,
      kind.modelType,
    ),
  };
};

const noteTrigger: (
  kind: Kind,
  world: TemplateWorld,
  note: string,
) => JSONObject = (
  kind: Kind,
  world: TemplateWorld,
  note: string,
): JSONObject => {
  const record: BaseModel = kind.records(world)[0] as BaseModel;

  return {
    model: {
      _id: "cccccccc-0000-4000-8000-000000000001",
      note: note,
      [kind.idColumn]: { _type: "ObjectID", value: record.id!.toString() },
      [kind.noun]: {
        _id: record.id!.toString(),
        [kind.numberField]: String(record.getColumnValue(kind.numberField)),
        isPrivate: Boolean(
          (record as unknown as Record<string, unknown>)["isPrivate"],
        ),
      },
      createdByUser: { name: { _type: "Name", value: "Jane Doe" } },
    },
  };
};

const webhookTrigger: (body: JSONValue) => JSONObject = (
  body: JSONValue,
): JSONObject => {
  return {
    "request-body": body,
    "request-headers": { "content-type": "application/json" },
    "request-params": {},
  };
};

// What a run changed in Jira: every call but the reads.
const jiraWrites: () => Array<FakeJiraCall> = (): Array<FakeJiraCall> => {
  return jira.calls.filter((call: FakeJiraCall): boolean => {
    return !(
      call.method === "GET" || call.path.startsWith("/rest/api/3/search/jql")
    );
  });
};

const issue: (key?: string) => JSONObject = (key?: string): JSONObject => {
  const found: JSONValue | undefined = (
    (jira.state() as JSONObject)["issues"] as Array<JSONObject>
  ).find((candidate: JSONObject): boolean => {
    return candidate["key"] === (key || ISSUE_KEY);
  });

  if (!found) {
    throw new Error(`Jira has no issue ${key || ISSUE_KEY}.`);
  }

  return found as JSONObject;
};

const recordsOf: (run: TemplateRun, kind: Kind) => Array<JSONObject> = (
  run: TemplateRun,
  kind: Kind,
): Array<JSONObject> => {
  return run.outcome.world[`${kind.noun}s`] as Array<JSONObject>;
};

const notesOf: (run: TemplateRun, kind: Kind) => Array<JSONObject> = (
  run: TemplateRun,
  kind: Kind,
): Array<JSONObject> => {
  return run.outcome.world[`${kind.noun}Notes`] as Array<JSONObject>;
};

const changesOf: (run: TemplateRun, kind: Kind) => Array<JSONObject> = (
  run: TemplateRun,
  kind: Kind,
): Array<JSONObject> => {
  return run.outcome.world[`${kind.noun}StateChanges`] as Array<JSONObject>;
};

// Every text an Atlassian Document Format body holds, in order.
const adfTexts: (value: JSONValue | undefined) => Array<string> = (
  value: JSONValue | undefined,
): Array<string> => {
  if (Array.isArray(value)) {
    return value.flatMap((entry: JSONValue) => {
      return adfTexts(entry);
    });
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  const object: JSONObject = value as JSONObject;

  return [
    ...(typeof object["text"] === "string" ? [object["text"]] : []),
    ...adfTexts(object["content"]),
  ];
};

describe("every Jira template is simulated", () => {
  test("the two kinds between them name every Jira template, and nothing else", () => {
    const simulated: Array<string> = KINDS.flatMap((kind: Kind) => {
      return [
        `jira-create-issue-for-${kind.noun}`,
        `jira-transition-issue-on-${kind.noun}-state`,
        ...kind.noteTemplates,
        `jira-comment-on-${kind.noun}-update`,
        kind.createFromIssue,
        `jira-status-to-${kind.noun}-state`,
        `jira-comment-to-${kind.noun}-private-note`,
        `jira-issue-changes-to-${kind.noun}-private-note`,
      ];
    });

    expect(simulated.sort()).toEqual(
      getWorkflowTemplatesByCategory(WorkflowTemplateCategory.Jira)
        .map((template: WorkflowTemplate): string => {
          return template.id;
        })
        .sort(),
    );
  });
});

/* ------------------------------- OneUptime -> Jira ------------------------------- */

describe.each(KINDS)("OneUptime to Jira, for an $noun", (kind: Kind) => {
  const outbound: (
    templateId: string,
    data: {
      record?: RecordProps;
      jira?: (fake: FakeJira, world: TemplateWorld) => void;
      trigger?: (world: TemplateWorld) => JSONObject;
    },
  ) => Promise<TemplateRun> = async (
    templateId: string,
    data: {
      record?: RecordProps;
      jira?: (fake: FakeJira, world: TemplateWorld) => void;
      trigger?: (world: TemplateWorld) => JSONObject;
    },
  ): Promise<TemplateRun> => {
    return await runNewTemplate({
      templateId: templateId,
      variables: VARIABLES,
      setUp: (world: TemplateWorld): void => {
        kind.add(world, data.record);
      },
      trigger:
        data.trigger ||
        ((world: TemplateWorld): JSONObject => {
          return recordTrigger(kind, world);
        }),
      tool: jiraTool(data.jira),
    });
  };

  const createIssue: string = `jira-create-issue-for-${kind.noun}`;
  const transition: string = `jira-transition-issue-on-${kind.noun}-state`;
  const update: string = `jira-comment-on-${kind.noun}-update`;

  test(`${createIssue}: files one issue, labelled with the ${kind.noun}'s id, whose description links back to it`, async () => {
    const run: TemplateRun = await outbound(createIssue, {});
    const created: Array<FakeJiraCall> = jiraWrites();

    expect(run.trace.executed).toEqual([
      `${kind.noun}-on-create-1`,
      "prepare-issue-1",
      "create-issue-1",
    ]);
    expect(run.trace.failedSteps).toEqual([]);
    expect(created).toHaveLength(1);
    expect(created[0]?.method).toBe("POST");
    expect(created[0]?.path).toBe("/rest/api/3/issue");

    const fields: JSONObject = (created[0]?.body as JSONObject)[
      "fields"
    ] as JSONObject;
    const record: BaseModel = kind.records(run.world)[0] as BaseModel;

    expect(fields["project"]).toEqual({ key: "OPS" });
    expect(fields["issuetype"]).toEqual({ name: "Task" });
    expect(fields["summary"]).toBe(
      `[OneUptime] ${kind.number}: Checkout API returns 502 for EU customers`,
    );
    expect(fields["labels"]).toEqual([
      "oneuptime",
      `oneuptime-${kind.noun}-${record.id!.toString()}`,
    ]);
    expect(adfTexts(fields["description"]).join("\n")).toContain(
      "Customers in eu-west-1 see 502s at checkout.",
    );
    expect(JSON.stringify(fields["description"])).toContain(
      `https://oneuptime.example.com/dashboard/`,
    );
    expect(JSON.stringify(fields["description"])).toContain(
      `/${kind.noun}s/${record.id!.toString()}`,
    );
  });

  test(`${createIssue}: an ${kind.noun} ${kind.created} from Jira files nothing, and Jira is not called`, async () => {
    const run: TemplateRun = await outbound(createIssue, {
      record: { customFields: { jiraIssueKey: "OPS-9" } },
    });

    expect(run.trace.ports["prepare-issue-1"]).toBe("no");
    expect(run.trace.portReasons["prepare-issue-1"]).toBe(
      `${kind.number} was ${kind.created} from Jira issue OPS-9, so no new issue was created.`,
    );
    expect(jira.calls).toEqual([]);
    expect(run.trace.failedSteps).toEqual([]);
  });

  test(`${createIssue}: a private ${kind.noun} stays in OneUptime: no request of any kind reaches Jira`, async () => {
    const run: TemplateRun = await outbound(createIssue, {
      record: { isPrivate: true },
    });

    expect(run.trace.ports["prepare-issue-1"]).toBe("no");
    expect(jira.calls).toEqual([]);
  });

  test(`${createIssue}: Jira refusing the issue fails the run, and the step says what Jira said`, async () => {
    const run: TemplateRun = await outbound(createIssue, {
      jira: (fake: FakeJira): void => {
        fake.refuseWritesWith = 400;
      },
    });

    expect(run.trace.failedSteps).toEqual(["create-issue-1"]);
    expect(
      JSON.stringify(
        run.trace.storage.local.components["create-issue-1"]?.returnValues,
      ),
    ).toContain("Jira refused the request.");
  });

  test(`${createIssue}: a title full of quotes, line breaks, backslashes and braces still sends valid JSON and a one-line summary`, async () => {
    const run: TemplateRun = await outbound(createIssue, {
      record: {
        title:
          'Disk "full" on db-1\n\\var\\lib {{local.variables.jiraBasicAuthToken}}',
      },
    });
    const fields: JSONObject = (jiraWrites()[0]?.body as JSONObject)[
      "fields"
    ] as JSONObject;

    expect(run.trace.failedSteps).toEqual([]);
    expect(String(fields["summary"])).not.toContain("\n");
    expect(String(fields["summary"])).toContain('Disk "full" on db-1');
    expect(JSON.stringify(fields)).not.toContain(FAKE_JIRA_TOKEN);
  });

  test.each([
    ["Acknowledged", TO_DO, "In Progress", "21"],
    ["Resolved", IN_PROGRESS, "Done", "31"],
  ] as Array<[string, JSONObject, string, string]>)(
    `${transition}: an ${kind.noun} %s moves its issue from where it is to %s`,
    async (
      stateName: string,
      from: JSONObject,
      to: string,
      transitionId: string,
    ) => {
      const run: TemplateRun = await outbound(transition, {
        record: { stateName },
        jira: linkedIssue(kind, from),
      });

      expect(issue()["status"]).toBe(to);
      expect(jiraWrites()).toEqual([
        {
          method: "POST",
          path: `/rest/api/3/issue/${ISSUE_KEY}/transitions`,
          body: { transition: { id: transitionId } },
        },
      ]);
      expect(run.trace.failedSteps).toEqual([]);
    },
  );

  test(`${transition}: an issue already Done is left alone after the search`, async () => {
    const run: TemplateRun = await outbound(transition, {
      record: { stateName: "Resolved" },
      jira: linkedIssue(kind, DONE),
    });

    expect(run.trace.ports["plan-transition-1"]).toBe("no");
    expect(jiraWrites()).toEqual([]);
    expect(run.trace.failedSteps).toEqual([]);
  });

  test(`${transition}: two issues carrying the ${kind.noun}'s label (a clone) move neither, and the reason names both`, async () => {
    const run: TemplateRun = await outbound(transition, {
      record: { stateName: "Resolved" },
      jira: (fake: FakeJira, world: TemplateWorld): void => {
        linkedIssue(kind)(fake, world);
        fake.add({ key: "OPS-30", labels: [linkLabel(kind, world)] });
      },
    });

    expect(jiraWrites()).toEqual([]);
    expect(run.trace.portReasons["plan-transition-1"]).toContain(
      `(${ISSUE_KEY}, OPS-30)`,
    );
  });

  test(`${transition}: a private ${kind.noun}'s issue is not moved`, async () => {
    const run: TemplateRun = await outbound(transition, {
      record: { stateName: "Resolved", isPrivate: true },
      jira: linkedIssue(kind),
    });

    expect(run.trace.ports["plan-transition-1"]).toBe("no");
    expect(issue()["status"]).toBe("To Do");
  });

  test(`${transition}: no linked issue: only the search is sent, and the reason says why`, async () => {
    const run: TemplateRun = await outbound(transition, {
      record: { stateName: "Acknowledged" },
    });

    expect(
      jira.calls.map((call: FakeJiraCall): string => {
        return `${call.method} ${call.path}`;
      }),
    ).toEqual(["POST /rest/api/3/search/jql"]);
    expect(run.trace.portReasons["plan-transition-1"]).toContain(
      `No Jira issue is labelled oneuptime-${kind.noun}-`,
    );
  });

  test(`${transition}: credentials Jira refuses fail the run at the search, which says what Jira said`, async () => {
    const run: TemplateRun = await outbound(transition, {
      record: { stateName: "Acknowledged" },
      jira: (fake: FakeJira, world: TemplateWorld): void => {
        linkedIssue(kind)(fake, world);
        fake.token = "another-token";
      },
    });

    expect(run.trace.failedSteps).toEqual(["find-issue-1"]);
    expect(
      JSON.stringify(
        run.trace.storage.local.components["find-issue-1"]?.returnValues,
      ),
    ).toContain("Client must be authenticated");
  });

  test.each(kind.noteTemplates)(
    "%s: a note is an internal comment on the linked issue, marked as OneUptime's",
    async (templateId: string) => {
      const run: TemplateRun = await outbound(templateId, {
        jira: linkedIssue(kind),
        trigger: (world: TemplateWorld): JSONObject => {
          return noteTrigger(kind, world, "Rolled back the eu-west-1 deploy.");
        },
      });
      const comments: Array<JSONValue> = issue()[
        "comments"
      ] as Array<JSONValue>;

      expect(run.trace.failedSteps).toEqual([]);
      expect(comments).toHaveLength(1);

      const texts: string = adfTexts((comments[0] as JSONObject)["body"]).join(
        "\n",
      );

      expect(texts).toContain(JIRA_SYNCED_FROM_ONEUPTIME_MARKER);
      expect(texts).toContain("Rolled back the eu-west-1 deploy.");
      expect(texts).toContain("Jane Doe");
    },
  );

  test.each(kind.noteTemplates)(
    "%s: a note that came from Jira is not posted back",
    async (templateId: string) => {
      const run: TemplateRun = await outbound(templateId, {
        jira: linkedIssue(kind),
        trigger: (world: TemplateWorld): JSONObject => {
          return noteTrigger(
            kind,
            world,
            `${ONEUPTIME_SYNCED_FROM_JIRA_MARKER}: Marco Rossi commented on OPS-17.`,
          );
        },
      });

      expect(run.trace.ports["build-comment-1"]).toBe("no");
      expect(jiraWrites()).toEqual([]);
    },
  );

  test.each(kind.noteTemplates)(
    "%s: a note on a private record stays in OneUptime",
    async (templateId: string) => {
      const run: TemplateRun = await outbound(templateId, {
        record: { isPrivate: true },
        jira: linkedIssue(kind),
        trigger: (world: TemplateWorld): JSONObject => {
          return noteTrigger(kind, world, "Rolled back.");
        },
      });

      expect(run.trace.ports["build-comment-1"]).toBe("no");
      expect(jiraWrites()).toEqual([]);
    },
  );

  test.each(kind.noteTemplates)(
    "%s: a note on a record no issue is linked to posts nothing",
    async (templateId: string) => {
      const run: TemplateRun = await outbound(templateId, {
        trigger: (world: TemplateWorld): JSONObject => {
          return noteTrigger(kind, world, "Rolled back.");
        },
      });

      expect(run.trace.ports["build-comment-1"]).toBe("no");
      expect(jiraWrites()).toEqual([]);
      expect(run.trace.failedSteps).toEqual([]);
    },
  );

  test(`${update}: an edit is an internal comment listing the ${kind.noun}'s title, severity, state, root cause and remediation`, async () => {
    const run: TemplateRun = await outbound(update, {
      jira: linkedIssue(kind),
    });
    const comments: Array<JSONValue> = issue()["comments"] as Array<JSONValue>;

    expect(run.trace.failedSteps).toEqual([]);
    expect(comments).toHaveLength(1);

    const texts: string = adfTexts((comments[0] as JSONObject)["body"]).join(
      "\n",
    );

    expect(texts).toContain(`${kind.number} was updated.`);
    expect(texts).toContain("Title: Checkout API returns 502 for EU customers");
    expect(texts).toContain(`Severity: ${kind.severities[0]}`);
  });

  test(`${update}: a private ${kind.noun}'s changes are not posted`, async () => {
    const run: TemplateRun = await outbound(update, {
      record: { isPrivate: true },
      jira: linkedIssue(kind),
    });

    expect(run.trace.ports["build-comment-1"]).toBe("no");
    expect(jiraWrites()).toEqual([]);
  });
});

/* ------------------------------- Jira -> OneUptime ------------------------------- */

describe.each(KINDS)("Jira to OneUptime, for an $noun", (kind: Kind) => {
  const inbound: (
    templateId: string,
    data: {
      event: (world: TemplateWorld) => JSONValue;
      setUp?: (world: TemplateWorld) => void;
      jira?: (fake: FakeJira, world: TemplateWorld) => void;
      variables?: { [name: string]: string } | undefined;
    },
  ) => Promise<TemplateRun> = async (
    templateId: string,
    data: {
      event: (world: TemplateWorld) => JSONValue;
      setUp?: (world: TemplateWorld) => void;
      jira?: (fake: FakeJira, world: TemplateWorld) => void;
      variables?: { [name: string]: string } | undefined;
    },
  ): Promise<TemplateRun> => {
    return await runNewTemplate({
      templateId: templateId,
      variables: data.variables || VARIABLES,
      setUp: data.setUp,
      trigger: (world: TemplateWorld): JSONObject => {
        return webhookTrigger(data.event(world));
      },
      tool: jiraTool(data.jira),
    });
  };

  const anIssue: (fake: FakeJira) => void = (fake: FakeJira): void => {
    fake.add({ key: ISSUE_KEY });
  };

  const withARecord: (props?: RecordProps) => (world: TemplateWorld) => void = (
    props?: RecordProps,
  ): ((world: TemplateWorld) => void) => {
    return (world: TemplateWorld): void => {
      kind.add(world, props);
    };
  };

  const create: string = kind.createFromIssue;
  const status: string = `jira-status-to-${kind.noun}-state`;
  const comment: string = `jira-comment-to-${kind.noun}-private-note`;
  const changes: string = `jira-issue-changes-to-${kind.noun}-private-note`;

  test(`${create}: ${kind.created === "declared" ? "declares" : "creates"} an ${kind.noun} at the severity the priority maps to, then labels the issue with its id`, async () => {
    const run: TemplateRun = await inbound(create, {
      event: (): JSONObject => {
        return jiraIssueCreatedEvent();
      },
      jira: anIssue,
    });
    const records: Array<JSONObject> = recordsOf(run, kind);

    expect(run.trace.executed).toEqual([
      "webhook-1",
      "get-issue-1",
      `prepare-${kind.noun}-1`,
      kind.step,
      "link-issue-1",
    ]);
    expect(run.trace.failedSteps).toEqual([]);
    expect(records).toEqual([
      expect.objectContaining({
        number: kind.number,
        title: "Checkout API returns 502 for EU customers",
        severity: kind.severities[0],
        customFields: { jiraIssueKey: ISSUE_KEY },
        ...(kind === INCIDENT
          ? {
              isVisibleOnStatusPage: false,
              shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: false,
            }
          : {}),
      }),
    ]);
    expect(String(records[0]?.["description"]).split("\n")[0]).toBe(
      `${kind.Created} from Jira issue ${ISSUE_LINK}.`,
    );
    expect(issue()["labels"]).toEqual(
      ["oneuptime", linkLabel(kind, run.world)].sort(),
    );
  });

  test.each([
    ["Medium", 1],
    ["Low", 2],
    ["Lowest", 2],
    ["Highest", 0],
  ] as Array<[string, number]>)(
    `${create}: an issue of priority %s lands on the project's severity at place %p`,
    async (priority: string, place: number) => {
      const run: TemplateRun = await inbound(create, {
        event: (): JSONObject => {
          return jiraIssueCreatedEvent({ priority });
        },
        jira: anIssue,
      });

      expect(recordsOf(run, kind)[0]?.["severity"]).toBe(
        kind.severities[place],
      );
    },
  );

  test(`${create}: an issue whose event shows it linked opens nothing, and labels nothing`, async () => {
    const run: TemplateRun = await inbound(create, {
      event: (): JSONObject => {
        return jiraIssueCreatedEvent({
          labels: ["oneuptime", `oneuptime-${kind.noun}-x`],
        });
      },
      jira: anIssue,
    });

    expect(kind.records(run.world)).toHaveLength(0);
    expect(run.trace.ports[`prepare-${kind.noun}-1`]).toBe("no");
    expect(jiraWrites()).toEqual([]);
  });

  test(`${create}: an issue Jira says is linked opens nothing, whatever the event says`, async () => {
    const run: TemplateRun = await inbound(create, {
      event: (): JSONObject => {
        return jiraIssueCreatedEvent({ labels: [] });
      },
      jira: (fake: FakeJira): void => {
        fake.add({ key: ISSUE_KEY, labels: ["oneuptime"] });
      },
    });

    expect(kind.records(run.world)).toHaveLength(0);
    expect(run.trace.portReasons[`prepare-${kind.noun}-1`]).toBe(
      `Jira issue ${ISSUE_KEY} is already linked to OneUptime, so no ${kind.noun} was ${kind.created}.`,
    );
  });

  test(`${create}: an issue Jira will not return fails the run at the read, and opens nothing`, async () => {
    const run: TemplateRun = await inbound(create, {
      event: (): JSONObject => {
        return jiraIssueCreatedEvent();
      },
    });

    expect(kind.records(run.world)).toHaveLength(0);
    expect(run.trace.failedSteps).toEqual(["get-issue-1"]);
  });

  test(`${create}: a key that is not a plain one is never put in a URL: the read refuses it`, async () => {
    const run: TemplateRun = await inbound(create, {
      event: (): JSONObject => {
        const event: JSONObject = jiraIssueCreatedEvent();

        (event["issue"] as JSONObject)["key"] = "../../myself";
        return event;
      },
      jira: anIssue,
    });

    expect(kind.records(run.world)).toHaveLength(0);
    expect(run.trace.failedSteps).toEqual(["get-issue-1"]);
    expect(jira.calls).toEqual([]);
  });

  test(`${create}: an issue_updated delivery to this webhook opens nothing`, async () => {
    const run: TemplateRun = await inbound(create, {
      event: (): JSONObject => {
        return jiraIssueUpdatedEvent({ items: STARTED_CHANGELOG });
      },
      jira: anIssue,
    });

    expect(kind.records(run.world)).toHaveLength(0);
    expect(run.trace.portReasons[`prepare-${kind.noun}-1`]).toBe(
      "Ignored a jira:issue_updated event: this workflow only handles jira:issue_created.",
    );
  });

  test(`${create}: Jira refusing the labels leaves the ${kind.noun} open, and fails the run at the link`, async () => {
    const run: TemplateRun = await inbound(create, {
      event: (): JSONObject => {
        return jiraIssueCreatedEvent();
      },
      jira: (fake: FakeJira): void => {
        anIssue(fake);
        fake.refuseWritesWith = 400;
      },
    });

    expect(kind.records(run.world)).toHaveLength(1);
    expect(run.trace.failedSteps).toEqual(["link-issue-1"]);
  });

  test(`${create}: Jira sending the event again opens no second ${kind.noun}, and labels nothing again`, async () => {
    const run: TemplateRun = await inbound(create, {
      event: (): JSONObject => {
        return jiraIssueCreatedEvent({ labels: [] });
      },
      setUp: withARecord({ customFields: { jiraIssueKey: ISSUE_KEY } }),
      jira: anIssue,
    });

    expect(kind.records(run.world)).toHaveLength(1);
    expect(run.trace.ports[kind.step]).toBe("unchanged");
    expect(jiraWrites()).toEqual([]);
  });

  test(`${status}: Done resolves an acknowledged ${kind.noun}, saying why on its timeline`, async () => {
    const run: TemplateRun = await inbound(status, {
      setUp: withARecord({ stateName: "Acknowledged" }),
      event: (world: TemplateWorld): JSONObject => {
        return jiraIssueUpdatedEvent({
          labels: ["oneuptime", linkLabel(kind, world)],
          items: RESOLVED_CHANGELOG,
          status: DONE,
        });
      },
    });

    expect(recordsOf(run, kind)[0]?.["state"]).toBe("Resolved");
    expect(changesOf(run, kind)).toEqual([
      {
        record: kind.number,
        state: "Resolved",
        rootCause: `${ONEUPTIME_SYNCED_FROM_JIRA_MARKER}: issue ${ISSUE_KEY} moved to Done by Priya Patel.`,
      },
    ]);
    expect(run.trace.failedSteps).toEqual([]);
  });

  test(`${status}: In Progress acknowledges a new ${kind.noun}`, async () => {
    const run: TemplateRun = await inbound(status, {
      setUp: withARecord(),
      event: (world: TemplateWorld): JSONObject => {
        return jiraIssueUpdatedEvent({
          labels: ["oneuptime", linkLabel(kind, world)],
          items: STARTED_CHANGELOG,
          status: IN_PROGRESS,
        });
      },
    });

    expect(recordsOf(run, kind)[0]?.["state"]).toBe("Acknowledged");
  });

  test(`${status}: an ${kind.noun} already resolved is not moved again`, async () => {
    const run: TemplateRun = await inbound(status, {
      setUp: withARecord({ stateName: "Resolved" }),
      event: (world: TemplateWorld): JSONObject => {
        return jiraIssueUpdatedEvent({
          labels: ["oneuptime", linkLabel(kind, world)],
          items: RESOLVED_CHANGELOG,
          status: DONE,
        });
      },
    });

    expect(changesOf(run, kind)).toEqual([]);
    expect(run.trace.ports[kind.step]).toBe("unchanged");
    expect(run.trace.failedSteps).toEqual([]);
  });

  test(`${status}: moving the issue back to To Do never moves the ${kind.noun} backwards`, async () => {
    const run: TemplateRun = await inbound(status, {
      setUp: withARecord({ stateName: "Acknowledged" }),
      event: (world: TemplateWorld): JSONObject => {
        return jiraIssueUpdatedEvent({
          labels: ["oneuptime", linkLabel(kind, world)],
          items: STARTED_CHANGELOG,
          status: TO_DO,
        });
      },
    });

    expect(run.trace.ports["read-event-1"]).toBe("no");
    expect(changesOf(run, kind)).toEqual([]);
  });

  test(`${status}: an issue with no ${kind.noun} label touches nothing`, async () => {
    const run: TemplateRun = await inbound(status, {
      setUp: withARecord(),
      event: (): JSONObject => {
        return jiraIssueUpdatedEvent({
          labels: ["oneuptime"],
          items: RESOLVED_CHANGELOG,
          status: DONE,
        });
      },
    });

    expect(run.trace.ports["read-event-1"]).toBe("no");
    expect(changesOf(run, kind)).toEqual([]);
  });

  test(`${status}: a label naming an ${kind.noun} this project does not have changes nothing`, async () => {
    const run: TemplateRun = await inbound(status, {
      setUp: withARecord(),
      event: (): JSONObject => {
        return jiraIssueUpdatedEvent({
          labels: [
            "oneuptime",
            `oneuptime-${kind.noun}-dddddddd-0000-4000-8000-000000000099`,
          ],
          items: RESOLVED_CHANGELOG,
          status: DONE,
        });
      },
    });

    // The record step finds no such record in the project, and goes on by Unchanged.
    expect(changesOf(run, kind)).toEqual([]);
    expect(run.trace.ports[kind.step]).toBe("unchanged");
    expect(run.trace.failedSteps).toEqual([]);
  });

  test(`${comment}: reads the link off the issue as Jira has it, and writes the comment as a private note`, async () => {
    const run: TemplateRun = await inbound(comment, {
      setUp: withARecord(),
      event: (): JSONObject => {
        return jiraCommentEvent();
      },
      jira: linkedIssue(kind),
    });

    expect(run.trace.executed).toEqual([
      "webhook-1",
      "get-issue-1",
      "read-comment-1",
      kind.step,
    ]);
    expect(notesOf(run, kind)).toEqual([
      {
        record: kind.number,
        note: `${ONEUPTIME_SYNCED_FROM_JIRA_MARKER}: Marco Rossi commented on ${ISSUE_LINK}.\n\nRolled back the *eu-west-1* deploy. Watching the error rate.`,
      },
    ]);
  });

  test(`${comment}: a comment OneUptime posted is not copied back`, async () => {
    const run: TemplateRun = await inbound(comment, {
      setUp: withARecord(),
      event: (): JSONObject => {
        return jiraCommentEvent({
          body: `${JIRA_SYNCED_FROM_ONEUPTIME_MARKER}: private note on ${kind.number} by Jane Doe.\n\nFailed over.`,
        });
      },
      jira: linkedIssue(kind),
    });

    expect(run.trace.ports["read-comment-1"]).toBe("no");
    expect(notesOf(run, kind)).toEqual([]);
  });

  test(`${comment}: an issue without the labels writes no note`, async () => {
    const run: TemplateRun = await inbound(comment, {
      setUp: withARecord(),
      event: (): JSONObject => {
        return jiraCommentEvent();
      },
      jira: anIssue,
    });

    expect(run.trace.ports["read-comment-1"]).toBe("no");
    expect(notesOf(run, kind)).toEqual([]);
  });

  test(`${changes}: a priority change is noted on the linked ${kind.noun}`, async () => {
    const run: TemplateRun = await inbound(changes, {
      setUp: withARecord(),
      event: (world: TemplateWorld): JSONObject => {
        return jiraIssueUpdatedEvent({
          labels: ["oneuptime", linkLabel(kind, world)],
          items: [
            changelogItem({
              field: "priority",
              from: "2",
              fromString: "High",
              to: "1",
              toString: "Highest",
            }),
          ],
        });
      },
    });

    expect(notesOf(run, kind)).toEqual([
      {
        record: kind.number,
        note: `${ONEUPTIME_SYNCED_FROM_JIRA_MARKER}: Priya Patel updated ${ISSUE_LINK}.\n\n- priority: High → Highest`,
      },
    ]);
  });

  test.each([
    [
      "adding only the link labels",
      changelogItem({
        field: "labels",
        fromString: "",
        toString: "oneuptime",
      }),
    ],
    ["a status change, left to the status template", RESOLVED_CHANGELOG[1]],
    [
      "a Rank change, sent as customfield_10019",
      {
        field: "Rank",
        fieldtype: "custom",
        fieldId: "customfield_10019",
        from: "",
        fromString: "",
        to: "",
        toString: "Ranked higher",
      },
    ],
  ] as Array<[string, JSONObject]>)(
    `${changes}: %s is not worth a note`,
    async (_name: string, item: JSONObject) => {
      const run: TemplateRun = await inbound(changes, {
        setUp: withARecord(),
        event: (world: TemplateWorld): JSONObject => {
          return jiraIssueUpdatedEvent({
            labels: ["oneuptime", linkLabel(kind, world)],
            items: [item],
          });
        },
      });

      expect(run.trace.ports["read-changes-1"]).toBe("no");
      expect(notesOf(run, kind)).toEqual([]);
    },
  );

  test(`${comment}: an issue URL naming another host is noted with a link to the configured site`, async () => {
    const run: TemplateRun = await inbound(comment, {
      setUp: withARecord(),
      event: (): JSONObject => {
        const event: JSONObject = jiraCommentEvent();

        (event["issue"] as JSONObject)["self"] =
          "https://evil.example/rest/api/2/issue/10040";
        return event;
      },
      jira: linkedIssue(kind),
    });

    expect(String(notesOf(run, kind)[0]?.["note"])).toContain(ISSUE_LINK);
    expect(String(notesOf(run, kind)[0]?.["note"])).not.toContain(
      "evil.example",
    );
  });

  test(`${changes}: with the Jira Site URL variable emptied, the note names the issue without a link, and is still written`, async () => {
    const run: TemplateRun = await inbound(changes, {
      variables: { ...VARIABLES, jiraSiteUrl: "" },
      setUp: withARecord(),
      event: (world: TemplateWorld): JSONObject => {
        return jiraIssueUpdatedEvent({
          labels: ["oneuptime", linkLabel(kind, world)],
          items: [
            changelogItem({
              field: "assignee",
              fromString: null,
              toString: "Marco Rossi",
            }),
          ],
          self: "",
        });
      },
    });

    expect(String(notesOf(run, kind)[0]?.["note"])).toContain(
      `updated ${ISSUE_KEY}.`,
    );
  });
});

/* ------------------------------- Round trips ------------------------------- */

/*
 * What one direction writes comes back through the other. Each round trip
 * runs the first template, hands what it wrote to the second as the event
 * that write fires, and expects the second to write nothing.
 */
describe.each(KINDS)("round trips, for an $noun", (kind: Kind) => {
  test(`the issue OneUptime files comes back as issue_created, and ${kind.created === "declared" ? "declares" : "creates"} no second ${kind.noun}`, async () => {
    const run: TemplateRun = await runNewTemplate({
      templateId: kind.createFromIssue,
      variables: VARIABLES,
      setUp: (world: TemplateWorld): void => {
        kind.add(world);
      },
      trigger: (world: TemplateWorld): JSONObject => {
        // As Jira delivers the issue the create template filed: labelled with the record's link.
        return webhookTrigger(
          jiraIssueCreatedEvent({
            labels: ["oneuptime", linkLabel(kind, world)],
          }),
        );
      },
      tool: jiraTool(linkedIssue(kind)),
    });

    expect(kind.records(run.world)).toHaveLength(1);
    expect(run.trace.ports[`prepare-${kind.noun}-1`]).toBe("no");
  });

  test(`the ${kind.noun} ${kind.created} from Jira comes back through ${kind.noun}-on-create, and files no second issue`, async () => {
    const run: TemplateRun = await runNewTemplate({
      templateId: `jira-create-issue-for-${kind.noun}`,
      variables: VARIABLES,
      setUp: (world: TemplateWorld): void => {
        kind.add(world, { customFields: { jiraIssueKey: ISSUE_KEY } });
      },
      trigger: (world: TemplateWorld): JSONObject => {
        return recordTrigger(kind, world);
      },
      tool: jiraTool(),
    });

    expect(run.trace.ports["prepare-issue-1"]).toBe("no");
    expect(jira.calls).toEqual([]);
  });

  test("the note a Jira comment becomes fires the private-note template, and posts no comment back", async () => {
    const run: TemplateRun = await runNewTemplate({
      templateId: `jira-comment-from-${kind.noun}-private-note`,
      variables: VARIABLES,
      setUp: (world: TemplateWorld): void => {
        kind.add(world);
      },
      trigger: (world: TemplateWorld): JSONObject => {
        return noteTrigger(
          kind,
          world,
          `${ONEUPTIME_SYNCED_FROM_JIRA_MARKER}: Marco Rossi commented on ${ISSUE_LINK}.\n\nRolled back.`,
        );
      },
      tool: jiraTool(linkedIssue(kind)),
    });

    expect(run.trace.ports["build-comment-1"]).toBe("no");
    expect(jiraWrites()).toEqual([]);
  });

  test(`the comment an ${kind.noun} edit posts comes back as comment_created, and writes no note`, async () => {
    const run: TemplateRun = await runNewTemplate({
      templateId: `jira-comment-to-${kind.noun}-private-note`,
      variables: VARIABLES,
      setUp: (world: TemplateWorld): void => {
        kind.add(world);
      },
      trigger: (): JSONObject => {
        return webhookTrigger(
          jiraCommentEvent({
            body: `${JIRA_SYNCED_FROM_ONEUPTIME_MARKER}: ${kind.number} was updated.\nTitle: Checkout API returns 502 for EU customers`,
          }),
        );
      },
      tool: jiraTool(linkedIssue(kind)),
    });

    expect(run.trace.ports["read-comment-1"]).toBe("no");
    expect(notesOf(run, kind)).toEqual([]);
  });

  test(`resolving from Jira resolves the ${kind.noun}, and the ${kind.noun}-on-update that follows finds the issue already Done and moves nothing`, async () => {
    const run: TemplateRun = await runNewTemplate({
      templateId: `jira-transition-issue-on-${kind.noun}-state`,
      variables: VARIABLES,
      setUp: (world: TemplateWorld): void => {
        kind.add(world, { stateName: "Resolved" });
      },
      trigger: (world: TemplateWorld): JSONObject => {
        return recordTrigger(kind, world);
      },
      tool: jiraTool(linkedIssue(kind, DONE)),
    });

    expect(run.trace.ports["plan-transition-1"]).toBe("no");
    expect(jiraWrites()).toEqual([]);
  });

  test("resolving in OneUptime moves the issue to Done, and the issue_updated that follows changes nothing", async () => {
    const run: TemplateRun = await runNewTemplate({
      templateId: `jira-status-to-${kind.noun}-state`,
      variables: VARIABLES,
      setUp: (world: TemplateWorld): void => {
        kind.add(world, { stateName: "Resolved" });
      },
      trigger: (world: TemplateWorld): JSONObject => {
        return webhookTrigger(
          jiraIssueUpdatedEvent({
            labels: ["oneuptime", linkLabel(kind, world)],
            items: RESOLVED_CHANGELOG,
            status: DONE,
            user: jiraUser("OneUptime Automation"),
          }),
        );
      },
      tool: jiraTool(),
    });

    expect(run.trace.ports[kind.step]).toBe("unchanged");
    expect(changesOf(run, kind)).toEqual([]);
  });
});

/* ------------------------------- Across kinds ------------------------------- */

/*
 * A project can enable both sets at once, and an issue linked to one kind
 * of record must never be taken for the other.
 */
describe("an issue linked to one kind is never taken for the other", () => {
  test.each([
    [INCIDENT, ALERT],
    [ALERT, INCIDENT],
  ] as Array<[Kind, Kind]>)(
    "the issue the %s set files opens no record of the other kind",
    async (linked: Kind, other: Kind) => {
      const run: TemplateRun = await runNewTemplate({
        templateId: other.createFromIssue,
        variables: VARIABLES,
        trigger: (): JSONObject => {
          return webhookTrigger(
            jiraIssueCreatedEvent({
              labels: [
                "oneuptime",
                `oneuptime-${linked.noun}-dddddddd-0000-4000-8000-000000000001`,
              ],
            }),
          );
        },
        tool: jiraTool((fake: FakeJira): void => {
          fake.add({ key: ISSUE_KEY });
        }),
      });

      expect(other.records(run.world)).toHaveLength(0);
      expect(run.trace.ports[`prepare-${other.noun}-1`]).toBe("no");
    },
  );

  test.each([
    [INCIDENT, ALERT],
    [ALERT, INCIDENT],
  ] as Array<[Kind, Kind]>)(
    "a status change on the %s's issue moves no record of the other kind",
    async (linked: Kind, other: Kind) => {
      const scenario: EquivalenceScenario = {
        templateId: `jira-status-to-${other.noun}-state`,
        variables: VARIABLES,
        setUp: (world: TemplateWorld): void => {
          linked.add(world);
          other.add(world);
        },
        trigger: (world: TemplateWorld): JSONObject => {
          return webhookTrigger(
            jiraIssueUpdatedEvent({
              labels: ["oneuptime", linkLabel(linked, world)],
              items: RESOLVED_CHANGELOG,
              status: DONE,
            }),
          );
        },
        tool: jiraTool(),
      };
      const run: TemplateRun = await runNewTemplate(scenario);

      expect(run.trace.ports["read-event-1"]).toBe("no");
      expect(changesOf(run, other)).toEqual([]);
      expect(changesOf(run, linked)).toEqual([]);
    },
  );
});

/* ------------------------------- The token ------------------------------- */

describe("the Jira API token", () => {
  test("is sent in every request's Authorization header, and appears nowhere else", async () => {
    const runs: Array<TemplateRun> = [];

    runs.push(
      await runNewTemplate({
        templateId: "jira-create-issue-for-incident",
        variables: VARIABLES,
        setUp: (world: TemplateWorld): void => {
          INCIDENT.add(world, {
            title: `Leak {{local.variables.jiraBasicAuthToken}}`,
          });
        },
        trigger: (world: TemplateWorld): JSONObject => {
          return recordTrigger(INCIDENT, world);
        },
        tool: jiraTool(),
      }),
    );

    const calls: Array<FakeJiraCall> = jira.calls;

    expect(calls.length).toBeGreaterThan(0);

    for (const call of calls) {
      expect(JSON.stringify(call.body || null)).not.toContain(FAKE_JIRA_TOKEN);
      expect(call.path).not.toContain(FAKE_JIRA_TOKEN);
    }

    for (const run of runs) {
      expect(JSON.stringify(run.outcome.world)).not.toContain(FAKE_JIRA_TOKEN);
    }
  });
});
