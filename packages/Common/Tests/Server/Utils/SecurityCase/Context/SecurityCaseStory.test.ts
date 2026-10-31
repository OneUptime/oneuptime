import ChangeEvent from "../../../../../Models/AnalyticsModels/ChangeEvent";
import Alert from "../../../../../Models/DatabaseModels/Alert";
import Incident from "../../../../../Models/DatabaseModels/Incident";
import SecurityCaseNote from "../../../../../Models/DatabaseModels/SecurityCaseNote";
import SecurityDetection from "../../../../../Models/DatabaseModels/SecurityDetection";
import SecurityPlaybookRun from "../../../../../Models/DatabaseModels/SecurityPlaybookRun";
import TelemetryException from "../../../../../Models/DatabaseModels/TelemetryException";
import User from "../../../../../Models/DatabaseModels/User";
import AlertService from "../../../../../Server/Services/AlertService";
import ChangeEventService from "../../../../../Server/Services/ChangeEventService";
import IncidentService from "../../../../../Server/Services/IncidentService";
import SecurityCaseNoteService from "../../../../../Server/Services/SecurityCaseNoteService";
import SecurityCaseService from "../../../../../Server/Services/SecurityCaseService";
import SecurityDetectionService from "../../../../../Server/Services/SecurityDetectionService";
import SecurityEventService from "../../../../../Server/Services/SecurityEventService";
import SecurityPlaybookRunService from "../../../../../Server/Services/SecurityPlaybookRunService";
import TelemetryExceptionService from "../../../../../Server/Services/TelemetryExceptionService";
import { Statement } from "../../../../../Server/Utils/AnalyticsDatabase/Statement";
import logger from "../../../../../Server/Utils/Logger";
import SecurityCaseStory, {
  buildStoryEventsStatement,
  getRecordIdsByKind,
  toDetectionItem,
  toNoteItem,
  toPlaybookRunItem,
} from "../../../../../Server/Utils/SecurityCase/Context/SecurityCaseStory";
import SecurityConnections from "../../../../../Server/Utils/SecurityEvent/Connections/SecurityConnections";
import TelemetryReadAccess from "../../../../../Server/Utils/Telemetry/TelemetryReadAccess";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import {
  SECURITY_CASE_STORY_MAX_DETECTIONS,
  SECURITY_CASE_STORY_MAX_EVENTS,
  SecurityCaseStoryItemJson,
  SecurityCaseStoryItemKind,
  SecurityCaseStoryJson,
  SecurityCaseStoryMilestone,
  SecurityCaseStorySource,
} from "../../../../../Types/SecurityCase/SecurityCaseContext";
import {
  SecurityConnectedResourceJson,
  SecurityConnectionCertainty,
  SecurityConnectionKind,
  SecurityConnectionsJson,
} from "../../../../../Types/SecurityCase/SecurityConnection";
import { SecurityEntityType } from "../../../../../Types/SecurityCase/SecurityEntity";
import OcsfSeverity from "../../../../../Types/SecurityEvent/OcsfSeverity";
import SecurityPlaybookRunStatus from "../../../../../Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * A case's Story: what happened, in order, across OneUptime - its
 * detections, the events behind them told in runs with how far their
 * requests got, the exceptions those threw, what changed and what was set
 * off on the records it names, and the response - each source read with the
 * reader's own permissions, a refusal or a failure said, never an empty
 * list that looks like "nothing happened".
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CASE_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const SERVICE_ID: string = "33333333-3333-4333-8333-333333333333";
const HOST_ID: string = "44444444-4444-4444-8444-444444444444";
const MEMBER_ID: string = "55555555-5555-4555-8555-555555555555";
const DECLARED_INCIDENT_ID: string = "66666666-6666-4666-8666-666666666666";
const WINDOW_INCIDENT_ID: string = "77777777-7777-4777-8777-777777777777";
const ALERT_ID: string = "88888888-8888-4888-8888-888888888888";
const DETECTION_ID: string = "99999999-9999-4999-8999-999999999999";
const RUN_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NOTE_ID: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const EXCEPTION_GROUP_ID: string = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CHANGE_ID: string = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const FIRST: Date = new Date("2026-10-27T06:00:00.000Z");
const NOW: Date = new Date("2026-10-27T12:00:00.000Z");

const CALLER: DatabaseCommonInteractionProps = {
  userId: new ObjectID("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"),
  tenantId: PROJECT_ID,
};

function at(minutes: number): Date {
  return new Date(FIRST.getTime() + minutes * 60 * 1000);
}

function connectedResource(
  kind: SecurityConnectionKind,
  id: string,
  name: string,
): SecurityConnectedResourceJson {
  return {
    kind,
    id,
    name,
    certainty: SecurityConnectionCertainty.Exact,
    matches: [],
    activeIncidents: { count: 0, items: [] },
    activeAlerts: { count: 0, items: [] },
    monitors: { count: 0, items: [] },
    recentChanges: [],
  };
}

const CONNECTIONS: SecurityConnectionsJson = {
  windowStart: at(-30).toISOString(),
  windowEnd: at(90).toISOString(),
  resources: [
    connectedResource(SecurityConnectionKind.Service, SERVICE_ID, "checkout"),
    connectedResource(SecurityConnectionKind.Host, HOST_ID, "web-1"),
    connectedResource(SecurityConnectionKind.User, MEMBER_ID, "Kim Morgan"),
  ],
  hasMoreResources: false,
  unmatched: [],
  unreadableKinds: [],
  failedKinds: [],
};

function withId<T extends { _id?: string | undefined }>(
  model: T,
  id: string,
): T {
  model._id = id;
  return model;
}

function detection(): SecurityDetection {
  const row: SecurityDetection = withId(new SecurityDetection(), DETECTION_ID);
  row.title = "SQL injection attempts";
  row.severity = OcsfSeverity.High;
  row.groupValue = "203.0.113.7";
  row.fireCount = 3;
  row.firstSeenAt = at(5);
  row.lastSeenAt = at(45);
  row.eventUid = "detection:rule:fp:1";
  return row;
}

function eventRow(overrides: JSONObject = {}): JSONObject {
  return {
    time: "2026-10-27 06:01:00.000000000",
    eventUid: "log:1",
    className: "HTTP Activity",
    message: "SQL injection attempt: GET /x → 404",
    severityName: "Low",
    severityId: 2,
    principalIp: "203.0.113.7",
    principalUser: "",
    principalHost: "",
    targetResource: "/x?id=1' or 1=1",
    requestOutcome: "Rejected",
    traceId: "trace-1",
    spanId: "span-1",
    sessionId: "",
    attributes: { "web.attack.kind": "sql-injection" },
    ...overrides,
  };
}

function incident(id: string, minutes: number, column?: string): Incident {
  const row: Incident = withId(new Incident(), id);
  row.title = `incident ${id.slice(0, 4)}`;
  row.incidentNumberWithPrefix = `INC-${minutes}`;
  row.createdAt = at(minutes);

  if (column) {
    (row as unknown as JSONObject)[column] = [{ _id: SERVICE_ID }];
  }

  return row;
}

let executeQuery: jest.SpyInstance;
let changeRead: jest.SpyInstance;
let incidentRead: jest.SpyInstance;
let exceptionRead: jest.SpyInstance;
let eventRows: Array<JSONObject>;

function caseRead(overrides: JSONObject = {}): jest.SpyInstance {
  return jest.spyOn(SecurityCaseService, "findOneBy").mockResolvedValue({
    _id: CASE_ID.toString(),
    id: CASE_ID,
    projectId: PROJECT_ID,
    entities: [{ type: SecurityEntityType.IpAddress, value: "203.0.113.7" }],
    createdAt: at(6),
    firstDetectedAt: at(5),
    lastDetectedAt: at(45),
    acknowledgedAt: at(20),
    containedAt: undefined,
    closedAt: undefined,
    incidentId: new ObjectID(DECLARED_INCIDENT_ID),
    ...overrides,
  } as never);
}

beforeEach(() => {
  jest.spyOn(logger, "error").mockImplementation((): void => {});
  caseRead();
  eventRows = [
    eventRow(),
    eventRow({
      time: "2026-10-27 06:02:00.000000000",
      eventUid: "log:2",
      requestOutcome: "Errored",
      severityName: "High",
      severityId: 4,
      message: "SQL injection attempt: GET /x → 500",
      attributes: {
        "web.attack.kind": "sql-injection",
        "oneuptime.exception.fingerprint": "fp-1",
        "oneuptime.exception.type": "QueryFailedError",
        "oneuptime.exception.message": "syntax error",
      },
    }),
  ];
  jest
    .spyOn(SecurityDetectionService, "findBy")
    .mockResolvedValue([detection()]);
  jest
    .spyOn(TelemetryReadAccess, "getServiceFilter")
    .mockResolvedValue({} as never);
  executeQuery = jest
    .spyOn(SecurityEventService, "executeQuery")
    .mockImplementation(async (): Promise<never> => {
      return {
        json: async (): Promise<JSONObject> => {
          return { data: eventRows } as unknown as JSONObject;
        },
      } as never;
    });
  jest.spyOn(SecurityConnections, "forCase").mockResolvedValue(CONNECTIONS);

  const deploy: ChangeEvent = new ChangeEvent();
  deploy._id = new ObjectID(CHANGE_ID);
  deploy.time = at(-10);
  deploy.title = "checkout v1.4.2";
  deploy.eventType = "deployment";
  deploy.primaryEntityId = new ObjectID(SERVICE_ID);
  deploy.attributes = { "service.version": "v1.4.2" } as never;

  const elsewhere: ChangeEvent = new ChangeEvent();
  elsewhere._id = new ObjectID("ffffffff-ffff-4fff-8fff-ffffffffffff");
  elsewhere.time = at(-5);
  elsewhere.title = "another service's deploy";
  elsewhere.eventType = "deployment";
  elsewhere.primaryEntityId = new ObjectID(
    "12121212-1212-4121-8121-121212121212",
  );

  changeRead = jest
    .spyOn(ChangeEventService, "findBy")
    .mockResolvedValue([deploy, elsewhere]);

  jest
    .spyOn(IncidentService, "findOneBy")
    .mockResolvedValue(incident(DECLARED_INCIDENT_ID, 50));
  incidentRead = jest
    .spyOn(IncidentService, "findBy")
    .mockImplementation(async (data: unknown): Promise<Array<Incident>> => {
      const query: JSONObject = (data as { query: JSONObject }).query;

      return query["services"]
        ? [
            incident(WINDOW_INCIDENT_ID, 30, "services"),
            incident(DECLARED_INCIDENT_ID, 50, "services"),
          ]
        : [];
    });

  jest
    .spyOn(AlertService, "findBy")
    .mockImplementation(async (data: unknown): Promise<Array<Alert>> => {
      const query: JSONObject = (data as { query: JSONObject }).query;

      if (!query["hosts"]) {
        return [];
      }

      const alert: Alert = withId(new Alert(), ALERT_ID);
      alert.title = "High error rate";
      alert.alertNumberWithPrefix = "ALT-7";
      alert.createdAt = at(3);
      (alert as unknown as JSONObject)["hosts"] = [{ _id: HOST_ID }];
      return [alert];
    });

  const run: SecurityPlaybookRun = withId(new SecurityPlaybookRun(), RUN_ID);
  run.playbookName = "Block the address";
  run.status = SecurityPlaybookRunStatus.Succeeded;
  run.createdAt = at(25);
  const starter: User = new User();
  starter.name = "Kim Morgan" as never;
  run.triggeredByUser = starter;
  jest.spyOn(SecurityPlaybookRunService, "findBy").mockResolvedValue([run]);

  const note: SecurityCaseNote = withId(new SecurityCaseNote(), NOTE_ID);
  note.note = "Blocked at the edge.\nMore below.";
  note.createdAt = at(26);
  jest.spyOn(SecurityCaseNoteService, "findBy").mockResolvedValue([note]);

  const group: TelemetryException = withId(
    new TelemetryException(),
    EXCEPTION_GROUP_ID,
  );
  group.fingerprint = "fp-1";
  exceptionRead = jest
    .spyOn(TelemetryExceptionService, "findBy")
    .mockResolvedValue([group]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function story(): Promise<SecurityCaseStoryJson> {
  const told: SecurityCaseStoryJson | null = await SecurityCaseStory.build({
    projectId: PROJECT_ID,
    securityCaseId: CASE_ID,
    props: CALLER,
    now: NOW,
  });

  expect(told).not.toBeNull();

  return told!;
}

function keys(told: SecurityCaseStoryJson): Array<string> {
  return told.items.map((entry: SecurityCaseStoryItemJson): string => {
    return entry.key;
  });
}

function itemOf(
  told: SecurityCaseStoryJson,
  kind: SecurityCaseStoryItemKind,
): SecurityCaseStoryItemJson {
  return told.items.find((entry: SecurityCaseStoryItemJson): boolean => {
    return entry.kind === kind;
  })!;
}

describe("SecurityCaseStory.build", () => {
  test("a case the reader may not read, or of another project, has no story", async () => {
    jest.spyOn(SecurityCaseService, "findOneBy").mockResolvedValue(null);

    expect(
      await SecurityCaseStory.build({
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
        props: CALLER,
        now: NOW,
      }),
    ).toBeNull();
    expect(executeQuery).not.toHaveBeenCalled();
  });

  test("tells everything on one time axis, oldest first", async () => {
    const told: SecurityCaseStoryJson = await story();

    expect(keys(told)).toEqual([
      `change:${CHANGE_ID}`,
      `events:log:1:0`,
      "exception:fp-1",
      `alert:${ALERT_ID}`,
      `detection:${DETECTION_ID}`,
      "case:opened",
      "case:acknowledged",
      `run:${RUN_ID}`,
      `note:${NOTE_ID}`,
      `incident:${WINDOW_INCIDENT_ID}`,
      `incident:${DECLARED_INCIDENT_ID}`,
    ]);
    expect(told.unreadableSources).toEqual([]);
    expect(told.failedSources).toEqual([]);
    expect(told.truncatedSources).toEqual([]);
    expect(told.windowStart).toBe(at(-25).toISOString());
  });

  test("tells the events as a run headed by the request that got furthest, linking its trace", async () => {
    const events: SecurityCaseStoryItemJson = itemOf(
      await story(),
      SecurityCaseStoryItemKind.Events,
    );

    expect(events).toMatchObject({
      count: 2,
      title: "SQL injection attempt: GET /x → 500",
      requestOutcome: "Errored",
      outcomes: { Rejected: 1, Errored: 1 },
      links: {
        eventUid: "log:2",
        traceId: "trace-1",
        observable: "203.0.113.7",
      },
    });
  });

  test("tells what a request threw, linked to its exception group", async () => {
    expect(
      itemOf(await story(), SecurityCaseStoryItemKind.Exception),
    ).toMatchObject({
      title: "QueryFailedError",
      detail: "syntax error",
      links: { exceptionFingerprint: "fp-1", exceptionId: EXCEPTION_GROUP_ID },
    });
    expect(exceptionRead).toHaveBeenCalledWith(
      expect.objectContaining({ props: CALLER }),
    );
  });

  /*
   * The request threw fp-1, and fp-1's exception was merged into another
   * (fp-0): the lookup leaves the merged row out and finds the one it was
   * merged into, which carries fp-0. The story links that one, by what was
   * merged into what - not by the row's own fingerprint, which would leave
   * the request's exception without a link - and not another service's
   * exception that only shares fp-0.
   */
  test("tells what a request threw into a merged exception, linked to the exception it was merged into", async () => {
    const SURVIVOR_ID: string = "cccccccc-cccc-4ccc-8ccc-00000000000a";
    const LOOKALIKE_ID: string = "cccccccc-cccc-4ccc-8ccc-00000000000b";

    exceptionRead.mockImplementation(
      async (data: unknown): Promise<Array<TelemetryException>> => {
        const query: JSONObject = (data as { query: JSONObject }).query;

        if ("mergedIntoTelemetryExceptionId" in query) {
          // What was merged into what, as the read of merged rows finds it.
          const merged: TelemetryException = new TelemetryException();
          merged.fingerprint = "fp-1";
          merged.mergedIntoTelemetryExceptionId = new ObjectID(SURVIVOR_ID);
          merged.mergedIntoTelemetryException = new TelemetryException();
          merged.mergedIntoTelemetryException.fingerprint = "fp-0";
          return [merged];
        }

        // The lookup, as it reads: the merged row left out, fp-0's rows in.
        const lookalike: TelemetryException = withId(
          new TelemetryException(),
          LOOKALIKE_ID,
        );
        lookalike.fingerprint = "fp-0";
        const survivor: TelemetryException = withId(
          new TelemetryException(),
          SURVIVOR_ID,
        );
        survivor.fingerprint = "fp-0";
        return [lookalike, survivor];
      },
    );

    expect(
      itemOf(await story(), SecurityCaseStoryItemKind.Exception).links,
    ).toMatchObject({ exceptionFingerprint: "fp-1", exceptionId: SURVIVOR_ID });

    // What was merged is read as root; the exceptions themselves as the reader.
    expect(exceptionRead).toHaveBeenCalledWith(
      expect.objectContaining({ props: { isRoot: true } }),
    );
    expect(exceptionRead).toHaveBeenCalledWith(
      expect.objectContaining({ props: CALLER }),
    );
  });

  test("tells a change on a record the case names, with the record and its version - and no other", async () => {
    const told: SecurityCaseStoryJson = await story();

    expect(itemOf(told, SecurityCaseStoryItemKind.Change)).toEqual({
      key: `change:${CHANGE_ID}`,
      kind: SecurityCaseStoryItemKind.Change,
      time: at(-10).toISOString(),
      title: "checkout v1.4.2",
      detail: "v1.4.2",
      stateName: "deployment",
      links: {
        resource: {
          kind: SecurityConnectionKind.Service,
          id: SERVICE_ID,
          name: "checkout",
        },
      },
    });
    expect(keys(told)).not.toContain(
      "change:ffffffff-ffff-4fff-8fff-ffffffffffff",
    );
    expect(changeRead).toHaveBeenCalledWith(
      expect.objectContaining({ props: CALLER }),
    );
  });

  test("tells the incident the case declared once, and those raised on its records, with the record", async () => {
    const told: SecurityCaseStoryJson = await story();
    const incidents: Array<SecurityCaseStoryItemJson> = told.items.filter(
      (entry: SecurityCaseStoryItemJson): boolean => {
        return entry.kind === SecurityCaseStoryItemKind.Incident;
      },
    );

    expect(incidents).toHaveLength(2);
    expect(incidents[0]).toMatchObject({
      number: "INC-30",
      links: {
        incidentId: WINDOW_INCIDENT_ID,
        resource: { kind: SecurityConnectionKind.Service, id: SERVICE_ID },
      },
    });
    // Read only for the kinds of record an incident names.
    expect(
      incidentRead.mock.calls.map((call: Array<unknown>): Array<string> => {
        return Object.keys((call[0] as { query: JSONObject }).query).filter(
          (key: string): boolean => {
            return key === "services" || key === "hosts";
          },
        );
      }),
    ).toEqual([["services"], ["hosts"]]);
  });

  test("tells the case's milestones and its response, with who did it", async () => {
    const told: SecurityCaseStoryJson = await story();

    expect(
      told.items
        .filter((entry: SecurityCaseStoryItemJson): boolean => {
          return entry.kind === SecurityCaseStoryItemKind.Milestone;
        })
        .map((entry: SecurityCaseStoryItemJson) => {
          return entry.milestone;
        }),
    ).toEqual([SecurityCaseStoryMilestone.Acknowledged]);
    expect(itemOf(told, SecurityCaseStoryItemKind.PlaybookRun)).toMatchObject({
      title: "Block the address",
      stateName: SecurityPlaybookRunStatus.Succeeded,
      actorName: "Kim Morgan",
      links: { playbookRunId: RUN_ID },
    });
    expect(itemOf(told, SecurityCaseStoryItemKind.Note).title).toBe(
      "Blocked at the edge.",
    );
  });

  test("reads the events naming the case's entities, in its window and the reader's resources, findings left out", async () => {
    const filter: jest.SpyInstance = jest
      .spyOn(TelemetryReadAccess, "getServiceFilter")
      .mockResolvedValue({
        serviceIds: [new ObjectID(SERVICE_ID)],
      } as never);

    await story();

    expect(filter).toHaveBeenCalledWith(
      expect.objectContaining({ props: CALLER }),
    );

    const statement: Statement = executeQuery.mock.calls[0]![0] as Statement;

    expect(statement.query).toContain("hasAny(observables,");
    expect(statement.query).toContain("classUid NOT IN (2004, 2005)");
    expect(statement.query).toContain("primaryEntityId IN (");
    expect(statement.query).toContain("ORDER BY time ASC LIMIT");
    expect(Object.values(statement.query_params)).toContainEqual([
      "203.0.113.7",
    ]);
    expect(Object.values(statement.query_params)).toContain(
      SECURITY_CASE_STORY_MAX_EVENTS + 1,
    );
  });

  test("a case that names nothing has no events to read", async () => {
    caseRead({ entities: [] });

    const told: SecurityCaseStoryJson = await story();

    expect(executeQuery).not.toHaveBeenCalled();
    expect(told.unreadableSources).toEqual([]);
    expect(itemOf(told, SecurityCaseStoryItemKind.Detection)).toBeDefined();
  });

  test("says which sources the reader's role cannot read, and still tells the rest", async () => {
    jest
      .spyOn(SecurityDetectionService, "findBy")
      .mockRejectedValue(new NotAuthorizedException("no"));
    jest
      .spyOn(TelemetryReadAccess, "getServiceFilter")
      .mockRejectedValue(new NotAuthorizedException("no"));
    jest
      .spyOn(ChangeEventService, "findBy")
      .mockRejectedValue(new NotAuthorizedException("no"));

    const told: SecurityCaseStoryJson = await story();

    expect(told.unreadableSources).toEqual([
      SecurityCaseStorySource.Changes,
      SecurityCaseStorySource.Detections,
      SecurityCaseStorySource.Events,
    ]);
    expect(told.failedSources).toEqual([]);
    expect(keys(told)).toContain(`run:${RUN_ID}`);
    expect(keys(told)).not.toContain(`detection:${DETECTION_ID}`);
    expect(logger.error).not.toHaveBeenCalled();
  });

  test("tells what a request threw without the link when the reader may not read exceptions, and says why", async () => {
    exceptionRead.mockRejectedValue(new NotAuthorizedException("no"));

    const told: SecurityCaseStoryJson = await story();

    expect(itemOf(told, SecurityCaseStoryItemKind.Exception).links).toEqual({
      exceptionFingerprint: "fp-1",
      traceId: "trace-1",
      spanId: "span-1",
    });
    expect(told.unreadableSources).toEqual([
      SecurityCaseStorySource.Exceptions,
    ]);
  });

  test("says which sources could not be read this time", async () => {
    jest
      .spyOn(SecurityCaseNoteService, "findBy")
      .mockRejectedValue(new Error("connection reset"));

    const told: SecurityCaseStoryJson = await story();

    expect(told.failedSources).toEqual([SecurityCaseStorySource.Notes]);
    expect(told.unreadableSources).toEqual([]);
    expect(logger.error).toHaveBeenCalled();
  });

  test("when the records cannot be read, says the changes, incidents and alerts are not known", async () => {
    jest
      .spyOn(SecurityConnections, "forCase")
      .mockRejectedValue(new Error("down"));

    const told: SecurityCaseStoryJson = await story();

    expect(told.failedSources).toEqual([
      SecurityCaseStorySource.Alerts,
      SecurityCaseStorySource.Changes,
      SecurityCaseStorySource.Incidents,
    ]);
    expect(changeRead).not.toHaveBeenCalled();
    expect(incidentRead).not.toHaveBeenCalled();
  });

  test("says a source held more than the story shows", async () => {
    jest.spyOn(SecurityDetectionService, "findBy").mockResolvedValue(
      Array.from(
        { length: SECURITY_CASE_STORY_MAX_DETECTIONS + 1 },
        (_value: unknown, index: number): SecurityDetection => {
          const row: SecurityDetection = detection();
          row._id = `99999999-9999-4999-8999-${String(index).padStart(12, "0")}`;
          return row;
        },
      ),
    );

    const told: SecurityCaseStoryJson = await story();

    expect(told.truncatedSources).toContain(SecurityCaseStorySource.Detections);
    expect(
      told.items.filter((entry: SecurityCaseStoryItemJson): boolean => {
        return entry.kind === SecurityCaseStoryItemKind.Detection;
      }),
    ).toHaveLength(SECURITY_CASE_STORY_MAX_DETECTIONS);
  });

  test("reads every source as the reader", async () => {
    await story();

    for (const spy of [
      SecurityDetectionService.findBy,
      SecurityPlaybookRunService.findBy,
      SecurityCaseNoteService.findBy,
      AlertService.findBy,
      IncidentService.findBy,
      IncidentService.findOneBy,
    ] as Array<unknown>) {
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ props: CALLER }),
      );
    }
  });
});

describe("the pieces a story is told from", () => {
  test("a detection is told at the time it first fired, until it last did", () => {
    expect(toDetectionItem(detection())).toEqual({
      key: `detection:${DETECTION_ID}`,
      kind: SecurityCaseStoryItemKind.Detection,
      time: at(5).toISOString(),
      endTime: at(45).toISOString(),
      title: "SQL injection attempts",
      detail: "203.0.113.7",
      severityName: OcsfSeverity.High,
      count: 3,
      links: {
        detectionId: DETECTION_ID,
        eventUid: "detection:rule:fp:1",
        observable: "203.0.113.7",
      },
    });

    const once: SecurityDetection = detection();
    once.lastSeenAt = once.firstSeenAt!;
    delete once.fireCount;
    delete once.title;
    once.ruleName = "Brute force";

    expect(toDetectionItem(once)).toMatchObject({
      title: "Brute force",
      count: 1,
    });
    expect(toDetectionItem(once).endTime).toBeUndefined();
  });

  test("a playbook run says its state in its own colour, and a note its first line", () => {
    const run: SecurityPlaybookRun = withId(new SecurityPlaybookRun(), RUN_ID);
    run.status = SecurityPlaybookRunStatus.Failed;
    run.createdAt = at(1);

    expect(toPlaybookRunItem(run)).toMatchObject({
      stateName: SecurityPlaybookRunStatus.Failed,
      links: { playbookRunId: RUN_ID },
    });
    expect(toPlaybookRunItem(run).stateColor).toMatch(/^#|rgb/);

    const note: SecurityCaseNote = withId(new SecurityCaseNote(), NOTE_ID);
    note.note = "one\ntwo";
    note.createdAt = at(2);

    expect(toNoteItem(note)).toEqual({
      key: `note:${NOTE_ID}`,
      kind: SecurityCaseStoryItemKind.Note,
      time: at(2).toISOString(),
      title: "one",
      links: {},
    });
  });

  test("groups the records the case names by kind, each once", () => {
    expect(
      Array.from(
        getRecordIdsByKind([
          connectedResource(SecurityConnectionKind.Host, "h1", "a"),
          connectedResource(SecurityConnectionKind.Host, "h1", "a"),
          connectedResource(SecurityConnectionKind.Host, "h2", "b"),
          connectedResource(SecurityConnectionKind.Service, "s1", "c"),
        ]).entries(),
      ),
    ).toEqual([
      [SecurityConnectionKind.Host, ["h1", "h2"]],
      [SecurityConnectionKind.Service, ["s1"]],
    ]);
  });

  test("the events' SQL binds every value, and reads only what a story shows", () => {
    const statement: Statement = buildStoryEventsStatement({
      projectId: PROJECT_ID,
      values: ["203.0.113.7'); DROP TABLE x; --"],
      start: at(0),
      end: at(60),
      serviceFilter: {},
      limit: 10,
    });

    expect(statement.query).not.toContain("DROP TABLE");
    // The table is bound as an identifier; the findings' classes are the code's own.
    expect(Object.values(statement.query_params)).toContain(
      "SecurityEventItemV1",
    );
    expect(statement.query).toContain("classUid NOT IN (2004, 2005)");
    expect(statement.query).toContain("mapFilter((key, value) -> has(");
    expect(statement.query).not.toContain("primaryEntityId IN (");
  });
});
