import {
  AWAY_TIMELINE_MESSAGE_PREFIX,
  formatAwayUntil,
  getAwayTimelineMessage,
  readAwayUntil,
} from "../../../Types/OnCallDutyPolicy/AwayTimelineMessage";
import { describe, expect, test } from "@jest/globals";

/*
 * THE ESCALATION TIMELINE'S LINE FOR SOMEBODY WHO IS AWAY.
 *
 * A rule that names somebody who is away with nobody named to cover does
 * not page them, and writes this line instead. It is read on the run's own
 * page as it is, and read back by the Slack / Teams run message to say
 * "away until <time>" in each reader's own time - so writing and reading
 * must agree exactly.
 */

describe("getAwayTimelineMessage", () => {
  test("says the person is away, until when in UTC to the minute, and that nobody covers", () => {
    expect(getAwayTimelineMessage(new Date("2026-10-17T09:00:00.000Z"))).toBe(
      "Skipped because this user is away until 2026-10-17 09:00 UTC, and nobody is named to cover for them.",
    );
  });

  test("starts with the Skipped wording every timeline skip uses", () => {
    expect(
      getAwayTimelineMessage(new Date("2026-01-02T03:04:00.000Z")).startsWith(
        "Skipped because ",
      ),
    ).toBe(true);
  });

  test("pads months, days, hours and minutes", () => {
    expect(formatAwayUntil(new Date("2027-02-03T04:05:59.999Z"))).toBe(
      "2027-02-03 04:05 UTC",
    );
  });
});

describe("readAwayUntil", () => {
  test("reads back the moment a line was written with", () => {
    for (const iso of [
      "2026-10-17T09:00:00.000Z",
      "2026-12-31T23:59:00.000Z",
      "2027-01-01T00:00:00.000Z",
      "2026-02-28T12:30:00.000Z",
    ]) {
      expect(
        readAwayUntil(getAwayTimelineMessage(new Date(iso)))?.toISOString(),
      ).toBe(iso);
    }
  });

  test("to the minute: seconds are not written, so they do not come back", () => {
    expect(
      readAwayUntil(
        getAwayTimelineMessage(new Date("2026-10-17T09:00:42.500Z")),
      )?.toISOString(),
    ).toBe("2026-10-17T09:00:00.000Z");
  });

  test("is null for every other timeline line", () => {
    for (const line of [
      undefined,
      null,
      "",
      "Skipped because this user is not a member of the project.",
      "Skipped because notification sent to this user already.",
      "Skipped because no users in this rule.",
      "Skipped because no active users are found in this schedule.",
      "Sending notification to user.",
      // The wording, somewhere other than the start.
      `Note: ${AWAY_TIMELINE_MESSAGE_PREFIX}2026-10-17 09:00 UTC.`,
    ]) {
      expect(readAwayUntil(line)).toBeNull();
    }
  });

  test("is null when the time after the wording cannot be read", () => {
    for (const rest of [
      "soon.",
      "2026-10-17 9:00 UTC.",
      "2026-10-17T09:00Z.",
      "17 Oct 2026 09:00 UTC.",
      "2026-10-17 09:00 CET.",
    ]) {
      expect(readAwayUntil(`${AWAY_TIMELINE_MESSAGE_PREFIX}${rest}`)).toBe(
        null,
      );
    }
  });
});
