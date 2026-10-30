/*
 * "Open an incident for each Huntress incident report", before and after it
 * was made simple, on the same reports (TemplateEquivalence): it was 33
 * steps - a Switch / Case over the event, a Find, an If / Else and a Create,
 * a note or a resolution on each path, and a Log on every way out - and is
 * four now: the Huntress trigger, Incident From Another Tool, and an If /
 * Else and a Page step for high and critical reports.
 *
 * The same for the graphs the Huntress connections became
 * (buildHuntressIncidentWorkflowGraph with a connection's settings), frozen
 * for every setting a connection could have: paging from low, high or
 * critical up, paging nobody, and noting a close instead of resolving.
 *
 * Each delivery is read the way the webhook reads Huntress's body, then the
 * real Huntress trigger's run works out the incident's values - its title,
 * its description, its severity among the project's, its organization's
 * label - and the old graph and the new one run on them, each against a
 * project of its own made the same way.
 */

import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import IncidentSeverityService from "../../../Server/Services/IncidentSeverityService";
import LabelService from "../../../Server/Services/LabelService";
import { RunReturnType } from "../../../Server/Types/Workflow/ComponentCode";
import HuntressWorkflowTrigger from "../../../Server/Types/Workflow/Components/Huntress";
import WorkflowPrincipal, {
  WorkflowPrincipalOptions,
} from "../../../Server/Utils/Workflow/WorkflowPrincipal";
import Exception from "../../../Types/Exception/Exception";
import HuntressSeverity from "../../../Types/Huntress/HuntressSeverity";
import { parseHuntressWebhook } from "../../../Types/Huntress/HuntressWebhook";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  HuntressTriggerSetting,
  getHuntressDeliveryValues,
} from "../../../Types/Workflow/HuntressTrigger";
import {
  HUNTRESS_INCIDENT_TEMPLATE_ID,
  HUNTRESS_REPORT_ID_CUSTOM_FIELD,
  HuntressIncidentWorkflowOptions,
  buildHuntressIncidentWorkflowGraph,
} from "../../../Types/Workflow/Templates";
import {
  HUNTRESS_REPORT_ID,
  getHuntressClosedBody,
  getHuntressCommentBody,
  getHuntressIncidentReportBody,
} from "../Huntress/HuntressWebhookFixtures";
import {
  EquivalenceRun,
  EquivalenceScenario,
  runOldAndNew,
} from "./TemplateEquivalence";
import { getHuntressConnectionBeforeSimplifying } from "./TemplateGraphsBeforeSimplifying";
import TemplateWorld, { TemplateWorldOptions } from "./TemplateWorld";
import { SIMULATED_PROJECT_ID } from "./WorkflowTemplateSimulator";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.setTimeout(180000);

const POLICY_ID: string = "aaaaaaaa-1111-4222-8333-444444444444";
// The label the connections' frozen graphs add, beside the organization's.
const CONNECTION_LABEL_ID: string = "bbbbbbbb-1111-4222-8333-444444444444";
const ORGANIZATION_LABEL_ID: string = "8c1d2e3f-0000-4000-8000-000000000001";
const SEVERITY_IDS: Array<string> = [
  "9d1e2f30-0000-4000-8000-000000000001",
  "9d1e2f30-0000-4000-8000-000000000002",
  "9d1e2f30-0000-4000-8000-000000000003",
];
const RECEIVED_AT: Date = new Date("2026-10-09T10:00:00.000Z");
const REPORT_ID: string = String(HUNTRESS_REPORT_ID);

/*
 * The project's incident severities, with the ids the trigger picks among,
 * and its states: one of its own, Closed, after Resolved.
 */
const WORLD: TemplateWorldOptions = {
  incidentSeverities: [
    { id: SEVERITY_IDS[0], name: "Critical Incident", order: 1 },
    { id: SEVERITY_IDS[1], name: "Major Incident", order: 2 },
    { id: SEVERITY_IDS[2], name: "Minor Incident", order: 3 },
  ],
  incidentStates: [
    { name: "Identified", order: 1 },
    { name: "Acknowledged", order: 2, isAcknowledgedState: true },
    { name: "Resolved", order: 3, isResolvedState: true },
    { name: "Closed", order: 4 },
  ],
};

const PICKS: { [componentId: string]: Array<string> } = {
  "page-on-call-policy-1": [POLICY_ID],
};

const trigger: HuntressWorkflowTrigger = new HuntressWorkflowTrigger();

/*
 * What the Huntress trigger hands the rest of the workflow for one
 * delivery: the body read as the webhook reads it, then the trigger's own
 * run, with the project's severities and the organization's label looked up.
 */
async function triggerValues(
  body: JSONObject,
  settings: JSONObject = {},
): Promise<JSONObject> {
  const parsed: ReturnType<typeof parseHuntressWebhook> =
    parseHuntressWebhook(body);

  if (parsed.kind !== "incident-report") {
    throw new Error("Not an incident report.");
  }

  const result: RunReturnType = await trigger.run(
    {
      ...settings,
      ...getHuntressDeliveryValues({
        event: parsed.event,
        receivedAt: RECEIVED_AT,
      }),
    },
    {
      log: (): void => {},
      workflowLogId: ObjectID.generate(),
      workflowId: ObjectID.generate(),
      projectId: SIMULATED_PROJECT_ID,
      onError: (exception: Exception): Exception => {
        return exception;
      },
      executeWorkflow: async (): Promise<void> => {},
    },
  );

  return result.returnValues;
}

beforeEach(() => {
  jest
    .spyOn(IncidentSeverityService, "findBy")
    .mockImplementation((async () => {
      return SEVERITY_IDS.map((id: string, index: number) => {
        const severity: IncidentSeverity = new IncidentSeverity();
        severity._id = id;
        severity.order = index + 1;
        return severity;
      });
    }) as never);

  jest
    .spyOn(LabelService, "findOrCreateLabelsByNames")
    .mockImplementation((async () => {
      return [new ObjectID(ORGANIZATION_LABEL_ID)];
    }) as never);

  jest.spyOn(WorkflowPrincipal, "getProps").mockImplementation((async (
    data: WorkflowPrincipalOptions,
  ) => {
    return WorkflowPrincipal.getPropsWithoutPlan(data);
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const expectSameOutcome: (run: EquivalenceRun) => void = (
  run: EquivalenceRun,
): void => {
  expect(run.new.world).toEqual(run.old.world);
  expect(run.new.pages).toEqual(run.old.pages);
  expect(run.new.failed).toBe(run.old.failed);
};

// The report's incident, already in the project, in one of its states.
const withIncident: (stateName?: string) => (world: TemplateWorld) => void = (
  stateName?: string,
): ((world: TemplateWorld) => void) => {
  return (world: TemplateWorld): void => {
    world.addIncident({
      customFields: { [HUNTRESS_REPORT_ID_CUSTOM_FIELD]: REPORT_ID },
      stateName: stateName,
      title: "Huntress: Incident on DESKTOP-ARL0EQ1 (Acme Corp)",
    });
  };
};

const templateScenario: (
  body: JSONObject,
  extra?: Partial<EquivalenceScenario>,
  settings?: JSONObject,
) => EquivalenceScenario = (
  body: JSONObject,
  extra?: Partial<EquivalenceScenario>,
  settings?: JSONObject,
): EquivalenceScenario => {
  return {
    templateId: HUNTRESS_INCIDENT_TEMPLATE_ID,
    world: WORLD,
    trigger: async (): Promise<JSONObject> => {
      return await triggerValues(body, settings);
    },
    picks: PICKS,
    ...extra,
  };
};

describe("the template, old and new", () => {
  test.each([
    HuntressSeverity.Critical,
    HuntressSeverity.High,
    HuntressSeverity.Low,
  ])(
    "a new %s report: the same incident, and paged the same",
    async (severity: HuntressSeverity) => {
      const run: EquivalenceRun = await runOldAndNew(
        templateScenario(getHuntressIncidentReportBody({ severity })),
      );

      expectSameOutcome(run);
      expect(run.newWorld.incidents.records.rows).toHaveLength(1);
      expect(run.new.pages).toHaveLength(
        severity === HuntressSeverity.Low ? 0 : 1,
      );
    },
  );

  test("a report that names no severity", async () => {
    const run: EquivalenceRun = await runOldAndNew(
      templateScenario(getHuntressIncidentReportBody({ severity: null })),
    );

    expectSameOutcome(run);
  });

  test("the severity a trigger setting picks", async () => {
    const run: EquivalenceRun = await runOldAndNew(
      templateScenario(
        getHuntressIncidentReportBody(),
        {},
        {
          [HuntressTriggerSetting.CriticalIncidentSeverity]: SEVERITY_IDS[2],
        },
      ),
    );

    expectSameOutcome(run);
  });

  test("a report that has an incident already opens no other, and pages nobody again", async () => {
    const run: EquivalenceRun = await runOldAndNew(
      templateScenario(getHuntressIncidentReportBody(), {
        setUp: withIncident(),
      }),
    );

    expectSameOutcome(run);
    expect(run.newWorld.incidents.records.rows).toHaveLength(1);
  });

  test("a page that reaches nobody: the incident is opened, and the run says something failed", async () => {
    const run: EquivalenceRun = await runOldAndNew(
      templateScenario(getHuntressIncidentReportBody(), { pagingFails: true }),
    );

    expectSameOutcome(run);
    expect(run.new.failed).toBe(true);
  });

  test("a comment is a private note on the report's incident", async () => {
    const run: EquivalenceRun = await runOldAndNew(
      templateScenario(
        getHuntressCommentBody(
          "Contained the host and removed the scheduled task.",
        ),
        { setUp: withIncident() },
      ),
    );

    expectSameOutcome(run);
    expect(run.new.world["incidentNotes"]).toHaveLength(1);
  });

  test("a comment on a report no incident is about writes nothing", async () => {
    const run: EquivalenceRun = await runOldAndNew(
      templateScenario(
        getHuntressCommentBody(
          "Contained the host and removed the scheduled task.",
        ),
      ),
    );

    expectSameOutcome(run);
  });

  test.each(["Identified", "Acknowledged"])(
    "closing the report resolves its %s incident, saying why on its timeline",
    async (stateName: string) => {
      const run: EquivalenceRun = await runOldAndNew(
        templateScenario(getHuntressClosedBody(), {
          setUp: withIncident(stateName),
        }),
      );

      expectSameOutcome(run);
      expect(run.new.world["incidentStateChanges"]).toEqual([
        expect.objectContaining({ state: "Resolved" }),
      ]);
    },
  );

  test.each(["Resolved", "Closed"])(
    "closing the report leaves its %s incident as it is: it never moves back",
    async (stateName: string) => {
      const run: EquivalenceRun = await runOldAndNew(
        templateScenario(getHuntressClosedBody(), {
          setUp: withIncident(stateName),
        }),
      );

      expectSameOutcome(run);
      expect(run.new.world["incidentStateChanges"]).toEqual([]);
    },
  );

  test("closing a report no incident is about resolves nothing", async () => {
    const run: EquivalenceRun = await runOldAndNew(
      templateScenario(getHuntressClosedBody()),
    );

    expectSameOutcome(run);
  });

  test("a project without a resolved state: nothing is written, and the run says something failed", async () => {
    const run: EquivalenceRun = await runOldAndNew(
      templateScenario(getHuntressClosedBody(), {
        setUp: withIncident(),
        world: {
          ...WORLD,
          incidentStates: [
            { name: "Identified", order: 1 },
            { name: "Acknowledged", order: 2, isAcknowledgedState: true },
          ],
        },
      }),
    );

    expectSameOutcome(run);
    expect(run.new.failed).toBe(true);
  });
});

/*
 * The graphs the Huntress connections became, frozen for each setting a
 * connection could have (TemplateGraphsBeforeSimplifying), against the
 * graph the same settings build now.
 */
describe.each([
  "pages-low",
  "pages-high",
  "pages-critical",
  "pages-nobody",
  "notes-closes",
])("a connection's workflow (%s), old and new", (variant: string) => {
  const connection: { options: JSONObject; graph: JSONObject } =
    getHuntressConnectionBeforeSimplifying(variant);
  let counter: number = 0;
  const newGraph: () => JSONObject = (): JSONObject => {
    return buildHuntressIncidentWorkflowGraph(
      connection.options as unknown as HuntressIncidentWorkflowOptions,
      (): string => {
        counter++;
        return `connection-${counter}`;
      },
    );
  };

  const connectionScenario: (
    body: JSONObject,
    setUp?: (world: TemplateWorld) => void,
  ) => EquivalenceScenario = (
    body: JSONObject,
    setUp?: (world: TemplateWorld) => void,
  ): EquivalenceScenario => {
    return {
      templateId: HUNTRESS_INCIDENT_TEMPLATE_ID,
      world: WORLD,
      setUp: setUp,
      trigger: async (): Promise<JSONObject> => {
        return await triggerValues(body);
      },
      oldGraph: getHuntressConnectionBeforeSimplifying(variant).graph,
      newGraph: newGraph(),
    };
  };

  test.each([
    HuntressSeverity.Critical,
    HuntressSeverity.High,
    HuntressSeverity.Low,
  ])(
    "a new %s report: the same incident, with the connection's label, paged the same",
    async (severity: HuntressSeverity) => {
      const run: EquivalenceRun = await runOldAndNew(
        connectionScenario(getHuntressIncidentReportBody({ severity })),
      );

      expectSameOutcome(run);

      const labels: Array<string> = (
        (run.new.world["incidents"] as Array<JSONObject>)[0]?.[
          "labels"
        ] as Array<string>
      ).slice();

      expect(labels).toContain(ORGANIZATION_LABEL_ID);

      if (
        (connection.options["labelIds"] as Array<string> | undefined)?.length
      ) {
        expect(labels).toContain(CONNECTION_LABEL_ID);
      }
    },
  );

  test("a comment is noted alike", async () => {
    const run: EquivalenceRun = await runOldAndNew(
      connectionScenario(
        getHuntressCommentBody(
          "Contained the host and removed the scheduled task.",
        ),
        withIncident(),
      ),
    );

    expectSameOutcome(run);
  });

  test("closing the report is handled alike: resolved, or only noted", async () => {
    const run: EquivalenceRun = await runOldAndNew(
      connectionScenario(getHuntressClosedBody(), withIncident()),
    );

    expectSameOutcome(run);

    if (variant === "notes-closes") {
      expect(run.new.world["incidentStateChanges"]).toEqual([]);
      expect(run.new.world["incidentNotes"]).toHaveLength(1);
    } else {
      expect(run.new.world["incidentStateChanges"]).toHaveLength(1);
    }
  });
});
