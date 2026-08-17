import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  AIInsightExplorerLink,
  buildInsightInvestigationLink,
} from "../../Utils/AIInsightExplorerLinks";
import { formatDroppedScopeHint } from "../../Utils/MetricsCrossSignalPivot";
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

/*
 * The keyboard focus indicator is a ring, not a tinted background. Theme.css
 * remaps light Tailwind utilities by exact class token; it covers
 * focus-visible:ring-indigo-* but has no focus-visible:bg-* rule at all, so a
 * tinted focus background would keep its literal indigo-50 in dark mode and
 * put near-white text on a near-white row. ring-inset because the list frame
 * is rounded-xl + overflow-hidden, which clips an outward ring on the first
 * and last rows.
 *
 * The `group` marker lives on the <li>, not here: the row's investigate
 * affordance is a SIBLING anchor of this Link (an anchor nested inside an
 * anchor is invalid HTML), and it needs the same hover scope as the
 * group-hover styling inside the row.
 */
const ROW_CLASS_NAME: string =
  "flex items-center gap-4 px-4 py-3.5 transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500";

interface MetaItem {
  element: ReactElement;
  /*
   * Repeats one of the right-hand columns. Only one of the two copies is ever
   * displayed, so assistive technology never reads the fact twice.
   */
  isNarrowLayoutOnly?: boolean | undefined;
}

/*
 * One row of the insights inbox.
 *
 * From xl up the row is table-aligned: status, detections and last-seen ride
 * in fixed-width right-hand columns under the list's column header, so the eye
 * can run straight down any of them. The gate is xl rather than lg because the
 * page reserves a 15rem side menu — at 1024px the fixed columns would leave the
 * title about 10rem and ellipsize it after a word or two. Below xl the same
 * facts fold into the meta line under the title.
 */
const InsightListItem: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const insight: AIInsight = props.insight;

  const viewRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.AI_INSIGHT_VIEW] as Route,
    { modelId: insight.id! },
  );

  /*
   * The one-click investigate deep link (same builder as the detail page's
   * primary action). List rows never resolve service names — the stored
   * telemetryServiceId is used when present and the scope otherwise
   * degrades inside the builder — so rendering the list costs no extra
   * queries. Null (no affordance) for unknown detector types.
   */
  const investigationLink: AIInsightExplorerLink | null =
    buildInsightInvestigationLink({
      insightType: insight.insightType,
      serviceName: insight.serviceName,
      serviceId: insight.telemetryServiceId?.toString(),
      telemetryExceptionId: insight.telemetryExceptionId?.toString(),
      metricName: insight.metricName,
      lastSeenAt: insight.lastSeenAt,
    });

  const investigationTitle: string = investigationLink
    ? [
        investigationLink.label,
        formatDroppedScopeHint(investigationLink.dropped),
      ]
        .filter((sentence: string) => {
          return sentence.length > 0;
        })
        .join(" — ")
    : "";

  const occurrenceCount: number = insight.occurrenceCount || 0;
  const detectionsLabel: string =
    occurrenceCount === 1 ? "1 detection" : `${occurrenceCount} detections`;

  const lastSeenLabel: string = insight.lastSeenAt
    ? OneUptimeDate.fromNow(insight.lastSeenAt)
    : "";
  // Undefined rather than "" so the attribute is omitted, not rendered empty.
  const lastSeenTitle: string | undefined = insight.lastSeenAt
    ? OneUptimeDate.getDateAsLocalFormattedString(insight.lastSeenAt)
    : undefined;

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
          <span className="truncate" title={insight.serviceName}>
            {insight.serviceName}
          </span>
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
      isNarrowLayoutOnly: true,
    });
  }

  if (occurrenceCount > 0) {
    metaItems.push({
      element: <span>{detectionsLabel}</span>,
      isNarrowLayoutOnly: true,
    });
  }

  if (lastSeenLabel) {
    metaItems.push({
      /*
       * Carries the absolute timestamp too — it used to be reachable only from
       * the wide layout's column, so on a tablet or phone there was no way to
       * turn "3 days ago" into a date.
       */
      element: <span title={lastSeenTitle}>{lastSeenLabel}</span>,
      isNarrowLayoutOnly: true,
    });
  }

  return (
    /*
     * `relative` + `group` so the investigate affordance below can overlay
     * the row's chevron slot and share its hover scope while remaining a
     * sibling of the row link (anchors must not nest).
     */
    <li className="group relative">
      <Link to={viewRoute} className={ROW_CLASS_NAME}>
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
                        item.isNarrowLayoutOnly ? "xl:hidden" : ""
                      }`}
                    >
                      &bull;
                    </span>
                  ) : (
                    <></>
                  )}
                  <span
                    className={`inline-flex min-w-0 items-center ${
                      item.isNarrowLayoutOnly ? "xl:hidden" : ""
                    }`}
                  >
                    {item.element}
                  </span>
                </React.Fragment>
              );
            })}
          </div>
        </div>

        {/*
         * The column header labels these three, but a header row is not table
         * semantics — nothing associates it with the cells. Each cell carries
         * its own unit for assistive technology, which the narrow layout gets
         * from the meta line above.
         */}
        <div className="hidden w-32 flex-shrink-0 xl:block">
          {getStatusElement(insight.status)}
        </div>
        <div className="hidden w-24 flex-shrink-0 text-right text-sm tabular-nums text-gray-700 xl:block">
          {occurrenceCount > 0 ? (
            <React.Fragment>
              {occurrenceCount}
              <span className="sr-only"> {detectionsLabel}</span>
            </React.Fragment>
          ) : (
            <React.Fragment>
              <span aria-hidden="true">&mdash;</span>
              <span className="sr-only">No detections recorded</span>
            </React.Fragment>
          )}
        </div>
        <div
          className="hidden w-36 flex-shrink-0 truncate text-right text-xs text-gray-500 xl:block"
          title={lastSeenTitle}
        >
          <span className="sr-only">Last seen </span>
          {lastSeenLabel}
        </div>
        {/* Fades out under the investigate affordance that replaces it. */}
        <span
          className={`hidden flex-shrink-0 text-gray-300 transition group-hover:text-indigo-500 xl:block ${
            investigationLink
              ? "group-hover:opacity-0 group-focus-within:opacity-0"
              : ""
          }`}
        >
          <Icon icon={IconProp.ChevronRight} className="h-5 w-5" />
        </span>
      </Link>

      {investigationLink ? (
        /*
         * The one-click investigate deep link, shown in the chevron's slot
         * on hover/focus from xl up (below xl the detail page carries the
         * same action). pointer-events-none while invisible so the hidden
         * anchor never steals a click meant for the row; keyboard focus is
         * unaffected by pointer-events and reveals it via focus:opacity.
         */
        <Link
          to={investigationLink.route}
          title={investigationTitle}
          className="pointer-events-none absolute right-2.5 top-1/2 z-10 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full text-gray-400 opacity-0 transition-opacity hover:text-indigo-600 focus:pointer-events-auto focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 group-hover:pointer-events-auto group-hover:opacity-100 xl:flex"
        >
          <Icon icon={investigationLink.icon} className="h-5 w-5" />
        </Link>
      ) : (
        <></>
      )}
    </li>
  );
};

export default InsightListItem;
