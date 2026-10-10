import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "../../../Models/DatabaseModels/ScheduledMaintenanceState";
import ScheduledMaintenanceStateService from "../../../Server/Services/ScheduledMaintenanceStateService";
import Query from "../../../Server/Types/Database/Query";
import ObjectID from "../../../Types/ObjectID";
import {
  PROGRESS_PROJECT_ID,
  PROGRESS_STATE_KEYS,
  ProgressStateKey,
  eventMatchesStateQuery,
  idsOfCondition,
  makeProgressState,
  makeProgressStates,
  mockProgressStateReads,
  progressStateId,
  stateMatchesFlags,
} from "../TestingUtils/ScheduledMaintenanceProgressWorld";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * The state service turns the rest of the phase rule
 * (Common/Utils/ScheduledMaintenanceStart) into what a query asks for:
 *
 *   - waiting to start: the scheduled state, and every state of a
 *     project's own placed after Scheduled and before Ongoing
 *     ("Confirmed") - never one placed before Scheduled ("Draft", an
 *     approval step a person moves an event out of). What the start at an
 *     event's time (ChangeStateToOngoing), a status page's upcoming events
 *     and the Microsoft Teams app's scheduled events ask for. The start
 *     used to ask for the scheduled flag alone: an event moved on to
 *     "Confirmed" was never started.
 *   - not complete yet: every state but Completed and the states of the
 *     project's own after it ("Archived"). What the owners' reminders a
 *     rule change plans again, and the Microsoft Teams channels whose
 *     reactions become notes, ask for.
 *   - may be in progress: every state but the built-in scheduled, ended and
 *     completed ones - the read that leaves out, in the database, the
 *     events that cannot hold their monitors.
 */

const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "5a000000-0000-4000-8000-000000000002",
);
const BUILT_INS_ONLY_PROJECT_ID: ObjectID = new ObjectID(
  "5a000000-0000-4000-8000-000000000003",
);
const DRAFT_PROJECT_ID: ObjectID = new ObjectID(
  "5a000000-0000-4000-8000-000000000004",
);

const BUILT_IN_KEYS: Array<ProgressStateKey> = [
  "scheduled",
  "ongoing",
  "ended",
  "completed",
];

// The same list for another project, its ids its own.
function statesOf(
  projectId: ObjectID,
  keys: Array<ProgressStateKey> = PROGRESS_STATE_KEYS,
): Array<ScheduledMaintenanceState> {
  return keys.map((key: ProgressStateKey): ScheduledMaintenanceState => {
    const state: ScheduledMaintenanceState = makeProgressState(key, projectId);
    // "...-8000-...aN" becomes "...-8004-...aN" for project "...004".
    state._id = progressStateId(key)
      .toString()
      .replace("-8000-", `-8${projectId.toString().slice(-3)}-`);
    return state;
  });
}

/*
 * A project that put a state of its own before Scheduled: "Draft", where an
 * event waits for a person to approve it, not for its time.
 */
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

function idsOf(ids: Array<ObjectID>): Array<string> {
  return ids
    .map((id: ObjectID): string => {
      return id.toString().toLowerCase();
    })
    .sort();
}

function idsOfNamed(
  states: Array<ScheduledMaintenanceState>,
  names: Array<string>,
): Array<string> {
  return states
    .filter((state: ScheduledMaintenanceState): boolean => {
      return names.includes(state.name || "");
    })
    .map((state: ScheduledMaintenanceState): string => {
      return state._id!.toString().toLowerCase();
    })
    .sort();
}

// An event in each of `states`, read with its state.
function eventsInEveryState(
  states: Array<ScheduledMaintenanceState>,
): Array<ScheduledMaintenance> {
  return states.map(
    (state: ScheduledMaintenanceState): ScheduledMaintenance => {
      const event: ScheduledMaintenance = new ScheduledMaintenance();
      event._id = ObjectID.generate().toString();
      event.projectId = state.projectId!;
      event.title = `Event in ${state.name}`;
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

describe("ScheduledMaintenanceStateService: the states an event waits for its start time in", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("getWaitingToStartScheduledMaintenanceStateIds", () => {
    test("names the scheduled state and the project's own states between Scheduled and Ongoing", async () => {
      mockProgressStateReads();

      const ids: Array<ObjectID> =
        await ScheduledMaintenanceStateService.getWaitingToStartScheduledMaintenanceStateIds(
          PROGRESS_PROJECT_ID,
        );

      expect(idsOf(ids)).toEqual(
        idsOf([progressStateId("scheduled"), progressStateId("confirmed")]),
      );
    });

    test("never a state of the project's own placed before Scheduled: a draft waits for a person", async () => {
      const states: Array<ScheduledMaintenanceState> = [
        draftState(DRAFT_PROJECT_ID),
        ...statesOf(DRAFT_PROJECT_ID),
      ];

      mockProgressStateReads(states);

      const ids: Array<ObjectID> =
        await ScheduledMaintenanceStateService.getWaitingToStartScheduledMaintenanceStateIds(
          DRAFT_PROJECT_ID,
        );

      expect(idsOf(ids)).toEqual(
        idsOfNamed(states, ["Scheduled", "Confirmed"]),
      );
      expect(idsOf(ids)).not.toContain(
        draftState(DRAFT_PROJECT_ID)._id!.toString().toLowerCase(),
      );
    });

    test("only the project's own list: another project's states are not read into it", async () => {
      const otherStates: Array<ScheduledMaintenanceState> =
        statesOf(OTHER_PROJECT_ID);

      mockProgressStateReads([...makeProgressStates(), ...otherStates]);

      const ids: Array<ObjectID> =
        await ScheduledMaintenanceStateService.getWaitingToStartScheduledMaintenanceStateIds(
          OTHER_PROJECT_ID,
        );

      expect(idsOf(ids)).toEqual(
        idsOfNamed(otherStates, ["Scheduled", "Confirmed"]),
      );
    });

    test("a project with only the built-in states: its scheduled state alone", async () => {
      const builtIns: Array<ScheduledMaintenanceState> = statesOf(
        BUILT_INS_ONLY_PROJECT_ID,
        BUILT_IN_KEYS,
      );

      mockProgressStateReads(builtIns);

      const ids: Array<ObjectID> =
        await ScheduledMaintenanceStateService.getWaitingToStartScheduledMaintenanceStateIds(
          BUILT_INS_ONLY_PROJECT_ID,
        );

      expect(idsOf(ids)).toEqual(idsOfNamed(builtIns, ["Scheduled"]));
    });
  });

  describe("getWaitingToStartEventQueriesOfEveryProject", () => {
    test("with no state of a project's own anywhere, the scheduled state by its flag is the only query", async () => {
      mockProgressStateReads(
        statesOf(BUILT_INS_ONLY_PROJECT_ID, BUILT_IN_KEYS),
      );

      const queries: Array<Query<ScheduledMaintenance>> =
        await ScheduledMaintenanceStateService.getWaitingToStartEventQueriesOfEveryProject();

      expect(queries).toEqual([
        { currentScheduledMaintenanceState: { isScheduledState: true } },
      ]);
    });

    test("a project's own state between Scheduled and Ongoing is asked for by its id; its states anywhere else are not", async () => {
      mockProgressStateReads();

      const queries: Array<Query<ScheduledMaintenance>> =
        await ScheduledMaintenanceStateService.getWaitingToStartEventQueriesOfEveryProject();

      expect(queries).toHaveLength(2);
      expect(queries[0]).toEqual({
        currentScheduledMaintenanceState: { isScheduledState: true },
      });
      expect(
        idsOfCondition(
          (queries[1] as unknown as Record<string, unknown>)[
            "currentScheduledMaintenanceStateId"
          ],
        )!.sort(),
      ).toEqual([progressStateId("confirmed").toString().toLowerCase()]);
    });

    test("a draft placed before Scheduled is left out: nothing starts an event there at its time", async () => {
      const states: Array<ScheduledMaintenanceState> = [
        draftState(DRAFT_PROJECT_ID),
        ...statesOf(DRAFT_PROJECT_ID),
      ];

      mockProgressStateReads(states);

      const queries: Array<Query<ScheduledMaintenance>> =
        await ScheduledMaintenanceStateService.getWaitingToStartEventQueriesOfEveryProject();

      expect(
        idsOfCondition(
          (queries[1] as unknown as Record<string, unknown>)[
            "currentScheduledMaintenanceStateId"
          ],
        )!.sort(),
      ).toEqual(idsOfNamed(states, ["Confirmed"]));
    });

    test("every project's own waiting states are named, and only theirs", async () => {
      const otherStates: Array<ScheduledMaintenanceState> =
        statesOf(OTHER_PROJECT_ID);
      const builtIns: Array<ScheduledMaintenanceState> = statesOf(
        BUILT_INS_ONLY_PROJECT_ID,
        BUILT_IN_KEYS,
      );

      mockProgressStateReads([
        ...makeProgressStates(),
        ...otherStates,
        ...builtIns,
      ]);

      const queries: Array<Query<ScheduledMaintenance>> =
        await ScheduledMaintenanceStateService.getWaitingToStartEventQueriesOfEveryProject();

      expect(
        idsOfCondition(
          (queries[1] as unknown as Record<string, unknown>)[
            "currentScheduledMaintenanceStateId"
          ],
        )!.sort(),
      ).toEqual(
        [
          progressStateId("confirmed").toString().toLowerCase(),
          ...idsOfNamed(otherStates, ["Confirmed"]),
        ].sort(),
      );
    });

    test("a project whose own states all sit outside Scheduled..Ongoing adds no query", async () => {
      mockProgressStateReads([
        draftState(OTHER_PROJECT_ID),
        ...statesOf(OTHER_PROJECT_ID, [
          "scheduled",
          "ongoing",
          "verifying",
          "ended",
          "reviewing",
          "completed",
          "archived",
        ]),
      ]);

      const queries: Array<Query<ScheduledMaintenance>> =
        await ScheduledMaintenanceStateService.getWaitingToStartEventQueriesOfEveryProject();

      expect(queries).toEqual([
        { currentScheduledMaintenanceState: { isScheduledState: true } },
      ]);
    });

    test("together the queries find exactly the events waiting for their time, in every project", async () => {
      const projectStates: Array<ScheduledMaintenanceState> =
        makeProgressStates();
      const draftProjectStates: Array<ScheduledMaintenanceState> = [
        draftState(DRAFT_PROJECT_ID),
        ...statesOf(DRAFT_PROJECT_ID),
      ];

      mockProgressStateReads([...projectStates, ...draftProjectStates]);

      const queries: Array<Query<ScheduledMaintenance>> =
        await ScheduledMaintenanceStateService.getWaitingToStartEventQueriesOfEveryProject();

      const events: Array<ScheduledMaintenance> = [
        ...eventsInEveryState(projectStates),
        ...eventsInEveryState(draftProjectStates),
      ];

      // An event in Scheduled and one in Confirmed per project - no draft.
      expect(eventsFoundBy(queries, events)).toEqual([
        "Event in Confirmed",
        "Event in Confirmed",
        "Event in Scheduled",
        "Event in Scheduled",
      ]);
    });
  });
});

describe("ScheduledMaintenanceStateService: the states an event is not complete in yet", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("every state but Completed and the project's own states after it", async () => {
    mockProgressStateReads();

    const ids: Array<ObjectID> =
      await ScheduledMaintenanceStateService.getIncompleteScheduledMaintenanceStateIds(
        PROGRESS_PROJECT_ID,
      );

    expect(idsOf(ids)).toEqual(
      idsOf(
        PROGRESS_STATE_KEYS.filter((key: ProgressStateKey): boolean => {
          return key !== "completed" && key !== "archived";
        }).map((key: ProgressStateKey): ObjectID => {
          return progressStateId(key);
        }),
      ),
    );
  });

  test("Ended and a state of the project's own between Ended and Completed are over, but not complete", async () => {
    mockProgressStateReads();

    const ids: Array<string> = idsOf(
      await ScheduledMaintenanceStateService.getIncompleteScheduledMaintenanceStateIds(
        PROGRESS_PROJECT_ID,
      ),
    );

    expect(ids).toContain(progressStateId("ended").toString().toLowerCase());
    expect(ids).toContain(
      progressStateId("reviewing").toString().toLowerCase(),
    );
  });

  test("a draft placed before Scheduled is not complete either", async () => {
    const states: Array<ScheduledMaintenanceState> = [
      draftState(DRAFT_PROJECT_ID),
      ...statesOf(DRAFT_PROJECT_ID),
    ];

    mockProgressStateReads(states);

    const ids: Array<ObjectID> =
      await ScheduledMaintenanceStateService.getIncompleteScheduledMaintenanceStateIds(
        DRAFT_PROJECT_ID,
      );

    expect(idsOf(ids)).toEqual(
      idsOfNamed(states, [
        "Draft",
        "Scheduled",
        "Confirmed",
        "Ongoing",
        "Verifying",
        "Ended",
        "Reviewing",
      ]),
    );
  });

  test("only the project's own list", async () => {
    const otherStates: Array<ScheduledMaintenanceState> = statesOf(
      OTHER_PROJECT_ID,
      BUILT_IN_KEYS,
    );

    mockProgressStateReads([...makeProgressStates(), ...otherStates]);

    const ids: Array<ObjectID> =
      await ScheduledMaintenanceStateService.getIncompleteScheduledMaintenanceStateIds(
        OTHER_PROJECT_ID,
      );

    expect(idsOf(ids)).toEqual(
      idsOfNamed(otherStates, ["Scheduled", "Ongoing", "Ended"]),
    );
  });
});

describe("ScheduledMaintenanceStateService.getMayBeInProgressStateQuery", () => {
  test("leaves out the built-in scheduled, ended and completed states, and lets the ongoing state and every state of a project's own through", () => {
    const query: Record<string, unknown> =
      ScheduledMaintenanceStateService.getMayBeInProgressStateQuery() as Record<
        string,
        unknown
      >;

    const passing: Array<string> = [
      draftState(DRAFT_PROJECT_ID),
      ...makeProgressStates(),
    ]
      .filter((state: ScheduledMaintenanceState): boolean => {
        return stateMatchesFlags(state, query);
      })
      .map((state: ScheduledMaintenanceState): string => {
        return state.name || "";
      });

    expect(passing).toEqual([
      "Draft",
      "Confirmed",
      "Ongoing",
      "Verifying",
      "Reviewing",
      "Archived",
    ]);
  });

  test("never asks for a flag to be on: a state of a project's own carries none", () => {
    const query: Record<string, unknown> =
      ScheduledMaintenanceStateService.getMayBeInProgressStateQuery() as Record<
        string,
        unknown
      >;

    expect(Object.values(query)).not.toContain(true);
    expect(query).not.toHaveProperty("isOngoingState");
  });
});
