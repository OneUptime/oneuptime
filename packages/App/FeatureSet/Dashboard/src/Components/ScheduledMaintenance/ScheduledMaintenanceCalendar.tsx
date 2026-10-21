import {
  MAINTENANCE_CALENDAR_FALLBACK_COLOR,
  MAINTENANCE_CALENDAR_VIEW_LIMIT,
  MaintenanceCalendarEvent,
  getInitialMonthRange,
  getRangeQuery,
  getScheduleStartForDay,
  toCalendarEvents,
  toInstantRange,
} from "./MaintenanceCalendarView";
import {
  MAINTENANCE_CALENDAR_OVERLAY_LIMIT,
  MaintenanceCalendarOverlayEvent,
  OverlayCalendar,
  getOverlayRangeQuery,
  getShownCalendarIds,
  isOverlayEvent,
  readHiddenCalendarIds,
  toOverlayCalendars,
  toOverlayEvents,
  toggleHiddenCalendar,
  writeHiddenCalendarIds,
} from "./MaintenanceCalendarOverlays";
import ExternalCalendarToggles from "./ExternalCalendarToggles";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceExternalCalendar from "Common/Models/DatabaseModels/ScheduledMaintenanceExternalCalendar";
import ScheduledMaintenanceExternalCalendarEvent from "Common/Models/DatabaseModels/ScheduledMaintenanceExternalCalendarEvent";
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
import { CalendarEventAppearance } from "Common/UI/Components/Calendar/CalendarEventTone";
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import Icon from "Common/UI/Components/Icon/Icon";
import {
  getPillColors,
  getPillDotStyle,
} from "Common/UI/Components/Pill/PillColors";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
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
 * Scheduled Maintenance > Calendar > Maintenance Calendar: the events as a
 * calendar, a page of its own (Pages/ScheduledMaintenanceEvents/Calendar).
 *
 * What a reader sees, and why:
 *
 *   - The month, every event a block in its state's colour - drawn soft, a
 *     pale wash with a stripe of the colour, the way the list's state pills
 *     are, so a month of black Scheduled blocks is not mostly black - so
 *     what is coming up and what is under way stand apart at a glance; Week
 *     and Day for a closer look. Times are in the reader's own timezone.
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
 *
 * Beside them, the events of the calendars from outside the project
 * (issue #5084, Calendar Settings): public holidays, a change freeze,
 * another project's maintenance - striped blocks in each calendar's colour
 * with nothing to open (MaintenanceCalendarOverlays), and a toggle each
 * under the grid that shows or hides them for this reader. They are read
 * for the same range, on their own: a calendar that fails to load never
 * keeps the project's own events off the page.
 */
export interface ComponentProps {
  // The page's query: its project, and whatever the filter chips add.
  query: Query<ScheduledMaintenance>;
  // The project's states, in their order: the legend's colours.
  states: Array<ScheduledMaintenanceState>;
  title: string;
  description: string;
  buttons: Array<CardButtonSchema | ReactElement>;
  // The filter chips, as above the list.
  topContent?: ReactElement | undefined;
  // Whether the reader may create events: the + on each day to come.
  canCreate: boolean;
  getEventRoute: (maintenanceId: string) => Route;
  getCreateRoute: (startsAt: Date) => Route;
  onSubscribe: () => void;
  // Calendar Settings, linked beside the external calendars' toggles.
  externalCalendarSettingsRoute?: Route | undefined;
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
   * The calendars from outside the project, for whoever may read them; the
   * ones this reader hid, as their browser remembers them for the project.
   */
  const projectId: string = ProjectUtil.getCurrentProjectId()?.toString() || "";

  const mayReadExternalCalendars: boolean = useMemo(() => {
    return PermissionGate.check(
      new ScheduledMaintenanceExternalCalendar(),
      ModelAction.Read,
    ).isAllowed;
  }, []);

  const [externalCalendars, setExternalCalendars] = useState<
    Array<OverlayCalendar>
  >([]);
  const [hiddenCalendarIds, setHiddenCalendarIds] = useState<Array<string>>(
    () => {
      return readHiddenCalendarIds(projectId);
    },
  );
  const [overlayRows, setOverlayRows] = useState<
    Array<ScheduledMaintenanceExternalCalendarEvent>
  >([]);
  const [isOverlayLoading, setIsOverlayLoading] = useState<boolean>(false);
  const overlayRequestNumber: React.MutableRefObject<number> =
    useRef<number>(0);

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

  // The enabled external calendars, once: they change on another page.
  useEffect(() => {
    if (!mayReadExternalCalendars) {
      return;
    }

    let isCurrent: boolean = true;

    ModelAPI.getList<ScheduledMaintenanceExternalCalendar>({
      modelType: ScheduledMaintenanceExternalCalendar,
      query: {
        isEnabled: true,
      },
      select: {
        _id: true,
        name: true,
        color: true,
        lastReadError: true,
      },
      sort: {
        name: SortOrder.Ascending,
      },
      limit: 100,
      skip: 0,
    })
      .then((result: ListResult<ScheduledMaintenanceExternalCalendar>) => {
        if (isCurrent) {
          setExternalCalendars(toOverlayCalendars(result.data));
        }
      })
      .catch(() => {
        // The project's own events still show; the toggles do not.
      });

    return () => {
      isCurrent = false;
    };
  }, [mayReadExternalCalendars]);

  const shownCalendarIds: Array<string> = useMemo(() => {
    return getShownCalendarIds(externalCalendars, hiddenCalendarIds);
  }, [externalCalendars, hiddenCalendarIds]);

  const shownCalendarsKey: string = shownCalendarIds.join(",");

  // The shown calendars' events for the range, the newest request's alone.
  useEffect(() => {
    overlayRequestNumber.current += 1;
    const thisRequest: number = overlayRequestNumber.current;

    if (shownCalendarIds.length === 0) {
      setOverlayRows([]);
      setIsOverlayLoading(false);
      return;
    }

    setIsOverlayLoading(true);

    ModelAPI.getList<ScheduledMaintenanceExternalCalendarEvent>({
      modelType: ScheduledMaintenanceExternalCalendarEvent,
      query: getOverlayRangeQuery({
        calendarIds: shownCalendarIds,
        instants: toInstantRange({ range: range, timezone: timezone }),
      }),
      select: {
        _id: true,
        scheduledMaintenanceExternalCalendarId: true,
        title: true,
        startsAt: true,
        endsAt: true,
        isAllDay: true,
      },
      sort: {
        startsAt: SortOrder.Ascending,
      },
      limit: MAINTENANCE_CALENDAR_OVERLAY_LIMIT,
      skip: 0,
    })
      .then((result: ListResult<ScheduledMaintenanceExternalCalendarEvent>) => {
        if (thisRequest !== overlayRequestNumber.current) {
          return;
        }

        setOverlayRows(result.data);
        setIsOverlayLoading(false);
      })
      .catch(() => {
        if (thisRequest !== overlayRequestNumber.current) {
          return;
        }

        // The project's own events are what the page is for: they stay.
        setOverlayRows([]);
        setIsOverlayLoading(false);
      });
  }, [rangeKey, shownCalendarsKey, timezone]);

  const onToggleExternalCalendar: (
    calendarId: string,
    isShown: boolean,
  ) => void = useCallback(
    (calendarId: string, isShown: boolean): void => {
      setHiddenCalendarIds((current: Array<string>): Array<string> => {
        const next: Array<string> = toggleHiddenCalendar(
          current,
          calendarId,
          isShown,
        );
        writeHiddenCalendarIds(projectId, next);
        return next;
      });
    },
    [projectId],
  );

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

  const overlayEvents: Array<MaintenanceCalendarOverlayEvent> = useMemo(() => {
    return toOverlayEvents({
      events: overlayRows,
      calendars: externalCalendars,
      timezone: timezone,
      describeWindow: describeWindow,
      describeDays: (firstDay: Date, lastDay: Date): string => {
        // A date as it is on the grid, never moved into a time zone.
        const asDate: (day: Date) => string = (day: Date): string => {
          return OneUptimeDate.getDateAsFormattedStringInTimezone({
            date: new Date(
              Date.UTC(day.getFullYear(), day.getMonth(), day.getDate()),
            ),
            timezone: "UTC",
            onlyShowDate: true,
          });
        };

        if (firstDay.getTime() === lastDay.getTime()) {
          return translator.translateTemplate("{{date}}, all day", {
            date: asDate(firstDay),
          });
        }

        return translator.translateTemplate("{{start}} to {{end}}, all day", {
          start: asDate(firstDay),
          end: asDate(lastDay),
        });
      },
      untitled: translator.translateText("Busy") || "Busy",
    });
  }, [overlayRows, externalCalendars, timezone, describeWindow, translator]);

  // The project's own events first, then the other calendars'.
  const gridEvents: Array<CalendarEvent> = useMemo(() => {
    return [...calendarEvents, ...overlayEvents];
  }, [calendarEvents, overlayEvents]);

  const getEventRoute: (maintenanceId: string) => Route = props.getEventRoute;

  const renderEventContent: (event: CalendarEvent) => ReactElement =
    useCallback(
      (event: CalendarEvent): ReactElement => {
        /*
         * An event from another calendar: its title, and its calendar's
         * name for a screen reader. Nothing to open.
         */
        if (isOverlayEvent(event)) {
          return (
            <span
              className="oneuptime-calendar-event-overlay block truncate"
              data-testid="scheduled-maintenance-calendar-overlay-event"
              data-calendar-id={event.externalCalendarId}
            >
              {event.title}
              <span className="sr-only">{` (${event.calendarName})`}</span>
            </span>
          );
        }

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
      // An event from another calendar has no page here.
      if (isOverlayEvent(event)) {
        return;
      }

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
            {/*
             * The colour as a block's stripe draws it, in either theme:
             * the Pill's dot (a black state's is lightened on the dark
             * theme, where black would not show).
             */}
            <span
              className="oneuptime-calendar-legend-dot h-2.5 w-2.5 flex-none rounded-full"
              data-ou-pill-dot=""
              style={getPillDotStyle(
                getPillColors(
                  state.color?.toString() ||
                    MAINTENANCE_CALENDAR_FALLBACK_COLOR,
                ),
              )}
              aria-hidden="true"
            ></span>
            {state.name}
          </li>
        );
      })}
    </ul>
  );

  /*
   * The header as All Events draws it (ModelTable's toolbar header): the
   * title and the buttons on one line, the description under both across
   * the card. Beside "Create Scheduled Maintenance Event" the default header
   * squeezed the title into a column a word wide at tablet widths, and broke
   * the description over two lines on a laptop.
   */
  return (
    <Card
      title={props.title}
      description={props.description}
      buttons={props.buttons}
      headerLayout="toolbar"
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

        <div aria-busy={isLoading} data-loading={isLoading ? "true" : "false"}>
          <Calendar
            id={`${SCHEDULED_MAINTENANCE_CALENDAR_ID}-grid`}
            events={gridEvents}
            eventAppearance={CalendarEventAppearance.Soft}
            toolbarStatus={
              isLoading || isOverlayLoading ? (
                /*
                 * Beside the period's name, where the reader who just moved
                 * to it looks; the grid stays as it was until the period's
                 * events arrive.
                 */
                <span
                  className="inline-flex items-center gap-1.5 text-xs text-gray-500"
                  data-testid="scheduled-maintenance-calendar-loading"
                  role="status"
                >
                  <Icon
                    icon={IconProp.Spinner}
                    className="h-3.5 w-3.5 animate-spin"
                  />
                  {translator.translateText("Loading events...")}
                </span>
              ) : undefined
            }
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

        {externalCalendars.length > 0 ? (
          <div className="mt-3 border-t border-gray-100 pt-3">
            <ExternalCalendarToggles
              calendars={externalCalendars}
              hiddenIds={hiddenCalendarIds}
              onToggle={onToggleExternalCalendar}
              settingsRoute={props.externalCalendarSettingsRoute}
            />
          </div>
        ) : (
          <></>
        )}

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

        {!isOverlayLoading &&
        overlayRows.length >= MAINTENANCE_CALENDAR_OVERLAY_LIMIT ? (
          <p
            className="mt-2 text-xs text-gray-500"
            data-testid="scheduled-maintenance-calendar-overlay-truncated"
          >
            {translator.translateTemplate(
              "Showing the first {{count}} events of the external calendars in this period. Hide some of them, or look at a week.",
              { count: MAINTENANCE_CALENDAR_OVERLAY_LIMIT },
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
