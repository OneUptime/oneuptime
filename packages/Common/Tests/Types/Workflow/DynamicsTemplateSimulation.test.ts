/*
 * The Dynamics 365 templates, run end to end by the template simulator
 * (WorkflowTemplateSimulator): the graph the create wizard builds, its
 * values substituted the way RunWorkflow does - the OAuth 2.0 variable's
 * access token included - the real Check With JavaScript, API, API Get By ID
 * and Incident and Alert From Another Tool steps, and every script in the
 * real sandbox. Dynamics 365 is a fake of the Dataverse Web API that keeps
 * Dataverse's rules (FakeDynamics); the project is one held in memory
 * (TemplateWorld).
 *
 * For an incident and for an alert:
 *
 *   - OneUptime to Dynamics 365: a record opens one linked case, with the
 *     customer and a priority from its severity; resolving it closes the
 *     case as Problem Solved; a private or public note is a note on the case.
 *   - Dynamics 365 to OneUptime: a new case, read by the id the request
 *     names, opens a record and is linked to it; a resolved case resolves
 *     its record; an agent's note on a linked case is a private note.
 *   - Together: what one direction writes comes back through the other, and
 *     settles.
 *
 * Each is four or five steps now, where it was ten to twenty-two, with
 * nothing on any Error output: a step that fails fails the run, and its
 * Steps entry says why. That they do what the old ones did, event for
 * event, is DynamicsTemplateEquivalence's.
 */

import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Alert from "../../../Models/DatabaseModels/Alert";
import Incident from "../../../Models/DatabaseModels/Incident";
import WorkflowPrincipal, {
  WorkflowPrincipalOptions,
} from "../../../Server/Utils/Workflow/WorkflowPrincipal";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import {
  DYNAMICS_SYNCED_FROM_ONEUPTIME_MARKER,
  ONEUPTIME_SYNCED_FROM_DYNAMICS_MARKER,
  WorkflowTemplate,
  WorkflowTemplateCategory,
  getWorkflowTemplatesByCategory,
} from "../../../Types/Workflow/Templates";
import {
  ACCOUNT_ID,
  CASE_ID,
  CASE_NUMBER,
  DYNAMICS_URL,
  LINK_COLUMN,
  NOTE_ID,
  flowBody,
  webhookContext,
} from "./DynamicsTemplateFixtures";
import FakeDynamics, {
  FAKE_DYNAMICS_TOKEN,
  FakeDynamicsCall,
} from "./FakeDynamics";
import { OtherTool, TemplateRun, runNewTemplate } from "./TemplateEquivalence";
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
  dynamicsUrl: DYNAMICS_URL,
  dynamicsLinkColumn: LINK_COLUMN,
  dynamicsCustomer: ACCOUNT_ID,
  dynamicsAccessToken: FAKE_DYNAMICS_TOKEN,
  oneuptimeUrl: "https://oneuptime.example.com",
};

const CASE_URL: string = `${DYNAMICS_URL}/main.aspx?pagetype=entityrecord&etn=incident&id=${CASE_ID}`;

interface Kind {
  noun: "incident" | "alert";
  created: string;
  Created: string;
  modelType: { new (): BaseModel };
  idColumn: string;
  numberField: string;
  number: string;
  step: string;
  severities: [string, string, string];
  createRecord: string;
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
  record.setColumnValue("description", "Checkout fails for EU customers.");

  if (props?.isPrivate !== undefined) {
    record.setColumnValue("isPrivate", props.isPrivate);
  }

  return record;
};

const INCIDENT: Kind = {
  noun: "incident",
  created: "declared",
  Created: "Declared",
  modelType: Incident,
  idColumn: "incidentId",
  numberField: "incidentNumberWithPrefix",
  number: "INC-1",
  step: "incident-from-another-tool-1",
  severities: ["Critical Incident", "Major Incident", "Minor Incident"],
  createRecord: "dynamics-declare-incident-from-case",
  noteTemplates: [
    "dynamics-note-from-incident-private-note",
    "dynamics-note-from-incident-public-note",
  ],
  records: (world: TemplateWorld): Array<BaseModel> => {
    return world.incidents.records.rows;
  },
  add: (world: TemplateWorld, props?: RecordProps): BaseModel => {
    return finish(
      world.addIncident({
        title: props?.title || "Checkout latency high",
        stateName: props?.stateName,
        customFields: props?.customFields,
      }),
      props,
    );
  },
};

const ALERT: Kind = {
  noun: "alert",
  created: "created",
  Created: "Created",
  modelType: Alert,
  idColumn: "alertId",
  numberField: "alertNumberWithPrefix",
  number: "ALT-1",
  step: "alert-from-another-tool-1",
  severities: ["High", "Low", "Low"],
  createRecord: "dynamics-create-alert-from-case",
  noteTemplates: ["dynamics-note-from-alert-private-note"],
  records: (world: TemplateWorld): Array<BaseModel> => {
    return world.alerts.records.rows;
  },
  add: (world: TemplateWorld, props?: RecordProps): BaseModel => {
    return finish(
      world.addAlert({
        title: props?.title || "Checkout latency high",
        stateName: props?.stateName,
        customFields: props?.customFields,
      }),
      props,
    );
  },
};

const KINDS: Array<Kind> = [INCIDENT, ALERT];

// The Dynamics 365 of the last run: its cases and notes, and every call it was sent.
let dynamics: FakeDynamics;

const dynamicsTool: (
  setUp?: (fake: FakeDynamics, world: TemplateWorld) => void,
) => (world: TemplateWorld) => OtherTool = (
  setUp?: (fake: FakeDynamics, world: TemplateWorld) => void,
): ((world: TemplateWorld) => OtherTool) => {
  return (world: TemplateWorld): OtherTool => {
    dynamics = new FakeDynamics();

    if (setUp) {
      setUp(dynamics, world);
    }

    return {
      http: (request: SimulatedRequest): SimulatedReply => {
        return dynamics.answer(request);
      },
      state: (): JSONValue => {
        return dynamics.state();
      },
    };
  };
};

beforeEach(() => {
  // The API steps resolve Dataverse's host before every request; it is a public one.
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

// The link a case holds for the project's first record.
const linkOf: (kind: Kind, world: TemplateWorld) => string = (
  kind: Kind,
  world: TemplateWorld,
): string => {
  return `oneuptime-${kind.noun}-${(kind.records(world)[0] as BaseModel).id!.toString()}`;
};

// A case linked to the project's first record, at a status.
const linkedCase: (
  kind: Kind,
  statuscode?: number,
) => (fake: FakeDynamics, world: TemplateWorld) => void = (
  kind: Kind,
  statuscode?: number,
): ((fake: FakeDynamics, world: TemplateWorld) => void) => {
  return (fake: FakeDynamics, world: TemplateWorld): void => {
    fake.addCase({
      incidentid: CASE_ID,
      ticketnumber: CASE_NUMBER,
      link: linkOf(kind, world),
      statuscode: statuscode === undefined ? 1 : statuscode,
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

const delivery: (body: JSONValue) => JSONObject = (
  body: JSONValue,
): JSONObject => {
  return {
    "request-body": body,
    "request-headers": { "content-type": "application/json" },
    "request-params": {},
  };
};

// What a run changed in Dynamics 365: every call but the reads.
const writes: () => Array<FakeDynamicsCall> = (): Array<FakeDynamicsCall> => {
  return dynamics.calls.filter((call: FakeDynamicsCall): boolean => {
    return call.method !== "GET";
  });
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

describe("every Dynamics 365 template is simulated", () => {
  test("the two kinds between them name every Dynamics 365 template, and nothing else", () => {
    const simulated: Array<string> = KINDS.flatMap((kind: Kind) => {
      return [
        `dynamics-create-case-for-${kind.noun}`,
        `dynamics-update-case-on-${kind.noun}-state`,
        ...kind.noteTemplates,
        kind.createRecord,
        `dynamics-case-status-to-${kind.noun}-state`,
        `dynamics-case-note-to-${kind.noun}-private-note`,
      ];
    });

    expect(simulated.sort()).toEqual(
      getWorkflowTemplatesByCategory(WorkflowTemplateCategory.Dynamics365)
        .map((template: WorkflowTemplate): string => {
          return template.id;
        })
        .sort(),
    );
  });
});

/* --------------------------- OneUptime -> Dynamics 365 --------------------------- */

describe.each(KINDS)(
  "OneUptime to Dynamics 365, for an $noun",
  (kind: Kind) => {
    const outbound: (
      templateId: string,
      data: {
        record?: RecordProps;
        dynamics?: (fake: FakeDynamics, world: TemplateWorld) => void;
        trigger?: (world: TemplateWorld) => JSONObject;
      },
    ) => Promise<TemplateRun> = async (
      templateId: string,
      data: {
        record?: RecordProps;
        dynamics?: (fake: FakeDynamics, world: TemplateWorld) => void;
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
        tool: dynamicsTool(data.dynamics),
      });
    };

    const createCase: string = `dynamics-create-case-for-${kind.noun}`;
    const updateCase: string = `dynamics-update-case-on-${kind.noun}-state`;

    test(`${createCase}: opens one case for a new ${kind.noun}, linked, with the customer and a priority`, async () => {
      const run: TemplateRun = await outbound(createCase, {});
      const sent: Array<FakeDynamicsCall> = writes();

      expect(run.trace.executed).toEqual([
        `${kind.noun}-on-create-1`,
        "find-severities-1",
        "prepare-case-1",
        "create-case-1",
      ]);
      expect(run.trace.failedSteps).toEqual([]);
      expect(sent).toHaveLength(1);
      expect(sent[0]?.method).toBe("POST");

      const columns: JSONObject = sent[0]?.body as JSONObject;

      expect(columns[LINK_COLUMN]).toBe(linkOf(kind, run.world));
      expect(columns["customerid_account@odata.bind"]).toBe(
        `/accounts(${ACCOUNT_ID})`,
      );
      // The most severe severity is the High priority.
      expect(columns["prioritycode"]).toBe(1);
      expect(String(columns["title"])).toBe(
        `[OneUptime] ${kind.number}: Checkout latency high`,
      );
    });

    test(`${createCase}: a private ${kind.noun} sends nothing`, async () => {
      const run: TemplateRun = await outbound(createCase, {
        record: { isPrivate: true },
      });

      expect(run.trace.ports["prepare-case-1"]).toBe("no");
      expect(dynamics.calls).toEqual([]);
    });

    test(`${createCase}: an ${kind.noun} that came from a case opens no second one`, async () => {
      const run: TemplateRun = await outbound(createCase, {
        record: {
          customFields: {
            dynamicsCaseId: CASE_ID,
            dynamicsCaseNumber: CASE_NUMBER,
          },
        },
      });

      expect(run.trace.ports["prepare-case-1"]).toBe("no");
      expect(writes()).toEqual([]);
    });

    test(`${createCase}: Dataverse refusing the case fails the run, and the step says what Dataverse said`, async () => {
      const run: TemplateRun = await outbound(createCase, {
        dynamics: (fake: FakeDynamics): void => {
          fake.refuseWritesWith = 400;
        },
      });

      expect(run.trace.failedSteps).toEqual(["create-case-1"]);
      expect(
        JSON.stringify(
          run.trace.storage.local.components["create-case-1"]?.returnValues,
        ),
      ).toContain("Dynamics 365 refused the request.");
    });

    test(`${createCase}: a title longer than the Case table allows is cut, not refused`, async () => {
      const run: TemplateRun = await outbound(createCase, {
        record: { title: "t".repeat(500) },
      });
      const title: string = String((writes()[0]?.body as JSONObject)["title"]);

      expect(run.trace.failedSteps).toEqual([]);
      expect(title.length).toBeLessThanOrEqual(200);
      expect(title.endsWith("…")).toBe(true);
    });

    test(`${updateCase}: resolving the ${kind.noun} closes its case with CloseIncident, as Problem Solved`, async () => {
      const run: TemplateRun = await outbound(updateCase, {
        record: { stateName: "Resolved" },
        dynamics: linkedCase(kind),
      });

      expect(run.trace.failedSteps).toEqual([]);
      expect(writes()).toEqual([
        expect.objectContaining({ method: "POST", path: "/CloseIncident" }),
      ]);
      expect(dynamics.cases.get(CASE_ID)?.statuscode).toBe(5);
    });

    test(`${updateCase}: acknowledging looks the case up and changes nothing: only resolving closes a case`, async () => {
      const run: TemplateRun = await outbound(updateCase, {
        record: { stateName: "Acknowledged" },
        dynamics: linkedCase(kind),
      });

      expect(run.trace.ports["plan-case-1"]).toBe("no");
      expect(run.trace.portReasons["plan-case-1"]).toBe(
        `${kind.number} moved to Acknowledged: only resolving the ${kind.noun} closes its Dynamics 365 case.`,
      );
      expect(writes()).toEqual([]);
    });

    test(`${updateCase}: a case already resolved in Dynamics 365 is left alone`, async () => {
      const run: TemplateRun = await outbound(updateCase, {
        record: { stateName: "Resolved" },
        dynamics: linkedCase(kind, 5),
      });

      expect(run.trace.ports["plan-case-1"]).toBe("no");
      expect(writes()).toEqual([]);
    });

    test(`${updateCase}: an ${kind.noun} with no case is left alone`, async () => {
      const run: TemplateRun = await outbound(updateCase, {
        record: { stateName: "Resolved" },
      });

      expect(run.trace.ports["plan-case-1"]).toBe("no");
      expect(writes()).toEqual([]);
      expect(run.trace.failedSteps).toEqual([]);
    });

    test(`${updateCase}: Dataverse refusing to close the case fails the run`, async () => {
      const run: TemplateRun = await outbound(updateCase, {
        record: { stateName: "Resolved" },
        dynamics: (fake: FakeDynamics, world: TemplateWorld): void => {
          linkedCase(kind)(fake, world);
          fake.refuseWritesWith = 400;
        },
      });

      expect(run.trace.failedSteps).toEqual(["close-case-1"]);
    });

    test.each(kind.noteTemplates)(
      "%s: adds the note to the linked case, marked as OneUptime's",
      async (templateId: string) => {
        const run: TemplateRun = await outbound(templateId, {
          dynamics: linkedCase(kind),
          trigger: (world: TemplateWorld): JSONObject => {
            return noteTrigger(
              kind,
              world,
              'Rolled back the "eu-west-1" deploy.\nC:\\logs\\checkout.log is clean.',
            );
          },
        });
        const state: JSONObject = dynamics.state() as JSONObject;
        const notes: Array<JSONObject> = state["notes"] as Array<JSONObject>;

        expect(run.trace.failedSteps).toEqual([]);
        expect(notes).toHaveLength(1);
        expect(notes[0]?.["case"]).toBe(CASE_NUMBER);
        expect(
          String(notes[0]?.["subject"]).startsWith(
            DYNAMICS_SYNCED_FROM_ONEUPTIME_MARKER,
          ),
        ).toBe(true);
        // As it was written: quotes, a backslash and a line break.
        expect(notes[0]?.["notetext"]).toBe(
          'Rolled back the "eu-west-1" deploy.\nC:\\logs\\checkout.log is clean.',
        );
      },
    );

    test.each(kind.noteTemplates)(
      "%s: a note that came from Dynamics 365 is not sent back",
      async (templateId: string) => {
        const run: TemplateRun = await outbound(templateId, {
          dynamics: linkedCase(kind),
          trigger: (world: TemplateWorld): JSONObject => {
            return noteTrigger(
              kind,
              world,
              `${ONEUPTIME_SYNCED_FROM_DYNAMICS_MARKER}: Sam Okafor added a note to case ${CASE_NUMBER}.`,
            );
          },
        });

        expect(run.trace.ports["build-note-1"]).toBe("no");
        expect(writes()).toEqual([]);
      },
    );
  },
);

/* --------------------------- Dynamics 365 -> OneUptime --------------------------- */

describe.each(KINDS)(
  "Dynamics 365 to OneUptime, for an $noun",
  (kind: Kind) => {
    const inbound: (
      templateId: string,
      data: {
        body: (world: TemplateWorld) => JSONValue;
        setUp?: (world: TemplateWorld) => void;
        dynamics?: (fake: FakeDynamics, world: TemplateWorld) => void;
      },
    ) => Promise<TemplateRun> = async (
      templateId: string,
      data: {
        body: (world: TemplateWorld) => JSONValue;
        setUp?: (world: TemplateWorld) => void;
        dynamics?: (fake: FakeDynamics, world: TemplateWorld) => void;
      },
    ): Promise<TemplateRun> => {
      return await runNewTemplate({
        templateId: templateId,
        variables: VARIABLES,
        setUp: data.setUp,
        trigger: (world: TemplateWorld): JSONObject => {
          return delivery(data.body(world));
        },
        tool: dynamicsTool(data.dynamics),
      });
    };

    const withARecord: (
      props?: RecordProps,
    ) => (world: TemplateWorld) => void = (
      props?: RecordProps,
    ): ((world: TemplateWorld) => void) => {
      return (world: TemplateWorld): void => {
        kind.add(world, props);
      };
    };

    const aNewCase: (props?: {
      prioritycode?: number;
      link?: string;
      statuscode?: number;
      description?: string;
    }) => (fake: FakeDynamics) => void = (props?: {
      prioritycode?: number;
      link?: string;
      statuscode?: number;
      description?: string;
    }): ((fake: FakeDynamics) => void) => {
      return (fake: FakeDynamics): void => {
        fake.addCase({
          incidentid: CASE_ID,
          ticketnumber: CASE_NUMBER,
          ...(props?.prioritycode !== undefined
            ? { prioritycode: props.prioritycode }
            : {}),
          ...(props?.link !== undefined ? { link: props.link } : {}),
          ...(props?.statuscode !== undefined
            ? { statuscode: props.statuscode }
            : {}),
          ...(props?.description !== undefined
            ? { description: props.description }
            : {}),
        });
      };
    };

    const create: string = kind.createRecord;
    const status: string = `dynamics-case-status-to-${kind.noun}-state`;
    const caseNote: string = `dynamics-case-note-to-${kind.noun}-private-note`;

    test(`${create}: a new case, read by the id the request names, opens an ${kind.noun} and is linked to it`, async () => {
      const run: TemplateRun = await inbound(create, {
        body: (): JSONObject => {
          return webhookContext({ messageName: "Create" });
        },
        dynamics: aNewCase(),
      });
      const records: Array<JSONObject> = recordsOf(run, kind);

      expect(run.trace.executed).toEqual([
        "webhook-1",
        "get-case-1",
        `prepare-${kind.noun}-1`,
        kind.step,
        "link-case-1",
      ]);
      expect(run.trace.failedSteps).toEqual([]);
      expect(records).toEqual([
        expect.objectContaining({
          number: kind.number,
          title: "Customers in the EU cannot complete checkout",
          severity: kind.severities[0],
          customFields: {
            dynamicsCaseId: CASE_ID,
            dynamicsCaseNumber: CASE_NUMBER,
          },
        }),
      ]);
      expect(String(records[0]?.["description"]).split("\n")[0]).toBe(
        `${kind.Created} from Dynamics 365 case [${CASE_NUMBER}](${CASE_URL}).`,
      );
      expect(dynamics.cases.get(CASE_ID)?.link).toBe(linkOf(kind, run.world));
    });

    test.each([
      [1, 0],
      [2, 1],
      [3, 2],
    ] as Array<[number, number]>)(
      `${create}: a case of priority %p opens at the project's severity at place %p`,
      async (prioritycode: number, place: number) => {
        const run: TemplateRun = await inbound(create, {
          body: (): JSONObject => {
            return webhookContext({ messageName: "Create" });
          },
          dynamics: aNewCase({ prioritycode }),
        });

        expect(recordsOf(run, kind)[0]?.["severity"]).toBe(
          kind.severities[place],
        );
      },
    );

    test(`${create}: a Power Automate flow posting the case's id as PrimaryEntityId opens it too`, async () => {
      const run: TemplateRun = await inbound(create, {
        body: (): JSONObject => {
          return { ...flowBody(), PrimaryEntityId: CASE_ID };
        },
        dynamics: aNewCase(),
      });

      expect(kind.records(run.world)).toHaveLength(1);
    });

    test(`${create}: an edit to a case is ignored, and nothing is written`, async () => {
      const run: TemplateRun = await inbound(create, {
        body: (): JSONObject => {
          return webhookContext({ messageName: "Update" });
        },
        dynamics: aNewCase(),
      });

      expect(run.trace.portReasons[`prepare-${kind.noun}-1`]).toBe(
        "Ignored the Update event: this workflow only handles Create.",
      );
      expect(kind.records(run.world)).toHaveLength(0);
      expect(writes()).toEqual([]);
    });

    test(`${create}: a case that is already linked is read, and left alone`, async () => {
      const run: TemplateRun = await inbound(create, {
        body: (): JSONObject => {
          return webhookContext({ messageName: "Create" });
        },
        dynamics: aNewCase({ link: "oneuptime-incident-x" }),
      });

      expect(run.trace.ports[`prepare-${kind.noun}-1`]).toBe("no");
      expect(kind.records(run.world)).toHaveLength(0);
      expect(writes()).toEqual([]);
    });

    test(`${create}: a case Dynamics 365 does not have fails the run at the read`, async () => {
      const run: TemplateRun = await inbound(create, {
        body: (): JSONObject => {
          return webhookContext({ messageName: "Create" });
        },
      });

      expect(run.trace.failedSteps).toEqual(["get-case-1"]);
      expect(kind.records(run.world)).toHaveLength(0);
    });

    test(`${create}: a request that names no case by a plain id is refused before Dynamics 365 is asked`, async () => {
      const run: TemplateRun = await inbound(create, {
        body: (): JSONObject => {
          return { PrimaryEntityId: "../../WhoAmI" };
        },
        dynamics: aNewCase(),
      });

      expect(run.trace.failedSteps).toEqual(["get-case-1"]);
      expect(dynamics.calls).toEqual([]);
    });

    test(`${create}: an ${kind.noun} whose case then refuses the link stays, and the run fails at the link`, async () => {
      const run: TemplateRun = await inbound(create, {
        body: (): JSONObject => {
          return webhookContext({ messageName: "Create" });
        },
        dynamics: (fake: FakeDynamics): void => {
          aNewCase()(fake);
          fake.refuseWritesWith = 403;
        },
      });

      expect(kind.records(run.world)).toHaveLength(1);
      expect(run.trace.failedSteps).toEqual(["link-case-1"]);
    });

    test(`${create}: a case description written in the rich-text editor reads as the text it shows`, async () => {
      const run: TemplateRun = await inbound(create, {
        body: (): JSONObject => {
          return webhookContext({ messageName: "Create" });
        },
        dynamics: aNewCase({
          description:
            '<div class="ck-content"><p>Checkout fails &amp; retries <b>time out</b>.</p><style>P {margin-top:0;}</style><p>Since 09:40.</p></div>',
        }),
      });
      const description: string = String(
        recordsOf(run, kind)[0]?.["description"],
      );

      expect(description).toContain("Checkout fails & retries time out.");
      expect(description).toContain("Since 09:40.");
      expect(description).not.toContain("<");
      expect(description).not.toContain("margin-top");
    });

    test.each([5, 1000])(
      `${status}: a case resolved as status %p resolves its ${kind.noun}, saying why`,
      async (statuscode: number) => {
        const run: TemplateRun = await inbound(status, {
          setUp: withARecord({ stateName: "Acknowledged" }),
          body: (): JSONObject => {
            return webhookContext({ messageName: "Close", rowId: CASE_ID });
          },
          dynamics: linkedCase(kind, statuscode),
        });

        expect(recordsOf(run, kind)[0]?.["state"]).toBe("Resolved");
        expect(changesOf(run, kind)).toEqual([
          expect.objectContaining({
            record: kind.number,
            state: "Resolved",
            rootCause: expect.stringMatching(
              new RegExp(
                `^${ONEUPTIME_SYNCED_FROM_DYNAMICS_MARKER}: case ${CASE_NUMBER} is `,
              ),
            ),
          }),
        ]);
        expect(run.trace.failedSteps).toEqual([]);
      },
    );

    test(`${status}: a case that is still active changes nothing`, async () => {
      const run: TemplateRun = await inbound(status, {
        setUp: withARecord(),
        body: (): JSONObject => {
          return webhookContext({ messageName: "Update" });
        },
        dynamics: linkedCase(kind, 1),
      });

      expect(run.trace.ports["decide-state-1"]).toBe("no");
      expect(changesOf(run, kind)).toEqual([]);
    });

    test(`${status}: a case that is not linked is left alone`, async () => {
      const run: TemplateRun = await inbound(status, {
        setUp: withARecord(),
        body: (): JSONObject => {
          return webhookContext({ messageName: "Update" });
        },
        dynamics: aNewCase({ statuscode: 5 }),
      });

      expect(run.trace.ports["decide-state-1"]).toBe("no");
      expect(changesOf(run, kind)).toEqual([]);
    });

    test(`${status}: an ${kind.noun} already resolved is not moved again`, async () => {
      const run: TemplateRun = await inbound(status, {
        setUp: withARecord({ stateName: "Resolved" }),
        body: (): JSONObject => {
          return webhookContext({ messageName: "Close", rowId: CASE_ID });
        },
        dynamics: linkedCase(kind, 5),
      });

      expect(run.trace.ports[kind.step]).toBe("unchanged");
      expect(changesOf(run, kind)).toEqual([]);
    });

    test(`${caseNote}: copies an agent's note on the linked case onto the ${kind.noun}, read as the text it shows`, async () => {
      const run: TemplateRun = await inbound(caseNote, {
        setUp: withARecord(),
        body: (): JSONObject => {
          return webhookContext({
            messageName: "Create",
            table: "annotation",
            rowId: NOTE_ID,
          });
        },
        dynamics: (fake: FakeDynamics, world: TemplateWorld): void => {
          linkedCase(kind)(fake, world);
          fake.addNote({
            annotationid: NOTE_ID,
            caseId: CASE_ID,
            subject: "Called the customer",
            notetext:
              "<p>They still see the error at checkout &amp; on retry.</p>",
          });
        },
      });
      const notes: Array<JSONObject> = notesOf(run, kind);

      expect(run.trace.executed).toEqual([
        "webhook-1",
        "read-event-1",
        "get-note-1",
        "read-note-1",
        kind.step,
      ]);
      expect(notes).toHaveLength(1);
      expect(notes[0]?.["record"]).toBe(kind.number);
      expect(String(notes[0]?.["note"])).toBe(
        [
          `${ONEUPTIME_SYNCED_FROM_DYNAMICS_MARKER}: Sam Okafor added a note to case [${CASE_NUMBER}](${CASE_URL}).`,
          "",
          "Called the customer",
          "",
          "They still see the error at checkout & on retry.",
        ].join("\n"),
      );
    });

    test(`${caseNote}: a note on an account's row is left alone`, async () => {
      const run: TemplateRun = await inbound(caseNote, {
        setUp: withARecord(),
        body: (): JSONObject => {
          return webhookContext({
            messageName: "Create",
            table: "annotation",
            rowId: NOTE_ID,
          });
        },
        dynamics: (fake: FakeDynamics): void => {
          fake.addNote({ annotationid: NOTE_ID, caseId: null });
        },
      });

      expect(run.trace.ports["read-note-1"]).toBe("no");
      expect(notesOf(run, kind)).toEqual([]);
    });

    test(`${caseNote}: a note OneUptime wrote on the case is not copied back`, async () => {
      const run: TemplateRun = await inbound(caseNote, {
        setUp: withARecord(),
        body: (): JSONObject => {
          return webhookContext({
            messageName: "Create",
            table: "annotation",
            rowId: NOTE_ID,
          });
        },
        dynamics: (fake: FakeDynamics, world: TemplateWorld): void => {
          linkedCase(kind)(fake, world);
          fake.addNote({
            annotationid: NOTE_ID,
            caseId: CASE_ID,
            subject: `${DYNAMICS_SYNCED_FROM_ONEUPTIME_MARKER}: private note on ${kind.number} by Jane Doe`,
            notetext: "Failed over.",
          });
        },
      });

      expect(run.trace.ports["read-note-1"]).toBe("no");
      expect(notesOf(run, kind)).toEqual([]);
    });
  },
);

/* ------------------------------- Round trips ------------------------------- */

describe.each(KINDS)("round trips, for an $noun", (kind: Kind) => {
  test("the case OneUptime opens comes back as a Create, and is left alone", async () => {
    const run: TemplateRun = await runNewTemplate({
      templateId: kind.createRecord,
      variables: VARIABLES,
      setUp: (world: TemplateWorld): void => {
        kind.add(world);
      },
      trigger: (): JSONObject => {
        return delivery(webhookContext({ messageName: "Create" }));
      },
      tool: dynamicsTool(linkedCase(kind)),
    });

    expect(run.trace.ports[`prepare-${kind.noun}-1`]).toBe("no");
    expect(kind.records(run.world)).toHaveLength(1);
  });

  test(`the ${kind.noun} a case becomes opens no case of its own`, async () => {
    const run: TemplateRun = await runNewTemplate({
      templateId: `dynamics-create-case-for-${kind.noun}`,
      variables: VARIABLES,
      setUp: (world: TemplateWorld): void => {
        kind.add(world, {
          customFields: {
            dynamicsCaseId: CASE_ID,
            dynamicsCaseNumber: CASE_NUMBER,
          },
        });
      },
      trigger: (world: TemplateWorld): JSONObject => {
        return recordTrigger(kind, world);
      },
      tool: dynamicsTool(),
    });

    expect(run.trace.ports["prepare-case-1"]).toBe("no");
    expect(writes()).toEqual([]);
  });

  test(`resolving the case resolves the ${kind.noun}, and the ${kind.noun}'s update then finds the case closed and changes nothing`, async () => {
    const run: TemplateRun = await runNewTemplate({
      templateId: `dynamics-update-case-on-${kind.noun}-state`,
      variables: VARIABLES,
      setUp: (world: TemplateWorld): void => {
        kind.add(world, { stateName: "Resolved" });
      },
      trigger: (world: TemplateWorld): JSONObject => {
        return recordTrigger(kind, world);
      },
      tool: dynamicsTool(linkedCase(kind, 5)),
    });

    expect(run.trace.ports["plan-case-1"]).toBe("no");
    expect(writes()).toEqual([]);
  });

  test(`resolving the ${kind.noun} closes the case, and the case's Close then changes nothing`, async () => {
    const run: TemplateRun = await runNewTemplate({
      templateId: `dynamics-case-status-to-${kind.noun}-state`,
      variables: VARIABLES,
      setUp: (world: TemplateWorld): void => {
        kind.add(world, { stateName: "Resolved" });
      },
      trigger: (): JSONObject => {
        return delivery(
          webhookContext({ messageName: "Close", rowId: CASE_ID }),
        );
      },
      tool: dynamicsTool(linkedCase(kind, 5)),
    });

    expect(run.trace.ports[kind.step]).toBe("unchanged");
    expect(changesOf(run, kind)).toEqual([]);
  });
});

/* ------------------------------- Across kinds ------------------------------- */

describe("a case linked to one kind is never taken for the other", () => {
  test.each([
    [INCIDENT, ALERT],
    [ALERT, INCIDENT],
  ] as Array<[Kind, Kind]>)(
    "the %s's case resolving moves no record of the other kind",
    async (linked: Kind, other: Kind) => {
      const run: TemplateRun = await runNewTemplate({
        templateId: `dynamics-case-status-to-${other.noun}-state`,
        variables: VARIABLES,
        setUp: (world: TemplateWorld): void => {
          linked.add(world);
          other.add(world);
        },
        trigger: (): JSONObject => {
          return delivery(
            webhookContext({ messageName: "Close", rowId: CASE_ID }),
          );
        },
        tool: dynamicsTool(linkedCase(linked, 5)),
      });

      expect(run.trace.ports["decide-state-1"]).toBe("no");
      expect(changesOf(run, other)).toEqual([]);
      expect(changesOf(run, linked)).toEqual([]);
    },
  );

  test.each([
    [INCIDENT, ALERT],
    [ALERT, INCIDENT],
  ] as Array<[Kind, Kind]>)(
    "a case the %s set holds opens no record of the other kind",
    async (linked: Kind, other: Kind) => {
      const run: TemplateRun = await runNewTemplate({
        templateId: other.createRecord,
        variables: VARIABLES,
        setUp: (world: TemplateWorld): void => {
          linked.add(world);
        },
        trigger: (): JSONObject => {
          return delivery(webhookContext({ messageName: "Create" }));
        },
        tool: dynamicsTool(linkedCase(linked)),
      });

      expect(other.records(run.world)).toHaveLength(0);
    },
  );
});

/* ------------------------------- The token ------------------------------- */

describe("the access token", () => {
  test("is sent in every request's Authorization header, and appears nowhere else", async () => {
    const run: TemplateRun = await runNewTemplate({
      templateId: INCIDENT.createRecord,
      variables: VARIABLES,
      trigger: (): JSONObject => {
        return delivery(webhookContext({ messageName: "Create" }));
      },
      tool: dynamicsTool((fake: FakeDynamics): void => {
        fake.addCase({
          incidentid: CASE_ID,
          title: "Leak {{local.variables.dynamicsAccessToken}}",
        });
      }),
    });

    expect(dynamics.calls.length).toBeGreaterThan(0);

    for (const call of dynamics.calls) {
      expect(JSON.stringify(call.body || null)).not.toContain(
        FAKE_DYNAMICS_TOKEN,
      );
      expect(call.path).not.toContain(FAKE_DYNAMICS_TOKEN);
    }

    expect(JSON.stringify(run.outcome.world)).not.toContain(
      FAKE_DYNAMICS_TOKEN,
    );
  });
});
