import ObjectID from "../Types/ObjectID";
import ResolvedStateUtil, {
  ResolvedStateList,
  ResolvedStateTimelineRow,
} from "./ResolvedState";
import {
  STATE_LISTS,
  StateListDefinition,
  StateListRow,
  getStateListBuiltInRows,
  getStateListReachedBuiltIn,
  toStateListRow,
} from "./StateOrder";

/*
 * WHETHER AN INCIDENT, AN ALERT OR AN EPISODE IS ACKNOWLEDGED - ONE RULE,
 * EVERYWHERE, THE SAME WAY AS RESOLVED (Common/Utils/ResolvedState).
 *
 * A record is acknowledged when its state is at or below its project's
 * acknowledged state in the project's list of states, or carries the
 * acknowledged flag itself - or when it is resolved, which is further along
 * still. The acknowledged state is the first state from the top that is
 * flagged acknowledged: the one Acknowledge moves a record into. So a state
 * of the project's own placed after it - "Investigating", "Mitigated" -
 * counts as acknowledged, flagged or not, and the state settings pages say
 * so in their "Counts as" column (getStateListReachedBuiltIn, which this
 * reads).
 *
 * Every part of OneUptime that asks "is it acknowledged?" asks it here,
 * through the helper of its kind:
 *
 *   - incidents and incident episodes walk the project's incident states,
 *     alerts and alert episodes its alert states;
 *   - on the server, the state services read the project's list once and
 *     answer per record (IncidentStateService.isAcknowledgedIncidentState,
 *     getAcknowledgedIncidentState...), and the record services per record
 *     (IncidentService.isIncidentAcknowledged, AlertService.isAlertAcknowledged,
 *     the episode services' isEpisodeAcknowledged);
 *   - in the dashboard and on status pages, the pages read the project's
 *     states and ask this module;
 *   - the mobile app, built without Common's runtime code, keeps a copy in
 *     MobileApp/src/utils/acknowledgedState, and a test runs both over the
 *     same cases (AcknowledgedStateMobileParity).
 *
 * What follows from it: Acknowledge is offered only to a record that is not
 * acknowledged yet - on the web, in the mobile app, in Slack and Microsoft
 * Teams, through the API - and the server refuses it for one that is;
 * on-call escalation and reminders that stop on acknowledgement stop; an
 * incident's SLA counts as responded; the time to acknowledge, in the stat
 * bars, metrics, measurements and workspace summaries, runs to the first
 * move into a state that counts as acknowledged.
 *
 * Reading the acknowledged flag on its own is what used to make a state
 * after Acknowledged half-acknowledged: acknowledged for on-call, which read
 * the order, but offered Acknowledge again in the mobile app and in Microsoft
 * Teams - a move back up the list the server refuses - and never an
 * acknowledgement at all for the SLA, the metrics or the summaries.
 */

export type AcknowledgedStateList = ResolvedStateList;

const ACKNOWLEDGED_STATE_FLAG: string = "isAcknowledgedState";
const RESOLVED_STATE_FLAG: string = "isResolvedState";

type StateArgs = {
  list: AcknowledgedStateList;
  // The project's states: models, or their JSON (id, place, built-in flags).
  states: Array<unknown>;
};

export default class AcknowledgedStateUtil {
  /*
   * The project's acknowledged state: the first state from the top that
   * carries the acknowledged flag - where Acknowledge moves a record. Null
   * when the list has none (a project always keeps one; StateOrderGuard
   * refuses deleting it).
   */
  public static getAcknowledgedState<T>(data: {
    list: AcknowledgedStateList;
    states: Array<T>;
  }): T | null {
    const definition: StateListDefinition = STATE_LISTS[data.list];
    const rows: Array<StateListRow> = this.toRows(data);

    const acknowledgedRow: StateListRow | undefined = getStateListBuiltInRows(
      definition,
      rows,
    )[ACKNOWLEDGED_STATE_FLAG];

    if (!acknowledgedRow) {
      return null;
    }

    const index: number = rows.indexOf(acknowledgedRow);

    return index >= 0 ? (data.states[index] as T) : null;
  }

  /*
   * Where the acknowledged state sits in the list (its order): a state at
   * that place or below it counts as acknowledged. Null when the list has no
   * acknowledged state with a place.
   */
  public static getAcknowledgedOrder(data: StateArgs): number | null {
    const acknowledgedRow: StateListRow | undefined = getStateListBuiltInRows(
      STATE_LISTS[data.list],
      this.toRows(data),
    )[ACKNOWLEDGED_STATE_FLAG];

    return acknowledgedRow?.order ?? null;
  }

  /*
   * Whether a record in `stateId` is acknowledged - or further along:
   * resolved counts too. False for a state that is none of the project's:
   * nothing about it says anybody is on it.
   */
  public static isAcknowledged(
    data: StateArgs & {
      stateId: ObjectID | string | null | undefined;
    },
  ): boolean {
    const rows: Array<StateListRow> = this.toRows(data);

    return this.isAcknowledgedAmong(data.list, rows, data.stateId);
  }

  /*
   * Whether a record in `stateId` is in the acknowledged stage: acknowledged
   * (the acknowledged state, or one placed after it) but not resolved -
   * somebody is on it, and it is not over. What a badge, a filter or a
   * metric's "acknowledged" attribute names.
   */
  public static isAcknowledgedUnresolved(
    data: StateArgs & {
      stateId: ObjectID | string | null | undefined;
    },
  ): boolean {
    return (
      this.isAcknowledged(data) &&
      !ResolvedStateUtil.isResolved({
        list: data.list,
        states: data.states,
        stateId: data.stateId,
      })
    );
  }

  /*
   * Whether `state` - a state read with its place and flags, such as an
   * incident's currentIncidentState - is acknowledged in a project whose
   * states are `states`. The state itself need not be in the list: its own
   * place and flags are what is compared.
   */
  public static isStateAcknowledged(
    data: StateArgs & {
      state: unknown;
    },
  ): boolean {
    if (!data.state || typeof data.state !== "object") {
      return false;
    }

    const definition: StateListDefinition = STATE_LISTS[data.list];

    return this.isRowAcknowledged(
      data.list,
      this.toRows(data),
      toStateListRow(definition, data.state),
    );
  }

  /*
   * The project's states that count as acknowledged - resolved ones
   * included - in the order given.
   */
  public static getAcknowledgedStates<T>(data: {
    list: AcknowledgedStateList;
    states: Array<T>;
  }): Array<T> {
    const rows: Array<StateListRow> = this.toRows(data);

    return data.states.filter((_state: T, index: number): boolean => {
      return this.isRowAcknowledged(data.list, rows, rows[index]!);
    });
  }

  /*
   * The project's states a record still waits for an acknowledgement in -
   * the states it pages from, and the only ones Acknowledge is offered in -
   * in the order given.
   */
  public static getUnacknowledgedStates<T>(data: {
    list: AcknowledgedStateList;
    states: Array<T>;
  }): Array<T> {
    const rows: Array<StateListRow> = this.toRows(data);

    return data.states.filter((_state: T, index: number): boolean => {
      return !this.isRowAcknowledged(data.list, rows, rows[index]!);
    });
  }

  /*
   * The project's states a record is acknowledged but not resolved in:
   * somebody is on it, and it is not over - the acknowledged state and every
   * state after it, up to the resolved one. What an "Acknowledged" filter
   * means.
   */
  public static getAcknowledgedUnresolvedStates<T>(data: {
    list: AcknowledgedStateList;
    states: Array<T>;
  }): Array<T> {
    const rows: Array<StateListRow> = this.toRows(data);
    const resolved: Set<unknown> = new Set<unknown>(
      ResolvedStateUtil.getResolvedStates(data),
    );

    return data.states.filter((state: T, index: number): boolean => {
      return (
        this.isRowAcknowledged(data.list, rows, rows[index]!) &&
        !resolved.has(state)
      );
    });
  }

  // The ids of the three lists above, as ObjectIDs.
  public static getAcknowledgedStateIds(data: StateArgs): Array<ObjectID> {
    return this.toObjectIds(data.list, this.getAcknowledgedStates(data));
  }

  public static getUnacknowledgedStateIds(data: StateArgs): Array<ObjectID> {
    return this.toObjectIds(data.list, this.getUnacknowledgedStates(data));
  }

  public static getAcknowledgedUnresolvedStateIds(
    data: StateArgs,
  ): Array<ObjectID> {
    return this.toObjectIds(
      data.list,
      this.getAcknowledgedUnresolvedStates(data),
    );
  }

  /*
   * Why Acknowledge is refused for a record in `stateId` - "Incident is
   * already resolved.", "Alert is already acknowledged." - or null when it
   * may be acknowledged. What the services that acknowledge say, on every
   * channel, instead of trying a move back up the list.
   */
  public static getAcknowledgeRefusal(
    data: StateArgs & {
      stateId: ObjectID | string | null | undefined;
      // What the record is, for the sentence: "Incident", "Alert", "Episode".
      subject: string;
    },
  ): string | null {
    if (
      ResolvedStateUtil.isResolved({
        list: data.list,
        states: data.states,
        stateId: data.stateId,
      })
    ) {
      return `${data.subject} is already resolved.`;
    }

    if (this.isAcknowledged(data)) {
      return `${data.subject} is already acknowledged.`;
    }

    return null;
  }

  /*
   * Of a record's state timeline (any order), the rows it became
   * acknowledged with: each row in a state that counts as acknowledged
   * whose row before it - by startsAt - is in a state that does not, or that
   * has no row before it. Moving on from Acknowledged to a state after it,
   * or to Resolved, is no new acknowledgement; a record resolved straight
   * from the start was acknowledged by that resolve; a record reopened and
   * acknowledged again has two.
   */
  public static getAcknowledgementRows<T extends ResolvedStateTimelineRow>(
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

    const acknowledgements: Array<T> = [];
    let wasAcknowledged: boolean = false;

    for (const row of sorted) {
      const isAcknowledged: boolean = this.isAcknowledgedAmong(
        data.list,
        rows,
        row.stateId,
      );

      if (isAcknowledged && !wasAcknowledged) {
        acknowledgements.push(row);
      }

      wasAcknowledged = isAcknowledged;
    }

    return acknowledgements;
  }

  /*
   * When a record was first acknowledged, by its timeline: undefined when it
   * never was. What every "time to acknowledge" counts to.
   */
  public static getFirstAcknowledgedAt(
    data: StateArgs & {
      timeline: Array<ResolvedStateTimelineRow>;
    },
  ): Date | undefined {
    const first: ResolvedStateTimelineRow | undefined =
      this.getAcknowledgementRows(data)[0];

    return first?.startsAt || undefined;
  }

  private static isRowAcknowledged(
    list: AcknowledgedStateList,
    rows: Array<StateListRow>,
    row: StateListRow,
  ): boolean {
    if (
      row.flags.includes(ACKNOWLEDGED_STATE_FLAG) ||
      row.flags.includes(RESOLVED_STATE_FLAG)
    ) {
      return true;
    }

    const reached: string | null = getStateListReachedBuiltIn(
      STATE_LISTS[list],
      rows,
      row,
    );

    return (
      reached === ACKNOWLEDGED_STATE_FLAG || reached === RESOLVED_STATE_FLAG
    );
  }

  private static isAcknowledgedAmong(
    list: AcknowledgedStateList,
    rows: Array<StateListRow>,
    stateId: ObjectID | string | null | undefined,
  ): boolean {
    const id: string = this.toId(stateId);

    const row: StateListRow | undefined = id
      ? rows.find((candidate: StateListRow): boolean => {
          return candidate.id.toLowerCase() === id;
        })
      : undefined;

    return row ? this.isRowAcknowledged(list, rows, row) : false;
  }

  private static toRows(data: {
    list: AcknowledgedStateList;
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
    list: AcknowledgedStateList,
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
