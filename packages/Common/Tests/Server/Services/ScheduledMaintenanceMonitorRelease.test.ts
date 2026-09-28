import MonitorService from "../../../Server/Services/MonitorService";
import MonitorStatusService from "../../../Server/Services/MonitorStatusService";
import MonitorStatusTimelineService, {
  MONITOR_STATUS_SAME_AS_PREVIOUS_ERROR_MESSAGE,
  MONITOR_STATUS_TIMELINE_LOCK_ERROR_MESSAGE,
} from "../../../Server/Services/MonitorStatusTimelineService";
import ScheduledMaintenanceMeasurementService from "../../../Server/Services/ScheduledMaintenanceMeasurementService";
import ScheduledMaintenanceService from "../../../Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateTimelineService from "../../../Server/Services/ScheduledMaintenanceStateTimelineService";
import { OnDelete } from "../../../Server/Types/Database/Hooks";
import MeasurementMetricWriter from "../../../Server/Utils/Measurement/MeasurementMetricWriter";
import logger, { LogAttributes } from "../../../Server/Utils/Logger";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "../../../Models/DatabaseModels/ScheduledMaintenanceState";
import ScheduledMaintenanceStateTimeline from "../../../Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import ServerException from "../../../Types/Exception/ServerException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * An event releases its monitors when it ends, is resolved or deleted, or has
 * them detached - clearing the flag that stopped probing and putting each
 * back in the operational status - unless another event still holds the
 * monitor.
 *
 * "Holds" means the same thing wherever it is asked: moved to ongoing and not
 * since to ended or resolved, which includes a state the project added itself
 * past ongoing (say "Verifying"). The check for ANOTHER event used to count
 * only events in an ongoing state, so a monitor also held by an event in
 * "Verifying" was re-enabled the moment the other event let go of it.
 *
 * And one monitor failing to be released used to abort the loop, leaving the
 * rest disabled for good.
 *
 * The database is a fake: the events, each with its monitors, current state
 * and state timeline, answer the event and timeline reads.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-5a5a-4aaa-8bbb-000000000001",
);
const RELEASING_EVENT_ID: string = "0193c0de-5a5a-4aaa-8bbb-0000000000e1";
const OTHER_EVENT_ID: string = "0193c0de-5a5a-4aaa-8bbb-0000000000e2";
const THIRD_EVENT_ID: string = "0193c0de-5a5a-4aaa-8bbb-0000000000e3";

const OPERATIONAL_STATUS_ID: string = "0193c0de-5a5a-4aaa-8bbb-0000000000f0";
const MAINTENANCE_STATUS_ID: string = "0193c0de-5a5a-4aaa-8bbb-0000000000f1";

const MONITOR_A: string = "0193c0de-5a5a-4aaa-8bbb-0000000000a1";
const MONITOR_B: string = "0193c0de-5a5a-4aaa-8bbb-0000000000a2";
const MONITOR_C: string = "0193c0de-5a5a-4aaa-8bbb-0000000000a3";

// "custom" is a state the project added itself: none of the built-in kinds.
type StateKind = "scheduled" | "ongoing" | "ended" | "resolved" | "custom";

const STATE_IDS: Dictionary<string> = {
  scheduled: "0193c0de-5a5a-4aaa-8bbb-0000000000d1",
  ongoing: "0193c0de-5a5a-4aaa-8bbb-0000000000d2",
  ended: "0193c0de-5a5a-4aaa-8bbb-0000000000d3",
  resolved: "0193c0de-5a5a-4aaa-8bbb-0000000000d4",
  custom: "0193c0de-5a5a-4aaa-8bbb-0000000000d5",
};

type StoredEvent = {
  id: string;
  state: StateKind;
  monitors: Array<string>;
  // Oldest first.
  timeline: Array<StateKind>;
};

type EventFindBy = {
  query: {
    monitors: Array<ObjectID>;
    currentScheduledMaintenanceState: Dictionary<boolean>;
  };
  select: JSONObject;
  limit: number;
  props: JSONObject;
};

type TimelineFindBy = {
  query: { scheduledMaintenanceId: unknown; projectId: ObjectID };
  select: JSONObject;
  sort: JSONObject;
  limit: number;
  props: JSONObject;
};

type EventIdsOfFunction = (queryValue: unknown) => Array<string>;

/*
 * The events a timeline read asks for: one event's id, or QueryHelper.any of
 * several - a TypeORM Raw operator carrying them as a named parameter.
 */
const eventIdsOf: EventIdsOfFunction = (queryValue: unknown): Array<string> => {
  const parameters: Record<string, unknown> | undefined = (
    queryValue as { objectLiteralParameters?: Record<string, unknown> }
  )?.objectLiteralParameters;

  const values: Array<unknown> | undefined = Object.values(
    parameters || {},
  ).find((parameter: unknown): boolean => {
    return Array.isArray(parameter);
  }) as Array<unknown> | undefined;

  return (values || [queryValue]).map((value: unknown): string => {
    return String(value);
  });
};

// The events each timeline read asked for, in order.
function timelineReads(): Array<Array<string>> {
  return timelineFindBy.mock.calls.map(
    (call: Array<unknown>): Array<string> => {
      return eventIdsOf(
        (call[0] as TimelineFindBy).query.scheduledMaintenanceId,
      );
    },
  );
}

type OnDeleteSuccessFunction = (
  onDelete: OnDelete<ScheduledMaintenance>,
  deletedItemIds: Array<ObjectID>,
) => Promise<OnDelete<ScheduledMaintenance>>;

function state(kind: StateKind): ScheduledMaintenanceState {
  const scheduledMaintenanceState: ScheduledMaintenanceState =
    new ScheduledMaintenanceState();
  scheduledMaintenanceState._id = STATE_IDS[kind]!;
  scheduledMaintenanceState.isScheduledState = kind === "scheduled";
  scheduledMaintenanceState.isOngoingState = kind === "ongoing";
  scheduledMaintenanceState.isEndedState = kind === "ended";
  scheduledMaintenanceState.isResolvedState = kind === "resolved";
  return scheduledMaintenanceState;
}

// Whether a state matches a relation query such as { isOngoingState: true }.
function stateMatches(kind: StateKind, query: Dictionary<boolean>): boolean {
  const scheduledMaintenanceState: ScheduledMaintenanceState = state(kind);

  return Object.keys(query).every((key: string): boolean => {
    return (
      Boolean(
        (scheduledMaintenanceState as unknown as Dictionary<unknown>)[key],
      ) === query[key]
    );
  });
}

function eventsMatching(query: EventFindBy["query"]): Array<StoredEvent> {
  const monitorIds: Array<string> = (query.monitors || []).map(
    (id: ObjectID): string => {
      return id.toString();
    },
  );

  return storedEvents.filter((storedEvent: StoredEvent): boolean => {
    return (
      monitorIds.every((monitorId: string): boolean => {
        return storedEvent.monitors.includes(monitorId);
      }) &&
      stateMatches(
        storedEvent.state,
        query.currentScheduledMaintenanceState || {},
      )
    );
  });
}

function releasingEvent(monitorIds: Array<string>): ScheduledMaintenance {
  const scheduledMaintenance: ScheduledMaintenance = new ScheduledMaintenance(
    new ObjectID(RELEASING_EVENT_ID),
  );
  scheduledMaintenance.projectId = PROJECT_ID;
  scheduledMaintenance.monitors = monitorIds.map((id: string): Monitor => {
    return new Monitor(new ObjectID(id));
  });
  return scheduledMaintenance;
}

let storedEvents: Array<StoredEvent> = [];

// Distinct event ids, as many as asked for.
function manyEventIds(count: number): Array<string> {
  const eventIds: Array<string> = [];

  for (let index: number = 0; index < count; index++) {
    eventIds.push(
      `0193c0de-5a5a-4aaa-8ccc-${index.toString(16).padStart(12, "0")}`,
    );
  }

  return eventIds;
}

let eventFindBy: jest.SpyInstance;
let timelineFindBy: jest.SpyInstance;
let monitorUpdateOneById: jest.SpyInstance;
let statusTimelineCreate: jest.SpyInstance;
let loggerError: jest.SpyInstance;

// The monitors whose flag was cleared, in order.
function releasedMonitorIds(): Array<string> {
  return monitorUpdateOneById.mock.calls
    .filter((call: Array<unknown>): boolean => {
      return (
        (call[0] as { data: JSONObject }).data[
          "disableActiveMonitoringBecauseOfScheduledMaintenanceEvent"
        ] === false
      );
    })
    .map((call: Array<unknown>): string => {
      return (call[0] as { id: ObjectID }).id.toString();
    });
}

// The monitors put back in the operational status, in order.
function operationalMonitorIds(): Array<string> {
  return statusTimelineCreate.mock.calls.map((call: Array<unknown>): string => {
    const monitorStatusTimeline: MonitorStatusTimeline = (
      call[0] as { data: MonitorStatusTimeline }
    ).data;

    expect(monitorStatusTimeline.monitorStatusId?.toString()).toBe(
      OPERATIONAL_STATUS_ID,
    );

    return monitorStatusTimeline.monitorId!.toString();
  });
}

beforeEach(() => {
  storedEvents = [];

  jest
    .spyOn(MonitorStatusService, "findOneBy")
    .mockImplementation((async (): Promise<MonitorStatus> => {
      return new MonitorStatus(new ObjectID(OPERATIONAL_STATUS_ID));
    }) as never);

  // Every monitor sits in the maintenance status.
  jest
    .spyOn(MonitorService, "findOneById")
    .mockImplementation((async (findOneById: {
      id: ObjectID;
    }): Promise<Monitor> => {
      const monitor: Monitor = new Monitor(findOneById.id);
      monitor.currentMonitorStatusId = new ObjectID(MAINTENANCE_STATUS_ID);
      return monitor;
    }) as never);

  monitorUpdateOneById = jest
    .spyOn(MonitorService, "updateOneById")
    .mockResolvedValue(undefined as never);

  statusTimelineCreate = jest
    .spyOn(MonitorStatusTimelineService, "create")
    .mockImplementation((async (createBy: {
      data: MonitorStatusTimeline;
    }): Promise<MonitorStatusTimeline> => {
      return createBy.data;
    }) as never);

  eventFindBy = jest
    .spyOn(ScheduledMaintenanceService, "findBy")
    .mockImplementation((async (
      findBy: EventFindBy,
    ): Promise<Array<ScheduledMaintenance>> => {
      return eventsMatching(findBy.query).map(
        (storedEvent: StoredEvent): ScheduledMaintenance => {
          const scheduledMaintenance: ScheduledMaintenance =
            new ScheduledMaintenance(new ObjectID(storedEvent.id));
          scheduledMaintenance.projectId = PROJECT_ID;
          scheduledMaintenance.currentScheduledMaintenanceState = state(
            storedEvent.state,
          );
          return scheduledMaintenance;
        },
      );
    }) as never);

  // The same fake, counted, for a check that counts instead of reading.
  jest
    .spyOn(ScheduledMaintenanceService, "countBy")
    .mockImplementation((async (countBy: {
      query: EventFindBy["query"];
    }): Promise<PositiveNumber> => {
      return new PositiveNumber(eventsMatching(countBy.query).length);
    }) as never);

  /*
   * Every row of the events asked for, oldest first as startsAt orders them:
   * the rows of different events interleave, each event's in its own order.
   */
  timelineFindBy = jest
    .spyOn(ScheduledMaintenanceStateTimelineService, "findBy")
    .mockImplementation((async (
      findBy: TimelineFindBy,
    ): Promise<Array<ScheduledMaintenanceStateTimeline>> => {
      const eventIds: Array<string> = eventIdsOf(
        findBy.query.scheduledMaintenanceId,
      );

      const rows: Array<{
        position: number;
        item: ScheduledMaintenanceStateTimeline;
      }> = [];

      for (const storedEvent of storedEvents) {
        if (!eventIds.includes(storedEvent.id)) {
          continue;
        }

        storedEvent.timeline.forEach((kind: StateKind, position: number) => {
          const item: ScheduledMaintenanceStateTimeline =
            new ScheduledMaintenanceStateTimeline();
          item.scheduledMaintenanceId = new ObjectID(storedEvent.id);
          item.scheduledMaintenanceState = state(kind);
          rows.push({ position: position, item: item });
        });
      }

      return rows
        .sort(
          (
            first: { position: number },
            second: { position: number },
          ): number => {
            return first.position - second.position;
          },
        )
        .map(
          (row: {
            item: ScheduledMaintenanceStateTimeline;
          }): ScheduledMaintenanceStateTimeline => {
            return row.item;
          },
        );
    }) as never);

  loggerError = jest.spyOn(logger, "error").mockImplementation(() => {
    return undefined;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("ScheduledMaintenanceStateTimelineService.isMonitorHeldInMaintenanceByAnyEvent", () => {
  test("reads, as root, only the events on the monitor in a state that can hold it", async () => {
    await ScheduledMaintenanceStateTimelineService.isMonitorHeldInMaintenanceByAnyEvent(
      new ObjectID(MONITOR_A),
    );

    expect(eventFindBy).toHaveBeenCalledTimes(1);

    const findBy: EventFindBy = eventFindBy.mock.calls[0]![0] as EventFindBy;

    expect(
      findBy.query.monitors.map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([MONITOR_A]);
    // Scheduled, ended and resolved never hold anything.
    expect(findBy.query.currentScheduledMaintenanceState).toEqual({
      isScheduledState: false,
      isEndedState: false,
      isResolvedState: false,
    });
    expect(findBy.select).toEqual({
      _id: true,
      projectId: true,
      currentScheduledMaintenanceState: {
        _id: true,
        isScheduledState: true,
        isOngoingState: true,
        isEndedState: true,
        isResolvedState: true,
      },
    });
    expect(findBy.props).toEqual({ isRoot: true });
  });

  test("no such event: not held, and no timeline is read", async () => {
    storedEvents = [
      {
        id: OTHER_EVENT_ID,
        state: "scheduled",
        monitors: [MONITOR_A],
        timeline: ["scheduled"],
      },
      {
        id: THIRD_EVENT_ID,
        state: "ended",
        monitors: [MONITOR_A],
        timeline: ["scheduled", "ongoing", "ended"],
      },
    ];

    expect(
      await ScheduledMaintenanceStateTimelineService.isMonitorHeldInMaintenanceByAnyEvent(
        new ObjectID(MONITOR_A),
      ),
    ).toBe(false);
    expect(timelineFindBy).not.toHaveBeenCalled();
  });

  test("an ongoing event holds it, with no timeline read even beside an event in a state of its own", async () => {
    storedEvents = [
      {
        id: OTHER_EVENT_ID,
        state: "custom",
        monitors: [MONITOR_A],
        timeline: ["scheduled", "custom"],
      },
      {
        id: THIRD_EVENT_ID,
        state: "ongoing",
        monitors: [MONITOR_A],
        timeline: ["scheduled", "ongoing"],
      },
    ];

    expect(
      await ScheduledMaintenanceStateTimelineService.isMonitorHeldInMaintenanceByAnyEvent(
        new ObjectID(MONITOR_A),
      ),
    ).toBe(true);
    expect(timelineFindBy).not.toHaveBeenCalled();
  });

  test.each([
    [
      "past ongoing and not yet ended",
      true,
      ["scheduled", "ongoing", "custom"],
    ],
    ["not yet ongoing", false, ["scheduled", "custom"]],
    ["past ended", false, ["scheduled", "ongoing", "ended", "custom"]],
  ] as Array<[string, boolean, Array<StateKind>]>)(
    "an event in a state of the project's own %s: held is %s",
    async (_label: string, isHeld: boolean, timeline: Array<StateKind>) => {
      storedEvents = [
        {
          id: OTHER_EVENT_ID,
          state: "custom",
          monitors: [MONITOR_A],
          timeline: timeline,
        },
      ];

      expect(
        await ScheduledMaintenanceStateTimelineService.isMonitorHeldInMaintenanceByAnyEvent(
          new ObjectID(MONITOR_A),
        ),
      ).toBe(isHeld);

      // Its own timeline, as root, held to its project, oldest first.
      expect(timelineReads()).toEqual([[OTHER_EVENT_ID]]);
      const findBy: TimelineFindBy = timelineFindBy.mock
        .calls[0]![0] as TimelineFindBy;
      expect(findBy.query.projectId.toString()).toBe(PROJECT_ID.toString());
      // Which event each row belongs to, to split a read of several.
      expect(findBy.select).toEqual({
        _id: true,
        scheduledMaintenanceId: true,
        scheduledMaintenanceState: {
          _id: true,
          isScheduledState: true,
          isOngoingState: true,
          isEndedState: true,
          isResolvedState: true,
        },
      });
      expect(findBy.sort).toEqual({ startsAt: SortOrder.Ascending });
      expect(findBy.limit).toBe(LIMIT_MAX);
      expect(findBy.props).toEqual({ isRoot: true });
    },
  );

  test("every event in a state of its own is replayed from one timeline read, each from its own rows", async () => {
    /*
     * The rows come back interleaved. Replayed as one run, OTHER's "ended"
     * would land after THIRD's "ongoing" and hide that THIRD holds.
     */
    storedEvents = [
      {
        id: OTHER_EVENT_ID,
        state: "custom",
        monitors: [MONITOR_A],
        timeline: ["scheduled", "ongoing", "ended", "custom"],
      },
      {
        id: THIRD_EVENT_ID,
        state: "custom",
        monitors: [MONITOR_A],
        timeline: ["scheduled", "ongoing", "custom"],
      },
    ];

    expect(
      await ScheduledMaintenanceStateTimelineService.isMonitorHeldInMaintenanceByAnyEvent(
        new ObjectID(MONITOR_A),
      ),
    ).toBe(true);
    expect(timelineReads()).toEqual([[OTHER_EVENT_ID, THIRD_EVENT_ID]]);
  });

  test("an event already known not to hold is not read again, and one known to hold answers with no read", async () => {
    storedEvents = [
      {
        id: OTHER_EVENT_ID,
        state: "custom",
        monitors: [MONITOR_A],
        timeline: ["scheduled", "custom"],
      },
      {
        id: THIRD_EVENT_ID,
        state: "custom",
        monitors: [MONITOR_A],
        timeline: ["scheduled", "custom"],
      },
    ];

    const holdingByEventId: Map<string, boolean> = new Map<string, boolean>([
      [OTHER_EVENT_ID, false],
    ]);

    expect(
      await ScheduledMaintenanceStateTimelineService.isMonitorHeldInMaintenanceByAnyEvent(
        new ObjectID(MONITOR_A),
        holdingByEventId,
      ),
    ).toBe(false);
    expect(timelineReads()).toEqual([[THIRD_EVENT_ID]]);
    // What was replayed is remembered for the next monitor.
    expect(holdingByEventId.get(THIRD_EVENT_ID)).toBe(false);

    timelineFindBy.mockClear();
    holdingByEventId.set(THIRD_EVENT_ID, true);

    expect(
      await ScheduledMaintenanceStateTimelineService.isMonitorHeldInMaintenanceByAnyEvent(
        new ObjectID(MONITOR_A),
        holdingByEventId,
      ),
    ).toBe(true);
    expect(timelineFindBy).not.toHaveBeenCalled();
  });

  test("many events in a state of their own are read in batches that stay well inside one read's row limit", async () => {
    const eventIds: Array<string> = manyEventIds(250);

    storedEvents = eventIds.map((id: string): StoredEvent => {
      // Say "Cancelled", reached from Scheduled: it never held anything.
      return {
        id: id,
        state: "custom",
        monitors: [MONITOR_A],
        timeline: ["scheduled", "custom"],
      };
    });

    expect(
      await ScheduledMaintenanceStateTimelineService.isMonitorHeldInMaintenanceByAnyEvent(
        new ObjectID(MONITOR_A),
      ),
    ).toBe(false);

    const reads: Array<Array<string>> = timelineReads();

    expect(reads).toHaveLength(3);
    for (const read of reads) {
      expect(read.length).toBeLessThanOrEqual(100);
    }
    // Each event read exactly once.
    expect(reads.flat().sort()).toEqual([...eventIds].sort());
  });

  test("the batches stop at the first one with an event that holds", async () => {
    const eventIds: Array<string> = manyEventIds(250);

    storedEvents = eventIds.map((id: string, index: number): StoredEvent => {
      return {
        id: id,
        state: "custom",
        monitors: [MONITOR_A],
        timeline:
          index === 0
            ? ["scheduled", "ongoing", "custom"]
            : ["scheduled", "custom"],
      };
    });

    expect(
      await ScheduledMaintenanceStateTimelineService.isMonitorHeldInMaintenanceByAnyEvent(
        new ObjectID(MONITOR_A),
      ),
    ).toBe(true);
    expect(timelineFindBy).toHaveBeenCalledTimes(1);
  });
});

describe("ScheduledMaintenanceStateTimelineService.isScheduledMaintenanceHoldingMonitors", () => {
  test.each([
    ["ongoing", true],
    ["scheduled", false],
    ["ended", false],
    ["resolved", false],
  ] as Array<[StateKind, boolean]>)(
    "a built-in %s state answers for itself (%s), with no timeline read",
    async (kind: StateKind, isHolding: boolean) => {
      expect(
        await ScheduledMaintenanceStateTimelineService.isScheduledMaintenanceHoldingMonitors(
          {
            scheduledMaintenanceId: new ObjectID(OTHER_EVENT_ID),
            projectId: PROJECT_ID,
            currentState: state(kind),
          },
        ),
      ).toBe(isHolding);
      expect(timelineFindBy).not.toHaveBeenCalled();
    },
  );

  test("with no state or no project, nothing is held", async () => {
    expect(
      await ScheduledMaintenanceStateTimelineService.isScheduledMaintenanceHoldingMonitors(
        {
          scheduledMaintenanceId: new ObjectID(OTHER_EVENT_ID),
          projectId: PROJECT_ID,
          currentState: undefined,
        },
      ),
    ).toBe(false);
    expect(
      await ScheduledMaintenanceStateTimelineService.isScheduledMaintenanceHoldingMonitors(
        {
          scheduledMaintenanceId: new ObjectID(OTHER_EVENT_ID),
          projectId: undefined,
          currentState: state("custom"),
        },
      ),
    ).toBe(false);
    expect(timelineFindBy).not.toHaveBeenCalled();
  });
});

describe("ScheduledMaintenanceStateTimelineService.enableActiveMonitoringForMonitors: what another event still holds", () => {
  test("a monitor no other event holds is released and put back in the operational status", async () => {
    await ScheduledMaintenanceStateTimelineService.enableActiveMonitoringForMonitors(
      releasingEvent([MONITOR_A, MONITOR_B]),
    );

    expect(releasedMonitorIds()).toEqual([MONITOR_A, MONITOR_B]);
    expect(operationalMonitorIds()).toEqual([MONITOR_A, MONITOR_B]);
  });

  test("a monitor another event holds while ongoing is left in maintenance", async () => {
    storedEvents = [
      {
        id: OTHER_EVENT_ID,
        state: "ongoing",
        monitors: [MONITOR_A],
        timeline: ["scheduled", "ongoing"],
      },
    ];

    await ScheduledMaintenanceStateTimelineService.enableActiveMonitoringForMonitors(
      releasingEvent([MONITOR_A, MONITOR_B]),
    );

    expect(releasedMonitorIds()).toEqual([MONITOR_B]);
    expect(operationalMonitorIds()).toEqual([MONITOR_B]);
  });

  test("a monitor another event holds in a state of the project's own past ongoing is left in maintenance", async () => {
    // Say "Verifying", between Ongoing and Ended: it released nothing.
    storedEvents = [
      {
        id: OTHER_EVENT_ID,
        state: "custom",
        monitors: [MONITOR_A],
        timeline: ["scheduled", "ongoing", "custom"],
      },
    ];

    await ScheduledMaintenanceStateTimelineService.enableActiveMonitoringForMonitors(
      releasingEvent([MONITOR_A, MONITOR_B]),
    );

    expect(releasedMonitorIds()).toEqual([MONITOR_B]);
    expect(operationalMonitorIds()).toEqual([MONITOR_B]);
  });

  test("a monitor whose other event is in a state of its own before ongoing is released", async () => {
    // Say "Preparing", between Scheduled and Ongoing: it holds nothing yet.
    storedEvents = [
      {
        id: OTHER_EVENT_ID,
        state: "custom",
        monitors: [MONITOR_A],
        timeline: ["scheduled", "custom"],
      },
    ];

    await ScheduledMaintenanceStateTimelineService.enableActiveMonitoringForMonitors(
      releasingEvent([MONITOR_A]),
    );

    expect(releasedMonitorIds()).toEqual([MONITOR_A]);
    expect(operationalMonitorIds()).toEqual([MONITOR_A]);
  });
});

/*
 * Events in a state of their project's own pile up on the monitors: a
 * "Cancelled" state reached from Scheduled is none of the built-in kinds, so
 * every such event stays a candidate for as long as it is kept. Releasing an
 * event used to replay each one's timeline again for every monitor it shares,
 * one read per event per monitor, inside the request that ended or deleted
 * the event.
 */
describe("ScheduledMaintenanceStateTimelineService.enableActiveMonitoringForMonitors: each event in a state of its own is replayed once per release", () => {
  test("events shared by the monitors let go of are read together once, not once per monitor", async () => {
    storedEvents = [OTHER_EVENT_ID, THIRD_EVENT_ID].map(
      (id: string): StoredEvent => {
        return {
          id: id,
          state: "custom",
          monitors: [MONITOR_A, MONITOR_B, MONITOR_C],
          timeline: ["scheduled", "custom"],
        };
      },
    );

    await ScheduledMaintenanceStateTimelineService.enableActiveMonitoringForMonitors(
      releasingEvent([MONITOR_A, MONITOR_B, MONITOR_C]),
    );

    expect(releasedMonitorIds()).toEqual([MONITOR_A, MONITOR_B, MONITOR_C]);
    expect(operationalMonitorIds()).toEqual([MONITOR_A, MONITOR_B, MONITOR_C]);
    expect(timelineReads()).toEqual([[OTHER_EVENT_ID, THIRD_EVENT_ID]]);
  });

  test("an event found to hold keeps the later monitors it holds in maintenance with no further read", async () => {
    storedEvents = [
      {
        id: OTHER_EVENT_ID,
        state: "custom",
        monitors: [MONITOR_A, MONITOR_B],
        timeline: ["scheduled", "ongoing", "custom"],
      },
    ];

    await ScheduledMaintenanceStateTimelineService.enableActiveMonitoringForMonitors(
      releasingEvent([MONITOR_A, MONITOR_B, MONITOR_C]),
    );

    expect(releasedMonitorIds()).toEqual([MONITOR_C]);
    expect(operationalMonitorIds()).toEqual([MONITOR_C]);
    expect(timelineReads()).toEqual([[OTHER_EVENT_ID]]);
  });

  test("a later monitor reads only the events not yet replayed", async () => {
    storedEvents = [
      {
        id: OTHER_EVENT_ID,
        state: "custom",
        monitors: [MONITOR_A, MONITOR_B],
        timeline: ["scheduled", "custom"],
      },
      {
        id: THIRD_EVENT_ID,
        state: "custom",
        monitors: [MONITOR_B],
        timeline: ["scheduled", "ongoing", "custom"],
      },
    ];

    await ScheduledMaintenanceStateTimelineService.enableActiveMonitoringForMonitors(
      releasingEvent([MONITOR_A, MONITOR_B]),
    );

    expect(releasedMonitorIds()).toEqual([MONITOR_A]);
    expect(timelineReads()).toEqual([[OTHER_EVENT_ID], [THIRD_EVENT_ID]]);
  });

  test("a timeline read that fails is not remembered: that monitor is left as it was and the next reads again", async () => {
    storedEvents = [
      {
        id: OTHER_EVENT_ID,
        state: "custom",
        monitors: [MONITOR_A, MONITOR_B],
        timeline: ["scheduled", "custom"],
      },
    ];
    timelineFindBy.mockRejectedValueOnce(
      new Error("connection reset") as never,
    );

    await ScheduledMaintenanceStateTimelineService.enableActiveMonitoringForMonitors(
      releasingEvent([MONITOR_A, MONITOR_B]),
    );

    expect(releasedMonitorIds()).toEqual([MONITOR_B]);
    expect(operationalMonitorIds()).toEqual([MONITOR_B]);
    expect(timelineReads()).toEqual([[OTHER_EVENT_ID], [OTHER_EVENT_ID]]);
    expect(
      loggerError.mock.calls.some((call: Array<unknown>): boolean => {
        return ((call[1] || {}) as LogAttributes)["monitorId"] === MONITOR_A;
      }),
    ).toBe(true);
  });

  test("what one release worked out is not kept for the next", async () => {
    storedEvents = [
      {
        id: OTHER_EVENT_ID,
        state: "custom",
        monitors: [MONITOR_A],
        timeline: ["scheduled", "custom"],
      },
    ];

    await ScheduledMaintenanceStateTimelineService.enableActiveMonitoringForMonitors(
      releasingEvent([MONITOR_A]),
    );

    expect(releasedMonitorIds()).toEqual([MONITOR_A]);

    // Since then it went ongoing and on to another state of its own.
    storedEvents[0]!.timeline = ["scheduled", "custom", "ongoing", "custom"];
    monitorUpdateOneById.mockClear();

    await ScheduledMaintenanceStateTimelineService.enableActiveMonitoringForMonitors(
      releasingEvent([MONITOR_A]),
    );

    expect(releasedMonitorIds()).toEqual([]);
    expect(timelineReads()).toEqual([[OTHER_EVENT_ID], [OTHER_EVENT_ID]]);
  });
});

describe("ScheduledMaintenanceStateTimelineService.enableActiveMonitoringForMonitors: one monitor failing", () => {
  function expectFailureLoggedFor(monitorId: string): void {
    const attributes: Array<LogAttributes> = loggerError.mock.calls
      .map((call: Array<unknown>): LogAttributes => {
        return (call[1] || {}) as LogAttributes;
      })
      .filter((logAttributes: LogAttributes): boolean => {
        return logAttributes["monitorId"] === monitorId;
      });

    expect(attributes.length).toBeGreaterThan(0);

    for (const logAttributes of attributes) {
      expect(logAttributes.projectId).toBe(PROJECT_ID.toString());
      expect(logAttributes["scheduledMaintenanceId"]).toBe(RELEASING_EVENT_ID);
    }
  }

  test.each([
    [
      "the status timeline lock",
      new ServerException(MONITOR_STATUS_TIMELINE_LOCK_ERROR_MESSAGE),
    ],
    [
      "a status set by a concurrent writer",
      new BadDataException(MONITOR_STATUS_SAME_AS_PREVIOUS_ERROR_MESSAGE),
    ],
  ] as Array<[string, Error]>)(
    "the status write failing on %s leaves the remaining monitors released",
    async (_label: string, error: Error) => {
      statusTimelineCreate.mockRejectedValueOnce(error as never);

      await expect(
        ScheduledMaintenanceStateTimelineService.enableActiveMonitoringForMonitors(
          releasingEvent([MONITOR_A, MONITOR_B, MONITOR_C]),
        ),
      ).resolves.toBeUndefined();

      expect(releasedMonitorIds()).toEqual([MONITOR_A, MONITOR_B, MONITOR_C]);
      // All three were tried; only A's write failed.
      expect(statusTimelineCreate).toHaveBeenCalledTimes(3);
      expectFailureLoggedFor(MONITOR_A);
    },
  );

  test("the flag write failing leaves the remaining monitors released", async () => {
    monitorUpdateOneById.mockRejectedValueOnce(
      new Error("connection reset") as never,
    );

    await ScheduledMaintenanceStateTimelineService.enableActiveMonitoringForMonitors(
      releasingEvent([MONITOR_A, MONITOR_B]),
    );

    // A was tried; its status was never written without its flag.
    expect(monitorUpdateOneById).toHaveBeenCalledTimes(2);
    expect(operationalMonitorIds()).toEqual([MONITOR_B]);
    expectFailureLoggedFor(MONITOR_A);
  });

  test("asking whether another event holds one monitor failing leaves the remaining monitors released", async () => {
    eventFindBy.mockRejectedValueOnce(new Error("connection reset") as never);

    await ScheduledMaintenanceStateTimelineService.enableActiveMonitoringForMonitors(
      releasingEvent([MONITOR_A, MONITOR_B]),
    );

    // A is left as it was rather than released on a guess.
    expect(releasedMonitorIds()).toEqual([MONITOR_B]);
    expect(operationalMonitorIds()).toEqual([MONITOR_B]);
    expectFailureLoggedFor(MONITOR_A);
  });
});

describe("ScheduledMaintenanceService.onDeleteSuccess: deleting an event releases what no other event holds", () => {
  test("a monitor another event holds in a state of the project's own past ongoing stays in maintenance", async () => {
    jest
      .spyOn(ScheduledMaintenanceMeasurementService, "getMetricNamesForProject")
      .mockResolvedValue([] as never);
    jest
      .spyOn(MeasurementMetricWriter, "tombstoneAll")
      .mockResolvedValue(undefined as never);

    // The deleted event is gone; "Verifying" still holds A.
    storedEvents = [
      {
        id: OTHER_EVENT_ID,
        state: "custom",
        monitors: [MONITOR_A],
        timeline: ["scheduled", "ongoing", "custom"],
      },
    ];

    await (
      ScheduledMaintenanceService as unknown as {
        onDeleteSuccess: OnDeleteSuccessFunction;
      }
    ).onDeleteSuccess(
      {
        deleteBy: {
          query: { _id: RELEASING_EVENT_ID },
          props: { isRoot: true },
          limit: 1,
          skip: 0,
        },
        carryForward: {
          scheduledMaintenanceEvents: [releasingEvent([MONITOR_A, MONITOR_B])],
        },
      },
      [new ObjectID(RELEASING_EVENT_ID)],
    );

    expect(releasedMonitorIds()).toEqual([MONITOR_B]);
    expect(operationalMonitorIds()).toEqual([MONITOR_B]);
  });
});
