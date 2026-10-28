import { Blue, Gray500, Orange, Red, Yellow } from "../../Types/BrandColors";
import Color from "../../Types/Color";
import ObjectID from "../../Types/ObjectID";
import OcsfSeverity from "../../Types/SecurityEvent/OcsfSeverity";
import SecurityCasePriorityLevel, {
  SECURITY_CASE_PRIORITY_LEVEL_FLAGS,
  getSecurityCasePriorityLevelOfFlag,
  securityCasePriorityLevelFromSeverity,
} from "../../Types/SecurityCase/SecurityCasePriorityLevel";
import {
  STATE_LISTS,
  StateListDefinition,
  StateListRow,
  StateListType,
  getStateListBuiltIn,
  getStateListBuiltInRows,
  sortStateListRows,
  toStateListRow,
} from "../StateOrder";

/*
 * HOW URGENT A SECURITY CASE IS - ONE RULE, EVERYWHERE.
 *
 * A project's case priorities (SecurityCasePriority) are a drag-ordered
 * list, most urgent first: the order IS the ranking. Every comparison
 * OneUptime makes - a playbook "for cases at least High", a person's "tell
 * me from High up", a case rising when a more severe detection joins it,
 * the queue's sort - reads a case's priority's place in the list, never its
 * name.
 *
 * Five priorities are built in, one for each level a detection's severity
 * is read on (SecurityCasePriorityLevel), and flagged by it: a Critical
 * detection opens its case at the critical priority, whatever the project
 * calls it. They keep that order (StateOrder), and a project's own go
 * anywhere among them - an "Emergency" above Critical, which only people,
 * playbooks and nothing else set. The built-in levels also say:
 *
 *   - which cases are urgent: at or above the high priority, the cases the
 *     Overview turns red for, and the people hear about by default;
 *   - which cases cannot wait: at or above the critical priority, sent at
 *     once and asked to be acknowledged on a phone;
 *   - where a case a person opens starts: the medium priority.
 *
 * Priorities are read as the server and the dashboard hold them: models or
 * their JSON, each with its id, its place and its built-in flags. No
 * database and no React here.
 */

// A priority a new project starts with (ProjectService), and the migration gives every older project.
export interface DefaultSecurityCasePriority {
  name: string;
  description: string;
  color: Color;
  order: number;
  level: SecurityCasePriorityLevel;
  /*
   * Its response targets, in minutes (SecurityCaseTargets): how fast a case
   * at it must be taken on and contained. Null for none. A project created
   * before targets existed got its priorities without them, by the
   * migration, and keeps them that way until someone sets them.
   */
  acknowledgeWithinInMinutes: number | null;
  containWithinInMinutes: number | null;
}

/*
 * A new project's case priorities: the scale every case has been on since
 * cases began - the same names, order and colours - each the built-in
 * priority of its level, with the response targets a security team usually
 * starts from: a Critical case taken on in 15 minutes and contained in 4
 * hours, a High one in an hour and a day, a Medium one in 12 hours and 3
 * days, a Low one in a day and a week. Informational cases need nothing
 * done, so they have no targets.
 */
export const DEFAULT_SECURITY_CASE_PRIORITIES: ReadonlyArray<DefaultSecurityCasePriority> =
  [
    {
      name: "Critical",
      description:
        "An active attack or a confirmed breach. Respond immediately.",
      color: Red,
      order: 1,
      level: SecurityCasePriorityLevel.Critical,
      acknowledgeWithinInMinutes: 15,
      containWithinInMinutes: 4 * 60,
    },
    {
      name: "High",
      description: "Likely malicious. Look into it as soon as you can.",
      color: Orange,
      order: 2,
      level: SecurityCasePriorityLevel.High,
      acknowledgeWithinInMinutes: 60,
      containWithinInMinutes: 24 * 60,
    },
    {
      name: "Medium",
      description: "Suspicious, or of unknown weight. Look into it today.",
      color: Yellow,
      order: 3,
      level: SecurityCasePriorityLevel.Medium,
      acknowledgeWithinInMinutes: 12 * 60,
      containWithinInMinutes: 3 * 24 * 60,
    },
    {
      name: "Low",
      description: "Unlikely to be harmful, but worth a look.",
      color: Blue,
      order: 4,
      level: SecurityCasePriorityLevel.Low,
      acknowledgeWithinInMinutes: 24 * 60,
      containWithinInMinutes: 7 * 24 * 60,
    },
    {
      name: "Informational",
      description: "For the record. Nothing needs to be done.",
      color: Gray500,
      order: 5,
      level: SecurityCasePriorityLevel.Informational,
      acknowledgeWithinInMinutes: null,
      containWithinInMinutes: null,
    },
  ];

const DEFINITION: StateListDefinition =
  STATE_LISTS[StateListType.SecurityCasePriority];

function toIdString(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (value instanceof ObjectID) {
    return value.toString();
  }

  return toStateListRow(DEFINITION, { _id: value }).id;
}

export default class SecurityCasePriorities {
  public static readonly definition: StateListDefinition = DEFINITION;

  // The priorities as StateOrder reads them, in the order given.
  public static toRows(
    priorities: ReadonlyArray<unknown>,
  ): Array<StateListRow> {
    return priorities.map((priority: unknown): StateListRow => {
      return toStateListRow(DEFINITION, priority);
    });
  }

  // The priorities most urgent first.
  public static sort<T>(priorities: ReadonlyArray<T>): Array<T> {
    const rows: Array<StateListRow> = this.toRows(priorities);
    const byRow: Map<StateListRow, T> = new Map();

    rows.forEach((row: StateListRow, index: number) => {
      byRow.set(row, priorities[index] as T);
    });

    return sortStateListRows(rows).map((row: StateListRow): T => {
      return byRow.get(row) as T;
    });
  }

  // The priority a priority id names, among the project's.
  public static find<T>(
    priorities: ReadonlyArray<T>,
    priorityId: ObjectID | string | null | undefined,
  ): T | null {
    const id: string = toIdString(priorityId).toLowerCase();

    if (!id) {
      return null;
    }

    const rows: Array<StateListRow> = this.toRows(priorities);
    const index: number = rows.findIndex((row: StateListRow): boolean => {
      return row.id.toLowerCase() === id;
    });

    return index >= 0 ? (priorities[index] as T) : null;
  }

  /*
   * The built-in priority of a level: the first from the top that carries
   * its flag. Null when the list has none (a project always keeps one;
   * StateOrderGuard refuses deleting the last).
   */
  public static getPriorityOfLevel<T>(
    priorities: ReadonlyArray<T>,
    level: SecurityCasePriorityLevel,
  ): T | null {
    const rows: Array<StateListRow> = this.toRows(priorities);
    const row: StateListRow | undefined = getStateListBuiltInRows(
      DEFINITION,
      rows,
    )[SECURITY_CASE_PRIORITY_LEVEL_FLAGS[level]];

    if (!row) {
      return null;
    }

    const index: number = rows.indexOf(row);

    return index >= 0 ? (priorities[index] as T) : null;
  }

  // The priority a detection of this severity opens (or raises) its case to.
  public static getPriorityForSeverity<T>(
    priorities: ReadonlyArray<T>,
    severity: OcsfSeverity | string | undefined | null,
  ): T | null {
    return this.getPriorityOfLevel(
      priorities,
      securityCasePriorityLevelFromSeverity(severity),
    );
  }

  // Where a case a person opens starts: the medium priority.
  public static getDefaultPriority<T>(priorities: ReadonlyArray<T>): T | null {
    return this.getPriorityOfLevel(
      priorities,
      SecurityCasePriorityLevel.Medium,
    );
  }

  /*
   * The level a priority is the built-in one of, or null for a priority of
   * the project's own (and an unknown id).
   */
  public static getLevel(
    priorities: ReadonlyArray<unknown>,
    priorityId: ObjectID | string | null | undefined,
  ): SecurityCasePriorityLevel | null {
    const priority: unknown = this.find(priorities, priorityId);

    if (!priority) {
      return null;
    }

    const builtIn: { flag: string } | null = getStateListBuiltIn(
      DEFINITION,
      toStateListRow(DEFINITION, priority),
    );

    return getSecurityCasePriorityLevelOfFlag(builtIn?.flag) || null;
  }

  /*
   * A priority's rank: its place from the top, 0 the most urgent. Null for
   * an id that is none of the project's priorities.
   */
  public static getRank(
    priorities: ReadonlyArray<unknown>,
    priorityId: ObjectID | string | null | undefined,
  ): number | null {
    const id: string = toIdString(priorityId).toLowerCase();

    if (!id) {
      return null;
    }

    const index: number = sortStateListRows(this.toRows(priorities)).findIndex(
      (row: StateListRow): boolean => {
        return row.id.toLowerCase() === id;
      },
    );

    return index >= 0 ? index : null;
  }

  /*
   * Whether a case at `priorityId` is at least as urgent as `minimumId`.
   * No minimum (or one that is none of the project's) holds every case; a
   * case at no known priority meets no minimum.
   */
  public static isAtLeast(
    priorities: ReadonlyArray<unknown>,
    priorityId: ObjectID | string | null | undefined,
    minimumId: ObjectID | string | null | undefined,
  ): boolean {
    const minimumRank: number | null = this.getRank(priorities, minimumId);

    if (minimumRank === null) {
      return true;
    }

    const rank: number | null = this.getRank(priorities, priorityId);

    return rank !== null && rank <= minimumRank;
  }

  /*
   * Whether `priorityId` is more urgent than `thanId`. Anything known is
   * more urgent than nothing; nothing is more urgent than anything.
   */
  public static isMoreUrgent(
    priorities: ReadonlyArray<unknown>,
    priorityId: ObjectID | string | null | undefined,
    thanId: ObjectID | string | null | undefined,
  ): boolean {
    const rank: number | null = this.getRank(priorities, priorityId);

    if (rank === null) {
      return false;
    }

    const thanRank: number | null = this.getRank(priorities, thanId);

    return thanRank === null || rank < thanRank;
  }

  /*
   * Whether a case at `priorityId` is at or above the built-in priority of
   * `level`. False for a project with no priority of that level.
   */
  public static isAtLeastLevel(
    priorities: ReadonlyArray<unknown>,
    priorityId: ObjectID | string | null | undefined,
    level: SecurityCasePriorityLevel,
  ): boolean {
    const levelPriority: unknown = this.getPriorityOfLevel(priorities, level);

    if (!levelPriority) {
      return false;
    }

    const rank: number | null = this.getRank(priorities, priorityId);
    const levelRank: number | null = this.getRank(
      priorities,
      toStateListRow(DEFINITION, levelPriority).id,
    );

    return rank !== null && levelRank !== null && rank <= levelRank;
  }

  /*
   * Urgent: at or above the high priority - the cases the Overview turns red
   * for, and the people hear about by default.
   */
  public static isUrgent(
    priorities: ReadonlyArray<unknown>,
    priorityId: ObjectID | string | null | undefined,
  ): boolean {
    return this.isAtLeastLevel(
      priorities,
      priorityId,
      SecurityCasePriorityLevel.High,
    );
  }

  /*
   * Cannot wait: at or above the critical priority - sent at once, never
   * held for a rollup, and asked to be acknowledged on a phone.
   */
  public static isCritical(
    priorities: ReadonlyArray<unknown>,
    priorityId: ObjectID | string | null | undefined,
  ): boolean {
    return this.isAtLeastLevel(
      priorities,
      priorityId,
      SecurityCasePriorityLevel.Critical,
    );
  }
}
