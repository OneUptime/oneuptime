import AcknowledgedStateUtil from "Common/Utils/AcknowledgedState";
import ResolvedStateUtil from "Common/Utils/ResolvedState";
import ScheduledMaintenanceStartUtil from "Common/Utils/ScheduledMaintenanceStart";
import StateMoveUtil, { StateMoveList } from "Common/Utils/StateMove";
import { StateListType } from "Common/Utils/StateOrder";
import {
  ALREADY_ACKNOWLEDGED,
  ALREADY_AT_OR_PAST_STATE,
  ALREADY_RESOLVED,
  EventStateKindDefinition,
  EventStateQuickMove,
} from "./EventStateKinds";

/*
 * Which moves a list offers a record, and why it leaves one alone - read
 * from the project's states the way the record's own page reads them, by
 * the one rule every state timeline holds (Common/Utils/StateMove). No
 * React and no requests here: the hook that draws the actions
 * (useEventStateActions) and the tests read the same answers.
 */

/*
 * A project's state as a list reads it: its id, name and place, its archive
 * switch, and the built-in flags that say which one Acknowledge, Resolve or
 * a maintenance move goes to. A model or its JSON will do.
 */
export interface EventStateLike {
  id?: { toString: () => string } | string | null | undefined;
  _id?: { toString: () => string } | string | null | undefined;
  name?: string | null | undefined;
  order?: number | null | undefined;
  isArchived?: boolean | null | undefined;
}

export const getStateId: (
  state: EventStateLike | null | undefined,
) => string = (state: EventStateLike | null | undefined): string => {
  if (!state) {
    return "";
  }

  return (state.id || state._id)?.toString() || "";
};

// The state a named move goes to in this project, or null when it has none.
export const getQuickMoveTarget: <T extends EventStateLike>(data: {
  definition: EventStateKindDefinition;
  states: Array<T>;
  move: EventStateQuickMove;
}) => T | null = <T extends EventStateLike>(data: {
  definition: EventStateKindDefinition;
  states: Array<T>;
  move: EventStateQuickMove;
}): T | null => {
  const list: StateMoveList = data.definition.stateList;

  switch (data.move) {
    case EventStateQuickMove.Acknowledge:
      if (list === StateListType.ScheduledMaintenanceState) {
        return null;
      }

      return AcknowledgedStateUtil.getAcknowledgedState<T>({
        list: list,
        states: data.states,
      });
    case EventStateQuickMove.Resolve:
      if (list === StateListType.ScheduledMaintenanceState) {
        return null;
      }

      return ResolvedStateUtil.getResolvedState<T>({
        list: list,
        states: data.states,
      });
    case EventStateQuickMove.Start:
      return ScheduledMaintenanceStartUtil.getOngoingState<T>({
        states: data.states,
      });
    case EventStateQuickMove.End:
      return (
        ScheduledMaintenanceStartUtil.getEndedState<T>({
          states: data.states,
        }) ||
        ScheduledMaintenanceStartUtil.getCompletedState<T>({
          states: data.states,
        })
      );
  }
};

/*
 * Why a record in `currentStateId` is not moved to `target`, in English, or
 * null when it may be: it is acknowledged or resolved already (for those two
 * moves), or the move would put it in the state it is in or back up the
 * list. The words are Dashboard keys; {{state}} names the target.
 */
export const getMoveRefusal: (data: {
  definition: EventStateKindDefinition;
  states: Array<EventStateLike>;
  move: EventStateQuickMove | null;
  currentStateId: string | null | undefined;
  targetStateId: string;
}) => string | null = (data: {
  definition: EventStateKindDefinition;
  states: Array<EventStateLike>;
  move: EventStateQuickMove | null;
  currentStateId: string | null | undefined;
  targetStateId: string;
}): string | null => {
  const list: StateMoveList = data.definition.stateList;

  if (
    data.move === EventStateQuickMove.Acknowledge &&
    list !== StateListType.ScheduledMaintenanceState &&
    AcknowledgedStateUtil.isAcknowledged({
      list: list,
      states: data.states,
      stateId: data.currentStateId,
    })
  ) {
    return ALREADY_ACKNOWLEDGED;
  }

  if (
    data.move === EventStateQuickMove.Resolve &&
    list !== StateListType.ScheduledMaintenanceState &&
    ResolvedStateUtil.isResolved({
      list: list,
      states: data.states,
      stateId: data.currentStateId,
    })
  ) {
    return ALREADY_RESOLVED;
  }

  if (
    !StateMoveUtil.isMoveAllowed({
      list: data.definition.stateList,
      states: data.states,
      fromStateId: data.currentStateId,
      toStateId: data.targetStateId,
    })
  ) {
    return ALREADY_AT_OR_PAST_STATE;
  }

  return null;
};

/*
 * Whether a row is offered a named move: its project has the state the move
 * goes to, and the row may go there now. A row whose state the list did not
 * read is offered it, and the move asks the server what state it is in.
 */
export const isQuickMoveOffered: (data: {
  definition: EventStateKindDefinition;
  states: Array<EventStateLike>;
  move: EventStateQuickMove;
  currentStateId: string | null | undefined;
}) => boolean = (data: {
  definition: EventStateKindDefinition;
  states: Array<EventStateLike>;
  move: EventStateQuickMove;
  currentStateId: string | null | undefined;
}): boolean => {
  const target: EventStateLike | null = getQuickMoveTarget({
    definition: data.definition,
    states: data.states,
    move: data.move,
  });

  if (!target || !getStateId(target)) {
    return false;
  }

  return (
    getMoveRefusal({
      definition: data.definition,
      states: data.states,
      move: data.move,
      currentStateId: data.currentStateId,
      targetStateId: getStateId(target),
    }) === null
  );
};

/*
 * The states a row's Change State offers: the ones it may move into next,
 * by the state timeline's rule, less the archived ones - nobody moves a
 * record into an archived state (Common/Utils/ArchivableValues). Every live
 * state for a row whose state the list did not read.
 */
export const getStatesToOffer: <T extends EventStateLike>(data: {
  definition: EventStateKindDefinition;
  states: Array<T>;
  currentStateId: string | null | undefined;
}) => Array<T> = <T extends EventStateLike>(data: {
  definition: EventStateKindDefinition;
  states: Array<T>;
  currentStateId: string | null | undefined;
}): Array<T> => {
  return StateMoveUtil.getStatesToMoveTo<T>({
    list: data.definition.stateList,
    states: data.states,
    currentStateId: data.currentStateId,
  }).filter((state: T): boolean => {
    return state.isArchived !== true;
  });
};

// The id of the state a row is in, read off the list's row.
export const getRowStateId: (data: {
  definition: EventStateKindDefinition;
  item: unknown;
}) => string = (data: {
  definition: EventStateKindDefinition;
  item: unknown;
}): string => {
  if (!data.item || typeof data.item !== "object") {
    return "";
  }

  const current: unknown = (data.item as Record<string, unknown>)[
    data.definition.currentStateColumn
  ];

  if (!current || typeof current !== "object") {
    return "";
  }

  return getStateId(current as EventStateLike);
};
