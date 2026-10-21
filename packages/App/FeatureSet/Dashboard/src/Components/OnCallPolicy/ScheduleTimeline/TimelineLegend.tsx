import { OVERRIDE_TITLE_MARKER } from "../OnCallScheduleLayer/OverridePresentation";
import { TimelinePerson } from "./TimelineModel";
import ScheduleTimelineLayout, {
  TimelineViewMode,
} from "Common/Types/OnCallDutyPolicy/ScheduleTimelineLayout";
import React, { FunctionComponent, ReactElement } from "react";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";

/*
 * Under the grid: everyone on call in view (their colour, their load, and a
 * click to follow them across every schedule), then the key for the marks
 * the grid uses and the one caveat a reader needs about past shifts.
 */

export interface ComponentProps {
  people: Array<TimelinePerson>;
  mode: TimelineViewMode;
  timezone: string;
  highlightedUserId: string | null;
  onToggleHighlight: (userId: string) => void;
  showOverrideKey: boolean;
  showGapKey: boolean;
}

const TimelineLegend: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const isMonth: boolean = props.mode === TimelineViewMode.Month;

  return (
    <div className="mt-4 space-y-3" data-testid="timeline-legend">
      {props.people.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
            {translator.translateText(
              isMonth ? "On call this month" : "On call this week",
            )}
          </span>
          {props.people.map((person: TimelinePerson) => {
            const isHighlighted: boolean =
              props.highlightedUserId === person.userId;

            return (
              <button
                key={person.userId}
                type="button"
                data-testid="timeline-person"
                data-user-id={person.userId}
                aria-pressed={isHighlighted}
                onClick={() => {
                  props.onToggleHighlight(person.userId);
                }}
                title={translator.translatePlural(
                  isMonth
                    ? {
                        one: "{{name}}: {{duration}} on call across {{count}} schedule this month. Click to highlight.",
                        other:
                          "{{name}}: {{duration}} on call across {{count}} schedules this month. Click to highlight.",
                      }
                    : {
                        one: "{{name}}: {{duration}} on call across {{count}} schedule this week. Click to highlight.",
                        other:
                          "{{name}}: {{duration}} on call across {{count}} schedules this week. Click to highlight.",
                      },
                  person.scheduleCount,
                  {
                    name: person.userName,
                    duration: ScheduleTimelineLayout.formatDuration(
                      person.onCallMilliseconds,
                    ),
                  },
                )}
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ring-1 ring-inset transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                  isHighlighted
                    ? "bg-gray-900 text-white ring-gray-900"
                    : "bg-white text-gray-700 ring-gray-200 hover:bg-gray-50"
                }`}
              >
                <span
                  className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: person.color }}
                />
                <span className="font-medium">{person.userName}</span>
                <span
                  className={isHighlighted ? "text-gray-300" : "text-gray-400"}
                >
                  {ScheduleTimelineLayout.formatDuration(
                    person.onCallMilliseconds,
                  )}
                </span>
                {person.isOnCallNow && (
                  <span
                    className="inline-block h-1.5 w-1.5 rounded-full bg-green-500"
                    title={translator.translateText("On call now")}
                  />
                )}
              </button>
            );
          })}
          {props.highlightedUserId && (
            <button
              type="button"
              data-testid="timeline-clear-highlight"
              onClick={() => {
                props.onToggleHighlight(props.highlightedUserId as string);
              }}
              className="text-xs font-medium text-indigo-600 hover:underline"
            >
              {translator.translateText("Clear highlight")}
            </button>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-gray-100 pt-3 text-xs text-gray-500">
        {props.showOverrideKey && (
          <span className="inline-flex items-center gap-1.5">
            <span className="rounded bg-indigo-50 px-1 text-[11px] font-semibold text-indigo-700 ring-1 ring-inset ring-indigo-200">
              {OVERRIDE_TITLE_MARKER}
            </span>
            {translator.translateText(
              "Covering someone else's shift (the struck-through name underneath)",
            )}
          </span>
        )}
        {props.showGapKey && (
          <span className="inline-flex items-center gap-1.5">
            <span className="oneuptime-schedule-timeline-gap-swatch inline-block h-3 w-4 rounded-sm" />
            {translator.translateText("No one on call")}
          </span>
        )}
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-0.5 rounded bg-red-500" />
          {translator.translateText("Now")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-4 rounded-sm bg-gray-300 opacity-60" />
          {translator.translateText("Past shift")}
        </span>
        <span className="text-gray-400 sm:ml-auto">
          {translator.translateTemplate(
            "Times in {{timezone}}. Past shifts are recomputed from each schedule's current setup.",
            { timezone: props.timezone },
          )}
        </span>
      </div>
    </div>
  );
};

export default TimelineLegend;
