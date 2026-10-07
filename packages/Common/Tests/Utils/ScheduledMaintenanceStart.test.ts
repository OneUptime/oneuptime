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
