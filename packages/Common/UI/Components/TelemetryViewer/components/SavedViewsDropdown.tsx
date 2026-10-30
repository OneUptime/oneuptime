import React, {
  FunctionComponent,
  ReactElement,
  ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Translator, translationKey } from "../../../Utils/TranslateTemplate";
import useTranslator from "../../../Utils/UseTranslator";
import { SavedViewOption } from "../types";
import useComponentOutsideClick from "../../../Types/UseComponentOutsideClick";
import Icon from "../../Icon/Icon";
import IsolatedText from "../../IsolatedText/IsolatedText";
import IconProp from "../../../../Types/Icon/IconProp";
import {
  DropdownHorizontalAlignment,
  getDropdownAlignmentClassName,
  useDropdownHorizontalAlignment,
} from "../../../Utils/DropdownAlignment";
import SavedViewsSearchInput from "../../SavedViews/SavedViewsSearchInput";
import SavedViewsShowMoreButton from "../../SavedViews/SavedViewsShowMoreButton";
import {
  VisibleSavedViews,
  getVisibleSavedViews,
  shouldShowSavedViewsSearch,
} from "../../SavedViews/SavedViewsList";

/*
 * The words a host names its saved things with, each a translation key: a
 * host that keeps something other than views (Security Events' hunts) names
 * them its own way. Any left out read as views.
 */
export interface SavedViewsDropdownLabels {
  // The trigger's name while nothing is applied.
  trigger?: string | undefined;
  // The open panel's name, for assistive tech.
  panel?: string | undefined;
  // Said in the panel while there is nothing saved (or while it is read).
  empty?: string | undefined;
  // The footer action that saves what is on screen.
  create?: string | undefined;
  // The panel's search box, once the list is long.
  search?: string | undefined;
}

const DEFAULT_LABELS: {
  trigger: string;
  panel: string;
  empty: string;
  create: string;
} = {
  trigger: translationKey("Saved Views"),
  panel: translationKey("Saved views"),
  empty: translationKey("No saved views yet."),
  create: translationKey("+ Save Current View"),
};

export interface SavedViewsDropdownProps {
  savedViews: Array<SavedViewOption>;
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
  triggerClassName?: string | undefined;
  showTriggerIcon?: boolean | undefined;
  // The trigger's icon, when it shows one: a bookmark unless named.
  triggerIcon?: IconProp | undefined;
  /*
   * The trigger names the applied view (the default). Off, it keeps its own
   * name: a page that names the applied one itself - a hunt's page, in its
   * header - has no need of it twice on its toolbar.
   */
  showSelectedNameInTrigger?: boolean | undefined;
  dropdownAlignment?: "left" | "right" | undefined;
  labels?: SavedViewsDropdownLabels | undefined;
  /*
   * Why the footer's save cannot be used right now - nothing on screen to
   * save, a role that may not - drawn under it, which is then locked.
   */
  createDisabledReason?: string | undefined;
  // Called as the panel opens: a host that reads its list afresh does it here.
  onOpen?: (() => void) | undefined;
  dataTestId?: string | undefined;
  /*
   * Whether the trigger shows how many there are (the default). A host that
   * is still reading its list, or could not, leaves it off: "0" would say
   * there are none.
   */
  showCount?: boolean | undefined;
  /*
   * What the panel shows in place of its list while there is nothing to
   * list - a host's "Loading…", or what went wrong with a way to try again.
   * Without it the panel says labels.empty.
   */
  emptyContent?: ReactNode | undefined;
}

// Tailwind w-72: the panel's width, which it opens on the side with room for.
const PANEL_WIDTH_IN_PX: number = 288;

const triggerButtonClassName: string =
  "inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 shadow-sm transition-colors hover:border-gray-300 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400";

const SavedViewsDropdown: FunctionComponent<SavedViewsDropdownProps> = (
  props: SavedViewsDropdownProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const { ref, isComponentVisible, setIsComponentVisible } =
    useComponentOutsideClick(false);

  const label: (key: "trigger" | "panel" | "empty" | "create") => string = (
    key: "trigger" | "panel" | "empty" | "create",
  ): string => {
    const text: string = props.labels?.[key] || DEFAULT_LABELS[key];

    return translator.translateText(text) || text;
  };

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
   * The panel opens on the side of its trigger with room for it: from the
   * trigger's start, else from its end. A toolbar wraps at 768px beside the
   * side menu and leaves this trigger last on its row, and the panel then
   * ran past the screen's edge and scrolled the page sideways. A host that
   * names the side (dropdownAlignment) keeps it.
   *
   * The panel is as wide as it is styled (w-72), whatever it lists, so it is
   * never measured: opened the first time, before Tailwind's runtime wrote
   * the w-72 rule, it measured its longest name (670px) and opened to the
   * left with room to spare on the right.
   */
  const fittingAlignment: DropdownHorizontalAlignment =
    useDropdownHorizontalAlignment({
      isOpen: isComponentVisible && !props.dropdownAlignment,
      anchorRef: triggerRef,
      dropdownWidthInPx: PANEL_WIDTH_IN_PX,
    });
  let panelAlignment: DropdownHorizontalAlignment = fittingAlignment;

  if (props.dropdownAlignment === "right") {
    panelAlignment = DropdownHorizontalAlignment.Right;
  } else if (props.dropdownAlignment === "left") {
    panelAlignment = DropdownHorizontalAlignment.Left;
  }

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

  const selectedView: SavedViewOption | undefined = props.savedViews.find(
    (view: SavedViewOption) => {
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

  const visible: VisibleSavedViews<SavedViewOption> = useMemo(() => {
    return getVisibleSavedViews<SavedViewOption>({
      savedViews: props.savedViews,
      searchText: activeSearchText,
      showAll: showAll,
      selectedSavedViewId: props.selectedSavedViewId,
    });
  }, [props.savedViews, props.selectedSavedViewId, activeSearchText, showAll]);

  /*
   * Escape closes the panel, from anywhere. Deliberately a document listener
   * rather than a handler on the wrapper: clicking the panel's own padding
   * leaves focus on <body> (as does opening it by mouse at all, on Safari and
   * Firefox), and a wrapper handler never sees a keydown whose target is
   * outside its subtree. The page has its own Escape handling — the logs
   * explorer closes the log detail panel with it — so a missed Escape here is
   * not a no-op, it closes the wrong thing.
   *
   * Registered only while open, and in the capture phase ahead of those page
   * handlers, so a closed dropdown never eats the page's Escape.
   */
  useEffect(() => {
    if (!isComponentVisible) {
      return undefined;
    }

    const handleEscape: (event: KeyboardEvent) => void = (
      event: KeyboardEvent,
    ): void => {
      if (event.key !== "Escape") {
        return;
      }

      event.stopPropagation();
      setIsComponentVisible(false);
      triggerRef.current?.focus();
    };

    document.addEventListener("keydown", handleEscape, true);

    return () => {
      document.removeEventListener("keydown", handleEscape, true);
    };
  }, [isComponentVisible, setIsComponentVisible]);

  const clearSelection: () => void = (): void => {
    props.onClear?.();
    setIsComponentVisible(false);
  };

  return (
    <div className="relative" ref={ref} data-testid={props.dataTestId}>
      <button
        ref={triggerRef}
        type="button"
        className={`${triggerButtonClassName} ${props.triggerClassName || ""}`}
        onClick={() => {
          if (!isComponentVisible) {
            props.onOpen?.();
          }

          setIsComponentVisible(!isComponentVisible);
        }}
        aria-haspopup="dialog"
        aria-expanded={isComponentVisible}
      >
        {props.showTriggerIcon ? (
          <Icon
            icon={props.triggerIcon || IconProp.Bookmark}
            className="h-3.5 w-3.5 text-gray-500"
          />
        ) : null}
        <span className="max-w-40 truncate">
          {(props.showSelectedNameInTrigger !== false && selectedView?.name) ||
            label("trigger")}
        </span>
        {props.showCount === false ? null : (
          <span
            className={`text-xs text-gray-400 ${
              props.showTriggerIcon
                ? "rounded-md bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold"
                : ""
            }`}
          >
            {props.savedViews.length.toLocaleString()}
          </span>
        )}
        {props.showTriggerIcon ? (
          <Icon
            icon={IconProp.ChevronDown}
            className={`h-3 w-3 text-gray-400 transition-transform ${
              isComponentVisible ? "rotate-180" : ""
            }`}
          />
        ) : null}
      </button>

      {isComponentVisible && (
        /*
         * The trigger has always advertised aria-haspopup="dialog"; now that
         * the panel holds a text field, saying so on the panel too is what
         * lets assistive tech tell this search box apart from the identically
         * named one in a facet sidebar behind it.
         */
        <div
          role="dialog"
          aria-label={label("panel")}
          data-align={panelAlignment}
          className={`absolute z-20 mt-2 w-72 max-w-[calc(100vw-1rem)] rounded-lg border border-gray-200 bg-white shadow-xl ${getDropdownAlignmentClassName(
            panelAlignment,
          )}`}
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
                label={props.labels?.search}
                className="w-full rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-700 placeholder-gray-400 outline-none focus:border-indigo-300 focus:bg-white focus:ring-1 focus:ring-indigo-200"
                onChange={(text: string) => {
                  setSearchText(text);
                }}
              />
            </div>
          )}

          {/* View list */}
          <div className="max-h-72 overflow-y-auto py-1">
            {props.savedViews.length === 0 &&
              (props.emptyContent ? (
                props.emptyContent
              ) : (
                <div className="px-3 py-6 text-center text-xs text-gray-400">
                  {label("empty")}
                </div>
              ))}

            {props.savedViews.length > 0 && visible.views.length === 0 && (
              <div className="px-3 py-6 text-center text-xs text-gray-400">
                {translator.translateText("No matches found")}
              </div>
            )}

            {visible.views.map((view: SavedViewOption) => {
              const isSelected: boolean = view.id === props.selectedSavedViewId;
              const nameClassName: string = isSelected
                ? "font-medium text-indigo-700"
                : "text-gray-700";

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
                    {!view.isDefault && view.detail ? (
                      /*
                       * A detail - a hunt's schedule - under the name, so
                       * the name has the row's width: beside it, "Admin
                       * sign-ins outside t..." was all a 288px panel kept.
                       */
                      <span className="flex min-w-0 flex-1 flex-col">
                        {/*
                         * As wide as it is, from the line's start: an
                         * English name on a Persian page starts where the
                         * schedule under it does.
                         */}
                        <IsolatedText
                          text={view.name}
                          title={view.name}
                          className={`max-w-full self-start truncate text-sm ${nameClassName}`}
                        />
                        <span className="truncate text-[11px] leading-4 text-gray-500">
                          {view.detail}
                        </span>
                      </span>
                    ) : (
                      <>
                        {/*
                         * A long name is cut to the panel; the whole of it
                         * on hover. In an isolate: an English name on a
                         * Persian page is cut at its own end, not its start.
                         */}
                        <IsolatedText
                          text={view.name}
                          title={view.name}
                          className={`truncate text-sm ${nameClassName}`}
                        />
                        {view.isDefault && (
                          <span className="shrink-0 text-[10px] text-gray-400">
                            {translator.translateText("default")}
                          </span>
                        )}
                      </>
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
                        {translator.translateText("Update")}
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
                        {translator.translateText("Edit")}
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
                className={`w-full rounded-md px-2 py-1.5 text-left text-xs font-medium transition-colors ${
                  props.createDisabledReason
                    ? "cursor-not-allowed text-gray-400"
                    : "text-indigo-600 hover:bg-indigo-50"
                }`}
                disabled={Boolean(props.createDisabledReason)}
                onClick={() => {
                  props.onCreate?.();
                  setIsComponentVisible(false);
                }}
              >
                {label("create")}
              </button>
              {/* Said, not hidden in a tooltip: a locked action says why. */}
              {props.createDisabledReason ? (
                <p className="px-2 pb-0.5 text-[11px] leading-4 text-gray-500">
                  {props.createDisabledReason}
                </p>
              ) : null}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default SavedViewsDropdown;
