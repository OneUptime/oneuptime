import React, {
  FunctionComponent,
  ReactElement,
  useId,
  useState,
  useMemo,
} from "react";
import { FacetValue } from "../types";
import { getFacetValueDisplayLabel } from "../LogsEntityNames";
import TelemetryFacetValueRow from "../../TelemetryViewer/components/TelemetryFacetValueRow";
import IconProp from "../../../../Types/Icon/IconProp";
import FacetSectionHeader from "../../TelemetryViewer/components/FacetSectionHeader";
import FacetSearchInput from "../../TelemetryViewer/components/FacetSearchInput";
import FacetShowMoreButton from "../../TelemetryViewer/components/FacetShowMoreButton";
import useFacetSectionSearch, {
  FacetSectionSearch,
} from "../../TelemetryViewer/useFacetSectionSearch";
import { getFacetEmptyStateText } from "../../TelemetryViewer/FacetVisibility";
import {
  DisplayedFacetValues,
  FacetValueState,
  getDisplayedFacetValues,
} from "../../TelemetryViewer/FacetSelection";
import { Translator } from "../../../Utils/TranslateTemplate";
import useTranslator from "../../../Utils/UseTranslator";

export interface FacetSectionProps {
  title: string;
  values: Array<FacetValue>;
  initialVisibleCount?: number;
  // A value that is not filtering was clicked: keep only its rows.
  onIncludeValue: (key: string, value: string) => void;
  /*
   * A checked or excluded value was clicked: take its filter off. The
   * sidebar knows which chips put it there.
   */
  onClearValue: (key: string, value: string) => void;
  /*
   * Leave a value's rows out. Absent where the explorer cannot exclude: the
   * rows then carry no exclude button at all.
   */
  onExcludeValue?: ((key: string, value: string) => void) | undefined;
  facetKey: string;
  valueDisplayMap?: Record<string, string> | undefined;
  valueColorMap?: Record<string, string> | undefined;
  // Values that keep only their rows: drawn checked.
  activeValues?: Set<string> | undefined;
  // Values whose rows are left out: drawn as excluded.
  excludedValues?: Set<string> | undefined;
  // Values the page itself filters on: drawn set, not changeable here.
  lockedValues?: Set<string> | undefined;
  /*
   * When set, the search box also emits typed text to the parent (debounced)
   * so it can refetch values from the backend. Client-side filtering still
   * runs as defense-in-depth.
   */
  onSearchChange?: ((text: string) => void) | undefined;
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
  /*
   * The server stopped this facet's count at the query time limit (issue
   * #4707). The section says so, and its values (a resource facet still
   * lists its resources) are shown without counts.
   */
  isCountStopped?: boolean | undefined;
}

const DEFAULT_VISIBLE_COUNT: number = 5;
const SEARCH_THRESHOLD: number = 6;

const FacetSection: FunctionComponent<FacetSectionProps> = (
  props: FacetSectionProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isExpanded, setIsExpanded] = useState<boolean>(true);
  const [showAll, setShowAll] = useState<boolean>(false);
  const bodyId: string = useId();

  const showSearch: boolean =
    props.onSearchChange !== undefined ||
    props.values.length >= SEARCH_THRESHOLD;

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
        getFacetValueDisplayLabel(facet, props.valueDisplayMap) || facet.value;
      return displayName.toLowerCase().includes(query);
    });
  }, [props.values, props.valueDisplayMap, searchText]);

  const visibleCount: number =
    props.initialVisibleCount ?? DEFAULT_VISIBLE_COUNT;

  /*
   * Every value that is filtering stays on screen, so a checked or excluded
   * value is never folded behind "Show N more" where it cannot be cleared.
   */
  const pinnedValues: Set<string> = useMemo(() => {
    return new Set<string>([
      ...Array.from(props.activeValues || []),
      ...Array.from(props.excludedValues || []),
    ]);
  }, [props.activeValues, props.excludedValues]);

  const collapsed: DisplayedFacetValues = getDisplayedFacetValues({
    values: filteredValues,
    visibleCount: visibleCount,
    showAll: false,
    pinnedValues: pinnedValues,
  });

  const displayedValues: Array<FacetValue> =
    isSearching || showAll ? filteredValues : collapsed.displayed;

  const hasMore: boolean = !isSearching && collapsed.hiddenCount > 0;

  const maxCount: number =
    props.values.length > 0
      ? Math.max(
          ...props.values.map((v: FacetValue) => {
            return v.count;
          }),
        )
      : 0;

  // Checked and excluded values alike: every value this facet filters on.
  const activeCount: number = pinnedValues.size;

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
          {/*
           * Two words, not a sentence: why it was not counted is said once,
           * by the note at the top of the sidebar or by the message where
           * the rows go, rather than again in every facet it stopped.
           */}
          {props.isCountStopped && (
            <p
              className="px-1.5 pb-1 text-[11px] text-gray-500"
              data-testid="facet-count-stopped"
            >
              {translator.translateText("Not counted")}
            </p>
          )}

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
                displayValue={getFacetValueDisplayLabel(
                  facet,
                  props.valueDisplayMap,
                )}
                count={facet.count}
                maxCount={maxCount}
                isCountUnknown={props.isCountStopped}
                color={props.valueColorMap?.[facet.value]}
                state={
                  props.activeValues?.has(facet.value)
                    ? FacetValueState.Included
                    : props.excludedValues?.has(facet.value)
                      ? FacetValueState.Excluded
                      : FacetValueState.None
                }
                isLocked={props.lockedValues?.has(facet.value) || false}
                onInclude={(value: string) => {
                  props.onIncludeValue(props.facetKey, value);
                }}
                onClear={(value: string) => {
                  props.onClearValue(props.facetKey, value);
                }}
                onExclude={
                  props.onExcludeValue
                    ? (value: string) => {
                        props.onExcludeValue?.(props.facetKey, value);
                      }
                    : undefined
                }
              />
            );
          })}

          {displayedValues.length === 0 && !props.isCountStopped && (
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
            hiddenCount={collapsed.hiddenCount}
            onToggle={() => {
              setShowAll(!showAll);
            }}
          />
        </div>
      )}
    </div>
  );
};

export default FacetSection;
