import { describe, expect, test } from "@jest/globals";
import {
  INCOMING_CALL_POLICY_REPEAT,
  ON_CALL_POLICY_REPEAT,
  RepeatChoice,
  RepeatChoiceConfig,
  getValuesForRepeatChoice,
  readRepeatTimes,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/RepeatChoice/RepeatChoice";
import {
  ON_CALL_POLICY_REPEAT_COLUMNS,
  getOnCallPolicyRepeatRefusal,
} from "../../../Types/OnCallDutyPolicy/OnCallDutyPolicyRepeat";
import {
  INCOMING_CALL_POLICY_REPEAT_COLUMNS,
  getIncomingCallPolicyRepeatRefusal,
} from "../../../Types/IncomingCall/IncomingCallPolicyRepeat";

/*
 * THE REPEAT POLICY CARD AND THE SERVER TAKE THE SAME PAIRS.
 *
 * The card asks Stop or Start again, and then how many more times; the
 * server refuses a pair that says it repeats without a whole number of 1 or
 * more (OnCallDutyPolicyRepeat, IncomingCallPolicyRepeat). So every answer
 * the card writes is one the server saves, and the box takes exactly the
 * numbers the server takes - nobody fills in the card and is refused on
 * Save.
 */

interface Kind {
  name: string;
  config: RepeatChoiceConfig;
  columns: ReadonlyArray<string>;
  getRefusal: (values: Record<string, unknown>) => string | null;
}

const KINDS: Array<Kind> = [
  {
    name: "an on-call policy",
    config: ON_CALL_POLICY_REPEAT,
    columns: ON_CALL_POLICY_REPEAT_COLUMNS,
    getRefusal: getOnCallPolicyRepeatRefusal,
  },
  {
    name: "an incoming call policy",
    config: INCOMING_CALL_POLICY_REPEAT,
    columns: INCOMING_CALL_POLICY_REPEAT_COLUMNS,
    getRefusal: getIncomingCallPolicyRepeatRefusal,
  },
];

// Pairs a policy may be stored with, sensible or not.
const STORED_TIMES: Array<unknown> = [0, 1, 2, 5, -1, 2.5, null, undefined];
const STORED_SWITCHES: Array<unknown> = [true, false, null, undefined];

describe.each(KINDS)("the Repeat Policy card of $name", (kind: Kind) => {
  test("names the same two columns the server's rule reads", () => {
    expect([kind.config.columns.repeat, kind.config.columns.times]).toEqual([
      ...kind.columns,
    ]);
  });

  test("writes only pairs the server saves, whatever was stored", () => {
    const refused: Array<string> = [];

    for (const repeat of STORED_SWITCHES) {
      for (const times of STORED_TIMES) {
        for (const choice of [RepeatChoice.Stop, RepeatChoice.StartAgain]) {
          const values: Record<string, unknown> = getValuesForRepeatChoice({
            config: kind.config,
            values: {
              [kind.config.columns.repeat]: repeat,
              [kind.config.columns.times]: times,
            },
            choice: choice,
          });

          if (kind.getRefusal(values)) {
            refused.push(`${String(repeat)}/${String(times)} -> ${choice}`);
          }
        }
      }
    }

    expect(refused).toEqual([]);
  });

  test("its box takes exactly the numbers the server takes", () => {
    const disagreements: Array<string> = [];

    for (const typed of [
      0,
      1,
      2,
      10,
      -1,
      1.5,
      "",
      " ",
      "0",
      "1",
      "3",
      " 2 ",
      "1.5",
      "two",
      Number.NaN,
    ]) {
      const boxTakes: boolean = readRepeatTimes(typed) !== null;
      const serverTakes: boolean =
        kind.getRefusal({
          [kind.config.columns.repeat]: true,
          [kind.config.columns.times]: typed,
        }) === null;

      if (boxTakes !== serverTakes) {
        disagreements.push(
          `${JSON.stringify(typed)}: box ${String(boxTakes)}, server ${String(serverTakes)}`,
        );
      }
    }

    expect(disagreements).toEqual([]);
  });
});
