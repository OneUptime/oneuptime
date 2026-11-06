/*
 * The Datadog templates, run end to end by the template simulator
 * (WorkflowTemplateSimulator): the graph the create wizard builds, with who
 * was picked to page, its values substituted the way RunWorkflow does, the
 * real Check With JavaScript, Incident and Alert From Another Tool, If /
 * Else and Page steps, and the read step in the real sandbox. Datadog's
 * side is what its Webhooks integration posts with the payload the read
 * step says to paste (datadogPostedBody). The project is one held in memory
 * (TemplateWorld), and the paging itself (OnCallPageService.page) is stood
 * in for.
 *
 * An alert, followed from start to end, for an incident and for an alert:
 *
 *   - Triggered: a record at the severity the monitor's priority maps to,
 *     titled after the monitor, kept off status pages (an incident),
 *     holding the alert's cycle key - paged for P1, P2 and no priority,
 *     never twice for one alert;
 *   - Warn and No Data: a private note on that record, saying so;
 *   - Recovered: that record resolved, saying why; nothing for an alert no
 *     record was opened for;
 *   - and the next time the monitor triggers, Datadog's new cycle key opens
 *     a new record.
 */

import OnCallPageService, {
  OnCallPageRecordType,
  OnCallPageRequest,
  OnCallPageResult,
} from "../../../Server/Services/OnCallPageService";
import WorkflowPrincipal, {
  WorkflowPrincipalOptions,
} from "../../../Server/Utils/Workflow/WorkflowPrincipal";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  DATADOG_ALERT_CYCLE_KEY_CUSTOM_FIELD,
  DatadogTransition,
  ONEUPTIME_SYNCED_FROM_DATADOG_MARKER,
  buildGraphForTemplate,
} from "../../../Types/Workflow/Templates";
import {
  EquivalenceScenario,
  TemplateRun,
  runNewTemplate,
} from "./TemplateEquivalence";
import TemplateWorld from "./TemplateWorld";
import { SimulationTrace, runTemplate } from "./WorkflowTemplateSimulator";
import {
  ALERT_CYCLE_KEY,
  AlertingToolKind,
  DATADOG_LINK,
  DatadogNotificationProps,
  INCIDENT,
  KINDS,
  OTHER_ALERT_CYCLE_KEY,
  READ_STEP,
  datadogPostedBody,
  webhookDelivery,
} from "./AlertingToolTemplateFixtures";
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

// Who to page, as the wizard stores the policy picked.
const PICKS: { [componentId: string]: Array<string> } = {
  "page-on-call-policy-1": [POLICY_ID],
};

const FROM_DATADOG: string = ONEUPTIME_SYNCED_FROM_DATADOG_MARKER;
const IN_DATADOG: string = ` ([open it in Datadog](${DATADOG_LINK}))`;

beforeEach(() => {
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

const recordsOf: (
  run: TemplateRun,
  kind: AlertingToolKind,
) => Array<JSONObject> = (
  run: TemplateRun,
  kind: AlertingToolKind,
): Array<JSONObject> => {
  return run.outcome.world[`${kind.noun}s`] as Array<JSONObject>;
};

const notesOf: (
  run: TemplateRun,
  kind: AlertingToolKind,
) => Array<JSONObject> = (
  run: TemplateRun,
  kind: AlertingToolKind,
): Array<JSONObject> => {
  return run.outcome.world[`${kind.noun}Notes`] as Array<JSONObject>;
};

const changesOf: (
  run: TemplateRun,
  kind: AlertingToolKind,
) => Array<JSONObject> = (
  run: TemplateRun,
  kind: AlertingToolKind,
): Array<JSONObject> => {
  return run.outcome.world[`${kind.noun}StateChanges`] as Array<JSONObject>;
};

// A record already opened for an alert, as an earlier Triggered left it.
const addRecord: (
  world: TemplateWorld,
  kind: AlertingToolKind,
  props?: { alertCycleKey?: string; stateName?: string },
) => BaseModel = (
  world: TemplateWorld,
  kind: AlertingToolKind,
  props?: { alertCycleKey?: string; stateName?: string },
): BaseModel => {
  const record: {
    customFields: JSONObject;
    stateName?: string;
    title: string;
  } = {
    customFields: {
      [DATADOG_ALERT_CYCLE_KEY_CUSTOM_FIELD]:
        props?.alertCycleKey || ALERT_CYCLE_KEY,
    },
    title: "Datadog: High CPU on web-1",
    ...(props?.stateName ? { stateName: props.stateName } : {}),
  };

  return kind === INCIDENT ? world.addIncident(record) : world.addAlert(record);
};

describe.each(KINDS)(
  "$datadogTemplateId, end to end",
  (kind: AlertingToolKind) => {
    const receive: (
      props?: DatadogNotificationProps,
      setUp?: (world: TemplateWorld) => void,
      extra?: Partial<EquivalenceScenario>,
    ) => Promise<TemplateRun> = async (
      props?: DatadogNotificationProps,
      setUp?: (world: TemplateWorld) => void,
      extra?: Partial<EquivalenceScenario>,
    ): Promise<TemplateRun> => {
      return await runNewTemplate({
        templateId: kind.datadogTemplateId,
        variables: {},
        setUp: setUp,
        trigger: (): JSONObject => {
          return webhookDelivery(datadogPostedBody(props));
        },
        picks: PICKS,
        ...extra,
      });
    };

    /* ------------------------------ Triggered ------------------------------ */

    test(`a P1 monitor that triggers opens one ${kind.noun}: titled after the monitor, at the most severe severity, holding the alert's cycle key`, async () => {
      const run: TemplateRun = await receive();
      const records: Array<JSONObject> = recordsOf(run, kind);

      expect(records).toHaveLength(1);
      expect(records[0]).toEqual(
        expect.objectContaining({
          number: kind.firstNumber,
          title: "Datadog: High CPU on web-1",
          severity: kind.severities[0],
          state: kind === INCIDENT ? "Identified" : "Created",
          customFields: {
            [DATADOG_ALERT_CYCLE_KEY_CUSTOM_FIELD]: ALERT_CYCLE_KEY,
          },
          ...(kind === INCIDENT
            ? {
                isVisibleOnStatusPage: false,
                shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: false,
              }
            : {}),
        }),
      );
      expect(records[0]?.["description"]).toBe(
        [
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
      );
    });

    test("the run reads the notification, keeps the record and pages: every step says why it went on", async () => {
      const run: TemplateRun = await receive();

      expect(run.trace.executed).toEqual([
        "webhook-1",
        READ_STEP,
        kind.step,
        "if-page-1",
        "page-on-call-policy-1",
      ]);
      expect(run.trace.ports).toEqual(
        expect.objectContaining({
          [READ_STEP]: "yes",
          [kind.step]: "opened",
          "if-page-1": "yes",
          "page-on-call-policy-1": "success",
        }),
      );
      expect(run.trace.portReasons[kind.step]).toBe(
        `${kind.Opened} ${kind.firstNumber} at ${kind.severities[0]} for ${DATADOG_ALERT_CYCLE_KEY_CUSTOM_FIELD} ${ALERT_CYCLE_KEY}.`,
      );
      expect(run.outcome.pages).toEqual([
        {
          users: [],
          teams: [],
          schedules: [],
          policies: [POLICY_ID],
          about: `${kind.noun} ${kind.firstNumber}`,
        },
      ]);
      expect(run.trace.failedSteps).toEqual([]);
    });

    test.each([
      ["P1", 0, true],
      ["P2", 0, true],
      ["P3", 1, false],
      ["P4", 2, false],
      ["P5", 2, false],
      ["", 0, true],
    ])(
      "a monitor of priority %p opens at the project's severity in place %p, and pages: %p",
      async (priority: string, place: number, pages: boolean) => {
        const run: TemplateRun = await receive({ priority: priority });

        expect(recordsOf(run, kind)[0]?.["severity"]).toBe(
          kind.severities[place],
        );
        expect(run.outcome.pages).toEqual(
          pages
            ? [
                expect.objectContaining({
                  policies: [POLICY_ID],
                  about: `${kind.noun} ${kind.firstNumber}`,
                }),
              ]
            : [],
        );
        expect(run.trace.ports["if-page-1"]).toBe(pages ? "yes" : "no");
        expect(run.trace.failedSteps).toEqual([]);
      },
    );

    test("Re-Triggered for an alert that has its record opens no other record, and pages nobody again", async () => {
      const run: TemplateRun = await receive(
        { transition: DatadogTransition.ReTriggered },
        (world: TemplateWorld): void => {
          addRecord(world, kind);
        },
      );

      expect(recordsOf(run, kind)).toHaveLength(1);
      expect(run.outcome.pages).toEqual([]);
      expect(run.trace.ports[kind.step]).toBe("unchanged");
      expect(run.trace.portReasons[kind.step]).toBe(
        `${kind.firstNumber} already has ${DATADOG_ALERT_CYCLE_KEY_CUSTOM_FIELD} ${ALERT_CYCLE_KEY}, so no other ${kind.noun} was ${kind === INCIDENT ? "opened" : "created"}.`,
      );
      expect(run.trace.failedSteps).toEqual([]);
    });

    test("with nobody picked to page, the record is opened and nobody is paged: the If / Else and the Page step are not there", async () => {
      const run: TemplateRun = await receive(undefined, undefined, {
        picks: {},
      });

      expect(recordsOf(run, kind)).toHaveLength(1);
      expect(run.outcome.pages).toEqual([]);
      expect(run.trace.executed).toEqual(["webhook-1", READ_STEP, kind.step]);
      expect(run.trace.failedSteps).toEqual([]);
    });

    test("a page that reaches nobody fails the run at the Page step, and the record stays opened", async () => {
      const run: TemplateRun = await receive(undefined, undefined, {
        pagingFails: true,
      });

      expect(recordsOf(run, kind)).toHaveLength(1);
      expect(run.trace.failedSteps).toEqual(["page-on-call-policy-1"]);
      expect(run.outcome.failed).toBe(true);
    });

    test("a project with no severities opens nothing, and the run fails saying why", async () => {
      const run: TemplateRun = await receive(
        undefined,
        (world: TemplateWorld): void => {
          (kind === INCIDENT ? world.incidents : world.alerts).severities.rows =
            [];
        },
      );

      expect(recordsOf(run, kind)).toHaveLength(0);
      expect(run.trace.failedSteps).toEqual([kind.step]);
      expect(run.trace.portReasons[kind.step]).toContain(
        `This project has no ${kind.noun} severities to put the ${kind.noun} at.`,
      );
    });

    /* ------------------------------ Recovered ------------------------------ */

    test("Recovered resolves the record it opened, saying why on its timeline", async () => {
      const run: TemplateRun = await receive(
        { transition: DatadogTransition.Recovered },
        (world: TemplateWorld): void => {
          addRecord(world, kind);
        },
      );

      expect(recordsOf(run, kind)[0]?.["state"]).toBe("Resolved");
      expect(changesOf(run, kind)).toEqual([
        {
          record: kind.firstNumber,
          state: "Resolved",
          rootCause: `${FROM_DATADOG}: the monitor recovered${IN_DATADOG}.`,
        },
      ]);
      expect(notesOf(run, kind)).toEqual([]);
      expect(run.outcome.pages).toEqual([]);
      expect(run.trace.ports[kind.step]).toBe("updated");
      expect(run.trace.executed).not.toContain("if-page-1");
    });

    test("an acknowledged record is resolved by the recovery too: it moves forward, past Acknowledged", async () => {
      const run: TemplateRun = await receive(
        { transition: DatadogTransition.Recovered },
        (world: TemplateWorld): void => {
          addRecord(world, kind, { stateName: "Acknowledged" });
        },
      );

      expect(recordsOf(run, kind)[0]?.["state"]).toBe("Resolved");
    });

    test("a record already resolved is left as it is: it never moves back", async () => {
      const run: TemplateRun = await receive(
        { transition: DatadogTransition.Recovered },
        (world: TemplateWorld): void => {
          addRecord(world, kind, { stateName: "Resolved" });
        },
      );

      expect(changesOf(run, kind)).toEqual([]);
      expect(run.trace.ports[kind.step]).toBe("unchanged");
      expect(run.trace.failedSteps).toEqual([]);
    });

    test("the recovery of an alert no record was opened for changes nothing, and the run succeeds", async () => {
      const run: TemplateRun = await receive(
        { transition: DatadogTransition.Recovered },
        (world: TemplateWorld): void => {
          addRecord(world, kind, { alertCycleKey: OTHER_ALERT_CYCLE_KEY });
        },
      );

      expect(changesOf(run, kind)).toEqual([]);
      expect(run.trace.portReasons[kind.step]).toBe(
        `No ${kind.noun} has ${DATADOG_ALERT_CYCLE_KEY_CUSTOM_FIELD} ${ALERT_CYCLE_KEY}, so there was nothing to resolve.`,
      );
      expect(run.trace.failedSteps).toEqual([]);
    });

    /* ---------------------------- Warn and No Data ---------------------------- */

    test.each([
      [DatadogTransition.Warn, "is at Warn"],
      [DatadogTransition.NoData, "has no data"],
    ])(
      "%s adds a private note to the open record, and leaves its state",
      async (transition: string, now: string) => {
        const run: TemplateRun = await receive(
          { transition: transition },
          (world: TemplateWorld): void => {
            addRecord(world, kind);
          },
        );

        expect(notesOf(run, kind)).toEqual([
          {
            record: kind.firstNumber,
            note: `${FROM_DATADOG}: the monitor ${now}${IN_DATADOG}.`,
          },
        ]);
        expect(changesOf(run, kind)).toEqual([]);
        expect(recordsOf(run, kind)[0]?.["state"]).toBe(
          kind === INCIDENT ? "Identified" : "Created",
        );
        expect(run.trace.ports[kind.step]).toBe("updated");
        expect(run.outcome.pages).toEqual([]);
      },
    );

    test("a warning about an alert no record was opened for adds nothing, opens nothing, and the run succeeds", async () => {
      const run: TemplateRun = await receive({
        transition: DatadogTransition.Warn,
      });

      expect(recordsOf(run, kind)).toEqual([]);
      expect(notesOf(run, kind)).toEqual([]);
      expect(run.trace.portReasons[kind.step]).toBe(
        `No ${kind.noun} has ${DATADOG_ALERT_CYCLE_KEY_CUSTOM_FIELD} ${ALERT_CYCLE_KEY}, so the note was not added.`,
      );
      expect(run.trace.failedSteps).toEqual([]);
    });

    /* ----------------------------- Nothing to do ----------------------------- */

    test("Renotify stops at the read step, saying why, and the run succeeds", async () => {
      const run: TemplateRun = await receive(
        { transition: DatadogTransition.Renotify },
        (world: TemplateWorld): void => {
          addRecord(world, kind);
        },
      );

      expect(run.trace.executed).toEqual(["webhook-1", READ_STEP]);
      expect(run.trace.ports[READ_STEP]).toBe("no");
      expect(run.trace.portReasons[READ_STEP]).toBe(
        `Datadog reminded that alert cycle ${ALERT_CYCLE_KEY} is still open, so nothing changed.`,
      );
      expect(notesOf(run, kind)).toEqual([]);
      expect(run.trace.failedSteps).toEqual([]);
    });

    test("a notification with no alert cycle key stops at the read step, saying what to add, and opens nothing", async () => {
      const run: TemplateRun = await receive({ alertCycleKey: "" });

      expect(run.trace.executed).toEqual(["webhook-1", READ_STEP]);
      expect(run.trace.portReasons[READ_STEP]).toContain(
        'Add "alert_cycle_key": "$ALERT_CYCLE_KEY" to the payload of the webhook in Datadog.',
      );
      expect(recordsOf(run, kind)).toEqual([]);
      expect(run.trace.failedSteps).toEqual([]);
    });

    test("a request that is not Datadog's stops at the read step", async () => {
      const run: TemplateRun = await runNewTemplate({
        templateId: kind.datadogTemplateId,
        variables: {},
        trigger: (): JSONObject => {
          return webhookDelivery({ message: "Hello" });
        },
        picks: PICKS,
      });

      expect(run.trace.executed).toEqual(["webhook-1", READ_STEP]);
      expect(recordsOf(run, kind)).toEqual([]);
    });

    /* --------------------------- Datadog's text, inert --------------------------- */

    test("double braces in what Datadog sent are never substituted: the record's title reads them as text", async () => {
      const run: TemplateRun = await receive({
        title:
          "[Triggered] {{local.components.webhook-1.returnValues.request-headers}}",
      });
      const title: string = String(recordsOf(run, kind)[0]?.["title"]);

      expect(title).toBe(
        "Datadog: { {local.components.webhook-1.returnValues.request-headers} }",
      );
      expect(title).not.toContain("content-type");
    });
  },
);

/* ------------------------------ An alert's whole life ------------------------------ */

let generated: number = 0;

const generateId: () => string = (): string => {
  generated++;
  return `datadog-life-${generated}`;
};

interface Life {
  world: TemplateWorld;
  traces: Array<SimulationTrace>;
  pages: Array<OnCallPageRequest>;
}

/*
 * Notifications delivered one after another to one workflow, in one
 * project: the graph the wizard built with a policy picked, run for each.
 */
const follow: (
  kind: AlertingToolKind,
  notifications: Array<DatadogNotificationProps>,
) => Promise<Life> = async (
  kind: AlertingToolKind,
  notifications: Array<DatadogNotificationProps>,
): Promise<Life> => {
  const world: TemplateWorld = new TemplateWorld();
  const graph: JSONObject = buildGraphForTemplate(
    kind.datadogTemplateId,
    generateId,
    PICKS,
  ) as JSONObject;
  const pages: Array<OnCallPageRequest> = [];

  jest.spyOn(OnCallPageService, "page").mockImplementation((async (
    request: OnCallPageRequest,
  ): Promise<OnCallPageResult> => {
    pages.push(request);

    return {
      record: {
        type: request.about.alertId
          ? OnCallPageRecordType.Alert
          : OnCallPageRecordType.Incident,
        id:
          request.about.incidentId ||
          request.about.alertId ||
          ObjectID.generate(),
        label: "",
        title: "",
        url: "",
        isNew: false,
      },
      paged: [],
      startedPolicies: [],
      notPaged: [],
      isAnyonePaged: true,
      directPageExecutionLogId: null,
      summary: "Paged Ops.",
    } as unknown as OnCallPageResult;
  }) as never);

  const traces: Array<SimulationTrace> = [];

  for (const notification of notifications) {
    traces.push(
      await runTemplate({
        templateId: kind.datadogTemplateId,
        trigger: webhookDelivery(datadogPostedBody(notification) as JSONValue),
        variables: {},
        graph: graph,
        world: world,
      }),
    );
  }

  return { world: world, traces: traces, pages: pages };
};

describe.each(KINDS)(
  "$datadogTemplateId, over an alert's whole life",
  (kind: AlertingToolKind) => {
    test("triggers, warns, triggers again and recovers: one record, one page, one note, resolved once", async () => {
      const life: Life = await follow(kind, [
        { transition: DatadogTransition.Triggered },
        { transition: DatadogTransition.Warn },
        { transition: DatadogTransition.ReTriggered },
        { transition: DatadogTransition.Renotify },
        { transition: DatadogTransition.Recovered },
      ]);
      const snapshot: JSONObject = life.world.snapshot();
      const records: Array<JSONObject> = snapshot[
        `${kind.noun}s`
      ] as Array<JSONObject>;

      expect(records).toHaveLength(1);
      expect(records[0]).toEqual(
        expect.objectContaining({
          number: kind.firstNumber,
          state: "Resolved",
          severity: kind.severities[0],
        }),
      );
      expect(snapshot[`${kind.noun}Notes`]).toEqual([
        {
          record: kind.firstNumber,
          note: `${FROM_DATADOG}: the monitor is at Warn${IN_DATADOG}.`,
        },
      ]);
      expect(snapshot[`${kind.noun}StateChanges`]).toEqual([
        {
          record: kind.firstNumber,
          state: "Resolved",
          rootCause: `${FROM_DATADOG}: the monitor recovered${IN_DATADOG}.`,
        },
      ]);
      expect(life.pages).toHaveLength(1);
      expect(
        life.traces.map((trace: SimulationTrace): string => {
          return String(trace.ports[kind.step] ?? trace.ports[READ_STEP]);
        }),
      ).toEqual(["opened", "updated", "unchanged", "no", "updated"]);
      expect(
        life.traces.flatMap((trace: SimulationTrace): Array<string> => {
          return trace.failedSteps;
        }),
      ).toEqual([]);
    });

    test("the next time the monitor triggers, Datadog's new cycle key opens a new record and pages again", async () => {
      const life: Life = await follow(kind, [
        { transition: DatadogTransition.Triggered },
        { transition: DatadogTransition.Recovered },
        {
          transition: DatadogTransition.Triggered,
          alertCycleKey: OTHER_ALERT_CYCLE_KEY,
        },
      ]);
      const records: Array<JSONObject> = life.world.snapshot()[
        `${kind.noun}s`
      ] as Array<JSONObject>;

      expect(
        records.map((record: JSONObject): string => {
          return `${String(record["number"])} ${String(record["state"])} ${JSON.stringify(record["customFields"])}`;
        }),
      ).toEqual([
        `${kind.firstNumber} Resolved ${JSON.stringify({ [DATADOG_ALERT_CYCLE_KEY_CUSTOM_FIELD]: ALERT_CYCLE_KEY })}`,
        `${kind.secondNumber} ${kind === INCIDENT ? "Identified" : "Created"} ${JSON.stringify({ [DATADOG_ALERT_CYCLE_KEY_CUSTOM_FIELD]: OTHER_ALERT_CYCLE_KEY })}`,
      ]);
      expect(life.pages).toHaveLength(2);
    });

    test("two groups of one monitor alert at once: each its own record, each paged, each resolved by its own recovery", async () => {
      const life: Life = await follow(kind, [
        { transition: DatadogTransition.Triggered, host: "web-1" },
        {
          transition: DatadogTransition.Triggered,
          host: "web-2",
          alertCycleKey: OTHER_ALERT_CYCLE_KEY,
        },
        {
          transition: DatadogTransition.Recovered,
          host: "web-2",
          alertCycleKey: OTHER_ALERT_CYCLE_KEY,
        },
      ]);
      const records: Array<JSONObject> = life.world.snapshot()[
        `${kind.noun}s`
      ] as Array<JSONObject>;

      expect(
        records.map((record: JSONObject): string => {
          return `${String(record["title"])}: ${String(record["state"])}`;
        }),
      ).toEqual([
        `Datadog: High CPU on web-1: ${kind === INCIDENT ? "Identified" : "Created"}`,
        "Datadog: High CPU on web-2: Resolved",
      ]);
      expect(life.pages).toHaveLength(2);
    });
  },
);
