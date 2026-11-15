import { describe, expect, test } from "@jest/globals";
import {
  getOnCallPolicyRunEndedWhileWaitingMessage,
  getOnCallPolicyRunWaitingMessage,
  isOnCallPolicyRunWaitingForOneUptimeAI,
  isOnCallPolicyRunWaitingForWorkingHours,
  OnCallPolicyRunWaitReason,
  readOnCallPolicyRunWaitReason,
} from "../../../Types/OnCallDutyPolicy/OnCallDutyPolicyRunWait";

/*
 * ISSUE #7552: WHY A WAITING RUN WAITS, READ BACK FROM ITS MESSAGE.
 *
 * A run held before it pages says why and when in its status message, in
 * English for every reader (its record's feed, its chat message). The
 * Execution Logs table now words the line in the reader's language from
 * the run itself: why it waits, read here, and when paging starts, from
 * the run's own moment. Two things are pinned: the English, word for word
 * as it was written before - rows in a database today hold it - and the
 * reading: every message the writer writes reads back into its reason, and
 * any other message is no reason, so it is drawn as written.
 */

const NOW: Date = new Date("2026-11-16T10:00:00.000Z");
const SOON: Date = new Date("2026-11-18T09:00:00.000Z");
const FAR: Date = new Date("2027-02-03T09:30:00.000Z");

describe("the English messages, word for word as they were written before", () => {
  test("waiting for working hours, a moment this week, in the rule's zone", () => {
    expect(
      getOnCallPolicyRunWaitingMessage({
        pagingStartsAt: SOON,
        timezone: "Europe/London",
        now: NOW,
        isWaitingForWorkingHours: true,
      }),
    ).toBe(
      "Waiting for working hours. Paging starts Wed 09:00 (Europe/London).",
    );
  });

  test("waiting for OneUptime AI", () => {
    expect(
      getOnCallPolicyRunWaitingMessage({
        pagingStartsAt: SOON,
        now: NOW,
        isWaitingForWorkingHours: false,
        isWaitingForOneUptimeAI: true,
      }),
    ).toBe(
      "Waiting for OneUptime AI. Paging starts Wed 09:00 (UTC) unless it resolves this.",
    );
  });

  test("waiting for any other reason, a moment a week or more away naming its date", () => {
    expect(
      getOnCallPolicyRunWaitingMessage({
        pagingStartsAt: FAR,
        now: NOW,
        isWaitingForWorkingHours: false,
      }),
    ).toBe("Waiting. Paging starts Wed, Feb 3, 2027 09:30 (UTC).");
  });
});

describe("readOnCallPolicyRunWaitReason", () => {
  const cases: Array<
    [
      string,
      { isWaitingForWorkingHours: boolean; isAi?: boolean },
      OnCallPolicyRunWaitReason,
    ]
  > = [
    [
      "working hours",
      { isWaitingForWorkingHours: true },
      OnCallPolicyRunWaitReason.WorkingHours,
    ],
    [
      "OneUptime AI",
      { isWaitingForWorkingHours: false, isAi: true },
      OnCallPolicyRunWaitReason.OneUptimeAI,
    ],
    [
      "any other reason",
      { isWaitingForWorkingHours: false },
      OnCallPolicyRunWaitReason.Other,
    ],
  ];

  test.each(cases)(
    "every message for %s reads back into its reason, whenever and wherever it pages",
    (
      _label: string,
      shape: { isWaitingForWorkingHours: boolean; isAi?: boolean },
      reason: OnCallPolicyRunWaitReason,
    ) => {
      for (const pagingStartsAt of [SOON, FAR]) {
        for (const timezone of [
          undefined,
          "UTC",
          "Europe/London",
          "Asia/Tehran",
          "America/Argentina/Buenos_Aires",
          "Not/AZone",
        ]) {
          const message: string = getOnCallPolicyRunWaitingMessage({
            pagingStartsAt: pagingStartsAt,
            timezone: timezone,
            now: NOW,
            isWaitingForWorkingHours: shape.isWaitingForWorkingHours,
            isWaitingForOneUptimeAI: shape.isAi,
          });

          expect([message, readOnCallPolicyRunWaitReason(message)]).toEqual([
            message,
            reason,
          ]);
          // Spaces around a stored message do not change what it says.
          expect(readOnCallPolicyRunWaitReason(`  ${message}\n`)).toBe(reason);
        }
      }
    },
  );

  test("the readers the record's feed uses agree with it", () => {
    const working: string = getOnCallPolicyRunWaitingMessage({
      pagingStartsAt: SOON,
      now: NOW,
      isWaitingForWorkingHours: true,
    });
    const ai: string = getOnCallPolicyRunWaitingMessage({
      pagingStartsAt: SOON,
      now: NOW,
      isWaitingForWorkingHours: false,
      isWaitingForOneUptimeAI: true,
    });

    expect(isOnCallPolicyRunWaitingForWorkingHours(working)).toBe(true);
    expect(readOnCallPolicyRunWaitReason(working)).toBe(
      OnCallPolicyRunWaitReason.WorkingHours,
    );
    expect(isOnCallPolicyRunWaitingForOneUptimeAI(ai)).toBe(true);
    expect(readOnCallPolicyRunWaitReason(ai)).toBe(
      OnCallPolicyRunWaitReason.OneUptimeAI,
    );
  });

  test("any other message is no reason: it is drawn as written", () => {
    for (const message of [
      null,
      undefined,
      "",
      "Waiting.",
      "Waiting for working hours.",
      "Waiting for working hours. Paging starts .",
      "Waiting for OneUptime AI.",
      // An AI hold's message cut short, or a caller's own wording.
      "Waiting for OneUptime AI. Paging starts Wed 09:00 (UTC).x",
      "Waiting until the maintenance window ends.",
      "Paging starts Wed 09:00 (UTC).",
      getOnCallPolicyRunEndedWhileWaitingMessage("alert"),
      "Execution started.",
    ]) {
      expect([message, readOnCallPolicyRunWaitReason(message)]).toEqual([
        message,
        null,
      ]);
    }
  });

  test("a held run's message with no full stop at its end is not one this writer wrote", () => {
    expect(
      readOnCallPolicyRunWaitReason(
        "Waiting for working hours. Paging starts Wed 09:00 (Europe/London)",
      ),
    ).toBeNull();
  });
});
