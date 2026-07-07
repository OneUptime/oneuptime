import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import {
  AIChatCitation,
  AIChatCitationTargetType,
} from "Common/Types/AI/AIChatTypes";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  citations: Array<AIChatCitation>;
}

const targetTypeToPageMap: { [key in AIChatCitationTargetType]: PageMap } = {
  [AIChatCitationTargetType.Logs]: PageMap.LOGS,
  [AIChatCitationTargetType.Traces]: PageMap.TRACES,
  [AIChatCitationTargetType.TraceView]: PageMap.TRACE_VIEW,
  [AIChatCitationTargetType.Metrics]: PageMap.METRICS,
  [AIChatCitationTargetType.Exceptions]: PageMap.EXCEPTIONS,
  [AIChatCitationTargetType.Incidents]: PageMap.INCIDENTS,
  [AIChatCitationTargetType.IncidentView]: PageMap.INCIDENT_VIEW,
  [AIChatCitationTargetType.Alerts]: PageMap.ALERTS,
  [AIChatCitationTargetType.AlertView]: PageMap.ALERT_VIEW,
  [AIChatCitationTargetType.Monitors]: PageMap.MONITORS,
  [AIChatCitationTargetType.MonitorView]: PageMap.MONITOR_VIEW,
};

const targetTypeToIcon: { [key in AIChatCitationTargetType]: IconProp } = {
  [AIChatCitationTargetType.Logs]: IconProp.Logs,
  [AIChatCitationTargetType.Traces]: IconProp.Activity,
  [AIChatCitationTargetType.TraceView]: IconProp.Activity,
  [AIChatCitationTargetType.Metrics]: IconProp.ChartBar,
  [AIChatCitationTargetType.Exceptions]: IconProp.Error,
  [AIChatCitationTargetType.Incidents]: IconProp.Alert,
  [AIChatCitationTargetType.IncidentView]: IconProp.Alert,
  [AIChatCitationTargetType.Alerts]: IconProp.Bell,
  [AIChatCitationTargetType.AlertView]: IconProp.Bell,
  [AIChatCitationTargetType.Monitors]: IconProp.Cube,
  [AIChatCitationTargetType.MonitorView]: IconProp.Cube,
};

/*
 * Server-minted citation chips. A chip with rowCount 0 is proof of absence —
 * the query ran and found nothing — and renders muted.
 */
const CitationChips: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (!props.citations || props.citations.length === 0) {
    return <></>;
  }

  const navigateToCitation: (citation: AIChatCitation) => void = (
    citation: AIChatCitation,
  ): void => {
    if (!citation.target) {
      return;
    }

    const pageMapKey: PageMap | undefined =
      targetTypeToPageMap[citation.target.type];

    const route: Route | undefined = pageMapKey
      ? (RouteMap[pageMapKey] as Route)
      : undefined;

    if (!route) {
      return;
    }

    const params: { [key: string]: string } = citation.target.params || {};
    const firstParamValue: string | undefined = Object.values(params)[0];

    Navigation.navigate(
      RouteUtil.populateRouteParams(
        route,
        firstParamValue ? { modelId: firstParamValue } : undefined,
      ),
    );
  };

  return (
    <div>
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
        Sources
      </div>
      <div className="flex flex-wrap gap-1.5">
        {props.citations.map((citation: AIChatCitation) => {
          const isEmpty: boolean = citation.rowCount === 0;
          const isNavigable: boolean = Boolean(citation.target);
          const icon: IconProp = citation.target
            ? targetTypeToIcon[citation.target.type]
            : IconProp.Search;

          return (
            <button
              key={citation.id}
              type="button"
              disabled={!isNavigable}
              title={
                isEmpty
                  ? `${citation.label} — checked, found nothing`
                  : citation.label
              }
              onClick={() => {
                navigateToCitation(citation);
              }}
              className={`group inline-flex max-w-full items-center gap-1.5 rounded-full border py-1 pl-1.5 pr-2.5 text-xs transition-colors ${
                isEmpty
                  ? "border-gray-200 bg-gray-50 text-gray-400"
                  : "border-indigo-100 bg-indigo-50 text-indigo-700"
              } ${
                isNavigable && !isEmpty
                  ? "cursor-pointer hover:border-indigo-300 hover:bg-indigo-100"
                  : isNavigable
                    ? "cursor-pointer hover:bg-gray-100"
                    : "cursor-default"
              }`}
            >
              <span
                className={`flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold ${
                  isEmpty
                    ? "bg-gray-200 text-gray-500"
                    : "bg-indigo-600 text-white"
                }`}
              >
                {citation.id.replace("C", "")}
              </span>
              <Icon icon={icon} className="h-3 w-3 flex-shrink-0" />
              <span className="truncate">{citation.label}</span>
              <span
                className={`rounded-full px-1.5 text-[10px] font-medium ${
                  isEmpty
                    ? "bg-gray-100 text-gray-400"
                    : "bg-white/70 text-indigo-600"
                }`}
              >
                {isEmpty ? "0 rows" : `${citation.rowCount}`}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default CitationChips;
