import ObjectID from "../Types/ObjectID";
import {
  STATE_LISTS,
  StateListDefinition,
  StateListRow,
  StateListType,
  isStateListRowAfter,
  toStateListRow,
} from "./StateOrder";

/*
 * WHERE AN INCIDENT, AN ALERT, AN EPISODE OR A SCHEDULED MAINTENANCE EVENT
 * MAY MOVE NEXT - ONE RULE, FOR EVERY STATE TIMELINE.
 *
 * A record walks down its project's list of states (Common/Utils/StateOrder):
 * incidents and incident episodes the incident states, alerts and alert
 * episodes the alert states, scheduled maintenance events the scheduled
 * maintenance states. Every change of its state is a new row of its state
 * timeline, and the row is refused when it would:
 *
 *   - put the record in the state it is in already - the state of the row
 *     before it: "Incident state cannot be same as previous state.";
 *   - move it back up the list - into a state placed at or above the state
 *     of the row before it: "Incident cannot transition to Identified state
 *     from Resolved state because Identified is before Resolved in the order
 *     of incident states.";
 *   - for a row dated before the latest one, put it in the state of the row
 *     after it: "Incident state cannot be same as next state.".
 *
 * Two states are compared by their places in the list; a state without a
 * place is compared by its id alone. Episodes are held to it exactly as the
 * records they group are, with "Episode" in the sentence, so a resolved
 * episode is never moved back to an earlier state - and, through it, its
 * incidents or alerts.
 *
 * Every state timeline asks getMoveRefusal before it writes a row
 * (IncidentStateTimelineService, AlertStateTimelineService,
 * IncidentEpisodeStateTimelineService, AlertEpisodeStateTimelineService,
 * ScheduledMaintenanceStateTimelineService); an update that writes a
 * record's current state asks it before anything is written
 * (Server/Utils/StateMoveOnUpdate); an episode moves each of its members
 * only where the member's own rule lets it (isMoveAllowed); and every picker
 * that offers a move - the Change state to menu of the dashboard's event
 * header, the Change State forms in Slack and Microsoft Teams - offers only
 * the states getStatesToMoveTo leaves, so nobody is offered a move that would
 * be refused. OneStateMoveRuleGuard keeps every state timeline on it.
 *
 * The one move back up a list is OneUptime's own: a grouping rule with a
 * reopen window reopens a recently resolved episode when a matching incident
 * or alert arrives (isGroupingRuleReopen). Nothing a person sends can ask for
 * it. A state set by mistake is put right by deleting its row from the
 * record's state timeline, for every kind of record alike.
 *
 * No database and no React in it, so the server and the dashboard read the
 * same rule.
 */

// The lists records walk down.
export type StateMoveList =
  | StateListType.IncidentState
  | StateListType.AlertState
  | StateListType.ScheduledMaintenanceState;

// The records that walk down one.
export enum StateMoveRecord {
  Incident = "Incident",
  Alert = "Alert",
  IncidentEpisode = "IncidentEpisode",
  AlertEpisode = "AlertEpisode",
  ScheduledMaintenance = "ScheduledMaintenance",
}

interface StateMoveRecordDefinition {
  list: StateMoveList;
  // How the refusals name the record: "Incident state cannot be ...".
  subject: string;
  // How they name its list: "... in the order of incident states.".
  listName: string;
}

const RECORDS: Record<StateMoveRecord, StateMoveRecordDefinition> = {
  [StateMoveRecord.Incident]: {
    list: StateListType.IncidentState,
    subject: "Incident",
    listName: "incident states",
  },
  [StateMoveRecord.Alert]: {
    list: StateListType.AlertState,
    subject: "Alert",
    listName: "alert states",
  },
  [StateMoveRecord.IncidentEpisode]: {
    list: StateListType.IncidentState,
    subject: "Episode",
    listName: "incident states",
  },
  [StateMoveRecord.AlertEpisode]: {
    list: StateListType.AlertState,
    subject: "Episode",
    listName: "alert states",
  },
  [StateMoveRecord.ScheduledMaintenance]: {
    list: StateListType.ScheduledMaintenanceState,
    subject: "Scheduled Maintenance",
    listName: "scheduled maintenance states",
  },
};

/*
 * A state as a move names it: its id, and - where the caller read them - its
 * name for the sentence and its place in the list for the order. A model, or
 * its JSON, will do.
 */
export interface StateMoveState {
  id?: ObjectID | string | null | undefined;
  _id?: ObjectID | string | null | undefined;
  name?: string | null | undefined;
  order?: number | string | null | undefined;
}

export default class StateMoveUtil {
  // The list a record walks down.
  public static getList(record: StateMoveRecord): StateMoveList {
    return RECORDS[record].list;
  }

  /*
   * Why a new row of a record's state timeline - a move into `to` from
   * `from`, the state of the row before it (null for the record's first
   * row), with `nextStateId` the state of the row after it when the row is
   * dated before the latest one - is refused, or null when it may be
   * written. `isGroupingRuleReopen` is OneUptime's reopen of a recently
   * resolved episode by its grouping rule: the one move back up the list,
   * which only the episode timelines' own reopen sets.
   */
  public static getMoveRefusal(data: {
    record: StateMoveRecord;
    from: StateMoveState | null | undefined;
    to: StateMoveState;
    nextStateId?: ObjectID | string | null | undefined;
    isGroupingRuleReopen?: boolean | undefined;
  }): string | null {
    const definition: StateMoveRecordDefinition = RECORDS[data.record];
    const listDefinition: StateListDefinition = STATE_LISTS[definition.list];

    const to: StateListRow = this.toRow(listDefinition, data.to);
    const from: StateListRow | null = data.from
      ? this.toRow(listDefinition, data.from)
      : null;

    if (from && from.id && to.id && from.id === to.id) {
      return `${definition.subject} state cannot be same as previous state.`;
    }

    if (
      from &&
      !data.isGroupingRuleReopen &&
      isStateListRowAfter(to, from) === false
    ) {
      return `${definition.subject} cannot transition to ${to.name} state from ${from.name} state because ${to.name} is before ${from.name} in the order of ${definition.listName}.`;
    }

    const nextStateId: string = this.toId(data.nextStateId);

    if (nextStateId && to.id && nextStateId === to.id) {
      return `${definition.subject} state cannot be same as next state.`;
    }

    return null;
  }

  /*
   * Whether a record in `fromStateId` may move into `toStateId` now - the
   * latest row of its timeline - among its project's `states`: what a new
   * row moving it there would be told, asked of the project's list. A state
   * that is not in the list has no place, and is compared by its id alone.
   */
  public static isMoveAllowed(data: {
    list: StateMoveList;
    states: Array<unknown>;
    fromStateId: ObjectID | string | null | undefined;
    toStateId: ObjectID | string | null | undefined;
  }): boolean {
    const toId: string = this.toId(data.toStateId);

    if (!toId) {
      return false;
    }

    const rows: Array<StateListRow> = this.toRows(data.list, data.states);
    const fromId: string = this.toId(data.fromStateId);

    const to: StateListRow = this.findRow(rows, toId) || this.unplaced(toId);
    const from: StateListRow | null = fromId
      ? this.findRow(rows, fromId) || this.unplaced(fromId)
      : null;

    if (!from) {
      return true;
    }

    return from.id !== to.id && isStateListRowAfter(to, from) !== false;
  }

  /*
   * The states a record in `currentStateId` may move into next, in the order
   * given: every state of the project's list but the one it is in, and none
   * placed at or above it. A record in a state that is not in the list, or
   * has no place in it, may move into any other state - nothing about its
   * place is known, so the server compares by id alone too.
   */
  public static getStatesToMoveTo<T>(data: {
    list: StateMoveList;
    states: Array<T>;
    currentStateId: ObjectID | string | null | undefined;
  }): Array<T> {
    const rows: Array<StateListRow> = this.toRows(data.list, data.states);

    return data.states.filter((_state: T, index: number): boolean => {
      return this.isMoveAllowed({
        list: data.list,
        states: data.states,
        fromStateId: data.currentStateId,
        toStateId: rows[index]!.id,
      });
    });
  }

  private static toRow(
    definition: StateListDefinition,
    state: StateMoveState,
  ): StateListRow {
    const row: StateListRow = toStateListRow(definition, state);

    return {
      ...row,
      id: this.toId(row.id),
    };
  }

  private static toRows(
    list: StateMoveList,
    states: Array<unknown>,
  ): Array<StateListRow> {
    const definition: StateListDefinition = STATE_LISTS[list];

    return states.map((state: unknown): StateListRow => {
      return this.toRow(definition, (state || {}) as StateMoveState);
    });
  }

  private static findRow(
    rows: Array<StateListRow>,
    id: string,
  ): StateListRow | undefined {
    return rows.find((row: StateListRow): boolean => {
      return row.id === id;
    });
  }

  // A state the list does not hold: known by its id, with no place.
  private static unplaced(id: string): StateListRow {
    return { id: id, name: "", order: null, flags: [] };
  }

  private static toId(value: unknown): string {
    if (value === null || value === undefined) {
      return "";
    }

    return value.toString().trim().toLowerCase();
  }
}
