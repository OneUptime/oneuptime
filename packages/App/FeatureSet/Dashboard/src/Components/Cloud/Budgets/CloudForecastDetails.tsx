import {
  LIKELY_RANGE,
  MADE_FROM_MONTHS,
  MONTH_COLUMN,
  NO_RANGE,
  RANGE_OF,
  formatCloudMonth,
} from "./CloudBudgetWords";
import { formatCloudMoney } from "../CloudCostWords";
import {
  CLOUD_COST_FORECAST_METHOD_DESCRIPTIONS,
  CLOUD_COST_FORECAST_METHOD_LABELS,
  CLOUD_COST_FORECAST_RANGE_DESCRIPTION,
  CloudCostForecast,
  CloudCostForecastMethod,
  CloudCostForecastMonth,
  CloudCostForecastMonthKind,
} from "Common/Types/Cloud/CloudCostForecast";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * HOW A FORECAST WAS MADE, AND ITS MONTHS AHEAD (#11008).
 *
 * The method, in the words that say what it is and what it is not sure
 * of: the last week's pace for a scope with fewer than 3 full months, the
 * trend from 3, the trend and each month's season from 12 - and the likely
 * range, which holds about 8 months in 10. Then this month on course and
 * each month ahead, with its range where the method claims one.
 */

export const FORECAST_MONTH_LIST_LABEL: string = translationKey(
  "The forecast, month by month",
);
export const FORECAST_ON_COURSE_ROW: string = translationKey(
  "{{spent}} so far, on course for {{amount}}",
);
export const FORECAST_ON_COURSE_ROW_TITLE: string = translationKey("Forecast");

// How a forecast was made, in a sentence of the reader's language.
export function getCloudForecastMethodSentence(
  forecast: CloudCostForecast,
  translator: Translator,
): string {
  return translator.translateTemplate(
    CLOUD_COST_FORECAST_METHOD_DESCRIPTIONS[forecast.method],
    { months: translator.formatNumber(forecast.monthsOfHistory) },
  );
}

export const CloudForecastHowMade: FunctionComponent<{
  forecast: CloudCostForecast;
}> = (props: { forecast: CloudCostForecast }): ReactElement => {
  const translator: Translator = useTranslator();
  const forecast: CloudCostForecast = props.forecast;

  return (
    <div
      className="space-y-2 text-sm text-gray-600"
      data-testid="cloud-forecast-how-made"
      data-method={forecast.method}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Pill
          text={CLOUD_COST_FORECAST_METHOD_LABELS[forecast.method]}
          tone={PillTone.Info}
          isDotHidden={true}
        />
        {forecast.monthsOfHistory > 0 ? (
          <span className="text-xs text-gray-500">
            {translator.translatePlural(
              MADE_FROM_MONTHS,
              forecast.monthsOfHistory,
            )}
          </span>
        ) : (
          <></>
        )}
      </div>
      <p>{getCloudForecastMethodSentence(forecast, translator)}</p>
      {forecast.method !== CloudCostForecastMethod.Pace ? (
        <p>{translator.translateText(CLOUD_COST_FORECAST_RANGE_DESCRIPTION)}</p>
      ) : (
        <></>
      )}
    </div>
  );
};

export interface MonthsProps {
  forecast: CloudCostForecast;
  currency: string;
}

export const CloudForecastMonths: FunctionComponent<MonthsProps> = (
  props: MonthsProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const money: (amount: number) => string = (amount: number): string => {
    return formatCloudMoney({
      amount,
      currency: props.currency,
      translator,
      whole: true,
    });
  };
  const rows: Array<CloudCostForecastMonth> = props.forecast.months.filter(
    (month: CloudCostForecastMonth): boolean => {
      return month.kind !== CloudCostForecastMonthKind.Actual;
    },
  );

  return (
    <div data-testid="cloud-forecast-months">
      <div className="max-sm:hidden grid-cols-3 gap-4 border-b border-gray-200 pb-2 text-xs font-medium uppercase text-gray-500 sm:grid">
        <span>{translator.translateText(MONTH_COLUMN)}</span>
        <span>{translator.translateText(FORECAST_ON_COURSE_ROW_TITLE)}</span>
        <span>{translator.translateText(LIKELY_RANGE)}</span>
      </div>
      <ul
        className="divide-y divide-gray-100"
        aria-label={translator.translateText(FORECAST_MONTH_LIST_LABEL)}
      >
        {rows.map((month: CloudCostForecastMonth): ReactElement => {
          const isCurrent: boolean =
            month.kind === CloudCostForecastMonthKind.Current;

          return (
            <li
              key={month.month}
              className="grid grid-cols-1 gap-1 py-2 text-sm sm:grid-cols-3 sm:gap-4"
              data-testid="cloud-forecast-month"
              data-month={month.month}
              data-kind={month.kind}
            >
              <span className="font-medium text-gray-900">
                {formatCloudMonth(month.month, translator)}
              </span>
              <span className="text-gray-900">
                {isCurrent
                  ? translator.translateTemplate(FORECAST_ON_COURSE_ROW, {
                      spent: money(month.spent || 0),
                      amount: money(month.amount),
                    })
                  : money(month.amount)}
              </span>
              <span className="text-gray-600">
                {month.low !== undefined && month.high !== undefined
                  ? translator.translateTemplate(RANGE_OF, {
                      low: money(month.low),
                      high: money(month.high),
                    })
                  : isCurrent
                    ? ""
                    : translator.translateText(NO_RANGE)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
};
