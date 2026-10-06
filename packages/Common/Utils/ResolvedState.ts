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
 * WHETHER AN INCIDENT, AN ALERT OR AN EPISODE IS RESOLVED - ONE RULE,
 * EVERYWHERE.
 *
 * A record is resolved when its state is at or below its project's resolved
 * state in the project's list of states, or carries the resolved flag
 * itself. The resolved state is the first state from the top that is flagged
 * resolved: the one Resolve moves a record into. So a state of the project's
 * own placed after it - "Closed", "Postmortem done" - counts as resolved,
 * flagged or not, and the state settings pages say so in their "Counts as"
 * column (getStateListReachedBuiltIn, which this reads).
 *
 * Every part of OneUptime that asks "is it resolved?" asks it here, through
 * the helper of its kind:
 *
 *   - incidents and incident episodes walk the project's incident states,
 *     alerts and alert episodes its alert states;
 *   - on the server, the state services read the project's list once and
 *     answer per record (IncidentStateService.isResolvedIncidentState,
 *     getUnresolvedIncidentStates...), and the record services per record
 *     (IncidentService.isIncidentResolved, AlertService.isAlertResolved, the
 *     episode services' isEpisodeResolved);
 *   - in the dashboard and on status pages, the pages read the project's
 *     states and ask this module.
 *
 * What follows from it: the Active lists, badges and counts; what a status
 * page shows as ongoing; what reminders and on-call escalation chase; an
 * incident's resolve - its monitors given back, its postmortem drafted, its
 * investigation graded, its SLA closed - which is the move from a state that
 * is not resolved into one that is; an episode's resolvedAt and its
 * auto-resolve; what a record created in a later state sets off
 * (StartingStage); the measurements and metrics that time a resolve.
 *
 * Reading the resolved flag on its own is what used to make a state after
 * Resolved half-resolved: resolved for reminders and status pages, open for
 * the Active badges and an episode's resolvedAt, and never a resolve at all
 * for an incident's monitors. The flag still marks THE resolved state - the
 * one Resolve moves a record into, which a project cannot delete - and
 * getResolvedState finds it.
 */

export type ResolvedStateList =
  | StateListType.IncidentState
  | StateListType.AlertState;

const RESOLVED_STATE_FLAG: string = "isResolvedState";

/*
 * When a record became resolved, read off its state timeline: the moment of
 * the row it moved into a resolved state with, from one that was not.
 */
export interface ResolvedStateTimelineRow {
  stateId?: ObjectID | string | null | undefined;
  startsAt?: Date | null | undefined;
}

type StateArgs = {
  list: ResolvedStateList;
  // The project's states: models, or their JSON (id, place, built-in flags).
  states: Array<unknown>;
};

export default class ResolvedStateUtil {
  /*
   * The project's resolved state: the first state from the top that carries
   * the resolved flag - where Resolve moves a record. Null when the list has
   * none (a project always keeps one; StateOrderGuard refuses deleting it).
   */
  public static getResolvedState<T>(data: {
    list: ResolvedStateList;
    states: Array<T>;
  }): T | null {
    const definition: StateListDefinition = STATE_LISTS[data.list];
    const rows: Array<StateListRow> = this.toRows(data);

    const resolvedRow: StateListRow | undefined = getStateListBuiltInRows(
      definition,
      rows,
    )[RESOLVED_STATE_FLAG];

    if (!resolvedRow) {
      return null;
    }

    const index: number = rows.indexOf(resolvedRow);

    return index >= 0 ? (data.states[index] as T) : null;
  }

  /*
   * Where the resolved state sits in the list (its order): a state at that
   * place or below it counts as resolved. Null when the list has no resolved
   * state with a place.
   */
  public static getResolvedOrder(data: StateArgs): number | null {
    const resolvedRow: StateListRow | undefined = getStateListBuiltInRows(
      STATE_LISTS[data.list],
      this.toRows(data),
    )[RESOLVED_STATE_FLAG];

    return resolvedRow?.order ?? null;
  }

  /*
   * Whether a record in `stateId` is resolved. False for a state that is
   * none of the project's: nothing about it says it is over.
   */
  public static isResolved(
    data: StateArgs & {
      stateId: ObjectID | string | null | undefined;
    },
  ): boolean {
    const stateId: string = this.toId(data.stateId);

    if (!stateId) {
      return false;
    }

    const rows: Array<StateListRow> = this.toRows(data);

    const row: StateListRow | undefined = rows.find(
      (candidate: StateListRow): boolean => {
        return candidate.id.toLowerCase() === stateId;
      },
    );

    if (!row) {
      return false;
    }

    return this.isRowResolved(data.list, rows, row);
  }

  /*
   * Whether `state` - a state read with its place and flags, such as an
   * incident's currentIncidentState - is resolved in a project whose states
   * are `states`. The state itself need not be in the list: its own place
   * and flag are what is compared.
   */
  public static isStateResolved(
    data: StateArgs & {
      state: unknown;
    },
  ): boolean {
    if (!data.state || typeof data.state !== "object") {
      return false;
    }

    const definition: StateListDefinition = STATE_LISTS[data.list];

    return this.isRowResolved(
      data.list,
      this.toRows(data),
      toStateListRow(definition, data.state),
    );
  }

  // The project's states that count as resolved, in the order given.
  public static getResolvedStates<T>(data: {
    list: ResolvedStateList;
    states: Array<T>;
  }): Array<T> {
    const rows: Array<StateListRow> = this.toRows(data);

    return data.states.filter((_state: T, index: number): boolean => {
      return this.isRowResolved(data.list, rows, rows[index]!);
    });
  }

  /*
   * The project's states a record is still open in: every state that does
   * not count as resolved, in the order given.
   */
  public static getUnresolvedStates<T>(data: {
    list: ResolvedStateList;
    states: Array<T>;
  }): Array<T> {
    const rows: Array<StateListRow> = this.toRows(data);

    return data.states.filter((_state: T, index: number): boolean => {
      return !this.isRowResolved(data.list, rows, rows[index]!);
    });
  }

  // The ids of getResolvedStates / getUnresolvedStates, as ObjectIDs.
  public static getResolvedStateIds(data: StateArgs): Array<ObjectID> {
    return this.toObjectIds(data.list, this.getResolvedStates(data));
  }

  public static getUnresolvedStateIds(data: StateArgs): Array<ObjectID> {
    return this.toObjectIds(data.list, this.getUnresolvedStates(data));
  }

  /*
   * Of a record's state timeline (any order), the rows it became resolved
   * with: each row in a resolved state whose row before it - by startsAt -
   * is in a state that is not, or that has no row before it. Moving on from
   * one resolved state to another ("Resolved" to "Closed") is no new
   * resolve; a record reopened and resolved again has two.
   */
  public static getResolutionRows<T extends ResolvedStateTimelineRow>(
    data: StateArgs & {
      timeline: Array<T>;
    },
  ): Array<T> {
    const rows: Array<StateListRow> = this.toRows(data);

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

    const resolutions: Array<T> = [];
    let wasResolved: boolean = false;

    for (const row of sorted) {
      const isResolved: boolean = this.isResolvedAmong(
        data.list,
        rows,
        row.stateId,
      );

      if (isResolved && !wasResolved) {
        resolutions.push(row);
      }

      wasResolved = isResolved;
    }

    return resolutions;
  }

  /*
   * When a record first became resolved, by its timeline: undefined when it
   * never was.
   */
  public static getFirstResolvedAt(
    data: StateArgs & {
      timeline: Array<ResolvedStateTimelineRow>;
    },
  ): Date | undefined {
    const first: ResolvedStateTimelineRow | undefined =
      this.getResolutionRows(data)[0];

    return first?.startsAt || undefined;
  }

  /*
   * When a record that is resolved now became resolved this time: the start
   * of its latest resolve, by its timeline. Undefined while its latest row is
   * in a state that is not resolved - a record reopened since keeps counting.
   */
  public static getCurrentResolvedAt(
    data: StateArgs & {
      timeline: Array<ResolvedStateTimelineRow>;
    },
  ): Date | undefined {
    const rows: Array<StateListRow> = this.toRows(data);

    const latest: ResolvedStateTimelineRow | undefined = [...data.timeline]
      .filter((row: ResolvedStateTimelineRow): boolean => {
        return Boolean(row.startsAt);
      })
      .sort(
        (a: ResolvedStateTimelineRow, b: ResolvedStateTimelineRow): number => {
          return (
            new Date(b.startsAt as Date).getTime() -
            new Date(a.startsAt as Date).getTime()
          );
        },
      )[0];

    if (!latest || !this.isResolvedAmong(data.list, rows, latest.stateId)) {
      return undefined;
    }

    const resolutions: Array<ResolvedStateTimelineRow> =
      this.getResolutionRows(data);

    return resolutions[resolutions.length - 1]?.startsAt || undefined;
  }

  private static isRowResolved(
    list: ResolvedStateList,
    rows: Array<StateListRow>,
    row: StateListRow,
  ): boolean {
    if (row.flags.includes(RESOLVED_STATE_FLAG)) {
      return true;
    }

    return (
      getStateListReachedBuiltIn(STATE_LISTS[list], rows, row) ===
      RESOLVED_STATE_FLAG
    );
  }

  private static isResolvedAmong(
    list: ResolvedStateList,
    rows: Array<StateListRow>,
    stateId: ObjectID | string | null | undefined,
  ): boolean {
    const id: string = this.toId(stateId);

    const row: StateListRow | undefined = id
      ? rows.find((candidate: StateListRow): boolean => {
          return candidate.id.toLowerCase() === id;
        })
      : undefined;

    return row ? this.isRowResolved(list, rows, row) : false;
  }

  private static toRows(data: {
    list: ResolvedStateList;
    states: Array<unknown>;
  }): Array<StateListRow> {
    const definition: StateListDefinition = STATE_LISTS[data.list];

    return data.states.map((state: unknown): StateListRow => {
      return toStateListRow(definition, state);
    });
  }

  private static toId(value: ObjectID | string | null | undefined): string {
    return value ? value.toString().trim().toLowerCase() : "";
  }

  private static toObjectIds(
    list: ResolvedStateList,
    states: Array<unknown>,
  ): Array<ObjectID> {
    const definition: StateListDefinition = STATE_LISTS[list];

    return states
      .map((state: unknown): string => {
        return toStateListRow(definition, state).id;
      })
      .filter((id: string): boolean => {
        return Boolean(id);
      })
      .map((id: string): ObjectID => {
        return new ObjectID(id);
      });
  }
}
