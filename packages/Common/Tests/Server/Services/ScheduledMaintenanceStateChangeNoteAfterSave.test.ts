import Semaphore from "../../../Server/Infrastructure/Semaphore";
import ScheduledMaintenanceFeedService from "../../../Server/Services/ScheduledMaintenanceFeedService";
import ScheduledMaintenanceMeasurementValueService from "../../../Server/Services/ScheduledMaintenanceMeasurementValueService";
import ScheduledMaintenancePublicNoteService from "../../../Server/Services/ScheduledMaintenancePublicNoteService";
import ScheduledMaintenanceService from "../../../Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateService from "../../../Server/Services/ScheduledMaintenanceStateService";
import ScheduledMaintenanceStateTimelineService from "../../../Server/Services/ScheduledMaintenanceStateTimelineService";
import WorkspaceNotificationRuleService from "../../../Server/Services/WorkspaceNotificationRuleService";
import StateChangePublicNote from "../../../Server/Utils/StatusPage/StateChangePublicNote";
import { ScheduledMaintenanceFeedEventType } from "../../../Models/DatabaseModels/ScheduledMaintenanceFeed";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenancePublicNote from "../../../Models/DatabaseModels/ScheduledMaintenancePublicNote";
import ScheduledMaintenanceState from "../../../Models/DatabaseModels/ScheduledMaintenanceState";
import ScheduledMaintenanceStateTimeline from "../../../Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import URL from "../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import StateChangeSubscriberNotification from "../../../Types/StatusPage/StateChangeSubscriberNotification";
import StatusPageSubscriberNotificationStatus from "../../../Types/StatusPage/StatusPageSubscriberNotificationStatus";
import UserType from "../../../Types/UserType";
import FeedMarkdown from "../../../Utils/Markdown/FeedMarkdown";
import { getJestSpyOn } from "../../Spy";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { stubReadableParents } from "../TestingUtils/ReadableParents";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

// Every refusal below is deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../Server/Utils/Logger");

/*
 * A SCHEDULED MAINTENANCE STATE CHANGE POSTS ITS NOTE ONLY ONCE THE CHANGE
 * IS SAVED.
 *
 * Moving a scheduled maintenance event to another state can post a public
 * note with it: "Add a public note" in the Mark Scheduled Maintenance as ...
 * dialog, the Change State bulk action, or `miscDataProps.publicNote` on
 * POST /api/scheduled-maintenance-state-timeline. With "Notify Status Page
 * Subscribers" on, that note is the one message subscribers get about the
 * change, and the change is recorded as sent by it
 * (StateChangeSubscriberNotification).
 *
 * The scheduled maintenance timeline used to create the note in
 * onBeforeCreate - before the change itself had been checked and saved. A
 * change that was then refused or failed to save left its note behind:
 * posted on the event, in its feed and its Slack and Microsoft Teams
 * channels, and queued to every subscriber, for a state change that never
 * happened. And the note came before the change in the event's feed (found
 * in #4442).
 *
 * It now does what the incident, alert and episode timelines do: the note
 * is built and checked - may the person changing the state post it? -
 * before the event is locked or anything is read (StateChangePublicNote),
 * carried forward, and posted in onCreateSuccess, once the change is saved.
 *
 * These run the real create pipeline - DatabaseService's checks, the hooks,
 * the save, the success hooks, and the note's own create through all of
 * the same - over in-memory tables, role by role.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "5e000000-0000-4000-8000-000000000001",
);
const USER_ID: ObjectID = new ObjectID("5e000000-0000-4000-8000-000000000002");
const EVENT_ID: ObjectID = new ObjectID("5e000000-0000-4000-8000-000000000003");
const SCHEDULED_STATE_ID: ObjectID = new ObjectID(
  "5e000000-0000-4000-8000-0000000000a1",
);
const ONGOING_STATE_ID: ObjectID = new ObjectID(
  "5e000000-0000-4000-8000-0000000000a2",
);
const ENDED_STATE_ID: ObjectID = new ObjectID(
  "5e000000-0000-4000-8000-0000000000a3",
);
const COMPLETED_STATE_ID: ObjectID = new ObjectID(
  "5e000000-0000-4000-8000-0000000000a4",
);
const SCHEDULED_ROW_ID: ObjectID = new ObjectID(
  "5e000000-0000-4000-8000-0000000000b1",
);
const ENDED_ROW_ID: ObjectID = new ObjectID(
  "5e000000-0000-4000-8000-0000000000b3",
);

// The event was scheduled at 08:00 and moves to Ongoing at 09:00.
const SCHEDULED_AT: Date = new Date("2026-10-08T08:00:00.000Z");
const STARTS_AT: Date = new Date("2026-10-08T09:00:00.000Z");
const ENDED_AT: Date = new Date("2026-10-08T10:00:00.000Z");

const NOTE: string = "The database upgrade has started. Expect read-only mode.";

// What a refused change says, around the note's own refusal.
const REFUSAL: RegExp =
  /^The state was not changed: it comes with a public note, which you may not post\. .+ To change the state, leave the public note out\.$/;

interface RoleCase {
  role: string;
  allow: Array<Permission>;
  block?: Array<Permission> | undefined;
}

// Every role here may change the event's state; these may post the note too.
const ROLES_THAT_MAY_POST: Array<RoleCase> = [
  { role: "Project Owner", allow: [Permission.ProjectOwner] },
  { role: "Project Admin", allow: [Permission.ProjectAdmin] },
  { role: "Project Member", allow: [Permission.ProjectMember] },
  {
    role: "Scheduled Maintenance Admin",
    allow: [Permission.ScheduledMaintenanceAdmin],
  },
  {
    role: "Scheduled Maintenance Member",
    allow: [Permission.ScheduledMaintenanceMember],
  },
  /*
   * A state change and its note are created only under an event their
   * creator may read: the narrowest role reads scheduled maintenance too.
   */
  {
    role: "Read Scheduled Maintenance, Create Scheduled Maintenance State Timeline and Create Scheduled Maintenance Public Note",
    allow: [
      Permission.ReadProjectScheduledMaintenance,
      Permission.CreateScheduledMaintenanceStateTimeline,
      Permission.CreateScheduledMaintenancePublicNote,
    ],
  },
];

// ...and these may change the state, but not post the note.
const ROLES_THAT_MAY_NOT_POST: Array<RoleCase> = [
  {
    role: "Read Scheduled Maintenance and Create Scheduled Maintenance State Timeline only",
    allow: [
      Permission.ReadProjectScheduledMaintenance,
      Permission.CreateScheduledMaintenanceStateTimeline,
    ],
  },
  {
    role: "Scheduled Maintenance Member, with Create Scheduled Maintenance Public Note blocked",
    allow: [Permission.ScheduledMaintenanceMember],
    block: [Permission.CreateScheduledMaintenancePublicNote],
  },
];

const MAY_POST: RoleCase = ROLES_THAT_MAY_POST[4]!;

function userPermission(
  permission: Permission,
  isBlockPermission: boolean,
): UserPermission {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: [],
    isBlockPermission: isBlockPermission,
    scope: PermissionScope.All,
  };
}

// A member of the project with these permissions, asking in it.
function memberProps(roleCase: RoleCase): DatabaseCommonInteractionProps {
  const tenantPermission: UserTenantAccessPermission = {
    projectId: PROJECT_ID,
    _type: "UserTenantAccessPermission",
    permissions: [
      ...[
        Permission.CurrentUser,
        Permission.ProjectUser,
        ...roleCase.allow,
      ].map((permission: Permission): UserPermission => {
        return userPermission(permission, false);
      }),
      ...(roleCase.block || []).map(
        (permission: Permission): UserPermission => {
          return userPermission(permission, true);
        },
      ),
    ],
  };

  return {
    userId: USER_ID,
    userType: UserType.User,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: tenantPermission,
    },
    ...ON_HIGHEST_PLAN,
  };
}

const ROOT_PROPS: DatabaseCommonInteractionProps = {
  isRoot: true,
  tenantId: PROJECT_ID,
};

// The project's states, in their order, as the state reads answer them.
function projectState(
  id: ObjectID,
  name: string,
  order: number,
): ScheduledMaintenanceState {
  const state: ScheduledMaintenanceState = new ScheduledMaintenanceState();
  state._id = id.toString();
  state.projectId = PROJECT_ID;
  state.name = name;
  state.order = order;
  state.isScheduledState = id.toString() === SCHEDULED_STATE_ID.toString();
  state.isOngoingState = id.toString() === ONGOING_STATE_ID.toString();
  state.isEndedState = id.toString() === ENDED_STATE_ID.toString();
  state.isResolvedState = id.toString() === COMPLETED_STATE_ID.toString();
  return state;
}

function projectStates(): Array<ScheduledMaintenanceState> {
  return [
    projectState(SCHEDULED_STATE_ID, "Scheduled", 1),
    projectState(ONGOING_STATE_ID, "Ongoing", 2),
    projectState(ENDED_STATE_ID, "Ended", 3),
    projectState(COMPLETED_STATE_ID, "Completed", 4),
  ];
}

// The event's first state, Scheduled, as its timeline holds it.
const SCHEDULED_ROW: StoredRow = {
  _id: SCHEDULED_ROW_ID.toString(),
  projectId: PROJECT_ID.toString(),
  scheduledMaintenanceId: EVENT_ID.toString(),
  scheduledMaintenanceStateId: SCHEDULED_STATE_ID.toString(),
  startsAt: SCHEDULED_AT,
};

// The move to Ongoing, as the dashboard and the API send it.
function moveToOngoing(data: {
  notify?: boolean | undefined;
  startsAt?: Date | null | undefined;
}): ScheduledMaintenanceStateTimeline {
  const timeline: ScheduledMaintenanceStateTimeline =
    new ScheduledMaintenanceStateTimeline();
  timeline.projectId = PROJECT_ID;
  timeline.scheduledMaintenanceId = EVENT_ID;
  timeline.scheduledMaintenanceStateId = ONGOING_STATE_ID;

  // null: the change says no time, and is made at the time it is saved.
  if (data.startsAt !== null) {
    timeline.startsAt = data.startsAt || STARTS_AT;
  }

  if (data.notify !== undefined) {
    timeline.shouldStatusPageSubscribersBeNotified = data.notify;
  }

  return timeline;
}

function withNote(note: unknown): JSONObject {
  return note === undefined ? {} : ({ publicNote: note } as JSONObject);
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  return undefined;
}

let timelines: InMemoryTable;
let notes: InMemoryTable;
// Every row written to either table, in the order it was written.
let writes: Array<string>;
let lock: ReturnType<typeof getJestSpyOn>;
let release: ReturnType<typeof getJestSpyOn>;
let feedItems: ReturnType<typeof getJestSpyOn>;

// Each insert into the table, as it lands, in one log for both tables.
function logInserts(table: InMemoryTable, what: string): void {
  const save: (entity: unknown) => Promise<unknown> =
    table.repository.save.getMockImplementation() as (
      entity: unknown,
    ) => Promise<unknown>;

  table.repository.save.mockImplementation(async (entity: unknown) => {
    const saved: unknown = await save(entity);
    writes.push(what);
    return saved;
  });
}

/*
 * Postgres fills a column the insert left out with its default and hands
 * it back (INSERT ... RETURNING), so the saved row reads it: a change that
 * did not say whether to notify reads as notifying, and as queued.
 */
function withColumnDefaults(table: InMemoryTable, defaults: StoredRow): void {
  const save: (entity: unknown) => Promise<unknown> =
    table.repository.save.getMockImplementation() as (
      entity: unknown,
    ) => Promise<unknown>;

  table.repository.save.mockImplementation(async (entity: unknown) => {
    for (const [column, value] of Object.entries(defaults)) {
      if ((entity as StoredRow)[column] === undefined) {
        (entity as StoredRow)[column] = value;
      }
    }

    return save(entity);
  });
}

// The kinds of the feed items written, in order.
function feedTypes(): Array<ScheduledMaintenanceFeedEventType> {
  return feedItems.mock.calls.map(
    (call: Array<unknown>): ScheduledMaintenanceFeedEventType => {
      return (
        call[0] as {
          scheduledMaintenanceFeedEventType: ScheduledMaintenanceFeedEventType;
        }
      ).scheduledMaintenanceFeedEventType;
    },
  );
}

async function changeState(data: {
  props: DatabaseCommonInteractionProps;
  note?: unknown;
  notify?: boolean | undefined;
  startsAt?: Date | null | undefined;
}): Promise<ScheduledMaintenanceStateTimeline> {
  return ScheduledMaintenanceStateTimelineService.create({
    data: moveToOngoing({
      notify: "notify" in data ? data.notify : true,
      startsAt: data.startsAt,
    }),
    miscDataProps: withNote(data.note),
    props: data.props,
  });
}

beforeEach(() => {
  writes = [];

  /*
   * The records a change names are the project's, and the event it is made
   * to is one the caller may read (CreatePermission.checkParentPermission).
   */
  stubProjectDirectory({});
  stubReadableParents();

  lock = getJestSpyOn(Semaphore, "lock").mockResolvedValue({
    key: "scheduled-maintenance-state-change",
  });
  release = getJestSpyOn(Semaphore, "release").mockResolvedValue(undefined);

  timelines = useInMemoryTable(ScheduledMaintenanceStateTimelineService, [
    SCHEDULED_ROW,
  ]);
  notes = useInMemoryTable(ScheduledMaintenancePublicNoteService, []);
  logInserts(timelines, "state change");
  logInserts(notes, "public note");

  getJestSpyOn(
    ScheduledMaintenancePublicNoteService as never,
    "getAttachmentsMarkdown",
  ).mockResolvedValue(FeedMarkdown.empty() as never);

  /*
   * A state as its reads answer it: by id, and asked again with a flag
   * ({ isOngoingState: true }) to tell which kind it is.
   */
  getJestSpyOn(ScheduledMaintenanceStateService, "findOneBy").mockImplementation(
    async (findOneBy: unknown): Promise<ScheduledMaintenanceState | null> => {
      const query: Dictionary<unknown> = (
        findOneBy as { query: Dictionary<unknown> }
      ).query;

      const found: ScheduledMaintenanceState | undefined = projectStates().find(
        (state: ScheduledMaintenanceState): boolean => {
          return state._id === String(query["_id"]);
        },
      );

      if (!found) {
        return null;
      }

      for (const flag of [
        "isScheduledState",
        "isOngoingState",
        "isEndedState",
        "isResolvedState",
      ]) {
        if (
          query[flag] !== undefined &&
          Boolean((found as unknown as Dictionary<unknown>)[flag]) !==
            query[flag]
        ) {
          return null;
        }
      }

      return found;
    },
  );
  // For whether this is the project's last state.
  getJestSpyOn(ScheduledMaintenanceStateService, "findBy").mockResolvedValue(
    projectStates(),
  );

  // The event, with nothing attached the move would hold or release.
  const event: ScheduledMaintenance = new ScheduledMaintenance();
  event._id = EVENT_ID.toString();
  event.projectId = PROJECT_ID;
  event.monitors = [];
  event.networkSites = [];
  getJestSpyOn(ScheduledMaintenanceService, "findOneBy").mockResolvedValue(
    event,
  );
  getJestSpyOn(ScheduledMaintenanceService, "updateOneBy").mockResolvedValue(1);
  getJestSpyOn(ScheduledMaintenanceService, "updateOneById").mockResolvedValue(
    undefined,
  );
  getJestSpyOn(
    ScheduledMaintenanceService,
    "getScheduledMaintenanceNumber",
  ).mockResolvedValue({ number: 7, numberWithPrefix: "SM-7" });
  getJestSpyOn(
    ScheduledMaintenanceService,
    "getScheduledMaintenanceLinkInDashboard",
  ).mockResolvedValue(
    URL.fromString("https://oneuptime.example/dashboard/scheduled-events/7"),
  );

  feedItems = getJestSpyOn(
    ScheduledMaintenanceFeedService,
    "createScheduledMaintenanceFeedItem",
  ).mockResolvedValue(undefined);
  getJestSpyOn(
    ScheduledMaintenanceMeasurementValueService,
    "recomputeForScheduledMaintenance",
  ).mockResolvedValue(undefined);
  getJestSpyOn(
    WorkspaceNotificationRuleService,
    "archiveWorkspaceChannels",
  ).mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a change that is not saved posts no note", () => {
  test("a change whose save fails leaves no note behind: nothing is posted, and nobody is told", async () => {
    // The state change's insert itself fails, after every check has passed.
    timelines.repository.save.mockRejectedValueOnce(
      new Error("The database went away."),
    );

    const error: unknown = await rejectionOf(
      changeState({ props: memberProps(MAY_POST), note: NOTE }),
    );

    expect((error as Error).message).toBe("The database went away.");
    expect(timelines.inserts).toEqual([]);
    expect(notes.inserts).toEqual([]);
    expect(writes).toEqual([]);
    // Not in the event's feed, nor in its Slack and Teams channels.
    expect(feedTypes()).toEqual([]);
  });

  test("a change refused by a check that runs after its hooks leaves no note behind", async () => {
    getJestSpyOn(
      ScheduledMaintenanceStateTimelineService as never,
      "onBeforeCreateUniqueCheck",
    ).mockRejectedValue(
      new BadDataException("This state change clashes with another.") as never,
    );

    const error: unknown = await rejectionOf(
      changeState({ props: memberProps(MAY_POST), note: NOTE }),
    );

    expect((error as Error).message).toBe(
      "This state change clashes with another.",
    );
    expect(timelines.inserts).toEqual([]);
    expect(notes.inserts).toEqual([]);
    expect(feedTypes()).toEqual([]);
  });

  test("OneUptime's own change that fails to save leaves no note either", async () => {
    timelines.repository.save.mockRejectedValueOnce(
      new Error("The database went away."),
    );

    await rejectionOf(changeState({ props: ROOT_PROPS, note: NOTE }));

    expect(notes.inserts).toEqual([]);
  });

  test.each(ROLES_THAT_MAY_NOT_POST)(
    "$role: refused whole, before the event is locked or read - neither the change nor its note is saved, and nobody is told",
    async (roleCase: RoleCase) => {
      const findTimelines: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
        ScheduledMaintenanceStateTimelineService,
        "findOneBy",
      );

      const error: unknown = await rejectionOf(
        changeState({ props: memberProps(roleCase), note: NOTE }),
      );

      expect(error).toBeInstanceOf(NotAuthorizedException);
      expect((error as Error).message).toMatch(REFUSAL);
      expect(timelines.inserts).toEqual([]);
      expect(notes.inserts).toEqual([]);
      expect(feedTypes()).toEqual([]);
      // Nothing waits on a change that is refused, and nothing was read.
      expect(lock).not.toHaveBeenCalled();
      expect(release).not.toHaveBeenCalled();
      expect(findTimelines).not.toHaveBeenCalled();
    },
  );
});

describe("a change that is saved posts its note after it", () => {
  test.each(ROLES_THAT_MAY_POST)(
    "$role: the change is saved first, then its note",
    async (roleCase: RoleCase) => {
      await changeState({ props: memberProps(roleCase), note: NOTE });

      expect(writes).toEqual(["state change", "public note"]);
      expect(timelines.inserts).toHaveLength(1);
      expect(notes.inserts).toHaveLength(1);
    },
  );

  test("the note is posted on the event, as written, at the change's time, in its project, by the person who changed the state, naming the state it moved to", async () => {
    await changeState({ props: memberProps(MAY_POST), note: NOTE });

    const note: StoredRow = notes.inserts[0]!;

    expect(note["note"]).toBe(NOTE);
    expect(String(note["scheduledMaintenanceId"])).toBe(EVENT_ID.toString());
    expect(String(note["projectId"])).toBe(PROJECT_ID.toString());
    expect(note["postedAt"]).toEqual(STARTS_AT);
    expect(note["createdAt"]).toEqual(STARTS_AT);
    expect(String(note["createdByUserId"])).toBe(USER_ID.toString());
    expect(String(note["postedWithScheduledMaintenanceStateId"])).toBe(
      ONGOING_STATE_ID.toString(),
    );
  });

  test("a change that names no time is made when it is saved, and its note carries that same time", async () => {
    await changeState({
      props: memberProps(MAY_POST),
      note: NOTE,
      startsAt: null,
    });

    const savedAt: unknown = timelines.inserts[0]!["startsAt"];

    expect(savedAt).toBeInstanceOf(Date);
    expect(notes.inserts[0]!["postedAt"]).toEqual(savedAt);
    expect(notes.inserts[0]!["createdAt"]).toEqual(savedAt);
  });

  test("a change filled in back in the timeline posts its note at the time it was filled in at", async () => {
    // The event already ended at 10:00; Ongoing is filled in at 09:00.
    timelines.rows.push({
      _id: ENDED_ROW_ID.toString(),
      projectId: PROJECT_ID.toString(),
      scheduledMaintenanceId: EVENT_ID.toString(),
      scheduledMaintenanceStateId: ENDED_STATE_ID.toString(),
      startsAt: ENDED_AT,
    });

    await changeState({ props: memberProps(MAY_POST), note: NOTE });

    // The change ends where the next one starts, and its note keeps its time.
    expect(timelines.inserts[0]!["endsAt"]).toEqual(ENDED_AT);
    expect(notes.inserts[0]!["postedAt"]).toEqual(STARTS_AT);
  });

  test("with Notify on, the note is the one message: it is queued to tell subscribers, and the change is recorded as sent by it", async () => {
    await changeState({ props: memberProps(MAY_POST), note: NOTE, notify: true });

    expect(timelines.inserts[0]!["subscriberNotificationStatus"]).toBe(
      StatusPageSubscriberNotificationStatus.Success,
    );
    expect(timelines.inserts[0]!["subscriberNotificationStatusMessage"]).toBe(
      StateChangeSubscriberNotification.sentByPublicNoteMessage,
    );
    expect(notes.inserts[0]!["shouldStatusPageSubscribersBeNotifiedOnNoteCreated"]).toBe(
      true,
    );
    expect(notes.inserts[0]!["subscriberNotificationStatusOnNoteCreated"]).toBe(
      StatusPageSubscriberNotificationStatus.Pending,
    );
  });

  test("with Notify off, the note is saved quietly and the change is skipped: nobody is told", async () => {
    await changeState({
      props: memberProps(MAY_POST),
      note: NOTE,
      notify: false,
    });

    expect(timelines.inserts[0]!["subscriberNotificationStatus"]).toBe(
      StatusPageSubscriberNotificationStatus.Skipped,
    );
    expect(notes.inserts[0]!["shouldStatusPageSubscribersBeNotifiedOnNoteCreated"]).toBe(
      false,
    );
    expect(notes.inserts[0]!["subscriberNotificationStatusOnNoteCreated"]).toBe(
      StatusPageSubscriberNotificationStatus.Skipped,
    );
  });

  test("a change that does not say whether to notify tells subscribers once: the change, by its column default, with its note kept quiet", async () => {
    withColumnDefaults(timelines, {
      shouldStatusPageSubscribersBeNotified: true,
      subscriberNotificationStatus:
        StatusPageSubscriberNotificationStatus.Pending,
    });

    await changeState({
      props: memberProps(MAY_POST),
      note: NOTE,
      notify: undefined,
    });

    expect(timelines.inserts[0]!["subscriberNotificationStatus"]).toBe(
      StatusPageSubscriberNotificationStatus.Pending,
    );
    expect(notes.inserts[0]!["shouldStatusPageSubscribersBeNotifiedOnNoteCreated"]).toBe(
      false,
    );
  });

  test("the note comes after the change in the event's feed, and so in its Slack and Microsoft Teams channels", async () => {
    await changeState({ props: memberProps(MAY_POST), note: NOTE });

    expect(feedTypes()).toEqual([
      ScheduledMaintenanceFeedEventType.ScheduledMaintenanceStateChanged,
      ScheduledMaintenanceFeedEventType.PublicNote,
    ]);
  });

  test("the event's lock is taken once, and let go before the note is posted", async () => {
    let releasedBeforeTheNote: boolean | null = null;

    notes.repository.save.mockImplementationOnce(async (entity: unknown) => {
      releasedBeforeTheNote = release.mock.calls.length === 1;
      notes.inserts.push({ ...(entity as StoredRow) });
      return entity;
    });

    await changeState({ props: memberProps(MAY_POST), note: NOTE });

    expect(lock).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
    expect(releasedBeforeTheNote).toBe(true);
  });

  test("OneUptime's own change (root) posts its note after the change too", async () => {
    await changeState({ props: ROOT_PROPS, note: NOTE });

    expect(writes).toEqual(["state change", "public note"]);
    expect(notes.inserts[0]!["note"]).toBe(NOTE);
  });

  test("without a note, the change is saved and queued, and no note is posted", async () => {
    await changeState({ props: memberProps(ROLES_THAT_MAY_NOT_POST[0]!) });

    expect(writes).toEqual(["state change"]);
    expect(timelines.inserts[0]!["subscriberNotificationStatus"]).toBe(
      StatusPageSubscriberNotificationStatus.Pending,
    );
    expect(feedTypes()).toEqual([
      ScheduledMaintenanceFeedEventType.ScheduledMaintenanceStateChanged,
    ]);
  });

  test.each([
    ["an empty note", ""],
    ["a note of spaces and line breaks", "  \n\t "],
    ["a note that is not text", 42],
  ])(
    "%s is no note: the change is saved and queued, and nothing is posted - even by someone who may not post notes",
    async (_label: string, note: unknown) => {
      await changeState({
        props: memberProps(ROLES_THAT_MAY_NOT_POST[0]!),
        note: note,
      });

      expect(writes).toEqual(["state change"]);
      expect(timelines.inserts[0]!["subscriberNotificationStatus"]).toBe(
        StatusPageSubscriberNotificationStatus.Pending,
      );
    },
  );

  test("a note that cannot be posted once the change is saved: the person who sent it is told, and the event's lock is not held", async () => {
    notes.repository.save.mockRejectedValueOnce(
      new Error("The note could not be saved."),
    );

    const error: unknown = await rejectionOf(
      changeState({ props: memberProps(MAY_POST), note: NOTE }),
    );

    expect((error as Error).message).toBe("The note could not be saved.");
    expect(timelines.inserts).toHaveLength(1);
    expect(release).toHaveBeenCalledTimes(1);
  });
});

describe("the note a change carries", () => {
  type Hook = (input: unknown) => Promise<unknown>;

  function onBeforeCreate(): Hook {
    return (
      ScheduledMaintenanceStateTimelineService as unknown as Record<
        string,
        Hook
      >
    )["onBeforeCreate"]!.bind(ScheduledMaintenanceStateTimelineService);
  }

  test("onBeforeCreate builds and checks the note, marks it with the state the event moves to, and posts nothing", async () => {
    const createNote: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      ScheduledMaintenancePublicNoteService,
      "create",
    );

    const result: { carryForward: Record<string, unknown> } =
      (await onBeforeCreate()({
        data: moveToOngoing({ notify: true }),
        miscDataProps: withNote(NOTE),
        props: memberProps(MAY_POST),
      })) as { carryForward: Record<string, unknown> };

    expect(createNote).not.toHaveBeenCalled();
    expect(notes.inserts).toEqual([]);

    const carried: ScheduledMaintenancePublicNote = result.carryForward[
      "publicNoteToPost"
    ] as ScheduledMaintenancePublicNote;

    expect(carried).toBeInstanceOf(ScheduledMaintenancePublicNote);
    expect(carried.note).toBe(NOTE);
    expect(carried.scheduledMaintenanceId?.toString()).toBe(
      EVENT_ID.toString(),
    );
    expect(carried.shouldStatusPageSubscribersBeNotifiedOnNoteCreated).toBe(
      true,
    );
    expect(StateChangePublicNote.getStatePostedWith(carried)?.toString()).toBe(
      ONGOING_STATE_ID.toString(),
    );
    // The text still travels with the change, as it always has.
    expect(result.carryForward["publicNote"]).toBe(NOTE);
  });

  test("a change without a note carries none", async () => {
    const result: { carryForward: Record<string, unknown> } =
      (await onBeforeCreate()({
        data: moveToOngoing({ notify: true }),
        miscDataProps: {},
        props: memberProps(MAY_POST),
      })) as { carryForward: Record<string, unknown> };

    expect(result.carryForward["publicNoteToPost"]).toBeUndefined();
    expect(result.carryForward["publicNote"]).toBeUndefined();
  });
});
