import React, { FunctionComponent, ReactElement, useMemo } from "react";
import {
  FacetData,
  FacetValue,
  ActiveFilter,
  LogsSavedViewOption,
} from "../types";
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
  activeFilters?: Array<ActiveFilter> | undefined;
  savedViews?: Array<LogsSavedViewOption> | undefined;
  selectedSavedViewId?: string | null;
  onSavedViewSelect?: ((viewId: string) => void) | undefined;
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
  const severityColorMap: Record<string, string> = useMemo(() => {
    return buildSeverityColorMap();
  }, []);

  const serviceDisplayMap: Record<string, string> = useMemo(() => {
    return buildServiceDisplayMap(props.serviceMap);
  }, [props.serviceMap]);

  const serviceColorMap: Record<string, string> = useMemo(() => {
    return buildServiceColorMap(props.serviceMap);
  }, [props.serviceMap]);

  const facetKeys: Array<string> = useMemo(() => {
    const priorityKeys: Array<string> = ["severityText", "serviceId"];
    const otherKeys: Array<string> = Object.keys(props.facetData).filter(
      (key: string) => {
        return !priorityKeys.includes(key);
      },
    );
    return [
      ...priorityKeys.filter((key: string) => {
        return props.facetData[key] !== undefined;
      }),
      ...otherKeys.sort(),
    ];
  }, [props.facetData]);

  // Build a map of facetKey -> Set<activeValue>
  const activeValuesByKey: Record<string, Set<string>> = useMemo(() => {
    const map: Record<string, Set<string>> = {};

    if (props.activeFilters) {
      for (const filter of props.activeFilters) {
        if (!map[filter.facetKey]) {
          map[filter.facetKey] = new Set<string>();
        }

        map[filter.facetKey]!.add(filter.value);
      }
    }

    return map;
  }, [props.activeFilters]);

  return (
    <div className="flex h-full w-56 flex-none flex-col overflow-y-auto rounded-lg border border-gray-200 bg-white">
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
        {props.savedViews && props.savedViews.length > 0 && (
          <div className="border-b border-gray-100 px-3 py-3">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
              Saved Views
            </p>

            <div className="space-y-1.5">
              {props.savedViews.map((view: LogsSavedViewOption) => {
                const isSelected: boolean =
                  view.id === props.selectedSavedViewId;

                return (
                  <button
                    key={view.id}
                    type="button"
                    className={`flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-sm transition-colors ${
                      isSelected
                        ? "bg-indigo-50 text-indigo-700"
                        : "text-gray-600 hover:bg-gray-50 hover:text-gray-800"
                    }`}
                    onClick={() => {
                      props.onSavedViewSelect?.(view.id);
                    }}
                  >
                    <span className="truncate">{view.name}</span>
                    {view.isDefault && (
                      <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                        Default
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {facetKeys.map((key: string) => {
          const values: Array<FacetValue> = props.facetData[key] || [];

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
              activeValues={activeValuesByKey[key]}
            />
          );
        })}
      </div>
    </div>
  );
};

export default LogsFacetSidebar;
