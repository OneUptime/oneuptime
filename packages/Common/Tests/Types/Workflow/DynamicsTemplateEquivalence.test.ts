/*
 * The Dynamics 365 templates before and after they were made simple, on the
 * same events (TemplateEquivalence): ten to twenty-two steps each before,
 * four or five now, on Check With JavaScript, API Get By ID and Incident or
 * Alert From Another Tool. Each event runs through the old graph and the new
 * template against a project and a Dynamics 365 of their own (FakeDynamics),
 * made the same way, and must leave the same records, notes and state
 * changes, and the same cases, statuses, links and notes in Dynamics 365.
 *
 * Reads of Dynamics 365 are not compared, only what was written. Two things
 * changed on purpose, and are held here as such:
 *
 *   - "Resolve the Dynamics 365 case" only closes cases. Moving a case to an
 *     active status at other states needed a script edit and two more steps;
 *     it is gone, and STATE_TO_CASE_STATUS names resolved statuses only.
 *   - "Declare an incident when a Dynamics 365 case is created" reads the
 *     case first, by the PrimaryEntityId the request names: a flow posts
 *     the case's id under that name, as a Dataverse webhook does.
 */

import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Alert from "../../../Models/DatabaseModels/Alert";
import Incident from "../../../Models/DatabaseModels/Incident";
import WorkflowPrincipal, {
  WorkflowPrincipalOptions,
} from "../../../Server/Utils/Workflow/WorkflowPrincipal";
import { JSONObject } from "../../../Types/JSON";
import {
  DYNAMICS_SYNCED_FROM_ONEUPTIME_MARKER,
  ONEUPTIME_SYNCED_FROM_DYNAMICS_MARKER,
} from "../../../Types/Workflow/Templates";
import {
  ACCOUNT_ID,
  CASE_ID,
  DYNAMICS_URL,
  LINK_COLUMN,
  NOTE_ID,
  webhookContext,
} from "./DynamicsTemplateFixtures";
import FakeDynamics, { FAKE_DYNAMICS_TOKEN } from "./FakeDynamics";
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
  dynamicsUrl: DYNAMICS_URL,
  dynamicsLinkColumn: LINK_COLUMN,
  dynamicsCustomer: `accounts(${ACCOUNT_ID})`,
  dynamicsAccessToken: FAKE_DYNAMICS_TOKEN,
  oneuptimeUrl: "https://oneuptime.example.com",
};

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
  create: "declare",
  modelType: Incident,
  idColumn: "incidentId",
  numberField: "incidentNumberWithPrefix",
  hasPublicNotes: true,
  records: (world: TemplateWorld): Array<BaseModel> => {
    return world.incidents.records.rows;
  },
  add: (world: TemplateWorld, props?: RecordProps): BaseModel => {
    return finish(
      world.addIncident({
        title: "Checkout latency high",
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
    return finish(
      world.addAlert({
        title: "Checkout latency high",
        stateName: props?.stateName,
        customFields: props?.customFields,
      }),
      props,
    );
  },
};

const KINDS: Array<Kind> = [INCIDENT, ALERT];

// The link a case holds for the project's first record.
const linkOf: (kind: Kind, world: TemplateWorld) => string = (
  kind: Kind,
  world: TemplateWorld,
): string => {
  return `oneuptime-${kind.noun}-${(kind.records(world)[0] as BaseModel).id!.toString()}`;
};

const dynamicsWith: (
  setUp?: (dynamics: FakeDynamics, world: TemplateWorld) => void,
) => (world: TemplateWorld) => OtherTool = (
  setUp?: (dynamics: FakeDynamics, world: TemplateWorld) => void,
): ((world: TemplateWorld) => OtherTool) => {
  return (world: TemplateWorld): OtherTool => {
    const dynamics: FakeDynamics = new FakeDynamics();

    if (setUp) {
      setUp(dynamics, world);
    }

    return {
      http: (request: SimulatedRequest): SimulatedReply => {
        return dynamics.answer(request);
      },
      state: () => {
        return dynamics.state();
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

const delivery: (body: JSONObject) => JSONObject = (
  body: JSONObject,
): JSONObject => {
  return {
    "request-body": body,
    "request-headers": { "content-type": "application/json" },
    "request-params": {},
  };
};

/* --------------------------- OneUptime -> Dynamics 365 --------------------------- */

describe.each(KINDS)(
  "OneUptime to Dynamics 365, for an $noun, old and new",
  (kind: Kind) => {
    const outbound: (
      templateId: string,
      data: {
        record?: RecordProps;
        dynamics?: (dynamics: FakeDynamics, world: TemplateWorld) => void;
        trigger?: (world: TemplateWorld) => JSONObject;
      },
    ) => Promise<EquivalenceRun> = async (
      templateId: string,
      data: {
        record?: RecordProps;
        dynamics?: (dynamics: FakeDynamics, world: TemplateWorld) => void;
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
            return {
              model: BaseModel.toJSON(
                kind.records(world)[0] as BaseModel,
                kind.modelType,
              ),
            };
          }),
        tool: dynamicsWith(data.dynamics),
      });
    };

    const linkedCase: (
      statuscode?: number,
    ) => (dynamics: FakeDynamics, world: TemplateWorld) => void = (
      statuscode?: number,
    ): ((dynamics: FakeDynamics, world: TemplateWorld) => void) => {
      return (dynamics: FakeDynamics, world: TemplateWorld): void => {
        dynamics.addCase({
          incidentid: CASE_ID,
          link: linkOf(kind, world),
          statuscode: statuscode === undefined ? 1 : statuscode,
        });
      };
    };

    test.each([
      ["a new record opens a case", {}],
      ["a private record opens none", { isPrivate: true }],
      [
        "a record created from a case opens none",
        {
          customFields: {
            dynamicsCaseId: CASE_ID,
            dynamicsCaseNumber: "CAS-01001-X1Y2Z3",
          },
        },
      ],
    ] as Array<[string, RecordProps]>)(
      `dynamics-create-case-for-${kind.noun}: %s`,
      async (_name: string, record: RecordProps) => {
        const run: EquivalenceRun = await outbound(
          `dynamics-create-case-for-${kind.noun}`,
          { record },
        );

        expectSameOutcome(run);
        expect(
          ((run.new.tool as JSONObject)["cases"] as Array<JSONObject>).length,
        ).toBe(Object.keys(record).length === 0 ? 1 : 0);
      },
    );

    test(`dynamics-create-case-for-${kind.noun}: Dynamics 365 refusing the case fails the run, in both`, async () => {
      const run: EquivalenceRun = await outbound(
        `dynamics-create-case-for-${kind.noun}`,
        {
          dynamics: (dynamics: FakeDynamics): void => {
            dynamics.refuseWritesWith = 400;
          },
        },
      );

      expectSameOutcome(run);
      expect(run.new.failed).toBe(true);
    });

    test.each([
      [
        "resolved closes the linked case as Problem Solved",
        "Resolved",
        1,
        true,
      ],
      ["resolved leaves a case already resolved", "Resolved", 5, true],
      ["acknowledged changes nothing", "Acknowledged", 1, true],
      ["resolved with no linked case changes nothing", "Resolved", 1, false],
    ] as Array<[string, string, number, boolean]>)(
      `dynamics-update-case-on-${kind.noun}-state: %s`,
      async (
        _name: string,
        stateName: string,
        statuscode: number,
        linked: boolean,
      ) => {
        const run: EquivalenceRun = await outbound(
          `dynamics-update-case-on-${kind.noun}-state`,
          {
            record: { stateName },
            dynamics: linked
              ? linkedCase(statuscode)
              : (dynamics: FakeDynamics): void => {
                  dynamics.addCase({ incidentid: CASE_ID });
                },
          },
        );

        expectSameOutcome(run);
        // Only a resolved record closes its linked, active case, as Problem Solved.
        expect(
          ((run.new.tool as JSONObject)["cases"] as Array<JSONObject>)[0]?.[
            "statuscode"
          ],
        ).toBe(linked && stateName === "Resolved" ? 5 : statuscode);
      },
    );

    test(`dynamics-update-case-on-${kind.noun}-state: a private record changes nothing`, async () => {
      const run: EquivalenceRun = await outbound(
        `dynamics-update-case-on-${kind.noun}-state`,
        {
          record: { stateName: "Resolved", isPrivate: true },
          dynamics: linkedCase(),
        },
      );

      expectSameOutcome(run);
    });

    test(`dynamics-update-case-on-${kind.noun}-state: Dynamics 365 refusing to resolve fails the run, in both`, async () => {
      const run: EquivalenceRun = await outbound(
        `dynamics-update-case-on-${kind.noun}-state`,
        {
          record: { stateName: "Resolved" },
          dynamics: (dynamics: FakeDynamics, world: TemplateWorld): void => {
            linkedCase()(dynamics, world);
            dynamics.refuseWritesWith = 400;
          },
        },
      );

      expectSameOutcome(run);
      expect(run.new.failed).toBe(true);
    });

    const noteTemplates: Array<string> = [
      `dynamics-note-from-${kind.noun}-private-note`,
      ...(kind.hasPublicNotes
        ? [`dynamics-note-from-${kind.noun}-public-note`]
        : []),
    ];

    const noteTrigger: (world: TemplateWorld, note: string) => JSONObject = (
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
            isPrivate: false,
          },
          createdByUser: { name: { _type: "Name", value: "Jane Doe" } },
        },
      };
    };

    test.each(noteTemplates)(
      "%s: a note becomes a note on the linked case",
      async (templateId: string) => {
        const run: EquivalenceRun = await outbound(templateId, {
          dynamics: linkedCase(),
          trigger: (world: TemplateWorld): JSONObject => {
            return noteTrigger(world, "Rolled back the eu-west-1 deploy.");
          },
        });

        expectSameOutcome(run);
        expect(
          (run.new.tool as JSONObject)["notes"] as Array<JSONObject>,
        ).toHaveLength(1);
      },
    );

    test.each(noteTemplates)(
      "%s: a note that came from Dynamics 365 is not sent back",
      async (templateId: string) => {
        const run: EquivalenceRun = await outbound(templateId, {
          dynamics: linkedCase(),
          trigger: (world: TemplateWorld): JSONObject => {
            return noteTrigger(
              world,
              `${ONEUPTIME_SYNCED_FROM_DYNAMICS_MARKER}: Sam Okafor added a note to case CAS-01001-X1Y2Z3.`,
            );
          },
        });

        expectSameOutcome(run);
      },
    );

    test.each(noteTemplates)(
      "%s: a note on a record with no linked case is sent nowhere",
      async (templateId: string) => {
        const run: EquivalenceRun = await outbound(templateId, {
          trigger: (world: TemplateWorld): JSONObject => {
            return noteTrigger(world, "Rolled back.");
          },
        });

        expectSameOutcome(run);
      },
    );
  },
);

/* --------------------------- Dynamics 365 -> OneUptime --------------------------- */

describe.each(KINDS)(
  "Dynamics 365 to OneUptime, for an $noun, old and new",
  (kind: Kind) => {
    const inbound: (
      templateId: string,
      data: {
        body: (world: TemplateWorld) => JSONObject;
        setUp?: (world: TemplateWorld) => void;
        dynamics?: (dynamics: FakeDynamics, world: TemplateWorld) => void;
      },
    ) => Promise<EquivalenceRun> = async (
      templateId: string,
      data: {
        body: (world: TemplateWorld) => JSONObject;
        setUp?: (world: TemplateWorld) => void;
        dynamics?: (dynamics: FakeDynamics, world: TemplateWorld) => void;
      },
    ): Promise<EquivalenceRun> => {
      return await runOldAndNew({
        templateId: templateId,
        variables: VARIABLES,
        setUp: data.setUp,
        trigger: (world: TemplateWorld): JSONObject => {
          return delivery(data.body(world));
        },
        tool: dynamicsWith(data.dynamics),
      });
    };

    const declareTemplate: string = `dynamics-${kind.create}-${kind.noun}-from-case`;

    test.each([1, 2, 3, 7])(
      `${declareTemplate}: a new case of priority %p: the same record, at the same severity, linked back`,
      async (prioritycode: number) => {
        const run: EquivalenceRun = await inbound(declareTemplate, {
          body: (): JSONObject => {
            return webhookContext({ messageName: "Create" });
          },
          dynamics: (dynamics: FakeDynamics): void => {
            dynamics.addCase({ incidentid: CASE_ID, prioritycode });
          },
        });

        expectSameOutcome(run);
        expect(kind.records(run.newWorld)).toHaveLength(1);
      },
    );

    test(`${declareTemplate}: a flow posting the case's id is read alike`, async () => {
      const run: EquivalenceRun = await inbound(declareTemplate, {
        // The old template read incidentid, the new one PrimaryEntityId: a flow posting both works with either.
        body: (): JSONObject => {
          return { incidentid: CASE_ID, PrimaryEntityId: CASE_ID };
        },
        dynamics: (dynamics: FakeDynamics): void => {
          dynamics.addCase({ incidentid: CASE_ID });
        },
      });

      expectSameOutcome(run);
      expect(kind.records(run.newWorld)).toHaveLength(1);
    });

    test.each([
      [
        "a case already linked opens nothing",
        { link: "oneuptime-incident-9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d" },
      ],
      ["a case no longer active opens nothing", { statuscode: 5 }],
    ] as Array<[string, JSONObject]>)(
      `${declareTemplate}: %s`,
      async (_name: string, row: JSONObject) => {
        const run: EquivalenceRun = await inbound(declareTemplate, {
          body: (): JSONObject => {
            return webhookContext({ messageName: "Create" });
          },
          dynamics: (dynamics: FakeDynamics): void => {
            dynamics.addCase({ incidentid: CASE_ID, ...row });
          },
        });

        expectSameOutcome(run);
        expect(kind.records(run.newWorld)).toHaveLength(0);
      },
    );

    test(`${declareTemplate}: an Update of a case opens nothing`, async () => {
      const run: EquivalenceRun = await inbound(declareTemplate, {
        body: (): JSONObject => {
          return webhookContext({ messageName: "Update" });
        },
        dynamics: (dynamics: FakeDynamics): void => {
          dynamics.addCase({ incidentid: CASE_ID });
        },
      });

      expectSameOutcome(run);
    });

    test(`${declareTemplate}: a case sent again opens no second record`, async () => {
      const run: EquivalenceRun = await inbound(declareTemplate, {
        body: (): JSONObject => {
          return webhookContext({ messageName: "Create" });
        },
        setUp: (world: TemplateWorld): void => {
          kind.add(world, {
            customFields: {
              dynamicsCaseId: CASE_ID,
              dynamicsCaseNumber: "CAS-01001-X1Y2Z3",
            },
          });
        },
        dynamics: (dynamics: FakeDynamics, world: TemplateWorld): void => {
          dynamics.addCase({ incidentid: CASE_ID, link: linkOf(kind, world) });
        },
      });

      expectSameOutcome(run);
      expect(kind.records(run.newWorld)).toHaveLength(1);
    });

    const statusTemplate: string = `dynamics-case-status-to-${kind.noun}-state`;

    test.each([
      ["a Close resolves the linked record", "Close", 5, undefined],
      [
        "an Update to Problem Solved resolves the linked record",
        "Update",
        5,
        undefined,
      ],
      ["a Close leaves a resolved record", "Close", 5, "Resolved"],
      ["an Update to Researching moves nothing", "Update", 4, undefined],
      ["a Cancelled case moves nothing", "Update", 6, undefined],
    ] as Array<[string, string, number, string | undefined]>)(
      `${statusTemplate}: %s`,
      async (
        _name: string,
        messageName: string,
        statuscode: number,
        stateName: string | undefined,
      ) => {
        const run: EquivalenceRun = await inbound(statusTemplate, {
          body: (): JSONObject => {
            return webhookContext({ messageName });
          },
          setUp: (world: TemplateWorld): void => {
            kind.add(world, { stateName });
          },
          dynamics: (dynamics: FakeDynamics, world: TemplateWorld): void => {
            dynamics.addCase({
              incidentid: CASE_ID,
              statuscode,
              link: linkOf(kind, world),
            });
          },
        });

        expectSameOutcome(run);
        // A resolved case resolves its record; nothing else moves it.
        expect(
          (run.new.world[`${kind.noun}StateChanges`] as Array<JSONObject>).map(
            (change: JSONObject) => {
              return change["state"];
            },
          ),
        ).toEqual(statuscode === 5 && !stateName ? ["Resolved"] : []);
      },
    );

    test(`${statusTemplate}: a case not linked moves nothing`, async () => {
      const run: EquivalenceRun = await inbound(statusTemplate, {
        body: (): JSONObject => {
          return webhookContext({ messageName: "Close" });
        },
        setUp: (world: TemplateWorld): void => {
          kind.add(world);
        },
        dynamics: (dynamics: FakeDynamics): void => {
          dynamics.addCase({ incidentid: CASE_ID, statuscode: 5 });
        },
      });

      expectSameOutcome(run);
    });

    const noteTemplate: string = `dynamics-case-note-to-${kind.noun}-private-note`;

    test.each([
      ["a note on a linked case is a private note", undefined, true],
      [
        "a note OneUptime wrote is not copied back",
        `<p>${DYNAMICS_SYNCED_FROM_ONEUPTIME_MARKER}: private note on INC-1.</p>`,
        true,
      ],
      ["an empty note adds nothing", "", true],
      ["a note on a case not linked adds nothing", undefined, false],
    ] as Array<[string, string | undefined, boolean]>)(
      `${noteTemplate}: %s`,
      async (_name: string, notetext: string | undefined, linked: boolean) => {
        const run: EquivalenceRun = await inbound(noteTemplate, {
          body: (): JSONObject => {
            return webhookContext({
              messageName: "Create",
              table: "annotation",
              rowId: NOTE_ID,
            });
          },
          setUp: (world: TemplateWorld): void => {
            kind.add(world);
          },
          dynamics: (dynamics: FakeDynamics, world: TemplateWorld): void => {
            dynamics.addCase({
              incidentid: CASE_ID,
              link: linked ? linkOf(kind, world) : null,
            });
            dynamics.addNote({
              annotationid: NOTE_ID,
              caseId: CASE_ID,
              ...(notetext !== undefined ? { notetext, subject: "" } : {}),
            });
          },
        });

        expectSameOutcome(run);
      },
    );

    test(`${noteTemplate}: a note on an account, not a case, adds nothing`, async () => {
      const run: EquivalenceRun = await inbound(noteTemplate, {
        body: (): JSONObject => {
          return webhookContext({
            messageName: "Create",
            table: "annotation",
            rowId: NOTE_ID,
          });
        },
        setUp: (world: TemplateWorld): void => {
          kind.add(world);
        },
        dynamics: (dynamics: FakeDynamics): void => {
          dynamics.addNote({ annotationid: NOTE_ID, caseId: null });
        },
      });

      expectSameOutcome(run);
    });
  },
);
