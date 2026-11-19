import SecurityCaseEvidenceService, {
  SECURITY_CASE_EVENTS_CASE_NOT_FOUND,
} from "../../../Server/Services/SecurityCaseEvidenceService";
import SecurityCaseFeedService from "../../../Server/Services/SecurityCaseFeedService";
import SecurityCaseService from "../../../Server/Services/SecurityCaseService";
import SecurityDetectionService from "../../../Server/Services/SecurityDetectionService";
import SecurityEventService from "../../../Server/Services/SecurityEventService";
import TelemetryReadAccess from "../../../Server/Utils/Telemetry/TelemetryReadAccess";
import SecurityDetection from "../../../Models/DatabaseModels/SecurityDetection";
import { buildSecurityDetectionMatchedEvent } from "../../../Types/SecurityCase/SecurityDetectionMatchedEvents";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import ProjectReferenceCheck from "../../../Server/Utils/Database/ProjectReferenceCheck";
import logger from "../../../Server/Utils/Logger";
import SecurityEvent from "../../../Models/AnalyticsModels/SecurityEvent";
import SecurityCase from "../../../Models/DatabaseModels/SecurityCase";
import SecurityCaseEvidence from "../../../Models/DatabaseModels/SecurityCaseEvidence";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import Includes from "../../../Types/BaseDatabase/Includes";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import SecurityCaseEvidenceKind from "../../../Types/SecurityCase/SecurityCaseEvidenceKind";
import {
  SecurityCaseEventReference,
  SecurityCaseEventSnapshot,
  SecurityCaseEventsAddResult,
  readSecurityCaseEventSnapshot,
} from "../../../Types/SecurityCase/SecurityCaseEventEvidence";
import { SecurityCaseFeedEventType } from "../../../Models/DatabaseModels/SecurityCaseFeed";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * SECURITY EVENTS KEPT ON A CASE (SecurityCaseEvidenceService.addEvents).
 *
 * The case is read as the person keeping the events; each event is read
 * from the events table AS THEM, by its id near the time named, and kept
 * as OneUptime read it - an event they cannot read, or one past its
 * retention, is not found, said the same way. An event already on the
 * case is left as it was. The rows are OneUptime's to write (no caller
 * writes a snapshot), in the person's name; the case's timeline says it
 * once for them all, with the hunt that found them. A request can never
 * write Event evidence itself.
 */

type Spy = ReturnType<typeof getJestSpyOn>;

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const CASE_ID: ObjectID = new ObjectID("20000000-0000-4000-8000-000000000138");
const MAYA: ObjectID = new ObjectID("80000000-0000-4000-8000-000000000001");
const AS_MAYA: DatabaseCommonInteractionProps = {
  userId: MAYA,
  tenantId: PROJECT_ID,
};
const HUNT: { id: string; name: string } = {
  id: "3b000000-0000-4000-8000-000000000001",
  name: "Encoded PowerShell",
};

function event(
  uid: string,
  time: string,
  values: Partial<Record<string, JSONValue>> = {},
): SecurityEvent {
  const row: SecurityEvent = new SecurityEvent();
  row.setColumnValue("eventUid", uid);
  row.setColumnValue("time", new Date(time));
  row.setColumnValue("severityName", "High");
  row.setColumnValue("className", "Process Activity");
  row.setColumnValue("activityName", "Launch");
  row.setColumnValue(
    "message",
    `Encoded PowerShell started on web-03 (${uid})`,
  );
  for (const [key, value] of Object.entries(values)) {
    row.setColumnValue(key, value as JSONValue);
  }
  return row;
}

function reference(uid: string, time: string): SecurityCaseEventReference {
  return { eventUid: uid, time: new Date(time) };
}

let findCase: Spy;
let findEvents: Spy;
let findKept: Spy;
let create: Spy;
let feed: Spy;

beforeEach(() => {
  const securityCase: SecurityCase = new SecurityCase();
  securityCase._id = CASE_ID.toString();
  findCase = getJestSpyOn(SecurityCaseService, "findOneBy").mockResolvedValue(
    securityCase as never,
  );
  findEvents = getJestSpyOn(SecurityEventService, "findBy").mockResolvedValue([
    event("evt-1", "2026-10-28T22:42:00.000Z"),
    event("evt-2", "2026-10-28T23:00:00.000Z"),
  ] as never);
  findKept = getJestSpyOn(
    SecurityCaseEvidenceService,
    "findBy",
  ).mockResolvedValue([] as never);
  create = getJestSpyOn(
    SecurityCaseEvidenceService,
    "create",
  ).mockImplementation((async (args: { data: SecurityCaseEvidence }) => {
    return args.data;
  }) as never);
  feed = getJestSpyOn(
    SecurityCaseFeedService,
    "createSecurityCaseFeedItem",
  ).mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function add(
  events: Array<SecurityCaseEventReference>,
  hunt: { id: string; name: string } | null = HUNT,
): Promise<SecurityCaseEventsAddResult> {
  return await SecurityCaseEvidenceService.addEvents({
    projectId: PROJECT_ID,
    securityCaseId: CASE_ID,
    events,
    hunt,
    props: AS_MAYA,
  });
}

// The evidence rows written, in order.
function written(): Array<SecurityCaseEvidence> {
  return create.mock.calls.map((call: Array<unknown>): SecurityCaseEvidence => {
    return (call[0] as { data: SecurityCaseEvidence }).data;
  });
}

describe("events kept on a case", () => {
  test("are each kept as OneUptime read them, naming the hunt that found them, in the person's name", async () => {
    const result: SecurityCaseEventsAddResult = await add([
      reference("evt-1", "2026-10-28T22:42:00.000Z"),
      reference("evt-2", "2026-10-28T23:00:00.000Z"),
    ]);

    expect(result).toEqual({
      added: ["evt-1", "evt-2"],
      alreadyOnCase: [],
      notFound: [],
    });

    const [first] = written();
    const snapshot: SecurityCaseEventSnapshot | null =
      readSecurityCaseEventSnapshot(first!.eventSnapshot);

    expect(first!.kind).toBe(SecurityCaseEvidenceKind.Event);
    expect(first!.projectId).toEqual(PROJECT_ID);
    expect(first!.securityCaseId).toEqual(CASE_ID);
    expect(first!.eventUid).toBe("evt-1");
    expect(first!.eventTime).toEqual(new Date("2026-10-28T22:42:00.000Z"));
    expect(first!.name).toBe("Encoded PowerShell started on web-03 (evt-1)");
    expect(first!.createdByUserId).toEqual(MAYA);
    expect(snapshot!.hunt).toEqual(HUNT);
    expect(snapshot!.severityName).toBe("High");

    // OneUptime writes the row: no caller may write an event's snapshot.
    const props: DatabaseCommonInteractionProps = (
      create.mock.calls[0]![0] as { props: DatabaseCommonInteractionProps }
    ).props;
    expect(props).toEqual({ isRoot: true, userId: MAYA });
  });

  test("reads the case and the events as the person keeping them", async () => {
    await add([reference("evt-1", "2026-10-28T22:42:00.000Z")]);

    const caseRead: Record<string, unknown> = findCase.mock
      .calls[0]![0] as Record<string, unknown>;
    const eventsRead: Record<string, unknown> = findEvents.mock
      .calls[0]![0] as Record<string, unknown>;
    const query: Record<string, unknown> = eventsRead["query"] as Record<
      string,
      unknown
    >;

    expect(caseRead["query"]).toEqual({ _id: CASE_ID, projectId: PROJECT_ID });
    expect(caseRead["props"]).toBe(AS_MAYA);
    expect(eventsRead["props"]).toBe(AS_MAYA);
    expect(query["projectId"]).toEqual(PROJECT_ID);
    expect(query["eventUid"]).toEqual(new Includes(["evt-1"]));
    // A second either side of the time named, and no more.
    expect(query["time"]).toEqual(
      new InBetween<Date>(
        new Date("2026-10-28T22:41:59.000Z"),
        new Date("2026-10-28T22:42:01.000Z"),
      ),
    );
  });

  test("an event the person cannot read, past its retention, or at another time is not found - said the same way", async () => {
    findEvents.mockResolvedValue([
      // The same id at another moment: another event.
      event("evt-1", "2026-10-28T22:45:00.000Z"),
    ] as never);

    const result: SecurityCaseEventsAddResult = await add([
      reference("evt-1", "2026-10-28T22:42:00.000Z"),
      reference("evt-9", "2026-10-28T22:42:00.000Z"),
    ]);

    expect(result).toEqual({
      added: [],
      alreadyOnCase: [],
      notFound: ["evt-1", "evt-9"],
    });
    expect(create).not.toHaveBeenCalled();
    expect(feed).not.toHaveBeenCalled();
  });

  test("an id that repeats keeps the event closest to the time named, within a second", async () => {
    findEvents.mockResolvedValue([
      event("evt-1", "2026-10-28T22:42:00.900Z", { severityName: "Low" }),
      event("evt-1", "2026-10-28T22:42:00.100Z", { severityName: "Critical" }),
    ] as never);

    await add([reference("evt-1", "2026-10-28T22:42:00.000Z")]);

    expect(
      readSecurityCaseEventSnapshot(written()[0]!.eventSnapshot)!.severityName,
    ).toBe("Critical");
  });

  test("an event kept on the case already is left as it was", async () => {
    const kept: SecurityCaseEvidence = new SecurityCaseEvidence();
    kept.eventUid = "evt-1";
    findKept.mockResolvedValue([kept] as never);

    const result: SecurityCaseEventsAddResult = await add([
      reference("evt-1", "2026-10-28T22:42:00.000Z"),
      reference("evt-2", "2026-10-28T23:00:00.000Z"),
    ]);

    expect(result).toEqual({
      added: ["evt-2"],
      alreadyOnCase: ["evt-1"],
      notFound: [],
    });
    expect(written()).toHaveLength(1);
    expect((findKept.mock.calls[0]![0] as { props: unknown }).props).toEqual({
      isRoot: true,
    });
  });

  test("the case's timeline says it once for them all, with the hunt", async () => {
    await add([
      reference("evt-1", "2026-10-28T22:42:00.000Z"),
      reference("evt-2", "2026-10-28T23:00:00.000Z"),
    ]);

    expect(feed).toHaveBeenCalledTimes(1);

    const entry: Record<string, unknown> = feed.mock.calls[0]![0] as Record<
      string,
      unknown
    >;

    expect(entry["eventType"]).toBe(SecurityCaseFeedEventType.Evidence);
    expect(entry["userId"]).toEqual(MAYA);
    expect(entry["feedInfoInMarkdown"]).toContain("2");
    expect(entry["feedInfoInMarkdown"]).toContain("Encoded PowerShell");
    expect(entry["moreInformationInMarkdown"]).toContain("evt-1");
    expect(entry["moreInformationInMarkdown"]).toContain("evt-2");
  });

  test("kept with no hunt: the timeline names none", async () => {
    await add([reference("evt-1", "2026-10-28T22:42:00.000Z")], null);

    expect(
      readSecurityCaseEventSnapshot(written()[0]!.eventSnapshot)!.hunt,
    ).toBeNull();
    expect(
      (feed.mock.calls[0]![0] as { feedInfoInMarkdown: string })
        .feedInfoInMarkdown,
    ).not.toContain("hunt");
  });

  test("stay kept when the timeline cannot say so", async () => {
    feed.mockRejectedValue(new Error("feed is down") as never);
    getJestSpyOn(logger, "error").mockImplementation((() => {
      return undefined;
    }) as never);

    await expect(
      add([reference("evt-1", "2026-10-28T22:42:00.000Z")]),
    ).resolves.toEqual({ added: ["evt-1"], alreadyOnCase: [], notFound: [] });
  });

  test("on a case the person cannot read, or that is not there: the same answer, nothing read", async () => {
    findCase.mockResolvedValue(null as never);

    await expect(
      add([reference("evt-1", "2026-10-28T22:42:00.000Z")]),
    ).rejects.toEqual(
      new BadDataException(SECURITY_CASE_EVENTS_CASE_NOT_FOUND),
    );
    expect(findEvents).not.toHaveBeenCalled();
  });

  test("at most a page of them at a time, and nothing to do for none", async () => {
    const many: Array<SecurityCaseEventReference> = Array.from(
      { length: 101 },
      (_: unknown, index: number): SecurityCaseEventReference => {
        return reference(`evt-${index}`, "2026-10-28T22:42:00.000Z");
      },
    );

    await expect(add(many)).rejects.toBeInstanceOf(BadDataException);
    await expect(add([])).resolves.toEqual({
      added: [],
      alreadyOnCase: [],
      notFound: [],
    });
    expect(findCase).not.toHaveBeenCalled();
  });
});

describe("Event evidence written by a request", () => {
  type HookCaller = {
    onBeforeCreate: (
      createBy: CreateBy<SecurityCaseEvidence>,
    ) => Promise<OnCreate<SecurityCaseEvidence>>;
  };

  const hooks: HookCaller =
    SecurityCaseEvidenceService as unknown as HookCaller;

  function eventEvidence(): SecurityCaseEvidence {
    const evidence: SecurityCaseEvidence = new SecurityCaseEvidence();
    evidence.projectId = PROJECT_ID;
    evidence.securityCaseId = CASE_ID;
    evidence.kind = SecurityCaseEvidenceKind.Event;
    evidence.name = "  An event I made up  ";
    return evidence;
  }

  beforeEach(() => {
    getJestSpyOn(ProjectReferenceCheck, "validateCreate").mockResolvedValue(
      undefined as never,
    );
  });

  test("is refused: an event is kept from what OneUptime reads of it, from Security Events", async () => {
    await expect(
      hooks.onBeforeCreate({
        data: eventEvidence(),
        props: AS_MAYA,
      } as CreateBy<SecurityCaseEvidence>),
    ).rejects.toEqual(
      new BadDataException(
        "Security events are kept on a case from Security Events: tick them on Events or a hunt, then choose Add to Case.",
      ),
    );
  });

  test("by OneUptime itself: kept, its name trimmed", async () => {
    const onCreate: OnCreate<SecurityCaseEvidence> = await hooks.onBeforeCreate(
      {
        data: eventEvidence(),
        props: { isRoot: true },
      } as CreateBy<SecurityCaseEvidence>,
    );

    expect(onCreate.createBy.data.name).toBe("An event I made up");
  });
});

/*
 * Events kept from what one of the case's detections matched (#9622): each
 * names the detection, and one past its retention is kept as the detection
 * kept it when it fired (#9619) - only one of a source the person's role
 * reads, within a second of the time named.
 */
describe("events kept from what a detection matched", () => {
  const DETECTION_ID: ObjectID = new ObjectID(
    "40000000-0000-4000-8000-000000000001",
  );
  const SOURCE_ID: string = "50000000-0000-4000-8000-000000000001";
  const OTHER_SOURCE_ID: string = "50000000-0000-4000-8000-000000000002";

  let findDetection: Spy;
  let findKeptByDetection: Spy;
  let serviceFilter: Spy;

  function detectionRow(): SecurityDetection {
    const detection: SecurityDetection = new SecurityDetection();
    detection._id = DETECTION_ID.toString();
    detection.title = "Encoded PowerShell — web-03";
    detection.ruleName = "Encoded PowerShell command";
    return detection;
  }

  function keptCopy(
    uid: string,
    time: string,
    sourceId: string = SOURCE_ID,
  ): JSONObject {
    return buildSecurityDetectionMatchedEvent({
      time,
      eventUid: uid,
      primaryEntityId: sourceId,
      severityName: "High",
      className: "Process Activity",
      message: `Encoded PowerShell started on web-03 (${uid}), as kept`,
      retentionDate: "2026-10-30 00:00:00",
    }) as unknown as JSONObject;
  }

  beforeEach(() => {
    findDetection = getJestSpyOn(
      SecurityDetectionService,
      "findOneBy",
    ).mockResolvedValue(detectionRow() as never);

    const stored: SecurityDetection = new SecurityDetection();
    stored.matchedEvents = {
      events: [
        keptCopy("gone-1", "2026-10-28T21:00:00.000Z"),
        keptCopy("gone-2", "2026-10-28T21:01:00.000Z", OTHER_SOURCE_ID),
      ],
      outcomes: {},
    } as unknown as JSONObject;

    findKeptByDetection = getJestSpyOn(
      SecurityDetectionService,
      "findOneById",
    ).mockResolvedValue(stored as never);

    serviceFilter = getJestSpyOn(
      TelemetryReadAccess,
      "getServiceFilter",
    ).mockResolvedValue({
      serviceIds: [new ObjectID(SOURCE_ID)],
    } as never);
  });

  async function addMatched(
    events: Array<SecurityCaseEventReference>,
  ): Promise<SecurityCaseEventsAddResult> {
    return await SecurityCaseEvidenceService.addEvents({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
      events,
      hunt: null,
      detectionId: DETECTION_ID,
      props: AS_MAYA,
    });
  }

  test("each names the detection it was matched by, and the timeline says so", async () => {
    await addMatched([reference("evt-1", "2026-10-28T22:42:00.000Z")]);

    const snapshot: SecurityCaseEventSnapshot | null =
      readSecurityCaseEventSnapshot(written()[0]!.eventSnapshot);

    expect(snapshot!.detection).toEqual({
      id: DETECTION_ID.toString(),
      name: "Encoded PowerShell command",
    });
    expect(snapshot!.hunt).toBeNull();
    expect(
      (feed.mock.calls[0]![0] as { feedInfoInMarkdown: string })
        .feedInfoInMarkdown,
    ).toContain("matched by **Encoded PowerShell command**");
  });

  test("reads the detection as the person keeping the events: one of this case's", async () => {
    await addMatched([reference("evt-1", "2026-10-28T22:42:00.000Z")]);

    const read: Record<string, unknown> = findDetection.mock
      .calls[0]![0] as Record<string, unknown>;

    expect(read["query"]).toEqual({
      _id: DETECTION_ID,
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
    });
    expect(read["props"]).toBe(AS_MAYA);
  });

  test("keeps an event past its retention as the detection kept it, read as OneUptime", async () => {
    const result: SecurityCaseEventsAddResult = await addMatched([
      reference("gone-1", "2026-10-28T21:00:00.400Z"),
    ]);

    expect(result.added).toEqual(["gone-1"]);

    const [row] = written();
    const snapshot: SecurityCaseEventSnapshot | null =
      readSecurityCaseEventSnapshot(row!.eventSnapshot);

    expect(row!.eventUid).toBe("gone-1");
    expect(row!.eventTime).toEqual(new Date("2026-10-28T21:00:00.000Z"));
    expect(row!.name).toBe(
      "Encoded PowerShell started on web-03 (gone-1), as kept",
    );
    expect(snapshot!.sourceId).toBe(SOURCE_ID);
    expect(snapshot!.detection!.id).toBe(DETECTION_ID.toString());
    // What the detection kept is the snapshot's own: no field of it is added.
    expect(
      Object.keys(row!.eventSnapshot as Record<string, unknown>),
    ).not.toContain("retentionDate");
    expect(findKeptByDetection).toHaveBeenCalledWith(
      expect.objectContaining({
        id: DETECTION_ID,
        select: { matchedEvents: true },
        props: { isRoot: true },
      }),
    );
  });

  test("never keeps the copy of an event from a source the person's role does not read", async () => {
    const result: SecurityCaseEventsAddResult = await addMatched([
      reference("gone-2", "2026-10-28T21:01:00.000Z"),
    ]);

    expect(result).toEqual({
      added: [],
      alreadyOnCase: [],
      notFound: ["gone-2"],
    });
    expect(create).not.toHaveBeenCalled();
  });

  test("never keeps a copy whose time is not the one named", async () => {
    const result: SecurityCaseEventsAddResult = await addMatched([
      reference("gone-1", "2026-10-28T21:00:05.000Z"),
    ]);

    expect(result.notFound).toEqual(["gone-1"]);
  });

  test("a person who may read no security events keeps no copy", async () => {
    serviceFilter.mockRejectedValue(new BadDataException("No."));

    const result: SecurityCaseEventsAddResult = await addMatched([
      reference("gone-1", "2026-10-28T21:00:00.000Z"),
    ]);

    expect(result.notFound).toEqual(["gone-1"]);
    expect(findKeptByDetection).not.toHaveBeenCalled();
  });

  test("a detection not on this case, or not the person's to read, is named on nothing, and keeps no copy", async () => {
    findDetection.mockResolvedValue(null as never);

    const result: SecurityCaseEventsAddResult = await addMatched([
      reference("evt-1", "2026-10-28T22:42:00.000Z"),
      reference("gone-1", "2026-10-28T21:00:00.000Z"),
    ]);

    expect(result).toEqual({
      added: ["evt-1"],
      alreadyOnCase: [],
      notFound: ["gone-1"],
    });
    expect(
      readSecurityCaseEventSnapshot(written()[0]!.eventSnapshot)!.detection,
    ).toBeUndefined();
    expect(findKeptByDetection).not.toHaveBeenCalled();
  });

  test("a detection that cannot be read leaves the events kept as any are", async () => {
    findDetection.mockRejectedValue(new Error("No."));

    const result: SecurityCaseEventsAddResult = await addMatched([
      reference("evt-1", "2026-10-28T22:42:00.000Z"),
    ]);

    expect(result.added).toEqual(["evt-1"]);
  });

  test("an event the table still has is kept as the table has it, the copy left alone", async () => {
    await addMatched([reference("evt-2", "2026-10-28T23:00:00.000Z")]);

    expect(written()[0]!.name).toBe(
      "Encoded PowerShell started on web-03 (evt-2)",
    );
    expect(findKeptByDetection).not.toHaveBeenCalled();
  });
});
