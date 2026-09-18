import CalendarFeedWindow, {
  BODY_CACHE_TTL_SECONDS,
  DEFAULT_FUTURE_DAYS,
  DEFAULT_PAST_DAYS,
  FEED_SIMULATION_ITERATION_CAP,
  FeedWindow,
  MAX_EVENTS,
  MAX_FUTURE_DAYS,
  MAX_GAP_EVENTS,
  MAX_PAST_DAYS,
  MIN_FUTURE_DAYS,
  PREVIOUS_TOKEN_GRACE_DAYS,
  RENDER_CONCURRENCY,
  SCHEDULE_CACHE_TTL_SECONDS,
} from "../../../Types/OnCallDutyPolicy/CalendarFeedWindow";
import { at } from "./CalendarFeedTestFixtures";

describe("CalendarFeedWindow constants", () => {
  test("hold the values the design fixes", () => {
    expect(MAX_FUTURE_DAYS).toBe(180);
    expect(MIN_FUTURE_DAYS).toBe(7);
    expect(DEFAULT_FUTURE_DAYS).toBe(90);
    expect(MAX_PAST_DAYS).toBe(60);
    expect(DEFAULT_PAST_DAYS).toBe(2);
    expect(MAX_EVENTS).toBe(5000);
    expect(MAX_GAP_EVENTS).toBe(100);
    expect(PREVIOUS_TOKEN_GRACE_DAYS).toBe(30);
    expect(BODY_CACHE_TTL_SECONDS).toBe(300);
    expect(SCHEDULE_CACHE_TTL_SECONDS).toBe(3600);
    expect(RENDER_CONCURRENCY).toBe(4);
    expect(FEED_SIMULATION_ITERATION_CAP).toBe(200000);
  });

  test("are internally consistent", () => {
    expect(MIN_FUTURE_DAYS).toBeLessThanOrEqual(DEFAULT_FUTURE_DAYS);
    expect(DEFAULT_FUTURE_DAYS).toBeLessThanOrEqual(MAX_FUTURE_DAYS);
    expect(DEFAULT_PAST_DAYS).toBeLessThanOrEqual(MAX_PAST_DAYS);
    expect(MAX_GAP_EVENTS).toBeLessThan(MAX_EVENTS);
  });
});

describe("CalendarFeedWindow.clampPastDays", () => {
  test("keeps values inside 0..MAX_PAST_DAYS and clamps the rest", () => {
    expect(CalendarFeedWindow.clampPastDays(0)).toBe(0);
    expect(CalendarFeedWindow.clampPastDays(2)).toBe(2);
    expect(CalendarFeedWindow.clampPastDays(60)).toBe(60);
    expect(CalendarFeedWindow.clampPastDays(61)).toBe(60);
    expect(CalendarFeedWindow.clampPastDays(999)).toBe(60);
    expect(CalendarFeedWindow.clampPastDays(-5)).toBe(0);
  });

  test("floors fractions and parses numeric strings (as stored Number columns arrive)", () => {
    expect(CalendarFeedWindow.clampPastDays(2.9)).toBe(2);
    expect(CalendarFeedWindow.clampPastDays("7")).toBe(7);
    expect(CalendarFeedWindow.clampPastDays(" 90 ")).toBe(60);
  });

  test("falls back to the default for anything that is not a number", () => {
    expect(CalendarFeedWindow.clampPastDays(undefined)).toBe(DEFAULT_PAST_DAYS);
    expect(CalendarFeedWindow.clampPastDays(null)).toBe(DEFAULT_PAST_DAYS);
    expect(CalendarFeedWindow.clampPastDays(Number.NaN)).toBe(
      DEFAULT_PAST_DAYS,
    );
    expect(CalendarFeedWindow.clampPastDays("abc")).toBe(DEFAULT_PAST_DAYS);
    expect(CalendarFeedWindow.clampPastDays("")).toBe(DEFAULT_PAST_DAYS);
    expect(CalendarFeedWindow.clampPastDays(Number.POSITIVE_INFINITY)).toBe(
      DEFAULT_PAST_DAYS,
    );
    expect(CalendarFeedWindow.clampPastDays({})).toBe(DEFAULT_PAST_DAYS);
  });
});

describe("CalendarFeedWindow.clampFutureDays", () => {
  test("keeps values inside MIN..MAX and clamps the rest", () => {
    expect(CalendarFeedWindow.clampFutureDays(7)).toBe(7);
    expect(CalendarFeedWindow.clampFutureDays(90)).toBe(90);
    expect(CalendarFeedWindow.clampFutureDays(180)).toBe(180);
    expect(CalendarFeedWindow.clampFutureDays(181)).toBe(180);
    expect(CalendarFeedWindow.clampFutureDays(6)).toBe(7);
    expect(CalendarFeedWindow.clampFutureDays(0)).toBe(7);
    expect(CalendarFeedWindow.clampFutureDays(-1)).toBe(7);
  });

  test("falls back to the default for anything that is not a number", () => {
    expect(CalendarFeedWindow.clampFutureDays(undefined)).toBe(
      DEFAULT_FUTURE_DAYS,
    );
    expect(CalendarFeedWindow.clampFutureDays(null)).toBe(DEFAULT_FUTURE_DAYS);
    expect(CalendarFeedWindow.clampFutureDays("x")).toBe(DEFAULT_FUTURE_DAYS);
    expect(CalendarFeedWindow.clampFutureDays("30")).toBe(30);
  });
});

describe("CalendarFeedWindow.computeFeedWindow", () => {
  test("puts both edges on UTC midnights around a mid-day instant", () => {
    const window: FeedWindow = CalendarFeedWindow.computeFeedWindow({
      now: at("2026-08-31T14:37:12Z"),
      pastDays: 2,
      futureDays: 90,
    });

    expect(window.feedStart.toISOString()).toBe("2026-08-29T00:00:00.000Z");
    // 90 days ahead is 2026-11-29; the exclusive end is the following midnight.
    expect(window.feedEnd.toISOString()).toBe("2026-11-30T00:00:00.000Z");
  });

  test("is identical for every instant inside the same UTC day", () => {
    const first: FeedWindow = CalendarFeedWindow.computeFeedWindow({
      now: at("2026-08-31T00:00:00Z"),
      pastDays: 2,
      futureDays: 30,
    });
    const last: FeedWindow = CalendarFeedWindow.computeFeedWindow({
      now: at("2026-08-31T23:59:59.999Z"),
      pastDays: 2,
      futureDays: 30,
    });

    expect(first.feedStart.getTime()).toBe(last.feedStart.getTime());
    expect(first.feedEnd.getTime()).toBe(last.feedEnd.getTime());
  });

  test("changes at the UTC day boundary, not the local one", () => {
    const before: FeedWindow = CalendarFeedWindow.computeFeedWindow({
      now: at("2026-08-31T23:59:59Z"),
      pastDays: 0,
      futureDays: 7,
    });
    const after: FeedWindow = CalendarFeedWindow.computeFeedWindow({
      now: at("2026-09-01T00:00:00Z"),
      pastDays: 0,
      futureDays: 7,
    });

    expect(before.feedStart.toISOString()).toBe("2026-08-31T00:00:00.000Z");
    expect(after.feedStart.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(after.feedEnd.getTime() - before.feedEnd.getTime()).toBe(
      24 * 3600 * 1000,
    );
  });

  test("clamps the day counts before applying them", () => {
    const window: FeedWindow = CalendarFeedWindow.computeFeedWindow({
      now: at("2026-08-31T12:00:00Z"),
      pastDays: 500,
      futureDays: 1,
    });

    expect(window.feedStart.toISOString()).toBe("2026-07-02T00:00:00.000Z"); // 60 days back
    expect(window.feedEnd.toISOString()).toBe("2026-09-08T00:00:00.000Z"); // MIN 7 days + 1
  });

  test("pastDays 0 starts today; the window always spans at least MIN_FUTURE_DAYS + 1 days", () => {
    const window: FeedWindow = CalendarFeedWindow.computeFeedWindow({
      now: at("2026-02-28T09:00:00Z"),
      pastDays: 0,
      futureDays: 7,
    });

    expect(window.feedStart.toISOString()).toBe("2026-02-28T00:00:00.000Z");
    expect(window.feedEnd.toISOString()).toBe("2026-03-08T00:00:00.000Z");
    expect(
      (window.feedEnd.getTime() - window.feedStart.getTime()) / 86400000,
    ).toBe(8);
  });

  test("survives leap days and year boundaries", () => {
    const window: FeedWindow = CalendarFeedWindow.computeFeedWindow({
      now: at("2028-02-29T12:00:00Z"),
      pastDays: 1,
      futureDays: 7,
    });

    expect(window.feedStart.toISOString()).toBe("2028-02-28T00:00:00.000Z");
    expect(window.feedEnd.toISOString()).toBe("2028-03-08T00:00:00.000Z");

    const newYear: FeedWindow = CalendarFeedWindow.computeFeedWindow({
      now: at("2026-12-31T23:00:00Z"),
      pastDays: 2,
      futureDays: 7,
    });

    expect(newYear.feedStart.toISOString()).toBe("2026-12-29T00:00:00.000Z");
    expect(newYear.feedEnd.toISOString()).toBe("2027-01-08T00:00:00.000Z");
  });
});

describe("CalendarFeedWindow.startOfUtcDay / getUtcDayBucket", () => {
  test("startOfUtcDay truncates to 00:00:00.000 UTC", () => {
    expect(
      new Date(
        CalendarFeedWindow.startOfUtcDay(at("2026-08-31T23:59:59.999Z")),
      ).toISOString(),
    ).toBe("2026-08-31T00:00:00.000Z");
  });

  test("getUtcDayBucket is the UTC calendar date", () => {
    expect(CalendarFeedWindow.getUtcDayBucket(at("2026-08-31T23:59:59Z"))).toBe(
      "2026-08-31",
    );
    expect(CalendarFeedWindow.getUtcDayBucket(at("2026-09-01T00:00:00Z"))).toBe(
      "2026-09-01",
    );
  });
});
