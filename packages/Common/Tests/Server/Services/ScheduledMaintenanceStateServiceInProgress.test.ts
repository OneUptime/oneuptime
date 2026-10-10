import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "../../../Models/DatabaseModels/ScheduledMaintenanceState";
import ScheduledMaintenanceStateService from "../../../Server/Services/ScheduledMaintenanceStateService";
import Query from "../../../Server/Types/Database/Query";
import ObjectID from "../../../Types/ObjectID";
import {
  IN_PROGRESS_KEYS,
  PROGRESS_PROJECT_ID,
  PROGRESS_STATE_KEYS,
  ProgressStateKey,
  eventMatchesStateQuery,
  idsOfCondition,
  makeEventInState,
  makeProgressState,
  makeProgressStates,
  mockProgressStateReads,
  progressStateId,
} from "../TestingUtils/ScheduledMaintenanceProgressWorld";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * The state service turns the in-progress rule
 * (Common/Utils/ScheduledMaintenanceStart) into what a query asks for: the
 * ongoing state, and every state of a project's own placed between Ongoing
 * and Ended ("Verifying") - never one placed before Ongoing ("Confirmed",
 * not started) or after Ended ("Reviewing", "Archived": over).
 *
 *   - getInProgressScheduledMaintenanceStateIds: one project's ids;
 *   - getInProgressEventQueriesOfEveryProject: every project at once, for
 *     the jobs (the end at an event's end time) - the ongoing states by
 *     their flag, the states of a project's own by their ids.
 *
 * (THE ongoing state, the one a start moves an event into, is
 * ScheduledMaintenanceStartUtil.getOngoingState, tested with the rule.)
 */

const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "5a000000-0000-4000-8000-000000000002",
);
const BUILT_INS_ONLY_PROJECT_ID: ObjectID = new ObjectID(
  "5a000000-0000-4000-8000-000000000003",
);

// The same list for another project, its ids its own.
function statesOf(
  projectId: ObjectID,
  keys: Array<ProgressStateKey> = PROGRESS_STATE_KEYS,
): Array<ScheduledMaintenanceState> {
  return keys.map((key: ProgressStateKey): ScheduledMaintenanceState => {
    const state: ScheduledMaintenanceState = makeProgressState(key, projectId);
    // "...-8000-...aN" becomes "...-8002-...aN" for project "...002".
    state._id = progressStateId(key)
      .toString()
      .replace("-8000-", `-8${projectId.toString().slice(-3)}-`);
    return state;
  });
}

function idsOf(ids: Array<ObjectID>): Array<string> {
  return ids
    .map((id: ObjectID): string => {
      return id.toString().toLowerCase();
    })
    .sort();
}

function stateIdsOf(
  states: Array<ScheduledMaintenanceState>,
  keys: Array<ProgressStateKey>,
): Array<string> {
  return states
    .filter((state: ScheduledMaintenanceState): boolean => {
      return keys.some((key: ProgressStateKey): boolean => {
        return state.name === makeProgressState(key).name;
      });
    })
    .map((state: ScheduledMaintenanceState): string => {
      return state._id!.toString().toLowerCase();
    })
    .sort();
}

// The events of `states`' project in each state, read with their state.
function eventsInEveryState(
  states: Array<ScheduledMaintenanceState>,
): Array<ScheduledMaintenance> {
  return states.map(
    (state: ScheduledMaintenanceState): ScheduledMaintenance => {
      const event: ScheduledMaintenance = makeEventInState("scheduled", {
        projectId: state.projectId!,
        title: `Event in ${state.name}`,
      });
      event.currentScheduledMaintenanceStateId = new ObjectID(
        state._id!.toString(),
      );
      event.currentScheduledMaintenanceState = state;
      return event;
    },
  );
}

// The events any of the queries would find, as the database would.
function eventsFoundBy(
  queries: Array<Query<ScheduledMaintenance>>,
  events: Array<ScheduledMaintenance>,
): Array<string> {
  return events
    .filter((event: ScheduledMaintenance): boolean => {
      return queries.some((query: Query<ScheduledMaintenance>): boolean => {
        return eventMatchesStateQuery(
          event,
          query as unknown as Record<string, unknown>,
        );
      });
    })
    .map((event: ScheduledMaintenance): string => {
      return event.title!;
    })
    .sort();
}

describe("ScheduledMaintenanceStateService: the states an event is in progress in", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("getInProgressScheduledMaintenanceStateIds", () => {
    test("names the ongoing state and the project's own states between Ongoing and Ended - nothing before Ongoing or after Ended", async () => {
      mockProgressStateReads();

      const ids: Array<ObjectID> =
        await ScheduledMaintenanceStateService.getInProgressScheduledMaintenanceStateIds(
          PROGRESS_PROJECT_ID,
        );

      expect(idsOf(ids)).toEqual(
        idsOf(
          IN_PROGRESS_KEYS.map((key: ProgressStateKey): ObjectID => {
            return progressStateId(key);
          }),
        ),
      );
    });

    test("only the project's own states: another project's list is not read into it", async () => {
      const otherStates: Array<ScheduledMaintenanceState> =
        statesOf(OTHER_PROJECT_ID);

      mockProgressStateReads([...makeProgressStates(), ...otherStates]);

      const ids: Array<ObjectID> =
        await ScheduledMaintenanceStateService.getInProgressScheduledMaintenanceStateIds(
          OTHER_PROJECT_ID,
        );

      expect(idsOf(ids)).toEqual(stateIdsOf(otherStates, IN_PROGRESS_KEYS));
    });

    test("a project with only the built-in states: its ongoing state alone", async () => {
      const builtIns: Array<ScheduledMaintenanceState> = statesOf(
        BUILT_INS_ONLY_PROJECT_ID,
        ["scheduled", "ongoing", "ended", "completed"],
      );

      mockProgressStateReads(builtIns);

      const ids: Array<ObjectID> =
        await ScheduledMaintenanceStateService.getInProgressScheduledMaintenanceStateIds(
          BUILT_INS_ONLY_PROJECT_ID,
        );

      expect(idsOf(ids)).toEqual(stateIdsOf(builtIns, ["ongoing"]));
    });

    test("the states are read as root, with their place and every flag", async () => {
      const reads: ReturnType<typeof mockProgressStateReads> =
        mockProgressStateReads();

      await ScheduledMaintenanceStateService.getInProgressScheduledMaintenanceStateIds(
        PROGRESS_PROJECT_ID,
      );

      const read: {
        select: Record<string, unknown>;
        props: Record<string, unknown>;
      } = reads.findBy.mock.calls[0]![0] as unknown as {
        select: Record<string, unknown>;
        props: Record<string, unknown>;
      };

      expect(read.props).toEqual({ isRoot: true });

      for (const column of [
        "_id",
        "order",
        "isScheduledState",
        "isOngoingState",
        "isEndedState",
        "isResolvedState",
      ]) {
        expect(read.select[column]).toBe(true);
      }
    });
  });

  describe("getInProgressEventQueriesOfEveryProject", () => {
    test("with no state of a project's own anywhere, the ongoing state by its flag is the only query", async () => {
      mockProgressStateReads(
        statesOf(BUILT_INS_ONLY_PROJECT_ID, [
          "scheduled",
          "ongoing",
          "ended",
          "completed",
        ]),
      );

      const queries: Array<Query<ScheduledMaintenance>> =
        await ScheduledMaintenanceStateService.getInProgressEventQueriesOfEveryProject();

      expect(queries).toEqual([
        { currentScheduledMaintenanceState: { isOngoingState: true } },
      ]);
    });

    test("a project's own state between Ongoing and Ended is asked for by its id; its states before Ongoing and after Ended are not", async () => {
      mockProgressStateReads();

      const queries: Array<Query<ScheduledMaintenance>> =
        await ScheduledMaintenanceStateService.getInProgressEventQueriesOfEveryProject();

      expect(queries).toHaveLength(2);
      expect(queries[0]).toEqual({
        currentScheduledMaintenanceState: { isOngoingState: true },
      });
      expect(
        idsOfCondition(
          (queries[1] as unknown as Record<string, unknown>)[
            "currentScheduledMaintenanceStateId"
          ],
        )!.sort(),
      ).toEqual([progressStateId("verifying").toString().toLowerCase()]);
    });

    test("every project's own in-progress states are named, and only theirs", async () => {
      const otherStates: Array<ScheduledMaintenanceState> =
        statesOf(OTHER_PROJECT_ID);
      const builtIns: Array<ScheduledMaintenanceState> = statesOf(
        BUILT_INS_ONLY_PROJECT_ID,
        ["scheduled", "ongoing", "ended", "completed"],
      );

      mockProgressStateReads([
        ...makeProgressStates(),
        ...otherStates,
        ...builtIns,
      ]);

      const queries: Array<Query<ScheduledMaintenance>> =
        await ScheduledMaintenanceStateService.getInProgressEventQueriesOfEveryProject();

      expect(
        idsOfCondition(
          (queries[1] as unknown as Record<string, unknown>)[
            "currentScheduledMaintenanceStateId"
          ],
        )!.sort(),
      ).toEqual(
        [
          progressStateId("verifying").toString().toLowerCase(),
          ...stateIdsOf(otherStates, ["verifying"]),
        ].sort(),
      );
    });

    test("a project whose own states all sit outside Ongoing..Ended adds no query", async () => {
      mockProgressStateReads(
        statesOf(OTHER_PROJECT_ID, [
          "scheduled",
          "confirmed",
          "ongoing",
          "ended",
          "reviewing",
          "completed",
          "archived",
        ]),
      );

      const queries: Array<Query<ScheduledMaintenance>> =
        await ScheduledMaintenanceStateService.getInProgressEventQueriesOfEveryProject();

      expect(queries).toEqual([
        { currentScheduledMaintenanceState: { isOngoingState: true } },
      ]);
    });

    test("together the queries find exactly the events in progress, in every project", async () => {
      const otherStates: Array<ScheduledMaintenanceState> =
        statesOf(OTHER_PROJECT_ID);
      const projectStates: Array<ScheduledMaintenanceState> =
        makeProgressStates();

      mockProgressStateReads([...projectStates, ...otherStates]);

      const queries: Array<Query<ScheduledMaintenance>> =
        await ScheduledMaintenanceStateService.getInProgressEventQueriesOfEveryProject();

      const events: Array<ScheduledMaintenance> = [
        ...eventsInEveryState(projectStates),
        ...eventsInEveryState(otherStates),
      ];

      // Two events in Ongoing and two in Verifying: one of each per project.
      expect(eventsFoundBy(queries, events)).toEqual([
        "Event in Ongoing",
        "Event in Ongoing",
        "Event in Verifying",
        "Event in Verifying",
      ]);
    });

    test("the states that are none of the four kinds are what it reads first, as root", async () => {
      mockProgressStateReads();

      // The spy the stand-in already put on it.
      const findAllBy: SpyInstance<
        typeof ScheduledMaintenanceStateService.findAllBy
      > = jest.spyOn(
        ScheduledMaintenanceStateService,
        "findAllBy",
      ) as unknown as SpyInstance<
        typeof ScheduledMaintenanceStateService.findAllBy
      >;

      await ScheduledMaintenanceStateService.getInProgressEventQueriesOfEveryProject();

      const firstRead: {
        query: Record<string, unknown>;
        props: Record<string, unknown>;
      } = findAllBy.mock.calls[0]![0] as unknown as {
        query: Record<string, unknown>;
        props: Record<string, unknown>;
      };

      expect(firstRead.query).toEqual({
        isScheduledState: false,
        isOngoingState: false,
        isEndedState: false,
        isResolvedState: false,
      });
      expect(firstRead.props).toEqual({ isRoot: true });
    });
  });
});
