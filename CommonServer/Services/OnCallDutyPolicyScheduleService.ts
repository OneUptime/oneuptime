import PostgresDatabase from "../Infrastructure/PostgresDatabase";
import DatabaseService from "./DatabaseService";
import OnCallDutyPolicyScheduleLayerService from "./OnCallDutyPolicyScheduleLayerService";
import OnCallDutyPolicyScheduleLayerUserService from "./OnCallDutyPolicyScheduleLayerUserService";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import CalendarEvent from "Common/Types/Calendar/CalendarEvent";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import LayerUtil, { LayerProps } from "Common/Types/OnCallDutyPolicy/Layer";
import Model from "Model/Models/OnCallDutyPolicySchedule";
import OnCallDutyPolicyScheduleLayer from "Model/Models/OnCallDutyPolicyScheduleLayer";
import OnCallDutyPolicyScheduleLayerUser from "Model/Models/OnCallDutyPolicyScheduleLayerUser";
import User from "Model/Models/User";

export class Service extends DatabaseService<Model> {
  public constructor(postgresDatabase?: PostgresDatabase) {
    super(Model, postgresDatabase);
  }

  public async getCurrentUserIdInSchedule(
    scheduleId: ObjectID,
  ): Promise<ObjectID | null> {
    // get schedule layers.

    const layers: Array<OnCallDutyPolicyScheduleLayer> =
      await OnCallDutyPolicyScheduleLayerService.findBy({
        query: {
          onCallDutyPolicyScheduleId: scheduleId,
        },
        select: {
          order: true,
          name: true,
          description: true,
          startsAt: true,
          restrictionTimes: true,
          rotation: true,
          onCallDutyPolicyScheduleId: true,
          projectId: true,
          handOffTime: true,
        },
        sort: {
          order: SortOrder.Ascending,
        },
        props: {
          isRoot: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
      });

    const layerUsers: Array<OnCallDutyPolicyScheduleLayerUser> =
      await OnCallDutyPolicyScheduleLayerUserService.findBy({
        query: {
          onCallDutyPolicyScheduleId: scheduleId,
        },
        select: {
          user: true,
          order: true,
          onCallDutyPolicyScheduleLayerId: true,
        },
        sort: {
          order: SortOrder.Ascending,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    const currentStartTime: Date = OneUptimeDate.getCurrentDate();
    const currentEndTime: Date = OneUptimeDate.addRemoveSeconds(
      currentStartTime,
      1,
    );

    const layerProps: Array<LayerProps> = [];

    for (const layer of layers) {
      layerProps.push({
        users:
          layerUsers
            .filter((layerUser: OnCallDutyPolicyScheduleLayerUser) => {
              return (
                layerUser.onCallDutyPolicyScheduleLayerId?.toString() ===
                layer.id?.toString()
              );
            })
            .map((layerUser: OnCallDutyPolicyScheduleLayerUser) => {
              return layerUser.user!;
            })
            .filter((user: User) => {
              return Boolean(user);
            }) || [],
        startDateTimeOfLayer: layer.startsAt!,
        restrictionTimes: layer.restrictionTimes!,
        rotation: layer.rotation!,
        handOffTime: layer.handOffTime!,
      });
    }

    const events: Array<CalendarEvent> = LayerUtil.getMultiLayerEvents({
      layers: layerProps,
      calendarStartDate: currentStartTime,
      calendarEndDate: currentEndTime,
    });

    if (events.length === 0) {
      return null;
    }

    const userId: string | undefined = events[0]?.title; // this is user id in string.

    if (!userId) {
      return null;
    }

    return new ObjectID(userId);
  }
}

export default new Service();
