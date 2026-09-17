import { describe, expect, test, beforeEach } from "@jest/globals";
import { queryClient } from "./queryClient";

/*
 * The shared cache and the one operation that has security consequences.
 *
 * Entries live for a day by default, which is why emptying it on sign-out is
 * not housekeeping: a personal calendar feed's URL IS its access control, and
 * an entry holding one must not outlive the session that fetched it.
 */

describe("the app's query client", () => {
  beforeEach((): void => {
    queryClient.clear();
  });

  test("keeps entries long enough for a handover to matter", () => {
    expect(queryClient.getDefaultOptions().queries?.gcTime).toBe(
      1000 * 60 * 60 * 24,
    );
  });

  test("queryClient.clear() removes every entry", () => {
    queryClient.setQueryData(["oncall", "calendar-feed", "user-a", "p1"], {
      urls: { https: "https://h/api/on-call-calendar/user/secret/shifts.ics" },
    });
    queryClient.setQueryData(["alerts", "p1"], [{ _id: "alert-1" }]);

    expect(queryClient.getQueryCache().getAll()).toHaveLength(2);

    queryClient.clear();

    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(
      queryClient.getQueryData(["oncall", "calendar-feed", "user-a", "p1"]),
    ).toBeUndefined();
  });

  test("clearing an empty cache is a no-op, not a throw", () => {
    expect((): void => {
      queryClient.clear();
    }).not.toThrow();
  });
});
