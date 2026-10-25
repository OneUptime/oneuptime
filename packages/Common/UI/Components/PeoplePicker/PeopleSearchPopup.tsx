import IconProp from "../../../Types/Icon/IconProp";
import ObjectID from "../../../Types/ObjectID";
import { AnchoredFieldPopup } from "../../Types/UseAnchoredFieldPopup";
import API from "../../Utils/API/API";
import ProjectUtil from "../../Utils/Project";
import useTranslateValue from "../../Utils/Translation";
import DROPDOWN_MENU_Z_INDEX from "../Dropdown/DropdownMenuZIndex";
import Icon from "../Icon/Icon";
import PeopleAvatar from "./PeopleAvatar";
import {
  getPeoplePickerKindDefinition,
  PEOPLE_PICKER_SEARCH_LIMIT,
  PeoplePickerKindDefinition,
} from "./PeoplePickerKinds";
import {
  PeopleSearchNotice,
  PeopleSearchNoticeTone,
} from "./PeopleSearchNotice";
import {
  getPeoplePickerOptionKey,
  PeoplePickerKind,
  PeoplePickerOption,
  PeopleSearchLockedKind,
} from "./PeoplePickerTypes";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

/*
 * The search list behind "Add owner": one search box, and every kind the
 * picker offers in one list under a heading each - People, then Teams - so
 * a person and a team are picked the same way, with one click. The Owners
 * page and every form that asks for owners open this same list.
 *
 * It stays open after a pick, so several can be picked in a row. In a form
 * ("toggle") a picked row shows a tick and picking it again takes it away;
 * on the Owners page ("add") a picked row is left out, because removing an
 * owner there is its own, confirmed, action. A field that takes one pick
 * ("single") is a single choice: the picked row shows a tick, a pick
 * replaces it, and the picker closes the list.
 *
 * Keyboard: typing searches, Up and Down move through the list, Enter picks,
 * Escape closes and hands focus back to the button that opened it.
 *
 * A kind the reader may not pick (lockedKinds) is named after the ones they
 * may, under its own heading with a lock and the reason, and never searched:
 * a custom role that may add people as owners but not teams sees why the
 * teams are not there.
 */

export const PEOPLE_SEARCH_DEBOUNCE_MS: number = 250;
export const PEOPLE_SEARCH_POPUP_WIDTH_PX: number = 320;
export const PEOPLE_SEARCH_POPUP_MAX_HEIGHT_PX: number = 380;

export type PeopleSearchSelectionMode = "toggle" | "add" | "single";

/*
 * How each kind of notice is drawn under the list: what a pick did in
 * green, what it left as it was in grey, what went wrong in red - a band
 * each, in that order.
 */
const NOTICE_BANDS: ReadonlyArray<{
  tone: PeopleSearchNoticeTone;
  icon: IconProp;
  className: string;
}> = [
  {
    tone: PeopleSearchNoticeTone.Done,
    icon: IconProp.CheckCircle,
    className: "bg-green-50 text-green-700",
  },
  {
    tone: PeopleSearchNoticeTone.Unchanged,
    icon: IconProp.Info,
    className: "bg-gray-50 text-gray-600",
  },
  {
    tone: PeopleSearchNoticeTone.Problem,
    icon: IconProp.Alert,
    className: "bg-red-50 text-red-600",
  },
];

export interface ComponentProps {
  popup: AnchoredFieldPopup;
  kinds: Array<PeoplePickerKind>;
  // Keys (getPeoplePickerOptionKey) of what is picked already.
  selectedKeys: Set<string>;
  /*
   * Keys of rows the list never shows, whatever is searched: someone
   * another field already holds (the person who is away, in "Who covers?").
   */
  excludedKeys?: Set<string> | undefined;
  selectionMode: PeopleSearchSelectionMode;
  /*
   * Kinds the list would offer that the reader may not pick, each with why:
   * drawn after the kinds above, never searched. Leave a kind out of
   * `kinds` to lock it here.
   */
  lockedKinds?: Array<PeopleSearchLockedKind> | undefined;
  /*
   * A row was picked. isPicked says whether it was picked already (in toggle
   * mode, picking it again takes it away). A promise shows the row as busy
   * until it settles, and its error under the list. A list whose picks act
   * at once may answer with what the pick came to: said under the list,
   * until the next pick.
   */
  onPick: (
    option: PeoplePickerOption,
    isPicked: boolean,
  ) => void | Promise<void> | Promise<Array<PeopleSearchNotice>>;
  // Every row the list fetched, so a picker knows their names.
  onOptionsLoaded?: ((options: Array<PeoplePickerOption>) => void) | undefined;
  searchPlaceholder?: string | undefined;
  // What the list says when there is nothing to pick at all.
  emptyText?: string | undefined;
  // The dialog's name, e.g. "Add owner".
  ariaLabel: string;
}

interface RowGroup {
  kind: PeoplePickerKind;
  definition: PeoplePickerKindDefinition;
  rows: Array<PeoplePickerOption>;
}

const PeopleSearchPopup: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement | null => {
  const { translateString } = useTranslateValue();
  const { popup } = props;
  const isOpen: boolean = popup.isPopupOpen;

  const [searchText, setSearchText] = useState<string>("");
  const [debouncedSearch, setDebouncedSearch] = useState<string>("");
  const [rows, setRows] = useState<Array<PeoplePickerOption>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string>("");
  const [pendingKey, setPendingKey] = useState<string>("");
  const [pickError, setPickError] = useState<string>("");
  const [pickNotices, setPickNotices] = useState<Array<PeopleSearchNotice>>([]);
  const [activeIndex, setActiveIndex] = useState<number>(0);

  const searchInputRef: React.MutableRefObject<HTMLInputElement | null> =
    useRef<HTMLInputElement | null>(null);

  const baseId: string = useId();
  const listboxId: string = `${baseId}-listbox`;

  const kindsSignature: string = props.kinds.join(",");

  // How many records the list leaves out, whatever is searched.
  const excludedCount: number = props.excludedKeys?.size || 0;

  // What the reader may not pick: never searched, named under the list.
  const lockedKinds: Array<PeopleSearchLockedKind> = (
    props.lockedKinds || []
  ).filter((locked: PeopleSearchLockedKind): boolean => {
    return !props.kinds.includes(locked.kind);
  });

  // A fresh list each time it opens.
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setSearchText("");
    setDebouncedSearch("");
    setLoadError("");
    setPickError("");
    setPickNotices([]);
    setActiveIndex(0);
  }, [isOpen]);

  /*
   * The search box takes focus once the list is placed: until then it is
   * hidden, and a hidden element refuses focus.
   */
  useEffect(() => {
    if (!isOpen || !popup.popupPosition) {
      return;
    }

    // The list is placed at its button already: focusing it scrolls nothing.
    searchInputRef.current?.focus({ preventScroll: true });
  }, [isOpen, Boolean(popup.popupPosition)]);

  useEffect(() => {
    const handle: ReturnType<typeof setTimeout> = setTimeout(() => {
      setDebouncedSearch(searchText);
    }, PEOPLE_SEARCH_DEBOUNCE_MS);

    return () => {
      clearTimeout(handle);
    };
  }, [searchText]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (!projectId) {
      setRows([]);
      return;
    }

    let isCancelled: boolean = false;

    setIsLoading(true);
    setLoadError("");

    Promise.all(
      props.kinds.map(
        (kind: PeoplePickerKind): Promise<Array<PeoplePickerOption>> => {
          return getPeoplePickerKindDefinition(kind).search({
            projectId: projectId,
            searchText: debouncedSearch,
            /*
             * One more for each record left out below, so the list still
             * offers as many as it would without them.
             */
            limit: PEOPLE_PICKER_SEARCH_LIMIT + excludedCount,
          });
        },
      ),
    )
      .then((results: Array<Array<PeoplePickerOption>>) => {
        if (isCancelled) {
          return;
        }

        const next: Array<PeoplePickerOption> = results.flat();

        setRows(next);
        setActiveIndex(0);
        props.onOptionsLoaded?.(next);
      })
      .catch((err: unknown) => {
        if (isCancelled) {
          return;
        }

        setRows([]);
        setLoadError(API.getFriendlyMessage(err));
      })
      .finally(() => {
        if (!isCancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [isOpen, debouncedSearch, kindsSignature, excludedCount]);

  const groups: Array<RowGroup> = useMemo((): Array<RowGroup> => {
    return props.kinds
      .map((kind: PeoplePickerKind): RowGroup => {
        return {
          kind: kind,
          definition: getPeoplePickerKindDefinition(kind),
          rows: rows.filter((row: PeoplePickerOption): boolean => {
            if (row.kind !== kind) {
              return false;
            }

            const key: string = getPeoplePickerOptionKey(row.kind, row.id);

            if (props.excludedKeys?.has(key)) {
              return false;
            }

            // Only the Owners page leaves out what is picked already.
            return (
              props.selectionMode !== "add" || !props.selectedKeys.has(key)
            );
          }),
        };
      })
      .filter((group: RowGroup): boolean => {
        return group.rows.length > 0;
      });
  }, [
    rows,
    kindsSignature,
    props.selectedKeys,
    props.excludedKeys,
    props.selectionMode,
  ]);

  const visibleRows: Array<PeoplePickerOption> = useMemo(() => {
    return groups.flatMap((group: RowGroup): Array<PeoplePickerOption> => {
      return group.rows;
    });
  }, [groups]);

  const clampedActiveIndex: number =
    visibleRows.length === 0
      ? -1
      : Math.min(Math.max(activeIndex, 0), visibleRows.length - 1);

  const getOptionId: (row: PeoplePickerOption) => string = (
    row: PeoplePickerOption,
  ): string => {
    return `${baseId}-option-${row.kind}-${row.id}`;
  };

  const activeRow: PeoplePickerOption | undefined =
    clampedActiveIndex >= 0 ? visibleRows[clampedActiveIndex] : undefined;

  /*
   * Keep the row the keyboard is on in view - once the list is placed at
   * its button. Until then it is hidden where the page's flow would put it,
   * past the page's end, and scrolling a row there into view scrolled the
   * whole page down: the list then opened off the screen, above its button,
   * whenever the rows arrived before the list was placed (a quick answer, a
   * button low on the page).
   */
  const isPlaced: boolean = Boolean(popup.popupPosition);

  useEffect(() => {
    if (!activeRow || !isPlaced || typeof document === "undefined") {
      return;
    }

    const element: HTMLElement | null = document.getElementById(
      getOptionId(activeRow),
    );

    if (element && typeof element.scrollIntoView === "function") {
      element.scrollIntoView({ block: "nearest" });
    }
  }, [activeRow ? getOptionId(activeRow) : "", isPlaced]);

  const pick: (row: PeoplePickerOption) => Promise<void> = async (
    row: PeoplePickerOption,
  ): Promise<void> => {
    if (pendingKey) {
      return;
    }

    const key: string = getPeoplePickerOptionKey(row.kind, row.id);
    const isPicked: boolean = props.selectedKeys.has(key);

    setPickError("");
    setPickNotices([]);

    const result: void | Promise<void> | Promise<Array<PeopleSearchNotice>> =
      props.onPick(row, isPicked);

    if (!result || typeof (result as Promise<unknown>).then !== "function") {
      return;
    }

    setPendingKey(key);

    try {
      const notices: void | Array<PeopleSearchNotice> = await result;

      if (Array.isArray(notices)) {
        setPickNotices(notices);
      }
    } catch (err) {
      setPickError(API.getFriendlyMessage(err));
    } finally {
      setPendingKey("");
    }
  };

  if (!isOpen || !popup.portalTarget) {
    return null;
  }

  const onSearchKeyDown: (
    event: React.KeyboardEvent<HTMLInputElement>,
  ) => void = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex(
        visibleRows.length === 0
          ? 0
          : Math.min(clampedActiveIndex + 1, visibleRows.length - 1),
      );
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex(Math.max(clampedActiveIndex - 1, 0));
      return;
    }

    if (event.key === "Enter") {
      // Enter picks; it must never submit the form the picker sits in.
      event.preventDefault();

      if (activeRow) {
        void pick(activeRow);
      }
    }
  };

  const searchPlaceholder: string =
    props.searchPlaceholder || "Search people or teams...";
  const emptyText: string = props.emptyText || "No people or teams available.";
  const trimmedSearch: string = debouncedSearch.trim();

  let rowIndex: number = -1;

  return createPortal(
    <div
      ref={popup.popupRef}
      id={popup.popupId}
      data-testid="people-search-popup"
      role="dialog"
      aria-label={translateString(props.ariaLabel) || props.ariaLabel}
      tabIndex={-1}
      className="fixed flex flex-col overflow-hidden rounded-lg bg-white shadow-xl ring-1 ring-gray-200"
      style={{
        /*
         * Fixed from its first frame, whatever the stylesheet has generated
         * yet: the Dashboard's Tailwind writes a class's rule only once it
         * sees the class on the page, and a list left in the page's flow
         * for that frame sat past the page's end - focusing its search box
         * there scrolled the whole page down, and the list then opened off
         * the screen.
         */
        position: "fixed",
        bottom: popup.popupPosition?.bottom,
        left: popup.popupPosition?.left ?? 0,
        maxHeight: popup.popupPosition?.maxHeight,
        top: popup.popupPosition?.top,
        visibility: popup.popupPosition ? "visible" : "hidden",
        width: popup.popupPosition?.width ?? PEOPLE_SEARCH_POPUP_WIDTH_PX,
        zIndex: DROPDOWN_MENU_Z_INDEX,
      }}
    >
      <div className="flex-shrink-0 border-b border-gray-100 px-3 pb-2 pt-3">
        <div className="relative">
          <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-gray-400">
            <Icon icon={IconProp.Search} className="h-4 w-4" />
          </span>
          <input
            ref={searchInputRef}
            type="text"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={true}
            aria-controls={listboxId}
            aria-activedescendant={
              activeRow ? getOptionId(activeRow) : undefined
            }
            aria-label={translateString(searchPlaceholder) || searchPlaceholder}
            data-testid="people-search-input"
            value={searchText}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
              setSearchText(event.target.value);
            }}
            onKeyDown={onSearchKeyDown}
            placeholder={
              translateString(searchPlaceholder) || searchPlaceholder
            }
            className="w-full rounded-md border border-gray-200 bg-gray-50 py-1.5 pl-8 pr-3 text-sm text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
      </div>

      <div
        id={listboxId}
        role="listbox"
        aria-label={translateString(props.ariaLabel) || props.ariaLabel}
        aria-multiselectable={
          props.selectionMode === "toggle" ? true : undefined
        }
        aria-busy={isLoading}
        className="min-h-0 flex-1 overflow-y-auto py-1"
      >
        {isLoading && visibleRows.length === 0 && (
          <div className="flex items-center justify-center gap-2 px-3 py-6 text-sm text-gray-500">
            <Icon icon={IconProp.Spinner} className="h-4 w-4 animate-spin" />
            <span>{translateString("Searching...")}</span>
          </div>
        )}

        {!isLoading && loadError && (
          <div
            role="alert"
            className="flex items-start gap-2 px-3 py-4 text-sm text-red-600"
          >
            <Icon
              icon={IconProp.Alert}
              className="mt-0.5 h-4 w-4 flex-shrink-0"
            />
            <span>{loadError}</span>
          </div>
        )}

        {/*
         * Nothing to pick says so - unless every kind is locked, which the
         * locked kinds under the list say better.
         */}
        {!isLoading &&
          !loadError &&
          visibleRows.length === 0 &&
          props.kinds.length > 0 && (
            <div className="px-3 py-6 text-center text-sm text-gray-500">
              {trimmedSearch
                ? translateString("No matches found.")
                : translateString(emptyText) || emptyText}
            </div>
          )}

        {groups.map((group: RowGroup): ReactElement => {
          const headingId: string = `${baseId}-group-${group.kind}`;

          return (
            <div
              key={group.kind}
              role="group"
              aria-labelledby={headingId}
              className="px-1"
            >
              <div
                id={headingId}
                className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400"
              >
                {translateString(group.definition.groupTitle) ||
                  group.definition.groupTitle}
              </div>
              <div className="px-1 pb-1">
                {group.rows.map((row: PeoplePickerOption): ReactElement => {
                  rowIndex++;
                  const index: number = rowIndex;
                  const key: string = getPeoplePickerOptionKey(
                    row.kind,
                    row.id,
                  );
                  const isPicked: boolean = props.selectedKeys.has(key);
                  const isActive: boolean = index === clampedActiveIndex;
                  const isPending: boolean = pendingKey === key;
                  /*
                   * A person's email, else what picking the row does, else
                   * what kind of record it is.
                   */
                  const kindSubtitle: string | undefined =
                    group.definition.searchSubtitle || group.definition.tag;
                  const subtitle: string | undefined =
                    row.description ||
                    (kindSubtitle
                      ? translateString(kindSubtitle) || kindSubtitle
                      : undefined);

                  return (
                    <div
                      key={key}
                      id={getOptionId(row)}
                      role="option"
                      aria-selected={
                        props.selectionMode === "add" ? false : isPicked
                      }
                      aria-disabled={Boolean(pendingKey) || undefined}
                      data-testid="people-search-option"
                      data-kind={row.kind}
                      data-id={row.id}
                      onMouseDown={(event: React.MouseEvent) => {
                        // Keep focus in the search box.
                        event.preventDefault();
                      }}
                      onMouseEnter={() => {
                        setActiveIndex(index);
                      }}
                      onClick={() => {
                        void pick(row);
                      }}
                      className={`flex w-full cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-left transition-colors ${
                        isActive ? "bg-gray-100" : "hover:bg-gray-50"
                      } ${pendingKey && !isPending ? "opacity-60" : ""}`}
                    >
                      <PeopleAvatar
                        size="sm"
                        item={{
                          kind: row.kind,
                          name: row.name,
                          userId: row.userId,
                          hasProfilePicture: row.hasProfilePicture,
                        }}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-gray-900">
                          {row.name}
                        </div>
                        {subtitle && (
                          <div className="truncate text-xs text-gray-500">
                            {subtitle}
                          </div>
                        )}
                      </div>
                      {isPending ? (
                        <Icon
                          icon={IconProp.Spinner}
                          className="h-4 w-4 flex-shrink-0 animate-spin text-gray-400"
                        />
                      ) : isPicked ? (
                        <Icon
                          icon={IconProp.Check}
                          className="h-4 w-4 flex-shrink-0 text-indigo-600"
                        />
                      ) : props.selectionMode === "single" ? (
                        // A single choice is made by picking: nothing to add.
                        <></>
                      ) : (
                        <Icon
                          icon={IconProp.Add}
                          className="h-4 w-4 flex-shrink-0 text-gray-400"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/*
       * The kinds the reader may not pick, each under its heading with a
       * lock and why. It scrolls on its own past a few lines, so a long
       * list of permissions never squeezes out the people.
       */}
      {lockedKinds.length > 0 && (
        <div
          data-testid="people-search-locked-kinds"
          className="max-h-32 flex-shrink-0 divide-y divide-gray-100 overflow-y-auto border-t border-gray-100"
        >
          {lockedKinds.map((locked: PeopleSearchLockedKind): ReactElement => {
            const definition: PeoplePickerKindDefinition =
              getPeoplePickerKindDefinition(locked.kind);
            const headingId: string = `${baseId}-locked-${locked.kind}`;

            return (
              <div
                key={locked.kind}
                role="group"
                aria-labelledby={headingId}
                data-testid="people-search-locked-kind"
                data-kind={locked.kind}
                className="px-4 py-2"
              >
                <div
                  id={headingId}
                  className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400"
                >
                  <Icon
                    icon={IconProp.Lock}
                    className="h-3 w-3 flex-shrink-0"
                  />
                  <span>
                    {translateString(definition.groupTitle) ||
                      definition.groupTitle}
                  </span>
                </div>
                <p
                  data-testid="people-search-locked-reason"
                  className="mt-1 text-xs leading-5 text-gray-500"
                >
                  {locked.reason}
                </p>
              </div>
            );
          })}
        </div>
      )}

      {/*
       * What the last pick came to. It scrolls on its own past a few
       * lines, so a long list of problems never squeezes out the people.
       */}
      {(pickError || pickNotices.length > 0) && (
        <div
          data-testid="people-search-notices"
          className="max-h-40 flex-shrink-0 divide-y divide-gray-100 overflow-y-auto border-t border-gray-100"
        >
          {NOTICE_BANDS.map(
            (band: {
              tone: PeopleSearchNoticeTone;
              icon: IconProp;
              className: string;
            }): ReactElement | null => {
              const texts: Array<string> = pickNotices
                .filter((notice: PeopleSearchNotice): boolean => {
                  return notice.tone === band.tone;
                })
                .map((notice: PeopleSearchNotice): string => {
                  return notice.text;
                });

              if (texts.length === 0) {
                return null;
              }

              return (
                <div
                  key={band.tone}
                  role={
                    band.tone === PeopleSearchNoticeTone.Problem
                      ? "alert"
                      : "status"
                  }
                  data-testid={`people-search-notice-${band.tone}`}
                  className={`flex items-start gap-2 px-3 py-2 text-xs ${band.className}`}
                >
                  <Icon
                    icon={band.icon}
                    className="mt-0.5 h-3.5 w-3.5 flex-shrink-0"
                  />
                  <div className="min-w-0 space-y-1">
                    {texts.map((text: string, index: number): ReactElement => {
                      return <p key={index}>{text}</p>;
                    })}
                  </div>
                </div>
              );
            },
          )}
          {pickError && (
            <div
              role="alert"
              className="flex items-start gap-2 bg-red-50 px-3 py-2 text-xs text-red-600"
            >
              <Icon
                icon={IconProp.Alert}
                className="mt-0.5 h-3.5 w-3.5 flex-shrink-0"
              />
              <span>{pickError}</span>
            </div>
          )}
        </div>
      )}
    </div>,
    popup.portalTarget,
  );
};

export default PeopleSearchPopup;
