import apiClient from "./client";
import { fetchOnCallSchedules, toOnCallScheduleItem } from "./onCallSchedules";
import { describe, expect, test, beforeEach } from "@jest/globals";
import type { OnCallScheduleItem } from "./types";

jest.mock("./client", () => {
  return {
    __esModule: true,
    default: {
      post: jest.fn(async () => {
        return { data: { data: [] } };
      }),
    },
  };
});

function postSpy(): jest.SpyInstance {
  return apiClient.post as unknown as jest.SpyInstance;
}

function lastCall(): Array<unknown> {
  const calls: Array<Array<unknown>> = postSpy().mock.calls;
  return calls[calls.length - 1]!;
}

/*
 * The roster read is the ONLY source of shift boundaries in the whole feature.
 * Two things can quietly break it: dropping a field from the select (the
 * server returns the column as undefined and the countdown vanishes), and
 * forgetting that Name and Email arrive wrapped as `{_type, value}` while
 * ObjectID and DateTime have already been unwrapped by the client
 * interceptor. Both are asserted below.
 */

const SERIALIZED_NAME: { _type: string; value: string } = {
  _type: "Name",
  value: "Ada Lovelace",
};

const SERIALIZED_EMAIL: { _type: string; value: string } = {
  _type: "Email",
  value: "ada@example.com",
};

describe("fetchOnCallSchedules request", () => {
  beforeEach(() => {
    postSpy().mockClear();
    postSpy().mockResolvedValue({ data: { data: [] } } as never);
  });

  test("scopes the read to one project with the tenant header", async () => {
    await fetchOnCallSchedules("project-1");

    const config: { headers: Record<string, string> } = lastCall()[2] as {
      headers: Record<string, string>;
    };

    expect(config.headers["tenantid"]).toBe("project-1");
  });

  test("asks for every roster field the shift screens render", async () => {
    await fetchOnCallSchedules("project-1");

    const body: { select: Record<string, unknown> } = lastCall()[1] as {
      select: Record<string, unknown>;
    };

    expect(Object.keys(body.select).sort()).toEqual(
      [
        "_id",
        "currentUserOnRoster",
        "name",
        "nextUserOnRoster",
        "rosterHandoffAt",
        "rosterNextHandoffAt",
        "rosterNextStartAt",
        "rosterStartAt",
      ].sort(),
    );
  });
});

describe("fetchOnCallSchedules parsing", () => {
  beforeEach(() => {
    postSpy().mockClear();
  });

  test("unwraps serialized names and emails on the roster users", async () => {
    postSpy().mockResolvedValue({
      data: {
        data: [
          {
            _id: "schedule-1",
            name: { _type: "Name", value: "Primary" },
            currentUserOnRoster: {
              _id: "user-1",
              name: SERIALIZED_NAME,
              email: SERIALIZED_EMAIL,
            },
            rosterHandoffAt: "2026-03-04T09:00:00.000Z",
          },
        ],
      },
    } as never);

    const schedules: OnCallScheduleItem[] =
      await fetchOnCallSchedules("project-1");

    expect(schedules[0]?.name).toBe("Primary");
    expect(schedules[0]?.currentUserOnRoster).toEqual({
      _id: "user-1",
      name: "Ada Lovelace",
      email: "ada@example.com",
    });
  });

  test("a schedule with no roster yet parses to nulls, not to missing keys", async () => {
    /*
     * A schedule with no layers has every roster column null. The screens
     * branch on `=== null`, so a parser that dropped the keys would make an
     * uncovered schedule indistinguishable from a covered one.
     */
    postSpy().mockResolvedValue({
      data: { data: [{ _id: "schedule-1", name: "Empty" }] },
    } as never);

    const schedules: OnCallScheduleItem[] =
      await fetchOnCallSchedules("project-1");

    expect(schedules[0]).toEqual({
      _id: "schedule-1",
      name: "Empty",
      currentUserOnRoster: null,
      nextUserOnRoster: null,
      rosterStartAt: null,
      rosterHandoffAt: null,
      rosterNextStartAt: null,
      rosterNextHandoffAt: null,
    });
  });

  test("drops rows with no id rather than rendering a keyless card", async () => {
    postSpy().mockResolvedValue({
      data: { data: [{ name: "No id" }, { _id: "schedule-2", name: "Fine" }] },
    } as never);

    const schedules: OnCallScheduleItem[] =
      await fetchOnCallSchedules("project-1");

    expect(schedules).toHaveLength(1);
    expect(schedules[0]?._id).toBe("schedule-2");
  });

  test("a response with no data array yields an empty list, not a crash", async () => {
    postSpy().mockResolvedValue({ data: {} } as never);

    await expect(fetchOnCallSchedules("project-1")).resolves.toEqual([]);
  });
});

describe("toOnCallScheduleItem", () => {
  test("names an unnamed schedule rather than rendering a blank row", () => {
    const item: OnCallScheduleItem | null = toOnCallScheduleItem({
      _id: "schedule-1",
    });

    expect(item?.name).toBe("Unnamed schedule");
  });

  test("a roster user with no id is treated as nobody", () => {
    /*
     * A joined user the caller cannot read comes back as an object with the
     * unreadable fields missing. Treating that as "somebody is on call" would
     * hide an uncovered schedule.
     */
    const item: OnCallScheduleItem | null = toOnCallScheduleItem({
      _id: "schedule-1",
      currentUserOnRoster: { name: SERIALIZED_NAME },
    });

    expect(item?.currentUserOnRoster).toBeNull();
  });

  test("rejects non-objects", () => {
    expect(toOnCallScheduleItem(null)).toBeNull();
    expect(toOnCallScheduleItem("schedule")).toBeNull();
  });
});
