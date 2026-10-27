import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import TelemetrySearchHelp, {
  TELEMETRY_SEARCH_HELP_PLACEMENT_CLASS_NAMES,
} from "Common/UI/Components/TelemetryViewer/components/TelemetrySearchHelp";
import { SearchHelpRow } from "Common/UI/Components/TelemetryViewer/types";
import {
  TABLE_HEADER_CONTROL_HEIGHT_CLASS_NAME,
  TABLE_HEADER_SEARCH_CLEAR_BUTTON_CLASS_NAME,
  TABLE_HEADER_SEARCH_KEY_HINT_CLASS_NAME,
} from "Common/UI/Components/Table/TableHeaderControls";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { SessionReplayAdvancedFilters } from "./SessionReplayListFilters";
import {
  parseSessionReplaySearchBox,
  removeSearchBoxChipTokens,
  SESSION_REPLAY_SEARCH_HELP_COMBINED_EXAMPLE,
  SESSION_REPLAY_SEARCH_HELP_ROWS,
  SessionReplaySearchParseResult,
  stringifySessionReplaySearchBox,
} from "./SessionReplaySearchQuery";

/*
 * The session list's search: the bar the header's "Search…  /" pill opens
 * into (TableHeaderSearchSlot), drawn as every table's search is - one box,
 * a magnifier, the text, a clear button - at the height of the header's
 * other controls. Controlled by the table: the text is derived from the
 * applied filters and rewritten only when something OTHER than the box
 * changed them (a chip, the filter form, Clear all), so typing never fights
 * a re-render.
 *
 * What the box holds is what the reader searches for: free text, user:,
 * visitor:, url: and tag: (SessionReplaySearchQuery's grammar). The chips
 * under the header hold the rest - browser, OS, device, country, trigger,
 * duration - and the box does not write those out again. Their
 * tokens still work when typed: they narrow the list as the reader types,
 * and Enter moves them into their chips.
 *
 * Typing is debounced into one filter change. Enter flushes it, and is the
 * ONLY thing that acts on an id: token - a keystroke narrows the list, never
 * navigates. While the box is focused it drops down the syntax help (empty)
 * or what it made of the text (a token it dropped or rewrote, an id it can
 * open), as an explorer's search does.
 */

export const SESSION_REPLAY_SEARCH_DEBOUNCE_MS: number = 300;

// The ids the box's drop-downs go by, for aria-describedby and the tests.
export const SESSION_REPLAY_SEARCH_HINT_ID: string = "session-search-hint";

export const SESSION_REPLAY_SEARCH_HELP_TEST_ID: string = "session-search-help";

export interface SessionReplaySearchBarProps {
  filters: SessionReplayAdvancedFilters;
  onFiltersChange: (next: SessionReplayAdvancedFilters) => void;
  onNavigateToSession: (sessionId: string) => void;
  /* True when the server dropped the user filter for this viewer. */
  isIdentityFilterIgnored?: boolean | undefined;
  debounceMs?: number | undefined;
  /*
   * Whether the header's search slot is open. Folded, the box is out of the
   * keyboard's way: Tab reaches the slot's pill instead. Open unless said.
   */
  isOpen?: boolean | undefined;
  inputRef?: React.RefObject<HTMLInputElement> | undefined;
  // The box took the focus: the header keeps it open from here on.
  onFocus?: (() => void) | undefined;
  /*
   * The reader is done with the search: it lost focus with nothing in it,
   * or Escape was pressed on an empty box. The header folds it back.
   */
  onClose?: (() => void) | undefined;
}

interface SearchHint {
  text: string;
  isWarning: boolean;
}

function filtersEqual(
  a: SessionReplayAdvancedFilters,
  b: SessionReplayAdvancedFilters,
): boolean {
  return (Object.keys(a) as Array<keyof SessionReplayAdvancedFilters>).every(
    (key: keyof SessionReplayAdvancedFilters): boolean => {
      return (a[key] || "").trim() === (b[key] || "").trim();
    },
  );
}

const SessionReplaySearchBar: FunctionComponent<SessionReplaySearchBarProps> = (
  props: SessionReplaySearchBarProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const tx: (value: string) => string = (value: string): string => {
    return translator.translateText(value) || value;
  };
  const debounceMs: number =
    props.debounceMs ?? SESSION_REPLAY_SEARCH_DEBOUNCE_MS;
  const isOpen: boolean = props.isOpen !== false;
  const ownInputRef: React.RefObject<HTMLInputElement> =
    useRef<HTMLInputElement>(null);
  const inputRef: React.RefObject<HTMLInputElement> =
    props.inputRef || ownInputRef;

  const [text, setText] = useState<string>((): string => {
    return stringifySessionReplaySearchBox(props.filters);
  });
  const [isFocused, setIsFocused] = useState<boolean>(false);
  // Escape put the syntax help away; it comes back on the next focus.
  const [isHelpDismissed, setIsHelpDismissed] = useState<boolean>(false);

  /*
   * What the box last handed to the table. When props.filters differs from
   * it, somebody else changed the filters and the box has to follow.
   */
  const lastEmittedRef: React.MutableRefObject<SessionReplayAdvancedFilters> =
    useRef<SessionReplayAdvancedFilters>(props.filters);
  /*
   * The filters as they were when the box last took its text from them.
   * The box's tokens are typed over these: a chip's field the text does not
   * name keeps the value it has here (parseSessionReplaySearchBox).
   */
  const baseRef: React.MutableRefObject<SessionReplayAdvancedFilters> =
    useRef<SessionReplayAdvancedFilters>(props.filters);
  const timerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null> =
    useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelPendingCommit: () => void = useCallback((): void => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect((): void => {
    if (!filtersEqual(props.filters, lastEmittedRef.current)) {
      cancelPendingCommit();
      lastEmittedRef.current = props.filters;
      baseRef.current = props.filters;
      setText(stringifySessionReplaySearchBox(props.filters));
    }
  }, [props.filters]);

  useEffect((): (() => void) => {
    return (): void => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const parsed: SessionReplaySearchParseResult =
    useMemo((): SessionReplaySearchParseResult => {
      return parseSessionReplaySearchBox(text, baseRef.current);
    }, [text, props.filters]);

  const commit: (value: string) => SessionReplaySearchParseResult = useCallback(
    (value: string): SessionReplaySearchParseResult => {
      const result: SessionReplaySearchParseResult =
        parseSessionReplaySearchBox(value, baseRef.current);

      if (!filtersEqual(result.advanced, lastEmittedRef.current)) {
        lastEmittedRef.current = result.advanced;
        props.onFiltersChange(result.advanced);
      }

      return result;
    },
    [props.onFiltersChange],
  );

  const scheduleCommit: (value: string) => void = useCallback(
    (value: string): void => {
      cancelPendingCommit();

      timerRef.current = setTimeout((): void => {
        timerRef.current = null;
        commit(value);
      }, debounceMs);
    },
    [cancelPendingCommit, commit, debounceMs],
  );

  const flush: () => void = useCallback((): void => {
    cancelPendingCommit();

    const result: SessionReplaySearchParseResult = commit(text);

    if (result.navigateToSessionId) {
      props.onNavigateToSession(result.navigateToSessionId);
      return;
    }

    /*
     * The chips hold what the chip tokens set now: the box takes them out
     * and keeps the rest as typed.
     */
    baseRef.current = result.advanced;

    const remaining: string = removeSearchBoxChipTokens(text);

    if (remaining !== text) {
      setText(remaining);
    }
  }, [cancelPendingCommit, commit, text, props.onNavigateToSession]);

  // Empties the box and applies that at once: a click, not a keystroke.
  const clearText: () => void = useCallback((): void => {
    cancelPendingCommit();
    setText("");
    commit("");
  }, [cancelPendingCommit, commit]);

  const hints: Array<SearchHint> = useMemo((): Array<SearchHint> => {
    const lines: Array<SearchHint> = parsed.warnings.map(
      (warning: string): SearchHint => {
        return { text: warning, isWarning: true };
      },
    );

    if (parsed.navigateToSessionId) {
      lines.push({
        text: tx("Press Enter to open this session."),
        isWarning: false,
      });
    }

    if (props.isIdentityFilterIgnored && parsed.advanced.identifiedUserRef) {
      lines.push({
        text: tx(
          "The user filter is ignored by the server for your role; the list is not narrowed by it.",
        ),
        isWarning: true,
      });
    }

    return lines;
  }, [parsed, props.isIdentityFilterIgnored, translator]);

  const hasText: boolean = text.trim().length > 0;
  const warnings: Array<SearchHint> = hints.filter(
    (hint: SearchHint): boolean => {
      return hint.isWarning;
    },
  );
  const isHelpShown: boolean =
    isOpen && isFocused && !hasText && !isHelpDismissed;
  const areHintsShown: boolean =
    isOpen && isFocused && hasText && hints.length > 0;

  const boxClassName: string = isFocused
    ? "border-gray-400 ring-4 ring-gray-100 shadow-sm"
    : hasText
      ? "border-gray-300 shadow-sm"
      : "border-gray-200 shadow-sm";

  return (
    <div className="relative w-full" data-testid="session-search-bar">
      <div
        className={`flex w-full items-center gap-2 rounded-md border bg-white px-3 ${TABLE_HEADER_CONTROL_HEIGHT_CLASS_NAME} transition-all duration-200 ${boxClassName}`}
        onClick={(): void => {
          inputRef.current?.focus();
        }}
        role="presentation"
      >
        <Icon
          icon={IconProp.Search}
          className={`h-4 w-4 flex-none transition-colors duration-200 ${
            isFocused || hasText ? "text-gray-700" : "text-gray-400"
          }`}
        />
        <input
          data-unsaved-changes-ignore
          ref={inputRef}
          type="text"
          data-testid="session-search-input"
          aria-label={tx("Search sessions")}
          aria-describedby={
            areHintsShown ? SESSION_REPLAY_SEARCH_HINT_ID : undefined
          }
          autoComplete="off"
          spellCheck={false}
          tabIndex={isOpen ? 0 : -1}
          className="min-w-[6rem] flex-1 bg-transparent text-sm leading-5 text-gray-900 placeholder-gray-400 outline-none"
          placeholder={tx("Search by URL, user, session or trace ID")}
          value={text}
          onChange={(event: React.ChangeEvent<HTMLInputElement>): void => {
            setText(event.target.value);
            scheduleCommit(event.target.value);
          }}
          onFocus={(): void => {
            setIsFocused(true);
            setIsHelpDismissed(false);
            props.onFocus?.();
          }}
          onBlur={(): void => {
            setIsFocused(false);

            if (!text.trim()) {
              props.onClose?.();
            }
          }}
          onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>): void => {
            if (event.key === "Enter") {
              event.preventDefault();
              flush();
              return;
            }

            if (event.key === "Escape") {
              event.preventDefault();

              if (text) {
                clearText();
                return;
              }

              setIsHelpDismissed(true);
              props.onClose?.();
              inputRef.current?.blur();
            }
          }}
        />
        {/*
         * A warning the reader tabbed away from stays on the box: its words
         * are under the pointer and read out with the box's name.
         */}
        {!isFocused && warnings.length > 0 && (
          <span
            className="flex-none text-amber-600"
            role="img"
            aria-label={warnings
              .map((hint: SearchHint): string => {
                return hint.text;
              })
              .join(" ")}
            title={warnings
              .map((hint: SearchHint): string => {
                return hint.text;
              })
              .join("\n")}
            data-testid="session-search-warning"
          >
            <Icon icon={IconProp.Alert} className="h-4 w-4" />
          </span>
        )}
        {text.length > 0 ? (
          <button
            type="button"
            onMouseDown={(event: React.MouseEvent<HTMLButtonElement>): void => {
              // Keeps the focus in the box.
              event.preventDefault();
            }}
            onClick={(event: React.MouseEvent<HTMLButtonElement>): void => {
              event.stopPropagation();
              clearText();
              inputRef.current?.focus();
            }}
            title={tx("Clear search")}
            aria-label={tx("Clear search")}
            tabIndex={isOpen ? 0 : -1}
            data-testid="session-search-clear"
            className={TABLE_HEADER_SEARCH_CLEAR_BUTTON_CLASS_NAME}
          >
            <Icon icon={IconProp.Close} className="h-3.5 w-3.5" />
          </button>
        ) : (
          <kbd
            className={TABLE_HEADER_SEARCH_KEY_HINT_CLASS_NAME}
            title={tx("Press / to focus search")}
          >
            /
          </kbd>
        )}
      </div>

      {isHelpShown && (
        <TelemetrySearchHelp
          rows={SESSION_REPLAY_SEARCH_HELP_ROWS as Array<SearchHelpRow>}
          combinedExample={SESSION_REPLAY_SEARCH_HELP_COMBINED_EXAMPLE}
          align="right"
          dataTestId={SESSION_REPLAY_SEARCH_HELP_TEST_ID}
          onExampleClick={(example: string): void => {
            cancelPendingCommit();
            setText(example);
            commit(example);
            inputRef.current?.focus();
          }}
        />
      )}

      {areHintsShown && (
        <div
          id={SESSION_REPLAY_SEARCH_HINT_ID}
          data-testid="session-search-hint"
          aria-live="polite"
          className={`${TELEMETRY_SEARCH_HELP_PLACEMENT_CLASS_NAMES.right} space-y-1 rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-lg`}
        >
          {hints.map((hint: SearchHint, index: number): ReactElement => {
            return (
              <div
                key={index}
                className={`flex items-start gap-2 text-xs ${
                  hint.isWarning ? "text-amber-700" : "text-gray-600"
                }`}
              >
                <Icon
                  icon={hint.isWarning ? IconProp.Alert : IconProp.Info}
                  className={`mt-px h-3.5 w-3.5 flex-none ${
                    hint.isWarning ? "text-amber-500" : "text-gray-400"
                  }`}
                />
                <span className="text-pretty">{hint.text}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default SessionReplaySearchBar;
