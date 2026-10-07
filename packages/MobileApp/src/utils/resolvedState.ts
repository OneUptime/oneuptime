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
 */

export interface ResolvedRuleState {
  _id: string;
  order?: number | null | undefined;
  isResolvedState?: boolean | null | undefined;
}

type StateList<T extends ResolvedRuleState> =
  | ReadonlyArray<T>
  | null
  | undefined;

// A state's place in the list: 1 is the top. Null when it has none.
function getOrder(state: ResolvedRuleState): number | null {
  return typeof state.order === "number" && Number.isFinite(state.order)
    ? state.order
    : null;
}

/**
 * The project's resolved state: the first state from the top that carries the
 * resolved flag - where Resolve moves a record. Undefined when none does.
 */
export function getResolvedState<T extends ResolvedRuleState>(
  states: StateList<T>,
): T | undefined {
  let resolvedState: T | undefined = undefined;

  for (const state of states || []) {
    if (!state.isResolvedState) {
      continue;
    }

    if (!resolvedState) {
      resolvedState = state;
      continue;
    }

    const order: number | null = getOrder(state);
    const resolvedOrder: number | null = getOrder(resolvedState);

    if (order !== null && (resolvedOrder === null || order < resolvedOrder)) {
      resolvedState = state;
    }
  }

  return resolvedState;
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

  if (state.isResolvedState) {
    return true;
  }

  const resolvedState: T | undefined = getResolvedState(states);
  const order: number | null = getOrder(state);
  const resolvedOrder: number | null = resolvedState
    ? getOrder(resolvedState)
    : null;

  return order !== null && resolvedOrder !== null && order >= resolvedOrder;
}

/**
 * Whether a record whose current state is `stateId` is resolved. False for a
 * state that is none of the project's: nothing about it says it is over.
 */
export function isResolvedStateId<T extends ResolvedRuleState>(
  states: StateList<T>,
  stateId: string | null | undefined,
): boolean {
  if (!stateId) {
    return false;
  }

  const state: T | undefined = (states || []).find((candidate: T) => {
    return candidate._id === stateId;
  });

  return isResolvedState(states, state);
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
