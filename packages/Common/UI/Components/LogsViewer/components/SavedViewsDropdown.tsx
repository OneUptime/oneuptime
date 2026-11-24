import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Translator } from "../../../Utils/TranslateTemplate";
import useTranslator from "../../../Utils/UseTranslator";
import { LogsSavedViewOption } from "../types";
import useComponentOutsideClick from "../../../Types/UseComponentOutsideClick";
import LayeredPopover from "../../Tooltip/LayeredPopover";
import SavedViewsSearchInput from "../../SavedViews/SavedViewsSearchInput";
import SavedViewsShowMoreButton from "../../SavedViews/SavedViewsShowMoreButton";
import {
  SAVED_VIEW_ROW_ACTIONS_CLASS_NAME,
  SAVED_VIEW_ROW_ACTION_CLASS_NAME,
  SAVED_VIEW_ROW_NAME_CLASS_NAME,
  VisibleSavedViews,
  getSavedViewRowClassName,
  getVisibleSavedViews,
  shouldShowSavedViewsSearch,
} from "../../SavedViews/SavedViewsList";
import { getReaderNumberLocale } from "../../../../Types/DateLanguage";

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
  /*
   * How many views the host has, when it hands over only its first ones,
   * and what is typed into the search box, for it to search the rest on
   * the server (#10646). Unset, the views handed over are all there are.
   */
  totalCount?: number | undefined;
  onSearchTextChange?: ((text: string) => void) | undefined;
}

const triggerButtonClassName: string =
  "inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 shadow-sm transition-colors hover:border-gray-300 hover:bg-gray-50";

const SavedViewsDropdown: FunctionComponent<SavedViewsDropdownProps> = (
  props: SavedViewsDropdownProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const { ref, isComponentVisible, setIsComponentVisible } =
    useComponentOutsideClick(false);

  const [searchText, setSearchText] = useState<string>("");
  const [showAll, setShowAll] = useState<boolean>(false);

  /*
   * What the panel opens from (LayeredPopover): it is placed against it, and
   * Escape puts the focus back on it. Without that the panel closed out
   * from under the caret and focus fell to <body>, which for a keyboard
   * user is the same as being dropped at the top of the page.
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

  // Every view the host has (totalCount, #10646), not only the ones read.
  const viewCount: number = Math.max(
    props.totalCount ?? 0,
    props.savedViews.length,
  );

  const showSearch: boolean = shouldShowSavedViewsSearch(viewCount);

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

  /*
   * Escape closes the panel, from anywhere - focus on <body> too, where a
   * click on the panel's own padding leaves it (as does opening it by mouse
   * at all, on Safari and Firefox) - and is spent there (LayeredPopover).
   * The page has its own Escape handling - the logs explorer closes the log
   * detail panel with it - so a missed Escape here is not a no-op, it
   * closes the wrong thing. Only while open, so a closed dropdown never
   * eats the page's Escape.
   */

  const clearSelection: () => void = (): void => {
    props.onClear?.();
    setIsComponentVisible(false);
  };

  return (
    /*
     * The panel is drawn over the page from its trigger, its start on the
     * trigger's start (LayeredPopover): inside the toolbar, under a list
     * with no filter bar, the list's card cut it off (#9859). It stays
     * inside the window's sides, so an 18rem panel never runs off a phone
     * wherever the wrapped toolbar puts the trigger.
     */
    <div ref={ref}>
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
          {selectedView?.name || translator.translateText("Saved Views")}
        </span>
        <span className="text-xs text-gray-500">
          {viewCount.toLocaleString(getReaderNumberLocale())}
        </span>
      </button>

      {isComponentVisible && (
        /*
         * The trigger has always advertised aria-haspopup="dialog"; now that
         * the panel holds a text field, saying so on the panel too is what
         * lets assistive tech tell this search box apart from the identically
         * named one in the facet sidebar behind it.
         */
        <LayeredPopover
          anchorRef={triggerRef}
          ownerRef={ref}
          gap={8}
          onClose={() => {
            setIsComponentVisible(false);
          }}
        >
          <div
            role="dialog"
            aria-label={translator.translateText("Saved views")}
            className="w-72 max-w-[calc(100vw-1rem)] rounded-lg border border-gray-200 bg-white shadow-xl"
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
                    {translator.translateText("Clear view")}
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
                    // A host that reads its first views only searches the rest.
                    props.onSearchTextChange?.(text);
                  }}
                />
              </div>
            )}

            {/* View list */}
            <div className="max-h-72 overflow-y-auto py-1">
              {props.savedViews.length === 0 && (
                <div className="px-3 py-6 text-center text-xs text-gray-500">
                  {translator.translateText("No saved views yet.")}
                </div>
              )}

              {props.savedViews.length > 0 && visible.views.length === 0 && (
                <div className="px-3 py-6 text-center text-xs text-gray-500">
                  {translator.translateText("No matches found")}
                </div>
              )}

              {visible.views.map((view: LogsSavedViewOption) => {
                const isSelected: boolean =
                  view.id === props.selectedSavedViewId;

                return (
                  <div
                    key={view.id}
                    className={getSavedViewRowClassName(isSelected)}
                  >
                    <button
                      type="button"
                      className={SAVED_VIEW_ROW_NAME_CLASS_NAME}
                      /*
                       * Spelled out so the row announces as its own name: the
                       * ✓ is aria-hidden, and the "default" tag reads as a word
                       * rather than a bare token appended to the view name.
                       */
                      aria-label={
                        view.isDefault
                          ? translator.translateTemplate("{{name}} (default)", {
                              name: view.name,
                            })
                          : view.name
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
                        <span className="shrink-0 text-xs text-gray-500">
                          {translator.translateText("default")}
                        </span>
                      )}
                    </button>

                    {/*
                     * Shown while the row is hovered or focused, under the name
                     * on a touch screen (SAVED_VIEW_ROW_ACTIONS_CLASS_NAME).
                     */}
                    <div className={SAVED_VIEW_ROW_ACTIONS_CLASS_NAME}>
                      {isSelected && props.onUpdateCurrent && (
                        <button
                          type="button"
                          className={`${SAVED_VIEW_ROW_ACTION_CLASS_NAME} text-indigo-600 hover:bg-indigo-100`}
                          onClick={(
                            event: React.MouseEvent<HTMLButtonElement>,
                          ) => {
                            event.stopPropagation();
                            props.onUpdateCurrent?.();
                            setIsComponentVisible(false);
                          }}
                        >
                          {translator.translateText("Update")}
                        </button>
                      )}
                      {props.onEdit && (
                        <button
                          type="button"
                          className={`${SAVED_VIEW_ROW_ACTION_CLASS_NAME} text-gray-500 hover:bg-gray-100 hover:text-gray-700`}
                          onClick={(
                            event: React.MouseEvent<HTMLButtonElement>,
                          ) => {
                            event.stopPropagation();
                            props.onEdit?.(view.id);
                            setIsComponentVisible(false);
                          }}
                        >
                          {translator.translateText("Edit")}
                        </button>
                      )}
                      {props.onDelete && (
                        <button
                          type="button"
                          className={`${SAVED_VIEW_ROW_ACTION_CLASS_NAME} text-red-500 hover:bg-red-50 hover:text-red-600`}
                          onClick={(
                            event: React.MouseEvent<HTMLButtonElement>,
                          ) => {
                            event.stopPropagation();
                            props.onDelete?.(view.id);
                            setIsComponentVisible(false);
                          }}
                        >
                          {translator.translateText("Delete")}
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
                  {translator.translateText("+ Save Current View")}
                </button>
              </div>
            )}
          </div>
        </LayeredPopover>
      )}
    </div>
  );
};

export default SavedViewsDropdown;
