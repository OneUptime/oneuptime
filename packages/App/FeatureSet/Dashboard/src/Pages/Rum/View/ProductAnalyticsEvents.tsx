import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import IconProp from "Common/Types/Icon/IconProp";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import OneUptimeDate from "Common/Types/Date";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import Card from "Common/UI/Components/Card/Card";
import Icon from "Common/UI/Components/Icon/Icon";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import SeriesPoint from "Common/UI/Components/Charts/Types/SeriesPoints";
import Navigation from "Common/UI/Utils/Navigation";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import {
  ProductAnalyticsEventBreakdownDto,
  ProductAnalyticsEventBreakdownRowDto,
  ProductAnalyticsEventNameDto,
  ProductAnalyticsEventNamesDto,
  ProductAnalyticsEventPropertiesDto,
  ProductAnalyticsEventRef,
  ProductAnalyticsEventTrendDayDto,
  ProductAnalyticsEventTrendDto,
  ProductAnalyticsFieldRef,
  ProductAnalyticsSegmentFilter,
} from "Common/Types/Rum/ProductAnalyticsEventReads";
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
  formatProductAnalyticsAverage,
  formatProductAnalyticsCount,
  formatProductAnalyticsShare,
  getProductAnalyticsCountedDays,
  getProductAnalyticsTimeZone,
  getProductAnalyticsTrendWindow,
  toProductAnalyticsSeries,
} from "../../../Components/ProductAnalytics/ProductAnalyticsFormat";
import {
  COUNTING_SINCE_EVENTS,
  ProductAnalyticsCountingSince,
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
import {
  ProductAnalyticsEventsUrlState,
  PRODUCT_ANALYTICS_PLAIN_FIELDS,
  addProductAnalyticsFilter,
  decodeProductAnalyticsEvent,
  decodeProductAnalyticsField,
  describeProductAnalyticsEvent,
  describeProductAnalyticsField,
  describeProductAnalyticsFieldValue,
  encodeProductAnalyticsEvent,
  encodeProductAnalyticsField,
  pickDefaultProductAnalyticsEvent,
  readProductAnalyticsEventsUrlState,
  writeProductAnalyticsEventsUrlState,
} from "../../../Components/ProductAnalytics/ProductAnalyticsEventsFormat";
import {
  fetchProductAnalyticsEventBreakdown,
  fetchProductAnalyticsEventNames,
  fetchProductAnalyticsEventProperties,
  fetchProductAnalyticsEventTrend,
  getProductAnalyticsBreakdownFields,
} from "../../../Components/ProductAnalytics/ProductAnalyticsEventsApi";
import ProductAnalyticsEventPicker from "../../../Components/ProductAnalytics/ProductAnalyticsEventPicker";
import ProductAnalyticsSegmentBar from "../../../Components/ProductAnalytics/ProductAnalyticsSegmentBar";
import {
  ProductAnalyticsEventsSwitchPanel,
  ProductAnalyticsEventsSwitchState,
  ProductAnalyticsMetricsNote,
  ProductAnalyticsNothingKept,
  useProductAnalyticsEventsSwitch,
} from "../../../Components/ProductAnalytics/ProductAnalyticsEventsGate";

/*
 * Product Analytics > Events (issue #6444, part two): what people do in the
 * application. Every event it sent in the range - each session's start,
 * each page viewed, each track() call by name - and, for the one picked,
 * how often it happened and how many people did it, day by day, broken
 * down by where it happened or by a property it carried, in a segment of
 * the events whose fields hold given values.
 */

export const SHOW_ONLY_TEMPLATE: string = translationKey("Show only {{value}}");
export const OPEN_EVENT_TEMPLATE: string = translationKey("Open {{value}}");

/*
 * All events lists this many, the most frequent first, until it is opened
 * whole: an application may send two hundred, a bar each.
 */
export const PRODUCT_ANALYTICS_EVENT_LIST_FOLDED_ROWS: number = 10;

export function buildProductAnalyticsEventTiles(data: {
  trend: ProductAnalyticsEventTrendDto | null;
  isLoading: boolean;
  translator: Translator;
}): Array<ResourceOverviewTile> {
  const trend: ProductAnalyticsEventTrendDto | null = data.trend;
  const loading: boolean = data.isLoading && !trend;
  const count: (value: number | undefined) => string = (
    value: number | undefined,
  ): string => {
    return trend
      ? formatProductAnalyticsCount(value || 0, data.translator)
      : "-";
  };

  return [
    {
      title: "Events",
      value: count(trend?.totalEvents),
      icon: IconProp.CursorArrowRays,
      iconColor: "blue",
      loading: loading,
      /* An average over nobody says nothing: no line under the tile then. */
      sublabel:
        trend && trend.totalUsers > 0
          ? data.translator.translateTemplate("{{average}} per user", {
              average: formatProductAnalyticsAverage(
                trend.totalEvents / trend.totalUsers,
                data.translator.language,
              ),
            })
          : undefined,
      description:
        "How many times it happened in this range, in this segment, and how many times each person who did it did it, on average.",
    },
    {
      title: "Users",
      value: count(trend?.totalUsers),
      icon: IconProp.UserGroup,
      iconColor: "emerald",
      loading: loading,
      description:
        "People who did it at least once: each signed-in user once, and each anonymous browser once.",
    },
    {
      title: "Sessions",
      value: count(trend?.totalSessions),
      icon: IconProp.PresentationChartLine,
      iconColor: "violet",
      loading: loading,
      description: "Sessions it happened in at least once.",
    },
  ];
}

export function buildProductAnalyticsEventListRows(data: {
  events: ReadonlyArray<ProductAnalyticsEventNameDto>;
  translator: Translator;
}): Array<ProductAnalyticsBarRow> {
  return data.events.map(
    (event: ProductAnalyticsEventNameDto): ProductAnalyticsBarRow => {
      return {
        key: encodeProductAnalyticsEvent(event),
        label: describeProductAnalyticsEvent(event, data.translator),
        value: event.events,
        figures: [
          formatProductAnalyticsCount(event.events, data.translator),
          formatProductAnalyticsCount(event.users, data.translator),
        ],
      };
    },
  );
}

export function buildProductAnalyticsBreakdownRows(data: {
  breakdown: ProductAnalyticsEventBreakdownDto;
  translator: Translator;
}): Array<ProductAnalyticsBarRow> {
  return data.breakdown.rows.map(
    (row: ProductAnalyticsEventBreakdownRowDto): ProductAnalyticsBarRow => {
      return {
        key: row.value,
        label: describeProductAnalyticsFieldValue({
          field: data.breakdown.field,
          value: row.value,
          translator: data.translator,
        }),
        value: row.events,
        figures: [
          formatProductAnalyticsCount(row.events, data.translator),
          formatProductAnalyticsCount(row.users, data.translator),
          formatProductAnalyticsShare({
            part: row.events,
            whole: data.breakdown.totalEvents,
            language: data.translator.language,
          }),
        ],
      };
    },
  );
}

const RumApplicationProductAnalyticsEvents: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  /* Route is ":id/product-analytics-events": the id is one segment before the end. */
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const [range, setRange] = useState<ProductAnalyticsUrlState>(
    (): ProductAnalyticsUrlState => {
      return readProductAnalyticsUrlState(window.location.search);
    },
  );
  const [state, setState] = useState<ProductAnalyticsEventsUrlState>(
    (): ProductAnalyticsEventsUrlState => {
      return readProductAnalyticsEventsUrlState(window.location.search);
    },
  );
  const [reloadToken, setReloadToken] = useState<number>(0);
  const [isEventListOpen, setIsEventListOpen] = useState<boolean>(false);
  const analytics: ProductAnalyticsEventsSwitchState =
    useProductAnalyticsEventsSwitch(modelId);

  useEffect((): void => {
    window.history.replaceState(
      window.history.state,
      "",
      writeProductAnalyticsEventsUrlState(
        buildProductAnalyticsUrl(window.location.href, {
          timeRange: range.timeRange,
        }),
        {
          event: state.event,
          filters: state.filters,
          breakdown: state.breakdown,
        },
      ),
    );
  }, [range.timeRange, state]);

  /* The window, fixed when the range is picked or refreshed, so "now" does not drift. */
  const period: InBetween<Date> = useMemo((): InBetween<Date> => {
    return RangeStartAndEndDateTimeUtil.getStartAndEndDate(range.timeRange);
  }, [range.timeRange, reloadToken]);

  const timeZone: string = getProductAnalyticsTimeZone(
    OneUptimeDate.getCurrentTimezone().toString(),
  );
  const windowKey: string = `${modelId.toString()}|${period.startValue.getTime()}|${period.endValue.getTime()}|${reloadToken}`;

  const names: ProductAnalyticsRead<ProductAnalyticsEventNamesDto> =
    useProductAnalyticsRead<ProductAnalyticsEventNamesDto>(
      windowKey,
      (): Promise<ProductAnalyticsEventNamesDto> => {
        return fetchProductAnalyticsEventNames({
          rumApplicationId: modelId,
          startTime: period.startValue,
          endTime: period.endValue,
        });
      },
    );

  const dataStartedAt: number | null = names.data?.dataStartedAt ?? null;
  /* Nothing kept at all: the page says why, and reads nothing more. */
  const isEmpty: boolean = Boolean(names.data && dataStartedAt === null);

  /* The event the address names, else the application's most frequent one. */
  const event: ProductAnalyticsEventRef | null = isEmpty
    ? null
    : state.event ||
      (names.data ? pickDefaultProductAnalyticsEvent(names.data.events) : null);
  const eventKey: string = event ? encodeProductAnalyticsEvent(event) : "";
  const filtersKey: string = JSON.stringify(state.filters);

  const properties: ProductAnalyticsRead<ProductAnalyticsEventPropertiesDto | null> =
    useProductAnalyticsRead<ProductAnalyticsEventPropertiesDto | null>(
      `${windowKey}|${eventKey}`,
      (): Promise<ProductAnalyticsEventPropertiesDto | null> => {
        return event
          ? fetchProductAnalyticsEventProperties({
              rumApplicationId: modelId,
              startTime: period.startValue,
              endTime: period.endValue,
              event: event,
            })
          : Promise.resolve(null);
      },
    );

  const trend: ProductAnalyticsRead<ProductAnalyticsEventTrendDto | null> =
    useProductAnalyticsRead<ProductAnalyticsEventTrendDto | null>(
      `${windowKey}|${eventKey}|${filtersKey}|${timeZone}`,
      (): Promise<ProductAnalyticsEventTrendDto | null> => {
        return event
          ? fetchProductAnalyticsEventTrend({
              rumApplicationId: modelId,
              startTime: period.startValue,
              endTime: period.endValue,
              event: event,
              filters: state.filters,
              timeZone: timeZone,
            })
          : Promise.resolve(null);
      },
    );

  const breakdown: ProductAnalyticsRead<ProductAnalyticsEventBreakdownDto | null> =
    useProductAnalyticsRead<ProductAnalyticsEventBreakdownDto | null>(
      `${windowKey}|${eventKey}|${filtersKey}|${encodeProductAnalyticsField(state.breakdown)}`,
      (): Promise<ProductAnalyticsEventBreakdownDto | null> => {
        return event
          ? fetchProductAnalyticsEventBreakdown({
              rumApplicationId: modelId,
              startTime: period.startValue,
              endTime: period.endValue,
              event: event,
              filters: state.filters,
              breakdown: state.breakdown,
            })
          : Promise.resolve(null);
      },
    );

  const refresh: () => void = (): void => {
    setReloadToken((token: number): number => {
      return token + 1;
    });
  };

  const setFilters: (filters: Array<ProductAnalyticsSegmentFilter>) => void = (
    filters: Array<ProductAnalyticsSegmentFilter>,
  ): void => {
    setState((previous: ProductAnalyticsEventsUrlState) => {
      return { ...previous, filters: filters };
    });
  };

  const trendZone: string = trend.data?.timeZone || timeZone;
  const days: Array<ProductAnalyticsEventTrendDayDto> =
    getProductAnalyticsCountedDays<ProductAnalyticsEventTrendDayDto>({
      days: trend.data?.days || [],
      dataStartedAt: dataStartedAt,
      timeZone: trendZone,
    });
  const chartWindow: { start: Date; end: Date } | null =
    getProductAnalyticsTrendWindow<ProductAnalyticsEventTrendDayDto>({
      days: days,
      timeZone: trendZone,
    });
  const series: Array<SeriesPoint> =
    toProductAnalyticsSeries<ProductAnalyticsEventTrendDayDto>({
      days: days,
      timeZone: trendZone,
      series: [
        {
          seriesName: "Events",
          read: (day: ProductAnalyticsEventTrendDayDto): number => {
            return day.events;
          },
        },
        {
          seriesName: "Users",
          read: (day: ProductAnalyticsEventTrendDayDto): number => {
            return day.users;
          },
        },
      ],
    });

  const breakdownFields: Array<ProductAnalyticsFieldRef> =
    getProductAnalyticsBreakdownFields(
      properties.data ?? null,
      PRODUCT_ANALYTICS_PLAIN_FIELDS,
    );
  const breakdownOptions: Array<DropdownOption> = breakdownFields.map(
    (ref: ProductAnalyticsFieldRef): DropdownOption => {
      return {
        value: encodeProductAnalyticsField(ref),
        label: describeProductAnalyticsField(ref, translator),
        isUserContent: true,
        isInPageDirection: true,
      };
    },
  );
  /* A property the address names that this event never carried stays pickable. */
  if (
    !breakdownOptions.some((option: DropdownOption): boolean => {
      return option.value === encodeProductAnalyticsField(state.breakdown);
    })
  ) {
    breakdownOptions.push({
      value: encodeProductAnalyticsField(state.breakdown),
      label: describeProductAnalyticsField(state.breakdown, translator),
      isUserContent: true,
      isInPageDirection: true,
    });
  }

  /* Until the names arrive there is no event to read: the page waits with them. */
  const isWaitingForNames: boolean = names.isLoading && !names.data;

  let body: ReactElement;

  if (names.error) {
    body = <ErrorMessage message={names.error} onRefreshClick={refresh} />;
  } else if (isEmpty) {
    body = (
      <ProductAnalyticsNothingKept
        rumApplicationId={modelId}
        analytics={analytics}
      />
    );
  } else {
    body = (
      <div className="space-y-5" data-testid="product-analytics-events-page">
        <ProductAnalyticsEventsSwitchPanel
          rumApplicationId={modelId}
          analytics={analytics}
        />
        <ProductAnalyticsCountingSince
          dataStartedAt={dataStartedAt}
          startTime={period.startValue}
          template={COUNTING_SINCE_EVENTS}
        />
        <div className="flex flex-col gap-3">
          <div className="w-full max-w-md space-y-1">
            <span className="block text-xs font-medium text-gray-500">
              {translator.translateText("Event")}
            </span>
            <ProductAnalyticsEventPicker
              events={names.data?.events || []}
              value={event}
              ariaLabel="Event"
              isLoading={isWaitingForNames}
              dataTestId="product-analytics-event-picker"
              onChange={(picked: ProductAnalyticsEventRef): void => {
                setState((previous: ProductAnalyticsEventsUrlState) => {
                  return { ...previous, event: picked };
                });
              }}
            />
          </div>
          <ProductAnalyticsSegmentBar
            filters={state.filters}
            properties={properties.data ?? null}
            onChange={setFilters}
            dataTestId="product-analytics-event-segment"
          />
        </div>
        {trend.error ? (
          <ErrorMessage message={trend.error} onRefreshClick={trend.reload} />
        ) : (
          <Fragment>
            <ProductAnalyticsTiles
              tiles={buildProductAnalyticsEventTiles({
                trend: trend.data,
                isLoading: trend.isLoading || isWaitingForNames,
                translator: translator,
              })}
              dataTestId="product-analytics-event-tiles"
            />
            <ChartCard
              title="Events and users"
              icon={IconProp.CursorArrowRays}
              iconColor="blue"
              series={series}
              windowStart={chartWindow?.start ?? null}
              windowEnd={chartWindow?.end ?? null}
              syncId={`product-analytics-events-${modelId.toString()}`}
              showLegend={true}
              yAllowDecimals={false}
              xAxisPrecision={XAxisPrecision.EVERY_DAY}
              loading={(trend.isLoading || isWaitingForNames) && !trend.data}
              description="Each day's count of the event, and of the people who did it that day. Days are in your time zone."
            />
          </Fragment>
        )}
        <div
          className="space-y-3"
          data-testid="product-analytics-event-breakdown"
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h3 className="text-sm font-medium text-gray-900">
              {translator.translateText("Breakdown")}
            </h3>
            <div className="w-full sm:w-64">
              <Dropdown
                options={breakdownOptions}
                value={breakdownOptions.find(
                  (option: DropdownOption): boolean => {
                    return (
                      option.value ===
                      encodeProductAnalyticsField(state.breakdown)
                    );
                  },
                )}
                isClearable={false}
                ariaLabel="Break down by"
                dataTestId="product-analytics-event-breakdown-field"
                onChange={(
                  value: DropdownValue | Array<DropdownValue> | null,
                ): void => {
                  const ref: ProductAnalyticsFieldRef | null =
                    typeof value === "string"
                      ? decodeProductAnalyticsField(value)
                      : null;

                  if (ref) {
                    setState((previous: ProductAnalyticsEventsUrlState) => {
                      return { ...previous, breakdown: ref };
                    });
                  }
                }}
              />
            </div>
          </div>
          {breakdown.error ? (
            <ErrorMessage
              message={breakdown.error}
              onRefreshClick={breakdown.reload}
            />
          ) : breakdown.data && breakdown.data.rows.length === 0 ? (
            <p className="text-sm text-gray-500">
              {translator.translateText(
                "Nothing to break down: the event did not happen in this range and segment.",
              )}
            </p>
          ) : !breakdown.data ? (
            /* Read for the first time: rows to come, not an empty table. */
            <div
              className="space-y-4 pt-1"
              data-testid="product-analytics-event-breakdown-loading"
              aria-hidden="true"
            >
              {[0, 1, 2].map((row: number): ReactElement => {
                return (
                  <div key={row} className="space-y-2">
                    <div className="h-3 w-40 animate-pulse rounded bg-gray-100" />
                    <div className="h-1.5 w-full animate-pulse rounded-full bg-gray-100" />
                  </div>
                );
              })}
            </div>
          ) : (
            <div
              className={
                breakdown.isLoading ? "opacity-60 transition-opacity" : ""
              }
            >
              <ProductAnalyticsBars
                rows={
                  breakdown.data
                    ? buildProductAnalyticsBreakdownRows({
                        breakdown: breakdown.data,
                        translator: translator,
                      })
                    : []
                }
                labelTitle={describeProductAnalyticsField(
                  state.breakdown,
                  translator,
                )}
                figureTitles={[
                  translationKey("Events"),
                  translationKey("Users"),
                  translationKey("Percent"),
                ]}
                onSelect={(value: string): void => {
                  setFilters(
                    addProductAnalyticsFilter(state.filters, {
                      field: state.breakdown.field,
                      key: state.breakdown.key,
                      value: value,
                    }),
                  );
                }}
                selectTemplate={SHOW_ONLY_TEMPLATE}
                dataTestId="product-analytics-event-breakdown-bars"
              />
              {breakdown.data?.hasMore ? (
                <p className="mt-2 text-xs text-gray-500">
                  {translator.translateText(
                    "Only the most frequent values are listed.",
                  )}
                </p>
              ) : (
                <></>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <Fragment>
      <Card
        title="Events"
        description="What people do in this application: each session's start, each page viewed and each event your app sends with track(), from every session, recorded or not."
        headerLayout="toolbar"
        buttons={[
          <ProductAnalyticsToolbar
            key="product-analytics-events-toolbar"
            dataTestId="product-analytics-events-toolbar"
            timeRange={range.timeRange}
            onTimeRangeChange={(timeRange: RangeStartAndEndDateTime): void => {
              setRange((previous: ProductAnalyticsUrlState) => {
                return { ...previous, timeRange: timeRange };
              });
            }}
            onRefresh={refresh}
          />,
        ]}
      >
        {body}
      </Card>
      {names.error || isEmpty || !names.data ? (
        <></>
      ) : (
        <div className="mt-5">
          <Card
            title="All events"
            description="Every event in this range, the most frequent first. Open one to see it above."
          >
            <div data-testid="product-analytics-event-list">
              <ProductAnalyticsBars
                rows={buildProductAnalyticsEventListRows({
                  events: isEventListOpen
                    ? names.data.events
                    : names.data.events.slice(
                        0,
                        PRODUCT_ANALYTICS_EVENT_LIST_FOLDED_ROWS,
                      ),
                  translator: translator,
                })}
                labelTitle={translationKey("Event")}
                figureTitles={[
                  translationKey("Events"),
                  translationKey("Users"),
                ]}
                selectedKey={eventKey}
                selectTemplate={OPEN_EVENT_TEMPLATE}
                onSelect={(key: string): void => {
                  const picked: ProductAnalyticsEventRef | null =
                    decodeProductAnalyticsEvent(key);

                  if (picked) {
                    setState((previous: ProductAnalyticsEventsUrlState) => {
                      return { ...previous, event: picked };
                    });
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }
                }}
                dataTestId="product-analytics-event-list-bars"
              />
              {names.data.events.length >
              PRODUCT_ANALYTICS_EVENT_LIST_FOLDED_ROWS ? (
                <button
                  type="button"
                  className="mt-3 inline-flex items-center gap-1 rounded text-sm font-medium text-indigo-600 hover:text-indigo-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                  aria-expanded={isEventListOpen}
                  data-testid="product-analytics-event-list-toggle"
                  onClick={(): void => {
                    setIsEventListOpen(!isEventListOpen);
                  }}
                >
                  <Icon
                    icon={
                      isEventListOpen
                        ? IconProp.ChevronUp
                        : IconProp.ChevronDown
                    }
                    className="h-4 w-4"
                  />
                  {isEventListOpen
                    ? translator.translateText("Show fewer")
                    : translator.translatePlural(
                        {
                          one: "Show {{count}} more",
                          other: "Show {{count}} more",
                        },
                        names.data.events.length -
                          PRODUCT_ANALYTICS_EVENT_LIST_FOLDED_ROWS,
                      )}
                </button>
              ) : (
                <></>
              )}
              {/* Said under the whole list: folded, its toggle says what is left. */}
              {names.data.hasMore &&
              (isEventListOpen ||
                names.data.events.length <=
                  PRODUCT_ANALYTICS_EVENT_LIST_FOLDED_ROWS) ? (
                <p className="mt-2 text-xs text-gray-500">
                  {translator.translateText(
                    "Only the most frequent events are listed.",
                  )}
                </p>
              ) : (
                <></>
              )}
              <ProductAnalyticsMetricsNote rumApplicationId={modelId} />
            </div>
          </Card>
        </div>
      )}
    </Fragment>
  );
};

export default RumApplicationProductAnalyticsEvents;
