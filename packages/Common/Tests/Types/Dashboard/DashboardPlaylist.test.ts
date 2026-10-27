import {
  DASHBOARD_PLAYLIST_DASHBOARDS_SHAPE_PROBLEM,
  DASHBOARD_PLAYLIST_DEFAULT_INTERVAL_IN_SECONDS,
  DASHBOARD_PLAYLIST_INTERVAL_CHOICES_IN_SECONDS,
  DASHBOARD_PLAYLIST_INTERVAL_PROBLEM,
  DASHBOARD_PLAYLIST_MAX_DASHBOARDS,
  DASHBOARD_PLAYLIST_MAX_INTERVAL_IN_SECONDS,
  DASHBOARD_PLAYLIST_MIN_INTERVAL_IN_SECONDS,
  DASHBOARD_PLAYLIST_TOO_MANY_DASHBOARDS_PROBLEM,
  DashboardPlaylistDashboard,
  getDashboardPlaylistDashboardsProblem,
  getDashboardPlaylistEntryProblem,
  getDashboardPlaylistIntervalChoices,
  getDashboardPlaylistIntervalProblem,
  isDashboardPlaylistIntervalInSeconds,
  isSameDashboardId,
  readDashboardPlaylistDashboards,
  readDashboardPlaylistIntervalInSeconds,
  toStoredDashboardPlaylistDashboards,
} from "../../../Types/Dashboard/DashboardPlaylist";
import { describe, expect, test } from "@jest/globals";

/*
 * A dashboard playlist's stored settings (issue #5235): the ordered list of
 * the dashboards it shows, and how long each is shown. Reading is lenient -
 * a reader never fails on a value it did not write - and a write is held to
 * exactly the shape the player reads, so an API or Terraform user hears at
 * once what a reader would have skipped.
 */

const A: string = "5f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e";
const B: string = "11111111-2222-4333-8444-555555555555";
const C: string = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

const entry: (dashboardId: string) => DashboardPlaylistDashboard = (
  dashboardId: string,
): DashboardPlaylistDashboard => {
  return { dashboardId: dashboardId };
};

describe("the playlist's limits", () => {
  test("the interval runs from ten seconds to a day, a minute by default", () => {
    expect(DASHBOARD_PLAYLIST_MIN_INTERVAL_IN_SECONDS).toBe(10);
    expect(DASHBOARD_PLAYLIST_MAX_INTERVAL_IN_SECONDS).toBe(86400);
    expect(DASHBOARD_PLAYLIST_DEFAULT_INTERVAL_IN_SECONDS).toBe(60);
  });

  test("the form's choices are in order, inside the limits, and the default is one of them", () => {
    const choices: Array<number> = [
      ...DASHBOARD_PLAYLIST_INTERVAL_CHOICES_IN_SECONDS,
    ];

    expect(choices).toEqual([15, 30, 60, 120, 300, 600, 900, 1800, 3600]);
    expect(choices).toContain(DASHBOARD_PLAYLIST_DEFAULT_INTERVAL_IN_SECONDS);

    for (const seconds of choices) {
      expect(isDashboardPlaylistIntervalInSeconds(seconds)).toBe(true);
    }

    expect([...choices].sort((a: number, b: number) => a - b)).toEqual(choices);
  });

  test("a playlist holds at most a hundred dashboards", () => {
    expect(DASHBOARD_PLAYLIST_MAX_DASHBOARDS).toBe(100);
    expect(DASHBOARD_PLAYLIST_TOO_MANY_DASHBOARDS_PROBLEM).toContain("100");
  });
});

describe("reading a playlist's dashboards", () => {
  test("keeps the stored order, and a dashboard named more than once", () => {
    expect(
      readDashboardPlaylistDashboards([entry(B), entry(A), entry(B)]),
    ).toEqual([entry(B), entry(A), entry(B)]);
  });

  test("reads nothing - null, undefined, empty text - as an empty playlist", () => {
    expect(readDashboardPlaylistDashboards(null)).toEqual([]);
    expect(readDashboardPlaylistDashboards(undefined)).toEqual([]);
    expect(readDashboardPlaylistDashboards("")).toEqual([]);
    expect(readDashboardPlaylistDashboards("   ")).toEqual([]);
    expect(readDashboardPlaylistDashboards([])).toEqual([]);
  });

  test("reads the list from JSON text, as a form or an API client may send it", () => {
    expect(
      readDashboardPlaylistDashboards(JSON.stringify([entry(A), entry(C)])),
    ).toEqual([entry(A), entry(C)]);
  });

  test("leaves out every entry that names no dashboard, without failing", () => {
    expect(
      readDashboardPlaylistDashboards([
        entry(A),
        "not an entry",
        null,
        42,
        { dashboardId: "project-1" },
        { dashboardId: 7 },
        { somethingElse: B },
        [entry(B)],
        entry(C),
      ]),
    ).toEqual([entry(A), entry(C)]);
  });

  test("reads a value that is no list, or JSON text of something else, as an empty playlist", () => {
    expect(readDashboardPlaylistDashboards({ dashboardId: A })).toEqual([]);
    expect(readDashboardPlaylistDashboards("{not json")).toEqual([]);
    expect(readDashboardPlaylistDashboards('{"dashboardId":"x"}')).toEqual([]);
    expect(readDashboardPlaylistDashboards(12)).toEqual([]);
    expect(readDashboardPlaylistDashboards(true)).toEqual([]);
  });

  test("keeps an id as stored, in any case, and copies each entry", () => {
    const stored: Array<DashboardPlaylistDashboard> = [
      { dashboardId: A.toUpperCase() },
    ];
    const read: Array<DashboardPlaylistDashboard> =
      readDashboardPlaylistDashboards(stored);

    expect(read).toEqual([{ dashboardId: A.toUpperCase() }]);
    expect(read[0]).not.toBe(stored[0]);
  });

  test("drops the extra keys an entry carries", () => {
    expect(
      readDashboardPlaylistDashboards([{ dashboardId: A, note: "lobby" }]),
    ).toEqual([entry(A)]);
  });

  test("reads at most a hundred dashboards", () => {
    const many: Array<DashboardPlaylistDashboard> = Array.from(
      { length: 150 },
      () => {
        return entry(A);
      },
    );

    expect(readDashboardPlaylistDashboards(many)).toHaveLength(100);
  });
});

describe("a write's dashboards", () => {
  test("accepts a list of entries, an empty list, nothing at all and its JSON text", () => {
    expect(getDashboardPlaylistDashboardsProblem([entry(A)])).toBeNull();
    expect(
      getDashboardPlaylistDashboardsProblem([entry(A), entry(B), entry(A)]),
    ).toBeNull();
    expect(getDashboardPlaylistDashboardsProblem([])).toBeNull();
    expect(getDashboardPlaylistDashboardsProblem(null)).toBeNull();
    expect(getDashboardPlaylistDashboardsProblem(undefined)).toBeNull();
    expect(
      getDashboardPlaylistDashboardsProblem(JSON.stringify([entry(B)])),
    ).toBeNull();
  });

  test("refuses a value that is no list, saying what one looks like", () => {
    for (const value of [
      { dashboardId: A },
      "{not json",
      '{"dashboardId": "x"}',
      42,
      true,
    ]) {
      expect(getDashboardPlaylistDashboardsProblem(value)).toBe(
        DASHBOARD_PLAYLIST_DASHBOARDS_SHAPE_PROBLEM,
      );
    }

    expect(DASHBOARD_PLAYLIST_DASHBOARDS_SHAPE_PROBLEM).toContain(
      '[{"dashboardId": "<dashboard id>"}]',
    );
  });

  test("refuses more than a hundred dashboards", () => {
    const many: Array<DashboardPlaylistDashboard> = Array.from(
      { length: 101 },
      () => {
        return entry(B);
      },
    );

    expect(getDashboardPlaylistDashboardsProblem(many)).toBe(
      DASHBOARD_PLAYLIST_TOO_MANY_DASHBOARDS_PROBLEM,
    );
    expect(
      getDashboardPlaylistDashboardsProblem(many.slice(0, 100)),
    ).toBeNull();
  });

  test("names the first entry that is no dashboard, counting from one", () => {
    expect(
      getDashboardPlaylistDashboardsProblem([entry(A), entry(B), "C"]),
    ).toBe(getDashboardPlaylistEntryProblem(2));
    expect(getDashboardPlaylistEntryProblem(2)).toContain("Dashboard 3 ");
    expect(
      getDashboardPlaylistDashboardsProblem([{ dashboardId: "project-1" }]),
    ).toBe(getDashboardPlaylistEntryProblem(0));
    expect(getDashboardPlaylistDashboardsProblem([null])).toBe(
      getDashboardPlaylistEntryProblem(0),
    );
    expect(getDashboardPlaylistDashboardsProblem([[A]])).toBe(
      getDashboardPlaylistEntryProblem(0),
    );
  });

  test("refuses an entry with keys besides the dashboard's id, so the shape can grow later", () => {
    expect(
      getDashboardPlaylistDashboardsProblem([
        entry(A),
        { dashboardId: B, intervalInSeconds: 20 },
      ]),
    ).toBe(getDashboardPlaylistEntryProblem(1));
  });

  test("stores the list it checked: JSON text as its list, nothing as an empty one", () => {
    expect(
      toStoredDashboardPlaylistDashboards(JSON.stringify([entry(A)])),
    ).toEqual([entry(A)]);
    expect(toStoredDashboardPlaylistDashboards(null)).toEqual([]);
    expect(toStoredDashboardPlaylistDashboards([entry(B), entry(A)])).toEqual([
      entry(B),
      entry(A),
    ]);
  });
});

describe("how long each dashboard is shown", () => {
  test("a write takes a whole number of seconds from ten to a day", () => {
    for (const seconds of [10, 11, 60, 3600, 86400]) {
      expect(getDashboardPlaylistIntervalProblem(seconds)).toBeNull();
    }
  });

  test("a write leaving it out keeps what is stored", () => {
    expect(getDashboardPlaylistIntervalProblem(undefined)).toBeNull();
  });

  test("a write is refused anything else, with the range in its words", () => {
    for (const value of [
      9,
      0,
      -60,
      86401,
      1.5,
      "60",
      null,
      NaN,
      Infinity,
      {},
    ]) {
      expect(getDashboardPlaylistIntervalProblem(value)).toBe(
        DASHBOARD_PLAYLIST_INTERVAL_PROBLEM,
      );
    }

    expect(DASHBOARD_PLAYLIST_INTERVAL_PROBLEM).toContain("10");
    expect(DASHBOARD_PLAYLIST_INTERVAL_PROBLEM).toContain("86400");
  });

  test("a reader holds a stored time to the limits, and reads a missing one as a minute", () => {
    expect(readDashboardPlaylistIntervalInSeconds(45)).toBe(45);
    expect(readDashboardPlaylistIntervalInSeconds(2)).toBe(10);
    expect(readDashboardPlaylistIntervalInSeconds(999999)).toBe(86400);
    expect(readDashboardPlaylistIntervalInSeconds(30.4)).toBe(30);
    expect(readDashboardPlaylistIntervalInSeconds(undefined)).toBe(60);
    expect(readDashboardPlaylistIntervalInSeconds(null)).toBe(60);
    expect(readDashboardPlaylistIntervalInSeconds("30")).toBe(60);
    expect(readDashboardPlaylistIntervalInSeconds(NaN)).toBe(60);
  });

  test("the form offers the playlist's own time among its choices when the API set another", () => {
    expect(getDashboardPlaylistIntervalChoices()).toEqual([
      ...DASHBOARD_PLAYLIST_INTERVAL_CHOICES_IN_SECONDS,
    ]);
    expect(getDashboardPlaylistIntervalChoices(60)).toEqual([
      ...DASHBOARD_PLAYLIST_INTERVAL_CHOICES_IN_SECONDS,
    ]);
    expect(getDashboardPlaylistIntervalChoices(45)).toEqual([
      15, 30, 45, 60, 120, 300, 600, 900, 1800, 3600,
    ]);
    expect(getDashboardPlaylistIntervalChoices(7200)).toEqual([
      15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200,
    ]);
    // A time no write could have stored is not offered.
    expect(getDashboardPlaylistIntervalChoices(5)).toEqual([
      ...DASHBOARD_PLAYLIST_INTERVAL_CHOICES_IN_SECONDS,
    ]);
    expect(getDashboardPlaylistIntervalChoices(null)).toEqual([
      ...DASHBOARD_PLAYLIST_INTERVAL_CHOICES_IN_SECONDS,
    ]);
  });
});

describe("telling dashboards apart", () => {
  test("ids are compared without regard to case, as the API compares them", () => {
    expect(isSameDashboardId(A, A.toUpperCase())).toBe(true);
    expect(isSameDashboardId(A, B)).toBe(false);
  });
});
