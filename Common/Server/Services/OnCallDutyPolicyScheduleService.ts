import DatabaseService from "./DatabaseService";
import OnCallDutyPolicyScheduleLayerService from "./OnCallDutyPolicyScheduleLayerService";
import OnCallDutyPolicyScheduleLayerUserService from "./OnCallDutyPolicyScheduleLayerUserService";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import CalendarEvent from "../../Types/Calendar/CalendarEvent";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import OneUptimeDate from "../../Types/Date";
import ObjectID from "../../Types/ObjectID";
import LayerUtil, { LayerProps } from "../../Types/OnCallDutyPolicy/Layer";
import Model from "Common/Models/DatabaseModels/OnCallDutyPolicySchedule";
import OnCallDutyPolicyScheduleLayer from "Common/Models/DatabaseModels/OnCallDutyPolicyScheduleLayer";
import OnCallDutyPolicyScheduleLayerUser from "Common/Models/DatabaseModels/OnCallDutyPolicyScheduleLayerUser";
import User from "Common/Models/DatabaseModels/User";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  public async getOnCallSchedulesWhereUserIsOnCallDuty(data: {
    projectId: ObjectID;
    userId: ObjectID;
  }): Promise<Array<Model>> {
    const schedules: Array<Model> = await this.findBy({
      query: {
        projectId: data.projectId,
        currentUserIdOnRoster: data.userId,
      },
      select: {
        _id: true,
        name: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    return schedules;
  }

  public async refreshCurrentUserIdAndHandoffTimeInSchedule(
    scheduleId: ObjectID,
  ): Promise<{
    currentUserId: ObjectID | null;
    handOffTimeAt: Date | null;
    nextUserId: ObjectID | null;
    nextHandOffTimeAt: Date | null;
  }> {
    const result: {
      currentUserId: ObjectID | null;
      handOffTimeAt: Date | null;
      nextUserId: ObjectID | null;
      nextHandOffTimeAt: Date | null;
    } = await this.getCurrrentUserIdAndHandoffTimeInSchedule(scheduleId);

    await this.updateOneById({
      id: scheduleId!,
      data: {
        currentUserIdOnRoster: result.currentUserId,
        rosterHandoffAt: result.handOffTimeAt,
        nextUserIdOnRoster: result.nextUserId,
        rosterNextHandoffAt: result.nextHandOffTimeAt,
      },
      props: {
        isRoot: true,
        ignoreHooks: true,
      },
    });

    return result;
  }

  public async getCurrrentUserIdAndHandoffTimeInSchedule(
    scheduleId: ObjectID,
  ): Promise<{
    currentUserId: ObjectID | null;
    handOffTimeAt: Date | null;
    nextUserId: ObjectID | null;
    nextHandOffTimeAt: Date | null;
  }> {
    const resultReturn: {
      currentUserId: ObjectID | null;
      handOffTimeAt: Date | null;
      nextUserId: ObjectID | null;
      nextHandOffTimeAt: Date | null;
    } = {
      currentUserId: null,
      handOffTimeAt: null,
      nextUserId: null,
      nextHandOffTimeAt: null,
    };

    const events: Array<CalendarEvent> | null =
      await this.getEventByIndexInSchedule({
        scheduleId: scheduleId,
        getNumberOfEvents: 2,
      });

    const currentEvent: CalendarEvent | null = events[0] || null;
    const nextEvent: CalendarEvent | null = events[1] || null;

    if (currentEvent) {
      const userId: string | undefined = currentEvent?.title; // this is user id in string.

      if (userId) {
        resultReturn.currentUserId = new ObjectID(userId);
      }

      // get handOffTime
      const handOffTime: Date | undefined = currentEvent?.end; // this is user id in string.
      if (handOffTime) {
        resultReturn.handOffTimeAt = handOffTime;
      }
    }

    // do the same for next event.

    if (nextEvent) {
      const userId: string | undefined = nextEvent?.title; // this is user id in string.

      if (userId) {
        resultReturn.nextUserId = new ObjectID(userId);
      }

      // get handOffTime
      const handOffTime: Date | undefined = nextEvent?.end; // this is user id in string.
      if (handOffTime) {
        resultReturn.nextHandOffTimeAt = handOffTime;
      }
    }

    return resultReturn;
  }

  public async getEventByIndexInSchedule(data: {
    scheduleId: ObjectID;
    getNumberOfEvents: number; // which event would you like to get. First event, second event, etc.
  }): Promise<Array<CalendarEvent>> {
    // get schedule layers.

    const scheduleId: ObjectID = data.scheduleId;
    const numberOfEventsToGet: number = data.getNumberOfEvents;

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
    const currentEndTime: Date = OneUptimeDate.addRemoveYears(
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

    const events: Array<CalendarEvent> = LayerUtil.getMultiLayerEvents(
      {
        layers: layerProps,
        calendarStartDate: currentStartTime,
        calendarEndDate: currentEndTime,
      },
      {
        getNumberOfEvents: numberOfEventsToGet,
      },
    );

    return events;
  }

  @CaptureSpan()
  public async getCurrentUserIdInSchedule(
    scheduleId: ObjectID,
  ): Promise<ObjectID | null> {
    const events: Array<CalendarEvent> = await this.getEventByIndexInSchedule({
      scheduleId: scheduleId,
      getNumberOfEvents: 1,
    });

    const currentEvent: CalendarEvent | null = events[0] || null;

    if (!currentEvent) {
      return null;
    }

    const userId: string | undefined = currentEvent?.title; // this is user id in string.

    if (!userId) {
      return null;
    }

    return new ObjectID(userId);
  }
}

export default new Service();
