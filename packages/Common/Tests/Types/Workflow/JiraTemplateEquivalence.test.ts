/*
 * The Jira templates before and after they were made simple, on the same
 * events (TemplateEquivalence): eight to eighteen steps each before - a
 * script, an If / Else on its decision, Finds and Creates, and a Log on
 * every way out - and three to five now, on Check With JavaScript, API Get
 * By ID and Incident or Alert From Another Tool. Each event runs through the
 * old graph and the new template against a project and a Jira of their own
 * (FakeJira), made the same way, and must leave the same records, notes and
 * state changes, and the same issues, labels, statuses and comments in Jira.
 *
 * Reads of Jira are not compared, only what was written: two templates now
 * read the issue before they read the event (the issue's labels are what
 * links it), so an event they ignore costs one more read than it did.
 */

import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Alert from "../../../Models/DatabaseModels/Alert";
import Incident from "../../../Models/DatabaseModels/Incident";
import WorkflowPrincipal, {
  WorkflowPrincipalOptions,
} from "../../../Server/Utils/Workflow/WorkflowPrincipal";
import { JSONObject } from "../../../Types/JSON";
import {
  JIRA_SYNCED_FROM_ONEUPTIME_MARKER,
  ONEUPTIME_SYNCED_FROM_JIRA_MARKER,
} from "../../../Types/Workflow/Templates";
import FakeJira, { FAKE_JIRA_SITE, FAKE_JIRA_TOKEN } from "./FakeJira";
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
} from "./JiraTemplateFixtures";
import { EquivalenceRun, OtherTool, runOldAndNew } from "./TemplateEquivalence";
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

jest.setTimeout(180000);

const VARIABLES: { [name: string]: string } = {
  jiraBaseUrl: FAKE_JIRA_SITE,
  jiraSiteUrl: FAKE_JIRA_SITE,
  jiraBasicAuthToken: FAKE_JIRA_TOKEN,
  jiraProjectKey: "OPS",
  jiraIssueType: "Task",
  oneuptimeUrl: "https://oneuptime.example.com",
};

const ISSUE_KEY: string = "OPS-17";

interface Kind {
  noun: "incident" | "alert";
  create: string;
  modelType: { new (): BaseModel };
  idColumn: string;
  numberField: string;
  hasPublicNotes: boolean;
  records: (world: TemplateWorld) => Array<BaseModel>;
  add: (world: TemplateWorld, props?: RecordProps) => BaseModel;
}

interface RecordProps {
  stateName?: string | undefined;
  isPrivate?: boolean | undefined;
  customFields?: JSONObject | undefined;
}

const withPrivacy: (record: BaseModel, props?: RecordProps) => BaseModel = (
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
  create: "declare",
  modelType: Incident,
  idColumn: "incidentId",
  numberField: "incidentNumberWithPrefix",
  hasPublicNotes: true,
  records: (world: TemplateWorld): Array<BaseModel> => {
    return world.incidents.records.rows;
  },
  add: (world: TemplateWorld, props?: RecordProps): BaseModel => {
    return withPrivacy(
      world.addIncident({
        title: "Checkout API returns 502 for EU customers",
        stateName: props?.stateName,
        customFields: props?.customFields,
      }),
      props,
    );
  },
};

const ALERT: Kind = {
  noun: "alert",
  create: "create",
  modelType: Alert,
  idColumn: "alertId",
  numberField: "alertNumberWithPrefix",
  hasPublicNotes: false,
  records: (world: TemplateWorld): Array<BaseModel> => {
    return world.alerts.records.rows;
  },
  add: (world: TemplateWorld, props?: RecordProps): BaseModel => {
    return withPrivacy(
      world.addAlert({
        title: "Checkout API returns 502 for EU customers",
        stateName: props?.stateName,
        customFields: props?.customFields,
      }),
      props,
    );
  },
};

const KINDS: Array<Kind> = [INCIDENT, ALERT];

// The label a linked issue carries for the project's first record.
const linkLabel: (kind: Kind, world: TemplateWorld) => string = (
  kind: Kind,
  world: TemplateWorld,
): string => {
  return `oneuptime-${kind.noun}-${(kind.records(world)[0] as BaseModel).id!.toString()}`;
};

// A Jira of its own for each run, set up from the project: issues linked to its records.
const jiraWith: (
  setUp?: (jira: FakeJira, world: TemplateWorld) => void,
) => (world: TemplateWorld) => OtherTool = (
  setUp?: (jira: FakeJira, world: TemplateWorld) => void,
): ((world: TemplateWorld) => OtherTool) => {
  return (world: TemplateWorld): OtherTool => {
    const jira: FakeJira = new FakeJira();

    if (setUp) {
      setUp(jira, world);
    }

    return {
      http: (request: SimulatedRequest): SimulatedReply => {
        return jira.answer(request);
      },
      state: () => {
        return jira.state();
      },
    };
  };
};

const expectSameOutcome: (run: EquivalenceRun) => void = (
  run: EquivalenceRun,
): void => {
  expect(run.new.world).toEqual(run.old.world);
  expect(run.new.tool).toEqual(run.old.tool);
  expect(run.new.failed).toBe(run.old.failed);
};

beforeEach(() => {
  stubDnsLookups("93.184.216.34");

  jest.spyOn(WorkflowPrincipal, "getProps").mockImplementation((async (
    data: WorkflowPrincipalOptions,
  ) => {
    return WorkflowPrincipal.getPropsWithoutPlan(data);
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

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

/* ------------------------------- OneUptime -> Jira ------------------------------- */

describe.each(KINDS)(
  "OneUptime to Jira, for an $noun, old and new",
  (kind: Kind) => {
    const outbound: (
      templateId: string,
      data: {
        record?: RecordProps;
        jira?: (jira: FakeJira, world: TemplateWorld) => void;
        trigger?: (world: TemplateWorld) => JSONObject;
      },
    ) => Promise<EquivalenceRun> = async (
      templateId: string,
      data: {
        record?: RecordProps;
        jira?: (jira: FakeJira, world: TemplateWorld) => void;
        trigger?: (world: TemplateWorld) => JSONObject;
      },
    ): Promise<EquivalenceRun> => {
      return await runOldAndNew({
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
        tool: jiraWith(data.jira),
      });
    };

    const linked: (
      status?: JSONObject,
    ) => (jira: FakeJira, world: TemplateWorld) => void = (
      status?: JSONObject,
    ): ((jira: FakeJira, world: TemplateWorld) => void) => {
      return (jira: FakeJira, world: TemplateWorld): void => {
        jira.add({
          key: ISSUE_KEY,
          labels: ["oneuptime", linkLabel(kind, world)],
          status: status || TO_DO,
        });
      };
    };

    test.each([
      ["a new record files an issue", {}],
      ["a private record files none", { isPrivate: true }],
      [
        "a record created from Jira files none",
        { customFields: { jiraIssueKey: "OPS-9" } },
      ],
    ] as Array<[string, RecordProps]>)(
      `jira-create-issue-for-${kind.noun}: %s`,
      async (_name: string, record: RecordProps) => {
        const run: EquivalenceRun = await outbound(
          `jira-create-issue-for-${kind.noun}`,
          {
            record,
          },
        );

        expectSameOutcome(run);
        // A new record's issue is filed, labelled with the record's link; the others file none.
        expect(
          ((run.new.tool as JSONObject)["issues"] as Array<JSONObject>).map(
            (issue: JSONObject) => {
              return issue["labels"];
            },
          ),
        ).toEqual(
          Object.keys(record).length === 0
            ? [
                [
                  "oneuptime",
                  `oneuptime-${kind.noun}-<${kind === INCIDENT ? "INC-1" : "ALT-1"}>`,
                ],
              ]
            : [],
        );
      },
    );

    test(`jira-create-issue-for-${kind.noun}: Jira refusing the issue fails the run, in both`, async () => {
      const run: EquivalenceRun = await outbound(
        `jira-create-issue-for-${kind.noun}`,
        {
          jira: (jira: FakeJira): void => {
            jira.refuseWritesWith = 400;
          },
        },
      );

      expectSameOutcome(run);
      expect(run.new.failed).toBe(true);
    });

    test.each([
      [
        "acknowledged moves the issue to In Progress",
        "Acknowledged",
        TO_DO,
        true,
      ],
      ["resolved moves the issue to Done", "Resolved", IN_PROGRESS, true],
      ["resolved leaves an issue already Done", "Resolved", DONE, true],
      [
        "acknowledged with no linked issue does nothing",
        "Acknowledged",
        TO_DO,
        false,
      ],
    ] as Array<[string, string, JSONObject, boolean]>)(
      `jira-transition-issue-on-${kind.noun}-state: %s`,
      async (
        _name: string,
        stateName: string,
        status: JSONObject,
        isLinked: boolean,
      ) => {
        const run: EquivalenceRun = await outbound(
          `jira-transition-issue-on-${kind.noun}-state`,
          {
            record: { stateName },
            jira: isLinked
              ? linked(status)
              : (jira: FakeJira): void => {
                  jira.add({ key: ISSUE_KEY, labels: ["oneuptime"] });
                },
          },
        );

        expectSameOutcome(run);
        expect(
          ((run.new.tool as JSONObject)["issues"] as Array<JSONObject>)[0]?.[
            "status"
          ],
        ).toBe(
          !isLinked
            ? "To Do"
            : stateName === "Acknowledged"
              ? "In Progress"
              : "Done",
        );
      },
    );

    test(`jira-transition-issue-on-${kind.noun}-state: two linked issues move neither`, async () => {
      const run: EquivalenceRun = await outbound(
        `jira-transition-issue-on-${kind.noun}-state`,
        {
          record: { stateName: "Resolved" },
          jira: (jira: FakeJira, world: TemplateWorld): void => {
            linked()(jira, world);
            jira.add({ key: "OPS-18", labels: [linkLabel(kind, world)] });
          },
        },
      );

      expectSameOutcome(run);
    });

    test(`jira-transition-issue-on-${kind.noun}-state: a private record moves nothing`, async () => {
      const run: EquivalenceRun = await outbound(
        `jira-transition-issue-on-${kind.noun}-state`,
        { record: { stateName: "Resolved", isPrivate: true }, jira: linked() },
      );

      expectSameOutcome(run);
    });

    const notes: Array<string> = [
      `jira-comment-from-${kind.noun}-private-note`,
      ...(kind.hasPublicNotes
        ? [`jira-comment-from-${kind.noun}-public-note`]
        : []),
    ];

    test.each(notes)(
      "%s: a note becomes a comment on the linked issue",
      async (templateId: string) => {
        const run: EquivalenceRun = await outbound(templateId, {
          jira: linked(),
          trigger: (world: TemplateWorld): JSONObject => {
            return noteTrigger(
              kind,
              world,
              "Rolled back the eu-west-1 deploy.",
            );
          },
        });

        expectSameOutcome(run);
        expect(JSON.stringify(run.new.tool)).toContain(
          "Rolled back the eu-west-1 deploy.",
        );
      },
    );

    test.each(notes)(
      "%s: a note that came from Jira is not posted back",
      async (templateId: string) => {
        const run: EquivalenceRun = await outbound(templateId, {
          jira: linked(),
          trigger: (world: TemplateWorld): JSONObject => {
            return noteTrigger(
              kind,
              world,
              `${ONEUPTIME_SYNCED_FROM_JIRA_MARKER}: Marco Rossi commented on OPS-17.`,
            );
          },
        });

        expectSameOutcome(run);
      },
    );

    test.each(notes)(
      "%s: a note on a record with no linked issue posts nothing",
      async (templateId: string) => {
        const run: EquivalenceRun = await outbound(templateId, {
          trigger: (world: TemplateWorld): JSONObject => {
            return noteTrigger(kind, world, "Rolled back.");
          },
        });

        expectSameOutcome(run);
      },
    );

    test(`jira-comment-on-${kind.noun}-update: an edit is a comment on the linked issue`, async () => {
      const run: EquivalenceRun = await outbound(
        `jira-comment-on-${kind.noun}-update`,
        {
          jira: linked(),
        },
      );

      expectSameOutcome(run);
    });
  },
);

/* ------------------------------- Jira -> OneUptime ------------------------------- */

describe.each(KINDS)(
  "Jira to OneUptime, for an $noun, old and new",
  (kind: Kind) => {
    const inbound: (
      templateId: string,
      data: {
        event: (world: TemplateWorld) => JSONObject;
        setUp?: (world: TemplateWorld) => void;
        jira?: (jira: FakeJira, world: TemplateWorld) => void;
      },
    ) => Promise<EquivalenceRun> = async (
      templateId: string,
      data: {
        event: (world: TemplateWorld) => JSONObject;
        setUp?: (world: TemplateWorld) => void;
        jira?: (jira: FakeJira, world: TemplateWorld) => void;
      },
    ): Promise<EquivalenceRun> => {
      return await runOldAndNew({
        templateId: templateId,
        variables: VARIABLES,
        setUp: data.setUp,
        trigger: (world: TemplateWorld): JSONObject => {
          return {
            "request-body": data.event(world),
            "request-headers": { "content-type": "application/json" },
            "request-params": {},
          };
        },
        tool: jiraWith(data.jira),
      });
    };

    const declareTemplate: string = `jira-${kind.create}-${kind.noun}-from-issue`;
    const anIssue: (jira: FakeJira) => void = (jira: FakeJira): void => {
      jira.add({ key: ISSUE_KEY });
    };

    test.each(["Highest", "High", "Medium", "Low", "Lowest", "Unheard of"])(
      `${declareTemplate}: a new issue of priority %s: the same record, at the same severity, linked`,
      async (priority: string) => {
        const run: EquivalenceRun = await inbound(declareTemplate, {
          event: (): JSONObject => {
            return jiraIssueCreatedEvent({ priority });
          },
          jira: anIssue,
        });

        expectSameOutcome(run);
        expect(kind.records(run.newWorld)).toHaveLength(1);
      },
    );

    test(`${declareTemplate}: a new issue with no priority`, async () => {
      const run: EquivalenceRun = await inbound(declareTemplate, {
        event: (): JSONObject => {
          return jiraIssueCreatedEvent({ priority: null });
        },
        jira: anIssue,
      });

      expectSameOutcome(run);
    });

    test(`${declareTemplate}: an issue OneUptime opened, labelled in the event, opens nothing`, async () => {
      const run: EquivalenceRun = await inbound(declareTemplate, {
        event: (): JSONObject => {
          return jiraIssueCreatedEvent({
            labels: ["oneuptime", "oneuptime-incident-x"],
          });
        },
        jira: anIssue,
      });

      expectSameOutcome(run);
      expect(kind.records(run.newWorld)).toHaveLength(0);
    });

    test(`${declareTemplate}: an issue Jira says is linked already opens nothing, whatever the event says`, async () => {
      const run: EquivalenceRun = await inbound(declareTemplate, {
        event: (): JSONObject => {
          return jiraIssueCreatedEvent();
        },
        jira: (jira: FakeJira): void => {
          jira.add({ key: ISSUE_KEY, labels: ["oneuptime"] });
        },
      });

      expectSameOutcome(run);
      expect(kind.records(run.newWorld)).toHaveLength(0);
    });

    test(`${declareTemplate}: Jira sending the event again opens no second record`, async () => {
      const run: EquivalenceRun = await inbound(declareTemplate, {
        event: (): JSONObject => {
          return jiraIssueCreatedEvent();
        },
        setUp: (world: TemplateWorld): void => {
          kind.add(world, { customFields: { jiraIssueKey: ISSUE_KEY } });
        },
        jira: (jira: FakeJira, world: TemplateWorld): void => {
          jira.add({
            key: ISSUE_KEY,
            labels: ["oneuptime", linkLabel(kind, world)],
          });
        },
      });

      expectSameOutcome(run);
      expect(kind.records(run.newWorld)).toHaveLength(1);
    });

    test(`${declareTemplate}: an event about an issue Jira does not have fails the run, in both`, async () => {
      const run: EquivalenceRun = await inbound(declareTemplate, {
        event: (): JSONObject => {
          return jiraIssueCreatedEvent();
        },
      });

      expectSameOutcome(run);
      expect(run.new.failed).toBe(true);
    });

    test(`${declareTemplate}: an issue updated, not created, opens nothing`, async () => {
      const run: EquivalenceRun = await inbound(declareTemplate, {
        event: (): JSONObject => {
          return jiraIssueUpdatedEvent({ items: STARTED_CHANGELOG });
        },
        jira: anIssue,
      });

      expectSameOutcome(run);
    });

    test(`${declareTemplate}: a link Jira refuses fails the run now, where the old one only warned`, async () => {
      const run: EquivalenceRun = await inbound(declareTemplate, {
        event: (): JSONObject => {
          return jiraIssueCreatedEvent();
        },
        jira: (jira: FakeJira): void => {
          anIssue(jira);
          jira.refuseWritesWith = 400;
        },
      });

      // The same record, and the same refused write; the old run ended in a ⚠️, not a ❌.
      expect(run.new.world).toEqual(run.old.world);
      expect(run.new.tool).toEqual(run.old.tool);
      expect(run.old.failed).toBe(false);
      expect(run.newTrace.failedSteps).toEqual(["link-issue-1"]);
    });

    const statusTemplate: string = `jira-status-to-${kind.noun}-state`;
    const linkedIssueEvent: (
      world: TemplateWorld,
      items: Array<JSONObject>,
      status: JSONObject,
    ) => JSONObject = (
      world: TemplateWorld,
      items: Array<JSONObject>,
      status: JSONObject,
    ): JSONObject => {
      return jiraIssueUpdatedEvent({
        items,
        status,
        labels: ["oneuptime", linkLabel(kind, world)],
      });
    };

    test.each([
      [
        "moving to In Progress acknowledges the record",
        STARTED_CHANGELOG,
        IN_PROGRESS,
        undefined,
      ],
      [
        "moving to Done resolves the record",
        RESOLVED_CHANGELOG,
        DONE,
        undefined,
      ],
      [
        "moving to Done leaves a resolved record",
        RESOLVED_CHANGELOG,
        DONE,
        "Resolved",
      ],
      [
        "moving to In Progress leaves an acknowledged record",
        STARTED_CHANGELOG,
        IN_PROGRESS,
        "Acknowledged",
      ],
      [
        "moving back to To Do moves nothing",
        [
          changelogItem({
            field: "status",
            fromString: "In Progress",
            toString: "To Do",
          }),
        ],
        TO_DO,
        undefined,
      ],
      [
        "a change that is not the status moves nothing",
        [changelogItem({ field: "summary", fromString: "A", toString: "B" })],
        IN_PROGRESS,
        undefined,
      ],
    ] as Array<[string, Array<JSONObject>, JSONObject, string | undefined]>)(
      `${statusTemplate}: %s`,
      async (
        _name: string,
        items: Array<JSONObject>,
        status: JSONObject,
        stateName: string | undefined,
      ) => {
        const run: EquivalenceRun = await inbound(statusTemplate, {
          setUp: (world: TemplateWorld): void => {
            kind.add(world, { stateName });
          },
          event: (world: TemplateWorld): JSONObject => {
            return linkedIssueEvent(world, items, status);
          },
        });

        expectSameOutcome(run);
      },
    );

    test(`${statusTemplate}: an issue linked to no record of this project moves nothing`, async () => {
      const run: EquivalenceRun = await inbound(statusTemplate, {
        setUp: (world: TemplateWorld): void => {
          kind.add(world);
        },
        event: (): JSONObject => {
          return jiraIssueUpdatedEvent({
            items: RESOLVED_CHANGELOG,
            status: DONE,
            labels: [
              "oneuptime",
              `oneuptime-${kind.noun}-9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d`,
            ],
          });
        },
      });

      expectSameOutcome(run);
    });

    test(`${statusTemplate}: an issue not linked moves nothing`, async () => {
      const run: EquivalenceRun = await inbound(statusTemplate, {
        setUp: (world: TemplateWorld): void => {
          kind.add(world);
        },
        event: (): JSONObject => {
          return jiraIssueUpdatedEvent({
            items: RESOLVED_CHANGELOG,
            status: DONE,
          });
        },
      });

      expectSameOutcome(run);
    });

    const commentTemplate: string = `jira-comment-to-${kind.noun}-private-note`;

    test.each([
      [
        "a comment is a private note on the linked record",
        undefined,
        "comment_created",
      ],
      [
        "a comment OneUptime posted is not copied back",
        `${JIRA_SYNCED_FROM_ONEUPTIME_MARKER}: private note on INC-1.`,
        "comment_created",
      ],
      ["an empty comment adds nothing", "   ", "comment_created"],
      ["an edited comment adds nothing", undefined, "comment_updated"],
    ] as Array<[string, string | undefined, string]>)(
      `${commentTemplate}: %s`,
      async (_name: string, body: string | undefined, webhookEvent: string) => {
        const run: EquivalenceRun = await inbound(commentTemplate, {
          setUp: (world: TemplateWorld): void => {
            kind.add(world);
          },
          event: (): JSONObject => {
            return jiraCommentEvent({ body, webhookEvent });
          },
          jira: (jira: FakeJira, world: TemplateWorld): void => {
            jira.add({
              key: ISSUE_KEY,
              labels: ["oneuptime", linkLabel(kind, world)],
            });
          },
        });

        expectSameOutcome(run);
      },
    );

    test(`${commentTemplate}: a comment on an issue not linked adds nothing`, async () => {
      const run: EquivalenceRun = await inbound(commentTemplate, {
        setUp: (world: TemplateWorld): void => {
          kind.add(world);
        },
        event: (): JSONObject => {
          return jiraCommentEvent();
        },
        jira: anIssue,
      });

      expectSameOutcome(run);
    });

    const changesTemplate: string = `jira-issue-changes-to-${kind.noun}-private-note`;

    test.each([
      [
        "an edit to the summary and priority is a private note",
        [
          changelogItem({
            field: "summary",
            fromString: "Checkout down",
            toString: "Checkout API returns 502",
          }),
          changelogItem({
            field: "priority",
            fromString: "Medium",
            toString: "High",
          }),
        ],
      ],
      [
        "a status change alone is the status template's, and notes nothing",
        STARTED_CHANGELOG,
      ],
    ] as Array<[string, Array<JSONObject>]>)(
      `${changesTemplate}: %s`,
      async (_name: string, items: Array<JSONObject>) => {
        const run: EquivalenceRun = await inbound(changesTemplate, {
          setUp: (world: TemplateWorld): void => {
            kind.add(world);
          },
          event: (world: TemplateWorld): JSONObject => {
            return linkedIssueEvent(world, items, IN_PROGRESS);
          },
        });

        expectSameOutcome(run);
      },
    );
  },
);
