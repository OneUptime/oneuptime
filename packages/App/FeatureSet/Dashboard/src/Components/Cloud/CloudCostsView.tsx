import Route from "Common/Types/API/Route";
import { addUtcDays, startOfUtcDay } from "Common/Types/Cloud/CloudCost";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import ChartTimeReferenceLineProps from "Common/UI/Components/Charts/Types/TimeReferenceLineProps";
import API from "Common/UI/Utils/API/API";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import CloudCostBreakdownCard from "./CloudCostBreakdownCard";
import {
  CloudCostPoint,
  CloudCostScope,
  fetchCloudCostTrend,
} from "./CloudCostReads";
import CloudCostGapsCard, {
  CloudCostGapRow,
  getCloudCostGapRows,
} from "./CloudCostGapsCard";
import CloudCostSetupSteps, {
  getCloudProvidersOf,
} from "./CloudCostSetupSteps";
import { hasCloudCosts } from "./CloudCostWords";
import CloudDailySpendChart from "./CloudDailySpendChart";
import { getCloudCostTiles } from "./CloudOverviewTiles";
import CloudStatStrip from "./CloudStatStrip";
import CloudUnusualDaysCard, {
  CloudUnusualDayRow,
  getCloudUnusualDayRows,
} from "./CloudUnusualDaysCard";
import {
  getCloudUnusualDayMarkers,
  getCloudUnusualDaysMarked,
} from "./CloudUnusualDayMarkers";
import {
  CloudAccountRow,
  CloudAccountsTotals,
  totalCloudAccounts,
} from "./UseCloudAccounts";

/*
 * WHAT THE CLOUD COSTS: Cloud > Costs over every account, and an account's
 * own Costs tab over it alone.
 *
 *   - The strip: the month so far against last month by now, what it is on
 *     course for, last month in full and what could be saved.
 *   - Daily spend: each of the last 30 days, a bar each, the unusual days
 *     marked above their bars.
 *   - Unusual days: the days of the last two weeks that cost far more than
 *     usual, as budgets alert on them - when there are any.
 *   - Where the money goes: what cost the most in a period - by service,
 *     Region, account or resource, by App Platforms environment or app, or
 *     by tag (CloudCostBreakdownCard).
 *   - The accounts whose costs are not read, with why and what to do - so
 *     an account left out is never read as one that costs nothing.
 *
 * Before any account's costs are read, it says what each cloud needs.
 */

export const DAILY_SPEND_TITLE: string = translationKey("Daily spend");
export const DAILY_SPEND_DESCRIPTION: string = translationKey(
  "Each of the last 30 days. A cloud reports the last day or two late, and in part.",
);
/*
 * Where the money goes is its own card (CloudCostBreakdownCard): its words
 * are said from here too, as the pages' tests and the docs read them.
 */
export {
  BREAKDOWN_DESCRIPTION,
  BREAKDOWN_DESCRIPTION_ONE_ACCOUNT,
  BREAKDOWN_EMPTY,
  BREAKDOWN_RESOURCES_NOTE,
  BREAKDOWN_SHOWN,
  BREAKDOWN_TITLE,
  BREAKDOWN_TOTAL,
  SHOW_ALL_SHARES,
  SHOW_FEWER_SHARES,
} from "./CloudCostBreakdownCard";

export const NOT_READ_TITLE: string = translationKey("Costs are not read yet");
export const NOT_READ_DESCRIPTION: string = translationKey(
  "Costs come from each cloud's own billing, once a connection may read it.",
);
const CloudDailySpendCard: FunctionComponent<{
  scope: Omit<CloudCostScope, "startDate" | "endDate">;
  // The unusual days, marked above their bars.
  unusualDays: Array<CloudUnusualDayRow>;
  // Over every account: each mark names its account.
  showAccounts: boolean;
}> = (props: {
  scope: Omit<CloudCostScope, "startDate" | "endDate">;
  unusualDays: Array<CloudUnusualDayRow>;
  showAccounts: boolean;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const [points, setPoints] = useState<Array<CloudCostPoint> | null>(null);
  const [error, setError] = useState<string>("");
  const [attempt, setAttempt] = useState<number>(0);
  const scopeKey: string = JSON.stringify(props.scope);

  useEffect(() => {
    let ignore: boolean = false;
    const now: Date = OneUptimeDate.getCurrentDate();

    setError("");

    fetchCloudCostTrend({
      ...props.scope,
      startDate: addUtcDays(startOfUtcDay(now), -29),
      endDate: now,
    })
      .then((found: Array<CloudCostPoint>): void => {
        if (!ignore) {
          setPoints(found);
        }
      })
      .catch((err: Error): void => {
        if (!ignore) {
          setError(API.getFriendlyMessage(err));
        }
      });

    return (): void => {
      ignore = true;
    };
  }, [scopeKey, attempt]);

  const markers: Array<ChartTimeReferenceLineProps> = useMemo(():
    | Array<ChartTimeReferenceLineProps>
    | never => {
    return getCloudUnusualDayMarkers({
      rows: props.unusualDays,
      currency: props.scope.currency,
      translator,
      showAccounts: props.showAccounts,
    });
  }, [props.unusualDays, props.scope.currency, props.showAccounts, translator]);

  return (
    <Card title={DAILY_SPEND_TITLE} description={DAILY_SPEND_DESCRIPTION}>
      <div
        data-testid="cloud-daily-spend"
        data-unusual-days={getCloudUnusualDaysMarked(props.unusualDays).join(
          ",",
        )}
      >
        {error ? (
          <ErrorMessage
            message={error}
            onRefreshClick={() => {
              setAttempt(attempt + 1);
            }}
          />
        ) : points === null ? (
          <div
            className="h-60 w-full animate-pulse rounded-md bg-gray-50"
            data-testid="cloud-daily-spend-loading"
          />
        ) : (
          <CloudDailySpendChart
            points={points}
            currency={props.scope.currency}
            markers={markers}
          />
        )}
      </div>
    </Card>
  );
};

export interface ComponentProps {
  projectId: ObjectID;
  // The accounts the view is over: every account, or the one.
  accounts: Array<CloudAccountRow>;
  // One account's costs (its Costs tab); every account's when absent.
  cloudAccountId?: ObjectID | undefined;
  savingsRoute?: Route | undefined;
}

const CloudCostsView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const totals: CloudAccountsTotals = useMemo((): CloudAccountsTotals => {
    return totalCloudAccounts(props.accounts);
  }, [props.accounts]);
  const currency: string = totals.costs.currency;
  const gaps: Array<CloudCostGapRow> = getCloudCostGapRows({
    accounts: props.accounts,
    currency,
    kind: "costs",
  });

  if (!hasCloudCosts(totals.costs)) {
    return (
      <Fragment>
        <Card title={NOT_READ_TITLE} description={NOT_READ_DESCRIPTION}>
          <div data-testid="cloud-costs-not-read">
            <CloudCostSetupSteps
              kind="costs"
              providers={getCloudProvidersOf(props.accounts)}
            />
          </div>
        </Card>
        <CloudCostGapsCard
          rows={gaps}
          kind="costs"
          currency={currency}
          isNothingRead={true}
        />
      </Fragment>
    );
  }

  const scope: Omit<CloudCostScope, "startDate" | "endDate"> = {
    projectId: props.projectId,
    cloudAccountIds: props.cloudAccountId ? [props.cloudAccountId] : undefined,
    currency,
  };
  // The same days the chart marks and the card under it lists.
  const unusualDays: Array<CloudUnusualDayRow> = getCloudUnusualDayRows({
    accounts: props.accounts,
    currency,
  });

  return (
    <Fragment>
      <CloudStatStrip
        testId="cloud-costs-strip"
        tiles={getCloudCostTiles({
          costs: totals.costs,
          savings: totals.savings,
          translator,
          savingsRoute: props.savingsRoute,
        })}
      />
      <CloudDailySpendCard
        scope={scope}
        unusualDays={unusualDays}
        showAccounts={!props.cloudAccountId}
      />
      <CloudUnusualDaysCard
        rows={unusualDays}
        currency={currency}
        showAccounts={!props.cloudAccountId}
      />
      <CloudCostBreakdownCard
        scope={scope}
        accounts={props.accounts}
        isOneAccount={Boolean(props.cloudAccountId)}
      />
      <CloudCostGapsCard rows={gaps} kind="costs" currency={currency} />
    </Fragment>
  );
};

export default CloudCostsView;
