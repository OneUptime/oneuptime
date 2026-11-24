import Route from "Common/Types/API/Route";
import {
  CloudCostAllocationGroupResult,
  CloudCostAllocationResult,
  CloudCostSharedSplit,
} from "Common/Types/Cloud/CloudCostAllocation";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import FilterButtons from "Common/UI/Components/FilterButtons/FilterButtons";
import downloadFile, { getExportFilename } from "Common/UI/Utils/DownloadFile";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import RankedBars, { RankedBarItem } from "../../SecurityOverview/RankedBars";
import {
  CLOUD_COST_PERIOD_OPTIONS,
  CloudCostPeriod,
} from "../CloudCostBreakdown";
import { BREAKDOWN_TOTAL } from "../CloudCostBreakdownCard";
import { formatCloudMoney } from "../CloudCostWords";
import {
  getGroupChangeHint,
  toCloudCostAllocationCsv,
} from "./CloudCostGroupFigures";
import {
  BREAKDOWN_UNALLOCATED,
  DOWNLOAD_CSV,
  GROUPS_EMPTY,
  SHARED_SPLIT_LABELS,
  SPEND_BY_GROUP_DESCRIPTION,
  SPEND_BY_GROUP_TITLE,
  SPLIT_ACROSS,
} from "./CloudCostGroupWords";

/*
 * WHAT EACH GROUP OF A VIEW WAS CHARGED in a period - its own costs, its
 * line items and its share of the shared groups - the costliest first,
 * each with its change on the period before, and what no group takes under
 * the list. Each row opens the group's own page; the figures download as a
 * CSV for finance.
 */

export interface ComponentProps {
  viewId: ObjectID;
  period: CloudCostPeriod;
  onPeriodChange: (period: CloudCostPeriod) => void;
  allocation: CloudCostAllocationResult | null;
  error: string;
  onRetry: () => void;
}

const CloudCostSpendByGroupCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const allocation: CloudCostAllocationResult | null = props.allocation;

  const money: (amount: number) => string = (amount: number): string => {
    return formatCloudMoney({
      amount,
      currency: allocation?.currency || "USD",
      translator,
    });
  };

  // The groups a person pays for: a shared group that split all of it away is left out.
  const charged: Array<CloudCostAllocationGroupResult> = (
    allocation?.groups || []
  )
    .filter((group: CloudCostAllocationGroupResult): boolean => {
      return Math.abs(group.total) >= 0.005;
    })
    .sort(
      (
        a: CloudCostAllocationGroupResult,
        b: CloudCostAllocationGroupResult,
      ) => {
        return b.total - a.total || a.order - b.order;
      },
    );
  const shared: Array<CloudCostAllocationGroupResult> = (
    allocation?.groups || []
  ).filter((group: CloudCostAllocationGroupResult): boolean => {
    return group.isShared && Math.abs(group.sharedOut) >= 0.005;
  });

  const items: Array<RankedBarItem> = charged.map(
    (group: CloudCostAllocationGroupResult): RankedBarItem => {
      const hint: string | null = group.isShared
        ? translator.translateText(
            SHARED_SPLIT_LABELS[
              group.split || CloudCostSharedSplit.Proportional
            ],
          ) || null
        : getGroupChangeHint({ group, translator });

      return {
        key: group.id,
        label: <bdi>{group.name}</bdi>,
        title: group.name,
        count: group.total,
        countText: money(group.total),
        hint: hint || undefined,
        to: RouteUtil.populateRouteParams(
          RouteMap[PageMap.CLOUD_COST_GROUP_VIEW] as Route,
          { modelId: props.viewId, subModelId: new ObjectID(group.id) },
        ),
      };
    },
  );

  return (
    <Card
      title={SPEND_BY_GROUP_TITLE}
      description={SPEND_BY_GROUP_DESCRIPTION}
      buttons={
        allocation
          ? [
              {
                title: DOWNLOAD_CSV,
                icon: IconProp.Download,
                buttonStyle: undefined,
                onClick: () => {
                  downloadFile({
                    content: toCloudCostAllocationCsv(allocation),
                    filename: getExportFilename({
                      label: allocation.viewName || allocation.viewId,
                      extension: "csv",
                      exportedAt: new Date(allocation.readAt),
                    }),
                    mimeType: "text/csv;charset=utf-8;",
                  });
                },
              },
            ]
          : []
      }
    >
      <div data-testid="cloud-cost-spend-by-group">
        <div className="mb-4">
          <FilterButtons
            ariaLabel="Period"
            className="flex-wrap"
            dataTestId="cloud-cost-spend-by-group-period"
            options={CLOUD_COST_PERIOD_OPTIONS}
            selectedValue={props.period}
            onSelect={(value: string) => {
              props.onPeriodChange(value as CloudCostPeriod);
            }}
          />
        </div>
        {props.error ? (
          <ErrorMessage message={props.error} onRefreshClick={props.onRetry} />
        ) : allocation === null ? (
          <div
            className="h-40 w-full animate-pulse rounded-md bg-gray-50"
            data-testid="cloud-cost-spend-by-group-loading"
          />
        ) : (
          <>
            {Math.abs(allocation.total) >= 0.005 ? (
              <div
                className="mb-3 text-sm text-gray-600"
                data-testid="cloud-cost-spend-by-group-total"
              >
                {translator.translateTemplate(BREAKDOWN_TOTAL, {
                  amount: money(allocation.total),
                })}
              </div>
            ) : (
              <></>
            )}
            <RankedBars emptyText={GROUPS_EMPTY} items={items} />
            {Math.abs(allocation.unallocated.total) >= 0.005 ||
            shared.length > 0 ? (
              <ul
                className="mt-4 space-y-1 border-t border-gray-100 pt-3"
                data-testid="cloud-cost-spend-by-group-rest"
              >
                {shared.map((group: CloudCostAllocationGroupResult) => {
                  return (
                    <li key={group.id} className="text-xs text-gray-600">
                      <bdi className="font-medium text-gray-700">
                        {group.name}
                      </bdi>
                      {" · "}
                      {translator.translateTemplate(SPLIT_ACROSS, {
                        amount: money(group.sharedOut),
                      })}
                    </li>
                  );
                })}
                {Math.abs(allocation.unallocated.total) >= 0.005 ? (
                  <li
                    className="text-xs text-gray-600"
                    data-testid="cloud-cost-spend-by-group-unallocated"
                  >
                    {translator.translateTemplate(BREAKDOWN_UNALLOCATED, {
                      amount: money(allocation.unallocated.total),
                    })}
                  </li>
                ) : (
                  <></>
                )}
              </ul>
            ) : (
              <></>
            )}
          </>
        )}
      </div>
    </Card>
  );
};

export default CloudCostSpendByGroupCard;
