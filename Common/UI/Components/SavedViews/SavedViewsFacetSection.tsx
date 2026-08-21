import React, {
  FunctionComponent,
  ReactElement,
  useMemo,
  useState,
} from "react";
import Icon from "../Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";
import SavedViewsSearchInput from "./SavedViewsSearchInput";
import SavedViewsShowMoreButton from "./SavedViewsShowMoreButton";
import {
  SavedViewListItem,
  VisibleSavedViews,
  getVisibleSavedViews,
  shouldShowSavedViewsSearch,
} from "./SavedViewsList";

export interface SavedViewsFacetSectionProps {
  savedViews: Array<SavedViewListItem>;
  selectedSavedViewId?: string | null | undefined;
  onSelect?: ((viewId: string) => void) | undefined;
  /*
   * Toggling the applied view off has to clear it, not re-apply it. Sidebars
   * whose host cannot express "no view" omit this, and clicking the applied
   * row falls back to re-applying it, as it did before.
   */
  onClear?: (() => void) | undefined;
  title?: string | undefined;
  initialVisibleCount?: number | undefined;
}

const DEFAULT_TITLE: string = "Saved Views";

/*
 * Issue 3319: the sidebar's saved views were a bare list with no search and no
 * limit, sitting directly above facet sections that have both. Ten views in,
 * the panel is a scroll. This gives the list the same chrome as the facets it
 * lives with — collapse, search, "+N more" — so the sidebar reads as one thing
 * rather than one special case followed by the real controls.
 */
const SavedViewsFacetSection: FunctionComponent<SavedViewsFacetSectionProps> = (
  props: SavedViewsFacetSectionProps,
): ReactElement => {
  const [isExpanded, setIsExpanded] = useState<boolean>(true);
  const [showAll, setShowAll] = useState<boolean>(false);
  const [searchText, setSearchText] = useState<string>("");

  const title: string = props.title || DEFAULT_TITLE;

  const showSearch: boolean = shouldShowSavedViewsSearch(
    props.savedViews.length,
  );

  const visible: VisibleSavedViews<SavedViewListItem> = useMemo(() => {
    return getVisibleSavedViews<SavedViewListItem>({
      savedViews: props.savedViews,
      searchText: searchText,
      showAll: showAll,
      visibleCount: props.initialVisibleCount,
      selectedSavedViewId: props.selectedSavedViewId,
    });
  }, [
    props.savedViews,
    props.initialVisibleCount,
    props.selectedSavedViewId,
    searchText,
    showAll,
  ]);

  const appliedCount: number = props.savedViews.some(
    (view: SavedViewListItem): boolean => {
      return view.id === props.selectedSavedViewId;
    },
  )
    ? 1
    : 0;

  return (
    <div className="border-b border-gray-100 py-2">
      <button
        type="button"
        className="flex w-full items-center justify-between px-2 py-1 text-left"
        aria-expanded={isExpanded}
        onClick={() => {
          setIsExpanded(!isExpanded);
        }}
      >
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
            {title}
          </span>
          {appliedCount > 0 && (
            <span className="inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-indigo-100 px-1 text-[10px] font-semibold text-indigo-600">
              {appliedCount}
            </span>
          )}
        </div>
        <Icon
          icon={isExpanded ? IconProp.ChevronDown : IconProp.ChevronRight}
          className="h-3 w-3 text-gray-400"
        />
      </button>

      {isExpanded && (
        <div className="mt-1 px-1">
          {showSearch && (
            <div className="mb-1 px-1">
              <SavedViewsSearchInput
                value={searchText}
                label={`Search ${title.toLowerCase()}...`}
                onChange={(text: string) => {
                  setSearchText(text);
                }}
              />
            </div>
          )}

          {visible.views.map((view: SavedViewListItem) => {
            const isSelected: boolean = view.id === props.selectedSavedViewId;

            return (
              <div
                key={view.id}
                className="group flex items-center gap-2 py-0.5"
              >
                <button
                  type="button"
                  className={`flex min-w-0 flex-1 items-center gap-2 rounded px-1.5 py-0.5 text-left transition-colors ${
                    isSelected
                      ? "bg-indigo-50 ring-1 ring-indigo-200"
                      : "hover:bg-gray-50"
                  }`}
                  /*
                   * Spelled out so the row announces as its own name — the
                   * "Default" pill beside it is decoration, and a screen
                   * reader should hear the word, not a stray badge.
                   */
                  aria-label={
                    view.isDefault ? `${view.name} (default)` : view.name
                  }
                  /*
                   * The row behaves like a checkbox: clicking the applied
                   * view takes it off again rather than silently re-applying
                   * what is already on.
                   */
                  aria-pressed={isSelected}
                  title={
                    isSelected
                      ? `Clear saved view: ${view.name}`
                      : `Apply saved view: ${view.name}`
                  }
                  onClick={() => {
                    if (isSelected && props.onClear) {
                      props.onClear();
                      return;
                    }

                    props.onSelect?.(view.id);
                  }}
                >
                  {isSelected ? (
                    <span className="flex h-3.5 w-3.5 flex-none items-center justify-center rounded bg-indigo-500">
                      <Icon
                        icon={IconProp.Check}
                        className="h-2.5 w-2.5 text-white"
                      />
                    </span>
                  ) : (
                    <Icon
                      icon={IconProp.Bookmark}
                      className="h-3.5 w-3.5 flex-none text-gray-400"
                    />
                  )}
                  <span
                    className={`min-w-0 truncate text-[12px] ${
                      isSelected
                        ? "font-medium text-indigo-700"
                        : "text-gray-700"
                    }`}
                  >
                    {view.name}
                  </span>
                </button>

                {view.isDefault && (
                  <span
                    aria-hidden="true"
                    className="flex-none rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-700"
                  >
                    Default
                  </span>
                )}
              </div>
            );
          })}

          {visible.views.length === 0 && (
            <p className="px-1 py-2 text-[11px] text-gray-400">
              {visible.isSearching ? "No matches found" : "No saved views yet."}
            </p>
          )}

          {/*
           * A search result is already the whole answer, so neither half of
           * the toggle belongs beside it — "Show less" would collapse rows
           * the user explicitly asked to see.
           */}
          <SavedViewsShowMoreButton
            hiddenCount={visible.hiddenCount}
            isShowingAll={showAll && !visible.isSearching}
            onToggle={() => {
              setShowAll(!showAll);
            }}
          />
        </div>
      )}
    </div>
  );
};

export default SavedViewsFacetSection;
