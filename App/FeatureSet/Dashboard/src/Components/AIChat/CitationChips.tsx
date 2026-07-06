import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import {
  AIChatCitation,
  AIChatCitationTargetType,
} from "Common/Types/AI/AIChatTypes";
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
    <div className="mt-2 flex flex-wrap gap-1.5">
      {props.citations.map((citation: AIChatCitation) => {
        const isEmpty: boolean = citation.rowCount === 0;
        const isNavigable: boolean = Boolean(citation.target);

        return (
          <button
            key={citation.id}
            type="button"
            disabled={!isNavigable}
            title={
              isEmpty ? `${citation.label} — checked, 0 rows` : citation.label
            }
            onClick={() => {
              navigateToCitation(citation);
            }}
            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${
              isEmpty
                ? "border-gray-200 text-gray-400"
                : "border-indigo-200 text-indigo-700 bg-indigo-50"
            } ${isNavigable ? "cursor-pointer hover:bg-indigo-100" : "cursor-default"}`}
          >
            <span className="font-semibold mr-1">{citation.id}</span>
            <span className="max-w-xs truncate">{citation.label}</span>
          </button>
        );
      })}
    </div>
  );
};

export default CitationChips;
