import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import ObjectID from "Common/Types/ObjectID";

/*
 * The job that ends scheduled maintenance events in progress once their end
 * time has passed. In progress is the one rule
 * (Common/Utils/ScheduledMaintenanceStart): the ongoing state, or a state of
 * the project's own between Ongoing and Ended, such as "Verifying" - the
 * state service turns it into the queries to ask with
 * (getInProgressEventQueriesOfEveryProject, tested in Common). Asked by the
 * ongoing flag alone, an event moved on to "Verifying" was never ended.
 *
 * It only moves each event into its project's ended state; the move puts
 * the monitors the event holds back to operational, reading them as they
 * are stored then (ScheduledMaintenanceStateTimelineService, tested in
 * Common). So the job reads only what the move needs: it used to select the
 * event's monitors and its Change Monitor Status to as well, and use
 * neither.
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
    default: {
      findOneBy: jest.fn(),
      getInProgressEventQueriesOfEveryProject: jest.fn(),
    },
  };
});

import ScheduledMaintenanceService from "Common/Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateService from "Common/Server/Services/ScheduledMaintenanceStateService";
import "../../../../FeatureSet/Workers/Jobs/ScheduledMaintenance/ChangeStateToEnded";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const JOB_NAME: string = "ScheduledMaintenance:ChangeStateToEnded";

const PROJECT_A: string = "11111111-1111-4111-8111-111111111111";
const PROJECT_B: string = "22222222-2222-4222-8222-222222222222";
const ENDED_STATE_A: string = "33333333-3333-4333-8333-333333333331";

// An event past its end, as the job's read answers it.
function overdueEvent(data: {
  id: string;
  projectId: string;
  notifySubscribers?: boolean;
}): ScheduledMaintenance {
  const event: ScheduledMaintenance = new ScheduledMaintenance();
  event._id = data.id;
  event.projectId = new ObjectID(data.projectId);
  event.shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded = Boolean(
    data.notifySubscribers,
  );
  return event;
}

function endedState(id: string): ScheduledMaintenanceState {
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
const findEndedState: jest.Mock =
  ScheduledMaintenanceStateService.findOneBy as jest.Mock;
const getInProgressQueries: jest.Mock =
  ScheduledMaintenanceStateService.getInProgressEventQueriesOfEveryProject as jest.Mock;

/*
 * What the state service answers with: every project's ongoing state by its
 * flag, and - when projects added states of their own between Ongoing and
 * Ended - those states by their ids.
 */
const ONGOING_QUERY: Record<string, unknown> = {
  currentScheduledMaintenanceState: { isOngoingState: true },
};

// Project A's "Verifying", a state of its own between Ongoing and Ended.
const VERIFYING_STATE_A: string = "33333333-3333-4333-8333-333333333334";

function statesOfTheirOwnQuery(ids: Array<string>): Record<string, unknown> {
  return {
    currentScheduledMaintenanceStateId: QueryHelper.any(
      ids.map((id: string): ObjectID => {
        return new ObjectID(id);
      }),
    ),
  };
}

// The reads the job made: their queries, in order.
function queriesRead(): Array<Record<string, unknown>> {
  return findAllBy.mock.calls.map(
    (call: Array<unknown>): Record<string, unknown> => {
      return (call[0] as { query: Record<string, unknown> }).query;
    },
  );
}

/*
 * The overdue events each query finds: the ongoing ones by the flag query,
 * the ones in the project's own states by the query naming them.
 */
function mockOverdueEvents(data: {
  ongoing: Array<ScheduledMaintenance>;
  inStatesOfTheirOwn: Array<ScheduledMaintenance>;
}): void {
  findAllBy.mockImplementation((async (args: unknown) => {
    const query: Record<string, unknown> = (
      args as { query: Record<string, unknown> }
    ).query;

    return query["currentScheduledMaintenanceStateId"]
      ? data.inStatesOfTheirOwn
      : data.ongoing;
  }) as never);
}

function movedEventIds(): Array<string> {
  return changeState.mock.calls.map((call: Array<unknown>): string => {
    return String(
      (call[0] as Record<string, unknown>)["scheduledMaintenanceId"],
    );
  });
}

describe("ScheduledMaintenance:ChangeStateToEnded", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    findAllBy.mockResolvedValue([] as never);
    changeState.mockResolvedValue(undefined as never);
    changeMonitors.mockResolvedValue(undefined as never);
    getInProgressQueries.mockResolvedValue([ONGOING_QUERY] as never);
    findEndedState.mockImplementation((async (args: unknown) => {
      const projectId: string = String(
        (args as { query: { projectId: unknown } }).query.projectId,
      );

      return projectId === PROJECT_A ? endedState(ENDED_STATE_A) : null;
    }) as never);
  });

  test("asks for the events by every query the in-progress rule names, each past its end", async () => {
    const ownStatesQuery: Record<string, unknown> = statesOfTheirOwnQuery([
      VERIFYING_STATE_A,
    ]);
    getInProgressQueries.mockResolvedValue([
      ONGOING_QUERY,
      ownStatesQuery,
    ] as never);

    await tick();

    expect(getInProgressQueries).toHaveBeenCalledTimes(1);

    const queries: Array<Record<string, unknown>> = queriesRead();

    expect(queries).toHaveLength(2);

    expect(queries[0]!["currentScheduledMaintenanceState"]).toEqual({
      isOngoingState: true,
    });
    expect(queries[1]!["currentScheduledMaintenanceStateId"]).toBe(
      ownStatesQuery["currentScheduledMaintenanceStateId"],
    );
    // A state of the project's own is asked for by its id, not by a flag.
    expect(queries[1]!["currentScheduledMaintenanceState"]).toBeUndefined();

    // Both only past their end time, measured against the same moment.
    const endBounds: Array<Array<unknown>> = queries.map(
      (query: Record<string, unknown>): Array<unknown> => {
        expect(query).toHaveProperty("endsAt");

        return Object.values(
          (
            query["endsAt"] as {
              objectLiteralParameters?: Record<string, unknown>;
            }
          ).objectLiteralParameters || {},
        );
      },
    );

    expect(endBounds[0]).toHaveLength(1);
    expect(endBounds[0]).toEqual(endBounds[1]);
  });

  test("an event in a state of the project's own between Ongoing and Ended is ended at its end time too", async () => {
    getInProgressQueries.mockResolvedValue([
      ONGOING_QUERY,
      statesOfTheirOwnQuery([VERIFYING_STATE_A]),
    ] as never);

    mockOverdueEvents({
      ongoing: [
        overdueEvent({
          id: "55555555-5555-4555-8555-555555555571",
          projectId: PROJECT_A,
        }),
      ],
      inStatesOfTheirOwn: [
        overdueEvent({
          id: "55555555-5555-4555-8555-555555555572",
          projectId: PROJECT_A,
          notifySubscribers: true,
        }),
      ],
    });

    await tick();

    expect(movedEventIds()).toEqual([
      "55555555-5555-4555-8555-555555555571",
      "55555555-5555-4555-8555-555555555572",
    ]);

    const verifyingMove: Record<string, unknown> = changeState.mock
      .calls[1]![0] as Record<string, unknown>;

    expect(String(verifyingMove["scheduledMaintenanceStateId"])).toBe(
      ENDED_STATE_A,
    );
    expect(verifyingMove["shouldNotifyStatusPageSubscribers"]).toBe(true);
    expect(changeMonitors).not.toHaveBeenCalled();
  });

  test("an event two queries find is ended once", async () => {
    getInProgressQueries.mockResolvedValue([
      ONGOING_QUERY,
      statesOfTheirOwnQuery([VERIFYING_STATE_A]),
    ] as never);

    const event: ScheduledMaintenance = overdueEvent({
      id: "55555555-5555-4555-8555-555555555573",
      projectId: PROJECT_A,
    });

    mockOverdueEvents({ ongoing: [event], inStatesOfTheirOwn: [event] });

    await tick();

    expect(movedEventIds()).toEqual(["55555555-5555-4555-8555-555555555573"]);
  });

  test("with no state of a project's own in progress anywhere, only the ongoing state is asked for", async () => {
    await tick();

    expect(queriesRead()).toHaveLength(1);
    expect(queriesRead()[0]!["currentScheduledMaintenanceState"]).toEqual({
      isOngoingState: true,
    });
  });

  test("reads the overdue events with only what the move needs", async () => {
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

    expect(read.select).toEqual({
      _id: true,
      projectId: true,
      shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded: true,
    });
    // Neither of them was ever used: the move reads its own.
    expect(read.select).not.toHaveProperty("changeMonitorStatusToId");
    expect(read.select).not.toHaveProperty("monitors");

    // Ongoing events whose end time has passed, across projects.
    expect(read.query["currentScheduledMaintenanceState"]).toEqual({
      isOngoingState: true,
    });
    expect(read.query).toHaveProperty("endsAt");
    expect(read.props).toEqual({ isRoot: true });
  });

  test("moves each overdue event into its project's ended state, and changes no monitor itself", async () => {
    findAllBy.mockResolvedValue([
      overdueEvent({
        id: "55555555-5555-4555-8555-555555555551",
        projectId: PROJECT_A,
        notifySubscribers: true,
      }),
      overdueEvent({
        id: "55555555-5555-4555-8555-555555555552",
        projectId: PROJECT_A,
        notifySubscribers: false,
      }),
    ] as never);

    await tick();

    expect(
      changeState.mock.calls.map(
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
      ),
    ).toEqual([
      {
        projectId: PROJECT_A,
        scheduledMaintenanceId: "55555555-5555-4555-8555-555555555551",
        scheduledMaintenanceStateId: ENDED_STATE_A,
        shouldNotifyStatusPageSubscribers: true,
        isSubscribersNotified: false,
        notifyOwners: true,
        props: { isRoot: true },
      },
      {
        projectId: PROJECT_A,
        scheduledMaintenanceId: "55555555-5555-4555-8555-555555555552",
        scheduledMaintenanceStateId: ENDED_STATE_A,
        shouldNotifyStatusPageSubscribers: false,
        isSubscribersNotified: false,
        notifyOwners: true,
        props: { isRoot: true },
      },
    ]);

    expect(changeMonitors).not.toHaveBeenCalled();
  });

  test("an event whose project has no ended state is left where it is", async () => {
    findAllBy.mockResolvedValue([
      overdueEvent({
        id: "55555555-5555-4555-8555-555555555554",
        projectId: PROJECT_B,
      }),
      overdueEvent({
        id: "55555555-5555-4555-8555-555555555555",
        projectId: PROJECT_A,
      }),
    ] as never);

    await tick();

    expect(findEndedState).toHaveBeenCalledTimes(2);
    expect(changeState).toHaveBeenCalledTimes(1);
    expect(
      String(
        (changeState.mock.calls[0]![0] as Record<string, unknown>)[
          "scheduledMaintenanceId"
        ],
      ),
    ).toBe("55555555-5555-4555-8555-555555555555");
  });

  test("looks the ended state up in each event's own project, as root", async () => {
    findAllBy.mockResolvedValue([
      overdueEvent({
        id: "55555555-5555-4555-8555-555555555556",
        projectId: PROJECT_A,
      }),
    ] as never);

    await tick();

    const lookup: {
      query: Record<string, unknown>;
      props: Record<string, unknown>;
    } = findEndedState.mock.calls[0]![0] as {
      query: Record<string, unknown>;
      props: Record<string, unknown>;
    };

    expect(String(lookup.query["projectId"])).toBe(PROJECT_A);
    expect(lookup.query["isEndedState"]).toBe(true);
    expect(lookup.props).toEqual({ isRoot: true });
  });
});
