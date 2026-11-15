import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import OneUptimeDate from "Common/Types/Date";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import {
  ProductAnalyticsRetentionDefinition,
  ProductAnalyticsSavedViewType,
} from "Common/Types/Rum/ProductAnalyticsSavedViews";
import Card from "Common/UI/Components/Card/Card";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Navigation from "Common/UI/Utils/Navigation";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import {
  PRODUCT_ANALYTICS_RETENTION_PERIODS,
  ProductAnalyticsEventNamesDto,
  ProductAnalyticsEventPropertiesDto,
  ProductAnalyticsEventRef,
  ProductAnalyticsRetentionDto,
  ProductAnalyticsRetentionPeriod,
  ProductAnalyticsSegmentFilter,
} from "Common/Types/Rum/ProductAnalyticsEventReads";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  COUNTING_SINCE_EVENTS,
  ProductAnalyticsCountingSince,
  ProductAnalyticsToolbar,
} from "../../../Components/ProductAnalytics/ProductAnalyticsFrame";
import { getProductAnalyticsTimeZone } from "../../../Components/ProductAnalytics/ProductAnalyticsFormat";
import {
  ProductAnalyticsUrlState,
  buildProductAnalyticsUrl,
  readProductAnalyticsUrlState,
} from "../../../Components/ProductAnalytics/ProductAnalyticsUrlState";
import useProductAnalyticsRead, {
  ProductAnalyticsRead,
} from "../../../Components/ProductAnalytics/useProductAnalyticsRead";
import {
  PRODUCT_ANALYTICS_RETENTION_PERIOD_LABELS,
  ProductAnalyticsEventsUrlState,
  encodeProductAnalyticsEvent,
  fitProductAnalyticsRetentionPeriod,
  readProductAnalyticsEventsUrlState,
  writeProductAnalyticsEventsUrlState,
} from "../../../Components/ProductAnalytics/ProductAnalyticsEventsFormat";
import {
  fetchProductAnalyticsEventNames,
  fetchProductAnalyticsEventProperties,
  fetchProductAnalyticsRetention,
} from "../../../Components/ProductAnalytics/ProductAnalyticsEventsApi";
import ProductAnalyticsEventPicker from "../../../Components/ProductAnalytics/ProductAnalyticsEventPicker";
import ProductAnalyticsSegmentBar from "../../../Components/ProductAnalytics/ProductAnalyticsSegmentBar";
import ProductAnalyticsRetentionTable from "../../../Components/ProductAnalytics/ProductAnalyticsRetentionTable";
import {
  ProductAnalyticsEventsSwitchPanel,
  ProductAnalyticsEventsSwitchState,
  ProductAnalyticsNothingKept,
  useProductAnalyticsEventsSwitch,
} from "../../../Components/ProductAnalytics/ProductAnalyticsEventsGate";
import {
  ProductAnalyticsSavedView,
  applyProductAnalyticsRetentionDefinition,
  toProductAnalyticsRetentionDefinition,
  writeProductAnalyticsSavedViewId,
} from "../../../Components/ProductAnalytics/ProductAnalyticsSavedViews";
import ProductAnalyticsSavedViewsMenu, {
  ProductAnalyticsSavedViewNotice,
  ProductAnalyticsSavedViewState,
  useProductAnalyticsSavedViewState,
} from "../../../Components/ProductAnalytics/ProductAnalyticsSavedViewsMenu";
import { toProductAnalyticsPersonProperties } from "./ProductAnalyticsFunnels";

/*
 * Product Analytics > Retention (issue #6444, part two): the people who
 * first did a start event in each day, week or month of the range, and how
 * many of them did a return event in each period after - whether people
 * come back, and when they stop. A retention table is saved under a name
 * from the toolbar, to open again here or show on a dashboard (issue
 * #6630).
 */

const RumApplicationProductAnalyticsRetention: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  /* Route is ":id/product-analytics-retention": the id is one segment before the end. */
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
  const analytics: ProductAnalyticsEventsSwitchState =
    useProductAnalyticsEventsSwitch(modelId);
  const saved: ProductAnalyticsSavedViewState =
    useProductAnalyticsSavedViewState(ProductAnalyticsSavedViewType.Retention);

  useEffect((): void => {
    window.history.replaceState(
      window.history.state,
      "",
      writeProductAnalyticsSavedViewId(
        writeProductAnalyticsEventsUrlState(
          buildProductAnalyticsUrl(window.location.href, {
            timeRange: range.timeRange,
          }),
          {
            startEvent: state.startEvent,
            returnEvent: state.returnEvent,
            period: state.period,
            filters: state.filters,
          },
        ),
        saved.savedViewId,
      ),
    );
  }, [range.timeRange, state, saved.savedViewId]);

  /* The window, fixed when the range is picked or refreshed, so "now" does not drift. */
  const period: InBetween<Date> = useMemo((): InBetween<Date> => {
    return RangeStartAndEndDateTimeUtil.getStartAndEndDate(range.timeRange);
  }, [range.timeRange, reloadToken]);

  const timeZone: string = getProductAnalyticsTimeZone(
    OneUptimeDate.getCurrentTimezone().toString(),
  );
  const windowKey: string = `${modelId.toString()}|${period.startValue.getTime()}|${period.endValue.getTime()}|${reloadToken}`;

  /* A period the range is too long for reads as the next longer one. */
  const retentionPeriod: ProductAnalyticsRetentionPeriod =
    fitProductAnalyticsRetentionPeriod({
      period: state.period,
      startTime: period.startValue,
      endTime: period.endValue,
      timeZone: timeZone,
    });

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

  /*
   * Nothing is read for the table while a saved one the address named is
   * being opened: its events, not the default's, are the ones to read.
   */
  const isOpening: boolean = saved.isOpening;

  const properties: ProductAnalyticsRead<ProductAnalyticsEventPropertiesDto | null> =
    useProductAnalyticsRead<ProductAnalyticsEventPropertiesDto | null>(
      isOpening
        ? `${windowKey}|opening`
        : `${windowKey}|${encodeProductAnalyticsEvent(state.startEvent)}`,
      (): Promise<ProductAnalyticsEventPropertiesDto | null> => {
        return isOpening
          ? Promise.resolve(null)
          : fetchProductAnalyticsEventProperties({
              rumApplicationId: modelId,
              startTime: period.startValue,
              endTime: period.endValue,
              event: state.startEvent,
            });
      },
    );

  const retention: ProductAnalyticsRead<ProductAnalyticsRetentionDto | null> =
    useProductAnalyticsRead<ProductAnalyticsRetentionDto | null>(
      isOpening
        ? `${windowKey}|opening`
        : `${windowKey}|${encodeProductAnalyticsEvent(state.startEvent)}|${encodeProductAnalyticsEvent(state.returnEvent)}|${retentionPeriod}|${JSON.stringify(state.filters)}|${timeZone}`,
      (): Promise<ProductAnalyticsRetentionDto | null> => {
        return isOpening
          ? Promise.resolve(null)
          : fetchProductAnalyticsRetention({
              rumApplicationId: modelId,
              startTime: period.startValue,
              endTime: period.endValue,
              startEvent: state.startEvent,
              returnEvent: state.returnEvent,
              filters: state.filters,
              period: retentionPeriod,
              timeZone: timeZone,
            });
      },
    );

  // What is on screen, as the saved retention tables keep it.
  const definition: ProductAnalyticsRetentionDefinition | null = isOpening
    ? null
    : toProductAnalyticsRetentionDefinition(state);

  const refresh: () => void = (): void => {
    setReloadToken((token: number): number => {
      return token + 1;
    });
  };

  const periodOptions: Array<DropdownOption> =
    PRODUCT_ANALYTICS_RETENTION_PERIODS.map(
      (value: ProductAnalyticsRetentionPeriod): DropdownOption => {
        return {
          value: value,
          label: PRODUCT_ANALYTICS_RETENTION_PERIOD_LABELS[value],
        };
      },
    );

  const dataStartedAt: number | null = names.data?.dataStartedAt ?? null;
  const isEmpty: boolean = Boolean(names.data && dataStartedAt === null);
  const hasNobody: boolean = Boolean(
    retention.data &&
      !isOpening &&
      retention.data.cohorts.every(
        (cohort: ProductAnalyticsRetentionDto["cohorts"][number]): boolean => {
          return cohort.people === 0;
        },
      ),
  );

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
      <div className="space-y-5" data-testid="product-analytics-retention-page">
        <ProductAnalyticsEventsSwitchPanel
          rumApplicationId={modelId}
          analytics={analytics}
        />
        <ProductAnalyticsCountingSince
          dataStartedAt={dataStartedAt}
          startTime={period.startValue}
          template={COUNTING_SINCE_EVENTS}
        />
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1">
              <span className="block text-xs font-medium text-gray-500">
                {translator.translateText("People who did")}
              </span>
              <ProductAnalyticsEventPicker
                events={names.data?.events || []}
                value={state.startEvent}
                ariaLabel="People who did"
                dataTestId="product-analytics-retention-start"
                onChange={(picked: ProductAnalyticsEventRef): void => {
                  setState((previous: ProductAnalyticsEventsUrlState) => {
                    return { ...previous, startEvent: picked };
                  });
                }}
              />
            </div>
            <div className="space-y-1">
              <span className="block text-xs font-medium text-gray-500">
                {translator.translateText("And came back to do")}
              </span>
              <ProductAnalyticsEventPicker
                events={names.data?.events || []}
                value={state.returnEvent}
                ariaLabel="And came back to do"
                dataTestId="product-analytics-retention-return"
                onChange={(picked: ProductAnalyticsEventRef): void => {
                  setState((previous: ProductAnalyticsEventsUrlState) => {
                    return { ...previous, returnEvent: picked };
                  });
                }}
              />
            </div>
            <div className="space-y-1">
              <span className="block text-xs font-medium text-gray-500">
                {translator.translateText("Cohorts")}
              </span>
              <Dropdown
                options={periodOptions}
                value={periodOptions.find((option: DropdownOption): boolean => {
                  return option.value === retentionPeriod;
                })}
                isClearable={false}
                ariaLabel="Cohorts"
                dataTestId="product-analytics-retention-period"
                onChange={(
                  value: DropdownValue | Array<DropdownValue> | null,
                ): void => {
                  const picked: ProductAnalyticsRetentionPeriod | undefined =
                    PRODUCT_ANALYTICS_RETENTION_PERIODS.find(
                      (candidate: ProductAnalyticsRetentionPeriod): boolean => {
                        return candidate === value;
                      },
                    );

                  if (picked) {
                    setState((previous: ProductAnalyticsEventsUrlState) => {
                      return { ...previous, period: picked };
                    });
                  }
                }}
              />
            </div>
          </div>
          {retentionPeriod === state.period ? (
            <></>
          ) : (
            <p
              className="text-xs text-gray-500"
              data-testid="product-analytics-retention-period-fitted"
            >
              {translator.translateText(
                "This range has too many periods to show one row each, so its cohorts are longer.",
              )}
            </p>
          )}
          <ProductAnalyticsSegmentBar
            filters={state.filters}
            properties={toProductAnalyticsPersonProperties(
              properties.data ?? null,
            )}
            onChange={(filters: Array<ProductAnalyticsSegmentFilter>): void => {
              setState((previous: ProductAnalyticsEventsUrlState) => {
                return { ...previous, filters: filters };
              });
            }}
            dataTestId="product-analytics-retention-segment"
          />
        </div>
        {retention.error ? (
          <ErrorMessage
            message={retention.error}
            onRefreshClick={retention.reload}
          />
        ) : retention.data && !isOpening ? (
          hasNobody ? (
            <p
              className="text-sm text-gray-500"
              data-testid="product-analytics-retention-nobody"
            >
              {translator.translateText(
                "Nobody did the start event in this range and segment.",
              )}
            </p>
          ) : (
            <div
              className={
                retention.isLoading ? "opacity-60 transition-opacity" : ""
              }
            >
              <ProductAnalyticsRetentionTable
                retention={retention.data}
                dataTestId="product-analytics-retention-table"
              />
            </div>
          )
        ) : (
          <div className="h-40 animate-pulse rounded-md bg-gray-50" />
        )}
      </div>
    );
  }

  return (
    <Card
      title="User Retention"
      description="People grouped by when they first did the start event in this range, and the share of each group that came back to do the return event in each day, week or month after."
      headerLayout="toolbar"
      buttons={[
        <ProductAnalyticsToolbar
          key="product-analytics-retention-toolbar"
          dataTestId="product-analytics-retention-toolbar"
          timeRange={range.timeRange}
          onTimeRangeChange={(timeRange: RangeStartAndEndDateTime): void => {
            setRange((previous: ProductAnalyticsUrlState) => {
              return { ...previous, timeRange: timeRange };
            });
          }}
          onRefresh={refresh}
          savedViews={
            <ProductAnalyticsSavedViewsMenu
              rumApplicationId={modelId}
              viewType={ProductAnalyticsSavedViewType.Retention}
              definition={definition}
              savedViewId={saved.savedViewId}
              isDefinitionInAddress={saved.address.isDefinitionInAddress}
              isSettled={saved.isSettled}
              onOpen={(
                view: ProductAnalyticsSavedView<ProductAnalyticsSavedViewType.Retention>,
              ): void => {
                const opened: ProductAnalyticsRetentionDefinition | null =
                  view.definition;

                if (opened) {
                  setState((previous: ProductAnalyticsEventsUrlState) => {
                    return applyProductAnalyticsRetentionDefinition(
                      previous,
                      opened,
                    );
                  });
                  saved.setSavedViewId(view.id);
                }
              }}
              onSelect={saved.setSavedViewId}
              onNotice={saved.setNotice}
              onSettled={saved.settle}
              dataTestId="product-analytics-retention-saved"
            />
          }
        />,
      ]}
    >
      <>
        <ProductAnalyticsSavedViewNotice
          notice={saved.notice}
          onClose={(): void => {
            saved.setNotice(null);
          }}
        />
        {body}
      </>
    </Card>
  );
};

export default RumApplicationProductAnalyticsRetention;
