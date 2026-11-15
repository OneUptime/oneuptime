/*
 * WHERE A POSTMORTEM'S ACTION ITEM STANDS (issue #6801).
 *
 *   - Open: still to do. A new action item starts open, and so does one
 *     reopened.
 *   - Done: done - ticked off by a person, or by OneUptime when the pull
 *     request OneUptime AI opened for it merges, or the monitor made for it
 *     is created.
 *   - Won't Do: the team decided not to do it. It is no longer owed, and
 *     says so instead of being deleted, so the postmortem keeps the
 *     decision.
 *
 * Done and Won't Do both close the item: who closed it and when are
 * OneUptime's to write (IncidentPostmortemActionItemService), and reopening
 * it clears them. "In progress" is not a status: a pull request OneUptime AI
 * is writing or has opened says so on the item itself.
 */
enum PostmortemActionItemStatus {
  Open = "Open",
  Done = "Done",
  WontDo = "WontDo",
}

export default PostmortemActionItemStatus;

const ONE_DAY_IN_MS: number = 24 * 60 * 60 * 1000;

export const ALL_POSTMORTEM_ACTION_ITEM_STATUSES: ReadonlyArray<PostmortemActionItemStatus> =
  [
    PostmortemActionItemStatus.Open,
    PostmortemActionItemStatus.Done,
    PostmortemActionItemStatus.WontDo,
  ];

/*
 * Each status as people read it, in English: the Dashboard looks each up in
 * the reader's language. Open reads "To Do": in many languages "Open" is
 * the verb, a button's word, and a status that says "Open!" is a command.
 */
export const POSTMORTEM_ACTION_ITEM_STATUS_NAMES: Readonly<
  Record<PostmortemActionItemStatus, string>
> = {
  [PostmortemActionItemStatus.Open]: "To Do",
  [PostmortemActionItemStatus.Done]: "Done",
  [PostmortemActionItemStatus.WontDo]: "Won't Do",
};

export class PostmortemActionItemStatusUtil {
  // Reads a status off the wire: anything this build does not know is Open.
  public static parse(value: unknown): PostmortemActionItemStatus {
    if (
      typeof value === "string" &&
      (ALL_POSTMORTEM_ACTION_ITEM_STATUSES as ReadonlyArray<string>).includes(
        value,
      )
    ) {
      return value as PostmortemActionItemStatus;
    }

    return PostmortemActionItemStatus.Open;
  }

  // Done or Won't Do: no longer owed.
  public static isClosed(
    status: PostmortemActionItemStatus | undefined,
  ): boolean {
    return (
      status === PostmortemActionItemStatus.Done ||
      status === PostmortemActionItemStatus.WontDo
    );
  }

  /*
   * Whether an item is past its due date: open, and its due day is over. A
   * due date is the start of its day in the time zone of whoever set it
   * (the Due Date picker), so the day is over a day after it.
   */
  public static isOverdue(data: {
    status: PostmortemActionItemStatus | undefined;
    dueDate: Date | string | null | undefined;
    now: Date;
  }): boolean {
    if (PostmortemActionItemStatusUtil.isClosed(data.status) || !data.dueDate) {
      return false;
    }

    const due: Date =
      data.dueDate instanceof Date ? data.dueDate : new Date(data.dueDate);

    if (isNaN(due.getTime())) {
      return false;
    }

    return data.now.getTime() >= due.getTime() + ONE_DAY_IN_MS;
  }
}
