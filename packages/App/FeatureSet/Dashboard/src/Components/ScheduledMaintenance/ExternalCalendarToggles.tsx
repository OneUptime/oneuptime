import { OverlayCalendar } from "./MaintenanceCalendarOverlays";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Tooltip from "Common/UI/Components/Tooltip/Tooltip";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import { Link } from "react-router-dom";

/*
 * The calendars from outside the project, under the Maintenance Calendar:
 * one toggle each - its colour, its name - that shows or hides its events
 * on the grid, for this reader (MaintenanceCalendarOverlays keeps the
 * choice). A calendar OneUptime could not read lately says so with a mark:
 * what the grid shows of it is its last good read. Calendar settings, at the
 * end, is where they are added and changed.
 *
 * Nothing at all when the project has none: the page stays as it was for
 * the projects that never add one.
 */
export interface ComponentProps {
  calendars: Array<OverlayCalendar>;
  hiddenIds: Array<string>;
  onToggle: (calendarId: string, isShown: boolean) => void;
  // Calendar Settings, for whoever may read it.
  settingsRoute?: Route | undefined;
}

export const EXTERNAL_CALENDAR_TOGGLES_TEST_ID: string =
  "scheduled-maintenance-calendar-external";

const ExternalCalendarToggles: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  if (props.calendars.length === 0) {
    return <></>;
  }

  const label: string =
    translator.translateText("External calendars") || "External calendars";

  return (
    <div
      className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-2"
      role="group"
      aria-label={label}
      data-testid={EXTERNAL_CALENDAR_TOGGLES_TEST_ID}
    >
      <span className="mr-1 text-xs font-medium text-gray-500">{label}</span>

      {props.calendars.map((calendar: OverlayCalendar): ReactElement => {
        const isShown: boolean = !props.hiddenIds.includes(calendar.id);

        const action: string = translator.translateTemplate(
          isShown
            ? "Hide {{name}} on the calendar"
            : "Show {{name}} on the calendar",
          { name: calendar.name },
        );

        return (
          <span
            key={calendar.id}
            className="inline-flex max-w-full items-center gap-1"
          >
            <button
              type="button"
              className={`inline-flex min-w-0 max-w-[16rem] items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                isShown
                  ? "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                  : "border-dashed border-gray-300 bg-transparent text-gray-400 hover:text-gray-600"
              }`}
              aria-pressed={isShown}
              aria-label={action}
              title={action}
              data-testid="scheduled-maintenance-calendar-external-toggle"
              data-calendar-id={calendar.id}
              onClick={() => {
                props.onToggle(calendar.id, !isShown);
              }}
            >
              <span
                className="oneuptime-calendar-legend-dot h-2.5 w-2.5 flex-none rounded-full"
                style={{
                  backgroundColor: isShown ? calendar.color : "transparent",
                  boxShadow: `inset 0 0 0 1.5px ${calendar.color}`,
                }}
                aria-hidden="true"
              ></span>
              <span className="truncate">{calendar.name}</span>
            </button>

            {calendar.readError ? (
              <Tooltip
                text={translator.translateText(
                  "OneUptime could not read this calendar lately. It shows the events of its last good read.",
                )}
              >
                <span
                  className="inline-flex flex-none text-amber-500"
                  role="img"
                  aria-label={translator.translateTemplate(
                    "{{name}} could not be read lately",
                    { name: calendar.name },
                  )}
                  data-testid="scheduled-maintenance-calendar-external-warning"
                >
                  <Icon icon={IconProp.ExclaimationCircle} className="h-4 w-4" />
                </span>
              </Tooltip>
            ) : (
              <></>
            )}
          </span>
        );
      })}

      {props.settingsRoute ? (
        <Link
          to={props.settingsRoute.toString()}
          className="ml-1 rounded text-xs font-medium text-indigo-600 hover:text-indigo-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          data-testid="scheduled-maintenance-calendar-external-settings"
        >
          {translator.translateText("Calendar settings")}
        </Link>
      ) : (
        <></>
      )}
    </div>
  );
};

export default ExternalCalendarToggles;
