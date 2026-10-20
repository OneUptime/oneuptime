import RunCron from "../../Utils/Cron";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import ExternalCalendarRefresher from "Common/Server/Utils/ScheduledMaintenance/ExternalCalendar/ExternalCalendarRefresher";

/*
 * The calendars from outside a project drawn on its maintenance calendar
 * (Scheduled Maintenance > Settings > Calendar Settings, issue #5084). Every
 * minute, each enabled calendar whose next read is due - a new one at once,
 * the rest every refresh interval - is read through the egress guard,
 * worked out in a worker thread and its events kept; a batch at a time, so
 * a run never grows with the number of calendars (ExternalCalendarRefresher).
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
