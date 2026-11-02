import RunCron from "../../Utils/Cron";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import ExceptionAssignmentNotifications, {
  EXCEPTION_ASSIGNED_JOB_NAME,
} from "Common/Server/Utils/Telemetry/ExceptionAssignmentNotifications";

/*
 * Tells the people an exception was assigned to - the person, or the members
 * of the team - once a minute, from the Assigned entries of the exceptions'
 * activity (ExceptionAssignmentNotifications). The owner-added jobs'
 * ordering: each entry is marked told before anything is sent, so a send
 * that fails is dropped rather than retried every minute.
 */
RunCron(
  EXCEPTION_ASSIGNED_JOB_NAME,
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    await ExceptionAssignmentNotifications.sendPendingNotifications();
  },
);
