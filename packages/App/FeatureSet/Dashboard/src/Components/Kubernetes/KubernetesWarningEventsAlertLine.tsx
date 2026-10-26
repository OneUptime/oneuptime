import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Route from "Common/Types/API/Route";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import IconProp from "Common/Types/Icon/IconProp";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import RecommendationFilterUtil, {
  RECOMMENDATION_SELECTION_QUERY_PARAM,
} from "../Recommendations/RecommendationFilterUtil";
import {
  KUBERNETES_WARNING_EVENTS_RECOMMENDATION_ID,
  findKubernetesWarningEventsMonitors,
} from "./KubernetesWarningEventsAlert";

/*
 * The last line of a cluster's Events page: whether its warnings raise
 * alerts (KubernetesWarningEventsAlert).
 *
 *   - A Logs monitor counts the cluster's Warning events: "Warnings raise
 *     alerts through <monitor>", the monitor a link.
 *   - None does: "Get an alert when Kubernetes reports a warning. Turn on
 *     warning alerts" - the cluster's Recommendations, with the Warning
 *     Events alert selected, so one Create turns it on.
 *
 * Nothing while the monitors are read, or when they cannot be: the line is
 * a nudge, never a card or an error of its own on a page about events.
 */

export const KUBERNETES_WARNING_ALERTS_TEST_ID: string =
  "kubernetes-warning-alerts";

/*
 * The Events card's footer, under the list's pager (#5298's UI review): a
 * rule across the card, as the pager's own, and the card's padding, so its
 * words start where "Showing 1-11 of 11 events" does. The pager ends its
 * card - the list's footer runs to the card's edges and bottom (-mb-6) -
 * so the line, after it, does the same: right under it (mt-6 makes up the
 * pager's -mb-6), ending the card. It used to sit 6px under the pager's
 * Rows per page, in its grey, and read as part of the pager.
 */
export const KUBERNETES_WARNING_ALERTS_LINE_CLASS_NAME: string =
  "-mx-5 -mb-6 mt-6 flex items-start gap-2 border-t border-gray-200 px-5 py-3 text-sm text-gray-500 md:-mx-6 md:px-6";

export interface ComponentProps {
  // The cluster's record id, for its Recommendations page.
  clusterId: ObjectID;
  // The k8s.cluster.name its agent reports, which a monitor filters on.
  clusterIdentifier: string;
}

const LINK_CLASS_NAME: string =
  "font-medium text-indigo-600 hover:text-indigo-700 focus:outline-none focus-visible:underline";

const KubernetesWarningEventsAlertLine: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  // Null until read, and when the monitors cannot be read.
  const [alertingMonitors, setAlertingMonitors] =
    useState<Array<Monitor> | null>(null);

  useEffect(() => {
    if (!props.clusterIdentifier) {
      return;
    }

    let isCurrent: boolean = true;

    const load: () => Promise<void> = async (): Promise<void> => {
      try {
        const monitors: ListResult<Monitor> = await ModelAPI.getList({
          modelType: Monitor,
          query: { monitorType: MonitorType.Logs },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            _id: true,
            name: true,
            monitorType: true,
            monitorSteps: true,
            disableActiveMonitoring: true,
          },
          sort: { name: SortOrder.Ascending },
        });

        if (isCurrent) {
          setAlertingMonitors(
            findKubernetesWarningEventsMonitors(
              monitors.data,
              props.clusterIdentifier,
            ),
          );
        }
      } catch {
        // A nudge, not a feature of the page: say nothing.
        if (isCurrent) {
          setAlertingMonitors(null);
        }
      }
    };

    load().catch(() => {
      // handled inside.
    });

    return () => {
      isCurrent = false;
    };
  }, [props.clusterIdentifier]);

  if (!alertingMonitors) {
    return <></>;
  }

  const firstMonitor: Monitor | undefined = alertingMonitors[0];

  // The card's footer, under the pager (KUBERNETES_WARNING_ALERTS_LINE_CLASS_NAME).
  const renderLine: (content: ReactElement) => ReactElement = (
    content: ReactElement,
  ): ReactElement => {
    return (
      <div
        className={KUBERNETES_WARNING_ALERTS_LINE_CLASS_NAME}
        data-testid={KUBERNETES_WARNING_ALERTS_TEST_ID}
      >
        <Icon
          icon={IconProp.Bell}
          className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400"
        />
        {content}
      </div>
    );
  };

  if (firstMonitor && firstMonitor.id) {
    const monitorLink: ReactElement = (
      <Link
        to={RouteUtil.populateRouteParams(
          RouteMap[PageMap.MONITOR_VIEW] as Route,
          { modelId: firstMonitor.id },
        )}
        className={LINK_CLASS_NAME}
        dataTestId={`${KUBERNETES_WARNING_ALERTS_TEST_ID}-monitor`}
      >
        {firstMonitor.name || translator.translateText("a monitor")}
      </Link>
    );

    const others: number = alertingMonitors.length - 1;

    return renderLine(
      <span>
        {others > 0 ? (
          <TranslatedSentence
            template="Warnings raise alerts through {{monitor}} and {{others}}."
            slots={{
              monitor: monitorLink,
              others: (
                <span>
                  {translator.translatePlural(
                    {
                      one: "{{count}} other monitor",
                      other: "{{count}} other monitors",
                    },
                    others,
                  )}
                </span>
              ),
            }}
          />
        ) : (
          <TranslatedSentence
            template="Warnings raise alerts through {{monitor}}."
            slots={{ monitor: monitorLink }}
          />
        )}
      </span>,
    );
  }

  const recommendationsRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_RECOMMENDATIONS] as Route,
    { modelId: props.clusterId },
  ).addQueryParams({
    [RECOMMENDATION_SELECTION_QUERY_PARAM]:
      RecommendationFilterUtil.toSelectionQuery([
        KUBERNETES_WARNING_EVENTS_RECOMMENDATION_ID,
      ]),
  });

  return renderLine(
    <span>
      {translator.translateText(
        "Get an alert when Kubernetes reports a warning.",
      )}{" "}
      <Link
        to={recommendationsRoute}
        className={LINK_CLASS_NAME}
        dataTestId={`${KUBERNETES_WARNING_ALERTS_TEST_ID}-turn-on`}
      >
        {translator.translateText("Turn on warning alerts")}
      </Link>
    </span>,
  );
};

export default KubernetesWarningEventsAlertLine;
