import StateMoveUtil, { StateMoveList } from "Common/Utils/StateMove";

// A state as the header of an event's page lists it.
export interface EventStateMenuState {
  id: string;
  // Its place in the project's list of states: 1 is the top.
  order?: number | undefined;
}

/*
 * The states the "Change state to" menu in the header of an incident, an
 * alert, an episode or a scheduled maintenance event offers: the ones the
 * record may move into next, by the rule its state timeline holds every move
 * to (Common/Utils/StateMove) - none at or above the state it is in - less
 * the ones a button next to the menu offers already, each once, in the order
 * given. So the menu never offers a move the server would refuse. A state
 * given without its place takes the place the list gives it. A record in a
 * state the list does not hold may move into any other state: the server
 * compares by id alone then too, and the menu stays a way out.
 */
export function getEventStateMenuStates<T extends EventStateMenuState>(data: {
  list: StateMoveList;
  states: Array<T>;
  currentStateId: string | undefined;
  buttonStateIds: Array<string>;
}): Array<T> {
  const statesToMoveTo: Array<T> = StateMoveUtil.getStatesToMoveTo({
    list: data.list,
    states: data.states.map((state: T, index: number): EventStateMenuState => {
      return {
        id: state.id,
        order:
          state.order === undefined || state.order === null
            ? index + 1
            : state.order,
      };
    }),
    currentStateId: data.currentStateId,
  }).map((state: EventStateMenuState): T => {
    return data.states.find((given: T): boolean => {
      return given.id === state.id;
    })!;
  });

  const buttonStateIds: Set<string> = new Set<string>(data.buttonStateIds);
  const offered: Set<string> = new Set<string>();

  return statesToMoveTo.filter((state: T): boolean => {
    if (!state.id || buttonStateIds.has(state.id) || offered.has(state.id)) {
      return false;
    }

    offered.add(state.id);
    return true;
  });
}
