import RunCron from "../../Utils/Cron";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import logger from "Common/Server/Utils/Logger";
import ScheduleLayerChanges from "Common/Server/Utils/OnCall/ScheduleLayerChanges";

/*
 * A change made to a schedule's layers through the API - Terraform, the
 * CLI, a script, an AI client - is told once it has been quiet for half a
 * minute (#7813): who is on call is worked out once, and the people it
 * reaches, the schedule's channels, feeds and reminders hear about the
 * whole change once, where each row written used to send its own round of
 * messages. Reads only the schedules whose change is due, by a partial
 * index that holds a schedule only while its change waits.
 */
RunCron(
  "OnCallDutySchedule:TellLayerChanges",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    const told: number = await ScheduleLayerChanges.tellDueChanges();

    logger.debug(
      `OnCallDutySchedule:TellLayerChanges told ${told} change(s) to on-call schedules' layers.`,
    );
  },
);
