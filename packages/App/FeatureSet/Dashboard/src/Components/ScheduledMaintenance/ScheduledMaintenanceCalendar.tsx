import {
  MAINTENANCE_CALENDAR_VIEW_LIMIT,
  MaintenanceCalendarEvent,
  getInitialMonthRange,
  getRangeQuery,
  getScheduleStartForDay,
  toCalendarEvents,
  toInstantRange,
} from "./MaintenanceCalendarView";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import Route from "Common/Types/API/Route";
import Query from "Common/Types/BaseDatabase/Query";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import CalendarEvent from "Common/Types/Calendar/CalendarEvent";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import StartAndEndTime from "Common/Types/Time/StartAndEndTime";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Calendar, {
  DefaultCalendarView,
} from "Common/UI/Components/Calendar/Calendar";
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import Icon from "Common/UI/Components/Icon/Icon";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link } from "react-router-dom";

/*
 * Scheduled Maintenance > Events as a calendar: the Calendar half of the
 * card's List | Calendar switch.
 *
 * What a reader sees, and why:
 *
 *   - The month, every event a block in its state's colour, so what is
 *     coming up and what is under way stand apart at a glance; Week and Day
 *     for a closer look. Times are in the reader's own timezone.
 *   - A block opens its event (a link a keyboard reaches); its tooltip says
 *     its state and when it runs.
 *   - A day still to come has a + in its corner, on hover, for whoever may
 *     create events: Schedule maintenance on that day, the create form open
 *     with Starts At filled in (the hour the form would pick, on that day).
 *   - Under the grid, the colours named (the project's states), or - with
 *     nothing in the view - a sentence saying so, and Subscribe to calendar,
 *     which puts the same events in the team's calendar app.
 *
 * The events are the page's own - its project, and the filter chips above,
 * which apply here as they do to the list - read for the range the grid
 * shows whenever it changes. A request that comes back after a newer one was
 * sent is dropped, so a quick click through the months never leaves an
 * earlier month's events on screen.
 */
export interface ComponentProps {
  // The page's query: its project, and whatever the filter chips add.
  query: Query<ScheduledMaintenance>;
  // The project's states, in their order: the legend's colours.
  states: Array<ScheduledMaintenanceState>;
  title: string;
  description: string;
  buttons: Array<CardButtonSchema | ReactElement>;
  // The filter chips - and List | Calendar at their end - as above the list.
  topContent?: ReactElement | undefined;
  // Whether the reader may create events: the + on each day to come.
  canCreate: boolean;
  getEventRoute: (maintenanceId: string) => Route;
  getCreateRoute: (startsAt: Date) => Route;
  onSubscribe: () => void;
  // Injected by tests; the page passes nothing and gets the reader's.
  timezone?: string | undefined;
  now?: Date | undefined;
}

export const SCHEDULED_MAINTENANCE_CALENDAR_ID: string =
  "scheduled-maintenance-calendar";

const ScheduledMaintenanceCalendar: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const timezone: string =
    props.timezone || OneUptimeDate.getCurrentTimezone().toString();

  // "Now" on the grid's terms: the reader's wall clock (MaintenanceCalendarView).
  const getDisplayNow: () => Date = useCallback((): Date => {
    return OneUptimeDate.getBrowserLocalDateFromWallClockInTimezone(
      props.now || OneUptimeDate.getCurrentDate(),
      timezone,
    );
  }, [props.now, timezone]);

  const [range, setRange] = useState<StartAndEndTime>(() => {
    return getInitialMonthRange(getDisplayNow());
  });

  const [events, setEvents] = useState<Array<ScheduledMaintenance>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [reloadCount, setReloadCount] = useState<number>(0);

  // The newest request; an answer to any other is dropped.
  const requestNumber: React.MutableRefObject<number> = useRef<number>(0);

  /*
   * The query changes identity on every render of the page around it; its
   * serialized form changes only when the chips do.
   */
  const queryKey: string = useMemo(() => {
    return JSON.stringify(
      JSONFunctions.serialize(props.query as unknown as JSONObject),
    );
  }, [props.query]);

  const rangeKey: string = `${range.startTime.getTime()}-${range.endTime.getTime()}`;

  useEffect(() => {
    requestNumber.current += 1;
    const thisRequest: number = requestNumber.current;

    setIsLoading(true);
    setError("");

    ModelAPI.getList<ScheduledMaintenance>({
      modelType: ScheduledMaintenance,
      query: getRangeQuery({
        baseQuery: props.query,
        instants: toInstantRange({ range: range, timezone: timezone }),
      }),
      select: {
        _id: true,
        title: true,
        startsAt: true,
        endsAt: true,
        currentScheduledMaintenanceState: {
          _id: true,
          name: true,
          color: true,
        },
      },
      sort: {
        startsAt: SortOrder.Ascending,
      },
      limit: MAINTENANCE_CALENDAR_VIEW_LIMIT,
      skip: 0,
    })
      .then((result: ListResult<ScheduledMaintenance>) => {
        if (thisRequest !== requestNumber.current) {
          return;
        }

        setEvents(result.data);
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (thisRequest !== requestNumber.current) {
          return;
        }

        setError(API.getFriendlyMessage(err));
        setIsLoading(false);
      });
  }, [rangeKey, queryKey, timezone, reloadCount]);

  const describeWindow: (startsAt: Date, endsAt: Date) => string = useCallback(
    (startsAt: Date, endsAt: Date): string => {
      return translator.translateTemplate("{{start}} to {{end}}", {
        start:
          OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(startsAt),
        end: OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(endsAt),
      });
    },
    [translator],
  );

  const calendarEvents: Array<MaintenanceCalendarEvent> = useMemo(() => {
    return toCalendarEvents({
      events: events,
      timezone: timezone,
      describeWindow: describeWindow,
    });
  }, [events, timezone, describeWindow]);

  const getEventRoute: (maintenanceId: string) => Route = props.getEventRoute;

  const renderEventContent: (event: CalendarEvent) => ReactElement =
    useCallback(
      (event: CalendarEvent): ReactElement => {
        const maintenanceEvent: MaintenanceCalendarEvent =
          event as MaintenanceCalendarEvent;

        /*
         * The block's own link: a keyboard reaches it, and a click on it
         * is the link's alone - the block's click (onEventClick) would open
         * the same page a second time.
         */
        return (
          <Link
            to={getEventRoute(maintenanceEvent.maintenanceId).toString()}
            className="oneuptime-calendar-event-link block truncate"
            data-testid="scheduled-maintenance-calendar-event"
            data-maintenance-id={maintenanceEvent.maintenanceId}
            aria-label={
              maintenanceEvent.stateName
                ? `${maintenanceEvent.title}, ${maintenanceEvent.stateName}`
                : maintenanceEvent.title
            }
            onClick={(clickEvent: React.MouseEvent<HTMLAnchorElement>) => {
              clickEvent.stopPropagation();
            }}
          >
            {maintenanceEvent.title}
          </Link>
        );
      },
      [getEventRoute],
    );

  const onEventClick: (event: CalendarEvent) => void = useCallback(
    (event: CalendarEvent): void => {
      Navigation.navigate(
        getEventRoute((event as MaintenanceCalendarEvent).maintenanceId),
      );
    },
    [getEventRoute],
  );

  const getCreateRoute: (startsAt: Date) => Route = props.getCreateRoute;

  const renderDayAction: ((day: Date) => ReactElement | null) | undefined =
    useMemo(() => {
      if (!props.canCreate) {
        return undefined;
      }

      // The + on a day still to come: Schedule maintenance on that day.
      const renderScheduleButton: (day: Date) => ReactElement | null = (
        day: Date,
      ): ReactElement | null => {
        const startsAt: Date | null = getScheduleStartForDay({
          day: day,
          timezone: timezone,
          now: props.now || OneUptimeDate.getCurrentDate(),
        });

        if (!startsAt) {
          return null;
        }

        const label: string = translator.translateTemplate(
          "Schedule maintenance on {{date}}",
          {
            date: OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
              startsAt,
              true,
            ),
          },
        );

        return (
          <button
            type="button"
            className="oneuptime-calendar-day-add inline-flex h-5 w-5 flex-none items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            aria-label={label}
            title={label}
            data-testid="scheduled-maintenance-calendar-add"
            onClick={(clickEvent: React.MouseEvent<HTMLButtonElement>) => {
              clickEvent.stopPropagation();
              Navigation.navigate(getCreateRoute(startsAt));
            }}
          >
            <Icon icon={IconProp.Add} className="h-3.5 w-3.5" />
          </button>
        );
      };

      return renderScheduleButton;
    }, [props.canCreate, props.now, timezone, translator, getCreateRoute]);

  const displayDefaultDate: Date = useMemo(() => {
    return getDisplayNow();
  }, [getDisplayNow]);

  const isTruncated: boolean =
    !isLoading && events.length >= MAINTENANCE_CALENDAR_VIEW_LIMIT;

  const legend: ReactElement = (
    <ul
      className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1.5"
      aria-label={translator.translateText("What the colours mean")}
      data-testid="scheduled-maintenance-calendar-legend"
    >
      {props.states.map((state: ScheduledMaintenanceState): ReactElement => {
        return (
          <li
            key={state.id?.toString() || state.name}
            className="flex items-center gap-1.5 text-xs text-gray-600"
          >
            <span
              className="oneuptime-calendar-legend-dot h-2.5 w-2.5 flex-none rounded-full"
              style={{
                backgroundColor: state.color?.toString() || "#6b7280",
              }}
              aria-hidden="true"
            ></span>
            {state.name}
          </li>
        );
      })}
    </ul>
  );

  return (
    <Card
      title={props.title}
      description={props.description}
      buttons={props.buttons}
    >
      <div data-testid={SCHEDULED_MAINTENANCE_CALENDAR_ID}>
        {props.topContent || <></>}

        {error ? (
          <Alert
            type={AlertType.DANGER}
            strongTitle={
              translator.translateText("Could not load the events.") || ""
            }
            title={error}
            textOnRight={translator.translateText("Try again") || ""}
            dataTestId="scheduled-maintenance-calendar-error"
            onClick={() => {
              setReloadCount((count: number): number => {
                return count + 1;
              });
            }}
          />
        ) : (
          <></>
        )}

        <div
          className="relative"
          aria-busy={isLoading}
          data-loading={isLoading ? "true" : "false"}
        >
          <Calendar
            id={`${SCHEDULED_MAINTENANCE_CALENDAR_ID}-grid`}
            events={calendarEvents}
            defaultCalendarView={DefaultCalendarView.Month}
            views={[
              DefaultCalendarView.Month,
              DefaultCalendarView.Week,
              DefaultCalendarView.Day,
            ]}
            defaultDate={displayDefaultDate}
            getNow={getDisplayNow}
            onRangeChange={(next: StartAndEndTime) => {
              setRange(next);
            }}
            onEventClick={onEventClick}
            renderEventContent={renderEventContent}
            renderDayAction={renderDayAction}
          />

          {isLoading ? (
            <div
              className="pointer-events-none absolute right-3 top-16 flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-medium text-gray-600 shadow-sm ring-1 ring-gray-200"
              data-testid="scheduled-maintenance-calendar-loading"
              role="status"
            >
              <span className="h-2 w-2 animate-pulse rounded-full bg-indigo-500"></span>
              {translator.translateText("Loading events...")}
            </div>
          ) : (
            <></>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          {!isLoading && !error && calendarEvents.length === 0 ? (
            <p
              className="text-sm text-gray-500"
              data-testid="scheduled-maintenance-calendar-empty"
            >
              {translator.translateText(
                "No scheduled maintenance in this period.",
              )}
            </p>
          ) : (
            legend
          )}

          <Button
            title="Subscribe to calendar"
            icon={IconProp.Calendar}
            buttonStyle={ButtonStyleType.NORMAL}
            buttonSize={ButtonSize.Small}
            className="!w-auto md:!ml-0"
            dataTestId="scheduled-maintenance-calendar-subscribe"
            onClick={props.onSubscribe}
          />
        </div>

        {isTruncated ? (
          <p
            className="mt-2 text-xs text-gray-500"
            data-testid="scheduled-maintenance-calendar-truncated"
          >
            {translator.translateTemplate(
              "Showing the first {{count}} events in this period. Narrow it with the filters, or look at a week.",
              { count: MAINTENANCE_CALENDAR_VIEW_LIMIT },
            )}
          </p>
        ) : (
          <></>
        )}
      </div>
    </Card>
  );
};

export default ScheduledMaintenanceCalendar;
