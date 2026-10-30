/*
 * "Open an incident for each Huntress incident report", run end to end by
 * the template simulator (WorkflowTemplateSimulator): the graph the create
 * wizard builds, with who was picked to page, its values substituted the
 * way RunWorkflow does, the real Incident From Another Tool, If / Else and
 * Page steps - and the real Huntress Incident Report trigger's run, from a
 * delivery read the way the webhook reads Huntress's body. The project is
 * one held in memory (TemplateWorld), and the paging itself
 * (OnCallPageService.page) is stood in for.
 *
 * One report, followed from start to end:
 *
 *   - created: an incident titled after the report, at the incident
 *     severity the trigger worked out, labelled with the organization, kept
 *     off status pages and holding the report's number - and a page for a
 *     high or critical report, none for a low one;
 *   - comment-added: the comment as a private note on that incident, found
 *     by the report's number;
 *   - closed: the incident resolved, with why, unless it is already.
 *
 * And the graphs the Huntress connections' settings build: one that pages
 * for critical reports only, one that pages nobody, and one that only notes
 * a close. That the four steps do what the 33 did is
 * HuntressTemplateEquivalence's.
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
import { getHuntressDeliveryValues } from "../../../Types/Workflow/HuntressTrigger";
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
  EquivalenceScenario,
  TemplateRun,
  runNewTemplate,
} from "./TemplateEquivalence";
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

const POLICY_ID: string = "7b1c2d3e-0000-4000-8000-000000000001";
const OTHER_LABEL_ID: string = "7b1c2d3e-0000-4000-8000-000000000002";
const ORGANIZATION_LABEL_ID: string = "8c1d2e3f-0000-4000-8000-000000000001";
const SEVERITY_IDS: Array<string> = [
  "9d1e2f30-0000-4000-8000-000000000001",
  "9d1e2f30-0000-4000-8000-000000000002",
  "9d1e2f30-0000-4000-8000-000000000003",
];
const RECEIVED_AT: Date = new Date("2026-10-09T10:00:00.000Z");
const REPORT_ID: string = String(HUNTRESS_REPORT_ID);
const STEP: string = "incident-from-another-tool-1";

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

async function triggerValues(body: JSONObject): Promise<JSONObject> {
  const parsed: ReturnType<typeof parseHuntressWebhook> =
    parseHuntressWebhook(body);

  if (parsed.kind !== "incident-report") {
    throw new Error("Not an incident report.");
  }

  const result: RunReturnType = await trigger.run(
    getHuntressDeliveryValues({ event: parsed.event, receivedAt: RECEIVED_AT }),
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

async function run(
  body: JSONObject,
  extra: Partial<EquivalenceScenario> = {},
): Promise<TemplateRun> {
  return await runNewTemplate({
    templateId: HUNTRESS_INCIDENT_TEMPLATE_ID,
    world: WORLD,
    trigger: async (): Promise<JSONObject> => {
      return await triggerValues(body);
    },
    picks: PICKS,
    ...extra,
  });
}

const incidents: (run: TemplateRun) => Array<JSONObject> = (
  done: TemplateRun,
): Array<JSONObject> => {
  return done.outcome.world["incidents"] as Array<JSONObject>;
};

describe("a new report", () => {
  test("opens one incident, titled after it, at the severity the trigger picked, labelled with its organization, off status pages, holding its number", async () => {
    const done: TemplateRun = await run(getHuntressIncidentReportBody());

    expect(incidents(done)).toEqual([
      expect.objectContaining({
        number: "INC-1",
        title: "Huntress: Incident on DESKTOP-ARL0EQ1 (Acme Corp)",
        severity: "Critical Incident",
        labels: [ORGANIZATION_LABEL_ID],
        customFields: { [HUNTRESS_REPORT_ID_CUSTOM_FIELD]: REPORT_ID },
        isVisibleOnStatusPage: false,
        shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: false,
      }),
    ]);
    expect(done.trace.executed).toEqual([
      "huntress-1",
      STEP,
      "if-page-1",
      "page-on-call-policy-1",
    ]);
    expect(done.trace.ports[STEP]).toBe("opened");
  });

  test.each([HuntressSeverity.Critical, HuntressSeverity.High])(
    "a %s report pages the policy picked, about the new incident",
    async (severity: HuntressSeverity) => {
      const done: TemplateRun = await run(
        getHuntressIncidentReportBody({ severity }),
      );

      expect(done.outcome.pages).toEqual([
        expect.objectContaining({
          policies: [POLICY_ID],
          about: "incident INC-1",
        }),
      ]);
    },
  );

  test("a low report opens an incident and pages nobody, saying why", async () => {
    const done: TemplateRun = await run(
      getHuntressIncidentReportBody({ severity: HuntressSeverity.Low }),
    );

    expect(incidents(done)).toHaveLength(1);
    expect(done.outcome.pages).toEqual([]);
    expect(done.trace.ports["if-page-1"]).toBe("no");
    expect(done.trace.failedSteps).toEqual([]);
  });

  test("with nobody picked to page, the incident is opened and nobody is paged", async () => {
    const done: TemplateRun = await run(getHuntressIncidentReportBody(), {
      picks: {},
    });

    expect(incidents(done)).toHaveLength(1);
    expect(done.outcome.pages).toEqual([]);
    expect(done.trace.executed).toEqual(["huntress-1", STEP]);
  });

  test("a report that has an incident already opens no other, and pages nobody again", async () => {
    const done: TemplateRun = await run(getHuntressIncidentReportBody(), {
      setUp: withIncident(),
    });

    expect(incidents(done)).toHaveLength(1);
    expect(done.outcome.pages).toEqual([]);
    expect(done.trace.portReasons[STEP]).toBe(
      `INC-1 already has huntressReportId ${REPORT_ID}, so no other incident was opened.`,
    );
  });

  test("a page that reaches nobody fails the run at the Page step, and the incident stays opened", async () => {
    const done: TemplateRun = await run(getHuntressIncidentReportBody(), {
      pagingFails: true,
    });

    expect(incidents(done)).toHaveLength(1);
    expect(done.trace.failedSteps).toEqual(["page-on-call-policy-1"]);
  });
});

describe("a comment on the report", () => {
  test("is a private note on the report's incident, found by the report's number", async () => {
    const done: TemplateRun = await run(
      getHuntressCommentBody("Contained the host and removed the task."),
      { setUp: withIncident() },
    );

    expect(done.outcome.world["incidentNotes"]).toEqual([
      {
        record: "INC-1",
        note: expect.stringContaining(
          "Contained the host and removed the task.",
        ),
      },
    ]);
    expect(done.trace.ports[STEP]).toBe("updated");
  });

  test("on a report no incident is about writes nothing, and says why", async () => {
    const done: TemplateRun = await run(
      getHuntressCommentBody("Contained the host."),
    );

    expect(done.outcome.world["incidentNotes"]).toEqual([]);
    expect(done.trace.portReasons[STEP]).toBe(
      `No incident has huntressReportId ${REPORT_ID}, so the note was not added.`,
    );
    expect(done.trace.failedSteps).toEqual([]);
  });

  /*
   * The old template added an empty note, which the database refuses: its
   * run ended in a ❌. An empty comment adds nothing now, and says so.
   */
  test("with no text adds nothing, and says so, rather than fail", async () => {
    const done: TemplateRun = await run(getHuntressCommentBody(""), {
      setUp: withIncident(),
    });

    expect(done.outcome.world["incidentNotes"]).toEqual([]);
    expect(done.trace.ports[STEP]).toBe("unchanged");
    expect(done.trace.portReasons[STEP]).toBe(
      "Note is empty, so nothing was added to INC-1.",
    );
    expect(done.trace.failedSteps).toEqual([]);
  });
});

describe("closing the report", () => {
  test("resolves its incident, saying why on its timeline", async () => {
    const done: TemplateRun = await run(getHuntressClosedBody(), {
      setUp: withIncident("Acknowledged"),
    });

    expect(done.outcome.world["incidentStateChanges"]).toEqual([
      expect.objectContaining({
        record: "INC-1",
        state: "Resolved",
        rootCause: expect.stringContaining("Huntress"),
      }),
    ]);
    expect(incidents(done)[0]?.["state"]).toBe("Resolved");
  });

  test.each(["Resolved", "Closed"])(
    "an incident already %s is left as it is: it never moves back",
    async (stateName: string) => {
      const done: TemplateRun = await run(getHuntressClosedBody(), {
        setUp: withIncident(stateName),
      });

      expect(done.outcome.world["incidentStateChanges"]).toEqual([]);
      expect(done.trace.ports[STEP]).toBe("unchanged");
    },
  );

  test("a report no incident is about resolves nothing", async () => {
    const done: TemplateRun = await run(getHuntressClosedBody());

    expect(done.outcome.world["incidentStateChanges"]).toEqual([]);
    expect(done.trace.failedSteps).toEqual([]);
  });

  test("a project without a resolved state writes nothing, and the run fails saying why", async () => {
    const done: TemplateRun = await run(getHuntressClosedBody(), {
      setUp: withIncident(),
      world: {
        ...WORLD,
        incidentStates: [{ name: "Identified", order: 1 }],
      },
    });

    expect(done.trace.failedSteps).toEqual([STEP]);
    expect(done.trace.portReasons[STEP]).toContain(
      "This project has no resolved incident state.",
    );
  });
});

describe("the workflows a Huntress connection's settings build", () => {
  const connection: (
    options: HuntressIncidentWorkflowOptions,
    body: JSONObject,
    setUp?: (world: TemplateWorld) => void,
  ) => Promise<TemplateRun> = async (
    options: HuntressIncidentWorkflowOptions,
    body: JSONObject,
    setUp?: (world: TemplateWorld) => void,
  ): Promise<TemplateRun> => {
    let counter: number = 0;

    return await run(body, {
      setUp: setUp,
      newGraph: buildHuntressIncidentWorkflowGraph(options, (): string => {
        counter++;
        return `connection-${counter}`;
      }),
    });
  };

  test.each([
    [HuntressSeverity.Critical, HuntressSeverity.Critical, true],
    [HuntressSeverity.Critical, HuntressSeverity.High, false],
    [HuntressSeverity.Low, HuntressSeverity.Low, true],
    [HuntressSeverity.High, HuntressSeverity.Low, false],
  ])(
    "one that pages for %s reports and up, on a %s report, pages: %p",
    async (
      threshold: HuntressSeverity,
      severity: HuntressSeverity,
      pages: boolean,
    ) => {
      const done: TemplateRun = await connection(
        {
          pages: true,
          onCallPolicyIds: [POLICY_ID],
          pageOnCallFor: threshold,
          resolveWhenClosed: true,
        },
        getHuntressIncidentReportBody({ severity }),
      );

      expect(done.outcome.pages).toHaveLength(pages ? 1 : 0);
    },
  );

  test("one that pages for every report has no If / Else", async () => {
    const done: TemplateRun = await connection(
      {
        pages: true,
        onCallPolicyIds: [POLICY_ID],
        pageOnCallFor: HuntressSeverity.Low,
        resolveWhenClosed: true,
      },
      getHuntressIncidentReportBody({ severity: HuntressSeverity.Low }),
    );

    expect(done.trace.executed).toEqual([
      "huntress-1",
      STEP,
      "page-on-call-policy-1",
    ]);
  });

  test("its own labels go on the incident, beside the organization's", async () => {
    const done: TemplateRun = await connection(
      {
        pages: false,
        pageOnCallFor: HuntressSeverity.High,
        labelIds: [OTHER_LABEL_ID],
        resolveWhenClosed: true,
      },
      getHuntressIncidentReportBody(),
    );

    expect(incidents(done)[0]?.["labels"]).toEqual(
      [ORGANIZATION_LABEL_ID, OTHER_LABEL_ID].sort(),
    );
  });

  test("one that paged nobody opens the incident and pages nobody", async () => {
    const done: TemplateRun = await connection(
      {
        pages: false,
        pageOnCallFor: HuntressSeverity.High,
        resolveWhenClosed: true,
      },
      getHuntressIncidentReportBody(),
    );

    expect(incidents(done)).toHaveLength(1);
    expect(done.outcome.pages).toEqual([]);
    expect(done.trace.executed).toEqual(["huntress-1", STEP]);
  });

  test("one that only noted a close notes it, and resolves nothing", async () => {
    const done: TemplateRun = await connection(
      {
        pages: false,
        pageOnCallFor: HuntressSeverity.High,
        resolveWhenClosed: false,
      },
      getHuntressClosedBody(),
      withIncident("Acknowledged"),
    );

    expect(done.outcome.world["incidentStateChanges"]).toEqual([]);
    expect(done.outcome.world["incidentNotes"]).toEqual([
      expect.objectContaining({ record: "INC-1" }),
    ]);
    expect(done.trace.portReasons[STEP]).toBe(
      "Added the note to INC-1, and left it for people to resolve.",
    );
  });
});
