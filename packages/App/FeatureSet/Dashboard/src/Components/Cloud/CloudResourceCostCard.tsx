import CloudCost from "Common/Models/AnalyticsModels/CloudCost";
import CloudCostRecommendation from "Common/Models/DatabaseModels/CloudCostRecommendation";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import AggregationInterval from "Common/Types/BaseDatabase/AggregationInterval";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import {
  CloudSavingKind,
  addUtcDays,
  getCloudCostResourceKey,
  getCloudSavingActionText,
  getMostCommonCloudCurrency,
  startOfUtcDay,
  startOfUtcMonth,
} from "Common/Types/Cloud/CloudCost";
import {
  CLOUD_COST_BASES,
  CLOUD_COST_BASIS_LABELS,
  CloudCostBasis,
  getCloudCostBasisColumn,
  isCloudCostBasis,
} from "Common/Types/Cloud/CloudCostBasis";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import FilterButtons from "Common/UI/Components/FilterButtons/FilterButtons";
import {
  COST_BASIS_SWITCH_LABEL,
  CloudCostBasisChoice,
  CloudCostBasisPill,
  useCloudCostBasis,
} from "./CloudCostBasis";
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
import { joinWithArrowsOn } from "Common/Types/DirectionArrow";
import {
  SAVING_NOT_KNOWN_YET,
  isCloudSavingAmountKnown,
} from "./CloudRightSizingText";

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

/*
 * A resource its cloud does not bill by name (AWS Cost Explorer says the
 * service and Region only) has no figure of its own: its card is only its
 * ways to spend less, and is called that rather than "What it costs".
 */
export const RESOURCE_SAVINGS_TITLE: string =
  translationKey("Ways to spend less");
export const RESOURCE_SAVINGS_DESCRIPTION: string = translationKey(
  "What its cloud's own recommender says could be saved.",
);

// The card's title and description: what it costs, or only how to spend less.
export function getCloudResourceCostCardHeading(cost: { hasCosts: boolean }): {
  title: string;
  description: string;
} {
  return cost.hasCosts
    ? { title: RESOURCE_COST_TITLE, description: RESOURCE_COST_DESCRIPTION }
    : {
        title: RESOURCE_SAVINGS_TITLE,
        description: RESOURCE_SAVINGS_DESCRIPTION,
      };
}

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
  // The cost basis to read (CloudCostBasis); billed when absent.
  basis?: CloudCostBasis | undefined;
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
          aggregateColumnName: getCloudCostBasisColumn(data.basis),
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
        // Whose it is: a cloud's recommender's, or OneUptime's own right-sizing.
        recommendationId: true,
        source: true,
        evidence: true,
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

export interface ViewProps {
  cost: CloudResourceCost;
  /*
   * The ways to spend less to list: the cost's own when absent. A resource
   * whose right-sizing card shows OneUptime's own right-sizing leaves it
   * out here, so the page says it once.
   */
  recommendations?: Array<CloudCostRecommendation> | undefined;
  /*
   * The cost basis the figures are on, and a way to pick another: the
   * card's own switch. With no way to pick, the basis is named only.
   */
  basis?: CloudCostBasis | undefined;
  onBasisChange?: ((basis: CloudCostBasis) => void) | undefined;
}

// Whether the card has anything to show: a cost, or a way to spend less.
export function hasCloudResourceCostToShow(data: {
  cost: CloudResourceCost | null;
  recommendations: Array<CloudCostRecommendation>;
}): boolean {
  return Boolean(
    data.cost && (data.cost.hasCosts || data.recommendations.length > 0),
  );
}

export const CloudResourceCostCardView: FunctionComponent<ViewProps> = (
  props: ViewProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const cost: CloudResourceCost = props.cost;
  const recommendations: Array<CloudCostRecommendation> =
    props.recommendations || cost.recommendations;

  if (!hasCloudResourceCostToShow({ cost, recommendations })) {
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

  const heading: { title: string; description: string } =
    getCloudResourceCostCardHeading(cost);

  const basis: CloudCostBasis | undefined = props.basis;

  return (
    <Card
      title={heading.title}
      description={heading.description}
      rightElement={
        basis && cost.hasCosts ? (
          props.onBasisChange ? (
            <FilterButtons
              ariaLabel={COST_BASIS_SWITCH_LABEL}
              dataTestId="cloud-resource-cost-basis"
              selectedValue={basis}
              options={CLOUD_COST_BASES.map((option: CloudCostBasis) => {
                return {
                  label: CLOUD_COST_BASIS_LABELS[option],
                  value: option,
                };
              })}
              onSelect={(value: string): void => {
                if (isCloudCostBasis(value)) {
                  props.onBasisChange!(value);
                }
              }}
            />
          ) : (
            <CloudCostBasisPill basis={basis} />
          )
        ) : undefined
      }
    >
      <div
        data-testid="cloud-resource-cost"
        data-state={cost.hasCosts ? "costs" : "savings-only"}
      >
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
        {recommendations.length > 0 ? (
          <ul
            className={`divide-y divide-gray-100 ${cost.hasCosts ? "mt-5 border-t border-gray-100" : "-mt-3"}`}
            data-testid="cloud-resource-savings"
          >
            {recommendations.map(
              (recommendation: CloudCostRecommendation): ReactElement => {
                const kind: CloudSavingKind =
                  (recommendation.kind as CloudSavingKind) ||
                  CloudSavingKind.Other;
                const change: string = joinWithArrowsOn(
                  [
                    recommendation.currentConfiguration || "",
                    recommendation.recommendedConfiguration || "",
                  ].filter((part: string): boolean => {
                    return part.length > 0;
                  }),
                  translator.language,
                );

                return (
                  <li
                    key={
                      recommendation._id?.toString() || recommendation.action
                    }
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 py-3"
                  >
                    <div className="min-w-0">
                      <div className="break-words text-sm font-medium text-gray-900">
                        {getCloudSavingActionText({
                          action: recommendation.action,
                          kind,
                          translateText: translator.translateText,
                        })}
                      </div>
                      {change ? (
                        /*
                         * The line takes the card's direction, so it sits
                         * under what to do on a page read right to left;
                         * each configuration keeps its own words' reading,
                         * and the arrow points the card's way
                         * (joinWithArrowsOn).
                         */
                        <div
                          className="mt-0.5 break-words text-xs text-gray-500"
                          data-testid="cloud-resource-saving-change"
                        >
                          {change}
                        </div>
                      ) : (
                        <></>
                      )}
                    </div>
                    <div className="text-end">
                      {isCloudSavingAmountKnown(recommendation) ? (
                        <>
                          <div className="text-sm font-semibold tabular-nums text-emerald-700">
                            <bdi>
                              {money(
                                Number(recommendation.monthlySavings) || 0,
                                recommendation.currency,
                              )}
                            </bdi>
                          </div>
                          <div className="text-xs text-gray-500">
                            {translator.translateText(PER_MONTH)}
                          </div>
                        </>
                      ) : (
                        /*
                         * OneUptime's own right-sizing of a resource its
                         * cloud does not bill by name: no amount yet.
                         */
                        <div
                          className="text-sm text-gray-500"
                          data-testid="cloud-resource-saving-not-known"
                        >
                          {translator.translateText(SAVING_NOT_KNOWN_YET)}
                        </div>
                      )}
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

const CloudResourceCostCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [cost, setCost] = useState<CloudResourceCost | null>(null);
  // Billed, amortized or net: the person's pick, else the project's.
  const basisChoice: CloudCostBasisChoice = useCloudCostBasis();

  useEffect(() => {
    let ignore: boolean = false;

    fetchCloudResourceCost({
      projectId: props.projectId,
      resourceRecordId: props.resourceRecordId,
      provider: props.provider,
      providerResourceId: props.providerResourceId,
      now: OneUptimeDate.getCurrentDate(),
      basis: basisChoice.basis,
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
    basisChoice.basis,
  ]);

  if (!cost) {
    return <></>;
  }

  return (
    <CloudResourceCostCardView
      cost={cost}
      basis={basisChoice.basis}
      onBasisChange={basisChoice.setBasis}
    />
  );
};

export default CloudResourceCostCard;
