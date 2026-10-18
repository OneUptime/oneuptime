import { describe, expect, test } from "@jest/globals";
import {
  DEFAULT_REPEAT_TIMES,
  INCOMING_CALL_POLICY_REPEAT,
  ON_CALL_POLICY_REPEAT,
  REPEAT_CHOICES,
  REPEAT_CHOICE_FIELD_KEY,
  RepeatChoice,
  RepeatChoiceConfig,
  getRepeatChoice,
  getRepeatTimes,
  getValuesForRepeatChoice,
  isRepeatChoice,
  readRepeatTimes,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/RepeatChoice/RepeatChoice";
import { getOnCallPolicyRepeatsAllowed } from "../../../Types/OnCallDutyPolicy/OnCallDutyPolicyRepeat";
import { getIncomingCallPolicyRepeatsAllowed } from "../../../Types/IncomingCall/IncomingCallPolicyRepeat";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import IncomingCallPolicy from "../../../Models/DatabaseModels/IncomingCallPolicy";

/*
 * What happens after a policy's last level, as one plain choice: Stop, or
 * Start again - and then how many more times. It replaced a switch whose
 * help explained both modes and a number that meant something only while
 * the switch was on (RepeatChoice.ts). These hold the choice to the two
 * stored columns, which did not change: what a stored pair reads as is
 * what the worker (on-call) and the call handler (incoming) do with it, and
 * an answer is written back into exactly those two columns.
 */

type Values = Record<string, unknown>;

function onCall(repeat: unknown, times: unknown): Values {
  return {
    repeatPolicyIfNoOneAcknowledges: repeat,
    repeatPolicyIfNoOneAcknowledgesNoOfTimes: times,
  };
}

function incoming(repeat: unknown, times: unknown): Values {
  return {
    repeatPolicyIfNoOneAnswers: repeat,
    repeatPolicyIfNoOneAnswersTimes: times,
  };
}

describe("the two answers", () => {
  test("are Stop, then Start again - what a new policy does comes first", () => {
    expect(REPEAT_CHOICES).toEqual([
      RepeatChoice.Stop,
      RepeatChoice.StartAgain,
    ]);
    expect(isRepeatChoice("stop")).toBe(true);
    expect(isRepeatChoice("start-again")).toBe(true);
    expect(isRepeatChoice("repeat")).toBe(false);
    expect(isRepeatChoice(true)).toBe(false);
  });

  test("write the columns each model really has", () => {
    const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
    const callPolicy: IncomingCallPolicy = new IncomingCallPolicy();

    for (const [config, model] of [
      [ON_CALL_POLICY_REPEAT, policy],
      [INCOMING_CALL_POLICY_REPEAT, callPolicy],
    ] as Array<[RepeatChoiceConfig, OnCallDutyPolicy | IncomingCallPolicy]>) {
      expect(model.getTableColumnMetadata(config.columns.repeat)).toBeTruthy();
      expect(model.getTableColumnMetadata(config.columns.times)).toBeTruthy();
      // The column a new record stores its number in starts where the config says.
      expect(
        model.getTableColumnMetadata(config.columns.times).defaultValue,
      ).toBe(config.timesColumnDefault);
      // A new record stores the switch off: Stop is what it does.
      expect(
        model.getTableColumnMetadata(config.columns.repeat).defaultValue,
      ).toBe(false);
    }
  });
});

describe("what a stored on-call policy reads as", () => {
  test("is what the escalation worker does with it", () => {
    const pairs: Array<[unknown, unknown]> = [
      [false, 0],
      [false, 3],
      [true, 0],
      [true, 1],
      [true, 3],
      [null, 2],
      [undefined, undefined],
    ];

    for (const [repeat, times] of pairs) {
      const allowed: number = getOnCallPolicyRepeatsAllowed({
        repeatPolicyIfNoOneAcknowledges: repeat as boolean,
        repeatPolicyIfNoOneAcknowledgesNoOfTimes: times as number,
      });

      expect({
        repeat,
        times,
        choice: getRepeatChoice(ON_CALL_POLICY_REPEAT, onCall(repeat, times)),
        times_: getRepeatTimes(ON_CALL_POLICY_REPEAT, onCall(repeat, times)),
      }).toEqual({
        repeat,
        times,
        choice: allowed > 0 ? RepeatChoice.StartAgain : RepeatChoice.Stop,
        times_: allowed,
      });
    }
  });

  test("reads the switch on with 0 repeats - which never repeated - as Stop", () => {
    expect(getRepeatChoice(ON_CALL_POLICY_REPEAT, onCall(true, 0))).toBe(
      RepeatChoice.Stop,
    );
  });

  test("reads a model instance as well as form values", () => {
    const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
    policy.repeatPolicyIfNoOneAcknowledges = true;
    policy.repeatPolicyIfNoOneAcknowledgesNoOfTimes = 2;

    expect(getRepeatChoice(ON_CALL_POLICY_REPEAT, policy)).toBe(
      RepeatChoice.StartAgain,
    );
    expect(getRepeatTimes(ON_CALL_POLICY_REPEAT, policy)).toBe(2);
    expect(getRepeatChoice(ON_CALL_POLICY_REPEAT, null)).toBe(
      RepeatChoice.Stop,
    );
  });
});

describe("what a stored incoming call policy reads as", () => {
  test("is what the call handler does with it", () => {
    const pairs: Array<[unknown, unknown]> = [
      [false, 1],
      [false, 4],
      [true, 0],
      [true, 1],
      [true, 4],
      [true, null],
      [undefined, undefined],
    ];

    for (const [repeat, times] of pairs) {
      const allowed: number = getIncomingCallPolicyRepeatsAllowed({
        repeatPolicyIfNoOneAnswers: repeat as boolean,
        repeatPolicyIfNoOneAnswersTimes: times as number,
      });

      expect({
        repeat,
        times,
        choice: getRepeatChoice(
          INCOMING_CALL_POLICY_REPEAT,
          incoming(repeat, times),
        ),
        times_: getRepeatTimes(
          INCOMING_CALL_POLICY_REPEAT,
          incoming(repeat, times),
        ),
      }).toEqual({
        repeat,
        times,
        choice: allowed > 0 ? RepeatChoice.StartAgain : RepeatChoice.Stop,
        times_: allowed,
      });
    }
  });

  test("reads the switch on with 0 as ringing again once, as calls do", () => {
    expect(
      getRepeatChoice(INCOMING_CALL_POLICY_REPEAT, incoming(true, 0)),
    ).toBe(RepeatChoice.StartAgain);
    expect(getRepeatTimes(INCOMING_CALL_POLICY_REPEAT, incoming(true, 0))).toBe(
      1,
    );
  });
});

describe("picking Start again", () => {
  test("turns the switch on and starts a policy that stopped at once more", () => {
    expect(
      getValuesForRepeatChoice({
        config: ON_CALL_POLICY_REPEAT,
        values: onCall(false, 0),
        choice: RepeatChoice.StartAgain,
      }),
    ).toEqual({
      ...onCall(true, DEFAULT_REPEAT_TIMES),
      [REPEAT_CHOICE_FIELD_KEY]: RepeatChoice.StartAgain,
    });
    expect(DEFAULT_REPEAT_TIMES).toBe(1);
  });

  test("gives a policy whose repeats were switched off its old number back", () => {
    expect(
      getValuesForRepeatChoice({
        config: ON_CALL_POLICY_REPEAT,
        values: onCall(false, 3),
        choice: RepeatChoice.StartAgain,
      }),
    ).toEqual({
      ...onCall(true, 3),
      [REPEAT_CHOICE_FIELD_KEY]: RepeatChoice.StartAgain,
    });
  });

  test("keeps the number a policy that starts again already has", () => {
    expect(
      getValuesForRepeatChoice({
        config: INCOMING_CALL_POLICY_REPEAT,
        values: incoming(true, 4),
        choice: RepeatChoice.StartAgain,
      }),
    ).toEqual({
      ...incoming(true, 4),
      [REPEAT_CHOICE_FIELD_KEY]: RepeatChoice.StartAgain,
    });
  });

  test("never starts with a number below 1, even from an emptied box", () => {
    for (const times of ["", null, undefined, 0, -1, "abc", 1.5]) {
      const values: Values = getValuesForRepeatChoice({
        config: ON_CALL_POLICY_REPEAT,
        values: onCall(false, times),
        choice: RepeatChoice.StartAgain,
      });

      expect({
        times,
        stored: values[ON_CALL_POLICY_REPEAT.columns.times],
      }).toEqual({ times, stored: 1 });
    }
  });

  test("leaves every other value of the form as it was", () => {
    const values: Values = getValuesForRepeatChoice({
      config: ON_CALL_POLICY_REPEAT,
      values: { ...onCall(false, 0), name: "Platform on-call", _id: "x" },
      choice: RepeatChoice.StartAgain,
    });

    expect(values["name"]).toBe("Platform on-call");
    expect(values["_id"]).toBe("x");
  });
});

describe("picking Stop", () => {
  test("turns the switch off and leaves the stored number as it is", () => {
    expect(
      getValuesForRepeatChoice({
        config: ON_CALL_POLICY_REPEAT,
        values: onCall(true, 3),
        choice: RepeatChoice.Stop,
      }),
    ).toEqual({
      ...onCall(false, 3),
      [REPEAT_CHOICE_FIELD_KEY]: RepeatChoice.Stop,
    });

    expect(
      getValuesForRepeatChoice({
        config: INCOMING_CALL_POLICY_REPEAT,
        values: incoming(true, 2),
        choice: RepeatChoice.Stop,
      }),
    ).toEqual({
      ...incoming(false, 2),
      [REPEAT_CHOICE_FIELD_KEY]: RepeatChoice.Stop,
    });
  });

  test("puts an emptied number box back to the column's default, which Postgres can store", () => {
    for (const [config, values] of [
      [ON_CALL_POLICY_REPEAT, onCall(true, "")],
      [INCOMING_CALL_POLICY_REPEAT, incoming(true, "")],
      [ON_CALL_POLICY_REPEAT, onCall(true, null)],
      [INCOMING_CALL_POLICY_REPEAT, incoming(true, undefined)],
      [INCOMING_CALL_POLICY_REPEAT, incoming(true, "  ")],
    ] as Array<[RepeatChoiceConfig, Values]>) {
      const next: Values = getValuesForRepeatChoice({
        config: config,
        values: values,
        choice: RepeatChoice.Stop,
      });

      expect(next[config.columns.repeat]).toBe(false);
      expect(next[config.columns.times]).toBe(config.timesColumnDefault);
    }
  });

  test("keeps a stored 0", () => {
    const next: Values = getValuesForRepeatChoice({
      config: ON_CALL_POLICY_REPEAT,
      values: onCall(true, 0),
      choice: RepeatChoice.Stop,
    });

    expect(next[ON_CALL_POLICY_REPEAT.columns.times]).toBe(0);
  });
});

describe("a number typed in the box", () => {
  test("is a whole number of at least 1, or nothing", () => {
    expect(readRepeatTimes(1)).toBe(1);
    expect(readRepeatTimes("3")).toBe(3);
    expect(readRepeatTimes(0)).toBeNull();
    expect(readRepeatTimes(-2)).toBeNull();
    expect(readRepeatTimes(2.5)).toBeNull();
    expect(readRepeatTimes("")).toBeNull();
    expect(readRepeatTimes(null)).toBeNull();
    expect(readRepeatTimes(undefined)).toBeNull();
    expect(readRepeatTimes("two")).toBeNull();
  });
});

describe("the words", () => {
  test("ask one question per policy, in the words of each", () => {
    expect(ON_CALL_POLICY_REPEAT.copy.fieldTitle).toBe(
      "If nobody acknowledges after the last level",
    );
    expect(ON_CALL_POLICY_REPEAT.copy.choices[RepeatChoice.Stop].title).toBe(
      "Stop paging",
    );
    expect(
      ON_CALL_POLICY_REPEAT.copy.choices[RepeatChoice.StartAgain].title,
    ).toBe("Start again from Level 1");

    expect(INCOMING_CALL_POLICY_REPEAT.copy.fieldTitle).toBe(
      "If nobody answers after the last rule",
    );
    expect(
      INCOMING_CALL_POLICY_REPEAT.copy.choices[RepeatChoice.Stop].title,
    ).toBe("End the call");
    expect(
      INCOMING_CALL_POLICY_REPEAT.copy.choices[RepeatChoice.StartAgain].title,
    ).toBe("Ring again from the first rule");
  });

  test("keep the card's name - Repeat Policy - on both policies", () => {
    for (const config of [ON_CALL_POLICY_REPEAT, INCOMING_CALL_POLICY_REPEAT]) {
      expect(config.copy.cardTitle).toBe("Repeat Policy");
      expect(config.copy.dialogTitle).toBe("Edit Repeat Policy");
      expect(config.copy.timesTitle).toBe("How many more times?");
      expect(config.copy.startAgainSummary).toContain("{{times}}");
    }
  });

  test("say each answer in one short line, without the old switch's words", () => {
    for (const config of [ON_CALL_POLICY_REPEAT, INCOMING_CALL_POLICY_REPEAT]) {
      const texts: Array<string> = [
        config.copy.cardDescription,
        config.copy.fieldTitle,
        config.copy.timesTitle,
        config.copy.timesDescription,
        config.copy.rowTitle,
        config.copy.startAgainSummary,
        ...REPEAT_CHOICES.map((choice: RepeatChoice): string => {
          return config.copy.choices[choice].title;
        }),
        ...REPEAT_CHOICES.map((choice: RepeatChoice): string => {
          return config.copy.choices[choice].description;
        }),
      ];

      for (const text of texts) {
        expect({ text, short: text.length <= 80 }).toEqual({
          text,
          short: true,
        });
        expect(text).not.toMatch(/enable|disable|escalations fail|exhausted/i);
      }
    }
  });
});
