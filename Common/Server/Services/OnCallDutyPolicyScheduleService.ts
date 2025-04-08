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
      rosterStartAt: Date | null;
      nextRosterStartAt: Date | null;
    } = await this.getCurrrentUserIdAndHandoffTimeInSchedule(scheduleId);

    await this.updateOneById({
      id: scheduleId!,
      data: {
        currentUserIdOnRoster: result.currentUserId,
        rosterHandoffAt: result.handOffTimeAt,
        nextUserIdOnRoster: result.nextUserId,
        rosterNextHandoffAt: result.nextHandOffTimeAt,
        rosterStartAt: result.rosterStartAt,
        rosterNextStartAt: result.nextRosterStartAt,
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
    rosterStartAt: Date | null;
    currentUserId: ObjectID | null;
    handOffTimeAt: Date | null;
    nextUserId: ObjectID | null;
    nextHandOffTimeAt: Date | null;
    nextRosterStartAt: Date | null;
  }> {
    const resultReturn: {
      rosterStartAt: Date | null;
      currentUserId: ObjectID | null;
      handOffTimeAt: Date | null;
      nextUserId: ObjectID | null;
      nextHandOffTimeAt: Date | null;
      nextRosterStartAt: Date | null;
    } = {
      currentUserId: null,
      handOffTimeAt: null,
      nextUserId: null,
      nextHandOffTimeAt: null,
      rosterStartAt: null,
      nextRosterStartAt: null,
    };

    const events: Array<CalendarEvent> | null =
      await this.getEventByIndexInSchedule({
        scheduleId: scheduleId,
        getNumberOfEvents: 2,
      });

    let currentEvent: CalendarEvent | null = events[0] || null;
    let nextEvent: CalendarEvent | null = events[1] || null;

    // if the current event start time in the future then the current event is the next event.
    if (currentEvent && OneUptimeDate.isInTheFuture(currentEvent.start)) {
      nextEvent = currentEvent;
      currentEvent = null;
    }

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

      // get start time
      const startTime: Date | undefined = currentEvent?.start; // this is user id in string.
      if (startTime) {
        resultReturn.rosterStartAt = startTime;
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

      // get start time
      const startTime: Date | undefined = nextEvent?.start; // this is user id in string.
      if (startTime) {
        resultReturn.nextRosterStartAt = startTime;
      }
    }

    return resultReturn;
  }

  private async getScheduleLayerProps(data: {
    scheduleId: ObjectID,
  }
  ): Promise<Array<LayerProps>> {
       // get schedule layers.

    const scheduleId: ObjectID = data.scheduleId;
   

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

      return layerProps;
  }

  public async getEventByIndexInSchedule(data: {
    scheduleId: ObjectID;
    getNumberOfEvents: number; // which event would you like to get. First event, second event, etc.
  }): Promise<Array<CalendarEvent>> {

    const layerProps: Array<LayerProps> =
      await this.getScheduleLayerProps({
        scheduleId: data.scheduleId,
      });

    if (layerProps.length === 0) {
      return [];
    }
   

    const currentStartTime: Date = OneUptimeDate.getCurrentDate();
    const currentEndTime: Date = OneUptimeDate.addRemoveYears(
      currentStartTime,
      1,
    );

   
    const numberOfEventsToGet: number = data.getNumberOfEvents;
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

    const layerProps: Array<LayerProps> =
      await this.getScheduleLayerProps({
        scheduleId: scheduleId,
      });

    if (layerProps.length === 0) {
      return null;
    }
   

    const currentStartTime: Date = OneUptimeDate.getCurrentDate();
    const currentEndTime: Date = OneUptimeDate.addRemoveSeconds(
      currentStartTime,
      1,
    );

   
    const events: Array<CalendarEvent> = LayerUtil.getMultiLayerEvents(
      {
        layers: layerProps,
        calendarStartDate: currentStartTime,
        calendarEndDate: currentEndTime,
      },
      {
        getNumberOfEvents: 1,
      },
    );


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
