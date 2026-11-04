import Route from "Common/Types/API/Route";
import {
  CloudCostAnomaly,
  CloudCostState,
  fromCloudCostDay,
} from "Common/Types/Cloud/CloudCost";
import {
  getCloudCostAnomalyIncrease,
  getCloudCostAnomalyRatio,
} from "Common/Types/Cloud/CloudCostAnomaly";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import Card from "Common/UI/Components/Card/Card";
import Icon from "Common/UI/Components/Icon/Icon";
import {
  PluralTemplate,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import AppLink from "../AppLink/AppLink";
import { formatCloudMoney } from "./CloudCostWords";
import { toReaderDay } from "./CloudDailySpendChart";
import { CloudAccountRow } from "./UseCloudAccounts";

/*
 * UNUSUAL DAYS: the days of the last two weeks that cost far more than
 * usual - a service at twice its usual day, or a whole account at one and
 * a half times (CloudCostAnomaly) - from each account's cost summary, as
 * its budgets alert on them. Under the daily spend on Costs, whose bars
 * show the same days; not drawn when there is none.
 */

export const UNUSUAL_DAYS_TITLE: string = translationKey("Unusual days");
export const UNUSUAL_DAYS_DESCRIPTION: string = translationKey(
  "Days of the last two weeks that cost far more than usual: a service at twice its usual day, or a whole account at one and a half times. A budget that counts the account alerts on each.",
);
export const UNUSUAL_DAY_WHOLE_ACCOUNT: string =
  translationKey("The whole account");
export const UNUSUAL_DAY_TIMES_USUAL: string = translationKey(
  "{{times}} times its usual {{usual}}",
);
export const UNUSUAL_DAY_USUALLY_NOTHING: string = translationKey(
  "Usually costs nothing",
);
export const UNUSUAL_DAYS_SHOWN: number = 6;
export const SHOW_MORE_UNUSUAL_DAYS: PluralTemplate = {
  one: "Show {{count}} more",
  other: "Show {{count}} more",
};
export const SHOW_FEWER_UNUSUAL_DAYS: string = translationKey("Show less");

export interface CloudUnusualDayRow {
  account: CloudAccountRow;
  anomaly: CloudCostAnomaly;
}

function nameOf(account: CloudAccountRow): string {
  return account.name || account.accountId;
}

/*
 * Every unusual day of the accounts read in the page's currency: the
 * newest day first, then by account, each account's own line before its
 * services', the furthest above usual first.
 */
export function getCloudUnusualDayRows(data: {
  accounts: Array<CloudAccountRow>;
  currency: string;
}): Array<CloudUnusualDayRow> {
  const rows: Array<CloudUnusualDayRow> = [];

  for (const account of data.accounts) {
    const summary: CloudAccountRow["costSummary"] = account.costSummary;

    if (
      !summary ||
      summary.state !== CloudCostState.Reading ||
      summary.currency.toUpperCase() !== data.currency.toUpperCase()
    ) {
      continue;
    }

    for (const anomaly of summary.anomalies || []) {
      rows.push({ account, anomaly });
    }
  }

  return rows.sort((a: CloudUnusualDayRow, b: CloudUnusualDayRow): number => {
    return (
      b.anomaly.day.localeCompare(a.anomaly.day) ||
      nameOf(a.account).localeCompare(nameOf(b.account)) ||
      a.account.id.toString().localeCompare(b.account.id.toString()) ||
      Number(a.anomaly.service !== "") - Number(b.anomaly.service !== "") ||
      getCloudCostAnomalyIncrease(b.anomaly) -
        getCloudCostAnomalyIncrease(a.anomaly) ||
      a.anomaly.service.localeCompare(b.anomaly.service)
    );
  });
}

// "2.3 times its usual $180.00", or that it usually costs nothing.
export function getCloudUnusualDayComparison(data: {
  anomaly: CloudCostAnomaly;
  currency: string;
  translator: Translator;
}): string {
  if (data.anomaly.usual <= 0) {
    return (
      data.translator.translateText(UNUSUAL_DAY_USUALLY_NOTHING) ||
      UNUSUAL_DAY_USUALLY_NOTHING
    );
  }

  return data.translator.translateTemplate(UNUSUAL_DAY_TIMES_USUAL, {
    times: data.translator.formatNumber(
      Math.round(getCloudCostAnomalyRatio(data.anomaly) * 10) / 10,
    ),
    usual: formatCloudMoney({
      amount: data.anomaly.usual,
      currency: data.currency,
      translator: data.translator,
    }),
  });
}

export interface ComponentProps {
  rows: Array<CloudUnusualDayRow>;
  currency: string;
  // Over every account: each row names its account.
  showAccounts: boolean;
}

const CloudUnusualDaysCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [showAll, setShowAll] = useState<boolean>(false);

  if (props.rows.length === 0) {
    return <></>;
  }

  const hidden: number = props.rows.length - UNUSUAL_DAYS_SHOWN;
  const shown: Array<CloudUnusualDayRow> =
    showAll || hidden <= 0
      ? props.rows
      : props.rows.slice(0, UNUSUAL_DAYS_SHOWN);

  return (
    <Card title={UNUSUAL_DAYS_TITLE} description={UNUSUAL_DAYS_DESCRIPTION}>
      <div data-testid="cloud-unusual-days">
        <ul className="-mt-3 divide-y divide-gray-100">
          {shown.map((row: CloudUnusualDayRow): ReactElement => {
            return (
              <li
                key={`${row.account.id.toString()}-${row.anomaly.day}-${row.anomaly.service}`}
                className="flex items-start gap-3 py-3"
                data-testid="cloud-unusual-day"
                data-day={row.anomaly.day}
              >
                <div
                  className="w-16 shrink-0 whitespace-nowrap pt-0.5 text-xs font-medium text-gray-500"
                  data-testid="cloud-unusual-day-date"
                >
                  {OneUptimeDate.getDateAsLocalDayMonthString(
                    toReaderDay(fromCloudCostDay(row.anomaly.day)),
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div
                    className="break-words text-sm font-medium text-gray-900"
                    data-testid="cloud-unusual-day-what"
                  >
                    {row.anomaly.service ? (
                      // A service's name as its cloud writes it.
                      <bdi>{row.anomaly.service}</bdi>
                    ) : (
                      translator.translateText(UNUSUAL_DAY_WHOLE_ACCOUNT)
                    )}
                  </div>
                  <div
                    className="mt-0.5 text-xs text-gray-600"
                    data-testid="cloud-unusual-day-usual"
                  >
                    {getCloudUnusualDayComparison({
                      anomaly: row.anomaly,
                      currency: props.currency,
                      translator,
                    })}
                  </div>
                  {props.showAccounts ? (
                    <AppLink
                      to={RouteUtil.populateRouteParams(
                        RouteMap[PageMap.CLOUD_ACCOUNT_VIEW_COSTS] as Route,
                        { modelId: row.account.id },
                      )}
                      className="mt-0.5 inline-block max-w-full break-words text-xs text-gray-500 hover:underline"
                      dataTestId="cloud-unusual-day-account"
                    >
                      <bdi>{nameOf(row.account)}</bdi>
                    </AppLink>
                  ) : (
                    <></>
                  )}
                </div>
                <div
                  className="shrink-0 whitespace-nowrap text-end text-sm font-semibold text-gray-900"
                  data-testid="cloud-unusual-day-amount"
                >
                  {formatCloudMoney({
                    amount: row.anomaly.amount,
                    currency: props.currency,
                    translator,
                  })}
                </div>
              </li>
            );
          })}
        </ul>
        {hidden > 0 ? (
          <button
            type="button"
            aria-expanded={showAll}
            data-testid="cloud-unusual-days-toggle"
            className="-ms-2 mt-1 inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-indigo-600 transition-colors hover:bg-indigo-50 hover:text-indigo-700"
            onClick={() => {
              setShowAll(!showAll);
            }}
          >
            <Icon
              icon={showAll ? IconProp.ChevronUp : IconProp.ChevronDown}
              className="h-3 w-3"
            />
            <span>
              {showAll
                ? translator.translateText(SHOW_FEWER_UNUSUAL_DAYS)
                : translator.translatePlural(SHOW_MORE_UNUSUAL_DAYS, hidden)}
            </span>
          </button>
        ) : (
          <></>
        )}
      </div>
    </Card>
  );
};

export default CloudUnusualDaysCard;
