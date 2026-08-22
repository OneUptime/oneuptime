import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { LogsSavedViewOption } from "../types";
import useComponentOutsideClick from "../../../Types/UseComponentOutsideClick";
import SavedViewsSearchInput from "../../SavedViews/SavedViewsSearchInput";
import SavedViewsShowMoreButton from "../../SavedViews/SavedViewsShowMoreButton";
import {
  VisibleSavedViews,
  getVisibleSavedViews,
  shouldShowSavedViewsSearch,
} from "../../SavedViews/SavedViewsList";

export interface SavedViewsDropdownProps {
  savedViews: Array<LogsSavedViewOption>;
  selectedSavedViewId?: string | null | undefined;
  onSelect: (viewId: string) => void;
  /*
   * Deselect the active view and return the explorer to its unfiltered
   * default. Without this the checkmark is a one-way door: a view can be
   * applied but never taken off. Hosts that cannot express "no view" simply
   * omit it, and both clear affordances below disappear with it.
   */
  onClear?: (() => void) | undefined;
  onCreate?: (() => void) | undefined;
  onEdit?: ((viewId: string) => void) | undefined;
  onDelete?: ((viewId: string) => void) | undefined;
  onUpdateCurrent?: (() => void) | undefined;
}

const triggerButtonClassName: string =
  "inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 shadow-sm transition-colors hover:border-gray-300 hover:bg-gray-50";

const SavedViewsDropdown: FunctionComponent<SavedViewsDropdownProps> = (
  props: SavedViewsDropdownProps,
): ReactElement => {
  const { ref, isComponentVisible, setIsComponentVisible } =
    useComponentOutsideClick(false);

  const [searchText, setSearchText] = useState<string>("");
  const [showAll, setShowAll] = useState<boolean>(false);

  /*
   * Escape has to put focus back where it came from. Without this the panel
   * closes out from under the caret and focus falls to <body>, which for a
   * keyboard user is the same as being dropped at the top of the page.
   */
  const triggerRef: React.MutableRefObject<HTMLButtonElement | null> =
    useRef<HTMLButtonElement | null>(null);

  /*
   * A search is scoped to the visit that typed it. Leaving it behind means
   * the next open shows a filtered list with no obvious reason why — the
   * dropdown has no persistent chrome to remind anyone a filter is on.
   */
  useEffect(() => {
    if (!isComponentVisible) {
      setSearchText("");
      setShowAll(false);
    }
  }, [isComponentVisible]);

  const selectedView: LogsSavedViewOption | undefined = props.savedViews.find(
    (view: LogsSavedViewOption) => {
      return view.id === props.selectedSavedViewId;
    },
  );

  /*
   * Clearing is only offered once a view is actually applied — an inert
   * "Clear view" row sitting above an unfiltered explorer says nothing.
   */
  const canClear: boolean = Boolean(props.onClear && selectedView);

  const showSearch: boolean = shouldShowSavedViewsSearch(
    props.savedViews.length,
  );

  /*
   * A filter the user cannot see is a filter the user cannot cancel. Hosts
   * replace this list in place after a create, rename or delete, and once it
   * drops below the threshold the search box unmounts — so the query is read
   * through the box's own visibility, and cleared with it.
   */
  const activeSearchText: string = showSearch ? searchText : "";

  useEffect(() => {
    if (!showSearch) {
      setSearchText("");
    }
  }, [showSearch]);

  const visible: VisibleSavedViews<LogsSavedViewOption> = useMemo(() => {
    return getVisibleSavedViews<LogsSavedViewOption>({
      savedViews: props.savedViews,
      searchText: activeSearchText,
      showAll: showAll,
      selectedSavedViewId: props.selectedSavedViewId,
    });
  }, [props.savedViews, props.selectedSavedViewId, activeSearchText, showAll]);

  const clearSelection: () => void = (): void => {
    props.onClear?.();
    setIsComponentVisible(false);
  };

  return (
    <div
      className="relative"
      ref={ref}
      onKeyDown={(event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== "Escape" || !isComponentVisible) {
          return;
        }

        /*
         * Kept off the page's own Escape handling: the explorer treats Escape
         * as "close what is on top", and this panel is what is on top.
         */
        event.stopPropagation();
        setIsComponentVisible(false);
        triggerRef.current?.focus();
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className={triggerButtonClassName}
        onClick={() => {
          setIsComponentVisible(!isComponentVisible);
        }}
        aria-haspopup="dialog"
        aria-expanded={isComponentVisible}
      >
        <span className="max-w-40 truncate">
          {selectedView?.name || "Saved Views"}
        </span>
        <span className="text-xs text-gray-400">
          {props.savedViews.length.toLocaleString()}
        </span>
      </button>

      {isComponentVisible && (
        /*
         * The trigger has always advertised aria-haspopup="dialog"; now that
         * the panel holds a text field, saying so on the panel too is what
         * lets assistive tech tell this search box apart from the identically
         * named one in the facet sidebar behind it.
         */
        <div
          role="dialog"
          aria-label="Saved views"
          className="absolute left-0 z-20 mt-2 w-72 rounded-lg border border-gray-200 bg-white shadow-xl"
        >
          {/*
           * Explicit way back to the unfiltered explorer. Clicking the
           * applied view also clears it, but that is only discoverable once
           * you try it — this row says so out loud.
           */}
          {canClear && (
            <div className="border-b border-gray-100 py-1">
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-gray-50"
                onClick={clearSelection}
              >
                <span
                  className="w-4 shrink-0 text-center text-xs text-gray-400"
                  aria-hidden="true"
                >
                  ✕
                </span>
                <span className="truncate text-sm text-gray-600">
                  Clear view
                </span>
              </button>
            </div>
          )}

          {/*
           * Search once the list is long enough that reading it is slower
           * than typing — issue 3319. Same threshold the facet sections use.
           */}
          {showSearch && (
            <div className="border-b border-gray-100 px-3 py-2">
              <SavedViewsSearchInput
                value={searchText}
                className="w-full rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-700 placeholder-gray-400 outline-none focus:border-indigo-300 focus:bg-white focus:ring-1 focus:ring-indigo-200"
                onChange={(text: string) => {
                  setSearchText(text);
                }}
              />
            </div>
          )}

          {/* View list */}
          <div className="max-h-72 overflow-y-auto py-1">
            {props.savedViews.length === 0 && (
              <div className="px-3 py-6 text-center text-xs text-gray-400">
                No saved views yet.
              </div>
            )}

            {props.savedViews.length > 0 && visible.views.length === 0 && (
              <div className="px-3 py-6 text-center text-xs text-gray-400">
                No matches found
              </div>
            )}

            {visible.views.map((view: LogsSavedViewOption) => {
              const isSelected: boolean = view.id === props.selectedSavedViewId;

              return (
                <div
                  key={view.id}
                  className={`group flex items-center justify-between gap-2 px-3 py-1.5 ${
                    isSelected ? "bg-indigo-50" : "hover:bg-gray-50"
                  }`}
                >
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    /*
                     * Spelled out so the row announces as its own name: the
                     * ✓ is aria-hidden, and the "default" tag reads as a word
                     * rather than a bare token appended to the view name.
                     */
                    aria-label={
                      view.isDefault ? `${view.name} (default)` : view.name
                    }
                    /*
                     * The checkmark reads as a checkbox, so the row behaves
                     * like one: clicking the applied view takes it off again
                     * instead of silently re-applying what is already on.
                     */
                    aria-pressed={isSelected}
                    onClick={() => {
                      if (isSelected && props.onClear) {
                        clearSelection();
                        return;
                      }

                      props.onSelect(view.id);
                      setIsComponentVisible(false);
                    }}
                  >
                    {/* Checkmark for selected */}
                    <span
                      className="w-4 shrink-0 text-center text-xs"
                      aria-hidden="true"
                    >
                      {isSelected ? (
                        <span className="text-indigo-600">✓</span>
                      ) : (
                        ""
                      )}
                    </span>
                    <span
                      className={`truncate text-sm ${
                        isSelected
                          ? "font-medium text-indigo-700"
                          : "text-gray-700"
                      }`}
                    >
                      {view.name}
                    </span>
                    {view.isDefault && (
                      <span className="shrink-0 text-[10px] text-gray-400">
                        default
                      </span>
                    )}
                  </button>

                  {/* Actions — visible on hover */}
                  <div className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100">
                    {isSelected && props.onUpdateCurrent && (
                      <button
                        type="button"
                        className="rounded px-1.5 py-0.5 text-[11px] text-indigo-600 transition-colors hover:bg-indigo-100"
                        onClick={(
                          event: React.MouseEvent<HTMLButtonElement>,
                        ) => {
                          event.stopPropagation();
                          props.onUpdateCurrent?.();
                          setIsComponentVisible(false);
                        }}
                      >
                        Update
                      </button>
                    )}
                    {props.onEdit && (
                      <button
                        type="button"
                        className="rounded px-1.5 py-0.5 text-[11px] text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
                        onClick={(
                          event: React.MouseEvent<HTMLButtonElement>,
                        ) => {
                          event.stopPropagation();
                          props.onEdit?.(view.id);
                          setIsComponentVisible(false);
                        }}
                      >
                        Edit
                      </button>
                    )}
                    {props.onDelete && (
                      <button
                        type="button"
                        className="rounded px-1.5 py-0.5 text-[11px] text-red-500 transition-colors hover:bg-red-50 hover:text-red-600"
                        onClick={(
                          event: React.MouseEvent<HTMLButtonElement>,
                        ) => {
                          event.stopPropagation();
                          props.onDelete?.(view.id);
                          setIsComponentVisible(false);
                        }}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/*
           * The toggle sits outside the scrolling list on purpose. Inside it,
           * expanding pushed "Show less" off the bottom of the scroll box and
           * slid a view row under the cursor, so a second click in the same
           * spot applied whichever view had taken its place.
           */}
          {visible.hasMore && (
            <div className="border-t border-gray-100 px-3 py-1.5">
              <SavedViewsShowMoreButton
                hasMore={visible.hasMore}
                hiddenCount={visible.hiddenCount}
                isShowingAll={showAll}
                onToggle={() => {
                  setShowAll(!showAll);
                }}
              />
            </div>
          )}

          {/* Footer action */}
          {props.onCreate && (
            <div className="border-t border-gray-100 px-3 py-2">
              <button
                type="button"
                className="w-full rounded-md px-2 py-1.5 text-left text-xs font-medium text-indigo-600 transition-colors hover:bg-indigo-50"
                onClick={() => {
                  props.onCreate?.();
                  setIsComponentVisible(false);
                }}
              >
                + Save Current View
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default SavedViewsDropdown;
