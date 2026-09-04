import StatusPageLiveRefreshUtil, {
  RelativeTimeParts,
} from "../../FeatureSet/StatusPage/src/Utils/LiveRefresh";
import { describe, expect, test } from "@jest/globals";

/*
 * Contract under test - a status page that keeps itself current, and says how
 * current it is.
 *
 * Before this the overview fetched once and never again: a visitor watching an
 * incident from a tab opened twenty minutes ago was reading a snapshot, with
 * nothing on the page admitting it. Two things have to hold:
 *
 *   - the readout is never wrong about time. A clock that jumped backwards
 *     must not produce "in three minutes" beside a live status, and a page
 *     refreshed a second ago must not claim to be a minute old.
 *   - the poll is polite. A hidden tab makes no requests, and a refresh
 *     already in flight is not doubled.
 */

describe("StatusPageLiveRefreshUtil.getSecondsSince", () => {
  test("counts whole seconds", () => {
    const from: Date = new Date("2026-03-03T10:00:00.000Z");

    expect(
      StatusPageLiveRefreshUtil.getSecondsSince({
        from: from,
        now: new Date("2026-03-03T10:00:42.000Z"),
      }),
    ).toBe(42);
  });

  test("rounds down rather than up", () => {
    expect(
      StatusPageLiveRefreshUtil.getSecondsSince({
        from: new Date("2026-03-03T10:00:00.000Z"),
        now: new Date("2026-03-03T10:00:00.999Z"),
      }),
    ).toBe(0);
  });

  /*
   * A laptop waking up, or a device syncing its clock, can move `now` behind
   * the timestamp of a fetch that has already happened. "Updated in 3 minutes"
   * next to a live status reads as a broken page.
   */
  test("a clock that moved backwards reads as zero, never as the future", () => {
    expect(
      StatusPageLiveRefreshUtil.getSecondsSince({
        from: new Date("2026-03-03T10:05:00.000Z"),
        now: new Date("2026-03-03T10:00:00.000Z"),
      }),
    ).toBe(0);
  });

  test("an unusable date reads as zero", () => {
    expect(
      StatusPageLiveRefreshUtil.getSecondsSince({
        from: new Date(NaN),
        now: new Date("2026-03-03T10:00:00.000Z"),
      }),
    ).toBe(0);
  });

  test("a long lived tab counts in hours without overflowing", () => {
    expect(
      StatusPageLiveRefreshUtil.getSecondsSince({
        from: new Date("2026-03-03T10:00:00.000Z"),
        now: new Date("2026-03-04T10:00:00.000Z"),
      }),
    ).toBe(86400);
  });
});

describe("StatusPageLiveRefreshUtil.getRelativeTimeParts", () => {
  /*
   * A readout that ticks 1, 2, 3 next to a status is a distraction. Under the
   * threshold it says "now".
   */
  test("a fresh page says now rather than counting seconds", () => {
    for (const seconds of [0, 1, 9]) {
      const parts: RelativeTimeParts =
        StatusPageLiveRefreshUtil.getRelativeTimeParts(seconds);

      expect(parts).toEqual({ value: 0, unit: "second" });
    }
  });

  test("the just-now threshold is where seconds start being counted", () => {
    expect(
      StatusPageLiveRefreshUtil.getRelativeTimeParts(
        StatusPageLiveRefreshUtil.JustNowThresholdInSeconds,
      ),
    ).toEqual({ value: -10, unit: "second" });
  });

  test("under a minute is counted in seconds", () => {
    expect(StatusPageLiveRefreshUtil.getRelativeTimeParts(59)).toEqual({
      value: -59,
      unit: "second",
    });
  });

  test("a minute is a minute, not sixty seconds", () => {
    expect(StatusPageLiveRefreshUtil.getRelativeTimeParts(60)).toEqual({
      value: -1,
      unit: "minute",
    });
  });

  test("minutes round down so the readout never overstates staleness", () => {
    expect(StatusPageLiveRefreshUtil.getRelativeTimeParts(119)).toEqual({
      value: -1,
      unit: "minute",
    });
    expect(StatusPageLiveRefreshUtil.getRelativeTimeParts(3599)).toEqual({
      value: -59,
      unit: "minute",
    });
  });

  test("an hour and a day are each their own unit", () => {
    expect(StatusPageLiveRefreshUtil.getRelativeTimeParts(3600)).toEqual({
      value: -1,
      unit: "hour",
    });
    expect(StatusPageLiveRefreshUtil.getRelativeTimeParts(86399)).toEqual({
      value: -23,
      unit: "hour",
    });
    expect(StatusPageLiveRefreshUtil.getRelativeTimeParts(86400)).toEqual({
      value: -1,
      unit: "day",
    });
    expect(
      StatusPageLiveRefreshUtil.getRelativeTimeParts(86400 * 3 + 5),
    ).toEqual({ value: -3, unit: "day" });
  });

  test("nonsense input degrades to now", () => {
    for (const seconds of [-100, NaN, Infinity, -Infinity]) {
      expect(StatusPageLiveRefreshUtil.getRelativeTimeParts(seconds)).toEqual({
        value: 0,
        unit: "second",
      });
    }
  });
});

describe("StatusPageLiveRefreshUtil.formatRelativeTime", () => {
  test("English reads the way a person would say it", () => {
    expect(
      StatusPageLiveRefreshUtil.formatRelativeTime({
        secondsAgo: 42,
        locale: "en",
      }),
    ).toBe("42 seconds ago");

    expect(
      StatusPageLiveRefreshUtil.formatRelativeTime({
        secondsAgo: 60,
        locale: "en",
      }),
    ).toBe("1 minute ago");
  });

  test("a page just refreshed says now", () => {
    expect(
      StatusPageLiveRefreshUtil.formatRelativeTime({
        secondsAgo: 2,
        locale: "en",
      }),
    ).toBe("now");
  });

  /*
   * This is why the readout has no translation keys of its own: the platform
   * already knows every locale's plural rules, and hand written "{{total}}
   * minutes ago" strings do not (Russian alone needs three forms).
   */
  test("other languages are produced without a translation file", () => {
    expect(
      StatusPageLiveRefreshUtil.formatRelativeTime({
        secondsAgo: 300,
        locale: "de",
      }),
    ).toContain("Minuten");

    expect(
      StatusPageLiveRefreshUtil.formatRelativeTime({
        secondsAgo: 300,
        locale: "fr",
      }).toLowerCase(),
    ).toContain("minutes");

    const russian: string = StatusPageLiveRefreshUtil.formatRelativeTime({
      secondsAgo: 300,
      locale: "ru",
    });

    expect(russian).toContain("5");
    expect(russian).not.toContain("minute");
  });

  test("a locale tag the runtime rejects falls back to English", () => {
    expect(
      StatusPageLiveRefreshUtil.formatRelativeTime({
        secondsAgo: 90,
        locale: "not a locale!!",
      }),
    ).toBe("1 minute ago");
  });

  test("no locale at all still produces a sentence", () => {
    expect(
      StatusPageLiveRefreshUtil.formatRelativeTime({ secondsAgo: 7200 }),
    ).toBe("2 hours ago");
  });

  test("the English fallback pluralises correctly", () => {
    const original: typeof Intl.RelativeTimeFormat = Intl.RelativeTimeFormat;

    try {
      // Simulate a runtime without Intl.RelativeTimeFormat at all.
      (Intl as unknown as { RelativeTimeFormat: unknown }).RelativeTimeFormat =
        function (): never {
          throw new Error("unsupported");
        };

      expect(
        StatusPageLiveRefreshUtil.formatRelativeTime({ secondsAgo: 60 }),
      ).toBe("1 minute ago");
      expect(
        StatusPageLiveRefreshUtil.formatRelativeTime({ secondsAgo: 180 }),
      ).toBe("3 minutes ago");
      expect(
        StatusPageLiveRefreshUtil.formatRelativeTime({ secondsAgo: 1 }),
      ).toBe("now");
      expect(
        StatusPageLiveRefreshUtil.formatRelativeTime({ secondsAgo: 86400 }),
      ).toBe("1 day ago");
    } finally {
      (Intl as unknown as { RelativeTimeFormat: unknown }).RelativeTimeFormat =
        original;
    }
  });
});

describe("StatusPageLiveRefreshUtil.shouldRefreshNow", () => {
  const interval: number = StatusPageLiveRefreshUtil.RefreshIntervalInSeconds;

  test("refreshes once the interval has passed", () => {
    expect(
      StatusPageLiveRefreshUtil.shouldRefreshNow({
        secondsSinceLastRefresh: interval,
        isDocumentVisible: true,
        isAlreadyRefreshing: false,
      }),
    ).toBe(true);
  });

  test("does not refresh before the interval has passed", () => {
    expect(
      StatusPageLiveRefreshUtil.shouldRefreshNow({
        secondsSinceLastRefresh: interval - 1,
        isDocumentVisible: true,
        isAlreadyRefreshing: false,
      }),
    ).toBe(false);
  });

  /*
   * A status page pinned in a background tab for eight hours would otherwise
   * make hundreds of requests nobody ever sees.
   */
  test("a hidden tab never refreshes, however stale it is", () => {
    expect(
      StatusPageLiveRefreshUtil.shouldRefreshNow({
        secondsSinceLastRefresh: 60 * 60 * 8,
        isDocumentVisible: false,
        isAlreadyRefreshing: false,
      }),
    ).toBe(false);
  });

  test("a refresh already in flight is not doubled", () => {
    expect(
      StatusPageLiveRefreshUtil.shouldRefreshNow({
        secondsSinceLastRefresh: 60 * 60,
        isDocumentVisible: true,
        isAlreadyRefreshing: true,
      }),
    ).toBe(false);
  });

  test("the caller can ask for a different cadence", () => {
    expect(
      StatusPageLiveRefreshUtil.shouldRefreshNow({
        secondsSinceLastRefresh: 20,
        isDocumentVisible: true,
        isAlreadyRefreshing: false,
        intervalInSeconds: 15,
      }),
    ).toBe(true);

    expect(
      StatusPageLiveRefreshUtil.shouldRefreshNow({
        secondsSinceLastRefresh: 20,
        isDocumentVisible: true,
        isAlreadyRefreshing: false,
        intervalInSeconds: 300,
      }),
    ).toBe(false);
  });

  test("the default cadence is a minute", () => {
    expect(StatusPageLiveRefreshUtil.RefreshIntervalInSeconds).toBe(60);
  });
});
