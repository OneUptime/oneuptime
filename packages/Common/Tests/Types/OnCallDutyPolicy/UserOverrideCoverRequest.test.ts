import {
  USER_OVERRIDE_COVER_ENDS_AT_PARAM,
  USER_OVERRIDE_COVER_STARTS_AT_PARAM,
  UserOverrideCoverWindow,
  getUserOverrideCoverQueryParams,
  getUserOverrideCoverWindow,
  readUserOverrideCoverRequest,
} from "../../../Types/OnCallDutyPolicy/UserOverrideCoverRequest";
import Dictionary from "../../../Types/Dictionary";
import { describe, expect, test } from "@jest/globals";

/*
 * "GET COVER" OPENS ADD USER OVERRIDE WITH THE SHIFT FILLED IN: the window
 * a link asks to cover, written into the User Overrides page's address and
 * read back by the page.
 */

const NOW: Date = new Date("2026-09-01T10:00:00.000Z");

const SHIFT_START: string = "2026-09-01T12:00:00.000Z";
const SHIFT_END: string = "2026-09-01T20:00:00.000Z";

function iso(window: UserOverrideCoverWindow | null): Array<string> | null {
  if (!window) {
    return null;
  }

  return [window.startsAt.toISOString(), window.endsAt.toISOString()];
}

describe("the window a shift asks to cover", () => {
  test("is the shift itself while it is still to come", () => {
    expect(
      iso(
        getUserOverrideCoverWindow({
          start: SHIFT_START,
          end: SHIFT_END,
          now: NOW,
        }),
      ),
    ).toEqual([SHIFT_START, SHIFT_END]);
  });

  test("starts now once the shift has started", () => {
    expect(
      iso(
        getUserOverrideCoverWindow({
          start: SHIFT_START,
          end: SHIFT_END,
          now: new Date("2026-09-01T15:30:00.000Z"),
        }),
      ),
    ).toEqual(["2026-09-01T15:30:00.000Z", SHIFT_END]);
  });

  test("is nothing once the shift has ended, or at its very end", () => {
    for (const now of [SHIFT_END, "2026-09-02T00:00:00.000Z"]) {
      expect(
        getUserOverrideCoverWindow({
          start: SHIFT_START,
          end: SHIFT_END,
          now: new Date(now),
        }),
      ).toBeNull();
    }
  });

  test("is nothing for a window that ends before, or as, it starts", () => {
    expect(
      getUserOverrideCoverWindow({
        start: SHIFT_END,
        end: SHIFT_START,
        now: NOW,
      }),
    ).toBeNull();
    expect(
      getUserOverrideCoverWindow({
        start: SHIFT_START,
        end: SHIFT_START,
        now: NOW,
      }),
    ).toBeNull();
  });

  test("is nothing when a time is not a real one", () => {
    for (const [start, end] of [
      [undefined, SHIFT_END],
      [SHIFT_START, null],
      ["", SHIFT_END],
      ["soon", SHIFT_END],
      [SHIFT_START, "later"],
      [12, SHIFT_END],
      [new Date("not a date"), SHIFT_END],
    ] as Array<[unknown, unknown]>) {
      expect(getUserOverrideCoverWindow({ start, end, now: NOW })).toBeNull();
    }
  });

  test("takes Date objects as well as ISO strings", () => {
    expect(
      iso(
        getUserOverrideCoverWindow({
          start: new Date(SHIFT_START),
          end: new Date(SHIFT_END),
          now: NOW,
        }),
      ),
    ).toEqual([SHIFT_START, SHIFT_END]);
  });
});

describe("the link's address", () => {
  const window: UserOverrideCoverWindow = {
    startsAt: new Date(SHIFT_START),
    endsAt: new Date(SHIFT_END),
  };

  test("carries the window as two query parameters", () => {
    const params: Dictionary<string> = getUserOverrideCoverQueryParams(window);

    expect(Object.keys(params)).toEqual([
      USER_OVERRIDE_COVER_STARTS_AT_PARAM,
      USER_OVERRIDE_COVER_ENDS_AT_PARAM,
    ]);
    expect(USER_OVERRIDE_COVER_STARTS_AT_PARAM).toBe("coverStartsAt");
    expect(USER_OVERRIDE_COVER_ENDS_AT_PARAM).toBe("coverEndsAt");
    expect(params[USER_OVERRIDE_COVER_STARTS_AT_PARAM]).toBe(
      "2026-09-01T12%3A00%3A00.000Z",
    );
    expect(params[USER_OVERRIDE_COVER_ENDS_AT_PARAM]).toBe(
      "2026-09-01T20%3A00%3A00.000Z",
    );
  });

  test("is read back by the page as the same window", () => {
    const params: Dictionary<string> = getUserOverrideCoverQueryParams(window);
    const query: URLSearchParams = new URLSearchParams(
      Object.entries(params)
        .map(([key, value]: [string, string]): string => {
          return `${key}=${value}`;
        })
        .join("&"),
    );

    expect(
      iso(
        readUserOverrideCoverRequest({
          startsAt: query.get(USER_OVERRIDE_COVER_STARTS_AT_PARAM),
          endsAt: query.get(USER_OVERRIDE_COVER_ENDS_AT_PARAM),
          now: NOW,
        }),
      ),
    ).toEqual([SHIFT_START, SHIFT_END]);
  });

  test("opened after the shift has started, covers from then", () => {
    expect(
      iso(
        readUserOverrideCoverRequest({
          startsAt: SHIFT_START,
          endsAt: SHIFT_END,
          now: new Date("2026-09-01T13:00:00.000Z"),
        }),
      ),
    ).toEqual(["2026-09-01T13:00:00.000Z", SHIFT_END]);
  });

  test("asks for nothing when a parameter is missing, mangled or stale", () => {
    for (const [startsAt, endsAt, now] of [
      [null, SHIFT_END, NOW],
      [SHIFT_START, undefined, NOW],
      ["tomorrow", SHIFT_END, NOW],
      [SHIFT_START, SHIFT_END, new Date("2026-09-03T00:00:00.000Z")],
    ] as Array<[string | null | undefined, string | null | undefined, Date]>) {
      expect(
        readUserOverrideCoverRequest({ startsAt, endsAt, now }),
      ).toBeNull();
    }
  });
});
