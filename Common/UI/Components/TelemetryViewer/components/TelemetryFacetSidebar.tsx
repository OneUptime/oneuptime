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
  /*
   * Called (debounced) when a search input changes for a facet whose config
   * has serverSearchable=true. Lets the parent re-issue a facets request
   * with the typed text scoped to that facet.
   */
  onFacetSearchChange?:
    | ((facetKey: string, searchText: string) => void)
    | undefined;
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

    const add: (key: string, value: string) => void = (
      key: string,
      value: string,
    ): void => {
      if (!map[key]) {
        map[key] = new Set<string>();
      }
      map[key]!.add(value);
    };

    if (props.activeFilters) {
      for (const filter of props.activeFilters) {
        add(filter.facetKey, filter.value);
        /*
         * Attribute-backed facets store chips as `attributes.<key>` while
         * the facet config is keyed by the raw attribute key — index both
         * so the facet row shows its selected state.
         */
        if (filter.facetKey.startsWith("attributes.")) {
          add(filter.facetKey.substring("attributes.".length), filter.value);
        }
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

          const onSearchChange: ((text: string) => void) | undefined =
            config.serverSearchable && props.onFacetSearchChange
              ? (text: string) => {
                  props.onFacetSearchChange!(config.key, text);
                }
              : undefined;

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
              onSearchChange={onSearchChange}
            />
          );
        })}
      </div>
    </div>
  );
};

export default TelemetryFacetSidebar;
