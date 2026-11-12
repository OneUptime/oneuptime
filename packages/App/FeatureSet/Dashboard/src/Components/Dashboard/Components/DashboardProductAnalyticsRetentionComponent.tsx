import React, { FunctionComponent, ReactElement, ReactNode } from "react";
import DashboardProductAnalyticsRetentionComponent from "Common/Types/Dashboard/DashboardComponents/DashboardProductAnalyticsRetentionComponent";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import {
  ProductAnalyticsRetentionDto,
  ProductAnalyticsRetentionPeriod,
} from "Common/Types/Rum/ProductAnalyticsEventReads";
import {
  ProductAnalyticsRetentionDefinition,
  ProductAnalyticsSavedViewType,
} from "Common/Types/Rum/ProductAnalyticsSavedViews";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import { PluralTemplate, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { fetchProductAnalyticsRetention } from "../../ProductAnalytics/ProductAnalyticsEventsApi";
import { fitProductAnalyticsRetentionPeriod } from "../../ProductAnalytics/ProductAnalyticsEventsFormat";
import { getProductAnalyticsTimeZone } from "../../ProductAnalytics/ProductAnalyticsFormat";
import ProductAnalyticsRetentionTable from "../../ProductAnalytics/ProductAnalyticsRetentionTable";
import useProductAnalyticsRead, {
  ProductAnalyticsRead,
} from "../../ProductAnalytics/useProductAnalyticsRead";
import { DashboardBaseComponentProps } from "./DashboardBaseComponent";
import {
  PRODUCT_ANALYTICS_WIDGET_WORDS,
  ProductAnalyticsWidgetFrame,
  ProductAnalyticsWidgetPageLink,
  ProductAnalyticsWidgetSavedView,
  ProductAnalyticsWidgetState,
  areProductAnalyticsWidgetPropsEqual,
  isProductAnalyticsWidgetLinked,
  useProductAnalyticsWidgetPeriod,
  useProductAnalyticsWidgetSavedView,
} from "./DashboardProductAnalyticsWidget";
import { useIsDashboardWidgetPreview } from "./DashboardWidgetPreview";

/*
 * The Retention widget (issue #6630): a retention table saved on a RUM
 * application's User Retention page - its start and return events, its
 * period and its segment - read with the dashboard's time range, as the
 * page draws it: All cohorts over the cohorts, each period's share in its
 * cell. A range too long for the saved period reads by the next longer
 * one, as the page does, and says so.
 */

export interface ComponentProps extends DashboardBaseComponentProps {
  component: DashboardProductAnalyticsRetentionComponent;
}

export const RETENTION_WIDGET_TEST_ID: string =
  "dashboard-product-analytics-retention";

/*
 * What a widget's card takes from its width around what it draws: a 1px
 * border and 12px of padding each side (DashboardBaseComponent), as the
 * Value widget counts it (ValueWidgetLayout).
 */
export const RETENTION_WIDGET_CHROME_IN_PX: number = 26;

/*
 * The width the table has in a widget of this width: what the card leaves
 * of it, never less than nothing.
 */
export function getRetentionWidgetTableWidthInPx(
  widgetWidthInPx: number,
): number {
  return Math.max(widgetWidthInPx - RETENTION_WIDGET_CHROME_IN_PX, 0);
}

/*
 * Under a table whose last periods do not fit in the widget (issue #6721):
 * how many it leaves out, in the period's own word - a link to the saved
 * table on the User Retention page, which shows them all.
 */
export const RETENTION_PERIODS_LEFT_OUT: Readonly<
  Record<ProductAnalyticsRetentionPeriod, PluralTemplate>
> = {
  [ProductAnalyticsRetentionPeriod.Day]: {
    one: "{{count}} more day",
    other: "{{count}} more days",
  },
  [ProductAnalyticsRetentionPeriod.Week]: {
    one: "{{count}} more week",
    other: "{{count}} more weeks",
  },
  [ProductAnalyticsRetentionPeriod.Month]: {
    one: "{{count}} more month",
    other: "{{count}} more months",
  },
};

/*
 * The line's box: held to the foot of the widget's scrolling body (sticky
 * bottom-0), on the card's background and over the cohort column, which
 * holds its own place above the rows (z-10), so the rows pass under it.
 */
export const RETENTION_LEFT_OUT_CLASS_NAME: string =
  "sticky bottom-0 z-20 flex justify-end bg-white px-1 py-0.5";

const DashboardProductAnalyticsRetentionComponentElement: FunctionComponent<
  ComponentProps
> = (props: ComponentProps): ReactElement => {
  const translator: Translator = useTranslator();
  const saved: ProductAnalyticsWidgetSavedView<ProductAnalyticsSavedViewType.Retention> =
    useProductAnalyticsWidgetSavedView<ProductAnalyticsSavedViewType.Retention>(
      {
        savedViewId: props.component.arguments.savedViewId,
        viewType: ProductAnalyticsSavedViewType.Retention,
        refreshTick: props.refreshTick,
      },
    );
  const period: InBetween<Date> = useProductAnalyticsWidgetPeriod(props);
  const definition: ProductAnalyticsRetentionDefinition | null =
    saved.state === ProductAnalyticsWidgetState.Ready
      ? saved.view?.definition || null
      : null;
  const rumApplicationId: string = saved.view?.rumApplicationId || "";
  const isPreview: boolean = useIsDashboardWidgetPreview();
  const isLinked: boolean = isProductAnalyticsWidgetLinked({
    state: saved.state,
    hasView: Boolean(saved.view),
    isEditMode: props.isEditMode,
    isPreview: isPreview,
    isPlayback: Boolean(props.isPlayback),
  });
  const timeZone: string = getProductAnalyticsTimeZone(
    OneUptimeDate.getCurrentTimezone().toString(),
  );
  const retentionPeriod: ProductAnalyticsRetentionPeriod | null = definition
    ? fitProductAnalyticsRetentionPeriod({
        period: definition.period,
        startTime: period.startValue,
        endTime: period.endValue,
        timeZone: timeZone,
      })
    : null;

  const retention: ProductAnalyticsRead<ProductAnalyticsRetentionDto | null> =
    useProductAnalyticsRead<ProductAnalyticsRetentionDto | null>(
      definition && retentionPeriod
        ? `${rumApplicationId}|${JSON.stringify(definition)}|${retentionPeriod}|${timeZone}|${period.startValue.getTime()}|${period.endValue.getTime()}|${props.refreshTick || 0}`
        : "",
      (): Promise<ProductAnalyticsRetentionDto | null> => {
        return definition && retentionPeriod
          ? fetchProductAnalyticsRetention({
              rumApplicationId: new ObjectID(rumApplicationId),
              startTime: period.startValue,
              endTime: period.endValue,
              startEvent: definition.startEvent,
              returnEvent: definition.returnEvent,
              filters: definition.filters,
              period: retentionPeriod,
              timeZone: timeZone,
            })
          : Promise.resolve(null);
      },
    );

  let content: ReactElement;

  if (retention.error) {
    content = <ErrorMessage message={retention.error} />;
  } else if (!retention.data) {
    content = (
      <div className="flex h-full items-center justify-center">
        <ComponentLoader />
      </div>
    );
  } else if (
    retention.data.cohorts.every(
      (cohort: ProductAnalyticsRetentionDto["cohorts"][number]): boolean => {
        return cohort.people === 0;
      },
    )
  ) {
    content = (
      <div
        className="flex h-full items-center justify-center px-2 text-center text-xs text-gray-500"
        data-testid={`${RETENTION_WIDGET_TEST_ID}-nobody`}
      >
        {translator.translateText(
          "Nobody did the start event in this range and segment.",
        )}
      </div>
    );
  } else {
    content = (
      <div
        className={`space-y-2 ${
          retention.isLoading ? "opacity-60 transition-opacity" : ""
        }`}
      >
        <ProductAnalyticsRetentionTable
          retention={retention.data}
          dataTestId={`${RETENTION_WIDGET_TEST_ID}-table`}
          isCompact={true}
          fitToWidthInPx={getRetentionWidgetTableWidthInPx(
            props.dashboardComponentWidthInPx,
          )}
          renderPeriodsLeftOut={(leftOut: number): ReactNode => {
            const period: ProductAnalyticsRetentionPeriod =
              retention.data?.period || ProductAnalyticsRetentionPeriod.Week;
            const text: string = translator.translatePlural(
              RETENTION_PERIODS_LEFT_OUT[period] ||
                RETENTION_PERIODS_LEFT_OUT[
                  ProductAnalyticsRetentionPeriod.Week
                ],
              leftOut,
            );
            const open: string =
              PRODUCT_ANALYTICS_WIDGET_WORDS[
                ProductAnalyticsSavedViewType.Retention
              ].open;

            /*
             * At the table's end, where its periods stop: a link where the
             * corner's is (never while the board is edited, in the
             * settings' live preview or on a playlist's screen), the same
             * words in grey there. It keeps
             * to the widget's foot while more cohorts than the widget is
             * tall scroll under it, so it is read without a scroll.
             */
            return (
              <div
                className={RETENTION_LEFT_OUT_CLASS_NAME}
                data-testid={`${RETENTION_WIDGET_TEST_ID}-left-out`}
              >
                {saved.view && isLinked ? (
                  <ProductAnalyticsWidgetPageLink
                    view={saved.view}
                    viewType={ProductAnalyticsSavedViewType.Retention}
                    dashboardStartAndEndDate={props.dashboardStartAndEndDate}
                    title={translator.translateText(open) || open}
                    dataTestId={`${RETENTION_WIDGET_TEST_ID}-left-out-open`}
                    className="inline-flex items-center gap-0.5 rounded text-xs font-medium text-indigo-600 hover:text-indigo-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                  >
                    <span>{text}</span>
                    {/* Turned round by Icon itself on a page read from the right. */}
                    <Icon
                      icon={IconProp.ChevronRight}
                      className="h-3 w-3 flex-none"
                    />
                  </ProductAnalyticsWidgetPageLink>
                ) : (
                  <span className="text-xs text-gray-500">{text}</span>
                )}
              </div>
            );
          }}
        />
        {definition && retentionPeriod !== definition.period ? (
          <p
            className="px-1 text-xs text-gray-500"
            data-testid={`${RETENTION_WIDGET_TEST_ID}-period-fitted`}
          >
            {translator.translateText(
              "This range has too many periods to show one row each, so its cohorts are longer.",
            )}
          </p>
        ) : (
          <></>
        )}
      </div>
    );
  }

  return (
    <ProductAnalyticsWidgetFrame
      viewType={ProductAnalyticsSavedViewType.Retention}
      saved={saved}
      title={props.component.arguments.title}
      dashboardStartAndEndDate={props.dashboardStartAndEndDate}
      isEditMode={props.isEditMode}
      isPlayback={Boolean(props.isPlayback)}
      dataTestId={RETENTION_WIDGET_TEST_ID}
    >
      {content}
    </ProductAnalyticsWidgetFrame>
  );
};

export default React.memo(
  DashboardProductAnalyticsRetentionComponentElement,
  areProductAnalyticsWidgetPropsEqual,
);
