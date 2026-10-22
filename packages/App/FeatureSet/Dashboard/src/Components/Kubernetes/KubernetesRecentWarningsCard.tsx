import { KubernetesWarningSummary } from "./KubernetesEventsModel";
import { getKubernetesObjectRoute } from "./KubernetesEventsTable";
import AppLink from "../AppLink/AppLink";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import {
  FeedClock,
  formatFeedFullTime,
  formatFeedTimeAgo,
  getFeedClock,
} from "Common/UI/Components/Feed/FeedTime";
import Icon from "Common/UI/Components/Icon/Icon";
import Tooltip from "Common/UI/Components/Tooltip/Tooltip";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A CLUSTER OVERVIEW'S RECENT WARNINGS.
 *
 * The warnings Kubernetes reported about the cluster in the last day, one
 * line per reason and object - three OOM kills on one node are one line
 * that says 3 - newest first: what happened, what it says, what it is
 * about (a link to its page), where, and who reported it. "View all
 * warnings" opens the cluster's Events page, which opens on its warnings.
 *
 * Shown only when there are warnings: a cluster with none has nothing to
 * say here.
 */

export interface ComponentProps {
  warnings: Array<KubernetesWarningSummary>;
  isLoading: boolean;
  clusterId: ObjectID;
}

const WarningLine: FunctionComponent<{
  warning: KubernetesWarningSummary;
  clusterId: ObjectID;
  clock: FeedClock;
}> = (props: {
  warning: KubernetesWarningSummary;
  clusterId: ObjectID;
  clock: FeedClock;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const warning: KubernetesWarningSummary = props.warning;
  const objectRoute: Route | null = getKubernetesObjectRoute({
    clusterId: props.clusterId,
    kind: warning.objectKind,
    name: warning.objectName,
  });
  const source: string = [warning.source, warning.sourceHost]
    .filter((part: string): boolean => {
      return Boolean(part);
    })
    .join(" · ");

  return (
    <li
      className="flex items-start gap-3 px-5 py-3.5 md:px-6"
      data-testid="kubernetes-recent-warning"
    >
      <div className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-amber-100">
        <Icon icon={IconProp.Alert} className="h-3.5 w-3.5 text-amber-600" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span
            className="text-sm font-medium text-gray-900 [overflow-wrap:anywhere]"
            data-testid="kubernetes-recent-warning-reason"
          >
            {warning.reason}
          </span>
          {warning.count > 1 ? (
            <span
              className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-amber-100 px-1.5 text-xs font-semibold text-amber-700"
              data-testid="kubernetes-recent-warning-count"
            >
              {translator.translateTemplate("{{count}} times", {
                count: translator.formatNumber(warning.count),
              })}
            </span>
          ) : (
            <></>
          )}
          {warning.lastSeenAt ? (
            <Tooltip text={formatFeedFullTime(warning.lastSeenAt, props.clock)}>
              <time
                dateTime={warning.lastSeenAt.toISOString()}
                className="ml-auto flex-shrink-0 text-xs text-gray-500"
              >
                {formatFeedTimeAgo(warning.lastSeenAt, props.clock)}
              </time>
            </Tooltip>
          ) : (
            <></>
          )}
        </div>
        {warning.message ? (
          <p
            className="line-clamp-2 text-sm text-gray-600 [overflow-wrap:anywhere]"
            title={warning.message}
            data-testid="kubernetes-recent-warning-message"
          >
            {warning.message}
          </p>
        ) : (
          <></>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
          <span
            className="inline-flex max-w-full items-center gap-1 rounded bg-gray-100 px-1.5 py-0.5 font-medium text-gray-600"
            data-testid="kubernetes-recent-warning-object"
          >
            <span className="text-gray-500">{warning.objectKind}</span>
            {objectRoute ? (
              <AppLink
                to={objectRoute}
                className="truncate text-indigo-600 hover:text-indigo-800 hover:underline"
              >
                {warning.objectName}
              </AppLink>
            ) : (
              <span className="truncate">{warning.objectName}</span>
            )}
          </span>
          {warning.namespace ? (
            <span
              className="inline-flex rounded bg-indigo-50 px-1.5 py-0.5 font-medium text-indigo-600"
              data-testid="kubernetes-recent-warning-namespace"
            >
              {warning.namespace}
            </span>
          ) : (
            <></>
          )}
          {source ? (
            <span
              className="text-gray-500 [overflow-wrap:anywhere]"
              data-testid="kubernetes-recent-warning-source"
            >
              {translator.translateTemplate("Reported by {{source}}", {
                source: source,
              })}
            </span>
          ) : (
            <></>
          )}
        </div>
      </div>
    </li>
  );
};

const KubernetesRecentWarningsCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  if (props.isLoading) {
    return (
      <Card
        title="Recent Warnings"
        description="Latest warning events from the cluster."
      >
        <ComponentLoader />
      </Card>
    );
  }

  if (props.warnings.length === 0) {
    return <></>;
  }

  const clock: FeedClock = getFeedClock({ language: translator.language });
  const eventsRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_EVENTS] as Route,
    { modelId: props.clusterId },
  );

  return (
    <Card
      title="Recent Warnings"
      description="Latest warning events from the cluster."
    >
      <ul
        className="-mx-5 divide-y divide-gray-100 md:-mx-6"
        data-testid="kubernetes-recent-warnings"
      >
        {props.warnings.map((warning: KubernetesWarningSummary) => {
          return (
            <WarningLine
              key={warning.key}
              warning={warning}
              clusterId={props.clusterId}
              clock={clock}
            />
          );
        })}
      </ul>
      <div className="-mx-5 -mb-6 border-t border-gray-100 px-5 py-3 md:-mx-6 md:px-6">
        <AppLink
          to={eventsRoute}
          className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-800"
        >
          <span>{translator.translateText("View all warnings")}</span>
          <Icon icon={IconProp.ArrowRight} className="h-4 w-4" />
        </AppLink>
      </div>
    </Card>
  );
};

export default KubernetesRecentWarningsCard;
