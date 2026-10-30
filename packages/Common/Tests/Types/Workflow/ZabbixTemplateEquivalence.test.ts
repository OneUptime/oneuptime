/*
 * The Zabbix templates before and after they were made simple, on the same
 * events (TemplateEquivalence): the 48-step template that turned problems
 * into incidents is five steps now - the Webhook, read-event-1, Incident From
 * Another Tool, and an If / Else and a Page step for High and Disaster - and
 * the two that write back to Zabbix are three and four, through Update
 * Zabbix Problem. Each event below runs through the old graph and the new
 * template against a project and a Zabbix of their own, made the same way,
 * and must leave the same records, notes, state changes, Zabbix and pages.
 *
 * The events are the ones the Zabbix simulation follows a problem through:
 * what the guide's media type posts (zabbixPostedBody) for a problem at each
 * severity, its recovery and the updates made to it in Zabbix, and the
 * acknowledgments, resolutions and notes made in OneUptime, against a fake
 * of Zabbix's JSON-RPC API that keeps Zabbix's rules (FakeZabbix).
 */

import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Alert from "../../../Models/DatabaseModels/Alert";
import Incident from "../../../Models/DatabaseModels/Incident";
import WorkflowPrincipal, {
  WorkflowPrincipalOptions,
} from "../../../Server/Utils/Workflow/WorkflowPrincipal";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  ONEUPTIME_SYNCED_FROM_ZABBIX_MARKER,
  ZABBIX_EVENT_ID_CUSTOM_FIELD,
  ZABBIX_SYNCED_FROM_ONEUPTIME_MARKER,
  ZabbixEventKind,
} from "../../../Types/Workflow/Templates";
import {
  EquivalenceRun,
  EquivalenceScenario,
  OtherTool,
  runOldAndNew,
} from "./TemplateEquivalence";
import TemplateWorld from "./TemplateWorld";
import {
  EVENT_ID,
  FakeZabbix,
  FakeZabbixCall,
  OTHER_EVENT_ID,
  ZABBIX_API_TOKEN,
  ZABBIX_URL,
  ZabbixEventProps,
  ZabbixHttpReply,
  ZabbixHttpRequest,
  webhookDelivery,
  zabbixFirstMediaTypeBody,
  zabbixPostedBody,
} from "./ZabbixTemplateFixtures";
import { SimulatedReply, SimulatedRequest, stubDnsLookups } from "./WorkflowTemplateSimulator";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

// The sandbox boots a fresh isolate for every script a run reaches, twice per event.
jest.setTimeout(180000);

const POLICY_ID: string = "7b1c2d3e-0000-4000-8000-000000000001";

const VARIABLES: { [name: string]: string } = {
  zabbixUrl: ZABBIX_URL,
  zabbixApiToken: ZABBIX_API_TOKEN,
};

// Who to page: picked in the wizard now, in the Builder before.
const PICKS: { [componentId: string]: Array<string> } = {
  "page-on-call-policy-1": [POLICY_ID],
};

interface Kind {
  noun: "incident" | "alert";
  problemTemplateId: string;
  stateTemplateId: string;
  noteTemplateId: string;
  add: (world: TemplateWorld, props?: RecordProps) => BaseModel;
  records: (world: TemplateWorld) => Array<BaseModel>;
  modelType: { new (): BaseModel };
  idColumn: string;
}

interface RecordProps {
  eventId?: string | null | undefined;
  stateName?: string | undefined;
  isPrivate?: boolean | undefined;
}

const customFieldsOf: (props?: RecordProps) => JSONObject = (
  props?: RecordProps,
): JSONObject => {
  return props?.eventId === null
    ? {}
    : { [ZABBIX_EVENT_ID_CUSTOM_FIELD]: props?.eventId || EVENT_ID };
};

const INCIDENT: Kind = {
  noun: "incident",
  problemTemplateId: "zabbix-declare-incident-from-problem",
  stateTemplateId: "zabbix-update-problem-on-incident-state",
  noteTemplateId: "zabbix-message-from-incident-private-note",
  add: (world: TemplateWorld, props?: RecordProps): BaseModel => {
    const record: BaseModel = world.addIncident({
      customFields: customFieldsOf(props),
      stateName: props?.stateName,
      title: "Zabbix: High CPU utilization on web-1",
    });

    if (props?.isPrivate !== undefined) {
      record.setColumnValue("isPrivate", props.isPrivate);
    }

    return record;
  },
  records: (world: TemplateWorld): Array<BaseModel> => {
    return world.incidents.records.rows;
  },
  modelType: Incident,
  idColumn: "incidentId",
};

const ALERT: Kind = {
  noun: "alert",
  problemTemplateId: "zabbix-create-alert-from-problem",
  stateTemplateId: "zabbix-update-problem-on-alert-state",
  noteTemplateId: "zabbix-message-from-alert-private-note",
  add: (world: TemplateWorld, props?: RecordProps): BaseModel => {
    const record: BaseModel = world.addAlert({
      customFields: customFieldsOf(props),
      stateName: props?.stateName,
      title: "Zabbix: High CPU utilization on web-1",
    });

    if (props?.isPrivate !== undefined) {
      record.setColumnValue("isPrivate", props.isPrivate);
    }

    return record;
  },
  records: (world: TemplateWorld): Array<BaseModel> => {
    return world.alerts.records.rows;
  },
  modelType: Alert,
  idColumn: "alertId",
};

const KINDS: Array<Kind> = [INCIDENT, ALERT];

/*
 * A Zabbix of its own for each run, holding the problems given: what the
 * runs asked of it, and what it holds afterwards, are compared.
 */
const zabbixWith: (
  setUp?: (zabbix: FakeZabbix) => void,
) => () => OtherTool = (
  setUp?: (zabbix: FakeZabbix) => void,
): (() => OtherTool) => {
  return (): OtherTool => {
    const zabbix: FakeZabbix = new FakeZabbix();

    if (setUp) {
      setUp(zabbix);
    }

    return {
      http: (request: SimulatedRequest): SimulatedReply => {
        return zabbix.answer(
          request as ZabbixHttpRequest,
        ) as ZabbixHttpReply as SimulatedReply;
      },
      state: (): JSONValue => {
        return {
          // A number sent as text and as a number are one to Zabbix: "6" is 6.
          calls: zabbix.calls.map((call: FakeZabbixCall): JSONObject => {
            const params: JSONObject = { ...call.params };

            if (params["action"] !== undefined) {
              params["action"] = Number(params["action"]);
            }

            return { method: call.method, params: params };
          }),
          problems: Array.from(zabbix.problems.values()).map(
            (problem: unknown): JSONObject => {
              return JSON.parse(JSON.stringify(problem)) as JSONObject;
            },
          ),
        };
      },
    };
  };
};

// A record as an On Update trigger hands it over, read from the project.
const triggerModel: (kind: Kind, world: TemplateWorld) => JSONObject = (
  kind: Kind,
  world: TemplateWorld,
): JSONObject => {
  const record: BaseModel = kind.records(world)[0] as BaseModel;

  return { model: BaseModel.toJSON(record, kind.modelType) };
};

// A private note on the project's record, as its On Create trigger hands it over.
const noteTrigger: (
  kind: Kind,
  world: TemplateWorld,
  note: string,
  author?: string | null,
) => JSONObject = (
  kind: Kind,
  world: TemplateWorld,
  note: string,
  author?: string | null,
): JSONObject => {
  const record: BaseModel = kind.records(world)[0] as BaseModel;
  const model: JSONObject = {
    _id: "cccccccc-0000-4000-8000-000000000001",
    note: note,
    [kind.idColumn]: { _type: "ObjectID", value: record.id!.toString() },
  };

  if (author !== null) {
    model["createdByUser"] = {
      name: { _type: "Name", value: author || "Jane Doe" },
    };
  }

  return { model: model };
};

const expectSameOutcome: (run: EquivalenceRun) => void = (
  run: EquivalenceRun,
): void => {
  expect(run.new.world).toEqual(run.old.world);
  expect(run.new.tool).toEqual(run.old.tool);
  expect(run.new.pages).toEqual(run.old.pages);
  expect(run.new.failed).toBe(run.old.failed);
};

beforeEach(() => {
  // Update Zabbix Problem and the old API steps resolve Zabbix's host before every request.
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

/* ------------------------------- Zabbix -> OneUptime ------------------------------- */

const problemScenario: (
  kind: Kind,
  body: JSONValue,
  setUp?: (world: TemplateWorld) => void,
  extra?: Partial<EquivalenceScenario>,
) => EquivalenceScenario = (
  kind: Kind,
  body: JSONValue,
  setUp?: (world: TemplateWorld) => void,
  extra?: Partial<EquivalenceScenario>,
): EquivalenceScenario => {
  return {
    templateId: kind.problemTemplateId,
    variables: VARIABLES,
    setUp: setUp,
    trigger: (): JSONObject => {
      return webhookDelivery(body);
    },
    picks: PICKS,
    ...extra,
  };
};

describe.each(KINDS)("$problemTemplateId, old and new", (kind: Kind) => {
  test.each([0, 1, 2, 3, 4, 5])(
    "a problem of Zabbix severity %p: the same record, at the same severity, paged the same",
    async (severityNumber: number) => {
      const run: EquivalenceRun = await runOldAndNew(
        problemScenario(kind, zabbixPostedBody({ severityNumber })),
      );

      expectSameOutcome(run);
      expect(kind.records(run.newWorld)).toHaveLength(1);
      expect(run.new.pages).toHaveLength(severityNumber >= 4 ? 1 : 0);
      expect(run.new.failed).toBe(false);
    },
  );

  test("a problem spread over a project's own five severities lands on the same one", async () => {
    for (const severityNumber of [0, 2, 3, 5]) {
      const run: EquivalenceRun = await runOldAndNew({
        ...problemScenario(kind, zabbixPostedBody({ severityNumber })),
        setUp: (world: TemplateWorld): void => {
          const project: typeof world.incidents =
            kind === INCIDENT ? world.incidents : world.alerts;
          const names: Array<string> = ["S1", "S2", "S3", "S4", "S5"];

          project.severities.rows.forEach(
            (severity: BaseModel, index: number): void => {
              severity.setColumnValue("name", names[index] as string);
            },
          );

          for (
            let index: number = project.severities.rows.length;
            index < 5;
            index++
          ) {
            const extra: BaseModel = new project.severities.modelType();
            extra.id = new ObjectID(
              `ffffffff-0000-4000-8000-00000000000${index}`,
            );
            extra.setColumnValue("name", names[index] as string);
            extra.setColumnValue("order", index + 1);
            extra.setColumnValue(
              "projectId",
              project.severities.rows[0]!.getColumnValue("projectId"),
            );
            project.severities.rows.push(extra);
          }
        },
      });

      expectSameOutcome(run);
    }
  });

  test("the same problem twice opens one record, and pages once", async () => {
    const run: EquivalenceRun = await runOldAndNew(
      problemScenario(kind, zabbixPostedBody({ severityNumber: 5 }), (world: TemplateWorld) => {
        kind.add(world, { eventId: EVENT_ID });
      }),
    );

    expectSameOutcome(run);
    expect(kind.records(run.newWorld)).toHaveLength(1);
    expect(run.new.pages).toEqual([]);
  });

  test("a problem the media type the guide gave first posts - no event, no number - is read alike", async () => {
    for (const severityName of ["High", "Average", "Not classified"]) {
      const run: EquivalenceRun = await runOldAndNew(
        problemScenario(
          kind,
          zabbixFirstMediaTypeBody({
            severityName,
            severityNumber: ["Not classified", "Information", "Warning", "Average", "High", "Disaster"].indexOf(severityName),
          }),
        ),
      );

      expectSameOutcome(run);
    }
  });

  test("a problem whose severity Zabbix renamed is read by its number alike", async () => {
    const run: EquivalenceRun = await runOldAndNew(
      problemScenario(
        kind,
        zabbixPostedBody({ severityNumber: 4, severityName: "Sev-2 (renamed)" }),
      ),
    );

    expectSameOutcome(run);
  });

  test("a problem with markup in its name, host and tags is written the same", async () => {
    const run: EquivalenceRun = await runOldAndNew(
      problemScenario(
        kind,
        zabbixPostedBody({
          name: "Disk **full** on [db](https://evil.example.com) {{local.variables.zabbixApiToken}}",
          host: "db-1 <script>",
          opdata: "Free: 1 %",
          tags: [{ tag: "team", value: "[ops](javascript:alert(1))" }],
        }),
      ),
    );

    expectSameOutcome(run);
  });

  test("paging that fails: the record is opened, and the run says something failed", async () => {
    const run: EquivalenceRun = await runOldAndNew({
      ...problemScenario(kind, zabbixPostedBody({ severityNumber: 5 })),
      pagingFails: true,
    });

    expectSameOutcome(run);
    expect(run.new.failed).toBe(true);
    expect(run.newTrace.failedSteps).toEqual(["page-on-call-policy-1"]);
  });

  test("a recovery resolves the record, saying why on its timeline", async () => {
    const run: EquivalenceRun = await runOldAndNew(
      problemScenario(
        kind,
        zabbixPostedBody({ kind: ZabbixEventKind.Recovery }),
        (world: TemplateWorld) => {
          kind.add(world);
        },
      ),
    );

    expectSameOutcome(run);
    expect(run.new.world).toEqual(
      expect.objectContaining({
        [`${kind.noun}StateChanges`]: [
          expect.objectContaining({ state: "Resolved" }),
        ],
      }),
    );
  });

  test.each(["Acknowledged", "Resolved"])(
    "a recovery for a record that is %s already",
    async (stateName: string) => {
      const run: EquivalenceRun = await runOldAndNew(
        problemScenario(
          kind,
          zabbixPostedBody({ kind: ZabbixEventKind.Recovery }),
          (world: TemplateWorld) => {
            kind.add(world, { stateName });
          },
        ),
      );

      expectSameOutcome(run);
    },
  );

  test("a recovery of the first media type (status 0, no event)", async () => {
    const run: EquivalenceRun = await runOldAndNew(
      problemScenario(
        kind,
        zabbixFirstMediaTypeBody({ kind: ZabbixEventKind.Recovery }),
        (world: TemplateWorld) => {
          kind.add(world);
        },
      ),
    );

    expectSameOutcome(run);
  });

  test("a recovery for a problem no record was opened for changes nothing", async () => {
    const run: EquivalenceRun = await runOldAndNew(
      problemScenario(
        kind,
        zabbixPostedBody({ kind: ZabbixEventKind.Recovery }),
        (world: TemplateWorld) => {
          kind.add(world, { eventId: OTHER_EVENT_ID });
        },
      ),
    );

    expectSameOutcome(run);
    expect(run.new.failed).toBe(false);
  });

  const updates: Array<[string, ZabbixEventProps, string | undefined]> = [
    ["an acknowledgment with a message", {}, undefined],
    [
      "an acknowledgment with no message",
      { updateAction: "acknowledged", updateMessage: "" },
      undefined,
    ],
    [
      "a comment only",
      { updateAction: "commented", updateMessage: "Still looking." },
      undefined,
    ],
    [
      "an acknowledgment of a record acknowledged already",
      {},
      "Acknowledged",
    ],
    ["an acknowledgment of a resolved record", {}, "Resolved"],
    [
      "a severity change",
      { updateAction: "changed severity", updateMessage: "" },
      undefined,
    ],
    [
      "an update with markup in it",
      {
        updateUser: "**Mallory** [x](https://evil.example.com)",
        updateMessage: "See {{local.variables.zabbixApiToken}} and ![img](https://evil.example.com/x.png)",
      },
      undefined,
    ],
  ];

  test.each(updates)(
    "an update - %s",
    async (_name: string, props: ZabbixEventProps, stateName: string | undefined) => {
      const run: EquivalenceRun = await runOldAndNew(
        problemScenario(
          kind,
          zabbixPostedBody({ kind: ZabbixEventKind.Update, ...props }),
          (world: TemplateWorld) => {
            kind.add(world, { stateName });
          },
        ),
      );

      expectSameOutcome(run);
      expect(run.new.failed).toBe(false);
    },
  );

  test.each([
    [
      "an update that came from OneUptime",
      zabbixPostedBody({
        kind: ZabbixEventKind.Update,
        updateMessage: `${ZABBIX_SYNCED_FROM_ONEUPTIME_MARKER}: INC-1 was acknowledged in OneUptime.`,
      }),
    ],
    [
      "an update that says nothing",
      zabbixPostedBody({
        kind: ZabbixEventKind.Update,
        updateAction: "",
        updateMessage: "",
      }),
    ],
    ["a request from another tool", { source: "grafana", event_id: "1" }],
    ["an event with no event ID", { ...zabbixPostedBody(), event_id: "abc" }],
    [
      "an event that is no problem, recovery or update",
      { ...zabbixPostedBody(), event: "maintenance", status: "2" },
    ],
    ["an empty request", {}],
    ["a request that is not JSON", "not json"],
  ])("%s changes nothing, in either", async (_name: string, body: JSONValue) => {
    const run: EquivalenceRun = await runOldAndNew(
      problemScenario(kind, body, (world: TemplateWorld) => {
        kind.add(world);
      }),
    );

    expectSameOutcome(run);
    expect(run.new.world[`${kind.noun}Notes`]).toEqual([]);
    expect(run.new.world[`${kind.noun}StateChanges`]).toEqual([]);
    expect(kind.records(run.newWorld)).toHaveLength(1);
    expect(run.new.failed).toBe(false);
    expect(run.newTrace.ports["read-event-1"]).toBe("no");
  });

  test("an update for a problem with no record changes nothing", async () => {
    const run: EquivalenceRun = await runOldAndNew(
      problemScenario(kind, zabbixPostedBody({ kind: ZabbixEventKind.Update })),
    );

    expectSameOutcome(run);
  });

  test("the update's note, and the cause of its acknowledgment, say Synced from Zabbix", async () => {
    const run: EquivalenceRun = await runOldAndNew(
      problemScenario(
        kind,
        zabbixPostedBody({ kind: ZabbixEventKind.Update }),
        (world: TemplateWorld) => {
          kind.add(world);
        },
      ),
    );
    const notes: Array<JSONObject> = run.new.world[
      `${kind.noun}Notes`
    ] as Array<JSONObject>;
    const changes: Array<JSONObject> = run.new.world[
      `${kind.noun}StateChanges`
    ] as Array<JSONObject>;

    expect(String(notes[0]?.["note"])).toContain(
      `${ONEUPTIME_SYNCED_FROM_ZABBIX_MARKER}: Ada Lovelace (ada) updated Zabbix`,
    );
    expect(changes).toEqual([
      expect.objectContaining({
        state: "Acknowledged",
        rootCause: expect.stringContaining(
          `${ONEUPTIME_SYNCED_FROM_ZABBIX_MARKER}: Ada Lovelace (ada) acknowledged`,
        ),
      }),
    ]);
  });
});

/* ------------------------------- OneUptime -> Zabbix ------------------------------- */

describe.each(KINDS)("$stateTemplateId, old and new", (kind: Kind) => {
  const stateScenario: (
    record: RecordProps,
    zabbix?: (fake: FakeZabbix) => void,
  ) => EquivalenceScenario = (
    record: RecordProps,
    zabbix?: (fake: FakeZabbix) => void,
  ): EquivalenceScenario => {
    return {
      templateId: kind.stateTemplateId,
      variables: VARIABLES,
      setUp: (world: TemplateWorld): void => {
        kind.add(world, record);
      },
      trigger: (world: TemplateWorld): JSONObject => {
        return triggerModel(kind, world);
      },
      tool: zabbixWith(
        zabbix ||
          ((fake: FakeZabbix): void => {
            fake.add({ manual_close: "1" });
          }),
      ),
    };
  };

  test.each([
    ["acknowledged, acknowledges the problem", { stateName: "Acknowledged" }, undefined],
    ["resolved, closes the problem", { stateName: "Resolved" }, undefined],
    [
      "resolved, acknowledges a problem whose trigger cannot be closed by hand, and says why",
      { stateName: "Resolved" },
      (fake: FakeZabbix): void => {
        fake.add({ manual_close: "0" });
      },
    ],
    [
      "resolved, leaves a problem Zabbix resolved already",
      { stateName: "Resolved" },
      (fake: FakeZabbix): void => {
        fake.add({ manual_close: "1", r_eventid: "99001" });
      },
    ],
    [
      "acknowledged, leaves a problem acknowledged already",
      { stateName: "Acknowledged" },
      (fake: FakeZabbix): void => {
        fake.add({ manual_close: "1", acknowledged: "1" });
      },
    ],
    [
      "resolved, closes a problem acknowledged already",
      { stateName: "Resolved" },
      (fake: FakeZabbix): void => {
        fake.add({ manual_close: "1", acknowledged: "1" });
      },
    ],
    [
      "acknowledged, for a problem Zabbix does not have",
      { stateName: "Acknowledged", eventId: OTHER_EVENT_ID },
      undefined,
    ],
    [
      "at another state, does nothing",
      { stateName: kind === INCIDENT ? "Monitoring" : "Created" },
      undefined,
    ],
    ["of a private record, does nothing", { stateName: "Resolved", isPrivate: true }, undefined],
    [
      "of a record no Zabbix problem opened, does nothing",
      { stateName: "Resolved", eventId: null },
      undefined,
    ],
  ] as Array<[string, RecordProps, ((fake: FakeZabbix) => void) | undefined]>)(
    "a record %s",
    async (
      _name: string,
      record: RecordProps,
      zabbix: ((fake: FakeZabbix) => void) | undefined,
    ) => {
      const run: EquivalenceRun = await runOldAndNew(stateScenario(record, zabbix));

      expectSameOutcome(run);
      expect(run.new.failed).toBe(false);
    },
  );

  test("Zabbix refusing the close: the run fails, in both", async () => {
    const run: EquivalenceRun = await runOldAndNew(
      stateScenario({ stateName: "Resolved" }, (fake: FakeZabbix): void => {
        fake.add({ manual_close: "1" });
        fake.canClose = false;
      }),
    );

    expectSameOutcome(run);
    expect(run.new.failed).toBe(true);
    expect(run.newTrace.failedSteps).toEqual(["update-problem-1"]);
  });

  test("a wrong API token: the run fails, in both", async () => {
    const run: EquivalenceRun = await runOldAndNew({
      ...stateScenario({ stateName: "Acknowledged" }),
      tool: zabbixWith((fake: FakeZabbix): void => {
        fake.add({ manual_close: "1" });
        fake.token = "another-token";
      }),
    });

    expectSameOutcome(run);
    expect(run.new.failed).toBe(true);
  });
});

describe.each(KINDS)("$noteTemplateId, old and new", (kind: Kind) => {
  const noteScenario: (
    note: string,
    record?: RecordProps,
    author?: string | null,
  ) => EquivalenceScenario = (
    note: string,
    record?: RecordProps,
    author?: string | null,
  ): EquivalenceScenario => {
    return {
      templateId: kind.noteTemplateId,
      variables: VARIABLES,
      setUp: (world: TemplateWorld): void => {
        kind.add(world, record);
      },
      trigger: (world: TemplateWorld): JSONObject => {
        return noteTrigger(kind, world, note, author);
      },
      tool: zabbixWith((fake: FakeZabbix): void => {
        fake.add({ manual_close: "1" });
      }),
    };
  };

  test.each([
    ["a note becomes a message on the problem", "Rolled the checkout pods back.", {}, undefined],
    ["a note by nobody named", "Rolled back.", {}, null],
    ["a note longer than Zabbix keeps is cut", "x".repeat(5000), {}, undefined],
    [
      "a note that came from Zabbix is not sent back",
      `${ONEUPTIME_SYNCED_FROM_ZABBIX_MARKER}: Ada updated Zabbix problem 12345.`,
      {},
      undefined,
    ],
    ["an empty note is not sent", "   ", {}, undefined],
    ["a note on a private record is not sent", "Rolled back.", { isPrivate: true }, undefined],
    [
      "a note on a record no Zabbix problem opened is not sent",
      "Rolled back.",
      { eventId: null },
      undefined,
    ],
    [
      "a note with markup is sent as written",
      "See **this** {{local.variables.zabbixApiToken}}",
      {},
      undefined,
    ],
  ] as Array<[string, string, RecordProps, string | null | undefined]>)(
    "%s",
    async (
      _name: string,
      note: string,
      record: RecordProps,
      author: string | null | undefined,
    ) => {
      const run: EquivalenceRun = await runOldAndNew(
        noteScenario(note, record, author),
      );

      expectSameOutcome(run);
      expect(run.new.failed).toBe(false);
    },
  );
});

/* ------------------------------ Both ways at once ------------------------------ */

describe("both ways at once settle, in the new templates as in the old", () => {
  test("an acknowledgment in Zabbix comes back from OneUptime as nothing at all", async () => {
    // Zabbix tells OneUptime the problem was acknowledged; OneUptime acknowledges the incident.
    const inbound: EquivalenceRun = await runOldAndNew(
      problemScenario(
        INCIDENT,
        zabbixPostedBody({ kind: ZabbixEventKind.Update }),
        (world: TemplateWorld) => {
          INCIDENT.add(world);
        },
      ),
    );

    expectSameOutcome(inbound);

    // The incident's state change runs the state template, which finds the problem acknowledged already.
    const outbound: EquivalenceRun = await runOldAndNew({
      templateId: INCIDENT.stateTemplateId,
      variables: VARIABLES,
      setUp: (world: TemplateWorld): void => {
        INCIDENT.add(world, { stateName: "Acknowledged" });
      },
      trigger: (world: TemplateWorld): JSONObject => {
        return triggerModel(INCIDENT, world);
      },
      tool: zabbixWith((fake: FakeZabbix): void => {
        fake.add({ manual_close: "1", acknowledged: "1" });
      }),
    });

    expectSameOutcome(outbound);
    expect(
      (outbound.new.tool as JSONObject)["calls"] as Array<JSONObject>,
    ).toEqual([expect.objectContaining({ method: "event.get" })]);
  });
});
