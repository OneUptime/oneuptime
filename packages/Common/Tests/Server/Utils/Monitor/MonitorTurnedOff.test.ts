import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertStateTimeline from "../../../../Models/DatabaseModels/AlertStateTimeline";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentStateTimeline from "../../../../Models/DatabaseModels/IncidentStateTimeline";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import AlertInternalNoteService from "../../../../Server/Services/AlertInternalNoteService";
import AlertService from "../../../../Server/Services/AlertService";
import AlertStateService from "../../../../Server/Services/AlertStateService";
import AlertStateTimelineService from "../../../../Server/Services/AlertStateTimelineService";
import IncidentInternalNoteService from "../../../../Server/Services/IncidentInternalNoteService";
import IncidentPublicNoteService from "../../../../Server/Services/IncidentPublicNoteService";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentStateService from "../../../../Server/Services/IncidentStateService";
import IncidentStateTimelineService from "../../../../Server/Services/IncidentStateTimelineService";
import MonitorService from "../../../../Server/Services/MonitorService";
import UserService from "../../../../Server/Services/UserService";
import logger from "../../../../Server/Utils/Logger";
import MonitorTurnedOff, {
  MonitorTurnedOffResult,
} from "../../../../Server/Utils/Monitor/MonitorTurnedOff";
import { LIMIT_PER_PROJECT } from "../../../../Types/Database/LimitMax";
import Dictionary from "../../../../Types/Dictionary";
import BadDataException from "../../../../Types/Exception/BadDataException";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import ObjectID from "../../../../Types/ObjectID";
import FeedMarkdown, { mdText } from "../../../../Utils/Markdown/FeedMarkdown";
import getJestMockFunction, { MockFunction } from "../../../MockType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * TURNING A MONITOR'S MONITORING OFF RESOLVES WHAT IT WOULD HAVE RESOLVED
 * ITSELF (issue #6400).
 *
 * Nothing checks a monitor while its monitoring is off, so an incident or
 * alert it opened whose criteria resolves it on its own once the monitor
 * recovers stayed open for good. Now those are resolved when monitoring is
 * turned off - exactly those a recovering check would have resolved - with
 * a root cause that names the monitor and who turned it off. Everything else
 * stays open: an incident declared by hand, one whose criteria leaves it to
 * a person, one whose template is not set to resolve.
 *
 * The services are stubbed; what is asked of them, and what is written, is
 * what these tests read.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-0e0e-4aaa-8bbb-000000000001",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "0193c0de-0e0e-4aaa-8bbb-0000000000a1",
);
const USER_ID: ObjectID = new ObjectID("0193c0de-0e0e-4aaa-8bbb-000000000002");
const RESOLVED_INCIDENT_STATE_ID: ObjectID = new ObjectID(
  "0193c0de-0e0e-4aaa-8bbb-0000000000d1",
);
const RESOLVED_ALERT_STATE_ID: ObjectID = new ObjectID(
  "0193c0de-0e0e-4aaa-8bbb-0000000000d2",
);
const UNRESOLVED_INCIDENT_STATE_IDS: Array<ObjectID> = [
  new ObjectID("0193c0de-0e0e-4aaa-8bbb-0000000000e1"),
  new ObjectID("0193c0de-0e0e-4aaa-8bbb-0000000000e2"),
];
const UNRESOLVED_ALERT_STATE_IDS: Array<ObjectID> = [
  new ObjectID("0193c0de-0e0e-4aaa-8bbb-0000000000f1"),
];

// The criteria the monitor's checks open records with, and their templates.
const OFFLINE: string = "criteria-offline";
const DEGRADED: string = "criteria-degraded";
const OFFLINE_INCIDENT_TEMPLATE: string = "template-offline-incident";
const OFFLINE_ALERT_TEMPLATE: string = "template-offline-alert";
const DEGRADED_INCIDENT_TEMPLATE: string = "template-degraded-incident";
const DEGRADED_ALERT_TEMPLATE: string = "template-degraded-alert";

const MONITOR_NAME: string = "Checkout API";
const USER_MARKDOWN: string = "**Ada Lovelace**";

interface TemplateFixture {
  id: string;
  autoResolve: boolean;
}

function criteria(data: {
  id: string;
  incidents?: Array<TemplateFixture>;
  alerts?: Array<TemplateFixture>;
}): MonitorCriteriaInstance {
  return {
    data: {
      id: data.id,
      incidents: (data.incidents || []).map((template: TemplateFixture) => {
        return {
          id: template.id,
          title: "Down",
          description: "",
          autoResolveIncident: template.autoResolve,
        };
      }),
      alerts: (data.alerts || []).map((template: TemplateFixture) => {
        return {
          id: template.id,
          title: "Down",
          description: "",
          autoResolveAlert: template.autoResolve,
        };
      }),
    },
  } as unknown as MonitorCriteriaInstance;
}

function stepsOf(
  criteriaInstances: Array<MonitorCriteriaInstance>,
): MonitorSteps {
  return {
    data: {
      monitorStepsInstanceArray: [
        {
          data: {
            monitorCriteria: {
              data: { monitorCriteriaInstanceArray: criteriaInstances },
            },
          },
        },
      ],
    },
  } as unknown as MonitorSteps;
}

/*
 * The usual monitor: Offline resolves its incident and alert on its own,
 * Degraded leaves both to a person.
 */
function defaultSteps(): MonitorSteps {
  return stepsOf([
    criteria({
      id: OFFLINE,
      incidents: [{ id: OFFLINE_INCIDENT_TEMPLATE, autoResolve: true }],
      alerts: [{ id: OFFLINE_ALERT_TEMPLATE, autoResolve: true }],
    }),
    criteria({
      id: DEGRADED,
      incidents: [{ id: DEGRADED_INCIDENT_TEMPLATE, autoResolve: false }],
      alerts: [{ id: DEGRADED_ALERT_TEMPLATE, autoResolve: false }],
    }),
  ]);
}

let storedMonitor: {
  name: string;
  disableActiveMonitoring: boolean;
  monitorSteps: MonitorSteps;
} | null;

let openIncidents: Array<Incident>;
let openAlerts: Array<Alert>;

let monitorReads: MockFunction;
let incidentReads: MockFunction;
let alertReads: MockFunction;
let incidentTimelines: MockFunction;
let alertTimelines: MockFunction;
let incidentResolvedState: MockFunction;
let alertResolvedState: MockFunction;
let userMarkdown: MockFunction;
let errors: MockFunction;

/*
 * What a person did on a record, by its id: a state change (an acknowledge
 * is one) or a note. Read only when upgrading.
 */
let incidentStateChangesByAPerson: Set<string>;
let incidentInternalNotesByAPerson: Set<string>;
let incidentPublicNotesByAPerson: Set<string>;
let alertStateChangesByAPerson: Set<string>;
let alertNotesByAPerson: Set<string>;
let workedOnReads: Array<{ service: string; query: Dictionary<unknown> }>;

let incidentNumber: number = 0;

function incident(data: {
  criteriaId?: string | undefined;
  templateId?: string | undefined;
}): Incident {
  incidentNumber += 1;
  const row: Incident = new Incident();
  row._id = `0193c0de-0e0e-4aaa-8bbb-${String(incidentNumber).padStart(12, "0")}`;
  row.projectId = PROJECT_ID;
  if (data.criteriaId) {
    row.createdCriteriaId = data.criteriaId;
  }
  if (data.templateId) {
    row.createdIncidentTemplateId = data.templateId;
  }
  return row;
}

function alert(data: { criteriaId?: string | undefined }): Alert {
  incidentNumber += 1;
  const row: Alert = new Alert();
  row._id = `0193c0de-0e0e-4aaa-8ccc-${String(incidentNumber).padStart(12, "0")}`;
  row.projectId = PROJECT_ID;
  if (data.criteriaId) {
    row.createdCriteriaId = data.criteriaId;
  }
  return row;
}

beforeEach(() => {
  storedMonitor = {
    name: MONITOR_NAME,
    disableActiveMonitoring: true,
    monitorSteps: defaultSteps(),
  };
  openIncidents = [];
  openAlerts = [];

  monitorReads = getJestMockFunction();
  monitorReads.mockImplementation(async (): Promise<Monitor | null> => {
    if (!storedMonitor) {
      return null;
    }

    const row: Monitor = new Monitor();
    row._id = MONITOR_ID.toString();
    row.projectId = PROJECT_ID;
    row.name = storedMonitor.name;
    row.disableActiveMonitoring = storedMonitor.disableActiveMonitoring;
    row.monitorSteps = storedMonitor.monitorSteps;
    return row;
  });
  jest
    .spyOn(MonitorService, "findOneById")
    .mockImplementation(monitorReads as never);

  jest
    .spyOn(IncidentStateService, "getUnresolvedIncidentStateIds")
    .mockResolvedValue(UNRESOLVED_INCIDENT_STATE_IDS as never);
  jest
    .spyOn(AlertStateService, "getUnresolvedAlertStateIds")
    .mockResolvedValue(UNRESOLVED_ALERT_STATE_IDS as never);

  incidentReads = getJestMockFunction();
  incidentReads.mockImplementation(async (): Promise<Array<Incident>> => {
    return openIncidents;
  });
  jest
    .spyOn(IncidentService, "findBy")
    .mockImplementation(incidentReads as never);

  alertReads = getJestMockFunction();
  alertReads.mockImplementation(async (): Promise<Array<Alert>> => {
    return openAlerts;
  });
  jest.spyOn(AlertService, "findBy").mockImplementation(alertReads as never);

  incidentResolvedState = getJestMockFunction();
  incidentResolvedState.mockResolvedValue(RESOLVED_INCIDENT_STATE_ID as never);
  jest
    .spyOn(IncidentStateTimelineService, "getResolvedStateIdForProject")
    .mockImplementation(incidentResolvedState as never);

  alertResolvedState = getJestMockFunction();
  alertResolvedState.mockResolvedValue(RESOLVED_ALERT_STATE_ID as never);
  jest
    .spyOn(AlertStateTimelineService, "getResolvedStateIdForProject")
    .mockImplementation(alertResolvedState as never);

  incidentTimelines = getJestMockFunction();
  incidentTimelines.mockImplementation(async (createBy: unknown) => {
    return (createBy as { data: IncidentStateTimeline }).data;
  });
  jest
    .spyOn(IncidentStateTimelineService, "create")
    .mockImplementation(incidentTimelines as never);

  alertTimelines = getJestMockFunction();
  alertTimelines.mockImplementation(async (createBy: unknown) => {
    return (createBy as { data: AlertStateTimeline }).data;
  });
  jest
    .spyOn(AlertStateTimelineService, "create")
    .mockImplementation(alertTimelines as never);

  userMarkdown = getJestMockFunction();
  userMarkdown.mockResolvedValue(mdText`**Ada Lovelace**` as never);
  jest
    .spyOn(UserService, "getUserMarkdownString")
    .mockImplementation(userMarkdown as never);

  errors = getJestMockFunction();
  jest.spyOn(logger, "error").mockImplementation(errors as never);

  incidentStateChangesByAPerson = new Set<string>();
  incidentInternalNotesByAPerson = new Set<string>();
  incidentPublicNotesByAPerson = new Set<string>();
  alertStateChangesByAPerson = new Set<string>();
  alertNotesByAPerson = new Set<string>();
  workedOnReads = [];

  const workedOn: (
    service: string,
    idColumn: "incidentId" | "alertId",
    byAPerson: () => Set<string>,
  ) => (findOneBy: unknown) => Promise<{ _id: string } | null> = (
    service: string,
    idColumn: "incidentId" | "alertId",
    byAPerson: () => Set<string>,
  ): ((findOneBy: unknown) => Promise<{ _id: string } | null>) => {
    return async (findOneBy: unknown): Promise<{ _id: string } | null> => {
      const query: Dictionary<unknown> = (
        findOneBy as { query: Dictionary<unknown> }
      ).query;
      workedOnReads.push({ service: service, query: query });
      return byAPerson().has(String(query[idColumn]))
        ? { _id: "by-a-person" }
        : null;
    };
  };

  jest.spyOn(IncidentStateTimelineService, "findOneBy").mockImplementation(
    workedOn("IncidentStateTimeline", "incidentId", () => {
      return incidentStateChangesByAPerson;
    }) as never,
  );
  jest.spyOn(IncidentInternalNoteService, "findOneBy").mockImplementation(
    workedOn("IncidentInternalNote", "incidentId", () => {
      return incidentInternalNotesByAPerson;
    }) as never,
  );
  jest.spyOn(IncidentPublicNoteService, "findOneBy").mockImplementation(
    workedOn("IncidentPublicNote", "incidentId", () => {
      return incidentPublicNotesByAPerson;
    }) as never,
  );
  jest.spyOn(AlertStateTimelineService, "findOneBy").mockImplementation(
    workedOn("AlertStateTimeline", "alertId", () => {
      return alertStateChangesByAPerson;
    }) as never,
  );
  jest.spyOn(AlertInternalNoteService, "findOneBy").mockImplementation(
    workedOn("AlertInternalNote", "alertId", () => {
      return alertNotesByAPerson;
    }) as never,
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function turnOff(
  turnedOffByUserId: ObjectID | null = USER_ID,
): Promise<MonitorTurnedOffResult> {
  return await MonitorTurnedOff.resolveWhatItWouldHaveResolved({
    monitorId: MONITOR_ID,
    turnedOffByUserId: turnedOffByUserId,
  });
}

// The upgrade's data migration, for a monitor already off (issue #6479).
async function upgrade(): Promise<MonitorTurnedOffResult> {
  return await MonitorTurnedOff.resolveWhatItWouldHaveResolved({
    monitorId: MONITOR_ID,
    isUpgrade: true,
  });
}

interface WrittenTimeline {
  recordId: string;
  stateId: string;
  projectId: string;
  rootCause: string;
  props: Dictionary<unknown>;
}

function writtenIncidentTimelines(): Array<WrittenTimeline> {
  return incidentTimelines.mock.calls.map((call: Array<unknown>) => {
    const createBy: {
      data: IncidentStateTimeline;
      props: Dictionary<unknown>;
    } = call[0] as { data: IncidentStateTimeline; props: Dictionary<unknown> };
    return {
      recordId: createBy.data.incidentId!.toString(),
      stateId: createBy.data.incidentStateId!.toString(),
      projectId: createBy.data.projectId!.toString(),
      rootCause: createBy.data.rootCause!,
      props: createBy.props,
    };
  });
}

function writtenAlertTimelines(): Array<WrittenTimeline> {
  return alertTimelines.mock.calls.map((call: Array<unknown>) => {
    const createBy: { data: AlertStateTimeline; props: Dictionary<unknown> } =
      call[0] as { data: AlertStateTimeline; props: Dictionary<unknown> };
    return {
      recordId: createBy.data.alertId!.toString(),
      stateId: createBy.data.alertStateId!.toString(),
      projectId: createBy.data.projectId!.toString(),
      rootCause: createBy.data.rootCause!,
      props: createBy.props,
    };
  });
}

describe("which incidents are resolved", () => {
  test("an open incident the monitor opened with a template set to auto-resolve is resolved", async () => {
    const opened: Incident = incident({
      criteriaId: OFFLINE,
      templateId: OFFLINE_INCIDENT_TEMPLATE,
    });
    openIncidents = [opened];

    const result: MonitorTurnedOffResult = await turnOff();

    expect(result.resolvedIncidentIds).toEqual([opened.id!.toString()]);
    expect(writtenIncidentTimelines()).toEqual([
      {
        recordId: opened.id!.toString(),
        stateId: RESOLVED_INCIDENT_STATE_ID.toString(),
        projectId: PROJECT_ID.toString(),
        rootCause: expect.any(String),
        // OneUptime's own change: no person becomes the incident's commander.
        props: { isRoot: true },
      },
    ]);
  });

  test("one whose criteria leaves it to a person stays open", async () => {
    openIncidents = [
      incident({
        criteriaId: DEGRADED,
        templateId: DEGRADED_INCIDENT_TEMPLATE,
      }),
    ];

    const result: MonitorTurnedOffResult = await turnOff();

    expect(result.resolvedIncidentIds).toEqual([]);
    expect(incidentTimelines).not.toHaveBeenCalled();
    // Nothing to resolve: the resolved state is not even looked up.
    expect(incidentResolvedState).not.toHaveBeenCalled();
  });

  test("one declared by hand - no criteria opened it - stays open", async () => {
    openIncidents = [incident({})];

    expect((await turnOff()).resolvedIncidentIds).toEqual([]);
    expect(incidentTimelines).not.toHaveBeenCalled();
  });

  test("one opened by another template of the same criteria, not set to auto-resolve, stays open", async () => {
    storedMonitor!.monitorSteps = stepsOf([
      criteria({
        id: OFFLINE,
        incidents: [
          { id: OFFLINE_INCIDENT_TEMPLATE, autoResolve: true },
          { id: "template-escalation", autoResolve: false },
        ],
      }),
    ]);
    const autoResolving: Incident = incident({
      criteriaId: OFFLINE,
      templateId: OFFLINE_INCIDENT_TEMPLATE,
    });
    openIncidents = [
      autoResolving,
      incident({ criteriaId: OFFLINE, templateId: "template-escalation" }),
    ];

    expect((await turnOff()).resolvedIncidentIds).toEqual([
      autoResolving.id!.toString(),
    ]);
  });

  test("one whose criteria is gone from the monitor stays open: nothing would resolve it", async () => {
    openIncidents = [
      incident({
        criteriaId: "criteria-removed",
        templateId: "template-removed",
      }),
    ];

    expect((await turnOff()).resolvedIncidentIds).toEqual([]);
  });

  test("one opened before templates had ids is matched on its criteria, as a check matches it", async () => {
    const legacy: Incident = incident({ criteriaId: OFFLINE });
    openIncidents = [legacy];

    expect((await turnOff()).resolvedIncidentIds).toEqual([
      legacy.id!.toString(),
    ]);
  });

  test("reads the monitor's open incidents as a check reads them: by the monitor, in an unresolved state", async () => {
    openIncidents = [
      incident({ criteriaId: OFFLINE, templateId: OFFLINE_INCIDENT_TEMPLATE }),
    ];

    await turnOff();

    expect(incidentReads).toHaveBeenCalledTimes(1);
    const findBy: {
      query: Dictionary<unknown>;
      select: Dictionary<unknown>;
      limit: number;
      skip: number;
      props: Dictionary<unknown>;
    } = incidentReads.mock.calls[0]![0] as {
      query: Dictionary<unknown>;
      select: Dictionary<unknown>;
      limit: number;
      skip: number;
      props: Dictionary<unknown>;
    };

    expect(findBy.query["monitors"]).toEqual([MONITOR_ID]);
    expect(findBy.query["projectId"]).toEqual(PROJECT_ID);
    expect(JSON.stringify(findBy.query["currentIncidentStateId"])).toContain(
      UNRESOLVED_INCIDENT_STATE_IDS[1]!.toString(),
    );
    expect(findBy.select).toEqual({
      _id: true,
      projectId: true,
      createdCriteriaId: true,
      createdIncidentTemplateId: true,
    });
    expect(findBy.limit).toBe(LIMIT_PER_PROJECT);
    expect(findBy.skip).toBe(0);
    expect(findBy.props).toEqual({ isRoot: true });
  });
});

describe("which alerts are resolved", () => {
  test("an open alert the monitor opened with a criteria set to auto-resolve is resolved; the others stay open", async () => {
    const autoResolving: Alert = alert({ criteriaId: OFFLINE });
    openAlerts = [autoResolving, alert({ criteriaId: DEGRADED }), alert({})];

    const result: MonitorTurnedOffResult = await turnOff();

    expect(result.resolvedAlertIds).toEqual([autoResolving.id!.toString()]);
    expect(writtenAlertTimelines()).toEqual([
      {
        recordId: autoResolving.id!.toString(),
        stateId: RESOLVED_ALERT_STATE_ID.toString(),
        projectId: PROJECT_ID.toString(),
        rootCause: expect.any(String),
        props: { isRoot: true },
      },
    ]);
  });

  test("reads the monitor's own open alerts, in an unresolved state", async () => {
    openAlerts = [alert({ criteriaId: OFFLINE })];

    await turnOff();

    const findBy: { query: Dictionary<unknown>; props: Dictionary<unknown> } =
      alertReads.mock.calls[0]![0] as {
        query: Dictionary<unknown>;
        props: Dictionary<unknown>;
      };

    expect(findBy.query["monitorId"]).toEqual(MONITOR_ID);
    expect(findBy.query["projectId"]).toEqual(PROJECT_ID);
    expect(JSON.stringify(findBy.query["currentAlertStateId"])).toContain(
      UNRESOLVED_ALERT_STATE_IDS[0]!.toString(),
    );
    expect(findBy.props).toEqual({ isRoot: true });
  });

  test("incidents and alerts are resolved together", async () => {
    openIncidents = [
      incident({ criteriaId: OFFLINE, templateId: OFFLINE_INCIDENT_TEMPLATE }),
      incident({ criteriaId: OFFLINE, templateId: OFFLINE_INCIDENT_TEMPLATE }),
    ];
    openAlerts = [alert({ criteriaId: OFFLINE })];

    const result: MonitorTurnedOffResult = await turnOff();

    expect(result.resolvedIncidentIds).toHaveLength(2);
    expect(result.resolvedAlertIds).toHaveLength(1);
    // The person is read once for all of them.
    expect(userMarkdown).toHaveBeenCalledTimes(1);
    expect(userMarkdown).toHaveBeenCalledWith({
      userId: USER_ID,
      projectId: PROJECT_ID,
    });
  });
});

describe("when nothing is resolved", () => {
  test("a monitor whose monitoring is on again by now: a check looks after its records", async () => {
    storedMonitor!.disableActiveMonitoring = false;
    openIncidents = [
      incident({ criteriaId: OFFLINE, templateId: OFFLINE_INCIDENT_TEMPLATE }),
    ];

    expect(await turnOff()).toEqual({
      resolvedIncidentIds: [],
      resolvedAlertIds: [],
    });
    expect(incidentReads).not.toHaveBeenCalled();
    expect(alertReads).not.toHaveBeenCalled();
  });

  test("a monitor that is gone", async () => {
    storedMonitor = null;

    expect(await turnOff()).toEqual({
      resolvedIncidentIds: [],
      resolvedAlertIds: [],
    });
    expect(incidentReads).not.toHaveBeenCalled();
  });

  test("a monitor none of whose criteria resolves anything on its own reads no incident or alert", async () => {
    storedMonitor!.monitorSteps = stepsOf([
      criteria({
        id: DEGRADED,
        incidents: [{ id: DEGRADED_INCIDENT_TEMPLATE, autoResolve: false }],
      }),
    ]);

    await turnOff();

    expect(incidentReads).not.toHaveBeenCalled();
    expect(alertReads).not.toHaveBeenCalled();
    expect(userMarkdown).not.toHaveBeenCalled();
  });

  test("a monitor whose criteria resolve only alerts reads no incidents", async () => {
    storedMonitor!.monitorSteps = stepsOf([
      criteria({
        id: OFFLINE,
        alerts: [{ id: OFFLINE_ALERT_TEMPLATE, autoResolve: true }],
      }),
    ]);
    openAlerts = [alert({ criteriaId: OFFLINE })];

    const result: MonitorTurnedOffResult = await turnOff();

    expect(incidentReads).not.toHaveBeenCalled();
    expect(result.resolvedAlertIds).toHaveLength(1);
  });

  test("the person who turned it off is not read when nothing is resolved", async () => {
    openIncidents = [incident({})];

    await turnOff();

    expect(userMarkdown).not.toHaveBeenCalled();
  });

  test("the monitor is read as OneUptime, with its switch and its steps", async () => {
    await turnOff();

    expect(monitorReads).toHaveBeenCalledWith({
      id: MONITOR_ID,
      select: {
        _id: true,
        projectId: true,
        name: true,
        monitorSteps: true,
        disableActiveMonitoring: true,
      },
      props: { isRoot: true },
    });
  });
});

describe("why it was resolved: the root cause", () => {
  test("names the person who turned monitoring off and the monitor", async () => {
    openIncidents = [
      incident({ criteriaId: OFFLINE, templateId: OFFLINE_INCIDENT_TEMPLATE }),
    ];

    await turnOff();

    expect(writtenIncidentTimelines()[0]!.rootCause).toBe(
      `${USER_MARKDOWN} turned off monitoring for the monitor **${MONITOR_NAME}**. This incident was set to resolve on its own once the monitor recovered, and nothing checks the monitor while its monitoring is off, so it was resolved now. If monitoring is turned back on while the problem is still there, a new incident is opened.`,
    );
  });

  test("an alert's says so of an alert", async () => {
    openAlerts = [alert({ criteriaId: OFFLINE })];

    await turnOff();

    expect(writtenAlertTimelines()[0]!.rootCause).toBe(
      `${USER_MARKDOWN} turned off monitoring for the monitor **${MONITOR_NAME}**. This alert was set to resolve on its own once the monitor recovered, and nothing checks the monitor while its monitoring is off, so it was resolved now. If monitoring is turned back on while the problem is still there, a new alert is opened.`,
    );
  });

  test("turned off by no person - an API key, a policy - it names none", async () => {
    openIncidents = [
      incident({ criteriaId: OFFLINE, templateId: OFFLINE_INCIDENT_TEMPLATE }),
    ];

    await turnOff(null);

    expect(userMarkdown).not.toHaveBeenCalled();
    expect(writtenIncidentTimelines()[0]!.rootCause).toMatch(
      new RegExp(
        `^Monitoring was turned off for the monitor \\*\\*${MONITOR_NAME}\\*\\*\\. This incident was set to resolve on its own`,
      ),
    );
  });

  test("a person who cannot be named reads as no person", () => {
    expect(
      MonitorTurnedOff.getRootCause({
        kind: "incident",
        monitorName: MONITOR_NAME,
        turnedOffBy: FeedMarkdown.empty(),
      }),
    ).toMatch(
      /^Monitoring was turned off for the monitor \*\*Checkout API\*\*\./,
    );
  });

  test("the monitor's name is placed as text: Markdown in it does not become formatting", () => {
    const rootCause: string = MonitorTurnedOff.getRootCause({
      kind: "incident",
      monitorName: "API **prod** [eu](https://evil.example)",
      turnedOffBy: FeedMarkdown.empty(),
    });

    // Escaped: no bold, and the brackets make no link.
    expect(rootCause).toContain(
      "**API \\*\\*prod\\*\\* \\[eu\\](https://evil.example)**",
    );
    expect(rootCause).not.toContain(" **prod** ");
    expect(rootCause).not.toContain("[eu](");
  });
});

describe("one record that fails does not stop the others", () => {
  test("an incident resolved meanwhile - by a person, or a check on its way - is skipped quietly", async () => {
    const resolvedMeanwhile: Incident = incident({
      criteriaId: OFFLINE,
      templateId: OFFLINE_INCIDENT_TEMPLATE,
    });
    const stillOpen: Incident = incident({
      criteriaId: OFFLINE,
      templateId: OFFLINE_INCIDENT_TEMPLATE,
    });
    openIncidents = [resolvedMeanwhile, stillOpen];

    incidentTimelines.mockImplementation(async (createBy: unknown) => {
      const data: IncidentStateTimeline = (
        createBy as { data: IncidentStateTimeline }
      ).data;
      if (data.incidentId!.toString() === resolvedMeanwhile.id!.toString()) {
        throw new BadDataException(
          "Incident state cannot be same as previous state.",
        );
      }
      return data;
    });

    const result: MonitorTurnedOffResult = await turnOff();

    expect(result.resolvedIncidentIds).toEqual([stillOpen.id!.toString()]);
    expect(errors).not.toHaveBeenCalled();
  });

  test("an alert resolved meanwhile is skipped quietly too", async () => {
    openAlerts = [alert({ criteriaId: OFFLINE })];
    alertTimelines.mockRejectedValue(
      new BadDataException(
        "Alert state cannot be same as previous state.",
      ) as never,
    );

    expect((await turnOff()).resolvedAlertIds).toEqual([]);
    expect(errors).not.toHaveBeenCalled();
  });

  test("any other failure is logged, and the next record is still resolved", async () => {
    const failing: Incident = incident({
      criteriaId: OFFLINE,
      templateId: OFFLINE_INCIDENT_TEMPLATE,
    });
    const next: Incident = incident({
      criteriaId: OFFLINE,
      templateId: OFFLINE_INCIDENT_TEMPLATE,
    });
    openIncidents = [failing, next];

    incidentTimelines.mockImplementation(async (createBy: unknown) => {
      const data: IncidentStateTimeline = (
        createBy as { data: IncidentStateTimeline }
      ).data;
      if (data.incidentId!.toString() === failing.id!.toString()) {
        throw new Error("connection reset");
      }
      return data;
    });

    const result: MonitorTurnedOffResult = await turnOff();

    expect(result.resolvedIncidentIds).toEqual([next.id!.toString()]);
    expect(errors).toHaveBeenCalled();
  });

  test("incidents that cannot be read do not stop the alerts", async () => {
    incidentReads.mockRejectedValue(new Error("database is down") as never);
    openAlerts = [alert({ criteriaId: OFFLINE })];

    const result: MonitorTurnedOffResult = await turnOff();

    expect(result.resolvedIncidentIds).toEqual([]);
    expect(result.resolvedAlertIds).toHaveLength(1);
    expect(errors).toHaveBeenCalled();
  });

  test("a project with no resolved state resolves nothing and throws nothing", async () => {
    openIncidents = [
      incident({ criteriaId: OFFLINE, templateId: OFFLINE_INCIDENT_TEMPLATE }),
    ];
    incidentResolvedState.mockRejectedValue(
      new BadDataException(
        "Resolved state not found for this project.",
      ) as never,
    );

    await expect(turnOff()).resolves.toEqual({
      resolvedIncidentIds: [],
      resolvedAlertIds: [],
    });
    expect(incidentTimelines).not.toHaveBeenCalled();
  });
});

/*
 * WHEN ONEUPTIME IS UPGRADED (issue #6479): the data migration resolves what
 * monitors turned off before the switch did this had left open. The same
 * records as the switch - and never what a person has worked on, since
 * nobody is there to decide - with a root cause that says it happened at
 * the upgrade.
 */
describe("when OneUptime is upgraded", () => {
  test("an untouched incident and alert the monitor would have resolved are resolved", async () => {
    const opened: Incident = incident({
      criteriaId: OFFLINE,
      templateId: OFFLINE_INCIDENT_TEMPLATE,
    });
    const raised: Alert = alert({ criteriaId: OFFLINE });
    openIncidents = [opened];
    openAlerts = [raised];

    expect(await upgrade()).toEqual({
      resolvedIncidentIds: [opened.id!.toString()],
      resolvedAlertIds: [raised.id!.toString()],
      leftForAPersonIncidentIds: [],
      leftForAPersonAlertIds: [],
    });
    expect(writtenIncidentTimelines()).toEqual([
      {
        recordId: opened.id!.toString(),
        stateId: RESOLVED_INCIDENT_STATE_ID.toString(),
        projectId: PROJECT_ID.toString(),
        rootCause: expect.any(String),
        props: { isRoot: true },
      },
    ]);
    expect(writtenAlertTimelines()).toHaveLength(1);
  });

  test("its root cause says it was resolved when OneUptime was upgraded, not that monitoring was turned off now", async () => {
    openIncidents = [
      incident({ criteriaId: OFFLINE, templateId: OFFLINE_INCIDENT_TEMPLATE }),
    ];
    openAlerts = [alert({ criteriaId: OFFLINE })];

    await upgrade();

    expect(writtenIncidentTimelines()[0]!.rootCause).toBe(
      `Monitoring is off for the monitor **${MONITOR_NAME}**. This incident was set to resolve on its own once the monitor recovered, and nothing checks the monitor while its monitoring is off, so it was resolved when OneUptime was upgraded. If monitoring is turned back on while the problem is still there, a new incident is opened.`,
    );
    expect(writtenAlertTimelines()[0]!.rootCause).toBe(
      `Monitoring is off for the monitor **${MONITOR_NAME}**. This alert was set to resolve on its own once the monitor recovered, and nothing checks the monitor while its monitoring is off, so it was resolved when OneUptime was upgraded. If monitoring is turned back on while the problem is still there, a new alert is opened.`,
    );
    // Nobody turned it off now: no person is read or named.
    expect(userMarkdown).not.toHaveBeenCalled();
    expect(writtenIncidentTimelines()[0]!.rootCause).not.toContain(
      "turned off monitoring",
    );
  });

  test("the monitor's name is placed as text in the upgrade's root cause too", () => {
    const rootCause: string = MonitorTurnedOff.getRootCause({
      kind: "incident",
      monitorName: "API **prod** [eu](https://evil.example)",
      turnedOffBy: FeedMarkdown.empty(),
      isUpgrade: true,
    });

    expect(rootCause).toContain(
      "**API \\*\\*prod\\*\\* \\[eu\\](https://evil.example)**",
    );
    expect(rootCause).not.toContain("[eu](");
  });

  test("an incident a person moved - acknowledged, say - stays open for them", async () => {
    const acknowledged: Incident = incident({
      criteriaId: OFFLINE,
      templateId: OFFLINE_INCIDENT_TEMPLATE,
    });
    const untouched: Incident = incident({
      criteriaId: OFFLINE,
      templateId: OFFLINE_INCIDENT_TEMPLATE,
    });
    openIncidents = [acknowledged, untouched];
    incidentStateChangesByAPerson.add(acknowledged.id!.toString());

    const result: MonitorTurnedOffResult = await upgrade();

    expect(result.resolvedIncidentIds).toEqual([untouched.id!.toString()]);
    expect(result.leftForAPersonIncidentIds).toEqual([
      acknowledged.id!.toString(),
    ]);
    expect(
      writtenIncidentTimelines().map((written: WrittenTimeline): string => {
        return written.recordId;
      }),
    ).toEqual([untouched.id!.toString()]);
  });

  test("an incident a person wrote a note on - internal or on a status page - stays open for them", async () => {
    const internalNote: Incident = incident({
      criteriaId: OFFLINE,
      templateId: OFFLINE_INCIDENT_TEMPLATE,
    });
    const publicNote: Incident = incident({
      criteriaId: OFFLINE,
      templateId: OFFLINE_INCIDENT_TEMPLATE,
    });
    openIncidents = [internalNote, publicNote];
    incidentInternalNotesByAPerson.add(internalNote.id!.toString());
    incidentPublicNotesByAPerson.add(publicNote.id!.toString());

    const result: MonitorTurnedOffResult = await upgrade();

    expect(result.resolvedIncidentIds).toEqual([]);
    expect(result.leftForAPersonIncidentIds).toEqual([
      internalNote.id!.toString(),
      publicNote.id!.toString(),
    ]);
    expect(incidentTimelines).not.toHaveBeenCalled();
    // Nothing to resolve: the resolved state is not even looked up.
    expect(incidentResolvedState).not.toHaveBeenCalled();
  });

  test("an alert a person moved or wrote a note on stays open for them", async () => {
    const acknowledged: Alert = alert({ criteriaId: OFFLINE });
    const noted: Alert = alert({ criteriaId: OFFLINE });
    const untouched: Alert = alert({ criteriaId: OFFLINE });
    openAlerts = [acknowledged, noted, untouched];
    alertStateChangesByAPerson.add(acknowledged.id!.toString());
    alertNotesByAPerson.add(noted.id!.toString());

    const result: MonitorTurnedOffResult = await upgrade();

    expect(result.resolvedAlertIds).toEqual([untouched.id!.toString()]);
    expect(result.leftForAPersonAlertIds).toEqual([
      acknowledged.id!.toString(),
      noted.id!.toString(),
    ]);
  });

  test("whether a person worked on it is read one record at a time, by its id and a creator who is a person, as OneUptime", async () => {
    const opened: Incident = incident({
      criteriaId: OFFLINE,
      templateId: OFFLINE_INCIDENT_TEMPLATE,
    });
    const raised: Alert = alert({ criteriaId: OFFLINE });
    openIncidents = [opened];
    openAlerts = [raised];

    await upgrade();

    expect(
      workedOnReads.map(
        (read: { service: string; query: Dictionary<unknown> }): string => {
          return read.service;
        },
      ),
    ).toEqual([
      "IncidentStateTimeline",
      "IncidentInternalNote",
      "IncidentPublicNote",
      "AlertStateTimeline",
      "AlertInternalNote",
    ]);

    for (const read of workedOnReads) {
      const recordId: unknown =
        read.query["incidentId"] || read.query["alertId"];

      expect([opened.id!.toString(), raised.id!.toString()]).toContain(
        String(recordId),
      );
      // createdByUserId IS NOT NULL: a row OneUptime wrote names nobody.
      expect(read.query["createdByUserId"]).toBeDefined();
    }

    const findOneBy: {
      select: Dictionary<unknown>;
      props: Dictionary<unknown>;
    } = jest.mocked(IncidentStateTimelineService.findOneBy).mock
      .calls[0]![0] as unknown as {
      select: Dictionary<unknown>;
      props: Dictionary<unknown>;
    };

    expect(findOneBy.select).toEqual({ _id: true });
    expect(findOneBy.props).toEqual({ isRoot: true });
  });

  test("a state change by a person is enough: the notes are not read then", async () => {
    const acknowledged: Incident = incident({
      criteriaId: OFFLINE,
      templateId: OFFLINE_INCIDENT_TEMPLATE,
    });
    openIncidents = [acknowledged];
    incidentStateChangesByAPerson.add(acknowledged.id!.toString());

    await upgrade();

    expect(
      workedOnReads.map(
        (read: { service: string; query: Dictionary<unknown> }): string => {
          return read.service;
        },
      ),
    ).toEqual(["IncidentStateTimeline"]);
  });

  test("a record whose history cannot be read stays open, and the failure is logged", async () => {
    const unreadable: Incident = incident({
      criteriaId: OFFLINE,
      templateId: OFFLINE_INCIDENT_TEMPLATE,
    });
    const readable: Incident = incident({
      criteriaId: OFFLINE,
      templateId: OFFLINE_INCIDENT_TEMPLATE,
    });
    openIncidents = [unreadable, readable];

    jest
      .mocked(IncidentInternalNoteService.findOneBy)
      .mockImplementation((async (findOneBy: unknown) => {
        const query: Dictionary<unknown> = (
          findOneBy as { query: Dictionary<unknown> }
        ).query;

        if (String(query["incidentId"]) === unreadable.id!.toString()) {
          throw new Error("connection reset");
        }

        return null;
      }) as never);

    const result: MonitorTurnedOffResult = await upgrade();

    expect(result.resolvedIncidentIds).toEqual([readable.id!.toString()]);
    expect(result.leftForAPersonIncidentIds).toEqual([
      unreadable.id!.toString(),
    ]);
    expect(errors).toHaveBeenCalled();
  });

  test("it resolves no more than the switch: declared by hand, left to a person by its criteria, or of a removed criteria, they stay open", async () => {
    openIncidents = [
      incident({}),
      incident({
        criteriaId: DEGRADED,
        templateId: DEGRADED_INCIDENT_TEMPLATE,
      }),
      incident({ criteriaId: "criteria-removed", templateId: "x" }),
    ];
    openAlerts = [alert({}), alert({ criteriaId: DEGRADED })];

    const result: MonitorTurnedOffResult = await upgrade();

    expect(result.resolvedIncidentIds).toEqual([]);
    expect(result.resolvedAlertIds).toEqual([]);
    // Not even read: only what it would have resolved is looked at.
    expect(workedOnReads).toEqual([]);
  });

  test("a monitor whose monitoring is on again by now is left to its checks", async () => {
    storedMonitor!.disableActiveMonitoring = false;
    openIncidents = [
      incident({ criteriaId: OFFLINE, templateId: OFFLINE_INCIDENT_TEMPLATE }),
    ];

    expect(await upgrade()).toEqual({
      resolvedIncidentIds: [],
      resolvedAlertIds: [],
      leftForAPersonIncidentIds: [],
      leftForAPersonAlertIds: [],
    });
    expect(incidentReads).not.toHaveBeenCalled();
  });

  test("run twice, it resolves nothing more: what it resolved is no longer open, and what a person worked on is left again", async () => {
    const untouched: Incident = incident({
      criteriaId: OFFLINE,
      templateId: OFFLINE_INCIDENT_TEMPLATE,
    });
    const acknowledged: Incident = incident({
      criteriaId: OFFLINE,
      templateId: OFFLINE_INCIDENT_TEMPLATE,
    });
    openIncidents = [untouched, acknowledged];
    incidentStateChangesByAPerson.add(acknowledged.id!.toString());

    // The resolve takes the incident off the open list, as the database does.
    incidentTimelines.mockImplementation(async (createBy: unknown) => {
      const data: IncidentStateTimeline = (
        createBy as { data: IncidentStateTimeline }
      ).data;
      openIncidents = openIncidents.filter((open: Incident): boolean => {
        return open.id!.toString() !== data.incidentId!.toString();
      });
      return data;
    });

    const first: MonitorTurnedOffResult = await upgrade();
    const second: MonitorTurnedOffResult = await upgrade();

    expect(first.resolvedIncidentIds).toEqual([untouched.id!.toString()]);
    expect(second.resolvedIncidentIds).toEqual([]);
    expect(second.leftForAPersonIncidentIds).toEqual([
      acknowledged.id!.toString(),
    ]);
    expect(incidentTimelines).toHaveBeenCalledTimes(1);
  });

  test("turning monitoring off is unchanged: the person deciding resolves what they acknowledged too, and no history is read", async () => {
    const acknowledged: Incident = incident({
      criteriaId: OFFLINE,
      templateId: OFFLINE_INCIDENT_TEMPLATE,
    });
    openIncidents = [acknowledged];
    incidentStateChangesByAPerson.add(acknowledged.id!.toString());

    const result: MonitorTurnedOffResult = await turnOff();

    expect(result).toEqual({
      resolvedIncidentIds: [acknowledged.id!.toString()],
      resolvedAlertIds: [],
    });
    expect(result.leftForAPersonIncidentIds).toBeUndefined();
    expect(workedOnReads).toEqual([]);
  });
});
