jest.mock("../../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

import HuntressConnection from "../../../../Models/DatabaseModels/HuntressConnection";
import HuntressIncidentReport from "../../../../Models/DatabaseModels/HuntressIncidentReport";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentInternalNote from "../../../../Models/DatabaseModels/IncidentInternalNote";
import IncidentSeverity from "../../../../Models/DatabaseModels/IncidentSeverity";
import IncidentStateTimeline from "../../../../Models/DatabaseModels/IncidentStateTimeline";
import Label from "../../../../Models/DatabaseModels/Label";
import OnCallDutyPolicy from "../../../../Models/DatabaseModels/OnCallDutyPolicy";
import Semaphore, {
  SemaphoreMutex,
} from "../../../../Server/Infrastructure/Semaphore";
import HuntressIncidentReportService from "../../../../Server/Services/HuntressIncidentReportService";
import IncidentInternalNoteService from "../../../../Server/Services/IncidentInternalNoteService";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentSeverityService from "../../../../Server/Services/IncidentSeverityService";
import IncidentStateService from "../../../../Server/Services/IncidentStateService";
import IncidentStateTimelineService from "../../../../Server/Services/IncidentStateTimelineService";
import LabelService from "../../../../Server/Services/LabelService";
import HuntressIncidentReportProcessor, {
  HUNTRESS_APPLIED_MESSAGE_IDS_KEPT,
  HUNTRESS_CLAIM_IN_PROGRESS_MS,
  HuntressConnectionSettings,
  HuntressReportAction,
  HuntressReportBusyException,
  HuntressReportResult,
} from "../../../../Server/Utils/Huntress/HuntressIncidentReportProcessor";
import BadDataException from "../../../../Types/Exception/BadDataException";
import HuntressIncidentReportOutcome from "../../../../Types/Huntress/HuntressIncidentReportOutcome";
import HuntressSeverity from "../../../../Types/Huntress/HuntressSeverity";
import {
  HuntressIncidentReportEvent,
  ParsedHuntressWebhook,
  parseHuntressWebhook,
} from "../../../../Types/Huntress/HuntressWebhook";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  getHuntressClosedBody,
  getHuntressCommentBody,
  getHuntressIdentityReportBody,
  getHuntressIncidentReportBody,
} from "../../../Types/Huntress/HuntressWebhookFixtures";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * What a Huntress incident report does in a project, end to end through
 * the processor, with every service it calls stood in for by an in-memory
 * project: report rows kept like the real table (unique by project,
 * account and report id), incidents with a current state, notes, state
 * timelines, labels and severities.
 *
 * It pins the integration's promises:
 *   - one incident per report, however often Huntress sends it, whatever
 *     the order, and only one even when a delivery failed half way;
 *   - the incident's severity follows the connection's choice for the
 *     Huntress severity, or the project's severities in rank order;
 *   - on-call is paged only at or above "Page On-Call For";
 *   - the report's organization labels the incident, and a connection's
 *     organization filter keeps other organizations' reports out;
 *   - comments become private notes, and closing the report resolves the
 *     incident once (or notes it once, when the switch is off).
 */

const PROJECT_ID: ObjectID = new ObjectID("10000000-0000-4000-8000-000000000001");
const CONNECTION_ID: ObjectID = new ObjectID(
  "20000000-0000-4000-8000-000000000001",
);
const OTHER_CONNECTION_ID: ObjectID = new ObjectID(
  "20000000-0000-4000-8000-000000000002",
);
const SEVERITY_CRITICAL: string = "30000000-0000-4000-8000-000000000001";
const SEVERITY_MAJOR: string = "30000000-0000-4000-8000-000000000002";
const SEVERITY_MINOR: string = "30000000-0000-4000-8000-000000000003";
const SEVERITY_CUSTOM: string = "30000000-0000-4000-8000-000000000009";
const POLICY_ID: ObjectID = new ObjectID("40000000-0000-4000-8000-000000000001");
const SECOND_POLICY_ID: ObjectID = new ObjectID(
  "40000000-0000-4000-8000-000000000002",
);
const CONNECTION_LABEL_ID: ObjectID = new ObjectID(
  "50000000-0000-4000-8000-000000000001",
);
const CREATED_STATE: string = "60000000-0000-4000-8000-000000000001";
const ACKNOWLEDGED_STATE: string = "60000000-0000-4000-8000-000000000002";
const RESOLVED_STATE: string = "60000000-0000-4000-8000-000000000003";

const NOW: Date = new Date("2026-10-09T10:00:00.000Z");

interface FakeIncident {
  id: ObjectID;
  data: Incident;
  currentIncidentStateId: string;
}

// The in-memory project.
let reportRows: Array<HuntressIncidentReport> = [];
let incidents: Array<FakeIncident> = [];
let notes: Array<IncidentInternalNote> = [];
let timelines: Array<IncidentStateTimeline> = [];
let severities: Array<{ id: string; order: number }> = [];
let labelNamesAsked: Array<Array<string>> = [];
let locksTaken: Array<string> = [];
let locksReleased: number = 0;
let idCounter: number = 0;

function nextId(): ObjectID {
  idCounter++;
  return new ObjectID(
    `90000000-0000-4000-8000-${String(idCounter).padStart(12, "0")}`,
  );
}

function labelIdFor(name: string): ObjectID {
  let hash: number = 0;

  for (const character of name) {
    hash = (hash * 31 + character.charCodeAt(0)) % 1000000;
  }

  return new ObjectID(
    `70000000-0000-4000-8000-${String(hash).padStart(12, "0")}`,
  );
}

function getSettings(
  overrides: Partial<HuntressConnectionSettings> = {},
): HuntressConnectionSettings {
  return {
    id: CONNECTION_ID,
    projectId: PROJECT_ID,
    pageOnCallFor: HuntressSeverity.High,
    criticalIncidentSeverityId: null,
    highIncidentSeverityId: null,
    lowIncidentSeverityId: null,
    watchedOrganizations: [],
    onCallDutyPolicyIds: [POLICY_ID],
    labelIds: [CONNECTION_LABEL_ID],
    resolveIncidentWhenReportCloses: true,
    ...overrides,
  };
}

function toEvent(body: JSONObject): HuntressIncidentReportEvent {
  const parsed: ParsedHuntressWebhook = parseHuntressWebhook(body);

  if (parsed.kind !== "incident-report") {
    throw new Error(`fixture is not a report: ${parsed.kind}`);
  }

  return parsed.event;
}

async function receive(
  body: JSONObject,
  messageId: string,
  settings: HuntressConnectionSettings = getSettings(),
  now: Date = NOW,
): Promise<HuntressReportResult> {
  return await HuntressIncidentReportProcessor.process({
    settings,
    event: toEvent(body),
    messageId,
    now,
  });
}

function matches(row: HuntressIncidentReport, query: JSONObject): boolean {
  return (
    row.projectId?.toString() === query["projectId"]?.toString() &&
    row.huntressAccountId === query["huntressAccountId"] &&
    row.huntressIncidentReportId === query["huntressIncidentReportId"]
  );
}

function copyRow(row: HuntressIncidentReport): HuntressIncidentReport {
  const copy: HuntressIncidentReport = new HuntressIncidentReport();
  Object.assign(copy, row);
  copy.appliedMessageIds = row.appliedMessageIds
    ? [...(row.appliedMessageIds as Array<string>)]
    : (undefined as unknown as Array<string>);
  return copy;
}

function onlyRow(): HuntressIncidentReport {
  expect(reportRows).toHaveLength(1);
  return reportRows[0]!;
}

function onlyIncident(): FakeIncident {
  expect(incidents).toHaveLength(1);
  return incidents[0]!;
}

function idsOf(models: Array<{ _id?: string | undefined }> | undefined): Array<string> {
  return (models || []).map((model: { _id?: string | undefined }): string => {
    return model._id || "";
  });
}

beforeEach(() => {
  reportRows = [];
  incidents = [];
  notes = [];
  timelines = [];
  labelNamesAsked = [];
  locksTaken = [];
  locksReleased = 0;
  idCounter = 0;
  severities = [
    { id: SEVERITY_CRITICAL, order: 1 },
    { id: SEVERITY_MAJOR, order: 2 },
    { id: SEVERITY_MINOR, order: 3 },
  ];

  jest
    .spyOn(Semaphore, "lock")
    .mockImplementation(async (data: { key: string }): Promise<SemaphoreMutex> => {
      locksTaken.push(data.key);
      return {} as SemaphoreMutex;
    });
  jest.spyOn(Semaphore, "release").mockImplementation(async (): Promise<void> => {
    locksReleased++;
  });

  jest.spyOn(HuntressIncidentReportService, "findOneBy").mockImplementation((async (findBy: {
    query: JSONObject;
  }): Promise<HuntressIncidentReport | null> => {
    const row: HuntressIncidentReport | undefined = reportRows.find(
      (candidate: HuntressIncidentReport): boolean => {
        return matches(candidate, findBy.query);
      },
    );

    return row ? copyRow(row) : null;
  }) as never);

  jest.spyOn(HuntressIncidentReportService, "create").mockImplementation((async (createBy: {
    data: HuntressIncidentReport;
  }): Promise<HuntressIncidentReport> => {
    const data: HuntressIncidentReport = createBy.data;

    // The table's unique index.
    if (
      reportRows.some((row: HuntressIncidentReport): boolean => {
        return matches(row, {
          projectId: data.projectId!.toString(),
          huntressAccountId: data.huntressAccountId!,
          huntressIncidentReportId: data.huntressIncidentReportId!,
        });
      })
    ) {
      throw new Error("duplicate key value violates unique constraint");
    }

    const row: HuntressIncidentReport = copyRow(data);
    row._id = nextId().toString();
    row.createdAt = NOW;
    row.updatedAt = NOW;
    reportRows.push(row);

    return copyRow(row);
  }) as never);

  jest.spyOn(HuntressIncidentReportService, "updateOneById").mockImplementation((async (updateBy: {
    id: ObjectID;
    data: JSONObject;
  }): Promise<number> => {
    const row: HuntressIncidentReport | undefined = reportRows.find(
      (candidate: HuntressIncidentReport): boolean => {
        return candidate._id === updateBy.id.toString();
      },
    );

    if (!row) {
      return 0;
    }

    Object.assign(row, updateBy.data);
    row.updatedAt = NOW;
    return 1;
  }) as never);

  jest.spyOn(IncidentSeverityService, "findBy").mockImplementation((async (): Promise<
    Array<IncidentSeverity>
  > => {
    return [...severities]
      .sort((a: { order: number }, b: { order: number }): number => {
        return a.order - b.order;
      })
      .map((entry: { id: string; order: number }): IncidentSeverity => {
        const severity: IncidentSeverity = new IncidentSeverity();
        severity._id = entry.id;
        severity.order = entry.order;
        return severity;
      });
  }) as never);

  jest.spyOn(IncidentService, "create").mockImplementation((async (createBy: {
    data: Incident;
  }): Promise<Incident> => {
    const id: ObjectID = nextId();
    incidents.push({
      id,
      data: createBy.data,
      currentIncidentStateId: CREATED_STATE,
    });

    const created: Incident = new Incident();
    created._id = id.toString();
    return created;
  }) as never);

  jest.spyOn(IncidentService, "findOneById").mockImplementation((async (findBy: {
    id: ObjectID;
  }): Promise<Incident | null> => {
    const incident: FakeIncident | undefined = incidents.find(
      (candidate: FakeIncident): boolean => {
        return candidate.id.toString() === findBy.id.toString();
      },
    );

    if (!incident) {
      return null;
    }

    const found: Incident = new Incident();
    found._id = incident.id.toString();
    found.currentIncidentStateId = new ObjectID(incident.currentIncidentStateId);
    return found;
  }) as never);

  jest
    .spyOn(IncidentStateService, "getUnresolvedIncidentStateIds")
    .mockImplementation(async (): Promise<Array<ObjectID>> => {
      return [new ObjectID(CREATED_STATE), new ObjectID(ACKNOWLEDGED_STATE)];
    });

  jest
    .spyOn(IncidentStateTimelineService, "getResolvedStateIdForProject")
    .mockImplementation(async (): Promise<ObjectID> => {
      return new ObjectID(RESOLVED_STATE);
    });

  jest.spyOn(IncidentStateTimelineService, "create").mockImplementation((async (createBy: {
    data: IncidentStateTimeline;
  }): Promise<IncidentStateTimeline> => {
    const incident: FakeIncident | undefined = incidents.find(
      (candidate: FakeIncident): boolean => {
        return (
          candidate.id.toString() === createBy.data.incidentId?.toString()
        );
      },
    );

    if (
      incident &&
      incident.currentIncidentStateId ===
        createBy.data.incidentStateId?.toString()
    ) {
      throw new BadDataException(
        "Incident state cannot be same as previous state.",
      );
    }

    if (incident) {
      incident.currentIncidentStateId =
        createBy.data.incidentStateId!.toString();
    }

    timelines.push(createBy.data);
    return createBy.data;
  }) as never);

  jest.spyOn(IncidentInternalNoteService, "create").mockImplementation((async (createBy: {
    data: IncidentInternalNote;
  }): Promise<IncidentInternalNote> => {
    notes.push(createBy.data);
    return createBy.data;
  }) as never);

  jest.spyOn(LabelService, "findOrCreateLabelsByNames").mockImplementation((async (data: {
    labelNames: Array<string>;
  }): Promise<Array<ObjectID>> => {
    labelNamesAsked.push(data.labelNames);
    return data.labelNames.map((name: string): ObjectID => {
      return labelIdFor(name);
    });
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a new incident report", () => {
  test("opens one incident that says what Huntress reported", async () => {
    const result: HuntressReportResult = await receive(
      getHuntressIncidentReportBody(),
      "msg_1",
    );

    const incident: FakeIncident = onlyIncident();

    expect(result).toEqual({
      action: HuntressReportAction.IncidentOpened,
      outcome: HuntressIncidentReportOutcome.IncidentOpened,
      incidentId: incident.id,
    });

    expect(incident.data.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(incident.data.title).toBe(
      "Huntress: Incident on DESKTOP-ARL0EQ1 (Acme Corp)",
    );
    expect(incident.data.description).toContain(
      "Huntress detected a malicious scheduled task on this host.",
    );
    expect(incident.data.description).toContain(
      "[1234](https://huntress.io/org/4/incident_reports/1234)",
    );
    expect(incident.data.isCreatedAutomatically).toBe(true);
    // Never on a public status page.
    expect(incident.data.isVisibleOnStatusPage).toBe(false);
    // Nobody's root cause written for them.
    expect(incident.data.rootCause).toBeUndefined();
  });

  test("records the report, the incident and that it paged", async () => {
    await receive(getHuntressIncidentReportBody(), "msg_1");

    const row: HuntressIncidentReport = onlyRow();

    expect(row.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(row.huntressConnectionId?.toString()).toBe(CONNECTION_ID.toString());
    expect(row.huntressAccountId).toBe("5");
    expect(row.huntressIncidentReportId).toBe("1234");
    expect(row.outcome).toBe(HuntressIncidentReportOutcome.IncidentOpened);
    expect(row.incidentId?.toString()).toBe(onlyIncident().id.toString());
    expect(row.pagedOnCall).toBe(true);
    expect(row.organizationId).toBe("4");
    expect(row.organizationName).toBe("Acme Corp");
    expect(row.affectedName).toBe("DESKTOP-ARL0EQ1");
    expect(row.severity).toBe("critical");
    expect(row.status).toBe("sent");
    expect(row.subject).toBe(
      "CRITICAL - Incident on DESKTOP-ARL0EQ1 (Acme Corp)",
    );
    expect(row.lastEventType).toBe("incident_report.created");
    expect(row.lastEventReceivedAt).toEqual(NOW);
    expect(row.appliedMessageIds).toEqual(["msg_1"]);
  });

  test("is labelled with its organization and the connection's labels", async () => {
    await receive(getHuntressIncidentReportBody(), "msg_1");

    expect(labelNamesAsked).toEqual([["Acme Corp"]]);
    expect(idsOf(onlyIncident().data.labels as Array<Label>)).toEqual([
      CONNECTION_LABEL_ID.toString(),
      labelIdFor("Acme Corp").toString(),
    ]);
  });

  test("an organization label that is also a connection label is added once", async () => {
    await receive(
      getHuntressIncidentReportBody(),
      "msg_1",
      getSettings({ labelIds: [labelIdFor("Acme Corp")] }),
    );

    expect(idsOf(onlyIncident().data.labels as Array<Label>)).toEqual([
      labelIdFor("Acme Corp").toString(),
    ]);
  });

  test("a long organization name makes a label as long as a label can be", async () => {
    const name: string = "N".repeat(150);

    await receive(
      getHuntressIncidentReportBody({ organization: { id: 4, name } }),
      "msg_1",
    );

    expect(labelNamesAsked).toEqual([["N".repeat(100)]]);
  });

  test("a report naming no organization gets only the connection's labels", async () => {
    await receive(
      getHuntressIncidentReportBody({ organization: { id: 4 } }),
      "msg_1",
    );

    expect(labelNamesAsked).toEqual([]);
    expect(idsOf(onlyIncident().data.labels as Array<Label>)).toEqual([
      CONNECTION_LABEL_ID.toString(),
    ]);
  });

  test("is handled under a lock of its own report, released after", async () => {
    await receive(getHuntressIncidentReportBody(), "msg_1");

    expect(locksTaken).toEqual([`${PROJECT_ID.toString()}:5:1234`]);
    expect(locksReleased).toBe(1);
  });

  test("still opens its incident when the lock cannot be had", async () => {
    jest.spyOn(Semaphore, "lock").mockImplementation(async (): Promise<SemaphoreMutex> => {
      throw new Error("Redis client is not connected");
    });

    await receive(getHuntressIncidentReportBody(), "msg_1");

    expect(incidents).toHaveLength(1);
    expect(locksReleased).toBe(0);
  });
});

describe("one incident per report", () => {
  test("a delivery Huntress sends again opens nothing more", async () => {
    await receive(getHuntressIncidentReportBody(), "msg_1");
    const again: HuntressReportResult = await receive(
      getHuntressIncidentReportBody(),
      "msg_1",
    );

    expect(again.action).toBe(HuntressReportAction.Duplicate);
    expect(again.incidentId?.toString()).toBe(onlyIncident().id.toString());
    expect(reportRows).toHaveLength(1);
  });

  test("the same report sent as a new message opens nothing more", async () => {
    await receive(getHuntressIncidentReportBody(), "msg_1");
    const second: HuntressReportResult = await receive(
      getHuntressIncidentReportBody(),
      "msg_2",
    );

    expect(second.action).toBe(HuntressReportAction.NothingToDo);
    expect(incidents).toHaveLength(1);
    expect(onlyRow().appliedMessageIds).toEqual(["msg_1", "msg_2"]);
  });

  test("two connections of a project receiving one report open one incident", async () => {
    await receive(getHuntressIncidentReportBody(), "msg_1");
    await receive(
      getHuntressIncidentReportBody(),
      "msg_other_endpoint",
      getSettings({ id: OTHER_CONNECTION_ID }),
    );

    expect(incidents).toHaveLength(1);
    // The row stays with the connection that received it first.
    expect(onlyRow().huntressConnectionId?.toString()).toBe(
      CONNECTION_ID.toString(),
    );
  });

  test("different reports open different incidents", async () => {
    await receive(getHuntressIncidentReportBody(), "msg_1");
    await receive(getHuntressIdentityReportBody(), "msg_2");

    expect(incidents).toHaveLength(2);
    expect(reportRows).toHaveLength(2);
  });

  test("the same report id in two Huntress accounts is two reports", async () => {
    await receive(getHuntressIncidentReportBody(), "msg_1");
    await receive(
      getHuntressIncidentReportBody({
        account: { id: 6, name: "Other MSP" },
        account_id: 6,
      }),
      "msg_2",
    );

    expect(incidents).toHaveLength(2);
  });

  test("a report naming no account is keyed by an empty account", async () => {
    const body: JSONObject = getHuntressIncidentReportBody();
    delete body["account"];
    delete body["account_id"];

    await receive(body, "msg_1");
    await receive(body, "msg_2");

    expect(incidents).toHaveLength(1);
    expect(onlyRow().huntressAccountId).toBe("");
  });

  test("only the latest message ids are remembered", async () => {
    await receive(getHuntressIncidentReportBody(), "msg_0");

    for (let index: number = 1; index <= 40; index++) {
      await receive(getHuntressIncidentReportBody(), `msg_${index}`);
    }

    const applied: Array<string> = onlyRow().appliedMessageIds as Array<string>;

    expect(applied).toHaveLength(HUNTRESS_APPLIED_MESSAGE_IDS_KEPT);
    expect(applied[applied.length - 1]).toBe("msg_40");
    expect(incidents).toHaveLength(1);
  });
});

describe("a delivery that failed half way", () => {
  test("while another delivery holds a fresh claim, the next one is told to come back", async () => {
    // A claim made a moment ago by a delivery still at work.
    reportRows.push(
      Object.assign(new HuntressIncidentReport(), {
        _id: nextId().toString(),
        projectId: PROJECT_ID,
        huntressConnectionId: CONNECTION_ID,
        huntressAccountId: "5",
        huntressIncidentReportId: "1234",
        outcome: HuntressIncidentReportOutcome.Opening,
        updatedAt: new Date(NOW.getTime() - HUNTRESS_CLAIM_IN_PROGRESS_MS + 5000),
        appliedMessageIds: [],
      }),
    );

    await expect(
      receive(getHuntressIncidentReportBody(), "msg_1"),
    ).rejects.toBeInstanceOf(HuntressReportBusyException);

    expect(incidents).toHaveLength(0);
  });

  test("a claim left by an attempt that failed is finished by the next delivery", async () => {
    reportRows.push(
      Object.assign(new HuntressIncidentReport(), {
        _id: nextId().toString(),
        projectId: PROJECT_ID,
        huntressConnectionId: CONNECTION_ID,
        huntressAccountId: "5",
        huntressIncidentReportId: "1234",
        outcome: HuntressIncidentReportOutcome.Opening,
        updatedAt: new Date(NOW.getTime() - HUNTRESS_CLAIM_IN_PROGRESS_MS - 1),
        appliedMessageIds: [],
      }),
    );

    const result: HuntressReportResult = await receive(
      getHuntressIncidentReportBody(),
      "msg_retry",
    );

    expect(result.action).toBe(HuntressReportAction.IncidentOpened);
    expect(incidents).toHaveLength(1);
    expect(onlyRow().outcome).toBe(HuntressIncidentReportOutcome.IncidentOpened);
    expect(onlyRow().appliedMessageIds).toEqual(["msg_retry"]);
  });

  test("an incident that could not be opened leaves a claim the retry finishes", async () => {
    jest
      .spyOn(IncidentService, "create")
      .mockImplementationOnce(async (): Promise<Incident> => {
        throw new Error("database unavailable");
      });

    await expect(
      receive(getHuntressIncidentReportBody(), "msg_1"),
    ).rejects.toThrow("database unavailable");

    // Claimed, not applied: the same message counts as new when it comes back.
    expect(onlyRow().outcome).toBe(HuntressIncidentReportOutcome.Opening);
    expect(onlyRow().appliedMessageIds).toEqual([]);
    expect(incidents).toHaveLength(0);

    const later: Date = new Date(NOW.getTime() + 5 * 60 * 1000);
    const retried: HuntressReportResult = await receive(
      getHuntressIncidentReportBody(),
      "msg_1",
      getSettings(),
      later,
    );

    expect(retried.action).toBe(HuntressReportAction.IncidentOpened);
    expect(incidents).toHaveLength(1);
  });

  test("a claim the next delivery finds already closed opens nothing", async () => {
    reportRows.push(
      Object.assign(new HuntressIncidentReport(), {
        _id: nextId().toString(),
        projectId: PROJECT_ID,
        huntressConnectionId: CONNECTION_ID,
        huntressAccountId: "5",
        huntressIncidentReportId: "1234",
        outcome: HuntressIncidentReportOutcome.Opening,
        updatedAt: new Date(NOW.getTime() - 10 * 60 * 1000),
        appliedMessageIds: [],
      }),
    );

    const result: HuntressReportResult = await receive(
      getHuntressClosedBody(),
      "msg_closed",
    );

    expect(result.outcome).toBe(
      HuntressIncidentReportOutcome.ClosedBeforeReceived,
    );
    expect(incidents).toHaveLength(0);
  });
});

describe("the incident's severity", () => {
  test.each([
    [HuntressSeverity.Critical, SEVERITY_CRITICAL],
    [HuntressSeverity.High, SEVERITY_MAJOR],
    [HuntressSeverity.Low, SEVERITY_MINOR],
  ])("a %s report opens at the project's severity of the same rank", async (severity: HuntressSeverity, expected: string) => {
    await receive(getHuntressIncidentReportBody({ severity }), "msg_1");

    expect(onlyIncident().data.incidentSeverityId?.toString()).toBe(expected);
  });

  test("a severity the connection picked wins", async () => {
    severities.push({ id: SEVERITY_CUSTOM, order: 4 });

    await receive(
      getHuntressIncidentReportBody({ severity: "critical" }),
      "msg_1",
      getSettings({
        criticalIncidentSeverityId: new ObjectID(SEVERITY_CUSTOM),
      }),
    );

    expect(onlyIncident().data.incidentSeverityId?.toString()).toBe(
      SEVERITY_CUSTOM,
    );
  });

  test("each Huntress severity reads its own pick", async () => {
    severities.push({ id: SEVERITY_CUSTOM, order: 4 });
    const settings: HuntressConnectionSettings = getSettings({
      highIncidentSeverityId: new ObjectID(SEVERITY_MINOR),
      lowIncidentSeverityId: new ObjectID(SEVERITY_CUSTOM),
    });

    await receive(getHuntressIncidentReportBody({ id: 1, severity: "high" }), "m1", settings);
    await receive(getHuntressIncidentReportBody({ id: 2, severity: "low" }), "m2", settings);
    await receive(getHuntressIncidentReportBody({ id: 3, severity: "critical" }), "m3", settings);

    expect(
      incidents.map((incident: FakeIncident): string => {
        return incident.data.incidentSeverityId!.toString();
      }),
    ).toEqual([SEVERITY_MINOR, SEVERITY_CUSTOM, SEVERITY_CRITICAL]);
  });

  test("a picked severity the project no longer has falls back to rank", async () => {
    await receive(
      getHuntressIncidentReportBody({ severity: "high" }),
      "msg_1",
      getSettings({
        highIncidentSeverityId: new ObjectID(SEVERITY_CUSTOM),
      }),
    );

    expect(onlyIncident().data.incidentSeverityId?.toString()).toBe(
      SEVERITY_MAJOR,
    );
  });

  test("with fewer severities than Huntress has, low reports open at the least severe", async () => {
    severities = [
      { id: SEVERITY_CRITICAL, order: 1 },
      { id: SEVERITY_MAJOR, order: 2 },
    ];

    await receive(getHuntressIncidentReportBody({ severity: "low" }), "msg_1");

    expect(onlyIncident().data.incidentSeverityId?.toString()).toBe(
      SEVERITY_MAJOR,
    );
  });

  test("ranks follow the severities' order, not the order they were made in", async () => {
    severities = [
      { id: SEVERITY_MINOR, order: 3 },
      { id: SEVERITY_CRITICAL, order: 1 },
      { id: SEVERITY_MAJOR, order: 2 },
    ];

    await receive(getHuntressIncidentReportBody({ severity: "critical" }), "msg_1");

    expect(onlyIncident().data.incidentSeverityId?.toString()).toBe(
      SEVERITY_CRITICAL,
    );
  });

  test("a report without a severity Huntress documents opens as High", async () => {
    await receive(
      getHuntressIncidentReportBody({ severity: "medium" }),
      "msg_1",
    );

    expect(onlyIncident().data.incidentSeverityId?.toString()).toBe(
      SEVERITY_MAJOR,
    );
    expect(onlyRow().pagedOnCall).toBe(true);
    expect(onlyIncident().data.description).toContain(
      "**Severity in Huntress:** High",
    );
  });

  test("a project with no incident severity cannot open one, and says how to fix it", async () => {
    severities = [];

    await expect(
      receive(getHuntressIncidentReportBody(), "msg_1"),
    ).rejects.toThrow(
      "This project has no incident severities, so a Huntress report cannot open an incident. Add one under Incidents > Settings > Incident Severity.",
    );
    expect(onlyRow().outcome).toBe(HuntressIncidentReportOutcome.Opening);
  });
});

describe("paging on-call", () => {
  test.each([
    // [report severity, Page On-Call For, pages]
    ["critical", HuntressSeverity.High, true],
    ["high", HuntressSeverity.High, true],
    ["low", HuntressSeverity.High, false],
    ["critical", HuntressSeverity.Critical, true],
    ["high", HuntressSeverity.Critical, false],
    ["low", HuntressSeverity.Low, true],
  ])("a %s report with Page On-Call For at %s pages: %s", async (severity: string, threshold: HuntressSeverity, pages: boolean) => {
    await receive(
      getHuntressIncidentReportBody({ severity }),
      "msg_1",
      getSettings({
        pageOnCallFor: threshold,
        onCallDutyPolicyIds: [POLICY_ID, SECOND_POLICY_ID],
      }),
    );

    expect(
      idsOf(onlyIncident().data.onCallDutyPolicies as Array<OnCallDutyPolicy>),
    ).toEqual(pages ? [POLICY_ID.toString(), SECOND_POLICY_ID.toString()] : []);
    expect(onlyRow().pagedOnCall).toBe(pages);
  });

  test("a connection without on-call policies opens incidents that page nobody", async () => {
    await receive(
      getHuntressIncidentReportBody({ severity: "critical" }),
      "msg_1",
      getSettings({ onCallDutyPolicyIds: [] }),
    );

    expect(onlyIncident().data.onCallDutyPolicies).toEqual([]);
    expect(onlyRow().pagedOnCall).toBe(false);
  });

  test("a low report still opens an incident when it does not page", async () => {
    const result: HuntressReportResult = await receive(
      getHuntressIncidentReportBody({ severity: "low" }),
      "msg_1",
    );

    expect(result.action).toBe(HuntressReportAction.IncidentOpened);
    expect(onlyIncident().data.incidentSeverityId?.toString()).toBe(
      SEVERITY_MINOR,
    );
  });
});

describe("the organizations a connection watches", () => {
  const watchingGlobex: HuntressConnectionSettings = getSettings({
    watchedOrganizations: ["Globex", "99"],
  });

  test("a report from an organization it does not watch opens nothing, and says why", async () => {
    const result: HuntressReportResult = await receive(
      getHuntressIncidentReportBody(),
      "msg_1",
      watchingGlobex,
    );

    expect(result).toEqual({
      action: HuntressReportAction.Skipped,
      outcome: HuntressIncidentReportOutcome.OrganizationNotWatched,
      incidentId: null,
    });
    expect(incidents).toHaveLength(0);
    expect(onlyRow().outcome).toBe(
      HuntressIncidentReportOutcome.OrganizationNotWatched,
    );
    expect(onlyRow().organizationName).toBe("Acme Corp");
    expect(onlyRow().appliedMessageIds).toEqual(["msg_1"]);
  });

  test("later events about a skipped report change nothing", async () => {
    await receive(getHuntressIncidentReportBody(), "msg_1", watchingGlobex);
    const comment: HuntressReportResult = await receive(
      getHuntressCommentBody("Any update?"),
      "msg_2",
      watchingGlobex,
    );
    const closed: HuntressReportResult = await receive(
      getHuntressClosedBody(),
      "msg_3",
      watchingGlobex,
    );

    expect(comment.action).toBe(HuntressReportAction.Skipped);
    expect(closed.action).toBe(HuntressReportAction.Skipped);
    expect(incidents).toHaveLength(0);
    expect(notes).toHaveLength(0);
    expect(timelines).toHaveLength(0);
  });

  test("a watched organization, by name or by id, opens its incident", async () => {
    await receive(
      getHuntressIncidentReportBody(),
      "msg_1",
      getSettings({ watchedOrganizations: ["acme corp"] }),
    );
    await receive(
      getHuntressIdentityReportBody(),
      "msg_2",
      getSettings({ watchedOrganizations: ["4"] }),
    );

    expect(incidents).toHaveLength(2);
  });
});

describe("a report already closed when it arrives", () => {
  test("opens nothing", async () => {
    const result: HuntressReportResult = await receive(
      getHuntressClosedBody(),
      "msg_1",
    );

    expect(result).toEqual({
      action: HuntressReportAction.Skipped,
      outcome: HuntressIncidentReportOutcome.ClosedBeforeReceived,
      incidentId: null,
    });
    expect(incidents).toHaveLength(0);
  });

  test("its created event arriving after the closed one opens nothing either", async () => {
    await receive(getHuntressClosedBody(), "msg_closed");
    await receive(getHuntressIncidentReportBody(), "msg_created");

    expect(incidents).toHaveLength(0);
    expect(onlyRow().outcome).toBe(
      HuntressIncidentReportOutcome.ClosedBeforeReceived,
    );
  });

  test("a dismissed report first heard of through a comment opens nothing", async () => {
    await receive(
      getHuntressCommentBody("False positive.", { status: "dismissed" }),
      "msg_1",
    );

    expect(incidents).toHaveLength(0);
  });
});

describe("closing the report in Huntress", () => {
  test("resolves the incident, saying why on its timeline", async () => {
    await receive(getHuntressIncidentReportBody(), "msg_1");
    const closed: HuntressReportResult = await receive(
      getHuntressClosedBody(),
      "msg_2",
    );

    expect(closed).toEqual({
      action: HuntressReportAction.IncidentResolved,
      outcome: HuntressIncidentReportOutcome.IncidentResolved,
      incidentId: onlyIncident().id,
    });
    expect(timelines).toHaveLength(1);
    expect(timelines[0]!.incidentId?.toString()).toBe(
      onlyIncident().id.toString(),
    );
    expect(timelines[0]!.incidentStateId?.toString()).toBe(RESOLVED_STATE);
    expect(timelines[0]!.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(timelines[0]!.rootCause).toBe(
      "Resolved because Huntress closed incident report 1234 (status: closed).",
    );
    expect(onlyRow().status).toBe("closed");
    expect(onlyRow().outcome).toBe(HuntressIncidentReportOutcome.IncidentResolved);
  });

  test.each(["dismissed", "partner_dismissed", "deleting"])(
    "a %s report resolves the incident too",
    async (status: string) => {
      await receive(getHuntressIncidentReportBody(), "msg_1");
      await receive(getHuntressClosedBody({ status }), "msg_2");

      expect(timelines).toHaveLength(1);
      expect(timelines[0]!.rootCause).toBe(
        `Resolved because Huntress closed incident report 1234 (status: ${status}).`,
      );
    },
  );

  test("resolves once, however many closing events follow", async () => {
    await receive(getHuntressIncidentReportBody(), "msg_1");
    await receive(getHuntressClosedBody(), "msg_2");
    const again: HuntressReportResult = await receive(
      getHuntressClosedBody(),
      "msg_3",
    );
    await receive(
      getHuntressCommentBody("Closing note.", { status: "closed" }),
      "msg_4",
    );

    expect(again.action).toBe(HuntressReportAction.NothingToDo);
    expect(timelines).toHaveLength(1);
  });

  test("leaves an incident someone already resolved as it is", async () => {
    await receive(getHuntressIncidentReportBody(), "msg_1");
    onlyIncident().currentIncidentStateId = RESOLVED_STATE;

    const closed: HuntressReportResult = await receive(
      getHuntressClosedBody(),
      "msg_2",
    );

    expect(closed.action).toBe(HuntressReportAction.NothingToDo);
    expect(closed.outcome).toBe(HuntressIncidentReportOutcome.IncidentResolved);
    expect(timelines).toHaveLength(0);
  });

  test("an incident resolved meanwhile by someone else is not resolved twice", async () => {
    await receive(getHuntressIncidentReportBody(), "msg_1");

    jest
      .spyOn(IncidentStateTimelineService, "create")
      .mockImplementationOnce(async (): Promise<IncidentStateTimeline> => {
        throw new BadDataException(
          "Incident state cannot be same as previous state.",
        );
      });

    const closed: HuntressReportResult = await receive(
      getHuntressClosedBody(),
      "msg_2",
    );

    expect(closed.action).toBe(HuntressReportAction.NothingToDo);
    expect(closed.outcome).toBe(HuntressIncidentReportOutcome.IncidentResolved);
  });

  test("with the switch off, notes the closing once instead of resolving", async () => {
    const settings: HuntressConnectionSettings = getSettings({
      resolveIncidentWhenReportCloses: false,
    });

    await receive(getHuntressIncidentReportBody(), "msg_1", settings);
    const closed: HuntressReportResult = await receive(
      getHuntressClosedBody({ status: "dismissed" }),
      "msg_2",
      settings,
    );
    await receive(getHuntressClosedBody(), "msg_3", settings);

    expect(closed).toEqual({
      action: HuntressReportAction.NoteAdded,
      outcome: HuntressIncidentReportOutcome.IncidentOpened,
      incidentId: onlyIncident().id,
    });
    expect(timelines).toHaveLength(0);
    expect(notes).toHaveLength(1);
    expect(notes[0]!.note).toBe(
      "Huntress closed incident report 1234 (status: dismissed).",
    );
    expect(notes[0]!.incidentId?.toString()).toBe(onlyIncident().id.toString());
  });

  test("a deleted incident is left deleted", async () => {
    await receive(getHuntressIncidentReportBody(), "msg_1");
    // The foreign key clears the row's incident when the incident is deleted.
    onlyRow().incidentId = undefined;
    incidents = [];

    const closed: HuntressReportResult = await receive(
      getHuntressClosedBody(),
      "msg_2",
    );
    await receive(getHuntressCommentBody("Hello?"), "msg_3");

    expect(closed.action).toBe(HuntressReportAction.NothingToDo);
    expect(incidents).toHaveLength(0);
    expect(timelines).toHaveLength(0);
    expect(notes).toHaveLength(0);
  });
});

describe("comments added in Huntress", () => {
  test("become private notes on the incident", async () => {
    await receive(getHuntressIncidentReportBody(), "msg_1");
    const comment: HuntressReportResult = await receive(
      getHuntressCommentBody("We isolated the host."),
      "msg_2",
    );

    expect(comment.action).toBe(HuntressReportAction.NoteAdded);
    expect(notes).toHaveLength(1);
    expect(notes[0]!.note).toBe(
      "**Comment added in Huntress**\n\nWe isolated the host.",
    );
    expect(notes[0]!.projectId?.toString()).toBe(PROJECT_ID.toString());
  });

  test("a comment Huntress delivers twice is noted once", async () => {
    await receive(getHuntressIncidentReportBody(), "msg_1");
    await receive(getHuntressCommentBody("Once."), "msg_2");
    await receive(getHuntressCommentBody("Once."), "msg_2");

    expect(notes).toHaveLength(1);
  });

  test("a report first heard of through a comment opens its incident and keeps the comment", async () => {
    const result: HuntressReportResult = await receive(
      getHuntressCommentBody("First word from the SOC."),
      "msg_1",
    );

    expect(result.action).toBe(HuntressReportAction.IncidentOpened);
    expect(notes).toHaveLength(1);
    expect(notes[0]!.incidentId?.toString()).toBe(onlyIncident().id.toString());
  });

  test("a comment saying the report was dismissed is noted, and resolves the incident", async () => {
    await receive(getHuntressIncidentReportBody(), "msg_1");
    await receive(
      getHuntressCommentBody("Benign admin tool.", { status: "dismissed" }),
      "msg_2",
    );

    expect(notes).toHaveLength(1);
    expect(timelines).toHaveLength(1);
  });

  test("an empty comment adds no note", async () => {
    await receive(getHuntressIncidentReportBody(), "msg_1");
    await receive(getHuntressCommentBody("   "), "msg_2");

    expect(notes).toHaveLength(0);
  });
});

describe("a report row whose connection was deleted", () => {
  test("is taken up by the connection receiving it now, and opens nothing new", async () => {
    await receive(getHuntressIncidentReportBody(), "msg_1");
    onlyRow().huntressConnectionId = undefined;

    await receive(
      getHuntressCommentBody("Still there."),
      "msg_2",
      getSettings({ id: OTHER_CONNECTION_ID }),
    );

    expect(incidents).toHaveLength(1);
    expect(notes).toHaveLength(1);
    expect(onlyRow().huntressConnectionId?.toString()).toBe(
      OTHER_CONNECTION_ID.toString(),
    );
  });
});

describe("HuntressIncidentReportProcessor.getSettings", () => {
  test("reads a connection's settings", () => {
    const connection: HuntressConnection = new HuntressConnection();
    connection._id = CONNECTION_ID.toString();
    connection.projectId = PROJECT_ID;
    connection.pageOnCallFor = HuntressSeverity.Critical;
    connection.criticalIncidentSeverityId = new ObjectID(SEVERITY_CUSTOM);
    connection.watchedOrganizations = "Acme Corp\n\n 4 ";
    connection.resolveIncidentWhenReportCloses = false;
    const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
    policy._id = POLICY_ID.toString();
    connection.onCallDutyPolicies = [policy];
    const label: Label = new Label();
    label._id = CONNECTION_LABEL_ID.toString();
    connection.labels = [label];

    const settings: HuntressConnectionSettings =
      HuntressIncidentReportProcessor.getSettings(connection);

    expect(settings.id.toString()).toBe(CONNECTION_ID.toString());
    expect(settings.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(settings.pageOnCallFor).toBe(HuntressSeverity.Critical);
    expect(settings.criticalIncidentSeverityId?.toString()).toBe(SEVERITY_CUSTOM);
    expect(settings.highIncidentSeverityId).toBeNull();
    expect(settings.lowIncidentSeverityId).toBeNull();
    expect(settings.watchedOrganizations).toEqual(["Acme Corp", "4"]);
    expect(settings.resolveIncidentWhenReportCloses).toBe(false);
    expect(
      settings.onCallDutyPolicyIds.map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([POLICY_ID.toString()]);
    expect(
      settings.labelIds.map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([CONNECTION_LABEL_ID.toString()]);
  });

  test("an unknown Page On-Call For reads as High, and resolving is on unless switched off", () => {
    const connection: HuntressConnection = new HuntressConnection();
    connection._id = CONNECTION_ID.toString();
    connection.projectId = PROJECT_ID;
    connection.pageOnCallFor = "sometimes" as HuntressSeverity;

    const settings: HuntressConnectionSettings =
      HuntressIncidentReportProcessor.getSettings(connection);

    expect(settings.pageOnCallFor).toBe(HuntressSeverity.High);
    expect(settings.resolveIncidentWhenReportCloses).toBe(true);
    expect(settings.watchedOrganizations).toEqual([]);
    expect(settings.onCallDutyPolicyIds).toEqual([]);
  });

  test("a connection without a project is refused", () => {
    const connection: HuntressConnection = new HuntressConnection();
    connection._id = CONNECTION_ID.toString();

    expect(() => {
      HuntressIncidentReportProcessor.getSettings(connection);
    }).toThrow("The Huntress connection has no project.");
  });

  test("reads every column the processor needs from one select", () => {
    expect(Object.keys(HuntressIncidentReportProcessor.CONNECTION_SELECT)).toEqual([
      "_id",
      "projectId",
      "pageOnCallFor",
      "criticalIncidentSeverityId",
      "highIncidentSeverityId",
      "lowIncidentSeverityId",
      "watchedOrganizations",
      "resolveIncidentWhenReportCloses",
      "onCallDutyPolicies",
      "labels",
    ]);
  });
});
