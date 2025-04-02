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

  public async refreshCurrentUserIdAndHandoffTimeInSchedule(
    scheduleId: ObjectID,
  ): Promise<{
    currentUserId: ObjectID | null;
    handOffTime: Date | null;
    nextUserId: ObjectID | null;
  }> {
    const result: {
      currentUserId: ObjectID | null;
      handOffTime: Date | null;
      nextUserId: ObjectID | null;
    } = await this.getCurrrentUserIdAndHandoffTimeInSchedule(scheduleId);

    await this.updateOneById({
      id: scheduleId!,
      data: {
        currentUserIdOnRoster: result.currentUserId,
        rosterNextHandoffAt: result.handOffTime,
        nextUserIdOnRoster: result.nextUserId,
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
    handOffTime: Date | null;
    nextUserId: ObjectID | null;
  }> {
    const resultReturn: {
      currentUserId: ObjectID | null;
      handOffTime: Date | null;
      nextUserId: ObjectID | null;
    } = {
      currentUserId: null,
      handOffTime: null,
      nextUserId: null,
    };

    const currentEvent: CalendarEvent | null =
      await this.getEventByIndexInSchedule({
        scheduleId: scheduleId,
        eventIndex: 0,
      });

    if (!currentEvent) {
      return resultReturn;
    }

    const userId: string | undefined = currentEvent?.title; // this is user id in string.

    if (!userId) {
      return resultReturn;
    }

    resultReturn.currentUserId = new ObjectID(userId);

    // get next event
    const nextEvent: CalendarEvent | null =
      await this.getEventByIndexInSchedule({
        scheduleId: scheduleId,
        eventIndex: 1,
      });

    if (!nextEvent) {
      return resultReturn;
    }

    const nextUserId: string | undefined = nextEvent?.title; // this is user id in string.
    if (!nextUserId) {
      return resultReturn;
    }

    resultReturn.nextUserId = new ObjectID(nextUserId);

    // get handOffTime
    const handOffTime: Date | undefined = currentEvent?.end; // this is user id in string.

    if (!handOffTime) {
      return resultReturn;
    }

    resultReturn.handOffTime = handOffTime;

    return resultReturn;
  }

  public async getEventByIndexInSchedule(data: {
    scheduleId: ObjectID;
    eventIndex: number; // which event would you like to get. First event, second event, etc.
  }): Promise<CalendarEvent | null> {
    // get schedule layers.

    const scheduleId: ObjectID = data.scheduleId;
    const eventIndex: number = data.eventIndex;

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
        getEventByIndex: eventIndex,
      },
    );

    if (events.length === 0) {
      return null;
    }

    const event: CalendarEvent = events[0]!;

    return event;
  }

  @CaptureSpan()
  public async getCurrentUserIdInSchedule(
    scheduleId: ObjectID,
  ): Promise<ObjectID | null> {
    const currentEvent: CalendarEvent | null =
      await this.getEventByIndexInSchedule({
        scheduleId: scheduleId,
        eventIndex: 0,
      });

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
