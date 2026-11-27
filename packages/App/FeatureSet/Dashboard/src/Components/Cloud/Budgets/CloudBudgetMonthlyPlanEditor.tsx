import {
  PLAN_MONTH_AMOUNT,
  PLAN_TOTAL,
  formatCalendarMonthName,
  getFiscalMonthNumbers,
} from "./CloudBudgetWords";
import { formatCloudMoney } from "../CloudCostWords";
import { sumCloudBudgetPlan } from "Common/Types/Cloud/CloudBudget";
import Input, { InputType } from "Common/UI/Components/Input/Input";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A YEARLY BUDGET'S TWELVE MONTHS, each with what it may cost (#11008): in
 * the fiscal year's order, from its first month, so a year from April
 * starts with April. Their total is the budget's amount, shown under them.
 * A month left empty may cost nothing.
 */

export interface ComponentProps {
  // The twelve amounts, from the fiscal year's first month on.
  value: Array<number | string> | null | undefined;
  onChange: (plan: Array<number>) => void;
  fiscalYearStartMonth: unknown;
  currency: string;
  // The form asked for it: draw the boxes refused.
  hasError?: boolean | undefined;
}

// A plan's twelve amounts as numbers: anything that is not one is nothing.
export function toCloudBudgetPlanAmounts(
  value: Array<number | string> | null | undefined,
): Array<number> {
  const plan: Array<number> = [];

  for (let index: number = 0; index < 12; index++) {
    const entry: unknown = value ? value[index] : undefined;
    const amount: number =
      typeof entry === "number"
        ? entry
        : typeof entry === "string" && entry.trim() !== ""
          ? Number(entry.trim())
          : 0;

    plan.push(Number.isFinite(amount) && amount > 0 ? amount : 0);
  }

  return plan;
}

const CloudBudgetMonthlyPlanEditor: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const months: Array<number> = getFiscalMonthNumbers(
    props.fiscalYearStartMonth,
  );
  const plan: Array<number> = toCloudBudgetPlanAmounts(props.value);

  return (
    <div data-testid="cloud-budget-monthly-plan">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {months.map((monthNumber: number, index: number): ReactElement => {
          const name: string = formatCalendarMonthName(monthNumber, translator);
          const inputId: string = `cloud-budget-plan-month-${index}`;

          return (
            <div key={monthNumber}>
              <label
                htmlFor={inputId}
                className="block text-xs font-medium text-gray-600"
              >
                {name}
              </label>
              <div className="mt-1">
                <Input
                  id={inputId}
                  type={InputType.NUMBER}
                  value={plan[index] ? String(plan[index]) : ""}
                  placeholder="0"
                  ariaLabel={translator.translateTemplate(PLAN_MONTH_AMOUNT, {
                    month: name,
                  })}
                  ariaInvalid={Boolean(props.hasError)}
                  dataTestId={`cloud-budget-plan-month-${index}`}
                  onChange={(text: string) => {
                    const next: Array<number> = [...plan];
                    const amount: number =
                      text.trim() === "" ? 0 : Number(text.trim());
                    next[index] =
                      Number.isFinite(amount) && amount > 0 ? amount : 0;
                    props.onChange(next);
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <p
        className="mt-3 text-sm font-medium text-gray-700"
        data-testid="cloud-budget-plan-total"
      >
        {translator.translateTemplate(PLAN_TOTAL, {
          amount: formatCloudMoney({
            amount: sumCloudBudgetPlan(plan),
            currency: props.currency,
            translator,
            wholeWhenRound: true,
          }),
        })}
      </p>
    </div>
  );
};

export default CloudBudgetMonthlyPlanEditor;
