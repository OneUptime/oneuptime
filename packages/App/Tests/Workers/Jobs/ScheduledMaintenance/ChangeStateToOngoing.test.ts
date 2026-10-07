import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import ObjectID from "Common/Types/ObjectID";

/*
 * The job that starts scheduled maintenance events once their start time
 * has passed. An event's Change Monitor Status to can now be changed until
 * the event starts, so the job no longer reads it: it used to select the
 * status with the event, up to a minute before the start, and change the
 * monitors to that copy after the move - undoing a change made in that
 * minute. Now it only moves the event into its project's ongoing state;
 * the move changes the monitors to the status stored at that moment, as
 * every start does, by hand or by this job
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
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
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

jest.mock("Common/Server/Services/ScheduledMaintenanceStateService", () => {
  return {
    __esModule: true,
    default: { findOneBy: jest.fn() },
  };
});

import ScheduledMaintenanceService from "Common/Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateService from "Common/Server/Services/ScheduledMaintenanceStateService";
import "../../../../FeatureSet/Workers/Jobs/ScheduledMaintenance/ChangeStateToOngoing";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const JOB_NAME: string = "ScheduledMaintenance:ChangeStateToOngoing";

const PROJECT_A: string = "11111111-1111-4111-8111-111111111111";
const PROJECT_B: string = "22222222-2222-4222-8222-222222222222";
const ONGOING_STATE_A: string = "33333333-3333-4333-8333-333333333331";
const STATUS_ID: string = "44444444-4444-4444-8444-444444444444";

// A due event, as the job's read answers it.
function dueEvent(data: {
  id: string;
  projectId: string;
  notifySubscribers?: boolean;
}): ScheduledMaintenance {
  const event: ScheduledMaintenance = new ScheduledMaintenance();
  event._id = data.id;
  event.projectId = new ObjectID(data.projectId);
  event.shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing =
    Boolean(data.notifySubscribers);
  return event;
}

function ongoingState(id: string): ScheduledMaintenanceState {
  const state: ScheduledMaintenanceState = new ScheduledMaintenanceState();
  state._id = id;
  return state;
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
const findOngoingState: jest.Mock =
  ScheduledMaintenanceStateService.findOneBy as jest.Mock;

describe("ScheduledMaintenance:ChangeStateToOngoing", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    findAllBy.mockResolvedValue([] as never);
    changeState.mockResolvedValue(undefined as never);
    changeMonitors.mockResolvedValue(undefined as never);
    findOngoingState.mockImplementation((async (args: unknown) => {
      const projectId: string = String(
        (args as { query: { projectId: unknown } }).query.projectId,
      );

      return projectId === PROJECT_A ? ongoingState(ONGOING_STATE_A) : null;
    }) as never);
  });

  test("reads the due events without their Change Monitor Status to", async () => {
    await tick();

    expect(findAllBy).toHaveBeenCalledTimes(1);

    const read: {
      select: Record<string, unknown>;
      query: Record<string, unknown>;
      props: Record<string, unknown>;
    } = findAllBy.mock.calls[0]![0] as {
      select: Record<string, unknown>;
      query: Record<string, unknown>;
      props: Record<string, unknown>;
    };

    // Only what the move needs: the status is read when the event starts.
    expect(read.select).toEqual({
      _id: true,
      projectId: true,
      shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing: true,
    });
    expect(read.select).not.toHaveProperty("changeMonitorStatusTo");
    expect(read.select).not.toHaveProperty("changeMonitorStatusToId");
    expect(read.select).not.toHaveProperty("monitors");

    // Scheduled events whose start time has passed, across projects.
    expect(read.query["currentScheduledMaintenanceState"]).toEqual({
      isScheduledState: true,
    });
    expect(read.query).toHaveProperty("startsAt");
    expect(read.props).toEqual({ isRoot: true });
  });

  test("moves each due event into its project's ongoing state, and changes no monitor itself", async () => {
    findAllBy.mockResolvedValue([
      dueEvent({
        id: "55555555-5555-4555-8555-555555555551",
        projectId: PROJECT_A,
        notifySubscribers: true,
      }),
      dueEvent({
        id: "55555555-5555-4555-8555-555555555552",
        projectId: PROJECT_A,
        notifySubscribers: false,
      }),
    ] as never);

    await tick();

    expect(changeState).toHaveBeenCalledTimes(2);

    const moves: Array<Record<string, unknown>> = changeState.mock.calls.map(
      (call: Array<unknown>): Record<string, unknown> => {
        const move: Record<string, unknown> = call[0] as Record<
          string,
          unknown
        >;

        return {
          projectId: String(move["projectId"]),
          scheduledMaintenanceId: String(move["scheduledMaintenanceId"]),
          scheduledMaintenanceStateId: String(
            move["scheduledMaintenanceStateId"],
          ),
          shouldNotifyStatusPageSubscribers:
            move["shouldNotifyStatusPageSubscribers"],
          isSubscribersNotified: move["isSubscribersNotified"],
          notifyOwners: move["notifyOwners"],
          props: move["props"],
        };
      },
    );

    expect(moves).toEqual([
      {
        projectId: PROJECT_A,
        scheduledMaintenanceId: "55555555-5555-4555-8555-555555555551",
        scheduledMaintenanceStateId: ONGOING_STATE_A,
        shouldNotifyStatusPageSubscribers: true,
        isSubscribersNotified: false,
        notifyOwners: true,
        props: { isRoot: true },
      },
      {
        projectId: PROJECT_A,
        scheduledMaintenanceId: "55555555-5555-4555-8555-555555555552",
        scheduledMaintenanceStateId: ONGOING_STATE_A,
        shouldNotifyStatusPageSubscribers: false,
        isSubscribersNotified: false,
        notifyOwners: true,
        props: { isRoot: true },
      },
    ]);

    // The move changes the monitors, to the status stored when it happens.
    expect(changeMonitors).not.toHaveBeenCalled();
  });

  test("an event read with a status still has its monitors left to the move", async () => {
    const event: ScheduledMaintenance = dueEvent({
      id: "55555555-5555-4555-8555-555555555553",
      projectId: PROJECT_A,
    });
    event.changeMonitorStatusToId = new ObjectID(STATUS_ID);
    findAllBy.mockResolvedValue([event] as never);

    await tick();

    expect(changeState).toHaveBeenCalledTimes(1);
    expect(changeMonitors).not.toHaveBeenCalled();
  });

  test("an event whose project has no ongoing state is left where it is", async () => {
    findAllBy.mockResolvedValue([
      dueEvent({
        id: "55555555-5555-4555-8555-555555555554",
        projectId: PROJECT_B,
      }),
      dueEvent({
        id: "55555555-5555-4555-8555-555555555555",
        projectId: PROJECT_A,
      }),
    ] as never);

    await tick();

    expect(findOngoingState).toHaveBeenCalledTimes(2);
    expect(changeState).toHaveBeenCalledTimes(1);
    expect(
      String(
        (changeState.mock.calls[0]![0] as Record<string, unknown>)[
          "scheduledMaintenanceId"
        ],
      ),
    ).toBe("55555555-5555-4555-8555-555555555555");
    expect(changeMonitors).not.toHaveBeenCalled();
  });

  test("looks the ongoing state up in the event's own project", async () => {
    findAllBy.mockResolvedValue([
      dueEvent({
        id: "55555555-5555-4555-8555-555555555556",
        projectId: PROJECT_A,
      }),
    ] as never);

    await tick();

    const lookup: {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
    } = findOngoingState.mock.calls[0]![0] as {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
    };

    expect(String(lookup.query["projectId"])).toBe(PROJECT_A);
    expect(lookup.query["isOngoingState"]).toBe(true);
    expect(lookup.select).toEqual({ _id: true });
  });
});
