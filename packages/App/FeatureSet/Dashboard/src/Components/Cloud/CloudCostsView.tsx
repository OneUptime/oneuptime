import Route from "Common/Types/API/Route";
import { addUtcDays, startOfUtcDay } from "Common/Types/Cloud/CloudCost";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import FilterButtons from "Common/UI/Components/FilterButtons/FilterButtons";
import Icon from "Common/UI/Components/Icon/Icon";
import API from "Common/UI/Utils/API/API";
import {
  PluralTemplate,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import RankedBars, { RankedBarItem } from "../SecurityOverview/RankedBars";
import {
  CLOUD_COST_DIMENSION_OPTIONS,
  CLOUD_COST_PERIOD_OPTIONS,
  CloudCostPeriod,
  CloudCostShareLabel,
  getCloudCostPeriodWindow,
  getCloudCostShareLabel,
} from "./CloudCostBreakdown";
import {
  CloudCostDimension,
  CloudCostPoint,
  CloudCostScope,
  CloudCostShare,
  fetchCloudCostShares,
  fetchCloudCostTrend,
} from "./CloudCostReads";
import CloudCostGapsCard, {
  CloudCostGapRow,
  getCloudCostGapRows,
} from "./CloudCostGapsCard";
import CloudCostSetupSteps, {
  getCloudProvidersOf,
} from "./CloudCostSetupSteps";
import { formatCloudMoney, hasCloudCosts } from "./CloudCostWords";
import CloudDailySpendChart from "./CloudDailySpendChart";
import { getCloudCostTiles } from "./CloudOverviewTiles";
import CloudStatStrip from "./CloudStatStrip";
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
 *   - Daily spend: each of the last 30 days, a bar each.
 *   - Where the money goes: what cost the most in a period - by service,
 *     Region, account or resource.
 *   - The accounts whose costs are not read, with why and what to do - so
 *     an account left out is never read as one that costs nothing.
 *
 * Before any account's costs are read, it says what each cloud needs.
 */

export const DAILY_SPEND_TITLE: string = translationKey("Daily spend");
export const DAILY_SPEND_DESCRIPTION: string = translationKey(
  "Each of the last 30 days. A cloud reports the last day or two late, and in part.",
);
export const BREAKDOWN_TITLE: string = translationKey("Where the money goes");
export const BREAKDOWN_DESCRIPTION: string = translationKey(
  "What cost the most, by service, Region, account or resource.",
);
// On an account's own Costs, which has no Accounts choice.
export const BREAKDOWN_DESCRIPTION_ONE_ACCOUNT: string = translationKey(
  "What cost the most, by service, Region or resource.",
);
export const BREAKDOWN_EMPTY: string = translationKey(
  "Nothing cost anything in this period.",
);
export const BREAKDOWN_TOTAL: string = translationKey("{{amount}} in all");
export const BREAKDOWN_RESOURCES_NOTE: string = translationKey(
  "Azure and Google Cloud's detailed billing export name the resource each cost is for. AWS Cost Explorer says the service and Region only.",
);
export const BREAKDOWN_SHOWN: number = 10;
export const SHOW_ALL_SHARES: PluralTemplate = {
  one: "Show {{count}} more",
  other: "Show {{count}} more",
};
export const SHOW_FEWER_SHARES: string = translationKey("Show less");

export const NOT_READ_TITLE: string = translationKey("Costs are not read yet");
export const NOT_READ_DESCRIPTION: string = translationKey(
  "Costs come from each cloud's own billing, once a connection may read it.",
);
const CloudDailySpendCard: FunctionComponent<{
  scope: Omit<CloudCostScope, "startDate" | "endDate">;
}> = (props: {
  scope: Omit<CloudCostScope, "startDate" | "endDate">;
}): ReactElement => {
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

  return (
    <Card title={DAILY_SPEND_TITLE} description={DAILY_SPEND_DESCRIPTION}>
      <div data-testid="cloud-daily-spend">
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
          />
        )}
      </div>
    </Card>
  );
};

const CloudCostBreakdownCard: FunctionComponent<{
  scope: Omit<CloudCostScope, "startDate" | "endDate">;
  accounts: Array<CloudAccountRow>;
  // One account's: the breakdown by account is left out.
  isOneAccount: boolean;
}> = (props: {
  scope: Omit<CloudCostScope, "startDate" | "endDate">;
  accounts: Array<CloudAccountRow>;
  isOneAccount: boolean;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const [dimension, setDimension] = useState<CloudCostDimension>("service");
  const [period, setPeriod] = useState<CloudCostPeriod>(
    CloudCostPeriod.ThisMonth,
  );
  const [shares, setShares] = useState<Array<CloudCostShare> | null>(null);
  const [error, setError] = useState<string>("");
  const [attempt, setAttempt] = useState<number>(0);
  const [showAll, setShowAll] = useState<boolean>(false);
  const scopeKey: string = JSON.stringify(props.scope);

  const accountNames: Map<string, string> = useMemo((): Map<string, string> => {
    return new Map(
      props.accounts.map((account: CloudAccountRow): [string, string] => {
        return [account.id.toString(), account.name || account.accountId];
      }),
    );
  }, [props.accounts]);

  useEffect(() => {
    let ignore: boolean = false;
    const window: { start: Date; end: Date } = getCloudCostPeriodWindow(
      period,
      OneUptimeDate.getCurrentDate(),
    );

    setShares(null);
    setError("");
    setShowAll(false);

    fetchCloudCostShares({
      scope: { ...props.scope, startDate: window.start, endDate: window.end },
      dimension,
    })
      .then((found: Array<CloudCostShare>): void => {
        if (!ignore) {
          setShares(found);
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
  }, [scopeKey, dimension, period, attempt]);

  const money: (amount: number) => string = useCallback(
    (amount: number): string => {
      return formatCloudMoney({
        amount,
        currency: props.scope.currency,
        translator,
      });
    },
    [props.scope.currency, translator],
  );

  const total: number = (shares || []).reduce(
    (sum: number, share: CloudCostShare): number => {
      return sum + share.amount;
    },
    0,
  );
  const hidden: number = (shares || []).length - BREAKDOWN_SHOWN;
  const shown: Array<CloudCostShare> =
    showAll || hidden <= 0
      ? shares || []
      : (shares || []).slice(0, BREAKDOWN_SHOWN);

  return (
    <Card
      title={BREAKDOWN_TITLE}
      description={
        props.isOneAccount
          ? BREAKDOWN_DESCRIPTION_ONE_ACCOUNT
          : BREAKDOWN_DESCRIPTION
      }
    >
      <div data-testid="cloud-cost-breakdown" data-dimension={dimension}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          {/*
           * Each group wraps inside the card: four choices are wider than a
           * phone, and wider still in German.
           */}
          <FilterButtons
            ariaLabel="Break down by"
            className="flex-wrap"
            dataTestId="cloud-cost-breakdown-dimension"
            options={CLOUD_COST_DIMENSION_OPTIONS.filter(
              (option: { value: CloudCostDimension }): boolean => {
                return !props.isOneAccount || option.value !== "cloudAccountId";
              },
            )}
            selectedValue={dimension}
            onSelect={(value: string) => {
              setDimension(value as CloudCostDimension);
            }}
          />
          <FilterButtons
            ariaLabel="Period"
            className="flex-wrap"
            dataTestId="cloud-cost-breakdown-period"
            options={CLOUD_COST_PERIOD_OPTIONS}
            selectedValue={period}
            onSelect={(value: string) => {
              setPeriod(value as CloudCostPeriod);
            }}
          />
        </div>
        {error ? (
          <ErrorMessage
            message={error}
            onRefreshClick={() => {
              setAttempt(attempt + 1);
            }}
          />
        ) : shares === null ? (
          <div
            className="h-40 w-full animate-pulse rounded-md bg-gray-50"
            data-testid="cloud-cost-breakdown-loading"
          />
        ) : (
          <>
            {shares.length > 0 ? (
              <div
                className="mb-3 text-sm text-gray-600"
                data-testid="cloud-cost-breakdown-total"
              >
                {translator.translateTemplate(BREAKDOWN_TOTAL, {
                  amount: money(total),
                })}
              </div>
            ) : (
              <></>
            )}
            <RankedBars
              emptyText={BREAKDOWN_EMPTY}
              items={shown.map((share: CloudCostShare): RankedBarItem => {
                const label: CloudCostShareLabel = getCloudCostShareLabel({
                  dimension,
                  key: share.key,
                  accountNames,
                });
                const text: string = label.isAsWritten
                  ? label.label
                  : translator.translateText(label.label) || label.label;

                return {
                  key: share.key || "none",
                  label: <bdi>{text}</bdi>,
                  title: label.title || text,
                  count: share.amount,
                  countText: money(share.amount),
                  to:
                    dimension === "cloudAccountId" &&
                    accountNames.has(share.key)
                      ? RouteUtil.populateRouteParams(
                          RouteMap[PageMap.CLOUD_ACCOUNT_VIEW_COSTS] as Route,
                          { modelId: new ObjectID(share.key) },
                        )
                      : undefined,
                };
              })}
            />
            {hidden > 0 ? (
              <button
                type="button"
                aria-expanded={showAll}
                data-testid="cloud-cost-breakdown-toggle"
                className="-ml-2 mt-3 inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-indigo-600 transition-colors hover:bg-indigo-50 hover:text-indigo-700"
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
                    ? translator.translateText(SHOW_FEWER_SHARES)
                    : translator.translatePlural(SHOW_ALL_SHARES, hidden)}
                </span>
              </button>
            ) : (
              <></>
            )}
            {dimension === "resourceId" ? (
              <p className="mt-4 text-xs text-gray-500">
                {translator.translateText(BREAKDOWN_RESOURCES_NOTE)}
              </p>
            ) : (
              <></>
            )}
          </>
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
      <CloudDailySpendCard scope={scope} />
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
