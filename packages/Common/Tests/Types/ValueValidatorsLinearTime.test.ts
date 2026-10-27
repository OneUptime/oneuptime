import OnCallCalendarFeedUtil, {
  OnCallCalendarFeedKind,
} from "../../Types/OnCallDutyPolicy/OnCallCalendarFeedUtil";
import {
  readPageIdList,
  PageIdList,
} from "../../Types/Workflow/Components/OnCallPageSettings";
import UrlScrubber from "../../Utils/Rum/UrlScrubber";
import { describe, expect, test } from "@jest/globals";
import { FastestRun, fastestRun } from "../Helpers/FastestRun";

/*
 * ---------------------------------------------------------------------------
 * EMAIL-SHAPED CHECKS THAT READ OUTSIDE TEXT DECIDE IN TIME IN LINE WITH THE
 * LENGTH.
 *
 * Each of these reads a value an outsider can make long:
 *
 *  - UrlScrubber runs in the browser recorder over whatever URL a visitor
 *    navigated to, redacting an address that sits in a path segment;
 *  - OnCallCalendarFeedUtil.getDisplayName turns a name into a calendar
 *    title, hiding it when it reads as an address;
 *  - readPageIdList pulls ids and addresses out of a who-to-page setting.
 *
 * Each "is this an address" run is now length-bounded to the sizes a real
 * address has, so a value of any length is read once end to end.
 * ---------------------------------------------------------------------------
 */

const LENGTH: number = 400000;

const repeat: (unit: string, length: number) => string = (
  unit: string,
  length: number,
): string => {
  return unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
};

const EMAIL_SHAPE_WORST_CASES: Array<[string, string]> = [
  ["an address then dotted labels", "a@" + repeat("a.", LENGTH)],
  ["letters and dots", repeat("a.", LENGTH)],
  ["an at then dotted labels", repeat("a@a.", LENGTH)],
  ["dots and a tail", "a@" + repeat(".", LENGTH) + ".aa"],
  /*
   * An "@" after the dotted labels is what made the unbounded shape check
   * slow: every dot was tried as the last one, and each try read on to that
   * "@".
   */
  [
    "an address, dotted labels, then another at",
    "a@" + repeat("a.", LENGTH) + "@",
  ],
  [
    "a long first part, dotted labels, then another at",
    repeat("a", LENGTH / 2) + "@" + repeat("a.", LENGTH / 2) + "@",
  ],
];

describe("UrlScrubber.scrub reads a long path segment quickly", () => {
  test.each(EMAIL_SHAPE_WORST_CASES)(
    "decides %s quickly",
    (_label: string, segment: string) => {
      const timed: FastestRun<void> = fastestRun({
        run: (): void => {
          UrlScrubber.scrub(`https://example.com/${segment}`);
        },
        limitInMs: 2000,
      });
      expect(timed.inMs).toBeLessThan(2000);
    },
  );

  test("still redacts a real address in a path segment", () => {
    const scrubbed: string = UrlScrubber.scrub(
      "https://example.com/u/bob.smith@example.com/profile",
    );
    expect(scrubbed).not.toContain("bob.smith@example.com");
    expect(scrubbed).toContain("[redacted]");
  });
});

describe("OnCallCalendarFeedUtil.getDisplayName reads a long name quickly", () => {
  test.each(EMAIL_SHAPE_WORST_CASES)(
    "decides %s quickly",
    (_label: string, name: string) => {
      const timed: FastestRun<void> = fastestRun({
        run: (): void => {
          OnCallCalendarFeedUtil.getDisplayName(
            name,
            OnCallCalendarFeedKind.Schedule,
          );
        },
        limitInMs: 2000,
      });
      expect(timed.inMs).toBeLessThan(2000);
    },
  );

  test("still hides a name that reads as an address on a shared feed", () => {
    expect(
      OnCallCalendarFeedUtil.getDisplayName(
        "oncall@example.com",
        OnCallCalendarFeedKind.Schedule,
      ),
    ).toBe(OnCallCalendarFeedUtil.FALLBACK_USER_NAME);

    expect(
      OnCallCalendarFeedUtil.getDisplayName(
        "Alex Doe",
        OnCallCalendarFeedKind.Schedule,
      ),
    ).toBe("Alex Doe");
  });
});

describe("readPageIdList reads a long setting quickly", () => {
  test.each(EMAIL_SHAPE_WORST_CASES)(
    "decides %s quickly",
    (_label: string, token: string) => {
      const timed: FastestRun<void> = fastestRun({
        run: (): void => {
          readPageIdList(token, { allowEmails: true });
        },
        limitInMs: 2000,
      });
      expect(timed.inMs).toBeLessThan(2000);
    },
  );

  test("still reads a real address out of a setting", () => {
    const list: PageIdList = readPageIdList("paigeon@example.com", {
      allowEmails: true,
    });
    expect(list.emails).toEqual(["paigeon@example.com"]);
  });
});
