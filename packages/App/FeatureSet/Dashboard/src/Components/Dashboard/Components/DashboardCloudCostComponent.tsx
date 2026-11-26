import React, { FunctionComponent, ReactElement, useMemo } from "react";
import DashboardCloudCostComponent from "Common/Types/Dashboard/DashboardComponents/DashboardCloudCostComponent";
import {
  CloudCostWidgetDisplay,
  CloudCostWidgetScope,
} from "Common/Utils/Dashboard/Components/DashboardCloudCostComponent";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import {
  CloudCostAllocationGroupResult,
  CloudCostAllocationInterval,
  CloudCostAllocationResult,
  CloudCostAllocationShare,
  getCloudCostAllocationChange,
  getPreviousCloudCostWindow,
  toCloudCostAllocationWindow,
} from "Common/Types/Cloud/CloudCostAllocation";
import {
  CloudCostBasis,
  isCloudCostBasis,
} from "Common/Types/Cloud/CloudCostBasis";
import {
  CloudCostBreakdownComparison,
  CloudCostColumnDimension,
  CloudCostComparedShare,
  CloudCostPoint,
  CloudCostScope,
  readCloudCostBreakdownComparison,
  readCloudCostTrend,
} from "Common/Types/Cloud/CloudCostBreakdowns";
import { addUtcDays, fromCloudCostDay } from "Common/Types/Cloud/CloudCost";
import { formatCloudCostMoney } from "Common/Types/Cloud/CloudCostReportWords";
import { formatReaderFigure } from "Common/Types/DateLanguage";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import ChartSkeleton from "Common/UI/Components/Skeleton/ChartSkeleton";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import DashboardWidgetIds from "Common/Utils/Dashboard/DashboardWidgetIds";
import CloudDailySpendChart from "../../Cloud/CloudDailySpendChart";
import { DASHBOARD_CLOUD_COST_READER } from "../../Cloud/CloudCostReads";
import { fetchProjectCloudCostBasis } from "../../Cloud/CloudCostBasis";
import {
  fetchCloudCostAllocation,
  fetchCloudCostGroupSpend,
  CloudCostGroupSpend,
} from "../../Cloud/CostGroups/CloudCostAllocationReads";
import useCloudAccounts, {
  CloudAccountsRead,
} from "../../Cloud/UseCloudAccounts";
import RankedBars, { RankedBarItem } from "../../SecurityOverview/RankedBars";
import useProductAnalyticsRead, {
  ProductAnalyticsRead,
} from "../../ProductAnalytics/useProductAnalyticsRead";
import DashboardResourceList from "../Utils/DashboardResourceList";
import { DashboardBaseComponentProps } from "./DashboardBaseComponent";
import {
  areProductAnalyticsWidgetPropsEqual,
  useProductAnalyticsWidgetPeriod,
} from "./DashboardProductAnalyticsWidget";
import DashboardWidgetEmpty from "./DashboardWidgetEmpty";
import DashboardWidgetError from "./DashboardWidgetError";
import WidgetPlaceholder from "./WidgetPlaceholder";
import DashboardWidgetLine from "./DashboardWidgetLine";

/*
 * THE CLOUD COST WIDGET (#11009): what the clouds cost, beside the health
 * of the services that spend it - a total against the period before, the
 * biggest parts of the spend, or each day's spend - over every account,
 * one account, a cost group or a cost view, for the dashboard's time range.
 *
 * Read as the viewer may read the costs, by the code Cloud > Costs draws
 * with (CloudCostBreakdowns) and a cost group's page reads (its view's
 * allocation): the same figures as those pages for the same days. A public
 * dashboard draws none of it, only its title - cost figures stay with
 * people who may read them.
 */

export const CLOUD_COST_WIDGET_TEST_ID: string = "dashboard-cloud-cost";

export const CLOUD_COST_NOT_ON_PUBLIC: string = translationKey(
  "Cloud costs are not available on public dashboards.",
);
export const CLOUD_COST_SETUP: string = translationKey(
  "Pick the account, cost group or cost view this widget covers in its settings.",
);
export const CLOUD_COST_NOTHING: string = translationKey(
  "Nothing cost anything in this time range.",
);
export const CLOUD_COST_EVERY_ACCOUNT: string = translationKey(
  "Cloud spend, every account",
);
export const CLOUD_COST_UNALLOCATED: string = translationKey("Unallocated");
export const CLOUD_COST_MORE_THAN_BEFORE: string = translationKey(
  "{{percent}} more than the period before",
);
export const CLOUD_COST_LESS_THAN_BEFORE: string = translationKey(
  "{{percent}} less than the period before",
);
export const CLOUD_COST_SAME_AS_BEFORE: string = translationKey(
  "The same as the period before",
);

export interface ComponentProps extends DashboardBaseComponentProps {
  component: DashboardCloudCostComponent;
}

// What one read of the widget answers, whatever it draws.
interface CloudCostWidgetData {
  currency: string;
  total: number;
  previousTotal: number;
  rows: Array<{ key: string; name: string; amount: number }>;
  points: Array<CloudCostPoint>;
}

function readScope(value: unknown): CloudCostWidgetScope {
  return (Object.values(CloudCostWidgetScope) as Array<unknown>).includes(value)
    ? (value as CloudCostWidgetScope)
    : CloudCostWidgetScope.AllAccounts;
}

function readDisplay(value: unknown): CloudCostWidgetDisplay {
  return (Object.values(CloudCostWidgetDisplay) as Array<unknown>).includes(
    value,
  )
    ? (value as CloudCostWidgetDisplay)
    : CloudCostWidgetDisplay.Trend;
}

function readBreakdown(value: unknown): CloudCostColumnDimension {
  return value === "region" ||
    value === "cloudAccountId" ||
    value === "resourceId"
    ? value
    : "service";
}

// An allocation's buckets and series as points: each bucket's whole.
function toAllocationPoints(
  allocation: CloudCostAllocationResult,
): Array<CloudCostPoint> {
  return allocation.buckets.map((bucket: string, index: number) => {
    let amount: number = allocation.unallocated.series[index] || 0;

    for (const group of allocation.groups) {
      amount += group.series[index] || 0;
    }

    return { x: fromCloudCostDay(bucket), y: amount };
  });
}

/*
 * The widget's figures for its days: over its scope, on its basis, in the
 * currency most of the viewer's accounts are billed in.
 */
export async function readCloudCostWidget(data: {
  scope: CloudCostWidgetScope;
  display: CloudCostWidgetDisplay;
  breakdownBy: CloudCostColumnDimension;
  accountId: string | null;
  groupId: string | null;
  viewId: string | null;
  basis: CloudCostBasis;
  currency: string;
  projectId: ObjectID;
  start: Date;
  end: Date;
}): Promise<CloudCostWidgetData> {
  const window: ReturnType<typeof toCloudCostAllocationWindow> =
    toCloudCostAllocationWindow({ startDate: data.start, endDate: data.end });
  const previous: ReturnType<typeof getPreviousCloudCostWindow> =
    getPreviousCloudCostWindow(window);
  const endOf: (day: Date) => Date = (day: Date): Date => {
    return new Date(addUtcDays(day, 1).getTime() - 1);
  };

  if (data.scope === CloudCostWidgetScope.CostGroup && data.groupId) {
    const spend: CloudCostGroupSpend = await fetchCloudCostGroupSpend({
      groupId: new ObjectID(data.groupId),
      ask: {
        startDate: window.start,
        endDate: endOf(window.lastDay),
        currency: data.currency,
        basis: data.basis,
        interval: CloudCostAllocationInterval.Day,
      },
    });

    return {
      currency: spend.currency,
      total: spend.group.total,
      previousTotal: spend.group.previousTotal || 0,
      rows: (spend.group.topServices || []).map(
        (share: CloudCostAllocationShare) => {
          return { key: share.key, name: share.key, amount: share.amount };
        },
      ),
      points: spend.buckets.map((bucket: string, index: number) => {
        return { x: fromCloudCostDay(bucket), y: spend.group.series[index] || 0 };
      }),
    };
  }

  if (data.scope === CloudCostWidgetScope.CostView && data.viewId) {
    const allocation: CloudCostAllocationResult =
      await fetchCloudCostAllocation({
        viewId: new ObjectID(data.viewId),
        ask: {
          startDate: window.start,
          endDate: endOf(window.lastDay),
          currency: data.currency,
          basis: data.basis,
          interval: CloudCostAllocationInterval.Day,
        },
      });

    return {
      currency: allocation.currency,
      total: allocation.total,
      previousTotal: allocation.previousTotal || 0,
      rows: [
        ...allocation.groups
          .filter((group: CloudCostAllocationGroupResult): boolean => {
            return Math.abs(group.total) >= 0.005;
          })
          .sort(
            (
              a: CloudCostAllocationGroupResult,
              b: CloudCostAllocationGroupResult,
            ): number => {
              return b.total - a.total;
            },
          )
          .map((group: CloudCostAllocationGroupResult) => {
            return { key: group.id, name: group.name, amount: group.total };
          }),
        ...(Math.abs(allocation.unallocated.total) >= 0.005
          ? [
              {
                key: "unallocated",
                name: CLOUD_COST_UNALLOCATED,
                amount: allocation.unallocated.total,
              },
            ]
          : []),
      ],
      points: toAllocationPoints(allocation),
    };
  }

  const scope: CloudCostScope = {
    projectId: data.projectId,
    cloudAccountIds:
      data.scope === CloudCostWidgetScope.Account && data.accountId
        ? [new ObjectID(data.accountId)]
        : undefined,
    currency: data.currency,
    startDate: window.start,
    endDate: endOf(window.lastDay),
    basis: data.basis,
  };

  if (data.display === CloudCostWidgetDisplay.Trend) {
    return {
      currency: data.currency,
      total: 0,
      previousTotal: 0,
      rows: [],
      points: await readCloudCostTrend(DASHBOARD_CLOUD_COST_READER, scope),
    };
  }

  const comparison: CloudCostBreakdownComparison =
    await readCloudCostBreakdownComparison(DASHBOARD_CLOUD_COST_READER, {
      scope,
      previousStartDate: previous.start,
      previousEndDate: endOf(previous.lastDay),
      dimension: data.breakdownBy,
    });

  return {
    currency: data.currency,
    total: comparison.total,
    previousTotal: comparison.previousTotal,
    rows: comparison.shares
      .filter((share: CloudCostComparedShare): boolean => {
        return Math.abs(share.amount) >= 0.005;
      })
      .map((share: CloudCostComparedShare) => {
        return { key: share.key, name: share.key, amount: share.amount };
      }),
    points: [],
  };
}

const DashboardCloudCostComponentElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const isPublic: boolean = DashboardResourceList.isPublic();
  const args: DashboardCloudCostComponent["arguments"] =
    props.component.arguments;
  const scope: CloudCostWidgetScope = readScope(args.scope);
  const display: CloudCostWidgetDisplay = readDisplay(args.display);
  const breakdownBy: CloudCostColumnDimension = readBreakdown(args.breakdownBy);
  const accountId: string | null = DashboardWidgetIds.readId(
    args.cloudAccountId,
  );
  const groupId: string | null = DashboardWidgetIds.readId(args.cloudCostGroupId);
  const viewId: string | null = DashboardWidgetIds.readId(args.cloudCostViewId);
  const period: InBetween<Date> = useProductAnalyticsWidgetPeriod(props);
  const accounts: CloudAccountsRead = useCloudAccounts();
  const currency: string = accounts.totals.costs.currency;
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  const needsId: boolean =
    (scope === CloudCostWidgetScope.Account && !accountId) ||
    (scope === CloudCostWidgetScope.CostGroup && !groupId) ||
    (scope === CloudCostWidgetScope.CostView && !viewId);
  const canRead: boolean =
    !isPublic && !needsId && Boolean(projectId) && !accounts.isLoading;

  const read: ProductAnalyticsRead<CloudCostWidgetData | null> =
    useProductAnalyticsRead<CloudCostWidgetData | null>(
      canRead
        ? JSON.stringify([
            args,
            currency,
            period.startValue.getTime(),
            period.endValue.getTime(),
            props.refreshTick || 0,
          ])
        : "",
      async (): Promise<CloudCostWidgetData | null> => {
        if (!canRead || !projectId) {
          return null;
        }

        const basis: CloudCostBasis = isCloudCostBasis(args.basis)
          ? args.basis
          : await fetchProjectCloudCostBasis(projectId);

        return await readCloudCostWidget({
          scope,
          display,
          breakdownBy,
          accountId,
          groupId,
          viewId,
          basis,
          currency,
          projectId,
          start: period.startValue,
          end: period.endValue,
        });
      },
    );

  const money: (amount: number, whole?: boolean) => string = (
    amount: number,
    whole?: boolean,
  ): string => {
    return formatCloudCostMoney({
      amount,
      currency: read.data?.currency || currency,
      language: translator.language,
      whole,
    });
  };

  const accountNames: Map<string, string> = useMemo(():
    | Map<string, string>
    | never => {
    return new Map(
      accounts.accounts.map(
        (account: { id: ObjectID; name?: string; accountId: string }) => {
          return [account.id.toString(), account.name || account.accountId];
        },
      ),
    );
  }, [accounts.accounts]);

  const title: string =
    args.title?.trim() ||
    (scope === CloudCostWidgetScope.AllAccounts
      ? translator.translateText(CLOUD_COST_EVERY_ACCOUNT) ||
        CLOUD_COST_EVERY_ACCOUNT
      : "");

  let body: ReactElement;

  if (isPublic) {
    body = (
      <WidgetPlaceholder
        icon={IconProp.Billing}
        message={CLOUD_COST_NOT_ON_PUBLIC}
      />
    );
  } else if (needsId) {
    body = <WidgetPlaceholder icon={IconProp.Billing} message={CLOUD_COST_SETUP} />;
  } else if (read.error || accounts.error) {
    body = (
      <DashboardWidgetError
        icon={IconProp.Billing}
        error={read.error || accounts.error}
      />
    );
  } else if (!read.data) {
    body = (
      <div className="flex h-full items-center justify-center">
        <ChartSkeleton hasLegend={false} fillsHeight={true} />
      </div>
    );
  } else if (display === CloudCostWidgetDisplay.Total) {
    const change: number | null = getCloudCostAllocationChange({
      current: read.data.total,
      previous: read.data.previousTotal,
    });
    const percent: string =
      change === null
        ? ""
        : formatReaderFigure(Math.abs(change), {
            decimals: 0,
            isPercent: true,
            language: translator.language,
          });

    body = (
      <div
        className="flex h-full flex-col items-center justify-center text-center"
        data-testid={`${CLOUD_COST_WIDGET_TEST_ID}-total`}
      >
        <p className="text-3xl font-bold tabular-nums text-gray-900">
          {money(read.data.total)}
        </p>
        {change !== null ? (
          <p
            className={`mt-1 text-sm ${
              Math.abs(change) < 0.5
                ? "text-gray-600"
                : change > 0
                  ? "text-amber-700"
                  : "text-emerald-700"
            }`}
          >
            {Math.abs(change) < 0.5
              ? translator.translateText(CLOUD_COST_SAME_AS_BEFORE)
              : translator.translateTemplate(
                  change > 0
                    ? CLOUD_COST_MORE_THAN_BEFORE
                    : CLOUD_COST_LESS_THAN_BEFORE,
                  { percent },
                )}
          </p>
        ) : (
          <></>
        )}
      </div>
    );
  } else if (display === CloudCostWidgetDisplay.Breakdown) {
    const items: Array<RankedBarItem> = read.data.rows
      .slice(0, 10)
      .map((row: { key: string; name: string; amount: number }) => {
        const name: string =
          row.key === "unallocated"
            ? translator.translateText(CLOUD_COST_UNALLOCATED) ||
              CLOUD_COST_UNALLOCATED
            : breakdownBy === "cloudAccountId" &&
                scope !== CloudCostWidgetScope.CostView &&
                scope !== CloudCostWidgetScope.CostGroup
              ? accountNames.get(row.key) || row.name
              : row.name;

        return {
          key: row.key || "none",
          label: <bdi>{name}</bdi>,
          title: name,
          count: row.amount,
          countText: money(row.amount),
        };
      });

    body =
      items.length === 0 ? (
        <DashboardWidgetEmpty
          icon={IconProp.Billing}
          message={CLOUD_COST_NOTHING}
        />
      ) : (
        <div
          className="px-1"
          data-testid={`${CLOUD_COST_WIDGET_TEST_ID}-breakdown`}
        >
          <RankedBars emptyText={CLOUD_COST_NOTHING} items={items} />
        </div>
      );
  } else {
    const hasSpend: boolean = read.data.points.some(
      (point: CloudCostPoint): boolean => {
        return Math.abs(point.y) >= 0.005;
      },
    );

    body = hasSpend ? (
      <div data-testid={`${CLOUD_COST_WIDGET_TEST_ID}-trend`}>
        <CloudDailySpendChart
          points={read.data.points}
          currency={read.data.currency}
          heightInPx={Math.max(
            120,
            (props.dashboardComponentHeightInPx || 240) - (title ? 48 : 24),
          )}
        />
      </div>
    ) : (
      <DashboardWidgetEmpty icon={IconProp.Billing} message={CLOUD_COST_NOTHING} />
    );
  }

  return (
    <div
      className="flex h-full w-full flex-col"
      data-testid={CLOUD_COST_WIDGET_TEST_ID}
      data-display={display}
    >
      {title ? (
        <div className="mb-1 flex min-w-0 items-center px-1">
          <DashboardWidgetLine
            text={title}
            className="min-w-0 truncate text-sm font-medium text-gray-700"
            title={title}
            dataTestId={`${CLOUD_COST_WIDGET_TEST_ID}-title`}
          />
        </div>
      ) : (
        <></>
      )}
      <div
        className={`min-h-0 flex-1 overflow-auto ${
          read.isLoading && read.data ? "opacity-60 transition-opacity" : ""
        }`}
      >
        {body}
      </div>
    </div>
  );
};

export default React.memo(
  DashboardCloudCostComponentElement,
  areProductAnalyticsWidgetPropsEqual,
);
