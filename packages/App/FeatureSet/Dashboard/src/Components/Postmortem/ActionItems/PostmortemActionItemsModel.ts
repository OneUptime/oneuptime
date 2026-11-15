import IncidentPostmortemActionItem from "Common/Models/DatabaseModels/IncidentPostmortemActionItem";
import Select from "Common/Types/BaseDatabase/Select";
import ColumnLength from "Common/Types/Database/ColumnLength";
import PostmortemActionItemStatus, {
  PostmortemActionItemStatusUtil,
} from "Common/Types/Incident/PostmortemActionItemStatus";
import PostmortemNoteActionItems, {
  PostmortemNoteActionItem,
} from "Common/Utils/Incident/PostmortemNoteActionItems";

/*
 * A postmortem's action items (IncidentPostmortemActionItem, #6801), as the
 * Postmortem page and Incidents > Action Items read them: the items in the
 * order they were added, how many are done, the items the note lists that
 * are not tracked yet, when one is due or overdue, and what a monitor made
 * for one starts with. React-free, so the rules are pinned in a plain test.
 */

// The most action items an incident's page reads at once: far more than a postmortem has.
export const POSTMORTEM_ACTION_ITEMS_LIMIT: number = 200;

// The most of the note's untracked items the suggestion names before it counts the rest.
export const MAX_UNTRACKED_TITLES_SHOWN: number = 3;

// What the Postmortem page reads of each item.
export const POSTMORTEM_ACTION_ITEM_SELECT: Select<IncidentPostmortemActionItem> =
  {
    _id: true,
    title: true,
    description: true,
    status: true,
    dueDate: true,
    closedAt: true,
    createdAt: true,
    codeTaskId: true,
    ownerUserId: true,
    ownerUser: {
      _id: true,
      name: true,
      email: true,
      profilePictureId: true,
    },
    closedByUserId: true,
    closedByUser: {
      _id: true,
      name: true,
      email: true,
    },
    monitorId: true,
    monitor: {
      _id: true,
      name: true,
    },
  };

// The most an action item's title holds, for the field that takes it.
export const POSTMORTEM_ACTION_ITEM_TITLE_LIMIT: number = ColumnLength.LongText;

/*
 * A new action item's title as it is sent: on one line, trimmed, and
 * nothing when it is empty or longer than an item keeps (the server says
 * the same).
 */
export function readNewActionItemTitle(value: string): string | null {
  const title: string = value.replace(/\s+/g, " ").trim();

  if (!title || title.length > POSTMORTEM_ACTION_ITEM_TITLE_LIMIT) {
    return null;
  }

  return title;
}

export interface ActionItemProgress {
  done: number;
  total: number;
}

/*
 * How many of the items are done, of those still meant to be done: an item
 * the team decided not to do is no longer counted either way.
 */
export function getActionItemProgress(
  items: ReadonlyArray<Pick<IncidentPostmortemActionItem, "status">>,
): ActionItemProgress {
  const counted: Array<Pick<IncidentPostmortemActionItem, "status">> =
    items.filter(
      (item: Pick<IncidentPostmortemActionItem, "status">): boolean => {
        return item.status !== PostmortemActionItemStatus.WontDo;
      },
    );

  return {
    done: counted.filter(
      (item: Pick<IncidentPostmortemActionItem, "status">): boolean => {
        return item.status === PostmortemActionItemStatus.Done;
      },
    ).length,
    total: counted.length,
  };
}

/*
 * The items the postmortem's note lists that the incident does not track
 * yet, as the server will track them (PostmortemNoteActionItems): what the
 * page offers to track.
 */
export function getUntrackedNoteItems(
  note: string | null | undefined,
  items: ReadonlyArray<Pick<IncidentPostmortemActionItem, "title">>,
): Array<PostmortemNoteActionItem> {
  return PostmortemNoteActionItems.getUntracked({
    items: PostmortemNoteActionItems.read(note),
    trackedTitles: items.map(
      (item: Pick<IncidentPostmortemActionItem, "title">): string => {
        return item.title || "";
      },
    ),
  });
}

export enum ActionItemDueState {
  // No due date, or closed.
  None = "None",
  Due = "Due",
  Overdue = "Overdue",
}

// When an item is due, as its row says it.
export function getActionItemDueState(
  item: Pick<IncidentPostmortemActionItem, "status" | "dueDate">,
  now: Date,
): ActionItemDueState {
  if (!item.dueDate || PostmortemActionItemStatusUtil.isClosed(item.status)) {
    return ActionItemDueState.None;
  }

  return PostmortemActionItemStatusUtil.isOverdue({
    status: item.status,
    dueDate: item.dueDate,
    now,
  })
    ? ActionItemDueState.Overdue
    : ActionItemDueState.Due;
}

/*
 * Create Monitor from an action item: the query parameter that carries it
 * to the Create Monitor page, which names the monitor after it and, once
 * the monitor is created, names the monitor on the item and marks it done.
 */
export const ACTION_ITEM_MONITOR_QUERY_PARAM: string = "postmortemActionItemId";

// A monitor's name from an action item's title: at most what a monitor's name holds.
export function getActionItemMonitorName(title: string): string {
  const name: string = title.replace(/\s+/g, " ").trim();

  return name.length > ColumnLength.ShortText
    ? `${name.slice(0, ColumnLength.ShortText - 1).trimEnd()}…`
    : name;
}
