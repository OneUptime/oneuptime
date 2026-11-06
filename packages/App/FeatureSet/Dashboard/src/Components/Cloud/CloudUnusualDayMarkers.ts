import Route from "Common/Types/API/Route";
import { fromCloudCostDay } from "Common/Types/Cloud/CloudCost";
import ChartEventKind from "Common/UI/Components/Charts/Types/ChartEventKind";
import ChartTimeReferenceLineProps from "Common/UI/Components/Charts/Types/TimeReferenceLineProps";
import Navigation from "Common/UI/Utils/Navigation";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import { formatCloudMoney } from "./CloudCostWords";
import { toReaderDay } from "./CloudDailySpendChart";
import {
  CloudUnusualDayRow,
  UNUSUAL_DAY_WHOLE_ACCOUNT,
  getCloudUnusualDayComparison,
} from "./CloudUnusualDaysCard";

/*
 * THE UNUSUAL DAYS, MARKED ON THE DAILY SPEND.
 *
 * Costs lists the days of the last two weeks that cost far more than usual
 * (CloudUnusualDaysCard); the chart above it marks the same days, where
 * their bars are, so a spike is seen where it happened. Each unusual line
 * of a day - the whole account's, a service's - is one mark on the chart's
 * annotation rail, as a deploy or an alert is on the other charts: the
 * marks of one day are one chip, and its card names what ran high, what it
 * cost and how far above its usual, with the account's name on a page over
 * every account. There a mark opens the account's own Costs.
 *
 * React-free: the marks are data the chart draws.
 */

// What ran high and what it cost: "Amazon Athena: $52.10".
export const UNUSUAL_DAY_MARKER_LABEL: string =
  translationKey("{{what}}: {{amount}}");

// Under it, on a page over every account: "data-lake · 2.5 times its usual $21.00".
export const UNUSUAL_DAY_MARKER_SUBTITLE: string = translationKey(
  "{{account}} · {{comparison}}",
);

/*
 * Amber, as the charts mark an alert: an unusual day is one to look at,
 * not yet a problem.
 */
export const UNUSUAL_DAY_MARKER_KIND: ChartEventKind = ChartEventKind.Alert;

function accountNameOf(row: CloudUnusualDayRow): string {
  return row.account.name || row.account.accountId;
}

/*
 * The marks of a set of unusual days, in the order the card lists them:
 * the newest day first, each day's account line before its services'.
 * Every mark sits at noon of its UTC day on the reader's clock, as that
 * day's bar does (toReaderDay), so it lands on the bar it is about in any
 * time zone.
 */
export function getCloudUnusualDayMarkers(data: {
  rows: Array<CloudUnusualDayRow>;
  currency: string;
  translator: Translator;
  // Over every account: each mark names its account and opens its Costs.
  showAccounts: boolean;
}): Array<ChartTimeReferenceLineProps> {
  return data.rows.map(
    (row: CloudUnusualDayRow): ChartTimeReferenceLineProps => {
      const what: string = row.anomaly.service
        ? row.anomaly.service
        : data.translator.translateText(UNUSUAL_DAY_WHOLE_ACCOUNT) ||
          UNUSUAL_DAY_WHOLE_ACCOUNT;
      const comparison: string = getCloudUnusualDayComparison({
        anomaly: row.anomaly,
        currency: data.currency,
        translator: data.translator,
      });
      const accountCosts: Route = RouteUtil.populateRouteParams(
        RouteMap[PageMap.CLOUD_ACCOUNT_VIEW_COSTS] as Route,
        { modelId: row.account.id },
      );

      return {
        date: toReaderDay(fromCloudCostDay(row.anomaly.day)),
        label: data.translator.translateTemplate(UNUSUAL_DAY_MARKER_LABEL, {
          what,
          amount: formatCloudMoney({
            amount: row.anomaly.amount,
            currency: data.currency,
            translator: data.translator,
          }),
        }),
        subtitle: data.showAccounts
          ? data.translator.translateTemplate(UNUSUAL_DAY_MARKER_SUBTITLE, {
              account: accountNameOf(row),
              comparison,
            })
          : comparison,
        kind: UNUSUAL_DAY_MARKER_KIND,
        onClick: data.showAccounts
          ? (): void => {
              Navigation.navigate(accountCosts);
            }
          : undefined,
      };
    },
  );
}

// The days marked, once each, newest first: "2026-11-05,2026-11-02".
export function getCloudUnusualDaysMarked(
  rows: Array<CloudUnusualDayRow>,
): Array<string> {
  return Array.from(
    new Set<string>(
      rows.map((row: CloudUnusualDayRow): string => {
        return row.anomaly.day;
      }),
    ),
  ).sort((a: string, b: string): number => {
    return b.localeCompare(a);
  });
}
