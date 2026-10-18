/*
 * The Zabbix templates, run end to end by the template simulator
 * (WorkflowTemplateSimulator): the graph the create wizard builds, its
 * values substituted the way RunWorkflow does, the real Switch / Case,
 * If / Else, Log, API and Page steps and every script in the real sandbox.
 * Zabbix's side is what the guide's media type posts (zabbixPostedBody, which
 * App's IntegrationsDocsFacts holds to the guide's script) and a fake of its
 * JSON-RPC API that keeps Zabbix's rules (FakeZabbix). The database steps
 * answer as the database would, and the paging itself
 * (OnCallPageService.page) is stood in for.
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
 */

import OnCallPageService, {
  OnCallPageAbout,
  OnCallPageRecordType,
  OnCallPageResult,
  OnCallPageTargets,
} from "../../../Server/Services/OnCallPageService";
import WorkflowPrincipal, {
  WorkflowPrincipalOptions,
} from "../../../Server/Utils/Workflow/WorkflowPrincipal";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { PAGE_ARGUMENT_IDS } from "../../../Types/Workflow/Components/OnCallPageSettings";
import {
  ONEUPTIME_SYNCED_FROM_ZABBIX_MARKER,
  ZABBIX_EVENT_ID_CUSTOM_FIELD,
  ZABBIX_MESSAGE_MAX_LENGTH,
  ZABBIX_SYNCED_FROM_ONEUPTIME_MARKER,
  ZabbixEventKind,
} from "../../../Types/Workflow/Templates";
import {
  ALERT,
  EVENT_ID,
  FakeZabbix,
  INCIDENT,
  KINDS,
  OTHER_EVENT_ID,
  PROBLEM_LINK,
  TRIGGER_ID,
  ZABBIX_API_TOKEN,
  ZABBIX_API_URL,
  ZABBIX_URL,
  ZabbixEventProps,
  ZabbixKindFixture,
  noteModel,
  recordModel,
  severityIdNamed,
  stateNamed,
  webhookDelivery,
  zabbixFirstMediaTypeBody,
  zabbixPostedBody,
} from "./ZabbixTemplateFixtures";
import {
  DATABASE_FAILURE,
  DatabaseCall,
  DatabaseReply,
  FakeDatabase,
  SimulatedReply,
  SimulatedRequest,
  SimulationTrace,
  createdWithId,
  found,
  many,
  runTemplate,
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

const NOTE_ID: string = "cccccccc-0000-4000-8000-000000000009";
const TIMELINE_ID: string = "cccccccc-0000-4000-8000-000000000010";
const POLICY_ID: string = "7b1c2d3e-0000-4000-8000-000000000001";

const VARIABLES: { [name: string]: string } = {
  zabbixUrl: ZABBIX_URL,
  zabbixApiToken: ZABBIX_API_TOKEN,
};

// As the builder stores a policy picked by name.
const PICKED: { [componentId: string]: JSONObject } = {
  "page-on-call-policy-1": { [PAGE_ARGUMENT_IDS.onCallPolicies]: [POLICY_ID] },
};

interface PageRequest {
  projectId: ObjectID;
  targets: OnCallPageTargets;
  about: OnCallPageAbout;
  props: DatabaseCommonInteractionProps;
}

let pagesAsked: Array<PageRequest> = [];
let pagingFails: boolean = false;

function paged(summary: string): OnCallPageResult {
  return {
    record: {
      type: OnCallPageRecordType.Incident,
      id: new ObjectID(INCIDENT.recordId),
      label: INCIDENT.number,
      title: "Zabbix: High CPU utilization on web-1",
      url: "https://oneuptime.example.com/dashboard/incidents/42",
      isNew: false,
    },
    paged: [],
    startedPolicies: [
      { onCallDutyPolicyId: new ObjectID(POLICY_ID), name: "Ops" },
    ],
    notPaged: [],
    isAnyonePaged: true,
    directPageExecutionLogId: null,
    summary: summary,
  } as unknown as OnCallPageResult;
}

beforeEach(() => {
  pagesAsked = [];
  pagingFails = false;

  // The API steps resolve Zabbix's host before every request; it is a public one.
  stubDnsLookups("93.184.216.34");

  jest.spyOn(OnCallPageService, "page").mockImplementation((async (
    request: PageRequest,
  ) => {
    pagesAsked.push(request);

    if (pagingFails) {
      throw new BadDataException(
        "The on-call policy Ops has no escalation rules.",
      );
    }

    return paged("Paged Ops about INC-42.");
  }) as never);

  // The step's caller, without the read of the project's plan.
  jest.spyOn(WorkflowPrincipal, "getProps").mockImplementation((async (
    data: WorkflowPrincipalOptions,
  ) => {
    return WorkflowPrincipal.getPropsWithoutPlan(data);
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function callsTo(
  trace: SimulationTrace,
  componentId: string,
): Array<DatabaseCall> {
  return trace.databaseCalls.filter((call: DatabaseCall): boolean => {
    return call.componentId === componentId;
  });
}

function onlyCall(trace: SimulationTrace, componentId: string): JSONObject {
  const calls: Array<DatabaseCall> = callsTo(trace, componentId);

  expect(calls).toHaveLength(1);

  return calls[0]!.args["json"] as JSONObject;
}

/* ------------------------------- Zabbix -> OneUptime ------------------------------- */

/*
 * The database as one event sees it: the project's severities and states,
 * no record yet for a new problem (find-*-0), the problem's record for its
 * recovery and updates.
 */
function inboundDatabase(
  kind: ZabbixKindFixture,
  overrides: FakeDatabase = {},
  recordState: string = "Created",
): FakeDatabase {
  return {
    [`${kind.noun}-severity-find-many`]: many(kind.severities),
    [`${kind.noun}-find-one`]: (call: DatabaseCall): DatabaseReply => {
      return call.componentId === `find-${kind.noun}-0`
        ? found(null)
        : found(recordModel(kind, { state: recordState }));
    },
    [`${kind.noun}-create-one`]: createdWithId(kind.recordId),
    [`${kind.noun}-internal-note-create-one`]: createdWithId(NOTE_ID),
    [`${kind.noun}-state-find-many`]: many(kind.states),
    [`${kind.noun}-state-timeline-create-one`]: createdWithId(TIMELINE_ID),
    ...overrides,
  };
}

async function receive(data: {
  kind: ZabbixKindFixture;
  body: JSONObject | string;
  database?: FakeDatabase | undefined;
  recordState?: string | undefined;
  variables?: { [name: string]: string } | undefined;
  settings?: { [componentId: string]: JSONObject } | undefined;
  editCode?: { [componentId: string]: (code: string) => string } | undefined;
}): Promise<SimulationTrace> {
  return await runTemplate({
    templateId: data.kind.problemTemplateId,
    trigger: webhookDelivery(data.body),
    variables: data.variables || VARIABLES,
    settings: (data.settings || PICKED) as never,
    database:
      data.database || inboundDatabase(data.kind, {}, data.recordState),
    editCode: data.editCode as never,
  });
}

function problem(props: ZabbixEventProps = {}): JSONObject {
  return zabbixPostedBody({ kind: ZabbixEventKind.Problem, ...props });
}

function recovery(props: ZabbixEventProps = {}): JSONObject {
  return zabbixPostedBody({ kind: ZabbixEventKind.Recovery, ...props });
}

function update(props: ZabbixEventProps = {}): JSONObject {
  return zabbixPostedBody({ kind: ZabbixEventKind.Update, ...props });
}

describe.each(KINDS)(
  "a Zabbix problem, into an $noun",
  (kind: ZabbixKindFixture) => {
    const r: string = kind.noun;

    test(`a new problem is ${kind.created} as one ${r}: titled after the problem and its host, at the mapped severity, holding the problem's event ID`, async () => {
      const trace: SimulationTrace = await receive({
        kind: kind,
        body: problem(),
      });

      const record: JSONObject = onlyCall(trace, `create-${r}-1`);

      expect(record).toEqual({
        [kind.severityIdColumn]: kind.severities.find(
          (severity: JSONObject): boolean => {
            return severity["order"] === 1;
          },
        )!["_id"],
        customFields: { [ZABBIX_EVENT_ID_CUSTOM_FIELD]: EVENT_ID },
        ...kind.quietFields,
        title: "Zabbix: High CPU utilization on web-1",
        description: [
          `${kind.Created} from Zabbix ${PROBLEM_LINK}.`,
          "",
          "- Host: web-1",
          "- Severity in Zabbix: High",
          "- Started: 2026.10.18 10:15:00",
          "- Operational data: CPU utilization: 95.2 %",
          "- Tags: service: checkout, team: ops",
        ].join("\n"),
      });
    });

    test("the run takes the problem's path, and asks the database for the problem's record by its event ID first", async () => {
      const trace: SimulationTrace = await receive({
        kind: kind,
        body: problem(),
      });

      expect(trace.ports["switch-1"]).toBe("case-1");
      expect(callsTo(trace, `find-${r}-0`)[0]!.args["query"]).toEqual({
        customFields: { [ZABBIX_EVENT_ID_CUSTOM_FIELD]: EVENT_ID },
      });
      // Nothing of the other paths runs.
      expect(
        trace.executed.filter((componentId: string): boolean => {
          return (
            componentId.endsWith("-1") &&
            [`find-${r}-1`, "find-states-1", "decide-state-1"].includes(
              componentId,
            )
          );
        }),
      ).toEqual([]);
    });

    test.each([
      [5, "Disaster"],
      [4, "High"],
    ])(
      "a problem of Zabbix severity %s (%s) pages the policy picked, about the new record",
      async (severityNumber: number) => {
        const trace: SimulationTrace = await receive({
          kind: kind,
          body: problem({ severityNumber }),
        });

        expect(trace.executed).toEqual([
          "webhook-1",
          "find-severities-1",
          "read-event-1",
          "switch-1",
          `find-${r}-0`,
          "if-found-0",
          `create-${r}-1`,
          "if-page-1",
          "page-on-call-policy-1",
          "log-paged",
        ]);
        expect(pagesAsked).toHaveLength(1);
        expect(
          (pagesAsked[0]!.targets.onCallDutyPolicyIds || []).map(
            (id: ObjectID): string => {
              return id.toString();
            },
          ),
        ).toEqual([POLICY_ID]);

        const about: OnCallPageAbout = pagesAsked[0]!.about;

        if (r === "incident") {
          expect(about.incidentId?.toString()).toBe(kind.recordId);
        } else {
          expect(about.alertId?.toString()).toBe(kind.recordId);
        }

        expect(trace.logs).toEqual([
          `📟 ${kind.Created} an ${r} at ${r === "incident" ? "Critical Incident" : "High"} for Zabbix problem ${EVENT_ID}. Paged Ops about INC-42.`,
        ]);
      },
    );

    test.each([
      [3, "Average"],
      [2, "Warning"],
      [1, "Information"],
      [0, "Not classified"],
    ])(
      "a problem of Zabbix severity %s (%s) pages nobody, and the log says why",
      async (severityNumber: number, severityName: string) => {
        const trace: SimulationTrace = await receive({
          kind: kind,
          body: problem({ severityNumber }),
        });

        expect(callsTo(trace, `create-${r}-1`)).toHaveLength(1);
        expect(pagesAsked).toHaveLength(0);
        expect(trace.ports["if-page-1"]).toBe("no");
        expect(trace.logs).toHaveLength(1);
        expect(trace.logs[0]).toMatch(
          new RegExp(
            `^ℹ️ ${kind.Created} an ${r} at .+ for Zabbix problem ${EVENT_ID}\\. It is ${severityName} in Zabbix, so nobody was paged\\.$`,
          ),
        );
      },
    );

    test("the same event ID again opens no other record, and pages nobody again", async () => {
      const trace: SimulationTrace = await receive({
        kind: kind,
        body: problem(),
        database: inboundDatabase(kind, {
          [`${r}-find-one`]: found(recordModel(kind)),
        }),
      });

      expect(trace.executed).toEqual([
        "webhook-1",
        "find-severities-1",
        "read-event-1",
        "switch-1",
        `find-${r}-0`,
        "if-found-0",
        "log-already-open",
      ]);
      expect(callsTo(trace, `create-${r}-1`)).toHaveLength(0);
      expect(pagesAsked).toHaveLength(0);
      expect(trace.logs).toEqual([
        `ℹ️ Zabbix problem ${EVENT_ID} has an ${r} already, ${kind.number}, so no other was ${kind.created}.`,
      ]);
    });

    test("a lookup that fails still opens the record, and pages: two records beat none", async () => {
      const trace: SimulationTrace = await receive({
        kind: kind,
        body: problem(),
        database: inboundDatabase(kind, {
          [`${r}-find-one`]: DATABASE_FAILURE,
        }),
      });

      expect(trace.ports[`find-${r}-0`]).toBe("error");
      expect(callsTo(trace, `create-${r}-1`)).toHaveLength(1);
      expect(pagesAsked).toHaveLength(1);
      expect(trace.logs[0]).toBe(
        `⚠️ Could not check whether Zabbix problem ${EVENT_ID} has an ${r} already, so a new one is ${kind.created}. Why the check failed is in the run log above.`,
      );
    });

    test("a record that cannot be written is said in the log, and nobody is paged", async () => {
      const trace: SimulationTrace = await receive({
        kind: kind,
        body: problem(),
        database: inboundDatabase(kind, {
          [`${r}-create-one`]: DATABASE_FAILURE,
        }),
      });

      expect(pagesAsked).toHaveLength(0);
      expect(trace.logs).toEqual([
        `❌ Could not ${r === "incident" ? "declare" : "create"} an ${r} for Zabbix problem ${EVENT_ID}. Why is in the run log above.`,
      ]);
    });

    test("a page that reaches nobody is said in the log, with why", async () => {
      pagingFails = true;

      const trace: SimulationTrace = await receive({
        kind: kind,
        body: problem(),
      });

      expect(trace.ports["page-on-call-policy-1"]).toBe("error");
      expect(trace.logs[0]).toMatch(
        new RegExp(
          `^❌ ${kind.Created} an ${r} for Zabbix problem ${EVENT_ID}, but nobody was paged: `,
        ),
      );
      expect(trace.logs[0]).toContain("has no escalation rules");
    });

    test("a project whose severities cannot be read reads nothing Zabbix sent, and says so", async () => {
      const trace: SimulationTrace = await receive({
        kind: kind,
        body: problem(),
        database: inboundDatabase(kind, {
          [`${r}-severity-find-many`]: DATABASE_FAILURE,
        }),
      });

      expect(trace.executed).toEqual([
        "webhook-1",
        "find-severities-1",
        "log-severities-failed",
      ]);
      expect(trace.logs).toEqual([
        `❌ Could not read this project's ${r} severities, so nothing Zabbix sent was read. Why is in the run log above.`,
      ]);
    });

    test("a project with no severities opens nothing, and the log says why", async () => {
      const trace: SimulationTrace = await receive({
        kind: kind,
        body: problem(),
        database: inboundDatabase(kind, {
          [`${r}-severity-find-many`]: many([]),
        }),
      });

      expect(trace.ports["read-event-1"]).toBe("error");
      expect(callsTo(trace, `create-${r}-1`)).toHaveLength(0);
      expect(trace.logs).toEqual([
        `❌ Could not read what Zabbix sent: This project has no ${r} severities to ${r === "incident" ? "declare" : "create"} the ${r} at.`,
      ]);
    });

    test("the problem's recovery resolves the record it opened, saying why on its timeline", async () => {
      const trace: SimulationTrace = await receive({
        kind: kind,
        body: recovery(),
      });

      expect(trace.ports["switch-1"]).toBe("case-2");
      expect(trace.executed).toEqual([
        "webhook-1",
        "find-severities-1",
        "read-event-1",
        "switch-1",
        `find-${r}-1`,
        "if-found-1",
        "find-states-1",
        "decide-state-1",
        "if-change-1",
        "change-state-1",
        "log-resolved",
      ]);
      expect(callsTo(trace, `find-${r}-1`)[0]!.args["query"]).toEqual({
        customFields: { [ZABBIX_EVENT_ID_CUSTOM_FIELD]: EVENT_ID },
      });
      expect(onlyCall(trace, "change-state-1")).toEqual({
        [kind.idColumn]: kind.recordId,
        [kind.timelineStateColumn]: stateNamed(kind, "Resolved")._id,
        rootCause: `${ONEUPTIME_SYNCED_FROM_ZABBIX_MARKER}: ${PROBLEM_LINK} recovered.`,
      });
      expect(trace.logs).toEqual([
        `✅ Resolved ${kind.number}: Zabbix problem ${EVENT_ID} recovered.`,
      ]);
      // A recovery opens nothing and pages nobody.
      expect(callsTo(trace, `create-${r}-1`)).toHaveLength(0);
      expect(pagesAsked).toHaveLength(0);
    });

    test("an acknowledged record is resolved by the recovery too: it moves forward past Acknowledged", async () => {
      const trace: SimulationTrace = await receive({
        kind: kind,
        body: recovery(),
        recordState: "Acknowledged",
      });

      expect(
        onlyCall(trace, "change-state-1")[kind.timelineStateColumn],
      ).toBe(stateNamed(kind, "Resolved")._id);
    });

    test("a record that is already resolved is left as it is: it never moves back", async () => {
      const trace: SimulationTrace = await receive({
        kind: kind,
        body: recovery(),
        recordState: "Resolved",
      });

      expect(trace.ports["if-change-1"]).toBe("no");
      expect(callsTo(trace, "change-state-1")).toHaveLength(0);
      expect(trace.logs).toEqual([
        `ℹ️ ${kind.number} is already Resolved, so it was left as it is.`,
      ]);
    });

    test("the recovery of a problem no record was opened for changes nothing", async () => {
      const trace: SimulationTrace = await receive({
        kind: kind,
        body: recovery({ eventId: OTHER_EVENT_ID }),
        database: inboundDatabase(kind, {
          [`${r}-find-one`]: found(null),
        }),
      });

      expect(callsTo(trace, `find-${r}-1`)[0]!.args["query"]).toEqual({
        customFields: { [ZABBIX_EVENT_ID_CUSTOM_FIELD]: OTHER_EVENT_ID },
      });
      expect(trace.databaseCalls.map((call: DatabaseCall) => {
        return call.componentId;
      })).toEqual(["find-severities-1", `find-${r}-1`]);
      expect(trace.logs).toEqual([
        `ℹ️ Zabbix problem ${OTHER_EVENT_ID} has no ${r}, so its recovery changed nothing.`,
      ]);
    });

    test("a recovery whose record cannot be looked for, or whose states cannot be read, or written, says so", async () => {
      const lookup: SimulationTrace = await receive({
        kind: kind,
        body: recovery(),
        database: inboundDatabase(kind, {
          [`${r}-find-one`]: DATABASE_FAILURE,
        }),
      });

      expect(lookup.logs).toEqual([
        `❌ Could not look for the ${r} of Zabbix problem ${EVENT_ID}, so it was not resolved. Why is in the run log above.`,
      ]);

      const states: SimulationTrace = await receive({
        kind: kind,
        body: recovery(),
        database: inboundDatabase(kind, {
          [`${r}-state-find-many`]: DATABASE_FAILURE,
        }),
      });

      expect(states.logs).toEqual([
        `❌ Could not read this project's ${r} states, so ${kind.number} was not resolved. Why is in the run log above.`,
      ]);

      const written: SimulationTrace = await receive({
        kind: kind,
        body: recovery(),
        database: inboundDatabase(kind, {
          [`${r}-state-timeline-create-one`]: DATABASE_FAILURE,
        }),
      });

      expect(written.logs).toEqual([
        `❌ Could not resolve ${kind.number} for Zabbix problem ${EVENT_ID}. Why is in the run log above.`,
      ]);
    });

    test("a project with no resolved state resolves nothing, and says why", async () => {
      const trace: SimulationTrace = await receive({
        kind: kind,
        body: recovery(),
        database: inboundDatabase(kind, {
          [`${r}-state-find-many`]: many(
            kind.states.filter((state: { isResolvedState: boolean }) => {
              return !state.isResolvedState;
            }) as unknown as Array<JSONObject>,
          ),
        }),
      });

      expect(trace.ports["decide-state-1"]).toBe("error");
      expect(trace.logs[0]).toContain(
        `❌ Could not tell whether ${kind.number} is resolved, so it was not resolved:`,
      );
      expect(trace.logs[0]).toContain(
        `This project has no resolved ${r} state.`,
      );
    });

    test("an update acknowledging the problem adds what was done to the record as a private note, and acknowledges it", async () => {
      const trace: SimulationTrace = await receive({
        kind: kind,
        body: update(),
      });

      expect(trace.ports["switch-1"]).toBe("case-3");
      expect(trace.executed).toEqual([
        "webhook-1",
        "find-severities-1",
        "read-event-1",
        "switch-1",
        `find-${r}-2`,
        "if-found-2",
        "add-note-2",
        "if-acknowledged-2",
        "find-states-2",
        "decide-state-2",
        "if-change-2",
        "change-state-2",
        "log-acknowledged",
      ]);
      expect(onlyCall(trace, "add-note-2")).toEqual({
        [kind.idColumn]: kind.recordId,
        note: `${ONEUPTIME_SYNCED_FROM_ZABBIX_MARKER}: Ada Lovelace (ada) updated Zabbix ${PROBLEM_LINK}: acknowledged and commented.\n\nLooking into it: the checkout pods are being restarted.`,
      });
      expect(onlyCall(trace, "change-state-2")).toEqual({
        [kind.idColumn]: kind.recordId,
        [kind.timelineStateColumn]: stateNamed(kind, "Acknowledged")._id,
        rootCause: `${ONEUPTIME_SYNCED_FROM_ZABBIX_MARKER}: Ada Lovelace (ada) acknowledged ${PROBLEM_LINK}.`,
      });
      expect(trace.logs).toEqual([
        `✅ Acknowledged ${kind.number}, and added the update to Zabbix problem ${EVENT_ID} to it as a private note: the problem was acknowledged in Zabbix.`,
      ]);
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
        const trace: SimulationTrace = await receive({
          kind: kind,
          body: update({ updateAction: action, updateMessage: "" }),
        });

        expect(onlyCall(trace, "add-note-2")["note"]).toBe(
          `${ONEUPTIME_SYNCED_FROM_ZABBIX_MARKER}: Ada Lovelace (ada) updated Zabbix ${PROBLEM_LINK}: ${action}.`,
        );
        expect(trace.ports["if-acknowledged-2"]).toBe("no");
        expect(callsTo(trace, "find-states-2")).toHaveLength(0);
        expect(callsTo(trace, "change-state-2")).toHaveLength(0);
        expect(trace.logs).toEqual([
          `✅ Added the update to Zabbix problem ${EVENT_ID} to ${kind.number} as a private note.`,
        ]);
      },
    );

    test("an acknowledgment of a record already acknowledged or resolved is noted, and moves nothing back", async () => {
      for (const state of ["Acknowledged", "Resolved"]) {
        const trace: SimulationTrace = await receive({
          kind: kind,
          body: update(),
          recordState: state,
        });

        expect(callsTo(trace, "add-note-2")).toHaveLength(1);
        expect(callsTo(trace, "change-state-2")).toHaveLength(0);
        expect(trace.logs).toEqual([
          `ℹ️ Added the update to Zabbix problem ${EVENT_ID} to ${kind.number} as a private note. ${kind.number} is already ${state}, so it was left as it is.`,
        ]);
      }
    });

    test("an update made through OneUptime's own message is not copied back", async () => {
      const trace: SimulationTrace = await receive({
        kind: kind,
        body: update({
          updateAction: "commented",
          updateMessage: `${ZABBIX_SYNCED_FROM_ONEUPTIME_MARKER}: private note on INC-42 by Jane Doe.\n\nRolled back.`,
        }),
      });

      expect(trace.ports["switch-1"]).toBe("default");
      expect(trace.databaseCalls.map((call: DatabaseCall) => {
        return call.componentId;
      })).toEqual(["find-severities-1"]);
      expect(trace.logs).toEqual([
        `ℹ️ This update to Zabbix problem ${EVENT_ID} came from OneUptime, so it was not copied back.`,
      ]);
    });

    test("an update to a problem no record was opened for is not noted", async () => {
      const trace: SimulationTrace = await receive({
        kind: kind,
        body: update(),
        database: inboundDatabase(kind, {
          [`${r}-find-one`]: found(null),
        }),
      });

      expect(callsTo(trace, "add-note-2")).toHaveLength(0);
      expect(trace.logs).toEqual([
        `ℹ️ Zabbix problem ${EVENT_ID} has no ${r}, so the update was not noted.`,
      ]);
    });

    test("a note that cannot be written is said in the log, and acknowledges nothing", async () => {
      const trace: SimulationTrace = await receive({
        kind: kind,
        body: update(),
        database: inboundDatabase(kind, {
          [`${r}-internal-note-create-one`]: DATABASE_FAILURE,
        }),
      });

      expect(callsTo(trace, "change-state-2")).toHaveLength(0);
      expect(trace.logs).toEqual([
        `❌ Could not add the update to Zabbix problem ${EVENT_ID} to ${kind.number}. Why is in the run log above.`,
      ]);
    });

    test("the media type the guide gave first still opens and resolves records: its status says which event it is, its severity's name how severe", async () => {
      const opened: SimulationTrace = await receive({
        kind: kind,
        body: zabbixFirstMediaTypeBody({ severityNumber: 5 }),
      });
      const record: JSONObject = onlyCall(opened, `create-${r}-1`);

      expect(record[kind.severityIdColumn]).toBe(
        kind.severities.find((severity: JSONObject): boolean => {
          return severity["order"] === 1;
        })!["_id"],
      );
      // It named no trigger, so the problem is named without a link.
      expect(String(record["description"])).toContain(
        `${kind.Created} from Zabbix problem ${EVENT_ID}.`,
      );
      expect(pagesAsked).toHaveLength(1);

      const resolved: SimulationTrace = await receive({
        kind: kind,
        body: zabbixFirstMediaTypeBody({ kind: ZabbixEventKind.Recovery }),
      });

      expect(callsTo(resolved, "change-state-1")).toHaveLength(1);
    });

    test.each([
      ["a request from something other than the media type", { event_id: EVENT_ID, status: "1", name: "x" }],
      ["a Zabbix event without its event ID", { source: "zabbix", status: "1" }],
      ["a Zabbix event that is neither a problem, a recovery nor an update", { source: "zabbix", event_id: EVENT_ID, status: "7" }],
      ["a body that is not JSON", "status=1&event_id=12345"],
    ])(
      "%s is ignored, and the log says why",
      async (_name: string, body: JSONObject | string) => {
        const trace: SimulationTrace = await receive({
          kind: kind,
          body: body,
        });

        expect(trace.ports["switch-1"]).toBe("default");
        expect(trace.executed).toEqual([
          "webhook-1",
          "find-severities-1",
          "read-event-1",
          "switch-1",
          "log-ignored",
        ]);
        expect(trace.logs).toHaveLength(1);
        expect(trace.logs[0]).toMatch(/^ℹ️ .+ignored\.$/);
      },
    );

    test("a Zabbix URL that is not a site's address links nothing: the problem is named without a link", async () => {
      const trace: SimulationTrace = await receive({
        kind: kind,
        body: problem(),
        variables: {
          ...VARIABLES,
          zabbixUrl: "https://evil.example/zabbix.php?action=problem.view",
        },
      });

      const description: string = String(
        onlyCall(trace, `create-${r}-1`)["description"],
      );

      expect(description.split("\n")[0]).toBe(
        `${kind.Created} from Zabbix problem ${EVENT_ID}.`,
      );
      expect(description).not.toContain("](");
    });
  },
);

/* ------------------------------- OneUptime -> Zabbix ------------------------------- */

function http(zabbix: FakeZabbix): (request: SimulatedRequest) => SimulatedReply {
  return (request: SimulatedRequest): SimulatedReply => {
    return zabbix.answer(request);
  };
}

async function sync(data: {
  kind: ZabbixKindFixture;
  state: string;
  zabbix: FakeZabbix;
  eventId?: string | null | undefined;
  isPrivate?: boolean | undefined;
  variables?: { [name: string]: string } | undefined;
  http?: ((request: SimulatedRequest) => SimulatedReply) | undefined;
}): Promise<SimulationTrace> {
  return await runTemplate({
    templateId: data.kind.stateTemplateId,
    trigger: {
      model: recordModel(data.kind, {
        state: data.state,
        eventId: data.eventId,
        isPrivate: data.isPrivate,
      }),
    },
    variables: data.variables || VARIABLES,
    http: data.http || http(data.zabbix),
  });
}

describe.each(KINDS)(
  "the $noun's state, into Zabbix",
  (kind: ZabbixKindFixture) => {
    const r: string = kind.noun;

    test(`an acknowledged ${r} acknowledges its Zabbix problem, with a message: one event.get, then one event.acknowledge, as Zabbix expects them`, async () => {
      const zabbix: FakeZabbix = new FakeZabbix([{}]);
      const trace: SimulationTrace = await sync({
        kind: kind,
        state: "Acknowledged",
        zabbix: zabbix,
      });

      expect(trace.requests).toHaveLength(2);

      for (const request of trace.requests) {
        expect(request.method).toBe("POST");
        expect(request.url).toBe(ZABBIX_API_URL);
        expect(request.headers["Authorization"]).toBe(
          `Bearer ${ZABBIX_API_TOKEN}`,
        );
        // The token goes in the header only: Zabbix 7.2 and later refuse "auth" in the body.
        expect(Object.keys(request.body as JSONObject).sort()).toEqual([
          "id",
          "jsonrpc",
          "method",
          "params",
        ]);
        expect((request.body as JSONObject)["jsonrpc"]).toBe("2.0");
      }

      expect(trace.requests[0]!.body).toEqual({
        jsonrpc: "2.0",
        method: "event.get",
        params: {
          eventids: [EVENT_ID],
          output: ["eventid", "r_eventid", "acknowledged"],
          selectRelatedObject: ["triggerid", "manual_close"],
        },
        id: 1,
      });
      expect(trace.requests[1]!.body).toEqual({
        jsonrpc: "2.0",
        method: "event.acknowledge",
        params: {
          eventids: [EVENT_ID],
          // Acknowledge (2) and add a message (4).
          action: "6",
          message: `${ZABBIX_SYNCED_FROM_ONEUPTIME_MARKER}: ${kind.number} was acknowledged in OneUptime.`,
        },
        id: 1,
      });
      expect(zabbix.problem().acknowledged).toBe("1");
      expect(zabbix.problem().r_eventid).toBe("0");
      expect(trace.logs).toEqual([
        `✅ Acknowledged Zabbix problem ${EVENT_ID}: ${kind.number} was acknowledged.`,
      ]);
    });

    test(`a resolved ${r} closes its Zabbix problem where the trigger allows closing it by hand`, async () => {
      const zabbix: FakeZabbix = new FakeZabbix([{ manual_close: "1" }]);
      const trace: SimulationTrace = await sync({
        kind: kind,
        state: "Resolved",
        zabbix: zabbix,
      });

      expect(
        ((trace.requests[1]!.body as JSONObject)["params"] as JSONObject)[
          "action"
        ],
      ).toBe("7");
      expect(zabbix.problem().r_eventid).not.toBe("0");
      expect(zabbix.problem().acknowledged).toBe("1");
      expect(zabbix.problem().messages).toEqual([
        `${ZABBIX_SYNCED_FROM_ONEUPTIME_MARKER}: ${kind.number} was resolved in OneUptime.`,
      ]);
      expect(trace.logs).toEqual([
        `✅ Closed Zabbix problem ${EVENT_ID}: ${kind.number} was resolved.`,
      ]);
    });

    test(`a resolved ${r} acknowledges a problem Zabbix does not allow closing by hand, and says why it stays open, rather than be refused`, async () => {
      const zabbix: FakeZabbix = new FakeZabbix([{ manual_close: "0" }]);
      const trace: SimulationTrace = await sync({
        kind: kind,
        state: "Resolved",
        zabbix: zabbix,
      });

      expect(
        ((trace.requests[1]!.body as JSONObject)["params"] as JSONObject)[
          "action"
        ],
      ).toBe("6");
      expect(zabbix.problem().r_eventid).toBe("0");
      expect(zabbix.problem().acknowledged).toBe("1");
      expect(zabbix.problem().messages[0]).toBe(
        `${ZABBIX_SYNCED_FROM_ONEUPTIME_MARKER}: ${kind.number} was resolved in OneUptime. Its trigger does not allow closing problems by hand, so the problem stays open until Zabbix sees it recover.`,
      );
      expect(trace.logs[0]).toBe(
        `✅ Acknowledged Zabbix problem ${EVENT_ID}: ${kind.number} was resolved, and its trigger does not allow closing problems by hand.`,
      );
    });

    test("a problem Zabbix already acknowledged is left as it is: an acknowledgment that came from Zabbix settles", async () => {
      const zabbix: FakeZabbix = new FakeZabbix([{ acknowledged: "1" }]);
      const trace: SimulationTrace = await sync({
        kind: kind,
        state: "Acknowledged",
        zabbix: zabbix,
      });

      expect(
        zabbix.calls.map((call: { method: string }): string => {
          return call.method;
        }),
      ).toEqual(["event.get"]);
      expect(zabbix.problem().messages).toEqual([]);
      expect(trace.logs).toEqual([
        `ℹ️ Zabbix problem ${EVENT_ID} is already acknowledged in Zabbix, so it was left as it is.`,
      ]);
    });

    test("a problem Zabbix already resolved is left as it is: a recovery that came from Zabbix settles", async () => {
      for (const state of ["Acknowledged", "Resolved"]) {
        const zabbix: FakeZabbix = new FakeZabbix([
          { r_eventid: "99001", manual_close: "1" },
        ]);
        const trace: SimulationTrace = await sync({
          kind: kind,
          state: state,
          zabbix: zabbix,
        });

        expect(zabbix.calls).toHaveLength(1);
        expect(trace.logs).toEqual([
          `ℹ️ Zabbix problem ${EVENT_ID} is already resolved in Zabbix, so it was left as it is.`,
        ]);
      }
    });

    test(`an ${r} no Zabbix problem opened sends nothing to Zabbix at all`, async () => {
      const zabbix: FakeZabbix = new FakeZabbix([{}]);
      const trace: SimulationTrace = await sync({
        kind: kind,
        state: "Acknowledged",
        zabbix: zabbix,
        eventId: null,
      });

      expect(trace.requests).toHaveLength(0);
      expect(trace.logs).toEqual([
        `ℹ️ ${kind.number} was not ${kind.created} for a Zabbix problem, so there is nothing to update in Zabbix.`,
      ]);
    });

    test(`a private ${r} stays in OneUptime`, async () => {
      const zabbix: FakeZabbix = new FakeZabbix([{}]);
      const trace: SimulationTrace = await sync({
        kind: kind,
        state: "Acknowledged",
        zabbix: zabbix,
        isPrivate: true,
      });

      expect(trace.requests).toHaveLength(0);
      expect(trace.logs).toEqual([
        `ℹ️ ${kind.number} is a private ${r}, so Zabbix was not updated.`,
      ]);
    });

    test("a state that is neither acknowledged nor resolved means nothing in Zabbix", async () => {
      const zabbix: FakeZabbix = new FakeZabbix([{}]);
      const trace: SimulationTrace = await sync({
        kind: kind,
        state: "Created",
        zabbix: zabbix,
      });

      expect(trace.requests).toHaveLength(0);
      expect(trace.logs).toEqual([
        `ℹ️ ${kind.number} moved to Created, which means nothing in Zabbix.`,
      ]);
    });

    test("a token Zabbix does not take is said in the log, with Zabbix's words", async () => {
      const zabbix: FakeZabbix = new FakeZabbix([{}]);

      zabbix.token = "f".repeat(64);

      const trace: SimulationTrace = await sync({
        kind: kind,
        state: "Acknowledged",
        zabbix: zabbix,
      });

      expect(trace.ports["choose-action-1"]).toBe("error");
      expect(trace.logs).toEqual([
        `❌ Could not read Zabbix problem ${EVENT_ID}, so Zabbix was not updated: Zabbix said: Invalid params. Not authorized.`,
      ]);
      expect(zabbix.problem().acknowledged).toBe("0");
    });

    test("a problem the token's user cannot see is said in the log, and nothing is sent", async () => {
      const zabbix: FakeZabbix = new FakeZabbix([{ eventid: OTHER_EVENT_ID }]);
      const trace: SimulationTrace = await sync({
        kind: kind,
        state: "Acknowledged",
        zabbix: zabbix,
      });

      expect(zabbix.calls).toHaveLength(1);
      expect(trace.logs).toEqual([
        `ℹ️ Zabbix has no problem with event ID ${EVENT_ID}, or the API token's user cannot see it, so Zabbix was not updated.`,
      ]);
    });

    test("a close Zabbix refuses is said in the log, with Zabbix's words", async () => {
      const zabbix: FakeZabbix = new FakeZabbix([{ manual_close: "1" }]);

      zabbix.canClose = false;

      const trace: SimulationTrace = await sync({
        kind: kind,
        state: "Resolved",
        zabbix: zabbix,
      });

      expect(trace.ports["check-answer-1"]).toBe("error");
      expect(trace.logs).toEqual([
        `❌ Zabbix did not update problem ${EVENT_ID}: Zabbix said: Invalid params. No permissions to referred object or it does not exist!`,
      ]);
    });

    test("a Zabbix that cannot be reached is said in the log", async () => {
      const zabbix: FakeZabbix = new FakeZabbix([{}]);
      const trace: SimulationTrace = await sync({
        kind: kind,
        state: "Acknowledged",
        zabbix: zabbix,
        http: (): SimulatedReply => {
          return { status: 502, body: "Bad Gateway" };
        },
      });

      expect(trace.ports["get-problem-1"]).toBe("error");
      expect(trace.logs).toHaveLength(1);
      expect(trace.logs[0]).toMatch(
        new RegExp(`^❌ Could not reach Zabbix to read problem ${EVENT_ID}: `),
      );
    });

    test("an address that is not Zabbix's API is said to be one, rather than read as an unknown problem", async () => {
      const zabbix: FakeZabbix = new FakeZabbix([{}]);
      const trace: SimulationTrace = await sync({
        kind: kind,
        state: "Acknowledged",
        zabbix: zabbix,
        http: (): SimulatedReply => {
          return {
            status: 200,
            body: "<!doctype html><html><body>Zabbix</body></html>",
          };
        },
      });

      expect(trace.logs).toEqual([
        `❌ Could not read Zabbix problem ${EVENT_ID}, so Zabbix was not updated: The answer did not come from Zabbix's API. Check that the Zabbix URL is the address you open Zabbix at.`,
      ]);
    });

    test("a Zabbix under a path is called there: <Zabbix URL>/api_jsonrpc.php", async () => {
      const zabbix: FakeZabbix = new FakeZabbix([{}]);
      const urls: Array<string> = [];
      const trace: SimulationTrace = await sync({
        kind: kind,
        state: "Acknowledged",
        zabbix: zabbix,
        variables: { ...VARIABLES, zabbixUrl: "https://example.com/zabbix" },
        http: (request: SimulatedRequest): SimulatedReply => {
          urls.push(request.url);
          return zabbix.answer({
            ...request,
            url: request.url.replace("/zabbix/", "/"),
          });
        },
      });

      expect(urls).toEqual([
        "https://example.com/zabbix/api_jsonrpc.php",
        "https://example.com/zabbix/api_jsonrpc.php",
      ]);
      expect(trace.logs[0]).toMatch(/^✅ /);
    });
  },
);

async function noteToZabbix(data: {
  kind: ZabbixKindFixture;
  zabbix: FakeZabbix;
  note?: string | undefined;
  authorName?: string | null | undefined;
  record?: JSONObject | null | undefined;
  database?: FakeDatabase | undefined;
}): Promise<SimulationTrace> {
  const r: string = data.kind.noun;

  return await runTemplate({
    templateId: data.kind.noteTemplateId,
    trigger: {
      model: noteModel(data.kind, {
        note: data.note,
        authorName: data.authorName,
      }),
    },
    variables: VARIABLES,
    http: http(data.zabbix),
    database: data.database || {
      [`${r}-find-one`]: found(
        data.record === undefined ? recordModel(data.kind) : data.record,
      ),
    },
  });
}

describe.each(KINDS)(
  "a private note on the $noun, into Zabbix",
  (kind: ZabbixKindFixture) => {
    const r: string = kind.noun;

    test("is a message on the record's Zabbix problem, saying whose note it is", async () => {
      const zabbix: FakeZabbix = new FakeZabbix([{}]);
      const trace: SimulationTrace = await noteToZabbix({
        kind: kind,
        zabbix: zabbix,
      });

      // The record is read by itself, by the id the note names.
      expect(callsTo(trace, `find-${r}-1`)[0]!.args["query"]).toEqual({
        _id: kind.recordId,
      });
      expect(trace.requests).toHaveLength(1);
      expect(trace.requests[0]!.url).toBe(ZABBIX_API_URL);
      expect(trace.requests[0]!.headers["Authorization"]).toBe(
        `Bearer ${ZABBIX_API_TOKEN}`,
      );
      expect(trace.requests[0]!.body).toEqual({
        jsonrpc: "2.0",
        method: "event.acknowledge",
        params: {
          eventids: [EVENT_ID],
          // Add a message, and nothing else.
          action: "4",
          message: `${ZABBIX_SYNCED_FROM_ONEUPTIME_MARKER}: private note on ${kind.number} by Jane Doe.\n\nRolled the checkout pods back to v4.1. Error rate is dropping.`,
        },
        id: 1,
      });
      expect(zabbix.problem().acknowledged).toBe("0");
      expect(trace.logs).toEqual([
        `✅ Added the note to Zabbix problem ${EVENT_ID} as a message.`,
      ]);
    });

    test("a note that came from Zabbix is not posted back", async () => {
      const zabbix: FakeZabbix = new FakeZabbix([{}]);
      const trace: SimulationTrace = await noteToZabbix({
        kind: kind,
        zabbix: zabbix,
        note: `${ONEUPTIME_SYNCED_FROM_ZABBIX_MARKER}: Ada Lovelace (ada) updated Zabbix problem ${EVENT_ID}: commented.`,
      });

      expect(trace.requests).toHaveLength(0);
      expect(trace.logs).toEqual([
        "ℹ️ This note came from Zabbix, so it was not posted back.",
      ]);
    });

    test(`a note on an ${r} no Zabbix problem opened, or on a private one, or an empty note, sends nothing`, async () => {
      const unlinked: SimulationTrace = await noteToZabbix({
        kind: kind,
        zabbix: new FakeZabbix([{}]),
        record: recordModel(kind, { eventId: null }),
      });

      expect(unlinked.requests).toHaveLength(0);
      expect(unlinked.logs).toEqual([
        `ℹ️ The note is on ${kind.number}, which was not ${kind.created} for a Zabbix problem, so it was not posted to Zabbix.`,
      ]);

      const hidden: SimulationTrace = await noteToZabbix({
        kind: kind,
        zabbix: new FakeZabbix([{}]),
        record: recordModel(kind, { isPrivate: true }),
      });

      expect(hidden.requests).toHaveLength(0);
      expect(hidden.logs).toEqual([
        `ℹ️ The note is on ${kind.number}, a private ${r}, so it was not posted to Zabbix.`,
      ]);

      const empty: SimulationTrace = await noteToZabbix({
        kind: kind,
        zabbix: new FakeZabbix([{}]),
        note: "   \n ",
      });

      expect(empty.requests).toHaveLength(0);
      expect(empty.logs).toEqual([
        "ℹ️ The note is empty, so there is nothing to post.",
      ]);
    });

    test("a note longer than Zabbix keeps is cut to fit, and Zabbix takes it", async () => {
      const zabbix: FakeZabbix = new FakeZabbix([{}]);
      const trace: SimulationTrace = await noteToZabbix({
        kind: kind,
        zabbix: zabbix,
        note: "x".repeat(5000),
      });

      const message: string = zabbix.problem().messages[0] as string;

      expect(message.length).toBe(ZABBIX_MESSAGE_MAX_LENGTH);
      expect(message.endsWith("…")).toBe(true);
      expect(trace.logs[0]).toMatch(/^✅ /);
    });

    test("a note whose record cannot be read, or that Zabbix refuses, is said in the log", async () => {
      const unread: SimulationTrace = await noteToZabbix({
        kind: kind,
        zabbix: new FakeZabbix([{}]),
        database: { [`${r}-find-one`]: DATABASE_FAILURE },
      });

      expect(unread.requests).toHaveLength(0);
      expect(unread.logs).toEqual([
        `❌ Could not read the ${r} the note is on, so it was not posted to Zabbix. Why is in the run log above.`,
      ]);

      const refused: SimulationTrace = await noteToZabbix({
        kind: kind,
        zabbix: new FakeZabbix([{ eventid: OTHER_EVENT_ID }]),
      });

      expect(refused.logs).toEqual([
        `❌ Zabbix did not add the note to problem ${EVENT_ID}: Zabbix said: Invalid params. No permissions to referred object or it does not exist!`,
      ]);
    });
  },
);

/* ------------------------------- Both ways, settled ------------------------------- */

describe("both ways at once, the templates settle instead of echoing each other", () => {
  test("acknowledged in Zabbix: the incident is acknowledged, and the state template leaves the problem as Zabbix has it", async () => {
    const zabbix: FakeZabbix = new FakeZabbix([{ acknowledged: "1" }]);

    const inbound: SimulationTrace = await receive({
      kind: INCIDENT,
      body: update(),
    });

    expect(callsTo(inbound, "change-state-2")).toHaveLength(1);

    // The incident's new state starts the state template.
    const outbound: SimulationTrace = await sync({
      kind: INCIDENT,
      state: "Acknowledged",
      zabbix: zabbix,
    });

    expect(
      zabbix.calls.map((call: { method: string }): string => {
        return call.method;
      }),
    ).toEqual(["event.get"]);
    expect(zabbix.problem().messages).toEqual([]);
    expect(outbound.logs[0]).toMatch(/already acknowledged in Zabbix/);
  });

  test("resolved in OneUptime: the problem is closed, and Zabbix's recovery that follows finds the incident resolved already", async () => {
    const zabbix: FakeZabbix = new FakeZabbix([{ manual_close: "1" }]);

    await sync({ kind: INCIDENT, state: "Resolved", zabbix: zabbix });

    expect(zabbix.problem().r_eventid).not.toBe("0");

    // Closing the problem is a recovery in Zabbix, which the action sends.
    const back: SimulationTrace = await receive({
      kind: INCIDENT,
      body: recovery(),
      recordState: "Resolved",
    });

    expect(callsTo(back, "change-state-1")).toHaveLength(0);
    expect(back.logs).toEqual([
      `ℹ️ ${INCIDENT.number} is already Resolved, so it was left as it is.`,
    ]);
  });

  test("a comment in Zabbix becomes a note, and the note template does not post it back", async () => {
    const inbound: SimulationTrace = await receive({
      kind: ALERT,
      body: update({ updateAction: "commented" }),
    });
    const note: string = onlyCall(inbound, "add-note-2")["note"] as string;
    const zabbix: FakeZabbix = new FakeZabbix([{}]);

    const outbound: SimulationTrace = await noteToZabbix({
      kind: ALERT,
      zabbix: zabbix,
      note: note,
    });

    expect(zabbix.calls).toHaveLength(0);
    expect(outbound.logs).toEqual([
      "ℹ️ This note came from Zabbix, so it was not posted back.",
    ]);
  });

  test("a note posted to Zabbix that comes back as an update is not copied in again", async () => {
    const zabbix: FakeZabbix = new FakeZabbix([{}]);

    await noteToZabbix({ kind: INCIDENT, zabbix: zabbix });

    // Zabbix sends its users other users' updates: the token's own, if it is another user's.
    const echoed: SimulationTrace = await receive({
      kind: INCIDENT,
      body: update({
        updateAction: "commented",
        updateMessage: zabbix.problem().messages[0],
        updateUser: "OneUptime (oneuptime)",
      }),
    });

    expect(callsTo(echoed, "add-note-2")).toHaveLength(0);
    expect(echoed.logs[0]).toMatch(/came from OneUptime, so it was not copied back\.$/);
  });

  test("the problem a record was opened for is the one every template finds and updates, by the same event ID", async () => {
    const opened: SimulationTrace = await receive({
      kind: INCIDENT,
      body: problem({ eventId: OTHER_EVENT_ID }),
    });
    const record: JSONObject = onlyCall(opened, "create-incident-1");
    const kept: string = (record["customFields"] as JSONObject)[
      ZABBIX_EVENT_ID_CUSTOM_FIELD
    ] as string;

    expect(kept).toBe(OTHER_EVENT_ID);

    const zabbix: FakeZabbix = new FakeZabbix([{ eventid: OTHER_EVENT_ID }]);

    await sync({
      kind: INCIDENT,
      state: "Acknowledged",
      zabbix: zabbix,
      eventId: kept,
    });

    expect(zabbix.problem(OTHER_EVENT_ID).acknowledged).toBe("1");
    expect(String(record["description"])).toContain(
      `triggerid=${TRIGGER_ID}&eventid=${OTHER_EVENT_ID}`,
    );
  });
});
