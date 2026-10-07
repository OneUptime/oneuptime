import StateChangeFeedEmoji, {
  ACKNOWLEDGED_FEED_EMOJI,
  CREATED_FEED_EMOJI,
  OTHER_STATE_FEED_EMOJI,
  RESOLVED_FEED_EMOJI,
} from "../../../Server/Utils/StateChangeFeedEmoji";
import { describe, expect, test } from "@jest/globals";

/*
 * The mark a state change's feed line starts with, for incidents, alerts and
 * both kinds of episode alike: resolved first, then acknowledged - the
 * acknowledged state, a state placed after it, by the one rule - then the
 * created state, then any other move.
 */
describe("StateChangeFeedEmoji", () => {
  test.each([
    [
      "resolved",
      { isResolved: true, isAcknowledged: true, isCreatedState: false },
      RESOLVED_FEED_EMOJI,
    ],
    [
      "resolved, even when the caller did not count it as acknowledged",
      { isResolved: true, isAcknowledged: false, isCreatedState: false },
      RESOLVED_FEED_EMOJI,
    ],
    [
      "acknowledged (the acknowledged state, or one placed after it)",
      { isResolved: false, isAcknowledged: true, isCreatedState: false },
      ACKNOWLEDGED_FEED_EMOJI,
    ],
    [
      "the created state",
      { isResolved: false, isAcknowledged: false, isCreatedState: true },
      CREATED_FEED_EMOJI,
    ],
    [
      "any other state",
      { isResolved: false, isAcknowledged: false, isCreatedState: false },
      OTHER_STATE_FEED_EMOJI,
    ],
  ])(
    "marks a move into %s",
    (
      _label: string,
      move: {
        isResolved: boolean;
        isAcknowledged: boolean;
        isCreatedState: boolean;
      },
      expected: string,
    ) => {
      expect(StateChangeFeedEmoji.get(move)).toBe(expected);
    },
  );

  test("the four marks are the ones the feeds always used, and all differ", () => {
    expect([
      RESOLVED_FEED_EMOJI,
      ACKNOWLEDGED_FEED_EMOJI,
      CREATED_FEED_EMOJI,
      OTHER_STATE_FEED_EMOJI,
    ]).toEqual(["✅", "👀", "🔴", "➡️"]);
  });
});
