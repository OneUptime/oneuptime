/*
 * WHETHER AN INCIDENT, AN ALERT OR AN EPISODE IS RESOLVED - the one rule the
 * server, the dashboard and status pages read (Common/Utils/ResolvedState),
 * kept here because the app is built without Common's runtime code.
 *
 * A record is resolved when its state is the project's resolved state - the
 * first state from the top flagged resolved, the one Resolve moves it into -
 * or any state placed after it ("Closed", "Postmortem done"), flagged or not.
 * So the Active lists, the counts on Home and the Acknowledge / Resolve
 * buttons treat a record in a state after Resolved as resolved, the way every
 * other part of OneUptime does. Reading the resolved flag alone is what used
 * to leave such a record on the Active list with a Resolve button that could
 * only move it backwards.
 *
 * Common's test suite runs this file next to Common/Utils/ResolvedState over
 * the same cases (AcknowledgedStateMobileParity), so the two cannot drift:
 * "the first from the top" breaks ties the way the server does (by id), and
 * state ids match whatever their case.
 */

export interface ResolvedRuleState {
  _id: string;
  order?: number | string | null | undefined;
  isResolvedState?: boolean | null | undefined;
}

export type StateList<T extends ResolvedRuleState> =
  | ReadonlyArray<T>
  | null
  | undefined;

/*
 * A state's place in the list: 1 is the top. Null when it has none. A
 * number written as text counts, as it does on the server.
 */
export function getStateOrder(state: ResolvedRuleState): number | null {
  if (typeof state.order === "number") {
    return Number.isFinite(state.order) ? state.order : null;
  }

  if (typeof state.order === "string" && state.order.trim().length > 0) {
    const parsed: number = Number(state.order);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

// A state id as the rule compares it: trimmed, whatever its case.
export function toStateIdKey(stateId: string | null | undefined): string {
  return typeof stateId === "string" ? stateId.trim().toLowerCase() : "";
}

/*
 * Which of two states sits nearer the top, as the server sorts them: by
 * place, a state without one after every state with one, and then by id.
 */
function compareStates(a: ResolvedRuleState, b: ResolvedRuleState): number {
  const aOrder: number | null = getStateOrder(a);
  const bOrder: number | null = getStateOrder(b);

  if (aOrder !== null && bOrder === null) {
    return -1;
  }

  if (aOrder === null && bOrder !== null) {
    return 1;
  }

  if (aOrder !== null && bOrder !== null && aOrder !== bOrder) {
    return aOrder - bOrder;
  }

  if (a._id === b._id) {
    return 0;
  }

  return a._id < b._id ? -1 : 1;
}

/**
 * The first state from the top that `isFlagged` picks - "the" resolved or
 * acknowledged state of a project. Undefined when none is picked.
 */
export function getFirstFlaggedState<T extends ResolvedRuleState>(
  states: StateList<T>,
  isFlagged: (state: T) => boolean,
): T | undefined {
  let first: T | undefined = undefined;

  for (const state of states || []) {
    if (!isFlagged(state)) {
      continue;
    }

    if (!first || compareStates(state, first) < 0) {
      first = state;
    }
  }

  return first;
}

/**
 * The project's resolved state: the first state from the top that carries the
 * resolved flag - where Resolve moves a record. Undefined when none does.
 */
export function getResolvedState<T extends ResolvedRuleState>(
  states: StateList<T>,
): T | undefined {
  return getFirstFlaggedState(states, (state: T) => {
    return state.isResolvedState === true;
  });
}

/**
 * Whether a record in `state` is resolved, in a project whose states are
 * `states`: the state carries the resolved flag, or sits at or below the
 * project's resolved state.
 */
export function isResolvedState<T extends ResolvedRuleState>(
  states: StateList<T>,
  state: ResolvedRuleState | null | undefined,
): boolean {
  if (!state) {
    return false;
  }

  if (state.isResolvedState === true) {
    return true;
  }

  const resolvedState: T | undefined = getResolvedState(states);
  const order: number | null = getStateOrder(state);
  const resolvedOrder: number | null = resolvedState
    ? getStateOrder(resolvedState)
    : null;

  return order !== null && resolvedOrder !== null && order >= resolvedOrder;
}

/**
 * The project's state `stateId` names, matched whatever its case. Undefined
 * for a state that is none of the project's.
 */
export function findState<T extends ResolvedRuleState>(
  states: StateList<T>,
  stateId: string | null | undefined,
): T | undefined {
  const key: string = toStateIdKey(stateId);

  if (!key) {
    return undefined;
  }

  return (states || []).find((candidate: T) => {
    return toStateIdKey(candidate._id) === key;
  });
}

/**
 * Whether a record whose current state is `stateId` is resolved. False for a
 * state that is none of the project's: nothing about it says it is over.
 */
export function isResolvedStateId<T extends ResolvedRuleState>(
  states: StateList<T>,
  stateId: string | null | undefined,
): boolean {
  return isResolvedState(states, findState(states, stateId));
}

// The ids of the project's states a record counts as resolved in.
export function getResolvedStateIds<T extends ResolvedRuleState>(
  states: StateList<T>,
): Array<string> {
  return (states || [])
    .filter((state: T) => {
      return isResolvedState(states, state);
    })
    .map((state: T) => {
      return state._id;
    });
}

// The ids of the project's states a record is still open in.
export function getUnresolvedStateIds<T extends ResolvedRuleState>(
  states: StateList<T>,
): Array<string> {
  return (states || [])
    .filter((state: T) => {
      return !isResolvedState(states, state);
    })
    .map((state: T) => {
      return state._id;
    });
}

export interface IncludesQuery {
  _type: "Includes";
  value: Array<string>;
}

/**
 * A list query's match on a state id column: the record's current state is
 * one of `stateIds`. An empty list matches nothing, which is what a project
 * without an open state means.
 */
export function toStateIdsQuery(stateIds: Array<string>): IncludesQuery {
  return {
    _type: "Includes",
    value: stateIds,
  };
}
