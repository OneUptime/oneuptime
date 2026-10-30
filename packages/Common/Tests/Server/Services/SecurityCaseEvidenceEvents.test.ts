import SecurityCaseEvidenceService, {
  SECURITY_CASE_EVENTS_CASE_NOT_FOUND,
} from "../../../Server/Services/SecurityCaseEvidenceService";
import SecurityCaseFeedService from "../../../Server/Services/SecurityCaseFeedService";
import SecurityCaseService from "../../../Server/Services/SecurityCaseService";
import SecurityEventService from "../../../Server/Services/SecurityEventService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import ProjectReferenceCheck from "../../../Server/Utils/Database/ProjectReferenceCheck";
import logger from "../../../Server/Utils/Logger";
import SecurityEvent from "../../../Models/AnalyticsModels/SecurityEvent";
import SecurityCase from "../../../Models/DatabaseModels/SecurityCase";
import SecurityCaseEvidence from "../../../Models/DatabaseModels/SecurityCaseEvidence";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import { JSONValue } from "../../../Types/JSON";
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
