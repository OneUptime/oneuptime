import CloudCost from "Common/Models/AnalyticsModels/CloudCost";
import CloudCostRecommendation from "Common/Models/DatabaseModels/CloudCostRecommendation";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import AggregationInterval from "Common/Types/BaseDatabase/AggregationInterval";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import {
  CLOUD_SAVING_KIND_LABELS,
  CloudSavingKind,
  addUtcDays,
  getCloudCostResourceKey,
  getMostCommonCloudCurrency,
  startOfUtcDay,
  startOfUtcMonth,
} from "Common/Types/Cloud/CloudCost";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import {
  LAST_30_DAYS,
  PER_MONTH,
  SO_FAR_THIS_MONTH,
  formatCloudMoney,
} from "./CloudCostWords";
import { CloudCostFigure } from "./CloudSpendCard";

/*
 * What one cloud resource costs, on its Overview: this month so far and the
 * last 30 days, from the costs its cloud bills it under (Azure Cost
 * Management and a Google Cloud detailed billing export name each
 * resource; AWS Cost Explorer does not), and the ways its cloud's
 * recommender says it could cost less. Nothing is drawn for a resource
 * with neither - or while they are read, or when they cannot be.
 */

export const RESOURCE_COST_TITLE: string = translationKey("What it costs");
export const RESOURCE_COST_DESCRIPTION: string = translationKey(
  "From its cloud's own billing, and the ways its cloud's recommender says it could cost less.",
);

export interface CloudResourceCost {
  currency: string;
  monthToDate: number;
  last30Days: number;
  hasCosts: boolean;
  recommendations: Array<CloudCostRecommendation>;
}

// The amounts of one window, by currency: the one most rows are in wins.
function pickCurrencyAmount(
  rows: Array<AggregatedModel>,
  currency: string,
): number {
  return rows
    .filter((row: AggregatedModel): boolean => {
      return String(row["currency"] || "") === currency;
    })
    .reduce((sum: number, row: AggregatedModel): number => {
      return sum + (Number(row.value) || 0);
    }, 0);
}

export async function fetchCloudResourceCost(data: {
  projectId: ObjectID;
  resourceRecordId: ObjectID;
  provider: string;
  providerResourceId: string;
  now: Date;
}): Promise<CloudResourceCost> {
  const resourceKey: string = getCloudCostResourceKey(
    data.provider,
    data.providerResourceId,
  );
  const thirtyDaysBack: Date = addUtcDays(startOfUtcDay(data.now), -29);
  const monthStart: Date = startOfUtcMonth(data.now);

  const read: (from: Date) => Promise<Array<AggregatedModel>> = async (
    from: Date,
  ): Promise<Array<AggregatedModel>> => {
    if (!resourceKey) {
      return [];
    }

    const result: AggregatedResult =
      await AnalyticsModelAPI.aggregate<CloudCost>({
        modelType: CloudCost,
        aggregateBy: {
          query: {
            projectId: data.projectId,
            resourceId: resourceKey,
            day: new InBetween<Date>(from, data.now),
          },
          aggregationType: AggregationType.Sum,
          aggregateColumnName: "cost",
          aggregationTimestampColumnName: "day",
          aggregationInterval: AggregationInterval.Total,
          startTimestamp: from,
          endTimestamp: data.now,
          groupBy: { currency: true },
          limit: 10,
          skip: 0,
          sort: { day: SortOrder.Ascending },
        },
      });

    return result.data;
  };

  const [month, last30, recommendations]: [
    Array<AggregatedModel>,
    Array<AggregatedModel>,
    ListResult<CloudCostRecommendation>,
  ] = await Promise.all([
    read(monthStart),
    read(thirtyDaysBack),
    ModelAPI.getList<CloudCostRecommendation>({
      modelType: CloudCostRecommendation,
      query: { cloudResourceId: data.resourceRecordId },
      select: {
        _id: true,
        kind: true,
        action: true,
        monthlySavings: true,
        currency: true,
        currentConfiguration: true,
        recommendedConfiguration: true,
      },
      sort: { monthlySavings: SortOrder.Descending },
      skip: 0,
      limit: 5,
    }),
  ]);

  const counts: Map<string, number> = new Map();

  for (const row of [...month, ...last30]) {
    const currency: string = String(row["currency"] || "");
    if (currency) {
      counts.set(currency, (counts.get(currency) || 0) + 1);
    }
  }

  const currency: string =
    counts.size > 0
      ? getMostCommonCloudCurrency(counts)
      : (recommendations.data[0]?.currency as string) || "USD";

  return {
    currency,
    monthToDate: pickCurrencyAmount(month, currency),
    last30Days: pickCurrencyAmount(last30, currency),
    hasCosts: last30.length > 0 || month.length > 0,
    recommendations: recommendations.data,
  };
}

export interface ComponentProps {
  projectId: ObjectID;
  resourceRecordId: ObjectID;
  provider: string;
  providerResourceId: string;
}

const CloudResourceCostCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [cost, setCost] = useState<CloudResourceCost | null>(null);

  useEffect(() => {
    let ignore: boolean = false;

    fetchCloudResourceCost({
      projectId: props.projectId,
      resourceRecordId: props.resourceRecordId,
      provider: props.provider,
      providerResourceId: props.providerResourceId,
      now: OneUptimeDate.getCurrentDate(),
    })
      .then((found: CloudResourceCost): void => {
        if (!ignore) {
          setCost(found);
        }
      })
      .catch((): void => {
        // Only a figure beside the resource: nothing, rather than an error.
        if (!ignore) {
          setCost(null);
        }
      });

    return (): void => {
      ignore = true;
    };
  }, [
    props.resourceRecordId.toString(),
    props.provider,
    props.providerResourceId,
  ]);

  if (!cost || (!cost.hasCosts && cost.recommendations.length === 0)) {
    return <></>;
  }

  const money: (amount: number, currency?: string | undefined) => string = (
    amount: number,
    currency?: string | undefined,
  ): string => {
    return formatCloudMoney({
      amount,
      currency: currency || cost.currency,
      translator,
    });
  };

  return (
    <Card title={RESOURCE_COST_TITLE} description={RESOURCE_COST_DESCRIPTION}>
      <div data-testid="cloud-resource-cost">
        {cost.hasCosts ? (
          <div className="[container-type:inline-size]">
            <dl className="grid grid-cols-1 gap-4 [@container(min-width:20rem)]:grid-cols-2">
              <CloudCostFigure
                label={SO_FAR_THIS_MONTH}
                value={money(cost.monthToDate)}
                testId="cloud-resource-cost-month"
              />
              <CloudCostFigure
                label={LAST_30_DAYS}
                value={money(cost.last30Days)}
                testId="cloud-resource-cost-30-days"
              />
            </dl>
          </div>
        ) : (
          <></>
        )}
        {cost.recommendations.length > 0 ? (
          <ul
            className={`divide-y divide-gray-100 ${cost.hasCosts ? "mt-5 border-t border-gray-100" : "-mt-3"}`}
            data-testid="cloud-resource-savings"
          >
            {cost.recommendations.map(
              (recommendation: CloudCostRecommendation): ReactElement => {
                const kind: CloudSavingKind =
                  (recommendation.kind as CloudSavingKind) ||
                  CloudSavingKind.Other;
                const change: string = [
                  recommendation.currentConfiguration || "",
                  recommendation.recommendedConfiguration || "",
                ]
                  .filter((part: string): boolean => {
                    return part.length > 0;
                  })
                  .join(" → ");

                return (
                  <li
                    key={
                      recommendation._id?.toString() || recommendation.action
                    }
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 py-3"
                  >
                    <div className="min-w-0">
                      <div className="break-words text-sm font-medium text-gray-900">
                        {recommendation.action ||
                          translator.translateText(
                            CLOUD_SAVING_KIND_LABELS[kind],
                          )}
                      </div>
                      {change ? (
                        <bdi className="mt-0.5 block break-words text-xs text-gray-500">
                          {change}
                        </bdi>
                      ) : (
                        <></>
                      )}
                    </div>
                    <div className="text-end">
                      <div className="text-sm font-semibold tabular-nums text-emerald-700">
                        <bdi>
                          {money(
                            Number(recommendation.monthlySavings) || 0,
                            recommendation.currency,
                          )}
                        </bdi>
                      </div>
                      <div className="text-[11px] text-gray-500">
                        {translator.translateText(PER_MONTH)}
                      </div>
                    </div>
                  </li>
                );
              },
            )}
          </ul>
        ) : (
          <></>
        )}
      </div>
    </Card>
  );
};

export default CloudResourceCostCard;
