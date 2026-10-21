import TimezoneSelectButton from "../OnCallScheduleLayer/TimezoneSelectButton";
import {
  ALL_TEAMS,
  AttentionFilter,
  MY_TEAMS,
  TimelineFilters,
  TimelineSummary,
  TimelineTeam,
} from "./TimelineModel";
import IconProp from "Common/Types/Icon/IconProp";
import { TimelineViewMode } from "Common/Types/OnCallDutyPolicy/ScheduleTimelineLayout";
import Icon from "Common/UI/Components/Icon/Icon";
import React, { FunctionComponent, ReactElement } from "react";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";

/*
 * The controls above the grid, in three rows that each answer one question:
 * WHEN am I looking at (navigation, week / month, timezone), WHAT is in view
 * (the summary counts, two of which double as filters), and WHICH schedules
 * (search, team, "only mine", grouping).
 */

// -- Navigation -------------------------------------------------------------

const VIEW_MODES: Array<TimelineViewMode> = [
  TimelineViewMode.Week,
  TimelineViewMode.Month,
];

export interface NavigationBarProps {
  rangeLabel: string;
  mode: TimelineViewMode;
  onModeChange: (mode: TimelineViewMode) => void;
  onToday: () => void;
  onPrevious: () => void;
  onNext: () => void;
  canGoBack: boolean;
  canGoForward: boolean;
  timezone: string;
  onTimezoneChange: (timezone: string) => void;
  isRefreshing: boolean;
}

const navButtonClassName: string =
  "inline-flex h-8 w-8 items-center justify-center text-gray-500 hover:bg-gray-50 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent";

export const NavigationBar: FunctionComponent<NavigationBarProps> = (
  props: NavigationBarProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const isMonth: boolean = props.mode === TimelineViewMode.Month;
  const previousLabel: string =
    translator.translateText(isMonth ? "Previous month" : "Previous week") ||
    "";
  const nextLabel: string =
    translator.translateText(isMonth ? "Next month" : "Next week") || "";

  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid="timeline-today-button"
          onClick={props.onToday}
          className="inline-flex h-8 items-center rounded-lg border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          {translator.translateText("Today")}
        </button>
        <div className="inline-flex divide-x divide-gray-200 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <button
            type="button"
            data-testid="timeline-previous-button"
            aria-label={previousLabel}
            title={previousLabel}
            disabled={!props.canGoBack}
            onClick={props.onPrevious}
            className={navButtonClassName}
          >
            <Icon icon={IconProp.ChevronLeft} className="h-4 w-4" />
          </button>
          <button
            type="button"
            data-testid="timeline-next-button"
            aria-label={nextLabel}
            title={nextLabel}
            disabled={!props.canGoForward}
            onClick={props.onNext}
            className={navButtonClassName}
          >
            <Icon icon={IconProp.ChevronRight} className="h-4 w-4" />
          </button>
        </div>
        <h3
          data-testid="timeline-range-label"
          className="ml-1 truncate text-base font-semibold text-gray-900"
          aria-live="polite"
        >
          {props.rangeLabel}
        </h3>
        {props.isRefreshing && (
          <span
            data-testid="timeline-refreshing"
            className="inline-flex items-center gap-1.5 text-xs text-gray-400"
          >
            <Icon
              icon={IconProp.Spinner}
              className="h-3.5 w-3.5 animate-spin"
            />
            {translator.translateText("Updating")}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <TimezoneSelectButton
          value={props.timezone}
          icon={IconProp.Globe}
          modalTitle={translationKey("View timeline in timezone")}
          modalDescription={translationKey(
            "Day boundaries and shift times on the timeline are shown in this timezone. This only changes what you see - each schedule still hands off in its own timezone.",
          )}
          submitButtonText="Apply"
          dataTestId="timeline-timezone-button"
          onChange={(timezone: string | undefined) => {
            if (timezone) {
              props.onTimezoneChange(timezone);
            }
          }}
        />
        {/*
         * A radio group, so it behaves like one: one tab stop (the checked
         * option) and the arrow keys, Home and End move the selection.
         */}
        <div
          role="radiogroup"
          aria-label={translator.translateText("Timeline range")}
          className="inline-flex rounded-lg bg-gray-100 p-0.5"
          onKeyDown={(event: React.KeyboardEvent<HTMLDivElement>) => {
            const current: number = VIEW_MODES.indexOf(props.mode);
            let next: number | null = null;

            if (event.key === "ArrowRight" || event.key === "ArrowDown") {
              next = (current + 1) % VIEW_MODES.length;
            } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
              next = (current - 1 + VIEW_MODES.length) % VIEW_MODES.length;
            } else if (event.key === "Home") {
              next = 0;
            } else if (event.key === "End") {
              next = VIEW_MODES.length - 1;
            }

            if (next === null) {
              return;
            }

            event.preventDefault();

            const target: TimelineViewMode = VIEW_MODES[next]!;

            event.currentTarget
              .querySelector<HTMLButtonElement>(
                `[data-testid="timeline-mode-${target}"]`,
              )
              ?.focus();

            if (target !== props.mode) {
              props.onModeChange(target);
            }
          }}
        >
          {VIEW_MODES.map((mode: TimelineViewMode) => {
            const isActive: boolean = props.mode === mode;

            return (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={isActive}
                tabIndex={isActive ? 0 : -1}
                data-testid={`timeline-mode-${mode}`}
                onClick={() => {
                  props.onModeChange(mode);
                }}
                className={`rounded-md px-3 py-1 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                  isActive
                    ? "bg-white text-gray-900 shadow-sm"
                    : "text-gray-500 hover:text-gray-800"
                }`}
              >
                {translator.translateText(
                  mode === TimelineViewMode.Week ? "Week" : "Month",
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

// -- Summary ----------------------------------------------------------------

export interface SummaryBarProps {
  summary: TimelineSummary;
  mode: TimelineViewMode;
  attention: AttentionFilter;
  onAttentionChange: (attention: AttentionFilter) => void;
}

export const SummaryBar: FunctionComponent<SummaryBarProps> = (
  props: SummaryBarProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const isMonth: boolean = props.mode === TimelineViewMode.Month;

  const toggle: (attention: AttentionFilter) => void = (
    attention: AttentionFilter,
  ): void => {
    props.onAttentionChange(
      props.attention === attention ? AttentionFilter.None : attention,
    );
  };

  const chipClassName: (isActive: boolean, tone: string) => string = (
    isActive: boolean,
    tone: string,
  ): string => {
    return `inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm ring-1 ring-inset transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
      isActive ? `${tone} shadow-sm` : "bg-white text-gray-600 ring-gray-200"
    }`;
  };

  return (
    <div
      className="flex flex-wrap items-center gap-2"
      data-testid="timeline-summary"
    >
      <span className="inline-flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-1.5 text-sm text-gray-600 ring-1 ring-inset ring-gray-200">
        <Icon icon={IconProp.Calendar} className="h-4 w-4 text-gray-400" />
        <span className="font-semibold text-gray-900">
          {props.summary.total}
        </span>
        {/* The count is drawn on its own, bold; this is the word beside it. */}
        {translator.translatePlural(
          { one: "schedule", other: "schedules" },
          props.summary.total,
        )}
      </span>

      {props.summary.coveredNow !== null && (
        <span
          className="inline-flex items-center gap-2 rounded-lg bg-white px-3 py-1.5 text-sm text-gray-600 ring-1 ring-inset ring-gray-200"
          data-testid="timeline-summary-covered-now"
        >
          <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
          <span className="font-semibold text-gray-900">
            {props.summary.coveredNow}
          </span>
          {translator.translateText("covered now")}
        </span>
      )}

      {/*
       * The two attention chips are the only way to see or turn off their
       * filter, so each stays up while its filter is on - even at zero.
       */}
      {((props.summary.uncoveredNow !== null &&
        props.summary.uncoveredNow > 0) ||
        props.attention === AttentionFilter.UncoveredNow) && (
        <button
          type="button"
          data-testid="timeline-summary-uncovered-now"
          aria-pressed={props.attention === AttentionFilter.UncoveredNow}
          onClick={() => {
            toggle(AttentionFilter.UncoveredNow);
          }}
          className={chipClassName(
            props.attention === AttentionFilter.UncoveredNow,
            "bg-amber-50 text-amber-800 ring-amber-300",
          )}
          title={translator.translateText(
            "Show only schedules with nobody on call right now",
          )}
        >
          <Icon icon={IconProp.Alert} className="h-4 w-4 text-amber-500" />
          <span className="font-semibold">
            {props.summary.uncoveredNow ?? 0}
          </span>
          {translator.translateText("with no one on call now")}
        </button>
      )}

      {(props.summary.withGaps > 0 ||
        props.attention === AttentionFilter.HasGaps) && (
        <button
          type="button"
          data-testid="timeline-summary-gaps"
          aria-pressed={props.attention === AttentionFilter.HasGaps}
          onClick={() => {
            toggle(AttentionFilter.HasGaps);
          }}
          className={chipClassName(
            props.attention === AttentionFilter.HasGaps,
            "bg-amber-50 text-amber-800 ring-amber-300",
          )}
          title={translator.translateText(
            isMonth
              ? "Show only schedules with a coverage gap this month"
              : "Show only schedules with a coverage gap this week",
          )}
        >
          <span className="oneuptime-schedule-timeline-gap-swatch inline-block h-3 w-3 rounded-sm" />
          <span className="font-semibold">{props.summary.withGaps}</span>
          {translator.translateText(
            isMonth
              ? "with coverage gaps this month"
              : "with coverage gaps this week",
          )}
        </button>
      )}
    </div>
  );
};

// -- Filters ----------------------------------------------------------------

export interface FilterBarProps {
  filters: TimelineFilters;
  onFiltersChange: (filters: TimelineFilters) => void;
  teams: Array<TimelineTeam>;
  // The page is locked to one team: no team picker, no grouping.
  isTeamLocked: boolean;
  groupByTeam: boolean;
  onGroupByTeamChange: (value: boolean) => void;
  hasActiveFilters: boolean;
  onClearFilters: () => void;
}

const toggleChipClassName: (isActive: boolean) => string = (
  isActive: boolean,
): string => {
  return `inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium ring-1 ring-inset transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
    isActive
      ? "bg-indigo-50 text-indigo-700 ring-indigo-300"
      : "bg-white text-gray-600 ring-gray-200 hover:bg-gray-50"
  }`;
};

export const FilterBar: FunctionComponent<FilterBarProps> = (
  props: FilterBarProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const hasMyTeams: boolean = props.teams.some((team: TimelineTeam) => {
    return team.isCurrentUserMember;
  });

  const showTeamControls: boolean =
    !props.isTeamLocked && props.teams.length > 0;

  return (
    <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center">
      <label className="relative block w-full md:w-80">
        <span className="sr-only">
          {translator.translateText("Search schedules, teams or people")}
        </span>
        <Icon
          icon={IconProp.Search}
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
        />
        <input
          type="search"
          data-testid="timeline-search"
          value={props.filters.search}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
            props.onFiltersChange({
              ...props.filters,
              search: event.target.value,
            });
          }}
          placeholder={translator.translateText(
            "Search schedules, teams or people",
          )}
          className="block h-9 w-full rounded-lg border border-gray-200 bg-white pl-9 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </label>

      {showTeamControls && (
        <label className="relative block w-full md:w-56">
          <span className="sr-only">
            {translator.translateText("Filter by team")}
          </span>
          <Icon
            icon={IconProp.UserGroup}
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
          />
          <select
            data-testid="timeline-team-filter"
            value={props.filters.team}
            onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
              props.onFiltersChange({
                ...props.filters,
                team: event.target.value,
              });
            }}
            className="block h-9 w-full appearance-none rounded-lg border border-gray-200 bg-white pl-9 pr-8 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <option value={ALL_TEAMS}>
              {translator.translateText("All teams")}
            </option>
            {hasMyTeams && (
              <option value={MY_TEAMS}>
                {translator.translateText("My teams")}
              </option>
            )}
            {props.teams.map((team: TimelineTeam) => {
              return (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              );
            })}
          </select>
          <Icon
            icon={IconProp.ChevronDown}
            className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400"
          />
        </label>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid="timeline-only-mine"
          aria-pressed={props.filters.onlyMine}
          onClick={() => {
            props.onFiltersChange({
              ...props.filters,
              onlyMine: !props.filters.onlyMine,
            });
          }}
          className={toggleChipClassName(props.filters.onlyMine)}
        >
          <Icon icon={IconProp.User} className="h-4 w-4" />
          {translator.translateText("Schedules I'm on")}
        </button>

        {showTeamControls && (
          <button
            type="button"
            data-testid="timeline-group-by-team"
            aria-pressed={props.groupByTeam}
            onClick={() => {
              props.onGroupByTeamChange(!props.groupByTeam);
            }}
            className={toggleChipClassName(props.groupByTeam)}
          >
            <Icon icon={IconProp.SquareStack} className="h-4 w-4" />
            {translator.translateText("Group by team")}
          </button>
        )}

        {props.hasActiveFilters && (
          <button
            type="button"
            data-testid="timeline-clear-filters"
            onClick={props.onClearFilters}
            className="inline-flex h-9 items-center gap-1 rounded-lg px-2 text-sm font-medium text-gray-500 hover:text-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            <Icon icon={IconProp.Close} className="h-3.5 w-3.5" />
            {translator.translateText("Clear filters")}
          </button>
        )}
      </div>
    </div>
  );
};
