import { describe, expect, test } from "@jest/globals";
import {
  FeedSettings,
  FeedStatus,
  FeedUrls,
  MyShiftsResponse,
  parseFeedSettings,
  parseFeedStatus,
  parseFeedUrls,
  parseMyShifts,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeed/CalendarFeedTypes";
import {
  CALENDAR_FEED_DOCS_PATH,
  GOOGLE_CALENDAR_ADD_URL_PREFIX,
  LeadTimeValidation,
  MY_SHIFTS_PATH,
  NOTHING_FETCHED_HINT_AFTER_HOURS,
  ON_CALL_CALENDAR_API_PATH,
  PERSONAL_FEED_CURRENT_PATH,
  PERSONAL_FEED_ROTATE_PATH,
  PROJECT_FEED_CURRENT_PATH,
  PROJECT_FEED_PUBLISH_PATH,
  PROJECT_FEED_ROTATE_PATH,
  REMINDER_PRESETS,
  ReminderPreset,
  ShiftDayGroup,
  UPCOMING_SHIFTS_CARD_TITLE,
  UPCOMING_SHIFTS_DAYS,
  UpcomingShiftsWindow,
  addScheduleFilter,
  applyScheduleFilter,
  buildGoogleAddUrl,
  formatLeadTime,
  getRotatedDaysAgo,
  getScheduleFeedCurrentPath,
  getScheduleFeedPublishPath,
  getScheduleFeedRotatePath,
  getUpcomingShiftsWindow,
  groupShiftsByDay,
  isCoveringShift,
  shouldShowNothingFetchedHint,
  validateCustomLeadMinutes,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeed/CalendarFeedUtil";
import {
  MAX_MINUTES_BEFORE_SHIFT,
  MIN_MINUTES_BEFORE_SHIFT,
} from "../../../Models/DatabaseModels/UserOnCallShiftReminder";
import { JSONObject } from "../../../Types/JSON";
import {
  DEFAULT_FUTURE_DAYS,
  DEFAULT_PAST_DAYS,
} from "../../../Types/OnCallDutyPolicy/CalendarFeedWindow";
import { MaterializedShiftJson } from "../../../Types/OnCallDutyPolicy/MaterializedShift";

/*
 * The pure half of the calendar-feed dashboard surfaces: route paths, URL
 * shaping, the bookkeeping-line decisions, reminder lead-time rules and the
 * defensive wire parsers. Everything here runs without React, which is what
 * makes it cheap to pin every branch - and every branch here decides
 * something a reader acts on (which link a button opens, whether a "nothing
 * fetched" accusation is shown, whether a lead time is accepted).
 */

const HTTPS_URL: string =
  "https://oneuptime.example.com/api/on-call-calendar/user/abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG/shifts.ics";

const BASE_URLS: FeedUrls = {
  https: HTTPS_URL,
  webcal: HTTPS_URL.replace("https:", "webcals:"),
  googleAdd: `${GOOGLE_CALENDAR_ADD_URL_PREFIX}${encodeURIComponent(HTTPS_URL)}`,
};

type MakeStatusFunction = (overrides?: Partial<FeedStatus>) => FeedStatus;

const makeStatus: MakeStatusFunction = (
  overrides?: Partial<FeedStatus>,
): FeedStatus => {
  return {
    exists: true,
    feedId: "11111111-1111-4111-8111-111111111111",
    isEnabled: true,
    needsRegeneration: false,
    tokenHint: "k3Qx",
    rotatedAt: "2026-08-01T10:00:00.000Z",
    previousTokenExpiresAt: null,
    lastFetchedAt: null,
    lastFetchedClient: null,
    fetchCount: 0,
    lastRenderTruncated: false,
    settings: { pastDays: 2, futureDays: 90 },
    urls: BASE_URLS,
    hostWarning: null,
    protocolWarning: null,
    ...overrides,
  };
};

type MakeShiftFunction = (
  overrides: Partial<MaterializedShiftJson> & { shiftKey: string },
) => MaterializedShiftJson;

const makeShift: MakeShiftFunction = (
  overrides: Partial<MaterializedShiftJson> & { shiftKey: string },
): MaterializedShiftJson => {
  return {
    contentHash: "hash",
    projectId: "project-1",
    scheduleId: "schedule-1",
    scheduleName: "Primary",
    scheduleTimezone: "Europe/Stockholm",
    userId: "user-1",
    userName: "Jane",
    start: "2026-09-01T07:00:00.000Z",
    end: "2026-09-01T15:00:00.000Z",
    coverageSeconds: 8 * 3600,
    policies: [],
    isPast: false,
    lastModifiedAt: "2026-08-30T00:00:00.000Z",
    shiftConfigVersion: 3,
    ...overrides,
  };
};

describe("calendar feed API paths", () => {
  test("every custom route hangs off the /on-call-calendar prefix", () => {
    expect(ON_CALL_CALENDAR_API_PATH).toBe("/on-call-calendar");
    expect(PERSONAL_FEED_CURRENT_PATH).toBe("/on-call-calendar/feed/current");
    expect(PERSONAL_FEED_ROTATE_PATH).toBe("/on-call-calendar/feed/rotate");
    expect(PROJECT_FEED_CURRENT_PATH).toBe(
      "/on-call-calendar/project-feed/current",
    );
    expect(PROJECT_FEED_PUBLISH_PATH).toBe(
      "/on-call-calendar/project-feed/publish",
    );
    expect(PROJECT_FEED_ROTATE_PATH).toBe(
      "/on-call-calendar/project-feed/rotate",
    );
    expect(MY_SHIFTS_PATH).toBe("/on-call-calendar/my-shifts");
  });

  test("schedule feed paths embed the schedule id between the fixed segments", () => {
    const id: string = "22222222-2222-4222-8222-222222222222";

    expect(getScheduleFeedCurrentPath(id)).toBe(
      `/on-call-calendar/schedule-feed/${id}/current`,
    );
    expect(getScheduleFeedPublishPath(id)).toBe(
      `/on-call-calendar/schedule-feed/${id}/publish`,
    );
    expect(getScheduleFeedRotatePath(id)).toBe(
      `/on-call-calendar/schedule-feed/${id}/rotate`,
    );
  });

  test("the docs pointer is the calendar-feeds page under on-call", () => {
    expect(CALENDAR_FEED_DOCS_PATH).toBe("/on-call/calendar-feeds");
  });
});

describe("buildGoogleAddUrl", () => {
  test("url-encodes the whole https link behind Google's cid parameter", () => {
    const result: string = buildGoogleAddUrl(HTTPS_URL);

    expect(
      result.startsWith("https://calendar.google.com/calendar/r?cid="),
    ).toBe(true);
    /*
     * The raw link must not survive un-encoded: its own "?" and "/" would
     * break Google's parameter parsing.
     */
    expect(result).not.toContain(HTTPS_URL);
    expect(decodeURIComponent(result.split("cid=")[1] as string)).toBe(
      HTTPS_URL,
    );
  });
});

describe("addScheduleFilter / applyScheduleFilter", () => {
  test("appends ?schedule= when the URL has no query string", () => {
    expect(addScheduleFilter("https://x.example/a.ics", "sched-1")).toBe(
      "https://x.example/a.ics?schedule=sched-1",
    );
  });

  test("appends &schedule= when a query string is already there", () => {
    expect(
      addScheduleFilter("https://x.example/a.ics?nocache=1", "sched-1"),
    ).toBe("https://x.example/a.ics?nocache=1&schedule=sched-1");
  });

  test("url-encodes the schedule id", () => {
    expect(addScheduleFilter("https://x.example/a.ics", "a b&c")).toBe(
      "https://x.example/a.ics?schedule=a%20b%26c",
    );
  });

  test("applyScheduleFilter returns the same object when there is no schedule", () => {
    expect(applyScheduleFilter(BASE_URLS, null)).toBe(BASE_URLS);
    expect(applyScheduleFilter(BASE_URLS, undefined)).toBe(BASE_URLS);
    expect(applyScheduleFilter(BASE_URLS, "")).toBe(BASE_URLS);
  });

  test("applyScheduleFilter narrows https and webcal, and rebuilds googleAdd from the narrowed https", () => {
    const filtered: FeedUrls = applyScheduleFilter(BASE_URLS, "sched-9");

    expect(filtered.https).toBe(`${HTTPS_URL}?schedule=sched-9`);
    expect(filtered.webcal).toBe(`${BASE_URLS.webcal}?schedule=sched-9`);
    expect(filtered.googleAdd).toBe(
      buildGoogleAddUrl(`${HTTPS_URL}?schedule=sched-9`),
    );
    // The input is left untouched.
    expect(BASE_URLS.https).toBe(HTTPS_URL);
  });
});

describe("getRotatedDaysAgo", () => {
  const now: Date = new Date("2026-08-31T12:00:00.000Z");

  test("null / undefined / garbage give null rather than a number", () => {
    expect(getRotatedDaysAgo(null, now)).toBeNull();
    expect(getRotatedDaysAgo(undefined, now)).toBeNull();
    expect(getRotatedDaysAgo("", now)).toBeNull();
    expect(getRotatedDaysAgo("not a date", now)).toBeNull();
  });

  test("same day is 0, whole days are floored", () => {
    expect(getRotatedDaysAgo("2026-08-31T08:00:00.000Z", now)).toBe(0);
    expect(getRotatedDaysAgo("2026-08-30T13:00:00.000Z", now)).toBe(0);
    expect(getRotatedDaysAgo("2026-08-30T11:59:00.000Z", now)).toBe(1);
    expect(getRotatedDaysAgo("2026-08-01T12:00:00.000Z", now)).toBe(30);
  });

  test("a rotation stamped in the future (clock skew) reads as today, never negative", () => {
    expect(getRotatedDaysAgo("2026-09-05T12:00:00.000Z", now)).toBe(0);
  });
});

describe("shouldShowNothingFetchedHint", () => {
  const rotatedAt: string = "2026-08-01T10:00:00.000Z";
  const wellAfter: Date = new Date("2026-08-10T10:00:00.000Z");
  const justAfter: Date = new Date(
    new Date(rotatedAt).getTime() +
      (NOTHING_FETCHED_HINT_AFTER_HOURS - 1) * 60 * 60 * 1000,
  );
  const exactly: Date = new Date(
    new Date(rotatedAt).getTime() +
      NOTHING_FETCHED_HINT_AFTER_HOURS * 60 * 60 * 1000,
  );

  test("shows once 48 hours have passed with zero fetches", () => {
    expect(NOTHING_FETCHED_HINT_AFTER_HOURS).toBe(48);
    expect(
      shouldShowNothingFetchedHint(makeStatus({ rotatedAt }), wellAfter),
    ).toBe(true);
    expect(
      shouldShowNothingFetchedHint(makeStatus({ rotatedAt }), exactly),
    ).toBe(true);
  });

  test("stays quiet inside the first 48 hours", () => {
    expect(
      shouldShowNothingFetchedHint(makeStatus({ rotatedAt }), justAfter),
    ).toBe(false);
  });

  test("stays quiet when anything has fetched the link", () => {
    expect(
      shouldShowNothingFetchedHint(
        makeStatus({ rotatedAt, fetchCount: 3 }),
        wellAfter,
      ),
    ).toBe(false);
    expect(
      shouldShowNothingFetchedHint(
        makeStatus({ rotatedAt, lastFetchedAt: "2026-08-02T00:00:00.000Z" }),
        wellAfter,
      ),
    ).toBe(false);
  });

  test("stays quiet for a missing, disabled or un-minted link", () => {
    expect(
      shouldShowNothingFetchedHint(
        makeStatus({ rotatedAt, exists: false }),
        wellAfter,
      ),
    ).toBe(false);
    expect(
      shouldShowNothingFetchedHint(
        makeStatus({ rotatedAt, isEnabled: false }),
        wellAfter,
      ),
    ).toBe(false);
    expect(
      shouldShowNothingFetchedHint(makeStatus({ rotatedAt: null }), wellAfter),
    ).toBe(false);
    expect(
      shouldShowNothingFetchedHint(
        makeStatus({ rotatedAt: "garbage" }),
        wellAfter,
      ),
    ).toBe(false);
  });
});

describe("reminder presets and lead times", () => {
  test("the chip row is 1 week / 1 day / 1 hour / 15 min, in that order", () => {
    expect(
      REMINDER_PRESETS.map((preset: ReminderPreset): number => {
        return preset.minutes;
      }),
    ).toEqual([10080, 1440, 60, 15]);
    expect(
      REMINDER_PRESETS.map((preset: ReminderPreset): string => {
        return preset.label;
      }),
    ).toEqual(["1 week", "1 day", "1 hour", "15 min"]);
  });

  test("every preset sits inside the service's bounds", () => {
    for (const preset of REMINDER_PRESETS) {
      expect(preset.minutes).toBeGreaterThanOrEqual(MIN_MINUTES_BEFORE_SHIFT);
      expect(preset.minutes).toBeLessThanOrEqual(MAX_MINUTES_BEFORE_SHIFT);
    }
  });

  test("formatLeadTime uses the preset label for preset values", () => {
    expect(formatLeadTime(10080)).toBe("1 week");
    expect(formatLeadTime(1440)).toBe("1 day");
    expect(formatLeadTime(60)).toBe("1 hour");
    expect(formatLeadTime(15)).toBe("15 min");
  });

  test("formatLeadTime collapses exact multiples to the largest unit and nothing else", () => {
    expect(formatLeadTime(20160)).toBe("2 weeks");
    expect(formatLeadTime(2880)).toBe("2 days");
    expect(formatLeadTime(180)).toBe("3 hours");
    // 90 minutes is not "1 hour".
    expect(formatLeadTime(90)).toBe("90 minutes");
    expect(formatLeadTime(45)).toBe("45 minutes");
  });

  test("validateCustomLeadMinutes accepts whole minutes inside the bounds", () => {
    const ok: LeadTimeValidation = validateCustomLeadMinutes(" 90 ");
    expect(ok).toEqual({ minutes: 90, error: null });
    expect(validateCustomLeadMinutes(String(MIN_MINUTES_BEFORE_SHIFT))).toEqual(
      {
        minutes: MIN_MINUTES_BEFORE_SHIFT,
        error: null,
      },
    );
    expect(validateCustomLeadMinutes(String(MAX_MINUTES_BEFORE_SHIFT))).toEqual(
      {
        minutes: MAX_MINUTES_BEFORE_SHIFT,
        error: null,
      },
    );
  });

  test("validateCustomLeadMinutes names the problem for empty, fractional and out-of-range input", () => {
    expect(validateCustomLeadMinutes("")).toEqual({
      minutes: null,
      error: "Enter how many minutes before the shift.",
    });
    expect(validateCustomLeadMinutes("   ")).toEqual({
      minutes: null,
      error: "Enter how many minutes before the shift.",
    });
    expect(validateCustomLeadMinutes("12.5").error).toBe(
      "Enter a whole number of minutes.",
    );
    expect(validateCustomLeadMinutes("abc").error).toBe(
      "Enter a whole number of minutes.",
    );
    expect(
      validateCustomLeadMinutes(String(MIN_MINUTES_BEFORE_SHIFT - 1)).error,
    ).toBe(
      "Reminders can be sent between 15 minutes and 14 days before a shift.",
    );
    expect(
      validateCustomLeadMinutes(String(MAX_MINUTES_BEFORE_SHIFT + 1)).error,
    ).toBe(
      "Reminders can be sent between 15 minutes and 14 days before a shift.",
    );
    expect(validateCustomLeadMinutes("-15").minutes).toBeNull();
  });
});

describe("upcoming shifts window and grouping", () => {
  test("the window is now to now + 30 days", () => {
    const now: Date = new Date("2026-08-31T12:00:00.000Z");
    const window: UpcomingShiftsWindow = getUpcomingShiftsWindow(now);

    expect(UPCOMING_SHIFTS_DAYS).toBe(30);
    expect(window.from).toBe(now);
    expect(window.to.getTime() - window.from.getTime()).toBe(
      30 * 24 * 60 * 60 * 1000,
    );
  });

  test("the card title states the same number of days the window uses", () => {
    expect(UPCOMING_SHIFTS_CARD_TITLE).toContain(String(UPCOMING_SHIFTS_DAYS));
    expect(UPCOMING_SHIFTS_CARD_TITLE).toBe("Upcoming shifts (next 30 days)");
  });

  test("groups by the local start day, in start order, one entry per shift", () => {
    const groups: Array<ShiftDayGroup> = groupShiftsByDay([
      makeShift({
        shiftKey: "c",
        start: "2026-09-02T07:00:00.000Z",
        end: "2026-09-02T15:00:00.000Z",
      }),
      makeShift({
        shiftKey: "a",
        start: "2026-09-01T07:00:00.000Z",
        end: "2026-09-01T15:00:00.000Z",
      }),
      makeShift({
        shiftKey: "b",
        start: "2026-09-01T15:00:00.000Z",
        end: "2026-09-01T23:00:00.000Z",
      }),
    ]);

    expect(groups.length).toBe(2);
    expect(groups[0]!.dayKey).toBe("2026-09-01");
    expect(
      groups[0]!.shifts.map((shift: MaterializedShiftJson): string => {
        return shift.shiftKey;
      }),
    ).toEqual(["a", "b"]);
    expect(groups[1]!.dayKey).toBe("2026-09-02");
    expect(groups[1]!.shifts.length).toBe(1);
    // The heading date is the first shift's start.
    expect(groups[0]!.day.toISOString()).toBe("2026-09-01T07:00:00.000Z");
  });

  test("equal starts are ordered by shiftKey so the list is stable across renders", () => {
    const groups: Array<ShiftDayGroup> = groupShiftsByDay([
      makeShift({ shiftKey: "schedule-b:1" }),
      makeShift({ shiftKey: "schedule-a:1" }),
    ]);

    expect(
      groups[0]!.shifts.map((shift: MaterializedShiftJson): string => {
        return shift.shiftKey;
      }),
    ).toEqual(["schedule-a:1", "schedule-b:1"]);
  });

  test("a shift across midnight is listed once, under the day it begins", () => {
    const groups: Array<ShiftDayGroup> = groupShiftsByDay([
      makeShift({
        shiftKey: "night",
        start: "2026-09-01T20:00:00.000Z",
        end: "2026-09-02T08:00:00.000Z",
      }),
    ]);

    expect(groups.length).toBe(1);
    expect(groups[0]!.shifts.length).toBe(1);
  });

  test("an empty list groups to nothing and does not mutate its input", () => {
    const input: Array<MaterializedShiftJson> = [
      makeShift({ shiftKey: "z", start: "2026-09-03T07:00:00.000Z" }),
      makeShift({ shiftKey: "y", start: "2026-09-01T07:00:00.000Z" }),
    ];

    expect(groupShiftsByDay([])).toEqual([]);
    groupShiftsByDay(input);
    expect(input[0]!.shiftKey).toBe("z");
  });

  test("isCoveringShift is true only for an override that names somebody else as the original", () => {
    expect(isCoveringShift(makeShift({ shiftKey: "plain" }))).toBe(false);
    expect(
      isCoveringShift(
        makeShift({
          shiftKey: "cover",
          override: {
            originalUserId: "user-2",
            originalUserName: "Bob",
            overrideStartsAt: "2026-09-01T00:00:00.000Z",
            overrideEndsAt: "2026-09-02T00:00:00.000Z",
          },
        }),
      ),
    ).toBe(true);
    // A self-override (same user) is not "covering for" anybody.
    expect(
      isCoveringShift(
        makeShift({
          shiftKey: "self",
          override: {
            originalUserId: "user-1",
            originalUserName: "Jane",
            overrideStartsAt: "2026-09-01T00:00:00.000Z",
            overrideEndsAt: "2026-09-02T00:00:00.000Z",
          },
        }),
      ),
    ).toBe(false);
  });
});

describe("parseFeedUrls", () => {
  test("returns null for a missing or non-object payload, or one without https", () => {
    expect(parseFeedUrls(null)).toBeNull();
    expect(parseFeedUrls(undefined)).toBeNull();
    expect(parseFeedUrls("https://x")).toBeNull();
    expect(parseFeedUrls({})).toBeNull();
    expect(parseFeedUrls({ https: "" })).toBeNull();
    expect(parseFeedUrls({ webcal: "webcals://x" })).toBeNull();
  });

  test("keeps every server-provided URL verbatim", () => {
    expect(parseFeedUrls(BASE_URLS as unknown as JSONObject)).toEqual(
      BASE_URLS,
    );
  });

  test("repairs a missing webcal and googleAdd from the https link", () => {
    const parsed: FeedUrls | null = parseFeedUrls({ https: HTTPS_URL });

    expect(parsed).not.toBeNull();
    expect(parsed!.webcal).toBe(HTTPS_URL.replace("https:", "webcal:"));
    expect(parsed!.googleAdd).toBe(buildGoogleAddUrl(HTTPS_URL));
  });
});

describe("parseFeedSettings", () => {
  test("falls back to the window defaults and omits the optional keys when absent", () => {
    const settings: FeedSettings = parseFeedSettings({});

    expect(settings).toEqual({
      pastDays: DEFAULT_PAST_DAYS,
      futureDays: DEFAULT_FUTURE_DAYS,
    });
    expect("includeCoveringShifts" in settings).toBe(false);
    expect("rotateWhenMemberLeaves" in settings).toBe(false);
    expect(parseFeedSettings(null)).toEqual(settings);
    expect(parseFeedSettings("nope")).toEqual(settings);
  });

  test("reads numbers, numeric strings and the optional booleans", () => {
    expect(
      parseFeedSettings({
        pastDays: "5",
        futureDays: 120,
        includeCoveringShifts: false,
        includeCoverageGaps: true,
        minimumGapMinutes: 45,
        rotateWhenMemberLeaves: true,
      }),
    ).toEqual({
      pastDays: 5,
      futureDays: 120,
      includeCoveringShifts: false,
      includeCoverageGaps: true,
      minimumGapMinutes: 45,
      rotateWhenMemberLeaves: true,
    });
  });

  test("ignores non-boolean and non-finite values instead of coercing them", () => {
    const settings: FeedSettings = parseFeedSettings({
      pastDays: "abc",
      futureDays: Number.NaN,
      includeCoverageGaps: "yes",
      minimumGapMinutes: "60",
    });

    expect(settings.pastDays).toBe(DEFAULT_PAST_DAYS);
    expect(settings.futureDays).toBe(DEFAULT_FUTURE_DAYS);
    expect("includeCoverageGaps" in settings).toBe(false);
    expect("minimumGapMinutes" in settings).toBe(false);
  });
});

describe("parseFeedStatus", () => {
  test("an empty or garbage payload parses to a non-existent feed rather than throwing", () => {
    const empty: FeedStatus = parseFeedStatus({});

    expect(empty.exists).toBe(false);
    expect(empty.feedId).toBeNull();
    expect(empty.isEnabled).toBe(false);
    expect(empty.needsRegeneration).toBe(false);
    expect(empty.tokenHint).toBeNull();
    expect(empty.fetchCount).toBe(0);
    expect(empty.lastRenderTruncated).toBe(false);
    expect(empty.urls).toBeNull();
    expect(empty.hostWarning).toBeNull();
    expect(empty.protocolWarning).toBeNull();
    expect(empty.settings).toEqual({
      pastDays: DEFAULT_PAST_DAYS,
      futureDays: DEFAULT_FUTURE_DAYS,
    });

    expect(parseFeedStatus(null)).toEqual(empty);
    expect(parseFeedStatus(42)).toEqual(empty);
  });

  test("reads a full payload field for field", () => {
    const status: FeedStatus = parseFeedStatus({
      exists: true,
      feedId: "feed-1",
      isEnabled: true,
      needsRegeneration: true,
      tokenHint: "k3Qx",
      rotatedAt: "2026-08-01T10:00:00.000Z",
      previousTokenExpiresAt: "2026-08-31T10:00:00.000Z",
      lastFetchedAt: "2026-08-02T10:00:00.000Z",
      lastFetchedClient: "Google Calendar",
      fetchCount: "143",
      lastRenderTruncated: true,
      settings: { pastDays: 1, futureDays: 30, includeCoveringShifts: true },
      urls: BASE_URLS as unknown as JSONObject,
      hostWarning: "Set HOST",
      protocolWarning: "Plain http",
    });

    expect(status).toEqual({
      exists: true,
      feedId: "feed-1",
      isEnabled: true,
      needsRegeneration: true,
      tokenHint: "k3Qx",
      rotatedAt: "2026-08-01T10:00:00.000Z",
      previousTokenExpiresAt: "2026-08-31T10:00:00.000Z",
      lastFetchedAt: "2026-08-02T10:00:00.000Z",
      lastFetchedClient: "Google Calendar",
      fetchCount: 143,
      lastRenderTruncated: true,
      settings: { pastDays: 1, futureDays: 30, includeCoveringShifts: true },
      urls: BASE_URLS,
      hostWarning: "Set HOST",
      protocolWarning: "Plain http",
    });
  });

  test("booleans must be real booleans - a truthy string does not enable a feed", () => {
    const status: FeedStatus = parseFeedStatus({
      exists: "true",
      isEnabled: 1,
      needsRegeneration: "yes",
    });

    expect(status.exists).toBe(false);
    expect(status.isEnabled).toBe(false);
    expect(status.needsRegeneration).toBe(false);
  });

  test("empty strings read as null, not as an empty hint or warning", () => {
    const status: FeedStatus = parseFeedStatus({
      tokenHint: "",
      hostWarning: "",
      lastFetchedClient: "",
    });

    expect(status.tokenHint).toBeNull();
    expect(status.hostWarning).toBeNull();
    expect(status.lastFetchedClient).toBeNull();
  });
});

describe("parseMyShifts", () => {
  test("keeps only entries that carry the fields a row needs", () => {
    const good: MaterializedShiftJson = makeShift({ shiftKey: "good" });
    const response: MyShiftsResponse = parseMyShifts({
      shifts: [
        good,
        { shiftKey: "no-start", scheduleId: "s", end: "x", userId: "u" },
        "not an object",
        null,
        { ...good, shiftKey: 42 },
      ],
      truncated: true,
      generatedAt: "2026-08-31T12:00:00.000Z",
    });

    expect(response.shifts).toEqual([good]);
    expect(response.truncated).toBe(true);
    expect(response.generatedAt).toBe("2026-08-31T12:00:00.000Z");
  });

  test("a payload without shifts is an empty, non-truncated list", () => {
    expect(parseMyShifts({})).toEqual({
      shifts: [],
      truncated: false,
      generatedAt: null,
    });
    expect(parseMyShifts(null).shifts).toEqual([]);
    expect(parseMyShifts({ shifts: "nope" }).shifts).toEqual([]);
  });
});
