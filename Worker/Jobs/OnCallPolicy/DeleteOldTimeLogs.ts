import RunCron from "../../Utils/Cron";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import { EVERY_DAY } from "Common/Utils/CronTime";
import logger from "Common/Server/Utils/Logger";
import OneUptimeDate from "Common/Types/Date";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import OnCallDutyPolicyTimeLogService from "Common/Server/Services/OnCallDutyPolicyTimeLogService";
import { IsBillingEnabled } from "Common/Server/EnvironmentConfig";

RunCron(
  "OnCallDuty:DeleteOldTimeLogs",
  { schedule: EVERY_DAY, runOnStartup: true },
  async () => {
    if (!IsBillingEnabled) {
      // retain data if its self-hosted and billing is not enabled.
      return;
    }

    logger.debug("Starting cron job: OnCallDutySchedule:RefreshHandoffTime");

    const sixMonthsAgo: Date = OneUptimeDate.getSomeDaysAgo(200); // approx 200 days.

    // get time logs older than 6 months. EndsAt is more than 6 months ago.

    await OnCallDutyPolicyTimeLogService.deleteBy({
      query: {
        endsAt: QueryHelper.lessThanEqualTo(sixMonthsAgo),
      },
      props: {
        isRoot: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
    });
  },
);
