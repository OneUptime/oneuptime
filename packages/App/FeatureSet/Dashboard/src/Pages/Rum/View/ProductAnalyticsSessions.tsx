import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import IconProp from "Common/Types/Icon/IconProp";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import OneUptimeDate from "Common/Types/Date";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import Card from "Common/UI/Components/Card/Card";
import CardGrid from "Common/UI/Components/Card/CardGrid";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import FilterButtons from "Common/UI/Components/FilterButtons/FilterButtons";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import SeriesPoint from "Common/UI/Components/Charts/Types/SeriesPoints";
import Navigation from "Common/UI/Utils/Navigation";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import {
  PRODUCT_ANALYTICS_BREAKDOWN_LIMIT,
  PRODUCT_ANALYTICS_DIMENSIONS,
  PRODUCT_ANALYTICS_SESSION_LENGTH_BUCKETS,
  ProductAnalyticsBreakdownDto,
  ProductAnalyticsBreakdownRowDto,
  ProductAnalyticsDimension,
  ProductAnalyticsPeriodDto,
  ProductAnalyticsSessionLengthBucket,
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
  fetchProductAnalyticsBreakdown,
  fetchProductAnalyticsSummary,
  fetchProductAnalyticsTrend,
} from "../../../Components/ProductAnalytics/ProductAnalyticsApi";
import {
  PRODUCT_ANALYTICS_DIMENSION_LABELS,
  PRODUCT_ANALYTICS_SESSION_LENGTH_LABELS,
  describeProductAnalyticsChange,
  describeProductAnalyticsValue,
  formatProductAnalyticsAverage,
  formatProductAnalyticsCount,
  formatProductAnalyticsDuration,
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
import ProductAnalyticsBars, {
  ProductAnalyticsBarRow,
} from "../../../Components/ProductAnalytics/ProductAnalyticsBars";
import {
  ProductAnalyticsUrlState,
  buildProductAnalyticsUrl,
  readProductAnalyticsUrlState,
} from "../../../Components/ProductAnalytics/ProductAnalyticsUrlState";
import useProductAnalyticsRead, {
  ProductAnalyticsRead,
} from "../../../Components/ProductAnalytics/useProductAnalyticsRead";

/*
 * Product Analytics > Sessions (issue #6444): how people's sessions go.
 * How many there were and how many were signed in, how long they lasted
 * and how many pages they saw, how many hit an error or a frustration
 * signal; sessions by device day by day; how long they were; and users and
 * sessions by device, browser, operating system, country, app version,
 * entry page or page.
 */

type PeriodRead = (period: ProductAnalyticsPeriodDto) => number;

export function buildProductAnalyticsSessionTiles(data: {
  summary: ProductAnalyticsSummaryDto | null;
  isLoading: boolean;
  translator: Translator;
}): Array<ResourceOverviewTile> {
  const summary: ProductAnalyticsSummaryDto | null = data.summary;
  const translator: Translator = data.translator;
  const loading: boolean = data.isLoading && !summary;
  const change: (read: PeriodRead) => string | undefined = (
    read: PeriodRead,
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
  /* A share of no sessions says nothing: no line under the tile then. */
  const ofSessions: (part: number) => string | undefined = (
    part: number,
  ): string | undefined => {
    return summary && summary.current.sessions > 0
      ? translator.translateTemplate("{{percent}} of sessions", {
          percent: formatProductAnalyticsShare({
            part: part,
            whole: summary.current.sessions,
            language: translator.language,
          }),
        })
      : undefined;
  };
  const current: ProductAnalyticsPeriodDto | undefined = summary?.current;

  return [
    {
      title: "Sessions",
      value: current
        ? formatProductAnalyticsCount(current.sessions, translator)
        : "-",
      icon: IconProp.Window,
      iconColor: "blue",
      loading: loading,
      sublabel: change((period: ProductAnalyticsPeriodDto): number => {
        return period.sessions;
      }),
      description: "Recorded sessions that started in this range.",
    },
    {
      title: "Signed-in sessions",
      value: current
        ? formatProductAnalyticsCount(current.signedInSessions, translator)
        : "-",
      icon: IconProp.UserCircle,
      iconColor: "sky",
      loading: loading,
      sublabel: current ? ofSessions(current.signedInSessions) : undefined,
      description:
        "Sessions in which your app signed the user in with identify(): how often signed-in users came.",
    },
    {
      title: "Median session length",
      value: current
        ? formatProductAnalyticsDuration(
            current.medianSessionMs,
            translator.language,
          )
        : "-",
      icon: IconProp.Clock,
      iconColor: "violet",
      loading: loading,
      sublabel: change((period: ProductAnalyticsPeriodDto): number => {
        return period.medianSessionMs;
      }),
      description:
        "Half of the finished sessions were shorter than this, and half longer. Sessions still being recorded are left out.",
    },
    {
      title: "Pages per session",
      value: current
        ? formatProductAnalyticsAverage(
            current.averagePagesPerSession,
            translator.language,
          )
        : "-",
      icon: IconProp.DocumentDuplicate,
      iconColor: "emerald",
      loading: loading,
      sublabel: change((period: ProductAnalyticsPeriodDto): number => {
        return period.averagePagesPerSession;
      }),
      description: "How many different pages a session visited, on average.",
    },
    {
      title: "Sessions with errors",
      value: current
        ? formatProductAnalyticsCount(current.errorSessions, translator)
        : "-",
      icon: IconProp.Bug,
      iconColor: "rose",
      loading: loading,
      sublabel: current ? ofSessions(current.errorSessions) : undefined,
      description: "Sessions in which the page reported at least one error.",
    },
    {
      title: "Frustrated sessions",
      value: current
        ? formatProductAnalyticsCount(current.frustratedSessions, translator)
        : "-",
      icon: IconProp.FaceFrown,
      iconColor: "amber",
      loading: loading,
      sublabel: current ? ofSessions(current.frustratedSessions) : undefined,
      description:
        "Sessions with at least one frustration signal, such as rage clicks or dead clicks.",
    },
  ];
}

export function buildSessionLengthRows(data: {
  summary: ProductAnalyticsSummaryDto;
  translator: Translator;
}): Array<ProductAnalyticsBarRow> {
  const lengths: Array<number> = data.summary.current.sessionLengths;
  const finished: number = lengths.reduce(
    (sum: number, count: number): number => {
      return sum + count;
    },
    0,
  );

  return PRODUCT_ANALYTICS_SESSION_LENGTH_BUCKETS.map(
    (
      bucket: ProductAnalyticsSessionLengthBucket,
      index: number,
    ): ProductAnalyticsBarRow => {
      const count: number = lengths[index] || 0;
      const label: string =
        PRODUCT_ANALYTICS_SESSION_LENGTH_LABELS[bucket.key] || bucket.key;

      return {
        key: bucket.key,
        label: data.translator.translateText(label) || label,
        value: count,
        figures: [
          formatProductAnalyticsCount(count, data.translator),
          formatProductAnalyticsShare({
            part: count,
            whole: finished,
            language: data.translator.language,
          }),
        ],
      };
    },
  );
}

export function buildBreakdownRows(data: {
  breakdown: ProductAnalyticsBreakdownDto;
  translator: Translator;
}): Array<ProductAnalyticsBarRow> {
  return data.breakdown.rows.map(
    (row: ProductAnalyticsBreakdownRowDto): ProductAnalyticsBarRow => {
      return {
        key: row.value || "(none)",
        label: describeProductAnalyticsValue({
          dimension: data.breakdown.dimension,
          value: row.value,
          translator: data.translator,
        }),
        value: row.users,
        figures: [
          formatProductAnalyticsCount(row.users, data.translator),
          formatProductAnalyticsCount(row.sessions, data.translator),
          formatProductAnalyticsShare({
            part: row.sessions,
            whole: data.breakdown.totalSessions,
            language: data.translator.language,
          }),
        ],
      };
    },
  );
}

const RumApplicationProductAnalyticsSessions: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  /* Route is ":id/product-analytics-sessions": the id is one segment before the end. */
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
        dimension: state.dimension,
      }),
    );
  }, [state]);

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
      windowKey,
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

  const breakdown: ProductAnalyticsRead<ProductAnalyticsBreakdownDto> =
    useProductAnalyticsRead<ProductAnalyticsBreakdownDto>(
      `${windowKey}|${state.dimension}`,
      (): Promise<ProductAnalyticsBreakdownDto> => {
        return fetchProductAnalyticsBreakdown({
          rumApplicationId: modelId,
          startTime: period.startValue,
          endTime: period.endValue,
          dimension: state.dimension,
        });
      },
    );

  const tiles: Array<ResourceOverviewTile> = buildProductAnalyticsSessionTiles({
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
  /*
   * A session whose device reported no type is rare: its line is drawn
   * only in a range that has one, not as a line along zero in every chart.
   */
  const hasOtherDevices: boolean = days.some(
    (day: ProductAnalyticsTrendDayDto): boolean => {
      return day.otherSessions > 0;
    },
  );

  const deviceSeries: Array<SeriesPoint> = toProductAnalyticsSeries({
    days: days,
    timeZone: trendZone,
    series: [
      {
        seriesName: "Desktop",
        read: (day: ProductAnalyticsTrendDayDto): number => {
          return day.desktopSessions;
        },
      },
      {
        seriesName: "Mobile",
        read: (day: ProductAnalyticsTrendDayDto): number => {
          return day.mobileSessions;
        },
      },
      {
        seriesName: "Tablet",
        read: (day: ProductAnalyticsTrendDayDto): number => {
          return day.tabletSessions;
        },
      },
      ...(hasOtherDevices
        ? [
            {
              seriesName: "Other",
              read: (day: ProductAnalyticsTrendDayDto): number => {
                return day.otherSessions;
              },
            },
          ]
        : []),
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
      <div className="space-y-5" data-testid="product-analytics-sessions-page">
        <ProductAnalyticsCountingSince
          dataStartedAt={summary.data?.dataStartedAt ?? null}
          startTime={period.startValue}
        />
        <ProductAnalyticsTiles
          tiles={tiles}
          dataTestId="product-analytics-session-tiles"
        />
        {trend.error ? (
          <ErrorMessage message={trend.error} onRefreshClick={trend.reload} />
        ) : (
          <ChartCard
            title="Sessions by device"
            icon={IconProp.ComputerDesktop}
            iconColor="sky"
            series={deviceSeries}
            windowStart={chartWindow?.start ?? null}
            windowEnd={chartWindow?.end ?? null}
            syncId={`product-analytics-sessions-${modelId.toString()}`}
            showLegend={true}
            yAllowDecimals={false}
            xAxisPrecision={XAxisPrecision.EVERY_DAY}
            loading={trend.isLoading && !trend.data}
            description="Sessions that started each day, by the kind of device they came from. Days are in your time zone."
          />
        )}
      </div>
    );
  }

  const hasData: boolean = Boolean(summary.data) && !isEmpty && !summary.error;

  return (
    <Fragment>
      <Card
        title="Sessions"
        description="How people's sessions go: how many, how long, how many pages, and how many hit an error or a frustration, counted from the sessions Session Replay records."
        headerLayout="toolbar"
        buttons={[
          <ProductAnalyticsToolbar
            key="product-analytics-sessions-toolbar"
            dataTestId="product-analytics-sessions-toolbar"
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
      {hasData && summary.data ? (
        <CardGrid columns={2} dataTestId="product-analytics-sessions-cards">
          <Card
            title="Session length"
            description="Finished sessions by how long they lasted."
          >
            <ProductAnalyticsBars
              dataTestId="product-analytics-session-lengths"
              labelTitle={translationKey("Length")}
              figureTitles={[
                translationKey("Sessions"),
                translationKey("Percent"),
              ]}
              rows={buildSessionLengthRows({
                summary: summary.data,
                translator: translator,
              })}
            />
          </Card>
          <Card
            title="Breakdown"
            description="Users and sessions by what they came with and where they went, most users first."
          >
            <div
              className="space-y-4"
              data-testid="product-analytics-breakdown"
            >
              <FilterButtons
                className="flex-wrap"
                ariaLabel="Break down by"
                dataTestId="product-analytics-dimension"
                selectedValue={state.dimension}
                onSelect={(value: string): void => {
                  setState((previous: ProductAnalyticsUrlState) => {
                    return {
                      ...previous,
                      dimension: value as ProductAnalyticsDimension,
                    };
                  });
                }}
                options={PRODUCT_ANALYTICS_DIMENSIONS.map(
                  (
                    dimension: ProductAnalyticsDimension,
                  ): { label: string; value: string } => {
                    return {
                      label: PRODUCT_ANALYTICS_DIMENSION_LABELS[dimension],
                      value: dimension,
                    };
                  },
                )}
              />
              {breakdown.error ? (
                <ErrorMessage
                  message={breakdown.error}
                  onRefreshClick={breakdown.reload}
                />
              ) : breakdown.data &&
                breakdown.data.dimension === state.dimension ? (
                <div
                  className={
                    breakdown.isLoading ? "opacity-60 transition-opacity" : ""
                  }
                >
                  {breakdown.data.rows.length === 0 ? (
                    <p className="py-6 text-center text-sm text-gray-500">
                      {translator.translateText("No sessions in this range.")}
                    </p>
                  ) : (
                    <ProductAnalyticsBars
                      dataTestId="product-analytics-breakdown-bars"
                      labelTitle={
                        PRODUCT_ANALYTICS_DIMENSION_LABELS[state.dimension]
                      }
                      figureTitles={[
                        translationKey("Users"),
                        translationKey("Sessions"),
                        translationKey("Percent"),
                      ]}
                      rows={buildBreakdownRows({
                        breakdown: breakdown.data,
                        translator: translator,
                      })}
                    />
                  )}
                  {breakdown.data.hasMore ? (
                    <p
                      className="mt-3 text-xs text-gray-500"
                      data-testid="product-analytics-breakdown-more"
                    >
                      {translator.translateTemplate(
                        "The {{limit}} values with the most users. Less common ones are left out.",
                        {
                          limit: translator.formatNumber(
                            PRODUCT_ANALYTICS_BREAKDOWN_LIMIT,
                          ),
                        },
                      )}
                    </p>
                  ) : (
                    <></>
                  )}
                </div>
              ) : (
                <ComponentLoader />
              )}
            </div>
          </Card>
        </CardGrid>
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default RumApplicationProductAnalyticsSessions;
