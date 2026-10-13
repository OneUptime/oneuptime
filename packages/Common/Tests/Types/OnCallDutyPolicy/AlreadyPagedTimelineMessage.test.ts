import { ALREADY_PAGED_TIMELINE_MESSAGE } from "../../../Types/OnCallDutyPolicy/AlreadyPagedTimelineMessage";
import { readAwayUntil } from "../../../Types/OnCallDutyPolicy/AwayTimelineMessage";
import { describe, expect, test } from "@jest/globals";

/*
 * The timeline's line for somebody a page names a second time is read back
 * by what it says - the run's Slack and Microsoft Teams message and a direct
 * page's feed leave it out by comparing it - and timelines written before
 * the words had a name carry them too. So the words do not change.
 */
describe("the line for somebody a page names a second time", () => {
  test("says what every timeline written so far says", () => {
    expect(ALREADY_PAGED_TIMELINE_MESSAGE).toBe(
      "Skipped because notification sent to this user already.",
    );
  });

  test("is not read as somebody who is away", () => {
    expect(readAwayUntil(ALREADY_PAGED_TIMELINE_MESSAGE)).toBeNull();
  });
});
