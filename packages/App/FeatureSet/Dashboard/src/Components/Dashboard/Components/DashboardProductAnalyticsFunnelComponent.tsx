import React, { FunctionComponent, ReactElement } from "react";
import DashboardProductAnalyticsFunnelComponent from "Common/Types/Dashboard/DashboardComponents/DashboardProductAnalyticsFunnelComponent";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import ObjectID from "Common/Types/ObjectID";
import { ProductAnalyticsFunnelDto } from "Common/Types/Rum/ProductAnalyticsEventReads";
import {
  ProductAnalyticsFunnelDefinition,
  ProductAnalyticsSavedViewType,
} from "Common/Types/Rum/ProductAnalyticsSavedViews";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import IconProp from "Common/Types/Icon/IconProp";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { fetchProductAnalyticsFunnel } from "../../ProductAnalytics/ProductAnalyticsEventsApi";
import ProductAnalyticsFunnelChart, {
  describeProductAnalyticsFunnelCompletion,
} from "../../ProductAnalytics/ProductAnalyticsFunnelChart";
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
import DashboardWidgetError from "./DashboardWidgetError";

/*
 * The Funnel widget (issue #6630): a funnel saved on a RUM application's
 * Funnels page - its steps, its time to finish and its segment - read with
 * the dashboard's time range: each step's people and the share that went
 * on, as the page draws them, with how many finished over them.
 */

export interface ComponentProps extends DashboardBaseComponentProps {
  component: DashboardProductAnalyticsFunnelComponent;
}

export const FUNNEL_WIDGET_TEST_ID: string =
  "dashboard-product-analytics-funnel";

const DashboardProductAnalyticsFunnelComponentElement: FunctionComponent<
  ComponentProps
> = (props: ComponentProps): ReactElement => {
  const translator: Translator = useTranslator();
  const saved: ProductAnalyticsWidgetSavedView<ProductAnalyticsSavedViewType.Funnel> =
    useProductAnalyticsWidgetSavedView<ProductAnalyticsSavedViewType.Funnel>({
      savedViewId: props.component.arguments.savedViewId,
      viewType: ProductAnalyticsSavedViewType.Funnel,
      refreshTick: props.refreshTick,
    });
  const period: InBetween<Date> = useProductAnalyticsWidgetPeriod(props);
  const definition: ProductAnalyticsFunnelDefinition | null =
    saved.state === ProductAnalyticsWidgetState.Ready
      ? saved.view?.definition || null
      : null;
  const rumApplicationId: string = saved.view?.rumApplicationId || "";

  const funnel: ProductAnalyticsRead<ProductAnalyticsFunnelDto | null> =
    useProductAnalyticsRead<ProductAnalyticsFunnelDto | null>(
      definition
        ? `${rumApplicationId}|${JSON.stringify(definition)}|${period.startValue.getTime()}|${period.endValue.getTime()}|${props.refreshTick || 0}`
        : "",
      (): Promise<ProductAnalyticsFunnelDto | null> => {
        return definition
          ? fetchProductAnalyticsFunnel({
              rumApplicationId: new ObjectID(rumApplicationId),
              startTime: period.startValue,
              endTime: period.endValue,
              steps: definition.steps,
              filters: definition.filters,
              windowMs: definition.windowMs,
            })
          : Promise.resolve(null);
      },
    );

  let content: ReactElement;

  // A read refused: every widget's error line (issue #7330), under its title.
  if (funnel.error) {
    content = (
      <DashboardWidgetError icon={IconProp.Funnel} error={funnel.error} />
    );
  } else if (!funnel.data) {
    content = (
      <div className="flex h-full items-center justify-center">
        <ComponentLoader />
      </div>
    );
  } else if (funnel.data.steps[0] && funnel.data.steps[0].people === 0) {
    content = (
      <div
        className="flex h-full items-center justify-center px-2 text-center text-xs text-gray-500"
        data-testid={`${FUNNEL_WIDGET_TEST_ID}-nobody`}
      >
        {translator.translateText(
          "Nobody did the first step in this range and segment.",
        )}
      </div>
    );
  } else {
    const completion: string | null = describeProductAnalyticsFunnelCompletion({
      funnel: funnel.data,
      translator: translator,
    });

    content = (
      <div
        className={`space-y-2 px-1 ${
          funnel.isLoading ? "opacity-60 transition-opacity" : ""
        }`}
      >
        {completion ? (
          <p
            className="text-xs text-gray-600"
            data-testid={`${FUNNEL_WIDGET_TEST_ID}-completion`}
          >
            {completion}
          </p>
        ) : (
          <></>
        )}
        <ProductAnalyticsFunnelChart
          funnel={funnel.data}
          dataTestId={`${FUNNEL_WIDGET_TEST_ID}-chart`}
        />
      </div>
    );
  }

  return (
    <ProductAnalyticsWidgetFrame
      viewType={ProductAnalyticsSavedViewType.Funnel}
      saved={saved}
      title={props.component.arguments.title}
      dashboardStartAndEndDate={props.dashboardStartAndEndDate}
      isEditMode={props.isEditMode}
      isPlayback={Boolean(props.isPlayback)}
      dataTestId={FUNNEL_WIDGET_TEST_ID}
    >
      {content}
    </ProductAnalyticsWidgetFrame>
  );
};

export default React.memo(
  DashboardProductAnalyticsFunnelComponentElement,
  areProductAnalyticsWidgetPropsEqual,
);
