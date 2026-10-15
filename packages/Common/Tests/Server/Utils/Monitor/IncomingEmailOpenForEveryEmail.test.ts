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
import AlertInternalNoteService from "../../../../Server/Services/AlertInternalNoteService";
import AlertService from "../../../../Server/Services/AlertService";
import IncidentInternalNoteService from "../../../../Server/Services/IncidentInternalNoteService";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncomingEmailOpenForEveryEmail, {
  EMAIL_MESSAGE_ID_FINGERPRINT_LABEL,
  EveryEmailMatches,
  MAX_OPENED_FROM_EMAILS_PER_HOUR,
  MAX_REPLY_NOTE_TEXT_LENGTH,
} from "../../../../Server/Utils/Monitor/IncomingEmailOpenForEveryEmail";
import OneUptimeDate from "../../../../Types/Date";
import Dictionary from "../../../../Types/Dictionary";
import { JSONObject } from "../../../../Types/JSON";
import IncomingEmailMonitorRequest from "../../../../Types/Monitor/IncomingEmailMonitor/IncomingEmailMonitorRequest";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorEvaluationSummary, {
  MonitorEvaluationEvent,
} from "../../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
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

/*
 * An Incoming Email monitor's criteria that opens an incident for every
 * email, decided email by email: what the incident and alert creators are
 * handed, what a reply leaves on what its thread opened, and what the
 * evaluation summary - the email's row in Monitoring Logs - says when an
 * email opens nothing.
 *
 * The database is an in-memory table of the monitor's incidents and alerts,
 * read through the real query operators (QueryHelper), so a lookup that is
 * not scoped to the monitor, or that only looks at open incidents, shows.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const CRITERIA_ID: string = "6f1d7a4e-3c55-4b70-9a1e-5b2d2c9e0a11";
const ROOT_CAUSE: string = "**Created because the following criteria was met**";

const NOW: Date = new Date("2026-10-15T12:00:00.000Z");

interface StoredRecord {
  id: ObjectID;
  title: string;
  number: number;
  fingerprint: string | undefined;
  createdAt: Date;
  // Resolved records are found too: the lookups do not ask for open ones.
  isResolved: boolean;
}

let incidents: Array<StoredRecord> = [];
let alerts: Array<StoredRecord> = [];
let incidentQueries: Array<JSONObject> = [];
let alertQueries: Array<JSONObject> = [];
let incidentNotes: Array<IncidentInternalNote> = [];
let alertNotes: Array<AlertInternalNote> = [];

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
}): StoredRecord {
  return {
    id: ObjectID.generate(),
    title: input.title || `Record ${input.number}`,
    number: input.number,
    fingerprint:
      input.fingerprint ||
      (input.messageId ? fingerprintOf(input.messageId) : undefined),
    createdAt: OneUptimeDate.addRemoveMinutes(NOW, -(input.minutesAgo || 1)),
    isResolved: Boolean(input.isResolved),
  };
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

// The stored records a findBy over the monitor's incidents or alerts reads.
function read(
  records: Array<StoredRecord>,
  query: JSONObject,
  limit: number,
): Array<StoredRecord> {
  let rows: Array<StoredRecord> = [...records];

  const fingerprint: unknown = query["seriesFingerprint"];

  if (fingerprint !== undefined) {
    const sql: string = sqlOf(fingerprint);

    if (sql.includes(" IN ")) {
      const wanted: Array<string> = parametersOf(
        fingerprint,
      )[0] as Array<string>;

      rows = rows.filter((row: StoredRecord): boolean => {
        return Boolean(row.fingerprint) && wanted.includes(row.fingerprint!);
      });
    } else if (sql.includes("IS NOT NULL")) {
      rows = rows.filter((row: StoredRecord): boolean => {
        return Boolean(row.fingerprint);
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
    .slice(0, limit);
}

function toIncident(row: StoredRecord): Incident {
  const incident: Incident = new Incident();
  incident.id = row.id;
  incident.title = row.title;
  incident.incidentNumber = row.number;
  incident.incidentNumberWithPrefix = `INC-${row.number}`;
  incident.createdAt = row.createdAt;

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

  if (row.fingerprint) {
    alert.seriesFingerprint = row.fingerprint;
  }

  return alert;
}

function monitor(
  monitorType: MonitorType = MonitorType.IncomingEmail,
): Monitor {
  const model: Monitor = new Monitor();
  model.id = MONITOR_ID;
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

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);

  incidents = [];
  alerts = [];
  incidentQueries = [];
  alertQueries = [];
  incidentNotes = [];
  alertNotes = [];

  jest.spyOn(IncidentService, "findBy").mockImplementation((async (findBy: {
    query: JSONObject;
    limit: number;
  }): Promise<Array<Incident>> => {
    incidentQueries.push(findBy.query);
    return read(incidents, findBy.query, findBy.limit).map(toIncident);
  }) as never);

  jest.spyOn(AlertService, "findBy").mockImplementation((async (findBy: {
    query: JSONObject;
    limit: number;
  }): Promise<Array<Alert>> => {
    alertQueries.push(findBy.query);
    return read(alerts, findBy.query, findBy.limit).map(toAlert);
  }) as never);

  jest
    .spyOn(IncidentInternalNoteService, "findOneBy")
    .mockImplementation((async (findOneBy: {
      query: JSONObject;
    }): Promise<IncidentInternalNote | null> => {
      return (
        incidentNotes.find((note: IncidentInternalNote): boolean => {
          return (
            note.incidentId?.toString() ===
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
      incidentNotes.push(createBy.data);
      return createBy.data;
    }) as never);

  jest
    .spyOn(AlertInternalNoteService, "findOneBy")
    .mockImplementation((async (findOneBy: {
      query: JSONObject;
    }): Promise<AlertInternalNote | null> => {
      return (
        alertNotes.find((note: AlertInternalNote): boolean => {
          return (
            note.alertId?.toString() ===
              (findOneBy.query["alertId"] as ObjectID).toString() &&
            note.note === findOneBy.query["note"]
          );
        }) || null
      );
    }) as never);

  jest
    .spyOn(AlertInternalNoteService, "create")
    .mockImplementation((async (createBy: {
      data: AlertInternalNote;
    }): Promise<AlertInternalNote> => {
      alertNotes.push(createBy.data);
      return createBy.data;
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

describe("When the criteria does not open one for every email, nothing changes", () => {
  it("the switch off: the creators work one at a time, and nothing is read", async () => {
    expect(
      await decide({
        request: email({ "Message-ID": "<a@acme.example>" }),
        criteriaInstance: criteria({ openForEveryEmail: false }),
      }),
    ).toEqual({});
    expect(incidentQueries).toEqual([]);
    expect(alertQueries).toEqual([]);
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

    expect(incidentQueries).toEqual([]);
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
    expect(incidentQueries).toEqual([]);
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

  it("is computed the way a series' is, from the Message-ID", () => {
    expect(fingerprintOf("a@acme.example")).toBe(
      MetricSeriesFingerprint.computeFingerprint({
        [EMAIL_MESSAGE_ID_FINGERPRINT_LABEL]: "a@acme.example",
      }),
    );
    expect(fingerprintOf("a@acme.example")).toMatch(/^[0-9a-f]{16}$/);
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

    expect(matches).toEqual({ incidents: [], alerts: undefined });
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
    ).toEqual({ incidents: [], alerts: undefined });
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
  });

  it("reads only this monitor's records, in this project, open or resolved", async () => {
    await decide({
      request: email({ "Message-ID": "<report-1@acme.example>" }),
    });

    expect(incidentQueries[0]).toEqual(
      expect.objectContaining({
        projectId: PROJECT_ID,
        monitors: [MONITOR_ID],
      }),
    );
    expect(Object.keys(incidentQueries[0]!)).not.toContain(
      "currentIncidentStateId",
    );
    expect(alertQueries[0]).toEqual(
      expect.objectContaining({
        projectId: PROJECT_ID,
        monitorId: MONITOR_ID,
      }),
    );
    expect(Object.keys(alertQueries[0]!)).not.toContain("currentAlertStateId");
  });
});

describe("A reply is added to what its thread opened, as a note", () => {
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
        { body: "It is fixed now, thanks!", from: "colleague@acme.example" },
      ),
      evaluationSummary,
    });

    expect(matches).toEqual({ incidents: [], alerts: undefined });
    expect(incidentNotes).toHaveLength(1);
    expect(incidentNotes[0]!.incidentId?.toString()).toBe(
      incidents[0]!.id.toString(),
    );
    expect(incidentNotes[0]!.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(incidentNotes[0]!.note).toBe(
      IncomingEmailOpenForEveryEmail.getReplyNote({
        from: "colleague@acme.example",
        body: "It is fixed now, thanks!",
      }),
    );
    expect(eventsOf(evaluationSummary)).toEqual([
      "incident-skipped: Reply added to the incident as a note: Printer on floor 3 is down",
    ]);
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

    expect(incidentNotes).toHaveLength(1);
  });

  it("adds it to a resolved incident too: a 'thanks' after the fix pages nobody", async () => {
    incidents = [
      stored({
        messageId: "report-1@acme.example",
        number: 12,
        isResolved: true,
        minutesAgo: 120,
      }),
    ];

    expect(
      await decide({
        request: email({
          "Message-ID": "<thanks@acme.example>",
          "In-Reply-To": "<report-1@acme.example>",
        }),
      }),
    ).toEqual({ incidents: [], alerts: undefined });
    expect(incidentNotes).toHaveLength(1);
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

    expect(
      incidentNotes
        .map((note: IncidentInternalNote): string => {
          return note.incidentId!.toString();
        })
        .sort(),
    ).toEqual(
      [incidents[0]!.id.toString(), incidents[1]!.id.toString()].sort(),
    );
    expect(alertNotes).toHaveLength(1);
    expect(alertNotes[0]!.alertId?.toString()).toBe(alerts[0]!.id.toString());
    expect(eventsOf(evaluationSummary)).toHaveLength(3);
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

    expect(incidentNotes).toHaveLength(1);
    expect(incidentNotes[0]!.incidentId?.toString()).toBe(
      incidents[1]!.id.toString(),
    );
  });

  it("the same reply delivered twice is noted once", async () => {
    incidents = [stored({ messageId: "report-1@acme.example", number: 12 })];
    const reply: IncomingEmailMonitorRequest = email(
      {
        "Message-ID": "<reply-1@acme.example>",
        "In-Reply-To": "<report-1@acme.example>",
      },
      { body: "Still broken." },
    );
    const evaluationSummary: MonitorEvaluationSummary = summary();

    await decide({ request: reply });
    await decide({ request: reply, evaluationSummary });

    expect(incidentNotes).toHaveLength(1);
    expect(eventsOf(evaluationSummary)).toEqual([
      "incident-skipped: Reply already added to the incident as a note: Record 12",
    ]);
  });

  it("a reply to an email that opened nothing here opens its own", async () => {
    const matches: EveryEmailMatches = await decide({
      request: email({
        "Message-ID": "<fwd@acme.example>",
        "In-Reply-To": "<someone-elses-thread@acme.example>",
      }),
    });

    expect(matches.incidents).toHaveLength(1);
    expect(incidentNotes).toEqual([]);
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
    expect(incidentQueries).toEqual([]);
    expect(
      evaluationSummary.events.map((event: MonitorEvaluationEvent) => {
        return [event.type, event.message];
      }),
    ).toEqual([
      [
        "incident-skipped",
        "This email is an automatic reply, such as an out-of-office message, so it opened no incident.",
      ],
      [
        "alert-skipped",
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
    expect(evaluationSummary.events[0]!.message).toBe(
      `This monitor opened ${MAX_OPENED_FROM_EMAILS_PER_HOUR} alerts from emails in the past hour, the most it opens in an hour, so this email opened none.`,
    );
  });

  it("counts what emails opened on this monitor in the past hour, and reads no more than it needs", async () => {
    await decide({ request: email({ "Message-ID": "<new@acme.example>" }) });

    const counting: JSONObject | undefined = incidentQueries.find(
      (query: JSONObject): boolean => {
        return query["createdAt"] !== undefined;
      },
    );

    expect(counting).toEqual(
      expect.objectContaining({
        projectId: PROJECT_ID,
        monitors: [MONITOR_ID],
      }),
    );
    expect(sqlOf(counting!["seriesFingerprint"])).toContain("IS NOT NULL");
    expect(parametersOf(counting!["createdAt"])[0]).toEqual(
      OneUptimeDate.addRemoveHours(NOW, -1),
    );

    const countingCall: unknown = (
      IncidentService.findBy as unknown as {
        mock: { calls: Array<Array<{ query: JSONObject; limit: number }>> };
      }
    ).mock.calls.find(
      (call: Array<{ query: JSONObject; limit: number }>): boolean => {
        return call[0]!.query["createdAt"] !== undefined;
      },
    );

    expect((countingCall as Array<{ limit: number }>)[0]!.limit).toBe(
      MAX_OPENED_FROM_EMAILS_PER_HOUR,
    );
  });

  it("a flood of emails opens only the limit, however many arrive", async () => {
    let opened: number = 0;

    for (let index: number = 0; index < 60; index++) {
      const matches: EveryEmailMatches = await decide({
        request: email({ "Message-ID": `<flood-${index}@acme.example>` }),
      });

      // The creator opens what it is handed.
      for (const match of matches.incidents || []) {
        incidents.push(
          stored({ fingerprint: match.fingerprint, number: index }),
        );
        opened++;
      }
    }

    expect(opened).toBe(MAX_OPENED_FROM_EMAILS_PER_HOUR);
  });
});

describe("The note a reply leaves", () => {
  it("names the sender and keeps the reply's lines", () => {
    const note: string = IncomingEmailOpenForEveryEmail.getReplyNote({
      from: "colleague@acme.example",
      body: "Still broken.\nIt shows error 41 again.",
    });

    expect(note.split("\n")[0]).toContain("**Reply by email from");
    expect(FeedMarkdown.withoutInvisibleBreaks(note)).toContain(
      "colleague@acme.example",
    );
    expect(FeedMarkdown.withoutInvisibleBreaks(note)).toContain(
      "Still broken.",
    );
    expect(note.split("\n").length).toBeGreaterThanOrEqual(4);
  });

  it("reads what the sender wrote as text: no link, image, heading or chat mention acts", () => {
    const body: string = [
      "# Heading",
      "[Click here](javascript:alert(1))",
      "![tracker](https://evil.example/pixel.png)",
      "<!channel> <@U123> @here",
      "<script>alert(1)</script>",
    ].join("\n");

    const note: string = IncomingEmailOpenForEveryEmail.getReplyNote({
      from: "x@acme.example",
      body,
    });

    // Placed as text: the same as FeedMarkdown places a multi-line value.
    expect(note).toContain(FeedMarkdown.multilineText(body).toString());
    expect(note).not.toContain("\n# Heading");
    // The brackets are escaped, so neither is a link or an image.
    expect(note).toContain("\\[Click here\\]");
    expect(note).not.toContain("[Click here](");
    expect(note).not.toContain("![tracker](");
    expect(note).not.toContain("<!channel>");
    // Every "<" of a tag is escaped: the renderers show it as text.
    expect(note).toContain("\\<script>");
    expect(note.split("\\<script>").join("")).not.toContain("<script>");
    // As written, once the invisible breaks are taken out.
    expect(FeedMarkdown.withoutInvisibleBreaks(note)).toContain("@here");
  });

  it("a sender address that looks like Markdown is text too", () => {
    const note: string = IncomingEmailOpenForEveryEmail.getReplyNote({
      from: "[boss](https://evil.example)@acme.example",
      body: "Hi",
    });

    expect(note).not.toContain("[boss](https://evil.example)");
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

  it("a reply with no plain text, and a sender with no address", () => {
    expect(
      IncomingEmailOpenForEveryEmail.getReplyNote({ from: "", body: "  " }),
    ).toBe("**Reply by email**\n\nThe reply has no plain text.");
  });

  it("a megabyte of reply is noted in well under a second", () => {
    const body: string = `${"<!channel> [a](b) ".repeat(60000)}\n`.repeat(2);
    const start: number = Date.now();

    IncomingEmailOpenForEveryEmail.getReplyNote({
      from: "x@acme.example",
      body,
    });

    expect(Date.now() - start).toBeLessThan(2000);
  });
});
