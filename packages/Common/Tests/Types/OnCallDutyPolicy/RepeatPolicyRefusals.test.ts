import { describe, expect, test } from "@jest/globals";
import {
  ON_CALL_POLICY_REPEAT_COLUMNS,
  ON_CALL_POLICY_REPEAT_TIMES_REFUSAL,
  getOnCallPolicyRepeatRefusal,
  getOnCallPolicyRepeatsAllowed,
  isRepeatCountOfAtLeastOne,
} from "../../../Types/OnCallDutyPolicy/OnCallDutyPolicyRepeat";
import {
  INCOMING_CALL_POLICY_REPEAT_COLUMNS,
  INCOMING_CALL_POLICY_REPEAT_TIMES_REFUSAL,
  getIncomingCallPolicyRepeatRefusal,
} from "../../../Types/IncomingCall/IncomingCallPolicyRepeat";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import IncomingCallPolicy from "../../../Models/DatabaseModels/IncomingCallPolicy";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";

/*
 * A POLICY THAT SAYS IT REPEATS SAYS HOW MANY TIMES: 1 OR MORE.
 *
 * The Repeat Policy card of an on-call policy and of an incoming call
 * policy asks "How many more times?" only once Start again is picked, and
 * takes a whole number of 1 or more. The server holds every other way of
 * saving a policy to the same: the switch on with 0, a negative number, a
 * part of a number or nothing at all is refused - except that an incoming
 * call policy's number, left out, is its column's default of 1.
 */

const COUNT_REFUSED: ReadonlyArray<unknown> = [
  0,
  -1,
  -3,
  1.5,
  0.5,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  "",
  "  ",
  "0",
  "two",
  "1.5",
  true,
  {},
  [],
  null,
];

const COUNT_TAKEN: ReadonlyArray<unknown> = [1, 2, 3, 10, 99, "1", "4", " 2 "];

describe("a repeat count of at least one", () => {
  test.each(
    COUNT_TAKEN.map((value: unknown) => {
      return [value];
    }),
  )("%p is one", (value: unknown) => {
    expect(isRepeatCountOfAtLeastOne(value)).toBe(true);
  });

  test.each(
    COUNT_REFUSED.map((value: unknown) => {
      return [value];
    }),
  )("%p is not", (value: unknown) => {
    expect(isRepeatCountOfAtLeastOne(value)).toBe(false);
  });

  test("nothing at all is not one", () => {
    expect(isRepeatCountOfAtLeastOne(undefined)).toBe(false);
  });
});

describe("an on-call policy's repeat", () => {
  const onCall: (
    repeat: unknown,
    times?: unknown,
  ) => Record<string, unknown> = (
    repeat: unknown,
    times?: unknown,
  ): Record<string, unknown> => {
    const values: Record<string, unknown> = {
      repeatPolicyIfNoOneAcknowledges: repeat,
    };

    if (times !== undefined) {
      values["repeatPolicyIfNoOneAcknowledgesNoOfTimes"] = times;
    }

    return values;
  };

  test.each(
    COUNT_TAKEN.map((value: unknown) => {
      return [value];
    }),
  )("on with %p is saved", (times: unknown) => {
    expect(getOnCallPolicyRepeatRefusal(onCall(true, times))).toBeNull();
  });

  test.each(
    COUNT_REFUSED.map((value: unknown) => {
      return [value];
    }),
  )("on with %p is refused", (times: unknown) => {
    expect(getOnCallPolicyRepeatRefusal(onCall(true, times))).toBe(
      ON_CALL_POLICY_REPEAT_TIMES_REFUSAL,
    );
  });

  test("on with no number is refused: the column's default is 0, and 0 never repeats", () => {
    expect(getOnCallPolicyRepeatRefusal(onCall(true))).toBe(
      ON_CALL_POLICY_REPEAT_TIMES_REFUSAL,
    );
    expect(
      new OnCallDutyPolicy().getTableColumnMetadata(
        "repeatPolicyIfNoOneAcknowledgesNoOfTimes",
      ).defaultValue,
    ).toBe(0);
  });

  test("0, below 0 and nothing are what the run reads as no repeat at all", () => {
    for (const times of [0, -1, -3, Number.NaN, "", "0", null, undefined]) {
      expect({
        times: String(times),
        repeats: getOnCallPolicyRepeatsAllowed({
          repeatPolicyIfNoOneAcknowledges: true,
          repeatPolicyIfNoOneAcknowledgesNoOfTimes: times as number,
        }),
        refusal: getOnCallPolicyRepeatRefusal(onCall(true, times)),
      }).toEqual({
        times: String(times),
        repeats: 0,
        refusal: ON_CALL_POLICY_REPEAT_TIMES_REFUSAL,
      });
    }
  });

  test("a part of a number is refused though the run would round it down: the card takes whole numbers", () => {
    expect(
      getOnCallPolicyRepeatsAllowed({
        repeatPolicyIfNoOneAcknowledges: true,
        repeatPolicyIfNoOneAcknowledgesNoOfTimes: 2.5,
      }),
    ).toBe(2);
    expect(getOnCallPolicyRepeatRefusal(onCall(true, 2.5))).toBe(
      ON_CALL_POLICY_REPEAT_TIMES_REFUSAL,
    );
  });

  test.each([false, null, undefined])(
    "off (%p) is saved whatever number was left behind: it means nothing then",
    (repeat: unknown) => {
      for (const times of [...COUNT_REFUSED, ...COUNT_TAKEN, undefined]) {
        expect(getOnCallPolicyRepeatRefusal(onCall(repeat, times))).toBeNull();
      }
    },
  );

  test("the refusal says what to set, in the API's own column titles", () => {
    const model: OnCallDutyPolicy = new OnCallDutyPolicy();

    expect(ON_CALL_POLICY_REPEAT_TIMES_REFUSAL).toContain(
      `set ${model.getTableColumnMetadata("repeatPolicyIfNoOneAcknowledgesNoOfTimes").title} to a whole number of 1 or more`,
    );
    expect(ON_CALL_POLICY_REPEAT_TIMES_REFUSAL).toContain(
      `turn off ${model.getTableColumnMetadata("repeatPolicyIfNoOneAcknowledges").title}`,
    );
  });
});

describe("an incoming call policy's repeat", () => {
  const incoming: (
    repeat: unknown,
    times?: unknown,
  ) => Record<string, unknown> = (
    repeat: unknown,
    times?: unknown,
  ): Record<string, unknown> => {
    const values: Record<string, unknown> = {
      repeatPolicyIfNoOneAnswers: repeat,
    };

    if (times !== undefined) {
      values["repeatPolicyIfNoOneAnswersTimes"] = times;
    }

    return values;
  };

  test.each(
    COUNT_TAKEN.map((value: unknown) => {
      return [value];
    }),
  )("on with %p is saved", (times: unknown) => {
    expect(
      getIncomingCallPolicyRepeatRefusal(incoming(true, times)),
    ).toBeNull();
  });

  test.each(
    COUNT_REFUSED.map((value: unknown) => {
      return [value];
    }),
  )("on with %p is refused", (times: unknown) => {
    expect(getIncomingCallPolicyRepeatRefusal(incoming(true, times))).toBe(
      INCOMING_CALL_POLICY_REPEAT_TIMES_REFUSAL,
    );
  });

  test("on with no number is saved: the column's default is 1, so it rings again once", () => {
    expect(getIncomingCallPolicyRepeatRefusal(incoming(true))).toBeNull();
    expect(
      new IncomingCallPolicy().getTableColumnMetadata(
        "repeatPolicyIfNoOneAnswersTimes",
      ).defaultValue,
    ).toBe(1);
  });

  test.each([false, null, undefined])(
    "off (%p) is saved whatever number was left behind",
    (repeat: unknown) => {
      for (const times of [...COUNT_REFUSED, ...COUNT_TAKEN, undefined]) {
        expect(
          getIncomingCallPolicyRepeatRefusal(incoming(repeat, times)),
        ).toBeNull();
      }
    },
  );

  test("the refusal says what to set, in the API's own column titles", () => {
    const model: IncomingCallPolicy = new IncomingCallPolicy();

    expect(INCOMING_CALL_POLICY_REPEAT_TIMES_REFUSAL).toContain(
      `set ${model.getTableColumnMetadata("repeatPolicyIfNoOneAnswersTimes").title} to a whole number of 1 or more`,
    );
    expect(INCOMING_CALL_POLICY_REPEAT_TIMES_REFUSAL).toContain(
      `turn off ${model.getTableColumnMetadata("repeatPolicyIfNoOneAnswers").title}`,
    );
  });
});

describe("the columns the rules read", () => {
  test.each([
    ["OnCallDutyPolicy", new OnCallDutyPolicy(), ON_CALL_POLICY_REPEAT_COLUMNS],
    [
      "IncomingCallPolicy",
      new IncomingCallPolicy(),
      INCOMING_CALL_POLICY_REPEAT_COLUMNS,
    ],
  ] as Array<[string, BaseModel, ReadonlyArray<string>]>)(
    "are %s's own: the switch, then the number",
    (_name: string, model: BaseModel, columns: ReadonlyArray<string>) => {
      expect(columns).toHaveLength(2);

      for (const column of columns) {
        expect([column, model.hasColumn(column)]).toEqual([column, true]);
      }
    },
  );

  test("the numbers' descriptions in the API say 1 or more while the switch is on", () => {
    expect(
      new OnCallDutyPolicy().getTableColumnMetadata(
        "repeatPolicyIfNoOneAcknowledgesNoOfTimes",
      ).description,
    ).toContain(
      "a whole number of 1 or more while Repeat Policy If No One Acknowledges is on",
    );
    expect(
      new IncomingCallPolicy().getTableColumnMetadata(
        "repeatPolicyIfNoOneAnswersTimes",
      ).description,
    ).toContain(
      "a whole number of 1 or more while Repeat Policy If No One Answers is on",
    );
  });
});
