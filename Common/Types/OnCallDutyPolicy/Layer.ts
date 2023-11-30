import UserModel from '../../Models/UserModel';
import Recurring from '../Events/Recurring';
import CalendarEvent from '../Calendar/CalendarEvent';
import RestrictionTimes, { RestrictionType } from './RestrictionTimes';
import OneUptimeDate from '../Date';
import EventInterval from '../Events/EventInterval';
import StartAndEndTime from '../Time/StartAndEndTime';
import DayOfWeek from '../Day/DayOfWeek';

export default class LayerUtil {

    // TODO: Add support for hand off time. 

    public static getEvents(data: {
        users: Array<UserModel>;
        startDateTimeOfLayer: Date;
        calendarStartDate: Date;
        calendarEndDate: Date;
        restrictionTImes: RestrictionTimes;
        handOffTime: Date;
        rotation: Recurring;
    }): Array<CalendarEvent> {


        const events: Array<CalendarEvent> = [];

        let start: Date = data.calendarStartDate;
        let end: Date = data.calendarEndDate;

        // TODO: Calculate user Index based on the hand off time.


        // start time of the layer is after the start time of the calendar, so we need to update the start time of the calendar
        if (OneUptimeDate.isAfter(data.startDateTimeOfLayer, start)) {
            start = data.startDateTimeOfLayer;
        }


        // end time of the layer is before the end time of the calendar, so, we dont have any events and we can return empty array
        if (OneUptimeDate.isAfter(data.startDateTimeOfLayer, end)) {
            return [];
        }

        // if users are empty, we dont have any events and we can return empty array
        if (data.users.length === 0) {
            return [];
        }

        // split events by rotation. 

        const rotation: Recurring = data.rotation;

        let hasReachedTheEndOfTheCalendar: boolean = false;

        const handOffTime: Date = data.handOffTime;

        // Looop vars 
        let currentEventStartTime: Date = start;
        let currentEventEndTime: Date = OneUptimeDate.getCurrentDate(); // temporary set to current time to avoid typescript error
        let currentUserIndex: number = 0;

        while (!hasReachedTheEndOfTheCalendar) {


            if (rotation.intervalType === EventInterval.Day) {
                const daysToAdd = rotation.intervalCount.toNumber();
                currentEventEndTime = OneUptimeDate.addRemoveDays(currentEventStartTime, daysToAdd);
            } else if (rotation.intervalType === EventInterval.Week) {
                let weeksToAdd = rotation.intervalCount.toNumber();
                currentEventEndTime = OneUptimeDate.addRemoveWeeks(currentEventStartTime, weeksToAdd);
            } else if (rotation.intervalType === EventInterval.Month) {
                const monthsToAdd = rotation.intervalCount.toNumber();
                currentEventEndTime = OneUptimeDate.addRemoveMonths(currentEventStartTime, monthsToAdd);
            } else if (rotation.intervalType === EventInterval.Year) {
                const yearsToAdd = rotation.intervalCount.toNumber();
                currentEventEndTime = OneUptimeDate.addRemoveYears(currentEventStartTime, yearsToAdd);
            } else if (rotation.intervalType === EventInterval.Hour) {
                const hoursToAdd = rotation.intervalCount.toNumber();
                currentEventEndTime = OneUptimeDate.addRemoveHours(currentEventStartTime, hoursToAdd);
            }

            // check calendar end time. if the end time of the event is after the end time of the calendar, we need to update the end time of the event
            if (OneUptimeDate.isAfter(currentEventEndTime, end)) {
                currentEventEndTime = end;
                hasReachedTheEndOfTheCalendar = true;
            }


            // check restriction times. if the end time of the event is after the end time of the restriction times, we need to update the end time of the event. 

            const trimmedStartAndEndTimes: Array<StartAndEndTime>
                = LayerUtil.trimStartAndEndTimesBasedOnRestrictionTimes({
                    eventStartTime: currentEventStartTime,
                    eventEndTime: currentEventEndTime,
                    restrictionTimes: data.restrictionTImes,
                });



            const userId = data.users[currentUserIndex]?.id?.toString() || '';

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

            // update the current event start time

            currentEventStartTime = currentEventEndTime;

            // update the current user index

            currentUserIndex++;


            // if the current user index is greater than the length of the users array, we need to reset the current user index to 0
            if (currentUserIndex >= data.users.length) {
                currentUserIndex = 0;
            }
        }

        // increment ids of all the events and return them, to make sure they are unique

        let id = 1;

        for (const event of events) {
            event.id = id;
            id++;
        }

        return events;
    }


    public static trimStartAndEndTimesBasedOnRestrictionTimes(data: {
        eventStartTime: Date;
        eventEndTime: Date;
        restrictionTimes: RestrictionTimes;
    }): Array<StartAndEndTime> {

        const restrictionTimes: RestrictionTimes = data.restrictionTimes;

        if (restrictionTimes.restictionType === RestrictionType.None) {
            return [{
                startTime: data.eventStartTime,
                endTime: data.eventEndTime,
            }];
        }


        if (restrictionTimes.restictionType === RestrictionType.Daily) {
            const dayRestrictionTimes = restrictionTimes.dayRestrictionTimes;


            // if there are no day restriction times, we dont have any restrictions and we can return the event start and end times

            if (!dayRestrictionTimes) {
                return [{
                    startTime: data.eventStartTime,
                    endTime: data.eventEndTime,
                }];
            }

            // 

            let restrictionStartTime: Date = dayRestrictionTimes.startTime;
            let restrictionEndTime: Date = dayRestrictionTimes.endTime;


            let currentStartTime = data.eventStartTime;
            let currentEndTime = data.eventEndTime;

            const trimmedStartAndEndTimes: Array<StartAndEndTime> = [];

            let reachedTheEndOfTheCurrentEvent = false;

            while (!reachedTheEndOfTheCurrentEvent) {

                // if current end time is equalto or before than the current start time, we need to return the current event and exit the loop

                if (OneUptimeDate.isBefore(currentEndTime, currentStartTime)) {
                    reachedTheEndOfTheCurrentEvent = true;
                }

                // before this we need to make sure restrciton times are moved to the day of the event.
                restrictionStartTime = OneUptimeDate.keepTimeButMoveDay(restrictionStartTime, data.eventStartTime);
                restrictionEndTime = OneUptimeDate.keepTimeButMoveDay(restrictionEndTime, data.eventStartTime);

                // if the restriction end time is before the restriction start time, we need to add one day to the restriction end time
                if (OneUptimeDate.isAfter(restrictionStartTime, restrictionEndTime)) {
                    restrictionEndTime = OneUptimeDate.addRemoveDays(restrictionEndTime, 1);
                }

                // 1 - if the current event falls within the restriction times, we need to return the current event. 

                if (OneUptimeDate.isOnOrAfter(currentStartTime, restrictionStartTime) && OneUptimeDate.isOnOrAfter(restrictionEndTime, currentEndTime)) {
                    trimmedStartAndEndTimes.push({
                        startTime: currentStartTime,
                        endTime: currentEndTime,
                    });
                    reachedTheEndOfTheCurrentEvent = true;
                }

                // 2 - Start Restriction: If the current event starts after the restriction start time and ends after the restriction end time, we need to return the current event with the start time of the current event and end time of the restriction

                if (OneUptimeDate.isOnOrAfter(currentStartTime, restrictionStartTime) && OneUptimeDate.isOnOrAfter(currentEndTime, restrictionEndTime)) {
                    trimmedStartAndEndTimes.push({
                        startTime: currentStartTime,
                        endTime: restrictionEndTime,
                    });
                    reachedTheEndOfTheCurrentEvent = true;
                }

                // 3 - End Restriction - If the current event starts before the restriction start time and ends before the restriction end time, we need to return the current event with the start time of the restriction and end time of the current event.

                if (OneUptimeDate.isBefore(currentStartTime, restrictionStartTime) && OneUptimeDate.isBefore(currentEndTime, restrictionEndTime)) {
                    trimmedStartAndEndTimes.push({
                        startTime: restrictionStartTime,
                        endTime: currentEndTime,
                    });
                    reachedTheEndOfTheCurrentEvent = true;
                }

                // 4 - If the current event starts before the restriction start time and ends after the restriction end time, we need to return the current event with the start time of the restriction and end time of the restriction.

                if (OneUptimeDate.isBefore(currentStartTime, restrictionStartTime) && OneUptimeDate.isOnOrAfter(currentEndTime, restrictionEndTime)) {
                    trimmedStartAndEndTimes.push({
                        startTime: restrictionStartTime,
                        endTime: restrictionEndTime,
                    });
                    
                    currentStartTime = restrictionEndTime;

                    // add day to restriction start and end times. 

                    restrictionStartTime = OneUptimeDate.addRemoveDays(restrictionStartTime, 1);
                    restrictionEndTime = OneUptimeDate.addRemoveDays(restrictionEndTime, 1);

                }

            }

            return trimmedStartAndEndTimes;
        }


        if (restrictionTimes.restictionType === RestrictionType.Weekly) {

            const weeklyRestrictionTimes = restrictionTimes.weeklyRestrictionTimes;

            // if there are no weekly restriction times, we dont have any restrictions and we can return the event start and end times

            const trimmedStartAndEndTimes: Array<StartAndEndTime> = [];

            if (!weeklyRestrictionTimes || weeklyRestrictionTimes.length === 0) {
                return [{
                    startTime: data.eventStartTime,
                    endTime: data.eventEndTime,
                }];
            }

            // const eventStartTime: Date = data.eventStartTime;
            // const eventStartDayOfWeek: DayOfWeek = OneUptimeDate.getDayOfWeek(eventStartTime);


            return trimmedStartAndEndTimes;
        }

        return [];
    }

}
