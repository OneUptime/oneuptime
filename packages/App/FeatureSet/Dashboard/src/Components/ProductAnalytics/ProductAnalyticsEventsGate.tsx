import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useState,
} from "react";
import RumApplication from "Common/Models/DatabaseModels/RumApplication";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { ProductAnalyticsDerivedMetric } from "Common/Types/Rum/ProductAnalyticsEvents";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import AppLink from "../AppLink/AppLink";
import { DOCS_URL } from "Common/UI/Config";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import ModelSwitchRow from "Common/UI/Components/ModelSwitch/ModelSwitchRow";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import ProductAnalyticsEventsSwitchCopy, {
  PRODUCT_ANALYTICS_EVENTS_SWITCH_COLUMN,
} from "./ProductAnalyticsEventsSwitchCopy";

/*
 * What the Events, Funnels and Retention pages (issue #6444, part two) say
 * before there is anything to read: that the application has product
 * analytics events off - with the switch that turns them on, for whoever
 * may flip it - or that it has them on and has sent none yet, with the two
 * calls that send them.
 */

export interface ProductAnalyticsEventsSwitchState {
  // Null while it is read; false when it could not be read.
  isEnabled: boolean | null;
  isSessionReplayEnabled: boolean;
  setIsEnabled: (isEnabled: boolean) => void;
}

/* Whether the application sends events: read once, then kept as the switch moves. */
export function useProductAnalyticsEventsSwitch(
  rumApplicationId: ObjectID,
): ProductAnalyticsEventsSwitchState {
  const [isEnabled, setIsEnabled] = useState<boolean | null>(null);
  const [isSessionReplayEnabled, setIsSessionReplayEnabled] =
    useState<boolean>(true);

  useEffect((): (() => void) => {
    let isCurrent: boolean = true;

    ModelAPI.getItem<RumApplication>({
      modelType: RumApplication,
      id: rumApplicationId,
      select: {
        isProductAnalyticsEnabled: true,
        isSessionReplayEnabled: true,
      },
    })
      .then((item: RumApplication | null): void => {
        if (isCurrent) {
          setIsEnabled(item?.isProductAnalyticsEnabled === true);
          setIsSessionReplayEnabled(item?.isSessionReplayEnabled !== false);
        }
      })
      .catch((): void => {
        /* The reads say why on their own; the pages then show what is kept. */
        if (isCurrent) {
          setIsEnabled(false);
        }
      });

    return (): void => {
      isCurrent = false;
    };
  }, [rumApplicationId.toString()]);

  const update: (value: boolean) => void = useCallback(
    (value: boolean): void => {
      setIsEnabled(value);
    },
    [],
  );

  return {
    isEnabled: isEnabled,
    isSessionReplayEnabled: isSessionReplayEnabled,
    setIsEnabled: update,
  };
}

/*
 * Events off: what turning them on does, and the switch. Shown alone when
 * nothing was ever kept, and above what is kept when they were turned off
 * later.
 */
export const ProductAnalyticsEventsOff: FunctionComponent<{
  rumApplicationId: ObjectID;
  isSessionReplayEnabled: boolean;
  onSaved: (isOn: boolean) => void;
}> = (props: {
  rumApplicationId: ObjectID;
  isSessionReplayEnabled: boolean;
  onSaved: (isOn: boolean) => void;
}): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div
      className="rounded-md bg-gray-50 px-4 py-4 ring-1 ring-inset ring-gray-200"
      data-testid="product-analytics-events-off"
    >
      <div className="flex items-start gap-3">
        <Icon
          icon={IconProp.Info}
          className="mt-0.5 h-5 w-5 flex-none text-gray-400"
        />
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <p className="text-sm font-medium text-gray-900">
              {translator.translateText(
                ProductAnalyticsEventsSwitchCopy.offTitle,
              )}
            </p>
            <p className="mt-1 text-sm text-gray-600">
              {translator.translateText(
                ProductAnalyticsEventsSwitchCopy.offDescription,
              )}
            </p>
            {props.isSessionReplayEnabled ? (
              <></>
            ) : (
              <p
                className="mt-1 text-sm text-gray-600"
                data-testid="product-analytics-events-replay-off"
              >
                {translator.translateText(
                  ProductAnalyticsEventsSwitchCopy.replayOffNote,
                )}
              </p>
            )}
          </div>
          <ModelSwitchRow<RumApplication>
            modelType={RumApplication}
            modelId={props.rumApplicationId}
            column={PRODUCT_ANALYTICS_EVENTS_SWITCH_COLUMN}
            initialValue={false}
            title={ProductAnalyticsEventsSwitchCopy.switchTitle}
            getDescription={(): string => {
              return ProductAnalyticsEventsSwitchCopy.switchDescription;
            }}
            onSaved={props.onSaved}
            dataTestId="product-analytics-events-off-switch"
          />
        </div>
      </div>
    </div>
  );
};

/*
 * Where else the events go: every event is also counted minute by minute as
 * a metric of the application's, and every metric() call is a metric of its
 * own, so the Metrics explorer charts them, a dashboard shows them and a
 * Metrics monitor alerts on them.
 */
export const ProductAnalyticsMetricsNote: FunctionComponent<{
  rumApplicationId: ObjectID;
}> = (props: { rumApplicationId: ObjectID }): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div
      className="mt-4 flex items-start gap-2 rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-600 ring-1 ring-inset ring-gray-200"
      data-testid="product-analytics-metrics-note"
    >
      <Icon
        icon={IconProp.ChartBar}
        className="mt-0.5 h-4 w-4 flex-none text-gray-400"
      />
      <p className="min-w-0">
        {translator.translateTemplate(
          "Each event is also counted as the metric {{metric}}, by event name, and each metric() call is a metric of its own. Chart them in Metrics, add them to a dashboard, or alert on them with a Metrics monitor.",
          { metric: ProductAnalyticsDerivedMetric.Events },
        )}{" "}
        <AppLink
          to={RouteUtil.populateRouteParams(
            RouteMap[PageMap.RUM_APPLICATION_VIEW_METRICS] as Route,
            { modelId: props.rumApplicationId },
          )}
          className="font-medium text-indigo-700 hover:underline"
        >
          <span>{translator.translateText("Open Metrics")}</span>
        </AppLink>
      </p>
    </div>
  );
};

/*
 * Events on, and none kept yet: the two calls that send them - and, when
 * Session Replay is off for the application, that its recorder, which
 * sends them, never loads until it is on.
 */
export const ProductAnalyticsNoEventsYet: FunctionComponent<{
  isSessionReplayEnabled: boolean;
}> = (props: { isSessionReplayEnabled: boolean }): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <EmptyState
      id="product-analytics-no-events-yet"
      icon={IconProp.CursorArrowRays}
      title="No events yet"
      paddingClassName="py-12"
      description={
        <span>
          {translator.translateText(
            "Every session the browser recorder runs in sends its start and its page views on its own. Send your own events and numbers from your app's code:",
          )}
        </span>
      }
      footer={
        <div className="flex flex-col items-center gap-3">
          {props.isSessionReplayEnabled ? (
            <></>
          ) : (
            <p
              className="max-w-lg text-center text-sm text-gray-600"
              data-testid="product-analytics-events-replay-off"
            >
              {translator.translateText(
                ProductAnalyticsEventsSwitchCopy.replayOffNote,
              )}
            </p>
          )}
          <pre
            className="max-w-full overflow-x-auto rounded-md bg-gray-900 px-4 py-3 text-start text-xs leading-5 text-gray-100"
            dir="ltr"
            data-testid="product-analytics-events-snippet"
          >
            {`OneUptimeReplay.track("Signed up", { plan: "pro" });\nOneUptimeReplay.metric("cart.value", 42.5, { currency: "EUR" });`}
          </pre>
          <Link
            className="text-sm font-medium text-indigo-700 hover:underline"
            openInNewTab={true}
            to={URL.fromString(`${DOCS_URL.toString()}/rum/product-analytics`)}
          >
            <span>
              {translator.translateText("How to send events and metrics")}
            </span>
          </Link>
        </div>
      }
    />
  );
};
