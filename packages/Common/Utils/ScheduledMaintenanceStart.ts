import {
  STATE_LISTS,
  StateListDefinition,
  StateListRow,
  StateListType,
  getStateListReachedBuiltIn,
  toStateListRow,
} from "./StateOrder";

/*
 * WHETHER A SCHEDULED MAINTENANCE EVENT HAS STARTED - ONE RULE, ON THE
 * SERVER AND IN THE DASHBOARD.
 *
 * An event walks its project's list of scheduled maintenance states:
 * scheduled, ongoing, ended, completed, with any states the project added in
 * between (Common/Utils/StateOrder keeps the four built-in ones in that
 * order). It has started once it is in the project's ongoing state or any
 * state after it in that list - ended, completed, or a state of the
 * project's own placed after Ongoing, such as "Verifying" - or in a state
 * that carries the ongoing, ended or completed flag itself. A state of the
 * project's own placed before Ongoing, such as "Confirmed", is still waiting
 * to start, as the scheduled state is. The same order the dashboard's header
 * reads (getScheduledMaintenanceStateKind) and the server's
 * isScheduledMaintenanceOngoing compare.
 *
 * What follows from it: an event's Change Monitor Status to can be changed
 * until the event starts. Its monitors change to that status when it starts
 * (ScheduledMaintenanceStateTimelineService reads it then), so once it has
 * started the server refuses a change to it (ScheduledMaintenanceService)
 * and the event's Affected Resources card shows it read-only.
 *
 * An event that has started and not yet ended is in progress (isInProgress):
 * it is ongoing, or in a state of the project's own placed between Ongoing
 * and Ended, such as "Verifying". That is where an event holds its monitors
 * - paused, in its Change Monitor Status to - and the move into such a state
 * from one where the event had not started is its start, whichever of them
 * it moves into.
 *
 * No database and no React in it, so both sides read the same rule.
 */

// The built-in states an event is in once it has started, by their flags.
const STARTED_FLAGS: Array<string> = [
  "isOngoingState",
  "isEndedState",
  "isResolvedState",
];

const SCHEDULED_FLAG: string = "isScheduledState";

const ONGOING_FLAG: string = "isOngoingState";

// The built-in states an event is not in progress in, by their flags.
const NOT_IN_PROGRESS_FLAGS: Array<string> = [
  SCHEDULED_FLAG,
  "isEndedState",
  "isResolvedState",
];

const DEFINITION: StateListDefinition =
  STATE_LISTS[StateListType.ScheduledMaintenanceState];

export default class ScheduledMaintenanceStartUtil {
  /*
   * Whether an event in `state` has started, from the state alone: true for
   * a state flagged ongoing, ended or completed, false for one flagged
   * scheduled, and null for a state of the project's own - only its place
   * in the project's list can tell (hasStarted). `state` is a state model,
   * or its JSON, read with its flags.
   */
  public static hasStartedByFlags(state: unknown): boolean | null {
    if (!state || typeof state !== "object") {
      return null;
    }

    const row: StateListRow = toStateListRow(DEFINITION, state);

    if (
      row.flags.some((flag: string): boolean => {
        return STARTED_FLAGS.includes(flag);
      })
    ) {
      return true;
    }

    if (row.flags.includes(SCHEDULED_FLAG)) {
      return false;
    }

    return null;
  }

  /*
   * Whether an event in `state` has started, in a project whose states are
   * `states` (models, or their JSON, read with their place and flags). A
   * state the list holds is placed where the list puts it; one it does not
   * hold, by its own place. False for a state that is none of the project's
   * and has no place: nothing about it says the event has started.
   */
  public static hasStarted(data: {
    states: Array<unknown>;
    state: unknown;
  }): boolean {
    const byFlags: boolean | null = this.hasStartedByFlags(data.state);

    if (byFlags !== null) {
      return byFlags;
    }

    const placed: PlacedState | null = this.placeState(data);

    if (!placed) {
      return false;
    }

    if (
      placed.row.flags.some((flag: string): boolean => {
        return STARTED_FLAGS.includes(flag);
      })
    ) {
      return true;
    }

    const reached: string | null = getStateListReachedBuiltIn(
      DEFINITION,
      placed.rows,
      placed.row,
    );

    return reached !== null && STARTED_FLAGS.includes(reached);
  }

  /*
   * Whether an event in `state` is in progress, from the state alone: true
   * for a state flagged ongoing, false for one flagged scheduled, ended or
   * completed, and null for a state of the project's own - only its place
   * in the project's list can tell (isInProgress).
   */
  public static isInProgressByFlags(state: unknown): boolean | null {
    if (!state || typeof state !== "object") {
      return null;
    }

    return this.isInProgressByRowFlags(toStateListRow(DEFINITION, state));
  }

  /*
   * Whether an event in `state` is in progress - started and not yet ended -
   * in a project whose states are `states`: it is in the ongoing state, or
   * in a state of the project's own placed after Ongoing and before Ended.
   * A state placed before Ongoing has not started; one at or after Ended is
   * over. False for a state that is none of the project's and has no place.
   */
  public static isInProgress(data: {
    states: Array<unknown>;
    state: unknown;
  }): boolean {
    const byFlags: boolean | null = this.isInProgressByFlags(data.state);

    if (byFlags !== null) {
      return byFlags;
    }

    const placed: PlacedState | null = this.placeState(data);

    if (!placed) {
      return false;
    }

    const byListedFlags: boolean | null = this.isInProgressByRowFlags(
      placed.row,
    );

    if (byListedFlags !== null) {
      return byListedFlags;
    }

    return (
      getStateListReachedBuiltIn(DEFINITION, placed.rows, placed.row) ===
      ONGOING_FLAG
    );
  }

  private static isInProgressByRowFlags(row: StateListRow): boolean | null {
    if (row.flags.includes(ONGOING_FLAG)) {
      return true;
    }

    if (
      row.flags.some((flag: string): boolean => {
        return NOT_IN_PROGRESS_FLAGS.includes(flag);
      })
    ) {
      return false;
    }

    return null;
  }

  /*
   * `state` as the project's list places it, with the list: the list's copy
   * of the state when it holds one - it carries the state's place even when
   * the event's copy did not - or the state's own place. Null for no state.
   */
  private static placeState(data: {
    states: Array<unknown>;
    state: unknown;
  }): PlacedState | null {
    if (!data.state || typeof data.state !== "object") {
      return null;
    }

    const rows: Array<StateListRow> = (data.states || [])
      .filter((state: unknown): boolean => {
        return Boolean(state) && typeof state === "object";
      })
      .map((state: unknown): StateListRow => {
        return toStateListRow(DEFINITION, state);
      });

    const ownRow: StateListRow = toStateListRow(DEFINITION, data.state);
    const ownId: string = ownRow.id.trim().toLowerCase();

    const listedRow: StateListRow | undefined = ownId
      ? rows.find((candidate: StateListRow): boolean => {
          return candidate.id.trim().toLowerCase() === ownId;
        })
      : undefined;

    return {
      rows: rows,
      row: listedRow || ownRow,
    };
  }
}

// A state as the project's list places it, with the list's rows.
interface PlacedState {
  rows: Array<StateListRow>;
  row: StateListRow;
}
