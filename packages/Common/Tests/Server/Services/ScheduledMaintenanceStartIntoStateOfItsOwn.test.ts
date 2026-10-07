import MonitorService from "../../../Server/Services/MonitorService";
import ScheduledMaintenanceFeedService from "../../../Server/Services/ScheduledMaintenanceFeedService";
import ScheduledMaintenanceMeasurementValueService from "../../../Server/Services/ScheduledMaintenanceMeasurementValueService";
import ScheduledMaintenanceService from "../../../Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateService from "../../../Server/Services/ScheduledMaintenanceStateService";
import ScheduledMaintenanceStateTimelineService from "../../../Server/Services/ScheduledMaintenanceStateTimelineService";
import WorkspaceNotificationRuleService from "../../../Server/Services/WorkspaceNotificationRuleService";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "../../../Models/DatabaseModels/ScheduledMaintenanceState";
import ScheduledMaintenanceStateTimeline from "../../../Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import URL from "../../../Types/API/URL";
import Dictionary from "../../../Types/Dictionary";
import ObjectID from "../../../Types/ObjectID";
import ScheduledMaintenanceStartUtil from "../../../Utils/ScheduledMaintenanceStart";
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
 * AN EVENT THAT STARTS STRAIGHT INTO A STATE OF THE PROJECT'S OWN AFTER
 * ONGOING STARTS AS IT WOULD IN ONGOING.
 *
 * A project can add its own states between the built-in ones - "Confirmed"
 * before Ongoing, "Verifying" between Ongoing and Ended, "Postmortem"
 * between Ended and Completed. An event in "Verifying" has started
 * (ScheduledMaintenanceStartUtil), so its Change Monitor Status to is
 * locked, and it is in progress, so it holds its monitors. Until now only
 * the move into the ongoing state itself paused the event's monitors and
 * changed them to its Change Monitor Status to: an event moved from
 * Scheduled straight into "Verifying" counted as started, yet its monitors
 * went on being probed - and alerting - in their own status, and the event
 * did not count as holding them, so another event's end released them.
 *
 * Now a move into a state of the project's own placed between Ongoing and
 * Ended, from a state where the event had not started, is the event's
 * start: it does what the move into Ongoing does. The replay that tells
 * whether an event holds its monitors agrees.
 *
 * The database is stubbed: the project's states (with their order), the
 * event as stored, and the writes the transition makes.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-0a0a-4ccc-8ddd-000000000001",
);
const EVENT_ID: ObjectID = new ObjectID("0193c0de-0a0a-4ccc-8ddd-0000000000e1");
const OTHER_EVENT_ID: string = "0193c0de-0a0a-4ccc-8ddd-0000000000e2";

const MAINTENANCE_STATUS: string = "0193c0de-0a0a-4ccc-8ddd-0000000000f1";

const MONITOR_A: string = "0193c0de-0a0a-4ccc-8ddd-0000000000a1";
const MONITOR_B: string = "0193c0de-0a0a-4ccc-8ddd-0000000000a2";

/*
 * The project's states, in their order: "confirmed" is its own state before
 * Ongoing, "verifying" one between Ongoing and Ended, "postmortem" one
 * between Ended and Completed.
 */
type StateKind =
  | "scheduled"
  | "confirmed"
  | "ongoing"
  | "verifying"
  | "ended"
  | "postmortem"
  | "completed";

const STATE_ORDER: Array<StateKind> = [
  "scheduled",
  "confirmed",
  "ongoing",
  "verifying",
  "ended",
  "postmortem",
  "completed",
];

function stateId(kind: StateKind): string {
  return `0193c0de-0a0a-4ccc-8ddd-0000000000d${STATE_ORDER.indexOf(kind) + 1}`;
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

// The event as the transition reads it, at the moment the row is made.
function storedEvent(): ScheduledMaintenance {
  const scheduledMaintenance: ScheduledMaintenance = new ScheduledMaintenance();
  scheduledMaintenance._id = EVENT_ID.toString();
  scheduledMaintenance.projectId = PROJECT_ID;
  scheduledMaintenance.changeMonitorStatusToId = new ObjectID(
    MAINTENANCE_STATUS,
  );
  scheduledMaintenance.monitors = [MONITOR_A, MONITOR_B].map(
    (id: string): Monitor => {
      return new Monitor(new ObjectID(id));
    },
  );
  scheduledMaintenance.networkSites = [];
  return scheduledMaintenance;
}

type OnCreateSuccessFunction = (
  onCreate: OnCreate<ScheduledMaintenanceStateTimeline>,
  createdItem: ScheduledMaintenanceStateTimeline,
) => Promise<ScheduledMaintenanceStateTimeline>;

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
  row._id = "0193c0de-0a0a-4ccc-8ddd-0000000000c1";
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
    rowBefore._id = "0193c0de-0a0a-4ccc-8ddd-0000000000c0";
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

let statesRead: MockFunction;
let monitorUpdateOneById: MockFunction;
let changeMonitorStatus: MockFunction;
let releaseMonitors: MockFunction;
let timeline: Array<ScheduledMaintenanceStateTimeline> = [];

beforeEach(() => {
  timeline = [];

  /*
   * The state a row moves into, read by id - and asked again with a flag
   * ({ isOngoingState: true }) to tell which kind it is.
   */
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

  statesRead = getJestMockFunction();
  statesRead.mockResolvedValue(PROJECT_STATES as never);
  jest
    .spyOn(ScheduledMaintenanceStateService, "getAllScheduledMaintenanceStates")
    .mockImplementation(statesRead as never);

  jest
    .spyOn(ScheduledMaintenanceService, "findOneBy")
    .mockImplementation((async (): Promise<ScheduledMaintenance> => {
      return storedEvent();
    }) as never);
  jest
    .spyOn(ScheduledMaintenanceService, "updateOneBy")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(ScheduledMaintenanceService, "updateOneById")
    .mockResolvedValue(undefined as never);
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
  jest
    .spyOn(
      ScheduledMaintenanceFeedService,
      "createScheduledMaintenanceFeedItem",
    )
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(
      ScheduledMaintenanceMeasurementValueService,
      "recomputeForScheduledMaintenance",
    )
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(WorkspaceNotificationRuleService, "archiveWorkspaceChannels")
    .mockResolvedValue(undefined as never);

  releaseMonitors = getJestMockFunction();
  releaseMonitors.mockResolvedValue(undefined as never);
  jest
    .spyOn(
      ScheduledMaintenanceStateTimelineService,
      "enableActiveMonitoringForMonitors",
    )
    .mockImplementation(releaseMonitors as never);

  // The row before this one is closed at this one's start.
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

  monitorUpdateOneById = getJestMockFunction();
  monitorUpdateOneById.mockResolvedValue(undefined as never);
  jest
    .spyOn(MonitorService, "updateOneById")
    .mockImplementation(monitorUpdateOneById as never);

  changeMonitorStatus = getJestMockFunction();
  changeMonitorStatus.mockResolvedValue(undefined as never);
  jest
    .spyOn(MonitorService, "changeMonitorStatus")
    .mockImplementation(changeMonitorStatus as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// The monitors whose probing the transition stopped.
function pausedMonitors(): Array<string> {
  return monitorUpdateOneById.mock.calls
    .filter((call: Array<unknown>): boolean => {
      return (
        (call[0] as { data: Dictionary<unknown> }).data[
          "disableActiveMonitoringBecauseOfScheduledMaintenanceEvent"
        ] === true
      );
    })
    .map((call: Array<unknown>): string => {
      return String((call[0] as { id: ObjectID }).id);
    })
    .sort();
}

function expectStarted(): void {
  expect(pausedMonitors()).toEqual([MONITOR_A, MONITOR_B].sort());
  expect(changeMonitorStatus).toHaveBeenCalledTimes(1);
  expect(String(changeMonitorStatus.mock.calls[0]![2])).toBe(
    MAINTENANCE_STATUS,
  );
}

function expectNothingStarted(): void {
  expect(pausedMonitors()).toEqual([]);
  expect(changeMonitorStatus).not.toHaveBeenCalled();
}

describe("the move into a state of the project's own placed after Ongoing", () => {
  test("straight from Scheduled, is the start: probing stops and the monitors change to the event's status", async () => {
    await move({ from: "scheduled", into: "verifying" });

    expectStarted();
  });

  test("the probing stops before the status changes, as at the start in Ongoing", async () => {
    await move({ from: "scheduled", into: "verifying" });

    expect(
      Math.max(...monitorUpdateOneById.mock.invocationCallOrder),
    ).toBeLessThan(changeMonitorStatus.mock.invocationCallOrder[0]!);
  });

  test("from a state of the project's own before Ongoing, is the start too", async () => {
    await move({ from: "confirmed", into: "verifying" });

    expectStarted();
  });

  test("as the event's first state, is its start", async () => {
    await move({ from: null, into: "verifying" });

    expectStarted();
  });

  test("from Ongoing, starts nothing again: the event holds its monitors already", async () => {
    await move({ from: "ongoing", into: "verifying" });

    expectNothingStarted();
  });

  test("filled in between two others, back in the timeline, starts nothing", async () => {
    await move({ from: "scheduled", into: "verifying", filledInBetween: true });

    expectNothingStarted();
  });

  test("reads the project's states once, as root", async () => {
    await move({ from: "scheduled", into: "verifying" });

    expect(statesRead).toHaveBeenCalledTimes(1);
    expect(statesRead.mock.calls[0]![0]).toEqual({
      projectId: PROJECT_ID,
      props: { isRoot: true },
    });
  });
});

describe("the moves that start nothing", () => {
  test.each([
    ["a state of the project's own before Ongoing", "scheduled", "confirmed"],
    [
      "a state of the project's own after Ended, straight from Scheduled",
      "scheduled",
      "postmortem",
    ],
    ["a state of the project's own after Ended", "ended", "postmortem"],
  ] as Array<[string, StateKind, StateKind]>)(
    "into %s",
    async (_name: string, from: StateKind, into: StateKind) => {
      await move({ from: from, into: into });

      expectNothingStarted();
    },
  );

  test.each([
    ["Scheduled", "scheduled"],
    ["Ended", "ended"],
    ["Completed", "completed"],
  ] as Array<[string, StateKind]>)(
    "into %s: the project's states are not read",
    async (_name: string, into: StateKind) => {
      await move({ from: null, into: into });

      expect(statesRead).not.toHaveBeenCalled();
      expect(changeMonitorStatus).not.toHaveBeenCalled();
    },
  );

  test("into Ongoing itself, as before: the start, with no read of the project's states", async () => {
    await move({ from: "scheduled", into: "ongoing" });

    expectStarted();
    expect(statesRead).not.toHaveBeenCalled();
  });
});

describe("an event that started straight into such a state", () => {
  function timelineOf(
    kinds: Array<StateKind>,
    eventId: ObjectID = EVENT_ID,
  ): Array<ScheduledMaintenanceStateTimeline> {
    return kinds.map((kind: StateKind): ScheduledMaintenanceStateTimeline => {
      const item: ScheduledMaintenanceStateTimeline =
        new ScheduledMaintenanceStateTimeline();
      item.scheduledMaintenanceId = eventId;
      // As the replay reads it: the state's kind, without its place.
      item.scheduledMaintenanceState = state(kind);
      return item;
    });
  }

  async function isHolding(current: StateKind): Promise<boolean> {
    return await ScheduledMaintenanceStateTimelineService.isScheduledMaintenanceHoldingMonitors(
      {
        scheduledMaintenanceId: EVENT_ID,
        projectId: PROJECT_ID,
        currentState: state(current),
      },
    );
  }

  test.each([
    ["Scheduled, then Verifying", ["scheduled", "verifying"], true],
    ["Confirmed, then Verifying", ["scheduled", "confirmed", "verifying"], true],
    ["Ongoing, then Verifying, as before", ["scheduled", "ongoing", "verifying"], true],
    ["only Confirmed, not yet started", ["scheduled", "confirmed"], false],
    [
      "Verifying, then Ended, then Postmortem: let go at Ended",
      ["scheduled", "verifying", "ended", "postmortem"],
      false,
    ],
    ["straight into Postmortem: never held", ["scheduled", "postmortem"], false],
  ] as Array<[string, Array<StateKind>, boolean]>)(
    "holds its monitors after %s: %s",
    async (_name: string, kinds: Array<StateKind>, holding: boolean) => {
      timeline = timelineOf(kinds);

      expect(await isHolding(kinds[kinds.length - 1]!)).toBe(holding);
    },
  );

  test("the replay reads the project's states only when a state of its own needs placing", async () => {
    timeline = timelineOf(["scheduled", "ongoing", "verifying"]);

    expect(await isHolding("verifying")).toBe(true);
    // Held since Ongoing: "Verifying" needed no place.
    expect(statesRead).not.toHaveBeenCalled();

    timeline = timelineOf(["scheduled", "verifying"]);

    expect(await isHolding("verifying")).toBe(true);
    expect(statesRead).toHaveBeenCalledTimes(1);
  });

  test("keeps a monitor another event lets go of in maintenance", async () => {
    timeline = timelineOf(
      ["scheduled", "verifying"],
      new ObjectID(OTHER_EVENT_ID),
    );

    const otherEvent: ScheduledMaintenance = new ScheduledMaintenance();
    otherEvent._id = OTHER_EVENT_ID;
    otherEvent.projectId = PROJECT_ID;
    otherEvent.currentScheduledMaintenanceState = state("verifying");

    jest
      .spyOn(ScheduledMaintenanceService, "findBy")
      .mockResolvedValue([otherEvent] as never);

    expect(
      await ScheduledMaintenanceStateTimelineService.isMonitorHeldInMaintenanceByAnyEvent(
        new ObjectID(MONITOR_A),
      ),
    ).toBe(true);
  });

  test("lets go of its monitors when it ends, as any event does", async () => {
    await move({ from: "verifying", into: "ended" });

    expect(releaseMonitors).toHaveBeenCalledTimes(1);
    expect(changeMonitorStatus).not.toHaveBeenCalled();
  });
});

describe("ScheduledMaintenanceStartUtil.isInProgress", () => {
  test.each([
    ["scheduled", false],
    ["confirmed", false],
    ["ongoing", true],
    ["verifying", true],
    ["ended", false],
    ["postmortem", false],
    ["completed", false],
  ] as Array<[StateKind, boolean]>)(
    "%s: %s",
    (kind: StateKind, inProgress: boolean) => {
      expect(
        ScheduledMaintenanceStartUtil.isInProgress({
          states: PROJECT_STATES,
          state: state(kind),
        }),
      ).toBe(inProgress);
    },
  );
});
