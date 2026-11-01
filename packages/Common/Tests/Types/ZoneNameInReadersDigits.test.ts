/** @timezone UTC */

import { afterEach, describe, expect, test } from "@jest/globals";
import OneUptimeDate from "../../Types/Date";
import {
  forgetRememberedDateTexts,
  getEnglishOf,
  setDateDisplayLanguage,
} from "../../Types/DateLanguage";
import Timezone from "../../Types/Timezone";
import {
  formatFeedFullTime,
  getFeedZoneName,
} from "../../UI/Components/Feed/FeedTime";
import { getStatusTimelineZoneName } from "../../UI/Components/StatusTimeline/StatusTimelineTime";

/*
 * A date on a Persian page is written in Persian digits (#5312), and the
 * zone's name after it was not: "۶ اکتبر ۲۰۲۶، ۱۲:۳۵ GMT+0330". A zone
 * moment names by its offset ("+0330", "GMT+8") is now written in the
 * date's digits; a zone with a name of letters ("BST") and every language
 * that writes Latin digits read as before.
 *
 * The instant is 09:05:07 UTC: 12:35 in Tehran (UTC+3:30, no abbreviation
 * but its offset), 10:05 in London (BST).
 */

const INSTANT: Date = new Date("2026-10-06T09:05:07Z");

// Latin digits.
const LATIN_DIGIT: RegExp = /[0-9]/;

afterEach(() => {
  setDateDisplayLanguage(null);
  OneUptimeDate.setUserTimezone(null);
  forgetRememberedDateTexts();
});

describe("a date with its zone", () => {
  test("in Persian, Tehran's offset is in Persian digits, as the date is", () => {
    OneUptimeDate.setUserTimezone(Timezone.AsiaTehran);
    setDateDisplayLanguage("fa");

    const written: string = OneUptimeDate.getDateAsLocalFormattedString(INSTANT);

    expect(written).toContain("GMT+۰۳۳۰");
    expect(written).not.toMatch(LATIN_DIGIT);
    // Its English is remembered as it always was.
    expect(getEnglishOf(written)).toBe("Oct 06 2026, 12:35 GMT+0330");
  });

  test("in English and German the offset reads as before", () => {
    OneUptimeDate.setUserTimezone(Timezone.AsiaTehran);

    expect(OneUptimeDate.getDateAsLocalFormattedString(INSTANT)).toBe(
      "Oct 06 2026, 12:35 GMT+0330",
    );

    setDateDisplayLanguage("de");

    expect(OneUptimeDate.getDateAsLocalFormattedString(INSTANT)).toMatch(
      /GMT\+0330$/,
    );
  });

  test("a zone named by its letters is the same in every language", () => {
    OneUptimeDate.setUserTimezone(Timezone.EuropeLondon);
    setDateDisplayLanguage("fa");

    expect(OneUptimeDate.getDateAsLocalFormattedString(INSTANT)).toMatch(
      /BST$/,
    );
  });

  test("a date in a zone of its own and in several zones follows the same digits", () => {
    setDateDisplayLanguage("fa");

    expect(
      OneUptimeDate.getDateAsFormattedStringInTimezone({
        date: INSTANT,
        timezone: Timezone.AsiaTehran,
      }),
    ).toContain("GMT+۰۳۳۰");

    const dates: Array<string> =
      OneUptimeDate.getDateAsFormattedArrayInMultipleTimezones({
        date: INSTANT,
        timezones: [Timezone.AsiaTehran, Timezone.AsiaKolkata],
      });

    expect(dates[0]).toContain("GMT+۰۳۳۰");
    expect(dates[1]).not.toMatch(LATIN_DIGIT);
  });
});

describe("a feed's and a status timeline's zone name", () => {
  test("in the reader's digits", () => {
    expect(getFeedZoneName(INSTANT, Timezone.AsiaTehran, "fa")).toBe(
      "GMT+۰۳۳۰",
    );
    expect(getFeedZoneName(INSTANT, Timezone.AsiaTehran, "en")).toBe(
      "GMT+0330",
    );
    expect(getFeedZoneName(INSTANT, Timezone.AsiaTehran, "de")).toBe(
      "GMT+0330",
    );
    // Without a language, as moment names it.
    expect(getFeedZoneName(INSTANT, Timezone.AsiaTehran)).toBe("GMT+0330");
    expect(getFeedZoneName(INSTANT, Timezone.EuropeLondon, "fa")).toBe("BST");
  });

  test("an entry's whole time ends in the zone in the same digits", () => {
    const written: string = formatFeedFullTime(INSTANT, {
      timezone: Timezone.AsiaTehran,
      language: "fa",
      use12HourClock: false,
      now: INSTANT,
    });

    expect(written.endsWith("GMT+۰۳۳۰")).toBe(true);
    expect(written).not.toMatch(LATIN_DIGIT);
  });

  test("a status timeline names its zone the same way", () => {
    expect(
      getStatusTimelineZoneName(INSTANT, {
        timezone: Timezone.AsiaTehran,
        language: "fa",
        use12HourClock: false,
        now: INSTANT,
      }),
    ).toBe("GMT+۰۳۳۰");
  });
});
