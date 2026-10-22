import { Gray500, Green, VeryLightGray, Yellow } from "../../Types/BrandColors";
import Color from "../../Types/Color";
import ObjectID from "../../Types/ObjectID";
import IncidentPostmortemPublication, {
  IncidentPostmortemState,
} from "../../Types/StatusPage/IncidentPostmortemPublication";
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
 * HOW FAR AN INCIDENT'S POSTMORTEM HAS COME, AND WHAT MOVES IT - ONE RULE,
 * EVERYWHERE.
 *
 * Every incident's postmortem is in one of its project's postmortem statuses
 * (IncidentPostmortemStatus, a drag-ordered list like the incident states:
 * Common/Utils/StateOrder). What a status counts as follows from where it
 * sits, as an incident state's does:
 *
 *   - Not started: above the draft status - the not started status itself,
 *     and any status of the project's own placed before the draft status.
 *   - In progress: from the draft status down to just above the completed
 *     status - "Draft", and a project's own "In Review".
 *   - Done: the completed status and every status below it - "Completed",
 *     and a project's own "Not Needed". A postmortem that is done is no
 *     longer owed.
 *
 * OneUptime moves a postmortem by itself on three occasions only, and never
 * over a status someone picked in the same write:
 *
 *   - a new incident's postmortem starts in the not started status - or the
 *     draft status when the incident is created with a note, the completed
 *     status when that note is published on a status page
 *     (getStartingStatus);
 *   - writing the note of a postmortem that is not started moves it to the
 *     draft status (getAutomaticMove) - a person writing it, a template or
 *     OneUptime AI drafting it;
 *   - publishing it on a status page moves a postmortem that is not done to
 *     the completed status: what the status page shows is the finished
 *     write-up.
 *
 * It never moves a postmortem back: clearing the note, or taking it off the
 * status page, leaves its status where it is. People move it anywhere else
 * - "In Review", back to "Draft" for another look, "Not Needed".
 *
 * Statuses are read as the server and the dashboard hold them: models or
 * their JSON, each with its id, its place and its built-in flags. No
 * database and no React here, so the server that moves postmortems, the
 * Postmortems list that counts them and the tests read the same rule.
 */

export enum PostmortemProgress {
  NotStarted = "NotStarted",
  InProgress = "InProgress",
  Done = "Done",
}

// The built-in statuses, by the flag that marks each.
export const NOT_STARTED_STATUS_FLAG: string = "isNotStartedStatus";
export const DRAFT_STATUS_FLAG: string = "isDraftStatus";
export const COMPLETED_STATUS_FLAG: string = "isCompletedStatus";

// A status a new project starts with (ProjectService).
export interface DefaultPostmortemStatus {
  name: string;
  description: string;
  color: Color;
  order: number;
  // The built-in flag it carries, if it is a built-in status.
  flag?: string | undefined;
}

/*
 * A new project's postmortem statuses: the fewest that answer "which
 * postmortems are still owed?" - not started and draft are owed, completed
 * and not needed are not. A project adds its own ("In Review") under
 * Incidents > Settings > Postmortem Statuses; each goes just above
 * Completed.
 */
export const DEFAULT_POSTMORTEM_STATUSES: ReadonlyArray<DefaultPostmortemStatus> =
  [
    {
      name: "Not Started",
      description: "Nobody has written this postmortem yet.",
      color: Gray500,
      order: 1,
      flag: NOT_STARTED_STATUS_FLAG,
    },
    {
      name: "Draft",
      description: "The postmortem is being written.",
      color: Yellow,
      order: 2,
      flag: DRAFT_STATUS_FLAG,
    },
    {
      name: "Completed",
      description: "The postmortem is written and done.",
      color: Green,
      order: 3,
      flag: COMPLETED_STATUS_FLAG,
    },
    {
      name: "Not Needed",
      description: "This incident does not need a postmortem.",
      color: VeryLightGray,
      order: 4,
    },
  ];

/*
 * What the update that writes an incident does to its postmortem, as
 * getAutomaticMove reads it: the postmortem as stored before the write
 * (undefined for an incident the read before the write did not see, which
 * then counts as not written and not published), what the update writes,
 * and the status the incident's postmortem was in.
 */
export interface PostmortemStatusMoveInput {
  // The project's postmortem statuses: models or their JSON.
  statuses: Array<unknown>;
  stored: IncidentPostmortemState | undefined | null;
  written: Record<string, unknown>;
  // The status the postmortem was in before the update; null when it had none.
  statusIdBefore: ObjectID | string | null | undefined;
}

const DEFINITION: StateListDefinition =
  STATE_LISTS[StateListType.IncidentPostmortemStatus];

export default class PostmortemStatusUtil {
  // The statuses as StateOrder reads them, in the order given.
  public static toRows(statuses: Array<unknown>): Array<StateListRow> {
    return statuses.map((status: unknown): StateListRow => {
      return toStateListRow(DEFINITION, status);
    });
  }

  // An id as the statuses' rows hold it, lower case; "" for none.
  public static toId(id: ObjectID | string | null | undefined): string {
    if (!id) {
      return "";
    }

    return id.toString().trim().toLowerCase();
  }

  // The status carrying `flag` - the first from the top - or null.
  private static getBuiltInStatus<T>(statuses: Array<T>, flag: string): T | null {
    const rows: Array<StateListRow> = this.toRows(statuses);
    const row: StateListRow | undefined = getStateListBuiltInRows(
      DEFINITION,
      rows,
    )[flag];

    if (!row) {
      return null;
    }

    const index: number = rows.indexOf(row);

    return index >= 0 ? (statuses[index] as T) : null;
  }

  // The status a new incident's postmortem starts in.
  public static getNotStartedStatus<T>(statuses: Array<T>): T | null {
    return this.getBuiltInStatus(statuses, NOT_STARTED_STATUS_FLAG);
  }

  // The status writing a postmortem's note moves it to.
  public static getDraftStatus<T>(statuses: Array<T>): T | null {
    return this.getBuiltInStatus(statuses, DRAFT_STATUS_FLAG);
  }

  // The status publishing a postmortem moves it to: from it down, done.
  public static getCompletedStatus<T>(statuses: Array<T>): T | null {
    return this.getBuiltInStatus(statuses, COMPLETED_STATUS_FLAG);
  }

  /*
   * What a postmortem in `statusId` counts as, by where the status sits
   * (getStateListReachedBuiltIn): null for a status that is none of the
   * project's. A postmortem with no status yet - an incident from before
   * statuses, until it is given one - is not started.
   */
  public static getProgress(data: {
    statuses: Array<unknown>;
    statusId: ObjectID | string | null | undefined;
  }): PostmortemProgress | null {
    const statusId: string = this.toId(data.statusId);

    if (!statusId) {
      return PostmortemProgress.NotStarted;
    }

    const rows: Array<StateListRow> = this.toRows(data.statuses);

    const row: StateListRow | undefined = rows.find(
      (candidate: StateListRow): boolean => {
        return candidate.id.toLowerCase() === statusId;
      },
    );

    if (!row) {
      return null;
    }

    return this.getRowProgress(rows, row);
  }

  private static getRowProgress(
    rows: Array<StateListRow>,
    row: StateListRow,
  ): PostmortemProgress {
    const reached: string | null = getStateListReachedBuiltIn(
      DEFINITION,
      rows,
      row,
    );

    if (reached === COMPLETED_STATUS_FLAG) {
      return PostmortemProgress.Done;
    }

    if (reached === DRAFT_STATUS_FLAG) {
      return PostmortemProgress.InProgress;
    }

    return PostmortemProgress.NotStarted;
  }

  /*
   * The statuses, top first, each with what it counts as: what the
   * Postmortems list, its counts and its filters are built from.
   */
  public static getStatusesWithProgress<T>(
    statuses: Array<T>,
  ): Array<{ status: T; progress: PostmortemProgress }> {
    const rows: Array<StateListRow> = this.toRows(statuses);

    return sortStateListRows(rows).map(
      (row: StateListRow): { status: T; progress: PostmortemProgress } => {
        return {
          status: statuses[rows.indexOf(row)] as T,
          progress: this.getRowProgress(rows, row),
        };
      },
    );
  }

  /*
   * The ids of the statuses a postmortem is still owed in - not started or
   * in progress - top first.
   */
  public static getOwedStatusIds(statuses: Array<unknown>): Array<string> {
    return this.getStatusIdsBy(statuses, (progress: PostmortemProgress) => {
      return progress !== PostmortemProgress.Done;
    });
  }

  // The ids of the statuses a postmortem is done in, top first.
  public static getDoneStatusIds(statuses: Array<unknown>): Array<string> {
    return this.getStatusIdsBy(statuses, (progress: PostmortemProgress) => {
      return progress === PostmortemProgress.Done;
    });
  }

  private static getStatusIdsBy(
    statuses: Array<unknown>,
    isWanted: (progress: PostmortemProgress) => boolean,
  ): Array<string> {
    return this.getStatusesWithProgress(statuses)
      .filter((entry: { status: unknown; progress: PostmortemProgress }) => {
        return isWanted(entry.progress);
      })
      .map((entry: { status: unknown; progress: PostmortemProgress }) => {
        return toStateListRow(DEFINITION, entry.status).id;
      })
      .filter((id: string): boolean => {
        return Boolean(id);
      });
  }

  /*
   * Where a new incident's postmortem starts, when its create names no
   * status: completed when the incident is created with its postmortem
   * published, draft when created with a note, not started otherwise. Null
   * when the project has no such status (a project from before statuses,
   * until its defaults are added).
   */
  public static getStartingStatus<T>(data: {
    statuses: Array<T>;
    postmortem: IncidentPostmortemState;
  }): T | null {
    if (IncidentPostmortemPublication.isPublished(data.postmortem)) {
      return (
        this.getCompletedStatus(data.statuses) ||
        this.getNotStartedStatus(data.statuses)
      );
    }

    if (IncidentPostmortemPublication.hasNote(data.postmortem.postmortemNote)) {
      return (
        this.getDraftStatus(data.statuses) ||
        this.getNotStartedStatus(data.statuses)
      );
    }

    return this.getNotStartedStatus(data.statuses);
  }

  // Whether an update writes the postmortem's status, under either name.
  public static isStatusWrittenBy(
    written: Record<string, unknown> | undefined | null,
  ): boolean {
    if (!written) {
      return false;
    }

    return (
      written["postmortemStatusId"] !== undefined ||
      written["postmortemStatus"] !== undefined
    );
  }

  /*
   * Whether the update gives a postmortem that had no note its first one:
   * what moves a postmortem that is not started to the draft status.
   */
  public static isNoteStartedBy(data: {
    stored: IncidentPostmortemState | undefined | null;
    written: Record<string, unknown>;
  }): boolean {
    if (data.written["postmortemNote"] === undefined) {
      return false;
    }

    return (
      !IncidentPostmortemPublication.hasNote(data.stored?.postmortemNote) &&
      IncidentPostmortemPublication.hasNote(
        IncidentPostmortemPublication.getStateAfterUpdate(data).postmortemNote,
      )
    );
  }

  /*
   * The status OneUptime moves a postmortem to once an update is written,
   * or null when it stays where it is (see the rule at the top):
   *
   *   - the update picked a status itself: that one stands;
   *   - the update publishes the postmortem on a status page: the completed
   *     status, unless it is done already ("Completed", "Not Needed");
   *   - the update writes the first note of a postmortem that is not
   *     started: the draft status.
   *
   * Never the status it is in already. A status that is none of the
   * project's (null progress) is left alone: nothing about it is known.
   */
  public static getAutomaticMove<T>(
    data: PostmortemStatusMoveInput & { statuses: Array<T> },
  ): T | null {
    if (this.isStatusWrittenBy(data.written)) {
      return null;
    }

    const progress: PostmortemProgress | null = this.getProgress({
      statuses: data.statuses,
      statusId: data.statusIdBefore,
    });

    if (progress === null) {
      return null;
    }

    let target: T | null = null;

    if (
      IncidentPostmortemPublication.isPublishedByUpdate({
        stored: data.stored,
        written: data.written,
      })
    ) {
      if (progress !== PostmortemProgress.Done) {
        target = this.getCompletedStatus(data.statuses);
      }
    } else if (
      progress === PostmortemProgress.NotStarted &&
      this.isNoteStartedBy({ stored: data.stored, written: data.written })
    ) {
      target = this.getDraftStatus(data.statuses);
    }

    if (!target) {
      return null;
    }

    const targetId: string = toStateListRow(DEFINITION, target).id;

    if (!targetId || targetId.toLowerCase() === this.toId(data.statusIdBefore)) {
      return null;
    }

    return target;
  }
}
