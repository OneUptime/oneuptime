import React, {
  FunctionComponent,
  ReactElement,
  ReactNode,
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
import CodeBlock from "Common/UI/Components/CodeBlock/CodeBlock";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import ModelSwitchRow from "Common/UI/Components/ModelSwitch/ModelSwitchRow";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
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
  /*
   * Whether the pages draw the switch: while the events are off, and - once
   * it was flipped there - until the page is left, so the press shows what
   * it did ("Saved") and can be taken back.
   */
  isSwitchShown: boolean;
  // Told by the switch, after a change is saved there.
  setIsEnabled: (isEnabled: boolean) => void;
}

/* Whether the application sends events: read once, then kept as the switch moves. */
export function useProductAnalyticsEventsSwitch(
  rumApplicationId: ObjectID,
): ProductAnalyticsEventsSwitchState {
  const [isEnabled, setIsEnabled] = useState<boolean | null>(null);
  const [isChangedHere, setIsChangedHere] = useState<boolean>(false);
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
      setIsChangedHere(true);
    },
    [],
  );

  return {
    isEnabled: isEnabled,
    isSessionReplayEnabled: isSessionReplayEnabled,
    isSwitchShown: isEnabled === false || isChangedHere,
    setIsEnabled: update,
  };
}

/*
 * Session Replay off for the application: its recorder, which sends the
 * events, never loads until it is on. Said with the way to the page that
 * turns it on, in the words its menu item has.
 */
export const ProductAnalyticsReplayOffNote: FunctionComponent<{
  rumApplicationId: ObjectID;
}> = (props: { rumApplicationId: ObjectID }): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <span data-testid="product-analytics-events-replay-off">
      <TranslatedSentence
        template={ProductAnalyticsEventsSwitchCopy.replayOffNote}
        slots={{
          replayPolicy: (
            <AppLink
              to={RouteUtil.populateRouteParams(
                RouteMap[
                  PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY_SETTINGS
                ] as Route,
                { modelId: props.rumApplicationId },
              )}
              className="font-medium underline hover:no-underline"
              dataTestId="product-analytics-events-replay-policy-link"
            >
              <span>{translator.translateText("Replay Policy")}</span>
            </AppLink>
          ),
        }}
      />
    </span>
  );
};

/*
 * The switch, on a quiet panel of its own: what turning the events on does
 * while they are off, what it sends once they are on, and - while Session
 * Replay is off, whichever way it is set - that nothing is sent until that
 * is on too. Shown alone when nothing was ever kept, and above what is kept
 * when they were turned off later.
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
  return (
    <div
      className="rounded-xl border border-gray-200 bg-gray-50 px-5 py-4 md:px-6"
      data-testid="product-analytics-events-off"
    >
      <ModelSwitchRow<RumApplication>
        modelType={RumApplication}
        modelId={props.rumApplicationId}
        column={PRODUCT_ANALYTICS_EVENTS_SWITCH_COLUMN}
        initialValue={false}
        title={ProductAnalyticsEventsSwitchCopy.switchTitle}
        getDescription={(isOn: boolean): string => {
          return isOn
            ? ProductAnalyticsEventsSwitchCopy.switchDescription
            : ProductAnalyticsEventsSwitchCopy.offDescription;
        }}
        getWarning={(): ReactNode => {
          return props.isSessionReplayEnabled ? undefined : (
            <ProductAnalyticsReplayOffNote
              rumApplicationId={props.rumApplicationId}
            />
          );
        }}
        onSaved={props.onSaved}
        dataTestId="product-analytics-events-off-switch"
      />
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
        <TranslatedSentence
          template="Each event is also counted as the metric {{metric}}, by event name, and each metric() call is a metric of its own. Chart them in Metrics, add them to a dashboard, or alert on them with a Metrics monitor."
          slots={{
            metric: (
              <code
                className="break-all rounded bg-white px-1 py-0.5 text-xs text-gray-800 ring-1 ring-inset ring-gray-200"
                dir="ltr"
              >
                {ProductAnalyticsDerivedMetric.Events}
              </code>
            ),
          }}
        />{" "}
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
 * Events on, and none kept yet: what arrives on its own, the two calls that
 * send the rest - to copy, wrapped to the width of a phone rather than
 * scrolled sideways - and the ways to the guide and to the recorder's own
 * install page. When Session Replay is off for the application, that its
 * recorder, which sends them, never loads until it is on.
 */
export const ProductAnalyticsNoEventsYet: FunctionComponent<{
  rumApplicationId: ObjectID;
  isSessionReplayEnabled: boolean;
}> = (props: {
  rumApplicationId: ObjectID;
  isSessionReplayEnabled: boolean;
}): ReactElement => {
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
            "Session starts and page views arrive on their own from every page the browser recorder is installed on. To count what people do there, send events and numbers from your app's code:",
          )}
        </span>
      }
      footer={
        <div className="flex w-full min-w-0 max-w-2xl flex-col items-center gap-4">
          {props.isSessionReplayEnabled ? (
            <></>
          ) : (
            <div className="flex w-full items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-start text-sm text-amber-800 ring-1 ring-inset ring-amber-200">
              <Icon
                icon={IconProp.Alert}
                className="mt-0.5 h-4 w-4 flex-none text-amber-600"
              />
              <ProductAnalyticsReplayOffNote
                rumApplicationId={props.rumApplicationId}
              />
            </div>
          )}
          <div
            className="w-full text-start"
            dir="ltr"
            data-testid="product-analytics-events-snippet"
          >
            <CodeBlock
              language="javascript"
              wrapLongLines={true}
              code={`OneUptimeReplay.track("Signed up", { plan: "pro" });\nOneUptimeReplay.metric("cart.value", 42.5, { currency: "EUR" });`}
            />
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm">
            <Link
              className="font-medium text-indigo-700 hover:underline"
              openInNewTab={true}
              to={URL.fromString(
                `${DOCS_URL.toString()}/rum/product-analytics`,
              )}
            >
              <span>
                {translator.translateText("How to send events and metrics")}
              </span>
            </Link>
            <AppLink
              to={RouteUtil.populateRouteParams(
                RouteMap[
                  PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY_DOCUMENTATION
                ] as Route,
                { modelId: props.rumApplicationId },
              )}
              className="font-medium text-indigo-700 hover:underline"
              dataTestId="product-analytics-events-install-link"
            >
              <span>{translator.translateText("Install the recorder")}</span>
            </AppLink>
          </div>
        </div>
      }
    />
  );
};

/*
 * The switch where a page draws it: while the events are off, and after it
 * was flipped there (useProductAnalyticsEventsSwitch's isSwitchShown).
 */
export const ProductAnalyticsEventsSwitchPanel: FunctionComponent<{
  rumApplicationId: ObjectID;
  analytics: ProductAnalyticsEventsSwitchState;
}> = (props: {
  rumApplicationId: ObjectID;
  analytics: ProductAnalyticsEventsSwitchState;
}): ReactElement => {
  if (!props.analytics.isSwitchShown) {
    return <></>;
  }

  return (
    <ProductAnalyticsEventsOff
      rumApplicationId={props.rumApplicationId}
      isSessionReplayEnabled={props.analytics.isSessionReplayEnabled}
      onSaved={props.analytics.setIsEnabled}
    />
  );
};

/*
 * A page's body while nothing is kept at all: the switch while the events
 * are off, and once they are on - turned on right there, the switch stays
 * above it - how to send them. A loader while the switch is still read, so
 * "No events yet" never shows for an application whose events are off.
 */
export const ProductAnalyticsNothingKept: FunctionComponent<{
  rumApplicationId: ObjectID;
  analytics: ProductAnalyticsEventsSwitchState;
}> = (props: {
  rumApplicationId: ObjectID;
  analytics: ProductAnalyticsEventsSwitchState;
}): ReactElement => {
  let below: ReactElement = <></>;

  if (props.analytics.isEnabled === null) {
    below = <ComponentLoader />;
  } else if (props.analytics.isEnabled) {
    below = (
      <ProductAnalyticsNoEventsYet
        rumApplicationId={props.rumApplicationId}
        isSessionReplayEnabled={props.analytics.isSessionReplayEnabled}
      />
    );
  }

  return (
    <div className="space-y-5" data-testid="product-analytics-nothing-kept">
      <ProductAnalyticsEventsSwitchPanel
        rumApplicationId={props.rumApplicationId}
        analytics={props.analytics}
      />
      {below}
    </div>
  );
};
