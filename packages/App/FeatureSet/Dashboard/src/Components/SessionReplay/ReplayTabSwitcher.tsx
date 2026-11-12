import { getHandDrawnButtonStateClassName } from "Common/UI/Components/Button/ButtonStates";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Icon from "Common/UI/Components/Icon/Icon";
import IsolatedLine from "Common/UI/Components/IsolatedText/IsolatedLine";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import IconProp from "Common/Types/Icon/IconProp";
import useComponentOutsideClick from "Common/UI/Types/UseComponentOutsideClick";
import {
  DropdownPlacement,
  getDropdownAlignmentClassName,
  getDropdownShiftStyle,
  useDropdownPlacement,
} from "Common/UI/Utils/DropdownAlignment";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  composedValue,
  createTranslator,
  DEFAULT_LANGUAGE,
  formatInline,
  getInlineSeparator,
  TemplateValues,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import { formatReplayDurationInLanguage } from "./ReplayTimelineMath";
import {
  ReplayPill,
  ReplayToolButton,
  getReplaySegmentClassName,
} from "./ReplayUi";
import {
  REPLAY_TAB_STRIP_MAX_PILLS,
  REPLAY_TAB_UNKNOWN_PAGE,
  ReplayTabGroup,
  ReplayTabStatus,
  ReplayTabSummary,
  computeReplayTabSpan,
  describeReplayTabCounts,
  describeReplayTabGroupHeading,
  describeReplayTabName,
  describeReplayTabOpened,
  describeReplayTabPage,
  filterReplayTabs,
  getReplayTabStatus,
  groupReplayTabs,
  hasOpenReplayTabs,
  resolveReplayTabsSessionDurationMs,
  selectVisibleReplayTabs,
} from "./ReplayTabs";

/*
 * The browser tabs of one recording, as a control.
 *
 * The recorder mints a new tab id on every page load, so a ten-minute
 * session through a multi-page app arrives here as a dozen "tabs" that a
 * viewer cannot tell apart: the old strip printed them in opened order as
 * "Tab 7 · 12s" and nothing else, which answers neither "which one is
 * still recording" nor "which one is the checkout page". This switcher
 * answers both:
 *
 *  - the strip leads with the tabs that are still open (display order
 *    comes from ReplayTabs), each pill carrying its page and a status dot;
 *  - past six tabs the strip stops growing and a picker lists every tab,
 *    grouped by status, searchable by page or tab number, with each tab's
 *    span drawn against the session so "the one at the end" is findable.
 *
 * Every decision about ordering, grouping, status, filtering and geometry
 * is in ReplayTabs.ts; this file renders and handles keys. The keys matter
 * more than usual: the player listens for Space, Enter and Escape on the
 * window, so the listbox consumes its own (see handleListKeyDown).
 */

export interface ReplayTabSwitcherProps {
  /* Opened order (Tab 1 first), exactly as the shell builds them. */
  tabs: Array<ReplayTabSummary>;
  onSwitchTab: (tabId: string) => void;
  /* Set when the active tab has played out and this tab has later footage. */
  continueInTab?: ReplayTabSummary | null | undefined;
  /*
   * The Continue chip's own handler. Separate from onSwitchTab because the
   * two mean different things to the engine: picking a tab from the strip
   * keeps whatever intent is in force, while continuing is "keep
   * watching" and resumes playback, which is what stopped the chip from
   * needing a Play click after it (issue 3865). Falls back to onSwitchTab
   * so a caller that has not moved over still switches.
   */
  onContinueInTab?: ((tabId: string) => void) | undefined;
  /* The session clock's length, for the picker's per-tab span bar. */
  sessionDurationMs: number;
}

/*
 * The dot reads as "still going" only for a tab that is: emerald and
 * pulsing matches the Live pill above it. Everything else is gray, and a
 * tab whose state the server never reported (an older server) is gray too
 * rather than claiming either way.
 */
const STATUS_DOT_CLASS: Record<ReplayTabStatus, string> = {
  open: "animate-pulse bg-emerald-500",
  unknown: "bg-gray-400",
  closed: "bg-gray-400",
  empty: "bg-gray-300",
};

/*
 * A tab's name with what the server says of it, for the tooltip: "Tab 2
 * (still open)", "Tab 2 (closed)". Each is a sentence with the tab in it,
 * so a language words the state for a tab, in a tab's gender, and never
 * with the bare "Open" that every Open button reads (a verb: German
 * "Öffnen"). "unknown" and "empty" have none on purpose: the server did
 * not say, and a tooltip that guessed would be the one claim an evidence
 * tool must not make. English keys, looked up where the tooltip is written.
 */
const NAME_WITH_STATUS: Record<ReplayTabStatus, string | null> = {
  open: translationKey("{{tab}} (still open)"),
  closed: translationKey("{{tab}} (closed)"),
  unknown: null,
  empty: null,
};

const ENGLISH: Translator = createTranslator(undefined, DEFAULT_LANGUAGE);

/*
 * The picker is 28rem wide, room for a tab's name, page, opening and
 * length on one row, and never wider than the screen between the 8px
 * gutters every dropdown keeps (DEFAULT_DROPDOWN_VIEWPORT_MARGIN_IN_PX):
 * 374px on a 390px phone, which useDropdownPlacement slides onto the
 * screen wherever its button sits.
 */
export const REPLAY_TAB_PICKER_WIDTH_IN_PX: number = 448;

export const REPLAY_TAB_PICKER_WIDTH_CLASS_NAME: string =
  "w-[28rem] max-w-[calc(100vw-1rem)]";

/*
 * The page a tab is showing: its LAST url, falling back to its first.
 * Each recorder tab is usually one page load, but a single-page app can
 * route within one, and where it went is what a viewer is looking for.
 */
export function readReplayTabUrl(tab: ReplayTabSummary): string {
  const last: string = (tab.lastUrl ?? "").trim();

  if (last.length > 0) {
    return last;
  }

  return (tab.firstUrl ?? "").trim();
}

/*
 * "30s", or "no footage" for a tab that stored nothing to play, in the
 * translator's language.
 */
export function describeReplayTabDuration(
  tab: ReplayTabSummary,
  translator: Translator = ENGLISH,
): string {
  return tab.hasFootage
    ? formatReplayDurationInLanguage(tab.durationMs, translator)
    : translator.translateText("no footage") || "no footage";
}

/*
 * "Tab 2 (still open) · /checkout · opened 2:14 · 30s — switch to this tab;
 * the playhead stays where it is". The pill itself only has room for a couple
 * of those parts at a narrow width, so the tooltip carries all of them.
 * One sentence in the translator's language, its facts worded in the
 * sentence's language too.
 */
export function buildReplayTabPillTitle(
  tab: ReplayTabSummary,
  translator: Translator = ENGLISH,
): string {
  if (!tab.hasFootage) {
    return (
      translator.translateText("No footage stored for this tab") ||
      "No footage stored for this tab"
    );
  }

  const facts: (sentence: Translator) => string = (
    sentence: Translator,
  ): string => {
    const nameWithStatus: string | null =
      NAME_WITH_STATUS[getReplayTabStatus(tab)];
    const parts: Array<string> = [
      nameWithStatus === null
        ? describeReplayTabName(tab, sentence)
        : sentence.translateTemplate(nameWithStatus, tabNameValue(tab)),
    ];

    const page: string = describeReplayTabPage(readReplayTabUrl(tab));

    if (page !== REPLAY_TAB_UNKNOWN_PAGE) {
      parts.push(page);
    }

    const opened: string | null = describeReplayTabOpened(tab, sentence);

    if (opened !== null) {
      parts.push(opened);
    }

    parts.push(formatReplayDurationInLanguage(tab.durationMs, sentence));

    return formatInline(parts, sentence);
  };

  return translator.translateTemplate(
    "{{facts}} — switch to this tab; the playhead stays where it is",
    { facts: composedValue(facts) },
  );
}

/* A tab's name as a value of a sentence: in the sentence's language. */
function tabNameValue(tab: ReplayTabSummary): TemplateValues {
  return {
    tab: composedValue((sentence: Translator): string => {
      return describeReplayTabName(tab, sentence);
    }),
  };
}

const ReplayTabSwitcher: FunctionComponent<ReplayTabSwitcherProps> = (
  props: ReplayTabSwitcherProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const { tabs, onSwitchTab } = props;

  /*
   * The span bars are drawn against the session, and the tabs themselves
   * are the floor for how long that is - see
   * resolveReplayTabsSessionDurationMs. A caller that hands over the
   * watched tab's length instead of the session's would otherwise pile
   * every later tab's bar against the right edge.
   */
  const sessionDurationMs: number = useMemo((): number => {
    return resolveReplayTabsSessionDurationMs(tabs, props.sessionDurationMs);
  }, [tabs, props.sessionDurationMs]);

  const {
    ref: pickerRef,
    isComponentVisible: isPickerOpen,
    setIsComponentVisible: setIsPickerOpen,
  } = useComponentOutsideClick(false);
  const [query, setQuery] = useState<string>("");

  const pickerButtonRef: React.RefObject<HTMLButtonElement> =
    useRef<HTMLButtonElement>(null);
  const pickerPanelRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);
  /*
   * The picker hangs from the edge of its button with room for it, and
   * slides along the line when neither edge has (a button in the middle of
   * a phone): on a page that reads right to left as well, where its start is
   * the button's right edge (#7098).
   */
  const pickerPlacement: DropdownPlacement = useDropdownPlacement({
    isOpen: isPickerOpen,
    anchorRef: pickerButtonRef,
    dropdownRef: pickerPanelRef,
    dropdownWidthInPx: REPLAY_TAB_PICKER_WIDTH_IN_PX,
  });
  const searchRef: React.RefObject<HTMLInputElement> =
    useRef<HTMLInputElement>(null);
  const optionRefs: React.MutableRefObject<Array<HTMLButtonElement | null>> =
    useRef<Array<HTMLButtonElement | null>>([]);
  const pillRefs: React.MutableRefObject<Map<string, HTMLButtonElement>> =
    useRef<Map<string, HTMLButtonElement>>(new Map());

  const hasStrip: boolean = tabs.length > 1;
  const hasPicker: boolean = tabs.length > REPLAY_TAB_STRIP_MAX_PILLS;
  const hasAnyOpenTab: boolean = useMemo((): boolean => {
    return hasOpenReplayTabs(tabs);
  }, [tabs]);

  /* Open tabs plus the one being watched; every tab when the list is short. */
  const visibleTabs: Array<ReplayTabSummary> =
    useMemo((): Array<ReplayTabSummary> => {
      return selectVisibleReplayTabs(tabs);
    }, [tabs]);

  const summaryText: string = describeReplayTabCounts(tabs, translator);

  /*
   * Keyed on the language rather than the translator, which useTranslator
   * builds anew on every render: the filter only reads it to match the
   * query against the name the reader sees, and every keystroke filters
   * again.
   */
  const groups: Array<ReplayTabGroup> = useMemo((): Array<ReplayTabGroup> => {
    return groupReplayTabs(filterReplayTabs(tabs, query, translator));
  }, [tabs, query, translator.language]);

  /*
   * The options in the order they are drawn, so the arrow keys and the
   * ref array agree with the screen whatever the grouping did.
   */
  const options: Array<ReplayTabSummary> =
    useMemo((): Array<ReplayTabSummary> => {
      const flattened: Array<ReplayTabSummary> = [];

      for (const group of groups) {
        for (const tab of group.tabs) {
          flattened.push(tab);
        }
      }

      return flattened;
    }, [groups]);

  const optionIndexByTabId: Map<string, number> = useMemo((): Map<
    string,
    number
  > => {
    const map: Map<string, number> = new Map<string, number>();

    options.forEach((tab: ReplayTabSummary, index: number): void => {
      map.set(tab.tabId, index);
    });

    return map;
  }, [options]);

  optionRefs.current.length = options.length;

  const closePicker: (shouldRefocusTrigger: boolean) => void = useCallback(
    (shouldRefocusTrigger: boolean): void => {
      setIsPickerOpen(false);
      setQuery("");

      if (shouldRefocusTrigger) {
        pickerButtonRef.current?.focus();
      }
    },
    [setIsPickerOpen],
  );

  /*
   * The search box takes focus on open: with a dozen tabs the fastest way
   * to the one you want is to type its page, and a viewer who would rather
   * arrow through the list is one ArrowDown away.
   */
  useEffect((): void => {
    if (isPickerOpen) {
      searchRef.current?.focus();
      return;
    }

    /*
     * And a closed picker holds no filter. closePicker clears it, but a
     * picker can also close without going through it - an outside click or
     * a second press on the trigger both flip the hook's own state - and a
     * viewer who dismissed it that way came back to a list showing one tab
     * out of eight under a button that still read "All 8 tabs".
     */
    setQuery("");
  }, [isPickerOpen]);

  const switchToTab: (tab: ReplayTabSummary) => void = useCallback(
    (tab: ReplayTabSummary): void => {
      if (!tab.hasFootage || tab.isActive) {
        return;
      }

      onSwitchTab(tab.tabId);
    },
    [onSwitchTab],
  );

  const selectOption: (tab: ReplayTabSummary) => void = useCallback(
    (tab: ReplayTabSummary): void => {
      if (!tab.hasFootage) {
        return;
      }

      closePicker(true);
      switchToTab(tab);
    },
    [closePicker, switchToTab],
  );

  /* ---- The strip. ---- */

  const focusablePills: Array<ReplayTabSummary> = visibleTabs.filter(
    (tab: ReplayTabSummary): boolean => {
      return tab.hasFootage;
    },
  );
  const rovingTabId: string | undefined =
    focusablePills.find((tab: ReplayTabSummary): boolean => {
      return tab.isActive;
    })?.tabId ?? focusablePills[0]?.tabId;

  const handlePillKeyDown: (
    event: React.KeyboardEvent<HTMLButtonElement>,
    tabId: string,
  ) => void = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    tabId: string,
  ): void => {
    if (
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      focusablePills.length === 0
    ) {
      return;
    }

    const currentIndex: number = focusablePills.findIndex(
      (tab: ReplayTabSummary): boolean => {
        return tab.tabId === tabId;
      },
    );
    let nextIndex: number;

    switch (event.key) {
      case "ArrowRight":
        nextIndex = (currentIndex + 1) % focusablePills.length;
        break;
      case "ArrowLeft":
        nextIndex =
          (currentIndex - 1 + focusablePills.length) % focusablePills.length;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = focusablePills.length - 1;
        break;
      default:
        return;
    }

    /*
     * Consumed here: the player reads Home, End and the arrows off the
     * window as seek commands, and moving between tabs must not also
     * jump the playhead.
     */
    event.preventDefault();
    event.stopPropagation();

    const nextTab: ReplayTabSummary | undefined = focusablePills[nextIndex];

    if (nextTab) {
      pillRefs.current.get(nextTab.tabId)?.focus();
      switchToTab(nextTab);
    }
  };

  /* ---- The picker's list. ---- */

  const focusOption: (index: number) => void = useCallback(
    (index: number): void => {
      optionRefs.current[index]?.focus();
    },
    [],
  );

  const findEnabledOptionIndex: (from: number, step: number) => number | null =
    useCallback(
      (from: number, step: number): number | null => {
        for (
          let index: number = from;
          index >= 0 && index < options.length;
          index += step
        ) {
          if (options[index]?.hasFootage) {
            return index;
          }
        }

        return null;
      },
      [options],
    );

  const handleSearchKeyDown: (
    event: React.KeyboardEvent<HTMLInputElement>,
  ) => void = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closePicker(true);
        return;
      }

      if (event.key === "ArrowDown") {
        const index: number | null = findEnabledOptionIndex(0, 1);

        event.preventDefault();
        event.stopPropagation();

        if (index !== null) {
          focusOption(index);
        }

        return;
      }

      if (event.key === "ArrowUp") {
        const index: number | null = findEnabledOptionIndex(
          options.length - 1,
          -1,
        );

        event.preventDefault();
        event.stopPropagation();

        if (index !== null) {
          focusOption(index);
        }

        return;
      }

      if (event.key === "Enter") {
        const index: number | null = findEnabledOptionIndex(0, 1);
        const tab: ReplayTabSummary | undefined =
          index === null ? undefined : options[index];

        event.preventDefault();
        event.stopPropagation();

        if (tab) {
          selectOption(tab);
        }

        return;
      }

      /*
       * A space typed into the filter is a space, not play/pause. The
       * global map already ignores editable targets; this stops the event
       * as well so nothing downstream has to know that rule.
       */
      if (event.key === " ") {
        event.stopPropagation();
      }
    },
    [closePicker, findEnabledOptionIndex, focusOption, options, selectOption],
  );

  const handleListKeyDown: (
    event: React.KeyboardEvent<HTMLDivElement>,
  ) => void = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>): void => {
      const focusedIndex: number = optionRefs.current.findIndex(
        (element: HTMLButtonElement | null): boolean => {
          return element !== null && element === document.activeElement;
        },
      );

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closePicker(true);
        return;
      }

      if (event.key === "Enter" || event.key === " ") {
        /*
         * Handled rather than left to the button's native activation so
         * the keydown is consumed here: Space would otherwise ALSO reach
         * the window listener as play/pause the moment the picker closed.
         */
        const tab: ReplayTabSummary | undefined =
          focusedIndex >= 0 ? options[focusedIndex] : undefined;

        event.preventDefault();
        event.stopPropagation();

        if (tab) {
          selectOption(tab);
        }

        return;
      }

      let nextIndex: number | null = null;

      if (event.key === "ArrowDown") {
        nextIndex = findEnabledOptionIndex(focusedIndex + 1, 1);
      } else if (event.key === "ArrowUp") {
        nextIndex = findEnabledOptionIndex(focusedIndex - 1, -1);

        /* Past the first option the filter box is where a viewer goes next. */
        if (nextIndex === null) {
          event.preventDefault();
          event.stopPropagation();
          searchRef.current?.focus();
          return;
        }
      } else if (event.key === "Home") {
        nextIndex = findEnabledOptionIndex(0, 1);
      } else if (event.key === "End") {
        nextIndex = findEnabledOptionIndex(options.length - 1, -1);
      } else {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      if (nextIndex !== null) {
        focusOption(nextIndex);
      }
    },
    [closePicker, findEnabledOptionIndex, focusOption, options, selectOption],
  );

  /* ---- Rendering. ---- */

  const renderStatusDot: (status: ReplayTabStatus) => ReactElement = (
    status: ReplayTabStatus,
  ): ReactElement => {
    return (
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT_CLASS[status]}`}
      />
    );
  };

  /* " · " between a pill's facts, " • " where the language reads "·" as a 0. */
  const separator: string = getInlineSeparator(translator.language);
  const pillNodes: Array<ReactElement> = [];
  let hasDrawnOpenPill: boolean = false;
  let hasDrawnClosedDivider: boolean = false;

  for (const tab of visibleTabs) {
    const status: ReplayTabStatus = getReplayTabStatus(tab);

    /*
     * A word where the open run ends. Without it the strip reads as one
     * undifferentiated row and the dots alone have to carry "these three
     * are still going, those two are done". "Closed tabs", never the bare
     * "Closed" that cases and pull requests use: a language words it for
     * tabs, in their gender, as the summary beside it does (Spanish
     * "Pestañas cerradas" next to "5 cerradas", not "Cerrado").
     */
    if (status === "closed" && hasDrawnOpenPill && !hasDrawnClosedDivider) {
      hasDrawnClosedDivider = true;
      pillNodes.push(
        <span
          key="replay-tab-strip-divider"
          aria-hidden="true"
          data-testid="replay-tab-strip-divider"
          className="shrink-0 px-1 text-[11px] font-medium uppercase tracking-wide text-gray-400"
        >
          {translator.translateText("Closed tabs")}
        </span>,
      );
    }

    if (status === "open" || status === "unknown") {
      hasDrawnOpenPill = true;
    }

    const page: string = describeReplayTabPage(readReplayTabUrl(tab));

    pillNodes.push(
      <button
        key={tab.tabId}
        ref={(element: HTMLButtonElement | null): void => {
          if (element) {
            pillRefs.current.set(tab.tabId, element);
          } else {
            pillRefs.current.delete(tab.tabId);
          }
        }}
        type="button"
        role="tab"
        aria-selected={tab.isActive}
        tabIndex={tab.tabId === rovingTabId ? 0 : -1}
        data-testid="replay-tab-pill"
        data-tab-id={tab.tabId}
        data-tab-status={status}
        disabled={!tab.hasFootage}
        title={buildReplayTabPillTitle(tab, translator)}
        className={getReplaySegmentClassName({
          isSelected: tab.isActive,
          isDisabled: !tab.hasFootage,
          size: "compact",
        })}
        onKeyDown={(event: React.KeyboardEvent<HTMLButtonElement>): void => {
          handlePillKeyDown(event, tab.tabId);
        }}
        onClick={(): void => {
          switchToTab(tab);
        }}
      >
        {/*
         * The dot only earns its width while SOME tab is still recording:
         * on a finished session every tab is closed and a row of identical
         * gray dots says nothing.
         */}
        {hasAnyOpenTab && renderStatusDot(status)}
        <span className="shrink-0">
          {describeReplayTabName(tab, translator)}
        </span>
        {/*
         * The page is the end user's address, read left to right on every
         * page: on an Arabic or Persian one, drawn the page's way, "/cart"
         * came out as "cart/" (IsolatedText keeps it as written).
         */}
        {page !== REPLAY_TAB_UNKNOWN_PAGE && (
          <span
            data-testid="replay-tab-pill-page"
            className="max-sm:hidden max-w-[12rem] truncate sm:inline"
          >
            {separator}
            <IsolatedText text={page} />
          </span>
        )}
        <span className="shrink-0 whitespace-nowrap">{`${separator}${describeReplayTabDuration(
          tab,
          translator,
        )}`}</span>
      </button>,
    );
  }

  const trimmedQuery: string = query.trim();
  /* One group titled "Tabs" is the whole list; a heading would say nothing. */
  const hasGroupHeadings: boolean = !(
    groups.length === 1 && groups[0]?.id === "all"
  );

  const renderOption: (tab: ReplayTabSummary) => ReactElement = (
    tab: ReplayTabSummary,
  ): ReactElement => {
    const status: ReplayTabStatus = getReplayTabStatus(tab);
    const url: string = readReplayTabUrl(tab);
    const page: string = describeReplayTabPage(url);
    const opened: string | null = describeReplayTabOpened(tab, translator);
    const errorCount: number = tab.errorCount ?? 0;
    const frustrationCount: number = tab.frustrationCount ?? 0;
    const span: { leftPercent: number; widthPercent: number } | null =
      computeReplayTabSpan(tab, sessionDurationMs);
    const index: number = optionIndexByTabId.get(tab.tabId) ?? -1;

    return (
      <button
        key={tab.tabId}
        ref={(element: HTMLButtonElement | null): void => {
          if (index >= 0) {
            optionRefs.current[index] = element;
          }
        }}
        type="button"
        role="option"
        aria-selected={tab.isActive}
        aria-disabled={!tab.hasFootage}
        disabled={!tab.hasFootage}
        tabIndex={-1}
        data-testid="replay-tab-option"
        data-tab-id={tab.tabId}
        data-tab-status={status}
        title={
          tab.hasFootage
            ? translator.translateTemplate(
                "Switch to {{tab}}; the playhead stays where it is",
                tabNameValue(tab),
              )
            : translator.translateText("No footage stored for this tab")
        }
        className={`flex w-full flex-col gap-1 rounded-lg px-2.5 py-1.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
          tab.isActive ? "bg-indigo-50" : ""
        } ${getHandDrawnButtonStateClassName({
          isLocked: !tab.hasFootage,
          hoverClassName: "hover:bg-gray-50",
        })}`}
        onClick={(): void => {
          selectOption(tab);
        }}
      >
        <span className="flex min-w-0 items-center gap-2">
          {renderStatusDot(status)}
          <span className="shrink-0 text-xs font-medium text-gray-900">
            {describeReplayTabName(tab, translator)}
          </span>
          {/*
           * The page in its own direction: "/cart" on an Arabic or Persian
           * page too, beside the tab's name, cut short at its own end
           * (IsolatedLine). "Unknown page" is the page's own words.
           */}
          <IsolatedLine
            as="span"
            dataTestId="replay-tab-option-page"
            text={
              page === REPLAY_TAB_UNKNOWN_PAGE
                ? translator.translateText(REPLAY_TAB_UNKNOWN_PAGE) || page
                : page
            }
            className="min-w-0 flex-1 truncate text-xs text-gray-600"
            title={url.length > 0 ? url : undefined}
          />
          {opened !== null && (
            <span className="shrink-0 text-[11px] text-gray-500">{opened}</span>
          )}
          {/*
           * Words, not a clock ("1m 30s", "۳۰ ثانیه"): in the row's own
           * font, as the strip draws them. A monospace font laid Persian
           * and Arabic letters out one per cell, unjoined.
           */}
          <span
            data-testid="replay-tab-option-duration"
            className="shrink-0 text-[11px] tabular-nums text-gray-600"
          >
            {describeReplayTabDuration(tab, translator)}
          </span>
          {errorCount > 0 && (
            <span
              data-testid="replay-tab-option-errors"
              title={translator.translatePlural(
                {
                  one: "{{count}} error in this tab",
                  other: "{{count}} errors in this tab",
                },
                errorCount,
              )}
              className="shrink-0 rounded-full bg-rose-50 px-1.5 text-[11px] font-medium text-rose-700"
            >
              {translator.formatNumber(errorCount)}
            </span>
          )}
          {frustrationCount > 0 && (
            <span
              data-testid="replay-tab-option-frustrations"
              title={translator.translatePlural(
                {
                  one: "{{count}} rage, dead or error click in this tab",
                  other: "{{count}} rage, dead or error clicks in this tab",
                },
                frustrationCount,
              )}
              className="shrink-0 rounded-full bg-amber-50 px-1.5 text-[11px] font-medium text-amber-800"
            >
              {translator.formatNumber(frustrationCount)}
            </span>
          )}
          {tab.isActive && (
            <ReplayPill tone="accent">
              {translator.translateText("Watching")}
            </ReplayPill>
          )}
        </span>
        {/*
         * Where this tab sits on the session. With a dozen tabs the list
         * is a timeline read downwards, and "the one that was open when
         * the error happened" is a position, not a name.
         */}
        <span
          aria-hidden="true"
          className="relative block h-1 w-full overflow-hidden rounded-full bg-gray-100"
        >
          {span !== null && (
            <span
              data-testid="replay-tab-option-span"
              className={`absolute inset-y-0 rounded-full ${
                status === "open" ? "bg-emerald-400" : "bg-indigo-300"
              }`}
              style={{
                left: `${span.leftPercent}%`,
                width: `${span.widthPercent}%`,
              }}
            />
          )}
        </span>
      </button>
    );
  };

  return (
    <div
      className="flex min-w-0 flex-col gap-1.5"
      data-testid="replay-tab-switcher"
    >
      {hasStrip && (
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span
            data-testid="replay-tab-summary"
            className="shrink-0 text-xs text-gray-500"
          >
            {summaryText}
          </span>
          {/*
           * Wraps rather than scrolls. `overflow-x-auto` on a strip that is
           * one line of the header gave an eleven-tab recording a horizontal
           * scrollbar nobody noticed and pushed the last four tabs off the
           * right edge; a second row is visible, a scrollbar is not.
           */}
          <div
            role="tablist"
            aria-label={translator.translateText(
              "Browser tabs in this recording",
            )}
            className="flex min-w-0 flex-wrap items-center gap-1"
          >
            {pillNodes}
          </div>

          {hasPicker && (
            <div ref={pickerRef} className="relative shrink-0">
              <ReplayToolButton
                ref={pickerButtonRef}
                dataTestId="replay-tab-picker-button"
                label={translator.translatePlural(
                  { one: "All {{count}} tab", other: "All {{count}} tabs" },
                  tabs.length,
                )}
                trailingIcon={IconProp.ChevronDown}
                variant="ghost"
                tone="accent"
                hasPopup="listbox"
                isExpanded={isPickerOpen}
                title="Every tab in this recording, with the page each one was on"
                onClick={(): void => {
                  setIsPickerOpen(!isPickerOpen);
                }}
              />

              {isPickerOpen && (
                <div
                  ref={pickerPanelRef}
                  data-testid="replay-tab-picker"
                  data-align={pickerPlacement.alignment}
                  className={`absolute ${getDropdownAlignmentClassName(
                    pickerPlacement.alignment,
                  )} z-30 mt-1 ${REPLAY_TAB_PICKER_WIDTH_CLASS_NAME} rounded-xl border border-gray-200 bg-white p-1 shadow-lg`}
                  style={getDropdownShiftStyle(pickerPlacement)}
                >
                  <div className="p-1">
                    <input
                      data-unsaved-changes-ignore
                      ref={searchRef}
                      type="text"
                      value={query}
                      data-testid="replay-tab-picker-search"
                      aria-label={translator.translateText("Filter tabs")}
                      placeholder={translator.translateText(
                        "Filter by page or tab",
                      )}
                      className="w-full rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs text-gray-800 placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none"
                      onChange={(
                        event: React.ChangeEvent<HTMLInputElement>,
                      ): void => {
                        setQuery(event.target.value);
                      }}
                      onKeyDown={handleSearchKeyDown}
                    />
                  </div>
                  <div
                    role="listbox"
                    aria-label={translator.translateText("Browser tabs")}
                    className="max-h-80 overflow-y-auto"
                    onKeyDown={handleListKeyDown}
                  >
                    {options.length === 0 ? (
                      <div
                        data-testid="replay-tab-picker-empty"
                        className="px-2.5 py-3 text-xs text-gray-500"
                      >
                        {translator.translateTemplate(
                          "No tab matches “{{query}}”",
                          { query: trimmedQuery },
                        )}
                      </div>
                    ) : (
                      groups.map((group: ReplayTabGroup): ReactElement => {
                        if (!hasGroupHeadings) {
                          return (
                            <React.Fragment key={group.id}>
                              {group.tabs.map(renderOption)}
                            </React.Fragment>
                          );
                        }

                        /* "3 still open": the group's count of tabs. */
                        const heading: string = describeReplayTabGroupHeading(
                          group,
                          translator,
                        );

                        return (
                          <div key={group.id} role="group" aria-label={heading}>
                            <div
                              data-testid="replay-tab-group"
                              data-group={group.id}
                              className="px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-gray-500"
                            >
                              {heading}
                            </div>
                            {group.tabs.map(renderOption)}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {props.continueInTab && (
        <button
          type="button"
          data-testid="replay-continue-in-tab"
          className="mt-1 inline-flex w-fit items-center gap-1.5 rounded-md bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
          title={translator.translateText(
            "This tab has played out; the session continues in another tab",
          )}
          onClick={(): void => {
            const tabId: string = props.continueInTab?.tabId ?? "";

            if (props.onContinueInTab) {
              props.onContinueInTab(tabId);
              return;
            }

            onSwitchTab(tabId);
          }}
        >
          <Icon icon={IconProp.ArrowRight} className="h-3.5 w-3.5" />
          {translator.translateTemplate(
            "Continue in {{tab}}",
            tabNameValue(props.continueInTab),
          )}
        </button>
      )}
    </div>
  );
};

export default ReplayTabSwitcher;
