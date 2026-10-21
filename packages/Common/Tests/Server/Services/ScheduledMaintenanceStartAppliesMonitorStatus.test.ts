import MonitorService from "../../../Server/Services/MonitorService";
import ScheduledMaintenanceFeedService from "../../../Server/Services/ScheduledMaintenanceFeedService";
import ScheduledMaintenanceMeasurementValueService from "../../../Server/Services/ScheduledMaintenanceMeasurementValueService";
import ScheduledMaintenanceService from "../../../Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateService from "../../../Server/Services/ScheduledMaintenanceStateService";
import ScheduledMaintenanceStateTimelineService from "../../../Server/Services/ScheduledMaintenanceStateTimelineService";
import WorkspaceNotificationRuleService from "../../../Server/Services/WorkspaceNotificationRuleService";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import logger from "../../../Server/Utils/Logger";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "../../../Models/DatabaseModels/ScheduledMaintenanceState";
import ScheduledMaintenanceStateTimeline from "../../../Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import URL from "../../../Types/API/URL";
import Dictionary from "../../../Types/Dictionary";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * WHEN A SCHEDULED MAINTENANCE EVENT STARTS, ITS MONITORS CHANGE TO ITS
 * CHANGE MONITOR STATUS TO - THE ONE IT HOLDS AT THAT MOMENT.
 *
 * An event's status can be changed until the event starts, so the start has
 * to read it then. Every start is the move into the event's ongoing state:
 * a new state timeline row, whose onCreateSuccess now applies the status it
 * reads from the event as stored. That covers the ChangeStateToOngoing job
 * at the event's start time, Mark as Ongoing, the Slack and Microsoft Teams
 * actions, and a state change through the API, Terraform or a workflow.
 *
 * Before, only the job applied the status - one it had read up to a minute
 * earlier, in its own list query - and a start by hand applied none at all.
 *
 * The database is stubbed: the state the row moves into, the event as
 * stored, and the writes the transition makes.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-7a7a-4ccc-8ddd-000000000001",
);
const EVENT_ID: ObjectID = new ObjectID("0193c0de-7a7a-4ccc-8ddd-0000000000e1");

const SCHEDULED_STATE_ID: string = "0193c0de-7a7a-4ccc-8ddd-0000000000d1";
const ONGOING_STATE_ID: string = "0193c0de-7a7a-4ccc-8ddd-0000000000d2";
const ENDED_STATE_ID: string = "0193c0de-7a7a-4ccc-8ddd-0000000000d3";
const VERIFYING_STATE_ID: string = "0193c0de-7a7a-4ccc-8ddd-0000000000d4";

const STATUS_PICKED_WHEN_SCHEDULED: string =
  "0193c0de-7a7a-4ccc-8ddd-0000000000f1";
const STATUS_CHANGED_BEFORE_THE_START: string =
  "0193c0de-7a7a-4ccc-8ddd-0000000000f2";

const MONITOR_A: string = "0193c0de-7a7a-4ccc-8ddd-0000000000a1";
const MONITOR_B: string = "0193c0de-7a7a-4ccc-8ddd-0000000000a2";

type StateKind = "scheduled" | "ongoing" | "ended" | "verifying";

const STATE_IDS: Dictionary<string> = {
  scheduled: SCHEDULED_STATE_ID,
  ongoing: ONGOING_STATE_ID,
  ended: ENDED_STATE_ID,
  verifying: VERIFYING_STATE_ID,
};

function state(kind: StateKind): ScheduledMaintenanceState {
  const scheduledMaintenanceState: ScheduledMaintenanceState =
    new ScheduledMaintenanceState();
  scheduledMaintenanceState._id = STATE_IDS[kind]!;
  scheduledMaintenanceState.name = kind;
  scheduledMaintenanceState.isScheduledState = kind === "scheduled";
  scheduledMaintenanceState.isOngoingState = kind === "ongoing";
  scheduledMaintenanceState.isEndedState = kind === "ended";
  scheduledMaintenanceState.isResolvedState = false;
  return scheduledMaintenanceState;
}

function kindOf(stateId: string): StateKind {
  return (Object.keys(STATE_IDS) as Array<StateKind>).find(
    (kind: StateKind): boolean => {
      return STATE_IDS[kind] === stateId;
    },
  )!;
}

// The event as the transition reads it, at the moment the row is made.
let storedEvent: ScheduledMaintenance | null = null;

function storeEvent(data: {
  monitorStatusId?: string;
  monitors?: Array<string>;
}): void {
  const scheduledMaintenance: ScheduledMaintenance = new ScheduledMaintenance();
  scheduledMaintenance._id = EVENT_ID.toString();
  scheduledMaintenance.projectId = PROJECT_ID;

  if (data.monitorStatusId) {
    scheduledMaintenance.changeMonitorStatusToId = new ObjectID(
      data.monitorStatusId,
    );
  }

  scheduledMaintenance.monitors = (data.monitors || []).map(
    (id: string): Monitor => {
      return new Monitor(new ObjectID(id));
    },
  );
  scheduledMaintenance.networkSites = [];

  storedEvent = scheduledMaintenance;
}

type OnCreateSuccessFunction = (
  onCreate: OnCreate<ScheduledMaintenanceStateTimeline>,
  createdItem: ScheduledMaintenanceStateTimeline,
) => Promise<ScheduledMaintenanceStateTimeline>;

/*
 * A state timeline row moving the event into `kind`, made as
 * ScheduledMaintenanceService.changeScheduledMaintenanceState and Mark as
 * Ongoing make it. `filledInBetween` is a row slipped in between two
 * others, back in the timeline: it has an end, the start of the row after.
 */
async function moveInto(
  kind: StateKind,
  options: { filledInBetween?: boolean } = {},
): Promise<void> {
  const row: ScheduledMaintenanceStateTimeline =
    new ScheduledMaintenanceStateTimeline();
  row._id = "0193c0de-7a7a-4ccc-8ddd-0000000000c1";
  row.projectId = PROJECT_ID;
  row.scheduledMaintenanceId = EVENT_ID;
  row.scheduledMaintenanceStateId = new ObjectID(STATE_IDS[kind]!);
  row.startsAt = new Date("2026-10-07T10:00:00.000Z");

  if (options.filledInBetween) {
    row.endsAt = new Date("2026-10-07T11:00:00.000Z");
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
        statusTimelineBeforeThisStatus: null,
        statusTimelineAfterThisStatus: null,
        publicNote: undefined,
        mutex: null,
      },
    },
    row,
  );
}

let changeMonitorStatus: jest.SpyInstance;
let monitorUpdateOneById: jest.SpyInstance;
let eventRead: jest.SpyInstance;

beforeEach(() => {
  storedEvent = null;

  /*
   * The state a row moves into, read by id - and asked again with a flag
   * ({ isOngoingState: true }) to tell which kind it is.
   */
  jest
    .spyOn(ScheduledMaintenanceStateService, "findOneBy")
    .mockImplementation((async (findOneBy: {
      query: Dictionary<unknown>;
    }): Promise<ScheduledMaintenanceState | null> => {
      const stateId: string = String(findOneBy.query["_id"]);
      const found: ScheduledMaintenanceState = state(kindOf(stateId));

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

  // The project's states, for whether this is the last one.
  jest
    .spyOn(ScheduledMaintenanceStateService, "findBy")
    .mockResolvedValue([
      state("scheduled"),
      state("ongoing"),
      state("verifying"),
      state("ended"),
    ] as never);

  eventRead = jest
    .spyOn(ScheduledMaintenanceService, "findOneBy")
    .mockImplementation((async (): Promise<ScheduledMaintenance | null> => {
      return storedEvent;
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

  jest
    .spyOn(
      ScheduledMaintenanceStateTimelineService,
      "enableActiveMonitoringForMonitors",
    )
    .mockResolvedValue(undefined as never);

  monitorUpdateOneById = jest
    .spyOn(MonitorService, "updateOneById")
    .mockResolvedValue(undefined as never);

  changeMonitorStatus = jest
    .spyOn(MonitorService, "changeMonitorStatus")
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// The status each changeMonitorStatus call put the event's monitors in.
function statusesApplied(): Array<string> {
  return changeMonitorStatus.mock.calls.map((call: Array<unknown>): string => {
    return String(call[2]);
  });
}

describe("the move into an event's ongoing state", () => {
  test("puts the event's monitors in its Change Monitor Status to", async () => {
    storeEvent({
      monitorStatusId: STATUS_PICKED_WHEN_SCHEDULED,
      monitors: [MONITOR_A, MONITOR_B],
    });

    await moveInto("ongoing");

    expect(changeMonitorStatus).toHaveBeenCalledTimes(1);

    const [projectId, monitorIds, statusId, notifyOwners, rootCause, , props] =
      changeMonitorStatus.mock.calls[0]! as [
        ObjectID,
        Array<ObjectID>,
        ObjectID,
        boolean,
        string,
        unknown,
        Dictionary<unknown>,
      ];

    expect(projectId.toString()).toBe(PROJECT_ID.toString());
    expect(
      monitorIds
        .map((id: ObjectID): string => {
          return id.toString();
        })
        .sort(),
    ).toEqual([MONITOR_A, MONITOR_B].sort());
    expect(statusId.toString()).toBe(STATUS_PICKED_WHEN_SCHEDULED);
    expect(notifyOwners).toBe(true);
    expect(rootCause).toBe(
      `Changed because of scheduled maintenance event: ${EVENT_ID.toString()}`,
    );
    expect(props).toEqual({ isRoot: true });
  });

  test("reads the status as it is stored at that moment: one changed after scheduling is the one applied", async () => {
    // Picked when the event was scheduled...
    storeEvent({
      monitorStatusId: STATUS_PICKED_WHEN_SCHEDULED,
      monitors: [MONITOR_A],
    });
    // ...and changed before it started.
    storeEvent({
      monitorStatusId: STATUS_CHANGED_BEFORE_THE_START,
      monitors: [MONITOR_A],
    });

    await moveInto("ongoing");

    expect(statusesApplied()).toEqual([STATUS_CHANGED_BEFORE_THE_START]);

    // The event's own read asks for the status.
    const select: Dictionary<unknown> = (
      eventRead.mock.calls[0]![0] as { select: Dictionary<unknown> }
    ).select;

    expect(select["changeMonitorStatusToId"]).toBe(true);
    expect(select["monitors"]).toEqual({ _id: true });
  });

  test("still stops probing the monitors first, as it always did", async () => {
    storeEvent({
      monitorStatusId: STATUS_PICKED_WHEN_SCHEDULED,
      monitors: [MONITOR_A, MONITOR_B],
    });

    await moveInto("ongoing");

    expect(monitorUpdateOneById).toHaveBeenCalledTimes(2);

    for (const call of monitorUpdateOneById.mock.calls) {
      expect((call[0] as { data: Dictionary<unknown> }).data).toEqual({
        disableActiveMonitoringBecauseOfScheduledMaintenanceEvent: true,
      });
    }

    // The flag first, then the status.
    expect(monitorUpdateOneById.mock.invocationCallOrder[1]!).toBeLessThan(
      changeMonitorStatus.mock.invocationCallOrder[0]!,
    );
  });

  test("an event without a status leaves its monitors in theirs", async () => {
    storeEvent({ monitors: [MONITOR_A] });

    await moveInto("ongoing");

    expect(changeMonitorStatus).not.toHaveBeenCalled();
    // Probing still stops.
    expect(monitorUpdateOneById).toHaveBeenCalledTimes(1);
  });

  test("an event without monitors has nothing to change", async () => {
    storeEvent({ monitorStatusId: STATUS_PICKED_WHEN_SCHEDULED });

    await moveInto("ongoing");

    expect(changeMonitorStatus).not.toHaveBeenCalled();
  });

  test("a row filled in between two others, back in the timeline, starts nothing", async () => {
    storeEvent({
      monitorStatusId: STATUS_PICKED_WHEN_SCHEDULED,
      monitors: [MONITOR_A],
    });

    await moveInto("ongoing", { filledInBetween: true });

    expect(changeMonitorStatus).not.toHaveBeenCalled();
  });

  test("a failure to change the monitors is logged, never turned into an error: the state change stands", async () => {
    const loggedErrors: jest.SpyInstance = jest
      .spyOn(logger, "error")
      .mockImplementation((() => {
        return undefined;
      }) as never);

    changeMonitorStatus.mockRejectedValue(new Error("lock failed") as never);

    storeEvent({
      monitorStatusId: STATUS_PICKED_WHEN_SCHEDULED,
      monitors: [MONITOR_A],
    });

    await expect(moveInto("ongoing")).resolves.toBeUndefined();

    expect(
      loggedErrors.mock.calls.some((call: Array<unknown>): boolean => {
        return String(call[0]).includes("applyMonitorStatusWhenStarting");
      }),
    ).toBe(true);
  });
});

describe("the moves that are not the start", () => {
  test.each([
    ["the scheduled state", "scheduled"],
    ["a state of the project's own after Ongoing", "verifying"],
    ["the ended state", "ended"],
  ] as Array<[string, StateKind]>)(
    "a move into %s applies no status",
    async (_name: string, kind: StateKind) => {
      storeEvent({
        monitorStatusId: STATUS_PICKED_WHEN_SCHEDULED,
        monitors: [MONITOR_A],
      });

      await moveInto(kind);

      expect(changeMonitorStatus).not.toHaveBeenCalled();
    },
  );
});

/*
 * The job only moves the event into its ongoing state now; the move applies
 * the status. A copy of the status read in the job's own query, up to a
 * minute before, could undo a change made in between.
 */
describe("the ChangeStateToOngoing job", () => {
  const JOB_FILE: string = path.resolve(
    __dirname,
    "../../../../App/FeatureSet/Workers/Jobs/ScheduledMaintenance/ChangeStateToOngoing.ts",
  );

  const source: string = fs.readFileSync(JOB_FILE, "utf8");

  test("applies no status of its own", () => {
    expect(source).not.toContain("changeAttachedMonitorStates");
    expect(source).not.toContain("changeMonitorStatusToId");
  });

  test("moves the event through changeScheduledMaintenanceState, which makes the timeline row", () => {
    expect(source).toContain(
      "ScheduledMaintenanceService.changeScheduledMaintenanceState(",
    );
  });
});
