/*
 * The module's services reach the native isolated-vm addon through their
 * imports. Nothing here runs a sandbox, and the prebuilt binary cannot
 * always dlopen in the test environment.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertInternalNote from "../../../../Models/DatabaseModels/AlertInternalNote";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentInternalNote from "../../../../Models/DatabaseModels/IncidentInternalNote";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import AlertInternalNoteService from "../../../../Server/Services/AlertInternalNoteService";
import AlertService from "../../../../Server/Services/AlertService";
import AlertStateService from "../../../../Server/Services/AlertStateService";
import IncidentInternalNoteService from "../../../../Server/Services/IncidentInternalNoteService";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentStateService from "../../../../Server/Services/IncidentStateService";
import IncomingEmailOpenForEveryEmail, {
  EMAIL_FINGERPRINT_PREFIX,
  EMAIL_MESSAGE_ID_FINGERPRINT_LABEL,
  EveryEmailMatches,
  MAX_OPENED_FROM_EMAILS_PER_HOUR,
  MAX_REPLY_NOTE_TEXT_LENGTH,
  REPLY_MEMORY_IN_DAYS,
  REPLY_MEMORY_NAMESPACE,
} from "../../../../Server/Utils/Monitor/IncomingEmailOpenForEveryEmail";
import OneUptimeDate from "../../../../Types/Date";
import Dictionary from "../../../../Types/Dictionary";
import DatabaseNotConnectedException from "../../../../Types/Exception/DatabaseNotConnectedException";
import { JSONObject } from "../../../../Types/JSON";
import IncomingEmailMonitorRequest from "../../../../Types/Monitor/IncomingEmailMonitor/IncomingEmailMonitorRequest";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorEvaluationSummary, {
  MonitorEvaluationEvent,
} from "../../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import MetricSeriesFingerprint from "../../../../Utils/Metrics/MetricSeriesFingerprint";
import FeedMarkdown from "../../../../Utils/Markdown/FeedMarkdown";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { FindOperator } from "typeorm";
import { FastestRun, fastestRun } from "../../../Helpers/FastestRun";

/*
 * An Incoming Email monitor's criteria that opens an incident for every
 * email, decided email by email: what the incident and alert creators are
 * handed, what a reply leaves on what its thread opened, and what the
 * evaluation summary - the email's row in Monitoring Logs - says when an
 * email opens nothing.
 *
 * The database is an in-memory table of the monitor's incidents and alerts,
 * read through the real query operators (QueryHelper), so a lookup that is
 * not scoped to the monitor, or that only looks at open incidents, shows. The
 * cache (GlobalCache) is an in-memory map that can be taken down.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const OTHER_MONITOR_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);
const CRITERIA_ID: string = "6f1d7a4e-3c55-4b70-9a1e-5b2d2c9e0a11";
const ROOT_CAUSE: string = "**Created because the following criteria was met**";

// The project's states: Created and Acknowledged are open, Resolved is not.
const CREATED_STATE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const ACKNOWLEDGED_STATE_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const RESOLVED_STATE_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);

const NOW: Date = new Date("2026-10-15T12:00:00.000Z");

interface StoredRecord {
  id: ObjectID;
  monitorId: ObjectID;
  title: string;
  number: number;
  fingerprint: string | undefined;
  createdAt: Date;
  stateId: ObjectID;
}

interface FindCall {
  query: JSONObject;
  select: JSONObject;
  limit: number;
}

interface CachedValue {
  value: string;
  expiresInSeconds: number | undefined;
}

let incidents: Array<StoredRecord> = [];
let alerts: Array<StoredRecord> = [];
let incidentFinds: Array<FindCall> = [];
let alertFinds: Array<FindCall> = [];
let incidentCounts: Array<FindCall> = [];
let alertCounts: Array<FindCall> = [];
let incidentNotes: Array<IncidentInternalNote> = [];
let alertNotes: Array<AlertInternalNote> = [];
let cache: Map<string, CachedValue> = new Map<string, CachedValue>();
let cacheReads: number = 0;
let isCacheDown: boolean = false;

function fingerprintOf(messageId: string): string {
  return IncomingEmailOpenForEveryEmail.getEmailFingerprint(messageId);
}

function stored(input: {
  messageId?: string | undefined;
  fingerprint?: string | undefined;
  title?: string | undefined;
  number: number;
  minutesAgo?: number | undefined;
  isResolved?: boolean | undefined;
  isAcknowledged?: boolean | undefined;
  monitorId?: ObjectID | undefined;
}): StoredRecord {
  return {
    id: ObjectID.generate(),
    monitorId: input.monitorId || MONITOR_ID,
    title: input.title || `Record ${input.number}`,
    number: input.number,
    fingerprint:
      input.fingerprint ||
      (input.messageId ? fingerprintOf(input.messageId) : undefined),
    createdAt: OneUptimeDate.addRemoveMinutes(NOW, -(input.minutesAgo || 1)),
    stateId: input.isResolved
      ? RESOLVED_STATE_ID
      : input.isAcknowledged
        ? ACKNOWLEDGED_STATE_ID
        : CREATED_STATE_ID,
  };
}

function resolve(record: StoredRecord): void {
  record.stateId = RESOLVED_STATE_ID;
}

// The SQL a QueryHelper operator stands for, on a column named "c".
function sqlOf(operator: unknown): string {
  const getSql: ((alias: string) => string) | undefined = (
    operator as FindOperator<unknown>
  ).getSql;

  return getSql ? getSql("c") : "";
}

function parametersOf(operator: unknown): Array<unknown> {
  return Object.values(
    (operator as FindOperator<unknown>).objectLiteralParameters || {},
  );
}

function wantedValues(operator: unknown): Array<string> {
  expect(sqlOf(operator)).toContain(" IN ");

  return (parametersOf(operator)[0] as Array<unknown>).map(
    (value: unknown): string => {
      return String(value);
    },
  );
}

// The stored records a find or count over a monitor's incidents or alerts reads.
function read(
  records: Array<StoredRecord>,
  query: JSONObject,
  limit: number | undefined,
): Array<StoredRecord> {
  const monitorIds: Array<ObjectID> | undefined = query["monitors"]
    ? (query["monitors"] as unknown as Array<ObjectID>)
    : query["monitorId"]
      ? [query["monitorId"] as unknown as ObjectID]
      : undefined;

  // Every read is scoped to one monitor of the project.
  expect(monitorIds).toHaveLength(1);
  expect((query["projectId"] as unknown as ObjectID).toString()).toBe(
    PROJECT_ID.toString(),
  );

  let rows: Array<StoredRecord> = records.filter(
    (row: StoredRecord): boolean => {
      return row.monitorId.toString() === monitorIds![0]!.toString();
    },
  );

  const id: unknown = query["_id"];

  if (id !== undefined) {
    const wanted: Array<string> = wantedValues(id);

    rows = rows.filter((row: StoredRecord): boolean => {
      return wanted.includes(row.id.toString());
    });
  }

  const fingerprint: unknown = query["seriesFingerprint"];

  if (fingerprint !== undefined) {
    const sql: string = sqlOf(fingerprint);

    if (sql.includes(" IN ")) {
      const wanted: Array<string> = wantedValues(fingerprint);

      rows = rows.filter((row: StoredRecord): boolean => {
        return Boolean(row.fingerprint) && wanted.includes(row.fingerprint!);
      });
    } else if (sql.includes("ILIKE")) {
      const pattern: string = parametersOf(fingerprint)[0] as string;

      // A prefix: no wildcard but the "%" that ends it.
      expect(pattern.endsWith("%")).toBe(true);
      const prefix: string = pattern.slice(0, -1);
      expect(prefix.includes("%") || prefix.includes("_")).toBe(false);

      rows = rows.filter((row: StoredRecord): boolean => {
        return (row.fingerprint || "")
          .toLowerCase()
          .startsWith(prefix.toLowerCase());
      });
    } else {
      throw new Error(`Unexpected fingerprint filter: ${sql}`);
    }
  }

  const createdAt: unknown = query["createdAt"];

  if (createdAt !== undefined) {
    expect(sqlOf(createdAt)).toContain(">=");
    const since: Date = parametersOf(createdAt)[0] as Date;

    rows = rows.filter((row: StoredRecord): boolean => {
      return row.createdAt.getTime() >= since.getTime();
    });
  }

  return rows
    .sort((a: StoredRecord, b: StoredRecord): number => {
      return b.createdAt.getTime() - a.createdAt.getTime();
    })
    .slice(0, limit ?? Infinity);
}

function toIncident(row: StoredRecord): Incident {
  const incident: Incident = new Incident();
  incident.id = row.id;
  incident.title = row.title;
  incident.incidentNumber = row.number;
  incident.incidentNumberWithPrefix = `INC-${row.number}`;
  incident.createdAt = row.createdAt;
  incident.currentIncidentStateId = row.stateId;

  if (row.fingerprint) {
    incident.seriesFingerprint = row.fingerprint;
  }

  return incident;
}

function toAlert(row: StoredRecord): Alert {
  const alert: Alert = new Alert();
  alert.id = row.id;
  alert.title = row.title;
  alert.alertNumber = row.number;
  alert.alertNumberWithPrefix = `ALT-${row.number}`;
  alert.createdAt = row.createdAt;
  alert.currentAlertStateId = row.stateId;

  if (row.fingerprint) {
    alert.seriesFingerprint = row.fingerprint;
  }

  return alert;
}

function monitor(
  monitorType: MonitorType = MonitorType.IncomingEmail,
  monitorId: ObjectID = MONITOR_ID,
): Monitor {
  const model: Monitor = new Monitor();
  model.id = monitorId;
  model.projectId = PROJECT_ID;
  model.monitorType = monitorType;
  model.name = "IT help desk";
  return model;
}

function criteria(
  options: {
    openForEveryEmail?: boolean | undefined;
    createIncidents?: boolean | undefined;
    createAlerts?: boolean | undefined;
  } = {},
): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data!.id = CRITERIA_ID;
  instance.data!.name = "Reported by email";
  instance.data!.createIncidents = options.createIncidents ?? true;
  instance.data!.createAlerts = options.createAlerts ?? false;

  if (options.openForEveryEmail ?? true) {
    instance.data!.openForEveryEmail = true;
  }

  return instance;
}

function email(
  headers: Dictionary<string>,
  options: {
    body?: string | undefined;
    from?: string | undefined;
    onlyCheckForIncomingEmailReceivedAt?: boolean | undefined;
  } = {},
): IncomingEmailMonitorRequest {
  return {
    projectId: PROJECT_ID,
    monitorId: MONITOR_ID,
    emailFrom: options.from ?? "reporter@acme.example",
    emailTo: "help@inbound.oneuptime.example",
    emailSubject: "Printer on floor 3 is down",
    emailBody: options.body ?? "It shows error 41.",
    emailHeaders: headers,
    emailReceivedAt: NOW,
    checkedAt: NOW,
    onlyCheckForIncomingEmailReceivedAt:
      options.onlyCheckForIncomingEmailReceivedAt ?? false,
  };
}

function summary(): MonitorEvaluationSummary {
  return { evaluatedAt: NOW, criteriaResults: [], events: [] };
}

async function decide(input: {
  request: IncomingEmailMonitorRequest;
  criteriaInstance?: MonitorCriteriaInstance | undefined;
  monitorModel?: Monitor | undefined;
  evaluationSummary?: MonitorEvaluationSummary | undefined;
}): Promise<EveryEmailMatches> {
  return await IncomingEmailOpenForEveryEmail.getMatches({
    monitor: input.monitorModel || monitor(),
    criteriaInstance: input.criteriaInstance || criteria(),
    dataToProcess: input.request,
    rootCause: ROOT_CAUSE,
    evaluationSummary: input.evaluationSummary,
  });
}

/*
 * What a creator does with what it is handed: opens one record per match,
 * carrying the match's fingerprint.
 */
function open(
  matches: Array<{ fingerprint: string }> | undefined,
  into: Array<StoredRecord>,
  number: number,
): Array<StoredRecord> {
  const opened: Array<StoredRecord> = (matches || []).map(
    (match: { fingerprint: string }): StoredRecord => {
      return stored({ fingerprint: match.fingerprint, number: number });
    },
  );

  into.push(...opened);
  return opened;
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);

  incidents = [];
  alerts = [];
  incidentFinds = [];
  alertFinds = [];
  incidentCounts = [];
  alertCounts = [];
  incidentNotes = [];
  alertNotes = [];
  cache = new Map<string, CachedValue>();
  cacheReads = 0;
  isCacheDown = false;

  jest.spyOn(IncidentService, "findBy").mockImplementation((async (
    findBy: FindCall,
  ): Promise<Array<Incident>> => {
    incidentFinds.push(findBy);
    return read(incidents, findBy.query, findBy.limit).map(toIncident);
  }) as never);

  jest.spyOn(AlertService, "findBy").mockImplementation((async (
    findBy: FindCall,
  ): Promise<Array<Alert>> => {
    alertFinds.push(findBy);
    return read(alerts, findBy.query, findBy.limit).map(toAlert);
  }) as never);

  jest.spyOn(IncidentService, "countBy").mockImplementation((async (
    countBy: FindCall,
  ): Promise<PositiveNumber> => {
    incidentCounts.push(countBy);
    return new PositiveNumber(
      read(incidents, countBy.query, countBy.limit).length,
    );
  }) as never);

  jest.spyOn(AlertService, "countBy").mockImplementation((async (
    countBy: FindCall,
  ): Promise<PositiveNumber> => {
    alertCounts.push(countBy);
    return new PositiveNumber(
      read(alerts, countBy.query, countBy.limit).length,
    );
  }) as never);

  jest
    .spyOn(IncidentStateService, "getUnresolvedIncidentStateIds")
    .mockImplementation((async (
      projectId: ObjectID,
    ): Promise<Array<ObjectID>> => {
      expect(projectId.toString()).toBe(PROJECT_ID.toString());
      return [CREATED_STATE_ID, ACKNOWLEDGED_STATE_ID];
    }) as never);

  jest
    .spyOn(AlertStateService, "getUnresolvedAlertStateIds")
    .mockImplementation((async (
      projectId: ObjectID,
    ): Promise<Array<ObjectID>> => {
      expect(projectId.toString()).toBe(PROJECT_ID.toString());
      return [CREATED_STATE_ID, ACKNOWLEDGED_STATE_ID];
    }) as never);

  jest
    .spyOn(IncidentInternalNoteService, "create")
    .mockImplementation((async (createBy: {
      data: IncidentInternalNote;
    }): Promise<IncidentInternalNote> => {
      incidentNotes.push(createBy.data);
      return createBy.data;
    }) as never);

  jest
    .spyOn(AlertInternalNoteService, "create")
    .mockImplementation((async (createBy: {
      data: AlertInternalNote;
    }): Promise<AlertInternalNote> => {
      alertNotes.push(createBy.data);
      return createBy.data;
    }) as never);

  jest.spyOn(GlobalCache, "getStrings").mockImplementation((async (
    namespace: string,
    keys: Array<string>,
  ): Promise<Array<string | null>> => {
    cacheReads++;

    if (isCacheDown) {
      throw new DatabaseNotConnectedException("Cache is not connected");
    }

    return keys.map((key: string): string | null => {
      return cache.get(`${namespace}-${key}`)?.value ?? null;
    });
  }) as never);

  jest.spyOn(GlobalCache, "setString").mockImplementation((async (
    namespace: string,
    key: string,
    value: string,
    options?: { expiresInSeconds?: number | undefined },
  ): Promise<void> => {
    if (isCacheDown) {
      throw new DatabaseNotConnectedException("Cache is not connected");
    }

    cache.set(`${namespace}-${key}`, {
      value: value,
      expiresInSeconds: options?.expiresInSeconds,
    });
  }) as never);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

function eventsOf(evaluationSummary: MonitorEvaluationSummary): Array<string> {
  return evaluationSummary.events.map(
    (event: MonitorEvaluationEvent): string => {
      return `${event.type}: ${event.title}`;
    },
  );
}

function notedIncidentIds(): Array<string> {
  return incidentNotes.map((note: IncidentInternalNote): string => {
    return note.incidentId!.toString();
  });
}

describe("When the criteria does not open one for every email, nothing changes", () => {
  it("the switch off: the creators work one at a time, and nothing is read", async () => {
    expect(
      await decide({
        request: email({ "Message-ID": "<a@acme.example>" }),
        criteriaInstance: criteria({ openForEveryEmail: false }),
      }),
    ).toEqual({});
    expect(incidentFinds).toEqual([]);
    expect(alertFinds).toEqual([]);
    expect(incidentCounts).toEqual([]);
    expect(cacheReads).toBe(0);
  });

  it("another monitor type: the switch means nothing there", async () => {
    for (const monitorType of [
      MonitorType.IncomingRequest,
      MonitorType.Website,
      MonitorType.Logs,
    ]) {
      expect(
        await decide({
          request: email({ "Message-ID": "<a@acme.example>" }),
          monitorModel: monitor(monitorType),
        }),
      ).toEqual({});
    }

    expect(incidentFinds).toEqual([]);
    expect(cacheReads).toBe(0);
  });

  it("a criteria that opens neither incidents nor alerts", async () => {
    expect(
      await decide({
        request: email({ "Message-ID": "<a@acme.example>" }),
        criteriaInstance: criteria({
          createIncidents: false,
          createAlerts: false,
        }),
      }),
    ).toEqual({});
  });

  it("a scheduled check, which has no email of its own, opens one at a time", async () => {
    expect(
      await decide({
        request: email(
          { "Message-ID": "<last@acme.example>" },
          { onlyCheckForIncomingEmailReceivedAt: true },
        ),
      }),
    ).toEqual({});
    expect(incidentFinds).toEqual([]);
    expect(cacheReads).toBe(0);
  });
});

describe("A new email opens its own incident", () => {
  it("hands the incident creator the email's own match", async () => {
    const matches: EveryEmailMatches = await decide({
      request: email({ "Message-ID": "<report-1@acme.example>" }),
    });

    expect(matches).toEqual({
      incidents: [
        {
          criteriaMetId: CRITERIA_ID,
          fingerprint: fingerprintOf("report-1@acme.example"),
          labels: {},
          rootCause: ROOT_CAUSE,
        },
      ],
    });
  });

  it("while other emails' incidents are open: each email is its own report", async () => {
    incidents = [
      stored({ messageId: "report-1@acme.example", number: 1 }),
      stored({ messageId: "report-2@acme.example", number: 2 }),
    ];

    const matches: EveryEmailMatches = await decide({
      request: email({ "Message-ID": "<report-3@acme.example>" }),
    });

    expect(matches.incidents).toHaveLength(1);
    expect(matches.incidents![0]!.fingerprint).toBe(
      fingerprintOf("report-3@acme.example"),
    );
  });

  it("an alert too, when the criteria opens alerts, and only what the criteria opens", async () => {
    const both: EveryEmailMatches = await decide({
      request: email({ "Message-ID": "<report-1@acme.example>" }),
      criteriaInstance: criteria({ createIncidents: true, createAlerts: true }),
    });

    expect(both.incidents).toHaveLength(1);
    expect(both.alerts).toHaveLength(1);
    expect(both.alerts![0]!.fingerprint).toBe(both.incidents![0]!.fingerprint);

    const alertsOnly: EveryEmailMatches = await decide({
      request: email({ "Message-ID": "<report-2@acme.example>" }),
      criteriaInstance: criteria({
        createIncidents: false,
        createAlerts: true,
      }),
    });

    expect(alertsOnly.incidents).toBeUndefined();
    expect(alertsOnly.alerts).toHaveLength(1);
  });

  it("gives no labels: they would be added to the title as the series' name", async () => {
    const matches: EveryEmailMatches = await decide({
      request: email({ "Message-ID": "<report-1@acme.example>" }),
    });

    expect(matches.incidents![0]!.labels).toEqual({});
  });

  it("an email without a Message-ID opens its own every time, as it cannot be told apart", async () => {
    const first: EveryEmailMatches = await decide({ request: email({}) });
    open(first.incidents, incidents, 1);
    const second: EveryEmailMatches = await decide({ request: email({}) });

    expect(first.incidents).toHaveLength(1);
    expect(second.incidents).toHaveLength(1);
    expect(first.incidents![0]!.fingerprint).not.toBe(
      second.incidents![0]!.fingerprint,
    );
  });
});

describe("An email's fingerprint", () => {
  it("is the same for every delivery of an email, and differs between emails", () => {
    expect(fingerprintOf("a@acme.example")).toBe(
      fingerprintOf("a@acme.example"),
    );
    expect(fingerprintOf("a@acme.example")).not.toBe(
      fingerprintOf("b@acme.example"),
    );
  });

  it("is 'email:' and a hash of the Message-ID, computed the way a series' is", () => {
    expect(EMAIL_FINGERPRINT_PREFIX).toBe("email:");
    expect(fingerprintOf("a@acme.example")).toBe(
      `email:${MetricSeriesFingerprint.computeFingerprint({
        [EMAIL_MESSAGE_ID_FINGERPRINT_LABEL]: "a@acme.example",
      })}`,
    );
    expect(fingerprintOf("a@acme.example")).toMatch(/^email:[0-9a-f]{16}$/);
  });

  it("is never a series' fingerprint, which is a bare hash", () => {
    const series: Array<string> = [
      MetricSeriesFingerprint.computeFingerprint({ host: "db-1" }),
      MetricSeriesFingerprint.computeFingerprint({}),
      MetricSeriesFingerprint.WholeMonitorFingerprint,
    ];

    for (const fingerprint of series) {
      expect(fingerprint.startsWith(EMAIL_FINGERPRINT_PREFIX)).toBe(false);
    }
  });
});

describe("The same email delivered twice opens one", () => {
  it("finds what the first delivery opened, and opens nothing", async () => {
    incidents = [
      stored({
        messageId: "report-1@acme.example",
        number: 12,
        title: "Printer on floor 3 is down",
      }),
    ];
    const evaluationSummary: MonitorEvaluationSummary = summary();

    const matches: EveryEmailMatches = await decide({
      request: email({ "Message-ID": "<report-1@acme.example>" }),
      evaluationSummary,
    });

    expect(matches).toEqual({ incidents: [] });
    expect(eventsOf(evaluationSummary)).toEqual([
      "incident-skipped: Incident already opened for this email: Printer on floor 3 is down",
    ]);
    expect(evaluationSummary.events[0]).toEqual(
      expect.objectContaining({
        relatedCriteriaId: CRITERIA_ID,
        relatedIncidentId: incidents[0]!.id.toString(),
        relatedIncidentNumber: 12,
        relatedIncidentNumberWithPrefix: "INC-12",
        relatedIncidentCreatedAt: incidents[0]!.createdAt,
      }),
    );
    expect(incidentNotes).toEqual([]);
  });

  it("even after the incident it opened was resolved", async () => {
    incidents = [
      stored({
        messageId: "report-1@acme.example",
        number: 12,
        minutesAgo: 600,
        isResolved: true,
      }),
    ];

    expect(
      await decide({
        request: email({ "Message-ID": "<report-1@acme.example>" }),
      }),
    ).toEqual({ incidents: [] });
  });

  it("when the first delivery opened only an alert, it opens no incident either", async () => {
    alerts = [stored({ messageId: "report-1@acme.example", number: 4 })];
    const evaluationSummary: MonitorEvaluationSummary = summary();

    expect(
      await decide({
        request: email({ "Message-ID": "<report-1@acme.example>" }),
        criteriaInstance: criteria({
          createIncidents: true,
          createAlerts: true,
        }),
        evaluationSummary,
      }),
    ).toEqual({ incidents: [], alerts: [] });
    expect(eventsOf(evaluationSummary)).toEqual([
      "alert-skipped: Alert already opened for this email: Record 4",
    ]);
    expect(evaluationSummary.events[0]).toEqual(
      expect.objectContaining({
        relatedAlertId: alerts[0]!.id.toString(),
        relatedAlertNumber: 4,
        relatedAlertNumberWithPrefix: "ALT-4",
      }),
    );
  });

  it("reads only this monitor's records, in this project, open or resolved, with their state", async () => {
    await decide({
      request: email({ "Message-ID": "<report-1@acme.example>" }),
    });

    expect(incidentFinds[0]!.query).toEqual(
      expect.objectContaining({
        projectId: PROJECT_ID,
        monitors: [MONITOR_ID],
      }),
    );
    expect(Object.keys(incidentFinds[0]!.query)).not.toContain(
      "currentIncidentStateId",
    );
    expect(incidentFinds[0]!.select).toEqual(
      expect.objectContaining({
        seriesFingerprint: true,
        currentIncidentStateId: true,
      }),
    );
    expect(alertFinds[0]!.query).toEqual(
      expect.objectContaining({
        projectId: PROJECT_ID,
        monitorId: MONITOR_ID,
      }),
    );
    expect(Object.keys(alertFinds[0]!.query)).not.toContain(
      "currentAlertStateId",
    );
    expect(alertFinds[0]!.select).toEqual(
      expect.objectContaining({
        seriesFingerprint: true,
        currentAlertStateId: true,
      }),
    );
  });

  it("another monitor's incident for the same email does not count", async () => {
    incidents = [
      stored({
        messageId: "report-1@acme.example",
        number: 12,
        monitorId: OTHER_MONITOR_ID,
      }),
    ];

    expect(
      (
        await decide({
          request: email({ "Message-ID": "<report-1@acme.example>" }),
        })
      ).incidents,
    ).toHaveLength(1);
  });
});

describe("A reply is added to what its thread opened, while that is open", () => {
  it("adds the reply to the incident the email it answers opened, and opens nothing", async () => {
    incidents = [
      stored({
        messageId: "report-1@acme.example",
        number: 12,
        title: "Printer on floor 3 is down",
      }),
    ];
    const evaluationSummary: MonitorEvaluationSummary = summary();

    const matches: EveryEmailMatches = await decide({
      request: email(
        {
          "Message-ID": "<reply-1@acme.example>",
          "In-Reply-To": "<report-1@acme.example>",
          References: "<report-1@acme.example>",
        },
        { body: "Same here on floor 4.", from: "colleague@acme.example" },
      ),
      evaluationSummary,
    });

    expect(matches).toEqual({ incidents: [] });
    expect(incidentNotes).toHaveLength(1);
    expect(incidentNotes[0]!.incidentId?.toString()).toBe(
      incidents[0]!.id.toString(),
    );
    expect(incidentNotes[0]!.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(incidentNotes[0]!.note).toBe(
      IncomingEmailOpenForEveryEmail.getReplyNote({
        from: "colleague@acme.example",
        body: "Same here on floor 4.",
      }),
    );
    expect(eventsOf(evaluationSummary)).toEqual([
      "incident-skipped: Reply added to the incident as a note: Printer on floor 3 is down",
    ]);
    expect(evaluationSummary.events[0]).toEqual(
      expect.objectContaining({
        relatedCriteriaId: CRITERIA_ID,
        relatedIncidentId: incidents[0]!.id.toString(),
        relatedIncidentNumberWithPrefix: "INC-12",
      }),
    );
  });

  it("an acknowledged incident is still open", async () => {
    incidents = [
      stored({
        messageId: "report-1@acme.example",
        number: 12,
        isAcknowledged: true,
      }),
    ];

    expect(
      await decide({
        request: email({
          "Message-ID": "<reply-1@acme.example>",
          "In-Reply-To": "<report-1@acme.example>",
        }),
      }),
    ).toEqual({ incidents: [] });
    expect(incidentNotes).toHaveLength(1);
  });

  it("finds the incident through References alone: a reply to a reply", async () => {
    incidents = [stored({ messageId: "report-1@acme.example", number: 12 })];

    await decide({
      request: email({
        "Message-ID": "<reply-2@acme.example>",
        "In-Reply-To": "<reply-1@acme.example>",
        References: "<report-1@acme.example> <reply-1@acme.example>",
      }),
    });

    expect(notedIncidentIds()).toEqual([incidents[0]!.id.toString()]);
  });

  it("adds it to every incident and alert that email opened", async () => {
    const report: string = fingerprintOf("report-1@acme.example");
    incidents = [
      stored({ fingerprint: report, number: 12, title: "Template one" }),
      stored({ fingerprint: report, number: 13, title: "Template two" }),
    ];
    alerts = [stored({ fingerprint: report, number: 7 })];
    const evaluationSummary: MonitorEvaluationSummary = summary();

    expect(
      await decide({
        request: email({
          "Message-ID": "<reply-1@acme.example>",
          "In-Reply-To": "<report-1@acme.example>",
        }),
        criteriaInstance: criteria({
          createIncidents: true,
          createAlerts: true,
        }),
        evaluationSummary,
      }),
    ).toEqual({ incidents: [], alerts: [] });

    expect(notedIncidentIds().sort()).toEqual(
      [incidents[0]!.id.toString(), incidents[1]!.id.toString()].sort(),
    );
    expect(alertNotes).toHaveLength(1);
    expect(alertNotes[0]!.alertId?.toString()).toBe(alerts[0]!.id.toString());
    expect(alertNotes[0]!.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(eventsOf(evaluationSummary).sort()).toEqual(
      [
        "alert-skipped: Reply added to the alert as a note: Record 7",
        "incident-skipped: Reply added to the incident as a note: Template one",
        "incident-skipped: Reply added to the incident as a note: Template two",
      ].sort(),
    );
  });

  it("of two emails in the thread that opened incidents, answers the newer one", async () => {
    incidents = [
      stored({
        messageId: "old-report@acme.example",
        number: 1,
        minutesAgo: 90,
      }),
      stored({
        messageId: "new-report@acme.example",
        number: 2,
        minutesAgo: 5,
      }),
    ];

    await decide({
      request: email({
        "Message-ID": "<reply@acme.example>",
        References: "<old-report@acme.example> <new-report@acme.example>",
      }),
    });

    expect(notedIncidentIds()).toEqual([incidents[1]!.id.toString()]);
  });

  it("of a thread's open and resolved incidents, answers the open one", async () => {
    incidents = [
      stored({
        messageId: "old-report@acme.example",
        number: 1,
        minutesAgo: 90,
      }),
      stored({
        messageId: "new-report@acme.example",
        number: 2,
        minutesAgo: 5,
        isResolved: true,
      }),
    ];

    await decide({
      request: email({
        "Message-ID": "<reply@acme.example>",
        References: "<old-report@acme.example> <new-report@acme.example>",
      }),
    });

    expect(notedIncidentIds()).toEqual([incidents[0]!.id.toString()]);
  });

  it("a reply to an email that opened nothing here opens its own", async () => {
    const matches: EveryEmailMatches = await decide({
      request: email({
        "Message-ID": "<fwd@acme.example>",
        "In-Reply-To": "<someone-elses-thread@acme.example>",
      }),
    });

    expect(matches.incidents).toHaveLength(1);
    expect(matches.incidents![0]!.fingerprint).toBe(
      fingerprintOf("fwd@acme.example"),
    );
    expect(incidentNotes).toEqual([]);
  });
});

describe("A reply to a thread whose incidents are all resolved opens its own", () => {
  it("a new problem reported on an old thread pages again, and adds no note", async () => {
    incidents = [
      stored({
        messageId: "report-1@acme.example",
        number: 5,
        isResolved: true,
        minutesAgo: 60 * 24 * 30,
      }),
    ];
    const evaluationSummary: MonitorEvaluationSummary = summary();

    const matches: EveryEmailMatches = await decide({
      request: email(
        {
          "Message-ID": "<broken-again@acme.example>",
          "In-Reply-To": "<report-1@acme.example>",
          References: "<report-1@acme.example>",
        },
        { body: "It's broken again." },
      ),
      evaluationSummary,
    });

    expect(matches.incidents).toEqual([
      {
        criteriaMetId: CRITERIA_ID,
        fingerprint: fingerprintOf("broken-again@acme.example"),
        labels: {},
        rootCause: ROOT_CAUSE,
      },
    ]);
    expect(incidentNotes).toEqual([]);
    expect(evaluationSummary.events).toEqual([]);
    // Nothing to remember: the reply's own incident carries its fingerprint.
    expect(cache.size).toBe(0);
  });

  it("an alert too", async () => {
    alerts = [
      stored({
        messageId: "report-1@acme.example",
        number: 5,
        isResolved: true,
      }),
    ];

    const matches: EveryEmailMatches = await decide({
      request: email({
        "Message-ID": "<broken-again@acme.example>",
        "In-Reply-To": "<report-1@acme.example>",
      }),
      criteriaInstance: criteria({
        createIncidents: false,
        createAlerts: true,
      }),
    });

    expect(matches.alerts).toHaveLength(1);
    expect(alertNotes).toEqual([]);
  });

  it("then the replies to that reply are added to its new incident, not the old one", async () => {
    const old: StoredRecord = stored({
      messageId: "report-1@acme.example",
      number: 5,
      isResolved: true,
      minutesAgo: 600,
    });
    incidents = [old];

    const reopened: EveryEmailMatches = await decide({
      request: email({
        "Message-ID": "<broken-again@acme.example>",
        "In-Reply-To": "<report-1@acme.example>",
        References: "<report-1@acme.example>",
      }),
    });
    const [newIncident] = open(reopened.incidents, incidents, 6);

    expect(
      await decide({
        request: email({
          "Message-ID": "<on-it@acme.example>",
          "In-Reply-To": "<broken-again@acme.example>",
          References: "<report-1@acme.example> <broken-again@acme.example>",
        }),
      }),
    ).toEqual({ incidents: [] });
    expect(notedIncidentIds()).toEqual([newIncident!.id.toString()]);
  });

  it("a second delivery of the reply that opened it opens nothing more", async () => {
    incidents = [
      stored({
        messageId: "report-1@acme.example",
        number: 5,
        isResolved: true,
      }),
    ];
    const reply: IncomingEmailMonitorRequest = email({
      "Message-ID": "<broken-again@acme.example>",
      "In-Reply-To": "<report-1@acme.example>",
    });

    open((await decide({ request: reply })).incidents, incidents, 6);

    expect(await decide({ request: reply })).toEqual({ incidents: [] });
    expect(incidents).toHaveLength(2);
  });
});

describe("A reply added as a note is remembered by its Message-ID", () => {
  const report: Dictionary<string> = {
    "Message-ID": "<report-1@acme.example>",
  };

  function reply(
    messageId: string,
    inReplyTo: string,
    body: string = "Same here.",
  ): IncomingEmailMonitorRequest {
    return email(
      {
        "Message-ID": `<${messageId}>`,
        "In-Reply-To": `<${inReplyTo}>`,
      },
      { body: body },
    );
  }

  it("so the same reply delivered twice is noted once, and says why", async () => {
    incidents = [stored({ messageId: "report-1@acme.example", number: 12 })];
    const evaluationSummary: MonitorEvaluationSummary = summary();

    await decide({
      request: reply("reply-1@acme.example", "report-1@acme.example"),
    });
    expect(
      await decide({
        request: reply("reply-1@acme.example", "report-1@acme.example"),
        evaluationSummary,
      }),
    ).toEqual({ incidents: [] });

    expect(incidentNotes).toHaveLength(1);
    expect(evaluationSummary.events).toEqual([
      expect.objectContaining({
        type: "incident-skipped",
        title: "Incident creation skipped",
        message:
          "This reply was delivered before and was already added as a note, so it opened no incident.",
        relatedCriteriaId: CRITERIA_ID,
      }),
    ]);
  });

  it("...even after its incident was resolved: a second delivery is no new report", async () => {
    incidents = [stored({ messageId: "report-1@acme.example", number: 12 })];

    await decide({
      request: reply("reply-1@acme.example", "report-1@acme.example"),
    });
    resolve(incidents[0]!);

    expect(
      await decide({
        request: reply("reply-1@acme.example", "report-1@acme.example"),
      }),
    ).toEqual({ incidents: [] });
    expect(incidentNotes).toHaveLength(1);
  });

  it("two different replies with the same words are both noted", async () => {
    incidents = [stored({ messageId: "report-1@acme.example", number: 12 })];

    await decide({
      request: reply("plus-one-a@acme.example", "report-1@acme.example", "+1"),
    });
    await decide({
      request: reply("plus-one-b@acme.example", "report-1@acme.example", "+1"),
    });

    expect(incidentNotes).toHaveLength(2);
    expect(incidentNotes[0]!.note).toBe(incidentNotes[1]!.note);
  });

  it("two replies with no plain text, such as HTML-only mail, are both noted", async () => {
    incidents = [stored({ messageId: "report-1@acme.example", number: 12 })];

    await decide({
      request: reply("html-a@acme.example", "report-1@acme.example", ""),
    });
    await decide({
      request: reply("html-b@acme.example", "report-1@acme.example", ""),
    });

    expect(incidentNotes).toHaveLength(2);
    expect(incidentNotes[0]!.note).toContain(
      "_The reply has no text to show._",
    );
  });

  it("so a reply that names only the reply it answers finds the thread", async () => {
    incidents = [stored({ messageId: "report-1@acme.example", number: 12 })];

    await decide({
      request: reply("reply-1@acme.example", "report-1@acme.example"),
    });
    // Some mail programs leave References out, or cut it short.
    expect(
      await decide({
        request: reply("reply-2@acme.example", "reply-1@acme.example"),
      }),
    ).toEqual({ incidents: [] });
    // ...and so on down the thread.
    expect(
      await decide({
        request: reply("reply-3@acme.example", "reply-2@acme.example"),
      }),
    ).toEqual({ incidents: [] });

    expect(notedIncidentIds()).toEqual([
      incidents[0]!.id.toString(),
      incidents[0]!.id.toString(),
      incidents[0]!.id.toString(),
    ]);
  });

  it("...and every incident and alert the reply was added to", async () => {
    const fingerprint: string = fingerprintOf("report-1@acme.example");
    incidents = [
      stored({ fingerprint: fingerprint, number: 12 }),
      stored({ fingerprint: fingerprint, number: 13 }),
    ];
    alerts = [stored({ fingerprint: fingerprint, number: 7 })];
    const both: MonitorCriteriaInstance = criteria({
      createIncidents: true,
      createAlerts: true,
    });

    await decide({
      request: reply("reply-1@acme.example", "report-1@acme.example"),
      criteriaInstance: both,
    });
    await decide({
      request: reply("reply-2@acme.example", "reply-1@acme.example"),
      criteriaInstance: both,
    });

    expect(incidentNotes).toHaveLength(4);
    expect(alertNotes).toHaveLength(2);
  });

  it("once the thread's incident is resolved, a reply to a reply opens its own", async () => {
    incidents = [stored({ messageId: "report-1@acme.example", number: 12 })];

    await decide({
      request: reply("reply-1@acme.example", "report-1@acme.example"),
    });
    resolve(incidents[0]!);

    const matches: EveryEmailMatches = await decide({
      request: reply("reply-2@acme.example", "reply-1@acme.example"),
    });

    expect(matches.incidents).toHaveLength(1);
    expect(matches.incidents![0]!.fingerprint).toBe(
      fingerprintOf("reply-2@acme.example"),
    );
    expect(incidentNotes).toHaveLength(1);
  });

  it(`for ${REPLY_MEMORY_IN_DAYS} days, under this monitor`, async () => {
    incidents = [stored({ messageId: "report-1@acme.example", number: 12 })];

    await decide({
      request: reply("reply-1@acme.example", "report-1@acme.example"),
    });

    expect(Array.from(cache.entries())).toEqual([
      [
        `${REPLY_MEMORY_NAMESPACE}-${MONITOR_ID.toString()}:${fingerprintOf(
          "reply-1@acme.example",
        )}`,
        {
          value: JSON.stringify({
            incidentIds: [incidents[0]!.id.toString()],
            alertIds: [],
          }),
          expiresInSeconds: REPLY_MEMORY_IN_DAYS * 24 * 60 * 60,
        },
      ],
    ]);
    expect(REPLY_MEMORY_IN_DAYS).toBe(30);
  });

  it("another monitor does not read this monitor's memory", async () => {
    incidents = [stored({ messageId: "report-1@acme.example", number: 12 })];

    await decide({
      request: reply("reply-1@acme.example", "report-1@acme.example"),
    });

    // The same reply, sent to another monitor's address too.
    const elsewhere: EveryEmailMatches = await decide({
      request: reply("reply-1@acme.example", "report-1@acme.example"),
      monitorModel: monitor(MonitorType.IncomingEmail, OTHER_MONITOR_ID),
    });

    expect(elsewhere.incidents).toHaveLength(1);
    expect(incidentNotes).toHaveLength(1);
  });

  it("a reply without a Message-ID is noted, and nothing is remembered", async () => {
    incidents = [stored({ messageId: "report-1@acme.example", number: 12 })];

    await decide({
      request: email({ "In-Reply-To": "<report-1@acme.example>" }),
    });

    expect(incidentNotes).toHaveLength(1);
    expect(cache.size).toBe(0);
  });

  it("reads nothing from what is in the cache but a remembered reply", async () => {
    incidents = [stored({ messageId: "report-1@acme.example", number: 12 })];

    for (const [index, value] of [
      "not json",
      "[]",
      "null",
      JSON.stringify({ incidentIds: ["not-a-uuid", 5, null] }),
      JSON.stringify({ incidentIds: "x", alertIds: {} }),
    ].entries()) {
      cache.clear();
      cache.set(
        `${REPLY_MEMORY_NAMESPACE}-${MONITOR_ID.toString()}:${fingerprintOf(
          "reply-1@acme.example",
        )}`,
        { value: value, expiresInSeconds: undefined },
      );

      const matches: EveryEmailMatches = await decide({
        request: reply(`reply-2-${index}@acme.example`, "reply-1@acme.example"),
      });

      expect(matches.incidents).toHaveLength(1);
    }

    expect(incidentNotes).toEqual([]);
    expect(
      incidentFinds.some((find: FindCall): boolean => {
        return find.query["_id"] !== undefined;
      }),
    ).toBe(false);
  });

  it("the report itself was never a reply: an email that opened something is not remembered", async () => {
    await decide({ request: email(report) });

    expect(cache.size).toBe(0);
  });
});

describe("Without the cache", () => {
  it("a reply is still added to the open incident it answers", async () => {
    incidents = [stored({ messageId: "report-1@acme.example", number: 12 })];
    isCacheDown = true;

    expect(
      await decide({
        request: email({
          "Message-ID": "<reply-1@acme.example>",
          "In-Reply-To": "<report-1@acme.example>",
        }),
      }),
    ).toEqual({ incidents: [] });
    expect(incidentNotes).toHaveLength(1);
  });

  it("a second delivery of a reply is noted again, rather than lost or paged", async () => {
    incidents = [stored({ messageId: "report-1@acme.example", number: 12 })];
    isCacheDown = true;
    const reply: IncomingEmailMonitorRequest = email({
      "Message-ID": "<reply-1@acme.example>",
      "In-Reply-To": "<report-1@acme.example>",
    });

    await decide({ request: reply });
    expect(await decide({ request: reply })).toEqual({ incidents: [] });

    expect(incidentNotes).toHaveLength(2);
  });

  it("a new email still opens its own", async () => {
    isCacheDown = true;

    expect(
      (await decide({ request: email({ "Message-ID": "<new@acme.example>" }) }))
        .incidents,
    ).toHaveLength(1);
  });
});

describe("An automatic reply opens nothing", () => {
  it("an out-of-office message: no incident, no alert, no note, and nothing read", async () => {
    incidents = [stored({ messageId: "report-1@acme.example", number: 12 })];
    const evaluationSummary: MonitorEvaluationSummary = summary();

    expect(
      await decide({
        request: email({
          "Message-ID": "<ooo@acme.example>",
          "In-Reply-To": "<report-1@acme.example>",
          "Auto-Submitted": "auto-replied",
        }),
        criteriaInstance: criteria({
          createIncidents: true,
          createAlerts: true,
        }),
        evaluationSummary,
      }),
    ).toEqual({ incidents: [], alerts: [] });

    expect(incidentNotes).toEqual([]);
    expect(incidentFinds).toEqual([]);
    expect(cacheReads).toBe(0);
    expect(
      evaluationSummary.events.map((event: MonitorEvaluationEvent) => {
        return [event.type, event.title, event.message];
      }),
    ).toEqual([
      [
        "incident-skipped",
        "Incident creation skipped",
        "This email is an automatic reply, such as an out-of-office message, so it opened no incident.",
      ],
      [
        "alert-skipped",
        "Alert creation skipped",
        "This email is an automatic reply, such as an out-of-office message, so it opened no alert.",
      ],
    ]);
  });

  it("a report a monitoring system marks as auto-generated still opens one", async () => {
    expect(
      (
        await decide({
          request: email({
            "Message-ID": "<backup-failed@acme.example>",
            "Auto-Submitted": "auto-generated",
          }),
        })
      ).incidents,
    ).toHaveLength(1);
  });
});

describe(`A monitor opens at most ${MAX_OPENED_FROM_EMAILS_PER_HOUR} an hour from emails`, () => {
  function openedInTheHour(
    count: number,
    minutesAgo: number = 10,
  ): Array<StoredRecord> {
    return Array.from({ length: count }, (_: unknown, index: number) => {
      return stored({
        messageId: `flood-${index}@acme.example`,
        number: index + 1,
        minutesAgo,
      });
    });
  }

  it("opens one while it has opened fewer", async () => {
    incidents = openedInTheHour(MAX_OPENED_FROM_EMAILS_PER_HOUR - 1);

    expect(
      (await decide({ request: email({ "Message-ID": "<new@acme.example>" }) }))
        .incidents,
    ).toHaveLength(1);
  });

  it("opens none once it has opened that many, and says why", async () => {
    incidents = openedInTheHour(MAX_OPENED_FROM_EMAILS_PER_HOUR);
    const evaluationSummary: MonitorEvaluationSummary = summary();

    expect(
      await decide({
        request: email({ "Message-ID": "<new@acme.example>" }),
        evaluationSummary,
      }),
    ).toEqual({ incidents: [] });
    expect(evaluationSummary.events).toEqual([
      expect.objectContaining({
        type: "incident-skipped",
        title: "Incident creation skipped",
        message: `This monitor opened ${MAX_OPENED_FROM_EMAILS_PER_HOUR} incidents from emails in the past hour, the most it opens in an hour, so this email opened none.`,
        relatedCriteriaId: CRITERIA_ID,
      }),
    ]);
  });

  it("counts the past hour only", async () => {
    incidents = openedInTheHour(MAX_OPENED_FROM_EMAILS_PER_HOUR, 61);

    expect(
      (await decide({ request: email({ "Message-ID": "<new@acme.example>" }) }))
        .incidents,
    ).toHaveLength(1);
  });

  it("counts resolved ones too: the bound is on what was opened", async () => {
    incidents = openedInTheHour(MAX_OPENED_FROM_EMAILS_PER_HOUR);
    incidents.forEach(resolve);

    expect(
      (await decide({ request: email({ "Message-ID": "<new@acme.example>" }) }))
        .incidents,
    ).toEqual([]);
  });

  it("counts incidents and alerts apart", async () => {
    incidents = openedInTheHour(MAX_OPENED_FROM_EMAILS_PER_HOUR);
    const evaluationSummary: MonitorEvaluationSummary = summary();

    const matches: EveryEmailMatches = await decide({
      request: email({ "Message-ID": "<new@acme.example>" }),
      criteriaInstance: criteria({ createIncidents: true, createAlerts: true }),
      evaluationSummary,
    });

    expect(matches.incidents).toEqual([]);
    expect(matches.alerts).toHaveLength(1);
    expect(eventsOf(evaluationSummary)).toEqual([
      "incident-skipped: Incident creation skipped",
    ]);
  });

  it("an alert at its limit says so in an alert's words", async () => {
    alerts = openedInTheHour(MAX_OPENED_FROM_EMAILS_PER_HOUR);
    const evaluationSummary: MonitorEvaluationSummary = summary();

    expect(
      await decide({
        request: email({ "Message-ID": "<new@acme.example>" }),
        criteriaInstance: criteria({
          createIncidents: false,
          createAlerts: true,
        }),
        evaluationSummary,
      }),
    ).toEqual({ alerts: [] });
    expect(evaluationSummary.events[0]!.type).toBe("alert-skipped");
    expect(evaluationSummary.events[0]!.message).toBe(
      `This monitor opened ${MAX_OPENED_FROM_EMAILS_PER_HOUR} alerts from emails in the past hour, the most it opens in an hour, so this email opened none.`,
    );
  });

  it("counts what emails opened on this monitor in the past hour, and no more than it needs", async () => {
    await decide({
      request: email({ "Message-ID": "<new@acme.example>" }),
      criteriaInstance: criteria({ createIncidents: true, createAlerts: true }),
    });

    expect(incidentCounts).toHaveLength(1);
    expect(incidentCounts[0]!.query).toEqual(
      expect.objectContaining({
        projectId: PROJECT_ID,
        monitors: [MONITOR_ID],
      }),
    );
    expect(sqlOf(incidentCounts[0]!.query["seriesFingerprint"])).toContain(
      "ILIKE",
    );
    expect(parametersOf(incidentCounts[0]!.query["seriesFingerprint"])).toEqual(
      ["email:%"],
    );
    expect(parametersOf(incidentCounts[0]!.query["createdAt"])[0]).toEqual(
      OneUptimeDate.addRemoveHours(NOW, -1),
    );
    expect(incidentCounts[0]!.limit).toBe(MAX_OPENED_FROM_EMAILS_PER_HOUR);

    expect(alertCounts).toHaveLength(1);
    expect(alertCounts[0]!.query).toEqual(
      expect.objectContaining({
        projectId: PROJECT_ID,
        monitorId: MONITOR_ID,
      }),
    );
    expect(parametersOf(alertCounts[0]!.query["seriesFingerprint"])).toEqual([
      "email:%",
    ]);
    expect(alertCounts[0]!.limit).toBe(MAX_OPENED_FROM_EMAILS_PER_HOUR);
  });

  it("records keyed by anything but an email - a series, an SLO's burn rate - are not counted", async () => {
    incidents = [
      ...Array.from(
        { length: MAX_OPENED_FROM_EMAILS_PER_HOUR },
        (_: unknown, index: number): StoredRecord => {
          return stored({
            fingerprint: MetricSeriesFingerprint.computeFingerprint({
              host: `db-${index}`,
            }),
            number: index,
          });
        },
      ),
      ...Array.from(
        { length: MAX_OPENED_FROM_EMAILS_PER_HOUR },
        (_: unknown, index: number): StoredRecord => {
          return stored({
            fingerprint: `slo:${index}:burn-rule:1`,
            number: 100 + index,
          });
        },
      ),
      // One opened without a fingerprint, one at a time.
      stored({ number: 200 }),
    ];

    expect(
      (await decide({ request: email({ "Message-ID": "<new@acme.example>" }) }))
        .incidents,
    ).toHaveLength(1);
  });

  it("checks incidents and alerts at the same time", async () => {
    let isAlertCountStarted: boolean = false;
    // Whether the alert count had started when the incident count ended.
    let wasAlertCountStartedFirst: boolean = false;

    jest
      .spyOn(IncidentService, "countBy")
      .mockImplementation((async (): Promise<PositiveNumber> => {
        for (let tick: number = 0; tick < 5; tick++) {
          await Promise.resolve();
        }

        wasAlertCountStartedFirst = isAlertCountStarted;
        return new PositiveNumber(0);
      }) as never);

    jest
      .spyOn(AlertService, "countBy")
      .mockImplementation((async (): Promise<PositiveNumber> => {
        isAlertCountStarted = true;
        return new PositiveNumber(0);
      }) as never);

    const matches: EveryEmailMatches = await decide({
      request: email({ "Message-ID": "<new@acme.example>" }),
      criteriaInstance: criteria({ createIncidents: true, createAlerts: true }),
    });

    expect(matches.incidents).toHaveLength(1);
    expect(matches.alerts).toHaveLength(1);
    expect(wasAlertCountStartedFirst).toBe(true);
  });

  it("a flood of emails opens only the limit, however many arrive", async () => {
    let opened: number = 0;

    for (let index: number = 0; index < 60; index++) {
      const matches: EveryEmailMatches = await decide({
        request: email({ "Message-ID": `<flood-${index}@acme.example>` }),
      });

      opened += open(matches.incidents, incidents, index).length;
    }

    expect(opened).toBe(MAX_OPENED_FROM_EMAILS_PER_HOUR);
  });

  it("replies added as notes do not count: they opened nothing", async () => {
    incidents = [
      ...openedInTheHour(MAX_OPENED_FROM_EMAILS_PER_HOUR - 1),
      stored({ messageId: "report-1@acme.example", number: 100 }),
    ];

    for (let index: number = 0; index < 30; index++) {
      await decide({
        request: email({
          "Message-ID": `<reply-${index}@acme.example>`,
          "In-Reply-To": "<report-1@acme.example>",
        }),
      });
    }

    expect(incidentNotes).toHaveLength(30);
    expect(
      (await decide({ request: email({ "Message-ID": "<new@acme.example>" }) }))
        .incidents,
    ).toEqual([]);
  });
});

describe("The note a reply leaves", () => {
  it("names who replied first, then keeps the reply's lines and paragraphs", () => {
    const note: string = IncomingEmailOpenForEveryEmail.getReplyNote({
      from: "colleague@acme.example",
      body: "Still broken.\nIt shows error 41 again.\n\n\nThanks,\nPriya\n",
    });

    /*
     * Each line ends with a hard break, as a form's multi-line answer does:
     * a bare line break reads as a space, and "Thanks,\nPriya" read
     * "Thanks, Priya". A blank line, or a run of them, is one paragraph
     * break.
     */
    expect(note).toBe(
      [
        "**colleague@acme.example** replied by email:",
        "",
        "Still broken.  ",
        "It shows error 41 again.",
        "",
        "Thanks,  ",
        "Priya",
      ].join("\n"),
    );
  });

  it("leaves out the earlier emails the reply quotes: the incident has them", () => {
    const note: string = IncomingEmailOpenForEveryEmail.getReplyNote({
      from: "colleague@acme.example",
      body: [
        "Same here on floor 4.",
        "",
        "On Wed, Oct 15, 2026 at 9:02 AM Tom <tom@acme.example> wrote:",
        "> The printer on floor 2 shows E-17.",
      ].join("\n"),
    });

    expect(note).toBe(
      "**colleague@acme.example** replied by email:\n\nSame here on floor 4.",
    );
  });

  it("leaves out the email an Outlook reply quotes under its rule", () => {
    const note: string = IncomingEmailOpenForEveryEmail.getReplyNote({
      from: "facilities@acme.example",
      body: [
        "Fixed - wrong toner.",
        "________________________________",
        "From: Tom <tom@acme.example>",
        "Sent: Wednesday, October 15, 2026 9:02 AM",
        "",
        "The printer on floor 2 shows E-17.",
      ].join("\n"),
    });

    expect(FeedMarkdown.withoutInvisibleBreaks(note)).not.toContain("E-17");
    expect(note).toContain("Fixed - wrong toner.");
  });

  it("reads what the sender wrote as text: no link, image, heading, list or chat mention acts", () => {
    const body: string = [
      "# Heading",
      "[Click here](javascript:alert(1))",
      "![tracker](https://evil.example/pixel.png)",
      "<!channel> <@U123> @here",
      "<script>alert(1)</script>",
      "- not a list",
      "1. not numbered",
      "    not code",
    ].join("\n");

    const note: string = IncomingEmailOpenForEveryEmail.getReplyNote({
      from: "x@acme.example",
      body,
    });

    // Each line is text, escaped where it starts a line.
    expect(note).toContain("\\# Heading");
    expect(note).not.toContain("\n# Heading");
    // The brackets are escaped, so neither is a link or an image.
    expect(note).toContain("\\[Click here\\]");
    expect(note).not.toContain("[Click here](");
    expect(note).not.toContain("![tracker](");
    expect(note).not.toContain("<!channel>");
    // Every "<" of a tag is escaped: the renderers show it as text.
    expect(note).toContain("\\<script>");
    expect(note.split("\\<script>").join("")).not.toContain("<script>");
    // No list starts, and no line is indented into a code block.
    expect(note).toContain("\\- not a list");
    expect(note).toContain("1\\. not numbered");
    expect(note).not.toContain("    not code");
    // As written, once the invisible breaks are taken out.
    expect(FeedMarkdown.withoutInvisibleBreaks(note)).toContain("@here");
  });

  it("a sender address that looks like Markdown is text too", () => {
    const note: string = IncomingEmailOpenForEveryEmail.getReplyNote({
      from: "[boss](https://evil.example)@acme.example",
      body: "Hi",
    });

    expect(note).not.toContain("[boss](https://evil.example)");
    expect(note.split("\n")[0]).toContain("replied by email:");
  });

  it(`cuts a long reply at ${MAX_REPLY_NOTE_TEXT_LENGTH} characters and says so`, () => {
    const body: string = "x".repeat(MAX_REPLY_NOTE_TEXT_LENGTH + 5000);
    const note: string = IncomingEmailOpenForEveryEmail.getReplyNote({
      from: "x@acme.example",
      body,
    });

    expect(note).toContain("_The rest of this reply is not shown._");
    expect(note).toContain("x".repeat(MAX_REPLY_NOTE_TEXT_LENGTH));
    expect(note).not.toContain("x".repeat(MAX_REPLY_NOTE_TEXT_LENGTH + 1));
  });

  it("measures the reply's own text against the limit, not the thread it quotes", () => {
    const own: string = "y".repeat(MAX_REPLY_NOTE_TEXT_LENGTH - 10);
    const note: string = IncomingEmailOpenForEveryEmail.getReplyNote({
      from: "x@acme.example",
      body: `${own}\n\nOn Wed, Oct 15, 2026 Tom <tom@acme.example> wrote:\n> ${"z".repeat(MAX_REPLY_NOTE_TEXT_LENGTH)}`,
    });

    expect(note).toContain(own);
    expect(note).not.toContain("not shown");
    expect(note).not.toContain("z");
  });

  it("a reply of exactly the limit is whole", () => {
    const note: string = IncomingEmailOpenForEveryEmail.getReplyNote({
      from: "x@acme.example",
      body: "y".repeat(MAX_REPLY_NOTE_TEXT_LENGTH),
    });

    expect(note).not.toContain("not shown");
  });

  it("never cuts an emoji in half", () => {
    const body: string = `${"x".repeat(MAX_REPLY_NOTE_TEXT_LENGTH - 1)}😀 more`;
    const note: string = IncomingEmailOpenForEveryEmail.getReplyNote({
      from: "x@acme.example",
      body,
    });

    expect(note).not.toContain("\ud83d\n");
    expect(
      Array.from(note).every((character: string): boolean => {
        const code: number = character.charCodeAt(0);
        return !(code >= 0xd800 && code <= 0xdfff && character.length === 1);
      }),
    ).toBe(true);
  });

  it("a reply with no text, and a sender with no address", () => {
    expect(
      IncomingEmailOpenForEveryEmail.getReplyNote({ from: "", body: "  " }),
    ).toBe("**Someone** replied by email:\n\n_The reply has no text to show._");
  });

  it("a megabyte of reply is noted in linear time, well under two seconds", () => {
    // The clock is faked for the other tests: time this one on the real one.
    jest.useRealTimers();
    const body: string = `${"<!channel> [a](b) ".repeat(60000)}\n`.repeat(2);
    const timed: FastestRun<void> = fastestRun({
      run: (): void => {
        IncomingEmailOpenForEveryEmail.getReplyNote({
          from: "x@acme.example",
          body,
        });
      },
      limitInMs: 2000,
    });

    expect(timed.inMs).toBeLessThan(2000);
  });

  it("a hundred thousand short lines are noted in linear time too", () => {
    jest.useRealTimers();
    const body: string = "> a\nb\n".repeat(100000);
    const timed: FastestRun<void> = fastestRun({
      run: (): void => {
        IncomingEmailOpenForEveryEmail.getReplyNote({
          from: "x@acme.example",
          body,
        });
      },
      limitInMs: 2000,
    });

    expect(timed.inMs).toBeLessThan(2000);
  });
});
