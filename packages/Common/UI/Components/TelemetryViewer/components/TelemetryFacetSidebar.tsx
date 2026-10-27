import React, {
  FunctionComponent,
  ReactElement,
  useId,
  useMemo,
  useState,
} from "react";
import { Translator } from "../../../Utils/TranslateTemplate";
import useTranslator from "../../../Utils/UseTranslator";
import { FacetData, FacetValue, ActiveFilter, FacetConfig } from "../types";
import TelemetryFacetSection from "./TelemetryFacetSection";
import ComponentLoader from "../../ComponentLoader/ComponentLoader";
import HiddenFacetsFooter from "./HiddenFacetsFooter";
import {
  FacetVisibility,
  computeFacetVisibility,
  getFacetValuesInScope,
  getSidebarFacetEmptyStateText,
} from "../FacetVisibility";
import useFacetSearchExemptions, {
  FacetSearchExemptions,
} from "../useFacetSearchExemptions";
import {
  FacetSectionSelection,
  FacetSelections,
  buildFacetSelections,
  getFacetChipsToClear,
  getFacetSectionSelection,
  getSelectedValuesByKey,
  withSelectedFacetValues,
} from "../FacetSelection";
import TelemetryLoadErrorMessage from "./TelemetryLoadErrorMessage";
import {
  TelemetryLoadError,
  TelemetryLoadErrorKind,
} from "../../../Utils/Telemetry/TelemetryLoadError";

// The sidebar's loader, shown while there is nothing to list yet.
export const TELEMETRY_FACET_SIDEBAR_LOADER_TEST_ID: string =
  "telemetry-facet-sidebar-loader";

export interface TelemetryFacetSidebarProps {
  facetData: FacetData;
  isLoading: boolean;
  // Declarative facet config — ordering, titles, colors, display maps.
  facetConfigs: Array<FacetConfig>;
  // An unchecked value was clicked: keep only its rows.
  onIncludeFilter: (facetKey: string, value: string) => void;
  /*
   * Leave a value's rows out (and drop an include of it). Absent where the
   * explorer cannot exclude: the rows then carry no exclude button.
   */
  onExcludeFilter?: ((facetKey: string, value: string) => void) | undefined;
  /*
   * Take one chip off - the chip's own x. A click on a checked or excluded
   * value takes off the chips that put it there, through this.
   */
  onRemoveFilter: (facetKey: string, value: string) => void;
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
  // Lets a disclosure toggle point at the panel with aria-controls.
  id?: string | undefined;
  /*
   * Below md the sidebar stacks above the list at full width rather than
   * sitting beside it. When true it is also folded away there, until the
   * caller's toggle opens it. From md up it always shows. The fold is CSS
   * only, so the sidebar stays mounted and keeps its search and expand state.
   */
  isCollapsedOnSmallScreens?: boolean | undefined;
  /*
   * The viewer is pinned to a scope (it shows locked chips): list only the
   * values found in it, never the project's zero-count catalog padding.
   * See getFacetValuesInScope.
   */
  onlyShowValuesInScope?: boolean | undefined;
  /*
   * Facets whose counts the server stopped at the query time limit, and why
   * the facets did not load at all (issue #4707): a note at the top says so,
   * with a way to try again, and the stopped facets show no counts.
   */
  timedOutFacets?: Array<string> | undefined;
  facetError?: TelemetryLoadError | undefined;
  onRetryFacets?: (() => void) | undefined;
  /*
   * Off while the list says the search could not finish: one message, and
   * one Try again, for the whole search. The stopped facets still say so.
   */
  showCountsNotice?: boolean | undefined;
}

const TelemetryFacetSidebar: FunctionComponent<TelemetryFacetSidebarProps> = (
  props: TelemetryFacetSidebarProps,
): ReactElement => {
  const translator: Translator = useTranslator();
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

  /*
   * What each value is doing - checked, excluded or set by the page - read
   * from the chips, and so which chips a click on it takes off (see
   * FacetSelection). Attribute-backed facets store their chips as
   * `attributes.<key>` in the search grammar, so `/api/\*` lights `/api/*`.
   */
  const selections: FacetSelections = useMemo(() => {
    return buildFacetSelections(props.activeFilters);
  }, [props.activeFilters]);

  // Every value that is filtering, per facet: a facet in use never folds away.
  const activeValuesByKey: Record<string, Set<string>> = useMemo(() => {
    return getSelectedValuesByKey(selections);
  }, [selections]);

  const configsByKey: Map<string, FacetConfig> = useMemo(() => {
    return new Map<string, FacetConfig>(
      orderedConfigs.map((config: FacetConfig): [string, FacetConfig] => {
        return [config.key, config];
      }),
    );
  }, [orderedConfigs]);

  const [showHidden, setShowHidden] = useState<boolean>(false);
  const facetListId: string = useId();

  const facetSearch: FacetSearchExemptions = useFacetSearchExemptions({
    facetData: props.facetData,
    onFacetSearchChange: props.onFacetSearchChange,
  });

  // What the sections list: under a locked scope, only values in it.
  const facetData: FacetData = useMemo(() => {
    return props.onlyShowValuesInScope
      ? getFacetValuesInScope({
          facetData: props.facetData,
          activeValuesByKey: activeValuesByKey,
        })
      : props.facetData;
  }, [props.onlyShowValuesInScope, props.facetData, activeValuesByKey]);

  const timedOutFacetKeys: Set<string> = useMemo(() => {
    return new Set<string>(props.timedOutFacets || []);
  }, [props.timedOutFacets]);

  /*
   * Only configs that opt in with hideWhenEmpty (the resource facets) fold
   * away while empty; every other config renders exactly as before. A facet
   * the time limit stopped is never folded away as empty: its section says
   * it was not counted.
   */
  const visibility: FacetVisibility = useMemo(() => {
    return computeFacetVisibility({
      keys: orderedConfigs.map((config: FacetConfig): string => {
        return config.key;
      }),
      facetData: facetData,
      isHideable: (key: string): boolean => {
        return configsByKey.get(key)?.hideWhenEmpty === true;
      },
      activeValuesByKey: activeValuesByKey,
      searchExemptKeys: facetSearch.searchExemptKeys,
      showHidden: showHidden,
      getTitle: (key: string): string => {
        return configsByKey.get(key)?.title ?? key;
      },
      stoppedKeys: timedOutFacetKeys,
    });
  }, [
    orderedConfigs,
    configsByKey,
    facetData,
    activeValuesByKey,
    facetSearch.searchExemptKeys,
    showHidden,
    timedOutFacetKeys,
  ]);

  const countsNotice: TelemetryLoadError | undefined =
    props.facetError ||
    (timedOutFacetKeys.size > 0
      ? { kind: TelemetryLoadErrorKind.TimedOut, message: "" }
      : undefined);

  /*
   * Nothing read yet: the first read, one retried after it failed, or an
   * explorer that holds its reads until it knows its scope (issue #4709). A
   * host hands facet keys over with an answer, so no key means no answer.
   */
  const isReadingFirstAnswer: boolean =
    props.isLoading && Object.keys(props.facetData).length === 0;

  /*
   * Meanwhile the loader stands alone, under the heading where it is seen,
   * rather than above a facet list that says "No values in this time
   * range" under every facet nobody has read. Once an answer is in, its
   * sections stay through the next read - an empty answer's too, so they
   * do not blink on every refresh of an empty window (a live explorer
   * reads again every few seconds). A facet the reader is searching keeps
   * its section under the loader, so the box they type in stays put.
   */
  const hasNothingToListYet: boolean =
    isReadingFirstAnswer &&
    Object.values(facetSearch.searchTextByKey).every(
      (text: string): boolean => {
        return text.trim().length === 0;
      },
    );

  const visibleConfigs: Array<FacetConfig> = visibility.visibleKeys
    .map((key: string): FacetConfig | undefined => {
      return configsByKey.get(key);
    })
    .filter((config: FacetConfig | undefined): config is FacetConfig => {
      return config !== undefined;
    });

  return (
    <div
      id={props.id}
      className={`${
        props.isCollapsedOnSmallScreens ? "max-md:hidden md:flex" : "flex"
      } max-h-80 w-full flex-none flex-col overflow-y-auto rounded-lg border border-gray-200 bg-white md:h-full md:max-h-none md:w-56`}
    >
      <div className="border-b border-gray-100 px-3 py-2.5">
        <h3 className="text-[11px] font-semibold uppercase tracking-widest text-gray-400">
          {translator.translateText(props.headerLabel || "Filters")}
        </h3>
      </div>

      {isReadingFirstAnswer && (
        <div
          className="flex items-center justify-center py-8"
          data-testid={TELEMETRY_FACET_SIDEBAR_LOADER_TEST_ID}
        >
          <ComponentLoader />
        </div>
      )}

      {!props.isLoading && countsNotice && props.showCountsNotice !== false && (
        <TelemetryLoadErrorMessage
          error={countsNotice}
          subject="counts"
          variant="note"
          onRetry={props.onRetryFacets}
        />
      )}

      {!hasNothingToListYet && (
        <div id={facetListId} className="flex-1 overflow-y-auto">
          {visibleConfigs.map((config: FacetConfig) => {
            /*
             * A choice of one (see FacetConfig.chosenValue) lists every
             * value it answered with, a locked scope or not: an option
             * counting 0 is still one to choose.
             */
            const isSingleChoice: boolean = config.chosenValue !== undefined;

            /*
             * A value that is filtering keeps its row even when the answer
             * left it out (an excluded value counts nothing), so it can
             * always be clicked off where it was clicked on.
             */
            const values: Array<FacetValue> = withSelectedFacetValues(
              (isSingleChoice ? props.facetData : facetData)[config.key] || [],
              selections.get(config.key),
            );
            const sectionSelection: FacetSectionSelection =
              getFacetSectionSelection(selections, config.key);

            const onSearchChange: ((text: string) => void) | undefined =
              config.serverSearchable
                ? facetSearch.getSearchChangeHandler(config.key)
                : undefined;

            return (
              <TelemetryFacetSection
                key={config.key}
                facetKey={config.key}
                title={config.title}
                values={values}
                onIncludeValue={props.onIncludeFilter}
                onExcludeValue={
                  isSingleChoice ? undefined : props.onExcludeFilter
                }
                chosenValue={config.chosenValue}
                description={config.description}
                onClearValue={(facetKey: string, value: string) => {
                  for (const chip of getFacetChipsToClear(
                    selections,
                    facetKey,
                    value,
                  )) {
                    props.onRemoveFilter(chip.facetKey, chip.value);
                  }
                }}
                valueDisplayMap={config.valueDisplayMap}
                valueColorMap={config.valueColorMap}
                activeValues={sectionSelection.includedValues}
                excludedValues={sectionSelection.excludedValues}
                lockedValues={sectionSelection.lockedValues}
                onSearchChange={onSearchChange}
                icon={config.icon}
                searchText={facetSearch.searchTextByKey[config.key] ?? ""}
                onSearchTextChange={(text: string) => {
                  facetSearch.setSearchText(config.key, text);
                }}
                emptyStateText={getSidebarFacetEmptyStateText({
                  isHideable: config.hideWhenEmpty === true,
                  emptyStateNoun: config.emptyStateNoun,
                  searchedAtArrivalText:
                    facetSearch.searchedAtArrivalByKey[config.key],
                  isScoped: props.onlyShowValuesInScope,
                })}
                isCountStopped={timedOutFacetKeys.has(config.key)}
              />
            );
          })}

          <HiddenFacetsFooter
            hiddenCount={visibility.hiddenCount}
            hiddenTitles={visibility.hiddenTitles}
            isShowingHidden={showHidden}
            controlsId={facetListId}
            onToggle={() => {
              setShowHidden(!showHidden);
            }}
          />
        </div>
      )}
    </div>
  );
};

export default TelemetryFacetSidebar;
