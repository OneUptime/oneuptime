import React, { FunctionComponent, ReactElement, useMemo } from "react";
import { FacetData, FacetValue, ActiveFilter, FacetConfig } from "../types";
import TelemetryFacetSection from "./TelemetryFacetSection";
import ComponentLoader from "../../ComponentLoader/ComponentLoader";

export interface TelemetryFacetSidebarProps {
  facetData: FacetData;
  isLoading: boolean;
  // Declarative facet config — ordering, titles, colors, display maps.
  facetConfigs: Array<FacetConfig>;
  onIncludeFilter: (facetKey: string, value: string) => void;
  onExcludeFilter: (facetKey: string, value: string) => void;
  activeFilters?: Array<ActiveFilter> | undefined;
  headerLabel?: string | undefined;
}

const TelemetryFacetSidebar: FunctionComponent<TelemetryFacetSidebarProps> = (
  props: TelemetryFacetSidebarProps,
): ReactElement => {
  const orderedConfigs: Array<FacetConfig> = useMemo(() => {
    const copy: Array<FacetConfig> = [...props.facetConfigs];
    copy.sort((a: FacetConfig, b: FacetConfig): number => {
      const aPriority: number = a.priority ?? 100;
      const bPriority: number = b.priority ?? 100;
      if (aPriority !== bPriority) {
        return aPriority - bPriority;
      }
      return a.title.localeCompare(b.title);
    });
    return copy;
  }, [props.facetConfigs]);

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
          {props.headerLabel || "Filters"}
        </h3>
      </div>

      {props.isLoading && Object.keys(props.facetData).length === 0 && (
        <div className="flex flex-1 items-center justify-center py-8">
          <ComponentLoader />
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {orderedConfigs.map((config: FacetConfig) => {
          const values: Array<FacetValue> = props.facetData[config.key] || [];

          return (
            <TelemetryFacetSection
              key={config.key}
              facetKey={config.key}
              title={config.title}
              values={values}
              onIncludeValue={props.onIncludeFilter}
              onExcludeValue={props.onExcludeFilter}
              valueDisplayMap={config.valueDisplayMap}
              valueColorMap={config.valueColorMap}
              activeValues={activeValuesByKey[config.key]}
            />
          );
        })}
      </div>
    </div>
  );
};

export default TelemetryFacetSidebar;
