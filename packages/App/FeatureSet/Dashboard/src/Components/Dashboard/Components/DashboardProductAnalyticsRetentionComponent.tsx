import React, { FunctionComponent, ReactElement } from "react";
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
import { Translator } from "Common/UI/Utils/TranslateTemplate";
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
  ProductAnalyticsWidgetFrame,
  ProductAnalyticsWidgetSavedView,
  ProductAnalyticsWidgetState,
  areProductAnalyticsWidgetPropsEqual,
  useProductAnalyticsWidgetPeriod,
  useProductAnalyticsWidgetSavedView,
} from "./DashboardProductAnalyticsWidget";

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
