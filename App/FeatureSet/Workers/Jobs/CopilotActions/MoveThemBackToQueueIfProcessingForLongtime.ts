import RunCron from "../../Utils/Cron";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import { EVERY_THIRTY_MINUTES } from "Common/Utils/CronTime";
import OneUptimeDate from "Common/Types/Date";
import CopilotAction from "Common/Models/DatabaseModels/CopilotAction";
import CopilotActionService from "Common/Server/Services/CopilotActionService";
import CopilotActionStatus from "Common/Types/Copilot/CopilotActionStatus";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";

RunCron(
  "CopilotAction:MoveThemBackToQueueIfProcessingForLongtime",
  { schedule: EVERY_THIRTY_MINUTES, runOnStartup: true },
  async () => {
    const lastHour: Date = OneUptimeDate.addRemoveHours(
      OneUptimeDate.getCurrentDate(),
      -1,
    );

    //get stalled copilot actions and move them back to queue so they can be processed again.

    const stalledActions: Array<CopilotAction> =
      await CopilotActionService.findBy({
        query: {
          copilotActionStatus: CopilotActionStatus.PROCESSING,
          statusChangedAt: QueryHelper.lessThanEqualToOrNull(lastHour),
        },
        select: {
          _id: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    for (const stalledAction of stalledActions) {
      await CopilotActionService.updateOneById({
        id: stalledAction.id!,
        data: {
          copilotActionStatus: CopilotActionStatus.IN_QUEUE,
          statusChangedAt: null,
        },
        props: {
          isRoot: true,
        },
      });
    }
  },
);
