import ObjectID from "../Types/ObjectID";
import {
  STATE_LISTS,
  StateListDefinition,
  StateListRow,
  StateListType,
  getStateListBuiltInRows,
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
 * it moves into (getStartRows). An event that has started and is no longer
 * in progress is over (hasEnded): ended, completed, or in a state of the
 * project's own placed after Ended, such as "Reviewing" - and the move into
 * such a state from one in progress is its end (getEndRows).
 *
 * EVERY "IS THIS EVENT IN PROGRESS RIGHT NOW" IS ASKED HERE. What a status
 * page lists as ongoing, which network sites and which telemetry series a
 * maintenance window silences, whose burn-rate alerts an SLO holds back, the
 * Dashboard's Ongoing lists, badges and header, the measurements' "ongoing
 * state entered" and the job that ends an event at its end time all read
 * this rule - on the server through ScheduledMaintenanceStateService
 * (getInProgressScheduledMaintenanceStateIds), which turns it into the ids
 * of the states a query asks for. Reading the ongoing flag on its own is
 * what left an event moved on to "Verifying" half in progress: holding its
 * monitors, yet missing from its status page's overview and silencing
 * nothing else. The flag still marks THE ongoing state - the one the start
 * at an event's time and Mark as Ongoing move it into - and getOngoingState
 * finds it. OneInProgressRuleGuard keeps every other read of it out.
 *
 * No database and no React in it, so both sides read the same rule.
 */

/*
 * A row of an event's state timeline, as the edge readers take it: the
 * state it moved into, and when.
 */
export interface ScheduledMaintenanceTimelineRow {
  stateId?: ObjectID | string | null | undefined;
  startsAt?: Date | string | null | undefined;
}

// Where an event is in its life, by the state it is in (getPhase).
export enum ScheduledMaintenancePhaseOfState {
  // Scheduled, or a state of the project's own placed before Ongoing.
  NotStarted = "not-started",
  // Ongoing, or a state of the project's own between Ongoing and Ended.
  InProgress = "in-progress",
  // Ended, Completed, or a state of the project's own placed after Ended.
  Over = "over",
}

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

  /*
   * Whether an event in `state` is over, from the state alone: true for a
   * state flagged ended or completed, false for one flagged scheduled or
   * ongoing, and null for a state of the project's own - only its place in
   * the project's list can tell (hasEnded).
   */
  public static hasEndedByFlags(state: unknown): boolean | null {
    const inProgress: boolean | null = this.isInProgressByFlags(state);

    if (inProgress === null) {
      return null;
    }

    if (inProgress) {
      return false;
    }

    return this.hasStartedByFlags(state);
  }

  /*
   * Whether an event in `state` is over: it has started and is no longer in
   * progress - in the ended or completed state, or in a state of the
   * project's own placed after Ended ("Reviewing", "Archived"). An event
   * moved straight from waiting into such a state is over without having
   * run. False for a state that is none of the project's and has no place.
   */
  public static hasEnded(data: {
    states: Array<unknown>;
    state: unknown;
  }): boolean {
    return this.hasStarted(data) && !this.isInProgress(data);
  }

  /*
   * Where an event in `state` is in its life: not started, in progress or
   * over - the three lists a status page shows and the three kinds the
   * Dashboard's header tells apart. Null for no state.
   */
  public static getPhase(data: {
    states: Array<unknown>;
    state: unknown;
  }): ScheduledMaintenancePhaseOfState | null {
    if (!data.state || typeof data.state !== "object") {
      return null;
    }

    if (this.isInProgress(data)) {
      return ScheduledMaintenancePhaseOfState.InProgress;
    }

    if (this.hasStarted(data)) {
      return ScheduledMaintenancePhaseOfState.Over;
    }

    return ScheduledMaintenancePhaseOfState.NotStarted;
  }

  // The project's states an event is in progress in, in the order given.
  public static getInProgressStates<T>(data: { states: Array<T> }): Array<T> {
    return data.states.filter((state: T): boolean => {
      return this.isInProgress({ states: data.states, state: state });
    });
  }

  /*
   * The ids of getInProgressStates, as ObjectIDs: the states a query for
   * the events in progress asks for (currentScheduledMaintenanceStateId).
   */
  public static getInProgressStateIds(data: {
    states: Array<unknown>;
  }): Array<ObjectID> {
    return this.getInProgressStates(data)
      .map((state: unknown): string => {
        return toStateListRow(DEFINITION, state).id.trim();
      })
      .filter((id: string): boolean => {
        return id.length > 0;
      })
      .map((id: string): ObjectID => {
        return new ObjectID(id);
      });
  }

  /*
   * The project's ongoing state: the first state from the top flagged
   * ongoing - the one an event's start at its time, and Mark as Ongoing,
   * move it into. Null when the list has none (a project always keeps one;
   * StateOrderGuard refuses deleting it).
   */
  public static getOngoingState<T>(data: { states: Array<T> }): T | null {
    const rows: Array<StateListRow> = data.states.map(
      (state: T): StateListRow => {
        return toStateListRow(DEFINITION, state);
      },
    );

    const ongoingRow: StateListRow | undefined = getStateListBuiltInRows(
      DEFINITION,
      rows,
    )[ONGOING_FLAG];

    if (!ongoingRow) {
      return null;
    }

    const index: number = rows.indexOf(ongoingRow);

    return index >= 0 ? (data.states[index] as T) : null;
  }

  /*
   * Of an event's state timeline (any order), the rows it started with:
   * each row in a state where it is in progress whose row before it - by
   * startsAt - is in a state where it is not, or that has no row before it.
   * Moving on from Ongoing to a state of the project's own after it
   * ("Verifying") is no second start. A row in a state that is none of the
   * project's counts as not in progress.
   */
  public static getStartRows<T extends ScheduledMaintenanceTimelineRow>(data: {
    states: Array<unknown>;
    timeline: Array<T>;
  }): Array<T> {
    return this.getEdgeRows({
      timeline: data.timeline,
      isOn: (stateId: ObjectID | string | null | undefined): boolean => {
        return this.isInProgress({
          states: data.states,
          state: { _id: stateId },
        });
      },
    });
  }

  /*
   * Of an event's state timeline (any order), the rows it ended with: each
   * row in a state where it is over (hasEnded) whose row before it is in a
   * state where it is not. Moving on from Ended to Completed is no second
   * end.
   */
  public static getEndRows<T extends ScheduledMaintenanceTimelineRow>(data: {
    states: Array<unknown>;
    timeline: Array<T>;
  }): Array<T> {
    return this.getEdgeRows({
      timeline: data.timeline,
      isOn: (stateId: ObjectID | string | null | undefined): boolean => {
        return this.hasEnded({
          states: data.states,
          state: { _id: stateId },
        });
      },
    });
  }

  // The rows of a timeline, oldest first, where `isOn` turns from off to on.
  private static getEdgeRows<T extends ScheduledMaintenanceTimelineRow>(data: {
    timeline: Array<T>;
    isOn: (stateId: ObjectID | string | null | undefined) => boolean;
  }): Array<T> {
    const sorted: Array<T> = [...data.timeline]
      .filter((row: T): boolean => {
        return Boolean(row.startsAt);
      })
      .sort((a: T, b: T): number => {
        return (
          new Date(a.startsAt as Date).getTime() -
          new Date(b.startsAt as Date).getTime()
        );
      });

    const edges: Array<T> = [];
    let wasOn: boolean = false;

    for (const row of sorted) {
      const isOn: boolean = data.isOn(row.stateId);

      if (isOn && !wasOn) {
        edges.push(row);
      }

      wasOn = isOn;
    }

    return edges;
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
