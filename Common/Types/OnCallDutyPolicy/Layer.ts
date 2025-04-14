import UserModel from "../../Models/DatabaseModels/User";
import CalendarEvent from "../Calendar/CalendarEvent";
import OneUptimeDate from "../Date";
import EventInterval from "../Events/EventInterval";
import Recurring from "../Events/Recurring";
import StartAndEndTime from "../Time/StartAndEndTime";
import Typeof from "../Typeof";
import RestrictionTimes, {
  RestrictionType,
  WeeklyResctriction,
} from "./RestrictionTimes";

export interface LayerProps {
  users: Array<UserModel>;
  startDateTimeOfLayer: Date;
  restrictionTimes: RestrictionTimes;
  handOffTime: Date;
  rotation: Recurring;
}

export interface EventProps extends LayerProps {
  calendarStartDate: Date;
  calendarEndDate: Date;
}

export interface MultiLayerProps {
  layers: Array<LayerProps>;
  calendarStartDate: Date;
  calendarEndDate: Date;
}

export interface PriorityCalendarEvents extends CalendarEvent {
  priority: number;
}

export default class LayerUtil {
  public getEvents(
    data: EventProps,
    options?:
      | {
          getNumberOfEvents?: number;
        }
      | undefined,
  ): Array<CalendarEvent> {
    let events: Array<CalendarEvent> = [];

    if (!this.isDataValid(data)) {
      return [];
    }

    data = this.sanitizeData(data);

    let start: Date = data.calendarStartDate;
    const end: Date = data.calendarEndDate;

    // start time of the layer is after the start time of the calendar, so we need to update the start time of the calendar
    if (OneUptimeDate.isAfter(data.startDateTimeOfLayer, start)) {
      start = data.startDateTimeOfLayer;
    }

    // split events by rotation.

    const rotation: Recurring = data.rotation;

    let hasReachedTheEndOfTheCalendar: boolean = false;

    let handOffTime: Date = data.handOffTime;

    if (!handOffTime) {
      return [];
    }

    // Looop vars
    let currentUserIndex: number = 0;
    let currentEventStartTime: Date = start;

    // bring handoff time to the same day as the currentStartTime.

    // before we do this, we need to update the user index.

    currentUserIndex = this.getCurrentUserIndexBasedOnHandoffTime({
      rotation,
      handOffTime,
      currentUserIndex,
      startDateTimeOfLayer: data.startDateTimeOfLayer,
      users: data.users,
      currentEventStartTime,
    });

    // update handoff time to the same day as current start time

    handOffTime = this.moveHandsOffTimeAfterCurrentEventStartTime({
      handOffTime,
      currentEventStartTime,
      rotation: data.rotation,
    });

    let currentEventEndTime: Date = OneUptimeDate.getCurrentDate(); // temporary set to current time to avoid typescript error

    // check if calendar end is before the handoff time. if it is, then we need to return the event with the current user index as no handoff is needed.

    if (OneUptimeDate.isBefore(end, handOffTime)) {
      const trimmedStartAndEndTimes: Array<StartAndEndTime> =
        this.trimStartAndEndTimesBasedOnRestrictionTimes({
          eventStartTime: currentEventStartTime,
          eventEndTime: end,
          restrictionTimes: data.restrictionTimes,
        });

      events = [
        ...events,
        ...this.getCalendarEventsFromStartAndEndDates(
          trimmedStartAndEndTimes,
          data.users,
          currentUserIndex,
        ),
      ];

      return events;
    }

    // break clause. This loop executes 50 times at max.
    const maxLoopCount: number = 100;
    let loopCount: number = 0;

    while (!hasReachedTheEndOfTheCalendar) {
      loopCount++;
      if (loopCount > maxLoopCount) {
        break;
      }
      currentEventEndTime = handOffTime;

      // if current event start time and end time is the same then increase current event start time by 1 second.

      if (OneUptimeDate.isSame(currentEventStartTime, currentEventEndTime)) {
        currentEventStartTime = OneUptimeDate.addRemoveSeconds(
          currentEventEndTime,
          1,
        );
        handOffTime = this.moveHandsOffTimeAfterCurrentEventStartTime({
          handOffTime,
          currentEventStartTime,
          rotation: data.rotation,
        });

        continue;
      }

      // check calendar end time. if the end time of the event is after the end time of the calendar, we need to update the end time of the event
      if (OneUptimeDate.isAfter(currentEventEndTime, end)) {
        currentEventEndTime = end;
        hasReachedTheEndOfTheCalendar = true;
      }

      // check restriction times. if the end time of the event is after the end time of the restriction times, we need to update the end time of the event.

      const trimmedStartAndEndTimes: Array<StartAndEndTime> =
        this.trimStartAndEndTimesBasedOnRestrictionTimes({
          eventStartTime: currentEventStartTime,
          eventEndTime: currentEventEndTime,
          restrictionTimes: data.restrictionTimes,
        });

      events = [
        ...events,
        ...this.getCalendarEventsFromStartAndEndDates(
          trimmedStartAndEndTimes,
          data.users,
          currentUserIndex,
        ),
      ];

      if (options?.getNumberOfEvents !== undefined) {
        if (events.length >= options.getNumberOfEvents) {
          return events;
        }
      }

      // update the current event start time

      currentEventStartTime = OneUptimeDate.addRemoveSeconds(
        currentEventEndTime,
        1,
      );

      // update the handoff time

      handOffTime = this.moveHandsOffTimeAfterCurrentEventStartTime({
        handOffTime,
        currentEventStartTime,
        rotation: data.rotation,
      });

      // update the current user index
      currentUserIndex = this.incrementUserIndex(
        currentUserIndex,
        data.users.length,
      );
    }

    // increment ids of all the events and return them, to make sure they are unique

    let id: number = 1;

    for (const event of events) {
      event.id = id;
      id++;
    }

    if (options?.getNumberOfEvents !== undefined) {
      if (events.length > options.getNumberOfEvents) {
        events = events.slice(0, options.getNumberOfEvents);
      }
    }

    return events;
  }

  private sanitizeData(data: EventProps): EventProps {
    if (!(data.restrictionTimes instanceof RestrictionTimes)) {
      data.restrictionTimes = RestrictionTimes.fromJSON(data.restrictionTimes);
    }

    if (!(data.rotation instanceof Recurring)) {
      data.rotation = Recurring.fromJSON(data.rotation);
    }

    if (typeof data.startDateTimeOfLayer === Typeof.String) {
      data.startDateTimeOfLayer = OneUptimeDate.fromString(
        data.startDateTimeOfLayer,
      );
    }

    if (typeof data.calendarStartDate === Typeof.String) {
      data.calendarStartDate = OneUptimeDate.fromString(data.calendarStartDate);
    }

    if (typeof data.calendarEndDate === Typeof.String) {
      data.calendarEndDate = OneUptimeDate.fromString(data.calendarEndDate);
    }

    if (typeof data.handOffTime === Typeof.String) {
      data.handOffTime = OneUptimeDate.fromString(data.handOffTime);
    }

    return data;
  }

  private isDataValid(data: EventProps): boolean {
    // if calendar end time is before the start time then return an empty array.
    if (OneUptimeDate.isBefore(data.calendarEndDate, data.calendarStartDate)) {
      return false;
    }

    // end time of the layer is before the end time of the calendar, so, we dont have any events and we can return empty array
    if (
      OneUptimeDate.isAfter(data.startDateTimeOfLayer, data.calendarEndDate)
    ) {
      return false;
    }

    // if users are empty, we dont have any events and we can return empty array
    if (data.users.length === 0) {
      return false;
    }

    return true;
  }

  private moveHandsOffTimeAfterCurrentEventStartTime(data: {
    handOffTime: Date;
    currentEventStartTime: Date;
    rotation: Recurring;
  }): Date {
    // if handoff time is ahead of the current event start time, then we dont need to move and we can return it as is.

    if (OneUptimeDate.isAfter(data.handOffTime, data.currentEventStartTime)) {
      return data.handOffTime;
    }

    let handOffTime: Date = data.handOffTime;

    let intervalBetweenStartTimeAndHandoffTime: number = 0;
    const rotationInterval: number = data.rotation.intervalCount.toNumber();

    if (data.rotation.intervalType === EventInterval.Day) {
      intervalBetweenStartTimeAndHandoffTime =
        OneUptimeDate.getDaysBetweenTwoDatesInclusive(
          handOffTime,
          data.currentEventStartTime,
        );

      if (intervalBetweenStartTimeAndHandoffTime < rotationInterval) {
        intervalBetweenStartTimeAndHandoffTime = rotationInterval;
      } else if (
        intervalBetweenStartTimeAndHandoffTime % rotationInterval !==
        0
      ) {
        intervalBetweenStartTimeAndHandoffTime += rotationInterval;
      }

      // add intervalBetweenStartTimeAndHandoffTime to handoff time

      handOffTime = OneUptimeDate.addRemoveDays(
        handOffTime,
        intervalBetweenStartTimeAndHandoffTime,
      );

      if (OneUptimeDate.isOnOrBefore(handOffTime, data.currentEventStartTime)) {
        handOffTime = OneUptimeDate.addRemoveDays(handOffTime, 1);
      }

      return handOffTime;
    }

    if (data.rotation.intervalType === EventInterval.Hour) {
      intervalBetweenStartTimeAndHandoffTime =
        OneUptimeDate.getHoursBetweenTwoDatesInclusive(
          handOffTime,
          data.currentEventStartTime,
        );

      if (intervalBetweenStartTimeAndHandoffTime < rotationInterval) {
        intervalBetweenStartTimeAndHandoffTime = rotationInterval;
      } else if (
        intervalBetweenStartTimeAndHandoffTime % rotationInterval !==
        0
      ) {
        intervalBetweenStartTimeAndHandoffTime += rotationInterval;
      }

      // add intervalBetweenStartTimeAndHandoffTime to handoff time

      handOffTime = OneUptimeDate.addRemoveHours(
        handOffTime,
        intervalBetweenStartTimeAndHandoffTime,
      );

      if (OneUptimeDate.isOnOrBefore(handOffTime, data.currentEventStartTime)) {
        handOffTime = OneUptimeDate.addRemoveHours(handOffTime, 1);
      }

      return handOffTime;
    }

    if (data.rotation.intervalType === EventInterval.Week) {
      intervalBetweenStartTimeAndHandoffTime =
        OneUptimeDate.getWeeksBetweenTwoDatesInclusive(
          handOffTime,
          data.currentEventStartTime,
        );

      if (intervalBetweenStartTimeAndHandoffTime < rotationInterval) {
        intervalBetweenStartTimeAndHandoffTime = rotationInterval;
      } else if (
        intervalBetweenStartTimeAndHandoffTime % rotationInterval !==
        0
      ) {
        intervalBetweenStartTimeAndHandoffTime += rotationInterval;
      }

      // add intervalBetweenStartTimeAndHandoffTime to handoff time

      handOffTime = OneUptimeDate.addRemoveWeeks(
        handOffTime,
        intervalBetweenStartTimeAndHandoffTime,
      );

      if (OneUptimeDate.isOnOrBefore(handOffTime, data.currentEventStartTime)) {
        handOffTime = OneUptimeDate.addRemoveWeeks(handOffTime, 1);
      }

      return handOffTime;
    }

    if (data.rotation.intervalType === EventInterval.Month) {
      intervalBetweenStartTimeAndHandoffTime =
        OneUptimeDate.getMonthsBetweenTwoDatesInclusive(
          handOffTime,
          data.currentEventStartTime,
        );

      if (intervalBetweenStartTimeAndHandoffTime < rotationInterval) {
        intervalBetweenStartTimeAndHandoffTime = rotationInterval;
      } else if (
        intervalBetweenStartTimeAndHandoffTime % rotationInterval !==
        0
      ) {
        intervalBetweenStartTimeAndHandoffTime += rotationInterval;
      }

      // add intervalBetweenStartTimeAndHandoffTime to handoff time

      handOffTime = OneUptimeDate.addRemoveMonths(
        handOffTime,
        intervalBetweenStartTimeAndHandoffTime,
      );

      if (OneUptimeDate.isOnOrBefore(handOffTime, data.currentEventStartTime)) {
        handOffTime = OneUptimeDate.addRemoveMonths(handOffTime, 1);
      }

      return handOffTime;
    }

    if (data.rotation.intervalType === EventInterval.Year) {
      intervalBetweenStartTimeAndHandoffTime =
        OneUptimeDate.getYearsBetweenTwoDatesInclusive(
          handOffTime,
          data.currentEventStartTime,
        );

      if (intervalBetweenStartTimeAndHandoffTime < rotationInterval) {
        intervalBetweenStartTimeAndHandoffTime = rotationInterval;
      } else if (
        intervalBetweenStartTimeAndHandoffTime % rotationInterval !==
        0
      ) {
        intervalBetweenStartTimeAndHandoffTime += rotationInterval;
      }

      // add intervalBetweenStartTimeAndHandoffTime to handoff time

      handOffTime = OneUptimeDate.addRemoveYears(
        handOffTime,
        intervalBetweenStartTimeAndHandoffTime,
      );

      if (OneUptimeDate.isOnOrBefore(handOffTime, data.currentEventStartTime)) {
        handOffTime = OneUptimeDate.addRemoveYears(handOffTime, 1);
      }

      return handOffTime;
    }

    return handOffTime;
  }

  private getCurrentUserIndexBasedOnHandoffTime(data: {
    rotation: Recurring;
    handOffTime: Date;
    currentUserIndex: number;
    startDateTimeOfLayer: Date;
    users: Array<UserModel>;
    currentEventStartTime: Date;
  }): number {
    let intervalBetweenStartTimeAndHandoffTime: number = 0;
    const rotation: Recurring = data.rotation;
    const handOffTime: Date = data.handOffTime;
    let currentUserIndex: number = data.currentUserIndex;

    // if current event start time if before the start time of the layer then return current Index

    if (
      OneUptimeDate.isBefore(
        data.currentEventStartTime,
        data.startDateTimeOfLayer,
      )
    ) {
      return currentUserIndex;
    }

    // if handoff time is ahead of current event stat time then return current index

    if (OneUptimeDate.isAfter(handOffTime, data.currentEventStartTime)) {
      return currentUserIndex;
    }

    if (rotation.intervalType === EventInterval.Day) {
      // calculate the number of days between the start time of the layer and the handoff time.
      intervalBetweenStartTimeAndHandoffTime =
        OneUptimeDate.getDaysBetweenTwoDatesInclusive(
          handOffTime,
          data.currentEventStartTime,
        );
    }

    if (rotation.intervalType === EventInterval.Hour) {
      // calculate the number of hours between the start time of the layer and the handoff time.
      intervalBetweenStartTimeAndHandoffTime =
        OneUptimeDate.getHoursBetweenTwoDatesInclusive(
          handOffTime,
          data.currentEventStartTime,
        );
    }

    if (rotation.intervalType === EventInterval.Week) {
      // calculate the number of weeks between the start time of the layer and the handoff time.
      intervalBetweenStartTimeAndHandoffTime =
        OneUptimeDate.getWeeksBetweenTwoDatesInclusive(
          handOffTime,
          data.currentEventStartTime,
        );
    }

    if (rotation.intervalType === EventInterval.Month) {
      // calculate the number of months between the start time of the layer and the handoff time.
      intervalBetweenStartTimeAndHandoffTime =
        OneUptimeDate.getMonthsBetweenTwoDatesInclusive(
          handOffTime,
          data.currentEventStartTime,
        );
    }

    if (rotation.intervalType === EventInterval.Year) {
      // calculate the number of years between the start time of the layer and the handoff time.
      intervalBetweenStartTimeAndHandoffTime =
        OneUptimeDate.getYearsBetweenTwoDatesInclusive(
          data.startDateTimeOfLayer,
          handOffTime,
        );
    }

    // now divide the interval between start time and handoff time by the interval count.

    let numberOfIntervalsBetweenStartAndHandoffTime: number = Math.ceil(
      intervalBetweenStartTimeAndHandoffTime /
        rotation.intervalCount.toNumber(),
    );

    if (numberOfIntervalsBetweenStartAndHandoffTime < 0) {
      numberOfIntervalsBetweenStartAndHandoffTime =
        numberOfIntervalsBetweenStartAndHandoffTime * -1;
    }

    currentUserIndex = this.incrementUserIndex(
      currentUserIndex,
      data.users.length,
      numberOfIntervalsBetweenStartAndHandoffTime,
    );

    return currentUserIndex;
  }

  public trimStartAndEndTimesBasedOnRestrictionTimes(data: {
    eventStartTime: Date;
    eventEndTime: Date;
    restrictionTimes: RestrictionTimes;
  }): Array<StartAndEndTime> {
    const restrictionTimes: RestrictionTimes = data.restrictionTimes;

    if (restrictionTimes.restictionType === RestrictionType.None) {
      return [
        {
          startTime: data.eventStartTime,
          endTime: data.eventEndTime,
        },
      ];
    }

    if (
      restrictionTimes.restictionType === RestrictionType.Daily &&
      restrictionTimes.dayRestrictionTimes
    ) {
      // before this we need to make sure restrciton times are moved to the day of the event.
      restrictionTimes.dayRestrictionTimes.startTime =
        OneUptimeDate.keepTimeButMoveDay(
          restrictionTimes.dayRestrictionTimes.startTime,
          data.eventStartTime,
        );

      restrictionTimes.dayRestrictionTimes.endTime =
        OneUptimeDate.keepTimeButMoveDay(
          restrictionTimes.dayRestrictionTimes.endTime,
          data.eventStartTime,
        );

      return this.getEventsByDailyRestriction({
        eventStartTime: data.eventStartTime,
        eventEndTime: data.eventEndTime,
        restrictionStartAndEndTime: restrictionTimes.dayRestrictionTimes,
        props: {
          intervalType: EventInterval.Day,
        },
      });
    }

    if (restrictionTimes.restictionType === RestrictionType.Weekly) {
      return this.getEventsByWeeklyRestriction(data);
    }

    return [];
  }

  public getEventsByWeeklyRestriction(data: {
    eventStartTime: Date;
    eventEndTime: Date;
    restrictionTimes: RestrictionTimes;
  }): Array<StartAndEndTime> {
    const weeklyRestrictionTimes: Array<WeeklyResctriction> =
      data.restrictionTimes.weeklyRestrictionTimes;

    // if there are no weekly restriction times, we dont have any restrictions and we can return the event start and end times

    let trimmedStartAndEndTimes: Array<StartAndEndTime> = [];

    if (!weeklyRestrictionTimes || weeklyRestrictionTimes.length === 0) {
      return [
        {
          startTime: data.eventStartTime,
          endTime: data.eventEndTime,
        },
      ];
    }

    const restrictionStartAndEndTimes: Array<StartAndEndTime> =
      this.getWeeklyRestrictionTimesForWeek(data);

    for (const restrictionStartAndEndTime of restrictionStartAndEndTimes) {
      const trimmedStartAndEndTimesForRestriction: Array<StartAndEndTime> =
        this.getEventsByDailyRestriction({
          eventStartTime: data.eventStartTime,
          eventEndTime: data.eventEndTime,
          restrictionStartAndEndTime: restrictionStartAndEndTime,
          props: {
            intervalType: EventInterval.Week,
          },
        });

      trimmedStartAndEndTimes = [
        ...trimmedStartAndEndTimes,
        ...trimmedStartAndEndTimesForRestriction,
      ];
    }

    return trimmedStartAndEndTimes;
  }

  public getWeeklyRestrictionTimesForWeek(data: {
    eventStartTime: Date;
    eventEndTime: Date;
    restrictionTimes: RestrictionTimes;
  }): Array<StartAndEndTime> {
    const weeklyRestrictionTimes: Array<WeeklyResctriction> =
      data.restrictionTimes.weeklyRestrictionTimes;

    const eventStartTime: Date = data.eventStartTime;

    const startAndEndTimesOfWeeklyRestrictions: Array<StartAndEndTime> = [];

    for (const weeklyRestriction of weeklyRestrictionTimes) {
      // move all of these to the week of the event start time

      let startTime: Date = weeklyRestriction.startTime;
      let endTime: Date = weeklyRestriction.endTime;

      // move start and end times to the week of the event start time

      startTime = OneUptimeDate.moveDateToTheDayOfWeek(
        startTime,
        eventStartTime,
        OneUptimeDate.getDayOfWeek(startTime),
      );

      endTime = OneUptimeDate.moveDateToTheDayOfWeek(
        endTime,
        eventStartTime,
        OneUptimeDate.getDayOfWeek(endTime),
      );

      // now we have true start and end times of the weekly restriction

      // if start time is after end time, we need to add one week to the end time

      if (OneUptimeDate.isAfter(startTime, endTime)) {
        // in this case the restriction is towards the ends of the week and not in the middle so we need to add two objects to the array.
        // One for start of the week
        // and the other for end of the week .

        const startOfWeek: Date = data.eventStartTime;
        // add 7 days to the end time to get the end of the week
        const endOfTheWeek: Date = OneUptimeDate.addRemoveDays(startOfWeek, 7);

        startAndEndTimesOfWeeklyRestrictions.push({
          startTime: startOfWeek,
          endTime: endTime,
        });

        startAndEndTimesOfWeeklyRestrictions.push({
          startTime: startTime,
          endTime: endOfTheWeek,
        });
      }

      startAndEndTimesOfWeeklyRestrictions.push({
        startTime,
        endTime,
      });
    }

    return startAndEndTimesOfWeeklyRestrictions;
  }

  public getEventsByDailyRestriction(data: {
    eventStartTime: Date;
    eventEndTime: Date;
    restrictionStartAndEndTime: StartAndEndTime;
    props: {
      intervalType: EventInterval;
    };
  }): Array<StartAndEndTime> {
    const dayRestrictionTimes: StartAndEndTime | null =
      data.restrictionStartAndEndTime;

    // if there are no day restriction times, we dont have any restrictions and we can return the event start and end times

    if (!dayRestrictionTimes) {
      return [
        {
          startTime: data.eventStartTime,
          endTime: data.eventEndTime,
        },
      ];
    }

    //

    let restrictionStartTime: Date = dayRestrictionTimes.startTime;
    let restrictionEndTime: Date = dayRestrictionTimes.endTime;

    let currentStartTime: Date = data.eventStartTime;
    const currentEndTime: Date = data.eventEndTime;

    const trimmedStartAndEndTimes: Array<StartAndEndTime> = [];

    let reachedTheEndOfTheCurrentEvent: boolean = false;

    // create a break clause. This loop executes 100 times at max.

    const maxLoopCount: number = 50;
    let loopCount: number = 0;

    while (!reachedTheEndOfTheCurrentEvent) {
      loopCount++;

      if (loopCount > maxLoopCount) {
        break;
      }
      // if current end time is equalto or before than the current start time, we need to return the current event and exit the loop

      if (OneUptimeDate.isOnOrBefore(currentEndTime, currentStartTime)) {
        reachedTheEndOfTheCurrentEvent = true;
      }

      // if the event is ourside the restriction times, we need to return the trimmed array

      if (OneUptimeDate.isOnOrAfter(restrictionStartTime, currentEndTime)) {
        return trimmedStartAndEndTimes;
      }

      // if current event start time is after the restriction end time then we need to return empty array as there is no event.

      if (OneUptimeDate.isOnOrAfter(currentStartTime, restrictionEndTime)) {
        return trimmedStartAndEndTimes;
      }

      // if the restriction end time is before the restriction start time, we need to add one day to the restriction end time
      if (OneUptimeDate.isAfter(restrictionStartTime, restrictionEndTime)) {
        restrictionEndTime = OneUptimeDate.addRemoveDays(
          restrictionEndTime,
          data.props.intervalType === EventInterval.Day ? 1 : 7, // daily or weekly
        );
      }

      // 1 - if the current event falls within the restriction times, we need to return the current event.

      if (
        OneUptimeDate.isOnOrAfter(currentStartTime, restrictionStartTime) &&
        OneUptimeDate.isOnOrAfter(restrictionEndTime, currentEndTime)
      ) {
        trimmedStartAndEndTimes.push({
          startTime: currentStartTime,
          endTime: currentEndTime,
        });
        reachedTheEndOfTheCurrentEvent = true;
      }

      // 2 - Start Restriction: If the current event starts after the restriction start time and ends after the restriction end time, we need to return the current event with the start time of the current event and end time of the restriction

      if (
        OneUptimeDate.isOnOrAfter(currentStartTime, restrictionStartTime) &&
        OneUptimeDate.isOnOrAfter(currentEndTime, restrictionEndTime)
      ) {
        trimmedStartAndEndTimes.push({
          startTime: currentStartTime,
          endTime: restrictionEndTime,
        });
        reachedTheEndOfTheCurrentEvent = true;
      }

      // 3 - End Restriction - If the current event starts before the restriction start time and ends before the restriction end time, we need to return the current event with the start time of the restriction and end time of the current event.

      if (
        OneUptimeDate.isBefore(currentStartTime, restrictionStartTime) &&
        OneUptimeDate.isBefore(currentEndTime, restrictionEndTime) &&
        OneUptimeDate.isAfter(currentEndTime, restrictionStartTime)
      ) {
        trimmedStartAndEndTimes.push({
          startTime: restrictionStartTime,
          endTime: currentEndTime,
        });
        reachedTheEndOfTheCurrentEvent = true;
      }

      // 4 - If the current event starts before the restriction start time and ends after the restriction end time, we need to return the current event with the start time of the restriction and end time of the restriction.

      if (
        OneUptimeDate.isBefore(currentStartTime, restrictionStartTime) &&
        OneUptimeDate.isOnOrAfter(currentEndTime, restrictionEndTime)
      ) {
        trimmedStartAndEndTimes.push({
          startTime: restrictionStartTime,
          endTime: restrictionEndTime,
        });

        currentStartTime = OneUptimeDate.addRemoveSeconds(
          restrictionEndTime,
          1,
        );

        // add day to restriction start and end times.

        restrictionStartTime = OneUptimeDate.addRemoveDays(
          restrictionStartTime,
          data.props.intervalType === EventInterval.Day ? 1 : 7, // daily or weekly
        );
        restrictionEndTime = OneUptimeDate.addRemoveDays(
          restrictionEndTime,
          data.props.intervalType === EventInterval.Day ? 1 : 7, // daily or weekly
        );
      }
    }

    return trimmedStartAndEndTimes;
  }

  // helper functions.

  private incrementUserIndex(
    currentIndex: number,
    userArrayLength: number,
    incrementBy?: number,
  ): number {
    // update the current user index

    if (incrementBy === undefined) {
      incrementBy = 1;
    }

    currentIndex = currentIndex + incrementBy;

    // if the current user index is greater than the length of the users array, we need to reset the current user index to 0
    if (currentIndex >= userArrayLength) {
      // then modulo the current user index by the length of the users array
      currentIndex = currentIndex % userArrayLength; // so this rotates the users.
    }

    return currentIndex;
  }

  private getCalendarEventsFromStartAndEndDates(
    trimmedStartAndEndTimes: Array<StartAndEndTime>,
    users: Array<UserModel>,
    currentUserIndex: number,
  ): Array<CalendarEvent> {
    const events: Array<CalendarEvent> = [];

    const userId: string = users[currentUserIndex]?.id?.toString() || "";

    for (const trimmedStartAndEndTime of trimmedStartAndEndTimes) {
      const event: CalendarEvent = {
        id: 0,
        title: userId, // This will be changed to username in the UI or will bve kept the same if used on the server.
        allDay: false,
        start: trimmedStartAndEndTime.startTime,
        end: trimmedStartAndEndTime.endTime,
      };

      events.push(event);
    }

    return events;
  }

  public getMultiLayerEvents(
    data: MultiLayerProps,
    options?:
      | {
          getNumberOfEvents?: number;
        }
      | undefined,
  ): Array<CalendarEvent> {
    const events: Array<PriorityCalendarEvents> = [];
    let layerPriority: number = 1;

    for (const layer of data.layers) {
      const layerEvents: Array<CalendarEvent> = this.getEvents(
        {
          users: layer.users,
          startDateTimeOfLayer: layer.startDateTimeOfLayer,
          restrictionTimes: layer.restrictionTimes,
          handOffTime: layer.handOffTime,
          rotation: layer.rotation,
          calendarStartDate: data.calendarStartDate,
          calendarEndDate: data.calendarEndDate,
        },
        options,
      );

      // add priority to each event

      for (const layerEvent of layerEvents) {
        const priorityEvent: PriorityCalendarEvents = {
          ...layerEvent,
          priority: layerPriority,
        };

        events.push(priorityEvent);
      }

      // increment layer priority
      layerPriority++;
    }

    // now remove the overlapping events

    const nonOverlappingEvents: Array<CalendarEvent> =
      this.removeOverlappingEvents(events);

    if (options?.getNumberOfEvents !== undefined) {
      if (nonOverlappingEvents.length > options.getNumberOfEvents) {
        return nonOverlappingEvents.slice(0, options.getNumberOfEvents);
      }
    }

    return nonOverlappingEvents;
  }

  public removeOverlappingEvents(
    events: PriorityCalendarEvents[],
  ): CalendarEvent[] {
    // now remove overlapping events by priority and trim them by priority. Lower priority number will be kept and higher priority number will be trimmed.
    // so if there are two events with the same start and end time, we will keep the one with the lower priority number and remove the one with the higher priority number.
    // if there are overlapping events, we will trim the one with the higher priority number.

    // sort the events by priority

    // now remove the overlapping events

    // remove events where start time and end time are the same

    events = events.filter((event: PriorityCalendarEvents) => {
      return !OneUptimeDate.isSame(event.start, event.end);
    });

    // remove events where start time is after end time
    events = events.filter((event: PriorityCalendarEvents) => {
      return !OneUptimeDate.isBefore(event.end, event.start);
    });

    const finalEvents: PriorityCalendarEvents[] = [];

    // sort events by start time

    events.sort((a: CalendarEvent, b: CalendarEvent) => {
      if (OneUptimeDate.isBefore(a.start, b.start)) {
        return -1;
      }

      if (OneUptimeDate.isAfter(a.start, b.start)) {
        return 1;
      }

      return 0;
    });

    for (const event of events) {
      // trim the trimmed events by the current event based on priority

      // if this event starts and end at the same time, we need to remove it
      if (OneUptimeDate.isSame(event.start, event.end)) {
        continue;
      }

      // if the end time of the event is before the start time, we need to remove it
      if (OneUptimeDate.isBefore(event.end, event.start)) {
        continue;
      }

      for (let i: number = 0; i < finalEvents.length; i++) {
        const finalEvent: PriorityCalendarEvents | undefined = finalEvents[i];

        if (!finalEvent) {
          continue;
        }

        // check if this final event overlaps with the current event
        if (
          OneUptimeDate.isOverlapping(
            finalEvent.start,
            finalEvent.end,
            event.start,
            event.end,
          )
        ) {
          // if the current event has a higher priority than the final event, we need to trim the final event
          if (event.priority < finalEvent.priority) {
            // trim the final event based on the current event
            // end time of the final event will be the start time of the current event - 1 second
            const tempFinalEventEnd: Date = finalEvent.end;

            finalEvent.end = OneUptimeDate.addRemoveSeconds(event.start, -1);

            // check if the final event end time is before the start time of the current event
            // if it is, we need to remove the final event from the final events array
            if (OneUptimeDate.isBefore(finalEvent.end, finalEvent.start)) {
              finalEvents.splice(i, 1);
              i--; // Adjust index after removal
              continue;
            }

            // if end and start time of the final event is same, we need to remove it
            if (OneUptimeDate.isSame(finalEvent.start, finalEvent.end)) {
              finalEvents.splice(i, 1);
              i--; // Adjust index after removal
              continue;
            }

            // final event was originally ending after the current event, so we need to add the trimmed event to the final events array
            if (OneUptimeDate.isAfter(tempFinalEventEnd, event.end)) {
              // add the trimmed event to the final events array
              const trimmedEvent: PriorityCalendarEvents = {
                ...finalEvent,
                priority: finalEvent.priority,
                start: OneUptimeDate.addRemoveSeconds(event.end, 1),
                end: tempFinalEventEnd,
              };

              // check if the event end time is before the start time of the trimmed event
              if (OneUptimeDate.isAfter(trimmedEvent.end, trimmedEvent.start)) {
                finalEvents.push(trimmedEvent);
              }
            }
          } else {
            // trim the current event based on the final event
            // start time of the current event will be the end time of the final event + 1 second
            event.start = OneUptimeDate.addRemoveSeconds(finalEvent.end, 1);
          }
        }
      }

      // check if the event end time is before the start time of the current event
      if (OneUptimeDate.isAfter(event.end, event.start)) {
        finalEvents.push(event);
      }

      // sort by start times

      finalEvents.sort((a: CalendarEvent, b: CalendarEvent) => {
        if (OneUptimeDate.isBefore(a.start, b.start)) {
          return -1;
        }

        if (OneUptimeDate.isAfter(a.start, b.start)) {
          return 1;
        }

        return 0;
      });

      // if an event starts and end at the same time, we need to remove it

      for (let index: number = 0; index < finalEvents.length; index++) {
        const finalEvent: PriorityCalendarEvents | undefined =
          finalEvents[index];

        if (!finalEvent) {
          continue;
        }

        if (OneUptimeDate.isSame(finalEvent.start, finalEvent.end)) {
          finalEvents.splice(index, 1);
          index--; // Adjust index after removal
          continue;
        }

        // if any event ends before it starts, we need to remove it
        if (OneUptimeDate.isBefore(finalEvent.end, finalEvent.start)) {
          finalEvents.splice(index, 1);
          index--; // Adjust index after removal
        }
      }
    }

    // convert PriorityCalendarEvents to CalendarEvents

    const calendarEvents: CalendarEvent[] = [];
    let id: number = 1;

    for (const event of finalEvents) {
      const calendarEvent: CalendarEvent = {
        ...event,
        id: id,
      };

      calendarEvents.push(calendarEvent);
      id++;
    }

    return calendarEvents;
  }
}
