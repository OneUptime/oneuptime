import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import ObjectID from "Common/Types/ObjectID";

/*
 * The job that starts scheduled maintenance events once their start time
 * has passed: it moves each one into its project's ongoing state.
 *
 * Which events wait for their time is the one rule
 * (Common/Utils/ScheduledMaintenanceStart.isWaitingToStart): the project's
 * scheduled state, and a state of the project's own placed after Scheduled
 * and before Ongoing, such as "Confirmed". The job used to ask for the
 * scheduled flag alone, so an event moved on to "Confirmed" was never
 * started - its monitors were never held, its subscribers never told. A
 * state placed before Scheduled - "Draft", an approval step - waits for a
 * person, not the clock: nothing starts an event there.
 *
 * The job reads the queries from the real state service, its reads of the
 * states answered from the scheduled maintenance test world
 * (Common/Tests/Server/TestingUtils/ScheduledMaintenanceProgressWorld), and
 * the events from an in-memory table that keeps what each query lets
 * through, as the database would.
 *
 * It does not read the event's Change Monitor Status to: that can be
 * changed until the event starts, and the move changes the monitors to the
 * status stored at that moment, as every start does
 * (ScheduledMaintenanceStateTimelineService, tested in Common).
 *
 * The job registers itself via RunCron at import time and exports nothing,
 * so the Cron util is mocked to CAPTURE the handler - the same recorder the
 * other App/Tests/Workers/Jobs suites use - and each test drives one tick.
 */

type CronHandler = () => Promise<void>;

const mockCapturedJobs: Record<string, CronHandler> = {};

jest.mock("../../../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(
      (jobName: string, _options: unknown, runFunction: CronHandler): void => {
        mockCapturedJobs[jobName] = runFunction;
      },
    ),
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    EXTERNAL_FAULT: {},
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

/*
 * PasswordHash carries a pre-existing TS5.9 diagnostic that fails any suite
 * whose runtime require graph reaches it, and the real state service below
 * may reach it, so it is replaced with a factory.
 */
jest.mock("Common/Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: { hash: jest.fn(), verify: jest.fn() },
  };
});

jest.mock("Common/Server/Services/ScheduledMaintenanceService", () => {
  return {
    __esModule: true,
    default: {
      findAllBy: jest.fn(),
      changeScheduledMaintenanceState: jest.fn(),
      changeAttachedMonitorStates: jest.fn(),
    },
  };
});

import ScheduledMaintenanceService from "Common/Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateService from "Common/Server/Services/ScheduledMaintenanceStateService";
import {
  PROGRESS_PROJECT_ID,
  ProgressStateKey,
  eventMatchesStateQuery,
  makeProgressState,
  makeProgressStates,
  mockProgressStateReads,
  progressStateId,
} from "Common/Tests/Server/TestingUtils/ScheduledMaintenanceProgressWorld";
import "../../../../FeatureSet/Workers/Jobs/ScheduledMaintenance/ChangeStateToOngoing";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

const JOB_NAME: string = "ScheduledMaintenance:ChangeStateToOngoing";

// A project that put "Draft" before Scheduled, and one without an ongoing state.
const DRAFT_PROJECT_ID: ObjectID = new ObjectID(
  "5a000000-0000-4000-8000-000000000004",
);
const NO_ONGOING_PROJECT_ID: ObjectID = new ObjectID(
  "5a000000-0000-4000-8000-000000000005",
);

const PAST: Date = new Date(Date.now() - 60 * 60 * 1000);
const FUTURE: Date = new Date(Date.now() + 60 * 60 * 1000);

// The world's list for another project, its ids its own.
function statesOf(
  projectId: ObjectID,
  keys: Array<ProgressStateKey>,
): Array<ScheduledMaintenanceState> {
  return keys.map((key: ProgressStateKey): ScheduledMaintenanceState => {
    const state: ScheduledMaintenanceState = makeProgressState(key, projectId);
    state._id = progressStateId(key)
      .toString()
      .replace("-8000-", `-8${projectId.toString().slice(-3)}-`);
    return state;
  });
}

function draftState(projectId: ObjectID): ScheduledMaintenanceState {
  const state: ScheduledMaintenanceState = new ScheduledMaintenanceState();
  state._id = `5a000000-0000-4000-8${projectId.toString().slice(-3)}-0000000000a0`;
  state.projectId = projectId;
  state.name = "Draft";
  state.order = 0;
  state.isScheduledState = false;
  state.isOngoingState = false;
  state.isEndedState = false;
  state.isResolvedState = false;
  return state;
}

const DRAFT_PROJECT_STATES: Array<ScheduledMaintenanceState> = [
  draftState(DRAFT_PROJECT_ID),
  ...statesOf(DRAFT_PROJECT_ID, [
    "scheduled",
    "confirmed",
    "ongoing",
    "verifying",
    "ended",
    "completed",
  ]),
];

const NO_ONGOING_PROJECT_STATES: Array<ScheduledMaintenanceState> = statesOf(
  NO_ONGOING_PROJECT_ID,
  ["scheduled", "confirmed", "ended", "completed"],
);

const ALL_STATES: Array<ScheduledMaintenanceState> = [
  ...makeProgressStates(),
  ...DRAFT_PROJECT_STATES,
  ...NO_ONGOING_PROJECT_STATES,
];

function stateNamed(projectId: ObjectID, name: string): ScheduledMaintenanceState {
  const state: ScheduledMaintenanceState | undefined = ALL_STATES.find(
    (candidate: ScheduledMaintenanceState): boolean => {
      return (
        candidate.projectId?.toString() === projectId.toString() &&
        candidate.name === name
      );
    },
  );

  if (!state) {
    throw new Error(`No state ${name} in ${projectId.toString()}`);
  }

  return state;
}

// The events the job's reads answer from.
let events: Array<ScheduledMaintenance> = [];

function eventIn(data: {
  id: string;
  projectId: ObjectID;
  stateName: string;
  startsAt?: Date;
  notifySubscribers?: boolean;
}): ScheduledMaintenance {
  const state: ScheduledMaintenanceState = stateNamed(
    data.projectId,
    data.stateName,
  );
  const event: ScheduledMaintenance = new ScheduledMaintenance();
  event._id = data.id;
  event.projectId = data.projectId;
  event.title = `Event in ${data.stateName}`;
  event.startsAt = data.startsAt || PAST;
  event.currentScheduledMaintenanceStateId = new ObjectID(
    state._id!.toString(),
  );
  event.currentScheduledMaintenanceState = state;
  event.shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing =
    Boolean(data.notifySubscribers);
  return event;
}

/*
 * The moment a QueryHelper.lessThan condition names: the one value its Raw
 * operator binds. Read by shape - Common's copy of typeorm builds it, not
 * this package's.
 */
function boundOf(condition: unknown): Date | null {
  const parameters: unknown =
    condition && typeof condition === "object"
      ? (condition as { objectLiteralParameters?: unknown })
          .objectLiteralParameters
      : undefined;

  if (!parameters || typeof parameters !== "object") {
    return null;
  }

  const values: Array<unknown> = Object.values(
    parameters as Record<string, unknown>,
  );

  return values[0] instanceof Date ? values[0] : null;
}

async function tick(): Promise<void> {
  const job: CronHandler | undefined = mockCapturedJobs[JOB_NAME];

  expect(job).toBeDefined();

  await job!();
}

const findAllBy: jest.Mock = ScheduledMaintenanceService.findAllBy as jest.Mock;
const changeState: jest.Mock =
  ScheduledMaintenanceService.changeScheduledMaintenanceState as jest.Mock;
const changeMonitors: jest.Mock =
  ScheduledMaintenanceService.changeAttachedMonitorStates as jest.Mock;

interface Move {
  projectId: string;
  scheduledMaintenanceId: string;
  scheduledMaintenanceStateId: string;
  shouldNotifyStatusPageSubscribers: unknown;
  isSubscribersNotified: unknown;
  notifyOwners: unknown;
  props: unknown;
}

function moves(): Array<Move> {
  return changeState.mock.calls.map((call: Array<unknown>): Move => {
    const move: Record<string, unknown> = call[0] as Record<string, unknown>;

    return {
      projectId: String(move["projectId"]),
      scheduledMaintenanceId: String(move["scheduledMaintenanceId"]),
      scheduledMaintenanceStateId: String(move["scheduledMaintenanceStateId"]),
      shouldNotifyStatusPageSubscribers:
        move["shouldNotifyStatusPageSubscribers"],
      isSubscribersNotified: move["isSubscribersNotified"],
      notifyOwners: move["notifyOwners"],
      props: move["props"],
    };
  });
}

function movedEventIds(): Array<string> {
  return moves()
    .map((move: Move): string => {
      return move.scheduledMaintenanceId;
    })
    .sort();
}

const E_SCHEDULED: string = "55555555-5555-4555-8555-555555555551";
const E_CONFIRMED: string = "55555555-5555-4555-8555-555555555552";
const E_ONGOING: string = "55555555-5555-4555-8555-555555555553";
const E_VERIFYING: string = "55555555-5555-4555-8555-555555555554";
const E_ENDED: string = "55555555-5555-4555-8555-555555555555";
const E_DRAFT: string = "55555555-5555-4555-8555-555555555556";
const E_DRAFT_PROJECT_CONFIRMED: string = "55555555-5555-4555-8555-555555555557";
const E_CONFIRMED_LATER: string = "55555555-5555-4555-8555-555555555558";
const E_NO_ONGOING_CONFIRMED: string = "55555555-5555-4555-8555-555555555559";

describe("ScheduledMaintenance:ChangeStateToOngoing", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockProgressStateReads(ALL_STATES);

    events = [];

    findAllBy.mockImplementation((async (args: unknown) => {
      const query: Record<string, unknown> = (
        args as { query: Record<string, unknown> }
      ).query;
      const bound: Date | null = boundOf(query["startsAt"]);

      return events.filter((event: ScheduledMaintenance): boolean => {
        return (
          eventMatchesStateQuery(event, query) &&
          (!bound || event.startsAt!.getTime() < bound.getTime())
        );
      });
    }) as never);
    changeState.mockResolvedValue(undefined as never);
    changeMonitors.mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("starts an event in a state of the project's own between Scheduled and Ongoing, as one left scheduled", async () => {
    events = [
      eventIn({
        id: E_SCHEDULED,
        projectId: PROGRESS_PROJECT_ID,
        stateName: "Scheduled",
      }),
      eventIn({
        id: E_CONFIRMED,
        projectId: PROGRESS_PROJECT_ID,
        stateName: "Confirmed",
      }),
    ];

    await tick();

    expect(movedEventIds()).toEqual([E_SCHEDULED, E_CONFIRMED].sort());
  });

  test("both are moved into the project's ongoing state, owners and subscribers told as for any start", async () => {
    events = [
      eventIn({
        id: E_SCHEDULED,
        projectId: PROGRESS_PROJECT_ID,
        stateName: "Scheduled",
        notifySubscribers: false,
      }),
      eventIn({
        id: E_CONFIRMED,
        projectId: PROGRESS_PROJECT_ID,
        stateName: "Confirmed",
        notifySubscribers: true,
      }),
    ];

    await tick();

    const ongoingStateId: string = progressStateId("ongoing").toString();

    expect(
      moves().sort((a: Move, b: Move): number => {
        return a.scheduledMaintenanceId.localeCompare(b.scheduledMaintenanceId);
      }),
    ).toEqual([
      {
        projectId: PROGRESS_PROJECT_ID.toString(),
        scheduledMaintenanceId: E_SCHEDULED,
        scheduledMaintenanceStateId: ongoingStateId,
        shouldNotifyStatusPageSubscribers: false,
        isSubscribersNotified: false,
        notifyOwners: true,
        props: { isRoot: true },
      },
      {
        projectId: PROGRESS_PROJECT_ID.toString(),
        scheduledMaintenanceId: E_CONFIRMED,
        scheduledMaintenanceStateId: ongoingStateId,
        shouldNotifyStatusPageSubscribers: true,
        isSubscribersNotified: false,
        notifyOwners: true,
        props: { isRoot: true },
      },
    ]);

    // The move changes the monitors, to the status stored when it happens.
    expect(changeMonitors).not.toHaveBeenCalled();
  });

  test("leaves an event in a state placed before Scheduled alone: a draft waits for a person", async () => {
    events = [
      eventIn({
        id: E_DRAFT,
        projectId: DRAFT_PROJECT_ID,
        stateName: "Draft",
      }),
      eventIn({
        id: E_DRAFT_PROJECT_CONFIRMED,
        projectId: DRAFT_PROJECT_ID,
        stateName: "Confirmed",
      }),
    ];

    await tick();

    expect(movedEventIds()).toEqual([E_DRAFT_PROJECT_CONFIRMED]);
    expect(
      moves()[0]!.scheduledMaintenanceStateId.toLowerCase(),
    ).toBe(
      stateNamed(DRAFT_PROJECT_ID, "Ongoing")._id!.toString().toLowerCase(),
    );
  });

  test("leaves the events that have started alone: in progress or over", async () => {
    events = [
      eventIn({
        id: E_ONGOING,
        projectId: PROGRESS_PROJECT_ID,
        stateName: "Ongoing",
      }),
      eventIn({
        id: E_VERIFYING,
        projectId: PROGRESS_PROJECT_ID,
        stateName: "Verifying",
      }),
      eventIn({
        id: E_ENDED,
        projectId: PROGRESS_PROJECT_ID,
        stateName: "Ended",
      }),
    ];

    await tick();

    expect(changeState).not.toHaveBeenCalled();
  });

  test("an event whose start time has not passed waits, in Confirmed as in Scheduled", async () => {
    events = [
      eventIn({
        id: E_CONFIRMED,
        projectId: PROGRESS_PROJECT_ID,
        stateName: "Confirmed",
      }),
      eventIn({
        id: E_CONFIRMED_LATER,
        projectId: PROGRESS_PROJECT_ID,
        stateName: "Confirmed",
        startsAt: FUTURE,
      }),
    ];

    await tick();

    expect(movedEventIds()).toEqual([E_CONFIRMED]);
  });

  test("reads the due events by every query the rule names, each past its start, with only what the move needs", async () => {
    await tick();

    expect(findAllBy).toHaveBeenCalledTimes(2);

    const reads: Array<{
      select: Record<string, unknown>;
      query: Record<string, unknown>;
      props: Record<string, unknown>;
    }> = findAllBy.mock.calls.map(
      (
        call: Array<unknown>,
      ): {
        select: Record<string, unknown>;
        query: Record<string, unknown>;
        props: Record<string, unknown>;
      } => {
        return call[0] as {
          select: Record<string, unknown>;
          query: Record<string, unknown>;
          props: Record<string, unknown>;
        };
      },
    );

    // The scheduled state by its flag; the project's own states by their ids.
    expect(reads[0]!.query["currentScheduledMaintenanceState"]).toEqual({
      isScheduledState: true,
    });
    expect(reads[1]!.query["currentScheduledMaintenanceStateId"]).toBeDefined();
    expect(reads[1]!.query["currentScheduledMaintenanceState"]).toBeUndefined();

    const bounds: Array<number> = reads.map(
      (read: { query: Record<string, unknown> }): number => {
        return boundOf(read.query["startsAt"])!.getTime();
      },
    );

    // Both only past their start, measured against the same moment.
    expect(bounds[0]).toBe(bounds[1]);

    for (const read of reads) {
      expect(read.select).toEqual({
        _id: true,
        projectId: true,
        shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing: true,
      });
      expect(read.select).not.toHaveProperty("changeMonitorStatusToId");
      expect(read.select).not.toHaveProperty("monitors");
      expect(read.props).toEqual({ isRoot: true });
    }
  });

  test("an event two reads find is started once", async () => {
    const event: ScheduledMaintenance = eventIn({
      id: E_CONFIRMED,
      projectId: PROGRESS_PROJECT_ID,
      stateName: "Confirmed",
    });

    findAllBy.mockResolvedValue([event] as never);

    await tick();

    expect(movedEventIds()).toEqual([E_CONFIRMED]);
  });

  test("moves an event into the ongoing state itself, not a state of the project's own after it", async () => {
    events = [
      eventIn({
        id: E_CONFIRMED,
        projectId: PROGRESS_PROJECT_ID,
        stateName: "Confirmed",
      }),
    ];

    await tick();

    expect(moves()[0]!.scheduledMaintenanceStateId).toBe(
      progressStateId("ongoing").toString(),
    );
    expect(moves()[0]!.scheduledMaintenanceStateId).not.toBe(
      progressStateId("verifying").toString(),
    );
  });

  test("an event whose project has no ongoing state is left where it is", async () => {
    events = [
      eventIn({
        id: E_NO_ONGOING_CONFIRMED,
        projectId: NO_ONGOING_PROJECT_ID,
        stateName: "Scheduled",
      }),
      eventIn({
        id: E_SCHEDULED,
        projectId: PROGRESS_PROJECT_ID,
        stateName: "Scheduled",
      }),
    ];

    await tick();

    expect(movedEventIds()).toEqual([E_SCHEDULED]);
  });

  test("reads each project's states once a run, however many of its events are due", async () => {
    const readStates: ReturnType<typeof jest.spyOn> = jest.spyOn(
      ScheduledMaintenanceStateService,
      "getAllScheduledMaintenanceStates",
    );

    events = [
      eventIn({
        id: E_SCHEDULED,
        projectId: PROGRESS_PROJECT_ID,
        stateName: "Scheduled",
      }),
      eventIn({
        id: E_CONFIRMED,
        projectId: PROGRESS_PROJECT_ID,
        stateName: "Confirmed",
      }),
      eventIn({
        id: E_DRAFT_PROJECT_CONFIRMED,
        projectId: DRAFT_PROJECT_ID,
        stateName: "Confirmed",
      }),
    ];

    await tick();

    expect(changeState).toHaveBeenCalledTimes(3);

    const projectsRead: Array<string> = readStates.mock.calls
      .map((call: Array<unknown>): string => {
        return String((call[0] as { projectId: unknown }).projectId);
      })
      .sort();

    expect(projectsRead).toEqual(
      [PROGRESS_PROJECT_ID.toString(), DRAFT_PROJECT_ID.toString()].sort(),
    );

    for (const call of readStates.mock.calls) {
      expect((call[0] as { props: unknown }).props).toEqual({ isRoot: true });
    }
  });
});
