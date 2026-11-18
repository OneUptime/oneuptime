import { describe, expect, test } from "@jest/globals";
import { END_NOW_TITLE, describeEndNow } from "./overrideEndNow";
import { formatShiftTime } from "../utils/duration";
import type { OnCallOverrideItem } from "../api/types";

/*
 * END NOW'S QUESTION, IN THE APP (#7897): what happens to the time left
 * and who is paged from then on, in the app's voice - "you" for the person
 * signed in - for each side of the override they are on, and for a skip.
 */

const NOW: number = new Date("2026-11-13T12:00:30.000Z").getTime();
const ENDS_AT: string = "2026-11-13T20:00:00.000Z";
const UNTIL: string = formatShiftTime(ENDS_AT, NOW)!;

function override(data: Partial<OnCallOverrideItem>): OnCallOverrideItem {
  return {
    _id: "override-1",
    projectId: "project-1",
    projectName: "Acme",
    overrideUser: { _id: "ada", name: "Ada Lovelace" },
    routeAlertsToUser: { _id: "priya", name: "Priya Rao" },
    onCallDutyPolicy: null,
    startsAt: "2026-11-13T08:00:00.000Z",
    endsAt: ENDS_AT,
    createdAt: "2026-11-01T00:00:00.000Z",
    ...data,
  };
}

describe("End Now's question", () => {
  test("for the person away: who stops covering for them, and that their pages come back", () => {
    expect(describeEndNow(override({}), "ada", NOW)).toEqual({
      title: END_NOW_TITLE,
      message: `Priya Rao stops covering for you now instead of ${UNTIL}. From then on, your pages come to you again.`,
    });
  });

  test("for the person covering: that they stop, and whose pages go back", () => {
    expect(describeEndNow(override({}), "priya", NOW).message).toBe(
      `You stop covering for Ada Lovelace now instead of ${UNTIL}. From then on, their pages go to them again.`,
    );
  });

  test("for somebody else: both named, as the dashboard says it", () => {
    expect(describeEndNow(override({}), "kim", NOW).message).toBe(
      `Priya Rao stops covering for Ada Lovelace now instead of ${UNTIL}. From then on, alerts page Ada Lovelace again.`,
    );
  });

  test("for a skip: back in the rotation", () => {
    expect(
      describeEndNow(override({ routeAlertsToUser: null }), "ada", NOW).message,
    ).toBe(
      `You stop being skipped now instead of ${UNTIL}. From then on, you take your turns in the rotation again.`,
    );
    expect(
      describeEndNow(override({ routeAlertsToUser: null }), "kim", NOW).message,
    ).toBe(
      `Ada Lovelace stops being skipped now instead of ${UNTIL}. From then on, they take their turns in the rotation again.`,
    );
  });

  test("asks whether to end it now", () => {
    expect(END_NOW_TITLE).toBe("End this override now?");
  });
});
