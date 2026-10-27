import { describe, expect, jest, test } from "@jest/globals";
import type { Mock } from "jest-mock";
import OnCallRuleWhenToPage from "../../../Types/OnCallDutyPolicy/OnCallRuleWhenToPage";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import type Field from "../../../UI/Components/Forms/Types/Field";
import type FormValues from "../../../UI/Components/Forms/Types/FormValues";
import {
  AI_HOLD_TIME_PROBLEM,
  WHEN_TO_PAGE_DESCRIPTIONS,
  WHEN_TO_PAGE_TITLES,
  canOneUptimeAiRespondFirst,
  fillInWhenToPage,
  getAiHoldTimeFoldedValue,
  getAiHoldTimeProblem,
  getOnCallRuleActionFields,
  isAiFirstResponderRule,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/EventRuleForm";
import { OnCallRuleRecord } from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallRule/WorkingHoursText";
import AiFirstResponderSummary from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallRule/AiFirstResponderSummary";
import WorkingHoursSummary from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallRule/WorkingHoursSummary";

/*
 * "After OneUptime AI tries" on an on-call rule's form (OnCallPolicyAiHold).
 *
 * Offered on alert and incident rules only, under the same question as
 * working hours; picking it fills in the default hold time, which shows as
 * one field of its own and on the folded More fields line, and a hold time
 * outside 1 to 30 whole minutes cannot be saved.
 */

type RuleValues = FormValues<Record<string, unknown>>;

function whenToPageOptions(record: OnCallRuleRecord): Array<string> {
  const field: Field<Record<string, unknown>> | undefined =
    getOnCallRuleActionFields<Record<string, unknown>>(record).find(
      (candidate: Field<Record<string, unknown>>): boolean => {
        return Boolean(
          (candidate.field as Record<string, unknown> | undefined)?.[
            "whenToPage"
          ],
        );
      },
    );

  return (field?.radioButtonOptions || []).map(
    (option: { value: string }): string => {
      return option.value;
    },
  );
}

function holdTimeField(
  record: OnCallRuleRecord,
): Field<Record<string, unknown>> | undefined {
  return getOnCallRuleActionFields<Record<string, unknown>>(record).find(
    (candidate: Field<Record<string, unknown>>): boolean => {
      return Boolean(
        (candidate.field as Record<string, unknown> | undefined)?.[
          "aiHoldTimeInMinutes"
        ],
      );
    },
  );
}

describe("which rules offer it", () => {
  test("alert and incident rules do", () => {
    for (const record of [OnCallRuleRecord.Alert, OnCallRuleRecord.Incident]) {
      expect(canOneUptimeAiRespondFirst(record)).toBe(true);
      expect(whenToPageOptions(record)).toEqual([
        OnCallRuleWhenToPage.RightAway,
        OnCallRuleWhenToPage.WorkingHours,
        OnCallRuleWhenToPage.AfterOneUptimeAI,
      ]);
      expect(holdTimeField(record)).toBeDefined();
    }
  });

  test("episode rules do not: OneUptime AI investigates alerts and incidents", () => {
    for (const record of [
      OnCallRuleRecord.AlertEpisode,
      OnCallRuleRecord.IncidentEpisode,
    ]) {
      expect(canOneUptimeAiRespondFirst(record)).toBe(false);
      expect(whenToPageOptions(record)).toEqual([
        OnCallRuleWhenToPage.RightAway,
        OnCallRuleWhenToPage.WorkingHours,
      ]);
      expect(holdTimeField(record)).toBeUndefined();
    }
  });

  test("its title and description say what it does, in plain words", () => {
    expect(WHEN_TO_PAGE_TITLES[OnCallRuleWhenToPage.AfterOneUptimeAI]).toBe(
      "After OneUptime AI tries",
    );
    expect(
      WHEN_TO_PAGE_DESCRIPTIONS[OnCallRuleWhenToPage.AfterOneUptimeAI],
    ).toBe(
      "OneUptime AI looks first and fixes what it may. If it hasn't resolved this in time, page as usual.",
    );
  });
});

describe("the hold time field", () => {
  test("is a number, folded under More fields, shown only with the AI choice", () => {
    const field: Field<Record<string, unknown>> = holdTimeField(
      OnCallRuleRecord.Incident,
    )!;

    expect(field.fieldType).toBe(FormFieldSchemaType.Number);
    expect(field.required).toBe(false);
    expect(field.collapsibleSection).toBeDefined();
    expect(field.placeholder).toBe("10");

    const showIf: (values: RuleValues) => boolean = field.showIf as (
      values: RuleValues,
    ) => boolean;

    expect(showIf({ whenToPage: OnCallRuleWhenToPage.AfterOneUptimeAI })).toBe(
      true,
    );
    expect(showIf({ whenToPage: OnCallRuleWhenToPage.RightAway })).toBe(false);
    expect(showIf({ whenToPage: OnCallRuleWhenToPage.WorkingHours })).toBe(
      false,
    );
  });

  test("whole minutes from 1 to 30, or none, can be saved", () => {
    for (const minutes of [undefined, null, "", 1, 10, 30, "15"]) {
      expect(
        getAiHoldTimeProblem({
          whenToPage: OnCallRuleWhenToPage.AfterOneUptimeAI,
          aiHoldTimeInMinutes: minutes,
        }),
      ).toBeNull();
    }
  });

  test("anything else says what to type", () => {
    for (const minutes of [0, 31, 2.5, "abc", -3]) {
      expect(
        getAiHoldTimeProblem({
          whenToPage: OnCallRuleWhenToPage.AfterOneUptimeAI,
          aiHoldTimeInMinutes: minutes,
        }),
      ).toBe(AI_HOLD_TIME_PROBLEM);
    }
  });

  test("a rule that does not let AI respond first is never held to it", () => {
    expect(
      getAiHoldTimeProblem({
        whenToPage: OnCallRuleWhenToPage.RightAway,
        aiHoldTimeInMinutes: 500,
      }),
    ).toBeNull();
  });

  test("the folded line says the minutes AI may hold the page, the default when none", () => {
    expect(
      getAiHoldTimeFoldedValue({
        whenToPage: OnCallRuleWhenToPage.AfterOneUptimeAI,
        aiHoldTimeInMinutes: 5,
      }),
    ).toBe("5 minutes");
    expect(
      getAiHoldTimeFoldedValue({
        whenToPage: OnCallRuleWhenToPage.AfterOneUptimeAI,
        aiHoldTimeInMinutes: 1,
      }),
    ).toBe("1 minute");
    expect(
      getAiHoldTimeFoldedValue({
        whenToPage: OnCallRuleWhenToPage.AfterOneUptimeAI,
      }),
    ).toBe("10 minutes");
    expect(
      getAiHoldTimeFoldedValue({ whenToPage: OnCallRuleWhenToPage.RightAway }),
    ).toBeNull();
  });
});

describe("picking the choice", () => {
  test("fills in the default hold time on a rule with none", () => {
    const setValues: Mock<(values: RuleValues) => void> =
      jest.fn<(values: RuleValues) => void>();

    fillInWhenToPage(
      OnCallRuleWhenToPage.AfterOneUptimeAI,
      { whenToPage: OnCallRuleWhenToPage.AfterOneUptimeAI },
      setValues,
    );

    expect(setValues).toHaveBeenCalledWith({
      whenToPage: OnCallRuleWhenToPage.AfterOneUptimeAI,
      aiHoldTimeInMinutes: 10,
    });
  });

  test("keeps a hold time the rule already has", () => {
    const setValues: Mock<(values: RuleValues) => void> =
      jest.fn<(values: RuleValues) => void>();

    fillInWhenToPage(
      OnCallRuleWhenToPage.AfterOneUptimeAI,
      {
        whenToPage: OnCallRuleWhenToPage.AfterOneUptimeAI,
        aiHoldTimeInMinutes: 25,
      },
      setValues,
    );

    expect(setValues).not.toHaveBeenCalled();
  });

  test("right away changes nothing", () => {
    const setValues: Mock<(values: RuleValues) => void> =
      jest.fn<(values: RuleValues) => void>();

    fillInWhenToPage(
      OnCallRuleWhenToPage.RightAway,
      { whenToPage: OnCallRuleWhenToPage.RightAway },
      setValues,
    );

    expect(setValues).not.toHaveBeenCalled();
  });

  test("tells the rule it is an AI rule", () => {
    expect(
      isAiFirstResponderRule({
        whenToPage: OnCallRuleWhenToPage.AfterOneUptimeAI,
      }),
    ).toBe(true);
    expect(isAiFirstResponderRule({})).toBe(false);
  });
});

describe("under the choice", () => {
  test("what OneUptime AI does and needs, for the rule's records; the hours otherwise", () => {
    for (const record of [OnCallRuleRecord.Alert, OnCallRuleRecord.Incident]) {
      const whenToPage: Field<Record<string, unknown>> =
        getOnCallRuleActionFields<Record<string, unknown>>(record).find(
          (candidate: Field<Record<string, unknown>>): boolean => {
            return Boolean(
              (candidate.field as Record<string, unknown> | undefined)?.[
                "whenToPage"
              ],
            );
          },
        )!;

      const aiValues: RuleValues = {
        whenToPage: OnCallRuleWhenToPage.AfterOneUptimeAI,
        aiHoldTimeInMinutes: 5,
      };
      const aiFooter: { type: unknown; props: Record<string, unknown> } =
        whenToPage.getFooterElement!(aiValues) as unknown as {
          type: unknown;
          props: Record<string, unknown>;
        };

      expect(aiFooter.type).toBe(AiFirstResponderSummary);
      expect(aiFooter.props["record"]).toBe(record);
      expect(aiFooter.props["rule"]).toEqual(aiValues);

      const hoursFooter: { type: unknown } = whenToPage.getFooterElement!({
        whenToPage: OnCallRuleWhenToPage.WorkingHours,
      }) as unknown as { type: unknown };

      expect(hoursFooter.type).toBe(WorkingHoursSummary);
    }
  });
});
