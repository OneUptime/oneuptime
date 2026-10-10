import MonitorService from "../../../Server/Services/MonitorService";
import NetworkSiteService from "../../../Server/Services/NetworkSiteService";
import ScheduledMaintenanceFeedService from "../../../Server/Services/ScheduledMaintenanceFeedService";
import ScheduledMaintenanceMeasurementValueService from "../../../Server/Services/ScheduledMaintenanceMeasurementValueService";
import ScheduledMaintenanceService from "../../../Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateService from "../../../Server/Services/ScheduledMaintenanceStateService";
import ScheduledMaintenanceStateTimelineService from "../../../Server/Services/ScheduledMaintenanceStateTimelineService";
import WorkspaceNotificationRuleService from "../../../Server/Services/WorkspaceNotificationRuleService";
import { OnCreate, OnDelete } from "../../../Server/Types/Database/Hooks";
import NetworkSite from "../../../Models/DatabaseModels/NetworkSite";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "../../../Models/DatabaseModels/ScheduledMaintenanceState";
import ScheduledMaintenanceStateTimeline from "../../../Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import URL from "../../../Types/API/URL";
import Dictionary from "../../../Types/Dictionary";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A SCHEDULED MAINTENANCE STATE CHANGE DOES WHAT THE STATE'S PLACE SAYS.
 *
 * A project can add states of its own between the built-in ones: "Draft"
 * before Scheduled, "Confirmed" between Scheduled and Ongoing, "Verifying"
 * between Ongoing and Ended, "Reviewing" between Ended and Completed,
 * "Archived" after Completed. Where an event is in its life - waiting to
 * start, in progress, over, complete - is the one rule
 * (Common/Utils/ScheduledMaintenanceStart), and a state change follows it:
 *
 *   - the network sites the event covers are re-rolled on every change of
 *     its state, at once - also when it moves back, as it does when the
 *     entry of the state it is in is deleted from its timeline. Moved back
 *     from "Verifying" to Scheduled, an event kept silencing its sites until
 *     the five-minute sweep reached them;
 *   - subscribers told before the event starts still are after a move into
 *     "Confirmed": the event has not started there. Any move out of
 *     Scheduled used to drop those notifications;
 *   - the feed line's mark reads the place too: "Confirmed" has not started
 *     (🕒) and "Archived" is complete (✅) - they read as ➡️ before.
 *
 * The database is stubbed: the project's states (with their order), the
 * event as stored, and the writes the change makes.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-0b0b-4ccc-8ddd-000000000001",
);
const EVENT_ID: ObjectID = new ObjectID("0193c0de-0b0b-4ccc-8ddd-0000000000e1");
const SITE_A: string = "0193c0de-0b0b-4ccc-8ddd-0000000000a1";
const NEXT_REMINDER_AT: Date = new Date("2026-11-02T08:00:00.000Z");

type StateKind =
  | "draft"
  | "scheduled"
  | "confirmed"
  | "ongoing"
  | "verifying"
  | "ended"
  | "reviewing"
  | "completed"
  | "archived";

const STATE_ORDER: Array<StateKind> = [
  "draft",
  "scheduled",
  "confirmed",
  "ongoing",
  "verifying",
  "ended",
  "reviewing",
  "completed",
  "archived",
];

function stateId(kind: StateKind): string {
  return `0193c0de-0b0b-4ccc-8ddd-0000000000d${STATE_ORDER.indexOf(kind) + 1}`;
}

function kindOf(id: unknown): StateKind {
  return STATE_ORDER.find((kind: StateKind): boolean => {
    return stateId(kind) === String(id).toLowerCase();
  })!;
}

// A state as a read with every flag (and, `withOrder`, its place) answers it.
function state(
  kind: StateKind,
  options: { withOrder?: boolean } = {},
): ScheduledMaintenanceState {
  const projectState: ScheduledMaintenanceState =
    new ScheduledMaintenanceState();
  projectState._id = stateId(kind);
  projectState.name = kind;
  projectState.isScheduledState = kind === "scheduled";
  projectState.isOngoingState = kind === "ongoing";
  projectState.isEndedState = kind === "ended";
  projectState.isResolvedState = kind === "completed";

  if (options.withOrder) {
    projectState.order = STATE_ORDER.indexOf(kind) + 1;
  }

  return projectState;
}

const PROJECT_STATES: Array<ScheduledMaintenanceState> = STATE_ORDER.map(
  (kind: StateKind): ScheduledMaintenanceState => {
    return state(kind, { withOrder: true });
  },
);

// The event as the change reads it: covering a network site, nothing else.
let eventHasSites: boolean = true;
let eventCurrentState: StateKind = "scheduled";

function storedEvent(): ScheduledMaintenance {
  const scheduledMaintenance: ScheduledMaintenance = new ScheduledMaintenance();
  scheduledMaintenance._id = EVENT_ID.toString();
  scheduledMaintenance.projectId = PROJECT_ID;
  scheduledMaintenance.monitors = [];
  scheduledMaintenance.networkSites = eventHasSites
    ? [new NetworkSite(new ObjectID(SITE_A))]
    : [];
  scheduledMaintenance.currentScheduledMaintenanceStateId = new ObjectID(
    stateId(eventCurrentState),
  );
  scheduledMaintenance.nextSubscriberNotificationBeforeTheEventAt =
    NEXT_REMINDER_AT;
  return scheduledMaintenance;
}

type OnCreateSuccessFunction = (
  onCreate: OnCreate<ScheduledMaintenanceStateTimeline>,
  createdItem: ScheduledMaintenanceStateTimeline,
) => Promise<ScheduledMaintenanceStateTimeline>;

type OnDeleteSuccessFunction = (
  onDelete: OnDelete<ScheduledMaintenanceStateTimeline>,
  itemIdsBeforeDelete: Array<ObjectID>,
) => Promise<OnDelete<ScheduledMaintenanceStateTimeline>>;

/*
 * A state timeline row moving the event from `from` (null: its first row)
 * into `into`. `filledInBetween` is a row slipped in between two others,
 * back in the timeline: it has an end, the start of the row after.
 */
async function move(data: {
  from: StateKind | null;
  into: StateKind;
  filledInBetween?: boolean;
}): Promise<void> {
  const row: ScheduledMaintenanceStateTimeline =
    new ScheduledMaintenanceStateTimeline();
  row._id = "0193c0de-0b0b-4ccc-8ddd-0000000000c1";
  row.projectId = PROJECT_ID;
  row.scheduledMaintenanceId = EVENT_ID;
  row.scheduledMaintenanceStateId = new ObjectID(stateId(data.into));
  row.startsAt = new Date("2026-11-02T09:00:00.000Z");

  if (data.filledInBetween) {
    row.endsAt = new Date("2026-11-02T10:00:00.000Z");
  }

  let rowBefore: ScheduledMaintenanceStateTimeline | null = null;

  if (data.from) {
    rowBefore = new ScheduledMaintenanceStateTimeline();
    rowBefore._id = "0193c0de-0b0b-4ccc-8ddd-0000000000c0";
    rowBefore.scheduledMaintenanceStateId = new ObjectID(stateId(data.from));
  }

  await (
    ScheduledMaintenanceStateTimelineService as unknown as {
      onCreateSuccess: OnCreateSuccessFunction;
    }
  ).onCreateSuccess(
    {
      createBy: {
        data: row,
        props: { isRoot: true },
      },
      carryForward: {
        statusTimelineBeforeThisStatus: rowBefore,
        statusTimelineAfterThisStatus: null,
        publicNote: undefined,
        mutex: null,
      },
    },
    row,
  );
}

/*
 * An entry of the event's timeline deleted, leaving `latest` its last entry
 * - the state the event is in from now on.
 */
async function deleteEntryLeaving(latest: StateKind): Promise<void> {
  latestRowState = latest;

  await (
    ScheduledMaintenanceStateTimelineService as unknown as {
      onDeleteSuccess: OnDeleteSuccessFunction;
    }
  ).onDeleteSuccess(
    {
      deleteBy: {
        query: {},
        props: { isRoot: true },
      },
      carryForward: EVENT_ID,
    } as unknown as OnDelete<ScheduledMaintenanceStateTimeline>,
    [],
  );
}

let timeline: Array<ScheduledMaintenanceStateTimeline> = [];
let latestRowState: StateKind = "scheduled";
let rerollSites: MockFunction;
let eventUpdateOneById: MockFunction;
let eventUpdateOneBy: MockFunction;
let createFeedItem: MockFunction;

beforeEach(() => {
  timeline = [];
  eventHasSites = true;
  eventCurrentState = "scheduled";
  latestRowState = "scheduled";

  // The state a row moves into, read by id - and asked again with a flag.
  jest
    .spyOn(ScheduledMaintenanceStateService, "findOneBy")
    .mockImplementation((async (findOneBy: {
      query: Dictionary<unknown>;
    }): Promise<ScheduledMaintenanceState | null> => {
      const found: ScheduledMaintenanceState = state(
        kindOf(findOneBy.query["_id"]),
      );

      for (const flag of [
        "isOngoingState",
        "isEndedState",
        "isResolvedState",
        "isScheduledState",
      ]) {
        if (
          findOneBy.query[flag] !== undefined &&
          Boolean((found as unknown as Dictionary<unknown>)[flag]) !==
            findOneBy.query[flag]
        ) {
          return null;
        }
      }

      return found;
    }) as never);

  // For whether this is the project's last state.
  jest
    .spyOn(ScheduledMaintenanceStateService, "findBy")
    .mockResolvedValue(PROJECT_STATES as never);
  jest
    .spyOn(ScheduledMaintenanceStateService, "getAllScheduledMaintenanceStates")
    .mockResolvedValue(PROJECT_STATES as never);

  jest
    .spyOn(ScheduledMaintenanceService, "findOneBy")
    .mockImplementation((async (): Promise<ScheduledMaintenance> => {
      return storedEvent();
    }) as never);

  eventUpdateOneBy = getJestMockFunction();
  eventUpdateOneBy.mockResolvedValue(undefined as never);
  jest
    .spyOn(ScheduledMaintenanceService, "updateOneBy")
    .mockImplementation(eventUpdateOneBy as never);

  eventUpdateOneById = getJestMockFunction();
  eventUpdateOneById.mockResolvedValue(undefined as never);
  jest
    .spyOn(ScheduledMaintenanceService, "updateOneById")
    .mockImplementation(eventUpdateOneById as never);

  jest
    .spyOn(ScheduledMaintenanceService, "getScheduledMaintenanceNumber")
    .mockResolvedValue({ number: 7, numberWithPrefix: "#7" } as never);
  jest
    .spyOn(
      ScheduledMaintenanceService,
      "getScheduledMaintenanceLinkInDashboard",
    )
    .mockResolvedValue(
      URL.fromString("https://oneuptime.example/dashboard/sm/7") as never,
    );

  createFeedItem = getJestMockFunction();
  createFeedItem.mockResolvedValue(undefined as never);
  jest
    .spyOn(
      ScheduledMaintenanceFeedService,
      "createScheduledMaintenanceFeedItem",
    )
    .mockImplementation(createFeedItem as never);

  jest
    .spyOn(
      ScheduledMaintenanceMeasurementValueService,
      "recomputeForScheduledMaintenance",
    )
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(WorkspaceNotificationRuleService, "archiveWorkspaceChannels")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(
      ScheduledMaintenanceStateTimelineService,
      "enableActiveMonitoringForMonitors",
    )
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(ScheduledMaintenanceStateTimelineService, "updateOneById")
    .mockResolvedValue(undefined as never);

  // The event's timeline, oldest first, as the holding replay reads it.
  jest
    .spyOn(ScheduledMaintenanceStateTimelineService, "findBy")
    .mockImplementation((async (): Promise<
      Array<ScheduledMaintenanceStateTimeline>
    > => {
      return timeline;
    }) as never);

  // The event's last entry, once one is deleted.
  jest
    .spyOn(ScheduledMaintenanceStateTimelineService, "findOneBy")
    .mockImplementation((async (): Promise<ScheduledMaintenanceStateTimeline> => {
      const row: ScheduledMaintenanceStateTimeline =
        new ScheduledMaintenanceStateTimeline();
      row._id = "0193c0de-0b0b-4ccc-8ddd-0000000000c9";
      row.scheduledMaintenanceStateId = new ObjectID(stateId(latestRowState));
      return row;
    }) as never);

  jest.spyOn(MonitorService, "updateOneById").mockResolvedValue(undefined as never);
  jest
    .spyOn(MonitorService, "changeMonitorStatus")
    .mockResolvedValue(undefined as never);

  rerollSites = getJestMockFunction();
  rerollSites.mockResolvedValue(undefined as never);
  jest
    .spyOn(NetworkSiteService, "recomputeRollupsAfterMaintenanceChange")
    .mockImplementation(rerollSites as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// The timeline before the move, as the holding replay reads it.
function timelineOf(kinds: Array<StateKind>): void {
  timeline = kinds.map((kind: StateKind): ScheduledMaintenanceStateTimeline => {
    const item: ScheduledMaintenanceStateTimeline =
      new ScheduledMaintenanceStateTimeline();
    item.scheduledMaintenanceId = EVENT_ID;
    item.scheduledMaintenanceStateId = new ObjectID(stateId(kind));
    item.scheduledMaintenanceState = state(kind);
    return item;
  });
}

// The sites each re-roll was asked for.
function sitesRerolled(): Array<Array<string>> {
  return rerollSites.mock.calls.map((call: Array<unknown>): Array<string> => {
    const request: { projectId: ObjectID; siteIds: Array<ObjectID> } =
      call[0] as { projectId: ObjectID; siteIds: Array<ObjectID> };

    expect(request.projectId.toString()).toBe(PROJECT_ID.toString());

    return request.siteIds.map((id: ObjectID): string => {
      return id.toString();
    });
  });
}

describe("the network sites the event covers are re-rolled on every change of its state", () => {
  test.each([
    ["the start into Ongoing", ["scheduled"], "scheduled", "ongoing"],
    [
      "the move on from Scheduled to Confirmed",
      ["scheduled"],
      "scheduled",
      "confirmed",
    ],
    [
      "the move on from Ongoing to Verifying",
      ["scheduled", "ongoing"],
      "ongoing",
      "verifying",
    ],
    ["the end into Ended", ["scheduled", "ongoing"], "ongoing", "ended"],
    [
      "the move on from Ended to Reviewing",
      ["scheduled", "ongoing", "ended"],
      "ended",
      "reviewing",
    ],
    [
      "the move on from Completed to Archived",
      ["scheduled", "ongoing", "ended", "completed"],
      "completed",
      "archived",
    ],
  ] as Array<[string, Array<StateKind>, StateKind, StateKind]>)(
    "%s re-rolls them at once",
    async (
      _name: string,
      kinds: Array<StateKind>,
      from: StateKind,
      into: StateKind,
    ) => {
      timelineOf(kinds);

      await move({ from: from, into: into });

      expect(sitesRerolled()).toEqual([[SITE_A]]);
    },
  );

  test("a row filled in between two others, back in the timeline, changes no state the sites read", async () => {
    timelineOf(["scheduled", "ongoing"]);

    await move({ from: "scheduled", into: "confirmed", filledInBetween: true });

    expect(rerollSites).not.toHaveBeenCalled();
  });

  test("an event covering no network site re-rolls nothing", async () => {
    eventHasSites = false;
    timelineOf(["scheduled"]);

    await move({ from: "scheduled", into: "confirmed" });

    expect(rerollSites).not.toHaveBeenCalled();
  });
});

describe("a move back: the entry of the state the event is in deleted from its timeline", () => {
  test("moved back from Verifying to Scheduled, the sites are re-rolled at once - it silences them no longer", async () => {
    eventCurrentState = "verifying";

    await deleteEntryLeaving("scheduled");

    expect(sitesRerolled()).toEqual([[SITE_A]]);
  });

  test("moved back from Ended to Verifying, they are re-rolled too: in both directions", async () => {
    eventCurrentState = "ended";

    await deleteEntryLeaving("verifying");

    expect(sitesRerolled()).toEqual([[SITE_A]]);
  });

  test("the sites are re-rolled after the event's state is written back, so they read the state it is in now", async () => {
    eventCurrentState = "verifying";

    await deleteEntryLeaving("scheduled");

    expect(eventUpdateOneBy).toHaveBeenCalledTimes(1);

    const write: { data: Dictionary<unknown> } = eventUpdateOneBy.mock
      .calls[0]![0] as { data: Dictionary<unknown> };

    expect(String(write.data["currentScheduledMaintenanceStateId"])).toBe(
      stateId("scheduled"),
    );
    expect(eventUpdateOneBy.mock.invocationCallOrder[0]!).toBeLessThan(
      rerollSites.mock.invocationCallOrder[0]!,
    );
  });

  test("deleting an entry further back leaves the event where it is: nothing to re-roll", async () => {
    eventCurrentState = "verifying";

    await deleteEntryLeaving("verifying");

    expect(rerollSites).not.toHaveBeenCalled();
  });

  test("an event covering no network site re-rolls nothing", async () => {
    eventHasSites = false;
    eventCurrentState = "verifying";

    await deleteEntryLeaving("scheduled");

    expect(rerollSites).not.toHaveBeenCalled();
  });
});

describe("subscribers told before the event starts", () => {
  // Whether the move dropped the notifications planned before the event.
  function droppedTheNotificationsBefore(): boolean {
    return eventUpdateOneById.mock.calls.some(
      (call: Array<unknown>): boolean => {
        const data: Dictionary<unknown> = (call[0] as { data: Dictionary<unknown> })
          .data;

        return (
          Object.prototype.hasOwnProperty.call(
            data,
            "nextSubscriberNotificationBeforeTheEventAt",
          ) && data["nextSubscriberNotificationBeforeTheEventAt"] === null
        );
      },
    );
  }

  test.each([
    ["Confirmed, after Scheduled and before Ongoing", "scheduled", "confirmed"],
    ["Scheduled, out of a draft", "draft", "scheduled"],
  ] as Array<[string, StateKind, StateKind]>)(
    "are still told after a move into %s: the event has not started",
    async (_name: string, from: StateKind, into: StateKind) => {
      timelineOf([from]);

      await move({ from: from, into: into });

      expect(droppedTheNotificationsBefore()).toBe(false);
    },
  );

  test.each([
    ["Ongoing", ["scheduled"], "scheduled", "ongoing"],
    ["Verifying, started straight into", ["confirmed"], "confirmed", "verifying"],
    ["Ended, over without having run", ["scheduled"], "scheduled", "ended"],
    [
      "Archived, complete without having run",
      ["confirmed"],
      "confirmed",
      "archived",
    ],
  ] as Array<[string, Array<StateKind>, StateKind, StateKind]>)(
    "are no longer told once it moves into %s",
    async (
      _name: string,
      kinds: Array<StateKind>,
      from: StateKind,
      into: StateKind,
    ) => {
      timelineOf(kinds);

      await move({ from: from, into: into });

      expect(droppedTheNotificationsBefore()).toBe(true);
    },
  );
});

describe("the mark a state change's feed line starts with", () => {
  async function emojiOfTheMove(
    from: StateKind | null,
    into: StateKind,
  ): Promise<string> {
    await move({ from: from, into: into });

    const feedInfo: string = String(
      (createFeedItem.mock.calls[0]![0] as { feedInfoInMarkdown: string })
        .feedInfoInMarkdown,
    );

    return feedInfo.split(" ")[0]!;
  }

  test.each([
    ["Draft, placed before Scheduled", "🕒", null, "draft"],
    ["Scheduled", "🕒", "draft", "scheduled"],
    ["Confirmed, not started yet", "🕒", "scheduled", "confirmed"],
    ["Ongoing", "⏳", "confirmed", "ongoing"],
    ["Verifying, in progress too", "⏳", "ongoing", "verifying"],
    ["Ended", "➡️", "verifying", "ended"],
    ["Reviewing, over but not complete", "➡️", "ended", "reviewing"],
    ["Completed", "✅", "reviewing", "completed"],
    ["Archived, complete too", "✅", "completed", "archived"],
    ["Archived, straight from Ended", "✅", "ended", "archived"],
  ] as Array<[string, string, StateKind | null, StateKind]>)(
    "a move into %s starts with %s",
    async (
      _name: string,
      emoji: string,
      from: StateKind | null,
      into: StateKind,
    ) => {
      timelineOf(from ? [from] : []);

      expect(await emojiOfTheMove(from, into)).toBe(emoji);
    },
  );
});
