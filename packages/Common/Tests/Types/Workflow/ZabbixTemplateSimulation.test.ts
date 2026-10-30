/*
 * The Zabbix templates, run end to end by the template simulator
 * (WorkflowTemplateSimulator): the graph the create wizard builds, with
 * who was picked to page, its values substituted the way RunWorkflow does,
 * the real Check With JavaScript, Incident and Alert From Another Tool,
 * If / Else, Page and Update Zabbix Problem steps, and every script in the
 * real sandbox. Zabbix's side is what the guide's media type posts
 * (zabbixPostedBody, which App's IntegrationsDocsFacts holds to the guide's
 * script) and a fake of its JSON-RPC API that keeps Zabbix's rules
 * (FakeZabbix). The project is one held in memory (TemplateWorld), and the
 * paging itself (OnCallPageService.page) is stood in for.
 *
 * A problem, followed from start to end, for an incident and for an alert:
 *
 *   - problem: a record at the severity Zabbix's maps to, titled after the
 *     problem and its host, kept off status pages (an incident), holding the
 *     problem's event ID - paged for High and Disaster, never twice for one
 *     event ID;
 *   - recovery: that record resolved, saying why; nothing for a problem no
 *     record was opened for;
 *   - update: a private note saying what was done in Zabbix, and the record
 *     acknowledged when the update acknowledged the problem.
 *
 * And the other way: acknowledging or resolving the record acknowledges or
 * closes the problem through Zabbix's API, as Zabbix expects the call, and a
 * private note becomes a message on the problem. Last, the two directions
 * together settle instead of echoing each other.
 *
 * That the five steps do what the 48 did, event for event, is
 * ZabbixTemplateEquivalence's.
 */

import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Alert from "../../../Models/DatabaseModels/Alert";
import Incident from "../../../Models/DatabaseModels/Incident";
import WorkflowPrincipal, {
  WorkflowPrincipalOptions,
} from "../../../Server/Utils/Workflow/WorkflowPrincipal";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import {
  ONEUPTIME_SYNCED_FROM_ZABBIX_MARKER,
  ZABBIX_EVENT_ID_CUSTOM_FIELD,
  ZABBIX_MESSAGE_MAX_LENGTH,
  ZABBIX_SYNCED_FROM_ONEUPTIME_MARKER,
  ZabbixEventKind,
} from "../../../Types/Workflow/Templates";
import { ZABBIX_CANNOT_CLOSE_SENTENCE } from "../../../Types/Workflow/Components/Zabbix";
import {
  EquivalenceScenario,
  OtherTool,
  TemplateRun,
  runNewTemplate,
} from "./TemplateEquivalence";
import TemplateWorld from "./TemplateWorld";
import {
  EVENT_ID,
  FakeZabbix,
  OTHER_EVENT_ID,
  PROBLEM_LINK,
  ZABBIX_API_TOKEN,
  ZABBIX_API_URL,
  ZABBIX_URL,
  ZabbixHttpReply,
  ZabbixHttpRequest,
  webhookDelivery,
  zabbixFirstMediaTypeBody,
  zabbixPostedBody,
} from "./ZabbixTemplateFixtures";
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

const POLICY_ID: string = "7b1c2d3e-0000-4000-8000-000000000001";

const VARIABLES: { [name: string]: string } = {
  zabbixUrl: ZABBIX_URL,
  zabbixApiToken: ZABBIX_API_TOKEN,
};

// Who to page, as the wizard stores the policy picked.
const PICKS: { [componentId: string]: Array<string> } = {
  "page-on-call-policy-1": [POLICY_ID],
};

interface Kind {
  noun: "incident" | "alert";
  Noun: string;
  created: string;
  Created: string;
  problemTemplateId: string;
  stateTemplateId: string;
  noteTemplateId: string;
  step: string;
  // What a new project's most severe, middle and least severe severities are called.
  severities: [string, string, string];
  modelType: { new (): BaseModel };
  idColumn: string;
  records: (world: TemplateWorld) => Array<BaseModel>;
  add: (world: TemplateWorld, props?: RecordProps) => BaseModel;
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

const withPrivacy: (record: BaseModel, props?: RecordProps) => BaseModel = (
  record: BaseModel,
  props?: RecordProps,
): BaseModel => {
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
  problemTemplateId: "zabbix-declare-incident-from-problem",
  stateTemplateId: "zabbix-update-problem-on-incident-state",
  noteTemplateId: "zabbix-message-from-incident-private-note",
  step: "incident-from-another-tool-1",
  severities: ["Critical Incident", "Major Incident", "Minor Incident"],
  modelType: Incident,
  idColumn: "incidentId",
  records: (world: TemplateWorld): Array<BaseModel> => {
    return world.incidents.records.rows;
  },
  add: (world: TemplateWorld, props?: RecordProps): BaseModel => {
    return withPrivacy(
      world.addIncident({
        customFields: customFieldsOf(props),
        stateName: props?.stateName,
        title: "Zabbix: High CPU utilization on web-1",
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
  problemTemplateId: "zabbix-create-alert-from-problem",
  stateTemplateId: "zabbix-update-problem-on-alert-state",
  noteTemplateId: "zabbix-message-from-alert-private-note",
  step: "alert-from-another-tool-1",
  severities: ["High", "Low", "Low"],
  modelType: Alert,
  idColumn: "alertId",
  records: (world: TemplateWorld): Array<BaseModel> => {
    return world.alerts.records.rows;
  },
  add: (world: TemplateWorld, props?: RecordProps): BaseModel => {
    return withPrivacy(
      world.addAlert({
        customFields: customFieldsOf(props),
        stateName: props?.stateName,
        title: "Zabbix: High CPU utilization on web-1",
      }),
      props,
    );
  },
};

const KINDS: Array<Kind> = [INCIDENT, ALERT];

// The Zabbix of one run: the problems it holds, and what it was asked.
let zabbix: FakeZabbix;

const zabbixTool: (setUp?: (fake: FakeZabbix) => void) => () => OtherTool = (
  setUp?: (fake: FakeZabbix) => void,
): (() => OtherTool) => {
  return (): OtherTool => {
    zabbix = new FakeZabbix();

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
        return null;
      },
    };
  };
};

beforeEach(() => {
  // Update Zabbix Problem resolves Zabbix's host before every request; it is a public one.
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

const recordsOf: (run: TemplateRun, kind: Kind) => Array<JSONObject> = (
  run: TemplateRun,
  kind: Kind,
): Array<JSONObject> => {
  return run.outcome.world[`${kind.noun}s`] as Array<JSONObject>;
};

/* ------------------------------- Zabbix -> OneUptime ------------------------------- */

describe.each(KINDS)("$problemTemplateId", (kind: Kind) => {
  const receive: (
    body: JSONValue,
    setUp?: (world: TemplateWorld) => void,
    extra?: Partial<EquivalenceScenario>,
  ) => Promise<TemplateRun> = async (
    body: JSONValue,
    setUp?: (world: TemplateWorld) => void,
    extra?: Partial<EquivalenceScenario>,
  ): Promise<TemplateRun> => {
    return await runNewTemplate({
      templateId: kind.problemTemplateId,
      variables: VARIABLES,
      setUp: setUp,
      trigger: (): JSONObject => {
        return webhookDelivery(body);
      },
      picks: PICKS,
      ...extra,
    });
  };

  test(`a new problem is ${kind.created} as one ${kind.noun}: titled after the problem and its host, at the mapped severity, holding the problem's event ID`, async () => {
    const run: TemplateRun = await receive(zabbixPostedBody());
    const records: Array<JSONObject> = recordsOf(run, kind);

    expect(records).toHaveLength(1);
    expect(records[0]).toEqual(
      expect.objectContaining({
        number: kind === INCIDENT ? "INC-1" : "ALT-1",
        title: "Zabbix: High CPU utilization on web-1",
        severity: kind.severities[0],
        customFields: { [ZABBIX_EVENT_ID_CUSTOM_FIELD]: EVENT_ID },
        ...(kind === INCIDENT
          ? {
              isVisibleOnStatusPage: false,
              shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: false,
            }
          : {}),
      }),
    );
    expect(String(records[0]?.["description"]).split("\n")[0]).toBe(
      `${kind.Created} from Zabbix ${PROBLEM_LINK}.`,
    );
  });

  test("the run reads the event, keeps the record, and pages: every step says why it went on", async () => {
    const run: TemplateRun = await receive(zabbixPostedBody());

    expect(run.trace.executed).toEqual([
      "webhook-1",
      "read-event-1",
      kind.step,
      "if-page-1",
      "page-on-call-policy-1",
    ]);
    expect(run.trace.ports).toEqual(
      expect.objectContaining({
        "read-event-1": "yes",
        [kind.step]: "opened",
        "if-page-1": "yes",
        "page-on-call-policy-1": "success",
      }),
    );
    expect(run.trace.portReasons[kind.step]).toBe(
      `${kind === INCIDENT ? "Opened INC-1" : "Created ALT-1"} at ${kind.severities[0]} for zabbixEventId ${EVENT_ID}.`,
    );
    expect(run.trace.failedSteps).toEqual([]);
  });

  test.each([
    [5, "Disaster", 0, true],
    [4, "High", 0, true],
    [3, "Average", 1, false],
    [2, "Warning", 1, false],
    [1, "Information", 2, false],
    [0, "Not classified", 2, false],
  ])(
    "a problem of Zabbix severity %p (%s) opens at the project's %p place, and pages: %p",
    async (
      severityNumber: number,
      _name: string,
      place: number,
      pages: boolean,
    ) => {
      const run: TemplateRun = await receive(zabbixPostedBody({ severityNumber }));

      expect(recordsOf(run, kind)[0]?.["severity"]).toBe(kind.severities[place]);
      expect(run.outcome.pages).toEqual(
        pages
          ? [
              expect.objectContaining({
                policies: [POLICY_ID],
                about: `${kind.noun} ${kind === INCIDENT ? "INC-1" : "ALT-1"}`,
              }),
            ]
          : [],
      );
    },
  );

  test("the same event ID again opens no other record, and pages nobody again", async () => {
    const run: TemplateRun = await receive(
      zabbixPostedBody({ severityNumber: 5 }),
      (world: TemplateWorld): void => {
        kind.add(world);
      },
    );

    expect(kind.records(run.world)).toHaveLength(1);
    expect(run.outcome.pages).toEqual([]);
    expect(run.trace.ports[kind.step]).toBe("unchanged");
    expect(run.trace.portReasons[kind.step]).toBe(
      `${kind === INCIDENT ? "INC-1" : "ALT-1"} already has zabbixEventId ${EVENT_ID}, so no other ${kind.noun} was ${kind === INCIDENT ? "opened" : "created"}.`,
    );
  });

  test("with nobody picked to page, the record is opened and nobody is paged", async () => {
    const run: TemplateRun = await receive(
      zabbixPostedBody({ severityNumber: 5 }),
      undefined,
      { picks: {} },
    );

    expect(kind.records(run.world)).toHaveLength(1);
    expect(run.outcome.pages).toEqual([]);
    expect(run.trace.executed).toEqual(["webhook-1", "read-event-1", kind.step]);
    expect(run.trace.failedSteps).toEqual([]);
  });

  test("a page that reaches nobody fails the run at the Page step, and the record stays opened", async () => {
    const run: TemplateRun = await receive(
      zabbixPostedBody({ severityNumber: 5 }),
      undefined,
      { pagingFails: true },
    );

    expect(kind.records(run.world)).toHaveLength(1);
    expect(run.trace.failedSteps).toEqual(["page-on-call-policy-1"]);
    expect(run.outcome.failed).toBe(true);
  });

  test("a project with no severities opens nothing, and the run fails saying why", async () => {
    const run: TemplateRun = await receive(
      zabbixPostedBody(),
      (world: TemplateWorld): void => {
        (kind === INCIDENT ? world.incidents : world.alerts).severities.rows = [];
      },
    );

    expect(kind.records(run.world)).toHaveLength(0);
    expect(run.trace.failedSteps).toEqual([kind.step]);
    expect(run.trace.portReasons[kind.step]).toContain(
      `This project has no ${kind.noun} severities to put the ${kind.noun} at.`,
    );
  });

  test("the problem's recovery resolves the record it opened, saying why on its timeline", async () => {
    const run: TemplateRun = await receive(
      zabbixPostedBody({ kind: ZabbixEventKind.Recovery }),
      (world: TemplateWorld): void => {
        kind.add(world);
      },
    );

    expect(recordsOf(run, kind)[0]?.["state"]).toBe("Resolved");
    expect(changesOf(run, kind)).toEqual([
      {
        record: kind === INCIDENT ? "INC-1" : "ALT-1",
        state: "Resolved",
        rootCause: `${ONEUPTIME_SYNCED_FROM_ZABBIX_MARKER}: ${PROBLEM_LINK} recovered.`,
      },
    ]);
    expect(notesOf(run, kind)).toEqual([]);
  });

  test("an acknowledged record is resolved by the recovery too: it moves forward past Acknowledged", async () => {
    const run: TemplateRun = await receive(
      zabbixPostedBody({ kind: ZabbixEventKind.Recovery }),
      (world: TemplateWorld): void => {
        kind.add(world, { stateName: "Acknowledged" });
      },
    );

    expect(recordsOf(run, kind)[0]?.["state"]).toBe("Resolved");
  });

  test("a record that is already resolved is left as it is: it never moves back", async () => {
    const run: TemplateRun = await receive(
      zabbixPostedBody({ kind: ZabbixEventKind.Recovery }),
      (world: TemplateWorld): void => {
        kind.add(world, { stateName: "Resolved" });
      },
    );

    expect(changesOf(run, kind)).toEqual([]);
    expect(run.trace.ports[kind.step]).toBe("unchanged");
  });

  test("the recovery of a problem no record was opened for changes nothing, and the run succeeds", async () => {
    const run: TemplateRun = await receive(
      zabbixPostedBody({ kind: ZabbixEventKind.Recovery }),
      (world: TemplateWorld): void => {
        kind.add(world, { eventId: OTHER_EVENT_ID });
      },
    );

    expect(changesOf(run, kind)).toEqual([]);
    expect(run.trace.portReasons[kind.step]).toBe(
      `No ${kind.noun} has zabbixEventId ${EVENT_ID}, so there was nothing to resolve.`,
    );
    expect(run.trace.failedSteps).toEqual([]);
  });

  test("a project with no resolved state resolves nothing, and the run fails saying why", async () => {
    const run: TemplateRun = await receive(
      zabbixPostedBody({ kind: ZabbixEventKind.Recovery }),
      (world: TemplateWorld): void => {
        kind.add(world);
        const project: typeof world.incidents =
          kind === INCIDENT ? world.incidents : world.alerts;
        project.states.rows = project.states.rows.filter(
          (state: BaseModel): boolean => {
            return state.getColumnValue("isResolvedState") !== true;
          },
        );
      },
    );

    expect(run.trace.failedSteps).toEqual([kind.step]);
    expect(run.trace.portReasons[kind.step]).toContain(
      `This project has no resolved ${kind.noun} state.`,
    );
  });

  test("an update acknowledging the problem adds what was done to the record as a private note, and acknowledges it", async () => {
    const run: TemplateRun = await receive(
      zabbixPostedBody({ kind: ZabbixEventKind.Update }),
      (world: TemplateWorld): void => {
        kind.add(world);
      },
    );
    const number: string = kind === INCIDENT ? "INC-1" : "ALT-1";

    expect(notesOf(run, kind)).toEqual([
      {
        record: number,
        note: `${ONEUPTIME_SYNCED_FROM_ZABBIX_MARKER}: Ada Lovelace (ada) updated Zabbix ${PROBLEM_LINK}: acknowledged and commented.\n\nLooking into it: the checkout pods are being restarted.`,
      },
    ]);
    expect(changesOf(run, kind)).toEqual([
      {
        record: number,
        state: "Acknowledged",
        rootCause: `${ONEUPTIME_SYNCED_FROM_ZABBIX_MARKER}: Ada Lovelace (ada) acknowledged ${PROBLEM_LINK}.`,
      },
    ]);
    expect(run.trace.portReasons[kind.step]).toBe(
      `Added the note to ${number}. Moved ${number} to Acknowledged.`,
    );
  });

  test.each([
    "commented",
    "changed severity from Average to High",
    "unacknowledged",
    "closed",
    "suppressed",
  ])(
    "an update that %s is a private note, and moves the record nowhere",
    async (action: string) => {
      const run: TemplateRun = await receive(
        zabbixPostedBody({ kind: ZabbixEventKind.Update, updateAction: action }),
        (world: TemplateWorld): void => {
          kind.add(world);
        },
      );

      expect(notesOf(run, kind)).toHaveLength(1);
      expect(changesOf(run, kind)).toEqual([]);
    },
  );

  test("an acknowledgment of a record already acknowledged is noted, and moves nothing", async () => {
    const run: TemplateRun = await receive(
      zabbixPostedBody({ kind: ZabbixEventKind.Update }),
      (world: TemplateWorld): void => {
        kind.add(world, { stateName: "Acknowledged" });
      },
    );

    expect(notesOf(run, kind)).toHaveLength(1);
    expect(changesOf(run, kind)).toEqual([]);
    expect(run.trace.ports[kind.step]).toBe("updated");
  });

  test("an update made through OneUptime's own message is not copied back", async () => {
    const run: TemplateRun = await receive(
      zabbixPostedBody({
        kind: ZabbixEventKind.Update,
        updateMessage: `${ZABBIX_SYNCED_FROM_ONEUPTIME_MARKER}: INC-1 was acknowledged in OneUptime.`,
      }),
      (world: TemplateWorld): void => {
        kind.add(world);
      },
    );

    expect(run.trace.executed).toEqual(["webhook-1", "read-event-1"]);
    expect(run.trace.portReasons["read-event-1"]).toBe(
      `This update to Zabbix problem ${EVENT_ID} came from OneUptime, so it was not copied back.`,
    );
    expect(notesOf(run, kind)).toEqual([]);
  });

  test("an update to a problem no record was opened for is not noted", async () => {
    const run: TemplateRun = await receive(
      zabbixPostedBody({ kind: ZabbixEventKind.Update }),
    );

    expect(notesOf(run, kind)).toEqual([]);
    expect(run.trace.portReasons[kind.step]).toBe(
      `No ${kind.noun} has zabbixEventId ${EVENT_ID}, so there was nothing to acknowledge.`,
    );
  });

  test("the media type the guide gave first still opens and resolves records: its status says which event it is, its severity's name how severe", async () => {
    const opened: TemplateRun = await receive(
      zabbixFirstMediaTypeBody({ severityNumber: 3 }),
    );

    expect(recordsOf(opened, kind)[0]?.["severity"]).toBe(kind.severities[1]);
    expect(opened.outcome.pages).toEqual([]);

    const resolved: TemplateRun = await receive(
      zabbixFirstMediaTypeBody({ kind: ZabbixEventKind.Recovery }),
      (world: TemplateWorld): void => {
        kind.add(world);
      },
    );

    expect(recordsOf(resolved, kind)[0]?.["state"]).toBe("Resolved");
  });

  test.each([
    [
      "a request from something other than the media type",
      { source: "grafana", event_id: "1" },
      "The request did not come from the OneUptime media type in Zabbix, so it was ignored.",
    ],
    [
      "a Zabbix event without its event ID",
      { ...zabbixPostedBody(), event_id: "" },
      "The Zabbix event named no event ID, so it was ignored.",
    ],
    [
      "a Zabbix event that is neither a problem, a recovery nor an update",
      { ...zabbixPostedBody(), event: "maintenance", status: "2" },
      `Zabbix event ${EVENT_ID} is not a problem, a recovery or an update, so it was ignored.`,
    ],
    [
      "a body that is not JSON",
      "event_id=12345&status=1",
      "The request did not come from the OneUptime media type in Zabbix, so it was ignored.",
    ],
  ])(
    "%s is ignored by read-event-1, which says why, and the run succeeds",
    async (_name: string, body: JSONValue, reason: string) => {
      const run: TemplateRun = await receive(body);

      expect(run.trace.executed).toEqual(["webhook-1", "read-event-1"]);
      expect(run.trace.ports["read-event-1"]).toBe("no");
      expect(run.trace.portReasons["read-event-1"]).toBe(reason);
      expect(run.trace.failedSteps).toEqual([]);
      expect(kind.records(run.world)).toHaveLength(0);
    },
  );

  test("a Zabbix URL that is not a site's address links nothing: the problem is named without a link", async () => {
    const run: TemplateRun = await receive(zabbixPostedBody(), undefined, {
      variables: {
        ...VARIABLES,
        zabbixUrl: "https://zabbix.example.com/zabbix.php?action=problem.view",
      },
    });

    expect(String(recordsOf(run, kind)[0]?.["description"]).split("\n")[0]).toBe(
      `${kind.Created} from Zabbix problem ${EVENT_ID}.`,
    );
  });
});

/* ------------------------------- OneUptime -> Zabbix ------------------------------- */

const triggerModel: (kind: Kind, world: TemplateWorld) => JSONObject = (
  kind: Kind,
  world: TemplateWorld,
): JSONObject => {
  return {
    model: BaseModel.toJSON(kind.records(world)[0] as BaseModel, kind.modelType),
  };
};

describe.each(KINDS)("$stateTemplateId", (kind: Kind) => {
  const changed: (
    record: RecordProps,
    setUp?: (fake: FakeZabbix) => void,
    variables?: { [name: string]: string },
  ) => Promise<TemplateRun> = async (
    record: RecordProps,
    setUp?: (fake: FakeZabbix) => void,
    variables?: { [name: string]: string },
  ): Promise<TemplateRun> => {
    return await runNewTemplate({
      templateId: kind.stateTemplateId,
      variables: variables || VARIABLES,
      setUp: (world: TemplateWorld): void => {
        kind.add(world, record);
      },
      trigger: (world: TemplateWorld): JSONObject => {
        return triggerModel(kind, world);
      },
      tool: zabbixTool(
        setUp ||
          ((fake: FakeZabbix): void => {
            fake.add({ manual_close: "1" });
          }),
      ),
    });
  };
  const number: string = kind === INCIDENT ? "INC-1" : "ALT-1";

  test(`an acknowledged ${kind.noun} acknowledges its Zabbix problem, with a message: one event.get, then one event.acknowledge, as Zabbix expects them`, async () => {
    const run: TemplateRun = await changed({ stateName: "Acknowledged" });

    expect(zabbix.calls).toEqual([
      {
        method: "event.get",
        params: {
          eventids: [EVENT_ID],
          output: ["eventid", "r_eventid", "acknowledged"],
          selectRelatedObject: ["triggerid", "manual_close"],
        },
      },
      {
        method: "event.acknowledge",
        params: {
          eventids: [EVENT_ID],
          action: 6,
          message: `${ZABBIX_SYNCED_FROM_ONEUPTIME_MARKER}: ${number} was acknowledged in OneUptime.`,
        },
      },
    ]);
    expect(zabbix.problem().acknowledged).toBe("1");
    expect(run.trace.ports["update-problem-1"]).toBe("updated");
    expect(run.trace.portReasons["update-problem-1"]).toBe(
      `Acknowledged Zabbix problem ${EVENT_ID}.`,
    );
  });

  test(`a resolved ${kind.noun} closes its Zabbix problem where the trigger allows closing it by hand`, async () => {
    await changed({ stateName: "Resolved" });

    expect(zabbix.calls[1]?.params["action"]).toBe(7);
    expect(zabbix.problem().r_eventid).not.toBe("0");
    expect(zabbix.problem().messages).toEqual([
      `${ZABBIX_SYNCED_FROM_ONEUPTIME_MARKER}: ${number} was resolved in OneUptime.`,
    ]);
  });

  test(`a resolved ${kind.noun} acknowledges a problem Zabbix does not allow closing by hand, and says why it stays open, rather than be refused`, async () => {
    const run: TemplateRun = await changed(
      { stateName: "Resolved" },
      (fake: FakeZabbix): void => {
        fake.add({ manual_close: "0" });
      },
    );

    expect(zabbix.calls[1]?.params["action"]).toBe(6);
    expect(zabbix.problem().messages).toEqual([
      `${ZABBIX_SYNCED_FROM_ONEUPTIME_MARKER}: ${number} was resolved in OneUptime. ${ZABBIX_CANNOT_CLOSE_SENTENCE}`,
    ]);
    expect(zabbix.problem().r_eventid).toBe("0");
    expect(run.trace.failedSteps).toEqual([]);
  });

  test("a problem Zabbix already acknowledged is left as it is: an acknowledgment that came from Zabbix settles", async () => {
    const run: TemplateRun = await changed(
      { stateName: "Acknowledged" },
      (fake: FakeZabbix): void => {
        fake.add({ manual_close: "1", acknowledged: "1" });
      },
    );

    expect(zabbix.calls.map((call: { method: string }) => call.method)).toEqual([
      "event.get",
    ]);
    expect(run.trace.ports["update-problem-1"]).toBe("unchanged");
  });

  test("a problem Zabbix already resolved is left as it is: a recovery that came from Zabbix settles", async () => {
    await changed({ stateName: "Resolved" }, (fake: FakeZabbix): void => {
      fake.add({ manual_close: "1", r_eventid: "99001" });
    });

    expect(zabbix.calls.map((call: { method: string }) => call.method)).toEqual([
      "event.get",
    ]);
  });

  test.each([
    [`an ${kind.noun} no Zabbix problem opened`, { stateName: "Resolved", eventId: null }],
    [`a private ${kind.noun}`, { stateName: "Resolved", isPrivate: true }],
    [
      "a state that is neither acknowledged nor resolved",
      { stateName: kind === INCIDENT ? "Monitoring" : "Created" },
    ],
  ] as Array<[string, RecordProps]>)(
    "%s sends nothing to Zabbix at all",
    async (_name: string, record: RecordProps) => {
      const run: TemplateRun = await changed(record);

      expect(zabbix.calls).toEqual([]);
      expect(run.trace.executed).toEqual([
        `${kind.noun}-on-update-1`,
        "plan-state-1",
      ]);
      expect(run.trace.ports["plan-state-1"]).toBe("no");
      expect(run.trace.failedSteps).toEqual([]);
    },
  );

  test("a token Zabbix does not take fails the run, with Zabbix's words", async () => {
    const run: TemplateRun = await changed(
      { stateName: "Acknowledged" },
      (fake: FakeZabbix): void => {
        fake.add({ manual_close: "1" });
        fake.token = "another-token";
      },
    );

    expect(run.trace.failedSteps).toEqual(["update-problem-1"]);
    expect(run.trace.portReasons["update-problem-1"]).toContain(
      "Zabbix said:",
    );
  });

  test("a problem the token's user cannot see sends nothing, and says so", async () => {
    const run: TemplateRun = await changed(
      { stateName: "Acknowledged", eventId: OTHER_EVENT_ID },
    );

    expect(zabbix.calls.map((call: { method: string }) => call.method)).toEqual([
      "event.get",
    ]);
    expect(run.trace.portReasons["update-problem-1"]).toBe(
      `Zabbix has no problem with event ID ${OTHER_EVENT_ID}, or the API token's user cannot see it, so Zabbix was not updated.`,
    );
  });

  test("a close Zabbix refuses fails the run, with Zabbix's words", async () => {
    const run: TemplateRun = await changed(
      { stateName: "Resolved" },
      (fake: FakeZabbix): void => {
        fake.add({ manual_close: "1" });
        fake.canClose = false;
      },
    );

    expect(run.trace.failedSteps).toEqual(["update-problem-1"]);
    expect(run.trace.portReasons["update-problem-1"]).toContain(
      "No permissions to referred object or it does not exist!",
    );
  });

  test("a Zabbix under a path is called there: <Zabbix URL>/api_jsonrpc.php", async () => {
    const urls: Array<string> = [];

    await runNewTemplate({
      templateId: kind.stateTemplateId,
      variables: { ...VARIABLES, zabbixUrl: "https://example.com/zabbix/" },
      setUp: (world: TemplateWorld): void => {
        kind.add(world, { stateName: "Acknowledged" });
      },
      trigger: (world: TemplateWorld): JSONObject => {
        return triggerModel(kind, world);
      },
      tool: (): OtherTool => {
        return {
          http: (request: SimulatedRequest): SimulatedReply => {
            urls.push(request.url);
            return { status: 404, body: "Not Found" };
          },
          state: (): JSONValue => {
            return null;
          },
        };
      },
    });

    expect(urls).toEqual(["https://example.com/zabbix/api_jsonrpc.php"]);
    expect(ZABBIX_API_URL).toBe(`${ZABBIX_URL}/api_jsonrpc.php`);
  });
});

describe.each(KINDS)("$noteTemplateId", (kind: Kind) => {
  const noted: (
    note: string,
    record?: RecordProps,
  ) => Promise<TemplateRun> = async (
    note: string,
    record?: RecordProps,
  ): Promise<TemplateRun> => {
    return await runNewTemplate({
      templateId: kind.noteTemplateId,
      variables: VARIABLES,
      setUp: (world: TemplateWorld): void => {
        kind.add(world, record);
      },
      trigger: (world: TemplateWorld): JSONObject => {
        return {
          model: {
            _id: "cccccccc-0000-4000-8000-000000000001",
            note: note,
            [kind.idColumn]: {
              _type: "ObjectID",
              value: (kind.records(world)[0] as BaseModel).id!.toString(),
            },
            createdByUser: { name: { _type: "Name", value: "Jane Doe" } },
          },
        };
      },
      tool: zabbixTool((fake: FakeZabbix): void => {
        fake.add({ manual_close: "1" });
      }),
    });
  };
  const number: string = kind === INCIDENT ? "INC-1" : "ALT-1";

  test("is a message on the record's Zabbix problem, saying whose note it is, and acknowledges nothing", async () => {
    const run: TemplateRun = await noted("Rolled the checkout pods back.");

    expect(zabbix.calls).toEqual([
      {
        method: "event.acknowledge",
        params: {
          eventids: [EVENT_ID],
          action: 4,
          message: `${ZABBIX_SYNCED_FROM_ONEUPTIME_MARKER}: private note on ${number} by Jane Doe.\n\nRolled the checkout pods back.`,
        },
      },
    ]);
    expect(zabbix.problem().acknowledged).toBe("0");
    expect(run.trace.executed).toEqual([
      "note-on-create-1",
      `find-${kind.noun}-1`,
      "build-message-1",
      "update-problem-1",
    ]);
  });

  test.each([
    ["a note that came from Zabbix", `${ONEUPTIME_SYNCED_FROM_ZABBIX_MARKER}: Ada updated it.`, {}],
    ["an empty note", "  ", {}],
    [`a note on an ${kind.noun} no Zabbix problem opened`, "Hi", { eventId: null }],
    [`a note on a private ${kind.noun}`, "Hi", { isPrivate: true }],
  ] as Array<[string, string, RecordProps]>)(
    "%s sends nothing",
    async (_name: string, note: string, record: RecordProps) => {
      const run: TemplateRun = await noted(note, record);

      expect(zabbix.calls).toEqual([]);
      expect(run.trace.ports["build-message-1"]).toBe("no");
      expect(run.trace.failedSteps).toEqual([]);
    },
  );

  test("a note longer than Zabbix keeps is cut to fit, and Zabbix takes it", async () => {
    await noted("x".repeat(5000));

    expect(zabbix.problem().messages[0]?.length).toBe(ZABBIX_MESSAGE_MAX_LENGTH);
  });
});

/* ------------------------------ Both ways at once ------------------------------ */

describe("both ways at once, the templates settle instead of echoing each other", () => {
  test("acknowledged in Zabbix: the incident is acknowledged, and the state template leaves the problem as Zabbix has it", async () => {
    const inbound: TemplateRun = await runNewTemplate({
      templateId: INCIDENT.problemTemplateId,
      variables: VARIABLES,
      setUp: (world: TemplateWorld): void => {
        INCIDENT.add(world);
      },
      trigger: (): JSONObject => {
        return webhookDelivery(zabbixPostedBody({ kind: ZabbixEventKind.Update }));
      },
      picks: PICKS,
    });

    expect(recordsOf(inbound, INCIDENT)[0]?.["state"]).toBe("Acknowledged");

    const outbound: TemplateRun = await runNewTemplate({
      templateId: INCIDENT.stateTemplateId,
      variables: VARIABLES,
      setUp: (world: TemplateWorld): void => {
        INCIDENT.add(world, { stateName: "Acknowledged" });
      },
      trigger: (world: TemplateWorld): JSONObject => {
        return triggerModel(INCIDENT, world);
      },
      tool: zabbixTool((fake: FakeZabbix): void => {
        fake.add({ manual_close: "1", acknowledged: "1" });
      }),
    });

    expect(zabbix.calls.map((call: { method: string }) => call.method)).toEqual([
      "event.get",
    ]);
    expect(outbound.trace.ports["update-problem-1"]).toBe("unchanged");
  });

  test("resolved in OneUptime: the problem is closed, and Zabbix's recovery that follows finds the incident resolved already", async () => {
    await runNewTemplate({
      templateId: INCIDENT.stateTemplateId,
      variables: VARIABLES,
      setUp: (world: TemplateWorld): void => {
        INCIDENT.add(world, { stateName: "Resolved" });
      },
      trigger: (world: TemplateWorld): JSONObject => {
        return triggerModel(INCIDENT, world);
      },
      tool: zabbixTool((fake: FakeZabbix): void => {
        fake.add({ manual_close: "1" });
      }),
    });

    expect(zabbix.problem().r_eventid).not.toBe("0");

    const recovery: TemplateRun = await runNewTemplate({
      templateId: INCIDENT.problemTemplateId,
      variables: VARIABLES,
      setUp: (world: TemplateWorld): void => {
        INCIDENT.add(world, { stateName: "Resolved" });
      },
      trigger: (): JSONObject => {
        return webhookDelivery(
          zabbixPostedBody({ kind: ZabbixEventKind.Recovery }),
        );
      },
      picks: PICKS,
    });

    expect(changesOf(recovery, INCIDENT)).toEqual([]);
    expect(recovery.trace.ports[INCIDENT.step]).toBe("unchanged");
  });

  test("a note posted to Zabbix that comes back as an update is not copied in again", async () => {
    const run: TemplateRun = await runNewTemplate({
      templateId: INCIDENT.problemTemplateId,
      variables: VARIABLES,
      setUp: (world: TemplateWorld): void => {
        INCIDENT.add(world);
      },
      trigger: (): JSONObject => {
        return webhookDelivery(
          zabbixPostedBody({
            kind: ZabbixEventKind.Update,
            updateAction: "commented",
            updateMessage: `${ZABBIX_SYNCED_FROM_ONEUPTIME_MARKER}: private note on INC-1 by Jane Doe.\n\nRolled back.`,
          }),
        );
      },
      picks: PICKS,
    });

    expect(notesOf(run, INCIDENT)).toEqual([]);
  });
});
