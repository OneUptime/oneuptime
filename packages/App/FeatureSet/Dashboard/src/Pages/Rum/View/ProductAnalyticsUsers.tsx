import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import IconProp from "Common/Types/Icon/IconProp";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import OneUptimeDate from "Common/Types/Date";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import SeriesPoint from "Common/UI/Components/Charts/Types/SeriesPoints";
import Navigation from "Common/UI/Utils/Navigation";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import {
  ProductAnalyticsPeopleFilter,
  ProductAnalyticsSummaryDto,
  ProductAnalyticsTrendDayDto,
  ProductAnalyticsTrendDto,
} from "Common/Types/Rum/ProductAnalytics";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import ChartCard from "../../../Components/TelemetryResource/ChartCard";
import XAxisPrecision from "Common/UI/Components/Charts/Types/XAxis/XAxisPrecision";
import { ResourceOverviewTile } from "../../../Components/TelemetryResource/ResourceOverview";
import {
  fetchProductAnalyticsSummary,
  fetchProductAnalyticsTrend,
} from "../../../Components/ProductAnalytics/ProductAnalyticsApi";
import {
  describeProductAnalyticsChange,
  formatProductAnalyticsCount,
  formatProductAnalyticsShare,
  getProductAnalyticsCountedDays,
  getProductAnalyticsTimeZone,
  getProductAnalyticsTrendWindow,
  isProductAnalyticsPreviousPeriodCounted,
  toProductAnalyticsSeries,
} from "../../../Components/ProductAnalytics/ProductAnalyticsFormat";
import {
  ProductAnalyticsCountingSince,
  ProductAnalyticsNothingYet,
  ProductAnalyticsTiles,
  ProductAnalyticsToolbar,
} from "../../../Components/ProductAnalytics/ProductAnalyticsFrame";
import ProductAnalyticsPeopleCard from "../../../Components/ProductAnalytics/ProductAnalyticsPeopleCard";
import {
  ProductAnalyticsUrlState,
  buildProductAnalyticsSearch,
  buildProductAnalyticsUrl,
  readProductAnalyticsUrlState,
} from "../../../Components/ProductAnalytics/ProductAnalyticsUrlState";
import useProductAnalyticsRead, {
  ProductAnalyticsRead,
} from "../../../Components/ProductAnalytics/useProductAnalyticsRead";

/*
 * Product Analytics > Users (issue #6444): who uses this application. How
 * many people came in the range - signed in or anonymous, new or returning
 * - against the range before it; everyone the last 13 months hold, and how
 * many of them have not come back lately; daily, weekly and monthly active
 * users day by day; and the people themselves.
 *
 * A person is a signed-in user (identify()) or, until they sign in, the
 * browser they came from. The numbers come from the sessions Session Replay
 * records, kept apart from the recordings for 13 months.
 */

export function buildProductAnalyticsUserTiles(data: {
  summary: ProductAnalyticsSummaryDto | null;
  isLoading: boolean;
  translator: Translator;
}): Array<ResourceOverviewTile> {
  const summary: ProductAnalyticsSummaryDto | null = data.summary;
  const translator: Translator = data.translator;
  const loading: boolean = data.isLoading && !summary;
  const count: (value: number | undefined) => string = (
    value: number | undefined,
  ): string => {
    return summary ? formatProductAnalyticsCount(value || 0, translator) : "-";
  };
  const change: (
    read: (period: ProductAnalyticsSummaryDto["current"]) => number,
  ) => string | undefined = (
    read: (period: ProductAnalyticsSummaryDto["current"]) => number,
  ): string | undefined => {
    return summary
      ? describeProductAnalyticsChange({
          current: read(summary.current),
          previous: read(summary.previous),
          translator: translator,
          isPreviousPeriodCounted:
            isProductAnalyticsPreviousPeriodCounted(summary),
        })
      : undefined;
  };

  return [
    {
      title: "Active users",
      value: count(summary?.current.activeUsers),
      icon: IconProp.UserGroup,
      iconColor: "blue",
      loading: loading,
      sublabel: change((period: ProductAnalyticsSummaryDto["current"]) => {
        return period.activeUsers;
      }),
      description:
        "People who used the app in this range: each signed-in user once, and each anonymous browser once.",
    },
    {
      title: "New users",
      value: count(summary?.current.newUsers),
      icon: IconProp.UserPlus,
      iconColor: "emerald",
      loading: loading,
      sublabel: change((period: ProductAnalyticsSummaryDto["current"]) => {
        return period.newUsers;
      }),
      description: "Active users whose first visit was in this range.",
    },
    {
      title: "Returning users",
      value: count(summary?.current.returningUsers),
      icon: IconProp.Refresh,
      iconColor: "violet",
      loading: loading,
      sublabel: change((period: ProductAnalyticsSummaryDto["current"]) => {
        return period.returningUsers;
      }),
      description: "Active users who had come before this range began.",
    },
    {
      title: "Signed-in users",
      value: count(summary?.current.signedInUsers),
      icon: IconProp.UserCircle,
      iconColor: "sky",
      loading: loading,
      /* A share of nobody says nothing: no line under the tile then. */
      sublabel:
        summary && summary.current.activeUsers > 0
          ? translator.translateTemplate("{{percent}} of active users", {
              percent: formatProductAnalyticsShare({
                part: summary.current.signedInUsers,
                whole: summary.current.activeUsers,
                language: translator.language,
              }),
            })
          : undefined,
      description:
        "Active users your app signed in with identify(), each counted once however many devices they used. The rest are anonymous visitors.",
    },
    {
      title: "Total users",
      value: count(summary?.totalUsers),
      icon: IconProp.User,
      iconColor: "slate",
      loading: loading,
      sublabel: "In the last 13 months",
      description:
        "Everyone this application has seen in the last 13 months, the time these numbers are kept.",
    },
    {
      title: "Dormant users",
      value: count(summary?.dormantUsers),
      icon: IconProp.UserMinus,
      iconColor: "amber",
      loading: loading,
      sublabel: summary
        ? translator.translatePlural(
            {
              one: "Not seen for {{count}} day",
              other: "Not seen for {{count}} days",
            },
            summary.dormantAfterDays,
          )
        : undefined,
      description:
        "People who came before but have not come back lately. Choose how long counts as lately with the Dormant users filter under People.",
    },
  ];
}

const RumApplicationProductAnalyticsUsers: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  /* Route is ":id/product-analytics-users": the id is one segment before the end. */
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const [state, setState] = useState<ProductAnalyticsUrlState>(
    (): ProductAnalyticsUrlState => {
      return readProductAnalyticsUrlState(window.location.search);
    },
  );
  const [reloadToken, setReloadToken] = useState<number>(0);

  useEffect((): void => {
    window.history.replaceState(
      window.history.state,
      "",
      buildProductAnalyticsUrl(window.location.href, {
        timeRange: state.timeRange,
        filter: state.filter,
        dormantAfterDays: state.dormantAfterDays,
      }),
    );
  }, [state]);

  /* The window, fixed when the range is picked or refreshed, so "now" does not drift. */
  const period: InBetween<Date> = useMemo((): InBetween<Date> => {
    return RangeStartAndEndDateTimeUtil.getStartAndEndDate(state.timeRange);
  }, [state.timeRange, reloadToken]);

  const timeZone: string = getProductAnalyticsTimeZone(
    OneUptimeDate.getCurrentTimezone().toString(),
  );
  /*
   * Refresh is in the key, so it reads again even when the window did not
   * move (a custom range is the same window however often it is computed).
   */
  const windowKey: string = `${modelId.toString()}|${period.startValue.getTime()}|${period.endValue.getTime()}|${reloadToken}`;

  const summary: ProductAnalyticsRead<ProductAnalyticsSummaryDto> =
    useProductAnalyticsRead<ProductAnalyticsSummaryDto>(
      `${windowKey}|${state.dormantAfterDays}`,
      (): Promise<ProductAnalyticsSummaryDto> => {
        return fetchProductAnalyticsSummary({
          rumApplicationId: modelId,
          startTime: period.startValue,
          endTime: period.endValue,
          dormantAfterDays: state.dormantAfterDays,
        });
      },
    );

  const trend: ProductAnalyticsRead<ProductAnalyticsTrendDto> =
    useProductAnalyticsRead<ProductAnalyticsTrendDto>(
      `${windowKey}|${timeZone}`,
      (): Promise<ProductAnalyticsTrendDto> => {
        return fetchProductAnalyticsTrend({
          rumApplicationId: modelId,
          startTime: period.startValue,
          endTime: period.endValue,
          timeZone: timeZone,
        });
      },
    );

  const tiles: Array<ResourceOverviewTile> = buildProductAnalyticsUserTiles({
    summary: summary.data,
    isLoading: summary.isLoading,
    translator: translator,
  });

  const trendZone: string = trend.data?.timeZone || timeZone;
  const days: Array<ProductAnalyticsTrendDayDto> =
    getProductAnalyticsCountedDays({
      days: trend.data?.days || [],
      dataStartedAt: summary.data?.dataStartedAt ?? null,
      timeZone: trendZone,
    });
  const chartWindow: { start: Date; end: Date } | null =
    getProductAnalyticsTrendWindow({ days: days, timeZone: trendZone });

  const activeSeries: Array<SeriesPoint> = toProductAnalyticsSeries({
    days: days,
    timeZone: trendZone,
    series: [
      {
        seriesName: "Daily active users",
        read: (day: ProductAnalyticsTrendDayDto): number => {
          return day.activeUsers;
        },
      },
      {
        seriesName: "Weekly active users",
        read: (day: ProductAnalyticsTrendDayDto): number => {
          return day.weeklyActiveUsers;
        },
      },
      {
        seriesName: "Monthly active users",
        read: (day: ProductAnalyticsTrendDayDto): number => {
          return day.monthlyActiveUsers;
        },
      },
    ],
  });

  const newSeries: Array<SeriesPoint> = toProductAnalyticsSeries({
    days: days,
    timeZone: trendZone,
    series: [
      {
        seriesName: "New users",
        read: (day: ProductAnalyticsTrendDayDto): number => {
          return day.newUsers;
        },
      },
      {
        seriesName: "Returning users",
        read: (day: ProductAnalyticsTrendDayDto): number => {
          return day.returningUsers;
        },
      },
    ],
  });

  const refresh: () => void = (): void => {
    setReloadToken((token: number): number => {
      return token + 1;
    });
  };

  const isEmpty: boolean = Boolean(
    summary.data && summary.data.dataStartedAt === null,
  );

  let body: ReactElement;

  if (summary.error) {
    body = <ErrorMessage message={summary.error} onRefreshClick={refresh} />;
  } else if (isEmpty) {
    body = <ProductAnalyticsNothingYet rumApplicationId={modelId} />;
  } else {
    body = (
      <div className="space-y-5" data-testid="product-analytics-users-page">
        <ProductAnalyticsCountingSince
          dataStartedAt={summary.data?.dataStartedAt ?? null}
          startTime={period.startValue}
        />
        <ProductAnalyticsTiles
          tiles={tiles}
          dataTestId="product-analytics-user-tiles"
        />
        {trend.error ? (
          <ErrorMessage message={trend.error} onRefreshClick={trend.reload} />
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ChartCard
              title="Active users"
              icon={IconProp.UserGroup}
              iconColor="blue"
              series={activeSeries}
              windowStart={chartWindow?.start ?? null}
              windowEnd={chartWindow?.end ?? null}
              syncId={`product-analytics-users-${modelId.toString()}`}
              showLegend={true}
              yAllowDecimals={false}
              xAxisPrecision={XAxisPrecision.EVERY_DAY}
              loading={trend.isLoading && !trend.data}
              description="Each day's count of people who came that day, in the 7 days ending that day, and in the 30 days ending that day. Days are in your time zone."
            />
            <ChartCard
              title="New and returning users"
              icon={IconProp.UserPlus}
              iconColor="emerald"
              series={newSeries}
              windowStart={chartWindow?.start ?? null}
              windowEnd={chartWindow?.end ?? null}
              syncId={`product-analytics-users-${modelId.toString()}`}
              showLegend={true}
              yAllowDecimals={false}
              xAxisPrecision={XAxisPrecision.EVERY_DAY}
              loading={trend.isLoading && !trend.data}
              description="People who came each day: those on their first visit, and those who had come before."
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <Fragment>
      <Card
        title="Users"
        description="Who uses this application: active, new, returning, signed-in and dormant users, counted from the sessions Session Replay records."
        headerLayout="toolbar"
        buttons={[
          <ProductAnalyticsToolbar
            key="product-analytics-users-toolbar"
            dataTestId="product-analytics-users-toolbar"
            timeRange={state.timeRange}
            onTimeRangeChange={(timeRange: RangeStartAndEndDateTime): void => {
              setState((previous: ProductAnalyticsUrlState) => {
                return { ...previous, timeRange: timeRange };
              });
            }}
            onRefresh={refresh}
          />,
        ]}
      >
        {body}
      </Card>
      {summary.error || isEmpty ? (
        <></>
      ) : (
        <div className="mt-5">
          <ProductAnalyticsPeopleCard
            rumApplicationId={modelId}
            startTime={period.startValue}
            endTime={period.endValue}
            filter={state.filter}
            dormantAfterDays={state.dormantAfterDays}
            reloadToken={reloadToken}
            linkSearch={buildProductAnalyticsSearch({
              timeRange: state.timeRange,
              filter: state.filter,
              dormantAfterDays: state.dormantAfterDays,
            })}
            onFilterChange={(filter: ProductAnalyticsPeopleFilter): void => {
              setState((previous: ProductAnalyticsUrlState) => {
                return { ...previous, filter: filter };
              });
            }}
            onDormantAfterDaysChange={(days: number): void => {
              setState((previous: ProductAnalyticsUrlState) => {
                return { ...previous, dormantAfterDays: days };
              });
            }}
          />
        </div>
      )}
    </Fragment>
  );
};

export default RumApplicationProductAnalyticsUsers;
