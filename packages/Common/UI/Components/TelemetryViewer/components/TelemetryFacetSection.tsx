import React, {
  FunctionComponent,
  ReactElement,
  useId,
  useState,
  useMemo,
} from "react";
import { FacetValue } from "../types";
import TelemetryFacetValueRow from "./TelemetryFacetValueRow";
import IconProp from "../../../../Types/Icon/IconProp";
import FacetSectionHeader from "./FacetSectionHeader";
import FacetSearchInput from "./FacetSearchInput";
import FacetShowMoreButton from "./FacetShowMoreButton";
import useFacetSectionSearch, {
  FacetSectionSearch,
} from "../useFacetSectionSearch";
import { getFacetEmptyStateText } from "../FacetVisibility";

export interface TelemetryFacetSectionProps {
  title: string;
  values: Array<FacetValue>;
  initialVisibleCount?: number;
  onIncludeValue: (key: string, value: string) => void;
  onExcludeValue: (key: string, value: string) => void;
  facetKey: string;
  valueDisplayMap?: Record<string, string> | undefined;
  valueColorMap?: Record<string, string> | undefined;
  activeValues?: Set<string> | undefined;
  defaultExpanded?: boolean;
  /*
   * When set, the search box also emits typed text to the parent (debounced)
   * so it can refetch values from the backend. Client-side filtering still
   * runs as defense-in-depth — the server response replaces props.values
   * which then flows through the local filter.
   */
  onSearchChange?: ((text: string) => void) | undefined;
  // Force the search input to render even when below the local item threshold.
  alwaysShowSearch?: boolean;
  // Optional icon shown before the title.
  icon?: IconProp | undefined;
  /*
   * Controlled search text. The sidebar owns it so it can keep a section
   * that is being searched on screen, and so the box survives a remount.
   * Leave undefined for the section to keep its own.
   */
  searchText?: string | undefined;
  onSearchTextChange?: ((text: string) => void) | undefined;
  /*
   * Shown when there are no values and no search. Defaults to "No values in
   * this time range".
   */
  emptyStateText?: string | undefined;
}

const DEFAULT_VISIBLE_COUNT: number = 5;
const SEARCH_THRESHOLD: number = 6;

const TelemetryFacetSection: FunctionComponent<TelemetryFacetSectionProps> = (
  props: TelemetryFacetSectionProps,
): ReactElement => {
  const [isExpanded, setIsExpanded] = useState<boolean>(
    props.defaultExpanded !== false,
  );
  const [showAll, setShowAll] = useState<boolean>(false);
  const bodyId: string = useId();

  const showSearch: boolean =
    props.alwaysShowSearch === true ||
    props.onSearchChange !== undefined ||
    props.values.length >= SEARCH_THRESHOLD;

  /*
   * Debounce the upward search emit so each keystroke doesn't fire a
   * round-trip. Local filter still applies immediately for fast feedback
   * against the currently loaded set.
   */
  const search: FacetSectionSearch = useFacetSectionSearch({
    searchText: props.searchText,
    onSearchTextChange: props.onSearchTextChange,
    onSearchChange: props.onSearchChange,
    isSearchVisible: showSearch,
  });

  const searchText: string = search.activeSearchText;
  const isSearching: boolean = searchText.trim() !== "";

  const filteredValues: Array<FacetValue> = useMemo(() => {
    if (!searchText.trim()) {
      return props.values;
    }
    const query: string = searchText.toLowerCase().trim();
    return props.values.filter((facet: FacetValue) => {
      const displayName: string =
        facet.displayName ??
        props.valueDisplayMap?.[facet.value] ??
        facet.value;
      return displayName.toLowerCase().includes(query);
    });
  }, [props.values, props.valueDisplayMap, searchText]);

  const visibleCount: number =
    props.initialVisibleCount ?? DEFAULT_VISIBLE_COUNT;

  const displayedValues: Array<FacetValue> = isSearching
    ? filteredValues
    : showAll
      ? filteredValues
      : filteredValues.slice(0, visibleCount);

  const hasMore: boolean = !isSearching && filteredValues.length > visibleCount;

  const maxCount: number =
    props.values.length > 0
      ? Math.max(
          ...props.values.map((v: FacetValue) => {
            return v.count;
          }),
        )
      : 0;

  const activeCount: number = props.activeValues ? props.activeValues.size : 0;

  return (
    <div className="border-b border-gray-100 py-2">
      <FacetSectionHeader
        title={props.title}
        icon={props.icon}
        activeCount={activeCount}
        isExpanded={isExpanded}
        controlsId={bodyId}
        onToggle={() => {
          setIsExpanded(!isExpanded);
        }}
      />

      {isExpanded && (
        <div id={bodyId} className="mt-1 px-1">
          {showSearch && (
            <div className="mb-1 px-1">
              <FacetSearchInput
                title={props.title}
                value={search.searchText}
                onChange={search.setSearchText}
              />
            </div>
          )}

          {displayedValues.map((facet: FacetValue) => {
            return (
              <TelemetryFacetValueRow
                key={facet.value}
                value={facet.value}
                displayValue={
                  facet.displayName ?? props.valueDisplayMap?.[facet.value]
                }
                count={facet.count}
                maxCount={maxCount}
                color={props.valueColorMap?.[facet.value]}
                isActive={props.activeValues?.has(facet.value) || false}
                onInclude={(value: string) => {
                  props.onIncludeValue(props.facetKey, value);
                }}
                onExclude={(value: string) => {
                  props.onExcludeValue(props.facetKey, value);
                }}
              />
            );
          })}

          {displayedValues.length === 0 && (
            <p className="px-1.5 py-2 text-[11px] text-gray-400">
              {getFacetEmptyStateText({
                searchText: searchText,
                emptyStateText: props.emptyStateText,
              })}
            </p>
          )}

          <FacetShowMoreButton
            hasMore={hasMore}
            isShowingAll={showAll}
            hiddenCount={Math.max(0, filteredValues.length - visibleCount)}
            onToggle={() => {
              setShowAll(!showAll);
            }}
          />
        </div>
      )}
    </div>
  );
};

export default TelemetryFacetSection;
