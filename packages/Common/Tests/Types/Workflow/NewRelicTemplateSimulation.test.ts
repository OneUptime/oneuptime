/*
 * The New Relic templates, run end to end by the template simulator
 * (WorkflowTemplateSimulator): the graph the create wizard builds, with who
 * was picked to page, its values substituted the way RunWorkflow does, the
 * real Check With JavaScript, Incident and Alert From Another Tool and Page
 * steps, and the read step in the real sandbox. New Relic's side is what a
 * New Relic workflow's webhook posts with the payload New Relic fills in by
 * default, and isAcknowledged where a test gives it (newRelicPostedBody).
 * The project is one held in memory (TemplateWorld), and the paging itself
 * (OnCallPageService.page) is stood in for.
 *
 * An issue, followed from start to end, for an incident and for an alert:
 *
 *   - activated: a record at the severity the issue's priority maps to,
 *     titled after the issue, kept off status pages (an incident), holding
 *     the issue's ID - and paged, whatever its priority, never twice for one
 *     issue, so an issue New Relic raises from HIGH to CRITICAL has paged
 *     once already;
 *   - acknowledged: that record acknowledged, saying why;
 *   - closed: that record resolved, saying why; nothing for an issue no
 *     record was opened for;
 *   - and the next issue, with an ID of its own, opens a record of its own.
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
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  NEW_RELIC_ISSUE_ID_CUSTOM_FIELD,
  NewRelicIssueState,
  ONEUPTIME_SYNCED_FROM_NEW_RELIC_MARKER,
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
  AlertingToolKind,
  INCIDENT,
  ISSUE_ID,
  KINDS,
  NEW_RELIC_LINK,
  NewRelicNotificationProps,
  OTHER_ISSUE_ID,
  READ_STEP,
  newRelicPostedBody,
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

const FROM_NEW_RELIC: string = ONEUPTIME_SYNCED_FROM_NEW_RELIC_MARKER;
const IN_NEW_RELIC: string = ` ([open it in New Relic](${NEW_RELIC_LINK}))`;

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

const changesOf: (
  run: TemplateRun,
  kind: AlertingToolKind,
) => Array<JSONObject> = (
  run: TemplateRun,
  kind: AlertingToolKind,
): Array<JSONObject> => {
  return run.outcome.world[`${kind.noun}StateChanges`] as Array<JSONObject>;
};

// The state a new record of the kind starts in, in the test project.
const firstStateOf: (kind: AlertingToolKind) => string = (
  kind: AlertingToolKind,
): string => {
  return kind === INCIDENT ? "Identified" : "Created";
};

// A record already opened for an issue, as an earlier notification left it.
const addRecord: (
  world: TemplateWorld,
  kind: AlertingToolKind,
  props?: { issueId?: string; stateName?: string },
) => BaseModel = (
  world: TemplateWorld,
  kind: AlertingToolKind,
  props?: { issueId?: string; stateName?: string },
): BaseModel => {
  const record: { customFields: JSONObject; stateName?: string; title: string } = {
    customFields: {
      [NEW_RELIC_ISSUE_ID_CUSTOM_FIELD]: props?.issueId || ISSUE_ID,
    },
    title: "New Relic: High CPU on checkout-service",
    ...(props?.stateName ? { stateName: props.stateName } : {}),
  };

  return kind === INCIDENT ? world.addIncident(record) : world.addAlert(record);
};

describe.each(KINDS)("$newRelicTemplateId, end to end", (kind: AlertingToolKind) => {
  const receive: (
    props?: NewRelicNotificationProps,
    setUp?: (world: TemplateWorld) => void,
    extra?: Partial<EquivalenceScenario>,
  ) => Promise<TemplateRun> = async (
    props?: NewRelicNotificationProps,
    setUp?: (world: TemplateWorld) => void,
    extra?: Partial<EquivalenceScenario>,
  ): Promise<TemplateRun> => {
    return await runNewTemplate({
      templateId: kind.newRelicTemplateId,
      variables: {},
      setUp: setUp,
      trigger: (): JSONObject => {
        return webhookDelivery(newRelicPostedBody(props));
      },
      picks: PICKS,
      ...extra,
    });
  };

  /* ------------------------------ Activated ------------------------------ */

  test(`an activated CRITICAL issue opens one ${kind.noun}: titled after the issue, at the most severe severity, holding the issue's ID`, async () => {
    const run: TemplateRun = await receive();
    const records: Array<JSONObject> = recordsOf(run, kind);

    expect(records).toHaveLength(1);
    expect(records[0]).toEqual(
      expect.objectContaining({
        number: kind.firstNumber,
        title: "New Relic: High CPU on checkout-service",
        severity: kind.severities[0],
        state: firstStateOf(kind),
        customFields: { [NEW_RELIC_ISSUE_ID_CUSTOM_FIELD]: ISSUE_ID },
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
        `${kind.Created} from a New Relic issue${IN_NEW_RELIC}.`,
        "",
        "- Priority in New Relic: CRITICAL",
        "- Entities: checkout-service, checkout-db",
        "- Policies: Production",
        "- Conditions: CPU above 90%",
      ].join("\n"),
    );
  });

  test("the run reads the notification, keeps the record and pages: every step says why it went on", async () => {
    const run: TemplateRun = await receive();

    expect(run.trace.executed).toEqual([
      "webhook-1",
      READ_STEP,
      kind.step,
      "page-on-call-policy-1",
    ]);
    expect(run.trace.ports).toEqual(
      expect.objectContaining({
        [READ_STEP]: "yes",
        [kind.step]: "opened",
        "page-on-call-policy-1": "success",
      }),
    );
    expect(run.trace.portReasons[kind.step]).toBe(
      `${kind.Opened} ${kind.firstNumber} at ${kind.severities[0]} for ${NEW_RELIC_ISSUE_ID_CUSTOM_FIELD} ${ISSUE_ID}.`,
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
    ["CRITICAL", 0],
    ["HIGH", 1],
    ["MEDIUM", 2],
    ["LOW", 2],
    ["", 0],
  ])(
    "an issue of priority %p opens at the project's severity in place %p, and pages",
    async (priority: string, place: number) => {
      const run: TemplateRun = await receive({ priority: priority });

      expect(recordsOf(run, kind)[0]?.["severity"]).toBe(
        kind.severities[place],
      );
      expect(run.outcome.pages).toEqual([
        expect.objectContaining({
          policies: [POLICY_ID],
          about: `${kind.noun} ${kind.firstNumber}`,
        }),
      ]);
      expect(run.trace.failedSteps).toEqual([]);
    },
  );

  test("a CREATED issue opens the record as an activated one does", async () => {
    const run: TemplateRun = await receive({
      state: NewRelicIssueState.Created,
    });

    expect(recordsOf(run, kind)).toHaveLength(1);
    expect(run.outcome.pages).toHaveLength(1);
  });

  test("the same issue again - New Relic raising it to CRITICAL, or adding to it - opens no other record, and pages nobody again", async () => {
    const run: TemplateRun = await receive(
      { priority: "CRITICAL" },
      (world: TemplateWorld): void => {
        addRecord(world, kind);
      },
    );

    expect(recordsOf(run, kind)).toHaveLength(1);
    expect(run.outcome.pages).toEqual([]);
    expect(run.trace.ports[kind.step]).toBe("unchanged");
    expect(run.trace.portReasons[kind.step]).toBe(
      `${kind.firstNumber} already has ${NEW_RELIC_ISSUE_ID_CUSTOM_FIELD} ${ISSUE_ID}, so no other ${kind.noun} was ${kind === INCIDENT ? "opened" : "created"}.`,
    );
    expect(run.trace.failedSteps).toEqual([]);
  });

  test("with nobody picked to page, the record is opened and nobody is paged: the Page step is not there", async () => {
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

  /* ----------------------------- Acknowledged ----------------------------- */

  test("an issue someone acknowledged in New Relic acknowledges the record, saying why on its timeline", async () => {
    const run: TemplateRun = await receive(
      { isAcknowledged: true },
      (world: TemplateWorld): void => {
        addRecord(world, kind);
      },
    );

    expect(recordsOf(run, kind)[0]?.["state"]).toBe("Acknowledged");
    expect(changesOf(run, kind)).toEqual([
      {
        record: kind.firstNumber,
        state: "Acknowledged",
        rootCause: `${FROM_NEW_RELIC}: the issue was acknowledged${IN_NEW_RELIC}.`,
      },
    ]);
    expect(run.trace.ports[kind.step]).toBe("updated");
    expect(run.outcome.pages).toEqual([]);
  });

  test("an acknowledgment for a record already acknowledged, or past it, leaves it as it is", async () => {
    for (const stateName of ["Acknowledged", "Resolved"]) {
      const run: TemplateRun = await receive(
        { isAcknowledged: true },
        (world: TemplateWorld): void => {
          addRecord(world, kind, { stateName: stateName });
        },
      );

      expect(recordsOf(run, kind)[0]?.["state"]).toBe(stateName);
      expect(changesOf(run, kind)).toEqual([]);
      expect(run.trace.ports[kind.step]).toBe("unchanged");
    }
  });

  test("an acknowledgment for an issue no record was opened for changes nothing, and the run succeeds", async () => {
    const run: TemplateRun = await receive({ isAcknowledged: true });

    expect(recordsOf(run, kind)).toEqual([]);
    expect(run.trace.portReasons[kind.step]).toBe(
      `No ${kind.noun} has ${NEW_RELIC_ISSUE_ID_CUSTOM_FIELD} ${ISSUE_ID}, so there was nothing to acknowledge.`,
    );
    expect(run.trace.failedSteps).toEqual([]);
  });

  /* -------------------------------- Closed -------------------------------- */

  test("a closed issue resolves the record it opened, saying why on its timeline", async () => {
    const run: TemplateRun = await receive(
      { state: NewRelicIssueState.Closed },
      (world: TemplateWorld): void => {
        addRecord(world, kind);
      },
    );

    expect(recordsOf(run, kind)[0]?.["state"]).toBe("Resolved");
    expect(changesOf(run, kind)).toEqual([
      {
        record: kind.firstNumber,
        state: "Resolved",
        rootCause: `${FROM_NEW_RELIC}: the issue was closed${IN_NEW_RELIC}.`,
      },
    ]);
    expect(run.outcome.pages).toEqual([]);
  });

  test("an acknowledged record is resolved by the close too: it moves forward, past Acknowledged", async () => {
    const run: TemplateRun = await receive(
      { state: NewRelicIssueState.Closed },
      (world: TemplateWorld): void => {
        addRecord(world, kind, { stateName: "Acknowledged" });
      },
    );

    expect(recordsOf(run, kind)[0]?.["state"]).toBe("Resolved");
  });

  test("a record already resolved is left as it is: it never moves back", async () => {
    const run: TemplateRun = await receive(
      { state: NewRelicIssueState.Closed },
      (world: TemplateWorld): void => {
        addRecord(world, kind, { stateName: "Resolved" });
      },
    );

    expect(changesOf(run, kind)).toEqual([]);
    expect(run.trace.ports[kind.step]).toBe("unchanged");
    expect(run.trace.failedSteps).toEqual([]);
  });

  test("the close of an issue no record was opened for changes nothing, and the run succeeds", async () => {
    const run: TemplateRun = await receive(
      { state: NewRelicIssueState.Closed },
      (world: TemplateWorld): void => {
        addRecord(world, kind, { issueId: OTHER_ISSUE_ID });
      },
    );

    expect(changesOf(run, kind)).toEqual([]);
    expect(run.trace.portReasons[kind.step]).toBe(
      `No ${kind.noun} has ${NEW_RELIC_ISSUE_ID_CUSTOM_FIELD} ${ISSUE_ID}, so there was nothing to resolve.`,
    );
    expect(run.trace.failedSteps).toEqual([]);
  });

  /* ----------------------------- Nothing to do ----------------------------- */

  test("an issue in a state the step does not know stops at the read step, saying why, and the run succeeds", async () => {
    const run: TemplateRun = await receive(
      { state: "DEACTIVATED" },
      (world: TemplateWorld): void => {
        addRecord(world, kind);
      },
    );

    expect(run.trace.executed).toEqual(["webhook-1", READ_STEP]);
    expect(run.trace.ports[READ_STEP]).toBe("no");
    expect(run.trace.portReasons[READ_STEP]).toBe(
      `New Relic issue ${ISSUE_ID} is DEACTIVATED: only an activated, acknowledged or closed issue changes the ${kind.noun}, so nothing changed.`,
    );
    expect(changesOf(run, kind)).toEqual([]);
    expect(run.trace.failedSteps).toEqual([]);
  });

  test("a request with no issue ID stops at the read step, saying what to check, and opens nothing", async () => {
    const run: TemplateRun = await receive({ issueId: "" });

    expect(run.trace.executed).toEqual(["webhook-1", READ_STEP]);
    expect(run.trace.portReasons[READ_STEP]).toContain(
      "Check that the payload of the webhook in New Relic keeps its id field.",
    );
    expect(recordsOf(run, kind)).toEqual([]);
    expect(run.trace.failedSteps).toEqual([]);
  });

  /* -------------------------- New Relic's text, inert -------------------------- */

  test("double braces in what New Relic sent are never substituted: the record's title reads them as text", async () => {
    const run: TemplateRun = await receive({
      title: "{{local.components.webhook-1.returnValues.request-headers}}",
    });
    const title: string = String(recordsOf(run, kind)[0]?.["title"]);

    expect(title).toBe(
      "New Relic: { {local.components.webhook-1.returnValues.request-headers} }",
    );
    expect(title).not.toContain("content-type");
  });
});

/* ------------------------------ An issue's whole life ------------------------------ */

let generated: number = 0;

const generateId: () => string = (): string => {
  generated++;
  return `new-relic-life-${generated}`;
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
  notifications: Array<NewRelicNotificationProps>,
) => Promise<Life> = async (
  kind: AlertingToolKind,
  notifications: Array<NewRelicNotificationProps>,
): Promise<Life> => {
  const world: TemplateWorld = new TemplateWorld();
  const graph: JSONObject = buildGraphForTemplate(
    kind.newRelicTemplateId,
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
        templateId: kind.newRelicTemplateId,
        trigger: webhookDelivery(newRelicPostedBody(notification)),
        variables: {},
        graph: graph,
        world: world,
      }),
    );
  }

  return { world: world, traces: traces, pages: pages };
};

describe.each(KINDS)("$newRelicTemplateId, over an issue's whole life", (kind: AlertingToolKind) => {
  test("activated at HIGH, raised to CRITICAL, acknowledged and closed: one record, one page, acknowledged then resolved", async () => {
    const life: Life = await follow(kind, [
      { priority: "HIGH", isAcknowledged: false },
      { priority: "CRITICAL", isAcknowledged: false },
      { priority: "CRITICAL", isAcknowledged: true },
      {
        priority: "CRITICAL",
        isAcknowledged: true,
        state: NewRelicIssueState.Closed,
      },
    ]);
    const snapshot: JSONObject = life.world.snapshot();
    const records: Array<JSONObject> = snapshot[`${kind.noun}s`] as Array<JSONObject>;

    expect(records).toHaveLength(1);
    // Opened at HIGH, the middle severity: the record keeps the severity it was opened at.
    expect(records[0]).toEqual(
      expect.objectContaining({
        number: kind.firstNumber,
        state: "Resolved",
        severity: kind.severities[1],
      }),
    );
    expect(snapshot[`${kind.noun}StateChanges`]).toEqual([
      {
        record: kind.firstNumber,
        state: "Acknowledged",
        rootCause: `${FROM_NEW_RELIC}: the issue was acknowledged${IN_NEW_RELIC}.`,
      },
      {
        record: kind.firstNumber,
        state: "Resolved",
        rootCause: `${FROM_NEW_RELIC}: the issue was closed${IN_NEW_RELIC}.`,
      },
    ]);
    // Paged once, when the issue opened at HIGH: raising it to CRITICAL needs no second page.
    expect(life.pages).toHaveLength(1);
    expect(
      life.traces.map((trace: SimulationTrace): string => {
        return String(trace.ports[kind.step]);
      }),
    ).toEqual(["opened", "unchanged", "updated", "updated"]);
    expect(
      life.traces.flatMap((trace: SimulationTrace): Array<string> => {
        return trace.failedSteps;
      }),
    ).toEqual([]);
  });

  test("with New Relic's default payload, the issue opens and closes the record, and is never acknowledged", async () => {
    const life: Life = await follow(kind, [
      {},
      {},
      { state: NewRelicIssueState.Closed },
    ]);
    const snapshot: JSONObject = life.world.snapshot();

    expect(
      (snapshot[`${kind.noun}StateChanges`] as Array<JSONObject>).map(
        (change: JSONObject): string => {
          return String(change["state"]);
        },
      ),
    ).toEqual(["Resolved"]);
    expect(life.pages).toHaveLength(1);
  });

  test("the next issue, with an ID of its own, opens a record of its own and pages again", async () => {
    const life: Life = await follow(kind, [
      {},
      { state: NewRelicIssueState.Closed },
      { issueId: OTHER_ISSUE_ID, title: "Error rate above 5%" },
    ]);
    const records: Array<JSONObject> = life.world.snapshot()[
      `${kind.noun}s`
    ] as Array<JSONObject>;

    expect(
      records.map((record: JSONObject): string => {
        return `${String(record["number"])} ${String(record["title"])}: ${String(record["state"])}`;
      }),
    ).toEqual([
      `${kind.firstNumber} New Relic: High CPU on checkout-service: Resolved`,
      `${kind.secondNumber} New Relic: Error rate above 5%: ${firstStateOf(kind)}`,
    ]);
    expect(life.pages).toHaveLength(2);
  });
});
