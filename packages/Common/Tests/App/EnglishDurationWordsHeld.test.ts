import { afterEach, describe, expect, test } from "@jest/globals";
import OneUptimeDate from "../../Types/Date";
import { setDateDisplayLanguage } from "../../Types/DateLanguage";
import {
  ENGLISH_DURATION_WORDS,
  NO_BREAK_SPACE,
  withDurationWordsHeld,
} from "../../Types/NoBreakSpaces";
import { createTranslator } from "../../Types/Translator";
import {
  formatFeedTimeAgo,
  FeedClock,
} from "../../UI/Components/Feed/FeedTime";
import { formatEventDurationParts } from "../../../App/FeatureSet/Dashboard/src/Utils/EventDuration";
import { formatPlaylistInterval } from "../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Playlist/PlaylistDashboards";
import { formatRelativeTime as formatExceptionRelativeTime } from "../../../App/FeatureSet/Dashboard/src/Utils/ExceptionDetailPresentation";
import { formatReplayUserSessionAge } from "../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayUserSessions";
import { formatLastSeen } from "../../../App/FeatureSet/Dashboard/src/Components/Topology/TopologyActivity";
import { formatWindowMinutes } from "../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventConnectionDiagnosticsUtil";
import { formatRelativeTimeParts } from "../../../App/FeatureSet/Dashboard/src/Components/Home/HomeRelativeTime";
import { formatRunRelativeTime } from "../../../App/FeatureSet/Dashboard/src/Components/Runbook/Triggers/RunbookTriggersCopy";
import { getMerakiReadTime } from "../../../App/FeatureSet/Dashboard/src/Components/NetworkTraffic/Meraki/MerakiWords";
import StatusPageLiveRefreshUtil from "../../../App/FeatureSet/StatusPage/src/Utils/LiveRefresh";

/*
 * ENGLISH THAT NAMES A DURATION'S UNIT IN A WORD HOLDS ITS NUMBER (#8669).
 *
 * #8456 held what Intl writes ("in 5 minutes"); OneUptime also writes
 * English durations in words itself - moment's "5 hours ago", the friendly
 * "1 min 47 secs", a table's "10 days, 23 hours", the fallbacks for an
 * engine without Intl - and each could end a line with its number. Every
 * number written before a duration's word is held to it with a no-break
 * space; a number before another word ("5 hosts"), and a word with no
 * number before it ("a few seconds ago"), are as they were.
 */

const BREAKING_SPACE: RegExp = /[ \u2000-\u2006\u2008-\u200A\u205F]/;

const WORD: string = ENGLISH_DURATION_WORDS.join("|");

// A figure, a space a line breaks at, and a duration's word after it.
const BROKEN_BEFORE_A_WORD: RegExp = new RegExp(
  `\\p{Nd}[ \\u2000-\\u2006\\u2008-\\u200A\\u205F]+(?:${WORD})(?![\\p{L}])`,
  "u",
);

const NOW: Date = new Date("2026-11-15T12:00:00Z");

const ago: (seconds: number) => Date = (seconds: number): Date => {
  return new Date(NOW.getTime() - seconds * 1000);
};

const ahead: (seconds: number) => Date = (seconds: number): Date => {
  return new Date(NOW.getTime() + seconds * 1000);
};

// The texts in `texts` that a line could part from their duration's word.
const broken: (texts: Array<string | null | undefined>) => Array<string> = (
  texts: Array<string | null | undefined>,
): Array<string> => {
  return texts
    .map((text: string | null | undefined): string => {
      return text || "";
    })
    .filter((text: string): boolean => {
      return BROKEN_BEFORE_A_WORD.test(text);
    });
};

afterEach(() => {
  setDateDisplayLanguage("en");
});

describe("withDurationWordsHeld", () => {
  test("holds each number to the duration's word after it", () => {
    expect(withDurationWordsHeld("5 hours ago")).toBe(
      `5${NO_BREAK_SPACE}hours ago`,
    );
    expect(withDurationWordsHeld("in 3 days")).toBe(
      `in 3${NO_BREAK_SPACE}days`,
    );
    expect(withDurationWordsHeld("2 hours 5 minutes")).toBe(
      `2${NO_BREAK_SPACE}hours 5${NO_BREAK_SPACE}minutes`,
    );
    expect(withDurationWordsHeld("1 min 47 secs")).toBe(
      `1${NO_BREAK_SPACE}min 47${NO_BREAK_SPACE}secs`,
    );
    expect(withDurationWordsHeld("1,234 seconds")).toBe(
      `1,234${NO_BREAK_SPACE}seconds`,
    );
    // A thin space breaks a line too, and is held the same way.
    expect(withDurationWordsHeld("5\u2009weeks")).toBe(
      `5${NO_BREAK_SPACE}weeks`,
    );
  });

  test.each(ENGLISH_DURATION_WORDS)(
    "holds a number before %s",
    (word: string) => {
      expect(withDurationWordsHeld(`for 7 ${word} now`)).toBe(
        `for 7${NO_BREAK_SPACE}${word} now`,
      );
    },
  );

  test("negative controls: no number, another word, a longer word, a held space", () => {
    for (const text of [
      "a few seconds ago",
      "an hour ago",
      "in a day",
      "5 hosts",
      "3 errors in the last hour",
      "5 minutesLater",
      "12 dayshift",
      `5${NO_BREAK_SPACE}hours ago`,
      "5\u2007days",
      "",
      "now",
    ]) {
      expect(withDurationWordsHeld(text)).toBe(text);
    }
  });
});

describe("OneUptimeDate's English holds each number to its word", () => {
  test("how long ago, and how long until, at every distance moment rounds to", () => {
    const texts: Array<string> = [];

    for (const seconds of [
      30,
      90,
      5 * 60,
      44 * 60,
      50 * 60,
      3 * 3600,
      21 * 3600,
      30 * 3600,
      3 * 86400,
      25 * 86400,
      40 * 86400,
      200 * 86400,
      400 * 86400,
      3 * 365 * 86400,
    ]) {
      texts.push(OneUptimeDate.fromNow(ago(seconds), NOW));
      texts.push(OneUptimeDate.fromNow(ahead(seconds), NOW));
    }

    expect(broken(texts)).toEqual([]);
    expect(OneUptimeDate.fromNow(ago(5 * 3600), NOW)).toBe(
      `5${NO_BREAK_SPACE}hours ago`,
    );
    expect(OneUptimeDate.fromNow(ahead(3 * 86400), NOW)).toBe(
      `in 3${NO_BREAK_SPACE}days`,
    );
    // moment's words with no number are as moment wrote them.
    expect(OneUptimeDate.fromNow(ago(10), NOW)).toBe("a few seconds ago");
    expect(OneUptimeDate.fromNow(ago(3600), NOW)).toBe("an hour ago");
  });

  test("a friendly duration, and nothing", () => {
    expect(OneUptimeDate.secondsToFormattedFriendlyTimeString(107)).toBe(
      `1${NO_BREAK_SPACE}min 47${NO_BREAK_SPACE}secs`,
    );
    expect(
      OneUptimeDate.secondsToFormattedFriendlyTimeString(0, {
        writesZero: true,
      }),
    ).toBe(`0${NO_BREAK_SPACE}secs`);
    expect(
      broken([
        OneUptimeDate.secondsToFormattedFriendlyTimeString(
          400 * 86400 + 3 * 3600 + 61,
        ),
        OneUptimeDate.secondsToFormattedFriendlyTimeString(29 * 86400, {
          maxUnits: 2,
        }),
      ]),
    ).toEqual([]);
  });

  test("hours and minutes, and days, hours, minutes and seconds", () => {
    expect(OneUptimeDate.getHoursAndMinutesFromMinutes(125)).toBe(
      `2${NO_BREAK_SPACE}hours 5${NO_BREAK_SPACE}minutes`,
    );
    expect(OneUptimeDate.getHoursAndMinutesFromMinutes(0)).toBe(
      `0${NO_BREAK_SPACE}minutes`,
    );
    expect(
      OneUptimeDate.convertMinutesToDaysHoursAndMinutes(3 * 1440 + 65),
    ).toBe(
      `3${NO_BREAK_SPACE}days, 1${NO_BREAK_SPACE}hours, 5${NO_BREAK_SPACE}minutes`,
    );
    expect(
      OneUptimeDate.convertSecondsToDaysHoursMinutesAndSeconds(86400 + 3661),
    ).toBe(
      `1${NO_BREAK_SPACE}days, 1${NO_BREAK_SPACE}hours, 1${NO_BREAK_SPACE}minutes, 1${NO_BREAK_SPACE}seconds`,
    );
  });

  test("another language is Intl's, held by DateLanguage as before (#8456)", () => {
    setDateDisplayLanguage("de");

    expect(OneUptimeDate.fromNow(ago(5 * 3600), NOW)).toBe(
      `vor 5${NO_BREAK_SPACE}Stunden`,
    );
    expect(OneUptimeDate.getHoursAndMinutesFromMinutes(125)).toBe(
      `2${NO_BREAK_SPACE}Stunden, 5${NO_BREAK_SPACE}Minuten`,
    );
  });
});

describe("the Dashboard's own English holds each number to its word", () => {
  test("a table's duration, a playlist's interval, an exception's and a session's age, a topology's last seen", () => {
    expect(
      formatEventDurationParts(
        [
          { count: 10, unit: "day" },
          { count: 23, unit: "hour" },
        ],
        "en",
      ),
    ).toBe(`10${NO_BREAK_SPACE}days, 23${NO_BREAK_SPACE}hours`);
    expect(formatPlaylistInterval(90, "en")).toBe(
      `1${NO_BREAK_SPACE}minute, 30${NO_BREAK_SPACE}seconds`,
    );
    expect(formatExceptionRelativeTime(ago(4 * 60), NOW, "en")).toBe(
      `4${NO_BREAK_SPACE}minutes ago`,
    );
    expect(
      formatReplayUserSessionAge(NOW.getTime() - 5 * 60_000, NOW.getTime()),
    ).toBe(`5${NO_BREAK_SPACE}minutes ago`);
    // Words with no number are as they were.
    expect(
      formatReplayUserSessionAge(NOW.getTime() - 60 * 60_000, NOW.getTime()),
    ).toBe("an hour ago");
    expect(formatLastSeen(ago(3 * 86400), NOW)).toBe(
      `3${NO_BREAK_SPACE}days ago`,
    );
    expect(formatWindowMinutes(90)).toBe(`90${NO_BREAK_SPACE}minutes`);
    expect(formatWindowMinutes(180)).toBe(`3${NO_BREAK_SPACE}hours`);
  });

  test("the English an engine without Intl falls back to", () => {
    const intl: { RelativeTimeFormat?: unknown } = Intl as unknown as {
      RelativeTimeFormat?: unknown;
    };
    const original: unknown = intl.RelativeTimeFormat;

    Object.defineProperty(Intl, "RelativeTimeFormat", {
      value: undefined,
      configurable: true,
      writable: true,
    });

    try {
      const clock: FeedClock = {
        timezone: "UTC",
        language: "en",
        use12HourClock: false,
        now: NOW,
      };

      expect(
        broken([
          formatFeedTimeAgo(ago(3 * 3600), clock),
          formatRelativeTimeParts({ parts: { value: -20, unit: "minute" } }),
          formatRelativeTimeParts({ parts: { value: 3, unit: "day" } }),
          StatusPageLiveRefreshUtil.formatRelativeTime({ secondsAgo: 180 }),
          formatRunRelativeTime({
            date: ahead(5 * 3600),
            now: NOW,
            language: "en",
            timezone: "UTC",
          }),
          getMerakiReadTime(new Date(NOW.getTime() - 12_000).toISOString(), {
            now: NOW,
          }),
        ]),
      ).toEqual([]);
      expect(formatFeedTimeAgo(ago(3 * 3600), clock)).toBe(
        `3${NO_BREAK_SPACE}hours ago`,
      );
      expect(
        formatRelativeTimeParts({ parts: { value: 3, unit: "day" } }),
      ).toBe(`in 3${NO_BREAK_SPACE}days`);
    } finally {
      Object.defineProperty(Intl, "RelativeTimeFormat", {
        value: original,
        configurable: true,
        writable: true,
      });
    }
  });

  test("the scan's English check reads a broken one, and leaves the rest", () => {
    expect(broken(["5 hours ago", "in 3 days", "1 min 47 secs"])).toEqual([
      "5 hours ago",
      "in 3 days",
      "1 min 47 secs",
    ]);
    expect(
      broken([`5${NO_BREAK_SPACE}hours ago`, "5 hosts", "a few seconds ago"]),
    ).toEqual([]);
    expect(BREAKING_SPACE.test(NO_BREAK_SPACE)).toBe(false);
  });

  test("a translator's language other than English is untouched by the English hold", () => {
    expect(
      formatRelativeTimeParts({
        parts: { value: -20, unit: "minute" },
        language: "de",
      }),
    ).toBe(`vor 20${NO_BREAK_SPACE}Minuten`);
    expect(createTranslator(undefined, "de").language).toBe("de");
  });
});
