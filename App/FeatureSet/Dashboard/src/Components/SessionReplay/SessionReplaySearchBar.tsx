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
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import { SessionReplaySortBy } from "Common/Types/Rum/SessionReplayApi";
import Icon from "Common/UI/Components/Icon/Icon";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import FilterButtons from "Common/UI/Components/FilterButtons/FilterButtons";
import TelemetryTimeRangePicker from "Common/UI/Components/TelemetryViewer/components/TelemetryTimeRangePicker";
import Tooltip from "Common/UI/Components/Tooltip/Tooltip";
import {
  SessionReplayAdvancedFilters,
  SessionReplaySignalOption,
  SessionReplaySortOption,
  SESSION_REPLAY_SIGNAL_OPTIONS,
  SESSION_REPLAY_SORT_OPTIONS,
  isSessionReplaySortBy,
} from "./SessionReplayListFilters";
import {
  parseSessionReplaySearch,
  SessionReplaySearchParseResult,
  stringifySessionReplaySearch,
} from "./SessionReplaySearchQuery";

/*
 * The list's toolbar: one search input (debounced, token grammar in
 * SessionReplaySearchQuery.ts), the quick filters, the sort, and the time
 * range. Controlled by the table: the box's text is derived from the
 * applied filters and rewritten only when something OTHER than the box
 * changed them (the modal, a chip's x, Clear filters), so typing never
 * fights a re-render.
 *
 * Enter flushes the debounce immediately and is the ONLY thing that acts
 * on an id: token - a keystroke narrows the list, never navigates.
 */

export const SESSION_REPLAY_SEARCH_DEBOUNCE_MS: number = 300;

export interface SessionReplaySearchBarProps {
  filters: SessionReplayAdvancedFilters;
  onFiltersChange: (next: SessionReplayAdvancedFilters) => void;
  onNavigateToSession: (sessionId: string) => void;
  signal: string;
  onSignalChange: (signal: string) => void;
  sortBy: SessionReplaySortBy;
  onSortChange: (sortBy: SessionReplaySortBy) => void;
  timeRange: RangeStartAndEndDateTime;
  onTimeRangeChange: (range: RangeStartAndEndDateTime) => void;
  onOpenAdvancedFilters: () => void;
  /* True when the server dropped the user filter for this viewer. */
  isIdentityFilterIgnored?: boolean | undefined;
  debounceMs?: number | undefined;
}

const SORT_DROPDOWN_OPTIONS: Array<DropdownOption> =
  SESSION_REPLAY_SORT_OPTIONS.map(
    (option: SessionReplaySortOption): DropdownOption => {
      return { value: option.value, label: option.label };
    },
  );

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
  const debounceMs: number =
    props.debounceMs ?? SESSION_REPLAY_SEARCH_DEBOUNCE_MS;

  const [text, setText] = useState<string>((): string => {
    return stringifySessionReplaySearch(props.filters);
  });

  /*
   * What the box last handed to the table. When props.filters differs from
   * it, somebody else changed the filters and the box has to follow.
   */
  const lastEmittedRef: React.MutableRefObject<SessionReplayAdvancedFilters> =
    useRef<SessionReplayAdvancedFilters>(props.filters);
  const timerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null> =
    useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect((): void => {
    if (!filtersEqual(props.filters, lastEmittedRef.current)) {
      lastEmittedRef.current = props.filters;
      setText(stringifySessionReplaySearch(props.filters));
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
      return parseSessionReplaySearch(text, props.filters);
    }, [text, props.filters]);

  const commit: (value: string) => SessionReplaySearchParseResult = useCallback(
    (value: string): SessionReplaySearchParseResult => {
      const result: SessionReplaySearchParseResult = parseSessionReplaySearch(
        value,
        lastEmittedRef.current,
      );

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
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }

      timerRef.current = setTimeout((): void => {
        timerRef.current = null;
        commit(value);
      }, debounceMs);
    },
    [commit, debounceMs],
  );

  const flush: () => void = useCallback((): void => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    const result: SessionReplaySearchParseResult = commit(text);

    if (result.navigateToSessionId) {
      props.onNavigateToSession(result.navigateToSessionId);
    }
  }, [commit, text, props.onNavigateToSession]);

  const hints: Array<string> = useMemo((): Array<string> => {
    const lines: Array<string> = [...parsed.warnings];

    if (parsed.navigateToSessionId) {
      lines.push("Press Enter to open this session.");
    }

    if (props.isIdentityFilterIgnored && parsed.advanced.identifiedUserRef) {
      lines.push(
        "The user filter is ignored by the server for your role; the list is not narrowed by it.",
      );
    }

    return lines;
  }, [parsed, props.isIdentityFilterIgnored]);

  const selectedSort: DropdownOption | undefined = SORT_DROPDOWN_OPTIONS.find(
    (option: DropdownOption): boolean => {
      return option.value === props.sortBy;
    },
  );

  return (
    <div className="mb-3" data-testid="session-search-bar">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[16rem] flex-1">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
            <Icon icon={IconProp.Search} className="h-4 w-4 text-gray-400" />
          </div>
          <input
            type="search"
            data-testid="session-search-input"
            aria-label="Search sessions"
            aria-describedby="session-search-help"
            autoComplete="off"
            spellCheck={false}
            className="block w-full rounded-md border-0 py-1.5 pl-9 pr-3 text-sm text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600"
            placeholder="Search: jane@acme.com, /checkout, a session or trace id, tag:build=1.4.2, min:2m"
            value={text}
            onChange={(event: React.ChangeEvent<HTMLInputElement>): void => {
              setText(event.target.value);
              scheduleCommit(event.target.value);
            }}
            onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>): void => {
              if (event.key === "Enter") {
                event.preventDefault();
                flush();
              }
            }}
          />
        </div>

        <Dropdown
          options={SORT_DROPDOWN_OPTIONS}
          value={selectedSort}
          ariaLabel="Sort sessions"
          dataTestId="session-sort"
          className="w-44"
          onChange={(
            value: DropdownValue | Array<DropdownValue> | null,
          ): void => {
            /* Clearing the dropdown means "back to the default order". */
            const next: string =
              value === null ? "startTime" : value.toString();

            if (isSessionReplaySortBy(next) && next !== props.sortBy) {
              props.onSortChange(next);
            }
          }}
        />

        <TelemetryTimeRangePicker
          value={props.timeRange}
          onChange={props.onTimeRangeChange}
        />

        <Button
          title="Filters"
          icon={IconProp.Filter}
          buttonStyle={ButtonStyleType.OUTLINE}
          dataTestId="session-open-filters"
          ariaLabel="Open advanced filters"
          onClick={props.onOpenAdvancedFilters}
        />
      </div>

      <p
        id="session-search-help"
        className={`mt-1 text-xs ${
          hints.length > 0 ? "text-amber-700" : "text-gray-500"
        }`}
        data-testid="session-search-hint"
        aria-live="polite"
      >
        {hints.length > 0
          ? hints.join(" ")
          : "Bare text searches URLs, session and trace ids. Tokens: user:, url: (a path like /checkout, or a full URL), tag:key=value, browser:, os:, device:, country:, trigger:, min:, id:."}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <FilterButtons
          options={SESSION_REPLAY_SIGNAL_OPTIONS.map(
            (
              option: SessionReplaySignalOption,
            ): { label: string; value: string } => {
              return { label: option.label, value: option.value };
            },
          )}
          selectedValue={props.signal}
          onSelect={props.onSignalChange}
        />
        <Tooltip
          text={
            SESSION_REPLAY_SIGNAL_OPTIONS.find(
              (option: SessionReplaySignalOption): boolean => {
                return option.value === props.signal;
              },
            )?.description ?? ""
          }
        >
          <span
            className="text-xs text-gray-500"
            data-testid="session-signal-description"
            tabIndex={0}
          >
            {
              SESSION_REPLAY_SIGNAL_OPTIONS.find(
                (option: SessionReplaySignalOption): boolean => {
                  return option.value === props.signal;
                },
              )?.description
            }
          </span>
        </Tooltip>
      </div>
    </div>
  );
};

export default SessionReplaySearchBar;
