import React, { FunctionComponent, ReactElement, useMemo } from "react";
import { FacetData } from "../types";
import FacetSection from "./FacetSection";
import Service from "../../../../Models/DatabaseModels/Service";
import Dictionary from "../../../../Types/Dictionary";
import ComponentLoader from "../../ComponentLoader/ComponentLoader";
import { getSeverityColor } from "./severityColors";
import LogSeverity from "../../../../Types/Log/LogSeverity";

export interface LogsFacetSidebarProps {
  facetData: FacetData;
  isLoading: boolean;
  serviceMap: Dictionary<Service>;
  onIncludeFilter: (facetKey: string, value: string) => void;
  onExcludeFilter: (facetKey: string, value: string) => void;
}

const SEVERITY_ORDER: Array<string> = [
  LogSeverity.Fatal,
  LogSeverity.Error,
  LogSeverity.Warning,
  LogSeverity.Information,
  LogSeverity.Debug,
  LogSeverity.Trace,
  LogSeverity.Unspecified,
];

function buildSeverityColorMap(): Record<string, string> {
  const map: Record<string, string> = {};

  for (const severity of SEVERITY_ORDER) {
    map[severity] = getSeverityColor(severity).fill;
  }

  return map;
}

function buildServiceDisplayMap(
  serviceMap: Dictionary<Service>,
): Record<string, string> {
  const map: Record<string, string> = {};

  for (const [id, service] of Object.entries(serviceMap)) {
    if (service?.name) {
      map[id] = service.name;
    }
  }

  return map;
}

function buildServiceColorMap(
  serviceMap: Dictionary<Service>,
): Record<string, string> {
  const map: Record<string, string> = {};

  for (const [id, service] of Object.entries(serviceMap)) {
    if (service?.serviceColor) {
      map[id] = service.serviceColor.toString();
    }
  }

  return map;
}

function getFacetTitle(key: string): string {
  const titleMap: Record<string, string> = {
    severityText: "Severity",
    serviceId: "Service",
    traceId: "Trace ID",
    spanId: "Span ID",
  };

  return titleMap[key] || key;
}

const LogsFacetSidebar: FunctionComponent<LogsFacetSidebarProps> = (
  props: LogsFacetSidebarProps,
): ReactElement => {
  const severityColorMap: Record<string, string> = useMemo(
    () => buildSeverityColorMap(),
    [],
  );

  const serviceDisplayMap: Record<string, string> = useMemo(
    () => buildServiceDisplayMap(props.serviceMap),
    [props.serviceMap],
  );

  const serviceColorMap: Record<string, string> = useMemo(
    () => buildServiceColorMap(props.serviceMap),
    [props.serviceMap],
  );

  const facetKeys: Array<string> = useMemo(() => {
    const priorityKeys: Array<string> = ["severityText", "serviceId"];
    const otherKeys: Array<string> = Object.keys(props.facetData).filter(
      (key: string) => !priorityKeys.includes(key),
    );
    return [
      ...priorityKeys.filter(
        (key: string) => props.facetData[key] !== undefined,
      ),
      ...otherKeys.sort(),
    ];
  }, [props.facetData]);

  return (
    <div className="flex h-full w-52 flex-none flex-col overflow-y-auto rounded-lg border border-gray-200 bg-white">
      <div className="border-b border-gray-100 px-3 py-2.5">
        <h3 className="text-[11px] font-semibold uppercase tracking-widest text-gray-400">
          Filters
        </h3>
      </div>

      {props.isLoading && Object.keys(props.facetData).length === 0 && (
        <div className="flex flex-1 items-center justify-center py-8">
          <ComponentLoader />
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {facetKeys.map((key: string) => {
          const values = props.facetData[key] || [];

          let valueDisplayMap: Record<string, string> | undefined;
          let valueColorMap: Record<string, string> | undefined;

          if (key === "serviceId") {
            valueDisplayMap = serviceDisplayMap;
            valueColorMap = serviceColorMap;
          } else if (key === "severityText") {
            valueColorMap = severityColorMap;
          }

          return (
            <FacetSection
              key={key}
              facetKey={key}
              title={getFacetTitle(key)}
              values={values}
              onIncludeValue={props.onIncludeFilter}
              onExcludeValue={props.onExcludeFilter}
              valueDisplayMap={valueDisplayMap}
              valueColorMap={valueColorMap}
            />
          );
        })}
      </div>
    </div>
  );
};

export default LogsFacetSidebar;
