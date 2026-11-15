import PostmortemActionItemStatus, {
  ALL_POSTMORTEM_ACTION_ITEM_STATUSES,
  POSTMORTEM_ACTION_ITEM_STATUS_NAMES,
  PostmortemActionItemStatusUtil,
} from "../../../Types/Incident/PostmortemActionItemStatus";
import { describe, expect, test } from "@jest/globals";

/*
 * Where a postmortem's action item stands (#6801): Open, Done or Won't Do,
 * what closes one, and when an open one is overdue.
 */

describe("the statuses", () => {
  test("are Open, Done and Won't Do, each named for people", () => {
    expect([...ALL_POSTMORTEM_ACTION_ITEM_STATUSES]).toEqual([
      PostmortemActionItemStatus.Open,
      PostmortemActionItemStatus.Done,
      PostmortemActionItemStatus.WontDo,
    ]);
    expect(POSTMORTEM_ACTION_ITEM_STATUS_NAMES).toEqual({
      Open: "Open",
      Done: "Done",
      WontDo: "Won't Do",
    });
  });

  test("read off the wire, anything unknown is Open", () => {
    expect(PostmortemActionItemStatusUtil.parse("Done")).toBe(
      PostmortemActionItemStatus.Done,
    );
    expect(PostmortemActionItemStatusUtil.parse("WontDo")).toBe(
      PostmortemActionItemStatus.WontDo,
    );
    expect(PostmortemActionItemStatusUtil.parse("Closed")).toBe(
      PostmortemActionItemStatus.Open,
    );
    expect(PostmortemActionItemStatusUtil.parse(undefined)).toBe(
      PostmortemActionItemStatus.Open,
    );
  });

  test("Done and Won't Do close an item; Open does not", () => {
    expect(
      PostmortemActionItemStatusUtil.isClosed(PostmortemActionItemStatus.Done),
    ).toBe(true);
    expect(
      PostmortemActionItemStatusUtil.isClosed(
        PostmortemActionItemStatus.WontDo,
      ),
    ).toBe(true);
    expect(
      PostmortemActionItemStatusUtil.isClosed(PostmortemActionItemStatus.Open),
    ).toBe(false);
    expect(PostmortemActionItemStatusUtil.isClosed(undefined)).toBe(false);
  });
});

describe("an overdue item", () => {
  // Due on 20 November, in a time zone where that day starts at 23:00 UTC on the 19th.
  const due: Date = new Date("2026-11-19T23:00:00.000Z");

  test("is open, and its due day is over", () => {
    expect(
      PostmortemActionItemStatusUtil.isOverdue({
        status: PostmortemActionItemStatus.Open,
        dueDate: due,
        now: new Date("2026-11-20T23:00:00.000Z"),
      }),
    ).toBe(true);
  });

  test("is not, all through its due day", () => {
    for (const now of [
      "2026-11-19T23:00:00.000Z",
      "2026-11-20T12:00:00.000Z",
      "2026-11-20T22:59:59.000Z",
    ]) {
      expect(
        PostmortemActionItemStatusUtil.isOverdue({
          status: PostmortemActionItemStatus.Open,
          dueDate: due,
          now: new Date(now),
        }),
      ).toBe(false);
    }
  });

  test("is never closed, or without a due date", () => {
    const late: Date = new Date("2027-01-01T00:00:00.000Z");

    for (const status of [
      PostmortemActionItemStatus.Done,
      PostmortemActionItemStatus.WontDo,
    ]) {
      expect(
        PostmortemActionItemStatusUtil.isOverdue({
          status,
          dueDate: due,
          now: late,
        }),
      ).toBe(false);
    }

    expect(
      PostmortemActionItemStatusUtil.isOverdue({
        status: PostmortemActionItemStatus.Open,
        dueDate: null,
        now: late,
      }),
    ).toBe(false);
  });

  test("reads a due date sent as text, and is not for one that is no date", () => {
    expect(
      PostmortemActionItemStatusUtil.isOverdue({
        status: PostmortemActionItemStatus.Open,
        dueDate: "2026-11-19T23:00:00.000Z",
        now: new Date("2026-11-25T00:00:00.000Z"),
      }),
    ).toBe(true);
    expect(
      PostmortemActionItemStatusUtil.isOverdue({
        status: PostmortemActionItemStatus.Open,
        dueDate: "not a date",
        now: new Date("2026-11-25T00:00:00.000Z"),
      }),
    ).toBe(false);
  });
});
