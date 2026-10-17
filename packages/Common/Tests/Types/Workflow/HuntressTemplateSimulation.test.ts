/*
 * "Open an incident for each Huntress incident report", run end to end by
 * the template simulator (WorkflowTemplateSimulator): the graph the create
 * wizard builds, its values substituted the way RunWorkflow does, the real
 * Switch / Case, If / Else, Log and Page steps - and the real Huntress
 * Incident Report trigger's run, from a delivery read the way the webhook
 * reads Huntress's body. The database steps answer as the database would,
 * and the paging itself (OnCallPageService.page) is stood in for.
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
 * And the graphs the Huntress connections made before became: one that
 * paged for critical reports only, one that paged nobody, and one that only
 * noted a close.
 */

import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import IncidentSeverityService from "../../../Server/Services/IncidentSeverityService";
import LabelService from "../../../Server/Services/LabelService";
import OnCallPageService, {
  OnCallPageAbout,
  OnCallPageRecordType,
  OnCallPageResult,
  OnCallPageTargets,
} from "../../../Server/Services/OnCallPageService";
import { RunReturnType } from "../../../Server/Types/Workflow/ComponentCode";
import HuntressWorkflowTrigger from "../../../Server/Types/Workflow/Components/Huntress";
import WorkflowPrincipal, {
  WorkflowPrincipalOptions,
} from "../../../Server/Utils/Workflow/WorkflowPrincipal";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import Exception from "../../../Types/Exception/Exception";
import HuntressSeverity, {
  AllHuntressSeverities,
  isHuntressSeverityAtOrAbove,
} from "../../../Types/Huntress/HuntressSeverity";
import { parseHuntressWebhook } from "../../../Types/Huntress/HuntressWebhook";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { PAGE_ARGUMENT_IDS } from "../../../Types/Workflow/Components/OnCallPageSettings";
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
  getHuntressClosedBody,
  getHuntressCommentBody,
  getHuntressIncidentReportBody,
} from "../Huntress/HuntressWebhookFixtures";
import {
  DATABASE_FAILURE,
  DatabaseCall,
  DatabaseReply,
  FakeDatabase,
  SIMULATED_PROJECT_ID,
  SimulationTrace,
  createdWithId,
  found,
  many,
  runTemplate,
} from "./WorkflowTemplateSimulator";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

const INCIDENT_ID: string = "6a1b2c3d-0000-4000-8000-000000000001";
const NOTE_ID: string = "6a1b2c3d-0000-4000-8000-000000000002";
const TIMELINE_ID: string = "6a1b2c3d-0000-4000-8000-000000000003";
const RESOLVED_STATE_ID: string = "6a1b2c3d-0000-4000-8000-000000000004";

/*
 * The project's incident states, as Find Many hands them back: in no
 * particular order, with a state of the project's own after Resolved.
 */
const PROJECT_STATES: Array<JSONObject> = [
  { _id: "6a1b2c3d-0000-4000-8000-000000000014", name: "Closed", order: 4 },
  {
    _id: RESOLVED_STATE_ID,
    name: "Resolved",
    order: 3,
    isResolvedState: true,
  },
  {
    _id: "6a1b2c3d-0000-4000-8000-000000000011",
    name: "Identified",
    order: 1,
  },
  {
    _id: "6a1b2c3d-0000-4000-8000-000000000012",
    name: "Acknowledged",
    order: 2,
  },
];
const POLICY_ID: string = "7b1c2d3e-0000-4000-8000-000000000001";
const OTHER_LABEL_ID: string = "7b1c2d3e-0000-4000-8000-000000000002";
const LABEL_ID: string = "8c1d2e3f-0000-4000-8000-000000000001";
const SEVERITY_IDS: Array<string> = [
  "9d1e2f30-0000-4000-8000-000000000001",
  "9d1e2f30-0000-4000-8000-000000000002",
  "9d1e2f30-0000-4000-8000-000000000003",
];
const RECEIVED_AT: Date = new Date("2026-10-09T10:00:00.000Z");

// As the builder stores a policy picked by name.
const PICKED: JSONObject = {
  "page-on-call-policy-1": { [PAGE_ARGUMENT_IDS.onCallPolicies]: [POLICY_ID] },
};

const trigger: HuntressWorkflowTrigger = new HuntressWorkflowTrigger();

/*
 * What the trigger hands the rest of the workflow for one delivery: the
 * body read as the webhook reads it, then the trigger's own run, with the
 * project's severities and the organization's label looked up.
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
      id: new ObjectID(INCIDENT_ID),
      label: "INC-42",
      title: "Huntress: Incident on DESKTOP-ARL0EQ1 (Acme Corp)",
      url: "https://oneuptime.example.com/dashboard/incidents/42",
      isNew: false,
    },
    paged: [],
    startedPolicies: [
      { onCallDutyPolicyId: new ObjectID(POLICY_ID), name: "SOC" },
    ],
    notPaged: [],
    isAnyonePaged: true,
    directPageExecutionLogId: null,
    summary: summary,
  } as unknown as OnCallPageResult;
}

// The incident a report opened, as Find One Incident hands it back, in one of the project's states.
function openIncident(stateName: string = "Acknowledged"): DatabaseReply {
  const state: JSONObject = PROJECT_STATES.find((candidate: JSONObject) => {
    return candidate["name"] === stateName;
  }) as JSONObject;

  return found({
    _id: INCIDENT_ID,
    incidentNumberWithPrefix: "INC-42",
    currentIncidentState: {
      name: state["name"],
      order: state["order"],
      isResolvedState: state["isResolvedState"] === true,
    },
  });
}

/*
 * The database as a report sees it: no incident yet when it is created
 * (find-incident-0), its incident once it is commented on or closed.
 */
function database(overrides: FakeDatabase = {}): FakeDatabase {
  return {
    "incident-create-one": createdWithId(INCIDENT_ID),
    "incident-find-one": (call: DatabaseCall): DatabaseReply => {
      return call.componentId === "find-incident-0"
        ? found(null)
        : openIncident();
    },
    "incident-internal-note-create-one": createdWithId(NOTE_ID),
    "incident-state-find-many": many(PROJECT_STATES),
    "incident-state-timeline-create-one": createdWithId(TIMELINE_ID),
    ...overrides,
  };
}

async function run(data: {
  body: JSONObject;
  database?: FakeDatabase;
  settings?: JSONObject;
  triggerSettings?: JSONObject;
  graph?: JSONObject;
}): Promise<SimulationTrace> {
  return await runTemplate({
    templateId: HUNTRESS_INCIDENT_TEMPLATE_ID,
    trigger: await triggerValues(data.body, data.triggerSettings),
    variables: {},
    settings: (data.settings || PICKED) as never,
    database: data.database || database(),
    graph: data.graph,
  });
}

function callsTo(
  trace: SimulationTrace,
  componentId: string,
): Array<DatabaseCall> {
  return trace.databaseCalls.filter((call: DatabaseCall): boolean => {
    return call.componentId === componentId;
  });
}

function createdIncident(trace: SimulationTrace): JSONObject {
  const calls: Array<DatabaseCall> = callsTo(trace, "create-incident-1");

  expect(calls).toHaveLength(1);

  return calls[0]!.args["json"] as JSONObject;
}

beforeEach(() => {
  pagesAsked = [];
  pagingFails = false;

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
      return [new ObjectID(LABEL_ID)];
    }) as never);

  jest.spyOn(OnCallPageService, "page").mockImplementation((async (
    request: PageRequest,
  ) => {
    pagesAsked.push(request);

    if (pagingFails) {
      throw new BadDataException(
        "The on-call policy SOC has no escalation rules.",
      );
    }

    return paged("Paged SOC about INC-42.");
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

describe("a new report", () => {
  test("opens one incident, titled after it, at the severity the trigger picked, labelled with its organization, off status pages, holding its number", async () => {
    const trace: SimulationTrace = await run({
      body: getHuntressIncidentReportBody(),
    });

    const incident: JSONObject = createdIncident(trace);

    expect(incident["title"]).toBe(
      "Huntress: Incident on DESKTOP-ARL0EQ1 (Acme Corp)",
    );
    expect(String(incident["description"])).toContain(
      "Huntress detected a malicious scheduled task on this host.",
    );
    expect(incident["incidentSeverityId"]).toBe(SEVERITY_IDS[0]);
    expect(incident["labels"]).toEqual([{ _id: LABEL_ID }]);
    expect(incident["isVisibleOnStatusPage"]).toBe(false);
    expect(
      incident["shouldStatusPageSubscribersBeNotifiedOnIncidentCreated"],
    ).toBe(false);
    expect(incident["customFields"]).toEqual({
      [HUNTRESS_REPORT_ID_CUSTOM_FIELD]: "1234",
    });
  });

  test.each([HuntressSeverity.Critical, HuntressSeverity.High])(
    "a %s report pages the policy picked, about the incident it opened",
    async (severity: HuntressSeverity) => {
      const trace: SimulationTrace = await run({
        body: getHuntressIncidentReportBody({ severity }),
      });

      expect(trace.executed).toEqual([
        "huntress-1",
        "switch-1",
        "find-incident-0",
        "if-found-0",
        "create-incident-1",
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
      expect(pagesAsked[0]!.about.incidentId?.toString()).toBe(INCIDENT_ID);
      expect(trace.logs).toEqual([
        "📟 Opened an incident for Huntress incident report 1234. Paged SOC about INC-42.",
      ]);
    },
  );

  test("a low report opens an incident and pages nobody, saying why", async () => {
    const trace: SimulationTrace = await run({
      body: getHuntressIncidentReportBody({ severity: "low" }),
    });

    expect(createdIncident(trace)["incidentSeverityId"]).toBe(SEVERITY_IDS[2]);
    expect(pagesAsked).toHaveLength(0);
    expect(trace.logs).toEqual([
      "ℹ️ Opened an incident for Huntress incident report 1234. It is low, so nobody was paged.",
    ]);
  });

  test("a report that names no severity is paged for, as high", async () => {
    const trace: SimulationTrace = await run({
      body: getHuntressIncidentReportBody({ severity: null }),
    });

    expect(createdIncident(trace)["incidentSeverityId"]).toBe(SEVERITY_IDS[1]);
    expect(pagesAsked).toHaveLength(1);
  });

  test("the severity a trigger setting picks is the one the incident opens at", async () => {
    const trace: SimulationTrace = await run({
      body: getHuntressIncidentReportBody({ severity: "low" }),
      triggerSettings: {
        [HuntressTriggerSetting.LowIncidentSeverity]: SEVERITY_IDS[0],
      },
    });

    expect(createdIncident(trace)["incidentSeverityId"]).toBe(SEVERITY_IDS[0]);
  });

  test("a report that has an incident already opens no other, and pages nobody again", async () => {
    const trace: SimulationTrace = await run({
      body: getHuntressIncidentReportBody(),
      database: database({ "incident-find-one": openIncident() }),
    });

    expect(trace.executed).toEqual([
      "huntress-1",
      "switch-1",
      "find-incident-0",
      "if-found-0",
      "log-already-open",
    ]);
    expect(callsTo(trace, "find-incident-0")[0]!.args["query"]).toEqual({
      customFields: { [HUNTRESS_REPORT_ID_CUSTOM_FIELD]: "1234" },
    });
    expect(callsTo(trace, "create-incident-1")).toHaveLength(0);
    expect(pagesAsked).toHaveLength(0);
    expect(trace.logs).toEqual([
      "ℹ️ Huntress incident report 1234 has an incident already, INC-42, so no other was opened.",
    ]);
  });

  test("a lookup that fails still opens the incident, and pages: two incidents beat none", async () => {
    const trace: SimulationTrace = await run({
      body: getHuntressIncidentReportBody(),
      database: database({
        "incident-find-one": (call: DatabaseCall): DatabaseReply => {
          return call.componentId === "find-incident-0"
            ? DATABASE_FAILURE
            : openIncident();
        },
      }),
    });

    expect(trace.ports["find-incident-0"]).toBe("error");
    expect(trace.executed).toEqual([
      "huntress-1",
      "switch-1",
      "find-incident-0",
      "log-lookup-failed",
      "create-incident-1",
      "if-page-1",
      "page-on-call-policy-1",
      "log-paged",
    ]);
    expect(callsTo(trace, "create-incident-1")).toHaveLength(1);
    expect(pagesAsked).toHaveLength(1);
    // Whoever finds two incidents for one report reads why in the run log.
    expect(trace.logs).toEqual([
      "⚠️ Could not check whether Huntress incident report 1234 has an incident already, so a new one is opened. Why the check failed is in the run log above.",
      "📟 Opened an incident for Huntress incident report 1234. Paged SOC about INC-42.",
    ]);
  });

  test("an incident that cannot be opened is said in the log, and nobody is paged", async () => {
    const trace: SimulationTrace = await run({
      body: getHuntressIncidentReportBody(),
      database: database({ "incident-create-one": DATABASE_FAILURE }),
    });

    expect(trace.ports["create-incident-1"]).toBe("error");
    expect(pagesAsked).toHaveLength(0);
    expect(trace.logs).toEqual([
      "❌ Could not open an incident for Huntress incident report 1234. Why is in the run log above.",
    ]);
  });

  test("a page that reaches nobody is said in the log, with why", async () => {
    pagingFails = true;

    const trace: SimulationTrace = await run({
      body: getHuntressIncidentReportBody(),
    });

    expect(trace.ports["page-on-call-policy-1"]).toBe("error");
    expect(trace.logs[0]).toMatch(
      /^❌ Opened an incident for Huntress incident report 1234, but nobody was paged: /,
    );
    expect(trace.logs[0]).toContain("has no escalation rules");
  });
});

describe("a comment on the report", () => {
  test("is a private note on the report's incident, found by the report's number", async () => {
    const trace: SimulationTrace = await run({
      body: getHuntressCommentBody("Isolated the host and reset the password."),
    });

    expect(trace.executed).toEqual([
      "huntress-1",
      "switch-1",
      "find-incident-1",
      "if-found-1",
      "add-note-1",
      "log-note-added",
    ]);

    const find: DatabaseCall = callsTo(trace, "find-incident-1")[0]!;

    expect(find.args["query"]).toEqual({
      customFields: { [HUNTRESS_REPORT_ID_CUSTOM_FIELD]: "1234" },
    });

    const note: JSONObject = callsTo(trace, "add-note-1")[0]!.args[
      "json"
    ] as JSONObject;

    expect(note["incidentId"]).toBe(INCIDENT_ID);
    expect(String(note["note"])).toContain(
      "Isolated the host and reset the password.",
    );
    expect(trace.logs).toEqual([
      "✅ Added the comment on Huntress incident report 1234 to INC-42 as a private note.",
    ]);
    expect(pagesAsked).toHaveLength(0);
  });

  test("on a report no incident is about is said in the log, and nothing is written", async () => {
    const trace: SimulationTrace = await run({
      body: getHuntressCommentBody("Anyone there?"),
      database: database({ "incident-find-one": found(null) }),
    });

    expect(callsTo(trace, "add-note-1")).toHaveLength(0);
    expect(trace.logs).toEqual([
      "ℹ️ Huntress incident report 1234 has no incident, so its comment was not added.",
    ]);
  });

  test("whose incident cannot be looked for is said in the log", async () => {
    const trace: SimulationTrace = await run({
      body: getHuntressCommentBody("Anyone there?"),
      database: database({ "incident-find-one": DATABASE_FAILURE }),
    });

    expect(trace.logs).toEqual([
      "❌ Could not look for the incident of Huntress incident report 1234. Why is in the run log above.",
    ]);
  });

  test("whose note cannot be written is said in the log", async () => {
    const trace: SimulationTrace = await run({
      body: getHuntressCommentBody("Anyone there?"),
      database: database({
        "incident-internal-note-create-one": DATABASE_FAILURE,
      }),
    });

    expect(trace.logs).toEqual([
      "❌ Could not add the comment on Huntress incident report 1234 to its incident. Why is in the run log above.",
    ]);
  });
});

describe("closing the report", () => {
  test("resolves its incident, saying why on its timeline", async () => {
    const trace: SimulationTrace = await run({ body: getHuntressClosedBody() });

    expect(trace.executed).toEqual([
      "huntress-1",
      "switch-1",
      "find-incident-2",
      "if-found-2",
      "find-states-1",
      "decide-resolve-1",
      "if-resolve-1",
      "resolve-incident-1",
      "log-resolved",
    ]);
    // The resolved state is found by the rule, among all of them: no record is asked for by its flag.
    expect(
      JSON.stringify(callsTo(trace, "find-states-1")[0]!.args["query"]),
    ).not.toContain("isResolvedState");
    expect(
      callsTo(trace, "resolve-incident-1")[0]!.args["json"] as JSONObject,
    ).toEqual({
      incidentId: INCIDENT_ID,
      incidentStateId: RESOLVED_STATE_ID,
      rootCause: "Huntress closed incident report 1234 (status: closed).",
    });
    expect(trace.logs).toEqual([
      "✅ Resolved INC-42: Huntress closed incident report 1234.",
    ]);
  });

  test.each(["Resolved", "Closed"])(
    "leaves an incident that is %s already as it is: at or past Resolved, it never moves back",
    async (stateName: string) => {
      const trace: SimulationTrace = await run({
        body: getHuntressClosedBody(),
        database: database({ "incident-find-one": openIncident(stateName) }),
      });

      expect(trace.ports["if-resolve-1"]).toBe("no");
      expect(callsTo(trace, "resolve-incident-1")).toHaveLength(0);
      expect(trace.logs).toEqual([
        "ℹ️ INC-42 was already resolved when Huntress closed incident report 1234.",
      ]);
    },
  );

  test("the resolved state is the first one flagged in the project's order, wherever the list puts it", async () => {
    const trace: SimulationTrace = await run({
      body: getHuntressClosedBody(),
      database: database({
        "incident-state-find-many": many([
          ...PROJECT_STATES,
          // A second state flagged resolved, further down: Resolve moves into the first.
          {
            _id: "6a1b2c3d-0000-4000-8000-000000000015",
            name: "Archived",
            order: 5,
            isResolvedState: true,
          },
        ]),
      }),
    });

    expect(
      (callsTo(trace, "resolve-incident-1")[0]!.args["json"] as JSONObject)[
        "incidentStateId"
      ],
    ).toBe(RESOLVED_STATE_ID);
  });

  test("a report first seen already dismissed resolves nothing it never opened", async () => {
    const trace: SimulationTrace = await run({
      body: getHuntressIncidentReportBody({ status: "dismissed" }),
      database: database({ "incident-find-one": found(null) }),
    });

    expect(callsTo(trace, "create-incident-1")).toHaveLength(0);
    expect(trace.logs).toEqual([
      "ℹ️ Huntress incident report 1234 has no incident, so there was nothing to resolve when Huntress closed it.",
    ]);
  });

  test("states that cannot be read are said in the log, and nothing is written", async () => {
    const trace: SimulationTrace = await run({
      body: getHuntressClosedBody(),
      database: database({ "incident-state-find-many": DATABASE_FAILURE }),
    });

    expect(callsTo(trace, "resolve-incident-1")).toHaveLength(0);
    expect(trace.logs).toEqual([
      "❌ Could not read this project's incident states, so INC-42 was not resolved. Why is in the run log above.",
    ]);
  });

  test("a project without a resolved state is said in the log, and nothing is written", async () => {
    const trace: SimulationTrace = await run({
      body: getHuntressClosedBody(),
      database: database({
        "incident-state-find-many": many(
          PROJECT_STATES.filter((state: JSONObject): boolean => {
            return state["isResolvedState"] !== true;
          }),
        ),
      }),
    });

    expect(trace.ports["decide-resolve-1"]).toBe("error");
    expect(callsTo(trace, "resolve-incident-1")).toHaveLength(0);
    expect(trace.logs).toHaveLength(1);
    expect(trace.logs[0]).toContain(
      "❌ Could not tell whether INC-42 is resolved, so it was not resolved:",
    );
    expect(trace.logs[0]).toContain(
      "This project has no resolved incident state.",
    );
  });

  test("a resolution that cannot be written is said in the log", async () => {
    const trace: SimulationTrace = await run({
      body: getHuntressClosedBody(),
      database: database({
        "incident-state-timeline-create-one": DATABASE_FAILURE,
      }),
    });

    expect(trace.logs).toEqual([
      "❌ Could not resolve INC-42 for Huntress incident report 1234. Why is in the run log above.",
    ]);
  });
});

describe("the workflows Huntress connections became", () => {
  function graphFor(options: HuntressIncidentWorkflowOptions): JSONObject {
    let counter: number = 0;

    return buildHuntressIncidentWorkflowGraph(options, (): string => {
      counter++;
      return `moved-${counter}`;
    });
  }

  test.each(
    AllHuntressSeverities.flatMap((threshold: HuntressSeverity) => {
      return AllHuntressSeverities.map((severity: HuntressSeverity) => {
        return [threshold, severity] as [HuntressSeverity, HuntressSeverity];
      });
    }),
  )(
    "one that paged for %s reports and up pages a %s report exactly as the connection did",
    async (threshold: HuntressSeverity, severity: HuntressSeverity) => {
      await run({
        body: getHuntressIncidentReportBody({ severity }),
        settings: {},
        graph: graphFor({
          pages: true,
          onCallPolicyIds: [POLICY_ID],
          pageOnCallFor: threshold,
          labelIds: [OTHER_LABEL_ID],
          resolveWhenClosed: true,
        }),
      });

      expect(pagesAsked.length).toBe(
        isHuntressSeverityAtOrAbove(severity, threshold) ? 1 : 0,
      );
    },
  );

  test("its own labels go on the incident, beside the organization's", async () => {
    const trace: SimulationTrace = await run({
      body: getHuntressIncidentReportBody(),
      settings: {},
      graph: graphFor({
        pages: true,
        onCallPolicyIds: [POLICY_ID],
        pageOnCallFor: HuntressSeverity.High,
        labelIds: [OTHER_LABEL_ID],
        resolveWhenClosed: true,
      }),
    });

    expect(createdIncident(trace)["labels"]).toEqual([
      { _id: LABEL_ID },
      { _id: OTHER_LABEL_ID },
    ]);
  });

  test("one that paged nobody opens the incident and pages nobody", async () => {
    const trace: SimulationTrace = await run({
      body: getHuntressIncidentReportBody(),
      settings: {},
      graph: graphFor({
        pages: false,
        pageOnCallFor: HuntressSeverity.High,
        resolveWhenClosed: true,
      }),
    });

    expect(pagesAsked).toHaveLength(0);
    expect(trace.logs).toEqual([
      "✅ Opened an incident for Huntress incident report 1234.",
    ]);
  });

  test("one that only noted a close notes it, and resolves nothing", async () => {
    const trace: SimulationTrace = await run({
      body: getHuntressClosedBody(),
      settings: {},
      graph: graphFor({
        pages: false,
        pageOnCallFor: HuntressSeverity.High,
        resolveWhenClosed: false,
      }),
    });

    expect(callsTo(trace, "resolve-incident-1")).toHaveLength(0);
    expect(
      (callsTo(trace, "add-note-2")[0]!.args["json"] as JSONObject)["note"],
    ).toBe("Huntress closed incident report 1234 (status: closed).");
    expect(trace.logs).toEqual([
      "✅ Noted on INC-42 that Huntress closed incident report 1234.",
    ]);
  });
});
