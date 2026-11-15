import {
  ACTION_ITEM_MONITOR_QUERY_PARAM,
  ActionItemDueState,
  getActionItemDueState,
  getActionItemMonitorName,
  getActionItemProgress,
  getUntrackedNoteItems,
  POSTMORTEM_ACTION_ITEM_SELECT,
  POSTMORTEM_ACTION_ITEM_TITLE_LIMIT,
  readNewActionItemTitle,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Postmortem/ActionItems/PostmortemActionItemsModel";
import {
  POSTMORTEM_ACTION_ITEM_STATUS_COLORS,
  POSTMORTEM_ACTION_ITEM_STATUS_OPTIONS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Postmortem/ActionItems/PostmortemActionItemsTable";
import IncidentPostmortemActionItem from "../../../Models/DatabaseModels/IncidentPostmortemActionItem";
import { Gray500, Green, Yellow } from "../../../Types/BrandColors";
import ColumnLength from "../../../Types/Database/ColumnLength";
import PostmortemActionItemStatus from "../../../Types/Incident/PostmortemActionItemStatus";
import { describe, expect, test } from "@jest/globals";

/*
 * A postmortem's action items as the Postmortem page and Incidents > Action
 * Items read them (#6801): how many are done, what a new one's title is,
 * which of the note's items are not tracked yet, when one is overdue, what a
 * monitor made for one is called, and how the list names and colours the
 * statuses.
 */

function item(
  overrides: Partial<IncidentPostmortemActionItem>,
): IncidentPostmortemActionItem {
  return Object.assign(new IncidentPostmortemActionItem(), overrides);
}

describe("how many are done", () => {
  test("counts the done ones of those still meant to be done", () => {
    expect(
      getActionItemProgress([
        item({ status: PostmortemActionItemStatus.Done }),
        item({ status: PostmortemActionItemStatus.Open }),
        item({ status: PostmortemActionItemStatus.Open }),
      ]),
    ).toEqual({ done: 1, total: 3 });
  });

  test("an item the team decided not to do is counted neither way", () => {
    expect(
      getActionItemProgress([
        item({ status: PostmortemActionItemStatus.Done }),
        item({ status: PostmortemActionItemStatus.WontDo }),
      ]),
    ).toEqual({ done: 1, total: 1 });
  });

  test("none, of none", () => {
    expect(getActionItemProgress([])).toEqual({ done: 0, total: 0 });
  });
});

describe("a new action item's title", () => {
  test("is one line, trimmed", () => {
    expect(readNewActionItemTitle("  Alert on\n pool  usage ")).toBe(
      "Alert on pool usage",
    );
  });

  test("is nothing when empty or longer than an item keeps", () => {
    expect(readNewActionItemTitle("   ")).toBeNull();
    expect(
      readNewActionItemTitle(
        "x".repeat(POSTMORTEM_ACTION_ITEM_TITLE_LIMIT + 1),
      ),
    ).toBeNull();
    expect(POSTMORTEM_ACTION_ITEM_TITLE_LIMIT).toBe(ColumnLength.LongText);
  });
});

describe("the note's items not tracked yet", () => {
  const NOTE: string = `## Action Items
- [x] Increase the pool
- [ ] Alert on pool usage`;

  test("are the ones no action item has the title of", () => {
    expect(
      getUntrackedNoteItems(NOTE, [item({ title: "increase the pool" })]),
    ).toEqual([{ title: "Alert on pool usage", isDone: false }]);
  });

  test("are none for a note with no action items, or none written", () => {
    expect(getUntrackedNoteItems("## Impact\nNone.", [])).toEqual([]);
    expect(getUntrackedNoteItems(undefined, [])).toEqual([]);
  });
});

describe("when one is due", () => {
  // Due on 20 November in UTC: the day is over at midnight.
  const due: Date = new Date("2026-11-20T00:00:00.000Z");

  test("an open item is due until its day is over, then overdue", () => {
    expect(
      getActionItemDueState(
        item({ status: PostmortemActionItemStatus.Open, dueDate: due }),
        new Date("2026-11-20T23:00:00.000Z"),
      ),
    ).toBe(ActionItemDueState.Due);
    expect(
      getActionItemDueState(
        item({ status: PostmortemActionItemStatus.Open, dueDate: due }),
        new Date("2026-11-21T00:00:00.000Z"),
      ),
    ).toBe(ActionItemDueState.Overdue);
  });

  test("a closed item, or one with no due date, says nothing", () => {
    const late: Date = new Date("2027-01-01T00:00:00.000Z");

    expect(
      getActionItemDueState(
        item({ status: PostmortemActionItemStatus.Done, dueDate: due }),
        late,
      ),
    ).toBe(ActionItemDueState.None);
    expect(
      getActionItemDueState(
        item({ status: PostmortemActionItemStatus.Open }),
        late,
      ),
    ).toBe(ActionItemDueState.None);
  });
});

describe("a monitor made for an item", () => {
  test("is named after it, within what a monitor's name holds", () => {
    expect(getActionItemMonitorName(" Alert on\npool usage ")).toBe(
      "Alert on pool usage",
    );

    const long: string = getActionItemMonitorName("y".repeat(300));

    expect(long.length).toBe(ColumnLength.ShortText);
    expect(long.endsWith("…")).toBe(true);
  });

  test("Create Monitor carries the item by one query parameter", () => {
    expect(ACTION_ITEM_MONITOR_QUERY_PARAM).toBe("postmortemActionItemId");
  });
});

describe("what the page reads of each item", () => {
  test("its owner, who closed it, its monitor and its code task, by name", () => {
    expect(POSTMORTEM_ACTION_ITEM_SELECT).toMatchObject({
      title: true,
      status: true,
      dueDate: true,
      closedAt: true,
      codeTaskId: true,
      ownerUser: { name: true, email: true, profilePictureId: true },
      closedByUser: { name: true, email: true },
      monitor: { name: true },
    });
  });
});

describe("the list's statuses", () => {
  test("are offered in their order, by the names people read", () => {
    expect(POSTMORTEM_ACTION_ITEM_STATUS_OPTIONS).toEqual([
      { label: "Open", value: PostmortemActionItemStatus.Open },
      { label: "Done", value: PostmortemActionItemStatus.Done },
      { label: "Won't Do", value: PostmortemActionItemStatus.WontDo },
    ]);
  });

  test("open waits in yellow, done is green, won't do is quiet", () => {
    expect(POSTMORTEM_ACTION_ITEM_STATUS_COLORS).toEqual({
      [PostmortemActionItemStatus.Open]: Yellow,
      [PostmortemActionItemStatus.Done]: Green,
      [PostmortemActionItemStatus.WontDo]: Gray500,
    });
  });
});
