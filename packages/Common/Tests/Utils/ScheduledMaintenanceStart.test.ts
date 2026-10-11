import ScheduledMaintenanceState from "../../Models/DatabaseModels/ScheduledMaintenanceState";
import ObjectID from "../../Types/ObjectID";
import ScheduledMaintenanceStartUtil from "../../Utils/ScheduledMaintenanceStart";
import { describe, expect, test } from "@jest/globals";

/*
 * Whether a scheduled maintenance event has started - the one rule the
 * server refuses a change to an event's Change Monitor Status to by, and the
 * dashboard shows the field read-only by (Common/Utils/
 * ScheduledMaintenanceStart).
 *
 * An event walks its project's states in their order: scheduled, ongoing,
 * ended, completed, with states the project added itself in between. It has
 * started once it is in the ongoing state or any state after it, or in a
 * state flagged ongoing, ended or completed.
 */

type Kind = "scheduled" | "ongoing" | "ended" | "completed" | "custom";

interface StateSpec {
  id: string;
  name: string;
  order: number | null;
  kind: Kind;
}

// A project that added "Confirmed" before Ongoing and "Verifying" after it.
const SCHEDULED: StateSpec = {
  id: "aaaaaaaa-0000-4000-8000-000000000001",
  name: "Scheduled",
  order: 1,
  kind: "scheduled",
};
const CONFIRMED: StateSpec = {
  id: "aaaaaaaa-0000-4000-8000-000000000002",
  name: "Confirmed",
  order: 2,
  kind: "custom",
};
const ONGOING: StateSpec = {
  id: "aaaaaaaa-0000-4000-8000-000000000003",
  name: "Ongoing",
  order: 3,
  kind: "ongoing",
};
const VERIFYING: StateSpec = {
  id: "aaaaaaaa-0000-4000-8000-000000000004",
  name: "Verifying",
  order: 4,
  kind: "custom",
};
const ENDED: StateSpec = {
  id: "aaaaaaaa-0000-4000-8000-000000000005",
  name: "Ended",
  order: 5,
  kind: "ended",
};
const COMPLETED: StateSpec = {
  id: "aaaaaaaa-0000-4000-8000-000000000006",
  name: "Completed",
  order: 6,
  kind: "completed",
};
// A state of the project's own placed after Completed.
const ARCHIVED: StateSpec = {
  id: "aaaaaaaa-0000-4000-8000-000000000007",
  name: "Archived",
  order: 7,
  kind: "custom",
};

const PROJECT_STATES: Array<StateSpec> = [
  SCHEDULED,
  CONFIRMED,
  ONGOING,
  VERIFYING,
  ENDED,
  COMPLETED,
  ARCHIVED,
];

function model(spec: StateSpec): ScheduledMaintenanceState {
  const state: ScheduledMaintenanceState = new ScheduledMaintenanceState();
  state._id = spec.id;
  state.name = spec.name;

  if (spec.order !== null) {
    state.order = spec.order;
  }

  state.isScheduledState = spec.kind === "scheduled";
  state.isOngoingState = spec.kind === "ongoing";
  state.isEndedState = spec.kind === "ended";
  state.isResolvedState = spec.kind === "completed";

  return state;
}

// The same state as the API's JSON for it.
function json(spec: StateSpec): Record<string, unknown> {
  return {
    _id: spec.id,
    name: spec.name,
    order: spec.order,
    isScheduledState: spec.kind === "scheduled",
    isOngoingState: spec.kind === "ongoing",
    isEndedState: spec.kind === "ended",
    isResolvedState: spec.kind === "completed",
  };
}

const STATE_MODELS: Array<ScheduledMaintenanceState> = PROJECT_STATES.map(
  (spec: StateSpec): ScheduledMaintenanceState => {
    return model(spec);
  },
);

describe("ScheduledMaintenanceStartUtil.hasStartedByFlags", () => {
  test.each([
    ["Ongoing", ONGOING, true],
    ["Ended", ENDED, true],
    ["Completed", COMPLETED, true],
    ["Scheduled", SCHEDULED, false],
  ] as Array<[string, StateSpec, boolean]>)(
    "%s answers from its own flag",
    (_name: string, spec: StateSpec, started: boolean) => {
      expect(ScheduledMaintenanceStartUtil.hasStartedByFlags(model(spec))).toBe(
        started,
      );
      expect(ScheduledMaintenanceStartUtil.hasStartedByFlags(json(spec))).toBe(
        started,
      );
    },
  );

  test("a state of the project's own cannot tell by itself: its place decides", () => {
    for (const spec of [CONFIRMED, VERIFYING, ARCHIVED]) {
      expect(
        ScheduledMaintenanceStartUtil.hasStartedByFlags(model(spec)),
      ).toBeNull();
    }
  });

  test("nothing to read answers nothing", () => {
    expect(ScheduledMaintenanceStartUtil.hasStartedByFlags(undefined)).toBe(
      null,
    );
    expect(ScheduledMaintenanceStartUtil.hasStartedByFlags(null)).toBe(null);
    expect(ScheduledMaintenanceStartUtil.hasStartedByFlags("ongoing")).toBe(
      null,
    );
  });

  test("a state flagged both scheduled and ongoing counts as started: the start wins", () => {
    expect(
      ScheduledMaintenanceStartUtil.hasStartedByFlags({
        _id: SCHEDULED.id,
        isScheduledState: true,
        isOngoingState: true,
      }),
    ).toBe(true);
  });
});

describe("ScheduledMaintenanceStartUtil.hasStarted", () => {
  test.each([
    ["Scheduled", SCHEDULED, false],
    ["Confirmed (the project's own, before Ongoing)", CONFIRMED, false],
    ["Ongoing", ONGOING, true],
    ["Verifying (the project's own, after Ongoing)", VERIFYING, true],
    ["Ended", ENDED, true],
    ["Completed", COMPLETED, true],
    ["Archived (the project's own, after Completed)", ARCHIVED, true],
  ] as Array<[string, StateSpec, boolean]>)(
    "an event in %s has started: %s",
    (_name: string, spec: StateSpec, started: boolean) => {
      expect(
        ScheduledMaintenanceStartUtil.hasStarted({
          states: STATE_MODELS,
          state: model(spec),
        }),
      ).toBe(started);
    },
  );

  test("reads the API's JSON as it reads models", () => {
    const states: Array<Record<string, unknown>> = PROJECT_STATES.map(json);

    expect(
      ScheduledMaintenanceStartUtil.hasStarted({
        states: states,
        state: json(CONFIRMED),
      }),
    ).toBe(false);
    expect(
      ScheduledMaintenanceStartUtil.hasStarted({
        states: states,
        state: json(VERIFYING),
      }),
    ).toBe(true);
  });

  test("a state the event was read with no place or flags for is placed where the project's list puts it", () => {
    // The event's relation read with its id only, as a bare reference.
    const bareVerifying: ScheduledMaintenanceState =
      new ScheduledMaintenanceState();
    bareVerifying._id = VERIFYING.id;

    const bareConfirmed: ScheduledMaintenanceState =
      new ScheduledMaintenanceState();
    bareConfirmed._id = CONFIRMED.id;

    expect(
      ScheduledMaintenanceStartUtil.hasStarted({
        states: STATE_MODELS,
        state: bareVerifying,
      }),
    ).toBe(true);
    expect(
      ScheduledMaintenanceStartUtil.hasStarted({
        states: STATE_MODELS,
        state: bareConfirmed,
      }),
    ).toBe(false);
  });

  test("the list's copy of a built-in state decides too, flag and all", () => {
    const bareOngoing: Record<string, unknown> = { _id: ONGOING.id };
    const bareScheduled: Record<string, unknown> = { _id: SCHEDULED.id };

    expect(
      ScheduledMaintenanceStartUtil.hasStarted({
        states: STATE_MODELS,
        state: bareOngoing,
      }),
    ).toBe(true);
    expect(
      ScheduledMaintenanceStartUtil.hasStarted({
        states: STATE_MODELS,
        state: bareScheduled,
      }),
    ).toBe(false);
  });

  test("ids are matched whatever their case or padding", () => {
    expect(
      ScheduledMaintenanceStartUtil.hasStarted({
        states: STATE_MODELS,
        state: { _id: `  ${VERIFYING.id.toUpperCase()} ` },
      }),
    ).toBe(true);
  });

  test("an ObjectID-typed id is read like a plain one", () => {
    expect(
      ScheduledMaintenanceStartUtil.hasStarted({
        states: STATE_MODELS,
        state: { _id: new ObjectID(VERIFYING.id) },
      }),
    ).toBe(true);
  });

  test("a state the list does not hold is placed by its own place", () => {
    const betweenOngoingAndEnded: Record<string, unknown> = {
      _id: "aaaaaaaa-0000-4000-8000-0000000000aa",
      order: 4.5,
    };
    const beforeOngoing: Record<string, unknown> = {
      _id: "aaaaaaaa-0000-4000-8000-0000000000ab",
      order: 2.5,
    };

    expect(
      ScheduledMaintenanceStartUtil.hasStarted({
        states: STATE_MODELS,
        state: betweenOngoingAndEnded,
      }),
    ).toBe(true);
    expect(
      ScheduledMaintenanceStartUtil.hasStarted({
        states: STATE_MODELS,
        state: beforeOngoing,
      }),
    ).toBe(false);
  });

  test("a state that is none of the project's and has no place has not started: nothing says it has", () => {
    expect(
      ScheduledMaintenanceStartUtil.hasStarted({
        states: STATE_MODELS,
        state: { _id: "aaaaaaaa-0000-4000-8000-0000000000ac" },
      }),
    ).toBe(false);
  });

  test("with no list to read, the built-in states still answer by their flags", () => {
    expect(
      ScheduledMaintenanceStartUtil.hasStarted({
        states: [],
        state: model(ONGOING),
      }),
    ).toBe(true);
    expect(
      ScheduledMaintenanceStartUtil.hasStarted({
        states: [],
        state: model(SCHEDULED),
      }),
    ).toBe(false);
    // A state of the project's own cannot be placed without the list.
    expect(
      ScheduledMaintenanceStartUtil.hasStarted({
        states: [],
        state: model(VERIFYING),
      }),
    ).toBe(false);
  });

  test("no state has not started", () => {
    expect(
      ScheduledMaintenanceStartUtil.hasStarted({
        states: STATE_MODELS,
        state: undefined,
      }),
    ).toBe(false);
    expect(
      ScheduledMaintenanceStartUtil.hasStarted({
        states: STATE_MODELS,
        state: null,
      }),
    ).toBe(false);
  });

  test("the list is read in its order, however it arrives", () => {
    const shuffled: Array<ScheduledMaintenanceState> = [
      ...STATE_MODELS,
    ].reverse();

    expect(
      ScheduledMaintenanceStartUtil.hasStarted({
        states: shuffled,
        state: model(CONFIRMED),
      }),
    ).toBe(false);
    expect(
      ScheduledMaintenanceStartUtil.hasStarted({
        states: shuffled,
        state: model(VERIFYING),
      }),
    ).toBe(true);
  });

  test("a project whose own state was dragged before Scheduled has not started there", () => {
    const draft: StateSpec = {
      id: "aaaaaaaa-0000-4000-8000-0000000000ad",
      name: "Draft",
      order: 0,
      kind: "custom",
    };

    expect(
      ScheduledMaintenanceStartUtil.hasStarted({
        states: [model(draft), ...STATE_MODELS],
        state: model(draft),
      }),
    ).toBe(false);
  });

  test("empty entries in the list are skipped", () => {
    expect(
      ScheduledMaintenanceStartUtil.hasStarted({
        states: [null, undefined, "x", ...STATE_MODELS],
        state: model(VERIFYING),
      }),
    ).toBe(true);
  });
});

/*
 * Whether an event is in progress - started and not yet ended: where it
 * holds its monitors, paused in its Change Monitor Status to. Ongoing, or a
 * state of the project's own placed between Ongoing and Ended. A move into
 * one of them from a state where the event had not started is its start
 * (ScheduledMaintenanceStateTimelineService).
 */
describe("ScheduledMaintenanceStartUtil.isInProgressByFlags", () => {
  test.each([
    ["Ongoing", ONGOING, true],
    ["Scheduled", SCHEDULED, false],
    ["Ended", ENDED, false],
    ["Completed", COMPLETED, false],
  ] as Array<[string, StateSpec, boolean]>)(
    "%s answers from its own flag",
    (_name: string, spec: StateSpec, inProgress: boolean) => {
      expect(
        ScheduledMaintenanceStartUtil.isInProgressByFlags(model(spec)),
      ).toBe(inProgress);
      expect(
        ScheduledMaintenanceStartUtil.isInProgressByFlags(json(spec)),
      ).toBe(inProgress);
    },
  );

  test("a state of the project's own cannot tell by itself: its place decides", () => {
    for (const spec of [CONFIRMED, VERIFYING, ARCHIVED]) {
      expect(
        ScheduledMaintenanceStartUtil.isInProgressByFlags(model(spec)),
      ).toBeNull();
    }
  });

  test("nothing to read answers nothing", () => {
    expect(ScheduledMaintenanceStartUtil.isInProgressByFlags(undefined)).toBe(
      null,
    );
    expect(ScheduledMaintenanceStartUtil.isInProgressByFlags(null)).toBe(null);
    expect(ScheduledMaintenanceStartUtil.isInProgressByFlags("ongoing")).toBe(
      null,
    );
  });
});

describe("ScheduledMaintenanceStartUtil.isInProgress", () => {
  test.each([
    ["Scheduled", SCHEDULED, false],
    ["Confirmed (the project's own, before Ongoing)", CONFIRMED, false],
    ["Ongoing", ONGOING, true],
    ["Verifying (the project's own, after Ongoing)", VERIFYING, true],
    ["Ended", ENDED, false],
    ["Completed", COMPLETED, false],
    ["Archived (the project's own, after Completed)", ARCHIVED, false],
  ] as Array<[string, StateSpec, boolean]>)(
    "an event in %s is in progress: %s",
    (_name: string, spec: StateSpec, inProgress: boolean) => {
      expect(
        ScheduledMaintenanceStartUtil.isInProgress({
          states: STATE_MODELS,
          state: model(spec),
        }),
      ).toBe(inProgress);
      expect(
        ScheduledMaintenanceStartUtil.isInProgress({
          states: PROJECT_STATES.map(json),
          state: json(spec),
        }),
      ).toBe(inProgress);
    },
  );

  test("a state of the project's own between Ended and Completed is over, not in progress", () => {
    const reviewing: StateSpec = {
      id: "aaaaaaaa-0000-4000-8000-0000000000ae",
      name: "Reviewing",
      order: 5.5,
      kind: "custom",
    };

    expect(
      ScheduledMaintenanceStartUtil.isInProgress({
        states: [...STATE_MODELS, model(reviewing)],
        state: model(reviewing),
      }),
    ).toBe(false);
    // It has started all the same.
    expect(
      ScheduledMaintenanceStartUtil.hasStarted({
        states: [...STATE_MODELS, model(reviewing)],
        state: model(reviewing),
      }),
    ).toBe(true);
  });

  test("a state read with no place or flags is placed where the project's list puts it", () => {
    expect(
      ScheduledMaintenanceStartUtil.isInProgress({
        states: STATE_MODELS,
        state: { _id: VERIFYING.id },
      }),
    ).toBe(true);
    expect(
      ScheduledMaintenanceStartUtil.isInProgress({
        states: STATE_MODELS,
        state: { _id: ` ${CONFIRMED.id.toUpperCase()}` },
      }),
    ).toBe(false);
    // The list's copy of a built-in state answers by its flag.
    expect(
      ScheduledMaintenanceStartUtil.isInProgress({
        states: STATE_MODELS,
        state: { _id: new ObjectID(ONGOING.id) },
      }),
    ).toBe(true);
    expect(
      ScheduledMaintenanceStartUtil.isInProgress({
        states: STATE_MODELS,
        state: { _id: ENDED.id },
      }),
    ).toBe(false);
  });

  test("a state the list does not hold is placed by its own place", () => {
    expect(
      ScheduledMaintenanceStartUtil.isInProgress({
        states: STATE_MODELS,
        state: { _id: "aaaaaaaa-0000-4000-8000-0000000000af", order: 4.5 },
      }),
    ).toBe(true);
    expect(
      ScheduledMaintenanceStartUtil.isInProgress({
        states: STATE_MODELS,
        state: { _id: "aaaaaaaa-0000-4000-8000-0000000000b0", order: 2.5 },
      }),
    ).toBe(false);
  });

  test("a state that cannot be placed is not in progress: nothing says it is", () => {
    expect(
      ScheduledMaintenanceStartUtil.isInProgress({
        states: STATE_MODELS,
        state: { _id: "aaaaaaaa-0000-4000-8000-0000000000b1" },
      }),
    ).toBe(false);
    expect(
      ScheduledMaintenanceStartUtil.isInProgress({
        states: [],
        state: model(VERIFYING),
      }),
    ).toBe(false);
    expect(
      ScheduledMaintenanceStartUtil.isInProgress({
        states: STATE_MODELS,
        state: undefined,
      }),
    ).toBe(false);
  });

  test("with no list to read, Ongoing is still in progress", () => {
    expect(
      ScheduledMaintenanceStartUtil.isInProgress({
        states: [],
        state: model(ONGOING),
      }),
    ).toBe(true);
  });

  test("the list is read in its order, however it arrives", () => {
    expect(
      ScheduledMaintenanceStartUtil.isInProgress({
        states: [...STATE_MODELS].reverse(),
        state: model(VERIFYING),
      }),
    ).toBe(true);
  });
});

/*
 * THE ongoing state: the one the start at an event's time and the chats'
 * Mark as Ongoing move an event into - not every state it is in progress in.
 */
describe("ScheduledMaintenanceStartUtil.getOngoingState", () => {
  test("is the state flagged ongoing, not a state of the project's own after it", () => {
    const state: ScheduledMaintenanceState | null =
      ScheduledMaintenanceStartUtil.getOngoingState({ states: STATE_MODELS });

    expect(state?._id?.toString()).toBe(ONGOING.id);
  });

  test("is the first from the top flagged ongoing, whatever order the rows come in", () => {
    const secondOngoing: ScheduledMaintenanceState = model({
      id: "aaaaaaaa-0000-4000-8000-000000000009",
      name: "Ongoing again",
      order: 9,
      kind: "ongoing",
    });

    const state: ScheduledMaintenanceState | null =
      ScheduledMaintenanceStartUtil.getOngoingState({
        states: [secondOngoing, ...[...STATE_MODELS].reverse()],
      });

    expect(state?._id?.toString()).toBe(ONGOING.id);
  });

  test("reads the API's JSON for the states as well", () => {
    const state: Record<string, unknown> | null =
      ScheduledMaintenanceStartUtil.getOngoingState({
        states: PROJECT_STATES.map(json),
      });

    expect(state?.["_id"]).toBe(ONGOING.id);
  });

  test("is none in a project without one", () => {
    expect(
      ScheduledMaintenanceStartUtil.getOngoingState({
        states: [model(SCHEDULED), model(ENDED), model(COMPLETED)],
      }),
    ).toBeNull();
    expect(
      ScheduledMaintenanceStartUtil.getOngoingState({ states: [] }),
    ).toBeNull();
  });
});

/*
 * A project's whole list with a state of its own in every gap: "Draft" before
 * Scheduled (an approval step a person moves an event out of), "Confirmed"
 * between Scheduled and Ongoing, "Verifying" between Ongoing and Ended,
 * "Reviewing" between Ended and Completed and "Archived" after Completed.
 */
const DRAFT: StateSpec = {
  id: "aaaaaaaa-0000-4000-8000-000000000010",
  name: "Draft",
  order: 1,
  kind: "custom",
};
const REVIEWING: StateSpec = {
  id: "aaaaaaaa-0000-4000-8000-000000000011",
  name: "Reviewing",
  order: 7,
  kind: "custom",
};

const FULL_LIST: Array<StateSpec> = [
  DRAFT,
  { ...SCHEDULED, order: 2 },
  { ...CONFIRMED, order: 3 },
  { ...ONGOING, order: 4 },
  { ...VERIFYING, order: 5 },
  { ...ENDED, order: 6 },
  REVIEWING,
  { ...COMPLETED, order: 8 },
  { ...ARCHIVED, order: 9 },
];

const FULL_MODELS: Array<ScheduledMaintenanceState> = FULL_LIST.map(
  (spec: StateSpec): ScheduledMaintenanceState => {
    return model(spec);
  },
);

// The full list's copy of a state, by its name.
function placed(name: string): StateSpec {
  const spec: StateSpec | undefined = FULL_LIST.find(
    (candidate: StateSpec): boolean => {
      return candidate.name === name;
    },
  );

  if (!spec) {
    throw new Error(`No state named ${name}`);
  }

  return spec;
}

/*
 * A state of the project's own carries none of the four flags: only its
 * place tells what an event in it is.
 */
describe("ScheduledMaintenanceStartUtil.isStateOfItsOwn", () => {
  test("the four built-in states are not, by their flags", () => {
    for (const spec of [SCHEDULED, ONGOING, ENDED, COMPLETED]) {
      expect(ScheduledMaintenanceStartUtil.isStateOfItsOwn(model(spec))).toBe(
        false,
      );
      expect(ScheduledMaintenanceStartUtil.isStateOfItsOwn(json(spec))).toBe(
        false,
      );
    }
  });

  test("a state with none of the flags is", () => {
    for (const spec of [DRAFT, CONFIRMED, VERIFYING, REVIEWING, ARCHIVED]) {
      expect(ScheduledMaintenanceStartUtil.isStateOfItsOwn(model(spec))).toBe(
        true,
      );
      expect(ScheduledMaintenanceStartUtil.isStateOfItsOwn(json(spec))).toBe(
        true,
      );
    }
  });

  test("nothing to read is no state at all", () => {
    expect(ScheduledMaintenanceStartUtil.isStateOfItsOwn(undefined)).toBe(
      false,
    );
    expect(ScheduledMaintenanceStartUtil.isStateOfItsOwn(null)).toBe(false);
    expect(ScheduledMaintenanceStartUtil.isStateOfItsOwn("Confirmed")).toBe(
      false,
    );
  });
});

describe("ScheduledMaintenanceStartUtil.isWaitingToStartByFlags", () => {
  test.each([
    ["Scheduled", SCHEDULED, true],
    ["Ongoing", ONGOING, false],
    ["Ended", ENDED, false],
    ["Completed", COMPLETED, false],
  ] as Array<[string, StateSpec, boolean]>)(
    "%s answers from its own flag",
    (_name: string, spec: StateSpec, waiting: boolean) => {
      expect(
        ScheduledMaintenanceStartUtil.isWaitingToStartByFlags(model(spec)),
      ).toBe(waiting);
      expect(
        ScheduledMaintenanceStartUtil.isWaitingToStartByFlags(json(spec)),
      ).toBe(waiting);
    },
  );

  test("a state of the project's own cannot tell by itself: its place decides", () => {
    for (const spec of [DRAFT, CONFIRMED, VERIFYING]) {
      expect(
        ScheduledMaintenanceStartUtil.isWaitingToStartByFlags(model(spec)),
      ).toBeNull();
    }
  });

  test("a state flagged both scheduled and ongoing has started: it waits for nothing", () => {
    expect(
      ScheduledMaintenanceStartUtil.isWaitingToStartByFlags({
        _id: SCHEDULED.id,
        isScheduledState: true,
        isOngoingState: true,
      }),
    ).toBe(false);
  });

  test("nothing to read answers nothing", () => {
    expect(
      ScheduledMaintenanceStartUtil.isWaitingToStartByFlags(undefined),
    ).toBeNull();
    expect(
      ScheduledMaintenanceStartUtil.isWaitingToStartByFlags(null),
    ).toBeNull();
  });
});

/*
 * Whether an event waits for its Starts At: what the clock starts at that
 * time (ChangeStateToOngoing) and what a status page and the Microsoft
 * Teams app list as upcoming. Scheduled, and a state of the project's own
 * between Scheduled and Ongoing - "Confirmed" used to be left where it was
 * at its start time, and dropped from every upcoming list. A state placed
 * before Scheduled - "Draft" - has not started either, but waits for a
 * person, not the clock.
 */
describe("ScheduledMaintenanceStartUtil.isWaitingToStart", () => {
  test.each([
    ["Draft (the project's own, before Scheduled)", "Draft", false],
    ["Scheduled", "Scheduled", true],
    ["Confirmed (the project's own, before Ongoing)", "Confirmed", true],
    ["Ongoing", "Ongoing", false],
    ["Verifying (the project's own, after Ongoing)", "Verifying", false],
    ["Ended", "Ended", false],
    ["Reviewing (the project's own, after Ended)", "Reviewing", false],
    ["Completed", "Completed", false],
    ["Archived (the project's own, after Completed)", "Archived", false],
  ] as Array<[string, string, boolean]>)(
    "an event in %s waits for its start time: %s",
    (_label: string, name: string, waiting: boolean) => {
      expect(
        ScheduledMaintenanceStartUtil.isWaitingToStart({
          states: FULL_MODELS,
          state: model(placed(name)),
        }),
      ).toBe(waiting);
      expect(
        ScheduledMaintenanceStartUtil.isWaitingToStart({
          states: FULL_LIST.map(json),
          state: json(placed(name)),
        }),
      ).toBe(waiting);
    },
  );

  test("a state read with its id only is placed where the project's list puts it", () => {
    expect(
      ScheduledMaintenanceStartUtil.isWaitingToStart({
        states: FULL_MODELS,
        state: { _id: CONFIRMED.id },
      }),
    ).toBe(true);
    expect(
      ScheduledMaintenanceStartUtil.isWaitingToStart({
        states: FULL_MODELS,
        state: { _id: DRAFT.id },
      }),
    ).toBe(false);
    expect(
      ScheduledMaintenanceStartUtil.isWaitingToStart({
        states: FULL_MODELS,
        state: { _id: SCHEDULED.id },
      }),
    ).toBe(true);
    expect(
      ScheduledMaintenanceStartUtil.isWaitingToStart({
        states: FULL_MODELS,
        state: { _id: ONGOING.id },
      }),
    ).toBe(false);
  });

  test("a state the list does not hold is placed by its own place", () => {
    const betweenScheduledAndOngoing: Record<string, unknown> = {
      _id: "aaaaaaaa-0000-4000-8000-0000000000b1",
      order: 3,
    };

    expect(
      ScheduledMaintenanceStartUtil.isWaitingToStart({
        states: FULL_MODELS.filter(
          (state: ScheduledMaintenanceState): boolean => {
            return state._id?.toString() !== CONFIRMED.id;
          },
        ),
        state: betweenScheduledAndOngoing,
      }),
    ).toBe(true);
  });

  test("a state that cannot be placed waits for nothing: nothing says it does", () => {
    expect(
      ScheduledMaintenanceStartUtil.isWaitingToStart({
        states: FULL_MODELS,
        state: { _id: "aaaaaaaa-0000-4000-8000-0000000000b2" },
      }),
    ).toBe(false);
    expect(
      ScheduledMaintenanceStartUtil.isWaitingToStart({
        states: FULL_MODELS,
        state: undefined,
      }),
    ).toBe(false);
  });

  test("with no list to read, Scheduled still waits by its flag; a state of the project's own cannot be placed", () => {
    expect(
      ScheduledMaintenanceStartUtil.isWaitingToStart({
        states: [],
        state: model(SCHEDULED),
      }),
    ).toBe(true);
    expect(
      ScheduledMaintenanceStartUtil.isWaitingToStart({
        states: [],
        state: model(CONFIRMED),
      }),
    ).toBe(false);
  });

  test("the list is read in its order, however it arrives", () => {
    const shuffled: Array<ScheduledMaintenanceState> = [
      ...FULL_MODELS,
    ].reverse();

    expect(
      ScheduledMaintenanceStartUtil.isWaitingToStart({
        states: shuffled,
        state: model(placed("Confirmed")),
      }),
    ).toBe(true);
    expect(
      ScheduledMaintenanceStartUtil.isWaitingToStart({
        states: shuffled,
        state: model(placed("Draft")),
      }),
    ).toBe(false);
  });

  test("an event waiting has not started, and neither has one in a state placed before Scheduled", () => {
    for (const spec of FULL_LIST) {
      const data: { states: Array<unknown>; state: unknown } = {
        states: FULL_MODELS,
        state: model(spec),
      };

      if (ScheduledMaintenanceStartUtil.isWaitingToStart(data)) {
        expect(ScheduledMaintenanceStartUtil.hasStarted(data)).toBe(false);
      }
    }

    expect(
      ScheduledMaintenanceStartUtil.hasStarted({
        states: FULL_MODELS,
        state: model(DRAFT),
      }),
    ).toBe(false);
  });
});

describe("ScheduledMaintenanceStartUtil.getWaitingToStartStates", () => {
  test("is Scheduled and the states of the project's own after it and before Ongoing, in the order given", () => {
    expect(
      ScheduledMaintenanceStartUtil.getWaitingToStartStates({
        states: FULL_MODELS,
      }).map((state: ScheduledMaintenanceState): string => {
        return state.name || "";
      }),
    ).toEqual(["Scheduled", "Confirmed"]);
  });

  test("names them by id as ObjectIDs, for a query", () => {
    const ids: Array<ObjectID> =
      ScheduledMaintenanceStartUtil.getWaitingToStartStateIds({
        states: FULL_LIST.map(json),
      });

    expect(
      ids.map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([SCHEDULED.id, CONFIRMED.id]);

    for (const id of ids) {
      expect(id).toBeInstanceOf(ObjectID);
    }
  });

  test("leaves out a state with no id", () => {
    expect(
      ScheduledMaintenanceStartUtil.getWaitingToStartStateIds({
        states: [{ isScheduledState: true, order: 1 }],
      }),
    ).toEqual([]);
  });
});

describe("ScheduledMaintenanceStartUtil.isCompleteByFlags", () => {
  test.each([
    ["Scheduled", SCHEDULED, false],
    ["Ongoing", ONGOING, false],
    ["Ended", ENDED, false],
    ["Completed", COMPLETED, true],
  ] as Array<[string, StateSpec, boolean]>)(
    "%s answers from its own flag",
    (_name: string, spec: StateSpec, complete: boolean) => {
      expect(ScheduledMaintenanceStartUtil.isCompleteByFlags(model(spec))).toBe(
        complete,
      );
      expect(ScheduledMaintenanceStartUtil.isCompleteByFlags(json(spec))).toBe(
        complete,
      );
    },
  );

  test("a state of the project's own cannot tell by itself: its place decides", () => {
    for (const spec of [REVIEWING, ARCHIVED]) {
      expect(
        ScheduledMaintenanceStartUtil.isCompleteByFlags(model(spec)),
      ).toBeNull();
    }
  });

  test("a state flagged both ended and completed is complete: the completion wins", () => {
    expect(
      ScheduledMaintenanceStartUtil.isCompleteByFlags({
        _id: COMPLETED.id,
        isEndedState: true,
        isResolvedState: true,
      }),
    ).toBe(true);
  });
});

/*
 * Whether an event is complete: Completed, or a state of the project's own
 * placed after it. What stops its owners' reminders ("Remind until event is
 * Completed") and what the chats' Mark as Complete is refused for. Ended,
 * and "Reviewing" between Ended and Completed, are over but not complete.
 */
describe("ScheduledMaintenanceStartUtil.isComplete", () => {
  test.each([
    ["Draft", false],
    ["Scheduled", false],
    ["Confirmed", false],
    ["Ongoing", false],
    ["Verifying", false],
    ["Ended", false],
    ["Reviewing", false],
    ["Completed", true],
    ["Archived", true],
  ] as Array<[string, boolean]>)(
    "an event in %s is complete: %s",
    (name: string, complete: boolean) => {
      expect(
        ScheduledMaintenanceStartUtil.isComplete({
          states: FULL_MODELS,
          state: model(placed(name)),
        }),
      ).toBe(complete);
      expect(
        ScheduledMaintenanceStartUtil.isComplete({
          states: FULL_LIST.map(json),
          state: json(placed(name)),
        }),
      ).toBe(complete);
    },
  );

  test("a state read with its id only is placed where the project's list puts it", () => {
    expect(
      ScheduledMaintenanceStartUtil.isComplete({
        states: FULL_MODELS,
        state: { _id: ARCHIVED.id },
      }),
    ).toBe(true);
    expect(
      ScheduledMaintenanceStartUtil.isComplete({
        states: FULL_MODELS,
        state: { _id: REVIEWING.id },
      }),
    ).toBe(false);
  });

  test("a state of the project's own is never complete in a list without a completed state", () => {
    expect(
      ScheduledMaintenanceStartUtil.isComplete({
        states: FULL_MODELS.filter(
          (state: ScheduledMaintenanceState): boolean => {
            return !state.isResolvedState;
          },
        ),
        state: model(placed("Archived")),
      }),
    ).toBe(false);
  });

  test("a state that cannot be placed is not complete", () => {
    expect(
      ScheduledMaintenanceStartUtil.isComplete({
        states: FULL_MODELS,
        state: { _id: "aaaaaaaa-0000-4000-8000-0000000000b3" },
      }),
    ).toBe(false);
    expect(
      ScheduledMaintenanceStartUtil.isComplete({
        states: FULL_MODELS,
        state: null,
      }),
    ).toBe(false);
  });

  test("complete is over: every state an event is complete in, it has ended in", () => {
    for (const spec of FULL_LIST) {
      const data: { states: Array<unknown>; state: unknown } = {
        states: FULL_MODELS,
        state: model(spec),
      };

      if (ScheduledMaintenanceStartUtil.isComplete(data)) {
        expect(ScheduledMaintenanceStartUtil.hasEnded(data)).toBe(true);
      }
    }
  });
});

/*
 * THE ended and THE completed state: the ones the end at an event's time and
 * Mark as Ended move it into, and Mark as Complete moves it into - not every
 * state it is over or complete in.
 */
describe("ScheduledMaintenanceStartUtil.getEndedState and getCompletedState", () => {
  test("are the states flagged ended and completed, not the states of the project's own after them", () => {
    expect(
      ScheduledMaintenanceStartUtil.getEndedState({
        states: FULL_MODELS,
      })?._id?.toString(),
    ).toBe(ENDED.id);
    expect(
      ScheduledMaintenanceStartUtil.getCompletedState({
        states: FULL_MODELS,
      })?._id?.toString(),
    ).toBe(COMPLETED.id);
  });

  test("are the first from the top so flagged, whatever order the rows come in", () => {
    const secondEnded: ScheduledMaintenanceState = model({
      id: "aaaaaaaa-0000-4000-8000-0000000000b4",
      name: "Ended again",
      order: 20,
      kind: "ended",
    });
    const secondCompleted: ScheduledMaintenanceState = model({
      id: "aaaaaaaa-0000-4000-8000-0000000000b5",
      name: "Completed again",
      order: 21,
      kind: "completed",
    });

    const states: Array<ScheduledMaintenanceState> = [
      secondCompleted,
      secondEnded,
      ...[...FULL_MODELS].reverse(),
    ];

    expect(
      ScheduledMaintenanceStartUtil.getEndedState({
        states: states,
      })?._id?.toString(),
    ).toBe(ENDED.id);
    expect(
      ScheduledMaintenanceStartUtil.getCompletedState({
        states: states,
      })?._id?.toString(),
    ).toBe(COMPLETED.id);
  });

  test("read the API's JSON for the states as well", () => {
    expect(
      ScheduledMaintenanceStartUtil.getEndedState({
        states: FULL_LIST.map(json),
      })?.["_id"],
    ).toBe(ENDED.id);
    expect(
      ScheduledMaintenanceStartUtil.getCompletedState({
        states: FULL_LIST.map(json),
      })?.["_id"],
    ).toBe(COMPLETED.id);
  });

  test("are none in a project without them", () => {
    expect(
      ScheduledMaintenanceStartUtil.getEndedState({
        states: [model(SCHEDULED), model(ONGOING), model(COMPLETED)],
      }),
    ).toBeNull();
    expect(
      ScheduledMaintenanceStartUtil.getCompletedState({
        states: [model(SCHEDULED), model(ONGOING), model(ENDED)],
      }),
    ).toBeNull();
    expect(
      ScheduledMaintenanceStartUtil.getCompletedState({ states: [] }),
    ).toBeNull();
  });
});

/*
 * The rows of an event's timeline it was completed with: the moves into a
 * state where it is complete from one where it was not. The measurements'
 * "completed state entered" reads them.
 */
describe("ScheduledMaintenanceStartUtil.getCompleteRows", () => {
  const T0: Date = new Date("2026-10-01T10:00:00.000Z");

  interface NamedRow {
    stateId: string;
    startsAt: Date | null;
    name: string;
  }

  function row(spec: StateSpec, minutes: number): NamedRow {
    return {
      stateId: spec.id,
      startsAt: new Date(T0.getTime() + minutes * 60 * 1000),
      name: spec.name,
    };
  }

  function namesOf(rows: Array<NamedRow>): Array<string> {
    return rows.map((entry: NamedRow): string => {
      return entry.name;
    });
  }

  test("is the move into Completed: moving on to a state of the project's own after it is no second completion", () => {
    expect(
      namesOf(
        ScheduledMaintenanceStartUtil.getCompleteRows({
          states: FULL_MODELS,
          timeline: [
            row(SCHEDULED, 0),
            row(ONGOING, 10),
            row(ENDED, 20),
            row(REVIEWING, 30),
            row(COMPLETED, 40),
            row(ARCHIVED, 50),
          ],
        }),
      ),
    ).toEqual(["Completed"]);
  });

  test("is the move straight into a state of the project's own after Completed when the event skipped it", () => {
    expect(
      namesOf(
        ScheduledMaintenanceStartUtil.getCompleteRows({
          states: FULL_MODELS,
          timeline: [row(SCHEDULED, 0), row(ENDED, 10), row(ARCHIVED, 20)],
        }),
      ),
    ).toEqual(["Archived"]);
  });

  test("is none while the event is over but not complete", () => {
    expect(
      ScheduledMaintenanceStartUtil.getCompleteRows({
        states: FULL_MODELS,
        timeline: [row(SCHEDULED, 0), row(ENDED, 10), row(REVIEWING, 20)],
      }),
    ).toEqual([]);
  });

  test("reads the timeline by its times, whatever order it arrives in, and skips rows with none", () => {
    expect(
      namesOf(
        ScheduledMaintenanceStartUtil.getCompleteRows({
          states: FULL_MODELS,
          timeline: [
            row(ARCHIVED, 50),
            row(COMPLETED, 40),
            { stateId: COMPLETED.id, startsAt: null, name: "No time" },
            row(SCHEDULED, 0),
          ],
        }),
      ),
    ).toEqual(["Completed"]);
  });

  test("counts each completion of a timeline that left complete in between", () => {
    expect(
      namesOf(
        ScheduledMaintenanceStartUtil.getCompleteRows({
          states: FULL_MODELS,
          timeline: [
            row(SCHEDULED, 0),
            row(COMPLETED, 10),
            row(REVIEWING, 20),
            row(ARCHIVED, 30),
          ],
        }),
      ),
    ).toEqual(["Completed", "Archived"]);
  });
});
