import RunCron from "../../Utils/Cron";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import ExternalCalendarRefresher from "Common/Server/Utils/ScheduledMaintenance/ExternalCalendar/ExternalCalendarRefresher";

/*
 * The calendars from outside a project drawn on its maintenance calendar
 * (Scheduled Maintenance > Settings > Calendar Settings, issue #5084). Every
 * minute, each enabled calendar whose next read is due - a new one at once,
 * the rest every refresh interval - is read through the egress guard,
 * worked out in a worker thread and its events kept: one at a time, batch
 * after batch for at most 45 seconds, so a run's memory never grows with the
 * number of calendars and a backlog is still worked through
 * (ExternalCalendarRefresher).
 */
RunCron(
  "ScheduledMaintenance:RefreshExternalCalendars",
  {
    schedule: EVERY_MINUTE,
    runOnStartup: false,
    timeoutInMS: 10 * 60 * 1000,
  },
  async () => {
    await ExternalCalendarRefresher.readDueCalendars();
  },
);
