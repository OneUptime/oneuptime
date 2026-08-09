import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  getHumanVerdictElement,
  getInsightTypeIcon,
  getInsightTypeLabel,
  getSeverityInlineElement,
  getSeverityTileClasses,
  getStatusElement,
} from "./InsightPresentation";
import AIInsight from "Common/Models/DatabaseModels/AIInsight";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  insight: AIInsight;
}

interface MetaItem {
  element: ReactElement;
  // Repeats a column that only the wide layout has room for.
  isSmallScreenOnly?: boolean | undefined;
}

/*
 * One row of the insights inbox.
 *
 * Wide screens get table-like alignment — status, detections and last-seen
 * ride in fixed-width right-hand columns under the list's column header — so
 * the eye can run straight down each of them. Below `lg` those columns have
 * nowhere to go, so the same facts fold into the meta line under the title.
 */
const InsightListItem: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const insight: AIInsight = props.insight;

  const viewRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.AI_INSIGHT_VIEW] as Route,
    { modelId: insight.id! },
  );

  const occurrenceCount: number = insight.occurrenceCount || 0;
  const detectionsLabel: string =
    occurrenceCount === 1 ? "1 detection" : `${occurrenceCount} detections`;

  const lastSeenLabel: string = insight.lastSeenAt
    ? OneUptimeDate.fromNow(insight.lastSeenAt)
    : "";
  const lastSeenTitle: string = insight.lastSeenAt
    ? OneUptimeDate.getDateAsLocalFormattedString(insight.lastSeenAt)
    : "";

  const metaItems: Array<MetaItem> = [];

  if (insight.severity) {
    metaItems.push({ element: getSeverityInlineElement(insight.severity) });
  }

  if (insight.insightType) {
    metaItems.push({
      element: <span>{getInsightTypeLabel(insight.insightType)}</span>,
    });
  }

  if (insight.serviceName) {
    metaItems.push({
      element: (
        <span className="inline-flex min-w-0 items-center gap-1">
          <span className="flex-shrink-0">
            <Icon icon={IconProp.Cube} className="h-3.5 w-3.5" />
          </span>
          <span className="truncate">{insight.serviceName}</span>
        </span>
      ),
    });
  }

  if (insight.humanVerdict) {
    metaItems.push({ element: getHumanVerdictElement(insight.humanVerdict) });
  }

  if (insight.status) {
    metaItems.push({
      element: getStatusElement(insight.status),
      isSmallScreenOnly: true,
    });
  }

  if (occurrenceCount > 0) {
    metaItems.push({
      element: <span>{detectionsLabel}</span>,
      isSmallScreenOnly: true,
    });
  }

  if (lastSeenLabel) {
    metaItems.push({
      element: <span>{lastSeenLabel}</span>,
      isSmallScreenOnly: true,
    });
  }

  return (
    <li>
      <Link
        to={viewRoute}
        className="group flex items-center gap-4 px-4 py-3.5 transition-colors hover:bg-gray-50 focus:outline-none focus-visible:bg-indigo-50"
      >
        <span
          className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg ${getSeverityTileClasses(
            insight.severity,
          )}`}
        >
          <Icon
            icon={getInsightTypeIcon(insight.insightType)}
            className="h-5 w-5"
          />
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-gray-900 group-hover:text-indigo-600">
            {insight.title}
          </p>

          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
            {metaItems.map((item: MetaItem, index: number) => {
              return (
                <React.Fragment key={index}>
                  {index > 0 ? (
                    <span
                      aria-hidden="true"
                      className={`text-gray-300 ${
                        item.isSmallScreenOnly ? "lg:hidden" : ""
                      }`}
                    >
                      &bull;
                    </span>
                  ) : (
                    <></>
                  )}
                  <span
                    className={`inline-flex min-w-0 items-center ${
                      item.isSmallScreenOnly ? "lg:hidden" : ""
                    }`}
                  >
                    {item.element}
                  </span>
                </React.Fragment>
              );
            })}
          </div>
        </div>

        <div className="hidden w-32 flex-shrink-0 lg:block">
          {getStatusElement(insight.status)}
        </div>
        <div className="hidden w-24 flex-shrink-0 text-right text-sm tabular-nums text-gray-700 lg:block">
          {occurrenceCount > 0 ? occurrenceCount : <span>&mdash;</span>}
        </div>
        <div
          className="hidden w-36 flex-shrink-0 truncate text-right text-xs text-gray-500 lg:block"
          title={lastSeenTitle}
        >
          {lastSeenLabel}
        </div>
        <span className="hidden flex-shrink-0 text-gray-300 transition-colors group-hover:text-indigo-500 lg:block">
          <Icon icon={IconProp.ChevronRight} className="h-5 w-5" />
        </span>
      </Link>
    </li>
  );
};

export default InsightListItem;
