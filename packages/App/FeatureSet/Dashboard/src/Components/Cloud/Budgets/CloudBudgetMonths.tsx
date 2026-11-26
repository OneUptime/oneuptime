import {
  MONTH_FORECAST,
  MONTH_ON_COURSE_FOR,
  MONTH_ON_COURSE_OVER,
  MONTH_OVER_SHARE,
  MONTH_UNDER_SHARE,
  OF_AMOUNT,
  RANGE_OF,
  formatCloudMonth,
} from "./CloudBudgetWords";
import { formatCloudMoney } from "../CloudCostWords";
import { CloudBudgetPageMonth } from "Common/Types/Cloud/CloudBudgetReads";
import { CloudCostForecastMonthKind } from "Common/Types/Cloud/CloudCostForecast";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A BUDGET'S PERIOD, MONTH BY MONTH (#11008): each month of it with what
 * it cost, what it is on course to cost (this month) or is forecast to
 * cost (a month ahead), and - a yearly budget split by month - its share
 * and how far over or under it the month is. A bar for each: the month
 * against its share, or against the costliest month of a period that is
 * not split. Its total against the period's amount ends the list.
 */

export const PERIOD_TOTAL_ROW: string = translationKey("Period so far");
export const MONTHS_LIST_LABEL: string = translationKey(
  "The budget's period, month by month",
);

export type CloudBudgetMonthState = "over" | "under" | "heading-over" | "none";

// How a month stands against its share: over, under, heading over, or no share.
export function getCloudBudgetMonthState(
  month: CloudBudgetPageMonth,
): CloudBudgetMonthState {
  if (month.planned === undefined) {
    return "none";
  }

  if (month.kind === CloudCostForecastMonthKind.Actual) {
    return month.amount > month.planned ? "over" : "under";
  }

  return month.amount > month.planned ? "heading-over" : "none";
}

const BAR_CLASS_NAMES: Readonly<Record<CloudBudgetMonthState, string>> = {
  over: "bg-red-500",
  under: "bg-emerald-500",
  "heading-over": "bg-amber-500",
  none: "bg-indigo-500",
};

export interface ComponentProps {
  months: Array<CloudBudgetPageMonth>;
  currency: string;
  // The period's amount and what it cost so far: the list's last row.
  amount: number;
  spentThisPeriod: number;
}

const CloudBudgetMonths: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const money: (amount: number) => string = (amount: number): string => {
    return formatCloudMoney({
      amount,
      currency: props.currency,
      translator,
      wholeWhenRound: true,
    });
  };
  const largest: number = Math.max(
    1,
    ...props.months.map((month: CloudBudgetPageMonth): number => {
      return Math.max(month.amount, month.planned || 0);
    }),
  );

  return (
    <div data-testid="cloud-budget-months">
      <ul
        className="divide-y divide-gray-100"
        aria-label={translator.translateText(MONTHS_LIST_LABEL)}
      >
        {props.months.map((month: CloudBudgetPageMonth): ReactElement => {
          const state: CloudBudgetMonthState = getCloudBudgetMonthState(month);
          const of: number =
            month.planned !== undefined && month.planned > 0
              ? month.planned
              : largest;
          const width: number = Math.min(100, (month.amount / of) * 100);
          const isForecast: boolean =
            month.kind === CloudCostForecastMonthKind.Forecast;
          let figure: string = money(month.amount);

          if (month.kind === CloudCostForecastMonthKind.Current) {
            figure = translator.translateTemplate(MONTH_ON_COURSE_FOR, {
              spent: money(month.spent || 0),
              amount: money(month.amount),
            });
          } else if (isForecast) {
            figure = translator.translateTemplate(MONTH_FORECAST, {
              amount: money(month.amount),
            });
          }

          return (
            <li
              key={month.month}
              className="py-3"
              data-testid="cloud-budget-month-row"
              data-month={month.month}
              data-kind={month.kind}
              data-state={state}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span className="text-sm font-medium text-gray-900">
                  {formatCloudMonth(month.month, translator)}
                </span>
                <span className="text-sm text-gray-700">
                  {figure}
                  {month.planned !== undefined ? (
                    <span className="ms-1 text-gray-500">
                      {translator.translateTemplate(OF_AMOUNT, {
                        amount: money(month.planned),
                      })}
                    </span>
                  ) : (
                    <></>
                  )}
                </span>
              </div>
              <div
                className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-gray-100"
                role="presentation"
              >
                <div
                  className={`h-full rounded-full ${BAR_CLASS_NAMES[state]} ${isForecast ? "opacity-40" : ""}`}
                  style={{ width: `${Math.max(0, width)}%` }}
                />
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                {state === "over" ? (
                  <Pill
                    text={translator.translateTemplate(MONTH_OVER_SHARE, {
                      amount: money(month.amount - (month.planned || 0)),
                    })}
                    isUserContent={true}
                    tone={PillTone.Danger}
                  />
                ) : state === "under" ? (
                  <span>
                    {translator.translateTemplate(MONTH_UNDER_SHARE, {
                      amount: money((month.planned || 0) - month.amount),
                    })}
                  </span>
                ) : state === "heading-over" ? (
                  <Pill
                    text={translator.translateText(MONTH_ON_COURSE_OVER) || ""}
                    isUserContent={true}
                    tone={PillTone.Warning}
                  />
                ) : (
                  <></>
                )}
                {isForecast &&
                month.low !== undefined &&
                month.high !== undefined ? (
                  <span>
                    {translator.translateTemplate(RANGE_OF, {
                      low: money(month.low),
                      high: money(month.high),
                    })}
                  </span>
                ) : (
                  <></>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <div
        className="mt-1 flex flex-wrap items-baseline justify-between gap-x-4 border-t border-gray-200 pt-3 text-sm"
        data-testid="cloud-budget-months-total"
      >
        <span className="font-medium text-gray-900">
          {translator.translateText(PERIOD_TOTAL_ROW)}
        </span>
        <span className="text-gray-900">
          {money(props.spentThisPeriod)}
          <span className="ms-1 text-gray-500">
            {translator.translateTemplate(OF_AMOUNT, {
              amount: money(props.amount),
            })}
          </span>
        </span>
      </div>
    </div>
  );
};

export default CloudBudgetMonths;
