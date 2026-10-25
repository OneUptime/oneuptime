import { Blue, Green, Red, Yellow } from "../../Types/BrandColors";
import Color from "../../Types/Color";
import ObjectID from "../../Types/ObjectID";
import SecurityCaseStage, {
  SECURITY_CASE_STAGES,
  SECURITY_CASE_STAGE_FLAGS,
  getSecurityCaseStageOfFlag,
} from "../../Types/SecurityCase/SecurityCaseStage";
import {
  STATE_LISTS,
  StateListDefinition,
  StateListRow,
  StateListType,
  getStateListBuiltInRows,
  getStateListReachedBuiltIn,
  sortStateListRows,
  toStateListRow,
} from "../StateOrder";

/*
 * WHAT A SECURITY CASE'S STATUS MEANS - ONE RULE, EVERYWHERE.
 *
 * A project's case statuses (SecurityCaseStatus) are a drag-ordered list
 * like its incident states (Common/Utils/StateOrder). Four of them are built
 * in, flagged by what they mean rather than named for it, and what any
 * status counts as follows from where it sits (SecurityCaseStage):
 *
 *   - the new status, where every case starts; it and any status of the
 *     project's own above the acknowledged one count as New;
 *   - from the acknowledged status down, a case counts as acknowledged:
 *     reaching it first records when the case was taken on;
 *   - from the contained status down, as contained: reaching it first
 *     records when the threat stopped being able to do harm;
 *   - from the closed status down, as closed: the case leaves the open
 *     lists and keeps the verdict it closed with.
 *
 * OneUptime moves a case by itself into the built-in statuses only: a new
 * case to the new status, a reopened one to the acknowledged status, Close
 * Case to the closed status. The open lists, the overview's counts and mean
 * times, the notifications, Slack and Teams, the playbooks and the AI all
 * ask here, through the helpers below, never by a status's name.
 *
 * Statuses are read as the server and the dashboard hold them: models or
 * their JSON, each with its id, its place and its built-in flags. No
 * database and no React here.
 */

// A status a new project starts with (ProjectService), and the migration gives every older project.
export interface DefaultSecurityCaseStatus {
  name: string;
  description: string;
  color: Color;
  order: number;
  stage: SecurityCaseStage;
}

/*
 * A new project's case statuses: the four steps every case has gone through
 * since cases began - the same names, order and colours - each the built-in
 * status of its stage. A project adds its own ("Triage", "Eradicating")
 * under Security Events > Settings > Case Statuses; each goes just above
 * Closed.
 */
export const DEFAULT_SECURITY_CASE_STATUSES: ReadonlyArray<DefaultSecurityCaseStatus> =
  [
    {
      name: "New",
      description: "Nobody has looked at it yet.",
      color: Red,
      order: 1,
      stage: SecurityCaseStage.New,
    },
    {
      name: "Investigating",
      description: "Someone is working out what happened.",
      color: Yellow,
      order: 2,
      stage: SecurityCaseStage.Acknowledged,
    },
    {
      name: "Contained",
      description:
        "The threat can no longer do harm; the cleanup is still to do.",
      color: Blue,
      order: 3,
      stage: SecurityCaseStage.Contained,
    },
    {
      name: "Closed",
      description: "Done, with a verdict on what it was.",
      color: Green,
      order: 4,
      stage: SecurityCaseStage.Closed,
    },
  ];

// What a change of a case's status records on it (getStatusChange).
export interface SecurityCaseStatusChange {
  // The status counts as acknowledged, or further, and the case's did not.
  acknowledges: boolean;
  // The status counts as contained (and not closed), and the case's did not.
  contains: boolean;
  // The case was open and now is closed: it takes a verdict and a close time.
  closes: boolean;
  // The case was closed and now is open: its close and verdict are cleared.
  reopens: boolean;
}

const DEFINITION: StateListDefinition =
  STATE_LISTS[StateListType.SecurityCaseStatus];

function toIdString(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (value instanceof ObjectID) {
    return value.toString();
  }

  return toStateListRow(DEFINITION, { _id: value }).id;
}

export default class SecurityCaseStatuses {
  public static readonly definition: StateListDefinition = DEFINITION;

  // The statuses as StateOrder reads them, in the order given.
  public static toRows(statuses: ReadonlyArray<unknown>): Array<StateListRow> {
    return statuses.map((status: unknown): StateListRow => {
      return toStateListRow(DEFINITION, status);
    });
  }

  // The statuses top first, the order a case comes through them.
  public static sort<T>(statuses: ReadonlyArray<T>): Array<T> {
    const rows: Array<StateListRow> = this.toRows(statuses);
    const byRow: Map<StateListRow, T> = new Map();

    rows.forEach((row: StateListRow, index: number) => {
      byRow.set(row, statuses[index] as T);
    });

    return sortStateListRows(rows).map((row: StateListRow): T => {
      return byRow.get(row) as T;
    });
  }

  /*
   * The built-in status of a stage: the first status from the top that
   * carries its flag - where OneUptime moves a case (a new case, a reopened
   * one, a closed one). Null when the list has none (a project always keeps
   * one; StateOrderGuard refuses deleting the last).
   */
  public static getStatusOfStage<T>(
    statuses: ReadonlyArray<T>,
    stage: SecurityCaseStage,
  ): T | null {
    const rows: Array<StateListRow> = this.toRows(statuses);
    const row: StateListRow | undefined = getStateListBuiltInRows(
      DEFINITION,
      rows,
    )[SECURITY_CASE_STAGE_FLAGS[stage]];

    if (!row) {
      return null;
    }

    const index: number = rows.indexOf(row);

    return index >= 0 ? (statuses[index] as T) : null;
  }

  // The status a status id names, among the project's.
  public static find<T>(
    statuses: ReadonlyArray<T>,
    statusId: ObjectID | string | null | undefined,
  ): T | null {
    const id: string = toIdString(statusId).toLowerCase();

    if (!id) {
      return null;
    }

    const rows: Array<StateListRow> = this.toRows(statuses);
    const index: number = rows.findIndex((row: StateListRow): boolean => {
      return row.id.toLowerCase() === id;
    });

    return index >= 0 ? (statuses[index] as T) : null;
  }

  /*
   * What a case in this status counts as, by where the status sits; null
   * for an id that is none of the project's statuses.
   */
  public static getStage(
    statuses: ReadonlyArray<unknown>,
    statusId: ObjectID | string | null | undefined,
  ): SecurityCaseStage | null {
    const id: string = toIdString(statusId).toLowerCase();

    if (!id) {
      return null;
    }

    const rows: Array<StateListRow> = this.toRows(statuses);
    const row: StateListRow | undefined = rows.find(
      (candidate: StateListRow): boolean => {
        return candidate.id.toLowerCase() === id;
      },
    );

    if (!row) {
      return null;
    }

    const reached: string | null = getStateListReachedBuiltIn(
      DEFINITION,
      rows,
      row,
    );

    /*
     * A status with no place sits nowhere on the path: it counts as what
     * its own flag says, else New.
     */
    if (!reached) {
      return getSecurityCaseStageOfFlag(row.flags[0]) || SecurityCaseStage.New;
    }

    return getSecurityCaseStageOfFlag(reached) || SecurityCaseStage.New;
  }

  // Whether a case in this status is closed. False for an unknown status.
  public static isClosed(
    statuses: ReadonlyArray<unknown>,
    statusId: ObjectID | string | null | undefined,
  ): boolean {
    return this.getStage(statuses, statusId) === SecurityCaseStage.Closed;
  }

  // Whether a case in this status still needs somebody. False for an unknown status.
  public static isOpen(
    statuses: ReadonlyArray<unknown>,
    statusId: ObjectID | string | null | undefined,
  ): boolean {
    const stage: SecurityCaseStage | null = this.getStage(statuses, statusId);

    return stage !== null && stage !== SecurityCaseStage.Closed;
  }

  // Whether a case in this status has come at least as far as this stage.
  public static hasReached(
    statuses: ReadonlyArray<unknown>,
    statusId: ObjectID | string | null | undefined,
    stage: SecurityCaseStage,
  ): boolean {
    const reached: SecurityCaseStage | null = this.getStage(statuses, statusId);

    if (reached === null) {
      return false;
    }

    return (
      SECURITY_CASE_STAGES.indexOf(reached) >=
      SECURITY_CASE_STAGES.indexOf(stage)
    );
  }

  // The statuses a case is still open in, top first.
  public static getOpenStatuses<T>(statuses: ReadonlyArray<T>): Array<T> {
    return this.sort(statuses).filter((status: T): boolean => {
      return this.isOpen(statuses, this.toRows([status])[0]!.id);
    });
  }

  // The statuses that close a case, top first.
  public static getClosedStatuses<T>(statuses: ReadonlyArray<T>): Array<T> {
    return this.sort(statuses).filter((status: T): boolean => {
      return this.isClosed(statuses, this.toRows([status])[0]!.id);
    });
  }

  public static getOpenStatusIds(
    statuses: ReadonlyArray<unknown>,
  ): Array<string> {
    return this.toRows(this.getOpenStatuses(statuses)).map(
      (row: StateListRow): string => {
        return row.id;
      },
    );
  }

  public static getClosedStatusIds(
    statuses: ReadonlyArray<unknown>,
  ): Array<string> {
    return this.toRows(this.getClosedStatuses(statuses)).map(
      (row: StateListRow): string => {
        return row.id;
      },
    );
  }

  /*
   * What moving a case from one status to another records on it. Each
   * moment is stamped once, the first time the case gets there: the caller
   * fills a stamp only while the case has none. A status that is none of
   * the project's records nothing.
   *
   *   - acknowledges: the new status counts as acknowledged or further.
   *     Closing a false positive straight from New acknowledges it too, as
   *     it always did.
   *   - contains: the new status counts as contained. Closing is not
   *     containing: a false positive closed from New was never contained.
   *   - closes / reopens: the case goes from open to closed, or back.
   *     Moving between two statuses that both close (Closed to "Closed -
   *     Duplicate") does neither: the case stays closed with its verdict.
   */
  public static getStatusChange(data: {
    statuses: ReadonlyArray<unknown>;
    fromStatusId: ObjectID | string | null | undefined;
    toStatusId: ObjectID | string | null | undefined;
  }): SecurityCaseStatusChange {
    const from: SecurityCaseStage | null = this.getStage(
      data.statuses,
      data.fromStatusId,
    );
    const to: SecurityCaseStage | null = this.getStage(
      data.statuses,
      data.toStatusId,
    );

    if (to === null) {
      return {
        acknowledges: false,
        contains: false,
        closes: false,
        reopens: false,
      };
    }

    const rank: (stage: SecurityCaseStage | null) => number = (
      stage: SecurityCaseStage | null,
    ): number => {
      return stage === null ? -1 : SECURITY_CASE_STAGES.indexOf(stage);
    };

    return {
      acknowledges: rank(to) >= rank(SecurityCaseStage.Acknowledged),
      contains: to === SecurityCaseStage.Contained,
      closes:
        to === SecurityCaseStage.Closed && from !== SecurityCaseStage.Closed,
      reopens:
        from === SecurityCaseStage.Closed && to !== SecurityCaseStage.Closed,
    };
  }

  /*
   * What a new case created in this status records on it: the same as
   * moving into it from nowhere.
   */
  public static getCreatedStatusChange(data: {
    statuses: ReadonlyArray<unknown>;
    statusId: ObjectID | string | null | undefined;
  }): SecurityCaseStatusChange {
    return this.getStatusChange({
      statuses: data.statuses,
      fromStatusId: null,
      toStatusId: data.statusId,
    });
  }
}
