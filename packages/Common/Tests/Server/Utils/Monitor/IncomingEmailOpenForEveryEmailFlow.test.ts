/*
 * MonitorResource reaches the native isolated-vm addon through the criteria
 * evaluator's sandbox runner. Nothing here runs a sandbox, and the prebuilt
 * binary cannot always dlopen in the test environment.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentInternalNote from "../../../../Models/DatabaseModels/IncidentInternalNote";
import IncidentSeverity from "../../../../Models/DatabaseModels/IncidentSeverity";
import IncidentStateTimeline from "../../../../Models/DatabaseModels/IncidentStateTimeline";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import Semaphore from "../../../../Server/Infrastructure/Semaphore";
import AlertService from "../../../../Server/Services/AlertService";
import IncidentInternalNoteService from "../../../../Server/Services/IncidentInternalNoteService";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentSeverityService from "../../../../Server/Services/IncidentSeverityService";
import IncidentStateTimelineService from "../../../../Server/Services/IncidentStateTimelineService";
import MonitorService from "../../../../Server/Services/MonitorService";
import NetworkDeviceOwnerUserService from "../../../../Server/Services/NetworkDeviceOwnerUserService";
import ProjectService from "../../../../Server/Services/ProjectService";
import logger from "../../../../Server/Utils/Logger";
import IncomingEmailOpenForEveryEmail from "../../../../Server/Utils/Monitor/IncomingEmailOpenForEveryEmail";
import MonitorDependencySuppression from "../../../../Server/Utils/Monitor/MonitorDependencySuppression";
import MonitorLogUtil from "../../../../Server/Utils/Monitor/MonitorLogUtil";
import MonitorMaintenanceSuppression from "../../../../Server/Utils/Monitor/MonitorMaintenanceSuppression";
import MonitorMetricUtil from "../../../../Server/Utils/Monitor/MonitorMetricUtil";
import MonitorResourceUtil from "../../../../Server/Utils/Monitor/MonitorResource";
import MonitorResourceContextUtil from "../../../../Server/Utils/Monitor/MonitorResourceContext";
import MonitorStatusTimelineUtil from "../../../../Server/Utils/Monitor/MonitorStatusTimeline";
import MonitorSummaryCapture from "../../../../Server/Utils/Monitor/MonitorSummaryCapture";
import ReceivingSilence from "../../../../Server/Utils/Monitor/ReceivingSilence";
import OneUptimeDate from "../../../../Types/Date";
import Dictionary from "../../../../Types/Dictionary";
import FilterCondition from "../../../../Types/Filter/FilterCondition";
import { JSONObject } from "../../../../Types/JSON";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../../Types/Monitor/CriteriaFilter";
import IncomingEmailMonitorRequest from "../../../../Types/Monitor/IncomingEmailMonitor/IncomingEmailMonitorRequest";
import MonitorCriteria from "../../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorEvaluationSummary, {
  MonitorEvaluationEvent,
} from "../../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import ProbeApiIngestResponse from "../../../../Types/Probe/ProbeApiIngestResponse";
import {
  INCIDENT_STATE_IDS,
  mockProjectStates,
} from "../../TestingUtils/Services/ProjectStatesHelper";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { FindOperator } from "typeorm";

/*
 * The customer's question, end to end: "We set up an email monitor so
 * reporters can raise incidents by emailing an inbound address. Once an
 * active incident exists, later emails are treated as duplicates rather than
 * creating distinct incidents. How can we treat each inbound email as a
 * separate incident?"
 *
 * Each email goes into MonitorResourceUtil.monitorResource - what the
 * inbound email worker calls for every email - and through the real criteria
 * evaluator and the real incident creator. The incident table is in memory:
 * it opens, resolves and finds incidents the way the database does, so what
 * one email opens is what the next email's evaluation sees.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const ONLINE_STATUS_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const OFFLINE_STATUS_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const SEVERITY_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);

const REPORTED_CRITERIA_ID: string = "8b0f8d0e-6a55-4ad4-9d43-2a3c1f9a7c01";
const ALL_CLEAR_CRITERIA_ID: string = "8b0f8d0e-6a55-4ad4-9d43-2a3c1f9a7c02";
const LATE_CRITERIA_ID: string = "8b0f8d0e-6a55-4ad4-9d43-2a3c1f9a7c03";

const START: Date = new Date("2026-10-15T09:00:00.000Z");

// The incident table: every incident this monitor opened, open or not.
let table: Array<Incident> = [];
let notes: Array<IncidentInternalNote> = [];
let nextNumber: number = 1;

function sqlOf(operator: unknown): string {
  const getSql: ((alias: string) => string) | undefined = (
    operator as FindOperator<unknown>
  ).getSql;

  return getSql ? getSql("c") : "";
}

function parameterOf(operator: unknown): unknown {
  return Object.values(
    (operator as FindOperator<unknown>).objectLiteralParameters || {},
  )[0];
}

function isIn(operator: unknown, value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  return (parameterOf(operator) as Array<string>).includes(value);
}

// The rows of the table a findBy reads, newest first.
function readIncidents(query: JSONObject, limit: number): Array<Incident> {
  return table
    .filter((incident: Incident): boolean => {
      const state: unknown = query["currentIncidentStateId"];

      if (
        state !== undefined &&
        !isIn(state, incident.currentIncidentStateId?.toString())
      ) {
        return false;
      }

      const fingerprint: unknown = query["seriesFingerprint"];

      if (fingerprint !== undefined) {
        const sql: string = sqlOf(fingerprint);

        if (sql.includes("IS NOT NULL")) {
          if (!incident.seriesFingerprint) {
            return false;
          }
        } else if (!isIn(fingerprint, incident.seriesFingerprint)) {
          return false;
        }
      }

      const createdAt: unknown = query["createdAt"];

      if (
        createdAt !== undefined &&
        incident.createdAt!.getTime() <
          (parameterOf(createdAt) as Date).getTime()
      ) {
        return false;
      }

      return true;
    })
    .sort((a: Incident, b: Incident): number => {
      return b.createdAt!.getTime() - a.createdAt!.getTime();
    })
    .slice(0, limit);
}

function isOpen(incident: Incident): boolean {
  return (
    incident.currentIncidentStateId?.toString() !==
    INCIDENT_STATE_IDS.resolved.toString()
  );
}

function filter(
  checkOn: CheckOn,
  filterType: FilterType,
  value?: string | number | undefined,
): CriteriaFilter {
  return { checkOn, filterType, value };
}

// "A report": an email from the company's own people opens an incident.
function reportedCriteria(options: {
  openForEveryEmail: boolean;
  autoResolve?: boolean | undefined;
}): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data = {
    id: REPORTED_CRITERIA_ID,
    name: "Reported by email",
    description: "",
    monitorStatusId: OFFLINE_STATUS_ID,
    filterCondition: FilterCondition.All,
    filters: [
      filter(CheckOn.EmailFrom, FilterType.EndsWith, "@acme.example"),
      filter(CheckOn.EmailSubject, FilterType.NotContains, "all clear"),
    ],
    incidents: [
      {
        id: "8b0f8d0e-6a55-4ad4-9d43-2a3c1f9a7d01",
        title: "{{emailSubject}}",
        description: "{{emailBody}}",
        incidentSeverityId: SEVERITY_ID,
        autoResolveIncident: options.autoResolve === true,
      },
    ],
    alerts: [],
    changeMonitorStatus: true,
    createIncidents: true,
    createAlerts: false,
    isEnabled: true,
    ...(options.openForEveryEmail ? { openForEveryEmail: true } : {}),
  };
  return instance;
}

// "All clear": the monitor goes back online. Opens nothing.
function allClearCriteria(): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data = {
    id: ALL_CLEAR_CRITERIA_ID,
    name: "All clear",
    description: "",
    monitorStatusId: ONLINE_STATUS_ID,
    filterCondition: FilterCondition.All,
    filters: [filter(CheckOn.EmailSubject, FilterType.Contains, "all clear")],
    incidents: [],
    alerts: [],
    changeMonitorStatus: true,
    createIncidents: false,
    createAlerts: false,
    isEnabled: true,
  };
  return instance;
}

// "Late": no email in an hour opens an incident - a scheduled check.
function lateCriteria(): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data = {
    id: LATE_CRITERIA_ID,
    name: "No email in an hour",
    description: "",
    monitorStatusId: OFFLINE_STATUS_ID,
    filterCondition: FilterCondition.All,
    filters: [
      filter(CheckOn.EmailReceivedAt, FilterType.NotRecievedInMinutes, 60),
    ],
    incidents: [
      {
        id: "8b0f8d0e-6a55-4ad4-9d43-2a3c1f9a7d03",
        title: "No email in an hour",
        description: "",
        incidentSeverityId: SEVERITY_ID,
        autoResolveIncident: false,
      },
    ],
    alerts: [],
    changeMonitorStatus: true,
    createIncidents: true,
    createAlerts: false,
    isEnabled: true,
    openForEveryEmail: true,
  };
  return instance;
}

function emailMonitor(
  criteriaInstances: Array<MonitorCriteriaInstance>,
): Monitor {
  const step: MonitorStep = new MonitorStep();
  const monitorCriteria: MonitorCriteria = new MonitorCriteria();
  monitorCriteria.data = {
    monitorCriteriaInstanceArray: criteriaInstances,
  };
  step.data!.monitorCriteria = monitorCriteria;

  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data = {
    monitorStepsInstanceArray: [step],
    defaultMonitorStatusId: ONLINE_STATUS_ID,
  };

  const monitor: Monitor = new Monitor();
  monitor.id = MONITOR_ID;
  monitor.projectId = PROJECT_ID;
  monitor.name = "IT help desk";
  monitor.monitorType = MonitorType.IncomingEmail;
  monitor.monitorSteps = monitorSteps;
  // Already at its default status: nothing about the status is under test.
  monitor.currentMonitorStatusId = ONLINE_STATUS_ID;
  return monitor;
}

interface SentEmail {
  messageId?: string | undefined;
  from?: string | undefined;
  subject: string;
  body?: string | undefined;
  headers?: Dictionary<string> | undefined;
}

function received(sent: SentEmail): IncomingEmailMonitorRequest {
  const now: Date = OneUptimeDate.getCurrentDate();

  return {
    projectId: PROJECT_ID,
    monitorId: MONITOR_ID,
    emailFrom: sent.from || "reporter@acme.example",
    emailTo: "help@inbound.oneuptime.example",
    emailSubject: sent.subject,
    emailBody: sent.body || `${sent.subject}. Please take a look.`,
    emailHeaders: {
      ...(sent.messageId ? { "Message-ID": `<${sent.messageId}>` } : {}),
      ...(sent.headers || {}),
    },
    emailReceivedAt: now,
    checkedAt: now,
    onlyCheckForIncomingEmailReceivedAt: false,
  };
}

let monitorUnderTest: Monitor = emailMonitor([]);

async function deliver(
  request: IncomingEmailMonitorRequest,
): Promise<MonitorEvaluationSummary> {
  // A minute between emails, as they arrive.
  jest.setSystemTime(
    OneUptimeDate.addRemoveMinutes(OneUptimeDate.getCurrentDate(), 1),
  );

  const response: ProbeApiIngestResponse =
    await MonitorResourceUtil.monitorResource(request);

  return response.evaluationSummary!;
}

function titles(incidents: Array<Incident>): Array<string> {
  return incidents.map((incident: Incident): string => {
    return incident.title || "";
  });
}

function eventTitles(
  evaluationSummary: MonitorEvaluationSummary,
): Array<string> {
  return evaluationSummary.events
    .filter((event: MonitorEvaluationEvent): boolean => {
      return event.type.startsWith("incident-");
    })
    .map((event: MonitorEvaluationEvent): string => {
      return `${event.type}: ${event.title}`;
    });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(START);

  table = [];
  notes = [];
  nextNumber = 1;

  mockProjectStates();

  jest.spyOn(ProjectService, "isProjectBlocked").mockResolvedValue(false);
  jest.spyOn(Semaphore, "lock").mockResolvedValue({} as never);
  jest.spyOn(Semaphore, "release").mockResolvedValue(undefined as never);
  jest.spyOn(MonitorService, "findOneById").mockImplementation((async () => {
    return monitorUnderTest;
  }) as never);
  jest
    .spyOn(MonitorService, "updateColumnsByIdWithoutHooks")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(MonitorMetricUtil, "saveMonitorMetrics")
    .mockResolvedValue(undefined);
  jest.spyOn(MonitorLogUtil, "saveMonitorLog").mockReturnValue(undefined);
  jest
    .spyOn(MonitorStatusTimelineUtil, "updateMonitorStatusTimeline")
    .mockResolvedValue(null as never);
  jest
    .spyOn(MonitorMaintenanceSuppression, "getMaintenanceSuppression")
    .mockResolvedValue({
      suppressedSeriesFingerprints: new Set<string>(),
      suppressingDatabaseServerIds: [],
    } as never);
  jest
    .spyOn(MonitorDependencySuppression, "getDependencySuppression")
    .mockResolvedValue({ isSuppressed: false } as never);
  jest.spyOn(MonitorSummaryCapture, "capture").mockResolvedValue(null as never);
  jest
    .spyOn(MonitorResourceContextUtil, "resolveResourceContextForMonitor")
    .mockResolvedValue(MonitorResourceContextUtil.emptyContext());
  jest
    .spyOn(MonitorResourceContextUtil, "resolveLinkedResourcesForMonitor")
    .mockResolvedValue(MonitorResourceContextUtil.emptyContext());
  jest
    .spyOn(NetworkDeviceOwnerUserService, "getDeviceOwnersForMonitor")
    .mockResolvedValue({ ownerUserIds: [], ownerTeamIds: [] });

  // The criteria's severity belongs to the monitor's project.
  jest
    .spyOn(IncidentSeverityService, "findOneBy")
    .mockImplementation((async (): Promise<IncidentSeverity> => {
      const severity: IncidentSeverity = new IncidentSeverity();
      severity._id = SEVERITY_ID.toString();
      severity.projectId = PROJECT_ID;
      return severity;
    }) as never);

  // The monitor opens no alerts; nothing is open.
  jest.spyOn(AlertService, "findBy").mockResolvedValue([]);

  jest.spyOn(IncidentService, "findBy").mockImplementation((async (findBy: {
    query: JSONObject;
    limit: number;
  }): Promise<Array<Incident>> => {
    return readIncidents(findBy.query, findBy.limit);
  }) as never);

  jest.spyOn(IncidentService, "create").mockImplementation((async (createBy: {
    data: Incident;
  }): Promise<Incident> => {
    const incident: Incident = createBy.data;
    incident.id = ObjectID.generate();
    incident.incidentNumber = nextNumber++;
    incident.createdAt = OneUptimeDate.getCurrentDate();
    incident.currentIncidentStateId = INCIDENT_STATE_IDS.created;
    table.push(incident);
    return incident;
  }) as never);

  jest
    .spyOn(IncidentStateTimelineService, "getResolvedStateIdForProject")
    .mockResolvedValue(INCIDENT_STATE_IDS.resolved);

  jest
    .spyOn(IncidentStateTimelineService, "create")
    .mockImplementation((async (createBy: {
      data: IncidentStateTimeline;
    }): Promise<IncidentStateTimeline> => {
      const incident: Incident | undefined = table.find(
        (candidate: Incident): boolean => {
          return (
            candidate.id!.toString() === createBy.data.incidentId!.toString()
          );
        },
      );

      incident!.currentIncidentStateId = createBy.data.incidentStateId!;
      return createBy.data;
    }) as never);

  jest
    .spyOn(IncidentInternalNoteService, "findOneBy")
    .mockImplementation((async (findOneBy: {
      query: JSONObject;
    }): Promise<IncidentInternalNote | null> => {
      return (
        notes.find((note: IncidentInternalNote): boolean => {
          return (
            note.incidentId!.toString() ===
              (findOneBy.query["incidentId"] as ObjectID).toString() &&
            note.note === findOneBy.query["note"]
          );
        }) || null
      );
    }) as never);

  jest
    .spyOn(IncidentInternalNoteService, "create")
    .mockImplementation((async (createBy: {
      data: IncidentInternalNote;
    }): Promise<IncidentInternalNote> => {
      notes.push(createBy.data);
      return createBy.data;
    }) as never);

  jest.spyOn(logger, "error").mockImplementation(() => {
    return undefined as never;
  });
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("Today's behaviour, which stays the default: one incident at a time", () => {
  it("a second report while the first incident is open opens nothing", async () => {
    monitorUnderTest = emailMonitor([
      reportedCriteria({ openForEveryEmail: false }),
    ]);

    await deliver(
      received({ messageId: "r1@acme.example", subject: "VPN is down" }),
    );
    const second: MonitorEvaluationSummary = await deliver(
      received({
        messageId: "r2@acme.example",
        subject: "Printer on floor 3 is down",
      }),
    );

    expect(titles(table)).toEqual(["VPN is down"]);
    expect(eventTitles(second)).toEqual([
      "incident-skipped: Incident already active: VPN is down",
    ]);
    // Opened one at a time: no fingerprint.
    expect(table[0]!.seriesFingerprint).toBeUndefined();
  });
});

describe("With the criteria opening an incident for every email", () => {
  beforeEach(() => {
    monitorUnderTest = emailMonitor([
      reportedCriteria({ openForEveryEmail: true }),
    ]);
  });

  it("every report opens its own incident, titled by its own subject", async () => {
    await deliver(
      received({ messageId: "r1@acme.example", subject: "VPN is down" }),
    );
    const second: MonitorEvaluationSummary = await deliver(
      received({
        messageId: "r2@acme.example",
        subject: "Printer on floor 3 is down",
      }),
    );
    await deliver(
      received({ messageId: "r3@acme.example", subject: "Wi-Fi in room 2" }),
    );

    expect(titles(table)).toEqual([
      "VPN is down",
      "Printer on floor 3 is down",
      "Wi-Fi in room 2",
    ]);
    expect(table.every(isOpen)).toBe(true);
    expect(eventTitles(second)).toEqual([
      "incident-created: Incident created: Printer on floor 3 is down",
    ]);
    expect(
      table.map((incident: Incident): string | undefined => {
        return incident.seriesFingerprint;
      }),
    ).toEqual([
      IncomingEmailOpenForEveryEmail.getEmailFingerprint("r1@acme.example"),
      IncomingEmailOpenForEveryEmail.getEmailFingerprint("r2@acme.example"),
      IncomingEmailOpenForEveryEmail.getEmailFingerprint("r3@acme.example"),
    ]);
  });

  it("the description is the email's body, as text", async () => {
    await deliver(
      received({
        messageId: "r1@acme.example",
        subject: "VPN is down",
        body: "Since 9am. [Status](https://evil.example) <!channel>",
      }),
    );

    expect(table[0]!.description).toContain("Since 9am.");
    expect(table[0]!.description).not.toContain("[Status](https://evil");
    expect(table[0]!.description).not.toContain("<!channel>");
  });

  it("the same email delivered twice opens one incident", async () => {
    const report: IncomingEmailMonitorRequest = received({
      messageId: "r1@acme.example",
      subject: "VPN is down",
    });

    await deliver(report);
    const again: MonitorEvaluationSummary = await deliver(report);

    expect(titles(table)).toEqual(["VPN is down"]);
    expect(eventTitles(again)).toEqual([
      "incident-skipped: Incident already opened for this email: VPN is down",
    ]);
  });

  it("a reply is added to the reporter's incident as a note, and opens nothing", async () => {
    await deliver(
      received({ messageId: "r1@acme.example", subject: "VPN is down" }),
    );
    const reply: MonitorEvaluationSummary = await deliver(
      received({
        messageId: "reply-1@acme.example",
        from: "colleague@acme.example",
        subject: "Re: VPN is down",
        body: "Same here, since 9am.",
        headers: {
          "In-Reply-To": "<r1@acme.example>",
          References: "<r1@acme.example>",
        },
      }),
    );

    expect(titles(table)).toEqual(["VPN is down"]);
    expect(notes).toHaveLength(1);
    expect(notes[0]!.incidentId!.toString()).toBe(table[0]!.id!.toString());
    expect(notes[0]!.note).toContain("Same here, since 9am.");
    expect(eventTitles(reply)).toEqual([
      "incident-skipped: Reply added to the incident as a note: VPN is down",
    ]);
  });

  it("an email from outside the company matches no criteria: the From filter is the allow-list", async () => {
    await deliver(
      received({
        messageId: "spam@elsewhere.example",
        from: "someone@elsewhere.example",
        subject: "Cheap watches",
      }),
    );

    expect(table).toEqual([]);
  });

  it("an out-of-office reply opens nothing", async () => {
    await deliver(
      received({
        messageId: "ooo@acme.example",
        subject: "Automatic reply: I am away",
        headers: { "Auto-Submitted": "auto-replied" },
      }),
    );

    expect(table).toEqual([]);
  });

  it("a flood opens at most the hourly limit, and opens again as the hour moves on", async () => {
    for (let index: number = 0; index < 25; index++) {
      await deliver(
        received({
          messageId: `loop-${index}@acme.example`,
          subject: `Loop ${index}`,
        }),
      );
    }

    expect(table).toHaveLength(20);

    // An hour after the first of them, one more may open.
    jest.setSystemTime(OneUptimeDate.addRemoveMinutes(START, 61));
    await deliver(
      received({ messageId: "later@acme.example", subject: "Later" }),
    );

    expect(table).toHaveLength(21);
  });

  it("a later report never resolves an earlier one, even with Auto Resolve on", async () => {
    monitorUnderTest = emailMonitor([
      reportedCriteria({ openForEveryEmail: true, autoResolve: true }),
      allClearCriteria(),
    ]);

    await deliver(
      received({ messageId: "r1@acme.example", subject: "VPN is down" }),
    );
    await deliver(
      received({ messageId: "r2@acme.example", subject: "Printer is down" }),
    );

    expect(titles(table)).toEqual(["VPN is down", "Printer is down"]);
    expect(table.every(isOpen)).toBe(true);
  });

  it("with Auto Resolve on, an email that matches a different criteria resolves every one of them", async () => {
    monitorUnderTest = emailMonitor([
      reportedCriteria({ openForEveryEmail: true, autoResolve: true }),
      allClearCriteria(),
    ]);

    await deliver(
      received({ messageId: "r1@acme.example", subject: "VPN is down" }),
    );
    await deliver(
      received({ messageId: "r2@acme.example", subject: "Printer is down" }),
    );
    await deliver(
      received({ messageId: "c1@acme.example", subject: "All clear" }),
    );

    expect(table).toHaveLength(2);
    expect(table.some(isOpen)).toBe(false);
  });

  it("without Auto Resolve, they stay open for people to resolve", async () => {
    monitorUnderTest = emailMonitor([
      reportedCriteria({ openForEveryEmail: true, autoResolve: false }),
      allClearCriteria(),
    ]);

    await deliver(
      received({ messageId: "r1@acme.example", subject: "VPN is down" }),
    );
    await deliver(
      received({ messageId: "r2@acme.example", subject: "Printer is down" }),
    );
    await deliver(
      received({ messageId: "c1@acme.example", subject: "All clear" }),
    );

    expect(titles(table)).toEqual(["VPN is down", "Printer is down"]);
    expect(table.every(isOpen)).toBe(true);
  });
});

describe("A scheduled check, which has no email of its own", () => {
  it("opens one incident at a time, as before, whatever the switch says", async () => {
    monitorUnderTest = emailMonitor([lateCriteria()]);

    jest.spyOn(ReceivingSilence, "measure").mockResolvedValue({
      wallMinutes: 90,
      receivingMinutes: 90,
      notReceivingMinutes: 0,
    });

    const lastEmail: IncomingEmailMonitorRequest = received({
      messageId: "last@acme.example",
      subject: "Nightly report",
    });
    const scheduledCheck: IncomingEmailMonitorRequest = {
      ...lastEmail,
      onlyCheckForIncomingEmailReceivedAt: true,
    };

    await deliver(scheduledCheck);
    const again: MonitorEvaluationSummary = await deliver(scheduledCheck);

    expect(titles(table)).toEqual(["No email in an hour"]);
    expect(table[0]!.seriesFingerprint).toBeUndefined();
    expect(eventTitles(again)).toEqual([
      "incident-skipped: Incident already active: No email in an hour",
    ]);
  });
});
