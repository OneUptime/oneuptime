import DataMigrationBase from "./DataMigrationBase";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import logger from "Common/Server/Utils/Logger";
import OnCallDutyPolicySchedule from "Common/Models/DatabaseModels/OnCallDutyPolicySchedule";
import OnCallDutyPolicyScheduleService from "Common/Server/Services/OnCallDutyPolicyScheduleService";

export default class RefreshOnCallSchedulesToAddCurrentUserOnRoster extends DataMigrationBase {
  public constructor() {
    super("RefreshOnCallSchedulesToAddCurrentUserOnRoster");
  }

  public override async migrate(): Promise<void> {
    // get all the users with email isVerified true.

    const onCallSchedules: Array<OnCallDutyPolicySchedule> =
      await OnCallDutyPolicyScheduleService.findBy({
        query: {},
        select: {
          _id: true,
        },
        skip: 0,
        limit: LIMIT_MAX,
        props: {
          isRoot: true,
        },
      });

    for (const schedule of onCallSchedules) {
      try {
        await OnCallDutyPolicyScheduleService.refreshCurrentUserIdAndHandoffTimeInSchedule(
          schedule.id!,
        );
      } catch (err) {
        logger.error(
          `Error refreshing current user and handoff time for schedule: ${schedule.id}`,
        );
        logger.error(err);
      }
    }
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
