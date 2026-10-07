import {
  findState,
  getFirstFlaggedState,
  getResolvedState,
  getStateOrder,
  type ResolvedRuleState,
  type StateList,
} from "./resolvedState";

/*
 * WHETHER AN INCIDENT, AN ALERT OR AN EPISODE IS ACKNOWLEDGED - the one rule
 * the server, the dashboard and status pages read
 * (Common/Utils/AcknowledgedState), kept here because the app is built
 * without Common's runtime code.
 *
 * A record is acknowledged when its state is the project's acknowledged state
 * - the first state from the top flagged acknowledged, the one Acknowledge
 * moves it into - or any state placed after it ("Investigating",
 * "Mitigated"), flagged or not. A resolved record is further along still, so
 * it counts as acknowledged too.
 *
 * So Acknowledge - the button on a detail screen and the swipe on a list - is
 * offered only to a record that is not acknowledged yet, and the guidance
 * says a responder has it from the acknowledged state on. Asking whether the
 * record sat in the acknowledged state itself is what used to offer
 * Acknowledge to a record in "Investigating": a move back up the list the
 * server refuses, while on-call - which reads the order - had already stopped
 * paging for it.
 *
 * Common's test suite runs this file next to Common/Utils/AcknowledgedState
 * over the same cases (AcknowledgedStateMobileParity), and
 * acknowledgedState.test.ts holds the cases Common's own suite checks.
 */

export interface AcknowledgedRuleState extends ResolvedRuleState {
  isAcknowledgedState?: boolean | null | undefined;
}

/**
 * The project's acknowledged state: the first state from the top that carries
 * the acknowledged flag - where Acknowledge moves a record. Undefined when
 * none does.
 */
export function getAcknowledgedState<T extends AcknowledgedRuleState>(
  states: StateList<T>,
): T | undefined {
  return getFirstFlaggedState(states, (state: T) => {
    return state.isAcknowledgedState === true;
  });
}

/**
 * Whether a record in `state` is acknowledged - or further along: resolved
 * counts too - in a project whose states are `states`. The state carries the
 * acknowledged or the resolved flag, or sits at or below the project's
 * acknowledged state, or its resolved state.
 */
export function isAcknowledged<T extends AcknowledgedRuleState>(
  states: StateList<T>,
  state: AcknowledgedRuleState | null | undefined,
): boolean {
  if (!state) {
    return false;
  }

  if (state.isAcknowledgedState === true || state.isResolvedState === true) {
    return true;
  }

  const order: number | null = getStateOrder(state);

  if (order === null) {
    return false;
  }

  for (const builtIn of [
    getAcknowledgedState(states),
    getResolvedState(states),
  ]) {
    const builtInOrder: number | null = builtIn
      ? getStateOrder(builtIn)
      : null;

    if (builtInOrder !== null && order >= builtInOrder) {
      return true;
    }
  }

  return false;
}

/**
 * Whether a record whose current state is `stateId` is acknowledged. False
 * for a state that is none of the project's: nothing about it says anybody
 * is on it.
 */
export function isAcknowledgedById<T extends AcknowledgedRuleState>(
  states: StateList<T>,
  stateId: string | null | undefined,
): boolean {
  return isAcknowledged(states, findState(states, stateId));
}

// The ids of the project's states a record counts as acknowledged in.
export function getAcknowledgedStateIds<T extends AcknowledgedRuleState>(
  states: StateList<T>,
): Array<string> {
  return (states || [])
    .filter((state: T) => {
      return isAcknowledged(states, state);
    })
    .map((state: T) => {
      return state._id;
    });
}

/*
 * The ids of the project's states a record still waits for an
 * acknowledgement in: the only states Acknowledge is offered in.
 */
export function getUnacknowledgedStateIds<T extends AcknowledgedRuleState>(
  states: StateList<T>,
): Array<string> {
  return (states || [])
    .filter((state: T) => {
      return !isAcknowledged(states, state);
    })
    .map((state: T) => {
      return state._id;
    });
}
