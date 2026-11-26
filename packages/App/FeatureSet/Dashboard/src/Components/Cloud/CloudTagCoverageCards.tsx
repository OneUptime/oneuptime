import Route from "Common/Types/API/Route";
import { getCloudProviderLabel } from "Common/Types/Cloud/CloudPlatform";
import {
  CloudTagCoverageCount,
  getCloudTagCoveragePercent,
  normalizeCloudTagKey,
} from "Common/Types/Cloud/CloudRequiredTags";
import {
  CloudTagAccountCoverageJSON,
  CloudTagCoverageBreakdown,
  CloudTagRequiredJSON,
  CloudTagTrendPointJSON,
} from "Common/Types/Cloud/CloudTagCoverage";
import { fromCloudCostDay } from "Common/Types/Cloud/CloudCost";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import LineChartElement from "Common/UI/Components/Charts/Line/LineChart";
import ChartCurve from "Common/UI/Components/Charts/Types/ChartCurve";
import SeriesPoint from "Common/UI/Components/Charts/Types/SeriesPoints";
import {
  XAxis,
  XAxisAggregateType,
} from "Common/UI/Components/Charts/Types/XAxis/XAxis";
import XAxisPrecision from "Common/UI/Components/Charts/Types/XAxis/XAxisPrecision";
import XAxisType from "Common/UI/Components/Charts/Types/XAxis/XAxisType";
import YAxis, {
  YAxisPrecision,
} from "Common/UI/Components/Charts/Types/YAxis/YAxis";
import YAxisType from "Common/UI/Components/Charts/Types/YAxis/YAxisType";
import { formatReaderFigure } from "Common/Types/DateLanguage";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import AppLink from "../AppLink/AppLink";
import {
  ACCOUNTS_DESCRIPTION,
  ACCOUNTS_TITLE,
  BY_TAG_DESCRIPTION,
  BY_TAG_TITLE,
  SPEND_NOT_MEASURED,
  TREND_DESCRIPTION,
  TREND_EMPTY,
  TREND_RESOURCES_SERIES,
  TREND_SPEND_SERIES,
  TREND_TITLE,
  formatCoverage,
  getCoverageTone,
  getSpendNotMeasuredReason,
} from "./CloudTagWords";

/*
 * THE SHARES OF CLOUD > TAGS AND AN ACCOUNT'S TAGS (#11012): each required
 * tag's share of the spend and of the resources, each account's, and the
 * trend of both over the last 12 weeks. A share is a bar and a percent in
 * the reader's language; one that cannot be measured says why.
 */

const BAR_CLASS_NAMES: Readonly<Record<string, string>> = {
  danger: "bg-red-500",
  warning: "bg-amber-500",
  positive: "bg-emerald-500",
  neutral: "bg-gray-300",
};

export const TREND_CHART_HEIGHT_IN_PX: number = 240;

// The trend's lines: spend in emerald, resources in indigo, as their tiles are.
export const TREND_COLORS: Array<string> = ["#10b981", "#6366f1"];

// One share: its label, its percent and its bar, or why it is not measured.
export const CoverageBar: FunctionComponent<{
  label: string;
  count: CloudTagCoverageCount | null;
  notMeasured?: string | null | undefined;
  testId: string;
}> = (props: {
  label: string;
  count: CloudTagCoverageCount | null;
  notMeasured?: string | null | undefined;
  testId: string;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const percent: number | null = getCloudTagCoveragePercent(props.count);
  const value: string | null = formatCoverage(props.count);

  return (
    <div className="min-w-0" data-testid={props.testId}>
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="text-gray-500">
          {translator.translateText(props.label) || props.label}
        </span>
        <span
          className="font-semibold tabular-nums text-gray-900"
          data-testid={`${props.testId}-value`}
        >
          {value ||
            translator.translateText(SPEND_NOT_MEASURED) ||
            SPEND_NOT_MEASURED}
        </span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
        <div
          className={`h-1.5 rounded-full ${
            BAR_CLASS_NAMES[getCoverageTone(props.count)]
          }`}
          style={{ width: `${percent === null ? 0 : percent}%` }}
        />
      </div>
      {percent === null && props.notMeasured ? (
        <p className="mt-1 text-xs text-gray-500">
          {translator.translateText(props.notMeasured) || props.notMeasured}
        </p>
      ) : (
        <></>
      )}
    </div>
  );
};

// Each required tag's share of the spend and of the resources.
export const CloudTagByKeyCard: FunctionComponent<{
  requiredTags: Array<CloudTagRequiredJSON>;
  spend: CloudTagCoverageBreakdown | null;
  resources: CloudTagCoverageBreakdown;
  spendNotMeasured?: string | null | undefined;
}> = (props: {
  requiredTags: Array<CloudTagRequiredJSON>;
  spend: CloudTagCoverageBreakdown | null;
  resources: CloudTagCoverageBreakdown;
  spendNotMeasured?: string | null | undefined;
}): ReactElement => {
  // A key the project and an account both require is one row.
  const keys: Array<{ key: string; allowedValues: Array<string> }> = [];

  for (const tag of props.requiredTags) {
    const folded: string = normalizeCloudTagKey(tag.key);

    if (
      !keys.some((entry: { key: string }): boolean => {
        return normalizeCloudTagKey(entry.key) === folded;
      })
    ) {
      keys.push({ key: tag.key, allowedValues: tag.allowedValues });
    }
  }

  if (keys.length === 0) {
    return <></>;
  }

  return (
    <Card title={BY_TAG_TITLE} description={BY_TAG_DESCRIPTION}>
      <ul className="divide-y divide-gray-100" data-testid="cloud-tags-by-key">
        {keys.map((entry: { key: string; allowedValues: Array<string> }) => {
          const folded: string = normalizeCloudTagKey(entry.key);

          return (
            <li
              key={folded}
              className="grid grid-cols-1 gap-3 py-3 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1.2fr)] sm:items-center"
              data-testid="cloud-tags-by-key-row"
              data-key={folded}
            >
              <div className="min-w-0">
                <bdi className="font-mono text-sm font-semibold text-gray-900">
                  {entry.key}
                </bdi>
                {entry.allowedValues.length > 0 ? (
                  <p className="mt-0.5 truncate font-mono text-xs text-gray-500">
                    <bdi>{entry.allowedValues.join(", ")}</bdi>
                  </p>
                ) : (
                  <></>
                )}
              </div>
              <CoverageBar
                label={TREND_SPEND_SERIES}
                count={props.spend?.byKey[folded] || null}
                notMeasured={props.spendNotMeasured}
                testId={`cloud-tags-by-key-spend-${folded}`}
              />
              <CoverageBar
                label={TREND_RESOURCES_SERIES}
                count={props.resources.byKey[folded] || null}
                testId={`cloud-tags-by-key-resources-${folded}`}
              />
            </li>
          );
        })}
      </ul>
    </Card>
  );
};

// Each account's share of its spend and of its resources, by its own required tags.
export const CloudTagAccountsCard: FunctionComponent<{
  accounts: Array<CloudTagAccountCoverageJSON>;
}> = (props: {
  accounts: Array<CloudTagAccountCoverageJSON>;
}): ReactElement => {
  if (props.accounts.length === 0) {
    return <></>;
  }

  return (
    <Card title={ACCOUNTS_TITLE} description={ACCOUNTS_DESCRIPTION}>
      <ul
        className="divide-y divide-gray-100"
        data-testid="cloud-tags-accounts"
      >
        {props.accounts.map((account: CloudTagAccountCoverageJSON) => {
          return (
            <li
              key={account.cloudAccountId}
              className="grid grid-cols-1 gap-3 py-3 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1.2fr)] sm:items-center"
              data-testid="cloud-tags-account-row"
              data-account={account.cloudAccountId}
            >
              <div className="min-w-0">
                <AppLink
                  to={RouteUtil.populateRouteParams(
                    RouteMap[PageMap.CLOUD_ACCOUNT_VIEW_TAGS] as Route,
                    { modelId: new ObjectID(account.cloudAccountId) },
                  )}
                  className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
                >
                  <bdi>{account.name || account.accountId}</bdi>
                </AppLink>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <Pill
                    text={getCloudProviderLabel(account.provider)}
                    tone={PillTone.Neutral}
                    isDotHidden={true}
                    isUserContent={true}
                  />
                  <bdi className="font-mono text-xs text-gray-500">
                    {account.accountId}
                  </bdi>
                </div>
              </div>
              <CoverageBar
                label={TREND_SPEND_SERIES}
                count={account.spend?.all || null}
                notMeasured={getSpendNotMeasuredReason(account)}
                testId={`cloud-tags-account-spend-${account.cloudAccountId}`}
              />
              <CoverageBar
                label={TREND_RESOURCES_SERIES}
                count={
                  account.resources.all.total > 0 ? account.resources.all : null
                }
                testId={`cloud-tags-account-resources-${account.cloudAccountId}`}
              />
            </li>
          );
        })}
      </ul>
    </Card>
  );
};

// A week's share as the chart plots it: 0 to 100, or nothing.
function toPercentPoint(
  week: string,
  count: CloudTagCoverageCount | null,
): { x: Date; y: number } | null {
  const percent: number | null = getCloudTagCoveragePercent(count);

  return percent === null ? null : { x: fromCloudCostDay(week), y: percent };
}

// The trend's two lines, for the chart and its tests.
export function getCloudTagTrendSeries(data: {
  trend: Array<CloudTagTrendPointJSON>;
  spendName: string;
  resourcesName: string;
}): Array<SeriesPoint> {
  const spend: Array<{ x: Date; y: number }> = [];
  const resources: Array<{ x: Date; y: number }> = [];

  for (const point of data.trend) {
    const spendPoint: { x: Date; y: number } | null = toPercentPoint(
      point.week,
      point.spend,
    );
    const resourcesPoint: { x: Date; y: number } | null = toPercentPoint(
      point.week,
      point.resources,
    );

    if (spendPoint) {
      spend.push(spendPoint);
    }

    if (resourcesPoint) {
      resources.push(resourcesPoint);
    }
  }

  const series: Array<SeriesPoint> = [];

  if (spend.length > 0) {
    series.push({ seriesName: data.spendName, data: spend });
  }

  if (resources.length > 0) {
    series.push({ seriesName: data.resourcesName, data: resources });
  }

  return series;
}

// The share of spend and of resources carrying the required tags, each week.
export const CloudTagTrendCard: FunctionComponent<{
  trend: Array<CloudTagTrendPointJSON>;
}> = (props: { trend: Array<CloudTagTrendPointJSON> }): ReactElement => {
  const translator: Translator = useTranslator();
  const series: Array<SeriesPoint> = getCloudTagTrendSeries({
    trend: props.trend,
    spendName:
      translator.translateText(TREND_SPEND_SERIES) || TREND_SPEND_SERIES,
    resourcesName:
      translator.translateText(TREND_RESOURCES_SERIES) ||
      TREND_RESOURCES_SERIES,
  });
  const first: CloudTagTrendPointJSON | undefined = props.trend[0];
  const last: CloudTagTrendPointJSON | undefined =
    props.trend[props.trend.length - 1];

  const xAxis: XAxis | null =
    first && last
      ? {
          legend: "Week",
          options: {
            type: XAxisType.Date,
            min: fromCloudCostDay(first.week),
            max: new Date(
              fromCloudCostDay(last.week).getTime() +
                7 * 24 * 60 * 60 * 1000 -
                1000,
            ),
            aggregateType: XAxisAggregateType.Average,
            precision: XAxisPrecision.EVERY_WEEK,
          },
        }
      : null;

  const yAxis: YAxis = {
    legend: "%",
    options: {
      type: YAxisType.Number,
      min: 0,
      max: 100,
      formatter: (value: number): string => {
        return formatReaderFigure(value, { decimals: 0, isPercent: true });
      },
      precision: YAxisPrecision.NoDecimals,
    },
  };

  return (
    <Card title={TREND_TITLE} description={TREND_DESCRIPTION}>
      <div data-testid="cloud-tags-trend" data-series={series.length}>
        {series.length === 0 || !xAxis ? (
          <p
            className="text-sm text-gray-500"
            data-testid="cloud-tags-trend-empty"
          >
            {translator.translateText(TREND_EMPTY) || TREND_EMPTY}
          </p>
        ) : (
          <div style={{ height: `${TREND_CHART_HEIGHT_IN_PX}px` }}>
            <LineChartElement
              data={series}
              xAxis={xAxis}
              yAxis={yAxis}
              curve={ChartCurve.MONOTONE}
              heightInPx={TREND_CHART_HEIGHT_IN_PX}
              showLegend={true}
              sync={false}
              syncid="cloud-tags-trend"
              colors={TREND_COLORS}
              disableTimeRangeZoom={true}
            />
          </div>
        )}
      </div>
    </Card>
  );
};
