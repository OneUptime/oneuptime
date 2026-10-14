import { describe, expect, test } from "@jest/globals";
import {
  decideStateRowDelete,
  ONLY_STATE_DELETE_MESSAGES,
  StateRowDeleteEffect,
  StateTimelineRecord,
} from "../../../Utils/StateTimeline/StateTimelineRowDelete";

/*
 * What deleting one row of an incident's, alert's, scheduled maintenance
 * event's or episode's state timeline does - the rule the five services
 * follow and the Status Timeline pages say before anyone clicks.
 */
describe("decideStateRowDelete", () => {
  test("the record's only state is refused", () => {
    expect(
      decideStateRowDelete({ hasStateBefore: false, hasStateAfter: false }),
    ).toBe(StateRowDeleteEffect.OnlyState);
  });

  test("the newest state: the one before it is current again", () => {
    expect(
      decideStateRowDelete({ hasStateBefore: true, hasStateAfter: false }),
    ).toBe(StateRowDeleteEffect.PreviousIsCurrentAgain);
  });

  test("a state in the middle: the one before it takes over its time", () => {
    expect(
      decideStateRowDelete({ hasStateBefore: true, hasStateAfter: true }),
    ).toBe(StateRowDeleteEffect.PreviousTakesOver);
  });

  test("the oldest state: nothing else moves", () => {
    expect(
      decideStateRowDelete({ hasStateBefore: false, hasStateAfter: true }),
    ).toBe(StateRowDeleteEffect.NothingMoves);
  });
});

describe("ONLY_STATE_DELETE_MESSAGES", () => {
  test("has a refusal for every record whose history is a state timeline", () => {
    expect(Object.keys(ONLY_STATE_DELETE_MESSAGES).sort()).toEqual(
      Object.values(StateTimelineRecord).sort(),
    );
  });

  test.each(Object.entries(ONLY_STATE_DELETE_MESSAGES))(
    "%s: says the rule, why, and what to do instead",
    (_record: string, message: string) => {
      expect(message).toContain("only state can't be deleted");
      expect(message).toContain("always has a state");
      expect(message).toContain("To change it, add a new state.");
    },
  );

  test("both kinds of episode read the same", () => {
    expect(
      ONLY_STATE_DELETE_MESSAGES[StateTimelineRecord.IncidentEpisode],
    ).toBe(ONLY_STATE_DELETE_MESSAGES[StateTimelineRecord.AlertEpisode]);
  });
});
